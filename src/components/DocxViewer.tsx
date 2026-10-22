import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { renderAsync, type Options } from 'docx-preview';
import { openUrl } from '@tauri-apps/plugin-opener';
import { HIGHLIGHT_CSS } from '../lib/annotations';
import { useAnnotationHost } from './annotate/AnnotatedViewer';

interface Props {
  /** Loads the file's bytes. */
  load: () => Promise<ArrayBuffer>;
  /** Stable key for the file, so a new file re-renders. */
  fileKey: string;
}

const OPTIONS: Partial<Options> = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  renderComments: false,
  renderChanges: false,
  // altChunks are raw HTML from the file, rendered in an unsandboxed iframe that
  // would share the app's origin (and its access to your files). Never render them.
  renderAltChunks: false,
  useBase64URL: true,
};

// Inside the shadow root: lets the dark preview background show through around the pages,
// keeps text selectable, and styles highlights (page stylesheets don't reach into shadow roots).
const SHADOW_CSS = `
  :host { display: block; user-select: text; }
  .docx-wrapper { background: transparent !important; padding: 24px 0 8px !important; }
  .docx-wrapper > section.docx { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35) !important; margin-bottom: 24px !important; }
  a { cursor: pointer; }
  ${HIGHLIGHT_CSS}
`;

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

/**
 * Word (.docx) viewer. The document is rendered into a shadow root so its own
 * CSS (built from the file's styles) can't leak out and restyle the app.
 */
export function DocxViewer({ load, fileKey }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [pageWidth, setPageWidth] = useState(816); // US Letter / A4 are ~794–816 px at 96 dpi
  const [pages, setPages] = useState(0);
  const [available, setAvailable] = useState(0);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const annotations = useAnnotationHost();

  useEffect(() => {
    const el = host.current!;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const unregister = annotations?.addRoot(shadow);
    shadow.replaceChildren();
    const ownStyle = document.createElement('style');
    ownStyle.textContent = SHADOW_CSS;
    const styles = document.createElement('div');
    const content = document.createElement('div');
    shadow.append(ownStyle, styles, content);
    body.current = content;

    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const data = await loadRef.current();
        if (cancelled) return;
        await renderAsync(data, content, styles, OPTIONS);
        if (cancelled) return;
        const sections = content.querySelectorAll<HTMLElement>('section.docx');
        sections.forEach((s, i) => (s.dataset.annoSegment = String(i))); // each page is a highlight segment
        setPages(sections.length);
        if (sections[0]) setPageWidth(sections[0].offsetWidth);
        setStatus('ready');
        annotations?.layoutChanged();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    // Links come from the file: only web/mail links leave the app, and only via the system browser.
    const onClick = (e: Event) => {
      const link = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
      if (!link) return;
      e.preventDefault();
      const href = link.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
      else if (href.startsWith('#') && href.length > 1) {
        shadow.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    shadow.addEventListener('click', onClick);

    return () => {
      cancelled = true;
      shadow.removeEventListener('click', onClick);
      shadow.replaceChildren();
      unregister?.();
    };
  }, [fileKey, annotations]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth - 48));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // "Fit" shrinks wide pages to the window but never blows small ones up.
  const effectiveZoom = zoom === 'fit' ? Math.min(1, available > 0 ? available / pageWidth : 1) : zoom;
  useEffect(() => {
    if (body.current) body.current.style.zoom = String(effectiveZoom);
    annotations?.layoutChanged(); // highlight rectangles move with the zoom
  }, [effectiveZoom, status, annotations]);

  const stepZoom = (delta: number) => {
    const current = ZOOM_STEPS.reduce((best, z) => (Math.abs(z - effectiveZoom) < Math.abs(best - effectiveZoom) ? z : best));
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, ZOOM_STEPS.indexOf(current) + delta))];
    setZoom(next);
  };

  return (
    <div className="relative h-full">
      <div ref={scroller} className="h-full overflow-auto">
        {status === 'loading' && <p className="mt-20 text-center text-sm text-white/70">Opening document…</p>}
        {status === 'error' && (
          <p className="mx-auto mt-20 max-w-md text-center text-sm text-white/80">
            Couldn't display this document: {error}
          </p>
        )}
        <div ref={host} className={status === 'ready' ? '' : 'hidden'} />
      </div>

      {status === 'ready' && (
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white shadow-lg">
          <button type="button" onClick={() => stepZoom(-1)} className="rounded-full p-1.5 hover:bg-white/15" title="Zoom out">
            <Minus size={13} />
          </button>
          <button type="button" onClick={() => setZoom('fit')} className="w-14 rounded-full py-1 tabular-nums hover:bg-white/15"
            title="Fit to window">
            {Math.round(effectiveZoom * 100)}%
          </button>
          <button type="button" onClick={() => stepZoom(1)} className="rounded-full p-1.5 hover:bg-white/15" title="Zoom in">
            <Plus size={13} />
          </button>
          {pages > 0 && <span className="border-l border-white/20 pr-2 pl-3 text-white/70">{pages} {pages === 1 ? 'page' : 'pages'}</span>}
        </div>
      )}
    </div>
  );
}
