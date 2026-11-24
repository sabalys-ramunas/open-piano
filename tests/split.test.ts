import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fft as fastFft } from '../src/split/fft';
import { F, T, blockCount, lowLength, splitStereo, type StemModel } from '../src/split/spleeter';

// The same test signal and fake network the reference was made with (see the
// note in tests/fixtures/split-reference.json): the prototype's code, which was
// checked against Spleeter itself, produced those numbers.
function testSignal(n: number) {
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let j = 0; j < 14; j++) {
    const f = 90 * 1.33 ** j;
    const al = 0.05 + 0.02 * Math.sin(j * 1.7);
    const ar = 0.05 + 0.02 * Math.cos(j * 2.3);
    const pl = j * 0.9;
    const pr = j * 1.3;
    const rate = 0.3 + 0.11 * j;
    for (let i = 0; i < n; i++) {
      const t = i / 44100;
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * rate * t + j);
      left[i] += al * env * Math.sin(2 * Math.PI * f * t + pl);
      right[i] += ar * env * Math.sin(2 * Math.PI * f * t + pr);
    }
  }
  return { left, right };
}

const fakeModel: StemModel = async (mag) =>
  [0, 1, 2, 3].map((s) => {
    const out = new Float32Array(mag.length);
    for (let c = 0; c < 2; c++)
      for (let f = 0; f < T; f++)
        for (let k = 0; k < F; k++) {
          const i = c * T * F + f * F + k;
          out[i] = mag[i] * (1 + 0.8 * Math.sin(0.013 * k * (s + 1) + 0.05 * f + s + c));
        }
    return out;
  });

interface Reference {
  seconds: number;
  at44: number[];
  backingLeft: number[];
  backingRight: number[];
  at22: number[];
  vocals: number[];
  other: number[];
  bass: number[];
  energy: { backingLeft: number; vocals: number; other: number; bass: number };
}

const reference = JSON.parse(readFileSync('tests/fixtures/split-reference.json', 'utf8')) as Reference;

/** Collects what the sinks hand over, checking every chunk is a fresh run of samples. */
async function runSplit(left: Float32Array, right: Float32Array, backingRate: 44100 | 22050 = 44100) {
  const n = left.length;
  const backLen = backingRate === 44100 ? n : lowLength(n);
  const out = {
    backL: new Float32Array(backLen),
    backR: new Float32Array(backLen),
    vocals: new Float32Array(lowLength(n)),
    other: new Float32Array(lowLength(n)),
    bass: new Float32Array(lowLength(n)),
    backAt: 0,
    stemAt: 0,
    chunks: 0,
  };
  const stats = { modelMs: 0, dspMs: 0, blocks: 0 };
  await splitStereo(
    left,
    right,
    fakeModel,
    {
      backing(l, r) {
        out.backL.set(l, out.backAt);
        out.backR.set(r, out.backAt);
        out.backAt += l.length;
        out.chunks++;
      },
      stems(v, o, b) {
        out.vocals.set(v, out.stemAt);
        out.other.set(o, out.stemAt);
        out.bass.set(b, out.stemAt);
        out.stemAt += v.length;
      },
    },
    { backingRate, stats },
  );
  return { ...out, stats };
}

function maxRelError(got: ArrayLike<number>, want: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < want.length; i++) peak = Math.max(peak, Math.abs(want[i]));
  let err = 0;
  for (let i = 0; i < want.length; i++) err = Math.max(err, Math.abs(got[i] - want[i]));
  return err / peak;
}

