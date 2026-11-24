import { describe, expect, it } from 'vitest';
import { backendCandidates, isWebKitEngine } from '../src/import/backend';

const UA = {
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  // An iPad asking for the desktop site looks exactly like a Mac.
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  // The app's own iPad shell: a WKWebView, no "Safari" or "Version".
  wkWebView: 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
};

describe('import backend choice', () => {
  it('recognises Safari\'s engine, including every iOS browser and the app shell', () => {
    for (const ua of [UA.safariMac, UA.ipadDesktop, UA.iphone, UA.wkWebView, UA.chromeIos]) expect(isWebKitEngine(ua), ua).toBe(true);
    for (const ua of [UA.chromeMac, UA.edge, UA.android, UA.firefox, '']) expect(isWebKitEngine(ua), ua).toBe(false);
  });

  it('never races the graphics card in WebKit or on a software driver', () => {
    expect(backendCandidates({ softwareGraphics: false, webkit: true })).toEqual(['wasm', 'cpu']);
    expect(backendCandidates({ softwareGraphics: true, webkit: false })).toEqual(['wasm', 'cpu']);
    expect(backendCandidates({ softwareGraphics: false, webkit: false })).toEqual(['webgl', 'wasm', 'cpu']);
  });

  it('uses only the preferred backend when one is given', () => {
    expect(backendCandidates({ prefer: 'webgl', softwareGraphics: false, webkit: true })).toEqual(['webgl']);
  });
});
