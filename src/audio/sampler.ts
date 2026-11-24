import { audioContext } from './context';
import type { Instrument } from './instrument';
import { roomImpulse } from './reverb';
import { Synth } from './synth';

/**
 * A recorded grand piano (Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0;
 * see public/samples/piano/CREDITS.txt). Thirty notes, a minor third apart,
 * in a soft and a loud layer; the notes in between are pitch-shifted by at
 * most one semitone. While the recordings download, or if they cannot be
 * loaded, the small synth plays instead, so a key press always makes a sound.
 */

export type Layer = 'p' | 'f';

/** The recorded notes: A0, C1, D#1 ... C8. */
export const SAMPLE_NOTES: readonly number[] = Array.from({ length: 30 }, (_, i) => 21 + 3 * i);
export const LAYERS: readonly Layer[] = ['p', 'f'];

/** Most voices sounding at once. A real piano has 88 strings; 48 voices is plenty with the pedal down. */
export const MAX_VOICES = 48;

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
export const SAMPLE_DIR = `${BASE}samples/piano/`;
const CACHE_NAME = 'piano-samples-v1';

export function sampleUrl(note: number, layer: Layer): string {
  return `${SAMPLE_DIR}${note}${layer}.mp3`;
}

export function layerFor(velocity: number): Layer {
  return velocity < 0.5 ? 'p' : 'f';
}

export interface SampleChoice {
  note: number;
  layer: Layer;
  /** Playback rate that turns the recorded note into the wanted one. */
  rate: number;
}

function nearest(midi: number, layer: Layer, has: (note: number, layer: Layer) => boolean): { note: number; dist: number } {
  let note = -1;
  let dist = Infinity;
  for (const n of SAMPLE_NOTES) {
    if (!has(n, layer)) continue;
    const d = Math.abs(n - midi);
    // On a tie, shift a higher recording down: that sounds more natural than shifting up.
    if (d < dist || (d === dist && n > midi)) {
      note = n;
      dist = d;
    }
  }
  return { note, dist };
}

/**
 * Which recording plays `midi` at `velocity`, given which recordings are
 * loaded. Prefers the right loudness layer, but takes the other layer rather
 * than shifting a note far. Null means nothing usable yet (use the synth).
 */
export function pickSample(
  midi: number,
  velocity: number,
  has: (note: number, layer: Layer) => boolean,
): SampleChoice | null {
  const want = layerFor(velocity);
  const other: Layer = want === 'p' ? 'f' : 'p';
  const a = nearest(midi, want, has);
  let pick: { note: number; dist: number; layer: Layer } = { ...a, layer: want };
  if (a.dist > 1) {
    const b = nearest(midi, other, has);
    if (b.dist < a.dist) pick = { ...b, layer: other };
  }
  if (pick.note < 0 || pick.dist > 6) return null;
  return { note: pick.note, layer: pick.layer, rate: 2 ** ((midi - pick.note) / 12) };
}

/** Loudness for a key velocity, so the soft and loud recordings join up smoothly. */
export function velocityGain(velocity: number, layer: Layer): number {
  const v = Math.min(1, Math.max(0, velocity));
  const g = layer === 'p' ? 0.12 + 1.76 * v : 0.55 + 0.9 * (v - 0.5);
  return Math.max(0.03, g);
}

/** Soft notes sound darker, hard notes brighter: the cut-off of a gentle low-pass filter in Hz. */
export function brightness(velocity: number, midi: number): number {
  const v = Math.min(1, Math.max(0, velocity));
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  return Math.min(18000, 900 + f0 * 2 + 17000 * v * v);
}

/** How fast a released key goes quiet (time constant in seconds). The top keys have no dampers. */
export function releaseTau(midi: number): number {
  if (midi >= 90) return 0.6;
  return 0.07 + (0.12 * (108 - Math.min(108, Math.max(21, midi)))) / 87;
}

/** Time constant for sustained notes when the pedal is only part-way down. Infinity means it holds. */
export function halfPedalTau(depth: number): number {
  if (depth >= 0.6) return Infinity;
  if (depth <= 0.15) return 0;
  return 0.2 + ((depth - 0.15) / 0.45) * 2.5;
}

/** Where the sound really starts in a decoded recording (MP3 adds a little silence in front). */
export function onsetOffset(data: Float32Array, sampleRate: number): number {
  const scan = Math.min(data.length, Math.round(sampleRate * 0.3));
  let peak = 0;
  for (let i = 0; i < scan; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak === 0) return 0;
  const threshold = peak * 0.02;
  for (let i = 0; i < scan; i++) {
    if (Math.abs(data[i]) > threshold) return Math.max(0, i - 16) / sampleRate;
  }
  return 0;
}

