import { describe, expect, it } from 'vitest';
import { History } from '../src/editor/history';
import { MIN_DUR, docFromSong, docLength, makeNote, songFromDoc, withDetailsFrom } from '../src/editor/model';
import { fromLesson, toLesson } from '../src/lesson';
import { seq, type Song } from '../src/song';

const song: Song = {
  id: 'mine:1',
  title: 'Tune',
  by: 'Someone',
  notes: [...seq('right', 0.5, 'C4/1 E4/1 G4/2'), ...seq('left', 0.5, 'C3/4')].sort((a, b) => a.start - b.start || a.midi - b.midi),
  source: 'mine',
  audioUrl: 'blob:x',
  recording: { name: 'tune.mp3', bytes: 10 },
  difficulty: 2,
  tags: ['easy'],
  bpm: 120,
  timeSignature: { beats: 3, unit: 4 },
  licence: 'CC0',
  credit: 'Me',
};

describe('editor document', () => {
  it('round-trips a song through the editor without losing anything', () => {
    const doc = docFromSong(song);
    expect(doc.notes).toHaveLength(4);
    expect(new Set(doc.notes.map((n) => n.id)).size).toBe(4);
    const back = songFromDoc(doc, song);
    expect(back.id).toBe('mine:1');
    expect(back.audioUrl).toBe('blob:x');
    expect(back.recording).toEqual(song.recording);
    expect(toLesson(back)).toEqual(toLesson(song));
  });

  it('keeps notes sorted and clamps impossible values', () => {
    const n = makeNote(60.4, -3, 0, 'right');
    expect(n).toMatchObject({ midi: 60, start: 0, dur: MIN_DUR });
    const doc = docFromSong({ ...song, notes: [{ midi: 64, start: 2, dur: 1, hand: 'right' }, { midi: 60, start: 1, dur: 1, hand: 'left' }] });
    expect(doc.notes.map((x) => x.midi)).toEqual([60, 64]);
    expect(docLength(doc.notes)).toBe(3);
  });

  it('removes cleared details and leaves out notes off the piano when saving', () => {
    const doc = docFromSong(song);
    const cleared = {
      notes: [...doc.notes, makeNote(10, 1, 1, 'left')],
      meta: { title: '  ', by: 'x', tags: [] },
    };
    const out = songFromDoc(cleared, song);
    expect(out.title).toBe('Untitled');
    expect(out.tags).toBeUndefined();
    expect(out.difficulty).toBeUndefined();
    expect(out.bpm).toBeUndefined();
    expect(out.notes).toHaveLength(4);
    // What we save is always a valid lesson.
    expect(() => fromLesson(JSON.stringify(toLesson(out)))).not.toThrow();
  });

  it('takes details from another song for restoring drafts', () => {
    const other: Song = { id: 'x', title: 'New name', by: '', notes: [], difficulty: 5 };
    const merged = withDetailsFrom(song, other);
    expect(merged.id).toBe('mine:1');
    expect(merged.title).toBe('New name');
    expect(merged.difficulty).toBe(5);
    expect(merged.tags).toBeUndefined();
    expect(merged.audioUrl).toBe('blob:x');
  });
});

describe('undo history', () => {
  it('undoes and redoes in order', () => {
    const h = new History<number>(0);
    h.push(1, 'one');
    h.push(2, 'two');
    expect(h.undoLabel).toBe('two');
    expect(h.undo()).toBe(1);
    expect(h.redoLabel).toBe('two');
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(2);
    expect(h.redo()).toBeNull();
  });

  it('drops redo after a new edit and ignores no-op pushes', () => {
    const h = new History<string>('a');
    h.push('b', 'b');
    h.undo();
    h.push('c', 'c');
    expect(h.canRedo).toBe(false);
    h.push('c', 'same');
    expect(h.size).toBe(1);
  });

  it('groups quick edits of the same kind into one step', () => {
    const h = new History<string>('');
    h.push('H', 'type', 'title', 1000);
    h.push('He', 'type', 'title', 1200);
    h.push('Hey', 'type', 'title', 1400);
    expect(h.size).toBe(1);
    expect(h.undo()).toBe('');
    // A pause starts a new step.
    h.push('A', 'type', 'title', 10_000);
    h.push('AB', 'type', 'title', 20_000);
    expect(h.size).toBe(2);
  });

  it('never groups across an undo', () => {
    const h = new History<number>(0);
    h.push(1, 'move', 'g', 0);
    h.push(2, 'move', 'g', 10);
    h.undo();
    h.push(5, 'move', 'g', 20);
    expect(h.present).toBe(5);
    expect(h.undo()).toBe(0);
  });

  it('keeps a deep but bounded history', () => {
    const h = new History<number>(0, 300);
    for (let i = 1; i <= 1000; i++) h.push(i, 'step');
    expect(h.size).toBe(300);
    let undone = 0;
    while (h.undo() !== null) undone++;
    expect(undone).toBe(300);
    expect(h.present).toBe(700);
  });

  it('replace changes the present without an undo step', () => {
    const h = new History<number>(0);
    h.push(1, 'one');
    h.replace(2);
    expect(h.present).toBe(2);
    expect(h.undo()).toBe(0);
    expect(h.redo()).toBe(2);
  });
});

describe('marking hand edits', () => {
  const base = { notes: [{ midi: 60, start: 0, dur: 1, hand: 'right' as const }] };
  const song = { id: 's', title: 'S', by: '', ...base };

  it('marks a song edited when its notes change, and keeps the mark', async () => {
    const { markEdited, notesDiffer } = await import('../src/editor/model');
    expect(notesDiffer(base.notes, base.notes)).toBe(false);
    expect(markEdited(song, base).edited).toBeUndefined();
    const moved = { ...song, notes: [{ ...base.notes[0], start: 0.5 }] };
    expect(markEdited(moved, base).edited).toBe(true);
    expect(markEdited(song, { ...base, edited: true }).edited).toBe(true);
    expect(markEdited(song, undefined).edited).toBe(true);
  });
});
