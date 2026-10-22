import { useCallback, useEffect, useState } from 'react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { File, FileArchive, FileSpreadsheet, FileText, Image, Paperclip, Presentation, Trash2 } from 'lucide-react';
import type { Attachment } from '../lib/types';
import * as db from '../lib/db';

interface Props {
  itemId: number;
  /** Called after files are added or removed, so counts elsewhere refresh. */
  onChanged: () => void;
}

export function Attachments({ itemId, onChanged }: Props) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFiles(await db.listAttachments(itemId));
    } catch (e) {
      setError(String(e));
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const withRefresh = async (op: () => Promise<void>) => {
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

  const pick = async () => {
    const picked = await open({ multiple: true, title: 'Attach files' });
    if (!picked) return;
    await withRefresh(() => db.addAttachments(itemId, Array.isArray(picked) ? picked : [picked]));
  };

  const remove = async (att: Attachment) => {
    const ok = await ask(`Remove "${att.original_name}" from this item? The stored copy will be deleted.`, {
      title: 'Remove attachment',
      kind: 'warning',
    });
    if (ok) await withRefresh(() => db.removeAttachment(att));
  };

  const openFile = (att: Attachment) => db.openAttachment(att).catch((e) => setError(String(e)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium tracking-wide text-muted uppercase">
          Attachments {files.length > 0 && <span className="normal-case">· {files.length}</span>}
        </div>
        <button type="button" onClick={pick} disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent hover:bg-accent-soft disabled:opacity-50">
          <Paperclip size={12} /> {busy ? 'Copying…' : 'Attach files'}
        </button>
      </div>

      {files.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {files.map((att) => {
            const Icon = iconFor(att);
            return (
              <li key={att.id} className="group flex items-center gap-2.5 px-3 py-2 hover:bg-surface-2">
                <Icon size={16} className="shrink-0 text-muted" />
                <button type="button" onClick={() => openFile(att)} title="Open with default app"
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline">
                  {att.original_name}
                </button>
                <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(att.size)}</span>
                <button type="button" onClick={() => remove(att)} title="Remove"
                  className="shrink-0 rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-danger">
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function iconFor(att: Attachment) {
  const mime = att.mime ?? '';
  const ext = att.original_name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return Image;
  if (mime === 'application/pdf' || ['doc', 'docx', 'txt', 'md'].includes(ext)) return FileText;
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return Presentation;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z'].includes(ext)) return FileArchive;
  return File;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
