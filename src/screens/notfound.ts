import '../styles/problem.css';
import type { AppContext } from '../app/context';
import { h, link } from '../app/dom';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import { icon } from '../ui/icons';
import { mascot } from '../ui/mascot';

/** Any address the app does not know: the mascot, a few words and one big way home. */
export function mount(container: HTMLElement, _ctx: AppContext, route: Route): Cleanup {
  void _ctx;
  void route;
  const home = link({ screen: 'home' }, 'Go to my songs', { class: 'button primary big' });
  home.prepend(icon('songs'));
  container.append(
    h(
      'div',
      { class: 'lost' },
      mascot('curious', 'lost-mascot is-bobbing'),
      h('h1', { class: 'lost-title', 'data-title': 'Page not found' }, 'Oops! Page not found'),
      h('p', { class: 'lost-text' }, 'Let\'s get back to the music.'),
      home,
    ),
  );
  return () => {};
}
