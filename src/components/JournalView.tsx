import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, ChevronRight, ImagePlus, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { JournalBlock, JournalDay, JournalFont } from '../lib/types';
import * as db from '../lib/db';
import { addDays, toDateInput } from '../lib/dates';
import { useDebouncedSave } from '../lib/hooks';
import { Segmented } from './ui';

interface Props {
  day: string;
  todayKey: string;
  onDayChange: (day: string) => void;
  /** Bumped by the parent after a photo was dropped onto the mood box. */
  refreshKey: number;
  /** True while a file is dragged over the mood box. */
  moodDropActive: boolean;
  onError: (message: string) => void;
}

export const MOOD_PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

const pageDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const chipDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** Gentle prompts, used as placeholders so an empty page never feels like a blank exam sheet. */
const PROMPTS = [
  'What’s taking up space in your head right now?',
  'One thing that went okay today…',
  'What can wait until tomorrow?',
  'Something you noticed today',
  'If today had a title…',
  'What would make tomorrow a little lighter?',
];

/** Staggered top offsets, echoing the scattered layout of the sketch. */
const OFFSETS = [0, 28, 12, 40, 4, 20];

const FONT_OPTIONS: { value: JournalFont; label: string }[] = [
  { value: 'hand', label: 'Handwritten' },
  { value: 'serif', label: 'Book' },
  { value: 'sans', label: 'Clean' },
];

const FONT_STYLES: Record<JournalFont, { title: string; body: string; lineHeight: number }> = {
  hand: { title: 'font-hand text-[26px] font-semibold', body: 'font-hand text-[21px]', lineHeight: 32 },
  serif: { title: 'font-serif text-lg font-semibold', body: 'font-serif text-[15px]', lineHeight: 28 },
  sans: { title: 'text-base font-semibold', body: 'text-sm', lineHeight: 24 },
};

