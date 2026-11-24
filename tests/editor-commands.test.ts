import { describe, expect, it } from 'vitest';
import {
  addNotes,
  copyClip,
  deleteNotes,
  duplicate,
  idsInBox,
  limitMove,
  moveNotes,
  neighbour,
  pasteClip,
  quantise,
  resizeNotes,
  setHand,
  updateMeta,
} from '../src/editor/commands';
import { beatPos, beatTime, evenBeats, gridLines, makeGrid, snapFloor, snapTime, steadyTempo, stepSeconds } from '../src/editor/grid';
import { MIN_DUR, makeNote, type Doc, type EdNote } from '../src/editor/model';

const meta = { title: 't', by: '' };
function doc(...notes: EdNote[]): Doc {
  return addNotes({ notes: [], meta }, notes);
}
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('grid', () => {
  const g = makeGrid({ bpm: 120 }); // 0.5 s per beat

  it('uses a steady tempo, defaulting to 100', () => {
    expect(makeGrid({}).bpm).toBe(100);
    close(beatTime(g, 3), 1.5);
    close(beatPos(g, 1.25), 2.5);
  });

  it('snaps to the nearest line, or the line before for clicks', () => {
    close(snapTime(g, 0.37, 1), 0.5);
    close(snapTime(g, 0.37, 1 / 2), 0.25);
    close(snapTime(g, 0.37, 0), 0.37);
    close(snapFloor(g, 0.49, 1), 0);
    close(snapFloor(g, 0.5, 1), 0.5);
    // A bar of 4 beats is 2 seconds.
    close(snapTime(g, 1.2, -1), 2);
    close(snapTime(g, 0.9, -1), 0);
    close(snapTime(g, 0.4, 1 / 3), 1 / 3);
  });

  it('follows uneven beats from a recording and carries on past them', () => {
    const beats = [1, 1.5, 2.1, 2.6];
    const u = makeGrid({ beats });
    close(beatTime(u, 2), 2.1);
    close(beatTime(u, 2.5), 2.35);
    close(beatPos(u, 2.35), 2.5);
    close(beatTime(u, 4), 3.1); // last gap 0.5 continues
    close(beatTime(u, -1), 0.5); // first gap 0.5 continues backwards
    close(snapTime(u, 2.0, 1), 2.1);
    close(stepSeconds(u, 1.5, 1), 0.6);
  });

  it('recognises a steady list of beats', () => {
    const t = steadyTempo(evenBeats(90, 0.3, 10));
    expect(t?.bpm).toBeCloseTo(90, 1);
    expect(t?.offset).toBeCloseTo(0.3, 2);
    expect(steadyTempo([0, 0.5, 1.2, 1.5])).toBeNull();
  });

  it('marks bars and beats and thins out lines when zoomed out', () => {
    const lines = gridLines(g, 0, 2, 1 / 2, 200);
    expect(lines.filter((l) => l.kind === 'bar').map((l) => l.bar)).toEqual([1, 2]);
    expect(lines.filter((l) => l.kind === 'beat')).toHaveLength(3);
    expect(lines.filter((l) => l.kind === 'sub')).toHaveLength(4);
    const far = gridLines(g, 0, 60, 1 / 4, 5);
    expect(far.every((l) => l.kind === 'bar')).toBe(true);
    expect(far.length).toBeLessThan(40);
  });

  it('uses the time signature for bars', () => {
    const waltz = makeGrid({ bpm: 60, timeSignature: { beats: 3, unit: 4 } });
    const bars = gridLines(waltz, 0, 7, 1, 100).filter((l) => l.kind === 'bar');
    expect(bars.map((l) => l.time)).toEqual([0, 3, 6]);
  });
});

