import type { SongSummary } from '../app/library';
import type { SongProgress } from '../app/store';
import { DIFFICULTY_WORD, SOURCE_LABEL } from '../app/words';
import type { Difficulty } from '../song';

/** How the song list can be ordered. */
export type SortKey = 'suggested' | 'title' | 'level' | 'length' | 'added' | 'played';

export const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'title', label: 'Title (A to Z)' },
  { key: 'level', label: 'Easiest first' },
  { key: 'length', label: 'Shortest first' },
  { key: 'added', label: 'Recently added' },
  { key: 'played', label: 'Recently played' },
];

/** What the person typed and picked above the list. */
export interface LibraryQuery {
  search: string;
  /** 0 means every level. */
  level: Difficulty | 0;
  /** '' means every tag. */
  tag: string;
  sort: SortKey;
}

export const EMPTY_QUERY: LibraryQuery = { search: '', level: 0, tag: '', sort: 'suggested' };

export interface LibrarySection {
  id: string;
  title: string;
  songs: SongSummary[];
}

/** Lower case without accents, so "fur elise" finds "Für Elise". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** True when every word of the search appears in the title, composer or tags. */
export function matchesSearch(song: SongSummary, search: string): boolean {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(`${song.title} ${song.by} ${song.tags.join(' ')}`);
  return words.every((w) => hay.includes(w));
}

export function filterSongs(songs: readonly SongSummary[], query: LibraryQuery): SongSummary[] {
  return songs.filter(
    (s) =>
      (query.level === 0 || s.difficulty === query.level) &&
      (query.tag === '' || s.tags.includes(query.tag)) &&
      matchesSearch(s, query.search),
  );
}

/** A stable sort: songs that tie keep their library order. */
export function sortSongs(songs: readonly SongSummary[], sort: SortKey, progress: ReadonlyMap<string, SongProgress>): SongSummary[] {
  const indexed = songs.map((song, i) => ({ song, i }));
  const by = (key: (s: SongSummary) => number | string) => (a: { song: SongSummary; i: number }, b: { song: SongSummary; i: number }) => {
    const ka = key(a.song);
    const kb = key(b.song);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a.i - b.i;
  };
  switch (sort) {
    case 'title':
      indexed.sort(by((s) => fold(s.title)));
      break;
    case 'level':
      indexed.sort(by((s) => s.difficulty ?? 6));
      break;
    case 'length':
      indexed.sort(by((s) => s.seconds ?? Number.MAX_SAFE_INTEGER));
      break;
    case 'added':
      indexed.sort(by((s) => -(s.addedAt ?? 0)));
      break;
    case 'played':
      indexed.sort(by((s) => -(progress.get(s.id)?.lastPlayed ?? 0)));
      break;
    case 'suggested':
      break;
  }
  return indexed.map((x) => x.song);
}

/**
 * Splits the (already filtered and sorted) songs into sections: My songs,
 * Shared songs, then the songs that come with the app. With the suggested
 * order and no search, the built-in songs are grouped by level.
 */
export function buildSections(songs: readonly SongSummary[], query: LibraryQuery): LibrarySection[] {
  const sections: LibrarySection[] = [];
  const mine = songs.filter((s) => s.source === 'mine');
  const shared = songs.filter((s) => s.source === 'community');
  const builtIn = songs.filter((s) => s.source === 'built-in');
  if (mine.length) sections.push({ id: 'mine', title: SOURCE_LABEL.mine, songs: mine });
  if (shared.length) sections.push({ id: 'community', title: SOURCE_LABEL.community, songs: shared });
  const grouped = query.sort === 'suggested' && query.search.trim() === '' && query.level === 0;
  if (!grouped) {
    if (builtIn.length) sections.push({ id: 'built-in', title: 'Songs that come with the app', songs: builtIn });
    return sections;
  }
  for (const d of [1, 2, 3, 4, 5] as Difficulty[]) {
    const level = builtIn.filter((s) => s.difficulty === d);
    if (level.length) sections.push({ id: `level-${d}`, title: `Level ${d} · ${DIFFICULTY_WORD[d]}`, songs: level });
  }
  const rest = builtIn.filter((s) => s.difficulty === undefined);
  if (rest.length) sections.push({ id: 'more', title: 'More songs', songs: rest });
  return sections;
}

/** Filter, sort and group in one go. */
export function librarySections(songs: readonly SongSummary[], query: LibraryQuery, progress: ReadonlyMap<string, SongProgress>): LibrarySection[] {
  return buildSections(sortSongs(filterSongs(songs, query), query.sort, progress), query);
}

