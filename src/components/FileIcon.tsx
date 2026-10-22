import { File, FileArchive, FileCode, FileSpreadsheet, FileText, Image, Presentation } from 'lucide-react';
import { fileType, type FileType } from '../lib/files';

const ICONS: Record<FileType, typeof File> = {
  pdf: FileText,
  slides: Presentation,
  doc: FileText,
  sheet: FileSpreadsheet,
  image: Image,
  code: FileCode,
  archive: FileArchive,
  other: File,
};

/** Soft tints per type, so a library of mixed files is scannable at a glance. */
export const TYPE_TINT: Record<FileType, string> = {
  pdf: '#c98a7a',
  slides: '#d8a36e',
  doc: '#7c9cd6',
  sheet: '#6fae8f',
  image: '#c290b3',
  code: '#8e86c9',
  archive: '#9aa3ad',
  other: '#9aa3ad',
};

export const TYPE_LABEL: Record<FileType, string> = {
  pdf: 'PDF',
  slides: 'Slides',
  doc: 'Document',
  sheet: 'Spreadsheet',
  image: 'Image',
  code: 'Code',
  archive: 'Archive',
  other: 'File',
};

export function FileIcon({ name, size = 16, tinted = false, className = '' }: { name: string; size?: number; tinted?: boolean; className?: string }) {
  const type = fileType(name);
  const Icon = ICONS[type];
  return <Icon size={size} className={className} style={tinted ? { color: TYPE_TINT[type] } : undefined} />;
}
