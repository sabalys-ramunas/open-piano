// Downloads the splitter's networks once and keeps them on the device: in
// IndexedDB, or Cache Storage where IndexedDB refuses them. IndexedDB comes
// first because WebKit's private sessions (Safari private windows, Playwright's
// WebKit) empty Cache Storage on every reload while IndexedDB stays, and the
// iPad shell (piano://app/) may have no Cache Storage at all. Nothing here
// needs a service worker, http(s) or a secure context. Works in the page and
// in a worker.
//
// Requests carry nothing personal: no cookies, no referrer, no custom headers.

import { SPLITTER_FILES, SPLITTER_LOCAL_PATH, SPLITTER_UPSTREAM, SPLITTER_VERSION, type SplitterFile } from './model-files';
import { STEMS } from './spleeter';

/** Not "piano-": the offline worker deletes old caches with that prefix. */
const CACHE_NAME = `splitter-v${SPLITTER_VERSION}`;
const DB_NAME = 'splitter-files';
const DB_STORE = 'files';

/** The cache key of a file: its upstream address (Cache Storage only takes http(s) keys). */
const keyOf = (f: SplitterFile) => SPLITTER_UPSTREAM + f.file;
const idbKey = (f: SplitterFile) => `${SPLITTER_VERSION}:${f.file}`;

export class SplitterDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitterDownloadError';
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('No IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function idb<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const req = work(tx.objectStore(DB_STORE));
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? req.error);
        };
      }),
  );
}

async function readStored(f: SplitterFile, cache: Cache | null): Promise<ArrayBuffer | undefined> {
  try {
    const value = await idb('readonly', (s) => s.get(idbKey(f)) as IDBRequest<unknown>);
    if (value instanceof ArrayBuffer && value.byteLength === f.bytes) return value;
  } catch {
    // try Cache Storage
  }
  if (cache) {
    try {
      const hit = await cache.match(keyOf(f));
      if (hit) {
        const bytes = await hit.arrayBuffer();
        if (bytes.byteLength === f.bytes) return bytes;
      }
    } catch {
      // not stored
    }
  }
  return undefined;
}

async function isStored(f: SplitterFile, cache: Cache | null): Promise<boolean> {
  try {
    const key = await idb('readonly', (s) => s.getKey(idbKey(f)));
    if (key !== undefined) return true;
  } catch {
    // try Cache Storage
  }
  if (cache) {
    try {
      const hit = await cache.match(keyOf(f));
      if (hit && Number(hit.headers.get('Content-Length') ?? f.bytes) === f.bytes) return true;
    } catch {
      // not stored
    }
  }
  return false;
}

async function store(f: SplitterFile, bytes: Uint8Array<ArrayBuffer>, cache: Cache | null): Promise<void> {
  try {
    // Plain bytes, never a Blob: Safari's private windows refuse Blobs in IndexedDB.
    const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    await idb('readwrite', (s) => s.put(copy, idbKey(f)));
    return;
  } catch (error) {
    if (!cache) throw error;
  }
  await cache.put(keyOf(f), new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength) } }));
}

/** True when every network file is already on this device. */
export async function splitterStored(): Promise<boolean> {
  const cache = await openCache();
  for (const f of SPLITTER_FILES) if (!(await isStored(f, cache))) return false;
  return true;
}

/** The four networks in STEMS order (vocals, drums, bass, other), from the device. Throws when one is missing. */
export async function loadSplitter(): Promise<Uint8Array[]> {
  const cache = await openCache();
  const out: Uint8Array[] = [];
  for (const stem of STEMS) {
    const f = SPLITTER_FILES.find((x) => x.stem === stem)!;
    const bytes = await readStored(f, cache);
    if (!bytes) throw new SplitterDownloadError('The song splitter is not on this device yet.');
    out.push(new Uint8Array(bytes));
  }
  return out;
}

/** Removes the downloaded networks. */
export async function forgetSplitter(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
  } catch {
    // nothing stored there
  }
  try {
    await idb('readwrite', (s) => s.clear());
  } catch {
    // nothing stored there
  }
}

export interface DownloadOptions {
  /** The app's base address, to look for a copy next to the app first. Defaults to the page's own. */
  base?: string;
  onProgress?: (got: number, total: number) => void;
  signal?: AbortSignal;
  /** For tests. */
  fetcher?: typeof fetch;
}

