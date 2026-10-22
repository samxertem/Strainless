import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Category, Status } from '../lib/types';
import { MARK_END, MARK_START, STATUS_LABELS } from '../lib/types';

/** Modifier key label for shortcuts: ⌘ on macOS, Ctrl+ elsewhere. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

const MARKED_PART =new RegExp(`(${MARK_START}[^${MARK_END}]*${MARK_END})`);

/** Renders search-highlighted text as React nodes (never as HTML, so notes can't inject markup). */
export function Marked({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(MARKED_PART).map((part, i) =>
        part.startsWith(MARK_START) ? (
          <mark key={i} className="rounded-sm bg-warn-soft px-0.5 text-ink">{part.slice(1, -1)}</mark>
        ) : (
          part
        ),
      )}
    </span>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, onClose, width = 'w-[540px]', children, footer }: ModalProps) {
  // Capture phase: Escape closes this modal and doesn't also reach the app-level handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] ${width} max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles = {
    default: 'border border-line bg-surface text-ink hover:bg-surface-2',
    primary: 'bg-accent text-surface hover:opacity-90',
    danger: 'border border-line bg-surface text-danger hover:bg-danger-soft',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${styles[variant]}`}>
      {children}
    </button>
  );
}

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

/** Input styling without a width, for fields that set their own (rows of inputs). */
export const inputBase =
  'rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none ' +
  'placeholder:text-muted/70 focus:border-accent';

export const inputClass = `w-full ${inputBase}`;
