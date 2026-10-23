// Search inside files. Each PDF page and PowerPoint slide is read once, in the
// background, into the file_text full-text index; search then finds the exact page.

import { db, toFtsQuery } from './db';
import { DOCUMENTS_OWNER, extensionOf, previewOfKind, readFile, type FileArea, type FileKind, type PreviewFile } from './files';

const INDEXED_EXTENSIONS = ['pdf', 'pptx'];
/** Pages per INSERT: few enough to stay well under SQLite's parameter limit. */
const ROWS_PER_INSERT = 50;

// Every file that still exists, as a file_ref, for clean-up.
const EXISTING_REFS = `SELECT 'course_file:' || id FROM course_files UNION ALL SELECT 'attachment:' || id FROM attachments
  UNION ALL SELECT 'document:' || id FROM documents`;
const indexedName = (column: string) => INDEXED_EXTENSIONS.map((e) => `lower(${column}) LIKE '%.${e}'`).join(' OR ');

interface PendingFile {
  ref: string;
  area: FileArea;
  owner_id: number;
  stored_name: string;
  original_name: string;
}

async function extractText(name: string, data: ArrayBuffer): Promise<string[]> {
  // Loaded on first use: the PDF and PowerPoint readers are large.
  if (extensionOf(name) === 'pdf') return (await import('./pdfjs')).readPdfText(data);
  return (await import('./pptx')).readPptxText(data);
}

async function indexFile(f: PendingFile): Promise<void> {
  const d = await db();
  let pages: string[];
  try {
    pages = await extractText(f.original_name, await readFile(f.area, f.owner_id, f.stored_name));
  } catch (e) {
    console.warn(`could not read ${f.original_name} for search`, e);
    await d.execute('INSERT OR REPLACE INTO file_text_status (file_ref, pages) VALUES ($1, -1)', [f.ref]);
    return;
  }
  // Rows from an earlier, interrupted attempt would otherwise show up twice.
  await d.execute('DELETE FROM file_text WHERE file_ref = $1', [f.ref]);
  // Some PDFs map symbols to control characters (a "+" read as \u0003); those would collide
  // with the highlight marks search puts around matched words, so they become spaces.
  const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const rows = pages.map((text, location) => ({ location, text: clean(text) })).filter((r) => r.text);
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + ROWS_PER_INSERT);
    await d.execute(
      `INSERT INTO file_text (file_ref, location, body) VALUES ${chunk.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(', ')}`,
      chunk.flatMap((r) => [f.ref, r.location, r.text]),
    );
  }
  await d.execute('INSERT OR REPLACE INTO file_text_status (file_ref, pages) VALUES ($1, $2)', [f.ref, pages.length]);
}

async function indexPass(): Promise<void> {
  const d = await db();
  // Text of deleted files goes too, so search never offers a file that's gone.
  await d.execute(`DELETE FROM file_text WHERE file_ref NOT IN (${EXISTING_REFS})`);
  await d.execute(`DELETE FROM file_text_status WHERE file_ref NOT IN (${EXISTING_REFS})`);

  // Smallest first, so most slides become searchable quickly and a big textbook comes last.
  const pending = await d.select<PendingFile[]>(
    `SELECT ref, area, owner_id, stored_name, original_name FROM (
       SELECT 'course_file:' || id AS ref, 'courses' AS area, course_id AS owner_id, stored_name, original_name, size
         FROM course_files WHERE hidden = 0 AND (${indexedName('original_name')})
       UNION ALL
       SELECT 'attachment:' || id, 'attachments', item_id, stored_name, original_name, size
         FROM attachments WHERE ${indexedName('original_name')}
       UNION ALL
       SELECT 'document:' || id, 'documents', ${DOCUMENTS_OWNER}, stored_name, original_name, size
         FROM documents WHERE ${indexedName('original_name')}
     ) WHERE ref NOT IN (SELECT file_ref FROM file_text_status)
     ORDER BY size`,
  );
  for (const [i, f] of pending.entries()) {
    setProgress({ done: i, total: pending.length });
    await indexFile(f);
    await new Promise((r) => setTimeout(r, 30)); // let the app breathe between files
  }
}

// ---------- background runner, with progress for the search box ----------

export interface IndexProgress {
  done: number;
  total: number;
}

