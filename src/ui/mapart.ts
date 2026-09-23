/**
 * Painted valley map art (used by mapscreen.ts): watercolour on parchment. Everything is seeded and pure SVG —
 * paper mottling + granulation (feTurbulence, multiply), displaced "bleeding" land edges, patchwork fields with
 * hedgerows, an orchard, windmill, stream + footbridges, Poisson-scattered forests of three species with per-tree
 * size / hue jitter and contact shadows, and a season palette (fall canopies, bare snowy winter woods).
 */

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (n: number): string => n.toFixed(1);

// ── Colour ──────────────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(Math.max(0.04, Math.min(0.96, l)) * 100).toFixed(0)}%)`;
}

/** Jittered fill, shade, highlight and ink for one tree. */
function tones(hex: string, r: () => number): { c: string; dk: string; lt: string; ink: string } {
  const [h, s, l] = hexToHsl(hex);
  const hh = h + (r() - 0.5) * 10;
  const ll = l * (1 + (r() - 0.5) * 0.3);
  return { c: hsl(hh, s, ll), dk: hsl(hh + 6, Math.min(1, s * 1.1), ll * 0.66), lt: hsl(hh - 8, s * 0.9, Math.min(0.92, ll * 1.35)), ink: hsl(hh + 10, s * 0.8, ll * 0.4) };
}

export const PAL = {
  spring: { edge: '#5f8a3a', land: '#bcdb8e', land2: '#a0ca70', wash: ['#d8ecb0', '#9cc868', '#c8e4a0'], round: ['#6aa84c', '#7cb858', '#5a9a44', '#86bc5c'], pine: '#3f7a4a', field: ['#b08050', '#8cc05a', '#e8d27a', '#c0a8e0', '#a4d27a'], flower: '#f7b8cc' },
  summer: { edge: '#4a7a2a', land: '#a9d07c', land2: '#88ba5c', wash: ['#c8e49a', '#78ac4c', '#b4d888'], round: ['#468f3c', '#58a246', '#3a7e34', '#6aaa48'], pine: '#2f6a3c', field: ['#e8c860', '#6cae4a', '#a87848', '#f0d060', '#8ac050'], flower: '#ffd84a' },
  fall: { edge: '#9a6a2a', land: '#d8c67e', land2: '#c6aa5e', wash: ['#e8d898', '#c09a50', '#dcc080'], round: ['#d9742a', '#e8a03a', '#c0502a', '#d8b040'], pine: '#3f6a44', field: ['#c89a50', '#e8b848', '#a86a3a', '#d88838', '#b8a060'], flower: '#e0703a' },
  winter: { edge: '#8aa0b8', land: '#eef2f5', land2: '#dae4ec', wash: ['#ffffff', '#d0dce8', '#e8eef4'], round: ['#8a7a6a', '#7a6a5a'], pine: '#3f6a5a', field: ['#e4eaf0', '#d8e0e8', '#eef2f6', '#dce4ec', '#e8ecf0'], flower: '#ffffff' },
} as const;

// ── Geometry helpers ────────────────────────────────────────────────────────

type Pt = [number, number];
type Bez = [Pt, Pt, Pt, Pt];

function bezPts(b: Bez, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0], u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]]);
  }
  return out;
}

const bezD = (b: Bez): string => `M${b[0][0]} ${b[0][1]} C${b[1][0]} ${b[1][1]} ${b[2][0]} ${b[2][1]} ${b[3][0]} ${b[3][1]}`;

export const LAND_D = 'M20 40 C200 10 420 30 640 20 C800 14 920 30 985 60 L985 470 C900 500 820 520 760 520 C700 522 640 500 560 506 C440 516 320 530 200 520 C120 514 60 500 20 480 Z';

