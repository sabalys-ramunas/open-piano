import type { Note } from '../song';
import { noteName } from '../song';
import { fitKeys, layout } from './keyboard';
import { approach, beatGrid, beatPhase, beatTime, firstBeat, indexNotes, panFor, upperBound, visibleSeconds, visibleSpan, type BeatGrid, type NoteIndex, type Span } from './stage';
import type { FrameState, Rect, StageView } from './view';

/** Narrowest a white key may get before the keyboard scrolls sideways instead (phones). */
const MIN_WHITE = 28;
/** About how wide we like a white key on big screens; wider screens show more keys around the song. */
const COMFY_WHITE = 54;
const FELT = 4;
const BLACK_DEPTH = 0.62;
const MAX_GLOWS = 16;
const WHITE_RADII = [0, 0, 9, 9];
const BLACK_RADII = [0, 0, 6, 6];
/** Height of the darker lip under each note: chunky things get a solid lower lip. */
const LIP = 4;
/** The background is soft light and gradients, so it is drawn at a quarter of the CSS size and scaled up. */
const BG_SCALE = 0.25;
const DISPLAY_FONT = "Fredoka, ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif";
const CREAM = '#fff8ec';
const INK_TEXT = '#10304a';

/** Optional finger number on a note (1 thumb .. 5 little finger), when a song provides it. */
type FingeredNote = Note & { finger?: number };

const C_LABELS: string[] = [];
for (let m = 0; m < 128; m++) C_LABELS.push(m % 12 === 0 ? `C${m / 12 - 1}` : '');
const NAMES: string[] = [];
for (let m = 0; m < 128; m++) NAMES.push(noteName(m));
const FINGER_LABELS = ['', '1', '2', '3', '4', '5'];

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseColor(value: string, fallback: Rgb): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const css = (c: Rgb, a = 1) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const INK: Rgb = { r: 4, g: 24, b: 40 };

/** Colours for one hand, worked out once so drawing never builds colour strings. */
interface HandPaint {
  base: string;
  /** Notes on black keys: a little darker, so the two kinds of key read apart. */
  mid: string;
  deep: string;
  light: string;
  glow: string;
  ghost: string;
  ghostLine: string;
  rgb: Rgb;
}

function handPaint(c: Rgb): HandPaint {
  return {
    base: css(c),
    mid: css(mix(c, INK, 0.2)),
    deep: css(mix(c, INK, 0.45)),
    light: css(mix(c, WHITE, 0.55)),
    glow: css(c, 0.95),
    ghost: css(c, 0.16),
    ghostLine: css(c, 0.5),
    rgb: c,
  };
}

