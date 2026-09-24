/**
 * Procedural painted villager portraits (inline SVG, 200×200) drawn from the same NpcLook as the
 * 3D rig. Layered like a hand-painted bust: painted backdrop (gradient, bokeh, brushy vignette),
 * shoulders with shaded clothing and per-outfit details (apron, coat lapels, vest, scarf, bow tie,
 * stethoscope, shawl, satchel strap), back hair, neck with jaw shadow, face shape (round / long /
 * square / heart), soft cel shading + rim light, ears (+ earrings), eyes with iris gradient,
 * catch-lights and lash line, brows, nose, mouth, blush, freckles / wrinkles, beard styles,
 * glasses with lens glare, eleven front-hair styles and four hats — all with a warm ink outline.
 *
 * Nine moods: neutral, happy, laugh, sad, angry, surprised, blush, worried, thinking — each drives
 * lids, gaze, brows, mouth, blush and little manga marks (tear, sweat drop, anger vein, sparkles).
 */
import type { NpcLook, Mood, Backdrop } from '../data/npcs';

export type { Mood };

const css = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
function shade(h: number, k: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((h >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((h >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((h & 255) * k)));
  return css((r << 16) | (g << 8) | b);
}
function mix(a: number, b: number, t: number): string {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return css((ch(16) << 16) | (ch(8) << 8) | ch(0));
}
/** Warm ink outline for a fill colour. */
const ink = (h: number): string => mix(h, 0x3a1a10, 0.62);

let uid = 0;

interface MoodParams {
  open: number;
  smile: number;
  gazeX: number;
  gazeY: number;
  pupil: number;
  closed: boolean;
  browIn: number;
  browOut: number;
  browRaiseL: number;
  blush: number;
  tilt: number;
}

const MOOD: Record<Mood, MoodParams> = {
  neutral: { open: 1, smile: 0, gazeX: 0, gazeY: 0, pupil: 1, closed: false, browIn: 0, browOut: 0, browRaiseL: 0, blush: 0.45, tilt: 0 },
  happy: { open: 0.92, smile: 0.35, gazeX: 0, gazeY: 0, pupil: 1, closed: false, browIn: -2, browOut: -1, browRaiseL: 0, blush: 0.6, tilt: -2 },
  laugh: { open: 0, smile: 1, gazeX: 0, gazeY: 0, pupil: 1, closed: true, browIn: -4, browOut: -2, browRaiseL: 0, blush: 0.8, tilt: -5 },
  sad: { open: 0.5, smile: 0, gazeX: 0, gazeY: 3, pupil: 1, closed: false, browIn: -7, browOut: 3, browRaiseL: 0, blush: 0.3, tilt: 3 },
  angry: { open: 0.62, smile: 0, gazeX: 0, gazeY: 0, pupil: 0.85, closed: false, browIn: 7, browOut: -4, browRaiseL: 0, blush: 0.75, tilt: 0 },
  surprised: { open: 1.2, smile: 0, gazeX: 0, gazeY: -0.5, pupil: 0.7, closed: false, browIn: -8, browOut: -7, browRaiseL: 0, blush: 0.4, tilt: 0 },
  blush: { open: 0.82, smile: 0.2, gazeX: -3, gazeY: 1.5, pupil: 1.05, closed: false, browIn: -3, browOut: 1, browRaiseL: 0, blush: 1.2, tilt: 4 },
  worried: { open: 0.95, smile: 0, gazeX: 1.5, gazeY: 0, pupil: 0.95, closed: false, browIn: -6, browOut: 3, browRaiseL: 0, blush: 0.35, tilt: 2 },
  thinking: { open: 0.85, smile: 0, gazeX: 3, gazeY: -3, pupil: 1, closed: false, browIn: 0, browOut: 0, browRaiseL: -6, blush: 0.4, tilt: -3 },
};

/**
 * Per-mood body language for the bust: head offset / tilt / scale (leaning in), shoulder lift
 * (+ = dropped), a hand gesture, and the backdrop's colour temperature.
 */
interface Pose {
  dx: number;
  dy: number;
  tilt: number;
  scale: number;
  shoulders: number;
  hand?: 'chin' | 'cheek' | 'fist' | 'mouth' | 'chest';
  tint: string;
  tintA: number;
  rim?: string;
}
const POSE: Record<Mood, Pose> = {
  neutral: { dx: 0, dy: 0, tilt: 0, scale: 1, shoulders: 0, tint: '#fff2d8', tintA: 0.06 },
  happy: { dx: 0, dy: -1.5, tilt: -3, scale: 1, shoulders: -1, tint: '#ffcf6a', tintA: 0.2 },
  laugh: { dx: -1, dy: -5, tilt: -7, scale: 1.01, shoulders: -3, hand: 'mouth', tint: '#ffd27a', tintA: 0.28 },
  sad: { dx: 1, dy: 6, tilt: 6, scale: 0.99, shoulders: 6, tint: '#4a6ab0', tintA: 0.34 },
  angry: { dx: 0, dy: 3.5, tilt: -3, scale: 1.045, shoulders: -2, tint: '#c8342a', tintA: 0.2, rim: '#ff5a3a' },
  surprised: { dx: 0, dy: -6, tilt: 0, scale: 1.02, shoulders: -6, tint: '#fff3a0', tintA: 0.26 },
  blush: { dx: 2.5, dy: 2, tilt: 7, scale: 1, shoulders: -1, hand: 'cheek', tint: '#ff8fb0', tintA: 0.26 },
  worried: { dx: -1.5, dy: 1, tilt: 3, scale: 0.99, shoulders: -3, hand: 'chest', tint: '#7a8ac8', tintA: 0.24 },
  thinking: { dx: 3, dy: -1, tilt: -7, scale: 1, shoulders: 0, hand: 'chin', tint: '#a898e0', tintA: 0.2 },
};

/**
 * Head turn per mood (0 = square to the viewer, 1 ≈ 35° towards the dialogue text on the left):
 * a candid three-quarter view by default, squaring up in surprise or anger, looking away when shy,
 * sad or lost in thought.
 */
const TURN: Record<Mood, number> = { neutral: 0.42, happy: 0.36, laugh: 0.3, sad: 0.62, angry: 0.14, surprised: 0.06, blush: 0.72, worried: 0.46, thinking: 0.66 };
/** Moods whose gaze leaves the viewer (the eyes don't swing back to meet the lens). */
const LOOK_AWAY = new Set<Mood>(['sad', 'blush', 'thinking']);

/**
 * One tapered, curving lock of hair from a base point to a tip: two quadratic edges bowed by
 * `curl` (+ bends clockwise), `wb` wide at the root.
 */
function lock(bx: number, by: number, tx: number, ty: number, wb: number, curl: number): string {
  const dx = tx - bx;
  const dy = ty - by;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const mx = (bx + tx) / 2 + nx * curl;
  const my = (by + ty) / 2 + ny * curl;
  const a = [bx - (nx * wb) / 2, by - (ny * wb) / 2];
  const b = [bx + (nx * wb) / 2, by + (ny * wb) / 2];
  return `M${a[0]!.toFixed(1)} ${a[1]!.toFixed(1)} Q ${(mx - nx * wb * 0.35).toFixed(1)} ${(my - ny * wb * 0.35).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)} Q ${(mx + nx * wb * 0.45).toFixed(1)} ${(my + ny * wb * 0.45).toFixed(1)} ${b[0]!.toFixed(1)} ${b[1]!.toFixed(1)} Z`;
}

/** A set of locks: dark under-layer, gradient fill + ink, and a highlight stroke down each lock. */
function lockSet(id: string, L: NpcLook, specs: [number, number, number, number, number, number][]): string {
  const o = ink(L.hair);
  const under = specs.map(([bx, by, tx, ty, wb, c]) => `<path d="${lock(bx, by + 1.5, tx, ty + 2.5, wb + 3, c)}" fill="${shade(L.hair, 0.55)}"/>`).join('');
  const fill = specs.map(([bx, by, tx, ty, wb, c]) => `<path d="${lock(bx, by, tx, ty, wb, c)}" fill="url(#${id}hr)" stroke="${o}" stroke-width="1.6" stroke-linejoin="round"/>`).join('');
  const hl = specs
    .map(([bx, by, tx, ty, _wb, c]) => {
      const mx = bx + (tx - bx) * 0.45 + c * 0.25;
      const my = by + (ty - by) * 0.45;
      return `<path d="M${(bx + (tx - bx) * 0.15).toFixed(1)} ${(by + (ty - by) * 0.15).toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${(bx + (tx - bx) * 0.7).toFixed(1)} ${(by + (ty - by) * 0.7).toFixed(1)}" stroke="${shade(L.hair, 1.45)}" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>`;
    })
    .join('');
  return under + fill + hl;
}

/** A painted mitten hand (thumb + finger creases) with a sleeve cuff, at x, y, rotated. */
function hand(x: number, y: number, rot: number, skin: number, sleeve: number, fist = false): string {
  const sk = css(skin);
  const o = ink(skin);
  const cuff = `<path d="M-13 14 Q 0 20 13 14 L 14 30 Q 0 36 -14 30 Z" fill="${css(sleeve)}" stroke="${ink(sleeve)}" stroke-width="1.6"/>`;
  const palm = fist
    ? `<path d="M-12 6 C -14 -6, -6 -13, 2 -12 C 11 -11, 14 -3, 12 7 C 10 15, -9 16, -12 6 Z" fill="${sk}" stroke="${o}" stroke-width="1.6"/><path d="M-6 -10 q 3 2 0 6 M0 -11 q 3 2 0 6 M6 -9 q 3 2 0 6" stroke="${shade(skin, 0.68)}" stroke-width="1.3" fill="none"/>`
    : `<path d="M-11 8 C -13 -8, -8 -18, -1 -18 C 8 -18, 12 -9, 11 5 C 10 14, -8 16, -11 8 Z" fill="${sk}" stroke="${o}" stroke-width="1.6"/><path d="M-5 -16 q -1 8 0 13 M1 -17 q 0 8 0 13 M6 -14 q 1 7 0 11" stroke="${shade(skin, 0.7)}" stroke-width="1.2" fill="none"/><path d="M-11 4 q -7 -5 -4 -12 q 5 0 6 7" fill="${sk}" stroke="${o}" stroke-width="1.4"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${rot})">${cuff}${palm}<ellipse cx="-3" cy="-6" rx="4" ry="3" fill="#fff" opacity="0.28"/></g>`;
}

interface Face {
  cx: number;
  top: number;
  chin: number;
  w: number;
  jaw: number;
}

function facePath(f: Face, t = 0): string {
  const { cx, top, chin, w, jaw } = f;
  const cheekY = top + (chin - top) * 0.56;
  // Three-quarter turn: the far (viewer-left) cheek narrows and the chin slides towards the turn.
  const wl = w * (1 - 0.05 * t);
  const wr = w * (1 + 0.02 * t);
  const chx = cx - t * 7;
  return `M${cx - wl} ${cheekY} C ${cx - wl} ${top + 10}, ${cx - wl * 0.55} ${top}, ${cx} ${top} C ${cx + wr * 0.55} ${top}, ${cx + wr} ${top + 10}, ${cx + wr} ${cheekY} C ${cx + wr} ${cheekY + 22 * jaw}, ${chx + wr * (0.35 + 0.3 * jaw)} ${chin - 2}, ${chx} ${chin} C ${chx - wl * (0.35 + 0.3 * jaw) * (1 - 0.3 * t)} ${chin - 2}, ${cx - wl} ${cheekY + 22 * jaw * (1 - 0.25 * t)}, ${cx - wl} ${cheekY} Z`;
}

function eye(id: string, x: number, y: number, side: -1 | 1, m: MoodParams, iris: number, lash: string, skin: number, old: boolean): string {
  const W = 9.5;
  const out: string[] = [];
  if (m.closed) {
    // ^ ^ closed happy eyes
    out.push(`<path d="M${x - W} ${y + 1} Q ${x} ${y - 9} ${x + W} ${y + 1}" stroke="${lash}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`);
    out.push(`<path d="M${x + side * W} ${y + 1} l ${side * 3} -2" stroke="${lash}" stroke-width="2.4" stroke-linecap="round"/>`);
    return out.join('');
  }
  const up = 11.5 * m.open;
  const low = 8.5 - m.smile * 4;
  const sclera = `M${x - W} ${y} Q ${x - W * 0.6} ${y - up} ${x + side * 1} ${y - up} Q ${x + W * 0.8} ${y - up * 0.9} ${x + W} ${y - 1} Q ${x + W * 0.5} ${y + low} ${x} ${y + low} Q ${x - W * 0.6} ${y + low} ${x - W} ${y} Z`;
  out.push(`<clipPath id="${id}c${side}"><path d="${sclera}"/></clipPath>`);
  out.push(`<path d="${sclera}" fill="#fffaf4"/>`);
  const ix = x + m.gazeX + side * 0.3;
  const iy = y - 1 + m.gazeY;
  out.push(`<g clip-path="url(#${id}c${side})">`);
  // Lid shadow on the white
  out.push(`<path d="M${x - W} ${y - up + 1} L ${x + W} ${y - up + 1} L ${x + W} ${y - up + 5} Q ${x} ${y - up + 7} ${x - W} ${y - up + 5} Z" fill="${shade(skin, 0.7)}" opacity="0.35"/>`);
  out.push(`<ellipse cx="${ix}" cy="${iy}" rx="6.6" ry="8" fill="url(#${id}iris)"/>`);
  out.push(`<ellipse cx="${ix}" cy="${iy}" rx="6.6" ry="8" fill="none" stroke="${shade(iris, 0.45)}" stroke-width="1.1"/>`);
  out.push(`<ellipse cx="${ix}" cy="${iy + 0.6}" rx="${3.1 * m.pupil}" ry="${4.2 * m.pupil}" fill="#1a1010"/>`);
  out.push(`<ellipse cx="${ix + 2.4}" cy="${iy - 3.4}" rx="2.3" ry="2.7" fill="#fff"/>`);
  out.push(`<circle cx="${ix - 2.4}" cy="${iy + 3.6}" r="1.2" fill="#fff" opacity="0.85"/>`);
  out.push(`</g>`);
  // Lash line (thicker on the outer corner) + lower lid hint
  out.push(`<path d="M${x - W - 0.5} ${y + 0.5} Q ${x - W * 0.6} ${y - up - 0.8} ${x + side * 1} ${y - up - 0.8} Q ${x + W * 0.8} ${y - up * 0.9 - 0.8} ${x + W + 0.5} ${y - 1}" stroke="${lash}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  out.push(`<path d="M${x + side * W} ${y - (side > 0 ? 1 : 0)} l ${side * 3.2} ${-2.6}" stroke="${lash}" stroke-width="2.4" stroke-linecap="round"/>`);
  out.push(`<path d="M${x - W * 0.7} ${y + low - 0.5} Q ${x} ${y + low + 1.5} ${x + W * 0.7} ${y + low - 0.5}" stroke="${shade(skin, 0.62)}" stroke-width="1.1" fill="none" opacity="0.7"/>`);
  // Crease above the lid
  out.push(`<path d="M${x - W * 0.7} ${y - up - 3.6} Q ${x} ${y - up - 6} ${x + W * 0.8} ${y - up - 3}" stroke="${shade(skin, 0.7)}" stroke-width="1" fill="none" opacity="0.6"/>`);
  if (old) out.push(`<path d="M${x + side * (W + 3)} ${y + 1} l ${side * 4} -2 M${x + side * (W + 3)} ${y + 3.5} l ${side * 4} 1" stroke="${shade(skin, 0.68)}" stroke-width="0.9" opacity="0.8"/>`);
  return out.join('');
}

function brow(x: number, y: number, side: -1 | 1, m: MoodParams, color: string, thick: number): string {
  const inner = y + m.browIn * 0.8;
  const outer = y + m.browOut * 0.8 + (side === -1 ? m.browRaiseL : 0);
  const xi = x - side * 9;
  const xo = x + side * 10;
  return `<path d="M${xi} ${inner} Q ${x} ${Math.min(inner, outer) - 4} ${xo} ${outer + 1}" stroke="${color}" stroke-width="${thick}" fill="none" stroke-linecap="round"/>`;
}

function mouth(mood: Mood, cx: number, y: number, skin: number, beard: boolean): string {
  const lip = shade(skin, 0.62);
  const dark = '#5a1e1a';
  switch (mood) {
    case 'happy':
      return `<path d="M${cx - 11} ${y - 1} Q ${cx} ${y + 13} ${cx + 11} ${y - 1} Q ${cx} ${y + 3} ${cx - 11} ${y - 1} Z" fill="${dark}" stroke="${dark}" stroke-width="1.6" stroke-linejoin="round"/><path d="M${cx - 8} ${y + 0.4} Q ${cx} ${y + 3.4} ${cx + 8} ${y + 0.4} L ${cx + 7} ${y + 2.6} Q ${cx} ${y + 4.6} ${cx - 7} ${y + 2.6} Z" fill="#fff"/><path d="M${cx - 5} ${y + 8} Q ${cx} ${y + 5} ${cx + 5} ${y + 8}" fill="#e87a6a"/>`;
    case 'laugh':
      return `<path d="M${cx - 14} ${y - 3} Q ${cx} ${y + 19} ${cx + 14} ${y - 3} Q ${cx} ${y + 1} ${cx - 14} ${y - 3} Z" fill="${dark}" stroke="${dark}" stroke-width="1.6" stroke-linejoin="round"/><path d="M${cx - 10} ${y - 1} Q ${cx} ${y + 2} ${cx + 10} ${y - 1} L ${cx + 9} ${y + 1.8} Q ${cx} ${y + 4.4} ${cx - 9} ${y + 1.8} Z" fill="#fff"/><path d="M${cx - 7} ${y + 12} Q ${cx} ${y + 6} ${cx + 7} ${y + 12} Q ${cx} ${y + 15} ${cx - 7} ${y + 12} Z" fill="#e8766a"/>`;
    case 'sad':
      return `<path d="M${cx - 8} ${y + 5} Q ${cx} ${y - 2} ${cx + 8} ${y + 5}" stroke="${dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    case 'angry':
      return `<path d="M${cx - 9} ${y + 3} Q ${cx} ${y - 3} ${cx + 9} ${y + 3} L ${cx + 8} ${y + 6} Q ${cx} ${y + 2} ${cx - 8} ${y + 6} Z" fill="${dark}" stroke="${dark}" stroke-width="1.4" stroke-linejoin="round"/><path d="M${cx - 6} ${y + 2.2} L ${cx + 6} ${y + 2.2}" stroke="#fff" stroke-width="1.8"/>`;
    case 'surprised':
      return `<ellipse cx="${cx}" cy="${y + 3}" rx="5.6" ry="7" fill="${dark}"/><ellipse cx="${cx}" cy="${y + 6.5}" rx="3.4" ry="2.4" fill="#e8766a"/>`;
    case 'blush':
      return `<path d="M${cx - 7} ${y + 1} q 3.5 3 7 0 q 3.5 3 7 0" stroke="${dark}" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'worried':
      return `<path d="M${cx - 9} ${y + 3} q 3 -3.5 6 0 q 3 3.5 6 0 q 3 -3.5 6 0" stroke="${dark}" stroke-width="2.3" fill="none" stroke-linecap="round"/>`;
    case 'thinking':
      return `<path d="M${cx - 2} ${y + 2.5} Q ${cx + 5} ${y + 0} ${cx + 10} ${y + 1.5}" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    default:
      return `<path d="M${cx - 8} ${y + 1} Q ${cx} ${y + 6} ${cx + 8} ${y + 1}" stroke="${dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/>${beard ? '' : `<path d="M${cx - 3} ${y + 7.5} Q ${cx} ${y + 8.6} ${cx + 3} ${y + 7.5}" stroke="${lip}" stroke-width="1.2" fill="none" opacity="0.6"/>`}`;
  }
}

/** Soft painted backdrop: gradient, the villager's place out of focus, bokeh, brush strokes, vignette. */
function backdrop(id: string, bg: [number, number], kind?: Backdrop): string {
  const p: string[] = [];
  p.push(`<rect width="200" height="200" fill="url(#${id}bg)"/>`);
  p.push(`<g filter="url(#${id}dof)">${scene(kind, bg)}</g>`);
  for (let i = 0; i < 9; i++) {
    const x = (i * 53 + 17) % 200;
    const y = (i * 37 + 11) % 130;
    p.push(`<circle cx="${x}" cy="${y}" r="${7 + (i % 4) * 5}" fill="#fff" opacity="${0.04 + (i % 3) * 0.03}"/>`);
  }
  // Brushy horizontal strokes + a soft diagonal light shaft.
  for (let i = 0; i < 6; i++) {
    const y = 20 + i * 30;
    p.push(`<path d="M-10 ${y} q 60 ${-8 + (i % 3) * 6} 110 ${2} t 110 ${-4}" stroke="${shade(bg[1], 1.12)}" stroke-width="${10 + (i % 2) * 6}" fill="none" opacity="0.1" stroke-linecap="round"/>`);
  }
  p.push(`<path d="M-20 -10 L 70 -10 L 150 210 L 60 210 Z" fill="url(#${id}shaft)" opacity="0.28"/>`);
  p.push(`<rect width="200" height="200" fill="url(#${id}vig)"/>`);
  return p.join('');
}

/** Out-of-focus place behind each villager (drawn sharp, blurred by the dof filter). */
function scene(kind: Backdrop | undefined, bg: [number, number]): string {
  const s: string[] = [];
  const R = (x: number, y: number, w: number, h: number, c: string, rx = 2, o = 1): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${c}" opacity="${o}"/>`;
  const C = (x: number, y: number, r: number, c: string, o = 1): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`;
  const jar = ['#c8574a', '#e8b84a', '#6a9a5a', '#5a7ab0', '#e89a6a', '#a86ab0', '#f2e2c0'];
  switch (kind) {
    case 'shop':
      s.push(R(0, 0, 200, 200, '#e9c898', 0, 0.55));
      for (const [k, y] of [[0, 54], [1, 108], [2, 162]] as [number, number][]) {
        s.push(R(-4, y, 208, 8, '#7a4a28', 1), R(-4, y + 8, 208, 4, '#5a3418', 0, 0.6));
        for (let i = 0; i < 9; i++) {
          const x = 4 + i * 23 + ((k * 7) % 11);
          const h = 20 + ((i * 7 + k * 3) % 4) * 6;
          const c = jar[(i + k * 3) % jar.length]!;
          s.push(R(x, y - h, 15, h, c, 4), R(x + 2, y - h - 4, 11, 5, '#8a5a32', 1), R(x + 3, y - h + 4, 3, h - 8, '#fff', 1.5, 0.35));
        }
      }
      break;
    case 'bakery':
      s.push(R(0, 0, 200, 200, '#c87a52', 0, 0.8));
      for (let r = 0; r < 14; r++) for (let i = 0; i < 8; i++) s.push(R(i * 28 - (r % 2) * 14, r * 15, 26, 13, r % 3 === 0 ? '#b8663e' : '#d0845a', 2, 0.8));
      s.push(`<path d="M-10 200 L -10 96 Q 34 40 78 96 L 78 200 Z" fill="#3a1c10"/>`, `<ellipse cx="34" cy="150" rx="40" ry="46" fill="#ff9a3a" opacity="0.85"/>`, `<ellipse cx="34" cy="160" rx="24" ry="26" fill="#ffd27a"/>`);
      s.push(R(120, 70, 90, 8, '#6a3a1e', 1));
      for (let i = 0; i < 4; i++) s.push(`<ellipse cx="${136 + i * 20}" cy="62" rx="10" ry="8" fill="#d89048"/><path d="M${130 + i * 20} 60 q 6 -4 12 0" stroke="#f2c47a" stroke-width="2" fill="none"/>`);
      break;
    case 'river':
      s.push(`<path d="M0 110 Q 40 78 90 96 T 200 86 L 200 200 L 0 200 Z" fill="#7aa88a"/>`, `<path d="M0 124 Q 60 104 120 118 T 200 112 L 200 200 L 0 200 Z" fill="#5f9474"/>`);
      s.push(R(0, 140, 200, 60, '#5fa0c4', 0), R(0, 140, 200, 6, '#a8d8e8', 0, 0.7));
      for (let i = 0; i < 12; i++) s.push(R((i * 37) % 190, 150 + ((i * 13) % 44), 16 + (i % 3) * 8, 2.4, '#e8f6ff', 1, 0.7));
      for (const x of [8, 18, 180, 192]) s.push(`<path d="M${x} 200 Q ${x - 3} 150 ${x + 4} 118" stroke="#4a7a3a" stroke-width="3" fill="none"/><ellipse cx="${x + 4}" cy="124" rx="3" ry="9" fill="#7a4a2a"/>`);
      s.push(`<ellipse cx="46" cy="30" rx="30" ry="10" fill="#fff" opacity="0.7"/><ellipse cx="160" cy="44" rx="24" ry="8" fill="#fff" opacity="0.6"/>`);
      break;
    case 'forge':
      s.push(R(0, 0, 200, 200, '#3a2218', 0), `<ellipse cx="30" cy="170" rx="90" ry="70" fill="#ff7a2a" opacity="0.55"/>`, `<ellipse cx="30" cy="176" rx="46" ry="34" fill="#ffc05a" opacity="0.8"/>`);
      for (let i = 0; i < 26; i++) s.push(C((i * 41 + 7) % 200, (i * 29 + 13) % 150, 1.4 + (i % 3), i % 2 ? '#ffd27a' : '#ff9a3a', 0.9));
      s.push(`<path d="M150 30 L 156 110 M 170 26 L 166 108 M 146 28 L 176 28" stroke="#1a100a" stroke-width="5" stroke-linecap="round"/><path d="M130 150 L 200 150 L 196 164 L 180 166 L 184 200 L 146 200 L 150 166 L 134 162 Z" fill="#1e1410"/>`);
      break;
    case 'clinic':
      s.push(R(0, 0, 200, 200, '#cfe6de', 0), R(0, 130, 200, 70, '#9ac2b4', 0), R(0, 128, 200, 5, '#f4fbf8', 0));
      s.push(R(128, 18, 70, 92, '#f6fbff', 3), R(134, 24, 58, 80, '#bfe0f4', 2), `<path d="M163 24 V 104 M 134 64 H 192" stroke="#f6fbff" stroke-width="5"/>`);
      s.push(`<path d="M120 12 Q 130 70 122 118 L 138 118 Q 132 60 140 12 Z M200 12 Q 190 70 198 118 L 210 118 L 210 12 Z" fill="#f2e2c8"/>`);
      s.push(R(16, 104, 30, 30, '#c87a52', 4), `<ellipse cx="31" cy="92" rx="22" ry="20" fill="#5f9a5a"/><ellipse cx="22" cy="80" rx="12" ry="14" fill="#7ab86a"/>`);
      break;
    case 'inn':
      s.push(R(0, 0, 200, 200, '#7a4a2a', 0));
      for (let i = 0; i < 9; i++) s.push(R(i * 24, 0, 22, 200, i % 2 ? '#8a5632' : '#6e4024', 1, 0.9));
      s.push(R(0, 116, 200, 8, '#4a2a16', 1));
      for (let i = 0; i < 7; i++) s.push(R(10 + i * 28, 84, 10, 32, ['#3f7a5a', '#8a3a2a', '#c8a04a', '#4a5a8a'][i % 4]!, 3), R(12 + i * 28, 76, 6, 9, '#3a2a1a', 1));
      for (const [x, y] of [[38, 30], [158, 22], [100, 8]] as [number, number][]) s.push(C(x, y, 26, '#ffb85a', 0.35), C(x, y, 11, '#ffe0a0', 0.95));
      break;
    case 'hall':
      s.push(`<rect width="200" height="200" fill="#5a4a7a"/><rect y="90" width="200" height="110" fill="#e8946a" opacity="0.55"/>`);
      for (let i = 0; i < 16; i++) s.push(C((i * 47 + 11) % 200, (i * 23 + 5) % 80, 1 + (i % 2), '#fff6d8', 0.9));
      s.push(`<path d="M20 200 L 20 120 L 70 92 L 120 120 L 120 200 Z M 140 200 L 140 70 L 160 52 L 180 70 L 180 200 Z" fill="#2e2440"/><rect x="152" y="80" width="16" height="16" rx="3" fill="#ffcf7a" opacity="0.75"/>`);
      s.push(C(160, 88, 20, '#ffcf7a', 0.25));
      break;
    case 'meadow':
      s.push(`<ellipse cx="40" cy="40" rx="36" ry="13" fill="#fff" opacity="0.85"/><ellipse cx="62" cy="34" rx="22" ry="12" fill="#fff" opacity="0.85"/><ellipse cx="164" cy="56" rx="30" ry="10" fill="#fff" opacity="0.8"/>`);
      s.push(`<path d="M0 132 Q 60 104 120 124 T 200 116 L 200 200 L 0 200 Z" fill="#8ec46a"/><path d="M0 156 Q 70 136 140 152 T 200 146 L 200 200 L 0 200 Z" fill="#6aa84a"/>`);
      for (let i = 0; i < 18; i++) s.push(C((i * 31 + 5) % 200, 140 + ((i * 17) % 56), 2.4, ['#fff', '#ffd166', '#ff8fab'][i % 3]!));
      s.push(`<path d="M168 96 q -8 -8 -10 2 q 8 4 10 -2 q 8 -8 10 2 q -8 4 -10 -2" fill="#ffb14a"/>`);
      break;
    case 'workshop':
      s.push(R(0, 0, 200, 200, '#d8b884', 0));
      for (let i = 0; i < 12; i++) s.push(R(0, i * 17, 200, 15, i % 2 ? '#e2c290' : '#cfa874', 1, 0.9));
      s.push(`<path d="M140 30 L 196 30 L 190 52 L 146 52 Z" fill="#9aa4ac"/><path d="M146 52 l 4 6 l 4 -6 l 4 6 l 4 -6 l 4 6 l 4 -6 l 4 6 l 4 -6 l 4 6" stroke="#7a848c" stroke-width="2" fill="none"/><rect x="128" y="32" width="14" height="18" rx="4" fill="#8a4a2a"/>`);
      s.push(`<path d="M20 40 L 20 96" stroke="#6a4424" stroke-width="6" stroke-linecap="round"/><rect x="8" y="30" width="26" height="12" rx="3" fill="#5a5a62"/>`);
      for (let i = 0; i < 8; i++) s.push(`<path d="M${10 + i * 24} 190 q 6 -8 12 0" stroke="#f2dcae" stroke-width="3" fill="none"/>`);
      break;
    case 'garden':
      for (let i = -4; i < 12; i++) s.push(`<path d="M${i * 22} 0 L ${i * 22 + 120} 200 M ${i * 22 + 120} 0 L ${i * 22} 200" stroke="#f4ecd8" stroke-width="3" opacity="0.6"/>`);
      for (let i = 0; i < 22; i++) {
        const x = (i * 43 + 9) % 200;
        const y = (i * 31 + 7) % 190;
        s.push(`<ellipse cx="${x}" cy="${y}" rx="11" ry="7" fill="#6a9a5a" opacity="0.7" transform="rotate(${(i * 47) % 180} ${x} ${y})"/>`);
        if (i % 2 === 0) s.push(C(x + 6, y - 4, 7 + (i % 3) * 2, ['#ff8fab', '#fff0f4', '#ffd166', '#e86a8a'][i % 4]!));
      }
      break;
    default:
      s.push(C(40, 40, 30, shade(bg[0], 1.1), 0.5));
  }
  return s.join('');
}

function backHair(id: string, L: NpcLook, f: Face): string {
  const H = `url(#${id}hr)`;
  const o = ink(L.hair);
  const s = `stroke="${o}" stroke-width="1.8" stroke-linejoin="round"`;
  const { cx, top, w } = f;
  switch (L.hairStyle) {
    case 'bob':
      return `<path d="M${cx - w - 8} ${top + 44} Q ${cx - w - 10} ${top + 104} ${cx - w + 12} ${top + 108} L ${cx + w - 12} ${top + 108} Q ${cx + w + 10} ${top + 104} ${cx + w + 8} ${top + 44} Q ${cx} ${top - 30} ${cx - w - 8} ${top + 44} Z" fill="${H}" ${s}/>`;
    case 'bun':
      return `<circle cx="${cx}" cy="${top - 6}" r="21" fill="${H}" ${s}/><path d="M${cx - 12} ${top - 14} q 12 -8 24 0" stroke="${shade(L.hair, 1.35)}" stroke-width="3" fill="none" opacity="0.5" stroke-linecap="round"/><path d="M${cx - 20} ${top + 2} q 20 6 40 0" stroke="${shade(L.top, 0.9)}" stroke-width="4" fill="none"/>`;
    case 'curly': {
      const c: string[] = [];
      for (let i = 0; i < 16; i++) {
        const a = Math.PI * (0.95 + (i / 15) * 1.1);
        const r = w + 14;
        c.push(`<circle cx="${cx + Math.cos(a) * r}" cy="${top + 48 + Math.sin(a) * (r + 6)}" r="${15 + (i % 3) * 3}" fill="${H}" ${s}/>`);
      }
      for (let i = 0; i < 6; i++) c.push(`<circle cx="${cx + (i < 3 ? -1 : 1) * (w + 6 + (i % 3) * 3)}" cy="${top + 70 + (i % 3) * 18}" r="${12 - (i % 3)}" fill="${H}" ${s}/>`);
      return c.join('');
    }
    case 'long':
      return `<path d="M${cx - w - 6} ${top + 40} Q ${cx - w - 16} ${top + 120} ${cx - w - 4} ${top + 150} L ${cx + w + 4} ${top + 150} Q ${cx + w + 16} ${top + 120} ${cx + w + 6} ${top + 40} Q ${cx} ${top - 28} ${cx - w - 6} ${top + 40} Z" fill="${H}" ${s}/>`;
    case 'ponytail':
      return `<path d="M${cx + w - 6} ${top + 22} Q ${cx + w + 34} ${top + 30} ${cx + w + 24} ${top + 96} Q ${cx + w + 20} ${top + 112} ${cx + w + 8} ${top + 118} Q ${cx + w + 16} ${top + 80} ${cx + w - 2} ${top + 46} Z" fill="${H}" ${s}/><path d="M${cx + w + 10} ${top + 50} q 10 20 4 50" stroke="${shade(L.hair, 1.3)}" stroke-width="2.4" fill="none" opacity="0.5"/>`;
    case 'spiky':
    case 'short':
      // Crown dome behind the spikes / fringe so no scalp shows between them.
      return `<path d="M${cx - w - 3} ${top + 44} Q ${cx - w - 6} ${top - 6} ${cx} ${top - 8} Q ${cx + w + 6} ${top - 6} ${cx + w + 3} ${top + 44} Z" fill="${shade(L.hair, 0.8)}" ${s}/>`;
    default:
      return '';
  }
}

function frontHair(id: string, L: NpcLook, f: Face): string {
  const H = `url(#${id}hr)`;
  const o = ink(L.hair);
  const s = `stroke="${o}" stroke-width="1.8" stroke-linejoin="round"`;
  const hl = shade(L.hair, 1.4);
  const { cx, top, w } = f;
  const t = top;
  const strands = (d: string): string => `<path d="${d}" stroke="${hl}" stroke-width="2.4" fill="none" opacity="0.45" stroke-linecap="round"/>`;
  switch (L.hairStyle) {
    case 'bun':
      return `<path d="M${cx - w - 2} ${t + 46} Q ${cx - w - 4} ${t + 2} ${cx} ${t} Q ${cx + w + 4} ${t + 2} ${cx + w + 2} ${t + 46} Q ${cx + w - 6} ${t + 22} ${cx + 16} ${t + 18} Q ${cx + 2} ${t + 30} ${cx - 18} ${t + 26} Q ${cx - w + 4} ${t + 26} ${cx - w - 2} ${t + 46} Z" fill="${H}" ${s}/>` + `<path d="M${cx - w - 2} ${t + 44} Q ${cx - w - 6} ${t + 62} ${cx - w + 2} ${t + 72} Q ${cx - w + 2} ${t + 58} ${cx - w + 4} ${t + 46} Z M${cx + w + 2} ${t + 44} Q ${cx + w + 6} ${t + 62} ${cx + w - 2} ${t + 72} Q ${cx + w - 2} ${t + 58} ${cx + w - 4} ${t + 46} Z" fill="${H}" ${s}/>` + strands(`M${cx - 26} ${t + 8} Q ${cx - 6} ${t + 2} ${cx + 18} ${t + 8}`);
    case 'bob':
      return (
        `<path d="M${cx - w - 6} ${t + 58} Q ${cx - w - 8} ${t - 2} ${cx} ${t - 4} Q ${cx + w + 8} ${t - 2} ${cx + w + 6} ${t + 58} Q ${cx + w - 2} ${t + 30} ${cx + 20} ${t + 18} Q ${cx} ${t + 12} ${cx - 22} ${t + 18} Q ${cx - w + 2} ${t + 30} ${cx - w - 6} ${t + 58} Z" fill="${H}" ${s}/>` +
        lockSet(id, L, [
          [cx - w + 2, t + 10, cx - w - 2, t + 54, 16, -3],
          [cx - 22, t + 2, cx - 30, t + 34, 18, -4],
          [cx - 6, t, cx - 12, t + 32, 19, -5],
          [cx + 10, t + 1, cx + 6, t + 30, 18, -5],
          [cx + 25, t + 4, cx + 26, t + 32, 16, 3],
          [cx + w - 2, t + 12, cx + w + 2, t + 54, 15, 3],
        ]) +
        strands(`M${cx - 30} ${t + 8} Q ${cx - 4} ${t - 4} ${cx + 22} ${t + 6}`)
      );
    case 'cap':
      return `<path d="M${cx - w - 2} ${t + 54} Q ${cx - w - 2} ${t + 30} ${cx - w + 8} ${t + 22} L ${cx - w + 16} ${t + 24} Q ${cx - w + 8} ${t + 36} ${cx - w + 6} ${t + 54} Z M${cx + w + 2} ${t + 54} Q ${cx + w + 2} ${t + 30} ${cx + w - 8} ${t + 22} L ${cx + w - 16} ${t + 24} Q ${cx + w - 8} ${t + 36} ${cx + w - 6} ${t + 54} Z M${cx - 26} ${t + 22} Q ${cx - 14} ${t + 34} ${cx - 4} ${t + 24} Q ${cx + 8} ${t + 32} ${cx + 20} ${t + 23} Z" fill="${H}" ${s}/>` + `<rect x="${cx - w - 4}" y="${t + 8}" width="${2 * w + 8}" height="18" rx="7" fill="#f3ece0" stroke="${ink(0xf3ece0)}" stroke-width="1.6"/>` + `<path d="M${cx - w - 10} ${t + 12} Q ${cx - w - 16} ${t - 30} ${cx - 22} ${t - 36} Q ${cx - 2} ${t - 54} ${cx + 22} ${t - 38} Q ${cx + w + 18} ${t - 34} ${cx + w + 10} ${t + 12} Z" fill="#fbf7ee" stroke="${ink(0xfbf7ee)}" stroke-width="1.8"/>` + `<path d="M${cx - 30} ${t - 14} Q ${cx - 12} ${t - 30} ${cx + 4} ${t - 20} M${cx + 8} ${t - 26} Q ${cx + 22} ${t - 30} ${cx + 30} ${t - 14}" stroke="#e6dccb" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    case 'curly': {
      const c: string[] = [];
      for (let i = 0; i < 9; i++) {
        const x = cx - w + 4 + i * ((2 * w - 8) / 8);
        const y = t + 14 + Math.abs(i - 4) * 3 + (i % 2) * 5;
        c.push(`<circle cx="${x}" cy="${y}" r="${11 + (i % 3) * 2}" fill="${H}" ${s}/>`);
      }
      for (let i = 0; i < 5; i++) c.push(`<path d="M${cx - w + 10 + i * 18} ${t + 10} q 4 -4 8 0" stroke="${hl}" stroke-width="2" fill="none" opacity="0.5"/>`);
      return c.join('');
    }
    case 'ponytail':
      return `<path d="M${cx - w - 2} ${t + 50} Q ${cx - w - 4} ${t} ${cx} ${t - 2} Q ${cx + w + 4} ${t} ${cx + w + 2} ${t + 44} Q ${cx + w - 8} ${t + 18} ${cx + 10} ${t + 20} Q ${cx - 18} ${t + 22} ${cx - 30} ${t + 40} Q ${cx - 34} ${t + 30} ${cx - w + 2} ${t + 34} Z" fill="${H}" ${s}/>` + strands(`M${cx - 20} ${t + 8} Q ${cx + 4} ${t} ${cx + 26} ${t + 12}`) + `<circle cx="${cx + w - 4}" cy="${t + 22}" r="5" fill="${shade(L.top, 0.9)}" stroke="${ink(L.top)}" stroke-width="1.4"/>`;
    case 'long':
      return `<path d="M${cx - w - 6} ${t + 80} Q ${cx - w - 8} ${t} ${cx} ${t - 3} Q ${cx + w + 8} ${t} ${cx + w + 6} ${t + 80} Q ${cx + w - 4} ${t + 40} ${cx + w - 12} ${t + 30} Q ${cx + 10} ${t + 20} ${cx + 2} ${t + 8} Q ${cx - 10} ${t + 22} ${cx - w + 12} ${t + 30} Q ${cx - w + 4} ${t + 40} ${cx - w - 6} ${t + 80} Z" fill="${H}" ${s}/>` + strands(`M${cx - 6} ${t + 6} Q ${cx - 24} ${t + 14} ${cx - 34} ${t + 40}`) + strands(`M${cx + 8} ${t + 6} Q ${cx + 26} ${t + 14} ${cx + 36} ${t + 40}`);
    case 'bald':
      return `<path d="M${cx - w - 2} ${t + 58} Q ${cx - w - 4} ${t + 36} ${cx - w + 6} ${t + 30} Q ${cx - w + 4} ${t + 44} ${cx - w + 6} ${t + 58} Z M${cx + w + 2} ${t + 58} Q ${cx + w + 4} ${t + 36} ${cx + w - 6} ${t + 30} Q ${cx + w - 4} ${t + 44} ${cx + w - 6} ${t + 58} Z" fill="${H}" ${s}/><ellipse cx="${cx - 12}" cy="${t + 12}" rx="14" ry="6" fill="#fff" opacity="0.35" transform="rotate(-15 ${cx - 12} ${t + 12})"/>`;
    case 'spiky': {
      // Messy mop: a rounded crown mass with a few soft flicks (a cowlick, a tuft over each ear)
      // and a thick fringe that sweeps across the brow in one direction.
      const flicks: [number, number, number, number, number, number][] = [
        [cx - 14, t - 2, cx - 34, t - 16, 17, -10],
        [cx + 4, t - 6, cx - 2, t - 26, 15, -9],
        [cx + w - 8, t + 16, cx + w + 12, t + 6, 16, 8],
        [cx - w + 6, t + 20, cx - w - 12, t + 12, 16, -8],
      ];
      const mop = `<path d="M${cx - w - 4} ${t + 44} Q ${cx - w - 10} ${t - 8} ${cx - 6} ${t - 12} Q ${cx + w + 10} ${t - 12} ${cx + w + 4} ${t + 42} Q ${cx} ${t + 12} ${cx - w - 4} ${t + 44} Z" fill="url(#${id}hr)" ${s}/>`;
      const fringe: [number, number, number, number, number, number][] = [
        [cx + w - 8, t + 8, cx + w - 2, t + 44, 16, 4],
        [cx + 24, t + 2, cx + 12, t + 36, 20, -7],
        [cx + 6, t, cx - 10, t + 35, 21, -8],
        [cx - 12, t + 2, cx - 30, t + 33, 20, -8],
        [cx - w + 8, t + 10, cx - w - 1, t + 46, 16, -5],
      ];
      return lockSet(id, L, flicks) + mop + lockSet(id, L, fringe);
    }
    case 'braids':
      return `<path d="M${cx - w - 2} ${t + 48} Q ${cx - w - 4} ${t} ${cx} ${t - 2} Q ${cx + w + 4} ${t} ${cx + w + 2} ${t + 48} Q ${cx + w - 6} ${t + 24} ${cx + 2} ${t + 18} Q ${cx - w + 6} ${t + 24} ${cx - w - 2} ${t + 48} Z" fill="${H}" ${s}/><path d="M${cx + 2} ${t + 2} L ${cx + 2} ${t + 18}" stroke="${shade(L.hair, 0.6)}" stroke-width="1.6"/>`;
    case 'slick':
      return `<path d="M${cx - w - 2} ${t + 46} Q ${cx - w - 4} ${t - 2} ${cx + 6} ${t - 4} Q ${cx + w + 6} ${t} ${cx + w + 2} ${t + 42} Q ${cx + w - 2} ${t + 20} ${cx + 20} ${t + 14} Q ${cx - 10} ${t + 12} ${cx - 24} ${t + 22} Q ${cx - w + 2} ${t + 28} ${cx - w - 2} ${t + 46} Z" fill="${H}" ${s}/>` + `<path d="M${cx - 18} ${t + 4} Q ${cx + 4} ${t - 4} ${cx + 30} ${t + 8}" stroke="${hl}" stroke-width="3" fill="none" opacity="0.55" stroke-linecap="round"/><path d="M${cx - 22} ${t + 2} Q ${cx - 20} ${t + 10} ${cx - 24} ${t + 20}" stroke="${shade(L.hair, 0.6)}" stroke-width="1.4" fill="none"/>`;
    default:
      if (L.hat === 'flatcap' || L.hat === 'beanie' || L.hat === 'bandana') return `<path d="M${cx - w - 2} ${t + 56} Q ${cx - w - 2} ${t + 36} ${cx - w + 8} ${t + 30} L ${cx - w + 6} ${t + 56} Z M${cx + w + 2} ${t + 56} Q ${cx + w + 2} ${t + 36} ${cx + w - 8} ${t + 30} L ${cx + w - 6} ${t + 56} Z" fill="${H}" ${s}/>`;
      return (
        `<path d="M${cx - w - 2} ${t + 50} Q ${cx - w - 6} ${t - 2} ${cx} ${t - 4} Q ${cx + w + 6} ${t - 2} ${cx + w + 2} ${t + 50} Q ${cx + w - 4} ${t + 22} ${cx} ${t + 16} Q ${cx - w + 2} ${t + 24} ${cx - w - 2} ${t + 50} Z" fill="${H}" ${s}/>` +
        lockSet(id, L, [
          [cx - w + 4, t + 8, cx - w + 2, t + 40, 15, -3],
          [cx - 18, t + 2, cx - 24, t + 30, 18, -5],
          [cx - 2, t, cx - 10, t + 28, 19, -6],
          [cx + 14, t + 2, cx + 8, t + 26, 18, -6],
          [cx + 28, t + 8, cx + 30, t + 32, 15, 3],
        ]) +
        strands(`M${cx - 22} ${t + 4} Q ${cx} ${t - 4} ${cx + 22} ${t + 4}`)
      );
  }
}

function hat(L: NpcLook, f: Face): string {
  const c = L.hatColor ?? 0x5a6a5a;
  const o = ink(c);
  const s = `stroke="${o}" stroke-width="1.8" stroke-linejoin="round"`;
  const { cx, top, w } = f;
  switch (L.hat) {
    case 'flatcap':
      return `<path d="M${cx - w - 6} ${top + 26} Q ${cx - w - 4} ${top - 16} ${cx + 4} ${top - 14} Q ${cx + w + 10} ${top - 12} ${cx + w + 6} ${top + 24} Z" fill="${css(c)}" ${s}/><path d="M${cx - w + 2} ${top + 22} Q ${cx - 4} ${top + 14} ${cx + w + 12} ${top + 26} Q ${cx + 4} ${top + 34} ${cx - w + 2} ${top + 28} Z" fill="${shade(c, 0.78)}" ${s}/><path d="M${cx - 24} ${top - 4} Q ${cx} ${top - 12} ${cx + 26} ${top - 2}" stroke="${shade(c, 1.25)}" stroke-width="2.4" fill="none" opacity="0.6"/><circle cx="${cx + 2}" cy="${top - 13}" r="3" fill="${shade(c, 0.8)}"/>`;
    case 'beanie': {
      const ribs: string[] = [];
      for (let i = 0; i < 12; i++) {
        const x = cx - w - 2 + i * ((2 * w + 4) / 11);
        ribs.push(`<path d="M${x} ${top + 12} L ${x} ${top + 28}" stroke="${shade(c, 0.78)}" stroke-width="2"/>`);
      }
      return `<path d="M${cx - w - 4} ${top + 16} Q ${cx - w - 2} ${top - 34} ${cx} ${top - 34} Q ${cx + w + 2} ${top - 34} ${cx + w + 4} ${top + 16} Z" fill="${css(c)}" ${s}/><rect x="${cx - w - 6}" y="${top + 10}" width="${2 * w + 12}" height="20" rx="8" fill="${shade(c, 0.9)}" ${s}/>${ribs.join('')}<path d="M${cx - 22} ${top - 14} q 10 -10 22 -10" stroke="${shade(c, 1.3)}" stroke-width="3" fill="none" opacity="0.5" stroke-linecap="round"/>`;
    }
    case 'sunhat': {
      const b = shade(c, 1.04);
      return `<ellipse cx="${cx}" cy="${top + 12}" rx="${w + 42}" ry="17" fill="${b}" ${s}/><path d="M${cx - w + 2} ${top + 12} Q ${cx - w} ${top - 30} ${cx} ${top - 30} Q ${cx + w} ${top - 30} ${cx + w - 2} ${top + 12} Z" fill="${css(c)}" ${s}/><path d="M${cx - w + 1} ${top + 2} Q ${cx} ${top + 8} ${cx + w - 1} ${top + 2} L ${cx + w - 1} ${top + 10} Q ${cx} ${top + 16} ${cx - w + 1} ${top + 10} Z" fill="${css(L.scarf ?? 0xa8587a)}"/><circle cx="${cx + w - 10}" cy="${top + 2}" r="6" fill="#ff8fab" stroke="${ink(0xff8fab)}" stroke-width="1.2"/><circle cx="${cx + w - 20}" cy="${top + 6}" r="4.5" fill="#ffd166" stroke="${ink(0xffd166)}" stroke-width="1.2"/>` + Array.from({ length: 8 }, (_, i) => `<path d="M${cx - w - 30 + i * 12} ${top + 18} q 6 3 12 0" stroke="${shade(c, 0.82)}" stroke-width="1.2" fill="none"/>`).join('');
    }
    case 'bandana': {
      const dots = Array.from({ length: 9 }, (_, i) => `<circle cx="${cx - w + 8 + (i % 5) * ((2 * w - 16) / 4)}" cy="${top + 4 - (i >= 5 ? 16 : 0) + Math.abs((i % 5) - 2) * 2}" r="2.6" fill="#f6ecd8" opacity="0.9"/>`).join('');
      return `<path d="M${cx - w - 5} ${top + 26} Q ${cx - w - 2} ${top - 24} ${cx} ${top - 24} Q ${cx + w + 2} ${top - 24} ${cx + w + 5} ${top + 26} Q ${cx} ${top + 12} ${cx - w - 5} ${top + 26} Z" fill="${css(c)}" ${s}/>${dots}<path d="M${cx + w - 2} ${top + 14} q 14 -4 18 8 q -8 2 -12 12 q -4 -10 -6 -20 Z" fill="${shade(c, 0.85)}" ${s}/>`;
    }
    default:
      return '';
  }
}

function clothing(id: string, L: NpcLook, sw: number): string {
  const p: string[] = [];
  const topC = L.coat ?? L.top;
  const o = ink(topC);
  // Shoulders
  p.push(`<path d="M${100 - sw - 22} 200 C ${100 - sw - 14} 160 ${100 - sw + 4} 146 100 144 C ${100 + sw - 4} 146 ${100 + sw + 14} 160 ${100 + sw + 22} 200 Z" fill="url(#${id}top)" stroke="${o}" stroke-width="2"/>`);
  // Two-tone cloth: crisp fold wedges under the arms, a centre drape and a lit shoulder edge.
  p.push(`<path d="M${100 - sw - 4} 184 Q ${100 - sw + 8} 176 ${100 - sw + 14} 160 Q ${100 - sw + 12} 182 ${100 - sw + 16} 200 L ${100 - sw - 2} 200 Z" fill="${shade(topC, 0.8)}"/>`);
  p.push(`<path d="M${100 + sw + 4} 184 Q ${100 + sw - 8} 176 ${100 + sw - 14} 160 Q ${100 + sw - 12} 182 ${100 + sw - 16} 200 L ${100 + sw + 2} 200 Z" fill="${shade(topC, 0.74)}"/>`);
  p.push(`<path d="M${100 - 10} 172 q 4 14 2 28 M${100 + 16} 176 q -2 12 1 24" stroke="${shade(topC, 0.76)}" stroke-width="2.6" fill="none" opacity="0.6" stroke-linecap="round"/>`);
  p.push(`<path d="M${100 - sw - 14} 186 C ${100 - sw - 8} 162 ${100 - sw + 6} 150 ${100 - 26} 147" stroke="${shade(topC, 1.22)}" stroke-width="3" fill="none" opacity="0.55" stroke-linecap="round"/>`);
  if (L.coat !== undefined) {
    // Shirt + lapels
    p.push(`<path d="M86 146 L 100 178 L 114 146 Z" fill="${css(L.top)}" stroke="${ink(L.top)}" stroke-width="1.6"/>`);
    p.push(`<path d="M84 146 L 100 182 L 92 200 L 76 200 Q 74 170 84 146 Z M116 146 L 100 182 L 108 200 L 124 200 Q 126 170 116 146 Z" fill="${shade(L.coat, 0.92)}" stroke="${o}" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  if (L.vest !== undefined) {
    p.push(`<path d="M${100 - sw * 0.7} 200 L ${100 - sw * 0.62} 158 Q 90 150 96 172 L 100 200 Z M${100 + sw * 0.7} 200 L ${100 + sw * 0.62} 158 Q 110 150 104 172 L 100 200 Z" fill="${css(L.vest)}" stroke="${ink(L.vest)}" stroke-width="1.8" stroke-linejoin="round"/>`);
    p.push(`<circle cx="94" cy="184" r="2.4" fill="#e8c86a"/><circle cx="106" cy="184" r="2.4" fill="#e8c86a"/>`);
    p.push(`<path d="M88 146 L 100 160 L 112 146" stroke="${ink(L.top)}" stroke-width="1.8" fill="#fff8ec"/>`);
  }
  if (L.apron !== undefined) {
    // Bib apron: curved bib with a stitched hem and soft folds, neck straps, a patch pocket.
    const a0 = 100 - sw * 0.44;
    const a1 = 100 + sw * 0.44;
    p.push(`<path d="M${100 - sw * 0.58} 200 C ${100 - sw * 0.52} 184 ${a0 - 2} 172 ${a0} 161 Q 100 155 ${a1} 161 C ${a1 + 2} 172 ${100 + sw * 0.52} 184 ${100 + sw * 0.58} 200 Z" fill="${css(L.apron)}" stroke="${ink(L.apron)}" stroke-width="1.8" stroke-linejoin="round"/>`);
    p.push(`<path d="M${a0 + 4} 165 Q 100 159.5 ${a1 - 4} 165" stroke="${shade(L.apron, 0.72)}" stroke-width="1.1" stroke-dasharray="2.4 2.2" fill="none"/>`);
    p.push(`<path d="M${100 - sw * 0.2} 170 q -3 14 -1 30 M${100 + sw * 0.26} 172 q 4 12 2 28" stroke="${shade(L.apron, 0.8)}" stroke-width="3" fill="none" opacity="0.45" stroke-linecap="round"/>`);
    p.push(`<path d="M${a0} 161 L 85 146 M ${a1} 161 L 115 146" stroke="${shade(L.apron, 0.78)}" stroke-width="4.5" stroke-linecap="round"/>`);
    p.push(`<path d="M${100 - 15} 183 Q 100 186 ${100 + 15} 183 L ${100 + 14} 199 Q 100 201 ${100 - 14} 199 Z" fill="${shade(L.apron, 0.93)}" stroke="${ink(L.apron)}" stroke-width="1.2" stroke-linejoin="round"/>`);
    p.push(`<path d="M${100 - 12} 186.5 Q 100 189 ${100 + 12} 186.5" stroke="${shade(L.apron, 0.7)}" stroke-width="1" stroke-dasharray="2 2" fill="none"/>`);
  }
  if (!L.coat && !L.vest && !L.apron) {
    // Collar + buttons
    p.push(`<path d="M86 146 L 100 158 L 114 146 L 110 158 L 100 164 L 90 158 Z" fill="${shade(L.top, 1.12)}" stroke="${o}" stroke-width="1.5" stroke-linejoin="round"/>`);
    for (let i = 0; i < 3; i++) p.push(`<circle cx="100" cy="${172 + i * 10}" r="2.2" fill="${shade(L.top, 0.7)}"/>`);
  }
  const acc = new Set(L.acc ?? []);
  if (acc.has('satchel')) p.push(`<path d="M${100 - sw - 6} 158 L ${100 + sw - 4} 200" stroke="#8a5a32" stroke-width="7" stroke-linecap="round"/><path d="M${100 - sw - 6} 158 L ${100 + sw - 4} 200" stroke="#a86a3a" stroke-width="3" stroke-linecap="round"/>`);
  if (acc.has('shawl')) p.push(`<path d="M${100 - sw - 18} 176 Q ${100 - sw} 146 100 150 Q ${100 + sw} 146 ${100 + sw + 18} 176 L ${100 + sw + 6} 184 Q 100 166 ${100 - sw - 6} 184 Z" fill="${css(L.scarf ?? 0xf2e2c0)}" stroke="${ink(L.scarf ?? 0xf2e2c0)}" stroke-width="1.8"/><path d="M100 166 L 94 196 L 106 196 Z" fill="${shade(L.scarf ?? 0xf2e2c0, 0.92)}" stroke="${ink(L.scarf ?? 0xf2e2c0)}" stroke-width="1.4"/>`);
  if (L.scarf !== undefined && !acc.has('shawl')) {
    p.push(`<path d="M74 146 Q 100 164 126 146 Q 128 158 120 162 Q 100 172 80 162 Q 72 158 74 146 Z" fill="${css(L.scarf)}" stroke="${ink(L.scarf)}" stroke-width="1.8"/>`);
    p.push(`<path d="M110 160 L 118 192 L 130 188 L 121 158 Z" fill="${shade(L.scarf, 0.9)}" stroke="${ink(L.scarf)}" stroke-width="1.6"/>`);
    p.push(`<path d="M84 154 q 16 8 32 0" stroke="${shade(L.scarf, 1.2)}" stroke-width="2" fill="none" opacity="0.6"/>`);
  }
  if (L.bowtie !== undefined) p.push(`<path d="M100 152 L 86 144 L 86 160 Z M100 152 L 114 144 L 114 160 Z" fill="${css(L.bowtie)}" stroke="${ink(L.bowtie)}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="100" cy="152" r="3.6" fill="${shade(L.bowtie, 0.8)}"/>`);
  if (acc.has('stethoscope')) p.push(`<path d="M84 148 Q 78 176 94 182 M116 148 Q 122 170 110 180 Q 104 186 106 196" stroke="#3a3a44" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="106" cy="196" r="5" fill="#c8c8d0" stroke="#3a3a44" stroke-width="1.6"/>`);
  if (acc.has('toolbelt') && L.apron === undefined) p.push(`<path d="M${100 - sw * 0.52} 150 Q ${100 - sw * 0.46} 176 ${100 - sw * 0.4} 200 M${100 + sw * 0.52} 150 Q ${100 + sw * 0.46} 176 ${100 + sw * 0.4} 200" stroke="#5a3a22" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="${100 - sw * 0.45}" cy="178" r="2.6" fill="#c8a04a"/><circle cx="${100 + sw * 0.45}" cy="178" r="2.6" fill="#c8a04a"/>`);
  return p.join('');
}

/** Portrait SVG for a look + mood. */
export function portraitSvg(look: NpcLook, bg: [number, number], mood: Mood = 'happy'): string {
  const id = `p${uid++}`;
  const L = look;
  const m0 = MOOD[mood] ?? MOOD.happy;
  const skin = L.skin;
  const hair = L.hair;
  const acc = new Set(L.acc ?? []);
  const old = acc.has('wrinkles');
  const faceKind = L.face ?? 'round';
  const hs = L.head ?? 1;
  const w = (faceKind === 'long' ? 42 : faceKind === 'square' ? 47 : 45) * (hs > 1.05 ? 1.04 : 1);
  const f: Face = { cx: 100, top: faceKind === 'long' ? 42 : 46, chin: faceKind === 'long' ? 144 : faceKind === 'heart' ? 141 : 138, w, jaw: faceKind === 'square' ? 1.4 : faceKind === 'heart' ? 0.5 : faceKind === 'long' ? 0.9 : 1 };
  const sw = 58 * Math.min(1.35, Math.max(0.85, L.build));
  const iris = L.eyes ?? 0x6a4a2a;
  const lash = mix(hair, 0x1a0e0a, 0.55);
  const eyeY = f.top + (f.chin - f.top) * 0.52;
  const mouthY = f.top + (f.chin - f.top) * 0.8;
  const beard = L.beard === true ? 'full' : L.beard;
  // Three-quarter turn: features ride a sphere of radius ~face width turned by th; the far eye
  // foreshortens, the nose tip leads, the far ear hides behind the cheek.
  const tn = TURN[mood] ?? 0.4;
  const th = tn * 0.62;
  const R = f.w;
  const phi = (x0: number): number => Math.asin(Math.max(-1, Math.min(1, x0 / R)));
  const X = (x0: number, depth = 0): number => 100 + (R + depth) * Math.sin(phi(x0) - th);
  const WS = (x0: number): number => Math.max(0.55, Math.cos(phi(x0) - th) / Math.cos(phi(x0)));
  const d0 = X(0) - 100;
  // Eyes meet the viewer (irises slide towards the near side) unless the mood looks away.
  const m: MoodParams = LOOK_AWAY.has(mood) ? m0 : { ...m0, gazeX: m0.gazeX + th * 7 };
  const p: string[] = [];
  p.push(`<defs>
    <radialGradient id="${id}bg" cx="42%" cy="34%" r="80%"><stop offset="0" stop-color="${shade(bg[0], 1.1)}"/><stop offset="0.6" stop-color="${css(bg[0])}"/><stop offset="1" stop-color="${css(bg[1])}"/></radialGradient>
    <radialGradient id="${id}vig" cx="50%" cy="46%" r="72%"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2a1408" stop-opacity="0.34"/></radialGradient>
    <radialGradient id="${id}sk" cx="38%" cy="34%" r="78%"><stop offset="0" stop-color="${shade(skin, 1.09)}"/><stop offset="0.62" stop-color="${css(skin)}"/><stop offset="1" stop-color="${shade(skin, 0.82)}"/></radialGradient>
    <linearGradient id="${id}hr" x1="0.2" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${shade(hair, 1.25)}"/><stop offset="0.55" stop-color="${css(hair)}"/><stop offset="1" stop-color="${shade(hair, 0.72)}"/></linearGradient>
    <linearGradient id="${id}top" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${shade(L.coat ?? L.top, 1.14)}"/><stop offset="1" stop-color="${shade(L.coat ?? L.top, 0.74)}"/></linearGradient>
    <radialGradient id="${id}iris" cx="50%" cy="62%" r="60%"><stop offset="0" stop-color="${shade(iris, 1.55)}"/><stop offset="0.55" stop-color="${css(iris)}"/><stop offset="1" stop-color="${shade(iris, 0.55)}"/></radialGradient>
    <radialGradient id="${id}bl" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f0706a" stop-opacity="0.75"/><stop offset="1" stop-color="#f0706a" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}shaft" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff8e0" stop-opacity="0"/><stop offset="0.5" stop-color="#fff8e0" stop-opacity="0.32"/><stop offset="1" stop-color="#fff8e0" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}cool" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a7a" stop-opacity="0.05"/><stop offset="1" stop-color="#2a3a7a" stop-opacity="0.35"/></linearGradient>
    <radialGradient id="${id}hot" cx="50%" cy="46%" r="70%"><stop offset="0.55" stop-color="#ff3a1a" stop-opacity="0"/><stop offset="1" stop-color="#c81a0a" stop-opacity="0.5"/></radialGradient>
    <clipPath id="${id}face"><path d="${facePath(f, tn)}"/></clipPath>
    <filter id="${id}dof" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <filter id="${id}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="${id}soft2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.8"/></filter>
    <filter id="${id}wob" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="${(uid * 7) % 97}"/><feDisplacementMap in="SourceGraphic" scale="1.7" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="${id}grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/></filter>
    <filter id="${id}brush" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.07" numOctaves="3" seed="9"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>`);
  p.push(backdrop(id, bg, L.backdrop));
  // Colour temperature of the moment: warm gold for joy, cool blue for sorrow, a red rim for anger.
  const pz = POSE[mood] ?? POSE.neutral;
  p.push(`<rect width="200" height="200" fill="${pz.tint}" opacity="${pz.tintA}" style="mix-blend-mode:${mood === 'sad' || mood === 'worried' ? 'multiply' : 'soft-light'}"/>`);
  if (mood === 'sad') p.push(`<rect width="200" height="200" fill="url(#${id}cool)"/>`);
  if (mood === 'angry') p.push(`<rect width="200" height="200" fill="url(#${id}hot)"/>`);
  if (mood === 'surprised' || mood === 'laugh')
    p.push(`<g opacity="${mood === 'surprised' ? 0.45 : 0.3}" stroke="#fffbe8" stroke-width="4" stroke-linecap="round">${Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      return `<path d="M${100 + Math.cos(a) * 70} ${88 + Math.sin(a) * 70} L ${100 + Math.cos(a) * 98} ${88 + Math.sin(a) * 98}"/>`;
    }).join('')}</g>`);
  const HT = `translate(${pz.dx} ${pz.dy}) rotate(${pz.tilt} 100 ${f.chin}) translate(100 ${f.chin}) scale(${pz.scale}) translate(-100 ${-f.chin})`;
  const ST = `translate(0 ${pz.shoulders * 0.7})`;
  // The bust is drawn slightly larger than the frame for a closer, more intimate crop.
  p.push(`<g transform="translate(100 206) scale(1.07) translate(-100 -206)"><g filter="url(#${id}wob)">`);
  // Braids drape in front of the shoulders, so body first for everything else.
  p.push(`<g transform="${HT} translate(${(-d0 * 0.3).toFixed(2)} 0)">${backHair(id, L, f)}</g>`);
  p.push(`<g transform="${ST}">`);
  p.push(clothing(id, L, sw));
  // Soft light on the torso: lit near shoulder, shaded far side and underarms.
  p.push(`<clipPath id="${id}bd"><path d="M${100 - sw - 22} 200 C ${100 - sw - 14} 160 ${100 - sw + 4} 146 100 144 C ${100 + sw - 4} 146 ${100 + sw + 14} 160 ${100 + sw + 22} 200 Z"/></clipPath>`);
  p.push(`<g clip-path="url(#${id}bd)" filter="url(#${id}soft)"><ellipse cx="${100 - sw * 0.7}" cy="164" rx="${sw * 0.45}" ry="16" fill="#fff8ea" opacity="0.3"/><ellipse cx="${100 + sw + 6}" cy="190" rx="${sw * 0.45}" ry="40" fill="#1a0a04" opacity="0.28"/><ellipse cx="${100 - sw - 10}" cy="200" rx="14" ry="30" fill="#1a0a04" opacity="0.22"/></g>`);
  if (pz.rim) p.push(`<path d="M${100 + sw + 20} 200 C ${100 + sw + 12} 160 ${100 + sw - 6} 147 100 145" stroke="${pz.rim}" stroke-width="3" fill="none" opacity="0.55" filter="url(#${id}soft2)"/>`);
  p.push(`</g>`);
  // Neck (tapered, skin-lit) with a crisp cel shadow under the jaw.
  p.push(`<g transform="translate(${pz.dx * 0.5} ${(pz.dy + pz.shoulders * 0.7) * 0.5})">`);
  p.push(`<path d="M87 ${f.chin - 18} C 88 ${f.chin + 2} 87 146 84 152 Q 100 160 116 152 C 113 146 112 ${f.chin + 2} 113 ${f.chin - 18} Z" fill="url(#${id}sk)" stroke="${ink(skin)}" stroke-width="1.6"/>`);
  p.push(`<path d="M87 ${f.chin - 12} Q 100 ${f.chin + 12} 113 ${f.chin - 12} L 113 ${f.chin + 1} Q 100 ${f.chin + 13} 87 ${f.chin + 1} Z" fill="${mix(skin, 0x8a3028, 0.28)}" opacity="0.75"/>`);
  p.push(`<path d="M110 ${f.chin + 4} C 111 ${f.chin + 12} 111 146 113 151" stroke="${mix(skin, 0x8a3028, 0.3)}" stroke-width="3" fill="none" opacity="0.5"/>`);
  p.push(`</g>`);
  p.push(`<ellipse cx="100" cy="${f.chin + 12}" rx="${sw * 0.62}" ry="11" fill="#2a1408" opacity="0.26" filter="url(#${id}soft)"/>`);
  if (L.hairStyle === 'braids') {
    p.push(`<g transform="${HT}">`);
    for (const sx of [-1, 1]) {
      const bx = 100 + sx * (f.w - 6);
      const segs: string[] = [];
      for (let i = 0; i < 6; i++) segs.push(`<ellipse cx="${bx + sx * i * 1.5}" cy="${f.top + 70 + i * 16}" rx="${9 - i * 0.4}" ry="10" fill="url(#${id}hr)" stroke="${ink(hair)}" stroke-width="1.6"/>`);
      segs.push(`<circle cx="${bx + sx * 9}" cy="${f.top + 70 + 6 * 16 - 2}" r="5" fill="${css(L.hatColor ?? 0xc8412f)}" stroke="${ink(L.hatColor ?? 0xc8412f)}" stroke-width="1.4"/>`);
      p.push(segs.join(''));
    }
    p.push(`</g>`);
  }
  // Head group (tilts with the mood)
  p.push(`<g transform="${HT}">`);
  if (L.hat === 'sunhat') p.push(`<ellipse transform="translate(${(d0 * 0.4).toFixed(2)} 0)" cx="100" cy="${f.top + 10}" rx="${f.w + 42}" ry="17" fill="${shade(L.hatColor ?? 0xe8d098, 0.86)}" stroke="${ink(L.hatColor ?? 0xe8d098)}" stroke-width="1.8"/>`);
  // Ears
  for (const sx of [-1, 1]) {
    // The far ear slips behind the cheek once the head turns.
    if (sx === -1 && th > 0.08) continue;
    const ex = X(sx * f.w, 1);
    p.push(`<ellipse cx="${ex}" cy="${eyeY + 2}" rx="8.5" ry="12" fill="${shade(skin, 0.96)}" stroke="${ink(skin)}" stroke-width="1.6"/><path d="M${ex - sx * 1} ${eyeY - 4} q ${sx * 4} 6 0 12" stroke="${shade(skin, 0.72)}" stroke-width="1.6" fill="none"/>`);
    if (acc.has('earrings')) p.push(`<circle cx="${ex + sx * 1}" cy="${eyeY + 15}" r="3.6" fill="#f2c43a" stroke="#a87a1a" stroke-width="1.2"/><circle cx="${ex + sx * 0.4}" cy="${eyeY + 14}" r="1.1" fill="#fff" opacity="0.8"/>`);
  }
  // Face
  p.push(`<path d="${facePath(f, tn)}" fill="url(#${id}sk)" stroke="${ink(skin)}" stroke-width="2"/>`);
  p.push(`<g clip-path="url(#${id}face)">`);
  // Cel shadow on the far cheek + rim light on the near one
  const warmShadow = mix(skin, 0x8a3028, 0.42);
  p.push(`<g filter="url(#${id}soft)">`);
  p.push(`<path d="M${100 + f.w * 0.5} ${f.top - 6} Q ${100 + f.w * 1.05} ${eyeY} ${100 + f.w * 0.25} ${f.chin + 6} L ${100 + f.w + 14} ${f.chin + 6} L ${100 + f.w + 14} ${f.top - 6} Z" fill="${warmShadow}" opacity="0.42"/>`);
  p.push(`<ellipse cx="100" cy="${f.chin + 2}" rx="${f.w * 0.75}" ry="12" fill="${warmShadow}" opacity="0.4"/>`);
  p.push(`<ellipse cx="${100 - f.w * 0.42}" cy="${eyeY + 14}" rx="13" ry="9" fill="#fff6ea" opacity="0.38"/>`);
  p.push(`<ellipse cx="${100 - 8}" cy="${f.top + 20}" rx="${f.w * 0.5}" ry="10" fill="#fff6ea" opacity="0.3"/>`);
  p.push(`<ellipse cx="100" cy="${eyeY + 22}" rx="7" ry="4" fill="${warmShadow}" opacity="0.28"/>`);
  for (const sx of [-1, 1]) p.push(`<ellipse cx="${100 + sx * (f.w - 2)}" cy="${eyeY + 4}" rx="6" ry="16" fill="${warmShadow}" opacity="0.3"/>`);
  p.push(`</g>`);
  p.push(`<path d="M${100 - f.w + 3} ${eyeY - 20} Q ${100 - f.w + 1} ${eyeY + 16} ${100 - f.w * 0.6} ${f.chin - 12}" stroke="#fff" stroke-width="3" fill="none" opacity="0.28" stroke-linecap="round" filter="url(#${id}soft2)"/>`);
  // Fringe shadow on the forehead
  if (L.hairStyle !== 'bald') p.push(`<path d="M${100 - f.w} ${f.top + 30} Q 100 ${f.top + 46} ${100 + f.w} ${f.top + 30} L ${100 + f.w} ${f.top} L ${100 - f.w} ${f.top} Z" fill="${warmShadow}" opacity="0.4" filter="url(#${id}soft2)"/>`);
  if (mood === 'angry') p.push(`<ellipse cx="100" cy="${eyeY - 7}" rx="${f.w}" ry="10" fill="${warmShadow}" opacity="0.38" filter="url(#${id}soft2)"/>`);
  if (mood === 'sad' || mood === 'worried') for (const sx of [-1, 1]) p.push(`<ellipse cx="${100 + sx * 21}" cy="${eyeY + 10}" rx="10" ry="4" fill="#6a78b0" opacity="0.22" filter="url(#${id}soft2)"/>`);
  // Stubble / beard base inside the face
  if (beard === 'stubble') {
    // Five o'clock shadow: a soft-edged jaw wash + a sparse stipple, strongest along the jawline.
    p.push(`<path transform="translate(${(d0 * 0.6).toFixed(2)} 0)" d="M${100 - f.w + 4} ${mouthY - 6} Q 100 ${mouthY + 2} ${100 + f.w - 4} ${mouthY - 6} L ${100 + f.w} ${f.chin + 4} L ${100 - f.w} ${f.chin + 4} Z" fill="${css(hair)}" opacity="0.13" filter="url(#${id}soft2)"/>`);
    const dots: string[] = [];
    const hsh = (n: number): number => {
      const v = Math.sin(n * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    for (let i = 0; i < 34; i++) {
      const a = hsh(i + 1);
      const bx = 100 + (a - 0.5) * f.w * 1.55;
      const by = mouthY - 2 + hsh(i + 71) * (f.chin - mouthY + 2) - Math.abs(a - 0.5) * 10;
      if (Math.abs(bx - 100) < 10 && by < mouthY + 7) continue;
      dots.push(`<circle cx="${(bx + d0 * 0.7).toFixed(1)}" cy="${by.toFixed(1)}" r="0.8"/>`);
    }
    p.push(`<g fill="${shade(hair, 0.8)}" opacity="0.4">${dots.join('')}</g>`);
  }
  p.push(`</g>`);
  if (beard === 'full') p.push(`<path transform="translate(${(d0 * 0.5).toFixed(2)} 0)" d="M${100 - f.w + 2} ${eyeY + 6} Q ${100 - f.w + 2} ${f.chin + 12} 100 ${f.chin + 14} Q ${100 + f.w - 2} ${f.chin + 12} ${100 + f.w - 2} ${eyeY + 6} Q ${100 + f.w - 8} ${mouthY + 2} 100 ${mouthY + 2} Q ${100 - f.w + 8} ${mouthY + 2} ${100 - f.w + 2} ${eyeY + 6} Z" fill="url(#${id}hr)" stroke="${ink(hair)}" stroke-width="1.8"/><path d="M92 ${f.chin + 2} q 8 6 16 0" stroke="${shade(hair, 1.35)}" stroke-width="2" fill="none" opacity="0.5"/>`);
  // Blush
  const bo = Math.min(1, m.blush);
  for (const sx of [-1, 1]) p.push(`<ellipse cx="${X(sx * 27)}" cy="${eyeY + 15}" rx="${(11 + m.blush * 3) * WS(sx * 27)}" ry="${6.5 + m.blush * 1.5}" fill="url(#${id}bl)" opacity="${bo}"/>`);
  if (mood === 'blush' || mood === 'angry') for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) p.push(`<path d="M${X(sx * 27) - 6 * WS(sx * 27) + i * 5 * WS(sx * 27)} ${eyeY + 18} l 3 -6" stroke="${mood === 'angry' ? '#c8403a' : '#e0605a'}" stroke-width="1.3" opacity="0.7" stroke-linecap="round"/>`);
  if (acc.has('freckles')) for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) p.push(`<circle cx="${X(sx * (16 + (i % 3) * 5 + (i > 2 ? 2 : 0)))}" cy="${eyeY + 10 + (i > 2 ? 5 : 0) + (i % 2)}" r="1.2" fill="${shade(skin, 0.62)}" opacity="0.75"/>`);
  if (old) {
    p.push(`<g transform="translate(${d0.toFixed(2)} 0)">`);
    p.push(`<path d="M${100 - 26} ${f.top + 18} q 26 -5 52 0 M${100 - 20} ${f.top + 24} q 20 -3 40 0" stroke="${shade(skin, 0.72)}" stroke-width="1.1" fill="none" opacity="0.55"/>`);
    p.push(`<path d="M${100 - 13} ${eyeY + 14} q -4 10 -2 18 M${100 + 13} ${eyeY + 14} q 4 10 2 18" stroke="${shade(skin, 0.7)}" stroke-width="1.2" fill="none" opacity="0.55"/>`);
    p.push(`</g>`);
  }
  // Eyes + brows
  const kid = hs > 1.05;
  const ex = kid ? 21.5 : old ? 20 : 20.5;
  const es = kid ? 1.14 : old ? 0.93 : 1;
  // Each eye (and its brow / lens) is drawn square-on, then moved + foreshortened onto the turned head.
  const onHead = (x: number, svg: string, k = es): string => `<g transform="translate(${X(x).toFixed(2)} ${eyeY}) scale(${(k * WS(x)).toFixed(3)} ${k}) translate(${-x} ${-eyeY})">${svg}</g>`;
  p.push(onHead(-ex, eye(id, -ex, eyeY, -1, m, iris, lash, skin, old)));
  p.push(onHead(ex, eye(id, ex, eyeY, 1, m, iris, lash, skin, old)));
  const browC = L.hairStyle === 'bald' || L.hat ? shade(hair, 0.82) : shade(hair, 0.8);
  const browT = (beard === 'full' || L.build > 1.3 ? 5 : 4) + (mood === 'angry' ? 1.4 : 0);
  p.push(onHead(-ex, brow(-ex, eyeY - 18, -1, m, browC, browT), 1));
  p.push(onHead(ex, brow(ex, eyeY - 18, 1, m, browC, browT), 1));
  // Nose
  // Painted nose: soft shadow down the far side of the bridge, a nostril shade, a lit tip.
  const nl = kid ? 0.8 : faceKind === 'long' ? 1.2 : 1;
  const nd = X(0, 9) - 100;
  if (th > 0.05) p.push(`<path d="M${X(-4, 2) - 1} ${eyeY + 1} Q ${100 + nd - 5} ${eyeY + 9 * nl} ${100 + nd - 3.5} ${eyeY + 15.5 * nl}" stroke="${shade(skin, 0.7)}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="${Math.min(0.75, th * 2.4).toFixed(2)}"/>`);
  p.push(`<g transform="translate(${nd.toFixed(2)} 0)">`);
  p.push(`<g filter="url(#${id}soft2)"><path d="M${102} ${eyeY + 2} Q ${106} ${eyeY + 10 * nl} ${104} ${eyeY + 16 * nl}" stroke="${warmShadow}" stroke-width="4" fill="none" opacity="0.45" stroke-linecap="round"/><ellipse cx="${100}" cy="${eyeY + 18 * nl}" rx="6" ry="2.6" fill="${warmShadow}" opacity="0.5"/></g>`);
  p.push(`<path d="M${97} ${eyeY + 16 * nl} Q ${100} ${eyeY + 18.5 * nl} ${104} ${eyeY + 15.5 * nl}" stroke="${shade(skin, 0.62)}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.8"/><ellipse cx="${99}" cy="${eyeY + 12 * nl}" rx="2.6" ry="2" fill="#fff" opacity="0.5" filter="url(#${id}soft2)"/>`);
  p.push(`</g>`);
  if (beard === 'full' || beard === 'mustache') {
    const mc = `url(#${id}hr)`;
    p.push(`<path transform="translate(${(X(0, 4) - 100).toFixed(2)} 0)" d="M${100} ${mouthY - 7} Q ${88} ${mouthY - 12} ${78} ${mouthY - 2} Q ${86} ${mouthY - 3} ${92} ${mouthY - 1} Q ${97} ${mouthY - 3} ${100} ${mouthY - 5} Q ${103} ${mouthY - 3} ${108} ${mouthY - 1} Q ${114} ${mouthY - 3} ${122} ${mouthY - 2} Q ${112} ${mouthY - 12} ${100} ${mouthY - 7} Z" fill="${mc}" stroke="${ink(hair)}" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  const my = mouthY + (beard === 'full' || beard === 'mustache' ? 2 : 0);
  p.push(`<g transform="translate(${(X(0, 2) - 100).toFixed(2)} 0) translate(100 ${my}) scale(${(1 - 0.28 * Math.sin(th)).toFixed(3)} 1) translate(-100 ${-my})">${mouth(mood, 100, my, skin, !!beard)}</g>`);
  if (L.glasses) {
    const gc = '#6a4424';
    for (const sx of [-1, 1]) p.push(onHead(sx * ex, `<circle cx="${sx * ex}" cy="${eyeY - 1}" r="15" fill="#e8f4ff" fill-opacity="0.14" stroke="${gc}" stroke-width="3"/><path d="M${sx * ex - 8} ${eyeY - 8} l 7 -5" stroke="#fff" stroke-width="2.4" opacity="0.7" stroke-linecap="round"/>`, 1));
    const lb = X(-ex) + 15 * WS(-ex);
    const rb = X(ex) - 15 * WS(ex);
    p.push(`<path d="M${lb} ${eyeY - 3} Q ${(lb + rb) / 2} ${eyeY - 7} ${rb} ${eyeY - 3}" stroke="${gc}" stroke-width="3" fill="none"/>`);
    // Only the near temple arm shows on a turned head.
    p.push(`<path d="M${X(ex) + 15 * WS(ex)} ${eyeY - 3} L ${X(f.w, 1)} ${eyeY - 5}${th > 0.08 ? '' : ` M${X(-ex) - 15 * WS(-ex)} ${eyeY - 3} L ${X(-f.w, 1)} ${eyeY - 5}`}" stroke="${gc}" stroke-width="2.6"/>`);
  }
  // Hair + hat
  const fh = frontHair(id, L, f);
  const hsx = d0 * 0.45;
  p.push(`<g transform="translate(${hsx.toFixed(2)} 0)">`);
  p.push(fh);
  if (fh && L.hairStyle !== 'bald') {
    // Painted sheen: a soft light band across the crown + a darker band where hair meets the face.
    p.push(`<clipPath id="${id}hc">${fh.replace(/<path d="[^"]*" stroke="[^"]*" stroke-width="[^"]*" fill="none"[^>]*\/>/g, '')}</clipPath>`);
    p.push(`<g clip-path="url(#${id}hc)"><g filter="url(#${id}soft2)"><path d="M${100 - f.w * 0.8} ${f.top + 12} Q ${100 - 4} ${f.top - 2} ${100 + f.w * 0.6} ${f.top + 10}" stroke="#fffaf0" stroke-width="7" fill="none" opacity="0.32" stroke-linecap="round"/>`);
    p.push(`<path d="M${100 - f.w} ${f.top + 34} Q 100 ${f.top + 22} ${100 + f.w} ${f.top + 34}" stroke="${shade(L.hair, 0.45)}" stroke-width="9" fill="none" opacity="0.35"/></g></g>`);
  }
  p.push(`</g>`);
  p.push(`<g transform="translate(${(d0 * 0.4).toFixed(2)} 0)">${hat(L, f)}</g>`);
  p.push(`<g transform="translate(${hsx.toFixed(2)} 0)">`);
  if (acc.has('pencil')) p.push(`<path d="M${100 + f.w - 4} ${eyeY - 14} L ${100 + f.w + 20} ${eyeY - 30}" stroke="#f2c43a" stroke-width="5" stroke-linecap="round"/><path d="M${100 + f.w + 18} ${eyeY - 29} l 5 -3" stroke="#e8a0a0" stroke-width="5" stroke-linecap="round"/>`);
  if (acc.has('flower') && L.hat !== 'sunhat') p.push(`<circle cx="${100 - f.w + 6}" cy="${f.top + 16}" r="7" fill="#ff8fab" stroke="${ink(0xff8fab)}" stroke-width="1.2"/><circle cx="${100 - f.w + 6}" cy="${f.top + 16}" r="2.6" fill="#ffd166"/>`);
  p.push(`</g>`);
  if (acc.has('bandage')) p.push(`<g transform="translate(${(X(28) - 128).toFixed(2)} 0) rotate(-20 ${100 + 28} ${eyeY + 20})"><rect x="${100 + 20}" y="${eyeY + 17}" width="16" height="7" rx="3" fill="#f6e0c0" stroke="${ink(0xf6e0c0)}" stroke-width="1.2"/><path d="M${100 + 26} ${eyeY + 18.5} v 4 M${100 + 30} ${eyeY + 18.5} v 4" stroke="#d8b890" stroke-width="1"/></g>`);
  // Manga marks
  p.push(`<g transform="translate(${d0.toFixed(2)} 0)">`);
  if (mood === 'sad') p.push(`<path d="M${100 + ex + 4} ${eyeY + 6} q -3 7 0 10 q 3 -3 0 -10 Z" fill="#8ac8f0" stroke="#4a8ac0" stroke-width="1"/>`);
  if (mood === 'worried') p.push(`<path d="M${100 + f.w - 6} ${f.top + 22} q -6 9 0 13 q 6 -4 0 -13 Z" fill="#9ad4f4" stroke="#4a8ac0" stroke-width="1.2"/>`);
  if (mood === 'angry') p.push(`<g stroke="#d8342a" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M${100 + f.w - 16} ${f.top + 8} q 4 4 8 0 M${100 + f.w - 12} ${f.top + 4} q 4 4 0 8 M${100 + f.w - 4} ${f.top + 8} q -4 4 -8 0"/></g>`);
  if (mood === 'surprised') p.push(`<g stroke="#5a3a2a" stroke-width="2.2" stroke-linecap="round"><path d="M${100 - f.w - 6} ${f.top + 4} l -8 -6 M${100 - f.w - 2} ${f.top - 4} l -4 -9 M${100 + f.w + 6} ${f.top + 4} l 8 -6 M${100 + f.w + 2} ${f.top - 4} l 4 -9"/></g>`);
  if (mood === 'blush' || mood === 'laugh') p.push(`<g fill="#fff6c0" stroke="#e8b84a" stroke-width="0.8"><path d="M${100 + f.w + 8} ${f.top + 10} l 2 5 l 5 2 l -5 2 l -2 5 l -2 -5 l -5 -2 l 5 -2 Z"/><path d="M${100 - f.w - 10} ${f.top + 30} l 1.4 3.6 l 3.6 1.4 l -3.6 1.4 l -1.4 3.6 l -1.4 -3.6 l -3.6 -1.4 l 3.6 -1.4 Z"/></g>`);
  if (mood === 'thinking') p.push(`<g fill="#fffaf0" stroke="#7a5a3a" stroke-width="1.4"><circle cx="${100 + f.w + 10}" cy="${f.top + 4}" r="3"/><circle cx="${100 + f.w + 18}" cy="${f.top - 6}" r="4.5"/><circle cx="${100 + f.w + 28}" cy="${f.top - 20}" r="7"/></g>`);
  p.push(`</g>`);
  p.push(`</g>`);
  if (pz.hand) {
    const sleeve = L.coat ?? L.top;
    const cy = f.chin + pz.dy;
    const hx = 100 + pz.dx + d0;
    if (pz.hand === 'chin') p.push(hand(hx + 16, cy + 8, -18, skin, sleeve));
    else if (pz.hand === 'cheek') p.push(hand(hx - f.w + 4, eyeY + pz.dy + 26, 24, skin, sleeve));
    else if (pz.hand === 'mouth') p.push(hand(hx + 30, mouthY + pz.dy + 14, -34, skin, sleeve));
    else if (pz.hand === 'fist') p.push(hand(100 - sw * 0.55, 186 + pz.shoulders * 0.7, 8, skin, sleeve, true));
    else if (pz.hand === 'chest') p.push(hand(100 + 6, 184 + pz.shoulders * 0.7, -6, skin, sleeve));
  }
  p.push(`</g></g>`);
  // Painted surface: brush streaks + fine canvas grain.
  p.push(`<rect width="200" height="200" filter="url(#${id}brush)" opacity="0.15" style="mix-blend-mode:soft-light"/>`);
  p.push(`<rect width="200" height="200" filter="url(#${id}grain)" opacity="0.13" style="mix-blend-mode:overlay"/>`);
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${p.join('')}</svg>`;
}
