import type { Category, Item } from '../lib/types';
import type { Bucket } from '../lib/buckets';
import { Section } from './Section';
import { ItemRow } from './ItemRow';

interface Props {
  groups: Record<Bucket, Item[]>;
  categoriesById: Map<number, Category>;
  now: Date;
  selectedId: number | null;
  onOpen: (id: number) => void;
  onToggleDone: (item: Item) => void;
}

const SECTIONS: { bucket: Bucket; title: string; emptyText?: string; defaultOpen?: boolean }[] = [
  { bucket: 'overdue', title: 'Overdue' },
  { bucket: 'today', title: 'Today', emptyText: 'Nothing due today.' },
  { bucket: 'thisWeek', title: 'Later this week', emptyText: 'Nothing else this week.' },
  { bucket: 'nextTwoWeeks', title: 'Next 2 weeks', emptyText: 'Clear for the next two weeks.' },
  { bucket: 'later', title: 'Later', defaultOpen: false },
  { bucket: 'noDate', title: 'No date', defaultOpen: false },
];

export function Dashboard({ groups, categoriesById, now, selectedId, onOpen, onToggleDone }: Props) {
  return (
    <>
      {SECTIONS.map(({ bucket, title, emptyText, defaultOpen }) => {
        const items = groups[bucket];
        // Overdue only appears when it matters; the others always show, for a sense of the shape of the week.
        if (bucket === 'overdue' && items.length === 0) return null;
        if ((bucket === 'later' || bucket === 'noDate') && items.length === 0) return null;
        return (
          <Section key={bucket} title={title} count={items.length} emptyText={emptyText}
            tone={bucket === 'overdue' ? 'danger' : 'default'} defaultOpen={defaultOpen}>
            {items.map((item) => (
              <ItemRow key={item.id} item={item} category={categoriesById.get(item.category_id)} now={now}
                selected={item.id === selectedId} onOpen={() => onOpen(item.id)} onToggleDone={() => onToggleDone(item)} />
            ))}
          </Section>
        );
      })}
    </>
  );
}
