import type { Annotation, HighlightColor, StarredQuote } from './types';
import { HIGHLIGHT_COLORS } from './types';
import { db } from './db';

// ---------- storage ----------

export async function listAnnotations(fileRef: string): Promise<Annotation[]> {
  return (await db()).select<Annotation[]>(
    'SELECT * FROM annotations WHERE file_ref = $1 ORDER BY location, position',
    [fileRef],
  );
}

export type NewAnnotation = Pick<Annotation, 'file_ref' | 'color' | 'starred' | 'quote' | 'prefix' | 'suffix' | 'location' | 'position'>;

export async function createAnnotation(a: NewAnnotation): Promise<number> {
  const r = await (await db()).execute(
    `INSERT INTO annotations (file_ref, color, starred, quote, prefix, suffix, location, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [a.file_ref, a.color, a.starred, a.quote, a.prefix, a.suffix, a.location, a.position],
  );
  return r.lastInsertId as number;
}

export async function updateAnnotation(id: number, patch: Partial<{ color: HighlightColor; starred: number; note: string }>): Promise<void> {
  const d = await db();
  if (patch.color !== undefined) await d.execute('UPDATE annotations SET color = $1 WHERE id = $2', [patch.color, id]);
  if (patch.starred !== undefined) await d.execute('UPDATE annotations SET starred = $1 WHERE id = $2', [patch.starred, id]);
  if (patch.note !== undefined) await d.execute('UPDATE annotations SET note = $1 WHERE id = $2', [patch.note, id]);
}

export async function deleteAnnotation(id: number): Promise<void> {
  await (await db()).execute('DELETE FROM annotations WHERE id = $1', [id]);
}

/** Every starred quote, newest first, with what's needed to reopen its file. */
export async function listStarred(courseId?: number): Promise<StarredQuote[]> {
  const rows = await (await db()).select<StarredQuote[]>(
    `SELECT a.*, f.original_name AS file_name, 'course_file' AS file_kind, f.course_id AS owner_id,
            f.stored_name, f.mime, c.id AS course_id, c.name AS course_name, NULL AS item_title
       FROM annotations a
       JOIN course_files f ON a.file_ref = 'course_file:' || f.id
       JOIN courses c ON c.id = f.course_id
      WHERE a.starred = 1
     UNION ALL
     SELECT a.*, t.original_name, 'attachment', t.item_id, t.stored_name, t.mime, c.id, i.course, i.title
       FROM annotations a
       JOIN attachments t ON a.file_ref = 'attachment:' || t.id
       JOIN items i ON i.id = t.item_id
       LEFT JOIN courses c ON c.name = i.course
      WHERE a.starred = 1
     ORDER BY created_at DESC`,
  );
  return courseId === undefined ? rows : rows.filter((r) => r.course_id === courseId);
}

// ---------- anchoring ----------
//
// A highlight is stored as the quoted text plus a little context, inside one
// "segment" (a PDF page, a slide, a Word page, a sheet). Viewers mark segments
// with data-anno-segment="<index>". To find a highlight again, its segment's text
// is searched for the quote; context and the original position break ties.

const CONTEXT = 32;

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

/** All text in a segment, in document order, skipping parts marked data-anno-skip (row numbers…). */
export function indexText(segment: Element): TextIndex {
  const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('[data-anno-skip]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: TextIndex['nodes'] = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  return { text, nodes };
}

/** Character offset in the segment's text of a DOM boundary point (node, offset). */
function pointToOffset(index: TextIndex, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const hit = index.nodes.find((n) => n.node === container);
    if (hit) return hit.start + offset;
  }
  // The point sits between elements: count the text that ends at or before it.
  const point = document.createRange();
  point.setStart(container, offset);
  let total = 0;
  for (const { node } of index.nodes) {
    if (point.comparePoint(node, node.length) <= 0) total += node.length;
    else break;
  }
  return total;
}

function offsetToPoint(index: TextIndex, offset: number, isEnd: boolean): { node: Text; offset: number } | null {
  for (const { node, start } of index.nodes) {
    const end = start + node.length;
    if (isEnd ? offset > start && offset <= end : offset >= start && offset < end) return { node, offset: offset - start };
  }
  return null;
}

export interface Quote {
  quote: string;
  prefix: string;
  suffix: string;
  location: number;
  position: number;
}

/** Describes a selection inside one segment. Selections spilling into the next page are clipped. */
export function describeRange(range: Range, segment: Element, location: number): Quote | null {
  const index = indexText(segment);
  const start = pointToOffset(index, range.startContainer, range.startOffset);
  let end = segment.contains(range.endContainer) ? pointToOffset(index, range.endContainer, range.endOffset) : index.text.length;
  if (end <= start) end = index.text.length;
  const quote = index.text.slice(start, end);
  if (!quote.trim()) return null;
  return {
    quote,
    prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: index.text.slice(end, end + CONTEXT),
    location,
    position: start,
  };
}

/** Length of the common suffix of a and b (how well the text before a match agrees). */
const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** Finds the best occurrence of a quote in some text, or -1. Exported for tests. */
export function findQuote(text: string, q: Pick<Quote, 'quote' | 'prefix' | 'suffix' | 'position'>): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let at = text.indexOf(q.quote); at !== -1; at = text.indexOf(q.quote, at + 1)) {
    const score =
      commonSuffix(text.slice(Math.max(0, at - q.prefix.length), at), q.prefix) +
      commonPrefix(text.slice(at + q.quote.length, at + q.quote.length + q.suffix.length), q.suffix) -
      Math.abs(at - q.position) / 10_000;
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return best;
}

/** Re-creates the DOM range of a stored quote inside its segment, if the text is there. */
export function anchorQuote(segment: Element, q: Quote): Range | null {
  const index = indexText(segment);
  const at = findQuote(index.text, q);
  if (at < 0) return null;
  const start = offsetToPoint(index, at, false);
  const end = offsetToPoint(index, at + q.quote.length, true);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** Lower case without accents, so "cap" matches "ÇAP" the way search does. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Finds a search query in a segment's text, ignoring case and accents: the whole
 * phrase if it's there, otherwise its longest word. Used to mark a search hit.
 */
export function findTextRange(segment: Element, query: string): Range | null {
  const index = indexText(segment);
  // Fold one character at a time, remembering where each folded character came from.
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < index.text.length; i++) {
    for (const c of fold(index.text[i])) {
      folded += c;
      origin.push(i);
    }
  }
  const words = query.trim().split(/\s+/).filter(Boolean);
  for (const candidate of [words.join(' '), ...[...words].sort((a, b) => b.length - a.length)]) {
    const needle = fold(candidate);
    const at = needle ? folded.indexOf(needle) : -1;
    if (at < 0) continue;
    const start = offsetToPoint(index, origin[at], false);
    const end = offsetToPoint(index, origin[at + needle.length - 1] + 1, true);
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  }
  return null;
}

// ---------- painting ----------
//
// The CSS Custom Highlight API paints ranges without touching the DOM, which
// matters here: pdf.js and docx-preview own their DOM and would fight wrappers.

const hasHighlightApi = () => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

export function paintHighlights(ranges: { range: Range; color: HighlightColor; starred: boolean }[], active: Range | null) {
  if (!hasHighlightApi()) return;
  for (const color of HIGHLIGHT_COLORS) {
    CSS.highlights.set(`anno-${color}`, new Highlight(...ranges.filter((r) => r.color === color).map((r) => r.range)));
  }
  CSS.highlights.set('anno-starred', new Highlight(...ranges.filter((r) => r.starred).map((r) => r.range)));
  CSS.highlights.set('anno-active', active ? new Highlight(active) : new Highlight());
}

/** Marks the words a search result pointed at. */
export function paintSearchHit(range: Range | null) {
  if (!hasHighlightApi()) return;
  CSS.highlights.set('search-hit', range ? new Highlight(range) : new Highlight());
}

export function clearHighlights() {
  if (!hasHighlightApi()) return;
  for (const name of [...HIGHLIGHT_COLORS.map((c) => `anno-${c}`), 'anno-starred', 'anno-active', 'search-hit']) {
    CSS.highlights.delete(name);
  }
}

/** CSS for highlight colours; also injected into shadow roots (Word documents). */
export const HIGHLIGHT_CSS = `
  ::highlight(anno-yellow) { background-color: rgb(255 210 70 / 0.45); }
  ::highlight(anno-green) { background-color: rgb(110 205 135 / 0.42); }
  ::highlight(anno-pink) { background-color: rgb(245 135 185 / 0.40); }
  ::highlight(anno-blue) { background-color: rgb(110 170 245 / 0.40); }
  ::highlight(anno-starred) { text-decoration: underline 2px rgb(196 150 30); text-underline-offset: 3px; }
  ::highlight(anno-active) { background-color: rgb(0 0 0 / 0.10); }
  ::highlight(search-hit) { background-color: rgb(250 160 60 / 0.55); }
`;