const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function JournalView({ day, todayKey, onDayChange, refreshKey, moodDropActive, onError }: Props) {
  const [page, setPage] = useState<JournalDay | null>(null);
  const [blocks, setBlocks] = useState<JournalBlock[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pastDays, setPastDays] = useState<string[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const load = useCallback(async () => {
    try {
      // Every page starts with one space ready to write in. Empty spaces are harmless:
      // pages only count as "written" once a space has text.
      await db.ensureJournalBlock(day);
      const [p, b, days] = await Promise.all([db.getJournalDay(day), db.listJournalBlocks(day), db.journalDaysWithContent()]);
      setPage(p);
      setBlocks(b);
      setPastDays(days.filter((d) => d !== day).slice(0, 8));
    } catch (e) {
      onErrorRef.current(String(e));
    }
  }, [day]);

  useEffect(() => {
    setBlocks(null);
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    let live = true;
    setPhotoUrl(null);
    if (page?.mood_photo) db.moodPhotoUrl(day, page.mood_photo).then((u) => live && setPhotoUrl(u), () => {});
    return () => {
      live = false;
    };
  }, [day, page?.mood_photo]);

  const font = page?.font ?? 'hand';
  const style = FONT_STYLES[font];

  const pickPhoto = async () => {
    const path = await open({ title: 'Choose a mood photo', multiple: false,
      filters: [{ name: 'Images', extensions: MOOD_PHOTO_EXTENSIONS }] });
    if (!path || Array.isArray(path)) return;
    try {
      await db.setMoodPhoto(day, path);
      await load();
    } catch (e) {
      onError(String(e));
    }
  };

  const removePhoto = async () => {
    try {
      await db.removeMoodPhoto(day);
      await load();
    } catch (e) {
      onError(String(e));
    }
  };

  const changeFont = async (next: JournalFont) => {
    setPage((p) => (p ? { ...p, font: next } : p));
    await db.setJournalFont(day, next).catch((e) => onError(String(e)));
  };

  const addBlock = async () => {
    try {
      await db.createJournalBlock(day);
      setBlocks(await db.listJournalBlocks(day));
    } catch (e) {
      onError(String(e));
    }
  };

  const removeBlock = async (block: JournalBlock, hasText: boolean) => {
    if (hasText && !(await ask('Delete this writing space and everything in it?', { title: 'Delete space', kind: 'warning' }))) return;
    try {
      await db.deleteJournalBlock(block.id);
      await db.ensureJournalBlock(day);
      setBlocks(await db.listJournalBlocks(day));
    } catch (e) {
      onError(String(e));
    }
  };

  const date = parseDay(day);
  const isToday = day === todayKey;
  const step = (delta: number) => onDayChange(toDateInput(addDays(date, delta)));

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => step(-1)} title="Previous day"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><ChevronLeft size={18} /></button>
        <div>
          <div className="text-xs tracking-wide text-muted uppercase">{isToday ? 'Today' : 'Journal'}</div>
          <h1 className="font-serif text-2xl text-ink">{pageDate.format(date)}</h1>
        </div>
        <button type="button" onClick={() => step(1)} title="Next day"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><ChevronRight size={18} /></button>
        {!isToday && (
          <button type="button" onClick={() => onDayChange(todayKey)}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:bg-surface-2">Today</button>
        )}
        <div className="ml-auto">
          <Segmented options={FONT_OPTIONS} value={font} onChange={changeFont} />
        </div>
      </header>

      {pastDays.length > 0 && (
        <div className="mb-8 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 text-muted">Earlier pages</span>
          {pastDays.map((d) => (
            <button key={d} type="button" onClick={() => onDayChange(d)}
              className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-muted hover:text-ink">
              {chipDate.format(parseDay(d))}
            </button>
          ))}
        </div>
      )}

      {/* Mood photo, with the hand-drawn arrow label from the sketch. */}
      <section className="mb-10 flex items-center gap-4">
        <div className="hidden w-36 shrink-0 text-right md:block">
          <span className="font-hand text-2xl leading-tight text-muted">{isToday ? 'today’s' : 'the day’s'} mood</span>
          <svg viewBox="0 0 120 40" className="mt-1 ml-auto h-8 w-28 text-muted" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 24 C 40 30, 80 30, 108 14" />
            <path d="M96 8 L 110 13 L 102 26" />
          </svg>
        </div>
        <div
          data-drop-mood={day}
          className={`group relative h-60 flex-1 overflow-hidden rounded-3xl transition-shadow ${
            photoUrl ? 'shadow-md' : 'border-2 border-dashed border-line bg-surface/60'} ${
            moodDropActive ? 'shadow-[0_0_0_3px_var(--accent)]' : ''}`}
        >
          {photoUrl ? (
            <>
              <img src={photoUrl} alt="Mood of the day" className="h-full w-full object-cover" />
              <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button type="button" onClick={pickPhoto} title="Replace photo"
                  className="rounded-full bg-black/55 p-2 text-white hover:bg-black/70"><RefreshCw size={14} /></button>
                <button type="button" onClick={removePhoto} title="Remove photo"
                  className="rounded-full bg-black/55 p-2 text-white hover:bg-black/70"><X size={14} /></button>
              </div>
            </>
          ) : (
            <button type="button" onClick={pickPhoto}
              className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted hover:text-ink">
              <ImagePlus size={26} strokeWidth={1.5} />
              <span className="font-hand text-2xl">drop a photo here</span>
              <span className="text-xs">or click to choose one</span>
            </button>
          )}
        </div>
      </section>

      {/* Free-write spaces, staggered across columns like the sketch. */}
      {blocks && (
        <div className="columns-1 gap-6 sm:columns-2 lg:columns-3">
          {blocks.map((block, i) => (
            <div key={block.id} className="break-inside-avoid pb-6" style={{ paddingTop: OFFSETS[i % OFFSETS.length] }}>
              <WriteSpace block={block} fontStyle={style} prompt={PROMPTS[i % PROMPTS.length]}
                onDelete={(hasText) => removeBlock(block, hasText)} onError={onError} />
            </div>
          ))}
          <div className="break-inside-avoid pb-6" style={{ paddingTop: OFFSETS[blocks.length % OFFSETS.length] }}>
            <button type="button" onClick={addBlock}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line py-8 text-muted transition-colors hover:border-accent/60 hover:text-ink">
              <Plus size={18} /> <span className="font-hand text-2xl">another space</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface WriteSpaceProps {
  block: JournalBlock;
  fontStyle: (typeof FONT_STYLES)[JournalFont];
  prompt: string;
  onDelete: (hasText: boolean) => void;
  onError: (message: string) => void;
}

/** One free-write card. Local drafts + debounced saves, flushed on unmount. */
function WriteSpace({ block, fontStyle, prompt, onDelete, onError }: WriteSpaceProps) {
  const [title, setTitle] = useState(block.title);
  const [body, setBody] = useState(block.body);
  const { queue, cancel } = useDebouncedSave<{ title?: string; body?: string }>(
    (patch) => void db.updateJournalBlock(block.id, patch).catch((e) => onError(String(e))),
    400,
  );

  // Ruled lines that line up with the text, like a notebook page.
  const lh = fontStyle.lineHeight;
  const ruled: CSSProperties = {
    lineHeight: `${lh}px`,
    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${lh - 1}px, var(--line) ${lh - 1}px, var(--line) ${lh}px)`,
    backgroundAttachment: 'local',
  };

  return (
    <div className="group relative rounded-2xl border border-line bg-surface px-5 pt-4 pb-5 shadow-sm">
      <button type="button" title="Delete this space"
        onClick={() => {
          cancel();
          onDelete(Boolean(title.trim() || body.trim()));
        }}
        className="absolute top-3 right-3 rounded-md p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger">
        <Trash2 size={13} />
      </button>
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          queue({ title: e.target.value });
        }}
        placeholder="free write space"
        className={`mb-2 w-full bg-transparent pr-6 text-ink outline-none placeholder:text-muted/60 ${fontStyle.title}`}
      />
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          queue({ body: e.target.value });
        }}
        placeholder={prompt}
        style={{ ...ruled, minHeight: lh * 5 }}
        className={`field-sizing-content block w-full resize-none bg-transparent text-ink outline-none placeholder:text-muted/50 ${fontStyle.body}`}
      />
    </div>
  );
}
