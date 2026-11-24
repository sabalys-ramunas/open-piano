import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CACHE_VERSION, fingerprint, readCache, writeCache } from '../src/import/cache';
import { centre, channelSimilarity, resample } from '../src/import/dsp';
import { musicStart } from '../src/import/pipeline';
import { RATE } from './helpers';

const tone = (freq: number, seconds: number, gain = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => gain * Math.sin((2 * Math.PI * freq * i) / RATE));
const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};

describe('centre extraction', () => {
  it('keeps what is in the middle and removes what is panned to one side', () => {
    const voice = tone(440, 2);
    const guitar = tone(330, 2);
    const left = voice.map((v, i) => v + guitar[i]);
    const right = voice.slice();
    const middle = centre(left, right);
    const inner = [RATE * 0.5, RATE * 1.5] as const;
    // What is left should look like the voice, not the guitar.
    let withVoice = 0;
    let withGuitar = 0;
    for (let i = inner[0]; i < inner[1]; i++) {
      withVoice += middle[i] * voice[i];
      withGuitar += middle[i] * guitar[i];
    }
    expect(withVoice).toBeGreaterThan(withGuitar * 3);
    expect(rms(middle, ...inner)).toBeGreaterThan(rms(voice, ...inner) * 0.6);
  });

  it('tells stereo from mono', () => {
    const a = tone(220, 1);
    expect(channelSimilarity(a, a)).toBeCloseTo(1, 5);
    expect(channelSimilarity(a, tone(331, 1))).toBeLessThan(0.2);
  });

  it('resamples without changing the pitch', () => {
    const at44 = Float32Array.from({ length: 44100 }, (_, i) => Math.sin((2 * Math.PI * 441 * i) / 44100));
    const at22 = resample(at44, 44100, 22050);
    expect(at22.length).toBe(22050);
    let crossings = 0;
    for (let i = 1; i < at22.length; i++) if (at22[i - 1] < 0 && at22[i] >= 0) crossings++;
    expect(Math.abs(crossings - 441)).toBeLessThanOrEqual(2);
  });
});

describe('where the song starts', () => {
  it('skips silence at the beginning', () => {
    const audio = new Float32Array(RATE * 4);
    audio.set(tone(440, 2), RATE * 1.5);
    expect(musicStart(audio)).toBeGreaterThan(1.35);
    expect(musicStart(audio)).toBeLessThan(1.55);
    expect(musicStart(tone(440, 1))).toBe(0);
    expect(musicStart(new Float32Array(RATE))).toBe(0);
  });
});

describe('remembering what was heard', () => {
  it('stores and finds a result by the file contents', async () => {
    const bytes = new TextEncoder().encode('pretend this is an mp3').buffer as ArrayBuffer;
    const key = await fingerprint(bytes);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await readCache(key)).toBeUndefined();
    const raw = [{ midi: 60, start: 1, dur: 0.5, amp: 0.8, part: 'melody' as const }];
    await writeCache(key, { raw, analysis: { bpm: 100 }, startsAt: 0.2 });
    const found = await readCache(key);
    expect(found?.raw).toEqual(raw);
    expect(found?.analysis.bpm).toBe(100);
    expect(found?.version).toBe(CACHE_VERSION);
  });

  it('ignores damaged entries', async () => {
    const key = await fingerprint(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer);
    await writeCache(key, { raw: [{ midi: 'x' } as never], analysis: {}, startsAt: 0 });
    expect(await readCache(key)).toBeUndefined();
  });
});