let progress: IndexProgress | null = null;
const listeners = new Set<() => void>();
const setProgress = (p: IndexProgress | null) => {
  progress = p;
  listeners.forEach((fn) => fn());
};

/** For useSyncExternalStore: files still being read, or null when search is up to date. */
export const indexProgress = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => progress,
};

let running = false;
let again = false;

/** Reads any new files into the search index. Safe to call often: passes never overlap. */
export function indexNewFiles(): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        again = false;
        await indexPass();
      } while (again);
    } catch (e) {
      console.warn('search indexing stopped', e);
    } finally {
      running = false;
      setProgress(null);
    }
  })();
}

// ---------- searching ----------

interface TextRow {
  file_ref: string;
  location: number;
  snippet: string;
}

interface FileRow {
  id: number;
  owner_id: number;
  original_name: string;
  stored_name: string;
  mime: string | null;
  course_name: string | null;
}

/** A page or slide whose text matched. `snippet` has MARK_START/MARK_END around matched words. */
export interface FileTextHit {
  file: PreviewFile;
  location: number;
  snippet: string;
  courseName: string | null;
  segmentLabel: 'Page' | 'Slide';
}

const MAX_HITS = 15;
const MAX_HITS_PER_FILE = 3;

/** Pages and slides containing every word of the query, best matches first. */
export async function searchFileText(query: string): Promise<FileTextHit[]> {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const d = await db();
  const rows = await d.select<TextRow[]>(
    `SELECT file_ref, location, snippet(file_text, 2, char(2), char(3), '…', 12) AS snippet
       FROM file_text WHERE file_text MATCH $1 ORDER BY rank LIMIT 80`,
    [fts],
  );
  if (!rows.length) return [];

  const idsOf = (kind: string) => [...new Set(rows.filter((r) => r.file_ref.startsWith(`${kind}:`)).map((r) => Number(r.file_ref.split(':')[1])))];
  const courseIds = idsOf('course_file');
  const attachmentIds = idsOf('attachment');
  const documentIds = idsOf('document');
  // Ids are numbers parsed above, never user text, so listing them inline is safe.
  const [courseFiles, attachments, documents] = await Promise.all([
    courseIds.length
      ? d.select<FileRow[]>(
          `SELECT f.id, f.course_id AS owner_id, f.original_name, f.stored_name, f.mime, c.name AS course_name
             FROM course_files f JOIN courses c ON c.id = f.course_id WHERE f.id IN (${courseIds.join(',')})`,
        )
      : [],
    attachmentIds.length
      ? d.select<FileRow[]>(
          `SELECT a.id, a.item_id AS owner_id, a.original_name, a.stored_name, a.mime, i.course AS course_name
             FROM attachments a JOIN items i ON i.id = a.item_id WHERE a.id IN (${attachmentIds.join(',')})`,
        )
      : [],
    documentIds.length
      ? d.select<FileRow[]>(
          `SELECT id, ${DOCUMENTS_OWNER} AS owner_id, original_name, stored_name, mime, NULL AS course_name
             FROM documents WHERE id IN (${documentIds.join(',')})`,
        )
      : [],
  ]);
  const files = new Map<string, FileRow & { kind: FileKind }>([
    ...courseFiles.map((f) => [`course_file:${f.id}`, { ...f, kind: 'course_file' as const }] as const),
    ...attachments.map((f) => [`attachment:${f.id}`, { ...f, kind: 'attachment' as const }] as const),
    ...documents.map((f) => [`document:${f.id}`, { ...f, kind: 'document' as const }] as const),
  ]);

  const perFile = new Map<string, number>();
  const hits: FileTextHit[] = [];
  for (const r of rows) {
    const f = files.get(r.file_ref);
    const count = perFile.get(r.file_ref) ?? 0;
    if (!f || count >= MAX_HITS_PER_FILE) continue;
    perFile.set(r.file_ref, count + 1);
    const base = { id: f.id, original_name: f.original_name, stored_name: f.stored_name, mime: f.mime };
    hits.push({
      file: previewOfKind(f.kind, base, f.owner_id),
      location: r.location,
      snippet: r.snippet,
      courseName: f.course_name,
      segmentLabel: extensionOf(f.original_name) === 'pdf' ? 'Page' : 'Slide',
    });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}
