import { useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Flag, MapPin, Paperclip, Plus } from 'lucide-react';
import type { Category, ClassOccurrence, Item, NewItem } from '../lib/types';
import { SESSION_KIND_LABELS } from '../lib/types';
import { compareItems, type Bucket } from '../lib/buckets';
import { effectiveDue, formatLongDate, startOfDay, toDateInput } from '../lib/dates';
import { CategoryChip } from './ui';

interface Props {
  classesToday: ClassOccurrence[];
  onOpenCourse: (courseId: number) => void;
  groups: Record<Bucket, Item[]>;
  items: Item[];
  categories: Category[];
  categoriesById: Map<number, Category>;
  now: Date;
  onOpen: (id: number) => void;
  onToggleDone: (item: Item) => void;
  onAdd: (input: NewItem) => Promise<void>;
  onExit: () => void;
}

/** How many of today's tasks are shown before "show the rest". Three is a day; ten is a wall. */
const VISIBLE = 3;
const time24 = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

function greeting(now: Date) {
  const h = now.getHours();
  return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Priority first in focus mode: what matters most should be at the top, not just what's earliest.
const byPriority = (a: Item, b: Item) => b.priority - a.priority || compareItems(a, b);

export function FocusView({
  classesToday, onOpenCourse, groups, items, categories, categoriesById, now, onOpen, onToggleDone, onAdd, onExit,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const today = [...groups.today].sort(byPriority);
  const earlier = [...groups.overdue].sort(byPriority);
  const startToday = startOfDay(now).toISOString();
  const doneToday = items
    .filter((i) => i.status === 'done' && (i.completed_at ?? '') >= startToday)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const visible = showAll ? today : today.slice(0, VISIBLE);
  const chosenCategory = categoryId ?? categories.find((c) => c.name === 'Personal')?.id ?? categories[0]?.id;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || chosenCategory === undefined) return;
    await onAdd({ title: title.trim(), category_id: chosenCategory, due_at: toDateInput(now), all_day: true });
    setTitle('');
  };

  const nothingLeft = today.length === 0;

  return (
    <div className="min-h-full bg-canvas">
      <div className="mx-auto max-w-2xl px-8 pt-6 pb-16">
        <button type="button" onClick={onExit}
          className="mb-14 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-ink">
          <ArrowLeft size={15} /> Back to everything <kbd className="ml-1 text-[10px] opacity-70">Esc</kbd>
        </button>

        <h1 className="font-serif text-4xl text-ink">{greeting(now)}.</h1>
        <p className="mt-2 text-muted">{formatLongDate(now)}</p>

        {classesToday.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 text-xs tracking-wide text-muted uppercase">Classes today</div>
            <div className="flex flex-wrap gap-2">
              {classesToday.map((c) => {
                const over = c.end < now;
                const live = c.start <= now && now < c.end;
                return (
                  <button key={`${c.session.id}`} type="button" onClick={() => onOpenCourse(c.course.id)}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-opacity ${over ? 'opacity-45' : ''}`}
                    style={{ background: `color-mix(in srgb, ${c.course.color} 16%, transparent)`, borderLeft: `3px solid ${c.course.color}` }}>
                    <span className="text-xs text-muted tabular-nums">{c.session.start_time}</span>
                    <span className="font-medium text-ink">{c.course.name}</span>
                    <span className="text-xs text-muted">{SESSION_KIND_LABELS[c.session.kind]}</span>
                    {c.session.location && <span className="inline-flex items-center gap-0.5 text-xs text-muted"><MapPin size={10} />{c.session.location}</span>}
                    {live && <span className="rounded-full bg-accent px-1.5 text-[10px] font-medium text-surface">now</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-10 mb-4 font-serif text-lg text-ink/80 italic">
          {nothingLeft
            ? doneToday.length > 0 ? 'That’s everything for today. Rest counts too.' : 'Nothing is due today. Enjoy the space.'
            : today.length === 1 ? 'Just this one today.' : `Just ${Math.min(today.length, VISIBLE) === today.length ? 'these' : 'these first'}.`}
        </p>

        <div className="space-y-2.5">
          {visible.map((item) => (
            <FocusRow key={item.id} item={item} category={categoriesById.get(item.category_id)} onOpen={onOpen} onToggleDone={onToggleDone} />
          ))}
        </div>
        {!showAll && today.length > VISIBLE && (
          <button type="button" onClick={() => setShowAll(true)} className="mt-3 text-sm text-muted hover:text-ink">
            {today.length - VISIBLE} more today, when you’re ready
          </button>
        )}

        <form onSubmit={add} className="mt-6 flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-2.5 focus-within:border-accent">
          <Plus size={16} className="text-muted" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add something for today"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted/70" />
          {title.trim() && (
            <select value={chosenCategory} onChange={(e) => setCategoryId(Number(e.target.value))}
              className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink outline-none">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </form>

        {earlier.length > 0 && (
          <div className="mt-12">
            <button type="button" onClick={() => setShowEarlier((v) => !v)} className="text-sm text-behind hover:underline">
              {showEarlier ? 'Hide' : 'Also'} {earlier.length} from earlier{showEarlier ? '' : ', whenever you can'}
            </button>
            {showEarlier && (
              <div className="mt-3 space-y-2.5">
                {earlier.map((item) => (
                  <FocusRow key={item.id} item={item} category={categoriesById.get(item.category_id)} onOpen={onOpen}
                    onToggleDone={onToggleDone} earlier />
                ))}
              </div>
            )}
          </div>
        )}

        {doneToday.length > 0 && (
          <div className="mt-12">
            <div className="mb-2 text-sm text-accent">{doneToday.length} done today ✓</div>
            <ul className="space-y-1">
              {doneToday.map((item) => (
                <li key={item.id} className="flex items-center gap-2.5 text-sm text-muted">
                  <button type="button" onClick={() => onToggleDone(item)} title="Mark as not done"
                    className="flex size-4 items-center justify-center rounded-full bg-accent text-surface">
                    <Check size={10} strokeWidth={3} />
                  </button>
                  <span className="line-through">{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function FocusRow({ item, category, onOpen, onToggleDone, earlier }: {
  item: Item; category: Category | undefined; onOpen: (id: number) => void; onToggleDone: (item: Item) => void; earlier?: boolean;
}) {
  const due = effectiveDue(item);
  return (
    <div data-drop-item={item.id}
      className="group flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 shadow-sm transition-colors hover:border-accent/50">
      <button type="button" onClick={() => onToggleDone(item)} aria-label="Mark as done"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-muted/40 text-transparent transition-colors hover:border-accent hover:text-accent">
        <Check size={13} strokeWidth={3} />
      </button>
      <button type="button" onClick={() => onOpen(item.id)} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[17px] text-ink">{item.title}</div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted">
          <CategoryChip category={category} />
          {item.course && <span>{item.course}</span>}
          {due && earlier && <span className="text-behind">from {shortDate.format(due)}</span>}
          {due && !earlier && !item.all_day && <span>by {time24.format(due)}</span>}
          {item.attachment_count > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{item.attachment_count}</span>}
        </div>
      </button>
      {item.priority === 3 && <Flag size={14} className="shrink-0 text-warn" aria-label="High priority" />}
    </div>
  );
}
