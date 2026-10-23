import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { DocumentFile, Folder } from '../../lib/types';
import { listDocuments } from '../../lib/documents';
import { folderPath, listFolders } from '../../lib/folders';
import { Button, Modal } from '../ui';
import { FileIcon } from '../FileIcon';

/** Pick documents (CV, transcript…) to copy into a task. */
export function DocumentPicker({ onPick, onClose }: { onPick: (docs: DocumentFile[]) => void; onClose: () => void }) {
  const [docs, setDocs] = useState<DocumentFile[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    Promise.all([listDocuments(), listFolders({ kind: 'documents' })]).then(([d, f]) => {
      setDocs(d);
      setFolders(f);
    }, () => setDocs([]));
  }, []);

  // Grouped by folder path, top level first, so it reads like the Documents page.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const where = (d: DocumentFile) => folderPath(folders, d.folder_id).map((f) => f.name).join(' / ');
    return (docs ?? [])
      .map((d) => ({ doc: d, where: where(d) }))
      .filter((r) => !q || `${r.where} ${r.doc.original_name}`.toLowerCase().includes(q))
      .sort((a, b) => a.where.localeCompare(b.where, undefined, { numeric: true }) || a.doc.original_name.localeCompare(b.doc.original_name, undefined, { numeric: true }));
  }, [docs, folders, query]);

  const toggle = (id: number) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Modal title="Attach from Documents" onClose={onClose} width="w-[520px]"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">A copy is attached; the original stays in Documents.</span>
          <Button variant="primary" disabled={picked.size === 0}
            onClick={() => onPick((docs ?? []).filter((d) => picked.has(d.id)))}>
            Attach {picked.size > 0 ? picked.size : ''}
          </Button>
        </div>
      }>
      <div className="border-b border-line px-5 py-2.5">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-muted" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a document…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70" />
        </div>
      </div>
      {docs !== null && rows.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-muted">
          {docs.length === 0 ? 'No documents yet. Add your CV, transcripts and such on the Documents page.' : 'Nothing matches.'}
        </p>
      )}
      <ul className="py-1">
        {rows.map(({ doc, where }) => (
          <li key={doc.id}>
            <button type="button" onClick={() => toggle(doc.id)}
              className={`flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-surface-2 ${picked.has(doc.id) ? 'bg-accent-soft/60' : ''}`}>
              <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${picked.has(doc.id) ? 'border-accent bg-accent text-surface' : 'border-line'}`}>
                {picked.has(doc.id) && <Check size={11} strokeWidth={3} />}
              </span>
              <FileIcon name={doc.original_name} tinted className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{doc.original_name}</span>
              {where && <span className="max-w-40 shrink-0 truncate text-xs text-muted">{where}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
