/**
 * Small original spot illustrations (flat shapes, no photos) for choices and
 * empty states. Decorative: the words next to them carry the meaning.
 */

export type IllustrationName =
  | 'usb-piano'
  | 'computer'
  | 'acoustic'
  | 'songs'
  | 'connected'
  // Added for settings, shared songs and the editor.
  | 'cable'
  | 'link'
  | 'share'
  | 'file'
  | 'sound'
  | 'mic'
  | 'timing'
  | 'display'
  | 'about'
  | 'write'
  | 'fix'
  | 'resume';

const INK = '#10304a';
const CREAM = '#fff7e8';
const SUN = '#ffd23f';
const CORAL = '#ff7d6e';
const MINT = '#5fe3b8';
const SKY = '#8fd3ff';

function keys(x: number, y: number, w: number, h: number, count: number): string {
  const kw = w / count;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${CREAM}"/>`;
  for (let i = 1; i < count; i++) s += `<path d="M${(x + i * kw).toFixed(1)} ${y}v${h}" stroke="${INK}" stroke-width="1.6"/>`;
  for (let i = 0; i < count - 1; i++) {
    if ([2, 6].includes(i % 7)) continue;
    s += `<rect x="${(x + (i + 1) * kw - kw * 0.3).toFixed(1)}" y="${y}" width="${(kw * 0.6).toFixed(1)}" height="${(h * 0.58).toFixed(1)}" rx="1.5" fill="${INK}"/>`;
  }
  return s;
}

