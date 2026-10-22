import { useState, type FormEvent } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { Category } from '../lib/types';
import { CATEGORY_COLORS } from '../lib/types';
import * as db from '../lib/db';
import { Modal, inputClass } from './ui';

interface Props {
  categories: Category[];
  itemCounts: Map<number, number>;
  /** Runs a mutation, reports errors, and refreshes app state. */
  run: (op: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}

export function CategoryManager({ categories, itemCounts, run, onClose }: Props) {
  const [newName, setNewName] = useState('');

  const move = (index: number, delta: -1 | 1) => {
    const ids = categories.map((c) => c.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    return run(() => db.reorderCategories(ids));
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const color = CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length];
    await run(() => db.createCategory(name, color));
    setNewName('');
  };

  return (
    <Modal
      title="Categories"
      onClose={onClose}
      footer={
        <form onSubmit={add} className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category name"
            className={inputClass} />
          <button type="submit" disabled={!newName.trim()}
            className="shrink-0 rounded-lg bg-accent px-3.5 text-sm font-medium text-surface disabled:opacity-40">
            Add
          </button>
        </form>
      }
    >
        <ul className="px-3 py-2">
          {categories.map((cat, i) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              itemCount={itemCounts.get(cat.id) ?? 0}
              others={categories.filter((c) => c.id !== cat.id)}
              canMoveUp={i > 0}
              canMoveDown={i < categories.length - 1}
              onMove={(delta) => move(i, delta)}
              run={run}
            />
          ))}
        </ul>
    </Modal>
  );
}

interface RowProps {
  category: Category;
  itemCount: number;
  others: Category[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => Promise<void>;
  run: Props['run'];
}

function CategoryRow({ category, itemCount, others, canMoveUp, canMoveDown, onMove, run }: RowProps) {
  const [name, setName] = useState(category.name);
  const [pickingColor, setPickingColor] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState<number | null>(others[0]?.id ?? null);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) setName(category.name);
    else if (trimmed !== category.name) void run(() => db.updateCategory(category.id, { name: trimmed }));
  };

  const startDelete = async () => {
    if (itemCount > 0) return setDeleting(true);
    const ok = await ask(`Delete the empty category "${category.name}"?`, { title: 'Delete category', kind: 'warning' });
    if (ok) await run(() => db.deleteCategory(category.id, null));
  };

  const iconButton = 'rounded p-1 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent';

  return (
    <li className="rounded-lg px-2 py-1.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPickingColor((v) => !v)} title="Change colour"
          className="size-4 shrink-0 rounded-full ring-offset-2 ring-offset-canvas hover:ring-2 hover:ring-line"
          style={{ background: category.color }} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm text-ink outline-none hover:bg-surface-2 focus:bg-surface focus:ring-1 focus:ring-accent"
        />
        <span className="w-14 shrink-0 text-right text-xs text-muted tabular-nums">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
        <button type="button" className={iconButton} disabled={!canMoveUp} onClick={() => onMove(-1)} title="Move up">
          <ArrowUp size={13} />
        </button>
        <button type="button" className={iconButton} disabled={!canMoveDown} onClick={() => onMove(1)} title="Move down">
          <ArrowDown size={13} />
        </button>
        <button type="button" disabled={others.length === 0} onClick={startDelete} title="Delete"
          className={`${iconButton} hover:text-danger`}>
          <Trash2 size={13} />
        </button>
      </div>

      {pickingColor && (
        <div className="mt-2 ml-6 flex flex-wrap gap-1.5">
          {CATEGORY_COLORS.map((color) => (
            <button key={color} type="button" title={color}
              onClick={() => {
                setPickingColor(false);
                void run(() => db.updateCategory(category.id, { color }));
              }}
              className={`size-5 rounded-full ${color === category.color ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas' : ''}`}
              style={{ background: color }} />
          ))}
        </div>
      )}

      {deleting && (
        <div className="mt-2 ml-6 flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-ink">
          <span>Move its {itemCount} {itemCount === 1 ? 'item' : 'items'} to</span>
          <select value={moveTo ?? ''} onChange={(e) => setMoveTo(Number(e.target.value))}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs outline-none">
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span>and delete "{category.name}"?</span>
          <div className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => setDeleting(false)} className="rounded-md px-2 py-1 hover:bg-surface">
              Cancel
            </button>
            <button type="button" onClick={() => moveTo !== null && run(() => db.deleteCategory(category.id, moveTo))}
              className="rounded-md bg-danger px-2 py-1 font-medium text-surface">
              Move & delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
