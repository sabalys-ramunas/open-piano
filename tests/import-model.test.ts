import { addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import { expect, it } from 'vitest';
import { KEYS, frameTime, timeFrame } from '../src/import/model';
import { decodeNotes } from '../src/import/notes';
import { listen, shared } from './helpers';

const RATE = 22050;

function tones(): Float32Array {
  const audio = new Float32Array(RATE * 9);
  const melody = [60, 64, 67, 72, 71, 67, 64, 62, 60, 55, 57, 59];
  melody.forEach((m, i) => {
    const f = 440 * 2 ** ((m - 69) / 12);
    const from = Math.floor((0.3 + i * 0.6) * RATE);
    for (let j = 0; j < 0.5 * RATE; j++) {
      const t = j / RATE;
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 3);
      audio[from + j] += 0.3 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
    }
  });
  return audio;
}

it('maps frames to time and back', () => {
  for (const f of [0, 1, 141, 142, 143, 1000, 31_000]) expect(timeFrame(frameTime(f))).toBe(f);
  expect(frameTime(86)).toBeCloseTo((86 * 256) / RATE, 6);
});

it('decodes notes the same way basic-pitch does', { timeout: 60_000 }, async () => {
  const act = await listen(tones());
  const rows = (data: Float32Array) =>
    Array.from({ length: act.frameCount }, (_, t) => Array.from(data.subarray(t * KEYS, (t + 1) * KEYS)));
  const theirs = noteFramesToTime(addPitchBendsToNoteEvents([], outputToNotesPoly(rows(act.frames), rows(act.onsets), 0.5, 0.3, 5)));
  const ours = decodeNotes(act);
  const key = (midi: number, start: number) => `${midi}@${Math.round(start * 20)}`;
  expect(ours.length).toBe(theirs.length);
  expect(new Set(ours.map((n) => key(n.midi, n.start)))).toEqual(new Set(theirs.map((n) => key(n.pitchMidi, n.startTimeSeconds))));
  // Every melody note is heard, in order (overtones may add a few more).
  const melody = [60, 64, 67, 72, 71, 67, 64, 62, 60, 55, 57, 59];
  const heard = ours.sort((a, b) => a.start - b.start).map((n) => n.midi);
  expect(shared(melody, heard)).toBe(melody.length);
});

it('stops when cancelled', async () => {
  const { runModel, Cancelled } = await import('../src/import/model');
  const { loadModel } = await import('./helpers');
  const controller = new AbortController();
  const run = runModel(await loadModel(), new Float32Array(RATE * 30), {
    signal: controller.signal,
    onProgress: (f) => {
      if (f > 0.2) controller.abort();
    },
  });
  await expect(run).rejects.toBeInstanceOf(Cancelled);
});
