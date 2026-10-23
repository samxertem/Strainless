import { open } from '@tauri-apps/plugin-dialog';
import type { FolderPlace } from '../../lib/types';
import { describeImport, importPaths } from '../../lib/folders';
import { dismissNotice, showNotice } from '../../lib/notice';
import { exportAsFolder, type ExportEntry } from '../../lib/exporting';
import { indexNewFiles } from '../../lib/fileText';

/** Opens the system picker for files or folders. Returns [] when cancelled. */
export async function pickPaths(what: 'files' | 'folder', title: string): Promise<string[]> {
  const picked = await open({ multiple: true, directory: what === 'folder', title });
  return !picked ? [] : Array.isArray(picked) ? picked : [picked];
}

/** Copies files and folders in, showing progress and then what happened in the notice line. */
export async function importWithNotice(
  place: FolderPlace,
  paths: string[],
  opts: { folderId?: number | null; topicId?: number | null } = {},
): Promise<void> {
  if (paths.length === 0) return;
  showNotice('Copying…', { busy: true });
  try {
    const result = await importPaths(place, paths, {
      ...opts,
      onProgress: (done, total) => total > 3 && showNotice(`Copying ${done + 1} of ${total}…`, { busy: true }),
    });
    showNotice(describeImport(result));
    if (result.added > 0) indexNewFiles(); // make new PDFs and slides searchable
  } catch (e) {
    dismissNotice();
    throw e;
  }
}

/**
 * Builds the export, asks where to put it, writes it and opens the new folder.
 * `build` runs first, so an empty course says so before any dialog appears.
 */
export async function exportWithNotice(name: string, build: () => Promise<ExportEntry[]>): Promise<void> {
  const entries = await build();
  if (entries.length === 0) {
    showNotice(`“${name}” has no files or notes to export yet.`);
    return;
  }
  const dest = await open({ directory: true, title: `Export “${name}” to…` });
  if (!dest || Array.isArray(dest)) return;
  showNotice(`Exporting ${entries.length} file${entries.length === 1 ? '' : 's'}…`, { busy: true });
  try {
    const path = await exportAsFolder(dest, name, entries);
    showNotice(`Exported to ${path}`);
  } catch (e) {
    dismissNotice();
    throw e;
  }
}
