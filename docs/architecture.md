# Piano: architecture and contributor guide

Vite + strict TypeScript, no UI framework, no runtime dependencies beyond the note-detection model
(`@spotify/basic-pitch` on TensorFlow.js), the MIDI file reader (`@tonejs/midi`) and, for song splitting
only, `onnxruntime-web` (loaded inside the split worker, never by the page).

```
npm install
npm run dev            # Vite dev server (no service worker in dev)
npm test               # vitest; tests/transcription.test.ts is slow (about a minute)
npm run build          # tsc --noEmit, then vite build into dist/ (adds sw.js and manifest.webmanifest)
npm run build-songs    # rebuilds public/songs/ and the community seed from scripts/songs-sources.json (downloads MIDI files)
npm run check-catalog  # validates community/ and checks public/community/ is an exact copy
npm run e2e            # Playwright end-to-end tests in headless Chrome (see "End-to-end tests" below)
```

The app's name lives in one constant, `APP_NAME` in `src/app/brand.ts`. Page titles, the top bar, the
welcome screen, `index.html` (`%APP_NAME%`, `%APP_TAGLINE%`) and the install manifest all read it.

## Rules for every change

- No em dash (U+2014) in anything a user reads: copy, labels, `aria-label`, `title`, `placeholder`, errors,
  console output, README and docs. Code comments are fine. Check with
  `grep -rn "$(printf '\u2014')" src index.html docs README.md | grep -vE ':[0-9]+: *(\*|//|/\*)'`.
- Plain, friendly words for beginners and children. Never say "transcription", "MIDI CC", "velocity" and so on in the UI.
  Use the shared wording in `src/app/words.ts` for the main ideas (levels, notes to play, modes, hands, song sources).
- Strict TypeScript, no `any`, no new runtime dependencies without agreement.
- Real buttons and labels, visible focus, `aria-live` for status text, keyboard reachable, `prefers-reduced-motion`
  respected. Build DOM with `h()` from `src/app/dom.ts` (text is never parsed as HTML).
- A screen's cleanup must undo everything: listeners, `requestAnimationFrame`, timers, subscriptions (every
  `subscribe`/`on` returns an unsubscribe function).
- Treat lesson files, catalog data, the song index and stored values as untrusted.
- Store progress against stable ids: built-in song ids (`twinkle`, `ode`, `elise`, `pack:<file>`) and lesson ids never change.
- Style with the tokens and base components in `src/style.css` and the pieces in `src/ui/` (see
  [docs/design.md](design.md) and `#/styleguide` in the dev server). Area stylesheets add layout, not new colours or sizes.

## How the app fits together

```
index.html -> src/main.ts -> createContext() (src/app/context.ts)
                           -> first visit? replace #/ with #/welcome (src/app/first-run.ts)
                           -> Router (src/app/router.ts) -> SCREENS[name]() (src/app/screens.ts, lazy import)
                                                         -> screen.mount(container, ctx, route) -> cleanup
                           -> registerServiceWorker() (src/app/sw-register.ts, production only)
```

Each screen is loaded on demand and imports its own stylesheet, so a big screen never slows the others.
`main.ts` is also the error boundary: a screen that fails to load or throws while mounting is replaced by a
friendly page with a Reload button, and an uncaught error that leaves the page empty does the same. Other
uncaught errors show a small "reload if stuck" notice once.

Routes: `#/`, `#/play/<songId>`, `#/course`, `#/course/<lessonId>`, `#/editor`, `#/editor/<songId>`,
`#/community`, `#/settings`, `#/welcome`, and `#/styleguide` (dev server only; a production build shows not found). Anything else (including broken escapes and missing ids) is the
not-found route. Ids are URI-encoded; build links with `href(route)` or `link(route, text)`.

## File map

| Area | Files |
|---|---|
| Shell | `index.html`, `vite.config.ts`, `src/main.ts`, `src/style.css`, `src/app/*`, `src/ui/*`, `public/fonts/*`, `docs/design.md`, `src/screens/styleguide.ts`, `src/song.ts`, `src/lesson.ts`, `src/screens/home.ts`, `src/screens/welcome.ts`, `src/screens/notfound.ts`, `src/home/*`, `src/styles/home.css`, `src/styles/welcome.css` |
| Offline and install | `vite.config.ts` (manifest, `sw.js` build), `src/sw/*`, `src/app/sw-register.ts`, `public/favicon.svg`, `public/icons/*` |
| Player | `src/screens/player.ts`, `src/player/*`, `src/styles/player.css` |
| Course | `src/course/*`, `src/screens/course.ts`, `src/styles/course.css` |
| Editor | `src/editor/*`, `src/screens/editor.ts`, `src/styles/editor.css` |
| Songs and shared songs | `src/songs/*`, `public/songs/*`, `scripts/build-songs.mjs`, `scripts/songs-sources.json`, `src/community/*`, `src/screens/community.ts`, `src/styles/community.css`, `community/*`, `public/community/*` |
| Sheet music | `src/sheet/*`, `src/styles/sheet.css` |
| Sound and input | `src/audio/*`, `src/input/*`, `src/screens/settings.ts`, `src/styles/settings.css` |
| Song import and analysis | `src/import/*`, `src/analysis/*`, `public/model/*` |
| Song splitting | `src/split/*`, `public/models/` (not in git), `tests/split*.test.ts`, `scripts/stems-bench.test.ts`, `e2e/split.e2e.ts`, `experiments/separation/` (the prototype) |

Unit tests live in `tests/`, named after their area (`tests/course-*.test.ts`, `tests/sheet-*.test.ts`, `tests/home-*.test.ts`, `tests/sw-*.test.ts`, ...).

## Shared interfaces

### Screens and routing (`src/app/screens.ts`, `src/app/router.ts`)

