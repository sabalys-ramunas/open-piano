/**
 * Hearing piano notes in microphone sound. Pure code (no Web Audio), so it
 * runs the same in the browser and in tests.
 *
 * How it works, per frame of about 90 ms, every 11 ms:
 * 1. Spectrum: Hann window, zero-padded FFT.
 * 2. Room noise: a per-frequency noise estimate (follows hum and fans slowly)
 *    is subtracted.
 * 3. Harmonic salience: every piano note gets a score from the peaks at its
 *    harmonics (allowing for piano strings' stretched overtones).
 * 4. Estimate and cancel: the best note is taken, its harmonics removed from
 *    the spectrum, and the search repeats, so the overtones of one note are
 *    not mistaken for other notes. Spectral smoothing keeps a second note
 *    that shares harmonics (an octave) when its partials are clearly louder.
 * 5. Tracking: a note must appear in consecutive frames and line up with an
 *    onset (a sudden rise in energy) before it counts, which rejects noise
 *    and stray overtones; a repeated note is found by a fresh rise in its own
 *    harmonics.
 *
 * Honest limits: one note at a time works well; two notes mostly work;
 * three-note chords and octaves are often incomplete. Latency is roughly
 * 60 to 90 ms, more than a USB piano.
 */

/** In-place radix-2 complex FFT. `re` and `im` must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export interface DetectorOptions {
  sampleRate: number;
  /** 0..1: higher hears quieter notes but also more mistakes. */
  sensitivity?: number;
  /** Measured room noise level (RMS); frames quieter than about twice this are ignored. */
  noiseFloor?: number;
  /** Lowest and highest note searched. */
  low?: number;
  high?: number;
  /** Most notes reported in one frame. */
  maxNotes?: number;
}

export interface FrameNotes {
  /** Note -> salience (strength of evidence), strongest first. */
  notes: Map<number, number>;
  /** Note -> raw energy at its first harmonics, for onsets and loudness. */
  energy: Map<number, number>;
  /** Raw harmonic energy of every note 0..127 this frame (zero when too quiet), for per-note onsets. */
  level: Float64Array;
  /** The same from a short (about 23 ms) window: sharper in time, for spotting a key struck again. */
  quick: Float64Array;
  /** Broadband onset strength of this frame (spectral flux). */
  flux: number;
  rms: number;
}

/** Window length and FFT size for a sample rate: about 90 ms of sound, zero-padded twice. */
export function frameSizes(sampleRate: number): { window: number; fftSize: number; hop: number } {
  const window = sampleRate > 60000 ? 8192 : 4096;
  return { window, fftSize: window * 2, hop: Math.round(sampleRate * 0.0116) };
}

interface Candidate {
  midi: number;
  f0: number;
  weight: number[];
  lo: Int32Array;
  hi: Int32Array;
  /** Bands of the first harmonics in the short spectrum. */
  qlo: Int32Array;
  qhi: Int32Array;
}

/** Finds the notes sounding in one frame. Keeps a little state (noise estimate, previous spectrum). */
export class FrameDetector {
  readonly sampleRate: number;
  readonly window: number;
  readonly fftSize: number;
  private readonly hann: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly mag: Float64Array;
  private readonly work: Float64Array;
  private readonly noise: Float64Array;
  private readonly prevLog: Float64Array;
  private readonly kmax: number;
  private readonly candidates: Candidate[];
  private readonly byMidi = new Map<number, Candidate>();
  private readonly qWindow: number;
  private readonly qHann: Float64Array;
  private readonly qre: Float64Array;
  private readonly qim: Float64Array;
  private readonly qmag: Float64Array;
  private frames = 0;
  sensitivity: number;
  noiseFloor: number;
  readonly maxNotes: number;

