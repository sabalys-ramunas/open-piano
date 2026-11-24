import type { Difficulty, Note, Song, TimeSignature, TimedChord } from './song';
import { sortNotes } from './song';

/**
 * A lesson file holds the notes of an arrangement and nothing else. It never
 * contains the recording: whoever opens it adds their own copy of the song.
 *
 * Version 1 files may carry the optional metadata fields below. Readers that
 * predate them simply ignore them, which is why the version stays at 1.
 */
export interface LessonFile {
  format: 'piano-lesson';
  version: 1;
  title: string;
  by: string;
  /** Which recording the timing was made for, so the right one can be matched up. */
  recording?: { name: string; bytes: number };
  /** [midi, start seconds, length seconds, 0 for right hand or 1 for left, optional finger 1..5] */
  notes: ([number, number, number, 0 | 1] | [number, number, number, 0 | 1, number])[];
  difficulty?: Difficulty;
  bpm?: number;
  /** Beat times in seconds, ascending. */
  beats?: number[];
  timeSignature?: TimeSignature;
  /** [start seconds, length seconds, label] */
  chords?: [number, number, string][];
  tags?: string[];
  licence?: string;
  credit?: string;
}

const MAX_TIME = 7200;
const round = (x: number) => Math.round(x * 1000) / 1000;

export function toLesson(song: Song): LessonFile {
  return {
    format: 'piano-lesson',
    version: 1,
    title: song.title,
    by: song.by,
    ...(song.recording ? { recording: song.recording } : {}),
    notes: song.notes.map((n) =>
      n.finger ? [n.midi, round(n.start), round(n.dur), n.hand === 'right' ? 0 : 1, n.finger] : [n.midi, round(n.start), round(n.dur), n.hand === 'right' ? 0 : 1],
    ),
    ...(song.difficulty !== undefined ? { difficulty: song.difficulty } : {}),
    ...(song.bpm !== undefined ? { bpm: round(song.bpm) } : {}),
    ...(song.beats ? { beats: song.beats.map(round) } : {}),
    ...(song.timeSignature ? { timeSignature: { ...song.timeSignature } } : {}),
    ...(song.chords ? { chords: song.chords.map((c) => [round(c.start), round(c.dur), c.label] as [number, number, string]) } : {}),
    ...(song.tags ? { tags: [...song.tags] } : {}),
    ...(song.licence !== undefined ? { licence: song.licence } : {}),
    ...(song.credit !== undefined ? { credit: song.credit } : {}),
  };
}

const damaged = () => new Error('This lesson file is damaged.');
const isTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < MAX_TIME;

function text(x: unknown, max: number): string {
  if (typeof x !== 'string' || x.length > max) throw damaged();
  return x;
}

/** Reads the optional metadata. Anything present but malformed rejects the whole file. */
function readMeta(data: Record<string, unknown>): Partial<Song> {
  const meta: Partial<Song> = {};

  if (data.difficulty !== undefined) {
    const d = data.difficulty;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 5) throw damaged();
    meta.difficulty = d as Difficulty;
  }
  if (data.bpm !== undefined) {
    const b = data.bpm;
    if (typeof b !== 'number' || !Number.isFinite(b) || b < 20 || b > 400) throw damaged();
    meta.bpm = b;
  }
  if (data.beats !== undefined) {
    const beats = data.beats;
    if (!Array.isArray(beats) || beats.length > 50_000) throw damaged();
    beats.forEach((t: unknown, i) => {
      if (!isTime(t) || (i > 0 && t < (beats[i - 1] as number))) throw damaged();
    });
    meta.beats = beats as number[];
  }
  if (data.timeSignature !== undefined) {
    const ts = data.timeSignature as Partial<TimeSignature> | null;
    const beats = ts?.beats;
    const unit = ts?.unit;
    if (
      typeof beats !== 'number' || !Number.isInteger(beats) || beats < 1 || beats > 32 ||
      typeof unit !== 'number' || ![1, 2, 4, 8, 16, 32].includes(unit)
    ) {
      throw damaged();
    }
    meta.timeSignature = { beats, unit };
  }
  if (data.chords !== undefined) {
    const chords = data.chords;
    if (!Array.isArray(chords) || chords.length > 20_000) throw damaged();
    meta.chords = chords.map((row: unknown): TimedChord => {
      const [start, dur, label] = (Array.isArray(row) ? row : []) as unknown[];
      if (!isTime(start) || typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0 || dur >= 600) throw damaged();
      const l = text(label, 16);
      if (l.length === 0) throw damaged();
      return { start, dur, label: l };
    });
  }
  if (data.tags !== undefined) {
    const tags = data.tags;
    if (!Array.isArray(tags) || tags.length > 20) throw damaged();
    meta.tags = tags.map((t: unknown) => text(t, 40));
  }
  if (data.licence !== undefined) meta.licence = text(data.licence, 200);
  if (data.credit !== undefined) meta.credit = text(data.credit, 500);
  return meta;
}

/** Reads a lesson file, refusing anything that is not one. Lesson files come from strangers. */
export function fromLesson(input: string): Song {
  let data: Record<string, unknown> & Partial<Pick<LessonFile, 'format' | 'version'>>;
  try {
    data = JSON.parse(input);
  } catch {
    throw new Error('This is not a lesson file.');
  }
  if (typeof data !== 'object' || data === null || data.format !== 'piano-lesson' || !Array.isArray(data.notes)) {
    throw new Error('This is not a lesson file.');
  }
  if (data.version !== 1) throw new Error('This lesson was made with a newer version of the app.');
  const rows = data.notes as unknown[];
  if (rows.length === 0 || rows.length > 50_000) throw new Error('This lesson has no usable notes.');

  const notes: Note[] = rows.map((row: unknown) => {
    const cells = (Array.isArray(row) ? row : []) as unknown[];
    const [midi, start, dur, hand, finger] = cells;
    if (
      cells.length > 5 ||
      typeof midi !== 'number' || !Number.isInteger(midi) || midi < 21 || midi > 108 ||
      !isTime(start) ||
      typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0 || dur >= 60 ||
      (hand !== 0 && hand !== 1) ||
      (finger !== undefined && (typeof finger !== 'number' || !Number.isInteger(finger) || finger < 1 || finger > 5))
    ) {
      throw damaged();
    }
    const note: Note = { midi, start, dur, hand: hand === 0 ? 'right' : 'left' };
    if (typeof finger === 'number') note.finger = finger as Note['finger'];
    return note;
  });

  const title = (typeof data.title === 'string' && data.title.trim() ? data.title : 'Untitled').slice(0, 120);
  const rec = data.recording as { name?: unknown; bytes?: unknown } | undefined;
  const recording =
    rec && typeof rec.name === 'string' && typeof rec.bytes === 'number' && Number.isFinite(rec.bytes)
      ? { name: rec.name.slice(0, 200), bytes: rec.bytes }
      : undefined;
  return {
    id: `lesson:${title}:${notes.length}`,
    title,
    by: typeof data.by === 'string' ? data.by.slice(0, 120) : '',
    notes: sortNotes(notes),
    recording,
    ...readMeta(data),
  };
}
