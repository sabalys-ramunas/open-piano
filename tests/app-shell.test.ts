import { afterEach, describe, expect, it } from 'vitest';
import { acceptList, oggSupport, soundFormatWords, type AudioProbe } from '../src/app/formats';
import { coarsePointer, computerKeys, inAppShell, noteKeyPress, onKeyboardSeen, pairBluetooth, resetKeyboardSeen, type ShellWindow } from '../src/app/shell';
import { micDeniedText, micUnsupportedText, midiDeniedText, midiIdleText, noMidiAdvice, restartAdvice } from '../src/input/browser';

function fakeShell(): ShellWindow & { sent: unknown[] } {
  const sent: unknown[] = [];
  return { sent, webkit: { messageHandlers: { midi: { postMessage: (m: unknown) => sent.push(m) } } } };
}
const touch: ShellWindow = { matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }) };
const mouse: ShellWindow = { matchMedia: () => ({ matches: false }) };

afterEach(() => resetKeyboardSeen());

describe('app shell detection', () => {
  it('knows the iPad/iPhone app by its midi message handler', () => {
    expect(inAppShell(fakeShell())).toBe(true);
    expect(inAppShell({})).toBe(false);
    expect(inAppShell({ webkit: { messageHandlers: {} } })).toBe(false);
    expect(inAppShell(undefined)).toBe(false);
  });

  it('asks the app for Bluetooth pairing, and does nothing in a browser', () => {
    const win = fakeShell();
    expect(pairBluetooth(win)).toBe(true);
    expect(win.sent).toEqual([{ type: 'bluetooth' }]);
    expect(pairBluetooth({})).toBe(false);
  });

  it('reads a coarse pointer from matchMedia', () => {
    expect(coarsePointer(touch)).toBe(true);
    expect(coarsePointer(mouse)).toBe(false);
    expect(coarsePointer({})).toBe(false);
  });

  it('offers computer keys with a mouse, and on touch only after a real key press', () => {
    expect(computerKeys(mouse)).toBe(true);
    expect(computerKeys(touch)).toBe(false);
    let told = 0;
    const off = onKeyboardSeen(() => told++);
    // Typing into a field (an on-screen keyboard does that) does not count.
    expect(noteKeyPress({ target: { tagName: 'INPUT' } as unknown as EventTarget, key: 'a' })).toBe(false);
    expect(computerKeys(touch)).toBe(false);
    expect(noteKeyPress({ target: null, key: 'z' })).toBe(true);
    expect(computerKeys(touch)).toBe(true);
    expect(noteKeyPress({ target: null, key: 'x' })).toBe(false);
    expect(told).toBe(1);
    off();
  });
});

describe('words inside the app', () => {
  it('never talks about browsers, web addresses or reloading in the app', () => {
    const texts = [
      noMidiAdvice('app'),
      midiIdleText('app'),
      midiDeniedText('app'),
      micDeniedText('app', 'welcome'),
      micDeniedText('app', 'settings'),
      micUnsupportedText('app', 'welcome'),
      micUnsupportedText('app', 'settings'),
      restartAdvice('app'),
    ];
    for (const t of texts) expect(t).not.toMatch(/browser|web address|reload|Chrome|Edge|Allow/i);
    expect(midiIdleText('app')).toBe('Press the button to connect your piano.');
    expect(micDeniedText('app', 'welcome')).toBe('Turn on Microphone for Piano in the Settings app, then try again.');
  });

  it('keeps the browser advice in browsers, and points iPhone and iPad browsers at the app', () => {
    expect(noMidiAdvice('ios')).toMatch(/cannot connect/);
    expect(noMidiAdvice('ios')).toMatch(/app for iPad/);
    expect(micUnsupportedText('chromium', 'welcome')).toMatch(/Chrome/);
    expect(restartAdvice('safari')).toMatch(/reload/);
  });
});

describe('sound formats', () => {
  const probe = (ogg: boolean, opus: boolean): AudioProbe => ({
    canPlayType: (t) => ((t.includes('vorbis') && ogg) || (t.includes('opus') && opus) ? 'maybe' : ''),
  });

  it('offers Ogg and Opus only where they decode', () => {
    expect(acceptList(probe(false, false))).not.toMatch(/ogg|oga|opus/);
    expect(acceptList(probe(true, false))).toMatch(/\.ogg,\.oga/);
    expect(acceptList(probe(true, false))).not.toMatch(/opus/);
    expect(acceptList(probe(true, true))).toMatch(/\.opus/);
    expect(acceptList(probe(false, false))).toMatch(/\.mp3.*\.mid/);
    expect(soundFormatWords(probe(false, false))).toBe('MP3, M4A, WAV or FLAC');
    expect(soundFormatWords(probe(true, true))).toBe('MP3, M4A, WAV, OGG or FLAC');
    expect(oggSupport(probe(true, false))).toEqual({ ogg: true, opus: false });
  });
});
