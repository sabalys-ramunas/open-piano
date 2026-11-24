import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openApp, shot } from './fixtures';
import { renderBand, renderMelody, writeTemp } from './media';

/**
 * Song splitting: the offer in the add-song dialog (skipping it imports as before), splitting on
 * import with a local copy of the splitter, the three-way sound choice in the player (kept across
 * a reload), and "Split this song" for a song added without it.
 *
 * The splitter's networks (about 80 MB) are not in git. Tests that need them look for the local
 * copy in public/models/spleeter-4stems/ and are skipped without it. Nothing is ever fetched from
 * outside: requests to other sites fail the test.
 */

const MODEL_DIR = resolve(import.meta.dirname, '../public/models/spleeter-4stems');
const haveModel = ['vocals', 'drums', 'bass', 'other'].every((s) => existsSync(resolve(MODEL_DIR, `${s}.fp16.onnx`)));
const OFFER = /^Split the song so the piano replaces the guitars/;

test.use({ midi: { granted: true, plugged: true } });

interface PlayerState {
  audioUrl?: string;
  backingUrl?: string;
  src: string;
  muted: boolean;
  time: number;
  running: boolean;
  speed: number;
  songSound: string;
  splitSongs: string;
}

async function player(page: Page): Promise<PlayerState> {
  await page.waitForFunction(() => Boolean((window as unknown as { __piano?: { player?: unknown } }).__piano?.player));
  return page.evaluate(() => {
    const w = window as unknown as {
      __piano: {
        app: { settings: { get(): { songSound: string; splitSongs: string } } };
        player: { song(): { audioUrl?: string; backingUrl?: string }; session: { running: boolean; game: { time: number }; options: { speed: number }; backing: HTMLAudioElement } };
      };
    };
    const p = w.__piano.player;
    const s = p.song();
    const settings = w.__piano.app.settings.get();
    return {
      audioUrl: s.audioUrl,
      backingUrl: s.backingUrl,
      src: p.session.backing.src,
      muted: p.session.backing.muted,
      time: p.session.game.time,
      running: p.session.running,
      speed: p.session.options.speed,
      songSound: settings.songSound,
      splitSongs: settings.splitSongs,
    };
  });
}

async function chooseFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await (await chooser).setFiles(path);
}

/** Watches requests: the splitter's files, and anything sent to another site (which must never happen). */
function watchRequests(page: Page) {
  const seen = { models: [] as string[], outside: [] as string[] };
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.includes('/models/')) seen.models.push(url.pathname);
    if (url.hostname !== '127.0.0.1' && url.protocol.startsWith('http')) seen.outside.push(r.url());
  });
  return seen;
}

/** Plays the stored backing far enough to know the engine reads it, and gives its length (no sound: the fixture mutes media). */
async function backingPlays(page: Page): Promise<{ duration: number; type: string; bytes: number; decoded: number; lagMs: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as { __piano: { player: { song(): { backingUrl?: string } } } };
    const url = w.__piano.player.song().backingUrl!;
    const blob = await (await fetch(url)).blob();
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    const duration = await new Promise<number>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error(`the backing does not load: ${audio.error?.code}`));
    });
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    // How far the backing is shifted against the recording: the drums are in both, so the
    // cross-correlation of their onsets peaks at the shift.
    const full = await ctx.decodeAudioData(await (await (await fetch((w.__piano.player.song() as { audioUrl?: string }).audioUrl!)).blob()).arrayBuffer());
    const env = (b: AudioBuffer) => {
      const x = b.getChannelData(0);
      const hop = 44; // about 1 ms
      const out = new Float32Array(Math.floor(Math.min(x.length, 6 * b.sampleRate) / hop));
      for (let i = 1; i < out.length; i++) {
        let e = 0;
        for (let k = 0; k < hop; k++) e += x[i * hop + k] ** 2;
        out[i] = e;
      }
      for (let i = out.length - 1; i > 0; i--) out[i] = Math.max(0, out[i] - out[i - 1]);
      return out;
    };
    const a = env(full);
    const b = env(decoded);
    let best = 0;
    let lag = 0;
    for (let d = -50; d <= 50; d++) {
      let c = 0;
      for (let i = 60; i < a.length - 60; i++) c += a[i] * (b[i + d] ?? 0);
      if (c > best) {
        best = c;
        lag = d;
      }
    }
    return { duration, type: blob.type, bytes: blob.size, decoded: decoded.duration, lagMs: lag };
  });
}

