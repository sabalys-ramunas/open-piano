import '../styles/home.css';
import type { AppContext } from '../app/context';
import { download, h, levelBadge, levelDots, link, notice, pickFile, starRating } from '../app/dom';
import type { SongSummary } from '../app/library';
import { acceptList } from '../app/formats';
import { setHandoff } from '../app/handoff';
import { inAppShell } from '../app/shell';
import { getStreak } from '../app/progress';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import type { SongProgress } from '../app/store';
import { DIFFICULTY_WORD, MODES, minutesSeconds } from '../app/words';
import {
  bestNext,
  countText,
  dragHasFiles,
  EMPTY_QUERY,
  filterSongs,
  greeting,
  homeShelves,
  lastPlayed,
  lessonFileName,
  liveStreakDays,
  popularTags,
  SORTS,
  sortSongs,
  type CourseSummary,
  type LibraryQuery,
  type NextThing,
  type SortKey,
} from '../home/library-view';
import type { ImportFlow } from '../home/import-flow';
import { currentBrowser, noMidiAdvice } from '../input/browser';
import { toLesson } from '../lesson';
import type { Mode } from '../player/game';
import type { Difficulty } from '../song';
import { songCover, unitArt } from '../ui/cover-art';
import { icon, type IconName } from '../ui/icons';
import { mascot } from '../ui/mascot';
import { openSheet, type Sheet } from '../ui/sheet';
import { shelf } from '../ui/shelf';
import { toast } from '../ui/toast';

/** Files the picker offers: the same list as ACCEPT in src/import, without loading the import code first. */
const PICK_ACCEPT = acceptList();

type ImportModule = typeof import('../home/import-flow');

const MODE_ICON: Record<Mode, IconName> = { listen: 'listen', wait: 'learnMode', flow: 'playAlong' };
const MODE_HINT: Record<Mode, string> = { listen: 'Hear it first', wait: 'It waits for you', flow: 'Keep the beat' };

/**
 * #/ Songs: a greeting, one big card with the best next thing, a bold "add
 * your own song" card, then rows of picture cards. Choosing a card opens the
 * song sheet (play, how to play, and the less common actions). Search and
 * filters sit behind the search button.
 */
