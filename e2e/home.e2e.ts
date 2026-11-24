import type { Page } from '@playwright/test';
import { test, expect, openApp, shot, SIZES } from './fixtures';
import { lessonJson, writeTemp } from './media';

/** Opens search and returns the search box. */
async function openSearch(page: Page) {
  await page.getByRole('button', { name: 'Find a song' }).click();
  const box = page.getByRole('searchbox', { name: 'Find a song' });
  await expect(box).toBeVisible();
  return box;
}

const resultTitles = (page: Page) => page.locator('.find-results .pcard-title').allTextContents();

test.describe('home', () => {
  test('library renders from the index, in rows, with search, filters and sort', async ({ page }) => {
    await openApp(page);
    // Rows of picture cards from the song index.
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    const rows = await page.locator('.shelf-title').allTextContents();
    expect(rows.length).toBeGreaterThan(4);
    const cards = await page.locator('.pcard').count();
    expect(cards).toBeGreaterThan(70);
    await shot(page, 'home-desktop');
    await shot(page, 'home-desktop-full', true);

    // Search
    const search = await openSearch(page);
    await expect(page.locator('.find-count')).toContainText(/7\d songs/);
    await search.fill('joplin');
    await expect.poll(async () => {
      const cards = await page.locator('.find-results .pcard').allTextContents();
      return cards.length > 0 && cards.every((c) => c.toLowerCase().includes('joplin'));
    }).toBe(true);
    await shot(page, 'home-search');
    await search.fill('zzzzqqq');
    await expect(page.locator('.notice-title', { hasText: 'No songs match' })).toBeVisible();
    await page.getByRole('button', { name: 'Show every song' }).click();
    await expect(search).toHaveValue('');

    // Level filter
    await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: /^Level 1/ }).click();
    await expect.poll(async () => {
      const levels = await page.locator('.find-results .level-dots').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      return levels.length > 0 && levels.every((l) => l.startsWith('Level 1 '));
    }).toBe(true);
    await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: 'Every level' }).click();

    // Style filter
    const styles = page.getByRole('group', { name: 'Style' }).getByRole('button');
    expect(await styles.count()).toBeGreaterThan(2);
    await styles.nth(1).click();
    await expect(styles.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.find-results .pcard').first()).toBeVisible();
    await page.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Every style' }).click();

    // Sort A to Z: one flat list in order
    await page.getByLabel('Order').selectOption('title');
    await page.waitForTimeout(400);
    const titles = await resultTitles(page);
    expect(titles.length).toBeGreaterThan(5);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles.slice(0, 10)).toEqual(sorted.slice(0, 10));
    await page.getByRole('button', { name: 'Close search' }).click();
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();

    // Song sheet: the less common actions, then Play.
    await page.locator('.pcard-open').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('link', { name: 'Edit notes' })).toBeVisible();
    await shot(page, 'home-song-sheet');
    const download = page.waitForEvent('download');
    await sheet.getByRole('button', { name: 'Save lesson file' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.lesson\.json$/);
    await expect(page.getByRole('status').filter({ hasText: 'Lesson file saved' })).toBeVisible();
    await sheet.getByRole('button', { name: /^Play$/ }).click();
    await expect(page).toHaveURL(/#\/play\//);
  });

  test('dropping a lesson file adds it and opens the player; it shows in My songs and can be removed', async ({ page }) => {
    await openApp(page);
    const text = lessonJson('Dropped Tune', [60, 62, 64, 65, 67]);
    const dataTransfer = await page.evaluateHandle((json) => {
      const dt = new DataTransfer();
      dt.items.add(new File([json], 'dropped.lesson.json', { type: 'application/json' }));
      return dt;
    }, text);
    await page.dispatchEvent('body', 'dragenter', { dataTransfer });
    await expect(page.locator('.drop-cover')).toBeVisible();
    await shot(page, 'home-drag-over');
    await page.dispatchEvent('body', 'drop', { dataTransfer });
    await expect(page).toHaveURL(/#\/play\//);
    await expect(page.getByText('Dropped Tune').first()).toBeVisible();
    await page.goto('/#/');
    const mine = page.getByRole('region', { name: /^My songs/ });
    await expect(mine.locator('.pcard-title')).toHaveText(['Dropped Tune']);
    await shot(page, 'home-my-songs');

    // Remove asks first, inside the sheet.
    await mine.getByRole('button', { name: 'Dropped Tune' }).click();
    const sheet = page.getByRole('dialog', { name: 'Dropped Tune' });
    await sheet.getByRole('button', { name: 'Remove' }).click();
    await sheet.getByRole('button', { name: 'Keep it' }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Remove' }).click();
    await sheet.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('region', { name: /^My songs/ })).toHaveCount(0);
  });

  test('a click anywhere on a picture card opens its sheet, and closing it puts focus back on the card', async ({ page }) => {
    await openApp(page);
    const card = page.locator('[data-shelf="start"] .pcard').first();
    await expect(card).toBeVisible();
    const title = (await card.locator('.pcard-open').textContent())!;
    // Real mouse clicks on the picture, the composer line and the dots: in Safari these land on the
    // card itself (not its stretched button), which once did nothing.
    for (const part of ['.pcard-cover', '.pcard-by', '.pcard-meta']) {
      await card.locator(part).first().scrollIntoViewIfNeeded();
      const box = (await card.locator(part).first().boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const sheet = page.getByRole('dialog', { name: title });
      await expect(sheet, `clicking ${part} opens the sheet`).toBeVisible();
      await expect(sheet.getByRole('button', { name: /^Play$/ })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      // Safari does not focus what was clicked, so the sheet has to remember the card itself.
      await expect(card.locator('.pcard-open'), `focus returns after ${part}`).toBeFocused();
    }
  });

  test('the way to play chosen on the song sheet is not asked again on the get-ready page', async ({ page }) => {
    await openApp(page);
    await page.locator('[data-shelf="start"] .pcard-open').first().click();
    const sheet = page.getByRole('dialog');
    await sheet.locator('.mode-tile', { hasText: 'Play along' }).click();
    await sheet.getByRole('button', { name: /^Play$/ }).click();
    await expect(page).toHaveURL(/#\/play\//);
    const chosen = page.locator('.mode-chosen');
    await expect(chosen).toBeVisible();
    await expect(chosen).toContainText('Play along');
    // The three mode cards stay folded away until "Change".
    await expect(page.locator('.getready-modes .mode-choices')).toBeHidden();
    await chosen.getByRole('button', { name: /Change how to play/ }).click();
    await expect(page.locator('.getready-modes .mode-choices')).toBeVisible();
  });

  test('a file that is not a song is turned down at once; the level choice draws light radios on paper', async ({ page }) => {
    await openApp(page);
    let chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a file' }).click();
    await (await chooser).setFiles({ name: 'shopping.txt', mimeType: 'text/plain', buffer: Buffer.from('milk, eggs') });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'That file did not work' })).toBeVisible();
    await expect(dialog).toContainText('That is not a song file.');
    await expect(dialog).not.toContainText('How much do you want to play?');
    await dialog.getByRole('button', { name: 'Close' }).click();

    chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a file' }).click();
    await (await chooser).setFiles({ name: 'tune.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048, 1) });
    const radio = page.getByRole('radio').nth(1);
    await expect(radio).toBeVisible();
    await expect(radio).not.toBeChecked();
    // The page is `color-scheme: dark`; on cream paper that drew unchecked radios as solid dark dots.
    expect(await radio.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('light');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a file dropped outside the Songs page does not take the browser away from the app', async ({ page }) => {
    await openApp(page, '#/settings');
    const prevented = await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'song.mid', { type: 'audio/midi' }));
      const over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true });
      document.body.dispatchEvent(over);
      const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      document.body.dispatchEvent(drop);
      return over.defaultPrevented && drop.defaultPrevented;
    });
    expect(prevented, 'the browser would otherwise open the file').toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'drop the file on the Songs page' })).toBeVisible();
    await expect(page).toHaveURL(/#\/settings$/);
  });

  test('choosing a file with the button imports it', async ({ page }) => {
    await openApp(page);
    const file = writeTemp('picked.lesson.json', lessonJson('Picked Tune', [60, 64, 67]));
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a file' }).click();
    await (await chooser).setFiles(file);
    await expect(page).toHaveURL(/#\/play\//);
    await expect(page.getByText('Picked Tune').first()).toBeVisible();
  });

  for (const size of ['phone', 'tabletPortrait', 'tabletLandscape'] as const) {
    test(`home at ${size} has no sideways scroll`, async ({ page }) => {
      await page.setViewportSize(SIZES[size]);
      await openApp(page);
      await expect(page.locator('.pcard').first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.waitForTimeout(400);
      await shot(page, `home-${size}`);
      await shot(page, `home-${size}-full`, true);
    });
  }

  test('where a piano can never connect, the chip says so and explains why', async ({ page }) => {
    await page.addInitScript(() => {
      // A browser without Web MIDI (Safari on a Mac, iPhone and iPad browsers).
      delete (Navigator.prototype as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
      delete (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
    });
    await openApp(page);
    await expect(page.getByRole('link', { name: 'Connect a piano' })).toHaveCount(0);
    const chip = page.getByRole('button', { name: 'No piano in this browser' });
    await expect(chip).toBeVisible();
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await chip.click();
    const sheet = page.getByRole('dialog', { name: 'Pianos and this browser' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'OK' }).click();
    await expect(sheet).toHaveCount(0);
  });
});
