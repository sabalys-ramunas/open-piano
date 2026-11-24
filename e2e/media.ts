import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A temporary folder for files the tests make on the fly. */
const TEMP = join(process.env.E2E_TEMP ?? join(tmpdir(), 'piano-e2e'), String(process.pid));
mkdirSync(TEMP, { recursive: true });

export function writeTemp(name: string, data: string | Uint8Array): string {
  const path = join(TEMP, name);
  writeFileSync(path, data);
  return path;
}

/** A lesson file (format piano-lesson v1) playing the given keys one after another with the right hand. */
export function lessonJson(title: string, keys: readonly number[], step = 0.5, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'piano-lesson',
    version: 1,
    title,
    by: 'Test Suite',
    notes: keys.map((midi, i) => [midi, i * step, step * 0.9, 0]),
    ...extra,
  });
}

/** 16-bit mono PCM WAV. */
export function wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32000), 44 + i * 2);
  return new Uint8Array(buf);
}

/**
 * Renders a melody as a piano-like tone (a few decaying harmonics) into a WAV file.
 * notes: [midi, startSeconds, durationSeconds].
 */
export function renderMelody(notes: readonly (readonly [number, number, number])[], sampleRate = 22050, tail = 1): Uint8Array {
  const end = Math.max(...notes.map(([, s, d]) => s + d)) + tail;
  const out = new Float32Array(Math.ceil(end * sampleRate));
  for (const [midi, start, dur] of notes) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const i0 = Math.floor(start * sampleRate);
    const len = Math.floor((dur + 0.25) * sampleRate);
    for (let i = 0; i < len && i0 + i < out.length; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 2.2) * (t > dur ? Math.exp(-(t - dur) * 25) : 1);
      let v = 0;
      for (let k = 1; k <= 4; k++) v += Math.sin(2 * Math.PI * f * k * t) / (k * k);
      out[i0 + i] += 0.3 * env * v;
    }
  }
  return wav(out, sampleRate);
}

/**
 * A short "band" recording made at test time for the song splitter: a tune, held chords, a bass
 * line and a simple drum beat (C G Am F at 100 bpm), stereo WAV. Deterministic.
 */
export function renderBand(seconds = 13, sampleRate = 44100): Uint8Array {
  const n = Math.ceil(seconds * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const beat = 0.6;
  const chords = [
    [48, [60, 64, 67]],
    [43, [59, 62, 67]],
    [45, [60, 64, 69]],
    [41, [60, 65, 69]],
  ] as const;
  const tone = (midi: number, start: number, dur: number, gain: number, pan: number, harmonics: number) => {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const i0 = Math.floor(start * sampleRate);
    for (let i = 0; i < Math.floor((dur + 0.2) * sampleRate) && i0 + i < n; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 1.5) * (t > dur ? Math.exp(-(t - dur) * 20) : 1);
      let v = 0;
      for (let k = 1; k <= harmonics; k++) v += Math.sin(2 * Math.PI * f * k * t) / k;
      left[i0 + i] += v * env * gain * (1 - pan);
      right[i0 + i] += v * env * gain * (1 + pan);
    }
  };
  let seed = 7;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  for (let bar = 0; bar * 4 * beat < seconds; bar++) {
    const t0 = bar * 4 * beat;
    const [root, notes] = chords[bar % 4];
    for (const m of notes) tone(m, t0, 4 * beat * 0.95, 0.05, -0.4, 6);
    tone(root - 12, t0, 2 * beat, 0.18, 0, 2);
    tone(root - 12, t0 + 2 * beat, 2 * beat, 0.18, 0, 2);
    for (let b = 0; b < 4; b++) tone(notes[b % 3] + 12, t0 + b * beat, beat * 0.9, 0.06, 0.1, 3);
    for (let b = 0; b < 8; b++) {
      const at = Math.floor((t0 + (b * beat) / 2) * sampleRate);
      const kick = b % 4 === 0;
      for (let i = 0; i < 0.12 * sampleRate && at + i < n; i++) {
        const t = i / sampleRate;
        const s = kick ? Math.sin(2 * Math.PI * (50 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18) * 0.4 : noise() * Math.exp(-t * 60) * 0.08;
        left[at + i] += s;
        right[at + i] += s;
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round((left[i] / peak) * 0.8 * 32000), 44 + i * 4);
    buf.writeInt16LE(Math.round((right[i] / peak) * 0.8 * 32000), 46 + i * 4);
  }
  return new Uint8Array(buf);
}
