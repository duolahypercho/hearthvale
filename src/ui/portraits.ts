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
import type { NpcLook, Mood } from '../data/npcs';

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
  sad: { open: 0.62, smile: 0, gazeX: 0, gazeY: 2.5, pupil: 1, closed: false, browIn: -7, browOut: 3, browRaiseL: 0, blush: 0.3, tilt: 3 },
  angry: { open: 0.62, smile: 0, gazeX: 0, gazeY: 0, pupil: 0.85, closed: false, browIn: 7, browOut: -4, browRaiseL: 0, blush: 0.75, tilt: 0 },
  surprised: { open: 1.2, smile: 0, gazeX: 0, gazeY: -0.5, pupil: 0.7, closed: false, browIn: -8, browOut: -7, browRaiseL: 0, blush: 0.4, tilt: 0 },
  blush: { open: 0.82, smile: 0.2, gazeX: -3, gazeY: 1.5, pupil: 1.05, closed: false, browIn: -3, browOut: 1, browRaiseL: 0, blush: 1.2, tilt: 4 },
  worried: { open: 0.95, smile: 0, gazeX: 1.5, gazeY: 0, pupil: 0.95, closed: false, browIn: -6, browOut: 3, browRaiseL: 0, blush: 0.35, tilt: 2 },
  thinking: { open: 0.85, smile: 0, gazeX: 3, gazeY: -3, pupil: 1, closed: false, browIn: 0, browOut: 0, browRaiseL: -6, blush: 0.4, tilt: -3 },
};

interface Face {
  cx: number;
  top: number;
  chin: number;
  w: number;
  jaw: number;
}

