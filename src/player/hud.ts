import { h } from '../app/dom';
import { formatTime } from './practice';
import { ScoreKeeper } from './scoring';
import type { Session } from './session';
import type { FrameState } from './view';

/** Score, combo and progress shown with the stage. Lives in its own container above the stage. */
export interface Hud {
  /** Called every frame. Keep DOM writes cheap: only touch what changed. */
  update(frame: FrameState): void;
  destroy(): void;
  /** The score keeper this HUD shows. */
  readonly keeper?: ScoreKeeper;
}

const MULTIPLIER_WORDS: Record<number, string> = { 2: 'Double points!', 3: 'Triple points!', 4: 'Four times the points!' };

const SEEK_KEYS: Record<string, number> = { ArrowLeft: -5, ArrowRight: 5, PageDown: -15, PageUp: 15 };

/**
 * The slim strip across the top of the stage: the whole song as a thin bar
 * you can drag to move around (with marks where mistakes happened and the
 * loop shaded), the time, a compact score and combo, and big encouraging
 * words for the moments worth cheering.
 * Pass a ScoreKeeper to share it with the rest of the screen; without one
 * the HUD makes its own.
 */
export function createHud(container: HTMLElement, session: Session, sharedKeeper?: ScoreKeeper): Hud {
  const keeper = sharedKeeper ?? new ScoreKeeper(session);

  const marks = h('canvas', { class: 'hud-marks', 'aria-hidden': 'true' });
  const loopBox = h('div', { class: 'hud-loop', hidden: true });
  const fill = h('div', { class: 'hud-fill' });
  const thumb = h('div', { class: 'hud-thumb' });
  const track = h(
    'div',
    {
      class: 'hud-track',
      role: 'slider',
      tabindex: 0,
      'aria-label': 'Song position. Drag or use the arrow keys to move around the song',
      'aria-valuemin': 0,
      'aria-valuemax': 0,
      'aria-valuenow': 0,
    },
    marks,
    loopBox,
    fill,
    thumb,
  );
  const score = h('span', { class: 'hud-value' }, '0');
  const combo = h('span', { class: 'hud-value' }, '0');
  const multi = h('span', { class: 'hud-multi', 'data-level': '1' }, 'x1');
  const acc = h('span', { class: 'hud-value' }, '100%');
  const clock = h('span', { class: 'hud-clock' }, '0:00');
  const callout = h('div', { class: 'hud-callout', 'aria-hidden': 'true' });
  const progress = h('div', { class: 'hud-progress' }, track, h('div', { class: 'hud-time' }, h('span', { class: 'visually-hidden' }, 'Time '), clock));
  const stats = h(
    'div',
    { class: 'hud-row' },
    h('div', { class: 'hud-stat hud-score' }, score, h('span', { class: 'hud-label' }, 'points')),
    h('div', { class: 'hud-stat hud-combo' }, h('span', { class: 'hud-combo-line' }, combo, multi), h('span', { class: 'hud-label' }, 'in a row')),
    h('div', { class: 'hud-stat hud-acc' }, acc, h('span', { class: 'hud-label' }, 'right')),
    callout,
  );
  container.append(progress, stats);

  let shown = { score: -1, combo: -1, multi: -1, acc: -1, clock: '', pos: -1, len: -1, mode: '', loop: '' };
  let marksDirty = true;
  let length = 0;
  let calloutTimer = 0;
  let lastMultiplier = 1;

  function say(text: string, kind: 'big' | 'soft' = 'big'): void {
    callout.textContent = text;
    callout.dataset.kind = kind;
    callout.classList.remove('is-on');
    void callout.offsetWidth; // restart the animation
    callout.classList.add('is-on');
    window.clearTimeout(calloutTimer);
    calloutTimer = window.setTimeout(() => callout.classList.remove('is-on'), 1800);
  }

  const offs: (() => void)[] = [
    keeper.onScore((e, cleared) => {
      marksDirty = true;
      if (cleared) {
        lastMultiplier = 1;
        callout.classList.remove('is-on');
        return;
      }
      const m = keeper.scorer.multiplier;
      if (e.callout) say(e.callout, e.kind === 'hit' ? 'big' : 'soft');
      else if (m > lastMultiplier) say(MULTIPLIER_WORDS[m] ?? `${m} times the points!`);
      lastMultiplier = m;
    }),
    session.on('reset', () => {
      shown = { ...shown, pos: -1, len: -1, loop: '' };
      marksDirty = true;
    }),
    session.on('looping', () => (shown.loop = '?')),
  ];

  // ---- Seeking by dragging or keys ----
  let dragging: { pointer: number; wasRunning: boolean } | null = null;
  let pendingSeek: number | null = null;
  const timeAt = (clientX: number) => {
    const r = track.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * length : 0;
  };
  const onDown = (e: PointerEvent) => {
    if (length <= 0 || e.button > 0) return;
    track.setPointerCapture?.(e.pointerId);
    dragging = { pointer: e.pointerId, wasRunning: session.running };
    session.pause();
    track.classList.add('is-dragging');
    pendingSeek = timeAt(e.clientX);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (dragging?.pointer === e.pointerId) pendingSeek = timeAt(e.clientX);
  };
  const onUp = (e: PointerEvent) => {
    if (dragging?.pointer !== e.pointerId) return;
    const resume = dragging.wasRunning;
    dragging = null;
    track.classList.remove('is-dragging');
    if (pendingSeek !== null) session.seek(pendingSeek);
    pendingSeek = null;
    if (resume) session.start();
  };
  const onKey = (e: KeyboardEvent) => {
    let to: number | null = null;
    if (e.key in SEEK_KEYS) to = Math.max(0, session.game.time) + SEEK_KEYS[e.key] * Math.max(0.5, session.options.speed);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = Math.max(0, length - 2);
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    session.seek(Math.max(0, Math.min(length, to)));
  };
  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  track.addEventListener('pointercancel', onUp);
  track.addEventListener('keydown', onKey);

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => (marksDirty = true));
  observer?.observe(track);

  function drawMarks(): void {
    marksDirty = false;
    const r = track.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * ratio));
    const hgt = Math.max(1, Math.round(r.height * ratio));
    if (marks.width !== w || marks.height !== hgt) {
      marks.width = w;
      marks.height = hgt;
    }
    const g = marks.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, hgt);
    if (length <= 0) return;
    for (const m of keeper.mistakes) {
      const x = Math.round((Math.min(length, Math.max(0, m.time)) / length) * w);
      g.fillStyle = m.kind === 'timing' ? 'rgba(143, 211, 255, 0.9)' : 'rgba(255, 125, 110, 0.95)';
      g.fillRect(x - ratio, 0, Math.max(2, 2 * ratio), hgt);
    }
  }

  return {
    keeper,
    update(f) {
      length = f.length;
      if (pendingSeek !== null && dragging) {
        // While dragging, show the spot under the finger; seek once per frame at most.
        session.seek(pendingSeek);
        pendingSeek = null;
      }
      if (marksDirty) drawMarks();

      const pos = f.length > 0 ? Math.round(Math.min(1, Math.max(0, f.time / f.length)) * 1000) : 0;
      if (pos !== shown.pos) {
        shown.pos = pos;
        fill.style.transform = `scaleX(${pos / 1000})`;
        thumb.style.left = `${pos / 10}%`;
      }
      const clockText = `${formatTime(Math.min(f.time, f.length))} / ${formatTime(f.length)}`;
      if (clockText !== shown.clock) {
        shown.clock = clockText;
        clock.textContent = clockText;
        track.setAttribute('aria-valuenow', String(Math.round(Math.max(0, f.time))));
        track.setAttribute('aria-valuetext', `${formatTime(f.time)} of ${formatTime(f.length)}`);
      }
      if (f.length !== shown.len) {
        shown.len = f.length;
        track.setAttribute('aria-valuemax', String(Math.round(f.length)));
        marksDirty = true;
      }
      const loopKey = f.loop ? `${f.loop.start}:${f.loop.end}:${f.length}` : '';
      if (loopKey !== shown.loop) {
        shown.loop = loopKey;
        loopBox.hidden = !f.loop || f.length <= 0;
        if (f.loop && f.length > 0) {
          loopBox.style.left = `${(Math.max(0, f.loop.start) / f.length) * 100}%`;
          loopBox.style.width = `${(Math.max(0, Math.min(f.length, f.loop.end) - Math.max(0, f.loop.start)) / f.length) * 100}%`;
        }
      }
      if (f.mode !== shown.mode) {
        shown.mode = f.mode;
        container.dataset.mode = f.mode;
      }

      const s = keeper.scorer;
      if (s.score !== shown.score) {
        shown.score = s.score;
        score.textContent = s.score.toLocaleString();
      }
      if (s.combo !== shown.combo) {
        shown.combo = s.combo;
        combo.textContent = String(s.combo);
      }
      if (s.multiplier !== shown.multi) {
        shown.multi = s.multiplier;
        multi.textContent = `x${s.multiplier}`;
        multi.dataset.level = String(s.multiplier);
      }
      // -2 until the first note is judged, so 100% still replaces the placeholder.
      const a = s.judged > 0 ? Math.round(s.accuracy * 100) : -2;
      if (a !== shown.acc) {
        shown.acc = a;
        acc.textContent = s.judged > 0 ? `${a}%` : '–';
      }
    },
    destroy() {
      for (const off of offs) off();
      observer?.disconnect();
      window.clearTimeout(calloutTimer);
      track.removeEventListener('pointerdown', onDown);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      track.removeEventListener('keydown', onKey);
      if (!sharedKeeper) keeper.destroy();
      progress.remove();
      stats.remove();
    },
  };
}
