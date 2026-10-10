/**
 * Fishing overlay (DOM + canvas, never modal — the farmer keeps "holding" the rod with the
 * normal use button):
 *   power meter   wooden capsule beside the farmer while charging a cast ("MAX!" at full)
 *   bite "!"      bouncy exclamation over the farmer's head
 *   reel frame    the minigame: painted water column (caustics, rising bubbles, swaying weed),
 *                 glowing catch bar, the hooked species' own sprite tilting with its speed,
 *                 treasure chest with a progress ring, a progress tube that runs red → gold → green
 *   catch card    species art, length, quality star, price, NEW / RECORD ribbons, blurb
 *   notes         little parchment bubbles ("It got away…")
 */
import './fishing.css';
import type { FishDef } from '../data/fish';
import { fishSvg } from './fishing-art';
import { fishPortraitUrl } from './fishing-portrait';
import { itemIcon } from './icons';

export interface ReelView {
  /** Bottom of the catch bar, 0..1 (track units, 0 = bottom). */
  bar: number;
  barH: number;
  fish: number;
  fishV: number;
  progress: number;
  treasure: { pos: number; prog: number; got: boolean } | null;
  holding: boolean;
  inside: boolean;
  perfect: boolean;
  /** Bar bounce squash (0..1 off the floor, 0..-1 off the ceiling), set by the sim. */
  bounce: number;
  /** The bar lies idle on the floor: the line is slack and earns nothing. */
  slack?: boolean;
  /** 0..1 while the fish shivers before a dash / dive (its tell). */
  tell?: number;
  /** 0..1 while the fish thrashes (the frame shakes, progress bleeds). */
  thrash?: number;
  /** 0..1 hot streak (long unbroken tracking reels faster; the bar glows gold). */
  hot?: number;
}

/** Where the catch card docks: the angler's screen point + other farmers' screen boxes to keep clear. */
export interface CardAnchor {
  x: number;
  y: number;
  avoid?: { x: number; y: number; w: number; h: number }[];
}

export interface CatchCard {
  def: FishDef;
  lengthCm: number;
  quality: number;
  price: number;
  isNew: boolean;
  isRecord: boolean;
  treasure: string | null;
  /** Fishing XP gained, level after, progress to the next level (0..1), level-up flag. */
  xp?: number;
  level?: number;
  levelFrac?: number;
  leveled?: boolean;
  /** Perfect-catch streak. */
  streak?: number;
  /** Time-of-day light on the scene (CSS colour + 0..1 strength): the illustration takes the same
   *  golden-hour cast as the 3D fish held up beside it, so they read as one fish. */
  grade?: { color: string; k: number };
}

export interface ReelGear {
  level: number;
  bait: boolean;
  cork: boolean;
  lure: boolean;
  tier: number;
}

const BANG = `<svg viewBox="0 0 92 104" xmlns="http://www.w3.org/2000/svg">
  <path d="M46 5 C70 5 87 18 87 42 C87 64 71 77 56 79 L46 99 L38 79 C20 77 5 64 5 42 C5 18 22 5 46 5 Z" fill="#ffffff" stroke="#2a160a" stroke-width="6" stroke-linejoin="round"/>
  <path d="M16 30 C20 17 32 11 46 11" stroke="#e6eef2" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M36 17 C36 12 56 12 56 17 L52 53 C51.4 58 40.6 58 40 53 Z" fill="#ff5a2a" stroke="#2a160a" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="46" cy="67" r="7.5" fill="#ff5a2a" stroke="#2a160a" stroke-width="5"/>
  <path d="M41 21 L42.6 44" stroke="#ffc9a8" stroke-width="3.5" stroke-linecap="round"/>
</svg>`;

