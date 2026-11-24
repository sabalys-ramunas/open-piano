import '../styles/player.css';
import type { AppContext } from '../app/context';
import { download, h, levelBadge, link, notice, pickFile, starRating } from '../app/dom';
import { takeHandoff } from '../app/handoff';
import { recordPlay, starsFor } from '../app/progress';
import type { Route } from '../app/router';
import type { Cleanup } from '../app/screens';
import { SONG_SOUNDS, type SongSound, type ViewKind } from '../app/settings';
import { exposeForTests } from '../app/test-hook';
import { computerKeys, inAppShell, onKeyboardSeen } from '../app/shell';
import { pageTitle } from '../app/title';
import { HANDS as HAND_WORDS, LEVELS, minutesSeconds, MODES, NOTES_TO_PLAY_LABEL, SONG_SOUND_WORDS, SPLIT_DOWNLOAD } from '../app/words';
import { midiOutput } from '../audio/bridge';
import { rearrange, splitSong } from '../import';
import { keyLetters } from '../input/keyboard';
import { toLesson } from '../lesson';
import { createEffects } from '../player/effects';
import type { Hands, Loop, Mode } from '../player/game';
import { createHud } from '../player/hud';
import { keyLimitFor, rangeFor } from '../player/keyboard';
import { KeyLights, keysToLight } from '../player/lights';
import { createFallingView } from '../player/falling';
import { beatLength, clampSpeed, formatTime, loopAround, loopFor, passageLength, SPEED_MAX, SPEED_MIN, SPEED_STEP, TrickyCoach, trickiest, troublePassages, type Passage } from '../player/practice';
import { bigStar, handsArt, modeArt, playerIcon } from '../player/ready-art';
import { GRADE_LABEL, GRADES, HISTOGRAM_BINS, ScoreKeeper, type Mistake } from '../player/scoring';
import { Session } from '../player/session';
import type { FrameState, StageView, StageViewFactory } from '../player/view';
import { createSheetView } from '../sheet/view';
import { noteName, songLength, type Level, type Song } from '../song';
import { playCheer } from '../audio/cheer';
import { celebrate } from '../ui/celebrate';
import { songCover } from '../ui/cover-art';
import { icon } from '../ui/icons';
import { mascot } from '../ui/mascot';
import { openSheet, type Sheet } from '../ui/sheet';

/** Every way of showing the song. Add a view here and to ViewKind in settings. */
const VIEWS: Record<ViewKind, { label: string; create: StageViewFactory }> = {
  falling: { label: 'Falling notes', create: createFallingView },
  sheet: { label: 'Sheet music', create: createSheetView },
};

/** Five words or fewer under each way to play. */
const MODE_WORDS: Record<Mode, string> = {
  listen: 'Hear how the song goes',
  wait: 'The music waits for you',
  flow: 'Keep up with the music',
};

const NO_LETTERS: ReadonlyMap<number, string> = new Map();
const COUNT_IN_KEY = 'player:count-in';
/** Best score per song and mode: Learn and Play along scores are not comparable. */
const BEST_KEY = (songId: string, mode: Mode) => `player:best:${mode}:${songId}`;
/** The hands and speed last used for a song, so coming back is one press of Play. */
const CHOICES_KEY = (songId: string) => `player:choices:${songId}`;
const IDLE_MS = 2600;
/** How long Learn waits on a note before the "Press C" bubble appears. */
const HINT_AFTER_MS = 900;

type Phase = 'ready' | 'counting' | 'playing' | 'paused' | 'results';

interface BestScore {
  score: number;
  combo: number;
}

function readBest(value: unknown): BestScore | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const score = typeof v.score === 'number' && Number.isFinite(v.score) && v.score >= 0 ? v.score : null;
  const combo = typeof v.combo === 'number' && Number.isFinite(v.combo) && v.combo >= 0 ? v.combo : 0;
  return score === null ? null : { score, combo };
}

function readChoices(value: unknown): { hands?: Hands; speed?: number } {
  if (typeof value !== 'object' || value === null) return {};
  const v = value as Record<string, unknown>;
  const hands = v.hands === 'right' || v.hands === 'left' || v.hands === 'both' ? v.hands : undefined;
  const speed = typeof v.speed === 'number' && Number.isFinite(v.speed) ? clampSpeed(v.speed) : undefined;
  return { hands, speed };
}

function segmented<T extends string>(label: string, items: [T, string][], value: T, onPick: (v: T) => void): { el: HTMLElement; set(v: T): void } {
  const buttons = items.map(([v, text]) => {
    const b = h('button', { type: 'button', 'data-value': v, 'aria-pressed': String(v === value) }, text);
    b.addEventListener('click', () => onPick(v));
    return b;
  });
  return {
    el: h('div', { class: 'segmented', role: 'group', 'aria-label': label }, ...buttons),
    set(v) {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
    },
  };
}

/** A switch: `<label class="toggle">Words <input type="checkbox" role="switch"></label>`. */
function toggle(label: string, checked: boolean): { field: HTMLLabelElement; input: HTMLInputElement } {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = checked;
  return { field: h('label', { class: 'toggle' }, h('span', {}, label), input), input };
}

/** The picture for each choice of what the recording plays. */
function soundGlyph(sound: SongSound): SVGSVGElement {
  return sound === 'full' ? icon('speaker') : sound === 'backing' ? icon('mic') : icon('piano');
}

/** "C", "C and E", "C, E and G". */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Shown while a song is not loaded yet: a built-in song whose notes are still
 * being fetched, a song pack still loading, or a removed song.
 */
function mountMissing(container: HTMLElement, ctx: AppContext, route: Route & { screen: 'play' }): Cleanup {
  const heading = h('h1', { class: 'player-missing-title' }, 'Opening the song');
  const body = h('div', {}, notice('loading', 'Getting the notes ready...'));
  const box = h('div', { class: 'player-missing' }, link({ screen: 'home' }, 'All songs', { class: 'back-link' }), heading, body);
  container.append(box);
  let inner: Cleanup | null = null;
  let alive = true;

  const open = (): boolean => {
    if (!alive || inner || !ctx.library.get(route.songId)) return false;
    box.remove();
    inner = mount(container, ctx, route);
    return true;
  };
  const off = ctx.library.subscribe(() => void open());

  void (async () => {
    let song = await ctx.library.ensure(route.songId);
    if (!song) {
      await ctx.songPack;
      song = await ctx.library.ensure(route.songId);
    }
    if (!alive || inner) return;
    if (song && open()) return;
    heading.textContent = 'Song not found';
    heading.dataset.title = 'Song not found';
    pageTitle('Song not found');
    body.replaceChildren(
      notice(
        'empty',
        'This song is not in your library',
        navigator.onLine === false ? 'You seem to be offline, and this song has not been saved on this device yet.' : 'It may have been removed, or the link is not quite right.',
        link({ screen: 'home' }, 'All songs', { class: 'button primary' }),
      ),
    );
  })();

  return () => {
    alive = false;
    off();
    inner?.();
  };
}

/**
 * The play screen. Before playing: a friendly "get ready" page with the
 * song's cover, three ways to play, the hands and one big Play button. While
 * playing the stage is everything: a round pause button, a thin progress bar
 * and a compact score. Pausing opens a small sheet; every other setting lives
 * in the Practice tools sheet. At the end: a celebration.
 */
