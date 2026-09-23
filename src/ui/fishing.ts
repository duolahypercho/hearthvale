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
  /** Bar bounce squash (0..1), set by the sim when the bar hits the bottom. */
  bounce: number;
}

export interface CatchCard {
  def: FishDef;
  lengthCm: number;
  quality: number;
  price: number;
  isNew: boolean;
  isRecord: boolean;
  treasure: string | null;
}

const BANG = `<svg viewBox="0 0 64 86" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="hvfBang" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7b8"/><stop offset="0.55" stop-color="#ffd23f"/><stop offset="1" stop-color="#f29a1e"/></linearGradient></defs>
  <path d="M20 6 C20 2 44 2 44 6 L39 56 C38.5 60 25.5 60 25 56 Z" fill="url(#hvfBang)" stroke="#6a2e08" stroke-width="4.5" stroke-linejoin="round"/>
  <circle cx="32" cy="73" r="9" fill="url(#hvfBang)" stroke="#6a2e08" stroke-width="4.5"/>
  <path d="M25 10 L27.5 44" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.75"/>
</svg>`;

const STAR = (q: number): string => {
  const [a, b, o] = q === 1 ? ['#ffffff', '#b8c4d0', '#5e6a78'] : q === 2 ? ['#fff6b0', '#f5c542', '#9a6a14'] : ['#f0d8ff', '#b56adf', '#5a2a8a'];
  return `<svg viewBox="0 0 24 24"><defs><linearGradient id="hvfq${q}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><path d="M12 2.2 L14.9 8.3 L21.6 9.1 L16.6 13.7 L17.9 20.4 L12 17.1 L6.1 20.4 L7.4 13.7 L2.4 9.1 L9.1 8.3 Z" fill="url(#hvfq${q})" stroke="${o}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
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

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hvf-layer');
    parent.appendChild(this.root);
    this.power = el('div', 'hvf-power hvf-hidden', `<div class="maxtag">MAX!</div><div class="tube"><div class="fill"></div><div class="ticks"></div></div>`);
    this.powerFill = this.power.querySelector('.fill')!;
    this.bang = el('div', 'hvf-bang hvf-hidden', BANG);
    this.reel = el('div', 'hvf-reel hvf-hidden');
    this.reel.innerHTML = `<div class="frame"><div class="rivet" style="left:7px;top:7px"></div><div class="rivet" style="right:7px;top:7px"></div><div class="rivet" style="left:7px;bottom:7px"></div><div class="rivet" style="right:7px;bottom:7px"></div><canvas></canvas></div><div class="head">Reel it in!</div><div class="perfect">PERFECT</div>`;
    this.reelHead = this.reel.querySelector('.head')!;
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
    this.power.classList.toggle('max', p > 0.965);
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

  // ── notes ────────────────────────────────────────────────
  note(text: string, x: number, y: number): void {
    const n = el('div', 'hvf-note', text);
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    this.root.appendChild(n);
    setTimeout(() => n.remove(), 2300);
  }

  // ── reel minigame ────────────────────────────────────────
  openReel(def: FishDef): void {
    this.reel.classList.remove('hvf-hidden', 'out');
    this.reel.style.animation = 'none';
    void this.reel.offsetWidth;
    this.reel.style.animation = '';
    const stars = Math.max(1, Math.min(5, Math.round(def.difficulty * 5)));
    this.reelHead.innerHTML = `Reel it in! <span style="color:#d0582a;letter-spacing:-1px">${'●'.repeat(stars)}<span style="opacity:.25">${'●'.repeat(5 - stars)}</span></span>`;
    if (this.fishImgId !== def.id) {
      this.fishImgId = def.id;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fishSvg(def, { size: 96 }))}`;
      this.fishImg = img;
    }
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(126 * this.dpr);
    this.canvas.height = Math.round(420 * this.dpr);
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
    const left = x + 150 + 152 < w - 16 ? x + 120 : x - 120 - 152;
    this.reel.style.left = `${Math.max(12, left)}px`;
    this.reel.style.top = `${Math.min(h - 250, Math.max(250, y))}px`;
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
    const squash = v.bounce * 5;
    const inside = v.inside;
    g.save();
    g.shadowColor = inside ? 'rgba(160,255,140,0.9)' : 'rgba(0,0,0,0)';
    g.shadowBlur = inside ? 16 : 0;
    const bg = g.createLinearGradient(tx, 0, tx + tw, 0);
    if (inside) {
      bg.addColorStop(0, 'rgba(110,220,110,0.82)');
      bg.addColorStop(0.5, 'rgba(160,250,140,0.9)');
      bg.addColorStop(1, 'rgba(90,200,100,0.82)');
    } else {
      bg.addColorStop(0, 'rgba(130,200,120,0.6)');
      bg.addColorStop(0.5, 'rgba(170,230,150,0.66)');
      bg.addColorStop(1, 'rgba(120,190,110,0.6)');
    }
    rr(g, tx + 4 - squash * 0.4, barTop + squash, tw - 8 + squash * 0.8, barBot - barTop - squash, 9);
    g.fillStyle = bg;
    g.fill();
    g.restore();
    g.lineWidth = 2.5;
    g.strokeStyle = inside ? '#eaffd8' : 'rgba(230,255,220,0.7)';
    rr(g, tx + 4 - squash * 0.4, barTop + squash, tw - 8 + squash * 0.8, barBot - barTop - squash, 9);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    rr(g, tx + 9, barTop + 5 + squash, 6, Math.max(4, barBot - barTop - 10 - squash), 3);
    g.fill();
    // Treasure chest.
    if (v.treasure && !v.treasure.got) {
      const cy = toY(v.treasure.pos);
      const cx = tx + tw * 0.5;
      drawChest(g, cx, cy, 1 + Math.sin(this.t * 6) * 0.04);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.arc(cx, cy, 17, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#ffd84a';
      g.beginPath();
      g.arc(cx, cy, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.treasure.prog);
      g.stroke();
    }
    // Fish sprite.
    const fy = toY(v.fish);
    const fx = tx + tw * 0.5 + Math.sin(this.t * 7) * 2;
    const tilt = Math.max(-0.9, Math.min(0.9, -v.fishV * 0.8));
    if (this.fishImg?.complete) {
      g.save();
      g.translate(fx, fy);
      g.rotate(tilt + Math.sin(this.t * 11) * 0.05);
      const s = 1 + Math.sin(this.t * 9) * 0.03;
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
      const pg = g.createLinearGradient(px, 0, px + pw, 0);
      pg.addColorStop(0, `hsl(${hue} 70% 42%)`);
      pg.addColorStop(0.45, `hsl(${hue} 85% 58%)`);
      pg.addColorStop(1, `hsl(${hue} 70% 40%)`);
      rr(g, px + 4, ty + th - 4 - fh, pw - 8, fh, 7);
      g.fillStyle = pg;
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      rr(g, px + 6, ty + th - fh, 3, Math.max(0, fh - 8), 2);
      g.fill();
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

    this.reel.classList.toggle('shake', !v.inside && v.progress < 0.35);
    this.reelPerfect.classList.toggle('lost', !v.perfect);
  }

  // ── catch card ───────────────────────────────────────────
  showCard(c: CatchCard): void {
    this.hideCard(true);
    const card = el('div', 'hvf-card');
    const q = c.quality > 0 ? `<span class="chip">${STAR(c.quality)}${['', 'Silver', 'Gold', 'Iridium'][c.quality]}</span>` : '';
    card.innerHTML = `<div class="frame">
      ${c.isNew ? '<div class="ribbon">NEW!</div>' : ''}${c.isRecord && !c.isNew ? '<div class="ribbon record">RECORD!</div>' : ''}
      <div class="art">${fishSvg(c.def, { size: 160, detail: true, tilt: -6 })}</div>
      <div class="info">
        <div class="kicker">You caught</div>
        <div class="name">${c.def.name}</div>
        <div class="stats"><span class="chip">${RULER}${c.lengthCm.toFixed(1)} cm</span>${q}<span class="chip gold">${COIN}${c.price}g</span></div>
        <div class="blurb">${c.def.blurb}</div>
        ${c.treasure ? `<div class="treasure">✦ Treasure: ${c.treasure}</div>` : ''}
      </div></div>`;
    this.root.appendChild(card);
    this.card = card;
    this.cardTimer = 4.5;
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
