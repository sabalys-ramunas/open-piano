// Imported first by the import worker, before TensorFlow.js.
//
// TensorFlow.js 3 checks `!window` when the WebGL backend waits for the
// graphics card (platform_browser.ts, setTimeoutCustom). A worker has no
// `window`, so that check throws a ReferenceError and the import hangs. With
// a `window` that is undefined the check is false and it uses setTimeout.
// `typeof window` stays 'undefined', so nothing mistakes the worker for a page.
const scope = globalThis as { window?: unknown };
if (!('window' in scope)) scope.window = undefined;

export {};