// Roads / water as beziers so the scatter can keep clear of them.
const ROADS: Bez[] = [
  [[300, 340], [380, 330], [440, 300], [530, 300]],
  [[600, 300], [680, 290], [740, 270], [800, 256]],
  [[572, 330], [590, 400], [610, 470], [630, 530]],
  [[240, 300], [250, 240], [262, 180], [266, 132]],
];
const FOOTPATH: Bez = [[300, 404], [330, 470], [420, 512], [548, 520]];
const RIVER: Bez[] = [
  [[410, 60], [430, 120], [470, 160], [500, 200]],
  [[500, 200], [540, 250], [520, 300], [560, 360]],
  [[560, 360], [590, 410], [620, 460], [640, 540]],
];
const STREAM: Bez = [[196, 452], [270, 486], [380, 500], [452, 470]];
const STREAM2: Bez = [[452, 470], [500, 450], [548, 440], [588, 418]];

const BLOCK: Pt[] = [...ROADS.flatMap((b) => bezPts(b)), ...bezPts(FOOTPATH), ...RIVER.flatMap((b) => bezPts(b)), ...bezPts(STREAM), ...bezPts(STREAM2)];

interface Keep {
  x: number;
  y: number;
  r: number;
}
// Places, labels, fields and the farm stay clear of trees.
const KEEP: Keep[] = [
  { x: 566, y: 300, r: 66 },
  { x: 566, y: 356, r: 34 },
  { x: 846, y: 252, r: 44 },
  { x: 846, y: 300, r: 30 },
  { x: 262, y: 112, r: 30 },
  { x: 262, y: 64, r: 26 },
  { x: 148, y: 448, r: 64 },
  { x: 640, y: 530, r: 40 },
  { x: 420, y: 238, r: 30 },
];
const RECTS: [number, number, number, number][] = [
  [158, 284, 330, 414], // farm
  [336, 346, 520, 466], // patchwork
  [72, 214, 212, 292], // orchard
  [636, 372, 740, 480], // east fields
  [20, 540, 240, 640], // cartouche
  [880, 520, 1000, 640], // compass
];

function blocked(x: number, y: number, pad: number): boolean {
  for (const k of KEEP) if (Math.hypot(x - k.x, y - k.y) < k.r) return true;
  for (const [a, b, c, d] of RECTS) if (x > a - 4 && x < c + 4 && y > b - 4 && y < d + 4) return true;
  for (const p of BLOCK) if (Math.abs(x - p[0]) < pad && Math.abs(y - p[1]) < pad && Math.hypot(x - p[0], y - p[1]) < pad) return true;
  return false;
}

/** Poisson-disk dart throwing inside `inside(x,y)`, min spacing ~`d`. */
function poisson(r: () => number, n: number, d: number, box: [number, number, number, number], inside: (x: number, y: number) => boolean, into: Pt[]): Pt[] {
  const got: Pt[] = [];
  for (let i = 0; i < n * 12 && got.length < n; i++) {
    const x = box[0] + r() * (box[2] - box[0]);
    const y = box[1] + r() * (box[3] - box[1]);
    if (!inside(x, y) || blocked(x, y, 11)) continue;
    const dd = d * (0.75 + r() * 0.5);
    if (into.some((p) => Math.abs(p[0] - x) < dd && Math.hypot(p[0] - x, p[1] - y) < dd)) continue;
    got.push([x, y]);
    into.push([x, y]);
  }
  return got;
}

// ── Trees ───────────────────────────────────────────────────────────────────

