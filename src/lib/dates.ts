import type { Item } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** Monday 00:00 of the calendar week that contains `d`. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const daysSinceMonday = (day.getDay() + 6) % 7; // getDay(): Sunday = 0
  return addDays(day, -daysSinceMonday);
}

/** Whole calendar days from `from` to `to` (DST-safe: compares local midnights). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/** 'YYYY-MM-DD' in local time, the format <input type="date"> uses. */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The moment an item is really due. All-day items count as due at the very end
 * of their day, so a midterm "on Nov 14" isn't overdue until Nov 15 begins.
 */
export function effectiveDue(item: Pick<Item, 'due_at' | 'all_day'>): Date | null {
  if (!item.due_at) return null;
  if (item.all_day) {
    const [y, m, d] = item.due_at.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  return new Date(item.due_at);
}

/** Item -> values for the date and time inputs (time is '' for all-day items). */
export function splitDue(item: Pick<Item, 'due_at' | 'all_day'>): { date: string; time: string } {
  if (!item.due_at) return { date: '', time: '' };
  if (item.all_day) return { date: item.due_at, time: '' };
  const d = new Date(item.due_at);
  return { date: toDateInput(d), time: d.toTimeString().slice(0, 5) };
}

/** Date/time inputs -> stored fields. An empty time means all-day. */
export function joinDue(date: string, time: string): Pick<Item, 'due_at' | 'all_day'> {
  if (!date) return { due_at: null, all_day: false };
  if (!time) return { due_at: date, all_day: true };
  return { due_at: new Date(`${date}T${time}`).toISOString(), all_day: false };
}

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const shortDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const time24 = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export const formatLongDate = (d: Date) => longDate.format(d);

/** "Today 14:00", "Tomorrow", "Friday", "Mon 3 Nov 09:30". */
export function formatDue(item: Pick<Item, 'due_at' | 'all_day'>, now: Date): string {
  const due = effectiveDue(item);
  if (!due) return '';
  const days = dayDiff(now, due);
  const day =
    days === 0 ? 'Today'
    : days === 1 ? 'Tomorrow'
    : days === -1 ? 'Yesterday'
    : days > 1 && days < 7 ? weekday.format(due)
    : shortDate.format(due);
  return item.all_day ? day : `${day} ${time24.format(due)}`;
}