describe('editing commands', () => {
  const a = makeNote(60, 1, 0.5, 'right');
  const b = makeNote(64, 2, 0.5, 'right');
  const c = makeNote(48, 0.5, 1, 'left');
  const d0 = doc(a, b, c);

  it('keeps notes sorted after adding', () => {
    expect(d0.notes.map((n) => n.midi)).toEqual([48, 60, 64]);
  });

  it('deletes only the chosen notes and returns the same doc when nothing changes', () => {
    const d1 = deleteNotes(d0, new Set([a.id]));
    expect(d1.notes.map((n) => n.id)).toEqual([c.id, b.id]);
    expect(deleteNotes(d0, new Set([999]))).toBe(d0);
  });

  it('moves a group in time and pitch, never below time 0 or off the piano', () => {
    const ids = new Set([a.id, c.id]);
    const d1 = moveNotes(d0, ids, 0.25, 2);
    expect(d1.notes.find((n) => n.id === a.id)).toMatchObject({ midi: 62, start: 1.25 });
    expect(d1.notes.find((n) => n.id === c.id)).toMatchObject({ midi: 50, start: 0.75 });
    expect(d1.notes.find((n) => n.id === b.id)).toBe(b); // untouched notes are shared
    const d2 = moveNotes(d0, ids, -5, -100);
    expect(d2.notes.find((n) => n.id === c.id)).toMatchObject({ start: 0, midi: 21 });
    expect(d2.notes.find((n) => n.id === a.id)).toMatchObject({ start: 0.5, midi: 33 });
    expect(moveNotes(d0, ids, 0, 0)).toBe(d0);
  });

  it('lets notes already off the piano move back but not further out', () => {
    const off = makeNote(10, 0, 1, 'left');
    expect(limitMove([off], 0, -3).dmidi).toBe(0);
    expect(limitMove([off], 0, 5).dmidi).toBe(5);
  });

  it('resizes from either edge with a minimum length', () => {
    const ids = new Set([a.id]);
    const longer = resizeNotes(d0, ids, 0.5, 'end').notes.find((n) => n.id === a.id);
    expect(longer).toMatchObject({ start: 1, dur: 1 });
    const tiny = resizeNotes(d0, ids, -5, 'end').notes.find((n) => n.id === a.id);
    expect(tiny?.dur).toBe(MIN_DUR);
    const early = resizeNotes(d0, ids, -0.5, 'start').notes.find((n) => n.id === a.id);
    expect(early).toMatchObject({ start: 0.5, dur: 1 });
    const late = resizeNotes(d0, ids, 5, 'start').notes.find((n) => n.id === a.id);
    close(late!.start + late!.dur, 1.5);
    close(late!.dur, MIN_DUR);
  });

  it('switches hands', () => {
    const ids = new Set([a.id, c.id]);
    const swapped = setHand(d0, ids, 'swap');
    expect(swapped.notes.find((n) => n.id === a.id)?.hand).toBe('left');
    expect(swapped.notes.find((n) => n.id === c.id)?.hand).toBe('right');
    expect(setHand(d0, new Set([a.id]), 'right')).toBe(d0);
  });

  it('quantises starts and ends, keeping at least one step', () => {
    const g = makeGrid({ bpm: 120 });
    const n1 = makeNote(60, 0.27, 0.2, 'right');
    const n2 = makeNote(62, 1.02, 0.05, 'right');
    const d = quantise(doc(n1, n2), new Set([n1.id, n2.id]), g, 1 / 2);
    const q1 = d.notes.find((n) => n.id === n1.id)!;
    const q2 = d.notes.find((n) => n.id === n2.id)!;
    close(q1.start, 0.25);
    close(q1.dur, 0.25);
    close(q2.start, 1);
    close(q2.dur, 0.25);
    expect(quantise(d0, new Set([a.id]), g, 0)).toBe(d0);
  });

  it('copies and pastes relative to the first note', () => {
    const clip = copyClip(d0, new Set([a.id, b.id]))!;
    expect(clip.notes.map((n) => n.start)).toEqual([0, 1]);
    close(clip.span, 1.5);
    const r = pasteClip(d0, clip, 10);
    expect(r.doc.notes).toHaveLength(5);
    expect(r.doc.notes.filter((n) => r.ids.has(n.id)).map((n) => n.start)).toEqual([10, 11]);
    expect(copyClip(d0, new Set())).toBeNull();
  });

  it('duplicates right after the selection, on the grid', () => {
    const g = makeGrid({ bpm: 120 });
    const r = duplicate(d0, new Set([a.id]), g, 1);
    const copy = r.doc.notes.find((n) => r.ids.has(n.id))!;
    close(copy.start, 1.5);
    expect(copy.midi).toBe(60);
    const free = duplicate(d0, new Set([a.id, b.id]), null, 0);
    expect(free.doc.notes.filter((n) => free.ids.has(n.id)).map((n) => n.start)).toEqual([2.5, 3.5]);
  });

  it('box-selects notes that touch the box', () => {
    expect(idsInBox(d0.notes, 0.9, 2.1, 59, 70).sort()).toEqual([a.id, b.id].sort());
    expect(idsInBox(d0.notes, 2.1, 0.9, 70, 59).sort()).toEqual([a.id, b.id].sort());
    expect(idsInBox(d0.notes, 1.6, 1.9, 0, 127)).toEqual([]);
  });

  it('updates details and removes cleared ones', () => {
    const d1 = updateMeta(d0, { title: 'New', difficulty: 3 });
    expect(d1.meta).toMatchObject({ title: 'New', difficulty: 3 });
    const d2 = updateMeta(d1, { difficulty: undefined });
    expect('difficulty' in d2.meta).toBe(false);
    expect(updateMeta(d2, { title: 'New' })).toBe(d2);
  });

  it('steps to neighbouring notes in time order', () => {
    expect(neighbour(d0, null, 1)?.id).toBe(c.id);
    expect(neighbour(d0, null, -1)?.id).toBe(b.id);
    expect(neighbour(d0, c.id, 1)?.id).toBe(a.id);
    expect(neighbour(d0, b.id, 1)?.id).toBe(b.id);
    expect(neighbour({ notes: [], meta }, null, 1)).toBeNull();
  });
});
