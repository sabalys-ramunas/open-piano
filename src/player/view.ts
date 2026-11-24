import type { Note, Song } from '../song';
import type { Hands, Loop, Mode, NoteState } from './game';

/** Everything a stage view needs to draw one frame. Read-only: views never change the session. */
export interface FrameState {
  song: Song;
  notes: readonly Note[];
  /** Same length and order as `notes`. */
  states: readonly NoteState[];
  /** Song position in seconds. Negative during the lead-in. */
  time: number;
  /** Song length in seconds. */
  length: number;
  mode: Mode;
  hands: Hands;
  speed: number;
  running: boolean;
  /** Keys to press next (Learn mode), for highlighting. */
  expected: ReadonlySet<number>;
  /** Keys held right now, from any input. */
  held: ReadonlySet<number>;
  /** The last wrong key and when it was pressed (performance.now() ms). */
  wrong: { midi: number; at: number } | null;
  /** Computer-key letter per midi note. Empty when letters should not be shown. */
  keyLetters: ReadonlyMap<number, string>;
  /** Keyboard range to draw, whole octaves from a C to a B. */
  range: { lo: number; hi: number };
  showNoteNames: boolean;
  reduceMotion: boolean;
  /** performance.now() for this frame. */
  now: number;
  /** The section being looped, if any. Optional: hosts that do not loop leave it out. */
  loop?: Loop | null;
  /** True while "show me" plays the next few seconds. */
  previewing?: boolean;
  /**
   * The keys the player's own piano has (settings keyLow/keyHigh), so a view
   * that fits its keyboard to the song never draws keys the piano lacks.
   * Optional: without it views assume 88 keys.
   */
  keyLimit?: { lo: number; hi: number };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A way of showing the song: falling notes, sheet music, and so on. The
 * player screen gives each view an empty host element, calls `resize`
 * whenever the host changes size and `draw` once per animation frame.
 */
export interface StageView {
  /** Sizes are CSS pixels of the host; pixelRatio is window.devicePixelRatio. */
  resize(width: number, height: number, pixelRatio: number): void;
  draw(frame: FrameState): void;
  /** The key under a point in host CSS pixels, so the on-screen keys can be played. */
  keyAt?(x: number, y: number): number | null;
  /** Where a key is drawn, in host CSS pixels, so effects can be placed on it. */
  keyRect?(midi: number): Rect | null;
  /** Removes everything the view added to the host. */
  destroy(): void;
}

export type StageViewFactory = (host: HTMLElement) => StageView;
