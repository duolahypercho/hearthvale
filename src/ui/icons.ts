/**
 * Procedural item + HUD icons. Every item is painted as a 64×64 SVG "sticker": warm dark outline,
 * gradient body, a soft rim-shadow on the lower right, a glossy highlight on the upper left and small
 * hand-placed details (veins, grain, seeds, rivets). Icons are cached as data-URL <img>s so ids in
 * <defs> never collide and the DOM stays light.
 *
 *   itemIcon(id)                <img> HTML for an item (any id — unknown items get a keyword/kind icon)
 *   itemIconUrl(id)             data URL
 *   iconFor(id, icon, color)    legacy signature (same as itemIcon)
 *   ICONS                       small inline HUD glyphs (weather, seasons, coin, hearts …)
 *   itemCategory(id)            { label, color } for tooltips / ledgers
 */
import { itemDef, type ItemDef } from '../data/items';

const OL = '#3b2313';
const SW = 2.4;

type Stop = string | [number, string];

function hex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}
function parse(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Multiply brightness (k<1 darker, k>1 lighter, blends toward white past 1). */
export function tone(c: string, k: number): string {
  const [r, g, b] = parse(c);
  const f = (v: number): number => (k <= 1 ? v * k : v + (255 - v) * (k - 1));
  return `rgb(${Math.round(Math.min(255, f(r)))},${Math.round(Math.min(255, f(g)))},${Math.round(Math.min(255, f(b)))})`;
}
function hueShift(c: string, warm: number): string {
  const [r, g, b] = parse(c);
  return `rgb(${Math.min(255, Math.round(r + warm * 30))},${Math.round(g + warm * 6)},${Math.max(0, Math.round(b - warm * 30))})`;
}

class Pen {
  private defs: string[] = [];
  private out: string[] = [];
  private n = 0;
  constructor(private p: string) {}

  private stops(s: Stop[]): string {
    return s.map((st, i) => (typeof st === 'string' ? `<stop offset="${s.length === 1 ? 0 : i / (s.length - 1)}" stop-color="${st}"/>` : `<stop offset="${st[0]}" stop-color="${st[1]}"/>`)).join('');
  }
  lin(s: Stop[], x1 = 0.25, y1 = 0, x2 = 0.75, y2 = 1): string {
    const id = `${this.p}${this.n++}`;
    this.defs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${this.stops(s)}</linearGradient>`);
    return `url(#${id})`;
  }
  rad(s: Stop[], cx = 0.38, cy = 0.32, r = 0.78): string {
    const id = `${this.p}${this.n++}`;
    this.defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${this.stops(s)}</radialGradient>`);
    return `url(#${id})`;
  }
  /** Outlined shape. */
  shape(d: string, fill: string, sw = SW, extra = ''): this {
    this.out.push(`<path d="${d}" fill="${fill}" stroke="${OL}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`);
    return this;
  }
  /** Unoutlined fill (shading / highlights). */
  fill(d: string, fill: string, op = 1): this {
    this.out.push(`<path d="${d}" fill="${fill}" opacity="${op}"/>`);
    return this;
  }
  line(d: string, stroke: string, w = 1.6, op = 1): this {
    this.out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`);
    return this;
  }
  circle(cx: number, cy: number, r: number, fill: string, outline = true, op = 1): this {
    this.out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${outline ? `stroke="${OL}" stroke-width="${SW * 0.8}"` : ''} opacity="${op}"/>`);
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, fill: string, outline = true, op = 1, rot = 0): this {
    this.out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${outline ? `stroke="${OL}" stroke-width="${SW * 0.8}"` : ''} opacity="${op}" ${rot ? `transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`);
    return this;
  }
  /** Soft white glint. */
  glint(cx: number, cy: number, rx: number, ry: number, rot = -30, op = 0.75): this {
    return this.ellipse(cx, cy, rx, ry, '#fff', false, op, rot);
  }
  raw(s: string): this {
    this.out.push(s);
    return this;
  }
  svg(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${this.defs.join('')}</defs>${this.out.join('')}</svg>`;
  }
}

type Painter = (p: Pen, color?: string) => void;

// ── Shared parts ────────────────────────────────────────────────────────────

const WOOD: Stop[] = ['#e0a868', '#b77a40', '#7d4a22'];
const STEEL: Stop[] = [[0, '#ffffff'], [0.35, '#d7dee6'], [0.7, '#9aa6b3'], [1, '#6d7784']];

function handle(p: Pen, x1: number, y1: number, x2: number, y2: number, w = 6.5): void {
  p.raw(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${OL}" stroke-width="${w + SW * 2}" stroke-linecap="round"/>`);
  p.raw(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${p.lin(WOOD, 0, 0, 1, 1)}" stroke-width="${w}" stroke-linecap="round"/>`);
  // grain + highlight
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * (w * 0.22);
  const ny = (dx / len) * (w * 0.22);
  p.line(`M${x1 + nx} ${y1 + ny} L${x2 + nx} ${y2 + ny}`, '#ffe0b0', 1.4, 0.7);
  p.line(`M${x1 - nx * 1.3 + dx * 0.3} ${y1 - ny * 1.3 + dy * 0.3} L${x1 - nx * 1.3 + dx * 0.55} ${y1 - ny * 1.3 + dy * 0.55}`, '#6b3c18', 1, 0.6);
}

function leaf(p: Pen, d: string, vein: string, dark = '#2f6b2a', mid = '#5fae45', light = '#a6de6a'): void {
  p.shape(d, p.lin([light, mid, dark], 0.2, 0, 0.8, 1));
  p.line(vein, '#d9f5a8', 1.3, 0.75);
}

// ── Tools ───────────────────────────────────────────────────────────────────

const wateringCan: Painter = (p) => {
  // spout
  p.shape('M44 36 L57 20 L61 23 L50 40 Z', p.lin(['#8ad0e8', '#3f8fb4', '#24607f']));
  p.shape('M55 16 L63 22 L60 26 L52 20 Z', p.lin(['#bfe8f5', '#58a6c8']));
  // handle arch
  p.raw(`<path d="M16 26 C16 10 40 10 40 26" fill="none" stroke="${OL}" stroke-width="${8 + SW * 2}" stroke-linecap="round"/>`);
  p.raw(`<path d="M16 26 C16 10 40 10 40 26" fill="none" stroke="#3f8fb4" stroke-width="8" stroke-linecap="round"/>`);
  p.line('M18 22 C19 13 37 13 38 22', '#a8e0f2', 2, 0.8);
  // body
  p.shape('M8 28 C8 25 10 24 13 24 H43 C46 24 48 25 48 28 V52 C48 56 45 58 41 58 H15 C11 58 8 56 8 52 Z', p.lin(['#9fdcf0', '#4a9cc2', '#2a6a8c'], 0.1, 0, 0.9, 1));
  p.fill('M12 30 H44 V33 H12 Z', '#23597a', 0.35);
  p.shape('M8 44 H48', 'none', 1.8);
  p.fill('M12 27 C12 26 13 26 14 26 H20 V56 H15 C13 56 12 55 12 53 Z', '#fff', 0.35);
  p.glint(17, 36, 2.6, 6, 0, 0.7);
  // droplets
  p.shape('M60 32 C62 36 62 38 60 39 C58 38 58 36 60 32 Z', '#7fd0f5', 1.4);
  p.shape('M55 40 C57 44 57 46 55 47 C53 46 53 44 55 40 Z', '#7fd0f5', 1.4);
};

const weapon: Painter = (p) => {
  p.shape('M44 6 L58 6 L58 20 L26 48 L16 38 Z', p.lin(STEEL, 0, 0, 1, 1));
  p.fill('M46 9 L55 9 L24 42 L21 39 Z', '#fff', 0.6);
  p.shape('M12 34 L30 52 L26 56 L8 38 Z', '#8a5a2a');
  p.shape('M18 46 L8 56 C6 58 6 60 8 60 C10 60 11 60 12 58 L22 50 Z', p.lin(WOOD));
  p.circle(7, 58, 3.2, '#e0b04a');
};

// ── Resources ───────────────────────────────────────────────────────────────

function log(p: Pen, x: number, y: number, len: number, r: number): void {
  p.shape(`M${x} ${y - r} H${x + len} A${r * 0.55} ${r} 0 0 1 ${x + len} ${y + r} H${x} Z`, p.lin(['#c8894c', '#9a6030', '#6a3c1a'], 0, 0, 0, 1));
  p.line(`M${x + 3} ${y - r * 0.4} H${x + len - 6}`, '#e6b27a', 1.2, 0.7);
  p.line(`M${x + 6} ${y + r * 0.35} H${x + len - 10}`, '#5a3214', 1.1, 0.55);
  p.ellipse(x, y, r * 0.55, r, p.rad(['#f7dcae', '#e2b57a', '#b98044'], 0.5, 0.5, 0.6));
  p.ellipse(x, y, r * 0.3, r * 0.55, 'none', false);
  p.raw(`<ellipse cx="${x}" cy="${y}" rx="${r * 0.3}" ry="${r * 0.55}" fill="none" stroke="#a8743f" stroke-width="1.1"/>`);
  p.circle(x, y, 1.1, '#8a5a2a', false);
}
const wood: Painter = (p) => {
  log(p, 14, 42, 40, 9);
  log(p, 20, 24, 36, 9);
  p.shape('M42 14 C46 8 50 8 52 10 C50 12 47 14 45 16 Z', p.lin(['#a6de6a', '#4f9a3a']), 1.6);
};

function pebble(p: Pen, d: string, base = '#b3aea4'): void {
  p.shape(d, p.rad([tone(base, 1.25), base, tone(base, 0.62)], 0.35, 0.3, 0.85));
}
const stone: Painter = (p) => {
  pebble(p, 'M8 46 C6 36 14 28 24 28 C32 28 38 34 38 42 C38 52 30 56 20 56 C13 56 9 52 8 46 Z', '#a9a49a');
  pebble(p, 'M28 34 C27 22 36 14 46 15 C56 16 60 26 58 36 C56 46 46 50 38 48 C32 46 29 41 28 34 Z', '#bdb6a8');
  p.glint(41, 22, 5, 2.4, -20, 0.6);
  p.glint(17, 35, 3.6, 1.8, -25, 0.5);
  p.fill('M44 44 C48 44 52 42 55 38 C54 44 49 48 44 48 Z', '#6d8a3a', 0.55);
  p.line('M36 26 L40 30 L38 34', '#6e695f', 1.1, 0.7);
};

const fiber: Painter = (p) => {
  const blades = ['M22 58 C20 40 14 26 6 14', 'M28 58 C28 38 26 22 22 6', 'M34 58 C35 40 38 24 44 8', 'M40 58 C43 42 50 30 60 20', 'M31 58 C31 44 32 30 33 16'];
  blades.forEach((d, i) => {
    p.raw(`<path d="${d}" fill="none" stroke="${OL}" stroke-width="7" stroke-linecap="round"/>`);
    p.raw(`<path d="${d}" fill="none" stroke="${['#7cc04e', '#5fa83c', '#8fd05a', '#4f9a34', '#a6de6a'][i]}" stroke-width="3.6" stroke-linecap="round"/>`);
  });
  p.shape('M18 42 C24 45 38 45 46 42 L46 49 C38 52 24 52 18 49 Z', p.lin(['#f0cf8a', '#c8994a', '#9a6a2a']));
  p.line('M20 45.5 C28 48 36 48 44 45.5', '#fff0c8', 1.2, 0.8);
};

// ── Placeables ──────────────────────────────────────────────────────────────

const chest: Painter = (p) => {
  p.shape('M6 30 H58 V54 C58 57 56 58 53 58 H11 C8 58 6 57 6 54 Z', p.lin(['#c98a4a', '#9a5e2a', '#6a3c18'], 0, 0, 0, 1));
  p.shape('M6 30 C6 16 14 10 32 10 C50 10 58 16 58 30 Z', p.lin(['#dca060', '#b0703a', '#7d4a22'], 0, 0, 0, 1));
  for (const x of [16, 48]) {
    p.shape(`M${x - 3} 12 V58 H${x + 3} V12 Z`, p.lin(['#fff0b0', '#d9a83a', '#8a6414'], 0, 0.5, 1, 0.5), 1.6);
  }
  p.shape('M6 30 H58 V35 H6 Z', '#5a3414', 1.8);
  p.shape('M26 27 H38 V41 C38 43 36 44 32 44 C28 44 26 43 26 41 Z', p.lin(['#fff4c0', '#e0b048', '#9a6a14']));
  p.circle(32, 34, 2, '#3b2313', false);
  p.fill('M31 35 H33 V39 H31 Z', '#3b2313');
  p.fill('M10 16 C16 12 26 12 32 12 C22 14 14 18 10 26 Z', '#fff', 0.35);
  p.line('M10 44 H22 M42 48 H54', '#4a2810', 1.1, 0.5);
};

const scarecrow: Painter = (p) => {
  p.shape('M29 30 H35 V62 H29 Z', p.lin(WOOD, 0, 0.5, 1, 0.5));
  p.shape('M8 34 H56 V39 H8 Z', p.lin(WOOD, 0, 0, 0, 1));
  // shirt
  p.shape('M20 32 C26 28 38 28 44 32 L46 50 C40 52 24 52 18 50 Z', p.lin(['#8fb4e0', '#4f7ab8', '#2f4f80']));
  p.fill('M24 34 L28 34 L27 48 L23 48 Z', '#e8674a', 0.8);
  p.shape('M14 34 C12 38 10 40 8 40 M50 34 C52 38 54 40 56 40', 'none', 1.8);
  p.line('M8 39 L5 44 M9 39 L8 45 M56 39 L59 44 M55 39 L56 45', '#f0cf6a', 1.8);
  // head
  p.circle(32, 21, 9, p.rad(['#f7e2b0', '#d9b27a', '#a07a44']));
  p.line('M28 20 L29.5 21.5 M29.5 20 L28 21.5 M34.5 20 L36 21.5 M36 20 L34.5 21.5', OL, 1.4);
  p.line('M28 25 C30 27 34 27 36 25', OL, 1.4);
  // hat
  p.shape('M16 17 C22 14 42 14 48 17 C44 19 20 19 16 17 Z', p.lin(['#f7d77a', '#c99a3a']));
  p.shape('M24 16 C24 6 40 6 40 16 Z', p.lin(['#f7d77a', '#d9a444', '#9a6a1a']));
  p.fill('M24 13 H40 V15.5 H24 Z', '#c8573e', 0.9);
};

const woodFence: Painter = (p) => {
  for (const x of [14, 50]) {
    p.shape(`M${x - 5} 16 L${x} 10 L${x + 5} 16 V58 H${x - 5} Z`, p.lin(['#dca060', '#a8703a', '#6e4220'], 0, 0.5, 1, 0.5));
    p.fill(`M${x - 3} 17 L${x - 1} 15 V56 H${x - 3} Z`, '#fff', 0.35);
  }
  for (const y of [24, 40]) {
    p.shape(`M4 ${y} H60 V${y + 7} H4 Z`, p.lin(['#e2aa68', '#b07640', '#7d4a22'], 0, 0, 0, 1));
    p.line(`M8 ${y + 2} H56`, '#ffe0b0', 1.1, 0.6);
  }
  p.circle(14, 27.5, 1.3, '#4a2a10', false).circle(50, 27.5, 1.3, '#4a2a10', false).circle(14, 43.5, 1.3, '#4a2a10', false).circle(50, 43.5, 1.3, '#4a2a10', false);
  p.fill('M4 58 C18 54 46 54 60 58 Z', '#5fae45', 0.9);
};

const stonePath: Painter = (p) => {
  p.shape('M6 24 L32 12 L58 24 L58 40 L32 52 L6 40 Z', p.lin(['#b9a888', '#8f7e62', '#5e5040']));
  p.fill('M6 24 L32 36 L58 24 L58 40 L32 52 L6 40 Z', '#4a3c2c', 0.35);
  const stones = [
    'M14 24 L22 20 L28 23 L22 27 Z',
    'M30 19 L38 16 L44 19 L37 23 Z',
    'M24 29 L32 25 L40 29 L32 33 Z',
    'M42 25 L48 22 L52 25 L46 28 Z',
    'M12 30 L18 27 L22 30 L16 33 Z',
  ];
  stones.forEach((d, i) => p.shape(d, p.lin([['#f2ece0', '#e0d6c4', '#d8cdb8', '#ece4d4', '#e6dcca'][i]!, '#a89c88']), 1.4));
  p.fill('M6 40 L32 52 L32 48 L6 36 Z', '#fff', 0.08);
  p.line('M8 26 L10 25', '#6fae45', 2, 0.9);
  p.line('M54 27 L56 26', '#6fae45', 2, 0.9);
};

// ── Crops ───────────────────────────────────────────────────────────────────

const parsnip: Painter = (p) => {
  leaf(p, 'M32 26 C26 16 18 11 10 10 C14 16 20 22 29 28 Z', 'M29 26 C24 20 18 15 13 12');
  leaf(p, 'M34 26 C38 16 46 11 54 11 C50 17 43 22 36 28 Z', 'M36 25 C41 19 47 15 51 13');
  leaf(p, 'M32 26 C30 16 31 8 36 2 C39 9 38 18 34 27 Z', 'M33 24 C33 17 34 10 36 5');
  p.shape('M32 62 C26 52 20 42 20 34 C20 27 25 24 32 24 C39 24 44 27 44 34 C44 42 38 52 32 62 Z', p.rad(['#fffbe8', '#f4e2ae', '#d2b074'], 0.35, 0.3, 0.8));
  p.line('M24 35 C27 36 29 36 31 35', '#b8955a', 1.3, 0.8).line('M34 41 C36 42 38 42 40 40', '#b8955a', 1.3, 0.8).line('M27 46 C29 47 31 47 33 46', '#b8955a', 1.3, 0.8);
  p.fill('M24 30 C23 36 25 42 28 46 C28 40 28 34 29 29 Z', '#fff', 0.7);
  p.fill('M40 32 C41 40 37 48 33 55 C38 50 43 42 42 33 Z', '#b08a50', 0.35);
};

const potato: Painter = (p) => {
  p.shape('M8 36 C6 24 16 14 30 14 C44 14 58 22 58 34 C58 46 48 54 34 54 C20 54 10 48 8 36 Z', p.rad(['#f2c88e', '#d09a5c', '#8e5c2c'], 0.38, 0.3, 0.85));
  for (const [x, y] of [
    [20, 28],
    [36, 24],
    [46, 36],
    [28, 42],
    [16, 38],
  ])
    p.ellipse(x!, y!, 2.2, 1.4, '#8a5a2a', false, 0.8).ellipse(x! + 0.6, y! - 0.6, 1, 0.6, '#f7dcae', false, 0.8);
  p.glint(22, 21, 7, 3, -18, 0.55);
  for (let i = 0; i < 14; i++) p.circle(14 + ((i * 37) % 40), 24 + ((i * 23) % 24), 0.6, '#7a4a20', false, 0.5);
  p.fill('M50 42 C46 50 38 53 30 53 C40 50 48 46 52 38 Z', '#6a4020', 0.35);
};

const cauliflower: Painter = (p) => {
  leaf(p, 'M6 36 C4 50 18 60 32 60 C22 54 14 46 12 34 Z', 'M10 40 C14 50 20 56 28 58', '#2d6b3a', '#4f9a5a', '#8cd08a');
  leaf(p, 'M58 36 C60 50 46 60 32 60 C42 54 50 46 52 34 Z', 'M54 40 C50 50 44 56 36 58', '#2d6b3a', '#4f9a5a', '#8cd08a');
  const cream = p.rad(['#ffffff', '#f6f0dc', '#d8ccaa'], 0.4, 0.3, 0.75);
  p.shape('M10 36 C8 22 18 10 32 10 C46 10 56 22 54 36 C50 44 14 44 10 36 Z', cream);
  for (const [x, y, r] of [
    [20, 22, 7],
    [32, 17, 7.5],
    [44, 22, 7],
    [26, 32, 7],
    [39, 32, 7],
    [15, 32, 5.5],
    [49, 32, 5.5],
  ]) {
    p.circle(x!, y!, r!, p.rad(['#ffffff', '#f3ecd4', '#cfc29e'], 0.4, 0.3, 0.8), true);
    p.circle(x! - r! * 0.3, y! - r! * 0.3, r! * 0.25, '#fff', false, 0.9);
  }
  leaf(p, 'M20 42 C24 52 30 56 32 60 C34 56 40 52 44 42 C38 46 26 46 20 42 Z', 'M32 46 V58', '#2d6b3a', '#5fae5a', '#9ce09a');
};

const kale: Painter = (p) => {
  const curl = (d: string, v: string, k: number): void => leaf(p, d, v, tone('#1f5a40', k), tone('#3f8a5a', k), tone('#7cc08a', k));
  curl('M30 60 C18 52 6 40 8 22 C12 26 14 22 16 26 C18 22 20 26 22 22 C26 34 30 46 32 60 Z', 'M30 58 C22 46 16 36 12 26', 0.9);
  curl('M34 60 C46 52 58 40 56 22 C52 26 50 22 48 26 C46 22 44 26 42 22 C38 34 34 46 32 60 Z', 'M34 58 C42 46 48 36 52 26', 0.95);
  curl('M32 60 C24 46 20 30 24 12 C26 16 28 8 30 12 C32 4 34 12 36 8 C38 14 40 10 42 14 C44 30 40 46 32 60 Z', 'M32 58 C32 42 32 26 33 12', 1.05);
  p.line('M28 30 L24 26 M29 40 L24 36 M36 30 L40 26 M35 40 L40 36', '#cdf0b8', 1.1, 0.7);
  p.fill('M26 14 C24 26 25 36 28 46 C26 34 26 24 28 14 Z', '#fff', 0.35);
};

const strawberry: Painter = (p) => {
  p.shape('M32 62 C18 52 8 38 10 26 C12 16 22 14 32 18 C42 14 52 16 54 26 C56 38 46 52 32 62 Z', p.rad(['#ff8a8a', '#e8323c', '#8e1620'], 0.35, 0.3, 0.8));
  for (let i = 0; i < 16; i++) {
    const x = 18 + ((i * 29) % 30);
    const y = 26 + ((i * 17) % 26);
    if (Math.abs(x - 32) > 18 - (y - 26) * 0.5) continue;
    p.ellipse(x, y, 1.1, 1.6, '#ffe88a', false, 0.95).ellipse(x, y + 0.8, 1.1, 0.6, '#8e1620', false, 0.4);
  }
  p.glint(20, 28, 3.5, 6.5, 15, 0.6);
  leaf(p, 'M32 20 L20 14 L26 12 L22 6 L30 9 L32 2 L34 9 L42 6 L38 12 L44 14 Z', 'M32 18 V6', '#2f6a2a', '#4f9a3a', '#8fd05a');
};

const tomato: Painter = (p) => {
  p.shape('M8 36 C8 22 18 14 32 14 C46 14 56 22 56 36 C56 50 46 60 32 60 C18 60 8 50 8 36 Z', p.rad(['#ff9a78', '#ea4a30', '#94200e'], 0.36, 0.3, 0.8));
  p.line('M20 18 C16 30 18 44 24 56 M44 18 C48 30 46 44 40 56', '#b8301a', 1.4, 0.45);
  p.glint(20, 26, 6, 3.5, -30, 0.7).glint(16, 34, 1.6, 1.6, 0, 0.8);
  leaf(p, 'M32 18 L20 20 L26 14 L20 8 L30 11 L32 4 L34 11 L44 8 L38 14 L44 20 Z', 'M32 16 V8', '#2f6a2a', '#4f9a3a', '#8fd05a');
};

const corn: Painter = (p) => {
  p.shape('M32 4 C44 8 46 40 38 58 L26 58 C18 40 20 8 32 4 Z', p.lin(['#fff2a8', '#f5c73a', '#c8901a'], 0, 0.5, 1, 0.5));
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 4; c++) {
      const y = 11 + r * 5;
      const w = 12 - Math.abs(r - 3.5) * 0.9;
      const x = 32 - w / 2 + (c + 0.5 + (r % 2) * 0.3) * (w / 4.3);
      p.ellipse(x, y, 1.9, 2.1, r < 2 ? '#fff1a0' : '#ffd84a', false, 0.95).ellipse(x - 0.5, y - 0.6, 0.7, 0.6, '#fff', false, 0.8);
    }
  leaf(p, 'M26 58 C14 50 8 36 10 22 C16 32 22 42 30 50 Z', 'M26 54 C18 44 14 34 12 26', '#3f6a1a', '#7fb04a', '#c8e888');
  leaf(p, 'M38 58 C50 50 56 36 54 22 C48 32 42 42 34 50 Z', 'M38 54 C46 44 50 34 52 26', '#3f6a1a', '#7fb04a', '#c8e888');
  p.line('M31 4 C28 1 26 1 24 2 M33 4 C36 1 38 1 40 3', '#b8783a', 1.4);
};

const sunflower: Painter = (p) => {
  for (let ring = 0; ring < 2; ring++) {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = ((i + ring * 0.5) / n) * Math.PI * 2;
      const r1 = 13;
      const r2 = ring ? 27 : 29;
      const cx = 32 + Math.cos(a) * ((r1 + r2) / 2);
      const cy = 32 + Math.sin(a) * ((r1 + r2) / 2);
      p.ellipse(cx, cy, (r2 - r1) / 2 + 1, 4.4, ring ? '#ffd23a' : '#f5a818', true, 1, (a * 180) / Math.PI);
    }
  }
  p.circle(32, 32, 13.5, p.rad(['#8a5a2a', '#5a3414', '#2e1a0a'], 0.4, 0.35, 0.8));
  for (let i = 0; i < 28; i++) {
    const a = i * 2.39996;
    const r = Math.sqrt(i / 28) * 10.5;
    p.circle(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 1, '#c89a4a', false, 0.85);
  }
  p.glint(27, 26, 4, 2, -30, 0.35);
};

const pumpkin: Painter = (p) => {
  const body = p.rad(['#ffc070', '#f08a2a', '#a4480e'], 0.38, 0.32, 0.85);
  p.shape('M32 18 C16 16 6 26 6 40 C6 52 16 60 28 58 C30 60 34 60 36 58 C48 60 58 52 58 40 C58 26 48 16 32 18 Z', body);
  p.shape('M32 18 C24 22 22 50 28 58 C30 60 34 60 36 58 C42 50 40 22 32 18 Z', p.lin(['#ffb050', '#e87a20', '#a8500e']));
  p.line('M18 22 C12 32 12 48 20 57 M46 22 C52 32 52 48 44 57', '#b85a14', 1.6, 0.7);
  p.glint(16, 32, 3, 7, 10, 0.5).glint(30, 26, 1.5, 5, 0, 0.55);
  p.shape('M30 19 C29 12 31 8 36 5 L39 8 C35 10 34 14 35 19 Z', p.lin(['#8aa84a', '#4f6a24']));
  p.line('M38 7 C44 4 48 8 46 12 C44 15 41 13 43 11', '#5a8a2a', 1.8);
  leaf(p, 'M24 14 C18 8 10 10 8 14 C12 18 18 18 24 14 Z', 'M22 14 C18 13 14 13 10 14');
};


const greenBean: Painter = (p) => {
  leaf(p, 'M34 12 C40 4 50 4 56 8 C52 14 44 16 36 16 Z', 'M36 14 C42 11 48 9 53 8');
  for (const [dx, rot] of [
    [0, 0],
    [12, 10],
  ] as const) {
    p.raw(`<g transform="rotate(${rot} 32 32) translate(${dx - 6} 0)">`);
    p.shape('M28 12 C24 22 22 36 26 50 C28 56 32 60 34 58 C32 50 32 36 34 22 C35 16 34 12 30 10 Z', p.lin(['#b8e888', '#6fb84a', '#3a7a2a'], 0, 0.5, 1, 0.5));
    for (const y of [22, 32, 42]) p.ellipse(29.5, y, 2.4, 3.6, '#9ad870', false, 0.9);
    p.fill('M27 16 C25 26 25 38 27 48 C26 38 26 26 28 16 Z', '#fff', 0.55);
    p.raw('</g>');
  }
};

const blueberry: Painter = (p) => {
  leaf(p, 'M34 14 C40 4 52 4 58 10 C50 16 42 18 34 14 Z', 'M36 14 C42 11 49 9 55 10', '#2f5a3a', '#4f8a5a', '#8cc08a');
  for (const [x, y, r] of [
    [22, 28, 10],
    [42, 30, 10.5],
    [30, 46, 11],
    [14, 46, 8],
    [48, 48, 8.5],
  ]) {
    p.circle(x!, y!, r!, p.rad(['#a8b8ff', '#4a5fc8', '#1e2a6a'], 0.38, 0.32, 0.8));
    p.raw(`<path d="M${x! - 2.4} ${y! - r! + 3} l2.4 2 l2.4 -2" fill="none" stroke="#1e2a6a" stroke-width="1.3"/>`);
    p.glint(x! - r! * 0.35, y! - r! * 0.3, r! * 0.28, r! * 0.16, -30, 0.7);
    p.circle(x!, y!, r!, '#d8e4ff', false, 0.12);
  }
};

const melon: Painter = (p) => {
  p.shape('M6 34 C6 18 18 8 32 8 C46 8 58 18 58 34 C58 50 46 60 32 60 C18 60 6 50 6 34 Z', p.rad(['#d8f0a0', '#8fc45a', '#3f7a2a'], 0.38, 0.3, 0.85));
  for (const d of ['M32 9 C24 20 24 48 32 59', 'M32 9 C40 20 40 48 32 59', 'M20 12 C10 24 12 46 22 57', 'M44 12 C54 24 52 46 42 57'])
    p.line(d, '#4f8a2e', 2.6, 0.7);
  for (let i = 0; i < 10; i++) p.line(`M${16 + ((i * 17) % 32)} ${18 + ((i * 11) % 30)} l2 1`, '#eaf8c8', 1.2, 0.8);
  p.glint(20, 20, 7, 3.5, -35, 0.6);
  p.shape('M31 9 C30 5 32 3 35 2', 'none', 2.6);
};

const hotPepper: Painter = (p) => {
  p.shape('M22 14 C30 12 36 16 38 24 C40 36 44 48 56 56 C44 60 30 54 24 42 C20 34 18 22 22 14 Z', p.lin(['#ff8a6a', '#e0321e', '#8a1408'], 0, 0.3, 1, 0.8));
  p.fill('M24 20 C24 30 28 40 36 48 C30 40 26 30 26 20 Z', '#fff', 0.55);
  p.shape('M18 14 C20 8 28 8 30 14 C26 16 22 16 18 14 Z', p.lin(['#8fd05a', '#3f7a2a']));
  p.line('M24 10 C22 6 20 4 16 4', '#3f7a2a', 2.6);
};

const hops: Painter = (p) => {
  leaf(p, 'M38 8 C46 2 58 6 60 14 C52 18 44 16 38 8 Z', 'M40 9 C47 9 53 11 58 14');
  p.line('M32 6 C34 12 30 18 26 22 M32 6 C38 14 42 20 42 26', '#6a8a2a', 1.8);
  for (const [x, y, s] of [
    [24, 36, 1],
    [42, 40, 0.9],
  ]) {
    p.raw(`<g transform="translate(${x} ${y}) scale(${s})">`);
    for (let i = 0; i < 5; i++) {
      const yy = -12 + i * 5.5;
      const w = 9 - Math.abs(i - 2) * 1.6;
      p.shape(`M${-w} ${yy} C${-w} ${yy + 6} ${w} ${yy + 6} ${w} ${yy} C${w * 0.6} ${yy + 2} ${-w * 0.6} ${yy + 2} ${-w} ${yy} Z`, p.lin(['#e8f8b0', '#b8d86a', '#6a9a2a'], 0, 0, 0, 1), 1.6);
    }
    p.raw('</g>');
  }
};

const eggplant: Painter = (p) => {
  p.shape('M24 18 C14 24 10 40 16 52 C22 62 42 62 50 52 C56 44 50 34 42 26 C38 22 34 16 24 18 Z', p.rad(['#b88ad8', '#5a2a6e', '#240a30'], 0.35, 0.3, 0.85));
  p.glint(20, 32, 3.5, 9, 20, 0.55).glint(38, 48, 5, 2, -20, 0.25);
  p.shape('M18 20 C18 12 30 8 34 16 C30 22 22 24 18 20 Z', p.lin(['#8fd05a', '#3f7a2a']));
  p.shape('M28 12 C28 8 30 5 34 4 L36 6 C33 8 32 10 32 13 Z', '#4f7a2a', 1.8);
};

const grape: Painter = (p) => {
  leaf(p, 'M30 12 C22 2 8 6 6 16 C16 20 26 18 30 12 Z', 'M28 12 C20 11 14 13 9 16', '#3f6a1a', '#6a9a3a', '#a8d06a');
  p.line('M32 4 C32 8 32 10 32 14', '#6a4a2a', 2.6);
  const rows = [
    [24, 32, 40],
    [20, 28, 36, 44],
    [24, 32, 40],
    [28, 36],
    [32],
  ];
  rows.forEach((xs, r) =>
    xs.forEach((x) => {
      const y = 20 + r * 8;
      p.circle(x, y, 6, p.rad(['#d8a8f0', '#7a3a8e', '#3a1244'], 0.38, 0.32, 0.8));
      p.glint(x - 2, y - 2, 1.8, 1, -30, 0.8);
    }),
  );
};

const beet: Painter = (p) => {
  leaf(p, 'M30 26 C24 14 20 6 12 4 C14 12 18 20 28 28 Z', 'M28 26 C22 18 18 11 14 6', '#3a6a2a', '#5a9a3a', '#9ad06a');
  leaf(p, 'M34 26 C38 12 46 6 54 6 C50 14 44 22 36 28 Z', 'M36 25 C41 17 46 11 51 8', '#3a6a2a', '#5a9a3a', '#9ad06a');
  p.line('M28 26 L20 10 M36 26 L46 10', '#b8304a', 1.6, 0.85);
  p.shape('M32 60 C30 56 30 54 30 52 C18 50 12 42 14 34 C16 26 24 24 32 24 C40 24 48 26 50 34 C52 42 46 50 34 52 C34 54 34 56 32 60 Z', p.rad(['#e0587a', '#9a1e3e', '#4a0a1a'], 0.36, 0.3, 0.85));
  p.glint(22, 32, 4, 6, 25, 0.45);
  p.line('M22 40 C26 42 30 42 34 41 M30 46 C34 47 38 46 40 44', '#6a0e24', 1.2, 0.6);
};

const yam: Painter = (p) => {
  p.shape('M6 40 C4 30 14 22 26 22 C34 20 42 16 50 18 C58 20 60 30 56 38 C52 46 40 50 28 52 C16 54 8 50 6 40 Z', p.rad(['#f0a07a', '#b85a3a', '#6a2a14'], 0.36, 0.3, 0.9));
  p.line('M14 36 C18 38 22 38 26 36 M32 30 C36 32 40 32 44 30 M28 44 C32 46 36 46 40 43', '#7a3418', 1.3, 0.7);
  p.glint(22, 28, 7, 2.5, -15, 0.45);
  p.line('M56 30 C60 28 62 26 62 22 M8 44 C4 46 2 48 2 52', '#6a3418', 1.8);
  leaf(p, 'M40 16 C38 6 46 2 52 4 C54 10 48 16 40 16 Z', 'M42 14 C45 10 48 7 51 5');
};

const shell: Painter = (p, color = '#f0d8b8') => {
  p.shape('M32 8 C46 8 58 22 58 36 C58 44 52 48 46 50 L40 56 H24 L18 50 C12 48 6 44 6 36 C6 22 18 8 32 8 Z', p.rad([tone(color, 1.25), color, tone(color, 0.62)], 0.5, 0.3, 0.9));
  for (let i = -3; i <= 3; i++) p.line(`M32 54 L${32 + i * 7.5} ${14 + Math.abs(i) * 4}`, tone(color, 0.6), 1.5, 0.75);
  p.shape('M24 56 H40 L38 60 H26 Z', tone(color, 0.8), 1.6);
  p.glint(22, 20, 5, 2.5, -30, 0.6);
};

const conch: Painter = (p, color = '#f2b8a0') => {
  p.shape('M10 30 C10 16 26 6 40 10 C52 14 58 26 54 38 C50 50 38 58 26 56 L14 60 L16 50 C12 44 10 38 10 30 Z', p.rad([tone(color, 1.3), color, tone(color, 0.6)], 0.4, 0.35, 0.85));
  p.line('M40 10 C30 16 28 26 34 32 C40 38 48 32 46 26', tone(color, 0.55), 1.8, 0.8);
  p.shape('M22 36 C26 30 36 32 36 40 C36 48 26 52 20 48 Z', '#ffd8d0', 1.6);
  p.glint(22, 18, 6, 2.5, -30, 0.55);
};

const starfish: Painter = (p, color = '#f07a3a') => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 11 : 27;
    pts.push(`${(32 + Math.cos(a) * r).toFixed(1)} ${(34 + Math.sin(a) * r).toFixed(1)}`);
  }
  p.shape(`M${pts.join(' L')} Z`, p.rad([tone(color, 1.35), color, tone(color, 0.55)], 0.4, 0.35, 0.8));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    for (const k of [0.35, 0.55, 0.75]) p.circle(32 + Math.cos(a) * 27 * k, 34 + Math.sin(a) * 27 * k, 1.2, '#ffe0c0', false, 0.9);
  }
};

