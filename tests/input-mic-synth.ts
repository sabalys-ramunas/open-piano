import { NoteTracker, midiToHz, type NoteEvent } from '../src/input/pitch';

/** Synthetic piano-like sound for testing the microphone detector. */

export interface ToneSpec {
  midi: number;
  start: number;
  dur: number;
  /** 0..1 loudness. */
  vel?: number;
}

/** Deterministic random numbers. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * A rough piano: stretched (inharmonic) partials from two slightly detuned
 * strings, falling amplitude with harmonic number, a weak fundamental in the
 * bass, faster decay for higher partials and higher notes, a hammer thump,
 * and a damper release.
 */
export function renderPiano(notes: readonly ToneSpec[], seconds: number, sampleRate = 44100, seed = 1): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const random = rng(seed);
  for (const note of notes) {
    const f0 = midiToHz(note.midi);
    const vel = note.vel ?? 0.7;
    const amp = 0.25 * vel * vel + 0.03;
    const B = Math.min(0.004, Math.max(0.00008, 0.00025 * 2 ** ((note.midi - 60) / 18)));
    const tau0 = Math.max(0.4, 3.2 - ((note.midi - 21) / 87) * 2.8);
    const startI = Math.round(note.start * sampleRate);
    const endI = Math.round((note.start + note.dur) * sampleRate);
    const tail = Math.round(0.25 * sampleRate);
    const partials: { f: number; a: number; tau: number; phase: number }[] = [];
    for (let h = 1; h <= 24; h++) {
      const f = h * f0 * Math.sqrt(1 + B * h * h);
      if (f > 9000) break;
      let a = 1 / h ** 1.1;
      if (f0 < 110 && h === 1) a *= f0 / 110; // weak fundamental in the bass
      if (f0 < 70 && h === 2) a *= 0.6;
      a *= 0.7 + 0.6 * random();
      a *= 0.6 + 0.4 * vel; // harder playing is brighter
      if (h > 1) a *= 0.5 + 0.5 * vel;
      const tau = tau0 / (1 + 0.18 * h);
      // The hammer strikes both strings at once, so they start in phase and drift apart slowly (beating).
      const phase = random() * Math.PI * 2;
      for (const cents of [-0.8, 0.8]) {
        partials.push({ f: f * 2 ** (cents / 1200), a: a / 2, tau, phase });
      }
    }
    for (let i = startI; i < Math.min(out.length, endI + tail); i++) {
      const t = (i - startI) / sampleRate;
      const attack = Math.min(1, t / 0.003);
      const release = i > endI ? Math.exp(-((i - endI) / sampleRate) / 0.05) : 1;
      let x = 0;
      for (const p of partials) x += p.a * Math.exp(-t / p.tau) * Math.sin(2 * Math.PI * p.f * t + p.phase);
      out[i] += amp * attack * release * x;
    }
    // Hammer thump: 8 ms of filtered noise.
    let low = 0;
    for (let i = startI; i < Math.min(out.length, startI + Math.round(0.008 * sampleRate)); i++) {
      low = 0.7 * low + 0.3 * (random() * 2 - 1);
      out[i] += amp * 0.4 * low * (1 - (i - startI) / (0.008 * sampleRate));
    }
  }
  return out;
}

/** Adds pink-ish noise at an RMS level. */
export function addNoise(signal: Float32Array, rms: number, seed = 9): Float32Array {
  const random = rng(seed);
  const out = Float32Array.from(signal);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const raw = new Float32Array(signal.length);
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    raw[i] = b0 + b1 + b2 + w * 0.1848;
    sum += raw[i] * raw[i];
  }
  const scale = rms / Math.sqrt(sum / raw.length || 1);
  for (let i = 0; i < out.length; i++) out[i] += raw[i] * scale;
  return out;
}

export function rmsOf(signal: Float32Array, from = 0, to = signal.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += signal[i] * signal[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Runs the tracker over a signal in 128-sample blocks, as an AudioWorklet would deliver it. */
export function track(
  signal: Float32Array,
  options: { sampleRate?: number; sensitivity?: number; isAppSounding?: (midi: number, time: number) => boolean } = {},
): NoteEvent[] {
  const sampleRate = options.sampleRate ?? 44100;
  let now = 0;
  const appSounding = options.isAppSounding;
  const tracker = new NoteTracker({
    sampleRate,
    sensitivity: options.sensitivity,
    isAppSounding: appSounding ? (midi) => appSounding(midi, now) : undefined,
  });
  const events: NoteEvent[] = [];
  for (let i = 0; i < signal.length; i += 128) {
    now = i / sampleRate;
    events.push(...tracker.push(signal.subarray(i, Math.min(signal.length, i + 128))));
  }
  events.push(...tracker.flush());
  return events;
}

export interface Score {
  notes: number;
  found: number;
  onEvents: number;
  correctOn: number;
  recall: number;
  precision: number;
  /** Mean delay from a note's start to its detection, seconds. */
  latency: number;
}

/**
 * A note counts as found when an "on" event with its exact pitch comes within
 * `tolerance` seconds after it starts (or 20 ms before). Every other "on"
 * event is a mistake.
 */
export function score(truth: readonly ToneSpec[], events: readonly NoteEvent[], tolerance = 0.15): Score {
  const ons = events.filter((e) => e.type === 'on');
  const used = new Set<number>();
  let found = 0;
  let delay = 0;
  for (const note of truth) {
    const i = ons.findIndex(
      (e, j) => !used.has(j) && e.midi === note.midi && e.time >= note.start - 0.02 && e.time <= note.start + tolerance,
    );
    if (i >= 0) {
      used.add(i);
      found++;
      delay += ons[i].time - note.start;
    }
  }
  return {
    notes: truth.length,
    found,
    onEvents: ons.length,
    correctOn: used.size,
    recall: truth.length ? found / truth.length : 1,
    precision: ons.length ? used.size / ons.length : 1,
    latency: found ? delay / found : 0,
  };
}

/** A simple room (four comb filters and two all-pass filters), about `seconds` of echo. */
export function addRoom(signal: Float32Array, sampleRate = 44100, seconds = 1, mix = 0.35): Float32Array {
  const out = new Float32Array(signal.length);
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round((d * sampleRate) / 44100));
  for (const d of combs) {
    const g = Math.pow(10, (-3 * d) / sampleRate / seconds);
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < signal.length; i++) {
      const y = buf[idx];
      buf[idx] = signal[i] + y * g;
      idx = (idx + 1) % d;
      out[i] += y / combs.length;
    }
  }
  let wet = out;
  for (const d of [225, 556].map((x) => Math.round((x * sampleRate) / 44100))) {
    const next = new Float32Array(signal.length);
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < signal.length; i++) {
      const b = buf[idx];
      const y = -0.5 * wet[i] + b;
      buf[idx] = wet[i] + 0.5 * y;
      idx = (idx + 1) % d;
      next[i] = y;
    }
    wet = next;
  }
  const mixed = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) mixed[i] = signal[i] + mix * wet[i];
  return mixed;
}
