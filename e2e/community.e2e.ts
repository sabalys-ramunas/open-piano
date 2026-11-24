import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, openApp, shot, SIZES } from './fixtures';
import { lessonJson } from './media';


async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('shared songs', () => {
  test('catalog, search, filters, preview and add to my songs', async ({ page }) => {
    await openApp(page, '#/community');
    await expect(page.getByRole('heading', { name: 'Shared songs', level: 1 })).toBeVisible();
    const grid = page.getByRole('region', { name: /^Every shared song/ });
    const cards = grid.locator('.cm-card');
    await expect(cards.first()).toBeVisible();
    const total = await cards.count();
    expect(total).toBeGreaterThanOrEqual(5);
    // One big suggested song as well as the grid.
    await expect(page.getByRole('region', { name: 'Try this one' }).getByRole('button', { name: /^Add to my songs/ })).toBeVisible();
    await shot(page, 'community-desktop');

    // Search behind the search button, with chips.
    await page.getByRole('button', { name: 'Find a shared song' }).click();
    const results = page.locator('.cm-results .cm-card');
    await page.getByRole('searchbox', { name: 'Search shared songs' }).fill('joplin');
    await expect.poll(() => results.count()).toBe(2);
    await shot(page, 'community-search');
    expect(await axe(page)).toEqual([]);
    await page.getByRole('searchbox', { name: 'Search shared songs' }).fill('');
    await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: 'Level 3 · Medium' }).click();
    await expect
      .poll(async () => (await page.locator('.cm-results .level-dots').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).every((l) => l?.startsWith('Level 3')))
      .toBe(true);
    await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: 'All levels' }).click();
    await page.getByRole('group', { name: 'Style' }).getByRole('button').nth(1).click();
    await expect(results.first()).toBeVisible();
    await page.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'All styles' }).click();
    await page.locator('#cm-sort').selectOption('hardest');
    await page.getByRole('searchbox', { name: 'Search shared songs' }).fill('nothing like this at all');
    await expect(page.getByText('No songs match')).toBeVisible();
    await page.getByRole('button', { name: 'Show every song' }).click();
    await expect.poll(() => results.count()).toBe(total);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Find a shared song' })).toBeFocused();

    // The song sheet: preview, then add; it turns into Play and shows on the home screen.
    const first = cards.first();
    const title = (await first.locator('.pcard-title').textContent())!;
    await first.locator('.pcard-open').click();
    const sheet = page.getByRole('dialog', { name: title });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Lesson by')).toBeVisible();
    await expect(sheet.getByText(/Free|share|Ask/).first()).toBeVisible();
    await shot(page, 'community-sheet');
    expect(await axe(page)).toEqual([]);
    await sheet.getByRole('button', { name: `Listen to ${title}` }).click();
    await expect(sheet.getByRole('button', { name: `Stop ${title}` })).toBeVisible();
    await sheet.getByRole('button', { name: `Stop ${title}` }).click();
    await sheet.getByRole('button', { name: `Add to my songs: ${title}` }).click();
    await expect(sheet.getByText('In your songs')).toBeVisible();
    await expect(sheet.getByRole('link', { name: `Play ${title}` })).toBeFocused();
    await shot(page, 'community-added');
    await page.keyboard.press('Escape');
    await expect(first.getByText('Added')).toBeVisible();
    await first.locator('.pcard-open').click();
    await page.getByRole('dialog', { name: title }).getByRole('link', { name: `Play ${title}` }).click();
    await expect(page).toHaveURL(/#\/play\/community/);
    await page.goto('/#/');
    await expect(page.getByRole('region', { name: /^From shared songs/ }).locator('.pcard-title', { hasText: title })).toBeVisible();
    await page.getByRole('button', { name: 'Find a song' }).click();
    await page.getByRole('searchbox', { name: 'Find a song' }).fill(title.slice(0, 8));
    await expect(page.locator('.find-results .pcard-title', { hasText: title })).toBeVisible();
  });

  test('add a lesson from a link, and the share steps', async ({ page, baseURL }) => {
    await openApp(page, '#/community');
    await page.getByRole('button', { name: 'Add from a link' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add from a link' });
    await expect(sheet).toBeVisible();
    await shot(page, 'community-link-sheet');
    expect(await axe(page)).toEqual([]);
    // Empty first: a gentle hint.
    await sheet.getByRole('button', { name: 'Add lesson' }).click();
    await expect(sheet.getByText('Paste the link first.')).toBeVisible();
    // A file served by the test server itself.
    await sheet.getByLabel('Lesson link').fill(`${baseURL}community/lessons/satie-gymnopedie-2.json`);
    await sheet.getByRole('button', { name: 'Add lesson' }).click();
    await expect(sheet.getByText(/Added "/)).toBeVisible();
    // And one from another site that allows it.
    await page.route('https://lessons.example.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: lessonJson('Linked Tune', [60, 62, 64, 65, 67, 69]) }),
    );
    await sheet.getByLabel('Lesson link').fill('https://lessons.example.test/linked.json');
    await sheet.getByRole('button', { name: 'Add lesson' }).click();
    await expect(sheet.getByText('Added "Linked Tune"')).toBeVisible();
    await shot(page, 'community-link-added');
    await sheet.getByRole('link', { name: 'Play it now' }).click();
    await expect(page.locator('.player-title')).toContainText('Linked Tune');

    // Share: with no song of your own, it says how to get one.
    await page.goto('/#/community');
    await page.getByRole('button', { name: 'Share my lesson' }).click();
    const share = page.getByRole('dialog', { name: 'Share my lesson' });
    await expect(share.getByText('Send it in')).toBeVisible();
    await expect(share.getByRole('link', { name: 'Add a song first' })).toBeVisible();
    await shot(page, 'community-share-sheet');
    expect(await axe(page)).toEqual([]);
  });

  test.describe(() => {
    // The browser itself logs the failed request while offline (Chrome and Safari's engine word it differently).
    test.use({ allowErrors: ['ERR_INTERNET_DISCONNECTED', 'WebKit encountered an internal error'] });
    test('offline: a friendly message, and it recovers when back online', async ({ page, context }) => {
      await openApp(page, '#/community');
      await expect(page.locator('.cm-card').first()).toBeVisible();
      await page.goto('/#/');
      await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
      await context.setOffline(true);
      await page.goto('/#/community');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(page.locator('.cm-problem').getByText('You are offline')).toBeVisible();
      await shot(page, 'community-offline');
      await context.setOffline(false);
      await expect(page.locator('.cm-card').first()).toBeVisible({ timeout: 15_000 });
    });
  });

  for (const size of ['phone', 'tabletPortrait', 'tabletLandscape'] as const) {
    test(`shared songs at ${size}`, async ({ page }) => {
      await page.setViewportSize(SIZES[size]);
      await openApp(page, '#/community');
      await expect(page.locator('.cm-card').first()).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, `community-${size}`);
      if (size === 'phone') {
        await shot(page, 'community-phone-full', true);
        await page.locator('.cm-card .pcard-open').first().click();
        await page.waitForTimeout(400);
        await shot(page, 'community-sheet-phone');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Add from a link' }).click();
        await page.waitForTimeout(400);
        await shot(page, 'community-link-sheet-phone');
        await page.keyboard.press('Escape');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
