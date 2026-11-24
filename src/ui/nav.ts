import { APP_NAME } from '../app/brand';
import { h, logo } from '../app/dom';
import { href, type Route, type ScreenName } from '../app/router';
import { icon, type IconName } from './icons';

/**
 * The app's main navigation: an icon rail with labels on the left on wide
 * screens, a tab bar at the bottom on phones and tablets held upright (the
 * switch is pure CSS, see .app-nav in style.css). It is drawn once by the
 * shell and stays put between screens; the current place has aria-current.
 *
 * Full-screen experiences hide it and show one clear way back instead.
 */

interface NavItem {
  route: Route;
  label: string;
  icon: IconName;
  /** Screens that count as being "in" this place. */
  screens: readonly ScreenName[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { route: { screen: 'course' }, label: 'Learn', icon: 'learn', screens: ['course'] },
  { route: { screen: 'home' }, label: 'Songs', icon: 'songs', screens: ['home', 'play', 'editor'] },
  { route: { screen: 'community' }, label: 'Shared', icon: 'shared', screens: ['community'] },
  { route: { screen: 'settings' }, label: 'Settings', icon: 'settings', screens: ['settings'] },
];

/** Screens shown full screen, without the navigation: they have their own single way back. */
export function isFullScreen(route: Route): boolean {
  switch (route.screen) {
    case 'play':
    case 'editor':
    case 'welcome':
      return true;
    case 'course':
      return Boolean(route.lessonId);
    default:
      return false;
  }
}

export interface AppNav {
  el: HTMLElement;
  /** Marks the current place. */
  update(route: Route): void;
}

export function createNav(): AppNav {
  const links = NAV_ITEMS.map((item) =>
    h(
      'a',
      { class: 'app-nav-link', href: href(item.route), 'data-nav': item.route.screen },
      h('span', { class: 'nav-pill' }, icon(item.icon)),
      h('span', { class: 'nav-label' }, item.label),
    ),
  );
  // The mark is decoration: the Songs tab already goes home, so it is not a second link.
  const brand = h('span', { class: 'app-nav-brand', title: APP_NAME }, logo(52));
  const el = h('nav', { class: 'app-nav', 'aria-label': 'Main' }, brand, h('ul', { class: 'app-nav-list' }, ...links.map((a) => h('li', {}, a))));
  return {
    el,
    update(route) {
      NAV_ITEMS.forEach((item, i) => {
        const a = links[i];
        if (item.screens.includes(route.screen)) a.setAttribute('aria-current', route.screen === item.route.screen ? 'page' : 'location');
        else a.removeAttribute('aria-current');
      });
    },
  };
}
