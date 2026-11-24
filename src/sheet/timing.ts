/**
 * Turns note times in seconds into a rhythm grid: tempo, meter and quantised
 * positions. Works for hand-made songs (exact grid), songs with beat times
 * from a recording, and free human timing (tempo estimated from the notes).
 * Pure functions, no DOM.
 */
import type { Hand, TimeSignature } from '../song';

/** Ticks per quarter note. One tick is a sixteenth. */
export const TPQ = 4;

/** Piecewise linear map between seconds and ticks. Both arrays ascend; at least two points. */
export interface TimeMap {
  times: number[];
  ticks: number[];
}

export interface TimingNote {
  midi: number;
  start: number;
  dur: number;
  hand: Hand;
}

export interface QNote {
  /** Index into the song's notes. */
  index: number;
  midi: number;
  hand: Hand;
  tick: number;
  len: number;
  /** Sounding length in ticks before rounding. */
  rawLen: number;
}

export interface MetricTiming {
  kind: 'metric';
  map: TimeMap;
  meter: TimeSignature;
  /** Tick of a bar line; all bar lines are origin + k * barTicks. */
  origin: number;
  notes: QNote[];
  /** Quarter notes per minute at the start. */
  bpm: number;
  /** How well notes sat on the grid: 0 perfect, 1 no better than chance. */
  error: number;
}

export interface FreeTiming {
  kind: 'free';
  error: number;
}

export type Timing = MetricTiming | FreeTiming;

export interface TimingInput {
  notes: readonly TimingNote[];
  bpm?: number;
  beats?: readonly number[];
  timeSignature?: TimeSignature;
  /** True for songs made from recordings: favours legato over many small rests. */
  recorded?: boolean;
}

// Above this grid error the timing is treated as free (no rhythm notation).
const FREE_ERROR = 0.95;
const CHORD_WINDOW = 0.045;

// ---------------------------------------------------------------- maps

function segment(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 2;
  if (x <= xs[0]) return 0;
  if (x >= xs[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (xs.length < 2) return ys[0] ?? 0;
  const i = segment(xs, x);
  const dx = xs[i + 1] - xs[i];
  return ys[i] + (dx > 0 ? ((x - xs[i]) * (ys[i + 1] - ys[i])) / dx : 0);
}

export const tickAt = (map: TimeMap, t: number): number => interp(map.times, map.ticks, t);
export const timeAt = (map: TimeMap, tick: number): number => interp(map.ticks, map.times, tick);

export function linearMap(origin: number, secondsPerQuarter: number): TimeMap {
  return { times: [origin, origin + secondsPerQuarter], ticks: [0, TPQ] };
}

// ---------------------------------------------------------------- onsets

interface Onset {
  t: number;
  notes: number[];
}

function clusterOnsets(notes: readonly TimingNote[]): Onset[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start);
  const out: Onset[] = [];
  for (const i of order) {
    const last = out[out.length - 1];
    if (last && notes[i].start - last.t < CHORD_WINDOW) last.notes.push(i);
    else out.push({ t: notes[i].start, notes: [i] });
  }
  return out;
}

// ---------------------------------------------------------------- tempo

interface Fit {
  map: TimeMap;
  error: number;
  q: number;
}

/**
 * Follows the notes with a sixteenth grid, nudging phase and tempo after each
 * onset so slow drifts in human playing do not throw the grid off.
 */
function track(times: readonly number[], q: number): Fit {
  const g0 = q / TPQ;
  let anchorT = times[0];
  let anchorTick = 0;
  let period = g0;
  const mapTimes = [anchorT];
  const mapTicks = [0];
  let total = 0;
  for (const t of times) {
    const x = anchorTick + (t - anchorT) / period;
    // Snap to the coarsest grid that is close: beats and eighths forgive
    // more, since that is where most notes fall.
    const kb = Math.round(x / TPQ) * TPQ;
    const ke = Math.round(x / 2) * 2;
    const k = Math.abs(x - kb) <= 0.7 ? kb : Math.abs(x - ke) <= 0.5 ? ke : Math.round(x);
    const e = x - k;
    total += Math.min(0.5, Math.abs(x - Math.round(x)));
    if (Math.abs(e) < 0.7 && t > anchorT + 1e-6 && k > anchorTick - 0.5) {
      const dist = Math.max(1, k - Math.round(anchorTick));
      period *= 1 + (0.3 * e) / Math.max(dist, 2);
      period = Math.min(g0 * 1.3, Math.max(g0 / 1.3, period));
      anchorTick = k + e * 0.3;
      anchorT = t;
      if (anchorTick > mapTicks[mapTicks.length - 1] + 1e-6) {
        mapTimes.push(t);
        mapTicks.push(anchorTick);
      }
    }
  }
  if (mapTimes.length < 2) {
    mapTimes.push(anchorT + period * 4);
    mapTicks.push(anchorTick + 4);
  } else {
    // Keep going at the final tempo past the last onset.
    const last = mapTimes.length - 1;
    mapTimes.push(mapTimes[last] + period * 16);
    mapTicks.push(mapTicks[last] + 16);
  }
  return { map: { times: mapTimes, ticks: mapTicks }, error: total / times.length / 0.25, q };
}

function mapError(times: readonly number[], map: TimeMap): number {
  let total = 0;
  for (const t of times) {
    const x = tickAt(map, t);
    total += Math.min(0.5, Math.abs(x - Math.round(x)));
  }
  return total / Math.max(1, times.length) / 0.25;
}

/** Prior over tempo: about 100 quarter notes per minute is most likely. */
const tempoCost = (q: number) => 0.6 * Math.log2(q / 0.62) ** 2;

function ioiClusters(times: readonly number[]): number[] {
  const iois: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0.07 && d < 2.5) iois.push(d);
  }
  iois.sort((a, b) => a - b);
  const groups: { sum: number; n: number }[] = [];
  for (const d of iois) {
    const g = groups[groups.length - 1];
    if (g && d < (g.sum / g.n) * 1.1) {
      g.sum += d;
      g.n++;
    } else groups.push({ sum: d, n: 1 });
  }
  return groups
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((g) => g.sum / g.n);
}

