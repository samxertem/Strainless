import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { Attachment, Category, Item, ItemPatch, NewItem } from './types';

// Must match DB_URL in src-tauri/src/lib.rs, which registers the migrations.
const DB_URL = 'sqlite:strainless.db';

let connection: Promise<Database> | null = null;
const db = () => (connection ??= Database.load(DB_URL));
const nowIso = () => new Date().toISOString();

// ---------- categories ----------

export async function listCategories(): Promise<Category[]> {
  return (await db()).select<Category[]>('SELECT * FROM categories ORDER BY sort_order, id');
}

export async function createCategory(name: string, color: string): Promise<void> {
  await (await db()).execute(
    `INSERT INTO categories (name, color, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories))`,
    [name.trim(), color],
  );
}

export async function updateCategory(id: number, patch: Partial<Pick<Category, 'name' | 'color'>>): Promise<void> {
  const d = await db();
  if (patch.name !== undefined) await d.execute('UPDATE categories SET name = $1 WHERE id = $2', [patch.name.trim(), id]);
  if (patch.color !== undefined) await d.execute('UPDATE categories SET color = $1 WHERE id = $2', [patch.color, id]);
}

/** Persists the given order (array of ids, first = top of the sidebar). */
export async function reorderCategories(orderedIds: number[]): Promise<void> {
  const d = await db();
  for (const [index, id] of orderedIds.entries()) {
    await d.execute('UPDATE categories SET sort_order = $1 WHERE id = $2', [index + 1, id]);
  }
}

/** Items in the deleted category are moved first, so nothing is ever orphaned. */
export async function deleteCategory(id: number, moveItemsTo: number | null): Promise<void> {
  const d = await db();
  if (moveItemsTo !== null) {
    await d.execute('UPDATE items SET category_id = $1 WHERE category_id = $2', [moveItemsTo, id]);
  }
  await d.execute('DELETE FROM categories WHERE id = $1', [id]);
}

// ---------- items ----------

type ItemRow = Omit<Item, 'all_day'> & { all_day: number };

export async function listItems(): Promise<Item[]> {
  const rows = await (await db()).select<ItemRow[]>(
    `SELECT i.*, (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id) AS attachment_count
     FROM items i`,
  );
  return rows.map((r) => ({ ...r, all_day: r.all_day === 1 }));
}

export async function createItem(input: NewItem): Promise<number> {
  const result = await (await db()).execute(
    'INSERT INTO items (title, category_id, due_at, all_day) VALUES ($1, $2, $3, $4)',
    [input.title.trim(), input.category_id, input.due_at ?? null, input.all_day ? 1 : 0],
  );
  return result.lastInsertId as number;
}

// Whitelist: column names are interpolated into SQL, so they must never come from input.
const PATCHABLE = ['title', 'category_id', 'course', 'due_at', 'all_day', 'status', 'priority', 'notes_md'] as const;

export async function updateItem(id: number, patch: ItemPatch): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  for (const column of PATCHABLE) {
    if (!(column in patch)) continue;
    const value = patch[column];
    set(column, column === 'all_day' ? (value ? 1 : 0) : (value ?? null));
  }
  if (sets.length === 0) return;
  if (patch.status !== undefined) set('completed_at', patch.status === 'done' ? nowIso() : null);
  set('updated_at', nowIso());

  values.push(id);
  await (await db()).execute(`UPDATE items SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
}

export async function deleteItem(id: number): Promise<void> {
  const d = await db();
  await d.execute('DELETE FROM attachments WHERE item_id = $1', [id]);
  await d.execute('DELETE FROM items WHERE id = $1', [id]);
  // Rows first: a leftover folder is harmless, a row pointing at a deleted file is not.
  await invoke('delete_item_files', { itemId: id });
}

// ---------- attachments ----------

interface StoredFile {
  stored_name: string;
  original_name: string;
  size: number;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  txt: 'text/plain',
  md: 'text/markdown',
};

export const guessMime = (name: string): string | null =>
  MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;

export async function listAttachments(itemId: number): Promise<Attachment[]> {
  return (await db()).select<Attachment[]>(
    'SELECT * FROM attachments WHERE item_id = $1 ORDER BY added_at, id',
    [itemId],
  );
}

export async function addAttachments(itemId: number, sourcePaths: string[]): Promise<void> {
  const d = await db();
  for (const sourcePath of sourcePaths) {
    const file = await invoke<StoredFile>('import_attachment', { itemId, sourcePath });
    await d.execute(
      'INSERT INTO attachments (item_id, original_name, stored_name, mime, size) VALUES ($1, $2, $3, $4, $5)',
      [itemId, file.original_name, file.stored_name, guessMime(file.original_name), file.size],
    );
  }
}

export async function removeAttachment(att: Attachment): Promise<void> {
  await (await db()).execute('DELETE FROM attachments WHERE id = $1', [att.id]);
  await invoke('delete_attachment_file', { itemId: att.item_id, storedName: att.stored_name });
}

export const openAttachment = (att: Attachment) =>
  invoke<void>('open_attachment', { itemId: att.item_id, storedName: att.stored_name });

export const openDataFolder = () => invoke<void>('open_data_folder');
