import type { NoteSink, NoteSource } from './hub';

// Two octaves on a computer keyboard: the bottom letter row plays the lower
// octave and the top row the upper one, with the row above each for black keys.
const LOWER = ['z', 's', 'x', 'd', 'c', 'v', 'g', 'b', 'h', 'n', 'j', 'm'];
const UPPER = ['q', '2', 'w', '3', 'e', 'r', '5', 't', '6', 'y', '7', 'u', 'i', '9', 'o', '0', 'p'];

/** Which computer key plays which note, given the C the bottom row starts on. */
export function keyMap(baseC: number): Map<string, number> {
  const map = new Map<string, number>();
  LOWER.forEach((k, i) => map.set(k, baseC + i));
  UPPER.forEach((k, i) => map.set(k, baseC + 12 + i));
  return map;
}

/** The letter shown on each key: midi to uppercase letter. */
export function keyLetters(baseC: number): Map<number, string> {
  const out = new Map<number, string>();
  for (const [key, midi] of keyMap(baseC)) out.set(midi, key.toUpperCase());
  return out;
}

function typingInto(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Plays notes from the computer keyboard. Ignores keys typed into form fields. */
export class KeyboardSource implements NoteSource {
  readonly id = 'keyboard';
  readonly name = 'Computer keyboard';
  readonly connected = true;
  /** The C the bottom letter row starts on. The player moves it to fit each song. */
  baseC = 60;
  private pressed = new Map<string, number>();
  private sink: NoteSink | null = null;

  private onDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !this.sink) return;
    if (typingInto(e.target)) return;
    const key = e.key.toLowerCase();
    const midi = keyMap(this.baseC).get(key);
    if (midi === undefined) return;
    e.preventDefault();
    this.pressed.set(key, midi);
    this.sink.down(midi, 0.8);
  };

  private onUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const midi = this.pressed.get(key);
    if (midi === undefined) return;
    this.pressed.delete(key);
    this.sink?.up(midi);
  };

  /** Lets go of everything when the window loses focus, so no note gets stuck. */
  private onBlur = () => {
    for (const midi of this.pressed.values()) this.sink?.up(midi);
    this.pressed.clear();
  };

  start(sink: NoteSink): void {
    this.sink = sink;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  stop(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    this.onBlur();
    this.sink = null;
  }
}
