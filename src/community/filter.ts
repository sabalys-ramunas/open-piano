import type { CatalogEntry } from './validate';

export type SortOrder = 'title' | 'easiest' | 'hardest' | 'shortest' | 'newest';

export const SORT_LABELS: Record<SortOrder, string> = {
  title: 'Title (A to Z)',
  easiest: 'Easiest first',
  hardest: 'Hardest first',
  shortest: 'Shortest first',
  newest: 'Newest first',
};

export interface LessonFilter {
  /** Words to look for in the title, artist, arranger and tags. */
  query?: string;
  /** Only this difficulty (1 to 5). */
  difficulty?: number;
  /** Only lessons with this tag. */
  tag?: string;
  sort?: SortOrder;
}

/** Lowercase, without accents, so "fur elise" finds "Für Elise". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every tag used in the catalog, most common first, then A to Z. */
export function allTags(lessons: readonly CatalogEntry[]): string[] {
  const count = new Map<string, number>();
  for (const l of lessons) for (const t of l.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Lessons that match the filter, in the chosen order. Every word of the query must match somewhere. */
export function filterLessons(lessons: readonly CatalogEntry[], filter: LessonFilter = {}): CatalogEntry[] {
  const words = fold(filter.query ?? '').split(/\s+/).filter(Boolean);
  const out = lessons.filter((l) => {
    if (filter.difficulty && l.difficulty !== filter.difficulty) return false;
    if (filter.tag && !l.tags.includes(filter.tag)) return false;
    if (words.length === 0) return true;
    const haystack = fold([l.title, l.artist, l.arranger, ...l.tags].join(' '));
    return words.every((w) => haystack.includes(w));
  });
  const byTitle = (a: CatalogEntry, b: CatalogEntry) => a.title.localeCompare(b.title);
  const compare: Record<SortOrder, (a: CatalogEntry, b: CatalogEntry) => number> = {
    title: byTitle,
    easiest: (a, b) => a.difficulty - b.difficulty || byTitle(a, b),
    hardest: (a, b) => b.difficulty - a.difficulty || byTitle(a, b),
    shortest: (a, b) => a.seconds - b.seconds || byTitle(a, b),
    newest: (a, b) => (b.added ?? '').localeCompare(a.added ?? '') || byTitle(a, b),
  };
  return out.sort(compare[filter.sort ?? 'title']);
}

/** "1:05" for 65 seconds. */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "4.2 MB" for a recording size. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${bytes} bytes`;
}

/**
 * A licence in plain words for the song sheet: what you may do with the
 * lesson. Unknown licences are shown as they are.
 */
export function licenceWords(licence: string): string {
  const l = licence.trim().toLowerCase();
  if (l === '') return 'Ask the maker before sharing it';
  if (l.includes('public domain') || /^cc0\b/.test(l)) return 'Free for everyone, no strings';
  if (/\bby-sa\b/.test(l)) return 'Free to share. Credit the maker and keep the same licence';
  if (/\bby-nc\b/.test(l)) return 'Free to share, not to sell. Credit the maker';
  if (/\bby-nd\b/.test(l)) return 'Free to share unchanged. Credit the maker';
  if (/\bcc\s*by\b/.test(l)) return 'Free to share. Just credit the maker';
  return licence.trim();
}
