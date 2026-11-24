import { h } from '../app/dom';
import { icon } from './icons';

/**
 * A shelf: a titled row of big cards that scrolls sideways.
 * - Touch: swipe (native scrolling, with gentle snapping).
 * - Mouse: drag the row, or use the round arrow buttons in the heading.
 * - Keyboard: Tab reaches each card; Left and Right arrows move between cards,
 *   Home and End jump to the ends.
 * Each item should hold exactly one focusable control (a picture card does).
 */

export interface ShelfOptions {
  id: string;
  title: string;
  items: HTMLElement[];
  /** Shown after the title, e.g. the number of songs. */
  count?: string;
  /** Extra things at the end of the heading row (a "See all" link). */
  extra?: Node | null;
}

function focusable(li: Element | null | undefined): HTMLElement | null {
  return li?.querySelector<HTMLElement>('button, a[href], [tabindex="0"]') ?? null;
}

export function shelf(options: ShelfOptions): HTMLElement {
  const headingId = `shelf-${options.id}`;
  const track = h('ul', { class: 'shelf-track', 'aria-labelledby': headingId }, ...options.items.map((item) => h('li', {}, item)));
  const prev = h('button', { type: 'button', class: 'icon-button shelf-prev', 'aria-label': `Scroll ${options.title} back` }, icon('back'));
  const next = h('button', { type: 'button', class: 'icon-button shelf-next', 'aria-label': `Scroll ${options.title} on` }, icon('forward'));
  // The arrows are a mouse convenience; keyboard users move with the arrow keys inside the row.
  prev.tabIndex = -1;
  next.tabIndex = -1;
  const arrows = h('div', { class: 'shelf-arrows' }, prev, next);
  const section = h(
    'section',
    { class: 'shelf', 'aria-labelledby': headingId, 'data-shelf': options.id },
    h(
      'div',
      { class: 'shelf-head' },
      h('h2', { class: 'shelf-title', id: headingId }, options.title, options.count ? h('span', { class: 'shelf-count' }, ` ${options.count}`) : null),
      options.extra ?? null,
      arrows,
    ),
    track,
  );

  const page = (dir: 1 | -1): void => {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: dir * Math.max(200, track.clientWidth * 0.8), behavior: smooth ? 'smooth' : 'auto' });
  };
  prev.addEventListener('click', () => page(-1));
  next.addEventListener('click', () => page(1));

  const updateArrows = (): void => {
    const max = track.scrollWidth - track.clientWidth;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= max - 2;
    arrows.hidden = max <= 2;
  };
  track.addEventListener('scroll', updateArrows, { passive: true });
  // Sizes are only known once the shelf is on the page.
  requestAnimationFrame(updateArrows);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => requestAnimationFrame(updateArrows)).observe(track);

  track.addEventListener('keydown', (e) => {
    const current = (e.target as HTMLElement).closest('li');
    if (!current || current.parentElement !== track) return;
    let target: Element | null = null;
    if (e.key === 'ArrowRight') target = current.nextElementSibling;
    else if (e.key === 'ArrowLeft') target = current.previousElementSibling;
    else if (e.key === 'Home') target = track.firstElementChild;
    else if (e.key === 'End') target = track.lastElementChild;
    else return;
    const el = focusable(target);
    if (!el) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    (target as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // Drag to scroll with a mouse. A drag never counts as a click on the card under it.
  let startX = 0;
  let startScroll = 0;
  let dragging = false;
  let moved = false;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    startX = e.clientX;
    startScroll = track.scrollLeft;
    dragging = true;
    moved = false;
  });
  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6) {
      moved = true;
      track.classList.add('is-dragging');
      track.setPointerCapture(e.pointerId);
    }
    if (moved) track.scrollLeft = startScroll - dx;
  });
  const end = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('is-dragging');
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener(
    'click',
    (e) => {
      if (!moved) return;
      moved = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  return section;
}
