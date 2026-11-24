import { describe, expect, it } from 'vitest';
import { Library, type LazySong } from '../src/app/library';
import { memoryStore } from '../src/app/store';
import type { Song } from '../src/song';
import { BUILT_IN, loadSongPackIndex } from '../src/songs';

const lessonText = (title: string, notes = 1) =>
  JSON.stringify({ format: 'piano-lesson', version: 1, title, by: 'x', notes: Array.from({ length: notes }, (_, i) => [60, i, 0.5, 0]) });

function lazy(id: string, load: () => Promise<Song>): LazySong {
  return { summary: { id, title: `Song ${id}`, by: 'Someone', difficulty: 2, tags: ['tag'], seconds: 30, noteCount: 3 }, load };
}
const full = (id: string): Song => ({ id: 'ignored', title: `Song ${id}`, by: 'Someone', notes: [{ midi: 60, start: 0, dur: 1, hand: 'right' }] });

describe('library on-demand songs', () => {
  it('lists lazy songs by summary before their notes are loaded', () => {
    const lib = new Library(memoryStore(), BUILT_IN);
    lib.registerLazy([lazy('pack:a', async () => full('a'))]);
    expect(lib.get('pack:a')).toBeUndefined();
    expect(lib.has('pack:a')).toBe(true);
    const s = lib.summary('pack:a');
    expect(s).toMatchObject({ id: 'pack:a', source: 'built-in', loaded: false, difficulty: 2, seconds: 30, tags: ['tag'] });
    expect(lib.summaries().map((x) => x.id)).toEqual(['twinkle', 'ode', 'elise', 'pack:a']);
    expect(lib.summary('ode')?.loaded).toBe(true);
  });

  it('loads a song once even when asked many times, and keeps its id', async () => {
    const lib = new Library(memoryStore());
    let calls = 0;
    lib.registerLazy([lazy('pack:a', async () => (calls++, full('a')))]);
    const seen: number[] = [];
    lib.subscribe((songs) => seen.push(songs.length));
    const [one, two] = await Promise.all([lib.ensure('pack:a'), lib.ensure('pack:a')]);
    expect(calls).toBe(1);
    expect(one).toBe(two);
    expect(one).toMatchObject({ id: 'pack:a', source: 'built-in' });
    expect(lib.get('pack:a')).toBe(one);
    expect(lib.summary('pack:a')?.loaded).toBe(true);
    expect(seen).toEqual([1]);
    expect(await lib.ensure('pack:a')).toBe(one);
    expect(calls).toBe(1);
  });

  it('resolves undefined for unknown ids and failed loads, and can try again later', async () => {
    const lib = new Library(memoryStore());
    let fail = true;
    lib.registerLazy([lazy('pack:b', async () => {
      if (fail) throw new Error('offline');
      return full('b');
    })]);
    expect(await lib.ensure('nope')).toBeUndefined();
    expect(await lib.ensure('pack:b')).toBeUndefined();
    expect(lib.has('pack:b')).toBe(true);
    fail = false;
    expect((await lib.ensure('pack:b'))?.id).toBe('pack:b');
  });

  it('prefers a full song registered later and never duplicates ids', async () => {
    const lib = new Library(memoryStore());
    lib.registerLazy([lazy('pack:c', async () => full('c'))]);
    lib.register([{ ...full('c'), id: 'pack:c', title: 'Eager' }]);
    expect(lib.summaries().filter((s) => s.id === 'pack:c')).toHaveLength(1);
    expect((await lib.ensure('pack:c'))?.title).toBe('Eager');
    lib.registerLazy([lazy('pack:c', async () => full('c'))]);
    expect(lib.summaries().filter((s) => s.id === 'pack:c')).toHaveLength(1);
  });

  it('refuses to replace or remove lazy built-in songs', async () => {
    const lib = new Library(memoryStore());
    lib.registerLazy([lazy('pack:d', async () => full('d'))]);
    await expect(lib.add({ ...full('d'), id: 'pack:d' })).rejects.toThrow('cannot be replaced');
    await expect(lib.remove('pack:d')).rejects.toThrow('cannot be removed');
  });

  it('stamps songs with the time they were added', async () => {
    const lib = new Library(memoryStore());
    const before = Date.now();
    const added = await lib.add({ ...full('e'), id: 'mine:e' });
    expect(added.addedAt).toBeGreaterThanOrEqual(before);
    await lib.add({ ...added, title: 'Again', addedAt: undefined });
    expect(lib.get('mine:e')?.addedAt).toBe(added.addedAt);
  });
});

