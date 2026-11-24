import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Library } from '../src/app/library';
import { SettingsService } from '../src/app/settings';
import { memoryStore } from '../src/app/store';
import {
  CatalogError,
  catalogUrlFrom,
  cleanCatalogUrl,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  fetchCatalogSong,
  fetchLessonFromLink,
  installEntry,
  type FetchLike,
} from '../src/community/catalog';
import { allTags, filterLessons, fold, formatBytes, formatLength, licenceWords } from '../src/community/filter';
import { sha256, utf8Bytes } from '../src/community/sha256';
import { checkLesson, describeLesson, parseCatalog, resolveLessonUrl, type CatalogEntry } from '../src/community/validate';

const root = join(__dirname, '..');
const seedIndex = readFileSync(join(root, 'community', 'index.json'), 'utf8');

const lessonText = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'piano-lesson',
    version: 1,
    title: 'Little Tune',
    by: 'Someone',
    notes: [
      [60, 0, 0.5, 0],
      [62, 0.5, 0.5, 0],
      [48, 0, 1, 1],
    ],
    licence: 'CC0 1.0',
    ...extra,
  });

function entryFor(text: string, fields: Partial<CatalogEntry> = {}): CatalogEntry {
  return { ...describeLesson(text, { id: 'little-tune', url: 'lessons/little-tune.json', arranger: 'Ana', tags: ['folk'] }), ...fields };
}

/** A fetch that serves fixed files and records every request. */
function fakeFetch(files: Record<string, string | number>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const body = files[url];
    if (body === undefined) return new Response('missing', { status: 404 });
    if (typeof body === 'number') return new Response('oops', { status: body });
    return new Response(body, { status: 200 });
  };
  return { fetcher, calls };
}

describe('sha256', () => {
  it('matches known values and node crypto', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const long = 'Für Elise 🎹 '.repeat(500);
    expect(sha256(long)).toBe(createHash('sha256').update(long, 'utf8').digest('hex'));
    expect(utf8Bytes('Für')).toBe(4);
  });
});

describe('catalog parsing', () => {
  it('reads the seed catalog with no problems', () => {
    const { catalog, problems } = parseCatalog(seedIndex);
    expect(problems).toEqual([]);
    expect(catalog.lessons.length).toBeGreaterThanOrEqual(3);
  });

  it('leaves out bad entries and says why, keeping the good ones', () => {
    const good = entryFor(lessonText());
    const input = JSON.stringify({
      format: 'piano-catalog',
      version: 1,
      lessons: [
        good,
        { ...good, id: 'Bad Id!' },
        { ...good, id: 'no-licence', licence: '' },
        { ...good, id: 'script-url', url: 'javascript:alert(1)' },
        { ...good, id: 'too-big', bytes: 50_000_000 },
        { ...good, id: 'sneaky-title', title: 'Hello‮gnp.exe' },
        { ...good, id: 'bad-hash', sha256: 'abc' },
        { ...good, id: 'bad-level', difficulty: 9 },
        good, // the same id again
        'not an object',
      ],
    });
    const { catalog, problems } = parseCatalog(input);
    expect(catalog.lessons.map((l) => l.id)).toEqual(['little-tune']);
    expect(problems).toHaveLength(9);
    expect(problems.join('\n')).toMatch(/listed twice/);
  });

  it('refuses things that are not catalogs', () => {
    expect(() => parseCatalog('<html>')).toThrow('not a list of shared songs');
    expect(() => parseCatalog(JSON.stringify({ format: 'piano-catalog', version: 2, lessons: [] }))).toThrow('newer version');
    expect(() => parseCatalog('x'.repeat(2_000_001))).toThrow('too big');
  });

  it('only allows http(s) lesson addresses without passwords', () => {
    const base = 'https://lessons.example/catalog/index.json';
    expect(resolveLessonUrl('lessons/a.json', base)).toBe('https://lessons.example/catalog/lessons/a.json');
    expect(resolveLessonUrl('javascript:alert(1)', base)).toBeNull();
    expect(resolveLessonUrl('data:application/json,{}', base)).toBeNull();
    expect(resolveLessonUrl('https://user:pw@evil.example/a.json', base)).toBeNull();
  });
});

