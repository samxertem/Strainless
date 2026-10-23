import { useCallback, useEffect, useMemo, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { Download, ExternalLink, Folders, FolderPlus, FolderUp, Search, Trash2, Upload } from 'lucide-react';
import type { DocumentFile, Folder } from '../lib/types';
import * as documents from '../lib/documents';
import * as folderDb from '../lib/folders';
import { documentsExport } from '../lib/exporting';
import { documentPreview, fileType } from '../lib/files';
import { TYPE_LABEL } from './FileIcon';
import { Preview } from './Preview';
import { formatBytes } from './Attachments';
import { Breadcrumb, FileCard, FolderGrid, FolderSelect, ToolbarButton, folderCounts } from './folders/FolderParts';
import { exportWithNotice, importWithNotice, pickPaths } from './folders/transfer';

interface Props {
  folderId: number | null;
  onFolder: (id: number | null) => void;
  refreshKey: number;
  dropKey: string | null;
  onError: (message: string) => void;
}

const PLACE = { kind: 'documents' } as const;
const added = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Files that aren't for one course: CV, transcripts, certificates, application papers. */
export function DocumentsView({ folderId, onFolder, refreshKey, dropKey, onError }: Props) {
  const [docs, setDocs] = useState<DocumentFile[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [previewAt, setPreviewAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([documents.listDocuments(), folderDb.listFolders(PLACE)]);
      setDocs(d);
      setFolders(f);
    } catch (e) {
      onError(String(e));
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // The open folder was deleted (here or elsewhere): go back to the top.
  useEffect(() => {
    if (docs !== null && folderId !== null && !folders.some((f) => f.id === folderId)) onFolder(null);
  }, [docs, folders, folderId, onFolder]);

  const act = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch (e) {
      onError(String(e));
    }
    await load();
  };

  const add = async (what: 'files' | 'folder') => {
    const paths = await pickPaths(what, what === 'files' ? 'Add documents' : 'Add folders');
    if (paths.length) void act(() => importWithNotice(PLACE, paths, { folderId }));
  };
  const newFolder = () => void act(async () => setEditingId(await folderDb.createFolder(PLACE, folderId, 'New folder')));
  const exportFolder = (f: Folder | null) =>
    exportWithNotice(f ? f.name : 'Documents', () => documentsExport(f?.id ?? null)).catch((e) => onError(String(e)));

  const known = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const folderOf = useCallback((d: DocumentFile) => (d.folder_id !== null && known.has(d.folder_id) ? d.folder_id : null), [known]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (docs ?? []).filter((d) => (q ? d.original_name.toLowerCase().includes(q) : folderOf(d) === folderId))
      .sort((a, b) => folderDb.byName({ name: a.original_name }, { name: b.original_name })),
    [docs, q, folderId, folderOf],
  );
  const previews = useMemo(() => shown.map(documentPreview), [shown]);
  const counts = useMemo(() => folderCounts(folders, (docs ?? []).map(folderOf)), [folders, docs, folderOf]);

  if (docs === null) return null;
  const empty = docs.length === 0 && folders.length === 0;
  const pathLabel = (id: number | null) => ['Documents', ...folderDb.folderPath(folders, id).map((f) => f.name)].join(' › ');
  const isDropTarget = dropKey === `docs:${folderId ?? ''}`;
  const current = folderId === null ? null : folders.find((f) => f.id === folderId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Documents</h1>
        <p className="mt-0.5 text-sm text-muted">Your CV, transcripts, certificates and application papers. Anything that isn’t for one course.</p>
      </header>

      <div data-drop-docs={folderId ?? ''} data-drop-label={pathLabel(folderId)}
        className={`-m-3 min-h-64 rounded-2xl p-3 transition-shadow ${isDropTarget ? 'bg-accent-soft/60 shadow-[inset_0_0_0_2px_var(--accent)]' : ''}`}>
        {empty ? (
          <div className="rounded-2xl border-2 border-dashed border-line px-6 py-14 text-center text-muted">
            <button type="button" onClick={() => void add('files')} className="mx-auto flex flex-col items-center gap-2 hover:text-ink">
              <Folders size={28} strokeWidth={1.5} />
              <span className="text-sm font-medium">Drop documents or whole folders here</span>
              <span className="text-xs">or click to choose files. Make folders like “Masters”, “Scholarships” or “ÇAP”.</span>
            </button>
            <div className="mt-4 flex justify-center gap-4 text-xs">
              <button type="button" onClick={newFolder} className="text-accent hover:underline">New folder</button>
              <button type="button" onClick={() => void add('folder')} className="text-accent hover:underline">Add a folder from your computer</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
                <Search size={14} className="text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a document in any folder…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70" />
              </div>
              <ToolbarButton title="New folder" onClick={newFolder}><FolderPlus size={15} /></ToolbarButton>
              <ToolbarButton title="Add a folder from your computer" onClick={() => void add('folder')}><FolderUp size={15} /></ToolbarButton>
              <ToolbarButton title={current ? `Export “${current.name}” as a folder` : 'Export all documents as a folder'}
                onClick={() => void exportFolder(current)}><Download size={15} /></ToolbarButton>
              <button type="button" onClick={() => void add('files')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90">
                <Upload size={14} /> Add files
              </button>
            </div>

            {!q && (
              <>
                <Breadcrumb rootLabel="Documents" folders={folders} currentId={folderId} onOpen={onFolder} />
                <FolderGrid place={PLACE} folders={folders} parentId={folderId} rootLabel="Documents (top level)" counts={counts}
                  editingId={editingId} onEditing={setEditingId} onOpen={onFolder} act={act}
                  onExport={(f) => void exportFolder(f)}
                  dropAttrs={(f) => ({ 'data-drop-docs': String(f.id), 'data-drop-label': pathLabel(f.id) })}
                  isDropTarget={(f) => dropKey === `docs:${f.id}`} />
              </>
            )}

            {shown.length === 0 && (q || folderDb.childrenOf(folders, folderId).length === 0) && (
              <p className="py-8 text-center text-sm text-muted">
                {q ? 'No documents match.' : 'This folder is empty. Drop files here, or use Add files.'}
              </p>
            )}
            {shown.length > 0 && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {shown.map((doc, i) => {
                  const where = q && folderOf(doc) !== null ? `${folderDb.folderPath(folders, folderOf(doc)).map((f) => f.name).join(' / ')} · ` : '';
                  return (
                    <FileCard key={doc.id} name={doc.original_name} preview={previews[i]} onOpen={() => setPreviewAt(i)}
                      subtitle={`${where}${TYPE_LABEL[fileType(doc.original_name)]} · ${formatBytes(doc.size)} · ${added.format(new Date(doc.added_at))}`}
                      actions={<>
                        {folders.length > 0 && (
                          <FolderSelect folders={folders} value={folderOf(doc)} rootLabel="Documents (top level)"
                            onChange={(id) => void act(() => folderDb.setFileFolder(PLACE, doc.id, id))} />
                        )}
                        <button type="button" title="Open with default app" onClick={() => previews[i].openExternally().catch((e) => onError(String(e)))}
                          className="rounded p-1 text-muted hover:text-ink"><ExternalLink size={13} /></button>
                        <button type="button" title="Delete" className="rounded p-1 text-muted hover:text-danger"
                          onClick={async () => {
                            const ok = await ask(`Delete “${doc.original_name}”? Its highlights go too.`, { title: 'Delete document', kind: 'warning' });
                            if (ok) void act(() => documents.deleteDocument(doc));
                          }}><Trash2 size={13} /></button>
                      </>} />
                  );
                })}
              </div>
            )}
            <p className="mt-6 text-center text-xs text-muted">Tip: drag files or whole folders from Explorer or Finder onto this page, or onto a folder.</p>
          </>
        )}
      </div>

      {previewAt !== null && previews[previewAt] && (
        <Preview files={previews} index={previewAt} onIndexChange={setPreviewAt} onClose={() => setPreviewAt(null)} />
      )}
    </div>
  );
}
