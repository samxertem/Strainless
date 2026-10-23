import { useCallback, useEffect, useMemo, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { Download, ExternalLink, FolderPlus, FolderUp, Search, Tag, Trash2, Upload } from 'lucide-react';
import type { Course, CourseFile, CourseTaskFile, CourseTopic, Folder } from '../../lib/types';
import * as courses from '../../lib/courses';
import * as folderDb from '../../lib/folders';
import { courseExport } from '../../lib/exporting';
import { attachmentPreview, courseFilePreview, fileType, type FileType, type PreviewFile } from '../../lib/files';
import { TYPE_LABEL } from '../FileIcon';
import { Preview } from '../Preview';
import { formatBytes } from '../Attachments';
import { Breadcrumb, FileCard, FolderGrid, FolderSelect, ToolbarButton, folderCounts } from '../folders/FolderParts';
import { exportWithNotice, importWithNotice, pickPaths } from '../folders/transfer';

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
  const place = useMemo(() => ({ kind: 'course' as const, id: course.id }), [course.id]);
  const [files, setFiles] = useState<CourseFile[] | null>(null);
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [taskFiles, setTaskFiles] = useState<CourseTaskFile[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<FileType | 'all'>('all');
  const [previewAt, setPreviewAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, t, tf, fo] = await Promise.all([
        courses.listCourseFiles(course.id), courses.listTopics(course.id), courses.listCourseTaskFiles(course.name),
        folderDb.listFolders(place),
      ]);
      setFiles(f);
      setTopics(t);
      setTaskFiles(tf);
      setFolders(fo);
      // The open folder was deleted: go back to the top.
      setFolderId((id) => (id !== null && !fo.some((x) => x.id === id) ? null : id));
    } catch (e) {
      onError(String(e));
    }
  }, [course.id, course.name, place, onError]);

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

  const add = async (what: 'files' | 'folder') => {
    const paths = await pickPaths(what, what === 'files' ? `Add files to ${course.name}` : `Add folders to ${course.name}`);
    if (paths.length) void act(() => importWithNotice(place, paths, { folderId }));
  };
  const newFolder = () => void act(async () => setEditingId(await folderDb.createFolder(place, folderId, 'New folder')));
  const exportFolder = (f: Folder | null) =>
    exportWithNotice(f ? f.name : course.name, () => courseExport(course, f?.id ?? null)).catch((e) => onError(String(e)));

  const knownFolders = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const folderOf = useCallback((f: CourseFile) => (f.folder_id !== null && knownFolders.has(f.folder_id) ? f.folder_id : null), [knownFolders]);
  const searching = query.trim() !== '' || type !== 'all';

  // What's shown, in display order: by topic, then unsorted, then files from tasks.
  // Searching or filtering looks through every folder; otherwise only the open one.
  const { sections, entries, typesPresent } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (name: string) => (!q || name.toLowerCase().includes(q)) && (type === 'all' || fileType(name) === type);
    const all: Entry[] = [
      ...(files ?? []).map((f): Entry => ({ kind: 'course', file: f, preview: courseFilePreview(f) })),
      ...taskFiles.map((f): Entry => ({ kind: 'task', file: f, preview: attachmentPreview(f) })),
    ];
    const typesPresent = [...new Set(all.map((e) => fileType(e.file.original_name)))];
    const here = (e: Entry) => searching || (e.kind === 'course' ? folderOf(e.file) === folderId : folderId === null);
    const shown = all.filter((e) => here(e) && match(e.file.original_name));
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
  }, [files, taskFiles, topics, query, type, searching, folderId, folderOf]);

  const previews = useMemo(() => entries.map((e) => e.preview), [entries]);
  const counts = useMemo(() => folderCounts(folders, (files ?? []).map(folderOf)), [folders, files, folderOf]);

  if (files === null) return null;
  const dropBase = `course:${course.id}:`;
  const isDropTarget = dropKey === `${dropBase}:${folderId ?? ''}`;
  const empty = files.length === 0 && taskFiles.length === 0 && folders.length === 0;
  const pathLabel = (id: number | null) => [course.name, ...folderDb.folderPath(folders, id).map((f) => f.name)].join(' › ');
  const subfolderCount = folderDb.childrenOf(folders, folderId).length;

  return (
    <div data-drop-course={course.id} data-drop-folder={folderId ?? ''} data-drop-label={pathLabel(folderId)}
      className={`-m-3 rounded-2xl p-3 transition-shadow ${isDropTarget ? 'bg-accent-soft/60 shadow-[inset_0_0_0_2px_var(--accent)]' : ''}`}>
      {empty ? (
        <div className="rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center text-muted">
          <button type="button" onClick={() => void add('files')} className="mx-auto flex flex-col items-center gap-2 hover:text-ink">
            <Upload size={26} strokeWidth={1.5} />
            <span className="text-sm font-medium">Drop slides, PDFs, notes, photos, code or whole folders here</span>
            <span className="text-xs">or click to choose files. Everything for {course.name} in one place.</span>
          </button>
          <button type="button" onClick={() => void add('folder')} className="mt-3 text-xs text-accent hover:underline">
            Add a whole folder (like your Week 1, Week 2… downloads)
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
              <Search size={14} className="text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file in any folder…"
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
            <ToolbarButton title="New folder" onClick={newFolder}><FolderPlus size={15} /></ToolbarButton>
            <ToolbarButton title="Add a folder from your computer" onClick={() => void add('folder')}><FolderUp size={15} /></ToolbarButton>
            <ToolbarButton title={`Export ${course.name} as a folder (library, notes, topics, task files)`} onClick={() => void exportFolder(null)}>
              <Download size={15} />
            </ToolbarButton>
            <button type="button" onClick={() => void add('files')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90">
              <Upload size={14} /> Add files
            </button>
          </div>

          {!searching && (
            <>
              <Breadcrumb rootLabel="Library" folders={folders} currentId={folderId} onOpen={setFolderId} />
              <FolderGrid place={place} folders={folders} parentId={folderId} rootLabel="Library (top level)" counts={counts}
                editingId={editingId} onEditing={setEditingId} onOpen={setFolderId} act={act}
                onExport={(f) => void exportFolder(f)}
                dropAttrs={(f) => ({ 'data-drop-course': String(course.id), 'data-drop-folder': String(f.id), 'data-drop-label': pathLabel(f.id) })}
                isDropTarget={(f) => dropKey === `${dropBase}:${f.id}`} />
            </>
          )}

          {sections.length === 0 && (searching || subfolderCount === 0) && (
            <p className="py-8 text-center text-sm text-muted">
              {searching ? 'No files match.' : 'This folder is empty. Drop files here, or use Add files.'}
            </p>
          )}
          {sections.map((section) => (
            <section key={section.title} className="mb-6">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">
                {section.title} <span className="font-normal text-muted">{section.entries.length}</span>
              </h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {section.entries.map((entry) => {
                  const name = entry.file.original_name;
                  const where = entry.kind === 'course' && searching && folderOf(entry.file) !== null
                    ? `${folderDb.folderPath(folders, folderOf(entry.file)).map((f) => f.name).join(' / ')} · ` : '';
                  return (
                    <FileCard
                      key={`${entry.kind}-${entry.file.id}`}
                      name={name}
                      preview={entry.preview}
                      subtitle={entry.kind === 'task' ? entry.file.item_title
                        : `${where}${TYPE_LABEL[fileType(name)]} · ${formatBytes(entry.file.size)} · ${added.format(new Date(entry.file.added_at))}`}
                      onOpen={() => setPreviewAt(entries.indexOf(entry))}
                      actions={<>
                        {entry.kind === 'course' && topics.length > 0 && (
                          <label title="Move to topic" className="relative rounded p-1 text-muted hover:text-ink">
                            <Tag size={13} />
                            <select value={entry.file.topic_id ?? ''}
                              onChange={(e) => void act(() => courses.moveCourseFile(entry.file.id, e.target.value ? Number(e.target.value) : null))}
                              className="absolute inset-0 cursor-pointer opacity-0">
                              <option value="">Not in a topic</option>
                              {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                            </select>
                          </label>
                        )}
                        {entry.kind === 'course' && folders.length > 0 && (
                          <FolderSelect folders={folders} value={folderOf(entry.file)} rootLabel="Library (top level)"
                            onChange={(id) => void act(() => folderDb.setFileFolder(place, entry.file.id, id))} />
                        )}
                        <button type="button" title="Open with default app" onClick={() => entry.preview.openExternally().catch((e) => onError(String(e)))}
                          className="rounded p-1 text-muted hover:text-ink"><ExternalLink size={13} /></button>
                        {entry.kind === 'course' && (
                          <button type="button" title="Delete" className="rounded p-1 text-muted hover:text-danger"
                            onClick={async () => {
                              const ok = await ask(`Delete “${name}” from ${course.name}? Its highlights go too.`, { title: 'Delete file', kind: 'warning' });
                              if (ok) void act(() => courses.deleteCourseFile(entry.file as CourseFile));
                            }}><Trash2 size={13} /></button>
                        )}
                      </>}
                    />
                  );
                })}
              </div>
            </section>
          ))}
          <p className="text-center text-xs text-muted">Tip: drag files or whole folders from Explorer or Finder onto this page, or onto a folder.</p>
        </>
      )}

      {previewAt !== null && previews[previewAt] && (
        <Preview files={previews} index={previewAt} onIndexChange={setPreviewAt} onClose={() => setPreviewAt(null)} />
      )}
    </div>
  );
}
