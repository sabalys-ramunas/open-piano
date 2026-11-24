/**
 * Which notes the app itself is making right now, and a feed of the notes it
 * plays on its own (lesson parts). The microphone uses this to ignore the
 * app's own sound coming back out of the speakers, and MIDI output uses the
 * feed to send lesson notes to the player's piano.
 */

export interface AppNote {
  midi: number;
  /** Length in real seconds. */
  seconds: number;
  velocity: number;
}

const held = new Map<number, number>(); // midi -> number of voices held by noteOn
const until = new Map<number, number>(); // midi -> performance.now() ms when its sound has faded
const listeners = new Set<(note: AppNote) => void>();

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A key went down on the instrument (played by the person, or by the app). */
export function markHeld(midi: number): void {
  held.set(midi, (held.get(midi) ?? 0) + 1);
}

/** The key came up; its sound still rings for `tailMs`. */
export function markReleased(midi: number, tailMs = 400, at = now()): void {
  const count = (held.get(midi) ?? 0) - 1;
  if (count > 0) held.set(midi, count);
  else held.delete(midi);
  until.set(midi, Math.max(until.get(midi) ?? 0, at + tailMs));
}

/** The app plays a note of known length by itself (a lesson part, a demo). */
export function announcePlay(note: AppNote, at = now()): void {
  until.set(note.midi, Math.max(until.get(note.midi) ?? 0, at + note.seconds * 1000 + 400));
  for (const l of listeners) {
    try {
      l(note);
    } catch (error) {
      console.warn('A listener for app notes failed.', error);
    }
  }
}

/** True while the app's own sound for this note is probably still audible. */
export function isSounding(midi: number, at = now()): boolean {
  return (held.get(midi) ?? 0) > 0 || (until.get(midi) ?? 0) > at;
}

/** Notes the app is making right now. */
export function soundingNotes(at = now()): number[] {
  const out = new Set<number>(held.keys());
  for (const [midi, end] of until) if (end > at) out.add(midi);
  return [...out].sort((a, b) => a - b);
}

/** Calls `listener` for every note the app plays by itself. Returns an unsubscribe function. */
export function onAppNote(listener: (note: AppNote) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets everything. For tests. */
export function resetSounding(): void {
  held.clear();
  until.clear();
}