const sandDollar: Painter = (p, color = '#f2ead2') => {
  p.circle(32, 32, 25, p.rad([tone(color, 1.2), color, tone(color, 0.7)], 0.4, 0.35, 0.8));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    p.ellipse(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 7, 2.6, 'none', false, 1, (a * 180) / Math.PI);
    p.raw(`<ellipse cx="${32 + Math.cos(a) * 9}" cy="${32 + Math.sin(a) * 9}" rx="7" ry="2.6" fill="${tone(color, 0.8)}" stroke="${tone(color, 0.55)}" stroke-width="1.2" transform="rotate(${(a * 180) / Math.PI} ${32 + Math.cos(a) * 9} ${32 + Math.sin(a) * 9})"/>`);
  }
  p.circle(32, 32, 2, tone(color, 0.6), false);
};

const seaGlass: Painter = (p, color = '#7ad0b8') => {
  p.shape('M12 30 C10 20 20 10 32 12 C44 12 54 20 52 32 C52 44 44 54 30 52 C18 52 12 42 12 30 Z', p.rad([tone(color, 1.5), color, tone(color, 0.6)], 0.4, 0.35, 0.8), SW, 'opacity="0.92"');
  p.fill('M18 26 C18 20 24 16 30 16 C24 20 22 26 22 32 Z', '#fff', 0.7);
  p.circle(40, 40, 4, '#fff', false, 0.25);
};

