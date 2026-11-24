import type { Page } from '@playwright/test';
import { test, expect, openApp, shot, SIZES } from './fixtures';
import { renderMelody } from './media';

/**
 * Songs with their original recording: the "Original song" switch on the get-ready page, the round
 * speaker button while playing, what the recording does in each way to play, and a calm stage on a miss.
 */

const TUNE = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
const MELODY = TUNE.map((midi, i) => [midi, 1 + i * 0.5, 0.45] as const);
const SONG_ID = 'mine:song-sound-test';
const ALL_SIZES = { ...SIZES, large: { width: 2000, height: 1150 }, phoneLandscape: { width: 844, height: 390 } } as const;

interface BackingInfo {
  time: number;
  running: boolean;
  waiting: boolean;
  backingPaused: boolean;
  backingTime: number;
  muted: boolean;
  songSound: string;
}

/** Adds a short song with a synthesized WAV recording to the library (again, after a reload in a private window). */
async function addRecordedSong(page: Page): Promise<void> {
  const wav = Buffer.from(renderMelody(MELODY)).toString('base64');
  await page.evaluate(
    async ([wav, melody, id]) => {
      const app = (window as unknown as { __piano: { app: { library: { get(id: string): { audioUrl?: string } | undefined; add(song: object, o: { audio: Blob }): Promise<unknown> } } } }).__piano.app;
      // Safari's private windows cannot keep the recording in storage, so add it again when it is missing.
      if (app.library.get(id)?.audioUrl) return;
      const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
      const notes = melody.map(([midi, start, dur]) => ({ midi, start, dur, hand: 'right' }));
      await app.library.add({ id, title: 'Twinkle Recording', by: 'Test Suite', notes, source: 'mine', recording: { name: 'twinkle.wav', bytes: bytes.length } }, { audio: new Blob([bytes], { type: 'audio/wav' }) });
    },
    [wav, MELODY, SONG_ID] as const,
  );
}

async function openRecorded(page: Page): Promise<void> {
  await openApp(page, '#/');
  await page.waitForFunction(() => Boolean((window as unknown as { __piano?: { app?: unknown } }).__piano?.app));
  await addRecordedSong(page);
  await goPlay(page, SONG_ID);
}

/** Opens a song by changing the hash (no reload, so a song kept only in memory is still there). */
async function goPlay(page: Page, songId: string): Promise<void> {
  await page.evaluate((id) => {
    location.hash = `#/play/${encodeURIComponent(id)}`;
  }, songId);
  await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('.player-title')).not.toBeEmpty();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __piano?: { player?: unknown } }).__piano?.player))).toBe(true);
}

async function backing(page: Page): Promise<BackingInfo> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __piano: {
        app: { settings: { get(): { songSound: string } } };
        player: { session: { running: boolean; game: { time: number; waiting: boolean }; backing: HTMLAudioElement } };
      };
    };
    const s = w.__piano.player.session;
    return {
      time: s.game.time,
      running: s.running,
      waiting: s.game.waiting,
      backingPaused: s.backing.paused,
      backingTime: s.backing.currentTime,
      muted: s.backing.muted,
      songSound: w.__piano.app.settings.get().songSound,
    };
  });
}

async function pickMode(page: Page, label: 'Listen' | 'Learn' | 'Play along'): Promise<void> {
  await page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: label, exact: true }).click();
}

/** Counts the notes the app sounds with its own piano from now on. */
async function countPianoNotes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __piano: { app: { audio: { instrument: { play(...a: unknown[]): void } } } }; __plays: number };
    const instrument = w.__piano.app.audio.instrument;
    const real = instrument.play.bind(instrument);
    w.__plays = 0;
    instrument.play = (...a: unknown[]) => {
      w.__plays++;
      real(...a);
    };
  });
}

const pianoNotes = (page: Page) => page.evaluate(() => (window as unknown as { __plays: number }).__plays);

test.use({ midi: { granted: true, plugged: true } });