export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  void route;
  let alive = true;
  let progress = new Map<string, SongProgress>();
  let query: LibraryQuery = { ...EMPTY_QUERY };
  let searching = false;
  let sheet: Sheet | null = null;
  const cleanups: (() => void)[] = [];

  // ---------- Top: greeting, streak, piano, search ----------
  const streakBox = h('span', { class: 'home-streak' });
  const pianoBox = h('span', { class: 'home-piano', 'aria-live': 'polite' });
  const searchButton = h(
    'button',
    { type: 'button', class: 'icon-button big home-search-button', 'aria-label': 'Find a song', 'aria-expanded': 'false', 'aria-controls': 'find-panel' },
    icon('search'),
  );
  const saveWarning = ctx.store.persistent
    ? null
    : h('p', { class: 'home-save-warning' }, icon('info'), 'This window cannot save. Songs and stars go when you close it.');
  const top = h(
    'header',
    { class: 'home-top' },
    mascot('happy', 'home-mascot'),
    h(
      'div',
      { class: 'home-hello' },
      h('h1', { class: 'home-greeting', 'data-title': 'Songs' }, greeting()),
      h('p', { class: 'home-sub' }, 'What shall we play today?'),
      h('div', { class: 'home-chips' }, streakBox, pianoBox),
    ),
    searchButton,
  );

  // ---------- The big card: the single best next thing ----------
  const hero = h('section', { class: 'bigcard fill-sun hero-card', 'aria-label': 'Up next' }, h('div', { class: 'skeleton hero-skeleton' }));

  // ---------- Add your own song ----------
  const pickButton = h('button', { type: 'button', class: 'primary big' }, icon('addSong'), 'Choose a file');
  const addCard = h(
    'section',
    { class: 'bigcard fill-coral add-card', 'aria-labelledby': 'add-heading' },
    h('h2', { id: 'add-heading', class: 'add-title' }, 'Add your own song'),
    h('p', { class: 'add-text' }, 'MP3, MIDI or a lesson file. ', h('strong', {}, 'Nothing is uploaded.')),
    h('div', { class: 'add-actions' }, pickButton, link({ screen: 'editor' }, 'Write one', { class: 'button quiet small' })),
    h('p', { class: 'add-drop', 'aria-hidden': 'true' }, 'or drop a file anywhere'),
  );
  const dropCover = h('div', { class: 'drop-cover', 'aria-hidden': 'true', hidden: true }, h('div', { class: 'drop-cover-inner' }, mascot('cheer'), h('p', {}, 'Drop it to make a lesson!')));

  // ---------- Rows ----------
  const shelves = h('div', { class: 'home-shelves' });

  // ---------- Search (behind the search button) ----------
  const search = h('input', { type: 'search', id: 'song-search', placeholder: 'Title, composer or style', autocomplete: 'off' });
  const levelChips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Level' });
  const styleChips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Style' });
  const sortSelect = h('select', { id: 'song-sort' }, ...SORTS.map((s) => h('option', { value: s.key }, s.label)));
  const count = h('p', { class: 'find-count', role: 'status', 'aria-live': 'polite' });
  const results = h('ul', { class: 'pcard-grid find-results' });
  const doneButton = h('button', { type: 'button', class: 'quiet small' }, icon('close'), 'Close search');
  const findPanel = h(
    'section',
    { class: 'find', id: 'find-panel', 'aria-labelledby': 'find-heading', hidden: true },
    h(
      'div',
      { class: 'find-bar card' },
      h('div', { class: 'find-head' }, h('h2', { id: 'find-heading', class: 'find-title' }, 'Find a song'), doneButton),
      h('div', { class: 'find-input' }, icon('search'), h('label', { for: 'song-search', class: 'visually-hidden' }, 'Find a song'), search),
      h('div', { class: 'find-filters' }, h('span', { class: 'label', 'aria-hidden': 'true' }, 'Level'), levelChips),
      h('div', { class: 'find-filters' }, h('span', { class: 'label', 'aria-hidden': 'true' }, 'Style'), styleChips),
      h('div', { class: 'find-sort' }, h('label', { for: 'song-sort', class: 'label' }, 'Order'), sortSelect),
    ),
    count,
    results,
  );

  const browse = h('div', { class: 'home-browse' }, h('div', { class: 'home-lead' }, hero, addCard), saveWarning, shelves);
  container.append(h('div', { class: 'home' }, top, findPanel, browse), dropCover);
  cleanups.push(() => dropCover.remove());

  // ---------- Import flow (loaded a moment after the page is drawn) ----------
  let flowModule: ImportModule | null = null;
  let flow: ImportFlow | null = null;
  const flowReady: Promise<ImportModule> = new Promise((resolve, reject) => {
    window.setTimeout(() => import('../home/import-flow').then(resolve, reject), 300);
  });
  flowReady.then(
    (m) => {
      flowModule = m;
    },
    () => {},
  );
  async function getFlow(): Promise<ImportFlow | null> {
    if (flow) return flow;
    try {
      const m = flowModule ?? (await flowReady);
      if (!alive) return null;
      flow = m.createImportFlow(ctx, container, (text) => toast(text));
      return flow;
    } catch (error) {
      console.error(error);
      toast(inAppShell() ? 'Adding songs could not start. Close the app and open it again.' : 'Adding songs could not start. Check your connection and reload.', { kind: 'error' });
      return null;
    }
  }
  async function addFile(file: File): Promise<void> {
    const f = await getFlow();
    f?.open(file);
  }
  async function pick(): Promise<void> {
    if (flow?.busy) return;
    const file = await pickFile(flowModule?.ACCEPT ?? PICK_ACCEPT);
    if (file && alive) await addFile(file);
  }
  pickButton.addEventListener('click', () => void pick());
  container.addEventListener('import-pick', () => void pick());

  // Drag and drop anywhere on the page while home is open.
  let dragDepth = 0;
  const onDragEnter = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer?.types)) return;
    e.preventDefault();
    dragDepth++;
    dropCover.hidden = false;
  };
  const onDragOver = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer?.types)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const endDrag = () => {
    dragDepth = 0;
    dropCover.hidden = true;
  };
  const onDragLeave = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer?.types)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) endDrag();
  };
  const onDrop = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer?.types)) return;
    e.preventDefault();
    endDrag();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) toast('One song at a time. Adding the first file.');
    void addFile(files[0]);
  };
  document.addEventListener('dragenter', onDragEnter);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);
  cleanups.push(() => {
    document.removeEventListener('dragenter', onDragEnter);
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('dragleave', onDragLeave);
    document.removeEventListener('drop', onDrop);
  });

  // ---------- The big card ----------
  let course: CourseSummary | null = null;
  let courseLoaded = false;
  let progressLoaded = false;

  function heroArt(next: NextThing): Element {
    if (next.kind === 'lesson' || next.kind === 'first-lesson') return unitArt(next.unit, 'hero-art');
    const song = ctx.library.summary(next.songId);
    return songCover(song ?? { id: next.songId }, 'hero-art');
  }

  function renderHero(): void {
    if (!courseLoaded || !progressLoaded) return;
    const last = lastPlayed(progress.values(), (id) => ctx.library.has(id));
    const first = ctx.library.summaries().find((s) => s.source === 'built-in' && s.difficulty === 1);
    const next = bestNext(course, last, first?.id);
    if (!next) {
      hero.replaceChildren(h('h2', { class: 'hero-title' }, 'Pick a song below'));
      return;
    }
    let kicker = '';
    let title = '';
    let facts: Node | null = null;
    let action: HTMLElement;
    let other: HTMLElement | null = null;
    switch (next.kind) {
      case 'first-lesson':
        kicker = 'Your first lesson';
        title = next.title;
        facts = h('p', { class: 'hero-facts' }, 'Two minutes. No piano skills needed.');
        action = link({ screen: 'course', lessonId: next.lessonId }, 'Start', { class: 'button primary big', 'aria-label': `Start lesson: ${next.title}` });
        if (first) other = link({ screen: 'play', songId: first.id }, 'Play a song instead', { class: 'button quiet' });
        break;
      case 'lesson': {
        kicker = `Lesson ${next.number}`;
        title = next.title;
        facts = h(
          'div',
          { class: 'hero-progress' },
          h(
            'div',
            { class: 'meter-bar', role: 'progressbar', 'aria-label': 'Course progress', 'aria-valuemin': 0, 'aria-valuemax': next.total, 'aria-valuenow': next.done },
            h('span', { style: `width: ${Math.round((next.done / Math.max(1, next.total)) * 100)}%` }),
          ),
          h('span', {}, `${next.done} of ${next.total} done`),
        );
        action = link({ screen: 'course', lessonId: next.lessonId }, 'Continue', { class: 'button primary big', 'aria-label': `Continue lesson: ${next.title}` });
        other = link({ screen: 'course' }, 'See the map', { class: 'button quiet' });
        break;
      }
      case 'song':
      case 'first-song': {
        const song = ctx.library.summary(next.songId);
        kicker = next.kind === 'song' ? 'Play it again' : 'Try this one';
        title = song?.title ?? 'Your song';
        facts = next.kind === 'song' ? h('p', { class: 'hero-facts' }, starRating(next.stars), ` Best ${Math.round(next.best * 100)}%`) : null;
        action = link({ screen: 'play', songId: next.songId }, 'Play', { class: 'button primary big', 'aria-label': `Play ${title}` });
        if (course?.next) other = link({ screen: 'course', lessonId: course.next.id }, 'Next lesson', { class: 'button quiet' });
        break;
      }
    }
    action.prepend(icon('play'));
    hero.replaceChildren(
      h('div', { class: 'hero-art-box' }, heroArt(next)),
      h(
        'div',
        { class: 'hero-text' },
        h('p', { class: 'hero-kicker' }, kicker),
        h('h2', { class: 'hero-title' }, title),
        facts,
        h('div', { class: 'hero-actions' }, action, other),
      ),
    );
  }

  async function loadCourse(): Promise<void> {
    try {
      const [{ loadProgress, continueLesson, courseProgress }, { allLessons, COURSE }, streak, records] = await Promise.all([
        import('../course/progress'),
        import('../course/curriculum'),
        getStreak(ctx.store).catch(() => null),
        ctx.store.allLessonProgress().catch(() => []),
      ]);
      const p = await loadProgress(ctx.store);
      if (!alive) return;
      const totals = courseProgress(p);
      const next = continueLesson(p);
      const unit = next ? Math.max(0, COURSE.units.findIndex((u) => u.lessons.includes(next))) : 0;
      course = {
        done: totals.done,
        total: totals.total,
        lastLessonAt: records.reduce((m, r) => Math.max(m, r.completedAt ?? 0), 0),
        next: next ? { id: next.id, title: next.title, number: allLessons().indexOf(next) + 1, unit } : undefined,
      };
      renderStreak(liveStreakDays(streak));
    } catch (error) {
      console.warn('Course progress could not be read.', error);
      course = null;
    }
    courseLoaded = true;
    renderHero();
  }

  function renderStreak(days: number): void {
    streakBox.replaceChildren(
      days > 0 ? h('span', { class: 'badge badge-sun' }, icon('sun'), `${days} ${days === 1 ? 'day' : 'days'} in a row`) : '',
    );
  }

  // ---------- Piano status ----------
  function showStatus(): void {
    const devices = ctx.input.devices();
    if (devices.length > 0) {
      pianoBox.replaceChildren(h('span', { class: 'badge badge-mint', title: devices.join(', ') }, icon('piano'), 'Piano connected'));
    } else if (ctx.sources.midi.status === 'unsupported' && !inAppShell()) {
      // A piano can never connect here (Safari on a Mac, iPhone and iPad browsers): say so, and why, on a tap.
      const why = h('button', { type: 'button', class: 'badge home-connect' }, icon('info'), 'No piano in this browser');
      why.addEventListener('click', () => openNoPiano());
      pianoBox.replaceChildren(why);
    } else {
      pianoBox.replaceChildren(link({ screen: 'settings' }, 'Connect a piano', { class: 'badge home-connect' }));
      pianoBox.firstElementChild?.prepend(icon('usb'));
    }
  }

  function openNoPiano(): void {
    sheet?.close();
    const ok = h('button', { type: 'button', class: 'primary wide' }, 'OK');
    const opened = openSheet({
      labelledBy: 'no-piano-title',
      className: 'no-piano-sheet',
      content: [
        h('h2', { id: 'no-piano-title' }, 'Pianos and this browser'),
        h('p', {}, noMidiAdvice(currentBrowser())),
        h('p', { class: 'hint' }, 'You can still play every song by tapping or clicking the keys on screen.'),
        ok,
      ],
      onClose: () => {
        if (sheet === opened) sheet = null;
      },
    });
    sheet = opened;
    ok.addEventListener('click', () => opened.close());
  }

  // ---------- Picture cards ----------
  function card(song: SongSummary): HTMLElement {
    const p = progress.get(song.id);
    const open = h('button', { type: 'button', class: 'pcard-open' }, song.title);
    open.addEventListener('click', () => openSong(song.id));
    const badge = song.needsRecording
      ? h('span', { class: 'pcard-badge badge badge-cream' }, 'Needs its recording')
      : song.source === 'mine' && !p
        ? h('span', { class: 'pcard-badge badge badge-sun' }, 'New')
        : null;
    return h(
      'article',
      { class: 'pcard', 'data-song-id': song.id },
      songCover(song),
      badge,
      h(
        'div',
        { class: 'pcard-body' },
        h('h3', { class: 'pcard-title' }, open),
        song.by ? h('p', { class: 'pcard-by' }, song.by) : null,
        h('div', { class: 'pcard-meta' }, song.difficulty ? levelDots(song.difficulty) : h('span', {}), starRating(p?.stars ?? 0)),
      ),
    );
  }

  function levelTile(d: Difficulty): HTMLElement {
    const b = h(
      'button',
      { type: 'button', class: `level-tile level-tile-${d}` },
      h('span', { class: 'level-tile-number', 'aria-hidden': 'true' }, String(d)),
      h('span', { class: 'level-tile-word' }, h('span', { class: 'visually-hidden' }, `Level ${d}: `), DIFFICULTY_WORD[d]),
      levelDots(d),
    );
    b.addEventListener('click', () => {
      query = { ...EMPTY_QUERY, level: d };
      openSearch(false);
    });
    return b;
  }

  function sharedTeaser(): HTMLElement {
    return h(
      'section',
      { class: 'bigcard fill-mint shared-card', 'aria-labelledby': 'shared-heading' },
      h('div', { class: 'shared-art', 'aria-hidden': 'true' }, songCover({ id: 'shared-a', source: 'community' }, 'shared-cover'), songCover({ id: 'shared-b', tags: ['folk'] }, 'shared-cover'), songCover({ id: 'shared-c', tags: ['classical'], by: 'x' }, 'shared-cover')),
      h(
        'div',
        { class: 'shared-text' },
        h('h2', { id: 'shared-heading' }, 'Songs from other players'),
        h('p', {}, 'Free lessons people shared. Notes only.'),
        link({ screen: 'community' }, 'See shared songs', { class: 'button primary' }),
      ),
    );
  }

  let lastShelvesKey = '';
  function renderShelves(): void {
    const all = ctx.library.summaries();
    if (all.length === 0) {
      shelves.replaceChildren(notice('loading', 'Getting the songs ready...'));
      lastShelvesKey = '';
      return;
    }
    // Only redraw when something visible changed, so scroll positions survive.
    const key = all.map((s) => `${s.id}:${s.needsRecording ? 1 : 0}:${progress.get(s.id)?.stars ?? -1}`).join('|');
    if (key === lastShelvesKey) return;
    lastShelvesKey = key;
    const rows: HTMLElement[] = homeShelves(all).map((row) =>
      shelf({ id: row.id, title: row.title, count: row.id === 'mine' || row.id === 'from-shared' ? String(row.songs.length) : undefined, items: row.songs.map(card) }),
    );
    const levels = shelf({ id: 'levels', title: 'Pick by level', items: ([1, 2, 3, 4, 5] as Difficulty[]).map(levelTile) });
    // Order: personal rows, Start here, the first style row, levels, the shared teaser, then the rest.
    const personal = rows.filter((r) => ['mine', 'from-shared', 'start'].includes(r.dataset.shelf ?? ''));
    const styles = rows.filter((r) => !personal.includes(r));
    shelves.replaceChildren(...personal, ...styles.slice(0, 1), levels, sharedTeaser(), ...styles.slice(1));
  }

  // ---------- Song sheet ----------
  function openSong(id: string): void {
    const song = ctx.library.summary(id);
    if (!song) return;
    sheet?.close();
    const p = progress.get(id);
    let mode: Mode = ctx.settings.get().mode;
    const modeButtons = MODES.map((m) => {
      const b = h(
        'button',
        { type: 'button', class: 'mode-tile', 'aria-pressed': String(m.mode === mode) },
        icon(MODE_ICON[m.mode]),
        h('span', { class: 'mode-tile-label' }, m.label),
        h('span', { class: 'mode-tile-hint' }, MODE_HINT[m.mode]),
      );
      b.addEventListener('click', () => {
        mode = m.mode;
        for (const [i, other] of modeButtons.entries()) other.setAttribute('aria-pressed', String(MODES[i].mode === mode));
      });
      return b;
    });
    const play = h('button', { type: 'button', class: 'primary big wide' }, icon('play'), 'Play');
    play.addEventListener('click', () => {
      ctx.settings.set({ mode });
      setHandoff({ kind: 'mode-chosen', songId: id, mode });
      sheet?.close();
      ctx.navigate({ screen: 'play', songId: id });
    });

    const save = h('button', { type: 'button', class: 'quiet small' }, icon('download'), 'Save lesson file');
    save.addEventListener('click', () => void exportSong(song));
    const more = h('div', { class: 'song-sheet-more' }, link({ screen: 'editor', songId: id }, 'Edit notes', { class: 'button quiet small' }), save);
    more.firstElementChild?.prepend(icon('edit'));
    if (song.source !== 'built-in') {
      const remove = h('button', { type: 'button', class: 'quiet small danger' }, icon('trash'), 'Remove');
      remove.addEventListener('click', () => {
        const yes = h('button', { type: 'button', class: 'button-coral small' }, 'Yes, remove');
        const no = h('button', { type: 'button', class: 'quiet small' }, 'Keep it');
        const ask = h('div', { class: 'song-sheet-confirm', role: 'group', 'aria-label': 'Remove this song?' }, h('p', {}, 'Remove this song and its stars?'), yes, no);
        yes.addEventListener('click', () => {
          void ctx.library.remove(id).then(() => toast(`Removed "${song.title}".`));
          sheet?.close();
        });
        no.addEventListener('click', () => {
          ask.replaceWith(more);
          remove.focus();
        });
        more.replaceWith(ask);
        no.focus();
      });
      more.append(remove);
    }

    const facts = h(
      'div',
      { class: 'song-sheet-facts' },
      song.difficulty ? levelBadge(song.difficulty) : null,
      song.seconds ? h('span', { class: 'song-sheet-length' }, icon('clock'), h('span', { class: 'visually-hidden' }, 'Length '), minutesSeconds(song.seconds)) : null,
      p ? h('span', { class: 'song-sheet-best' }, starRating(p.stars), `Best ${Math.round(p.best * 100)}%`) : h('span', { class: 'badge badge-sun' }, 'Not played yet'),
    );
    const notes = h(
      'div',
      { class: 'song-sheet-tags' },
      song.hasRecording ? h('span', { class: 'badge badge-mint' }, 'With recording') : null,
      song.needsRecording ? h('span', { class: 'badge badge-coral' }, 'Needs its recording') : null,
      song.edited ? h('span', { class: 'badge badge-cream' }, 'Edited') : null,
    );
    sheet = openSheet({
      labelledBy: 'song-sheet-title',
      className: 'song-sheet',
      onClose: () => {
        sheet = null;
      },
      content: [
        h('div', { class: 'song-sheet-cover' }, songCover(song, 'song-sheet-art')),
        h('h2', { id: 'song-sheet-title', class: 'song-sheet-title' }, song.title),
        song.by ? h('p', { class: 'song-sheet-by' }, song.by) : null,
        facts,
        notes.childElementCount ? notes : null,
        h('fieldset', { class: 'mode-tiles' }, h('legend', { class: 'label' }, 'How to play'), ...modeButtons),
        play,
        more,
      ],
    });
    play.focus();
  }

  async function exportSong(summary: SongSummary): Promise<void> {
    const song = await ctx.library.ensure(summary.id);
    if (!song) {
      toast('That song could not be loaded. Check your connection.', { kind: 'error' });
      return;
    }
    download(lessonFileName(song.title), JSON.stringify(toLesson(song)));
    toast('Lesson file saved. Notes only, so it is fine to share.');
  }

  // ---------- Search ----------
  /** Draws the filter chips for the current query. Choosing one updates the pressed state in place, so focus stays put. */
  function renderChips(): void {
    const all = ctx.library.summaries();
    const tags = popularTags(all, 8);
    const group = (box: HTMLElement, options: { label: string; aria?: string; pressed: boolean; pick: () => void }[]): void => {
      const buttons = options.map((o) => {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.pressed), 'aria-label': o.aria ?? null }, o.label);
        b.addEventListener('click', () => {
          o.pick();
          for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
          renderResults();
        });
        return b;
      });
      box.replaceChildren(...buttons);
    };
    group(levelChips, [
      { label: 'All', aria: 'Every level', pressed: query.level === 0, pick: () => (query = { ...query, level: 0 }) },
      ...([1, 2, 3, 4, 5] as Difficulty[]).map((d) => ({
        label: `${d} · ${DIFFICULTY_WORD[d]}`,
        aria: `Level ${d} · ${DIFFICULTY_WORD[d]}`,
        pressed: query.level === d,
        pick: () => (query = { ...query, level: d }),
      })),
    ]);
    group(styleChips, [
      { label: 'All', aria: 'Every style', pressed: query.tag === '', pick: () => (query = { ...query, tag: '' }) },
      ...tags.map((t) => ({ label: t.charAt(0).toUpperCase() + t.slice(1), pressed: query.tag === t, pick: () => (query = { ...query, tag: t }) })),
    ]);
  }

  function renderResults(): void {
    if (!searching) return;
    const all = ctx.library.summaries();
    const list = sortSongs(filterSongs(all, query), query.sort, progress);
    count.textContent = countText(list.length, all.length);
    if (list.length === 0) {
      const clear = h('button', { type: 'button', class: 'primary' }, 'Show every song');
      clear.addEventListener('click', clearFilters);
      results.replaceChildren(h('li', { class: 'find-empty' }, notice('empty', 'No songs match', 'Try another word.', clear)));
      return;
    }
    results.replaceChildren(...list.map((s) => h('li', {}, card(s))));
  }

  function openSearch(focusInput = true): void {
    searching = true;
    findPanel.hidden = false;
    browse.hidden = true;
    searchButton.setAttribute('aria-expanded', 'true');
    search.value = query.search;
    sortSelect.value = query.sort;
    renderChips();
    renderResults();
    if (focusInput) search.focus();
    else findPanel.querySelector<HTMLElement>('.chip[aria-pressed="true"]')?.focus();
    window.scrollTo(0, 0);
  }

  function closeSearch(): void {
    searching = false;
    query = { ...EMPTY_QUERY };
    findPanel.hidden = true;
    browse.hidden = false;
    searchButton.setAttribute('aria-expanded', 'false');
    results.replaceChildren();
    searchButton.focus();
  }

  function clearFilters(): void {
    query = { ...EMPTY_QUERY };
    search.value = '';
    sortSelect.value = 'suggested';
    renderChips();
    renderResults();
    search.focus();
  }

  searchButton.addEventListener('click', () => (searching ? closeSearch() : openSearch()));
  doneButton.addEventListener('click', closeSearch);
  let searchTimer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      query = { ...query, search: search.value };
      renderResults();
    }, 120);
  });
  sortSelect.addEventListener('change', () => {
    query = { ...query, sort: sortSelect.value as SortKey };
    renderResults();
  });
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && searching && !sheet && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      closeSearch();
    }
  };
  document.addEventListener('keydown', onEscape);
  cleanups.push(() => document.removeEventListener('keydown', onEscape));

  // ---------- Data ----------
  let renderQueued = false;
  const queueRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!alive) return;
      renderShelves();
      renderResults();
      renderHero();
    });
  };
  cleanups.push(ctx.library.subscribe(queueRender));
  cleanups.push(ctx.input.on('devices', showStatus));
  cleanups.push(ctx.sources.midi.onChange(showStatus));

  ctx.store
    .allProgress()
    .then((list) => {
      if (!alive) return;
      progress = new Map(list.map((p) => [p.songId, p]));
      progressLoaded = true;
      queueRender();
    })
    .catch(() => {
      progressLoaded = true;
      queueRender();
    });
  void loadCourse();

  renderShelves();
  showStatus();

  return () => {
    alive = false;
    window.clearTimeout(searchTimer);
    sheet?.close();
    for (const off of cleanups) off();
    flow?.destroy();
  };
}