const coral: Painter = (p, color = '#f0707a') => {
  const br = ['M32 60 C32 46 30 34 22 22', 'M31 46 C24 42 16 40 10 30', 'M32 40 C38 32 44 26 48 14', 'M40 30 C46 30 52 26 56 20', 'M26 30 C26 22 28 16 32 8'];
  for (const d of br) p.raw(`<path d="${d}" fill="none" stroke="${OL}" stroke-width="9" stroke-linecap="round"/>`);
  for (const d of br) p.raw(`<path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`);
  for (const d of br) p.line(d, tone(color, 1.4), 1.6, 0.8);
  p.shape('M18 60 C22 54 42 54 46 60 Z', '#e8d2a8', 1.8);
};

// ── Generic painters for items other teams add (fish, minerals, forage, food …) ──

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function fishPainter(seed: number): Painter {
  return (p, color = '#6fb0d8') => {
    const long = 0.85 + ((seed >> 3) % 5) * 0.07;
    const fat = 0.85 + ((seed >> 7) % 5) * 0.08;
    const tailShape = (seed >> 11) % 3;
    const spots = (seed >> 13) % 3;
    const cx = 30;
    const rx = 22 * long;
    const ry = 12 * fat;
    const back = tone(color, 0.62);
    const belly = tone(color, 1.55);
    // tail
    const tx = cx + rx - 3;
    const tail =
      tailShape === 0
        ? `M${tx} 34 L${tx + 16} 20 C${tx + 13} 28 ${tx + 13} 40 ${tx + 16} 48 Z`
        : tailShape === 1
          ? `M${tx} 34 C${tx + 6} 26 ${tx + 12} 20 ${tx + 18} 22 C${tx + 12} 30 ${tx + 12} 38 ${tx + 18} 46 C${tx + 12} 48 ${tx + 6} 42 ${tx} 34 Z`
          : `M${tx} 34 L${tx + 15} 24 L${tx + 11} 34 L${tx + 15} 44 Z`;
    p.shape(tail, p.lin([tone(color, 1.2), back], 0, 0, 1, 1));
    p.line(`M${tx + 3} 34 L${tx + 12} 27 M${tx + 3} 34 L${tx + 12} 41`, back, 1.1, 0.7);
    // dorsal + pelvic fins
    p.shape(`M${cx - 8} ${34 - ry + 2} C${cx - 4} ${34 - ry - 9} ${cx + 8} ${34 - ry - 8} ${cx + 12} ${34 - ry + 3} Z`, p.lin([tone(color, 1.2), back]));
    p.shape(`M${cx} ${34 + ry - 2} C${cx + 2} ${34 + ry + 6} ${cx + 8} ${34 + ry + 6} ${cx + 10} ${34 + ry - 3} Z`, back, 1.8);
    // body
    p.ellipse(cx, 34, rx, ry, p.lin([back, color, belly], 0.5, 0, 0.5, 1));
    p.fill(`M${cx - rx + 4} 38 C${cx - 6} ${34 + ry} ${cx + 10} ${34 + ry} ${cx + rx - 4} 37 C${cx + 8} ${34 + ry * 0.6} ${cx - 8} ${34 + ry * 0.6} ${cx - rx + 4} 38 Z`, belly, 0.55);
    // scales / spots
    if (spots === 0) for (let i = 0; i < 5; i++) p.line(`M${cx - 6 + i * 6} ${30} c2 2 2 4 0 6`, back, 1, 0.5);
    if (spots === 1) for (let i = 0; i < 6; i++) p.circle(cx - 6 + ((i * 11) % 26), 28 + ((i * 7) % 9), 1.4, back, false, 0.7);
    if (spots === 2) p.line(`M${cx - rx + 8} 33 H${cx + rx - 6}`, tone(color, 1.35), 2.4, 0.75);
    // gill + eye
    p.line(`M${cx - rx + 11} ${34 - ry * 0.6} C${cx - rx + 14} 32 ${cx - rx + 14} 37 ${cx - rx + 11} ${34 + ry * 0.6}`, back, 1.4, 0.8);
    p.circle(cx - rx + 6.5, 31, 3.2, '#fff');
    p.circle(cx - rx + 6, 31, 1.7, '#1b1410', false);
    p.circle(cx - rx + 5.4, 30.3, 0.6, '#fff', false);
    p.glint(cx - 4, 34 - ry * 0.55, rx * 0.45, 2, -4, 0.55);
  };
}

const ore: Painter = (p, color = '#d98a4a') => {
  pebble(p, 'M6 44 C4 30 14 18 30 16 C46 14 60 26 58 40 C56 54 42 60 28 58 C16 56 8 52 6 44 Z', '#8a837a');
  for (const [x, y, s] of [
    [22, 30, 6],
    [38, 26, 5],
    [42, 42, 6.5],
    [24, 46, 4.5],
  ]) {
    p.shape(`M${x! - s!} ${y!} L${x! - s! * 0.3} ${y! - s!} L${x! + s! * 0.8} ${y! - s! * 0.5} L${x! + s!} ${y! + s! * 0.5} L${x! - s! * 0.2} ${y! + s!} Z`, p.lin([tone(color, 1.5), color, tone(color, 0.6)]), 1.6);
    p.glint(x! - s! * 0.3, y! - s! * 0.4, s! * 0.35, s! * 0.18, -30, 0.85);
  }
};

const bar: Painter = (p, color = '#e8b04a') => {
  p.shape('M6 44 L16 26 H50 L58 44 Z', p.lin([tone(color, 1.45), color], 0, 0, 0, 1));
  p.shape('M6 44 H58 L54 54 H10 Z', p.lin([color, tone(color, 0.55)], 0, 0, 0, 1));
  p.fill('M18 29 H46 L49 34 H16 Z', '#fff', 0.55);
  p.line('M20 38 H44', tone(color, 0.7), 1.2, 0.6);
  p.glint(50, 36, 2.5, 1.2, 60, 0.8);
};

const gem: Painter = (p, color = '#b56adf') => {
  p.shape('M18 12 H46 L58 26 L32 58 L6 26 Z', p.lin([tone(color, 1.5), color, tone(color, 0.5)], 0.2, 0, 0.8, 1));
  p.fill('M18 12 L26 26 L32 12 Z', '#fff', 0.35).fill('M32 12 L38 26 L46 12 Z', '#fff', 0.2).fill('M6 26 H58 L32 58 Z', tone(color, 0.6), 0.35);
  p.line('M6 26 H58 M18 12 L26 26 L32 58 M46 12 L38 26 L32 58 M32 12 L26 26 M32 12 L38 26', OL, 1.2, 0.55);
  p.glint(22, 18, 4, 2, -20, 0.9);
  p.raw('<path d="M50 6 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 Z" fill="#fff"/>');
};

const geode: Painter = (p, color = '#9ab4d8') => {
  pebble(p, 'M8 36 C8 20 20 10 34 10 C48 10 58 22 56 38 C54 52 42 58 30 58 C16 58 8 50 8 36 Z', '#a89c8a');
  p.shape('M20 30 C22 22 30 18 38 20 C46 22 50 30 46 40 C42 48 30 50 24 44 C20 40 19 34 20 30 Z', p.rad([tone(color, 1.6), color, tone(color, 0.5)], 0.5, 0.5, 0.6));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    p.fill(`M${34 + Math.cos(a) * 3} ${34 + Math.sin(a) * 3} L${34 + Math.cos(a + 0.2) * 12} ${34 + Math.sin(a + 0.2) * 11} L${34 + Math.cos(a - 0.2) * 12} ${34 + Math.sin(a - 0.2) * 11} Z`, '#fff', 0.35);
  }
};

const coal: Painter = (p) => {
  pebble(p, 'M8 44 C6 32 16 24 26 26 C30 18 44 16 52 24 C60 30 60 44 52 50 C44 58 20 58 8 44 Z', '#4a4440');
  p.glint(30, 28, 4, 1.6, -20, 0.5).glint(46, 30, 3, 1.3, -40, 0.45).glint(20, 38, 2, 1, -10, 0.4);
  p.line('M26 30 L32 40 L28 50 M40 28 L44 42', '#1c1816', 1.2, 0.8);
};

const jar: Painter = (p, color = '#f0a830') => {
  p.shape('M14 20 H50 V52 C50 56 47 60 42 60 H22 C17 60 14 56 14 52 Z', p.lin(['#fdfcf6', '#dfe8e8', '#a8b8b8'], 0, 0.5, 1, 0.5), SW, 'opacity="0.95"');
  p.fill('M17 28 H47 V52 C47 55 45 57 42 57 H22 C19 57 17 55 17 52 Z', p.lin([tone(color, 1.3), color, tone(color, 0.6)], 0, 0, 0, 1));
  p.shape('M12 12 H52 V20 H12 Z', p.lin(['#f0d890', '#c89a3a', '#8a6414'], 0, 0, 0, 1));
  p.shape('M18 34 H46 V46 H18 Z', '#fbf0d6', 1.6);
  p.line('M22 38 H42 M24 42 H40', '#c8a878', 1.4);
  p.fill('M19 22 H23 V54 H19 Z', '#fff', 0.55);
  p.shape('M12 12 C16 6 48 6 52 12', 'none', 1.8);
};

const bottle: Painter = (p, color = '#8a2a4a') => {
  p.shape('M26 4 H38 V18 C46 22 50 30 50 38 V54 C50 58 46 60 42 60 H22 C18 60 14 58 14 54 V38 C14 30 18 22 26 18 Z', p.lin([tone(color, 1.3), color, tone(color, 0.45)], 0, 0.5, 1, 0.5));
  p.shape('M25 4 H39 V10 H25 Z', '#c89a5a', 1.8);
  p.shape('M18 36 H46 V50 H18 Z', '#f7eed6', 1.6);
  p.line('M22 41 H42 M26 45 H38', tone(color, 0.8), 1.4);
  p.fill('M20 26 C18 32 18 40 19 52 H22 V30 C23 28 24 26 26 24 Z', '#fff', 0.45);
};

const milk: Painter = (p) => {
  p.shape('M22 4 H42 V14 L50 24 V56 C50 59 48 60 45 60 H19 C16 60 14 59 14 56 V24 L22 14 Z', p.lin(['#ffffff', '#eef3f7', '#b8c6d4'], 0, 0.5, 1, 0.5));
  p.shape('M21 3 H43 V9 H21 Z', '#6aa8e0', 1.8);
  p.shape('M14 34 H50 V46 H14 Z', '#6aa8e0', 1.6);
  p.fill('M18 25 H22 V56 H18 Z', '#fff', 0.8);
};

const cheese: Painter = (p) => {
  p.shape('M6 42 L50 14 L58 26 V50 L14 56 Z', p.lin(['#fff2a0', '#f5c73a', '#c8901a'], 0, 0, 1, 1));
  p.shape('M6 42 L50 14 L58 26 L14 50 Z', p.lin(['#fff8c8', '#ffe070']));
  for (const [x, y, r] of [
    [28, 50, 3],
    [44, 44, 2.4],
    [52, 36, 2],
    [36, 34, 2.4],
  ])
    p.ellipse(x!, y!, r!, r! * 0.8, '#d9a830', false);
};

const bread: Painter = (p, color = '#d99a4a') => {
  p.shape('M6 42 C4 24 18 14 32 14 C46 14 60 24 58 42 C56 52 50 56 32 56 C14 56 8 52 6 42 Z', p.rad([tone(color, 1.35), color, tone(color, 0.55)], 0.4, 0.3, 0.85));
  for (const x of [20, 30, 40]) p.shape(`M${x - 3} ${26} C${x} ${22} ${x + 4} ${24} ${x + 5} ${28} C${x + 2} ${30} ${x - 1} ${30} ${x - 3} ${26} Z`, '#fff0c8', 1.4);
  p.glint(18, 22, 6, 2.5, -20, 0.45);
};

const dish: Painter = (p, color = '#e07a3a') => {
  p.ellipse(32, 44, 28, 12, p.lin(['#ffffff', '#dfe6ee', '#a8b4c2'], 0, 0, 0, 1));
  p.ellipse(32, 42, 20, 7.5, '#eef2f6', false);
  p.shape('M14 40 C14 28 22 22 32 22 C42 22 50 28 50 40 C44 46 20 46 14 40 Z', p.rad([tone(color, 1.4), color, tone(color, 0.55)], 0.4, 0.3, 0.8));
  p.circle(26, 32, 3, '#6aae45').circle(38, 30, 2.6, '#f5d04a').circle(33, 38, 2.4, '#c8453a');
  p.line('M24 16 C22 12 26 10 24 6 M32 16 C30 12 34 10 32 6 M40 16 C38 12 42 10 40 6', '#fff', 1.6, 0.55);
};

const mushroom: Painter = (p, color = '#c8573e') => {
  p.shape('M24 30 C22 42 22 52 20 58 H44 C42 52 42 42 40 30 Z', p.lin(['#fffaf0', '#efe2c8', '#c8b490'], 0, 0.5, 1, 0.5));
  p.shape('M4 32 C4 16 18 6 32 6 C46 6 60 16 60 32 C50 36 14 36 4 32 Z', p.rad([tone(color, 1.35), color, tone(color, 0.5)], 0.4, 0.3, 0.85));
  for (const [x, y, r] of [
    [20, 18, 3.5],
    [36, 14, 3],
    [46, 24, 3.2],
    [28, 26, 2.4],
  ])
    p.ellipse(x!, y!, r!, r! * 0.8, '#fff8e8', false, 0.95);
  p.glint(18, 12, 6, 2.5, -25, 0.4);
};

const berries: Painter = (p, color = '#5a4ac8') => {
  leaf(p, 'M30 14 C22 4 10 6 6 12 C14 18 24 18 30 14 Z', 'M28 14 C20 12 14 11 9 12');
  for (const [x, y, r] of [
    [22, 30, 10],
    [42, 28, 10],
    [32, 46, 11],
    [18, 48, 8],
    [46, 46, 8],
  ]) {
    p.circle(x!, y!, r!, p.rad([tone(color, 1.5), color, tone(color, 0.5)], 0.38, 0.32, 0.8));
    p.glint(x! - r! * 0.35, y! - r! * 0.35, r! * 0.3, r! * 0.18, -30, 0.8);
  }
  p.line('M30 14 C28 20 26 24 24 22 M30 14 C34 20 38 22 40 20', '#4f7a2a', 1.6);
};

