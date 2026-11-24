import { GRADES, gradeFor, type Grade, type ScoreKeeper } from './scoring';
import type { Session } from './session';
import { indexNotes, visibleSpan, type NoteIndex, type Span } from './stage';
import type { FrameState, StageView } from './view';

/**
 * Visual feedback on top of the stage: bursts on hits, soft marks on wrong keys,
 * and so on. It gets its own transparent canvas laid over the stage view
 * (pointer events pass through it).
 */
export interface Effects {
  resize(width: number, height: number, pixelRatio: number): void;
  /** Called every frame after the view has drawn. `view` gives key positions via keyRect. */
  draw(frame: FrameState, view: StageView): void;
  /** A shower of confetti, for a new personal best. */
  celebrate?(): void;
  destroy(): void;
}

// Colour slots for sprites.
const RIGHT = 0;
const LEFT = 1;
const GOLD = 2;
const WHITE = 3;
const RED = 4;
const GREY = 5;
const CORAL = 6;
const MINT = 7;

const MAX_PARTICLES = 700;
const CREAMY = WHITE;
const CONFETTI = [GOLD, MINT, CORAL, RIGHT, LEFT, WHITE];
const MAX_BEAMS = 32;
const MAX_RINGS = 32;
const MAX_POPS = 14;
const MAX_QUEUE = 64;

const EV_HIT = 0;
const EV_MISS = 1;
const EV_WRONG = 2;
const EV_MILESTONE = 3;

const GRADE_COLOR: Record<Grade, string> = { perfect: '#ffd23f', good: '#fff8ec', early: '#8fd3ff', late: '#8fd3ff' };
/** The words that pop up from the key: short, warm, and a cheer for the best ones. */
const GRADE_WORD: Record<Grade, string> = { perfect: 'Perfect!', good: 'Good!', early: 'Early', late: 'Late' };
const DISPLAY_FONT = "Fredoka, ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif";

function readColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

function dot(color: string, size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return c;
}

/** A small five-pointed sparkle, for the best hits and the confetti. */
function star(color: string, size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const cx = size / 2;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? size * 0.46 : size * 0.2;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      if (k === 0) g.moveTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
      else g.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.stroke();
  }
  return c;
}

/** Each grade word as a picture: outlined in deep ocean so it reads on any note. Index = GRADES order. */
function makeWords(size: number, ratio: number): HTMLCanvasElement[] {
  return GRADES.map((grade) => {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    if (!g) return c;
    const font = `600 ${size * ratio}px ${DISPLAY_FONT}`;
    g.font = font;
    const pad = 6 * ratio;
    c.width = Math.ceil(g.measureText(GRADE_WORD[grade]).width + pad * 2);
    c.height = Math.ceil(size * 1.5 * ratio);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 5 * ratio;
    g.strokeStyle = 'rgba(3, 22, 38, 0.8)';
    g.strokeText(GRADE_WORD[grade], c.width / 2, c.height / 2);
    g.fillStyle = GRADE_COLOR[grade];
    g.fillText(GRADE_WORD[grade], c.width / 2, c.height / 2);
    return c;
  });
}

function beam(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    const v = g.createLinearGradient(0, 256, 0, 0);
    v.addColorStop(0, color);
    v.addColorStop(0.3, color);
    v.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = v;
    g.fillRect(0, 0, 32, 256);
    // Brighter core down the middle.
    g.globalCompositeOperation = 'lighter';
    const h = g.createLinearGradient(0, 0, 32, 0);
    h.addColorStop(0, 'rgba(255, 255, 255, 0)');
    h.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
    h.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = h;
    g.fillRect(0, 0, 32, 256);
  }
  return c;
}

/**
 * Particles, light beams, rings and grade words, all from fixed pools so a
 * busy song never allocates per frame. With reduced motion it keeps the
 * information (grade words, a soft glow) and drops the movement.
 */
