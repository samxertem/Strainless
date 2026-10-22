import { useEffect, useState, type FormEvent } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { Plus, Trash2 } from 'lucide-react';
import type { Course, CourseSession, SessionKind } from '../../lib/types';
import { CATEGORY_COLORS, SESSION_KIND_LABELS } from '../../lib/types';
import * as courses from '../../lib/courses';
import { Button, FieldLabel, Modal, inputBase, inputClass } from '../ui';

interface Props {
  /** Editing an existing course; omitted to create one. */
  course?: Course;
  sessions?: CourseSession[];
  existingCount: number;
  onClose: () => void;
  onSaved: (courseId: number) => void;
  onDeleted?: () => void;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const KINDS = Object.keys(SESSION_KIND_LABELS) as SessionKind[];

type Draft = courses.SessionFields & { key: number };

export function CourseDialog({ course, sessions = [], existingCount, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(course?.name ?? '');
  const [title, setTitle] = useState(course?.title ?? '');
  const [instructor, setInstructor] = useState(course?.instructor ?? '');
  const [color, setColor] = useState(course?.color ?? CATEGORY_COLORS[(existingCount * 5) % CATEGORY_COLORS.length]);
  const [termStart, setTermStart] = useState(course?.term_start ?? '');
  const [termEnd, setTermEnd] = useState(course?.term_end ?? '');
  const [slots, setSlots] = useState<Draft[]>(() => sessions.map((s, i) => ({ ...s, key: i })));
  const [mentions, setMentions] = useState<{ id: number; title: string }[]>([]);
  const [linkMentions, setLinkMentions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New course: find tasks that already mention it ("SE 320 Homework") to offer linking them.
  useEffect(() => {
    if (course || !name.trim()) {
      setMentions([]);
      return;
    }
    const timer = window.setTimeout(() => courses.itemsMentioning(name).then(setMentions, () => {}), 250);
    return () => window.clearTimeout(timer);
  }, [name, course]);

  const addSlot = () => {
    const last = slots[slots.length - 1];
    setSlots([...slots, {
      key: Date.now(),
      weekday: last ? (last.weekday + 2) % 5 : 0,
      start_time: last?.start_time ?? '09:30',
      end_time: last?.end_time ?? '11:20',
      kind: 'lecture',
      location: last?.location ?? '',
    }]);
  };
  const updateSlot = (key: number, patch: Partial<Draft>) => setSlots(slots.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the course a code or name, like “EEE 402”.');
    if (slots.some((s) => s.end_time <= s.start_time)) return setError('Each class has to end after it starts.');
    if (termStart && termEnd && termEnd < termStart) return setError('The semester has to end after it starts.');
    setBusy(true);
    setError(null);
    const fields = { name, title, color, instructor, term_start: termStart || null, term_end: termEnd || null };
    try {
      let id = course?.id;
      if (course) await courses.updateCourse(course, fields);
      else id = await courses.createCourse(fields);
      await courses.saveSessions(id!, slots);
      if (!course && linkMentions && mentions.length) await courses.linkItemsToCourse(name.trim(), mentions.map((m) => m.id));
      onSaved(id!);
    } catch (err) {
      const message = String(err);
      setError(message.includes('UNIQUE') ? `There's already a course called “${name.trim()}”.` : message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!course) return;
    const ok = await ask(
      `Delete ${course.name}? Its library files, topics, notes, schedule and highlights are removed. Its tasks stay, just without a course.`,
      { title: 'Delete course', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    try {
      await courses.deleteCourse(course);
      onDeleted?.();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Modal title={course ? `Edit ${course.name}` : 'New course'} onClose={onClose} width="w-[760px]">
      <form onSubmit={submit} className="space-y-5 p-5">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <div>
            <FieldLabel>Code</FieldLabel>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="EEE 402" className={inputClass} />
          </div>
          <div>
            <FieldLabel>Title</FieldLabel>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Signals and Systems" className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
          <div>
            <FieldLabel>Instructor</FieldLabel>
            <input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Optional" className={inputClass} />
          </div>
          <div>
            <FieldLabel>Classes start</FieldLabel>
            <input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} className={inputClass} />
          </div>
          <div>
            <FieldLabel>Classes end</FieldLabel>
            <input type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <FieldLabel>Colour</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} title={c}
                className={`size-6 rounded-full ${c === color ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas' : ''}`}
                style={{ background: c }} />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <FieldLabel>Weekly schedule</FieldLabel>
            <button type="button" onClick={addSlot} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <Plus size={12} /> Add a class time
            </button>
          </div>
          {slots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-3 text-center text-xs text-muted">
              No class times yet. Add them and they appear in your calendar and in Today.
            </p>
          ) : (
            <div className="space-y-2">
              {slots.map((s) => (
                // Explicit widths: when the row was too tight, Room collapsed to ~0 px and the
                // browser kept the caret at the start, so typed text came out reversed.
                <div key={s.key} className="flex items-center gap-2">
                  <select value={s.weekday} onChange={(e) => updateSlot(s.key, { weekday: Number(e.target.value) })}
                    className={`${inputBase} w-30 shrink-0`}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                  <input type="time" value={s.start_time} onChange={(e) => updateSlot(s.key, { start_time: e.target.value })}
                    className={`${inputBase} w-26 shrink-0`} />
                  <span className="text-muted">–</span>
                  <input type="time" value={s.end_time} onChange={(e) => updateSlot(s.key, { end_time: e.target.value })}
                    className={`${inputBase} w-26 shrink-0`} />
                  <select value={s.kind} onChange={(e) => updateSlot(s.key, { kind: e.target.value as SessionKind })}
                    className={`${inputBase} w-26 shrink-0`}>
                    {KINDS.map((k) => <option key={k} value={k}>{SESSION_KIND_LABELS[k]}</option>)}
                  </select>
                  <input value={s.location} onChange={(e) => updateSlot(s.key, { location: e.target.value })}
                    placeholder="Room" className={`${inputBase} min-w-28 flex-1`} />
                  <button type="button" onClick={() => setSlots(slots.filter((x) => x.key !== s.key))} title="Remove"
                    className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {mentions.length > 0 && (
          <label className="flex items-start gap-2.5 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-ink">
            <input type="checkbox" checked={linkMentions} onChange={(e) => setLinkMentions(e.target.checked)} className="mt-1" />
            <span>
              Also put {mentions.length === 1 ? 'this task' : `these ${mentions.length} tasks`} in {name.trim()}:{' '}
              <span className="text-muted">{mentions.slice(0, 4).map((m) => m.title).join(', ')}{mentions.length > 4 ? '…' : ''}</span>
            </span>
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          {course && <Button variant="danger" onClick={remove}><Trash2 size={14} /> Delete course</Button>}
          <div className="ml-auto flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{course ? 'Save' : 'Create course'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
