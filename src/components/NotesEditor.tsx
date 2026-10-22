import { useMemo, useState, type MouseEvent } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Segmented } from './ui';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function NotesEditor({ value, onChange }: Props) {
  // Start in preview when there's something to read, in edit mode when empty.
  const [mode, setMode] = useState<'edit' | 'preview'>(value.trim() ? 'preview' : 'edit');
  const html = useMemo(
    () => (mode === 'preview' ? DOMPurify.sanitize(marked.parse(value, { async: false, gfm: true, breaks: true })) : ''),
    [mode, value],
  );

  // Links must open in the browser, not navigate the app window away.
  const onPreviewClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute('href');
    if (href && /^(https?:|mailto:)/i.test(href)) void openUrl(href);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium tracking-wide text-muted uppercase">Notes</div>
        <Segmented
          options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === 'edit' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'Markdown works: **bold**, - lists, [links](https://…), - [ ] checklists'}
          className="min-h-56 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-muted/70 focus:border-accent"
        />
      ) : value.trim() ? (
        <div
          onClick={onPreviewClick}
          onDoubleClick={() => setMode('edit')}
          className="notes-preview min-h-24 rounded-lg border border-line bg-surface px-4 py-3 text-ink"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <button type="button" onClick={() => setMode('edit')}
          className="w-full rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted hover:text-ink">
          No notes yet. Click to write.
        </button>
      )}
    </div>
  );
}
