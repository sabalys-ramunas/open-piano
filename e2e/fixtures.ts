import { SILENCE_SCRIPT } from './silence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

/** Where screenshots go. Set E2E_SHOTS to keep them somewhere else. */
export const SHOTS = resolve(process.env.E2E_SHOTS ?? 'test-results/shots');
mkdirSync(SHOTS, { recursive: true });

export const SIZES = {
  desktop: { width: 1440, height: 900 },
  tabletLandscape: { width: 1024, height: 768 },
  tabletPortrait: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
} as const;
export type SizeName = keyof typeof SIZES;

export interface FakeMidiOptions {
  /** Pretend the browser already allowed MIDI (Permissions API says granted). */
  granted?: boolean;
  /** Plug the fake piano in from the start. */
  plugged?: boolean;
}

/** Shape of the fake Web MIDI controls the page exposes as window.__midi. */
export interface FakeMidiControl {
  requests: number;
  sent: number[][];
  plug(): void;
  unplug(): void;
  send(bytes: number[]): void;
}

declare global {
  interface Window {
    __midi: FakeMidiControl;
    __mic: { play(midi: number): void; stop(): void };
    __errors: string[];
  }
}

/**
 * Runs in the page before any app code: replaces navigator.requestMIDIAccess
 * with a fake piano (one input, one output with lit keys) that the test drives.
 */
function installFakeMidi(options: FakeMidiOptions): void {
  type Listener = (e: { data: Uint8Array; timeStamp: number }) => void;
  class FakePort {
    state: 'connected' | 'disconnected' = 'connected';
    connection = 'open';
    manufacturer = 'Test Instruments';
    version = '1.0';
    private handler: Listener | null = null;
    private listeners = new Set<Listener>();
    constructor(
      readonly id: string,
      readonly name: string,
      readonly type: 'input' | 'output',
    ) {}
    get onmidimessage(): Listener | null {
      return this.handler;
    }
    set onmidimessage(fn: Listener | null) {
      this.handler = fn;
    }
    addEventListener(type: string, fn: Listener): void {
      if (type === 'midimessage') this.listeners.add(fn);
    }
    removeEventListener(type: string, fn: Listener): void {
      if (type === 'midimessage') this.listeners.delete(fn);
    }
    deliver(bytes: number[]): void {
      if (this.state !== 'connected') return;
      const e = { data: new Uint8Array(bytes), timeStamp: performance.now() };
      this.handler?.(e);
      for (const l of this.listeners) l(e);
    }
    open(): Promise<this> {
      return Promise.resolve(this);
    }
    close(): Promise<this> {
      return Promise.resolve(this);
    }
    send(data: number[] | Uint8Array): void {
      control.sent.push([...data]);
    }
    clear(): void {}
  }
  const input = new FakePort('fake-in-1', 'Test Digital Piano', 'input');
  const output = new FakePort('fake-out-1', 'Test Digital Piano', 'output');
  const inputs = new Map<string, FakePort>();
  const outputs = new Map<string, FakePort>();
  type StateListener = (e: { port: FakePort }) => void;
  const access = {
    inputs,
    outputs,
    sysexEnabled: false,
    onstatechange: null as StateListener | null,
    listeners: new Set<StateListener>(),
    addEventListener(type: string, fn: StateListener) {
      if (type === 'statechange') this.listeners.add(fn);
    },
    removeEventListener(type: string, fn: StateListener) {
      if (type === 'statechange') this.listeners.delete(fn);
    },
    changed(port: FakePort) {
      this.onstatechange?.({ port });
      for (const l of this.listeners) l({ port });
    },
  };
  const control: FakeMidiControl = {
    requests: 0,
    sent: [],
    plug() {
      input.state = 'connected';
      output.state = 'connected';
      inputs.set(input.id, input);
      outputs.set(output.id, output);
      access.changed(input);
      access.changed(output);
    },
    unplug() {
      input.state = 'disconnected';
      output.state = 'disconnected';
      inputs.delete(input.id);
      outputs.delete(output.id);
      access.changed(input);
      access.changed(output);
    },
    send(bytes: number[]) {
      input.deliver(bytes);
    },
  };
  if (options.plugged !== false) {
    inputs.set(input.id, input);
    outputs.set(output.id, output);
  }
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: () => {
      control.requests += 1;
      try {
        localStorage.setItem('e2e:midi-granted', '1'); // like Chrome, remember the permission
      } catch {
        /* ignore */
      }
      return Promise.resolve(access);
    },
  });
  const realQuery = navigator.permissions?.query.bind(navigator.permissions);
  if (navigator.permissions && realQuery) {
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true,
      value: (descriptor: { name: string }) => {
        if (descriptor.name === 'midi') {
          let remembered = false;
          try {
            remembered = localStorage.getItem('e2e:midi-granted') === '1';
          } catch {
            /* ignore */
          }
          return Promise.resolve({ state: options.granted || remembered ? 'granted' : 'prompt', onchange: null });
        }
        return realQuery(descriptor as PermissionDescriptor);
      },
    });
  }
  window.__midi = control;

  // Headless Chromium on macOS never answers getUserMedia({ audio }) even with the fake
  // capture device (it waits for the system microphone permission). Stand in with a
  // tone generator the test can play notes on, so the app's listening code still runs.
  const media = navigator.mediaDevices;
  if (media && typeof media.getUserMedia === 'function') {
    const real = media.getUserMedia.bind(media);
    let tone: { ctx: AudioContext; osc: OscillatorNode; gain: GainNode; dest: MediaStreamAudioDestinationNode } | null = null;
    const ensure = () => {
      if (tone) return tone;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      gain.gain.value = 0;
      osc.connect(gain).connect(dest);
      osc.start();
      tone = { ctx, osc, gain, dest };
      return tone;
    };
    Object.defineProperty(media, 'getUserMedia', {
      configurable: true,
      value: (constraints?: MediaStreamConstraints) => {
        if (!constraints?.audio || constraints.video) return real(constraints);
        const t = ensure();
        void t.ctx.resume();
        return Promise.resolve(t.dest.stream);
      },
    });
    window.__mic = {
      play(midi: number) {
        const t = ensure();
        t.osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
        t.gain.gain.setTargetAtTime(0.5, t.ctx.currentTime, 0.005);
      },
      stop() {
        if (tone) tone.gain.gain.setTargetAtTime(0, tone.ctx.currentTime, 0.01);
      },
    };
  }
}

