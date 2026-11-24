import type { Page } from '@playwright/test';

export interface BotOptions {
  /** Which test handle holds the session: the player screen or the course's play step. */
  target: 'player' | 'lesson';
  /** Press one wrong key (a semitone off) before this many right notes, then play on correctly. 0 = never. */
  wrongAt?: number;
  /** Skip (do not play) every n-th note, to make mistakes in Play along. 0 = never. */
  skipEvery?: number;
}

/**
 * Plays the song perfectly through the fake USB piano: a small loop in the page
 * watches the song clock and sends note-on/off messages to the fake MIDI input
 * just like a person pressing keys. Nothing is called on the session directly.
 */
export async function startBot(page: Page, options: BotOptions): Promise<void> {
  await page.evaluate((o) => {
    interface NoteLike {
      midi: number;
      start: number;
    }
    interface GameLike {
      time: number;
      notes: readonly NoteLike[];
      state: readonly string[];
      opts: { mode: string };
      nextGroup(): number[];
    }
    interface SessionLike {
      game: GameLike;
      running: boolean;
    }
    const w = window as unknown as {
      __piano?: Record<string, { session: SessionLike } | undefined>;
      __midi: { send(bytes: number[]): void };
      __bot?: { stop(): void; pressed: number; wrong: number };
    };
    w.__bot?.stop();
    const done = new Set<number>();
    const held = new Map<number, number>();
    let alive = true;
    let rights = 0;
    const bot = {
      pressed: 0,
      wrong: 0,
      stop() {
        alive = false;
      },
    };
    w.__bot = bot;
    const press = (midi: number) => {
      const t = held.get(midi);
      if (t !== undefined) {
        clearTimeout(t);
        w.__midi.send([0x80, midi, 0]);
      }
      w.__midi.send([0x90, midi, 96]);
      held.set(
        midi,
        window.setTimeout(() => {
          held.delete(midi);
          w.__midi.send([0x80, midi, 0]);
        }, 70),
      );
      bot.pressed++;
    };
    let lastSession: SessionLike | null = null;
    const loop = () => {
      if (!alive) return;
      requestAnimationFrame(loop);
      const session = w.__piano?.[o.target]?.session;
      if (!session) return;
      if (session !== lastSession) {
        lastSession = session;
        done.clear();
      }
      const g = session.game;
      if (!session.running) return;
      if (g.opts.mode === 'wait') {
        const group = g.nextGroup();
        if (group.length === 0) return;
        if (g.notes[group[0]].start - g.time > 0.3) return;
        if (o.wrongAt && rights === o.wrongAt && bot.wrong === 0) {
          bot.wrong++;
          const wrong = g.notes[group[0]].midi + 1;
          press(group.some((i) => g.notes[i].midi === wrong) ? wrong + 1 : wrong);
          return;
        }
        for (const i of group) {
          if (done.has(i)) continue;
          done.add(i);
          rights++;
          press(g.notes[i].midi);
        }
        return;
      }
      if (g.opts.mode !== 'flow') return;
      for (let i = 0; i < g.notes.length; i++) {
        const n = g.notes[i];
        if (n.start - g.time > 0.012) break;
        if (g.state[i] !== 'pending' || done.has(i)) continue;
        if (g.time - n.start > 0.15) continue; // too late now, let it go
        done.add(i);
        rights++;
        if (o.skipEvery && rights % o.skipEvery === 0) continue;
        press(n.midi);
      }
    };
    requestAnimationFrame(loop);
  }, options);
}

export async function stopBot(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __bot?: { stop(): void } }).__bot?.stop());
}

/** Reads a few numbers from the player's session through the dev-only test handle. */
export async function sessionInfo(page: Page, target: 'player' | 'lesson' = 'player'): Promise<{ time: number; running: boolean; mode: string; length: number; hands: string; speed: number; loop: { start: number; end: number } | null; hits: number; wrong: number }> {
  return page.evaluate((t) => {
    interface S {
      game: { time: number; length: number; state: readonly string[]; wrong: number; opts: { mode: string; hands: string; speed: number } };
      running: boolean;
      loop: { start: number; end: number } | null;
    }
    const s = (window as unknown as { __piano?: Record<string, { session: S } | undefined> }).__piano?.[t]?.session;
    if (!s) throw new Error(`no ${t} session`);
    return {
      time: s.game.time,
      running: s.running,
      mode: s.game.opts.mode,
      length: s.game.length,
      hands: s.game.opts.hands,
      speed: s.game.opts.speed,
      loop: s.loop ? { start: s.loop.start, end: s.loop.end } : null,
      hits: s.game.state.filter((x) => x === 'hit').length,
      wrong: s.game.wrong,
    };
  }, target);
}
