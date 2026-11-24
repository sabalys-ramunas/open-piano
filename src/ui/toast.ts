import { h } from '../app/dom';
import { icon } from './icons';

/**
 * Short friendly messages at the bottom of the screen ("Song added!"). One
 * shared live region announces them to screen readers. They go away by
 * themselves; never put the only way to do something in a toast.
 */

let host: HTMLElement | null = null;

function region(): HTMLElement {
  if (host?.isConnected) return host;
  host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
  document.body.append(host);
  return host;
}

export interface ToastOptions {
  kind?: 'ok' | 'error';
  /** Milliseconds before it goes. Default 4500. */
  duration?: number;
}

/** Shows a toast and returns a function that removes it early. */
export function toast(text: string, options: ToastOptions = {}): () => void {
  const kind = options.kind ?? 'ok';
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'error' ? 'info' : 'check'), h('span', {}, text));
  const r = region();
  // Keep at most two on screen.
  while (r.childElementCount >= 2) r.firstElementChild?.remove();
  r.append(el);
  const timer = window.setTimeout(() => el.remove(), options.duration ?? 4500);
  return () => {
    window.clearTimeout(timer);
    el.remove();
  };
}
