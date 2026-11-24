// Tiny pieces shared by the page and the worker, kept apart from the network
// code so the page does not load it just for these.

/** The only sample rate the note network accepts. */
export const MODEL_RATE = 22050;

/** Thrown when listening is cancelled. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}
