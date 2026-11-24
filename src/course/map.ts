import type { AppContext } from '../app/context';
import { appBar, h, link, starRating, starsBadge } from '../app/dom';
import { getStreak, localDay, type Streak } from '../app/progress';
import type { Cleanup } from '../app/screens';
import { unitArt } from '../ui/cover-art';
import { icon } from '../ui/icons';
import { mascot } from '../ui/mascot';
import { allLessons, COURSE, minutesFor } from './curriculum';
import { continueLesson, courseProgress, emptyProgress, isUnlocked, loadProgress, unitProgress, type CourseProgress } from './progress';
import type { Lesson, Unit } from './types';

export function starText(count: number): HTMLElement {
  return starsBadge(count);
}

/** The stored streak only counts while the last practice was today or yesterday. */
export function liveStreak(streak: Streak | null, now = new Date()): number {
  if (!streak) return 0;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return streak.lastDay === localDay(now) || streak.lastDay === localDay(yesterday) ? streak.current : 0;
}

// ---------------------------------------------------------------------------
// Trail maths. The map is a winding path of stepping stones. Each unit draws
// its own stretch of path in a box that is 0..100 wide (percent of the column)
// and as tall as its stones need, in CSS pixels. The path enters at the top
// middle (under the unit card) and leaves at the bottom middle, so the
// stretches join into one trail down the page.
// ---------------------------------------------------------------------------

export interface TrailPoint {
  /** Percent of the column width, 0..100. */
  x: number;
  /** CSS pixels from the top of the unit's stretch. */
  y: number;
}

export const TRAIL = {
  /** Space from one stone to the next, in px. */
  row: 132,
  /** Space above the first stone and below the last one, in px. */
  top: 92,
  bottom: 84,
  /** How far stones swing from the middle, in percent of the width. */
  amplitude: 27,
  /** How quickly the path winds from one stone to the next (radians). */
  step: 1.05,
} as const;

/** Where stone number `i` (counted across the whole course) sits across the column: a gentle wave around the middle. */
export function stoneX(i: number, amplitude: number = TRAIL.amplitude): number {
  return Math.round((50 + amplitude * Math.sin(i * TRAIL.step + 0.5)) * 10) / 10;
}

/** Stones for one unit: `first` is the course index of its first lesson. */
export function trailLayout(first: number, count: number, o: { row: number; top: number; bottom: number; amplitude: number } = TRAIL): { points: TrailPoint[]; height: number } {
  const points = Array.from({ length: count }, (_, k) => ({ x: stoneX(first + k, o.amplitude), y: o.top + k * o.row }));
  const height = count > 0 ? o.top + (count - 1) * o.row + o.bottom : o.top + o.bottom;
  return { points, height };
}

/** A smooth SVG path through the points: each hop is an S-curve leaving and arriving straight down. */
export function trailPath(points: readonly TrailPoint[]): string {
  if (points.length === 0) return '';
  const f = (n: number) => String(Math.round(n * 10) / 10);
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const m = (b.y - a.y) / 2;
    d += ` C${f(a.x)} ${f(a.y + m)} ${f(b.x)} ${f(b.y - m)} ${f(b.x)} ${f(b.y)}`;
  }
  return d;
}

