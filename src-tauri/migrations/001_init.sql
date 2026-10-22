CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  color       TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- due_at: 'YYYY-MM-DD' when all_day = 1 (a calendar date, no timezone),
--         ISO-8601 UTC instant ('2026-10-24T20:59:00.000Z') when all_day = 0.
CREATE TABLE items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  course        TEXT,
  due_at        TEXT,
  all_day       INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo', 'in_progress', 'waiting', 'done')),
  priority      INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  notes_md      TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at  TEXT
);

CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_items_due      ON items(due_at);

CREATE TABLE attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  original_name  TEXT    NOT NULL,
  stored_name    TEXT    NOT NULL,
  mime           TEXT,
  size           INTEGER NOT NULL DEFAULT 0,
  added_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_attachments_item ON attachments(item_id);

INSERT INTO categories (name, color, sort_order) VALUES
  ('Assignments',       '#5b8def', 1),
  ('Quizzes',           '#8b7cf6', 2),
  ('Midterms',          '#e07a5f', 3),
  ('Finals',            '#d1495b', 4),
  ('Projects',          '#3d9970', 5),
  ('Graduation & ÇAP',  '#c08a2e', 6),
  ('Masters',           '#6d5acf', 7),
  ('Scholarships',      '#2a9d8f', 8),
  ('Applications',      '#e9a03b', 9),
  ('Language Exams',    '#4aa3c7', 10),
  ('Documents',         '#7a8793', 11),
  ('Meetings',          '#c06c9e', 12),
  ('Career',            '#457b9d', 13),
  ('Personal',          '#e76f51', 14),
  ('Internship',        '#52a675', 15),
  ('Research',          '#9c6644', 16);
