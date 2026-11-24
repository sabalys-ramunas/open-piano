// Turns the network's per-frame activations into notes. A port of basic-pitch's
// outputToNotesPoly (Apache-2.0) to flat typed arrays. The original's second
// pass searched the whole matrix for its maximum once per note, which takes
// minutes on a long song; here candidates are sorted once instead. Values in
// the energy matrix only ever drop to zero, so walking them in descending order
// and skipping zeroed cells visits exactly the same maxima.
import type { RawNote } from '../song';
import { type Activations, KEYS, MIDI_OFFSET, frameTime } from './model';

export interface DecodeOptions {
  onsetThreshold?: number;
  frameThreshold?: number;
  /** Shortest note in frames. */
  minFrames?: number;
  /** Frames a note may dip below the threshold and still continue. */
  tolerance?: number;
  /** Only keep notes from this frame (inclusive) to this frame (exclusive). */
  from?: number;
  to?: number;
}

export function decodeNotes(act: Activations, options: DecodeOptions = {}): RawNote[] {
  const onsetThreshold = options.onsetThreshold ?? 0.5;
  const frameThreshold = options.frameThreshold ?? 0.3;
  const minFrames = options.minFrames ?? 5;
  const tolerance = options.tolerance ?? 11;
  const from = Math.max(0, options.from ?? 0);
  const to = Math.min(act.frameCount, options.to ?? act.frameCount);
  const n = to - from;
  if (n <= 2) return [];
  const frames = act.frames.subarray(from * KEYS, to * KEYS);
  const onsets = act.onsets.subarray(from * KEYS, to * KEYS);

  // Onsets, plus sudden rises in the frame activations.
  let onsetMax = 0;
  for (let i = 0; i < onsets.length; i++) if (onsets[i] > onsetMax) onsetMax = onsets[i];
  const rise = new Float32Array(n * KEYS);
  let riseMax = 0;
  for (let t = 2; t < n; t++) {
    for (let k = 0; k < KEYS; k++) {
      const v = frames[t * KEYS + k];
      const d = Math.max(0, Math.min(v - frames[(t - 1) * KEYS + k], v - frames[(t - 2) * KEYS + k]));
      rise[t * KEYS + k] = d;
      if (d > riseMax) riseMax = d;
    }
  }
  // Frames 0 and 1 compare with silence before the start.
  for (let t = 0; t < Math.min(2, n); t++) for (let k = 0; k < KEYS; k++) rise[t * KEYS + k] = 0;
  const scale = riseMax > 0 ? onsetMax / riseMax : 0;
  const strike = new Float32Array(n * KEYS);
  for (let i = 0; i < strike.length; i++) strike[i] = Math.max(onsets[i], rise[i] * scale);

  const energy = new Float32Array(frames);
  const notes: { start: number; len: number; key: number; amp: number }[] = [];
  const mean = (start: number, end: number, key: number) => {
    let sum = 0;
    for (let t = start; t < end; t++) sum += frames[t * KEYS + key];
    return end > start ? sum / (end - start) : 0;
  };
  const clear = (t: number, key: number) => {
    energy[t * KEYS + key] = 0;
    if (key < KEYS - 1) energy[t * KEYS + key + 1] = 0;
    if (key > 0) energy[t * KEYS + key - 1] = 0;
  };

  // Pass 1: notes that start with a clear strike, latest first, highest key first.
  for (let t = n - 1; t >= 0; t--) {
    for (let key = KEYS - 1; key >= 0; key--) {
      const v = strike[t * KEYS + key];
      if (v <= onsetThreshold) continue;
      if (t > 0 && !(v > strike[(t - 1) * KEYS + key])) continue;
      if (t < n - 1 && !(v > strike[(t + 1) * KEYS + key])) continue;
      if (t >= n - 1) continue;
      let i = t + 1;
      let k = 0;
      while (i < n - 1 && k < tolerance) {
        k = energy[i * KEYS + key] < frameThreshold ? k + 1 : 0;
        i++;
      }
      i -= k;
      if (i - t <= minFrames) continue;
      for (let j = t; j < i; j++) clear(j, key);
      notes.push({ start: t, len: i - t, key, amp: mean(t, i, key) });
    }
  }

  // Pass 2: whatever strong energy is left becomes notes too, strongest first.
  const candidates: number[] = [];
  for (let i = 0; i < energy.length; i++) if (energy[i] > frameThreshold) candidates.push(i);
  candidates.sort((a, b) => energy[b] - energy[a] || a - b);
  for (const cell of candidates) {
    if (energy[cell] <= frameThreshold) continue; // cleared by an earlier note
    const mid = Math.floor(cell / KEYS);
    const key = cell % KEYS;
    energy[cell] = 0;
    let i = mid + 1;
    let k = 0;
    while (i < n - 1 && k < tolerance) {
      k = energy[i * KEYS + key] < frameThreshold ? k + 1 : 0;
      clear(i, key);
      i++;
    }
    const end = i - 1 - k;
    i = mid - 1;
    k = 0;
    while (i > 0 && k < tolerance) {
      k = energy[i * KEYS + key] < frameThreshold ? k + 1 : 0;
      clear(i, key);
      i--;
    }
    const start = i + 1 + k;
    if (end - start <= minFrames) continue;
    notes.push({ start, len: end - start, key, amp: mean(start, end, key) });
  }

  return notes.map((x) => {
    const start = frameTime(from + x.start);
    return {
      midi: x.key + MIDI_OFFSET,
      start,
      dur: frameTime(from + x.start + x.len) - start,
      amp: x.amp,
    };
  });
}
