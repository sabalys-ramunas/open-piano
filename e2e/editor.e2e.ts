import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, openApp, shot, SIZES } from './fixtures';
import { writeTemp } from './media';

interface EdNote {
  id: number;
  midi: number;
  start: number;
  dur: number;
  hand: string;
}

async function notes(page: Page): Promise<EdNote[]> {
  return page.evaluate(() => {
    const e = (window as unknown as { __piano?: { editor?: { notes: EdNote[] } } }).__piano?.editor;
    if (!e) throw new Error('no editor');
    return e.notes.map((n) => ({ id: n.id, midi: n.midi, start: n.start, dur: n.dur, hand: n.hand }));
  });
}

async function selection(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __piano: { editor: { selection: number[] } } }).__piano.editor.selection);
}

async function point(page: Page, time: number, midi: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([t, m]) => (window as unknown as { __piano: { editor: { point(t: number, m: number): { x: number; y: number } } } }).__piano.editor.point(t, m), [time, midi] as const);
}


async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('note editor', () => {
  test('add, move, resize, select, delete, undo, redo, play, save, export and re-import', async ({ page }) => {
    await openApp(page, '#/editor');
    await expect(page.getByRole('button', { name: /^Write a new song/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fix one of my songs/ })).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, 'editor-start');
    await page.getByRole('button', { name: /^Fix one of my songs/ }).click();
    await expect(page.getByRole('searchbox', { name: 'Find a song to fix' })).toBeFocused();
    await page.locator('.screen-editor').getByRole('button', { name: 'Twinkle, Twinkle, Little Star', exact: true }).first().click();
    await expect(page.locator('.ed-roll canvas')).toBeVisible();
    await expect.poll(async () => (await notes(page)).length).toBeGreaterThan(10);
    const before = await notes(page);
    // The first-time tip, shown once.
    await expect(page.getByRole('note', { name: 'Tip' })).toContainText('Tap to add a note');
    await page.waitForTimeout(300);
    await shot(page, 'editor-workspace');
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('note', { name: 'Tip' })).toBeHidden();

    // Add: a black key the song never uses (C sharp), so nothing is in the way.
    await page.getByRole('group', { name: 'Tool' }).getByRole('button', { name: 'Add' }).click();
    const lastEnd = Math.max(...before.map((n) => n.start + n.dur));
    const addAt = Math.min(lastEnd - 2, 4.1);
    const p = await point(page, addAt, 61);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await notes(page)).length).toBe(before.length + 1);
    const added = (await notes(page)).find((n) => !before.some((b) => b.id === n.id))!;
    expect(added.midi).toBe(61);

    // Move it up two keys with the Select tool.
    await page.getByRole('group', { name: 'Tool' }).getByRole('button', { name: 'Select' }).click();
    const mid = await point(page, added.start + added.dur / 2, added.midi);
    const up = await point(page, added.start + added.dur / 2, added.midi + 2);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, (mid.y + up.y) / 2, { steps: 4 });
    await page.mouse.move(up.x, up.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await notes(page)).find((n) => n.id === added.id)?.midi).toBe(63);
    const moved = (await notes(page)).find((n) => n.id === added.id)!;

    // Resize: drag the right edge to the right.
    const edge = await point(page, moved.start + moved.dur, moved.midi);
    const further = await point(page, moved.start + moved.dur + 0.5, moved.midi);
    await page.mouse.move(edge.x + 1, edge.y); // just past the end still grabs the edge of a short note
    await page.mouse.down();
    await page.mouse.move(further.x, further.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await notes(page)).find((n) => n.id === added.id)!.dur).toBeGreaterThan(moved.dur + 0.2);
    await shot(page, 'editor-edited');

    // Select it and delete it, then undo and redo.
    const centre = await point(page, moved.start + 0.05, moved.midi);
    await page.mouse.click(centre.x, centre.y);
    await expect.poll(() => selection(page)).toEqual([added.id]);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await notes(page)).length).toBe(before.length);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await notes(page)).length).toBe(before.length + 1);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await notes(page)).length).toBe(before.length);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await notes(page)).length).toBe(before.length + 1);

    // Play and stop.
    await page.locator('.ed-play').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __piano: { editor: { playing: boolean } } }).__piano.editor.playing)).toBe(true);
    await page.waitForTimeout(800);
    await shot(page, 'editor-playing');
    await page.locator('.ed-play').click();

    // Save: a built-in song is saved as your own copy, and the player shows the change.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.ed-savestate')).toContainText(/Saved/i);

    // Everything else lives behind More tools.
    await page.getByRole('button', { name: 'More tools' }).click();
    const tools = page.getByRole('dialog', { name: 'More tools' });
    for (const name of ['Playing', 'Record', 'Notes and hands', 'Clean up', 'Problems', 'Song details', 'Save and share', 'Shortcuts']) {
      await expect(tools.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await shot(page, 'editor-more-tools');
    expect(await axe(page)).toEqual([]);
    await tools.getByRole('button', { name: /^Clean up/ }).click();
    await expect(page.getByRole('dialog', { name: 'Clean up' }).getByRole('button', { name: 'Fix overlaps' })).toBeVisible();
    await shot(page, 'editor-clean-up');
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'All tools' }).click();
    await page.getByRole('dialog', { name: 'More tools' }).getByRole('button', { name: /^Song details/ }).click();
    await expect(page.getByRole('dialog', { name: 'Song details' }).getByLabel('Title')).toHaveValue(/Twinkle/);
    await page.waitForTimeout(400); // let the sheet finish sliding in
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'More tools' }).click();
    await page.getByRole('dialog', { name: 'More tools' }).getByRole('button', { name: /^Save and share/ }).click();
    const share = page.getByRole('dialog', { name: 'Save and share' });
    const download = page.waitForEvent('download');
    await share.getByRole('button', { name: 'Download lesson file' }).click();
    const file = await (await download).path();
    const lessonText = readFileSync(file!, 'utf8');
    expect(JSON.parse(lessonText).notes.length).toBe(before.length + 1);

    await share.getByRole('button', { name: 'Try it in the player' }).click();
    await expect(page).toHaveURL(/#\/play\/mine/);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __piano?: { player?: { song(): { notes: unknown[] } } } }).__piano?.player?.song().notes.length ?? 0))
      .toBe(before.length + 1);
    await shot(page, 'editor-saved-in-player');

    // The exported lesson file can be added back.
    await page.goto('/#/');
    const path = writeTemp('edited.lesson.json', lessonText);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a file' }).click();
    await (await chooser).setFiles(path);
    await expect(page).toHaveURL(/#\/play\//);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __piano?: { player?: { song(): { notes: unknown[] } } } }).__piano?.player?.song().notes.length ?? 0))
      .toBe(before.length + 1);
  });

  test('a note added at whole-song zoom is big enough to grab', async ({ page }) => {
    await openApp(page, '#/editor/twinkle');
    await expect(page.locator('.ed-roll canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    // Zoom far out, as if the whole of a long song were on screen.
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();
    const before = await notes(page);
    const tiny = await page.evaluate(() => (window as unknown as { __piano: { editor: { view: { pxPerSec: number } } } }).__piano.editor.view.pxPerSec);
    expect(tiny).toBeLessThan(20);
    const p = await point(page, 2, 61);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await notes(page)).length).toBe(before.length + 1);
    const added = (await notes(page)).find((n) => !before.some((b) => b.id === n.id))!;
    const view = await page.evaluate(() => (window as unknown as { __piano: { editor: { view: { pxPerSec: number; rowH: number } } } }).__piano.editor.view);
    expect(added.dur * view.pxPerSec).toBeGreaterThanOrEqual(27);
    expect(view.rowH).toBeGreaterThanOrEqual(13.9);
    // And it can be dragged straight away.
    await page.getByRole('group', { name: 'Tool' }).getByRole('button', { name: 'Select' }).click();
    const a = await point(page, added.start + added.dur / 2, added.midi);
    const b = await point(page, added.start + added.dur / 2, added.midi + 1);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await notes(page)).find((n) => n.id === added.id)?.midi).toBe(62);
  });

  // Safari's engine logs the piano samples that were still downloading when
  // openApp leaves the page as failed "access control checks" or a stopped
  // Cache API context (the app catches them).
  test.describe(() => {
    test.use({ allowErrors: ['due to access control checks', 'Cache API operation failed: Context is stopped'] });
    for (const size of ['phone', 'tabletPortrait', 'tabletLandscape', 'desktop'] as const) {
      test(`editor at ${size}`, async ({ page }) => {
        await page.setViewportSize(SIZES[size]);
        await openApp(page, '#/editor/twinkle');
        await expect(page.locator('.ed-roll canvas')).toBeVisible();
        await page.waitForTimeout(400);
        await shot(page, `editor-${size}`);
        // The dock fits without scrolling sideways, and every button is a real touch target.
        const dock = await page.locator('.ed-dock').evaluate((el) => ({ scroll: el.scrollWidth - el.clientWidth, right: el.getBoundingClientRect().right }));
        expect(dock.scroll).toBeLessThanOrEqual(0);
        expect(dock.right).toBeLessThanOrEqual(SIZES[size].width);
        for (const box of await page.locator('.ed-dock button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height]))) {
          expect(Math.min(...box)).toBeGreaterThanOrEqual(44);
        }
        await page.getByRole('button', { name: 'Got it' }).click();
        await page.getByRole('button', { name: 'More tools' }).click();
        await page.waitForTimeout(350);
        await shot(page, `editor-more-${size}`);
        await page.keyboard.press('Escape');
        await openApp(page, '#/editor');
        await page.waitForTimeout(400);
        await shot(page, `editor-start-${size}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
});