function facePath(f: Face): string {
  const { cx, top, chin, w, jaw } = f;
  const cheekY = top + (chin - top) * 0.56;
  return `M${cx - w} ${cheekY} C ${cx - w} ${top + 10}, ${cx - w * 0.55} ${top}, ${cx} ${top} C ${cx + w * 0.55} ${top}, ${cx + w} ${top + 10}, ${cx + w} ${cheekY} C ${cx + w} ${cheekY + 22 * jaw}, ${cx + w * (0.35 + 0.3 * jaw)} ${chin - 2}, ${cx} ${chin} C ${cx - w * (0.35 + 0.3 * jaw)} ${chin - 2}, ${cx - w} ${cheekY + 22 * jaw}, ${cx - w} ${cheekY} Z`;
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

/** Soft painted backdrop: gradient + bokeh + brush strokes + vignette. */
function backdrop(id: string, bg: [number, number]): string {
  const p: string[] = [];
  p.push(`<rect width="200" height="200" fill="url(#${id}bg)"/>`);
  for (let i = 0; i < 9; i++) {
    const x = (i * 53 + 17) % 200;
    const y = (i * 37 + 11) % 130;
    p.push(`<circle cx="${x}" cy="${y}" r="${7 + (i % 4) * 5}" fill="#fff" opacity="${0.05 + (i % 3) * 0.04}"/>`);
  }
  for (let i = 0; i < 6; i++) {
    const y = 20 + i * 30;
    p.push(`<path d="M-10 ${y} q 60 ${-8 + (i % 3) * 6} 110 ${2} t 110 ${-4}" stroke="${shade(bg[1], 1.12)}" stroke-width="${10 + (i % 2) * 6}" fill="none" opacity="0.18" stroke-linecap="round"/>`);
  }
  p.push(`<rect width="200" height="200" fill="url(#${id}vig)"/>`);
  return p.join('');
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
      return `<path d="M${cx - w - 6} ${t + 58} Q ${cx - w - 8} ${t - 2} ${cx} ${t - 4} Q ${cx + w + 8} ${t - 2} ${cx + w + 6} ${t + 58} L ${cx + w - 2} ${t + 34} L ${cx + 24} ${t + 32} L ${cx + 18} ${t + 24} L ${cx + 8} ${t + 34} L ${cx - 4} ${t + 24} L ${cx - 14} ${t + 34} L ${cx - 24} ${t + 26} L ${cx - w + 2} ${t + 36} Z" fill="${H}" ${s}/>` + strands(`M${cx - 30} ${t + 10} Q ${cx - 4} ${t - 2} ${cx + 22} ${t + 8}`) + strands(`M${cx + w - 2} ${t + 30} q 4 14 2 24`);
    case 'cap':
      return `<path d="M${cx - w - 2} ${t + 40} Q ${cx - w + 2} ${t + 22} ${cx - w + 10} ${t + 20} L ${cx + w - 10} ${t + 20} Q ${cx + w - 2} ${t + 22} ${cx + w + 2} ${t + 40} L ${cx + w - 2} ${t + 50} L ${cx - w + 2} ${t + 50} Z" fill="${H}" ${s}/>` + `<rect x="${cx - w - 4}" y="${t + 8}" width="${2 * w + 8}" height="18" rx="7" fill="#f3ece0" stroke="${ink(0xf3ece0)}" stroke-width="1.6"/>` + `<path d="M${cx - w - 10} ${t + 12} Q ${cx - w - 16} ${t - 30} ${cx - 22} ${t - 36} Q ${cx - 2} ${t - 54} ${cx + 22} ${t - 38} Q ${cx + w + 18} ${t - 34} ${cx + w + 10} ${t + 12} Z" fill="#fbf7ee" stroke="${ink(0xfbf7ee)}" stroke-width="1.8"/>` + `<path d="M${cx - 30} ${t - 14} Q ${cx - 12} ${t - 30} ${cx + 4} ${t - 20} M${cx + 8} ${t - 26} Q ${cx + 22} ${t - 30} ${cx + 30} ${t - 14}" stroke="#e6dccb" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
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
      let d = `M${cx - w - 4} ${t + 44}`;
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const x = cx - w - 4 + (i / n) * (2 * w + 8);
        const tipY = t - 14 + Math.abs(i - n / 2) * 4 + (i % 2) * 5;
        const baseY = t + 20 + Math.abs(i - n / 2) * 3;
        d += ` L ${x - 5} ${baseY} L ${x} ${tipY}`;
      }
      d += ` L ${cx + w + 4} ${t + 44} L ${cx + w - 6} ${t + 30} L ${cx + 18} ${t + 24} L ${cx + 10} ${t + 34} L ${cx} ${t + 24} L ${cx - 10} ${t + 34} L ${cx - 18} ${t + 24} L ${cx - w + 6} ${t + 30} Z`;
      return `<path d="${d}" fill="${H}" ${s}/>` + strands(`M${cx - 20} ${t + 6} l 8 -12 M${cx + 6} ${t + 2} l 6 -14`);
    }
    case 'braids':
      return `<path d="M${cx - w - 2} ${t + 48} Q ${cx - w - 4} ${t} ${cx} ${t - 2} Q ${cx + w + 4} ${t} ${cx + w + 2} ${t + 48} Q ${cx + w - 6} ${t + 24} ${cx + 2} ${t + 18} Q ${cx - w + 6} ${t + 24} ${cx - w - 2} ${t + 48} Z" fill="${H}" ${s}/><path d="M${cx + 2} ${t + 2} L ${cx + 2} ${t + 18}" stroke="${shade(L.hair, 0.6)}" stroke-width="1.6"/>`;
    case 'slick':
      return `<path d="M${cx - w - 2} ${t + 46} Q ${cx - w - 4} ${t - 2} ${cx + 6} ${t - 4} Q ${cx + w + 6} ${t} ${cx + w + 2} ${t + 42} Q ${cx + w - 2} ${t + 20} ${cx + 20} ${t + 14} Q ${cx - 10} ${t + 12} ${cx - 24} ${t + 22} Q ${cx - w + 2} ${t + 28} ${cx - w - 2} ${t + 46} Z" fill="${H}" ${s}/>` + `<path d="M${cx - 18} ${t + 4} Q ${cx + 4} ${t - 4} ${cx + 30} ${t + 8}" stroke="${hl}" stroke-width="3" fill="none" opacity="0.55" stroke-linecap="round"/><path d="M${cx - 22} ${t + 2} Q ${cx - 20} ${t + 10} ${cx - 24} ${t + 20}" stroke="${shade(L.hair, 0.6)}" stroke-width="1.4" fill="none"/>`;
    default:
      if (L.hat === 'flatcap' || L.hat === 'beanie' || L.hat === 'bandana') return `<path d="M${cx - w - 2} ${t + 56} Q ${cx - w - 2} ${t + 36} ${cx - w + 8} ${t + 30} L ${cx - w + 6} ${t + 56} Z M${cx + w + 2} ${t + 56} Q ${cx + w + 2} ${t + 36} ${cx + w - 8} ${t + 30} L ${cx + w - 6} ${t + 56} Z" fill="${H}" ${s}/>`;
      return `<path d="M${cx - w - 2} ${t + 50} Q ${cx - w - 6} ${t - 2} ${cx} ${t - 4} Q ${cx + w + 6} ${t - 2} ${cx + w + 2} ${t + 50} Q ${cx + w - 4} ${t + 26} ${cx + 22} ${t + 22} L ${cx + 14} ${t + 30} L ${cx + 8} ${t + 20} L ${cx - 4} ${t + 30} L ${cx - 10} ${t + 20} L ${cx - 20} ${t + 28} Q ${cx - w + 2} ${t + 26} ${cx - w - 2} ${t + 50} Z" fill="${H}" ${s}/>` + strands(`M${cx - 22} ${t + 8} Q ${cx} ${t} ${cx + 22} ${t + 8}`);
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
  // Fold shading
  p.push(`<path d="M${100 - sw + 6} 170 q 6 14 2 30 M${100 + sw - 8} 168 q -4 16 0 32" stroke="${shade(topC, 0.72)}" stroke-width="3" fill="none" opacity="0.5" stroke-linecap="round"/>`);
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
    p.push(`<path d="M${100 - sw * 0.55} 200 L ${100 - sw * 0.44} 160 Q 100 152 ${100 + sw * 0.44} 160 L ${100 + sw * 0.55} 200 Z" fill="${css(L.apron)}" stroke="${ink(L.apron)}" stroke-width="1.8"/>`);
    p.push(`<path d="M${100 - sw * 0.44} 160 L 84 146 M ${100 + sw * 0.44} 160 L 116 146" stroke="${shade(L.apron, 0.8)}" stroke-width="5" stroke-linecap="round"/>`);
    p.push(`<path d="M${100 - 14} 184 h 28 v 12 h -28 Z" fill="${shade(L.apron, 0.9)}" stroke="${ink(L.apron)}" stroke-width="1.2"/>`);
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
  if (acc.has('toolbelt')) p.push(`<path d="M${100 - sw * 0.9} 158 L ${100 + sw * 0.9} 158" stroke="#5a3a22" stroke-width="3" opacity="0.8"/>`);
  return p.join('');
}

/** Portrait SVG for a look + mood. */
export function portraitSvg(look: NpcLook, bg: [number, number], mood: Mood = 'happy'): string {
  const id = `p${uid++}`;
  const L = look;
  const m = MOOD[mood] ?? MOOD.happy;
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
  const p: string[] = [];
  p.push(`<defs>
    <radialGradient id="${id}bg" cx="42%" cy="34%" r="80%"><stop offset="0" stop-color="${shade(bg[0], 1.1)}"/><stop offset="0.6" stop-color="${css(bg[0])}"/><stop offset="1" stop-color="${css(bg[1])}"/></radialGradient>
    <radialGradient id="${id}vig" cx="50%" cy="46%" r="72%"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2a1408" stop-opacity="0.34"/></radialGradient>
    <radialGradient id="${id}sk" cx="38%" cy="34%" r="78%"><stop offset="0" stop-color="${shade(skin, 1.09)}"/><stop offset="0.62" stop-color="${css(skin)}"/><stop offset="1" stop-color="${shade(skin, 0.82)}"/></radialGradient>
    <linearGradient id="${id}hr" x1="0.2" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${shade(hair, 1.25)}"/><stop offset="0.55" stop-color="${css(hair)}"/><stop offset="1" stop-color="${shade(hair, 0.72)}"/></linearGradient>
    <linearGradient id="${id}top" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${shade(L.coat ?? L.top, 1.14)}"/><stop offset="1" stop-color="${shade(L.coat ?? L.top, 0.74)}"/></linearGradient>
    <radialGradient id="${id}iris" cx="50%" cy="62%" r="60%"><stop offset="0" stop-color="${shade(iris, 1.55)}"/><stop offset="0.55" stop-color="${css(iris)}"/><stop offset="1" stop-color="${shade(iris, 0.55)}"/></radialGradient>
    <radialGradient id="${id}bl" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f0706a" stop-opacity="0.75"/><stop offset="1" stop-color="#f0706a" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}face"><path d="${facePath(f)}"/></clipPath>
  </defs>`);
  p.push(backdrop(id, bg));
  // Braids drape in front of the shoulders, so body first for everything else.
  p.push(backHair(id, L, f));
  p.push(clothing(id, L, sw));
  // Neck + jaw shadow
  p.push(`<path d="M86 ${f.chin - 18} L 86 150 Q 100 158 114 150 L 114 ${f.chin - 18} Z" fill="${shade(skin, 0.88)}" stroke="${ink(skin)}" stroke-width="1.6"/>`);
  p.push(`<path d="M86 ${f.chin - 10} Q 100 ${f.chin + 8} 114 ${f.chin - 10} L 114 ${f.chin - 2} Q 100 ${f.chin + 10} 86 ${f.chin - 2} Z" fill="${shade(skin, 0.7)}" opacity="0.6"/>`);
  if (L.hairStyle === 'braids') {
    for (const sx of [-1, 1]) {
      const bx = 100 + sx * (f.w - 6);
      const segs: string[] = [];
      for (let i = 0; i < 6; i++) segs.push(`<ellipse cx="${bx + sx * i * 1.5}" cy="${f.top + 70 + i * 16}" rx="${9 - i * 0.4}" ry="10" fill="url(#${id}hr)" stroke="${ink(hair)}" stroke-width="1.6"/>`);
      segs.push(`<circle cx="${bx + sx * 9}" cy="${f.top + 70 + 6 * 16 - 2}" r="5" fill="${css(L.hatColor ?? 0xc8412f)}" stroke="${ink(L.hatColor ?? 0xc8412f)}" stroke-width="1.4"/>`);
      p.push(segs.join(''));
    }
  }
  // Head group (tilts with the mood)
  p.push(`<g transform="rotate(${m.tilt} 100 ${f.chin})">`);
  if (L.hat === 'sunhat') p.push(`<ellipse cx="100" cy="${f.top + 10}" rx="${f.w + 42}" ry="17" fill="${shade(L.hatColor ?? 0xe8d098, 0.86)}" stroke="${ink(L.hatColor ?? 0xe8d098)}" stroke-width="1.8"/>`);
  // Ears
  for (const sx of [-1, 1]) {
    const ex = 100 + sx * (f.w + 1);
    p.push(`<ellipse cx="${ex}" cy="${eyeY + 2}" rx="8.5" ry="12" fill="${shade(skin, 0.96)}" stroke="${ink(skin)}" stroke-width="1.6"/><path d="M${ex - sx * 1} ${eyeY - 4} q ${sx * 4} 6 0 12" stroke="${shade(skin, 0.72)}" stroke-width="1.6" fill="none"/>`);
    if (acc.has('earrings')) p.push(`<circle cx="${ex + sx * 1}" cy="${eyeY + 15}" r="3.6" fill="#f2c43a" stroke="#a87a1a" stroke-width="1.2"/><circle cx="${ex + sx * 0.4}" cy="${eyeY + 14}" r="1.1" fill="#fff" opacity="0.8"/>`);
  }
  // Face
  p.push(`<path d="${facePath(f)}" fill="url(#${id}sk)" stroke="${ink(skin)}" stroke-width="2"/>`);
  p.push(`<g clip-path="url(#${id}face)">`);
  // Cel shadow on the far cheek + rim light on the near one
  p.push(`<path d="M${100 + f.w * 0.55} ${f.top} Q ${100 + f.w * 1.1} ${eyeY} ${100 + f.w * 0.3} ${f.chin + 4} L ${100 + f.w + 10} ${f.chin + 4} L ${100 + f.w + 10} ${f.top} Z" fill="${shade(skin, 0.78)}" opacity="0.32"/>`);
  p.push(`<path d="M${100 - f.w + 3} ${eyeY - 20} Q ${100 - f.w + 1} ${eyeY + 16} ${100 - f.w * 0.6} ${f.chin - 12}" stroke="#fff" stroke-width="3" fill="none" opacity="0.28" stroke-linecap="round"/>`);
  // Fringe shadow on the forehead
  if (L.hairStyle !== 'bald') p.push(`<path d="M${100 - f.w} ${f.top + 30} Q 100 ${f.top + 44} ${100 + f.w} ${f.top + 30} L ${100 + f.w} ${f.top} L ${100 - f.w} ${f.top} Z" fill="${shade(skin, 0.6)}" opacity="0.22"/>`);
  // Stubble / beard base inside the face
  if (beard === 'stubble') p.push(`<path d="M${100 - f.w} ${mouthY - 12} Q 100 ${mouthY - 4} ${100 + f.w} ${mouthY - 12} L ${100 + f.w} ${f.chin + 4} L ${100 - f.w} ${f.chin + 4} Z" fill="${css(hair)}" opacity="0.22"/>`);
  p.push(`</g>`);
  if (beard === 'full') p.push(`<path d="M${100 - f.w + 2} ${eyeY + 6} Q ${100 - f.w + 2} ${f.chin + 12} 100 ${f.chin + 14} Q ${100 + f.w - 2} ${f.chin + 12} ${100 + f.w - 2} ${eyeY + 6} Q ${100 + f.w - 8} ${mouthY + 2} 100 ${mouthY + 2} Q ${100 - f.w + 8} ${mouthY + 2} ${100 - f.w + 2} ${eyeY + 6} Z" fill="url(#${id}hr)" stroke="${ink(hair)}" stroke-width="1.8"/><path d="M92 ${f.chin + 2} q 8 6 16 0" stroke="${shade(hair, 1.35)}" stroke-width="2" fill="none" opacity="0.5"/>`);
  // Blush
  const bo = Math.min(1, m.blush);
  for (const sx of [-1, 1]) p.push(`<ellipse cx="${100 + sx * 27}" cy="${eyeY + 15}" rx="${11 + m.blush * 3}" ry="${6.5 + m.blush * 1.5}" fill="url(#${id}bl)" opacity="${bo}"/>`);
  if (mood === 'blush' || mood === 'angry') for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) p.push(`<path d="M${100 + sx * 27 - 6 + i * 5} ${eyeY + 18} l 3 -6" stroke="${mood === 'angry' ? '#c8403a' : '#e0605a'}" stroke-width="1.3" opacity="0.7" stroke-linecap="round"/>`);
  if (acc.has('freckles')) for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) p.push(`<circle cx="${100 + sx * (16 + (i % 3) * 5 + (i > 2 ? 2 : 0))}" cy="${eyeY + 10 + (i > 2 ? 5 : 0) + (i % 2)}" r="1.2" fill="${shade(skin, 0.62)}" opacity="0.75"/>`);
  if (old) {
    p.push(`<path d="M${100 - 26} ${f.top + 18} q 26 -5 52 0 M${100 - 20} ${f.top + 24} q 20 -3 40 0" stroke="${shade(skin, 0.72)}" stroke-width="1.1" fill="none" opacity="0.55"/>`);
    p.push(`<path d="M${100 - 13} ${eyeY + 14} q -4 10 -2 18 M${100 + 13} ${eyeY + 14} q 4 10 2 18" stroke="${shade(skin, 0.7)}" stroke-width="1.2" fill="none" opacity="0.55"/>`);
  }
  // Eyes + brows
  const ex = 20.5;
  p.push(eye(id, 100 - ex, eyeY, -1, m, iris, lash, skin, old));
  p.push(eye(id, 100 + ex, eyeY, 1, m, iris, lash, skin, old));
  const browC = L.hairStyle === 'bald' || L.hat ? shade(hair, 0.82) : shade(hair, 0.8);
  const browT = beard === 'full' || L.build > 1.3 ? 5 : 4;
  p.push(brow(100 - ex, eyeY - 18, -1, m, browC, browT));
  p.push(brow(100 + ex, eyeY - 18, 1, m, browC, browT));
  // Nose
  p.push(`<path d="M${99} ${eyeY + 6} Q ${103} ${eyeY + 14} ${98} ${eyeY + 17}" stroke="${shade(skin, 0.7)}" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="${101}" cy="${eyeY + 13}" rx="2.2" ry="1.6" fill="#fff" opacity="0.4"/>`);
  if (beard === 'full' || beard === 'mustache') {
    const mc = `url(#${id}hr)`;
    p.push(`<path d="M${100} ${mouthY - 7} Q ${88} ${mouthY - 12} ${78} ${mouthY - 2} Q ${86} ${mouthY - 3} ${92} ${mouthY - 1} Q ${97} ${mouthY - 3} ${100} ${mouthY - 5} Q ${103} ${mouthY - 3} ${108} ${mouthY - 1} Q ${114} ${mouthY - 3} ${122} ${mouthY - 2} Q ${112} ${mouthY - 12} ${100} ${mouthY - 7} Z" fill="${mc}" stroke="${ink(hair)}" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  p.push(mouth(mood, 100, mouthY + (beard === 'full' || beard === 'mustache' ? 2 : 0), skin, !!beard));
  if (L.glasses) {
    const gc = '#6a4424';
    for (const sx of [-1, 1]) p.push(`<circle cx="${100 + sx * ex}" cy="${eyeY - 1}" r="15" fill="#e8f4ff" fill-opacity="0.14" stroke="${gc}" stroke-width="3"/><path d="M${100 + sx * ex - 8} ${eyeY - 8} l 7 -5" stroke="#fff" stroke-width="2.4" opacity="0.7" stroke-linecap="round"/>`);
    p.push(`<path d="M${100 - 6} ${eyeY - 3} Q 100 ${eyeY - 7} ${100 + 6} ${eyeY - 3}" stroke="${gc}" stroke-width="3" fill="none"/>`);
    p.push(`<path d="M${100 - ex - 15} ${eyeY - 3} L ${100 - f.w} ${eyeY - 5} M${100 + ex + 15} ${eyeY - 3} L ${100 + f.w} ${eyeY - 5}" stroke="${gc}" stroke-width="2.6"/>`);
  }
  // Hair + hat
  p.push(frontHair(id, L, f));
  p.push(hat(L, f));
  if (acc.has('pencil')) p.push(`<path d="M${100 + f.w - 4} ${eyeY - 14} L ${100 + f.w + 20} ${eyeY - 30}" stroke="#f2c43a" stroke-width="5" stroke-linecap="round"/><path d="M${100 + f.w + 18} ${eyeY - 29} l 5 -3" stroke="#e8a0a0" stroke-width="5" stroke-linecap="round"/>`);
  if (acc.has('flower') && L.hat !== 'sunhat') p.push(`<circle cx="${100 - f.w + 6}" cy="${f.top + 16}" r="7" fill="#ff8fab" stroke="${ink(0xff8fab)}" stroke-width="1.2"/><circle cx="${100 - f.w + 6}" cy="${f.top + 16}" r="2.6" fill="#ffd166"/>`);
  if (acc.has('bandage')) p.push(`<g transform="rotate(-20 ${100 + 28} ${eyeY + 20})"><rect x="${100 + 20}" y="${eyeY + 17}" width="16" height="7" rx="3" fill="#f6e0c0" stroke="${ink(0xf6e0c0)}" stroke-width="1.2"/><path d="M${100 + 26} ${eyeY + 18.5} v 4 M${100 + 30} ${eyeY + 18.5} v 4" stroke="#d8b890" stroke-width="1"/></g>`);
  // Manga marks
  if (mood === 'sad') p.push(`<path d="M${100 + ex + 4} ${eyeY + 6} q -3 7 0 10 q 3 -3 0 -10 Z" fill="#8ac8f0" stroke="#4a8ac0" stroke-width="1"/>`);
  if (mood === 'worried') p.push(`<path d="M${100 + f.w - 6} ${f.top + 22} q -6 9 0 13 q 6 -4 0 -13 Z" fill="#9ad4f4" stroke="#4a8ac0" stroke-width="1.2"/>`);
  if (mood === 'angry') p.push(`<g stroke="#d8342a" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M${100 + f.w - 16} ${f.top + 8} q 4 4 8 0 M${100 + f.w - 12} ${f.top + 4} q 4 4 0 8 M${100 + f.w - 4} ${f.top + 8} q -4 4 -8 0"/></g>`);
  if (mood === 'surprised') p.push(`<g stroke="#5a3a2a" stroke-width="2.2" stroke-linecap="round"><path d="M${100 - f.w - 6} ${f.top + 4} l -8 -6 M${100 - f.w - 2} ${f.top - 4} l -4 -9 M${100 + f.w + 6} ${f.top + 4} l 8 -6 M${100 + f.w + 2} ${f.top - 4} l 4 -9"/></g>`);
  if (mood === 'blush' || mood === 'laugh') p.push(`<g fill="#fff6c0" stroke="#e8b84a" stroke-width="0.8"><path d="M${100 + f.w + 8} ${f.top + 10} l 2 5 l 5 2 l -5 2 l -2 5 l -2 -5 l -5 -2 l 5 -2 Z"/><path d="M${100 - f.w - 10} ${f.top + 30} l 1.4 3.6 l 3.6 1.4 l -3.6 1.4 l -1.4 3.6 l -1.4 -3.6 l -3.6 -1.4 l 3.6 -1.4 Z"/></g>`);
  if (mood === 'thinking') p.push(`<g fill="#fffaf0" stroke="#7a5a3a" stroke-width="1.4"><circle cx="${100 + f.w + 10}" cy="${f.top + 4}" r="3"/><circle cx="${100 + f.w + 18}" cy="${f.top - 6}" r="4.5"/><circle cx="${100 + f.w + 28}" cy="${f.top - 20}" r="7"/></g>`);
  p.push(`</g>`);
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${p.join('')}</svg>`;
}
