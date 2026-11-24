/**
 * The app's own icons: drawn for this app on a 24px grid with round 2.25px
 * strokes (see .icon in style.css). Every icon is decorative (aria-hidden):
 * the button or link holding it carries the words. Markup is constant, never
 * built from data.
 */

const PATHS = {
  // Navigation
  learn: '<path d="M3 20.5h5v-5h5v-5h5"/><path d="M18 10.5V3"/><path class="fill" d="M18 3.2l4.5 2.4L18 8z"/>',
  songs: '<path d="M9 17.5V6.5l11-2.5v11"/><circle class="fill" cx="6.5" cy="17.5" r="3"/><circle class="fill" cx="17.5" cy="15" r="3"/>',
  shared: '<circle cx="9" cy="8" r="3.3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9.5" r="2.6"/><path d="M15.5 14.6A5 5 0 0 1 21.5 19.5"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2.4" class="fill"/><circle cx="15.5" cy="12" r="2.4" class="fill"/><circle cx="7.5" cy="18" r="2.4" class="fill"/>',

  // Actions
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  forward: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  play: '<path class="fill" d="M8 4.8v14.4a1.2 1.2 0 0 0 1.8 1l11.3-7.2a1.2 1.2 0 0 0 0-2L9.8 3.8A1.2 1.2 0 0 0 8 4.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 6.5l3 3"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>',
  more: '<circle class="fill" cx="5.5" cy="12" r="2"/><circle class="fill" cx="12" cy="12" r="2"/><circle class="fill" cx="18.5" cy="12" r="2"/>',
  addSong: '<path d="M8 17.5V6.5l9-2.2V9"/><circle class="fill" cx="5.5" cy="17.5" r="2.8"/><path d="M17 13v8M13 17h8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',

  // Things
  star: '<path class="fill" d="M12 2.8l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.7l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8z"/>',
  sun: '<circle class="fill" cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  heart: '<path class="fill" d="M12 20.5s-8-4.8-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.6-8 10.4-8 10.4z"/>',
  listen: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect class="fill" x="3" y="13.5" width="5" height="7" rx="2"/><rect class="fill" x="16" y="13.5" width="5" height="7" rx="2"/>',
  learnMode: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
  playAlong: '<path class="fill" d="M13.5 2.5L5 13.5h6l-1.2 8L18.5 10h-6.2z"/>',
  piano: '<rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M8.8 13v6M15.2 13v6"/><path class="fill" d="M7 6h3.5v7H7zM13.5 6H17v7h-3.5z"/>',
  keyboard: '<rect x="2.5" y="6.5" width="19" height="12" rx="3"/><path d="M6.5 10.5h.01M10 10.5h.01M14 10.5h.01M17.5 10.5h.01M8 14.5h8"/>',
  usb: '<path d="M12 21V8M12 8l-3-3.5h6zM12 14l-4-2.5V9M12 16.5l4-2.5v-2"/><rect class="fill" x="6.5" y="7.5" width="3" height="2.5" rx=".6"/><circle class="fill" cx="16" cy="11" r="1.6"/>',
  mic: '<rect x="8.5" y="3" width="7" height="11.5" rx="3.5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"/>',
  wave: '<path d="M2.5 14c2.4 0 2.4-4 4.75-4S9.6 14 12 14s2.4-4 4.75-4S19.1 14 21.5 14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>',

  // Editing and sharing (added for the editor, settings and shared songs)
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  pointer: '<path class="fill" d="M6 3.5l12.5 7.2-5.6 1.4 3.4 6.3-2.6 1.4-3.4-6.3L6 17.5z"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5M10.5 7.5v6M7.5 10.5h6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5M7.5 10.5h6"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle class="fill" cx="12" cy="12" r="4.5"/>',
  pause: '<rect class="fill" x="6.5" y="5" width="4" height="14" rx="1.2"/><rect class="fill" x="13.5" y="5" width="4" height="14" rx="1.2"/>',
  tools: '<path d="M4 20L15 9"/><path d="M13 7l4 4"/><path class="fill" d="M18 2.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M14 10a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-6.5 18-4.5-7-7-4.5z"/>',
  'speaker-off': '<path class="fill" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  speaker: '<path class="fill" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle class="fill" cx="12" cy="12" r="3"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17h.01"/>',
} as const;

export type IconName = keyof typeof PATHS;

const NS = 'http://www.w3.org/2000/svg';

/** An inline SVG icon. Decorative: put the words on the control that holds it. */
export function icon(name: IconName, extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', extraClass ? `icon ${extraClass}` : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = PATHS[name];
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
