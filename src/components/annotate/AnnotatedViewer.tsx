import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Copy, Highlighter, PanelRightClose, Star, StickyNote, Trash2 } from 'lucide-react';
import type { Annotation, HighlightColor } from '../../lib/types';
import { HIGHLIGHT_COLORS } from '../../lib/types';
import {
  anchorQuote, clearHighlights, createAnnotation, deleteAnnotation, describeRange, listAnnotations, paintHighlights,
  updateAnnotation, type Quote,
} from '../../lib/annotations';
import { useDebouncedSave } from '../../lib/hooks';

/** What a viewer can tell the highlight layer. */
export interface AnnotationHost {
  /** Registers an extra place to look for segments and selections (a Word document's shadow root). */
  addRoot: (root: ShadowRoot) => () => void;
  /** The viewer's text changed (a page rendered, a sheet switched): re-find highlights. */
  layoutChanged: () => void;
  /** How to bring a segment into view, if scrolling to it isn't enough (switching sheets). */
  setJumpHandler: (fn: ((location: number) => void) | null) => void;
}

const HostContext = createContext<AnnotationHost | null>(null);
/** Null when the viewer isn't wrapped (e.g. images): viewers must tolerate that. */
export const useAnnotationHost = () => useContext(HostContext);

export const SWATCH: Record<HighlightColor, string> = {
  yellow: 'rgb(255 205 60)',
  green: 'rgb(100 200 125)',
  pink: 'rgb(240 125 180)',
  blue: 'rgb(100 160 240)',
};

interface Props {
  fileRef: string;
  /** "Page", "Slide" or "Sheet": how locations are named in the panel. */
  segmentLabel: string;
  /** Open on this highlight (from the Starred page). */
  initialAnnotationId?: number;
  children: ReactNode;
}

type Toolbar =
  | { mode: 'new'; quote: Quote; rect: DOMRect }
  | { mode: 'existing'; id: number; rect: DOMRect }
  | null;

/** Selection inside a Word document's shadow root isn't visible through document.getSelection(). */
type SelectableRoot = ShadowRoot & { getSelection?: () => Selection | null };

