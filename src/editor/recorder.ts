import type { Hand } from '../song';
import { MIN_DUR, PIANO_HI, PIANO_LO, makeNote, type EdNote } from './model';

/** Which hand recorded notes go to. 'auto' splits at a key: below it is the left hand. */
export type RecordHand = 'auto' | Hand;

/**
 * Turns keys pressed while recording into notes. Times are song seconds,
 * already corrected for the player's latency by the caller.
 */
export class Recorder {
  private open = new Map<number, number>();
  private done: EdNote[] = [];

  constructor(
    private hand: RecordHand = 'auto',
    private split = 60,
  ) {}

  private handFor(midi: number): Hand {
    if (this.hand !== 'auto') return this.hand;
    return midi < this.split ? 'left' : 'right';
  }

  down(midi: number, time: number): void {
    if (midi < PIANO_LO || midi > PIANO_HI) return;
    if (this.open.has(midi)) this.up(midi, time);
    this.open.set(midi, Math.max(0, time));
  }

  up(midi: number, time: number): void {
    const start = this.open.get(midi);
    if (start === undefined) return;
    this.open.delete(midi);
    this.done.push(makeNote(midi, start, Math.max(MIN_DUR, time - start), this.handFor(midi)));
  }

  /** Keys still held. */
  get holding(): number {
    return this.open.size;
  }

  /** Notes finished so far (keys still held are not included). */
  get notes(): readonly EdNote[] {
    return this.done;
  }

  /** Lets go of every held key at `time` and returns all recorded notes. */
  finish(time: number): EdNote[] {
    for (const midi of [...this.open.keys()]) this.up(midi, time);
    const out = this.done;
    this.done = [];
    return out;
  }
}
