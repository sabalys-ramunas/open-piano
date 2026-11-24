import { test, expect, openApp, putRecord, shot, SIZES, type SizeName } from './fixtures';

/**
 * The app shell, the home screen's rows and song sheet, and the style guide,
 * with a screenshot of each at every size (E2E_SHOTS sets the folder).
 */

test.describe('design system and shell', () => {
  for (const size of Object.keys(SIZES) as SizeName[]) {
    test(`home at ${size}: navigation, greeting, big card and rows`, async ({ page }) => {
      await page.setViewportSize(SIZES[size]);
      await openApp(page);
      const nav = page.getByRole('navigation', { name: 'Main' });
      await expect(nav.getByRole('link', { name: 'Songs' })).toHaveAttribute('aria-current', 'page');
      for (const name of ['Learn', 'Shared', 'Settings']) await expect(nav.getByRole('link', { name })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening)!$/);
      await expect(page.getByRole('region', { name: 'Up next' }).getByRole('link', { name: /Start lesson/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Add your own song' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
      // Every nav target is at least 44px.
      for (const box of await nav.getByRole('link').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
        if (box.width === 0) continue;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.waitForTimeout(500);
      await shot(page, `home-${size}`);
      await shot(page, `home-${size}-full`, true);
    });
  }

  test('rows scroll with the arrow buttons and the arrow keys; a card opens the song sheet', async ({ page }) => {
    await openApp(page);
    const row = page.getByRole('region', { name: 'Classical' });
    const track = row.getByRole('list');
    await expect(track.getByRole('listitem').first()).toBeVisible();
    const before = await track.evaluate((el) => el.scrollLeft);
    await row.getByRole('button', { name: 'Scroll Classical on' }).click();
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);

    // Keyboard: focus the first card, ArrowRight moves to the next one.
    const first = page.getByRole('region', { name: 'Start here' }).locator('.pcard-open').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const second = page.getByRole('region', { name: 'Start here' }).locator('.pcard-open').nth(1);
    await expect(second).toBeFocused();

    // Enter opens the sheet; it names the song and offers the ways to play.
    const title = (await second.textContent())!;
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: title });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Play$/ })).toBeFocused();
    await expect(sheet.getByRole('button', { name: /Learn/ })).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'song-sheet');
    await page.setViewportSize(SIZES.phone);
    await shot(page, 'song-sheet-phone');
    await page.setViewportSize(SIZES.desktop);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(second).toBeFocused();

    // Choosing "Listen" in the sheet starts the player in Listen mode.
    await second.click();
    await sheet.getByRole('button', { name: /Listen/ }).click();
    await sheet.getByRole('button', { name: /^Play$/ }).click();
    await expect(page).toHaveURL(/#\/play\//);
    // The player does not ask again: it shows the chosen way as one line with a Change button.
    await expect(page.locator('.mode-chosen')).toContainText('Listen');
    await page.getByRole('button', { name: /Change how to play/ }).click();
    await expect(page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: 'Listen', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Full screen: the navigation is hidden in the player.
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  });

  test('a returning player sees the next lesson or the last song as the big card', async ({ page }) => {
    await openApp(page);
    await putRecord(page, 'progress', 'twinkle', { songId: 'twinkle', best: 0.92, stars: 3, plays: 2, lastPlayed: Date.now() });
    await page.reload();
    const hero = page.getByRole('region', { name: 'Up next' });
    await expect(hero.getByRole('link', { name: /^Play Twinkle/ })).toBeVisible();
    await expect(hero).toContainText('Best 92%');
    await shot(page, 'home-returning');
    // The card of a played song shows its stars.
    await expect(page.locator('.pcard[data-song-id="twinkle"]').first().getByRole('img', { name: '3 of 3 stars' })).toBeAttached();
  });

  test('search is tucked behind a button and filters by words, level and style', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Find a song' }).click();
    await expect(page.getByRole('searchbox', { name: 'Find a song' })).toBeFocused();
    await page.getByRole('searchbox', { name: 'Find a song' }).fill('joplin');
    await expect.poll(async () => {
      const titles = await page.locator('.find-results .pcard').allTextContents();
      return titles.length > 0 && titles.every((t) => t.toLowerCase().includes('joplin'));
    }).toBe(true);
    await shot(page, 'home-search');
    await page.getByRole('searchbox', { name: 'Find a song' }).fill('');
    await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: 'Level 1 · First steps' }).click();
    await expect.poll(async () => (await page.locator('.find-results .level-dots').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).every((l) => l?.startsWith('Level 1'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find a song' })).toBeFocused();
  });

  test('the navigation follows you, and full-screen places hide it', async ({ page }) => {
    await openApp(page, '#/course');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Learn' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Shared' }).click();
    await expect(page).toHaveURL(/#\/community$/);
    await expect(nav.getByRole('link', { name: 'Shared' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Learn' })).not.toHaveAttribute('aria-current', /.*/);
    await page.goto('/#/course/find-c');
    await expect(nav).toBeHidden();
    await expect(page.getByRole('link', { name: 'Course map' })).toBeVisible();
    await page.goto('/#/editor/twinkle');
    await expect(nav).toBeHidden();
  });

  test('style guide renders every component', async ({ page }) => {
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SIZES[size]);
      await openApp(page, '#/styleguide');
      await expect(page.getByRole('heading', { name: 'Style guide', level: 1 })).toBeVisible();
      await expect(page.locator('.sg-cover-art')).toHaveCount(12);
      await expect(page.locator('.sg-unit-art')).toHaveCount(9);
      await page.waitForTimeout(300);
      await shot(page, `styleguide-${size}`, true);
    }
    await page.setViewportSize(SIZES.desktop);
    await page.getByRole('button', { name: 'Open a sheet' }).click();
    await expect(page.getByRole('dialog', { name: 'A sheet' })).toBeVisible();
    await shot(page, 'styleguide-sheet');
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('other screens under the new tokens', async ({ page }) => {
    for (const [name, route] of [
      ['course', '#/course'],
      ['lesson', '#/course/find-c'],
      ['player', '#/play/twinkle'],
      ['editor', '#/editor/twinkle'],
      ['community', '#/community'],
      ['settings', '#/settings'],
      ['notfound', '#/nope'],
    ] as const) {
      await openApp(page, route);
      await page.waitForTimeout(900);
      await shot(page, `screen-${name}`);
      await page.setViewportSize(SIZES.phone);
      await page.waitForTimeout(300);
      await shot(page, `screen-${name}-phone`);
      await page.setViewportSize(SIZES.desktop);
    }
  });
});
