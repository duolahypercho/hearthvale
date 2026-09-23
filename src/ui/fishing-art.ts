/**
 * Procedural fishing art (inline SVG): every species in data/fish.ts is painted from its `look`
 * (body profile, back → side → belly gradient, pattern, fins, glossy eye). Used for inventory
 * icons (registered into ui/icons.ts ICONS at import time), the reel-minigame fish and the
 * catch card illustration. Also: the bamboo rod icon and the beach forageable icons.
 */
import { FISH, BEACH_FORAGE, FISH_BANDS, type FishDef } from '../data/fish';
import { registerItemIcon } from './icons';

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

function shade(c: number, k: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return hex((r << 16) | (g << 8) | b);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uid = 0;

/**
 * Side view of a fish, head to the left, in a 100 × 60 box. `detail` adds scale arcs, fin rays
 * and a softer outline (card illustration); icons keep it bold.
 */
export function fishSvg(def: FishDef, opts: { size?: number; detail?: boolean; tilt?: number; className?: string; square?: boolean } = {}): string {
  const k = def.look;
  const id = `hvf${uid++}`;
  const r = rng(hashStr(def.id));
  const eel = k.tail === 'eel';
  const flat = !!k.flat;
  // Body box: nose x0 → peduncle xp; depth D around cy.
  const cy = 30;
  const x0 = eel ? 6 : 10;
  const xp = eel ? 90 : flat ? 74 : 76;
  const D = Math.min(48, (eel ? 0.16 : k.depth) * 100 * (flat ? 0.95 : 1.05));
  const H = D / 2;
  const ph = eel ? H * 0.55 : Math.max(2.6, H * 0.26); // peduncle half-height
  const bx = x0 + (xp - x0) * (flat ? 0.45 : 0.36); // widest point
  const line = shade(k.back, 0.42);
  const sw = opts.detail ? 1.4 : 2.2;

  const body = eel
    ? `M${x0} ${cy} C${x0 + 2} ${cy - H * 1.2} ${x0 + 14} ${cy - H} ${x0 + 24} ${cy - H} L${xp} ${cy - ph} L${xp} ${cy + ph} L${x0 + 24} ${cy + H} C${x0 + 14} ${cy + H} ${x0 + 2} ${cy + H * 1.2} ${x0} ${cy} Z`
    : `M${x0} ${cy + H * 0.08} C${x0 + 1} ${cy - H * 0.7} ${bx - (bx - x0) * 0.55} ${cy - H * 1.02} ${bx} ${cy - H} C${bx + (xp - bx) * 0.45} ${cy - H * 0.98} ${xp - 6} ${cy - ph * 1.6} ${xp} ${cy - ph} L${xp} ${cy + ph} C${xp - 6} ${cy + ph * 1.6} ${bx + (xp - bx) * 0.45} ${cy + H * 0.98} ${bx} ${cy + H} C${bx - (bx - x0) * 0.5} ${cy + H * 1.0} ${x0 + 1} ${cy + H * 0.62} ${x0} ${cy + H * 0.08} Z`;

  // Tail
  const tx = xp - 1;
  const tl = eel ? 8 : Math.max(12, D * 0.42);
  const th = eel ? H * 1.1 : Math.max(9, H * 0.95);
  let tail: string;
  switch (k.tail) {
    case 'fork':
      tail = `M${tx} ${cy - ph} C${tx + tl * 0.5} ${cy - th * 0.6} ${tx + tl * 0.8} ${cy - th} ${tx + tl} ${cy - th * 1.02} C${tx + tl * 0.72} ${cy - th * 0.35} ${tx + tl * 0.55} ${cy} ${tx + tl * 0.55} ${cy} C${tx + tl * 0.55} ${cy} ${tx + tl * 0.72} ${cy + th * 0.35} ${tx + tl} ${cy + th * 1.02} C${tx + tl * 0.8} ${cy + th} ${tx + tl * 0.5} ${cy + th * 0.6} ${tx} ${cy + ph} Z`;
      break;
    case 'moon':
      tail = `M${tx} ${cy - ph} C${tx + tl * 0.4} ${cy - th * 0.5} ${tx + tl * 0.9} ${cy - th * 1.1} ${tx + tl * 1.05} ${cy - th * 1.25} C${tx + tl * 0.7} ${cy - th * 0.4} ${tx + tl * 0.62} ${cy} ${tx + tl * 0.62} ${cy} C${tx + tl * 0.62} ${cy} ${tx + tl * 0.7} ${cy + th * 0.4} ${tx + tl * 1.05} ${cy + th * 1.25} C${tx + tl * 0.9} ${cy + th * 1.1} ${tx + tl * 0.4} ${cy + th * 0.5} ${tx} ${cy + ph} Z`;
      break;
    case 'fan':
      tail = `M${tx} ${cy - ph} C${tx + tl * 0.5} ${cy - th * 0.9} ${tx + tl * 1.1} ${cy - th * 1.2} ${tx + tl * 1.15} ${cy - th * 0.6} C${tx + tl * 1.3} ${cy - th * 0.2} ${tx + tl * 1.3} ${cy + th * 0.2} ${tx + tl * 1.15} ${cy + th * 0.6} C${tx + tl * 1.1} ${cy + th * 1.2} ${tx + tl * 0.5} ${cy + th * 0.9} ${tx} ${cy + ph} Z`;
      break;
    case 'eel':
      tail = `M${tx} ${cy - ph} C${tx + tl * 0.6} ${cy - ph * 1.1} ${tx + tl} ${cy - ph * 0.4} ${tx + tl * 1.2} ${cy} C${tx + tl} ${cy + ph * 0.4} ${tx + tl * 0.6} ${cy + ph * 1.1} ${tx} ${cy + ph} Z`;
      break;
    default:
      tail = `M${tx} ${cy - ph} C${tx + tl * 0.6} ${cy - th * 0.9} ${tx + tl * 1.05} ${cy - th * 0.75} ${tx + tl * 1.05} ${cy} C${tx + tl * 1.05} ${cy + th * 0.75} ${tx + tl * 0.6} ${cy + th * 0.9} ${tx} ${cy + ph} Z`;
  }

  // Dorsal / anal / pectoral fins
  const dh = Math.max(0, k.dorsal) * H * 0.95;
  const d0 = eel ? x0 + 16 : x0 + (xp - x0) * 0.3;
  const d1 = eel ? xp - 2 : x0 + (xp - x0) * 0.78;
  const topAt = (x: number): number => {
    if (eel) return cy - H * 0.98;
    const t = (x - x0) / (xp - x0);
    return cy - (ph + (H - ph) * Math.sin(Math.min(1, t / 0.36) * Math.PI * 0.5) * (t < 0.36 ? 1 : 1 - Math.pow((t - 0.36) / 0.64, 1.6)));
  };
  const botAt = (x: number): number => 2 * cy - topAt(x);
  let dorsal = '';
  if (dh > 0.5) {
    const spiky = k.dorsal >= 0.7;
    const pts: string[] = [`M${d0} ${topAt(d0) + 1.5}`];
    if (spiky) {
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const x = d0 + ((d1 - d0) * i) / n;
        const hh = dh * (1 - Math.pow((i / n) * 1.1 - 0.35, 2) * 0.9);
        pts.push(`L${x + 1.2} ${topAt(x) - hh}`, `L${x + (d1 - d0) / n * 0.7} ${topAt(x) - hh * 0.62}`);
      }
    } else {
      pts.push(`C${d0 + (d1 - d0) * 0.15} ${topAt(d0) - dh * 1.1} ${d0 + (d1 - d0) * 0.5} ${topAt(d0) - dh * 1.05} ${d1} ${topAt(d1) - dh * 0.15}`);
    }
    pts.push(`L${d1} ${topAt(d1) + 1.5} Z`);
    dorsal = pts.join(' ');
  }
  const a0 = x0 + (xp - x0) * (eel ? 0.35 : 0.6);
  const a1 = x0 + (xp - x0) * (eel ? 0.97 : 0.84);
  const anal = eel
    ? `M${a0} ${botAt(a0) - 1} C${a0 + 10} ${botAt(a0) + H * 0.6} ${a1 - 10} ${botAt(a1) + H * 0.5} ${a1} ${botAt(a1) - 1} Z`
    : `M${a0} ${botAt(a0) - 1.5} C${a0 + 2} ${botAt(a0) + H * 0.45} ${a1 - 3} ${botAt(a1) + H * 0.3} ${a1} ${botAt(a1) - 1} Z`;
  const px = x0 + (xp - x0) * 0.26;
  const py = cy + H * 0.25;
  const pect = `M${px} ${py} C${px + 6} ${py - 2} ${px + 14} ${py + 2} ${px + 15} ${py + 8} C${px + 9} ${py + 8} ${px + 4} ${py + 5} ${px} ${py} Z`;

  // Pattern (clipped to body)
  const pat: string[] = [];
  const pc = hex(k.patternColor);
  switch (k.pattern) {
    case 'stripes':
      for (let i = 0; i < 4; i++) {
        const y = cy - H * 0.75 + i * H * 0.36;
        pat.push(`<path d="M${x0} ${y} Q${(x0 + xp) / 2} ${y - 3 + (i % 2) * 5} ${xp} ${y + (cy - y) * 0.6}" stroke="${pc}" stroke-width="${Math.max(1.8, H * 0.12)}" fill="none" stroke-linecap="round" opacity="0.8"/>`);
      }
      break;
    case 'bars':
      for (let i = 0; i < 5; i++) {
        const x = x0 + (xp - x0) * (0.24 + i * 0.14);
        pat.push(`<path d="M${x} ${cy - H * 1.1} Q${x + 3} ${cy} ${x - 1} ${cy + H * 0.45}" stroke="${pc}" stroke-width="${Math.max(3, D * 0.1)}" fill="none" stroke-linecap="round" opacity="0.72"/>`);
      }
      break;
    case 'spots': {
      const n = eel ? 12 : 9 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const x = x0 + (xp - x0) * (0.2 + r() * 0.72);
        const y = cy - H * 0.8 + r() * H * (eel ? 1.8 : 1.4);
        pat.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.4 + r() * Math.max(1.2, H * 0.14)).toFixed(1)}" fill="${pc}" opacity="0.9"/>`);
      }
      break;
    }
    case 'speckle':
      for (let i = 0; i < 26; i++) {
        const x = x0 + (xp - x0) * (0.15 + r() * 0.82);
        const y = cy - H * 0.9 + r() * H * 1.25;
        pat.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.7 + r() * 1.1).toFixed(1)}" fill="${pc}" opacity="0.7"/>`);
      }
      break;
    case 'band':
      pat.push(`<path d="M${x0 + 8} ${cy - 1} Q${(x0 + xp) / 2} ${cy - 3} ${xp} ${cy}" stroke="${pc}" stroke-width="${Math.max(2.4, H * 0.22)}" fill="none" stroke-linecap="round" opacity="0.85"/>`);
      break;
  }
  if (opts.detail) {
    // Scale arcs + lateral line.
    for (let yy = cy - H * 0.7; yy < cy + H * 0.7; yy += 4.2) {
      for (let xx = x0 + 18 + ((yy / 4.2) % 2) * 2.5; xx < xp - 4; xx += 5) {
        pat.push(`<path d="M${xx.toFixed(1)} ${(yy - 1.8).toFixed(1)} q2.2 1.8 0 3.6" stroke="#ffffff" stroke-width="0.5" fill="none" opacity="0.22"/>`);
      }
    }
    pat.push(`<path d="M${x0 + 14} ${cy - H * 0.18} Q${(x0 + xp) / 2} ${cy - H * 0.3} ${xp - 2} ${cy - 0.5}" stroke="${shade(k.back, 0.6)}" stroke-width="0.8" fill="none" opacity="0.5"/>`);
  }

  // Head: gill arc, eye, mouth.
  const ex = x0 + (eel ? 7 : Math.max(8, (bx - x0) * 0.42));
  const ey = cy - H * (flat ? 0.45 : 0.28);
  const er = Math.max(2.6, Math.min(5.4, D * 0.1));
  const gx = x0 + (bx - x0) * 0.85;
  const gill = eel ? '' : `<path d="M${gx} ${cy - H * 0.62} Q${gx + 5} ${cy} ${gx} ${cy + H * 0.62}" stroke="${shade(k.side, 0.55)}" stroke-width="${sw * 0.6}" fill="none" stroke-linecap="round" opacity="0.8"/>`;
  const eye2 = flat ? `<circle cx="${ex + er * 2.4}" cy="${ey - er * 0.5}" r="${er * 0.9}" fill="#fbfbf4" stroke="${line}" stroke-width="${sw * 0.45}"/><circle cx="${ex + er * 2.2}" cy="${ey - er * 0.5}" r="${er * 0.5}" fill="#161a20"/>` : '';

  const size = opts.size ?? 24;
  const tilt = opts.tilt ?? 0;
  const vb = opts.square ? '-2 -24 108 108' : '-4 -8 112 76';
  const hgt = opts.square ? size : (size * 76) / 112;
  return `<svg class="${opts.className ?? 'ic-fish'}" viewBox="${vb}" width="${size}" height="${hgt}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="${cy - H}" x2="0" y2="${cy + H}">
      ${FISH_BANDS.map(([f, ch, b]) => `<stop offset="${f}" stop-color="${shade(k[ch], b)}"/>`).join('')}
    </linearGradient>
    <linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${shade(k.fin, 0.8)}"/><stop offset="1" stop-color="${shade(k.fin, 1.12)}"/></linearGradient>
    <radialGradient id="${id}g" cx="0.35" cy="0.25" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}c"><path d="${body}"/></clipPath>
  </defs>
  <g transform="rotate(${tilt} 52 30)" stroke-linejoin="round">
    <path d="${tail}" fill="url(#${id}f)" stroke="${line}" stroke-width="${sw}"/>
    ${dorsal ? `<path d="${dorsal}" fill="url(#${id}f)" stroke="${line}" stroke-width="${sw}"/>` : ''}
    <path d="${anal}" fill="url(#${id}f)" stroke="${line}" stroke-width="${sw}"/>
    <path d="${body}" fill="url(#${id}b)" stroke="${line}" stroke-width="${sw}"/>
    <g clip-path="url(#${id}c)">${pat.join('')}<ellipse cx="${(x0 + bx) / 2 + 6}" cy="${cy - H * 0.5}" rx="${(bx - x0) * 0.9}" ry="${H * 0.45}" fill="url(#${id}g)"/></g>
    ${gill}
    <path d="${pect}" fill="url(#${id}f)" stroke="${line}" stroke-width="${sw * 0.7}" opacity="0.95"/>
    <circle cx="${ex}" cy="${ey}" r="${er}" fill="#fbfbf4" stroke="${line}" stroke-width="${sw * 0.5}"/>
    <circle cx="${ex - er * 0.18}" cy="${ey + er * 0.05}" r="${er * 0.58}" fill="#161a20"/>
    <circle cx="${ex - er * 0.36}" cy="${ey - er * 0.22}" r="${er * 0.22}" fill="#ffffff"/>
    ${eye2}
    <path d="M${x0 + 0.5} ${cy + H * 0.12} q3 ${eel ? 1 : 2.4} 6 ${eel ? 0.5 : 1.2}" stroke="${line}" stroke-width="${sw * 0.55}" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;
}

/** Bamboo rod with a cork grip, brass reel and a red-white bobber on the line. */
const ROD_ICON = `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg" stroke-linecap="round">
  <path d="M4 21 L20 3.5" stroke="#6a4a22" stroke-width="3.1"/><path d="M4 21 L20 3.5" stroke="#d8b25a" stroke-width="1.8"/>
  <path d="M8.2 16.4 l0.9 0.9 M11.4 12.9 l0.9 0.9 M14.6 9.4 l0.9 0.9 M17.6 6.1 l0.8 0.8" stroke="#8a6a2a" stroke-width="1.1"/>
  <path d="M3.6 21.4 L7.4 17.2" stroke="#5a3a1a" stroke-width="3.8"/><path d="M3.6 21.4 L7.4 17.2" stroke="#c89060" stroke-width="2.4"/>
  <circle cx="8.6" cy="18.2" r="2.1" fill="#d8b04a" stroke="#6a4a1a" stroke-width="1"/><circle cx="8.6" cy="18.2" r="0.7" fill="#6a4a1a"/>
  <path d="M20 3.5 Q21.5 9 20.2 14.2" stroke="#f4f4f4" stroke-width="0.7" fill="none"/>
  <circle cx="20.2" cy="16" r="1.9" fill="#e84a3a" stroke="#6a1a14" stroke-width="0.9"/><path d="M18.4 16.2 a1.9 1.9 0 0 0 3.7 0 z" fill="#fafafa"/>
