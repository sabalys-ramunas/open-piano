/**
 * The app's mascot: a round, sunny musical note with a coral flag, drawn from
 * basic shapes for this app. Use it sparingly: greetings, empty states and
 * celebrations. Never next to a primary button competing for attention.
 * Decorative (aria-hidden): the words around it carry the meaning.
 */

export type MascotMood = 'happy' | 'cheer' | 'curious';

const INK = '#10304a';
const SUN = '#ffd23f';
const CORAL = '#ff7d6e';

function face(mood: MascotMood): string {
  const cheeks = `<ellipse cx="33" cy="84" rx="6" ry="4" fill="${CORAL}" opacity="0.75"/><ellipse cx="71" cy="72" rx="6" ry="4" fill="${CORAL}" opacity="0.75"/>`;
  if (mood === 'cheer') {
    return (
      `<path d="M34 70q5-7 10 0M58 63q5-7 10 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      cheeks +
      `<path d="M44 80q10 4 20-3q-1 14-11 14q-9 0-9-11z" fill="${INK}"/><path d="M48 87q5-4 11-1q-3 5-6 5q-4 0-5-4z" fill="${CORAL}"/>`
    );
  }
  if (mood === 'curious') {
    return (
      `<ellipse cx="40" cy="70" rx="5" ry="6.5" fill="${INK}"/><ellipse cx="63" cy="63" rx="5" ry="6.5" fill="${INK}"/>` +
      `<circle cx="42" cy="67" r="2" fill="#fff"/><circle cx="65" cy="60" r="2" fill="#fff"/>` +
      `<path d="M57 52q6-5 12-2" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>` +
      cheeks +
      `<ellipse cx="54" cy="84" rx="4.5" ry="5" fill="${INK}"/>`
    );
  }
  return (
    `<ellipse cx="40" cy="70" rx="5" ry="6.5" fill="${INK}"/><ellipse cx="63" cy="63" rx="5" ry="6.5" fill="${INK}"/>` +
    `<circle cx="42" cy="67" r="2" fill="#fff"/><circle cx="65" cy="60" r="2" fill="#fff"/>` +
    cheeks +
    `<path d="M45 81q9 6 18-2" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`
  );
}

function arms(mood: MascotMood): string {
  if (mood === 'cheer') {
    return `<path d="M17 72q-10-6-8-20M87 58q10-8 6-22" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  }
  return `<path d="M18 84q-9 2-12 10M86 72q9 4 10 12" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
}

/** The mascot markup on a 120 by 120 box. */
export function mascotMarkup(mood: MascotMood = 'happy'): string {
  return (
    // Stem and flag (the note's tail), behind the head.
    `<path d="M84 64V16" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M84 14c16 4 26 14 22 34c-4-10-12-15-22-15z" fill="${CORAL}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    arms(mood) +
    // Feet.
    `<ellipse cx="38" cy="108" rx="10" ry="5.5" fill="${INK}"/><ellipse cx="66" cy="106" rx="10" ry="5.5" fill="${INK}"/>` +
    // The round note head is the body.
    `<ellipse cx="52" cy="76" rx="38" ry="31" transform="rotate(-16 52 76)" fill="${SUN}" stroke="${INK}" stroke-width="4.5"/>` +
    `<ellipse cx="36" cy="62" rx="9" ry="5" transform="rotate(-30 36 62)" fill="#fff" opacity="0.55"/>` +
    face(mood)
  );
}

export function mascot(mood: MascotMood = 'happy', extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', extraClass ? `mascot ${extraClass}` : 'mascot');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = mascotMarkup(mood);
  return svg;
}
