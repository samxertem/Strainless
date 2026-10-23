import type { DocumentFile } from './types';
import { db, likePattern } from './db';
import { DOCUMENTS_OWNER, deleteFile, guessMime, importFile } from './files';

// The Documents page: files not tied to a course or a task (CV, transcripts,
// master's and scholarship papers). Folders come from lib/folders.ts.

export async function listDocuments(): Promise<DocumentFile[]> {
  return (await db()).select<DocumentFile[]>('SELECT * FROM documents ORDER BY added_at DESC, id DESC');
}

export async function getDocument(id: number): Promise<DocumentFile | null> {
  return (await (await db()).select<DocumentFile[]>('SELECT * FROM documents WHERE id = $1', [id]))[0] ?? null;
}

export async function addDocuments(sourcePaths: string[], folderId: number | null = null): Promise<void> {
  const d = await db();
  for (const sourcePath of sourcePaths) {
    const f = await importFile('documents', DOCUMENTS_OWNER, sourcePath);
    await d.execute(
      'INSERT INTO documents (folder_id, original_name, stored_name, mime, size) VALUES ($1, $2, $3, $4, $5)',
      [folderId, f.original_name, f.stored_name, guessMime(f.original_name), f.size],
    );
  }
}

export async function deleteDocument(doc: DocumentFile): Promise<void> {
  const d = await db();
  await d.execute('DELETE FROM annotations WHERE file_ref = $1', [`document:${doc.id}`]);
  await d.execute('DELETE FROM ink_strokes WHERE file_ref = $1', [`document:${doc.id}`]);
  await d.execute('DELETE FROM documents WHERE id = $1', [doc.id]);
  await deleteFile('documents', DOCUMENTS_OWNER, doc.stored_name);
}

/** Documents whose name matches, for the search palette. */
export async function searchDocuments(query: string): Promise<DocumentFile[]> {
  if (!query.trim()) return [];
  return (await db()).select<DocumentFile[]>(
    `SELECT * FROM documents WHERE original_name LIKE $1 ESCAPE '\\' ORDER BY added_at DESC LIMIT 15`,
    [likePattern(query)],
  );
}
