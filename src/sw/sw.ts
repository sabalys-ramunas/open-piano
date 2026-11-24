/**
 * The offline worker. Built by the plugin in vite.config.ts into dist/sw.js,
 * which replaces the three placeholders below with this build's details.
 * Never loaded in development.
 *
 * - Install: stores the app shell (precache list) in a cache named after the build.
 * - Activate: deletes caches of older builds, prunes old hashed files, then
 *   stores the song files in the background so the library works offline.
 * - Fetch: see `classify` in cache-plan.ts for which strategy each request gets.
 * - Updates wait until the page asks (message SKIP_WAITING), so nobody is
 *   switched to a new version in the middle of a song.
 */
import { assetsToPrune, cacheable, cacheNames, classify, songFilesToWarm, staleCaches, type Strategy } from './cache-plan';

// ---- Minimal worker types (the project's TypeScript setup uses the DOM library). ----
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface MessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}
interface WorkerScope {
  readonly registration: { readonly scope: string };
  readonly caches: CacheStorage;
  readonly clients: { claim(): Promise<void> };
  readonly navigator: { readonly connection?: { readonly saveData?: boolean } };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

declare const __PIANO_VERSION__: string;
declare const __PIANO_PRECACHE__: readonly string[];
declare const __PIANO_ASSETS__: readonly string[];

const sw = self as unknown as WorkerScope;
const VERSION = __PIANO_VERSION__;
const PRECACHE = __PIANO_PRECACHE__;
const ASSETS = __PIANO_ASSETS__;
const NAMES = cacheNames(VERSION);
const SCOPE = sw.registration.scope;
const NAVIGATION_TIMEOUT_MS = 3500;

const abs = (path: string): string => new URL(path, SCOPE).href;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await sw.caches.open(NAMES.shell);
      // `reload` skips the browser's HTTP cache, so the shell matches this build exactly.
      await cache.addAll(PRECACHE.map((p) => new Request(abs(p), { cache: 'reload' })));
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await sw.caches.keys();
      await Promise.all(staleCaches(names, VERSION).map((n) => sw.caches.delete(n)));
      try {
        const assets = await sw.caches.open(NAMES.assets);
        const keys = await assets.keys();
        const old = assetsToPrune(
          keys.map((r) => r.url),
          ASSETS,
          SCOPE,
        );
        await Promise.all(old.map((u) => assets.delete(u)));
      } catch {
        // pruning is housekeeping only
      }
      await sw.clients.claim();
      void warmSongs();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data && data.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  const strategy: Strategy = classify(
    { url: request.url, method: request.method, mode: request.mode, range: request.headers.has('range') },
    SCOPE,
  );
  switch (strategy) {
    case 'navigate':
      event.respondWith(navigate(request));
      return;
    case 'immutable':
      event.respondWith(cacheFirst(request, NAMES.assets));
      return;
    case 'media':
      event.respondWith(cacheFirst(request, NAMES.media));
      return;
    case 'revalidate':
      event.respondWith(staleWhileRevalidate(request, event));
      return;
    case 'skip':
      return;
  }
});

/** Stores a copy when the response is a complete success from our origin. */
async function put(cacheName: string, request: Request | string, response: Response): Promise<void> {
  if (!cacheable(response)) return;
  try {
    const cache = await sw.caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // storage full or refused: just do not keep it
  }
}

/**
 * `Vary` is ignored when reading the caches: servers often send `Vary: Origin`,
 * and a module script asks with an Origin header while the stored copy was
 * fetched without one, so a normal match misses and the app cannot start
 * offline. Our files are the same whatever the headers.
 */
const MATCH = { ignoreVary: true } as const;

/** Looks in the shell cache first (it holds this build's files), then in `cacheName`. */
async function cached(request: Request | string, cacheName: string): Promise<Response | undefined> {
  const shell = await sw.caches.open(NAMES.shell);
  const hit = await shell.match(request, MATCH);
  if (hit) return hit;
  const cache = await sw.caches.open(cacheName);
  return cache.match(request, MATCH);
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const hit = await cached(request, cacheName);
  if (hit) return hit;
  const response = await sw.fetch(request);
  void put(cacheName, request, response.clone());
  return response;
}

async function staleWhileRevalidate(request: Request, event: ExtendableEventLike): Promise<Response> {
  const cache = await sw.caches.open(NAMES.content);
  const hit = (await cache.match(request, MATCH)) ?? (await (await sw.caches.open(NAMES.shell)).match(request, MATCH));
  const refresh = sw
    .fetch(request)
    .then(async (response) => {
      await put(NAMES.content, request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  const fresh = await refresh;
  return fresh ?? new Response('Offline', { status: 503, statusText: 'Offline' });
}

/** Page loads: the network when it answers quickly, otherwise the stored app page. */
async function navigate(request: Request): Promise<Response> {
  const fallback = async (): Promise<Response | undefined> => {
    const shell = await sw.caches.open(NAMES.shell);
    return (await shell.match(abs('./'), MATCH)) ?? undefined;
  };
  let timer = 0;
  const timeout = new Promise<undefined>((resolve) => {
    timer = sw.setTimeout(() => resolve(undefined), NAVIGATION_TIMEOUT_MS);
  });
  const network = sw.fetch(request).catch(() => undefined);
  const first = await Promise.race([network, timeout]);
  sw.clearTimeout(timer);
  if (first && first.ok) return first;
  const stored = await fallback();
  if (stored) return stored;
  // Nothing stored yet: wait for the network after all, or say so.
  const late = await network;
  return late ?? new Response('You are offline, and this app has not been stored for offline use yet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * Stores the built-in songs after an install or update, two at a time with a
 * pause between them, so the whole library works offline without slowing the
 * first visit. Skipped when the person asked their browser to save data.
 */
async function warmSongs(): Promise<void> {
  if (sw.navigator.connection?.saveData) return;
  try {
    const cache = await sw.caches.open(NAMES.content);
    const indexUrl = abs('songs/index.json');
    let index = await cache.match(indexUrl, MATCH);
    if (!index) {
      const res = await sw.fetch(indexUrl);
      await put(NAMES.content, indexUrl, res.clone());
      index = res;
    }
    if (!index.ok) return;
    const files = songFilesToWarm(await index.json());
    files.push('community/index.json');
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const url = abs(files[next++]);
        if (await cache.match(url, MATCH)) continue;
        try {
          await put(NAMES.content, url, await sw.fetch(url));
        } catch {
          return; // offline again: try on the next update
        }
        await new Promise<void>((resolve) => sw.setTimeout(resolve, 150));
      }
    };
    await Promise.all([worker(), worker()]);
  } catch {
    // warming is a bonus; songs are still cached as they are opened
  }
}
