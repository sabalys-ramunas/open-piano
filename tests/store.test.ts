import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { getStreak, recordLesson, recordPlay, touchStreak } from '../src/app/progress';
import { memoryStore, openStore } from '../src/app/store';
import type { Song } from '../src/song';

const song: Song = {
  id: 'mine:test:10',
  title: 'Test',
  by: '',
  notes: [{ midi: 60, start: 0, dur: 1, hand: 'right' }],
  raw: [{ midi: 60, start: 0, dur: 1, amp: 0.9 }],
  audioUrl: 'blob:should-not-be-stored',
  source: 'mine',
};

function fakeLocalStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe('store fallback', () => {
  it('works in memory when IndexedDB is missing', async () => {
    const store = await openStore({ indexedDB: null });
    expect(store.persistent).toBe(false);
    await store.putSong(song);
    expect((await store.getSongs()).map((s) => s.song.id)).toEqual([song.id]);
  });

  it('falls back when IndexedDB refuses to open', async () => {
    const broken = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const store = await openStore({ indexedDB: broken });
    expect(store.persistent).toBe(false);
    await store.setValue('k', 1);
    expect(await store.getValue('k')).toBe(1);
  });

  it('keeps memory copies separate from the caller', async () => {
    const store = memoryStore();
    const copy = structuredClone(song);
    await store.putSong(copy);
    copy.title = 'Changed';
    expect((await store.getSongs())[0].song.title).toBe('Test');
  });
});

describe('IndexedDB store', () => {
  it('keeps songs, their recording and progress across reopening', async () => {
    const indexedDB = new IDBFactory();
    const first = await openStore({ indexedDB, localStorage: null });
    expect(first.persistent).toBe(true);
    await first.putSong(song);
    await first.putAudio(song.id, new Blob(['audio bytes'], { type: 'audio/mpeg' }));
    await first.putSong({ ...song, title: 'Renamed' }); // keeps the audio
    await recordPlay(first, song.id, 0.8);
    await first.setValue('settings', { volume: 0.3 });

    const second = await openStore({ indexedDB, localStorage: null });
    const [stored] = await second.getSongs();
    expect(stored.song.title).toBe('Renamed');
    expect(stored.song.audioUrl).toBeUndefined();
    expect(stored.song.raw).toEqual(song.raw);
    expect(stored.audio).toBeInstanceOf(Blob);
    expect(await stored.audio!.text()).toBe('audio bytes');
    expect(await second.getProgress(song.id)).toMatchObject({ best: 0.8, stars: 2, plays: 1 });
    expect(await second.getValue('settings')).toEqual({ volume: 0.3 });

    await second.deleteSong(song.id);
    expect(await second.getSongs()).toEqual([]);
    expect(await second.getProgress(song.id)).toBeUndefined();
  });

  it('moves old best scores out of localStorage', async () => {
    const legacy = fakeLocalStorage({ 'best:twinkle': '0.92', other: 'x' });
    const store = await openStore({ indexedDB: new IDBFactory(), localStorage: legacy });
    expect(await store.getProgress('twinkle')).toMatchObject({ best: 0.92, stars: 3 });
    expect(legacy.map.has('best:twinkle')).toBe(false);
    expect(legacy.map.get('other')).toBe('x');
  });
});

describe('progress', () => {
  it('keeps the best score and counts plays', async () => {
    const store = memoryStore();
    await recordPlay(store, 'ode', 0.95);
    const p = await recordPlay(store, 'ode', 0.4);
    expect(p).toMatchObject({ best: 0.95, stars: 3, plays: 2 });
  });

  it('counts a daily streak', async () => {
    const store = memoryStore();
    await touchStreak(store, new Date(2026, 0, 30, 9));
    await touchStreak(store, new Date(2026, 0, 30, 21));
    await touchStreak(store, new Date(2026, 0, 31, 8));
    expect(await getStreak(store)).toEqual({ current: 2, longest: 2, lastDay: '2026-01-31' });
    await touchStreak(store, new Date(2026, 1, 3));
    expect(await getStreak(store)).toEqual({ current: 1, longest: 2, lastDay: '2026-02-03' });
  });

  it('remembers finished course lessons', async () => {
    const store = memoryStore();
    await recordLesson(store, 'find-c', { completed: true, stars: 2 });
    const p = await recordLesson(store, 'find-c', { completed: false, stars: 1 });
    expect(p).toMatchObject({ completed: true, stars: 2, attempts: 2 });
  });
});
