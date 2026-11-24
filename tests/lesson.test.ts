import { describe, expect, it } from 'vitest';
import { fromLesson, toLesson } from '../src/lesson';
import type { Song } from '../src/song';
import { BUILT_IN } from '../src/songs';

const file = (extra: Record<string, unknown>, notes: unknown = [[60, 0, 1, 0]]) =>
  JSON.stringify({ format: 'piano-lesson', version: 1, title: 't', by: '', notes, ...extra });

describe('lesson files', () => {
  it('round-trips a song', () => {
    const song = { ...BUILT_IN[2], recording: { name: 'elise.mp3', bytes: 1234 } };
    const back = fromLesson(JSON.stringify(toLesson(song)));
    expect(back.title).toBe(song.title);
    expect(back.recording).toEqual(song.recording);
    expect(back.notes.length).toBe(song.notes.length);
    back.notes.forEach((n, i) => {
      expect(n.midi).toBe(song.notes[i].midi);
      expect(n.hand).toBe(song.notes[i].hand);
      expect(n.start).toBeCloseTo(song.notes[i].start, 3);
    });
  });

  it('never includes audio, the raw notes or where the song came from', () => {
    const song: Song = { ...BUILT_IN[0], audioUrl: 'blob:secret', raw: [{ midi: 60, start: 0, dur: 1, amp: 1 }] };
    const text = JSON.stringify(toLesson(song));
    expect(text).not.toContain('blob:');
    expect(text).not.toContain('raw');
    expect(text).not.toContain('source');
  });

  it('rejects files that are not lessons', () => {
    expect(() => fromLesson('hello')).toThrow('not a lesson file');
    expect(() => fromLesson('null')).toThrow('not a lesson file');
    expect(() => fromLesson('{"format":"other","notes":[]}')).toThrow('not a lesson file');
    expect(() => fromLesson('{"format":"piano-lesson","version":2,"notes":[[60,0,1,0]]}')).toThrow('newer version');
  });

  it('rejects damaged or hostile notes', () => {
    const notes = (n: unknown) => file({}, n);
    expect(() => fromLesson(notes([[999, 0, 1, 0]]))).toThrow('damaged');
    expect(() => fromLesson(notes([[60, -5, 1, 0]]))).toThrow('damaged');
    expect(() => fromLesson(notes([[60, 0, 1, 7]]))).toThrow('damaged');
    expect(() => fromLesson(notes(['x']))).toThrow('damaged');
    expect(() => fromLesson(notes([]))).toThrow('no usable notes');
  });

  it('still reads a version 1 file from before the metadata fields', () => {
    const old = '{"format":"piano-lesson","version":1,"title":"Old","by":"Me","notes":[[60,0,0.5,0],[48,0,1,1]]}';
    const song = fromLesson(old);
    expect(song.title).toBe('Old');
    expect(song.notes.map((n) => n.hand)).toEqual(['left', 'right']);
    expect(song.bpm).toBeUndefined();
    expect(song.chords).toBeUndefined();
  });

  it('round-trips the optional metadata', () => {
    const song: Song = {
      ...BUILT_IN[0],
      difficulty: 2,
      bpm: 96,
      beats: [0, 0.625, 1.25],
      timeSignature: { beats: 3, unit: 4 },
      chords: [
        { start: 0, dur: 1.25, label: 'C' },
        { start: 1.25, dur: 1, label: 'G7' },
      ],
      tags: ['lullaby', 'easy'],
      licence: 'CC0',
      credit: 'Arranged by a friend',
    };
    const back = fromLesson(JSON.stringify(toLesson(song)));
    expect(back.difficulty).toBe(2);
    expect(back.bpm).toBe(96);
    expect(back.beats).toEqual([0, 0.625, 1.25]);
    expect(back.timeSignature).toEqual({ beats: 3, unit: 4 });
    expect(back.chords).toEqual(song.chords);
    expect(back.tags).toEqual(['lullaby', 'easy']);
    expect(back.licence).toBe('CC0');
    expect(back.credit).toBe('Arranged by a friend');
    expect(back.source).toBeUndefined();
  });

  it('rejects malformed metadata', () => {
    expect(() => fromLesson(file({ difficulty: 9 }))).toThrow('damaged');
    expect(() => fromLesson(file({ difficulty: 2.5 }))).toThrow('damaged');
    expect(() => fromLesson(file({ bpm: '120' }))).toThrow('damaged');
    expect(() => fromLesson(file({ bpm: 5000 }))).toThrow('damaged');
    expect(() => fromLesson(file({ beats: [1, 0.5] }))).toThrow('damaged');
    expect(() => fromLesson(file({ beats: [0, null] }))).toThrow('damaged');
    expect(() => fromLesson(file({ timeSignature: { beats: 3, unit: 5 } }))).toThrow('damaged');
    expect(() => fromLesson(file({ timeSignature: '3/4' }))).toThrow('damaged');
    expect(() => fromLesson(file({ chords: [[0, 1, '']] }))).toThrow('damaged');
    expect(() => fromLesson(file({ chords: [[0, 1, 'x'.repeat(50)]] }))).toThrow('damaged');
    expect(() => fromLesson(file({ chords: [{ start: 0 }] }))).toThrow('damaged');
    expect(() => fromLesson(file({ tags: new Array(30).fill('a') }))).toThrow('damaged');
    expect(() => fromLesson(file({ tags: [{}] }))).toThrow('damaged');
    expect(() => fromLesson(file({ licence: 42 }))).toThrow('damaged');
    expect(() => fromLesson(file({ credit: 'x'.repeat(600) }))).toThrow('damaged');
  });

  it('ignores fields it does not know', () => {
    const song = fromLesson(file({ source: 'built-in', audioUrl: 'javascript:alert(1)', id: 'twinkle' }));
    expect(song.source).toBeUndefined();
    expect(song.audioUrl).toBeUndefined();
    expect(song.id).not.toBe('twinkle');
  });
});
