import type { Hands } from '../player/game';
import type { Hand } from '../song';

/** Piano finger numbers: 1 is the thumb, 5 the little finger, on both hands. */
export type Finger = 1 | 2 | 3 | 4 | 5;

/** One note of course music, measured in beats so tempo can change freely. */
export interface CourseNote {
  midi: number;
  /** Beat the note starts on, from 0. */
  beat: number;
  /** Length in beats. */
  beats: number;
  hand: Hand;
  finger?: Finger;
}

/** A short piece of music used by a lesson step. */
export interface Phrase {
  bpm: number;
  /** Beats in a bar: 4 for 4/4, 3 for 3/4. */
  beatsPerBar: number;
  /** Sorted by beat, then pitch. */
  notes: CourseNote[];
  /** Chord names shown above the music, e.g. while learning to play chords. */
  chords?: { beat: number; beats: number; label: string }[];
}

/** A key drawn specially in a keyboard picture. */
export interface KeyMark {
  midi: number;
  finger?: Finger;
  hand?: Hand;
  /** Text on the key instead of the finger number, e.g. a note name. */
  label?: string;
}

/** A small keyboard illustration. `lo` and `hi` are white keys. */
export interface KeyPicture {
  lo: number;
  hi: number;
  marks: KeyMark[];
  /** Write the letter name on every white key. */
  names?: boolean;
  /** Tint the groups of two and three black keys. */
  groups?: boolean;
}

/** A small staff illustration with notes on it. */
export interface StaffPicture {
  clef: 'treble' | 'bass';
  /** Notes drawn left to right (white keys only). */
  notes: number[];
  /** Write the note name under each note. */
  names?: boolean;
}

/** A friendly hand drawing with numbered fingers, seen from above as when playing. */
export interface HandPicture {
  side: Hand;
  /** Fingers to show brightly; the others are drawn calm. Default: all five. */
  fingers?: Finger[];
}

/** Beats drawn as blocks under a count, to show how long notes and rests last. */
export interface RhythmPicture {
  /** Lengths in beats, in order. A rest is drawn as an empty block. */
  notes: { beats: number; rest?: boolean }[];
}

export type Loudness = 'soft' | 'loud';

/** Optional pictures any card-like step can carry. */
export interface Pictures {
  keys?: KeyPicture;
  staff?: StaffPicture;
  hand?: HandPicture;
  rhythm?: RhythmPicture;
}

/** Steps that play music on the stage share these fields. */
interface MusicStep {
  title: string;
  text: string;
  music: Phrase;
  hands: Hands;
  /** Show sheet music instead of falling notes when this step starts. */
  view?: 'falling' | 'sheet';
}

/** One thing to do inside a lesson. Each kind is handled by a controller in engine.ts. */
export type LessonStep =
  /** Read a short explanation, then continue. */
  | ({ kind: 'explain'; title: string; text: string } & Pictures)
  /**
   * Find keys on the keyboard, one after another. With `anyOctave` the same
   * letter anywhere counts; with `distinct` each find must be a different key.
   */
  | {
      kind: 'find';
      title: string;
      text: string;
      targets: number[];
      anyOctave?: boolean;
      distinct?: boolean;
      /** Keyboard drawn for this step (white keys). */
      lo: number;
      hi: number;
      /** Wrong presses in a row before the key lights up. 0 lights it at once. */
      hintAfter?: number;
      /** Finger to use, shown with the prompt. */
      finger?: Finger;
      hand?: 'right' | 'left';
    }
  /** A question with a few answers. */
  | ({
      kind: 'quiz';
      title: string;
      question: string;
      choices: string[];
      answer: number;
      /** Said after the right answer, to explain it. */
      why: string;
    } & Pictures)
  /** The app plays the music; the learner listens and watches. */
  | ({ kind: 'listen' } & MusicStep)
  /** The music waits for each right key (Learn mode). */
  | ({ kind: 'phrase'; hintAfter?: number } & MusicStep)
  /** Play along in time. Passing needs `pass` accuracy (0..1). */
  | ({ kind: 'timed'; pass: number } & MusicStep)
  /** The piece at the end of a unit, played in time. */
  | ({ kind: 'perform'; pass: number } & MusicStep)
  /** A library song played along in time, e.g. a built-in song. */
  | { kind: 'song'; title: string; text: string; songId: string; hands: Hands; pass: number }
  /** Press keys softly or strongly, to learn about loud and quiet playing. */
  | { kind: 'touch'; title: string; text: string; prompts: Loudness[] };

export type StepKind = LessonStep['kind'];

export interface Lesson {
  /** Stable: progress is stored against it. Used in #/course/<id>. */
  id: string;
  title: string;
  /** One sentence for the lesson list. */
  summary: string;
  steps: LessonStep[];
  /** Set on the piece that ends a unit. */
  piece?: { title: string; by: string };
}

export interface Unit {
  id: string;
  title: string;
  /** One sentence on what the unit teaches. */
  blurb: string;
  lessons: Lesson[];
}

export interface Course {
  id: string;
  title: string;
  units: Unit[];
}
