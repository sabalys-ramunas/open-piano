import type { LazySong } from '../app/library';
import { fromLesson } from '../lesson';
import { seq, sortNotes, type Difficulty, type Note, type Song } from '../song';

function build(id: string, title: string, by: string, difficulty: Difficulty, bpm: number, tags: string[], parts: Note[][]): Song {
  return {
    id,
    title,
    by,
    notes: sortNotes(parts.flat()),
    source: 'built-in',
    difficulty,
    bpm,
    tags,
    licence: 'Public domain',
    credit: 'Arranged for this app by the Piano contributors.',
  };
}

/** Songs that ship inside the app bundle. Ids are stable: progress is stored against them. */
export const BUILT_IN: Song[] = [
  build('twinkle', 'Twinkle, Twinkle, Little Star', 'Traditional', 1, 120, ['children'], [
    seq(
      'right',
      0.5,
      `C4/1 C4/1 G4/1 G4/1 A4/1 A4/1 G4/2 F4/1 F4/1 E4/1 E4/1 D4/1 D4/1 C4/2
       G4/1 G4/1 F4/1 F4/1 E4/1 E4/1 D4/2 G4/1 G4/1 F4/1 F4/1 E4/1 E4/1 D4/2
       C4/1 C4/1 G4/1 G4/1 A4/1 A4/1 G4/2 F4/1 F4/1 E4/1 E4/1 D4/1 D4/1 C4/2`,
    ),
    seq(
      'left',
      0.5,
      `C3/4 F3/2 C3/2 F3/2 C3/2 G2/2 C3/2
       C3/2 F3/2 C3/2 G2/2 C3/2 F3/2 C3/2 G2/2
       C3/4 F3/2 C3/2 F3/2 C3/2 G2/2 C3/2`,
    ),
  ]),
  build('ode', 'Ode to Joy', 'Ludwig van Beethoven', 2, 120, ['classical'], [
    seq(
      'right',
      0.25,
      `E4/2 E4/2 F4/2 G4/2 G4/2 F4/2 E4/2 D4/2 C4/2 C4/2 D4/2 E4/2 E4/3 D4/1 D4/4
       E4/2 E4/2 F4/2 G4/2 G4/2 F4/2 E4/2 D4/2 C4/2 C4/2 D4/2 E4/2 D4/3 C4/1 C4/4`,
    ),
    seq(
      'left',
      0.25,
      `C3/8 G2/8 C3/8 G2/8
       C3/8 G2/8 C3/8 G2/4 C3/4`,
    ),
  ]),
  build('elise', 'Für Elise (opening)', 'Ludwig van Beethoven', 3, 100, ['classical'], [
    seq(
      'right',
      0.2,
      `E5/1 D#5/1
       E5/1 D#5/1 E5/1 B4/1 D5/1 C5/1
       A4/2 _/1 C4/1 E4/1 A4/1
       B4/2 _/1 E4/1 G#4/1 B4/1
       C5/2 _/1 E4/1 E5/1 D#5/1
       E5/1 D#5/1 E5/1 B4/1 D5/1 C5/1
       A4/2 _/1 C4/1 E4/1 A4/1
       B4/2 _/1 E4/1 C5/1 B4/1
       A4/4`,
    ),
    seq(
      'left',
      0.2,
      `_/8
       A2/1 E3/1 A3/1 _/3
       E2/1 E3/1 G#3/1 _/3
       A2/1 E3/1 A3/1 _/3
       _/6
       A2/1 E3/1 A3/1 _/3
       E2/1 E3/1 G#3/1 _/3
       A2/1 E3/1 A3/2`,
    ),
  ]),
];

/** One line of the optional `details` list in public/songs/index.json, so lists can show songs before loading them. */
export interface SongPackDetails {
  file: string;
  title: string;
  by: string;
  difficulty?: Difficulty;
  tags?: string[];
  /** Length in seconds. */
  seconds?: number;
  notes?: number;
  licence?: string;
}

/**
 * The shape of public/songs/index.json. Each entry of `songs` is a lesson file
 * name in the same folder; `details` is extra information written by
 * scripts/build-songs.mjs and may be missing.
 */
export interface SongPackIndex {
  songs: string[];
  details?: SongPackDetails[];
}

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/;
const MAX_FILE_BYTES = 2_000_000;

type Fetcher = (url: string) => Promise<Pick<Response, 'ok' | 'json' | 'text'>>;

const packId = (file: string) => `pack:${file.replace(/\.json$/, '')}`;