```ts
type Route =
  | { screen: 'home' } | { screen: 'play'; songId: string }
  | { screen: 'course'; lessonId?: string } | { screen: 'editor'; songId?: string }
  | { screen: 'community' } | { screen: 'settings' } | { screen: 'welcome' }
  | { screen: 'notfound'; path: string };
type Cleanup = () => void;
type MountScreen = (container: HTMLElement, ctx: AppContext, route: Route) => Cleanup;
function parseRoute(hash: string): Route;   // unknown or broken paths -> { screen: 'notfound', path }
function href(route: Route): string;
```

Every screen renders exactly one `<h1>` synchronously in `mount`. The shell sets the tab title from it
("Heading · Piano"; `data-title` on the h1 overrides the text) and focuses it after navigation. A screen whose
title is only known later (the player, the editor) calls `pageTitle(text)` from `src/app/title.ts`.

### Shared UI (`src/app/dom.ts`, `src/app/words.ts`)

```ts
function h(tag, attrs?, ...children): HTMLElement;          // text children are always text
function link(route: Route, text: string, attrs?): HTMLAnchorElement;
function appBar(title: string, options?: { home?: boolean; back?: { route: Route; label: string }; actions?: Node[] }): HTMLElement;
function notice(kind: 'empty' | 'loading' | 'error' | 'info', title: string, text?: string, ...actions: Node[]): HTMLElement;
function levelBadge(d: Difficulty): HTMLElement;            // "Level 2 · Easy" with five bars
function starsBadge(count: number): HTMLElement;            // stars out of three, with an aria-label
function logo(size?: number): SVGSVGElement;
function pickFile(accept: string): Promise<File | null>;
function download(name: string, text: string, type?: string): void;
```

The shell (`src/main.ts`) draws the main navigation once (`src/ui/nav.ts`): an icon rail on wide screens, a tab
bar on narrow ones (Learn, Songs, Shared, Settings; the current place has `aria-current`). Full-screen places (the
player, a lesson, the editor, the welcome) hide it. `appBar` is the top of every other screen: an optional back
button, then the page heading. The player has its own "All songs" back link on its get-ready page.
UI pieces in `src/ui/`: `icon`, `songCover`/`unitArt` (generated cover art), `mascot`, `illustration`, `shelf`
(sideways rows), `openSheet` (dialogs), `toast`, `celebrate`. `dom.ts` also has `levelDots(d)` and `starRating(n)`.

`words.ts` holds the shared wording: `DIFFICULTY_WORD` / `difficultyLabel(d)` ("Level 2 · Easy"), `LEVELS` and
`NOTES_TO_PLAY_LABEL` (Melody only, Melody and bass, Melody and chords, Everything), `MODES` (Listen, Learn,
Play along), `HANDS` (Right hand, Left hand, Both hands), `SOURCE_LABEL`, `minutesSeconds`.

### App context (`src/app/context.ts`)

```ts
interface AppContext {
  library: Library;
  store: Store;
  settings: SettingsService;
  input: InputHub;
  sources: { keyboard: KeyboardSource; pointer: PointerSource; midi: MidiSource; mic: MicSource };
  audio: { instrument: Instrument; metronome: Metronome }; // read ctx.audio.instrument at call time: it is replaced when settings.instrument changes
  navigate(route: Route): void;
  songPack: Promise<void>;   // settles once public/songs/index.json was read (or failed)
}
```

The context wires `input` to `audio.instrument`: every key down/up on any source except the microphone makes a
sound on every screen, and the sustain pedal calls `instrument.sustain?.(on)` (half-pedal: `pedalDepth`).
`connectSoundSettings` (`src/audio/bridge.ts`) applies reverb, metronome loudness, touch, switched-off
devices, MIDI output and microphone settings, and loads the piano samples after the first click or key press.

MIDI access: browsers show a permission question for Web MIDI. The context sets `sources.midi.deferAccess`
unless access was already granted (Permissions API, or the remembered `input:midi-allowed` flag), so the
question only ever appears after the person presses "Connect my piano" in the connection helper. Later
visits reconnect silently.

### Song (`src/song.ts`)

```ts
type Hand = 'right' | 'left';
interface Note { midi: number; start: number; dur: number; hand: Hand; finger?: 1 | 2 | 3 | 4 | 5 } // seconds
interface RawNote { midi: number; start: number; dur: number; amp: number; part?: 'melody' }
type SongSource = 'built-in' | 'mine' | 'community';
type Difficulty = 1 | 2 | 3 | 4 | 5;
type Level = 'melody' | 'melody-bass' | 'melody-chords' | 'full';
interface Song {
  id: string; title: string; by: string; notes: Note[];       // notes sorted by start, then midi
  audioUrl?: string;   // blob: URL of the original recording; never persisted, recreated on load
  backingUrl?: string; // blob: URL of the recording without guitars and keys (a split song); never persisted, never in a lesson file
  raw?: RawNote[];     // notes heard in the recording, kept to re-arrange
  level?: Level;       // arrangement `notes` was made with, when raw is set
  recording?: { name: string; bytes: number };
  source?: SongSource; difficulty?: Difficulty; bpm?: number; beats?: number[];
  timeSignature?: TimeSignature; chords?: TimedChord[]; tags?: string[];
  licence?: string; credit?: string;
  edited?: boolean;    // notes changed by hand in the editor: the player keeps them instead of re-arranging from raw
  addedAt?: number;    // set by Library.add
}
```

Helpers: `noteName`, `isBlack`, `toMidi('C4') === 60`, `seq(hand, stepSeconds, 'C4/1 E4+G4/2 _/1')`, `sortNotes`, `songLength`, `sourceOf`.

### Lesson file (`src/lesson.ts`)

