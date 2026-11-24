import type { AppContext } from '../app/context';
import { computerKeys, onKeyboardSeen } from '../app/shell';
import { h, link, notice as noticeBlock, starRating } from '../app/dom';
import { getStreak, starsFor } from '../app/progress';
import type { Cleanup } from '../app/screens';
import type { Stars } from '../app/store';
import { exposeForTests } from '../app/test-hook';
import { keyLetters } from '../input/keyboard';
import { createEffects } from '../player/effects';
import { createFallingView } from '../player/falling';
import { keyLimitFor, rangeFor } from '../player/keyboard';
import type { FrameState, StageView, StageViewFactory } from '../player/view';
import { renderSnippet } from '../sheet/snippet';
import { createSheetView } from '../sheet/view';
import { noteName } from '../song';
import { celebrate } from '../ui/celebrate';
import { unitArt } from '../ui/cover-art';
import { icon } from '../ui/icons';
import { mascot } from '../ui/mascot';
import { openSheet, type Sheet } from '../ui/sheet';
import { allLessons, COURSE, unitOf } from './curriculum';
import { ExplainStep, FindStep, LessonRunner, PlayStep, QuizStep, TouchStep, type Feedback, type StepController } from './engine';
import { liveStreak } from './map';
import { describeHand, describeKeys, describeRhythm, describeStaff, handPicture, keyboardPicture, rhythmPicture, staffPicture, type KeyboardPicture } from './pictures';
import { firstIncomplete, isUnlocked, LAST_LESSON_KEY, lessonAfter, loadProgress, readResume, RESUME_KEY, saveLessonResult } from './progress';
import type { Lesson, Pictures, StaffPicture } from './types';

const NO_LETTERS: ReadonlyMap<number, string> = new Map();
const VIEWS: Record<'falling' | 'sheet', StageViewFactory> = { falling: createFallingView, sheet: createSheetView };

/** What a play step shows in the bottom bar after a try. */
interface PlayResult {
  title: string;
  stars: Stars;
  detail: string;
}

interface StepView {
  el: HTMLElement;
  /** Called after anything changed in the current step. */
  update(): void;
  destroy(): void;
  /** Extra controls for the "More" sheet. */
  more?(close: () => void): Node[];
  /** Play steps own their main button and the buttons after a try. */
  play?: {
    start: HTMLButtonElement;
    again: HTMLButtonElement;
    slower: HTMLButtonElement;
    moveOn: HTMLButtonElement;
    replay: HTMLButtonElement;
    result(): PlayResult | null;
  };
}

const KIND_LABEL: Record<StepController['step']['kind'], string> = {
  explain: 'Learn',
  find: 'Find the key',
  quiz: 'Quick question',
  listen: 'Listen',
  phrase: 'Play it',
  timed: 'Play in time',
  perform: 'Show time',
  song: 'Play along',
  touch: 'Soft and loud',
};

/** Short cheers for the moment a step is done. Picked in turn, so they vary. */
const CHEERS = ['Nice!', 'Great!', 'Yes!', 'Super!', 'Well done!', 'Brilliant!'];

/** "C4/q E4/q" for a staff picture, in the token format of src/sheet/snippet.ts. */
export function staffTokens(pic: StaffPicture): string {
  return pic.notes.map((midi) => `${noteName(midi)}${Math.floor(midi / 12) - 1}/q`).join(' ');
}

/**
 * A staff picture drawn with the real sheet music engine (the same notation
 * the sheet view uses). Falls back to the simple SVG drawing when a canvas
 * cannot be drawn (very old browsers, tests).
 */
function staffFigure(pic: StaffPicture): HTMLElement {
  const label = describeStaff(pic, Boolean(pic.names));
  const canvas = h('canvas', { class: 'ls-staff-canvas', role: 'img', 'aria-label': label });
  try {
    if (!canvas.getContext('2d')) throw new Error('no canvas');
    const room = typeof window !== 'undefined' ? Math.max(220, Math.min(620, window.innerWidth - 80)) : 560;
    renderSnippet(canvas, { notes: staffTokens(pic), clef: pic.clef, names: Boolean(pic.names) }, { size: 15, maxWidth: room });
    return h('div', { class: 'ls-pic ls-pic-staff' }, canvas);
  } catch {
    return h('div', { class: 'ls-pic ls-pic-staff' }, staffPicture(pic, label));
  }
}

/** The pictures of a step, biggest first. `fallback` draws the unit's art when there is no picture. */
function pictures(p: Pictures, fallbackUnit?: number): HTMLElement | null {
  const items: HTMLElement[] = [];
  if (p.hand) items.push(h('figure', { class: 'ls-pic ls-pic-hand' }, handPicture(p.hand, describeHand(p.hand)), h('figcaption', {}, p.hand.side === 'left' ? 'Left hand' : 'Right hand')));
  if (p.staff) items.push(staffFigure(p.staff));
  if (p.rhythm) items.push(h('div', { class: 'ls-pic ls-pic-rhythm' }, rhythmPicture(p.rhythm, describeRhythm(p.rhythm))));
  if (p.keys) {
    const kb = keyboardPicture({ ...p.keys, label: describeKeys(p.keys.marks) });
    // As wide as the keys need and no wider, so one octave does not fill the whole screen.
    items.push(h('div', { class: 'ls-pic ls-pic-keys', style: `--whites: ${kb.el.style.getPropertyValue('--whites')}` }, kb.el));
  }
  if (items.length === 0 && fallbackUnit !== undefined) items.push(h('div', { class: 'ls-pic ls-pic-art' }, unitArt(fallbackUnit, 'ls-art')));
  if (items.length === 0) return null;
  return h('div', { class: `ls-pictures ls-pictures-${items.length}` }, ...items);
}