describe('song pack index', () => {
  function server(files: Record<string, string>) {
    const requested: string[] = [];
    const fetcher = async (url: string) => {
      requested.push(url);
      const body = files[url];
      return { ok: body !== undefined, json: async () => JSON.parse(body ?? 'null'), text: async () => body ?? '' };
    };
    return { fetcher, requested };
  }

  it('turns songs with details into lazy entries and fetches only the index at first', async () => {
    const { fetcher, requested } = server({
      '/songs/index.json': JSON.stringify({
        songs: ['a.json', 'b.json'],
        details: [
          { file: 'a.json', title: 'A', by: 'Composer', difficulty: 2, tags: ['x'], seconds: 12, notes: 3, licence: 'CC0' },
          { file: 'b.json', title: 'B', by: 'Other' },
        ],
      }),
      '/songs/a.json': lessonText('A', 3),
      '/songs/b.json': lessonText('B'),
    });
    const { lazy: entries, songs } = await loadSongPackIndex(fetcher, '/');
    expect(songs).toEqual([]);
    expect(requested).toEqual(['/songs/index.json']);
    expect(entries.map((e) => e.summary)).toEqual([
      { id: 'pack:a', title: 'A', by: 'Composer', difficulty: 2, tags: ['x'], seconds: 12, noteCount: 3, licence: 'CC0' },
      { id: 'pack:b', title: 'B', by: 'Other', difficulty: undefined, tags: [], seconds: undefined, noteCount: undefined, licence: undefined },
    ]);
    const a = await entries[0].load();
    expect(a).toMatchObject({ id: 'pack:a', title: 'A', source: 'built-in' });
    expect(a.notes).toHaveLength(3);
  });

  it('fetches songs without details right away, skipping unsafe names', async () => {
    const { fetcher, requested } = server({
      '/songs/index.json': JSON.stringify({ songs: ['c.json', '../evil.json', 'd.json'], details: [{ file: 'd.json', title: 'D', by: '' }] }),
      '/songs/c.json': lessonText('C'),
      '/songs/d.json': lessonText('D'),
    });
    const { lazy: entries, songs } = await loadSongPackIndex(fetcher, '/');
    expect(songs.map((s) => s.id)).toEqual(['pack:c']);
    expect(entries.map((e) => e.summary.id)).toEqual(['pack:d']);
    expect(requested.some((u) => u.includes('evil'))).toBe(false);
  });

  it('ignores untrusted or broken details, falling back to fetching the file', async () => {
    const { fetcher } = server({
      '/songs/index.json': JSON.stringify({
        songs: ['e.json', 'f.json', 'g.json'],
        details: [
          { file: 'e.json', title: '', by: 'x' },
          { file: 'f.json', title: 'F', by: 'x', difficulty: 9, tags: ['ok', 7, 'y'.repeat(80)], seconds: -3 },
          'nonsense',
          { file: '../g.json', title: 'G', by: 'x' },
        ],
      }),
      '/songs/e.json': lessonText('E'),
      '/songs/f.json': lessonText('F'),
      '/songs/g.json': lessonText('G'),
    });
    const { lazy: entries, songs } = await loadSongPackIndex(fetcher, '/');
    expect(entries.map((e) => e.summary)).toEqual([
      { id: 'pack:f', title: 'F', by: 'x', difficulty: undefined, tags: ['ok'], seconds: undefined, noteCount: undefined, licence: undefined },
    ]);
    expect(songs.map((s) => s.id)).toEqual(['pack:e', 'pack:g']);
  });

  it('a lazy entry whose file is missing rejects, and the library treats it as not loaded', async () => {
    const { fetcher } = server({ '/songs/index.json': JSON.stringify({ songs: ['h.json'], details: [{ file: 'h.json', title: 'H', by: '' }] }) });
    const { lazy: entries } = await loadSongPackIndex(fetcher, '/');
    await expect(entries[0].load()).rejects.toThrow();
    const lib = new Library(memoryStore());
    lib.registerLazy(entries);
    expect(await lib.ensure('pack:h')).toBeUndefined();
  });

  it('returns nothing when the index is missing or the network is down', async () => {
    const { fetcher } = server({});
    expect(await loadSongPackIndex(fetcher, '/')).toEqual({ lazy: [], songs: [] });
    expect(await loadSongPackIndex(async () => Promise.reject(new Error('offline')), '/')).toEqual({ lazy: [], songs: [] });
  });

  it('works with the real index: every listed song has details', async () => {
    const { readFileSync } = await import('node:fs');
    const index = JSON.parse(readFileSync('public/songs/index.json', 'utf8'));
    const fetcher = async (url: string) => {
      const path = `public${url}`;
      try {
        const text = readFileSync(path, 'utf8');
        return { ok: true, json: async () => JSON.parse(text), text: async () => text };
      } catch {
        return { ok: false, json: async () => null, text: async () => '' };
      }
    };
    const { lazy: entries, songs } = await loadSongPackIndex(fetcher, '/');
    expect(songs).toEqual([]);
    expect(entries).toHaveLength(index.songs.length);
    const first = await entries[0].load();
    expect(first.notes.length).toBe(entries[0].summary.noteCount);
  });
});