/**
 * Downloads every network file that is not stored yet and stores it. Each file
 * is checked (size, and SHA-256 where the browser can compute it). Throws a
 * SplitterDownloadError with a short message on failure, or an error named
 * 'Cancelled'.
 */
export async function downloadSplitter(options: DownloadOptions = {}): Promise<void> {
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const cache = await openCache();
  const total = SPLITTER_FILES.reduce((s, f) => s + f.bytes, 0);
  let done = 0;
  const report = (extra: number) => options.onProgress?.(Math.min(total, done + extra), total);
  report(0);
  await checkRoom(total);
  const base = options.base ?? (typeof location !== 'undefined' ? new URL(import.meta.env?.BASE_URL ?? '/', location.href).href : '');
  for (const f of SPLITTER_FILES) {
    if (options.signal?.aborted) throw cancelled();
    if (await isStored(f, cache)) {
      done += f.bytes;
      report(0);
      continue;
    }
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    // A copy next to the app (development, tests, self-hosting) first, then the public one.
    const sources = base ? [new URL(SPLITTER_LOCAL_PATH + f.file, base).href, SPLITTER_UPSTREAM + f.file] : [SPLITTER_UPSTREAM + f.file];
    let lastProblem = '';
    for (const url of sources) {
      try {
        bytes = await fetchFile(fetcher, url, f, report, options.signal);
        if (bytes) break;
      } catch (error) {
        if (error instanceof Error && error.name === 'Cancelled') throw error;
        lastProblem = error instanceof Error ? error.message : String(error);
      }
    }
    if (!bytes) {
      console.warn('Could not download the song splitter.', lastProblem);
      throw new SplitterDownloadError('The song splitter could not be downloaded. Check the internet connection and try again.');
    }
    if (!(await matches(bytes, f))) throw new SplitterDownloadError('The song splitter download was damaged. Please try again.');
    try {
      await store(f, bytes, cache);
    } catch {
      throw new SplitterDownloadError('There is not enough room on this device to keep the song splitter.');
    }
    done += f.bytes;
    report(0);
  }
}

/** One file, or null when this source does not have it (missing, or a page instead of the file). */
async function fetchFile(
  fetcher: typeof fetch,
  url: string,
  f: SplitterFile,
  report: (extra: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const sameOrigin = typeof location !== 'undefined' && new URL(url, location.href).origin === location.origin;
  const res = await fetcher(url, {
    signal,
    credentials: sameOrigin ? 'same-origin' : 'omit',
    referrerPolicy: 'no-referrer',
    ...(sameOrigin ? {} : { mode: 'cors' as const }),
  });
  if (!res.ok) return null;
  const type = res.headers.get('Content-Type') ?? '';
  const length = Number(res.headers.get('Content-Length') ?? NaN);
  // A development server answers a missing file with the app's page.
  if (/text\/html/i.test(type) || (Number.isFinite(length) && length !== f.bytes)) {
    void res.body?.cancel().catch(() => {});
    return null;
  }
  const out = new Uint8Array(f.bytes);
  let got = 0;
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    if (all.length !== f.bytes) return null;
    report(f.bytes);
    return all;
  }
  const reader = res.body.getReader();
  for (;;) {
    if (signal?.aborted) {
      void reader.cancel().catch(() => {});
      throw cancelled();
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > f.bytes) {
      void reader.cancel().catch(() => {});
      return null;
    }
    out.set(value, got);
    got += value.length;
    report(got);
  }
  return got === f.bytes ? out : null;
}

async function matches(bytes: Uint8Array<ArrayBuffer>, f: SplitterFile): Promise<boolean> {
  if (bytes.length !== f.bytes) return false;
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) return true; // no hashing outside a secure context: the size has to do
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === f.sha256;
  } catch {
    return true;
  }
}

async function checkRoom(bytes: number): Promise<void> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < bytes * 1.2) {
      throw new SplitterDownloadError('There is not enough room on this device to keep the song splitter.');
    }
  } catch (error) {
    if (error instanceof SplitterDownloadError) throw error;
    // no estimate: just try
  }
}

function cancelled(): Error {
  const e = new Error('Cancelled');
  e.name = 'Cancelled';
  return e;
}
