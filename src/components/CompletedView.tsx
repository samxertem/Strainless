import type { Item } from '../lib/types';
import { Section } from './Section';
import { ItemRow, type RowContext } from './ItemRow';

const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

/** Everything finished, newest first, grouped by the month it was completed. */
export function CompletedView({ items, ctx }: { items: Item[]; ctx: RowContext }) {
  const done = items
    .filter((i) => i.status === 'done')
    .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));

  if (done.length === 0) {
    return <p className="px-1 text-sm text-muted">Nothing completed yet. Ticking things off will fill this page up.</p>;
  }

  const groups = new Map<string, Item[]>();
  for (const item of done) {
    const label = monthLabel.format(new Date(item.completed_at ?? item.updated_at));
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }

  return (
    <>
      {[...groups].map(([label, group]) => (
        <Section key={label} title={label} count={group.length}>
          {group.map((item) => <ItemRow key={item.id} item={item} ctx={ctx} />)}
        </Section>
      ))}
    </>
  );
}