/** A soft round light, drawn once and stamped wherever a glow is needed. */
function glowSprite(c: Rgb, size = 128): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = size;
  const g = s.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, css(c, 0.9));
    grad.addColorStop(0.35, css(c, 0.35));
    grad.addColorStop(1, css(c, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return s;
}

/** Places a layer canvas inside the host; inline, so it works in any host. */
function placeLayer(c: HTMLCanvasElement, top: number, height: number): void {
  const st = c.style;
  st.position = 'absolute';
  st.left = '0';
  st.right = 'auto';
  st.bottom = 'auto';
  st.top = `${top}px`;
  st.width = '100%';
  st.height = `${height}px`;
  st.display = 'block';
}

/**
 * Notes fall from the top onto a piano keyboard at the bottom. Drawn on three
 * stacked canvases, because filling pixels is what costs (a 2000 px wide
 * screen at 2x is over 9 million pixels, and Safari draws canvases on the CPU):
 * - the background (deep-sea gradient and drifting lights) at a quarter of the
 *   size, scaled up by the browser for free;
 * - the notes, cleared and drawn every frame, only above the keys;
 * - the keyboard, drawn again only when a key changes (pressed, lit, scrolled).
 * Everything else that does not change per frame (colours, gradients, glow
 * sprites, key positions, note-name badges) is prepared up front.
 */
export class FallingView implements StageView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bgCanvas: HTMLCanvasElement;
  private bg: CanvasRenderingContext2D;
  private keysCanvas: HTMLCanvasElement;
  private keys: CanvasRenderingContext2D;
  /** How far the keys layer reaches above the line, for the glow over pressed keys (CSS px). */
  private keysPad = 0;
  /** What the keys layer last showed; it is drawn again only when this changes. */
  private keysKey = '';
  private keysAnimating = true;
  private width = 0;
  private height = 0;
  private kh = 120;
  private hitY = 0;

  // Keys
  private lo = 48;
  private hi = 83;
  private keyX = new Float32Array(128);
  private keyW = new Float32Array(128);
  private keyIn = new Uint8Array(128);
  private whites: number[] = [];
  private blacks: number[] = [];
  private whiteW = 40;
  private fullW = 0;
  private pan = 0;
  private panGoal = 0;

  // Song caches
  private notesRef: readonly Note[] | null = null;
  private index: NoteIndex = indexNotes([]);
  private grid: BeatGrid | null = null;
  private songMin = 60;
  private songMax = 72;
  private fallbackRange = { lo: 48, hi: 83 };
  private limit: { lo: number; hi: number } | undefined;

  // Animation
  private pps = Number.NaN;
  private lastNow = 0;
  private lastTime = Number.NaN;
  private energy = 0;
  private span: Span = { from: 0, to: 0 };
  private activeHand = new Int8Array(128); // 0 none, 1 right, 2 left: a note of this hand is sounding on the key
  private nextHand = new Int8Array(128); // the hand of the next note due on the key

  // Paint
  private right: HandPaint;
  private left: HandPaint;
  private miss = 'rgba(120, 150, 170, 0.42)';
  private missLip = 'rgba(70, 95, 115, 0.45)';
  // Fonts, worked out when the size changes so drawing never builds strings.
  private nameFont = `600 13px ${DISPLAY_FONT}`;
  private nameFontBlack = `600 11px ${DISPLAY_FONT}`;
  private nameR = 9;
  private nameRBlack = 7.5;
  private letterFont = `600 15px ${DISPLAY_FONT}`;
  private letterFontBlack = `600 12px ${DISPLAY_FONT}`;
  private letterSize = 15;
  private cFont = `600 12px ${DISPLAY_FONT}`;
  private fingerFont = `600 11px ${DISPLAY_FONT}`;
  private ratio = 1;
  private deviceRatio = 1;
  /** Highest pixel ratio this computer keeps up with; lowered by adapt when frames come slowly. */
  private ratioCap = 2;
  private frameAvg = 1 / 60;
  private slowFrames = 0;
  /** Note-name badges by pitch class (0 = C), drawn once per size: no text drawing per note per frame. */
  private nameSprites: HTMLCanvasElement[] = [];
  private nameSpritesBlack: HTMLCanvasElement[] = [];
  private glowRight: HTMLCanvasElement;
  private glowLeft: HTMLCanvasElement;
  private glowWhite: HTMLCanvasElement;
  private bgGrad: CanvasGradient | string = '#04182a';
  private lineGrad: CanvasGradient | string = '#ffffff';
  private bandGrad: CanvasGradient | string = 'transparent';
  private whiteGrad: CanvasGradient | string = CREAM;
  private blackGrad: CanvasGradient | string = '#12324c';
  private fadeL: CanvasGradient | string = 'transparent';
  private fadeR: CanvasGradient | string = 'transparent';

  constructor(host: HTMLElement) {
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.className = 'stage-canvas stage-canvas-bg';
    this.bgCanvas.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Falling notes and piano keyboard');
    this.keysCanvas = document.createElement('canvas');
    this.keysCanvas.className = 'stage-canvas stage-canvas-keys';
    this.keysCanvas.setAttribute('aria-hidden', 'true');
    host.append(this.bgCanvas, this.canvas, this.keysCanvas);
    const bg = this.bgCanvas.getContext('2d', { alpha: false });
    const ctx = this.canvas.getContext('2d');
    const keys = this.keysCanvas.getContext('2d');
    if (!ctx || !bg || !keys) throw new Error('This device cannot draw the notes.');
    this.bg = bg;
    this.ctx = ctx;
    this.keys = keys;
    const style = getComputedStyle(document.documentElement);
    const r = parseColor(style.getPropertyValue('--right'), { r: 90, g: 169, b: 255 });
    const l = parseColor(style.getPropertyValue('--left'), { r: 255, g: 162, b: 74 });
    this.right = handPaint(r);
    this.left = handPaint(l);
    this.glowRight = glowSprite(r);
    this.glowLeft = glowSprite(l);
    this.glowWhite = glowSprite({ r: 214, g: 240, b: 255 });
    // The badges are pictures of text: draw them again once the display font has arrived.
    void document.fonts?.ready.then(() => {
      if (this.width > 1) {
        this.makeFonts();
        this.keysKey = '';
      }
    });
  }

  resize(width: number, height: number, ratio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.deviceRatio = ratio || 1;
    // Past 2x the extra pixels cost a lot of drawing and are hard to see. A computer that
    // cannot keep up gets fewer pixels (see adapt), which looks a little softer but moves smoothly.
    const r = Math.min(2, this.ratioCap, Math.max(1, ratio || 1));
    this.ratio = r;
    this.kh = Math.round(Math.min(180, Math.max(88, this.height * 0.22)));
    this.hitY = this.height - this.kh;
    // The notes layer stops where the keys start: nothing of it is drawn below.
    const notesH = this.hitY + FELT;
    this.canvas.width = Math.round(this.width * r);
    this.canvas.height = Math.max(1, Math.round(notesH * r));
    placeLayer(this.canvas, 0, notesH);
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
    this.bgCanvas.width = Math.max(1, Math.ceil(this.width * BG_SCALE));
    this.bgCanvas.height = Math.max(1, Math.ceil(notesH * BG_SCALE));
    placeLayer(this.bgCanvas, 0, this.bgCanvas.height / BG_SCALE);
    this.bg.setTransform(BG_SCALE, 0, 0, BG_SCALE, 0, 0);
    this.makePaint();
    this.relayout();
  }

  /** Sizes the keys layer: the keys, plus room above them for the glow over a pressed key. */
  private placeKeys(): void {
    const r = this.ratio;
    this.keysPad = Math.ceil(this.whiteW * 2.8 * 0.55 + 4);
    const top = this.hitY - this.keysPad;
    const h = this.height - top;
    this.keysCanvas.width = Math.round(this.width * r);
    this.keysCanvas.height = Math.max(1, Math.round(h * r));
    placeLayer(this.keysCanvas, top, h);
    // Same coordinates as the notes: the layer just starts a little above the line.
    this.keys.setTransform(r, 0, 0, r, 0, -top * r);
    const kh = this.kh;
    const kt = this.hitY + FELT;
    const white = this.keys.createLinearGradient(0, kt, 0, this.height);
    white.addColorStop(0, '#e8d6b4');
    white.addColorStop(0.07, '#fff6e6');
    white.addColorStop(0.8, '#fffaf2');
    white.addColorStop(1, '#f1dfbf');
    this.whiteGrad = white;
    const black = this.keys.createLinearGradient(0, kt, 0, kt + kh * BLACK_DEPTH);
    black.addColorStop(0, '#071c2e');
    black.addColorStop(0.7, '#15395a');
    black.addColorStop(1, '#245276');
    this.blackGrad = black;
    this.keysKey = '';
  }

  private makePaint(): void {
    const { ctx, width, hitY } = this;
    // The deep sea: darkest at the top, a little lighter where the notes land.
    const bg = this.bg.createLinearGradient(0, 0, 0, hitY);
    bg.addColorStop(0, '#03162a');
    bg.addColorStop(0.5, '#052a44');
    bg.addColorStop(1, '#0a3c5c');
    this.bgGrad = bg;

    const line = ctx.createLinearGradient(0, 0, width, 0);
    line.addColorStop(0, '#fff1d6');
    line.addColorStop(0.5, CREAM);
    line.addColorStop(1, '#e3f4ff');
    this.lineGrad = line;

    const band = ctx.createLinearGradient(0, hitY - 80, 0, hitY);
    band.addColorStop(0, 'rgba(143, 211, 255, 0)');
    band.addColorStop(1, 'rgba(160, 225, 255, 0.3)');
    this.bandGrad = band;

    const fl = ctx.createLinearGradient(0, 0, 36, 0);
    fl.addColorStop(0, 'rgba(2, 16, 28, 0.85)');
    fl.addColorStop(1, 'rgba(2, 16, 28, 0)');
    this.fadeL = fl;
    const fr = ctx.createLinearGradient(width - 36, 0, width, 0);
    fr.addColorStop(0, 'rgba(2, 16, 28, 0)');
    fr.addColorStop(1, 'rgba(2, 16, 28, 0.85)');
    this.fadeR = fr;
  }

  /** Sizes for the words on notes and keys, from how wide a white key is. */
  private makeFonts(): void {
    const w = this.whiteW;
    const bw = w * 0.64;
    const name = Math.round(Math.max(11, Math.min(18, w * 0.36)));
    const nameBlack = Math.round(Math.max(10, Math.min(15, bw * 0.46)));
    this.nameFont = `600 ${name}px ${DISPLAY_FONT}`;
    this.nameFontBlack = `600 ${nameBlack}px ${DISPLAY_FONT}`;
    this.nameR = name * 0.72;
    this.nameRBlack = nameBlack * 0.72;
    this.letterSize = Math.round(Math.max(13, Math.min(21, w * 0.4)));
    this.letterFont = `600 ${this.letterSize}px ${DISPLAY_FONT}`;
    this.letterFontBlack = `600 ${Math.round(Math.max(11, Math.min(16, bw * 0.5)))}px ${DISPLAY_FONT}`;
    this.cFont = `600 ${Math.round(Math.max(11, Math.min(14, w * 0.26)))}px ${DISPLAY_FONT}`;
    this.fingerFont = `600 ${Math.round(Math.max(10, Math.min(13, w * 0.26)))}px ${DISPLAY_FONT}`;
    this.nameSprites = nameBadges(this.nameFont, this.nameR, w - 5, this.ratio);
    this.nameSpritesBlack = nameBadges(this.nameFontBlack, this.nameRBlack, bw, this.ratio);
  }

  /** Fits the keys to the song and the screen: bigger keys on small songs, sideways scrolling on phones. */
  private relayout(): void {
    const minWhites = Math.max(15, Math.min(52, Math.floor(this.width / COMFY_WHITE)));
    const range = this.notesRef && this.notesRef.length ? fitKeys([this.songMin, this.songMax], { minWhites, limit: this.limit }) : this.fallbackRange;
    this.lo = range.lo;
    this.hi = range.hi;
    let whites = 0;
    for (let m = this.lo; m <= this.hi; m++) if (!isBlackKey(m)) whites++;
    this.whiteW = Math.max(MIN_WHITE, this.width / Math.max(1, whites));
    this.fullW = this.whiteW * whites;
    const boxes = layout(this.lo, this.hi, this.fullW);
    this.keyIn.fill(0);
    this.whites = [];
    this.blacks = [];
    for (const [midi, box] of boxes) {
      if (midi < 0 || midi > 127) continue;
      this.keyIn[midi] = 1;
      this.keyX[midi] = box.x;
      this.keyW[midi] = box.w;
      (box.black ? this.blacks : this.whites).push(midi);
    }
    this.whites.sort((a, b) => a - b);
    this.blacks.sort((a, b) => a - b);
    this.pan = this.panGoal = Math.min(this.pan, Math.max(0, this.fullW - this.width));
    this.makeFonts();
    this.placeKeys();
  }

  private ensureSong(f: FrameState): void {
    const lim = f.keyLimit;
    if ((lim?.lo ?? -1) !== (this.limit?.lo ?? -1) || (lim?.hi ?? -1) !== (this.limit?.hi ?? -1)) {
      this.limit = lim ? { lo: lim.lo, hi: lim.hi } : undefined;
      this.notesRef = null; // fit the keys again
    }
    if (f.notes === this.notesRef && f.range.lo === this.fallbackRange.lo && f.range.hi === this.fallbackRange.hi) return;
    const songChanged = f.notes !== this.notesRef;
    this.notesRef = f.notes;
    this.fallbackRange = { lo: f.range.lo, hi: f.range.hi };
    if (songChanged) {
      this.index = indexNotes(f.notes);
      this.grid = beatGrid(f.song);
      let min = Infinity;
      let max = -Infinity;
      for (const n of f.notes) {
        if (n.midi < min) min = n.midi;
        if (n.midi > max) max = n.midi;
      }
      this.songMin = Number.isFinite(min) ? min : 60;
      this.songMax = Number.isFinite(max) ? max : 72;
      this.pan = 0;
      this.lastTime = Number.NaN;
    }
    this.relayout();
  }

  keyAt(x: number, y: number): number | null {
    const top = this.hitY + FELT;
    if (y < top - 6 || y > this.height) return null;
    const cx = x + this.pan;
    if (y < top + this.kh * BLACK_DEPTH) {
      for (const m of this.blacks) if (cx >= this.keyX[m] && cx < this.keyX[m] + this.keyW[m]) return m;
    }
    const i = Math.floor(cx / this.whiteW);
    return i >= 0 && i < this.whites.length ? this.whites[i] : null;
  }

  keyRect(midi: number): Rect | null {
    if (midi < 0 || midi > 127 || !this.keyIn[midi]) return null;
    const black = isBlackKey(midi);
    return { x: this.keyX[midi] - this.pan, y: this.hitY, w: this.keyW[midi], h: black ? this.kh * BLACK_DEPTH : this.kh };
  }

  draw(f: FrameState): void {
    if (this.width < 2 || this.height < 2) return;
    this.ensureSong(f);
    const dt = this.lastNow ? Math.min(0.1, Math.max(0, (f.now - this.lastNow) / 1000)) : 0;
    this.lastNow = f.now;
    if (f.running && dt > 0) this.adapt(dt);
    const calm = f.reduceMotion;

    // Smooth zoom: slower speeds spread the notes out.
    const goal = (this.hitY - 8) / visibleSeconds(f.speed);
    this.pps = calm || !Number.isFinite(this.pps) ? goal : approach(this.pps, goal, dt, 5);
    const ahead = this.hitY / this.pps;

    // The background breathes with the music: notes reaching the keys add energy.
    const t = f.time;
    if (Number.isFinite(this.lastTime) && t > this.lastTime && t - this.lastTime < 0.5) {
      const { starts } = this.index;
      let i = this.index.sorted ? upperBound(starts, this.lastTime) : starts.length;
      let crossing = 0;
      while (i < starts.length && starts[i] <= t) {
        crossing++;
        i++;
      }
      this.energy = Math.min(1, this.energy + crossing * 0.09);
    }
    this.lastTime = t;
    this.energy *= Math.exp(-dt * 1.8);

    this.updatePan(t, ahead, dt, calm);
    this.drawBackground(f, calm);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.hitY + FELT);
    ctx.save();
    ctx.translate(-this.pan, 0);
    this.drawLanes(f);
    this.drawBeats(t, ahead);
    this.drawLoop(f, ahead);
    this.drawNotes(f, ahead);
    ctx.restore();

    this.drawLine(f, calm);
    this.drawFades(ctx, 0, this.hitY + FELT);

    // The keyboard only changes when a key does: in Listen mode it is drawn once.
    const animating = f.held.size > 0 || f.expected.size > 0 || (f.wrong !== null && f.now - f.wrong.at < 420);
    const key = `${this.pan.toFixed(1)}|${f.reduceMotion}|${this.keyLettersId(f.keyLetters)}`;
    if (animating || this.keysAnimating || key !== this.keysKey) {
      this.keysAnimating = animating;
      this.keysKey = key;
      const k = this.keys;
      const top = this.hitY - this.keysPad;
      k.clearRect(0, top, this.width, this.height - top);
      // Under the keys: the dark felt shows between the rounded keys.
      k.fillStyle = '#021320';
      k.fillRect(0, this.hitY + FELT, this.width, this.height - this.hitY - FELT);
      k.save();
      k.translate(-this.pan, 0);
      this.drawKeys(f, calm);
      k.restore();
      this.drawFades(k, this.hitY + FELT, this.height - this.hitY - FELT);
    }
  }

  /**
   * Watches how often frames arrive while the notes move. When they stay slow
   * for a few seconds (big screen, busy computer), draws with fewer pixels:
   * 2x, then 1.5x, then 1x. It never goes back up while this view lives.
   */
  private adapt(dt: number): void {
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    if (this.frameAvg > 1 / 32) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames < 90 || this.ratio <= 1) return;
    this.slowFrames = 0;
    this.frameAvg = 1 / 60;
    this.ratioCap = Math.max(1, this.ratio - 0.5);
    this.resize(this.width, this.height, this.deviceRatio);
  }

  private lettersSeen: ReadonlyMap<number, string> | null = null;
  private lettersId = 0;
  /** A number that changes whenever a different key-letter map is shown. */
  private keyLettersId(map: ReadonlyMap<number, string>): number {
    if (map !== this.lettersSeen) {
      this.lettersSeen = map;
      this.lettersId++;
    }
    return this.lettersId;
  }

  /** Dark edges on a keyboard that scrolls sideways, over the part of the stage a layer covers. */
  private drawFades(c: CanvasRenderingContext2D, y: number, h: number): void {
    if (this.fullW <= this.width + 1) return;
    c.fillStyle = this.fadeL;
    if (this.pan > 1) c.fillRect(0, y, 36, h);
    c.fillStyle = this.fadeR;
    if (this.pan < this.fullW - this.width - 1) c.fillRect(this.width - 36, y, 36, h);
  }

  /** On narrow screens the keyboard follows the notes that are coming. */
  private updatePan(t: number, ahead: number, dt: number, calm: boolean): void {
    if (this.fullW <= this.width) {
      this.pan = 0;
      return;
    }
    const notes = this.index.notes;
    const span = visibleSpan(this.index, t, t + ahead * 0.7, this.span);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = span.from; i < span.to; i++) {
      const n = notes[i];
      if (n.start + n.dur < t || !this.keyIn[n.midi]) continue;
      const x = this.keyX[n.midi];
      if (x < lo) lo = x;
      if (x + this.keyW[n.midi] > hi) hi = x + this.keyW[n.midi];
    }
    if (lo !== Infinity) {
      const max = Math.max(0, this.fullW - this.width);
      // Keep the coming notes in view; only move when they would go off screen.
      if (hi - lo > this.width) this.panGoal = panFor((lo + hi) / 2, this.fullW, this.width);
      else if (lo < this.panGoal + 12) this.panGoal = Math.max(0, lo - 24);
      else if (hi > this.panGoal + this.width - 12) this.panGoal = Math.min(max, hi - this.width + 24);
    }
    this.pan = approach(this.pan, this.panGoal, dt, calm ? 3 : 5);
  }

  private drawBackground(f: FrameState, calm: boolean): void {
    const { width, hitY } = this;
    const ctx = this.bg;
    ctx.fillStyle = this.bgGrad;
    ctx.fillRect(0, 0, width, hitY);
    ctx.fillStyle = '#021320';
    ctx.fillRect(0, hitY, width, FELT * 2);

    const phase = calm ? 0 : beatPhase(this.grid, f.time);
    const pulse = f.running && this.grid ? (1 - phase) * (1 - phase) * 0.06 : 0;
    const s = Math.max(width, hitY) * 1.1;
    const tm = calm ? 0 : f.now;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = calm ? 0.07 : 0.07 + this.energy * 0.16 + pulse;
    ctx.drawImage(this.glowLeft, width * (0.22 + 0.08 * Math.sin(tm * 0.00017)) - s / 2, hitY * (0.6 + 0.1 * Math.cos(tm * 0.00011)) - s / 2, s, s);
    ctx.drawImage(this.glowRight, width * (0.78 + 0.08 * Math.cos(tm * 0.00013)) - s / 2, hitY * (0.5 + 0.12 * Math.sin(tm * 0.00019)) - s / 2, s, s);
    ctx.globalAlpha = calm ? 0.03 : 0.03 + this.energy * 0.05;
    ctx.drawImage(this.glowWhite, width * 0.5 - s * 0.35, hitY * 0.15 - s * 0.35, s * 0.7, s * 0.7);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawLanes(f: FrameState): void {
    const { ctx, hitY } = this;
    const from = this.pan - 2;
    const to = this.pan + this.width + 2;
    ctx.fillStyle = 'rgba(0, 12, 24, 0.24)';
    for (const m of this.blacks) {
      const x = this.keyX[m];
      if (x + this.keyW[m] < from || x > to) continue;
      ctx.fillRect(x, 0, this.keyW[m], hitY);
    }
    for (const m of this.whites) {
      const x = this.keyX[m];
      if (x < from || x > to) continue;
      ctx.fillStyle = m % 12 === 0 ? 'rgba(160, 225, 255, 0.13)' : m % 12 === 5 ? 'rgba(160, 225, 255, 0.07)' : 'rgba(160, 225, 255, 0.035)';
      ctx.fillRect(x, 0, 1, hitY);
    }
    // In Learn mode the lane of each key to press glows, so the eye follows it down to the key.
    if (f.expected.size > 0) {
      for (const m of f.expected) {
        if (m < 0 || m > 127 || !this.keyIn[m]) continue;
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = this.nextHand[m] === 2 ? this.left.base : this.right.base;
        ctx.fillRect(this.keyX[m], 0, this.keyW[m], hitY);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawBeats(t: number, ahead: number): void {
    const grid = this.grid;
    if (!grid) return;
    const { ctx, hitY, pps } = this;
    let k = firstBeat(grid, t);
    for (let guard = 0; guard < 256; guard++, k++) {
      const bt = beatTime(grid, k);
      if (!Number.isFinite(bt) || bt > t + ahead) break;
      const y = hitY - (bt - t) * pps;
      const bar = k % grid.perBar === 0;
      ctx.fillStyle = bar ? 'rgba(200, 236, 255, 0.14)' : 'rgba(200, 236, 255, 0.05)';
      ctx.fillRect(this.pan, Math.round(y), this.width, bar ? 2 : 1);
    }
  }

  /** Sun lines where a loop starts and ends, with the part outside it dimmed. */
  private drawLoop(f: FrameState, ahead: number): void {
    const loop = f.loop;
    if (!loop) return;
    const { ctx, hitY, pps } = this;
    const t = f.time;
    const yStart = hitY - (loop.start - t) * pps;
    const yEnd = hitY - (loop.end - t) * pps;
    ctx.fillStyle = 'rgba(2, 14, 26, 0.5)';
    if (yEnd > 0) ctx.fillRect(this.pan, 0, this.width, Math.min(hitY, yEnd));
    if (yStart < hitY) ctx.fillRect(this.pan, Math.max(0, yStart), this.width, hitY - Math.max(0, yStart));
    ctx.fillStyle = 'rgba(255, 210, 63, 0.9)';
    if (loop.end <= t + ahead && yEnd >= 0 && yEnd <= hitY) ctx.fillRect(this.pan, yEnd - 1.5, this.width, 3);
    if (loop.start >= t && yStart >= 0 && yStart <= hitY) ctx.fillRect(this.pan, yStart - 1.5, this.width, 3);
  }

  private drawNotes(f: FrameState, ahead: number): void {
    const { ctx, hitY, pps } = this;
    const t = f.time;
    const notes = f.notes;
    const states = f.states;
    const listen = f.mode === 'listen';
    const calm = f.reduceMotion;
    this.activeHand.fill(0);
    this.nextHand.fill(0);
    const span = visibleSpan(this.index, t - 0.05, t + ahead, this.span);
    const left = this.pan - 4;
    const right = this.pan + this.width + 4;

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.pan, 0, this.width, hitY);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let glows = 0;

    for (let i = span.from; i < span.to; i++) {
      const n = notes[i];
      const end = n.start + n.dur;
      if (end < t - 0.02 || n.midi < 0 || n.midi > 127 || !this.keyIn[n.midi]) continue;
      const kx = this.keyX[n.midi];
      const kw = this.keyW[n.midi];
      if (kx + kw < left || kx > right) continue;
      const state = states[i];
      const paint = n.hand === 'left' ? this.left : this.right;
      const handId = n.hand === 'left' ? 2 : 1;
      if (n.start <= t + 0.03 && end >= t && state !== 'miss') this.activeHand[n.midi] = handId;
      if (state === 'pending' && n.start - t <= 0.5 && this.nextHand[n.midi] === 0) this.nextHand[n.midi] = handId;

      const yStart = hitY - (n.start - t) * pps;
      let top = hitY - (end - t) * pps;
      if (yStart - top < 14) top = yStart - 14;
      const bottom = Math.min(yStart, hitY);
      const h = bottom - top;
      if (h < 1 || bottom < 0) continue;

      const black = isBlackKey(n.midi);
      const inset = black ? 0 : Math.min(2.5, kw * 0.05);
      const x = kx + inset;
      const w = kw - inset * 2;
      // Round and chunky: a pill when the note is short, a soft bar when it is long.
      const r = Math.min(12, w / 2, h / 2);
      const ghost = state === 'auto' && !listen;
      const crossing = n.start <= t && end > t;

      let fill: string;
      let lip: string;
      if (state === 'miss') {
        fill = this.miss;
        lip = this.missLip;
      } else if (ghost) {
        fill = paint.ghost;
        lip = paint.ghost;
      } else if (state === 'hit') {
        fill = paint.light;
        lip = paint.base;
      } else {
        fill = black ? paint.mid : paint.base;
        lip = paint.deep;
      }

      // A soft light under notes about to land (a stamped sprite: cheap, unlike shadowBlur).
      if (!calm && glows < MAX_GLOWS && !ghost && state !== 'miss' && yStart > hitY - 90 && yStart < hitY + 4) {
        glows++;
        const gs = kw * (state === 'hit' && crossing ? 3.4 : 2.6);
        ctx.globalAlpha = state === 'hit' && crossing ? 0.75 : 0.5;
        ctx.drawImage(handId === 2 ? this.glowLeft : this.glowRight, kx + kw / 2 - gs / 2, bottom - gs / 2, gs, gs);
        ctx.globalAlpha = 1;
      }

      if (ghost) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(x, top, w, h, r);
        ctx.fill();
        ctx.strokeStyle = paint.ghostLine;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        continue;
      }

      // The lip first (the whole shape), then the body a little shorter on top of it.
      const lipH = h > LIP * 3 && !crossing ? LIP : 0;
      if (lipH) {
        ctx.fillStyle = lip;
        ctx.beginPath();
        ctx.roundRect(x, top, w, h, r);
        ctx.fill();
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, top, w, h - lipH, Math.min(r, (h - lipH) / 2));
      ctx.fill();

      if (state !== 'miss' && h > 12 && w > 8) {
        // A soft shine along the top.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x + r * 0.7, top + 3, w - r * 1.4, 3);
      }
      // A held note drains into the key: the part still above the line shines.
      if (state === 'hit' && crossing && f.held.has(n.midi)) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillRect(x + w * 0.32, top + 4, w * 0.36, Math.max(0, h - 6));
      }

      if (state !== 'miss') {
        const finger = (n as FingeredNote).finger;
        const nr = black ? this.nameRBlack : this.nameR;
        // The name sits in a cream badge at the bottom of the note: always readable on either colour.
        const nameY = bottom - lipH - nr - 3;
        const named = f.showNoteNames && h >= nr * 2 + lipH + 6 && w >= nr * 1.7 && bottom > nr * 2;
        if (named) {
          const sprite = (black ? this.nameSpritesBlack : this.nameSprites)[n.midi % 12];
          const sw = sprite.width / this.ratio;
          ctx.drawImage(sprite, x + w / 2 - sw / 2, nameY - nr, sw, nr * 2);
        }
        if (typeof finger === 'number' && finger >= 1 && finger <= 5 && w >= 14 && top + 16 < hitY) {
          const fr = Math.min(9, w / 2 - 2);
          const cy = top + fr + 4;
          if (cy + fr < (named ? nameY - nr - 2 : bottom - lipH - 2)) {
            ctx.fillStyle = 'rgba(4, 24, 40, 0.62)';
            ctx.beginPath();
            ctx.arc(x + w / 2, cy, fr, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = this.fingerFont;
            ctx.fillText(FINGER_LABELS[finger], x + w / 2, cy + 1);
          }
        }
      }
    }
    ctx.restore();
  }

  private drawLine(f: FrameState, calm: boolean): void {
    const { ctx, width, hitY } = this;
    const phase = calm ? 0 : beatPhase(this.grid, f.time);
    const pulse = f.running && this.grid && !calm ? (1 - phase) * 0.25 : 0;
    ctx.globalAlpha = Math.min(1, 0.5 + this.energy * 0.45 + pulse);
    ctx.fillStyle = this.bandGrad;
    ctx.fillRect(0, hitY - 80, width, 80);
    ctx.globalAlpha = 1;
    // The landing line: a bright, thick rail the notes land on.
    ctx.fillStyle = this.lineGrad;
    ctx.fillRect(0, hitY - 3, width, 5);
    ctx.fillStyle = 'rgba(255, 125, 110, 0.9)';
    ctx.fillRect(0, hitY + 2, width, FELT - 2);
  }

  private drawKeys(f: FrameState, calm: boolean): void {
    const { kh, hitY } = this;
    const ctx = this.keys;
    const top = hitY + FELT;
    const wrongMidi = f.wrong && f.now - f.wrong.at < 420 ? f.wrong.midi : -1;
    const wrongFade = wrongMidi >= 0 && f.wrong ? 1 - (f.now - f.wrong.at) / 420 : 0;
    const pulse = calm ? 0.6 : 0.5 + 0.5 * Math.sin(f.now * 0.009);
    const from = this.pan - this.whiteW;
    const to = this.pan + this.width + this.whiteW;
    const letters = f.keyLetters;

    // White keys: soft cream, rounded at the front, with felt between them.
    for (const m of this.whites) {
      const x = this.keyX[m];
      if (x < from || x > to) continue;
      const w = this.keyW[m];
      const held = f.held.has(m);
      const dip = held ? 3 : 0;
      ctx.fillStyle = this.whiteGrad;
      ctx.beginPath();
      ctx.roundRect(x + 1, top + dip, w - 2, kh - FELT - dip - 1, WHITE_RADII);
      ctx.fill();
      if (held || f.expected.has(m) || m === wrongMidi) {
        this.tintKey(m, x + 1, top + dip, w - 2, kh - FELT - dip - 1, held, f.expected.has(m), m === wrongMidi ? wrongFade : 0, pulse, false);
      }
      // The front edge of the key; a pressed key shows less of it.
      ctx.fillStyle = held ? 'rgba(120, 80, 20, 0.08)' : 'rgba(120, 80, 20, 0.14)';
      ctx.fillRect(x + 4, hitY + kh - (held ? 5 : 9), w - 8, held ? 3 : 6);
    }

    // Glow rising from keys that are held.
    if (!calm) {
      ctx.globalCompositeOperation = 'lighter';
      for (const m of f.held) {
        if (m < 0 || m > 127 || !this.keyIn[m]) continue;
        const sprite = this.activeHand[m] === 2 ? this.glowLeft : this.activeHand[m] === 1 ? this.glowRight : this.glowWhite;
        const w = this.keyW[m] * 2.8;
        ctx.globalAlpha = 0.6;
        ctx.drawImage(sprite, this.keyX[m] + this.keyW[m] / 2 - w / 2, hitY - w * 0.55, w, w);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Black keys: deep ink-blue, rounded, with a soft shine at the front.
    const bh = kh * BLACK_DEPTH;
    for (const m of this.blacks) {
      const x = this.keyX[m];
      if (x < from || x > to) continue;
      const w = this.keyW[m];
      const held = f.held.has(m);
      const dip = held ? 2 : 0;
      ctx.fillStyle = 'rgba(2, 14, 26, 0.3)';
      ctx.fillRect(x + 2, top, w, bh + 4);
      ctx.fillStyle = this.blackGrad;
      ctx.beginPath();
      ctx.roundRect(x, top, w, bh - (held ? 1 : 0), BLACK_RADII);
      ctx.fill();
      if (held || f.expected.has(m) || m === wrongMidi) {
        this.tintKey(m, x, top, w, bh - 1, held, f.expected.has(m), m === wrongMidi ? wrongFade : 0, pulse, true);
      }
      ctx.fillStyle = held ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(x + 3, top + bh - (held ? 6 : 10) - dip, w - 6, held ? 3 : 5);
    }

    // Letters for the computer keyboard (in a paper chip), and C names so you can find your place.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const showLetters = letters.size > 0;
    const ls = this.letterSize;
    for (const m of this.whites) {
      const x = this.keyX[m];
      if (x < from || x > to) continue;
      const w = this.keyW[m];
      const cx = x + w / 2;
      const letter = showLetters ? letters.get(m) : undefined;
      const cName = m % 12 === 0 && w >= 18;
      const baseY = hitY + kh - (cName ? 22 : 12);
      if (letter && w >= 20) {
        const half = Math.min(w / 2 - 3, ls * 0.75);
        const cy = baseY - ls * 0.6;
        ctx.fillStyle = f.held.has(m) ? 'rgba(16, 48, 74, 0.16)' : '#f3e1bd';
        ctx.beginPath();
        ctx.roundRect(cx - half, cy - ls * 0.68, half * 2, ls * 1.36, 7);
        ctx.fill();
        ctx.font = this.letterFont;
        ctx.fillStyle = INK_TEXT;
        ctx.fillText(letter, cx, cy + 1);
      }
      if (cName) {
        ctx.font = this.cFont;
        ctx.fillStyle = '#5c6f7d';
        ctx.fillText(C_LABELS[m], cx, hitY + kh - 13);
      }
    }
    if (showLetters) {
      ctx.font = this.letterFontBlack;
      for (const m of this.blacks) {
        const x = this.keyX[m];
        if (x < from || x > to) continue;
        const letter = letters.get(m);
        if (!letter || this.keyW[m] < 12) continue;
        ctx.fillStyle = CREAM;
        ctx.fillText(letter, x + this.keyW[m] / 2, top + bh - 20);
      }
    }

    // Learn mode: a "press here" dot with a ring that keeps reaching out, and a pointer bobbing toward it.
    if (f.expected.size > 0) {
      const wave = calm ? 0.4 : (f.now % 1100) / 1100;
      const bob = calm ? 0 : Math.sin(f.now * 0.008) * 4;
      for (const m of f.expected) {
        if (m < 0 || m > 127 || !this.keyIn[m]) continue;
        const x = this.keyX[m];
        if (x < from || x > to) continue;
        const w = this.keyW[m];
        const black = isBlackKey(m);
        const cx = x + w / 2;
        const r = Math.max(6, Math.min(14, w * 0.3));
        // White keys: just below the black keys, clear of the letter chip at the front.
        let cy = black ? top + bh * 0.55 : top + bh + r + 5;
        if (!black && letters.has(m)) cy = Math.min(cy, hitY + kh - (m % 12 === 0 && w >= 18 ? 22 : 12) - ls * 1.3 - r - 4);
        const paint = (this.nextHand[m] || this.activeHand[m]) === 2 ? this.left : this.right;
        ctx.globalAlpha = 0.85 * (1 - wave);
        ctx.strokeStyle = paint.base;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2 + wave * r * 1.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = paint.base;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // The pointer: a soft rounded chevron above the dot.
        const py = cy - r - 12 + bob;
        const pw = Math.min(w * 0.32, 11);
        ctx.strokeStyle = black ? CREAM : paint.deep;
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - pw, py - pw * 0.6);
        ctx.lineTo(cx, py + pw * 0.4);
        ctx.lineTo(cx + pw, py - pw * 0.6);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    }
  }

  private tintKey(m: number, x: number, y: number, w: number, h: number, held: boolean, expected: boolean, wrong: number, pulse: number, black: boolean): void {
    const ctx = this.keys;
    const hand = this.activeHand[m] || this.nextHand[m];
    const paint = hand === 2 ? this.left : this.right;
    const radii = black ? BLACK_RADII : WHITE_RADII;
    if (held) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = hand ? paint.base : '#8fd3ff';
    } else if (expected) {
      // A strong pulse: the key to press next is impossible to miss.
      ctx.globalAlpha = 0.55 + 0.45 * pulse;
      ctx.fillStyle = paint.base;
    }
    if (held || expected) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radii);
      ctx.fill();
    }
    if (wrong > 0) {
      ctx.globalAlpha = 0.85 * wrong;
      ctx.fillStyle = '#ff6b5e';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radii);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.bgCanvas.remove();
    this.canvas.remove();
    this.keysCanvas.remove();
  }
}

/** Cream badges with the note name in ink, one per pitch class, at device resolution. */
function nameBadges(font: string, r: number, maxW: number, ratio: number): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const label = NAMES[pc];
    const half = label.length > 1 ? Math.max(r, Math.min(maxW / 2 - 1, r * 1.3)) : r;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(half * 2 * ratio));
    c.height = Math.max(1, Math.ceil(r * 2 * ratio));
    const g = c.getContext('2d');
    if (g) {
      g.scale(ratio, ratio);
      g.fillStyle = CREAM;
      g.beginPath();
      g.roundRect(0, 0, half * 2, r * 2, r);
      g.fill();
      g.fillStyle = INK_TEXT;
      g.font = font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, half, r + 1);
    }
    out.push(c);
  }
  return out;
}

function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export const createFallingView = (host: HTMLElement): StageView => new FallingView(host);
