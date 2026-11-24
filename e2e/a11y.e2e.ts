import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, openApp, putRecord, shot } from './fixtures';

test.use({ midi: { granted: true, plugged: true } });

const SCREENS: [string, string][] = [
  ['home', '#/'],
  ['course', '#/course'],
  ['lesson', '#/course/find-c'],
  ['player', '#/play/twinkle'],
  ['editor-start', '#/editor'],
  ['editor', '#/editor/twinkle'],
  ['community', '#/community'],
  ['settings', '#/settings'],
  ['notfound', '#/no/such/page'],
  ['styleguide', '#/styleguide'],
];

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('accessibility', () => {
  for (const [name, route] of SCREENS) {
    test(`axe: ${name} has no serious or critical problems`, async ({ page }) => {
      await openApp(page, route);
      await page.waitForTimeout(600);
      expect(await axe(page)).toEqual([]);
    });
  }

  test('axe: welcome', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Let's play the piano/ })).toBeVisible();
    await page.waitForTimeout(700);
    expect(await axe(page)).toEqual([]);
  });

  test('axe: results and a finished lesson', async ({ page }) => {
    await openApp(page, '#/course');
    await putRecord(page, 'progress', 'twinkle', { songId: 'twinkle', best: 0.8, stars: 2, plays: 1, lastPlayed: Date.now() });
    await page.goto('/#/');
    // Let the page settle first: a reload that interrupts the dev server's own client logs an error in WebKit.
    await page.locator('#screen h1').first().waitFor({ state: 'attached' });
    await page.waitForLoadState('load');
    await page.reload();
    await page.waitForTimeout(500);
    expect(await axe(page)).toEqual([]);
  });

  for (const [name, route] of SCREENS) {
    test(`keyboard: ${name} can be used with Tab alone, with visible focus and no trap`, async ({ page, browserName }) => {
      // Safari only tabs to form fields unless Option is held (or "Press Tab to highlight each item" is on).
      const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
      await openApp(page, route);
      await page.waitForTimeout(300);
      const seen = new Set<string>();
      let invisible: string[] = [];
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press(tab);
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
          const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
          return { key: `${label}@${Math.round(r.x)},${Math.round(r.y)}`, label, ring: Boolean(ring), size: r.width * r.height };
        });
        if (!info) continue;
        if (!info.ring && info.size > 0) invisible.push(info.label);
        seen.add(info.key);
      }
      invisible = [...new Set(invisible)];
      expect(invisible, 'focused controls without a visible focus ring').toEqual([]);
      // A lesson in progress is full screen (no navigation): the way back and the step's own button are enough there.
      expect(seen.size, 'Tab moves through several controls (no trap)').toBeGreaterThan(name === 'lesson' ? 1 : name === 'notfound' ? 2 : 5);
    });
  }

  test('reduced motion: the player renders calmly', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, '#/play/twinkle');
    await expect(page.locator('.player')).toHaveClass(/is-calm/);
    await page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: 'Listen', exact: true }).click();
    await page.locator('.play-button').click();
    await page.waitForTimeout(2500);
    await shot(page, 'player-reduced-motion');
    await page.locator('.play-button').click();
  });

  test('colour contrast of the design tokens meets WCAG AA', () => {
    const css = readFileSync(resolve('src/style.css'), 'utf8');
    const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
    const tokens = new Map<string, string>();
    for (const m of root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)) tokens.set(m[1], m[2]);
    const rgb = (hex: string): [number, number, number] => {
      const h = hex.slice(1);
      const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
      return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
    };
    const lum = (hex: string): number => {
      const [r, g, b] = rgb(hex).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string): number => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // [text, background, minimum]: 4.5 for body text, 3 for large text and UI parts.
    const pairs: [string, string, number][] = [];
    // Text on the ocean: the page gradient stops, the nav, and every panel.
    for (const bg of ['ocean-1', 'ocean-2', 'ocean-3', 'ocean-deep', 'bg', 'bg-raised', 'panel', 'panel-2', 'panel-3']) {
      pairs.push(['text', bg, 4.5], ['muted', bg, 4.5], ['faint', bg, 4.5], ['accent', bg, 4.5], ['violet', bg, 4.5], ['warm', bg, 4.5], ['good', bg, 4.5], ['bad', bg, 4.5], ['sun', bg, 3]);
    }
    // Ink on light surfaces (paper, sheets, picture cards).
    for (const bg of ['paper', 'paper-2', 'cream']) {
      pairs.push(['ink', bg, 4.5], ['ink-muted', bg, 4.5], ['coral-deep', bg, 4.5], ['mint-deep', bg, 4.5], ['sun-deep', bg, 4.5]);
    }
    // Ink on the filled colours (buttons, big cards, badges).
    for (const bg of ['sun', 'sun-hover', 'coral', 'mint', 'sky', 'accent', 'accent-strong', 'violet', 'warm']) pairs.push(['ink', bg, 4.5]);
    pairs.push(['accent-ink', 'accent', 4.5], ['accent-ink', 'accent-strong', 4.5], ['accent-ink', 'sun', 4.5], ['warm-ink', 'warm', 4.5], ['cream', 'ink', 4.5]);
    // Outlines and field borders against what they sit on.
    pairs.push(['line-strong', 'bg', 3], ['line-strong', 'panel', 3]);
    const report: string[] = [];
    const failures: string[] = [];
    for (const [fg, bg, min] of pairs) {
      const a = tokens.get(fg);
      const b = tokens.get(bg);
      if (!a || !b) {
        failures.push(`missing token: --${a ? bg : fg}`);
        continue;
      }
      const r = ratio(a, b);
      report.push(`--${fg} on --${bg}: ${r.toFixed(2)} (needs ${min})`);
      if (r < min) failures.push(`--${fg} on --${bg}: ${r.toFixed(2)} < ${min}`);
    }
    console.log(`token contrast:\n${report.join('\n')}`);
    expect(failures).toEqual([]);
  });
});
