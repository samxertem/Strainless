import type { Item } from './types';
import { addDays, effectiveDue, startOfDay, startOfWeek } from './dates';

export type Bucket = 'overdue' | 'today' | 'thisWeek' | 'nextTwoWeeks' | 'later' | 'noDate';

export const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'thisWeek', 'nextTwoWeeks', 'later', 'noDate'];

/**
 * Decides which dashboard section an unfinished item belongs to.
 * Done items are filtered out before this is called.
 *
 * Every item lands in exactly one bucket. Weeks are calendar weeks (Mon–Sun).
 *
 * Helpers you have:
 *   effectiveDue(item)  -> Date | null  (all-day items resolve to 23:59:59.999 of their day)
 *   startOfDay(d)       -> local midnight of d
 *   startOfWeek(d)      -> Monday 00:00 of d's week
 *   addDays(d, n)       -> d shifted by n calendar days
 */
export function bucketFor(item: Item, now: Date): Bucket {
  const due = effectiveDue(item);
  if (!due) return 'noDate';

  // Past the exact due moment = overdue, even if it's still the same day.
  if (due < now) return 'overdue';

  const tomorrow = addDays(startOfDay(now), 1);
  const nextMonday = addDays(startOfWeek(now), 7);
  const mondayAfterNextTwoWeeks = addDays(nextMonday, 14);

  if (due < tomorrow) return 'today';
  if (due < nextMonday) return 'thisWeek'; // rest of this Mon–Sun week (empty on Sundays)
  if (due < mondayAfterNextTwoWeeks) return 'nextTwoWeeks'; // the two full weeks after this one
  return 'later';
}

/** Soonest first; ties broken by priority (high first), then title. */
export function compareItems(a: Item, b: Item): number {
  const da = effectiveDue(a)?.getTime() ?? Infinity;
  const db = effectiveDue(b)?.getTime() ?? Infinity;
  if (da !== db) return da - db;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.title.localeCompare(b.title);
}

export function groupByBucket(items: Item[], now: Date): Record<Bucket, Item[]> {
  const groups = Object.fromEntries(BUCKET_ORDER.map((b) => [b, [] as Item[]])) as Record<Bucket, Item[]>;
  for (const item of items) groups[bucketFor(item, now)].push(item);
  for (const b of BUCKET_ORDER) groups[b].sort(compareItems);
  return groups;
}
