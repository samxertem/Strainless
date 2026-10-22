import type {
  ClassOccurrence, Course, CourseFile, CourseHit, CourseNote, CourseSession, CourseTaskFile, CourseTopic, TopicStatus,
} from './types';
import { db, likePattern, nowIso } from './db';
import { deleteFile, deleteOwnerFiles, guessMime, importBytes, importFile } from './files';
import { addDays, startOfDay, toDateInput } from './dates';

// ---------- courses ----------

export async function listCourses(): Promise<Course[]> {
  return (await db()).select<Course[]>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM course_files f WHERE f.course_id = c.id AND f.hidden = 0) AS file_count,
       (SELECT COUNT(*) FROM course_topics t WHERE t.course_id = c.id) AS topic_count,
       (SELECT COUNT(*) FROM course_topics t WHERE t.course_id = c.id AND t.status = 'done') AS topics_done
     FROM courses c ORDER BY c.sort_order, c.name`,
  );
}

export type CourseFields = Pick<Course, 'name' | 'title' | 'color' | 'instructor' | 'term_start' | 'term_end'>;

export async function createCourse(fields: CourseFields): Promise<number> {
  const r = await (await db()).execute(
    `INSERT INTO courses (name, title, color, instructor, term_start, term_end, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM courses))`,
    [fields.name.trim(), fields.title.trim(), fields.color, fields.instructor.trim(), fields.term_start, fields.term_end],
  );
  return r.lastInsertId as number;
}

/** Renaming a course renames it on its tasks too, since items refer to courses by name. */
export async function updateCourse(course: Course, fields: CourseFields): Promise<void> {
  const d = await db();
  const name = fields.name.trim();
  await d.execute(
    `UPDATE courses SET name = $1, title = $2, color = $3, instructor = $4, term_start = $5, term_end = $6 WHERE id = $7`,
    [name, fields.title.trim(), fields.color, fields.instructor.trim(), fields.term_start, fields.term_end, course.id],
  );
  if (name !== course.name) await d.execute('UPDATE items SET course = $1 WHERE course = $2', [name, course.name]);
}

/** Removes the course, its topics, notes, library files and their highlights. Tasks stay, without a course. */
export async function deleteCourse(course: Course): Promise<void> {
  const d = await db();
  await d.execute(
    `DELETE FROM annotations WHERE file_ref IN (SELECT 'course_file:' || id FROM course_files WHERE course_id = $1)`,
    [course.id],
  );
  await d.execute('DELETE FROM courses WHERE id = $1', [course.id]); // cascades to topics, files, notes, sessions
  await d.execute('UPDATE items SET course = NULL WHERE course = $1', [course.name]);
  await deleteOwnerFiles('courses', course.id);
}

export async function reorderCourses(orderedIds: number[]): Promise<void> {
  const d = await db();
  for (const [i, id] of orderedIds.entries()) await d.execute('UPDATE courses SET sort_order = $1 WHERE id = $2', [i + 1, id]);
}

/** Items without a course whose title mentions the course name ("SE 320 Homework" → SE 320). */
export async function itemsMentioning(name: string): Promise<{ id: number; title: string }[]> {
  if (!name.trim()) return [];
  return (await db()).select<{ id: number; title: string }[]>(
    `SELECT id, title FROM items WHERE course IS NULL AND title LIKE $1 ESCAPE '\\' ORDER BY id`,
    [likePattern(name)],
  );
}

export async function linkItemsToCourse(name: string, itemIds: number[]): Promise<void> {
  const d = await db();
  for (const id of itemIds) await d.execute('UPDATE items SET course = $1, updated_at = $2 WHERE id = $3', [name, nowIso(), id]);
}

// ---------- weekly schedule ----------

export async function listSessions(courseId?: number): Promise<CourseSession[]> {
  const d = await db();
  return courseId === undefined
    ? d.select<CourseSession[]>('SELECT * FROM course_sessions ORDER BY weekday, start_time')
    : d.select<CourseSession[]>('SELECT * FROM course_sessions WHERE course_id = $1 ORDER BY weekday, start_time', [courseId]);
}

export type SessionFields = Pick<CourseSession, 'weekday' | 'start_time' | 'end_time' | 'kind' | 'location'>;

/** Replaces a course's timetable in one go (the editor works on the whole list). */
export async function saveSessions(courseId: number, sessions: SessionFields[]): Promise<void> {
  const d = await db();
  await d.execute('DELETE FROM course_sessions WHERE course_id = $1', [courseId]);
  for (const s of sessions) {
    await d.execute(
      'INSERT INTO course_sessions (course_id, weekday, start_time, end_time, kind, location) VALUES ($1, $2, $3, $4, $5, $6)',
      [courseId, s.weekday, s.start_time, s.end_time, s.kind, s.location.trim()],
    );
  }
}

/** Monday = 0 … Sunday = 6, matching course_sessions.weekday. */
export const weekdayOf = (d: Date) => (d.getDay() + 6) % 7;

const atTime = (day: Date, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
};

/**
 * Concrete classes between two dates (inclusive), from the weekly timetable,
 * respecting each course's term dates when set.
 */
export function classesBetween(sessions: CourseSession[], courses: Course[], from: Date, to: Date): ClassOccurrence[] {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const out: ClassOccurrence[] = [];
  for (let day = startOfDay(from); day <= to; day = addDays(day, 1)) {
    const key = toDateInput(day);
    for (const session of sessions) {
      const course = byId.get(session.course_id);
      if (!course || session.weekday !== weekdayOf(day)) continue;
      if (course.term_start && key < course.term_start) continue;
      if (course.term_end && key > course.term_end) continue;
      out.push({ session, course, day: key, start: atTime(day, session.start_time), end: atTime(day, session.end_time) });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ---------- topics ----------

export async function listTopics(courseId: number): Promise<CourseTopic[]> {
  return (await db()).select<CourseTopic[]>(
    'SELECT * FROM course_topics WHERE course_id = $1 ORDER BY sort_order, id',
    [courseId],
  );
}

/** Adds topics in order; pasting a syllabus gives one topic per line. */
export async function addTopics(courseId: number, titles: string[]): Promise<void> {
  const d = await db();
  for (const title of titles.map((t) => t.trim()).filter(Boolean)) {
    await d.execute(
      `INSERT INTO course_topics (course_id, title, sort_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM course_topics WHERE course_id = $1))`,
      [courseId, title],
    );
  }
}

export async function updateTopic(
  id: number,
  patch: Partial<{ title: string; status: TopicStatus; notes_md: string }>,
): Promise<void> {
  const d = await db();
  if (patch.title !== undefined) await d.execute('UPDATE course_topics SET title = $1, updated_at = $2 WHERE id = $3', [patch.title, nowIso(), id]);
  if (patch.status !== undefined) await d.execute('UPDATE course_topics SET status = $1, updated_at = $2 WHERE id = $3', [patch.status, nowIso(), id]);
  if (patch.notes_md !== undefined) await d.execute('UPDATE course_topics SET notes_md = $1, updated_at = $2 WHERE id = $3', [patch.notes_md, nowIso(), id]);
}

export async function reorderTopics(orderedIds: number[]): Promise<void> {
  const d = await db();
  for (const [i, id] of orderedIds.entries()) await d.execute('UPDATE course_topics SET sort_order = $1 WHERE id = $2', [i + 1, id]);
}

/** The topic's files stay in the library, unsorted (FK: ON DELETE SET NULL). */
export async function deleteTopic(id: number): Promise<void> {
  await (await db()).execute('DELETE FROM course_topics WHERE id = $1', [id]);
}

// ---------- library ----------

export async function listCourseFiles(courseId: number): Promise<CourseFile[]> {
  return (await db()).select<CourseFile[]>(
    'SELECT * FROM course_files WHERE course_id = $1 AND hidden = 0 ORDER BY added_at DESC, id DESC',
    [courseId],
  );
}

export async function getCourseFile(id: number): Promise<CourseFile | null> {
  return (await (await db()).select<CourseFile[]>('SELECT * FROM course_files WHERE id = $1', [id]))[0] ?? null;
}

export async function addCourseFiles(courseId: number, sourcePaths: string[], topicId: number | null = null): Promise<void> {
  const d = await db();
  for (const sourcePath of sourcePaths) {
    const f = await importFile('courses', courseId, sourcePath);
    await d.execute(
      `INSERT INTO course_files (course_id, topic_id, original_name, stored_name, mime, size)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseId, topicId, f.original_name, f.stored_name, guessMime(f.original_name), f.size],
    );
  }
}

