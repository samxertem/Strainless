import { useCallback, useEffect, useMemo, useState } from 'react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { ExternalLink, FolderInput, Search, Trash2, Upload } from 'lucide-react';
import type { Course, CourseFile, CourseTaskFile, CourseTopic } from '../../lib/types';
import * as courses from '../../lib/courses';
import { attachmentPreview, courseFilePreview, fileType, type FileType, type PreviewFile } from '../../lib/files';
import { FileIcon, TYPE_LABEL, TYPE_TINT } from '../FileIcon';
import { Preview } from '../Preview';
import { formatBytes } from '../Attachments';

interface Props {
  course: Course;
  refreshKey: number;
  dropKey: string | null;
  onChanged: () => void;
  onError: (message: string) => void;
}

type Entry =
  | { kind: 'course'; file: CourseFile; preview: PreviewFile }
  | { kind: 'task'; file: CourseTaskFile; preview: PreviewFile };

const added = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function LibraryTab({ course, refreshKey, dropKey, onChanged, onError }: Props) {
  const [files, setFiles] = useState<CourseFile[] | null>(null);
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [taskFiles, setTaskFiles] = useState<CourseTaskFile[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<FileType | 'all'>('all');
  const [previewAt, setPreviewAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, t, tf] = await Promise.all([
        courses.listCourseFiles(course.id), courses.listTopics(course.id), courses.listCourseTaskFiles(course.name),
      ]);
      setFiles(f);
      setTopics(t);
      setTaskFiles(tf);
    } catch (e) {
      onError(String(e));
    }
  }, [course.id, course.name, onError]);

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

  const addFiles = async () => {
    const picked = await open({ multiple: true, title: `Add files to ${course.name}` });
    if (picked) void act(() => courses.addCourseFiles(course.id, Array.isArray(picked) ? picked : [picked]));
  };

  // Everything shown, in display order: by topic, then unsorted, then files from tasks.
  const { sections, entries, typesPresent } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (name: string) => (!q || name.toLowerCase().includes(q)) && (type === 'all' || fileType(name) === type);
    const all: Entry[] = [
      ...(files ?? []).map((f): Entry => ({ kind: 'course', file: f, preview: courseFilePreview(f) })),
      ...taskFiles.map((f): Entry => ({ kind: 'task', file: f, preview: attachmentPreview(f) })),
    ];
    const typesPresent = [...new Set(all.map((e) => fileType(e.file.original_name)))];
    const shown = all.filter((e) => match(e.file.original_name));
    const sections: { title: string; entries: Entry[] }[] = [];
    for (const t of topics) {
      const list = shown.filter((e) => e.kind === 'course' && e.file.topic_id === t.id);
      if (list.length) sections.push({ title: t.title, entries: list });
    }
    const unsorted = shown.filter((e) => e.kind === 'course' && (e.file.topic_id === null || !topics.some((t) => t.id === e.file.topic_id)));
    if (unsorted.length) sections.push({ title: topics.length ? 'Not in a topic' : 'Files', entries: unsorted });
    const fromTasks = shown.filter((e) => e.kind === 'task');
    if (fromTasks.length) sections.push({ title: 'From tasks', entries: fromTasks });
    return { sections, entries: sections.flatMap((s) => s.entries), typesPresent };
  }, [files, taskFiles, topics, query, type]);

  const previews = useMemo(() => entries.map((e) => e.preview), [entries]);

  if (files === null) return null;
  const isDropTarget = dropKey === `course:${course.id}:`;
  const empty = files.length === 0 && taskFiles.length === 0;

  return (
    <div data-drop-course={course.id}
      className={`-m-3 rounded-2xl p-3 transition-shadow ${isDropTarget ? 'bg-accent-soft/60 shadow-[inset_0_0_0_2px_var(--accent)]' : ''}`}>
      {empty ? (
        <button type="button" onClick={addFiles}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-14 text-muted hover:border-accent/60 hover:text-ink">
          <Upload size={26} strokeWidth={1.5} />
          <span className="text-sm font-medium">Drop slides, PDFs, notes, photos or code here</span>
          <span className="text-xs">or click to choose files. Everything for {course.name} in one place.</span>
        </button>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
              <Search size={14} className="text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file…"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70" />
            </div>
            {typesPresent.length > 1 && (
              <div className="inline-flex flex-wrap rounded-lg bg-surface-2 p-0.5">
                {(['all', ...typesPresent] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setType(t)}
                    className={`rounded-md px-2.5 py-1 text-xs ${type === t ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
                    {t === 'all' ? 'All' : TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={addFiles}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90">
              <Upload size={14} /> Add files
            </button>
          </div>

          {sections.length === 0 && <p className="py-8 text-center text-sm text-muted">No files match.</p>}
          {sections.map((section) => (
            <section key={section.title} className="mb-6">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">
                {section.title} <span className="font-normal text-muted">{section.entries.length}</span>
              </h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {section.entries.map((entry) => (
                  <FileCard
                    key={`${entry.kind}-${entry.file.id}`}
                    entry={entry}
                    topics={topics}
                    onOpen={() => setPreviewAt(entries.indexOf(entry))}
                    onMove={(topicId) => entry.kind === 'course' && void act(() => courses.moveCourseFile(entry.file.id, topicId))}
                    onDelete={async () => {
                      if (entry.kind !== 'course') return;
                      const ok = await ask(`Delete “${entry.file.original_name}” from ${course.name}? Its highlights go too.`, {
                        title: 'Delete file', kind: 'warning',
                      });
                      if (ok) void act(() => courses.deleteCourseFile(entry.file as CourseFile));
                    }}
                    onError={onError}
                  />
                ))}
              </div>
            </section>
          ))}
          <p className="text-center text-xs text-muted">Tip: drag files from Explorer or Finder anywhere onto this page.</p>
        </>
      )}

      {previewAt !== null && previews[previewAt] && (
        <Preview files={previews} index={previewAt} onIndexChange={setPreviewAt} onClose={() => setPreviewAt(null)} />
      )}
    </div>
  );
}

function FileCard({ entry, topics, onOpen, onMove, onDelete, onError }: {
  entry: Entry; topics: CourseTopic[]; onOpen: () => void; onMove: (topicId: number | null) => void;
  onDelete: () => void; onError: (m: string) => void;
}) {
  const name = entry.file.original_name;
  const type = fileType(name);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (type !== 'image' || name.toLowerCase().endsWith('.heic')) return;
    let live = true;
    entry.preview.url().then((u) => live && setThumb(u), () => {});
    return () => {
      live = false;
    };
  }, [entry, name, type]);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-colors hover:border-accent/50">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex h-24 items-center justify-center overflow-hidden" style={{ background: `color-mix(in srgb, ${TYPE_TINT[type]} 16%, transparent)` }}>
          {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <FileIcon name={name} size={30} tinted />}
        </div>
        <div className="px-3 py-2.5">
          <div className="line-clamp-2 text-[13px] leading-snug text-ink">{name}</div>
          <div className="mt-1 truncate text-[11px] text-muted">
            {entry.kind === 'task' ? entry.file.item_title : `${TYPE_LABEL[type]} · ${formatBytes(entry.file.size)} · ${added.format(new Date(entry.file.added_at))}`}
          </div>
        </div>
      </button>
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-lg bg-surface/90 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {entry.kind === 'course' && topics.length > 0 && (
          <label title="Move to topic" className="relative rounded p-1 text-muted hover:text-ink">
            <FolderInput size={13} />
            <select value={entry.file.topic_id ?? ''} onChange={(e) => onMove(e.target.value ? Number(e.target.value) : null)}
              className="absolute inset-0 cursor-pointer opacity-0">
              <option value="">Not in a topic</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
        )}
        <button type="button" title="Open with default app" onClick={() => entry.preview.openExternally().catch((e) => onError(String(e)))}
          className="rounded p-1 text-muted hover:text-ink"><ExternalLink size={13} /></button>
        {entry.kind === 'course' && (
          <button type="button" title="Delete" onClick={onDelete} className="rounded p-1 text-muted hover:text-danger"><Trash2 size={13} /></button>
        )}
      </div>
    </div>
  );
}
