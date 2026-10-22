import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, FileText, ListChecks, NotebookPen, Paperclip, Search } from 'lucide-react';
import type { Category, CourseHit, Item, JournalHit, SearchHit } from '../lib/types';
import { MARK_END, MARK_START } from '../lib/types';
import * as db from '../lib/db';
import { searchCourses } from '../lib/courses';
import { indexProgress, searchFileText, type FileTextHit } from '../lib/fileText';
import { formatDue } from '../lib/dates';
import { CategoryChip, Marked, StatusPill } from './ui';
import { FileIcon } from './FileIcon';

interface Props {
  items: Item[];
  categoriesById: Map<number, Category>;
  now: Date;
  onPick: (id: number) => void;
  onPickJournal: (day: string) => void;
  onPickCourse: (hit: CourseHit) => void;
  /** A page or slide whose text matched; `query` is what to mark on it. */
  onPickFileText: (hit: FileTextHit, query: string) => void;
  onClose: () => void;
}

type Result =
  | { type: 'item'; hit: SearchHit }
  | { type: 'course'; hit: CourseHit }
  | { type: 'text'; hit: FileTextHit }
  | { type: 'journal'; hit: JournalHit };

const COURSE_KIND_LABEL: Record<CourseHit['kind'], string> = { file: 'Library', topic: 'Topic', note: 'Note', quote: 'Quote' };

const journalDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Wraps the first case-insensitive occurrence of `query` in highlight marks. */
function markSubstring(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || !query.trim()) return text;
  const end = at + query.trim().length;
  return `${text.slice(0, at)}${MARK_START}${text.slice(at, end)}${MARK_END}${text.slice(end)}`;
}

