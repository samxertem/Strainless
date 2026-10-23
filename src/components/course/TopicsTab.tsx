import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { ArrowDown, ArrowUp, Check, ChevronRight, Paperclip, Plus, Trash2 } from 'lucide-react';
import type { Course, CourseFile, CourseTopic, TopicStatus } from '../../lib/types';
import * as courses from '../../lib/courses';
import { courseFilePreview } from '../../lib/files';
import { useDebouncedSave } from '../../lib/hooks';
import { MarkdownEditor } from '../MarkdownEditor';
import { FileIcon } from '../FileIcon';
import { Preview } from '../Preview';
import { courseNoteImages } from './noteImages';

interface Props {
  course: Course;
  refreshKey: number;
  /** "course:<id>:<topic id>" while files are dragged over a topic. */
  dropKey: string | null;
  onChanged: () => void;
  onError: (message: string) => void;
}

export const NEXT_STATUS: Record<TopicStatus, TopicStatus> = { todo: 'studying', studying: 'done', done: 'todo' };
const STATUS_TITLE: Record<TopicStatus, string> = { todo: 'Not started', studying: 'Studying', done: 'Done' };

export function TopicsTab({ course, refreshKey, dropKey, onChanged, onError }: Props) {
  const [topics, setTopics] = useState<CourseTopic[] | null>(null);
  const [files, setFiles] = useState<CourseFile[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<{ files: CourseFile[]; index: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, f] = await Promise.all([courses.listTopics(course.id), courses.listCourseFiles(course.id)]);
      setTopics(t);
      setFiles(f);
    } catch (e) {
      onError(String(e));
    }
  }, [course.id, onError]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch (e) {
      onError(String(e));
    }
    await load();
    onChanged();
  };

  const add = () => {
    // One topic per line, so a pasted syllabus becomes a checklist; list markers and numbering are dropped.
    const lines = draft.split('\n').map((l) => l.replace(/^\s*([-*•▪]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    if (!lines.length) return;
    setDraft('');
    void act(() => courses.addTopics(course.id, lines));
  };

  const onDraftKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      add();
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    if (!topics) return;
    const ids = topics.map((t) => t.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void act(() => courses.reorderTopics(ids));
  };

  const filesByTopic = useMemo(() => {
    const map = new Map<number, CourseFile[]>();
    for (const f of files) if (f.topic_id !== null) map.set(f.topic_id, [...(map.get(f.topic_id) ?? []), f]);
    return map;
  }, [files]);

  const previewFiles = useMemo(() => preview?.files.map(courseFilePreview) ?? [], [preview?.files]);

  if (!topics) return null;
  const done = topics.filter((t) => t.status === 'done').length;
  const studying = topics.filter((t) => t.status === 'studying').length;

  return (
    <div>
      {topics.length > 0 && (
        <div className="mb-6">
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="text-ink">{done} of {topics.length} topics done</span>
            {studying > 0 && <span className="text-xs text-muted">{studying} in progress</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="flex h-full">
              <div className="h-full transition-all" style={{ width: `${(done / topics.length) * 100}%`, background: course.color }} />
              <div className="h-full opacity-40 transition-all" style={{ width: `${(studying / topics.length) * 100}%`, background: course.color }} />
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {topics.map((t, i) => (
          <TopicRow
            key={t.id}
            topic={t}
            course={course}
            files={filesByTopic.get(t.id) ?? []}
            expanded={expanded.has(t.id)}
            isDropTarget={dropKey === `course:${course.id}:${t.id}:`}
            canMoveUp={i > 0}
            canMoveDown={i < topics.length - 1}
            onToggle={() => setExpanded((s) => {
              const next = new Set(s);
              if (next.has(t.id)) next.delete(t.id);
              else next.add(t.id);
              return next;
            })}
            onStatus={() => void act(() => courses.updateTopic(t.id, { status: NEXT_STATUS[t.status] }))}
            onRename={(title) => void act(() => courses.updateTopic(t.id, { title }))}
            onNotes={(notes_md) => courses.updateTopic(t.id, { notes_md }).catch((e) => onError(String(e)))}
            onMove={(delta) => move(i, delta)}
            onDelete={async () => {
              const ok = await ask(`Delete the topic “${t.title}”? Its files stay in the library.`, { title: 'Delete topic', kind: 'warning' });
              if (ok) void act(() => courses.deleteTopic(t.id));
            }}
            onAddFiles={async () => {
              const picked = await open({ multiple: true, title: `Add files to “${t.title}”` });
              if (picked) void act(() => courses.addCourseFiles(course.id, Array.isArray(picked) ? picked : [picked], t.id));
            }}
            onOpenFile={(index) => setPreview({ files: filesByTopic.get(t.id) ?? [], index })}
          />
        ))}
        <div className="flex items-start gap-3 px-4 py-3">
          <Plus size={16} className="mt-1 shrink-0 text-muted" />
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onDraftKey} rows={1}
            placeholder={topics.length ? 'Add a topic… (paste several lines to add many)' : 'Add your topics: one per line. Paste the syllabus here and press Enter.'}
            className="field-sizing-content min-w-0 flex-1 resize-none bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-muted/70" />
          {draft.trim() && (
            <button type="button" onClick={add} className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-surface">
              Add {draft.split('\n').filter((l) => l.trim()).length > 1 ? `${draft.split('\n').filter((l) => l.trim()).length} topics` : ''}
            </button>
          )}
        </div>
      </div>

      {preview && (
        <Preview files={previewFiles} index={preview.index} onIndexChange={(index) => setPreview({ ...preview, index })}
          onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

interface RowProps {
  topic: CourseTopic;
  course: Course;
  files: CourseFile[];
  expanded: boolean;
  isDropTarget: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onStatus: () => void;
  onRename: (title: string) => void;
  onNotes: (notes: string) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onAddFiles: () => void;
  onOpenFile: (index: number) => void;
}

function TopicRow(p: RowProps) {
  const { topic: t } = p;
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes_md);
  const { queue } = useDebouncedSave<{ notes: string }>((patch) => p.onNotes(patch.notes), 500);
  const iconButton = 'rounded p-1 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-25';

  return (
    <div data-drop-course={p.course.id} data-drop-topic={t.id}
      className={`group transition-colors ${p.isDropTarget ? 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)]' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <StatusButton status={t.status} color={p.course.color} onClick={p.onStatus} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => (title.trim() && title.trim() !== t.title ? p.onRename(title.trim()) : setTitle(t.title))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[14px] outline-none focus:bg-surface-2 ${
            t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}
        />
        {p.files.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted"><Paperclip size={12} />{p.files.length}</span>
        )}
        {t.notes_md.trim() && !p.expanded && <span className="shrink-0 text-xs text-muted">notes</span>}
        <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" className={iconButton} disabled={!p.canMoveUp} onClick={() => p.onMove(-1)} title="Move up"><ArrowUp size={13} /></button>
          <button type="button" className={iconButton} disabled={!p.canMoveDown} onClick={() => p.onMove(1)} title="Move down"><ArrowDown size={13} /></button>
          <button type="button" className={`${iconButton} hover:text-danger`} onClick={p.onDelete} title="Delete topic"><Trash2 size={13} /></button>
        </div>
        <button type="button" onClick={p.onToggle} title={p.expanded ? 'Collapse' : 'Notes and files'}
          className="shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-ink">
          <ChevronRight size={15} className={`transition-transform ${p.expanded ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {p.expanded && (
        <div className="space-y-4 border-t border-line bg-canvas/50 px-4 py-4 pl-12">
          <MarkdownEditor label="Notes" value={notes} minHeight={120} images={courseNoteImages(p.course.id)}
            placeholder="What to remember about this topic. Formulas, `code`, ```code blocks```, screenshots…"
            onChange={(v) => {
              setNotes(v);
              queue({ notes: v });
            }} />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wide text-muted uppercase">Files</span>
              <button type="button" onClick={p.onAddFiles} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                <Paperclip size={12} /> Add files
              </button>
            </div>
            {p.files.length ? (
              <div className="flex flex-wrap gap-2">
                {p.files.map((f, i) => (
                  <button key={f.id} type="button" onClick={() => p.onOpenFile(i)}
                    className="inline-flex max-w-64 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink hover:border-accent/60">
                    <FileIcon name={f.original_name} size={14} tinted className="shrink-0" />
                    <span className="truncate">{f.original_name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">Drop slides or PDFs on this topic, or use Add files.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function StatusButton({ status, color, onClick }: { status: TopicStatus; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${STATUS_TITLE[status]} (click to change)`}
      className="flex size-[20px] shrink-0 items-center justify-center rounded-full border-2 transition-colors"
      style={{
        borderColor: status === 'todo' ? 'color-mix(in srgb, var(--muted) 50%, transparent)' : color,
        background: status === 'done' ? color : status === 'studying' ? `linear-gradient(90deg, ${color} 50%, transparent 50%)` : 'transparent',
      }}>
      {status === 'done' && <Check size={11} strokeWidth={3} className="text-white" />}
    </button>
  );
}
