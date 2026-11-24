import { beforeEach, describe, expect, it } from 'vitest';
import { roomImpulse } from '../src/audio/reverb';
import {
  usableResponse,
  brightness,
  halfPedalTau,
  layerFor,
  onsetOffset,
  pickSample,
  releaseTau,
  SAMPLE_NOTES,
  SampledPiano,
  sampleUrl,
  velocityGain,
  type Layer,
} from '../src/audio/sampler';
import { isSounding, resetSounding } from '../src/audio/sounding';
import type { Instrument } from '../src/audio/instrument';
import { FakeBuffer, FakeContext, type FakeSource } from './audio-fake';

const all = (): boolean => true;

describe('sample mapping', () => {
  it('covers A0 to C8 a minor third apart', () => {
    expect(SAMPLE_NOTES[0]).toBe(21);
    expect(SAMPLE_NOTES[SAMPLE_NOTES.length - 1]).toBe(108);
    expect(SAMPLE_NOTES.length).toBe(30);
    expect(sampleUrl(60, 'p')).toMatch(/samples\/piano\/60p\.mp3$/);
  });

  it('never shifts a note more than one semitone when every recording is there', () => {
    for (let midi = 21; midi <= 108; midi++) {
      const c = pickSample(midi, 0.7, all)!;
      expect(Math.abs(midi - c.note)).toBeLessThanOrEqual(1);
      expect(c.rate).toBeCloseTo(2 ** ((midi - c.note) / 12), 10);
    }
  });

  it('plays recorded notes at their own pitch', () => {
    const c = pickSample(60, 0.3, all)!;
    expect(c).toEqual({ note: 60, layer: 'p', rate: 1 });
  });

  it('chooses the soft or loud recording by velocity', () => {
    expect(layerFor(0.2)).toBe('p');
    expect(layerFor(0.49)).toBe('p');
    expect(layerFor(0.5)).toBe('f');
    expect(pickSample(64, 0.9, all)!.layer).toBe('f');
  });

  it('borrows the other loudness layer before shifting far', () => {
    const onlyLoudNear = (note: number, layer: Layer) => (layer === 'f' ? note === 60 : note === 48);
    const c = pickSample(61, 0.2, onlyLoudNear)!;
    expect(c.note).toBe(60);
    expect(c.layer).toBe('f');
  });

  it('shifts further when nothing closer is loaded yet, and gives up past six semitones', () => {
    const one = (note: number) => note === 60;
    expect(pickSample(64, 0.5, one)!.note).toBe(60);
    expect(pickSample(67, 0.5, one)).toBeNull();
    expect(pickSample(60, 0.5, () => false)).toBeNull();
  });

  it('prefers shifting a recording down on a tie', () => {
    const two = (note: number) => note === 57 || note === 63;
    expect(pickSample(60, 0.3, two)!.note).toBe(63);
  });

  it('gets louder and brighter with velocity, joining the two layers smoothly', () => {
    let last = 0;
    for (let v = 0.05; v <= 1; v += 0.05) {
      const g = velocityGain(v, layerFor(v));
      // The loud layer is recorded about 6 dB hotter, so its gain may dip at the switch.
      if (Math.abs(v - 0.5) > 0.03) expect(g * (layerFor(v) === 'f' ? 2 : 1)).toBeGreaterThan(last);
      last = g * (layerFor(v) === 'f' ? 2 : 1);
    }
    expect(brightness(1, 60)).toBeGreaterThan(brightness(0.3, 60));
    expect(brightness(0.1, 96)).toBeGreaterThan(brightness(0.1, 36));
  });

  it('damps low notes slower than high ones, and the top keys ring on', () => {
    expect(releaseTau(30)).toBeGreaterThan(releaseTau(80));
    expect(releaseTau(95)).toBeGreaterThan(releaseTau(30));
  });

  it('maps half-pedal depth to damping', () => {
    expect(halfPedalTau(1)).toBe(Infinity);
    expect(halfPedalTau(0.1)).toBe(0);
    expect(halfPedalTau(0.3)).toBeGreaterThan(halfPedalTau(0.2));
    expect(halfPedalTau(0.4)).toBeLessThan(Infinity);
  });

  it('finds where the sound starts in a decoded recording', () => {
    const data = new Float32Array(44100);
    for (let i = 1500; i < 44100; i++) data[i] = Math.sin(i / 10) * 0.5;
    const t = onsetOffset(data, 44100);
    expect(t * 44100).toBeGreaterThan(1450);
    expect(t * 44100).toBeLessThan(1500);
    expect(onsetOffset(new Float32Array(100), 44100)).toBe(0);
  });
});

