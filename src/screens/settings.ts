import '../styles/settings.css';
import type { AppContext } from '../app/context';
import { APP_NAME } from '../app/brand';
import { h } from '../app/dom';
import { absoluteUrl, cleanCatalogUrl, DEFAULT_CATALOG_URL } from '../community/catalog';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import type { Settings } from '../app/settings';
import { computerKeys, inAppShell } from '../app/shell';
import { pageTitle } from '../app/title';
import { midiOutput } from '../audio/bridge';
import { INSTRUMENT_KINDS, INSTRUMENT_LABELS, type InstrumentKind } from '../audio/instrument';
import { onPianoStatus, pianoStatus, type PianoStatus } from '../audio/sampler';
import { currentBrowser, micAskingText, micDeniedText, micUnsupportedText } from '../input/browser';
import { fullNoteName, mountPianoConnect, tipList } from '../input/connect-ui';
import { mountTimingCheck } from '../input/timing-ui';
import { icon } from '../ui/icons';
import { illustration, type IllustrationName } from '../ui/illustrations';
import { mascot } from '../ui/mascot';

type Cleanups = (() => void)[];
type SectionId = 'piano' | 'sound' | 'mic' | 'timing' | 'display' | 'about';

/** Words for a 0..1 slider position, so nobody has to read numbers. */
function amountWord(v: number, words: readonly [string, string, string]): string {
  return v < 0.34 ? words[0] : v < 0.67 ? words[1] : words[2];
}

/**
 * A slider bound to a 0..1 setting, with words at both ends (Quiet, Loud)
 * instead of numbers. Screen readers hear the word and the percentage.
 */
function slider(
  ctx: AppContext,
  key: 'volume' | 'reverb' | 'metronomeVolume' | 'micSensitivity',
  label: string,
  ends: readonly [string, string, string],
  cleanups: Cleanups,
  hint?: string,
): HTMLElement {
  const id = `set-${key}`;
  const value = ctx.settings.get()[key];
  const text = (v: number) => `${amountWord(v, ends)}, ${Math.round(v * 100)}%`;
  const input = h('input', { type: 'range', id, min: 0, max: 1, step: 0.05, value, 'aria-valuetext': text(value), 'aria-describedby': hint ? `${id}-help` : null });
  input.addEventListener('input', () => {
    ctx.settings.set({ [key]: Number(input.value) } as Partial<Settings>);
  });
  cleanups.push(
    ctx.settings.subscribe((s, changed) => {
      if (!changed.includes(key)) return;
      input.value = String(s[key]);
      input.setAttribute('aria-valuetext', text(s[key]));
    }),
  );
  return h(
    'div',
    { class: 'field st-slider' },
    h('label', { for: id }, label),
    input,
    h('div', { class: 'slider-words', 'aria-hidden': 'true' }, h('span', {}, ends[0]), h('span', {}, ends[2])),
    hint ? h('p', { id: `${id}-help`, class: 'hint' }, hint) : null,
  );
}

/** A big on/off switch bound to a boolean setting. */
function toggle(
  ctx: AppContext,
  key: 'showKeyLetters' | 'showNoteNames' | 'reduceMotion' | 'fixedVelocity' | 'micEnabled',
  label: string,
  cleanups: Cleanups,
  hint?: string,
): HTMLElement {
  const id = `set-${key}`;
  const box = h('input', { type: 'checkbox', role: 'switch', id, checked: ctx.settings.get()[key], 'aria-describedby': hint ? `${id}-help` : null });
  box.addEventListener('change', () => ctx.settings.set({ [key]: box.checked } as Partial<Settings>));
  cleanups.push(
    ctx.settings.subscribe((s, changed) => {
      if (changed.includes(key)) box.checked = s[key];
    }),
  );
  return h(
    'div',
    { class: 'st-switch' },
    h('label', { class: 'toggle', for: id }, h('span', {}, label), box),
    hint ? h('p', { id: `${id}-help`, class: 'hint' }, hint) : null,
  );
}

