import { useCallback, useEffect, useMemo, useState } from 'react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { ExternalLink, Eye, Paperclip, Trash2 } from 'lucide-react';
import type { Attachment } from '../lib/types';
import * as db from '../lib/db';
import { attachmentPreview } from '../lib/files';
import { Preview, previewKind } from './Preview';
import { FileIcon } from './FileIcon';

interface Props {
  itemId: number;
  /** Bumped by the parent when files were added elsewhere (drag and drop). */
  refreshKey: number;
  /** Called after files are added or removed, so counts elsewhere refresh. */
  onChanged: () => void;
}

export function Attachments({ itemId, refreshKey, onChanged }: Props) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewFiles = useMemo(() => files.map(attachmentPreview), [files]);

  const load = useCallback(async () => {
    try {
      setFiles(await db.listAttachments(itemId));
    } catch (e) {
      setError(String(e));
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

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

  const openExternally = (att: Attachment) => attachmentPreview(att).openExternally().catch((e) => setError(String(e)));
  const canPreview = (att: Attachment) => previewKind({ name: att.original_name, mime: att.mime }) !== null;
  const activate = (att: Attachment, index: number) => (canPreview(att) ? setPreviewIndex(index) : void openExternally(att));

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

      {files.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {files.map((att, index) => {
            const previewable = canPreview(att);
            return (
              <li key={att.id} className="group flex items-center gap-2.5 px-3 py-2 hover:bg-surface-2">
                <FileIcon name={att.original_name} tinted className="shrink-0" />
                <button type="button" onClick={() => activate(att, index)}
                  title={previewable ? 'Preview' : 'Open with default app'}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline">
                  {att.original_name}
                </button>
                <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(att.size)}</span>
                <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
                  {previewable && (
                    <button type="button" onClick={() => setPreviewIndex(index)} title="Preview"
                      className="rounded p-1 text-muted hover:text-ink"><Eye size={13} /></button>
                  )}
                  <button type="button" onClick={() => openExternally(att)} title="Open with default app"
                    className="rounded p-1 text-muted hover:text-ink"><ExternalLink size={13} /></button>
                  <button type="button" onClick={() => remove(att)} title="Remove"
                    className="rounded p-1 text-muted hover:text-danger"><Trash2 size={13} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-4 py-4 text-center text-xs text-muted">
          Drop files here, or use Attach files. PDFs, photos, slides, anything.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {previewIndex !== null && files[previewIndex] && (
        <Preview files={previewFiles} index={previewIndex} onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)} />
      )}
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