  constructor(options: DetectorOptions) {
    this.sampleRate = options.sampleRate;
    const sizes = frameSizes(options.sampleRate);
    this.window = sizes.window;
    this.fftSize = sizes.fftSize;
    this.sensitivity = options.sensitivity ?? 0.5;
    this.noiseFloor = options.noiseFloor ?? 0;
    this.maxNotes = options.maxNotes ?? 4;
    this.hann = new Float64Array(this.window);
    let sum = 0;
    for (let i = 0; i < this.window; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.window - 1));
      sum += this.hann[i];
    }
    // Scale so a sine wave of amplitude A shows a peak of about A.
    const scale = 2 / sum;
    for (let i = 0; i < this.window; i++) this.hann[i] *= scale;
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    const binHz = this.sampleRate / this.fftSize;
    this.kmax = Math.min(this.fftSize / 2 - 1, Math.round(5500 / binHz));
    this.mag = new Float64Array(this.kmax + 1);
    this.work = new Float64Array(this.kmax + 1);
    this.noise = new Float64Array(this.kmax + 1);
    this.prevLog = new Float64Array(this.kmax + 1);
    this.qWindow = this.window / 4;
    this.qHann = new Float64Array(this.qWindow);
    let qsum = 0;
    for (let i = 0; i < this.qWindow; i++) {
      this.qHann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.qWindow - 1));
      qsum += this.qHann[i];
    }
    for (let i = 0; i < this.qWindow; i++) this.qHann[i] *= 2 / qsum;
    this.qre = new Float64Array(this.qWindow * 2);
    this.qim = new Float64Array(this.qWindow * 2);
    const qBinHz = this.sampleRate / (this.qWindow * 2);
    this.qmag = new Float64Array(Math.min(this.qWindow, Math.round(5500 / qBinHz)) + 1);
    const low = Math.max(21, options.low ?? 28);
    const high = Math.min(108, options.high ?? 105);
    this.candidates = [];
    for (let midi = low; midi <= high; midi++) {
      const f0 = midiToHz(midi);
      const weight: number[] = [];
      const lo: number[] = [];
      const hi: number[] = [];
      for (let h = 1; h <= 12; h++) {
        // Piano overtones run sharp: f_h = h f0 sqrt(1 + B h^2). Allow for B up to about 0.0006.
        const fLow = h * f0 * (1 - 0.017);
        const fHigh = h * f0 * Math.sqrt(1 + 0.0006 * h * h) * (1 + 0.017);
        if (fHigh / binHz >= this.kmax) break;
        const center = (h * f0) / binHz;
        lo.push(Math.max(1, Math.min(Math.floor(fLow / binHz), Math.round(center) - 1)));
        hi.push(Math.max(Math.ceil(fHigh / binHz), Math.round(center) + 1));
        weight.push((f0 + 27) / (h * f0 + 320));
      }
      const qlo: number[] = [];
      const qhi: number[] = [];
      for (let h = 1; h <= 4; h++) {
        const center = (h * f0) / qBinHz;
        if (center * 1.03 >= this.qmag.length - 1) break;
        qlo.push(Math.max(1, Math.min(Math.floor(center * 0.97), Math.round(center) - 1)));
        qhi.push(Math.max(Math.ceil(center * 1.03), Math.round(center) + 1));
      }
      if (weight.length > 0) {
        this.candidates.push({
          midi,
          f0,
          weight,
          lo: Int32Array.from(lo),
          hi: Int32Array.from(hi),
          qlo: Int32Array.from(qlo),
          qhi: Int32Array.from(qhi),
        });
      }
    }
    for (const c of this.candidates) this.byMidi.set(c.midi, c);
  }

  /** Salience threshold in spectrum units; sensitivity moves it by about 12 dB either way. */
  private threshold(): number {
    return 0.0012 * 10 ** ((0.5 - this.sensitivity) * 1.2);
  }

  /** Analyses the newest `window` samples of `frame` (older samples are ignored). */
  analyse(frame: Float32Array, isAppSounding?: (midi: number) => boolean): FrameNotes {
    const n = this.window;
    const start = frame.length - n;
    let energy = 0;
    for (let i = 0; i < this.fftSize; i++) {
      if (i < n) {
        const x = start + i >= 0 ? frame[start + i] : 0;
        energy += x * x;
        this.re[i] = x * this.hann[i];
      } else {
        this.re[i] = 0;
      }
      this.im[i] = 0;
    }
    const rms = Math.sqrt(energy / n);
    fft(this.re, this.im);
    const mag = this.mag;
    for (let k = 0; k <= this.kmax; k++) mag[k] = Math.hypot(this.re[k], this.im[k]);

    // Onset strength: how much louder the spectrum got since the last frame (log scale).
    let flux = 0;
    for (let k = 2; k <= this.kmax; k++) {
      const l = Math.log1p(mag[k] * 1000);
      const d = l - this.prevLog[k];
      if (d > 0) flux += d;
      this.prevLog[k] = l;
    }
    flux /= this.kmax;

    // Room noise: falls fast to the quietest level, rises slowly (about 1.3 dB a second).
    this.frames++;
    const work = this.work;
    for (let k = 0; k <= this.kmax; k++) {
      const m = mag[k];
      if (this.frames <= 3) this.noise[k] = this.frames === 1 ? m : Math.min(this.noise[k], m);
      else if (m < this.noise[k]) this.noise[k] = 0.8 * this.noise[k] + 0.2 * m;
      else this.noise[k] *= 1.0015;
      work[k] = Math.max(0, m - 2 * this.noise[k]);
    }

    const notes = new Map<number, number>();
    const energies = new Map<number, number>();
    const level = new Float64Array(128);
    const quick = new Float64Array(128);
    const gate = Math.max(0.0004, this.noiseFloor * 1.5);
    if (rms < gate) return { notes, energy: energies, level, quick, flux, rms };
    for (const c of this.candidates) level[c.midi] = this.rawEnergy(c);
    this.quickSpectrum(frame);
    for (const c of this.candidates) {
      let e = 0;
      for (let h = 0; h < c.qlo.length; h++) {
        let p = 0;
        for (let k = c.qlo[h]; k <= c.qhi[h]; k++) if (this.qmag[k] > p) p = this.qmag[k];
        e += p;
      }
      quick[c.midi] = e;
    }

    const thr = this.threshold();
    let first = 0;
    let found = 0;
    let echoes = 0;
    const peaks: number[] = [];
    const amps: number[] = [];
    for (let round = 0; round < this.maxNotes; round++) {
      let best: Candidate | null = null;
      let bestSal = 0;
      for (const c of this.candidates) {
        if (notes.has(c.midi)) continue;
        const sal = this.salience(c, work);
        if (sal > bestSal) {
          bestSal = sal;
          best = c;
        }
      }
      if (!best) break;
      best = this.preferLowerOctave(best, bestSal, work, notes);
      bestSal = this.salience(best, work);
      if (bestSal < thr) break;
      if (isAppSounding?.(best.midi) && echoes < 8) {
        // The app is playing this note itself (it comes back through the
        // microphone): remove it and its overtones, and keep looking for the
        // player's notes. The player playing the very same note is missed.
        this.cancel(best, work, peaks, amps);
        echoes++;
        round--;
        continue;
      }
      const need = Math.max(thr, first * (found === 1 ? 0.22 : 0.3));
      if (bestSal < need) break;
      if (found === 0) first = bestSal;
      found++;
      notes.set(best.midi, bestSal);
      energies.set(best.midi, level[best.midi]);
      this.cancel(best, work, peaks, amps);
    }
    return { notes, energy: energies, level, quick, flux, rms };
  }

  private quickSpectrum(frame: Float32Array): void {
    const n = this.qWindow;
    const start = frame.length - n;
    for (let i = 0; i < this.qre.length; i++) {
      this.qre[i] = i < n && start + i >= 0 ? frame[start + i] * this.qHann[i] : 0;
      this.qim[i] = 0;
    }
    fft(this.qre, this.qim);
    for (let k = 0; k < this.qmag.length; k++) this.qmag[k] = Math.hypot(this.qre[k], this.qim[k]);
  }

  /** Raw energy of a note's first few harmonics (before any cancelling), for onsets and loudness. */
  private rawEnergy(c: Candidate): number {
    let e = 0;
    for (let h = 0; h < Math.min(4, c.weight.length); h++) {
      let p = 0;
      for (let k = c.lo[h]; k <= c.hi[h]; k++) if (this.mag[k] > p) p = this.mag[k];
      e += p;
    }
    return e;
  }

  /**
   * The note an octave below shares every second harmonic. If that lower note
   * also has clear energy at its odd harmonics (which the higher note cannot
   * explain), the lower note is the one being played.
   */
  private preferLowerOctave(c: Candidate, sal: number, spec: Float64Array, taken: Map<number, number>): Candidate {
    const lower = this.byMidi.get(c.midi - 12);
    if (!lower || taken.has(lower.midi)) return c;
    let odd = 0;
    let fundamental = 0;
    let second = 0;
    for (let h = 0; h < Math.min(2, lower.weight.length); h++) {
      for (let k = lower.lo[h]; k <= lower.hi[h]; k++) {
        if (h === 0) fundamental = Math.max(fundamental, spec[k]);
        else second = Math.max(second, spec[k]);
      }
    }
    for (let h = 0; h < lower.weight.length; h += 2) {
      let p = 0;
      for (let k = lower.lo[h]; k <= lower.hi[h]; k++) if (spec[k] > p) p = spec[k];
      odd += lower.weight[h] * p;
    }
    // The lower note's own fundamental must be clearly there, or a chord's
    // combined overtones would invent a bass note an octave down.
    return odd >= 0.35 * sal && fundamental >= 0.25 * second && fundamental > 0 ? lower : c;
  }

  private salience(c: Candidate, spec: Float64Array): number {
    let sal = 0;
    for (let h = 0; h < c.weight.length; h++) {
      let p = 0;
      for (let k = c.lo[h]; k <= c.hi[h]; k++) if (spec[k] > p) p = spec[k];
      sal += c.weight[h] * p;
    }
    return sal;
  }

  /**
   * Removes a found note's harmonics. Each harmonic is lowered by a smoothed
   * amount (never more than its neighbours suggest), so a louder partial that
   * belongs to another note as well (an octave above) survives.
   */
  private cancel(c: Candidate, spec: Float64Array, peaks: number[], amps: number[]): void {
    const count = c.weight.length;
    peaks.length = 0;
    amps.length = 0;
    for (let h = 0; h < count; h++) {
      let p = 0;
      let at = c.lo[h];
      for (let k = c.lo[h]; k <= c.hi[h]; k++) {
        if (spec[k] > p) {
          p = spec[k];
          at = k;
        }
      }
      peaks.push(at);
      amps.push(p);
    }
    for (let h = 0; h < count; h++) {
      const neighbours = [amps[h - 1], amps[h], amps[h + 1]].filter((x) => x !== undefined);
      const mean = neighbours.reduce((s, x) => s + x, 0) / neighbours.length;
      // The fundamental carries the note itself: remove it fully.
      const amount = h < 1 ? amps[h] : Math.min(amps[h], mean * 1.15);
      const at = peaks[h];
      // The window's main lobe is 4 bins wide each side at this zero-padding.
      for (let k = Math.max(0, Math.min(at - 4, c.lo[h])); k <= Math.min(this.kmax, Math.max(at + 4, c.hi[h])); k++) {
        spec[k] = Math.max(0, spec[k] - amount);
      }
    }
  }
}

