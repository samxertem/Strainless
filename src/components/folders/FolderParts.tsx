import { useEffect, useState, type ReactNode } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { ChevronRight, Download, Folder as FolderIcon, FolderInput, Pencil, Trash2 } from 'lucide-react';
import type { Folder, FolderPlace } from '../../lib/types';
import * as folderDb from '../../lib/folders';
import { fileType, type PreviewFile } from '../../lib/files';
import { FileIcon, TYPE_TINT } from '../FileIcon';

/** Files per folder, counting what's in subfolders too. */
export function folderCounts(folders: Folder[], fileFolderIds: (number | null)[]): Map<number, number> {
  const parent = new Map(folders.map((f) => [f.id, f.parent_id]));
  const counts = new Map<number, number>();
  for (const id of fileFolderIds) {
    for (let at = id, hops = 0; at !== null && at !== undefined && hops < 50; at = parent.get(at) ?? null, hops++) {
      counts.set(at, (counts.get(at) ?? 0) + 1);
    }
  }
  return counts;
}

/** Library › Week 1 › Slides. Shown only inside a folder. */
export function Breadcrumb({ rootLabel, folders, currentId, onOpen }: {
  rootLabel: string; folders: Folder[]; currentId: number | null; onOpen: (id: number | null) => void;
}) {
  if (currentId === null) return null;
  const path = folderDb.folderPath(folders, currentId);
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm">
      <button type="button" onClick={() => onOpen(null)} className="rounded px-1 text-muted hover:text-ink">{rootLabel}</button>
      {path.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1">
          <ChevronRight size={13} className="text-muted/70" />
          {i === path.length - 1 ? (
            <span className="px-1 font-medium text-ink">{f.name}</span>
          ) : (
            <button type="button" onClick={() => onOpen(f.id)} className="rounded px-1 text-muted hover:text-ink">{f.name}</button>
          )}
        </span>
      ))}
    </nav>
  );
}

/** A hidden <select> over an icon: pick where a file or folder should go. */
export function FolderSelect({ folders, value, onChange, exclude, rootLabel, title = 'Move to folder' }: {
  folders: Folder[]; value: number | null; onChange: (id: number | null) => void;
  exclude?: Set<number>; rootLabel: string; title?: string;
}) {
  return (
    <label title={title} className="relative rounded p-1 text-muted hover:text-ink">
      <FolderInput size={13} />
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="absolute inset-0 cursor-pointer opacity-0">
        <option value="">{rootLabel}</option>
        {folderDb.folderTree(folders, exclude).map(({ folder, depth }) => (
          <option key={folder.id} value={folder.id}>{' '.repeat(depth)}{folder.name}</option>
        ))}
      </select>
    </label>
  );
}

/** Edits a folder name in place: Enter saves, Escape or an empty name cancels. */
export function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(initial);
  return (
    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation(); // Escape here shouldn't also close the panel behind
        if (e.key === 'Enter') onDone(name.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
      onBlur={() => onDone(name.trim() || null)}
      className="w-full min-w-0 rounded border border-accent bg-surface px-1.5 py-0.5 text-[13px] text-ink outline-none" />
  );
}

/** Asks first when a folder holds files; an empty folder just goes. */
export async function confirmDeleteFolder(place: FolderPlace, folder: Folder): Promise<boolean> {
  const n = await folderDb.countFolderFiles(place, folder.id);
  if (n === 0) return true;
  return ask(`Delete the folder “${folder.name}” and the ${n} file${n === 1 ? '' : 's'} in it? Their highlights and drawings go too.`, {
    title: 'Delete folder', kind: 'warning',
  });
}

interface GridProps {
  place: FolderPlace;
  folders: Folder[];
  parentId: number | null;
  rootLabel: string;
  counts: Map<number, number>;
  editingId: number | null;
  onEditing: (id: number | null) => void;
  onOpen: (id: number) => void;
  onExport: (folder: Folder) => void;
  /** Runs a change, reports errors and reloads. */
  act: (op: () => Promise<unknown>) => Promise<void>;
  /** data-drop-* attributes so files dragged from Explorer land in that folder. */
  dropAttrs: (folder: Folder) => Record<string, string>;
  isDropTarget: (folder: Folder) => boolean;
}

