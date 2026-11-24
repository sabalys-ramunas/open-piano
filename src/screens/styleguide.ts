import '../styles/styleguide.css';
import type { AppContext } from '../app/context';
import { appBar, h, levelBadge, levelDots, link, notice, starRating, starsBadge } from '../app/dom';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import type { Difficulty } from '../song';
import { celebrate } from '../ui/celebrate';
import { coverStyle, songCover, unitArt, type CoverInput } from '../ui/cover-art';
import { icon, ICON_NAMES } from '../ui/icons';
import { illustration } from '../ui/illustrations';
import { mascot } from '../ui/mascot';
import { openSheet } from '../ui/sheet';
import { shelf } from '../ui/shelf';
import { toast } from '../ui/toast';

/**
 * #/styleguide (dev server only): every token and component on one page, for
 * the people restyling screens and for screenshots. See docs/design.md.
 */

const COLOR_TOKENS: [string, string][] = [
  ['--ocean-1', 'Ocean teal'],
  ['--ocean-2', 'Ocean'],
  ['--ocean-3', 'Ocean blue'],
  ['--ocean-deep', 'Deep (nav)'],
  ['--panel', 'Panel'],
  ['--panel-2', 'Panel 2'],
  ['--panel-3', 'Panel 3'],
  ['--sun', 'Sun (primary)'],
  ['--coral', 'Coral'],
  ['--mint', 'Mint'],
  ['--sky', 'Sky'],
  ['--cream', 'Cream'],
  ['--paper', 'Paper'],
  ['--paper-2', 'Paper 2'],
  ['--ink', 'Ink'],
  ['--right', 'Right hand (notes only)'],
  ['--left', 'Left hand (notes only)'],
];

const SAMPLE_SONGS: CoverInput[] = [
  { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', by: 'Traditional', tags: ['children'], difficulty: 1, source: 'built-in' },
  { id: 'pack:brahms-lullaby', title: 'Lullaby', by: 'Johannes Brahms', tags: ['lullaby'], difficulty: 2, source: 'built-in' },
  { id: 'pack:jingle', title: 'Jingle Bells', by: 'James Lord Pierpont', tags: ['holiday'], difficulty: 2, source: 'built-in' },
  { id: 'pack:greensleeves', title: 'Greensleeves', by: 'Traditional (England)', tags: ['folk'], difficulty: 3, source: 'built-in' },
  { id: 'elise', title: 'Für Elise', by: 'Ludwig van Beethoven', tags: ['classical'], difficulty: 3, source: 'built-in' },
  { id: 'pack:entertainer', title: 'The Entertainer', by: 'Scott Joplin', tags: ['ragtime'], difficulty: 4, source: 'built-in' },
  { id: 'pack:amazing', title: 'Amazing Grace', by: 'Traditional', tags: ['hymn'], difficulty: 1, source: 'built-in' },
  { id: 'pack:soldiers', title: "Soldiers' March", by: 'Robert Schumann', tags: ['march', 'classical'], difficulty: 3, source: 'built-in' },
  { id: 'pack:waltz', title: 'Waltz in A minor', by: 'Frédéric Chopin', tags: ['dance', 'classical'], difficulty: 4, source: 'built-in' },
  { id: 'mine:abc', title: 'My recording', by: 'Me', tags: [], difficulty: 2, source: 'mine' },
  { id: 'community:x', title: 'A shared tune', by: 'Someone', tags: [], difficulty: 2, source: 'community' },
  { id: 'misc', title: 'Untagged tune', by: '', tags: [], difficulty: 5, source: 'built-in' },
];

function section(id: string, title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'sg-section', 'aria-labelledby': `sg-${id}` }, h('h2', { id: `sg-${id}`, class: 'sg-title' }, title), ...children.filter((c): c is Node => c !== null));
}

function code(text: string): HTMLElement {
  return h('code', { class: 'sg-code' }, text);
}

function sampleCard(song: CoverInput, stars = 0): HTMLElement {
  const open = h('button', { type: 'button', class: 'pcard-open' }, song.title ?? '');
  open.addEventListener('click', () => toast(`Card chosen: ${song.title ?? ''}`));
  return h(
    'article',
    { class: 'pcard' },
    songCover(song),
    h(
      'div',
      { class: 'pcard-body' },
      h('h3', { class: 'pcard-title' }, open),
      song.by ? h('p', { class: 'pcard-by' }, song.by) : null,
      h('div', { class: 'pcard-meta' }, levelDots((song.difficulty ?? 1) as Difficulty), starRating(stars)),
    ),
  );
}

