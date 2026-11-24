import type { Difficulty } from '../song';
import { DIFFICULTY_WORD } from './words';
import { href, type Route } from './router';

export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined>;

/**
 * Creates an element. Attributes go through setAttribute (true sets an empty
 * attribute; false, null and undefined are skipped). Strings become text, so
 * untrusted text is always safe here.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

/** A link to another screen. */
export function link(route: Route, text: string, attrs: Attrs = {}): HTMLAnchorElement {
  return h('a', { ...attrs, href: href(route) }, text);
}

export interface AppBarOptions {
  /** The home screen: the heading is drawn by the screen itself, so this one is for screen readers only. */
  home?: boolean;
  /** The one clear way back (a round sun button with words), e.g. back to the course map from a lesson. */
  back?: { route: Route; label: string };
  /** Extra elements shown at the end of the heading row (e.g. a screen's main action). */
  actions?: Node[];
}

/**
 * The top of a screen: an optional back button, the screen heading (the
 * page's only h1) and optional actions. The main navigation is no longer part
 * of it: the shell draws the icon rail or tab bar once (src/ui/nav.ts).
 * The name stays `appBar` so every screen keeps working.
 */
export function appBar(title: string, options: AppBarOptions = {}): HTMLElement {
  const head = h(
    'div',
    { class: options.home ? 'page-head page-head-home' : 'page-head' },
    options.back ? link(options.back.route, options.back.label, { class: 'back-link' }) : null,
    h('h1', { class: options.home ? 'visually-hidden' : 'page-title' }, title),
    options.actions?.length ? h('div', { class: 'page-actions' }, ...options.actions) : null,
  );
  return h('div', { class: 'page-top' }, head);
}

/** The app's mark: three piano keys on a sun tile, drawn inline so it needs no file. */
export function logo(size = 22): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'logo');
  const parts: [string, Record<string, string>][] = [
    ['rect', { x: '1', y: '1', width: '22', height: '22', rx: '7', class: 'logo-bg' }],
    ['rect', { x: '4.5', y: '5.5', width: '15', height: '13', rx: '3', class: 'logo-key', stroke: '#10304a', 'stroke-width': '1.5' }],
    ['path', { d: 'M9.5 12v6.5M14.5 12v6.5', stroke: '#10304a', 'stroke-width': '1.5' }],
    ['rect', { x: '8', y: '5.5', width: '3', height: '7', rx: '1.2', class: 'logo-black' }],
    ['rect', { x: '13', y: '5.5', width: '3', height: '7', rx: '1.2', class: 'logo-black' }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/**
 * A friendly message block for empty, loading and error states, so every
 * screen says these things the same way. `kind` sets the colour; `role`
 * makes errors and loading announce themselves.
 */
export function notice(kind: 'empty' | 'loading' | 'error' | 'info', title: string, text?: string, ...actions: Node[]): HTMLElement {
  return h(
    'div',
    { class: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : null },
    kind === 'loading' ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
    h('p', { class: 'notice-title' }, title),
    text ? h('p', { class: 'notice-text' }, text) : null,
    actions.length ? h('div', { class: 'notice-actions' }, ...actions) : null,
  );
}

/** How long to wait for a file after the picker closed, before calling it cancelled. */
export const PICK_SETTLE_MS = 1500;

/**
 * Opens a file picker from a real button press. Resolves with the file, or
 * null when cancelled. Older WebKit never fires `cancel`, so the page getting
 * focus back with no file after a short wait also counts as cancelled: the
 * caller is never left waiting.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    let settled = false;
    let timer = 0;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      input.remove();
      resolve(file);
    };
    const onFocus = (): void => {
      window.clearTimeout(timer);
      // The change event can arrive a moment after focus (Safari), so wait before giving up.
      timer = window.setTimeout(() => finish(input.files?.[0] ?? null), PICK_SETTLE_MS);
    };
    // Focus going away again means the picker is (still) open: keep waiting.
    const onBlur = (): void => window.clearTimeout(timer);
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
    // Listen only after the picker had its chance to take focus away.
    window.setTimeout(() => {
      if (settled) return;
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
    }, 0);
  });
}

/** How long a download's address stays valid. The iPad/iPhone app saves downloads in the background. */
export const DOWNLOAD_KEEP_MS = 30_000;

/** Downloads text as a file. */
export function download(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_KEEP_MS);
}

/** "Level 2 · Easy" with five little bars, the same on every screen. */
export function levelBadge(d: Difficulty): HTMLElement {
  const bars = h('span', { class: 'level-bars', 'aria-hidden': 'true' });
  for (let i = 1; i <= 5; i++) bars.append(h('i', { class: i <= d ? 'on' : '' }));
  return h('span', { class: 'level', title: `Level ${d} of 5` }, bars, h('span', {}, `Level ${d} · ${DIFFICULTY_WORD[d]}`));
}

/** Earned stars out of three, readable by screen readers. */
export function starsBadge(count: number): HTMLElement {
  const n = Math.max(0, Math.min(3, Math.round(count)));
  return h('span', { class: 'stars', role: 'img', 'aria-label': `${n} of 3 stars` }, '★'.repeat(n) + '☆'.repeat(3 - n));
}

/** Level as five dots (compact, for picture cards), with the words for screen readers. */
export function levelDots(d: Difficulty): HTMLElement {
  const dots = h('span', { class: 'level-dots', role: 'img', 'aria-label': `Level ${d} of 5, ${DIFFICULTY_WORD[d]}`, title: `Level ${d} · ${DIFFICULTY_WORD[d]}` });
  for (let i = 1; i <= 5; i++) dots.append(h('i', { class: i <= d ? 'on' : '' }));
  return dots;
}

const STAR_PATH = 'M12 2.8l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.7l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8z';

/** Earned stars out of three, drawn as shapes. `big` for results and celebrations. */
export function starRating(count: number, big = false): HTMLElement {
  const n = Math.max(0, Math.min(3, Math.round(count)));
  const box = h('span', { class: big ? 'star-rating big' : 'star-rating', role: 'img', 'aria-label': `${n} of 3 stars` });
  for (let i = 0; i < 3; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (i < n) svg.setAttribute('class', 'on');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', STAR_PATH);
    svg.append(path);
    box.append(svg);
  }
  return box;
}

/**
 * Makes a click anywhere on a picture card open it. The card's button already
 * stretches over the card with CSS, but Safari gives a click on that stretched
 * area to the card instead of the button, so nothing would happen there.
 * Call once at startup.
 */
export function installCardClicks(root: Document = document): void {
  root.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const card = target?.closest('.pcard');
    if (!card || target?.closest('button, a, input, select, label')) return;
    const open = card.querySelector<HTMLElement>('.pcard-open');
    // Focus it first, as Chrome does, so a sheet it opens hands focus back to this card when it closes.
    open?.focus({ preventScroll: true });
    open?.click();
  });
}
