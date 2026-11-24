import { test, expect, openApp, shot } from './fixtures';

const ROUTES: [string, string][] = [
  ['home', '#/'],
  ['course', '#/course'],
  ['community', '#/community'],
  ['settings', '#/settings'],
  ['editor', '#/editor'],
  ['player', '#/play/twinkle'],
  ['notfound', '#/nope/nothing'],
];

for (const [name, route] of ROUTES) {
  test(`smoke: ${name} renders`, async ({ page }) => {
    await openApp(page, route);
    await expect(page.locator('#screen h1').first()).toBeAttached();
    await page.waitForTimeout(800);
    await shot(page, `smoke-${name}`);
  });
}
