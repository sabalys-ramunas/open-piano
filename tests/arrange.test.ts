import { describe, expect, it } from 'vitest';
import { findHarmony } from '../src/analysis';
import { LOW_LIMIT, RULES, arrange, clearLow, fitRange, limitRate, snap } from '../src/import/arrange';
import type { Level, Note, RawNote, TimedChord } from '../src/song';
import { measure, melodyOf } from './arrange-metrics';
import { BAND_SONGS, bandScore } from './band';

const LEVELS: Level[] = ['melody', 'melody-bass', 'melody-chords', 'full'];

function random(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A messy imitation of what the note model hears in a band recording. */
function messySong(seed: number): { raw: RawNote[]; beats: number[]; chords: TimedChord[] } {
  const rnd = random(seed);
  const beats = Array.from({ length: 64 }, (_, i) => i * 0.5 + (rnd() - 0.5) * 0.02);
  const names = ['C', 'F', 'G', 'Am', 'Dm', 'Em', 'G7', 'G/B', 'C5', 'Fmaj7', 'Dsus4'];
  const chords: TimedChord[] = [];
  for (let i = 0; i < 16; i++) chords.push({ start: beats[i * 4], dur: 2, label: names[Math.floor(rnd() * names.length)] });
  const raw: RawNote[] = [];
  for (let i = 0; i < 400; i++) {
    raw.push({ midi: 28 + Math.floor(rnd() * 70), start: rnd() * 32, dur: 0.05 + rnd() * 1.2, amp: rnd() });
  }
  // A sung line, with some fast ornaments and very high and low notes.
  let t = 0.2;
  while (t < 31) {
    const fast = rnd() < 0.2;
    raw.push({ midi: 40 + Math.floor(rnd() * 50), start: t, dur: fast ? 0.06 : 0.3, amp: 0.8, part: 'melody' });
    t += fast ? 0.07 : 0.25 + rnd() * 0.4;
  }
  return { raw, beats, chords };
}

const sounding = (notes: Note[], t: number) => notes.filter((n) => n.start <= t + 1e-9 && t < n.start + n.dur - 1e-9);

/** Checks every playing rule; returns the broken ones. */
function broken(notes: Note[], level: Level): string[] {
  const out: string[] = [];
  const onsets = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  for (const hand of ['right', 'left'] as const) {
    const mine = notes.filter((n) => n.hand === hand);
    const max = RULES.maxChord[level][hand];
    for (const t of onsets) {
      const now = sounding(mine, t);
      if (now.length > max) out.push(`${hand} plays ${now.length} notes at ${t.toFixed(2)}`);
      if (now.length > 1) {
        const span = Math.max(...now.map((n) => n.midi)) - Math.min(...now.map((n) => n.midi));
        if (span > RULES.span) out.push(`${hand} stretches ${span} at ${t.toFixed(2)}`);
      }
      if (!clearLow(now.map((n) => n.midi))) out.push(`${hand} plays a muddy low interval at ${t.toFixed(2)}`);
    }
    const byKey = new Map<number, number>();
    for (const n of [...mine].sort((a, b) => a.start - b.start)) {
      const last = byKey.get(n.midi);
      if (last !== undefined && n.start - last < RULES.repeatGap[level] - 1e-9) out.push(`${hand} repeats ${n.midi} after ${(n.start - last).toFixed(3)}s`);
      byKey.set(n.midi, n.start);
    }
    const starts = [...new Set(mine.map((n) => Math.round(n.start * 1000)))].sort((a, b) => a - b);
    for (let i = 0; i < starts.length; i++) {
      const inSecond = starts.filter((s) => s >= starts[i] && s < starts[i] + 1000).length;
      if (inSecond > RULES.rate[level][hand]) out.push(`${hand} plays ${inSecond} notes in a second at ${starts[i] / 1000}`);
    }
    if (mine.some((n) => n.dur < 0.05)) out.push(`${hand} has a note shorter than 50 ms`);
  }
  for (const t of onsets) {
    const now = sounding(notes, t);
    const left = now.filter((n) => n.hand === 'left').map((n) => n.midi);
    const right = now.filter((n) => n.hand === 'right').map((n) => n.midi);
    if (left.length && right.length && Math.max(...left) >= Math.min(...right)) out.push(`hands collide at ${t.toFixed(2)}`);
  }
  const tune = melodyOf(notes);
  if (tune.some((n) => n.midi < RULES.melodyRange.low || n.midi > RULES.melodyRange.high)) out.push('tune leaves the comfortable range');
  return out;
}

describe('arrangements are playable by human hands', () => {
  for (const level of LEVELS) {
    it(`keeps every rule at the ${level} level on messy input`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const { raw, beats, chords } = messySong(seed);
        const notes = arrange(raw, level, { beats, chords, beatsPerBar: 4 });
        expect(notes.length).toBeGreaterThan(10);
        expect(broken(notes, level)).toEqual([]);
      }
    });
  }

  it('also keeps the rules without beats or chords (older songs)', () => {
    const { raw } = messySong(9);
    for (const level of LEVELS) expect(broken(arrange(raw, level), level)).toEqual([]);
  });

  it('makes each level a real step up, on the same tune', () => {
    const { raw, beats, chords } = messySong(4);
    const at = (level: Level) => arrange(raw, level, { beats, chords });
    const left = (level: Level) => at(level).filter((n) => n.hand === 'left');
    expect(left('melody')).toHaveLength(0);
    // Bass only: one note at a time.
    expect(Math.max(...left('melody-bass').map((n) => sounding(left('melody-bass'), n.start).length))).toBe(1);
    expect(left('melody-chords').length).toBeGreaterThan(left('melody-bass').length);
    expect(left('full').length).toBeGreaterThan(left('melody-chords').length);
    // The easy levels share one tune; the fullest keeps nearly all of it.
    const tune = (level: Level) => melodyOf(at(level)).map((n) => `${n.midi}@${n.start.toFixed(3)}`);
    expect(tune('melody-bass')).toEqual(tune('melody'));
    expect(tune('melody-chords')).toEqual(tune('melody'));
    // The fullest level may keep a sixteenth where the easy ones round to an eighth.
    const full = melodyOf(at('full'));
    const easy = melodyOf(at('melody'));
    const kept = easy.filter((n) => full.some((m) => m.midi === n.midi && Math.abs(m.start - n.start) < 0.13)).length;
    expect(kept / easy.length).toBeGreaterThan(0.8);
  });

  it('plays the right bass note and chord tones for each chord', () => {
    const tune: RawNote[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ midi: 72, start: i * 0.5, dur: 0.4, amp: 0.9, part: 'melody' }));
    const beats = Array.from({ length: 9 }, (_, i) => i * 0.5);
    const chords: TimedChord[] = [
      { start: 0, dur: 2, label: 'Am' },
      { start: 2, dur: 2, label: 'F' },
    ];
    const bass = arrange(tune, 'melody-bass', { chords, beats }).filter((n) => n.hand === 'left');
    expect(bass.map((n) => n.midi % 12)).toEqual([9, 5]);
    const left = arrange(tune, 'melody-chords', { chords, beats }).filter((n) => n.hand === 'left');
    const am = left.filter((n) => n.start < 1.9).map((n) => n.midi % 12);
    const f = left.filter((n) => n.start >= 1.9).map((n) => n.midi % 12);
    expect(am.every((pc) => [9, 0, 4].includes(pc))).toBe(true);
    expect(am).toContain(0); // the third of A minor
    expect(f.every((pc) => [5, 9, 0].includes(pc))).toBe(true);
    expect(f).toContain(9); // the third of F
  });

  it('puts the bass of a slash chord in the bass, and keeps the third and seventh of a seventh chord', () => {
    const tune: RawNote[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ midi: 74, start: i * 0.5, dur: 0.4, amp: 0.9, part: 'melody' }));
    const beats = Array.from({ length: 9 }, (_, i) => i * 0.5);
    const left = arrange(tune, 'melody-chords', { beats, chords: [{ start: 0, dur: 2, label: 'G/B' }, { start: 2, dur: 2, label: 'G7' }] }).filter((n) => n.hand === 'left');
    const first = left.filter((n) => n.start < 1.9);
    expect(Math.min(...first.map((n) => n.midi)) % 12).toBe(11);
    const g7 = new Set(left.filter((n) => n.start >= 1.9).map((n) => n.midi % 12));
    expect(g7.has(11) && g7.has(5)).toBe(true); // B and F: the shell
  });

  it('plays root and fifth only for a chord whose third is unsure', () => {
    const tune: RawNote[] = [0, 1, 2, 3].map((i) => ({ midi: 72, start: i * 0.5, dur: 0.4, amp: 0.9, part: 'melody' }));
    const beats = Array.from({ length: 9 }, (_, i) => i * 0.5);
    for (const level of ['melody-chords', 'full'] as const) {
      const notes = arrange(tune, level, { beats, chords: [{ start: 0, dur: 2, label: 'C5' }] }).filter((n) => !melodyOf(arrange(tune, level, { beats })).some((m) => m.start === n.start && m.midi === n.midi));
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => [0, 7].includes(n.midi % 12))).toBe(true);
    }
  });

  it('never puts a third or a chord low in the bass, and keeps the left hand under a low tune', () => {
    const beats = Array.from({ length: 33 }, (_, i) => i * 0.5);
    const tune: RawNote[] = beats.slice(0, 32).map((t, i) => ({ midi: 57 + (i % 5), start: t, dur: 0.45, amp: 0.9, part: 'melody' }));
    const chords: TimedChord[] = ['D', 'Bb', 'F', 'C', 'Gm', 'A7', 'Dm', 'Eb'].map((label, i) => ({ start: i * 2, dur: 2, label }));
    for (const level of ['melody-chords', 'full'] as const) {
      const notes = arrange(tune, level, { beats, chords });
      const left = notes.filter((n) => n.hand === 'left');
      for (const n of left) {
        const together = sounding(left, n.start).map((x) => x.midi);
        expect(clearLow(together)).toBe(true);
      }
      expect(broken(notes, level)).toEqual([]);
    }
    expect(LOW_LIMIT[3]).toBe(48);
  });

  it('moves a tune sung too low or too high into a comfortable octave', () => {
    const low = fitRange([40, 43, 45, 47].map((midi, i) => ({ midi, start: i, dur: 0.5, hand: 'right' as const })), 55, 86, 67);
    expect(low.map((n) => n.midi)).toEqual([64, 67, 69, 71]);
    const high = fitRange([96, 98, 100].map((midi, i) => ({ midi, start: i, dur: 0.5, hand: 'right' as const })), 55, 86, 67);
    expect(high.every((n) => n.midi >= 55 && n.midi <= 86)).toBe(true);
  });

  it('puts the tune on an eighth-note grid at the easy levels, keeping off-beat notes off the beat', () => {
    const beats = Array.from({ length: 17 }, (_, i) => i * 0.6);
    // Syncopated: on the beat, on the "and", on the beat, slightly early and late.
    const starts = [0.02, 0.88, 1.21, 2.37, 3.04, 4.5];
    const tune: RawNote[] = starts.map((start, i) => ({ midi: 67 + i, start, dur: 0.25, amp: 0.9, part: 'melody' }));
    const out = arrange(tune, 'melody', { beats });
    expect(out.map((n) => +n.start.toFixed(2))).toEqual([0, 0.9, 1.2, 2.4, 3, 4.5]);
  });

  it('snaps notes gently towards the beat, never far from the recording', () => {
    const notes: Note[] = [0.03, 0.46, 0.8, 1.2].map((start) => ({ midi: 60, start, dur: 0.3, hand: 'right' }));
    const snapped = snap(notes, [0, 0.5, 1, 1.5], 0.07);
    expect(snapped.map((n) => +n.start.toFixed(3))).toEqual([0, 0.5, 0.87, 1.13]);
  });

  it('thins out notes that come faster than the level allows, keeping notes on the beat', () => {
    const notes: Note[] = Array.from({ length: 20 }, (_, i) => ({ midi: 60 + (i % 5), start: i * 0.1, dur: 0.08, hand: 'right' }));
    const kept = limitRate(notes, 4, (t) => Math.abs(t - Math.round(t * 2) / 2) < 0.01);
    for (const n of kept) expect(kept.filter((m) => m.start >= n.start && m.start < n.start + 1).length).toBeLessThanOrEqual(4);
    expect(kept.some((n) => n.start === 0.5)).toBe(true);
  });

  it('ignores broken input safely', () => {
    const bad: RawNote[] = [
      { midi: 60, start: Number.NaN, dur: 1, amp: 1 },
      { midi: 200, start: 1, dur: 1, amp: 1 },
      { midi: 62, start: 2, dur: -1, amp: 1 },
    ];
    for (const level of LEVELS) expect(() => arrange(bad, level)).not.toThrow();
    expect(arrange([], 'full')).toEqual([]);
    expect(() => arrange(messySong(2).raw, 'full', { chords: [{ start: 0, dur: 4, label: 'H#m' }], beats: [1, 1, 1, 1, 1] })).not.toThrow();
  });
});