describe('song splitter maths', () => {
  it('matches the prototype (backing, and the 22 kHz vocals, other and bass) across a block boundary', { timeout: 60_000 }, async () => {
    const n = 44100 * reference.seconds;
    const { left, right } = testSignal(n);
    const got = await runSplit(left, right);
    expect(got.backAt).toBe(n);
    expect(got.stemAt).toBe(lowLength(n));
    expect(got.chunks).toBe(blockCount(n));
    expect(blockCount(n)).toBe(2);
    const at = (a: Float32Array, idx: number[]) => idx.map((i) => a[i]);
    expect(maxRelError(at(got.backL, reference.at44), reference.backingLeft)).toBeLessThan(1e-4);
    expect(maxRelError(at(got.backR, reference.at44), reference.backingRight)).toBeLessThan(1e-4);
    // The 22 kHz outputs are band-limited where the prototype's were not. The test signal stays
    // below 5 kHz, so they agree except at the very start and end, where the recording starts and
    // stops with a click (broadband): skip the first and last frame there.
    const inner = reference.at22.map((i, k) => [i, k]).filter(([i]) => i >= 2048 && i < n / 2 - 2048);
    const pickInner = (a: Float32Array, want: number[]) => [inner.map(([i]) => a[i]), inner.map(([, k]) => want[k])] as const;
    for (const [name, a] of [['vocals', got.vocals], ['other', got.other], ['bass', got.bass]] as const) {
      const [g, w] = pickInner(a, reference[name]);
      expect(maxRelError(g, w), name).toBeLessThan(2e-4);
    }
    const energy = (a: Float32Array) => a.reduce((s, x) => s + x * x, 0);
    expect(energy(got.backL) / reference.energy.backingLeft).toBeCloseTo(1, 4);
    expect(energy(got.vocals) / reference.energy.vocals).toBeCloseTo(1, 2);
  });

  it('gives back the recording when the other layer is silent, and the layers add up to the mix', async () => {
    const n = 44100 * 3;
    const { left, right } = testSignal(n);
    // "other" estimates zero: the backing must be the input itself.
    const silentOther: StemModel = async (mag) => [mag, mag, mag, new Float32Array(mag.length)];
    let back = new Float32Array(0);
    await splitStereo(left, right, silentOther, {
      backing(l) {
        const next = new Float32Array(back.length + l.length);
        next.set(back);
        next.set(l, back.length);
        back = next;
      },
    });
    expect(maxRelError(back, left)).toBeLessThan(1e-5);

    // Low-rate stems: vocals + other + bass + drums = the mono mix, band-limited. With drums
    // silent, the three kept stems add up to the decimated mono mix.
    const noDrums: StemModel = async (mag) => {
      const [v, , b, o] = await fakeModel(mag);
      return [v, new Float32Array(mag.length), b, o];
    };
    const sum = new Float32Array(lowLength(n));
    let at = 0;
    await splitStereo(left, right, noDrums, {
      stems(v, o, b) {
        for (let i = 0; i < v.length; i++) sum[at + i] = v[i] + o[i] + b[i];
        at += v.length;
      },
    });
    const mono = new Float32Array(lowLength(n));
    for (let m = 0; m < mono.length; m++) mono[m] = (left[2 * m] + right[2 * m]) / 2;
    expect(maxRelError(sum.subarray(2048, -2048), mono.subarray(2048, -2048))).toBeLessThan(1e-4);
  });

  it('makes a 22 kHz backing that matches the 44 kHz one at every other sample', async () => {
    const n = 44100 * 2 + 123;
    const { left, right } = testSignal(n);
    const full = await runSplit(left, right, 44100);
    const low = await runSplit(left, right, 22050);
    expect(low.backAt).toBe(lowLength(n));
    const even = Float32Array.from({ length: lowLength(n) }, (_, m) => full.backL[2 * m]);
    expect(maxRelError(low.backL.subarray(2048, -2048), even.subarray(2048, -2048))).toBeLessThan(1e-4);
  });

  it('handles recordings shorter than one frame, and cancelling', async () => {
    const tiny = await runSplit(new Float32Array(1000).fill(0.1), new Float32Array(1000).fill(-0.1));
    expect(tiny.backAt).toBe(1000);
    expect(tiny.stemAt).toBe(500);
    const controller = new AbortController();
    controller.abort();
    await expect(splitStereo(new Float32Array(44100), new Float32Array(44100), fakeModel, {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'Cancelled' });
  });
});

describe('fast FFT', () => {
  it('agrees with a plain DFT, forward and inverse', () => {
    for (const n of [4, 8, 64, 2048]) {
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        re[i] = Math.sin(i * 0.37) + (i % 5) * 0.1;
        im[i] = Math.cos(i * 0.11) - (i % 3) * 0.2;
      }
      const wantRe = new Float64Array(n);
      const wantIm = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++) {
          const a = (-2 * Math.PI * k * i) / n;
          wantRe[k] += re[i] * Math.cos(a) - im[i] * Math.sin(a);
          wantIm[k] += re[i] * Math.sin(a) + im[i] * Math.cos(a);
        }
      }
      const r = re.slice();
      const m = im.slice();
      fastFft(r, m);
      expect(maxRelError(r, wantRe)).toBeLessThan(1e-9);
      expect(maxRelError(m, wantIm)).toBeLessThan(1e-9);
      fastFft(r, m, true);
      for (let i = 0; i < n; i++) {
        expect(r[i] / n).toBeCloseTo(re[i], 9);
        expect(m[i] / n).toBeCloseTo(im[i], 9);
      }
    }
  });
});
