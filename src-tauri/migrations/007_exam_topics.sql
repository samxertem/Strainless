-- Which topics an exam covers, when chosen by hand on the Exam prep page.
-- An exam with no rows here uses the suggested topics (see src/lib/exams.ts).
CREATE TABLE exam_topics (
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  topic_id  INTEGER NOT NULL REFERENCES course_topics(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, topic_id)
);
