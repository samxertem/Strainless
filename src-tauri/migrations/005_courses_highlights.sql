-- Courses become real objects. `name` is the short code used on items ("EEE 402");
-- items keep referring to their course by that text, so nothing about items changes.
CREATE TABLE courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL DEFAULT '',          -- "Signals and Systems"
  color       TEXT    NOT NULL DEFAULT '#7c9cd6',
  instructor  TEXT    NOT NULL DEFAULT '',
  term_start  TEXT,                                  -- 'YYYY-MM-DD': first day classes meet
  term_end    TEXT,                                  -- 'YYYY-MM-DD': last day classes meet
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The weekly timetable: when and where the course meets. Times are local wall
-- clock ('09:30'), because a 09:30 lecture is 09:30 whatever the timezone.
CREATE TABLE course_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Monday … 6 = Sunday
  start_time  TEXT    NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time    TEXT    NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  kind        TEXT    NOT NULL DEFAULT 'lecture' CHECK (kind IN ('lecture', 'lab', 'ps', 'tutorial', 'other')),
  location    TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_course_sessions ON course_sessions(course_id);

-- Every course already typed on an item becomes a course, with a soft colour.
INSERT INTO courses (name)
  SELECT DISTINCT trim(course) FROM items WHERE course IS NOT NULL AND trim(course) <> '' ORDER BY 1;
UPDATE courses SET sort_order = id, color = CASE id % 8
  WHEN 0 THEN '#7c9cd6' WHEN 1 THEN '#6fae8f' WHEN 2 THEN '#d99a83' WHEN 3 THEN '#9d8fd6'
  WHEN 4 THEN '#5fb0a5' WHEN 5 THEN '#d8ad6e' WHEN 6 THEN '#c290b3' ELSE '#74b3cc' END;
UPDATE items SET course = trim(course) WHERE course IS NOT NULL;

-- The syllabus as a checklist.
CREATE TABLE course_topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  notes_md    TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'studying', 'done')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_course_topics ON course_topics(course_id, sort_order);

-- The course library. Files live in courses/<course id>/. `hidden` marks images
-- pasted into notes: stored like any file, but not listed in the library.
CREATE TABLE course_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id       INTEGER REFERENCES course_topics(id) ON DELETE SET NULL,
  original_name  TEXT    NOT NULL,
  stored_name    TEXT    NOT NULL,
  mime           TEXT,
  size           INTEGER NOT NULL DEFAULT 0,
  hidden         INTEGER NOT NULL DEFAULT 0,
  added_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_course_files ON course_files(course_id, topic_id);

-- Free-form markdown pages per course (code blocks, pasted images…).
CREATE TABLE course_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL DEFAULT '',
  body_md     TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_course_notes ON course_notes(course_id, sort_order);

-- Highlights and starred quotes inside documents. `file_ref` points at either an
-- item attachment ('attachment:<id>') or a course file ('course_file:<id>').
-- The quote is anchored by its text plus a little context, which survives
-- re-rendering at any zoom level: `location` is the page/slide/sheet (0-based),
-- `position` the character offset where it was found, used as a tie-breaker.
CREATE TABLE annotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_ref    TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'green', 'pink', 'blue')),
  starred     INTEGER NOT NULL DEFAULT 0,
  quote       TEXT    NOT NULL,
  prefix      TEXT    NOT NULL DEFAULT '',
  suffix      TEXT    NOT NULL DEFAULT '',
  location    INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_annotations_file ON annotations(file_ref, location);
CREATE INDEX idx_annotations_starred ON annotations(starred) WHERE starred = 1;
