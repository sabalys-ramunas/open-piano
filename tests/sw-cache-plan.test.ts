import { describe, expect, it } from 'vitest';
import {
  assetsToPrune,
  buildVersion,
  cacheable,
  cacheNames,
  classify,
  PRECACHE_MAX_BYTES,
  precacheList,
  songFilesToWarm,
  staleCaches,
} from '../src/sw/cache-plan';

const SCOPE = 'https://example.org/piano/';
const get = (url: string, mode = 'cors') => ({ url, method: 'GET', mode });

describe('classify', () => {
  it('routes each kind of file to its strategy', () => {
    expect(classify(get(`${SCOPE}`, 'navigate'), SCOPE)).toBe('navigate');
    expect(classify(get(`${SCOPE}play/twinkle`, 'navigate'), SCOPE)).toBe('navigate');
    expect(classify(get(`${SCOPE}assets/index-abc123.js`), SCOPE)).toBe('immutable');
    expect(classify(get(`${SCOPE}assets/tfjs-backend-wasm-simd-x.wasm`), SCOPE)).toBe('immutable');
    expect(classify(get(`${SCOPE}songs/index.json`), SCOPE)).toBe('revalidate');
    expect(classify(get(`${SCOPE}songs/bach-prelude-in-c.json`), SCOPE)).toBe('revalidate');
    expect(classify(get(`${SCOPE}community/lessons/a.json`), SCOPE)).toBe('revalidate');
    expect(classify(get(`${SCOPE}samples/piano/60f.mp3`), SCOPE)).toBe('media');
    expect(classify(get(`${SCOPE}model/model.json`), SCOPE)).toBe('media');
    expect(classify(get(`${SCOPE}manifest.webmanifest`), SCOPE)).toBe('revalidate');
    expect(classify(get(`${SCOPE}icons/icon-192.png`), SCOPE)).toBe('revalidate');
    expect(classify(get(`${SCOPE}fonts/fredoka-latin.woff2`), SCOPE)).toBe('revalidate');
    expect(classify(get(`${SCOPE}fonts/OFL-Fredoka.txt`), SCOPE)).toBe('skip');
  });

  it('never handles other origins, other methods, partial requests, blobs or the worker itself', () => {
    expect(classify(get('https://cdn.example.com/piano/assets/x.js'), SCOPE)).toBe('skip');
    expect(classify(get('https://example.org/other-app/assets/x.js'), SCOPE)).toBe('skip');
    expect(classify({ url: `${SCOPE}songs/a.json`, method: 'POST', mode: 'cors' }, SCOPE)).toBe('skip');
    expect(classify({ ...get(`${SCOPE}samples/piano/60f.mp3`), range: true }, SCOPE)).toBe('skip');
    expect(classify(get('blob:https://example.org/1234'), SCOPE)).toBe('skip');
    expect(classify(get('data:text/plain,hi'), SCOPE)).toBe('skip');
    expect(classify(get(`${SCOPE}sw.js`), SCOPE)).toBe('skip');
    expect(classify(get('not a url'), SCOPE)).toBe('skip');
    expect(classify(get(`${SCOPE}something-else.txt`), SCOPE)).toBe('skip');
  });
});

