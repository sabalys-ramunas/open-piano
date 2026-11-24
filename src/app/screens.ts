import type { AppContext } from './context';
import type { Route, ScreenName } from './router';

/** Undoes everything a screen did: listeners, timers, animation frames, subscriptions. */
export type Cleanup = () => void;

/**
 * A screen draws itself into `container` (which is empty) and returns a
 * cleanup function. The shell empties the container after cleanup runs.
 * `route` carries the screen's parameters, e.g. the song id.
 */
export type MountScreen = (container: HTMLElement, ctx: AppContext, route: Route) => Cleanup;

export interface ScreenModule {
  mount: MountScreen;
}

/** Each screen is loaded on demand, so a big screen never slows down the others. */
export const SCREENS: Record<ScreenName, () => Promise<ScreenModule>> = {
  home: () => import('../screens/home'),
  play: () => import('../screens/player'),
  course: () => import('../screens/course'),
  editor: () => import('../screens/editor'),
  community: () => import('../screens/community'),
  settings: () => import('../screens/settings'),
  welcome: () => import('../screens/welcome'),
  notfound: () => import('../screens/notfound'),
  // Dev only: a production build replaces import.meta.env.DEV with false and drops the style guide.
  styleguide: import.meta.env.DEV ? () => import('../screens/styleguide') : () => import('../screens/notfound'),
};
