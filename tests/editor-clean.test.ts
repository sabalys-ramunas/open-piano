import { describe, expect, it } from 'vitest';
import { findProblems, fixOverlaps, foldIntoPiano, joinBroken, problemIds, removeShort, shiftTime, splitHands } from '../src/editor/clean';
import { addNotes } from '../src/editor/commands';
import { makeNote, type Doc, type EdNote } from '../src/editor/model';

const meta = { title: 't', by: '' };
const doc = (...notes: EdNote[]): Doc => addNotes({ notes: [], meta }, notes);

describe('clean-up tools', () => {
  it('removes tiny notes, optionally only in the selection', () => {
    const tiny1 = makeNote(60, 0, 0.03, 'right');
    const tiny2 = makeNote(62, 1, 0.03, 'right');
    const ok = makeNote(64, 2, 0.5, 'right');
    const d = doc(tiny1, tiny2, ok);
    const all = removeShort(d, 0.08);
    expect(all.count).toBe(2);
    expect(all.doc.notes.map((n) => n.id)).toEqual([ok.id]);
    const some = removeShort(d, 0.08, new Set([tiny2.id]));
    expect(some.count).toBe(1);
    expect(some.doc.notes.map((n) => n.id)).toEqual([tiny1.id, ok.id]);
    expect(removeShort(d, 0.01).doc).toBe(d);
  });

  it('joins pieces of one note on the same key and hand only', () => {
    const p1 = makeNote(60, 0, 0.3, 'right');
    const p2 = makeNote(60, 0.32, 0.3, 'right');
    const p3 = makeNote(60, 0.64, 0.2, 'right');
    const otherHand = makeNote(60, 0.9, 0.2, 'left');
    const later = makeNote(60, 2, 0.2, 'right');
    const r = joinBroken(doc(p1, p2, p3, otherHand, later), 0.05);
    expect(r.count).toBe(2);
    const right = r.doc.notes.filter((n) => n.hand === 'right');
    expect(right).toHaveLength(2);
    expect(right[0].start).toBe(0);
    expect(right[0].dur).toBeCloseTo(0.84, 6);
    expect(r.doc.notes.find((n) => n.id === otherHand.id)).toBe(otherHand);
  });

  it('splits hands at a key', () => {
    const low = makeNote(55, 0, 1, 'right');
    const high = makeNote(67, 0, 1, 'left');
    const mid = makeNote(60, 0, 1, 'right');
    const r = splitHands(doc(low, high, mid), 60);
    expect(r.count).toBe(2);
    const hands = Object.fromEntries(r.doc.notes.map((n) => [n.midi, n.hand]));
    expect(hands).toEqual({ 55: 'left', 60: 'right', 67: 'right' });
  });

  it('shifts notes in time but never before 0', () => {
    const n1 = makeNote(60, 0.2, 1, 'right');
    const n2 = makeNote(62, 1, 1, 'right');
    const d = doc(n1, n2);
    const later = shiftTime(d, 0.1);
    expect(later.doc.notes.map((n) => n.start)).toEqual([0.30000000000000004, 1.1]);
    const earlier = shiftTime(d, -1);
    expect(earlier.dt).toBeCloseTo(-0.2, 9);
    expect(earlier.doc.notes[0].start).toBeCloseTo(0, 9);
    const only = shiftTime(d, 0.5, new Set([n2.id]));
    expect(only.doc.notes.find((n) => n.id === n1.id)).toBe(n1);
    expect(shiftTime(d, 0).doc).toBe(d);
  });

  it('fixes overlapping notes on the same key', () => {
    const a = makeNote(60, 0, 1, 'right');
    const b = makeNote(60, 0.5, 1, 'right');
    const same1 = makeNote(64, 3, 0.5, 'right');
    const same2 = makeNote(64, 3, 1, 'left');
    const r = fixOverlaps(doc(a, b, same1, same2));
    expect(r.count).toBe(2);
    expect(r.doc.notes.find((n) => n.id === a.id)?.dur).toBeCloseTo(0.49, 6);
    expect(r.doc.notes.some((n) => n.id === same1.id)).toBe(false);
    expect(r.doc.notes.some((n) => n.id === same2.id)).toBe(true);
    expect(findProblems(r.doc.notes).filter((p) => p.kind === 'overlap')).toHaveLength(0);
  });

  it('folds notes off the piano back on by octaves', () => {
    const r = foldIntoPiano(doc(makeNote(15, 0, 1, 'left'), makeNote(115, 0, 1, 'right'), makeNote(60, 0, 1, 'right')));
    expect(r.count).toBe(2);
    expect(r.doc.notes.map((n) => n.midi).sort((x, y) => x - y)).toEqual([27, 60, 103]);
  });
});

describe('finding problems', () => {
  it('finds overlaps, notes off the piano and very short notes', () => {
    const a = makeNote(60, 0, 1, 'right');
    const b = makeNote(60, 0.5, 1, 'left');
    const off = makeNote(110, 3, 1, 'right');
    const tiny = makeNote(70, 5, 0.03, 'right');
    const problems = findProblems(doc(a, b, off, tiny).notes);
    const kinds = problems.map((p) => p.kind).sort();
    expect(kinds).toEqual(['overlap', 'range', 'tiny']);
    expect(problems.find((p) => p.kind === 'overlap')?.ids.sort()).toEqual([a.id, b.id].sort());
    expect(problemIds(problems).size).toBe(4);
  });

  it('finds chords too wide or too full for one hand', () => {
    const wide = [makeNote(48, 0, 1, 'left'), makeNote(64, 0.01, 1, 'left')];
    const octave = [makeNote(60, 2, 1, 'right'), makeNote(72, 2, 1, 'right')];
    const full = [60, 62, 64, 65, 67, 69].map((m) => makeNote(m, 4, 1, 'right'));
    const twoHands = [makeNote(36, 6, 1, 'left'), makeNote(84, 6, 1, 'right')];
    const problems = findProblems(doc(...wide, ...octave, ...full, ...twoHands).notes);
    const stretch = problems.filter((p) => p.kind === 'stretch');
    expect(stretch).toHaveLength(1);
    expect(stretch[0].message).toContain('left hand');
    expect(stretch[0].message).toContain('16 keys');
    expect(problems.filter((p) => p.kind === 'crowded')).toHaveLength(1);
  });

  it('counts a held note together with a new one for stretches', () => {
    const held = makeNote(40, 0, 2, 'left');
    const added = makeNote(60, 1, 0.5, 'left');
    const problems = findProblems(doc(held, added).notes);
    expect(problems.filter((p) => p.kind === 'stretch')).toHaveLength(1);
    // After the held note ends, there is nothing to report.
    const after = makeNote(60, 2.5, 0.5, 'left');
    expect(findProblems(doc(held, after).notes)).toHaveLength(0);
  });

  it('reports a clean song as clean', () => {
    const notes = [60, 62, 64, 65, 67].map((m, i) => makeNote(m, i * 0.5, 0.45, 'right'));
    expect(findProblems(doc(...notes).notes)).toEqual([]);
  });
});
