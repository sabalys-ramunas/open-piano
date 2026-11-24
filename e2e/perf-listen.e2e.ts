import { test, expect, openApp } from './fixtures';

/**
 * Listen mode on a long, dense song with its recording, on a big screen: the
 * case a learner reported as laggy with notes that "sometimes fail to come in".
 * Measures frame timing and when the app's own notes start on the audio clock
 * compared with when they should. Prints the numbers; asserts loose limits.
 */
test.use({ viewport: { width: 2000, height: 1150 }, deviceScaleFactor: 2 });

interface Stat {
  n: number;
  mean: number;
  p95: number;
  max: number;
}

test('a dense song with its recording plays smoothly and on time in Listen mode', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await page.waitForFunction(() => Boolean((window as unknown as { __piano?: { app?: unknown } }).__piano?.app));
  const id = await page.evaluate(async () => {
    type App = { library: { add(song: object, o: { audio: Blob }): Promise<unknown> }; settings: { set(p: object): void } };
    const app = (window as unknown as { __piano: { app: App } }).__piano.app;
    app.settings.set({ showNoteNames: true, view: 'falling', mode: 'listen', hands: 'both', speed: 1 });
    const LEN = 200;
    const beat = 0.5;
    const notes: { midi: number; start: number; dur: number; hand: string }[] = [];
    const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let b = 0; 1 + b * beat < LEN - 1; b++) {
      const t = 1 + b * beat;
      const chord = chords[Math.floor(b / 4) % 4];
      for (const m of [...chord, chord[0] - 12]) notes.push({ midi: m, start: t, dur: beat * 0.9, hand: 'left' });
      for (let k = 0; k < 2; k++) {
        const m = 64 + Math.floor(rnd() * 14);
        notes.push({ midi: m, start: t + (k * beat) / 2, dur: beat * 0.45, hand: 'right' });
        if (rnd() < 0.4) notes.push({ midi: m - 4, start: t + (k * beat) / 2, dur: beat * 0.45, hand: 'right' });
      }
    }
    notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
    // A quiet 8 kHz WAV as long as the song.
    const sr = 8000;
    const n = (LEN + 1) * sr;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i * 0.3) * 2000 * Math.exp(-((i / sr) % beat) * 8)), true);
    const blob = new Blob([buf], { type: 'audio/wav' });
    const song = { id: 'mine:perf-listen', title: 'Busy song', by: 'Test Suite', notes, source: 'mine', bpm: 120, recording: { name: 'busy.wav', bytes: blob.size } };
    await app.library.add(song, { audio: blob });
    return song.id;
  });

  await openApp(page, `#/play/${encodeURIComponent(id)}`);
  await expect(page.locator('.player')).toHaveAttribute('data-phase', 'ready');
  await page.getByRole('group', { name: 'How to play' }).getByRole('button', { name: 'Listen', exact: true }).click();
  await page.locator('.play-button').click();
  await page.waitForFunction(() => (window as unknown as { __piano: { player: { session: { game: { time: number } } } } }).__piano.player.session.game.time > 3, null, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __piano: { player: { session: { seek(t: number): void } } } }).__piano.player.session.seek(40));
  await page.waitForTimeout(1000);

  const stats = await page.evaluate(async () => {
    type Inst = { play(midi: number, s: number, v?: number, d?: number): void; engine?: { ctx?: { currentTime: number } } };
    const w = window as unknown as { __piano: { app: { audio: { instrument: Inst } }; player: { session: { game: { time: number; notes: { midi: number; start: number }[] }; options: { speed: number } } } } };
    const session = w.__piano.player.session;
    const inst = w.__piano.app.audio.instrument;
    const plays: { t: number; midi: number; ctx: number }[] = [];
    const original = inst.play.bind(inst);
    inst.play = (midi, s, vel, delay = 0) => {
      plays.push({ t: session.game.time + delay * session.options.speed, midi, ctx: (inst.engine?.ctx?.currentTime ?? 0) + delay });
      original(midi, s, vel, delay);
    };
    const gaps: number[] = [];
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const end = last + 6000;
      const step = (now: number) => {
        gaps.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    inst.play = original;
    const offsets: number[] = [];
    for (const p of plays) {
      let best: { start: number } | null = null;
      for (const n of session.game.notes) if (n.midi === p.midi && (!best || Math.abs(n.start - p.t) < Math.abs(best.start - p.t))) best = n;
      if (best) offsets.push(p.ctx - best.start / session.options.speed);
    }
    const median = [...offsets].sort((a, b) => a - b)[Math.floor(offsets.length / 2)] ?? 0;
    const stat = (a: number[]): Stat => {
      const s = [...a].sort((x, y) => x - y);
      return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), p95: s[Math.floor(s.length * 0.95)] ?? 0, max: s[s.length - 1] ?? 0 };
    };
    return { frames: stat(gaps.slice(1)), noteJitterMs: stat(offsets.map((o) => Math.abs(o - median) * 1000)) };
  });
  console.log(`listen mode, dense song with recording, 2000x1150 at 2x: ${JSON.stringify(stats)}`);
  expect(stats.noteJitterMs.n).toBeGreaterThan(50);
  // Notes are handed to the audio clock ahead of time, so slow frames no longer make them late.
  expect(stats.noteJitterMs.p95).toBeLessThan(40);
  expect(stats.frames.mean).toBeLessThan(50);
});