describe('strict lesson check', () => {
  it('accepts a clean lesson and checks it against its entry', () => {
    const text = lessonText();
    const entry = entryFor(text);
    expect(checkLesson(text, entry).notes).toHaveLength(3);
    expect(() => checkLesson(text + ' ', entry)).toThrow('size is different');
    expect(() => checkLesson(text, { ...entry, sha256: '0'.repeat(64) })).toThrow('has been changed');
    expect(() => checkLesson(text, { ...entry, notes: 4 })).toThrow('notes are different');
    expect(() => checkLesson(text, { ...entry, seconds: 60 })).toThrow('length is different');
  });

  it('refuses audio, lyrics and anything else lessons may not hold', () => {
    expect(() => checkLesson(lessonText({ audio: 'data:audio/mp3;base64,AAAA' }))).toThrow('extra content');
    expect(() => checkLesson(lessonText({ lyrics: 'la la la' }))).toThrow('extra content');
    expect(() => checkLesson(lessonText({ title: '' }))).toThrow('broken title');
    expect(() => checkLesson(lessonText({ notes: [[200, 0, 1, 0]] }))).toThrow('damaged');
    expect(() => checkLesson('{"format":"piano-lesson","version":1,"title":"x","notes":[' + '[60,0,1,0],'.repeat(140_000) + '[60,0,1,0]]}')).toThrow(
      'too big',
    );
  });
});

