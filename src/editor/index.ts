import type { AppContext } from '../app/context';
import { download, h, levelDots, link, notice, pickFile } from '../app/dom';
import { setHandoff } from '../app/handoff';
import { href } from '../app/router';
import type { SongSummary } from '../app/library';
import type { Cleanup } from '../app/screens';
import { exposeForTests } from '../app/test-hook';
import { toLesson } from '../lesson';
import type { Hand, Song } from '../song';
import { noteName, songLength } from '../song';
import { findProblems, fixOverlaps, foldIntoPiano, joinBroken, problemIds, removeShort, shiftTime, splitHands, type Problem } from './clean';
import {
  copyClip,
  deleteNotes,
  duplicate,
  moveNotes,
  neighbour,
  pasteClip,
  quantise,
  resizeNotes,
  selected,
  setHand,
  updateMeta,
  addNotes,
  type Clip,
} from './commands';
import { decodeDraft, draftKey, encodeDraft, sameContent } from './draft';
import { SNAP_OPTIONS, makeGrid, snapTime, stepSeconds, type Grid } from './grid';
import { History } from './history';
import { docFromSong, docLength, makeNote, markEdited, songFromDoc, withDetailsFrom, type Doc, type Meta } from './model';
import { cleanPanel, detailsPanel, problemsPanel, type CleanParams, type CleanTool } from './panels';
import { Recorder, type RecordHand } from './recorder';
import { Roll, type RollState, type Tool } from './roll';
import { WHILE_RECORDING, actionFor, cheatSheet, type Action } from './shortcuts';
import { Transport } from './transport';
import { loadPeaks } from './waveform';
import { songCover } from '../ui/cover-art';
import { icon, type IconName } from '../ui/icons';
import { illustration, type IllustrationName } from '../ui/illustrations';
import { mascot } from '../ui/mascot';
import { openSheet, type Sheet } from '../ui/sheet';
import { shelf } from '../ui/shelf';

/**
 * The lesson editor: fix the notes of a draft (or write a song from scratch),
 * fill in its details, then save it to the library or share it as a lesson
 * file. Called by src/screens/editor.ts with an empty container.
 *
 * The editing itself is pure (model, commands, history, grid, clean); this
 * file wires those to the piano roll, the controls, playback and storage.
 */
export function mountEditor(container: HTMLElement, ctx: AppContext, songId?: string): Cleanup {
  if (!songId) return mountStart(container, ctx);
  const song = ctx.library.get(songId);
  if (song) return mountWorkspace(container, ctx, song, false);

  // The song may still be loading (the song list arrives a moment after start-up).
  const box = notice(
    'empty',
    'Song not found',
    'This song is not in your library. It may have been removed.',
    link({ screen: 'editor' }, 'Pick another song', { class: 'button primary' }),
  );
  container.append(box);
  let inner: Cleanup | null = null;
  const off = ctx.library.subscribe(() => {
    const found = ctx.library.get(songId);
    if (!inner && !found && ctx.library.has(songId)) void ctx.library.ensure(songId);
    if (inner || !found) return;
    box.remove();
    inner = mountWorkspace(container, ctx, found, false);
  });
  return () => {
    off();
    inner?.();
  };
}

/** A fresh id for a song saved from the editor. */
function newSongId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `mine:${Date.now().toString(36)}-${rand}`;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** #/editor without a song: picture cards to start a new song, fix one, or carry on; then the songs to pick from. */
function mountStart(container: HTMLElement, ctx: AppContext): Cleanup {
  let workspace: Cleanup | null = null;
  const startNew = (draftId?: string, resume = false) => {
    root.remove();
    workspace = mountWorkspace(container, ctx, { id: draftId ?? newSongId(), title: 'My new song', by: '', notes: [], source: 'mine' }, true, resume);
  };

  const startCard = (fill: string, art: IllustrationName, title: string, text: string): { el: HTMLButtonElement; text: HTMLElement } => {
    const line = h('span', { class: 'ed-start-text' }, text);
    const el = h(
      'button',
      { type: 'button', class: `ed-start-card ${fill}` },
      illustration(art, 'ed-start-art'),
      h('span', { class: 'ed-start-title' }, title),
      line,
    );
    return { el, text: line };
  };
  const write = startCard('fill-sun', 'write', 'Write a new song', 'Tap in notes, or play them in.');
  write.el.addEventListener('click', () => startNew());
  const fix = startCard('fill-mint', 'fix', 'Fix one of my songs', 'Wrong notes? Move them.');
  const resumeCard = startCard('fill-coral', 'resume', 'Continue where I left off', '');
  resumeCard.el.hidden = true;

  const search = h('input', { type: 'search', id: 'ed-pick-search', placeholder: 'Title or composer', autocomplete: 'off' });
  const picks = h('div', { class: 'ed-picks' });
  fix.el.addEventListener('click', () => {
    pickSection.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    search.focus({ preventScroll: true });
  });

  const card = (s: SongSummary): HTMLElement => {
    const open = h('button', { type: 'button', class: 'pcard-open' }, s.title);
    open.addEventListener('click', () => ctx.navigate({ screen: 'editor', songId: s.id }));
    return h(
      'article',
      { class: 'pcard', 'data-song-id': s.id },
      songCover(s),
      h(
        'div',
        { class: 'pcard-body' },
        h('h3', { class: 'pcard-title' }, open),
        s.difficulty ? h('div', { class: 'pcard-meta' }, levelDots(s.difficulty)) : null,
      ),
    );
  };

  const groups: [string, string, (s: SongSummary) => boolean][] = [
    ['mine', 'My songs', (s) => s.source === 'mine'],
    ['shared', 'Shared songs', (s) => s.source === 'community'],
    ['built-in', 'Comes with the app', (s) => s.source === 'built-in'],
  ];
  let lastKey = '';
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const all = ctx.library.summaries();
    const key = `${q}#${all.map((s) => s.id).join('|')}`;
    if (key === lastKey) return;
    lastKey = key;
    if (q) {
      const found = all.filter((s) => s.title.toLowerCase().includes(q) || s.by.toLowerCase().includes(q));
      picks.replaceChildren(
        found.length
          ? h('ul', { class: 'pcard-grid' }, ...found.map((s) => h('li', {}, card(s))))
          : notice('empty', 'No songs match', 'Try another word.'),
      );
      return;
    }
    const rows = groups
      .map(([id, title, test]) => {
        const songs = all.filter(test);
        return songs.length ? shelf({ id: `ed-${id}`, title, count: String(songs.length), items: songs.map(card) }) : null;
      })
      .filter((x): x is HTMLElement => x !== null);
    picks.replaceChildren(...(rows.length ? rows : [notice('loading', 'Getting the songs ready...')]));
  };
  search.addEventListener('input', render);
  render();
  const off = ctx.library.subscribe(render);

  void ctx.store
    .getValue(draftKey(null))
    .then((value) => {
      const draft = decodeDraft(value);
      if (!draft || workspace) return;
      resumeCard.text.textContent = `"${draft.song.title}", ${when(draft.savedAt)}`;
      resumeCard.el.addEventListener('click', () => startNew(draft.songId.startsWith('mine:') ? draft.songId : undefined, true));
      resumeCard.el.hidden = false;
      cards.classList.add('has-three');
    })
    .catch(() => {});

  const cards = h('div', { class: 'ed-start-cards' }, write.el, fix.el, resumeCard.el);
  const pickSection = h(
    'section',
    { class: 'ed-start-pick', 'aria-labelledby': 'ed-pick-heading' },
    h('div', { class: 'ed-pick-head' }, h('h2', { id: 'ed-pick-heading' }, 'Pick a song to fix'), h('div', { class: 'ed-pick-search' }, icon('search'), h('label', { for: 'ed-pick-search', class: 'visually-hidden' }, 'Find a song to fix'), search)),
    picks,
  );
  const root = h('div', { class: 'ed-start' }, cards, pickSection);
  container.append(root);
  return () => {
    off();
    workspace?.();
    root.remove();
  };
}

