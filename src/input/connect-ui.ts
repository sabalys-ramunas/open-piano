import '../styles/settings.css';
import { APP_NAME } from '../app/brand';
import type { AppContext } from '../app/context';
import { h } from '../app/dom';
import { isBlack } from '../song';
import { celebrate } from '../ui/celebrate';
import { icon } from '../ui/icons';
import { illustration } from '../ui/illustrations';
import { inAppShell, pairBluetooth } from '../app/shell';
import { currentBrowser, midiAskingText, midiDeniedText, midiIdleText, noMidiAdvice } from './browser';
import { RangeTracker } from './key-range';
import type { MidiActivity } from './midi';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "C4", "F#2": a note name with its octave. */
export function fullNoteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export interface ConnectOptions {
  /** Heading level for the helper's own title (2 in settings, 1 if it is a whole step). Default 2. */
  headingLevel?: 1 | 2 | 3;
  /** Shown as a "Done" button once a key press arrived (for a first-run step). */
  onDone?: () => void;
  /**
   * The full helper: a big picture of the cable going into a piano, a whole
   * keyboard that lights up with the note name, and a celebration on the
   * first key. Without it (the welcome step) it is a compact card.
   */
  big?: boolean;
}

/** Gentle troubleshooting, one tappable question at a time. */
export const TIPS: readonly [string, string][] = [
  ['Is it switched on?', 'Turn the piano on, then press a key.'],
  ['The right USB port?', 'Use the port marked "USB to Host" (or just "USB"), not the one for memory sticks.'],
  ['Try another cable', 'Some cables only charge and carry no music.'],
  ['Another app using it?', 'Close other music apps, then unplug the piano and plug it back in.'],
  ['USB switched off?', 'Some pianos need USB or MIDI turned on in their own menu.'],
  ['A Bluetooth piano?', 'Pair it with your computer first (on a Mac, in Audio MIDI Setup). On Windows a cable works better.'],
];

/** The same tips inside the iPad/iPhone app: a cable into the iPad or iPhone, Bluetooth paired from here. */
export const APP_TIPS: readonly [string, string][] = [
  ['Is it switched on?', 'Turn the piano on, then press a key.'],
  ['The right USB port?', 'Use the port marked "USB to Host" (or just "USB"), not the one for memory sticks.'],
  ['Need an adapter?', 'Most pianos need a USB adapter for the iPad or iPhone (USB-C or Lightning). Plug the piano cable into it.'],
  ['Another app using it?', 'Close other music apps, then unplug the piano and plug it back in.'],
  ['USB switched off?', 'Some pianos need USB or MIDI turned on in their own menu.'],
  ['A Bluetooth piano?', 'Switch on its Bluetooth, press Pair a Bluetooth piano, then choose it in the list.'],
];

/** The tips that fit where the app runs. */
export function connectTips(app = inAppShell()): readonly [string, string][] {
  return app ? APP_TIPS : TIPS;
}

/** A list of questions; tapping one shows its answer. */
export function tipList(tips: readonly [string, string][], className = 'connect-tips'): HTMLElement {
  return h(
    'ul',
    { class: className },
    ...tips.map(([question, answer], i) => {
      const id = `tip-${Math.random().toString(36).slice(2, 8)}-${i}`;
      const text = h('p', { class: 'tip-answer', id, hidden: true }, answer);
      const b = h('button', { type: 'button', class: 'tip-question', 'aria-expanded': 'false', 'aria-controls': id }, h('span', {}, question), icon('forward', 'tip-chevron'));
      b.addEventListener('click', () => {
        const open = b.getAttribute('aria-expanded') !== 'true';
        b.setAttribute('aria-expanded', String(open));
        text.hidden = !open;
      });
      return h('li', { class: 'tip' }, b, text);
    }),
  );
}

