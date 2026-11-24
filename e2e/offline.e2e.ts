import type { Page } from '@playwright/test';
import { test, expect, finishWelcomeInStore, shot } from './fixtures';
import { renderMelody, writeTemp } from './media';

// Runs against `vite build` + `vite preview` (the "preview" project): the real service worker.

test.describe('production build', () => {
  test.use({ allowErrors: ['ERR_INTERNET_DISCONNECTED', 'Failed to fetch dynamically imported module', 'net::ERR_FAILED'] });

  test('the service worker installs and the app works offline, with a cached song', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await finishWelcomeInStore(page);
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/$/);
    // Open a song pack song once (it is also fetched in the background after install).
    await page.goto('/#/play/pack%3Atune-hot-cross-buns');
    await expect(page.locator('.player-title')).toContainText('Hot Cross Buns');
    // Let the worker finish storing every song of the song pack in the background.
    const all = await page.evaluate(async () => ((await (await fetch('songs/index.json')).json()) as { songs: string[] }).songs.length);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const keys = await caches.keys();
            let songs = 0;
            for (const k of keys) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('/songs/')) songs++;
            return songs;
          }),
        { timeout: 90_000 },
      )
      .toBeGreaterThanOrEqual(all + 1);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.player-title')).toContainText('Hot Cross Buns');
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    await page.goto('/#/play/pack%3Ajoplin-the-entertainer-easy');
    await expect(page.locator('.player-title')).toContainText('The Entertainer');
    await shot(page, 'offline-player');
    await context.setOffline(false);
  });

  test('after one song was added online, songs can be added and shared songs opened offline', async ({ page, context }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await finishWelcomeInStore(page);
    await page.goto('/#/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload(); // now the worker controls the page (and the import worker it starts)
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const tune = (offset: number): [number, number, number][] => [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72].map((m, i) => [m + offset, 0.5 + i * 0.5, 0.45]);
    const first = writeTemp('offline-first.wav', renderMelody(tune(0)));
    const second = writeTemp('offline-second.wav', renderMelody(tune(2)));

    // Online: the note model and its runtime are stored on first use.
    await addRecording(page, first);
    await page.goto('/#/community');
    await expect(page.locator('.cm-card').first()).toBeVisible();

    await context.setOffline(true);
    await page.goto('/#/');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    await addRecording(page, second);
    await expect(page.locator('.player-title')).toContainText('offline-second');
    await shot(page, 'offline-import');
    await page.goto('/#/community');
    await expect(page.locator('.cm-card').first()).toBeVisible();
    await context.setOffline(false);
  });

  test('unknown route shows the not-found page', async ({ page }) => {
    await page.goto('/');
    await finishWelcomeInStore(page);
    await page.goto('/#/this/does/not/exist');
    await expect(page.locator('#screen h1')).toBeVisible();
    await expect(page.locator('#screen')).toContainText(/not|find/i);
    await shot(page, 'notfound');
  });

  test.describe(() => {
    // Without the worker, so the failed download is not answered from its cache.
    test.use({ serviceWorkers: 'block' });
  test('a screen that fails to load shows the friendly error page', async ({ page }) => {
    await page.goto('/');
    await finishWelcomeInStore(page);
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    await page.route(/\/assets\/editor-[^/]*\.js$/, (route) => route.abort());
    await page.goto('/#/editor');
    await expect(page.getByRole('heading', { name: 'This page did not load' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    await shot(page, 'error-page');
  });
  });
});

async function addRecording(page: Page, path: string): Promise<void> {
  await page.goto('/#/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await (await chooser).setFiles(path);
  await page.getByRole('button', { name: 'Make my lesson' }).click();
  await expect(page).toHaveURL(/#\/play\//, { timeout: 180_000 });
}
