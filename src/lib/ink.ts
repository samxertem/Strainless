import { db } from './db';

export type InkTool = 'pen' | 'highlighter';

/** One pen stroke. Points are [x0, y0, x1, y1, …] in units of the page width. */
export interface InkStroke {
  id: number;
  file_ref: string;
  location: number;
  tool: InkTool;
  color: string;
  width: number;
  points: number[];
}

export type NewStroke = Omit<InkStroke, 'id'>;

export async function listStrokes(fileRef: string): Promise<InkStroke[]> {
  const rows = await (await db()).select<(Omit<InkStroke, 'points'> & { points: string })[]>(
    'SELECT id, file_ref, location, tool, color, width, points FROM ink_strokes WHERE file_ref = $1 ORDER BY id',
    [fileRef],
  );
  return rows.map((r) => ({ ...r, points: JSON.parse(r.points) as number[] }));
}

export async function addStroke(s: NewStroke): Promise<number> {
  // Four decimals is a tenth of a pixel on a 1000 px page, and keeps the JSON small.
  const points = JSON.stringify(s.points.map((v) => Math.round(v * 10000) / 10000));
  const r = await (await db()).execute(
    'INSERT INTO ink_strokes (file_ref, location, tool, color, width, points) VALUES ($1, $2, $3, $4, $5, $6)',
    [s.file_ref, s.location, s.tool, s.color, s.width, points],
  );
  return r.lastInsertId as number;
}

export async function deleteStroke(id: number): Promise<void> {
  await (await db()).execute('DELETE FROM ink_strokes WHERE id = $1', [id]);
}