/** A whole piano keyboard drawn with elements, so keys can light up. */
function pianoKeys(low = 21, high = 108): { el: HTMLElement; press(midi: number): void; release(midi: number): void } {
  const whites: number[] = [];
  for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
  const keys = new Map<number, HTMLElement>();
  const row = h('div', { class: 'keys-row' });
  for (const m of whites) {
    const k = h('span', { class: 'keys-white' });
    if (m % 12 === 0) k.append(h('span', { class: 'keys-c' }, fullNoteName(m)));
    keys.set(m, k);
    row.append(k);
  }
  const w = 100 / whites.length;
  for (let m = low; m <= high; m++) {
    if (!isBlack(m)) continue;
    const left = whites.indexOf(m + 1);
    if (left < 0) continue;
    const k = h('span', { class: 'keys-black', style: `left: calc(${(left * w).toFixed(3)}% - ${(w * 0.3).toFixed(3)}%); width: ${(w * 0.6).toFixed(3)}%` });
    keys.set(m, k);
    row.append(k);
  }
  const bubble = h('span', { class: 'keys-bubble is-waiting', style: 'left: 50%' }, 'Press a key');
  const el = h('div', { class: 'keys', 'aria-hidden': 'true' }, bubble, row);
  const timers = new Map<number, number>();
  return {
    el,
    press(midi) {
      const k = keys.get(Math.max(low, Math.min(high, midi)));
      if (!k) return;
      k.classList.add('on');
      const at = isBlack(midi) ? whites.indexOf(midi + 1) : whites.indexOf(midi) + 0.5;
      bubble.textContent = fullNoteName(midi);
      bubble.style.left = `${Math.max(4, Math.min(96, at * w))}%`;
      bubble.classList.remove('is-pop', 'is-waiting');
      void bubble.offsetWidth; // restart the pop
      bubble.classList.add('is-pop');
      const old = timers.get(midi);
      if (old) window.clearTimeout(old);
      // Lights go out by themselves too, in case the key-up never arrives.
      timers.set(midi, window.setTimeout(() => k.classList.remove('on'), 1500));
    },
    release(midi) {
      keys.get(midi)?.classList.remove('on');
    },
  };
}

/**
 * "Plug in your piano and press any key": live connection status, the device
 * name, notes as they arrive, the keyboard size (saved to settings.keyLow and
 * keyHigh) and tips when nothing arrives. The big version is the star of
 * Settings; the compact one is a step of the welcome. Returns a cleanup.
 */
