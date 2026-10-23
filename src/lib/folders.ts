// Folders for files, in three places: the Documents page, each course library and
// each task's attachments. Folders are rows only; files never move on disk.

import type { Folder, FolderPlace } from './types';
import { addAttachments, db, removeAttachment } from './db';
import { addCourseFiles, deleteCourseFile, listCourses, listTopics } from './courses';
import { addDocuments, deleteDocument } from './documents';
import { scanPaths } from './files';
import type { Attachment, CourseFile, DocumentFile } from './types';

const FILE_TABLE = { documents: 'documents', course: 'course_files', item: 'attachments' } as const;

/** The WHERE clause picking a place's folders, with its parameters. */
function ownedBy(place: FolderPlace): [string, number[]] {
  if (place.kind === 'course') return ['course_id = $1', [place.id]];
  if (place.kind === 'item') return ['item_id = $1', [place.id]];
  return ['course_id IS NULL AND item_id IS NULL', []];
}

/** "Week 2" before "Week 10", and case or accents never split the order. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);

export async function listFolders(place: FolderPlace): Promise<Folder[]> {
  const [where, params] = ownedBy(place);
  const rows = await (await db()).select<Folder[]>(
    `SELECT id, course_id, item_id, parent_id, name FROM folders WHERE ${where}`,
    params,
  );
  return rows.sort(byName);
}

const sameName = (a: string, b: string) => collator.compare(a.trim(), b.trim()) === 0;

/** Creates a folder; a name already used next to it gets " (2)", like Explorer. Returns the id. */
export async function createFolder(place: FolderPlace, parentId: number | null, name: string): Promise<number> {
  const siblings = (await listFolders(place)).filter((f) => f.parent_id === parentId);
  const base = name.trim() || 'New folder';
  let unique = base;
  for (let n = 2; siblings.some((f) => sameName(f.name, unique)); n++) unique = `${base} (${n})`;
  const r = await (await db()).execute(
    'INSERT INTO folders (course_id, item_id, parent_id, name) VALUES ($1, $2, $3, $4)',
    [place.kind === 'course' ? place.id : null, place.kind === 'item' ? place.id : null, parentId, unique],
  );
  return r.lastInsertId as number;
}

export async function renameFolder(id: number, name: string): Promise<void> {
  if (!name.trim()) return;
  await (await db()).execute('UPDATE folders SET name = $1 WHERE id = $2', [name.trim(), id]);
}

/** Moves a folder under another one (null = top level). A folder can't go inside itself. */
export async function moveFolder(folders: Folder[], id: number, parentId: number | null): Promise<void> {
  if (parentId !== null && subtreeIds(folders, id).has(parentId)) throw new Error('A folder can’t be moved inside itself.');
  await (await db()).execute('UPDATE folders SET parent_id = $1 WHERE id = $2', [parentId, id]);
}

/** Puts a file in a folder (null = top level). */
export async function setFileFolder(place: FolderPlace, fileId: number, folderId: number | null): Promise<void> {
  await (await db()).execute(`UPDATE ${FILE_TABLE[place.kind]} SET folder_id = $1 WHERE id = $2`, [folderId, fileId]);
}

const SUBTREE = `WITH RECURSIVE sub(id) AS (
  SELECT $1 UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
) SELECT id FROM sub`;

