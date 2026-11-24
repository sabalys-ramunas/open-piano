import { describe, expect, it } from 'vitest';
import { fft, NoteTracker } from '../src/input/pitch';
import { addNoise, addRoom, renderPiano, rng, score, track, type Score, type ToneSpec } from './input-mic-synth';

/**
 * Measures the microphone note detector on synthetic piano-like sound. The
 * numbers are printed so they can be reported as they are; the assertions
 * only guard against getting worse than what was measured when written.
 */

const SR = 44100;
const results: { name: string; s: Score }[] = [];

/** Floors (recall, precision) a little under what was measured, so a change that makes things worse fails. */
const FLOOR: Record<string, [number, number]> = {
  'single notes C2-C7': [0.95, 0.95],
  'single notes, lowest': [0.9, 0.8],
  'single notes, soft': [0.95, 0.95],
  'single notes, loud': [0.95, 0.95],
  'melody with repeated': [0.9, 0.9],
  'fast scale': [0.9, 0.9],
  'melody in an echoing': [0.9, 0.9],
  'melody at 48': [0.9, 0.9],
  'held out: 60': [0.9, 0.9],
  'held out: 20': [0.9, 0.85],
  octaves: [0.4, 0.6],
  'two-note': [0.9, 0.9],
  'three-note': [0.9, 0.85],
  'single notes + pink': [0.95, 0.95],
  'melody while the app': [0.85, 0.5],
};

function run(
  name: string,
  notes: ToneSpec[],
  seconds: number,
  opts: { noise?: number; app?: ToneSpec[]; room?: boolean; sampleRate?: number } = {},
): Score {
  const sr = opts.sampleRate ?? SR;
  let signal = renderPiano(notes, seconds, sr, 3);
  if (opts.app) {
    const app = renderPiano(opts.app, seconds, sr, 5);
    for (let i = 0; i < signal.length; i++) signal[i] += app[i];
  }
  if (opts.room) signal = addRoom(signal, sr);
  if (opts.noise) signal = addNoise(signal, opts.noise);
  const app = opts.app;
  const events = track(signal, {
    sampleRate: sr,
    isAppSounding: app
      ? (midi, t) => app.some((n) => n.midi === midi && t >= n.start - 0.05 && t <= n.start + n.dur + 0.4)
      : undefined,
  });
  const s = score(notes, events);
  results.push({ name, s });
  const floor = Object.entries(FLOOR).find(([prefix]) => name.startsWith(prefix))?.[1];
  if (floor) {
    expect(s.recall, `${name}: notes found`).toBeGreaterThanOrEqual(floor[0]);
    expect(s.precision, `${name}: reported notes that were right`).toBeGreaterThanOrEqual(floor[1]);
  }
  return s;
}

function singles(midis: number[], dur = 0.5, gap = 0.25, vel = 0.7): { notes: ToneSpec[]; seconds: number } {
  const notes = midis.map((midi, i) => ({ midi, start: 0.3 + i * (dur + gap), dur, vel }));
  return { notes, seconds: 0.3 + midis.length * (dur + gap) + 0.5 };
}

function chords(groups: number[][], dur = 0.8, gap = 0.3): { notes: ToneSpec[]; seconds: number } {
  const notes: ToneSpec[] = [];
  groups.forEach((g, i) => g.forEach((midi) => notes.push({ midi, start: 0.3 + i * (dur + gap), dur, vel: 0.7 })));
  return { notes, seconds: 0.3 + groups.length * (dur + gap) + 0.5 };
}

describe('FFT', () => {
  it('finds a sine wave in the right bin', () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 50 * i) / n);
    fft(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(50);
    expect(mags[50]).toBeCloseTo(n / 2, 3);
  });
});

