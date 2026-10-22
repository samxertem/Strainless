import { useEffect, useRef, useState, type RefObject } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { PDF_ASSETS, pdfjs } from '../lib/pdfjs';
import { useAnnotationHost } from './annotate/AnnotatedViewer';
import { PageJump, useSegmentNav } from './PageJump';
import { InkLayer } from './annotate/Ink';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
const MAX_FIT_WIDTH = 1000;

interface Props {
  /** Loads the file's bytes; called again when the identity changes. */
  load: () => Promise<ArrayBuffer>;
  /** Stable key for the file, so a new file reloads the document. */
  fileKey: string;
}

export function PdfViewer({ load, fileKey }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [aspect, setAspect] = useState(1.414); // page height / width, from page 1
  const [error, setError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(ZOOM_STEPS.indexOf(1));
  const [fitWidth, setFitWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    // pdf.js 6: the loading task owns the document; destroying it also aborts a load in progress.
    let task: PDFDocumentLoadingTask | null = null;
    setDoc(null);
    setError(null);
    (async () => {
      try {
        const data = await loadRef.current();
        if (cancelled) return;
        task = pdfjs.getDocument({ data: new Uint8Array(data), ...PDF_ASSETS });
        const opened = await task.promise;
        if (cancelled) return;
        const first = (await opened.getPage(1)).getViewport({ scale: 1 });
        setAspect(first.height / first.width);
        setDoc(opened);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [fileKey]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFitWidth(Math.min(el.clientWidth - 48, MAX_FIT_WIDTH)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const zoom = ZOOM_STEPS[zoomIndex];
  const pageWidth = Math.round(fitWidth * zoom);
  const nav = useSegmentNav(scroller, doc ? doc.numPages : 0);

  return (
    <div className="relative h-full">
      <div ref={scroller} className="h-full overflow-auto py-6">
        {error ? (
          <p className="mx-auto mt-20 max-w-md text-center text-sm text-white/80">Couldn't display this PDF: {error}</p>
        ) : !doc ? (
          <p className="mt-20 text-center text-sm text-white/70">Loading…</p>
        ) : (
          <div className="flex flex-col items-center gap-4" style={{ minWidth: pageWidth }}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} pageNumber={i + 1} width={pageWidth} aspect={aspect} root={scroller} />
            ))}
          </div>
        )}
      </div>

      {doc && (
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white shadow-lg">
          <button type="button" onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0}
            className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-30" title="Zoom out">
            <Minus size={13} />
          </button>
          <button type="button" onClick={() => setZoomIndex(ZOOM_STEPS.indexOf(1))}
            className="w-14 rounded-full py-1 tabular-nums hover:bg-white/15" title="Fit width">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => setZoomIndex((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-30" title="Zoom in">
            <Plus size={13} />
          </button>
          <PageJump current={nav.current} total={doc.numPages} label="Page" onJump={nav.jumpTo} />
        </div>
      )}
    </div>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  aspect: number;
  root: RefObject<HTMLDivElement | null>;
}

/**
 * One page: a canvas for the picture plus pdf.js's invisible text layer on top,
 * which is what makes text selectable, copyable and highlightable. It renders only
 * while near the viewport and releases both when scrolled far away: a 200-slide
 * lecture PDF at 2x resolution would otherwise hold gigabytes of pixels.
 */
function PdfPage({ doc, pageNumber, width, aspect, root }: PageProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const host = useAnnotationHost();
  const [near, setNear] = useState(pageNumber <= 2);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin: '1200px 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const target = canvas.current;
    const text = textLayer.current;
    if (!target || !text || width <= 0) return;
    if (!near) {
      target.width = 0; // frees the bitmap
      target.height = 0;
      text.replaceChildren();
      host?.layoutChanged();
      return;
    }
    let task: RenderTask | null = null;
    let layer: pdfjs.TextLayer | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const cssScale = width / page.getViewport({ scale: 1 }).width;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * dpr });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      setHeight(viewport.height / dpr);
      task = page.render({ canvas: target, viewport });

      // The text layer is laid out in CSS pixels, driven by these variables.
      holder.current?.style.setProperty('--total-scale-factor', String(cssScale));
      text.replaceChildren();
      layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport: page.getViewport({ scale: cssScale }),
      });
      await Promise.all([task.promise, layer.render()]);
      if (!cancelled) host?.layoutChanged();
    })().catch((e: unknown) => {
      const name = (e as { name?: string })?.name;
      if (name !== 'RenderingCancelledException' && name !== 'AbortException') console.error(e);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [doc, pageNumber, width, near, host]);

  return (
    <div ref={holder} data-anno-segment={pageNumber - 1}
      className="pdf-page relative shrink-0 bg-white shadow-lg"
      style={{ width, height: height ?? width * aspect }}>
      <canvas ref={canvas} className="absolute inset-0 block h-full w-full" />
      <div ref={textLayer} className="textLayer" />
      <InkLayer location={pageNumber - 1} />
    </div>
  );
}
