import { describe, expect, it } from 'vitest';
import type { SongSummary } from '../src/app/library';
import type { SongProgress } from '../src/app/store';
import { overallProgress, suggestedHands } from '../src/home/import-flow';
import {
  buildSections,
  countText,
  EMPTY_QUERY,
  filterSongs,
  fold,
  lastPlayed,
  lessonFileName,
  librarySections,
  liveStreakDays,
  matchesSearch,
  popularTags,
  sortSongs,
  dragHasFiles,
  bestNext,
  greeting,
  homeShelves,
} from '../src/home/library-view';
import { songStartFor } from '../src/import';
import type { MidiTrack } from '../src/import/midifile';

const song = (id: string, extra: Partial<SongSummary> = {}): SongSummary => ({
  id,
  title: id,
  by: '',
  source: 'built-in',
  tags: [],
  needsRecording: false,
  hasRecording: false,
  edited: false,
  loaded: false,
  ...extra,
});
const played = (songId: string, lastPlayed: number, best = 0.8): SongProgress => ({ songId, best, stars: 2, plays: 1, lastPlayed });

const library: SongSummary[] = [
  song('elise', { title: 'Für Elise', by: 'Ludwig van Beethoven', difficulty: 3, tags: ['classical'], seconds: 90 }),
  song('twinkle', { title: 'Twinkle, Twinkle, Little Star', by: 'Traditional', difficulty: 1, tags: ['children'], seconds: 40 }),
  song('ode', { title: 'Ode to Joy', by: 'Ludwig van Beethoven', difficulty: 2, tags: ['classical'], seconds: 30 }),
  song('mine:a', { title: 'My Tune', source: 'mine', addedAt: 200, seconds: 120 }),
  song('community:b', { title: 'Shared Waltz', source: 'community', difficulty: 2, addedAt: 100, tags: ['waltz'] }),
];

describe('home library search and filters', () => {
  it('folds accents and case', () => {
    expect(fold('Für ÉLISE')).toBe('fur elise');
  });

  it('matches every word against title, composer and tags', () => {
    expect(matchesSearch(library[0], 'fur elise')).toBe(true);
    expect(matchesSearch(library[0], 'beethoven classical')).toBe(true);
    expect(matchesSearch(library[0], 'beethoven children')).toBe(false);
    expect(matchesSearch(library[0], '   ')).toBe(true);
  });

  it('filters by level, tag and search together', () => {
    expect(filterSongs(library, { ...EMPTY_QUERY, level: 2 }).map((s) => s.id)).toEqual(['ode', 'community:b']);
    expect(filterSongs(library, { ...EMPTY_QUERY, tag: 'classical', search: 'joy' }).map((s) => s.id)).toEqual(['ode']);
  });

  it('sorts stably by each key', () => {
    const progress = new Map([['ode', played('ode', 50)], ['elise', played('elise', 90)]]);
    expect(sortSongs(library, 'title', progress).map((s) => s.id)).toEqual(['elise', 'mine:a', 'ode', 'community:b', 'twinkle']);
    expect(sortSongs(library, 'level', progress).map((s) => s.id)).toEqual(['twinkle', 'ode', 'community:b', 'elise', 'mine:a']);
    expect(sortSongs(library, 'length', progress).map((s) => s.id)).toEqual(['ode', 'twinkle', 'elise', 'mine:a', 'community:b']);
    expect(sortSongs(library, 'added', progress).map((s) => s.id).slice(0, 2)).toEqual(['mine:a', 'community:b']);
    expect(sortSongs(library, 'played', progress).map((s) => s.id).slice(0, 2)).toEqual(['elise', 'ode']);
    expect(sortSongs(library, 'suggested', progress)).toEqual(library);
  });

  it('puts my songs and shared songs first, then built-in songs by level', () => {
    const sections = buildSections(library, EMPTY_QUERY);
    expect(sections.map((s) => s.id)).toEqual(['mine', 'community', 'level-1', 'level-2', 'level-3']);
    expect(sections[3].title).toBe('Level 2 · Easy');
  });

  it('shows built-in songs as one list while searching or sorting', () => {
    const sections = librarySections(library, { ...EMPTY_QUERY, search: 'beethoven' }, new Map());
    expect(sections.map((s) => [s.id, s.songs.map((x) => x.id)])).toEqual([['built-in', ['elise', 'ode']]]);
  });

  it('offers tags used by at least two songs', () => {
    expect(popularTags(library)).toEqual(['classical']);
  });

  it('finds the last played song still in the library', () => {
    const list = [played('gone', 999), played('ode', 10), played('elise', 20)];
    expect(lastPlayed(list, (id) => id !== 'gone')?.songId).toBe('elise');
    expect(lastPlayed([], () => true)).toBeUndefined();
  });

  it('words the result count', () => {
    expect(countText(5, 5)).toBe('5 songs');
    expect(countText(1, 1)).toBe('1 song');
    expect(countText(0, 5)).toBe('No songs match');
    expect(countText(2, 5)).toBe('2 of 5 songs');
  });

  it('makes safe lesson file names', () => {
    expect(lessonFileName('Für Elise: part 1/2')).toBe('Für Elise part 12.lesson.json');
    expect(lessonFileName('???')).toBe('lesson.lesson.json');
  });

  it('counts a streak only while it is current', () => {
    const now = new Date(2026, 10, 23, 12);
    expect(liveStreakDays({ current: 4, lastDay: '2026-11-23' }, now)).toBe(4);
    expect(liveStreakDays({ current: 4, lastDay: '2026-11-22' }, now)).toBe(4);
    expect(liveStreakDays({ current: 4, lastDay: '2026-11-20' }, now)).toBe(0);
    expect(liveStreakDays(null, now)).toBe(0);
  });

  it('only reacts to drags that carry files', () => {
    expect(dragHasFiles(['text/plain', 'Files'])).toBe(true);
    expect(dragHasFiles(['text/uri-list'])).toBe(false);
    expect(dragHasFiles(undefined)).toBe(false);
  });
});

