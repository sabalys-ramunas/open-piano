import type { Difficulty, Hand, Note, Song, TimeSignature, TimedChord } from '../song';

/**
 * The editor's document: the notes being edited plus the song details.
 * Everything here is immutable. Every edit makes a new Doc (sharing the notes
 * that did not change), which is what makes undo cheap and safe.
 */

/** A note with a stable id, so selections survive edits and undo. */
export interface EdNote {
  readonly id: number;
  readonly midi: number;
  readonly start: number;
  readonly dur: number;
  readonly hand: Hand;
  /** Finger number from the original song, kept so editing does not lose it. */
  readonly finger?: Note['finger'];
}

export interface Meta {
  title: string;
  by: string;
  difficulty?: Difficulty;
  tags?: string[];
  licence?: string;
  credit?: string;
  bpm?: number;
  beats?: number[];
  timeSignature?: TimeSignature;
  chords?: TimedChord[];
}

export interface Doc {
  /** Always sorted by start, then pitch. */
  readonly notes: readonly EdNote[];
  readonly meta: Readonly<Meta>;
}

/** The keys of an 88-key piano. Lesson files only accept notes in this range. */
export const PIANO_LO = 21;
export const PIANO_HI = 108;
export const MIN_DUR = 0.02;
export const MAX_DUR = 59;
export const MAX_TIME = 7000;

let counter = 0;
/** A fresh note id, unique for this page load. */
export function newId(): number {
  return ++counter;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Makes a note, keeping every value inside what a lesson file can hold. */
export function makeNote(midi: number, start: number, dur: number, hand: Hand, id = newId()): EdNote {
  return {
    id,
    midi: Math.round(midi),
    start: clamp(Number.isFinite(start) ? start : 0, 0, MAX_TIME),
    dur: clamp(Number.isFinite(dur) ? dur : MIN_DUR, MIN_DUR, MAX_DUR),
    hand,
  };
}

/** Returns a sorted copy. */
export function sortEd(notes: readonly EdNote[]): EdNote[] {
  return [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi || a.id - b.id);
}

export const inPiano = (midi: number): boolean => midi >= PIANO_LO && midi <= PIANO_HI;

export const noteEnd = (n: Pick<EdNote, 'start' | 'dur'>): number => n.start + n.dur;

/** End of the last note, in seconds. */
export function docLength(notes: readonly EdNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + n.dur);
  return end;
}

const META_KEYS = ['difficulty', 'tags', 'licence', 'credit', 'bpm', 'beats', 'timeSignature', 'chords'] as const;

/** Copies the editable details out of a song. */
export function metaFromSong(song: Song): Meta {
  const meta: Meta = { title: song.title, by: song.by };
  if (song.difficulty !== undefined) meta.difficulty = song.difficulty;
  if (song.tags) meta.tags = [...song.tags];
  if (song.licence !== undefined) meta.licence = song.licence;
  if (song.credit !== undefined) meta.credit = song.credit;
  if (song.bpm !== undefined) meta.bpm = song.bpm;
  if (song.beats) meta.beats = [...song.beats];
  if (song.timeSignature) meta.timeSignature = { ...song.timeSignature };
  if (song.chords) meta.chords = song.chords.map((c) => ({ ...c }));
  return meta;
}

export function docFromSong(song: Song): Doc {
  const notes = song.notes
    .filter((n) => Number.isFinite(n.midi) && Number.isFinite(n.start) && Number.isFinite(n.dur))
    .map((n) => {
      const note = makeNote(n.midi, n.start, n.dur, n.hand === 'left' ? 'left' : 'right');
      return n.finger ? { ...note, finger: n.finger } : note;
    });
  return { notes: sortEd(notes), meta: metaFromSong(song) };
}

const round = (x: number) => Math.round(x * 10000) / 10000;

/** Plain notes for a song, leaving out notes the piano cannot play. */
export function songNotes(notes: readonly EdNote[]): Note[] {
  return notes
    .filter((n) => inPiano(n.midi))
    .map((n): Note => ({ midi: n.midi, start: round(n.start), dur: round(n.dur), hand: n.hand, ...(n.finger ? { finger: n.finger } : {}) }));
}

/**
 * The song to save: `base` (id, recording, source and anything the editor does
 * not know about) with the edited notes and details on top. Details that were
 * cleared in the editor are removed.
 */
export function songFromDoc(doc: Doc, base: Song): Song {
  const out: Song = { ...base, title: doc.meta.title.trim() || 'Untitled', by: doc.meta.by.trim(), notes: songNotes(doc.notes) };
  for (const key of META_KEYS) delete out[key];
  const m = doc.meta;
  if (m.difficulty !== undefined) out.difficulty = m.difficulty;
  if (m.tags && m.tags.length > 0) out.tags = [...m.tags];
  if (m.licence) out.licence = m.licence;
  if (m.credit) out.credit = m.credit;
  if (m.bpm !== undefined) out.bpm = m.bpm;
  if (m.beats && m.beats.length > 0) out.beats = [...m.beats];
  if (m.timeSignature) out.timeSignature = { ...m.timeSignature };
  if (m.chords && m.chords.length > 0) out.chords = m.chords.map((c) => ({ ...c }));
  return out;
}

/** `base` with its details replaced by the ones in `other` (used to restore a draft). */
export function withDetailsFrom(base: Song, other: Song): Song {
  const out: Song = { ...base, title: other.title, by: other.by, notes: other.notes };
  for (const key of META_KEYS) delete out[key];
  for (const key of META_KEYS) {
    if (other[key] !== undefined) Object.assign(out, { [key]: other[key] });
  }
  return out;
}

/** True when two note lists differ in any pitch, time, length or hand. */
export function notesDiffer(a: readonly Song['notes'][number][], b: readonly Song['notes'][number][]): boolean {
  if (a.length !== b.length) return true;
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-4;
  return a.some((n, i) => n.midi !== b[i].midi || n.hand !== b[i].hand || !close(n.start, b[i].start) || !close(n.dur, b[i].dur));
}

/**
 * Marks a song as edited by hand when its notes changed from `before`, so the
 * player keeps the notes instead of rebuilding them from the recording.
 * Once edited, a song stays edited.
 */
export function markEdited(song: Song, before: Pick<Song, 'notes' | 'edited'> | undefined): Song {
  const edited = Boolean(before?.edited) || !before || notesDiffer(song.notes, before.notes);
  return edited ? { ...song, edited: true } : song;
}
