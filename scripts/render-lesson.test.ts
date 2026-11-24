// Renders a lesson to WAV files with a simple offline piano-like synth, so an
// arrangement can be listened to later. Nothing is played out loud. Skipped
// unless INPUT is set.
//
//   INPUT=song.mp3 OUT=out/ npx vitest run --dir scripts render-lesson
//
// INPUT can be:
//   - a recording (anything ffmpeg reads): it is listened to and analysed the way
//     the app does it, then every level (or LEVEL) is arranged and rendered;
//   - a lesson file (.json): its notes are rendered as they are;
//   - a MIDI file (.mid): its notes are rendered as they are.
// Optional:
//   LEVEL=melody-chords    only this level (melody, melody-bass, melody-chords, full)
//   SECONDS=60             only the first minute of a recording
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { it } from 'vitest';
import { arrange } from '../src/import/arrange';
import { readMidiSong } from '../src/import/midifile';
import { listenToSong } from '../src/import/pipeline';
import { fromLesson } from '../src/lesson';
import type { Level } from '../src/song';
import { loadModel } from '../tests/helpers';
import { writePianoWav } from './piano-wav';

const RATE = 22050;
const LEVELS: Level[] = ['melody', 'melody-bass', 'melody-chords', 'full'];

function decode(path: string): { left: Float32Array; right?: Float32Array } {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const both = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const left = new Float32Array(both.length / 2);
  const right = new Float32Array(both.length / 2);
  for (let i = 0; i < left.length; i++) {
    left[i] = both[2 * i];
    right[i] = both[2 * i + 1];
  }
  return { left, right };
}

it.skipIf(!process.env.INPUT)('renders a lesson to WAV', { timeout: 3_600_000 }, async () => {
  const input = process.env.INPUT!;
  const out = process.env.OUT ?? '.';
  mkdirSync(out, { recursive: true });
  const name = basename(input).replace(/\.[^.]+$/, '');
  if (/\.json$/i.test(input)) {
    const song = fromLesson(readFileSync(input, 'utf8'));
    writePianoWav(join(out, `${name}.wav`), song.notes);
    console.log(`Wrote ${join(out, `${name}.wav`)} (${song.notes.length} notes)`);
    return;
  }
  if (/\.(midi?|kar)$/i.test(input)) {
    const bytes = readFileSync(input);
    const song = readMidiSong(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    writePianoWav(join(out, `${name}.wav`), song.notes);
    console.log(`Wrote ${join(out, `${name}.wav`)} (${song.notes.length} notes)`);
    return;
  }
  let audio = decode(input);
  if (process.env.SECONDS) {
    const n = Math.round(Number(process.env.SECONDS) * RATE);
    audio = { left: audio.left.subarray(0, n), right: audio.right?.subarray(0, n) };
  }
  const heard = await listenToSong(await loadModel(), audio);
  const { beats, chords, timeSignature, key } = heard.analysis;
  const context = { beats, chords, beatsPerBar: timeSignature?.beats, key };
  for (const level of process.env.LEVEL ? [process.env.LEVEL as Level] : LEVELS) {
    const notes = arrange(heard.raw, level, context);
    const path = join(out, `${name}-${level}.wav`);
    writePianoWav(path, notes);
    console.log(`Wrote ${path} (${notes.length} notes)`);
  }
});
