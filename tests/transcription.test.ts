import { expect, it } from 'vitest';
import { arrange } from '../src/import/arrange';
import { songLength, type Song } from '../src/song';
import { BUILT_IN } from '../src/songs';
import { listenToSong } from '../src/import/pipeline';
import { hear, loadModel, shared } from './helpers';

const RATE = 22050;

/** Renders a song as plain decaying tones, standing in for a recording. */
function render(song: Song): Float32Array {
  const audio = new Float32Array(Math.ceil((songLength(song) + 1.5) * RATE));
  for (const n of song.notes) {
    const freq = 440 * 2 ** ((n.midi - 69) / 12);
    const from = Math.floor(n.start * RATE);
    const count = Math.floor((n.dur + 0.4) * RATE);
    for (let i = 0; i < count && from + i < audio.length; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 2.5) * (t > n.dur ? Math.exp(-(t - n.dur) * 12) : 1);
      let s = 0;
      for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * freq * h * t) / h ** 1.6;
      audio[from + i] += s * env * 0.18;
    }
  }
  return audio;
}

for (const id of ['ode', 'twinkle', 'elise']) {
  it(`recovers the melody of ${id} from audio`, { timeout: 180_000 }, async () => {
    const song = BUILT_IN.find((s) => s.id === id)!;
    const truth = song.notes.filter((n) => n.hand === 'right').map((n) => n.midi);
    const raw = await hear(render(song));
    const melody = arrange(raw, 'melody').map((n) => n.midi);
    const both = arrange(raw, 'melody-bass');
    const match = shared(truth, melody);
    if (process.env.DEBUG_NOTES) {
      console.log('truth ', truth.join(' '));
      console.log('melody', melody.join(' '));
      console.log('raw   ', raw.sort((a, b) => a.start - b.start).map((n) => `${n.midi}@${n.start.toFixed(2)}+${n.dur.toFixed(2)}a${n.amp.toFixed(2)}`).join(' '));
    }
    console.log(
      `${id}: heard ${raw.length} notes, melody ${melody.length} vs ${truth.length} true, ` +
        `${match} in common, recall ${(match / truth.length).toFixed(2)}, precision ${(match / melody.length).toFixed(2)}, ` +
        `bass notes ${both.filter((n) => n.hand === 'left').length}`,
    );
    expect(match / truth.length).toBeGreaterThan(0.85);
    expect(match / melody.length).toBeGreaterThan(0.85);

    // The full import pipeline (tune tracking, analysis, arrangement) must find it too.
    const heard = await listenToSong(await loadModel(), { left: render(song) });
    const { beats, chords, timeSignature } = heard.analysis;
    const tune = arrange(heard.raw, 'melody', { beats, chords, beatsPerBar: timeSignature?.beats }).map((n) => n.midi);
    const common = shared(truth, tune);
    console.log(`${id} through the import pipeline: ${common} of ${truth.length} in common, ${tune.length} notes`);
    if (process.env.DEBUG_NOTES) console.log(tune.join(" "), "\n", heard.raw.filter((n) => n.part).map((n) => n.midi).join(" "));
    expect(common / truth.length).toBeGreaterThan(0.85);
    expect(common / tune.length).toBeGreaterThan(0.8);
  });
}