const ART: Record<IllustrationName, string> = {
  'usb-piano':
    `<circle cx="120" cy="34" r="26" fill="${SUN}" opacity="0.35"/>` +
    `<path d="M140 64c14 0 10-34 0-40" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<rect x="132" y="12" width="16" height="14" rx="3" fill="${SUN}" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="136" y="6" width="8" height="7" rx="1.5" fill="${INK}"/>` +
    `<rect x="8" y="52" width="140" height="44" rx="12" fill="${INK}"/>` +
    `<circle cx="22" cy="62" r="3" fill="${CORAL}"/><circle cx="32" cy="62" r="3" fill="${MINT}"/><rect x="104" y="59" width="30" height="6" rx="3" fill="${SKY}"/>` +
    keys(16, 70, 124, 20, 14),
  computer:
    `<circle cx="36" cy="30" r="24" fill="${MINT}" opacity="0.4"/>` +
    `<rect x="26" y="10" width="108" height="66" rx="10" fill="${INK}"/>` +
    `<rect x="34" y="18" width="92" height="50" rx="5" fill="${SKY}"/>` +
    `<path d="M70 58V34l22-5v22" stroke="${INK}" stroke-width="4" fill="none" stroke-linejoin="round"/><ellipse cx="65" cy="58" rx="7" ry="5.5" fill="${INK}"/><ellipse cx="87" cy="51" rx="7" ry="5.5" fill="${INK}"/>` +
    `<path d="M10 80h140l-10 16H20z" fill="${CORAL}"/>` +
    `<g fill="${INK}" opacity="0.55"><rect x="34" y="83" width="12" height="4" rx="2"/><rect x="52" y="83" width="12" height="4" rx="2"/><rect x="70" y="83" width="20" height="4" rx="2"/><rect x="96" y="83" width="12" height="4" rx="2"/><rect x="114" y="83" width="12" height="4" rx="2"/></g>`,
  acoustic:
    `<path d="M128 26c10 8 10 26 0 34M138 18c16 12 16 38 0 50" stroke="${SUN}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<rect x="18" y="10" width="96" height="70" rx="12" fill="${CORAL}"/>` +
    `<rect x="28" y="20" width="76" height="24" rx="6" fill="#ff9a8d"/>` +
    `<path d="M44 26v12M56 26v12M68 26v12M80 26v12M92 26v12" stroke="${CREAM}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>` +
    `<rect x="12" y="52" width="108" height="10" rx="4" fill="${INK}"/>` +
    keys(20, 60, 92, 16, 12) +
    `<rect x="22" y="80" width="8" height="18" rx="3" fill="${INK}"/><rect x="102" y="80" width="8" height="18" rx="3" fill="${INK}"/>`,
  songs:
    `<rect x="14" y="22" width="64" height="64" rx="14" fill="${CORAL}" transform="rotate(-8 46 54)"/>` +
    `<rect x="62" y="16" width="64" height="64" rx="14" fill="${MINT}" transform="rotate(6 94 48)"/>` +
    `<path d="M86 64V34l20-4v26" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linejoin="round"/><ellipse cx="81" cy="64" rx="7" ry="5.5" fill="${INK}"/><ellipse cx="101" cy="56" rx="7" ry="5.5" fill="${INK}"/>` +
    `<path d="M34 46l3.2 6.6 7.3 1-5.3 5.1 1.3 7.3-6.5-3.5-6.5 3.5 1.3-7.3-5.3-5.1 7.3-1z" fill="${SUN}"/>`,
  connected:
    `<circle cx="80" cy="50" r="44" fill="${MINT}"/>` +
    `<path d="M58 52l15 15 30-32" stroke="${INK}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  cable:
    `<circle cx="120" cy="30" r="26" fill="${SUN}" opacity="0.35"/>` +
    `<path d="M18 4c0 24 22 22 34 26s14 10 14 16" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<rect x="56" y="38" width="20" height="16" rx="4" fill="${SUN}" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="61" y="52" width="10" height="8" rx="1.5" fill="${INK}"/>` +
    `<rect x="6" y="58" width="148" height="40" rx="12" fill="${INK}"/>` +
    `<circle cx="20" cy="66" r="3" fill="${CORAL}"/><circle cx="30" cy="66" r="3" fill="${MINT}"/><rect x="112" y="63" width="30" height="6" rx="3" fill="${SKY}"/>` +
    keys(14, 74, 132, 20, 16) +
    `<path d="M132 22l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="${CREAM}"/>`,
  link:
    `<circle cx="112" cy="52" r="38" fill="${SKY}" opacity="0.55"/>` +
    `<g transform="rotate(-6 54 52)"><rect x="22" y="12" width="62" height="80" rx="10" fill="${CREAM}"/>` +
    `<path d="M32 34h42M32 42h42M32 50h42M32 58h42" stroke="${INK}" stroke-width="2" opacity="0.3"/>` +
    `<path d="M48 64V38l16-4v24" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linejoin="round"/><ellipse cx="44" cy="64" rx="6" ry="4.5" fill="${INK}"/><ellipse cx="60" cy="58" rx="6" ry="4.5" fill="${INK}"/></g>` +
    `<g transform="rotate(-40 114 54)"><rect x="88" y="44" width="32" height="20" rx="10" fill="none" stroke="${INK}" stroke-width="7"/><rect x="108" y="44" width="32" height="20" rx="10" fill="none" stroke="${CORAL}" stroke-width="7"/></g>`,
  share:
    `<path d="M12 84c22-4 32-22 54-24" stroke="${CREAM}" stroke-width="4" fill="none" stroke-dasharray="2 9" stroke-linecap="round"/>` +
    `<path d="M24 40s-10-6-10-13a6 6 0 0 1 10-3 6 6 0 0 1 10 3c0 7-10 13-10 13z" fill="${CORAL}"/>` +
    `<path d="M66 52L148 14 114 92 98 66z" fill="${CREAM}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M98 66L148 14" stroke="${INK}" stroke-width="4"/>` +
    `<path d="M98 66l-4 22 20-10" fill="${SKY}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
  file:
    `<circle cx="42" cy="34" r="26" fill="${MINT}" opacity="0.45"/>` +
    `<path d="M46 8h46l20 20v66H46z" fill="${CREAM}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M92 8v20h20" fill="${SUN}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M68 70V44l16-4v24" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linejoin="round"/><ellipse cx="64" cy="70" rx="6" ry="4.5" fill="${INK}"/><ellipse cx="80" cy="64" rx="6" ry="4.5" fill="${INK}"/>` +
    `<circle cx="124" cy="78" r="20" fill="${SUN}" stroke="${INK}" stroke-width="4"/><path d="M124 68v18M116 79l8 8 8-8" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  sound:
    `<circle cx="58" cy="52" r="42" fill="${SUN}" opacity="0.35"/>` +
    `<rect x="30" y="14" width="56" height="78" rx="14" fill="${INK}"/>` +
    `<circle cx="58" cy="64" r="18" fill="${CORAL}"/><circle cx="58" cy="64" r="7" fill="${INK}"/><circle cx="58" cy="31" r="7" fill="${SUN}"/>` +
    `<path d="M100 40c8 8 8 22 0 30M114 30c14 14 14 38 0 52M128 20c20 20 20 50 0 70" stroke="${MINT}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  mic:
    `<circle cx="80" cy="50" r="42" fill="${MINT}" opacity="0.4"/>` +
    `<rect x="64" y="8" width="32" height="52" rx="16" fill="${CORAL}" stroke="${INK}" stroke-width="4"/>` +
    `<path d="M71 24h18M71 34h18M71 44h18" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity="0.4"/>` +
    `<path d="M54 46a26 26 0 0 0 52 0M80 72v18M64 94h32" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<path d="M30 70V44l16-4v24" stroke="${SUN}" stroke-width="4" fill="none" stroke-linejoin="round"/><ellipse cx="26" cy="70" rx="6" ry="4.5" fill="${SUN}"/><ellipse cx="42" cy="64" rx="6" ry="4.5" fill="${SUN}"/>` +
    `<path d="M120 36c6 6 6 16 0 22M130 28c10 10 10 28 0 38" stroke="${CREAM}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  timing:
    `<circle cx="80" cy="52" r="42" fill="${SKY}" opacity="0.45"/>` +
    `<path d="M66 10h28l20 84H46z" fill="${SUN}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M50 76h60" stroke="${INK}" stroke-width="4"/>` +
    `<path d="M80 76L102 24" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="95" cy="40" r="7" fill="${CORAL}" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M126 32l10-6M128 48h12M34 32l-10-6M32 48H20" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
  display:
    `<rect x="16" y="8" width="128" height="88" rx="14" fill="${INK}"/>` +
    `<rect x="38" y="18" width="14" height="30" rx="7" fill="${MINT}"/><rect x="74" y="30" width="14" height="22" rx="7" fill="${SUN}"/><rect x="106" y="14" width="14" height="38" rx="7" fill="${CORAL}"/>` +
    `<text x="45" y="38" font-family="sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="${INK}">C</text>` +
    keys(24, 60, 112, 28, 12),
  about:
    `<circle cx="80" cy="52" r="44" fill="${SUN}" opacity="0.3"/>` +
    `<path d="M80 92S36 66 36 38a20 20 0 0 1 44-8 20 20 0 0 1 44 8c0 28-44 54-44 54z" fill="${CORAL}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<ellipse cx="56" cy="38" rx="8" ry="5" fill="#fff" opacity="0.5" transform="rotate(-30 56 38)"/>` +
    `<path d="M140 12l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="${SUN}"/><path d="M20 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="${MINT}"/>`,
  write:
    `<rect x="18" y="10" width="94" height="84" rx="12" fill="${CREAM}"/>` +
    `<path d="M30 34h70M30 42h70M30 50h70M30 58h70M30 66h70" stroke="${INK}" stroke-width="2" opacity="0.3"/>` +
    `<path d="M50 60V36M68 52V28M86 44V20" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<ellipse cx="45" cy="61" rx="6.5" ry="5" fill="${CORAL}"/><ellipse cx="63" cy="53" rx="6.5" ry="5" fill="${INK}"/><ellipse cx="81" cy="45" rx="6.5" ry="5" fill="${INK}"/>` +
    `<g transform="rotate(32 126 56)"><rect x="117" y="12" width="18" height="66" rx="4" fill="${SUN}" stroke="${INK}" stroke-width="3.5"/><path d="M117 78l9 16 9-16z" fill="${CREAM}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><rect x="117" y="12" width="18" height="12" rx="3" fill="${CORAL}" stroke="${INK}" stroke-width="3.5"/></g>`,
  fix:
    `<rect x="8" y="10" width="144" height="84" rx="16" fill="${INK}"/>` +
    `<path d="M44 18v68M80 18v68M116 18v68" stroke="${CREAM}" opacity="0.15" stroke-width="2"/>` +
    `<rect x="20" y="66" width="30" height="13" rx="6.5" fill="${MINT}"/><rect x="54" y="52" width="22" height="13" rx="6.5" fill="${MINT}"/><rect x="128" y="60" width="16" height="13" rx="6.5" fill="${MINT}"/>` +
    `<rect x="86" y="36" width="36" height="13" rx="6.5" fill="${SUN}" stroke="#fff" stroke-width="3"/>` +
    `<path d="M104 28V16M98 22l6-6 6 6" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  resume:
    `<circle cx="116" cy="38" r="30" fill="${SUN}" opacity="0.4"/>` +
    `<g transform="rotate(-5 62 54)"><rect x="24" y="12" width="76" height="84" rx="12" fill="${CREAM}"/>` +
    `<path d="M36 40h52M36 50h52M36 60h40M36 70h46" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity="0.3"/></g>` +
    `<path d="M70 6h20v40l-10-8-10 8z" fill="${CORAL}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<circle cx="122" cy="72" r="22" fill="${INK}"/><path d="M116 62v20l16-10z" fill="${SUN}"/>`,
};

export function illustration(name: IllustrationName, className = 'illustration'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 104');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ART[name];
  return svg;
}