const flower: Painter = (p, color = '#f07aa8') => {
  p.line('M32 36 C32 46 30 54 28 62', OL, 5.5).line('M32 36 C32 46 30 54 28 62', '#4f9a3a', 3);
  leaf(p, 'M30 50 C22 44 14 46 10 50 C16 56 24 56 30 50 Z', 'M28 50 C22 49 16 50 12 50');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    p.ellipse(32 + Math.cos(a) * 11, 24 + Math.sin(a) * 11, 9, 6.5, p.rad([tone(color, 1.5), color, tone(color, 0.6)], 0.3, 0.5, 0.9), true, 1, (a * 180) / Math.PI);
  }
  p.circle(32, 24, 6, p.rad(['#fff6b0', '#f5c542', '#c8901a']));
};

const herb: Painter = (p, color = '#6aae45') => {
  leaf(p, 'M32 60 C20 50 12 34 16 10 C28 20 36 38 32 60 Z', 'M30 56 C26 42 22 28 18 14', tone(color, 0.45), color, tone(color, 1.5));
  leaf(p, 'M34 60 C44 48 54 36 52 16 C42 24 34 40 34 60 Z', 'M35 56 C40 44 46 32 50 20', tone(color, 0.45), tone(color, 0.9), tone(color, 1.4));
};

const sack: Painter = (p, color = '#c8a060') => {
  p.shape('M18 22 C8 30 6 44 10 52 C14 60 50 60 54 52 C58 44 56 30 46 22 Z', p.rad([tone(color, 1.35), color, tone(color, 0.55)], 0.4, 0.35, 0.85));
  p.shape('M22 22 C20 14 24 8 28 12 C30 6 34 6 36 12 C40 8 44 14 42 22 Z', p.lin([tone(color, 1.3), tone(color, 0.8)]));
  p.shape('M18 22 H46 V26 H18 Z', '#8a5a2a', 1.6);
  p.glint(20, 34, 3, 7, 15, 0.4);
};

const letter: Painter = (p) => {
  p.shape('M6 16 H58 V52 H6 Z', p.lin(['#fffaf0', '#f3e2bc']));
  p.shape('M6 16 L32 38 L58 16', 'none', 2);
  p.circle(32, 38, 6, p.rad(['#ff8a6a', '#c8331e', '#7a1a0e']));
};

// ── Animal goods & mine drops (fallback art; other teams may override via registerItemIcon) ──

