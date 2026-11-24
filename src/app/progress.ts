import type { LessonProgress, SongProgress, Stars, Store } from './store';

/** Daily practice streak, stored under the key-value key `streak`. */
export interface Streak {
  current: number;
  longest: number;
  /** Local date of the last practice, YYYY-MM-DD. Empty when never practised. */
  lastDay: string;
}

export const STREAK_KEY = 'streak';

export function starsFor(accuracy: number): Stars {
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.75) return 2;
  if (accuracy >= 0.5) return 1;
  return 0;
}

export function localDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}

function readStreak(value: unknown): Streak {
  const v = value as Partial<Streak> | null | undefined;
  return {
    current: typeof v?.current === 'number' && v.current >= 0 ? v.current : 0,
    longest: typeof v?.longest === 'number' && v.longest >= 0 ? v.longest : 0,
    lastDay: typeof v?.lastDay === 'string' && /^\d{4}-\d\d-\d\d$/.test(v.lastDay) ? v.lastDay : '',
  };
}

export async function getStreak(store: Store): Promise<Streak> {
  return readStreak(await store.getValue(STREAK_KEY));
}

/** Counts today as a practice day. Safe to call many times a day. */
export async function touchStreak(store: Store, now = new Date()): Promise<Streak> {
  const old = await getStreak(store);
  const today = localDay(now);
  if (old.lastDay === today) return old;
  const current = old.lastDay === dayBefore(today) ? old.current + 1 : 1;
  const next = { current, longest: Math.max(old.longest, current), lastDay: today };
  await store.setValue(STREAK_KEY, next);
  return next;
}

/** Records a finished play of a song and returns the updated record. */
export async function recordPlay(store: Store, songId: string, accuracy: number, now = new Date()): Promise<SongProgress> {
  const old = await store.getProgress(songId);
  const next: SongProgress = {
    songId,
    best: Math.max(old?.best ?? 0, accuracy),
    stars: Math.max(old?.stars ?? 0, starsFor(accuracy)) as Stars,
    plays: (old?.plays ?? 0) + 1,
    lastPlayed: now.getTime(),
  };
  await store.putProgress(next);
  await touchStreak(store, now);
  return next;
}

/** Records a course lesson attempt. Completion is sticky, stars only go up. */
export async function recordLesson(
  store: Store,
  lessonId: string,
  outcome: { completed: boolean; stars: Stars },
  now = new Date(),
): Promise<LessonProgress> {
  const old = await store.getLessonProgress(lessonId);
  const completed = Boolean(old?.completed) || outcome.completed;
  const next: LessonProgress = {
    lessonId,
    completed,
    stars: Math.max(old?.stars ?? 0, outcome.stars) as Stars,
    attempts: (old?.attempts ?? 0) + 1,
    ...(completed ? { completedAt: old?.completedAt ?? now.getTime() } : {}),
  };
  await store.putLessonProgress(next);
  await touchStreak(store, now);
  return next;
}
