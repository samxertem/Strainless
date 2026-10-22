import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type {
  Attachment, BackupManifest, Category, Item, ItemPatch, JournalBlock, JournalDay, JournalFont, JournalHit, NewItem,
  SearchHit, Settings,
} from './types';
import { CATEGORY_COLORS, DEFAULT_SETTINGS } from './types';
import { deleteFile, deleteOwnerFiles, guessMime, importFile } from './files';

// Must match DB_URL in src-tauri/src/lib.rs, which registers the migrations.
const DB_URL = 'sqlite:strainless.db';

let connection: Promise<Database> | null = null;
/** The shared connection; other data modules (courses, annotations) use it too. */
export const db = () => (connection ??= Database.load(DB_URL));
export const nowIso = () => new Date().toISOString();

/** `%text%` for LIKE with `\` as the escape character, so `%` and `_` in input match literally. */
export const likePattern = (text: string) => `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Typing a new course on an item creates the course, so the sidebar and Courses page know it. */
export async function ensureCourse(name: string | null | undefined): Promise<void> {
  const trimmed = name?.trim();
  if (!trimmed) return;
  const d = await db();
  const n = (await d.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM courses'))[0].n;
  await d.execute(
    `INSERT OR IGNORE INTO courses (name, color, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM courses))`,
    [trimmed, CATEGORY_COLORS[(n * 5) % CATEGORY_COLORS.length]],
  );
}

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
  await ensureCourse(input.course);
  const result = await (await db()).execute(
    'INSERT INTO items (title, category_id, course, due_at, all_day) VALUES ($1, $2, $3, $4, $5)',
    [input.title.trim(), input.category_id, input.course?.trim() || null, input.due_at ?? null, input.all_day ? 1 : 0],
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
    let value = patch[column];
    if (column === 'course') value = (value as string | null)?.trim() || null;
    set(column, column === 'all_day' ? (value ? 1 : 0) : (value ?? null));
  }
  if (sets.length === 0) return;
  if (patch.course) await ensureCourse(patch.course);
  if (patch.status !== undefined) set('completed_at', patch.status === 'done' ? nowIso() : null);
  set('updated_at', nowIso());

  values.push(id);
  await (await db()).execute(`UPDATE items SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
}

export async function deleteItem(id: number): Promise<void> {
  const d = await db();
  for (const table of ['annotations', 'ink_strokes']) {
    await d.execute(
      `DELETE FROM ${table} WHERE file_ref IN (SELECT 'attachment:' || id FROM attachments WHERE item_id = $1)`,
      [id],
    );
  }
  await d.execute('DELETE FROM attachments WHERE item_id = $1', [id]);
  await d.execute('DELETE FROM reminders_sent WHERE item_id = $1', [id]);
  await d.execute('DELETE FROM exam_topics WHERE item_id = $1', [id]);
  await d.execute('DELETE FROM items WHERE id = $1', [id]);
  // Rows first: a leftover folder is harmless, a row pointing at a deleted file is not.
  await deleteOwnerFiles('attachments', id);
}

// ---------- attachments ----------

export async function listAttachments(itemId: number): Promise<Attachment[]> {
  return (await db()).select<Attachment[]>(
    'SELECT * FROM attachments WHERE item_id = $1 ORDER BY added_at, id',
    [itemId],
  );
}

export async function addAttachments(itemId: number, sourcePaths: string[]): Promise<void> {
  const d = await db();
  for (const sourcePath of sourcePaths) {
    const file = await importFile('attachments', itemId, sourcePath);
    await d.execute(
      'INSERT INTO attachments (item_id, original_name, stored_name, mime, size) VALUES ($1, $2, $3, $4, $5)',
      [itemId, file.original_name, file.stored_name, guessMime(file.original_name), file.size],
    );
  }
}

export async function removeAttachment(att: Attachment): Promise<void> {
  const d = await db();
  await d.execute('DELETE FROM annotations WHERE file_ref = $1', [`attachment:${att.id}`]);
  await d.execute('DELETE FROM ink_strokes WHERE file_ref = $1', [`attachment:${att.id}`]);
  await d.execute('DELETE FROM attachments WHERE id = $1', [att.id]);
  await deleteFile('attachments', att.item_id, att.stored_name);
}

export const openDataFolder = () => invoke<void>('open_data_folder');

// ---------- search ----------

/**
 * User text -> FTS5 query. Every word becomes a quoted prefix term ("sig"* matches
 * "signals"), all words must match, and quoting makes FTS operators (OR, NOT, -, :)
 * plain text, so no input can produce a syntax error.
 */
