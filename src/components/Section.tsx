import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  title: string;
  count: number;
  tone?: 'default' | 'danger';
  defaultOpen?: boolean;
  emptyText?: string;
  children: ReactNode;
}

export function Section({ title, count, tone = 'default', defaultOpen = true, emptyText, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-7">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink"
      >
        <ChevronRight size={14} className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={tone === 'danger' ? 'text-danger' : ''}>{title}</span>
        <span className="font-normal text-muted">{count}</span>
      </button>
      {open &&
        (count > 0 ? (
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">{children}</div>
        ) : (
          emptyText && <p className="px-5 py-1 text-sm text-muted">{emptyText}</p>
        ))}
    </section>
  );
}
