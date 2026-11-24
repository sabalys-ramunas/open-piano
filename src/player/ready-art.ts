/**
 * Small pictures for the play screen: the three ways to play, the hands
 * toggle, and a few icons the shared set does not have (pause, again, leave,
 * turn the phone). Drawn for this app from basic shapes; markup is constant
 * and never built from data. All decorative (aria-hidden): the button
 * holding a picture carries the words.
 */
import type { Hands, Mode } from './game';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#10304a';
const CREAM = '#fff8ec';
const SUN = '#ffd23f';
const CORAL = '#ff7d6e';
const SKY = '#8fd3ff';
const MINT = '#5fe3b8';
/** Hand colours, the same as the falling notes, so the toggle teaches them. */
const RIGHT = '#5aa9ff';
const LEFT = '#ffa24a';

function svg(viewBox: string, markup: string, className: string): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('class', className);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.innerHTML = markup;
  return el;
}

const MODE_ART: Record<Mode, string> = {
  // Headphones with notes floating out.
  listen:
    `<rect width="120" height="90" rx="22" fill="${SKY}"/>` +
    `<circle cx="98" cy="20" r="26" fill="#b5e3ff"/>` +
    `<path d="M34 58V48a26 26 0 0 1 52 0v10" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<rect x="24" y="50" width="18" height="28" rx="8" fill="${CORAL}" stroke="${INK}" stroke-width="5"/>` +
    `<rect x="78" y="50" width="18" height="28" rx="8" fill="${CORAL}" stroke="${INK}" stroke-width="5"/>` +
    `<path d="M98 30v-14l10-3v12" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="95" cy="31" r="5" fill="${SUN}" stroke="${INK}" stroke-width="3.5"/><circle cx="105" cy="27" r="5" fill="${SUN}" stroke="${INK}" stroke-width="3.5"/>` +
    `<path d="M16 26v-12" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="13" cy="27" r="5" fill="${CREAM}" stroke="${INK}" stroke-width="3.5"/>`,
  // Piano keys with the next one glowing and a pointer above it.
  wait:
    `<rect width="120" height="90" rx="22" fill="${MINT}"/>` +
    `<circle cx="18" cy="16" r="24" fill="#8cf0cf"/>` +
    `<rect x="14" y="40" width="92" height="40" rx="9" fill="${INK}"/>` +
    `<rect x="19" y="44" width="16" height="32" rx="5" fill="${CREAM}"/><rect x="37" y="44" width="16" height="32" rx="5" fill="${CREAM}"/>` +
    `<rect x="55" y="44" width="16" height="32" rx="5" fill="${SUN}"/><rect x="73" y="44" width="16" height="32" rx="5" fill="${CREAM}"/>` +
    `<rect x="91" y="44" width="11" height="32" rx="5" fill="${CREAM}"/>` +
    `<rect x="31" y="44" width="9" height="18" rx="3" fill="${INK}"/><rect x="49" y="44" width="9" height="18" rx="3" fill="${INK}"/><rect x="85" y="44" width="9" height="18" rx="3" fill="${INK}"/>` +
    `<path d="M63 12v16M55 21l8 8 8-8" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Notes racing along a wave with speed lines.
  flow:
    `<rect width="120" height="90" rx="22" fill="${CORAL}"/>` +
    `<circle cx="104" cy="78" r="28" fill="#ff9a8d"/>` +
    `<path d="M10 66c14 0 14-12 28-12s14 12 28 12 14-12 28-12 14 12 18 12" fill="none" stroke="${CREAM}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M48 46V20l26-6v26" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<ellipse cx="42" cy="47" rx="9" ry="7" fill="${SUN}" stroke="${INK}" stroke-width="4.5" transform="rotate(-18 42 47)"/>` +
    `<ellipse cx="68" cy="41" rx="9" ry="7" fill="${SUN}" stroke="${INK}" stroke-width="4.5" transform="rotate(-18 68 41)"/>` +
    `<path d="M12 30h18M8 42h16M16 18h12" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>` +
    `<path class="art-bolt" d="M94 12l-12 18h9l-4 14 14-20h-9z" fill="${SUN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
};

