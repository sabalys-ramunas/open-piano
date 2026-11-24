import { Midi } from '@tonejs/midi';
import { songLength, sortNotes, type Difficulty, type Hand, type Note, type Song, type TimeSignature } from '../song';

/**
 * Turns MIDI files and note lists into tidy lesson songs. Used by the song
 * pack build script (scripts/build-songs.mjs) and its tests. Pure functions,
 * no file or network access.
 */

export interface ConvertOptions {
  /**
   * Which MIDI tracks (indexes among tracks that have notes) the right and the
   * left hand play. Default: with two or more tracks, tracks are grouped by
   * average pitch; with one track, notes are split at `split`.
   */
  hands?: { right: number[]; left: number[] };
  /** Split point for single-track files: notes at or above it go to the right hand. Default 60 (middle C). */
  split?: number;
  /** Plays the piece faster (above 1) or slower than the file says. Default 1. */
  tempoScale?: number;
}

export interface Converted {
  notes: Note[];
  bpm?: number;
  beats?: number[];
  timeSignature?: TimeSignature;
}

const MIN_DUR = 0.02;
const ms = (x: number) => Math.round(x * 1000) / 1000 || 0; // `|| 0` turns -0 into 0

/** Average pitch of a list of MIDI note numbers. */
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/**
 * Groups tracks into hands by average pitch: the track with the highest
 * average plays right, the lowest plays left, and any others join the hand
 * whose average they are closer to.
 */
export function assignTracks(means: number[]): Hand[] {
  if (means.length === 0) return [];
  if (means.length === 1) return ['right'];
  const hi = Math.max(...means);
  const lo = Math.min(...means);
  const iHi = means.indexOf(hi);
  const iLo = means.lastIndexOf(lo);
  return means.map((m, i) => (i === iHi ? 'right' : i === iLo ? 'left' : hi - m <= m - lo ? 'right' : 'left'));
}

/**
 * Makes notes playable on one piano: rounds times to milliseconds, drops
 * duplicates of the same key struck at the same moment, and shortens a note
 * when the same key is struck again before it ends. Returns a sorted copy.
 */
export function cleanNotes(input: readonly Note[]): Note[] {
  const notes = input
    .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.dur) && n.midi >= 21 && n.midi <= 108)
    .map((n) => ({ ...n, start: ms(Math.max(0, n.start)), dur: ms(Math.max(MIN_DUR, n.dur)) }));
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    const list = byPitch.get(n.midi) ?? [];
    list.push(n);
    byPitch.set(n.midi, list);
  }
  const out: Note[] = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start || b.dur - a.dur);
    let prev: Note | undefined;
    for (const n of list) {
      if (prev && n.start - prev.start < MIN_DUR) {
        // The same key twice at once: keep one, as long as the longer of the two.
        prev.dur = Math.max(prev.dur, n.dur);
        continue;
      }
      // Starts are at least MIN_DUR apart here, so the shortened note always ends before the next one starts.
      if (prev && prev.start + prev.dur > n.start) prev.dur = ms(Math.max(MIN_DUR / 2, n.start - prev.start - 0.01));
      out.push(n);
      prev = n;
    }
  }
  return sortNotes(out);
}

/**
 * One hand can press at most five keys. When a chord gives one hand more (it
 * happens where the score writes notes for both hands on one staff), the
 * extra top notes of a left-hand chord, or bottom notes of a right-hand
 * chord, move to the other hand. Changes `notes` in place.
 */
export function balanceHands(notes: Note[]): void {
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const key = `${n.hand}:${Math.round(n.start * 50)}`; // struck within the same 20 ms
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    if (list.length <= 5) continue;
    list.sort((a, b) => a.midi - b.midi);
    const extra = list.length - 5;
    const moving = list[0].hand === 'left' ? list.slice(-extra) : list.slice(0, extra);
    for (const n of moving) n.hand = n.hand === 'left' ? 'right' : 'left';
  }
}

/** Shifts every note so the first one starts at zero. Returns the shift in seconds. */
export function trimLeadingSilence(notes: Note[]): number {
  if (notes.length === 0) return 0;
  const first = Math.min(...notes.map((n) => n.start));
  if (first <= 0) return 0;
  for (const n of notes) n.start = ms(n.start - first);
  return first;
}