/** Stroke a thick outlined path (outline pass + colour pass) — for quills, twine, handles. */
function rope(p: Pen, d: string, fill: string, w = 4): void {
  p.raw(`<path d="${d}" fill="none" stroke="${OL}" stroke-width="${w + SW * 2}" stroke-linecap="round" stroke-linejoin="round"/>`);
  p.raw(`<path d="${d}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
}

const feather: Painter = (p, color = '#3a8a5a') => {
  rope(p, 'M20 50 L8 60', '#efe4c8', 3);
  p.shape('M52 5 C60 14 56 30 46 40 C38 48 28 52 18 52 C20 42 24 32 32 22 C38 14 46 8 52 5 Z', p.lin([tone(color, 1.55), color, '#2a4f9a'], 0.9, 0, 0.1, 1));
  // barb notches + sheen
  p.fill('M40 44 L34 50 L37 43 Z', '#fffaf0', 0.9).fill('M26 34 L20 38 L24 31 Z', '#fffaf0', 0.9);
  for (let i = 0; i < 6; i++) {
    const t = 0.15 + i * 0.13;
    const x = 50 - t * 32;
    const y = 9 + t * 42;
    p.line(`M${x} ${y} l${9 - i} ${-3 + i * 0.4}`, tone(color, 0.6), 1.1, 0.6);
    p.line(`M${x} ${y} l${-7 + i * 0.6} ${2 + i * 0.2}`, tone(color, 1.4), 1, 0.55);
  }
  p.line('M51 8 C44 22 32 38 19 51', '#fff8e0', 2.2, 0.95);
  p.fill('M44 14 C40 20 36 24 32 30 C38 22 42 18 44 14 Z', '#b8f0e0', 0.6);
  p.glint(46, 16, 3, 1.4, -50, 0.8);
};

const goatMilk: Painter = (p) => {
  rope(p, 'M46 24 C58 24 58 44 46 46', '#efe6d4', 4.5);
  p.shape('M20 12 H44 L45 20 C54 28 54 50 46 56 C41 59 23 59 18 56 C10 50 10 28 19 20 Z', p.lin(['#fffcf4', '#efe4cc', '#bba88a'], 0, 0.5, 1, 0.5));
  p.shape('M15 9 C22 6 42 6 49 10 L45 15 H19 Z', p.lin(['#ffffff', '#e8dcc4'], 0, 0, 0, 1), 1.8);
  p.ellipse(32, 11, 11, 2.2, '#ffffff', false);
  // twine collar + goat tag
  p.shape('M18 22 C26 25 38 25 46 22 L46 26 C38 29 26 29 18 26 Z', '#c89a5a', 1.4);
  p.shape('M24 33 H40 C42 33 43 34 43 36 V45 C43 47 42 48 40 48 H24 C22 48 21 47 21 45 V36 C21 34 22 33 24 33 Z', '#8fbf6a', 1.6);
  p.fill('M27 42 C27 37 37 37 37 42 C37 45 27 45 27 42 Z', '#fffaf0');
  p.line('M28 38 C26 35 25 35 24 36 M36 38 C38 35 39 35 40 36', '#fffaf0', 1.5);
  p.circle(30.5, 41.5, 0.9, OL, false).circle(33.5, 41.5, 0.9, OL, false);
  p.fill('M16 26 H20 V52 H16 Z', '#fff', 0.7);
  p.glint(23, 18, 3, 1.3, -10, 0.8);
};

const wool: Painter = (p) => {
  p.ellipse(32, 56, 22, 4, '#000', false, 0.14);
  p.shape('M12 40 C6 38 6 28 13 27 C12 19 21 15 26 19 C29 12 39 12 41 19 C48 15 57 21 53 28 C60 30 59 41 52 42 C52 50 42 53 37 48 C33 54 23 53 21 47 C14 50 8 45 12 40 Z', p.rad(['#ffffff', '#f5eedc', '#cdbd9c'], 0.4, 0.35, 0.8));
  for (const d of ['M19 31 c2 -3 6 -3 7 0', 'M33 25 c2 -3 6 -3 7 0', 'M36 37 c2 -3 6 -3 7 0', 'M22 41 c2 -3 6 -3 7 0', 'M44 30 c1.5 -2 4 -2 5 0']) p.line(d, '#c8b48c', 1.8, 0.9);
  p.glint(24, 23, 5, 2.6, -20, 0.9);
};

const truffle: Painter = (p) => {
  p.ellipse(32, 56, 19, 3.6, '#000', false, 0.2);
  p.shape('M14 36 C10 24 20 12 32 13 C46 12 56 24 51 38 C48 50 40 55 31 55 C21 55 16 48 14 36 Z', p.rad(['#8a6a56', '#4a3228', '#1e140f'], 0.38, 0.32, 0.8));
  for (const [x, y, r] of [
    [22, 27, 2.6],
    [30, 21, 2.1],
    [40, 25, 2.7],
    [26, 37, 2.3],
    [36, 35, 2.9],
    [45, 39, 2.1],
    [31, 46, 2.2],
    [20, 44, 1.8],
  ])
    p.circle(x!, y!, r!, '#6a4c3c', false, 0.95).circle(x! - r! * 0.3, y! - r! * 0.3, r! * 0.4, '#a0806a', false, 0.7);
  p.glint(25, 21, 4.6, 2.2, -25, 0.35);
  rope(p, 'M44 13 C46 9 50 9 52 11', '#5a8a3a', 1.6);
  leaf(p, 'M50 12 C54 6 60 6 62 9 C58 13 54 14 50 12 Z', 'M51 12 C55 10 58 9 61 9');
};

const hay: Painter = (p) => {
  p.ellipse(32, 58, 26, 3.6, '#000', false, 0.16);
  // 3/4 bale: front face, top face, end face
  p.shape('M6 30 L40 30 L40 56 L6 56 Z', p.lin(['#f4d47a', '#e0b04a', '#b8862a'], 0, 0, 0, 1));
  p.shape('M40 30 L58 20 L58 46 L40 56 Z', p.lin(['#d8a842', '#b08028'], 0, 0, 1, 0));
  p.shape('M6 30 L24 20 L58 20 L40 30 Z', p.lin(['#fff0b8', '#f0cc6a'], 0, 0, 0, 1));
  // straw texture
  for (let i = 0; i < 8; i++) p.line(`M${9 + i * 4} ${34 + (i % 3) * 2} v${14 - (i % 2) * 4}`, '#a87a24', 1, 0.55);
  for (let i = 0; i < 6; i++) p.line(`M${14 + i * 6.5} ${23 + (i % 2) * 2} l6 -1.2`, '#c8942e', 1, 0.6);
  for (let i = 0; i < 4; i++) p.line(`M${44 + i * 4} ${30 - i * 2} v14`, '#8a6418', 1, 0.5);
  // twine
  p.line('M16 30 L16 56 M30 30 L30 56 M16 30 L34 20 M30 30 L48 20', '#b83a2a', 2.2);
  // loose straws
  p.line('M6 36 L1 33 M6 48 L2 50 M58 28 L63 25 M40 56 L43 61 M22 20 L20 15 M50 20 L53 15', '#e8c060', 1.7);
  p.glint(20, 25, 5, 1.4, -28, 0.7);
};

const frostShard: Painter = (p, color = '#9fd8ff') => {
  const crystal = (d: string, k: number): void => {
    p.shape(d, p.lin(['#ffffff', tone(color, k), tone(color, 0.55 * k)], 0.2, 0, 0.8, 1));
  };
  p.ellipse(32, 57, 20, 3.4, '#1a3a5a', false, 0.18);
  crystal('M14 56 L10 34 L18 24 L24 40 L22 56 Z', 0.95);
  crystal('M40 56 L44 30 L52 22 L56 38 L50 56 Z', 0.9);
  crystal('M22 56 L24 22 L32 4 L40 22 L42 56 Z', 1.05);
  p.fill('M32 6 L26 22 L28 54 L32 54 Z', '#fff', 0.55);
  p.line('M32 6 L32 54 M24 22 L40 22', '#ffffff', 1, 0.7);
  p.fill('M18 26 L15 34 L20 40 Z', '#fff', 0.5).fill('M52 24 L47 32 L52 36 Z', '#fff', 0.5);
  p.raw('<path d="M50 6 l1.4 3.6 l3.6 1.4 l-3.6 1.4 l-1.4 3.6 l-1.4 -3.6 l-3.6 -1.4 l3.6 -1.4 Z" fill="#fff"/><path d="M10 14 l1 2.4 l2.4 1 l-2.4 1 l-1 2.4 l-1 -2.4 l-2.4 -1 l2.4 -1 Z" fill="#fff" opacity=".85"/>');
};

const slimeGel: Painter = (p, color = '#7ed957') => {
  p.ellipse(32, 56, 22, 4, '#1a3a10', false, 0.18);
  p.shape('M8 48 C6 34 16 14 32 10 C48 14 58 34 56 48 C55 55 46 58 32 58 C18 58 9 55 8 48 Z', p.rad([tone(color, 1.55), color, tone(color, 0.5)], 0.38, 0.3, 0.85));
  p.fill('M12 50 C18 54 46 54 52 50 C50 56 42 57 32 57 C22 57 14 56 12 50 Z', tone(color, 0.55), 0.6);
  p.circle(40, 38, 4, tone(color, 1.35), false, 0.8).circle(24, 44, 2.6, tone(color, 1.35), false, 0.8).circle(30, 30, 1.8, tone(color, 1.4), false, 0.8);
  p.glint(22, 24, 6, 3, -35, 0.85).glint(44, 22, 2, 1.2, 30, 0.7);
};

// ── Distinct gems, ores, eggs (each its own silhouette, not a recolour) ─────

const shadow = (p: Pen, rx = 20, cy = 57): void => {
  p.ellipse(32, cy, rx, 3.6, '#000', false, 0.18);
};
const sparkle = (p: Pen, x: number, y: number, s = 1): void => {
  p.raw(`<path d="M${x} ${y - 5 * s} l${1.4 * s} ${3.6 * s} l${3.6 * s} ${1.4 * s} l${-3.6 * s} ${1.4 * s} l${-1.4 * s} ${3.6 * s} l${-1.4 * s} ${-3.6 * s} l${-3.6 * s} ${-1.4 * s} l${3.6 * s} ${-1.4 * s} Z" fill="#fff"/>`);
};

/** A hexagonal crystal column (3 visible faces + pointed termination), base centre (x, y), leaning `rot`°. */
function prism(p: Pen, x: number, y: number, w: number, h: number, rot: number, faces: [string, string, string]): void {
  const t = y - h;
  const tip = t - w * 0.72;
  const a = x - w / 2;
  const b = x - w * 0.1;
  const c = x + w * 0.24;
  const d = x + w / 2;
  p.raw(`<g transform="rotate(${rot} ${x} ${y})">`);
  p.shape(`M${a} ${y} L${a} ${t} L${x} ${tip} L${d} ${t} L${d} ${y} Z`, faces[1], 2.6);
  p.fill(`M${a} ${y} L${a} ${t} L${x} ${tip} L${b} ${t + w * 0.06} L${b} ${y} Z`, faces[2], 0.95);
  p.fill(`M${b} ${y} L${b} ${t + w * 0.06} L${x} ${tip} L${c} ${t - w * 0.02} L${c} ${y} Z`, faces[0], 0.95);
  p.line(`M${b} ${y - 1} L${b} ${t + w * 0.06} L${x} ${tip} M${c} ${y - 1} L${c} ${t - w * 0.02} L${x} ${tip}`, '#8a84b0', 0.9, 0.6);
  p.line(`M${b + 1.6} ${y - 3} L${b + 1.6} ${t + 2}`, '#fff', 1.6, 0.9);
  p.shape(`M${a} ${y} L${a} ${t} L${x} ${tip} L${d} ${t} L${d} ${y}`, 'none', 2.6);
  p.raw('</g>');
}

const quartz: Painter = (p) => {
  shadow(p, 22);
  const f: [string, string, string] = ['#ffffff', '#e2def4', '#aaa2cc'];
  prism(p, 20, 52, 11, 18, -24, f);
  prism(p, 44, 52, 10, 16, 22, f);
  prism(p, 32, 54, 14, 28, -4, f);
  pebble(p, 'M10 52 C10 46 18 44 24 46 C30 43 38 43 42 46 C48 44 56 46 55 52 C54 57 44 58 32 58 C20 58 11 57 10 52 Z', '#9a948c');
  sparkle(p, 52, 12, 0.9);
};

const diamond: Painter = (p) => {
  shadow(p, 18);
  const body = 'M8 24 L19 11 H45 L56 24 L32 57 Z';
  p.shape(body, p.lin(['#ffffff', '#dff6ff', '#9ccde8'], 0.2, 0, 0.8, 1), 2.6);
  p.fill('M19 11 L26 24 H38 L45 11 Z', '#ffffff', 0.9);
  p.fill('M8 24 L19 11 L26 24 Z', '#c4ecff', 0.9).fill('M56 24 L45 11 L38 24 Z', '#94cbe8', 0.9);
  p.fill('M8 24 H20 L32 57 Z', '#b0dcf2', 0.9).fill('M20 24 H32 L32 57 Z', '#eafaff', 0.95).fill('M32 24 H44 L32 57 Z', '#7cb8dc', 0.95).fill('M44 24 H56 L32 57 Z', '#bfe6f8', 0.9);
  p.fill('M24 28 L28 28 L30 40 Z', '#ffb0d8', 0.7).fill('M38 27 L41 27 L35 42 Z', '#fff2a0', 0.75).fill('M13 26 L18 26 L24 34 Z', '#a0ffe0', 0.6);
  p.line('M8 24 H56 M19 11 L26 24 L32 11 L38 24 L45 11 M20 24 L32 57 L44 24 M32 24 V57', '#3b6a8a', 1, 0.55);
  p.shape(body, 'none', 2.6);
  p.glint(24, 15, 3.4, 1.6, -10, 0.95);
  sparkle(p, 52, 8, 1.1);
  sparkle(p, 11, 44, 0.6);
};

const amethyst: Painter = (p) => {
  shadow(p, 22);
  // Split geode: rough shell, pale inner band, violet crystals pointing into a dark heart.
  p.shape('M8 36 C6 20 18 8 32 8 C48 8 58 20 57 36 C56 50 46 58 32 58 C18 58 9 50 8 36 Z', p.rad(['#b8a894', '#8a7a66', '#5a4c3e'], 0.35, 0.3, 0.9), 2.6);
  p.line('M12 26 L16 28 M50 18 L46 22 M52 44 L48 42 M20 52 L22 48', '#4a3c2e', 1.3, 0.7);
  p.ellipse(32, 34, 19, 18, '#efe6f4', true, 1);
  p.ellipse(32, 34, 16, 15, p.rad(['#f6e8ff', '#b070ff', '#5a2a9a'], 0.5, 0.5, 0.7), false);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    const ox = 32 + Math.cos(a) * 15;
    const oy = 34 + Math.sin(a) * 14;
    const ix = 32 + Math.cos(a) * 6.5;
    const iy = 34 + Math.sin(a) * 6;
    const px = Math.cos(a + Math.PI / 2) * 3.4;
    const py = Math.sin(a + Math.PI / 2) * 3.4;
    p.raw(`<path d="M${(ox + px).toFixed(1)} ${(oy + py).toFixed(1)} L${ix.toFixed(1)} ${iy.toFixed(1)} L${(ox - px).toFixed(1)} ${(oy - py).toFixed(1)} Z" fill="${i % 2 ? '#c890ff' : '#9a52e8'}" stroke="#4a1e7a" stroke-width=".8"/>`);
    p.line(`M${ox.toFixed(1)} ${oy.toFixed(1)} L${ix.toFixed(1)} ${iy.toFixed(1)}`, '#f4e0ff', 0.8, 0.7);
  }
  p.ellipse(32, 34, 5.5, 5, '#2a0e4a', false);
  p.glint(26, 28, 2.4, 1.2, -30, 0.9);
  sparkle(p, 52, 12, 0.8);
};

const ruby: Painter = (p) => {
  shadow(p, 18, 56);
  // Oval cabochon in a thin gold bezel.
  p.ellipse(32, 36, 23, 18, p.lin(['#fff2b0', '#e0a830', '#8a5a0a'], 0, 0, 0, 1), true);
  p.ellipse(32, 35, 19, 14.5, p.rad(['#ff9aa8', '#ff2a48', '#8a0a22', '#4a0414'], 0.4, 0.3, 0.85), true);
  p.fill('M16 38 C18 46 26 50 32 50 C40 50 47 46 49 38 C46 44 40 47 32 47 C24 47 18 44 16 38 Z', '#4a0414', 0.45);
  p.ellipse(38, 41, 7, 3, '#ff7a8a', false, 0.5, -15);
  p.raw('<path d="M18 30 C20 24 26 21 32 21" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".85"/>');
  p.glint(24, 26, 2, 1.2, -30, 0.95);
  sparkle(p, 52, 16, 0.9);
};

const topaz: Painter = (p) => {
  shadow(p, 20);
  p.raw('<g transform="rotate(-12 32 34)">');
  // Emerald (step) cut: octagon with concentric step facets.
  p.shape('M18 14 H46 L54 22 V46 L46 54 H18 L10 46 V22 Z', p.lin(['#fff0c0', '#ffb030', '#b86a08'], 0.2, 0, 0.8, 1), 2.6);
  p.fill('M21 19 H43 L49 25 V43 L43 49 H21 L15 43 V25 Z', '#ffc050', 0.95);
  p.fill('M24 24 H40 L44 28 V40 L40 44 H24 L20 40 V28 Z', '#ffd47a', 0.95);
  p.fill('M27 29 H37 V39 H27 Z', '#ffeab8', 0.95);
  p.line('M18 14 L21 19 L24 24 L27 29 M46 14 L43 19 L40 24 L37 29 M46 54 L43 49 L40 44 L37 39 M18 54 L21 49 L24 44 L27 39', '#9a5a08', 0.9, 0.6);
  p.fill('M10 22 L15 25 V43 L10 46 Z', '#c87a10', 0.7).fill('M54 22 L49 25 V43 L54 46 Z', '#ffd070', 0.6).fill('M18 54 L21 49 H43 L46 54 Z', '#b86a08', 0.55);
  p.glint(25, 20, 5, 1.4, 0, 0.85);
  p.raw('</g>');
  sparkle(p, 53, 10, 0.9);
};

const aquamarine: Painter = (p) => {
  shadow(p, 16);
  // Pear (teardrop) cut: rounded bottom, pointed crown, facets radiating from the table.
  const drop = 'M32 5 C40 16 52 28 52 40 C52 51 43 58 32 58 C21 58 12 51 12 40 C12 28 24 16 32 5 Z';
  p.shape(drop, p.lin(['#e8ffff', '#40e0e8', '#0a7a94'], 0.3, 0, 0.7, 1), 2.6);
  p.fill('M32 20 L42 34 L38 48 H26 L22 34 Z', '#9af4f8', 0.75);
  p.fill('M32 20 L42 34 L32 40 L22 34 Z', '#d8ffff', 0.8);
  p.line('M32 5 L32 20 M12 40 L22 34 M52 40 L42 34 M22 57 L26 48 M42 57 L38 48 M32 40 L26 48 M32 40 L38 48 M18 22 L22 34 M46 22 L42 34', '#0a5a70', 0.9, 0.55);
  p.fill('M12 40 C12 51 21 58 32 58 L26 48 L22 34 Z', '#0a6a84', 0.35);
  p.glint(25, 26, 2.2, 5, 25, 0.85);
  sparkle(p, 52, 12, 0.9);
};

const emberOpal: Painter = (p) => {
  shadow(p, 20);
  p.shape('M10 38 C8 24 20 12 34 12 C48 13 57 24 55 38 C53 50 43 57 31 57 C19 57 11 50 10 38 Z', p.rad(['#5a2a1a', '#2e1410', '#140806'], 0.4, 0.35, 0.8), 2.6);
  // Play-of-colour: fire patches glowing inside the stone.
  const fire: [number, number, number, number, string][] = [
    [24, 30, 7, 5, '#ff7a1a'],
    [38, 26, 6, 4, '#ffcf40'],
    [42, 40, 7, 5, '#ff3a2a'],
    [26, 44, 6, 4, '#ffa030'],
    [33, 36, 5, 3.6, '#fff0a0'],
    [18, 38, 3.6, 2.6, '#40e0b0'],
    [46, 30, 3, 2.2, '#60c0ff'],
  ];
  for (const [x, y, rx, ry, c] of fire) {
    p.ellipse(x, y, rx * 1.5, ry * 1.5, c, false, 0.28, ((x * 7) % 40) - 20);
    p.ellipse(x, y, rx, ry, c, false, 0.85, ((x * 7) % 40) - 20);
  }
  p.raw('<path d="M30 40 C28 34 34 32 32 26 C38 30 38 36 34 40 C33 42 31 42 30 40 Z" fill="#fff4b0" opacity=".85"/>');
  p.glint(24, 20, 5, 2, -25, 0.55);
  sparkle(p, 52, 12, 0.8);
};

function oreRock(p: Pen, d: string, base: string): void {
  p.shape(d, p.rad([tone(base, 1.3), base, tone(base, 0.55)], 0.35, 0.3, 0.85), 2.6);
}

const copperOre: Painter = (p) => {
  shadow(p, 23);
  oreRock(p, 'M6 44 C4 32 12 22 22 20 C26 12 40 10 48 18 C58 22 62 34 56 44 C52 54 40 58 28 57 C16 57 8 52 6 44 Z', '#7a6a5c');
  // verdigris bloom
  p.fill('M12 42 C12 36 18 34 22 38 C24 44 18 48 12 42 Z', '#4ab89a', 0.85).fill('M44 46 C46 42 52 42 52 46 C50 50 46 50 44 46 Z', '#5ac8a8', 0.8).fill('M36 16 C40 14 44 16 42 20 C38 22 35 19 36 16 Z', '#4ab89a', 0.75);
  // copper veins (metallic, thick)
  for (const d of ['M16 30 C24 28 28 34 36 32 C42 30 46 34 52 32', 'M22 46 C28 42 34 46 40 42', 'M30 22 C32 26 30 30 32 34']) {
    p.raw(`<path d="${d}" fill="none" stroke="${OL}" stroke-width="7" stroke-linecap="round"/>`);
    p.raw(`<path d="${d}" fill="none" stroke="#e07a3a" stroke-width="4.2" stroke-linecap="round"/>`);
    p.raw(`<path d="${d}" fill="none" stroke="#ffc08a" stroke-width="1.4" stroke-linecap="round" transform="translate(-.6 -1)"/>`);
  }
  p.glint(22, 26, 3, 1.3, -25, 0.6);
};

const ironOre: Painter = (p) => {
  shadow(p, 22);
  // angular, blocky
  oreRock(p, 'M6 46 L10 26 L24 14 L42 12 L56 24 L58 42 L48 56 L20 58 Z', '#5a6070');
  p.fill('M24 14 L42 12 L56 24 L36 28 Z', '#8a90a0', 0.6).fill('M6 46 L10 26 L20 36 L20 58 Z', '#3a3e4a', 0.5);
  p.line('M24 14 L36 28 L56 24 M36 28 L34 56 M20 36 L36 28', '#2e3240', 1.3, 0.7);
  // rust streaks bleeding downward
  p.fill('M40 30 C42 36 40 44 43 52 C39 46 38 38 37 31 Z', '#c0602a', 0.9).fill('M14 38 C16 42 15 48 17 54 C13 50 12 44 12 39 Z', '#b0501e', 0.85).fill('M28 20 C31 22 32 26 30 30 C28 26 27 23 28 20 Z', '#d0703a', 0.75);
  // silver flecks
  for (const [x, y, s] of [
    [30, 40, 3.4],
    [46, 38, 2.6],
    [22, 26, 2.4],
    [48, 20, 2],
  ] as [number, number, number][])
    p.raw(`<path d="M${x} ${y - s} L${x + s} ${y} L${x} ${y + s} L${x - s} ${y} Z" fill="#e8ecf4" stroke="${OL}" stroke-width="1"/>`);
};

const goldOre: Painter = (p) => {
  shadow(p, 22);
  oreRock(p, 'M8 44 C6 32 16 22 28 22 C36 16 50 20 54 30 C60 38 56 52 44 55 C34 58 18 58 8 44 Z', '#a89478');
  for (const [x, y, r] of [
    [24, 34, 7.5],
    [40, 30, 6],
    [42, 46, 5.5],
    [22, 48, 4.2],
    [33, 42, 3.6],
  ] as [number, number, number][]) {
    p.raw(
      `<path d="M${x - r} ${y} C${x - r} ${y - r * 0.9} ${x - r * 0.2} ${y - r * 1.1} ${x + r * 0.4} ${y - r} C${x + r} ${y - r * 0.8} ${x + r * 1.1} ${y + r * 0.3} ${x + r * 0.6} ${y + r * 0.8} C${x} ${y + r * 1.1} ${x - r} ${y + r * 0.8} ${x - r} ${y} Z" fill="${p.rad(['#fffac0', '#ffd040', '#b07808'], 0.35, 0.3, 0.8)}" stroke="${OL}" stroke-width="1.8"/>`,
    );
    p.glint(x - r * 0.3, y - r * 0.4, r * 0.35, r * 0.2, -30, 0.95);
  }
  sparkle(p, 52, 14, 0.8);
};

const eggShape = (cx: number, cy: number, w: number, h: number): string =>
  `M${cx} ${cy - h} C${cx + w * 0.8} ${cy - h} ${cx + w} ${cy - h * 0.1} ${cx + w} ${cy + h * 0.25} C${cx + w} ${cy + h * 0.75} ${cx + w * 0.55} ${cy + h} ${cx} ${cy + h} C${cx - w * 0.55} ${cy + h} ${cx - w} ${cy + h * 0.75} ${cx - w} ${cy + h * 0.25} C${cx - w} ${cy - h * 0.1} ${cx - w * 0.8} ${cy - h} ${cx} ${cy - h} Z`;

/** Hen's egg standing in a little straw nest. */
const egg: Painter = (p, color = '#f7efe0') => {
  shadow(p, 24, 58);
  p.shape('M6 44 C6 38 12 36 32 36 C52 36 58 38 58 44 C58 54 46 58 32 58 C18 58 6 54 6 44 Z', p.lin(['#f4d47a', '#d8a848', '#9a6a20'], 0, 0, 0, 1), 2.4);
  p.shape(eggShape(32, 28, 15, 20), p.rad([tone(color, 1.25), color, tone(color, 0.72)], 0.38, 0.3, 0.9), 2.6);
  p.glint(26, 18, 3.4, 6, 20, 0.75);
  p.fill('M6 44 C12 40 22 42 32 42 C42 42 52 40 58 44 C54 50 44 52 32 52 C20 52 10 50 6 44 Z', '#e8c060', 1);
  for (let i = 0; i < 9; i++) p.line(`M${9 + i * 5.4} ${45 + (i % 2) * 2} l${4 + (i % 3)} ${-2 + (i % 2) * 3}`, '#9a6a20', 1.2, 0.8);
  p.line('M8 44 C18 40 46 40 56 44', OL, 1.6, 0.8);
  p.line('M4 42 L10 44 M60 42 L54 45', '#e8c464', 1.8);
};

/** A pair of speckled brown eggs, one lying against the other. */
const brownEgg: Painter = (p) => {
  shadow(p, 24);
  const c = '#d89a62';
  p.raw('<g transform="rotate(-62 42 44)">');
  p.shape(eggShape(42, 44, 11, 15), p.rad([tone(c, 1.3), c, tone(c, 0.6)], 0.38, 0.3, 0.9), 2.6);
  p.raw('</g>');
  p.shape(eggShape(26, 34, 14, 19), p.rad([tone(c, 1.35), c, tone(c, 0.6)], 0.38, 0.3, 0.9), 2.6);
  for (const [x, y, r] of [
    [22, 30, 1.2],
    [30, 26, 0.9],
    [32, 38, 1.3],
    [20, 42, 1],
    [27, 46, 1.2],
    [34, 30, 0.8],
    [46, 46, 1],
    [52, 42, 0.8],
    [44, 52, 0.9],
  ] as [number, number, number][])
    p.circle(x, y, r, '#8a4a1e', false, 0.75);
  p.glint(20, 24, 3, 6, 20, 0.7);
};

/** A large sea-green duck egg, tilted, with a tiny feather tucked beside it. */
const duckEgg: Painter = (p) => {
  shadow(p, 22);
  rope(p, 'M50 54 C52 46 56 40 60 36', '#f4f0e0', 1.4);
  p.shape('M48 54 C44 46 48 36 58 32 C58 40 56 48 48 54 Z', p.lin(['#8ae0b0', '#2e8a5e'], 0, 0, 1, 1), 1.8);
  p.raw('<g transform="rotate(18 30 34)">');
  p.shape(eggShape(30, 34, 17, 23), p.rad(['#f4fff8', '#bfe6d2', '#7aac96'], 0.38, 0.3, 0.9), 2.6);
  p.raw('</g>');
  for (const [x, y] of [
    [26, 30],
    [36, 40],
    [30, 46],
    [38, 26],
  ] as [number, number][])
    p.circle(x, y, 0.9, '#5a8a78', false, 0.6);
  p.glint(22, 22, 3.4, 7, 30, 0.75);
};

// ── Sprinkler tiers: basic → brass → gilded get physically bigger, with more nozzles ──

function spray(p: Pen, d: string, o = 1): void {
  p.line(d, '#2f7fb8', 4.2, 0.45 * o);
  p.line(d, '#9ee0ff', 2.4, 0.95 * o);
}

const sprinkler: Painter = (p) => {
  p.ellipse(32, 56, 14, 4.5, p.rad(['#9aa3ad', '#5d6670'], 0.5, 0.3, 0.8));
  p.shape('M29 55 V32 H35 V55 Z', p.lin(['#e8eef4', '#aab4be', '#6d7784'], 0, 0.5, 1, 0.5), 2.4);
  p.fill('M30.2 33 H32 V54 H30.2 Z', '#fff', 0.6);
  p.shape('M25 32 C25 26 39 26 39 32 C39 35 25 35 25 32 Z', p.lin(['#f4f8fc', '#aab4be', '#6d7784']), 2.4);
  p.circle(32, 26, 4, p.rad(['#ffffff', '#aab4be', '#6d7784']));
  spray(p, 'M29 24 C23 17 16 19 12 26');
  spray(p, 'M35 24 C41 17 48 19 52 26');
  spray(p, 'M32 21 C32 17 32 14 32 10', 0.9);
  p.circle(12, 30, 2, '#9ee0ff', false).circle(52, 30, 2, '#9ee0ff', false);
};

const brassSprinkler: Painter = (p) => {
  p.ellipse(32, 55, 22, 6, p.rad(['#b0a090', '#6a5a4a'], 0.5, 0.3, 0.8));
  p.shape('M14 54 C14 49 22 47 32 47 C42 47 50 49 50 54 C50 57 14 57 14 54 Z', p.lin(['#ffc27a', '#d97a3a', '#8a3e14'], 0, 0, 0, 1), 2.4);
  for (const x of [19, 32, 45]) p.circle(x, 52.5, 1.4, '#ffe0b0', false);
  p.shape('M27 48 V26 H37 V48 Z', p.lin(['#ffc27a', '#d97a3a', '#8a3e14'], 0, 0.5, 1, 0.5), 2.4);
  p.shape('M25 40 H39 V44 H25 Z', p.lin(['#ffe0b0', '#b0602a'], 0, 0, 0, 1), 1.8);
  // T-bar rotor with a nozzle at each end
  p.shape('M10 22 H54 V28 H10 Z', p.lin(['#ffd0a0', '#d97a3a', '#8a3e14'], 0, 0, 0, 1), 2.4);
  p.shape('M6 20 H14 V30 H6 Z', '#5a5a60', 2).shape('M50 20 H58 V30 H50 Z', '#5a5a60', 2);
  p.circle(32, 21, 5.4, p.rad(['#fff0d0', '#d97a3a', '#8a3e14']));
  spray(p, 'M8 19 C6 12 8 8 12 4');
  spray(p, 'M56 19 C58 12 56 8 52 4');
  spray(p, 'M6 26 C2 30 2 36 4 40', 0.85);
  spray(p, 'M58 26 C62 30 62 36 60 40', 0.85);
  p.circle(12, 4, 1.8, '#9ee0ff', false).circle(52, 4, 1.8, '#9ee0ff', false).circle(4, 44, 1.8, '#9ee0ff', false).circle(60, 44, 1.8, '#9ee0ff', false);
};

const goldSprinkler: Painter = (p) => {
  // Full ring of spray behind: it waters the whole patch.
  p.raw('<ellipse cx="32" cy="44" rx="30" ry="14" fill="#9ee0ff" opacity=".2"/><ellipse cx="32" cy="44" rx="30" ry="14" fill="none" stroke="#6ac8f0" stroke-width="2.2" stroke-dasharray="3 4" opacity=".95"/>');
  p.ellipse(32, 57, 20, 5, p.rad(['#b0a080', '#6a5a3a'], 0.5, 0.3, 0.8));
  p.shape('M14 56 C14 50 22 48 32 48 C42 48 50 50 50 56 C50 59 14 59 14 56 Z', p.lin(['#fff2a0', '#f2c230', '#9a6a08'], 0, 0, 0, 1), 2.4);
  p.shape('M20 49 C20 45 26 43 32 43 C38 43 44 45 44 49 Z', p.lin(['#fff6c0', '#f2c230', '#9a6a08'], 0, 0, 0, 1), 2.2);
  p.shape('M28 44 V24 H36 V44 Z', p.lin(['#fff2a0', '#f2c230', '#9a6a08'], 0, 0.5, 1, 0.5), 2.4);
  p.fill('M29.5 25 H31.5 V43 H29.5 Z', '#fff', 0.6);
  // four-arm rotor (two arms foreshortened)
  p.shape('M8 22 H56 V27 H8 Z', p.lin(['#fff6c0', '#e0a820', '#8a5a08'], 0, 0, 0, 1), 2.4);
  p.shape('M26 15 H38 V33 H26 Z', p.lin(['#fff6c0', '#e0a820', '#8a5a08'], 0, 0.5, 1, 0.5), 2.2);
  for (const [x, y] of [
    [8, 24.5],
    [56, 24.5],
    [32, 15],
  ] as [number, number][])
    p.circle(x, y, 3.4, '#5a5a60');
  p.circle(32, 24.5, 6, p.rad(['#fffae0', '#f2c230', '#9a6a08']));
  p.shape('M32 4 L36.5 9.5 L32 15 L27.5 9.5 Z', p.lin(['#e8ffff', '#5fe0e8', '#1a8a94']), 1.8);
  p.glint(31, 7.5, 1.2, 2, -20, 0.9);
  spray(p, 'M6 21 C3 14 5 9 9 6');
  spray(p, 'M58 21 C61 14 59 9 55 6');
  spray(p, 'M6 28 C1 32 1 38 3 42', 0.85);
  spray(p, 'M58 28 C63 32 63 38 61 42', 0.85);
  sparkle(p, 47, 8, 0.8);
};

// ── Tools: chunky silhouettes (fat handles, filled heads, 2.8 px ink) that read at 32 px ──

const TSW = 2.8;

const hoe: Painter = (p) => {
  handle(p, 10, 58, 40, 16, 9);
  p.shape('M34 18 L40 8 L50 10 L46 20 Z', p.lin(['#8a8f96', '#5a5f66'], 0, 0, 1, 1), TSW);
  p.shape('M44 8 C50 6 58 8 60 12 L58 30 C57 33 53 33 52 30 L50 16 C48 14 46 14 44 14 Z', p.lin(STEEL, 0, 0, 1, 1), TSW);
  p.fill('M47 9.5 C51 8.5 56 9.5 58 12 L57 18 C55 15 51 13 47 13 Z', '#fff', 0.75);
  p.line('M52.5 30 L57.5 30', '#4a525c', 1.4, 0.8);
  p.circle(41, 12.5, 2.3, '#c9a24a');
};

const axe: Painter = (p) => {
  handle(p, 12, 58, 40, 12, 9);
  p.shape('M30 8 C36 2 50 2 56 8 C62 16 62 30 54 36 C50 28 42 22 32 22 Z', p.lin(STEEL, 0.2, 0, 0.8, 1), TSW);
  p.fill('M36 8 C41 5 49 5 53 9 C56 13 57 18 56 24 C51 16 44 12 37 12 Z', '#fff', 0.6);
  p.line('M54 10 C59 17 59 26 54 33', '#fff', 2, 0.95);
  p.shape('M28 10 L42 16 L38 26 L24 20 Z', p.lin(['#6a7078', '#40454c'], 0, 0, 1, 1), TSW);
  p.circle(33, 18, 1.8, '#c9a24a', false);
};

const pickaxe: Painter = (p) => {
  handle(p, 14, 58, 38, 18, 9);
  p.shape('M3 26 C12 8 44 2 62 14 L58 22 C44 13 22 14 9 30 Z', p.lin(STEEL, 0.3, 0, 0.6, 1), TSW);
  p.fill('M8 22 C18 11 40 7 56 14 L55 16 C40 10 22 13 10 25 Z', '#fff', 0.75);
  p.shape('M31 9 L44 10 L42 22 L30 21 Z', p.lin(['#8a5a2c', '#5a3818'], 0, 0, 1, 1), TSW);
  p.circle(37, 15.5, 2.2, '#c9a24a', false);
  p.line('M5 27 L9 30 M61 15 L58 21', '#4a525c', 1.6, 0.9);
};

const scythe: Painter = (p) => {
  handle(p, 18, 60, 30, 10, 8);
  p.shape('M27 8 C40 0 58 2 63 16 C61 24 58 29 54 33 C53 24 46 16 29 17 Z', p.lin(STEEL, 0.1, 0, 0.9, 1), TSW);
  p.fill('M32 9 C43 4 55 6 60 15 C53 10 44 8 34 12 Z', '#fff', 0.8);
  p.line('M30 15 C46 14 54 21 55 31', '#5f6a76', 1.4, 0.9);
  p.shape('M18 40 L30 43 L29 49 L17 46 Z', p.lin(['#b07a4a', '#6a4424'], 0, 0, 1, 1), TSW);
  p.circle(28.5, 12, 2.4, '#c9a24a');
};

const fishingRod: Painter = (p) => {
  p.raw(`<path d="M10 58 L54 8" stroke="${OL}" stroke-width="9" stroke-linecap="round"/><path d="M10 58 L54 8" stroke="#d99a52" stroke-width="4.4" stroke-linecap="round"/>`);
  for (const t of [0.4, 0.58, 0.76]) p.line(`M${10 + 44 * t - 2.4} ${58 - 50 * t - 2} l4.8 4`, OL, 2, 1);
  p.raw(`<path d="M10 58 L22 44" stroke="${OL}" stroke-width="13" stroke-linecap="round"/><path d="M10 58 L22 44" stroke="#6a4226" stroke-width="8" stroke-linecap="round"/>`);
  p.circle(22, 50, 7, p.rad(['#ffffff', '#b8c2cc', '#6d7784']));
  p.circle(22, 50, 2.4, '#4a525c', false);
  p.line('M22 50 L27 46', OL, 2.2, 1);
  p.line('M54 8 C59 20 59 34 52 46', '#f4f0e6', 1.4, 0.95);
  p.shape('M49 47 C51 44 55 45 55 48 C55 52 50 53 49 50', 'none', 2);
  p.circle(52, 44, 3.6, p.rad(['#ffb0a0', '#e8574a', '#8a2a1a']));
};


// ── r2: distinct art for items critics flagged as near-duplicates ─────────────

/** Loose hay: a tied sheaf of straw with a flared, tufty top (the bale stays a crafting-recipe picture). */
const hayTuft: Painter = (p) => {
  p.ellipse(32, 58, 22, 3.6, '#000', false, 0.16);
  const straw = (d: string, c: string): void => {
    p.raw(`<path d="${d}" fill="none" stroke="${OL}" stroke-width="5.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`);
  };
  // back fan
  for (const [x, c] of [
    [8, '#d8a842'],
    [16, '#e8bc52'],
    [48, '#e0b04a'],
    [56, '#c8942e'],
  ] as const)
    straw(`M32 40 Q${(32 + x) / 2} ${22} ${x} ${x < 32 ? 8 : 10}`, c);
  // body of the sheaf
  p.shape('M22 36 C22 30 42 30 42 36 L40 56 C40 59 24 59 24 56 Z', p.lin(['#fff0b0', '#f0c860', '#c8942e'], 0, 0, 1, 0));
  for (let i = 0; i < 6; i++) p.line(`M${25 + i * 2.6} 38 L${25.6 + i * 2.4} 56`, '#a87a24', 1, 0.55);
  // front fan
  for (const [x, y, c] of [
    [20, 6, '#f4d47a'],
    [28, 3, '#fbe39a'],
    [36, 4, '#f4d47a'],
    [44, 7, '#ecc662'],
  ] as const)
    straw(`M32 40 Q${(32 + x) / 2 + (x < 32 ? -3 : 3)} ${18} ${x} ${y}`, c);
  // twine
  p.shape('M21 38 C26 42 38 42 43 38 L43 43 C38 47 26 47 21 43 Z', '#b83a2a', 1.8);
  p.line('M24 42 C28 44 36 44 40 42', '#ff8a70', 1.2, 0.8);
  // stray bits
  p.line('M12 54 L18 50 M50 55 L45 51 M8 46 L13 45', '#e8c060', 1.8);
  p.glint(28, 34, 3, 1.4, -20, 0.7);
};