/** A picture for one way of playing (Listen, Learn, Play along). */
export function modeArt(mode: Mode): SVGSVGElement {
  return svg('0 0 120 90', MODE_ART[mode], 'mode-art');
}

/**
 * One hand seen from above, fingers up, thumb toward the middle of the
 * piano: on the left for the right hand. Drawn twice (a thick ink copy under
 * a filled copy) so it reads as one outlined silhouette.
 */
function hand(color: string, mirror: boolean, dx = 0, scale = 1): string {
  const shapes =
    `<rect x="18" y="30" width="30" height="26" rx="11"/>` +
    `<rect x="19" y="13" width="7.5" height="26" rx="3.75"/>` +
    `<rect x="27.5" y="8" width="7.5" height="30" rx="3.75"/>` +
    `<rect x="36" y="10" width="7.5" height="28" rx="3.75"/>` +
    `<rect x="44" y="17" width="6.5" height="22" rx="3.25"/>` +
    `<rect x="7" y="31" width="7.5" height="20" rx="3.75" transform="rotate(-38 11 46)"/>`;
  const flip = mirror ? `translate(${64 * scale + dx} 0) scale(${-scale} ${scale})` : `translate(${dx} 0) scale(${scale})`;
  return (
    `<g transform="${flip}">` +
    `<g fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linejoin="round">${shapes}</g>` +
    `<g fill="${color}">${shapes}</g>` +
    `<path d="M24 40q9 5 18 0" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity="0.35"/>` +
    `</g>`
  );
}

const HAND_ART: Record<Hands, string> = {
  right: `<g transform="translate(16 4)">${hand(RIGHT, false)}</g>`,
  left: `<g transform="translate(16 4)">${hand(LEFT, true)}</g>`,
  // Left hand on the left, right hand on the right, as they sit at the piano.
  both: `<g transform="translate(-2 14)">${hand(LEFT, true, 0, 0.78)}</g><g transform="translate(46 14)">${hand(RIGHT, false, 0, 0.78)}</g>`,
};

/** A picture of the hand (or hands) that play. */
export function handsArt(hands: Hands): SVGSVGElement {
  return svg('0 0 96 68', HAND_ART[hands], 'hands-art');
}

/** Extra icons on the shared 24px grid (round 2.25px strokes, see .icon in style.css). */
const ICONS = {
  pause: '<rect class="fill" x="6" y="4.5" width="4.2" height="15" rx="1.6"/><rect class="fill" x="13.8" y="4.5" width="4.2" height="15" rx="1.6"/>',
  again: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 3.5v4.5H9"/>',
  leave: '<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  rotate:
    '<rect x="3.5" y="7" width="10" height="15" rx="2.2" transform="rotate(-90 8.5 14.5)"/><path d="M15.5 3.5a6 6 0 0 1 5 5"/><path d="M20.5 5v3.5H17"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle class="fill" cx="12" cy="12" r="3"/>',
} as const;

export type PlayerIcon = keyof typeof ICONS;

export function playerIcon(name: PlayerIcon): SVGSVGElement {
  return svg('0 0 24 24', ICONS[name], 'icon');
}

/** A big drawn star for the results, filled when earned. */
export function bigStar(on: boolean): SVGSVGElement {
  const fill = on ? SUN : 'rgba(255, 255, 255, 0.16)';
  const edge = on ? '#c79a0e' : 'rgba(255, 255, 255, 0.1)';
  const shine = on ? `<path d="M22 20l6-2" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.7"/>` : '';
  return svg(
    '0 0 64 64',
    `<path d="M32 9l7 14.2 15.6 2.3-11.3 11 2.7 15.6L32 44.7l-14 7.4 2.7-15.6-11.3-11L25 23.2z" transform="translate(0 3)" fill="${edge}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>` +
      `<path d="M32 9l7 14.2 15.6 2.3-11.3 11 2.7 15.6L32 44.7l-14 7.4 2.7-15.6-11.3-11L25 23.2z" fill="${fill}" stroke="${fill}" stroke-width="5" stroke-linejoin="round"/>` +
      shine,
    `big-star${on ? ' is-on' : ''}`,
  );
}
