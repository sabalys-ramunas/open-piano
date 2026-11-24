import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect, openApp, shot, SIZES } from './fixtures';

test.use({ midi: { granted: true, plugged: true } });

const SECTIONS = ['My piano', 'Sound', 'Microphone', 'Timing', 'Display', 'About'] as const;

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}


/** Every setting control on the screen and its value, keyed by id (or group label). Pages that are closed count too. */
async function snapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#screen input[id], #screen select[id]')) {
      if (el instanceof HTMLInputElement && el.type === 'checkbox') out[el.id] = String(el.checked);
      else if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'url' || el.type === 'text')) out[el.id] = el.value;
      else if (el instanceof HTMLSelectElement) out[el.id] = el.value;
    }
    for (const group of document.querySelectorAll<HTMLElement>('#screen .settings-segmented')) {
      const name = group.getAttribute('aria-labelledby') ?? 'group';
      out[name] = group.querySelector('[aria-pressed="true"]')?.textContent ?? '';
    }
    return out;
  });
}

/** Opens a section page from the settings home and unfolds its "More options". */
async function openSection(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  const section = page.getByRole('region', { name, exact: true });
  await expect(section.getByRole('heading', { name, level: 2 })).toBeFocused();
  const more = section.locator('details.more-options > summary');
  for (let i = 0; i < (await more.count()); i++) await more.nth(i).click();
  return section;
}

