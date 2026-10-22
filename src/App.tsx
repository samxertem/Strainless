import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import * as db from './lib/db';
import type { Category, Item, ItemPatch, NewItem } from './lib/types';
import { groupByBucket } from './lib/buckets';
import { formatLongDate } from './lib/dates';
import { useNow, useTheme } from './lib/hooks';
import { Sidebar, type View } from './components/Sidebar';
import { QuickAdd } from './components/QuickAdd';
import { Dashboard } from './components/Dashboard';
import { ItemListView } from './components/ItemListView';
import { ItemDrawer } from './components/ItemDrawer';
import { CategoryManager } from './components/CategoryManager';

export default function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'dashboard' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const theme = useTheme();
  const now = useNow();

  const refresh = useCallback(async () => {
    try {
      const [cats, its] = await Promise.all([db.listCategories(), db.listItems()]);
      setCategories(cats);
      setItems(its);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        quickAddRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (managingCategories) setManagingCategories(false);
        else setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [managingCategories]);

  // If the category being viewed is deleted, fall back to the dashboard.
  useEffect(() => {
    if (view.kind === 'category' && loaded && !categories.some((c) => c.id === view.id)) setView({ kind: 'dashboard' });
  }, [view, categories, loaded]);

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const activeItems = useMemo(() => items.filter((i) => i.status !== 'done'), [items]);
  const groups = useMemo(() => groupByBucket(activeItems, now), [activeItems, now]);
  const courses = useMemo(
    () => [...new Set(items.map((i) => i.course).filter((c): c is string => Boolean(c)))].sort(),
    [items],
  );
  const { activeCounts, totalCounts } = useMemo(() => {
    const activeCounts = new Map<number, number>();
    const totalCounts = new Map<number, number>();
    for (const i of items) {
      totalCounts.set(i.category_id, (totalCounts.get(i.category_id) ?? 0) + 1);
      if (i.status !== 'done') activeCounts.set(i.category_id, (activeCounts.get(i.category_id) ?? 0) + 1);
    }
    return { activeCounts, totalCounts };
  }, [items]);
  const waitingCount = activeItems.filter((i) => i.status === 'waiting').length;

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const addItem = (input: NewItem) => run(() => db.createItem(input));
  const saveItem = (id: number) => (patch: ItemPatch) => void run(() => db.updateItem(id, patch));
  const toggleDone = (item: Item) =>
    void run(() => db.updateItem(item.id, { status: item.status === 'done' ? 'todo' : 'done' }));

  const listProps = { categoriesById, now, selectedId, onOpen: setSelectedId, onToggleDone: toggleDone };

  let header: { title: string; subtitle: string };
  let body: ReactNode;
  if (view.kind === 'dashboard') {
    const parts = [
      groups.overdue.length && `${groups.overdue.length} overdue`,
      `${groups.today.length} today`,
      `${groups.thisWeek.length} more this week`,
    ].filter(Boolean);
    header = { title: formatLongDate(now), subtitle: parts.join(' · ') };
    body = <Dashboard groups={groups} {...listProps} />;
  } else {
    const category = view.kind === 'category' ? categoriesById.get(view.id) : undefined;
    const viewItems =
      view.kind === 'all' ? items
      : view.kind === 'waiting' ? items.filter((i) => i.status === 'waiting')
      : items.filter((i) => i.category_id === view.id);
    header = {
      title: view.kind === 'all' ? 'All items' : view.kind === 'waiting' ? 'Waiting' : (category?.name ?? ''),
      subtitle: view.kind === 'waiting' ? 'Things blocked on someone else' : `${viewItems.filter((i) => i.status !== 'done').length} open`,
    };
    body = (
      <ItemListView items={viewItems} showCategory={view.kind !== 'category'} {...listProps}
        emptyText={view.kind === 'waiting' ? 'Not waiting on anyone. Nice.' : 'Nothing here yet. Add something above.'} />
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar
        view={view}
        onNavigate={(v) => setView(v)}
        categories={categories}
        activeCounts={activeCounts}
        overdueCount={groups.overdue.length}
        waitingCount={waitingCount}
        activeCount={activeItems.length}
        themePref={theme.pref}
        onCycleTheme={theme.cycle}
        onManageCategories={() => setManagingCategories(true)}
        onOpenDataFolder={() => void run(db.openDataFolder)}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          <header className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{header.title}</h1>
            <p className="mt-0.5 text-sm text-muted">{header.subtitle}</p>
          </header>
          <QuickAdd categories={categories} inputRef={quickAddRef} onAdd={addItem}
            preferredCategoryId={view.kind === 'category' ? view.id : null} />
          {loaded && body}
        </div>
      </main>

      {selected && (
        <ItemDrawer
          key={selected.id}
          item={selected}
          categories={categories}
          courses={courses}
          onSave={saveItem(selected.id)}
          onDelete={() => {
            setSelectedId(null);
            void run(() => db.deleteItem(selected.id));
          }}
          onClose={() => setSelectedId(null)}
          onAttachmentsChanged={() => void refresh()}
        />
      )}

      {managingCategories && (
        <CategoryManager categories={categories} itemCounts={totalCounts} run={run}
          onClose={() => setManagingCategories(false)} />
      )}

      {error && (
        <div className="fixed bottom-5 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-xl border border-line bg-danger-soft px-4 py-3 text-sm text-ink shadow-lg">
          <span className="flex-1 break-words">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-muted hover:text-ink">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