export function AnnotatedViewer({ fileRef, segmentLabel, initialAnnotationId, children }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const roots = useRef(new Set<ShadowRoot>());
  const ranges = useRef(new Map<number, Range>());
  const jumpHandler = useRef<((location: number) => void) | null>(null);
  const pendingJump = useRef<number | null>(initialAnnotationId ?? null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [toolbar, setToolbar] = useState<Toolbar>(null);
  const [activeId, setActiveId] = useState<number | null>(initialAnnotationId ?? null);
  const [panelOpen, setPanelOpen] = useState(initialAnnotationId !== undefined);
  const [layoutTick, setLayoutTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setAnnotations(await listAnnotations(fileRef));
    } catch (e) {
      setError(String(e));
    }
  }, [fileRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const findSegment = useCallback((location: number): Element | null => {
    const selector = `[data-anno-segment="${location}"]`;
    for (const root of [container.current, ...roots.current]) {
      const hit = root?.querySelector(selector);
      if (hit) return hit;
    }
    return null;
  }, []);

  // Re-anchor and repaint whenever the highlights or the rendered text change.
  useEffect(() => {
    const next = new Map<number, Range>();
    for (const a of annotations) {
      const segment = findSegment(a.location);
      const range = segment && anchorQuote(segment, a);
      if (range) next.set(a.id, range);
    }
    ranges.current = next;
    paintHighlights(
      annotations.filter((a) => next.has(a.id)).map((a) => ({ range: next.get(a.id)!, color: a.color, starred: a.starred === 1 })),
      activeId !== null ? (next.get(activeId) ?? null) : null,
    );
    // Second half of a jump: the segment is on screen now, so scroll to the exact words.
    if (pendingJump.current !== null && next.has(pendingJump.current)) {
      const node = next.get(pendingJump.current)!.startContainer;
      (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.scrollIntoView({ block: 'center' });
      pendingJump.current = null;
    }
  }, [annotations, activeId, layoutTick, findSegment]);

  useEffect(() => () => clearHighlights(), []);

  const layoutTimer = useRef<number | undefined>(undefined);
  const host = useMemo<AnnotationHost>(
    () => ({
      addRoot: (root) => {
        roots.current.add(root);
        return () => roots.current.delete(root);
      },
      layoutChanged: () => {
        window.clearTimeout(layoutTimer.current);
        layoutTimer.current = window.setTimeout(() => setLayoutTick((t) => t + 1), 60);
      },
      setJumpHandler: (fn) => {
        jumpHandler.current = fn;
      },
    }),
    [],
  );

  const jump = useCallback(
    (a: Annotation) => {
      setActiveId(a.id);
      pendingJump.current = a.id;
      if (jumpHandler.current) jumpHandler.current(a.location);
      else findSegment(a.location)?.scrollIntoView({ block: 'start' });
      host.layoutChanged();
    },
    [findSegment, host],
  );

  // Open straight onto a highlight (from the Starred page) once it's loaded.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || initialAnnotationId === undefined) return;
    const target = annotations.find((a) => a.id === initialAnnotationId);
    if (target) {
      jumped.current = true;
      jump(target);
    }
  }, [annotations, initialAnnotationId, jump]);

  // ---- selecting text ----
  const currentSelection = (): Selection | null => {
    for (const root of roots.current) {
      const sel = (root as SelectableRoot).getSelection?.();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return sel;
    }
    return document.getSelection();
  };

  const onMouseUp = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-anno-ui]')) return;
    const point = { x: e.clientX, y: e.clientY };
    // Let the browser finish updating the selection first.
    window.setTimeout(() => {
      const sel = currentSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const startNode = range.startContainer;
        const startEl = startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element);
        const segment = startEl?.closest<HTMLElement>('[data-anno-segment]');
        if (!segment) return;
        const quote = describeRange(range, segment, Number(segment.dataset.annoSegment));
        if (quote) setToolbar({ mode: 'new', quote, rect: range.getBoundingClientRect() });
        return;
      }
      // A plain click: did it land on an existing highlight?
      for (const [id, range] of ranges.current) {
        for (const r of range.getClientRects()) {
          if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) {
            setActiveId(id);
            setToolbar({ mode: 'existing', id, rect: range.getBoundingClientRect() });
            return;
          }
        }
      }
      setToolbar(null);
      setActiveId(null);
    }, 0);
  };

  const clearSelection = () => {
    for (const root of roots.current) (root as SelectableRoot).getSelection?.()?.removeAllRanges();
    document.getSelection()?.removeAllRanges();
  };

  const act = async (op: () => Promise<unknown>) => {
    try {
      await op();
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const createFromToolbar = (color: HighlightColor, starred: boolean) => {
    if (toolbar?.mode !== 'new') return;
    const quote = toolbar.quote;
    setToolbar(null);
    clearSelection();
    setActiveId(null); // show the new highlight in its own colour, not the "selected" tint
    void act(() => createAnnotation({ file_ref: fileRef, color, starred: starred ? 1 : 0, ...quote }));
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand('copy'); // the selection is still active, so this copies it
    }
    setToolbar(null);
  };

  const existing = toolbar?.mode === 'existing' ? annotations.find((a) => a.id === toolbar.id) : undefined;

  return (
    <HostContext.Provider value={host}>
      <div className="flex h-full">
        <div
          ref={container}
          className="relative min-w-0 flex-1"
          onMouseUp={onMouseUp}
          onScrollCapture={() => toolbar && setToolbar(null)}
        >
          {children}

          <button type="button" data-anno-ui onClick={() => setPanelOpen((v) => !v)}
            className="absolute top-3 right-5 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white shadow hover:bg-black/75">
            <Highlighter size={13} />
            {annotations.length > 0 ? `${annotations.length} highlight${annotations.length === 1 ? '' : 's'}` : 'Highlights'}
          </button>
        </div>

        {panelOpen && (
          <HighlightsPanel
            annotations={annotations}
            segmentLabel={segmentLabel}
            activeId={activeId}
            onJump={jump}
            onClose={() => setPanelOpen(false)}
            onChange={(id, patch) => act(() => updateAnnotation(id, patch))}
            onDelete={(id) => act(() => deleteAnnotation(id))}
          />
        )}
      </div>

      {toolbar && (
        <FloatingToolbar rect={toolbar.rect}>
          {HIGHLIGHT_COLORS.map((color) => (
            <button key={color} type="button" title={`Highlight ${color}`}
              onClick={() => (existing ? void act(() => updateAnnotation(existing.id, { color })) : createFromToolbar(color, false))}
              className={`size-5 rounded-full ring-offset-2 ring-offset-neutral-900 hover:ring-2 hover:ring-white/60 ${
                existing?.color === color ? 'ring-2 ring-white' : ''}`}
              style={{ background: SWATCH[color] }} />
          ))}
          <span className="mx-1 h-5 w-px bg-white/20" />
          <ToolButton title={existing?.starred ? 'Unstar' : 'Star this quote'}
            onClick={() => (existing ? void act(() => updateAnnotation(existing.id, { starred: existing.starred ? 0 : 1 })) : createFromToolbar('yellow', true))}>
            <Star size={15} className={existing?.starred ? 'fill-amber-400 text-amber-400' : ''} />
          </ToolButton>
          <ToolButton title="Copy" onClick={() => void copy(existing ? existing.quote : toolbar.mode === 'new' ? toolbar.quote.quote : '')}>
            <Copy size={15} />
          </ToolButton>
          {existing && (
            <>
              <ToolButton title="Add a note" onClick={() => { setPanelOpen(true); setToolbar(null); }}>
                <StickyNote size={15} />
              </ToolButton>
              <ToolButton title="Remove highlight" onClick={() => { setToolbar(null); void act(() => deleteAnnotation(existing.id)); }}>
                <Trash2 size={15} />
              </ToolButton>
            </>
          )}
        </FloatingToolbar>
      )}

      {error && (
        <div data-anno-ui className="fixed bottom-16 left-1/2 z-[90] -translate-x-1/2 rounded-lg bg-red-900/90 px-3 py-2 text-xs text-white">
          {error}
        </div>
      )}
    </HostContext.Provider>
  );
}

