import { describe, expect, it } from 'vitest';
import { analyseSync, chordNotes, findKey, onsetEnvelope, trackBeats } from '../src/analysis';
import { decodeNotes } from '../src/import/notes';
import { RATE, TUNES, listen, renderMix } from './helpers';

const audioOf = (mono: Float32Array) => ({
  sampleRate: RATE,
  length: mono.length,
  numberOfChannels: 1,
  getChannelData: () => mono,
});

/** Fraction of true beats with a found beat within 70 ms, and the reverse. */
function beatScore(truth: number[], found: number[]) {
  const near = (a: number[], b: number[]) => a.filter((t) => b.some((f) => Math.abs(f - t) < 0.07)).length / a.length;
  return { recall: near(truth, found), precision: near(found, truth) };
}

/** Fraction of the time the found chord label equals the true one. */
function chordScore(truth: { start: number; dur: number; label: string }[], found: { start: number; dur: number; label: string }[]) {
  const at = (list: typeof truth, t: number) => list.find((c) => t >= c.start && t < c.start + c.dur)?.label;
  const same = (a?: string, b?: string) => {
    const x = a && chordNotes(a);
    const y = b && chordNotes(b);
    return !!x && !!y && x.root === y.root && x.minor === y.minor;
  };
  let hit = 0;
  let all = 0;
  const end = Math.max(...truth.map((c) => c.start + c.dur));
  for (let t = 0.05; t < end; t += 0.05) {
    all++;
    if (same(at(truth, t), at(found, t))) hit++;
  }
  return hit / all;
}

describe('song analysis on synthetic band recordings', () => {
  for (const tune of TUNES) {
    it(`finds tempo, beats, metre, key and chords of ${tune.name}`, { timeout: 60_000 }, async () => {
      const mix = renderMix(tune, { seed: 3 });
      const raw = decodeNotes(await listen(mix.mono));
      const a = analyseSync(raw, audioOf(mix.mono));
      const beats = beatScore(mix.beats.slice(1), a.beats ?? []);
      const chords = chordScore(mix.chords, a.chords ?? []);
      console.log(
        `${tune.name}: bpm ${a.bpm} (true ${tune.bpm}), beats recall ${beats.recall.toFixed(2)} precision ${beats.precision.toFixed(2)}, ` +
          `metre ${a.timeSignature?.beats}/4 (true ${tune.beatsPerBar}/4), key ${a.key}, chords right ${(chords * 100).toFixed(0)}% of the time`,
      );
      expect(Math.abs((a.bpm ?? 0) - tune.bpm)).toBeLessThanOrEqual(2);
      expect(beats.recall).toBeGreaterThan(0.9);
      expect(beats.precision).toBeGreaterThan(0.9);
      expect(a.timeSignature?.beats).toBe(tune.beatsPerBar);
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const flat: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
      const keyRoot = a.key!.replace('m', '');
      expect(names.indexOf(flat[keyRoot] ?? keyRoot)).toBe(tune.key.tonic);
      expect(a.key!.endsWith('m')).toBe(tune.key.minor);
      expect(chords).toBeGreaterThan(0.75);
    });
  }
});

describe('beat tracking', () => {
  it('follows a tempo that speeds up from 96 to 116 bpm', () => {
    const seconds = 40;
    const audio = new Float32Array(seconds * RATE);
    const truth: number[] = [];
    let t = 0.5;
    while (t < seconds - 0.5) {
      truth.push(t);
      const bpm = 96 + (20 * t) / seconds;
      t += 60 / bpm;
    }
    let seed = 1;
    for (const b of truth) {
      const at = Math.floor(b * RATE);
      for (let i = 0; i < 0.08 * RATE; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        audio[at + i] += ((seed / 2 ** 32) * 2 - 1) * Math.exp(-i / (0.01 * RATE)) * 0.5;
        audio[at + i] += Math.sin((2 * Math.PI * 60 * i) / RATE) * Math.exp(-i / (0.03 * RATE)) * 0.5;
      }
    }
    const env = onsetEnvelope(audio, RATE);
    const found = trackBeats(env.values, env.fps);
    const s = beatScore(truth, found);
    console.log(`drifting tempo: beats recall ${s.recall.toFixed(2)}, precision ${s.precision.toFixed(2)}`);
    expect(s.recall).toBeGreaterThan(0.9);
    expect(s.precision).toBeGreaterThan(0.9);
  });

  it('never throws and returns nothing useful for silence or tiny input', () => {
    expect(analyseSync([], audioOf(new Float32Array(RATE)))).toEqual({});
    expect(analyseSync([{ midi: 60, start: 0, dur: 0.5, amp: 1 }])).toEqual({});
    const silent = analyseSync([], audioOf(new Float32Array(RATE * 10)));
    expect(silent.chords ?? []).toEqual([]);
  });

  it('finds the key from pitch weights', () => {
    const cMajor = [5, 0, 3, 0, 4, 3, 0, 5, 0, 3, 0, 2];
    expect(findKey(cMajor)).toEqual({ tonic: 0, minor: false });
    const aMinor = [3, 0, 2, 1, 4, 2, 0, 1, 1, 5, 0, 2];
    expect(findKey(aMinor)).toEqual({ tonic: 9, minor: true });
  });
});

describe('chord labels', () => {
  it('joins beats with the same chord into one', async () => {
    const { findHarmony } = await import('../src/analysis');
    const beats = Array.from({ length: 8 }, (_, i) => i * 0.437);
    const notes = [48, 52, 55, 60, 64, 67].flatMap((midi) => beats.map((start) => ({ midi, start, dur: 0.4, amp: 0.7 })));
    const { chords } = findHarmony(notes, beats, { beatsPerBar: 4 });
    expect(chords).toHaveLength(1);
    expect(chords[0].label).toBe('C');
    expect(chords[0].dur).toBeCloseTo(3.496, 3);
  });
});