test.describe('settings', () => {
  test('every control keeps its value after a reload', async ({ page }) => {
    await openApp(page, '#/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    for (const name of SECTIONS) await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    await shot(page, 'settings-desktop', true);
    const before = await snapshot(page);

    // Change every slider, switch, choice and list, page by page.
    for (const name of SECTIONS) {
      const section = await openSection(page, name);
      const ranges = section.locator('input[type="range"][id]');
      for (let i = 0; i < (await ranges.count()); i++) {
        const r = ranges.nth(i);
        if (!(await r.isEnabled())) continue;
        const [min, max] = [Number(await r.getAttribute('min')), Number(await r.getAttribute('max'))];
        const step = Number((await r.getAttribute('step')) ?? 1);
        const now = Number(await r.inputValue());
        const target = Math.round((min + (max - min) * (now > (min + max) / 2 ? 0.2 : 0.8)) / step) * step;
        await r.fill(String(target));
        await r.dispatchEvent('change');
      }
      const boxes = section.locator('input[type="checkbox"][id]');
      for (let i = 0; i < (await boxes.count()); i++) {
        const b = boxes.nth(i);
        if (!(await b.isEnabled())) continue;
        await b.click();
      }
      for (const group of await section.locator('.settings-segmented').all()) {
        await group.locator('[aria-pressed="false"]').first().click();
      }
      const selects = section.locator('select[id]');
      for (let i = 0; i < (await selects.count()); i++) {
        const s = selects.nth(i);
        const options = await s.locator('option').count();
        if (options > 1 && (await s.isEnabled())) await s.selectOption({ index: options - 1 });
      }
      await section.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      // Focus goes back to the card that opened the page.
      await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeFocused();
    }
    await page.waitForTimeout(600); // saving is automatic and quick
    const changed = await snapshot(page);
    const differs = Object.keys(changed).filter((k) => changed[k] !== before[k]);
    expect(differs.length).toBeGreaterThan(8);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeAttached();
    await page.waitForTimeout(300);
    const after = await snapshot(page);
    for (const k of differs) expect.soft(after[k], `setting ${k} after reload`).toBe(changed[k]);
  });

  test('the shared songs address explains a wrong address in our own words, then saves and resets', async ({ page }) => {
    await openApp(page, '#/settings');
    const section = await openSection(page, 'About');
    const field = section.getByLabel('Shared songs list');
    const status = section.locator('#set-catalog-status');
    await field.fill('not an address');
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    // Not the browser's own "Please enter a URL" bubble: that blocked our message before.
    await expect(status).toHaveText('That does not look like a web address. It should start with https://');
    await expect(field).toBeFocused();
    await field.fill('https://example.org/songs/index.json');
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(status).toHaveText('Saved. Shared songs now come from this list.');
    await section.getByRole('button', { name: 'Use the built-in list' }).click();
    await expect(status).toHaveText('Using the built-in list.');
    await expect(field).toHaveValue('');
  });

  test('connection helper, tips, timing check with taps, sound test, instrument switch and samples', async ({ page, piano }) => {
    const samples: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/samples/piano/')) samples.push(r.status());
    });
    await openApp(page, '#/settings');
    await expect(page.getByRole('button', { name: /^My piano/ })).toContainText('Test Digital Piano is connected');
    const pianoPage = await openSection(page, 'My piano');
    // The piano is already connected (allowed before): the helper shows it and hears keys.
    await expect(page.locator('.connect-status')).toContainText('Test Digital Piano');
    await expect(pianoPage.getByRole('heading', { name: 'Press any key' })).toBeVisible();
    await shot(page, 'settings-piano-waiting');
    await piano.down(64);
    await expect(page.locator('.connect-note')).toContainText('E4');
    await expect(page.locator('.keys-bubble')).toHaveText('E4');
    await expect(pianoPage.getByRole('heading', { name: 'It works!' })).toBeVisible();
    await page.waitForTimeout(250);
    await shot(page, 'settings-piano-connected', false, 'allow');
    await piano.up(64);
    await piano.tap(21);
    await piano.tap(108);
    await expect(page.locator('.connect-size')).toContainText('88-key');
    await piano.unplug();
    await expect(page.locator('.connect-status')).not.toContainText('Test Digital Piano is connected');
    await expect(pianoPage.getByRole('heading', { name: 'Plug in your piano' })).toBeVisible();
    await piano.plug();
    await expect(page.locator('.connect-status')).toContainText('Test Digital Piano');

    // Tappable tips.
    await pianoPage.getByText('Nothing happens when I press a key').click();
    const tip = pianoPage.getByRole('button', { name: 'Try another cable' });
    await tip.click();
    await expect(tip).toHaveAttribute('aria-expanded', 'true');
    await expect(pianoPage.getByText('Some cables only charge')).toBeVisible();
    await shot(page, 'settings-piano-tips', true);

    // Browser back closes the page.
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/#\/settings$/);

    // Sound test with the sampled piano.
    const sound = await openSection(page, 'Sound');
    await shot(page, 'settings-sound');
    await sound.getByRole('button', { name: 'Play a test sound' }).click();
    await expect.poll(() => samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s === 200 || s === 304 || s === 206)).toBe(true);
    await sound.getByRole('button', { name: 'Try the metronome' }).click();

    // Switch to the light synth and back.
    const group = sound.locator('.settings-segmented').filter({ has: page.locator('[data-value="synth"]') });
    await group.locator('[data-value="synth"]').click();
    await expect(group.locator('[data-value="synth"]')).toHaveAttribute('aria-pressed', 'true');
    await sound.getByRole('button', { name: 'Play a test sound' }).click();
    await group.locator('[data-value="piano"]').click();
    await expect(group.locator('[data-value="piano"]')).toHaveAttribute('aria-pressed', 'true');
    await sound.getByRole('button', { name: 'Settings', exact: true }).click();

    // Microphone: guided steps with honest words.
    const micPage = await openSection(page, 'Microphone');
    await expect(micPage.getByText('big chords may be partly missed')).toBeVisible();
    await shot(page, 'settings-mic', true);
    await micPage.getByRole('button', { name: 'Settings', exact: true }).click();

    // Timing check: tap 70 ms after every click.
    const timing = await openSection(page, 'Timing');
    await timing.getByRole('button', { name: 'Start the timing check' }).click();
    await page.evaluate(() => {
      const pad = document.querySelector<HTMLButtonElement>('.timing-pad')!;
      new MutationObserver(() => {
        if (pad.classList.contains('beat')) setTimeout(() => pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), 70);
      }).observe(pad, { attributes: true, attributeFilter: ['class'] });
    });
    await expect(timing.getByRole('button', { name: 'Use this result' })).toBeVisible({ timeout: 20_000 });
    await shot(page, 'settings-timing');
    await timing.getByRole('button', { name: 'Use this result' }).click();
    const latency = await page.evaluate(() => (window as unknown as { __piano: { app: { settings: { get(): { latencyMs: number } } } } }).__piano.app.settings.get().latencyMs);
    expect(latency).toBeGreaterThan(40);
    expect(latency).toBeLessThan(110);
  });

  test('every section page passes axe, with its options open', async ({ page }) => {
    await openApp(page, '#/settings');
    for (const name of SECTIONS) {
      const section = await openSection(page, name);
      await page.waitForTimeout(200);
      expect(await axe(page), name).toEqual([]);
      await section.getByRole('button', { name: 'Settings', exact: true }).click();
    }
  });

  for (const size of ['phone', 'tabletPortrait', 'tabletLandscape'] as const) {
    test(`settings at ${size}`, async ({ page, piano }) => {
      await page.setViewportSize(SIZES[size]);
      await openApp(page, '#/settings');
      await page.waitForTimeout(300);
      await shot(page, `settings-${size}`);
      if (size === 'phone') {
        await shot(page, 'settings-phone-full', true);
        await openSection(page, 'My piano');
        await piano.tap(60);
        await page.waitForTimeout(300);
        await shot(page, 'settings-piano-phone');
        await shot(page, 'settings-piano-phone-full', true);
        await page.goBack();
        await openSection(page, 'Sound');
        await shot(page, 'settings-sound-phone', true);
        await page.goBack();
        await openSection(page, 'Timing');
        await shot(page, 'settings-timing-phone', true);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('inside the iPad/iPhone app: no browser words, and a Bluetooth pairing button that asks the app', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { webkit: unknown }).webkit = {
        messageHandlers: { midi: { postMessage: (m: unknown) => ((window as unknown as { __shellMessages: unknown[] }).__shellMessages ||= []).push(m) } },
      };
    });
    await openApp(page, '#/settings');
    const section = await openSection(page, 'My piano');
    const words = await section.innerText();
    expect(words).not.toMatch(/browser|Chrome|web address|Choose Allow/i);
    await expect(section.getByRole('button', { name: 'Pair a Bluetooth piano' })).toBeVisible();
    await section.getByRole('button', { name: 'Pair a Bluetooth piano' }).click();
    expect(await page.evaluate(() => (window as unknown as { __shellMessages: unknown[] }).__shellMessages)).toEqual([{ type: 'bluetooth' }]);
    await expect(section.getByRole('button', { name: 'How do I connect?' })).toBeVisible();
  });

  test('in a browser there is no Bluetooth pairing button, and the FAQ still explains iPhone and iPad', async ({ page }) => {
    await openApp(page, '#/settings');
    const section = await openSection(page, 'My piano');
    await expect(section.getByRole('button', { name: 'Pair a Bluetooth piano' })).toHaveCount(0);
    await section.getByRole('button', { name: 'iPhone or iPad?' }).click();
    await expect(section.getByText(/app for iPad/)).toBeVisible();
  });
});
