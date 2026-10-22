export type Status = 'todo' | 'in_progress' | 'waiting' | 'done';
export type Priority = 1 | 2 | 3;

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  waiting: 'Waiting',
  done: 'Done',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: 'Low',
  2: 'Normal',
  3: 'High',
};

/** Swatches offered when picking a category colour. */
export const CATEGORY_COLORS = [
  '#7c9cd6', '#9d8fd6', '#8e86c9', '#c290b3', '#c98a96', '#d99a83',
  '#d69a85', '#d8ad6e', '#c9a86a', '#b08f74', '#7fb894', '#6fae8f',
  '#5fb0a5', '#74b3cc', '#6f97b5', '#9aa3ad',
];

export type JournalFont = 'hand' | 'serif' | 'sans';

export interface JournalDay {
  day: string;
  mood_photo: string | null;
  font: JournalFont;
}

export interface JournalBlock {
  id: number;
  day: string;
  title: string;
  body: string;
  sort_order: number;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface Item {
  id: number;
  title: string;
  category_id: number;
  course: string | null;
  /** 'YYYY-MM-DD' when all_day, otherwise an ISO-8601 UTC instant. */
  due_at: string | null;
  all_day: boolean;
  status: Status;
  priority: Priority;
  notes_md: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  attachment_count: number;
}

export type ItemPatch = Partial<
  Pick<Item, 'title' | 'category_id' | 'course' | 'due_at' | 'all_day' | 'status' | 'priority' | 'notes_md'>
>;

export interface NewItem {
  title: string;
  category_id: number;
  course?: string | null;
  due_at?: string | null;
  all_day?: boolean;
}

export interface Settings {
  remindersEnabled: boolean;
  /** Timed items: 24 h before. All-day items: 09:00 the day before. */
  remindDayBefore: boolean;
  /** Timed items: 1 h before. All-day items: 09:00 on the day. */
  remindSameDay: boolean;
  lastBackupAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  remindersEnabled: true,
  remindDayBefore: true,
  remindSameDay: true,
  lastBackupAt: null,
};

/** Search fields contain MARK_START/MARK_END around matched words. */
export interface SearchHit {
  id: number;
  title: string | null;
  course: string | null;
  notes: string | null;
  /** Name of an attachment whose file name matched. */
  attachment?: string;
}

/** A journal page whose writing matched a search. */
export interface JournalHit {
  day: string;
  snippet: string;
}

export const MARK_START = '\u0002';
export const MARK_END = '\u0003';

export interface BackupManifest {
  app: string;
  format: number;
  schema_version: number;
  created_at: string;
  item_count: number;
  attachment_count: number;
}

export interface Course {
  id: number;
  name: string;
  title: string;
  color: string;
  instructor: string;
  term_start: string | null;
  term_end: string | null;
  sort_order: number;
  file_count: number;
  topic_count: number;
  topics_done: number;
}

export type SessionKind = 'lecture' | 'lab' | 'ps' | 'tutorial' | 'other';

export const SESSION_KIND_LABELS: Record<SessionKind, string> = {
  lecture: 'Lecture',
  lab: 'Lab',
  ps: 'PS',
  tutorial: 'Tutorial',
  other: 'Other',
};

/** A weekly class meeting. weekday: 0 = Monday … 6 = Sunday; times are local 'HH:MM'. */
export interface CourseSession {
  id: number;
  course_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  kind: SessionKind;
  location: string;
}

/** One concrete class on a concrete day, expanded from a weekly session. */
export interface ClassOccurrence {
  session: CourseSession;
  course: Course;
  day: string; // 'YYYY-MM-DD'
  start: Date;
  end: Date;
}

export type TopicStatus = 'todo' | 'studying' | 'done';

export interface CourseTopic {
  id: number;
  course_id: number;
  title: string;
  notes_md: string;
  status: TopicStatus;
  sort_order: number;
}

export interface CourseFile {
  id: number;
  course_id: number;
  topic_id: number | null;
  original_name: string;
  stored_name: string;
  mime: string | null;
  size: number;
  hidden: number;
  added_at: string;
}

export interface CourseNote {
  id: number;
  course_id: number;
  title: string;
  body_md: string;
  sort_order: number;
  updated_at: string;
}

/** A file attached to one of the course's tasks, shown read-only in the library. */
export interface CourseTaskFile extends Attachment {
  item_title: string;
}

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue';
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'pink', 'blue'];

export interface Annotation {
  id: number;
  file_ref: string;
  color: HighlightColor;
  starred: number;
  quote: string;
  prefix: string;
  suffix: string;
  location: number;
  position: number;
  note: string;
  created_at: string;
}

/** A starred quote plus enough about its file to open it again. */
export interface StarredQuote extends Annotation {
  file_name: string;
  file_kind: 'attachment' | 'course_file';
  owner_id: number;
  stored_name: string;
  mime: string | null;
  course_id: number | null;
  course_name: string | null;
  item_title: string | null;
}

export interface CourseHit {
  kind: 'file' | 'topic' | 'note' | 'quote';
  course_id: number;
  course_name: string;
  label: string;
  target_id: number;
}

export interface Attachment {
  id: number;
  item_id: number;
  original_name: string;
  stored_name: string;
  mime: string | null;
  size: number;
  added_at: string;
}