describe('add-song flow helpers', () => {
  it('maps stage progress onto one bar that only grows across stages', () => {
    expect(overallProgress('reading', 0)).toBe(0);
    expect(overallProgress('reading', 1)).toBeCloseTo(overallProgress('listening', 0));
    expect(overallProgress('listening', 0.5)).toBeGreaterThan(overallProgress('listening', 0.1));
    expect(overallProgress('analysing', 1)).toBe(1);
    expect(overallProgress('listening', Number.NaN)).toBe(overallProgress('listening', 0));
  });

  it('starts the track chooser from the suggested hands', () => {
    const t = (index: number, suggested: MidiTrack['suggested']): MidiTrack => ({ index, name: '', instrument: '', notes: 10, low: 40, high: 80, thickness: 1, suggested });
    expect(suggestedHands([t(0, 'right'), t(1, 'none'), t(2, 'left'), t(3, 'right')])).toEqual({ right: [0, 3], left: [2] });
  });

  it('uses the detected song start unless one is given', () => {
    expect(songStartFor(undefined, 1.5)).toBe(1.5);
    expect(songStartFor(0, 1.5)).toBe(0);
    expect(songStartFor(2, 1.5)).toBe(2);
    expect(songStartFor(undefined, Number.NaN)).toBe(0);
    expect(songStartFor(-1, undefined)).toBe(0);
  });
});

describe('home rows and the big card', () => {
  it('builds rows: my songs first, then Start here, styles easiest first, and the rest', () => {
    const songs = [
      ...library,
      song('mine:1', { source: 'mine', addedAt: 1 }),
      song('mine:2', { source: 'mine', addedAt: 2 }),
      song('community:x', { source: 'community' }),
      song('march', { difficulty: 4, tags: ['march'] }),
      song('lonely', { difficulty: 3, tags: [] }),
    ];
    const rows = homeShelves(songs);
    expect(rows.map((r) => r.id)).toEqual(['mine', 'from-shared', 'start', 'children', 'classical', 'dance', 'more']);
    expect(rows[0].songs.map((s) => s.id)).toEqual(['mine:a', 'mine:2', 'mine:1']);
    expect(rows.find((r) => r.id === 'start')!.songs.map((s) => s.id)).toEqual(['twinkle']);
    expect(rows.find((r) => r.id === 'classical')!.songs.map((s) => s.id)).toEqual(['ode', 'elise']);
    expect(rows.find((r) => r.id === 'more')!.songs.map((s) => s.id)).toEqual(['lonely']);
  });

  it('greets by the time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning!');
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon!');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening!');
    expect(greeting(new Date(2026, 0, 1, 2))).toBe('Good evening!');
  });

  it('chooses the single best next thing', () => {
    const next = { id: 'keys-de', title: 'D and E', number: 2, unit: 0 };
    const fresh = { done: 0, total: 40, next: { ...next, id: 'find-c', number: 1 }, lastLessonAt: 0 };
    expect(bestNext(fresh, undefined, 'twinkle')).toMatchObject({ kind: 'first-lesson', lessonId: 'find-c' });
    const started = { done: 1, total: 40, next, lastLessonAt: 2000 };
    expect(bestNext(started, played('ode', 1000), 'twinkle')).toMatchObject({ kind: 'lesson', lessonId: 'keys-de', done: 1 });
    expect(bestNext(started, played('ode', 3000), 'twinkle')).toMatchObject({ kind: 'song', songId: 'ode' });
    expect(bestNext(fresh, played('ode', 3000), 'twinkle')).toMatchObject({ kind: 'song', songId: 'ode' });
    expect(bestNext({ done: 40, total: 40, lastLessonAt: 5 }, undefined, 'twinkle')).toEqual({ kind: 'first-song', songId: 'twinkle' });
    expect(bestNext(null, undefined, undefined)).toBeNull();
  });
});