export type PianoLoadState = 'idle' | 'loading' | 'ready' | 'partial' | 'failed';
export interface PianoStatus {
  state: PianoLoadState;
  loaded: number;
  total: number;
}

let status: PianoStatus = { state: 'idle', loaded: 0, total: SAMPLE_NOTES.length * LAYERS.length };
const statusListeners = new Set<(s: PianoStatus) => void>();

/** How far the piano recordings have loaded, for the settings screen. */
export function pianoStatus(): PianoStatus {
  return status;
}

export function onPianoStatus(listener: (s: PianoStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(next: PianoStatus): void {
  status = next;
  for (const l of statusListeners) l(status);
}

/**
 * True for a usable answer. Custom-scheme origins (an app shell such as
 * piano://app/ inside a WKWebView) answer with status 0 instead of 200, so a
 * non-empty body with status 0 counts as fine too.
 */
export function usableResponse(status: number, bytes: number): boolean {
  return (status >= 200 && status < 300) || (status === 0 && bytes > 0);
}

/** The Cache API only takes http(s) addresses, and only exists in secure contexts. */
function cacheable(url: string): boolean {
  if (typeof caches === 'undefined' || typeof location === 'undefined') return false;
  try {
    return /^https?:$/.test(new URL(url, location.href).protocol);
  } catch {
    return false;
  }
}

/**
 * Cancels every sample download when the page goes away. Left to the browser,
 * WebKit reports each request it cuts off at a reload or navigation as a page
 * error ("... due to access control checks"), although nothing was wrong.
 */
let leaving: AbortController | null = null;
function leaveSignal(): AbortSignal | undefined {
  if (typeof AbortController === 'undefined' || typeof window === 'undefined') return undefined;
  if (!leaving) {
    const controller = new AbortController();
    leaving = controller;
    const stop = () => controller.abort();
    window.addEventListener('pagehide', stop, { once: true });
    window.addEventListener('beforeunload', stop, { once: true });
  }
  return leaving.signal;
}

function aborted(): boolean {
  return Boolean(leaving?.signal.aborted);
}

async function download(url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url, { signal: leaveSignal() });
    const data = await response.arrayBuffer();
    if (usableResponse(response.status, data.byteLength)) return data;
    throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  } catch (error) {
    // Some app shells serve their own scheme to XMLHttpRequest but not to fetch.
    if (typeof XMLHttpRequest === 'undefined' || aborted()) throw error;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        const data = xhr.response as ArrayBuffer | null;
        if (data && usableResponse(xhr.status, data.byteLength)) resolve(data);
        else reject(error instanceof Error ? error : new Error(`Could not download ${url}`));
      };
      xhr.onerror = () => reject(error instanceof Error ? error : new Error(`Could not download ${url}`));
      xhr.send();
    });
  }
}

/** Downloads a recording once and keeps it in the browser's cache for next time (and offline). */
async function fetchSample(url: string): Promise<ArrayBuffer> {
  if (cacheable(url)) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return await hit.arrayBuffer();
      const response = await fetch(url, { signal: leaveSignal() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      void cache.put(url, response.clone()).catch(() => {});
      return await response.arrayBuffer();
    } catch (error) {
      if (aborted()) throw error;
      // fall through to a plain download (private windows can refuse the cache)
    }
  }
  try {
    return await download(url);
  } catch (error) {
    if (aborted()) throw error;
    // One more try after a moment: a busy network or a request cut short by the browser.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return download(url);
  }
}

export type SampleLoader = (note: number, layer: Layer, ctx: BaseAudioContext) => Promise<AudioBuffer>;

const defaultLoader: SampleLoader = async (note, layer, ctx) => ctx.decodeAudioData(await fetchSample(sampleUrl(note, layer)));

interface Voice {
  midi: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  level: number;
  started: number;
  /** Key is down. */
  held: boolean;
  /** Key is up but the pedal keeps it ringing. */
  sustained: boolean;
  /** Played by the app with a known length; ignores the pedal. */
  timed: boolean;
  done: boolean;
}

export interface SampledPianoOptions {
  /** The audio context to play into. Defaults to the shared one. */
  context?: () => BaseAudioContext;
  loader?: SampleLoader;
  /** What plays while recordings load or when they fail. Defaults to the synth. */
  fallback?: Instrument;
  maxVoices?: number;
}

function holdParam(param: AudioParam, at: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(at);
  } else {
    const value = param.value;
    param.cancelScheduledValues(at);
    param.setValueAtTime(value, at);
  }
}