describe('search, filters and order', () => {
  const base = entryFor(lessonText());
  const lessons: CatalogEntry[] = [
    { ...base, id: 'a', title: 'Für Elise', artist: 'Ludwig van Beethoven', difficulty: 4, seconds: 130, tags: ['classical'], added: '2026-01-02' },
    { ...base, id: 'b', title: 'Maple Leaf Rag', artist: 'Scott Joplin', difficulty: 5, seconds: 144, tags: ['ragtime'], added: '2026-03-01' },
    { ...base, id: 'c', title: 'Greensleeves', artist: 'Traditional', arranger: 'Mia', difficulty: 2, seconds: 58, tags: ['folk', 'classical'] },
  ];

  it('finds words anywhere, ignoring accents and case', () => {
    expect(fold('Für ÉLISE')).toBe('fur elise');
    expect(filterLessons(lessons, { query: 'fur elise' }).map((l) => l.id)).toEqual(['a']);
    expect(filterLessons(lessons, { query: 'joplin rag' }).map((l) => l.id)).toEqual(['b']);
    expect(filterLessons(lessons, { query: 'mia' }).map((l) => l.id)).toEqual(['c']);
    expect(filterLessons(lessons, { query: 'nothing here' })).toEqual([]);
  });

  it('filters by level and tag', () => {
    expect(filterLessons(lessons, { difficulty: 2 }).map((l) => l.id)).toEqual(['c']);
    expect(filterLessons(lessons, { tag: 'classical' }).map((l) => l.id)).toEqual(['a', 'c']);
    expect(allTags(lessons)).toEqual(['classical', 'folk', 'ragtime']);
  });

  it('sorts', () => {
    expect(filterLessons(lessons, { sort: 'title' }).map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(filterLessons(lessons, { sort: 'easiest' }).map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(filterLessons(lessons, { sort: 'hardest' }).map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(filterLessons(lessons, { sort: 'shortest' }).map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(filterLessons(lessons, { sort: 'newest' }).map((l) => l.id)).toEqual(['b', 'a', 'c']);
  });

  it('formats lengths and sizes', () => {
    expect(formatLength(65)).toBe('1:05');
    expect(formatBytes(4_200_000)).toBe('4.2 MB');
    expect(formatBytes(4200)).toBe('4 KB');
  });
});

describe('downloading and installing', () => {
  const indexUrl = 'https://lessons.example/catalog/index.json';
  const text = lessonText({ recording: undefined });
  const entry = entryFor(text, { recording: { name: 'little-tune.mp3', bytes: 3_000_000 } });
  const catalogText = JSON.stringify({ format: 'piano-catalog', version: 1, lessons: [entry] });
  const files = { [indexUrl]: catalogText, 'https://lessons.example/catalog/lessons/little-tune.json': text };

  it('fetches the catalog without credentials', async () => {
    const { fetcher, calls } = fakeFetch(files);
    const result = await fetchCatalog(indexUrl, fetcher);
    expect(result.catalog.lessons).toHaveLength(1);
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.referrerPolicy).toBe('no-referrer');
  });

  it('turns failures into friendly errors', async () => {
    const missing = fakeFetch({});
    await expect(fetchCatalog(indexUrl, missing.fetcher)).rejects.toMatchObject({ kind: 'not-found' });
    await expect(fetchCatalog(indexUrl, fakeFetch({ [indexUrl]: 500 }).fetcher)).rejects.toMatchObject({ kind: 'unreachable' });
    await expect(fetchCatalog(indexUrl, async () => Promise.reject(new TypeError('Failed to fetch')))).rejects.toBeInstanceOf(CatalogError);
    await expect(fetchCatalog(indexUrl, fakeFetch({ [indexUrl]: '<html>hello</html>' }).fetcher)).rejects.toMatchObject({ kind: 'invalid' });
    const huge: FetchLike = async () => new Response('x', { headers: { 'content-length': '99999999' } });
    await expect(fetchCatalog(indexUrl, huge)).rejects.toMatchObject({ kind: 'too-big' });
    // A server that lies about the size is cut off while reading.
    const stream: FetchLike = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(500_000).fill(32));
          },
        }),
      );
    await expect(fetchCatalog(indexUrl, stream)).rejects.toMatchObject({ kind: 'too-big' });
  });

  it('downloads a lesson, checks it and adds it to the library as a community song', async () => {
    const library = new Library(memoryStore(), [], () => 'blob:1', () => {});
    const { fetcher, calls } = fakeFetch(files);
    const song = await installEntry(library, entry, indexUrl, fetcher);
    expect(song.id).toBe('community:little-tune');
    expect(song.source).toBe('community');
    expect(song.recording).toEqual({ name: 'little-tune.mp3', bytes: 3_000_000 });
    expect(song.licence).toBe('CC0 1.0');
    expect(library.get('community:little-tune')?.notes).toHaveLength(3);
    expect(calls.every((c) => c.init?.credentials === 'omit')).toBe(true);

    // Adding it again keeps the recording the player attached.
    await library.attachAudio(song.id, new Blob(['mp3']));
    await installEntry(library, entry, indexUrl, fetcher);
    expect(library.get(song.id)?.audioUrl).toBe('blob:1');
    expect(library.bySource('community')).toHaveLength(1);
  });

  it('refuses a lesson that does not match its entry', async () => {
    const tampered = { ...files, 'https://lessons.example/catalog/lessons/little-tune.json': text.replace('Little Tune', 'Little Tuna') };
    await expect(fetchCatalogSong(entry, indexUrl, fakeFetch(tampered).fetcher)).rejects.toThrow('not the one the list describes');
  });

  it('adds a lesson from a link with a stable id', async () => {
    const url = 'https://friend.example/tune.json';
    const a = await fetchLessonFromLink(url, fakeFetch({ [url]: text }).fetcher);
    const b = await fetchLessonFromLink(url, fakeFetch({ [url]: text }).fetcher);
    expect(a.id).toMatch(/^community:link-[0-9a-f]{16}$/);
    expect(a.id).toBe(b.id);
    await expect(fetchLessonFromLink('javascript:alert(1)')).rejects.toThrow('web address');
    await expect(fetchLessonFromLink(url, fakeFetch({ [url]: lessonText({ audio: 'x' }) }).fetcher)).rejects.toThrow('extra content');
  });

  it('reads and checks the catalog address kept in settings', () => {
    expect(catalogUrlFrom({ catalogUrl: '' })).toBe(DEFAULT_CATALOG_URL);
    expect(catalogUrlFrom({ catalogUrl: 'https://club.example/lessons/index.json' })).toBe('https://club.example/lessons/index.json');
    expect(catalogUrlFrom({ catalogUrl: 'javascript:alert(1)' })).toBe(DEFAULT_CATALOG_URL);
    expect(cleanCatalogUrl('  https://club.example/lessons/index.json ')).toBe('https://club.example/lessons/index.json');
    expect(cleanCatalogUrl('')).toBe('');
    expect(cleanCatalogUrl('javascript:alert(1)')).toBeNull();
    expect(cleanCatalogUrl('https://a b')).toBeNull();
  });

  it('moves an address saved by older versions into the settings', async () => {
    const store = memoryStore();
    await store.setValue('community:catalog-url', 'https://club.example/lessons/index.json');
    const settings = new SettingsService(store);
    await settings.load();
    expect(settings.get().catalogUrl).toBe('https://club.example/lessons/index.json');
    expect(await store.getValue('community:catalog-url')).toBeNull();
    const again = new SettingsService(store);
    await again.load();
    expect(again.get().catalogUrl).toBe('https://club.example/lessons/index.json');
  });
});

