import { useEffect, useState, type FormEvent, type RefObject } from 'react';
import { Plus } from 'lucide-react';
import type { Category, NewItem } from '../lib/types';
import { MOD } from './ui';

interface Props {
  categories: Category[];
  /** Category of the current view, if any; becomes the default for new items. */
  preferredCategoryId: number | null;
  /** Course of the current view, if any; new items get it automatically. */
  course: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdd: (input: NewItem) => Promise<void>;
}

export function QuickAdd({ categories, preferredCategoryId, course, inputRef, onAdd }: Props) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(preferredCategoryId);

  useEffect(() => {
    if (preferredCategoryId !== null) setCategoryId(preferredCategoryId);
  }, [preferredCategoryId]);

  // Fall back to the first category if the remembered one was deleted.
  const chosen = categories.some((c) => c.id === categoryId) ? categoryId : (categories[0]?.id ?? null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || chosen === null) return;
    await onAdd({ title: trimmed, category_id: chosen, course, due_at: date || null, all_day: Boolean(date) });
    setTitle('');
    setDate('');
  };

  return (
    <form
      onSubmit={submit}
      className="mb-8 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm focus-within:border-accent"
    >
      <Plus size={16} className="shrink-0 text-muted" />
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`Add something… (${MOD}N)`}
        className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted/70"
      />
      <select
        value={chosen ?? ''}
        onChange={(e) => setCategoryId(Number(e.target.value))}
        className="max-w-40 rounded-md bg-surface-2 px-2 py-1 text-xs text-ink outline-none"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        title="Due date (optional)"
        className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink outline-none"
      />
      <button type="submit" className="sr-only">Add</button>
    </form>
  );
}