test.describe('player: the original song', () => {
  test('a switch on the get-ready page and a speaker button while playing, by mouse and keyboard, remembered', async ({ page }) => {
    await openRecorded(page);
    const group = page.getByRole('group', { name: 'Sound' });
    const toggle = group.getByRole('switch', { name: 'Original song' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle).toHaveAccessibleDescription('On: the recording plays along');
    await shot(page, 'player-song-sound-ready');

    // Mouse, then the keyboard (Enter and Space) on the focused switch. Space does not start the song here.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toHaveAccessibleDescription('Off: only the piano plays');
    expect((await backing(page)).muted).toBe(true);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
    await expect(toggle).toBeFocused();

    // While playing: the round speaker button, with one name and a pressed state.
    await pickMode(page, 'Listen');
    await page.locator('.play-button').click();
    const speaker = page.getByRole('button', { name: 'Original song', exact: true });
    await expect(speaker).toBeVisible();
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');
    await speaker.click();
    await expect(speaker).toHaveAttribute('aria-pressed', 'true');
    expect((await backing(page)).muted).toBe(false);
    expect((await backing(page)).running, 'the button does not pause the song').toBe(true);
    await page.waitForTimeout(600);
    await shot(page, 'player-song-sound-playing');
    await speaker.click();
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');

    // Remembered: settings survive a reload.
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as unknown as { __piano?: { app?: unknown } }).__piano?.app));
    await addRecordedSong(page);
    await goPlay(page, 'twinkle');
    await goPlay(page, SONG_ID);
    await expect(page.getByRole('switch', { name: 'Original song' })).toHaveAttribute('aria-checked', 'false');
    expect((await backing(page)).muted).toBe(true);
    await page.getByRole('switch', { name: 'Original song' }).click();
    await expect(page.getByRole('switch', { name: 'Original song' })).toHaveAttribute('aria-checked', 'true');
  });

  test('songs without a recording show neither control', async ({ page }) => {
    await openApp(page, '#/play/twinkle');
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('.song-sound-choice')).toBeHidden();
    await page.locator('.play-button').click();
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('.song-sound-button')).toBeHidden();
  });

  test('Learn plays the recording while the song moves and holds it while waiting; Listen sounds the notes over it; off means the piano plays', async ({ page }) => {
    await openRecorded(page);
    await pickMode(page, 'Learn');
    await page.locator('.play-button').click();
    // The first note is at 1 s: the recording plays on the way there...
    await expect.poll(async () => (await backing(page)).backingPaused === false && (await backing(page)).time > 0.1, { timeout: 8000 }).toBe(true);
    // ...and holds while the song waits for C.
    await expect.poll(async () => (await backing(page)).waiting, { timeout: 8000 }).toBe(true);
    await expect.poll(async () => (await backing(page)).backingPaused).toBe(true);
    const held = await backing(page);
    await page.waitForTimeout(500);
    expect((await backing(page)).backingTime).toBeCloseTo(held.backingTime, 2);
    // The right key moves both on.
    await page.evaluate(() => window.__midi.send([0x90, 60, 90]));
    await page.evaluate(() => window.__midi.send([0x80, 60, 0]));
    await expect.poll(async () => (await backing(page)).backingPaused).toBe(false);
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    expect((await backing(page)).backingPaused).toBe(true);
    await page.getByRole('button', { name: 'Start again' }).click();

    // Listen: the recording plays and the lesson's notes sound on top of it.
    await countPianoNotes(page);
    await pickMode(page, 'Listen');
    await page.locator('.play-button').click();
    await expect.poll(async () => (await backing(page)).time, { timeout: 8000 }).toBeGreaterThan(2.2);
    const listen = await backing(page);
    expect(listen.backingPaused).toBe(false);
    expect(listen.muted).toBe(false);
    expect(await pianoNotes(page)).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Start again' }).click();

    // Play along with the original song off: the recording keeps time silently and the piano plays the notes.
    await page.getByRole('switch', { name: 'Original song' }).click();
    await countPianoNotes(page);
    await pickMode(page, 'Play along');
    await page.getByRole('button', { name: 'Practice tools' }).click();
    await page.getByRole('switch', { name: 'Count in before Play along' }).setChecked(false);
    await page.getByRole('dialog', { name: 'Practice tools' }).getByRole('button', { name: 'Done' }).click();
    await page.locator('.play-button').click();
    await expect.poll(async () => (await backing(page)).time, { timeout: 8000 }).toBeGreaterThan(1.2);
    const off = await backing(page);
    expect(off.muted).toBe(true);
    expect(off.backingPaused).toBe(false);
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Start again' }).click();
    await page.getByRole('switch', { name: 'Original song' }).click();
  });

  test('a miss or a wrong key never moves anything on the stage', async ({ page, piano }) => {
    await openApp(page, '#/play/twinkle');
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
    await pickMode(page, 'Play along');
    await page.getByRole('button', { name: 'Practice tools' }).click();
    await page.getByRole('switch', { name: 'Count in before Play along' }).setChecked(false);
    await page.getByRole('dialog', { name: 'Practice tools' }).getByRole('button', { name: 'Done' }).click();
    await page.locator('.play-button').click();
    // Watch every element of the stage and the score for five seconds while notes go by unplayed and wrong keys are pressed.
    const watching = page.evaluate(async () => {
      const els = [...document.querySelectorAll<HTMLElement>('.player, .stage, .stage-view, .stage-view canvas, .stage-effects, .play-chrome, .chrome-play, .play-button, .hud-stat, .hud-row')];
      const seen = els.map(() => new Set<string>());
      const s = (window as unknown as { __piano: { player: { session: { on(e: string, f: () => void): () => void } } } }).__piano.player.session;
      let misses = 0;
      let wrongs = 0;
      const offs = [s.on('miss', () => misses++), s.on('wrong', () => wrongs++)];
      const end = performance.now() + 5000;
      await new Promise<void>((done) => {
        const step = () => {
          els.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            seen[i].add(`${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)} ${getComputedStyle(el).transform} ${getComputedStyle(el).translate}`);
          });
          if (performance.now() < end) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      for (const off of offs) off();
      return { misses, wrongs, moved: els.filter((_, i) => seen[i].size > 1).map((el) => el.className) };
    });
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(900);
      await piano.tap(30 + i);
    }
    const result = await watching;
    expect(result.misses, 'notes went by unplayed').toBeGreaterThan(2);
    expect(result.wrongs).toBeGreaterThan(0);
    expect(result.moved).toEqual([]);
  });

  test('arriving from the song sheet with a way to play chosen: one line with Change, not the question again', async ({ page }) => {
    await openRecorded(page);
    await page.evaluate(async (id) => {
      location.hash = '#/';
      const url = '/src/app/handoff.ts';
      const handoff = (await import(/* @vite-ignore */ url)) as { setHandoff(h: object): void };
      handoff.setHandoff({ kind: 'mode-chosen', songId: id, mode: 'flow' });
    }, SONG_ID);
    await expect(page.locator('.player')).toHaveCount(0);
    await goPlay(page, SONG_ID);
    const modes = page.getByRole('group', { name: 'How to play' });
    await expect(modes.locator('.mode-chosen')).toContainText('Play along');
    await expect(modes.getByRole('button', { name: 'Listen', exact: true })).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { __piano: { player: { session: { options: { mode: string } } } } }).__piano.player.session.options.mode)).toBe('flow');
    await shot(page, 'player-mode-chosen');
    await modes.getByRole('button', { name: /^Change how to play/ }).click();
    await expect(modes.getByRole('button', { name: 'Play along', exact: true })).toBeFocused();
    await expect(modes.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
    await expect(modes.locator('.mode-chosen')).toBeHidden();
  });

  test('every size: the switch and the speaker button fit, nothing spills sideways', async ({ page }) => {
    test.setTimeout(180_000);
    await openRecorded(page);
    for (const [size, viewport] of Object.entries(ALL_SIZES)) {
      await page.setViewportSize(viewport);
      await goPlay(page, 'twinkle');
      await goPlay(page, SONG_ID);
      const toggle = page.getByRole('switch', { name: 'Original song' });
      await toggle.scrollIntoViewIfNeeded();
      await expect(toggle).toBeVisible();
      const box = (await toggle.boundingBox())!;
      expect(box.height, size).toBeGreaterThanOrEqual(44);
      expect(box.x, size).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, size).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), size).toBeLessThanOrEqual(0);
      await page.locator('.getready').evaluate((el) => el.scrollTo(0, 0));
      await shot(page, `player-song-sound-ready-${size}`);
      await page.locator('.play-button').click();
      const speaker = page.locator('.song-sound-button');
      await expect(speaker).toBeVisible();
      const s = (await speaker.boundingBox())!;
      const pauseBox = (await page.locator('.play-button').boundingBox())!;
      expect(s.width, size).toBeGreaterThanOrEqual(44);
      expect(s.x, 'speaker after the pause button').toBeGreaterThanOrEqual(pauseBox.x + pauseBox.width);
      await page.waitForTimeout(500);
      await shot(page, `player-song-sound-playing-${size}`, false, 'allow');
      await page.keyboard.press('Space');
      await page.getByRole('button', { name: 'Start again' }).click();
    }
  });
});
