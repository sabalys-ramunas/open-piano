import type { Library } from '../app/library';
import type { Song } from '../song';
import { sha256 } from './sha256';
import {
  checkLesson,
  MAX_CATALOG_BYTES,
  MAX_LESSON_BYTES,
  parseCatalog,
  resolveLessonUrl,
  type CatalogEntry,
  type ParsedCatalog,
} from './validate';

export type { CatalogEntry, CatalogIndex, ParsedCatalog } from './validate';

/**
 * Downloads the community catalog and its lessons. Everything downloaded is
 * untrusted: requests never send cookies, sizes are capped while reading,
 * every file goes through the strict checks in validate.ts, and nothing is
 * ever run or shown as HTML.
 */

/** The bundled seed catalog (a copy of the top-level community/ folder), so the screen works offline. */
export const DEFAULT_CATALOG_URL = `${import.meta.env.BASE_URL}community/index.json`;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'body' | 'text'>>;

export type CatalogErrorKind = 'offline' | 'unreachable' | 'not-found' | 'invalid' | 'too-big';

/** A failure with a message a player can read. */
export class CatalogError extends Error {
  constructor(
    readonly kind: CatalogErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

const REQUEST: RequestInit = {
  credentials: 'omit',
  redirect: 'follow',
  referrerPolicy: 'no-referrer',
  cache: 'no-cache',
  headers: { Accept: 'application/json' },
};

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Reads a response as text, giving up as soon as it grows past `max` bytes. */
async function readCapped(res: Pick<Response, 'headers' | 'body' | 'text'>, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new CatalogError('too-big', 'This file is too big to open.');
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > max) throw new CatalogError('too-big', 'This file is too big to open.');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => {});
      throw new CatalogError('too-big', 'This file is too big to open.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Fetches a file with the untrusted-download rules. `what` names it in messages ("list of shared songs", "lesson"). */
async function download(url: string, max: number, what: string, fetcher: FetchLike): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetcher(url, REQUEST);
  } catch {
    if (isOffline()) throw new CatalogError('offline', 'You seem to be offline. Connect to the internet and try again.');
    throw new CatalogError('unreachable', `The ${what} could not be reached. Check the address and your connection, then try again.`);
  }
  if (res.status === 404) throw new CatalogError('not-found', `No ${what} was found at this address.`);
  if (!res.ok) throw new CatalogError('unreachable', `The ${what} could not be loaded right now (error ${res.status}). Try again later.`);
  return readCapped(res, max);
}

/** Makes an address absolute against the page, so relative lesson links resolve the same everywhere. */
export function absoluteUrl(url: string, base: string = typeof location !== 'undefined' ? location.href : 'http://localhost/'): string | null {
  return resolveLessonUrl(url.trim(), base);
}

/**
 * The catalog address to use, from settings.catalogUrl ('' or an address
 * that cannot work means the list that comes with the app).
 */
export function catalogUrlFrom(settings: { catalogUrl: string }): string {
  const saved = settings.catalogUrl.trim();
  return saved && saved.length <= 2000 && absoluteUrl(saved) ? saved : DEFAULT_CATALOG_URL;
}

/**
 * Checks an address typed by the player before it goes into
 * settings.catalogUrl. Returns the value to store ('' for the built-in list),
 * or null when the address cannot work.
 */
export function cleanCatalogUrl(input: string): string | null {
  const url = input.trim();
  if (url === '') return '';
  if (url.length > 2000 || /[\s<>"]/.test(url) || !absoluteUrl(url)) return null;
  return url;
}

/** Downloads and checks the catalog index. Bad entries are left out and listed in `problems`. */
export async function fetchCatalog(url: string = DEFAULT_CATALOG_URL, fetcher: FetchLike = defaultFetch): Promise<ParsedCatalog & { url: string }> {
  const absolute = absoluteUrl(url);
  if (!absolute) throw new CatalogError('invalid', 'That address does not look like a web address.');
  const text = await download(absolute, MAX_CATALOG_BYTES, 'list of shared songs', fetcher);
  try {
    return { ...parseCatalog(text), url: absolute };
  } catch (error) {
    throw new CatalogError('invalid', error instanceof Error ? error.message : 'This is not a list of shared songs.');
  }
}

/** The library id a catalog entry gets. */
export const communityId = (entry: Pick<CatalogEntry, 'id'>) => `community:${entry.id}`;

/**
 * Downloads one entry's lesson file, checks it against what the catalog
 * promises (size, checksum, notes) and returns it as a community song ready
 * for `library.add`.
 */
export async function fetchCatalogSong(entry: CatalogEntry, indexUrl: string = DEFAULT_CATALOG_URL, fetcher: FetchLike = defaultFetch): Promise<Song> {
  const base = absoluteUrl(indexUrl);
  const url = base && resolveLessonUrl(entry.url, base);
  if (!url) throw new CatalogError('invalid', `The address of "${entry.title}" is not valid.`);
  const text = await download(url, Math.min(MAX_LESSON_BYTES, entry.bytes + 1024), 'lesson', fetcher);
  let song: Song;
  try {
    song = checkLesson(text, entry);
  } catch (error) {
    throw new CatalogError('invalid', error instanceof Error ? error.message : 'This lesson file is damaged.');
  }
  return {
    ...song,
    id: communityId(entry),
    source: 'community',
    title: entry.title,
    by: entry.artist,
    difficulty: entry.difficulty,
    tags: song.tags ?? entry.tags,
    licence: entry.licence,
    credit: song.credit ?? entry.credit ?? `Lesson by ${entry.arranger}`,
    ...(song.recording ?? entry.recording ? { recording: song.recording ?? entry.recording } : {}),
  };
}

/** Downloads a lesson from a link someone shared. Its id comes from its checksum, so adding it twice replaces it. */
export async function fetchLessonFromLink(link: string, fetcher: FetchLike = defaultFetch): Promise<Song> {
  const url = absoluteUrl(link);
  if (!url) throw new CatalogError('invalid', 'That does not look like a web address. It should start with https://');
  const text = await download(url, MAX_LESSON_BYTES, 'lesson', fetcher);
  let song: Song;
  try {
    song = checkLesson(text);
  } catch (error) {
    throw new CatalogError('invalid', error instanceof Error ? error.message : 'This lesson file is damaged.');
  }
  return { ...song, id: `community:link-${sha256(text).slice(0, 16)}`, source: 'community' };
}

/**
 * Adds a downloaded song to the library. When it is already there, the new
 * notes replace the old ones but the recording the player attached is kept.
 */
export async function addToLibrary(library: Pick<Library, 'get' | 'add'>, song: Song): Promise<Song> {
  const existing = library.get(song.id);
  return library.add(existing?.audioUrl ? { ...song, audioUrl: existing.audioUrl, ...(existing.backingUrl ? { backingUrl: existing.backingUrl } : {}) } : song);
}

/** Downloads a catalog entry and adds it to the library in one go. */
export async function installEntry(
  library: Pick<Library, 'get' | 'add'>,
  entry: CatalogEntry,
  indexUrl: string = DEFAULT_CATALOG_URL,
  fetcher: FetchLike = defaultFetch,
): Promise<Song> {
  return addToLibrary(library, await fetchCatalogSong(entry, indexUrl, fetcher));
}