export interface NoteEvent {
  type: 'on' | 'off';
  midi: number;
  /** 0..1, from how loud the note was (on events). */
  velocity: number;
  /** Seconds since the tracker started (end of the frame that decided it). */
  time: number;
}

export interface TrackerOptions extends DetectorOptions {
  /** True while the app itself is making this note (its sound may come back through the microphone). */
  isAppSounding?: (midi: number) => boolean;
}

interface Active {
  onFrame: number;
  misses: number;
  peak: number;
  /** Frame where this note seemed to be struck again, waiting to be confirmed; -1 for none. */
  restrikeAt: number;
}

const HISTORY = 8;

/**
 * Turns microphone samples into note on and off events. Feed it any number of
 * samples at a time with `push`.
 */
export class NoteTracker {
  readonly detector: FrameDetector;
  private readonly hop: number;
  private readonly ring: Float32Array;
  private filled = 0;
  private consumed = 0;
  private sinceHop = 0;
  private frame = 0;
  private active = new Map<number, Active>();
  private pending = new Map<number, { count: number; rose: boolean }>();
  private levels = new Float64Array(HISTORY * 128);
  private lastOff = new Map<number, number>();
  private fluxHistory: number[] = [];
  private lastOnsetFrame = -100;
  private readonly isAppSounding?: (midi: number) => boolean;

