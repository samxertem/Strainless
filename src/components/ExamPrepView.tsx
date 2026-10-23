import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, ListChecks, Star } from 'lucide-react';
import type { Category, Course, CourseFile, CourseTopic, Item, StarredQuote } from '../lib/types';
import * as coursesDb from '../lib/courses';
import { listStarred } from '../lib/annotations';
import { courseFilePreview, previewOfKind, type PreviewFile } from '../lib/files';
import { formatDue } from '../lib/dates';
import { listExamTopics, setExamTopics, studyPlan, suggestedScope, upcomingExams, type Exam, type StudyPlan } from '../lib/exams';
import { NEXT_STATUS, StatusButton } from './course/TopicsTab';
import { FileIcon } from './FileIcon';
import { Preview } from './Preview';
import { Button } from './ui';

interface Props {
  items: Item[];
  categoriesById: Map<number, Category>;
  courses: Course[];
  now: Date;
  onOpenItem: (id: number) => void;
  onOpenCourse: (id: number) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

interface CourseData {
  topics: CourseTopic[];
  files: CourseFile[];
  starred: StarredQuote[];
}

/** Everything one exam card shows, worked out from the loaded data. */
interface ExamCard {
  exam: Exam;
  course: Course | undefined;
  data: CourseData | undefined;
  scope: CourseTopic[];
  chosenByHand: boolean;
  plan: StudyPlan;
  starred: StarredQuote[];
}

type Open = { files: PreviewFile[]; index: number; annotationId?: number } | null;

const daysText = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

function starredPreview(q: StarredQuote): PreviewFile {
  const id = Number(q.file_ref.split(':')[1]);
  const file = { id, original_name: q.file_name, stored_name: q.stored_name, mime: q.mime };
  return previewOfKind(q.file_kind, file, q.owner_id);
}

export function ExamPrepView({ items, categoriesById, courses, now, onOpenItem, onOpenCourse, onChanged, onError }: Props) {
  const exams = useMemo(() => upcomingExams(items, categoriesById, now), [items, categoriesById, now]);
  const coursesByName = useMemo(() => new Map(courses.map((c) => [c.name, c])), [courses]);
  const [data, setData] = useState<Map<number, CourseData> | null>(null);
  const [chosen, setChosen] = useState<Map<number, number[]>>(new Map());
  const [open, setOpen] = useState<Open>(null);

  const courseIds = useMemo(
    () => [...new Set(exams.map((e) => coursesByName.get(e.item.course ?? '')?.id).filter((id): id is number => id !== undefined))],
    [exams, coursesByName],
  );
  const courseKey = courseIds.join(',');

  const load = useCallback(async () => {
    try {
      const ids = courseKey ? courseKey.split(',').map(Number) : [];
      const loaded = await Promise.all(
        ids.map(async (id) => {
          const [topics, files, starred] = await Promise.all([coursesDb.listTopics(id), coursesDb.listCourseFiles(id), listStarred(id)]);
          return [id, { topics, files, starred }] as const;
        }),
      );
      setData(new Map(loaded));
      setChosen(await listExamTopics());
    } catch (e) {
      onError(String(e));
    }
  }, [courseKey, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch (e) {
      onError(String(e));
    }
    await load();
    onChanged();
  };

  const cards: ExamCard[] = useMemo(() => {
    if (!data) return [];
    return exams.map((exam) => {
      const course = coursesByName.get(exam.item.course ?? '');
      const d = course ? data.get(course.id) : undefined;
      const topics = d?.topics ?? [];
      const picked = chosen.get(exam.item.id);
      const withFiles = new Set((d?.files ?? []).map((f) => f.topic_id).filter((id): id is number => id !== null));
      const scope = picked ? topics.filter((t) => picked.includes(t.id)) : suggestedScope(exam.kind, topics, withFiles);
      // Starred lines from the files of these topics, plus files not filed under any topic.
      const scopeIds = new Set(scope.map((t) => t.id));
      const topicOfFile = new Map((d?.files ?? []).map((f) => [f.id, f.topic_id]));
      const starred = (d?.starred ?? []).filter((q) => {
        if (q.file_kind !== 'course_file') return true;
        const topic = topicOfFile.get(Number(q.file_ref.split(':')[1]));
        return topic == null || scopeIds.has(topic);
      });
      return { exam, course, data: d, scope, chosenByHand: !!picked, plan: studyPlan(scope, exam.due, now), starred };
    });
  }, [data, exams, coursesByName, chosen, now]);

  const cycleStatus = (t: CourseTopic) => void act(() => coursesDb.updateTopic(t.id, { status: NEXT_STATUS[t.status] }));
  const openFiles = (files: CourseFile[], index: number) => setOpen({ files: files.map(courseFilePreview), index });

  const next = exams[0];

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Exam prep</h1>
        <p className="mt-0.5 text-sm text-muted">
          {next
            ? `${exams.length} exam${exams.length === 1 ? '' : 's'} coming up · next: ${next.item.title}, ${formatDue(next.item, now)}`
            : 'No exams coming up. Add one as a task in Midterms, Finals or Quizzes and it shows here.'}
        </p>
      </header>

      <div className="space-y-4">
        {cards.map((card, i) => (
          <ExamCardView key={card.exam.item.id} card={card} now={now} defaultOpen={i === 0}
            onOpenItem={() => onOpenItem(card.exam.item.id)}
            onOpenCourse={() => card.course && onOpenCourse(card.course.id)}
            onCycle={cycleStatus}
            onOpenFiles={openFiles}
            onOpenQuote={(q) => setOpen({ files: [starredPreview(q)], index: 0, annotationId: q.id })}
            onSaveScope={(ids) => void act(() => setExamTopics(card.exam.item.id, ids))} />
        ))}
      </div>

      {open && (
        <Preview files={open.files} index={open.index} initialAnnotationId={open.annotationId}
          onIndexChange={(index) => setOpen((o) => o && { ...o, index })}
          onClose={() => {
            setOpen(null);
            void load(); // stars may have changed
          }} />
      )}
    </div>
  );
}

interface CardProps {
  card: ExamCard;
  now: Date;
  defaultOpen: boolean;
  onOpenItem: () => void;
  onOpenCourse: () => void;
  onCycle: (t: CourseTopic) => void;
  onOpenFiles: (files: CourseFile[], index: number) => void;
  onOpenQuote: (q: StarredQuote) => void;
  onSaveScope: (topicIds: number[] | null) => void;
}

function ExamCardView({ card, now, defaultOpen, onOpenItem, onOpenCourse, onCycle, onOpenFiles, onOpenQuote, onSaveScope }: CardProps) {
  const { exam, course, data, scope, plan, starred } = card;
  const [section, setSection] = useState<'topics' | 'starred' | 'choose' | null>(defaultOpen ? 'topics' : null);
  const color = course?.color ?? 'var(--accent)';
  const done = scope.filter((t) => t.status === 'done').length;
  const studying = scope.filter((t) => t.status === 'studying').length;
  const toggle = (s: 'topics' | 'starred') => setSection((cur) => (cur === s ? null : s));

  const filesByTopic = useMemo(() => {
    const map = new Map<number, CourseFile[]>();
    for (const f of data?.files ?? []) if (f.topic_id !== null) map.set(f.topic_id, [...(map.get(f.topic_id) ?? []), f]);
    return map;
  }, [data?.files]);

  let advice: string;
  if (!course) advice = 'Set a course on this exam to see its topics and slides here.';
  else if (!data?.topics.length) advice = `${course.name} has no topics yet. Add the syllabus weeks in its Topics tab to get a plan.`;
  else if (!plan.remaining.length) advice = 'All topics done. Go over your starred lines once more and you’re ready. ✓';
  else if (plan.daysLeft <= 1) advice = `${plan.remaining.length} topic${plan.remaining.length === 1 ? '' : 's'} left. Skim them and your starred lines; sleep matters too.`;
  else advice = `About ${plan.perDay} topic${plan.perDay === 1 ? '' : 's'} a day finishes everything the day before.`;

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <button type="button" onClick={onOpenItem} className="text-left text-[15px] font-semibold text-ink hover:text-accent">
              {exam.item.title}
            </button>
            {course && (
              <button type="button" onClick={onOpenCourse} className="block text-left text-xs text-muted hover:text-ink">
                {course.title || course.name}
              </button>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm text-ink">{formatDue(exam.item, now)}</div>
            <div className="text-xs text-muted">{daysText(plan.daysLeft)}</div>
          </div>
        </div>

        {scope.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-ink">{done} of {scope.length} topics done</span>
              {studying > 0 && <span className="text-muted">{studying} in progress</span>}
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full transition-all" style={{ width: `${(done / scope.length) * 100}%`, background: color }} />
              <div className="h-full opacity-40 transition-all" style={{ width: `${(studying / scope.length) * 100}%`, background: color }} />
            </div>
          </div>
        )}
        <p className="mt-2.5 text-[13px] text-muted">{advice}</p>

        {data && data.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill active={section === 'topics'} onClick={() => toggle('topics')}>
              <ChevronRight size={13} className={`transition-transform ${section === 'topics' ? 'rotate-90' : ''}`} />
              Topics ({scope.length}){card.chosenByHand ? '' : ' · suggested'}
            </Pill>
            <Pill active={section === 'starred'} onClick={() => toggle('starred')}>
              <Star size={12} /> Starred lines ({starred.length})
            </Pill>
            <Pill active={section === 'choose'} onClick={() => setSection((cur) => (cur === 'choose' ? 'topics' : 'choose'))}>
              <ListChecks size={13} /> Choose topics
            </Pill>
          </div>
        )}
      </div>

      {section === 'topics' && data && (
        <div className="divide-y divide-line border-t border-line">
          {scope.map((t) => {
            const files = filesByTopic.get(t.id) ?? [];
            return (
              <div key={t.id} className="flex items-center gap-3 px-5 py-2">
                <StatusButton status={t.status} color={color} onClick={() => onCycle(t)} />
                <span className={`min-w-0 flex-1 truncate text-[14px] ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</span>
                <div className="flex shrink-0 gap-1">
                  {files.slice(0, 3).map((f, i) => (
                    <button key={f.id} type="button" title={f.original_name} onClick={() => onOpenFiles(files, i)}
                      className="rounded-md border border-line p-1 hover:border-accent/60">
                      <FileIcon name={f.original_name} size={13} tinted />
                    </button>
                  ))}
                  {files.length > 3 && <span className="self-center text-xs text-muted">+{files.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {section === 'starred' && (
        <div className="space-y-2 border-t border-line px-5 py-3">
          {starred.length === 0 ? (
            <p className="py-2 text-xs text-muted">
              Nothing starred for these topics yet. Open a slide or PDF, select a line worth remembering and press ★.
            </p>
          ) : (
            starred.map((q) => (
              <button key={q.id} type="button" onClick={() => onOpenQuote(q)}
                className="block w-full rounded-lg bg-canvas/60 px-3 py-2 text-left hover:bg-surface-2">
                <span className="block font-serif text-[14px] leading-relaxed text-ink italic">“{q.quote.replace(/\s+/g, ' ').trim()}”</span>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                  <FileIcon name={q.file_name} size={11} tinted />
                  <span className="truncate">{q.file_name} · {q.file_name.toLowerCase().endsWith('.pdf') ? 'page' : 'slide'} {q.location + 1}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {section === 'choose' && data && (
        <ScopePicker topics={data.topics} selected={scope.map((t) => t.id)} chosenByHand={card.chosenByHand}
          onSave={(ids) => {
            onSaveScope(ids);
            setSection('topics');
          }}
          onCancel={() => setSection('topics')} />
      )}
    </article>
  );
}

function ScopePicker({ topics, selected, chosenByHand, onSave, onCancel }: {
  topics: CourseTopic[]; selected: number[]; chosenByHand: boolean;
  onSave: (ids: number[] | null) => void; onCancel: () => void;
}) {
  const [picked, setPicked] = useState(new Set(selected));
  const flip = (id: number) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <div className="border-t border-line px-5 py-3">
      <p className="mb-2 text-xs text-muted">Tick what this exam covers.</p>
      <div className="max-h-72 space-y-0.5 overflow-y-auto">
        {topics.map((t) => (
          <label key={t.id} className="flex items-center gap-2.5 rounded-md px-1 py-1 text-[13px] text-ink hover:bg-surface-2">
            <input type="checkbox" checked={picked.has(t.id)} onChange={() => flip(t.id)} className="accent-[var(--accent)]" />
            <span className="truncate">{t.title}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onSave(topics.filter((t) => picked.has(t.id)).map((t) => t.id))}>Save</Button>
        {chosenByHand && <Button onClick={() => onSave(null)}>Use the suggestion</Button>}
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? 'border-accent/50 bg-accent-soft text-ink' : 'border-line text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}
