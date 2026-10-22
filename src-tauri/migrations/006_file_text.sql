-- The text of PDF pages and PowerPoint slides, so search finds words inside lecture
-- files. One row per page/slide. file_ref is 'course_file:<id>' or 'attachment:<id>'
-- (as in annotations); location is the 0-based page or slide.
CREATE VIRTUAL TABLE file_text USING fts5(
  file_ref UNINDEXED,
  location UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Files already read, so each is read once. pages = -1 when the file couldn't be read.
CREATE TABLE file_text_status (
  file_ref    TEXT    PRIMARY KEY,
  pages       INTEGER NOT NULL,
  indexed_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
