// Prints reference points: SDR of "do nothing" estimates (the mix itself) and
// each true stem's loudness, so separation numbers have context.
import { readFileSync } from 'node:fs';
import { energy, sdrGlobal } from './src/metrics.js';
const sec = process.argv[2] ?? '30';
const f32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const mix = f32(`testdata/mix_${sec}.f32`);
for (const s of ['vocals', 'drums', 'bass', 'guitar', 'keys', 'other']) {
  const t = f32(`testdata/${s}_${sec}.f32`);
  console.log(s.padEnd(7), 'level vs mix', (10 * Math.log10(energy(t) / energy(mix))).toFixed(1), 'dB', ' SDR if estimate = mix', sdrGlobal(t, mix).toFixed(2), 'dB');
}
