import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Bold, Code, CodeXml, Heading2, ImagePlus, Italic, Link, List, ListChecks } from 'lucide-react';
import { COURSE_IMAGE_PREFIX, renderMarkdown } from '../lib/markdown';
import { fileUrl } from '../lib/files';
import { getCourseFile } from '../lib/courses';
import { Segmented } from './ui';

export interface ImageSupport {
  /** Stores a pasted/picked image and returns the markdown that shows it. */
  savePasted: (blob: Blob) => Promise<string>;
  /** Picks image files from disk and returns markdown for them. */
  pick: () => Promise<string | null>;
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Pasting and inserting images (course notes). Without it, images can still be linked by URL. */
  images?: ImageSupport;
  minHeight?: number;
  /** Start in preview when there's content. */
  preferPreview?: boolean;
  label?: string;
}

/** Markdown editor with a small toolbar, live preview, code highlighting and pasted images. */
export function MarkdownEditor({ value, onChange, placeholder, images, minHeight = 220, preferPreview = true, label }: EditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>(preferPreview && value.trim() ? 'preview' : 'edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  /** Wraps the selection (or inserts a template) and keeps focus in the textarea. */
  const apply = (before: string, after = '', fallback = '') => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e) || fallback;
    const next = value.slice(0, s) + before + selected + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  };

  /** Inserts a block (an image) as its own paragraph: a blank line before it ends any list above. */
  const insert = (text: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? value.length;
    const before = value.slice(0, at);
    const pad = at === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    onChange(before + pad + text + '\n' + value.slice(at));
  };

  const linePrefix = (prefix: string) => {
    const el = area.current;
    if (!el) return;
    const lineStart = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    onChange(value.slice(0, lineStart) + prefix + value.slice(lineStart));
    requestAnimationFrame(() => el.focus());
  };

  const withImage = async (op: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const md = await op();
      if (md) insert(md);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!images) return;
    const file = Array.from(e.clipboardData.items).find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void withImage(() => images.savePasted(file));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab inserts two spaces (code!) instead of leaving the editor.
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      apply('  ');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      apply('**', '**', 'bold');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      apply('_', '_', 'italic');
    }
  };

  const tool = 'rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40';

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        {label && <div className="mr-2 text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>}
        {mode === 'edit' && (
          <div className="flex flex-wrap items-center">
            <button type="button" className={tool} title="Bold (Ctrl+B)" onClick={() => apply('**', '**', 'bold')}><Bold size={14} /></button>
            <button type="button" className={tool} title="Italic (Ctrl+I)" onClick={() => apply('_', '_', 'italic')}><Italic size={14} /></button>
            <button type="button" className={tool} title="Heading" onClick={() => linePrefix('## ')}><Heading2 size={14} /></button>
            <button type="button" className={tool} title="List" onClick={() => linePrefix('- ')}><List size={14} /></button>
            <button type="button" className={tool} title="Checklist" onClick={() => linePrefix('- [ ] ')}><ListChecks size={14} /></button>
            <button type="button" className={tool} title="Inline code" onClick={() => apply('`', '`', 'code')}><Code size={14} /></button>
            <button type="button" className={tool} title="Code block" onClick={() => apply('\n```python\n', '\n```\n', 'print("hello")')}><CodeXml size={14} /></button>
            <button type="button" className={tool} title="Link" onClick={() => apply('[', '](https://)', 'link text')}><Link size={14} /></button>
            {images && (
              <button type="button" className={tool} title="Insert image (or paste a screenshot)" disabled={busy}
                onClick={() => void withImage(images.pick)}><ImagePlus size={14} /></button>
            )}
          </div>
        )}
        <div className="ml-auto">
          <Segmented options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]} value={mode} onChange={setMode} />
        </div>
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={area}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Markdown works: **bold**, - lists, ```code blocks```, [links](https://…)'}
          style={{ minHeight }}
          className="field-sizing-content w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-muted/70 focus:border-accent"
        />
      ) : value.trim() ? (
        <MarkdownPreview source={value} onDoubleClick={() => setMode('edit')} />
      ) : (
        <button type="button" onClick={() => setMode('edit')}
          className="w-full rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted hover:text-ink">
          Nothing written yet. Click to write.
        </button>
      )}
      {busy && <p className="mt-1 text-xs text-muted">Saving image…</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {images && mode === 'edit' && <p className="mt-1 text-[11px] text-muted">Tip: paste a screenshot straight in with Ctrl+V.</p>}
    </div>
  );
}

/** Rendered markdown: sanitized HTML, copy buttons on code blocks, course images resolved. */
export function MarkdownPreview({ source, onDoubleClick }: { source: string; onDoubleClick?: () => void }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Code blocks get a copy button.
    for (const pre of root.querySelectorAll('pre')) {
      const button = document.createElement('button');
      button.className = 'code-copy';
      button.textContent = 'Copy';
      button.type = 'button';
      button.dataset.copy = '1';
      pre.appendChild(button);
    }
    // Pasted course images point at #course-file-<id>; swap in the real file URL. The marker
    // stays until the URL arrives, so a re-run of this effect (StrictMode, re-render) still finds it.
    let live = true;
    for (const img of root.querySelectorAll<HTMLImageElement>(`img[src^="${COURSE_IMAGE_PREFIX}"]`)) {
      const id = Number(img.getAttribute('src')!.slice(COURSE_IMAGE_PREFIX.length));
      getCourseFile(id)
        .then((f) => (f ? fileUrl('courses', f.course_id, f.stored_name) : null))
        .then((url) => live && url && (img.src = url), () => {});
    }
    return () => {
      live = false;
    };
  }, [html]);

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const copyButton = target.closest<HTMLButtonElement>('button[data-copy]');
    if (copyButton) {
      const code = copyButton.parentElement?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard.writeText(code).then(() => {
        copyButton.textContent = 'Copied';
        setTimeout(() => (copyButton.textContent = 'Copy'), 1200);
      });
      return;
    }
    // Links open in the browser, not inside the app window.
    const link = target.closest('a');
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute('href');
    if (href && /^(https?:|mailto:)/i.test(href)) void openUrl(href);
  };

  return (
    <div
      ref={ref}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className="notes-preview min-h-24 rounded-lg border border-line bg-surface px-4 py-3 text-ink"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
