import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Tracks which page or slide is in view in a scrolling viewer, and jumps to one.
 * Segments are the viewer's `[data-anno-segment]` elements, stacked top to bottom.
 */
export function useSegmentNav(scroller: RefObject<HTMLDivElement | null>, count: number, gapAbove = 12) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el || count === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const segments = el.querySelectorAll<HTMLElement>('[data-anno-segment]');
      if (!segments.length) return;
      // The page under the top third of the window counts as "current".
      const probe = el.getBoundingClientRect().top + el.clientHeight / 3;
      let lo = 0;
      let hi = segments.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (segments[mid].getBoundingClientRect().bottom < probe) lo = mid + 1;
        else hi = mid;
      }
      setCurrent(lo);
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller, count]);

  // Scrolls only the viewer, not the page behind the preview. `gapAbove` keeps a label over the segment in view.
  const jumpTo = useCallback(
    (index: number) => {
      const el = scroller.current;
      const segment = el?.querySelector(`[data-anno-segment="${index}"]`);
      if (!el || !segment) return;
      el.scrollTop += segment.getBoundingClientRect().top - el.getBoundingClientRect().top - gapAbove;
    },
    [scroller, gapAbove],
  );

  return { current, jumpTo };
}

interface Props {
  current: number; // 0-based
  total: number;
  label: string; // "Page", "Slide"
  onJump: (index: number) => void;
}

/** "Page [12] of 54" in a viewer's toolbar: click the number, type another, press Enter. */
export function PageJump({ current, total, label, onJump }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const n = Number(draft);
    if (draft && Number.isInteger(n) && n >= 1) onJump(Math.min(n, total) - 1);
  };

  return (
    <label className="flex items-center gap-1.5 border-l border-white/20 pr-2 pl-3 text-white/70" title={`Type a ${label.toLowerCase()} number and press Enter`}>
      {label}
      <input
        data-page-jump
        inputMode="numeric"
        aria-label={`Go to ${label.toLowerCase()}`}
        value={draft ?? String(current + 1)}
        onFocus={(e) => {
          setDraft(String(current + 1));
          const input = e.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          }
        }}
        onBlur={() => setDraft(null)}
        className="w-11 rounded-md bg-white/10 px-1 py-0.5 text-center text-white tabular-nums outline-none focus:bg-white/25"
      />
      of {total}
    </label>
  );
}
