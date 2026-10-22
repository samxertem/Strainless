-- Pen drawings on PDF pages and slides. file_ref is 'course_file:<id>' or
-- 'attachment:<id>' (as in annotations); location is the 0-based page or slide.
-- Points are stored in units of the page width ([x0, y0, x1, y1, …], x in 0..1,
-- y in 0..height/width), so drawings stay in place at any zoom.
CREATE TABLE ink_strokes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_ref    TEXT    NOT NULL,
  location    INTEGER NOT NULL,
  tool        TEXT    NOT NULL CHECK (tool IN ('pen', 'highlighter')),
  color       TEXT    NOT NULL,
  width       REAL    NOT NULL,
  points      TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_ink_strokes_file ON ink_strokes(file_ref, location);