function safeFiles(listed: unknown): string[] {
  if (!Array.isArray(listed)) return [];
  return [...new Set(listed.slice(0, 500))].filter(
    (file): file is string => typeof file === 'string' && SAFE_FILE.test(file) && !file.includes('..'),
  );
}

/** Fetches and reads one song pack file. Throws when it is missing or broken. */
async function fetchPackSong(fetcher: Fetcher, base: string, file: string): Promise<Song> {
  const res = await fetcher(`${base}songs/${file}`);
  if (!res.ok) throw new Error(`${file} is missing`);
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) throw new Error(`${file} is too big`);
  return { ...fromLesson(text), id: packId(file), source: 'built-in' };
}

const shortText = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

/** Reads one `details` line, or null when it is not usable. Index data is treated as untrusted. */
function readDetails(value: unknown): SongPackDetails | null {
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;
  if (!shortText(d.file, 130) || !SAFE_FILE.test(d.file) || !shortText(d.title, 200) || typeof d.by !== 'string' || d.by.length > 200) return null;
  const out: SongPackDetails = { file: d.file, title: d.title, by: d.by };
  if (typeof d.difficulty === 'number' && Number.isInteger(d.difficulty) && d.difficulty >= 1 && d.difficulty <= 5) out.difficulty = d.difficulty as Difficulty;
  if (Array.isArray(d.tags)) out.tags = d.tags.filter((t): t is string => shortText(t, 40)).slice(0, 20);
  if (typeof d.seconds === 'number' && Number.isFinite(d.seconds) && d.seconds >= 0) out.seconds = d.seconds;
  if (typeof d.notes === 'number' && Number.isInteger(d.notes) && d.notes >= 0) out.notes = d.notes;
  if (shortText(d.licence, 300)) out.licence = d.licence;
  return out;
}

/**
 * Reads public/songs/index.json and returns the song pack as lazy entries
 * (summary now, notes fetched on demand), so start-up fetches one small file
 * instead of every song. Songs the index lists without details are fetched
 * right away and returned in `songs`. Returns empty lists when the index is
 * missing (offline on a first visit).
 */
export async function loadSongPackIndex(
  fetcher: Fetcher = (url) => fetch(url),
  base: string = import.meta.env.BASE_URL,
): Promise<{ lazy: LazySong[]; songs: Song[] }> {
  let index: unknown;
  try {
    const res = await fetcher(`${base}songs/index.json`);
    if (!res.ok) return { lazy: [], songs: [] };
    index = await res.json();
  } catch {
    return { lazy: [], songs: [] };
  }
  const data = index as Partial<SongPackIndex> | null;
  const files = safeFiles(data?.songs);
  const details = new Map<string, SongPackDetails>();
  if (Array.isArray(data?.details)) {
    for (const raw of data.details.slice(0, 500)) {
      const d = readDetails(raw);
      if (d) details.set(d.file, d);
    }
  }
  const lazy: LazySong[] = [];
  const eager: string[] = [];
  for (const file of files) {
    const d = details.get(file);
    if (!d) {
      eager.push(file);
      continue;
    }
    lazy.push({
      summary: { id: packId(file), title: d.title, by: d.by, difficulty: d.difficulty, tags: d.tags ?? [], seconds: d.seconds, noteCount: d.notes, licence: d.licence },
      load: () => fetchPackSong(fetcher, base, file),
    });
  }
  const songs = eager.length ? await fetchMany(fetcher, base, eager) : [];
  return { lazy, songs };
}

async function fetchMany(fetcher: Fetcher, base: string, files: string[]): Promise<Song[]> {
  const songs: (Song | null)[] = new Array(files.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      try {
        songs[i] = await fetchPackSong(fetcher, base, files[i]);
      } catch {
        // skip this one
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
  return songs.filter((s): s is Song => s !== null);
}

/**
 * Loads the extra built-in songs listed in public/songs/index.json. Missing or
 * broken files are skipped, so one bad song never breaks the library.
 * Song ids are `pack:<file name without .json>`. Files are fetched a few at a
 * time and the songs come back in the order the index lists them.
 */
export async function loadSongPack(
  fetcher: Fetcher = (url) => fetch(url),
  base: string = import.meta.env.BASE_URL,
): Promise<Song[]> {
  let index: unknown;
  try {
    const res = await fetcher(`${base}songs/index.json`);
    if (!res.ok) return [];
    index = await res.json();
  } catch {
    return [];
  }
  return fetchMany(fetcher, base, safeFiles((index as Partial<SongPackIndex> | null)?.songs));
}
