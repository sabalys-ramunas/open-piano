/**
 * A celebration burst: stars and confetti fly out from an element (or the
 * middle of the screen) and fade. Use it for real achievements only: a first
 * key from the piano, a finished lesson, three stars, a new streak day.
 *
 * With reduced motion (the system setting, or the app's "Fewer moving
 * effects") the pieces only fade in place, without flying or spinning.
 */

import { playCheer, type CheerSize } from '../audio/cheer';

const COLORS = ['#ffd23f', '#ff7d6e', '#5fe3b8', '#fff7e8', '#8fd3ff'];

export interface CelebrateOptions {
  /** How many pieces. Default 26. */
  pieces?: number;
  /** Travel distance in px. Default 160. */
  spread?: number;
  /** Force the calm version (for example from settings.reduceMotion). */
  calm?: boolean;
  /** The sound to go with it. Default: big for 30 pieces or more, small otherwise. False for none. */
  sound?: CheerSize | false;
}

function prefersCalm(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Starts a burst and returns a function that removes it early. It removes itself when done. */
export function celebrate(from?: Element | null, options: CelebrateOptions = {}): () => void {
  const calm = options.calm ?? prefersCalm();
  const count = calm ? 8 : (options.pieces ?? 26);
  const spread = options.spread ?? 160;
  const sound = options.sound ?? ((options.pieces ?? 26) >= 30 ? 'big' : 'small');
  if (sound) playCheer(sound);
  const rect = from?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;
  const burst = document.createElement('div');
  burst.className = calm ? 'burst burst-calm' : 'burst';
  burst.setAttribute('aria-hidden', 'true');
  burst.style.left = `${x}px`;
  burst.style.top = `${y}px`;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    const star = i % 3 === 0;
    piece.className = star ? 'burst-piece is-star' : 'burst-piece';
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const distance = calm ? 30 + Math.random() * 40 : spread * (0.55 + Math.random() * 0.6);
    const size = star ? 16 + Math.random() * 10 : 8 + Math.random() * 8;
    piece.style.setProperty('--x', `${Math.round(Math.cos(angle) * distance)}px`);
    piece.style.setProperty('--y', `${Math.round(Math.sin(angle) * distance + (calm ? 0 : 40))}px`);
    piece.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 540)}deg`);
    piece.style.setProperty('--s', `${Math.round(size)}px`);
    piece.style.setProperty('--c', COLORS[i % COLORS.length]);
    piece.style.setProperty('--r', i % 2 ? '50%' : '3px');
    piece.style.setProperty('--delay', `${Math.round(Math.random() * 120)}ms`);
    piece.style.setProperty('--d', `${Math.round(900 + Math.random() * 400)}ms`);
    burst.append(piece);
  }
  document.body.append(burst);
  const timer = window.setTimeout(() => burst.remove(), 1700);
  return () => {
    window.clearTimeout(timer);
    burst.remove();
  };
}
