import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { BookOpen, FolderInput, ImagePlus, LoaderCircle, Paperclip, X } from 'lucide-react';
import * as db from './lib/db';
import * as coursesDb from './lib/courses';
import type { Category, Course, CourseHit, CourseSession, DocumentFile, Item, ItemPatch, NewItem, Settings } from './lib/types';
import { groupByBucket } from './lib/buckets';
import { dayDiff, formatLongDate, startOfWeek, toDateInput } from './lib/dates';
import { useNow, useTheme } from './lib/hooks';
import { useReminders } from './lib/reminders';
import { indexNewFiles, type FileTextHit } from './lib/fileText';
import { upcomingExams } from './lib/exams';
import { autoBackupDue, runAutoBackup } from './lib/autoBackup';
import { dismissNotice, noticeStore } from './lib/notice';
import { documentPreview, type PreviewFile } from './lib/files';
import { Sidebar, sameView, type View } from './components/Sidebar';
import { QuickAdd } from './components/QuickAdd';
import { Dashboard } from './components/Dashboard';
import { FocusView } from './components/FocusView';
import { JournalView, MOOD_PHOTO_EXTENSIONS } from './components/JournalView';
import { CalendarView } from './components/CalendarView';
import { ItemListView } from './components/ItemListView';
import { CompletedView } from './components/CompletedView';
import { ItemDrawer } from './components/ItemDrawer';
import { CategoryManager } from './components/CategoryManager';
import { SearchPalette } from './components/SearchPalette';
import { SettingsDialog } from './components/SettingsDialog';
import { StarredList } from './components/StarredList';
import { ExamPrepView } from './components/ExamPrepView';
import { DocumentsView } from './components/DocumentsView';
import { importWithNotice } from './components/folders/transfer';
import { CourseView } from './components/course/CourseView';
import { CourseDialog } from './components/course/CourseDialog';
import { Preview } from './components/Preview';
import type { RowContext } from './components/ItemRow';

type Dialog = 'categories' | 'settings' | 'search' | 'new-course' | 'edit-course' | null;

/** What a dragged file is hovering: "item:12" or "item:12:5" (its folder 5), "mood:2026-10-22",
 *  "course:3::" (library), "course:3:7:" (topic 7), "course:3::9" (library folder 9), "docs:" or
 *  "docs:4" (Documents, folder 4). A string, so repeated "over" events with the same target are no-ops. */
type DropKey = `item:${string}` | `mood:${string}` | `course:${string}` | `docs:${string}` | null;

