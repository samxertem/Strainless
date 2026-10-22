import { useEffect, useMemo, useRef, useState } from 'react';
import { read, utils, type WorkBook } from 'xlsx';
import { useAnnotationHost } from './annotate/AnnotatedViewer';

interface Props {
  load: () => Promise<ArrayBuffer>;
  fileKey: string;
}

/** More cells than this and the DOM gets sluggish; the rest is a click away in Excel. */
const MAX_CELLS = 60_000;

/** Excel, LibreOffice (.ods), old .xls and .csv. Values are shown as Excel formats them. */
export function SheetViewer({ load, fileKey }: Props) {
  const [book, setBook] = useState<WorkBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const host = useAnnotationHost();

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setError(null);
    setActive(0);
    loadRef.current().then(
      (data) => {
        if (cancelled) return;
        try {
          setBook(read(new Uint8Array(data), { type: 'array', cellDates: true }));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [fileKey]);

  // Highlights on another sheet: switch to it first.
  useEffect(() => {
    host?.setJumpHandler((location) => setActive(location));
    return () => host?.setJumpHandler(null);
  }, [host]);

  useEffect(() => {
    if (book) host?.layoutChanged();
  }, [book, active, host]);

  const grid = useMemo(() => {
    if (!book) return null;
    const ws = book.Sheets[book.SheetNames[active]];
    if (!ws?.['!ref']) return { rows: [], cols: 0, widths: [], spans: new Map<string, [number, number]>(), covered: new Set<string>(), truncated: false, startCol: 0, startRow: 0 };
    const range = utils.decode_range(ws['!ref']);
    const cols = range.e.c - range.s.c + 1;
    const allRows = range.e.r - range.s.r + 1;
    const rowLimit = Math.max(1, Math.min(allRows, Math.floor(MAX_CELLS / cols)));
    const spans = new Map<string, [number, number]>();
    const covered = new Set<string>();
    for (const m of ws['!merges'] ?? []) {
      spans.set(`${m.s.r}:${m.s.c}`, [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1]);
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`);
    }
    const rows: { r: number; cells: { c: number; text: string; numeric: boolean }[] }[] = [];
    for (let r = range.s.r; r < range.s.r + rowLimit; r++) {
      const cells = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[utils.encode_cell({ r, c })];
        const text = cell ? (cell.w ?? (cell.v instanceof Date ? cell.v.toLocaleDateString() : String(cell.v ?? ''))) : '';
        cells.push({ c, text, numeric: cell?.t === 'n' });
      }
      rows.push({ r, cells });
    }
    const widths = Array.from({ length: cols }, (_, i) => {
      const info = ws['!cols']?.[range.s.c + i];
      return Math.max(48, Math.min(480, info?.wpx ?? (info?.wch ? info.wch * 7 + 10 : 96)));
    });
    return { rows, cols, widths, spans, covered, truncated: rowLimit < allRows, startCol: range.s.c, startRow: range.s.r };
  }, [book, active]);

  if (error) return <p className="mx-auto mt-20 max-w-md text-center text-sm text-white/80">Couldn't open this spreadsheet: {error}</p>;
  if (!book || !grid) return <p className="mt-20 text-center text-sm text-white/70">Opening spreadsheet…</p>;

  const hidden = (i: number) => (book.Workbook?.Sheets?.[i]?.Hidden ?? 0) > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-white text-[13px] text-neutral-900">
        <table className="border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 48 }} />
            {grid.widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead data-anno-skip>
            <tr>
              <th className="sticky top-0 left-0 z-20 border border-neutral-300 bg-neutral-100" />
              {grid.widths.map((_, i) => (
                <th key={i} className="sticky top-0 z-10 border border-neutral-300 bg-neutral-100 px-1 py-0.5 text-xs font-normal text-neutral-500">
                  {utils.encode_col(grid.startCol + i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-anno-segment={active} className="select-text">
            {grid.rows.map(({ r, cells }) => (
              <tr key={r}>
                <th data-anno-skip className="sticky left-0 z-10 border border-neutral-300 bg-neutral-100 px-1 text-right text-xs font-normal text-neutral-500">
                  {r + 1}
                </th>
                {cells.map(({ c, text, numeric }) => {
                  const key = `${r}:${c}`;
                  if (grid.covered.has(key)) return null;
                  const span = grid.spans.get(key);
                  return (
                    <td key={c} rowSpan={span?.[0]} colSpan={span?.[1]}
                      className={`overflow-hidden border border-neutral-200 px-1.5 py-0.5 whitespace-nowrap ${numeric ? 'text-right tabular-nums' : ''}`}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {grid.rows.length === 0 && <p className="p-6 text-sm text-neutral-500">This sheet is empty.</p>}
        {grid.truncated && (
          <p className="p-3 text-xs text-neutral-500">Showing the first {grid.rows.length.toLocaleString()} rows. Open in Excel for the rest.</p>
        )}
      </div>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-white/10 bg-neutral-900 px-2 py-1.5">
        {book.SheetNames.map((name, i) => (
          <button key={name} type="button" onClick={() => setActive(i)}
            className={`rounded-md px-3 py-1 text-xs whitespace-nowrap ${i === active ? 'bg-white text-neutral-900' : 'text-white/70 hover:bg-white/10'} ${hidden(i) ? 'italic opacity-60' : ''}`}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