function validBeats(beats: readonly number[] | undefined): beats is readonly number[] {
  if (!beats || beats.length < 4) return false;
  for (let i = 1; i < beats.length; i++) if (!(beats[i] > beats[i - 1])) return false;
  return beats.every(Number.isFinite);
}

/**
 * How well a grid explains the onsets, read the way a person would write
 * them: each beat uses the coarsest subdivision that fits. Returns the mean
 * distance in seconds from each onset to its written position, and how busy
 * the rhythm looks (0 when every onset is on a beat, 1 when all are on
 * off-beat sixteenths).
 */
function gridCost(times: readonly number[], map: TimeMap): { seconds: number; busy: number } {
  const xs = times.map((t) => tickAt(map, t));
  let best = { seconds: Infinity, busy: 1 };
  for (let r = 0; r < TPQ; r++) {
    const snapped = snapOnsets(xs, r, TPQ);
    let err = 0;
    let busy = 0;
    snapped.forEach((k, i) => {
      err += Math.abs(timeAt(map, k) - times[i]);
      const p = (((k - r) % TPQ) + TPQ) % TPQ;
      busy += p === 0 ? 0 : p % 2 === 0 ? 0.5 : 1;
    });
    const n = Math.max(1, times.length);
    const cand = { seconds: err / n, busy: busy / n };
    if (cand.seconds / 0.025 + 0.25 * cand.busy < best.seconds / 0.025 + 0.25 * best.busy) best = cand;
  }
  return best;
}

