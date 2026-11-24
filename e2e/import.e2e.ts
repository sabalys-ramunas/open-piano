import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { test, expect, openApp, shot } from './fixtures';
import { renderMelody, writeTemp } from './media';

// @tonejs/midi is a CommonJS package: load it the CommonJS way.
const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

test.use({ midi: { granted: true, plugged: true } });

type Tune = [number, number, number][];

/** The right-hand notes of a built-in song, read from the app's own song module. */
async function builtInMelody(page: Page, id: string, seconds: number): Promise<Tune> {
  return page.evaluate(
    async ([songId, limit]) => {
      const url = '/src/songs/index.ts';
      const mod = (await import(/* @vite-ignore */ url)) as { BUILT_IN: { id: string; notes: { midi: number; start: number; dur: number; hand: string }[] }[] };
      const song = mod.BUILT_IN.find((s) => s.id === songId);
      if (!song) throw new Error(`no built-in song ${songId}`);
      return song.notes.filter((n) => n.hand === 'right' && n.start < limit).map((n) => [n.midi, n.start, n.dur] as [number, number, number]);
    },
    [id, seconds] as const,
  );
}

/** Whether this browser session can keep a Blob in IndexedDB (Safari's private windows cannot). */
async function canStoreBlobs(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('e2e-blob-probe', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('s');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction('s', 'readwrite');
        tx.objectStore('s').put(new Blob(['x']), 'probe');
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    db.close();
    indexedDB.deleteDatabase('e2e-blob-probe');
    return ok;
  });
}

async function chooseFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await (await chooser).setFiles(path);
}

async function playerSong(page: Page): Promise<{ id: string; notes: number; audioUrl: boolean; raw: number; recording: string | null }> {
  await page.waitForFunction(() => Boolean((window as unknown as { __piano?: { player?: unknown } }).__piano?.player));
  return page.evaluate(() => {
    interface S {
      id: string;
      notes: unknown[];
      audioUrl?: string;
      raw?: unknown[];
      recording?: { name: string };
    }
    const p = (window as unknown as { __piano?: { player?: { song(): S } } }).__piano?.player;
    if (!p) throw new Error('no player');
    const s = p.song();
    return { id: s.id, notes: s.notes.length, audioUrl: Boolean(s.audioUrl), raw: s.raw?.length ?? 0, recording: s.recording?.name ?? null };
  });
}