/** A group of buttons acting as one choice (aria-pressed), bound to a string setting. */
function choice<K extends 'velocityCurve' | 'instrument'>(
  ctx: AppContext,
  key: K,
  label: string,
  options: readonly { value: Settings[K]; text: string }[],
  cleanups: Cleanups,
  hint?: string,
): HTMLElement {
  const id = `set-${key}`;
  const buttons = options.map((o) =>
    h('button', { type: 'button', 'data-value': String(o.value), 'aria-pressed': String(ctx.settings.get()[key] === o.value) }, o.text),
  );
  buttons.forEach((b, i) => b.addEventListener('click', () => ctx.settings.set({ [key]: options[i].value } as Partial<Settings>)));
  cleanups.push(
    ctx.settings.subscribe((s, changed) => {
      if (!changed.includes(key)) return;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === String(s[key])));
    }),
  );
  return h(
    'div',
    { class: 'field' },
    h('span', { id: `${id}-label`, class: 'label' }, label),
    h('div', { class: 'segmented settings-segmented', role: 'group', 'aria-labelledby': `${id}-label` }, ...buttons),
    hint ? h('p', { class: 'hint' }, hint) : null,
  );
}

/** Everything advanced, folded away. */
function moreOptions(...children: (Node | null)[]): HTMLElement {
  return h('details', { class: 'more-options' }, h('summary', {}, 'More options'), h('div', { class: 'more-options-body' }, ...children));
}

/** A numbered step with one action. */
function guideStep(n: number, title: string, ...children: (Node | null)[]): HTMLElement {
  return h('li', { class: 'st-step card' }, h('span', { class: 'guide-num', 'aria-hidden': 'true' }, String(n)), h('div', { class: 'st-step-body' }, h('h3', {}, title), ...children));
}

interface Section {
  id: SectionId;
  title: string;
  art: IllustrationName;
  fill: string;
  summary: () => string;
  body: (Node | null)[];
}

/**
 * #/settings: a calm list of big picture cards (My piano, Sound, Microphone,
 * Timing, Display, About). Each opens a focused page with a few large
 * controls; anything advanced is folded under "More options". The browser's
 * back button closes a page (it is a history entry on the same address).
 */
