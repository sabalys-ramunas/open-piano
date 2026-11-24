import { h } from '../app/dom';
import { icon } from './icons';

/**
 * A modal sheet built on <dialog>: a centred card on wide screens, sliding up
 * from the bottom on phones. The browser keeps focus inside and closes it on
 * Escape; clicking the dimmed backdrop closes it too. Focus returns to the
 * control that opened it. Content is light (paper) by default.
 */

export interface SheetOptions {
  /** The sheet's accessible name; usually also its visible heading text. */
  label?: string;
  /** Id of the visible heading inside `content` that names the sheet (preferred over `label`). */
  labelledBy?: string;
  /** What the sheet shows; null entries are skipped. */
  content: (Node | null)[];
  /** Extra classes on the <dialog>. */
  className?: string;
  /** Called once after the sheet closed (by any means). */
  onClose?: () => void;
  /** Text for the round close button. Default "Close". */
  closeLabel?: string;
}

export interface Sheet {
  dialog: HTMLDialogElement;
  close(): void;
}

/**
 * The control the pointer last pressed. Safari does not focus a button or link
 * when it is clicked, so `document.activeElement` is still <body> when a sheet
 * opens from a click there; this is where focus should go back to instead.
 */
let lastPressed: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      lastPressed = target?.closest<HTMLElement>('button, a[href], summary, [tabindex]:not([tabindex="-1"])') ?? null;
    },
    true,
  );
}

function opener(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return lastPressed?.isConnected ? lastPressed : null;
}

export function openSheet(options: SheetOptions): Sheet {
  const returnTo = opener();
  const closeButton = h('button', { type: 'button', class: 'icon-button sheet-close', 'aria-label': options.closeLabel ?? 'Close' });
  closeButton.append(icon('close'));
  const body = h('div', { class: 'sheet-body' }, closeButton, ...options.content.filter((n): n is Node => n !== null));
  const dialog = h(
    'dialog',
    {
      class: `sheet paper${options.className ? ` ${options.className}` : ''}`,
      'aria-labelledby': options.labelledBy ?? null,
      'aria-label': options.labelledBy ? null : (options.label ?? null),
    },
    body,
  );
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    dialog.remove();
    options.onClose?.();
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  };
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', finish);
  // A click on the backdrop lands on the dialog element itself, outside the body.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  // Open at the top with the title in view, even when the caller focuses a button further down
  // (on a short screen that scrolled the sheet to its end).
  requestAnimationFrame(() => {
    if (dialog.open) dialog.scrollTop = 0;
  });
  return {
    dialog,
    close() {
      if (dialog.open) dialog.close();
      else finish();
    },
  };
}
