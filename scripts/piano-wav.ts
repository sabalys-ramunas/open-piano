// A small offline piano-like synth for listening to arrangements later. It
// only writes WAV files; it never plays anything.
import { writeFileSync } from 'node:fs';

export interface PlayedNote {
  midi: number;
  start: number;
  dur: number;
  hand?: 'left' | 'right';
}

/**
 * Renders notes as a soft piano-like tone: a few inharmonic partials with a
 * fast attack, a two-stage decay (bright then warm) and a short release, a
 * little quieter for the left hand so the tune stays on top.
 */
export function renderPiano(notes: readonly PlayedNote[], rate = 44100, tail = 1.5): Float32Array {
  const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0) + tail;
  const out = new Float32Array(Math.ceil(end * rate));
  for (const n of notes) {
    const f = 440 * 2 ** ((n.midi - 69) / 12);
    const from = Math.floor(n.start * rate);
    const ring = n.dur + 0.35;
    const count = Math.floor(ring * rate);
    const gain = (n.hand === 'left' ? 0.14 : 0.2) * (n.midi < 48 ? 1.2 : 1);
    const b = 0.0004 * (n.midi < 60 ? 1 : 0.5); // string stiffness
    const partials = Array.from({ length: 8 }, (_, k) => {
      const h = k + 1;
      return { f: f * h * Math.sqrt(1 + b * h * h), a: 1 / h ** 1.3, d: 1.2 + h * 0.6 + f / 400 };
    }).filter((p) => p.f < rate / 2.2);
    for (let i = 0; i < count && from + i < out.length; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / 0.004);
      const release = t > n.dur ? Math.exp(-(t - n.dur) * 14) : 1;
      let s = 0;
      for (const p of partials) s += p.a * Math.sin(2 * Math.PI * p.f * t) * (0.6 * Math.exp(-t * p.d) + 0.4 * Math.exp(-t * p.d * 0.15));
      out[from + i] += s * attack * release * gain;
    }
  }
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  if (peak > 0.9) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  return out;
}

/** 16-bit mono PCM WAV bytes. */
export function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32000), 44 + i * 2);
  return new Uint8Array(buf);
}

/** Renders notes to a WAV file at `path`. */
export function writePianoWav(path: string, notes: readonly PlayedNote[], rate = 44100): void {
  writeFileSync(path, wavBytes(renderPiano(notes, rate), rate));
}