export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  void route;
  const cleanups: Cleanups = [];
  const midi = ctx.sources.midi;
  const mic = ctx.sources.mic;

  // ---------- My piano ----------
  const connectHost = h('div', { class: 'st-connect' });
  cleanups.push(mountPianoConnect(connectHost, ctx, { big: true }));

  const deviceList = h('ul', { class: 'settings-devices', 'aria-label': 'Pianos and keyboards' });
  const devicesBlock = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Your keyboards'), deviceList);
  const renderDevices = (): void => {
    const ports = midi.ports();
    devicesBlock.hidden = ports.length === 0;
    deviceList.replaceChildren(
      ...ports.map((p, i) => {
        const id = `set-device-${i}`;
        const box = h('input', { type: 'checkbox', role: 'switch', id, checked: p.enabled });
        box.addEventListener('change', () => {
          const off = new Set(ctx.settings.get().midiDisabled);
          if (box.checked) off.delete(p.name);
          else off.add(p.name);
          ctx.settings.set({ midiDisabled: [...off] });
        });
        return h('li', {}, h('label', { class: 'toggle', for: id }, h('span', {}, p.name, p.connected ? null : h('span', { class: 'muted' }, ' (unplugged)')), box));
      }),
    );
  };

  const touch = choice(
    ctx,
    'velocityCurve',
    'How hard to press',
    [
      { value: 'light', text: 'Light' },
      { value: 'normal', text: 'Normal' },
      { value: 'heavy', text: 'Heavy' },
    ],
    cleanups,
    'Light: soft playing sounds full.',
  );
  const fixed = toggle(ctx, 'fixedVelocity', 'Every key equally loud', cleanups, 'For keyboards without touch response.');

  const outputSelect = h('select', { id: 'set-midi-output', 'aria-describedby': 'set-midi-output-help' });
  const renderOutputs = (): void => {
    const names = midiOutput()?.list() ?? [];
    const chosen = ctx.settings.get().midiOutput;
    const all = chosen && !names.includes(chosen) ? [...names, chosen] : names;
    outputSelect.replaceChildren(h('option', { value: '' }, 'Off'), ...all.map((n) => h('option', { value: n }, names.includes(n) ? n : `${n} (unplugged)`)));
    outputSelect.value = chosen;
    outputSelect.disabled = all.length === 0;
  };
  outputSelect.addEventListener('change', () => ctx.settings.set({ midiOutput: outputSelect.value }));
  const output = h(
    'div',
    { class: 'field' },
    h('label', { for: 'set-midi-output' }, 'Play the app\'s notes on my piano'),
    outputSelect,
    h('p', { id: 'set-midi-output-help', class: 'hint' }, 'Your piano plays the other hand, and light-up keys light.'),
  );

  // ---------- Sound ----------
  const instrument = choice(ctx, 'instrument', 'Piano sound', INSTRUMENT_KINDS.map((k: InstrumentKind) => ({ value: k, text: INSTRUMENT_LABELS[k] })), cleanups);
  const loadStatus = h('p', { class: 'hint st-load', 'aria-live': 'polite' });
  const renderLoad = (st: PianoStatus): void => {
    if (ctx.settings.get().instrument !== 'piano') {
      loadStatus.textContent = '';
      return;
    }
    switch (st.state) {
      case 'idle':
        loadStatus.textContent = 'The grand piano (3 MB) downloads once, on your first note.';
        break;
      case 'loading':
        loadStatus.textContent = `Getting the grand piano ready: ${Math.round((st.loaded / st.total) * 100)}%.`;
        break;
      case 'ready':
        loadStatus.textContent = 'The grand piano is ready.';
        break;
      case 'partial':
        loadStatus.textContent = 'A few notes did not download. Nearby notes fill in.';
        break;
      case 'failed':
        loadStatus.textContent = inAppShell()
          ? 'The grand piano did not download, so the simple piano plays. Check your internet, then close and reopen the app.'
          : 'The grand piano did not download, so the simple piano plays. Check your internet and reload.';
        break;
    }
  };
  renderLoad(pianoStatus());
  cleanups.push(onPianoStatus(renderLoad));
  cleanups.push(
    ctx.settings.subscribe((_s, changed) => {
      if (changed.includes('instrument')) renderLoad(pianoStatus());
    }),
  );

  const testSound = h('button', { type: 'button', class: 'primary big' }, icon('speaker'), 'Play a test sound');
  testSound.addEventListener('click', () => {
    ctx.audio.instrument.wake();
    [60, 64, 67, 72].forEach((m, i) => window.setTimeout(() => ctx.audio.instrument.play(m, 0.9, 0.55 + i * 0.1), i * 180));
    window.setTimeout(() => [48, 60, 64, 67].forEach((m) => ctx.audio.instrument.play(m, 1.6, 0.6)), 800);
  });
  const metronomeTry = h('button', { type: 'button' }, 'Try the metronome');
  let metronomeBusy = false;
  metronomeTry.addEventListener('click', () => {
    if (metronomeBusy) {
      ctx.audio.metronome.stop();
      return;
    }
    ctx.audio.instrument.wake();
    metronomeBusy = true;
    metronomeTry.textContent = 'Stop';
    void ctx.audio.metronome.countIn({ beats: 8, bpm: 100, beatsPerBar: 4 }).then(() => {
      metronomeBusy = false;
      metronomeTry.textContent = 'Try the metronome';
    });
  });
  cleanups.push(() => {
    if (metronomeBusy) ctx.audio.metronome.stop();
  });

  // ---------- Microphone ----------
  const micStatus = h('p', { class: 'st-mic-status', 'aria-live': 'polite' });
  const meterFill = h('div', { class: 'settings-meter-fill' });
  const meter = h('div', { class: 'settings-meter', role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, meterFill);
  const heard = h('p', { class: 'settings-heard', 'aria-live': 'polite' });
  const noiseButton = h('button', { type: 'button', disabled: true }, icon('mic'), 'Measure room noise');
  const noiseStatus = h('p', { class: 'hint', 'aria-live': 'polite' });
  const recent: string[] = [];
  const renderMic = (): void => {
    const on = ctx.settings.get().micEnabled;
    const listening = mic.listening;
    noiseButton.disabled = !listening;
    meter.hidden = !listening;
    switch (mic.status) {
      case 'off':
        micStatus.textContent = on ? 'Starting the microphone...' : 'The microphone is off.';
        break;
      case 'asking':
        micStatus.textContent = micAskingText(currentBrowser());
        break;
      case 'listening':
        micStatus.textContent = `Listening${mic.deviceName ? ` with ${mic.deviceName}` : ''}.`;
        break;
      case 'denied':
        micStatus.textContent = micDeniedText(currentBrowser(), 'settings');
        break;
      case 'unsupported':
        micStatus.textContent = micUnsupportedText(currentBrowser(), 'settings');
        break;
      case 'error':
        micStatus.textContent = 'The microphone did not open. Is another app using it? Switch it off and on to retry.';
        break;
    }
    if (!listening) heard.textContent = 'Switch it on first.';
    else if (!recent.length) heard.textContent = 'Play a note. We show what we hear.';
  };
  let meterFrame = 0;
  let level = 0;
  cleanups.push(
    mic.onLevel((rms) => {
      level = Math.max(rms, level * 0.9);
      if (meterFrame) return;
      meterFrame = requestAnimationFrame(() => {
        meterFrame = 0;
        // About -60 dB to 0 dB across the bar.
        const pct = Math.max(0, Math.min(100, ((20 * Math.log10(level + 1e-6) + 60) / 60) * 100));
        meterFill.style.width = `${pct}%`;
        meter.setAttribute('aria-valuenow', String(Math.round(pct)));
      });
    }),
    () => cancelAnimationFrame(meterFrame),
  );
  cleanups.push(
    mic.onNote((m) => {
      recent.push(fullNoteName(m));
      if (recent.length > 8) recent.shift();
      heard.replaceChildren('Heard: ', ...recent.map((n) => h('span', { class: 'st-heard-note' }, n)));
    }),
  );
  noiseButton.addEventListener('click', () => {
    noiseButton.disabled = true;
    noiseStatus.textContent = 'Shh... two seconds.';
    void mic.measureNoise(2000).then((floor) => {
      noiseButton.disabled = !mic.listening;
      if (floor === null) {
        noiseStatus.textContent = 'The microphone is not listening, so nothing was measured.';
        return;
      }
      ctx.settings.set({ micNoiseFloor: floor });
      noiseStatus.textContent = floor > 0.05 ? 'Done. It is noisy here, so some notes may be missed.' : 'Done. Quiet sounds below this are ignored.';
    });
  });
  renderMic();
  cleanups.push(mic.onChange(renderMic));
  cleanups.push(
    ctx.settings.subscribe((_s, changed) => {
      if (changed.includes('micEnabled')) renderMic();
    }),
  );

  // ---------- Timing ----------
  const timingHost = h('div');
  cleanups.push(mountTimingCheck(timingHost, ctx));

  // ---------- Shared songs list (under About) ----------
  const addressInput = h('input', {
    type: 'url',
    id: 'set-catalog',
    autocomplete: 'off',
    inputmode: 'url',
    placeholder: absoluteUrl(DEFAULT_CATALOG_URL) ?? DEFAULT_CATALOG_URL,
    'aria-describedby': 'set-catalog-help set-catalog-status',
  });
  const addressSave = h('button', { type: 'submit' }, 'Save');
  const addressReset = h('button', { type: 'button', class: 'quiet' }, 'Use the built-in list');
  const addressStatus = h('p', { class: 'hint', id: 'set-catalog-status', 'aria-live': 'polite' });
  const showAddress = (): void => {
    const saved = ctx.settings.get().catalogUrl;
    addressInput.value = saved;
    addressReset.hidden = saved === '';
  };
  showAddress();
  const addressForm = h(
    'form',
    // Our own check and words below, instead of the browser's "Please enter a URL" bubble.
    { class: 'settings-address', novalidate: true },
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'set-catalog' }, 'Shared songs list'),
      addressInput,
      h('p', { id: 'set-catalog-help', class: 'hint' }, 'Empty means the list that comes with the app. A teacher can give you another.'),
    ),
    h('div', { class: 'row' }, addressSave, addressReset),
    addressStatus,
  );
  addressForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const clean = cleanCatalogUrl(addressInput.value);
    if (clean === null) {
      addressStatus.textContent = 'That does not look like a web address. It should start with https://';
      addressInput.focus();
      return;
    }
    ctx.settings.set({ catalogUrl: clean });
    addressStatus.textContent = clean ? 'Saved. Shared songs now come from this list.' : 'Saved. Using the built-in list.';
  });
  addressReset.addEventListener('click', () => {
    ctx.settings.set({ catalogUrl: '' });
    addressStatus.textContent = 'Using the built-in list.';
    addressInput.focus();
  });
  cleanups.push(
    ctx.settings.subscribe((_s, changed) => {
      if (changed.includes('catalogUrl')) showAddress();
    }),
  );

  const welcomeAgain = h('button', { type: 'button' }, 'Show the welcome again');
  welcomeAgain.addEventListener('click', () => ctx.navigate({ screen: 'welcome' }));

  // ---------- The sections ----------
  const sections: Section[] = [
    {
      id: 'piano',
      title: 'My piano',
      art: 'usb-piano',
      fill: 'fill-sun',
      summary: () =>
        midi.devices.length ? `${midi.devices.join(', ')} is connected` : midi.status === 'unsupported' && !inAppShell() ? 'No piano cable in this browser' : 'Connect a piano with a cable',
      body: [
        connectHost,
        h('div', { class: 'card st-panel' }, touch),
        moreOptions(
          fixed,
          devicesBlock,
          output,
          keyRangeLine(ctx, cleanups),
          h('h3', { class: 'st-subhead' }, 'Questions'),
          tipList(
            [
              ['Hearing every note twice?', 'The app and your piano both play. Turn the app\'s volume down in Sound, or set "Play the app\'s notes on my piano" to Off.'],
              ['My piano went silent', 'Its Local Control may be off. Switch it back on in the piano\'s menu, or switch the piano off and on.'],
              ...pianoQuestions(),
              ['More than one keyboard?', 'Plug in as many as you like. Unplugging while playing is fine.'],
            ],
            'connect-tips',
          ),
        ),
      ],
    },
    {
      id: 'sound',
      title: 'Sound',
      art: 'sound',
      fill: 'fill-coral',
      summary: () => {
        const s = ctx.settings.get();
        return `${INSTRUMENT_LABELS[s.instrument]} · ${amountWord(s.volume, ['Quiet', 'Medium', 'Loud'])}`;
      },
      body: [
        h('div', { class: 'card st-panel' }, instrument, loadStatus, slider(ctx, 'volume', 'Volume', ['Quiet', 'Medium', 'Loud'], cleanups), h('div', { class: 'st-actions' }, testSound)),
        moreOptions(
          slider(ctx, 'reverb', 'Room echo', ['Dry', 'Room', 'Big hall'], cleanups),
          slider(ctx, 'metronomeVolume', 'Metronome', ['Soft', 'Medium', 'Loud'], cleanups),
          h('div', { class: 'row' }, metronomeTry),
        ),
      ],
    },
    {
      id: 'mic',
      title: 'Microphone',
      art: 'mic',
      fill: 'fill-mint',
      summary: () => (ctx.settings.get().micEnabled ? 'On, listening to your piano' : 'For pianos without a cable'),
      body: [
        h(
          'p',
          { class: 'st-honest' },
          icon('info'),
          h('span', {}, 'For acoustic pianos. It hears one note at a time best; big chords may be partly missed. A cable is always more reliable.'),
        ),
        h(
          'ol',
          { class: 'st-steps' },
          guideStep(1, 'Switch it on', toggle(ctx, 'micEnabled', 'Listen to my piano', cleanups), micStatus),
          guideStep(2, 'Play a note', meter, heard),
          guideStep(3, 'Hush for two seconds', h('p', { class: 'hint' }, 'So we know what quiet sounds like.'), h('div', { class: 'row' }, noiseButton), noiseStatus),
        ),
        moreOptions(
          slider(ctx, 'micSensitivity', 'How closely it listens', ['Hears less', 'Medium', 'Hears more'], cleanups, 'Turn it down if notes appear that you did not play.'),
          h('h3', { class: 'st-subhead' }, 'Tips'),
          tipList(
            [
              ['Use headphones', 'Then the microphone only hears your piano, not the app.'],
              ['Get close', 'Put the device near the piano, in a quiet room.'],
              ['A little slower', 'The microphone hears notes a moment later than a cable, so fast songs are harder.'],
            ],
            'connect-tips',
          ),
        ),
      ],
    },
    {
      id: 'timing',
      title: 'Timing',
      art: 'timing',
      fill: 'fill-sky',
      summary: () => {
        const ms = ctx.settings.get().latencyMs;
        return ms === 0 ? 'Check that "on time" feels right' : 'Checked and adjusted';
      },
      body: [h('div', { class: 'card st-panel' }, timingHost)],
    },
    {
      id: 'display',
      title: 'Display',
      art: 'display',
      fill: 'fill-paper',
      summary: () => {
        const s = ctx.settings.get();
        return `Note names ${s.showNoteNames ? 'on' : 'off'}${s.reduceMotion ? ' · Calm' : ''}`;
      },
      body: [
        h(
          'div',
          { class: 'card st-panel st-switches' },
          toggle(ctx, 'showNoteNames', 'Note names on falling notes', cleanups),
          // On a touch screen without a keyboard there are no computer keys to show.
          computerKeys() ? toggle(ctx, 'showKeyLetters', 'Computer keys on the piano', cleanups) : null,
          toggle(ctx, 'reduceMotion', 'Fewer moving effects', cleanups),
        ),
      ],
    },
    {
      id: 'about',
      title: 'About',
      art: 'about',
      fill: 'fill-ocean',
      summary: () => 'Free, open, no account',
      body: [
        h(
          'div',
          { class: 'card st-panel st-about' },
          mascot('happy', 'st-about-mascot'),
          h('p', { class: 'st-about-lead' }, `${APP_NAME} is free and open source. No account. Your songs stay on this device.`),
          h('div', { class: 'row' }, welcomeAgain),
        ),
        moreOptions(
          addressForm,
          h('h3', { class: 'st-subhead' }, 'The piano sound'),
          h(
            'p',
            { class: 'hint' },
            'The Salamander Grand Piano by Alexander Holm (a Yamaha C5), under the ',
            h('a', { href: 'https://creativecommons.org/licenses/by/3.0/', target: '_blank', rel: 'noopener noreferrer' }, 'Creative Commons Attribution 3.0 licence'),
            '. We use a small, shortened part of it. ',
            h('a', { href: `${import.meta.env.BASE_URL}samples/piano/CREDITS.txt`, target: '_blank', rel: 'noopener' }, 'Full credits'),
            '.',
          ),
        ),
      ],
    },
  ];

  // ---------- Home: big picture cards ----------
  const summaries = new Map<SectionId, HTMLElement>();
  const cards = new Map<SectionId, HTMLButtonElement>();
  const cardList = h(
    'ul',
    { class: 'st-cards' },
    ...sections.map((s) => {
      const line = h('span', { class: 'st-card-summary' }, s.summary());
      summaries.set(s.id, line);
      const b = h(
        'button',
        { type: 'button', class: `st-card ${s.fill}`, 'aria-describedby': `st-sum-${s.id}` },
        illustration(s.art, 'st-card-art'),
        h('span', { class: 'st-card-text' }, h('span', { class: 'st-card-title' }, s.title), line),
        h('span', { class: 'st-card-go', 'aria-hidden': 'true' }, icon('forward')),
      );
      line.id = `st-sum-${s.id}`;
      b.addEventListener('click', () => open(s.id, true));
      cards.set(s.id, b);
      return h('li', {}, b);
    }),
  );
  const home = h(
    'div',
    { class: 'st-home' },
    h('header', { class: 'st-top' }, h('h1', { class: 'st-title' }, 'Settings'), h('p', { class: 'st-sub' }, 'Make it yours. Changes save by themselves.')),
    cardList,
  );

  // ---------- Pages ----------
  const pages = new Map<SectionId, HTMLElement>();
  for (const s of sections) {
    const back = h('button', { type: 'button', class: 'back-link st-back' }, 'Settings');
    back.addEventListener('click', () => close());
    const page = h(
      'section',
      { class: `st-page st-page-${s.id}`, id: `settings-${s.id}`, 'aria-labelledby': `settings-${s.id}-title`, hidden: true },
      back,
      h('div', { class: 'st-page-head' }, h('span', { class: `st-page-badge ${s.fill}` }, illustration(s.art, 'st-page-art')), h('h2', { id: `settings-${s.id}-title`, tabindex: -1 }, s.title)),
      ...s.body,
    );
    pages.set(s.id, page);
  }
  container.append(h('div', { class: 'st' }, home, ...pages.values()));

  let current: SectionId | null = null;
  const isSection = (x: unknown): x is SectionId => typeof x === 'string' && sections.some((s) => s.id === x);

  function show(id: SectionId | null): void {
    const was = current;
    current = id;
    home.hidden = id !== null;
    for (const [pid, page] of pages) page.hidden = pid !== id;
    const section = sections.find((s) => s.id === id);
    pageTitle(section ? `${section.title} · Settings` : 'Settings');
    window.scrollTo(0, 0);
    if (id) pages.get(id)?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    else if (was) cards.get(was)?.focus({ preventScroll: true });
  }

  function open(id: SectionId, push: boolean): void {
    if (push) history.pushState({ ...(history.state as object | null), settings: id }, '', location.href);
    show(id);
  }

  function close(): void {
    const state = history.state as { settings?: unknown } | null;
    if (isSection(state?.settings)) history.back();
    else show(null);
  }

  const onPop = (): void => {
    const state = history.state as { settings?: unknown } | null;
    show(isSection(state?.settings) ? state.settings : null);
  };
  window.addEventListener('popstate', onPop);
  cleanups.push(() => window.removeEventListener('popstate', onPop));
  // Coming back to this address (or reloading) reopens the page that was open.
  const initial = (history.state as { settings?: unknown } | null)?.settings;
  if (isSection(initial)) {
    current = initial;
    home.hidden = true;
    pages.get(initial)!.hidden = false;
  }

  const refreshSummaries = (): void => {
    for (const s of sections) summaries.get(s.id)!.textContent = s.summary();
  };
  cleanups.push(ctx.settings.subscribe(refreshSummaries));

  renderDevices();
  renderOutputs();
  cleanups.push(
    midi.onChange(() => {
      renderDevices();
      renderOutputs();
      refreshSummaries();
    }),
  );
  cleanups.push(
    ctx.settings.subscribe((_s, changed) => {
      if (changed.includes('midiDisabled')) renderDevices();
      if (changed.includes('midiOutput')) renderOutputs();
    }),
  );

  return () => {
    for (const c of cleanups.splice(0)) c();
  };
}

