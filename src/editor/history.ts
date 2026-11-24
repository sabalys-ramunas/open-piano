/**
 * Undo and redo for immutable states. Each entry is a whole state, which is
 * cheap because unchanged notes are shared between states.
 *
 * Edits that belong together (typing in one field, pressing an arrow key many
 * times in a row) can share a `group` so one undo takes them all back.
 */
export interface Entry<T> {
  state: T;
  /** What the step that led to this state did, e.g. "Move notes". */
  label: string;
  group?: string;
  at: number;
}

export class History<T> {
  private past: Entry<T>[] = [];
  private future: Entry<T>[] = [];
  private current: Entry<T>;

  constructor(
    initial: T,
    private limit = 500,
    private groupWindowMs = 1500,
  ) {
    this.current = { state: initial, label: '', at: 0 };
  }

  get present(): T {
    return this.current.state;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** What undo would take back, or '' when there is nothing. */
  get undoLabel(): string {
    return this.past.length ? this.current.label : '';
  }

  get redoLabel(): string {
    return this.future.length ? this.future[this.future.length - 1].label : '';
  }

  get size(): number {
    return this.past.length;
  }

  /**
   * Records a new state. Pushing the present state again does nothing. With a
   * `group` equal to the last step's group (and soon after it) the last step
   * is replaced instead of adding a new one.
   */
  push(state: T, label: string, group?: string, now = Date.now()): void {
    if (state === this.current.state) return;
    const merge =
      group !== undefined &&
      this.current.group === group &&
      this.past.length > 0 &&
      this.future.length === 0 &&
      now - this.current.at < this.groupWindowMs;
    if (!merge) {
      this.past.push(this.current);
      if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    }
    this.current = { state, label, group, at: now };
    this.future = [];
  }

  /** Changes the present state without making an undo step (e.g. a name fixed on save). */
  replace(state: T): void {
    this.current = { ...this.current, state };
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ ...this.current, group: undefined });
    this.current = { ...prev, group: undefined };
    return this.current.state;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return this.current.state;
  }

  /** Forgets everything and starts again from `state`. */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.current = { state, label: '', at: 0 };
  }
}