/** Which side of a stone its words go: towards the roomier half of the column. */
export function labelSide(x: number): 'left' | 'right' {
  return x > 54 ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

type StoneState = 'done' | 'skipped' | 'next' | 'open' | 'later';

const SVG_NS = 'http://www.w3.org/2000/svg';

function stoneState(lesson: Lesson, p: CourseProgress, next: Lesson | undefined): StoneState {
  if (p.completed.has(lesson.id)) return 'done';
  if (next?.id === lesson.id) return 'next';
  if (p.skipped.has(lesson.id)) return 'skipped';
  return isUnlocked(lesson.id, p) ? 'open' : 'later';
}

function stone(lesson: Lesson, number: number, at: TrailPoint, p: CourseProgress, next: Lesson | undefined): HTMLElement {
  const state = stoneState(lesson, p, next);
  const piece = Boolean(lesson.piece);
  const side = labelSide(at.x);
  const stars = p.stars.get(lesson.id) ?? 0;
  const disc = h('span', { class: 'cm-disc', 'aria-hidden': 'true' });
  if (state === 'done') disc.append(piece ? icon('songs') : icon('check'));
  else if (state === 'skipped') disc.append(icon('forward'));
  else if (state === 'next') disc.append(icon('play'));
  else if (piece) disc.append(icon('songs'));
  else disc.append(h('span', { class: 'cm-num' }, String(number)));

  // The small words under the title, which the name repeats (so what is said matches what is shown).
  const tag = state === 'next' ? 'Up next' : state === 'skipped' ? 'Skipped' : piece ? 'Piece' : `${minutesFor(lesson)} min`;
  const status =
    state === 'done'
      ? starRating(stars)
      : state === 'next' || (piece && state !== 'skipped')
        ? h('span', { class: `badge ${state === 'next' ? 'badge-sun' : 'badge-coral'} cm-pill` }, tag)
        : h('span', { class: 'cm-tag' }, tag);
  const said = state === 'done' ? `${stars} of 3 stars` : state === 'open' || state === 'later' ? `${tag}. ${state === 'open' ? 'Open' : 'Later'}` : tag;

  // One clear name, starting with the words on screen: "Lesson 3: F, G, A, B. Up next".
  const name = `Lesson ${number}${piece ? ', a piece to play' : ''}: ${lesson.title}. ${said}`;
  const a = link({ screen: 'course', lessonId: lesson.id }, '', { class: 'cm-stone', 'data-lesson': lesson.id, 'aria-label': name });
  // The space keeps the title and the tag apart as words (flex layout hides it on screen).
  a.append(disc, ' ', h('span', { class: 'cm-words' }, h('span', { class: 'cm-name' }, lesson.title), ' ', status));
  const li = h(
    'li',
    { class: `cm-spot is-${state}${piece ? ' is-piece' : ''} label-${side}`, style: `left: ${at.x}%; top: ${at.y}px` },
    a,
  );
  if (state === 'next') li.append(mascot('happy', 'cm-buddy is-bobbing'));
  return li;
}

const FILLS = ['fill-sky', 'fill-coral', 'fill-mint', 'fill-sun'] as const;

function unitSection(unit: Unit, index: number, start: number, p: CourseProgress, next: Lesson | undefined): HTMLElement {
  const { done, total } = unitProgress(unit, p);
  const complete = done === total;
  const current = next ? unit.lessons.some((l) => l.id === next.id) : false;
  const headingId = `unit-${unit.id}`;
  const { points, height } = trailLayout(start, unit.lessons.length);

  // The trail: a soft dotted path, with the stretch already walked painted sun.
  const top = { x: 50, y: 0 };
  const bottom = { x: 50, y: height };
  let reached = -1;
  unit.lessons.forEach((l, k) => {
    if (p.completed.has(l.id) || p.skipped.has(l.id)) reached = k;
  });
  const walked = reached < 0 ? [] : reached === unit.lessons.length - 1 ? [top, ...points, bottom] : [top, ...points.slice(0, reached + 1)];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'cm-trail-line');
  svg.setAttribute('viewBox', `0 0 100 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [cls, list] of [
    ['cm-path', [top, ...points, bottom]],
    ['cm-path-walked', walked],
  ] as const) {
    if (list.length < 2) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', trailPath(list));
    path.setAttribute('class', cls);
    svg.append(path);
  }

  const card = h(
    'header',
    { class: `cm-unit-card ${FILLS[index % FILLS.length]}` },
    unitArt(index, 'cm-unit-art'),
    h(
      'div',
      { class: 'cm-unit-text' },
      h('p', { class: 'cm-unit-kicker' }, `Unit ${index + 1}`, complete ? h('span', { class: 'badge badge-cream cm-unit-done' }, icon('star'), 'Complete') : null),
      h('h2', { id: headingId }, h('span', { class: 'visually-hidden' }, `Unit ${index + 1}: `), unit.title),
      h('p', { class: 'cm-unit-blurb' }, unit.blurb),
      h(
        'div',
        { class: 'cm-unit-meter meter-bar', role: 'progressbar', 'aria-label': `${unit.title}: lessons done`, 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
        h('span', { style: `width: ${Math.round((done / total) * 100)}%` }),
      ),
    ),
  );

  return h(
    'section',
    { class: `cm-unit${complete ? ' is-complete' : ''}${current ? ' is-current' : ''}`, 'aria-labelledby': headingId },
    card,
    h(
      'div',
      { class: 'cm-trail', style: `height: ${height}px` },
      svg,
      h('ol', { class: 'cm-stones', start: start + 1 }, ...unit.lessons.map((l, k) => stone(l, start + k + 1, points[k], p, next))),
    ),
  );
}

/** #/course: the course as a winding map of lessons, with one big way to carry on. */
export function mountMap(container: HTMLElement, ctx: AppContext): Cleanup {
  let alive = true;
  const calm = ctx.settings.get().reduceMotion;
  container.classList.add('is-map');
  const side = h('aside', { class: 'cm-side bigcard fill-sun', 'aria-label': 'Your progress' });
  const map = h('div', { class: `cm-map${calm ? ' reduce-motion' : ''}` });
  const float = h('div', { class: 'cm-float', hidden: true });
  // The heading comes first and takes focus on arrival, so the side card's big Start/Continue
  // button is the very next Tab stop, before the 40 lesson stones (course.css places the columns).
  container.append(h('div', { class: 'cm-layout' }, h('div', { class: 'cm-head' }, appBar(COURSE.title)), side, h('div', { class: 'cm-main' }, map)), float);

  // Arrow keys walk along the stones; Home and End jump to the ends.
  map.addEventListener('keydown', (e) => {
    const from = (e.target as HTMLElement).closest('.cm-stone');
    if (!from) return;
    const stones = [...map.querySelectorAll<HTMLElement>('.cm-stone')];
    const i = stones.indexOf(from as HTMLElement);
    const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? stones.length - 1 : -2;
    if (to === -2) return;
    e.preventDefault();
    stones[Math.max(0, Math.min(stones.length - 1, to))]?.focus();
  });

  let observer: IntersectionObserver | null = null;

  function render(p: CourseProgress, streak: Streak | null, loaded: boolean): void {
    const resume = continueLesson(p);
    const totals = courseProgress(p);
    const fresh = totals.done === 0 && p.skipped.size === 0 && !p.lastLessonId;
    const allDone = !resume;
    const lessons = allLessons();
    const target = resume ?? lessons[lessons.length - 1];
    const unitIndex = Math.max(0, COURSE.units.findIndex((u) => u.lessons.includes(target)));
    const days = liveStreak(streak);
    const goText = allDone ? 'Play again' : fresh ? 'Start' : 'Continue';

    const go = link({ screen: 'course', lessonId: target.id }, '', { class: 'button primary big wide cm-go', 'aria-label': `${goText}: ${target.title}` });
    go.append(icon('play'), h('span', {}, goText));

    side.replaceChildren(
      h(
        'div',
        { class: 'cm-hello' },
        mascot(allDone ? 'cheer' : 'happy', calm ? 'cm-hello-mascot' : 'cm-hello-mascot is-bobbing'),
        h('p', { class: 'cm-hello-text' }, allDone ? 'You did it all!' : fresh ? 'Ready to begin?' : 'Welcome back!'),
      ),
      h(
        'div',
        { class: 'cm-next' },
        unitArt(unitIndex, 'cm-next-art'),
        h(
          'div',
          { class: 'cm-next-words' },
          h('p', { class: 'cm-next-kicker' }, allDone ? 'Course complete' : `Up next · Lesson ${lessons.indexOf(target) + 1}`),
          h('p', { class: 'cm-next-title' }, target.title),
          h('p', { class: 'cm-next-meta' }, target.piece ? 'A piece to play' : `About ${minutesFor(target)} min`),
        ),
      ),
      go,
      h(
        'div',
        { class: 'cm-stats' },
        h(
          'div',
          { class: 'cm-ring-box' },
          h('div', { class: 'ring cm-ring', style: `--value: ${totals.done / totals.total}`, role: 'img', 'aria-label': `${totals.done} of ${totals.total} lessons done` }, h('span', {}, String(totals.done))),
          h('span', { class: 'cm-ring-words', 'aria-hidden': 'true' }, `of ${totals.total}`, h('br', {}), 'lessons'),
        ),
        h(
          'div',
          { class: 'cm-badges' },
          days > 0 ? h('span', { class: 'badge badge-sun' }, icon('sun'), `${days} ${days === 1 ? 'day' : 'days'} in a row`) : null,
          h('span', { class: 'badge badge-cream' }, icon('star'), `${totals.stars} stars`),
        ),
      ),
    );

    const floatGo = link({ screen: 'course', lessonId: target.id }, '', { class: 'button primary big cm-float-go', 'aria-label': `${goText}: ${target.title}` });
    floatGo.append(icon('play'), h('span', {}, goText));
    float.replaceChildren(floatGo);

    let start = 0;
    const sections = COURSE.units.map((u, i) => {
      const s = unitSection(u, i, start, p, resume);
      start += u.lessons.length;
      return s;
    });
    map.replaceChildren(
      ...(ctx.store.persistent ? [] : [h('p', { class: 'cm-note' }, 'This window cannot save. Your progress will be gone when you close it.')]),
      ...sections,
      h(
        'div',
        { class: `cm-goal${allDone ? ' is-done' : ''}` },
        h('span', { class: 'cm-goal-medal', 'aria-hidden': 'true' }, icon('star')),
        h('p', {}, allDone ? 'You finished the whole course!' : 'The finish line'),
      ),
    );

    // A second "Continue" floats in when the first one scrolls away (narrow screens only, see course.css).
    observer?.disconnect();
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(([entry]) => {
        const away = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        float.hidden = !away;
      });
      observer.observe(go);
    }

    if (loaded && !fresh && !allDone) {
      const here = map.querySelector<HTMLElement>('.cm-spot.is-next') ?? map.querySelector<HTMLElement>(`[data-lesson="${target.id}"]`);
      requestAnimationFrame(() => here?.scrollIntoView({ block: 'center', behavior: calm || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    }
  }

  render(emptyProgress(), null, false);
  void Promise.all([loadProgress(ctx.store), getStreak(ctx.store).catch(() => null)]).then(([p, streak]) => {
    if (alive) render(p, streak, true);
  });

  return () => {
    alive = false;
    observer?.disconnect();
  };
}
