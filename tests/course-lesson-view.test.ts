import { describe, expect, it } from 'vitest';
import { Library } from '../src/app/library';
import { memoryStore } from '../src/app/store';
import { allLessons, findLesson } from '../src/course/curriculum';
import { lessonSongIds, staffTokens } from '../src/course/lesson-view';
import { toSong } from '../src/course/music';
import { parseSnippet } from '../src/sheet/snippet';
import type { Song } from '../src/song';

describe('course lesson helpers', () => {
  it('turns staff pictures into notation tokens the sheet engine reads', () => {
    expect(staffTokens({ clef: 'treble', notes: [60, 62, 64] })).toBe('C4/q D4/q E4/q');
    expect(staffTokens({ clef: 'bass', notes: [43, 48] })).toBe('G2/q C3/q');
    for (const lesson of allLessons()) {
      for (const step of lesson.steps) {
        if ('staff' in step && step.staff) expect(() => parseSnippet(staffTokens(step.staff!)), lesson.id).not.toThrow();
      }
    }
  });

  it('lists the library songs a lesson plays', () => {
    const withSong = allLessons().find((l) => l.steps.some((s) => s.kind === 'song'));
    expect(withSong).toBeDefined();
    expect(lessonSongIds(withSong!)).toContain('ode');
    expect(lessonSongIds(findLesson('find-c')!)).toEqual([]);
  });

  it('resolves lesson songs registered for on-demand loading', async () => {
    const ode: Song = { id: 'pack:x', title: 'X', by: '', notes: [{ midi: 60, start: 0, dur: 1, hand: 'right' }] };
    const lib = new Library(memoryStore());
    lib.registerLazy([{ summary: { id: 'pack:x', title: 'X', by: '', tags: [] }, load: async () => ode }]);
    expect(lib.get('pack:x')).toBeUndefined();
    expect((await lib.ensure('pack:x'))?.notes).toHaveLength(1);
    expect(lib.get('pack:x')?.source).toBe('built-in');
  });

  it('keeps finger numbers when a phrase becomes a song', () => {
    const song = toSong({ bpm: 60, beatsPerBar: 4, notes: [{ midi: 60, beat: 0, beats: 1, hand: 'right', finger: 1 }] }, 'x', 'X');
    expect(song.notes[0].finger).toBe(1);
  });
});
