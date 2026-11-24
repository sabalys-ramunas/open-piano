/** Keyboard shortcuts of the editor, as data, so the cheat sheet and the handler never disagree. */

export type Action =
  | 'play'
  | 'toStart'
  | 'delete'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'selectAll'
  | 'deselect'
  | 'up'
  | 'down'
  | 'octaveUp'
  | 'octaveDown'
  | 'left'
  | 'right'
  | 'barLeft'
  | 'barRight'
  | 'shorter'
  | 'longer'
  | 'hand'
  | 'quantise'
  | 'toolAdd'
  | 'toolSelect'
  | 'snap'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'help'
  | 'save'
  | 'loop'
  | 'record'
  | 'nextNote'
  | 'prevNote'
  | 'addNote';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Actions that still work while recording from the computer keyboard (its letters play notes then). */
export const WHILE_RECORDING: ReadonlySet<Action> = new Set(['play', 'toStart', 'deselect', 'undo', 'redo', 'save', 'help']);

/** Which action a key press means, or null. Ctrl and Cmd are treated the same. */
export function actionFor(e: KeyLike): Action | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (e.altKey) return null;
    switch (key) {
      case 'z':
        return e.shiftKey ? 'redo' : 'undo';
      case 'y':
        return 'redo';
      case 'c':
        return 'copy';
      case 'x':
        return 'cut';
      case 'v':
        return 'paste';
      case 'd':
        return 'duplicate';
      case 'a':
        return 'selectAll';
      case 's':
        return 'save';
      default:
        return null;
    }
  }
  switch (key) {
    case ' ':
      return 'play';
    case 'Home':
      return 'toStart';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'Escape':
      return 'deselect';
    case 'ArrowUp':
      return e.shiftKey ? 'octaveUp' : 'up';
    case 'ArrowDown':
      return e.shiftKey ? 'octaveDown' : 'down';
    case 'ArrowLeft':
      return e.shiftKey ? 'barLeft' : 'left';
    case 'ArrowRight':
      return e.shiftKey ? 'barRight' : 'right';
    case '[':
      return 'shorter';
    case ']':
      return 'longer';
    case 'Enter':
      return 'addNote';
    case ',':
      return 'prevNote';
    case '.':
      return 'nextNote';
    case '+':
    case '=':
      return 'zoomIn';
    case '-':
    case '_':
      return 'zoomOut';
    case '?':
      return 'help';
  }
  if (e.altKey || e.shiftKey) return null;
  switch (key) {
    case 'h':
      return 'hand';
    case 'q':
      return 'quantise';
    case 'n':
      return 'toolAdd';
    case 'v':
      return 'toolSelect';
    case 'g':
      return 'snap';
    case '0':
      return 'fit';
    case 'l':
      return 'loop';
    case 'r':
      return 'record';
    default:
      return null;
  }
}

export interface CheatRow {
  keys: string;
  what: string;
}

/** The cheat sheet, grouped. `mod` is "Ctrl" or "Cmd". */
export function cheatSheet(mod: string): { title: string; rows: CheatRow[] }[] {
  return [
    {
      title: 'Mouse and touch',
      rows: [
        { keys: 'Click empty space', what: 'Add a note (Add notes tool) or move the playhead (Select tool)' },
        { keys: 'Drag empty space', what: 'Draw a longer note, or draw a box to select (with Select)' },
        { keys: 'Drag a note', what: 'Move it' },
        { keys: 'Drag a note edge', what: 'Make it longer or shorter' },
        { keys: 'Shift + click', what: 'Add or remove a note from the selection' },
        { keys: 'Shift + drag', what: 'Box select with any tool' },
        { keys: 'Double-click a note', what: 'Delete it (right-click works too)' },
        { keys: 'Alt while dragging', what: 'Ignore the grid' },
        { keys: 'Click the time bar', what: 'Move the playhead' },
        { keys: 'Drag along the time bar', what: 'Mark a part to repeat' },
        { keys: 'Wheel, Shift + wheel', what: 'Scroll up and down, left and right' },
        { keys: `${mod} + wheel, pinch`, what: 'Zoom in and out' },
      ],
    },
    {
      title: 'Playing',
      rows: [
        { keys: 'Space', what: 'Play or pause' },
        { keys: 'Home', what: 'Back to the start' },
        { keys: 'L', what: 'Repeat the marked part on or off' },
        { keys: 'R', what: 'Record from your piano on or off' },
      ],
    },
    {
      title: 'Editing',
      rows: [
        { keys: 'N / V', what: 'Add notes tool / Select tool' },
        { keys: 'Enter', what: 'Add a note at the playhead' },
        { keys: ', and .', what: 'Select the previous or next note' },
        { keys: 'Up / Down', what: 'Move selected notes one key higher or lower' },
        { keys: 'Shift + Up / Down', what: 'Move them a whole octave' },
        { keys: 'Left / Right', what: 'Move them one grid step earlier or later' },
        { keys: 'Shift + Left / Right', what: 'Move them a whole bar' },
        { keys: '[ and ]', what: 'Make them shorter or longer' },
        { keys: 'H', what: 'Switch hands' },
        { keys: 'Q', what: 'Line them up to the grid' },
        { keys: 'G', what: 'Snap to grid on or off' },
        { keys: 'Delete', what: 'Delete selected notes' },
        { keys: `${mod} + A`, what: 'Select everything' },
        { keys: 'Esc', what: 'Clear the selection' },
        { keys: `${mod} + C / X / V`, what: 'Copy, cut, paste at the playhead' },
        { keys: `${mod} + D`, what: 'Duplicate right after' },
        { keys: `${mod} + Z`, what: 'Undo' },
        { keys: `${mod} + Shift + Z`, what: 'Redo' },
        { keys: `${mod} + S`, what: 'Save' },
      ],
    },
    {
      title: 'View',
      rows: [
        { keys: '+ / -', what: 'Zoom in or out' },
        { keys: '0', what: 'Show the whole song' },
        { keys: '?', what: 'Show this list' },
      ],
    },
  ];
}