function roundTree(x: number, y: number, s: number, hex: string, r: () => number, season: Season): string {
  // '#f2a6c0' = a blossoming tree: a pale green crown dotted with pink.
  const t = tones(hex === '#f2a6c0' ? '#9ccc6c' : hex, r);
  const shadow = `<ellipse cx="3" cy="9" rx="10" ry="3.2" fill="#3a2e18" opacity=".24"/>`;
  if (season === 'winter') {
    return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(2)})">${shadow}<path d="M0 9 V-4 M0 0 L-6 -8 M0 -2 L6 -9 M0 -5 L-2 -12 M-3 -4 L-8 -6 M3 -6 L7 -4" stroke="${t.ink}" stroke-width="1.6" stroke-linecap="round" fill="none"/><ellipse cx="0" cy="-7" rx="8" ry="5.5" fill="#fff" opacity=".55"/><path d="M-6 -9 q3 -3 6 -1 q3 -3 6 0" stroke="#fff" stroke-width="1.6" fill="none"/></g>`;
  }
  const blossom = hex === '#f2a6c0' || (season === 'spring' && r() < 0.14);
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(2)})">${shadow}<path d="M-1.3 9 L-0.8 1 H0.8 L1.3 9 Z" fill="#6a4428"/><circle r="8.4" cy="-2" fill="${t.c}"/><circle r="6.2" cx="2.4" cy="0.6" fill="${t.dk}" opacity=".5"/><circle r="3.6" cx="-2.8" cy="-5.2" fill="${t.lt}" opacity=".7"/>${blossom ? `<g fill="#f8bcd0" stroke="#c86a8a" stroke-width=".4"><circle cx="-3.4" cy="-1" r="1.5"/><circle cx="3" cy="-5.2" r="1.5"/><circle cx="1.4" cy="2" r="1.3"/><circle cx="-1" cy="-6.5" r="1.2"/><circle cx="4.6" cy="-0.6" r="1.1"/></g>` : ''}<circle r="8.4" cy="-2" fill="none" stroke="${t.ink}" stroke-width="1" opacity=".75"/></g>`;
}

function pineTree(x: number, y: number, s: number, hex: string, r: () => number, season: Season): string {
  const t = tones(hex, r);
  const snow = season === 'winter';
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(2)})"><ellipse cx="2.5" cy="10" rx="7.5" ry="2.6" fill="#3a2e18" opacity=".24"/><path d="M0 -15 L8 2 H3.4 L10 10 H-10 L-3.4 2 H-8 Z" fill="${t.c}"/><path d="M0 -15 L8 2 H3.4 L10 10 H0 Z" fill="${t.dk}" opacity=".55"/><path d="M-1 -11 L-5 -1" stroke="${t.lt}" stroke-width="1.4" opacity=".6" stroke-linecap="round"/><path d="M0 -15 L8 2 H3.4 L10 10 H-10 L-3.4 2 H-8 Z" fill="none" stroke="${t.ink}" stroke-width="1" stroke-linejoin="round" opacity=".8"/>${snow ? '<path d="M0 -15 L4 -7 L1 -8.5 L-2 -6.5 L-4 -7 Z M-6 1 L-2 -1 L2 1 L6 1 L3.4 2 H-3.4 Z" fill="#fff"/>' : ''}</g>`;
}

function poplarTree(x: number, y: number, s: number, hex: string, r: () => number, season: Season): string {
  if (season === 'winter') return pineTree(x, y, s * 0.9, PAL.winter.pine, r, season);
  const t = tones(hex, r);
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(2)})"><ellipse cx="3" cy="9" rx="6" ry="2.4" fill="#3a2e18" opacity=".24"/><rect x="-1" y="3" width="2" height="6" fill="#6a4428"/><ellipse cx="0" cy="-5" rx="4.8" ry="11" fill="${t.c}"/><ellipse cx="1.6" cy="-3" rx="3" ry="8.5" fill="${t.dk}" opacity=".5"/><ellipse cx="-1.6" cy="-9" rx="1.6" ry="4" fill="${t.lt}" opacity=".7"/><ellipse cx="0" cy="-5" rx="4.8" ry="11" fill="none" stroke="${t.ink}" stroke-width="1" opacity=".75"/></g>`;
}

interface TreeSpec {
  pts: Pt[];
  mix: [number, number, number]; // round / pine / poplar weights
  s: [number, number];
}