/** Stores a pasted image for notes. Hidden: it belongs to the note, not the library listing. */
export async function addPastedImage(courseId: number, blob: Blob): Promise<number> {
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/gif' ? 'gif' : blob.type === 'image/webp' ? 'webp' : 'png';
  const name = `pasted-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.${ext}`;
  const f = await importBytes('courses', courseId, name, new Uint8Array(await blob.arrayBuffer()));
  const r = await (await db()).execute(
    `INSERT INTO course_files (course_id, original_name, stored_name, mime, size, hidden) VALUES ($1, $2, $3, $4, $5, 1)`,
    [courseId, f.original_name, f.stored_name, blob.type || 'image/png', f.size],
  );
  return r.lastInsertId as number;
}

/** An image picked from disk for a note: stored hidden, like pasted ones. Returns the file id. */
export async function addNoteImageFromPath(courseId: number, sourcePath: string): Promise<number> {
  const f = await importFile('courses', courseId, sourcePath);
  const r = await (await db()).execute(
    `INSERT INTO course_files (course_id, original_name, stored_name, mime, size, hidden) VALUES ($1, $2, $3, $4, $5, 1)`,
    [courseId, f.original_name, f.stored_name, guessMime(f.original_name), f.size],
  );
  return r.lastInsertId as number;
}

