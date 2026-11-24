import '../styles/welcome.css';
import { APP_NAME } from '../app/brand';
import type { AppContext } from '../app/context';
import { h, link, logo } from '../app/dom';
import { finishWelcome, type PlayWith } from '../app/first-run';
import type { Route } from '../app/router';
import { computerKeys, inAppShell, onKeyboardSeen } from '../app/shell';
import type { Cleanup } from '../app/screens';
import { allLessons } from '../course/curriculum';
import { currentBrowser, micAskingText, micDeniedText, micUnsupportedText } from '../input/browser';
import { mountPianoConnect, fullNoteName } from '../input/connect-ui';
import { keyLetters } from '../input/keyboard';
import { isBlack } from '../song';
import { celebrate } from '../ui/celebrate';
import { songCover, unitArt } from '../ui/cover-art';
import { icon } from '../ui/icons';
import { illustration, type IllustrationName } from '../ui/illustrations';
import { mascot, type MascotMood } from '../ui/mascot';

type Step = 'hello' | 'how' | 'midi' | 'keys' | 'mic' | 'ready';

/** Which of the four dots a step lights up. */
const STEP_NUMBER: Record<Step, number> = { hello: 1, how: 2, midi: 3, keys: 3, mic: 3, ready: 4 };

/**
 * #/welcome: a short, full-screen first-run guide, one question per step:
 * hello, how will you play, connect (USB piano, computer keys, or the
 * microphone for an acoustic piano), and you are all set. The browser is only
 * asked for MIDI or microphone access from a button press here. The first key
 * that arrives is celebrated.
 */
