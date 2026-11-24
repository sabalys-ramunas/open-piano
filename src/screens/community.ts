import '../styles/community.css';
import type { AppContext } from '../app/context';
import { download, h, levelBadge, levelDots, link, notice } from '../app/dom';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import { DIFFICULTY_WORD } from '../app/words';
import {
  absoluteUrl,
  addToLibrary,
  CatalogError,
  communityId,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  fetchCatalogSong,
  fetchLessonFromLink,
  catalogUrlFrom,
  type CatalogEntry,
} from '../community/catalog';
import { allTags, filterLessons, formatBytes, formatLength, licenceWords, SORT_LABELS, type LessonFilter, type SortOrder } from '../community/filter';
import { toLesson } from '../lesson';
import type { Difficulty, Song } from '../song';
import { songCover } from '../ui/cover-art';
import { icon } from '../ui/icons';
import { illustration, type IllustrationName } from '../ui/illustrations';
import { mascot } from '../ui/mascot';
import { openSheet, type Sheet } from '../ui/sheet';
import { shelf } from '../ui/shelf';
import { toast } from '../ui/toast';

const PREVIEW_SECONDS = 20;
const PAGE = 48;

const label = (tag: string) => tag.charAt(0).toUpperCase() + tag.slice(1);
const messageOf = (error: unknown, fallback: string) =>
  error instanceof CatalogError || (error instanceof Error && /^(This|That|No |The |You )/.test(error.message)) ? (error as Error).message : fallback;

/** What a catalog entry looks like to the cover art. */
const coverOf = (entry: CatalogEntry) => ({ id: communityId(entry), title: entry.title, by: entry.artist, tags: entry.tags, source: 'community' as const });

/** A row of small numbered pictures for a step-by-step sheet. */
function steps(items: [IllustrationName, string, string][]): HTMLElement {
  return h(
    'ol',
    { class: 'cm-steps' },
    ...items.map(([art, title, text], i) =>
      h(
        'li',
        { class: 'cm-step' },
        h('span', { class: 'cm-step-art' }, illustration(art, 'cm-step-picture'), h('span', { class: 'cm-step-num', 'aria-hidden': 'true' }, String(i + 1))),
        h('strong', {}, title),
        h('span', {}, text),
      ),
    ),
  );
}

/**
 * #/community: lessons shared by other players, as picture cards in rows and a
 * grid. Each card opens a song sheet (add, listen, who made it, the licence in
 * plain words). Search sits behind the search button. "Add from a link" and
 * "Share my lesson" are friendly cards that open short step-by-step sheets.
 */