function paintTrees(specs: TreeSpec[], season: Season, r: () => number): string {
  const P = PAL[season];
  const all: { y: number; svg: string }[] = [];
  for (const sp of specs) {
    for (const [x, y] of sp.pts) {
      const k = r() * (sp.mix[0] + sp.mix[1] + sp.mix[2]);
      const s = sp.s[0] + r() * (sp.s[1] - sp.s[0]);
      const round = P.round[Math.floor(r() * P.round.length)]!;
      const svg = k < sp.mix[0] ? roundTree(x, y, s, round, r, season) : k < sp.mix[0] + sp.mix[1] ? pineTree(x, y, s, P.pine, r, season) : poplarTree(x, y, s, season === 'fall' ? '#e0a83a' : P.round[0]!, r, season);
      all.push({ y, svg });
    }
  }
  return all
    .sort((a, b) => a.y - b.y)
    .map((t) => t.svg)
    .join('');
}

// ── Farmland ────────────────────────────────────────────────────────────────

/** A field quad with crop rows clipped inside. */
function field(id: string, q: Pt[], fill: string, rowCol: string, angle: number, gap: number): string {
  const d = `M${q.map((p) => `${f1(p[0])} ${f1(p[1])}`).join(' L')} Z`;
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let rows = '';
  for (let o = -90; o <= 90; o += gap) rows += `M${cx - 90} ${cy + o} H${cx + 90} `;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${fill}"/><path d="${rows}" stroke="${rowCol}" stroke-width="${(gap * 0.38).toFixed(1)}" stroke-linecap="round" clip-path="url(#${id})" transform="rotate(${angle} ${cx} ${cy})" opacity=".55"/><path d="${d}" fill="none" stroke="#6a4a2a" stroke-width="1" opacity=".35"/>`;
}

function hedge(pts: Pt[], r: () => number, col: string): string {
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0; d < len; d += 4.2) {
      const t = d / len;
      const x = a[0] + (b[0] - a[0]) * t + (r() - 0.5) * 1.6;
      const y = a[1] + (b[1] - a[1]) * t + (r() - 0.5) * 1.6;
      s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${(2.3 + r() * 1.4).toFixed(1)}"/>`;
    }
  }
  return `<g fill="${col}" stroke="#2e4020" stroke-width=".6" stroke-opacity=".5">${s}</g>`;
}

