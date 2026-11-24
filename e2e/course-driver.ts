import type { Page } from '@playwright/test';
import { expect, shot, type Piano } from './fixtures';
import { startBot, stopBot } from './bot';

export interface StepInfo {
  index: number;
  total: number;
  kind: string;
  status: string;
  title: string;
  answer?: number;
  goodKeys?: number[];
  prompt?: string;
  hasSession?: boolean;
}

/** What the lesson is asking for right now, read through the dev-only test handle. */
export async function stepInfo(page: Page): Promise<StepInfo | null> {
  return page.evaluate(() => {
    interface Ctl {
      kind: string;
      status: string;
      step: { kind: string; title: string; answer?: number };
      goodKeys?: () => number[];
      prompt?: string;
      session?: unknown;
    }
    const lesson = (window as unknown as { __piano?: { lesson?: { runner: { current: Ctl | null; index: number; state: { total?: number } } } } }).__piano?.lesson;
    if (!lesson) return null;
    const c = lesson.runner.current;
    if (!c) return { index: lesson.runner.index, total: 0, kind: 'done', status: 'done', title: '' };
    return {
      index: lesson.runner.index,
      total: 0,
      kind: c.step.kind,
      status: c.status,
      title: c.step.title,
      answer: c.step.kind === 'quiz' ? c.step.answer : undefined,
      goodKeys: typeof c.goodKeys === 'function' ? c.goodKeys() : undefined,
      prompt: c.step.kind === 'touch' ? c.prompt : undefined,
      hasSession: Boolean(c.session),
    };
  });
}

async function next(page: Page): Promise<void> {
  const button = page.locator('.ls-next');
  await expect(button).toBeEnabled({ timeout: 90_000 });
  await button.click();
}

/**
 * Completes the open lesson with the fake piano, step by step, the way a
 * learner would: reads the card, answers, finds keys, plays the music.
 * `shots` saves one screenshot per step kind seen, under the given prefix.
 */
export async function completeLesson(page: Page, piano: Piano, shots?: { prefix: string; seen: Set<string> }): Promise<void> {
  for (let guard = 0; guard < 40; guard++) {
    await page.waitForTimeout(150);
    const info = await stepInfo(page);
    if (!info) throw new Error('no lesson on screen');
    if (info.kind === 'done') return;
    const snap = async (suffix = '') => {
      if (shots && !shots.seen.has(info.kind + suffix)) {
        shots.seen.add(info.kind + suffix);
        await shot(page, `${shots.prefix}-${info.kind}${suffix}`);
      }
    };
    switch (info.kind) {
      case 'explain':
        await snap();
        await next(page);
        break;
      case 'quiz': {
        await snap();
        await page.locator('.ls-choice').nth(info.answer ?? 0).click();
        await snap('-answered');
        await next(page);
        break;
      }
      case 'find': {
        await snap();
        for (let k = 0; k < 12; k++) {
          const now = await stepInfo(page);
          if (!now || now.status === 'passed' || now.index !== info.index) break;
          const key = now.goodKeys?.[0];
          if (key === undefined) break;
          await piano.tap(key);
          await page.waitForTimeout(60);
        }
        await snap('-found');
        await next(page);
        break;
      }
      case 'touch': {
        await snap();
        for (let k = 0; k < 12; k++) {
          const now = await stepInfo(page);
          if (!now || now.status === 'passed' || now.index !== info.index) break;
          await piano.tap(60, 80, now.prompt === 'soft' ? 25 : 120);
          await page.waitForTimeout(60);
        }
        await next(page);
        break;
      }
      default: {
        // listen, phrase, timed, perform, song: the music plays on the stage.
        if (!info.hasSession) {
          await page.getByRole('button', { name: 'Skip this step' }).click();
          break;
        }
        await startBot(page, { target: 'lesson' });
        await page.locator('.ls-start').click();
        await page.waitForTimeout(1200);
        await snap();
        await expect.poll(async () => (await stepInfo(page))?.status, { timeout: 120_000 }).toBe('passed');
        await stopBot(page);
        await snap('-passed');
        await next(page);
      }
    }
  }
  throw new Error('the lesson did not finish');
}
