import { describe, expect, it } from 'vitest';
import { chordLabel, chordNotes, findHarmony } from '../src/analysis';
import { chordsFor } from '../src/import';
import type { RawNote, TimedChord } from '../src/song';
import { chordAccuracy, flicker } from './arrange-metrics';
import { BAND_SONGS, bandScore } from './band';

const beatsOf = (n: number, step = 0.5) => Array.from({ length: n }, (_, i) => i * step);

/** Strummed chord notes on every beat: [pitch classes as MIDI notes] per bar. */
function strum(bars: number[][], beatsPerBar = 4, step = 0.5): RawNote[] {
  const out: RawNote[] = [];
  bars.forEach((notes, b) => {
    for (let k = 0; k < beatsPerBar; k++) {
      const start = (b * beatsPerBar + k) * step;
      for (const midi of notes) out.push({ midi, start, dur: step * 0.9, amp: 0.6 });
    }
  });
  return out;
}

describe('chord names', () => {
  it('reads lead-sheet labels, old and new', () => {
    expect(chordNotes('Am')).toMatchObject({ root: 9, minor: true, tones: [9, 0, 4], bass: 9 });
    expect(chordNotes('Bb')).toMatchObject({ root: 10, minor: false, tones: [10, 2, 5] });
    expect(chordNotes('G7')).toMatchObject({ root: 7, third: 11, seventh: 5, quality: '7' });
    expect(chordNotes('Cmaj7')?.seventh).toBe(11);
    expect(chordNotes('F#m7')).toMatchObject({ root: 6, minor: true, seventh: 4 });
    expect(chordNotes('Dsus4')).toMatchObject({ third: undefined, extra: 7 });
    expect(chordNotes('E5')).toMatchObject({ tones: [4, 11], third: undefined });
    expect(chordNotes('G/B')).toMatchObject({ root: 7, bass: 11 });
    expect(chordNotes('H')).toBeUndefined();
    expect(chordNotes('Cadd13')).toBeUndefined();
    expect(chordLabel(10, '7', 2, { tonic: 3, minor: false })).toBe('Bb7/D');
    expect(chordLabel(1, 'm', undefined, { tonic: 4, minor: false })).toBe('C#m');
  });
});