export class SampledPiano implements Instrument {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private buffers = new Map<string, { buffer: AudioBuffer; offset: number }>();
  private voices: Voice[] = [];
  private synthNotes = new Set<number>();
  private volume = 0.8;
  private reverb = 0.25;
  private pedal = false;
  private depth = 1;
  private loading: Promise<void> | null = null;
  private readonly fallback: Instrument;
  private readonly loader: SampleLoader;
  private readonly maxVoices: number;

  constructor(private options: SampledPianoOptions = {}) {
    this.fallback = options.fallback ?? new Synth();
    this.loader = options.loader ?? defaultLoader;
    this.maxVoices = options.maxVoices ?? MAX_VOICES;
  }

  /** Voices sounding now. For tests and the settings screen. */
  get voiceCount(): number {
    return this.voices.length;
  }

  /** True once at least one recording is ready. */
  get hasSamples(): boolean {
    return this.buffers.size > 0;
  }

  wake(): void {
    this.fallback.wake();
    if (!this.ctx) {
      if (!this.options.context && typeof AudioContext === 'undefined') return; // no Web Audio: play silently
      const ctx = this.options.context ? this.options.context() : audioContext();
      this.ctx = ctx;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      this.master = ctx.createGain();
      this.master.gain.value = this.level();
      this.dry = ctx.createGain();
      this.dry.connect(this.master);
      this.master.connect(limiter).connect(ctx.destination);
      this.buildReverb(ctx);
    }
    const ctx = this.ctx;
    const live = ctx as Partial<AudioContext>;
    if (live.state === 'suspended' && typeof live.resume === 'function') void live.resume.call(ctx);
    if (!this.loading) this.loading = this.loadAll(ctx);
  }

