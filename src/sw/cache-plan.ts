/**
 * Pure decisions for the offline worker (src/sw/sw.ts) and the build plugin
 * (vite.config.ts): which files make up the app shell, and how each request
 * is handled. Kept free of worker globals so it can be tested directly.
 */

/** How the worker answers a request. */
export type Strategy =
  /** Page loads: network first (short timeout), the cached app page when offline. */
  | 'navigate'
  /** Hashed build files (JS, CSS, wasm): cache first; their names change when their content does. */
  | 'immutable'
  /** Songs and shared lessons: answer from the cache at once and refresh it in the background. */
  | 'revalidate'
  /** Piano samples and the note model: large, rarely change, cached the first time they are used. */
  | 'media'
  /** Not handled by the worker: the browser fetches it as usual. */
  | 'skip';

/** The parts of a request the plan looks at. */
export interface RequestInfo {
  url: string;
  method: string;
  /** Request.mode: 'navigate' for page loads. */
  mode: string;
  /** True when the request has a Range header (partial media requests are never cached). */
  range?: boolean;
}

/**
 * Picks the strategy for a request. `scope` is the worker's scope URL (the
 * folder the app is served from). Anything that is not a plain GET to our
 * own origin inside the scope is skipped, so the worker never stores other
 * sites' data, uploads, blob: URLs or partial responses.
 */
export function classify(request: RequestInfo, scope: string): Strategy {
  if (request.method !== 'GET' || request.range) return 'skip';
  let url: URL;
  let base: URL;
  try {
    url = new URL(request.url);
    base = new URL(scope);
  } catch {
    return 'skip';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'skip';
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return 'skip';
  if (request.mode === 'navigate') return 'navigate';
  const path = url.pathname.slice(base.pathname.length);
  if (path === 'sw.js') return 'skip';
  if (path.startsWith('assets/')) return 'immutable';
  if (path.startsWith('songs/') || path.startsWith('community/')) return 'revalidate';
  if (path.startsWith('samples/') || path.startsWith('model/')) return 'media';
  if (path === 'manifest.webmanifest' || path === 'favicon.svg' || path.startsWith('icons/')) return 'revalidate';
  if (path.startsWith('fonts/') && path.endsWith('.woff2')) return 'revalidate';
  return 'skip';
}

/** A file the build produced, with its size in bytes. */
export interface BuiltFile {
  fileName: string;
  size: number;
}

/** Build files larger than this are not downloaded up front; they are cached when first used. */
export const PRECACHE_MAX_BYTES = 160 * 1024;

/**
 * The app shell to store when the worker installs: the page, the manifest,
 * icons and fonts, and every JS and CSS file of the app except the big ones only
 * the "add your own song" listening step needs (the note model runtime and
 * its wasm). Those, the piano samples and the songs are cached on first use.
 * The page and the entry files are always included, whatever their size.
 */
export function precacheList(files: readonly BuiltFile[], required: readonly string[] = []): string[] {
  const out = new Set<string>(['./', 'manifest.webmanifest', 'favicon.svg']);
  const must = new Set(required);
  for (const f of files) {
    const name = f.fileName;
    if (name === 'sw.js' || name.endsWith('.map')) continue;
    if (must.has(name)) {
      out.add(name);
      continue;
    }
    if (name.startsWith('icons/') || (name.startsWith('fonts/') && name.endsWith('.woff2'))) {
      out.add(name);
      continue;
    }
    if (!name.startsWith('assets/')) continue;
    if (!/\.(js|css)$/.test(name)) continue;
    if (f.size > PRECACHE_MAX_BYTES) continue;
    out.add(name);
  }
  out.delete('index.html'); // stored once, as './'
  return [...out].sort();
}

/** A short version id for the cache names, from the names of every built file (they carry content hashes). */
export function buildVersion(fileNames: readonly string[]): string {
  let h = 2166136261;
  for (const name of [...fileNames].sort()) {
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 10;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Bump when the samples or the note model change, so old copies are dropped. */
export const MEDIA_VERSION = 1;

/** The cache names one build uses. Media and hashed assets survive updates; shell and content are per build. */
export function cacheNames(version: string): { shell: string; content: string; assets: string; media: string } {
  return {
    shell: `piano-shell-${version}`,
    content: `piano-content-${version}`,
    assets: 'piano-assets',
    media: `piano-media-v${MEDIA_VERSION}`,
  };
}

/** Caches from older builds that the new worker deletes when it takes over. */
export function staleCaches(existing: readonly string[], version: string): string[] {
  const keep = new Set(Object.values(cacheNames(version)));
  return existing.filter((name) => name.startsWith('piano-') && !keep.has(name));
}

/**
 * Song files to store in the background after an update, from
 * songs/index.json. Index data is treated as untrusted: only plain file names.
 */
export function songFilesToWarm(index: unknown, limit = 500): string[] {
  const listed = (index as { songs?: unknown } | null)?.songs;
  if (!Array.isArray(listed)) return [];
  const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/;
  const out: string[] = [];
  for (const f of listed) {
    if (out.length >= limit) break;
    if (typeof f === 'string' && safe.test(f) && !f.includes('..') && !out.includes(`songs/${f}`)) out.push(`songs/${f}`);
  }
  return out;
}

/** True when a response may be stored: a complete, successful answer from our own origin. */
export function cacheable(response: { ok: boolean; status: number; type: string }): boolean {
  return response.ok && response.status === 200 && (response.type === 'basic' || response.type === 'default');
}

/**
 * Hashed build files kept from older builds that the current build no longer
 * has, so the shared assets cache does not grow forever.
 */
export function assetsToPrune(cachedUrls: readonly string[], currentFiles: readonly string[], scope: string): string[] {
  const current = new Set(currentFiles);
  const base = new URL(scope);
  return cachedUrls.filter((u) => {
    try {
      const url = new URL(u);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return true;
      return !current.has(url.pathname.slice(base.pathname.length));
    } catch {
      return true;
    }
  });
}
