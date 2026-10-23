// "Export as folder": writes a course, a task or a Documents folder to disk as a
// normal folder, with the same subfolders, so it can be zipped, shared or kept.

import { invoke } from '@tauri-apps/api/core';
import type { Attachment, Course, CourseTopic, DocumentFile, Folder, Item } from './types';
import { STATUS_LABELS } from './types';
import { db } from './db';
import { listCourseFiles, listCourseNotes, listCourseTaskFiles, listTopics } from './courses';
import { listDocuments } from './documents';
import { folderPath, listFolders, subtreeIds } from './folders';
import { DOCUMENTS_OWNER, type FileArea } from './files';

/** One file in an export: `path` is folder names plus file name. Either a stored file or text. */
export interface ExportEntry {
  path: string[];
  area?: FileArea;
  owner_id?: number;
  stored_name?: string;
  text?: string;
}

type StoredRow = { original_name: string; stored_name: string; folder_id: number | null };

/**
 * Entries for the files of one folder tree. `rootId` null = everything; files keep the
 * folder path below the root, under `prefix`.
 */
function folderEntries(
  rows: StoredRow[], folders: Folder[], rootId: number | null, area: FileArea, ownerId: number, prefix: string[] = [],
): ExportEntry[] {
  const inside = rootId === null ? null : subtreeIds(folders, rootId);
  const known = new Set(folders.map((f) => f.id));
  const depth = rootId === null ? 0 : folderPath(folders, rootId).length;
  return rows
    .filter((r) => inside === null || (r.folder_id !== null && inside.has(r.folder_id)))
    .map((r) => ({
      path: [
        ...prefix,
        ...(r.folder_id !== null && known.has(r.folder_id) ? folderPath(folders, r.folder_id).slice(depth).map((f) => f.name) : []),
        r.original_name,
      ],
      area,
      owner_id: ownerId,
      stored_name: r.stored_name,
    }));
}

const TOPIC_MARK = { todo: '[ ]', studying: '[~]', done: '[x]' } as const;

function topicsMarkdown(course: Course, topics: CourseTopic[]): string {
  const lines = [`# ${course.name}${course.title ? ` · ${course.title}` : ''}`, ''];
  if (course.instructor) lines.push(`Instructor: ${course.instructor}`, '');
  lines.push('## Topics', '', ...topics.map((t) => `- ${TOPIC_MARK[t.status]} ${t.title}`));
  for (const t of topics.filter((x) => x.notes_md.trim())) lines.push('', `### ${t.title}`, '', t.notes_md.trim());
  return `${lines.join('\n')}\n`;
}

function itemMarkdown(item: Item): string {
  const due = item.due_at ? (item.all_day ? item.due_at : new Date(item.due_at).toLocaleString('en-GB')) : null;
  return [
    `# ${item.title}`,
    '',
    item.course && `Course: ${item.course}`,
    due && `Due: ${due}`,
    `Status: ${STATUS_LABELS[item.status]}`,
    item.notes_md.trim() && `\n${item.notes_md.trim()}`,
  ].filter(Boolean).join('\n') + '\n';
}

/** Everything in a course: library (with folders), notes with their images, topics, task files. */
export async function courseExport(course: Course, onlyFolderId: number | null = null): Promise<ExportEntry[]> {
  const place = { kind: 'course' as const, id: course.id };
  const [files, folders] = await Promise.all([listCourseFiles(course.id), listFolders(place)]);
  if (onlyFolderId !== null) return folderEntries(files, folders, onlyFolderId, 'courses', course.id);

  const [topics, notes, taskFiles, hidden] = await Promise.all([
    listTopics(course.id),
    listCourseNotes(course.id),
    listCourseTaskFiles(course.name),
    (await db()).select<{ id: number; stored_name: string }[]>(
      'SELECT id, stored_name FROM course_files WHERE course_id = $1 AND hidden = 1', [course.id],
    ),
  ]);
  const entries = folderEntries(files, folders, null, 'courses', course.id, ['Library']);
  if (topics.length) entries.push({ path: ['Topics.md'], text: topicsMarkdown(course, topics) });

  // Notes point at their pasted images by id; in the export they point at Notes/images/<file>.
  const images = new Map(hidden.map((h) => [h.id, h.stored_name]));
  const used = new Set<number>();
  for (const note of notes) {
    const body = note.body_md.replace(/\(strainless-file:course_file\/(\d+)\)/g, (whole, id) => {
      const name = images.get(Number(id));
      if (!name) return whole;
      used.add(Number(id));
      return `(images/${encodeURI(name)})`;
    });
    entries.push({ path: ['Notes', `${note.title.trim() || 'Untitled note'}.md`], text: body });
  }
  for (const id of used) entries.push({ path: ['Notes', 'images', images.get(id)!], area: 'courses', owner_id: course.id, stored_name: images.get(id)! });

  // Files attached to the course's tasks, one folder per task.
  const byItem = new Map<number, typeof taskFiles>();
  for (const f of taskFiles) byItem.set(f.item_id, [...(byItem.get(f.item_id) ?? []), f]);
  for (const [itemId, list] of byItem) {
    const itemFolders = await listFolders({ kind: 'item', id: itemId });
    entries.push(...folderEntries(list, itemFolders, null, 'attachments', itemId, ['Tasks', list[0].item_title]));
  }
  return entries;
}

/** A task: its details as Task.md plus its attachments (or only one attachment folder). */
export async function itemExport(item: Item, onlyFolderId: number | null = null): Promise<ExportEntry[]> {
  const [files, folders] = await Promise.all([
    (await db()).select<Attachment[]>('SELECT * FROM attachments WHERE item_id = $1', [item.id]),
    listFolders({ kind: 'item', id: item.id }),
  ]);
  const entries = folderEntries(files, folders, onlyFolderId, 'attachments', item.id);
  if (onlyFolderId === null) entries.unshift({ path: ['Task.md'], text: itemMarkdown(item) });
  return entries;
}

/** A Documents folder with its subfolders, or every document when `folderId` is null. */
export async function documentsExport(folderId: number | null): Promise<ExportEntry[]> {
  const [docs, folders] = await Promise.all([listDocuments(), listFolders({ kind: 'documents' })]);
  return folderEntries(docs as (DocumentFile & StoredRow)[], folders, folderId, 'documents', DOCUMENTS_OWNER);
}

/** Writes `<dest>/<name>/…` (or `<name> (2)` if taken) and opens it. Returns the new folder's path. */
export const exportAsFolder = (dest: string, name: string, entries: ExportEntry[]) =>
  invoke<string>('export_folder', { dest, name, entries });