export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  void route;
  void ctx;

  const swatches = h(
    'div',
    { class: 'sg-swatches' },
    ...COLOR_TOKENS.map(([token, name]) => h('div', { class: 'sg-swatch' }, h('span', { class: 'sg-chip', style: `background: var(${token})` }), h('strong', {}, name), code(token))),
  );

  const type = h(
    'div',
    { class: 'sg-type' },
    h('p', { class: 'display' }, 'Display 4xl'),
    h('h1', { class: 'sg-h' }, 'Heading 1 (3xl)'),
    h('h2', { class: 'sg-h' }, 'Heading 2 (2xl)'),
    h('h3', { class: 'sg-h' }, 'Heading 3 (xl)'),
    h('p', { class: 'kicker' }, 'Kicker'),
    h('p', { class: 'lead' }, 'Lead text: short, warm and concrete.'),
    h('p', {}, 'Body text in Atkinson Hyperlegible at 17px. Easy to read for everyone.'),
    h('p', { class: 'muted' }, 'Muted text for second-level facts.'),
  );

  const disabled = h('button', { type: 'button', class: 'primary', disabled: true }, 'Disabled');
  const buttons = h(
    'div',
    { class: 'sg-stack' },
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary big' }, icon('play'), 'Play'), h('button', { type: 'button', class: 'primary' }, 'Primary'), h('button', { type: 'button', class: 'primary small' }, 'Small'), disabled),
    h('div', { class: 'row' }, h('button', { type: 'button' }, 'Secondary'), h('button', { type: 'button', class: 'quiet' }, 'Quiet'), h('button', { type: 'button', class: 'danger quiet' }, icon('trash'), 'Remove'), h('button', { type: 'button', class: 'link-button' }, 'Link button')),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'button-coral' }, 'Coral'), h('button', { type: 'button', class: 'button-mint' }, 'Mint'), h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Search' }, icon('search')), h('button', { type: 'button', class: 'icon-button big', 'aria-label': 'Close' }, icon('close'))),
    h('div', { class: 'row' }, link({ screen: 'home' }, 'Back to songs', { class: 'back-link' })),
    h('div', { class: 'paper sg-paper row' }, h('button', { type: 'button', class: 'primary' }, 'On paper'), h('button', { type: 'button' }, 'Secondary'), h('button', { type: 'button', class: 'quiet' }, 'Quiet')),
  );

  const icons = h('div', { class: 'sg-icons' }, ...ICON_NAMES.map((name) => h('div', { class: 'sg-icon' }, icon(name), code(name))));

  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Example' }, ...['Listen', 'Learn', 'Play along'].map((t, i) => h('button', { type: 'button', 'aria-pressed': String(i === 1) }, t)));
  for (const b of seg.querySelectorAll('button')) b.addEventListener('click', () => seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))));
  const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Chips' }, ...['All', 'Children', 'Classical', 'Holiday'].map((t, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(i === 0) }, t)));
  for (const b of chips.querySelectorAll('button')) b.addEventListener('click', () => chips.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))));

  const controls = h(
    'div',
    { class: 'sg-grid' },
    h('div', { class: 'field' }, h('label', { for: 'sg-text' }, 'Text field'), h('input', { type: 'text', id: 'sg-text', placeholder: 'Type here' }), h('p', { class: 'hint' }, 'A short hint.')),
    h('div', { class: 'field' }, h('label', { for: 'sg-select' }, 'Select'), h('select', { id: 'sg-select' }, h('option', {}, 'Melody only'), h('option', {}, 'Everything'))),
    h('div', { class: 'field' }, h('label', { for: 'sg-range' }, 'Slider'), h('input', { type: 'range', id: 'sg-range', min: 0, max: 100, value: 60 })),
    h('label', { class: 'toggle' }, 'Toggle', h('input', { type: 'checkbox', role: 'switch', checked: true })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true }), 'Checkbox'),
    h('label', { class: 'check' }, h('input', { type: 'radio', name: 'sg-r', checked: true }), 'Radio'),
    h('div', { class: 'field' }, h('span', {}, 'Segmented'), seg),
    h('div', { class: 'field' }, h('span', {}, 'Chips'), chips),
  );

  const progress = h(
    'div',
    { class: 'sg-row' },
    h('div', { class: 'sg-progress' }, h('progress', { max: 1, value: 0.4, 'aria-label': 'Progress bar' }), h('div', { class: 'meter-bar', role: 'progressbar', 'aria-label': 'Meter bar', 'aria-valuemin': 0, 'aria-valuemax': 10, 'aria-valuenow': 7 }, h('span', { style: 'width: 70%' }))),
    h('div', { class: 'ring', style: '--value: 0.25', role: 'img', 'aria-label': '10 of 40 lessons' }, h('span', {}, '10')),
    h('div', { class: 'ring', style: '--value: 0.7; --size: 104px; --fill: var(--mint)', role: 'img', 'aria-label': '70 percent' }, h('span', {}, '70%')),
    h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' }),
    h('div', { class: 'skeleton sg-skeleton' }),
  );

  const badges = h(
    'div',
    { class: 'sg-stack' },
    h('div', { class: 'row' }, h('span', { class: 'badge' }, 'Badge'), h('span', { class: 'badge badge-sun' }, icon('sun'), '3 days in a row'), h('span', { class: 'badge badge-coral' }, 'New'), h('span', { class: 'badge badge-mint' }, icon('check'), 'Done'), h('span', { class: 'badge badge-cream' }, 'Cream')),
    h('div', { class: 'row' }, h('span', { class: 'tag' }, 'tag (old)'), h('span', { class: 'tag tag-good' }, 'tag-good'), h('span', { class: 'tag tag-warm' }, 'tag-warm'), h('span', { class: 'tag tag-accent' }, 'tag-accent')),
    h('div', { class: 'row' }, starRating(0), starRating(2), starRating(3), starRating(3, true), starsBadge(2)),
    h('div', { class: 'row' }, levelBadge(2), levelDots(1), levelDots(3), levelDots(5)),
  );

  const cards = h(
    'div',
    { class: 'sg-stack' },
    h('div', { class: 'card' }, h('h3', {}, 'card'), h('p', { class: 'muted' }, 'The everyday panel on the ocean.')),
    h(
      'div',
      { class: 'sg-bigcards' },
      ...(['fill-sun', 'fill-coral', 'fill-mint', 'fill-sky', 'fill-paper', 'fill-ocean'] as const).map((fill) =>
        h('div', { class: `bigcard ${fill}` }, h('p', { class: 'kicker' }, 'bigcard'), h('h3', {}, fill), h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary' }, 'Go'))),
      ),
    ),
  );

  const covers = h(
    'div',
    { class: 'sg-covers' },
    ...SAMPLE_SONGS.map((s) => h('figure', { class: 'sg-cover' }, songCover(s, 'sg-cover-art'), h('figcaption', {}, coverStyle(s)))),
  );
  const units = h('div', { class: 'sg-units' }, ...Array.from({ length: 9 }, (_, i) => h('figure', { class: 'sg-unit' }, unitArt(i, 'sg-unit-art'), h('figcaption', {}, `Unit ${i + 1}`))));
  const characters = h(
    'div',
    { class: 'sg-row' },
    mascot('happy', 'sg-mascot'),
    mascot('cheer', 'sg-mascot'),
    mascot('curious', 'sg-mascot'),
    illustration('usb-piano', 'sg-illustration'),
    illustration('computer', 'sg-illustration'),
    illustration('acoustic', 'sg-illustration'),
    illustration('songs', 'sg-illustration'),
    illustration('connected', 'sg-illustration'),
  );

  const notices = h(
    'div',
    { class: 'sg-grid' },
    notice('empty', 'No songs yet', 'Add one and it shows up here.', h('button', { type: 'button', class: 'primary' }, 'Add a song')),
    notice('loading', 'Getting the songs ready...'),
    notice('error', 'That did not work', 'Check your connection and try again.', h('button', { type: 'button', class: 'primary' }, 'Try again')),
    notice('info', 'Good to know', 'Info notices use the same shape.'),
  );

  const openButton = h('button', { type: 'button', class: 'primary' }, 'Open a sheet');
  openButton.addEventListener('click', () => {
    const sheet = openSheet({
      labelledBy: 'sg-sheet-title',
      content: [
        h('h2', { id: 'sg-sheet-title' }, 'A sheet'),
        h('p', {}, 'Centred on wide screens, from the bottom on phones. Escape closes it.'),
        (() => {
          const b = h('button', { type: 'button', class: 'primary big wide' }, 'Got it');
          b.addEventListener('click', () => sheet.close());
          return b;
        })(),
      ],
    });
  });
  const toastButton = h('button', { type: 'button' }, 'Show a toast');
  toastButton.addEventListener('click', () => toast('Song added!'));
  const errorToast = h('button', { type: 'button' }, 'Error toast');
  errorToast.addEventListener('click', () => toast('That file did not work.', { kind: 'error' }));
  const burst = h('button', { type: 'button', class: 'button-coral' }, 'Celebrate!');
  burst.addEventListener('click', () => celebrate(burst));

  const shelfDemo = shelf({ id: 'sg-demo', title: 'A shelf of picture cards', count: String(SAMPLE_SONGS.length), items: SAMPLE_SONGS.map((s, i) => sampleCard(s, i % 4)) });

  container.append(
    appBar('Style guide'),
    h('p', { class: 'lead' }, 'Every token and component, live. Read docs/design.md for when to use each.'),
    section('colours', 'Colour', swatches),
    section('type', 'Type: Fredoka and Atkinson Hyperlegible', type),
    section('buttons', 'Buttons', buttons),
    section('icons', 'Icons', icons),
    section('controls', 'Form controls', controls),
    section('progress', 'Progress and loading', progress),
    section('badges', 'Badges, stars and levels', badges),
    section('cards', 'Cards', cards),
    shelfDemo,
    section('covers', 'Song covers (generated)', covers),
    section('units', 'Course unit art', units),
    section('characters', 'Mascot and illustrations', characters),
    section('notices', 'Empty, loading and error', notices),
    section('overlays', 'Sheets, toasts and celebrations', h('div', { class: 'row' }, openButton, toastButton, errorToast, burst)),
  );
  return () => {};
}
