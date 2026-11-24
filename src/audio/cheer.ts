/**
 * Celebration sounds, made on the spot with Web Audio so there is no sound
 * file to download or license: a sparkle, a little fanfare, and a small crowd
 * that claps and whoops.
 *
 * - small: a sparkle, for a good step or a first key
 * - medium: fanfare and sparkle, for a finished song
 * - big: fanfare, sparkle, clapping and whoops, for three stars or a finished lesson
 */
import { audioContext } from './context';

export type CheerSize = 'small' | 'medium' | 'big';

let volume = 0.8;
let noise: AudioBuffer | null = null;
let lastAt = -1;

/** Follows the app's master volume, 0..1. */
export function setCheerVolume(value: number): void {
  volume = Math.min(1, Math.max(0, value));
}

const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, freq: number, at: number, length: number, level: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/** A quick climb up a major chord that lands on a held, bright chord. */
function fanfare(ctx: AudioContext, out: AudioNode, at: number): number {
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 3200;
  soft.connect(out);
  const step = 0.1;
  [72, 76, 79].forEach((note, i) => {
    tone(ctx, soft, 'triangle', hz(note), at + i * step, 0.22, 0.3);
    tone(ctx, soft, 'sawtooth', hz(note), at + i * step, 0.18, 0.07);
  });
  const land = at + 3 * step;
  for (const note of [60, 72, 76, 79, 84]) {
    tone(ctx, soft, 'triangle', hz(note), land, 1.1, note === 84 ? 0.3 : 0.16);
    tone(ctx, soft, 'sawtooth', hz(note), land, 0.8, 0.04);
  }
  return land;
}

/** Tiny bells scattered over a high pentatonic scale. */
function sparkle(ctx: AudioContext, out: AudioNode, at: number, count: number, span: number): void {
  const scale = [84, 86, 88, 91, 93, 96, 98, 100];
  for (let i = 0; i < count; i++) {
    const note = scale[Math.floor(Math.random() * scale.length)];
    const when = at + (i / count) * span + Math.random() * 0.04;
    tone(ctx, out, 'sine', hz(note), when, 0.35, 0.12);
    tone(ctx, out, 'sine', hz(note) * 2.01, when, 0.15, 0.04);
  }
}

/** Many short bursts of filtered noise: a room full of clapping hands. */
function applause(ctx: AudioContext, out: AudioNode, at: number, length: number): void {
  const buffer = noiseBuffer(ctx);
  const claps = Math.round(length * 60);
  for (let i = 0; i < claps; i++) {
    // Dense at the start, thinning out toward the end.
    const when = at + Math.pow(Math.random(), 1.7) * length;
    const fade = 1 - (when - at) / length;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900 + Math.random() * 1800;
    band.Q.value = 0.9 + Math.random();
    const gain = ctx.createGain();
    const level = (0.1 + Math.random() * 0.16) * (0.25 + 0.75 * fade);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05 + Math.random() * 0.05);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(band).connect(gain).connect(pan).connect(out);
    src.start(when, Math.random() * 0.8, 0.15);
  }
}

/** A few voices sliding upward through vowel filters: "woo!" */
function whoops(ctx: AudioContext, out: AudioNode, at: number): void {
  const voices = [
    { f: 330, delay: 0, pan: -0.5 },
    { f: 415, delay: 0.07, pan: 0.4 },
    { f: 262, delay: 0.16, pan: 0.1 },
    { f: 494, delay: 0.5, pan: -0.2 },
  ];
  for (const v of voices) {
    const start = at + v.delay;
    const length = 0.75 + Math.random() * 0.25;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(v.f, start);
    osc.frequency.exponentialRampToValueAtTime(v.f * 1.6, start + 0.22);
    osc.frequency.exponentialRampToValueAtTime(v.f * 1.35, start + length);
    // A slow wobble makes it a voice and not a siren.
    const wobble = ctx.createOscillator();
    const depth = ctx.createGain();
    wobble.frequency.value = 5 + Math.random() * 2;
    depth.gain.value = v.f * 0.02;
    wobble.connect(depth).connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.5, start + 0.07);
    gain.gain.setValueAtTime(0.5, start + length * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    const pan = ctx.createStereoPanner();
    pan.pan.value = v.pan;
    // Two vowel bands that open from "oo" to "ah".
    for (const [from, to, level] of [
      [380, 760, 1],
      [850, 1250, 0.6],
      [2500, 2800, 0.15],
    ] as const) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 6;
      band.frequency.setValueAtTime(from, start);
      band.frequency.linearRampToValueAtTime(to, start + 0.25);
      const bandGain = ctx.createGain();
      bandGain.gain.value = level;
      osc.connect(band).connect(bandGain).connect(gain);
    }
    gain.connect(pan).connect(out);
    osc.start(start);
    wobble.start(start);
    osc.stop(start + length + 0.05);
    wobble.stop(start + length + 0.05);
  }
}

/**
 * Plays a celebration sound. Does nothing where there is no sound output, when
 * the volume is zero, or if another cheer started a moment ago.
 */
export function playCheer(size: CheerSize = 'big'): void {
  if (volume <= 0 || typeof AudioContext === 'undefined') return;
  try {
    const ctx = audioContext();
    if (ctx.state === 'closed') return;
    const now = ctx.currentTime;
    if (lastAt >= 0 && now - lastAt < 0.4) return;
    lastAt = now;
    const out = ctx.createGain();
    out.gain.value = volume * 0.55;
    out.connect(ctx.destination);
    const at = now + 0.03;
    if (size === 'small') {
      sparkle(ctx, out, at, 6, 0.35);
    } else {
      const land = fanfare(ctx, out, at);
      sparkle(ctx, out, land, size === 'big' ? 14 : 8, size === 'big' ? 1.2 : 0.7);
      if (size === 'big') {
        applause(ctx, out, land, 2.6);
        whoops(ctx, out, land + 0.05);
      }
    }
    window.setTimeout(() => out.disconnect(), 5000);
  } catch {
    // A celebration must never break the screen it celebrates.
  }
}
