import { describe, expect, it } from 'vitest';
import { buildScore, splitValue, type MetricScore, type Score } from '../src/sheet/score';
import { seq, sortNotes, type Note, type Song } from '../src/song';
import { BUILT_IN } from '../src/songs';
import { bar, ELISE, humanise, metric, ODE, TWINKLE } from './sheet-helpers';

const song = (notes: Note[], extra: Partial<Song> = {}) => ({ notes, ...extra });
const vals = (pos: number, len: number, beats: number, unit: number, rest = false) =>
  splitValue(pos, len, { beats, unit }, rest).map((p) => `${p.base}${'.'.repeat(p.dots)}`);

/** Every song note shows up exactly once as a struck head, and bars add up. */
function checkIntegrity(score: Score, count: number): void {
  const seen = new Array<number>(count).fill(0);
  if (score.kind === 'free') {
    for (const c of score.chords) for (const h of c.heads) seen[h.src]++;
  } else {
    for (const m of score.measures) {
      for (const s of [0, 1] as const) {
        let total = 0;
        let at = m.start;
        for (const e of m.staves[s]) {
          expect(e.tick).toBe(at);
          at += e.len;
          total += e.len;
          if (e.kind === 'chord') for (const h of e.heads) if (!h.tieEnd) seen[h.src]++;
        }
        expect(total).toBe(m.len);
      }
    }
  }
  // Notes doubled at the same time and pitch are drawn once; everything else exactly once.
  expect(seen.filter((n) => n > 1)).toEqual([]);
  expect(seen.filter((n) => n === 0).length).toBeLessThanOrEqual(Math.ceil(count * 0.02));
}

describe('note values', () => {
  it('writes simple lengths in 4/4', () => {
    expect(vals(0, 16, 4, 4)).toEqual(['1']);
    expect(vals(0, 12, 4, 4)).toEqual(['2.']);
    expect(vals(0, 6, 4, 4)).toEqual(['4.']);
    expect(vals(8, 6, 4, 4)).toEqual(['4.']);
    expect(vals(4, 8, 4, 4)).toEqual(['2']);
    expect(vals(0, 3, 4, 4)).toEqual(['8.']);
  });

  it('ties values that would hide the beat', () => {
    expect(vals(2, 4, 4, 4)).toEqual(['8', '8']); // syncopated quarter
    expect(vals(0, 5, 4, 4)).toEqual(['4', '16']);
    expect(vals(1, 7, 4, 4)).toEqual(['8.', '4']);
  });

  it('keeps rests plain and on the beat', () => {
    expect(vals(0, 6, 4, 4, true)).toEqual(['4', '8']);
    expect(vals(4, 8, 4, 4, true)).toEqual(['4', '4']);
    expect(vals(8, 8, 4, 4, true)).toEqual(['2']);
    expect(vals(3, 5, 4, 4, true)).toEqual(['16', '4']);
  });

  it('groups in threes in 3/8 and 6/8', () => {
    expect(vals(0, 6, 3, 8)).toEqual(['4.']);
    expect(vals(0, 3, 3, 8)).toEqual(['8.']);
    expect(vals(0, 12, 6, 8)).toEqual(['2.']);
    expect(vals(0, 8, 6, 8)).toEqual(['4.', '8']);
    expect(vals(0, 4, 6, 8)).toEqual(['4']);
    expect(vals(2, 4, 6, 8)).toEqual(['4']);
    expect(vals(4, 4, 6, 8)).toEqual(['8', '8']);
  });
});

