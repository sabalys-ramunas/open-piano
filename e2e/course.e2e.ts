import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, openApp, putRecord, shot, SIZES } from './fixtures';
import { completeLesson, stepInfo } from './course-driver';

test.use({ midi: { granted: true, plugged: true } });

/** Every lesson id, in course order, read from the app's own curriculum module. */
async function lessonIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const url = '/src/course/curriculum.ts';
    const mod = (await import(/* @vite-ignore */ url)) as { allLessons(): { id: string }[] };
    return mod.allLessons().map((l) => l.id);
  });
}

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function goToStep(page: Page, step: number): Promise<void> {
  await page.evaluate((i) => (window as unknown as { __piano: { lesson: { runner: { goTo(n: number): void } } } }).__piano.lesson.runner.goTo(i), step);
  await page.waitForTimeout(400);
}

test.describe('course', () => {
  test('axe: map mid-course, every kind of lesson moment, and both endings', async ({ page, piano }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, '#/course');
    const ids = await lessonIds(page);
    for (const id of ids.slice(0, 7)) await putRecord(page, 'lessons', id, { lessonId: id, completed: true, stars: 2, attempts: 1, completedAt: Date.now() });
    await putRecord(page, 'kv', 'course:skipped', [ids[7]]);
    await page.reload();
    await page.waitForTimeout(600);
    expect(await axe(page), 'map').toEqual([]);

    await page.goto('/#/course/find-c');
    await expect(page.locator('.ls-card')).toBeVisible();
    for (const step of [0, 2, 4, 5]) {
      await goToStep(page, step);
      expect(await axe(page), `find-c step ${step}`).toEqual([]);
    }
    // The "Nice!" bar after a right answer.
    await goToStep(page, 4);
    await page.locator('.ls-choice').nth(1).click();
    await page.locator('.ls-choice').nth(0).click();
    await expect(page.locator('.ls-foot[data-tone="nice"]')).toBeVisible();
    expect(await axe(page), 'nice bar').toEqual([]);
    await page.getByRole('button', { name: 'More options' }).click();
    expect(await axe(page), 'more sheet').toEqual([]);
    await page.keyboard.press('Escape');

    for (const [id, step] of [['rh-fingers', 0], ['rhythm-long', 0], ['dyn-soft-loud', 2], ['lh-position', 1], ['staff-treble', 4]] as const) {
      await page.goto(`/#/course/${id}`);
      await expect(page.locator('.ls-card')).toBeVisible();
      await goToStep(page, step);
      expect(await axe(page), `${id} step ${step}`).toEqual([]);
    }

    await page.goto('/#/course/find-c');
    await expect(page.locator('.ls-card')).toBeVisible();
    await completeLesson(page, piano);
    await expect(page.locator('.ls-done')).toBeVisible();
    await page.waitForTimeout(500);
    expect(await axe(page), 'lesson complete').toEqual([]);

    await page.goto('/#/course/high-low');
    await expect(page.locator('.ls-card')).toBeVisible();
    await goToStep(page, 99);
    await expect(page.getByRole('heading', { name: 'Skipped for now' })).toBeVisible();
    expect(await axe(page), 'skipped').toEqual([]);
  });

  test('map, first lesson end to end, stars and streak saved, next lesson unlocked', async ({ page, piano }) => {
    await openApp(page, '#/course');
    await expect(page.getByRole('heading', { name: 'Learn to play', level: 1 })).toBeVisible();
    const side = page.getByRole('complementary', { name: 'Your progress' });
    await expect(side.getByRole('img', { name: '0 of 40 lessons done' })).toBeVisible();
    await shot(page, 'course-map');
    await page.setViewportSize(SIZES.phone);
    await shot(page, 'course-map-phone');
    await page.setViewportSize(SIZES.desktop);

    await side.getByRole('link', { name: /^Start/ }).click();
    await expect(page).toHaveURL(/#\/course\/find-c$/);
    // Full screen: one round way back, no navigation.
    await expect(page.getByRole('link', { name: 'Course map' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await completeLesson(page, piano, { prefix: 'course-l1', seen: new Set() });
    await expect(page.locator('.ls-done')).toBeVisible();
    await expect(page.locator('.ls-done-stars')).toHaveAttribute('aria-label', /[123] of 3 stars/);
    // The first lesson of the day is a streak moment.
    await expect(page.locator('.ls-streak')).toContainText('Day 1 of your streak!');
    await expect(page.getByRole('link', { name: /^Next lesson: D and E/ })).toBeVisible();
    await shot(page, 'course-lesson-done');

    await page.goto('/#/course');
    await page.reload();
    await expect(side.getByText('1 day in a row')).toBeVisible();
    await expect(side.getByRole('img', { name: '1 of 40 lessons done' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Lesson 1: Find C\. [123] of 3 stars/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Lesson 2: D and E\. Up next/ })).toBeVisible();
    await expect(side.getByRole('link', { name: /^Continue: D and E/ })).toBeVisible();
    await shot(page, 'course-map-after-first');
  });

  test('skipping every step marks the lesson skipped, without stars, and the path moves on', async ({ page }) => {
    await openApp(page, '#/course/find-c');
    await expect(page.locator('.ls-card')).toBeVisible();
    for (let guard = 0; guard < 20; guard++) {
      const info = await stepInfo(page);
      if (!info || info.kind === 'done') break;
      if (info.kind === 'explain') await page.locator('.ls-next').click();
      else await page.getByRole('button', { name: 'Skip this step' }).click();
      await page.waitForTimeout(80);
    }
    await expect(page.getByRole('heading', { name: 'Skipped for now' })).toBeVisible();
    await expect(page.locator('.ls-done-stars')).toHaveCount(0);
    await expect(page.locator('.ls-streak')).toHaveCount(0);
    await page.getByRole('link', { name: /^Next lesson/ }).click();
    await expect(page).toHaveURL(/#\/course\/keys-de$/);
    // The next lesson is open: no "further along" notice.
    await expect(page.locator('.ls-card')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByText('This one is further along')).toBeHidden();

    await page.goto('/#/course');
    await page.reload();
    const side = page.getByRole('complementary', { name: 'Your progress' });
    await expect(side.getByRole('img', { name: '0 of 40 lessons done' })).toBeVisible();
    await expect(side.getByText('0 stars')).toBeVisible();
    await expect(page.getByRole('link', { name: /Lesson 1: Find C\. Skipped/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Lesson 2: D and E\. Up next/ })).toBeVisible();
    await shot(page, 'course-map-skipped');
  });

  test('the map: arrow keys walk the stones, and it scrolls to where the learner is', async ({ page }) => {
    await openApp(page, '#/course');
    const ids = await lessonIds(page);
    for (const id of ids.slice(0, 22)) await putRecord(page, 'lessons', id, { lessonId: id, completed: true, stars: 2, attempts: 1, completedAt: Date.now() });
    await putRecord(page, 'kv', 'course:last-lesson', ids[22]);
    await page.reload();
    const next = page.locator('.cm-spot.is-next');
    await expect(next).toBeInViewport({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: /Unit 6/ })).toBeVisible();
    await shot(page, 'course-map-scrolled');

    const first = page.getByRole('link', { name: /^Lesson 1: Find C/ });
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('link', { name: /^Lesson 2: D and E/ })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('link', { name: /^Lesson 3: F, G, A, B/ })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('link', { name: /^Lesson 2: D and E/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('.cm-stone').last()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#/course/${ids[ids.length - 1]}$`));
  });

  test('phone: the map, a lesson step and the More sheet fit and work', async ({ page }) => {
    await page.setViewportSize(SIZES.phone);
    await openApp(page, '#/course');
    const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await noSideScroll()).toBe(true);
    await page.getByRole('complementary', { name: 'Your progress' }).getByRole('link', { name: /^Start/ }).click();
    await expect(page.locator('.ls-card')).toBeVisible();
    expect(await noSideScroll()).toBe(true);
    await page.getByRole('button', { name: 'More options' }).click();
    const more = page.getByRole('dialog', { name: 'More' });
    await expect(more).toBeVisible();
    await more.getByRole('button', { name: 'Skip this step' }).click();
    await expect(more).toBeHidden();
    expect((await stepInfo(page))?.index).toBe(1);
  });

  test('resume part way through a lesson', async ({ page, piano }) => {
    await openApp(page, '#/course');
    await putRecord(page, 'lessons', 'find-c', { lessonId: 'find-c', completed: true, stars: 3, attempts: 1, completedAt: Date.now() });
    await page.goto('/#/course/keys-de');
    await page.reload();
    await expect(page.locator('.ls-card')).toBeVisible();
    // Go two steps in.
    for (let i = 0; i < 2; i++) {
      const info = await stepInfo(page);
      if (info?.kind === 'explain') await page.locator('.ls-next').click();
      else await page.getByRole('button', { name: 'Skip this step' }).click();
      await page.waitForTimeout(200);
    }
    const at = (await stepInfo(page))!.index;
    expect(at).toBe(2);
    await page.goto('/#/');
    await page.goto('/#/course/keys-de');
    await expect(page.getByRole('button', { name: `Pick up at step ${at + 1}` })).toBeVisible();
    await shot(page, 'course-resume');
    await page.getByRole('button', { name: `Pick up at step ${at + 1}` }).click();
    expect((await stepInfo(page))!.index).toBe(at);
    void piano;
  });

  test.describe('without a piano', () => {
    test.use({ midi: { granted: false, plugged: false }, hasTouch: true });

    test('the keys on the stage can be tapped to play the music (a tablet has nothing else)', async ({ page }) => {
      await page.setViewportSize(SIZES.tabletLandscape);
      await openApp(page, '#/course/find-c');
      await expect(page.locator('.ls-card')).toBeVisible();
      for (let guard = 0; guard < 12; guard++) {
        const info = await stepInfo(page);
        if (info?.kind === 'phrase') break;
        if (info?.kind === 'explain') await page.locator('.ls-next').click();
        else await page.getByRole('button', { name: 'Skip this step' }).click();
        await page.waitForTimeout(100);
      }
      expect((await stepInfo(page))?.kind).toBe('phrase');

      // Find middle C along the bottom of the stage, where the falling notes' keyboard is.
      await page.evaluate(() => {
        const w = window as unknown as { __piano: { app: { input: { on(e: 'down', f: (e: { midi: number; source: string }) => void): () => void } } }; __taps: string[] };
        w.__taps = [];
        w.__piano.app.input.on('down', (e) => w.__taps.push(`${e.midi}:${e.source}`));
      });
      const stage = (await page.locator('.ls-stage-view').boundingBox())!;
      const y = stage.y + stage.height - 16;
      let middleC: number | null = null;
      for (let x = stage.x + 4; x < stage.x + stage.width && middleC === null; x += 8) {
        await page.touchscreen.tap(x, y);
        const last = await page.evaluate(() => (window as unknown as { __taps: string[] }).__taps.at(-1));
        if (last === '60:pointer') middleC = x;
      }
      expect(middleC, 'a tap on the stage keys plays a note').not.toBeNull();

      await page.locator('.ls-start').click();
      for (let i = 0; i < 30 && (await stepInfo(page))?.status !== 'passed'; i++) {
        await page.touchscreen.tap(middleC!, y);
        await page.waitForTimeout(250);
      }
      expect((await stepInfo(page))?.status).toBe('passed');
    });
  });

  test('every lesson loads and every step renders', async ({ page }) => {
    test.setTimeout(240_000);
    await openApp(page, '#/course');
    const ids = await lessonIds(page);
    expect(ids.length).toBe(40);
    // Unlock everything, as if the course was done once.
    for (const id of ids) await putRecord(page, 'lessons', id, { lessonId: id, completed: true, stars: 1, attempts: 1, completedAt: Date.now() });
    const kinds = new Set<string>();
    for (const id of ids) {
      await page.goto(`/#/course/${id}`);
      await expect(page.locator('.ls-card')).toBeVisible();
      for (let guard = 0; guard < 30; guard++) {
        await page.waitForTimeout(80);
        const info = await stepInfo(page);
        if (!info || info.kind === 'done') break;
        if (!kinds.has(info.kind)) {
          kinds.add(info.kind);
          await page.waitForTimeout(300);
          await shot(page, `course-step-${info.kind}`);
        }
        if (info.kind === 'explain') await page.locator('.ls-next').click();
        else await page.getByRole('button', { name: 'Skip this step' }).click();
      }
      await expect(page.locator('.ls-card').first()).toBeVisible();
    }
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['explain', 'find', 'quiz', 'phrase', 'timed', 'perform']));
  });

  // A staff-reading lesson, a chord lesson, a play-along piece and a left-hand lesson, from different units.
  for (const id of ['staff-treble', 'chord-c', 'piece-ode-to-joy', 'lh-steps', 'dyn-soft-loud', 'rhythm-eighths', 'piece-twinkle']) {
    test(`complete lesson ${id} with the fake piano`, async ({ page, piano }) => {
      test.setTimeout(240_000);
      await openApp(page, '#/course');
      const ids = await lessonIds(page);
      for (const other of ids.slice(0, ids.indexOf(id))) {
        await putRecord(page, 'lessons', other, { lessonId: other, completed: true, stars: 2, attempts: 1, completedAt: Date.now() });
      }
      await page.goto(`/#/course/${id}`);
      await page.reload();
      await expect(page.locator('.ls-card')).toBeVisible();
      await completeLesson(page, piano, { prefix: `course-${id}`, seen: new Set() });
      await expect(page.locator('.ls-done')).toBeVisible();
      await shot(page, `course-${id}-done`);
    });
  }

  test('full course pass with the fake piano (E2E_FULL_COURSE=1)', async ({ page, piano }) => {
    test.skip(!process.env.E2E_FULL_COURSE, 'long: set E2E_FULL_COURSE=1 to run every lesson end to end');
    test.setTimeout(90 * 60_000);
    await openApp(page, '#/course');
    const ids = await lessonIds(page);
    const timings: string[] = [];
    for (const id of ids) {
      const t0 = Date.now();
      await page.goto(`/#/course/${id}`);
      await expect(page.locator('.ls-card')).toBeVisible();
      await completeLesson(page, piano);
      await expect(page.locator('.ls-done')).toBeVisible();
      timings.push(`${id}: ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    console.log(`full course pass:\n${timings.join('\n')}`);
  });
});
