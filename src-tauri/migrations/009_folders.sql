-- Folders for files. A folder belongs to one place: a course library (course_id),
-- a task's attachments (item_id), or the Documents page (both NULL). parent_id
-- nests folders; NULL = top level. Deleting a course or task removes its folders.
CREATE TABLE folders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES items(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (course_id IS NULL OR item_id IS NULL)
);
CREATE INDEX idx_folders_course ON folders(course_id);
CREATE INDEX idx_folders_item ON folders(item_id);
CREATE INDEX idx_folders_parent ON folders(parent_id);

-- NULL = top level of the library / attachments.
ALTER TABLE course_files ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE attachments ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;

-- Files not tied to a course or task: CV, transcripts, application papers…
-- Stored in documents/0/; which folder they show in is only this row's folder_id,
-- so moving between folders never touches the disk.
CREATE TABLE documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id      INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  original_name  TEXT    NOT NULL,
  stored_name    TEXT    NOT NULL,
  mime           TEXT,
  size           INTEGER NOT NULL DEFAULT 0,
  added_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_documents_folder ON documents(folder_id);
