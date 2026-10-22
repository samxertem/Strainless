import { useCallback, useEffect, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { FileText, Plus, Trash2 } from 'lucide-react';
import type { Course, CourseNote } from '../../lib/types';
import * as courses from '../../lib/courses';
import { useDebouncedSave } from '../../lib/hooks';
import { MarkdownEditor } from '../MarkdownEditor';
import { courseNoteImages } from './noteImages';

interface Props {
  course: Course;
  /** Open this note first (from search). */
  initialNoteId?: number;
  onError: (message: string) => void;
}

const edited = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A small notebook per course: markdown pages with code blocks and pasted screenshots. */
export function NotesTab({ course, initialNoteId, onError }: Props) {
  const [notes, setNotes] = useState<CourseNote[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initialNoteId ?? null);

  const load = useCallback(async () => {
    try {
      const list = await courses.listCourseNotes(course.id);
      setNotes(list);
      setSelectedId((id) => (id !== null && list.some((n) => n.id === id) ? id : (list[0]?.id ?? null)));
    } catch (e) {
      onError(String(e));
    }
  }, [course.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      const id = await courses.createCourseNote(course.id);
      setSelectedId(id);
      await load();
    } catch (e) {
      onError(String(e));
    }
  };

  const remove = async (note: CourseNote) => {
    const ok = await ask(`Delete the note “${note.title || 'Untitled'}”?`, { title: 'Delete note', kind: 'warning' });
    if (!ok) return;
    await courses.deleteCourseNote(note.id).catch((e) => onError(String(e)));
    setSelectedId(null);
    await load();
  };

  if (!notes) return null;
  const selected = notes.find((n) => n.id === selectedId) ?? null;

  if (notes.length === 0) {
    return (
      <button type="button" onClick={create}
        className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-14 text-muted hover:border-accent/60 hover:text-ink">
        <FileText size={26} strokeWidth={1.5} />
        <span className="text-sm font-medium">Start a note for {course.name}</span>
        <span className="text-xs">Lecture notes, formulas, code snippets with highlighting, pasted screenshots.</span>
      </button>
    );
  }

  return (
    <div className="flex gap-5">
      <nav className="w-52 shrink-0">
        <button type="button" onClick={create}
          className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted hover:border-accent/60 hover:text-ink">
          <Plus size={14} /> New note
        </button>
        <ul className="space-y-0.5">
          {notes.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => setSelectedId(n.id)}
                className={`w-full rounded-lg px-3 py-2 text-left ${n.id === selectedId ? 'bg-surface shadow-sm' : 'hover:bg-surface-2'}`}>
                <div className="truncate text-[13px] text-ink">{n.title || 'Untitled'}</div>
                <div className="text-[11px] text-muted">{edited.format(new Date(n.updated_at))}</div>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        {selected && <NoteEditor key={selected.id} note={selected} course={course} onDelete={() => remove(selected)} onSaved={load} onError={onError} />}
      </div>
    </div>
  );
}

function NoteEditor({ note, course, onDelete, onSaved, onError }: {
  note: CourseNote; course: Course; onDelete: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body_md);
  const { queue } = useDebouncedSave<{ title?: string; body_md?: string }>(
    (patch) => void courses.updateCourseNote(note.id, patch).then(onSaved, (e) => onError(String(e))),
    600,
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <input value={title} placeholder="Untitled note"
          onChange={(e) => {
            setTitle(e.target.value);
            queue({ title: e.target.value });
          }}
          className="min-w-0 flex-1 bg-transparent font-serif text-xl text-ink outline-none placeholder:text-muted/60" />
        <button type="button" onClick={onDelete} title="Delete note" className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
          <Trash2 size={15} />
        </button>
      </div>
      <MarkdownEditor value={body} minHeight={360} images={courseNoteImages(course.id)} preferPreview={false}
        placeholder={'# Week 3: Fourier transform\n\n- Key idea…\n\n```python\nimport numpy as np\n```\n\nPaste screenshots with Ctrl+V.'}
        onChange={(v) => {
          setBody(v);
          queue({ body_md: v });
        }} />
    </div>
  );
}