/** Keeps the keyboard letters, held keys and pointer playing of a picture in sync with the app. */
function playable(ctx: AppContext, kb: KeyboardPicture, host: HTMLElement, baseC: number): () => void {
  const previous = ctx.sources.keyboard.baseC;
  ctx.sources.keyboard.baseC = baseC;
  const letters = () => {
    const s = ctx.settings.get();
    kb.setLetters(s.showKeyLetters && !ctx.sources.midi.connected && computerKeys() ? keyLetters(baseC) : NO_LETTERS);
  };
  letters();
  const held = () => kb.setHeld(ctx.input.held);
  const offs = [
    ctx.sources.pointer.attach(host, (x, y) => {
      const r = host.getBoundingClientRect();
      return kb.keyAtPoint(r.left + x, r.top + y);
    }),
    ctx.input.on('down', held),
    ctx.input.on('up', held),
    ctx.input.on('devices', letters),
    ctx.settings.subscribe(letters),
    onKeyboardSeen(letters),
  ];
  return () => {
    for (const off of offs) off();
    ctx.sources.keyboard.baseC = previous;
  };
}

/** A gentle line under the hero for hints and wrong tries. Wins are said in the bottom bar instead. */
function hintLine(): { el: HTMLElement; show(f: Feedback | null): void } {
  const el = h('p', { class: 'ls-hint', 'aria-live': 'polite' });
  return {
    el,
    show(f) {
      const say = f && f.kind !== 'done' ? f.text : '';
      el.textContent = say;
      el.dataset.kind = say ? (f?.kind ?? '') : '';
    },
  };
}

/** Scrolls a wide keyboard so a key is in view (phones show part of a long keyboard). */
function centreOn(host: HTMLElement, kb: KeyboardPicture, midi: number): void {
  const key = kb.el.querySelector(`[data-midi="${midi}"]`);
  if (!key || host.scrollWidth <= host.clientWidth) return;
  const k = key.getBoundingClientRect();
  const r = host.getBoundingClientRect();
  host.scrollLeft += k.left + k.width / 2 - (r.left + r.width / 2);
}

function explainView(c: ExplainStep, unitIndex: number): StepView {
  return { el: h('div', { class: 'ls-explain' }, pictures(c.step, unitIndex)), update() {}, destroy() {} };
}

function quizView(c: QuizStep): StepView {
  const s = c.step;
  const hint = hintLine();
  const buttons = s.choices.map((choice, i) => {
    const b = h('button', { type: 'button', class: 'ls-choice' }, h('span', { class: 'ls-choice-text' }, choice), h('span', { class: 'ls-choice-mark', 'aria-hidden': 'true' }));
    b.addEventListener('click', () => c.choose(i));
    return b;
  });
  const el = h('div', { class: 'ls-quiz' }, pictures(s), h('div', { class: `ls-choices${s.choices.every((t) => t.length <= 4) ? ' is-short' : ''}`, role: 'group', 'aria-label': 'Answers' }, ...buttons), hint.el);
  return {
    el,
    update() {
      buttons.forEach((b, i) => {
        const wrong = c.tried.has(i);
        const right = c.status === 'passed' && i === s.answer;
        b.classList.toggle('is-wrong', wrong);
        b.classList.toggle('is-right', right);
        b.disabled = wrong || (c.status === 'passed' && !right);
        b.setAttribute('aria-label', wrong ? `${s.choices[i]}, not this one` : right ? `${s.choices[i]}, correct` : s.choices[i]);
        const mark = b.querySelector('.ls-choice-mark')!;
        mark.replaceChildren(right ? icon('check') : wrong ? icon('close') : '');
      });
      hint.show(c.feedback);
    },
    destroy() {},
  };
}

