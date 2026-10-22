import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Flag, MapPin, Plus } from 'lucide-react';
import type { Category, ClassOccurrence, Course, CourseSession, Item, NewItem } from '../lib/types';
import { SESSION_KIND_LABELS } from '../lib/types';
import { addDays, dayDiff, effectiveDue, startOfDay, startOfWeek, toDateInput } from '../lib/dates';
import { compareItems } from '../lib/buckets';
import { classesBetween } from '../lib/courses';
import { ItemRow, type RowContext } from './ItemRow';
import { Modal, Segmented } from './ui';

interface Props {
  items: Item[];
  categories: Category[];
  courses: Course[];
  sessions: CourseSession[];
  ctx: RowContext;
  onAdd: (input: NewItem) => Promise<void>;
  onOpenCourse: (courseId: number) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const weekTitle = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayTitle = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const time24 = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const MAX_PER_CELL = 3;
const HOUR_PX = 46;
const PREFS_KEY = 'strainless.calendar';

/** Local calendar date an item falls on: all-day items keep their date, timed ones use local time. */
function dayKey(item: Item): string | null {
  if (!item.due_at) return null;
  return item.all_day ? item.due_at : toDateInput(new Date(item.due_at));
}

function readPrefs(): { mode: 'month' | 'week'; classesInMonth: boolean } {
  try {
    return { mode: 'month', classesInMonth: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { mode: 'month', classesInMonth: false };
  }
}

export function CalendarView({ items, categories, courses, sessions, ctx, onAdd, onOpenCourse }: Props) {
  const { now, categoriesById } = ctx;
  const [prefs, setPrefs] = useState(readPrefs);
  const [cursor, setCursor] = useState(() => startOfDay(now)); // any day inside the shown month/week
  const [openDay, setOpenDay] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* remembered per device only */
    }
  }, [prefs]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      const key = dayKey(item);
      if (key) map.set(key, [...(map.get(key) ?? []), item]);
    }
    for (const list of map.values()) {
      // Open items first (soonest first), finished ones after.
      list.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || compareItems(a, b));
    }
    return map;
  }, [items]);

  const month = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(prefs.mode === 'week' ? cursor : month);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  // Count calendar days, not milliseconds: a DST change would otherwise add a stray row.
  const weeks = prefs.mode === 'week' ? 1 : Math.ceil((dayDiff(gridStart, month) + daysInMonth) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  const rangeStart = toDateInput(days[0]);
  const rangeEnd = toDateInput(days[days.length - 1]);
  const classesByDay = useMemo(() => {
    const map = new Map<string, ClassOccurrence[]>();
    const [from, to] = [rangeStart, rangeEnd].map((k) => new Date(`${k}T00:00`));
    for (const c of classesBetween(sessions, courses, from, to)) map.set(c.day, [...(map.get(c.day) ?? []), c]);
    return map;
  }, [sessions, courses, rangeStart, rangeEnd]);

  const todayKey = toDateInput(now);
  const shift = (delta: number) =>
    setCursor(prefs.mode === 'week' ? addDays(cursor, 7 * delta) : new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  const title = prefs.mode === 'week'
    ? `${weekTitle.format(days[0])} – ${weekTitle.format(days[6])} ${days[6].getFullYear()}`
    : monthTitle.format(month);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-semibold text-ink">{title}</h2>
        <button type="button" onClick={() => shift(-1)} title="Previous"
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => shift(1)} title="Next"
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><ChevronRight size={16} /></button>
        <button type="button" onClick={() => setCursor(startOfDay(now))}
          className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:bg-surface-2">Today</button>
        <div className="ml-auto flex items-center gap-3">
          {prefs.mode === 'month' && sessions.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={prefs.classesInMonth}
                onChange={(e) => setPrefs({ ...prefs, classesInMonth: e.target.checked })} />
              Show classes
            </label>
          )}
          <Segmented options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} value={prefs.mode}
            onChange={(mode) => setPrefs({ ...prefs, mode })} />
        </div>
      </div>

      {prefs.mode === 'week' ? (
        <WeekGrid days={days} byDay={byDay} classesByDay={classesByDay} ctx={ctx} todayKey={todayKey}
          onOpenCourse={onOpenCourse} onOpenDay={setOpenDay} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const key = toDateInput(day);
              const list = byDay.get(key) ?? [];
              const classes = prefs.classesInMonth ? (classesByDay.get(key) ?? []) : [];
              const inMonth = day.getMonth() === month.getMonth();
              const isToday = key === todayKey;
              const weekend = i % 7 >= 5;
              const room = Math.max(0, MAX_PER_CELL - classes.length);
              return (
                <div key={key} onClick={() => setOpenDay(key)}
                  className={`group min-h-28 cursor-default border-line p-1.5 transition-colors hover:bg-surface-2 ${
                    i % 7 !== 6 ? 'border-r' : ''} ${i < days.length - 7 ? 'border-b' : ''} ${
                    weekend ? 'bg-surface-2/40' : ''}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${
                      isToday ? 'bg-accent font-semibold text-surface' : inMonth ? 'text-ink' : 'text-muted/50'}`}>
                      {day.getDate()}
                    </span>
                    <Plus size={12} className="text-muted opacity-0 group-hover:opacity-100" />
                  </div>
                  <div className="space-y-0.5">
                    {classes.map((c) => (
                      <button key={`${c.session.id}`} type="button" title={`${c.course.name} ${SESSION_KIND_LABELS[c.session.kind]}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenCourse(c.course.id);
                        }}
                        className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight text-ink"
                        style={{ background: `color-mix(in srgb, ${c.course.color} 18%, transparent)` }}>
                        <span className="shrink-0 text-muted tabular-nums">{c.session.start_time}</span>
                        <span className="truncate">{c.course.name}</span>
                      </button>
                    ))}
                    {list.slice(0, Math.max(1, room)).map((item) => (
                      <CalendarChip key={item.id} item={item} category={categoriesById.get(item.category_id)} ctx={ctx} />
                    ))}
                    {list.length > Math.max(1, room) && (
                      <div className="px-1 text-[11px] text-muted">+{list.length - Math.max(1, room)} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {openDay && (
        <DayPanel dateKey={openDay} items={byDay.get(openDay) ?? []} classes={classesByDay.get(openDay) ?? []}
          categories={categories} ctx={ctx} onAdd={onAdd} onOpenCourse={onOpenCourse} onClose={() => setOpenDay(null)} />
      )}
    </div>
  );
}

interface WeekProps {
  days: Date[];
  byDay: Map<string, Item[]>;
  classesByDay: Map<string, ClassOccurrence[]>;
  ctx: RowContext;
  todayKey: string;
  onOpenCourse: (id: number) => void;
  onOpenDay: (key: string) => void;
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Lays out overlapping classes side by side within a day: each gets a lane index and lane count. */
function lanes(classes: ClassOccurrence[]): { c: ClassOccurrence; lane: number; of: number }[] {
  const placed: { c: ClassOccurrence; lane: number; of: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const flush = () => {
    const of = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.of = of;
    placed.push(...cluster);
    cluster = [];
  };
  for (const c of classes) {
    const start = minutesOf(c.start);
    if (start >= clusterEnd) flush();
    const busy = new Set(cluster.filter((p) => minutesOf(p.c.end) > start).map((p) => p.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    cluster.push({ c, lane, of: 1 });
    clusterEnd = Math.max(clusterEnd, minutesOf(c.end));
  }
  flush();
  return placed;
}

/** Mon–Sun time grid: classes as blocks, timed deadlines as flags, all-day items on top. */
function WeekGrid({ days, byDay, classesByDay, ctx, todayKey, onOpenCourse, onOpenDay }: WeekProps) {
  const keys = days.map(toDateInput);
  const timed = keys.flatMap((k) => (byDay.get(k) ?? []).filter((i) => !i.all_day));
  const allClasses = keys.flatMap((k) => classesByDay.get(k) ?? []);
  // Show 08:00–20:00, stretched to fit anything earlier or later.
  const firstHour = Math.min(8, ...allClasses.map((c) => c.start.getHours()), ...timed.map((i) => effectiveDue(i)!.getHours()));
  const lastHour = Math.max(20, ...allClasses.map((c) => Math.ceil(minutesOf(c.end) / 60)), ...timed.map((i) => effectiveDue(i)!.getHours() + 1));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const top = (minutes: number) => ((minutes - firstHour * 60) / 60) * HOUR_PX;
  const nowMinutes = minutesOf(ctx.now);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))' }}>
        <div />
        {days.map((d, i) => (
          <button key={keys[i]} type="button" onClick={() => onOpenDay(keys[i])}
            className={`border-l border-line px-2 py-1.5 text-left hover:bg-surface-2 ${keys[i] === todayKey ? 'text-accent' : 'text-ink'}`}>
            <div className="text-[11px] tracking-wide text-muted uppercase">{WEEKDAYS[i]}</div>
            <div className="text-lg leading-tight font-semibold tabular-nums">{d.getDate()}</div>
          </button>
        ))}
      </div>

      {/* All-day items */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))' }}>
        <div className="px-1.5 py-1 text-right text-[10px] text-muted">all day</div>
        {keys.map((k) => (
          <div key={k} className="min-h-8 space-y-0.5 border-l border-line p-1">
            {(byDay.get(k) ?? []).filter((i) => i.all_day).map((item) => (
              <CalendarChip key={item.id} item={item} category={ctx.categoriesById.get(item.category_id)} ctx={ctx} />
            ))}
          </div>
        ))}
      </div>

      <div className="max-h-[62vh] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))', height: hours.length * HOUR_PX }}>
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted tabular-nums" style={{ top: top(h * 60) }}>
                {h > firstHour ? `${String(h).padStart(2, '0')}:00` : ''}
              </div>
            ))}
          </div>
          {keys.map((k, dayIndex) => (
            <div key={k} className={`relative border-l border-line ${dayIndex >= 5 ? 'bg-surface-2/40' : ''}`}>
              {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-line/60" style={{ top: top(h * 60) }} />)}

              {lanes(classesByDay.get(k) ?? []).map(({ c, lane, of }) => (
                <button key={c.session.id} type="button" onClick={() => onOpenCourse(c.course.id)}
                  title={`${c.course.name} · ${SESSION_KIND_LABELS[c.session.kind]}${c.session.location ? ` · ${c.session.location}` : ''}`}
                  className="absolute overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight text-ink shadow-sm transition-transform hover:z-10 hover:scale-[1.02]"
                  style={{
                    top: top(minutesOf(c.start)) + 1,
                    height: Math.max(22, top(minutesOf(c.end)) - top(minutesOf(c.start)) - 2),
                    left: `calc(${(lane / of) * 100}% + 2px)`,
                    width: `calc(${100 / of}% - 4px)`,
                    background: `color-mix(in srgb, ${c.course.color} 24%, var(--surface))`,
                    borderLeft: `3px solid ${c.course.color}`,
                  }}>
                  <div className="truncate font-semibold">{c.course.name}</div>
                  <div className="truncate text-muted">{c.session.start_time}–{c.session.end_time} · {SESSION_KIND_LABELS[c.session.kind]}</div>
                  {c.session.location && <div className="flex items-center gap-0.5 truncate text-muted"><MapPin size={9} />{c.session.location}</div>}
                </button>
              ))}

              {(byDay.get(k) ?? []).filter((i) => !i.all_day).map((item) => {
                const due = effectiveDue(item)!;
                const done = item.status === 'done';
                return (
                  <button key={item.id} type="button" data-drop-item={item.id} onClick={() => ctx.onOpen(item.id)} title={item.title}
                    className={`absolute inset-x-1 z-20 flex -translate-y-1/2 items-center gap-1 truncate rounded-full border border-line bg-surface px-1.5 py-0.5 text-[10px] shadow-sm ${
                      done ? 'text-muted line-through' : due < ctx.now ? 'text-behind' : 'text-ink'}`}
                    style={{ top: top(minutesOf(due)) }}>
                    <Flag size={9} className="shrink-0" />
                    <span className="shrink-0 tabular-nums">{time24.format(due)}</span>
                    <span className="truncate">{item.title}</span>
                  </button>
                );
              })}

              {k === todayKey && nowMinutes >= firstHour * 60 && nowMinutes <= lastHour * 60 && (
                <div className="pointer-events-none absolute inset-x-0 z-30 border-t-2 border-accent" style={{ top: top(nowMinutes) }}>
                  <div className="-mt-[5px] -ml-[5px] size-2 rounded-full bg-accent" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalendarChip({ item, category, ctx }: { item: Item; category: Category | undefined; ctx: RowContext }) {
  const done = item.status === 'done';
  const due = effectiveDue(item);
  const overdue = !done && due !== null && due < ctx.now;
  const dropTarget = item.id === ctx.dropTargetId;
  return (
    <button
      type="button"
      data-drop-item={item.id}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onOpen(item.id);
      }}
      title={item.title}
      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-colors ${
        dropTarget ? 'ring-2 ring-accent' : ''} ${
        item.id === ctx.selectedId ? 'bg-accent-soft' : 'hover:bg-surface'} ${
        done ? 'text-muted line-through' : overdue ? 'text-behind' : 'text-ink'}`}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: category?.color ?? 'var(--muted)' }} />
      {!item.all_day && due && <span className="shrink-0 text-muted tabular-nums">{time24.format(due)}</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

interface DayPanelProps {
  dateKey: string;
  items: Item[];
  classes: ClassOccurrence[];
  categories: Category[];
  ctx: RowContext;
  onAdd: (input: NewItem) => Promise<void>;
  onOpenCourse: (id: number) => void;
  onClose: () => void;
}

/** Everything on one day (classes and deadlines), plus a quick way to add something to it. */
function DayPanel({ dateKey, items, classes, categories, ctx, onAdd, onOpenCourse, onClose }: DayPanelProps) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 0);
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const past = date < startOfDay(ctx.now);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !categoryId) return;
    await onAdd({ title: title.trim(), category_id: categoryId, due_at: dateKey, all_day: true });
    setTitle('');
  };

  return (
    <Modal title={dayTitle.format(date)} onClose={onClose} width="w-[560px]">
      <div className="p-4">
        <form onSubmit={submit} className="mb-4 flex gap-2">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={past ? 'Add something for this (past) day…' : 'Add something due this day…'}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-accent" />
          <select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}
            className="max-w-40 rounded-lg border border-line bg-surface px-2 text-xs text-ink outline-none">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit" disabled={!title.trim()}
            className="rounded-lg bg-accent px-3 text-sm font-medium text-surface disabled:opacity-40">Add</button>
        </form>

        {classes.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {classes.map((c) => (
              <button key={c.session.id} type="button" onClick={() => { onClose(); onOpenCourse(c.course.id); }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink"
                style={{ background: `color-mix(in srgb, ${c.course.color} 16%, transparent)`, borderLeft: `3px solid ${c.course.color}` }}>
                <span className="w-24 shrink-0 text-xs text-muted tabular-nums">{c.session.start_time}–{c.session.end_time}</span>
                <span className="font-medium">{c.course.name}</span>
                <span className="text-xs text-muted">{SESSION_KIND_LABELS[c.session.kind]}</span>
                {c.session.location && <span className="ml-auto text-xs text-muted">{c.session.location}</span>}
              </button>
            ))}
          </div>
        )}

        {items.length > 0 ? (
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} ctx={{ ...ctx, onOpen: (id) => { onClose(); ctx.onOpen(id); } }} />
            ))}
          </div>
        ) : (
          classes.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing on this day.</p>
        )}
      </div>
    </Modal>
  );
}