export default function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [view, setView] = useState<View>({ kind: 'dashboard' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dropKey, setDropKey] = useState<DropKey>(null);
  /** Where a drop would land, in words ("CE 477 › Week 3"), from the target's data-drop-label. */
  const [dropLabel, setDropLabel] = useState<string | null>(null);
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [openDocument, setOpenDocument] = useState<PreviewFile | null>(null);
  const notice = useSyncExternalStore(noticeStore.subscribe, noticeStore.get);
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  const [journalVersion, setJournalVersion] = useState(0);
  const [courseVersion, setCourseVersion] = useState(0);
  /** A search result inside a file: open it at that page and mark the words. */
  const [textHit, setTextHit] = useState<{ hit: FileTextHit; query: string } | null>(null);
  const lastNonFocusView = useRef<View>({ kind: 'dashboard' });
  const quickAddRef = useRef<HTMLInputElement>(null);
  const theme = useTheme();
  const now = useNow();
  const todayKey = toDateInput(now);

  const refresh = useCallback(async () => {
    try {
      const [cats, its, crs, sess] = await Promise.all([
        db.listCategories(), db.listItems(), coursesDb.listCourses(), coursesDb.listSessions(),
      ]);
      setCategories(cats);
      setItems(its);
      setCourses(crs);
      setSessions(sess);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    db.loadSettings().then(setSettings, (e) => setError(String(e)));
    // A restored backup from an older version is only migrated on the next launch.
    db.schemaStatus().then((s) => setNeedsRestart(s.current < s.latest), () => {});
  }, [refresh]);

  /** Every mutation goes through here: run it, surface any error, reload state. */
  const run = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        await op();
      } catch (e) {
        setError(String(e));
      }
      await refresh();
    },
    [refresh],
  );

  const showError = useCallback((message: string) => setError(message), []);

  const navigate = useCallback((next: View) => {
    setView((current) => {
      if (sameView(current, next)) return current;
      if (current.kind !== 'focus') lastNonFocusView.current = current;
      return next;
    });
  }, []);

  // Through a ref, so a patch from async work (a finished backup) never overwrites newer settings.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const current = settingsRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    db.saveSettings(next).catch((e) => setError(String(e)));
  }, []);

  // Weekly automatic backup, shortly after launch so it doesn't slow down opening the app.
  // A failure is reported once and retried on the next launch, not every minute.
  const [backupRunning, setBackupRunning] = useState(false);
  const autoBackupFailed = useRef(false);
  useEffect(() => {
    if (!loaded || !settings || backupRunning || autoBackupFailed.current || !autoBackupDue(settings, now)) return;
    const dir = settings.autoBackupDir!;
    const timer = window.setTimeout(() => {
      setBackupRunning(true);
      runAutoBackup(dir)
        .then((m) => updateSettings({ lastBackupAt: m.created_at }))
        .catch((e) => {
          autoBackupFailed.current = true;
          setError(`The weekly backup couldn’t be saved to ${dir}: ${e}. Strainless will try again next time it opens.`);
        })
        .finally(() => setBackupRunning(false));
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [loaded, settings, now, backupRunning, updateSettings]);

  // App-wide shortcuts. Modals handle their own Escape (capture phase), so here it
  // closes the item panel first, then leaves Today mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'n') {
        e.preventDefault();
        setDialog(null);
        if (['focus', 'journal', 'starred', 'prep', 'documents'].includes(view.kind)) navigate({ kind: 'dashboard' });
        if (view.kind === 'course') navigate({ ...view, tab: 'tasks' });
        requestAnimationFrame(() => quickAddRef.current?.focus());
      } else if (mod && key === 'k') {
        e.preventDefault();
        setDialog((d) => (d === 'search' ? null : 'search'));
      } else if (mod && key === ',') {
        e.preventDefault();
        setDialog('settings');
      } else if (e.key === 'Escape' && dialog === null) {
        if (selectedId !== null) setSelectedId(null);
        else if (view.kind === 'focus') navigate(lastNonFocusView.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, selectedId, view, navigate]);

  // ---- drag and drop files from Explorer/Finder ----
  const handleDrop = useRef<(target: DropKey, paths: string[]) => void>(() => {});
  handleDrop.current = (target, paths) => {
    if (target?.startsWith('mood:')) {
      const day = target.slice(5);
      const photo = paths.find((p) => MOOD_PHOTO_EXTENSIONS.includes(p.split('.').pop()?.toLowerCase() ?? ''));
      if (!photo) {
        setError('Mood photos need to be JPG, PNG, WebP or GIF. (iPhone HEIC photos: export or share them as JPG first.)');
        return;
      }
      db.setMoodPhoto(day, photo).then(() => setJournalVersion((v) => v + 1), (e) => setError(String(e)));
    } else if (target?.startsWith('course:')) {
      const [, courseId, topicId, folderId] = target.split(':');
      void run(() => importWithNotice({ kind: 'course', id: Number(courseId) }, paths, {
        topicId: topicId ? Number(topicId) : null, folderId: folderId ? Number(folderId) : null,
      })).then(() => setCourseVersion((v) => v + 1));
    } else if (target?.startsWith('item:')) {
      const [, itemId, folderId] = target.split(':');
      setSelectedId(Number(itemId));
      void run(() => importWithNotice({ kind: 'item', id: Number(itemId) }, paths, { folderId: folderId ? Number(folderId) : null }))
        .then(() => setAttachmentsVersion((v) => v + 1));
    } else if (target?.startsWith('docs:')) {
      const folderId = target.slice(5);
      void run(() => importWithNotice({ kind: 'documents' }, paths, { folderId: folderId ? Number(folderId) : null }))
        .then(() => setDocumentsVersion((v) => v + 1));
    } else {
      setError('Drop files onto an item, a course library or topic, Documents, or the journal’s mood box.');
    }
  };

  useEffect(() => {
    // The webview reports physical pixels; elementFromPoint wants CSS pixels.
    const targetAt = (pos: { x: number; y: number }): { key: DropKey; label: string | null } => {
      const el = document.elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio);
      const target = el?.closest<HTMLElement>('[data-drop-item],[data-drop-mood],[data-drop-course],[data-drop-docs]');
      if (!target) return { key: null, label: null };
      const { dropMood, dropCourse, dropTopic, dropFolder, dropDocs, dropItem, dropLabel } = target.dataset;
      const label = dropLabel ?? null;
      if (dropMood) return { key: `mood:${dropMood}`, label };
      if (dropCourse) return { key: `course:${Number(dropCourse)}:${dropTopic ?? ''}:${dropFolder ?? ''}`, label };
      if (dropDocs !== undefined) return { key: `docs:${dropDocs}`, label };
      return { key: dropFolder ? `item:${Number(dropItem)}:${dropFolder}` : `item:${Number(dropItem)}`, label };
    };
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter' || payload.type === 'over') {
          const { key, label } = targetAt(payload.position);
          setDragActive(true);
          setDropKey(key);
          setDropLabel(label);
        } else {
          setDragActive(false);
          setDropKey(null);
          setDropLabel(null);
          if (payload.type === 'drop' && payload.paths.length > 0) handleDrop.current(targetAt(payload.position).key, payload.paths);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn))); // StrictMode may unmount before this resolves
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ---- derived data ----
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const activeItems = useMemo(() => items.filter((i) => i.status !== 'done'), [items]);
  const groups = useMemo(() => groupByBucket(activeItems, now), [activeItems, now]);
  const courseOpenCounts = useMemo(() => {
    const open = new Map<string, number>();
    for (const i of activeItems) if (i.course) open.set(i.course, (open.get(i.course) ?? 0) + 1);
    return open;
  }, [activeItems]);
  const courseNames = useMemo(() => courses.map((c) => c.name), [courses]);
  const { activeCounts, totalCounts } = useMemo(() => {
    const activeCounts = new Map<number, number>();
    const totalCounts = new Map<number, number>();
    for (const i of items) {
      totalCounts.set(i.category_id, (totalCounts.get(i.category_id) ?? 0) + 1);
      if (i.status !== 'done') activeCounts.set(i.category_id, (activeCounts.get(i.category_id) ?? 0) + 1);
    }
    return { activeCounts, totalCounts };
  }, [items]);
  // Keyed on the date, not `now`, so it recomputes when the day changes rather than every minute.
  const classesToday = useMemo(() => {
    const day = new Date(`${todayKey}T00:00`);
    return coursesDb.classesBetween(sessions, courses, day, day);
  }, [sessions, courses, todayKey]);

  const examCount = useMemo(() => upcomingExams(items, categoriesById, now).length, [items, categoriesById, now]);

  useReminders(items, categoriesById, settings, now);

  // Read new PDFs and slides into the search index in the background, a few seconds
  // after launch and whenever the number of files changes.
  const fileCount = useMemo(
    () => courses.reduce((n, c) => n + c.file_count, 0) + items.reduce((n, i) => n + i.attachment_count, 0),
    [courses, items],
  );
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(indexNewFiles, 4000);
    return () => window.clearTimeout(timer);
  }, [loaded, fileCount]);

  // Leave views whose category or course no longer exists.
  useEffect(() => {
    if (!loaded) return;
    if (view.kind === 'category' && !categoriesById.has(view.id)) setView({ kind: 'dashboard' });
    if (view.kind === 'course' && !coursesById.has(view.id)) setView({ kind: 'dashboard' });
  }, [view, categoriesById, coursesById, loaded]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const addItem = (input: NewItem) => run(() => db.createItem(input));
  const saveItem = (id: number) => (patch: ItemPatch) => void run(() => db.updateItem(id, patch));
  const toggleDone = (item: Item) =>
    void run(() => db.updateItem(item.id, { status: item.status === 'done' ? 'todo' : 'done' }));
  const openCourse = (id: number) => navigate({ kind: 'course', id, tab: 'topics' });

  const dropTargetId = dropKey?.startsWith('item:') ? Number(dropKey.split(':')[1]) : null;
  const ctx: RowContext = { categoriesById, now, selectedId, dropTargetId, onOpen: setSelectedId, onToggleDone: toggleDone };
  const backupAgeDays =
    settings && items.length > 0
      ? settings.lastBackupAt ? dayDiff(new Date(settings.lastBackupAt), now) : null
      : undefined;
  const currentCourse = view.kind === 'course' ? coursesById.get(view.id) : undefined;

  // ---- current view ----
  let page: ReactNode;
  if (view.kind === 'focus') {
    page = (
      <FocusView classesToday={classesToday} onOpenCourse={openCourse} groups={groups} items={items} categories={categories}
        categoriesById={categoriesById} now={now} onOpen={setSelectedId} onToggleDone={toggleDone} onAdd={addItem}
        onExit={() => navigate(lastNonFocusView.current)} />
    );
  } else if (view.kind === 'journal') {
    page = (
      <JournalView day={view.day} todayKey={todayKey} onDayChange={(day) => navigate({ kind: 'journal', day })}
        refreshKey={journalVersion} moodDropActive={dropKey === `mood:${view.day}`} onError={setError} />
    );
  } else if (view.kind === 'course') {
    page = currentCourse ? (
      <CourseView
        key={currentCourse.id}
        course={currentCourse}
        sessions={sessions.filter((s) => s.course_id === currentCourse.id)}
        items={items}
        categories={categories}
        courseNames={courseNames}
        ctx={ctx}
        tab={view.tab}
        noteId={view.noteId}
        onTab={(tab) => navigate({ kind: 'course', id: currentCourse.id, tab })}
        refreshKey={courseVersion}
        dropKey={dropKey}
        quickAddRef={quickAddRef}
        onEdit={() => setDialog('edit-course')}
        onAddItem={addItem}
        onChanged={() => void refresh()}
        onError={showError}
      />
    ) : null;
  } else if (view.kind === 'documents') {
    page = (
      <DocumentsView folderId={view.folderId ?? null} onFolder={(folderId) => navigate({ kind: 'documents', folderId })}
        refreshKey={documentsVersion} dropKey={dropKey} onError={showError} />
    );
  } else if (view.kind === 'prep') {
    page = (
      <ExamPrepView items={items} categoriesById={categoriesById} courses={courses} now={now} onOpenItem={setSelectedId}
        onOpenCourse={openCourse} onChanged={() => void refresh()} onError={showError} />
    );
  } else if (view.kind === 'starred') {
    page = (
      <div className="mx-auto max-w-4xl px-8 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Starred</h1>
          <p className="mt-0.5 text-sm text-muted">The lines worth remembering, from every slide deck, PDF and document.</p>
        </header>
        <StarredList emptyText="Nothing starred yet. Open slides or a PDF, select a sentence with your mouse and press ★." />
      </div>
    );
  } else {
    let title: string;
    let subtitle: string;
    let body: ReactNode;
    const openCount = (list: Item[]) => `${list.filter((i) => i.status !== 'done').length} open`;

    switch (view.kind) {
      case 'dashboard': {
        const weekStart = startOfWeek(now).toISOString();
        const doneThisWeek = items.filter((i) => i.status === 'done' && (i.completed_at ?? '') >= weekStart).length;
        title = formatLongDate(now);
        subtitle = [
          `${groups.today.length} today`,
          `${groups.thisWeek.length} more this week`,
          groups.overdue.length > 0 && `${groups.overdue.length} from earlier`,
          classesToday.length > 0 && `${classesToday.length} class${classesToday.length === 1 ? '' : 'es'} today`,
          doneThisWeek > 0 && `${doneThisWeek} done this week ✓`,
        ].filter(Boolean).join(' · ');
        body = <Dashboard groups={groups} ctx={ctx} />;
        break;
      }
      case 'calendar':
        title = 'Calendar';
        subtitle = sessions.length ? 'Deadlines and classes. Click a day to see or add what’s due' : 'Click a day to see or add what’s due';
        body = (
          <CalendarView items={items} categories={categories} courses={courses} sessions={sessions} ctx={ctx}
            onAdd={addItem} onOpenCourse={openCourse} />
        );
        break;
      case 'completed': {
        title = 'Completed';
        const n = items.length - activeItems.length;
        subtitle = n === 0 ? 'Nothing yet' : `${n} finished. Look how far you've come.`;
        body = <CompletedView items={items} ctx={ctx} />;
        break;
      }
      default: {
        const list =
          view.kind === 'all' ? items
          : view.kind === 'waiting' ? items.filter((i) => i.status === 'waiting')
          : items.filter((i) => i.category_id === view.id);
        title = view.kind === 'all' ? 'All items' : view.kind === 'waiting' ? 'Waiting' : (categoriesById.get(view.id)?.name ?? '');
        subtitle = view.kind === 'waiting' ? 'Blocked on someone else: follow up when it’s been too long' : openCount(list);
        body = (
          <ItemListView
            key={JSON.stringify(view)} // fresh filters per view
            items={list}
            ctx={ctx}
            categories={categories}
            courses={courseNames}
            fixed={{ category: view.kind === 'category' }}
            emptyText={view.kind === 'waiting' ? 'Not waiting on anyone. Nice.' : 'Nothing here yet. Add something above.'}
          />
        );
      }
    }

    page = (
      <div className={`mx-auto px-8 py-8 ${view.kind === 'calendar' ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
        </header>
        <QuickAdd categories={categories} inputRef={quickAddRef} onAdd={addItem}
          preferredCategoryId={view.kind === 'category' ? view.id : null} course={null} />
        {loaded && body}
      </div>
    );
  }

  const dropItem = dropTargetId !== null ? items.find((i) => i.id === dropTargetId) : undefined;
  const dropCourse = dropKey?.startsWith('course:') ? coursesById.get(Number(dropKey.split(':')[1])) : undefined;

  const pickCourseHit = (hit: CourseHit) => {
    setDialog(null);
    const tab = hit.kind === 'file' ? 'library' : hit.kind === 'note' ? 'notes' : 'topics';
    navigate({ kind: 'course', id: hit.course_id, tab, noteId: hit.kind === 'note' ? hit.target_id : undefined });
  };

  return (
    <div className="flex h-full">
      {view.kind !== 'focus' && (
        <Sidebar
          view={view}
          onNavigate={navigate}
          categories={categories}
          activeCounts={activeCounts}
          courses={courses}
          courseOpenCounts={courseOpenCounts}
          onAddCourse={() => setDialog('new-course')}
          overdueCount={groups.overdue.length}
          waitingCount={activeItems.filter((i) => i.status === 'waiting').length}
          activeCount={activeItems.length}
          focusCount={groups.today.length}
          examCount={examCount}
          todayKey={todayKey}
          backupAgeDays={backupAgeDays}
          backupRunning={backupRunning}
          themePref={theme.pref}
          onCycleTheme={theme.cycle}
          onSearch={() => setDialog('search')}
          onSettings={() => setDialog('settings')}
          onManageCategories={() => setDialog('categories')}
          onOpenDataFolder={() => void run(db.openDataFolder)}
        />
      )}

      <main className="min-w-0 flex-1 overflow-y-auto">{loaded && page}</main>

      {selected && (
        <ItemDrawer
          key={selected.id}
          item={selected}
          categories={categories}
          courses={courseNames}
          onSave={saveItem(selected.id)}
          onDelete={() => {
            setSelectedId(null);
            void run(() => db.deleteItem(selected.id));
          }}
          onClose={() => setSelectedId(null)}
          onAttachmentsChanged={() => void refresh()}
          attachmentsRefreshKey={attachmentsVersion}
          isDropTarget={dropTargetId === selected.id}
          dropKey={dropKey}
          onError={showError}
        />
      )}

      {dialog === 'categories' && (
        <CategoryManager categories={categories} itemCounts={totalCounts} run={run} onClose={() => setDialog(null)} />
      )}
      {(dialog === 'new-course' || (dialog === 'edit-course' && currentCourse)) && (
        <CourseDialog
          course={dialog === 'edit-course' ? currentCourse : undefined}
          sessions={dialog === 'edit-course' && currentCourse ? sessions.filter((s) => s.course_id === currentCourse.id) : []}
          existingCount={courses.length}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            void refresh().then(() => navigate({ kind: 'course', id, tab: view.kind === 'course' ? view.tab : 'topics' }));
          }}
          onDeleted={() => {
            setDialog(null);
            navigate({ kind: 'dashboard' });
            void refresh();
          }}
        />
      )}
      {dialog === 'search' && (
        <SearchPalette items={items} categoriesById={categoriesById} now={now} onClose={() => setDialog(null)}
          onPick={(id) => {
            setDialog(null);
            setSelectedId(id);
          }}
          onPickJournal={(day) => {
            setDialog(null);
            navigate({ kind: 'journal', day });
          }}
          onPickCourse={pickCourseHit}
          onPickFileText={(hit, query) => {
            setDialog(null);
            setTextHit({ hit, query });
          }}
          onPickDocument={(doc: DocumentFile) => {
            setDialog(null);
            navigate({ kind: 'documents', folderId: doc.folder_id });
            setOpenDocument(documentPreview(doc));
          }} />
      )}
      {textHit && (
        <Preview files={[textHit.hit.file]} index={0} onIndexChange={() => {}} initialLocation={textHit.hit.location}
          findText={textHit.query} onClose={() => setTextHit(null)} />
      )}
      {openDocument && (
        <Preview files={[openDocument]} index={0} onIndexChange={() => {}} onClose={() => setOpenDocument(null)} />
      )}
      {dialog === 'settings' && settings && (
        <SettingsDialog settings={settings} onChange={updateSettings} themePref={theme.pref} onThemeChange={theme.setPref}
          items={items} categoriesById={categoriesById} courses={courses} sessions={sessions} onClose={() => setDialog(null)} />
      )}

      {dragActive && (
        <div className="pointer-events-none fixed top-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-xl">
          {dropKey?.startsWith('mood:') ? (
            <><ImagePlus size={14} /> Set as the day’s mood photo</>
          ) : dropLabel ? (
            <><FolderInput size={14} /> Add to <strong className="font-semibold">{dropLabel}</strong></>
          ) : dropCourse ? (
            <><BookOpen size={14} /> Add to <strong className="font-semibold">{dropCourse.name}</strong>{dropKey!.split(':')[2] ? ' (this topic)' : ' library'}</>
          ) : dropItem ? (
            <><Paperclip size={14} /> Attach to <strong className="font-semibold">{dropItem.title}</strong></>
          ) : (
            <><Paperclip size={14} /> Drop onto an item, a course or Documents</>
          )}
        </div>
      )}

      {needsRestart && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-line bg-warn-soft px-4 py-2.5 text-sm text-ink shadow-lg">
          Your backup was restored. Quit and reopen Strainless once to finish upgrading it.
        </div>
      )}

      {notice && (
        <div className="fixed right-5 bottom-5 z-[75] flex max-w-md items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink shadow-lg">
          {notice.busy && <LoaderCircle size={15} className="shrink-0 animate-spin text-accent" />}
          <span className="min-w-0 flex-1 break-words">{notice.text}</span>
          {!notice.busy && (
            <button type="button" onClick={dismissNotice} className="text-muted hover:text-ink"><X size={14} /></button>
          )}
        </div>
      )}

      {error && (
        <div className="fixed bottom-5 left-1/2 z-[80] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-xl border border-line bg-danger-soft px-4 py-3 text-sm text-ink shadow-lg">
          <span className="flex-1 break-words">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-muted hover:text-ink">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