function farmland(season: Season, r: () => number): string {
  const P = PAL[season];
  const F = P.field;
  const rowC = season === 'winter' ? '#c8d2dc' : season === 'fall' ? '#8a5a2a' : '#4e7a2e';
  // Patchwork south of the farm road (the old empty meadow), slightly skewed like hand-drawn plots.
  const grid: Pt[][] = [];
  const xs = [338, 398, 456, 518];
  const ys = [350, 404, 462];
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 3; i++) {
      const jit = (): number => (r() - 0.5) * 8;
      grid.push([
        [xs[i]! + jit() + 3, ys[j]! + jit() + 3],
        [xs[i + 1]! + jit() - 3, ys[j]! + jit() + 3],
        [xs[i + 1]! + jit() - 3, ys[j + 1]! + jit() - 3],
        [xs[i]! + jit() + 3, ys[j + 1]! + jit() - 3],
      ]);
    }
  let s = '';
  grid.forEach((q, i) => (s += field(`mF${i}`, q, F[i % F.length]!, rowC, [8, -30, 70, 20, -60, 0][i]!, 6 + (i % 3))));
  // East fields by the forest edge.
  s += field('mF6', [[640, 376], [700, 370], [708, 424], [644, 430]], F[3]!, rowC, 12, 6);
  s += field('mF7', [[646, 436], [736, 430], [732, 478], [650, 482]], F[1]!, rowC, -8, 7);
  const hc = season === 'winter' ? '#b8c4c8' : season === 'fall' ? '#8a7a3a' : '#4f7a38';
  s += hedge([[334, 346], [522, 346], [522, 466], [334, 466], [334, 350]], r, hc);
  s += hedge([[398, 348], [398, 464]], r, hc) + hedge([[458, 348], [458, 464]], r, hc) + hedge([[336, 404], [520, 404]], r, hc);
  s += hedge([[636, 372], [742, 366], [742, 484]], r, hc);
  // Haystacks + sheep dots.
  if (season !== 'winter') {
    for (const [x, y] of [[372, 386], [488, 438], [690, 452]] as Pt[])
      s += `<g transform="translate(${x} ${y})"><ellipse cx="2" cy="4" rx="7" ry="2.4" fill="#3a2e18" opacity=".22"/><path d="M-6 4 Q-6 -6 0 -7 Q6 -6 6 4 Z" fill="#e8c460" stroke="#8a6420" stroke-width="1"/><path d="M-3 -2 q3 -2 6 0" stroke="#8a6420" stroke-width=".8" fill="none"/></g>`;
    for (const [x, y] of [[424, 426], [432, 432], [418, 436], [440, 420], [684, 396]] as Pt[])
      s += `<g transform="translate(${x} ${y})"><ellipse cx="1" cy="3" rx="4" ry="1.4" fill="#3a2e18" opacity=".2"/><ellipse rx="3.6" ry="2.6" fill="#fffaf0" stroke="#6a5a4a" stroke-width=".8"/><circle cx="3.2" cy="-.6" r="1.3" fill="#3a302a"/></g>`;
  }
  // Orchard: blossom / fruit trees in neat rows.
  const orch: string[] = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 6; i++) {
      const x = 86 + i * 22 + (j % 2) * 8 + (r() - 0.5) * 3;
      const y = 226 + j * 24 + (r() - 0.5) * 3;
      const col = season === 'spring' ? '#f2a6c0' : season === 'summer' ? '#5aa046' : season === 'fall' ? '#d8903a' : '#8a7a6a';
      orch.push(roundTree(x, y, 0.7 + r() * 0.12, col, r, season));
      if (season === 'summer' || season === 'fall') orch.push(`<g fill="${season === 'summer' ? '#e84a3a' : '#f0c040'}"><circle cx="${f1(x - 2.5)}" cy="${f1(y - 3)}" r="1.1"/><circle cx="${f1(x + 2.5)}" cy="${f1(y - 1)}" r="1.1"/></g>`);
    }
  s += `<path d="M76 218 H210 V292 H76 Z" fill="${P.land2}" opacity=".6"/>` + hedge([[72, 214], [212, 214], [212, 292]], r, hc) + orch.join('');
  return s;
}