export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  void route;
  let alive = true;
  let catalogUrl = catalogUrlFrom(ctx.settings.get());
  let lessons: CatalogEntry[] = [];
  let skipped = 0;
  let state: 'loading' | 'ready' | 'error' = 'loading';
  let errorKind: 'offline' | 'other' = 'other';
  let errorMessage = '';
  let shown = PAGE;
  let searching = false;
  const filter: LessonFilter = { query: '', sort: 'title' };
  const downloaded = new Map<string, Song>(); // entry id -> checked song
  const busy = new Set<string>();
  let preview: { id: string; stop: () => void } | null = null;
  let loadToken = 0;
  let sheet: Sheet | null = null;
  let sheetEntry: CatalogEntry | null = null;
  let sheetNote = '';
  /** A sheet control to focus after a redraw, when the one that had focus was disabled while working. */
  let pendingFocus: string | undefined;

  // ---------- Top ----------
  const searchButton = h(
    'button',
    { type: 'button', class: 'icon-button big cm-search-button', 'aria-label': 'Find a shared song', 'aria-expanded': 'false', 'aria-controls': 'cm-find' },
    icon('search'),
  );
  const top = h(
    'header',
    { class: 'cm-top' },
    mascot('happy', 'cm-mascot'),
    h(
      'div',
      { class: 'cm-hello' },
      h('h1', { class: 'cm-title' }, 'Shared songs'),
      h('p', { class: 'cm-sub' }, 'Free lessons from other players. They hold the notes only, so you bring your own recording.'),
    ),
    searchButton,
  );

  // ---------- Browse ----------
  const shelves = h('div', { class: 'cm-shelves', 'aria-live': 'polite', 'aria-busy': 'true' });

  const linkCard = h(
    'section',
    { class: 'bigcard fill-sky cm-way', 'aria-labelledby': 'cm-link-card' },
    illustration('link', 'cm-way-art'),
    h('div', { class: 'cm-way-text' }, h('h2', { id: 'cm-link-card' }, 'Got a link?'), h('p', {}, 'Add a lesson someone sent you.')),
  );
  const linkOpen = h('button', { type: 'button', class: 'primary' }, icon('link'), 'Add from a link');
  linkCard.querySelector('.cm-way-text')?.append(linkOpen);
  const shareCard = h(
    'section',
    { class: 'bigcard fill-coral cm-way', 'aria-labelledby': 'cm-share-card' },
    illustration('share', 'cm-way-art'),
    h('div', { class: 'cm-way-text' }, h('h2', { id: 'cm-share-card' }, 'Made a lesson?'), h('p', {}, 'Share it with everyone.')),
  );
  const shareOpen = h('button', { type: 'button', class: 'primary' }, icon('send'), 'Share my lesson');
  shareCard.querySelector('.cm-way-text')?.append(shareOpen);

  const sourceLine = h('p', {});
  const renderSource = (): void => {
    sourceLine.replaceChildren(
      catalogUrl === DEFAULT_CATALOG_URL ? 'The list that comes with the app. It works offline. ' : `The list at ${absoluteUrl(catalogUrl) ?? catalogUrl}. `,
      link({ screen: 'settings' }, 'Change it in Settings'),
    );
  };
  renderSource();
  const where = h('details', { class: 'cm-where' }, h('summary', {}, 'Where do these come from?'), sourceLine, h('p', {}, 'No account or cookies are sent.'));

  const hero = h('section', { class: 'bigcard fill-sun cm-hero', 'aria-label': 'Try this one' }, h('div', { class: 'skeleton cm-hero-skeleton' }));
  const browse = h('div', { class: 'cm-browse' }, h('div', { class: 'cm-lead' }, hero, h('div', { class: 'cm-ways' }, linkCard, shareCard)), shelves, where);

  // ---------- Search (behind the search button) ----------
  const search = h('input', { type: 'search', id: 'cm-search', placeholder: 'Song, composer or maker', autocomplete: 'off' });
  const levelChips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Level' });
  const styleChips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Style' });
  const sort = h('select', { id: 'cm-sort' }, ...(Object.keys(SORT_LABELS) as SortOrder[]).map((k) => h('option', { value: k }, SORT_LABELS[k])));
  const count = h('p', { class: 'cm-count', role: 'status', 'aria-live': 'polite' });
  const results = h('ul', { class: 'pcard-grid cm-results' });
  const more = h('button', { type: 'button', class: 'cm-more', hidden: true }, 'Show more');
  const closeSearchButton = h('button', { type: 'button', class: 'quiet small' }, icon('close'), 'Close search');
  const find = h(
    'section',
    { class: 'cm-find', id: 'cm-find', 'aria-labelledby': 'cm-find-heading', hidden: true },
    h(
      'form',
      { class: 'card cm-find-bar', role: 'search', 'aria-label': 'Find shared songs' },
      h('div', { class: 'cm-find-head' }, h('h2', { id: 'cm-find-heading' }, 'Find a shared song'), closeSearchButton),
      h('div', { class: 'cm-find-input' }, icon('search'), h('label', { for: 'cm-search', class: 'visually-hidden' }, 'Search shared songs'), search),
      h('div', { class: 'cm-filters' }, h('span', { class: 'label', 'aria-hidden': 'true' }, 'Level'), levelChips),
      h('div', { class: 'cm-filters' }, h('span', { class: 'label', 'aria-hidden': 'true' }, 'Style'), styleChips),
      h('div', { class: 'cm-sort' }, h('label', { for: 'cm-sort', class: 'label' }, 'Order'), sort),
    ),
    count,
    results,
    more,
  );

  container.append(h('div', { class: 'cm' }, top, find, browse));

  // ---------- Cards ----------
  function isAdded(entry: CatalogEntry): boolean {
    return ctx.library.get(communityId(entry)) !== undefined;
  }

  function card(entry: CatalogEntry): HTMLElement {
    const open = h('button', { type: 'button', class: 'pcard-open' }, entry.title);
    open.addEventListener('click', () => openEntry(entry));
    return h(
      'article',
      { class: 'pcard cm-card', 'data-entry': entry.id },
      songCover(coverOf(entry)),
      isAdded(entry) ? h('span', { class: 'pcard-badge badge badge-mint' }, icon('check'), 'Added') : null,
      h(
        'div',
        { class: 'pcard-body' },
        h('h3', { class: 'pcard-title' }, open),
        h('p', { class: 'pcard-by' }, entry.artist),
        h('div', { class: 'pcard-meta' }, levelDots(entry.difficulty), h('span', { class: 'cm-length' }, h('span', { class: 'visually-hidden' }, 'Length '), formatLength(entry.seconds))),
      ),
    );
  }

  function skeletonRow(): HTMLElement {
    const items = Array.from({ length: 5 }, () => h('div', { class: 'skeleton cm-skeleton-card' }));
    return h('div', { class: 'cm-skeleton', 'aria-hidden': 'true' }, h('div', { class: 'skeleton cm-skeleton-title' }), h('div', { class: 'cm-skeleton-row' }, ...items));
  }

  function problemBox(): HTMLElement {
    const retry = h('button', { type: 'button', class: 'primary' }, 'Try again');
    retry.addEventListener('click', () => void load());
    const actions: Node[] = [retry];
    if (catalogUrl !== DEFAULT_CATALOG_URL) {
      const useDefault = h('button', { type: 'button' }, 'Use the built-in list');
      useDefault.addEventListener('click', () => ctx.settings.set({ catalogUrl: '' })); // the settings listener reloads
      actions.push(useDefault);
    }
    const box =
      errorKind === 'offline'
        ? notice('error', 'You are offline', 'Shared songs need the internet. Your own songs still work.', ...actions)
        : notice('error', 'Shared songs did not load', errorMessage, ...actions);
    box.prepend(mascot('curious'));
    box.classList.add('cm-problem');
    return box;
  }

  /** The one lesson the big card suggests: the newest one not added yet, easiest first. */
  function featured(): CatalogEntry | null {
    const fresh = lessons.filter((l) => !isAdded(l));
    const pool = fresh.length ? fresh : lessons;
    return [...pool].sort((a, b) => (b.added ?? '').localeCompare(a.added ?? '') || a.difficulty - b.difficulty || a.title.localeCompare(b.title))[0] ?? null;
  }

  function renderHero(): void {
    if (state === 'loading') {
      hero.hidden = false;
      hero.replaceChildren(h('div', { class: 'skeleton cm-hero-skeleton' }));
      return;
    }
    const entry = state === 'ready' ? featured() : null;
    hero.hidden = !entry;
    if (!entry) return;
    const added = isAdded(entry);
    let main: HTMLElement;
    if (added) {
      main = link({ screen: 'play', songId: communityId(entry) }, 'Play', { class: 'button primary big', 'aria-label': `Play ${entry.title}` });
      main.prepend(icon('play'));
    } else {
      main = h('button', { type: 'button', class: 'primary big', disabled: busy.has(entry.id), 'aria-label': `Add to my songs: ${entry.title}` }, icon('addSong'), 'Add to my songs');
      main.addEventListener('click', () => void install(entry));
    }
    const look = h('button', { type: 'button', class: 'quiet' }, icon('listen'), 'Have a listen');
    look.addEventListener('click', () => {
      openEntry(entry);
      void togglePreview(entry);
    });
    hero.replaceChildren(
      h('div', { class: 'cm-hero-art' }, songCover(coverOf(entry), 'cm-hero-cover')),
      h(
        'div',
        { class: 'cm-hero-text' },
        h('p', { class: 'cm-hero-kicker' }, added ? 'In your songs' : 'Try this one'),
        h('h2', { class: 'cm-hero-title' }, entry.title),
        h('p', { class: 'cm-hero-by' }, entry.artist, ' · ', h('span', { class: 'visually-hidden' }, 'Level '), DIFFICULTY_WORD[entry.difficulty]),
        h('div', { class: 'cm-hero-actions' }, main, look),
      ),
    );
  }

  let lastKey = '';
  function renderBrowse(): void {
    renderHero();
    shelves.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    if (state === 'loading') {
      lastKey = '';
      shelves.replaceChildren(h('p', { class: 'visually-hidden', role: 'status' }, 'Loading shared songs'), skeletonRow(), skeletonRow());
      return;
    }
    if (state === 'error') {
      lastKey = '';
      shelves.replaceChildren(problemBox());
      return;
    }
    if (lessons.length === 0) {
      lastKey = '';
      const empty = notice('empty', 'No shared songs yet', 'Be the first to share one!');
      empty.prepend(mascot('curious'));
      shelves.replaceChildren(empty);
      return;
    }
    // Only redraw when something visible changed, so scroll positions survive.
    const key = `${lessons.map((l) => `${l.id}:${isAdded(l) ? 1 : 0}:${busy.has(l.id) ? 1 : 0}`).join('|')}#${skipped}`;
    if (key === lastKey) return;
    lastKey = key;
    const rows: HTMLElement[] = [];
    const newest = [...lessons].sort((a, b) => (b.added ?? '').localeCompare(a.added ?? '')).slice(0, 12);
    // Rows only help once there are enough songs; a small list is just the grid.
    if (lessons.length >= 12) rows.push(shelf({ id: 'cm-new', title: 'Just added', items: newest.map(card) }));
    for (const tag of lessons.length >= 12 ? allTags(lessons).slice(0, 4) : []) {
      const list = lessons.filter((l) => l.tags.includes(tag));
      if (list.length < 2 || list.length === lessons.length) continue;
      rows.push(shelf({ id: `cm-tag-${tag.replace(/[^a-z0-9-]/gi, '')}`, title: label(tag), count: String(list.length), items: list.map(card) }));
    }
    const all = filterLessons(lessons, { sort: 'title' });
    rows.push(
      h(
        'section',
        { class: 'cm-all', 'aria-labelledby': 'cm-all-heading' },
        h('h2', { id: 'cm-all-heading', class: 'shelf-title' }, 'Every shared song', h('span', { class: 'shelf-count' }, ` ${all.length}`)),
        h('ul', { class: 'pcard-grid' }, ...all.map((l) => h('li', {}, card(l)))),
        skipped > 0 ? h('p', { class: 'cm-skipped' }, `${skipped} broken ${skipped === 1 ? 'entry was' : 'entries were'} left out.`) : null,
      ),
    );
    shelves.replaceChildren(...rows);
  }

  // ---------- Search ----------
  function renderChips(): void {
    const group = (box: HTMLElement, options: { label: string; aria?: string; pressed: boolean; pick: () => void }[]): void => {
      const buttons = options.map((o) => {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.pressed), 'aria-label': o.aria ?? null }, o.label);
        b.addEventListener('click', () => {
          o.pick();
          for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
          shown = PAGE;
          renderResults();
        });
        return b;
      });
      box.replaceChildren(...buttons);
    };
    group(levelChips, [
      { label: 'All', aria: 'All levels', pressed: !filter.difficulty, pick: () => (filter.difficulty = undefined) },
      ...([1, 2, 3, 4, 5] as Difficulty[]).map((d) => ({
        label: `${d} · ${DIFFICULTY_WORD[d]}`,
        aria: `Level ${d} · ${DIFFICULTY_WORD[d]}`,
        pressed: filter.difficulty === d,
        pick: () => (filter.difficulty = d),
      })),
    ]);
    group(styleChips, [
      { label: 'All', aria: 'All styles', pressed: !filter.tag, pick: () => (filter.tag = undefined) },
      ...allTags(lessons)
        .slice(0, 10)
        .map((t) => ({ label: label(t), pressed: filter.tag === t, pick: () => (filter.tag = t) })),
    ]);
  }

  function clearFilters(): void {
    search.value = '';
    sort.value = 'title';
    filter.query = '';
    filter.difficulty = undefined;
    filter.tag = undefined;
    filter.sort = 'title';
    shown = PAGE;
    renderChips();
    renderResults();
    search.focus();
  }

  function renderResults(): void {
    if (!searching) return;
    if (state !== 'ready') {
      count.textContent = state === 'loading' ? 'Loading shared songs...' : '';
      results.replaceChildren(state === 'error' ? h('li', { class: 'cm-wide' }, problemBox()) : '');
      more.hidden = true;
      return;
    }
    const list = filterLessons(lessons, filter);
    count.textContent = list.length === lessons.length ? `${lessons.length} songs` : `${list.length} of ${lessons.length} songs`;
    more.hidden = list.length <= shown;
    if (list.length === 0) {
      const clear = h('button', { type: 'button', class: 'primary' }, 'Show every song');
      clear.addEventListener('click', clearFilters);
      const empty = notice('empty', 'No songs match', 'Try another word.', clear);
      empty.prepend(mascot('curious'));
      results.replaceChildren(h('li', { class: 'cm-wide' }, empty));
      return;
    }
    results.replaceChildren(...list.slice(0, shown).map((l) => h('li', {}, card(l))));
  }

  function openSearch(): void {
    searching = true;
    find.hidden = false;
    browse.hidden = true;
    searchButton.setAttribute('aria-expanded', 'true');
    renderChips();
    renderResults();
    search.focus();
    window.scrollTo(0, 0);
  }

  function closeSearch(): void {
    searching = false;
    find.hidden = true;
    browse.hidden = false;
    searchButton.setAttribute('aria-expanded', 'false');
    results.replaceChildren();
    searchButton.focus();
  }

  // ---------- Song sheet ----------
  function renderSheet(): void {
    const entry = sheetEntry;
    const body = sheet?.dialog.querySelector<HTMLElement>('.cm-sheet-live');
    if (!entry || !body) return;
    const added = isAdded(entry);
    const working = busy.has(entry.id);
    const playing = preview?.id === entry.id;
    const had = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement.dataset.action : undefined;

    let main: HTMLElement;
    if (added) {
      main = link({ screen: 'play', songId: communityId(entry) }, 'Play', { class: 'button primary big wide', 'aria-label': `Play ${entry.title}`, 'data-action': 'main' });
      main.prepend(icon('play'));
      main.addEventListener('click', () => sheet?.close());
    } else {
      main = h(
        'button',
        { type: 'button', class: 'primary big wide', 'data-action': 'main', disabled: working, 'aria-label': working ? `Adding: ${entry.title}` : `Add to my songs: ${entry.title}` },
        icon('addSong'),
        working ? 'Adding...' : 'Add to my songs',
      );
      main.addEventListener('click', () => void install(entry));
    }
    const listen = h(
      'button',
      { type: 'button', class: 'wide cm-listen', 'data-action': 'listen', 'aria-pressed': String(playing), 'aria-label': `${playing ? 'Stop' : 'Listen to'} ${entry.title}`, disabled: working && !playing },
      icon(playing ? 'pause' : 'listen'),
      playing ? 'Stop' : 'Listen',
    );
    listen.addEventListener('click', () => void togglePreview(entry));
    body.replaceChildren(
      h(
        'div',
        { class: 'cm-sheet-facts' },
        levelBadge(entry.difficulty),
        h('span', { class: 'cm-sheet-length' }, icon('clock'), h('span', { class: 'visually-hidden' }, 'Length '), formatLength(entry.seconds)),
        added ? h('span', { class: 'badge badge-mint' }, icon('check'), 'In your songs') : null,
      ),
      main,
      listen,
      h('p', { class: 'cm-sheet-note', 'aria-live': 'polite' }, sheetNote),
    );
    const want = had ?? pendingFocus;
    if (want) body.querySelector<HTMLElement>(`[data-action="${want}"]`)?.focus();
    if (!working) pendingFocus = undefined;
  }

  function openEntry(entry: CatalogEntry): void {
    sheet?.close();
    sheetEntry = entry;
    sheetNote = '';
    const facts = h('ul', { class: 'cm-sheet-about' });
    facts.append(
      h('li', {}, icon('heart'), h('span', {}, 'Lesson by ', h('strong', {}, entry.arranger))),
      h('li', {}, icon('info'), h('span', {}, licenceWords(entry.licence), h('span', { class: 'cm-licence-name' }, ` (${entry.licence})`))),
    );
    if (entry.recording) {
      facts.append(h('li', {}, icon('wave'), h('span', {}, `Plays along with "${entry.recording.name}" (${formatBytes(entry.recording.bytes)}). Add your own copy after.`)));
    }
    const credit = entry.credit ? h('details', { class: 'cm-sheet-credit' }, h('summary', {}, 'Where the notes come from'), h('p', {}, entry.credit)) : null;
    let mine: Sheet | null = null;
    sheet = mine = openSheet({
      labelledBy: 'cm-sheet-title',
      className: 'cm-sheet',
      onClose: () => {
        if (preview?.id === entry.id) stopPreview();
        // The close event comes a moment later; another sheet may already be open.
        if (sheet !== mine) return;
        sheet = null;
        sheetEntry = null;
      },
      content: [
        h('div', { class: 'cm-sheet-cover' }, songCover(coverOf(entry), 'cm-sheet-art')),
        h('h2', { id: 'cm-sheet-title', class: 'cm-sheet-title' }, entry.title),
        h('p', { class: 'cm-sheet-by' }, entry.artist),
        h('div', { class: 'cm-sheet-live' }),
        facts,
        credit,
      ],
    });
    renderSheet();
    sheet.dialog.querySelector<HTMLElement>('[data-action="main"]')?.focus();
  }

  // ---------- Add from a link ----------
  function openLinkSheet(): void {
    sheet?.close();
    const input = h('input', { type: 'url', id: 'cm-link', placeholder: 'https://...', autocomplete: 'off', inputmode: 'url' });
    const add = h('button', { type: 'submit', class: 'primary big wide' }, icon('addSong'), 'Add lesson');
    const status = h('p', { class: 'cm-sheet-note', 'aria-live': 'polite' });
    const form = h('form', { class: 'cm-link-form' }, h('div', { class: 'field' }, h('label', { for: 'cm-link' }, 'Lesson link'), input), add, status);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) {
        status.textContent = 'Paste the link first.';
        input.focus();
        return;
      }
      add.disabled = true;
      status.replaceChildren('Checking the lesson...');
      try {
        const song = await addToLibrary(ctx.library, await fetchLessonFromLink(value));
        if (!alive) return;
        input.value = '';
        const play = link({ screen: 'play', songId: song.id }, 'Play it now');
        play.addEventListener('click', () => sheet?.close());
        status.replaceChildren(`Added "${song.title}". `, play, song.recording ? ' Add your copy of the recording when you open it.' : '');
        toast(`Added "${song.title}"`);
      } catch (error) {
        if (alive) status.textContent = messageOf(error, 'That lesson could not be added.');
      } finally {
        add.disabled = false;
      }
    });
    let mine: Sheet | null = null;
    sheet = mine = openSheet({
      labelledBy: 'cm-link-title',
      className: 'cm-steps-sheet',
      onClose: () => {
        if (sheet === mine) sheet = null;
      },
      content: [
        h('h2', { id: 'cm-link-title' }, 'Add from a link'),
        steps([
          ['link', 'Copy the link', 'From a message or email.'],
          ['file', 'Paste it here', 'We check it first.'],
          ['songs', 'Play!', 'It lands in your songs.'],
        ]),
        form,
      ],
    });
    input.focus();
  }

  // ---------- Share my lesson ----------
  function openShareSheet(): void {
    sheet?.close();
    const own = ctx.library.bySource('mine');
    let tail: Node[];
    if (own.length === 0) {
      const go = link({ screen: 'home' }, 'Add a song first', { class: 'button primary big wide' });
      tail = [h('p', { class: 'cm-share-empty' }, 'Songs you add yourself show up here.'), go];
    } else {
      const select = h('select', { id: 'cm-share-song' }, ...own.map((s) => h('option', { value: s.id }, s.title)));
      const save = h('button', { type: 'button', class: 'primary big wide' }, icon('download'), 'Download lesson file');
      save.addEventListener('click', () => {
        const song = ctx.library.get(select.value);
        if (!song) return;
        const name = song.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'lesson';
        download(`${name}.json`, JSON.stringify(toLesson(song), null, 1));
        toast('Lesson file saved. Notes only.');
      });
      tail = [h('div', { class: 'field' }, h('label', { for: 'cm-share-song' }, 'Your song'), select), save];
    }
    let mine: Sheet | null = null;
    sheet = mine = openSheet({
      labelledBy: 'cm-share-title',
      className: 'cm-steps-sheet',
      onClose: () => {
        if (sheet === mine) sheet = null;
      },
      content: [
        h('h2', { id: 'cm-share-title' }, 'Share my lesson'),
        steps([
          ['fix', 'Tidy the notes', 'Open it, then Edit notes.'],
          ['file', 'Save the file', 'Notes only, never the recording.'],
          ['share', 'Send it in', 'Follow the makers\' guide (CONTRIBUTING.md).'],
        ]),
        h('p', { class: 'cm-share-rule' }, icon('info'), 'Only share music you may share: your own, or free music.'),
        ...tail,
      ],
    });
    sheet.dialog.querySelector<HTMLElement>('select, .primary')?.focus();
  }

  // ---------- Loading ----------
  function rerender(): void {
    renderBrowse();
    renderResults();
    renderSheet();
  }

  async function load(): Promise<void> {
    const token = ++loadToken;
    state = 'loading';
    rerender();
    try {
      const result = await fetchCatalog(catalogUrl);
      if (!alive || token !== loadToken) return;
      lessons = result.catalog.lessons;
      skipped = result.problems.length;
      if (result.problems.length > 0) console.warn('Some shared lessons were left out:', result.problems);
      state = 'ready';
      if (filter.tag && !allTags(lessons).includes(filter.tag)) filter.tag = undefined;
      if (searching) renderChips();
    } catch (error) {
      if (!alive || token !== loadToken) return;
      state = 'error';
      lessons = [];
      errorKind = error instanceof CatalogError && error.kind === 'offline' ? 'offline' : 'other';
      errorMessage = messageOf(error, 'Try again in a moment.');
    }
    rerender();
  }

  async function songFor(entry: CatalogEntry): Promise<Song> {
    const inLibrary = ctx.library.get(communityId(entry));
    if (inLibrary) return inLibrary;
    const cached = downloaded.get(entry.id);
    if (cached) return cached;
    const song = await fetchCatalogSong(entry, catalogUrl);
    downloaded.set(entry.id, song);
    return song;
  }

  async function install(entry: CatalogEntry): Promise<void> {
    if (busy.has(entry.id)) return;
    busy.add(entry.id);
    sheetNote = '';
    pendingFocus = 'main';
    renderSheet();
    try {
      const song = await songFor(entry);
      await addToLibrary(ctx.library, song);
      sheetNote = song.recording ? 'Added! Open it to add your copy of the recording.' : 'Added to your songs!';
      if (!sheet || sheetEntry?.id !== entry.id) toast(`Added "${entry.title}"`);
    } catch (error) {
      sheetNote = messageOf(error, 'This lesson could not be added. Try again in a moment.');
    } finally {
      busy.delete(entry.id);
      if (alive) rerender();
    }
  }

  // ---------- Preview ----------
  function stopPreview(): void {
    if (preview) preview.stop();
    preview = null;
  }

  async function togglePreview(entry: CatalogEntry): Promise<void> {
    if (preview?.id === entry.id) {
      stopPreview();
      sheetNote = '';
      renderSheet();
      return;
    }
    stopPreview();
    ctx.audio.instrument.wake(); // inside the click, before any waiting
    busy.add(entry.id);
    pendingFocus = 'listen';
    renderSheet();
    let song: Song;
    try {
      song = await songFor(entry);
    } catch (error) {
      sheetNote = messageOf(error, 'This lesson could not be loaded. Try again in a moment.');
      return;
    } finally {
      busy.delete(entry.id);
      if (alive) renderSheet();
    }
    if (!alive || sheetEntry?.id !== entry.id) return;
    const notes = song.notes.filter((n) => n.start < PREVIEW_SECONDS);
    const end = notes.reduce((e, n) => Math.max(e, n.start + Math.min(n.dur, 4)), 0);
    const started = performance.now() + 80;
    let next = 0;
    const timer = window.setInterval(() => {
      const t = (performance.now() - started) / 1000;
      while (next < notes.length && notes[next].start <= t + 0.03) {
        const n = notes[next++];
        ctx.audio.instrument.play(n.midi, Math.min(n.dur, 4), n.hand === 'left' ? 0.55 : 0.7);
      }
      if (t > end) {
        stopPreview();
        sheetNote = '';
        renderSheet();
      }
    }, 20);
    preview = { id: entry.id, stop: () => window.clearInterval(timer) };
    sheetNote = `Playing the first ${PREVIEW_SECONDS} seconds.`;
    renderSheet();
  }

  // ---------- Events ----------
  searchButton.addEventListener('click', () => (searching ? closeSearch() : openSearch()));
  closeSearchButton.addEventListener('click', closeSearch);
  find.querySelector('form')?.addEventListener('submit', (e) => e.preventDefault());
  search.addEventListener('input', () => {
    filter.query = search.value;
    shown = PAGE;
    renderResults();
  });
  sort.addEventListener('change', () => {
    filter.sort = sort.value as SortOrder;
    renderResults();
  });
  more.addEventListener('click', () => {
    shown += PAGE;
    renderResults();
  });
  linkOpen.addEventListener('click', openLinkSheet);
  shareOpen.addEventListener('click', openShareSheet);
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && searching && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      closeSearch();
    }
  };
  document.addEventListener('keydown', onEscape);

  const onOnline = () => {
    if (state === 'error') void load();
  };
  window.addEventListener('online', onOnline);
  const offLibrary = ctx.library.subscribe(() => {
    if (!alive) return;
    renderBrowse();
    renderResults();
    renderSheet();
  });
  const offSettings = ctx.settings.subscribe((s, changed) => {
    if (!changed.includes('catalogUrl')) return;
    catalogUrl = catalogUrlFrom(s);
    renderSource();
    void load();
  });
  void load();

  return () => {
    alive = false;
    loadToken++;
    stopPreview();
    sheet?.close();
    document.removeEventListener('keydown', onEscape);
    window.removeEventListener('online', onOnline);
    offLibrary();
    offSettings();
  };
}
