import { fromLesson } from '../lesson';
import { songLength, type Difficulty, type Song } from '../song';
import { sha256, utf8Bytes } from './sha256';

/**
 * The community catalog: one index file listing shared lessons, each lesson in
 * its own file next to it. Everything here comes from strangers, so every
 * field is checked and anything odd is refused. Used by the app and by the
 * maintainers' check script (community/tools/validate.mjs).
 */

/** One shared lesson in the catalog. */
export interface CatalogEntry {
  /** Stable id: lowercase letters, digits and dashes. The song becomes `community:<id>` in the library. */
  id: string;
  title: string;
  /** Who wrote or performed the original music. */
  artist: string;
  /** Who made this lesson. */
  arranger: string;
  difficulty: Difficulty;
  tags: string[];
  /** Length in seconds. */
  seconds: number;
  /** Number of notes in the lesson file. */
  notes: number;
  /** The recording the lesson was timed against. Never included: players add their own copy. */
  recording?: { name: string; bytes: number };
  /** Licence of the lesson (the arrangement), e.g. "CC BY 4.0". */
  licence: string;
  /** Optional longer credit line. */
  credit?: string;
  /** Lesson file address, relative to the catalog index or absolute https. */
  url: string;
  /** SHA-256 of the lesson file, lowercase hex. */
  sha256: string;
  /** Size of the lesson file in bytes. */
  bytes: number;
  /** Date the lesson was added, YYYY-MM-DD. */
  added?: string;
}

/** The catalog index file. */
export interface CatalogIndex {
  format: 'piano-catalog';
  version: 1;
  name?: string;
  /** Date of the last change, YYYY-MM-DD. */
  updated?: string;
  lessons: CatalogEntry[];
}

export const MAX_CATALOG_BYTES = 2_000_000;
export const MAX_LESSON_BYTES = 1_500_000;
export const MAX_ENTRIES = 5000;

const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const TAG = /^[a-z0-9][a-z0-9 '-]{0,29}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Control characters and bidirectional overrides have no place in titles. */
const BAD_TEXT = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function text(value: unknown, field: string, max: number, problems: string[], required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || BAD_TEXT.test(value)) {
    problems.push(`${field} must be text of 1 to ${max} characters`);
    return undefined;
  }
  return value.trim();
}

function int(value: unknown, field: string, lo: number, hi: number, problems: string[]): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < lo || value > hi) {
    problems.push(`${field} must be a whole number from ${lo} to ${hi}`);
    return undefined;
  }
  return value;
}

/**
 * Resolves a lesson address against the catalog address. Only http(s)
 * addresses without a user name or password are allowed.
 */
export function resolveLessonUrl(url: string, base: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(url, base);
  } catch {
    return null;
  }
  if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null;
  if (resolved.username || resolved.password) return null;
  return resolved.href;
}

/** Checks one entry. Returns it cleaned, or null with the reasons added to `problems`. */
export function checkEntry(raw: unknown, problems: string[]): CatalogEntry | null {
  const local: string[] = [];
  if (!isObj(raw)) {
    problems.push('an entry is not an object');
    return null;
  }
  const label = typeof raw.id === 'string' ? `"${raw.id.slice(0, 64)}"` : 'an entry';
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : (local.push('id must use a to z, 0 to 9 and dashes (up to 64)'), undefined);
  const title = text(raw.title, 'title', 120, local);
  const artist = text(raw.artist, 'artist', 120, local);
  const arranger = text(raw.arranger, 'arranger', 120, local);
  const difficulty = int(raw.difficulty, 'difficulty', 1, 5, local) as Difficulty | undefined;
  let tags: string[] = [];
  if (!Array.isArray(raw.tags) || raw.tags.length > 10 || !raw.tags.every((t) => typeof t === 'string' && TAG.test(t))) {
    local.push('tags must be a list of up to 10 short lowercase words');
  } else {
    tags = [...new Set(raw.tags as string[])];
  }
  const seconds = int(raw.seconds, 'seconds', 1, 7200, local);
  const notes = int(raw.notes, 'notes', 1, 50_000, local);
  let recording: CatalogEntry['recording'];
  if (raw.recording !== undefined) {
    const r = raw.recording;
    const name = isObj(r) ? text(r.name, 'recording.name', 200, local) : undefined;
    const bytes = isObj(r) ? int(r.bytes, 'recording.bytes', 1, 2_000_000_000, local) : undefined;
    if (!isObj(r)) local.push('recording must have a name and a size in bytes');
    if (name !== undefined && bytes !== undefined) recording = { name, bytes };
  }
  const licence = text(raw.licence, 'licence', 200, local);
  const credit = text(raw.credit, 'credit', 500, local, false);
  const url = text(raw.url, 'url', 2000, local);
  if (url !== undefined && resolveLessonUrl(url, 'https://example.invalid/catalog/') === null) local.push('url must be a relative path or an http(s) address');
  const hash = typeof raw.sha256 === 'string' && HEX64.test(raw.sha256) ? raw.sha256 : (local.push('sha256 must be 64 lowercase hex characters'), undefined);
  const bytes = int(raw.bytes, 'bytes', 1, MAX_LESSON_BYTES, local);
  const added = raw.added === undefined ? undefined : typeof raw.added === 'string' && DATE.test(raw.added) ? raw.added : (local.push('added must be a date like 2026-01-31'), undefined);

  if (local.length > 0) {
    problems.push(...local.map((p) => `${label}: ${p}`));
    return null;
  }
  return {
    id: id!,
    title: title!,
    artist: artist!,
    arranger: arranger!,
    difficulty: difficulty!,
    tags,
    seconds: seconds!,
    notes: notes!,
    ...(recording ? { recording } : {}),
    licence: licence!,
    ...(credit ? { credit } : {}),
    url: url!,
    sha256: hash!,
    bytes: bytes!,
    ...(added ? { added } : {}),
  };
}

