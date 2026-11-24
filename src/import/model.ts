// Runs the note-listening network (Spotify's basic-pitch, Apache-2.0) over a
// whole recording. This replaces basic-pitch's own evaluateModel, which keeps
// every intermediate tensor alive (a long song runs out of memory, worst of all
// on the GPU), cannot be cancelled and returns nested number arrays. Here the
// work is done a few windows at a time, every tensor is freed, the results go
// into flat typed arrays, and progress and cancelling are checked per batch.
import type { GraphModel } from '@tensorflow/tfjs-converter';
import * as tf from '@tensorflow/tfjs-core';

import { Cancelled, MODEL_RATE } from './shared';

export { Cancelled, MODEL_RATE };
export const FFT_HOP = 256;
/** Number of piano keys in the note outputs, starting at A0 (MIDI 21). */
export const KEYS = 88;
export const MIDI_OFFSET = 21;
/** The pitch outputs have three bins per semitone, also starting at A0. */
export const BINS_PER_SEMITONE = 3;
export const PITCH_BINS = KEYS * BINS_PER_SEMITONE;

const WINDOW = MODEL_RATE * 2 - FFT_HOP; // samples per network call
const OVERLAP_FRAMES = 30;
const HALF_OVERLAP = OVERLAP_FRAMES / 2;
const WINDOW_HOP = WINDOW - OVERLAP_FRAMES * FFT_HOP; // samples between windows
const FRAMES_PER_WINDOW = 172 - OVERLAP_FRAMES; // frames kept from each window

/** What the network heard, one row per frame (about 86 frames a second). */
export interface Activations {
  frameCount: number;
  /** frameCount x KEYS: how sure the network is that each key sounds. */
  frames: Float32Array;
  /** frameCount x KEYS: how sure it is that each key starts. */
  onsets: Float32Array;
  /** frameCount x PITCH_BINS, scaled to 0..255: fine pitch, three bins per semitone. */
  pitch: Uint8Array;
}

/** Time in seconds of a frame. Windows overlap by a fraction of a frame, which this accounts for exactly. */
export function frameTime(frame: number): number {
  const w = Math.floor(frame / FRAMES_PER_WINDOW);
  return (w * WINDOW_HOP + (frame - w * FRAMES_PER_WINDOW) * FFT_HOP) / MODEL_RATE;
}

/** Frame index nearest to a time in seconds. */
export function timeFrame(seconds: number): number {
  const samples = Math.max(0, seconds * MODEL_RATE);
  const w = Math.floor(samples / WINDOW_HOP);
  const within = Math.min(FRAMES_PER_WINDOW - 1, Math.round((samples - w * WINDOW_HOP) / FFT_HOP));
  return w * FRAMES_PER_WINDOW + within;
}

export interface RunOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Windows per network call. More is faster on a GPU and uses more memory. */
  batch?: number;
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Runs the network over mono audio at MODEL_RATE. */
export async function runModel(model: GraphModel, audio: Float32Array, options: RunOptions = {}): Promise<Activations> {
  const { onProgress, signal } = options;
  const batch = Math.max(1, options.batch ?? 2);
  const frameCount = Math.floor(audio.length / FFT_HOP);
  const windows = Math.max(1, Math.ceil(frameCount / FRAMES_PER_WINDOW));
  const stored = windows * FRAMES_PER_WINDOW;
  const frames = new Float32Array(stored * KEYS);
  const onsets = new Float32Array(stored * KEYS);
  const pitch = new Uint8Array(stored * PITCH_BINS);

  // Half an overlap of silence in front, as the network was trained with.
  const lead = HALF_OVERLAP * FFT_HOP;
  const input = new Float32Array(batch * WINDOW);
  for (let first = 0; first < windows; first += batch) {
    if (signal?.aborted) throw new Cancelled();
    onProgress?.(first / windows);
    const count = Math.min(batch, windows - first);
    input.fill(0);
    for (let k = 0; k < count; k++) {
      const from = (first + k) * WINDOW_HOP - lead; // may be negative for the first window
      const a = Math.max(0, from);
      const b = Math.min(audio.length, from + WINDOW);
      if (b > a) input.set(audio.subarray(a, b), k * WINDOW + (a - from));
    }
    const outputs = tf.tidy(() => {
      const x = tf.tensor3d(input.subarray(0, count * WINDOW), [count, WINDOW, 1]);
      // Output names as exported by basic-pitch: contours, frames, onsets.
      const [c, f, o] = model.execute(x, ['Identity', 'Identity_1', 'Identity_2']) as tf.Tensor[];
      const trim = (t: tf.Tensor) => tf.slice(t, [0, HALF_OVERLAP, 0], [-1, FRAMES_PER_WINDOW, -1]);
      return [trim(c), trim(f), trim(o)];
    });
    try {
      const [c, f, o] = await Promise.all(outputs.map((t) => t.data() as Promise<Float32Array>));
      const at = first * FRAMES_PER_WINDOW;
      frames.set(f, at * KEYS);
      onsets.set(o, at * KEYS);
      const p = at * PITCH_BINS;
      for (let i = 0; i < c.length; i++) pitch[p + i] = Math.round(Math.min(1, Math.max(0, c[i])) * 255);
    } finally {
      for (const t of outputs) t.dispose();
    }
    await nextTick(); // lets a cancel message in
  }
  onProgress?.(1);
  return {
    frameCount,
    frames: frames.subarray(0, frameCount * KEYS),
    onsets: onsets.subarray(0, frameCount * KEYS),
    pitch: pitch.subarray(0, frameCount * PITCH_BINS),
  };
}
