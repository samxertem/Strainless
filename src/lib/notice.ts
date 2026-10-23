// A small, calm status line ("Added 12 files…") that any part of the app can show
// without passing callbacks around. Read it with useSyncExternalStore.

export interface Notice {
  id: number;
  text: string;
  /** Still working (copying files): stays until replaced, shown with a spinner. */
  busy: boolean;
}

let current: Notice | null = null;
let nextId = 1;
let timer: number | undefined;
const listeners = new Set<() => void>();

const set = (notice: Notice | null) => {
  current = notice;
  listeners.forEach((fn) => fn());
};

export function showNotice(text: string, { busy = false } = {}): void {
  window.clearTimeout(timer);
  const notice = { id: nextId++, text, busy };
  set(notice);
  if (!busy) timer = window.setTimeout(() => current?.id === notice.id && set(null), 6000);
}

export const dismissNotice = () => set(null);

export const noticeStore = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => current,
};