</svg>`;

const GEAR_ICONS: Record<string, string> = {
  bait: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><path d="M5 9 C5 6 8 4.5 12 4.5 C16 4.5 19 6 19 9 L18 19 C18 20.5 15.5 21.5 12 21.5 C8.5 21.5 6 20.5 6 19 Z" fill="#b8865a" stroke="#5a3a1a" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.2 9.2 C7 10.6 17 10.6 18.8 9.2" stroke="#5a3a1a" stroke-width="1.1" fill="none"/><path d="M9 6.6 Q12 3 15 6.6" stroke="#e86a7a" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M8.5 7.5 Q10 5.8 11.5 7.2" stroke="#f29aa6" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="8.5" y="12.5" width="7" height="4.5" rx="1" fill="#f2e2c0" stroke="#5a3a1a" stroke-width="0.9"/><path d="M10 14.8 h4" stroke="#5a3a1a" stroke-width="0.9"/></svg>`,
  treasureLure: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5 V6" stroke="#6a6a6a" stroke-width="1.2"/><circle cx="12" cy="6.5" r="1.3" fill="none" stroke="#6a6a6a" stroke-width="1"/><path d="M12 7.8 C16.5 9.5 16.5 15 12 17.5 C7.5 15 7.5 9.5 12 7.8 Z" fill="#f2c84a" stroke="#7a5212" stroke-width="1.3"/><path d="M11 9.8 C9.8 11.5 9.8 13.5 11 15" stroke="#fff6c8" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M12 17.5 V19.5 M12 19.5 C12 21.5 14.5 21.5 14.5 19.8" stroke="#5a5a5a" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="17.5" cy="7" r="1.1" fill="#fffbe0"/><path d="M17.5 4.8 V9.2 M15.3 7 H19.7" stroke="#fffbe0" stroke-width="0.8"/></svg>`,
  corkBobber: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5 V7" stroke="#c8382a" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="12" cy="13" rx="6.2" ry="7" fill="#d8a070" stroke="#6a4020" stroke-width="1.3"/><path d="M5.9 12 C8 13.6 16 13.6 18.1 12" stroke="#c8382a" stroke-width="2.4" fill="none"/><g fill="#a87040"><circle cx="9.5" cy="9.5" r="0.7"/><circle cx="14" cy="10" r="0.6"/><circle cx="10.5" cy="16.5" r="0.7"/><circle cx="14.5" cy="16" r="0.6"/></g><path d="M12 20 V22" stroke="#6a4020" stroke-width="1.2"/></svg>`,
};