export async function moveCourseFile(id: number, topicId: number | null): Promise<void> {
  await (await db()).execute('UPDATE course_files SET topic_id = $1 WHERE id = $2', [topicId, id]);
}

export async function deleteCourseFile(f: CourseFile): Promise<void> {
  const d = await db();
  await d.execute('DELETE FROM annotations WHERE file_ref = $1', [`course_file:${f.id}`]);
  await d.execute('DELETE FROM course_files WHERE id = $1', [f.id]);
  await deleteFile('courses', f.course_id, f.stored_name);
}

/** Files attached to the course's tasks (homework PDFs etc.), shown read-only in the library. */
export async function listCourseTaskFiles(courseName: string): Promise<CourseTaskFile[]> {
  return (await db()).select<CourseTaskFile[]>(
    `SELECT a.*, i.title AS item_title FROM attachments a JOIN items i ON i.id = a.item_id
     WHERE i.course = $1 ORDER BY a.added_at DESC`,
    [courseName],
  );
}

// ---------- notes ----------

export async function listCourseNotes(courseId: number): Promise<CourseNote[]> {
  return (await db()).select<CourseNote[]>(
    'SELECT id, course_id, title, body_md, sort_order, updated_at FROM course_notes WHERE course_id = $1 ORDER BY sort_order, id',
    [courseId],
  );
}

export async function createCourseNote(courseId: number, title = ''): Promise<number> {
  const r = await (await db()).execute(
    `INSERT INTO course_notes (course_id, title, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM course_notes WHERE course_id = $1))`,
    [courseId, title],
  );
  return r.lastInsertId as number;
}

export async function updateCourseNote(id: number, patch: Partial<{ title: string; body_md: string }>): Promise<void> {
  const d = await db();
  if (patch.title !== undefined) await d.execute('UPDATE course_notes SET title = $1, updated_at = $2 WHERE id = $3', [patch.title, nowIso(), id]);
  if (patch.body_md !== undefined) await d.execute('UPDATE course_notes SET body_md = $1, updated_at = $2 WHERE id = $3', [patch.body_md, nowIso(), id]);
}

export async function deleteCourseNote(id: number): Promise<void> {
  await (await db()).execute('DELETE FROM course_notes WHERE id = $1', [id]);
}

// ---------- search ----------

export async function searchCourses(query: string): Promise<CourseHit[]> {
  if (!query.trim()) return [];
  const p = likePattern(query);
  return (await db()).select<CourseHit[]>(
    `SELECT 'file' AS kind, c.id AS course_id, c.name AS course_name, f.original_name AS label, f.id AS target_id
       FROM course_files f JOIN courses c ON c.id = f.course_id
       WHERE f.hidden = 0 AND f.original_name LIKE $1 ESCAPE '\\'
     UNION ALL
     SELECT 'topic', c.id, c.name, t.title, t.id
       FROM course_topics t JOIN courses c ON c.id = t.course_id
       WHERE t.title LIKE $1 ESCAPE '\\' OR t.notes_md LIKE $1 ESCAPE '\\'
     UNION ALL
     SELECT 'note', c.id, c.name, CASE WHEN n.title <> '' THEN n.title ELSE 'Untitled note' END, n.id
       FROM course_notes n JOIN courses c ON c.id = n.course_id
       WHERE n.title LIKE $1 ESCAPE '\\' OR n.body_md LIKE $1 ESCAPE '\\'
     LIMIT 30`,
    [p],
  );
}