export interface ParsedCatalog {
  catalog: CatalogIndex;
  /** Reasons entries were left out. Empty for a clean catalog. */
  problems: string[];
}

/**
 * Reads a catalog index. A file that is not a catalog at all throws a friendly
 * Error; bad entries are left out and listed in `problems`, so one broken
 * entry never hides the rest.
 */
export function parseCatalog(input: string): ParsedCatalog {
  if (input.length > MAX_CATALOG_BYTES) throw new Error('This list of shared songs is too big to open.');
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    throw new Error('This is not a list of shared songs.');
  }
  if (!isObj(data) || data.format !== 'piano-catalog' || !Array.isArray(data.lessons)) throw new Error('This is not a list of shared songs.');
  if (data.version !== 1) throw new Error('This list of shared songs needs a newer version of the app.');
  const problems: string[] = [];
  if (data.lessons.length > MAX_ENTRIES) problems.push(`only the first ${MAX_ENTRIES} lessons are read`);
  const seen = new Set<string>();
  const lessons: CatalogEntry[] = [];
  for (const raw of data.lessons.slice(0, MAX_ENTRIES)) {
    const entry = checkEntry(raw, problems);
    if (!entry) continue;
    if (seen.has(entry.id)) {
      problems.push(`"${entry.id}": the same id is listed twice`);
      continue;
    }
    seen.add(entry.id);
    lessons.push(entry);
  }
  const name = typeof data.name === 'string' && data.name.length <= 120 && !BAD_TEXT.test(data.name) ? data.name : undefined;
  const updated = typeof data.updated === 'string' && DATE.test(data.updated) ? data.updated : undefined;
  return { catalog: { format: 'piano-catalog', version: 1, ...(name ? { name } : {}), ...(updated ? { updated } : {}), lessons }, problems };
}

/** Keys a lesson file may have. Anything else (audio, lyrics, scripts...) gets the file refused. */
const LESSON_KEYS = new Set([
  'format', 'version', 'title', 'by', 'recording', 'notes', 'difficulty', 'bpm', 'beats', 'timeSignature', 'chords', 'tags', 'licence', 'credit',
]);

/**
 * Strict check of a downloaded lesson file, on top of the app's own lesson
 * reader: size cap, only known fields, real text in title and artist, and,
 * when `entry` is given, the size, checksum and note count it promises.
 * Throws an Error with a message a player can understand.
 */
export function checkLesson(input: string, entry?: Pick<CatalogEntry, 'bytes' | 'sha256' | 'notes' | 'seconds'>): Song {
  const bytes = utf8Bytes(input);
  if (bytes > MAX_LESSON_BYTES) throw new Error('This lesson file is too big.');
  if (entry) {
    if (bytes !== entry.bytes) throw new Error('This lesson file is not the one the list describes (its size is different).');
    if (sha256(input) !== entry.sha256) throw new Error('This lesson file is not the one the list describes (it has been changed).');
  }
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    throw new Error('This is not a lesson file.');
  }
  if (!isObj(data)) throw new Error('This is not a lesson file.');
  const extra = Object.keys(data).filter((k) => !LESSON_KEYS.has(k));
  if (extra.length > 0) throw new Error('This lesson file has extra content that lessons may not contain.');
  const titleProblems: string[] = [];
  text(data.title, 'title', 120, titleProblems);
  if (data.by !== undefined) text(data.by, 'by', 120, titleProblems);
  if (titleProblems.length > 0) throw new Error('This lesson file has a broken title.');
  const song = fromLesson(input);
  if (entry) {
    if (song.notes.length !== entry.notes) throw new Error('This lesson file is not the one the list describes (the notes are different).');
    if (Math.abs(songLength(song) - entry.seconds) > 2) throw new Error('This lesson file is not the one the list describes (its length is different).');
  }
  return song;
}

/** Builds the catalog entry that describes a lesson file (used by contributors' tools and tests). */
export function describeLesson(
  input: string,
  fields: Pick<CatalogEntry, 'id' | 'url' | 'arranger'> & Partial<Pick<CatalogEntry, 'artist' | 'tags' | 'added' | 'credit'>>,
): CatalogEntry {
  const song = checkLesson(input);
  if (!song.licence) throw new Error('The lesson needs a licence.');
  return {
    id: fields.id,
    title: song.title,
    artist: fields.artist ?? song.by,
    arranger: fields.arranger,
    difficulty: song.difficulty ?? 1,
    tags: fields.tags ?? song.tags ?? [],
    seconds: Math.max(1, Math.round(songLength(song))),
    notes: song.notes.length,
    ...(song.recording ? { recording: song.recording } : {}),
    licence: song.licence,
    ...(fields.credit ?? song.credit ? { credit: fields.credit ?? song.credit } : {}),
    url: fields.url,
    sha256: sha256(input),
    bytes: utf8Bytes(input),
    ...(fields.added ? { added: fields.added } : {}),
  };
}
