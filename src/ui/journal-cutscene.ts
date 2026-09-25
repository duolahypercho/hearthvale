/**
 * Cinema overlay for cutscenes: letterbox bars, a slow fade, title captions (on a soft dark scrim),
 * the cinematic dialogue box (portrait medallion + name ribbon + typewriter text), choice cards and
 * painted full-screen backdrops (the evening coach window the intro letter is read against).
 * Pure DOM / 2D canvas; the cutscene system drives it.
 *
 * Input: dialogue advances on click, Space / Enter / E / X / F / C or gamepad A. Choices: click,
 * 1–4, ↑↓ (W / S, D-pad, stick) + Enter / Space / E (gamepad A); the first option is pre-selected
 * and the selection wears a gold focus ring.
 */
import './journal.css';

export interface Speaker {
  name: string;
  role: string;
  portrait: string;
}

export interface ChoiceOption {
  label: string;
  hint?: string;
}

export type Backdrop = 'coach';

export function loadStoryFonts(): void {
  if (document.getElementById('hv-story-fonts')) return;
  const l = document.createElement('link');
  l.id = 'hv-story-fonts';
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Cormorant+Garamond:ital,wght@0,600;1,500;1,600&display=swap';
  document.head.appendChild(l);
}

const NEXT = `<svg viewBox="0 0 20 14"><path d="M2 2 L10 12 L18 2 Z" fill="#c8573e" stroke="#7a2e1e" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

// ─────────────────────────────────────────────── painted backdrop: the evening coach into the valley

interface Drop {
  x: number;
  y: number;
  r: number;
  v: number;
  trail: number;
}
interface Layer {
  c: HTMLCanvasElement;
  /** Tile width (px): the strip wraps seamlessly. */
  T: number;
  /** Scroll speed, fractions of the frame width per second (near = faster). */
  speed: number;
}

/** Tiny seeded PRNG: the painting is the same valley on every run (and in every screenshot). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ridge line that wraps over the tile width T (integer-frequency sines). */
function ridge(T: number, R: () => number, parts: [number, number][]): (x: number) => number {
  const ph = parts.map(() => R() * Math.PI * 2);
  return (x) => parts.reduce((s, [k, amp], i) => s + amp * Math.sin((x / T) * Math.PI * 2 * k + ph[i]!), 0);
}

/**
 * The view from the coach window while Gran's letter is read: a dusk sky going from indigo to a
 * rose-and-amber horizon with the sun half down behind lilac mountains, lit stratus, the first
 * stars; the valley's patchwork fields and hedgerows, a village with lit windows and chimney smoke,
 * the Lantern Hall dark on its hill; a hedge-and-tree line and telegraph poles racing past, the
 * last beads of an easing rain on the glass, the coach's window frame, brass rail and curtain.
 * Each band is painted once per size into a wrapping strip and scrolled (parallax) — a handful of
 * drawImage calls a frame.
 */
class CoachWindow {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private drops: Drop[] = [];
  private t = 0;
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private sky: HTMLCanvasElement | null = null;
  private layers: Layer[] = [];
  private frame: HTMLCanvasElement | null = null;
  private stars: { x: number; y: number; r: number; p: number }[] = [];
  /** Chimneys in the village strip (tile-space x, y) for the smoke wisps. */
  private chimneys: { x: number; y: number }[] = [];

  constructor() {
    this.canvas.className = 'cin-backdrop';
    this.g = this.canvas.getContext('2d')!;
  }

  private seed(): void {
    const R = prng(7);
    this.drops = [];
    for (let i = 0; i < 70; i++) this.drops.push({ x: R(), y: R(), r: 1.1 + R() * 2.8, v: R() < 0.16 ? 0.03 + R() * 0.07 : 0, trail: 0 });
  }

  start(parent: HTMLElement): void {
    if (!this.canvas.parentElement) parent.prepend(this.canvas);
    this.resize();
    this.seed();
    this.canvas.classList.add('on');
    document.body.classList.add('hv-coach-on');
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.draw(0);
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.classList.remove('on');
    document.body.classList.remove('hv-coach-on');
  }

  private resize(): void {
    // Half resolution: soft dusk light (the canvas is scaled up by CSS).
    const w = Math.max(320, Math.round(window.innerWidth * 0.5));
    const h = Math.max(180, Math.round(window.innerHeight * 0.5));
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
    this.paint();
  }

  private mk(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    return [c, c.getContext('2d')!];
  }

  /** Paint every static band once per size. */
  private paint(): void {
    const { w, h } = this;
    const R = prng(1979);
    // ── sky
    {
      const [c, g] = this.mk(w, h);
      const sky = g.createLinearGradient(0, 0, 0, h * 0.78);
      sky.addColorStop(0, '#141838');
      sky.addColorStop(0.22, '#2c2a5e');
      sky.addColorStop(0.42, '#6a4478');
      sky.addColorStop(0.58, '#c46874');
      sky.addColorStop(0.7, '#f09a6a');
      sky.addColorStop(0.8, '#ffc27a');
      sky.addColorStop(1, '#ffd08a');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // The sun's glow (wide, then tight), and the disc half-sunk behind the far range.
      const sx = w * 0.72;
      const sy = h * 0.6;
      for (const [rad, a] of [[w * 0.62, 0.34], [w * 0.2, 0.42], [h * 0.12, 0.6]] as const) {
        const gl = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
        gl.addColorStop(0, `rgba(255,214,150,${a})`);
        gl.addColorStop(1, 'rgba(255,170,110,0)');
        g.fillStyle = gl;
        g.fillRect(0, 0, w, h);
      }
      g.fillStyle = '#fff2cc';
      g.beginPath();
      g.arc(sx, sy, h * 0.05, 0, Math.PI * 2);
      g.fill();
      // Long stratus lit from below: violet backs, rose-gold bellies, brightest near the sun
      // (painted soft: a little blur melts the lobes into one bank).
      g.filter = `blur(${Math.max(1, h * 0.004).toFixed(1)}px)`;
      for (let i = 0; i < 16; i++) {
        const cy = h * (0.12 + R() * 0.36);
        const cx = R() * w;
        const len = w * (0.12 + R() * 0.3);
        const th = h * (0.008 + R() * 0.02);
        const near = Math.max(0, 1 - Math.abs(cx - sx) / (w * 0.6)) * (cy > h * 0.3 ? 1 : 0.6);
        for (let k = 0; k < 7; k++) {
          const ex = cx + (k / 6 - 0.5) * len;
          const ew = len * (0.2 + R() * 0.2);
          const eh = th * (0.7 + R() * 0.8);
          const ey = cy + (R() - 0.5) * th;
          const cg = g.createLinearGradient(0, ey - eh, 0, ey + eh);
          cg.addColorStop(0, `rgba(${78 + near * 40},${56 + near * 20},${110 - near * 10},0.55)`);
          cg.addColorStop(0.65, `rgba(${200 + near * 55},${110 + near * 70},${120 - near * 20},${0.45 + near * 0.3})`);
          cg.addColorStop(1, `rgba(255,${180 + near * 50},140,${0.2 + near * 0.35})`);
          g.fillStyle = cg;
          g.beginPath();
          g.ellipse(ex, ey, ew, eh, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.filter = 'none';
      this.sky = c;
      this.stars = [];
      for (let i = 0; i < 46; i++) this.stars.push({ x: R() * w, y: R() * h * 0.3, r: 0.5 + R() * 1.1, p: R() * 6 });
    }
    this.layers = [];
    // ── far ranges: lilac mountains in the haze (two ranges)
    for (const [k, base, amp, top, bot, speed] of [
      [0, 0.56, 0.1, '#6c5a90', '#b27c90', 0.004],
      [1, 0.61, 0.07, '#4c4272', '#8a6480', 0.009],
    ] as const) {
      const T = Math.round(w * 1.6);
      const [c, g] = this.mk(T, h);
      const y = ridge(T, R, k === 0 ? [[3, 0.5], [7, 0.3], [13, 0.14], [29, 0.06]] : [[4, 0.5], [9, 0.3], [21, 0.12]]);
      const yy = (x: number): number => h * (base - amp * (0.5 + y(x)) * 0.9);
      const grd = g.createLinearGradient(0, h * (base - amp), 0, h * (base + 0.12));
      grd.addColorStop(0, top);
      grd.addColorStop(1, bot);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= T; x += 3) g.lineTo(x, yy(x));
      g.lineTo(T, h);
      g.fill();
      // A sunset rim on the ridge.
      g.strokeStyle = k === 0 ? 'rgba(255,200,160,0.35)' : 'rgba(255,170,140,0.22)';
      g.lineWidth = 1.2;
      g.beginPath();
      for (let x = 0; x <= T; x += 3) (x ? g.lineTo(x, yy(x)) : g.moveTo(x, yy(x)));
      g.stroke();
      this.layers.push({ c, T, speed });
    }
    // ── the valley: patchwork fields, hedgerows, a lane, the village and the dark Hall on its hill
    {
      const T = Math.round(w * 2.2);
      const [c, g] = this.mk(T, h);
      const y = ridge(T, R, [[3, 0.55], [5, 0.3], [11, 0.12]]);
      const top = (x: number): number => h * (0.67 - 0.045 * (0.5 + y(x)));
      const hill = new Path2D();
      hill.moveTo(0, h);
      for (let x = 0; x <= T; x += 3) hill.lineTo(x, top(x));
      hill.lineTo(T, h);
      hill.closePath();
      const hg = g.createLinearGradient(0, h * 0.6, 0, h * 0.85);
      hg.addColorStop(0, '#5a5068');
      hg.addColorStop(1, '#2a2436');
      g.fillStyle = hg;
      g.fill(hill);
      g.save();
      g.clip(hill);
      const FIELDS = ['rgba(120,140,96,0.42)', 'rgba(168,140,90,0.38)', 'rgba(90,110,80,0.4)', 'rgba(150,120,110,0.3)', 'rgba(110,130,70,0.38)'];
      const band = h * 0.02;
      for (let j = 0; j < 9; j++) {
        let x = 0;
        while (x < T) {
          const x1 = Math.min(T, x + w * (0.05 + R() * 0.12));
          g.fillStyle = FIELDS[Math.floor(R() * FIELDS.length)]!;
          g.beginPath();
          const off = j * band * (1 + j * 0.25);
          g.moveTo(x, top(x) + off);
          for (let xx = x; xx <= x1; xx += 3) g.lineTo(xx, top(xx) + off);
          for (let xx = x1; xx >= x; xx -= 3) g.lineTo(xx, top(xx) + off + band * (1 + j * 0.25));
          g.fill();
          // Hedgerow down the field's edge and along its foot.
          g.fillStyle = 'rgba(28,22,38,0.75)';
          for (let yy = top(x1) + off; yy < top(x1) + off + band * (1 + j * 0.25); yy += 1.6) {
            g.beginPath();
            g.arc(x1 + (R() - 0.5), yy, 0.9 + R() * 0.5, 0, Math.PI * 2);
            g.fill();
          }
          for (let xx = x; xx < x1; xx += 2.2) {
            g.beginPath();
            g.arc(xx, top(xx) + off + band * (1 + j * 0.25) + (R() - 0.5) * 0.6, 0.8 + R() * 0.6, 0, Math.PI * 2);
            g.fill();
          }
          x = x1;
        }
      }
      // A pale lane winding down through the fields.
      g.strokeStyle = 'rgba(236,196,160,0.3)';
      g.lineWidth = 1.6;
      g.beginPath();
      for (let x = 0; x <= T; x += 4) {
        const yy = top(x) + h * (0.06 + 0.03 * Math.sin((x / T) * Math.PI * 2 * 4));
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
      // Warm last light across the crest.
      const rim = g.createLinearGradient(0, h * 0.6, 0, h * 0.7);
      rim.addColorStop(0, 'rgba(255,170,110,0.28)');
      rim.addColorStop(1, 'rgba(255,170,110,0)');
      g.fillStyle = rim;
      g.fillRect(0, 0, T, h);
      g.restore();
      // Villages: gabled cottages, lit windows, a chimney each.
      this.chimneys = [];
      const cottage = (x: number, s: number): void => {
        const b = top(x) + h * 0.012;
        const cw = h * 0.028 * s;
        const ch = h * 0.02 * s;
        g.fillStyle = '#2a2034';
        g.fillRect(x - cw / 2, b - ch, cw, ch);
        g.fillStyle = '#1c1624';
        g.beginPath();
        g.moveTo(x - cw * 0.62, b - ch);
        g.lineTo(x, b - ch - cw * 0.5);
        g.lineTo(x + cw * 0.62, b - ch);
        g.fill();
        g.fillRect(x + cw * 0.18, b - ch - cw * 0.5, cw * 0.14, cw * 0.32);
        this.chimneys.push({ x: x + cw * 0.25, y: b - ch - cw * 0.5 });
        g.save();
        g.globalCompositeOperation = 'lighter';
        for (const wx of R() < 0.5 ? [-0.22] : [-0.22, 0.2]) {
          const px = x + wx * cw;
          const py = b - ch * 0.55;
          const gl = g.createRadialGradient(px, py, 0, px, py, cw * 0.7);
          gl.addColorStop(0, 'rgba(255,190,100,0.55)');
          gl.addColorStop(1, 'rgba(255,160,80,0)');
          g.fillStyle = gl;
          g.fillRect(px - cw, py - cw, cw * 2, cw * 2);
          g.fillStyle = '#ffd890';
          g.fillRect(px - cw * 0.07, py - cw * 0.09, cw * 0.14, cw * 0.18);
        }
        g.restore();
      };
      for (const vx of [0.1, 0.24, 0.52, 0.8]) {
        const n = 6 + Math.floor(R() * 3);
        for (let i = 0; i < n; i++) cottage(T * vx + (i - n / 2) * h * 0.045 + (R() - 0.5) * h * 0.02, 1.05 + R() * 0.5);
      }
      // The Lantern Hall on its knoll: bell-cote, round window, every pane dark.
      const hx = T * 0.36;
      const hb = top(hx) + h * 0.01;
      const hw = h * 0.075;
      const hh = h * 0.042;
      g.fillStyle = '#231a2e';
      g.fillRect(hx - hw / 2, hb - hh, hw, hh);
      g.fillStyle = '#18121f';
      g.beginPath();
      g.moveTo(hx - hw * 0.58, hb - hh);
      g.lineTo(hx, hb - hh - hw * 0.34);
      g.lineTo(hx + hw * 0.58, hb - hh);
      g.fill();
      g.fillRect(hx - hw * 0.06, hb - hh - hw * 0.52, hw * 0.12, hw * 0.2);
      g.beginPath();
      g.moveTo(hx - hw * 0.1, hb - hh - hw * 0.52);
      g.lineTo(hx, hb - hh - hw * 0.66);
      g.lineTo(hx + hw * 0.1, hb - hh - hw * 0.52);
      g.fill();
      g.strokeStyle = 'rgba(120,100,140,0.5)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(hx, hb - hh - hw * 0.12, hw * 0.06, 0, Math.PI * 2);
      g.stroke();
      for (let i = -2; i <= 2; i++) {
        if (!i) continue;
        g.fillStyle = 'rgba(70,60,90,0.8)';
        g.fillRect(hx + i * hw * 0.17 - hw * 0.035, hb - hh * 0.7, hw * 0.07, hh * 0.38);
      }
      // Little orchards on the slopes: rows of small round trees standing on the fields (a trunk, a
      // canopy with the last warm light on its upper-left, a soft shadow at its foot) — loose dark
      // dots floating over the fields read as holes in the painting.
      const tree = (x: number, yy: number, r: number): void => {
        g.fillStyle = 'rgba(20,14,28,0.35)';
        g.beginPath();
        g.ellipse(x + r * 0.5, yy + r * 0.1, r * 1.1, r * 0.32, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#2a2030';
        g.fillRect(x - r * 0.12, yy - r * 1.1, r * 0.24, r * 1.1);
        const cy = yy - r * 1.5;
        const cg = g.createRadialGradient(x - r * 0.4, cy - r * 0.45, r * 0.1, x, cy, r * 1.05);
        cg.addColorStop(0, '#8a7a6a');
        cg.addColorStop(0.45, '#4a4258');
        cg.addColorStop(1, '#2c2538');
        g.fillStyle = cg;
        g.beginPath();
        g.arc(x, cy, r, 0, Math.PI * 2);
        g.fill();
      };
      for (let i = 0; i < 16; i++) {
        const x0 = R() * T;
        const d = 0.012 + R() * 0.07;
        const r = h * (0.0045 + d * 0.05);
        const n = 3 + Math.floor(R() * 4);
        for (let k = 0; k < n; k++) {
          for (const row of [0, 1]) {
            const x = x0 + k * r * 3.1 + row * r * 1.5;
            tree(x, top(x) + h * d + row * r * 1.3, r);
          }
        }
      }
      this.layers.push({ c, T, speed: 0.022 });
    }
    // ── near: the hedge-and-tree line along the road (fast), a verge
    {
      const T = Math.round(w * 1.3);
      const [c, g] = this.mk(T, h);
      const y = ridge(T, R, [[5, 0.5], [13, 0.3]]);
      const base = (x: number): number => h * (0.79 + 0.015 * y(x));
      g.fillStyle = '#150f1c';
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= T; x += 3) g.lineTo(x, base(x));
      g.lineTo(T, h);
      g.fill();
      let x = 0;
      while (x < T - h * 0.1) {
        const pine = R() < 0.3;
        const th = h * (0.07 + R() * 0.13);
        const b = base(x) + 2;
        if (pine) {
          for (let k = 0; k < 4; k++) {
            const ww = th * (0.34 - k * 0.07);
            const ty = b - th * (0.25 + k * 0.22);
            g.beginPath();
            g.moveTo(x - ww, ty + th * 0.3);
            g.lineTo(x, ty - th * 0.2);
            g.lineTo(x + ww, ty + th * 0.3);
            g.fill();
          }
        } else {
          g.fillRect(x - th * 0.03, b - th * 0.45, th * 0.06, th * 0.45);
          for (let k = 0; k < 6; k++) {
            g.beginPath();
            g.arc(x + (R() - 0.5) * th * 0.5, b - th * (0.55 + R() * 0.35), th * (0.18 + R() * 0.14), 0, Math.PI * 2);
            g.fill();
          }
        }
        // Low hedge between the trees.
        for (let k = 0; k < 8; k++) {
          g.beginPath();
          g.arc(x + k * h * 0.012, b - h * 0.01, h * (0.012 + R() * 0.01), 0, Math.PI * 2);
          g.fill();
        }
        x += h * (0.06 + R() * 0.12);
      }
      // Sun-catch along the top of the hedge.
      g.globalCompositeOperation = 'source-atop';
      const rim = g.createLinearGradient(0, h * 0.6, 0, h * 0.8);
      rim.addColorStop(0, 'rgba(120,70,70,0.35)');
      rim.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rim;
      g.fillRect(0, 0, T, h);
      g.globalCompositeOperation = 'source-over';
      this.layers.push({ c, T, speed: 0.13 });
    }
    // ── telegraph poles and their sagging wires (fastest)
    {
      const T = Math.round(w * 1.1);
      const [c, g] = this.mk(T, h);
      const poles = [T * 0.25, T * 0.75];
      const top = h * 0.3;
      g.fillStyle = '#0e0a12';
      for (const px of poles) {
        g.fillRect(px - 3, top, 6, h - top);
        g.fillRect(px - 26, top + 10, 52, 4);
        for (const dx of [-20, -8, 8, 20]) g.fillRect(px + dx - 1.5, top + 5, 3, 6);
      }
      g.strokeStyle = 'rgba(14,10,18,0.9)';
      g.lineWidth = 1;
      // Wires between every neighbouring pair, the neighbours' tiles included (seamless wrap).
      const P = [...poles.map((p) => p - T), ...poles, ...poles.map((p) => p + T)];
      for (const dx of [-20, -8, 8, 20]) {
        for (let i = 0; i + 1 < P.length; i++) {
          const a = P[i]! + dx;
          const b = P[i + 1]! + dx;
          g.beginPath();
          g.moveTo(a, top + 5);
          g.quadraticCurveTo((a + b) / 2, top + 5 + h * 0.07, b, top + 5);
          g.stroke();
        }
      }
      this.layers.push({ c, T, speed: 0.42 });
    }
    // ── the coach's window: frame, mullion (left of centre, beside the letter), brass rail, curtain
    {
      const [c, g] = this.mk(w, h);
      const fx = w * 0.05;
      const fy = h * 0.07;
      const fw = w * 0.9;
      const fh = h * 0.8;
      const wood = g.createLinearGradient(0, 0, 0, h);
      wood.addColorStop(0, '#3a2012');
      wood.addColorStop(1, '#1e0f07');
      g.fillStyle = wood;
      g.beginPath();
      g.rect(0, 0, w, h);
      g.roundRect(fx, fy, fw, fh, h * 0.06);
      g.fill('evenodd');
      // Panelling grain on the coach wall (clipped to the wood: never across the glass).
      g.save();
      g.beginPath();
      g.rect(0, 0, w, h);
      g.roundRect(fx, fy, fw, fh, h * 0.06);
      g.clip('evenodd');
      g.strokeStyle = 'rgba(255,200,140,0.05)';
      for (let yy = 2; yy < h; yy += 3) {
        g.beginPath();
        g.moveTo(0, yy);
        g.lineTo(w, yy + Math.sin(yy) * 2);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(255,196,130,0.4)';
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(fx - 2, fy - 2, fw + 4, fh + 4, h * 0.06);
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = 6;
      g.beginPath();
      g.roundRect(fx + 3, fy + 3, fw - 6, fh - 6, h * 0.055);
      g.stroke();
      const rail = g.createLinearGradient(0, fy + fh + 6, 0, fy + fh + 18);
      rail.addColorStop(0, '#f6cc80');
      rail.addColorStop(1, '#8a5a24');
      g.fillStyle = rail;
      g.fillRect(fx - 10, fy + fh + 8, fw + 20, 8);
      const mx = w * 0.43;
      const mg = g.createLinearGradient(mx - 5, 0, mx + 5, 0);
      mg.addColorStop(0, '#1a0c05');
      mg.addColorStop(0.5, '#4a2a16');
      mg.addColorStop(1, '#1a0c05');
      g.fillStyle = mg;
      g.fillRect(mx - 5, fy, 10, fh);
      g.fillStyle = '#c89048';
      g.fillRect(mx - 7, fy + fh * 0.48, 14, 5);
      // Gathered velvet curtain on the left, a tie-back cord.
      const cg = g.createLinearGradient(0, 0, w * 0.17, 0);
      cg.addColorStop(0, '#4a1414');
      cg.addColorStop(0.6, '#8a2c26');
      cg.addColorStop(1, 'rgba(138,44,38,0)');
      g.fillStyle = cg;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w * 0.15, 0);
      g.bezierCurveTo(w * 0.08, h * 0.35, w * 0.13, h * 0.6, w * 0.09, h);
      g.lineTo(0, h);
      g.fill();
      g.strokeStyle = 'rgba(40,6,6,0.5)';
      g.lineWidth = 2;
      for (let k = 1; k < 5; k++) {
        g.beginPath();
        g.moveTo(w * 0.028 * k, 0);
        g.bezierCurveTo(w * 0.023 * k, h * 0.35, w * 0.028 * k, h * 0.6, w * 0.02 * k, h);
        g.stroke();
      }
      g.strokeStyle = '#d8a850';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(0, h * 0.55);
      g.quadraticCurveTo(w * 0.06, h * 0.6, w * 0.1, h * 0.54);
      g.stroke();
      // The coach lamp's warm spill on the lower-left glass and the wall, and a soft vignette.
      const lamp = g.createRadialGradient(w * 0.1, h * 0.95, 0, w * 0.1, h * 0.95, w * 0.5);
      lamp.addColorStop(0, 'rgba(255,170,90,0.22)');
      lamp.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = lamp;
      g.fillRect(0, 0, w, h);
      const v = g.createRadialGradient(w * 0.6, h * 0.5, h * 0.35, w * 0.6, h * 0.5, w * 0.72);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.5)');
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
      this.frame = c;
    }
  }

  private draw(dt: number): void {
    this.resize();
    this.t += dt;
    const { g, w, h } = this;
    if (this.sky) g.drawImage(this.sky, 0, 0);
    // First stars in the indigo, gently twinkling.
    for (const s of this.stars) {
      g.fillStyle = `rgba(255,244,220,${0.35 + 0.35 * Math.sin(this.t * 1.7 + s.p)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }
    // Parallax bands scroll left (the coach heads right), near ones faster.
    this.layers.forEach((L, i) => {
      const off = (this.t * L.speed * w + i * 97) % L.T;
      g.drawImage(L.c, -off, 0);
      g.drawImage(L.c, L.T - off, 0);
      if (i === 2) {
        // Chimney smoke from the village (drawn with the valley band's offset).
        for (const c of this.chimneys) {
          for (const sh of [0, L.T]) {
            const x0 = c.x - off + sh;
            if (x0 < -20 || x0 > w + 20) continue;
            for (let k = 0; k < 5; k++) {
              const u = (((this.t * 0.25 + k / 5 + c.x * 0.01) % 1) + 1) % 1;
              g.fillStyle = `rgba(200,180,200,${0.16 * (1 - u)})`;
              g.beginPath();
              g.arc(x0 + u * h * 0.03 + Math.sin(u * 5 + c.x) * 1.5, c.y - u * h * 0.05, 1 + u * h * 0.012, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
      }
    });
    // The last of the rain on the glass: a few running drops with wet trails, still beads.
    for (const d of this.drops) {
      if (d.v) {
        d.y += d.v * dt * (0.6 + Math.sin(this.t * 7 + d.x * 40) * 0.4);
        d.trail = Math.min(0.18, d.trail + d.v * dt);
        if (d.y > 1.05) {
          d.y = -0.05;
          d.x = Math.random();
          d.trail = 0;
        }
        const x = d.x * w;
        const y = d.y * h;
        const tr = g.createLinearGradient(x, y - d.trail * h, x, y);
        tr.addColorStop(0, 'rgba(255,220,200,0)');
        tr.addColorStop(1, 'rgba(255,220,200,0.18)');
        g.strokeStyle = tr;
        g.lineWidth = d.r * 0.7;
        g.beginPath();
        g.moveTo(x + Math.sin(d.y * 30) * 1.5, y - d.trail * h);
        g.lineTo(x, y);
        g.stroke();
      }
      const x = d.x * w;
      const y = d.y * h;
      const body = g.createRadialGradient(x, y + d.r * 0.35, 0, x, y, d.r * 1.15);
      body.addColorStop(0, 'rgba(255,226,190,0.4)');
      body.addColorStop(0.55, 'rgba(230,190,200,0.14)');
      body.addColorStop(1, 'rgba(230,190,200,0.04)');
      g.fillStyle = body;
      g.beginPath();
      g.ellipse(x, y, d.r, d.r * 1.08, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,250,240,0.7)';
      g.beginPath();
      g.arc(x - d.r * 0.35, y - d.r * 0.42, Math.max(0.5, d.r * 0.2), 0, Math.PI * 2);
      g.fill();
    }
    if (this.frame) g.drawImage(this.frame, 0, 0);
  }
}

// ─────────────────────────────────────────────── overlay

export class CinemaOverlay {
  private root: HTMLElement;
  private fadeEl: HTMLElement;
  private captionEl: HTMLElement;
  private dlg: HTMLElement;
  private dlgText: HTMLElement;
  private dlgName: HTMLElement;
  private dlgRole: HTMLElement;
  private dlgPortrait: HTMLElement;
  private dlgNext: HTMLElement;
  private choices: HTMLElement;
  private skipEl: HTMLElement;
  private line = '';
  private shown = 0;
  private timer = 0;
  private advanceResolve: (() => void) | null = null;
  private choiceResolve: ((i: number) => void) | null = null;
  private choiceSel = 0;
  private choiceCount = 0;
  /** Co-op farmhand: the options are on screen but the host picks. */
  private choiceLocked = false;
  private skipT = 0;
  private coach = new CoachWindow();
  private padRaf = 0;
  private padPrev: boolean[] = [];
  private padAxisT = 0;

  constructor(parent: HTMLElement, private hudRoot: HTMLElement) {
    loadStoryFonts();
    this.root = document.createElement('div');
    this.root.className = 'hv-cinema-layer';
    this.root.innerHTML = `
      <div class="cin-bar top"></div><div class="cin-bar bot"></div>
      <div class="cin-caption"><div class="cap-scrim"></div><div class="cap-orn">✦</div><div class="cap-text"></div><div class="cap-sub"></div></div>
      <div class="cin-dlg hv-hidden">
        <div class="cin-portrait"></div>
        <div class="hv-panel cin-box"><div class="hv-inner">
          <div class="cin-nameplate"><span class="cin-name"></span><span class="cin-role"></span></div>
          <div class="cin-text"></div>
          <div class="cin-next">${NEXT}</div>
        </div></div>
      </div>
      <div class="cin-choices hv-hidden"></div>
      <div class="cin-skip">Press <b>Esc</b> again to skip</div>
      <div class="cin-fade"></div>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string): T => this.root.querySelector(s) as T;
    this.fadeEl = q('.cin-fade');
    this.captionEl = q('.cin-caption');
    this.dlg = q('.cin-dlg');
    this.dlgText = q('.cin-text');
    this.dlgName = q('.cin-name');
    this.dlgRole = q('.cin-role');
    this.dlgPortrait = q('.cin-portrait');
    this.dlgNext = q('.cin-next');
    this.choices = q('.cin-choices');
    this.skipEl = q('.cin-skip');
    this.dlg.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (this.choiceResolve) {
        this.choiceKey(e);
        return;
      }
      if (!this.advanceResolve) return;
      if (['Space', 'Enter', 'KeyE', 'KeyX', 'KeyF', 'KeyC'].includes(e.code)) {
        e.preventDefault();
        this.advance();
      }
    });
  }

  letterbox(on: boolean, instant: boolean): void {
    this.root.classList.toggle('instant', instant);
    this.root.classList.toggle('boxed', on);
    if (instant) {
      void this.root.offsetWidth;
      requestAnimationFrame(() => this.root.classList.remove('instant'));
    }
  }

  hud(on: boolean): void {
    this.hudRoot.classList.toggle('hv-cinema', !on);
  }

  /** A painted full-screen backdrop behind the letterbox (null = back to the 3D scene). */
  backdrop(kind: Backdrop | null): void {
    if (kind === 'coach') this.coach.start(this.root);
    else this.coach.stop();
  }

  fade(black: boolean, dur: number): Promise<void> {
    this.fadeEl.style.transition = `opacity ${dur}s ease`;
    this.fadeEl.classList.toggle('on', black);
    return new Promise((r) => (dur > 0 ? setTimeout(r, dur * 1000) : r()));
  }

  caption(text: string, sub: string | undefined, dur: number, hold: boolean, low = false): Promise<void> {
    const c = this.captionEl;
    c.classList.toggle('low', low);
    (c.querySelector('.cap-text') as HTMLElement).textContent = text;
    (c.querySelector('.cap-sub') as HTMLElement).textContent = sub ?? '';
    c.classList.remove('show', 'hold');
    void c.offsetWidth;
    c.style.setProperty('--dur', `${Math.max(1.2, dur)}s`);
    c.classList.add(hold ? 'hold' : 'show');
    if (hold) return Promise.resolve();
    return new Promise((r) => setTimeout(r, Math.max(1.2, dur) * 1000));
  }

  private setSpeaker(who: Speaker): void {
    this.dlgName.textContent = who.name;
    this.dlgRole.textContent = who.role;
    this.dlgPortrait.innerHTML = who.portrait;
    this.dlg.classList.toggle('narrator', !who.portrait);
    this.dlg.classList.remove('hv-hidden', 'pop');
    void this.dlg.offsetWidth;
    this.dlg.classList.add('pop');
  }

  say(who: Speaker, text: string, hold: boolean): Promise<void> {
    this.choices.classList.add('hv-hidden');
    this.setSpeaker(who);
    this.line = text;
    window.clearTimeout(this.timer);
    if (hold) {
      this.shown = text.length;
      this.dlgText.textContent = text;
      this.dlgNext.classList.remove('hv-hidden');
      return Promise.resolve();
    }
    this.shown = 0;
    this.dlgText.textContent = '';
    this.dlgNext.classList.add('hv-hidden');
    this.tick();
    const p = new Promise<void>((r) => {
      this.advanceResolve = () => {
        this.advanceResolve = null;
        this.dlg.classList.add('hv-hidden');
        r();
      };
    });
    this.pollPad();
    return p;
  }

  private tick = (): void => {
    if (this.shown >= this.line.length) {
      this.dlgNext.classList.remove('hv-hidden');
      return;
    }
    const ch = this.line[this.shown]!;
    this.shown++;
    this.dlgText.textContent = this.line.slice(0, this.shown);
    const delay = /[.!?]/.test(ch) ? 170 : /[,—]/.test(ch) ? 90 : 19;
    this.timer = window.setTimeout(this.tick, delay);
  };

  /** Complete the typewriter line (skip). */
  flushLine(): void {
    window.clearTimeout(this.timer);
    this.shown = this.line.length;
    this.dlgText.textContent = this.line;
    this.advanceResolve?.();
  }

  private advance(): void {
    if (this.shown < this.line.length) {
      window.clearTimeout(this.timer);
      this.shown = this.line.length;
      this.dlgText.textContent = this.line;
      this.dlgNext.classList.remove('hv-hidden');
      return;
    }
    this.advanceResolve?.();
  }

  // ───────────────────────────── choices

  /**
   * `waiting` (co-op farmhand): the options are shown locked under a "waiting for the host" note and
   * `remote` receives the resolver the host's pick arrives through.
   */
  choice(who: Speaker, text: string, options: ChoiceOption[], hold: boolean, waiting?: string, remote?: (resolve: (i: number) => void) => void): Promise<number> {
    this.setSpeaker(who);
    this.line = text;
    this.shown = text.length;
    this.dlgText.textContent = text;
    this.dlgNext.classList.add('hv-hidden');
    this.choiceCount = options.length;
    this.choices.innerHTML = options
      .map((o, i) => `<button class="cin-choice" data-i="${i}" style="--d:${i * 70}ms"><span class="key">${i + 1}</span><span class="lbl">${o.label}</span>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</button>`)
      .join('');
    this.choices.classList.remove('hv-hidden');
    this.choices.classList.toggle('locked', !!waiting);
    this.choices.querySelector('.cin-wait')?.remove();
    // A moral choice opens with nothing pre-selected: no option is nudged towards the player.
    this.selectChoice(-1);
    this.seatChoices();
    if (hold) return Promise.resolve(-1);
    if (waiting) {
      const note = document.createElement('div');
      note.className = 'cin-wait';
      note.textContent = waiting;
      this.choices.appendChild(note);
      return new Promise((r) => {
        this.choiceResolve = r;
        this.choiceLocked = true;
        remote?.((i) => {
          this.choiceLocked = false;
          this.selectChoice(i);
          this.pick(i);
        });
      });
    }
    this.choiceLocked = false;
    return new Promise((r) => {
      this.choiceResolve = r;
      this.choices.querySelectorAll<HTMLElement>('button').forEach((b) => {
        b.addEventListener('pointerenter', () => this.selectChoice(Number(b.dataset.i)));
        b.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.pick(Number(b.dataset.i));
        });
      });
      this.pollPad();
    });
  }

  /**
   * Seat the choice stack 12 px above the speaker's nameplate (not the text box): the box grows with
   * a long line, and a fixed offset let the first card cover the role under the name.
   */
  private seatChoices(): void {
    const seat = (): void => {
      const plate = this.root.querySelector<HTMLElement>('.cin-nameplate');
      const host = this.root.getBoundingClientRect();
      if (!plate || !host.height) return;
      const top = plate.getBoundingClientRect().top;
      if (top <= 0) return;
      this.choices.style.bottom = `${Math.round(host.bottom - top + 12)}px`;
    };
    seat();
    requestAnimationFrame(seat);
    // The box pops in (translate + scale for 260 ms) and a long line can re-wrap once the web font
    // lands: re-seat through the whole settle so the last card never sits on the nameplate.
    for (const ms of [120, 280, 520, 900, 1500]) window.setTimeout(seat, ms);
  }

  private selectChoice(i: number): void {
    this.choiceSel = i;
    this.choices.querySelectorAll<HTMLElement>('.cin-choice').forEach((b, k) => b.classList.toggle('sel', k === i));
  }

  private pick(i: number): void {
    const r = this.choiceResolve;
    if (!r || i < 0 || i >= this.choiceCount) return;
    this.choiceResolve = null;
    const b = this.choices.querySelectorAll<HTMLElement>('.cin-choice')[i];
    b?.classList.add('picked');
    window.setTimeout(() => {
      this.choices.classList.add('hv-hidden');
      this.dlg.classList.add('hv-hidden');
    }, 160);
    r(i);
  }

  private choiceKey(e: KeyboardEvent): void {
    if (this.choiceLocked) return;
    const n = this.choiceCount;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) {
      const i = Number(digit[1]) - 1;
      if (i < n) {
        e.preventDefault();
        this.selectChoice(i);
        this.pick(i);
      }
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      this.selectChoice(this.choiceSel < 0 ? 0 : (this.choiceSel + 1) % n);
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      this.selectChoice(this.choiceSel < 0 ? n - 1 : (this.choiceSel + n - 1) % n);
    } else if (['Enter', 'Space', 'KeyE', 'NumpadEnter'].includes(e.code)) {
      e.preventDefault();
      if (this.choiceSel >= 0) this.pick(this.choiceSel);
    }
  }

  /** Gamepad while a line or a choice waits: A advances / picks, D-pad or stick moves the choice. */
  private pollPad(): void {
    cancelAnimationFrame(this.padRaf);
    this.padPrev = [];
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      if (!this.choiceResolve && !this.advanceResolve) return;
      const gp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
      if (gp) {
        const down = gp.buttons.map((b) => b.pressed);
        const hit = (i: number): boolean => !!down[i] && !this.padPrev[i];
        if (this.choiceResolve) {
          const ay = gp.axes[1] ?? 0;
          this.padAxisT -= dt;
          if (hit(13) || (ay > 0.55 && this.padAxisT <= 0)) {
            this.selectChoice(this.choiceSel < 0 ? 0 : (this.choiceSel + 1) % this.choiceCount);
            this.padAxisT = 0.28;
          } else if (hit(12) || (ay < -0.55 && this.padAxisT <= 0)) {
            this.selectChoice(this.choiceSel < 0 ? this.choiceCount - 1 : (this.choiceSel + this.choiceCount - 1) % this.choiceCount);
            this.padAxisT = 0.28;
          } else if (Math.abs(ay) < 0.3) this.padAxisT = 0;
          if (hit(0) && this.choiceSel >= 0) this.pick(this.choiceSel);
        } else if (hit(0)) this.advance();
        this.padPrev = down;
      }
      this.padRaf = requestAnimationFrame(loop);
    };
    this.padRaf = requestAnimationFrame(loop);
  }

  skipHint(): void {
    this.skipEl.classList.add('show');
    window.clearTimeout(this.skipT);
    this.skipT = window.setTimeout(() => this.skipEl.classList.remove('show'), 1500);
  }

  reset(): void {
    window.clearTimeout(this.timer);
    cancelAnimationFrame(this.padRaf);
    this.advanceResolve = null;
    this.choiceResolve = null;
    this.coach.stop();
    this.dlg.classList.add('hv-hidden');
    this.choices.classList.add('hv-hidden');
    this.captionEl.classList.remove('show', 'hold');
    this.root.classList.remove('boxed');
    this.fadeEl.style.transition = 'opacity 0.6s ease';
    this.fadeEl.classList.remove('on');
    this.hudRoot.classList.remove('hv-cinema');
  }
}