export function mount(container: HTMLElement, ctx: AppContext, route: Route): Cleanup {
  if (route.screen !== 'play') return () => {};
  const found = ctx.library.get(route.songId);
  if (!found) return mountMissing(container, ctx, route);
  let song: Song = found;
  const handoff = takeHandoff(song.id);

  const settings = ctx.settings;
  const s0 = settings.get();
  // A beginner can just press Play: Learn (the settings default), the right hand, full speed.
  const firstHands: Hands = song.notes.length === 0 || song.notes.some((n) => n.hand === 'right') ? 'right' : 'left';
  const session = new Session({ audio: ctx.audio }, song, { mode: s0.mode, hands: firstHands, speed: 1 });
  session.inputDelay = s0.latencyMs / 1000;
  const keeper = new ScoreKeeper(session);
  let countInOn = true;
  const calm = () => settings.get().reduceMotion;

  // ---- Get ready ----
  const title = h('h1', { class: 'player-title', id: 'player-title' });
  const byLine = h('p', { class: 'getready-by' });
  const facts = h('div', { class: 'getready-facts' });
  const cover = h('div', { class: 'getready-cover' });

  // Each way to play is a picture card: the button holds the picture and the name, and the
  // five-word hint below it describes it (the whole card is the button's hit area).
  const modeButtons = MODES.map((m) =>
    h(
      'button',
      { type: 'button', class: 'mode-choice-button', 'data-mode': m.mode, 'aria-pressed': String(m.mode === s0.mode), 'aria-describedby': `mode-${m.mode}-hint` },
      modeArt(m.mode),
      h('span', { class: 'mode-choice-label' }, m.label),
    ),
  );
  const modeCards = modeButtons.map((b, i) => h('div', { class: 'mode-choice' }, b, h('span', { class: 'mode-choice-hint', id: `mode-${MODES[i].mode}-hint` }, MODE_WORDS[MODES[i].mode])));
  // When the song sheet on the home screen already asked how to play, the answer is shown
  // as one line with a Change button instead of asking again.
  const modeChangeButton = h('button', { type: 'button', class: 'quiet small mode-change' }, 'Change');
  const modeChosen = h('div', { class: 'mode-chosen', hidden: true });
  const modeGroup = h(
    'fieldset',
    { class: 'getready-group getready-modes' },
    h('legend', { class: 'getready-legend' }, 'How to play'),
    modeChosen,
    h('div', { class: 'mode-choices' }, ...modeCards),
  );
  const handButtons = HAND_WORDS.map((x) =>
    h('button', { type: 'button', class: 'hand-choice', 'data-hands': x.hands, 'aria-pressed': String(x.hands === firstHands) }, handsArt(x.hands), h('span', {}, x.label)),
  );
  const handsGroup = h('fieldset', { class: 'getready-group getready-hands' }, h('legend', { class: 'getready-legend' }, 'Hands'), h('div', { class: 'hand-choices' }, ...handButtons));

  const playButton = h('button', { type: 'button', class: 'play-button', 'data-state': 'start' });
  const readySlot = h('div', { class: 'getready-play' }, playButton);
  const toolsButton = h('button', { type: 'button', class: 'getready-tools' }, icon('settings'), 'Practice tools');
  // The original recording, on or off. Shown only for songs that have one: a switch on the
  // get-ready page, a round speaker button while playing. Both keep one name and show the state.
  const soundState = h('span', { class: 'song-sound-hint', id: 'song-sound-hint' });
  const soundChoice = h(
    'button',
    { type: 'button', class: 'song-sound-choice', role: 'switch', 'aria-checked': 'true', 'aria-labelledby': 'song-sound-title', 'aria-describedby': 'song-sound-hint' },
    h('span', { class: 'song-sound-art' }),
    h('span', { class: 'song-sound-text' }, h('span', { class: 'song-sound-title', id: 'song-sound-title' }, 'Original song'), soundState),
    h('span', { class: 'song-sound-knob', 'aria-hidden': 'true' }),
  );
  // A song that was split has three choices instead: the whole recording, without its guitars
  // and keys (the piano plays those), or the piano only.
  const soundInputs = SONG_SOUNDS.map((value) => h('input', { type: 'radio', name: 'song-sound', value, class: 'song-sound-radio', 'aria-describedby': `song-sound-${value}-hint` }));
  const soundOptions = h(
    'div',
    { class: 'song-sound-options', role: 'radiogroup', 'aria-label': 'Original song', hidden: true },
    ...soundInputs.map((input, i) => {
      const value = SONG_SOUNDS[i];
      return h(
        'label',
        { class: 'song-sound-option', 'data-sound': value },
        input,
        h('span', { class: 'song-sound-art', 'aria-hidden': 'true' }, soundGlyph(value)),
        h('span', { class: 'song-sound-text' }, h('span', { class: 'song-sound-title' }, SONG_SOUND_WORDS[value].label), h('span', { class: 'song-sound-hint', id: `song-sound-${value}-hint` }, SONG_SOUND_WORDS[value].hint)),
      );
    }),
  );
  const soundGroup = h('div', { class: 'getready-group getready-sound', role: 'group', 'aria-labelledby': 'song-sound-legend', hidden: true }, h('p', { class: 'getready-legend', id: 'song-sound-legend' }, 'Sound'), soundChoice, soundOptions);
  const soundButton = h('button', { type: 'button', class: 'icon-button song-sound-button', 'aria-label': 'Original song', hidden: true });
  // Wide screens have room under the cover; narrow ones show it after the hands.
  const soundSlotWide = h('div', { class: 'getready-sound-slot' });
  const soundSlotNarrow = h('div', { class: 'getready-sound-slot' });
  const wideLayout = window.matchMedia('(min-width: 901px) and (min-height: 521px)');
  const placeSound = () => {
    const focused = soundGroup.contains(document.activeElement);
    (wideLayout.matches ? soundSlotWide : soundSlotNarrow).append(soundGroup);
    if (focused) (soundOptions.hidden ? soundChoice : (soundInputs.find((i) => i.checked) ?? soundInputs[0])).focus({ preventScroll: true });
  };
  placeSound();
  wideLayout.addEventListener('change', placeSound);
  const status = h('p', { class: 'player-status', 'aria-live': 'polite' });
  const rotateHint = h('p', { class: 'rotate-hint' }, playerIcon('rotate'), h('span', {}, 'Turn your phone sideways for bigger keys'));
  const recordingNote = h('div', { class: 'stage-note', hidden: true, role: 'status' });
  const importNote = h('div', { class: 'stage-note stage-note-import', hidden: true, role: 'status' });

  const ready = h(
    'section',
    { class: 'getready', 'aria-labelledby': 'player-title' },
    h('div', { class: 'getready-top' }, link({ screen: 'home' }, 'All songs', { class: 'back-link' }), h('div', { class: 'getready-notes' }, importNote, recordingNote)),
    h(
      'div',
      { class: 'getready-main' },
      h('div', { class: 'getready-side' }, cover, soundSlotWide),
      h(
        'div',
        { class: 'getready-body' },
        h('div', { class: 'getready-head' }, h('p', { class: 'kicker' }, 'Get ready'), title, byLine, facts),
        modeGroup,
        handsGroup,
        soundSlotNarrow,
        h('div', { class: 'getready-go' }, readySlot, toolsButton),
        status,
        rotateHint,
      ),
    ),
  );

  // ---- Stage and its slim chrome ----
  const stage = h('div', { class: 'stage' });
  const viewHost = h('div', { class: 'stage-view' });
  const effectsLayer = h('canvas', { class: 'stage-effects', 'aria-hidden': 'true' });
  const countEl = h('div', { class: 'countin', hidden: true, 'aria-live': 'assertive' });
  const learnHint = h('p', { class: 'learn-hint', hidden: true, 'aria-live': 'polite' });
  const resultsBox = h('div', { class: 'results' });
  const resultsEl = h('div', { class: 'results-screen', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'player-overlay-title', tabindex: -1 }, resultsBox);
  stage.append(viewHost, effectsLayer, countEl, learnHint, resultsEl);
  const chromeSlot = h('div', { class: 'chrome-play' });
  const hudBox = h('div', { class: 'hud' });
  const chrome = h('div', { class: 'play-chrome' }, chromeSlot, soundButton, hudBox, h('p', { class: 'rotate-hint rotate-hint-stage', 'aria-hidden': 'true' }, playerIcon('rotate'), h('span', {}, 'Sideways is better')));
  const toastEl = h('div', { class: 'stage-toast', role: 'status' });

  const root = h('div', { class: 'player', 'data-phase': 'ready' }, stage, chrome, ready, toastEl);
  root.classList.toggle('is-calm', s0.reduceMotion);
  root.dataset.view = s0.view;
  container.append(root);

  // ---- Practice tools (built once, shown in a sheet) ----
  const speedInput = h('input', {
    type: 'range',
    min: SPEED_MIN * 100,
    max: SPEED_MAX * 100,
    step: SPEED_STEP * 100,
    value: Math.round(session.options.speed * 100),
    'aria-label': 'Speed',
  });
  const speedOut = h('output', { class: 'speed-out' }, `${Math.round(session.options.speed * 100)}%`);
  const slower = h('button', { type: 'button', class: 'icon-button step', 'aria-label': 'Slower' }, h('span', { 'aria-hidden': 'true' }, '−'));
  const faster = h('button', { type: 'button', class: 'icon-button step', 'aria-label': 'Faster' }, icon('plus'));
  const trickyButton = h('button', { type: 'button', class: 'button-mint wide' }, 'Practise the tricky part');
  const showMeButton = h('button', { type: 'button' }, playerIcon('eye'), 'Show me how it goes');
  const loopMistakeButton = h('button', { type: 'button' }, 'Loop my last mistake');
  const loopStartButton = h('button', { type: 'button', class: 'small' }, 'Set loop start');
  const loopEndButton = h('button', { type: 'button', class: 'small' }, 'Set loop end');
  const loopClearButton = h('button', { type: 'button', class: 'small', disabled: true }, 'Stop looping');
  const countIn = toggle('Count in before Play along', countInOn);
  const metronome = toggle('Metronome clicks', s0.metronome);
  const views = segmented('View', (Object.keys(VIEWS) as ViewKind[]).map((k) => [k, VIEWS[k].label] as [ViewKind, string]), s0.view, (view) => settings.set({ view }));
  const noteNames = toggle('Note names on notes', s0.showNoteNames);
  const letters = toggle('Computer keys on the piano', s0.showKeyLetters);
  const fullButton = h('button', { type: 'button', class: 'small' }, playerIcon('expand'), h('span', {}, 'Full screen'));
  // The iPad/iPhone app is already full screen; iPhone browsers have no full screen for a page.
  fullButton.hidden = inAppShell() || typeof document.documentElement.requestFullscreen !== 'function';
  // No computer-key letters to switch on a touch screen without a keyboard (they come back with one).
  letters.field.hidden = !computerKeys();
  const level = h('select', { id: 'player-level', 'aria-describedby': 'player-level-help' }, ...LEVELS.map((l) => h('option', { value: l.level }, l.label)));
  level.value = song.level ?? 'melody';
  const levelHelp = h('p', { class: 'hint', id: 'player-level-help' });
  const levelField = h('div', { class: 'field' }, h('label', { for: 'player-level' }, NOTES_TO_PLAY_LABEL), level, levelHelp);
  const editedLine = h('p', { class: 'hint', hidden: true }, 'You changed these notes in the editor, so they stay as you left them.');
  const saveButton = h('button', { type: 'button', class: 'quiet small' }, icon('download'), 'Save lesson');
  const recordingButton = h('button', { type: 'button', class: 'quiet small', hidden: true }, 'Add the recording');
  const splitButton = h('button', { type: 'button', class: 'quiet small', hidden: true }, 'Split this song');
  const splitHint = h('p', { class: 'hint', hidden: true }, 'The piano takes the place of the guitars and keys in the recording.');
  const editLink = link({ screen: 'editor', songId: song.id }, 'Edit notes', { class: 'button quiet small' });
  editLink.prepend(icon('edit'));
  const doneButton = h('button', { type: 'button', class: 'primary wide' }, 'Done');

  const toolsTitle = h('h2', { id: 'tools-title', class: 'tools-title', tabindex: -1 }, 'Practice tools');
  const toolsContent: HTMLElement[] = [
    toolsTitle,
    h(
      'section',
      { class: 'tools-section', 'aria-labelledby': 'tools-speed' },
      h('h3', { id: 'tools-speed' }, 'Speed'),
      h('div', { class: 'speed-field' }, slower, speedInput, faster, speedOut),
    ),
    h(
      'section',
      { class: 'tools-section', 'aria-labelledby': 'tools-part' },
      h('h3', { id: 'tools-part' }, 'Practise a part'),
      trickyButton,
      h('p', { class: 'hint' }, 'We find your trickiest bit, play it slowly and speed up as you get it.'),
      h('div', { class: 'tools-row' }, showMeButton, loopMistakeButton),
      h('div', { class: 'tools-row' }, loopStartButton, loopEndButton, loopClearButton),
    ),
    h('section', { class: 'tools-section', 'aria-labelledby': 'tools-timing' }, h('h3', { id: 'tools-timing' }, 'Timing help'), countIn.field, metronome.field),
    h(
      'section',
      { class: 'tools-section', 'aria-labelledby': 'tools-show' },
      h('h3', { id: 'tools-show' }, 'Show'),
      views.el,
      noteNames.field,
      letters.field,
      fullButton,
    ),
    h('section', { class: 'tools-section tools-level' }, levelField, editedLine),
    h(
      'section',
      { class: 'tools-section', 'aria-labelledby': 'tools-song' },
      h('h3', { id: 'tools-song' }, 'This song'),
      h('div', { class: 'tools-row' }, editLink, saveButton, recordingButton, splitButton),
      splitHint,
      link({ screen: 'settings' }, 'Sound, piano and timing settings', { class: 'tools-link' }),
    ),
    doneButton,
  ];
  const levelSection = toolsContent[5];

  let view: StageView = VIEWS[s0.view].create(viewHost);
  const effects = createEffects(session, effectsLayer, keeper);
  const hud = createHud(hudBox, session, keeper);
  let range = { lo: 48, hi: 83 };
  let phase: Phase = 'ready';
  let started = false;
  let resultsOn = false;
  let resultsPending = false;
  let recordingDismissed = false;
  let pendingLoopStart: number | null = null;
  let coach: TrickyCoach | null = null;
  let counting: { t0: number; beatMs: number; beats: number; shown: number } | null = null;
  let pauseSheet: Sheet | null = null;
  let toolsSheet: Sheet | null = null;
  let toolsBackToPause = false;
  let stopCelebration: (() => void) | null = null;
  const lights = new KeyLights((midi, on) => midiOutput()?.light(midi, on));
  let keyLimit = keyLimitFor(s0, ctx.sources.midi.connected);
  let lastDevices = ctx.input.devices().length;
  let toastTimer = 0;

  function say(text: string, ms = 3200): void {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), ms);
  }

  function describe(): void {
    title.textContent = song.title;
    title.dataset.title = song.title;
    byLine.textContent = song.by;
    byLine.hidden = !song.by;
    pageTitle(song.title);
    cover.replaceChildren(songCover(song, 'getready-art'));
    levelSection.hidden = !song.raw;
    levelField.hidden = !song.raw || Boolean(song.edited);
    editedLine.hidden = !song.raw || !song.edited;
    level.value = song.level ?? 'melody';
    levelHelp.textContent = LEVELS.find((l) => l.level === level.value)?.hint ?? '';
    updateSongSound();
    const missing = Boolean(song.recording && !song.audioUrl);
    recordingButton.hidden = !missing;
    splitButton.hidden = !song.audioUrl || Boolean(song.backingUrl) || song.source === 'built-in';
    splitHint.hidden = splitButton.hidden;
    recordingNote.hidden = !missing || recordingDismissed;
    if (missing && song.recording) {
      const add = h('button', { type: 'button', class: 'button-mint small' }, 'Add the recording');
      const dismiss = h('button', { type: 'button', class: 'icon-button note-close', 'aria-label': 'Play with the piano sound' }, icon('close'));
      add.addEventListener('click', () => void addRecording());
      dismiss.addEventListener('click', () => {
        recordingDismissed = true;
        recordingNote.hidden = true;
        playButton.focus();
      });
      recordingNote.replaceChildren(
        h('span', { class: 'note-icon' }, icon('wave')),
        h('div', { class: 'note-text' }, h('p', { class: 'stage-note-title' }, 'Hear the original?'), h('p', {}, `Add "${song.recording.name}" to play along with it.`)),
        add,
        dismiss,
      );
    }
    describeFacts();
  }

  function describeFacts(): void {
    const seconds = songLength(song);
    const speed = Math.round(session.options.speed * 100);
    facts.replaceChildren(
      song.difficulty ? levelBadge(song.difficulty) : '',
      seconds > 0 ? h('span', { class: 'getready-fact' }, icon('clock'), h('span', { class: 'visually-hidden' }, 'Length '), minutesSeconds(seconds)) : '',
      speed !== 100 ? h('span', { class: 'badge badge-sun' }, `Speed ${speed}%`) : '',
      bestFact,
    );
  }
  let bestFact: HTMLElement | string = '';
  void ctx.store
    .getProgress(song.id)
    .then((p) => {
      if (!p || !root.isConnected) return;
      bestFact = h('span', { class: 'getready-fact' }, starRating(p.stars), `Best ${Math.round(p.best * 100)}%`);
      describeFacts();
    })
    .catch(() => {});

  function showStatus(): void {
    const devices = ctx.input.devices();
    status.classList.toggle('is-connected', devices.length > 0);
    status.replaceChildren(
      devices.length > 0 ? icon('usb') : computerKeys() ? icon('keyboard') : icon('piano'),
      h(
        'span',
        {},
        devices.length > 0
          ? `Connected: ${devices.join(', ')}`
          : computerKeys()
            ? 'No piano? Play with your computer keys, or tap the keys on screen.'
            : 'No piano? Tap the keys on screen.',
      ),
    );
  }

  // ---- Phases ----
  function currentPhase(): Phase {
    if (resultsOn || resultsPending) return 'results';
    if (counting) return 'counting';
    if (session.running || session.previewing) return 'playing';
    return started ? 'paused' : 'ready';
  }

  /** True when this song has the split version of its recording (without guitars and keys). */
  const isSplit = () => Boolean(session.song.audioUrl && session.song.backingUrl);
  /** The last "on" choice, for switching a song that was not split back on. */
  let lastOn: Exclude<SongSound, 'off'> = s0.songSound === 'full' ? 'full' : 'backing';

  /** What plays for this song now: the setting, where "without guitars and keys" means the whole recording for songs that were not split. */
  function soundNow(): SongSound {
    const sound = ctx.settings.get().songSound;
    if (sound === 'off') return 'off';
    return isSplit() ? sound : 'full';
  }

  /** Shows what the original recording does, on the get-ready screen and while playing, and applies it. */
  function updateSongSound(): void {
    const has = Boolean(session.song.audioUrl);
    const sound = soundNow();
    session.recordingMuted = sound === 'off';
    // "Piano only" just mutes whichever version is loaded: no reloading for nothing.
    if (sound !== 'off') session.setRecordingSource(sound);
    soundGroup.hidden = !has;
    soundButton.hidden = !has;
    if (!has) return;
    const three = isSplit();
    soundChoice.hidden = three;
    soundOptions.hidden = !three;
    soundButton.dataset.sound = sound;
    if (three) {
      for (const input of soundInputs) input.checked = input.value === sound;
      const words = `Original song: ${SONG_SOUND_WORDS[sound].label}`;
      soundButton.removeAttribute('aria-pressed');
      soundButton.setAttribute('aria-label', words);
      soundButton.title = words;
      soundButton.replaceChildren(soundGlyph(sound));
      return;
    }
    const on = sound !== 'off';
    const glyph = on ? 'speaker' : 'speaker-off';
    soundChoice.setAttribute('aria-checked', String(on));
    soundChoice.querySelector('.song-sound-art')?.replaceChildren(icon(glyph));
    soundState.textContent = on ? 'On: the recording plays along' : 'Off: only the piano plays';
    soundButton.setAttribute('aria-label', 'Original song');
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.title = on ? 'Original song: on' : 'Original song: off';
    soundButton.replaceChildren(icon(glyph));
  }
  function setSongSound(next: SongSound): void {
    if (next !== 'off') lastOn = next;
    ctx.settings.set({ songSound: next });
    updateSongSound();
    wake();
  }
  /** The switch, for songs that were not split: on or off. */
  function toggleSongSound(): void {
    setSongSound(soundNow() === 'off' ? lastOn : 'off');
  }
  /** The speaker button while playing: on and off, or the three choices in turn for a split song. */
  function stepSongSound(): void {
    if (!isSplit()) {
      toggleSongSound();
      return;
    }
    const next = SONG_SOUNDS[(SONG_SOUNDS.indexOf(soundNow()) + 1) % SONG_SOUNDS.length];
    setSongSound(next);
    say(SONG_SOUND_WORDS[next].label, 1800);
  }
  soundChoice.addEventListener('click', toggleSongSound);
  soundButton.addEventListener('click', stepSongSound);
  for (const input of soundInputs) {
    input.addEventListener('change', () => {
      if (input.checked) setSongSound(input.value as SongSound);
    });
  }

  function updatePhase(): void {
    const state = counting ? 'counting' : session.running || session.previewing ? 'pause' : started ? 'continue' : 'start';
    const next = currentPhase();
    if (playButton.dataset.state !== state || next !== phase || !playButton.firstChild) {
      playButton.dataset.state = state;
      const word = state === 'counting' ? 'Cancel' : state === 'pause' ? 'Pause' : state === 'continue' ? 'Continue' : 'Play';
      const inReady = next === 'ready';
      const glyph = state === 'counting' ? icon('close') : state === 'pause' ? playerIcon('pause') : icon('play');
      playButton.className = inReady ? 'play-button primary big wide' : 'play-button icon-button big';
      playButton.replaceChildren(glyph, inReady ? word : h('span', { class: 'visually-hidden' }, word));
      const slot = inReady ? readySlot : chromeSlot;
      if (playButton.parentElement !== slot) {
        const focused = document.activeElement === playButton;
        slot.append(playButton);
        if (focused) playButton.focus({ preventScroll: true });
      }
    }
    if (next !== phase) {
      phase = next;
      root.dataset.phase = next;
      ready.hidden = next !== 'ready';
      if (next !== 'paused') pauseSheet?.close();
    }
    root.classList.toggle('is-playing', session.running);
    if (!session.running) wake();
  }

  function updateLoopButtons(): void {
    loopClearButton.disabled = !session.loop && pendingLoopStart === null;
  }

  /** Called after every reset: fits the keyboard to the song and the computer keys to the hand. */
  function fit(): void {
    const all = song.notes.map((n) => n.midi);
    range = clampRange(rangeFor(all));
    const h0 = session.options.hands;
    const mine = song.notes.filter((n) => h0 === 'both' || n.hand === h0).map((n) => n.midi);
    const pool = mine.length ? mine : all;
    ctx.sources.keyboard.baseC = pool.length ? Math.floor(pool.reduce((a, b) => Math.min(a, b), 127) / 12) * 12 : 60;
    started = false;
    coach = null;
    pendingLoopStart = null;
    cancelCountIn();
    hideResults();
    updatePhase();
    updateLoopButtons();
    showStatus();
  }

  /** Keeps the drawn keyboard inside the player's own piano, when we know its size. */
  function clampRange(r: { lo: number; hi: number }): { lo: number; hi: number } {
    if (!keyLimit) return r;
    const lo = Math.max(r.lo, keyLimit.lo);
    const hi = Math.min(r.hi, keyLimit.hi);
    return hi - lo >= 12 ? { lo, hi } : r;
  }

  function saveChoices(): void {
    void ctx.store.setValue(CHOICES_KEY(song.id), { hands: session.options.hands, speed: session.options.speed }).catch(() => {});
  }

  function setSpeed(speed: number, save = true): void {
    const s = clampSpeed(speed);
    session.setSpeed(s);
    speedInput.value = String(Math.round(s * 100));
    speedOut.textContent = `${Math.round(s * 100)}%`;
    describeFacts();
    if (save) {
      settings.set({ speed: s });
      saveChoices();
    }
  }

  function setMode(mode: Mode): void {
    settings.set({ mode });
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    lights.clear();
    session.load(song, { mode });
  }

  function setHands(hands: Hands, save = true): void {
    for (const b of handButtons) b.setAttribute('aria-pressed', String(b.dataset.hands === hands));
    if (save) settings.set({ hands });
    session.load(song, { hands });
    if (save) saveChoices();
  }

  // ---- Count-in and metronome ----
  function beatsPerBar(): number {
    const b = song.timeSignature?.beats;
    return b && b >= 2 && b <= 7 ? Math.round(b) : 4;
  }

  function startMetronome(): void {
    if (!settings.get().metronome) return;
    const beat = beatLength(song) ?? 60 / 90;
    ctx.audio.metronome.start({
      bpm: song.bpm ?? 60 / beat,
      beats: song.beats,
      beatsPerBar: beatsPerBar(),
      songTime: () => session.game.time,
      speed: () => session.options.speed,
    });
  }

  /**
   * One bar of clicks from the real metronome, then the song starts on the
   * downbeat. The big numbers follow the same beat: the metronome's first
   * click falls 0.1 s after it is asked to count in.
   */
  function beginCountIn(): void {
    const beat = (beatLength(song) ?? 0.75) / session.options.speed;
    const beatMs = Math.min(1300, Math.max(380, beat * 1000));
    const beats = beatsPerBar();
    const mine = { t0: performance.now() + 100, beatMs, beats, shown: -1 };
    counting = mine;
    ctx.audio.instrument.wake();
    ctx.audio.metronome.stop();
    countEl.hidden = false;
    updatePhase();
    void ctx.audio.metronome.countIn({ beats, bpm: 60000 / beatMs, beatsPerBar: beats, speed: 1 }).then((ok) => {
      if (counting !== mine) return;
      counting = null;
      countEl.hidden = true;
      if (ok) session.start();
      else updatePhase();
    });
  }

  function cancelCountIn(): void {
    if (!counting) return;
    counting = null;
    countEl.hidden = true;
    ctx.audio.metronome.stop(); // makes countIn resolve false
    updatePhase();
  }

  function tickCountIn(now: number): void {
    if (!counting) return;
    const k = Math.max(0, Math.min(counting.beats - 1, Math.floor((now - counting.t0) / counting.beatMs)));
    if (k !== counting.shown) {
      counting.shown = k;
      countEl.textContent = String(counting.beats - k);
      countEl.classList.remove('beat');
      void countEl.offsetWidth;
      countEl.classList.add('beat');
    }
  }

  /** What the play button and Space do. */
  function togglePlay(): void {
    if (resultsOn) hideResults();
    if (counting) {
      cancelCountIn();
      return;
    }
    if (session.previewing) {
      session.stopPreview();
      return;
    }
    if (session.running) {
      session.pause();
      openPause();
      return;
    }
    pauseSheet?.close();
    if (session.game.finished) session.reset();
    if (session.options.mode === 'flow' && countInOn) beginCountIn();
    else session.toggle();
  }

  // ---- Pause sheet ----
  function openPause(message?: string): void {
    if (pauseSheet || toolsSheet || currentPhase() !== 'paused') return;
    const resume = h('button', { type: 'button', class: 'primary big wide' }, icon('play'), 'Resume');
    const again = h('button', { type: 'button' }, playerIcon('again'), 'Start again');
    const tools = h('button', { type: 'button' }, icon('settings'), 'Practice tools');
    const leave = link({ screen: 'home' }, 'Leave', { class: 'button quiet' });
    leave.prepend(playerIcon('leave'));
    const where = `${formatTime(Math.max(0, session.game.time))} of ${formatTime(session.game.length)}`;
    resume.addEventListener('click', () => {
      pauseSheet?.close();
      togglePlay();
    });
    again.addEventListener('click', () => {
      pauseSheet?.close();
      session.reset();
      playButton.focus();
    });
    tools.addEventListener('click', () => {
      pauseSheet?.close();
      openTools(true);
    });
    pauseSheet = openSheet({
      labelledBy: 'pause-title',
      className: 'pause-sheet',
      closeLabel: 'Close and stay paused',
      onClose: () => {
        pauseSheet = null;
      },
      content: [
        h('div', { class: 'pause-head' }, h('span', { class: 'pause-badge' }, playerIcon('pause')), h('h2', { id: 'pause-title' }, 'Paused')),
        h('p', { class: 'pause-where' }, message ?? `You are at ${where}.`),
        resume,
        h('div', { class: 'pause-more' }, again, tools, leave),
      ],
    });
    resume.focus();
  }

  // ---- Practice tools sheet ----
  function openTools(fromPause = false): void {
    if (toolsSheet) return;
    pauseSheet?.close();
    toolsBackToPause = fromPause;
    updateLoopButtons();
    toolsSheet = openSheet({
      labelledBy: 'tools-title',
      className: 'tools-sheet',
      content: toolsContent,
      onClose: () => {
        toolsSheet = null;
        if (toolsBackToPause && currentPhase() === 'paused') openPause();
        toolsBackToPause = false;
      },
    });
    // Start at the top with the title in view (focusing Done scrolled the sheet to its end).
    toolsTitle.focus({ preventScroll: true });
    toolsSheet.dialog.scrollTop = 0;
  }

  /** Closes the tools without going back to the pause sheet: the action starts playing. */
  function closeToolsFor(): void {
    toolsBackToPause = false;
    toolsSheet?.close();
    pauseSheet?.close();
  }

  // ---- Practice ----
  function practise(loop: Loop | null, slowly: boolean, message?: string): void {
    if (!loop) {
      say('No mistakes yet, so nothing tricky to practise. Play the song first!', 5000);
      return;
    }
    closeToolsFor();
    if (session.options.mode === 'listen') setMode('wait');
    hideResults();
    coach = slowly ? new TrickyCoach(clampSpeed(settings.get().speed)) : null;
    if (coach) setSpeed(coach.speed, false);
    session.setLoop(loop);
    updateLoopButtons();
    say(message ?? `Looping ${formatTime(loop.start)} to ${formatTime(loop.end)}${coach ? ` at ${Math.round(coach.speed * 100)}% speed` : ''}`, 4000);
    if (!session.running) togglePlay();
  }

  function trickyFrom(mistakes: readonly Mistake[]): Loop | null {
    return trickiest(mistakes, song.notes, passageLength(song));
  }

  // ---- Results ----
  function hideResults(): void {
    resultsPending = false;
    if (!resultsOn) return;
    resultsOn = false;
    resultsEl.hidden = true;
    stopCelebration?.();
    stopCelebration = null;
    updatePhase();
  }

  function histogram(bins: readonly number[]): HTMLElement {
    const max = Math.max(1, ...bins);
    const barsEl = h('div', { class: 'histo-bars' });
    bins.forEach((n, i) => {
      const mid = i === HISTOGRAM_BINS / 2 - 1 || i === HISTOGRAM_BINS / 2;
      barsEl.append(h('span', { class: `histo-bar${mid ? ' is-mid' : ''}`, style: `--h: ${Math.round((n / max) * 100)}%`, title: `${n}` }));
    });
    return h(
      'figure',
      { class: 'histo' },
      h('figcaption', {}, 'Your timing'),
      barsEl,
      h('div', { class: 'histo-axis', 'aria-hidden': 'true' }, h('span', {}, 'Early'), h('span', {}, 'On time'), h('span', {}, 'Late')),
    );
  }

  /** The next song worth trying: the next one of the same kind at about the same level. */
  function nextSong(): { id: string; title: string } | null {
    const all = ctx.library.summaries();
    const at = all.findIndex((x) => x.id === song.id);
    if (at < 0) return null;
    const me = all[at];
    for (let k = 1; k < all.length; k++) {
      const x = all[(at + k) % all.length];
      if (x.source !== me.source || x.needsRecording) continue;
      if (me.difficulty && x.difficulty && Math.abs(x.difficulty - me.difficulty) > 1) continue;
      return { id: x.id, title: x.title };
    }
    return null;
  }

  function praiseFor(percent: number, practice: boolean): string {
    if (practice) return 'Practice run done!';
    if (percent >= 90) return 'Beautifully played!';
    if (percent >= 75) return 'Great playing!';
    if (percent >= 50) return 'Nice work!';
    return 'Good start!';
  }

  function showResults(info: {
    mode: Mode;
    accuracy: number;
    hit: number;
    missed: number;
    wrong: number;
    practice: boolean;
    newBest: boolean;
    firstTime: boolean;
    bestAccuracy: number | null;
    bestScore: number | null;
  }): void {
    const sc = keeper.scorer;
    const mistakes = keeper.mistakes.slice();
    const percent = Math.round(info.accuracy * 100);
    const count = info.practice ? 0 : starsFor(info.accuracy);
    const passages: Passage[] = troublePassages(mistakes, passageLength(song), 3);

    const stars = h('div', { class: 'stars-row', role: 'img', 'aria-label': `${count} of 3 stars` });
    for (let i = 0; i < 3; i++) {
      const s = bigStar(i < count);
      s.style.setProperty('--i', String(i));
      stars.append(s);
    }

    const again = h('button', { type: 'button', class: 'primary big' }, playerIcon('again'), 'Play again');
    again.addEventListener('click', () => {
      hideResults();
      session.reset();
      togglePlay();
    });
    const next = count >= 2 ? nextSong() : null;
    const second = next
      ? link({ screen: 'play', songId: next.id }, 'Next song', { class: 'button big', 'aria-label': `Next song: ${next.title}` })
      : link({ screen: 'home' }, 'Back to songs', { class: 'button big' });
    second.append(icon('forward'));

    let tricky: HTMLElement | string = '';
    if (passages.length > 0) {
      const p = passages[0];
      const go = h('button', { type: 'button', class: 'button-mint' }, 'Practise it');
      go.addEventListener('click', () => {
        const loop = trickyFrom(mistakes);
        session.reset();
        practise(loop, true);
      });
      tricky = h(
        'div',
        { class: 'tricky-card paper' },
        h('span', { class: 'tricky-icon' }, playerIcon('again')),
        h('div', { class: 'tricky-text' }, h('p', { class: 'tricky-title' }, 'Practise the tricky part'), h('p', {}, `${formatTime(p.start)} to ${formatTime(p.end + 1)}, slowly at first.`)),
        go,
      );
    }

    // The details: breakdown, timing chart, every part worth practising.
    const gradeList = h('ul', { class: 'grade-list' });
    if (info.mode === 'flow') {
      for (const g of GRADES) gradeList.append(h('li', { class: `grade-${g}` }, h('b', {}, String(sc.grades[g])), ` ${GRADE_LABEL[g]}`));
      gradeList.append(h('li', { class: 'grade-miss' }, h('b', {}, String(info.missed)), ' Missed'));
    } else {
      gradeList.append(h('li', { class: 'grade-perfect' }, h('b', {}, String(info.hit)), ' Right notes'));
    }
    gradeList.append(h('li', { class: 'grade-wrong' }, h('b', {}, String(info.wrong)), ' Wrong keys'));
    const passageList =
      passages.length > 0
        ? h(
            'div',
            { class: 'passages' },
            h('p', { class: 'passages-title' }, 'Parts to practise'),
            ...passages.map((p) => {
              const b = h('button', { type: 'button', class: 'small' }, 'Practise this');
              const loop = { start: p.start, end: p.end };
              b.addEventListener('click', () => {
                session.reset();
                practise(loopFor(loop, song.notes), true);
              });
              return h('div', { class: 'passage' }, h('span', {}, `${formatTime(p.start)} to ${formatTime(p.end + 1)}`), h('span', { class: 'passage-count' }, `${p.count} ${p.count === 1 ? 'slip' : 'slips'}`), b);
            }),
          )
        : h('p', { class: 'results-clean' }, info.mode === 'flow' ? 'Not a single slip. Wow!' : 'Every note found!');
    let bestLine = '';
    if (info.practice) bestLine = 'Play from the start without jumping around or looping to save a score.';
    else if (info.firstTime) bestLine = 'Your first time playing this song. Now you have a score to beat!';
    else if (info.bestAccuracy !== null) bestLine = `Your best: ${Math.round(info.bestAccuracy * 100)}%${info.bestScore ? ` · ${info.bestScore.toLocaleString()} points` : ''}`;
    const details = h(
      'details',
      { class: 'results-details' },
      h('summary', {}, 'See details'),
      h(
        'div',
        { class: 'results-details-body' },
        h(
          'div',
          { class: 'results-numbers' },
          h('div', {}, h('b', {}, `${percent}%`), h('span', {}, 'right')),
          h('div', {}, h('b', {}, String(sc.bestCombo)), h('span', {}, 'best run in a row')),
        ),
        gradeList,
        info.mode === 'flow' && sc.hits > 0 ? histogram(sc.histogram) : '',
        passageList,
        bestLine ? h('p', { class: 'results-best' }, bestLine) : '',
      ),
    );

    const praise = praiseFor(percent, info.practice);
    resultsBox.dataset.stars = String(count);
    resultsBox.replaceChildren(
      h('div', { class: 'results-hero' }, mascot(count >= 2 ? 'cheer' : 'happy', count >= 2 ? 'results-mascot is-cheering' : 'results-mascot is-bobbing'), stars),
      h('h2', { id: 'player-overlay-title', class: 'results-praise' }, praise),
      h(
        'div',
        { class: 'results-score' },
        h('span', { class: 'results-points' }, sc.score.toLocaleString()),
        h('span', { class: 'results-points-label' }, 'points'),
        info.newBest ? h('span', { class: 'results-best-badge pop' }, icon('star'), 'New best!') : '',
      ),
      h('p', { class: 'results-line' }, `${percent}% of the notes right`),
      h('div', { class: 'results-actions' }, again, second),
      tricky,
      details,
    );
    resultsPending = false;
    resultsOn = true;
    resultsEl.hidden = false;
    resultsEl.scrollTop = 0;
    updatePhase();
    again.focus({ preventScroll: true });
    const quiet = calm();
    if (count === 3) {
      window.setTimeout(() => {
        if (!resultsOn) return;
        stopCelebration = celebrate(stars, { pieces: 44, spread: 280, calm: quiet });
        effects.celebrate?.();
      }, quiet ? 0 : 900);
    } else {
      // Every finished song gets a sound: a fanfare for two stars or a new best, a sparkle otherwise.
      playCheer(count === 2 || info.newBest ? 'medium' : 'small');
      if (info.newBest) effects.celebrate?.();
    }
  }

  async function addRecording(): Promise<void> {
    const file = await pickFile('audio/*');
    if (!file) return;
    try {
      await ctx.library.attachAudio(song.id, file);
      say('Recording added. Press Play to play along with it.');
    } catch (error) {
      console.error(error);
      say('That file did not work. Try an MP3 or WAV file of the same recording.', 5000);
    }
  }

  /**
   * "Split this song": for a song added before splitting existed (or without it). Asks before
   * the one-time download, shows progress in a sheet, and keeps the notes as they are.
   */
  async function splitThisSong(): Promise<void> {
    const { splitterStored } = await import('../split');
    const stored = await splitterStored().catch(() => false);
    const controller = new AbortController();
    const title = h('h2', { id: 'split-title', class: 'tools-title', tabindex: -1 }, 'Split this song?');
    const text = h('p', {}, 'The piano can take the place of the guitars and keys in the recording. You still hear the voice, drums and bass.');
    const where = h('p', { class: 'hint' }, stored ? 'This happens on your device. Nothing is uploaded.' : `This needs a ${SPLIT_DOWNLOAD}. After that, splitting happens on your device and nothing is uploaded.`);
    const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Progress', hidden: true });
    const stage = h('p', { class: 'split-stage', 'aria-live': 'polite' });
    const go = h('button', { type: 'button', class: 'primary wide' }, stored ? 'Split it' : 'Download and split');
    const cancel = h('button', { type: 'button', class: 'quiet wide' }, 'Not now');
    toolsSheet?.close();
    const sheet = openSheet({
      labelledBy: 'split-title',
      className: 'split-sheet',
      content: [title, text, where, stage, bar, go, cancel],
      onClose: () => controller.abort(),
    });
    title.focus({ preventScroll: true });
    cancel.addEventListener('click', () => sheet.close());
    go.addEventListener('click', () => {
      go.hidden = true;
      where.hidden = true;
      cancel.textContent = 'Cancel';
      bar.hidden = false;
      title.textContent = 'Splitting your song';
      const words: Record<string, string> = { downloading: 'Downloading the song splitter...', reading: 'Opening the recording...', splitting: 'Splitting the song...' };
      void splitSong(song, ctx.library, {
        signal: controller.signal,
        onProgress(step, fraction) {
          stage.textContent = words[step] ?? '';
          bar.value = fraction;
        },
      }).then(
        () => {
          if (controller.signal.aborted) return;
          sheet.close();
          if (ctx.settings.get().songSound !== 'off') setSongSound('backing');
          say('Done! The piano now takes the place of the guitars and keys.', 5000);
        },
        (error: unknown) => {
          if (error instanceof Error && error.name === 'Cancelled') return;
          title.textContent = 'That did not work';
          stage.textContent = error instanceof Error && error.message ? error.message : 'The song could not be split. It still plays as before.';
          bar.hidden = true;
          cancel.textContent = 'Close';
          cancel.focus();
        },
      );
    });
  }

  // ---- Waking the chrome (it fades a little while you play) ----
  let idleTimer = 0;
  function wake(): void {
    root.classList.remove('is-idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      const focused = document.activeElement;
      const keyboardInChrome = focused instanceof HTMLElement && chrome.contains(focused) && focused.matches(':focus-visible');
      if (!session.running || keyboardInChrome) return;
      root.classList.add('is-idle');
    }, IDLE_MS);
  }

  // ---- Wiring ----
  const typingInto = (t: EventTarget | null) =>
    t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'range') || (t instanceof HTMLElement && t.isContentEditable);
  /** Space on a focused control that does its own thing (outside the stage) should do that thing. */
  const ownsSpace = (t: EventTarget | null) =>
    t instanceof HTMLElement && t !== playButton && t.matches('button, a, summary, input') && (phase === 'ready' || phase === 'results' || t.closest('dialog') !== null);
  let spaceHandled = false;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !e.repeat && !typingInto(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (ownsSpace(e.target)) return;
      if (toolsSheet) return;
      e.preventDefault();
      spaceHandled = true;
      togglePlay();
      return;
    }
    if (e.key === 'Escape') {
      if (pauseSheet || toolsSheet) return; // the sheet closes itself
      if (counting) cancelCountIn();
      else if (session.previewing) session.stopPreview();
      else if (resultsOn) session.reset();
      else if (session.running || phase === 'paused') {
        // Pause (or, when already paused, bring the pause sheet back). The sheet opens after
        // this key press: opened during it, the browser's own Escape handling would close it again.
        e.preventDefault();
        session.pause();
        window.setTimeout(() => openPause(), 0);
      }
    }
    if (e.key === 'Tab') wake();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' && spaceHandled) {
      e.preventDefault();
      spaceHandled = false;
    }
  };
  const pauseForBreak = (why: string) => {
    session.stopPreview();
    if (session.running || counting) {
      cancelCountIn();
      session.pause();
      openPause(why);
    }
  };
  // No pause on window blur: it also fires when a file picker opens or focus
  // moves into a frame. A hidden page (another tab, a locked screen) is the real signal.
  const onVisibility = () => {
    if (document.hidden) pauseForBreak('Paused while you were away.');
    last = performance.now();
  };
  const onFullscreen = () => {
    const on = document.fullscreenElement === root;
    const word = fullButton.querySelector('span');
    if (word) word.textContent = on ? 'Leave full screen' : 'Full screen';
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('fullscreenchange', onFullscreen);
  root.addEventListener('pointermove', wake);
  root.addEventListener('pointerdown', wake);
  root.addEventListener('focusin', wake);

  const offs: (() => void)[] = [
    session.on('reset', fit),
    session.on('running', ({ running }) => {
      if (running) {
        started = true;
        startMetronome();
      } else {
        ctx.audio.metronome.stop();
      }
      updatePhase();
    }),
    session.on('preview', ({ on }) => {
      showMeButton.lastChild!.textContent = on ? 'Stop' : 'Show me how it goes';
      updatePhase();
      if (!on) say('Your turn!', 1800);
    }),
    session.on('looping', ({ loop }) => {
      if (!loop) coach = null;
      updateLoopButtons();
    }),
    session.on('loop', (pass) => {
      if (!coach) return;
      const step = coach.pass(pass);
      if (step.changed) setSpeed(step.speed, false);
      say(step.message, 3000);
    }),
    session.on('finished', async ({ result, mode, song: finished }) => {
      started = false;
      if (mode === 'listen') {
        updatePhase();
        say('That is how it goes. Now you try!', 3600);
        return;
      }
      resultsPending = true;
      updatePhase();
      const practice = keeper.practised;
      let bestAccuracy: number | null = null;
      let bestScore: number | null = null;
      let newBest = false;
      let firstTime = false;
      if (!practice) {
        try {
          const old = await ctx.store.getProgress(finished.id);
          const oldScore = readBest(await ctx.store.getValue(BEST_KEY(finished.id, mode)));
          const score = keeper.scorer.score;
          const saved = await recordPlay(ctx.store, finished.id, result.accuracy);
          firstTime = !old;
          newBest = Boolean(old && result.accuracy > old.best + 1e-9) || Boolean(oldScore && score > oldScore.score);
          if (!oldScore || score > oldScore.score) {
            await ctx.store.setValue(BEST_KEY(finished.id, mode), { score, combo: Math.max(keeper.scorer.bestCombo, oldScore?.combo ?? 0) });
          }
          bestAccuracy = saved.best;
          bestScore = Math.max(score, oldScore?.score ?? 0);
        } catch {
          // not remembered, still show the result
        }
      }
      if (session.song !== finished || !resultsPending) return;
      showResults({ mode, ...result, practice, newBest, firstTime, bestAccuracy, bestScore });
    }),
    ctx.input.on('down', ({ midi }) => {
      if (counting) return;
      session.press(midi);
    }),
    ctx.input.on('devices', () => {
      const n = ctx.input.devices().length;
      if (n < lastDevices) pauseForBreak('Your piano was unplugged, so we paused. Plug it back in, then press Resume.');
      lastDevices = n;
      refreshKeyLimit();
      showStatus();
    }),
    ctx.sources.pointer.attach(viewHost, (x, y) => view.keyAt?.(x, y) ?? null),
    // A real keyboard turned up on a touch screen: its letters can be shown now.
    onKeyboardSeen(() => {
      letters.field.hidden = false;
      showStatus();
    }),
    ctx.library.subscribe(() => {
      const next = ctx.library.get(song.id);
      if (!next) {
        ctx.navigate({ screen: 'home' });
        return;
      }
      if (next === song) return;
      const sameNotes = next.notes === song.notes && next.audioUrl === song.audioUrl;
      song = next;
      if (sameNotes) {
        // Only the split version of the recording arrived (or a detail changed): keep playing where we are.
        session.song = next;
        describe();
        return;
      }
      describe();
      session.load(song);
    }),
    settings.subscribe((s, changed) => {
      if (changed.includes('view')) {
        view.destroy();
        view = VIEWS[s.view].create(viewHost);
        views.set(s.view);
        root.dataset.view = s.view;
        resize();
      }
      if (changed.includes('latencyMs')) session.inputDelay = s.latencyMs / 1000;
      if (changed.includes('keyLow') || changed.includes('keyHigh')) refreshKeyLimit();
      if (changed.includes('midiOutput')) lights.clear();
      if (changed.includes('metronome')) {
        metronome.input.checked = s.metronome;
        if (s.metronome && session.running) startMetronome();
        else if (!s.metronome) ctx.audio.metronome.stop();
      }
      if (changed.includes('reduceMotion')) root.classList.toggle('is-calm', s.reduceMotion);
      if (changed.includes('showNoteNames')) noteNames.input.checked = s.showNoteNames;
      if (changed.includes('showKeyLetters')) letters.input.checked = s.showKeyLetters;
      if (changed.includes('songSound')) updateSongSound();
    }),
    () => keeper.destroy(),
    exposeForTests('player', {
      session,
      keeper,
      song: () => song,
      /** Where a key is drawn, in page pixels (for tapping the on-screen keys). */
      keyPoint: (midi: number) => {
        const r = view.keyRect?.(midi);
        if (!r) return null;
        const host = viewHost.getBoundingClientRect();
        return { x: host.left + r.x + r.w / 2, y: host.top + r.y + r.h * 0.8 };
      },
    }),
  ];

  for (const b of modeButtons) b.addEventListener('click', () => setMode(b.dataset.mode as Mode));
  for (const b of handButtons) b.addEventListener('click', () => setHands(b.dataset.hands as Hands));
  playButton.addEventListener('click', togglePlay);
  toolsButton.addEventListener('click', () => openTools(false));
  doneButton.addEventListener('click', () => toolsSheet?.close());
  showMeButton.addEventListener('click', () => {
    cancelCountIn();
    if (session.previewing) {
      session.stopPreview();
      return;
    }
    closeToolsFor();
    session.preview(Math.max(3, 4 * session.options.speed));
  });
  fullButton.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    // Close the sheet first: Safari draws the full-screen player over a sheet that was
    // already open, which left an invisible sheet holding the page. A paused song gets its
    // pause sheet back on top once the screen is full.
    closeToolsFor();
    void root
      .requestFullscreen()
      .then(() => {
        if (currentPhase() === 'paused') openPause();
      })
      .catch(() => say('Full screen is not available here.'));
  });
  speedInput.addEventListener('input', () => {
    coach = null;
    setSpeed(Number(speedInput.value) / 100, false);
  });
  speedInput.addEventListener('change', () => setSpeed(Number(speedInput.value) / 100));
  slower.addEventListener('click', () => setSpeed(session.options.speed - SPEED_STEP));
  faster.addEventListener('click', () => setSpeed(session.options.speed + SPEED_STEP));

  loopStartButton.addEventListener('click', () => {
    pendingLoopStart = Math.max(0, session.game.time);
    updateLoopButtons();
    say(`Loop starts at ${formatTime(pendingLoopStart)}. Play on, then press Set loop end.`, 4500);
  });
  loopEndButton.addEventListener('click', () => {
    const end = Math.max(0, session.game.time);
    const start = pendingLoopStart ?? Math.max(0, end - 4);
    if (end - start < 0.5) {
      say('The loop end needs to be after the start. Let the song play on a little first.');
      return;
    }
    pendingLoopStart = null;
    coach = null;
    session.setLoop({ start, end });
    say(`Looping ${formatTime(start)} to ${formatTime(end)}`);
  });
  loopClearButton.addEventListener('click', () => {
    pendingLoopStart = null;
    coach = null;
    session.setLoop(null);
    updateLoopButtons();
    say('Loop off. The song plays on from here.');
  });
  loopMistakeButton.addEventListener('click', () => {
    const t = keeper.lastMistake();
    if (t === null) {
      say('No mistakes to loop yet. Nice!');
      return;
    }
    practise(loopAround(t, song.notes), false);
  });
  trickyButton.addEventListener('click', () => practise(trickyFrom(keeper.mistakes), true));
  countIn.input.addEventListener('change', () => {
    countInOn = countIn.input.checked;
    void ctx.store.setValue(COUNT_IN_KEY, countInOn).catch(() => {});
  });
  metronome.input.addEventListener('change', () => settings.set({ metronome: metronome.input.checked }));
  noteNames.input.addEventListener('change', () => settings.set({ showNoteNames: noteNames.input.checked }));
  letters.input.addEventListener('change', () => settings.set({ showKeyLetters: letters.input.checked }));
  level.addEventListener('change', () => {
    levelHelp.textContent = LEVELS.find((l) => l.level === level.value)?.hint ?? '';
    void rearrange(song, level.value as Level, ctx.library);
  });
  saveButton.addEventListener('click', () => {
    const name = `${song.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'lesson'}.lesson.json`;
    download(name, JSON.stringify(toLesson(song)));
    say('Lesson file saved. Notes only, so it is fine to share.');
  });
  recordingButton.addEventListener('click', () => void addRecording());
  splitButton.addEventListener('click', () => void splitThisSong());

  void ctx.store
    .getValue(COUNT_IN_KEY)
    .then((v) => {
      if (typeof v === 'boolean') {
        countInOn = v;
        countIn.input.checked = v;
      }
    })
    .catch(() => {});
  // The hands and speed last used for this song.
  void ctx.store
    .getValue(CHOICES_KEY(song.id))
    .then((v) => {
      const c = readChoices(v);
      if (!root.isConnected || started || session.running) return;
      if (c.hands && c.hands !== session.options.hands) setHands(c.hands, false);
      if (c.speed !== undefined && c.speed !== session.options.speed) setSpeed(c.speed, false);
    })
    .catch(() => {});

  function refreshKeyLimit(): void {
    const next = keyLimitFor(settings.get(), ctx.sources.midi.connected);
    if (next?.lo === keyLimit?.lo && next?.hi === keyLimit?.hi) return;
    keyLimit = next;
    range = clampRange(rangeFor(song.notes.map((n) => n.midi)));
  }

  // ---- Arriving from the song sheet, where the way to play was just chosen ----
  // The sheet sends `{ kind: 'mode-chosen', songId, mode }` through src/app/handoff.ts.
  const arrival: { kind: string; mode?: unknown } | null = handoff;
  const chosenMode = arrival?.kind === 'mode-chosen' ? MODES.find((m) => m.mode === arrival.mode) : undefined;
  if (chosenMode) {
    if (session.options.mode !== chosenMode.mode) setMode(chosenMode.mode);
    modeChosen.replaceChildren(
      modeArt(chosenMode.mode),
      h('span', { class: 'mode-chosen-text' }, h('span', { class: 'mode-chosen-label' }, chosenMode.label), h('span', { class: 'mode-chosen-hint' }, MODE_WORDS[chosenMode.mode])),
      modeChangeButton,
    );
    modeChangeButton.setAttribute('aria-label', `Change how to play (now ${chosenMode.label})`);
    modeChosen.hidden = false;
    modeGroup.classList.add('is-chosen');
    modeChangeButton.addEventListener('click', () => {
      modeChosen.hidden = true;
      modeGroup.classList.remove('is-chosen');
      modeButtons.find((b) => b.getAttribute('aria-pressed') === 'true')?.focus();
    });
  }

  // ---- A song that was just made, or just saved ----
  if (handoff?.kind === 'imported' && handoff.automatic) {
    const close = h('button', { type: 'button', class: 'icon-button note-close', 'aria-label': 'Got it' }, icon('close'));
    close.addEventListener('click', () => {
      importNote.hidden = true;
      playButton.focus();
    });
    const fix = link({ screen: 'editor', songId: song.id }, 'Fix the notes', { class: 'button small' });
    importNote.replaceChildren(
      h('span', { class: 'note-icon' }, icon('check')),
      h(
        'div',
        { class: 'note-text' },
        h('p', { class: 'stage-note-title' }, 'Your lesson is ready!'),
        h('p', {}, 'We worked out the notes from your recording, so a few may be off.', song.raw ? ' Practice tools can make it easier.' : ''),
        handoff.note ? h('p', { class: 'stage-note-extra' }, handoff.note) : '',
      ),
      fix,
      close,
    );
    importNote.hidden = false;
  } else if (handoff?.kind === 'saved') {
    say('Saved. Here is your changed song.');
  }

  // ---- Size and frames ----
  function resize(): void {
    const rect = viewHost.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    view.resize(rect.width, rect.height, ratio);
    effects.resize(rect.width, rect.height, ratio);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewHost);

  let lettersCache = { baseC: -1, map: NO_LETTERS };
  const lettersFor = (baseC: number) => {
    if (lettersCache.baseC !== baseC) lettersCache = { baseC, map: keyLetters(baseC) };
    return lettersCache.map;
  };

  // Learn mode: after a moment on the same note, a bubble says which key to press.
  let holdSince = 0;
  let hintFor = -1;
  function updateLearnHint(group: readonly number[], now: number, waiting: boolean): void {
    const game = session.game;
    const first = group.length ? group[0] : -1;
    const holding = waiting && first >= 0 && game.notes[first].start - game.time < 0.05;
    if (!holding) {
      holdSince = 0;
      if (!learnHint.hidden) learnHint.hidden = true;
      return;
    }
    if (holdSince === 0) holdSince = now;
    if (now - holdSince < HINT_AFTER_MS) return;
    if (hintFor !== first || learnHint.hidden) {
      hintFor = first;
      const names: string[] = [];
      for (const i of group) {
        const name = noteName(game.notes[i].midi);
        if (!names.includes(name)) names.push(name);
      }
      const letter = state.keyLetters.get(game.notes[first].midi);
      learnHint.replaceChildren(
        h('span', { class: 'learn-hint-word' }, 'Press'),
        h('b', {}, listWords(names)),
        letter && group.length === 1 ? h('span', { class: 'learn-hint-key' }, h('span', { class: 'visually-hidden' }, 'key '), letter) : '',
      );
      learnHint.hidden = false;
    }
  }

  // One frame object and one set, reused every frame so drawing does not allocate.
  const expected = new Set<number>();
  const state: FrameState = {
    song,
    notes: session.game.notes,
    states: session.game.state,
    time: 0,
    length: 0,
    mode: s0.mode,
    hands: firstHands,
    speed: 1,
    running: false,
    expected,
    held: ctx.input.held,
    wrong: null,
    keyLetters: NO_LETTERS,
    range,
    showNoteNames: s0.showNoteNames,
    reduceMotion: s0.reduceMotion,
    now: 0,
    loop: null,
    previewing: false,
  };

  const NO_GROUP: readonly number[] = [];
  let last = performance.now();
  let frameId = 0;
  const frame = (now: number) => {
    frameId = requestAnimationFrame(frame);
    if (document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    tickCountIn(now);
    session.tick(dt);
    // Nothing to draw behind the get-ready page.
    if (phase === 'ready') return;

    const s = settings.get();
    const game = session.game;
    expected.clear();
    const waiting = game.opts.mode === 'wait' && !session.previewing;
    const group = waiting ? game.nextGroup() : NO_GROUP;
    for (const i of group) expected.add(game.notes[i].midi);
    state.song = song;
    state.notes = game.notes;
    state.states = game.state;
    state.time = game.time;
    state.length = game.length;
    state.mode = game.opts.mode;
    state.hands = game.opts.hands;
    state.speed = game.opts.speed;
    state.running = session.running || session.previewing;
    state.held = ctx.input.held;
    state.wrong = game.lastWrong;
    state.keyLetters = s.showKeyLetters && !ctx.sources.midi.connected && computerKeys() ? lettersFor(ctx.sources.keyboard.baseC) : NO_LETTERS;
    state.range = range;
    state.showNoteNames = s.showNoteNames;
    state.reduceMotion = s.reduceMotion;
    state.now = now;
    state.loop = session.loop;
    state.previewing = session.previewing;
    state.keyLimit = keyLimit;
    updateLearnHint(group, now, waiting && session.running);

    // An acoustic piano heard through the microphone makes its own sound.
    session.muteOwnPart = s.micEnabled && ctx.sources.mic.listening;
    if (s.midiOutput) {
      lights.show(
        keysToLight({
          notes: game.notes,
          states: game.state,
          time: game.time,
          mode: game.opts.mode,
          speed: game.opts.speed,
          running: session.running && !session.previewing,
          next: group,
        }),
      );
    } else if (lights.size) {
      lights.clear();
    }
    view.draw(state);
    effects.draw(state, view);
    hud.update(state);
  };

  describe();
  fit();
  resize();
  wake();
  frameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(frameId);
    observer.disconnect();
    window.clearTimeout(idleTimer);
    window.clearTimeout(toastTimer);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    wideLayout.removeEventListener('change', placeSound);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('fullscreenchange', onFullscreen);
    if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
    toolsBackToPause = false;
    toolsSheet?.close();
    pauseSheet?.close();
    stopCelebration?.();
    ctx.audio.metronome.stop();
    lights.clear();
    for (const off of offs) off();
    session.destroy();
    hud.destroy();
    effects.destroy();
    view.destroy();
  };
}