/** Fertilizer sack (burlap, slumped, open) spilling granules; quality = dark teal sack with a gold star. */
function fertSack(p: Pen, body: string, band: string, grain: string, star: boolean): void {
  p.ellipse(33, 57, 24, 3.8, '#000', false, 0.17);
  // spill: little heap + scattered granules
  p.shape('M38 58 C40 51 50 50 58 55 C58 58 48 59 38 58 Z', p.rad([tone(grain, 1.5), grain, tone(grain, 0.6)], 0.5, 0.3, 0.8), 1.8);
  for (const [x, y, r] of [
    [44, 53.5, 1.3],
    [50, 53, 1.1],
    [53, 55, 1.2],
    [47, 56, 1],
    [60, 58, 1.2],
    [36, 60, 1],
  ] as const)
    p.circle(x, y, r, tone(grain, 1.35), false, 0.95);
  // sack body, tipped toward the spill
  p.raw('<g transform="rotate(-10 26 40)">');
  p.shape('M10 28 C6 38 6 50 12 56 C18 60 38 60 42 55 C47 48 46 36 40 26 Z', p.rad([tone(body, 1.35), body, tone(body, 0.55)], 0.35, 0.3, 0.9));
  // folded-open mouth with granules showing
  p.shape('M8 26 C14 20 38 18 44 25 C38 30 14 31 8 26 Z', p.lin([tone(body, 1.2), tone(body, 0.75)], 0, 0, 0, 1), 2);
  p.fill('M13 26 C18 23 34 22 39 25 C34 27 18 28 13 26 Z', tone(grain, 0.9));
  for (const [x, y] of [
    [18, 25],
    [23, 24.4],
    [28, 24.6],
    [33, 25],
  ] as const)
    p.circle(x, y, 1.1, tone(grain, 1.4), false, 0.9);
  // weave texture + label
  for (let i = 0; i < 5; i++) p.line(`M${12 + i * 7} 33 L${13 + i * 6.6} 54`, tone(body, 0.62), 1, 0.35);
  p.shape('M15 36 H37 V49 H15 Z', p.lin([tone(band, 1.25), band, tone(band, 0.8)]), 1.8);
  if (star) p.raw(`<path d="M26 37.6 l2 4 l4.4 .6 l-3.2 3 l.8 4.4 l-4 -2.1 l-4 2.1 l.8 -4.4 l-3.2 -3 l4.4 -.6 Z" fill="#ffd84a" stroke="${OL}" stroke-width="1.3" stroke-linejoin="round"/>`);
  else p.raw(`<path d="M26 47 C26 43 25 41 22 39.6 C25 39.4 26.6 41 26.8 43 C27.4 40.6 29.6 39 32 39.4 C29.6 40.6 27.8 43 27.4 47 Z" fill="#6ab04a" stroke="${OL}" stroke-width="1.1" stroke-linejoin="round"/>`);
  p.glint(14, 34, 2.6, 7, 12, 0.4);
  p.raw('</g>');
}
const fertilizer: Painter = (p) => fertSack(p, '#d8c29a', '#f6ecd0', '#8a5a36', false);
const qualityFertilizer: Painter = (p) => fertSack(p, '#5a9a8a', '#1e5a52', '#3a2618', true);

/** Starfall Opal: an iridescent oval cabochon in a little gold bezel with an aurora drifting inside + a star. */
const starfallOpal: Painter = (p) => {
  shadow(p, 17);
  // A tumbled, egg-shaped opal: pearly base, drifting aurora bands, a star caught inside.
  const body = 'M32 7 C46 7 54 20 54 34 C54 49 44 58 32 58 C20 58 10 49 10 34 C10 20 18 7 32 7 Z';
  p.shape(body, p.lin(['#f4fbff', '#cfe6ff', '#e4d2ff', '#ffd6ee', '#c8fff0', '#a8cff4'], 0.05, 0, 0.95, 1), 2.6);
  p.raw(`<clipPath id="sfo"><path d="${body}"/></clipPath><g clip-path="url(#sfo)"><path d="M4 44 C16 30 26 44 36 30 C44 20 52 24 60 16" fill="none" stroke="#6af0c0" stroke-width="7" stroke-linecap="round" opacity=".45"/><path d="M4 54 C18 42 30 54 40 42 C48 34 54 38 62 32" fill="none" stroke="#a080ff" stroke-width="6" stroke-linecap="round" opacity=".42"/><path d="M8 26 C18 18 28 24 36 16" fill="none" stroke="#ff8ad0" stroke-width="4.5" stroke-linecap="round" opacity=".4"/><path d="M10 58 C22 50 42 50 56 58" fill="#5a78c0" opacity=".25"/></g>`);
  p.raw('<path d="M35 26 l2.1 5.4 l5.4 2.1 l-5.4 2.1 l-2.1 5.4 l-2.1 -5.4 l-5.4 -2.1 l5.4 -2.1 Z" fill="#fffbe6" stroke="#b8a0ff" stroke-width=".8"/>');
  p.circle(35, 33.5, 1.8, '#fff', false, 1);
  p.glint(22, 20, 5.4, 2.6, -40, 0.95);
  p.glint(44, 48, 2.6, 1.2, -40, 0.5);
  p.shape(body, 'none', 2.6);
  sparkle(p, 53, 9, 1);
  sparkle(p, 9, 50, 0.6);
};

/** Gingerbread villager: a biscuit person with piped icing trim, a smile and extra buttons. */
const gingerbreadVillager: Painter = (p) => {
  shadow(p, 18, 59);
  const body = 'M32 5 C39 5 43 10 43 16 C43 19 42 21 40 23 L52 24 C57 24 58 31 53 32 L42 33 L44 48 L48 55 C50 59 44 62 41 58 L32 48 L23 58 C20 62 14 59 16 55 L20 48 L22 33 L11 32 C6 31 7 24 12 24 L24 23 C22 21 21 19 21 16 C21 10 25 5 32 5 Z';
  p.shape(body, p.rad(['#e8a860', '#c07838', '#7a4418'], 0.4, 0.3, 0.85));
  const ice = (d: string): void => {
    p.line(d, '#fffaf2', 2.2, 1);
  };
  ice('M9 27 q1.6 -2 3.2 0 t3.2 0');
  ice('M49 27 q1.6 -2 3.2 0 t3.2 0');
  ice('M17 56 q1.6 -2.4 3.2 -0.4');
  ice('M43 56 q1.6 2 3.2 -0.4');
  ice('M25 10 C28 7 36 7 39 10');
  p.circle(28, 15, 1.9, OL, false).circle(36, 15, 1.9, OL, false);
  p.line('M27.5 19.5 C30 22 34 22 36.5 19.5', '#fffaf2', 1.8, 1);
  p.circle(25.6, 18.6, 1.6, '#f08a8a', false, 0.7).circle(38.4, 18.6, 1.6, '#f08a8a', false, 0.7);
  for (const [y, c] of [
    [28, '#e8574a'],
    [34.5, '#6ab04a'],
    [41, '#fff4d8'],
  ] as const)
    p.circle(32, y, 2.4, c, true);
  p.glint(26, 9, 3, 1.4, -25, 0.55);
};

const HAND_PAINTERS: Record<string, Painter> = {
  starfallOpal,
  fertilizer,
  qualityFertilizer,
  gingerbreadVillager,
  hayBale: hay,
  quartz,
  diamond,
  amethyst,
  ruby,
  topaz,
  aquamarine,
  emberOpal,
  copperOre,
  ironOre,
  goldOre,
  brownEgg,
  duckEgg,
  feather,
  duckFeather: feather,
  goatMilk,
  wool,
  truffle,
  hay: hayTuft,
  frostShard,
  slimeGel,
  hoe,
  wateringCan,
  axe,
  pickaxe,
  scythe,
  fishingRod,
  rod: fishingRod,
  weapon,
  wood,
  stone,
  fiber,
  sprinkler,
  brassSprinkler,
  goldSprinkler,
  chest,
  scarecrow,
  woodFence,
  fence: woodFence,
  stonePath,
  path: stonePath,
  parsnip,
  potato,
  cauliflower,
  kale,
  strawberry,
  tomato,
  corn,
  sunflower,
  pumpkin,
  greenBean,
  blueberry,
  melon,
  hotPepper,
  hops,
  eggplant,
  grape,
  beet,
  yam,
  cockle: shell,
  shell,
  spiralConch: conch,
  conch,
  starfish,
  sandDollar,
  seaGlass,
  coralSprig: coral,
  coral,
  ore,
  bar,
  gem,
  geode,
  coal,
  egg,
  jar,
  bottle,
  milk,
  cheese,
  bread,
  dish,
  mushroom,
  berries,
  flower,
  herb,
  sack,
  letter,
};

