import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, Download, ExternalLink, Eye, Folder as FolderIcon, FolderPlus, FolderUp, Folders, Paperclip, Pencil, Trash2 } from 'lucide-react';
import type { Attachment, DocumentFile, Folder, Item } from '../lib/types';
import * as db from '../lib/db';
import * as folderDb from '../lib/folders';
import { itemExport } from '../lib/exporting';
import { attachmentPreview, DOCUMENTS_OWNER } from '../lib/files';
import { Preview, previewKind } from './Preview';
import { FileIcon } from './FileIcon';
import { FolderSelect, NameInput, confirmDeleteFolder, folderCounts } from './folders/FolderParts';
import { DocumentPicker } from './folders/DocumentPicker';
import { exportWithNotice, importWithNotice, pickPaths } from './folders/transfer';

interface Props {
  item: Item;
  /** Bumped by the parent when files were added elsewhere (drag and drop). */
  refreshKey: number;
  /** What a file dragged from Explorer is over, to highlight the folder it would land in. */
  dropKey: string | null;
  /** Called after files are added or removed, so counts elsewhere refresh. */
  onChanged: () => void;
}

export function Attachments({ item, refreshKey, dropKey, onChanged }: Props) {
  const itemId = item.id;
  const place = useMemo(() => ({ kind: 'item' as const, id: itemId }), [itemId]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [pickingDocs, setPickingDocs] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, fo] = await Promise.all([db.listAttachments(itemId), folderDb.listFolders(place)]);
      setFiles(f);
      setFolders(fo);
    } catch (e) {
      setError(String(e));
    }
  }, [itemId, place]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const withRefresh = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await op();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      await load();
      onChanged();
    }
  };

  const add = async (what: 'files' | 'folder', folderId: number | null = null) => {
    const paths = await pickPaths(what, what === 'files' ? 'Attach files' : 'Attach folders');
    if (paths.length) await withRefresh(() => importWithNotice(place, paths, { folderId }));
  };

  const attachDocuments = (docs: DocumentFile[]) => {
    setPickingDocs(false);
    void withRefresh(async () => {
      const paths = await Promise.all(docs.map((d) =>
        invoke<string>('file_path', { area: 'documents', ownerId: DOCUMENTS_OWNER, storedName: d.stored_name })));
      await importWithNotice(place, paths);
    });
  };

  const remove = async (att: Attachment) => {
    const ok = await ask(`Remove "${att.original_name}" from this item? The stored copy will be deleted.`, {
      title: 'Remove attachment',
      kind: 'warning',
    });
    if (ok) await withRefresh(() => db.removeAttachment(att));
  };

  const known = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const folderOf = useCallback((a: Attachment) => (a.folder_id !== null && known.has(a.folder_id) ? a.folder_id : null), [known]);
  const counts = useMemo(() => folderCounts(folders, files.map(folderOf)), [folders, files, folderOf]);

  // Tree order (top-level files first, then each folder's contents), which is also the
  // order the preview's arrow keys walk through.
  const ordered = useMemo(() => {
    const out: Attachment[] = [];
    const walk = (parentId: number | null) => {
      out.push(...files.filter((f) => folderOf(f) === parentId));
      for (const f of folderDb.childrenOf(folders, parentId)) walk(f.id);
    };
    walk(null);
    return out;
  }, [files, folders, folderOf]);
  const previewFiles = useMemo(() => ordered.map(attachmentPreview), [ordered]);

  const openExternally = (att: Attachment) => attachmentPreview(att).openExternally().catch((e) => setError(String(e)));
  const canPreview = (att: Attachment) => previewKind({ name: att.original_name, mime: att.mime }) !== null;
  const activate = (att: Attachment) => {
    const index = ordered.indexOf(att);
    if (canPreview(att)) setPreviewIndex(index);
    else void openExternally(att);
  };

  const fileRow = (att: Attachment, depth: number) => {
    const previewable = canPreview(att);
    return (
      <li key={`f${att.id}`} className="group flex items-center gap-2.5 py-2 pr-3 hover:bg-surface-2" style={{ paddingLeft: 12 + depth * 18 }}>
        <FileIcon name={att.original_name} tinted className="shrink-0" />
        <button type="button" onClick={() => activate(att)}
          title={previewable ? 'Preview' : 'Open with default app'}
          className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline">
          {att.original_name}
        </button>
        <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(att.size)}</span>
        <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
          {previewable && (
            <button type="button" onClick={() => setPreviewIndex(ordered.indexOf(att))} title="Preview"
              className="rounded p-1 text-muted hover:text-ink"><Eye size={13} /></button>
          )}
          {folders.length > 0 && (
            <FolderSelect folders={folders} value={folderOf(att)} rootLabel="Not in a folder"
              onChange={(id) => void withRefresh(() => folderDb.setFileFolder(place, att.id, id))} />
          )}
          <button type="button" onClick={() => openExternally(att)} title="Open with default app"
            className="rounded p-1 text-muted hover:text-ink"><ExternalLink size={13} /></button>
          <button type="button" onClick={() => remove(att)} title="Remove"
            className="rounded p-1 text-muted hover:text-danger"><Trash2 size={13} /></button>
        </div>
      </li>
    );
  };

  const folderRows = (parentId: number | null, depth: number): ReactNode[] =>
    folderDb.childrenOf(folders, parentId).flatMap((f) => {
      const open = !collapsed.has(f.id);
      const n = counts.get(f.id) ?? 0;
      const isTarget = dropKey === `item:${itemId}:${f.id}`;
      const row = (
        <li key={`d${f.id}`} data-drop-item={itemId} data-drop-folder={f.id} data-drop-label={`${item.title} › ${f.name}`}
          className={`group flex items-center gap-2 py-2 pr-3 ${isTarget ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
          style={{ paddingLeft: 8 + depth * 18 }}>
          <button type="button" onClick={() => setCollapsed((s) => {
            const next = new Set(s);
            if (open) next.add(f.id);
            else next.delete(f.id);
            return next;
          })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <ChevronRight size={13} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
            <FolderIcon size={15} className="shrink-0 fill-accent-soft text-accent" />
            {editingId === f.id ? (
              <NameInput initial={f.name} onDone={(name) => {
                setEditingId(null);
                if (name && name !== f.name) void withRefresh(() => folderDb.renameFolder(f.id, name));
              }} />
            ) : (
              <span className="truncate text-[13px] font-medium text-ink">{f.name}</span>
            )}
          </button>
          <span className="shrink-0 text-xs text-muted tabular-nums">{n > 0 ? n : ''}</span>
          <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
            <button type="button" title="Attach files here" onClick={() => void add('files', f.id)}
              className="rounded p-1 text-muted hover:text-ink"><Paperclip size={13} /></button>
            <button type="button" title="Rename" onClick={() => setEditingId(f.id)}
              className="rounded p-1 text-muted hover:text-ink"><Pencil size={13} /></button>
            <FolderSelect folders={folders} value={f.parent_id} rootLabel="Top level" title="Move folder"
              exclude={folderDb.subtreeIds(folders, f.id)}
              onChange={(parent) => void withRefresh(() => folderDb.moveFolder(folders, f.id, parent))} />
            <button type="button" title="Export as a folder on your computer"
              onClick={() => void exportWithNotice(f.name, () => itemExport(item, f.id)).catch((e) => setError(String(e)))}
              className="rounded p-1 text-muted hover:text-ink"><Download size={13} /></button>
            <button type="button" title="Delete folder" className="rounded p-1 text-muted hover:text-danger"
              onClick={async () => {
                if (await confirmDeleteFolder(place, f)) void withRefresh(() => folderDb.deleteFolder(place, f.id));
              }}><Trash2 size={13} /></button>
          </div>
        </li>
      );
      if (!open) return [row];
      const inside = files.filter((a) => folderOf(a) === f.id);
      const empty = inside.length === 0 && folderDb.childrenOf(folders, f.id).length === 0;
      return [
        row,
        ...folderRows(f.id, depth + 1),
        ...inside.map((a) => fileRow(a, depth + 1)),
        ...(empty ? [<li key={`e${f.id}`} className="py-1.5 text-xs text-muted" style={{ paddingLeft: 30 + (depth + 1) * 18 }}>Empty. Drop files onto the folder.</li>] : []),
      ];
    });

  const iconButton = 'rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium tracking-wide text-muted uppercase">
          Attachments {files.length > 0 && <span className="normal-case">· {files.length}</span>}
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" title="New folder" disabled={busy} className={iconButton}
            onClick={() => void withRefresh(async () => setEditingId(await folderDb.createFolder(place, null, 'New folder')))}>
            <FolderPlus size={13} />
          </button>
          <button type="button" title="Attach a whole folder" disabled={busy} className={iconButton} onClick={() => void add('folder')}>
            <FolderUp size={13} />
          </button>
          <button type="button" title="Attach from Documents (CV, transcripts…)" disabled={busy} className={iconButton} onClick={() => setPickingDocs(true)}>
            <Folders size={13} />
          </button>
          <button type="button" onClick={() => void add('files')} disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent hover:bg-accent-soft disabled:opacity-50">
            <Paperclip size={12} /> {busy ? 'Copying…' : 'Attach files'}
          </button>
        </div>
      </div>

      {files.length > 0 || folders.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {folderRows(null, 0)}
          {files.filter((a) => folderOf(a) === null).map((a) => fileRow(a, 0))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-4 py-4 text-center text-xs text-muted">
          Drop files or folders here, or use Attach files. PDFs, photos, slides, anything.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {previewIndex !== null && previewFiles[previewIndex] && (
        <Preview files={previewFiles} index={previewIndex} onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)} />
      )}
      {pickingDocs && <DocumentPicker onPick={attachDocuments} onClose={() => setPickingDocs(false)} />}
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