function findView(ctx: AppContext, c: FindStep): StepView {
  const s = c.step;
  const note = h('span', { class: 'ls-target-note' });
  const finger = s.finger
    ? h(
        'span',
        { class: 'ls-finger' },
        handPicture({ side: s.hand ?? 'right', fingers: [s.finger] }, ''),
        h('span', {}, `Finger ${s.finger}`, h('span', { class: 'visually-hidden' }, `, ${s.hand === 'left' ? 'left' : 'right'} hand`)),
      )
    : null;
  finger?.querySelector('svg')?.setAttribute('aria-hidden', 'true');
  finger?.querySelector('svg')?.removeAttribute('role');
  const dots = h('ol', { class: 'ls-dots', 'aria-hidden': 'true' }, ...s.targets.map(() => h('li', {})));
  const target = h('div', { class: 'ls-target', 'aria-live': 'polite' }, note, finger, s.targets.length > 1 ? dots : null);
  const kb = keyboardPicture({ lo: s.lo, hi: s.hi, label: computerKeys() ? 'Piano keyboard. Press keys on it, on your piano, or with your computer keys.' : 'Piano keyboard. Tap keys on it, or play them on your piano.' });
  const host = h('div', { class: 'ls-keys ls-keys-play' }, kb.el);
  const hint = hintLine();
  const off = playable(ctx, kb, host, Math.floor(s.lo / 12) * 12);
  let lastFeedback: Feedback | null = null;
  requestAnimationFrame(() => centreOn(host, kb, s.targets[0]));
  return {
    el: h('div', { class: 'ls-find' }, target, hint.el, host),
    update() {
      const t = c.target;
      note.textContent = t === undefined ? 'Found!' : `${s.anyOctave ? 'Any ' : ''}${noteName(t)}`;
      target.classList.toggle('is-found', t === undefined);
      [...dots.children].forEach((d, i) => d.classList.toggle('is-done', i < c.found.length));
      kb.setLit(c.hint ? c.goodKeys() : []);
      if (c.feedback && c.feedback !== lastFeedback && c.feedback.midi !== undefined) kb.flash(c.feedback.midi, c.feedback.kind === 'wrong' ? 'wrong' : 'right');
      lastFeedback = c.feedback;
      hint.show(c.feedback);
    },
    destroy() {
      off();
      kb.destroy();
    },
  };
}

