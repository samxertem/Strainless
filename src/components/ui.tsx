import type { ReactNode } from 'react';
import type { Category, Status } from '../lib/types';
import { STATUS_LABELS } from '../lib/types';

export function CategoryChip({ category }: { category: Category | undefined }) {
  if (!category) return null;
  return (
    <span className="inline-flex max-w-40 items-center gap-1.5 text-xs text-muted">
      <span className="size-2 shrink-0 rounded-full" style={{ background: category.color }} />
      <span className="truncate">{category.name}</span>
    </span>
  );
}

const STATUS_STYLES: Record<Status, string> = {
  todo: 'bg-surface-2 text-muted',
  in_progress: 'bg-accent-soft text-accent',
  waiting: 'bg-warn-soft text-warn',
  done: 'bg-surface-2 text-muted',
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`rounded-full px-2 py-px text-[11px] font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

interface SegmentedProps<T extends string | number> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            o.value === value ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">{children}</div>;
}

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none ' +
  'placeholder:text-muted/70 focus:border-accent';
