/**
 * UI kit shared by every Hearthvale screen:
 *   el() / h()          tiny DOM helpers
 *   installTextures()   procedural wood-grain + paper-fibre canvases → CSS vars (--u-wood, --u-paper, --u-grain)
 *   Screen              base class: full-screen layer, animated open/close (ease-out-back in, quick fade out),
 *                       optional dim backdrop, keyboard / gamepad focus navigation, back handling
 *   FocusNav            spatial focus navigation over [data-nav] elements (arrows / WASD / d-pad)
 *   tooltip             one floating parchment tooltip that follows the pointer or anchors to an element
 *   sfx()               emits `ui:sfx` so the audio system can voice UI (click, hover, buy, error …)
 *   rollTo()            animated number count-up / down
 */
import type { Game } from '../core/game';

declare module '../core/events' {
  interface GameEvents {
    /** UI sound cue for the audio system (hover, click, open, close, buy, sell, error, coin, craft, trash, pickup, drop, tab, toggle). */
    'ui:sfx': { kind: string };
    /** Ask the HUD to show a toast. `icon` = item id (or ICONS key with `raw:` prefix). */
    'ui:toast': { text: string; icon?: string; kind?: 'info' | 'good' | 'bad' | 'gold' };
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export function sfx(game: Game, kind: string): void {
  game.events.emit('ui:sfx', { kind });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Restart a CSS animation class on an element. */
export function replay(e: Element | null | undefined, cls: string): void {
  if (!e) return;
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}

/** Animate the integer text of `node` from its current value to `to`. */
export function rollTo(node: HTMLElement, to: number, ms = 700, fmt = (n: number): string => n.toLocaleString()): void {
  const from = Number(node.dataset.v ?? to) || 0;
  node.dataset.v = String(to);
  const t0 = performance.now();
  const step = (now: number): void => {
    if (node.dataset.v !== String(to)) return;
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  if (from === to) node.textContent = fmt(to);
  else requestAnimationFrame(step);
}

// ── Procedural textures ─────────────────────────────────────────────────────

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wood grain overlay: long wavy streaks + knots, alpha-only light/dark so it tints any wood colour. */
function woodCanvas(): HTMLCanvasElement {
  const w = 512;
  const hgt = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const g = c.getContext('2d')!;
  const r = rand(7);
  const knots = Array.from({ length: 4 }, () => ({ x: r() * w, y: r() * hgt, s: 10 + r() * 16 }));
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x += 2) {
      let d = 0;
      for (const k of knots) {
        const dx = (x - k.x) / (k.s * 3.2);
        const dy = (y - k.y) / k.s;
        d += Math.exp(-(dx * dx + dy * dy)) * 9;
      }
      const v = Math.sin(y * 0.55 + Math.sin(x * 0.012 + y * 0.03) * 3.2 + d) * 0.5 + 0.5;
      const fine = Math.sin(y * 2.3 + Math.sin(x * 0.05) * 1.3) * 0.5 + 0.5;
      const a = Math.pow(v, 6) * 0.22 + fine * 0.05 + r() * 0.03;
      g.fillStyle = `rgba(40,18,4,${a.toFixed(3)})`;
      g.fillRect(x, y, 2, 1);
    }
  }
  // Pale highlights between dark streaks.
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const y = r() * hgt;
    g.strokeStyle = `rgba(255,220,170,${0.03 + r() * 0.05})`;
    g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 2.5);
    g.stroke();
  }
  return c;
}

