import { toMidi, type Hand, type Note, type Song } from '../song';
import type { CourseNote, Finger, KeyMark, KeyPicture, Phrase } from './types';

/**
 * Course music notation, one token per note, separated by spaces:
 *
 *   C4/1        middle C, one beat
 *   E4/2@3      E4 for two beats, finger 3
 *   C3+E3+G3/4@5+3+1   a chord with a finger for each note
 *   _/1         a one-beat rest
 *
 * `|` may be used between bars for readability; it is ignored. Lengths are
 * beats and may be fractions such as 0.5 or 1.5.
 */
export function line(hand: Hand, text: string, startBeat = 0): CourseNote[] {
  const out: CourseNote[] = [];
  let beat = startBeat;
  for (const token of text.trim().split(/\s+/)) {
    if (token === '|' || token === '') continue;
    const m = /^([^/@]+)\/([0-9.]+)(?:@([1-5](?:\+[1-5])*))?$/.exec(token);
    if (!m) throw new Error(`Bad course note "${token}"`);
    const beats = Number(m[2]);
    if (!(beats > 0)) throw new Error(`Bad length in "${token}"`);
    if (m[1] !== '_') {
      const pitches = m[1].split('+').map(toMidi);
      const fingers = m[3] ? m[3].split('+').map((f) => Number(f) as Finger) : [];
      if (fingers.length > 0 && fingers.length !== pitches.length) throw new Error(`Fingers do not match notes in "${token}"`);
      pitches.forEach((midi, i) => {
        const note: CourseNote = { midi, beat, beats, hand };
        if (fingers[i] !== undefined) note.finger = fingers[i];
        out.push(note);
      });
    } else if (m[3]) {
      throw new Error(`A rest has no finger: "${token}"`);
    }
    beat += beats;
  }
  return out;
}

export function sortCourseNotes(notes: CourseNote[]): CourseNote[] {
  return notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
}

/** Builds a phrase from one or more lines of notes. */
export function phrase(
  options: { bpm: number; beatsPerBar?: number; chords?: string },
  ...parts: CourseNote[][]
): Phrase {
  const p: Phrase = { bpm: options.bpm, beatsPerBar: options.beatsPerBar ?? 4, notes: sortCourseNotes(parts.flat()) };
  if (options.chords) p.chords = chordLine(options.chords);
  return p;
}

/** Chord names over the music: "C/4 F/2 G/2" (beats per chord, "_" for none). */
export function chordLine(text: string): { beat: number; beats: number; label: string }[] {
  const out: { beat: number; beats: number; label: string }[] = [];
  let beat = 0;
  for (const token of text.trim().split(/\s+/)) {
    if (token === '|') continue;
    const m = /^([A-G][#b]?m?7?|_)\/([0-9.]+)$/.exec(token);
    if (!m) throw new Error(`Bad chord "${token}"`);
    const beats = Number(m[2]);
    if (m[1] !== '_') out.push({ beat, beats, label: m[1] });
    beat += beats;
  }
  return out;
}

/** Length of a phrase in beats. */
export function phraseBeats(p: Phrase): number {
  const end = p.notes.reduce((e, n) => Math.max(e, n.beat + n.beats), 0);
  const chordEnd = (p.chords ?? []).reduce((e, c) => Math.max(e, c.beat + c.beats), 0);
  return Math.max(end, chordEnd);
}

/**
 * Turns a phrase into a Song the shared Session can play. `leadBeats` adds
 * silent beats before the first note, for a count-in.
 */
export function toSong(p: Phrase, id: string, title: string, leadBeats = 0): Song {
  const spb = 60 / p.bpm;
  const notes: Note[] = p.notes
    .map((n): Note => ({
      midi: n.midi,
      start: (n.beat + leadBeats) * spb,
      dur: n.beats * spb * 0.92,
      hand: n.hand,
      ...(n.finger ? { finger: n.finger } : {}),
    }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  const total = Math.ceil(phraseBeats(p) + leadBeats);
  const beats: number[] = [];
  for (let i = 0; i <= total; i++) beats.push(i * spb);
  const song: Song = {
    id,
    title,
    by: '',
    notes,
    bpm: p.bpm,
    beats,
    timeSignature: { beats: p.beatsPerBar, unit: 4 },
    source: 'built-in',
  };
  if (p.chords) song.chords = p.chords.map((c) => ({ start: (c.beat + leadBeats) * spb, dur: c.beats * spb, label: c.label }));
  return song;
}

/** Finds the course note behind a Song note made by `toSong`. */
export function courseNoteFor(p: Phrase, note: Note, leadBeats = 0): CourseNote | undefined {
  const spb = 60 / p.bpm;
  return p.notes.find((n) => n.midi === note.midi && n.hand === note.hand && Math.abs((n.beat + leadBeats) * spb - note.start) < 1e-6);
}

/**
 * A keyboard picture. `marks` uses the same pitch spelling as notes, with an
 * optional finger: "C4@1 E4@3 G4@5", or a label: "C4=C" or "D4=?". Add `:L` for a
 * left-hand mark: "C3@5:L".
 */
export function keys(lo: string, hi: string, marks = '', options: { names?: boolean; groups?: boolean } = {}): KeyPicture {
  const list: KeyMark[] = [];
  for (const token of marks.trim().split(/\s+/)) {
    if (!token) continue;
    const m = /^([A-G]#?-?\d)(?:@([1-5]))?(?:=([^:\s]+))?(:L)?$/.exec(token);
    if (!m) throw new Error(`Bad key mark "${token}"`);
    const mark: KeyMark = { midi: toMidi(m[1]) };
    if (m[2]) mark.finger = Number(m[2]) as Finger;
    if (m[3]) mark.label = m[3];
    mark.hand = m[4] ? 'left' : 'right';
    list.push(mark);
  }
  const pic: KeyPicture = { lo: toMidi(lo), hi: toMidi(hi), marks: list };
  if (options.names) pic.names = true;
  if (options.groups) pic.groups = true;
  return pic;
}

/** Letter names without octave, for showing to learners. */
export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