// The whole chain on band songs with a known score: chords found from the
// notes (as when an older song is re-arranged), then every level measured the
// way a teacher would mark it. Fast: no audio, no note model.
describe('arranging songs with a known score', () => {
  for (const song of BAND_SONGS) {
    it(`arranges ${song.name} like a pianist would`, () => {
      const score = bandScore(song);
      const beats = score.beats;
      const harmony = findHarmony(
        score.raw.filter((n) => !n.part),
        beats,
        { beatsPerBar: song.beatsPerBar, melody: score.raw.filter((n) => n.part === 'melody') },
      );
      const context = { beats, chords: harmony.chords, beatsPerBar: song.beatsPerBar };
      const beat = 60 / song.bpm;
      const left = { 'melody-bass': 0, 'melody-chords': 0, full: 0 };
      for (const level of LEVELS) {
        const notes = arrange(score.raw, level, context);
        const m = measure(notes, score.chords, beat);
        expect(broken(notes, level)).toEqual([]);
        expect(m.lowIntervalViolations).toBe(0);
        expect(m.lowClusters).toBe(0);
        expect(m.crossings).toBe(0);
        expect(m.masked).toBe(0);
        expect(m.nonChordTone).toBeLessThanOrEqual(0.05);
        expect(m.bigJumps).toBeLessThanOrEqual(1);
        if (level !== 'melody') left[level] = m.rate.left;
        if (level === 'melody-chords') {
          expect(m.voiceLeading).toBeLessThanOrEqual(3);
          expect(m.reach.left).toBeLessThanOrEqual(12);
        }
      }
      expect(left['melody-bass']).toBeGreaterThan(0.2);
      expect(left['melody-bass']).toBeLessThan(left['melody-chords']);
      expect(left['melody-chords']).toBeLessThan(left.full);
      expect(left.full).toBeLessThanOrEqual(4);
    });
  }
});
