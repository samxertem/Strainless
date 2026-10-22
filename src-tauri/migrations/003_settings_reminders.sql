-- App settings as JSON values, so they travel with backups.
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- One row per reminder already shown. due_at is part of the key, so moving an
-- item's deadline re-arms its reminders automatically.
CREATE TABLE reminders_sent (
  item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind     TEXT    NOT NULL,
  due_at   TEXT    NOT NULL,
  sent_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (item_id, kind, due_at)
);