describe('known tunes', () => {
  it('Twinkle: 4/4, quarters and halves, bass under it', () => {
    const s = metric(buildScore(song(TWINKLE, { bpm: 120 })));
    expect(s.meter).toEqual({ beats: 4, unit: 4 });
    expect(s.key).toEqual({ fifths: 0, mode: 'major' });
    expect(s.measures).toHaveLength(12);
    expect(s.measures.map((m) => bar(m, 0)).slice(0, 4)).toEqual([
      'C4/4 C4/4 G4/4 G4/4',
      'A4/4 A4/4 G4/2',
      'F4/4 F4/4 E4/4 E4/4',
      'D4/4 D4/4 C4/2',
    ]);
    expect(s.measures.map((m) => bar(m, 1)).slice(0, 4)).toEqual(['C3/1', 'F3/2 C3/2', 'F3/2 C3/2', 'G2/2 C3/2']);
    checkIntegrity(s, TWINKLE.length);
  });

  it('Ode to Joy: dotted quarter and eighth, whole notes in the bass', () => {
    const s = metric(buildScore(song(ODE, { bpm: 120 })));
    expect(s.measures).toHaveLength(8);
    expect(bar(s.measures[0], 0)).toBe('E4/4 E4/4 F4/4 G4/4');
    expect(bar(s.measures[3], 0)).toBe('E4/4. D4/8 D4/2');
    expect(bar(s.measures[7], 0)).toBe('D4/4. C4/8 C4/2');
    expect(s.measures.map((m) => bar(m, 1))).toEqual(['C3/1', 'G2/1', 'C3/1', 'G2/1', 'C3/1', 'G2/1', 'C3/1', 'G2/2 C3/2']);
    checkIntegrity(s, ODE.length);
  });

  it('Für Elise: 3/8, upbeat, sixteenths, rests and the right accidentals', () => {
    const s = metric(buildScore(song(ELISE, { bpm: 100 })));
    expect(s.meter).toEqual({ beats: 3, unit: 8 });
    expect(s.key).toEqual({ fifths: 0, mode: 'minor' });
    const [pickup, m1, m2, m3, m4] = s.measures;
    expect(pickup.pickup).toBe(true);
    expect(bar(pickup, 0, true)).toBe('E5/16 (#)D#5/16');
    expect(bar(pickup, 1)).toBe('r8');
    // D sharp is cancelled by a natural later in the same bar.
    expect(bar(m1, 0, true)).toBe('E5/16 (#)D#5/16 E5/16 B4/16 (n)D5/16 C5/16');
    expect(bar(m1, 1)).toBe('R');
    expect(bar(m2, 0)).toBe('A4/8 r16 C4/16 E4/16 A4/16');
    expect(bar(m2, 1)).toBe('A2/16 E3/16 A3/16 r16 r8');
    expect(bar(m3, 0, true)).toBe('B4/8 r16 E4/16 (#)G#4/16 B4/16');
    expect(bar(m3, 1, true)).toBe('E2/16 E3/16 (#)G#3/16 r16 r8');
    // The accidental from the previous bar does not carry over.
    expect(bar(m4, 0, true)).toBe('C5/8 r16 E4/16 E5/16 (#)D#5/16');
    expect(s.measures[s.measures.length - 1].staves[0].map((e) => e.base)).toEqual([4, 8]);
    checkIntegrity(s, ELISE.length);
  });

  it('beams Für Elise sixteenths by the bar and leaves the eighth with a flag', () => {
    const s = metric(buildScore(song(ELISE)));
    const m1 = s.measures[1].staves[0];
    const ids = new Set(m1.map((e) => (e.kind === 'chord' ? e.beam : -2)));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeGreaterThanOrEqual(0);
    const m2 = s.measures[2].staves[0];
    expect(m2[0].kind === 'chord' && m2[0].beam).toBe(-1);
    const group = m2.slice(2).map((e) => (e.kind === 'chord' ? e.beam : -2));
    expect(new Set(group).size).toBe(1);
  });

  it('reads the same bars from uneven human playing', () => {
    const clean = metric(buildScore(song(ODE, { bpm: 120 })));
    for (const seed of [1, 4, 5]) {
      const played = humanise(ODE, seed, { jitter: 0.02, drift: 0.06, legato: 0.8 });
      const s = metric(buildScore(song(played)));
      expect(s.measures.map((m) => bar(m, 0))).toEqual(clean.measures.map((m) => bar(m, 0)));
      checkIntegrity(s, played.length);
    }
  });

  it('builds every built-in song without losing notes', () => {
    for (const s of BUILT_IN) {
      const score = buildScore(s);
      checkIntegrity(score, s.notes.length);
    }
  });
});