/** Snippets come from raw markdown; drop the syntax so "**Problems** - [x] 3.1" reads "Problems 3.1". */
const stripMarkdown = (s: string) =>
  s
    .replace(/(^|\s)[-*+]\s+\[[ xX]\]\s*/g, '$1') // task list markers
    .replace(/\]\([^)]*\)?/g, '') // link targets, even when the snippet cut them off
    .replace(/[*_`#>[\]]+/g, ''); // emphasis, code, headings, quotes, brackets

export function SearchPalette({ items, categoriesById, now, onPick, onPickJournal, onPickCourse, onPickFileText, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [journalHits, setJournalHits] = useState<JournalHit[]>([]);
  const [courseHits, setCourseHits] = useState<CourseHit[]>([]);
  const [textHits, setTextHits] = useState<FileTextHit[]>([]);
  const indexing = useSyncExternalStore(indexProgress.subscribe, indexProgress.get);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    const id = ++requestId.current;
    if (!query.trim()) {
      setHits([]);
      setJournalHits([]);
      setCourseHits([]);
      setTextHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      Promise.all([db.search(query), searchCourses(query), searchFileText(query), db.searchJournal(query)]).then(
        ([itemHits, courseResults, textResults, pages]) => {
          if (id !== requestId.current) return; // a newer query is in flight; drop this stale response
          setHits(itemHits);
          setCourseHits(courseResults);
          setTextHits(textResults);
          setJournalHits(pages);
          setError(null);
        },
        (e) => id === requestId.current && setError(String(e)),
      );
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => setActive(0), [hits, journalHits, courseHits, textHits, query]);

  // With no query, show what was touched most recently: usually what you're looking for.
  const itemResults: SearchHit[] = query.trim()
    ? hits.filter((h) => itemsById.has(h.id))
    : [...items]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 8)
        .map((i) => ({ id: i.id, title: null, course: null, notes: null }));
  const results: Result[] = [
    ...itemResults.map((hit) => ({ type: 'item' as const, hit })),
    ...(query.trim() ? courseHits.map((hit) => ({ type: 'course' as const, hit })) : []),
    ...(query.trim() ? textHits.map((hit) => ({ type: 'text' as const, hit })) : []),
    ...(query.trim() ? journalHits.map((hit) => ({ type: 'journal' as const, hit })) : []),
  ];
  const pick = (r: Result) =>
    r.type === 'item' ? onPick(r.hit.id)
    : r.type === 'course' ? onPickCourse(r.hit)
    : r.type === 'text' ? onPickFileText(r.hit, query)
    : onPickJournal(r.hit.day);
  const firstOf = (type: Result['type']) => results.findIndex((r) => r.type === type);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
      else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
      else if (e.key === 'Enter' && results[active]) pick(results[active]);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-6 pt-[12vh]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-[640px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={17} className="shrink-0 text-muted" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, courses, files, notes and your journal…"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted/70" />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>

        <div ref={list} className="min-h-0 overflow-y-auto p-1.5">
          {!query.trim() && results.length > 0 && (
            <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Recently edited</div>
          )}
          {results.map((result, index) => {
            if (result.type === 'course') {
              const h = result.hit;
              const Icon = h.kind === 'topic' ? ListChecks : h.kind === 'note' ? FileText : BookOpen;
              return (
                <div key={`c-${h.kind}-${h.target_id}`}>
                  {index === firstOf('course') && (
                    <div className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Courses</div>
                  )}
                  <button type="button" data-index={index} onMouseMove={() => setActive(index)} onClick={() => pick(result)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${index === active ? 'bg-accent-soft' : ''}`}>
                    {h.kind === 'file' ? <FileIcon name={h.label} size={14} tinted className="shrink-0" /> : <Icon size={14} className="shrink-0 text-muted" />}
                    <Marked text={markSubstring(h.label, query)} className="min-w-0 flex-1 truncate text-sm text-ink" />
                    <span className="shrink-0 text-xs text-muted">{h.course_name} · {COURSE_KIND_LABEL[h.kind]}</span>
                  </button>
                </div>
              );
            }
            if (result.type === 'text') {
              const h = result.hit;
              return (
                <div key={`t-${h.file.ref}-${h.location}`}>
                  {index === firstOf('text') && (
                    <div className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Inside your files</div>
                  )}
                  <button type="button" data-index={index} onMouseMove={() => setActive(index)} onClick={() => pick(result)}
                    className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left ${index === active ? 'bg-accent-soft' : ''}`}>
                    <div className="flex w-full items-center gap-2">
                      <FileIcon name={h.file.name} size={14} tinted className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{h.file.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {h.courseName && <>{h.courseName} · </>}{h.segmentLabel} {h.location + 1}
                      </span>
                    </div>
                    <Marked text={h.snippet} className="line-clamp-2 pl-[22px] text-xs text-muted" />
                  </button>
                </div>
              );
            }
            if (result.type === 'journal') {
              const first = index === firstOf('journal');
              return (
                <div key={`j-${result.hit.day}`}>
                  {first && <div className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Journal</div>}
                  <button type="button" data-index={index} onMouseMove={() => setActive(index)} onClick={() => pick(result)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${index === active ? 'bg-accent-soft' : ''}`}>
                    <NotebookPen size={14} className="shrink-0 text-muted" />
                    <span className="shrink-0 text-sm text-ink">{journalDate.format(new Date(`${result.hit.day}T00:00`))}</span>
                    <Marked text={markSubstring(result.hit.snippet, query)} className="min-w-0 truncate text-xs text-muted" />
                  </button>
                </div>
              );
            }
            const hit = result.hit;
            const item = itemsById.get(hit.id)!;
            const notes = hit.notes?.includes(MARK_START) ? stripMarkdown(hit.notes) : null;
            return (
              <button key={hit.id} type="button" data-index={index}
                onMouseMove={() => setActive(index)} onClick={() => onPick(hit.id)}
                className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left ${index === active ? 'bg-accent-soft' : ''}`}>
                <div className="flex w-full items-center gap-2">
                  <Marked text={hit.title ?? item.title}
                    className={`min-w-0 flex-1 truncate text-sm ${item.status === 'done' ? 'text-muted line-through' : 'text-ink'}`} />
                  {item.status !== 'todo' && <StatusPill status={item.status} />}
                  <CategoryChip category={categoriesById.get(item.category_id)} />
                  {item.due_at && <span className="w-24 shrink-0 text-right text-xs text-muted tabular-nums">{formatDue(item, now)}</span>}
                </div>
                {(hit.course?.includes(MARK_START) || notes || hit.attachment) && (
                  <div className="flex min-w-0 items-center gap-3 text-xs text-muted">
                    {hit.course?.includes(MARK_START) && <Marked text={hit.course} className="shrink-0" />}
                    {notes && <Marked text={notes} className="min-w-0 truncate" />}
                    {hit.attachment && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Paperclip size={11} className="shrink-0" />
                        <Marked text={markSubstring(hit.attachment, query)} className="truncate" />
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
          {query.trim() && results.length === 0 && !error && (
            <p className="px-3 py-8 text-center text-sm text-muted">No matches for “{query.trim()}”.</p>
          )}
          {error && <p className="px-3 py-4 text-xs text-danger">{error}</p>}
        </div>

        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>↑↓ to move</span><span>Enter to open</span>
          {indexing
            ? <span className="ml-auto">Reading your files for search… {indexing.done} of {indexing.total}</span>
            : <span>Typing “cap” also finds “ÇAP”</span>}
        </div>
      </div>
    </div>
  );
}
