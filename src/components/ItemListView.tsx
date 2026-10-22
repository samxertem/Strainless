import { useState } from 'react';
import { Flag } from 'lucide-react';
import type { Category, Item, Status } from '../lib/types';
import { compareItems } from '../lib/buckets';
import { Section } from './Section';
import { ItemRow, type RowContext } from './ItemRow';

interface Props {
  items: Item[];
  ctx: RowContext;
  categories: Category[];
  courses: string[];
  /** Hide filters that the view already fixes (e.g. category inside a category view). */
  fixed: { category?: boolean; course?: boolean };
  emptyText: string;
}

type StatusFilter = 'open' | Exclude<Status, 'done'>;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'All open' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
];

export function ItemListView({ items, ctx, categories, courses, fixed, emptyText }: Props) {
  const [status, setStatus] = useState<StatusFilter>('open');
  const [highOnly, setHighOnly] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [course, setCourse] = useState<string | null>(null);

  const matches = (i: Item) =>
    (!highOnly || i.priority === 3) &&
    (categoryId === null || i.category_id === categoryId) &&
    (course === null || i.course === course);

  const active = items
    .filter((i) => i.status !== 'done' && (status === 'open' || i.status === status) && matches(i))
    .sort(compareItems);
  const done = items
    .filter((i) => i.status === 'done' && matches(i))
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const filtering = status !== 'open' || highOnly || categoryId !== null || course !== null;

  const select = 'rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink outline-none';

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setStatus(f.value)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                status === f.value ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setHighOnly((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
            highOnly ? 'border-warn bg-warn-soft text-warn' : 'border-line bg-surface text-muted hover:text-ink'
          }`}>
          <Flag size={11} /> High priority
        </button>
        {!fixed.category && (
          <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            className={select}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {!fixed.course && courses.length > 0 && (
          <select value={course ?? ''} onChange={(e) => setCourse(e.target.value || null)} className={select}>
            <option value="">All courses</option>
            {courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {filtering && (
          <button type="button" className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => { setStatus('open'); setHighOnly(false); setCategoryId(null); setCourse(null); }}>
            Clear filters
          </button>
        )}
      </div>

      <Section title={status === 'open' ? 'Open' : STATUS_FILTERS.find((f) => f.value === status)!.label}
        count={active.length} emptyText={filtering ? 'Nothing matches these filters.' : emptyText}>
        {active.map((item) => <ItemRow key={item.id} item={item} ctx={ctx} showCategory={!fixed.category} />)}
      </Section>
      {status === 'open' && done.length > 0 && (
        <Section title="Done" count={done.length} defaultOpen={false}>
          {done.map((item) => <ItemRow key={item.id} item={item} ctx={ctx} showCategory={!fixed.category} />)}
        </Section>
      )}
    </>
  );
}
