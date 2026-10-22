import { useCallback, useEffect, useRef, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const THEME_KEY = 'strainless.theme';

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Follows the OS by default; cycling goes system -> light -> dark -> system. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readThemePref);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* storage unavailable: theme just won't be remembered */
    }
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (pref !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [pref]);

  const cycle = useCallback(
    () => setPref((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system')),
    [],
  );
  return { pref, cycle };
}

/** Current time, re-rendered every minute so "today"/"overdue" stay correct overnight. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Batches rapid edits (typing) into one save after `delay` ms of quiet.
 * Pending edits are flushed on unmount, so closing the panel mid-sentence loses nothing.
 */
export function useDebouncedSave<P extends object>(save: (patch: P) => void, delay = 500) {
  const pending = useRef<Partial<P>>({});
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length > 0) saveRef.current(patch as P);
  }, []);

  const queue = useCallback(
    (patch: Partial<P>) => {
      pending.current = { ...pending.current, ...patch };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [flush, delay],
  );

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    pending.current = {};
  }, []);

  useEffect(() => flush, [flush]);
  return { queue, flush, cancel };
}
