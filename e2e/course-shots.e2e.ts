import type { Page } from '@playwright/test';
import { test, expect, openApp, putRecord, shot, SIZES, type SizeName } from './fixtures';
import { completeLesson, stepInfo } from './course-driver';

/**
 * A screenshot gallery of the course at every size, for design review. Long,
 * so it only runs with E2E_COURSE_SHOTS=1 (point E2E_SHOTS at a folder).
 */

test.use({ midi: { granted: true, plugged: true } });

async function goToStep(page: Page, lessonId: string, step: number): Promise<void> {
  await page.goto(`/#/course/${lessonId}`);
  await expect(page.locator('.ls-card')).toBeVisible();
  await page.evaluate((i) => (window as unknown as { __piano: { lesson: { runner: { goTo(n: number): void } } } }).__piano.lesson.runner.goTo(i), step);
  await page.waitForTimeout(450);
}

async function seed(page: Page, done: number, skipped: string[] = []): Promise<string[]> {
  const ids = await page.evaluate(async () => {
    const url = '/src/course/curriculum.ts';
    const mod = (await import(/* @vite-ignore */ url)) as { allLessons(): { id: string }[] };
    return mod.allLessons().map((l) => l.id);
  });
  for (const [i, id] of ids.slice(0, done).entries()) {
    if (skipped.includes(id)) continue;
    await putRecord(page, 'lessons', id, { lessonId: id, completed: true, stars: ((i % 3) + 1) as 1 | 2 | 3, attempts: 1, completedAt: Date.now() });
  }
  if (skipped.length) await putRecord(page, 'kv', 'course:skipped', skipped);
  await putRecord(page, 'kv', 'course:last-lesson', ids[done]);
  return ids;
}

test.describe('course gallery', () => {
  test.skip(!process.env.E2E_COURSE_SHOTS, 'screenshots for review: set E2E_COURSE_SHOTS=1');

  for (const size of Object.keys(SIZES) as SizeName[]) {
    test(`map and steps at ${size}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(SIZES[size]);
      await openApp(page, '#/course');
      await page.waitForTimeout(500);
      await shot(page, `${size}-map-fresh`);

      await seed(page, 8, ['keys-de']);
      await page.reload();
      await page.waitForTimeout(1200);
      await shot(page, `${size}-map-mid`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await shot(page, `${size}-map-mid-top`);
      await shot(page, `${size}-map-full`, true);

      for (const [name, id, step] of [
        ['explain-keys', 'find-c', 0],
        ['explain-hand', 'rh-fingers', 0],
        ['explain-rhythm', 'rhythm-long', 0],
        ['explain-art', 'band', 0],
        ['find', 'find-c', 2],
        ['find-finger', 'lh-position', 1],
        ['quiz', 'find-c', 4],
        ['quiz-staff', 'staff-treble', 3],
        ['touch', 'dyn-soft-loud', 2],
        ['play', 'find-c', 5],
        ['play-sheet', 'staff-treble', 4],
      ] as const) {
        await goToStep(page, id, step);
        await shot(page, `${size}-step-${name}`);
      }

      // A wrong key, then the right one: the gentle hint, then the "Nice!" bar.
      await goToStep(page, 'find-c', 2);
      await page.evaluate(() => window.__midi.send([0x90, 62, 90]));
      await page.evaluate(() => window.__midi.send([0x80, 62, 0]));
      await page.waitForTimeout(250);
      await shot(page, `${size}-step-find-wrong`);
      await page.evaluate(() => window.__midi.send([0x90, 60, 90]));
      await page.evaluate(() => window.__midi.send([0x80, 60, 0]));
      await page.waitForTimeout(700);
      await shot(page, `${size}-step-find-nice`);

      await goToStep(page, 'find-c', 4);
      await page.locator('.ls-choice').nth(1).click();
      await page.waitForTimeout(500);
      await shot(page, `${size}-step-quiz-wrong`);
      await page.locator('.ls-choice').nth(0).click();
      await page.waitForTimeout(700);
      await shot(page, `${size}-step-quiz-nice`);

      await goToStep(page, 'find-c', 5);
      await page.getByRole('button', { name: 'More options' }).click();
      await page.waitForTimeout(400);
      await shot(page, `${size}-more-sheet`);
      await page.keyboard.press('Escape');

      // Skip every step: the lesson ends as skipped, without stars.
      await goToStep(page, 'high-low', 0);
      for (let i = 0; i < 10; i++) {
        const info = await stepInfo(page);
        if (!info || info.kind === 'done') break;
        if (info.kind === 'explain') await page.locator('.ls-next').click();
        else await page.getByRole('button', { name: 'Skip this step' }).click();
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(500);
      await shot(page, `${size}-done-skipped`);
    });
  }

  test('lesson complete with the streak moment, at every size', async ({ page, piano }) => {
    test.setTimeout(240_000);
    for (const size of Object.keys(SIZES) as SizeName[]) {
      await page.setViewportSize(SIZES[size]);
      await openApp(page, '#/course/find-c');
      // Forget any earlier lesson today, so this one is the first of the day.
      await putRecord(page, 'kv', 'course:lesson-day', '');
      await page.reload();
      await expect(page.locator('.ls-card')).toBeVisible();
      await completeLesson(page, piano);
      await expect(page.locator('.ls-streak')).toBeVisible();
      await page.waitForTimeout(1800);
      await shot(page, `${size}-done-streak`, false, 'allow');
    }
  });
});
