/**
 * Where the app is running: inside the iPad/iPhone app (ios/, a native web
 * view with a MIDI bridge) or in a normal browser, and whether the person
 * plays by touch or has a real keyboard. Screens use this to say the right
 * thing ("Settings app" instead of "the icon left of the web address", "tap
 * the keys" instead of "your computer keys").
 *
 * Every check reads the window it is given, so unit tests pass a plain object.
 */

/** The parts of `window` these checks read. */
export interface ShellWindow {
  webkit?: { messageHandlers?: { midi?: { postMessage(message: unknown): void } } };
  matchMedia?: (query: string) => { matches: boolean };
}

function currentWindow(): ShellWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as ShellWindow);
}

/** True inside the native iPad/iPhone app: only its web view has the `midi` message handler. */
export function inAppShell(win: ShellWindow | undefined = currentWindow()): boolean {
  return typeof win?.webkit?.messageHandlers?.midi?.postMessage === 'function';
}

/** True when the main pointer is a finger (phones, tablets), not a mouse or trackpad. */
export function coarsePointer(win: ShellWindow | undefined = currentWindow()): boolean {
  return typeof win?.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
}

/**
 * Opens Apple's Bluetooth MIDI pairing screen (native app only). Returns false
 * outside the app, where there is nothing to open.
 */
export function pairBluetooth(win: ShellWindow | undefined = currentWindow()): boolean {
  const handler = win?.webkit?.messageHandlers?.midi;
  if (!handler || typeof handler.postMessage !== 'function') return false;
  handler.postMessage({ type: 'bluetooth' });
  return true;
}

// ---------- A real keyboard? ----------

let keyboardSeen = false;
const keyboardListeners = new Set<() => void>();

/** The target of a key press that came from typing into a field (an on-screen keyboard does that too). */
function typing(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/**
 * Remembers the first key press from a physical keyboard. On-screen keyboards
 * only type into fields, so presses inside a field do not count.
 * Returns true when this press was the first one.
 */
export function noteKeyPress(event: { target: EventTarget | null; key?: string; isComposing?: boolean }): boolean {
  if (keyboardSeen || event.isComposing || typing(event.target)) return false;
  if (!event.key || event.key === 'Unidentified' || event.key === 'Process') return false;
  keyboardSeen = true;
  for (const listener of [...keyboardListeners]) listener();
  return true;
}

/** Watches for a physical keyboard. Call once at start-up. Returns a cleanup. */
export function watchKeyboard(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onKey = (e: Event): void => {
    noteKeyPress(e as KeyboardEvent);
  };
  target.addEventListener('keydown', onKey, true);
  return () => target.removeEventListener('keydown', onKey, true);
}

/** Called once, when a physical keyboard is first used. Returns an unsubscribe function. */
export function onKeyboardSeen(listener: () => void): () => void {
  keyboardListeners.add(listener);
  return () => keyboardListeners.delete(listener);
}

/**
 * Can this person play with computer keys? Yes with a mouse or trackpad, and
 * on a touch screen once a real keyboard was used. A touch screen without one
 * plays by tapping the keys on screen, so no computer-key letters there.
 */
export function computerKeys(win: ShellWindow | undefined = currentWindow()): boolean {
  return keyboardSeen || !coarsePointer(win);
}

/** For tests: forget the keyboard that was seen. */
export function resetKeyboardSeen(): void {
  keyboardSeen = false;
}