function touchView(ctx: AppContext, c: TouchStep): StepView {
  const s = c.step;
  const word = h('span', { class: 'ls-target-note' });
  const meter = h('div', { class: 'ls-meter', role: 'meter', 'aria-label': 'How hard you pressed', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, h('span', {}));
  const dots = h('ol', { class: 'ls-dots', 'aria-hidden': 'true' }, ...s.prompts.map(() => h('li', {})));
  const kb = keyboardPicture({ lo: 60, hi: 71, label: 'Piano keyboard' });
  const host = h('div', { class: 'ls-keys ls-keys-play ls-keys-small' }, kb.el);
  const off = playable(ctx, kb, host, 60);
  const note = h('p', { class: 'ls-note', hidden: true }, 'These keys always play at the same loudness, so each press counts.');
  const hint = hintLine();
  const target = h('div', { class: 'ls-target', 'aria-live': 'polite' }, word, dots);
  return {
    el: h('div', { class: 'ls-touch' }, target, meter, hint.el, host, note),
    update() {
      const want = c.prompt;
      word.textContent = want === 'soft' ? 'Play softly' : want === 'loud' ? 'Play loudly' : 'Done!';
      target.dataset.want = want ?? 'done';
      [...dots.children].forEach((d, i) => d.classList.toggle('is-done', i < c.done));
      const v = Math.round((c.lastVelocity ?? 0) * 100);
      (meter.firstElementChild as HTMLElement).style.width = `${v}%`;
      meter.setAttribute('aria-valuenow', String(v));
      note.hidden = c.sensitive || c.lastVelocity === null;
      hint.show(c.feedback);
    },
    destroy() {
      off();
      kb.destroy();
    },
  };
}

const SPEEDS: [number, string][] = [
  [0.6, 'Slow'],
  [0.8, 'Steady'],
  [1, 'Full speed'],
];

function playView(ctx: AppContext, c: PlayStep): StepView {
  const s = c.step;
  if (c.missing || !c.session || !c.song) {
    return {
      el: h('div', { class: 'ls-play ls-play-missing' }, mascot('curious', 'ls-missing-mascot'), h('p', { class: 'ls-hint', 'data-kind': 'info' }, 'This song is not in your library right now. You can skip this step.')),
      update() {},
      destroy() {},
    };
  }
  const session = c.session;
  const song = c.song;
  const settings = ctx.settings;
  const flow = c.mode === 'flow';
  const listening = c.mode === 'listen';

  const start = h('button', { type: 'button', class: 'primary big ls-start' });
  const again = h('button', { type: 'button', class: 'primary big ls-again' }, 'Try again');
  const slower = h('button', { type: 'button', class: 'quiet' }, 'Try it slower');
  const moveOn = h('button', { type: 'button', class: 'quiet' }, 'Move on');
  const replay = h('button', { type: 'button', class: 'quiet' }, 'Play it again');
  let speedValue = 1;
  let viewKind: 'falling' | 'sheet' = 'view' in s && s.view ? s.view : settings.get().view;

  const coach = h('div', { class: 'ls-coach', 'aria-live': 'polite' });
  const viewHost = h('div', { class: 'ls-stage-view' });
  const effectsLayer = h('canvas', { class: 'ls-stage-effects', 'aria-hidden': 'true' });
  const count = h('div', { class: 'ls-count', 'aria-hidden': 'true', hidden: true });
  const hint = hintLine();
  const stage = h('div', { class: 'ls-stage' }, viewHost, effectsLayer, count, listening ? null : coach, hint.el);
  const el = h('div', { class: `ls-play ls-play-${c.mode}` }, stage);

  // Fit the computer keys to the hand being played.
  const mine = song.notes.filter((n) => listening || session.options.hands === 'both' || n.hand === session.options.hands);
  const range = rangeFor(song.notes.map((n) => n.midi));
  const previousBase = ctx.sources.keyboard.baseC;
  ctx.sources.keyboard.baseC = Math.floor(Math.min(...(mine.length ? mine : song.notes).map((n) => n.midi)) / 12) * 12;

  let view: StageView = VIEWS[viewKind](viewHost);
  // Sheet music marks the next note itself, so the "Next" chip only shows over falling notes.
  stage.classList.toggle('is-sheet', viewKind === 'sheet');
  const effects = createEffects(session, effectsLayer);

  function switchView(k: 'falling' | 'sheet'): void {
    if (k === viewKind) return;
    viewKind = k;
    view.destroy();
    view = VIEWS[k](viewHost);
    stage.classList.toggle('is-sheet', k === 'sheet');
    resize();
  }

  function resize(): void {
    const rect = viewHost.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    view.resize(rect.width, rect.height, ratio);
    effects.resize(rect.width, rect.height, ratio);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewHost);
  // The keys on the stage play too (mouse, pen and touch), as in the player: on a tablet they are the piano.
  // Read `view` at call time, since switching to sheet music replaces it.
  const offPointer = listening ? () => {} : ctx.sources.pointer.attach(viewHost, (x, y) => view.keyAt?.(x, y) ?? null);

  let metronomeOn = false;
  const leadIn = song.notes[0]?.start ?? 0;
  /** Beat clicks when asked for, and always during the count-in beats before the first note. */
  function syncMetronome(): void {
    const counting = session.game.time < leadIn - 0.05;
    const want = flow && session.running && (settings.get().metronome || counting);
    const m = ctx.audio.metronome;
    if (want && !metronomeOn) {
      m.start({
        bpm: song.bpm,
        beats: song.beats,
        beatsPerBar: song.timeSignature?.beats ?? 4,
        songTime: () => session.game.time,
        speed: () => session.options.speed,
      });
      metronomeOn = true;
    } else if (!want && metronomeOn) {
      m.stop();
      metronomeOn = false;
    }
  }

  start.addEventListener('click', () => {
    ctx.audio.instrument.wake();
    c.toggle();
  });
  again.addEventListener('click', () => {
    ctx.audio.instrument.wake();
    c.restart();
    c.start();
  });
  slower.addEventListener('click', () => {
    const next = Math.max(0.6, Math.round((c.speed - 0.2) * 10) / 10);
    speedValue = SPEEDS.find(([v]) => v >= next)?.[0] ?? 0.6;
    c.restart(speedValue);
    c.start();
  });
  moveOn.addEventListener('click', () => c.moveOn());
  replay.addEventListener('click', () => {
    c.restart();
    c.start();
  });

  let coachKey = '';
  function updateCoach(): void {
    if (listening) return;
    const next = c.nextNotes();
    const key = next.map((n) => `${n.midi}:${n.finger ?? ''}`).join(',') + (c.status === 'active' ? '' : c.status);
    if (key === coachKey) return;
    coachKey = key;
    if (next.length === 0 || c.status !== 'active') {
      coach.replaceChildren();
      coach.hidden = true;
      return;
    }
    coach.hidden = false;
    const groups = next.slice().sort((a, b) => a.midi - b.midi);
    coach.replaceChildren(
      h('span', { class: 'ls-coach-label' }, flow ? 'Coming up' : 'Next'),
      ...groups.map((n) =>
        h(
          'span',
          { class: `ls-coach-note ls-hand-${n.hand}` },
          h('span', { class: 'ls-coach-name' }, noteName(n.midi)),
          n.finger ? h('span', { class: 'ls-coach-finger', 'aria-label': `finger ${n.finger}, ${n.hand} hand` }, String(n.finger)) : null,
        ),
      ),
    );
  }

  function update(): void {
    const midway = session.game.time > -1.4 && !session.game.finished && c.status === 'active';
    start.replaceChildren(session.running ? h('span', {}, 'Pause') : h('span', { class: 'ls-start-in' }, icon('play'), midway ? 'Keep going' : listening ? 'Listen' : 'Start'));
    start.setAttribute('aria-pressed', String(session.running));
    el.classList.toggle('is-running', session.running);
    // Only gentle nudges show on the stage; wins and results are said in the bottom bar.
    hint.show(c.feedback?.kind === 'wrong' ? c.feedback : null);
    syncMetronome();
    updateCoach();
  }

  let letters = { baseC: -1, map: NO_LETTERS };
  const lettersFor = (baseC: number) => {
    if (letters.baseC !== baseC) letters = { baseC, map: keyLetters(baseC) };
    return letters.map;
  };
  const spb = 60 / (song.bpm ?? 60);
  const firstStart = song.notes[0]?.start ?? 0;
  let countText = '';

  let last = performance.now();
  let frameId = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    c.tick(dt);
    const st = settings.get();
    const game = session.game;
    const state: FrameState = {
      song,
      notes: game.notes,
      states: game.state,
      time: game.time,
      length: game.length,
      mode: game.opts.mode,
      hands: game.opts.hands,
      speed: game.opts.speed,
      running: session.running,
      expected: c.expected(),
      held: ctx.input.held,
      wrong: game.lastWrong,
      keyLetters: st.showKeyLetters && !ctx.sources.midi.connected && computerKeys() ? lettersFor(ctx.sources.keyboard.baseC) : NO_LETTERS,
      range,
      keyLimit: keyLimitFor(st, ctx.sources.midi.connected),
      showNoteNames: st.showNoteNames,
      reduceMotion: st.reduceMotion,
      now,
    };
    view.draw(state);
    effects.draw(state, view);

    // Count-in: "Get ready", then 1, 2, 3, 4 before the first note.
    let text = '';
    if (flow && session.running && game.time < firstStart - 0.05) text = game.time < 0 ? 'Get ready' : String(Math.floor(game.time / spb) + 1);
    if (text !== countText) {
      countText = text;
      count.textContent = text;
      count.hidden = text === '';
    }
    updateCoach();
    syncMetronome();
    frameId = requestAnimationFrame(frame);
  };

  resize();
  update();
  frameId = requestAnimationFrame(frame);

  return {
    el,
    update,
    play: {
      start,
      again,
      slower,
      moveOn,
      replay,
      result() {
        if (!c.last || listening) return null;
        const stars = Math.max(c.status === 'passed' ? 1 : 0, starsFor(c.last.accuracy)) as Stars;
        const title = c.status === 'passed' ? (c.last.accuracy >= 0.9 ? 'Brilliant!' : 'Nicely done!') : 'Good try!';
        const detail = `${c.last.hit} right${c.last.missed ? `, ${c.last.missed} missed` : ''}${c.last.wrong ? `, ${c.last.wrong} extra` : ''}`;
        return { title, stars, detail };
      },
    },
    more(close) {
      const restart = h('button', { type: 'button', class: 'wide' }, 'Start over');
      restart.addEventListener('click', () => {
        close();
        c.restart(speedValue);
      });
      const viewButtons = (['falling', 'sheet'] as const).map((k) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(k === viewKind) }, k === 'falling' ? 'Falling notes' : 'Sheet music');
        b.addEventListener('click', () => {
          switchView(k);
          for (const other of viewButtons) other.setAttribute('aria-pressed', String(other === b));
        });
        return b;
      });
      const nodes: Node[] = [restart, h('div', { class: 'ls-more-row' }, h('span', { class: 'ls-more-label', id: 'ls-more-view' }, 'Show the notes as'), h('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'ls-more-view' }, ...viewButtons))];
      if (flow) {
        const speed = h('select', { id: 'ls-more-speed' }, ...SPEEDS.map(([v, t]) => h('option', { value: String(v) }, t)));
        speed.value = String(SPEEDS.find(([v]) => v >= c.speed - 0.01)?.[0] ?? 1);
        speed.addEventListener('change', () => {
          speedValue = Number(speed.value);
          c.restart(speedValue);
        });
        const click = h('input', { type: 'checkbox', role: 'switch' });
        click.checked = settings.get().metronome;
        click.addEventListener('change', () => {
          settings.set({ metronome: click.checked });
          syncMetronome();
        });
        nodes.push(h('div', { class: 'ls-more-row' }, h('label', { class: 'ls-more-label', for: 'ls-more-speed' }, 'Speed'), speed), h('label', { class: 'toggle' }, 'Beat clicks', click));
      }
      return nodes;
    },
    destroy() {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      offPointer();
      if (metronomeOn) ctx.audio.metronome.stop();
      effects.destroy();
      view.destroy();
      ctx.sources.keyboard.baseC = previousBase;
    },
  };
}