export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  void route;
  let playWith: PlayWith | undefined;
  let stepCleanup: (() => void) | null = null;
  const calm = (): boolean => ctx.settings.get().reduceMotion;

  const body = h('div', { class: 'welcome-body' });
  const progressText = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const dots = h('ol', { class: 'welcome-dots', 'aria-hidden': 'true' }, ...[1, 2, 3, 4].map(() => h('li', {})));
  const skip = link({ screen: 'home' }, 'Skip', { class: 'welcome-skip button quiet small', 'aria-label': 'Skip the welcome and go to the songs' });
  skip.addEventListener('click', () => void finishWelcome(ctx.store, playWith));

  const root = h(
    'div',
    { class: 'welcome' },
    h('header', { class: 'welcome-top' }, h('span', { class: 'brand' }, logo(40), APP_NAME), dots, skip),
    h('h1', { class: 'visually-hidden', 'data-title': 'Welcome' }, `Welcome to ${APP_NAME}`),
    progressText,
    body,
  );
  container.append(root);

  function heading(text: string): HTMLHeadingElement {
    return h('h2', { class: 'welcome-title', tabindex: -1 }, text);
  }

  function go(step: Step, focus = true): void {
    stepCleanup?.();
    stepCleanup = null;
    const view = STEPS[step]();
    body.replaceChildren(view.el);
    stepCleanup = view.cleanup ?? null;
    const n = STEP_NUMBER[step];
    root.dataset.step = step;
    progressText.textContent = `Step ${n} of 4`;
    [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i < n));
    if (focus) view.el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    view.after?.();
  }

  function backTo(step: Step, label = 'Back'): HTMLButtonElement {
    const b = h('button', { type: 'button', class: 'quiet' }, icon('back'), label);
    b.addEventListener('click', () => go(step));
    return b;
  }

  function next(text: string, step: Step): HTMLButtonElement {
    const b = h('button', { type: 'button', class: 'primary big' }, text);
    b.addEventListener('click', () => go(step));
    return b;
  }

  /** A big speech bubble that pops each time a key arrives; the first one gets a burst. */
  function keyCheer(waiting: string): { el: HTMLElement; hit(name: string, words: string): void; buddy: SVGSVGElement } {
    const buddy = mascot('curious', 'welcome-buddy');
    const note = h('span', { class: 'key-pop-note' }, '?');
    const words = h('span', { class: 'key-pop-words', 'aria-live': 'polite' }, waiting);
    const bubble = h('div', { class: 'key-pop' }, note, words);
    let first = true;
    return {
      el: h('div', { class: 'key-cheer' }, buddy, bubble),
      buddy,
      hit(name, text) {
        note.textContent = name;
        words.textContent = text;
        bubble.classList.remove('is-hit');
        void bubble.offsetWidth; // restart the pop
        bubble.classList.add('is-hit');
        if (first) {
          first = false;
          buddy.innerHTML = mascot('cheer').innerHTML;
          buddy.classList.add('is-cheering');
          celebrate(bubble, { calm: calm(), pieces: 34, spread: 220 });
        }
      },
    };
  }

  interface View {
    el: HTMLElement;
    cleanup?: () => void;
    /** Runs once the step is on the page. */
    after?: () => void;
  }

  const choice = (kind: PlayWith, art: IllustrationName, title: string, text: string): HTMLButtonElement => {
    const b = h(
      'button',
      { type: 'button', class: `choice choice-${kind}` },
      illustration(art, 'choice-art'),
      h('span', { class: 'choice-words' }, h('strong', {}, title), h('span', {}, text)),
    );
    b.addEventListener('click', () => {
      playWith = kind;
      go(kind);
    });
    return b;
  };

  const STEPS: Record<Step, () => View> = {
    hello: () => {
      const buddy = mascot('cheer', 'welcome-hero-mascot is-bobbing');
      return {
        el: h(
          'section',
          { class: 'welcome-step welcome-hello' },
          buddy,
          heading("Hi! Let's play the piano."),
          h('p', { class: 'welcome-lead' }, 'Fun from the very first key.'),
          h(
            'ul',
            { class: 'promise-chips' },
            h('li', { class: 'badge badge-cream' }, icon('heart'), 'Free forever'),
            h('li', { class: 'badge badge-cream' }, icon('check'), 'No account'),
            h('li', { class: 'badge badge-cream' }, icon('piano'), 'Any piano or none'),
          ),
          h('div', { class: 'welcome-actions' }, next("Let's go", 'how')),
        ),
      };
    },

    how: () => ({
      el: h(
        'section',
        { class: 'welcome-step welcome-how' },
        heading('How will you play?'),
        h(
          'div',
          { class: 'choices' },
          choice('midi', 'usb-piano', 'A digital piano or keyboard', inAppShell() ? 'With a cable or Bluetooth' : 'With a USB cable'),
          choice('keys', 'computer', 'No piano yet', computerKeys() ? 'Use your computer keys' : 'Tap the keys on screen'),
          choice('mic', 'acoustic', 'An acoustic piano', 'We listen with the mic'),
        ),
        h('p', { class: 'welcome-note' }, 'You can change this later in Settings.'),
        h('div', { class: 'welcome-actions' }, backTo('hello')),
      ),
    }),

    midi: () => {
      const host = h('div', { class: 'welcome-connect paper' });
      const cheer = keyCheer('Press any key on your piano');
      const el = h(
        'section',
        { class: 'welcome-step welcome-midi' },
        heading('Plug in your piano'),
        h(
          'ol',
          { class: 'plug-steps' },
          h('li', {}, h('span', { class: 'plug-num' }, '1'), 'Plug in the USB cable'),
          h('li', {}, h('span', { class: 'plug-num' }, '2'), 'Switch the piano on'),
          h('li', {}, h('span', { class: 'plug-num' }, '3'), 'Press Connect my piano'),
        ),
        h('div', { class: 'welcome-connect-row' }, host, cheer.el),
        h('div', { class: 'welcome-actions' }, next('Continue', 'ready'), backTo('how', 'Choose another way')),
      );
      // The step's own Continue button moves on, so the helper needs no Done button here.
      const off = mountPianoConnect(host, ctx, { headingLevel: 3 });
      const offDown = ctx.input.on('down', ({ midi, source }) => {
        if (source === 'midi') cheer.hit(fullNoteName(midi), 'It works!');
      });
      return {
        el,
        cleanup: () => {
          off();
          offDown();
        },
      };
    },

    keys: () => {
      const base = 60;
      const letters = keyLetters(base);
      const keys = h('div', { class: 'mini-keys', 'aria-hidden': 'true' });
      const keyEls = new Map<number, HTMLElement>();
      const whites: number[] = [];
      const letterEls: HTMLElement[] = [];
      for (let m = base; m <= base + 16; m++) {
        if (isBlack(m)) continue;
        const letter = h('span', { class: 'mini-key-letter' }, (letters.get(m) ?? '').toUpperCase());
        letterEls.push(letter);
        const k = h('span', { class: 'mini-key' }, letter);
        keyEls.set(m, k);
        whites.push(m);
        keys.append(k);
      }
      // A touch screen without a keyboard: no letters, just tapping. The letters come back once a real key is pressed.
      const title = heading('');
      const lead = h('p', { class: 'welcome-lead' });
      const heard = h('p', { class: 'welcome-heard', 'aria-live': 'polite' });
      let pressed = false;
      const words = (): void => {
        const typed = computerKeys();
        for (const l of letterEls) l.hidden = !typed;
        title.textContent = typed ? 'Play with your computer' : 'Play on the screen';
        lead.textContent = typed ? 'Your keyboard letters are piano keys. On a tablet, tap the keys.' : 'Tap the keys below. Each one plays a note.';
        if (!pressed) heard.textContent = typed ? 'Press Z, X or C, or tap a key.' : 'Tap a key.';
      };
      words();
      const offSeen = onKeyboardSeen(words);
      // Tapping or clicking the strip plays it too.
      const offPointer = ctx.sources.pointer.attach(keys, (x) => {
        const w = keys.clientWidth || 1;
        return whites[Math.min(whites.length - 1, Math.max(0, Math.floor((x / w) * whites.length)))] ?? null;
      });
      const previousBase = ctx.sources.keyboard.baseC;
      ctx.sources.keyboard.baseC = base;
      let first = true;
      const offDown = ctx.input.on('down', ({ midi, source }) => {
        const key = keyEls.get(midi);
        key?.classList.add('on');
        if (source === 'keyboard' || source === 'pointer') {
          pressed = true;
          heard.textContent = `That was ${fullNoteName(midi)}! You are ready.`;
          if (first) {
            first = false;
            celebrate(key ?? keys, { calm: calm() });
          }
        }
      });
      const offUp = ctx.input.on('up', ({ midi }) => keyEls.get(midi)?.classList.remove('on'));
      const el = h(
        'section',
        { class: 'welcome-step welcome-keys' },
        title,
        lead,
        keys,
        heard,
        h('div', { class: 'welcome-actions' }, next('Continue', 'ready'), backTo('how', 'Choose another way')),
      );
      return {
        el,
        cleanup: () => {
          offDown();
          offUp();
          offPointer();
          offSeen();
          ctx.sources.keyboard.baseC = previousBase;
        },
      };
    },

    mic: () => {
      const mic = ctx.sources.mic;
      const status = h('p', { class: 'welcome-heard', 'aria-live': 'polite' });
      const turnOn = h('button', { type: 'button', class: 'primary big' }, icon('mic'), 'Use my microphone');
      const meter = h('div', { class: 'meter-bar welcome-meter', 'aria-hidden': 'true' }, h('span', {}));
      let first = true;
      const render = (): void => {
        const on = ctx.settings.get().micEnabled;
        turnOn.hidden = on && mic.status !== 'denied' && mic.status !== 'error';
        switch (mic.status) {
          case 'asking':
            status.textContent = micAskingText(currentBrowser());
            break;
          case 'listening':
            if (first) status.textContent = 'Listening. Play one key on your piano.';
            break;
          case 'denied':
            status.textContent = micDeniedText(currentBrowser(), 'welcome');
            turnOn.lastChild!.textContent = 'Try again';
            break;
          case 'unsupported':
            status.textContent = micUnsupportedText(currentBrowser(), 'welcome');
            break;
          case 'error':
            status.textContent = 'The microphone did not start. Close other apps using it, then try again.';
            turnOn.lastChild!.textContent = 'Try again';
            break;
          default:
            status.textContent = on ? 'Starting the microphone...' : 'Nothing is recorded or sent anywhere.';
        }
      };
      turnOn.addEventListener('click', () => {
        ctx.audio.instrument.wake();
        if (ctx.settings.get().micEnabled) {
          // Asked before and refused: start again so the browser asks again.
          ctx.input.stop('mic');
          void ctx.input.start('mic');
        } else {
          ctx.settings.set({ micEnabled: true });
        }
        render();
      });
      const bar = meter.firstElementChild as HTMLElement;
      bar.style.width = '0%';
      const offChange = mic.onChange(render);
      const offLevel = mic.onLevel((rms) => {
        bar.style.width = `${Math.round(Math.min(1, rms * 8) * 100)}%`;
      });
      const offNote = mic.onNote((midi) => {
        status.textContent = `Heard ${fullNoteName(midi)}. It works!`;
        if (first) {
          first = false;
          celebrate(status, { calm: calm() });
        }
      });
      render();
      const el = h(
        'section',
        { class: 'welcome-step welcome-mic' },
        heading('Listen to your acoustic piano'),
        h('p', { class: 'welcome-lead' }, 'Put this device near the piano.'),
        h(
          'ul',
          { class: 'promise-chips' },
          h('li', { class: 'badge badge-cream' }, 'One note at a time works best'),
          h('li', { class: 'badge badge-cream' }, 'Headphones help'),
          h('li', { class: 'badge badge-cream' }, 'A quiet room helps'),
        ),
        h('div', { class: 'row welcome-mic-row' }, turnOn),
        meter,
        status,
        h('div', { class: 'welcome-actions' }, next('Continue', 'ready'), backTo('how', 'Choose another way')),
      );
      return {
        el,
        cleanup: () => {
          offChange();
          offLevel();
          offNote();
        },
      };
    },

    ready: () => {
      void finishWelcome(ctx.store, playWith);
      const title = heading("You're all set!");
      const pick = (mood: MascotMood) => mascot(mood, 'welcome-ready-mascot is-bobbing');
      const lesson = link({ screen: 'course', lessonId: allLessons()[0]?.id ?? '' }, '', { class: 'ready-card fill-sun' });
      lesson.append(unitArt(0, 'ready-art'), h('span', { class: 'ready-words' }, h('strong', {}, 'Start the first lesson'), h('span', {}, 'New to piano? Start here.')));
      const songs = link({ screen: 'home' }, '', { class: 'ready-card fill-coral' });
      songs.append(
        h('span', { class: 'ready-art ready-covers' }, songCover({ id: 'twinkle', tags: ['children'] }, 'ready-cover'), songCover({ id: 'elise', tags: ['classical'], by: 'Beethoven' }, 'ready-cover')),
        h('span', { class: 'ready-words' }, h('strong', {}, 'Browse the songs'), h('span', {}, 'Play a song you like.')),
      );
      return {
        el: h('section', { class: 'welcome-step welcome-ready' }, pick('cheer'), title, h('div', { class: 'ready-cards' }, lesson, songs)),
        after: () => {
          celebrate(title, { calm: calm(), pieces: 40, spread: 260 });
        },
      };
    },
  };

  go('hello', false);
  return () => {
    stepCleanup?.();
  };
}