  constructor(options: TrackerOptions) {
    this.detector = new FrameDetector(options);
    this.hop = frameSizes(options.sampleRate).hop;
    this.ring = new Float32Array(this.detector.window);
    this.isAppSounding = options.isAppSounding;
  }

  set sensitivity(value: number) {
    this.detector.sensitivity = value;
  }

  set noiseFloor(value: number) {
    this.detector.noiseFloor = value;
  }

  /** Notes currently reported as down. */
  get held(): number[] {
    return [...this.active.keys()].sort((a, b) => a - b);
  }

  push(samples: Float32Array): NoteEvent[] {
    const events: NoteEvent[] = [];
    const ring = this.ring;
    const n = ring.length;
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(samples.length - i, this.hop - this.sinceHop);
      // Shift the window left and append (simple and fast enough at this size).
      ring.copyWithin(0, take);
      ring.set(samples.subarray(i, i + take), n - take);
      this.filled = Math.min(n, this.filled + take);
      this.sinceHop += take;
      this.consumed += take;
      i += take;
      if (this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.filled >= n / 2) this.step(events);
      }
    }
    return events;
  }

  /** Lets go of every note (the microphone stopped). */
  flush(): NoteEvent[] {
    const time = this.time();
    const events = [...this.active.keys()].map((midi): NoteEvent => ({ type: 'off', midi, velocity: 0, time }));
    this.active.clear();
    this.pending.clear();
    return events;
  }

  private time(): number {
    return this.consumed / this.detector.sampleRate;
  }

  private step(events: NoteEvent[]): void {
    this.frame++;
    const f = this.frame;
    const result = this.detector.analyse(this.ring, this.isAppSounding);
    const time = this.time();

    // Broadband onset: flux well above its recent typical level.
    const fh = this.fluxHistory;
    const typical = fh.length ? [...fh].sort((a, b) => a - b)[fh.length >> 1] : 0;
    if (result.flux > typical * 1.6 + 0.02) this.lastOnsetFrame = f;
    fh.push(result.flux);
    if (fh.length > 16) fh.shift();
    const recentOnset = f - this.lastOnsetFrame <= 4;

    // Per-note energy history (last HISTORY frames), for "is this note rising?"
    const slot = f % HISTORY;
    this.levels.set(result.quick, slot * 128);
    const past = (midi: number, back: number): number =>
      f - back < 1 ? 0 : this.levels[((f - back) % HISTORY) * 128 + midi];
    /** Lowest level of a note over the frames 2..6 ago. */
    const floorOf = (midi: number): number => {
      let m = Infinity;
      for (let b = 2; b <= 6; b++) m = Math.min(m, past(midi, b));
      return m;
    };
    // How sharply each heard note is rising. A hammer strike makes every band
    // jump a little; only the note actually struck jumps a lot.
    let qMax = 0;
    for (const midi of result.notes.keys()) qMax = Math.max(qMax, result.quick[midi]);
    const rise = (midi: number): number => result.quick[midi] / (floorOf(midi) + 0.05 * qMax + 1e-9);
    let maxRise = 0;
    for (const midi of result.notes.keys()) maxRise = Math.max(maxRise, rise(midi));

    // Notes already down: still there? struck again?
    for (const [midi, a] of [...this.active]) {
      const e = result.level[midi];
      const q = result.quick[midi];
      const seen = result.notes.has(midi);
      a.misses = seen ? 0 : a.misses + 1;
      if (a.misses >= 3 || e < a.peak * 0.03) {
        this.active.delete(midi);
        this.lastOff.set(midi, f);
        events.push({ type: 'off', midi, velocity: 0, time });
        continue;
      }
      const rising =
        seen &&
        f - a.onFrame >= 5 &&
        (recentOnset || q > 3 * floorOf(midi)) &&
        q > 2 * floorOf(midi) &&
        q > 1.5 * past(midi, 2) &&
        rise(midi) >= 0.6 * maxRise &&
        e > 0.2 * a.peak;
      if (rising && a.restrikeAt < 0) a.restrikeAt = f;
      // Wait three frames before believing it: a new note right next to this
      // one also lifts its bands in the short window, and by then the long
      // window shows whether a neighbour has started instead.
      let restruck = false;
      if (a.restrikeAt >= 0 && f - a.restrikeAt >= 3) {
        const mine = result.notes.get(midi) ?? 0;
        const neighbourStarted = [-2, -1, 1, 2].some((d) => {
          const other = this.active.get(midi + d);
          const theirs = result.notes.get(midi + d) ?? 0;
          return theirs > 0.6 * mine || (other !== undefined && other.onFrame >= a.restrikeAt - 2);
        });
        restruck = seen && !neighbourStarted;
        a.restrikeAt = -1;
      }
      if (restruck) {
        // A fresh rise in this note's own harmonics: the key was played again.
        events.push({ type: 'off', midi, velocity: 0, time });
        events.push({ type: 'on', midi, velocity: this.velocity(e), time });
        this.active.set(midi, { onFrame: f, misses: 0, peak: e, restrikeAt: -1 });
        continue;
      }
      a.peak = Math.max(a.peak, e);
    }

    // New notes: seen in three frames in a row, rising in their own harmonics, near an onset.
    for (const midi of [...this.pending.keys()]) if (!result.notes.has(midi)) this.pending.delete(midi);
    const strongest = Math.max(0, ...result.notes.values());
    for (const [midi, sal] of result.notes) {
      if (this.active.has(midi)) continue;
      const e = result.level[midi];
      const q = result.quick[midi];
      const p = this.pending.get(midi) ?? { count: 0, rose: false };
      // Rising: louder than a few frames ago. A decaying leftover never rises.
      // Frames are counted from the rise, so a fading note cannot bank them early.
      if (q > 1.4 * floorOf(midi) && rise(midi) >= 0.3 * maxRise) p.rose = true;
      if (p.rose) p.count++;
      this.pending.set(midi, p);
      // Probably an overtone of a lower note (octave, octave and a fifth, two octaves).
      const shadow = [12, 19, 24].some((d) => {
        const lower = midi - d;
        const lowerSal = result.notes.get(lower) ?? 0;
        const act = this.active.get(lower);
        return lowerSal > sal * 3 || (act !== undefined && act.peak > e * 1.5 && !(q > 2 * floorOf(midi)));
      });
      // A close neighbour that is much stronger right now: leakage from it, or hammer noise.
      const crowded = [-2, -1, 1, 2].some((d) => (result.notes.get(midi + d) ?? 0) > sal * 1.8);
      // A note that only just stopped, coming back while a neighbour starts, is that neighbour's hammer noise.
      const justOff = f - (this.lastOff.get(midi) ?? -100) < 30;
      const neighbourNew = [-2, -1, 1, 2].some((d) => {
        const other = this.active.get(midi + d);
        return (other !== undefined && f - other.onFrame < 4) || (result.notes.get(midi + d) ?? 0) > sal;
      });
      const ghost = justOff && (neighbourNew || p.count < 5);
      // Much weaker than another note heard right now: probably a stray partial of it. Wait longer.
      const dominated = strongest > sal * 3 && p.count < 6;
      const ready = p.count >= 3 && p.rose && !crowded && !shadow && !ghost && !dominated && (recentOnset || p.count >= 7);
      if (!ready) continue;
      this.pending.delete(midi);
      this.active.set(midi, { onFrame: f, misses: 0, peak: e, restrikeAt: -1 });
      events.push({ type: 'on', midi, velocity: this.velocity(e), time });
    }
  }

  private velocity(energy: number): number {
    // About -45 dB (very soft) to -6 dB (very loud) of full scale.
    const db = 20 * Math.log10(Math.max(1e-6, energy));
    return Math.min(1, Math.max(0.1, (db + 45) / 39));
  }
}
