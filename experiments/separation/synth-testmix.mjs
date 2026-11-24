// Renders a synthetic test song whose true stems are known, so separation
// quality can be measured (SDR, leakage) without any copyrighted audio.
//
//   node synth-testmix.mjs <seconds> <outDir>
//
// Writes, all 44.1 kHz stereo:
//   mix_<s>.wav                      16-bit PCM, what the browser page decodes
//   <stem>_<s>.f32                   raw interleaved float32 ground truth for
//                                    vocals, drums, bass, guitar, keys, other (= guitar + keys)
// The mix is exactly vocals + drums + bass + guitar + keys (then scaled; the
// same gain is applied to the stems).
//
// It is synthetic: a formant "voice", Karplus-Strong guitar and bass, an
// additive electric-piano, and synthesized drums. Real recordings will separate
// differently (usually better for vocals and drums, since models are trained on
// real music); treat numbers from this as a relative check, not a benchmark.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SR = 44100;
const seconds = Number(process.argv[2] ?? 30);
const outDir = process.argv[3] ?? 'testdata';
// Optional real voice (mono float32 44.1 kHz, e.g. made with macOS `say`, see
// README). The formant synth voice is used when it is absent or with --synth-voice:
// Demucs treats that buzzy synth voice as mostly "other", which says more about
// the test signal than about the model.
// Optional real piano for the keys stem: the app's Salamander Grand Piano
// samples (CC BY 3.0, public/samples/piano, read only), decoded with ffmpeg.
const pianoDir = process.argv.includes('--synth-keys') ? null : join(import.meta.dirname, '../../public/samples/piano');
const pianoCache = new Map();
function pianoNote(midi, dur) {
  const base = Math.max(21, Math.min(108, 21 + 3 * Math.round((midi - 21) / 3)));
  if (!pianoCache.has(base)) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(pianoDir, `${base}p.mp3`), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
    pianoCache.set(base, new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4));
  }
  const src = pianoCache.get(base);
  const ratio = 2 ** ((midi - base) / 12);
  const n = Math.min(Math.round(dur * SR), Math.floor((src.length - 2) / ratio));
  const out = new Float32Array(n);
  const rel = Math.round(0.08 * SR);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, j = Math.floor(x), f = x - j;
    out[i] = (src[j] * (1 - f) + src[j + 1] * f) * Math.min(1, (n - i) / rel);
  }
  return out;
}
const usePiano = pianoDir !== null && existsSync(pianoDir);
const voicePath = process.argv.includes('--synth-voice') ? null : join(outDir, 'voice.f32');
const voice = voicePath && existsSync(voicePath) ? (() => { const b = readFileSync(voicePath); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); })() : null;
mkdirSync(outDir, { recursive: true });
const N = Math.round(seconds * SR);

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function stereo() {
  return { l: new Float32Array(N), r: new Float32Array(N) };
}
function addMono(dst, src, at, gain, pan) {
  // equal-power pan, pan in [-1, 1]
  const a = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(a) * gain, gr = Math.sin(a) * gain;
  for (let i = 0; i < src.length && at + i < N; i++) {
    if (at + i < 0) continue;
    dst.l[at + i] += src[i] * gl;
    dst.r[at + i] += src[i] * gr;
  }
}

// ---- song structure ------------------------------------------------------
const BPM = 100;
const beat = 60 / BPM;
const bar = 4 * beat;
const progression = [
  [48, [60, 64, 67]], // C
  [43, [59, 62, 67]], // G
  [45, [60, 64, 69]], // Am
  [41, [60, 65, 69]], // F
];
const bars = Math.ceil(seconds / bar);

// ---- instruments ---------------------------------------------------------
function karplus(freq, dur, bright = 0.5, decay = 0.996) {
  const n = Math.round(dur * SR);
  const period = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(period);
  for (let i = 0; i < period; i++) buf[i] = rand() * 2 - 1;
  const out = new Float32Array(n);
  let idx = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    const next = buf[(idx + 1) % period];
    const v = decay * (bright * cur + (1 - bright) * 0.5 * (cur + next));
    buf[idx] = v;
    out[i] = cur;
    prev = cur;
    idx = (idx + 1) % period;
  }
  void prev;
  // short release at the end
  const rel = Math.min(n, Math.round(0.02 * SR));
  for (let i = 0; i < rel; i++) out[n - 1 - i] *= i / rel;
  return out;
}

