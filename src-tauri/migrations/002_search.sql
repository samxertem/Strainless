-- Full-text index over items, kept in sync by triggers. External-content table:
-- the text lives only in `items`; the index stores tokens plus rowids.
-- remove_diacritics 2 folds ç→c, ş→s, ö→o, ü→u, ğ→g, so "cap" finds "ÇAP".
CREATE VIRTUAL TABLE items_fts USING fts5(
  title, course, notes_md,
  content = 'items',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO items_fts(items_fts) VALUES ('rebuild');

CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, course, notes_md)
  VALUES (new.id, new.title, new.course, new.notes_md);
END;

CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, course, notes_md)
  VALUES ('delete', old.id, old.title, old.course, old.notes_md);
END;

CREATE TRIGGER items_fts_update AFTER UPDATE OF title, course, notes_md ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, course, notes_md)
  VALUES ('delete', old.id, old.title, old.course, old.notes_md);
  INSERT INTO items_fts(rowid, title, course, notes_md)
  VALUES (new.id, new.title, new.course, new.notes_md);
END;
