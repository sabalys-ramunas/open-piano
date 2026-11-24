import type { NoteSink, NoteSource } from './hub';

/** Finds the key under a point given in the element's own CSS pixels. */
export type KeyAt = (x: number, y: number) => number | null;

/** Plays notes from mouse, pen and touch on an on-screen keyboard. */
export class PointerSource implements NoteSource {
  readonly id = 'pointer';
  readonly name = 'Screen';
  readonly connected = true;
  private sink: NoteSink | null = null;
  private pointers = new Map<number, number>();

  start(sink: NoteSink): void {
    this.sink = sink;
  }

  stop(): void {
    for (const midi of this.pointers.values()) this.sink?.up(midi);
    this.pointers.clear();
    this.sink = null;
  }

  /** Makes `element` playable. Returns a function that undoes it. */
  attach(element: HTMLElement, keyAt: KeyAt): () => void {
    const down = (e: PointerEvent) => {
      if (!this.sink) return;
      const rect = element.getBoundingClientRect();
      const midi = keyAt(e.clientX - rect.left, e.clientY - rect.top);
      if (midi === null) return;
      element.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, midi);
      this.sink.down(midi, 0.8);
    };
    const lift = (e: PointerEvent) => {
      const midi = this.pointers.get(e.pointerId);
      if (midi === undefined) return;
      this.pointers.delete(e.pointerId);
      this.sink?.up(midi);
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', lift);
    element.addEventListener('pointercancel', lift);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', lift);
      element.removeEventListener('pointercancel', lift);
      for (const [id, midi] of this.pointers) {
        this.pointers.delete(id);
        this.sink?.up(midi);
      }
    };
  }
}
