/** Every place in the app, as data. URLs are hashes so the app works from any static host. */
export type Route =
  | { screen: 'home' }
  | { screen: 'play'; songId: string }
  | { screen: 'course'; lessonId?: string }
  | { screen: 'editor'; songId?: string }
  | { screen: 'community' }
  | { screen: 'settings' }
  | { screen: 'welcome' }
  /** The living style guide. Only the dev server draws it; a production build shows "not found". */
  | { screen: 'styleguide' }
  /** Any address the app does not know. `path` is what was asked for, for the message. */
  | { screen: 'notfound'; path: string };

export type ScreenName = Route['screen'];

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** Reads a location hash such as "#/play/twinkle". Unknown or broken paths give the "not found" route. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const [head = '', ...rest] = path.split('/');
  const param = rest.length > 0 ? decode(rest.join('/')) : null;
  const notFound: Route = { screen: 'notfound', path: path.slice(0, 200) };
  if (rest.length > 0 && param === null) return notFound;
  switch (head) {
    case '':
      return { screen: 'home' };
    case 'play':
      return param ? { screen: 'play', songId: param } : notFound;
    case 'course':
      return param ? { screen: 'course', lessonId: param } : { screen: 'course' };
    case 'editor':
      return param ? { screen: 'editor', songId: param } : { screen: 'editor' };
    case 'community':
      return rest.length === 0 ? { screen: 'community' } : notFound;
    case 'settings':
      return rest.length === 0 ? { screen: 'settings' } : notFound;
    case 'welcome':
      return { screen: 'welcome' };
    case 'styleguide':
      return { screen: 'styleguide' };
    default:
      return notFound;
  }
}

/** The hash for a route, for links: `<a href="${href(route)}">`. */
export function href(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.screen) {
    case 'home':
      return '#/';
    case 'play':
      return `#/play/${enc(route.songId)}`;
    case 'course':
      return route.lessonId ? `#/course/${enc(route.lessonId)}` : '#/course';
    case 'editor':
      return route.songId ? `#/editor/${enc(route.songId)}` : '#/editor';
    case 'community':
      return '#/community';
    case 'settings':
      return '#/settings';
    case 'welcome':
      return '#/welcome';
    case 'styleguide':
      return '#/styleguide';
    case 'notfound':
      return `#/${route.path}`;
  }
}

/** The parts of `window` the router uses, so tests can pass a fake. */
export interface RouterWindow {
  location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

/** Calls `onRoute` now and whenever the hash changes. */
export class Router {
  private listener: (() => void) | null = null;

  constructor(private win: RouterWindow) {}

  get current(): Route {
    return parseRoute(this.win.location.hash);
  }

  start(onRoute: (route: Route) => void): void {
    this.stop();
    this.listener = () => onRoute(this.current);
    this.win.addEventListener('hashchange', this.listener);
    onRoute(this.current);
  }

  stop(): void {
    if (this.listener) this.win.removeEventListener('hashchange', this.listener);
    this.listener = null;
  }

  navigate(route: Route): void {
    this.win.location.hash = href(route);
  }
}
