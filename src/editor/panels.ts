import { h } from '../app/dom';
import { difficultyLabel } from '../app/words';
import type { Difficulty } from '../song';
import { noteName } from '../song';
import type { Problem } from './clean';
import { evenBeats, steadyTempo, type Grid } from './grid';
import type { Meta } from './model';
import { TapTempo } from './tempo';

/**
 * The panels beside the piano roll: song details, clean-up tools and the list
 * of problems. They only build DOM and call back into the editor.
 */

function field(labelText: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = `ed-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const hintEl = hint ? h('small', { class: 'ed-hint', id: `${id}-hint` }, hint) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'field' }, h('label', { for: id }, labelText), input, hintEl);
}

const isFocused = (el: HTMLElement) => document.activeElement === el;


const LICENCES = ['CC0', 'CC BY 4.0', 'CC BY-SA 4.0', 'Public domain'];

/** Splits "a, b,, c" into clean tags (at most 20, each at most 40 letters). */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const t = raw.trim().slice(0, 40);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

export interface DetailsPanel {
  el: HTMLElement;
  update(meta: Readonly<Meta>, grid: Grid): void;
}

/**
 * Song details. `change(patch, group)` makes an undo step; edits to the same
 * field in a row share a group so one undo takes back a whole word.
 */
export function detailsPanel(change: (patch: Partial<Meta>, group: string, label: string) => void, songEnd: () => number): DetailsPanel {
  const title = h('input', { type: 'text', maxlength: 120, autocomplete: 'off' });
  const by = h('input', { type: 'text', maxlength: 120, autocomplete: 'off' });
  const difficulty = h(
    'select',
    {},
    h('option', { value: '' }, 'Not set'),
    ...([1, 2, 3, 4, 5] as Difficulty[]).map((d) => h('option', { value: String(d) }, difficultyLabel(d))),
  );
  const tags = h('input', { type: 'text', maxlength: 400, autocomplete: 'off', placeholder: 'For example: classical, slow, film' });
  const credit = h('input', { type: 'text', maxlength: 500, autocomplete: 'off', placeholder: 'Your name or nickname' });
  const licenceList = h('datalist', { id: 'ed-licences' }, ...LICENCES.map((l) => h('option', { value: l })));
  const licence = h('input', { type: 'text', maxlength: 200, autocomplete: 'off', list: 'ed-licences', placeholder: 'For example: CC BY 4.0' });

  const bpm = h('input', { type: 'number', min: 20, max: 400, step: 0.1, inputmode: 'decimal' });
  const offset = h('input', { type: 'number', min: 0, max: 60, step: 0.01, inputmode: 'decimal' });
  const tsBeats = h('select', {}, ...[2, 3, 4, 5, 6, 7, 9, 12].map((n) => h('option', { value: String(n) }, String(n))));
  const tsUnit = h('select', {}, ...[2, 4, 8].map((n) => h('option', { value: String(n) }, String(n))));
  const gridNote = h('p', { class: 'ed-hint', hidden: true }, 'The beat lines follow the recording. A new tempo makes them steady.');

  const tapper = new TapTempo();
  const tapButton = h('button', { type: 'button', class: 'ed-tap' }, 'Tap the beat');
  const tapResult = h('span', { class: 'ed-tap-result', 'aria-live': 'polite' }, 'Tap along at least 4 times.');
  const useTap = h('button', { type: 'button', hidden: true }, 'Use it');
  let tapped: number | null = null;
  tapButton.addEventListener('click', () => {
    tapped = tapper.tap(performance.now());
    if (tapped === null) {
      tapResult.textContent = tapper.count < 4 ? `Keep tapping (${tapper.count} of 4)` : 'Try tapping more evenly.';
      useTap.hidden = true;
    } else {
      tapResult.textContent = `About ${Math.round(tapped)} beats per minute`;
      useTap.hidden = false;
    }
  });
  useTap.addEventListener('click', () => {
    if (tapped === null) return;
    setTempo(Math.round(tapped), Number(offset.value) || 0);
    tapper.reset();
    useTap.hidden = true;
    tapResult.textContent = 'Tempo set. Tap again to change it.';
  });

  const setTempo = (value: number, first: number) => {
    if (!(value >= 20 && value <= 400)) return;
    const start = Math.max(0, Math.min(60, first));
    change(
      { bpm: Math.round(value * 100) / 100, beats: start > 0 ? evenBeats(value, start, songEnd() + 4 * (60 / value)) : undefined },
      'meta:tempo',
      'Change the tempo',
    );
  };

  title.addEventListener('input', () => change({ title: title.value }, 'meta:title', 'Change the title'));
  by.addEventListener('input', () => change({ by: by.value }, 'meta:by', 'Change who it is by'));
  difficulty.addEventListener('change', () => {
    const d = Number(difficulty.value);
    change({ difficulty: d >= 1 && d <= 5 ? (d as Difficulty) : undefined }, 'meta:difficulty', 'Change the level');
  });
  tags.addEventListener('change', () => {
    const list = parseTags(tags.value);
    change({ tags: list.length ? list : undefined }, 'meta:tags', 'Change the tags');
    tags.value = list.join(', ');
  });
  credit.addEventListener('input', () => change({ credit: credit.value.trim() || undefined }, 'meta:credit', 'Change the credit'));
  licence.addEventListener('input', () => change({ licence: licence.value.trim() || undefined }, 'meta:licence', 'Change the licence'));
  bpm.addEventListener('change', () => setTempo(Number(bpm.value), Number(offset.value) || 0));
  offset.addEventListener('change', () => setTempo(Number(bpm.value), Number(offset.value) || 0));
  const setTs = () => change({ timeSignature: { beats: Number(tsBeats.value), unit: Number(tsUnit.value) } }, 'meta:ts', 'Change the beats in a bar');
  tsBeats.addEventListener('change', setTs);
  tsUnit.addEventListener('change', setTs);

  const el = h(
    'form',
    { class: 'ed-details', 'aria-label': 'Song details' },
    field('Title', title),
    field('Artist or composer', by),
    field('Level', difficulty),
    field('Tags', tags, 'A comma between tags.'),
    field('Made by (credit)', credit, 'Everyone who plays it sees this.'),
    field('Licence', licence, 'An open licence (like CC BY 4.0) lets others share it.'),
    licenceList,
    h('h3', { class: 'ed-subhead' }, 'Tempo and beat'),
    h(
      'div',
      { class: 'ed-row2' },
      field('Tempo (beats per minute)', bpm),
      field('First beat at (seconds)', offset),
    ),
    h('div', { class: 'ed-tapbox' }, tapButton, useTap, tapResult),
    h(
      'div',
      { class: 'ed-row2' },
      field('Beats in a bar', tsBeats),
      field('Beat note', tsUnit, '4 is a quarter note. Most songs: 4 over 4.'),
    ),
    gridNote,
  );
  el.addEventListener('submit', (e) => e.preventDefault());

  return {
    el,
    update(meta, grid) {
      if (!isFocused(title)) title.value = meta.title;
      if (!isFocused(by)) by.value = meta.by;
      difficulty.value = meta.difficulty ? String(meta.difficulty) : '';
      if (!isFocused(tags)) tags.value = (meta.tags ?? []).join(', ');
      if (!isFocused(credit)) credit.value = meta.credit ?? '';
      if (!isFocused(licence)) licence.value = meta.licence ?? '';
      if (!isFocused(bpm)) bpm.value = String(Math.round(grid.bpm * 10) / 10);
      const steady = meta.beats ? steadyTempo(meta.beats) : null;
      if (!isFocused(offset)) offset.value = String(Math.round((meta.beats ? (steady?.offset ?? meta.beats[0]) : grid.offset) * 100) / 100);
      tsBeats.value = String(meta.timeSignature?.beats ?? 4);
      if (!tsBeats.value) tsBeats.value = '4';
      tsUnit.value = String(meta.timeSignature?.unit ?? 4);
      if (!tsUnit.value) tsUnit.value = '4';
      gridNote.hidden = !(meta.beats && meta.beats.length >= 2 && !steady);
    },
  };
}

export type CleanTool = 'tiny' | 'join' | 'split' | 'shift' | 'overlaps' | 'fold' | 'quantise';

export interface CleanParams {
  minDur: number;
  maxGap: number;
  split: number;
  shift: number;
}

export interface CleanPanel {
  el: HTMLElement;
  /** How many notes are selected (0 means the tools work on every note). */
  setScope(count: number): void;
  setResult(text: string): void;
}

export function cleanPanel(run: (tool: CleanTool, params: CleanParams) => void): CleanPanel {
  const scope = h('p', { class: 'ed-scope' });
  const result = h('p', { class: 'status', role: 'status' });
  const minDur = h('input', { type: 'number', min: 0.01, max: 1, step: 0.01, value: '0.08', inputmode: 'decimal' });
  const maxGap = h('input', { type: 'number', min: 0, max: 0.5, step: 0.01, value: '0.05', inputmode: 'decimal' });
  const split = h('select', {});
  for (let m = 36; m <= 84; m++) split.append(h('option', { value: String(m) }, `${noteName(m)}${Math.floor(m / 12) - 1}${m === 60 ? ' (middle C)' : ''}`));
  split.value = '60';
  const shift = h('input', { type: 'number', min: 0.01, max: 10, step: 0.01, value: '0.05', inputmode: 'decimal' });

  const params = (): CleanParams => ({
    minDur: Math.max(0.005, Number(minDur.value) || 0.08),
    maxGap: Math.max(0, Number(maxGap.value) || 0),
    split: Number(split.value) || 60,
    shift: Math.abs(Number(shift.value) || 0),
  });
  const button = (text: string, tool: CleanTool, sign = 1) => {
    const b = h('button', { type: 'button' }, text);
    b.addEventListener('click', () => {
      const p = params();
      run(tool, { ...p, shift: p.shift * sign });
    });
    return b;
  };
  const tool = (heading: string, text: string, ...controls: HTMLElement[]) =>
    h('section', { class: 'ed-tool' }, h('h3', {}, heading), h('p', { class: 'muted' }, text), h('div', { class: 'ed-tool-row' }, ...controls));

  const el = h(
    'div',
    { class: 'ed-clean' },
    scope,
    tool('Remove tiny notes', 'Removes stray notes shorter than:', field('Seconds', minDur), button('Remove', 'tiny')),
    tool('Join broken notes', 'Joins pieces of one note, with a gap up to:', field('Seconds', maxGap), button('Join', 'join')),
    tool('Split the hands', 'Below this key: left hand. The rest: right hand.', field('Key', split), button('Split', 'split')),
    tool(
      'Move notes in time',
      'All a bit early or late? Move them by:',
      field('Seconds', shift),
      button('Earlier', 'shift', -1),
      button('Later', 'shift', 1),
    ),
    tool('Fix overlapping notes', 'Shortens notes that run into the next one.', button('Fix overlaps', 'overlaps')),
    tool('Bring notes onto the piano', 'Moves notes off the keyboard by octaves.', button('Bring them in', 'fold')),
    tool('Line up to the grid', 'Snaps starts and ends to the beat lines.', button('Line up', 'quantise')),
    result,
  );
  return {
    el,
    setScope(count) {
      scope.textContent = count > 0 ? `Works on the ${count} selected note${count === 1 ? '' : 's'}.` : 'Works on all notes. Select some to work on just those.';
    },
    setResult(text) {
      result.textContent = text;
    },
  };
}

export interface ProblemsPanel {
  el: HTMLElement;
  update(problems: readonly Problem[]): void;
}

const clock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

export function problemsPanel(pick: (problem: Problem) => void): ProblemsPanel {
  const summary = h('p', { class: 'ed-scope' });
  const list = h('ul', { class: 'ed-problems' });
  const el = h('div', {}, summary, list);
  let shown: readonly Problem[] = [];
  return {
    el,
    update(problems) {
      if (problems === shown) return;
      shown = problems;
      summary.textContent =
        problems.length === 0
          ? 'No problems. Nice work!'
          : `${problems.length} thing${problems.length === 1 ? '' : 's'} to check (outlined in coral). Tap one to jump there.`;
      const max = 200;
      list.replaceChildren(
        ...problems.slice(0, max).map((p) => {
          const b = h('button', { type: 'button', class: `ed-problem ed-problem-${p.kind}` }, h('span', { class: 'ed-problem-time' }, clock(p.time)), p.message);
          b.addEventListener('click', () => pick(p));
          return h('li', {}, b);
        }),
      );
      if (problems.length > max) list.append(h('li', { class: 'muted' }, `And ${problems.length - max} more.`));
    },
  };
}

/** Accessible tabs: arrow keys move between tabs. */
export function tabs(items: { id: string; label: string; panel: HTMLElement }[]): { el: HTMLElement; setLabel(id: string, label: string): void; show(id: string): void } {
  const list = h('div', { class: 'ed-tabs', role: 'tablist', 'aria-label': 'Editor panels' });
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const show = (id: string, focus = false) => {
    items.forEach((it, i) => {
      const on = it.id === id;
      buttons[i].setAttribute('aria-selected', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
      if (on && focus) buttons[i].focus();
    });
  };
  items.forEach((it, i) => {
    const b = h('button', { type: 'button', role: 'tab', id: `ed-tab-${it.id}`, 'aria-controls': `ed-panel-${it.id}` }, it.label);
    b.addEventListener('click', () => show(it.id));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
      show(next.id, true);
    });
    buttons.push(b);
    list.append(b);
    const panel = h('div', { class: 'ed-panel', role: 'tabpanel', id: `ed-panel-${it.id}`, 'aria-labelledby': b.id, tabindex: 0 }, it.panel);
    panels.push(panel);
  });
  show(items[0].id);
  return {
    el: h('div', { class: 'ed-side' }, list, ...panels),
    setLabel(id, label) {
      const i = items.findIndex((it) => it.id === id);
      if (i >= 0) buttons[i].textContent = label;
    },
    show: (id) => show(id),
  };
}
