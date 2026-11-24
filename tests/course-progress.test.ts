import { describe, expect, it } from 'vitest';
import { getStreak, recordLesson } from '../src/app/progress';
import { memoryStore } from '../src/app/store';
import { allLessons } from '../src/course/curriculum';
import {
  continueLesson,
  courseProgress,
  firstIncomplete,
  fromRecords,
  isUnlocked,
  LAST_LESSON_KEY,
  lessonAfter,
  loadProgress,
  readResume,
  readSkipped,
  saveLessonResult,
  SKIPPED_KEY,
} from '../src/course/progress';

const ids = allLessons().map((l) => l.id);
const done = (...list: string[]) => fromRecords(list.map((lessonId) => ({ lessonId, completed: true, stars: 2 as const, attempts: 1 })));

describe('course progression', () => {
  it('opens lessons in order', () => {
    const p = done(ids[0], ids[1]);
    expect(firstIncomplete(p)?.id).toBe(ids[2]);
    expect(isUnlocked(ids[2], p)).toBe(true);
    expect(isUnlocked(ids[3], p)).toBe(false);
    expect(isUnlocked(ids[0], p)).toBe(true);
    expect(isUnlocked('nope', p)).toBe(false);
  });

  it('keeps a lesson done after skipping ahead open, without opening the gap', () => {
    const p = done(ids[0], ids[10]);
    expect(isUnlocked(ids[10], p)).toBe(true);
    expect(isUnlocked(ids[5], p)).toBe(false);
    expect(firstIncomplete(p)?.id).toBe(ids[1]);
  });

  it('continues with the last lesson opened, or the next unfinished one after it', () => {
    expect(continueLesson(done())?.id).toBe(ids[0]);
    expect(continueLesson(fromRecords([], ids[4]))?.id).toBe(ids[4]);
    const p = fromRecords([{ lessonId: ids[4], completed: true, stars: 3, attempts: 1 }], ids[4]);
    expect(continueLesson(p)?.id).toBe(ids[5]);
    expect(continueLesson(done(...ids))).toBeUndefined();
    expect(lessonAfter(ids[0])?.id).toBe(ids[1]);
    expect(lessonAfter(ids[ids.length - 1])).toBeUndefined();
  });

  it('ignores unknown lessons and bad stored values', () => {
    const p = fromRecords([{ lessonId: 'gone', completed: true, stars: 3, attempts: 1 }], 42);
    expect(p.completed.size).toBe(0);
    expect(p.lastLessonId).toBeUndefined();
    expect(readResume({ lessonId: ids[0], step: 2 })).toEqual({ lessonId: ids[0], step: 2 });
    expect(readResume({ lessonId: ids[0], step: 0 })).toBeUndefined();
    expect(readResume({ lessonId: ids[0], step: 99 })).toBeUndefined();
    expect(readResume({ lessonId: 'gone', step: 1 })).toBeUndefined();
    expect(readResume('nonsense')).toBeUndefined();
  });

  it('reads what recordLesson saved', async () => {
    const store = memoryStore();
    await recordLesson(store, ids[0], { completed: true, stars: 3 });
    await store.setValue(LAST_LESSON_KEY, ids[1]);
    const p = await loadProgress(store);
    expect(p.completed.has(ids[0])).toBe(true);
    expect(p.lastLessonId).toBe(ids[1]);
    expect(courseProgress(p)).toEqual({ done: 1, total: ids.length, stars: 3 });
  });

  it('lets the learner move past a skipped lesson, which never counts as done', () => {
    const p = fromRecords([{ lessonId: ids[0], completed: true, stars: 3, attempts: 1 }], ids[2], undefined, [ids[1], 'gone', 42]);
    expect([...p.skipped]).toEqual([ids[1]]);
    expect(firstIncomplete(p)?.id).toBe(ids[2]);
    expect(isUnlocked(ids[1], p)).toBe(true);
    expect(isUnlocked(ids[2], p)).toBe(true);
    expect(isUnlocked(ids[3], p)).toBe(false);
    expect(continueLesson(p)?.id).toBe(ids[2]);
    expect(courseProgress(p)).toEqual({ done: 1, total: ids.length, stars: 3 });
    // Doing a lesson for real wins over an earlier skip.
    const both = fromRecords([{ lessonId: ids[1], completed: true, stars: 2, attempts: 2 }], undefined, undefined, [ids[1]]);
    expect(both.skipped.size).toBe(0);
    expect(readSkipped('nope')).toEqual([]);
    expect(readSkipped([ids[0], ids[0]])).toEqual([ids[0]]);
  });

  it('comes back to skipped lessons once everything else is done', () => {
    const p = fromRecords(
      ids.filter((id) => id !== ids[5]).map((lessonId) => ({ lessonId, completed: true, stars: 2 as const, attempts: 1 })),
      ids[ids.length - 1],
      undefined,
      [ids[5]],
    );
    expect(firstIncomplete(p)).toBeUndefined();
    expect(continueLesson(p)?.id).toBe(ids[5]);
  });

  it('saves a completed lesson with stars and the first-lesson-today moment', async () => {
    const store = memoryStore();
    const day = new Date(2026, 10, 23, 10);
    await store.setValue(SKIPPED_KEY, [ids[0]]);
    expect(await saveLessonResult(store, ids[0], { completed: true, skipped: false, stars: 2 }, day)).toEqual({ firstToday: true });
    expect(await saveLessonResult(store, ids[1], { completed: true, skipped: false, stars: 3 }, new Date(2026, 10, 23, 18))).toEqual({ firstToday: false });
    const p = await loadProgress(store);
    expect(p.completed.has(ids[0])).toBe(true);
    expect(p.skipped.size).toBe(0);
    expect((await getStreak(store)).current).toBe(1);
    expect(await saveLessonResult(store, ids[2], { completed: true, skipped: false, stars: 1 }, new Date(2026, 10, 24, 9))).toEqual({ firstToday: true });
    expect((await getStreak(store)).current).toBe(2);
  });

  it('saves a skipped lesson without stars or a streak day, and never over a real completion', async () => {
    const store = memoryStore();
    expect(await saveLessonResult(store, ids[0], { completed: false, skipped: true, stars: 0 })).toEqual({ firstToday: false });
    let p = await loadProgress(store);
    expect([...p.skipped]).toEqual([ids[0]]);
    expect(p.completed.size).toBe(0);
    expect(p.stars.size).toBe(0);
    expect((await getStreak(store)).current).toBe(0);

    await recordLesson(store, ids[1], { completed: true, stars: 3 });
    await saveLessonResult(store, ids[1], { completed: false, skipped: true, stars: 0 });
    p = await loadProgress(store);
    expect(p.completed.has(ids[1])).toBe(true);
    expect(p.skipped.has(ids[1])).toBe(false);
    expect(p.stars.get(ids[1])).toBe(3);
  });
});
