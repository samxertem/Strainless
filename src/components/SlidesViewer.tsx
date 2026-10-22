import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { readPptx, type Deck, type Paragraph, type ShapeModel, type TextBody } from '../lib/pptx';
import { useAnnotationHost } from './annotate/AnnotatedViewer';

interface Props {
  load: () => Promise<ArrayBuffer>;
  fileKey: string;
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5];
const MAX_FIT_WIDTH = 1100;
const PT = 4 / 3; // px per point

/** PowerPoint viewer: slides stacked vertically, text selectable and highlightable, speaker notes below. */
export function SlidesViewer({ load, fileKey }: Props) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitWidth, setFitWidth] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(ZOOM_STEPS.indexOf(1));
  const scroller = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const host = useAnnotationHost();

  useEffect(() => {
    let cancelled = false;
    let loaded: Deck | null = null;
    setDeck(null);
    setError(null);
    (async () => {
      try {
        const data = await loadRef.current();
        loaded = await readPptx(data);
        if (cancelled) loaded.urls.forEach((u) => URL.revokeObjectURL(u));
        else setDeck(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      loaded?.urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [fileKey]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFitWidth(Math.min(el.clientWidth - 48, MAX_FIT_WIDTH)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const width = Math.round(fitWidth * ZOOM_STEPS[zoomIndex]);
  useEffect(() => {
    if (deck) host?.layoutChanged();
  }, [deck, width, host]);

  return (
    <div className="relative h-full">
      <div ref={scroller} className="h-full overflow-auto py-6">
        {error && <p className="mx-auto mt-20 max-w-md text-center text-sm text-white/80">Couldn't display these slides: {error}</p>}
        {!deck && !error && <p className="mt-20 text-center text-sm text-white/70">Opening slides…</p>}
        {deck && width > 0 && (
          <div className="flex flex-col items-center gap-6" style={{ minWidth: width }}>
            {deck.slides.map((slide, i) => (
              <div key={i} style={{ width }}>
                <div className="mb-1.5 text-xs text-white/50">Slide {i + 1}</div>
                <div className="relative overflow-hidden rounded-sm shadow-xl" style={{ width, height: (width * deck.height) / deck.width }}>
                  <div
                    data-anno-segment={i}
                    className="absolute top-0 left-0 origin-top-left select-text"
                    style={{ width: deck.width, height: deck.height, transform: `scale(${width / deck.width})`, background: slide.background }}
                  >
                    {slide.shapes.map((shape, j) => <ShapeView key={j} shape={shape} />)}
                  </div>
                </div>
                {slide.notes && <SpeakerNotes text={slide.notes} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {deck && (
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white shadow-lg">
          <button type="button" onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0}
            className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-30" title="Zoom out"><Minus size={13} /></button>
          <button type="button" onClick={() => setZoomIndex(ZOOM_STEPS.indexOf(1))}
            className="w-14 rounded-full py-1 tabular-nums hover:bg-white/15" title="Fit width">
            {Math.round(ZOOM_STEPS[zoomIndex] * 100)}%
          </button>
          <button type="button" onClick={() => setZoomIndex((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-30" title="Zoom in"><Plus size={13} /></button>
          <span className="border-l border-white/20 pr-2 pl-3 text-white/70">{deck.slides.length} slides</span>
        </div>
      )}
    </div>
  );
}

function SpeakerNotes({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 text-xs text-white/70">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 hover:text-white">
        <ChevronDown size={12} className={open ? '' : '-rotate-90'} /> Speaker notes
      </button>
      {open && <p className="mt-1.5 rounded-md bg-white/5 px-3 py-2 leading-relaxed whitespace-pre-wrap select-text">{text}</p>}
    </div>
  );
}

function ShapeView({ shape: s }: { shape: ShapeModel }) {
  const style: CSSProperties = {
    position: 'absolute',
    left: s.x,
    top: s.y,
    width: s.w,
    height: s.h,
    transform: s.rot || s.flipH || s.flipV
      ? `rotate(${s.rot}deg) scale(${s.flipH ? -1 : 1}, ${s.flipV ? -1 : 1})`
      : undefined,
    background: s.fill ?? undefined,
    border: s.line ? `${s.line.width}px solid ${s.line.color}` : undefined,
    borderRadius: s.geom === 'ellipse' ? '50%' : s.geom === 'roundRect' ? Math.min(s.w, s.h) * 0.16 : undefined,
    boxSizing: 'border-box',
  };

  if (s.image) {
    const { l, t, r, b } = s.image.crop;
    const w = s.w / Math.max(0.01, 1 - l - r);
    const h = s.h / Math.max(0.01, 1 - t - b);
    return (
      <div style={{ ...style, overflow: 'hidden' }}>
        <img src={s.image.url} alt="" draggable={false} loading="lazy"
          style={{ position: 'absolute', width: w, height: h, left: -l * w, top: -t * h, maxWidth: 'none' }} />
      </div>
    );
  }

  if (s.table) {
    return (
      <div style={style}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%' }}>
          <colgroup>{s.table.columns.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <tbody>
            {s.table.rows.map((row, i) => (
              <tr key={i} style={{ height: row.height }}>
                {row.cells.map((cell, j) =>
                  cell.merged ? null : (
                    <td key={j} colSpan={cell.colSpan} rowSpan={cell.rowSpan}
                      style={{ border: '1px solid rgba(0,0,0,0.25)', background: cell.fill ?? undefined, verticalAlign: 'top', padding: 0 }}>
                      <TextBodyView body={cell.text} inline />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (s.label) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed rgba(120,120,120,0.6)', background: 'rgba(120,120,120,0.08)', color: 'rgba(90,90,90,0.9)', fontSize: 20 }}>
        {s.label} · open in PowerPoint to see it
      </div>
    );
  }

  return <div style={style}>{s.text && <TextBodyView body={s.text} />}</div>;
}

function TextBodyView({ body, inline }: { body: TextBody; inline?: boolean }) {
  const [l, t, r, b] = body.insets;
  return (
    <div
      style={{
        position: inline ? 'relative' : 'absolute',
        inset: inline ? undefined : 0,
        padding: `${t}px ${r}px ${b}px ${l}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: body.anchor === 'ctr' ? 'center' : body.anchor === 'b' ? 'flex-end' : 'flex-start',
        whiteSpace: body.wrap ? 'pre-wrap' : 'pre',
        writingMode: body.vertical ? 'vertical-rl' : undefined,
        overflowWrap: 'break-word',
      }}
    >
      {body.paragraphs.map((p, i) => <ParagraphView key={i} p={p} />)}
    </div>
  );
}

function ParagraphView({ p }: { p: Paragraph }) {
  const first = p.runs.find((r) => !r.lineBreak);
  const empty = !p.runs.some((r) => r.text);
  return (
    <p
      style={{
        margin: 0,
        textAlign: p.align,
        paddingLeft: p.marginLeft,
        textIndent: p.bullet ? 0 : p.indent,
        marginTop: p.spaceBefore,
        marginBottom: p.spaceAfter,
        lineHeight: (p.lineHeight ?? 1) * 1.2,
        fontSize: (empty ? p.emptySize : (first?.size ?? p.emptySize)) * PT,
      }}
    >
      {p.bullet && (
        // A hanging bullet: pulled left by the (negative) indent, so text lines up after it.
        <span data-anno-skip style={{
          display: 'inline-block',
          marginLeft: Math.min(0, p.indent),
          minWidth: Math.max(-p.indent, 0),
          color: p.bullet.color ?? undefined,
          fontSize: `${p.bullet.size * 100}%`,
          fontFamily: first?.font,
          userSelect: 'none',
        }}>{p.bullet.text}{p.indent >= 0 ? ' ' : ''}</span>
      )}
      {empty
        ? ' '
        : p.runs.map((r, i) =>
            r.lineBreak ? <br key={i} /> : (
              <span key={i} style={{
                fontSize: r.size * PT * (r.baseline ? 0.7 : 1),
                fontWeight: r.bold ? 700 : 400,
                fontStyle: r.italic ? 'italic' : undefined,
                textDecoration: [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
                color: r.color,
                fontFamily: `"${r.font}", Calibri, Arial, sans-serif`,
                verticalAlign: r.baseline > 0 ? 'super' : r.baseline < 0 ? 'sub' : undefined,
              }}>{r.text}</span>
            ),
          )}
    </p>
  );
}
