import type { ReactNode } from 'react';
import {
  Archive, CalendarDays, CircleCheck, FolderOpen, Folders, GraduationCap, Hourglass, LayoutDashboard, ListTodo, Monitor, Moon,
  NotebookPen, Plus, Search, Settings, Settings2, Star, Sun, Sunrise,
} from 'lucide-react';
import type { Category, Course } from '../lib/types';
import type { ThemePref } from '../lib/hooks';
import type { CourseTab } from './course/CourseView';
import { MOD } from './ui';

export type View =
  | { kind: 'dashboard' }
  | { kind: 'focus' }
  | { kind: 'journal'; day: string }
  | { kind: 'calendar' }
  | { kind: 'prep' }
  | { kind: 'all' }
  | { kind: 'waiting' }
  | { kind: 'completed' }
  | { kind: 'starred' }
  | { kind: 'documents'; folderId?: number | null }
  | { kind: 'category'; id: number }
  | { kind: 'course'; id: number; tab: CourseTab; noteId?: number };

export const sameView = (a: View, b: View) =>
  a.kind === b.kind &&
  (a.kind !== 'category' || (b.kind === 'category' && a.id === b.id)) &&
  (a.kind !== 'course' || (b.kind === 'course' && a.id === b.id && a.tab === b.tab && a.noteId === b.noteId)) &&
  (a.kind !== 'journal' || (b.kind === 'journal' && a.day === b.day)) &&
  (a.kind !== 'documents' || (b.kind === 'documents' && (a.folderId ?? null) === (b.folderId ?? null)));

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  categories: Category[];
  activeCounts: Map<number, number>;
  courses: Course[];
  /** Open tasks per course name. */
  courseOpenCounts: Map<string, number>;
  onAddCourse: () => void;
  overdueCount: number;
  waitingCount: number;
  activeCount: number;
  /** Items in today's focus list (due today + from earlier). */
  focusCount: number;
  /** Exams coming up, for the Exam prep badge. */
  examCount: number;
  todayKey: string;
  /** Days since the last backup, `null` if never; `undefined` hides the nudge. */
  backupAgeDays: number | null | undefined;
  /** The weekly automatic backup is being written. */
  backupRunning: boolean;
  themePref: ThemePref;
  onCycleTheme: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onManageCategories: () => void;
  onOpenDataFolder: () => void;
}

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };

export function Sidebar(p: Props) {
  const ThemeIcon = THEME_ICON[p.themePref];
  const is = (v: View) => sameView(p.view, v);
  const go = (v: View) => () => p.onNavigate(v);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar select-none">
      <div className="px-5 pt-5 pb-3">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Strainless</div>
        <div className="text-xs text-muted">one thing at a time</div>
      </div>

      <div className="px-2.5 pb-2">
        <button type="button" onClick={p.onSearch}
          className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[13px] text-muted transition-colors hover:text-ink">
          <Search size={14} />
          <span className="flex-1">Search</span>
          <kbd className="text-[10px]">{MOD}K</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        <NavItem icon={<Sunrise size={15} />} label="Today" active={is({ kind: 'focus' })}
          badge={p.focusCount} onClick={go({ kind: 'focus' })} />
        <NavItem icon={<LayoutDashboard size={15} />} label="Dashboard" active={is({ kind: 'dashboard' })}
          badge={p.overdueCount} badgeTone="behind" onClick={go({ kind: 'dashboard' })} />
        <NavItem icon={<NotebookPen size={15} />} label="Journal" active={p.view.kind === 'journal'}
          onClick={go({ kind: 'journal', day: p.todayKey })} />
        <NavItem icon={<CalendarDays size={15} />} label="Calendar" active={is({ kind: 'calendar' })}
          onClick={go({ kind: 'calendar' })} />
        <NavItem icon={<GraduationCap size={15} />} label="Exam prep" active={is({ kind: 'prep' })}
          badge={p.examCount} onClick={go({ kind: 'prep' })} />
        <NavItem icon={<ListTodo size={15} />} label="All items" active={is({ kind: 'all' })}
          badge={p.activeCount} onClick={go({ kind: 'all' })} />
        <NavItem icon={<Hourglass size={15} />} label="Waiting" active={is({ kind: 'waiting' })}
          badge={p.waitingCount} onClick={go({ kind: 'waiting' })} />
        <NavItem icon={<CircleCheck size={15} />} label="Completed" active={is({ kind: 'completed' })}
          onClick={go({ kind: 'completed' })} />
        <NavItem icon={<Star size={15} />} label="Starred" active={is({ kind: 'starred' })}
          onClick={go({ kind: 'starred' })} />
        <NavItem icon={<Folders size={15} />} label="Documents" active={p.view.kind === 'documents'}
          onClick={go({ kind: 'documents' })} />

        <Heading action={
          <button type="button" onClick={p.onAddCourse} title="New course"
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-ink">
            <Plus size={13} />
          </button>
        }>Courses</Heading>
        {p.courses.length === 0 && (
          <button type="button" onClick={p.onAddCourse}
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-ink">
            + Add your first course
          </button>
        )}
        {p.courses.map((c) => (
          <NavItem key={c.id} label={c.name} active={p.view.kind === 'course' && p.view.id === c.id}
            icon={<span className="mx-[2.5px] size-2.5 rounded-[3px]" style={{ background: c.color }} />}
            badge={p.courseOpenCounts.get(c.name)} onClick={go({ kind: 'course', id: c.id, tab: 'topics' })} />
        ))}

        <Heading action={
          <button type="button" onClick={p.onManageCategories} title="Manage categories"
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-ink">
            <Settings2 size={13} />
          </button>
        }>Categories</Heading>
        {p.categories.map((c) => (
          <NavItem key={c.id} label={c.name} active={is({ kind: 'category', id: c.id })}
            icon={<span className="mx-[3.5px] size-2 rounded-full" style={{ background: c.color }} />}
            badge={p.activeCounts.get(c.id)} onClick={go({ kind: 'category', id: c.id })} />
        ))}
      </nav>

      {p.backupRunning ? (
        <div className="mx-2.5 mb-2 flex items-center gap-2 px-2.5 py-2 text-xs text-muted">
          <Archive size={14} className="shrink-0 animate-pulse" /> Backing up…
        </div>
      ) : p.backupAgeDays !== undefined && (p.backupAgeDays === null || p.backupAgeDays >= 7) && (
        <button type="button" onClick={p.onSettings}
          className="mx-2.5 mb-2 flex items-center gap-2 rounded-lg bg-warn-soft px-2.5 py-2 text-left text-xs text-warn">
          <Archive size={14} className="shrink-0" />
          <span>{p.backupAgeDays === null ? 'No backup yet. Make one?' : `Last backup ${p.backupAgeDays} days ago`}</span>
        </button>
      )}

      <div className="flex gap-1 border-t border-line px-2.5 py-2.5">
        <FooterButton onClick={p.onSettings} title={`Settings (${MOD},)`}><Settings size={15} /></FooterButton>
        <FooterButton onClick={p.onCycleTheme} title={THEME_LABEL[p.themePref]}><ThemeIcon size={15} /></FooterButton>
        <FooterButton onClick={p.onOpenDataFolder} title="Open data folder (database + attachments)">
          <FolderOpen size={15} />
        </FooterButton>
      </div>
    </aside>
  );
}

function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-5 mb-1 flex items-center justify-between px-2.5">
      <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{children}</span>
      {action}
    </div>
  );
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  badgeTone?: 'default' | 'behind';
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
        <span className={`text-xs tabular-nums ${badgeTone === 'behind' ? 'font-medium text-behind' : 'text-muted'}`}>
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