/** The folders inside the current one, as tiles. */
export function FolderGrid(p: GridProps) {
  const children = folderDb.childrenOf(p.folders, p.parentId);
  if (children.length === 0) return null;
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {children.map((f) => {
        const n = p.counts.get(f.id) ?? 0;
        const subfolders = p.folders.filter((x) => x.parent_id === f.id).length;
        return (
          <div key={f.id} {...p.dropAttrs(f)}
            className={`group relative flex items-center gap-3 rounded-xl border bg-surface px-3 py-3 shadow-sm transition-colors hover:border-accent/50 ${
              p.isDropTarget(f) ? 'border-accent bg-accent-soft/60' : 'border-line'
            }`}>
            <button type="button" onClick={() => p.editingId !== f.id && p.onOpen(f.id)} className="absolute inset-0 rounded-xl" aria-label={`Open ${f.name}`} />
            <FolderIcon size={22} strokeWidth={1.6} className="pointer-events-none relative shrink-0 fill-accent-soft text-accent" />
            <div className="pointer-events-none relative min-w-0 flex-1">
              {p.editingId === f.id ? (
                <div className="pointer-events-auto">
                  <NameInput initial={f.name} onDone={(name) => {
                    p.onEditing(null);
                    if (name && name !== f.name) void p.act(() => folderDb.renameFolder(f.id, name));
                  }} />
                </div>
              ) : (
                <div className="truncate text-[13px] font-medium text-ink">{f.name}</div>
              )}
              <div className="mt-0.5 text-[11px] text-muted">
                {n === 0 && subfolders === 0 ? 'Empty' : [n > 0 && `${n} file${n === 1 ? '' : 's'}`, subfolders > 0 && `${subfolders} folder${subfolders === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="absolute top-1/2 right-2 flex -translate-y-1/2 gap-0.5 rounded-lg bg-surface/95 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              <button type="button" title="Rename" onClick={() => p.onEditing(f.id)} className="rounded p-1 text-muted hover:text-ink"><Pencil size={13} /></button>
              <FolderSelect folders={p.folders} value={f.parent_id} rootLabel={p.rootLabel} title="Move folder"
                exclude={folderDb.subtreeIds(p.folders, f.id)}
                onChange={(parent) => void p.act(() => folderDb.moveFolder(p.folders, f.id, parent))} />
              <button type="button" title="Export as a folder on your computer" onClick={() => p.onExport(f)}
                className="rounded p-1 text-muted hover:text-ink"><Download size={13} /></button>
              <button type="button" title="Delete folder" className="rounded p-1 text-muted hover:text-danger"
                onClick={async () => {
                  if (await confirmDeleteFolder(p.place, f)) void p.act(() => folderDb.deleteFolder(p.place, f.id));
                }}><Trash2 size={13} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A file as a card with a thumbnail for images; `actions` appear on hover. */
export function FileCard({ name, preview, subtitle, onOpen, actions }: {
  name: string; preview: PreviewFile; subtitle: string; onOpen: () => void; actions: ReactNode;
}) {
  const type = fileType(name);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (type !== 'image' || /\.(heic|tiff?)$/i.test(name)) return;
    let live = true;
    preview.url().then((u) => live && setThumb(u), () => {});
    return () => {
      live = false;
    };
  }, [preview, name, type]);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-colors hover:border-accent/50">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex h-24 items-center justify-center overflow-hidden" style={{ background: `color-mix(in srgb, ${TYPE_TINT[type]} 16%, transparent)` }}>
          {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <FileIcon name={name} size={30} tinted />}
        </div>
        <div className="px-3 py-2.5">
          <div className="line-clamp-2 text-[13px] leading-snug text-ink">{name}</div>
          <div className="mt-1 truncate text-[11px] text-muted">{subtitle}</div>
        </div>
      </button>
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-lg bg-surface/90 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {actions}
      </div>
    </div>
  );
}

/** A square icon button next to a search box. */
export function ToolbarButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className="rounded-lg border border-line bg-surface p-[7px] text-muted transition-colors hover:bg-surface-2 hover:text-ink">
      {children}
    </button>
  );
}
