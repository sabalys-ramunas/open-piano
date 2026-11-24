import { Midi } from '@tonejs/midi';
import type { Hand, Note, TimeSignature } from '../song';
import { sortNotes } from '../song';

/** What a track in a MIDI file holds, for choosing which tracks the hands play. */
export interface MidiTrack {
  index: number;
  name: string;
  instrument: string;
  notes: number;
  low: number;
  high: number;
  /** Average number of notes sounding together (1 means a single line). */
  thickness: number;
  /** Which hand this track suits, or 'none' to leave it out. */
  suggested: Hand | 'none';
}

export interface MidiSong {
  notes: Note[];
  tracks: MidiTrack[];
  bpm?: number;
  beats?: number[];
  timeSignature?: TimeSignature;
}

/** Which tracks each hand plays. Tracks in neither list are left out. */
export interface HandChoice {
  right: number[];
  left: number[];
}

const RIGHT_NAME = /right|\brh\b|treble|melody|lead|vocal|voice|soprano|tune|upper/i;
const LEFT_NAME = /left|\blh\b|bass|lower/i;

/**
 * Reads a standard MIDI file: notes (times follow the file's tempo changes),
 * the beat grid and time signature, and a sensible guess at which tracks are
 * the hands. Drums are always left out; sustain pedal and other controls are
 * ignored. Throws on files that are not MIDI.
 */
export function readMidiSong(bytes: ArrayBuffer, choice?: HandChoice): MidiSong {
  const midi = new Midi(bytes);
  const tracks: MidiTrack[] = [];
  midi.tracks.forEach((t, index) => {
    if (t.notes.length === 0 || t.instrument.percussion || t.channel === 9) return;
    const midis = t.notes.map((n) => n.midi);
    let overlap = 0;
    for (const n of t.notes) overlap += n.duration;
    const span = Math.max(1e-6, Math.max(...t.notes.map((n) => n.time + n.duration)) - Math.min(...t.notes.map((n) => n.time)));
    tracks.push({
      index,
      name: t.name.trim(),
      instrument: t.instrument.name,
      notes: t.notes.length,
      low: Math.min(...midis),
      high: Math.max(...midis),
      thickness: overlap / span,
      suggested: 'none',
    });
  });
  suggestHands(tracks, midi);

  // A single track holds both hands: it is split at middle C.
  const pick = choice ?? {
    right: tracks.filter((t) => t.suggested === 'right').map((t) => t.index),
    left: tracks.filter((t) => t.suggested === 'left' || tracks.length === 1).map((t) => t.index),
  };
  const both = new Set(pick.right.filter((i) => pick.left.includes(i)));
  const notes: Note[] = [];
  for (const t of tracks) {
    const right = pick.right.includes(t.index);
    const left = pick.left.includes(t.index);
    if (!right && !left) continue;
    for (const n of midi.tracks[t.index].notes) {
      if (!Number.isFinite(n.time) || n.midi < 21 || n.midi > 108) continue;
      const hand: Hand = both.has(t.index) || (right && left) ? (n.midi >= 60 ? 'right' : 'left') : right ? 'right' : 'left';
      notes.push({ midi: n.midi, start: Math.max(0, n.time), dur: Math.max(0.05, n.duration), hand });
    }
  }
  return { notes: tidy(notes), tracks, ...grid(midi) };
}

/** Reads just the notes, with the suggested hands. */
export function readMidi(bytes: ArrayBuffer): Note[] {
  return readMidiSong(bytes).notes;
}

function suggestHands(tracks: MidiTrack[], midi: Midi): void {
  if (tracks.length === 0) return;
  if (tracks.length === 1) {
    tracks[0].suggested = 'right'; // split at middle C below
    return;
  }
  const named = tracks.filter((t) => RIGHT_NAME.test(t.name) || LEFT_NAME.test(t.name));
  if (named.length > 0) {
    for (const t of tracks) t.suggested = RIGHT_NAME.test(t.name) ? 'right' : LEFT_NAME.test(t.name) ? 'left' : 'none';
    if (tracks.some((t) => t.suggested === 'right')) return;
  }
  const allPiano = tracks.every((t) => midi.tracks[t.index].instrument.family === 'piano');
  if (tracks.length === 2 && allPiano) {
    // Two-track piano files conventionally put the right hand first.
    tracks[0].suggested = 'right';
    tracks[1].suggested = 'left';
    return;
  }
  // A band file: the tune is the highest track that is mostly a single line;
  // the left hand takes the lowest track. Everything else is left out.
  const average = (t: MidiTrack) => {
    const ns = midi.tracks[t.index].notes;
    return ns.reduce((s, n) => s + n.midi, 0) / ns.length;
  };
  const busy = tracks.filter((t) => t.notes >= 8);
  const pool = busy.length > 0 ? busy : tracks;
  const lines = pool.filter((t) => t.thickness < 1.4);
  const tune = (lines.length > 0 ? lines : pool).reduce((a, t) => (average(t) > average(a) ? t : a));
  const bass = pool.filter((t) => t !== tune).reduce<MidiTrack | undefined>((a, t) => (!a || average(t) < average(a) ? t : a), undefined);
  for (const t of tracks) t.suggested = t === tune ? 'right' : t === bass ? 'left' : 'none';
  if (allPiano) for (const t of tracks) if (t.suggested === 'none') t.suggested = average(t) >= 60 ? 'right' : 'left';
}

/** Sorts, and stops a key sounding twice at once in the same hand. */
function tidy(notes: Note[]): Note[] {
  const sorted = sortNotes(notes);
  const last = new Map<string, Note>();
  const out: Note[] = [];
  for (const n of sorted) {
    const key = `${n.hand}:${n.midi}`;
    const prev = last.get(key);
    if (prev && Math.abs(prev.start - n.start) < 1e-3) continue; // the same note twice
    if (prev && prev.start + prev.dur > n.start) prev.dur = Math.max(0.05, n.start - prev.start - 0.005);
    last.set(key, n);
    out.push(n);
  }
  return out;
}

/** Beats in seconds from the file's own tempo map and time signature. */
function grid(midi: Midi): Pick<MidiSong, 'bpm' | 'beats' | 'timeSignature'> {
  const ppq = midi.header.ppq;
  const end = midi.durationTicks;
  if (!(ppq > 0) || !(end > 0)) return {};
  const sig = midi.header.timeSignatures[0]?.timeSignature;
  const timeSignature: TimeSignature | undefined =
    sig && sig[0] > 0 && sig[0] <= 16 && [2, 4, 8, 16].includes(sig[1]) ? { beats: sig[0], unit: sig[1] } : undefined;
  const beatTicks = ppq * (4 / (timeSignature?.unit ?? 4));
  const beats: number[] = [];
  for (let t = 0; t <= end && beats.length < 20_000; t += beatTicks) beats.push(Math.round(midi.header.ticksToSeconds(t) * 1000) / 1000);
  const tempos = midi.header.tempos;
  // The tempo that lasts longest (in time) is the song's main one.
  let bpm: number | undefined;
  if (tempos.length > 0) {
    let longest = 0;
    tempos.forEach((tempo, i) => {
      const until = tempos[i + 1]?.ticks ?? end;
      const seconds = midi.header.ticksToSeconds(until) - midi.header.ticksToSeconds(tempo.ticks);
      if (seconds > longest) {
        longest = seconds;
        bpm = Math.round(tempo.bpm);
      }
    });
  }
  return { ...(bpm ? { bpm } : {}), ...(beats.length > 1 ? { beats } : {}), ...(timeSignature ? { timeSignature } : {}) };
}
