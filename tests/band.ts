// Ground-truth band recordings for the arrangement tests: a sung tune with
// vibrato over a strummed guitar (real strumming rhythm, guitar-like voicings
// across six strings), a bass line, keys and drums, made from a known score.
// Progressions cover borrowed chords, slash chords, sevenths, sus chords, 3/4
// and a key change, so chord detection and arranging can be scored exactly.
// Everything is deterministic for a seed.

export const BAND_RATE = 22050;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

/** Intervals above the root for each chord quality the generator writes. */
export const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
};

export interface TrueChord {
  start: number;
  dur: number;
  label: string;
  root: number;
  /** Pitch class in the bass (the root unless a slash chord). */
  bass: number;
  /** 'maj' or 'min' class of the chord's third (sus chords count as 'maj'). */
  third: 'maj' | 'min';
  tones: number[];
}

/** Parses "G/B" or "Am7" or "Bb" into its parts. */
export function parseLabel(label: string): { root: number; quality: string; bass: number } {
  const m = /^([A-G][#b]?)(m7|maj7|m|7|sus4|sus2)?(?:\/([A-G][#b]?))?$/.exec(label);
  if (!m) throw new Error(`Bad chord ${label}`);
  const pc = (s: string) => NAMES.indexOf(FLAT[s] ?? s);
  const root = pc(m[1]);
  return { root, quality: m[2] ?? '', bass: m[3] ? pc(m[3]) : root };
}

export interface BandSection {
  /** Key of the section, for the melody scale. */
  key: { tonic: number; minor: boolean };
  /** "C/4 G/B/4 Am/2 F/2": label/beats. */
  chords: string;
}

export interface BandSong {
  name: string;
  bpm: number;
  beatsPerBar: number;
  sections: BandSection[];
  /** Strum pattern in beats within a bar: [position, down?]. */
  strum?: [number, boolean][];
  /** Voice level against the band in dB. */
  voiceDb?: number;
  seed: number;
  /** Sustained keys pad. */
  pad?: boolean;
  /**
   * A denser, less tidy mix: bass walk-ups into chord changes, add9 colour on
   * the guitar, a lead synth filling the gaps between sung phrases, and the
   * whole recording tuned this many cents sharp.
   */
  hard?: { cents: number; drive?: number };
}

const POP_STRUM: [number, boolean][] = [
  [0, true],
  [1, true],
  [1.5, false],
  [2.5, false],
  [3, true],
  [3.5, false],
];
const WALTZ_STRUM: [number, boolean][] = [
  [0, true],
  [1, true],
  [1.5, false],
  [2, true],
  [2.5, false],
];

export const BAND_SONGS: BandSong[] = [
  {
    name: 'pop-c-slash-borrowed',
    bpm: 98,
    beatsPerBar: 4,
    seed: 1,
    sections: [
      { key: { tonic: 0, minor: false }, chords: 'C/4 G/B/4 Am/4 F/4 C/4 G/B/4 Am/4 F/4' },
      { key: { tonic: 0, minor: false }, chords: 'F/4 Fm/4 C/4 A#/4 F/4 G/4 C/4 C/4' },
    ],
  },
  {
    name: 'ballad-eb-sevenths',
    bpm: 72,
    beatsPerBar: 4,
    seed: 2,
    pad: true,
    sections: [
      { key: { tonic: 3, minor: false }, chords: 'D#/4 Cm7/4 G#/4 A#7/4 D#/4 D#/G/4 G#/4 G#m/4 D#/4 A#7/4 D#/8' },
    ],
  },
  {
    name: 'waltz-g-3-4',
    bpm: 132,
    beatsPerBar: 3,
    seed: 3,
    strum: WALTZ_STRUM,
    sections: [
      { key: { tonic: 7, minor: false }, chords: 'G/6 Em/6 C/6 D7/6 G/3 G/D/3 C/3 D/3 G/6 C/3 D7/3 G/6' },
    ],
  },
  {
    name: 'rock-em',
    bpm: 120,
    beatsPerBar: 4,
    seed: 4,
    voiceDb: -3,
    sections: [
      { key: { tonic: 4, minor: true }, chords: 'Em/4 C/4 G/4 D/4 Em/4 C/4 G/4 D/4 Am/4 Em/4 B7/4 Em/4 Am/4 C/4 B7/4 Em/4' },
    ],
  },
  {
    name: 'keychange-d-to-e',
    bpm: 104,
    beatsPerBar: 4,
    seed: 5,
    sections: [
      { key: { tonic: 2, minor: false }, chords: 'D/4 A/4 Bm/4 G/4 D/4 A/4 G/4 A/4' },
      { key: { tonic: 4, minor: false }, chords: 'E/4 B/4 C#m/4 A/4 E/4 B/4 A/4 B/2 E/6' },
    ],
  },
  {
    name: 'sus-f',
    bpm: 88,
    beatsPerBar: 4,
    seed: 6,
    pad: true,
    sections: [
      { key: { tonic: 5, minor: false }, chords: 'F/4 Dm7/4 A#/4 Csus4/2 C/2 F/4 Am/4 A#/4 C7/4 Dm/4 A#/4 F/C/2 C/2 F/4' },
    ],
  },
  {
    name: 'dense-pop-a',
    bpm: 112,
    beatsPerBar: 4,
    seed: 7,
    voiceDb: 4,
    pad: true,
    hard: { cents: 30, drive: 3 },
    sections: [
      { key: { tonic: 9, minor: false }, chords: 'A/4 E/G#/4 F#m/4 D/4 A/4 E/4 D/2 E/2 A/4 F#m/4 Bm7/4 E7/4 D/4 Dm/4 A/4 A/4' },
    ],
  },
  {
    name: 'dense-minor-dm',
    bpm: 84,
    beatsPerBar: 4,
    seed: 8,
    voiceDb: 6,
    hard: { cents: -20, drive: 5 },
    sections: [
      { key: { tonic: 2, minor: true }, chords: 'Dm/4 A#/4 F/4 C/4 Dm/4 A#/4 Gm/2 A7/2 Dm/4 Gm/4 C/4 F/4 A#/4 Gm/4 A/4 Dm/4' },
    ],
  },
];

function random(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

let tuneCents = 0;
const hz = (midi: number) => 440 * 2 ** ((midi - 69 + tuneCents / 100) / 12);

function vowel(f: number, shift: number): number {
  const formants = [
    [730 * shift, 90, 1],
    [1090 * shift, 110, 0.5],
    [2440 * shift, 160, 0.25],
  ];
  let g = 0.02;
  for (const [c, bw, a] of formants) g += a / (1 + ((f - c) / bw) ** 2);
  return g;
}

export interface BandMix {
  left: Float32Array;
  right: Float32Array;
  mono: Float32Array;
  melody: { midi: number; start: number; dur: number }[];
  chords: TrueChord[];
  beats: number[];
  downbeats: number[];
  beatsPerBar: number;
  bpm: number;
  keys: { start: number; tonic: number; minor: boolean }[];
  length: number;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11]; // with the raised 7th for V

/** Writes a singable tune over the chords: chord tones on strong beats, steps between. */
function composeMelody(song: BandSong, chords: (TrueChord & { beat: number; beats: number; key: BandSection['key'] })[], rnd: () => number) {
  const bar = song.beatsPerBar;
  const rhythms4 = [
    [1, 1, 1, 1],
    [0.5, 0.5, 1, 1, 1],
    [1.5, 0.5, 2],
    [0.5, 0.5, 0.5, 0.5, 2],
    [1, 0.5, 1, 1.5], // anticipation across beat 3
    [0.5, 1, 0.5, 2], // pop push
  ];
  const rhythms3 = [
    [1, 1, 1],
    [2, 1],
    [1, 0.5, 0.5, 1],
    [1.5, 0.5, 1],
  ];
  const totalBeats = chords.reduce((m, c) => Math.max(m, c.beat + c.beats), 0);
  const notes: { midi: number; beat: number; beats: number }[] = [];
  let prev = 67;
  const chordAt = (b: number) => chords.find((c) => b >= c.beat && b < c.beat + c.beats) ?? chords[chords.length - 1];
  for (let barStart = 0; barStart < totalBeats - bar + 1e-9; barStart += bar) {
    const barIndex = Math.round(barStart / bar);
    const phraseEnd = barIndex % 4 === 3;
    const pattern = phraseEnd
      ? bar === 4
        ? [2, -2]
        : [2, -1]
      : (bar === 4 ? rhythms4 : rhythms3)[Math.floor(rnd() * (bar === 4 ? rhythms4 : rhythms3).length)];
    let b = barStart;
    for (const len of pattern) {
      if (len < 0) {
        b += -len;
        continue;
      }
      const c = chordAt(b + 0.01);
      const strong = Math.abs(b - Math.round(b)) < 1e-6;
      const scale = (c.key.minor ? MINOR_SCALE : MAJOR_SCALE).map((x) => (x + c.key.tonic) % 12);
      let midi: number;
      const candidates: number[] = [];
      for (let m = 57; m <= 76; m++) {
        const pc = m % 12;
        // Real tunes lean on the 9th, 4th or 6th over a chord on strong beats (appoggiaturas, suspensions).
        const leaning = song.hard && strong && rnd() < 0.35;
        if (strong && !leaning ? c.tones.includes(pc) : scale.includes(pc)) candidates.push(m);
      }
      // Prefer small steps, with a gentle pull back to the middle of the range.
      const weights = candidates.map((m) => {
        const d = Math.abs(m - prev);
        const step = strong ? (d <= 4 ? 1 : d <= 7 ? 0.4 : 0.05) : d >= 1 && d <= 2 ? 1 : d === 0 ? 0.2 : 0.05;
        return step * Math.exp(-(((m - 66) / 6) ** 2) / 2);
      });
      const sum = weights.reduce((a, x) => a + x, 0);
      let r = rnd() * sum;
      midi = candidates[0];
      for (let i = 0; i < candidates.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          midi = candidates[i];
          break;
        }
      }
      notes.push({ midi, beat: b, beats: len });
      prev = midi;
      b += len;
    }
  }
  return notes;
}

/** Guitar-style voicing: bass string first, then chord tones stacked a third to a fifth apart. */
function guitarVoicing(tones: number[], bass: number): number[] {
  let low = 40 + ((bass - 4 + 12) % 12); // E2..D#3
  if (low > 47) low -= 12; // keep it on the low strings (E2..B2) or a fifth string root
  const out = [low < 40 ? low + 12 : low];
  const order = [7, 0, 4, 7, 0]; // fifth, octave, third, fifth, root: a typical open shape
  const root = tones[0];
  const has = (iv: number) => tones.some((t) => (t - root + 12) % 12 === iv);
  const third = tones.find((t) => [2, 3, 4, 5].includes((t - root + 12) % 12)) ?? (root + 4) % 12;
  const seventh = tones.find((t) => [10, 11].includes((t - root + 12) % 12));
  for (const iv of order) {
    let pc = (root + iv) % 12;
    if (iv === 4) pc = third;
    if (iv === 0 && seventh !== undefined && out.length === 2) pc = seventh; // sevenths sit on a middle string
    if (iv === 7 && !has(7)) continue;
    let m = out[out.length - 1] + 3;
    while (m % 12 !== pc) m++;
    out.push(m);
  }
  return out.filter((m) => m <= 72);
}

/** The notes every instrument played, as the note model would ideally hear them (no audio is made). */
export interface BandScore extends Omit<BandMix, 'left' | 'right' | 'mono'> {
  /** Everything played, the sung tune marked part: 'melody'. */
  raw: { midi: number; start: number; dur: number; amp: number; part?: 'melody' }[];
}

export function bandScore(song: BandSong): BandScore {
  const { left: _l, right: _r, mono: _m, ...rest } = renderBand(song, true) as BandMix & { played: BandScore['raw'] };
  void _l;
  void _r;
  void _m;
  return rest as unknown as BandScore;
}

export function renderBand(song: BandSong, notesOnly = false): BandMix {
  const played: { midi: number; start: number; dur: number; amp: number; part?: 'melody' }[] = [];
  const rnd = random(song.seed);
  tuneCents = song.hard?.cents ?? 0;
  const spb = 60 / song.bpm;
  const strum = song.strum ?? POP_STRUM;
  // Score in beats.
  const chords: (TrueChord & { beat: number; beats: number; key: BandSection['key'] })[] = [];
  const keys: BandMix['keys'] = [];
  let beat = 0;
  for (const section of song.sections) {
    keys.push({ start: beat * spb, ...section.key });
    for (const token of section.chords.trim().split(/\s+/)) {
      const cut = token.lastIndexOf('/');
      const label = token.slice(0, cut);
      const beats = Number(token.slice(cut + 1));
      const { root, quality, bass } = parseLabel(label);
      const tones = QUALITY[quality].map((iv) => (root + iv) % 12);
      chords.push({
        start: beat * spb,
        dur: beats * spb,
        label,
        root,
        bass,
        third: quality === 'm' || quality === 'm7' ? 'min' : 'maj',
        tones,
        beat,
        beats,
        key: section.key,
      });
      beat += beats;
    }
  }
  const totalBeats = beat;
  const lead = 1; // one bar-ish of drums before the band, as songs often have
  const offset = lead * spb * song.beatsPerBar;
  const length = offset + totalBeats * spb + 2;
  const total = Math.ceil(length * BAND_RATE);
  const voice = new Float32Array(total);
  const bandL = new Float32Array(total);
  const bandR = new Float32Array(total);
  const guitar = new Float32Array(total);

  const melodyBeats = composeMelody(song, chords, rnd);
  const melody = melodyBeats.map((n) => ({ midi: n.midi, start: offset + n.beat * spb, dur: n.beats * spb * 0.92 }));

  // --- Voice with scoops, glides and vibrato.
  const shift = 1 + 0.08 * rnd();
  let prevMidi: number | null = null;
  let prevEnd = -1;
  let phase = 0;
  for (const n of melody) {
    const from = Math.floor(n.start * BAND_RATE);
    const count = Math.floor(n.dur * BAND_RATE);
    const legato = prevMidi !== null && n.start - prevEnd < 0.1;
    const startMidi = legato ? prevMidi! : n.midi - 0.5;
    const glide = legato ? 0.05 : 0.08;
    const vibRate = 5 + rnd() * 1.2;
    const vibDepth = 0.25 + 0.15 * rnd();
    const loud = 0.8 + 0.2 * rnd();
    played.push({ midi: n.midi, start: n.start, dur: n.dur, amp: 0.8, part: 'melody' });
    for (let i = 0; i < count && from + i < total && !notesOnly; i++) {
      const t = i / BAND_RATE;
      let m = t < glide ? startMidi + (n.midi - startMidi) * (t / glide) : n.midi;
      if (t > 0.15) m += vibDepth * Math.min(1, (t - 0.15) / 0.2) * Math.sin(2 * Math.PI * vibRate * t);
      const f = hz(m);
      phase += (2 * Math.PI * f) / BAND_RATE;
      const env = Math.min(1, t / 0.03) * Math.min(1, (n.dur - t) / 0.05) * loud;
      let s = 0;
      for (let h = 1; h * f < 5000; h++) s += (Math.sin(h * phase) / h) * vowel(h * f, shift);
      voice[from + i] += s * env;
      if (t < 0.025) voice[from + i] += (rnd() * 2 - 1) * 0.06 * (1 - t / 0.025);
    }
    prevMidi = n.midi;
    prevEnd = n.start + n.dur;
  }

  // --- Band instruments.
  const pluck = (out: Float32Array, midi: number, start: number, dur: number, gain: number, bright: number, decay = 3) => {
    const f = hz(midi);
    const from = Math.floor(start * BAND_RATE);
    const count = Math.floor((dur + 0.15) * BAND_RATE);
    const det = 1 + (rnd() - 0.5) * 0.002;
    // Like the note model's own numbers: how sure it is, not how loud.
    played.push({ midi, start, dur, amp: 0.45 + 0.25 * ((midi * 7919 + Math.round(start * 1000)) % 100) / 100 });
    for (let i = 0; i < count && from + i < total && !notesOnly; i++) {
      const t = i / BAND_RATE;
      const env = Math.min(1, t / 0.003) * Math.exp(-t * decay) * (t > dur ? Math.exp(-(t - dur) * 30) : 1);
      let s = 0;
      for (let h = 1; h <= 8; h++) s += (Math.sin(2 * Math.PI * f * det * h * t) / h ** bright) * Math.exp(-t * h * 0.6);
      out[from + i] += s * env * gain;
    }
  };

  for (const c of chords) {
    const voicing = guitarVoicing(c.tones, c.bass);
    // Pop guitarists often let the ninth ring on top of a major chord.
    if (song.hard && c.third === 'maj' && c.tones.length === 3 && rnd() < 0.5) voicing.push(voicing[voicing.length - 1] + ((c.root + 2 - voicing[voicing.length - 1] + 120) % 12 || 12));
    const start = offset + c.beat * spb;
    const end = start + c.beats * spb;
    // Strum through the chord's bars.
    const barCount = Math.ceil(c.beats / song.beatsPerBar);
    const hits: [number, boolean][] = [];
    for (let k = 0; k < barCount; k++) {
      for (const [pos, down] of strum) {
        const at = k * song.beatsPerBar + pos;
        if (at < c.beats - 1e-6) hits.push([at, down]);
      }
    }
    hits.forEach(([pos, down], i) => {
      const at = start + pos * spb + (rnd() - 0.5) * 0.012;
      const next = i + 1 < hits.length ? start + hits[i + 1][0] * spb : end;
      const strings = down ? voicing : [...voicing].reverse().slice(0, 4);
      const gain = (down ? 0.07 : 0.05) * (0.85 + 0.3 * rnd());
      strings.forEach((m, k) => pluck(guitar, m, at + k * (down ? 0.011 : 0.008), Math.max(0.05, next - at - k * 0.01), gain, 1.2, 2.5));
    });
    // Bass: root (or the slash note) on 1, fifth on 3, a passing note before a change.
    const bassMidi = 28 + ((c.bass - 4 + 12) % 12); // E1..D#2
    for (let b = 0; b < c.beats; b += song.beatsPerBar === 3 ? 3 : 2) {
      const half = b % 4 === 2 && song.beatsPerBar === 4;
      const m = half && c.beats - b <= 2 ? bassMidi : half ? bassMidi + 7 : bassMidi;
      const len = Math.min(song.beatsPerBar === 3 ? 2.5 : 1.8, c.beats - b) * spb;
      pluck(bandR, m, start + b * spb, len, 0.28, 2.6, 1.5);
      pluck(bandL, m, start + b * spb, len, 0.12, 2.6, 1.5);
    }
    // A walk-up into the next chord on the last beat.
    const nextChord = chords[chords.indexOf(c) + 1];
    if (song.hard && nextChord && song.beatsPerBar === 4 && c.beats >= 2) {
      const target = 28 + ((nextChord.bass - 4 + 12) % 12);
      const step = target > bassMidi ? target - 2 : target + 2;
      pluck(bandR, step, start + (c.beats - 1) * spb, spb * 0.9, 0.25, 2.6, 1.5);
    }
    // Keys pad: a soft held voicing in the middle, right side.
    if (song.pad) {
      const padTones = c.tones.map((pc) => 60 + ((pc - 0 + 12) % 12) - (pc > 7 ? 12 : 0));
      for (const m of padTones) {
        const f = hz(m);
        const from = Math.floor(start * BAND_RATE);
        const count = Math.floor(c.beats * spb * BAND_RATE);
        played.push({ midi: m, start, dur: c.beats * spb, amp: 0.5 });
        for (let i = 0; i < count && from + i < total && !notesOnly; i++) {
          const t = i / BAND_RATE;
          const env = Math.min(1, t / 0.15) * Math.min(1, (c.beats * spb - t) / 0.08);
          let s = 0;
          for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * t * (1 + 0.0015 * (h % 2))) / (h * 1.7);
          bandR[from + i] += s * env * 0.025;
        }
      }
    }
  }

  // The guitar, through an overdrive when asked (adds harmonics and intermodulation the note model may mistake for notes).
  {
    const drive = song.hard?.drive ?? 0;
    for (let i = 0; i < total; i++) {
      const g = drive > 0 ? (Math.tanh(guitar[i] * drive * 6) / 6) * 1.3 : guitar[i];
      bandL[i] += g;
      bandR[i] += g * 0.35;
    }
  }

  // --- Lead synth fills in the gaps between sung phrases.
  if (song.hard) {
    for (let i = 0; i + 1 < melody.length; i++) {
      const gapFrom = melody[i].start + melody[i].dur;
      const gapTo = melody[i + 1].start;
      if (gapTo - gapFrom < spb * 1.5) continue;
      const c = chords.find((x) => gapFrom + 0.1 >= offset + x.beat * spb && gapFrom + 0.1 < offset + (x.beat + x.beats) * spb);
      if (!c) continue;
      const scale = (c.key.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]).map((x) => (x + c.key.tonic) % 12);
      let m = 76;
      for (let t = Math.ceil((gapFrom - offset) / (spb / 2)) * (spb / 2) + offset; t < gapTo - spb * 0.6; t += spb / 2) {
        while (!scale.includes(m % 12)) m--;
        pluck(bandR, m, t, spb * 0.45, 0.06, 0.9, 4);
        pluck(bandL, m, t, spb * 0.45, 0.03, 0.9, 4);
        m -= 1 + Math.floor(rnd() * 3);
      }
    }
  }

  // --- Drums, including the lead-in bar.
  const beats: number[] = [];
  const downbeats: number[] = [];
  const allBeats = totalBeats + lead * song.beatsPerBar;
  for (let b = 0; b < allBeats; b++) {
    const t = b * spb;
    beats.push(t);
    if (b % song.beatsPerBar === 0) downbeats.push(t);
    const at = Math.floor(t * BAND_RATE);
    const inBar = b % song.beatsPerBar;
    if (inBar === 0 || (song.beatsPerBar === 4 && inBar === 2)) {
      let ph = 0;
      for (let i = 0; i < 0.25 * BAND_RATE && at + i < total; i++) {
        const tt = i / BAND_RATE;
        ph += (2 * Math.PI * (45 + 80 * Math.exp(-tt * 30))) / BAND_RATE;
        const s = Math.sin(ph) * Math.exp(-tt * 14) * 0.5;
        bandL[at + i] += s;
        bandR[at + i] += s;
      }
    } else {
      let lp = 0;
      for (let i = 0; i < 0.18 * BAND_RATE && at + i < total; i++) {
        const tt = i / BAND_RATE;
        lp += 0.5 * (rnd() * 2 - 1 - lp);
        const s = lp * Math.exp(-tt * 22) * 0.35;
        bandL[at + i] += s;
        bandR[at + i] += s * 0.9;
      }
    }
    for (const half of [0, 0.5]) {
      const h0 = Math.floor((b + half) * spb * BAND_RATE);
      let prev = 0;
      for (let i = 0; i < 0.04 * BAND_RATE && h0 + i < total; i++) {
        const x = rnd() * 2 - 1;
        const s = (x - prev) * Math.exp(-(i / BAND_RATE) * 90) * 0.1;
        prev = x;
        bandL[h0 + i] += s * 0.6;
        bandR[h0 + i] += s;
      }
    }
  }

  const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  const bandRms = (rms(bandL) + rms(bandR)) / 2;
  const gain = (bandRms / Math.max(1e-9, rms(voice))) * 10 ** ((song.voiceDb ?? 0) / 20);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const mono = new Float32Array(total);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    left[i] = bandL[i] + voice[i] * gain;
    right[i] = bandR[i] + voice[i] * gain;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  for (let i = 0; i < total; i++) {
    left[i] *= 0.8 / peak;
    right[i] *= 0.8 / peak;
    mono[i] = (left[i] + right[i]) / 2;
  }
  return {
    ...(notesOnly ? { raw: played.sort((a, b) => a.start - b.start) } : {}),
    left,
    right,
    mono,
    melody,
    chords: chords.map(({ start, dur, label, root, bass, third, tones }) => ({ start: start + offset, dur, label, root, bass, third, tones })),
    beats,
    downbeats,
    beatsPerBar: song.beatsPerBar,
    bpm: song.bpm,
    keys: keys.map((k) => ({ ...k, start: k.start + offset })),
    length,
  };
}