function bestFit(times: readonly number[], input: TimingInput): Fit | null {
  let best: { fit: Fit; score: number } | null = null;
  const consider = (fit: Fit, bonus: number) => {
    const cost = gridCost(times, fit.map);
    const score = cost.seconds / 0.025 + 0.25 * cost.busy + tempoCost(fit.q) - (cost.seconds < 0.03 ? bonus : 0);
    if (!best || score < best.score) best = { fit, score };
  };

  if (validBeats(input.beats)) {
    const beats = input.beats;
    const spacing = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    // Beats count the time signature's unit: eighths in 3/8 or 6/8, halves in 2/2.
    // A written time signature with beat times (from a MIDI file) is trusted strongly.
    const written = validMeter(input.timeSignature);
    const unit = written ? input.timeSignature!.unit : 4;
    const preferred = unit === 8 ? 0.5 : unit === 2 ? 2 : 1;
    for (const scale of [1, 2, 0.5] as const) {
      const bonus = scale === preferred ? (written && preferred !== 1 ? 1.5 : 0.25) : 0;
      const map = { times: [...beats], ticks: beats.map((_, i) => i * TPQ * scale) };
      consider({ map, error: mapError(times, map), q: spacing / scale }, bonus);
    }
    const b = best as { fit: Fit; score: number } | null;
    if (b && !isFree(b.fit, times)) return b.fit;
  }

  const qs: { q: number; bonus: number }[] = [];
  if (input.bpm && input.bpm >= 20 && input.bpm <= 400) {
    const q = 60 / input.bpm;
    qs.push({ q, bonus: 0.3 }, { q: q * 2, bonus: 0.05 }, { q: q / 2, bonus: 0.05 });
  }
  for (const v of ioiClusters(times)) {
    for (const m of [1, 2, 4, 0.5, 1.5, 3, 2 / 3, 4 / 3]) qs.push({ q: v * m, bonus: 0 });
  }
  const seen: number[] = [];
  for (const { q, bonus } of qs) {
    if (q < 0.24 || q > 1.7) continue;
    if (!bonus && seen.some((s) => Math.abs(s / q - 1) < 0.03)) continue;
    seen.push(q);
    consider(track(times, q), bonus);
  }
  const b = best as { fit: Fit; score: number } | null;
  return b ? b.fit : null;
}

// ---------------------------------------------------------------- meter

interface MeterCandidate {
  meter: TimeSignature;
  bar: number;
  beat: number;
  prior: number;
  weight(pos: number): number;
}

const METERS: MeterCandidate[] = [
  {
    meter: { beats: 4, unit: 4 },
    bar: 16,
    beat: 4,
    prior: 0.06,
    weight: (p) => (p === 0 ? 4 : p === 8 ? 3 : p % 4 === 0 ? 2 : p % 2 === 0 ? 1 : 0),
  },
  {
    meter: { beats: 3, unit: 4 },
    bar: 12,
    beat: 4,
    prior: 0.02,
    weight: (p) => (p === 0 ? 4 : p % 4 === 0 ? 2 : p % 2 === 0 ? 1 : 0),
  },
  {
    meter: { beats: 2, unit: 4 },
    bar: 8,
    beat: 4,
    prior: 0,
    weight: (p) => (p === 0 ? 4 : p % 4 === 0 ? 2 : p % 2 === 0 ? 1 : 0),
  },
  {
    meter: { beats: 6, unit: 8 },
    bar: 12,
    beat: 6,
    prior: 0,
    weight: (p) => (p === 0 ? 4 : p === 6 ? 3 : p % 2 === 0 ? 1.5 : 0),
  },
  {
    meter: { beats: 3, unit: 8 },
    bar: 6,
    beat: 2,
    prior: 0.01,
    weight: (p) => (p === 0 ? 4 : p % 2 === 0 ? 1.5 : 0),
  },
];

/** Ticks in one bar and in one beat (the unit that beams and rests group by). */
export function meterTicks(meter: TimeSignature): { bar: number; beat: number } {
  const unitTicks = (TPQ * 4) / meter.unit;
  const bar = Math.max(1, Math.round(unitTicks * meter.beats));
  // Compound meters (6/8, 9/8, 12/8) group in dotted beats of three units.
  const compound = meter.unit === 8 && meter.beats % 3 === 0 && meter.beats > 3;
  const beat = compound ? unitTicks * 3 : meter.unit === 8 && meter.beats === 3 ? unitTicks : Math.max(1, unitTicks);
  return { bar, beat: Math.max(1, Math.round(beat)) };
}

function genericCandidate(meter: TimeSignature): MeterCandidate {
  const { bar, beat } = meterTicks(meter);
  return {
    meter,
    bar,
    beat,
    prior: 0,
    weight: (p) => (p === 0 ? 4 : p % beat === 0 ? 2 : p % 2 === 0 ? 1 : 0),
  };
}

interface Accent {
  tick: number;
  w: number;
}

/**
 * Correlation between the accents heard at every grid position and the
 * meter's pattern of strong and weak beats, for the best bar line offset.
 */
