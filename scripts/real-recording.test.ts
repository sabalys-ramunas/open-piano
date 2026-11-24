// Manual check against a real recording. Skipped unless RECORDING is set.
//
//   RECORDING=song.mp3 npx vitest run --dir scripts
//
// Any file ffmpeg can read works (it must be installed); raw mono float32 at
// 22050 Hz (`ffmpeg -i song.mp3 -ac 1 -ar 22050 -f f32le song.f32`) works without it.
// Optional:
//   EXPECT=elise                     score the tune against a built-in song's right hand
//   EXPECT_NOTES="E4 E4 E4 | G4 C4"  score against phrases you know (any key; "|" separates phrases)
//   SECONDS=30                       only use the first 30 seconds
//   LEVEL=melody-chords              print that arrangement too
//   TF_BACKEND=cpu                   measure the plain JavaScript backend instead of WebAssembly
import { execFileSync } from 'node:child_process';
import { it } from 'vitest';
import { arrange } from '../src/import/arrange';
import { listenToSong } from '../src/import/pipeline';
import type { Level } from '../src/song';
import { BUILT_IN } from '../src/songs';
import { loadModel, parseNotes, readF32, scoreTune, shared } from '../tests/helpers';

const RATE = 22050;
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const show = (midis: number[]) => midis.map((m) => names[m % 12] + (Math.floor(m / 12) - 1)).join(' ');

function load(path: string): { left: Float32Array; right?: Float32Array } {
  if (path.endsWith('.f32')) return { left: readF32(path) };
  let bytes: Buffer;
  try {
    bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], {
      maxBuffer: 1 << 30,
    });
  } catch {
    throw new Error('Could not read that file with ffmpeg. Install ffmpeg, or convert it to .f32 first (see the top of this script).');
  }
  const both = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const left = new Float32Array(both.length / 2);
  const right = new Float32Array(both.length / 2);
  for (let i = 0; i < left.length; i++) {
    left[i] = both[2 * i];
    right[i] = both[2 * i + 1];
  }
  return { left, right };
}

it.skipIf(!process.env.RECORDING)('listens to a real recording', { timeout: 3_600_000 }, async () => {
  let audio = load(process.env.RECORDING!);
  if (process.env.SECONDS) {
    const n = Math.round(Number(process.env.SECONDS) * RATE);
    audio = { left: audio.left.subarray(0, n), right: audio.right?.subarray(0, n) };
  }
  const seconds = audio.left.length / RATE;
  const model = await loadModel();
  const started = Date.now();
  const heard = await listenToSong(model, audio);
  const took = (Date.now() - started) / 1000;
  const { beats, chords, timeSignature, bpm, key } = heard.analysis;
  const context = { beats, chords, beatsPerBar: timeSignature?.beats };
  const melody = arrange(heard.raw, 'melody', context);
  const bass = arrange(heard.raw, 'melody-bass', context).filter((n) => n.hand === 'left');

  console.log(
    `audio ${seconds.toFixed(1)}s (${audio.right ? 'stereo' : 'mono'}), listened in ${took.toFixed(1)}s on ${process.env.TF_BACKEND ?? 'wasm'}: ` +
      `${(seconds / took).toFixed(1)} minutes of audio per minute; ${heard.raw.length} notes heard; ` +
      `tune taken from ${heard.usedCentre ? 'the middle of the stereo image' : 'the whole mix'}; music starts at ${heard.startsAt.toFixed(2)}s`,
  );
  console.log(`tempo ${bpm} bpm, ${timeSignature?.beats ?? '?'}/4, key ${key ?? '?'}, ${beats?.length ?? 0} beats`);
  console.log(`chords: ${(chords ?? []).slice(0, 24).map((c) => `${c.label}@${c.start.toFixed(1)}`).join(' ')}`);
  console.log(`melody (${melody.length}): ${show(melody.map((n) => n.midi))}`);
  console.log(`bass   (${bass.length}): ${show(bass.map((n) => n.midi))}`);
  if (process.env.LEVEL) {
    const notes = arrange(heard.raw, process.env.LEVEL as Level, context);
    console.log(`${process.env.LEVEL} (${notes.length}): ${notes.map((n) => `${n.hand[0]}${show([n.midi])}@${n.start.toFixed(2)}`).join(' ')}`);
  }

  const found = melody.map((n) => n.midi);
  if (process.env.EXPECT) {
    const truth = BUILT_IN.find((s) => s.id === process.env.EXPECT)!.notes.filter((n) => n.hand === 'right').map((n) => n.midi);
    console.log(`expected opening (${truth.length}): ${show(truth)}`);
    console.log(`in common with expected opening: ${shared(truth, found)} of ${truth.length}`);
  }
  if (process.env.EXPECT_NOTES) {
    const phrases = process.env.EXPECT_NOTES.split('|').map(parseNotes);
    const score = scoreTune(phrases, found);
    console.log(
      `tune found: ${(score.fraction * 100).toFixed(0)}% of the expected notes, in order ` +
        `(phrases: ${score.phrases.map((p) => (p * 100).toFixed(0) + '%').join(', ')}); ` +
        `the same notes shuffled score ${(score.chance * 100).toFixed(0)}%`,
    );
  }
});