function FloatingToolbar({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  // Above the selection when there's room, otherwise below it.
  const top = rect.top > 60 ? rect.top - 48 : rect.bottom + 8;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - 130), window.innerWidth - 272);
  return (
    <div data-anno-ui onMouseDown={(e) => e.preventDefault()} // keep the text selection while clicking
      className="fixed z-[90] flex items-center gap-1.5 rounded-xl bg-neutral-900/95 px-2.5 py-1.5 text-white shadow-xl"
      style={{ top, left }}>
      {children}
    </div>
  );
}

function ToolButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="rounded-md p-1.5 text-white/85 hover:bg-white/15 hover:text-white">
      {children}
    </button>
  );
}

interface PanelProps {
  annotations: Annotation[];
  segmentLabel: string;
  activeId: number | null;
  onJump: (a: Annotation) => void;
  onClose: () => void;
  onChange: (id: number, patch: Partial<{ color: HighlightColor; starred: number; note: string }>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function HighlightsPanel({ annotations, segmentLabel, activeId, onJump, onClose, onChange, onDelete }: PanelProps) {
  const [starredOnly, setStarredOnly] = useState(false);
  const shown = starredOnly ? annotations.filter((a) => a.starred) : annotations;
  return (
    <aside data-anno-ui className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-neutral-900/95 text-white">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="flex-1 text-sm font-medium">Highlights</span>
        <button type="button" onClick={() => setStarredOnly((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${starredOnly ? 'bg-amber-400/20 text-amber-300' : 'text-white/60 hover:text-white'}`}>
          <Star size={12} /> Starred
        </button>
        <button type="button" onClick={onClose} title="Hide panel" className="rounded-md p-1 text-white/60 hover:text-white">
          <PanelRightClose size={15} />
        </button>
      </div>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {shown.length === 0 && (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-white/50">
            Select text in the document to highlight it, star it, or copy it.
          </p>
        )}
        {shown.map((a) => (
          <PanelEntry key={a.id} a={a} label={`${segmentLabel} ${a.location + 1}`} active={a.id === activeId}
            onJump={() => onJump(a)} onChange={(patch) => onChange(a.id, patch)} onDelete={() => onDelete(a.id)} />
        ))}
      </div>
    </aside>
  );
}

function PanelEntry({ a, label, active, onJump, onChange, onDelete }: {
  a: Annotation; label: string; active: boolean; onJump: () => void;
  onChange: (patch: Partial<{ color: HighlightColor; starred: number; note: string }>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [note, setNote] = useState(a.note);
  const { queue } = useDebouncedSave<{ note: string }>((p) => void onChange(p), 500);
  return (
    <div className={`rounded-lg border p-3 ${active ? 'border-white/40 bg-white/10' : 'border-white/10 bg-white/5'}`}
      style={{ borderLeft: `3px solid ${SWATCH[a.color]}` }}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-white/50">
        <span className="flex-1">{label}</span>
        <button type="button" title={a.starred ? 'Unstar' : 'Star'} onClick={() => void onChange({ starred: a.starred ? 0 : 1 })}>
          <Star size={13} className={a.starred ? 'fill-amber-400 text-amber-400' : 'hover:text-white'} />
        </button>
        <button type="button" title="Remove" onClick={() => void onDelete()} className="hover:text-red-300">
          <Trash2 size={12} />
        </button>
      </div>
      <button type="button" onClick={onJump} className="line-clamp-5 w-full text-left text-[13px] leading-snug text-white/90 hover:text-white">
        “{a.quote.replace(/\s+/g, ' ').trim()}”
      </button>
      <textarea value={note} rows={1} placeholder="Add a note…"
        onChange={(e) => { setNote(e.target.value); queue({ note: e.target.value }); }}
        className="field-sizing-content mt-2 w-full resize-none rounded-md bg-black/25 px-2 py-1.5 text-xs text-white outline-none placeholder:text-white/35 focus:bg-black/40" />
    </div>
  );
}