function windmill(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><ellipse cx="3" cy="14" rx="14" ry="4" fill="#3a2e18" opacity=".24"/><path d="M-8 14 L-5 -12 H5 L8 14 Z" fill="#f2e2c0" stroke="#3b2313" stroke-width="1.5"/><path d="M-7 -12 L0 -20 L7 -12 Z" fill="#b8573e" stroke="#3b2313" stroke-width="1.5"/><rect x="-2" y="6" width="4" height="8" fill="#8a5a36"/><g class="m-mill" transform="translate(0 -12)"><g fill="#fbf0d6" stroke="#5a3418" stroke-width="1.1">${[0, 90, 180, 270].map((a) => `<path d="M0 0 L2.2 -18 L-2.6 -18 L-1 0 Z" transform="rotate(${a})"/>`).join('')}</g><circle r="2.2" fill="#5a3418"/></g></g>`;
}

function bridge(x: number, y: number, rot: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-11" y="-5" width="22" height="10" rx="2.5" fill="#c08850" stroke="#5a3418" stroke-width="1.5"/><path d="M-7 -5 V5 M-2 -5 V5 M3 -5 V5 M8 -5 V5" stroke="#8a5a30" stroke-width="1"/><path d="M-11 -5.5 H11 M-11 5.5 H11" stroke="#5a3418" stroke-width="1.8"/></g>`;
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** Paper, land, water, fields, woods — everything under the houses, labels and pins. */
export function valleyBase(season: Season): { defs: string; under: string; trees: string; paper: string } {
  const P = PAL[season];
  const r = rng(42);
  const land = (x: number, y: number): boolean => y > 38 && y < 505 && x > 26 && x < 980;
  const placed: Pt[] = [];
  const specs: TreeSpec[] = [];
  // Whisperwood: dense Poisson forest in a lumpy ellipse.
  specs.push({ pts: poisson(r, 260, 12.5, [690, 70, 990, 470], (x, y) => land(x, y) && ((x - 850) / 160) ** 2 + ((y - 270) / 200) ** 2 < 1 + Math.sin(x * 0.05) * 0.12, placed), mix: [5, 3, 1], s: [0.8, 1.3] });
  // Northern tree line along the mountains' east shoulder.
  specs.push({ pts: poisson(r, 70, 14, [400, 34, 700, 130], (x, y) => land(x, y) && y < 104 + Math.sin(x * 0.03) * 18, placed), mix: [3, 4, 1], s: [0.7, 1.1] });
  // Foothill pines under the mountains.
  specs.push({ pts: poisson(r, 36, 13, [30, 186, 420, 232], (x, y) => land(x, y) && y > 196 + Math.sin(x * 0.04) * 6, placed), mix: [1, 6, 0], s: [0.7, 1.05] });
  // West copses + pond trees.
  specs.push({ pts: poisson(r, 40, 12, [30, 296, 160, 500], land, placed), mix: [5, 2, 1], s: [0.75, 1.2] });
  // Riverbank poplars + scattered singles across the meadows.
  specs.push({ pts: poisson(r, 22, 26, [300, 120, 700, 510], land, placed), mix: [3, 1, 3], s: [0.75, 1.1] });
  const trees = paintTrees(specs, season, r);

  // Watercolour wash blotches inside the land (value/hue variation — no flat fills).
  let wash = '';
  for (let i = 0; i < 26; i++) {
    const x = 40 + r() * 920;
    const y = 50 + r() * 440;
    wash += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(40 + r() * 90)}" ry="${f1(24 + r() * 50)}" fill="${P.wash[i % P.wash.length]}" opacity="${(0.3 + r() * 0.35).toFixed(2)}" transform="rotate(${f1((r() - 0.5) * 40)} ${f1(x)} ${f1(y)})"/>`;
  }
  // Meadow flowers.
  let dots = '';
  for (let i = 0; i < 140; i++) {
    const x = 40 + r() * 900;
    const y = 120 + r() * 380;
    if (blocked(x, y, 6)) continue;
    dots += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${(0.9 + r() * 1.2).toFixed(1)}" fill="${r() < 0.55 ? P.flower : '#fff8d8'}" opacity=".85"/>`;
  }
  const defs = `
    <filter id="mWc" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter>
    <filter id="mBleed" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="4" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="14" result="d"/><feGaussianBlur in="d" stdDeviation="1.4"/></filter>
    <filter id="mSoft"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="mSoft2" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="mWash" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="mGran" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="4" seed="11"/><feColorMatrix type="matrix" values="0 0 0 0 0.32  0 0 0 0 0.22  0 0 0 0 0.08  0 0 0 1.7 -0.62"/></filter>
    <filter id="mMottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.0045" numOctaves="3" seed="5"/><feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.36  0 0 0 0 0.12  0 0 0 1.5 -0.5"/></filter>
    <filter id="mPaper"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0 0.12  0 0 0 0.22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <clipPath id="mLandClip"><path d="${LAND_D}"/></clipPath>
    <clipPath id="mShade"><path d="M140 130 L200 40 L230 150 Z M270 120 L330 60 L350 170 Z M90 70 L140 130 L120 190 Z M330 60 L410 170 L360 200 Z"/></clipPath>
    <radialGradient id="mSea" cx="50%" cy="100%" r="90%"><stop offset="0" stop-color="#2f7fae"/><stop offset=".55" stop-color="#5aaacc"/><stop offset="1" stop-color="#a4d8e6"/></radialGradient>
    <linearGradient id="mLand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.land2}"/><stop offset=".55" stop-color="${P.land}"/><stop offset="1" stop-color="${P.land}"/></linearGradient>
    <linearGradient id="mMtn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b6a2"/><stop offset="1" stop-color="#7a6c5e"/></linearGradient>
    <radialGradient id="mVig" cx="50%" cy="50%" r="72%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#6a3a14" stop-opacity=".5"/></radialGradient>
    <radialGradient id="mGlow"><stop offset="0" stop-color="#ffe08a" stop-opacity=".9"/><stop offset="1" stop-color="#ffb040" stop-opacity="0"/></radialGradient>`;
  const water = season === 'winter' ? '#b8dcec' : '#7ec4e0';
  const under = `
  <rect width="1000" height="640" fill="#f1dfb4"/>
  <rect width="1000" height="640" filter="url(#mMottle)" style="mix-blend-mode:multiply" opacity=".55"/>
  <g filter="url(#mBleed)">
    <path d="${LAND_D}" fill="url(#mLand)"/>
  </g>
  <g clip-path="url(#mLandClip)"><g filter="url(#mWash)">${wash}</g></g>
  <g filter="url(#mBleed)">
    <path d="${LAND_D}" fill="none" stroke="${P.edge}" stroke-width="18" opacity=".3" clip-path="url(#mLandClip)"/>
    <path d="M0 520 C160 500 300 520 460 506 C600 496 700 520 820 510 C900 504 960 510 1000 520 L1000 560 L0 560 Z" fill="${season === 'winter' ? '#f4ecd8' : '#f2dc9a'}"/>
    <path d="M0 548 C180 530 360 546 520 536 C680 526 820 548 1000 538 V640 H0 Z" fill="url(#mSea)"/>
    <path d="M0 548 C180 530 360 546 520 536 C680 526 820 548 1000 538 V566 C820 574 680 552 520 562 C360 572 180 556 0 574 Z" fill="#c8ecf2" opacity=".6"/>
  </g>
  <path d="${LAND_D}" fill="none" stroke="#5a4020" stroke-width="1.4" opacity=".45" filter="url(#mWc)"/>
  <rect width="1000" height="640" filter="url(#mGran)" clip-path="url(#mLandClip)" style="mix-blend-mode:multiply" opacity=".5"/>
  <path d="M0 546 C180 528 360 544 520 534 C680 524 820 546 1000 536" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="14 6 4 6" opacity=".85"/>
  <g fill="none" stroke="#fff" stroke-linecap="round" opacity=".55">${Array.from({ length: 16 }, (_, i) => `<path d="M${24 + i * 62} ${584 + (i % 3) * 16} q10 -5 20 0 t20 0" stroke-width="2"/>`).join('')}</g>
  <!-- mountains: back range, front range, snow, shade, hatching -->
  <g filter="url(#mWc)">
    <path d="M60 170 L130 52 L180 96 L240 30 L300 88 L370 50 L440 150 L60 180 Z" fill="#c9bcaa" opacity=".8"/>
    <path d="M20 190 L90 70 L140 130 L200 40 L270 120 L330 60 L410 170 L360 200 L20 210 Z" fill="url(#mMtn)" stroke="#5a4a3a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M90 70 L108 100 L96 96 L82 108 Z M200 40 L222 74 L206 70 L190 84 L186 62 Z M330 60 L352 92 L338 88 L322 98 Z" fill="#fff"/>
    <path d="M140 130 L200 40 L230 150 Z M270 120 L330 60 L350 170 Z" fill="#5e5044" opacity=".35"/>
  </g>
  <g clip-path="url(#mShade)" stroke="#3e3026" stroke-width="1.3" stroke-linecap="round" opacity=".5">${Array.from({ length: 44 }, (_, i) => `<path d="M${70 + i * 8} 200 l22 -34"/>`).join('')}</g>
  <path d="M250 124 C246 110 256 100 268 102 C280 104 284 116 280 126 Z" fill="#2a2220" stroke="#3b2313" stroke-width="2.4"/>
  <path d="M246 126 L286 126" stroke="#8a5a2a" stroke-width="4"/>
  <g stroke="#5a3418" stroke-width="1.5"><path d="M236 136 l-10 18 M242 138 l-6 20" /><rect x="222" y="150" width="14" height="8" rx="2" fill="#8a6a4a"/></g>
  <!-- fields, orchard, windmill -->
  <g filter="url(#mWc)">${farmland(season, r)}</g>
  ${windmill(420, 238)}
  <!-- river, stream, lake -->
  <g filter="url(#mWc)" fill="none" stroke-linecap="round">
    <path d="${RIVER.map(bezD).join(' ')}" stroke="#3f7ea8" stroke-width="22" opacity=".45"/>
    <path d="${RIVER.map(bezD).join(' ')}" stroke="${water}" stroke-width="14"/>
    <path d="${bezD(STREAM)} ${bezD(STREAM2)}" stroke="#3f7ea8" stroke-width="9" opacity=".4"/>
    <path d="${bezD(STREAM)} ${bezD(STREAM2)}" stroke="${water}" stroke-width="5.5"/>
  </g>
  <path d="M414 70 C432 122 468 160 496 198" fill="none" stroke="#e8f8ff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <path d="M536 262 C528 290 536 320 556 352" fill="none" stroke="#e8f8ff" stroke-width="2" stroke-linecap="round" opacity=".6"/>
  <ellipse cx="148" cy="448" rx="54" ry="30" fill="${season === 'winter' ? '#cfe6f0' : '#5aa8cc'}" stroke="#2f6a8a" stroke-width="3" filter="url(#mWc)"/>
  <ellipse cx="136" cy="440" rx="22" ry="7" fill="#dff4ff" opacity=".6"/>
  <g stroke="#4f7a38" stroke-width="1.6" stroke-linecap="round">${[
    [104, 456],
    [110, 462],
    [190, 438],
    [196, 444],
  ]
    .map(([x, y]) => `<path d="M${x} ${y} l-2 -8 M${x} ${y} l1 -9 M${x} ${y} l3 -7"/>`)
    .join('')}</g>
  <!-- roads + footpath -->
  <g fill="none" stroke="#c8a070" stroke-linecap="round" stroke-width="9" filter="url(#mWc)" opacity=".95">${ROADS.map((b) => `<path d="${bezD(b)}"/>`).join('')}<path d="${bezD(FOOTPATH)}" stroke-width="5"/></g>
  <g fill="none" stroke="#fff4dc" stroke-linecap="round" stroke-width="2" stroke-dasharray="1 9" opacity=".8">${ROADS.map((b) => `<path d="${bezD(b)}"/>`).join('')}</g>
  <path d="${bezD(FOOTPATH)}" fill="none" stroke="#8a6440" stroke-width="1.4" stroke-dasharray="3 5" opacity=".7"/>
  <g stroke="#5a3418" stroke-width="2"><rect x="514" y="292" width="30" height="14" rx="3" fill="#b07a44" transform="rotate(-8 529 299)"/><rect x="592" y="408" width="30" height="12" rx="3" fill="#b07a44" transform="rotate(-60 607 414)"/></g>
  ${bridge(400, 496, 62)}
  ${dots}`;
  const paper = `
  <rect width="1000" height="640" fill="url(#mVig)" pointer-events="none"/>
  <g pointer-events="none" opacity=".22" style="mix-blend-mode:soft-light"><path d="M500 0 V640" stroke="#fff" stroke-width="4"/><path d="M503.5 0 V640" stroke="#5a3a10" stroke-width="2"/><path d="M0 320 H1000" stroke="#fff" stroke-width="4"/><path d="M0 323.5 H1000" stroke="#5a3a10" stroke-width="2"/></g>
  <rect width="1000" height="640" filter="url(#mPaper)" fill="#fff" pointer-events="none" opacity=".9"/>`;
  return { defs, under, trees, paper };
}