export function mountPianoConnect(container: HTMLElement, ctx: AppContext, options: ConnectOptions = {}): () => void {
  const midi = ctx.sources.midi;
  const range = new RangeTracker();
  const big = options.big === true;
  const level = options.headingLevel ?? 2;
  const heading = h(`h${level}` as 'h2', { class: 'connect-title', id: 'connect-title' }, 'Connect your piano');
  const status = h('p', { class: 'connect-status', 'aria-live': 'polite' });
  const action = h('button', { type: 'button', class: big ? 'primary big' : 'primary', hidden: true }, icon('usb'), 'Connect my piano');
  const light = h('div', { class: 'connect-light', 'aria-hidden': 'true' });
  const lastNote = h('p', { class: 'connect-note', 'aria-live': 'polite' }, '');
  const sizeLine = h('p', { class: 'connect-size', 'aria-live': 'polite' }, '');
  const resetRange = h('button', { type: 'button', class: 'link-button connect-reset', hidden: true }, 'Measure again');
  const tips = h('details', { class: 'connect-help' }, h('summary', {}, icon('help'), 'Nothing happens when I press a key'), tipList(connectTips()));
  // Only the iPad/iPhone app can open the system's Bluetooth MIDI pairing screen.
  const bluetooth = inAppShell() ? h('button', { type: 'button', class: big ? 'big connect-bluetooth' : 'connect-bluetooth' }, icon('piano'), 'Pair a Bluetooth piano') : null;
  const done = options.onDone ? h('button', { type: 'button', class: 'primary', hidden: true }, 'Done') : null;
  const keys = big ? pianoKeys() : null;
  const art = big ? h('div', { class: 'connect-art' }, illustration('cable', 'connect-picture'), h('span', { class: 'connect-tick', hidden: true }, icon('check'))) : null;
  const live = h('div', { class: 'connect-live' }, big ? null : light, h('div', {}, lastNote, sizeLine, resetRange));

  const root = h(
    'section',
    { class: big ? 'connect connect-big' : 'connect card', 'aria-labelledby': 'connect-title' },
    h('div', { class: 'connect-stage' }, art, h('div', { class: 'connect-words' }, heading, status, h('div', { class: 'row connect-actions' }, action, bluetooth, done))),
    keys?.el ?? null,
    live,
    tips,
  );
  container.append(root);

  let gotNote = false;
  let waitTimer: number | null = null;
  let flashTimer: number | null = null;

  const title = (text: string): void => {
    if (big) heading.textContent = text;
  };

  const render = (): void => {
    const devices = midi.devices;
    const kind = currentBrowser();
    action.hidden = true;
    live.hidden = true;
    root.classList.toggle('is-working', gotNote && devices.length > 0);
    art?.querySelector('.connect-tick')?.toggleAttribute('hidden', !(gotNote && devices.length > 0));
    switch (midi.status) {
      case 'unsupported':
        title(kind === 'app' ? 'The piano could not connect' : 'This browser cannot connect');
        status.textContent = noMidiAdvice(kind);
        break;
      case 'insecure':
        title('This page cannot connect');
        status.textContent = `Pianos only connect on a secure page. Open ${APP_NAME} from its https address.`;
        break;
      case 'idle':
      case 'asking':
        title(midi.status === 'asking' ? 'Choose Allow' : 'Connect your piano');
        if (kind === 'app') title('Connect your piano');
        status.textContent = midi.status === 'asking' ? midiAskingText(kind) : midiIdleText(kind);
        action.hidden = midi.status === 'asking';
        break;
      case 'denied':
        title('Not allowed yet');
        status.textContent = midiDeniedText(kind);
        action.replaceChildren(icon('usb'), 'Try again');
        action.hidden = false;
        break;
      case 'ready':
        live.hidden = false;
        if (devices.length === 0) {
          const off = midi.ports().filter((p) => p.connected && !p.enabled);
          title('Plug in your piano');
          status.textContent = off.length
            ? `${off.map((p) => p.name).join(', ')} is switched off in More options. Switch it on to play.`
            : kind === 'app'
              ? 'Plug it into this iPad or iPhone with a USB cable (or pair it with Bluetooth) and switch it on.'
              : 'Plug it in with a USB cable and switch it on.';
        } else {
          title(gotNote ? 'It works!' : 'Press any key');
          status.textContent = `${devices.join(', ')} is connected.`;
        }
        break;
    }
    // Tips open by themselves if a piano is plugged in but nothing arrives for 10 seconds.
    if (midi.status === 'ready' && devices.length > 0 && !gotNote) {
      if (waitTimer === null) {
        waitTimer = window.setTimeout(() => {
          if (!gotNote) tips.open = true;
        }, 10000);
      }
    }
  };

  const showRange = (): void => {
    const guess = range.guess();
    resetRange.hidden = range.count === 0;
    if (!guess) {
      sizeLine.textContent = range.count ? 'Now press your lowest and highest key.' : '';
      return;
    }
    const n = guess.keys;
    const an = n === 88 || n === 8 || n === 18 || (n >= 80 && n < 90);
    sizeLine.textContent = `This looks like ${an ? 'an' : 'a'} ${n}-key keyboard (${fullNoteName(guess.low)} to ${fullNoteName(guess.high)}).`;
    const s = ctx.settings.get();
    if (s.keyLow !== guess.low || s.keyHigh !== guess.high) ctx.settings.set({ keyLow: guess.low, keyHigh: guess.high });
  };

  const onActivity = (a: MidiActivity): void => {
    if (a.event.type === 'up') {
      keys?.release(a.event.note);
      return;
    }
    if (a.event.type !== 'down') return;
    const port = midi.ports().find((p) => p.name === a.port);
    if (port && !port.enabled) {
      lastNote.textContent = `${a.port} is sending notes, but it is switched off.`;
      return;
    }
    const first = !gotNote;
    gotNote = true;
    tips.open = false;
    range.add(a.event.note);
    const strength = a.event.velocity < 40 ? 'softly' : a.event.velocity > 100 ? 'firmly' : '';
    lastNote.textContent = `${big ? 'You played' : 'It works! You played'} ${fullNoteName(a.event.note)}${strength ? `, ${strength}` : ''}.`;
    keys?.press(a.event.note);
    light.classList.add('on');
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => light.classList.remove('on'), 180);
    if (done) done.hidden = false;
    showRange();
    render();
    if (big && first) celebrate(keys?.el.querySelector('.keys-bubble') ?? heading, { calm: ctx.settings.get().reduceMotion, pieces: 30 });
  };

  action.addEventListener('click', () => {
    ctx.audio.instrument.wake();
    void midi.requestAccess().then(render);
    render();
  });
  resetRange.addEventListener('click', () => {
    range.reset();
    sizeLine.textContent = 'Press your lowest and highest key.';
    resetRange.hidden = true;
  });
  bluetooth?.addEventListener('click', () => {
    ctx.audio.instrument.wake();
    // A paired piano appears like a plugged-in one, so get access first if needed.
    if (midi.status === 'idle' || midi.status === 'denied') void midi.requestAccess().then(render);
    pairBluetooth();
  });
  done?.addEventListener('click', () => options.onDone?.());

  const offChange = midi.onChange(render);
  const offActivity = midi.onActivity(onActivity);
  render();

  return () => {
    offChange();
    offActivity();
    if (waitTimer !== null) window.clearTimeout(waitTimer);
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    root.remove();
  };
}