`toLesson(song): LessonFile` and `fromLesson(text): Song` (throws `Error` with a friendly message).
Format `{ format: 'piano-lesson', version: 1, title, by, recording?, notes: [midi, start, dur, 0 right | 1 left, finger?][] }`
plus optional `difficulty, bpm, beats, timeSignature, chords: [start, dur, label][], tags, licence, credit`.
The fifth note cell (finger 1..5) is optional. Old version 1 files without the newer fields still load. Any
present-but-malformed field rejects the file. Lesson files never contain audio, `raw`, `source`, `edited` or
ids. `fromLesson` leaves `source` unset; the caller sets it.

### Library (`src/app/library.ts`)

```ts
class Library {
  load(): Promise<void>;                               // shell calls once (saved songs)
  register(songs: readonly Song[]): void;              // built-in, never stored
  registerLazy(entries: readonly LazySong[]): void;    // built-in, summary now, notes fetched on demand
  all(): readonly Song[];                              // songs whose notes are loaded
  bySource(source: SongSource): Song[];
  get(id: string): Song | undefined;                   // loaded songs only
  has(id: string): boolean;                            // loaded or lazy
  summaries(): readonly SongSummary[];                 // every song, loaded or not: for lists
  summary(id: string): SongSummary | undefined;
  ensure(id: string): Promise<Song | undefined>;       // fetches a lazy song once; undefined if unknown or failed
  add(song: Song, options?: { audio?: Blob; backing?: Blob }): Promise<Song>;   // replaces same id; built-in ids refused
  update(song: Song): Promise<void>;                   // pass a changed copy, never mutate in place
  attachAudio(id: string, audio: Blob): Promise<Song>;
  attachBacking(id: string, backing: Blob): Promise<Song>; // the split rendition ("Split this song")
  remove(id: string): Promise<void>;                   // built-in songs refused
  subscribe(listener: (songs: readonly Song[]) => void): () => void;
}
interface SongSummary { id; title; by; source; difficulty?; tags; seconds?; noteCount?; licence?;
  needsRecording; hasRecording; edited; addedAt?; loaded }
```

Lists (home, editor start, course) render from `summaries()`. Anything that needs notes (player, editor,
course song steps, export) awaits `ensure(id)` and shows a loading notice meanwhile. Non-built-in songs are
saved with their audio and come back after reload. Recordings (and split backings) are stored as
`{ type, bytes: ArrayBuffer }`, never as Blobs: Safari's private windows refuse Blobs in IndexedDB. Storage
failures are logged, never thrown.

Song pack (`src/songs/index.ts`): `loadSongPackIndex()` reads `public/songs/index.json`; every file listed in
`songs` that also has a `details` line becomes a lazy entry, files without details are fetched at once.
`loadSongPack()` (fetch everything) is kept for tools and tests. Built-in songs: `BUILT_IN` (three short
arrangements in the bundle) plus the pack (`pack:<file>`). After the first visit the service worker keeps
every song file for offline use.

### Store, progress, first run (`src/app/store.ts`, `src/app/progress.ts`, `src/app/first-run.ts`)

```ts
type Stars = 0 | 1 | 2 | 3;
interface SongProgress { songId: string; best: number; stars: Stars; plays: number; lastPlayed: number }
interface LessonProgress { lessonId: string; completed: boolean; stars: Stars; attempts: number; completedAt?: number }
interface Store {
  readonly persistent: boolean;             // false in private windows: everything works, nothing survives reload
  getSongs(): Promise<StoredSong[]>; putSong(song: Song): Promise<void>; putAudio(songId: string, audio: Blob): Promise<void>;
  putBacking(songId: string, backing: Blob): Promise<void>; // kept in the audio table under `backing:<songId>` (no new table, no upgrade)
  deleteSong(songId: string): Promise<void>; // also deletes audio and progress
  getValue(key: string): Promise<unknown>;  // validate what you read
  setValue(key: string, value: unknown): Promise<void>;
  getProgress / putProgress / allProgress; getLessonProgress / putLessonProgress / allLessonProgress;
}
function recordPlay(store, songId, accuracy, now?): Promise<SongProgress>;
function recordLesson(store, lessonId, { completed, stars }, now?): Promise<LessonProgress>;
function touchStreak(store, now?): Promise<Streak>;  // both record* call it
function getStreak(store): Promise<Streak>;          // { current, longest, lastDay: 'YYYY-MM-DD' }
function starsFor(accuracy: number): Stars;          // 0.5 / 0.75 / 0.9

function shouldWelcome(store): Promise<boolean>;     // never finished and no songs or progress yet
function finishWelcome(store, playWith?: 'midi' | 'keys' | 'mic'): Promise<void>;
function midiAlreadyAllowed(store, permissions?): Promise<boolean>;
```