function scoreMeter(c: MeterCandidate, accents: readonly Accent[], first: number): { score: number; origin: number } {
  const last = accents.reduce((m, a) => Math.max(m, a.tick), first);
  const n = last - first + c.bar;
  const x = new Float64Array(n);
  for (const a of accents) x[a.tick - first] += a.w;
  let mx = 0;
  for (let i = 0; i < n; i++) mx += x[i];
  mx /= n;
  let sx = 0;
  for (let i = 0; i < n; i++) sx += (x[i] - mx) ** 2;
  const pattern = Array.from({ length: c.bar }, (_, p) => c.weight(p));
  let best = { score: -Infinity, origin: 0 };
  for (let o = 0; o < c.bar; o++) {
    let mt = 0;
    for (let i = 0; i < n; i++) mt += pattern[(((i + first - o) % c.bar) + c.bar) % c.bar];
    mt /= n;
    let cov = 0;
    let st = 0;
    for (let i = 0; i < n; i++) {
      const t = pattern[(((i + first - o) % c.bar) + c.bar) % c.bar] - mt;
      cov += (x[i] - mx) * t;
      st += t * t;
    }
    let score = sx > 0 && st > 0 ? cov / Math.sqrt(sx * st) : 0;
    score += c.prior;
    // Songs usually start on the first beat, or with a short upbeat.
    const into = (((first - o) % c.bar) + c.bar) % c.bar;
    if (into === 0) score += 0.06;
    else if (c.bar - into > c.bar / 2) score -= 0.04;
    if (into % c.beat !== 0) score -= 0.03;
    if (score > best.score + 1e-9) best = { score, origin: o };
  }
  return best;
}

/**
 * Picks the meter and where bar lines fall. Strong positions are where long
 * notes, bass notes and chords start.
 */
export function estimateMeter(
  notes: readonly { tick: number; len: number; midi: number; hand: Hand }[],
  given?: TimeSignature,
  secondsPerTick = 0.15,
): { meter: TimeSignature; origin: number } {
  const byTick = new Map<number, { len: number; low: boolean; count: number }>();
  for (const n of notes) {
    const e = byTick.get(n.tick) ?? { len: 0, low: false, count: 0 };
    e.count++;
    e.len = Math.max(e.len, Math.min(16, n.len));
    if (n.hand === 'left') e.low = true;
    byTick.set(n.tick, e);
  }
  const accents: Accent[] = [];
  let first = Infinity;
  for (const [tick, e] of byTick) {
    const w = 1 + Math.sqrt(e.len) * 0.6 + (e.low ? 1 : 0) + Math.min(3, e.count - 1) * 0.3;
    accents.push({ tick, w });
    first = Math.min(first, tick);
  }
  const candidates = given ? [METERS.find((m) => sameMeter(m.meter, given)) ?? genericCandidate(given)] : METERS;
  let best = { meter: candidates[0].meter, origin: 0, score: -Infinity };
  for (const c of candidates) {
    const r = scoreMeter(c, accents, first);
    // Very short bars are rarely how music is written.
    if (c.bar * secondsPerTick < 0.8) r.score -= 0.08;
    if (r.score > best.score) best = { meter: c.meter, origin: r.origin, score: r.score };
  }
  return { meter: best.meter, origin: best.origin };
}

const sameMeter = (a: TimeSignature, b: TimeSignature) => a.beats === b.beats && a.unit === b.unit;

export function validMeter(ts: TimeSignature | undefined): ts is TimeSignature {
  return (
    !!ts &&
    Number.isInteger(ts.beats) &&
    ts.beats >= 1 &&
    ts.beats <= 16 &&
    [2, 4, 8, 16].includes(ts.unit)
  );
}

// ---------------------------------------------------------------- quantising

function gridsFor(beat: number): number[] {
  if (beat === 6) return [6, 2, 1];
  if (beat === 4) return [4, 2, 1];
  if (beat === 2) return [2, 1];
  if (beat === 8) return [8, 4, 2, 1];
  return [beat, 1];
}

/**
 * Snaps onset positions beat by beat, using the coarsest grid (beat, eighth,
 * sixteenth) that fits, so slightly uneven playing does not turn into
 * sixteenth-note clutter.
 */
