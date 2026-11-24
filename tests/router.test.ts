import { describe, expect, it } from 'vitest';
import { Router, href, parseRoute, type Route, type RouterWindow } from '../src/app/router';

describe('routes', () => {
  it('reads every screen', () => {
    expect(parseRoute('')).toEqual({ screen: 'home' });
    expect(parseRoute('#/')).toEqual({ screen: 'home' });
    expect(parseRoute('#/play/twinkle')).toEqual({ screen: 'play', songId: 'twinkle' });
    expect(parseRoute('#/course')).toEqual({ screen: 'course' });
    expect(parseRoute('#/course/find-c')).toEqual({ screen: 'course', lessonId: 'find-c' });
    expect(parseRoute('#/editor')).toEqual({ screen: 'editor' });
    expect(parseRoute('#/editor/ode')).toEqual({ screen: 'editor', songId: 'ode' });
    expect(parseRoute('#/community')).toEqual({ screen: 'community' });
    expect(parseRoute('#/settings/')).toEqual({ screen: 'settings' });
  });

  it('reads the welcome screen', () => {
    expect(parseRoute('#/welcome')).toEqual({ screen: 'welcome' });
    expect(href({ screen: 'welcome' })).toBe('#/welcome');
    expect(parseRoute('#/styleguide')).toEqual({ screen: 'styleguide' });
    expect(href({ screen: 'styleguide' })).toBe('#/styleguide');
  });

  it('gives unknown, incomplete or broken paths the not-found route', () => {
    expect(parseRoute('#/nowhere')).toEqual({ screen: 'notfound', path: 'nowhere' });
    expect(parseRoute('#/play')).toEqual({ screen: 'notfound', path: 'play' });
    expect(parseRoute('#/play/%E0%A4%A')).toEqual({ screen: 'notfound', path: 'play/%E0%A4%A' }); // broken escape
    expect(parseRoute('#/settings/extra')).toEqual({ screen: 'notfound', path: 'settings/extra' });
  });

  it('round-trips ids with spaces, colons and slashes', () => {
    const routes: Route[] = [
      { screen: 'home' },
      { screen: 'play', songId: 'mine:My song: live/take 2:12345' },
      { screen: 'course', lessonId: 'find-c' },
      { screen: 'editor', songId: 'lesson:Für Elise:40' },
      { screen: 'community' },
      { screen: 'settings' },
      { screen: 'course' },
      { screen: 'editor' },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });
});

describe('router', () => {
  function fakeWindow(hash = '') {
    const listeners = new Set<() => void>();
    const win: RouterWindow & { fire(): void; count(): number } = {
      location: { hash },
      addEventListener: (_type, l) => listeners.add(l),
      removeEventListener: (_type, l) => listeners.delete(l),
      fire: () => listeners.forEach((l) => l()),
      count: () => listeners.size,
    };
    return win;
  }

  it('reports the first route and every change', () => {
    const win = fakeWindow('#/settings');
    const router = new Router(win);
    const seen: Route[] = [];
    router.start((r) => seen.push(r));
    router.navigate({ screen: 'play', songId: 'ode' });
    expect(win.location.hash).toBe('#/play/ode');
    win.fire();
    expect(seen).toEqual([{ screen: 'settings' }, { screen: 'play', songId: 'ode' }]);
    router.stop();
    expect(win.count()).toBe(0);
  });
});