describe('bars, ties and accidentals', () => {
  // A bass note on every bar line makes the bar lines unambiguous.
  const build = (right: string, extra: Partial<Song> = {}, bars = 3, bass = 'C3') =>
    metric(
      buildScore(
        song(sortNotes([...seq('right', 0.25, right), ...seq('left', 0.25, Array(bars).fill(`${bass}/8`).join(' '))]), {
          bpm: 120,
          timeSignature: { beats: 4, unit: 4 },
          ...extra,
        }),
      ),
    );

  it('ties a long note across the bar line', () => {
    const s = build('C5/2 E5/12 G5/8'); // eighth steps: a quarter, six quarters, a whole
    expect(bar(s.measures[0], 0)).toBe('C5/4 E5/2.~');
    expect(bar(s.measures[1], 0)).toBe('E5/2. G5/4~');
    // The last note rings to the end of the piece.
    expect(bar(s.measures[2], 0)).toBe('G5/1');
    const last = s.measures[2].staves[0][0];
    expect(last.kind === 'chord' && last.heads[0].tieEnd).toBe(true);
    const tied = s.measures[1].staves[0][0];
    expect(tied.kind === 'chord' && tied.heads[0].tieEnd).toBe(true);
  });

  it('remembers accidentals until the bar line', () => {
    const s = build('C4/2 E4/2 G4/2 C5/2 F#4/2 F#4/2 F4/2 A4/2 F#4/8 C4/2 E4/2 G4/2 C5/2');
    expect(s.key.fifths).toBe(0);
    expect(bar(s.measures[1], 0, true)).toBe('(#)F#4/4 F#4/4 (n)F4/4 A4/4');
    expect(bar(s.measures[2], 0, true)).toBe('(#)F#4/1');
  });

  it('follows the key signature', () => {
    const s = build('G4/2 A4/2 B4/2 C5/2 D5/2 E5/2 F#5/2 G5/2 F5/2 G5/2 D5/2 B4/2 G4/8', {}, 4, 'G2');
    expect(s.key.fifths).toBe(1);
    expect(bar(s.measures[0], 0, true)).toBe('G4/4 A4/4 B4/4 C5/4');
    expect(bar(s.measures[1], 0, true)).toBe('D5/4 E5/4 F#5/4 G5/4');
    expect(bar(s.measures[2], 0, true)).toBe('(n)F5/4 G5/4 D5/4 B4/4');
  });

  it('makes chords and points stems the right way', () => {
    const s = build('C4+E4+G4/2 C5+E5+G5/2 B4/2 A4/2');
    const [low, high, b, a] = s.measures[0].staves[0];
    expect(low.kind === 'chord' && low.heads.length).toBe(3);
    expect(low.kind === 'chord' && low.stem).toBe('up');
    expect(high.kind === 'chord' && high.stem).toBe('down');
    expect(b.kind === 'chord' && b.stem).toBe('down');
    expect(a.kind === 'chord' && a.stem).toBe('up');
  });

  it('beams eighths by beat, and four in a half bar together', () => {
    const s = build('C5/1 D5/1 E5/1 F5/1 G5/2 A5/1 B5/1 C5/1 _/1 D5/1 E5/1 F5/4');
    const beams = s.measures[0].staves[0].map((e) => (e.kind === 'chord' ? e.beam : 'r'));
    // Four eighths share one beam, then a quarter, then a pair.
    expect(beams).toHaveLength(7);
    expect(new Set(beams.slice(0, 4)).size).toBe(1);
    expect(beams[0]).toBeGreaterThanOrEqual(0);
    expect(beams[4]).toBe(-1);
    expect(beams[5]).toBe(beams[6]);
    expect(beams[5]).not.toBe(beams[0]);
    const next = s.measures[1].staves[0].map((e) => (e.kind === 'chord' ? e.beam : 'r'));
    // A rest breaks the group: the lone eighth gets a flag.
    expect(next[0]).toBe(-1);
    expect(next[1]).toBe('r');
    expect(next[2]).toBe(next[3]);
    expect(next[2]).toBeGreaterThanOrEqual(0);
  });

  it('fills empty bars with a whole-bar rest', () => {
    const notes = sortNotes([...seq('right', 0.5, 'C5/4 D5/4 E5/4'), ...seq('left', 0.5, 'C3/4', 8)]);
    const s = metric(buildScore(song(notes, { bpm: 120, timeSignature: { beats: 4, unit: 4 } })));
    expect(s.measures.map((m) => bar(m, 1))).toEqual(['R', 'R', 'C3/1']);
  });

  it('switches to note heads by time for very free playing', () => {
    const notes: Note[] = [];
    let at = 0;
    for (let i = 0; i < 30; i++) {
      notes.push({ midi: 60 + ((i * 7) % 12), start: at, dur: 0.3, hand: i % 3 ? 'right' : 'left' });
      at += 0.13 + ((i * 0.618) % 1) * 0.8;
    }
    const s = buildScore(song(sortNotes(notes)));
    expect(s.kind).toBe('free');
    checkIntegrity(s, notes.length);
    const forced = buildScore(song(TWINKLE), { free: true });
    expect(forced.kind).toBe('free');
  });
});

describe('long pieces', () => {
  it('builds a long recording-like song quickly', () => {
    const notes: Note[] = [];
    const patterns = ['C4/1 E4/1 G4/1 C5/1', 'A3/2 C4/1 E4/1', 'F3/1 A3/1 C4/2', 'G3/1 B3/1 D4/1 G4/1'];
    for (let barIndex = 0; barIndex < 160; barIndex++) {
      notes.push(...seq('right', 0.25, patterns[barIndex % 4], barIndex * 8));
      notes.push(...seq('right', 0.25, 'E5/2 D5/2 C5/4', barIndex * 8 + 4));
      notes.push(...seq('left', 0.25, 'C3/4 G2/4', barIndex * 8));
    }
    const played = humanise(sortNotes(notes), 3, { jitter: 0.012, drift: 0.04 });
    const t0 = performance.now();
    const s = buildScore({ notes: played, raw: [] }) as MetricScore;
    const ms = performance.now() - t0;
    expect(s.kind).toBe('metric');
    expect(s.measures.length).toBeGreaterThan(150);
    expect(ms).toBeLessThan(1500);
  });
});
