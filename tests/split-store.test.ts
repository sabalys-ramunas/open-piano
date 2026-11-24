// The splitter download: where it looks, what it refuses, and keeping the files.
import { existsSync, readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { SPLITTER_FILES, SPLITTER_LOCAL_PATH, SPLITTER_UPSTREAM } from '../src/split/model-files';
import { SplitterDownloadError, downloadSplitter, forgetSplitter, loadSplitter, splitterStored } from '../src/split/model-store';

const DIR = 'public/models/spleeter-4stems/';
const haveModel = SPLITTER_FILES.every((f) => existsSync(DIR + f.file));
const BASE = 'http://app.test/';

beforeEach(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
});

type Call = { url: string; init?: RequestInit };

function fetcher(answer: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url);
  }) as typeof fetch;
  return { f, calls };
}

describe('downloading the splitter', () => {
  it('tries the copy next to the app first, then the public one, sending nothing personal; a missing file is an error', async () => {
    const { f, calls } = fetcher((url) =>
      url.startsWith(BASE)
        ? new Response('<!doctype html><title>app</title>', { headers: { 'Content-Type': 'text/html' } }) // a dev server's answer for a missing file
        : new Response('nope', { status: 404 }),
    );
    await expect(downloadSplitter({ base: BASE, fetcher: f })).rejects.toBeInstanceOf(SplitterDownloadError);
    expect(calls[0].url).toBe(BASE + SPLITTER_LOCAL_PATH + SPLITTER_FILES[0].file);
    expect(calls[1].url).toBe(SPLITTER_UPSTREAM + SPLITTER_FILES[0].file);
    expect(calls[1].init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' });
    expect(calls[1].init?.headers).toBeUndefined();
    expect(await splitterStored()).toBe(false);
  });

  it('refuses a file of the wrong size or contents', async () => {
    const f0 = SPLITTER_FILES[0];
    const wrong = new Uint8Array(f0.bytes); // right size, wrong bytes: the checksum catches it
    const { f } = fetcher(() => new Response(wrong, { headers: { 'Content-Length': String(f0.bytes) } }));
    await expect(downloadSplitter({ base: BASE, fetcher: f })).rejects.toThrow(/damaged/);
    const short = fetcher(() => new Response(new Uint8Array(10)));
    await expect(downloadSplitter({ base: BASE, fetcher: short.f })).rejects.toBeInstanceOf(SplitterDownloadError);
    expect(await splitterStored()).toBe(false);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { f } = fetcher(() => new Response('x'));
    await expect(downloadSplitter({ base: BASE, fetcher: f, signal: controller.signal })).rejects.toMatchObject({ name: 'Cancelled' });
  });

  it.skipIf(!haveModel)('keeps the files in IndexedDB, reports progress, never downloads twice, and can forget them', { timeout: 60_000 }, async () => {
    const { f, calls } = fetcher((url) => {
      const file = SPLITTER_FILES.find((x) => url.endsWith(x.file))!;
      return new Response(readFileSync(DIR + file.file), { headers: { 'Content-Type': 'application/octet-stream' } });
    });
    const seen: number[] = [];
    await downloadSplitter({ base: BASE, fetcher: f, onProgress: (got, total) => seen.push(got / total) });
    expect(calls.map((c) => c.url)).toEqual(SPLITTER_FILES.map((x) => BASE + SPLITTER_LOCAL_PATH + x.file));
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(await splitterStored()).toBe(true);
    const files = await loadSplitter();
    expect(files.map((x) => x.length)).toEqual(['vocals', 'drums', 'bass', 'other'].map((s) => SPLITTER_FILES.find((x) => x.stem === s)!.bytes));
    await downloadSplitter({ base: BASE, fetcher: f });
    expect(calls).toHaveLength(4);
    await forgetSplitter();
    expect(await splitterStored()).toBe(false);
    await expect(loadSplitter()).rejects.toBeInstanceOf(SplitterDownloadError);
  });
});
