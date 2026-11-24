import { describe, expect, it } from 'vitest';
import { arrange } from '../src/import/arrange';
import { listenToSong } from '../src/import/pipeline';
import { TUNES, loadModel, renderMix, scoreNotes } from './helpers';

// The tune of a song with a singer and a band must come out right. Each case is
// a synthetic recording (voice-like singer in the middle, chords panned to the
// sides, bass and drums), so the true notes are known exactly. A note counts
// when its key is right and it starts within 150 ms of the true note.
const CASES = [
  { voiceDb: 0, label: 'singer as loud as the band', recall: 0.85, precision: 0.8 },
  { voiceDb: -6, label: 'singer 6 dB under the band', recall: 0.75, precision: 0.7 },
];

describe('songs with a singer and a band', () => {
  for (const c of CASES) {
    it(`finds the sung tune: ${c.label}`, { timeout: 120_000 }, async () => {
      const model = await loadModel();
      let matched = 0;
      let truth = 0;
      let found = 0;
      const lines: string[] = [];
      for (const tune of TUNES) {
        const mix = renderMix(tune, { voiceDb: c.voiceDb, seed: 11 });
        const heard = await listenToSong(model, { left: mix.left, right: mix.right });
        const { beats, chords, timeSignature } = heard.analysis;
        const melody = arrange(heard.raw, 'melody', { beats, chords, beatsPerBar: timeSignature?.beats });
        // The arrangement may move the whole tune by octaves to fit the hand; score the key it chose.
        const shift = 12 * Math.round((median(melody.map((n) => n.midi)) - median(mix.melody.map((n) => n.midi))) / 12);
        const s = scoreNotes(mix.melody.map((n) => ({ ...n, midi: n.midi + shift })), melody);
        lines.push(`${tune.name}: recall ${s.recall.toFixed(2)} precision ${s.precision.toFixed(2)}`);
        matched += s.matched;
        truth += mix.melody.length;
        found += melody.length;
        expect(heard.usedCentre).toBe(true);
      }
      const recall = matched / truth;
      const precision = matched / found;
      console.log(`${c.label}: recall ${recall.toFixed(2)}, precision ${precision.toFixed(2)} (${lines.join('; ')})`);
      expect(recall).toBeGreaterThan(c.recall);
      expect(precision).toBeGreaterThan(c.precision);
    });
  }
});

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1] ?? 0;
}
