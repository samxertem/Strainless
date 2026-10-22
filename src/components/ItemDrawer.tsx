import { useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { Trash2, X } from 'lucide-react';
import type { Category, Item, ItemPatch, Priority, Status } from '../lib/types';
import { PRIORITY_LABELS, STATUS_LABELS } from '../lib/types';
import { joinDue, splitDue } from '../lib/dates';
import { useDebouncedSave } from '../lib/hooks';
import { FieldLabel, Segmented, inputClass } from './ui';
import { NotesEditor } from './NotesEditor';
import { Attachments } from './Attachments';

interface Props {
  item: Item;
  categories: Category[];
  /** Existing course names, offered as autocomplete. */
  courses: string[];
  onSave: (patch: ItemPatch) => void;
  onDelete: () => void;
  onClose: () => void;
  onAttachmentsChanged: () => void;
  attachmentsRefreshKey: number;
  /** True while files are being dragged over this panel. */
  isDropTarget: boolean;
}

const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as Status[]).map((value) => ({ value, label: STATUS_LABELS[value] }));
const PRIORITY_OPTIONS = ([1, 2, 3] as Priority[]).map((value) => ({ value, label: PRIORITY_LABELS[value] }));

/**
 * Edits one item. Mount with key={item.id}: free-text fields keep local drafts
 * (so a refresh never clobbers what you're typing) and save debounced; discrete
 * fields (status, dates…) save immediately.
 */
export function ItemDrawer({
  item, categories, courses, onSave, onDelete, onClose, onAttachmentsChanged, attachmentsRefreshKey, isDropTarget,
}: Props) {
  const [title, setTitle] = useState(item.title);
  const [course, setCourse] = useState(item.course ?? '');
  const [notes, setNotes] = useState(item.notes_md);
  const [due, setDue] = useState(() => splitDue(item));
  const { queue, flush, cancel } = useDebouncedSave<ItemPatch>(onSave);

  const saveNow = (patch: ItemPatch) => {
    flush();
    onSave(patch);
  };

  const changeDue = (date: string, time: string) => {
    setDue({ date, time });
    if (time && !date) return; // wait until there's a date to attach the time to
    saveNow(joinDue(date, time));
  };

  const confirmDelete = async () => {
    const ok = await ask(`Delete "${item.title}" and all its attachments? This can't be undone.`, {
      title: 'Delete item',
      kind: 'warning',
    });
    if (!ok) return;
    cancel();
    onDelete();
  };

  return (
    <aside
      data-drop-item={item.id}
      className={`flex w-[440px] shrink-0 flex-col border-l bg-canvas transition-shadow ${
        isDropTarget ? 'border-accent shadow-[inset_0_0_0_2px_var(--accent)]' : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-xs text-muted">
          {item.status === 'done' && item.completed_at
            ? `Completed ${new Date(item.completed_at).toLocaleDateString('en-GB')}`
            : `Added ${new Date(item.created_at).toLocaleDateString('en-GB')}`}
        </span>
        <div className="flex gap-1">
          <button type="button" onClick={confirmDelete} title="Delete item"
            className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
            <Trash2 size={15} />
          </button>
          <button type="button" onClick={onClose} title="Close (Esc)"
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-8">
        <textarea
          value={title}
          rows={1}
          onChange={(e) => {
            setTitle(e.target.value);
            if (e.target.value.trim()) queue({ title: e.target.value.trim() });
          }}
          onBlur={() => !title.trim() && setTitle(item.title)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
          className="field-sizing-content w-full resize-none bg-transparent text-xl font-semibold text-ink outline-none"
        />

        <div>
          <FieldLabel>Status</FieldLabel>
          <Segmented options={STATUS_OPTIONS} value={item.status} onChange={(status) => saveNow({ status })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Category</FieldLabel>
            <select value={item.category_id} onChange={(e) => saveNow({ category_id: Number(e.target.value) })}
              className={inputClass}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Course</FieldLabel>
            <input
              value={course}
              list="course-options"
              placeholder="e.g. EEE 402"
              onChange={(e) => {
                setCourse(e.target.value);
                queue({ course: e.target.value.trim() || null });
              }}
              className={inputClass}
            />
            <datalist id="course-options">
              {courses.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        </div>

        <div>
          <FieldLabel>Due</FieldLabel>
          <div className="flex items-center gap-2">
            <input type="date" value={due.date} onChange={(e) => changeDue(e.target.value, due.time)}
              className={inputClass} />
            <input type="time" value={due.time} onChange={(e) => changeDue(due.date, e.target.value)}
              disabled={!due.date} className={`${inputClass} w-32 disabled:opacity-50`} />
            {due.date && (
              <button type="button" onClick={() => changeDue('', '')} title="Clear due date"
                className="shrink-0 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
                <X size={14} />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{due.date && !due.time ? 'All day: leave the time empty.' : ' '}</p>
        </div>

        <div>
          <FieldLabel>Priority</FieldLabel>
          <Segmented options={PRIORITY_OPTIONS} value={item.priority} onChange={(priority) => saveNow({ priority })} />
        </div>

        <NotesEditor
          value={notes}
          onChange={(v) => {
            setNotes(v);
            queue({ notes_md: v });
          }}
        />

        <Attachments itemId={item.id} refreshKey={attachmentsRefreshKey} onChanged={onAttachmentsChanged} />
      </div>
    </aside>
  );
}
