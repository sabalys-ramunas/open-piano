import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect, openApp, shot, SIZES } from './fixtures';
import { sessionInfo, startBot, stopBot } from './bot';

test.use({ midi: { granted: true, plugged: true } });

/** The four shared sizes plus a phone on its side. */
const ALL_SIZES = { ...SIZES, phoneLandscape: { width: 844, height: 390 } } as const;
type Size = keyof typeof ALL_SIZES;

async function openSong(page: Page, songId: string): Promise<void> {
  await openApp(page, `#/play/${encodeURIComponent(songId)}`);
  await expect(page.locator('.player-title')).not.toBeEmpty();
  await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __piano?: { player?: unknown } }).__piano?.player))).toBe(true);
}

async function phase(page: Page): Promise<string | null> {
  return page.locator('.player').getAttribute('data-phase');
}

async function pickMode(page: Page, label: 'Listen' | 'Learn' | 'Play along'): Promise<void> {
  await page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: label, exact: true }).click();
}

async function pickHands(page: Page, label: 'Right hand' | 'Left hand' | 'Both hands'): Promise<void> {
  await page.getByRole('group', { name: 'Hands' }).getByRole('button', { name: label }).click();
}

/** Opens the Practice tools sheet from the get-ready page or the pause sheet, whichever is showing. */
async function openTools(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Practice tools' }).click();
  const sheet = page.getByRole('dialog', { name: 'Practice tools' });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeTools(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Practice tools' }).getByRole('button', { name: 'Done' }).click();
  // Gone from the page, not only hidden: closing returns focus to the opener a moment later.
  await expect(page.locator('dialog.tools-sheet')).toHaveCount(0);
}

async function setCountIn(page: Page, on: boolean): Promise<void> {
  const sheet = await openTools(page);
  await sheet.getByRole('switch', { name: 'Count in before Play along' }).setChecked(on);
  await closeTools(page);
}

async function pickView(page: Page, label: 'Falling notes' | 'Sheet music'): Promise<void> {
  const sheet = await openTools(page);
  await sheet.getByRole('group', { name: 'View' }).getByRole('button', { name: label }).click();
  await closeTools(page);
}

/** Pauses with the round button and returns the pause sheet. */
async function pause(page: Page): Promise<Locator> {
  await page.locator('.play-button').click();
  const sheet = page.getByRole('dialog', { name: 'Paused' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Waits until Learn is holding the song at the next note, waiting for a key. */
async function waitHolding(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g = (window as unknown as { __piano: { player: { session: { game: { time: number; notes: { start: number }[]; nextGroup(): number[] } } } } }).__piano.player.session.game;
          const next = g.nextGroup();
          return next.length > 0 && g.notes[next[0]].start - g.time < 0.05;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function audioState(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const url = '/src/audio/context.ts';
    const mod = (await import(/* @vite-ignore */ url)) as { audioContext(): AudioContext };
    return mod.audioContext().state;
  });
}

/** Serious or critical WCAG A/AA problems on the page as it is now. */
async function axe(page: Page): Promise<string[]> {
  // Let sheets and buttons finish fading in first: half-faded text is measured as low contrast.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.waitForTimeout(350); // transitions that have not started an animation yet
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('player', () => {
  test('accessibility: get ready, practice tools, playing, pause and results pass axe; keyboard reaches everything', async ({ page, browserName }) => {
    await openSong(page, 'twinkle');
    await page.waitForTimeout(400);
    expect(await axe(page), 'get ready').toEqual([]);
    // Tab reaches the back link, the three ways, the three hands, Play and the tools, with a visible focus ring.
    const seen = new Set<string>();
    // Safari moves between buttons and links with Option+Tab (plain Tab only visits fields, unless the user changed that).
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(tab);
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return '';
        const ring = getComputedStyle(el).boxShadow;
        return `${el.textContent?.trim().slice(0, 20)}|${ring !== 'none'}`;
      });
      if (name) seen.add(name);
    }
    expect([...seen].filter((x) => x.endsWith('|true')).length).toBeGreaterThanOrEqual(8);
    await openTools(page);
    expect(await axe(page), 'practice tools').toEqual([]);
    await closeTools(page);
    await pickMode(page, 'Listen');
    await page.locator('.play-button').click();
    await page.waitForTimeout(1200);
    expect(await axe(page), 'playing').toEqual([]);
    await pause(page);
    expect(await axe(page), 'pause sheet').toEqual([]);
    await page.getByRole('button', { name: 'Start again' }).click();
    await pickMode(page, 'Learn');
    await page.locator('.play-button').click();
    await startBot(page, { target: 'player', wrongAt: 3 });
    await expect(page.locator('#player-overlay-title')).toBeVisible({ timeout: 60_000 });
    await stopBot(page);
    await page.waitForTimeout(1500);
    await page.getByText('See details').click();
    expect(await axe(page), 'results').toEqual([]);
  });

  test('get ready: one big Play, three ways to play, hands, and choices remembered per song', async ({ page }) => {
    const samples: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/samples/piano/')) samples.push(r.status());
    });
    await openSong(page, 'twinkle');
    const ready = page.locator('.getready');
    await expect(ready.locator('svg.getready-art')).toBeVisible();
    await expect(page.locator('.play-button')).toHaveText('Play');
    await expect(page.locator('.play-button')).toBeInViewport();
    await expect(page.locator('.player-status')).toContainText('Test Digital Piano');
    // Beginner defaults: Learn with the right hand, full speed.
    await expect(page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: 'Learn', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Hands' }).getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'true');
    // Each way to play is explained in five words or fewer.
    for (const hint of await ready.locator('.mode-choice-hint').allTextContents()) expect(hint.split(/\s+/).length).toBeLessThanOrEqual(5);

    for (const mode of ['Listen', 'Learn', 'Play along'] as const) {
      await pickMode(page, mode);
      for (const hands of ['Right hand', 'Left hand', 'Both hands'] as const) {
        await pickHands(page, hands);
        expect((await sessionInfo(page)).hands).toBe(hands === 'Right hand' ? 'right' : hands === 'Left hand' ? 'left' : 'both');
      }
      await pickHands(page, 'Right hand');
      // Play along counts in first; turn that off here, it has its own test.
      if (mode === 'Play along') await setCountIn(page, false);
      for (const view of ['Falling notes', 'Sheet music'] as const) {
        await pickView(page, view);
        await page.locator('.play-button').click();
        await expect.poll(() => phase(page)).toBe('playing');
        await page.waitForTimeout(700);
        const before = await sessionInfo(page);
        await page.waitForTimeout(500);
        const info = await sessionInfo(page);
        expect(info.running).toBe(true);
        // Learn may already be holding at the first note; the others keep moving.
        if (mode !== 'Learn') expect(info.time - before.time).toBeGreaterThan(0.3);
        await shot(page, `player-${mode.replace(' ', '-').toLowerCase()}-${view === 'Sheet music' ? 'sheet' : 'falling'}`);
        const sheet = await pause(page);
        expect((await sessionInfo(page)).running).toBe(false);
        // Start again goes back to the get-ready page, ready for the next try.
        await sheet.getByRole('button', { name: 'Start again' }).click();
        await expect.poll(() => phase(page)).toBe('ready');
        expect((await sessionInfo(page)).time).toBeLessThanOrEqual(0);
      }
    }
    await pickView(page, 'Falling notes');

    // Speeds: buttons and the slider both change the session speed; the get-ready page shows it.
    const tools = await openTools(page);
    await tools.getByRole('button', { name: 'Slower' }).click();
    await expect(tools.locator('.speed-out')).toHaveText('95%');
    expect((await sessionInfo(page)).speed).toBeCloseTo(0.95);
    await tools.getByRole('slider', { name: 'Speed' }).fill('50');
    await expect(tools.locator('.speed-out')).toHaveText('50%');
    await tools.getByRole('button', { name: 'Faster' }).click();
    await expect(tools.locator('.speed-out')).toHaveText('55%');
    for (let i = 0; i < 4; i++) await tools.getByRole('button', { name: 'Faster' }).click();
    await expect(tools.locator('.speed-out')).toHaveText('75%');
    await closeTools(page);
    await expect(page.locator('.getready-facts')).toContainText('Speed 75%');

    // The hands and speed are remembered for this song.
    await pickHands(page, 'Left hand');
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
    await expect(page.getByRole('group', { name: 'Hands' }).getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await sessionInfo(page)).speed).toBeCloseTo(0.75);
    expect((await sessionInfo(page)).hands).toBe('left');

    // Sound starts with the first press after a reload (Chromium here allows it even before one; Safari does not).
    await page.locator('.play-button').click();
    await expect.poll(() => audioState(page)).toBe('running');
    expect(samples.length, 'piano samples were requested').toBeGreaterThan(0);
    expect(samples.every((s) => s === 200 || s === 304 || s === 206)).toBe(true);
  });

  test('Learn waits for the right key and says which, marks wrong keys, and a perfect run is celebrated', async ({ page, piano }) => {
    await openSong(page, 'twinkle');
    await pickMode(page, 'Learn');
    await pickHands(page, 'Right hand');
    await page.locator('.play-button').click();
    await page.waitForTimeout(2500);
    const waiting = await sessionInfo(page);
    await page.waitForTimeout(600);
    expect((await sessionInfo(page)).time, 'the song holds at the first note').toBeCloseTo(waiting.time, 2);
    // After a moment, a bubble says which key to press.
    await expect(page.locator('.learn-hint')).toBeVisible();
    await expect(page.locator('.learn-hint')).toContainText('Press');
    await expect(page.locator('.learn-hint b')).toHaveText('C');
    await shot(page, 'player-learn-waiting');

    // A wrong key is counted and drawn, and the song still waits.
    await piano.tap(61);
    await expect.poll(async () => (await sessionInfo(page)).wrong).toBe(1);
    await shot(page, 'player-learn-wrong-key');
    // The right key moves it on.
    await piano.tap(60);
    await expect.poll(async () => (await sessionInfo(page)).hits).toBe(1);

    // Start over and let the fake piano play every note correctly.
    const sheet = await pause(page);
    await sheet.getByRole('button', { name: 'Start again' }).click();
    await page.locator('.play-button').click();
    await startBot(page, { target: 'player' });
    await expect(page.locator('#player-overlay-title')).toBeVisible({ timeout: 60_000 });
    await stopBot(page);
    const results = page.getByRole('dialog', { name: 'Beautifully played!' });
    await expect(results.locator('.stars-row')).toHaveAttribute('aria-label', '3 of 3 stars');
    await expect(results.locator('.results-line')).toContainText('100%');
    await expect(results.locator('.results-points')).not.toHaveText('0');
    // Exactly two big choices; no tricky part after a clean run; the details wait behind a summary.
    await expect(results.locator('.results-actions > *')).toHaveCount(2);
    await expect(results.getByRole('button', { name: 'Play again' })).toBeFocused();
    await expect(results.getByRole('link', { name: /^Next song/ })).toBeVisible();
    await expect(results.locator('.tricky-card')).toHaveCount(0);
    await expect(results.locator('.results-numbers')).toBeHidden();
    await page.waitForTimeout(1250); // let the stars land and the confetti fly
    await shot(page, 'player-results-3-stars', false, 'allow');
    await results.getByText('See details').click();
    await expect(results.locator('.results-numbers')).toContainText('100%');
    await shot(page, 'player-results-details');
    await page.setViewportSize(SIZES.phone);
    await results.getByText('See details').click();
    await shot(page, 'player-results-3-stars-phone');
    await page.setViewportSize(SIZES.desktop);

    // Play again starts straight away.
    await results.getByRole('button', { name: 'Play again' }).click();
    await expect.poll(() => phase(page)).toBe('playing');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();

    // Saved: the home card shows the stars after a reload.
    await page.goto('/#/');
    // Let the songs screen finish loading first: reloading mid-load aborts its module import, which Safari reports as an error.
    await expect(page.locator('.pcard').first()).toBeVisible();
    await page.reload();
    const card = page.locator('.pcard[data-song-id="twinkle"]').first();
    await expect(card.getByRole('img', { name: '3 of 3 stars' })).toBeAttached();
  });

  test('Play along counts in, the chrome fades while playing, and a bumpy run offers the tricky part', async ({ page }) => {
    await openSong(page, 'ode');
    await pickMode(page, 'Play along');
    await pickHands(page, 'Right hand');
    await page.locator('.play-button').click();
    await expect(page.locator('.countin')).toBeVisible();
    await expect(page.locator('.play-button')).toHaveText('Cancel');
    await page.waitForTimeout(450);
    await shot(page, 'player-count-in', false, 'allow');
    await expect(page.locator('.play-button')).toHaveText('Pause', { timeout: 10_000 });
    await startBot(page, { target: 'player', skipEvery: 3 });
    // The chrome fades after a few quiet seconds and comes back on mouse movement.
    await page.mouse.move(700, 500);
    await expect(page.locator('.player')).toHaveClass(/is-idle/, { timeout: 6000 });
    await shot(page, 'player-flow-idle');
    await page.mouse.move(720, 420);
    await expect(page.locator('.player')).not.toHaveClass(/is-idle/);
    await expect(page.locator('#player-overlay-title')).toBeVisible({ timeout: 60_000 });
    await stopBot(page);
    const results = page.locator('.results');
    await expect(results.locator('.stars-row')).toHaveAttribute('aria-label', '1 of 3 stars');
    await expect(results.locator('.tricky-card')).toBeVisible();
    await expect(results.getByRole('link', { name: 'Back to songs' })).toBeVisible();
    await page.waitForTimeout(1300);
    await shot(page, 'player-results-1-star');
    await results.getByText('See details').click();
    await expect(results.locator('.histo')).toBeVisible();
    await expect(results.locator('.passage').first()).toBeVisible();
    await shot(page, 'player-results-1-star-details');
    // Practise the tricky part: a slow loop starts at once.
    await results.locator('.tricky-card').getByRole('button', { name: 'Practise it' }).click();
    await expect.poll(async () => (await sessionInfo(page)).loop).not.toBeNull();
    expect((await sessionInfo(page)).speed).toBeLessThan(1);
    await expect.poll(() => phase(page)).not.toBe('results');
  });

  test('Space pauses and resumes, seek, loops, the tricky part, show me, metronome and full screen', async ({ page }) => {
    await openSong(page, 'pack:beethoven-fur-elise-easy');
    await pickMode(page, 'Play along');
    let tools = await openTools(page);
    await tools.getByRole('switch', { name: 'Count in before Play along' }).setChecked(false);
    await tools.getByRole('switch', { name: 'Metronome clicks' }).setChecked(true);
    await shot(page, 'player-tools');
    await closeTools(page);

    // Space on the get-ready page's Play button starts; Space again pauses and opens the pause sheet.
    await page.locator('.play-button').focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await sessionInfo(page)).running).toBe(true);
    await expect(page.locator('.play-button')).toHaveText('Pause');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __piano: { app: { audio: { metronome: { running: boolean } } } } }).__piano.app.audio.metronome.running)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await sessionInfo(page)).running).toBe(false);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
    await expect(page.locator('.play-button')).toHaveText('Continue');
    await shot(page, 'player-pause');
    const pausedAt = (await sessionInfo(page)).time;
    await page.waitForTimeout(400);
    expect((await sessionInfo(page)).time).toBeCloseTo(pausedAt, 3);
    // Space on the focused Resume button resumes.
    await page.keyboard.press('Space');
    await expect.poll(async () => (await sessionInfo(page)).running).toBe(true);
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();

    // Close the sheet (still paused) and seek by clicking the progress bar at the middle.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
    expect(await phase(page)).toBe('paused');
    await shot(page, 'player-paused-stage');
    const track = page.locator('.hud-track');
    const box = (await track.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    const info = await sessionInfo(page);
    expect(info.time / info.length).toBeGreaterThan(0.4);
    expect(info.time / info.length).toBeLessThan(0.6);
    // The arrow keys move along the song too.
    await track.focus();
    await page.keyboard.press('ArrowRight');
    expect((await sessionInfo(page)).time).toBeGreaterThan(info.time + 2);

    // A loop from here to two seconds on. Escape brings the pause sheet back.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    tools = await openTools(page);
    await tools.getByRole('button', { name: 'Set loop start' }).click();
    await closeTools(page);
    // Closing the tools from a paused song brings the pause sheet back.
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.waitForTimeout(2200);
    await pause(page);
    tools = await openTools(page);
    await tools.getByRole('button', { name: 'Set loop end' }).click();
    expect((await sessionInfo(page)).loop).not.toBeNull();
    await tools.getByRole('button', { name: 'Stop looping' }).click();
    expect((await sessionInfo(page)).loop).toBeNull();
    await closeTools(page);

    // Make some mistakes, then practise the tricky part.
    await page.getByRole('button', { name: 'Start again' }).click();
    await startBot(page, { target: 'player', skipEvery: 3 });
    await page.locator('.play-button').click();
    await page.waitForTimeout(5000);
    await stopBot(page);
    await pause(page);
    tools = await openTools(page);
    await tools.getByRole('button', { name: 'Practise the tricky part' }).click();
    await expect(page.getByRole('dialog', { name: 'Practice tools' })).toBeHidden();
    const tricky = await sessionInfo(page);
    expect(tricky.loop).not.toBeNull();
    expect(tricky.speed).toBeLessThan(1);
    expect(tricky.running).toBe(true);
    await page.waitForTimeout(400);
    await shot(page, 'player-tricky');
    await pause(page);

    // Show me: plays a few seconds, then comes back to where it was.
    const at = (await sessionInfo(page)).time;
    tools = await openTools(page);
    await tools.getByRole('button', { name: 'Show me how it goes' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __piano: { player: { session: { previewing: boolean } } } }).__piano.player.session.previewing)).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __piano: { player: { session: { previewing: boolean } } } }).__piano.player.session.previewing), { timeout: 10_000 }).toBe(false);
    expect((await sessionInfo(page)).time).toBeCloseTo(at, 1);

    // Full screen (Escape brings back the pause sheet, which leads to the tools). The tools close as the
    // screen fills and the pause sheet comes back on top of the full-screen player, where it can be pressed.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    tools = await openTools(page);
    await tools.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(page.locator('dialog.tools-sheet')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    const onTop = () =>
      page.evaluate(() => {
        const d = document.querySelector('dialog[open]');
        if (!d) return false;
        const r = d.getBoundingClientRect();
        return d.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
    expect(await onTop(), 'the pause sheet is drawn over the full-screen player').toBe(true);
    tools = await openTools(page);
    expect(await onTop(), 'the tools are drawn over the full-screen player').toBe(true);
    await tools.getByRole('button', { name: 'Leave full screen' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await closeTools(page);

    // Leave goes back to the songs.
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('link', { name: 'Leave' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a burst of frames mid-song with hits, and frame timing on a dense song', async ({ page, browserName }) => {
    await openSong(page, 'pack:joplin-maple-leaf-rag');
    await pickMode(page, 'Play along');
    await pickHands(page, 'Both hands');
    await setCountIn(page, false);
    await startBot(page, { target: 'player', skipEvery: 9 });
    await page.locator('.play-button').click();
    await page.waitForTimeout(3000);
    for (let i = 0; i < 6; i++) {
      await shot(page, `player-burst-${i}`, false, 'allow');
      await page.waitForTimeout(120);
    }
    // Frame timing over five seconds while the bot plays a busy rag with both hands, and the
    // main thread's own work per frame (scripts, style, layout, paint) from the browser's counters.
    // The browser's own counters exist only in Chromium; Safari's engine still measures frame timing.
    const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
    await cdp?.send('Performance.enable');
    const metric = async (): Promise<Record<string, number>> => (cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])) : {});
    const before = await metric();
    const stats = await page.evaluate(
      () =>
        new Promise<{ frames: number; mean: number; p95: number; max: number; long: number }>((resolve) => {
          const times: number[] = [];
          let last = performance.now();
          const end = last + 5000;
          const step = (now: number) => {
            times.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(step);
            else {
              const sorted = [...times].sort((a, b) => a - b);
              resolve({
                frames: times.length,
                mean: times.reduce((a, b) => a + b, 0) / times.length,
                p95: sorted[Math.floor(sorted.length * 0.95)],
                max: sorted[sorted.length - 1],
                long: times.filter((t) => t > 34).length,
              });
            }
          };
          requestAnimationFrame(step);
        }),
    );
    const after = await metric();
    await stopBot(page);
    const per = (k: string) => (k in after ? Math.round(((after[k] - before[k]) * 1000 * 100) / stats.frames) / 100 : null);
    const work = { task: per('TaskDuration'), script: per('ScriptDuration'), style: per('RecalcStyleDuration'), layout: per('LayoutDuration') };
    console.log(`frame timing (Maple Leaf Rag, both hands, falling notes): ${JSON.stringify(stats)} main thread ms per frame: ${JSON.stringify(work)}`);
    expect(stats.mean).toBeLessThan(34);
  });

  test('computer keys, on-screen keys, pedal, lit keys on the piano, and unplugging pauses', async ({ page, piano }) => {
    await openSong(page, 'twinkle');
    await pickMode(page, 'Learn');
    await pickHands(page, 'Right hand');
    // Light the keys on the fake piano: choose it as the output.
    await page.evaluate(() => (window as unknown as { __piano: { app: { settings: { set(p: object): void } } } }).__piano.app.settings.set({ midiOutput: 'Test Digital Piano' }));
    await page.locator('.play-button').click();
    await expect.poll(async () => (await sessionInfo(page)).running).toBe(true);
    // The first note is C4: its key lights up on the piano (a note-on message to the output).
    await expect.poll(async () => (await piano.sent()).some((m) => (m[0] & 0xf0) === 0x90 && m[1] === 60 && m[2] > 0), { timeout: 8000 }).toBe(true);

    // Computer keyboard: the song's lowest C is on Z.
    await waitHolding(page);
    await page.keyboard.down('z');
    await page.keyboard.up('z');
    await expect.poll(async () => (await sessionInfo(page)).hits).toBe(1);

    // On-screen key: tap the next note (C4 again) on the drawn keyboard.
    await waitHolding(page);
    const p = await page.evaluate(() => (window as unknown as { __piano: { player: { keyPoint(m: number): { x: number; y: number } | null } } }).__piano.player.keyPoint(60));
    expect(p).not.toBeNull();
    await page.mouse.move(p!.x, p!.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await sessionInfo(page)).hits).toBe(2);

    // The sustain pedal reaches the app.
    await piano.pedal(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __piano: { app: { input: { pedal: boolean } } } }).__piano.app.input.pedal)).toBe(true);
    await piano.pedal(false);

    // Unplugging the piano pauses the song and says why.
    await piano.unplug();
    await expect.poll(async () => (await sessionInfo(page)).running).toBe(false);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toContainText('unplugged');
    await shot(page, 'player-unplugged');
    await piano.plug();
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Start again' }).click();
    await expect(page.locator('.player-status')).toContainText('Test Digital Piano');
  });

  test('playing with the computer keyboard: big letters on the keys', async ({ page }) => {
    await openSong(page, 'twinkle');
    await page.evaluate(() => (window as unknown as { __piano: { app: { settings: { set(p: object): void } } } }).__piano.app.settings.set({ showKeyLetters: true }));
    await page.evaluate(() => window.__midi.unplug());
    await expect(page.locator('.player-status')).toContainText('computer keys');
    await page.locator('.play-button').click();
    await page.waitForTimeout(2600);
    await expect(page.locator('.learn-hint-key')).toHaveText(/Z/);
    await shot(page, 'player-learn-computer-keys');
  });

  test('friendly notices: a missing recording and a lesson made automatically, one action each', async ({ page }) => {
    await openApp(page, '#/');
    // A song made from a recording whose audio is not on this device.
    await page.evaluate(async () => {
      const app = (window as unknown as { __piano: { app: { library: { add(song: object): Promise<unknown> } } } }).__piano.app;
      const notes = [60, 62, 64, 65, 67, 65, 64, 62].map((midi, i) => ({ midi, start: i * 0.5, dur: 0.45, hand: 'right' }));
      await app.library.add({ id: 'mine:notice-test', title: 'My Recorded Tune', by: '', notes, source: 'mine', recording: { name: 'my-tune.mp3', bytes: 1234 } });
      const url = '/src/app/handoff.ts';
      const handoff = (await import(/* @vite-ignore */ url)) as { setHandoff(h: object): void };
      handoff.setHandoff({ kind: 'imported', songId: 'mine:notice-test', automatic: true });
    });
    await page.goto('/#/play/mine%3Anotice-test');
    await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
    const recording = page.locator('.stage-note').filter({ hasText: 'Hear the original?' });
    const made = page.locator('.stage-note-import');
    await expect(recording).toBeVisible();
    await expect(made).toBeVisible();
    await expect(recording.getByRole('button', { name: 'Add the recording' })).toBeVisible();
    await expect(made.getByRole('link', { name: 'Fix the notes' })).toBeVisible();
    await shot(page, 'player-notices');
    await page.setViewportSize(SIZES.phone);
    await shot(page, 'player-notices-phone');
    await page.setViewportSize(SIZES.desktop);
    // Each closes with its round button and gives focus back to Play.
    await made.getByRole('button', { name: 'Got it' }).click();
    await expect(made).toBeHidden();
    await recording.getByRole('button', { name: 'Play with the piano sound' }).click();
    await expect(recording).toBeHidden();
    await expect(page.locator('.play-button')).toBeFocused();
  });

  test('every state at every size: the stage takes the whole screen, and nothing spills sideways', async ({ page }) => {
    test.setTimeout(240_000);
    const shotAt = async (size: Size, name: string) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} at ${size} spills sideways`).toBeLessThanOrEqual(0);
      await shot(page, `${name}-${size}`);
    };
    for (const size of Object.keys(ALL_SIZES) as Size[]) {
      await page.setViewportSize(ALL_SIZES[size]);
      await openSong(page, 'pack:beethoven-fur-elise-easy');
      await page.waitForTimeout(300);
      await expect(page.locator('.play-button')).toBeVisible();
      await shotAt(size, 'ready');
      const tools = await openTools(page);
      await shotAt(size, 'tools');
      await tools.getByRole('button', { name: 'Close' }).click();

      // Mid-song in Play along with hits.
      await pickMode(page, 'Play along');
      await pickHands(page, 'Both hands');
      await setCountIn(page, false);
      await startBot(page, { target: 'player', skipEvery: 7 });
      await page.locator('.play-button').click();
      await page.waitForTimeout(4200);
      // The stage takes essentially the whole screen: the drawn keyboard reaches the bottom.
      const stageBox = (await page.locator('.stage-view').boundingBox())!;
      expect(stageBox.height).toBeGreaterThanOrEqual(ALL_SIZES[size].height - 2);
      await shot(page, `playing-${size}`, false, 'allow');
      await pause(page);
      await stopBot(page);
      await shotAt(size, 'pause');
      await page.getByRole('button', { name: 'Start again' }).click();

      // Learn waiting at the first note.
      await pickMode(page, 'Learn');
      await pickHands(page, 'Right hand');
      await page.locator('.play-button').click();
      await page.waitForTimeout(2800);
      await shot(page, `learn-waiting-${size}`, false, 'allow');
      await pause(page);
      await page.getByRole('button', { name: 'Start again' }).click();

      // Sheet music, playing in Listen.
      await pickView(page, 'Sheet music');
      await pickMode(page, 'Listen');
      await page.locator('.play-button').click();
      await page.waitForTimeout(3000);
      await shot(page, `sheet-${size}`);
      await pause(page);
      await page.getByRole('button', { name: 'Start again' }).click();
      await pickView(page, 'Falling notes');
      await pickMode(page, 'Learn');
    }
  });

  test('phone sizes: Play is on screen, the tools sheet opens full width at its title, the pause sheet fits', async ({ page }) => {
    for (const size of [{ width: 393, height: 852 }, { width: 852, height: 393 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(size);
      await openApp(page, '#/play/twinkle');
      await expect(page.locator('.play-button')).toBeInViewport({ ratio: 1 });
      await page.getByRole('button', { name: 'Practice tools' }).first().click();
      const sheet = page.locator('dialog.tools-sheet');
      await expect(page.locator('#tools-title')).toBeInViewport();
      await page.waitForTimeout(500); // the sheet slides in with a little scale
      const box = (await sheet.boundingBox())!;
      if (size.width <= 600) expect(Math.round(box.width)).toBe(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
      await page.keyboard.press('Escape');
      await page.locator('.play-button').click();
      await page.waitForTimeout(800);
      await page.locator('.play-button').click();
      const pause = page.locator('dialog.pause-sheet');
      await expect(pause).toBeVisible();
      for (const name of ['Resume', 'Start again', 'Practice tools', 'Leave']) await expect(pause.getByRole(name === 'Leave' ? 'link' : 'button', { name })).toBeInViewport({ ratio: 1 });
      await shot(page, `player-pause-${size.width}x${size.height}`);
    }
  });

  test('the chosen way to play shows a clear keyboard focus ring', async ({ page, browserName }) => {
    await openApp(page, '#/play/twinkle');
    const learn = page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: 'Learn', exact: true });
    await learn.focus();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(learn).toBeFocused();
    const outline = await learn.evaluate((b) => {
      const card = b.closest('.mode-choice')!;
      const cs = getComputedStyle(card);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor };
    });
    expect(outline.style).toBe('solid');
    expect(outline.width).toBeGreaterThanOrEqual(2);
    expect(outline.color).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });
});
