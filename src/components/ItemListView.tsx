import type { Category, Item } from '../lib/types';
import { compareItems } from '../lib/buckets';
import { Section } from './Section';
import { ItemRow } from './ItemRow';

interface Props {
  items: Item[];
  categoriesById: Map<number, Category>;
  now: Date;
  selectedId: number | null;
  /** False inside a single-category view, where the chip would be redundant. */
  showCategory: boolean;
  emptyText: string;
  onOpen: (id: number) => void;
  onToggleDone: (item: Item) => void;
}

export function ItemListView({ items, categoriesById, now, selectedId, showCategory, emptyText, onOpen, onToggleDone }: Props) {
  const active = items.filter((i) => i.status !== 'done').sort(compareItems);
  const done = items
    .filter((i) => i.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));

  const row = (item: Item) => (
    <ItemRow key={item.id} item={item} category={categoriesById.get(item.category_id)} now={now}
      selected={item.id === selectedId} showCategory={showCategory}
      onOpen={() => onOpen(item.id)} onToggleDone={() => onToggleDone(item)} />
  );

  return (
    <>
      <Section title="Open" count={active.length} emptyText={emptyText}>{active.map(row)}</Section>
      {done.length > 0 && (
        <Section title="Done" count={done.length} defaultOpen={false}>{done.map(row)}</Section>
      )}
    </>
  );
}