/** Reads a MIDI file into lesson notes plus tempo, beats and time signature. */
export function convertMidi(bytes: ArrayBuffer | Uint8Array, options: ConvertOptions = {}): Converted {
  const midi = new Midi(bytes);
  const scale = options.tempoScale && options.tempoScale > 0 ? options.tempoScale : 1;
  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && !t.instrument.percussion);
  const auto = assignTracks(tracks.map((t) => mean(t.notes.map((n) => n.midi))));
  const handOf = (trackIndex: number, pitch: number): Hand | null => {
    if (options.hands) {
      if (options.hands.right.includes(trackIndex)) return 'right';
      if (options.hands.left.includes(trackIndex)) return 'left';
      return null;
    }
    if (tracks.length === 1) return pitch >= (options.split ?? 60) ? 'right' : 'left';
    return auto[trackIndex];
  };

  const raw: Note[] = [];
  tracks.forEach((track, i) => {
    for (const n of track.notes) {
      const hand = handOf(i, n.midi);
      if (!hand || n.velocity === 0) continue;
      raw.push({ midi: n.midi, start: n.time / scale, dur: n.duration / scale, hand });
    }
  });
  const notes = cleanNotes(raw);
  balanceHands(notes);
  const shift = trimLeadingSilence(notes);
  if (notes.length === 0) return { notes };

  const header = midi.header;
  const firstTs = header.timeSignatures[0]?.timeSignature;
  const timeSignature: TimeSignature | undefined =
    firstTs && firstTs.length >= 2 && [1, 2, 4, 8, 16, 32].includes(firstTs[1]) && firstTs[0] >= 1 && firstTs[0] <= 32
      ? { beats: firstTs[0], unit: firstTs[1] }
      : undefined;

  // Tempo: the one in force for the longest time while notes sound, expressed in the time signature's beat unit.
  const end = songLength({ notes });
  const firstTick = header.secondsToTicks(shift * scale);
  const lastTick = header.secondsToTicks((shift + end) * scale);
  const tempos = header.tempos.length > 0 ? header.tempos : [{ ticks: 0, bpm: 120 }];
  const weight = new Map<number, number>();
  tempos.forEach((t, i) => {
    const from = Math.max(t.ticks, firstTick);
    const to = Math.min(tempos[i + 1]?.ticks ?? Infinity, lastTick);
    if (to > from) weight.set(Math.round(t.bpm), (weight.get(Math.round(t.bpm)) ?? 0) + (to - from));
  });
  const quarterBpm = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? tempos[0].bpm;
  const unit = timeSignature?.unit ?? 4;
  const bpm = Math.min(400, Math.max(20, Math.round((quarterBpm * scale * unit) / 4)));

  // Beats: every beat of every bar, following time signature and tempo changes.
  const beats: number[] = [];
  const sigs = header.timeSignatures.length > 0 ? header.timeSignatures : [{ ticks: 0, timeSignature: [4, 4] }];
  const endTick = lastTick + header.ppq * 4;
  for (let s = 0; s < sigs.length && beats.length < 50_000; s++) {
    const sig = sigs[s];
    const step = (header.ppq * 4) / (sig.timeSignature[1] || 4);
    const until = Math.min(sigs[s + 1]?.ticks ?? Infinity, endTick);
    for (let tick = sig.ticks; tick < until && beats.length < 50_000; tick += step) {
      const t = ms(header.ticksToSeconds(tick) / scale - shift);
      if (t >= 0 && t <= end + 0.001 && (beats.length === 0 || t > beats[beats.length - 1])) beats.push(t);
    }
  }
  return { notes, bpm, beats: beats.length >= 2 ? beats : undefined, timeSignature };
}

/** Numbers describing how hard a piece is to play. */
export interface DifficultyStats {
  seconds: number;
  notesPerSecond: number;
  /** Busiest 5-second stretch, notes per second. */
  peakNotesPerSecond: number;
  /** Share of moments where one hand plays three or more keys at once. */
  chordShare: number;
  /** Left-hand notes per second. */
  leftPerSecond: number;
  /** Average jump between one right-hand note and the next, in semitones. */
  averageLeap: number;
  /** Widest stretch one hand plays at once, in semitones. */
  widestSpan: number;
  blackKeyShare: number;
}