// Electric-bass-like tone: strong fundamental, few harmonics, a pluck that
// darkens over time. (A first version used a bright Karplus-Strong pluck; every
// model put it in "other", so it was not a fair bass.)
function bassNote(freq, dur) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += (Math.exp(-t * (2 + 3 * h)) * (h === 1 ? 1 : 0.6)) / (h * h) * Math.sin(2 * Math.PI * freq * h * t);
    v += 0.5 * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 1.5);
    const atk = Math.min(1, t / 0.005);
    const rel = Math.min(1, (dur - t) / 0.03);
    out[i] = v * atk * Math.max(0, rel);
  }
  return out;
}

function epiano(freq, dur) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const partials = [1, 2, 3, 4, 5.02, 7.1];
  const amps = [1, 0.45, 0.2, 0.12, 0.05, 0.03];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (let k = 0; k < partials.length; k++) {
      v += amps[k] * Math.exp(-t * (1.2 + k * 1.5)) * Math.sin(2 * Math.PI * freq * partials[k] * t + 0.3 * Math.sin(2 * Math.PI * 5 * t) * (k === 0 ? 0 : 1));
    }
    const atk = Math.min(1, t / 0.004);
    const rel = Math.min(1, (dur - t) / 0.05);
    out[i] = v * atk * Math.max(0, rel);
  }
  return out;
}

// Formant voice: band-limited glottal pulse (sum of harmonics with spectral
// tilt) shaped by vowel formants, with vibrato and slight breath noise.
const VOWELS = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [270, 2290, 3010], // i
  [570, 840, 2410], // o
  [300, 870, 2240], // u
];
function voiceNote(freq, dur, vowelA, vowelB) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  let phase = 0;
  const maxH = Math.floor(8000 / freq);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.3);
    phase += (2 * Math.PI * freq * vib) / SR;
    const mix = Math.min(1, t / dur);
    const fm = [0, 1, 2].map((k) => vowelA[k] * (1 - mix) + vowelB[k] * mix);
    let v = 0;
    for (let h = 1; h <= maxH; h++) {
      const fh = freq * h;
      let g = 1 / h; // tilt
      let env = 0;
      for (let k = 0; k < 3; k++) {
        const bw = 80 + 40 * k;
        env += (k === 0 ? 1 : k === 1 ? 0.6 : 0.3) / (1 + ((fh - fm[k]) / bw) ** 2);
      }
      v += g * env * Math.sin(h * phase);
    }
    v += 0.02 * (rand() * 2 - 1);
    const atk = Math.min(1, t / 0.04);
    const rel = Math.min(1, (dur - t) / 0.06);
    out[i] = v * atk * Math.max(0, rel);
  }
  return out;
}

function kick() {
  const n = Math.round(0.35 * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 50 + 100 * Math.exp(-t * 30);
    ph += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t * 9) + (i < 200 ? 0.3 * (rand() * 2 - 1) * (1 - i / 200) : 0);
  }
  return out;
}
function snare() {
  const n = Math.round(0.25 * SR);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const noise = rand() * 2 - 1;
    lp += 0.5 * (noise - lp);
    out[i] = 0.7 * (noise - lp) * Math.exp(-t * 18) + 0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 25);
  }
  return out;
}
function hat(open) {
  const n = Math.round((open ? 0.3 : 0.06) * SR);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const noise = rand() * 2 - 1;
    const hp = noise - prev; // crude high-pass
    prev = noise;
    out[i] = 0.5 * hp * Math.exp(-t * (open ? 12 : 60));
  }
  return out;
}

// ---- render --------------------------------------------------------------
const stems = { vocals: stereo(), drums: stereo(), bass: stereo(), guitar: stereo(), keys: stereo() };
const K = kick(), S = snare(), H = hat(false), HO = hat(true);
const scale = [60, 62, 64, 65, 67, 69, 71, 72, 74];

