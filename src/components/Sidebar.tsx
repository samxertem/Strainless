import type { ReactNode } from 'react';
import { FolderOpen, Hourglass, LayoutDashboard, ListTodo, Monitor, Moon, Settings2, Sun } from 'lucide-react';
import type { Category } from '../lib/types';
import type { ThemePref } from '../lib/hooks';

export type View =
  | { kind: 'dashboard' }
  | { kind: 'all' }
  | { kind: 'waiting' }
  | { kind: 'category'; id: number };

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  categories: Category[];
  activeCounts: Map<number, number>;
  overdueCount: number;
  waitingCount: number;
  activeCount: number;
  themePref: ThemePref;
  onCycleTheme: () => void;
  onManageCategories: () => void;
  onOpenDataFolder: () => void;
}

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

export function Sidebar(p: Props) {
  const ThemeIcon = THEME_ICON[p.themePref];
  const is = (v: View) =>
    p.view.kind === v.kind && (v.kind !== 'category' || (p.view.kind === 'category' && p.view.id === v.id));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="px-5 pt-5 pb-4">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Strainless</div>
        <div className="text-xs text-muted">one thing at a time</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        <NavItem icon={<LayoutDashboard size={15} />} label="Dashboard" active={is({ kind: 'dashboard' })}
          badge={p.overdueCount || undefined} badgeTone="danger" onClick={() => p.onNavigate({ kind: 'dashboard' })} />
        <NavItem icon={<ListTodo size={15} />} label="All items" active={is({ kind: 'all' })}
          badge={p.activeCount || undefined} onClick={() => p.onNavigate({ kind: 'all' })} />
        <NavItem icon={<Hourglass size={15} />} label="Waiting" active={is({ kind: 'waiting' })}
          badge={p.waitingCount || undefined} onClick={() => p.onNavigate({ kind: 'waiting' })} />

        <div className="mt-5 mb-1 flex items-center justify-between px-2.5">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">Categories</span>
          <button type="button" onClick={p.onManageCategories} title="Manage categories"
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-ink">
            <Settings2 size={13} />
          </button>
        </div>
        {p.categories.map((c) => (
          <NavItem key={c.id} label={c.name} active={is({ kind: 'category', id: c.id })}
            icon={<span className="mx-[3.5px] size-2 rounded-full" style={{ background: c.color }} />}
            badge={p.activeCounts.get(c.id)} onClick={() => p.onNavigate({ kind: 'category', id: c.id })} />
        ))}
      </nav>

      <div className="flex gap-1 border-t border-line px-2.5 py-2.5">
        <FooterButton onClick={p.onCycleTheme} title={THEME_LABEL[p.themePref]}><ThemeIcon size={15} /></FooterButton>
        <FooterButton onClick={p.onOpenDataFolder} title="Open data folder (database + attachments)">
          <FolderOpen size={15} />
        </FooterButton>
      </div>
    </aside>
  );
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  badgeTone?: 'default' | 'danger';
  onClick: () => void;
}

function NavItem({ icon, label, active, badge, badgeTone = 'default', onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink/80 hover:bg-surface-2'
      }`}
    >
      <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className={`text-xs tabular-nums ${badgeTone === 'danger' ? 'font-medium text-danger' : 'text-muted'}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function FooterButton({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-ink">
      {children}
    </button>
  );
}