describe('the community seed folder', () => {
  const { catalog } = parseCatalog(seedIndex);

  it('every lesson passes the strict check against its entry', () => {
    for (const entry of catalog.lessons) {
      const text = readFileSync(join(root, 'community', entry.url), 'utf8');
      expect(() => checkLesson(text, entry), entry.id).not.toThrow();
      expect(entry.url).toBe(`lessons/${entry.id}.json`);
    }
    expect(readdirSync(join(root, 'community', 'lessons')).sort()).toEqual(catalog.lessons.map((l) => `${l.id}.json`).sort());
  });

  it('the copy the app serves offline matches it', () => {
    expect(readFileSync(join(root, 'public', 'community', 'index.json'), 'utf8')).toBe(seedIndex);
    for (const entry of catalog.lessons) {
      expect(readFileSync(join(root, 'public', 'community', entry.url), 'utf8')).toBe(readFileSync(join(root, 'community', entry.url), 'utf8'));
    }
  });

  it('has a contributor guide and a content policy', () => {
    const policy = readFileSync(join(root, 'community', 'POLICY.md'), 'utf8');
    expect(policy).toMatch(/not legal advice/i);
    expect(policy).toMatch(/takedown/i);
    expect(policy).toMatch(/lyrics/i);
    const guide = readFileSync(join(root, 'community', 'CONTRIBUTING.md'), 'utf8');
    expect(guide).toMatch(/validate\.mjs/);
  });
});

describe('licence in plain words', () => {
  it('says what you may do, in words a child understands', () => {
    expect(licenceWords('Public domain')).toBe('Free for everyone, no strings');
    expect(licenceWords('CC0 1.0 (simplified arrangement of a public domain edition)')).toBe('Free for everyone, no strings');
    expect(licenceWords('CC BY 4.0')).toBe('Free to share. Just credit the maker');
    expect(licenceWords('CC BY-SA 3.0')).toBe('Free to share. Credit the maker and keep the same licence');
    expect(licenceWords('CC BY-NC 4.0')).toMatch(/not to sell/);
    expect(licenceWords('CC BY-ND 4.0')).toMatch(/unchanged/);
    expect(licenceWords('')).toMatch(/Ask the maker/);
    expect(licenceWords('My own terms')).toBe('My own terms');
    for (const l of ['Public domain', 'CC BY 4.0', 'CC BY-SA 3.0', '']) expect(licenceWords(l)).not.toContain('—');
  });
});
