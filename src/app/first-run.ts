import type { Store } from './store';

/** Store key for the first-run welcome. */
export const WELCOME_KEY = 'app:welcome';
/** Store key remembering that the browser granted MIDI access, for browsers that cannot report it. */
export const MIDI_ALLOWED_KEY = 'input:midi-allowed';

/** How the person said they will play, chosen on the welcome screen. */
export type PlayWith = 'midi' | 'keys' | 'mic';

export interface WelcomeState {
  /** The welcome was finished or skipped. */
  done: boolean;
  playWith?: PlayWith;
}

/** Reads the stored welcome state. Stored values are untrusted. */
export function readWelcome(value: unknown): WelcomeState {
  if (typeof value !== 'object' || value === null) return { done: false };
  const v = value as Record<string, unknown>;
  const playWith = v.playWith === 'midi' || v.playWith === 'keys' || v.playWith === 'mic' ? v.playWith : undefined;
  return { done: v.done === true, ...(playWith ? { playWith } : {}) };
}

/**
 * True when the welcome should be shown: it was never finished, and the
 * person has not used the app before (people who already played songs or
 * lessons in an older version are not sent through it).
 */
export async function shouldWelcome(store: Pick<Store, 'getValue' | 'allProgress' | 'allLessonProgress' | 'getSongs'>): Promise<boolean> {
  try {
    if (readWelcome(await store.getValue(WELCOME_KEY)).done) return false;
    const [songs, lessons, mine] = await Promise.all([store.allProgress(), store.allLessonProgress(), store.getSongs()]);
    return songs.length === 0 && lessons.length === 0 && mine.length === 0;
  } catch {
    return false; // storage trouble: never trap anyone in the welcome
  }
}

/** Marks the welcome as finished. */
export async function finishWelcome(store: Pick<Store, 'setValue'>, playWith?: PlayWith): Promise<void> {
  const state: WelcomeState = { done: true, ...(playWith ? { playWith } : {}) };
  await store.setValue(WELCOME_KEY, state).catch(() => {});
}

/** The parts of `navigator` used to ask about MIDI permission, so tests can pass a fake. */
export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

/**
 * Whether MIDI access was already granted, so the app may connect without the
 * browser showing a question. Uses the Permissions API where it knows about
 * MIDI, and otherwise what we remembered from an earlier visit.
 */
export async function midiAlreadyAllowed(
  store: Pick<Store, 'getValue'>,
  permissions: PermissionsLike | undefined = typeof navigator !== 'undefined' ? (navigator.permissions as unknown as PermissionsLike | undefined) : undefined,
): Promise<boolean> {
  if (permissions) {
    try {
      const status = await permissions.query({ name: 'midi' });
      return status.state === 'granted';
    } catch {
      // this browser does not report MIDI permission: fall back to what we remember
    }
  }
  try {
    return (await store.getValue(MIDI_ALLOWED_KEY)) === true;
  } catch {
    return false;
  }
}