describe('microphone note detection (synthetic piano)', () => {
  it('single notes across the keyboard, C2 to C7', () => {
    const midis: number[] = [];
    for (let m = 36; m <= 96; m += 2) midis.push(m);
    const { notes, seconds } = singles(midis);
    run('single notes C2-C7 (every 2nd key)', notes, seconds);
  });

  it('single notes in the extreme bass and treble', () => {
    const { notes, seconds } = singles([28, 30, 31, 33, 34, 97, 99, 100, 102, 104]);
    run('single notes, lowest and highest keys', notes, seconds);
  });

  it('soft and loud single notes', () => {
    const { notes, seconds } = singles([60, 64, 67, 72, 55, 48], 0.5, 0.25, 0.25);
    run('single notes, soft (velocity 0.25)', notes, seconds);
    const loud = singles([60, 64, 67, 72, 55, 48], 0.5, 0.25, 1);
    run('single notes, loud (velocity 1)', loud.notes, loud.seconds);
  });

  it('a melody with repeated notes', () => {
    // Twinkle twinkle: C C G G A A G, F F E E D D C
    const tune = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
    const notes = tune.map((midi, i) => ({ midi, start: 0.3 + i * 0.4, dur: 0.36, vel: 0.65 }));
    run('melody with repeated notes (0.4 s each)', notes, 0.3 + tune.length * 0.4 + 0.5);
  });

  it('fast passage: scale in sixteenths at 120 bpm', () => {
    const scale = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 83, 81, 79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60];
    const notes = scale.map((midi, i) => ({ midi, start: 0.3 + i * 0.125, dur: 0.14, vel: 0.65 }));
    run('fast scale, 8 notes per second', notes, 0.3 + scale.length * 0.125 + 0.5);
  });

  it('a melody in an echoing room', () => {
    const tune = [60, 62, 64, 60, 64, 65, 67, 67, 65, 64, 62, 60, 55, 60];
    const notes = tune.map((midi, i) => ({ midi, start: 0.3 + i * 0.35, dur: 0.33, vel: 0.65 }));
    run('melody in an echoing room (about 1 s of echo)', notes, 0.3 + tune.length * 0.35 + 1, { room: true });
  });

  it('works at 48 kHz too', () => {
    const tune = [60, 64, 67, 72, 71, 67, 64, 62, 60, 48, 84];
    const notes = tune.map((midi, i) => ({ midi, start: 0.3 + i * 0.5, dur: 0.45, vel: 0.65 }));
    run('melody at 48 kHz', notes, 0.3 + tune.length * 0.5 + 0.5, { sampleRate: 48000 });
  });

  // Held out: these random cases were added after tuning and never tuned against.
  it('held out: random melodies', () => {
    const random = rng(77);
    const notes: ToneSpec[] = [];
    let t = 0.3;
    for (let i = 0; i < 60; i++) {
      const dur = 0.15 + random() * 0.5;
      notes.push({ midi: 48 + Math.floor(random() * 37), start: t, dur: dur * 0.9, vel: 0.3 + random() * 0.6 });
      t += dur;
    }
    run('held out: 60 random notes C3-C6, random length/loudness', notes, t + 0.5, { noise: 0.002 });
  });

  it('held out: random two-note chords', () => {
    const random = rng(91);
    const groups: number[][] = [];
    for (let i = 0; i < 20; i++) {
      const a = 50 + Math.floor(random() * 25);
      groups.push([a, a + 3 + Math.floor(random() * 6)]);
    }
    const { notes, seconds } = chords(groups);
    run('held out: 20 random two-note chords', notes, seconds);
  });

  it('octaves', () => {
    const { notes, seconds } = chords([
      [48, 60],
      [52, 64],
      [55, 67],
      [60, 72],
      [57, 69],
      [53, 65],
    ]);
    run('octaves (two notes 12 apart)', notes, seconds);
  });

  it('two-note chords', () => {
    const { notes, seconds } = chords([
      [60, 64],
      [62, 65],
      [64, 67],
      [60, 67],
      [55, 60],
      [65, 69],
      [48, 55],
      [67, 71],
      [57, 64],
      [72, 76],
    ]);
    run('two-note chords (thirds, fifths, fourths)', notes, seconds);
  });

  it('three-note chords', () => {
    const { notes, seconds } = chords([
      [60, 64, 67],
      [65, 69, 72],
      [67, 71, 74],
      [57, 60, 64],
      [62, 65, 69],
      [55, 59, 62],
      [48, 52, 55],
      [64, 67, 71],
    ]);
    run('three-note chords (triads)', notes, seconds);
  });

  it('single notes with room noise (about 20 dB below the playing)', () => {
    const { notes, seconds } = singles([60, 62, 64, 65, 67, 69, 71, 72, 48, 52, 55, 76, 79, 84]);
    run('single notes + pink noise, SNR about 20 dB', notes, seconds, { noise: 0.004 });
  });

  it('noise alone produces (almost) nothing', () => {
    const quiet = addNoise(new Float32Array(SR * 10), 0.003);
    const loud = addNoise(new Float32Array(SR * 10), 0.02, 11);
    const a = track(quiet).filter((e) => e.type === 'on').length;
    const b = track(loud).filter((e) => e.type === 'on').length;
    results.push({ name: `noise only, 10 s quiet: ${a} false notes; 10 s loud: ${b} false notes`, s: score([], []) });
    expect(a).toBeLessThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(3);
  });

  it('ignores the app\'s own notes coming out of the speakers', () => {
    // The app plays the left hand (C3 E3 G3...) while the player plays a melody.
    const app = [48, 52, 55, 52, 48, 52, 55, 52].map((midi, i) => ({ midi, start: 0.3 + i * 0.5, dur: 0.45, vel: 0.6 }));
    const player = [64, 65, 67, 69, 67, 65, 64, 62].map((midi, i) => ({ midi, start: 0.3 + i * 0.5, dur: 0.45, vel: 0.7 }));
    run('melody while the app plays the other hand', player, 4.8, { app });
  });

  it('prints the measured accuracy', () => {
    const lines = results.map(({ name, s }) =>
      s.notes
        ? `${name.padEnd(48)} found ${String(s.found).padStart(3)}/${String(s.notes).padEnd(3)} (${(s.recall * 100).toFixed(0)}%)  correct ${(s.precision * 100).toFixed(0)}% of ${s.onEvents} reported  delay ${(s.latency * 1000).toFixed(0)} ms`
        : name,
    );
    console.log(`Microphone detector, synthetic piano:\n${lines.join('\n')}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('tracker reports nothing for silence', () => {
    const t = new NoteTracker({ sampleRate: SR });
    expect(t.push(new Float32Array(SR))).toEqual([]);
  });
});