/** Paper: soft cloudy mottling + fibres + speckles (alpha-only, multiply-friendly). */
function paperCanvas(): HTMLCanvasElement {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d')!;
  const r = rand(11);
  for (let i = 0; i < 70; i++) {
    const x = r() * s;
    const y = r() * s;
    const rad = 20 + r() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.025 + r() * 0.035;
    gr.addColorStop(0, `rgba(150,100,40,${a})`);
    gr.addColorStop(1, 'rgba(150,100,40,0)');
    for (const ox of [-s, 0, s])
      for (const oy of [-s, 0, s]) {
        g.save();
        g.translate(ox, oy);
        g.fillStyle = gr;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        g.restore();
      }
  }
  for (let i = 0; i < 520; i++) {
    const x = r() * s;
    const y = r() * s;
    const l = 2 + r() * 7;
    const a = r() * Math.PI;
    g.strokeStyle = r() < 0.5 ? `rgba(120,80,30,${0.05 + r() * 0.08})` : `rgba(255,255,240,${0.08 + r() * 0.1})`;
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(90,55,20,${0.05 + r() * 0.12})`;
    g.fillRect(r() * s, r() * s, 1, 1);
  }
  return c;
}

/** Fine film-like grain used on dark backdrops (day-end sky, title vignette). */
function grainCanvas(): HTMLCanvasElement {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d')!;
  const img = g.createImageData(s, s);
  const r = rand(3);
  for (let i = 0; i < s * s; i++) {
    const v = r() * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 18;
  }
  g.putImageData(img, 0, 0);
  return c;
}

let texturesInstalled = false;
export function installTextures(): void {
  if (texturesInstalled) return;
  texturesInstalled = true;
  const root = document.documentElement.style;
  try {
    root.setProperty('--u-wood', `url(${woodCanvas().toDataURL()})`);
    root.setProperty('--u-paper', `url(${paperCanvas().toDataURL()})`);
    root.setProperty('--u-grain', `url(${grainCanvas().toDataURL()})`);
  } catch {
    /* canvas blocked: plain gradients still look fine */
  }
  // Handwriting face for letters / notes (Google Fonts is the only allowed network asset).
  if (!document.querySelector('link[data-hv-font]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.dataset.hvFont = '1';
    l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&display=swap';
    document.head.appendChild(l);
  }
  // Keyboard vs pointer mode (focus rings only for keyboard / gamepad users).
  window.addEventListener('pointermove', () => document.body.classList.remove('u-kbd'), { passive: true });
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

class Tooltip {
  private node: HTMLElement | null = null;
  private visible = false;
  private px = 0;
  private py = 0;

  private ensure(): HTMLElement {
    if (!this.node) {
      this.node = el('div', 'u-tip');
      document.getElementById('ui-root')?.appendChild(this.node);
      window.addEventListener(
        'pointermove',
        (e) => {
          this.px = e.clientX;
          this.py = e.clientY;
          if (this.visible && this.node?.dataset.follow === '1') this.place(this.px, this.py);
        },
        { passive: true },
      );
    }
    return this.node;
  }

  /** Show near the pointer (follows it). */
  show(html: string): void {
    const n = this.ensure();
    if (n.innerHTML !== html) n.innerHTML = html;
    n.dataset.follow = '1';
    if (!this.visible) replay(n, 'on');
    this.visible = true;
    this.place(this.px, this.py);
  }

  /** Show anchored beside an element (keyboard / gamepad focus). */
  anchor(html: string, target: Element): void {
    const n = this.ensure();
    if (n.innerHTML !== html) n.innerHTML = html;
    n.dataset.follow = '0';
    if (!this.visible) replay(n, 'on');
    this.visible = true;
    const r = target.getBoundingClientRect();
    this.place(r.right - 6, r.top + r.height * 0.5 - 10);
  }

  private place(x: number, y: number): void {
    const n = this.node!;
    // The tip is zoomed with the UI (--uiz): measure in screen px, translate in its own (zoomed) px.
    const z = parseFloat(document.documentElement.style.getPropertyValue('--uiz')) || 1;
    const w = n.offsetWidth * z;
    const hh = n.offsetHeight * z;
    let tx = x + 22;
    let ty = y + 18;
    if (tx + w > innerWidth - 8) tx = x - w - 16;
    if (ty + hh > innerHeight - 8) ty = innerHeight - hh - 8;
    n.style.transform = `translate(${Math.max(8, tx) / z}px, ${Math.max(8, ty) / z}px)`;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.node?.classList.remove('on');
  }
}

export const tooltip = new Tooltip();

// ── Focus navigation (keyboard + gamepad) ──────────────────────────────────

export type NavDir = 'up' | 'down' | 'left' | 'right';

export class FocusNav {
  private scope: HTMLElement | null = null;
  current: HTMLElement | null = null;

  attach(scope: HTMLElement | null, initial?: HTMLElement | null): void {
    this.scope = scope;
    this.set(initial ?? null, false);
  }

  items(): HTMLElement[] {
    if (!this.scope) return [];
    return [...this.scope.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => e.offsetParent !== null && !e.closest('.hv-hidden'));
  }

  set(e: HTMLElement | null, kbd = true): void {
    this.current?.classList.remove('u-focus');
    this.current = e;
    if (e) {
      e.classList.add('u-focus');
      if (kbd) {
        document.body.classList.add('u-kbd');
        e.scrollIntoView({ block: 'nearest' });
        e.dispatchEvent(new CustomEvent('u-focus', { bubbles: true }));
      }
    }
  }

  move(dir: NavDir): void {
    const list = this.items();
    if (!list.length) return;
    const cur = this.current && list.includes(this.current) ? this.current : null;
    if (!cur) {
      this.set(list[0]!);
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const e of list) {
      if (e === cur) continue;
      const b = e.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax;
      const dy = b.top + b.height / 2 - ay;
      const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 2) continue;
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) this.set(best);
  }

  activate(): void {
    const e = this.current;
    if (!e || !this.items().includes(e)) return;
    e.dispatchEvent(new CustomEvent('u-activate', { bubbles: true }));
    if (!e.dataset.noclick) e.click();
  }
}

// ── Screen base ─────────────────────────────────────────────────────────────

export interface ScreenOpts {
  /** Dim + blur the world behind the screen. */
  backdrop?: boolean;
  /** Clicking the backdrop closes the screen. */
  backdropCloses?: boolean;
}

export abstract class Screen {
  readonly root: HTMLElement;
  readonly nav = new FocusNav();
  isOpen = false;
  private closeTimer = 0;

  constructor(protected game: Game, parent: HTMLElement, cls: string, opts: ScreenOpts = {}) {
    this.root = el('div', `hv-screen ${cls} hv-hidden`);
    if (opts.backdrop) {
      const bd = el('div', 'u-backdrop interactive');
      if (opts.backdropCloses !== false)
        bd.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.requestClose();
        });
      this.root.appendChild(bd);
    }
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('wheel', (e) => e.stopPropagation());
    this.root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest?.('[data-nav]') as HTMLElement | null;
      if (t && this.root.contains(t) && t !== this.nav.current) {
        this.nav.set(t, false);
      }
    });
  }

  protected abstract render(arg?: string): void;

  /** First element to focus for keyboard / gamepad users. */
  protected initialFocus(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>('[data-nav].is-default') ?? null;
  }

  open(arg?: string): void {
    clearTimeout(this.closeTimer);
    this.isOpen = true;
    this.root.classList.remove('hv-hidden', 'is-closing');
    this.render(arg);
    replay(this.root, 'is-opening');
    this.nav.attach(this.root, this.initialFocus());
    sfx(this.game, 'open');
  }

  close(): void {
    if (!this.isOpen) {
      this.root.classList.add('hv-hidden');
      return;
    }
    this.isOpen = false;
    tooltip.hide();
    this.onClose();
    // `hv-hidden` is applied immediately (tests + routing rely on it); `is-closing` keeps it painted
    // for the exit animation.
    this.root.classList.remove('is-opening');
    this.root.classList.add('hv-hidden', 'is-closing');
    clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.root.classList.remove('is-closing'), 190);
  }

  protected onClose(): void {}

  /** Esc / B. Return true if the screen consumed it (e.g. dropped a held stack). */
  back(): boolean {
    return false;
  }

  /** Close through the HUD router (restores input / pause). */
  requestClose(): void {
    sfx(this.game, 'close');
    this.game.events.emit('ui:open', { name: 'none' });
  }

  /** Per-frame hook while open. */
  update(_dt: number): void {}

  /** Extra keys while open (return true when consumed). */
  key(_code: string): boolean {
    return false;
  }
}

/** Parchment-in-wood frame with a ribbon title; returns [frame, body]. */
export function frame(title: string, cls = ''): { frame: HTMLElement; body: HTMLElement; title: HTMLElement } {
  const f = el('div', `u-frame interactive ${cls}`);
  f.innerHTML = `<i class="u-rivet tl"></i><i class="u-rivet tr"></i><i class="u-rivet bl"></i><i class="u-rivet br"></i>
    <div class="u-ribbon"><span>${title}</span></div><div class="u-paper"></div>`;
  return { frame: f, body: f.querySelector('.u-paper')!, title: f.querySelector('.u-ribbon span')! };
}

/** Round red close button (✕ drawn in SVG). */
export function closeButton(onClick: () => void): HTMLElement {
  const b = el('button', 'u-close', `<svg viewBox="0 0 20 20"><path d="M5 5 L15 15 M15 5 L5 15" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`);
  b.setAttribute('aria-label', 'Close');
  b.dataset.nav = '';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
