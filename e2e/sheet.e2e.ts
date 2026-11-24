import { test, expect, openApp, putValue, shot } from './fixtures';

const SONGS: [string, string][] = [
  ['twinkle', 'simple'],
  ['pack:petzold-minuet-in-g', 'three-four'],
  ['pack:tune-row-row-row-your-boat', 'six-eight'],
  ['pack:bach-invention-1', 'bach'],
  ['pack:beethoven-fur-elise', 'fur-elise'],
  ['pack:joplin-maple-leaf-rag', 'rag'],
  ['pack:chopin-nocturne-op9-2', 'chopin'],
];

test.describe('sheet music', () => {
  for (const [id, name] of SONGS) {
    test(`engraving: ${name}`, async ({ page }) => {
      await openApp(page);
      // Start in the sheet view with both hands, as a reader would.
      await putValue(page, 'settings', { view: 'sheet', hands: 'both', mode: 'listen' });
      await page.goto(`/#/play/${encodeURIComponent(id)}`);
      await page.reload(); // settings are read once at start
      await expect(page.locator('.player-title')).not.toBeEmpty();
      await expect(page.locator('.player')).toHaveAttribute('data-view', 'sheet');
      // Press Play on the get-ready page, then look at the first bars.
      await page.locator('.play-button').click();
      await expect(page.locator('.player')).toHaveAttribute('data-phase', 'playing');
      await page.waitForTimeout(300);
      await shot(page, `sheet-${name}-start`);
      // Let it play a little so the page turns at least once on short songs.
      await page.waitForTimeout(4000);
      await shot(page, `sheet-${name}-playing`);
      await page.locator('.play-button').click();
      await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    });
  }
});
