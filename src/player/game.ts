import type { Hand, Note, Song } from '../song';
import { songLength } from '../song';

export type Mode = 'listen' | 'wait' | 'flow';
export type Hands = 'right' | 'left' | 'both';
export type NoteState = 'pending' | 'hit' | 'miss' | 'auto';

export interface Options {
  mode: Mode;
  hands: Hands;
  speed: number;
}

/** A stretch of song time in seconds, start inclusive, end exclusive. Used for loops and passages. */
export interface Loop {
  start: number;
  end: number;
}

/** A right note: which one, and how far off the beat it was (seconds of song time, negative is early). */
export interface Strike {
  index: number;
  error: number;
}

export interface Result {
  hit: number;
  missed: number;
  wrong: number;
  accuracy: number; // 0..1
}

export const HIT_WINDOW = 0.3; // seconds either side of a note, in play-along mode
export const EARLY = 0.35; // how early a note may be pressed in wait mode
const CHORD_WINDOW = 0.06;
/** What a wrong key costs in accuracy. Learn mode is gentler: finding the key by trying is how beginners learn. */
const WRONG_COST = { listen: 0, wait: 0.15, flow: 0.25 } as const;

/** Index of the first note that starts at or after `t`. Notes must be sorted by start. */
export function firstAtOrAfter(notes: readonly Note[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].start < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Tracks where we are in a song and judges what the player presses. No audio, no drawing. */
export class Game {
  readonly notes: Note[];
  readonly state: NoteState[];
  readonly length: number;
  time = -1.5; // a short lead-in before the first note
  wrong = 0;
  /** Set for a moment when a wrong key is pressed, for the renderer to flash. */
  lastWrong: { midi: number; at: number } | null = null;
  private sounded: boolean[];
  private newMisses: number[] = [];
  /** Every note before this index is settled: hit, missed, or sounded for you. Saves rescanning long songs. */
  private cursor = 0;

  constructor(
    song: Song,
    readonly opts: Options,
  ) {
    this.notes = song.notes;
    this.length = songLength(song);
    this.state = this.notes.map((n) => (this.isMine(n.hand) ? 'pending' : 'auto'));
    this.sounded = this.notes.map(() => false);
  }

  private isMine(hand: Hand): boolean {
    if (this.opts.mode === 'listen') return false;
    return this.opts.hands === 'both' || this.opts.hands === hand;
  }

  private settled(i: number): boolean {
    const s = this.state[i];
    return s === 'hit' || s === 'miss' || (s === 'auto' && this.sounded[i]);
  }

  private moveCursor(): void {
    while (this.cursor < this.notes.length && this.settled(this.cursor)) this.cursor++;
  }

  get finished(): boolean {
    return this.time > this.length + 0.8;
  }

  /** The notes the player must press next. In wait mode the song holds here until they do. */
  nextGroup(): number[] {
    let first = -1;
    for (let i = this.cursor; i < this.notes.length; i++) {
      if (this.state[i] === 'pending') {
        first = i;
        break;
      }
    }
    if (first < 0) return [];
    const group: number[] = [];
    for (let i = first; i < this.notes.length; i++) {
      if (this.notes[i].start - this.notes[first].start > CHORD_WINDOW) break;
      if (this.state[i] === 'pending') group.push(i);
    }
    return group;
  }

  /** True while wait mode is holding the song for the player. */
  get waiting(): boolean {
    if (this.opts.mode !== 'wait') return false;
    const g = this.nextGroup();
    return g.length > 0 && this.time >= this.notes[g[0]].start;
  }

  /**
   * Moves the song forward. Returns the notes the app should sound itself:
   * the hand the player is not practising, or everything in listen mode.
   */
  advance(seconds: number): Note[] {
    let t = this.time + seconds * this.opts.speed;

    if (this.opts.mode === 'wait') {
      const g = this.nextGroup();
      if (g.length > 0) t = Math.min(t, this.notes[g[0]].start);
    }
    this.time = t;

    const toSound: Note[] = [];
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.start > t) break;
      if (this.state[i] === 'auto' && !this.sounded[i]) {
        this.sounded[i] = true;
        toSound.push(n);
      }
      if (this.opts.mode === 'flow' && this.state[i] === 'pending' && t - n.start > HIT_WINDOW) {
        this.state[i] = 'miss';
        this.newMisses.push(i);
      }
    }
    this.moveCursor();
    return toSound;
  }

  /**
   * Notes the app plays itself that start after now but no later than `until`
   * (song seconds), marked as sounded. Lets the caller hand them to the audio
   * clock a little early, so they sound on time even when a frame is late.
   */
  takeAhead(until: number): Note[] {
    const out: Note[] = [];
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.start > until) break;
      if (this.state[i] === 'auto' && !this.sounded[i]) {
        this.sounded[i] = true;
        out.push(n);
      }
    }
    this.moveCursor();
    return out;
  }

  /** Undoes takeAhead for notes starting after `t`: they will be handed out again. */
  forgetAhead(t: number): void {
    const from = firstAtOrAfter(this.notes, t + 1e-9);
    // takeAhead never reaches more than a moment ahead; a few seconds covers it.
    for (let i = from; i < this.notes.length && this.notes[i].start <= t + 5; i++) {
      if (this.state[i] === 'auto') this.sounded[i] = false;
    }
    // Everything before the old cursor was settled, so everything before `from` still is.
    if (this.cursor > from) this.cursor = from;
  }

  /** Notes that became missed since the last call. */
  takeMisses(): number[] {
    const out = this.newMisses;
    this.newMisses = [];
    return out;
  }

  /**
   * Jumps to song time `t`. Notes from `t` on become playable again; notes
   * before it that were never played are skipped (they count neither way).
   * With `judged`, only your notes inside that stretch are judged and the
   * rest are played for you, which is how loops work.
   */
  seek(t: number, judged: Loop | null = null): void {
    this.time = t;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.start >= t - 1e-6) {
        const inside = !judged || (n.start >= judged.start - 1e-6 && n.start < judged.end);
        this.state[i] = this.isMine(n.hand) && inside ? 'pending' : 'auto';
        this.sounded[i] = false;
      } else if (this.state[i] === 'pending' || this.state[i] === 'auto') {
        this.state[i] = 'auto';
        this.sounded[i] = true;
      }
    }
    this.newMisses = [];
    this.lastWrong = null;
    this.cursor = 0;
    this.moveCursor();
  }

  /** The player pressed a key. Returns true when it was a right note. */
  press(midi: number): boolean {
    return this.strike(midi) !== null;
  }

  /**
   * Like press, but says which note was hit and how far off it was. Null for a wrong key.
   * `delay` (song seconds) is how late presses reach us, e.g. from slow audio output;
   * it is taken off before judging in Play along mode.
   */
  strike(midi: number, delay = 0): Strike | null {
    if (this.opts.mode === 'listen') return null;

    let match = -1;
    let error = 0;
    if (this.opts.mode === 'wait') {
      const g = this.nextGroup();
      if (g.length > 0 && this.notes[g[0]].start - this.time <= EARLY) {
        match = g.find((i) => this.notes[i].midi === midi) ?? -1;
        // The song waits here, so a press can only be early or right on time, never late.
        if (match >= 0) error = Math.min(0, this.time - this.notes[match].start);
      }
    } else {
      const judgeAt = this.time - delay;
      let best = HIT_WINDOW;
      for (let i = firstAtOrAfter(this.notes, judgeAt - HIT_WINDOW); i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.start - judgeAt > HIT_WINDOW) break;
        const off = Math.abs(n.start - judgeAt);
        if (this.state[i] === 'pending' && n.midi === midi && off <= best) {
          best = off;
          match = i;
        }
      }
      if (match >= 0) error = judgeAt - this.notes[match].start;
    }

    if (match >= 0) {
      this.state[match] = 'hit';
      this.moveCursor();
      return { index: match, error };
    }
    this.wrong++;
    this.lastWrong = { midi, at: performance.now() };
    return null;
  }

  result(): Result {
    let hit = 0;
    let missed = 0;
    for (const s of this.state) {
      if (s === 'hit') hit++;
      else if (s === 'miss' || s === 'pending') missed++;
    }
    const total = hit + missed;
    // Wrong keys cost a little, so mashing the keyboard does not score well.
    const accuracy = total === 0 ? 0 : Math.max(0, hit - this.wrong * WRONG_COST[this.opts.mode]) / total;
    return { hit, missed, wrong: this.wrong, accuracy };
  }
}