const SPEEDS: [string, string][] = [
  ['0.25', '25%'],
  ['0.5', '50%'],
  ['0.75', '75%'],
  ['1', '100%'],
];

function clock(t: number): string {
  const m = Math.floor(Math.max(0, t) / 60);
  const s = Math.max(0, t) - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const keyLabel = (midi: number) => `${noteName(midi)}${Math.floor(midi / 12) - 1}`;

function typingInto(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** The editor itself. `isNew` is a song that is not in the library yet. */
function mountWorkspace(container: HTMLElement, ctx: AppContext, initial: Song, isNew: boolean, resume = false): Cleanup {
  const offs: (() => void)[] = [];
  let base: Song = initial;
  let songId = initial.id;
  let inLibrary = !isNew;
  let isBuiltIn = initial.source === 'built-in';
  let draftName = draftKey(isNew ? null : songId);
  let pendingAudio: File | null = null;
  let localAudioUrl: string | null = null;

  const history = new History<Doc>(docFromSong(initial));
  let savedDoc: Doc = history.present;
  let clip: Clip | null = null;
  let lastSnap = 1 / 4;

  const state: RollState = {
    doc: history.present,
    selection: new Set(),
    tool: 'add',
    snap: 1 / 4,
    grid: makeGrid(history.present.meta),
    playhead: 0,
    loop: null,
    loopOn: false,
    peaks: null,
    problems: new Set(),
    held: ctx.input.held,
    live: [],
    length: Math.max(songLength(initial), 10),
    noteLen: null,
  };
  let problems: Problem[] = [];
  let problemsDirty = true;
  let gridFor: Readonly<Meta> = history.present.meta;
  let newHand: RecordHand = 'auto';

  const transport = new Transport({ instrument: () => ctx.audio.instrument });
  transport.setSpeed(1);
  transport.setNotes(state.doc.notes);

  // ---------- DOM ----------
  // Simple by default: the roll, a small dock of big buttons, and Save. Everything else lives in
  // clearly named sheets behind "More tools"; nothing was removed.
  const status = h('p', { class: 'ed-status', 'aria-live': 'polite' });
  const saveState = h('span', { class: 'ed-savestate', 'aria-live': 'polite' });
  const btn = (text: string, title: string, onClick: () => void, cls = '') => {
    const b = h('button', { type: 'button', title, class: cls || null }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const toggle = (text: string, title: string, onClick: () => void) => {
    const b = btn(text, title, onClick, 'ed-toggle');
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  const press = (b: HTMLButtonElement, on: boolean) => b.setAttribute('aria-pressed', String(on));
  /** A big dock button: an icon over a short word. */
  const dockBtn = (name: IconName, text: string, title: string, onClick: () => void, cls = '') => {
    const b = h('button', { type: 'button', title, class: `ed-dock-btn${cls ? ` ${cls}` : ''}` }, icon(name), h('span', { class: 'ed-dock-label' }, text));
    b.addEventListener('click', onClick);
    return b;
  };

  const saveButton = h('button', { type: 'button', class: 'primary ed-save', title: 'Save into your songs (Ctrl or Cmd + S)' }, icon('check'), 'Save');
  saveButton.addEventListener('click', () => void save(false));
  const saveAsButton = btn('Save as new', 'Keep the original and save this as a new song', () => void save(true));
  const exportButton = btn('Download lesson file', 'A file you can share. The recording is not included.', () => exportLesson());
  const audioButton = btn('Add the recording', 'Pick the audio file this song belongs to, to see and hear it behind the notes', () => void addRecording());
  const playSongButton = btn('Try it in the player', 'Save and open this song in the player', () => void saveAndPlay());

  const playButton = dockBtn('play', 'Play', 'Play or pause (Space)', () => togglePlay(), 'ed-play');
  const startButton = btn('To start', 'Back to the start (Home)', () => seek(0, true));
  const timeText = h('span', { class: 'ed-time', 'aria-label': 'Playhead position' }, '0:00.0');
  const speed = h('select', { id: 'ed-speed' }, ...SPEEDS.map(([v, t]) => h('option', { value: v }, t)));
  speed.value = '1';
  speed.addEventListener('change', () => transport.setSpeed(Number(speed.value)));
  const loopButton = toggle('Repeat part', 'Repeat the marked part (L). Drag along the time bar to mark it.', () => run('loop'));
  const recordButton = toggle('Record', 'Play on your piano or computer keyboard to add notes in time (R)', () => {
    run('record');
    if (recording) sheet?.close();
  });
  recordButton.classList.add('ed-record', 'big');
  recordButton.prepend(icon('record'));
  const recordHand = h(
    'select',
    { id: 'ed-record-hand' },
    h('option', { value: 'auto' }, 'Hands by key'),
    h('option', { value: 'right' }, 'Right hand'),
    h('option', { value: 'left' }, 'Left hand'),
  );
  const clickButton = toggle('Click', 'Hear a click on every beat', () => {
    clickOn = !clickOn;
    press(clickButton, clickOn);
    syncMetronome();
  });
  const notesSound = toggle('Notes sound', 'Hear the notes while playing', () => {
    transport.playNotes = !transport.playNotes;
    press(notesSound, transport.playNotes);
  });
  press(notesSound, true);
  const recSound = toggle('Recording sound', 'Hear the original recording while playing', () => {
    recordingAudible = !recordingAudible;
    transport.setRecordingVolume(recordingAudible ? 1 : 0);
    press(recSound, recordingAudible);
  });
  let recordingAudible = true;
  press(recSound, true);
  const followButton = toggle('Follow', 'Scroll along with the playhead', () => {
    follow = !follow;
    press(followButton, follow);
  });
  let follow = true;
  let clickOn = false;
  press(followButton, true);

  const toolButtons = (['add', 'select'] as Tool[]).map((t) => {
    const b = dockBtn(t === 'add' ? 'plus' : 'pointer', t === 'add' ? 'Add' : 'Select', t === 'add' ? 'Tap to add notes (N)' : 'Drag a box to select notes (V)', () => setTool(t));
    b.dataset.tool = t;
    return b;
  });
  const toolGroup = h('div', { class: 'ed-dock-group', role: 'group', 'aria-label': 'Tool' }, ...toolButtons);
  const handSelect = h(
    'select',
    { id: 'ed-new-hand' },
    h('option', { value: 'auto' }, 'Hand by key'),
    h('option', { value: 'right' }, 'Right hand'),
    h('option', { value: 'left' }, 'Left hand'),
  );
  handSelect.addEventListener('change', () => (newHand = handSelect.value as RecordHand));
  const snapSelect = h('select', { id: 'ed-snap' }, ...SNAP_OPTIONS.map((o) => h('option', { value: String(o.step) }, o.step === 0 ? 'Off' : o.label)));
  snapSelect.value = String(state.snap);
  snapSelect.addEventListener('change', () => setSnap(Number(snapSelect.value)));

  const undoButton = dockBtn('undo', 'Undo', 'Undo (Ctrl or Cmd + Z)', () => run('undo'));
  const redoButton = dockBtn('redo', 'Redo', 'Redo (Ctrl or Cmd + Shift + Z)', () => run('redo'));
  const deleteButton = dockBtn('trash', 'Delete', 'Delete selected notes (Delete)', () => run('delete'));
  const handButton = btn('Switch hand', 'Move selected notes to the other hand (H)', () => run('hand'));
  const rightButton = btn('Right hand', 'Put selected notes in the right hand', () => assignHand('right'), 'ed-hand-right');
  const leftButton = btn('Left hand', 'Put selected notes in the left hand', () => assignHand('left'), 'ed-hand-left');
  const quantiseButton = btn('Line up', 'Line selected notes up to the grid (Q)', () => run('quantise'));
  const copyButton = btn('Copy', 'Copy (Ctrl or Cmd + C)', () => run('copy'));
  const pasteButton = btn('Paste', 'Paste at the playhead (Ctrl or Cmd + V)', () => run('paste'));
  const dupButton = btn('Duplicate', 'Copy right after the selection (Ctrl or Cmd + D)', () => run('duplicate'));
  const zoomOut = h('button', { type: 'button', class: 'icon-button', title: 'Zoom out (-)', 'aria-label': 'Zoom out' }, icon('zoomOut'));
  zoomOut.addEventListener('click', () => run('zoomOut'));
  const zoomIn = h('button', { type: 'button', class: 'icon-button', title: 'Zoom in (+)', 'aria-label': 'Zoom in' }, icon('zoomIn'));
  zoomIn.addEventListener('click', () => run('zoomIn'));
  const keysOut = btn('Smaller keys', 'Make key rows smaller', () => roll.zoomKeys(0.8), 'small');
  const keysIn = btn('Bigger keys', 'Make key rows bigger', () => roll.zoomKeys(1.25), 'small');
  const fitButton = btn('Whole song', 'Show the whole song (0)', () => run('fit'), 'small');
  const zoomPop = h('div', { class: 'ed-zoom-pop', id: 'ed-zoom-pop', role: 'group', 'aria-label': 'Zoom', hidden: true }, zoomOut, fitButton, zoomIn, keysOut, keysIn);
  const zoomButton = dockBtn('zoomIn', 'Zoom', 'Zoom in and out', () => {
    const open = zoomPop.hidden;
    zoomPop.hidden = !open;
    zoomButton.setAttribute('aria-expanded', String(open));
  });
  zoomButton.setAttribute('aria-expanded', 'false');
  zoomButton.setAttribute('aria-controls', 'ed-zoom-pop');
  const moreButton = h('button', { type: 'button', class: 'ed-more', 'aria-haspopup': 'dialog' }, icon('tools'), h('span', { class: 'ed-more-label' }, 'More tools'));
  moreButton.addEventListener('click', () => openTools('menu'));

  const recStop = h('button', { type: 'button', class: 'button-coral small' }, 'Stop recording');
  recStop.addEventListener('click', () => setRecording(false));
  const recText = h('span', {});
  const recHint = h('div', { class: 'ed-rec-hint', hidden: true, role: 'status' }, icon('record'), recText, recStop);
  const restoreBar = h('div', { class: 'ed-restore', hidden: true, role: 'region', 'aria-label': 'Unsaved changes' });
  const selInfo = h('span', { class: 'ed-selinfo' });

  const rollHost = h('div', { class: 'ed-roll' });

  const details = detailsPanel(
    (patch, group, label) => commit(updateMeta(history.present, patch), label, undefined, group),
    () => state.length,
  );
  const clean = cleanPanel((tool, params) => runClean(tool, params));
  const probs = problemsPanel((p) => {
    sheet?.close();
    setSelection(new Set(p.ids));
    const n = history.present.notes.find((x) => x.id === p.ids[0]);
    roll.reveal(p.time, n?.midi);
    seek(p.time, false);
    roll.canvas.focus({ preventScroll: true });
  });

  // Shortcut cheat sheet.
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';
  const helpGrid = h(
    'div',
    { class: 'ed-help-grid' },
    ...cheatSheet(mod).map((g) =>
      h('section', {}, h('h3', {}, g.title), h('dl', {}, ...g.rows.flatMap((r) => [h('dt', {}, h('kbd', {}, r.keys)), h('dd', {}, r.what)]))),
    ),
    h('p', { class: 'ed-help-touch' }, 'Two fingers on a touch screen scroll and zoom.'),
  );

  // ---------- "More tools": a menu of sheets ----------
  type ToolSheet = 'menu' | 'play' | 'record' | 'notes' | 'clean' | 'problems' | 'details' | 'file' | 'help';
  let sheet: Sheet | null = null;
  let sheetKind: ToolSheet | null = null;
  let problemCount = 0;
  const labelled = (text: string, control: HTMLElement) => h('div', { class: 'field' }, h('label', { for: control.id }, text), control);
  const TOOLS: { id: Exclude<ToolSheet, 'menu'>; title: string; icon: IconName; text: string; body: () => (Node | null)[] }[] = [
    {
      id: 'play',
      title: 'Playing',
      icon: 'play',
      text: 'Speed, repeat, click',
      body: () => [
        h('div', { class: 'ed-sheet-row' }, startButton, labelled('Speed', speed)),
        h('div', { class: 'ed-sheet-toggles' }, loopButton, clickButton, notesSound, recSound, followButton),
        h('p', { class: 'ed-sheet-hint' }, 'Drag along the time bar to mark a part to repeat.'),
      ],
    },
    {
      id: 'record',
      title: 'Record',
      icon: 'record',
      text: 'Play notes in on your piano',
      body: () => [
        h('p', { class: 'ed-sheet-hint' }, 'Play along on your piano or computer keys. Your notes land in time.'),
        labelled('Recorded notes go to', recordHand),
        recordButton,
      ],
    },
    {
      id: 'notes',
      title: 'Notes and hands',
      icon: 'pointer',
      text: 'Hands, snap, copy and paste',
      body: () => [
        h('div', { class: 'ed-sheet-row' }, labelled('New notes go to', handSelect), labelled('Snap to grid', snapSelect)),
        h('p', { class: 'ed-sheet-sub' }, 'Selected notes'),
        h('div', { class: 'ed-sheet-toggles' }, rightButton, leftButton, handButton, quantiseButton),
        h('div', { class: 'ed-sheet-toggles' }, copyButton, pasteButton, dupButton),
      ],
    },
    { id: 'clean', title: 'Clean up', icon: 'tools', text: 'Tidy stray and broken notes', body: () => [clean.el] },
    { id: 'problems', title: 'Problems', icon: 'info', text: 'Things worth a check', body: () => [probs.el] },
    { id: 'details', title: 'Song details', icon: 'edit', text: 'Title, level, tempo', body: () => [details.el] },
    {
      id: 'file',
      title: 'Save and share',
      icon: 'download',
      text: 'A copy, a file, the recording',
      body: () => [h('div', { class: 'ed-sheet-list' }, playSongButton, saveAsButton, exportButton, audioButton)],
    },
    { id: 'help', title: 'Shortcuts', icon: 'keyboard', text: 'Keys and tips', body: () => [helpGrid] },
  ];

  function openTools(kind: ToolSheet): void {
    sheet?.close();
    zoomPop.hidden = true;
    zoomButton.setAttribute('aria-expanded', 'false');
    // A sheet's close event arrives a moment later; only forget it if it is still the current one.
    let mine: Sheet | null = null;
    const done = () => {
      if (sheet !== mine) return;
      sheet = null;
      sheetKind = null;
    };
    if (kind === 'menu') {
      const tiles = TOOLS.map((t) => {
        const label = t.id === 'problems' && problemCount ? `Problems (${problemCount})` : t.title;
        const b = h('button', { type: 'button', class: 'ed-tool-tile', 'data-tool-sheet': t.id }, icon(t.icon), h('span', { class: 'ed-tool-title' }, label), h('span', { class: 'ed-tool-text' }, t.text));
        b.addEventListener('click', () => openTools(t.id));
        return b;
      });
      sheet = mine = openSheet({ labelledBy: 'ed-tools-title', className: 'ed-sheet', onClose: done, content: [h('h2', { id: 'ed-tools-title' }, 'More tools'), h('div', { class: 'ed-tool-tiles' }, ...tiles)] });
      sheetKind = 'menu';
      tiles[0]?.focus();
      return;
    }
    const tool = TOOLS.find((t) => t.id === kind)!;
    const back = h('button', { type: 'button', class: 'quiet small ed-sheet-back' }, icon('back'), 'All tools');
    back.addEventListener('click', () => openTools('menu'));
    const title = tool.id === 'problems' && problemCount ? `Problems (${problemCount})` : tool.title;
    sheet = mine = openSheet({
      labelledBy: `ed-sheet-title-${kind}`,
      className: `ed-sheet ed-sheet-${kind}`,
      onClose: done,
      content: [back, h('h2', { id: `ed-sheet-title-${kind}` }, title), ...tool.body()],
    });
    sheetKind = kind;
    sheet.dialog.querySelector<HTMLElement>('.sheet-body > :not(.sheet-close):not(.ed-sheet-back) button:not(:disabled), .sheet-body input, .sheet-body select')?.focus();
  }

  // ---------- First-time coach mark ----------
  const coachOk = h('button', { type: 'button', class: 'primary small' }, 'Got it');
  const coach = h(
    'div',
    { class: 'ed-coach', role: 'note', 'aria-label': 'Tip', hidden: true },
    mascot('happy', 'ed-coach-mascot'),
    h('p', {}, h('strong', {}, 'Tap to add a note.'), ' Drag to move it.'),
    coachOk,
  );
  const COACH_KEY = 'editor:coached';
  const dismissCoach = () => {
    if (coach.hidden) return;
    coach.hidden = true;
    void ctx.store.setValue(COACH_KEY, true).catch(() => {});
  };
  coachOk.addEventListener('click', dismissCoach);
  void ctx.store
    .getValue(COACH_KEY)
    .then((seen) => {
      if (seen !== true && !destroyed) coach.hidden = false;
    })
    .catch(() => {});

  const legend = h(
    'span',
    { class: 'ed-legend' },
    h('span', { class: 'ed-legend-right' }, 'Right hand'),
    h('span', { class: 'ed-legend-left' }, 'Left hand'),
  );
  const titleLine = h('p', { class: 'ed-songtitle' });
  const dock = h(
    'div',
    { class: 'ed-dock', role: 'toolbar', 'aria-label': 'Editing' },
    toolGroup,
    h('span', { class: 'ed-sep', 'aria-hidden': 'true' }),
    deleteButton,
    undoButton,
    redoButton,
    h('span', { class: 'ed-sep', 'aria-hidden': 'true' }),
    playButton,
    zoomButton,
  );
  container.append(
    h(
      'div',
      { class: 'editor' },
      h('div', { class: 'ed-file' }, h('div', { class: 'ed-file-title' }, titleLine, saveState), h('div', { class: 'ed-file-actions' }, moreButton, saveButton)),
      restoreBar,
      recHint,
      h('div', { class: 'ed-stage' }, rollHost, coach, h('div', { class: 'ed-dock-wrap' }, zoomPop, dock)),
      h('div', { class: 'ed-under' }, legend, timeText, selInfo, status),
    ),
  );

  const roll = new Roll(rollHost, {
    state,
    commit: (doc, label, sel) => commit(doc, label, sel),
    setSelection: (ids) => setSelection(ids),
    seek: (t) => seek(t, false),
    setLoop: (loop) => {
      state.loop = loop;
      state.loopOn = true;
      syncLoop();
    },
    sound: (midi) => {
      if (transport.playing) return;
      ctx.audio.instrument.wake();
      ctx.audio.instrument.play(midi, 0.35, 0.7);
    },
    handFor: (midi) => handFor(midi, newHand),
  });

  // ---------- state changes ----------
  function handFor(midi: number, choice: RecordHand): Hand {
    if (choice !== 'auto') return choice;
    return midi < 60 ? 'left' : 'right';
  }

  const dirty = () => history.present !== savedDoc;

  /** Everything that depends on the document. */
  function applyDoc(doc: Doc): void {
    state.doc = doc;
    transport.setNotes(doc.notes);
    if (doc.meta !== gridFor) {
      gridFor = doc.meta;
      state.grid = makeGrid(doc.meta);
      syncMetronome();
    }
    const alive = new Set(doc.notes.map((n) => n.id));
    for (const id of state.selection) if (!alive.has(id)) state.selection.delete(id);
    problemsDirty = true;
    updateLength();
    roll.requestDraw();
    refreshUi();
    scheduleDraft();
  }

  function commit(doc: Doc, label: string, select?: Iterable<number>, group?: string): void {
    if (roll.dragging && !select) roll.cancelDrag();
    if (doc === history.present) {
      if (select) setSelection(new Set(select));
      return;
    }
    history.push(doc, label, group);
    if (/^(Add a note|Move a note|Move notes)$/.test(label)) dismissCoach();
    if (select) state.selection = new Set(select);
    applyDoc(doc);
  }

  function setSelection(ids: Set<number>): void {
    state.selection = ids;
    roll.requestDraw();
    refreshUi();
  }

  function setTool(t: Tool): void {
    state.tool = t;
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    roll.requestDraw();
  }

  function setSnap(step: number): void {
    state.snap = step;
    if (step !== 0) lastSnap = step;
    snapSelect.value = String(step);
    roll.requestDraw();
  }

  function updateLength(): void {
    state.length = Math.max(10, docLength(state.doc.notes), transport.recordingLength, state.peaks?.duration ?? 0);
    // While recording there is no end: the song grows as you play.
    transport.end = recording ? 0 : Math.max(docLength(state.doc.notes), transport.recordingLength) + 1;
  }

  function seek(t: number, reveal: boolean): void {
    transport.seek(t);
    state.playhead = transport.time;
    if (reveal) roll.reveal(state.playhead);
    roll.requestDraw();
    updateTime();
  }

  function syncLoop(): void {
    transport.loop = state.loop;
    transport.loopOn = state.loopOn && state.loop !== null;
    press(loopButton, transport.loopOn);
    roll.requestDraw();
  }

  function syncMetronome(): void {
    const m = ctx.audio.metronome;
    const want = transport.playing && (clickOn || (recording && !transport.hasRecording && clickOnForRecording));
    if (m.running) m.stop();
    if (!want) return;
    const g: Grid = state.grid;
    m.start({ bpm: g.bpm, beats: g.beats ?? undefined, beatsPerBar: g.beatsPerBar, songTime: () => transport.now(), speed: () => Number(speed.value) || 1 });
  }

  let lastTime = '';
  function updateTime(): void {
    const text = `${clock(state.playhead)} / ${clock(state.length)}`;
    if (text !== lastTime) {
      lastTime = text;
      timeText.textContent = text;
    }
  }

  function describeSelection(): string {
    const sel = selected(state.doc, state.selection);
    if (sel.length === 0) return `${state.doc.notes.length} notes. None selected.`;
    if (sel.length === 1) {
      const n = sel[0];
      return `${keyLabel(n.midi)}, ${n.hand} hand, at ${clock(n.start)}, ${n.dur.toFixed(2)} seconds long.`;
    }
    const lo = Math.min(...sel.map((n) => n.midi));
    const hi = Math.max(...sel.map((n) => n.midi));
    return `${sel.length} notes selected, ${keyLabel(lo)} to ${keyLabel(hi)}.`;
  }

  function refreshUi(): void {
    const hasSel = state.selection.size > 0;
    for (const b of [deleteButton, handButton, rightButton, leftButton, copyButton, dupButton]) b.disabled = !hasSel;
    quantiseButton.disabled = state.doc.notes.length === 0;
    pasteButton.disabled = !clip;
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
    undoButton.title = history.canUndo ? `Undo: ${history.undoLabel} (${mod} + Z)` : 'Nothing to undo';
    redoButton.title = history.canRedo ? `Redo: ${history.redoLabel} (${mod} + Shift + Z)` : 'Nothing to redo';
    selInfo.textContent = describeSelection();
    clean.setScope(state.selection.size);
    details.update(state.doc.meta, state.grid);
    const title = state.doc.meta.title.trim() || 'Untitled';
    titleLine.replaceChildren(h('strong', {}, title), state.doc.meta.by.trim() ? ` · ${state.doc.meta.by.trim()}` : '');
    exportButton.disabled = state.doc.notes.length === 0;
    audioButton.hidden = Boolean(base.audioUrl || localAudioUrl);
    recSound.hidden = !transport.hasRecording;
    updateSaveState();
  }

  let draftWritten = false;
  function updateSaveState(): void {
    let text: string;
    if (!dirty()) text = inLibrary ? 'All changes saved' : 'Not saved yet';
    else if (!ctx.store.persistent) text = 'Not saved (this window forgets on close)';
    else text = draftWritten ? 'Not saved yet, kept for now' : 'Not saved yet';
    if (isBuiltIn && dirty()) text += '. Save makes your own copy';
    saveState.textContent = text;
    saveState.classList.toggle('is-dirty', dirty());
  }

  function say(text: string): void {
    status.textContent = text;
  }

  // ---------- drafts ----------
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleDraft(): void {
    draftWritten = false;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => void writeDraft(), 1200);
  }

  async function writeDraft(): Promise<void> {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = null;
    const key = draftName;
    try {
      if (!dirty()) {
        await ctx.store.setValue(key, null);
        return;
      }
      await ctx.store.setValue(key, encodeDraft(currentSong()));
      draftWritten = true;
      updateSaveState();
    } catch (error) {
      console.warn('The draft could not be kept.', error);
    }
  }

  function currentSong(): Song {
    return songFromDoc(history.present, { ...base, id: songId });
  }

  void ctx.store
    .getValue(draftName)
    .then((value) => {
      const draft = decodeDraft(value);
      if (!draft || destroyed) return;
      if (!isNew && draft.songId !== songId) return;
      if (sameContent(draft.song, songFromDoc(savedDoc, base))) return;
      const bringBack = () => {
        restoreBar.hidden = true;
        const doc = docFromSong(withDetailsFrom(base, draft.song));
        commit(doc, 'Bring back unsaved changes');
        roll.fit();
        say('Your unsaved changes are back.');
      };
      if (resume) {
        bringBack();
        return;
      }
      const restore = btn('Bring them back', 'Restore the changes you did not save', bringBack, 'primary');
      const discard = btn('Throw them away', 'Forget the unsaved changes', () => {
        restoreBar.hidden = true;
        void ctx.store.setValue(draftName, null).catch(() => {});
        say('Unsaved changes thrown away.');
      });
      restoreBar.replaceChildren(h('p', {}, `Unsaved changes from ${when(draft.savedAt)}.`), restore, discard);
      restoreBar.hidden = false;
    })
    .catch(() => {});

  // ---------- saving ----------
  let saving = false;
  async function save(asNew: boolean): Promise<Song | null> {
    if (saving) return null;
    saving = true;
    try {
      let doc = history.present;
      let song = markEdited(songFromDoc(doc, { ...base, id: songId }), inLibrary ? ctx.library.get(songId) : undefined);
      if (asNew || isBuiltIn || !inLibrary) {
        const id = asNew || isBuiltIn ? newSongId() : songId;
        if (asNew || isBuiltIn) {
          const original = isBuiltIn ? base.title : ctx.library.get(songId)?.title;
          if (song.title === original) {
            const renamed = `${song.title} (${isBuiltIn ? 'my version' : 'copy'})`;
            doc = updateMeta(doc, { title: renamed });
            history.replace(doc);
            state.doc = doc;
            song = { ...song, title: renamed };
          }
        }
        let audio: Blob | undefined = pendingAudio ?? undefined;
        if (!audio && base.audioUrl) {
          try {
            audio = await (await fetch(base.audioUrl)).blob();
          } catch {
            audio = undefined;
          }
        }
        const fresh: Song = { ...song, id, source: 'mine' };
        delete fresh.audioUrl;
        const added = await ctx.library.add(fresh, audio ? { audio } : {});
        const oldKey = draftName;
        songId = id;
        base = added;
        inLibrary = true;
        isBuiltIn = false;
        pendingAudio = null;
        draftName = draftKey(id);
        void ctx.store.setValue(oldKey, null).catch(() => {});
        if (added.audioUrl) useAudio(added.audioUrl);
        // Keep the editor (and its undo history) open on the saved song.
        window.history.replaceState(null, '', href({ screen: 'editor', songId: id }));
      } else {
        await ctx.library.update(song);
        base = ctx.library.get(songId) ?? song;
        if (pendingAudio) {
          base = await ctx.library.attachAudio(songId, pendingAudio);
          pendingAudio = null;
        }
      }
      savedDoc = history.present;
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = null;
      void ctx.store.setValue(draftName, null).catch(() => {});
      restoreBar.hidden = true;
      refreshUi();
      const saved = base;
      const play = h('a', { href: href({ screen: 'play', songId: saved.id }), class: 'button small' }, 'Play it');
      play.addEventListener('click', () => setHandoff({ kind: 'saved', songId: saved.id }));
      status.replaceChildren(asNew ? `Saved as a new song: "${song.title}". ` : `Saved "${song.title}". `, play);
      return base;
    } catch (error) {
      console.error(error);
      say('Saving did not work. Your changes are still here. Try again, or download a lesson file.');
      return null;
    } finally {
      saving = false;
    }
  }

  async function saveAndPlay(): Promise<void> {
    if (history.present.notes.length === 0) {
      say('Add some notes first.');
      return;
    }
    const song = dirty() || !inLibrary ? await save(false) : base;
    if (!song) return;
    setHandoff({ kind: 'saved', songId: song.id });
    ctx.navigate({ screen: 'play', songId: song.id });
  }

  function exportLesson(): void {
    const song = currentSong();
    if (song.notes.length === 0) {
      say('Add some notes first. A lesson file needs at least one note.');
      return;
    }
    const name = `${song.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'lesson'}.lesson.json`;
    download(name, JSON.stringify(toLesson(song)));
    const dropped = history.present.notes.length - song.notes.length;
    say(dropped > 0 ? `Lesson file downloaded. ${dropped} note${dropped === 1 ? ' was' : 's were'} off the piano and left out.` : 'Lesson file downloaded. Share it with anyone.');
  }

  // ---------- recording (audio) ----------
  let peaksFor: string | null = null;
  function useAudio(url: string | null | undefined): void {
    transport.setAudio(url);
    transport.setRecordingVolume(recordingAudible ? 1 : 0);
    if (!url || url === peaksFor) {
      refreshUi();
      return;
    }
    peaksFor = url;
    state.peaks = null;
    void loadPeaks(url).then((peaks) => {
      if (destroyed || peaksFor !== url) return;
      state.peaks = peaks;
      updateLength();
      roll.requestDraw();
      updateTime();
    });
    refreshUi();
  }

  async function addRecording(): Promise<void> {
    const file = await pickFile('audio/*');
    if (!file) return;
    try {
      if (inLibrary && !isBuiltIn) {
        const withAudio = await ctx.library.attachAudio(songId, file);
        const next: Song = { ...withAudio, recording: { name: file.name, bytes: file.size } };
        await ctx.library.update(next);
        base = ctx.library.get(songId) ?? next;
        useAudio(base.audioUrl);
      } else {
        pendingAudio = file;
        if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
        localAudioUrl = URL.createObjectURL(file);
        base = { ...base, recording: { name: file.name, bytes: file.size } };
        useAudio(localAudioUrl);
      }
      say('Recording added. Its shape is drawn behind the notes.');
    } catch (error) {
      console.error(error);
      say('That file did not work. Try an MP3 or WAV file.');
    }
  }

  // ---------- playing and recording notes ----------
  let recording = false;
  const clickOnForRecording = true;
  let take: Recorder | null = null;
  let keyboardWasStopped = false;

  function togglePlay(): void {
    if (transport.playing) transport.pause();
    else {
      transport.setNotes(state.doc.notes);
      transport.play();
    }
  }

  transport.onState = () => {
    playButton.replaceChildren(icon(transport.playing ? 'pause' : 'play'), h('span', { class: 'ed-dock-label' }, transport.playing ? 'Pause' : 'Play'));
    playButton.classList.toggle('is-playing', transport.playing);
    if (transport.playing && recording && !take) take = new Recorder(recordHand.value as RecordHand);
    if (!transport.playing) finishTake();
    syncMetronome();
  };

  function finishTake(): void {
    if (!take) return;
    const notes = take.finish(transport.now() - latency());
    take = null;
    state.live = [];
    if (notes.length) {
      commit(addNotes(history.present, notes), notes.length === 1 ? 'Record a note' : 'Record notes', notes.map((n) => n.id));
      say(`Recorded ${notes.length} note${notes.length === 1 ? '' : 's'}.`);
    }
    roll.requestDraw();
  }

  const latency = () => ctx.settings.get().latencyMs / 1000;

  function setRecording(on: boolean): void {
    if (on === recording) return;
    recording = on;
    updateLength();
    press(recordButton, on);
    if (on) {
      // The computer keyboard's letters play notes only while recording; otherwise they are shortcuts.
      const baseC = Math.max(24, Math.min(84, Math.floor(roll.centreMidi() / 12) * 12 - 12));
      ctx.sources.keyboard.baseC = baseC;
      void ctx.input.start('keyboard');
      recText.textContent = `Recording. Play your piano, or Z (${keyLabel(baseC)}) and Q (${keyLabel(baseC + 12)}) on the keyboard.`;
      recHint.hidden = false;
      if (!transport.playing) togglePlay();
      else take = new Recorder(recordHand.value as RecordHand);
    } else {
      ctx.input.stop('keyboard');
      recHint.hidden = true;
      if (transport.playing) transport.pause();
      finishTake();
    }
    syncMetronome();
  }

  offs.push(
    // Tapping the key strip plays (and records) like a real keyboard.
    ctx.sources.pointer.attach(roll.canvas, (x, y) => roll.keyAt(x, y)),
    ctx.input.on('down', ({ midi }) => {
      if (take && transport.playing) {
        take.down(midi, transport.now() - latency());
      }
      roll.requestDraw();
    }),
    ctx.input.on('up', ({ midi }) => {
      if (take) {
        take.up(midi, transport.now() - latency());
        state.live = [...take.notes];
      }
      roll.requestDraw();
    }),
  );

  // Letters are editing shortcuts here, so the computer keyboard does not play notes until recording.
  if (ctx.input.get('keyboard')) {
    ctx.input.stop('keyboard');
    keyboardWasStopped = true;
  }

  // ---------- actions ----------
  function nudgeSeconds(t: number): number {
    return state.snap === 0 ? 0.02 : stepSeconds(state.grid, t, state.snap);
  }

  function selectionOrAll(): Set<number> {
    return state.selection.size ? state.selection : new Set(state.doc.notes.map((n) => n.id));
  }

  function assignHand(hand: Hand): void {
    if (!state.selection.size) return;
    commit(setHand(history.present, state.selection, hand), hand === 'right' ? 'Put notes in the right hand' : 'Put notes in the left hand');
    say(`${state.selection.size} note${state.selection.size === 1 ? '' : 's'} in the ${hand} hand.`);
  }

  function pickNote(dir: 1 | -1): void {
    const current = [...state.selection].pop() ?? null;
    const n = neighbour(history.present, current, dir);
    if (!n) {
      say('There are no notes yet. Press Enter to add one at the playhead.');
      return;
    }
    setSelection(new Set([n.id]));
    roll.reveal(n.start, n.midi);
    ctx.audio.instrument.wake();
    ctx.audio.instrument.play(n.midi, Math.min(0.6, n.dur), 0.7);
    say(describeSelection());
  }

  function run(action: Action): void {
    const doc = history.present;
    const sel = state.selection;
    const first = selected(doc, sel)[0];
    switch (action) {
      case 'play':
        togglePlay();
        return;
      case 'toStart':
        seek(state.loopOn && state.loop ? state.loop.start : 0, true);
        return;
      case 'delete': {
        if (!sel.size) return;
        const count = sel.size;
        commit(deleteNotes(doc, sel), count === 1 ? 'Delete a note' : 'Delete notes', []);
        say(`Deleted ${count} note${count === 1 ? '' : 's'}.`);
        return;
      }
      case 'undo':
      case 'redo': {
        const label = action === 'undo' ? history.undoLabel : history.redoLabel;
        roll.cancelDrag();
        const next = action === 'undo' ? history.undo() : history.redo();
        if (!next) {
          say(action === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
          return;
        }
        applyDoc(next);
        say(`${action === 'undo' ? 'Undone' : 'Redone'}: ${label}.`);
        return;
      }
      case 'copy':
      case 'cut': {
        const c = copyClip(doc, sel);
        if (!c) return;
        clip = c;
        if (action === 'cut') commit(deleteNotes(doc, sel), 'Cut notes', []);
        refreshUi();
        say(`${action === 'cut' ? 'Cut' : 'Copied'} ${c.notes.length} note${c.notes.length === 1 ? '' : 's'}. Paste puts them at the playhead.`);
        return;
      }
      case 'paste': {
        if (!clip) {
          say('Copy some notes first.');
          return;
        }
        const at = Math.max(0, snapTime(state.grid, state.playhead, state.snap));
        const r = pasteClip(doc, clip, at);
        commit(r.doc, 'Paste notes', r.ids);
        roll.reveal(at);
        say(`Pasted ${r.ids.size} note${r.ids.size === 1 ? '' : 's'}.`);
        return;
      }
      case 'duplicate': {
        if (!sel.size) return;
        const r = duplicate(doc, sel, state.grid, state.snap);
        commit(r.doc, 'Duplicate notes', r.ids);
        const firstNew = selected(r.doc, r.ids)[0];
        if (firstNew) roll.reveal(firstNew.start);
        return;
      }
      case 'selectAll':
        setSelection(new Set(doc.notes.map((n) => n.id)));
        say(describeSelection());
        return;
      case 'deselect':
        if (recording) {
          setRecording(false);
          return;
        }
        if (sheet) return;
        setSelection(new Set());
        return;
      case 'up':
      case 'down':
      case 'octaveUp':
      case 'octaveDown': {
        if (!sel.size) {
          say('Select some notes first. Press full stop to pick the next note.');
          return;
        }
        const d = action === 'up' ? 1 : action === 'down' ? -1 : action === 'octaveUp' ? 12 : -12;
        const next = moveNotes(doc, sel, 0, d);
        commit(next, 'Change pitch', undefined, `pitch:${[...sel].join()}`);
        const moved = selected(next, sel)[0];
        if (moved) {
          roll.reveal(moved.start, moved.midi);
          if (sel.size === 1) {
            ctx.audio.instrument.wake();
            ctx.audio.instrument.play(moved.midi, 0.3, 0.7);
          }
          say(describeSelection());
        }
        return;
      }
      case 'left':
      case 'right':
      case 'barLeft':
      case 'barRight': {
        if (!first) {
          // Nothing selected: move the playhead instead.
          const step = action === 'left' || action === 'right' ? nudgeSeconds(state.playhead) : stepSeconds(state.grid, state.playhead, -1);
          seek(Math.max(0, state.playhead + (action === 'left' || action === 'barLeft' ? -step : step)), true);
          return;
        }
        const step = action === 'left' || action === 'right' ? nudgeSeconds(first.start) : stepSeconds(state.grid, first.start, -1);
        const dt = action === 'left' || action === 'barLeft' ? -step : step;
        const next = moveNotes(doc, sel, dt, 0);
        commit(next, 'Move notes in time', undefined, `time:${[...sel].join()}`);
        const moved = selected(next, sel)[0];
        if (moved) roll.reveal(moved.start);
        say(describeSelection());
        return;
      }
      case 'shorter':
      case 'longer': {
        if (!first) return;
        const step = nudgeSeconds(first.start);
        commit(resizeNotes(doc, sel, action === 'shorter' ? -step : step, 'end'), 'Change note length', undefined, `length:${[...sel].join()}`);
        say(describeSelection());
        return;
      }
      case 'hand':
        if (!sel.size) return;
        commit(setHand(doc, sel, 'swap'), 'Switch hands');
        say(describeSelection());
        return;
      case 'quantise': {
        const ids = selectionOrAll();
        const step = state.snap === 0 ? 1 / 4 : state.snap;
        const next = quantise(doc, ids, state.grid, step);
        commit(next, 'Line up to the grid');
        say(next === doc ? 'Already lined up.' : `Lined up ${state.selection.size ? 'the selected' : 'all'} notes to the grid.`);
        return;
      }
      case 'toolAdd':
        setTool('add');
        say('Add notes: click or tap to add a note.');
        return;
      case 'toolSelect':
        setTool('select');
        say('Select: drag a box around notes.');
        return;
      case 'snap':
        setSnap(state.snap === 0 ? lastSnap : 0);
        say(state.snap === 0 ? 'Snap to grid is off.' : 'Snap to grid is on.');
        return;
      case 'zoomIn':
      case 'zoomOut': {
        const visible = state.playhead >= roll.view.t0 && state.playhead <= roll.view.t0 + roll.view.width / roll.view.pxPerSec;
        roll.zoomBy(action === 'zoomIn' ? 1.25 : 0.8, visible ? state.playhead : undefined);
        return;
      }
      case 'fit':
        roll.fit();
        return;
      case 'help':
        if (sheetKind !== 'help') openTools('help');
        return;
      case 'save':
        void save(false);
        return;
      case 'loop': {
        if (!state.loop || (sel.size && !state.loopOn)) {
          const notes = selected(doc, sel);
          if (notes.length) {
            state.loop = { start: Math.min(...notes.map((n) => n.start)), end: Math.max(...notes.map((n) => n.start + n.dur)) };
          } else {
            const t = state.playhead;
            state.loop = { start: t, end: t + stepSeconds(state.grid, t, -1) * 2 };
          }
          state.loopOn = true;
        } else {
          state.loopOn = !state.loopOn;
        }
        syncLoop();
        say(state.loopOn ? `Repeating ${clock(state.loop.start)} to ${clock(state.loop.end)}.` : 'Repeat is off.');
        return;
      }
      case 'record':
        setRecording(!recording);
        return;
      case 'nextNote':
        pickNote(1);
        return;
      case 'prevNote':
        pickNote(-1);
        return;
      case 'addNote': {
        const t = Math.max(0, snapTime(state.grid, state.playhead, state.snap));
        const midi = first?.midi ?? 60;
        const note = makeNote(midi, t, state.noteLen ?? stepSeconds(state.grid, t, 1), handFor(midi, newHand));
        commit(addNotes(doc, [note]), 'Add a note', [note.id]);
        roll.reveal(t, midi);
        ctx.audio.instrument.wake();
        ctx.audio.instrument.play(midi, 0.3, 0.7);
        say(`Added ${describeSelection()}`);
        return;
      }
    }
  }

  function runClean(tool: CleanTool, p: CleanParams): void {
    const doc = history.present;
    const scope = state.selection.size ? state.selection : null;
    let next = doc;
    let text = '';
    switch (tool) {
      case 'tiny': {
        const r = removeShort(doc, p.minDur, scope);
        next = r.doc;
        text = r.count ? `Removed ${r.count} tiny note${r.count === 1 ? '' : 's'}.` : 'No notes were that short.';
        commit(next, 'Remove tiny notes');
        break;
      }
      case 'join': {
        const r = joinBroken(doc, p.maxGap, scope);
        next = r.doc;
        text = r.count ? `Joined ${r.count} broken piece${r.count === 1 ? '' : 's'}.` : 'Nothing needed joining.';
        commit(next, 'Join broken notes');
        break;
      }
      case 'split': {
        const r = splitHands(doc, p.split, scope);
        next = r.doc;
        text = r.count ? `Moved ${r.count} note${r.count === 1 ? '' : 's'} to the other hand.` : 'The hands were already split there.';
        commit(next, 'Split the hands');
        break;
      }
      case 'shift': {
        const r = shiftTime(doc, p.shift, scope);
        next = r.doc;
        text = r.dt ? `Moved ${r.dt < 0 ? 'earlier' : 'later'} by ${Math.abs(r.dt).toFixed(2)} seconds.` : 'Notes cannot move earlier than the start.';
        commit(next, 'Move notes in time', undefined, 'clean:shift');
        break;
      }
      case 'overlaps': {
        const r = fixOverlaps(doc, scope);
        next = r.doc;
        text = r.count ? `Fixed ${r.count} overlapping note${r.count === 1 ? '' : 's'}.` : 'No overlapping notes.';
        commit(next, 'Fix overlapping notes');
        break;
      }
      case 'fold': {
        const r = foldIntoPiano(doc);
        next = r.doc;
        text = r.count ? `Brought ${r.count} note${r.count === 1 ? '' : 's'} onto the piano.` : 'Every note is on the piano already.';
        commit(next, 'Bring notes onto the piano');
        break;
      }
      case 'quantise':
        run('quantise');
        return;
    }
    clean.setResult(text);
    say(text);
  }

  // ---------- keyboard ----------
  const onKey = (e: KeyboardEvent) => {
    // Ask the page, not our own bookkeeping: a sheet's close event lands a moment after it shuts.
    if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
    const target = e.target;
    if (target instanceof Node && !container.contains(target) && target !== document.body && target !== document.documentElement) return;
    const action = actionFor(e);
    if (!action) return;
    if (typingInto(target)) {
      if (action === 'save') {
        e.preventDefault();
        run('save');
      }
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && target instanceof HTMLElement && target.closest('button, a, summary, [role="tab"]')) return;
    if (recording && !WHILE_RECORDING.has(action)) return;
    e.preventDefault();
    run(action);
  };
  window.addEventListener('keydown', onKey);
  offs.push(() => window.removeEventListener('keydown', onKey));

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!dirty()) return;
    void writeDraft();
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  offs.push(() => window.removeEventListener('beforeunload', onBeforeUnload));
  const onHide = () => {
    if (document.visibilityState === 'hidden' && dirty()) void writeDraft();
  };
  document.addEventListener('visibilitychange', onHide);
  offs.push(() => document.removeEventListener('visibilitychange', onHide));

  offs.push(
    ctx.library.subscribe(() => {
      if (!inLibrary) return;
      const next = ctx.library.get(songId);
      if (!next || next === base) return;
      const urlChanged = next.audioUrl !== base.audioUrl;
      base = next;
      if (urlChanged && !localAudioUrl) useAudio(next.audioUrl);
      refreshUi();
    }),
  );

  // ---------- frames ----------
  let destroyed = false;
  let frameId = 0;
  let recLen = 0;
  const frame = () => {
    if (transport.recordingLength !== recLen) {
      // The recording's length is known once the browser has read the file.
      recLen = transport.recordingLength;
      updateLength();
      updateTime();
      roll.requestDraw();
    }
    if (transport.playing) {
      transport.tick();
      state.playhead = transport.time;
      if (take) state.live = [...take.notes];
      if (follow && !roll.dragging) roll.follow(state.playhead);
      roll.requestDraw();
      updateTime();
    }
    if (problemsDirty) {
      problemsDirty = false;
      problems = findProblems(state.doc.notes);
      state.problems = problemIds(problems);
      probs.update(problems);
      problemCount = problems.length;
      const tile = sheetKind === 'menu' ? sheet?.dialog.querySelector('[data-tool-sheet="problems"] .ed-tool-title') : null;
      if (tile) tile.textContent = problemCount ? `Problems (${problemCount})` : 'Problems';
      roll.requestDraw();
    }
    const held = ctx.input.held;
    if (held.size !== state.held.size || [...held].some((m) => !state.held.has(m))) {
      state.held = held;
      roll.requestDraw();
    }
    roll.frame();
    frameId = requestAnimationFrame(frame);
  };

  setTool(state.tool);
  useAudio(base.audioUrl);
  updateLength();
  refreshUi();
  updateTime();
  roll.fit();
  frameId = requestAnimationFrame(frame);
  offs.push(
    exposeForTests('editor', {
      get notes() {
        return history.present.notes;
      },
      get selection() {
        return [...state.selection];
      },
      get playing() {
        return transport.playing;
      },
      point: (time: number, midi: number) => roll.screenPoint(time, midi),
      get view() {
        return { ...roll.view };
      },
    }),
  );
  if (isNew) say('Tap the grid to add notes.');
  else if (base.recording && !base.audioUrl) say(`Made for "${base.recording.name}". Add it in More tools to hear it.`);

  return () => {
    destroyed = true;
    cancelAnimationFrame(frameId);
    if (dirty()) void writeDraft();
    else if (draftTimer) clearTimeout(draftTimer);
    if (take) finishTake();
    if (ctx.audio.metronome.running) ctx.audio.metronome.stop();
    for (const off of offs) off();
    transport.destroy();
    roll.destroy();
    sheet?.close();
    if (keyboardWasStopped || recording) void ctx.input.start('keyboard');
    if (localAudioUrl) {
      const url = localAudioUrl;
      // The saved copy has its own URL; this one is only for the unsaved recording.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    container.replaceChildren();
  };
}