const FORAGE_ICONS: Record<string, string> = {
  cockle: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><path d="M12 20 L4.5 11 C4.5 6 8 3.5 12 3.5 C16 3.5 19.5 6 19.5 11 Z" fill="#f2dcbc" stroke="#8a6440" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 20 L7 6.5 M12 20 L9.5 4.5 M12 20 L12 3.8 M12 20 L14.5 4.5 M12 20 L17 6.5" stroke="#c89a70" stroke-width="1"/><path d="M9.5 20.5 h5 v1.5 h-5z" fill="#d8b894" stroke="#8a6440" stroke-width="1"/></svg>`,
  spiralConch: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><path d="M4 16 C3 10 9 4 15 4 C19 4 21 7 20 10 C19 13 15 13 14 11 C13 9 15 8 16 9" fill="none" stroke="#8a5a44" stroke-width="1.3"/><path d="M4 16 C3 10 9 4 15 4 C19 4 21 7 20 10 L18 18 C14 21 7 21 4 16 Z" fill="#f4c2a8" stroke="#8a5a44" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 15 C9 17 14 17 18 15" stroke="#e08a78" stroke-width="1.1" fill="none"/><path d="M8 11 C11 13 15 12 17 10" stroke="#e08a78" stroke-width="1" fill="none"/><ellipse cx="13.5" cy="16.5" rx="3" ry="1.5" fill="#fbe0d4"/></svg>`,
  starfish: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.8 L14.4 9.2 L21 9.6 L15.8 13.7 L17.8 20.4 L12 16.6 L6.2 20.4 L8.2 13.7 L3 9.6 L9.6 9.2 Z" fill="#f2863e" stroke="#8a3a16" stroke-width="1.3" stroke-linejoin="round"/><g fill="#ffd0a0"><circle cx="12" cy="8" r="0.8"/><circle cx="12" cy="12" r="1"/><circle cx="16" cy="11" r="0.7"/><circle cx="8" cy="11" r="0.7"/><circle cx="14.5" cy="15.5" r="0.7"/><circle cx="9.5" cy="15.5" r="0.7"/></g></svg>`,
  sandDollar: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8.5" fill="#f2ead2" stroke="#8a7a58" stroke-width="1.3"/><g fill="none" stroke="#b8a47a" stroke-width="1.2" stroke-linecap="round"><path d="M12 11 V5.5"/><path d="M12.9 11.7 L17.8 9.3"/><path d="M11.1 11.7 L6.2 9.3"/><path d="M12.6 12.9 L15.6 17.3"/><path d="M11.4 12.9 L8.4 17.3"/></g></svg>`,
  seaGlass: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg"><path d="M6 8 C8 4 16 3.5 18.5 7.5 C20.5 11 18 18 13 19.5 C8 21 4 16.5 4.5 12.5 Z" fill="#7ad0b8" fill-opacity="0.85" stroke="#2f7a66" stroke-width="1.3"/><path d="M8 8 C10 6 13 5.8 15 6.8" stroke="#e8fff8" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.8"/></svg>`,
  coralSprig: `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg" stroke-linecap="round"><g stroke="#8a2a34" stroke-width="3.6"><path d="M12 21 V12 M12 14 L7 8 M12 12 L16 6 M7 8 L6 4 M7 8 L4 9 M16 6 L19 5 M16 9 L19 11 M12 16 L16 9"/></g><g stroke="#f07a82" stroke-width="2.2"><path d="M12 21 V12 M12 14 L7 8 M12 12 L16 6 M7 8 L6 4 M7 8 L4 9 M16 6 L19 5 M16 9 L19 11 M12 16 L16 9"/></g></svg>`,
};

let registered = false;

/** Adds the rod, every fish and the beach forageables to the shared icon table. */
export function registerFishingIcons(): void {
  if (registered) return;
  registered = true;
  registerItemIcon('rod', ROD_ICON);
  for (const f of FISH) registerItemIcon(f.id, () => fishSvg(f, { size: 64, tilt: -28, className: 'ic', square: true }));
  for (const [id, svg] of Object.entries(GEAR_ICONS)) registerItemIcon(id, svg);
  for (const f of BEACH_FORAGE) {
    const svg = FORAGE_ICONS[f.id];
    if (svg) registerItemIcon(f.id, svg);
  }
}

registerFishingIcons();
