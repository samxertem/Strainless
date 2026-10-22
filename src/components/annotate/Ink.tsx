import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Eraser, Highlighter, PenLine, Undo2, X } from 'lucide-react';
import { addStroke, deleteStroke, listStrokes, type InkStroke, type InkTool, type NewStroke } from '../../lib/ink';

// Freehand pen, highlighter and eraser on PDF pages and slides. Each viewer puts an
// <InkLayer> inside every page; strokes are stored in units of the page width, so
// they stay put at any zoom.

type Tool = InkTool | 'eraser';

const PEN_COLORS = ['#1f2328', '#d64545', '#2f6fdb', '#2e9e5b', '#e8891c'];
const HIGHLIGHTER_COLORS = ['#ffd23f', '#7ee081', '#ff8fc7', '#7cc4ff'];
/** Stroke widths as a fraction of the page width: thin, medium, thick. */
const SIZES: Record<InkTool, number[]> = { pen: [0.002, 0.004, 0.008], highlighter: [0.012, 0.02, 0.03] };
const HIGHLIGHTER_OPACITY = 0.38;

type Action = { kind: 'add'; id: number } | { kind: 'erase'; stroke: InkStroke };

interface InkState {
  /** null while the pen is put away: pages then ignore the mouse, so text can be selected. */
  tool: Tool | null;
  color: string;
  width: number;
  strokesAt: (location: number) => InkStroke[];
  add: (stroke: Omit<NewStroke, 'file_ref'>) => void;
  erase: (stroke: InkStroke) => void;
}

const InkContext = createContext<InkState | null>(null);

interface ProviderProps {
  fileRef: string;
  onError: (message: string) => void;
  children: ReactNode;
}

/** Holds a file's strokes and the pen settings; renders the toolbar when the pen is out. */
export function useInkController({ fileRef, onError }: Omit<ProviderProps, 'children'>) {
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [tool, setTool] = useState<Tool | null>(null);
  const [colors, setColors] = useState<Record<InkTool, string>>({ pen: PEN_COLORS[1], highlighter: HIGHLIGHTER_COLORS[0] });
  const [sizes, setSizes] = useState<Record<InkTool, number>>({ pen: 1, highlighter: 1 });
  const history = useRef<Action[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    listStrokes(fileRef).then(setStrokes, (e) => onError(String(e)));
  }, [fileRef, onError]);

  const record = (a: Action) => {
    history.current.push(a);
    setCanUndo(true);
  };

  const add = useCallback(
    (s: Omit<NewStroke, 'file_ref'>) => {
      const stroke = { ...s, file_ref: fileRef };
      addStroke(stroke).then(
        (id) => {
          setStrokes((list) => [...list, { ...stroke, id }]);
          record({ kind: 'add', id });
        },
        (e) => onError(String(e)),
      );
    },
    [fileRef, onError],
  );

  const erase = useCallback(
    (stroke: InkStroke) => {
      setStrokes((list) => list.filter((s) => s.id !== stroke.id));
      record({ kind: 'erase', stroke });
      deleteStroke(stroke.id).catch((e) => onError(String(e)));
    },
    [onError],
  );

  const undo = useCallback(() => {
    const last = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!last) return;
    if (last.kind === 'add') {
      setStrokes((list) => list.filter((s) => s.id !== last.id));
      deleteStroke(last.id).catch((e) => onError(String(e)));
    } else {
      const { id: _old, ...again } = last.stroke;
      addStroke(again).then((id) => setStrokes((list) => [...list, { ...again, id }]), (e) => onError(String(e)));
    }
  }, [onError]);

  // Ctrl+Z while the pen is out.
  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, undo]);

  const byLocation = useMemo(() => {
    const map = new Map<number, InkStroke[]>();
    for (const s of strokes) map.set(s.location, [...(map.get(s.location) ?? []), s]);
    return map;
  }, [strokes]);

  const drawTool: InkTool = tool === 'highlighter' ? 'highlighter' : 'pen';
  const state = useMemo<InkState>(
    () => ({
      tool,
      color: colors[drawTool],
      width: SIZES[drawTool][sizes[drawTool]],
      strokesAt: (location) => byLocation.get(location) ?? [],
      add,
      erase,
    }),
    [tool, colors, sizes, drawTool, byLocation, add, erase],
  );

  const toolbar = tool && (
    <div data-anno-ui className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/75 px-2 py-1.5 text-white shadow-lg">
      <ToolButton active={tool === 'pen'} title="Pen" onClick={() => setTool('pen')}><PenLine size={15} /></ToolButton>
      <ToolButton active={tool === 'highlighter'} title="Highlighter" onClick={() => setTool('highlighter')}><Highlighter size={15} /></ToolButton>
      <ToolButton active={tool === 'eraser'} title="Eraser: drag over a line to remove it" onClick={() => setTool('eraser')}><Eraser size={15} /></ToolButton>
      {tool !== 'eraser' && (
        <>
          <span className="mx-1 h-5 w-px bg-white/20" />
          {(drawTool === 'pen' ? PEN_COLORS : HIGHLIGHTER_COLORS).map((c) => (
            <button key={c} type="button" title="Colour" onClick={() => setColors((cs) => ({ ...cs, [drawTool]: c }))}
              className={`size-5 rounded-full ring-offset-2 ring-offset-black/80 ${colors[drawTool] === c ? 'ring-2 ring-white' : 'hover:ring-2 hover:ring-white/50'}`}
              style={{ background: c }} />
          ))}
          <span className="mx-1 h-5 w-px bg-white/20" />
          {SIZES[drawTool].map((w, i) => (
            <button key={w} type="button" title={['Thin', 'Medium', 'Thick'][i]} onClick={() => setSizes((ss) => ({ ...ss, [drawTool]: i }))}
              className={`flex size-6 items-center justify-center rounded-full ${sizes[drawTool] === i ? 'bg-white/25' : 'hover:bg-white/10'}`}>
              <span className="rounded-full bg-white" style={{ width: 3 + i * 3, height: 3 + i * 3 }} />
            </button>
          ))}
        </>
      )}
      <span className="mx-1 h-5 w-px bg-white/20" />
      <ToolButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Undo2 size={15} /></ToolButton>
      <ToolButton title="Put the pen away" onClick={() => setTool(null)}><X size={15} /></ToolButton>
    </div>
  );

  return { state, toolbar, penOut: tool !== null, takePen: () => setTool('pen') };
}