/**
 * "Which browsers work?" and "iPhone or iPad?", worded for where the app runs.
 * Inside the iPad/iPhone app there is no browser to talk about.
 */
export function pianoQuestions(app = inAppShell()): [string, string][] {
  if (app) {
    return [
      ['How do I connect?', 'Plug the piano into this iPad or iPhone with a USB cable (most need a USB-C or Lightning adapter). A Bluetooth piano: press Pair a Bluetooth piano above.'],
      ['Acoustic piano?', 'Use the microphone. Turn it on in Microphone.'],
    ];
  }
  return [
    ['Which browsers work?', 'Chrome, Edge and Opera on computers and Chromebooks, Chrome on Android, and Firefox after you allow it.'],
    ['iPhone or iPad?', `Their browsers cannot connect a piano yet. Use the microphone or the on-screen keys, or get the ${APP_NAME} app for iPad, which can.`],
  ];
}

/** Shows the saved keyboard size, with a way back to a full piano. */
function keyRangeLine(ctx: AppContext, cleanups: Cleanups): HTMLElement {
  const text = h('span', {});
  const reset = h('button', { type: 'button', class: 'quiet small' }, 'Use a full 88-key piano');
  const render = (): void => {
    const { keyLow, keyHigh } = ctx.settings.get();
    const keys = keyHigh - keyLow + 1;
    text.textContent = keyLow === 21 && keyHigh === 108 ? 'Keyboard: full piano (88 keys).' : `Keyboard: ${keys} keys, ${fullNoteName(keyLow)} to ${fullNoteName(keyHigh)}.`;
    reset.hidden = keyLow === 21 && keyHigh === 108;
  };
  reset.addEventListener('click', () => ctx.settings.set({ keyLow: 21, keyHigh: 108 }));
  render();
  cleanups.push(
    ctx.settings.subscribe((_s, changed) => {
      if (changed.includes('keyLow') || changed.includes('keyHigh')) render();
    }),
  );
  return h('div', { class: 'row settings-range' }, text, reset);
}