const STAR = (q: number): string => {
  const [fill, o, hi] = q === 1 ? ['#d8e0ea', '#3e4a58', '#ffffff'] : q === 2 ? ['#f2c230', '#5a3606', '#fff2a8'] : ['#b56adf', '#3e1470', '#f0d8ff'];
  return `<svg viewBox="0 0 24 24"><path d="M12 2.2 L14.9 8.3 L21.6 9.1 L16.6 13.7 L17.9 20.4 L12 17.1 L6.1 20.4 L7.4 13.7 L2.4 9.1 L9.1 8.3 Z" fill="${fill}" stroke="${o}" stroke-width="2" stroke-linejoin="round"/><path d="M9.6 9.6 L12 5.6 L13.2 8.2" fill="none" stroke="${hi}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/></svg>`;
};
const COIN = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12.8" r="8.6" fill="#b87a14"/><circle cx="12" cy="11.6" r="8.6" fill="#f7cf4a" stroke="#8a5a0a" stroke-width="1.4"/><circle cx="12" cy="11.6" r="5.6" fill="none" stroke="#dca02a" stroke-width="1.3"/></svg>`;
const RULER = `<svg viewBox="0 0 24 24"><rect x="2.5" y="8" width="19" height="8" rx="1.5" fill="#f2d49a" stroke="#8a5a2a" stroke-width="1.4"/><path d="M6 8v3M9.5 8v4.5M13 8v3M16.5 8v4.5M20 8v3" stroke="#8a5a2a" stroke-width="1.2"/></svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class FishingOverlay {
  readonly root: HTMLElement;
  private power: HTMLElement;
  private powerFill: HTMLElement;
  private bang: HTMLElement;
  private reel: HTMLElement;
  private reelHead: HTMLElement;
  private reelTags: HTMLElement;
  private reelPerfect: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private card: HTMLElement | null = null;
  private fishImg: HTMLImageElement | null = null;
  private fishImgId = '';
  private bubbles: { x: number; y: number; r: number; v: number }[] = [];
  private t = 0;
  private dpr = 1;
  private cardTimer = 0;
  private remoteBangs = new Map<number, HTMLElement>();
  /** Measured reel panel height (px, unscaled). */
  private reelH = 0;
  private remoteTags = new Map<number, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hvf-layer');
    parent.appendChild(this.root);
    this.power = el('div', 'hvf-power hvf-hidden', `<div class="maxtag">MAX!</div><div class="tube"><div class="sweet"></div><div class="fill"></div><div class="ticks"></div><div class="flash"></div></div><div class="label">CAST</div>`);
    this.powerFill = this.power.querySelector('.fill')!;
    this.bang = el('div', 'hvf-bang hvf-hidden', BANG);
    this.reel = el('div', 'hvf-reel hvf-hidden');
    this.reel.innerHTML = `<div class="frame"><div class="rivet" style="left:7px;top:7px"></div><div class="rivet" style="right:7px;top:7px"></div><div class="rivet" style="left:7px;bottom:7px"></div><div class="rivet" style="right:7px;bottom:7px"></div><canvas></canvas><div class="foot"><div class="tags"></div><div class="perfect">Perfect!</div></div></div><div class="head">Reel it in!</div>`;
    this.reelHead = this.reel.querySelector('.head')!;
    this.reelTags = this.reel.querySelector('.tags')!;
    this.reelPerfect = this.reel.querySelector('.perfect')!;
    this.canvas = this.reel.querySelector('canvas')!;
    this.g = this.canvas.getContext('2d')!;
    this.root.append(this.power, this.bang, this.reel);
    for (let i = 0; i < 14; i++) this.bubbles.push({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.2, v: 0.05 + Math.random() * 0.12 });
  }

  // ── power meter ──────────────────────────────────────────
  showPower(p: number | null, x: number, y: number): void {
    if (p === null) {
      this.power.classList.add('hvf-hidden');
      return;
    }
    this.power.classList.remove('hvf-hidden');
    this.power.style.left = `${x}px`;
    this.power.style.top = `${y}px`;
    this.powerFill.style.height = `${Math.round(p * 100)}%`;
    this.power.classList.toggle('sweet-on', p >= 0.9);
    this.power.classList.toggle('max', p >= 0.97);
  }

  // ── bite ─────────────────────────────────────────────────
  showBang(on: boolean, x = 0, y = 0): void {
    const was = !this.bang.classList.contains('hvf-hidden');
    if (!on) {
      this.bang.classList.add('hvf-hidden');
      return;
    }
    if (!was) {
      this.bang.classList.remove('hvf-hidden');
      // restart the pop animation
      this.bang.style.animation = 'none';
      void this.bang.offsetWidth;
      this.bang.style.animation = '';
    }
    this.bang.style.left = `${x}px`;
    this.bang.style.top = `${y}px`;
  }

  /** Another co-op farmer's bite "!" (smaller, same bounce). */
  remoteBang(id: number, on: boolean, x = 0, y = 0): void {
    let b = this.remoteBangs.get(id);
    if (!on) {
      if (b && !b.classList.contains('hvf-hidden')) b.classList.add('hvf-hidden');
      return;
    }
    if (!b) {
      b = el('div', 'hvf-bang remote hvf-hidden', BANG);
      this.root.appendChild(b);
      this.remoteBangs.set(id, b);
    }
    if (b.classList.contains('hvf-hidden')) {
      b.classList.remove('hvf-hidden');
      b.style.animation = 'none';
      void b.offsetWidth;
      b.style.animation = '';
    }
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
  }

  /** A co-op farmer's name pill (demo / when the net layer has no tag of its own); null hides. */
  remoteTag(id: number, name: string | null, x = 0, y = 0, color = '#e07a5f'): void {
    let t = this.remoteTags.get(id);
    if (!name) {
      t?.classList.add('hvf-hidden');
      return;
    }
    if (!t) {
      t = el('div', 'hvf-tag');
      this.root.appendChild(t);
      this.remoteTags.set(id, t);
    }
    if (t.dataset.name !== name) {
      t.dataset.name = name;
      t.innerHTML = `<i style="background:${color}"></i><span></span>`;
      t.querySelector('span')!.textContent = name;
    }
    t.classList.remove('hvf-hidden');
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  }

  // ── notes ────────────────────────────────────────────────
  note(text: string, x: number, y: number): void {
    const n = el('div', 'hvf-note', text);
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    this.root.appendChild(n);
    setTimeout(() => n.remove(), 2300);
  }

  // ── reel minigame ────────────────────────────────────────
  openReel(def: FishDef, gear?: ReelGear): void {
    this.reel.classList.remove('hvf-hidden', 'out');
    this.reel.style.animation = 'none';
    void this.reel.offsetWidth;
    this.reel.style.animation = '';
    const stars = Math.max(1, Math.min(5, Math.round(def.difficulty * 5)));
    this.reelHead.innerHTML = `Reel it in! <span style="color:#d0582a;letter-spacing:-1px">${'●'.repeat(stars)}<span style="opacity:.25">${'●'.repeat(5 - stars)}</span></span>`;
    const tags: string[] = [];
    if (gear) {
      // Levels read 1-based (the sim's level 0 is "Lv 1": a "Lv 0" tag read as an error).
      tags.push(`<span class="lv">Lv ${gear.level + 1}</span>`);
      if (gear.bait) tags.push(`<span class="gear" title="Bait">${itemIcon('bait')}</span>`);
      if (gear.cork) tags.push(`<span class="gear" title="Cork Bobber">${itemIcon('corkBobber')}</span>`);
      if (gear.lure) tags.push(`<span class="gear" title="Glimmer Lure">${itemIcon('treasureLure')}</span>`);
    }
    this.reelTags.innerHTML = tags.join('');
    this.reelPerfect.classList.remove('lost');
    if (this.fishImgId !== def.id) {
      this.fishImgId = def.id;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fishSvg(def, { size: 96 }))}`;
      this.fishImg = img;
    }
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(126 * this.dpr);
    this.canvas.height = Math.round(420 * this.dpr);
    this.reelH = this.reel.offsetHeight;
  }

  closeReel(): void {
    if (this.reel.classList.contains('hvf-hidden')) return;
    this.reel.classList.add('out');
    setTimeout(() => this.reel.classList.add('hvf-hidden'), 230);
  }

  get reelOpen(): boolean {
    return !this.reel.classList.contains('hvf-hidden') && !this.reel.classList.contains('out');
  }

  placeReel(x: number, y: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const left = Math.max(12, x + 150 + 152 < w - 16 ? x + 120 : x - 120 - 152);
    // (r7b, critic r6: at 1600 x 900 the "Reel it in!" tag ran into the clock HUD and off the top.)
    // The panel (centred on `top`) keeps its tag ≥ 12 px below whatever HUD box it would overlap
    // (the clock plate), and inside the bottom edge; on a short window it scales down to fit.
    const half = (this.reelH || 490) / 2;
    let safeTop = 12 + 22;
    const clock = document.querySelector('.h-clock');
    if (clock) {
      const r = clock.getBoundingClientRect();
      if (r.height > 0 && left < r.right && left + 152 > r.left) safeTop = Math.max(safeTop, r.bottom + 12 + 22);
    }
    const lo = safeTop + half;
    const hi = h - 96 - half;
    const k = hi >= lo ? 1 : Math.max(0.6, (h - 96 - safeTop) / (half * 2));
    this.reel.style.setProperty('--reel-k', k.toFixed(3));
    this.reel.style.left = `${left}px`;
    this.reel.style.top = `${hi >= lo ? Math.min(hi, Math.max(lo, y)) : safeTop + half * k}px`;
  }

  drawReel(v: ReelView, dt: number): void {
    this.t += dt;
    const g = this.g;
    const d = this.dpr;
    const W = 126;
    const H = 420;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, W, H);
    // Layout: water track (left) + progress tube (right).
    const tx = 6;
    const tw = 78;
    const ty = 6;
    const th = H - 12;
    const px = tx + tw + 10;
    const pw = 22;
    // Water column.
    rr(g, tx, ty, tw, th, 12);
    g.save();
    g.clip();
    const wg = g.createLinearGradient(0, ty, 0, ty + th);
    wg.addColorStop(0, '#8ad8e6');
    wg.addColorStop(0.35, '#4fa8c8');
    wg.addColorStop(0.8, '#1f5f8e');
    wg.addColorStop(1, '#173f66');
    g.fillStyle = wg;
    g.fillRect(tx, ty, tw, th);
    // Caustic light bands.
    g.globalAlpha = 0.16;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      const yy = ty + ((i * 67 + this.t * 18) % (th + 40)) - 20;
      for (let x = tx; x <= tx + tw; x += 6) {
        const y = yy + Math.sin(x * 0.12 + this.t * 1.7 + i) * 5 + Math.sin(x * 0.05 - this.t) * 3;
        if (x === tx) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // Light shafts.
    g.globalAlpha = 0.1;
    for (let i = 0; i < 3; i++) {
      const sx = tx + 10 + i * 26 + Math.sin(this.t * 0.6 + i) * 6;
      const lg = g.createLinearGradient(0, ty, 0, ty + th * 0.8);
      lg.addColorStop(0, 'rgba(255,255,240,1)');
      lg.addColorStop(1, 'rgba(255,255,240,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(sx, ty);
      g.lineTo(sx + 12, ty);
      g.lineTo(sx + 26, ty + th * 0.8);
      g.lineTo(sx + 6, ty + th * 0.8);
      g.fill();
    }
    g.globalAlpha = 1;
    // Sand + weeds at the bottom.
    g.fillStyle = '#c8a86a';
    g.beginPath();
    g.moveTo(tx, ty + th);
    for (let x = tx; x <= tx + tw; x += 4) g.lineTo(x, ty + th - 10 - Math.sin(x * 0.18) * 3);
    g.lineTo(tx + tw, ty + th);
    g.fill();
    g.strokeStyle = '#3f8a4a';
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (const [bx, hgt, ph] of [[tx + 12, 60, 0], [tx + 20, 44, 1.3], [tx + 62, 70, 2.1], [tx + 70, 40, 0.7]] as const) {
      g.beginPath();
      g.moveTo(bx, ty + th - 8);
      for (let k = 1; k <= 8; k++) {
        const yy = ty + th - 8 - (hgt * k) / 8;
        g.lineTo(bx + Math.sin(this.t * 1.6 + ph + k * 0.5) * k * 0.9, yy);
      }
      g.stroke();
    }
    // Rising bubbles.
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const b of this.bubbles) {
      b.y -= b.v * dt;
      if (b.y < 0) {
        b.y = 1;
        b.x = Math.random();
      }
      g.beginPath();
      g.arc(tx + 6 + b.x * (tw - 12) + Math.sin(this.t * 3 + b.x * 20) * 2, ty + b.y * th, b.r, 0, Math.PI * 2);
      g.fill();
    }
    // Catch bar.
    const toY = (u: number): number => ty + th - 12 - u * (th - 24);
    const barTop = toY(v.bar + v.barH);
    const barBot = toY(v.bar);
    // Squash on a floor / ceiling knock: the bar flattens against what it hit and bulges sideways.
    const sq = Math.abs(v.bounce) * 9;
    const top = v.bounce < 0;
    const squash = sq;
    const inside = v.inside && !v.slack;
    // Hot streak (r7b): long unbroken tracking reels faster; the bar warms green → gold and glows.
    const hot = inside ? Math.max(0, Math.min(1, v.hot ?? 0)) : 0;
    g.save();
    g.shadowColor = inside ? (hot > 0.05 ? `rgba(255,${Math.round(255 - hot * 50)},${Math.round(140 - hot * 60)},0.95)` : 'rgba(160,255,140,0.9)') : 'rgba(0,0,0,0)';
    g.shadowBlur = inside ? 16 + hot * (10 + Math.sin(this.t * 14) * 4) : 0;
    const bg = g.createLinearGradient(tx, 0, tx + tw, 0);
    if (inside) {
      const mixC = (a: number[], b: number[], al: number): string => `rgba(${Math.round(a[0]! + (b[0]! - a[0]!) * hot)},${Math.round(a[1]! + (b[1]! - a[1]!) * hot)},${Math.round(a[2]! + (b[2]! - a[2]!) * hot)},${al})`;
      bg.addColorStop(0, mixC([110, 220, 110], [235, 180, 60], 0.82));
      bg.addColorStop(0.5, mixC([160, 250, 140], [255, 228, 120], 0.9));
      bg.addColorStop(1, mixC([90, 200, 100], [225, 160, 50], 0.82));
    } else {
      bg.addColorStop(0, 'rgba(130,200,120,0.6)');
      bg.addColorStop(0.5, 'rgba(170,230,150,0.66)');
      bg.addColorStop(1, 'rgba(120,190,110,0.6)');
    }
    const bTop = top ? barTop : barTop + squash;
    const bH = barBot - barTop - squash;
    rr(g, tx + 4 - squash * 0.4, bTop, tw - 8 + squash * 0.8, bH, 9);
    g.fillStyle = bg;
    g.fill();
    g.restore();
    g.lineWidth = 2.5;
    g.strokeStyle = inside ? '#eaffd8' : 'rgba(230,255,220,0.7)';
    rr(g, tx + 4 - squash * 0.4, bTop, tw - 8 + squash * 0.8, bH, 9);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    rr(g, tx + 9, bTop + 5, 6, Math.max(4, bH - 10), 3);
    g.fill();
    if (sq > 0.5) {
      // A puff of bubbles off the knock.
      g.fillStyle = `rgba(255,255,255,${Math.min(0.7, sq * 0.08)})`;
      const ky = top ? bTop - 3 : bTop + bH + 3;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.arc(tx + 12 + i * 14 + Math.sin(this.t * 20 + i) * 2, ky + (top ? -1 : 1) * (2 + (i % 2) * 3), 1.6 + (i % 3), 0, Math.PI * 2);
        g.fill();
      }
    }
    if (hot > 0.6) {
      // Rising sparks off the hot bar.
      g.save();
      g.fillStyle = `rgba(255,236,150,${(hot - 0.6) * 2})`;
      for (let i = 0; i < 4; i++) {
        const ph = (this.t * 1.4 + i * 0.27) % 1;
        g.beginPath();
        g.arc(tx + 14 + i * ((tw - 28) / 3) + Math.sin(this.t * 5 + i * 2) * 3, bTop - ph * 18, 1.8 * (1 - ph) + 0.6, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    if (v.slack) {
      // Slack line: the idle bar greys out and earns nothing until you reel again.
      rr(g, tx + 4, barTop, tw - 8, barBot - barTop, 9);
      g.fillStyle = 'rgba(40,50,60,0.45)';
      g.fill();
      g.font = '800 13px Fredoka, Nunito, sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(30,20,10,0.8)';
      const ly = (barTop + barBot) / 2 + 4 + Math.sin(this.t * 8) * 1.5;
      g.strokeText('SLACK!', tx + tw / 2, ly);
      g.fillStyle = '#ffe9b0';
      g.fillText('SLACK!', tx + tw / 2, ly);
    }
    // Treasure chest.
    if (v.treasure && !v.treasure.got) {
      const cy = toY(v.treasure.pos);
      // When the fish swims over the chest, the chest steps aside, shrinks and drops behind it as a
      // dashed ghost (the two icons never sit on top of each other).
      const near = Math.max(0, Math.min(1, (44 - Math.abs(toY(v.fish) - cy)) / 24));
      const cx = tx + tw * 0.5 + near * tw * 0.22;
      g.save();
      g.globalAlpha = 1 - near * 0.5;
      drawChest(g, cx, cy, (1 + Math.sin(this.t * 6) * 0.04) * (1 - near * 0.25));
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      if (near > 0.05) g.setLineDash([4, 4]);
      g.beginPath();
      g.arc(cx, cy, 17, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = '#ffd84a';
      g.beginPath();
      g.arc(cx, cy, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.treasure.prog);
      g.stroke();
      g.restore();
    }
    // Fish sprite.
    const fy = toY(v.fish);
    const tell = v.tell ?? 0;
    const thrash = v.thrash ?? 0;
    // The tell: the fish shivers side to side and a warning ring tightens on it (read it, move first).
    const fx = tx + tw * 0.5 + Math.sin(this.t * 7) * 2 + (tell > 0 ? Math.sin(this.t * 90) * 3.5 : 0) + thrash * Math.sin(this.t * 60) * 4;
    const tilt = Math.max(-0.9, Math.min(0.9, -v.fishV * 0.8));
    if (tell > 0) {
      g.save();
      g.globalAlpha = 0.35 + tell * 0.6;
      g.strokeStyle = '#fff3c0';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(fx, fy, 30 - tell * 12, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    if (Math.abs(v.fishV) > 1.6) {
      // Dash streaks trailing the fish.
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 2;
      const dirY = v.fishV > 0 ? 1 : -1;
      for (const ox of [-14, 0, 14]) {
        g.beginPath();
        g.moveTo(fx + ox, fy + dirY * 16);
        g.lineTo(fx + ox * 0.8, fy + dirY * (34 + Math.abs(ox) * -0.6));
        g.stroke();
      }
      g.restore();
    }
    if (this.fishImg?.complete) {
      g.save();
      g.translate(fx, fy);
      g.rotate(tilt + Math.sin(this.t * 11) * 0.05 + thrash * Math.sin(this.t * 45) * 0.5);
      const s = 1 + Math.sin(this.t * 9) * 0.03 + tell * 0.12;
      g.scale(s, s);
      g.drawImage(this.fishImg, -30, -19, 60, 38);
      g.restore();
    } else {
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(fx, fy, 16, 9, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Surface sheen.
    const sg = g.createLinearGradient(0, ty, 0, ty + 30);
    sg.addColorStop(0, 'rgba(255,255,255,0.45)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg;
    g.fillRect(tx, ty, tw, 30);
    g.restore();
    // Track rim.
    g.lineWidth = 3;
    g.strokeStyle = '#3e2410';
    rr(g, tx, ty, tw, th, 12);
    g.stroke();

    // Progress tube.
    rr(g, px, ty, pw, th, 11);
    g.fillStyle = '#2a1a10';
    g.fill();
    const p = Math.max(0, Math.min(1, v.progress));
    const hue = p < 0.5 ? 8 + p * 2 * 42 : 50 + (p - 0.5) * 2 * 62;
    const fh = (th - 8) * p;
    if (fh > 1) {
      // The fill runs red at the bottom → gold → green at the top of the tube (so a still shows how
      // far the fight has come), its head glowing in the current hue; near full it pulses.
      const yTop = ty + th - 4 - fh;
      const yBot = ty + th - 4;
      const full = (th - 8);
      const pg = g.createLinearGradient(0, yBot, 0, yBot - full);
      pg.addColorStop(0, 'hsl(6 78% 46%)');
      pg.addColorStop(0.45, 'hsl(44 92% 54%)');
      pg.addColorStop(0.75, 'hsl(84 72% 50%)');
      pg.addColorStop(1, 'hsl(118 64% 46%)');
      rr(g, px + 4, yTop, pw - 8, fh, 7);
      g.fillStyle = pg;
      g.fill();
      // Cylinder shading across the tube.
      const cg = g.createLinearGradient(px + 4, 0, px + pw - 4, 0);
      cg.addColorStop(0, 'rgba(0,0,0,0.22)');
      cg.addColorStop(0.45, 'rgba(255,255,255,0.12)');
      cg.addColorStop(1, 'rgba(0,0,0,0.28)');
      g.fillStyle = cg;
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      rr(g, px + 6, ty + th - fh, 3, Math.max(0, fh - 8), 2);
      g.fill();
      // Meniscus glow at the fill's head (and a pulse past 80 %).
      const pulse = p > 0.8 ? 0.5 + 0.5 * Math.sin(this.t * 12) : 0;
      g.save();
      g.shadowColor = `hsl(${hue} 95% 62%)`;
      g.shadowBlur = 8 + pulse * 10;
      g.fillStyle = `hsla(${hue} 95% ${70 + pulse * 15}% / ${0.75 + pulse * 0.25})`;
      rr(g, px + 4, yTop, pw - 8, Math.min(6, fh), 3);
      g.fill();
      g.restore();
      if (!v.inside && !v.slack && p > 0.02) {
        // Slipping: the head of the fill flickers red as it drains.
        g.fillStyle = `rgba(255,70,40,${0.35 + 0.3 * Math.sin(this.t * 30)})`;
        rr(g, px + 4, yTop, pw - 8, Math.min(14, fh), 4);
        g.fill();
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const yy = ty + (th * i) / 10;
      g.beginPath();
      g.moveTo(px + 4, yy);
      g.lineTo(px + 9, yy);
      g.stroke();
    }
    g.lineWidth = 3;
    g.strokeStyle = '#3e2410';
    rr(g, px, ty, pw, th, 11);
    g.stroke();

    this.reel.classList.toggle('shake', (!v.inside && v.progress < 0.35) || (v.thrash ?? 0) > 0);
    // Any slip (the fish out of the bar, progress draining) jitters the panel a little.
    this.reel.classList.toggle('slip', !v.inside && !v.slack && v.progress >= 0.35 && (v.thrash ?? 0) === 0);
    this.reel.classList.toggle('tense', v.progress > 0.75);
    this.reel.classList.toggle('hot', hot > 0.6);
    this.reelPerfect.classList.toggle('lost', !v.perfect);
  }

  // ── catch card ───────────────────────────────────────────
  /** `at` = the farmer's screen position: the card sits beside them (never over the hero). */
  showCard(c: CatchCard, at?: CardAnchor): void {
    this.hideCard(true);
    const card = el('div', 'hvf-card');
    if (at) this.placeCard(card, at, true);
    const q = c.quality > 0 ? `<span class="chip q${c.quality}">${STAR(c.quality)}${['', 'Silver', 'Gold', 'Iridium'][c.quality]}</span>` : '';
    card.innerHTML = `<div class="frame">
      ${c.isNew ? '<div class="ribbon">NEW!</div>' : ''}${c.isRecord && !c.isNew ? '<div class="ribbon record">RECORD!</div>' : ''}
      <div class="art">${((u) => (u ? `<img class="fish3d" alt="" src="${u}">` : fishSvg(c.def, { size: 160, detail: true, tilt: -6 })))(fishPortraitUrl(c.def))}${c.grade && c.grade.k > 0.02 ? `<i class="grade" style="background:${c.grade.color};opacity:${c.grade.k.toFixed(2)}"></i>` : ''}</div>
      <div class="info">
        <div class="kicker">You caught</div>
        <div class="name">${c.def.name}</div>
        <div class="stats"><span class="chip">${RULER}${c.lengthCm.toFixed(1)} cm</span>${q}<span class="chip gold">${COIN}${c.price}g</span></div>
        <div class="blurb">${c.def.blurb}</div>
        ${c.treasure ? `<div class="treasure">✦ Treasure: ${c.treasure}</div>` : ''}
        ${c.xp !== undefined ? `<div class="xp"><span class="lv${c.leveled ? ' up' : ''}">Fishing Lv ${(c.level ?? 0) + 1}${c.leveled ? ' ▲' : ''}</span><span class="bar"><i style="width:${Math.round((c.levelFrac ?? 0) * 100)}%"></i></span><span class="gain">+${c.xp} XP</span>${(c.streak ?? 0) > 1 ? `<span class="streak">Perfect ×${c.streak}</span>` : ''}</div>` : ''}
      </div></div>`;
    this.root.appendChild(card);
    this.card = card;
    this.cardTimer = 4.5;
  }

  private placeCard(card: HTMLElement, at: CardAnchor, first = false): void {
    const W = 470;
    const H = 230;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // (r7b, critic r6: in co-op the card landed on the other farmer, hiding her and her name tag.)
    // Try both sides of the angler at a few heights; keep the spot that covers the least of any other
    // farmer's projected box (ties: the current / preferred side, then the base height).
    const prefRight = first ? at.x + 170 + W < w - 16 : card.classList.contains('r');
    const avoid = at.avoid ?? [];
    let best = { x: 0, y: 0, right: prefRight, cost: Infinity };
    for (const right of [prefRight, !prefRight]) {
      // (r9: 170 px clear of the anchor — the held fish is the first read, the card the second.)
      const x = right ? Math.min(at.x + 170, w - 16 - W) : Math.max(16, at.x - 170 - W);
      // A side that would sit over the angler's own fish / body is out.
      const self = right ? Math.max(0, at.x + 110 - x) : Math.max(0, x + W - (at.x - 110));
      for (const dy of [0, -150, 140, -260]) {
        const y = Math.min(h - 330, Math.max(90, at.y - 90 + dy));
        let cost = self * H * 4 + Math.abs(dy) * 20 + (right === prefRight ? 0 : 900);
        for (const r of avoid) {
          const ox = Math.max(0, Math.min(x + W, r.x + r.w) - Math.max(x, r.x));
          const oy = Math.max(0, Math.min(y + H, r.y + r.h) - Math.max(y, r.y));
          cost += ox * oy * 6;
        }
        if (cost < best.cost) best = { x, y, right, cost };
      }
    }
    if (first) card.classList.add('beside', best.right ? 'r' : 'l');
    else if (card.classList.contains('r') !== best.right) {
      card.classList.toggle('r', best.right);
      card.classList.toggle('l', !best.right);
    }
    card.style.left = `${Math.round(best.x)}px`;
    card.style.top = `${Math.round(best.y)}px`;
  }

  /** Keep a docked catch card beside the farmer while the camera settles (e.g. a trophy push-in). */
  moveCard(at: CardAnchor): void {
    if (this.card?.classList.contains('beside')) this.placeCard(this.card, at);
  }

  hideCard(instant = false): void {
    const c = this.card;
    if (!c) return;
    this.card = null;
    if (instant) c.remove();
    else {
      c.classList.add('out');
      setTimeout(() => c.remove(), 260);
    }
  }

  get cardOpen(): boolean {
    return !!this.card;
  }

  /** Auto-dismiss the card; returns true while it's showing. */
  tickCard(dt: number, hold = false): boolean {
    if (!this.card) return false;
    if (!hold) this.cardTimer -= dt;
    if (this.cardTimer <= 0) this.hideCard();
    return !!this.card;
  }

  hideAll(): void {
    this.showPower(null, 0, 0);
    this.showBang(false);
    this.closeReel();
    this.hideCard(true);
  }
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

function drawChest(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.shadowColor = 'rgba(255,220,90,0.9)';
  g.shadowBlur = 10;
  g.fillStyle = '#8a4a1e';
  rr(g, -11, -3, 22, 12, 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = '#b8642a';
  g.beginPath();
  g.moveTo(-11, -3);
  g.quadraticCurveTo(0, -14, 11, -3);
  g.closePath();
  g.fill();
  g.strokeStyle = '#3e1e08';
  g.lineWidth = 1.6;
  rr(g, -11, -3, 22, 12, 2);
  g.stroke();
  g.beginPath();
  g.moveTo(-11, -3);
  g.quadraticCurveTo(0, -14, 11, -3);
  g.stroke();
  g.fillStyle = '#f5c542';
  g.fillRect(-2.5, -5, 5, 7);
  g.strokeRect(-2.5, -5, 5, 7);
  g.fillStyle = '#f5c542';
  g.fillRect(-11, 1, 22, 2);
  g.restore();
}
