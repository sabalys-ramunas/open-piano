import type { AppContext } from '../app/context';
import { h } from '../app/dom';
import { setHandoff } from '../app/handoff';
import { LEVELS, SPLIT_DOWNLOAD, SPLIT_OFFER } from '../app/words';
import { FriendlyError, fileKind, importFile, midiTracks, waitingLessonFor, type ImportStage } from '../import';
import type { HandChoice, MidiTrack } from '../import/midifile';
import type { Level } from '../song';

export { ACCEPT } from '../import';

const STAGE_TEXT: Record<ImportStage, string> = {
  reading: 'Opening your file...',
  downloading: 'Downloading the song splitter. This happens only once.',
  splitting: 'Splitting the song into voice, drums, bass and the rest. This happens on your device, and nothing is uploaded.',
  listening: 'Listening to your song and working out the notes. This happens on your device, and nothing is uploaded.',
  analysing: 'Finding the beat and putting your lesson together...',
};

/** What an import will do, for sharing out the progress bar. */
export interface ImportPlan {
  split: boolean;
  download: boolean;
}

/** Where each stage sits on the one progress bar, so it only ever moves forward. */
function stageSpans(plan: ImportPlan): Record<ImportStage, [number, number]> {
  if (!plan.split) {
    return { reading: [0, 0.1], downloading: [0.1, 0.1], splitting: [0.1, 0.1], listening: [0.1, 0.92], analysing: [0.92, 1] };
  }
  // Splitting takes about as long as listening; a download is the rest.
  const a = plan.download ? 0.3 : 0.05;
  const b = a + (0.95 - a) * 0.45;
  return { reading: [0, 0.05], downloading: [0.05, a], splitting: [a, b], listening: [b, 0.95], analysing: [0.95, 1] };
}

/** One overall fraction (0..1) for a stage and its own fraction. */
/** Sound and video files the browser can usually decode (mirrors the list in src/import). */
const MEDIA_EXT = /\.(mp3|wav|wave|ogg|oga|opus|m4a|m4b|aac|flac|webm|weba|mp4|m4v|mov|mkv|avi|wmv|aif|aiff|caf|wma|ape|m4p|aa|aax|amr|3gp)$/i;

function looksLikeMedia(file: { name: string; type: string }): boolean {
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || MEDIA_EXT.test(file.name);
}

export function overallProgress(stage: ImportStage, fraction: number, plan: ImportPlan = { split: false, download: false }): number {
  const [a, b] = stageSpans(plan)[stage];
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return a + (b - a) * f;
}

/** The hands for each track as first suggested. */
export function suggestedHands(tracks: readonly MidiTrack[]): HandChoice {
  return {
    right: tracks.filter((t) => t.suggested === 'right').map((t) => t.index),
    left: tracks.filter((t) => t.suggested === 'left').map((t) => t.index),
  };
}

export interface ImportFlow {
  /** Starts adding a file. Ignored while another file is being added. */
  open(file: File): void;
  readonly busy: boolean;
  destroy(): void;
}

/**
 * The "Add your own song" dialog: asks what it needs to (how much to play for
 * a recording, which tracks for a MIDI file with many), shows progress with a
 * Cancel button, explains problems in plain words, and opens the new song in
 * the player.
 */
