import '../sw/update.css';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { h } from './dom';

/**
 * Says so, kindly, when the connection drops or comes back. Songs keep
 * working offline, so this is information, never a blocker.
 */
function watchConnection(): void {
  if (typeof window === 'undefined') return;
  let hideOffline: (() => void) | null = null;
  window.addEventListener('offline', () => {
    hideOffline?.();
    hideOffline = toast('You are offline. Your songs still work.', { kind: 'error', duration: 6000 });
  });
  window.addEventListener('online', () => {
    hideOffline?.();
    hideOffline = null;
    toast('Back online.', { duration: 2500 });
  });
}

const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Registers the offline worker (built to sw.js; production builds only, so it
 * never gets in the way of the dev server). When a new version has been
 * downloaded it waits, and a small prompt offers to reload: the new version
 * only takes over when the person says so, never in the middle of a song.
 */
export function registerServiceWorker(): void {
  watchConnection();
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  let reloading = false;
  let asked = false;

  container.addEventListener('controllerchange', () => {
    // Only reload when the person asked for the new version (the first install also changes controller).
    if (!asked || reloading) return;
    reloading = true;
    location.reload();
  });

  const offer = (worker: ServiceWorker): void => {
    if (document.querySelector('.update-toast')) return;
    const reload = h('button', { type: 'button', class: 'primary small' }, 'Update now');
    const later = h('button', { type: 'button', class: 'quiet small' }, 'Later');
    const prompt = h(
      'div',
      { class: 'update-toast', role: 'status' },
      h('span', { class: 'update-toast-icon', 'aria-hidden': 'true' }, icon('sun')),
      h('p', {}, h('strong', {}, 'A new version is ready.'), ' It takes a second.'),
      h('div', { class: 'update-toast-actions' }, later, reload),
    );
    reload.addEventListener('click', () => {
      asked = true;
      reload.disabled = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
    later.addEventListener('click', () => prompt.remove());
    document.body.append(prompt);
  };

  const watch = (registration: ServiceWorkerRegistration): void => {
    if (registration.waiting && container.controller) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // "installed" with a controller means an update is waiting; without one it is the first install.
        if (installing.state === 'installed' && container.controller) offer(installing);
      });
    });
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_EVERY_MS) return;
      lastCheck = Date.now();
      void registration.update().catch(() => {});
    });
  };

  const register = (): void => {
    container
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then(watch)
      .catch((error: unknown) => console.info('Offline support is not available here.', error));
  };
  // Wait for the page to finish loading so the worker's downloads never compete with the first visit.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
