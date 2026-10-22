import type { RefObject } from 'react';
import { Clock, MapPin, Pencil } from 'lucide-react';
import type { Category, Course, CourseSession, Item, NewItem } from '../../lib/types';
import { SESSION_KIND_LABELS } from '../../lib/types';
import type { RowContext } from '../ItemRow';
import { ItemListView } from '../ItemListView';
import { QuickAdd } from '../QuickAdd';
import { StarredList } from '../StarredList';
import { TopicsTab } from './TopicsTab';
import { LibraryTab } from './LibraryTab';
import { NotesTab } from './NotesTab';

export type CourseTab = 'topics' | 'library' | 'notes' | 'starred' | 'tasks';

interface Props {
  course: Course;
  sessions: CourseSession[];
  items: Item[];
  categories: Category[];
  courseNames: string[];
  ctx: RowContext;
  tab: CourseTab;
  onTab: (tab: CourseTab) => void;
  /** Open this note when the Notes tab mounts (from search). */
  noteId?: number;
  refreshKey: number;
  dropKey: string | null;
  quickAddRef: RefObject<HTMLInputElement | null>;
  onEdit: () => void;
  onAddItem: (input: NewItem) => Promise<void>;
  onChanged: () => void;
  onError: (message: string) => void;
}

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CourseView(p: Props) {
  const { course } = p;
  const courseItems = p.items.filter((i) => i.course === course.name);
  const open = courseItems.filter((i) => i.status !== 'done').length;

  const tabs: { key: CourseTab; label: string; count?: number }[] = [
    { key: 'topics', label: 'Topics', count: course.topic_count || undefined },
    { key: 'library', label: 'Library', count: course.file_count || undefined },
    { key: 'notes', label: 'Notes' },
    { key: 'starred', label: 'Starred' },
    { key: 'tasks', label: 'Tasks', count: open || undefined },
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6 flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold text-white"
          style={{ background: course.color }}>
          {course.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{course.name}</h1>
          {(course.title || course.instructor) && (
            <p className="mt-0.5 text-sm text-muted">{[course.title, course.instructor].filter(Boolean).join(' · ')}</p>
          )}
          {p.sessions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {p.sessions.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink">
                  <Clock size={11} className="text-muted" />
                  {SHORT_DAYS[s.weekday]} {s.start_time}–{s.end_time}
                  <span className="text-muted">{SESSION_KIND_LABELS[s.kind]}</span>
                  {s.location && <span className="inline-flex items-center gap-0.5 text-muted"><MapPin size={10} />{s.location}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={p.onEdit}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-2">
          <Pencil size={13} /> Edit{p.sessions.length === 0 ? ' & add schedule' : ''}
        </button>
      </header>

      <div className="mb-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => p.onTab(t.key)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm transition-colors ${
              p.tab === t.key ? 'font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            style={p.tab === t.key ? { borderColor: course.color } : undefined}>
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
          </button>
        ))}
      </div>

      {p.tab === 'topics' && (
        <TopicsTab course={course} refreshKey={p.refreshKey} dropKey={p.dropKey} onChanged={p.onChanged} onError={p.onError} />
      )}
      {p.tab === 'library' && (
        <LibraryTab course={course} refreshKey={p.refreshKey} dropKey={p.dropKey} onChanged={p.onChanged} onError={p.onError} />
      )}
      {p.tab === 'notes' && <NotesTab key={course.id} course={course} initialNoteId={p.noteId} onError={p.onError} />}
      {p.tab === 'starred' && (
        <StarredList courseId={course.id} showCourse={false}
          emptyText={`Nothing starred in ${course.name} yet. Open a slide deck or PDF, select a sentence and press ★.`} />
      )}
      {p.tab === 'tasks' && (
        <>
          <QuickAdd categories={p.categories} inputRef={p.quickAddRef} onAdd={p.onAddItem} preferredCategoryId={null} course={course.name} />
          <ItemListView key={course.id} items={courseItems} ctx={p.ctx} categories={p.categories} courses={p.courseNames}
            fixed={{ course: true }} emptyText={`No tasks for ${course.name} yet. Add homework, quizzes and exams above.`} />
        </>
      )}
    </div>
  );
}
