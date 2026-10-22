import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Star } from 'lucide-react';
import type { StarredQuote } from '../lib/types';
import { listStarred, updateAnnotation } from '../lib/annotations';
import { attachmentPreview, courseFilePreview, type PreviewFile } from '../lib/files';
import { Preview } from './Preview';
import { FileIcon } from './FileIcon';
import { SWATCH } from './annotate/AnnotatedViewer';

interface Props {
  /** Only quotes from this course's files (and its tasks' attachments). */
  courseId?: number;
  showCourse?: boolean;
  emptyText: string;
}

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

function previewOf(q: StarredQuote): PreviewFile {
  const id = Number(q.file_ref.split(':')[1]);
  const file = { id, original_name: q.file_name, stored_name: q.stored_name, mime: q.mime };
  return q.file_kind === 'course_file'
    ? courseFilePreview({ ...file, course_id: q.owner_id })
    : attachmentPreview({ ...file, item_id: q.owner_id });
}

/** Starred quotes as cards, grouped by file; clicking one reopens the file right at the quote. */
export function StarredList({ courseId, showCourse = true, emptyText }: Props) {
  const [quotes, setQuotes] = useState<StarredQuote[] | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<{ file: PreviewFile; annotationId: number } | null>(null);

  const load = useCallback(() => listStarred(courseId).then(setQuotes, () => setQuotes([])), [courseId]);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = (quotes ?? []).filter((x) => !q || `${x.quote} ${x.note} ${x.file_name}`.toLowerCase().includes(q));
    const byFile = new Map<string, StarredQuote[]>();
    for (const x of shown) byFile.set(x.file_ref, [...(byFile.get(x.file_ref) ?? []), x]);
    return [...byFile.values()];
  }, [quotes, filter]);

  if (quotes === null) return null;
  if (quotes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
        <Star size={22} className="mx-auto mb-3 text-muted" />
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
        <Search size={14} className="text-muted" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter quotes and notes…"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70" />
        <span className="text-xs text-muted">{quotes.length} starred</span>
      </div>

      <div className="space-y-6">
        {groups.map((group) => {
          const first = group[0];
          return (
            <section key={first.file_ref}>
              <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                <FileIcon name={first.file_name} size={14} tinted />
                <span className="truncate font-medium text-ink">{first.file_name}</span>
                {showCourse && first.course_name && <span>· {first.course_name}</span>}
                {first.item_title && <span className="truncate">· {first.item_title}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.map((q) => (
                  <article key={q.id} className="group relative rounded-xl border border-line bg-surface p-4 shadow-sm"
                    style={{ borderLeft: `3px solid ${SWATCH[q.color]}` }}>
                    <button type="button" onClick={() => setOpen({ file: previewOf(q), annotationId: q.id })}
                      className="block w-full text-left font-serif text-[15px] leading-relaxed text-ink italic hover:text-accent">
                      “{q.quote.replace(/\s+/g, ' ').trim()}”
                    </button>
                    {q.note && <p className="mt-2 text-sm text-muted">{q.note}</p>}
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                      <span>{when.format(new Date(q.created_at))}</span>
                      <button type="button" title="Unstar" onClick={() => void updateAnnotation(q.id, { starred: 0 }).then(load)}
                        className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink">
                        <Star size={13} className="fill-amber-400 text-amber-400" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {open && (
        <Preview files={[open.file]} index={0} onIndexChange={() => {}} initialAnnotationId={open.annotationId}
          onClose={() => {
            setOpen(null);
            void load();
          }} />
      )}
    </div>
  );
}
