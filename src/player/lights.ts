import type { Note } from '../song';
import { firstAtOrAfter, HIT_WINDOW, type Mode, type NoteState } from './game';

/** How far ahead (real seconds) Play along lights a key before its note arrives. */
export const LIGHT_LEAD = 0.6;

export interface LightFrame {
  notes: readonly Note[];
  states: readonly NoteState[];
  /** Song time in seconds. */
  time: number;
  mode: Mode;
  speed: number;
  /** True while the song is moving (not paused, not previewing). */
  running: boolean;
  /** Learn mode: indexes of the notes the song is waiting for (Game.nextGroup()). */
  next: readonly number[];
}

/**
 * Which keys should be lit on a light-up keyboard right now: the next keys
 * the learner has to press. Only their own notes (state 'pending'), only in
 * Learn and Play along, and nothing while paused.
 */
export function keysToLight(f: LightFrame): Set<number> {
  const out = new Set<number>();
  if (!f.running || f.mode === 'listen') return out;
  if (f.mode === 'wait') {
    for (const i of f.next) if (f.states[i] === 'pending') out.add(f.notes[i].midi);
    return out;
  }
  const until = f.time + LIGHT_LEAD * f.speed;
  for (let i = firstAtOrAfter(f.notes, f.time - HIT_WINDOW - 1); i < f.notes.length; i++) {
    const n = f.notes[i];
    if (n.start > until) break;
    if (f.states[i] === 'pending') out.add(n.midi);
  }
  return out;
}

/** Keeps a set of lit keys in step with what should be lit, sending only the changes. */
export class KeyLights {
  private lit = new Set<number>();

  constructor(private light: (midi: number, on: boolean) => void) {}

  /** Lights exactly `want`, turning off everything else that was lit. */
  show(want: ReadonlySet<number>): void {
    for (const midi of [...this.lit]) {
      if (!want.has(midi)) {
        this.lit.delete(midi);
        this.light(midi, false);
      }
    }
    for (const midi of want) {
      if (!this.lit.has(midi)) {
        this.lit.add(midi);
        this.light(midi, true);
      }
    }
  }

  /** Turns every lit key off. */
  clear(): void {
    this.show(new Set());
  }

  get size(): number {
    return this.lit.size;
  }
}
