export type Hand = 'right' | 'left';

export interface Note {
  midi: number;
  start: number; // seconds
  dur: number; // seconds
  hand: Hand;
  /** Suggested finger, 1 (thumb) to 5 (little finger), when the song provides one. */
  finger?: 1 | 2 | 3 | 4 | 5;
}

export interface RawNote {
  midi: number;
  start: number;
  dur: number;
  amp: number;
  /** Set on notes of the tune itself (the sung line), found separately from the rest. */
  part?: 'melody';
}

/** Where a song came from. Built-in songs ship with the app and are never stored. */
export type SongSource = 'built-in' | 'mine' | 'community';

/** 1 is the easiest. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** How a recording was simplified for the player. */
export type Level = 'melody' | 'melody-bass' | 'melody-chords' | 'full';

export interface TimeSignature {
  /** Beats in a bar, e.g. 3 for 3/4. */
  beats: number;
  /** Note value of one beat, e.g. 4 for 3/4. */
  unit: number;
}

/** A chord name that sounds from `start` for `dur` seconds, e.g. "Am" or "G7". */
export interface TimedChord {
  start: number;
  dur: number;
  label: string;
}

export interface Song {
  id: string;
  title: string;
  by: string;
  notes: Note[];
  /** Original recording, when the song came from an audio file. A blob: URL, never persisted. */
  audioUrl?: string;
  /**
   * The recording without its guitars and keys, made by splitting the song on
   * this device, so the piano can take their place. A blob: URL, never
   * persisted, and never part of a lesson file.
   */
  backingUrl?: string;
  /** Raw transcription, kept so the arrangement can be changed without listening again. */
  raw?: RawNote[];
  /** The arrangement `notes` was made with, when `raw` is set. */
  level?: Level;
  /** The recording this song's timing belongs to. Saved in lesson files in place of the audio. */
  recording?: { name: string; bytes: number };

  // Everything below is optional metadata, added in the multi-screen version.
  source?: SongSource;
  difficulty?: Difficulty;
  /** Main tempo in beats per minute. */
  bpm?: number;
  /** Beat times in seconds, ascending. */
  beats?: number[];
  timeSignature?: TimeSignature;
  chords?: TimedChord[];
  tags?: string[];
  /** Licence of the arrangement, e.g. "CC0" or "CC BY 4.0". */
  licence?: string;
  /** Who made or arranged it, shown to the player. */
  credit?: string;
  /**
   * True once the notes were changed by hand in the editor. The player then
   * keeps them instead of rebuilding them from `raw` when the level changes.
   */
  edited?: boolean;
  /** Date.now() when the song was added to this library (songs that are not built-in). */
  addedAt?: number;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const pc = (midi: number) => ((midi % 12) + 12) % 12;

export function noteName(midi: number): string {
  return NAMES[pc(midi)];
}

export function isBlack(midi: number): boolean {
  return NAMES[pc(midi)].length === 2;
}

export function toMidi(name: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  return NAMES.indexOf(m[1]) + 12 * (Number(m[2]) + 1);
}

/**
 * Builds notes from a compact line such as "E4/1 F4/1 _/2 C4+E4/4".
 * The number is the length in steps, "_" is a rest, "+" joins a chord.
 */
export function seq(hand: Hand, stepSeconds: number, line: string, startStep = 0): Note[] {
  const out: Note[] = [];
  let step = startStep;
  for (const token of line.trim().split(/\s+/)) {
    const [pitches, len] = token.split('/');
    const steps = Number(len);
    if (pitches !== '_') {
      for (const p of pitches.split('+')) {
        out.push({
          midi: toMidi(p),
          start: step * stepSeconds,
          dur: steps * stepSeconds * 0.92,
          hand,
        });
      }
    }
    step += steps;
  }
  return out;
}

export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

export function songLength(song: Pick<Song, 'notes'>): number {
  return song.notes.reduce((end, n) => Math.max(end, n.start + n.dur), 0);
}

/** A song's source, treating songs without one as the player's own. */
export function sourceOf(song: Song): SongSource {
  return song.source ?? 'mine';
}
