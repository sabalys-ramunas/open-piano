import type { AppContext } from '../app/context';
import { inAppShell } from '../app/shell';
import { h } from '../app/dom';
import { icon } from '../ui/icons';
import { audioContext, audioOutputDelay } from '../audio/context';
import { describeOffset, measureOffset } from './calibrate';

const CLICKS = 10;
const BEAT = 0.6; // seconds: 100 beats a minute, an easy pace to tap along with

const now = (): number => performance.now();

/**
 * The timing check: ten clicks with a flash; the player taps along on the
 * piano, the computer keyboard (space bar) or the big button. Stores the
 * typical delay in settings.latencyMs. Returns a cleanup function.
 */
export function mountTimingCheck(container: HTMLElement, ctx: AppContext): () => void {
  const start = h('button', { type: 'button', class: 'primary big' }, icon('play'), 'Start the timing check');
  const pad = h(
    'button',
    { type: 'button', class: 'timing-pad', disabled: true, 'aria-label': 'Tap here on every click' },
    'Tap',
  );
  const status = h('p', { class: 'timing-status', 'aria-live': 'polite' }, '');
  const save = h('button', { type: 'button', class: 'button-mint big', hidden: true }, icon('check'), 'Use this result');
  const current = h('p', { class: 'timing-current' });
  const adjust = h('input', {
    type: 'range',
    id: 'set-latency',
    min: -250,
    max: 250,
    step: 5,
    value: ctx.settings.get().latencyMs,
    'aria-describedby': 'set-latency-help',
  });
  const reset = h('button', { type: 'button', class: 'quiet small' }, 'Reset');
  const step = (n: number, text: string) => h('li', { class: 'guide-step', 'data-step': n }, h('span', { class: 'guide-num', 'aria-hidden': 'true' }, String(n)), text);
  const guide = h('ol', { class: 'guide' }, step(1, 'Press Start'), step(2, 'Tap on every click'), step(3, 'Keep the result'));

  const root = h(
    'div',
    { class: 'timing' },
    guide,
    h('p', { class: 'timing-why' }, 'Tap on your piano, the space bar or the big circle. It takes six seconds.'),
    h('div', { class: 'timing-stage' }, pad),
    status,
    h('div', { class: 'timing-actions' }, start, save),
    h(
      'details',
      { class: 'more-options' },
      h('summary', {}, 'More options'),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'set-latency' }, 'Fine-tune by hand'),
        adjust,
        h('div', { class: 'slider-words', 'aria-hidden': 'true' }, h('span', {}, 'Earlier'), h('span', {}, 'Later')),
        h('p', { id: 'set-latency-help', class: 'hint' }, 'Most people never need this.'),
      ),
      h('div', { class: 'row' }, current, reset),
    ),
  );
  root.dataset.step = '1';
  container.append(root);

  const showCurrent = (): void => {
    const ms = ctx.settings.get().latencyMs;
    current.textContent = ms === 0 ? 'No adjustment.' : ms > 0 ? `${ms} ms later.` : `${-ms} ms earlier.`;
    adjust.value = String(ms);
    adjust.setAttribute('aria-valuetext', current.textContent);
  };
  showCurrent();

  let running = false;
  let clickTimes: number[] = [];
  let taps: number[] = [];
  const timers: number[] = [];
  let result: number | null = null;

  const tap = (): void => {
    if (!running) return;
    taps.push(now());
    pad.classList.add('hit');
    timers.push(window.setTimeout(() => pad.classList.remove('hit'), 90));
  };

  const finish = (): void => {
    running = false;
    pad.disabled = true;
    start.disabled = false;
    start.replaceChildren(icon('play'), 'Try again');
    root.dataset.step = '3';
    const r = measureOffset(clickTimes, taps);
    if (!r) {
      status.textContent = 'We missed some taps. Try again and tap on every click.';
      return;
    }
    start.classList.remove('primary');
    result = Math.max(-250, Math.min(250, r.offsetMs));
    status.textContent = describeOffset(r);
    save.hidden = false;
  };

  start.addEventListener('click', () => {
    if (running) return;
    ctx.audio.instrument.wake();
    let ac: AudioContext;
    try {
      ac = audioContext();
    } catch {
      status.textContent = inAppShell() ? 'There is no sound here, so the check cannot run.' : 'This browser has no sound, so the check cannot run.';
      return;
    }
    running = true;
    result = null;
    save.hidden = true;
    start.classList.add('primary');
    root.dataset.step = '2';
    taps = [];
    clickTimes = [];
    start.disabled = true;
    pad.disabled = false;
    pad.focus();
    status.textContent = 'Listen, and tap on each click.';
    const first = ac.currentTime + 0.5;
    const delay = audioOutputDelay(ac);
    const out = ac.createGain();
    out.gain.value = 0.6 * ctx.settings.get().volume;
    out.connect(ac.destination);
    for (let i = 0; i < CLICKS; i++) {
      const at = first + i * BEAT;
      const osc = ac.createOscillator();
      const env = ac.createGain();
      osc.frequency.value = i % 4 === 0 ? 1760 : 1250;
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(1, at + 0.001);
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      osc.connect(env).connect(out);
      osc.start(at);
      osc.stop(at + 0.06);
      // When the click is heard, in page time.
      const heard = now() + (at - ac.currentTime + delay) * 1000;
      clickTimes.push(heard);
      timers.push(
        window.setTimeout(() => {
          pad.classList.add('beat');
          timers.push(window.setTimeout(() => pad.classList.remove('beat'), 120));
        }, Math.max(0, heard - now())),
      );
    }
    timers.push(window.setTimeout(finish, (first - ac.currentTime + CLICKS * BEAT + 0.3) * 1000));
  });

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tap();
  });
  pad.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) tap();
    }
  });
  const onKey = (e: KeyboardEvent): void => {
    if (!running || e.repeat || e.target === pad) return;
    if (e.key === ' ') {
      e.preventDefault();
      tap();
    }
  };
  window.addEventListener('keydown', onKey);
  const offDown = ctx.input.on('down', ({ source }) => {
    // Piano keys and computer note keys count; the Tap button is handled above.
    if (source !== 'pointer') tap();
  });

  save.addEventListener('click', () => {
    if (result === null) return;
    ctx.settings.set({ latencyMs: result });
    save.hidden = true;
    status.textContent = 'Saved. Your timing is set!';
  });
  adjust.addEventListener('input', () => ctx.settings.set({ latencyMs: Number(adjust.value) }));
  reset.addEventListener('click', () => ctx.settings.set({ latencyMs: 0 }));
  const offSettings = ctx.settings.subscribe((_s, changed) => {
    if (changed.includes('latencyMs')) showCurrent();
  });

  return () => {
    running = false;
    for (const t of timers) window.clearTimeout(t);
    window.removeEventListener('keydown', onKey);
    offDown();
    offSettings();
    root.remove();
  };
}
