-- One page per calendar day: a mood photo plus any number of free-write spaces.
CREATE TABLE journal_days (
  day         TEXT PRIMARY KEY,                 -- 'YYYY-MM-DD', local date
  mood_photo  TEXT,                             -- stored file name under journal/<day>/
  font        TEXT NOT NULL DEFAULT 'hand' CHECK (font IN ('hand', 'serif', 'sans')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE journal_blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT    NOT NULL,
  title       TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_journal_blocks_day ON journal_blocks(day, sort_order);

-- Softer category colours. Only categories still on their original seed colour
-- change, so anything recoloured by hand is left alone.
UPDATE categories SET color = '#7c9cd6' WHERE color = '#5b8def';
UPDATE categories SET color = '#9d8fd6' WHERE color = '#8b7cf6';
UPDATE categories SET color = '#d99a83' WHERE color = '#e07a5f';
UPDATE categories SET color = '#c98a96' WHERE color = '#d1495b';
UPDATE categories SET color = '#6fae8f' WHERE color = '#3d9970';
UPDATE categories SET color = '#c9a86a' WHERE color = '#c08a2e';
UPDATE categories SET color = '#8e86c9' WHERE color = '#6d5acf';
UPDATE categories SET color = '#5fb0a5' WHERE color = '#2a9d8f';
UPDATE categories SET color = '#d8ad6e' WHERE color = '#e9a03b';
UPDATE categories SET color = '#74b3cc' WHERE color = '#4aa3c7';
UPDATE categories SET color = '#9aa3ad' WHERE color = '#7a8793';
UPDATE categories SET color = '#c290b3' WHERE color = '#c06c9e';
UPDATE categories SET color = '#6f97b5' WHERE color = '#457b9d';
UPDATE categories SET color = '#d69a85' WHERE color = '#e76f51';
UPDATE categories SET color = '#7fb894' WHERE color = '#52a675';
UPDATE categories SET color = '#b08f74' WHERE color = '#9c6644';
