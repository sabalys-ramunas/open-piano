import { test, expect, openApp, putRecord, putValue, shot, SIZES } from './fixtures';
import { startBot, stopBot } from './bot';

/**
 * The pictures in the README. Opt-in:
 *   README_SHOTS=1 E2E_SHOTS=docs/screenshots npx playwright test -c e2e/playwright.config.ts readme-shots
 */

test.use({ midi: { granted: true, plugged: true } });

test.describe('readme screenshots', () => {
  test.skip(!process.env.README_SHOTS, 'screenshots for the README: set README_SHOTS=1');

  test('home, on a computer and on a phone', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, 'home');
    await page.setViewportSize(SIZES.phone);
    await page.waitForTimeout(500);
    await shot(page, 'home-phone');
  });

  test('falling notes while a song plays', async ({ page }) => {
    await openApp(page);
    await putValue(page, 'settings', { view: 'falling', hands: 'both', mode: 'listen' });
    await page.goto(`/#/play/${encodeURIComponent('pack:joplin-the-entertainer')}`);
    await page.reload();
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
    await shot(page, 'get-ready');
    await page.locator('.play-button').click();
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'playing');
    await page.waitForTimeout(6000);
    await shot(page, 'falling-notes', false, 'allow');
  });

  test('sheet music while a song plays', async ({ page }) => {
    await openApp(page);
    await putValue(page, 'settings', { view: 'sheet', hands: 'both', mode: 'listen' });
    await page.goto(`/#/play/${encodeURIComponent('pack:beethoven-fur-elise')}`);
    await page.reload();
    await expect(page.locator('.player')).toHaveAttribute('data-view', 'sheet');
    await page.locator('.play-button').click();
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'playing');
    await page.waitForTimeout(4000);
    await shot(page, 'sheet-music', false, 'allow');
  });

  test('results after a clean run', async ({ page }) => {
    await openApp(page);
    await putValue(page, 'settings', { view: 'falling', hands: 'right', mode: 'learn' });
    await page.goto('/#/play/twinkle');
    await page.reload();
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
    await page.locator('.play-button').click();
    await startBot(page, { target: 'player' });
    await expect(page.locator('#player-overlay-title')).toBeVisible({ timeout: 60_000 });
    await stopBot(page);
    await page.waitForTimeout(1200);
    await shot(page, 'results', false, 'allow');
  });

  test('the course map', async ({ page }) => {
    await openApp(page, '#/course');
    const ids = await page.evaluate(async () => {
      const url = '/src/course/curriculum.ts';
      const mod = (await import(/* @vite-ignore */ url)) as { allLessons(): { id: string }[] };
      return mod.allLessons().map((l) => l.id);
    });
    for (const [i, id] of ids.slice(0, 8).entries()) {
      await putRecord(page, 'lessons', id, { lessonId: id, completed: true, stars: (i % 3) + 1, attempts: 1, completedAt: Date.now() });
    }
    await putRecord(page, 'kv', 'course:last-lesson', ids[8]);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot(page, 'course');
  });
});
