import { Check, Flag, Paperclip } from 'lucide-react';
import type { Category, Item } from '../lib/types';
import { effectiveDue, formatDue, dayDiff } from '../lib/dates';
import { CategoryChip, StatusPill } from './ui';

interface Props {
  item: Item;
  category: Category | undefined;
  now: Date;
  selected: boolean;
  showCategory?: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
}

export function ItemRow({ item, category, now, selected, showCategory = true, onOpen, onToggleDone }: Props) {
  const done = item.status === 'done';
  const due = effectiveDue(item);
  const overdue = !done && due !== null && due < now;
  const dueToday = !done && !overdue && due !== null && dayDiff(now, due) === 0;
  const dueColor = overdue ? 'text-danger' : dueToday ? 'text-accent' : 'text-muted';
  const showStatus = item.status === 'in_progress' || item.status === 'waiting';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className={`flex cursor-default items-center gap-3 px-4 py-2.5 outline-none transition-colors focus-visible:bg-surface-2 ${
        selected ? 'bg-accent-soft' : 'hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
        className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          done ? 'border-accent bg-accent text-surface' : 'border-muted/50 hover:border-accent'
        }`}
      >
        {done && <Check size={11} strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className={`truncate text-[14px] ${done ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</div>
        {(item.course || showStatus) && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            {showStatus && <StatusPill status={item.status} />}
            {item.course && <span className="truncate">{item.course}</span>}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {item.priority === 3 && !done && <Flag size={13} className="text-warn" aria-label="High priority" />}
        {item.attachment_count > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted">
            <Paperclip size={12} />
            {item.attachment_count}
          </span>
        )}
        {showCategory && <CategoryChip category={category} />}
        {due && <span className={`w-28 text-right text-xs tabular-nums ${dueColor}`}>{formatDue(item, now)}</span>}
      </div>
    </div>
  );
}