export function difficultyStats(notes: readonly Note[]): DifficultyStats {
  const seconds = Math.max(1, songLength({ notes: notes as Note[] }));
  const starts = notes.map((n) => n.start).sort((a, b) => a - b);
  let peak = 0;
  for (let i = 0, j = 0; i < starts.length; i++) {
    while (starts[i] - starts[j] > 5) j++;
    peak = Math.max(peak, (i - j + 1) / Math.min(5, seconds));
  }
  // Group notes struck together (within 40 ms) per hand.
  const groups: Note[][] = [];
  for (const hand of ['right', 'left'] as Hand[]) {
    let group: Note[] = [];
    for (const n of notes.filter((x) => x.hand === hand)) {
      if (group.length > 0 && n.start - group[0].start > 0.04) {
        groups.push(group);
        group = [];
      }
      group.push(n);
    }
    if (group.length > 0) groups.push(group);
  }
  const chordShare = groups.filter((g) => g.length >= 3).length / Math.max(1, groups.length);
  const widestSpan = groups.reduce((w, g) => Math.max(w, Math.max(...g.map((n) => n.midi)) - Math.min(...g.map((n) => n.midi))), 0);
  const tops = groups
    .filter((g) => g[0].hand === 'right')
    .sort((a, b) => a[0].start - b[0].start)
    .map((g) => Math.max(...g.map((n) => n.midi)));
  let leap = 0;
  for (let i = 1; i < tops.length; i++) leap += Math.abs(tops[i] - tops[i - 1]);
  const black = notes.filter((n) => [1, 3, 6, 8, 10].includes(n.midi % 12)).length;
  return {
    seconds,
    notesPerSecond: notes.length / seconds,
    peakNotesPerSecond: peak,
    chordShare,
    leftPerSecond: notes.filter((n) => n.hand === 'left').length / seconds,
    averageLeap: tops.length > 1 ? leap / (tops.length - 1) : 0,
    widestSpan,
    blackKeyShare: black / Math.max(1, notes.length),
  };
}

/**
 * A rough 1 to 5 difficulty from the notes alone. It weighs speed, the
 * busiest passage, chords, how much the left hand does, jumps and black keys.
 * The song list may override it where a person knows better.
 */
export function estimateDifficulty(notes: readonly Note[]): Difficulty {
  const s = difficultyStats(notes);
  const score =
    s.notesPerSecond * 0.5 +
    s.peakNotesPerSecond * 0.3 +
    s.chordShare * 2 +
    Math.max(0, s.averageLeap - 3) * 0.3 +
    Math.max(0, s.widestSpan - 12) * 0.15 +
    s.blackKeyShare * 2;
  if (score < 3) return 1;
  if (score < 5.5) return 2;
  if (score < 8.5) return 3;
  if (score < 11) return 4;
  return 5;
}

/**
 * An easier arrangement: the top line of the right hand (the tune, in most
 * pieces) plus one low bass note at the start of each bar, or each half bar
 * in bars of four or more beats. Inner voices and fast accompaniment are left
 * out. Needs `beats` and `timeSignature` to find the bars.
 */
export function melodyAndBass(song: Pick<Song, 'notes' | 'beats' | 'timeSignature'>): Note[] {
  const right = song.notes.filter((n) => n.hand === 'right').sort((a, b) => a.start - b.start || b.midi - a.midi);
  const melody: Note[] = [];
  for (const n of right) {
    const last = melody[melody.length - 1];
    if (last && n.start - last.start < 0.04) continue; // a lower note of the same chord
    if (last && n.start < last.start + last.dur - 0.04 && n.midi < last.midi) continue; // an inner voice under a held tune note
    melody.push({ ...n });
  }
  for (let i = 0; i + 1 < melody.length; i++) {
    const next = melody[i + 1];
    if (melody[i].start + melody[i].dur > next.start) melody[i].dur = Math.max(MIN_DUR, next.start - melody[i].start - 0.01);
  }

  const bass: Note[] = [];
  const beats = song.beats ?? [];
  const perBar = song.timeSignature?.beats ?? 4;
  const step = perBar >= 4 && perBar % 2 === 0 ? perBar / 2 : perBar === 6 || perBar === 12 ? 3 : perBar === 9 ? 3 : perBar;
  const left = song.notes.filter((n) => n.hand === 'left');
  const end = songLength(song);
  if (beats.length >= 2 && left.length > 0) {
    // Bars are counted from the first beat; a pickup bar shifts everything, so align to the first left-hand note's beat.
    const beatLen = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    const firstLeft = Math.min(...left.map((n) => n.start));
    let offset = beats.findIndex((b) => b >= firstLeft - beatLen / 2);
    if (offset < 0) offset = 0;
    offset %= step;
    for (let i = offset; i < beats.length; i += step) {
      const from = beats[i] - 0.03;
      const to = beats[i] + beatLen * 0.6;
      const candidates = left.filter((n) => n.start >= from && n.start < to);
      if (candidates.length === 0) continue;
      const low = candidates.reduce((a, b) => (b.midi < a.midi ? b : a));
      const until = Math.min(beats[i + step] ?? end, end);
      bass.push({ midi: low.midi, start: low.start, dur: Math.max(MIN_DUR, until - low.start - 0.02), hand: 'left' });
    }
  }
  return cleanNotes([...melody, ...bass]);
}
