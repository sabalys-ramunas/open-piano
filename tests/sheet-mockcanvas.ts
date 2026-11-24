/**
 * A tiny stand-in for CanvasRenderingContext2D that records drawing as SVG,
 * so sheet rendering can run (and be looked at) without a browser.
 */
type M = [number, number, number, number, number, number];

const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

type Op =
  | ['M' | 'L', number, number]
  | ['Q', number, number, number, number]
  | ['E', number, number, number, number, number, number, number, boolean]
  | ['Z'];

export class MockPath2D {
  ops: Op[] = [];
  moveTo(x: number, y: number) {
    this.ops.push(['M', x, y]);
  }
  lineTo(x: number, y: number) {
    this.ops.push(['L', x, y]);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.ops.push(['Q', cx, cy, x, y]);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false) {
    this.ops.push(['E', x, y, r, r, 0, a0, a1, ccw]);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) {
    this.ops.push(['E', x, y, rx, ry, rot, a0, a1, ccw]);
  }
  closePath() {
    this.ops.push(['Z']);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.ops.push(['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']);
  }
}

export class MockContext extends MockPath2D {
  out: string[] = [];
  m: M = [1, 0, 0, 1, 0, 0];
  stack: { m: M; fill: string; stroke: string; alpha: number; font: string }[] = [];
  fillStyle: string = '#000';
  strokeStyle: string = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign: string = 'left';
  textBaseline: string = 'alphabetic';
  lineCap = 'butt';
  shapes = 0;
  constructor(
    public width: number,
    public height: number,
  ) {
    super();
  }
  save() {
    this.stack.push({ m: [...this.m] as M, fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha, font: this.font });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.m = s.m;
    this.fillStyle = s.fill;
    this.strokeStyle = s.stroke;
    this.globalAlpha = s.alpha;
    this.font = s.font;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = [a, b, c, d, e, f];
  }
  resetTransform() {
    this.m = [1, 0, 0, 1, 0, 0];
  }
  translate(x: number, y: number) {
    this.m = mul(this.m, [1, 0, 0, 1, x, y]);
  }
  scale(x: number, y: number) {
    this.m = mul(this.m, [x, 0, 0, y, 0, 0]);
  }
  beginPath() {
    this.ops = [];
  }
  private pt(x: number, y: number): string {
    const m = this.m;
    return `${(m[0] * x + m[2] * y + m[4]).toFixed(2)} ${(m[1] * x + m[3] * y + m[5]).toFixed(2)}`;
  }
  private svgPath(ops: Op[]): string {
    let d = '';
    let cur: [number, number] = [0, 0];
    for (const op of ops) {
      if (op[0] === 'M' || op[0] === 'L') {
        d += `${op[0]}${this.pt(op[1], op[2])}`;
        cur = [op[1], op[2]];
      } else if (op[0] === 'Q') {
        for (let i = 1; i <= 12; i++) {
          const t = i / 12;
          const x = (1 - t) ** 2 * cur[0] + 2 * (1 - t) * t * op[1] + t * t * op[3];
          const y = (1 - t) ** 2 * cur[1] + 2 * (1 - t) * t * op[2] + t * t * op[4];
          d += `L${this.pt(x, y)}`;
        }
        cur = [op[3], op[4]];
      } else if (op[0] === 'E') {
        const [, cx, cy, rx, ry, rot, a0, a1, ccw] = op;
        let span = a1 - a0;
        if (ccw) span = -(Math.PI * 2 - ((a0 - a1 + Math.PI * 4) % (Math.PI * 2) || Math.PI * 2)) || -Math.PI * 2;
        const n = 32;
        for (let i = 0; i <= n; i++) {
          const a = a0 + (span * i) / n;
          const ex = rx * Math.cos(a);
          const ey = ry * Math.sin(a);
          const x = cx + ex * Math.cos(rot) - ey * Math.sin(rot);
          const y = cy + ex * Math.sin(rot) + ey * Math.cos(rot);
          d += `${i === 0 && !d.endsWith('Z') && d ? 'L' : i === 0 ? 'M' : 'L'}${this.pt(x, y)}`;
          cur = [x, y];
        }
      } else d += 'Z';
    }
    return d;
  }
  fill(a?: MockPath2D | string, b?: string) {
    const path = a instanceof MockPath2D ? a : this;
    const rule = (typeof a === 'string' ? a : b) ?? 'nonzero';
    this.shapes++;
    this.out.push(`<path d="${this.svgPath(path.ops)}" fill="${this.fillStyle}" fill-rule="${rule}" opacity="${this.globalAlpha}"/>`);
  }
  stroke() {
    this.out.push(`<path d="${this.svgPath(this.ops)}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth * this.m[0]}"/>`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.shapes++;
    this.out.push(`<path d="M${this.pt(x, y)}L${this.pt(x + w, y)}L${this.pt(x + w, y + h)}L${this.pt(x, y + h)}Z" fill="${this.fillStyle}" opacity="${this.globalAlpha}"/>`);
  }
  clearRect() {}
  clip() {}
  strokeRect() {}
  fillText(s: string, x: number, y: number) {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10) * this.m[0];
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' ? 'end' : 'start';
    const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.out.push(
      `<text x="${this.pt(x, y).split(' ')[0]}" y="${this.pt(x, y).split(' ')[1]}" font-size="${size.toFixed(1)}" font-family="${/serif/.test(this.font) && !/sans/.test(this.font) ? 'Georgia' : 'Helvetica'}" font-weight="bold" text-anchor="${anchor}" dominant-baseline="central" fill="${this.fillStyle}">${esc}</text>`,
    );
  }
  measureText(s: string) {
    return { width: s.length * 6 };
  }
  createLinearGradient() {
    return { addColorStop() {}, toString: () => 'none' };
  }
  svg(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}"><rect width="100%" height="100%" fill="white"/>${this.out.join('')}</svg>`;
  }
}