for (let b = 0; b < bars; b++) {
  const t0 = b * bar;
  const [root, chord] = progression[b % progression.length];
  const section = Math.floor(b / 8) % 3; // verse / chorus / break, so the song is not one loop
  const at = (sec) => Math.round(sec * SR);

  // drums
  for (let q = 0; q < 8; q++) {
    const t = t0 + (q * beat) / 2;
    addMono(stems.drums, q === 7 && b % 4 === 3 ? HO : H, at(t), 0.22 + 0.06 * rand(), 0.35);
    if (q === 0 || q === 4 || (section === 1 && q === 5)) addMono(stems.drums, K, at(t), 0.7, 0);
    if (q === 2 || q === 6) addMono(stems.drums, S, at(t), 0.45, -0.1);
  }

  // bass: root on 1 and 3, octave on the "and" of 2
  for (const [pos, off, len] of [[0, 0, 1.5], [1.5, 12, 0.5], [2, 0, 1.5], [3.5, 7, 0.5]]) {
    const f = mtof(root - 12 + off);
    addMono(stems.bass, bassNote(f, len * beat), at(t0 + pos * beat), 0.3, 0);
  }

  // guitar: strummed chord (down, down-up rhythm), slight strum spread, left
  if (section !== 2 || b % 2 === 0) {
    for (const [pos, len] of [[0, 1], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]]) {
      chord.concat([chord[0] + 12]).forEach((m, k) => {
        addMono(stems.guitar, karplus(mtof(m - 12), len * beat + 0.15, 0.55, 0.995), at(t0 + pos * beat + k * 0.012), 0.22, -0.45);
      });
    }
  }

  // keys: sustained chord on 1 (voiced higher), right
  if (section !== 0 || b % 2 === 1) {
    if (usePiano) {
      // piano: chord on 1 and 3, voiced an octave up
      for (const pos of [0, 2]) chord.forEach((m) => addMono(stems.keys, pianoNote(m + 12, 2 * beat * 0.95), at(t0 + pos * beat), 2.2, 0.45));
    } else {
      chord.forEach((m) => addMono(stems.keys, epiano(mtof(m + 12), bar * 0.95), at(t0), 0.16, 0.45));
    }
  }

  // vocals: a phrase in 3 of every 4 bars; notes from the scale, chord tones favoured
  if (voice) {
    // the recorded voice, read straight through (looping), with gaps in every 4th bar
    if (b % 4 !== 3) {
      const len = Math.round(bar * SR);
      const from = (Math.floor(b - Math.floor(b / 4)) * len) % Math.max(1, voice.length - len);
      addMono(stems.vocals, voice.subarray(from, from + len), at(t0), 1.2, 0);
    }
  } else if (b % 4 !== 3) {
    let pos = 0;
    while (pos < 3.5) {
      const len = [0.5, 1, 1, 1.5][Math.floor(rand() * 4)];
      const useChord = rand() < 0.6;
      const m = useChord ? chord[Math.floor(rand() * chord.length)] + (rand() < 0.3 ? 12 : 0) : scale[Math.floor(rand() * scale.length)];
      const va = VOWELS[Math.floor(rand() * 5)], vb = VOWELS[Math.floor(rand() * 5)];
      addMono(stems.vocals, voiceNote(mtof(m), Math.min(len, 4 - pos) * beat * 0.95, va, vb), at(t0 + pos * beat), 0.45, 0);
      pos += len;
    }
  }
}

// ---- normalise and write -------------------------------------------------
const names = Object.keys(stems);
const mix = stereo();
for (const s of names) for (let i = 0; i < N; i++) { mix.l[i] += stems[s].l[i]; mix.r[i] += stems[s].r[i]; }
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix.l[i]), Math.abs(mix.r[i]));
const gain = 0.89 / peak;
const scaleAll = (x) => { for (let i = 0; i < N; i++) { x.l[i] *= gain; x.r[i] *= gain; } };
scaleAll(mix);
names.forEach((s) => scaleAll(stems[s]));
const other = stereo();
for (let i = 0; i < N; i++) { other.l[i] = stems.guitar.l[i] + stems.keys.l[i]; other.r[i] = stems.guitar.r[i] + stems.keys.r[i]; }

const tag = `${seconds}`;
console.log(voice ? 'vocals: recorded voice' : 'vocals: formant synth', usePiano ? '· keys: sampled piano' : '· keys: additive e-piano');
function writeF32(name, x) {
  const f = new Float32Array(2 * N);
  for (let i = 0; i < N; i++) { f[2 * i] = x.l[i]; f[2 * i + 1] = x.r[i]; }
  writeFileSync(join(outDir, `${name}_${tag}.f32`), Buffer.from(f.buffer));
}
for (const s of names) writeF32(s, stems[s]);
writeF32('other', other);
writeF32('mix', mix); // exact float mix, for computing "do nothing" baselines

// 16-bit PCM WAV of the mix
const wav = Buffer.alloc(44 + N * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix.l[i])) * 32767), 44 + 4 * i);
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix.r[i])) * 32767), 46 + 4 * i);
}
writeFileSync(join(outDir, `mix_${tag}.wav`), wav);
console.log(`wrote ${outDir}/mix_${tag}.wav and stems (${seconds} s)`);