/** Tags worth offering as a filter: used by at least two songs, most used first. */
export function popularTags(songs: readonly SongSummary[], limit = 12): string[] {
  const count = new Map<string, number>();
  for (const s of songs) for (const t of new Set(s.tags)) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

/** The most recently played song that is still in the library. */
export function lastPlayed(progress: Iterable<SongProgress>, known: (id: string) => boolean): SongProgress | undefined {
  let best: SongProgress | undefined;
  for (const p of progress) {
    if (!known(p.songId) || p.lastPlayed <= 0) continue;
    if (!best || p.lastPlayed > best.lastPlayed) best = p;
  }
  return best;
}

/** Words for the result count, read out to screen readers after a search. */
export function countText(shown: number, total: number): string {
  if (shown === total) return `${total} ${total === 1 ? 'song' : 'songs'}`;
  if (shown === 0) return 'No songs match';
  return `${shown} of ${total} songs`;
}

/** A file name for a lesson file made from a song title. */
export function lessonFileName(title: string): string {
  return `${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'lesson'}.lesson.json`;
}

/** The stored streak only counts while the last practice was today or yesterday (same rule as the course map). */
export function liveStreakDays(streak: { current: number; lastDay: string } | null, now = new Date()): number {
  if (!streak) return 0;
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return streak.lastDay === day(now) || streak.lastDay === day(yesterday) ? streak.current : 0;
}

/** True when a drag carries files (not text or a link being dragged around the page). */
export function dragHasFiles(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    const t = 'item' in types ? (types as DOMStringList).item(i) : (types as readonly string[])[i];
    if (t === 'Files') return true;
  }
  return false;
}

// ---------- The home screen's rows ("shelves") and its one best next thing ----------

export interface HomeShelf {
  id: string;
  title: string;
  songs: SongSummary[];
}

/** Style collections, in the order they appear. A song can sit in more than one. */
export const STYLE_SHELVES: readonly { id: string; title: string; tags: readonly string[] }[] = [
  { id: 'children', title: 'Songs for children', tags: ['children', 'lullaby'] },
  { id: 'classical', title: 'Classical', tags: ['classical'] },
  { id: 'holiday', title: 'Holidays', tags: ['holiday'] },
  { id: 'folk', title: 'Folk songs and hymns', tags: ['folk', 'hymn'] },
  { id: 'dance', title: 'Dances and marches', tags: ['dance', 'march', 'ragtime'] },
];

/**
 * The rows of the home screen: My songs (newest first), songs added from the
 * shared library, "Start here" (level 1), then one row per style, easiest
 * first, and the songs no style row holds. Empty rows are left out.
 */
export function homeShelves(songs: readonly SongSummary[]): HomeShelf[] {
  const out: HomeShelf[] = [];
  const easiestFirst = (list: SongSummary[]) => sortSongs(list, 'level', new Map());
  const mine = songs.filter((s) => s.source === 'mine').sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  const shared = songs.filter((s) => s.source === 'community');
  const builtIn = songs.filter((s) => s.source === 'built-in');
  if (mine.length) out.push({ id: 'mine', title: 'My songs', songs: mine });
  if (shared.length) out.push({ id: 'from-shared', title: 'From shared songs', songs: shared });
  const first = builtIn.filter((s) => s.difficulty === 1);
  if (first.length) out.push({ id: 'start', title: 'Start here', songs: first });
  const placed = new Set<string>();
  for (const style of STYLE_SHELVES) {
    const list = builtIn.filter((s) => s.tags.some((t) => style.tags.includes(t)));
    for (const s of list) placed.add(s.id);
    if (list.length) out.push({ id: style.id, title: style.title, songs: easiestFirst(list) });
  }
  const rest = builtIn.filter((s) => !placed.has(s.id) && s.difficulty !== 1);
  if (rest.length) out.push({ id: 'more', title: 'More songs', songs: easiestFirst(rest) });
  return out;
}

/** A warm hello for the time of day. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning!';
  if (hour >= 12 && hour < 18) return 'Good afternoon!';
  return 'Good evening!';
}

export interface CourseSummary {
  done: number;
  total: number;
  next?: { id: string; title: string; number: number; unit: number };
  /** When the last lesson was finished (ms), 0 if never. */
  lastLessonAt: number;
}

/** The single best next thing for the big card at the top of home. */
export type NextThing =
  | { kind: 'first-lesson'; lessonId: string; title: string; number: number; unit: number }
  | { kind: 'lesson'; lessonId: string; title: string; number: number; unit: number; done: number; total: number }
  | { kind: 'song'; songId: string; stars: number; best: number }
  | { kind: 'first-song'; songId: string };

/**
 * First visit: the first lesson. Returning: whichever they did last, the next
 * lesson or the last song. Course finished and nothing played: an easy song.
 */
export function bestNext(course: CourseSummary | null, last: SongProgress | undefined, firstSongId: string | undefined): NextThing | null {
  const next = course?.next;
  if (next && course && course.done === 0 && !last) {
    return { kind: 'first-lesson', lessonId: next.id, title: next.title, number: next.number, unit: next.unit };
  }
  if (next && course && course.done > 0 && (!last || course.lastLessonAt >= last.lastPlayed)) {
    return { kind: 'lesson', lessonId: next.id, title: next.title, number: next.number, unit: next.unit, done: course.done, total: course.total };
  }
  if (last) return { kind: 'song', songId: last.songId, stars: last.stars, best: last.best };
  if (next && course) return { kind: 'lesson', lessonId: next.id, title: next.title, number: next.number, unit: next.unit, done: course.done, total: course.total };
  return firstSongId ? { kind: 'first-song', songId: firstSongId } : null;
}
