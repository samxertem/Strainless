// Exam prep: which tasks are exams, which topics each one covers, and how to
// spread the topics still to study over the days that are left.

import type { Category, CourseTopic, Item } from './types';
import { db } from './db';
import { dayDiff, effectiveDue } from './dates';

export type ExamKind = 'final' | 'midterm' | 'quiz' | 'exam';

const CATEGORY_KIND: [ExamKind, RegExp][] = [
  ['final', /final/i],
  ['midterm', /midterm|mid-term|vize|ara sınav/i],
  ['quiz', /quiz/i],
  ['exam', /exam|sınav/i],
];

// Titles are looser than category names: "Final project" is not an exam.
const TITLE_KIND: [ExamKind, RegExp][] = [
  ['midterm', /midterm|mid-term|\bvize\b|ara sınav/i],
  ['final', /\bfinal\b(?!\s+(project|report|presentation|paper|submission|design))/i],
  ['quiz', /\bquiz/i],
  ['exam', /\bexam\b|sınav/i],
];

/** What kind of exam a task is, from its category ("Midterms", "Quizzes"…) or title; null for other tasks. */
export function examKind(item: Pick<Item, 'title'>, category?: Category): ExamKind | null {
  for (const [kind, re] of CATEGORY_KIND) if (category && re.test(category.name)) return kind;
  for (const [kind, re] of TITLE_KIND) if (re.test(item.title)) return kind;
  return null;
}

export interface Exam {
  item: Item;
  kind: ExamKind;
  due: Date;
}

/** Open exams that haven't happened yet, soonest first. */
export function upcomingExams(items: Item[], categoriesById: Map<number, Category>, now: Date): Exam[] {
  const exams: Exam[] = [];
  for (const item of items) {
    const due = effectiveDue(item);
    const kind = examKind(item, categoriesById.get(item.category_id));
    if (item.status !== 'done' && due && due >= now && kind) exams.push({ item, kind, due });
  }
  return exams.sort((a, b) => a.due.getTime() - b.due.getTime());
}

/** 3 for "Week 3 · Torsion", null for topics not named after a week. */
export const weekOf = (title: string): number | null => Number(/^week\s+(\d+)/i.exec(title)?.[1]) || null;

/**
 * The topics an exam probably covers, when none were chosen by hand.
 * Finals: everything. Midterms: up to the midterm week; exam weeks aren't topics, so
 * that's the first gap in the week numbers (else the first half). Quizzes and other
 * exams: what's been taught so far, up to the last topic that has files.
 */
export function suggestedScope(kind: ExamKind, topics: CourseTopic[], topicsWithFiles: Set<number>): CourseTopic[] {
  if (kind === 'final' || topics.length === 0) return topics;
  const firstHalf = topics.slice(0, Math.ceil(topics.length / 2));
  if (kind === 'midterm') {
    const weeks = topics.map((t) => weekOf(t.title));
    if (weeks.every((w) => w !== null)) {
      const gap = weeks.findIndex((w, i) => i > 0 && w !== weeks[i - 1]! + 1);
      if (gap > 0) return topics.slice(0, gap);
    }
    return firstHalf;
  }
  const lastWithFiles = topics.reduce((at, t, i) => (topicsWithFiles.has(t.id) ? i : at), -1);
  return lastWithFiles >= 0 ? topics.slice(0, lastWithFiles + 1) : firstHalf;
}

export interface StudyPlan {
  /** Calendar days until the exam: 0 = today, 1 = tomorrow. */
  daysLeft: number;
  /** Topics not done yet: the ones in progress first, then in syllabus order. */
  remaining: CourseTopic[];
  /** Topics to cover per day to finish a day early. */
  perDay: number;
}

/** Spreads the remaining topics evenly, leaving the day before the exam free for review. */
export function studyPlan(scope: CourseTopic[], due: Date, now: Date): StudyPlan {
  const daysLeft = dayDiff(now, due);
  const remaining = [...scope.filter((t) => t.status === 'studying'), ...scope.filter((t) => t.status === 'todo')];
  const studyDays = Math.max(1, daysLeft - 1);
  const perDay = Math.ceil(remaining.length / studyDays);
  return { daysLeft, remaining, perDay };
}

// ---------- topics chosen by hand ----------

/** Exam id → chosen topic ids, for exams whose topics were picked by hand. */
export async function listExamTopics(): Promise<Map<number, number[]>> {
  const rows = await (await db()).select<{ item_id: number; topic_id: number }[]>('SELECT item_id, topic_id FROM exam_topics');
  const map = new Map<number, number[]>();
  for (const r of rows) map.set(r.item_id, [...(map.get(r.item_id) ?? []), r.topic_id]);
  return map;
}

/** Saves the topics an exam covers; null goes back to the suggestion. */
export async function setExamTopics(itemId: number, topicIds: number[] | null): Promise<void> {
  const d = await db();
  await d.execute('DELETE FROM exam_topics WHERE item_id = $1', [itemId]);
  for (const topicId of topicIds ?? []) {
    await d.execute('INSERT INTO exam_topics (item_id, topic_id) VALUES ($1, $2)', [itemId, topicId]);
  }
}
