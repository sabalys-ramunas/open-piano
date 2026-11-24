import { localDay, recordLesson } from '../app/progress';
import type { LessonProgress, Stars, Store } from '../app/store';
import { allLessons, COURSE } from './curriculum';
import type { LessonResult } from './engine';
import type { Course, Lesson, Unit } from './types';

/** Course-private keys in the shared key-value store. */
export const LAST_LESSON_KEY = 'course:last-lesson';
export const RESUME_KEY = 'course:resume';
/** Lessons the learner moved past without really doing them (a list of ids). */
export const SKIPPED_KEY = 'course:skipped';
/** The local day (YYYY-MM-DD) the last lesson was finished, for the "first lesson today" moment. */
export const LESSON_DAY_KEY = 'course:lesson-day';

/** Where the learner stopped inside a lesson. */
export interface Resume {
  lessonId: string;
  step: number;
}

/** What the course screens need to know about saved progress. */
export interface CourseProgress {
  completed: ReadonlySet<string>;
  stars: ReadonlyMap<string, Stars>;
  /** Moved past without doing it: no stars, never counted as done, never blocks the way. */
  skipped: ReadonlySet<string>;
  lastLessonId?: string;
}

export function emptyProgress(): CourseProgress {
  return { completed: new Set(), stars: new Map(), skipped: new Set() };
}

/** The ids in a stored skipped list that are real lessons. Bad data reads as an empty list. */
export function readSkipped(value: unknown, course: Course = COURSE): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(allLessons(course).map((l) => l.id));
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && known.has(v)))];
}

/** Builds CourseProgress from stored records, ignoring lessons that no longer exist. */
export function fromRecords(records: readonly LessonProgress[], lastLessonId?: unknown, course: Course = COURSE, skippedValue?: unknown): CourseProgress {
  const known = new Set(allLessons(course).map((l) => l.id));
  const completed = new Set<string>();
  const stars = new Map<string, Stars>();
  for (const r of records) {
    if (!known.has(r.lessonId)) continue;
    if (r.completed) completed.add(r.lessonId);
    if (r.stars > 0) stars.set(r.lessonId, r.stars);
  }
  // Doing a lesson for real always wins over an earlier skip.
  const skipped = new Set(readSkipped(skippedValue, course).filter((id) => !completed.has(id)));
  const last = typeof lastLessonId === 'string' && known.has(lastLessonId) ? lastLessonId : undefined;
  return last ? { completed, stars, skipped, lastLessonId: last } : { completed, stars, skipped };
}

/** Reads course progress from the store. Never throws: bad or missing data reads as a fresh start. */
export async function loadProgress(store: Store, course: Course = COURSE): Promise<CourseProgress> {
  try {
    const [records, last, skipped] = await Promise.all([store.allLessonProgress(), store.getValue(LAST_LESSON_KEY), store.getValue(SKIPPED_KEY).catch(() => undefined)]);
    return fromRecords(records, last, course, skipped);
  } catch {
    return emptyProgress();
  }
}

export function readResume(value: unknown, course: Course = COURSE): Resume | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<Resume>;
  if (typeof v.lessonId !== 'string' || typeof v.step !== 'number' || !Number.isInteger(v.step)) return undefined;
  const lesson = allLessons(course).find((l) => l.id === v.lessonId);
  if (!lesson || v.step < 1 || v.step >= lesson.steps.length) return undefined;
  return { lessonId: v.lessonId, step: v.step };
}

/** Done for real, or moved past on purpose: either way the path goes on from here. */
function passedBy(progress: CourseProgress, id: string): boolean {
  return progress.completed.has(id) || progress.skipped.has(id);
}

/**
 * The next lesson on the path: the first one neither done nor skipped, in
 * course order. Undefined when every lesson is done or skipped.
 */
export function firstIncomplete(progress: CourseProgress, course: Course = COURSE): Lesson | undefined {
  return allLessons(course).find((l) => !passedBy(progress, l.id));
}

/**
 * A lesson is open when everything before it is done or skipped, or when it
 * was done or skipped before. Later lessons are still reachable on purpose
 * ("try it anyway").
 */
export function isUnlocked(lessonId: string, progress: CourseProgress, course: Course = COURSE): boolean {
  if (passedBy(progress, lessonId)) return true;
  const lessons = allLessons(course);
  const index = lessons.findIndex((l) => l.id === lessonId);
  if (index < 0) return false;
  const next = firstIncomplete(progress, course);
  const nextIndex = next ? lessons.indexOf(next) : lessons.length;
  return index <= nextIndex;
}

/** The lesson after this one, if any. */
export function lessonAfter(lessonId: string, course: Course = COURSE): Lesson | undefined {
  const lessons = allLessons(course);
  const i = lessons.findIndex((l) => l.id === lessonId);
  return i >= 0 ? lessons[i + 1] : undefined;
}

/**
 * The lesson for "Continue": the last one opened if it is not finished yet,
 * otherwise the next one after it that is neither done nor skipped, otherwise
 * the first such one anywhere, and last of all a lesson that was skipped.
 * Undefined only when every lesson is done.
 */
export function continueLesson(progress: CourseProgress, course: Course = COURSE): Lesson | undefined {
  const lessons = allLessons(course);
  const lastIndex = progress.lastLessonId ? lessons.findIndex((l) => l.id === progress.lastLessonId) : -1;
  if (lastIndex >= 0) {
    for (let i = lastIndex; i < lessons.length; i++) if (!passedBy(progress, lessons[i].id)) return lessons[i];
  }
  return firstIncomplete(progress, course) ?? lessons.find((l) => !progress.completed.has(l.id));
}

export function unitProgress(unit: Unit, progress: CourseProgress): { done: number; total: number } {
  return { done: unit.lessons.filter((l) => progress.completed.has(l.id)).length, total: unit.lessons.length };
}

export function courseProgress(progress: CourseProgress, course: Course = COURSE): { done: number; total: number; stars: number } {
  const lessons = allLessons(course);
  let stars = 0;
  for (const l of lessons) stars += progress.stars.get(l.id) ?? 0;
  return { done: lessons.filter((l) => progress.completed.has(l.id)).length, total: lessons.length, stars };
}

/**
 * Saves the end of a lesson. A completed lesson is recorded with its stars
 * (which also counts today for the streak) and leaves the skipped list. A
 * skipped one goes on the skipped list, unless it was done for real before:
 * no stars, no streak day. Returns whether this was the first lesson
 * finished today, for the streak moment.
 */
export async function saveLessonResult(store: Store, lessonId: string, result: LessonResult, now = new Date()): Promise<{ firstToday: boolean }> {
  const skippedList = readSkipped(await store.getValue(SKIPPED_KEY).catch(() => undefined));
  if (result.completed) {
    await recordLesson(store, lessonId, { completed: true, stars: result.stars }, now);
    if (skippedList.includes(lessonId)) await store.setValue(SKIPPED_KEY, skippedList.filter((id) => id !== lessonId));
    const today = localDay(now);
    const lastDay = await store.getValue(LESSON_DAY_KEY).catch(() => undefined);
    if (lastDay === today) return { firstToday: false };
    await store.setValue(LESSON_DAY_KEY, today);
    return { firstToday: true };
  }
  if (result.skipped) {
    const old = await store.getLessonProgress(lessonId);
    if (!old?.completed && !skippedList.includes(lessonId)) await store.setValue(SKIPPED_KEY, [...skippedList, lessonId]);
  }
  return { firstToday: false };
}