/** How many files a folder holds, counting its subfolders. */
export async function countFolderFiles(place: FolderPlace, id: number): Promise<number> {
  const rows = await (await db()).select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${FILE_TABLE[place.kind]} WHERE folder_id IN (${SUBTREE})`,
    [id],
  );
  return rows[0].n;
}

/** Deletes a folder, its subfolders and every file in them, highlights and drawings included. */
export async function deleteFolder(place: FolderPlace, id: number): Promise<void> {
  const d = await db();
  const rows = await d.select<(CourseFile & Attachment & DocumentFile)[]>(
    `SELECT * FROM ${FILE_TABLE[place.kind]} WHERE folder_id IN (${SUBTREE})`,
    [id],
  );
  for (const row of rows) {
    if (place.kind === 'course') await deleteCourseFile(row);
    else if (place.kind === 'item') await removeAttachment(row);
    else await deleteDocument(row);
  }
  await d.execute('DELETE FROM folders WHERE id = $1', [id]); // subfolders cascade
}

// ---------- tree helpers ----------

/** Folders directly inside `parentId` (null = top level), by name. */
export const childrenOf = (folders: Folder[], parentId: number | null) =>
  folders.filter((f) => f.parent_id === parentId).sort(byName);

/** The folder and everything inside it. */
export function subtreeIds(folders: Folder[], id: number): Set<number> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id !== null && ids.has(f.parent_id) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** From the top level down to the folder: [Masters, Germany, TU Munich]. */
export function folderPath(folders: Folder[], id: number | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  for (let f = id === null ? undefined : byId.get(id); f && path.length < 50; f = f.parent_id === null ? undefined : byId.get(f.parent_id)) {
    path.unshift(f);
  }
  return path;
}

/** Every folder in tree order with its depth, for "Move to…" lists. */
export function folderTree(folders: Folder[], exclude?: Set<number>): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const f of childrenOf(folders, parentId)) {
      if (exclude?.has(f.id)) continue;
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ---------- adding files and whole folders from disk ----------

export interface ImportResult {
  added: number;
  /** Already in this place (same name and size), so not copied again. */
  skipped: number;
  folders: number;
  failed: string[];
}

/** Letters and digits only, lower case: "CE 477 – Signals" → "ce477signals". */
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** "Week 1" names "Week 1 · Intro" but not "Week 10 · Laplace". Exported for tests. */
export function namesTopic(folderName: string, topicTitle: string): boolean {
  const name = key(folderName);
  const title = key(topicTitle);
  return name.length > 0 && title.startsWith(name) && !/\d/.test(title[name.length] ?? '');
}

/**
 * Copies files and whole folders (with their subfolders) into a place. Files already
 * there with the same name and size are skipped, so adding a newer download of the
 * same folder only brings in what's new; folders with the same name are reused.
 * In a course, a folder named after the course itself ("CE 477 - Signals") is opened
 * rather than recreated, and files in a folder named like a topic ("Week 3") are
 * filed under that topic.
 */
export async function importPaths(
  place: FolderPlace,
  paths: string[],
  opts: { folderId?: number | null; topicId?: number | null; onProgress?: (done: number, total: number) => void } = {},
): Promise<ImportResult> {
  const d = await db();
  const scan = await scanPaths(paths);
  const result: ImportResult = { added: 0, skipped: 0, folders: 0, failed: [] };

  const course = place.kind === 'course' ? (await listCourses()).find((c) => c.id === place.id) : undefined;
  const topics = course ? await listTopics(course.id) : [];
  const courseKey = course ? key(course.name) : '';
  const unwrap = (chain: string[]) => {
    const top = chain[0] === undefined ? '' : key(chain[0]);
    const isCourseFolder = courseKey !== '' && top.startsWith(courseKey) && !/\d/.test(top[courseKey.length] ?? '');
    return isCourseFolder ? chain.slice(1) : chain;
  };
  const topicFor = (chain: string[]) => {
    if (opts.topicId != null) return opts.topicId;
    for (const name of [...chain].reverse()) {
      const topic = topics.find((t) => namesTopic(name, t.title));
      if (topic) return topic.id;
    }
    return null;
  };

  // Folders by parent and name, so re-adding a folder fills the existing one.
  let folders = await listFolders(place);
  const ensureFolder = async (chain: string[]): Promise<number | null> => {
    let parent = opts.folderId ?? null;
    for (const name of chain) {
      const existing = folders.find((f) => f.parent_id === parent && sameName(f.name, name));
      if (existing) {
        parent = existing.id;
      } else {
        const id = await createFolder(place, parent, name);
        folders = [...folders, { id, course_id: null, item_id: null, parent_id: parent, name }];
        result.folders++;
        parent = id;
      }
    }
    return parent;
  };
  // Folders that are empty on disk are made now; the rest only once a new file goes in,
  // so adding the same download again doesn't leave empty folders behind.
  const prefixOf = (chain: string[], of: string[]) => chain.length <= of.length && chain.every((n, i) => n === of[i]);
  for (const chain of scan.folders) {
    if (!scan.files.some((f) => prefixOf(chain, f.folders))) await ensureFolder(unwrap(chain));
  }

  const existing = await d.select<{ original_name: string; size: number }[]>(
    place.kind === 'course' ? 'SELECT original_name, size FROM course_files WHERE course_id = $1 AND hidden = 0'
    : place.kind === 'item' ? 'SELECT original_name, size FROM attachments WHERE item_id = $1'
    : 'SELECT original_name, size FROM documents',
    place.kind === 'documents' ? [] : [place.id],
  );
  const seen = new Set(existing.map((f) => `${f.original_name.toLowerCase()}|${f.size}`));

  for (const [i, file] of scan.files.entries()) {
    opts.onProgress?.(i, scan.files.length);
    const fileKey = `${file.name.toLowerCase()}|${file.size}`;
    if (seen.has(fileKey)) {
      result.skipped++;
      continue;
    }
    const chain = unwrap(file.folders);
    try {
      const folderId = await ensureFolder(chain);
      if (place.kind === 'course') await addCourseFiles(place.id, [file.path], topicFor(chain), folderId);
      else if (place.kind === 'item') await addAttachments(place.id, [file.path], folderId);
      else await addDocuments([file.path], folderId);
      seen.add(fileKey);
      result.added++;
    } catch (e) {
      result.failed.push(`${file.name}: ${e}`);
    }
  }
  return result;
}

/** "Added 12 files in 3 folders · 4 were already here", for a notice after adding. */
export function describeImport(r: ImportResult): string {
  const files = `${r.added} file${r.added === 1 ? '' : 's'}`;
  const parts = [r.folders > 0 ? `Added ${files} in ${r.folders} new folder${r.folders === 1 ? '' : 's'}` : `Added ${files}`];
  if (r.skipped > 0) parts.push(`${r.skipped} ${r.skipped === 1 ? 'was' : 'were'} already here`);
  if (r.failed.length > 0) parts.push(`${r.failed.length} couldn’t be copied (${r.failed.slice(0, 2).join('; ')})`);
  return parts.join(' · ');
}
