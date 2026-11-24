import { describe, expect, it } from 'vitest';
import { Library } from '../src/app/library';
import { DEFAULT_SETTINGS, SettingsService } from '../src/app/settings';
import { memoryStore } from '../src/app/store';
import type { Song } from '../src/song';
import { BUILT_IN, loadSongPack } from '../src/songs';

const mine = (id: string, title = id): Song => ({ id, title, by: '', notes: [{ midi: 60, start: 0, dur: 1, hand: 'right' }] });

function urls() {
  let n = 0;
  const live = new Set<string>();
  return {
    make: (_blob: Blob) => {
      const url = `blob:${++n}`;
      live.add(url);
      return url;
    },
    drop: (url: string) => void live.delete(url),
    live,
  };
}

describe('library', () => {
  it('starts with the built-in songs', () => {
    const lib = new Library(memoryStore(), BUILT_IN);
    expect(lib.all().map((s) => s.id)).toEqual(['twinkle', 'ode', 'elise']);
    expect(lib.get('ode')?.source).toBe('built-in');
    expect(lib.bySource('mine')).toEqual([]);
  });

  it('adds, updates and removes songs and tells subscribers', async () => {
    const lib = new Library(memoryStore(), BUILT_IN);
    const seen: number[] = [];
    const off = lib.subscribe((songs) => seen.push(songs.length));
    await lib.add(mine('a'));
    expect(lib.get('a')?.source).toBe('mine');
    await lib.update({ ...lib.get('a')!, title: 'Renamed' });
    expect(lib.get('a')?.title).toBe('Renamed');
    await lib.remove('a');
    expect(lib.get('a')).toBeUndefined();
    off();
    await lib.add(mine('b'));
    expect(seen).toEqual([4, 4, 3]);
  });

  it('refuses to remove or replace built-in songs', async () => {
    const lib = new Library(memoryStore(), BUILT_IN);
    await expect(lib.remove('twinkle')).rejects.toThrow('cannot be removed');
    await expect(lib.add({ ...mine('twinkle') })).rejects.toThrow('cannot be replaced');
  });

  it('brings saved songs back, with a fresh link to their recording', async () => {
    const store = memoryStore();
    const u = urls();
    const first = new Library(store, BUILT_IN, u.make, u.drop);
    await first.add({ ...mine('rec'), source: 'community' }, { audio: new Blob(['x']) });
    expect(first.get('rec')?.audioUrl).toBe('blob:1');

    const second = new Library(store, BUILT_IN, u.make, u.drop);
    await second.load();
    const back = second.get('rec')!;
    expect(back.source).toBe('community');
    expect(back.audioUrl).toBe('blob:2');
    await second.remove('rec');
    expect(u.live.has('blob:2')).toBe(false);
  });

  it('attaches a recording to a lesson that was waiting for it', async () => {
    const store = memoryStore();
    const u = urls();
    const lib = new Library(store, [], u.make, u.drop);
    await lib.add({ ...mine('lesson:x:1'), recording: { name: 'x.mp3', bytes: 3 } });
    const song = await lib.attachAudio('lesson:x:1', new Blob(['abc']));
    expect(song.audioUrl).toBe('blob:1');
    const [stored] = await store.getSongs();
    expect(stored.audio).toBeInstanceOf(Blob);
  });

  it('keeps working when the store fails', async () => {
    const store = memoryStore();
    store.putSong = () => Promise.reject(new Error('quota'));
    const lib = new Library(store, []);
    const warn = console.warn;
    console.warn = () => {};
    try {
      await lib.add(mine('a'));
    } finally {
      console.warn = warn;
    }
    expect(lib.get('a')).toBeDefined();
  });
});

describe('song pack', () => {
  const respond = (body: unknown, ok = true) => ({
    ok,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  it('loads lesson files listed in the index and skips bad ones', async () => {
    const lesson = JSON.stringify({ format: 'piano-lesson', version: 1, title: 'Pack song', by: '', notes: [[60, 0, 1, 0]] });
    const files: Record<string, ReturnType<typeof respond>> = {
      '/songs/index.json': respond({ songs: ['good.json', '../secret.json', 'broken.json', 'missing.json', 42] }),
      '/songs/good.json': respond(lesson),
      '/songs/broken.json': respond('not json'),
    };
    const fetched: string[] = [];
    const songs = await loadSongPack(async (url) => {
      fetched.push(url);
      return files[url] ?? respond(null, false);
    }, '/');
    expect(songs.map((s) => [s.id, s.title, s.source])).toEqual([['pack:good', 'Pack song', 'built-in']]);
    expect(fetched).not.toContain('/songs/../secret.json');
  });

  it('copes with a missing index', async () => {
    expect(await loadSongPack(async () => respond(null, false), '/')).toEqual([]);
    expect(await loadSongPack(async () => Promise.reject(new Error('offline')), '/')).toEqual([]);
  });
});

describe('settings', () => {
  it('loads saved values, ignores bad ones and saves changes', async () => {
    const store = memoryStore();
    await store.setValue('settings', { volume: 0.2, view: 'upside-down', speed: 'fast', showNoteNames: false });
    const settings = new SettingsService(store);
    await settings.load();
    expect(settings.get().volume).toBe(0.2);
    expect(settings.get().view).toBe(DEFAULT_SETTINGS.view);
    expect(settings.get().showNoteNames).toBe(false);

    const changes: string[][] = [];
    settings.subscribe((_s, changed) => changes.push(changed));
    settings.set({ view: 'sheet', volume: 7 });
    expect(settings.get().view).toBe('sheet');
    expect(settings.get().volume).toBe(0.2);
    expect(changes).toEqual([['view']]);
    await Promise.resolve();
    expect(await store.getValue('settings')).toMatchObject({ view: 'sheet' });
  });
});