/** Library songs a lesson plays (its `song` steps). */
export function lessonSongIds(lesson: Lesson): string[] {
  return [...new Set(lesson.steps.flatMap((s) => (s.kind === 'song' ? [s.songId] : [])))];
}

/** The round way back and the lesson title, shared by the loading screen and the lesson. */
function backLink(): HTMLAnchorElement {
  const back = link({ screen: 'course' }, '', { class: 'button icon-button ls-back', 'aria-label': 'Course map' });
  back.append(icon('back'));
  return back;
}

/**
 * #/course/<id>: one lesson, step by step, full screen. Songs from the library
 * that the lesson plays may have to be fetched first; a short loading notice
 * shows meanwhile. A song that cannot be loaded leaves its step skippable.
 */
export function mountLesson(container: HTMLElement, ctx: AppContext, lesson: Lesson): Cleanup {
  container.classList.add('is-lesson');
  const waiting = lessonSongIds(lesson).filter((id) => !ctx.library.get(id));
  if (waiting.length === 0) return mountLessonReady(container, ctx, lesson);
  let alive = true;
  let inner: Cleanup | null = null;
  container.append(
    h('div', { class: 'ls' }, h('header', { class: 'ls-top' }, backLink(), h('div', { class: 'ls-top-mid' }, h('h1', { class: 'ls-lesson-title' }, lesson.title))), noticeBlock('loading', 'Getting the music ready...')),
  );
  void Promise.all(waiting.map((id) => ctx.library.ensure(id))).then(() => {
    if (!alive) return;
    container.replaceChildren();
    inner = mountLessonReady(container, ctx, lesson);
  });
  return () => {
    alive = false;
    inner?.();
  };
}

