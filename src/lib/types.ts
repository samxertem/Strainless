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
  '#5b8def', '#8b7cf6', '#6d5acf', '#c06c9e', '#d1495b', '#e07a5f',
  '#e76f51', '#e9a03b', '#c08a2e', '#9c6644', '#52a675', '#3d9970',
  '#2a9d8f', '#4aa3c7', '#457b9d', '#7a8793',
];

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
  due_at?: string | null;
  all_day?: boolean;
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
