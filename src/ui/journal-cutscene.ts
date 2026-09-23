/**
 * Cinema overlay for cutscenes: letterbox bars, a slow fade, title captions (on a soft dark scrim),
 * the cinematic dialogue box (portrait medallion + name ribbon + typewriter text), choice cards and
 * painted full-screen backdrops (the rain-streaked coach window the intro letter is read against).
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

// ─────────────────────────────────────────────── painted backdrop: night coach window in the rain

interface Light {
  x: number;
  y: number;
  r: number;
  c: string;
  a: number;
  layer: number;
}
interface Drop {
  x: number;
  y: number;
  r: number;
  v: number;
  trail: number;
}

class CoachWindow {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private lights: Light[] = [];
  private drops: Drop[] = [];
  private t = 0;
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;

  constructor() {
    this.canvas.className = 'cin-backdrop';
    this.g = this.canvas.getContext('2d')!;
  }

  private seed(): void {
    const R = Math.random;
    this.lights = [];
    // Three parallax layers of town lights: far (tiny, slow), mid windows, near street lamps (big bokeh).
    for (let i = 0; i < 90; i++) this.lights.push({ x: R(), y: 0.46 + R() * 0.14, r: 1 + R() * 2.2, c: R() < 0.8 ? '255,196,120' : '170,200,255', a: 0.5 + R() * 0.5, layer: 0 });
    for (let i = 0; i < 34; i++) this.lights.push({ x: R(), y: 0.4 + R() * 0.28, r: 5 + R() * 9, c: R() < 0.7 ? '255,176,96' : '255,230,190', a: 0.25 + R() * 0.35, layer: 1 });
    for (let i = 0; i < 9; i++) this.lights.push({ x: R(), y: 0.2 + R() * 0.5, r: 40 + R() * 60, c: R() < 0.6 ? '255,170,80' : '140,180,255', a: 0.16 + R() * 0.16, layer: 2 });
    this.drops = [];
    for (let i = 0; i < 130; i++) this.drops.push({ x: R(), y: R(), r: 1.2 + R() * 3.4, v: R() < 0.22 ? 0.03 + R() * 0.09 : 0, trail: 0 });
  }

  start(parent: HTMLElement): void {
    if (!this.canvas.parentElement) parent.prepend(this.canvas);
    this.resize();
    this.seed();
    this.canvas.classList.add('on');
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
  }

  private resize(): void {
    // Half resolution: it is all soft light and rain.
    const w = Math.max(320, Math.round(window.innerWidth * 0.5));
    const h = Math.max(180, Math.round(window.innerHeight * 0.5));
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
  }

  private draw(dt: number): void {
    this.resize();
    this.t += dt;
    const { g, w, h } = this;
    // Night sky over the city → the dark fields the coach is heading into.
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0d0f24');
    sky.addColorStop(0.45, '#2a2140');
    sky.addColorStop(0.62, '#3a2436');
    sky.addColorStop(1, '#0a0810');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // Rolling hill silhouettes.
    g.fillStyle = '#120e1a';
    g.beginPath();
    g.moveTo(0, h * 0.66);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * (0.62 + 0.03 * Math.sin(x * 0.006 + this.t * 0.05) + 0.02 * Math.sin(x * 0.017 + 1.3)));
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.fill();
    // Town lights slide past (the coach is moving right → lights drift left, near ones faster).
    g.globalCompositeOperation = 'lighter';
    const speed = [0.006, 0.03, 0.12];
    for (const L of this.lights) {
      L.x -= speed[L.layer]! * dt;
      if (L.x < -0.15) L.x += 1.3;
      const x = L.x * w;
      const y = L.y * h;
      const flick = 0.85 + 0.15 * Math.sin(this.t * 3 + x);
      const grd = g.createRadialGradient(x, y, 0, x, y, L.r);
      grd.addColorStop(0, `rgba(${L.c},${L.a * flick})`);
      grd.addColorStop(L.layer === 2 ? 0.6 : 0.35, `rgba(${L.c},${L.a * 0.45 * flick})`);
      grd.addColorStop(1, `rgba(${L.c},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, L.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // Rain on the glass: static beads + a few running drops with wet trails.
    for (const d of this.drops) {
      if (d.v) {
        d.y += d.v * dt * (0.6 + Math.sin(this.t * 7 + d.x * 40) * 0.4);
        d.trail = Math.min(0.2, d.trail + d.v * dt);
        if (d.y > 1.05) {
          d.y = -0.05;
          d.x = Math.random();
          d.trail = 0;
        }
        const x = d.x * w;
        const y = d.y * h;
        const tr = g.createLinearGradient(x, y - d.trail * h, x, y);
        tr.addColorStop(0, 'rgba(200,210,255,0)');
        tr.addColorStop(1, 'rgba(200,210,255,0.16)');
        g.strokeStyle = tr;
        g.lineWidth = d.r * 0.7;
        g.beginPath();
        g.moveTo(x + Math.sin(d.y * 30) * 1.5, y - d.trail * h);
        g.lineTo(x, y);
        g.stroke();
      }
      const x = d.x * w;
      const y = d.y * h;
      // Each bead is a tiny lens: it gathers the glow behind it (a pale, cool body brighter at the
      // bottom where it focuses the town lights), a hairline shadow under its lower rim, and a
      // pin-point highlight from the coach lamp. Kept pale so beads never read as specks of dirt.
      const body = g.createRadialGradient(x, y + d.r * 0.35, 0, x, y, d.r * 1.15);
      body.addColorStop(0, 'rgba(255,226,190,0.42)');
      body.addColorStop(0.55, 'rgba(190,200,240,0.16)');
      body.addColorStop(1, 'rgba(190,200,240,0.05)');
      g.fillStyle = body;
      g.beginPath();
      g.ellipse(x, y, d.r, d.r * 1.08, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(8,6,16,0.22)';
      g.lineWidth = Math.max(0.6, d.r * 0.22);
      g.beginPath();
      g.ellipse(x, y + d.r * 0.08, d.r * 0.95, d.r * 1.02, 0, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      g.fillStyle = 'rgba(255,250,240,0.75)';
      g.beginPath();
      g.arc(x - d.r * 0.35, y - d.r * 0.42, Math.max(0.5, d.r * 0.2), 0, Math.PI * 2);
      g.fill();
    }
    // The coach interior: warm lamp reflection across the glass, the window frame, a curtain.
    const refl = g.createRadialGradient(w * 0.82, h * 0.1, 0, w * 0.82, h * 0.1, w * 0.45);
    refl.addColorStop(0, 'rgba(255,190,110,0.16)');
    refl.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = refl;
    g.fillRect(0, 0, w, h);
    const fx = w * 0.06;
    const fy = h * 0.07;
    const fw = w * 0.88;
    const fh = h * 0.8;
    g.fillStyle = '#2a160c';
    g.beginPath();
    g.rect(0, 0, w, h);
    g.roundRect(fx, fy, fw, fh, h * 0.06);
    g.fill('evenodd');
    // Frame bevel: lit lower-left edge, a brass rail along the sill.
    g.strokeStyle = 'rgba(255,190,120,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(fx - 2, fy - 2, fw + 4, fh + 4, h * 0.06);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(fx + 3, fy + 3, fw - 6, fh - 6, h * 0.055);
    g.stroke();
    const rail = g.createLinearGradient(0, fy + fh + 6, 0, fy + fh + 18);
    rail.addColorStop(0, '#f0c070');
    rail.addColorStop(1, '#8a5a24');
    g.fillStyle = rail;
    g.fillRect(fx - 10, fy + fh + 8, fw + 20, 8);
    // Mullion down the middle of the glass.
    g.fillStyle = '#24130a';
    g.fillRect(w * 0.5 - 4, fy, 8, fh);
    // Gathered curtain on the left.
    const cg = g.createLinearGradient(0, 0, w * 0.2, 0);
    cg.addColorStop(0, '#5a1a18');
    cg.addColorStop(0.6, '#8a3028');
    cg.addColorStop(1, 'rgba(138,48,40,0)');
    g.fillStyle = cg;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w * 0.16, 0);
    g.bezierCurveTo(w * 0.09, h * 0.35, w * 0.14, h * 0.6, w * 0.1, h);
    g.lineTo(0, h);
    g.fill();
    g.strokeStyle = 'rgba(40,6,6,0.5)';
    g.lineWidth = 2;
    for (let k = 1; k < 5; k++) {
      g.beginPath();
      g.moveTo(w * 0.03 * k, 0);
      g.bezierCurveTo(w * 0.025 * k, h * 0.35, w * 0.03 * k, h * 0.6, w * 0.022 * k, h);
      g.stroke();
    }
    // Vignette.
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
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
    this.selectChoice(0);
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
      this.selectChoice((this.choiceSel + 1) % n);
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      this.selectChoice((this.choiceSel + n - 1) % n);
    } else if (['Enter', 'Space', 'KeyE', 'NumpadEnter'].includes(e.code)) {
      e.preventDefault();
      this.pick(this.choiceSel);
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
            this.selectChoice((this.choiceSel + 1) % this.choiceCount);
            this.padAxisT = 0.28;
          } else if (hit(12) || (ay < -0.55 && this.padAxisT <= 0)) {
            this.selectChoice((this.choiceSel + this.choiceCount - 1) % this.choiceCount);
            this.padAxisT = 0.28;
          } else if (Math.abs(ay) < 0.3) this.padAxisT = 0;
          if (hit(0)) this.pick(this.choiceSel);
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