test.describe('add your own song', () => {
  test('a recording becomes a lesson that plays along in sync and survives a reload', async ({ page, browserName }) => {
    test.setTimeout(240_000);
    const logs: string[] = [];
    page.on('console', (m) => {
      if (m.text().startsWith('Listened to')) logs.push(m.text());
    });
    const requests: { url: string; status: number }[] = [];
    page.on('response', (r) => {
      if (/\/model\/|\.wasm|worker/.test(r.url())) requests.push({ url: r.url(), status: r.status() });
    });
    await openApp(page);
    const melody = await builtInMelody(page, 'twinkle', 20);
    const wavPath = writeTemp('twinkle-test.wav', renderMelody(melody));

    await chooseFile(page, wavPath);
    await expect(page.getByRole('heading', { name: 'Make a lesson from your recording' })).toBeVisible();
    await shot(page, 'import-level');
    const started = Date.now();
    await page.getByRole('button', { name: 'Make my lesson' }).click();
    await expect(page.getByRole('heading', { name: 'Adding your song' })).toBeVisible();
    await expect.poll(async () => Number(await page.locator('.import-dialog progress').getAttribute('value')), { timeout: 60_000 }).toBeGreaterThan(0.1);
    await shot(page, 'import-progress');
    await expect(page).toHaveURL(/#\/play\//, { timeout: 180_000 });
    const firstSeconds = (Date.now() - started) / 1000;
    await expect(page.locator('.stage-note-import')).toBeVisible();
    await shot(page, 'import-ready');

    expect(requests.some((r) => r.url.includes('/model/model.json') && r.status === 200)).toBe(true);
    expect(requests.every((r) => r.status === 200 || r.status === 304)).toBe(true);
    expect(logs.length, 'the import logged which backend ran').toBe(1);
    // Safari's engine runs the network on WebGL about 70 times slower than on
    // WebAssembly (and took a minute and a half to find that out): never race it there.
    if (browserName === 'webkit') expect(logs[0]).not.toContain('webgl');
    console.log(`import: ${logs[0]} (whole import ${firstSeconds.toFixed(1)} s for ${melody.length} notes over ${(melody.at(-1)![1] + 1).toFixed(0)} s)`);

    const song = await playerSong(page);
    expect(song.audioUrl).toBe(true);
    // The melody had this many notes; the lesson should be in the same ballpark.
    expect(song.notes).toBeGreaterThan(melody.length * 0.6);
    expect(song.notes).toBeLessThan(melody.length * 1.6);

    // Play along with the recording: the audio clock and the notes stay together.
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.mouse.move(600, 400);
    await page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: 'Play along', exact: true }).click();
    await page.getByRole('button', { name: 'Practice tools' }).click();
    await page.getByRole('switch', { name: 'Count in before Play along' }).uncheck();
    await page.keyboard.press('Escape');
    await page.locator('.play-button').click();
    await page.waitForTimeout(3500);
    const sync = await page.evaluate(() => {
      interface S {
        game: { time: number };
        backing?: { currentTime: number; paused: boolean };
      }
      const s = (window as unknown as { __piano: { player: { session: S } } }).__piano.player.session;
      return { audio: s.backing?.currentTime ?? -1, paused: s.backing?.paused ?? true, song: s.game.time };
    });
    console.log(`play along sync after 3.5 s: audio ${sync.audio.toFixed(3)} s, notes ${sync.song.toFixed(3)} s`);
    expect(sync.paused).toBe(false);
    expect(Math.abs(sync.audio - sync.song)).toBeLessThan(0.08);
    await page.keyboard.press('Space'); // pause (the controls bar is hidden while playing)
    await expect(page.locator('.play-button')).toHaveText('Continue');

    // After a reload the song and its recording come back from storage.
    await page.reload();
    await expect(page.locator('.player-title')).not.toBeEmpty();
    const again = await playerSong(page);
    expect(again.id).toBe(song.id);
    expect(again.notes).toBe(song.notes);
    const keepsBlobs = await canStoreBlobs(page);
    if (keepsBlobs) {
      expect(again.audioUrl).toBe(true);
    } else {
      // Safari's private windows (and Playwright's WebKit, which works the same
      // way) refuse to keep a Blob in IndexedDB. The lesson must still come
      // back, and either keep its recording or ask for it again.
      test.info().annotations.push({ type: 'note', description: 'This browser cannot keep a Blob in IndexedDB; the recording was not expected to survive the reload.' });
      if (!again.audioUrl) await expect(page.locator('.stage-note').filter({ hasText: 'Add the recording' })).toBeVisible();
    }

    // Adding the same file again is quick: what was heard is remembered.
    await page.goto('/#/');
    await chooseFile(page, wavPath);
    const t0 = Date.now();
    if (keepsBlobs || again.audioUrl) {
      await page.getByRole('button', { name: 'Make my lesson' }).click();
    } else {
      // The lesson is still waiting for exactly this recording, so it is attached without any question.
      await expect(page).toHaveURL(new RegExp(`#/play/${encodeURIComponent(song.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), { timeout: 60_000 });
      expect((await playerSong(page)).audioUrl).toBe(true);
    }
    await expect(page).toHaveURL(/#\/play\//, { timeout: 60_000 });
    const cachedSeconds = (Date.now() - t0) / 1000;
    console.log(`import again (cached): ${cachedSeconds.toFixed(2)} s, first time ${firstSeconds.toFixed(1)} s`);
    expect(cachedSeconds).toBeLessThan(Math.max(3, firstSeconds / 3));
  });

  test('Cancel stops a long import', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    const melody = await builtInMelody(page, 'twinkle', 60);
    const long: Tune = [];
    for (let k = 0; k < 4; k++) for (const [m, s, d] of melody) long.push([m, s + k * 24, d]);
    const path = writeTemp('long-test.wav', renderMelody(long));
    await chooseFile(page, path);
    await page.getByRole('button', { name: 'Make my lesson' }).click();
    await expect(page.locator('.import-stage')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.locator('.import-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.import-dialog')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('.toast')).toContainText('Stopped');
    await expect(page).toHaveURL(/#\/$/);
  });

  test('a MIDI file with several tracks asks which hand plays what', async ({ page }) => {
    await openApp(page);
    const midi = new Midi();
    midi.header.setTempo(100);
    const parts: [string, number, number][] = [
      ['Melody', 72, 0],
      ['Bass', 40, 32],
      ['Strings', 60, 48],
      ['Drums', 38, 0],
    ];
    for (const [name, base, program] of parts) {
      const track = midi.addTrack();
      track.name = name;
      if (name === 'Drums') track.channel = 9;
      else track.instrument.number = program;
      for (let i = 0; i < 16; i++) track.addNote({ midi: base + ((i * 2) % 7), time: i * 0.3, duration: 0.25, velocity: 0.8 });
    }
    const path = writeTemp('four-tracks.mid', new Uint8Array(midi.toArray()));
    await chooseFile(page, path);
    // Drums have no notes to play on a piano, so three tracks are offered.
    await expect(page.locator('.track-row')).toHaveCount(3);
    await expect(page.locator('.track-row', { hasText: 'Drums' })).toHaveCount(0);
    await shot(page, 'import-tracks');
    await page.locator('.import-dialog .import-actions button.primary').click();
    await expect(page).toHaveURL(/#\/play\//);
    const song = await playerSong(page);
    expect(song.notes).toBeGreaterThan(10);
  });

  test('an exported lesson file can be added again and its recording attached', async ({ page }) => {
    test.setTimeout(240_000);
    await openApp(page);
    const melody = await builtInMelody(page, 'twinkle', 10);
    const wavPath = writeTemp('short-tune.wav', renderMelody(melody));
    await chooseFile(page, wavPath);
    await page.getByRole('button', { name: 'Make my lesson' }).click();
    await expect(page).toHaveURL(/#\/play\//, { timeout: 180_000 });
    const made = await playerSong(page);
    expect(made.recording).toBe(basename(wavPath));

    // Save the lesson file from the player.
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: 'Practice tools' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save lesson' }).click();
    const file = await (await download).path();
    expect(file && existsSync(file)).toBeTruthy();
    const lessonPath = writeTemp('exported.lesson.json', (await import('node:fs')).readFileSync(file!));

    // Remove the song, then add the lesson file: it asks for the recording.
    await page.goto('/#/');
    await page.evaluate(async (id) => {
      const lib = (window as unknown as { __piano: { app: { library: { remove(id: string): Promise<void> } } } }).__piano.app.library;
      await lib.remove(id);
    }, made.id);
    await chooseFile(page, lessonPath);
    await expect(page).toHaveURL(/#\/play\//);
    await expect(page.locator('.stage-note').filter({ hasText: 'Add the recording' })).toBeVisible();
    await shot(page, 'import-lesson-needs-recording');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.stage-note').getByRole('button', { name: 'Add the recording' }).click();
    await (await chooser).setFiles(wavPath);
    await expect.poll(async () => (await playerSong(page)).audioUrl).toBe(true);
    await expect(page.locator('.stage-note').filter({ hasText: 'Add the recording' })).toBeHidden();
  });

  test('a real recording (E2E_RECORDING=path)', async ({ page }) => {
    const path = process.env.E2E_RECORDING;
    test.skip(!path || !existsSync(path), 'set E2E_RECORDING to an audio file to measure a real recording');
    test.setTimeout(15 * 60_000);
    const logs: string[] = [];
    page.on('console', (m) => {
      if (m.text().startsWith('Listened to')) logs.push(m.text());
    });
    await openApp(page);
    await chooseFile(page, path!);
    await page.getByRole('button', { name: 'Make my lesson' }).click();
    await expect(page).toHaveURL(/#\/play\//, { timeout: 14 * 60_000 });
    const song = await playerSong(page);
    console.log(`real recording: ${logs[0]}; ${song.notes} notes`);
    await shot(page, 'import-real-recording');
  });
});