export function toFtsQuery(input: string): string {
  return input
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .map((word) => `"${word.replace(/"/g, '""')}"*`)
    .join(' ');
}

export async function search(query: string): Promise<SearchHit[]> {
  const d = await db();
  const fts = toFtsQuery(query);
  const hits: SearchHit[] = fts
    ? await d.select<SearchHit[]>(
        `SELECT rowid AS id,
                highlight(items_fts, 0, char(2), char(3)) AS title,
                highlight(items_fts, 1, char(2), char(3)) AS course,
                snippet(items_fts, 2, char(2), char(3), '…', 14) AS notes
         FROM items_fts WHERE items_fts MATCH $1
         ORDER BY bm25(items_fts, 10.0, 4.0, 1.0) LIMIT 40`,
        [fts],
      )
    : [];

  // Attachment file names aren't in the FTS index; a LIKE scan over them is cheap.
  const trimmed = query.trim();
  if (trimmed) {
    const pattern = likePattern(trimmed);
    const files = await d.select<{ item_id: number; original_name: string }[]>(
      `SELECT item_id, original_name FROM attachments WHERE original_name LIKE $1 ESCAPE '\\'
       ORDER BY added_at DESC LIMIT 40`,
      [pattern],
    );
    const byId = new Map(hits.map((h) => [h.id, h]));
    for (const f of files) {
      const existing = byId.get(f.item_id);
      if (existing) existing.attachment ??= f.original_name;
      else {
        const hit: SearchHit = { id: f.item_id, title: null, course: null, notes: null, attachment: f.original_name };
        hits.push(hit);
        byId.set(f.item_id, hit);
      }
    }
  }
  return hits;
}

// ---------- settings ----------