describe('room echo', () => {
  it('is stereo, decays, and is normalised', () => {
    const [l, r] = roomImpulse(8000, 1);
    expect(l.length).toBe(8000);
    const early = l.slice(100, 1100).reduce((s, x) => s + x * x, 0);
    const late = l.slice(6900, 7900).reduce((s, x) => s + x * x, 0);
    expect(late).toBeLessThan(early / 100);
    const energy = [l, r].reduce((s, ch) => s + ch.reduce((a, x) => a + x * x, 0), 0);
    expect(energy / 2).toBeCloseTo(1, 5);
    expect(l).not.toEqual(r);
  });
});

class FakeSynth implements Instrument {
  log: string[] = [];
  wake(): void {}
  noteOn(midi: number): void {
    this.log.push(`on ${midi}`);
  }
  noteOff(midi: number): void {
    this.log.push(`off ${midi}`);
  }
  play(midi: number): void {
    this.log.push(`play ${midi}`);
  }
  setVolume(): void {}
  sustain(on: boolean): void {
    this.log.push(`pedal ${on}`);
  }
}

function setup(options: { loaded?: (note: number, layer: Layer) => boolean; maxVoices?: number } = {}) {
  const ctx = new FakeContext();
  const synth = new FakeSynth();
  const loaded = options.loaded ?? all;
  const piano = new SampledPiano({
    context: () => ctx.asContext(),
    fallback: synth,
    maxVoices: options.maxVoices,
    loader: async (note, layer) => {
      if (!loaded(note, layer)) throw new Error('missing');
      const b = new FakeBuffer(2, 1000, 44100);
      b.getChannelData(0).fill(0.5, 100);
      return b as unknown as AudioBuffer;
    },
  });
  return { ctx, synth, piano };
}

const voicesOf = (ctx: FakeContext): FakeSource[] => ctx.sources;