export function createImportFlow(ctx: AppContext, host: HTMLElement, onCancelled?: (text: string) => void): ImportFlow {
  let busy = false;
  let controller: AbortController | null = null;
  let returnFocus: HTMLElement | null = null;
  let alive = true;

  const title = h('h2', { id: 'import-title', tabindex: -1 });
  const body = h('div', { class: 'import-body' });
  const card = h('div', { class: 'card import-card' }, title, body);
  const dialog = h('div', { class: 'overlay import-dialog', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'import-title' }, card);
  host.append(dialog);

  let onEscape: (() => void) | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (dialog.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
      return;
    }
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog.
    const items = [...card.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]')].filter((el) => !el.hidden && !(el as HTMLButtonElement).disabled);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  function show(heading: string, ...children: (Node | null)[]): void {
    title.textContent = heading;
    body.replaceChildren(...children.filter((c): c is Node => c !== null));
    if (dialog.hidden) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.hidden = false;
    }
  }

  function close(): void {
    dialog.hidden = true;
    body.replaceChildren();
    onEscape = null;
    busy = false;
    controller = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function button(text: string, kind: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { type: 'button', class: kind }, text);
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Asks how much of a recording to play, and whether to split it (offered only where the device
   * can; the first time it says a download is needed). Resolves null when cancelled.
   */
  function askLevel(file: File, canSplit: boolean): Promise<{ level: Level; split: boolean } | null> {
    return new Promise((resolve) => {
      const name = 'import-level';
      const options = LEVELS.map((l, i) => {
        const input = h('input', { type: 'radio', name, value: l.level, id: `import-level-${l.level}` });
        input.checked = i === 0;
        return h('label', { class: 'level-choice', for: `import-level-${l.level}` }, input, h('span', {}, h('strong', {}, l.label), h('span', { class: 'muted' }, l.hint)));
      });
      const fieldset = h('fieldset', { class: 'level-choices' }, h('legend', {}, 'How much do you want to play?'), ...options);
      const splitBox = h('input', { type: 'checkbox', id: 'import-split', 'aria-describedby': 'import-split-hint' });
      splitBox.checked = ctx.settings.get().splitSongs === 'yes';
      const splitTitle = h('strong', {}, `${SPLIT_OFFER} (${SPLIT_DOWNLOAD})`);
      const splitHint = h('span', { class: 'muted', id: 'import-split-hint' }, 'You hear the voice, drums and bass, and your piano plays the rest. Leave it off to skip.');
      const splitField = h('label', { class: 'level-choice split-choice', for: 'import-split', hidden: !canSplit }, splitBox, h('span', {}, splitTitle, splitHint));
      if (canSplit) {
        // Once the splitter is on this device there is nothing to download.
        void import('../split')
          .then(({ splitterStored }) => splitterStored())
          .then((stored) => {
            if (stored) splitTitle.textContent = SPLIT_OFFER;
          })
          .catch(() => {});
      }
      const finish = (answer: { level: Level; split: boolean } | null) => resolve(answer);
      const go = button('Make my lesson', 'primary', () => {
        const picked = fieldset.querySelector<HTMLInputElement>('input:checked');
        const split = canSplit && splitBox.checked;
        // Remembered, so the next song starts with the same answer.
        if (canSplit) ctx.settings.set({ splitSongs: split ? 'yes' : 'no' });
        finish({ level: (picked?.value as Level | undefined) ?? 'melody', split });
      });
      const cancel = button('Cancel', 'ghost', () => {
        close();
        finish(null);
      });
      onEscape = () => cancel.click();
      show(
        'Make a lesson from your recording',
        h('p', { class: 'import-file' }, file.name),
        fieldset,
        splitField,
        h('p', { class: 'import-promise' }, 'Your recording stays on this device. Nothing is uploaded. You can change this later in the player.'),
        h('div', { class: 'import-actions' }, go, cancel),
      );
      options[0].querySelector('input')?.focus();
    });
  }

  /** Lets the person say which tracks each hand plays. Resolves null when cancelled. */
  function askTracks(tracks: readonly MidiTrack[]): Promise<HandChoice | null> {
    return new Promise((resolve) => {
      const rows = tracks.map((t) => {
        const id = `import-track-${t.index}`;
        const select = h(
          'select',
          { id },
          h('option', { value: 'right' }, 'Right hand'),
          h('option', { value: 'left' }, 'Left hand'),
          h('option', { value: 'none' }, 'Leave out'),
        );
        select.value = t.suggested;
        select.dataset.track = String(t.index);
        const name = t.name || `Track ${t.index + 1}`;
        return h(
          'div',
          { class: 'track-row' },
          h('label', { for: id }, h('strong', {}, name), h('span', { class: 'muted' }, `${t.instrument ? `${t.instrument}, ` : ''}${t.notes} notes`)),
          select,
        );
      });
      const problem = h('p', { class: 'import-problem', role: 'alert' });
      const go = button('Make my lesson', 'primary', () => {
        const right: number[] = [];
        const left: number[] = [];
        for (const sel of body.querySelectorAll<HTMLSelectElement>('select[data-track]')) {
          const index = Number(sel.dataset.track);
          if (sel.value === 'right') right.push(index);
          else if (sel.value === 'left') left.push(index);
        }
        if (right.length + left.length === 0) {
          problem.textContent = 'Choose at least one track for a hand.';
          return;
        }
        resolve({ right, left });
      });
      const cancel = button('Cancel', 'ghost', () => {
        close();
        resolve(null);
      });
      onEscape = () => cancel.click();
      show(
        'Which tracks should you play?',
        h('p', {}, 'This file has several instruments. Pick what each hand plays. We made a guess to start with.'),
        h('div', { class: 'track-list' }, ...rows),
        problem,
        h('div', { class: 'import-actions' }, go, cancel),
      );
      rows[0]?.querySelector('select')?.focus();
    });
  }

  function showError(error: unknown): void {
    const friendly = error instanceof FriendlyError || (error instanceof Error && /^This /.test(error.message));
    // A friendly message is an expected situation (wrong kind of file), not a bug.
    if (friendly) console.info(error instanceof Error ? error.message : error);
    else console.error(error);
    const message =
      friendly && error instanceof Error
        ? error.message
        : 'Try an MP3, M4A, WAV, MIDI or lesson file. Songs with a clear tune work best.';
    const again = button('Try another file', 'primary', () => {
      close();
      host.dispatchEvent(new CustomEvent('import-pick'));
    });
    const done = button('Close', 'ghost', close);
    onEscape = close;
    show('That file did not work', h('p', { class: 'import-message' }, message), h('div', { class: 'import-actions' }, again, done));
    again.focus();
  }

  async function run(file: File): Promise<void> {
    const library = ctx.library;
    const kind = fileKind(file);
    let level: Level | undefined;
    let hands: HandChoice | undefined;
    let split = false;

    // Anything that is not a lesson, MIDI or a sound or video file: say so now, before asking about levels.
    if (kind === 'audio' && !looksLikeMedia(file)) {
      showError(new FriendlyError('That is not a song file. Choose an MP3, M4A, WAV, MIDI or lesson file.'));
      return;
    }

    if (kind === 'audio' && !waitingLessonFor(file, library) && file.size > 0) {
      // Offered only where this device can split songs (and when that code could be loaded).
      const canSplit = await import('../split').then(({ splitSupport }) => splitSupport().ok).catch(() => false);
      const picked = await askLevel(file, canSplit);
      if (!picked) return;
      level = picked.level;
      split = picked.split;
    } else if (kind === 'midi') {
      try {
        const tracks = await midiTracks(file);
        if (tracks.length > 2) {
          const picked = await askTracks(tracks);
          if (!picked) return;
          hands = picked;
        }
      } catch (error) {
        showError(error);
        return;
      }
    }

    controller = new AbortController();
    const signal = controller.signal;
    const text = h('p', { class: 'import-stage', 'aria-live': 'polite' }, STAGE_TEXT.reading);
    const bar = h('progress', { max: 1, value: 0, 'aria-label': 'Progress' });
    const percent = h('span', { class: 'import-percent', 'aria-hidden': 'true' }, '0%');
    const cancel = button('Cancel', 'ghost', () => {
      controller?.abort();
      text.textContent = 'Stopping...';
      cancel.disabled = true;
    });
    onEscape = () => cancel.click();
    show(
      'Adding your song',
      h('p', { class: 'import-file' }, file.name),
      text,
      h('div', { class: 'import-bar' }, bar, percent),
      h('div', { class: 'import-actions' }, cancel),
    );
    cancel.focus();
    let lastStage: ImportStage = 'reading';
    let shown = 0;
    let note: string | undefined;
    const plan: ImportPlan = { split, download: false };
    if (split) {
      try {
        plan.download = !(await (await import('../split')).splitterStored());
      } catch {
        plan.download = true;
      }
    }
    try {
      const song = await importFile(file, library, {
        level,
        hands,
        signal,
        split,
        onNote: (t) => {
          note = t;
        },
        onProgress(stage, fraction) {
          if (stage !== lastStage) {
            lastStage = stage;
            text.textContent = STAGE_TEXT[stage];
          }
          shown = Math.max(shown, overallProgress(stage, fraction, plan));
          bar.value = shown;
          percent.textContent = `${Math.round(shown * 100)}%`;
        },
      });
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'Cancelled' });
      close();
      setHandoff({ kind: 'imported', songId: song.id, automatic: Boolean(song.raw), ...(note ? { note } : {}) });
      if (alive) ctx.navigate({ screen: 'play', songId: song.id });
    } catch (error) {
      if (error instanceof Error && error.name === 'Cancelled') {
        close();
        onCancelled?.('Stopped. Your song was not added.');
        return;
      }
      showError(error);
    }
  }

  return {
    get busy() {
      return busy;
    },
    open(file: File) {
      if (busy) return;
      busy = true;
      void run(file).finally(() => {
        if (dialog.hidden) busy = false;
      });
    },
    destroy() {
      alive = false;
      controller?.abort();
      document.removeEventListener('keydown', onKey);
      dialog.remove();
    },
  };
}