export interface Fixtures {
  midi: FakeMidiOptions;
  /** Console errors that this test expects (matched by substring). */
  allowErrors: string[];
  errors: string[];
  piano: Piano;
}

/** Drives the fake USB piano from the test. */
export class Piano {
  constructor(private page: Page) {}
  async down(midi: number, velocity = 90): Promise<void> {
    await this.page.evaluate(([m, v]) => window.__midi.send([0x90, m, v]), [midi, velocity] as const);
  }
  async up(midi: number): Promise<void> {
    await this.page.evaluate((m) => window.__midi.send([0x80, m, 0]), midi);
  }
  async tap(midi: number, holdMs = 60, velocity = 90): Promise<void> {
    await this.down(midi, velocity);
    await this.page.waitForTimeout(holdMs);
    await this.up(midi);
  }
  async pedal(on: boolean): Promise<void> {
    await this.page.evaluate((v) => window.__midi.send([0xb0, 64, v]), on ? 127 : 0);
  }
  async plug(): Promise<void> {
    await this.page.evaluate(() => window.__midi.plug());
  }
  async unplug(): Promise<void> {
    await this.page.evaluate(() => window.__midi.unplug());
  }
  async requests(): Promise<number> {
    return this.page.evaluate(() => window.__midi.requests);
  }
  async sent(): Promise<number[][]> {
    return this.page.evaluate(() => window.__midi.sent);
  }
}

export const test = base.extend<Fixtures>({
  midi: [{ granted: false, plugged: true }, { option: true }],
  allowErrors: [[], { option: true }],
  errors: async ({ page, allowErrors }, use) => {
    const errors: string[] = [];
    const allowed = (text: string): boolean => allowErrors.some((a) => text.includes(a));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!allowed(text)) errors.push(`console: ${text}`);
    });
    page.on('pageerror', (err) => {
      const text = `${err.name}: ${err.message}`;
      if (!allowed(text)) errors.push(`pageerror: ${text}\n${err.stack ?? ''}`);
    });
    await use(errors);
    expect(errors, 'no console errors or uncaught page errors').toEqual([]);
  },
  page: async ({ page, midi }, use) => {
    await page.addInitScript(SILENCE_SCRIPT); // never play through the speakers
    await page.addInitScript(installFakeMidi, midi);
    await use(page);
  },
  piano: async ({ page }, use) => {
    await use(new Piano(page));
  },
});

// Every test checks the console, even when it does not ask for `errors` itself.
test.beforeEach(async ({ errors }) => {
  void errors;
});

export { expect };

/** Saves a full-viewport screenshot as <name>.png in the shots folder. */
export async function shot(page: Page, name: string, fullPage = false, animations: 'allow' | 'disabled' = 'disabled'): Promise<void> {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage, animations });
}

/** Opens the app with the welcome already finished, at the given route. */
export async function openApp(page: Page, route = '#/'): Promise<void> {
  await page.goto('/');
  await finishWelcomeInStore(page);
  await page.goto(`/${route}`);
  await page.locator('#screen h1').first().waitFor({ state: 'attached' });
}

/** Writes a value straight into the app's IndexedDB key-value table. */
export async function putValue(page: Page, key: string, value: unknown): Promise<void> {
  await putRecord(page, 'kv', key, value);
}

/** Writes a record straight into one of the app's IndexedDB tables (songs, audio, kv, progress, lessons). */
export async function putRecord(page: Page, table: string, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    async ([table, k, v]) => {
      await new Promise<void>((done, reject) => {
        const open = indexedDB.open('piano', 1);
        open.onupgradeneeded = () => {
          for (const t of ['songs', 'audio', 'kv', 'progress', 'lessons']) {
            if (!open.result.objectStoreNames.contains(t)) open.result.createObjectStore(t);
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(table, 'readwrite');
          tx.objectStore(table).put(v, k);
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    [table, key, value] as const,
  );
}

/** Marks the first-run welcome as finished. */
export async function finishWelcomeInStore(page: Page): Promise<void> {
  await page.locator('#screen').waitFor({ state: 'attached' });
  await putValue(page, 'app:welcome', { done: true, playWith: 'midi' });
}