/** Keyword → painter for items other teams add without a hand-made icon. */
const KEYWORDS: [RegExp, string][] = [
  [/rod|pole/, 'fishingRod'],
  [/sword|dagger|club|blade|hammer/, 'weapon'],
  [/geode/, 'geode'],
  [/coal/, 'coal'],
  [/ore\b|ore$|Ore/, 'ore'],
  [/bar\b|bar$|Bar|ingot/i, 'bar'],
  [/quartz|amethyst|emerald|ruby|topaz|diamond|jade|aquamarine|crystal|gem|prism|opal/i, 'gem'],
  [/egg/i, 'egg'],
  [/milk/i, 'milk'],
  [/cheese/i, 'cheese'],
  [/honey|jam|jelly|preserve|pickle|syrup|sauce|mayo/i, 'jar'],
  [/juice|wine|cider|ale|beer|tea|coffee|potion|tonic|oil|vinegar/i, 'bottle'],
  [/bread|loaf|bun|roll|biscuit|cookie|muffin|scone|pie|cake|tart/i, 'bread'],
  [/soup|stew|salad|meal|dish|toast|omelet|pancake|roast|platter|chowder|curry|pasta|porridge/i, 'dish'],
  [/mushroom|morel|chanterelle|truffle|toadstool/i, 'mushroom'],
  [/berry|berries|grape|cherry|currant/i, 'berries'],
  [/flower|tulip|rose|daisy|poppy|lily|lavender|crocus|blossom|bloom|sunflower/i, 'flower'],
  [/leek|herb|leaf|dandelion|fern|mint|sage|thyme|grass|clover|seaweed|kelp/i, 'herb'],
  [/letter|note|book|scroll|recipe/i, 'letter'],
  [/fish|trout|salmon|carp|perch|bass|pike|eel|catfish|minnow|sardine|cod|tuna|chub|bream|herring|snapper|sunfish|koi|smelt|shad|anchovy|flounder|halibut|sturgeon|walleye|gar|dace|loach|goby|ray/i, 'fish'],
  [/shell|clam|oyster|mussel|cockle|scallop/i, 'shell'],
  [/conch|snail|whelk/i, 'conch'],
  [/starfish|sea ?star/i, 'starfish'],
  [/coral/i, 'coral'],
  [/glass/i, 'seaGlass'],
  [/chest/i, 'chest'],
  [/fence/i, 'woodFence'],
  [/path|floor|tile/i, 'stonePath'],
  [/sprinkler/i, 'sprinkler'],
  [/scarecrow/i, 'scarecrow'],
  [/wood|log|plank|lumber|driftwood|branch|twig/i, 'wood'],
  [/stone|rock|pebble|clay|flint|slate|marble/i, 'stone'],
  [/fiber|fibre|straw|hay|wool|cloth/i, 'fiber'],
];

function painterFor(id: string, def: ItemDef | undefined): { paint: Painter; color?: string } {
  const color = def?.color !== undefined ? hex(def.color) : undefined;
  // The item's own id wins (brownEgg / duckEgg share icon 'egg' but have their own art).
  const key = HAND_PAINTERS[id] ? id : def?.icon && HAND_PAINTERS[def.icon] ? def.icon : undefined;
  if (key) return { paint: HAND_PAINTERS[key]!, color };
  const kind = (def?.kind ?? '') as string;
  const hay = `${id} ${def?.icon ?? ''} ${def?.name ?? ''}`;
  if (kind === 'fish') return { paint: fishPainter(hash(id)), color: color ?? hsl(hash(id)) };
  for (const [re, k] of KEYWORDS) {
    if (re.test(hay)) {
      if (k === 'fish') return { paint: fishPainter(hash(id)), color: color ?? hsl(hash(id)) };
      return { paint: HAND_PAINTERS[k]!, color: color ?? hsl(hash(id)) };
    }
  }
  if (kind === 'tool') return { paint: HAND_PAINTERS.hoe!, color };
  if (kind === 'mineral' || kind === 'gem') return { paint: gem, color: color ?? hsl(hash(id)) };
  if (kind === 'food' || kind === 'cooking') return { paint: dish, color: color ?? hsl(hash(id)) };
  if (kind === 'artisan') return { paint: jar, color: color ?? hsl(hash(id)) };
  if (kind === 'forage') return { paint: herb, color: color ?? '#6aae45' };
  if (kind === 'produce') return { paint: berries, color: color ?? hsl(hash(id)) };
  return { paint: sack, color: color ?? hsl(hash(id)) };
}

function hsl(h: number): string {
  // Pleasant mid-saturation colours for unknown items.
  const hue = h % 360;
  const s = 0.55;
  const l = 0.55;
  const k = (n: number): number => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hex((Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255));
}

// ── Seed packets: kraft envelope with the crop painted on its label ─────────

function mixc(a: string, b: string, k: number): string {
  const pa = parse(a);
  const pb = parse(b);
  return hex(((Math.round(pa[0] + (pb[0] - pa[0]) * k) << 16) | (Math.round(pa[1] + (pb[1] - pa[1]) * k) << 8) | Math.round(pa[2] + (pb[2] - pa[2]) * k)) >>> 0);
}

/**
 * Seed packet: a crimped paper envelope tinted with the crop's colour, tilted back, with the crop itself
 * painted large in front of it (so every packet reads by silhouette + hue at toolbar size).
 */
const PACKET_BAND: Record<string, string> = {
  parsnip: '#e8a33a',
  cauliflower: '#5f98d8',
  potato: '#a8683a',
  kale: '#3f8a5a',
  strawberry: '#d8454a',
  greenBean: '#58a83a',
  tomato: '#e0503a',
  corn: '#e8c030',
  blueberry: '#4a62c8',
  melon: '#7ac05a',
  hotPepper: '#d83a2a',
  hops: '#8ab83a',
  sunflower: '#f0b020',
  pumpkin: '#e8782a',
  eggplant: '#7a4aa8',
  grape: '#8a3a9a',
  beet: '#b02a5a',
  yam: '#c8603a',
};

function seedPacket(id: string, def: ItemDef | undefined): string {
  const p = new Pen('s');
  const crop = def?.crop ? String(def.crop) : id.replace(/Seeds?$/i, '');
  const inner = HAND_PAINTERS[crop];
  const cc = def?.color !== undefined ? hex(def.color) : '#8fc86a';
  // Every crop gets its own packet colour (pale crops like parsnip / cauliflower would all read as kraft).
  const [r, g, b] = parse(cc);
  const pale = (r + g + b) / 3 > 200;
  const band = PACKET_BAND[crop] ?? (pale ? hsl(hash(crop)) : cc);
  const paper = mixc('#ecd49e', band, 0.38);
  p.raw('<g transform="rotate(-9 26 34)">');
  p.shape('M6 12 H44 L46 56 C46 59 44 60 41 60 H9 C6 60 4 59 4 56 Z', p.lin([tone(paper, 1.18), paper, tone(paper, 0.68)], 0, 0.5, 1, 0.5));
  // crimped top
  let crimp = 'M5 7';
  for (let x = 5; x < 45; x += 5) crimp += ` L${x + 2.5} 12 L${x + 5} 7`;
  p.shape(`${crimp} L45 16 H5 Z`, p.lin([tone(paper, 1.35), tone(paper, 0.92)], 0, 0, 0, 1), 1.8);
  // label + colour band + tiny seed motif
  p.shape('M9 20 H41 V44 H9 Z', p.lin(['#fffdf4', '#f2e6cc']), 1.5);
  p.fill('M9 20 H41 V24.5 H9 Z', band);
  for (const [x, y, rot] of [
    [14, 30, -30],
    [18.5, 34, 20],
    [13.5, 38, 60],
  ] as const)
    p.ellipse(x, y, 2.1, 1.3, tone(band, 0.8), false, 0.85, rot);
  p.fill('M9 48 H45 V56 C45 58 43 59 41 59 H9 C7 59 6 58 6 56 V48 Z', tone(band, 0.82), 0.9);
  p.line('M11 52 H22', '#fff', 1.4, 0.65);
  p.fill('M8 16 H11 V57 H8 Z', '#fff', 0.35);
  p.raw('</g>');
  // the crop, big and in front
  p.ellipse(45, 59, 15, 3, '#2a1a08', false, 0.22);
  if (inner) {
    const sub = new Pen('i');
    inner(sub, def?.color !== undefined ? hex(def.color) : undefined);
    const body = sub.svg().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    // Big and forward: the crop is the packet's silhouette at toolbar size.
    p.raw(`<g transform="translate(19 19) scale(0.7)">${body}</g>`);
  } else {
    p.circle(44, 42, 11, p.rad([tone(band, 1.4), band, tone(band, 0.6)]));
  }
  // spilled seeds
  p.ellipse(8, 60, 2.2, 1.5, '#c8a064', true, 1, -20).ellipse(14, 61.5, 1.8, 1.2, '#b88e54', true, 1, 30);
  return p.svg();
}

const svgCache = new Map<string, string>();
const urlCache = new Map<string, string>();
const OVERRIDES = new Map<string, string | (() => string)>();

/**
 * Let another team supply the art for an item (by item id or icon key): a full SVG string (any
 * viewBox) or a lazy factory. Takes precedence over the built-in painters.
 */
export function registerItemIcon(key: string, svg: string | (() => string)): void {
  OVERRIDES.set(key, svg);
  svgCache.clear();
  urlCache.clear();
}

/** Raw SVG markup for an item. */
export function itemSvg(id: string): string {
  let s = svgCache.get(id);
  if (s) return s;
  const def = itemDef(id);
  const ov = OVERRIDES.get(id) ?? (def?.icon ? OVERRIDES.get(def.icon) : undefined);
  // Items whose art was dropped straight into ICONS by another team (legacy path).
  const legacy = def?.icon && !HUD_KEYS.has(def.icon) ? ICONS[def.icon] : !HUD_KEYS.has(id) ? ICONS[id] : undefined;
  if (ov) s = typeof ov === 'string' ? ov : ov();
  else if (legacy) s = legacy.includes('xmlns') ? legacy : legacy.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  else if (def?.kind === 'seed' || /Seeds?$/.test(id)) s = seedPacket(id, def);
  else {
    const { paint, color } = painterFor(id, def);
    const p = new Pen('g');
    paint(p, color);
    s = p.svg();
  }
  svgCache.set(id, s);
  return s;
}