export function createEffects(session: Session, layer: HTMLCanvasElement, keeper?: ScoreKeeper): Effects {
  const ctx = layer.getContext('2d');
  const right = readColor('--right', '#5aa9ff');
  const left = readColor('--left', '#ffa24a');
  const palette = [right, left, '#ffd23f', '#fff8ec', '#ff6b5e', '#7a95a8', '#ff7d6e', '#5fe3b8'];
  const dots = palette.map((c) => dot(c));
  const stars = palette.map((c) => star(c));
  const beams = palette.map((c) => beam(c));
  // The grade words, drawn once per size (text with an outline is slow to draw every frame).
  let words: HTMLCanvasElement[] = [];
  let wordScale = 1;
  let wordPx = 22;
  /** Words closer than this share one spot, so a chord or a fast run never prints words on top of each other. */
  let crowd = 84;
  // The display font may arrive after the first size: draw the words again once it has.
  void document.fonts?.ready.then(() => {
    if (words.length) words = makeWords(wordPx, wordScale);
  });

  // Particles
  const px = new Float32Array(MAX_PARTICLES);
  const py = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const grav = new Float32Array(MAX_PARTICLES);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES);
  const pcol = new Uint8Array(MAX_PARTICLES);
  const pstar = new Uint8Array(MAX_PARTICLES); // 1: drawn as a sparkle, 0: a soft dot
  const spin = new Float32Array(MAX_PARTICLES);
  let nextParticle = 0;
  let alive = 0;

  // Beams travelling up a lane, rings on the line, grade words
  const bx = new Float32Array(MAX_BEAMS);
  const bw = new Float32Array(MAX_BEAMS);
  const by = new Float32Array(MAX_BEAMS);
  const bBorn = new Float64Array(MAX_BEAMS).fill(-1e9);
  const bcol = new Uint8Array(MAX_BEAMS);
  let nextBeam = 0;
  const rx = new Float32Array(MAX_RINGS);
  const ry = new Float32Array(MAX_RINGS);
  const rw = new Float32Array(MAX_RINGS);
  const rBorn = new Float64Array(MAX_RINGS).fill(-1e9);
  const rcol = new Uint8Array(MAX_RINGS);
  let nextRing = 0;
  const popX = new Float32Array(MAX_POPS);
  const popY = new Float32Array(MAX_POPS);
  const popBorn = new Float64Array(MAX_POPS).fill(-1e9);
  const popGrade = new Uint8Array(MAX_POPS);
  let nextPop = 0;

  // Events wait here until draw, where key positions are known.
  const qKind = new Uint8Array(MAX_QUEUE);
  const qMidi = new Int16Array(MAX_QUEUE);
  const qGrade = new Uint8Array(MAX_QUEUE);
  const qHand = new Uint8Array(MAX_QUEUE);
  let qLen = 0;
  const push = (kind: number, midi: number, grade: number, hand: number) => {
    if (qLen >= MAX_QUEUE) return;
    qKind[qLen] = kind;
    qMidi[qLen] = midi;
    qGrade[qLen] = grade;
    qHand[qLen] = hand;
    qLen++;
  };

  let width = 0;
  let height = 0;
  let missAt = -1e9;
  let celebrateAt = -1e9;
  let wantConfetti = false;
  let dirty = true;
  let shown = true;
  let lastNow = 0;
  let index: NoteIndex = indexNotes([]);
  let indexed: readonly unknown[] | null = null;
  const span: Span = { from: 0, to: 0 };
  let sparkleTick = 0;
  let vignette: CanvasGradient | null = null;

  const unsubscribe: (() => void)[] = [];
  const handOf = (hand: string) => (hand === 'left' ? LEFT : RIGHT);
  if (keeper) {
    unsubscribe.push(
      keeper.onScore((e, cleared) => {
        if (cleared) return;
        if (e.kind === 'hit' && e.judgement) {
          push(EV_HIT, e.midi, GRADES.indexOf(e.judgement.grade), handOf(e.hand));
          if (e.judgement.combo > 0 && e.judgement.combo % 25 === 0) push(EV_MILESTONE, e.midi, 0, GOLD);
        }
      }),
    );
  } else {
    unsubscribe.push(
      session.on('hit', (e) => push(EV_HIT, e.note.midi, GRADES.indexOf(gradeFor(e.error, session.options.mode, session.options.speed)), handOf(e.note.hand))),
    );
  }
  unsubscribe.push(
    session.on('miss', (e) => push(EV_MISS, e.note.midi, 0, GREY)),
    session.on('wrong', (e) => push(EV_WRONG, e.midi, 0, RED)),
    session.on('reset', () => {
      qLen = 0;
    }),
  );

  function spawn(x: number, y: number, count: number, color: number, speed: number, up: number, g: number, lifeS: number, s: number, sparkle = false): void {
    for (let k = 0; k < count; k++) {
      const i = nextParticle;
      nextParticle = (nextParticle + 1) % MAX_PARTICLES;
      if (life[i] <= 0) alive++;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      px[i] = x + (Math.random() - 0.5) * 6;
      py[i] = y;
      vx[i] = Math.cos(a) * v;
      vy[i] = Math.sin(a) * v * 0.6 - up * (0.5 + Math.random() * 0.5);
      grav[i] = g;
      maxLife[i] = life[i] = lifeS * (0.6 + Math.random() * 0.4);
      size[i] = s * (0.6 + Math.random() * 0.8);
      pcol[i] = color;
      pstar[i] = sparkle ? 1 : 0;
      spin[i] = (Math.random() - 0.5) * 8;
    }
  }


  function handle(f: FrameState, view: StageView): void {
    const calm = f.reduceMotion;
    for (let q = 0; q < qLen; q++) {
      const kind = qKind[q];
      const rect = view.keyRect?.(qMidi[q]) ?? null;
      if (!rect && kind !== EV_MISS) continue;
      const cx = rect ? rect.x + rect.w / 2 : width / 2;
      const y = rect ? rect.y : height * 0.8;
      const w = rect ? rect.w : 30;
      if (kind === EV_HIT) {
        const grade = GRADES[qGrade[q]] ?? 'good';
        const color = qHand[q];
        const strong = grade === 'perfect';
        const r = nextRing;
        nextRing = (nextRing + 1) % MAX_RINGS;
        rx[r] = cx;
        ry[r] = y;
        rw[r] = w;
        rBorn[r] = f.now;
        rcol[r] = strong ? GOLD : color;
        // One word per spot: a chord or a quick run would otherwise print words on top of each other.
        // A word still floating near this spot is reused (restarted with the new grade) instead.
        let crowded = false;
        for (let k = 0; k < MAX_POPS; k++) {
          if (f.now - popBorn[k] < 850 && Math.abs(popX[k] - cx) < crowd) {
            crowded = true;
            if (f.now - popBorn[k] > 120) {
              popBorn[k] = f.now;
              popGrade[k] = qGrade[q];
            }
            break;
          }
        }
        if (!crowded) {
          const p = nextPop;
          nextPop = (nextPop + 1) % MAX_POPS;
          popX[p] = Math.min(width - 40, Math.max(40, cx));
          popY[p] = y - 24;
          popBorn[p] = f.now;
          popGrade[p] = qGrade[q];
        }
        if (!calm) {
          const b = nextBeam;
          nextBeam = (nextBeam + 1) % MAX_BEAMS;
          bx[b] = rect ? rect.x : cx - 10;
          bw[b] = w;
          by[b] = y;
          bBorn[b] = f.now;
          bcol[b] = color;
          spawn(cx, y, strong ? 18 : grade === 'good' ? 12 : 6, color, strong ? 260 : 190, 160, 260, 0.75, 9);
          // The best hits throw a few sparkles in the party colours.
          if (strong) {
            spawn(cx, y, 3, GOLD, 210, 230, 240, 0.95, 14, true);
            spawn(cx, y, 2, CORAL, 190, 210, 240, 0.9, 12, true);
            spawn(cx, y, 2, MINT, 190, 210, 240, 0.9, 12, true);
          }
        }
      } else if (kind === EV_MILESTONE) {
        if (!calm) {
          for (let k = 0; k < 12; k++) {
            const x = (width * (k + 0.5)) / 12;
            spawn(x, y, 5, k % 3 === 0 ? GOLD : k % 3 === 1 ? MINT : CORAL, 220, 280, 220, 1.2, 10);
            spawn(x, y, 2, k % 2 ? GOLD : CREAMY, 200, 300, 200, 1.3, 16, true);
          }
        }
        celebrateAt = Math.max(celebrateAt, f.now - 900);
      } else if (kind === EV_MISS) {
        missAt = f.now;
        // A missed note never moves the screen: only a soft wash and a few grey specks.
        if (!calm && rect) spawn(cx, y, 6, GREY, 60, 30, 40, 0.6, 7);
      } else if (kind === EV_WRONG) {
        if (!calm) spawn(cx, y + 6, 8, RED, 140, 60, 300, 0.45, 6);
      }
    }
    qLen = 0;

    if (wantConfetti) {
      wantConfetti = false;
      celebrateAt = f.now;
      if (!calm) {
        for (let k = 0; k < 220; k++) {
          const i = nextParticle;
          spawn(Math.random() * width, -10, 1, CONFETTI[k % CONFETTI.length], 120, -60, 160, 3.2, k % 3 === 0 ? 18 : 12, k % 3 === 0);
          vx[i] = (Math.random() - 0.5) * 160;
          vy[i] = 40 + Math.random() * 160;
        }
      }
    }

    // Sparks fly off notes that are being held down while they drain into the key.
    if (!calm && f.running && f.held.size > 0) {
      if (indexed !== f.notes) {
        index = indexNotes(f.notes);
        indexed = f.notes;
      }
      sparkleTick++;
      if (sparkleTick % 3 === 0) {
        visibleSpan(index, f.time, f.time, span);
        for (let i = span.from; i < span.to; i++) {
          const n = f.notes[i];
          if (f.states[i] !== 'hit' || n.start > f.time || n.start + n.dur < f.time || !f.held.has(n.midi)) continue;
          const rect = view.keyRect?.(n.midi);
          if (rect) spawn(rect.x + rect.w / 2, rect.y - 2, 1, handOf(n.hand), 70, 110, -20, 0.6, 7);
        }
      }
    }
  }

  return {
    resize(w, h, ratio) {
      width = w;
      height = h;
      const r = Math.min(2, Math.max(1, ratio || 1));
      layer.width = Math.round(w * r);
      layer.height = Math.round(h * r);
      ctx?.setTransform(r, 0, 0, r, 0, 0);
      if (ctx) {
        vignette = ctx.createLinearGradient(0, h * 0.45, 0, h);
        vignette.addColorStop(0, 'rgba(255, 107, 94, 0)');
        vignette.addColorStop(1, 'rgba(255, 107, 94, 0.22)');
      }
      wordPx = Math.round(Math.max(17, Math.min(26, w / 52)));
      wordScale = r;
      words = makeWords(wordPx, r);
      crowd = Math.max(84, (words[0]?.width ?? 0) / r + 8);
      dirty = true;
    },

    draw(f, view) {
      if (!ctx) return;
      const dt = lastNow ? Math.min(0.1, Math.max(0, (f.now - lastNow) / 1000)) : 0;
      lastNow = f.now;
      handle(f, view);
      const now = f.now;
      const busy = alive > 0 || now - missAt < 400 || now - celebrateAt < 1600 || anyRecent(bBorn, now, 500) || anyRecent(rBorn, now, 450) || anyRecent(popBorn, now, 850);
      // An empty layer still costs the browser a full-screen blend every frame: hide it while idle.
      if (busy !== shown) {
        shown = busy;
        layer.style.visibility = busy ? '' : 'hidden';
      }
      if (!busy && !dirty) return;
      dirty = busy;
      ctx.clearRect(0, 0, width, height);

      // A soft red wash from below on a miss. 
      if (now - missAt < 400 && vignette) {
        ctx.globalAlpha = (1 - (now - missAt) / 400) * (f.reduceMotion ? 1 : 0.7);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, height * 0.45, width, height * 0.55);
      }
      // A warm glow for milestones and new bests.
      if (now - celebrateAt < 1600) {
        const a = 1 - (now - celebrateAt) / 1600;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * 0.5;
        const s = Math.max(width, height);
        ctx.drawImage(dots[GOLD], width / 2 - s / 2, height * 0.55 - s / 2, s, s);
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.globalCompositeOperation = 'lighter';
      for (let b = 0; b < MAX_BEAMS; b++) {
        const age = now - bBorn[b];
        if (age > 500 || age < 0) continue;
        const p = age / 500;
        const ease = 1 - (1 - p) * (1 - p);
        const lineY = by[b];
        const h = lineY * 0.85 * ease;
        ctx.globalAlpha = 0.55 * (1 - p);
        ctx.drawImage(beams[bcol[b]], bx[b], lineY - h, bw[b], h);
      }
      for (let r = 0; r < MAX_RINGS; r++) {
        const age = now - rBorn[r];
        if (age > 450 || age < 0) continue;
        const p = age / 450;
        const grow = f.reduceMotion ? 1 : 0.6 + p * 1.1;
        const s = rw[r] * 2.2 * grow;
        ctx.globalAlpha = 0.9 * (1 - p);
        ctx.drawImage(dots[rcol[r]], rx[r] - s / 2, ry[r] - s / 2, s, s);
      }
      // Particles
      if (alive > 0) {
        alive = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt;
          if (life[i] <= 0) continue;
          alive++;
          vy[i] += grav[i] * dt;
          vx[i] *= 1 - 0.9 * dt;
          px[i] += vx[i] * dt;
          py[i] += vy[i] * dt;
          const k = life[i] / maxLife[i];
          const s = size[i] * (0.5 + k * 0.5);
          ctx.globalAlpha = k;
          ctx.drawImage(pstar[i] ? stars[pcol[i]] : dots[pcol[i]], px[i] - s / 2, py[i] - s / 2, s, s);
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // Grade words pop out of the key with a little bounce, then float up and fade.
      for (let p = 0; p < MAX_POPS; p++) {
        const age = now - popBorn[p];
        if (age > 850 || age < 0) continue;
        const k = age / 850;
        const g = popGrade[p];
        const sprite = words[g];
        if (!sprite) continue;
        const rise = f.reduceMotion ? 0 : 38 * (1 - (1 - k) * (1 - k));
        // Overshoot to 1.18 in the first 160 ms, settle at 1.
        const grow = f.reduceMotion ? 1 : age < 160 ? 0.55 + 0.63 * (age / 160) : age < 280 ? 1.18 - 0.18 * ((age - 160) / 120) : 1;
        const s = (grow * (g === 0 ? 1.12 : 1)) / wordScale;
        const w = sprite.width * s;
        const hh = sprite.height * s;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.drawImage(sprite, popX[p] - w / 2, popY[p] - rise - hh / 2, w, hh);
      }
      ctx.globalAlpha = 1;
    },

    celebrate() {
      wantConfetti = true;
      dirty = true;
    },

    destroy() {
      for (const off of unsubscribe) off();
      layer.style.visibility = '';
      ctx?.clearRect(0, 0, width, height);
    },
  };
}

function anyRecent(born: Float64Array, now: number, ms: number): boolean {
  for (let i = 0; i < born.length; i++) if (now - born[i] < ms && now >= born[i]) return true;
  return false;
}