function mountLessonReady(container: HTMLElement, ctx: AppContext, lesson: Lesson): Cleanup {
  let alive = true;
  const calm = (): boolean => ctx.settings.get().reduceMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const unit = unitOf(lesson.id);
  const unitIndex = Math.max(0, unit ? COURSE.units.indexOf(unit) : 0);
  const lessons = allLessons();
  const number = lessons.indexOf(lesson) + 1;
  const runner = new LessonRunner(lesson, { audio: ctx.audio, songs: (id) => ctx.library.get(id) });
  const offTests = exposeForTests('lesson', {
    runner,
    get session() {
      const c = runner.current;
      return c instanceof PlayStep ? c.session : undefined;
    },
  });

  // ---- Top: round back button, lesson name, slim step bar, "More" ----
  const barFill = h('span', {});
  const bar = h('div', { class: 'ls-bar', role: 'progressbar', 'aria-label': 'Lesson steps', 'aria-valuemin': 0, 'aria-valuemax': lesson.steps.length, 'aria-valuenow': 0 }, barFill);
  const moreButton = h('button', { type: 'button', class: 'icon-button ls-more', 'aria-label': 'More options', 'aria-haspopup': 'dialog' });
  moreButton.append(icon('more'));
  const top = h(
    'header',
    { class: 'ls-top' },
    backLink(),
    h('div', { class: 'ls-top-mid' }, h('h1', { class: 'ls-lesson-title' }, h('span', { class: 'visually-hidden' }, `Lesson ${number}: `), lesson.title), bar),
    moreButton,
  );

  // ---- The step: a short line in big type, then the hero ----
  const notice = h('div', { class: 'ls-notice', hidden: true, role: 'status' });
  const kind = h('p', { class: 'ls-kind' });
  const line = h('h2', { class: 'ls-line', id: 'ls-step-title', tabindex: -1 });
  const sub = h('p', { class: 'ls-sub' });
  const head = h('div', { class: 'ls-head' }, kind, line, sub);
  const body = h('div', { class: 'ls-body' });
  const card = h('section', { class: 'ls-card', 'aria-labelledby': 'ls-step-title' }, head, body);

  // ---- Bottom: one big button, and the "Nice!" moment when a step is done ----
  const skipButton = h('button', { type: 'button', class: 'quiet ls-skip' }, 'Skip this step');
  const nextButton = h('button', { type: 'button', class: 'primary big ls-next' }, 'Continue');
  const say = h('div', { class: 'ls-say', 'aria-live': 'polite' });
  const actions = h('div', { class: 'ls-actions' });
  const foot = h('div', { class: 'ls-foot' }, h('div', { class: 'ls-foot-in' }, say, actions));

  // The app's <main> is the container, so the inner wrapper is a plain div (one main landmark).
  const shell = h('div', { class: `ls${ctx.settings.get().reduceMotion ? ' reduce-motion' : ''}` }, top, notice, h('div', { class: 'ls-main' }, card), foot);
  container.append(shell);

  let view: StepView | null = null;
  let shownIndex = -1;
  let saved = false;
  let cheer = 0;
  let footKey = '';
  let sheet: Sheet | null = null;

  function renderStep(): void {
    view?.destroy();
    view = null;
    sheet?.close();
    const c = runner.current;
    const i = runner.index;
    shownIndex = i;
    bar.setAttribute('aria-valuenow', String(i));
    barFill.style.width = `${Math.round((i / lesson.steps.length) * 100)}%`;
    if (!c) {
      renderDone();
      return;
    }
    shell.classList.remove('is-done');
    card.className = `ls-card ls-card-${c.step.kind}`;
    card.replaceChildren(head, body);
    kind.textContent = KIND_LABEL[c.step.kind];
    line.textContent = c instanceof QuizStep ? c.step.question : c.step.title;
    sub.textContent = c instanceof QuizStep ? '' : c.step.text;
    sub.hidden = c instanceof QuizStep;
    if (c instanceof ExplainStep) view = explainView(c, unitIndex);
    else if (c instanceof QuizStep) view = quizView(c);
    else if (c instanceof FindStep) view = findView(ctx, c);
    else if (c instanceof TouchStep) view = touchView(ctx, c);
    else view = playView(ctx, c);
    body.replaceChildren(view.el);
    foot.hidden = false;
    footKey = '';
    view.update();
    updateFoot();
    // The big line takes focus, so screen readers start there and nothing looks chosen in advance.
    line.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (i > 0) void ctx.store.setValue(RESUME_KEY, { lessonId: lesson.id, step: i }).catch(() => {});
  }

  /** The bottom bar: what to say, the quiet extras, and the one big button. */
  function updateFoot(): void {
    const c = runner.current;
    if (!c || !view) return;
    const last = runner.index === lesson.steps.length - 1;
    nextButton.textContent = last ? 'Finish' : 'Continue';
    const passed = c.status === 'passed';
    let tone: 'plain' | 'nice' | 'retry' = 'plain';
    let words: Node[] = [];
    let buttons: HTMLElement[] = [];

    if (c instanceof ExplainStep) {
      buttons = [nextButton];
    } else if (c instanceof PlayStep && view.play) {
      const p = view.play;
      const r = p.result();
      if (passed) {
        tone = 'nice';
        words = [mascot('cheer', 'ls-foot-mascot'), h('p', { class: 'ls-cheer' }, r ? r.title : CHEERS[cheer % CHEERS.length]) as Node | null, r ? starRating(r.stars) : null, h('p', { class: 'ls-say-text' }, r ? r.detail : (c.feedback?.text ?? ''))].filter((n): n is Node => n !== null);
        buttons = r ? [p.replay, nextButton] : [nextButton];
      } else if (c.status === 'retry') {
        tone = 'retry';
        words = [h('p', { class: 'ls-cheer' }, r?.title ?? 'Good try!'), h('p', { class: 'ls-say-text' }, c.feedback?.text ?? '')];
        p.slower.hidden = c.speed <= 0.6;
        buttons = [p.moveOn, p.slower, p.again];
      } else {
        buttons = [skipButton, p.start];
      }
    } else if (c instanceof PlayStep) {
      // The song is missing: moving on is the only thing to do.
      skipButton.className = 'primary big ls-skip';
      buttons = [skipButton];
    } else if (passed) {
      tone = 'nice';
      const why = c.feedback?.kind === 'done' ? c.feedback.text : '';
      words = [mascot('cheer', 'ls-foot-mascot'), h('p', { class: 'ls-cheer' }, CHEERS[cheer % CHEERS.length]) as Node | null, why ? h('p', { class: 'ls-say-text' }, why) : null].filter((n): n is Node => n !== null);
      buttons = [nextButton];
    } else {
      buttons = [skipButton];
    }
    if (!(c instanceof PlayStep && !view.play)) skipButton.className = 'quiet ls-skip';

    const key = `${runner.index}:${tone}:${c.status}:${buttons.length}`;
    if (key === footKey) {
      // Same state: only refresh the words in place (e.g. a new result after another try).
      if (tone !== 'plain') say.replaceChildren(...words);
      return;
    }
    const becameNice = tone === 'nice' && !footKey.includes(':nice:');
    footKey = key;
    foot.dataset.tone = tone;
    say.replaceChildren(...words);
    actions.replaceChildren(...buttons);
    if (becameNice) {
      cheer++;
      foot.classList.remove('is-new');
      void foot.offsetWidth;
      foot.classList.add('is-new');
      const word = say.querySelector('.ls-cheer');
      if (word) celebrate(word, { pieces: 14, spread: 110, calm: calm() });
      nextButton.focus({ preventScroll: true });
    } else if (tone === 'retry') {
      view.play?.again.focus({ preventScroll: true });
    }
  }

  function renderDone(): void {
    const result = runner.result();
    const next = lessonAfter(lesson.id);
    shell.classList.add('is-done');
    foot.hidden = true;
    const nextLink = next
      ? link({ screen: 'course', lessonId: next.id }, '', { class: 'button primary big ls-done-next', 'aria-label': `Next lesson: ${next.title}` })
      : link({ screen: 'course' }, '', { class: 'button primary big ls-done-next' });
    nextLink.append(h('span', {}, next ? 'Next lesson' : 'Back to the map'), icon('forward'));
    const again = h('button', { type: 'button', class: 'quiet' }, 'Do it again');
    again.addEventListener('click', () => {
      saved = false;
      runner.goTo(0);
    });
    const mapLink = link({ screen: 'course' }, 'Course map', { class: 'button quiet' });
    const streakBox = h('div', { class: 'ls-streak', hidden: true, 'aria-live': 'polite' });
    const title = h('h2', { class: 'ls-done-title', id: 'ls-done-title', tabindex: -1 });

    if (result.skipped) {
      title.textContent = 'Skipped for now';
      card.className = 'ls-card ls-done is-skipped';
      card.replaceChildren(
        mascot('curious', 'ls-done-mascot'),
        title,
        h('p', { class: 'ls-done-text' }, 'No stars this time. Come back whenever you like to play it.'),
        h('div', { class: 'ls-done-actions' }, nextLink, again, next ? mapLink : null),
      );
    } else {
      const stars = result.stars;
      title.textContent = lesson.piece ? 'You can play it!' : stars === 3 ? 'Wonderful!' : stars === 2 ? 'Great job!' : 'Lesson complete!';
      const rating = starRating(stars, true);
      rating.classList.add('ls-done-stars');
      card.className = 'ls-card ls-done';
      card.replaceChildren(
        mascot('cheer', calm() ? 'ls-done-mascot' : 'ls-done-mascot is-cheering'),
        title,
        rating,
        h('p', { class: 'ls-done-text' }, lesson.piece ? `${lesson.piece.title}: a whole piece, all yours.` : stars === 3 ? 'Every step done beautifully.' : 'Come back any time for more stars.'),
        streakBox,
        h('div', { class: 'ls-done-actions' }, nextLink, again, next ? mapLink : null),
      );
      title.classList.add('pop');
      requestAnimationFrame(() => {
        if (alive) celebrate(rating, { pieces: 34, spread: 220, calm: calm() });
      });
    }
    card.setAttribute('aria-labelledby', 'ls-done-title');
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (saved) return;
    saved = true;
    void (async () => {
      try {
        const { firstToday } = await saveLessonResult(ctx.store, lesson.id, result);
        await ctx.store.setValue(RESUME_KEY, null);
        if (next) await ctx.store.setValue(LAST_LESSON_KEY, next.id);
        if (!alive || !result.completed) return;
        const days = liveStreak(await getStreak(ctx.store));
        if (!firstToday || days < 1 || !streakBox.isConnected) return;
        // The streak moment: the first lesson of the day keeps the sun shining.
        streakBox.replaceChildren(
          h('span', { class: 'ls-streak-sun', 'aria-hidden': 'true' }, icon('sun'), h('span', { class: 'ls-streak-days' }, String(days))),
          h(
            'div',
            { class: 'ls-streak-words' },
            h('p', { class: 'ls-streak-title' }, days === 1 ? 'Day 1 of your streak!' : `${days} days in a row!`),
            h('p', { class: 'ls-streak-text' }, days === 1 ? 'Play again tomorrow to make it 2.' : 'Your sun keeps shining. See you tomorrow!'),
          ),
        );
        streakBox.hidden = false;
        streakBox.classList.add('pop');
        celebrate(streakBox.querySelector('.ls-streak-sun'), { pieces: 18, spread: 140, calm: calm() });
      } catch {
        if (alive && streakBox.isConnected) {
          streakBox.replaceChildren(h('p', { class: 'ls-streak-text' }, 'Your progress could not be saved this time.'));
          streakBox.hidden = false;
        }
      }
    })();
  }

  function openMore(): void {
    const c = runner.current;
    const close = () => sheet?.close();
    const item = (label: string, act: () => void): HTMLButtonElement => {
      const b = h('button', { type: 'button', class: 'wide' }, label);
      b.addEventListener('click', () => {
        close();
        act();
      });
      return b;
    };
    const items: Node[] = [];
    if (c && runner.index > 0) items.push(item('Go back a step', () => runner.back()));
    if (c && c.status !== 'passed') items.push(item('Skip this step', () => runner.skip()));
    if (view?.more) items.push(...view.more(close));
    if (runner.index > 0) items.push(item('Start the lesson again', () => runner.goTo(0)));
    sheet = openSheet({
      labelledBy: 'ls-more-title',
      className: 'ls-more-sheet',
      content: [h('h2', { id: 'ls-more-title' }, 'More'), h('div', { class: 'ls-more-list' }, ...items)],
      onClose: () => {
        sheet = null;
      },
    });
  }

  const offRunner = runner.subscribe(() => {
    if (!alive) return;
    if (runner.index !== shownIndex) renderStep();
    else {
      view?.update();
      updateFoot();
    }
  });

  nextButton.addEventListener('click', () => runner.next());
  skipButton.addEventListener('click', () => runner.skip());
  moreButton.addEventListener('click', openMore);

  const offInput = ctx.input.on('down', ({ midi, velocity, source }) => runner.press(midi, velocity, source === 'midi'));

  renderStep();
  void ctx.store.setValue(LAST_LESSON_KEY, lesson.id).catch(() => {});

  // Gentle notices: picking up where the learner stopped, or trying a lesson further along.
  void Promise.all([loadProgress(ctx.store), ctx.store.getValue(RESUME_KEY).catch(() => undefined)]).then(([progress, resumeValue]) => {
    if (!alive) return;
    const resume = readResume(resumeValue);
    if (resume && resume.lessonId === lesson.id && runner.index === 0) {
      const go = h('button', { type: 'button', class: 'primary big wide' }, `Pick up at step ${resume.step + 1}`);
      const fresh = h('button', { type: 'button', class: 'quiet wide' }, 'Start from the beginning');
      const s = openSheet({
        labelledBy: 'ls-resume-title',
        className: 'ls-resume-sheet',
        content: [mascot('happy', 'ls-resume-mascot'), h('h2', { id: 'ls-resume-title' }, 'Welcome back!'), h('p', {}, 'You were part way through this lesson.'), h('div', { class: 'ls-resume-actions' }, go, fresh)],
      });
      go.addEventListener('click', () => {
        s.close();
        runner.goTo(resume.step);
      });
      fresh.addEventListener('click', () => s.close());
      go.focus();
      return;
    }
    if (!isUnlocked(lesson.id, progress)) {
      const next = firstIncomplete(progress);
      notice.replaceChildren(
        h('p', {}, 'This one is further along. Have a go!'),
        next ? link({ screen: 'course', lessonId: next.id }, `Or go to ${next.title}`, { class: 'button small' }) : '',
      );
      notice.hidden = false;
    }
  });

  return () => {
    alive = false;
    sheet?.close();
    offTests();
    offRunner();
    offInput();
    view?.destroy();
    runner.destroy();
  };
}