Use the record helpers rather than writing progress by hand. Key-value keys in use: `settings`, `streak`,
`app:welcome`, `input:midi-allowed`, `course:last-lesson`, `course:resume`, `course:skipped`, `course:lesson-day`, `player:count-in`,
`player:best:<mode>:<songId>`, `player:choices:<songId>` (the hands and speed last used for a song), `editor:draft:<songId|new>`, `editor:coached` (the editor's first-time tip was seen). New area data uses its own prefix.
`community:catalog-url` is read once for migration (see Settings). The import cache uses its own IndexedDB
database (`piano-import-cache`).

One-time messages between screens go through `src/app/handoff.ts`: `setHandoff({ kind: 'imported', songId, automatic })`
(the import flow, so the player can say the lesson was made automatically and link to the editor) and
`{ kind: 'saved', songId }` (the editor). `takeHandoff(songId)` reads and clears it.

### Settings (`src/app/settings.ts`)

```ts
interface Settings {
  volume: number; instrument: InstrumentKind; view: 'falling' | 'sheet';
  mode: Mode; hands: Hands; speed: number;
  songSound: 'full' | 'backing' | 'off';                // what the original recording plays (see Song splitting)
  splitSongs: 'ask' | 'yes' | 'no';                     // the answer to "Split the song..." when adding one
  showKeyLetters: boolean; showNoteNames: boolean; metronome: boolean;
  latencyMs: number; reduceMotion: boolean; micEnabled: boolean;
  reverb: number; metronomeVolume: number; velocityCurve: 'light' | 'normal' | 'heavy'; fixedVelocity: boolean;
  midiDisabled: string[]; midiOutput: string;          // '' = no MIDI output
  keyLow: number; keyHigh: number;                      // the player's keyboard, measured by the connection helper (21..108 = unknown)
  micSensitivity: number; micNoiseFloor: number;
  catalogUrl: string;                                   // shared songs list address; '' = the one shipped with the app
}
class SettingsService {
  load(): Promise<void>;                 // also moves the old 'community:catalog-url' key into catalogUrl, once
  get(): Readonly<Settings>;
  set(patch: Partial<Settings>): void;   // invalid values ignored, saved automatically
  subscribe(listener: (settings: Readonly<Settings>, changed: (keyof Settings)[]) => void): () => void;
}
```

Defaults: `instrument: 'piano'` (the sampled grand piano; `'synth'` is the light fallback), `view: 'falling'`,
`mode: 'wait'` (Learn), `hands: 'right'`, `speed: 1`, `volume: 0.8`, `reverb: 0.25`, `metronomeVolume: 0.7`,
`keyLow: 21`, `keyHigh: 108`, `songSound: 'backing'`, `splitSongs: 'ask'`, `reduceMotion` from the system
preference. New fields need a type, a default and a validator in `VALID`. `sanitize` also moves old values:
`songSound` was a boolean before songs could be split (true becomes `'backing'`, which plays the whole recording
for songs without a split; false becomes `'off'`).

### Input (`src/input/hub.ts`)

```ts
interface NoteSink {
  down(midi: number, velocity: number): void;  // velocity 0..1
  up(midi: number): void;
  pedal(on: boolean, depth?: number): void;     // sustain; depth 0..1 for half-pedal
  changed(): void;                              // connected or devices changed
}
interface NoteSource {
  readonly id: string; readonly name: string; readonly connected: boolean;
  readonly devices?: readonly string[];
  start(sink: NoteSink): void | Promise<void>;
  stop(): void;
}
interface HubEvents {
  down: { midi: number; velocity: number; source: string };
  up: { midi: number; source: string };
  pedal: { on: boolean; source: string };
  pedalDepth: { depth: number; source: string };
  devices: { sources: readonly NoteSource[] };
}
class InputHub {
  register(source: NoteSource): void;
  start(id?: string): Promise<void>; stop(id?: string): void;
  get<T extends NoteSource = NoteSource>(id: string): T | undefined;
  list(): NoteSource[]; devices(): string[];
  readonly held: ReadonlySet<number>; readonly pedal: boolean;
  on<K extends keyof HubEvents>(event: K, handler: (e: HubEvents[K]) => void): () => void;
}
```

Sources:
- `keyboard`: computer keys, two octaves from `baseC` (screens set it per song; `keyMap`, `keyLetters` helpers).
- `pointer`: on-screen keys, `attach(element, keyAt): () => void`.
- `midi` (`MidiSource`): every connected device, hot-plug, all channels, sustain and half-pedal, per-device
  on/off, touch curves. `status: 'idle' | 'unsupported' | 'insecure' | 'asking' | 'denied' | 'ready'`
  (`idle` = not asked yet), `requestAccess()` from a button press, `deferAccess`, `ports()`, `outputs()`,
  `onChange`, `onActivity`.
- `mic` (`MicSource`): listens to an acoustic piano. Started only while `settings.micEnabled`; asks for the
  microphone in `start`; loads its pitch detection (`src/input/pitch.ts`) only then. Ignores notes the app is
  playing (`src/audio/sounding.ts`). Works best one note at a time.

UI pieces: `mountPianoConnect(container, ctx, { headingLevel?, onDone? })` (`src/input/connect-ui.ts`: status,
"Connect my piano", live notes, keyboard size saved to `keyLow`/`keyHigh`, tips), `mountTimingCheck`
(`src/input/timing-ui.ts`, sets `latencyMs`). MIDI output: `midiOutput()` from `src/audio/bridge.ts` returns the
`MidiOutput` (`select(name)`, `noteOn`, `noteOff`, `light(midi, on)`, `allOff()`); it forwards the notes the app
plays when an output is chosen.

### Audio (`src/audio/instrument.ts`, `src/audio/metronome.ts`)

```ts
interface Instrument {
  wake(): void;                                             // call from a user gesture
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
  play(midi: number, seconds: number, velocity?: number): void;
  setVolume(volume: number): void;                          // 0..1
  sustain?(on: boolean): void;
  pedalDepth?(depth: number): void;
  setReverb?(amount: number): void;
  allOff?(): void;
}
const INSTRUMENT_KINDS = ['piano', 'synth'] as const;       // INSTRUMENT_LABELS for the settings screen
function createInstrument(kind?: InstrumentKind): Instrument; // default 'piano' (samples in public/samples/piano, loaded on first use)

interface Metronome {
  readonly running: boolean;
  start(options: { bpm?: number; beats?: readonly number[]; beatsPerBar?: number; songTime: () => number; speed?: () => number }): void;
  stop(): void;                       // also cancels a count-in
  setVolume(volume: number): void;    // master volume
  setClickVolume(level: number): void; // settings.metronomeVolume
  countIn(options: { beats: number; bpm: number; beatsPerBar?: number; speed?: number }): Promise<boolean>; // true on the downbeat, false if stopped
}
```

`start` follows the song clock (`songTime`), so clicks stay with pauses, seeks and speed changes. The player
uses `countIn` before Play along; the course clicks through the lead-in beats with `start`. `src/audio/context.ts`
exposes the shared `audioContext()`.

### Session (`src/player/session.ts`)

```ts
interface SessionEvents {
  hit: { index: number; note: Note; error: number; time: number }; // error in song seconds, negative = early
  miss: { index: number; note: Note; time: number };
  wrong: { midi: number; time: number };
  finished: { result: Result; mode: Mode; song: Song };             // Result = { hit, missed, wrong, accuracy }
  running: { running: boolean };
  reset: { song: Song; options: SessionOptions };
  seek: { time: number }; loop: { loop: Loop; pass: number; hit: number; missed: number; wrong: number };
  looping: { loop: Loop | null }; speed: { speed: number }; preview: { on: boolean };
}
type SessionOptions = { mode: 'listen' | 'wait' | 'flow'; hands: 'right' | 'left' | 'both'; speed: number };
class Session {
  constructor(deps: { audio: { readonly instrument: Instrument }; backing?: Backing }, song: Song, options: SessionOptions);
  song: Song; options: SessionOptions; game: Game; readonly running: boolean;
  inputDelay: number;      // real seconds taken off presses before judging (settings.latencyMs / 1000)
  muteOwnPart: boolean;    // microphone in use: never play the learner's own hand(s); the other hand and the recording still play
  readonly loop: Loop | null; readonly previewing: boolean;
  load(song: Song, options?: Partial<SessionOptions>): void;
  reset(): void; toggle(): void; start(): void; pause(): void;
  press(midi: number): void;   // judged only while running
  tick(dt: number): void;      // once per animation frame, real seconds
  seek(time: number): void; setLoop(loop: Loop | null): void; loopLead(): number;
  setSpeed(speed: number): void;      // 0.25..2, no restart, the recording follows at the same pitch
  recordingMuted: boolean;            // "Piano only": the recording keeps time silently
  setRecordingSource(source: 'full' | 'backing'): void; // switch rendition mid-song: same place, speed and play state
  preview(seconds?: number): void;    // "Show me"
  stopPreview(): void;
  usesRecording(): boolean;
  on<K extends keyof SessionEvents>(event: K, handler: (e: SessionEvents[K]) => void): () => void;
  destroy(): void;
}
```

Modes: `listen` plays everything, `wait` ("Learn") holds the song at each note until it is pressed, `flow`
("Play along") keeps going and marks late notes missed. With a recording, listen and flow play it as backing
and use it as the clock, so seeking, looping, speed changes and hidden tabs cannot make the notes drift. Seek
skips notes before the new time; a loop never finishes the song. In Learn mode a hit's `error` is never
positive and a wrong key costs 0.15 accuracy instead of 0.25. Subscribe; never edit the session to add behaviour.

The play screen (`src/screens/player.ts`) moves through phases, shown as `data-phase` on `.player`: `ready`
(the get-ready page: cover, three ways to play, hands, one Play button, and a Practice tools sheet holding every
other setting), `counting`, `playing` (the stage with a round pause button, a thin progress bar and the score),
`paused` (a pause sheet) and `results` (the celebration). `.play-button` is one element that moves between the
get-ready page and the stage.

The player pauses when the tab is hidden (`visibilitychange`) or the piano is unplugged, not on window blur
(a file picker would trigger it). It lights the next keys on light-up keyboards through `KeyLights` /
`keysToLight` (`src/player/lights.ts`) when a MIDI output is chosen, sets `muteOwnPart` while the microphone
listens, and hides "Notes to play" for songs marked `edited`.

### Stage views (`src/player/view.ts`)

```ts
interface FrameState {
  song: Song; notes: readonly Note[]; states: readonly NoteState[]; // 'pending' | 'hit' | 'miss' | 'auto'
  time: number; length: number; mode: Mode; hands: Hands; speed: number; running: boolean;
  expected: ReadonlySet<number>; held: ReadonlySet<number>;
  wrong: { midi: number; at: number } | null;   // at = performance.now()
  keyLetters: ReadonlyMap<number, string>; range: { lo: number; hi: number };
  showNoteNames: boolean; reduceMotion: boolean; now: number;
  loop?: Loop | null; previewing?: boolean;
  keyLimit?: { lo: number; hi: number };        // the connected piano's keys (keyLimitFor in keyboard.ts)
}
interface StageView {
  resize(width: number, height: number, pixelRatio: number): void; // host CSS pixels
  draw(frame: FrameState): void;
  keyAt?(x: number, y: number): number | null;  // enables on-screen playing
  keyRect?(midi: number): Rect | null;          // used by effects
  destroy(): void;
}
type StageViewFactory = (host: HTMLElement) => StageView;
```

The falling view (`src/player/falling.ts`) fits a snug key range to the notes (`fitKeys`, never outside
`keyLimit`), scrolls sideways on narrow screens, and draws finger numbers on notes that carry `finger`. The
sheet view (`src/sheet/view.ts`) draws engraved notation with a small keyboard below and reads `range`.

### Import (`src/import/index.ts`)

```ts
function importFile(file: File, library: Library, options?: {
  level?: Level;                                     // default 'melody'
  onProgress?: (stage: 'reading' | 'downloading' | 'splitting' | 'listening' | 'analysing', fraction: number) => void;
  signal?: AbortSignal;                              // rejects with an Error named 'Cancelled'
  startAt?: number;                                  // "the song starts here"; default: detected while listening
  hands?: HandChoice;                                // MIDI: which tracks each hand plays
  split?: boolean;                                   // recordings: split first (see Song splitting)
  onNote?: (text: string) => void;                   // a friendly sentence when splitting did not work (the import goes on)
}): Promise<Song>;
function splitSong(song: Song, library: Library, options?): Promise<Song>; // "Split this song": backing only, notes unchanged
function chordsFor(song): TimedChord[] | undefined;  // chords to re-arrange with (older songs get them worked out again)
function midiTracks(file: Blob): Promise<MidiTrack[]>;       // for the track chooser (more than two tracks)
function findSongStart(file: Blob): Promise<number>;
function rearrange(song: Song, level: Level, library: Library): Promise<Song>;
class FriendlyError extends Error {}                         // message is shown to the person as written
const ACCEPT: string;
```

Lesson files are read as they are, MIDI files as notes (tempo map, beats, time signature, hands guessed from
track names and ranges), and anything else as a recording: decoded, listened to by the note-detection model in
this tab (nothing is uploaded; `@spotify/basic-pitch` stays behind the dynamic `import('./transcribe')`), the
melody traced separately, simplified to the chosen level and analysed (`analyseHeard` in `src/import/pipeline.ts`,
which calls `analyseSync` in `src/analysis`: bpm, beats, time signature, key, chords). Note times stay in
recording time; notes before the song start are dropped. A recording a loaded lesson was made for is attached to
that lesson. What was heard is cached per file (`src/import/cache.ts`, keyed by the file's SHA-256, with
`:split` added for split songs) so adding the same file again is instant. Bump `CACHE_VERSION` (now 3: chords
from the model's frame activations, with sevenths, slash chords and confidence) whenever listening or analysis
changes enough that old results should be redone.

`analyseHeard(raw, audio?, activations?)` is the one place song facts are worked out from what was heard: `raw`
holds every note heard plus the tune marked `part: 'melody'`, `audio` (the whole recording, mono) gives the beats,
and `activations` (the note model's frame-by-frame output, much richer than the notes) steadies the chords. For a
split song the notes and activations come from the harmony stem (see Song splitting). `chordsFor(song)` is what
re-arranging uses: songs analysed before chords carried a `confidence` get their chords worked out again from
`raw` with today's chord finder.

Chord labels (`src/analysis/chords.ts`) are lead-sheet style: `C`, `Am`, `G7`, `Cmaj7`, `Am7`, `Dsus4`, `Dsus2`,
`C6`, `Am6`, `Bdim`, `Caug`, `E5` (root and fifth only, used when the third was not clear, so the piano never plays
a wrong third), with an optional bass note after a slash (`G/B`). Every detected chord has a `confidence`
(0..1); a very unsure short chord just continues the one before.

The home screen (greeting, the one best next thing from `bestNext`, rows from `homeShelves` in
`src/home/library-view.ts`, search behind a button, a song sheet per card) starts the import flow
(`src/home/import-flow.ts`), which is the UI: level choice, track chooser, progress with
Cancel, friendly errors, then the player with a note that the lesson was made automatically.

### Song splitting (`src/split/*`)

Why: the learner's piano chords doubled the guitars and keys already in the recording, which sounds wrong. When
a recording is added, the person can choose to split it in the browser (nothing is uploaded) into vocals, drums,
bass and "other" (guitars, keys, the rest). The player then offers the recording without the "other" layer, and
the note model hears the song's harmony without drums and voice.

- **Networks**: Deezer's Spleeter 4stems (MIT), as ONNX with fp16 weights (four files, about 79 MB), run by
  `onnxruntime-web`. Not Demucs: its weights are "provided only for scientific purposes". The prototype that chose
  this, with its measurements, is `experiments/separation/` (its own `package.json`, not part of the build).
- **Where the files come from** (`model-files.ts`, the one place to change it): a copy next to the app at
  `models/spleeter-4stems/` when there is one (`public/models/` here, ignored by git; development, tests and
  self-hosting), otherwise the public copy on Hugging Face, pinned to one revision. Each file's size and SHA-256
  are checked. Requests carry no cookies, referrer or custom headers. To set up a local copy:
  `mkdir -p public/models/spleeter-4stems` and download `vocals.fp16.onnx`, `drums.fp16.onnx`, `bass.fp16.onnx`
  and `other.fp16.onnx` from `SPLITTER_UPSTREAM` into it.
- **Opt-in, one-time download** (`model-store.ts`): the add-song dialog shows "Split the song so the piano
  replaces the guitars (one-time 80 MB download)", off until chosen; the answer is kept in `settings.splitSongs`
  and is the next song's starting answer. The files are kept in IndexedDB (as ArrayBuffers), or Cache Storage when
  IndexedDB refuses them. IndexedDB comes first because WebKit's private sessions empty Cache Storage on every
  reload. No service worker, http(s), secure context, SharedArrayBuffer or cross-origin isolation is needed (the
  iPad shell has none of them). Devices that report under 4 GB (`navigator.deviceMemory`) are not offered it.
- **Running** (`index.ts`, `worker.ts`, `runner.ts`): the page brings the recording to 44.1 kHz stereo and hands
  it to a module worker, which loads `onnxruntime-web` (the plain WebAssembly build, or the WebGPU build when the
  browser has a graphics adapter). With WebGPU both sets of networks are made and one test block is run through
  each; WebGPU is kept only when its masks agree with WebAssembly's (energy-weighted mean difference under 0.01;
  measured 7e-4 in Chromium and WebKit; the prototype had seen WebGPU give wrong numbers for other networks).
  WebAssembly runs on one thread: threads need cross-origin isolation (COOP/COEP), which the app does not set and
  the iPad shell cannot have, and measured on an isolated production build, onnxruntime's thread workers never
  started from the bundled worker (and the note model's own threaded backend failed). A worker that makes no
  progress for 90 s is ended and the song is made without splitting. The worker is ended
  as soon as it answers, before the note model starts, so the two never hold memory together.
- **Maths** (`spleeter.ts`, `fft.ts`): the prototype's STFT, ratio masks and inverse (checked against Spleeter),
  in blocks of 512 frames (about 12 s), streaming: only the input is held whole; finished samples go straight to
  the encoder and to the 22.05 kHz harmony array. The backing is the recording times (1 minus the "other" mask), one
  inverse per frame; the 22.05 kHz outputs come from a 2048-point inverse of the lowest bins. Our own maths is now
  about 10% of the time (it was 40 to 65% in the prototype). `tests/split.test.ts` compares against numbers the
  prototype's code produced (`tests/fixtures/split-reference.json`); `tests/split-model.test.ts` runs the real
  networks on the prototype's test song when both are present and checks the backing scores 14.35 dB as before.
- **Storage and playback** (`encode.ts`): the backing is stored as Opus in Ogg (WebCodecs `AudioEncoder`, 96 kbit/s,
  about 12 KB a second) when this engine can play Ogg Opus, otherwise as 16-bit WAV at 22.05 kHz (about 88 KB a
  second). One `HTMLAudioElement` stays the clock: switching rendition sets its `src`, puts back the position and
  speed, and plays on if it was playing (`Session.setRecordingSource`). The lesson file never holds audio.
- **What the stems are used for**, measured with `scripts/stems-bench.test.ts` (synthetic band songs with a known
  score, and the prototype's song with known stems): chords and accompaniment notes come from the harmony stem
  (other + bass), which cut wrong chords from 3.0% of beats to 0.0% and non-chord accompaniment notes from 1.3 to
  2.0% to 0.0 to 0.2%. The tune is still traced in the whole recording: the vocal stem made it much worse on that
  material (the synthetic voice is not recognised as a voice, so it lands in "other"); with a real singer this
  may differ, and is not measured. Synthetic songs are not real band recordings.
- **Player**: a song with a split rendition gets three choices instead of the on/off switch: "Full song",
  "Without guitars and keys" (the default) and "Piano only"; the speaker button while playing steps through them.
  `settings.songSound` holds the choice for every song. "Split this song" in Practice tools makes the backing for a
  song added without it (the notes stay as they are).
- **When it fails** (no download, not enough memory, an error in the worker), the song is made exactly as without
  splitting, and the player says so in one sentence.

### Sheet music (`src/sheet/*`)

`SheetView` (`createSheetView`) is a `StageView`. It uses `bpm`, `beats`, `timeSignature` when present.
Known limits: no triplets or swing, one voice per staff. Small notation pictures for lessons:
`renderSnippet(canvas, { notes: 'C4/q D4/q E4/h', lower?, clef?, key?, time?, names?, highlight?, colors? }, { size?, maxWidth?, background?, palette? })`
from `src/sheet/snippet.ts`; the token format is documented at the top of that file. The course draws its
staff pictures with it (SVG fallback in `src/course/pictures.ts`).

### Course (`src/course/*`)

`COURSE` in `curriculum.ts` (`Course > Unit > Lesson > LessonStep`; 9 units, 40 lessons, original content),
`LessonRunner` and step controllers in `engine.ts`, the map in `map.ts`, lessons in `lesson-view.ts`. Play steps
build their own `Session` and stage view. Song steps reference library songs by id; `mountLesson` awaits
`library.ensure` for each (`lessonSongIds`) before starting. Progress: `saveLessonResult` (wraps `recordLesson`),
`course:last-lesson`, `course:resume`. Finger numbers in course music (`C4/1@3`) reach the falling notes.

A finished run is `LessonRunner.result()`: completed (with stars) when the learner did more than half of the
lesson's practice steps (everything but explanations, listening and a missing library song), otherwise skipped:
no stars, no streak day, kept in `course:skipped` (an id list) until done for real. Skipped lessons never block
the path: `firstIncomplete`, `isUnlocked` and `continueLesson` treat them as passed by, and `continueLesson`
comes back to them once everything else is done. `course:lesson-day` (the local day of the last finished
lesson) decides the "first lesson today" streak moment on the lesson-complete screen.

The map lays the lessons out as stepping stones on a winding trail: `stoneX`, `trailLayout` and `trailPath` in
`map.ts` are pure layout maths (tested in `tests/course-map.test.ts`). A lesson is full screen: a round back
link, a step bar, a "More" sheet for rare actions, the step's one short line, the picture or keys as the hero, and
one big button in a bottom bar that turns into the "Nice!" moment when a step is done. Pictures (`pictures.ts`):
keyboard (with marks and finger numbers), hand (numbered fingers), rhythm (counted beats) and staff.

### Editor (`src/editor/*`)

`mountEditor(container, ctx, songId?)`. Pure modules (`model`, `commands`, `history`, `grid`, `clean`) plus the
piano roll, panels and transport. Saving an existing song uses `library.update(copy)` and marks it `edited`
when the notes changed; a built-in song is saved as a copy with a new `mine:` id. Unsaved work is kept as a
draft (`editor:draft:*`). After saving, a "Play it" link opens the player (with the `saved` handoff). Entry
points: song cards ("Edit notes"), the player ("Edit notes" and "Fix this lesson" after an automatic import),
and the editor start screen (picture cards: write a new song, fix one of my songs, continue a draft; then the
songs as picture cards).

The workspace is simple by default: the roll, a dock of big buttons (Add, Select, Delete, Undo, Redo, Play,
Zoom) and Save as the one primary button. Everything else is in sheets behind "More tools" (`openSheet`):
Playing, Record, Notes and hands, Clean up, Problems, Song details, Save and share, Shortcuts. Every command
and shortcut is still there. Adding a note while zoomed far out zooms in around it (`Roll.makeGrabbable`) so
it can be grabbed straight away. The roll reads its colours from `--roll-*` custom properties on `.ed-roll`.

### Shared songs (`src/community/*`)

```ts
const DEFAULT_CATALOG_URL: string;                       // public/community/index.json, shipped with the app
function catalogUrlFrom(settings: { catalogUrl: string }): string;   // '' -> DEFAULT_CATALOG_URL
function cleanCatalogUrl(input: string): string | null;  // validates an address typed in Settings
function fetchCatalog(url?, fetcher?): Promise<ParsedCatalog & { url: string }>;
function fetchCatalogSong(entry, indexUrl?, fetcher?): Promise<Song>;
function fetchLessonFromLink(link, fetcher?): Promise<Song>;
function installEntry(...); communityId(entry) === 'community:' + entry.id;
```

Catalogs and lessons are validated strictly (`validate.ts`: notes and metadata only, no audio, no lyrics, size
and sha256 checked). The address is the `catalogUrl` setting, edited in Settings (About, More options).
`community/` is the catalog source of truth; `npm run check-catalog` validates it and its copy in
`public/community/`. The screen shows one suggested song, the two "Add from a link" and "Share my lesson"
cards (each opens a short step-by-step sheet), rows by style once there are enough lessons, and a grid of every
lesson; each card opens a song sheet with Add (or Play), Listen, the maker and `licenceWords(licence)` (the
licence in plain words, `src/community/filter.ts`).

### Settings screen (`src/screens/settings.ts`)

A short list of big picture cards (My piano, Sound, Microphone, Timing, Display, About). Each opens a page in
the same screen (a `history.pushState` entry on `#/settings`, so the browser's back button closes it). Pages
keep a few big controls; anything advanced is folded under "More options". The piano helper
(`mountPianoConnect(host, ctx, { big: true })` in `src/input/connect-ui.ts`) shows a whole keyboard that lights
up with the note name; the welcome uses its compact form. `tipList()` there draws tappable troubleshooting
tips.

### Offline and install (`vite.config.ts`, `src/sw/*`)

At build time a small Vite plugin writes `manifest.webmanifest` (from `APP_NAME`) and bundles `src/sw/sw.ts`
into `dist/sw.js` with the build version and file lists filled in. The dev server serves the manifest but never
registers a worker. `src/sw/cache-plan.ts` holds the pure decisions (tested in `tests/sw-cache-plan.test.ts`):
- install precaches the app shell (page, manifest, icons, entry files, small JS/CSS chunks);
- navigations: network first, cached page after a short timeout or offline;
- hashed build files and wasm: cache first;
- `songs/` and `community/`: stale-while-revalidate, and every song in `songs/index.json` is fetched in the
  background after install so the library works offline;
- `samples/` and `model/`: cache first on first use, kept across versions (`MEDIA_VERSION`);
- `models/` (the song splitter's networks): not handled by the worker; the app keeps them itself (IndexedDB);
- never cached: non-GET, other origins, `blob:`, range requests, error responses.

A new version waits; `sw-register.ts` shows "A new version of the app is ready" with Reload, which sends
`SKIP_WAITING` and reloads once the new worker takes over. Old caches are deleted on activate.

## End-to-end tests (`e2e/`)

`npm run e2e` type-checks `e2e/` (its own `e2e/tsconfig.json`, Node types) and runs Playwright with
`e2e/playwright.config.ts`. Test files are `e2e/*.e2e.ts`, so vitest never picks them up. Playwright starts two
servers on free ports: the Vite dev server (with `PIANO_E2E=1`, which turns live reload off so editing a file
cannot reload a page mid-test) for the `dev` project, and `vite build` + `vite preview` for the `preview` project
(`offline.e2e.ts`: the real service worker, offline reload, not-found and error pages).

- `fixtures.ts`: every test fails on a console error or an uncaught page error (`allowErrors` lists expected
  ones, such as the browser's own message for a request made while offline). An init script replaces
  `navigator.requestMIDIAccess` with a fake piano (`window.__midi`: send note on/off, pedal, plug and unplug,
  count permission requests, read messages sent to its lit keys) and `getUserMedia({ audio })` with a tone
  generator (`window.__mic.play(midi)`), because headless Chrome on macOS never answers a real microphone request.
  `shot(page, name)` saves screenshots into `E2E_SHOTS` (default `test-results/shots`).
- `bot.ts`: plays a song perfectly (or with chosen mistakes) through the fake piano by watching the song clock.
- `course-driver.ts`: completes a lesson step by step like a learner (answers, finds keys, plays the music).
- `media.ts`: lesson files and WAV recordings made at test time (a built-in tune rendered as piano-like tones).

Dev-only test handles: `exposeForTests(name, value)` (`src/app/test-hook.ts`) puts read-only handles on
`window.__piano` (`app`, `player`, `lesson`, `editor`) when `import.meta.env.DEV` is true, so the tests can read
the song clock, the expected notes and the editor's notes. A production build drops them. Screens never read them.

## Notes from running the app in a real browser

- The import worker imports `src/import/worker-env.ts` before TensorFlow.js: its WebGL backend checks `!window`
  while waiting for the graphics card, which throws in a worker and used to stall every import at 10%.
- The service worker matches its caches with `ignoreVary`: servers that send `Vary: Origin` made every cached
  module script miss, so the app could not start offline.
- Colour tokens: an ocean (teal to blue) page, sun yellow for the one primary action, coral and mint, cream paper
  surfaces with ink text. The hand colours (`--right`, `--left`) are for notes only. `e2e/a11y.e2e.ts` checks every
  token text pair for WCAG AA. Fonts (Fredoka, Atkinson Hyperlegible, SIL OFL) are self-hosted in `public/fonts/`
  and precached by the service worker.