describe('finding chords', () => {
  it('finds major, minor, seventh and slash chords from plain notes', () => {
    const notes = strum([
      [48, 52, 55, 60], // C
      [47, 55, 59, 62], // G/B
      [45, 57, 60, 64], // Am
      [43, 55, 59, 62, 65], // G7
    ]);
    const { chords } = findHarmony(notes, beatsOf(16), { beatsPerBar: 4 });
    expect(chords.map((c) => c.label)).toEqual(['C', 'G/B', 'Am', 'G7']);
    for (const c of chords) expect(c.confidence).toBeGreaterThan(0.2);
  });

  it('does not flicker on passing notes: a chord lasts at least half a bar', () => {
    const notes = strum([[48, 52, 55], [48, 52, 55], [41, 57, 60, 65], [41, 57, 60, 65]]);
    // A passing D and B in the bass on single beats.
    notes.push({ midi: 50, start: 1.5, dur: 0.4, amp: 0.8 }, { midi: 47, start: 5.5, dur: 0.4, amp: 0.8 });
    const { chords } = findHarmony(notes, beatsOf(16), { beatsPerBar: 4 });
    expect(chords.map((c) => c.label)).toEqual(['C', 'F']);
  });

  it('does not take the sung tune for harmony', () => {
    // C major strummed, the singer holding F (a suspension) loudly over it.
    const notes = strum([[48, 52, 55, 60], [48, 52, 55, 60]]);
    const melody: RawNote[] = [{ midi: 65, start: 0, dur: 3.9, amp: 1, part: 'melody' }];
    const heard = [...notes, { midi: 65, start: 0, dur: 3.9, amp: 1 }, { midi: 77, start: 0, dur: 3.9, amp: 0.9 }];
    const { chords } = findHarmony(heard, beatsOf(8), { beatsPerBar: 4, melody });
    expect(chords.map((c) => c.label)).toEqual(['C']);
  });

  it('plays it safe when the third is not heard: root and fifth only', () => {
    const notes = strum([[40, 47, 52, 59], [40, 47, 52, 59]]); // E and B only
    const { chords } = findHarmony(notes, beatsOf(8), { beatsPerBar: 4 });
    expect(chords.map((c) => c.label)).toEqual(['E5']);
  });

  it('finds no chord where only drums play', () => {
    const notes = strum([[], [48, 52, 55], [48, 52, 55]]);
    notes.push({ midi: 36, start: 0, dur: 0.1, amp: 0.3 }, { midi: 38, start: 1, dur: 0.1, amp: 0.3 });
    const { chords } = findHarmony(notes, beatsOf(12), { beatsPerBar: 4 });
    expect(chords).toHaveLength(1);
    expect(chords[0].start).toBeCloseTo(2, 1);
  });

  for (const song of BAND_SONGS) {
    it(`finds the chords of ${song.name} from its notes`, () => {
      const score = bandScore(song);
      const h = findHarmony(
        score.raw.filter((n) => !n.part),
        score.beats,
        { beatsPerBar: song.beatsPerBar, melody: score.raw.filter((n) => n.part === 'melody') },
      );
      const acc = chordAccuracy(score.chords, h.chords, score.beats);
      const bar = (60 / song.bpm) * song.beatsPerBar;
      const from = score.chords[0].start;
      const to = score.chords[score.chords.length - 1].start + score.chords[score.chords.length - 1].dur;
      // Wrong chords (wrong root, or the wrong third) are what a listener hears as wrong notes.
      expect(acc.wrong).toBeLessThanOrEqual(0.1);
      expect(acc.root).toBeGreaterThanOrEqual(0.85);
      // Never busier than the song itself.
      expect(flicker(h.chords, from, to, bar)).toBeLessThanOrEqual(flicker(score.chords, from, to, bar) + 0.05);
      // The key of the first section.
      expect(h.keys[0].key).toEqual(song.sections[0].key);
    });
  }

  it('follows a key change', () => {
    const song = BAND_SONGS.find((s) => s.name === 'keychange-d-to-e')!;
    const score = bandScore(song);
    const h = findHarmony(score.raw.filter((n) => !n.part), score.beats, { beatsPerBar: 4, melody: score.raw.filter((n) => n.part === 'melody') });
    expect(h.keys.map((k) => k.key)).toEqual([
      { tonic: 2, minor: false },
      { tonic: 4, minor: false },
    ]);
    // Spelled for the key it is in: the E section's C#m, not Dbm.
    expect(h.chords.some((c) => c.label === 'C#m')).toBe(true);
  });
});

describe('re-arranging songs added before the better chords', () => {
  it('works the chords out again for an older song, and keeps new ones as they are', () => {
    const raw = strum([[48, 52, 55], [43, 55, 59, 62], [45, 57, 60, 64], [41, 57, 60, 65]]);
    const beats = beatsOf(16);
    // What the old chord finder stored: flickering triads, no confidence.
    const old: TimedChord[] = [
      { start: 0, dur: 1, label: 'C' },
      { start: 1, dur: 0.5, label: 'Em' },
      { start: 1.5, dur: 0.5, label: 'C' },
      { start: 2, dur: 2, label: 'G' },
      { start: 4, dur: 2, label: 'C' },
      { start: 6, dur: 2, label: 'F' },
    ];
    const fresh = chordsFor({ raw, chords: old, beats, timeSignature: { beats: 4, unit: 4 } })!;
    expect(fresh.map((c) => c.label)).toEqual(['C', 'G', 'Am', 'F']);
    expect(chordsFor({ raw, chords: fresh, beats })).toBe(fresh);
    // Without notes or beats to work from, the stored chords stay.
    expect(chordsFor({ chords: old, beats })).toBe(old);
  });
});
