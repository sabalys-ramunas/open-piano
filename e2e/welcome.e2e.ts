import { test, expect, shot, SIZES } from './fixtures';

test.describe('first visit', () => {
  test('welcome: USB piano path detects the piano and its key range', async ({ page, piano }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(page.getByRole('heading', { name: /Let's play the piano/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await shot(page, 'welcome-1-hello');
    await page.setViewportSize(SIZES.phone);
    await shot(page, 'welcome-1-hello-phone');
    await page.setViewportSize(SIZES.desktop);

    expect(await piano.requests(), 'MIDI is not asked for before the button').toBe(0);
    await page.getByRole('button', { name: "Let's go" }).click();
    await expect(page.getByRole('heading', { name: 'How will you play?' })).toBeVisible();
    await shot(page, 'welcome-2-how');
    await page.setViewportSize(SIZES.phone);
    await shot(page, 'welcome-2-how-phone');
    await page.setViewportSize(SIZES.desktop);
    await page.getByRole('button', { name: /digital piano or keyboard/ }).click();
    await expect(page.getByRole('heading', { name: 'Plug in your piano' })).toBeVisible();
    expect(await piano.requests(), 'still not asked: no button pressed yet').toBe(0);

    await page.getByRole('button', { name: 'Connect my piano' }).click();
    await expect(page.locator('.connect-status')).toContainText('Test Digital Piano');
    expect(await piano.requests()).toBe(1);
    await shot(page, 'welcome-3-midi-waiting');
    await piano.tap(60);
    await expect(page.locator('.connect-note')).toContainText('It works');
    // The first key is celebrated: the bubble names it.
    await expect(page.locator('.key-pop')).toContainText('C4');
    await expect(page.locator('.key-pop')).toContainText('It works!');
    await shot(page, 'welcome-3-midi-first-key', false, 'allow');
    await piano.tap(21);
    await piano.tap(108);
    await expect(page.locator('.connect-size')).toContainText('88-key');
    await shot(page, 'welcome-3-midi');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: "You're all set!" })).toBeVisible();
    await shot(page, 'welcome-4-ready');
    await page.setViewportSize(SIZES.phone);
    await shot(page, 'welcome-4-ready-phone');
    await page.setViewportSize(SIZES.desktop);
    await page.getByRole('link', { name: /Browse the songs/ }).click();
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();

    // The welcome is not shown again, and the piano reconnects without the button.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
    await expect.poll(() => piano.requests()).toBeGreaterThanOrEqual(1);
  });

  test('welcome: no piano path plays with the computer keyboard and on-screen keys', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: "Let's go" }).click();
    await page.getByRole('button', { name: /No piano yet/ }).click();
    await expect(page.getByRole('heading', { name: 'Play with your computer' })).toBeVisible();
    await page.keyboard.down('x');
    await expect(page.locator('.welcome-heard')).toContainText('That was D');
    await expect(page.locator('.mini-key.on')).toHaveCount(1);
    await page.keyboard.up('x');
    const strip = page.locator('.mini-keys');
    const box = (await strip.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('.welcome-heard')).toContainText('That was');
    await page.mouse.up();
    await shot(page, 'welcome-keys');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: "You're all set!" })).toBeVisible();
  });

  test('welcome: acoustic piano path turns on the microphone', async ({ page, piano }) => {
    await page.goto('/');
    await page.getByRole('button', { name: "Let's go" }).click();
    await page.getByRole('button', { name: /acoustic piano/ }).click();
    await expect(page.getByRole('heading', { name: 'Listen to your acoustic piano' })).toBeVisible();
    await page.getByRole('button', { name: 'Use my microphone' }).click();
    await expect(page.locator('.welcome-heard')).toContainText('Listening');
    await page.evaluate(() => window.__mic.play(69));
    await expect(page.locator('.welcome-heard')).toContainText('Heard A4', { timeout: 15_000 });
    await page.evaluate(() => window.__mic.stop());
    await shot(page, 'welcome-mic');
    expect(await piano.requests()).toBe(0);
  });

  test('welcome: the page can never be scrolled out of sight (its background suns are clipped, not scrollable)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: "Let's go" }).click();
    await page.getByRole('button', { name: /No piano yet/ }).click();
    await expect(page.getByRole('heading', { name: 'Play with your computer' })).toBeVisible();
    // A focus or "find in page" scrolls every scrollable box on the way. With overflow: hidden the
    // screen was one (300px of sun below it), so the heading could slide away with no way back.
    const scrolled = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('#screen')!;
      main.scrollTop = 300;
      return main.scrollTop;
    });
    expect(scrolled).toBe(0);
    await expect(page.getByRole('heading', { name: 'Play with your computer' })).toBeInViewport();
  });

  test('welcome on a phone held sideways: each step fits or scrolls, and its main button can be reached', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.goto('/');
    const go = page.getByRole('button', { name: "Let's go" });
    await expect(go).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('heading', { name: /Let's play/ })).toBeInViewport({ ratio: 1 });
    await go.click();
    for (const way of [/digital piano/, /No piano yet/, /acoustic/]) {
      await page.getByRole('button', { name: way }).click();
      const next = page.getByRole('button', { name: 'Continue' });
      await next.scrollIntoViewIfNeeded();
      await expect(next).toBeInViewport({ ratio: 1 });
      await page.getByRole('button', { name: 'Choose another way' }).click();
    }
  });

  test('welcome inside the app shows a Bluetooth pairing button on the connect step', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { midi: { postMessage: () => {} } } };
    });
    await page.goto('/');
    await page.getByRole('button', { name: "Let's go" }).click();
    await page.getByRole('button', { name: /digital piano/ }).click();
    await expect(page.getByRole('button', { name: 'Pair a Bluetooth piano' })).toBeVisible();
    await expect(page.locator('.welcome-step')).not.toContainText(/browser/i);
  });
});
