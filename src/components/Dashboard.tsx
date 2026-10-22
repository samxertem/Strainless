import type { Item } from '../lib/types';
import type { Bucket } from '../lib/buckets';
import { Section } from './Section';
import { ItemRow, type RowContext } from './ItemRow';

interface Props {
  groups: Record<Bucket, Item[]>;
  ctx: RowContext;
}

const SECTIONS: {
  bucket: Bucket; title: string; hint?: string; emptyText?: string; defaultOpen?: boolean; hideWhenEmpty?: boolean;
}[] = [
  { bucket: 'overdue', title: 'From earlier', hint: 'No guilt. Pick one when you have the energy, or move its date.', hideWhenEmpty: true },
  { bucket: 'today', title: 'Today', emptyText: 'Nothing due today.' },
  { bucket: 'thisWeek', title: 'Later this week', emptyText: 'Nothing else this week.' },
  { bucket: 'nextTwoWeeks', title: 'Next 2 weeks', emptyText: 'Clear for the next two weeks.' },
  { bucket: 'later', title: 'Later', defaultOpen: false, hideWhenEmpty: true },
  { bucket: 'noDate', title: 'No date', defaultOpen: false, hideWhenEmpty: true },
];

export function Dashboard({ groups, ctx }: Props) {
  return (
    <>
      {SECTIONS.map(({ bucket, title, hint, emptyText, defaultOpen, hideWhenEmpty }) => {
        const items = groups[bucket];
        // "From earlier" only appears when it matters; the near-term sections always show, to give the week a shape.
        if (hideWhenEmpty && items.length === 0) return null;
        return (
          <Section key={bucket} title={title} hint={hint} count={items.length} emptyText={emptyText}
            tone={bucket === 'overdue' ? 'behind' : 'default'} defaultOpen={defaultOpen}>
            {items.map((item) => <ItemRow key={item.id} item={item} ctx={ctx} />)}
          </Section>
        );
      })}
    </>
  );
}