export function itemIconUrl(id: string): string {
  let u = urlCache.get(id);
  if (!u) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(itemSvg(id))}`;
    urlCache.set(id, u);
  }
  return u;
}

export function itemIcon(id: string, cls = 'u-ic'): string {
  return `<img class="${cls}" src="${itemIconUrl(id)}" alt="" draggable="false"/>`;
}

/** Legacy signature (seed packets were tinted by colour; now every item has its own art). */
export function iconFor(itemId: string, _icon?: string, _color?: number): string {
  return itemIcon(itemId);
}

// ── Categories (tooltips, ledgers) ─────────────────────────────────────────

const FLOWERS = /sunflower|tulip|rose|daisy|poppy|lily|(?<!cauli)flower/i;
const FRUIT = /strawberry|berry|melon|apple|cherry|grape|peach|orange|blueberr/i;

export function itemCategory(id: string): { label: string; color: string; group: string } {
  const d = itemDef(id);
  const kind = (d?.kind ?? '') as string;
  if (kind === 'tool') return { label: 'Tool', color: '#6d7784', group: 'Other' };
  if (kind === 'seed') return { label: 'Seed', color: '#8a6a3a', group: 'Other' };
  if (kind === 'produce') {
    if (FLOWERS.test(id)) return { label: 'Flower', color: '#d0588a', group: 'Farming' };
    if (FRUIT.test(id)) return { label: 'Fruit', color: '#d9463a', group: 'Farming' };
    return { label: 'Vegetable', color: '#4f9a3a', group: 'Farming' };
  }
  if (kind === 'placeable') return { label: 'Crafted', color: '#b0703a', group: 'Other' };
  if (kind === 'fish' || /fish|trout|salmon|carp|perch|bass|pike|eel/i.test(id)) return { label: 'Fish', color: '#3f86b8', group: 'Fishing' };
  if (kind === 'mineral' || kind === 'gem' || /ore|bar|gem|quartz|geode|coal/i.test(id)) return { label: 'Mineral', color: '#7a64b0', group: 'Mining' };
  if (kind === 'forage') return { label: 'Forage', color: '#6a8a2a', group: 'Foraging' };
  if (kind === 'food' || kind === 'cooking') return { label: 'Cooking', color: '#d07a2a', group: 'Other' };
  if (kind === 'artisan') return { label: 'Artisan Good', color: '#b8862a', group: 'Farming' };
  if (kind === 'resource') return { label: 'Resource', color: '#8a7050', group: 'Foraging' };
  return { label: kind ? kind[0]!.toUpperCase() + kind.slice(1) : 'Item', color: '#8a7050', group: 'Other' };
}

/** Quality price multipliers (normal, silver, gold, iridium). */
export const QUALITY_MULT = [1, 1.25, 1.5, 2];
export const QUALITY_NAME = ['', 'Silver', 'Gold', 'Iridium'];

export function qualityStar(q: number, cls = 'u-star'): string {
  if (!q) return '';
  const [a, b, o] = q === 1 ? ['#ffffff', '#b8c4d0', '#5e6a78'] : q === 2 ? ['#fff6b0', '#f5c542', '#9a6a14'] : ['#f0d8ff', '#b56adf', '#5a2a8a'];
  return `<svg class="${cls}" viewBox="0 0 24 24"><defs><linearGradient id="qs${q}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><path d="M12 2.2 L14.9 8.3 L21.6 9.1 L16.6 13.7 L17.9 20.4 L12 17.1 L6.1 20.4 L7.4 13.7 L2.4 9.1 L9.1 8.3 Z" fill="url(#qs${q})" stroke="${o}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

// ── HUD glyphs (inline SVG, 24×24) ─────────────────────────────────────────

const g24 = (body: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  coin: g24(
    `<circle cx="12" cy="12.8" r="8.6" fill="#b87a14"/><circle cx="12" cy="11.6" r="8.6" fill="#f7cf4a" stroke="#8a5a0a" stroke-width="1.4"/><circle cx="12" cy="11.6" r="5.8" fill="none" stroke="#dca02a" stroke-width="1.3"/><path d="M9.6 9.2 C10.4 8.4 13.6 8.4 14.2 9.6 C14.8 11 9.4 11.4 9.8 13.2 C10.2 14.8 13.6 14.8 14.4 13.8 M12 7.4 V15.8" fill="none" stroke="#9a6a0e" stroke-width="1.3"/><ellipse cx="8.8" cy="7.8" rx="2.4" ry="1.2" fill="#fff" opacity=".75" transform="rotate(-30 8.8 7.8)"/>`,
  ),
  sun: g24(`<g stroke="#e8a33a" stroke-width="1.8"><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8"/></g><circle cx="12" cy="12" r="5.2" fill="#ffd166" stroke="#c97a1a" stroke-width="1.3"/><circle cx="10.4" cy="10.4" r="1.6" fill="#fff6c8"/>`),
  rain: g24(`<path d="M6.5 14 a4 4 0 0 1 .6 -8 a5.2 5.2 0 0 1 9.8 1.4 a3.4 3.4 0 0 1 .2 6.6 Z" fill="#eef3f8" stroke="#6a7e96" stroke-width="1.3"/><g stroke="#3f86d6" stroke-width="1.9"><path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/></g>`),
  storm: g24(`<path d="M6.5 13 a4 4 0 0 1 .6 -8 a5.2 5.2 0 0 1 9.8 1.4 a3.4 3.4 0 0 1 .2 6.6 Z" fill="#aab6c6" stroke="#4e5a6a" stroke-width="1.3"/><path d="M12.5 12 l-2.6 4.6 h3.2 l-2 5" fill="none" stroke="#f5b82a" stroke-width="2.2"/>`),
  snow: g24(`<g stroke="#5f9fd8" stroke-width="1.9"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.8 3.8 12 5.6l2.2-1.8M9.8 20.2 12 18.4l2.2 1.8" fill="none"/></g><circle cx="12" cy="12" r="2.1" fill="#fff" stroke="#5f9fd8" stroke-width="1.2"/>`),
  wind: g24(`<g fill="none" stroke="#7a9ab8" stroke-width="2"><path d="M3 9h11a3 3 0 1 0 -3 -3"/><path d="M3 14h15a3 3 0 1 1 -3 3"/><path d="M3 19h7"/></g>`),
  moon: g24(`<path d="M15 2.8 a9.2 9.2 0 1 0 6.2 13.4 a7.2 7.2 0 0 1 -6.2 -13.4 Z" fill="#f7ebb8" stroke="#a88c40" stroke-width="1.3"/><circle cx="10" cy="14" r="1.3" fill="#e0cc88"/><circle cx="13" cy="18" r=".9" fill="#e0cc88"/>`),
  spring: g24(`<g fill="#ffb3cf" stroke="#c8577c" stroke-width="1"><ellipse cx="12" cy="6.6" rx="3.3" ry="3.7"/><ellipse cx="17.2" cy="10.4" rx="3.3" ry="3.7" transform="rotate(72 17.2 10.4)"/><ellipse cx="15.2" cy="16.4" rx="3.3" ry="3.7" transform="rotate(144 15.2 16.4)"/><ellipse cx="8.8" cy="16.4" rx="3.3" ry="3.7" transform="rotate(216 8.8 16.4)"/><ellipse cx="6.8" cy="10.4" rx="3.3" ry="3.7" transform="rotate(288 6.8 10.4)"/></g><circle cx="12" cy="12" r="2.6" fill="#ffd166" stroke="#c97a1a" stroke-width=".9"/>`),
  summer: g24(`<path d="M12 21 C12 15 11 11 8 8" fill="none" stroke="#3f7a2a" stroke-width="1.8"/><path d="M11 14 C7 14 5 12 4.5 9.5 C8 9.5 10 11 11 14 Z" fill="#6aae45" stroke="#2f5a1a" stroke-width="1"/><circle cx="13.5" cy="7.5" r="5.4" fill="#ffc94a" stroke="#c97a1a" stroke-width="1.3"/><circle cx="13.5" cy="7.5" r="2.4" fill="#8a4a1a"/>`),
  fall: g24(`<path d="M12 2.5 L14 7 L18.5 5.5 L17 10 L21.5 11.5 L17.5 14 L19 18 L13.5 16.5 L12 21.5 L10.5 16.5 L5 18 L6.5 14 L2.5 11.5 L7 10 L5.5 5.5 L10 7 Z" fill="#e8742a" stroke="#8a3a10" stroke-width="1.2"/><path d="M12 21.5 V8" stroke="#8a3a10" stroke-width="1.1"/>`),
  winter: g24(`<g stroke="#5f9fd8" stroke-width="1.9"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.8 3.8 12 5.6l2.2-1.8M9.8 20.2 12 18.4l2.2 1.8M4 11 5.8 12 4 13M20 11l-1.8 1 1.8 1" fill="none"/></g>`),
  heart: g24(`<path d="M12 21 C 5.5 15.5 2 12 2 7.8 A 4.8 4.8 0 0 1 12 5.6 A 4.8 4.8 0 0 1 22 7.8 C 22 12 18.5 15.5 12 21 Z" fill="#e8474a" stroke="#8a1a1e" stroke-width="1.5"/><ellipse cx="7.4" cy="8" rx="2.2" ry="1.4" fill="#fff" opacity=".7" transform="rotate(-30 7.4 8)"/>`),
  bolt: g24(`<path d="M13.6 1.8 5 13.3c-.3.4 0 .9.5.9h4.8l-2 7.4c-.1.5.5.8.8.4l8.7-11.5c.3-.4 0-.9-.5-.9h-4.9l2-7.3c.2-.5-.5-.8-.8-.5z" fill="#ffd84a" stroke="#8a4a10" stroke-width="1.3"/><path d="M12.2 5 8 11" stroke="#fff6c0" stroke-width="1.4"/>`),
  trash: g24(`<path d="M5 7 H19 L17.6 20.4 C17.5 21.3 16.8 22 15.9 22 H8.1 C7.2 22 6.5 21.3 6.4 20.4 Z" fill="#9aa6b3" stroke="#3d4650" stroke-width="1.4"/><path d="M3.5 5.5 H20.5 V8 H3.5 Z" fill="#c4ccd6" stroke="#3d4650" stroke-width="1.4"/><path d="M9.5 3 H14.5 V5.5 H9.5 Z" fill="#c4ccd6" stroke="#3d4650" stroke-width="1.2"/><path d="M9.5 10.5 V18.5 M14.5 10.5 V18.5" stroke="#5a6470" stroke-width="1.3"/>`),
  sort: g24(`<path d="M7 4 V19 M3.5 15.5 7 19l3.5-3.5M17 20V5M13.5 8.5 17 5l3.5 3.5" fill="none" stroke="#5a3a1e" stroke-width="2.2"/>`),
  gear: g24(`<path d="M12 2.5l1.6 2.4 2.8-.8.6 2.9 2.9.6-.8 2.8 2.4 1.6-2.4 1.6.8 2.8-2.9.6-.6 2.9-2.8-.8L12 21.5l-1.6-2.4-2.8.8-.6-2.9-2.9-.6.8-2.8L2.5 12l2.4-1.6-.8-2.8 2.9-.6.6-2.9 2.8.8z" fill="#c9a060" stroke="#5a3a1e" stroke-width="1.3"/><circle cx="12" cy="12" r="3.4" fill="#fbf0d6" stroke="#5a3a1e" stroke-width="1.3"/>`),
  bag: g24(`<path d="M5 9 C5 6 7 5 12 5 C17 5 19 6 19 9 L20 19 C20 21 19 22 17 22 H7 C5 22 4 21 4 19 Z" fill="#c98a4a" stroke="#5a3414" stroke-width="1.4"/><path d="M8 5 C8 1.5 16 1.5 16 5" fill="none" stroke="#5a3414" stroke-width="1.6"/><path d="M4.5 12 H19.5" stroke="#8a5424" stroke-width="1.4"/><rect x="10" y="10.5" width="4" height="3.4" rx=".8" fill="#f5c542" stroke="#8a5a0a" stroke-width="1"/>`),
  hammer: g24(`<path d="M13 9 L4 18.5 C3.4 19.2 3.6 20.2 4.3 20.7 C5 21.2 5.8 21 6.3 20.4 L15 11" fill="#c98a4a" stroke="#5a3414" stroke-width="1.4"/><path d="M10.5 6 L16 1.8 L22 7.6 L17.8 13 Z" fill="#aab4c0" stroke="#3d4650" stroke-width="1.4"/><path d="M12.2 6.2 L16 3.4" stroke="#fff" stroke-width="1.2"/>`),
  map: g24(`<path d="M2.5 5.5 8.5 3l7 2.5 6-2.5v15.5l-6 2.5-7-2.5-6 2.5z" fill="#f3e2bc" stroke="#5a3a1e" stroke-width="1.4"/><path d="M8.5 3v15.5M15.5 5.5V21" stroke="#5a3a1e" stroke-width="1.1" opacity=".6"/><path d="M4.5 13 C7 11 9 15 12 12 C14 10 16 13 19.5 11" fill="none" stroke="#3f86d6" stroke-width="1.4"/><circle cx="12" cy="8" r="1.8" fill="#e8574a"/>`),
  save: g24(`<path d="M4 3.5 H17 L20.5 7 V19.5 C20.5 20.3 19.8 21 19 21 H5 C4.2 21 3.5 20.3 3.5 19.5 V4 Z" fill="#6aa8e0" stroke="#24486e" stroke-width="1.4"/><rect x="7" y="3.5" width="9" height="6" fill="#eef4fa" stroke="#24486e" stroke-width="1.2"/><rect x="6.5" y="13" width="11" height="8" rx="1" fill="#fbf0d6" stroke="#24486e" stroke-width="1.2"/>`),
  play: g24(`<path d="M7 4.5 V19.5 C7 20.3 7.9 20.8 8.6 20.3 L19.4 13 C20 12.6 20 11.4 19.4 11 L8.6 3.7 C7.9 3.2 7 3.7 7 4.5 Z" fill="#8fd05a" stroke="#2f5a1a" stroke-width="1.5"/>`),
  door: g24(`<path d="M5 21.5 V4 C5 3 5.8 2.5 6.8 2.5 H17.2 C18.2 2.5 19 3 19 4 V21.5" fill="#b0703a" stroke="#4a2810" stroke-width="1.5"/><path d="M8 21.5 V6 H16 V21.5" fill="#d99a58" stroke="#4a2810" stroke-width="1.2"/><circle cx="14" cy="13.5" r="1.2" fill="#f5c542" stroke="#8a5a0a" stroke-width=".8"/><path d="M3 21.5 H21" stroke="#4a2810" stroke-width="1.6"/>`),
  sprout: g24(`<path d="M12 21 V11" stroke="#3f7a2a" stroke-width="2"/><path d="M12 12 C12 7 8.5 4.5 3.5 4.8 C3.6 9.5 7 12.2 12 12 Z" fill="#8fd05a" stroke="#2f5a1a" stroke-width="1.3"/><path d="M12 14 C12 9.5 15.2 7 20.5 7.2 C20.4 11.6 17 14.2 12 14 Z" fill="#6aae45" stroke="#2f5a1a" stroke-width="1.3"/><path d="M6 21 H18" stroke="#8a5a2a" stroke-width="2.2"/>`),
  quill: g24(`<path d="M20.5 3.5 C13 4.5 8 10 6.5 17.5 C12 15 17.5 10.5 20.5 3.5 Z" fill="#fbf0d6" stroke="#5a3a1e" stroke-width="1.3"/><path d="M6.5 17.5 L3.5 21 M9 14 C12 11 15 8 18 5.5" stroke="#5a3a1e" stroke-width="1.2"/>`),
  question: g24(`<circle cx="12" cy="12" r="9.5" fill="#f3e2bc" stroke="#5a3a1e" stroke-width="1.4"/><path d="M9 9.2 C9 6.8 15 6.5 15 9.5 C15 11.5 12 11.8 12 14" fill="none" stroke="#5a3a1e" stroke-width="2"/><circle cx="12" cy="17.4" r="1.3" fill="#5a3a1e"/>`),
  x: g24(`<path d="M6 6 L18 18 M18 6 L6 18" stroke="#fff" stroke-width="3" />`),
  speaker: g24(
    `<path d="M3.5 9 H7.5 L12.5 4.8 V19.2 L7.5 15 H3.5 Z" fill="#e8b04a" stroke="#6a3c12" stroke-width="1.5"/><path d="M4.6 10.2 H7.6" stroke="#fff4c8" stroke-width="1.2" opacity=".8"/><path d="M15.4 9 C16.8 10.6 16.8 13.4 15.4 15" fill="none" stroke="#5a8ac8" stroke-width="1.8"/><path d="M17.8 6.6 C20.8 9.6 20.8 14.4 17.8 17.4" fill="none" stroke="#5a8ac8" stroke-width="1.8" opacity=".75"/>`,
  ),
  screen: g24(
    `<rect x="2.6" y="4" width="18.8" height="12.6" rx="2.2" fill="#8ac0e8" stroke="#3a4a5a" stroke-width="1.5"/><path d="M3.8 13.2 C7 10.4 9.4 12.4 12 10.6 C14.8 8.6 17.4 10.2 20.2 9.4 V15.2 H3.8Z" fill="#6ab04a"/><circle cx="16.6" cy="7.4" r="1.6" fill="#ffe070"/><path d="M9 20 H15 M12 16.6 V20" stroke="#6a4a2a" stroke-width="1.8"/>`,
  ),
  people: g24(
    `<circle cx="8.5" cy="8" r="3.4" fill="#f5c9a0" stroke="#5a3418" stroke-width="1.3"/><path d="M2.6 19.5 C3 14.6 5.6 13 8.5 13 C11.4 13 14 14.6 14.4 19.5Z" fill="#5f8a5c" stroke="#2f4a2c" stroke-width="1.3"/><circle cx="16.2" cy="9" r="3" fill="#e0a878" stroke="#5a3418" stroke-width="1.3"/><path d="M12.4 19.5 C12.8 15.4 14.4 14 16.2 14 C19 14 21 15.6 21.4 19.5Z" fill="#4b6c9e" stroke="#26375a" stroke-width="1.3"/>`,
  ),
  paw: g24(
    `<ellipse cx="12" cy="15.6" rx="4.6" ry="3.8" fill="#c8864a" stroke="#5a3418" stroke-width="1.4"/><ellipse cx="6.4" cy="10.4" rx="1.9" ry="2.4" fill="#c8864a" stroke="#5a3418" stroke-width="1.3"/><ellipse cx="10" cy="6.8" rx="1.9" ry="2.5" fill="#c8864a" stroke="#5a3418" stroke-width="1.3"/><ellipse cx="14" cy="6.8" rx="1.9" ry="2.5" fill="#c8864a" stroke="#5a3418" stroke-width="1.3"/><ellipse cx="17.6" cy="10.4" rx="1.9" ry="2.4" fill="#c8864a" stroke="#5a3418" stroke-width="1.3"/>`,
  ),
  drop: g24(`<path d="M12 2.6 C15.6 7.6 18.6 11 18.6 14.6 A6.6 6.6 0 0 1 5.4 14.6 C5.4 11 8.4 7.6 12 2.6 Z" fill="#6ab8f0" stroke="#24608a" stroke-width="1.5"/><path d="M9 14.4 C9 16.6 10.4 18 12.4 18.2" fill="none" stroke="#e6f6ff" stroke-width="1.6"/>`),
  clock: g24(`<circle cx="12" cy="12" r="9.2" fill="#fbf0d6" stroke="#5a3a1e" stroke-width="1.5"/><path d="M12 6.4 V12 L15.8 14.2" fill="none" stroke="#c8573e" stroke-width="2"/><circle cx="12" cy="12" r="1.3" fill="#5a3a1e"/>`),
  crow: g24(`<path d="M3 13.5 C6 11 9 10.4 11.4 11 L14.6 7.4 C15.8 6.2 17.8 6.4 18.6 7.6 L21.2 8.4 L18.8 9.4 C18.6 12.6 16.4 15.8 12.6 16.6 L10 20 L9.6 16.8 C7.4 16.6 5 15.4 3 13.5 Z" fill="#3a3a48" stroke="#1a1a22" stroke-width="1.2"/><circle cx="16.6" cy="8.4" r=".9" fill="#ffd66a"/><path d="M6 13.6 C8 13.4 10 14 11.6 15" fill="none" stroke="#6a6a7a" stroke-width="1.1"/>`),
  shield: g24(`<path d="M12 2.6 L19.6 5.4 V11.2 C19.6 16 16.4 19.6 12 21.4 C7.6 19.6 4.4 16 4.4 11.2 V5.4 Z" fill="#8fd05a" stroke="#2f5a1a" stroke-width="1.5"/><path d="M8.4 11.8 L11 14.4 L15.8 9.2" fill="none" stroke="#fff" stroke-width="2.2"/>`),
  grid: g24(`<path d="M12 3 L21 8 L12 13 L3 8 Z" fill="#9ad466" stroke="#3f6a24" stroke-width="1.3"/><path d="M3 8 V11 L12 16 L21 11 V8" fill="#7a4e2c" stroke="#3f2a14" stroke-width="1.2"/><path d="M7.5 5.5 L16.5 10.5 M16.5 5.5 L7.5 10.5" stroke="#3f6a24" stroke-width=".9" opacity=".7"/><path d="M3 13.4 L12 18.4 L21 13.4 M3 16.4 L12 21.4 L21 16.4" fill="none" stroke="#6ab8f0" stroke-width="1.3" stroke-dasharray="2 1.6"/>`),
  star: g24(`<path d="M12 2.4 L14.9 8.4 L21.4 9.2 L16.6 13.7 L17.8 20.2 L12 17 L6.2 20.2 L7.4 13.7 L2.6 9.2 L9.1 8.4 Z" fill="#ffd66a" stroke="#9a6a14" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.4 9.6 L11 7" stroke="#fff6c8" stroke-width="1.4"/>`),
  flame: g24(`<path d="M12 2.4 C13.6 6.4 18.4 8.6 18.4 14 A6.4 6.4 0 0 1 5.6 14 C5.6 10.6 7.8 9 8.6 6.4 C9.6 8.2 10.4 9 11.2 9.2 C11.2 6.6 11.2 4.6 12 2.4 Z" fill="#f59a3a" stroke="#8a3a10" stroke-width="1.4"/><path d="M12 11.6 C13.4 13.4 14.6 14.4 14.6 16.2 A2.6 2.6 0 0 1 9.4 16.2 C9.4 14.6 10.8 13.6 12 11.6 Z" fill="#ffe08a"/>`),
  fish: g24(`<path d="M2.6 12 C5.6 7.2 12.6 6.2 17 10 L21.4 6.6 V17.4 L17 14 C12.6 17.8 5.6 16.8 2.6 12 Z" fill="#7ab8e0" stroke="#24486e" stroke-width="1.4"/><circle cx="7.4" cy="11" r="1.2" fill="#1a2430"/><path d="M11 9 C12 10.6 12 13.4 11 15" fill="none" stroke="#24486e" stroke-width="1.1"/>`),
  pick: g24(`<path d="M11.2 9.2 L4 20 C3.6 20.8 4.4 21.4 5.2 20.8 L13.2 11" fill="#c98a4a" stroke="#5a3414" stroke-width="1.4"/><path d="M3.4 8.6 C8.4 3.4 15.6 3.4 20.6 8.6 C16.2 6.8 13.8 6.6 12 7 C10.2 6.6 7.8 6.8 3.4 8.6 Z" fill="#aab4c0" stroke="#3d4650" stroke-width="1.4"/>`),
  basket: g24(`<path d="M3.4 10 H20.6 L18.6 20 C18.4 20.8 17.8 21.2 17 21.2 H7 C6.2 21.2 5.6 20.8 5.4 20 Z" fill="#d8a45a" stroke="#6a4012" stroke-width="1.4"/><path d="M6 10 C6 4.6 18 4.6 18 10" fill="none" stroke="#6a4012" stroke-width="1.6"/><path d="M4.4 13.6 H19.6 M5.2 17.2 H18.8 M9 10 L9.6 21 M15 10 L14.4 21" stroke="#8a5a1a" stroke-width="1" opacity=".7"/><circle cx="9" cy="8.6" r="2.2" fill="#e8474a" stroke="#8a1a1e" stroke-width="1"/><circle cx="14.4" cy="8.4" r="2.2" fill="#8fd05a" stroke="#2f5a1a" stroke-width="1"/>`),
};

const HUD_KEYS = new Set(Object.keys(ICONS));

export const WEATHER_ICON: Record<string, string> = { sun: 'sun', rain: 'rain', storm: 'storm', snow: 'snow', wind: 'wind' };

/** Every hand-painted key (icon sheet / tests). */
export const PAINTED_KEYS = Object.keys(HAND_PAINTERS);
export { hueShift };