export function InkProvider({ state, children }: { state: InkState; children: ReactNode }) {
  return <InkContext.Provider value={state}>{children}</InkContext.Provider>;
}

function ToolButton({ active, title, disabled, onClick, children }: {
  active?: boolean; title: string; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`rounded-full p-1.5 disabled:opacity-30 ${active ? 'bg-white/25' : 'hover:bg-white/10'}`}>
      {children}
    </button>
  );
}

// ---------- drawing on one page ----------

/** Smooth path through the points: quadratic curves between midpoints. A single point draws a dot. */
function pathOf(p: number[]): string {
  if (p.length < 4) return `M${p[0]} ${p[1]}l0 0`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    d += `Q${p[i]} ${p[i + 1]} ${(p[i] + p[i + 2]) / 2} ${(p[i + 1] + p[i + 3]) / 2}`;
  }
  return `${d}L${p[p.length - 2]} ${p[p.length - 1]}`;
}

/** Distance from point (x, y) to the segment a–b. */
function distToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function touches(s: InkStroke, x: number, y: number, reach: number): boolean {
  const p = s.points;
  if (p.length < 4) return Math.hypot(x - p[0], y - p[1]) <= reach + s.width / 2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach + s.width / 2) return true;
  }
  return false;
}

function StrokePath({ s }: { s: Pick<InkStroke, 'tool' | 'color' | 'width' | 'points'> }) {
  const highlighter = s.tool === 'highlighter';
  return (
    <path d={pathOf(s.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round"
      strokeOpacity={highlighter ? HIGHLIGHTER_OPACITY : 1} style={highlighter ? { mixBlendMode: 'multiply' } : undefined} />
  );
}

/** Eraser reach as a fraction of the page width. */
const ERASER_REACH = 0.008;

/** The drawing surface over one page or slide. Must sit inside a positioned page element. */
export function InkLayer({ location }: { location: number }) {
  const ink = useContext(InkContext);
  const svg = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(0); // page height / width
  const [live, setLive] = useState<number[] | null>(null);
  const points = useRef<number[] | null>(null);

  useEffect(() => {
    const page = svg.current?.parentElement;
    if (!page) return;
    const measure = () => page.offsetWidth && setAspect(page.offsetHeight / page.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  if (!ink) return null;
  const strokes = ink.strokesAt(location);
  const drawing = ink.tool !== null;
  if (!drawing && strokes.length === 0) return <svg ref={svg} className="hidden" />;

  // Pointer position in page-width units. getBoundingClientRect includes CSS zoom/scale, so this works on slides too.
  const at = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width] as const;
  };

  const eraseAt = (e: { clientX: number; clientY: number }) => {
    const [x, y] = at(e);
    for (const s of strokes) if (touches(s, x, y, ERASER_REACH)) ink.erase(s);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); // no text selection while drawing
    e.currentTarget.setPointerCapture(e.pointerId);
    if (ink.tool === 'eraser') {
      eraseAt(e);
      points.current = [];
      return;
    }
    points.current = [...at(e)];
    setLive(points.current);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!points.current) return;
    if (ink.tool === 'eraser') {
      eraseAt(e);
      return;
    }
    // Coalesced events: every point the pen passed through, not just one per frame.
    for (const c of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) points.current.push(...at(c));
    setLive([...points.current]);
  };

  const onUp = () => {
    const p = points.current;
    points.current = null;
    setLive(null);
    if (!p || ink.tool === 'eraser' || ink.tool === null || p.length < 2) return;
    ink.add({ location, tool: ink.tool, color: ink.color, width: ink.width, points: p });
  };

  return (
    <svg ref={svg} data-ink viewBox={`0 0 1 ${aspect || 1}`} preserveAspectRatio="none"
      className="absolute inset-0 z-[3] h-full w-full"
      style={{ pointerEvents: drawing ? 'auto' : 'none', cursor: drawing ? (ink.tool === 'eraser' ? 'cell' : 'crosshair') : undefined, touchAction: drawing ? 'none' : undefined }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {aspect > 0 && strokes.map((s) => <StrokePath key={s.id} s={s} />)}
      {aspect > 0 && live && ink.tool && ink.tool !== 'eraser' && (
        <StrokePath s={{ tool: ink.tool, color: ink.color, width: ink.width, points: live }} />
      )}
    </svg>
  );
}