test.describe('song splitting', () => {
  test('the offer can be skipped: the song is made just as before, and the answer is remembered', async ({ page }) => {
    const seen = watchRequests(page);
    await openApp(page);
    const wavPath = writeTemp('split-skip.wav', renderMelody([60, 62, 64, 65, 67, 65, 64, 62].map((m, i) => [m, 0.5 + i * 0.5, 0.45] as const)));
    await chooseFile(page, wavPath);
    const offer = page.getByRole('checkbox', { name: OFFER });
    await expect(offer).toBeVisible();
    await expect(offer).not.toBeChecked();
    await expect(page.locator('.split-choice')).toContainText('80 MB download');
    await shot(page, 'split-offer');
    await page.getByRole('button', { name: 'Make my lesson' }).click();
    await expect(page).toHaveURL(/#\/play\//, { timeout: 120_000 });
    const state = await player(page);
    expect(state.audioUrl).toBeTruthy();
    expect(state.backingUrl).toBeUndefined();
    expect(state.splitSongs).toBe('no');
    // Two states for a song that was not split.
    await expect(page.getByRole('switch', { name: 'Original song' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Original song' })).toBeHidden();
    expect(seen.models, 'nothing downloaded').toEqual([]);
    expect(seen.outside).toEqual([]);

    // The next song starts with the same answer.
    await page.getByRole('link', { name: 'All songs' }).click();
    await chooseFile(page, wavPath);
    await expect(page.getByRole('checkbox', { name: OFFER })).not.toBeChecked();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('splitting on import: one download, the three-way sound choice, switching mid-song, kept after a reload', async ({ page, browserName }) => {
    test.skip(!haveModel, 'the splitter networks are not in public/models/spleeter-4stems/');
    test.setTimeout(300_000);
    const seen = watchRequests(page);
    const logs: string[] = [];
    page.on('console', (m) => {
      if (/^(Split to|Listened to)/.test(m.text())) logs.push(m.text());
    });
    await openApp(page);
    await chooseFile(page, writeTemp('split-band.wav', renderBand(13)));
    const offer = page.getByRole('checkbox', { name: OFFER });
    await offer.check();
    const started = Date.now();
    await page.getByRole('button', { name: 'Make my lesson' }).click();
    await expect(page.locator('.import-stage')).toHaveText(/Downloading the song splitter|Splitting the song/, { timeout: 60_000 });
    await shot(page, 'split-progress');
    await expect(page).toHaveURL(/#\/play\//, { timeout: 240_000 });
    console.log(`${browserName}: import with splitting ${((Date.now() - started) / 1000).toFixed(1)} s (${logs.join(' | ')})`);
    expect(seen.outside, 'nothing fetched from other sites').toEqual([]);
    expect(new Set(seen.models).size, 'the four networks, from the local copy').toBe(4);

    const state = await player(page);
    expect(state.backingUrl).toBeTruthy();
    expect(state.splitSongs).toBe('yes');
    // The backing is stored compressed and this engine can play and decode it; same length as the recording.
    const played = await backingPlays(page);
    expect(played.type).toMatch(/^audio\/ogg/); // WebKit drops the codecs parameter when reading it back
    expect(played.duration).toBeGreaterThan(12.5);
    expect(played.duration).toBeLessThan(13.5);
    expect(played.decoded).toBeGreaterThan(12.5);
    expect(played.bytes).toBeLessThan(13 * 20_000); // about 12 KB a second
    console.log(`${browserName}: backing ${played.type}, ${(played.bytes / 1024).toFixed(0)} KB for 13 s, plays ${played.duration.toFixed(2)} s, ${played.lagMs} ms from the recording`);
    expect(Math.abs(played.lagMs), 'the backing lines up with the recording').toBeLessThanOrEqual(10);

    // Three choices, "Without guitars and keys" first for a split song.
    const choices = page.getByRole('radiogroup', { name: 'Original song' });
    await expect(choices).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Original song' })).toBeHidden();
    await expect(choices.getByRole('radio', { name: 'Without guitars and keys' })).toBeChecked();
    expect(state.src).toBe(state.backingUrl);
    await shot(page, 'split-ready');
    await choices.getByRole('radio', { name: 'Full song' }).check();
    let now = await player(page);
    expect(now.src).toBe(now.audioUrl);
    expect(now.muted).toBe(false);
    await choices.getByRole('radio', { name: 'Piano only' }).check();
    expect((await player(page)).muted).toBe(true);
    // Keyboard: arrows move between the choices.
    await choices.getByRole('radio', { name: 'Piano only' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(choices.getByRole('radio', { name: 'Without guitars and keys' })).toBeChecked();
    expect((await player(page)).src).toBe(now.backingUrl);

    // While playing: the speaker button steps through the same choices without a jump or a pause.
    await page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: 'Listen', exact: true }).click();
    await page.locator('.play-button').click();
    await expect.poll(async () => (await player(page)).time, { timeout: 15_000 }).toBeGreaterThan(2);
    const speaker = page.getByRole('button', { name: /^Original song: / });
    await expect(speaker).toHaveAccessibleName('Original song: Without guitars and keys');
    for (const [label, expectSrc] of [
      ['Piano only', 'backing'],
      ['Full song', 'audio'],
      ['Without guitars and keys', 'backing'],
    ] as const) {
      const before = await player(page);
      await speaker.click();
      await expect(speaker).toHaveAccessibleName(`Original song: ${label}`);
      await page.waitForTimeout(400);
      const after = await player(page);
      expect(after.running, 'still playing').toBe(true);
      expect(after.speed).toBe(before.speed);
      expect(after.src).toBe(expectSrc === 'audio' ? after.audioUrl : after.backingUrl);
      expect(after.muted).toBe(label === 'Piano only');
      // Moved on by about the time waited, never back to the start or far ahead.
      expect(after.time - before.time).toBeGreaterThan(0.1);
      expect(after.time - before.time).toBeLessThan(1.5);
    }
    await shot(page, 'split-playing');
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();

    // After a reload: the split version and the choice are still there.
    const models = seen.models.length;
    await page.reload();
    await expect(page.locator('.player-title')).not.toBeEmpty();
    const again = await player(page);
    expect(again.backingUrl).toBeTruthy();
    expect(again.songSound).toBe('backing');
    await expect(page.getByRole('radiogroup', { name: 'Original song' }).getByRole('radio', { name: 'Without guitars and keys' })).toBeChecked();
    expect(again.src).toBe(again.backingUrl);

    // A second song: the splitter is already on this device, so nothing is downloaded again.
    await page.goto('/#/');
    await chooseFile(page, writeTemp('split-band-2.wav', renderBand(6)));
    await expect(page.getByRole('checkbox', { name: 'Split the song so the piano replaces the guitars' })).toBeChecked();
    await page.getByRole('button', { name: 'Make my lesson' }).click();
    await expect(page).toHaveURL(/#\/play\//, { timeout: 240_000 });
    expect((await player(page)).backingUrl).toBeTruthy();
    expect(seen.models.length, 'no second download').toBe(models);
  });

  test('"Split this song" in Practice tools, for a song added without it', async ({ page }) => {
    test.skip(!haveModel, 'the splitter networks are not in public/models/spleeter-4stems/');
    test.setTimeout(240_000);
    const seen = watchRequests(page);
    await openApp(page);
    await page.waitForFunction(() => Boolean((window as unknown as { __piano?: { app?: unknown } }).__piano?.app));
    const wav = Buffer.from(renderBand(8)).toString('base64');
    await page.evaluate(async (data) => {
      const app = (window as unknown as { __piano: { app: { library: { add(song: object, o: { audio: Blob }): Promise<unknown> } } } }).__piano.app;
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const notes = [60, 64, 67, 72].map((midi, i) => ({ midi, start: 1 + i, dur: 0.9, hand: 'right' }));
      await app.library.add({ id: 'mine:split-later', title: 'Split Later', by: '', notes, source: 'mine', recording: { name: 'later.wav', bytes: bytes.length } }, { audio: new Blob([bytes], { type: 'audio/wav' }) });
    }, wav);
    await page.evaluate(() => {
      location.hash = '#/play/mine%3Asplit-later';
    });
    await expect(page.getByRole('switch', { name: 'Original song' })).toBeVisible();
    await page.getByRole('button', { name: 'Practice tools' }).click();
    await page.getByRole('button', { name: 'Split this song' }).click();
    const sheet = page.getByRole('dialog', { name: 'Split this song?' });
    await expect(sheet).toContainText('80 MB download');
    await shot(page, 'split-later-ask');
    await sheet.getByRole('button', { name: 'Download and split' }).click();
    await expect(page.locator('.stage-toast')).toContainText('The piano now takes the place of the guitars and keys', { timeout: 180_000 });
    const state = await player(page);
    expect(state.backingUrl).toBeTruthy();
    expect(state.src).toBe(state.backingUrl);
    await expect(page.getByRole('radiogroup', { name: 'Original song' }).getByRole('radio', { name: 'Without guitars and keys' })).toBeChecked();
    await page.getByRole('button', { name: 'Practice tools' }).click();
    await expect(page.getByRole('button', { name: 'Split this song' })).toBeHidden();
    expect(seen.outside).toEqual([]);
  });
});
