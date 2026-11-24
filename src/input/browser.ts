import { APP_NAME } from '../app/brand';
import { inAppShell } from '../app/shell';

/**
 * Which browser family the player uses, only to give the right connection tips.
 * `app` is the iPad/iPhone app (ios/), which is not a browser at all.
 */
export type BrowserKind = 'app' | 'ios' | 'safari' | 'firefox' | 'chromium' | 'other';

export function browserKind(userAgent: string, maxTouchPoints = 0): BrowserKind {
  const ua = userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\/|OPR\/|Chrome\/|Chromium\//.test(ua)) return 'chromium';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function currentBrowser(): BrowserKind {
  if (inAppShell()) return 'app';
  if (typeof navigator === 'undefined') return 'other';
  return browserKind(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

/** Plain-words advice when the browser has no piano (MIDI) support. */
export function noMidiAdvice(kind: BrowserKind): string {
  switch (kind) {
    case 'app':
      return 'The connection to pianos did not start. Close the app and open it again.';
    case 'ios':
      return `iPhone and iPad browsers cannot connect to a piano yet. You can still tap the keys on screen, or turn on the microphone to listen to an acoustic piano. To use a cable, get the ${APP_NAME} app for iPad and iPhone, or open ${APP_NAME} on a computer in Chrome or Edge.`;
    case 'safari':
      return `Safari cannot connect to a piano yet. Open ${APP_NAME} in Chrome, Edge or Opera on this computer and your piano will work there.`;
    case 'firefox':
      return `Firefox needs your permission first: it asks you to add a small site permission. If no question appeared, or you said no, press Try again, or open ${APP_NAME} in Chrome or Edge.`;
    default:
      return 'This browser cannot connect to a piano. Chrome, Edge and Opera on a computer, and Chrome on Android, can.';
  }
}

/** The MIDI permission question is open (browsers only; the app never asks). */
export function midiAskingText(kind: BrowserKind): string {
  return kind === 'app' ? 'Connecting your piano...' : 'Your browser is asking to use your piano. Choose Allow.';
}

/** Before connecting. The app has no permission question, so it only needs the button. */
export function midiIdleText(kind: BrowserKind): string {
  return kind === 'app' ? 'Press the button to connect your piano.' : 'Press the button, then choose Allow. Nothing is installed.';
}

/** MIDI access was refused. */
export function midiDeniedText(kind: BrowserKind): string {
  if (kind === 'app') return 'The piano did not connect. Close the app, open it again, then press Try again.';
  if (kind === 'firefox') return noMidiAdvice('firefox');
  return 'Click the icon left of the web address, allow MIDI devices, then press Try again.';
}

/** The microphone question is open. */
export function micAskingText(kind: BrowserKind): string {
  return kind === 'app' ? `${APP_NAME} is asking to use the microphone. Choose Allow.` : 'Your browser is asking. Choose Allow.';
}

/**
 * The microphone was refused. The welcome has a Try again button; Settings
 * retries when the switch goes off and on.
 */
export function micDeniedText(kind: BrowserKind, place: 'welcome' | 'settings'): string {
  if (kind === 'app') {
    return place === 'welcome'
      ? `Turn on Microphone for ${APP_NAME} in the Settings app, then try again.`
      : `Turn on Microphone for ${APP_NAME} in the Settings app, then switch it off and on here.`;
  }
  return place === 'welcome'
    ? 'The microphone was not allowed. Allow it with the icon left of the web address, then try again.'
    : 'Not allowed yet. Click the icon left of the web address, allow the microphone, then switch it off and on.';
}

/** No microphone support at all. */
export function micUnsupportedText(kind: BrowserKind, place: 'welcome' | 'settings'): string {
  if (kind === 'app') return 'The microphone is not available. Close the app and open it again.';
  return place === 'welcome' ? 'This browser cannot use a microphone. Try Chrome, Edge, Firefox or Safari.' : 'This browser cannot use the microphone here (it needs an https page).';
}

/** When the app could not start or a part of it failed: what to do next. */
export function restartAdvice(kind: BrowserKind): string {
  return kind === 'app' ? 'Please close the app and open it again.' : 'Please reload. If it keeps happening, try another browser.';
}
