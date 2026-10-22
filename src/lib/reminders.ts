import { useEffect, useRef } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import * as db from './db';
import type { Category, Item, Settings } from './types';
import { addDays, effectiveDue, formatDue, startOfDay } from './dates';

const HOUR_MS = 60 * 60 * 1000;

export type ReminderKind = 'day' | 'same';

/** When each enabled reminder for an item should fire. */
export function reminderTimes(item: Item, settings: Settings): { kind: ReminderKind; at: Date }[] {
  const due = effectiveDue(item);
  if (!due) return [];
  const times: { kind: ReminderKind; at: Date }[] = [];
  if (item.all_day) {
    // "1 hour before 23:59" is useless for an all-day deadline; use mornings instead.
    const day = startOfDay(due);
    if (settings.remindDayBefore) times.push({ kind: 'day', at: new Date(addDays(day, -1).setHours(9, 0, 0, 0)) });
    if (settings.remindSameDay) times.push({ kind: 'same', at: new Date(new Date(day).setHours(9, 0, 0, 0)) });
  } else {
    if (settings.remindDayBefore) times.push({ kind: 'day', at: new Date(due.getTime() - 24 * HOUR_MS) });
    if (settings.remindSameDay) times.push({ kind: 'same', at: new Date(due.getTime() - HOUR_MS) });
  }
  return times;
}

let permission: Promise<boolean> | null = null;

export function ensureNotificationPermission(): Promise<boolean> {
  return (permission ??= (async () => (await isPermissionGranted()) || (await requestPermission()) === 'granted')());
}

/**
 * Shows desktop notifications for upcoming deadlines while the app is open.
 * A reminder fires once its time has passed and the deadline hasn't, so opening
 * the app in the morning catches up on anything missed overnight. Each
 * (item, kind, due date) is recorded in the database and never shown twice;
 * moving a deadline re-arms its reminders.
 */
export function useReminders(items: Item[], categoriesById: Map<number, Category>, settings: Settings | null, now: Date) {
  const claimed = useRef(new Set<string>());
  const running = useRef(false);

  useEffect(() => {
    if (!settings?.remindersEnabled || running.current) return;

    const pending: { item: Item; kinds: ReminderKind[] }[] = [];
    for (const item of items) {
      const due = effectiveDue(item);
      if (item.status === 'done' || !due || due <= now) continue;
      const kinds = reminderTimes(item, settings)
        .filter((r) => r.at <= now && !claimed.current.has(`${item.id}:${r.kind}:${item.due_at}`))
        .map((r) => r.kind);
      if (kinds.length > 0) pending.push({ item, kinds });
    }
    if (pending.length === 0) return;

    running.current = true;
    void (async () => {
      try {
        if (!(await ensureNotificationPermission())) return;
        const fresh: Item[] = [];
        for (const { item, kinds } of pending) {
          let isNew = false;
          for (const kind of kinds) {
            claimed.current.add(`${item.id}:${kind}:${item.due_at}`);
            if (await db.claimReminder(item.id, kind, item.due_at!)) isNew = true;
          }
          // If both the day-before and same-day windows are open, notify only once.
          if (isNew) fresh.push(item);
        }
        notify(fresh, categoriesById, now);
      } catch (e) {
        console.error('reminders failed', e);
      } finally {
        running.current = false;
      }
    })();
  }, [items, categoriesById, settings, now]);
}

function notify(items: Item[], categoriesById: Map<number, Category>, now: Date) {
  if (items.length === 0) return;
  if (items.length > 3) {
    // Opening the app after a few days away shouldn't produce a wall of popups.
    const lines = items.slice(0, 4).map((i) => `• ${i.title} (${formatDue(i, now)})`);
    if (items.length > 4) lines.push(`…and ${items.length - 4} more`);
    sendNotification({ title: `${items.length} deadlines coming up`, body: lines.join('\n') });
    return;
  }
  for (const item of items) {
    const category = categoriesById.get(item.category_id)?.name;
    sendNotification({ title: item.title, body: [`Due ${formatDue(item, now)}`, category].filter(Boolean).join(' · ') });
  }
}