function snapOnsets(xs: readonly number[], origin: number, beat: number): number[] {
  const grids = gridsFor(beat);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < xs.length) {
    const b = Math.floor((xs[i] - origin + 0.5) / beat);
    let j = i;
    while (j < xs.length && Math.floor((xs[j] - origin + 0.5) / beat) === b) j++;
    let bestCost = Infinity;
    let bestSnap: number[] = [];
    grids.forEach((g, level) => {
      const snap: number[] = [];
      let cost = 0;
      for (let k = i; k < j; k++) {
        const s = origin + Math.round((xs[k] - origin) / g) * g;
        cost += Math.abs(xs[k] - s) + level * 0.14;
        if (snap.length && s <= snap[snap.length - 1]) cost += 1.2; // two onsets on one spot
        snap.push(s);
      }
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestSnap = snap;
      }
    });
    for (let k = i; k < j; k++) out[k] = bestSnap[k - i];
    i = j;
  }
  // Keep order.
  for (let k = 1; k < out.length; k++) if (out[k] < out[k - 1]) out[k] = out[k - 1];
  return out;
}

function averageBpm(map: TimeMap): number {
  const n = map.times.length - 1;
  // The last point is an extrapolation; leave it out when there is more.
  const last = n > 1 ? n - 1 : n;
  const seconds = map.times[last] - map.times[0];
  const quarters = (map.ticks[last] - map.ticks[0]) / TPQ;
  return seconds > 0 && quarters > 0 ? (60 * quarters) / seconds : 100;
}

/**
 * True when the notes do not sit on any steady grid. Uneven human playing
 * still lands mostly on beats and eighths; random timing does not.
 */
function isFree(fit: Fit, times: readonly number[]): boolean {
  if (times.length < 3) return false;
  if (fit.error > FREE_ERROR) return true;
  return fit.error > 0.75 && gridCost(times, fit.map).busy > 0.4;
}

/** Works out tempo, meter and a quantised position for every note. */
export function analyseTiming(input: TimingInput): Timing {
  const notes = input.notes;
  if (!notes.length) {
    return {
      kind: 'metric',
      map: linearMap(0, 60 / (input.bpm ?? 100)),
      meter: validMeter(input.timeSignature) ? input.timeSignature : { beats: 4, unit: 4 },
      origin: 0,
      notes: [],
      bpm: input.bpm ?? 100,
      error: 0,
    };
  }
  const onsets = clusterOnsets(notes);
  const times = onsets.map((o) => o.t);
  let fit: Fit | null;
  if (times.length >= 3) fit = bestFit(times, input);
  else {
    // Too few notes to tell: take the gap between them as a quarter note.
    const gap = times.length === 2 ? times[1] - times[0] : 0;
    const q = gap >= 0.25 && gap <= 1.6 ? gap : 60 / (input.bpm ?? 100);
    fit = { map: linearMap(times[0], q), error: 0, q };
  }
  if (!fit || isFree(fit, times)) return { kind: 'free', error: fit?.error ?? 1 };
  const map = fit.map;

  // First pass: plain sixteenths, for meter estimation.
  const rough = onsets.map((o) => Math.round(tickAt(map, o.t)));
  const roughNotes: { tick: number; len: number; midi: number; hand: Hand }[] = [];
  onsets.forEach((o, k) => {
    for (const i of o.notes) {
      const n = notes[i];
      const len = Math.max(1, Math.round(tickAt(map, n.start + n.dur)) - rough[k]);
      roughNotes.push({ tick: rough[k], len, midi: n.midi, hand: n.hand });
    }
  });
  const given = validMeter(input.timeSignature) ? input.timeSignature : undefined;
  const { meter, origin } = estimateMeter(roughNotes, given, 60 / averageBpm(map) / TPQ);
  const { beat } = meterTicks(meter);

  // Second pass: beat by beat.
  const snapped = snapOnsets(
    onsets.map((o) => tickAt(map, o.t)),
    origin,
    beat,
  );
  const out: QNote[] = [];
  onsets.forEach((o, k) => {
    for (const i of o.notes) {
      const n = notes[i];
      const endX = tickAt(map, n.start + Math.max(0, n.dur));
      const len = Math.max(1, Math.round(endX) - snapped[k]);
      out.push({ index: i, midi: n.midi, hand: n.hand, tick: snapped[k], len, rawLen: Math.max(0, endX - snapped[k]) });
    }
  });
  out.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  return {
    kind: 'metric',
    map,
    meter,
    origin,
    notes: out,
    bpm: Math.round(averageBpm(map) * 10) / 10,
    error: fit.error,
  };
}
