import './style.css';
import './styles/problem.css';
import { APP_NAME } from './app/brand';
import { createContext, type AppContext } from './app/context';
import { h, installCardClicks } from './app/dom';
import { shouldWelcome } from './app/first-run';
import { Router, type Route } from './app/router';
import { SCREENS, type Cleanup } from './app/screens';
import { inAppShell, watchKeyboard } from './app/shell';
import { registerServiceWorker } from './app/sw-register';
import { exposeForTests } from './app/test-hook';
import { pageTitle } from './app/title';
import { restartAdvice, currentBrowser } from './input/browser';
import { createNav, isFullScreen } from './ui/nav';
import { mascot } from './ui/mascot';
import { toast } from './ui/toast';

const root = document.getElementById('app')!;
const router = new Router(window);
let cleanup: Cleanup | null = null;
let token = 0;
let first = true;
let current: HTMLElement | null = null;
/** The icon rail (wide screens) or tab bar (narrow), drawn once and kept between screens. */
const nav = createNav();
root.dataset.chrome = 'nav';

installCardClicks();
// Inside the iPad/iPhone app (ios/): no browser chrome, no full-screen button, other words.
if (inAppShell()) document.documentElement.dataset.shell = 'app';
// A physical key press brings computer-key letters back on touch screens.
watchKeyboard();

/**
 * A file dropped where no screen takes it would make the browser open the file and leave the
 * app. Screens that accept files (Songs) handle the drop on `document` first and mark it
 * handled; anything left over is stopped here, on `window`, with a pointer to where it works.
 */
const carriesFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragover', (e) => {
  if (e.defaultPrevented || !carriesFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (e) => {
  if (e.defaultPrevented || !carriesFiles(e)) return;
  e.preventDefault();
  toast('To add a song, drop the file on the Songs page.');
});

function reloadButton(big = false): HTMLButtonElement {
  const b = h('button', { type: 'button', class: big ? 'primary big' : 'primary' }, 'Reload');
  b.addEventListener('click', () => location.reload());
  return b;
}

/** A friendly full-page message with a way out, used whenever a screen cannot be shown. */
function problemPage(title: string, text: string, showHome = true): HTMLElement {
  return h(
    'main',
    { class: 'screen screen-problem', id: 'screen' },
    h(
      'div',
      { class: 'lost' },
      mascot('curious', 'lost-mascot'),
      h('h1', { class: 'lost-title' }, title),
      h('p', { class: 'lost-text' }, text),
      h('div', { class: 'lost-actions' }, reloadButton(true), showHome ? h('a', { href: '#/', class: 'button quiet' }, 'Go to my songs') : null),
    ),
  );
}

async function show(ctx: AppContext, route: Route): Promise<void> {
  const mine = ++token;
  let mount;
  try {
    mount = (await SCREENS[route.screen]()).mount;
  } catch (error) {
    console.error(error);
    if (mine !== token) return;
    swap(
      problemPage(
        'This page did not load',
        navigator.onLine === false
          ? 'You are offline, and this part is not saved yet. Connect and reload.'
          : 'Part of the app did not download. Reload to try again.',
      ),
    );
    pageTitle('Page did not load');
    return;
  }
  if (mine !== token) return; // another navigation won

  nav.update(route);
  root.dataset.chrome = isFullScreen(route) ? 'full' : 'nav';
  const container = h('main', { class: `screen screen-${route.screen}`, id: 'screen' });
  swap(container);
  try {
    cleanup = mount(container, ctx, route);
  } catch (error) {
    console.error(error);
    swap(problemPage('Something went wrong', 'Reloading usually fixes it. Your songs are safe.'));
  }

  const shown = current ?? container;
  const heading = shown.querySelector('h1');
  pageTitle(route.screen === 'home' ? null : (heading?.dataset.title ?? heading?.textContent));
  if (!first && heading) {
    // Tell screen reader users the page changed, and start keyboard focus at the top.
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  first = false;
  window.scrollTo(0, 0);
}

function swap(next: HTMLElement): void {
  try {
    cleanup?.();
  } catch (error) {
    console.error(error);
  }
  cleanup = null;
  current = next;
  root.replaceChildren(nav.el, next);
}

/**
 * Last line of defence: an error nobody caught. If it left the page empty,
 * show a friendly page with a reload button; otherwise offer a quiet reload
 * hint once, without throwing away what the person is doing.
 */
let hinted = false;
function onUncaught(error: unknown): void {
  console.error(error);
  const blank = !current || !current.isConnected || current.childElementCount === 0;
  if (blank) {
    swap(problemPage('Something went wrong', 'Reloading usually fixes it. Your songs are safe.'));
    return;
  }
  if (hinted) return;
  hinted = true;
  const close = h('button', { type: 'button', class: 'ghost' }, 'Dismiss');
  const bar = h(
    'div',
    { class: 'error-toast', role: 'alert' },
    h('p', {}, 'Something went wrong. Stuck? Reload.'),
    reloadButton(),
    close,
  );
  close.addEventListener('click', () => bar.remove());
  document.body.append(bar);
}
window.addEventListener('error', (e) => {
  // Failed images or scripts fire `error` without an Error; those are handled where they load.
  if (e.error) onUncaught(e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason: unknown = e.reason;
  // A cancelled import or an aborted fetch is not a problem.
  if (reason instanceof Error && (reason.name === 'Cancelled' || reason.name === 'AbortError')) return;
  onUncaught(reason);
});

createContext((route) => router.navigate(route)).then(
  async (ctx) => {
    exposeForTests('app', ctx);
    // First visit: start with the short welcome instead of the song list.
    const atHome = router.current.screen === 'home';
    if (atHome && (await shouldWelcome(ctx.store))) history.replaceState(null, '', '#/welcome');
    router.start((route) => void show(ctx, route));
    registerServiceWorker();
  },
  (error) => {
    console.error(error);
    swap(problemPage(`${APP_NAME} could not start`, restartAdvice(currentBrowser()), false));
    pageTitle();
  },
);