  /** Resolves when loading has finished (or failed). For tests. */
  ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  private buildReverb(ctx: BaseAudioContext): void {
    if (!this.dry || !this.master) return;
    try {
      const convolver = ctx.createConvolver();
      const channels = roomImpulse(ctx.sampleRate, 2);
      const buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate);
      channels.forEach((data, c) => buffer.getChannelData(c).set(data));
      convolver.buffer = buffer;
      this.wet = ctx.createGain();
      this.wet.gain.value = this.wetLevel();
      this.dry.connect(convolver).connect(this.wet).connect(this.master);
    } catch (error) {
      console.warn('Room echo is not available in this browser.', error);
    }
  }

  /** Master gain: a little headroom so chords reach the limiter gently. */
  private level(): number {
    return this.volume * 0.75;
  }

  private wetLevel(): number {
    return this.reverb * 0.45;
  }

  setReverb(amount: number): void {
    this.reverb = Math.min(1, Math.max(0, amount));
    if (this.wet && this.ctx) this.wet.gain.setTargetAtTime(this.wetLevel(), this.ctx.currentTime, 0.05);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.fallback.setVolume(this.volume);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.02);
  }

  private async loadAll(ctx: BaseAudioContext): Promise<void> {
    // Middle of the keyboard first, soft layer before loud: that is what beginners play.
    const jobs = SAMPLE_NOTES.flatMap((note) => LAYERS.map((layer) => ({ note, layer }))).sort(
      (a, b) => Math.abs(a.note - 62) - Math.abs(b.note - 62) || (a.layer === 'p' ? -1 : 1),
    );
    const total = jobs.length;
    let failed = 0;
    let next = 0;
    setStatus({ state: 'loading', loaded: 0, total });
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          const buffer = await this.loader(job.note, job.layer, ctx);
          this.buffers.set(`${job.note}${job.layer}`, {
            buffer,
            offset: onsetOffset(buffer.getChannelData(0), buffer.sampleRate),
          });
          setStatus({ state: 'loading', loaded: this.buffers.size, total });
        } catch (error) {
          failed++;
          if (aborted()) return; // the page is going away
          if (failed === 1) console.warn('A piano recording could not be loaded; the simple piano fills in.', error);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const loaded = this.buffers.size;
    setStatus({ state: loaded === 0 ? 'failed' : failed > 0 ? 'partial' : 'ready', loaded, total });
  }

  private has = (note: number, layer: Layer): boolean => this.buffers.has(`${note}${layer}`);

  /** Starts a recorded voice, or returns false when no recording fits yet. */
  private startVoice(midi: number, velocity: number, timed: boolean, at?: number): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !this.dry) return null;
    const choice = pickSample(midi, velocity, this.has);
    if (!choice) return null;
    const sample = this.buffers.get(`${choice.note}${choice.layer}`);
    if (!sample) return null;
    const now = Math.max(ctx.currentTime, at ?? 0);

    // A key struck again while still ringing: the hammer stops the old sound quickly.
    for (const v of this.voices) if (v.midi === midi && !v.done) this.fade(v, now, 0.04);
    while (this.voices.length >= this.maxVoices) this.steal(ctx.currentTime);

    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = choice.rate;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = brightness(velocity, midi);
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    const level = velocityGain(velocity, choice.layer);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.002);
    source.connect(filter).connect(gain).connect(this.dry);
    source.start(now, sample.offset);
    const voice: Voice = { midi, source, gain, level, started: now, held: !timed, sustained: false, timed, done: false };
    source.onended = () => {
      voice.done = true;
      this.drop(voice);
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
    };
    this.voices.push(voice);
    return voice;
  }

  private drop(voice: Voice): void {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Fades a voice out with time constant `tau` and stops it when silent. */
  private fade(v: Voice, at: number, tau: number): void {
    if (v.done) return;
    holdParam(v.gain.gain, at);
    v.gain.gain.setTargetAtTime(0, at, tau);
    try {
      v.source.stop(at + tau * 7);
    } catch {
      // already stopped
    }
    v.held = false;
    v.sustained = false;
  }

  /** Makes room for a new voice: a fading one first, then a pedalled one, then the oldest. */
  private steal(now: number): void {
    // Notes scheduled a moment ahead have not sounded yet: steal those last.
    const free = (v: Voice): boolean => !v.held && !v.sustained && v.started <= now;
    const victim =
      this.voices.find(free) ?? this.voices.find((v) => v.sustained) ?? this.voices.find((v) => v.started <= now) ?? this.voices[0];
    if (!victim) return;
    holdParam(victim.gain.gain, now);
    victim.gain.gain.setTargetAtTime(0, now, 0.005);
    try {
      victim.source.stop(now + 0.04);
    } catch {
      // already stopped
    }
    victim.done = true;
    this.drop(victim);
  }

  noteOn(midi: number, velocity = 0.8): void {
    if (!this.ctx) return;
    if (this.synthNotes.has(midi)) {
      this.synthNotes.delete(midi);
      this.fallback.noteOff(midi);
    }
    if (this.startVoice(midi, velocity, false)) return;
    this.synthNotes.add(midi);
    this.fallback.noteOn(midi, velocity);
  }

  noteOff(midi: number): void {
    if (this.synthNotes.delete(midi)) this.fallback.noteOff(midi);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      if (v.midi !== midi || !v.held) continue;
      v.held = false;
      if (this.pedal) {
        v.sustained = true;
        this.applyDepth(v, now);
      } else {
        this.fade(v, now, releaseTau(midi));
      }
    }
  }

  sustain(on: boolean): void {
    this.fallback.sustain?.(on);
    this.pedal = on;
    if (on) {
      if (this.depth < 0.2) this.depth = 1; // a plain on/off pedal
      return;
    }
    this.depth = 0;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of [...this.voices]) if (v.sustained) this.fade(v, now, releaseTau(v.midi));
  }

  pedalDepth(depth: number): void {
    this.depth = Math.min(1, Math.max(0, depth));
    if (!this.ctx || !this.pedal) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) if (v.sustained) this.applyDepth(v, now);
  }

  /** Part-way pedal lets sustained notes die away faster, like dampers lightly touching the strings. */
  private applyDepth(v: Voice, now: number): void {
    const tau = halfPedalTau(this.depth);
    holdParam(v.gain.gain, now);
    if (tau === Infinity) return;
    if (tau === 0) {
      this.fade(v, now, releaseTau(v.midi));
      return;
    }
    v.gain.gain.setTargetAtTime(0, now, tau);
  }

  play(midi: number, seconds: number, velocity = 0.6, delay = 0): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + Math.max(0, delay);
    const v = this.startVoice(midi, velocity, true, at);
    if (!v) {
      this.fallback.play(midi, seconds, velocity, delay);
      return;
    }
    const end = v.started + Math.max(0.08, seconds);
    v.gain.gain.setTargetAtTime(0, end, releaseTau(midi));
    try {
      v.source.stop(end + releaseTau(midi) * 7);
    } catch {
      // already stopped
    }
  }

  /** Silences timed notes that were scheduled ahead and have not started yet. */
  cancelPending(): void {
    this.fallback.cancelPending?.();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of [...this.voices]) {
      if (!v.timed || v.started <= now) continue;
      v.done = true;
      this.drop(v);
      try {
        v.source.stop();
      } catch {
        // already stopped
      }
      try {
        v.gain.disconnect();
      } catch {
        // already disconnected
      }
    }
  }

  allOff(): void {
    this.cancelPending();
    this.fallback.allOff?.();
    for (const midi of this.synthNotes) this.fallback.noteOff(midi);
    this.synthNotes.clear();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of [...this.voices]) this.fade(v, now, 0.05);
  }
}
