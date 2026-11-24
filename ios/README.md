# iPad and iPhone app

Safari on iPad and iPhone cannot talk to a MIDI keyboard, so the web app alone
cannot hear a piano plugged in with a USB cable there. This folder is a small
native shell that fixes that: it shows the same web app and passes the
keyboard's notes to it through CoreMIDI.

## Build it

You need a Mac with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

1. Create `ios/Local.xcconfig` with your Apple team and an app id of your own:

   ```
   DEVELOPMENT_TEAM = ABCDE12345
   PRODUCT_BUNDLE_IDENTIFIER = com.yourname.piano
   ```

2. From the project folder run `npm run ios`. It builds the web app, copies it
   into `ios/web` and writes `ios/Piano.xcodeproj`.
3. Open `ios/Piano.xcodeproj`, choose your iPad at the top and press Run.

Run `npm run ios` again after changing the web app.

## What the shell adds

- `App/MIDIBridge.swift`: listens to every MIDI device and sends notes out.
- `App/midi-polyfill.js`: gives the page `navigator.requestMIDIAccess`.
- `App/WebFiles.swift`: serves the built web app from inside the app, so it works offline.
- `App/App.swift`: the web view, microphone permission, saving lesson files with the share sheet, and keeping the screen awake.

Bluetooth MIDI keyboards: press **Pair a Bluetooth piano** in Settings (My piano) or on the welcome's
connect step. The page posts `{ type: 'bluetooth' }` to the `midi` message handler and the app opens
Apple's Bluetooth MIDI pairing screen. Keyboards paired in another app (for example GarageBand) work too.

## Song splitting in the shell

The song splitter's networks (about 80 MB, see `docs/architecture.md`) are not put in the app: `npm run ios`
leaves `models/` out even when `public/models/` holds a local copy. The first split downloads them from the
address in `src/split/model-files.ts` and keeps them in IndexedDB. The splitter needs no service worker, Cache
Storage, SharedArrayBuffer or cross-origin isolation, so it runs on one WebAssembly thread here, or on WebGPU
where the web view has it and its numbers agree with WebAssembly's. Without WebCodecs Opus (older iOS) the split
backing is stored as 22 kHz WAV instead. Not yet tried on a device: the download from piano://app/ (the request
is cross-origin), memory on a 4 GB iPad, and WebGPU inside the web view.
