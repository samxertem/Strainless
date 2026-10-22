import type { Category, Course, CourseSession, Item } from './types';
import { SESSION_KIND_LABELS } from './types';
import { addDays, effectiveDue, startOfDay, toDateInput } from './dates';

const pad = (n: number) => String(n).padStart(2, '0');
const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateStamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newlines must be escaped in TEXT values. */
const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const encoder = new TextEncoder();

/** RFC 5545 §3.1: lines over 75 octets are folded (CRLF + space). Counts UTF-8 bytes, so "ÇAP" folds correctly. */
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines spend one byte on the leading space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * All open, dated items as an iCalendar file. UIDs are stable per item, so
 * re-importing into the same calendar updates events instead of duplicating them.
 * Timed deadlines become 30-minute blocks ending at the deadline; all-day items
 * become all-day events.
 */
export function buildIcs(
  items: Item[],
  categoriesById: Map<number, Category>,
  now = new Date(),
  timetable: { courses: Course[]; sessions: CourseSession[] } = { courses: [], sessions: [] },
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Strainless//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Strainless deadlines',
  ];

  for (const item of items) {
    if (item.status === 'done' || !item.due_at) continue;
    const category = categoriesById.get(item.category_id)?.name;
    const description = [category, item.course, item.notes_md.trim()].filter(Boolean).join('\n');

    lines.push('BEGIN:VEVENT', `UID:strainless-item-${item.id}@strainless.app`, `DTSTAMP:${utcStamp(now)}`);
    if (item.all_day) {
      const [y, m, d] = item.due_at.split('-').map(Number);
      const day = new Date(y, m - 1, d);
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(day)}`, `DTEND;VALUE=DATE:${dateStamp(addDays(day, 1))}`);
    } else {
      const due = effectiveDue(item)!;
      lines.push(`DTSTART:${utcStamp(new Date(due.getTime() - 30 * 60_000))}`, `DTEND:${utcStamp(due)}`);
    }
    lines.push(`SUMMARY:${escapeText(item.title)}`, 'TRANSP:TRANSPARENT');
    if (description) lines.push(`DESCRIPTION:${escapeText(description.slice(0, 2000))}`);
    if (category) lines.push(`CATEGORIES:${escapeText(category)}`);
    lines.push('END:VEVENT');
  }

  // Weekly classes as repeating events. "Floating" local times (no Z): a 09:30 lecture
  // stays at 09:30 on whatever device imports it.
  const coursesById = new Map(timetable.courses.map((c) => [c.id, c]));
  const local = (day: string, hhmm: string) => `${day.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
  for (const s of timetable.sessions) {
    const course = coursesById.get(s.course_id);
    if (!course) continue;
    // First meeting: on or after the term start (or today), on the session's weekday (0 = Monday).
    let first = startOfDay(course.term_start ? new Date(`${course.term_start}T00:00`) : now);
    while ((first.getDay() + 6) % 7 !== s.weekday) first = addDays(first, 1);
    const firstKey = toDateInput(first);
    if (course.term_end && firstKey > course.term_end) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:strainless-session-${s.id}@strainless.app`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${local(firstKey, s.start_time)}`,
      `DTEND:${local(firstKey, s.end_time)}`,
      course.term_end ? `RRULE:FREQ=WEEKLY;UNTIL=${course.term_end.replace(/-/g, '')}T235959` : 'RRULE:FREQ=WEEKLY;COUNT=16',
      `SUMMARY:${escapeText(`${course.name} ${SESSION_KIND_LABELS[s.kind]}`)}`,
    );
    if (s.location) lines.push(`LOCATION:${escapeText(s.location)}`);
    if (course.title) lines.push(`DESCRIPTION:${escapeText(course.title)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