describe('precacheList', () => {
  const files = [
    { fileName: 'index.html', size: 1400 },
    { fileName: 'assets/index-a1.js', size: 74_000 },
    { fileName: 'assets/index-a1.css', size: 11_000 },
    { fileName: 'assets/home-b2.js', size: 15_000 },
    { fileName: 'assets/backend-c3.js', size: 789_000 },
    { fileName: 'assets/worker-d4.js', size: 1_500_000 },
    { fileName: 'assets/tfjs-backend-wasm-e5.wasm', size: 275_000 },
    { fileName: 'assets/index-a1.js.map', size: 200_000 },
    { fileName: 'icons/icon-192.png', size: 0 },
    { fileName: 'fonts/fredoka-latin.woff2', size: 0 },
    { fileName: 'sw.js', size: 6000 },
    { fileName: 'manifest.webmanifest', size: 800 },
  ];

  it('stores the page, the manifest, icons, fonts and the small JS and CSS files', () => {
    const list = precacheList(files, ['index.html', 'assets/index-a1.js', 'assets/index-a1.css']);
    expect(list).toContain('./');
    expect(list).toContain('manifest.webmanifest');
    expect(list).toContain('favicon.svg');
    expect(list).toContain('icons/icon-192.png');
    expect(list).toContain('fonts/fredoka-latin.woff2');
    expect(list).toContain('assets/index-a1.js');
    expect(list).toContain('assets/index-a1.css');
    expect(list).toContain('assets/home-b2.js');
  });

  it('leaves out the big listening files, wasm, source maps, the worker and a second copy of the page', () => {
    const list = precacheList(files, ['index.html']);
    expect(list).not.toContain('assets/backend-c3.js');
    expect(list).not.toContain('assets/worker-d4.js');
    expect(list).not.toContain('assets/tfjs-backend-wasm-e5.wasm');
    expect(list).not.toContain('assets/index-a1.js.map');
    expect(list).not.toContain('sw.js');
    expect(list).not.toContain('index.html');
  });

  it('always keeps the entry files, however big', () => {
    const big = [{ fileName: 'assets/index-z.js', size: PRECACHE_MAX_BYTES * 3 }];
    expect(precacheList(big, ['assets/index-z.js'])).toContain('assets/index-z.js');
    expect(precacheList(big)).not.toContain('assets/index-z.js');
  });
});

describe('versions and cache names', () => {
  it('gives the same version for the same files in any order, and a new one when a file changes', () => {
    const a = buildVersion(['assets/a-1.js', 'assets/b-2.css']);
    expect(buildVersion(['assets/b-2.css', 'assets/a-1.js'])).toBe(a);
    expect(buildVersion(['assets/a-9.js', 'assets/b-2.css'])).not.toBe(a);
    expect(a).toMatch(/^[0-9a-z]+$/);
  });

  it('deletes only our caches from older builds', () => {
    const names = cacheNames('v2');
    const existing = ['piano-shell-v1', 'piano-content-v1', names.shell, names.content, names.assets, names.media, 'piano-media-v0', 'someone-else'];
    expect(staleCaches(existing, 'v2').sort()).toEqual(['piano-content-v1', 'piano-media-v0', 'piano-shell-v1']);
  });

  it('prunes hashed files the current build no longer has', () => {
    const cached = [`${SCOPE}assets/old-1.js`, `${SCOPE}assets/home-2.js`, 'https://elsewhere.org/assets/home-2.js'];
    expect(assetsToPrune(cached, ['assets/home-2.js'], SCOPE)).toEqual([`${SCOPE}assets/old-1.js`, 'https://elsewhere.org/assets/home-2.js']);
  });
});

describe('songFilesToWarm', () => {
  it('lists the song files from the index, refusing unsafe names', () => {
    const index = { songs: ['a.json', '../secret.json', 'b.json', 'a.json', 42, 'c.txt', 'sub/d.json'] };
    expect(songFilesToWarm(index)).toEqual(['songs/a.json', 'songs/b.json']);
    expect(songFilesToWarm(null)).toEqual([]);
    expect(songFilesToWarm({ songs: 'a.json' })).toEqual([]);
    expect(songFilesToWarm({ songs: ['a.json', 'b.json', 'c.json'] }, 2)).toHaveLength(2);
  });
});

describe('cacheable', () => {
  it('keeps only complete successful answers from our own origin', () => {
    expect(cacheable({ ok: true, status: 200, type: 'basic' })).toBe(true);
    expect(cacheable({ ok: false, status: 404, type: 'basic' })).toBe(false);
    expect(cacheable({ ok: false, status: 500, type: 'basic' })).toBe(false);
    expect(cacheable({ ok: true, status: 206, type: 'basic' })).toBe(false);
    expect(cacheable({ ok: false, status: 0, type: 'opaque' })).toBe(false);
    expect(cacheable({ ok: true, status: 200, type: 'cors' })).toBe(false);
  });
});