export async function loadSettings(): Promise<Settings> {
  const rows = await (await db()).select<{ value: string }[]>("SELECT value FROM settings WHERE key = 'app'");
  return { ...DEFAULT_SETTINGS, ...(rows[0] ? (JSON.parse(rows[0].value) as Partial<Settings>) : {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).execute(
    `INSERT INTO settings (key, value) VALUES ('app', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(settings)],
  );
}

// ---------- reminders ----------

/**
 * Records that a reminder was shown. Returns false if it already was, which makes
 * the database the single source of truth: no duplicate notifications, even
 * across restarts.
 */
export async function claimReminder(itemId: number, kind: string, dueAt: string): Promise<boolean> {
  const result = await (await db()).execute(
    'INSERT OR IGNORE INTO reminders_sent (item_id, kind, due_at) VALUES ($1, $2, $3)',
    [itemId, kind, dueAt],
  );
  return result.rowsAffected === 1;
}

// ---------- backup & restore ----------

export async function schemaStatus(): Promise<{ current: number; latest: number }> {
  const rows = await (await db()).select<{ v: number | null }[]>('SELECT MAX(version) AS v FROM _sqlx_migrations');
  return { current: rows[0]?.v ?? 0, latest: await invoke<number>('latest_schema_version') };
}

export async function exportBackup(dest: string): Promise<BackupManifest> {
  const d = await db();
  // VACUUM INTO writes a consistent copy even while the app has the database open.
  const snapshot = await invoke<string>('backup_snapshot_path');
  await d.execute('VACUUM INTO $1', [snapshot]);

  const count = async (table: string) => (await d.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
  const manifest: BackupManifest = {
    app: 'strainless',
    format: 1,
    schema_version: (await schemaStatus()).current,
    created_at: nowIso(),
    item_count: await count('items'),
    attachment_count: await count('attachments'),
  };
  await invoke('write_backup', { dest, manifest });
  return manifest;
}

export const inspectBackup = (path: string) => invoke<BackupManifest>('inspect_backup', { path });

/** Closes the database (Windows can't move open files), swaps in the backup. Caller reloads the window. */
export async function restoreBackup(path: string): Promise<void> {
  if (connection) {
    const open = await connection;
    connection = null;
    await open.close();
  }
  const label = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  await invoke('restore_backup', { path, label });
}

// ---------- journal ----------

export async function getJournalDay(day: string): Promise<JournalDay> {
  const rows = await (await db()).select<JournalDay[]>('SELECT day, mood_photo, font FROM journal_days WHERE day = $1', [day]);
  return rows[0] ?? { day, mood_photo: null, font: 'hand' };
}

async function upsertJournalDay(day: string, column: 'mood_photo' | 'font', value: string | null): Promise<void> {
  // `column` comes from the union type above, never from input.
  await (await db()).execute(
    `INSERT INTO journal_days (day, ${column}, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(day) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`,
    [day, value, nowIso()],
  );
}

export const setJournalFont = (day: string, font: JournalFont) => upsertJournalDay(day, 'font', font);

/** Copies the photo in, points the day at it, then removes the previous one. */
export async function setMoodPhoto(day: string, sourcePath: string): Promise<void> {
  const previous = (await getJournalDay(day)).mood_photo;
  const stored = await invoke<string>('import_journal_photo', { day, sourcePath });
  await upsertJournalDay(day, 'mood_photo', stored);
  if (previous && previous !== stored) await invoke('delete_journal_photo', { day, storedName: previous });
}

export async function removeMoodPhoto(day: string): Promise<void> {
  const previous = (await getJournalDay(day)).mood_photo;
  await upsertJournalDay(day, 'mood_photo', null);
  if (previous) await invoke('delete_journal_photo', { day, storedName: previous });
}

export async function moodPhotoUrl(day: string, storedName: string): Promise<string> {
  return convertFileSrc(await invoke<string>('journal_photo_path', { day, storedName }));
}

export async function listJournalBlocks(day: string): Promise<JournalBlock[]> {
  return (await db()).select<JournalBlock[]>(
    'SELECT id, day, title, body, sort_order FROM journal_blocks WHERE day = $1 ORDER BY sort_order, id',
    [day],
  );
}

export async function createJournalBlock(day: string, title = '', body = ''): Promise<number> {
  const result = await (await db()).execute(
    `INSERT INTO journal_blocks (day, title, body, sort_order)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM journal_blocks WHERE day = $1))`,
    [day, title, body],
  );
  return result.lastInsertId as number;
}

/**
 * Creates an empty first space if the day has none. One statement, so it's atomic:
 * two concurrent page loads can't both insert.
 */
export async function ensureJournalBlock(day: string): Promise<void> {
  await (await db()).execute(
    `INSERT INTO journal_blocks (day, sort_order)
     SELECT $1, 1 WHERE NOT EXISTS (SELECT 1 FROM journal_blocks WHERE day = $1)`,
    [day],
  );
}

export async function updateJournalBlock(id: number, patch: Partial<Pick<JournalBlock, 'title' | 'body'>>): Promise<void> {
  const d = await db();
  if (patch.title !== undefined) await d.execute('UPDATE journal_blocks SET title = $1, updated_at = $2 WHERE id = $3', [patch.title, nowIso(), id]);
  if (patch.body !== undefined) await d.execute('UPDATE journal_blocks SET body = $1, updated_at = $2 WHERE id = $3', [patch.body, nowIso(), id]);
}

export async function deleteJournalBlock(id: number): Promise<void> {
  await (await db()).execute('DELETE FROM journal_blocks WHERE id = $1', [id]);
}

/** Days that have any writing or a mood photo, newest first. */
export async function journalDaysWithContent(): Promise<string[]> {
  const rows = await (await db()).select<{ day: string }[]>(
    `SELECT day FROM journal_blocks WHERE trim(title) <> '' OR trim(body) <> ''
     UNION SELECT day FROM journal_days WHERE mood_photo IS NOT NULL
     ORDER BY day DESC`,
  );
  return rows.map((r) => r.day);
}

export async function searchJournal(query: string): Promise<JournalHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = likePattern(trimmed);
  const rows = await (await db()).select<{ day: string; text: string }[]>(
    `SELECT day, title || ' — ' || body AS text FROM journal_blocks
     WHERE title LIKE $1 ESCAPE '\\' OR body LIKE $1 ESCAPE '\\'
     ORDER BY day DESC LIMIT 20`,
    [pattern],
  );
  // One hit per day, with a short window of text around the first match.
  const seen = new Map<string, JournalHit>();
  for (const { day, text } of rows) {
    if (seen.has(day)) continue;
    const at = Math.max(0, text.toLowerCase().indexOf(trimmed.toLowerCase()));
    // Start the window at a word boundary so it never opens mid-word ("…hings").
    let start = Math.max(0, at - 30);
    const space = text.indexOf(' ', start);
    if (start > 0 && space !== -1 && space < at) start = space + 1;
    const window = text.slice(start, at + trimmed.length + 60).replace(/\s+/g, ' ');
    seen.set(day, { day, snippet: `${start > 0 ? '…' : ''}${window}` });
  }
  return [...seen.values()];
}

export const writeCalendarFile =(path: string, contents: string) =>
  invoke<void>('write_calendar_file', { path, contents });