describe('sampled piano voices', () => {
  beforeEach(() => resetSounding());

  it('plays the synth until the recordings are loaded, then the recordings', async () => {
    const { ctx, synth, piano } = setup();
    piano.noteOn(60, 0.5); // before wake: silent, as the synth was
    expect(synth.log).toEqual([]);
    piano.wake();
    piano.noteOn(60, 0.5);
    expect(synth.log).toEqual(['on 60']);
    await piano.ready();
    expect(piano.hasSamples).toBe(true);
    piano.noteOff(60); // the synth note is released by the synth
    expect(synth.log).toEqual(['on 60', 'off 60']);
    piano.noteOn(62, 0.8);
    const v = voicesOf(ctx)[0];
    expect(v.started).not.toBeNull();
    expect(v.started!.offset).toBeGreaterThan(0); // skips the silence in front
    expect(v.playbackRate.value).toBeCloseTo(2 ** (-1 / 12), 10); // 62 from the 63 recording
    expect(synth.log).toEqual(['on 60', 'off 60']);
  });

  it('falls back to the synth for notes whose recordings failed', async () => {
    const { synth, piano } = setup({ loaded: (note) => note < 60 });
    piano.wake();
    await piano.ready();
    piano.noteOn(100, 0.7);
    piano.play(105, 0.5);
    expect(synth.log).toEqual(['on 100', 'play 105']);
  });

  it('releases a key with a smooth fade, never a hard cut', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    ctx.currentTime = 1;
    piano.noteOn(60, 0.7);
    ctx.currentTime = 2;
    piano.noteOff(60);
    const src = voicesOf(ctx)[0];
    expect(src.stoppedAt).toBeCloseTo(2 + releaseTau(60) * 7, 6);
    const gain = src.connections[0] as { connections: { gain: { events: string[] } }[] };
    const events = gain.connections[0].gain.events;
    expect(events[0]).toBe('set 0 @1'); // starts from silence
    expect(events[1]).toMatch(/^linear .* @1\.002$/); // 2 ms attack
    expect(events).toContain(`target 0 @2 tau ${releaseTau(60)}`);
  });

  it('keeps notes ringing while the pedal is down and lets them go when it comes up', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    piano.sustain(true);
    piano.noteOn(60, 0.7);
    piano.noteOn(64, 0.7);
    piano.noteOff(60);
    piano.noteOff(64);
    expect(voicesOf(ctx).every((s) => s.stoppedAt === null)).toBe(true);
    piano.noteOn(67, 0.7); // still held when the pedal lifts
    ctx.currentTime = 3;
    piano.sustain(false);
    const [a, b, c] = voicesOf(ctx);
    expect(a.stoppedAt).not.toBeNull();
    expect(b.stoppedAt).not.toBeNull();
    expect(c.stoppedAt).toBeNull();
  });

  it('half pedal makes sustained notes die away instead of holding', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    piano.sustain(true);
    piano.noteOn(60, 0.7);
    piano.noteOff(60);
    piano.pedalDepth(0.35);
    const gain = (voicesOf(ctx)[0].connections[0] as { connections: { gain: { events: string[] } }[] }).connections[0].gain;
    expect(gain.events.some((e) => e.startsWith(`target 0 @0 tau ${halfPedalTau(0.35)}`))).toBe(true);
  });

  it('steals the oldest released voice first when the polyphony limit is reached', async () => {
    const { ctx, piano } = setup({ maxVoices: 4 });
    piano.wake();
    await piano.ready();
    piano.noteOn(60, 0.7);
    piano.noteOn(62, 0.7);
    piano.noteOff(62); // fading, so first to go
    piano.noteOn(64, 0.7);
    piano.noteOn(65, 0.7);
    expect(piano.voiceCount).toBe(4);
    ctx.currentTime = 1;
    piano.noteOn(67, 0.7);
    expect(piano.voiceCount).toBe(4);
    const [s60, s62] = voicesOf(ctx);
    expect(s62.stoppedAt).toBeCloseTo(1.04, 6); // quick fade, no click
    expect(s60.stoppedAt).toBeNull();
    piano.noteOn(69, 0.7); // nothing released now: the oldest goes
    expect(s60.stoppedAt).not.toBeNull();
    expect(piano.voiceCount).toBe(4);
  });

  it('forgets voices that have finished playing', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    piano.play(60, 0.5, 0.6);
    expect(piano.voiceCount).toBe(1);
    voicesOf(ctx)[0].end();
    expect(piano.voiceCount).toBe(0);
  });

  it('a timed note ignores the pedal and stops on its own', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    piano.sustain(true);
    piano.play(72, 0.5, 0.6);
    expect(voicesOf(ctx)[0].stoppedAt).toBeCloseTo(0.5 + releaseTau(72) * 7, 6);
  });

  it('striking a ringing key again quickly fades the old sound', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    piano.sustain(true);
    piano.noteOn(60, 0.7);
    piano.noteOff(60);
    ctx.currentTime = 0.5;
    piano.noteOn(60, 0.7);
    expect(voicesOf(ctx)[0].stoppedAt).toBeCloseTo(0.5 + 0.04 * 7, 6);
    expect(voicesOf(ctx)[1].stoppedAt).toBeNull();
  });

  it('starts a delayed timed note on the audio clock, and can take it back before it starts', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    ctx.currentTime = 1;
    piano.play(72, 0.5, 0.6, 0.1);
    piano.play(74, 0.5, 0.6, 0);
    const [later, now] = voicesOf(ctx);
    expect(later.started!.when).toBeCloseTo(1.1, 6);
    expect(later.stoppedAt).toBeCloseTo(1.6 + releaseTau(72) * 7, 6);
    expect(now.started!.when).toBeCloseTo(1, 6);
    ctx.currentTime = 1.05;
    piano.cancelPending();
    expect(later.stoppedAt).toBe(0); // stopped before it ever started: silent
    expect(now.stoppedAt).toBeCloseTo(1.5 + releaseTau(74) * 7, 6); // already sounding: left alone
    expect(piano.voiceCount).toBe(1);
  });

  it('allOff silences everything', async () => {
    const { ctx, piano } = setup();
    piano.wake();
    await piano.ready();
    piano.noteOn(60, 0.7);
    piano.noteOn(64, 0.7);
    piano.allOff();
    expect(voicesOf(ctx).every((s) => s.stoppedAt !== null)).toBe(true);
  });
});

describe('sounding notes registry', () => {
  it('knows which notes the app is making', async () => {
    resetSounding();
    const { createInstrument } = await import('../src/audio/instrument');
    const inst = createInstrument('synth'); // no AudioContext in tests: silent, but still tracked
    inst.noteOn(60, 0.5);
    expect(isSounding(60)).toBe(true);
    inst.noteOff(60);
    expect(isSounding(60, performance.now() + 1000)).toBe(false);
    inst.play(64, 0.5);
    expect(isSounding(64)).toBe(true);
    expect(isSounding(64, performance.now() + 2000)).toBe(false);
  });
});

describe('sample downloads', () => {
  it('accepts an app-shell answer (status 0 with a body) and refuses errors and empty answers', () => {
    expect(usableResponse(200, 1000)).toBe(true);
    expect(usableResponse(0, 1000)).toBe(true); // piano://app/ in a WKWebView
    expect(usableResponse(0, 0)).toBe(false);
    expect(usableResponse(404, 1000)).toBe(false);
  });
});
