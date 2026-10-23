import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Attachment, CourseFile, DocumentFile } from './types';

/** Storage areas on disk: attachments/<item id>/…, courses/<course id>/… and documents/0/… */
export type FileArea = 'attachments' | 'courses' | 'documents';

/** Documents all live in one folder on disk; their folders exist only in the database. */
export const DOCUMENTS_OWNER = 0;

export interface StoredFile {
  stored_name: string;
  original_name: string;
  size: number;
}

export const importFile = (area: FileArea, ownerId: number, sourcePath: string) =>
  invoke<StoredFile>('import_file', { area, ownerId, sourcePath });

/** Saves in-memory bytes (a pasted screenshot). Sent as a raw body, not a JSON number array. */
export const importBytes = (area: FileArea, ownerId: number, name: string, bytes: Uint8Array) =>
  invoke<StoredFile>('import_bytes', bytes, {
    headers: { 'x-area': area, 'x-owner': String(ownerId), 'x-name': name },
  });

export const fileUrl = async (area: FileArea, ownerId: number, storedName: string) =>
  convertFileSrc(await invoke<string>('file_path', { area, ownerId, storedName }));

export const readFile = (area: FileArea, ownerId: number, storedName: string) =>
  invoke<ArrayBuffer>('read_file', { area, ownerId, storedName });

export const openFile = (area: FileArea, ownerId: number, storedName: string) =>
  invoke<void>('open_file', { area, ownerId, storedName });

export const deleteFile = (area: FileArea, ownerId: number, storedName: string) =>
  invoke<void>('delete_file', { area, ownerId, storedName });

export const deleteOwnerFiles = (area: FileArea, ownerId: number) =>
  invoke<void>('delete_owner_files', { area, ownerId });

/** A file inside a picked or dropped folder; `folders` runs from that folder down to the file. */
export interface ScannedFile {
  path: string;
  folders: string[];
  name: string;
  size: number;
}

/** Lists files under the given paths (folders recursively), skipping desktop.ini and the like. */
export const scanPaths = (paths: string[]) =>
  invoke<{ files: ScannedFile[]; folders: string[][] }>('scan_paths', { paths });

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
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  zip: 'application/zip',
  txt: 'text/plain',
  md: 'text/markdown',
};

export const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
export const guessMime = (name: string): string | null => MIME_BY_EXT[extensionOf(name)] ?? null;

/**
 * Everything the preview needs to show a file, whichever table it came from.
 * `ref` identifies the file for highlights: "attachment:<id>", "course_file:<id>" or "document:<id>".
 */
export interface PreviewFile {
  ref: string;
  name: string;
  mime: string | null;
  load: () => Promise<ArrayBuffer>;
  url: () => Promise<string>;
  openExternally: () => Promise<void>;
}

export function attachmentPreview(att: Pick<Attachment, 'id' | 'item_id' | 'original_name' | 'stored_name' | 'mime'>): PreviewFile {
  return {
    ref: `attachment:${att.id}`,
    name: att.original_name,
    mime: att.mime,
    load: () => readFile('attachments', att.item_id, att.stored_name),
    url: () => fileUrl('attachments', att.item_id, att.stored_name),
    openExternally: () => openFile('attachments', att.item_id, att.stored_name),
  };
}

export function courseFilePreview(f: Pick<CourseFile, 'id' | 'course_id' | 'original_name' | 'stored_name' | 'mime'>): PreviewFile {
  return {
    ref: `course_file:${f.id}`,
    name: f.original_name,
    mime: f.mime,
    load: () => readFile('courses', f.course_id, f.stored_name),
    url: () => fileUrl('courses', f.course_id, f.stored_name),
    openExternally: () => openFile('courses', f.course_id, f.stored_name),
  };
}

export function documentPreview(f: Pick<DocumentFile, 'id' | 'original_name' | 'stored_name' | 'mime'>): PreviewFile {
  return {
    ref: `document:${f.id}`,
    name: f.original_name,
    mime: f.mime,
    load: () => readFile('documents', DOCUMENTS_OWNER, f.stored_name),
    url: () => fileUrl('documents', DOCUMENTS_OWNER, f.stored_name),
    openExternally: () => openFile('documents', DOCUMENTS_OWNER, f.stored_name),
  };
}

/** Which table a file_ref points into: 'course_file:3' → 'course_file'. */
export type FileKind = 'course_file' | 'attachment' | 'document';

/** The preview of a file known by its kind (starred quotes, search hits). `ownerId` is the course or item id. */
export function previewOfKind(
  kind: FileKind, f: Pick<DocumentFile, 'id' | 'original_name' | 'stored_name' | 'mime'>, ownerId: number,
): PreviewFile {
  if (kind === 'course_file') return courseFilePreview({ ...f, course_id: ownerId });
  if (kind === 'attachment') return attachmentPreview({ ...f, item_id: ownerId });
  return documentPreview(f);
}

export type FileType = 'pdf' | 'slides' | 'doc' | 'sheet' | 'image' | 'code' | 'archive' | 'other';

const TYPE_BY_EXT: Record<string, FileType> = {
  pdf: 'pdf',
  ppt: 'slides', pptx: 'slides', key: 'slides', odp: 'slides',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc',
  xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', ods: 'sheet', csv: 'sheet',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', heic: 'image', bmp: 'image', tif: 'image', tiff: 'image',
  py: 'code', m: 'code', c: 'code', cpp: 'code', h: 'code', java: 'code', js: 'code', ts: 'code',
  ipynb: 'code', vhd: 'code', v: 'code', sv: 'code', asm: 'code', json: 'code', sql: 'code', r: 'code',
  zip: 'archive', rar: 'archive', '7z': 'archive',
};

export const fileType = (name: string): FileType => TYPE_BY_EXT[extensionOf(name)] ?? 'other';
