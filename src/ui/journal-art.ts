/**
 * Story UI art (inline SVG, procedural): room lanterns that glow with progress, cloth bundle sacks,
 * push pins, wax seals, envelopes and the little hall floor-plan used by the journal.
 */
import { itemDef } from '../data/items';
import { CROPS } from '../data/crops';
import { fishDef } from '../data/fish';
import { itemIcon } from './icons';
import { BUNDLES } from '../data/bundles';

const css = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
function shade(h: number, k: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((h >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((h >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((h & 255) * k)));
  return css((r << 16) | (g << 8) | b);
}
let uid = 0;

/** A hanging iron lantern; `glow` 0..1 fills the glass with the room's flame colour. */
export function lanternSvg(color: number, glow: number, cls = 'jl-lantern'): string {
  const id = `jl${uid++}`;
  const lit = glow > 0.02;
  const g = Math.max(0, Math.min(1, glow));
  // Warm brass cap + base (a lit rim on the left, bronze in shadow), a dark bronze cage, room-tinted glass.
  return `<svg class="${cls}${lit ? ' lit' : ''}" viewBox="0 0 100 140" aria-hidden="true" style="--g:${g.toFixed(2)};--c:${css(color)}">
  <defs>
    <radialGradient id="${id}f" cx="50%" cy="58%" r="55%"><stop offset="0" stop-color="#fffbe8"/><stop offset=".35" stop-color="${shade(color, 1.25)}"/><stop offset="1" stop-color="${shade(color, 0.7)}"/></radialGradient>
    <radialGradient id="${id}h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${css(color)}" stop-opacity=".65"/><stop offset="1" stop-color="${css(color)}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}d" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${shade(color, 0.32)}"/><stop offset="1" stop-color="#241a16"/></linearGradient>
    <linearGradient id="${id}b" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#f2c878"/><stop offset=".35" stop-color="#c8903e"/><stop offset="1" stop-color="#6a4020"/></linearGradient>
  </defs>
  ${lit ? `<circle cx="50" cy="78" r="${46 + g * 8}" fill="url(#${id}h)" opacity="${(0.35 + g * 0.65).toFixed(2)}"/>` : ''}
  <path d="M50 4 v10" stroke="#4a3222" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="50" cy="6" r="4.5" fill="none" stroke="#8a5a2a" stroke-width="3"/>
  <path d="M26 34 L50 16 L74 34 Z" fill="url(#${id}b)" stroke="#3a2414" stroke-width="2" stroke-linejoin="round"/>
  <path d="M32 31 L50 19" stroke="#ffe0a0" stroke-width="2" stroke-linecap="round" opacity=".7"/>
  <rect x="24" y="33" width="52" height="6" rx="2" fill="url(#${id}b)" stroke="#3a2414" stroke-width="1.2"/>
  <rect x="29" y="39" width="42" height="62" rx="8" fill="url(#${id}d)"/>
  <rect x="29" y="39" width="42" height="62" rx="8" fill="url(#${id}f)" opacity="${g.toFixed(2)}"/>
  ${lit ? `<path d="M50 ${86 - g * 22} C ${43 - g * 2} ${80 - g * 10}, 44 88, 50 92 C 56 88, ${57 + g * 2} ${80 - g * 10}, 50 ${86 - g * 22} Z" fill="#fffdf2" opacity="${(0.5 + g * 0.5).toFixed(2)}"/>` : `<path d="M50 80 v10" stroke="#5a5048" stroke-width="2.5" stroke-linecap="round"/>`}
  <path d="M50 39 V101 M29 70 H71" stroke="#3a2618" stroke-width="3" opacity=".9"/>
  <rect x="29" y="39" width="42" height="62" rx="8" fill="none" stroke="#3a2618" stroke-width="4"/>
  <path d="M31 46 v46" stroke="#e8b060" stroke-width="1.6" opacity=".55" stroke-linecap="round"/>
  <path d="M34 44 q4 -2 6 2 v22" stroke="#fff" stroke-width="2.5" fill="none" opacity="${lit ? 0.45 : 0.18}" stroke-linecap="round"/>
  <path d="M24 101 H76 L68 112 H32 Z" fill="url(#${id}b)" stroke="#3a2414" stroke-width="2" stroke-linejoin="round"/>
  <path d="M44 112 v8 h12 v-8" fill="#5a3a1e"/>
</svg>`;
}

/**
 * The room's own lantern, painted to match its 3D cage in the Hall: Seed's verdigris globe with pink
 * enamel petals, Sun's gilded sunburst, Harvest's iron-ribbed pumpkin, Hearth's silver onion dome with
 * icicles, the Crafter's geared copper box, the Tide room's teal ship's lantern. `glow` 0..1.
 */
export function cageSvg(room: string, color: number, glow: number, cls = 'jl-lantern'): string {
  const id = `jc${uid++}`;
  const g = Math.max(0, Math.min(1, glow));
  const lit = g > 0.02;
  const METAL: Record<string, [string, string, string]> = {
    seed: ['#9fd0b8', '#4f8a74', '#24453a'],
    sun: ['#ffe9a0', '#d9a83a', '#7a5214'],
    harvest: ['#8a8078', '#4a423c', '#1f1a17'],
    hearth: ['#f4f8fc', '#a8b4c2', '#4e5a68'],
    craft: ['#ffc89a', '#c8743a', '#6a3416'],
    tide: ['#a8e8e0', '#3a8a84', '#16403e'],
  };
  const [m0, m1, m2] = METAL[room] ?? METAL.sun!;
  const defs = `<defs>
    <radialGradient id="${id}f" cx="50%" cy="60%" r="58%"><stop offset="0" stop-color="#fffbe8"/><stop offset=".38" stop-color="${shade(color, 1.25)}"/><stop offset="1" stop-color="${shade(color, 0.62)}"/></radialGradient>
    <radialGradient id="${id}h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${css(color)}" stop-opacity=".7"/><stop offset=".55" stop-color="${css(color)}" stop-opacity=".18"/><stop offset="1" stop-color="${css(color)}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}d" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${shade(color, 0.3)}"/><stop offset="1" stop-color="#1e1614"/></linearGradient>
    <linearGradient id="${id}m" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${m0}"/><stop offset=".4" stop-color="${m1}"/><stop offset="1" stop-color="${m2}"/></linearGradient>
  </defs>`;
  const halo = lit ? `<circle cx="50" cy="76" r="${46 + g * 10}" fill="url(#${id}h)" opacity="${(0.3 + g * 0.7).toFixed(2)}"/>` : '';
  const flame = (cy: number): string =>
    lit
      ? `<path d="M50 ${cy - 8 - g * 14} C ${43 - g * 2} ${cy - 4 - g * 6}, 44 ${cy + 4}, 50 ${cy + 8} C 56 ${cy + 4}, ${57 + g * 2} ${cy - 4 - g * 6}, 50 ${cy - 8 - g * 14} Z" fill="#fffdf2" opacity="${(0.55 + g * 0.45).toFixed(2)}"/>`
      : `<path d="M50 ${cy} v8" stroke="#5a5048" stroke-width="2.5" stroke-linecap="round"/>`;
  // Glass body: dark when unlit, the room's flame colour as it fills.
  const glass = (shape: string): string => `${shape.replace('FILL', `url(#${id}d)`)}${shape.replace('FILL', `url(#${id}f)`).replace('/>', ` opacity="${g.toFixed(2)}"/>`)}`;
  const ring = `<path d="M50 3 v9" stroke="#3a2618" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="5" r="4.2" fill="none" stroke="${m1}" stroke-width="2.6"/>`;
  const S = `stroke="${m2}" stroke-width="2.4" stroke-linejoin="round"`;
  let body = '';
  switch (room) {
    case 'seed': {
      const petals = [-60, -30, 0, 30, 60].map((a) => `<ellipse cx="50" cy="30" rx="6" ry="13" transform="rotate(${a} 50 42)" fill="#f2a6c0" stroke="#a8466a" stroke-width="1.6"/>`).join('');
      body = `${petals}<path d="M50 14 q-6 8 0 16 q6 -8 0 -16 Z" fill="#7ab84a" stroke="#3a6a24" stroke-width="1.4"/>
        <rect x="40" y="40" width="20" height="6" rx="2" fill="url(#${id}m)" ${S}/>
        ${glass(`<circle cx="50" cy="76" r="28" fill="FILL"/>`)}
        <path d="M50 48 V104 M22 76 H78 M30 56 Q50 66 70 56 M30 96 Q50 86 70 96" stroke="${m1}" stroke-width="2.6" fill="none"/>
        <circle cx="50" cy="76" r="28" fill="none" ${S} stroke-width="4"/>
        ${flame(80)}
        <path d="M38 104 H62 L58 114 H42 Z" fill="url(#${id}m)" ${S}/>`;
      break;
    }
    case 'sun': {
      const rays = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const x = 50 + Math.cos(a) * 15;
        const y = 30 + Math.sin(a) * 15;
        const x2 = 50 + Math.cos(a) * (i % 2 ? 22 : 27);
        const y2 = 30 + Math.sin(a) * (i % 2 ? 22 : 27);
        return `<path d="M${(x - Math.sin(a) * 3).toFixed(1)} ${(y + Math.cos(a) * 3).toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${(x + Math.sin(a) * 3).toFixed(1)} ${(y - Math.cos(a) * 3).toFixed(1)} Z" fill="url(#${id}m)" stroke="${m2}" stroke-width="1"/>`;
      }).join('');
      body = `${rays}<circle cx="50" cy="30" r="12" fill="url(#${id}m)" ${S}/>
        <rect x="27" y="44" width="46" height="7" rx="3" fill="url(#${id}m)" ${S}/>
        ${glass(`<rect x="31" y="51" width="38" height="52" rx="10" fill="FILL"/>`)}
        <path d="M43.6 51 V103 M56.4 51 V103" stroke="${m1}" stroke-width="2.4"/>
        <rect x="31" y="51" width="38" height="52" rx="10" fill="none" ${S} stroke-width="4"/>
        ${flame(82)}
        <path d="M25 103 H75 L67 114 H33 Z" fill="url(#${id}m)" ${S}/>`;
      break;
    }
    case 'harvest': {
      body = `<path d="M50 30 q2 -10 10 -12" stroke="#5a7a2a" stroke-width="4" fill="none" stroke-linecap="round"/>
        <rect x="42" y="28" width="16" height="8" rx="2" fill="url(#${id}m)" ${S}/>
        ${glass(`<ellipse cx="50" cy="72" rx="33" ry="30" fill="FILL"/>`)}
        <path d="M50 42 V102 M34 45 Q24 72 34 99 M66 45 Q76 72 66 99 M42 42.5 Q36 72 42 101.5 M58 42.5 Q64 72 58 101.5" stroke="${m1}" stroke-width="3" fill="none"/>
        <ellipse cx="50" cy="72" rx="33" ry="30" fill="none" ${S} stroke-width="4"/>
        ${flame(76)}
        <path d="M34 101 H66 L60 114 H40 Z" fill="url(#${id}m)" ${S}/>`;
      break;
    }
    case 'hearth': {
      const ice = [30, 37, 44, 51, 58, 65].map((x, i) => `<path d="M${x} 104 l3 ${8 + (i % 3) * 4} l3 -${8 + (i % 3) * 4} Z" fill="#e8f6ff" stroke="#8ab4d8" stroke-width="1"/>`).join('');
      body = `<path d="M50 12 C 40 22, 28 30, 30 44 H70 C 72 30, 60 22, 50 12 Z" fill="url(#${id}m)" ${S}/>
        <circle cx="50" cy="13" r="3" fill="${m0}" ${S} stroke-width="1.4"/>
        ${glass(`<rect x="32" y="44" width="36" height="58" rx="6" fill="FILL"/>`)}
        <path d="M44 44 V102 M56 44 V102 M32 73 H68" stroke="${m1}" stroke-width="2.2"/>
        <rect x="32" y="44" width="36" height="58" rx="6" fill="none" ${S} stroke-width="4"/>
        ${flame(78)}
        <rect x="27" y="100" width="46" height="6" rx="2" fill="url(#${id}m)" ${S}/>${ice}`;
      break;
    }
    case 'craft': {
      const teeth = Array.from({ length: 10 }, (_, i) => `<rect x="47.5" y="15" width="5" height="7" fill="url(#${id}m)" stroke="${m2}" stroke-width="1" transform="rotate(${i * 36} 50 28)"/>`).join('');
      body = `${teeth}<circle cx="50" cy="28" r="10" fill="url(#${id}m)" ${S}/><circle cx="50" cy="28" r="3.5" fill="${m2}"/>
        <rect x="26" y="38" width="48" height="7" rx="1.5" fill="url(#${id}m)" ${S}/>
        ${glass(`<rect x="29" y="45" width="42" height="56" rx="3" fill="FILL"/>`)}
        <path d="M29 73 H71 M50 45 V101" stroke="${m1}" stroke-width="3"/>
        <rect x="29" y="45" width="42" height="56" rx="3" fill="none" ${S} stroke-width="4.5"/>
        ${[33, 67].map((x) => [49, 97].map((y) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${m0}"/>`).join('')).join('')}
        ${flame(80)}
        <rect x="24" y="101" width="52" height="9" rx="1.5" fill="url(#${id}m)" ${S}/>`;
      break;
    }
    default: {
      body = `<path d="M36 34 Q50 14 64 34" stroke="${m1}" stroke-width="3.5" fill="none"/>
        <ellipse cx="50" cy="38" rx="20" ry="6" fill="url(#${id}m)" ${S}/>
        ${glass(`<path d="M32 44 Q30 74 32 102 H68 Q70 74 68 44 Z" fill="FILL"/>`)}
        <path d="M40 44 Q38 74 40 102 M50 44 V102 M60 44 Q62 74 60 102" stroke="${m1}" stroke-width="2.2" fill="none"/>
        <path d="M31 58 H69 M30.5 88 H69.5" stroke="${m1}" stroke-width="4"/>
        <path d="M32 44 Q30 74 32 102 H68 Q70 74 68 44 Z" fill="none" ${S} stroke-width="4"/>
        ${flame(78)}
        <ellipse cx="50" cy="104" rx="22" ry="6" fill="url(#${id}m)" ${S}/>`;
    }
  }
  return `<svg class="${cls}${lit ? ' lit' : ''}" viewBox="0 0 100 140" aria-hidden="true" style="--g:${g.toFixed(2)};--c:${css(color)}">${defs}${halo}${ring}${body}
    <path d="M34 50 q3 -2 5 2 v20" stroke="#fff" stroke-width="2.4" fill="none" opacity="${lit ? 0.4 : 0.16}" stroke-linecap="round"/></svg>`;
}

/** Cloth bundle sack tied with a ribbon; plump + gold ribbon when complete. */
/** Which container a bundle is drawn as — a cloth sack, a woven basket, a slatted crate or a stoneware
 * crock — so the four tabs of a room read apart at a glance, not as four tinted gourds. */
export type SackKind = 0 | 1 | 2 | 3;
export function sackKindOf(bundleId: string): SackKind {
  const def = BUNDLES.find((b) => b.id === bundleId);
  if (!def) return 0;
  const n = def.name.toLowerCase();
  if (/basket|woodland|forage|flower|blossom/.test(n)) return 1;
  if (/cellar|crate|woodpile|tool|build/.test(n)) return 2;
  if (/jar|crock|pantry|kitchen|preserve|cook|brew/.test(n)) return 3;
  // Otherwise by place in the room, so neighbouring tabs differ.
  return (BUNDLES.filter((b) => b.room === def.room).indexOf(def) % 4) as SackKind;
}

export function sackSvg(color: number, done: boolean, fill = 0, kind: SackKind = 0): string {
  if (kind) return containerSvg(color, done, kind);
  const id = `js${uid++}`;
  const c = css(color);
  const slump = done ? 0 : 1 - fill;
  const body = done
    ? 'M20 46 C12 58 12 82 26 92 C38 100 62 100 74 92 C88 82 88 58 80 46 C72 38 28 38 20 46 Z'
    : `M22 ${54 + slump * 6} C12 ${66 + slump * 4} 14 86 28 93 C40 99 60 99 72 93 C86 86 88 ${66 + slump * 4} 78 ${54 + slump * 6} C70 ${46 + slump * 6} 30 ${46 + slump * 6} 22 ${54 + slump * 6} Z`;
  return `<svg class="js-sack${done ? ' done' : ''}" viewBox="0 0 100 104" aria-hidden="true">
  <defs><radialGradient id="${id}" cx="38%" cy="40%" r="75%"><stop offset="0" stop-color="${shade(color, 1.28)}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${shade(color, 0.62)}"/></radialGradient></defs>
  <ellipse cx="50" cy="97" rx="32" ry="5" fill="rgba(60,30,10,.25)"/>
  <path d="${body}" fill="url(#${id})" stroke="${shade(color, 0.45)}" stroke-width="2.5"/>
  <path d="M34 ${done ? 40 : 46} C38 24 44 18 50 18 C56 18 62 24 66 ${done ? 40 : 46}" fill="url(#${id})" stroke="${shade(color, 0.45)}" stroke-width="2.5"/>
  <path d="M40 22 L44 10 M50 18 L50 6 M60 22 L57 10" stroke="${shade(color, 0.5)}" stroke-width="3" stroke-linecap="round"/>
  <path d="M30 ${done ? 42 : 48} Q50 ${done ? 52 : 58} 70 ${done ? 42 : 48}" fill="none" stroke="${done ? '#e8b84a' : '#9a8a6a'}" stroke-width="${done ? 6 : 4}" stroke-linecap="round"/>
  ${done ? `<path d="M50 48 l-14 10 l4 -12 z M50 48 l14 10 l-4 -12 z" fill="#e8b84a" stroke="#a87a1a" stroke-width="1.5"/><circle cx="50" cy="48" r="5" fill="#f5d06a" stroke="#a87a1a" stroke-width="1.5"/>` : ''}
  <path d="M30 64 q6 -4 10 2 M58 74 q6 -5 12 0" stroke="rgba(255,255,255,.25)" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`;
}

function containerSvg(color: number, done: boolean, kind: 1 | 2 | 3): string {
  const id = `js${uid++}`;
  const c = css(color);
  const ink = shade(color, 0.42);
  const grad = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(color, 1.25)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${shade(color, 0.66)}"/></linearGradient></defs>`;
  const shadow = `<ellipse cx="50" cy="97" rx="34" ry="5" fill="rgba(60,30,10,.25)"/>`;
  const ribbon = done
    ? `<path d="M50 60 l-14 10 l4 -12 z M50 60 l14 10 l-4 -12 z" fill="#e8b84a" stroke="#a87a1a" stroke-width="1.5"/><circle cx="50" cy="60" r="5" fill="#f5d06a" stroke="#a87a1a" stroke-width="1.5"/>`
    : '';
  let body = '';
  if (kind === 1) {
    // Woven basket: flared tub, wicker courses, a bent-willow handle.
    body = `<path d="M30 52 C30 22 70 22 70 52" fill="none" stroke="${shade(0xb07a3a, 0.8)}" stroke-width="6" stroke-linecap="round"/>
  <path d="M30 52 C30 22 70 22 70 52" fill="none" stroke="#d8a860" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M14 50 L86 50 L78 92 C70 97 30 97 22 92 Z" fill="url(#${id})" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/>
  ${[60, 70, 80].map((y) => `<path d="M${15 + (y - 50) * 0.2} ${y} Q50 ${y + 4} ${85 - (y - 50) * 0.2} ${y}" fill="none" stroke="${shade(color, 0.6)}" stroke-width="2"/>`).join('')}
  ${[28, 39, 50, 61, 72].map((x) => `<path d="M${x} 52 L${x + (x - 50) * -0.12} 93" stroke="${shade(color, 0.72)}" stroke-width="1.6"/>`).join('')}
  <rect x="11" y="45" width="78" height="9" rx="4.5" fill="${shade(color, 1.12)}" stroke="${ink}" stroke-width="2.2"/>`;
  } else if (kind === 2) {
    // Slatted crate: three boards, corner posts, a stencilled tag.
    body = `<rect x="14" y="38" width="72" height="56" rx="6" fill="url(#${id})" stroke="${ink}" stroke-width="2.5"/>
  ${[56, 75].map((y) => `<path d="M16 ${y} H84" stroke="${ink}" stroke-width="2" opacity=".7"/>`).join('')}
  <rect x="14" y="38" width="10" height="56" rx="4" fill="${shade(color, 0.8)}" stroke="${ink}" stroke-width="2"/>
  <rect x="76" y="38" width="10" height="56" rx="4" fill="${shade(color, 0.8)}" stroke="${ink}" stroke-width="2"/>
  <path d="M26 42 L74 90" stroke="${shade(color, 0.7)}" stroke-width="5" stroke-linecap="round"/>
  <path d="M30 41 q8 -9 16 -3 q6 -8 14 -1 q8 -5 12 3" fill="${shade(color, 1.3)}" stroke="${ink}" stroke-width="2"/>`;
  } else {
    // Stoneware crock: glazed belly, cloth cap tied with twine.
    body = `<path d="M30 40 C14 50 14 86 30 93 C42 98 58 98 70 93 C86 86 86 50 70 40 Z" fill="url(#${id})" stroke="${ink}" stroke-width="2.5"/>
  <path d="M24 66 C40 72 60 72 76 66" fill="none" stroke="${shade(color, 1.35)}" stroke-width="3" opacity=".6"/>
  <path d="M27 40 C24 30 76 30 73 40 C66 46 34 46 27 40 Z" fill="#efe2c4" stroke="#a8906a" stroke-width="2.2"/>
  <path d="M30 38 C26 46 22 50 25 54 M70 38 C74 46 78 50 75 54" fill="none" stroke="#efe2c4" stroke-width="5" stroke-linecap="round"/>
  <path d="M29 41 C40 45 60 45 71 41" fill="none" stroke="#9a6a38" stroke-width="2.6"/>
  <path d="M36 74 q6 -4 10 2" stroke="rgba(255,255,255,.3)" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }
  return `<svg class="js-sack k${kind}${done ? ' done' : ''}" viewBox="0 0 100 104" aria-hidden="true">${grad}${shadow}${body}${ribbon}</svg>`;
}

export const PIN = (color = '#d8473a'): string =>
  `<svg class="jb-pin" viewBox="0 0 30 30" aria-hidden="true"><ellipse cx="17" cy="25" rx="7" ry="2.5" fill="rgba(0,0,0,.25)"/><path d="M15 16 L17 26" stroke="#8a8a8a" stroke-width="2"/><circle cx="14" cy="11" r="9" fill="${color}"/><circle cx="11" cy="8" r="3" fill="rgba(255,255,255,.55)"/></svg>`;

export const SEAL_MINI = (color = '#b8322a', letter = ''): string =>
  `<svg class="jn-seal" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2 C25 3 27 6 31 6 C35 8 36 12 38 15 C40 20 37 23 39 27 C38 32 34 33 32 36 C28 39 24 37 20 39 C16 39 13 36 9 35 C5 33 5 29 2 26 C1 22 3 18 2 14 C4 10 7 7 10 5 C14 3 16 2 20 2Z" fill="${color}"/><circle cx="20" cy="20" r="11" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="2"/><text x="20" y="26" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="16" font-weight="700" fill="rgba(255,220,200,.6)">${letter}</text></svg>`;

export const ENVELOPE = (open: boolean, color = '#f3e2bc'): string =>
  `<svg class="jn-env" viewBox="0 0 64 44" aria-hidden="true"><rect x="2" y="6" width="60" height="36" rx="4" fill="${color}" stroke="#b8905a" stroke-width="2"/>${open ? `<path d="M2 8 L32 -6 L62 8" fill="${color}" stroke="#b8905a" stroke-width="2" stroke-linejoin="round"/><rect x="8" y="2" width="48" height="24" rx="2" fill="#fffaf0" stroke="#d8c8a8"/>` : `<path d="M3 8 L32 28 L61 8" fill="none" stroke="#b8905a" stroke-width="2" stroke-linejoin="round"/>`}<path d="M3 41 L24 22 M61 41 L40 22" stroke="#d8c09a" stroke-width="1.5"/></svg>`;

export const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 L9.5 18 L20 6" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const COIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#f5c542" stroke="#a8741a" stroke-width="1.6"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#d89a2a" stroke-width="1.3"/><path d="M10 9.5 h3.5 a1.6 1.6 0 0 1 0 3.2 h-3 a1.6 1.6 0 0 0 0 3.2 H14" fill="none" stroke="#a8741a" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** Item icon (the UI kit's art), with a tinted fallback glyph for items that don't exist yet. */
export function iconOf(itemId: string, fallback?: { name?: string; color?: number }): string {
  if (itemDef(itemId)) return itemIcon(itemId, 'u-ic');
  const c = css(fallback?.color ?? 0x9ab8c8);
  const fishy = /pike|carp|minnow|eel|perch|fish|trout|bass/i.test(itemId + (fallback?.name ?? ''));
  return fishy
    ? `<svg class="u-ic" viewBox="0 0 48 48"><path d="M6 24 C12 12 30 10 38 22 L46 14 L44 24 L46 34 L38 26 C30 38 12 36 6 24 Z" fill="${c}" stroke="${shade(fallback?.color ?? 0x9ab8c8, 0.5)}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="14" cy="22" r="2.4" fill="#1a1a1a"/><path d="M20 18 q4 6 0 12" stroke="rgba(0,0,0,.25)" stroke-width="2" fill="none"/><path d="M12 18 q6 -4 14 -2" stroke="rgba(255,255,255,.45)" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`
    : `<svg class="u-ic" viewBox="0 0 48 48"><circle cx="24" cy="25" r="15" fill="${c}" stroke="${shade(fallback?.color ?? 0x9ab8c8, 0.5)}" stroke-width="2.4"/><circle cx="19" cy="20" r="4" fill="rgba(255,255,255,.5)"/></svg>`;
}

const MAP_NAMES: Record<string, string> = { farm: 'farm pond', town: 'river', beach: 'sea', forest: 'forest creek', mine: 'mine pools' };
const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
const hh = (h: number): string => {
  const x = ((h % 24) + 24) % 24;
  return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? 'am' : 'pm'}`;
};

/** A one-line "where do I get this?" hint for bundle slots (crop season, fish spot, resource source). */
export function whereFrom(itemId: string): string {
  const crop = (CROPS as Record<string, { seasons: string[]; produce: string } | undefined>)[itemId];
  if (crop) return `${crop.seasons.map(cap).join(' / ')} crop`;
  const f = fishDef(itemId);
  if (f) {
    const where = [...new Set(f.maps.map((m) => MAP_NAMES[m] ?? m))].slice(0, 2).join(' or ');
    const when = f.hours[0] <= 6 && f.hours[1] >= 26 ? '' : ` · ${hh(f.hours[0])}–${hh(f.hours[1])}`;
    const wx = f.weather?.length ? ` · ${f.weather.includes('rain') ? 'rain' : f.weather[0]}` : '';
    return `Fish · ${where}${when}${wx}`;
  }
  const RES: Record<string, string> = {
    wood: 'Chop branches & stumps',
    stone: 'Break stones',
    fiber: 'Scythe weeds',
    coal: 'Mine · the Hollowdeep',
    sprinkler: 'Craft at the bench',
    // Forage (Cindergrove + verges), by season.
    wildLeek: 'Forage · Spring · Cindergrove',
    fiddlehead: 'Forage · Spring · Cindergrove',
    morel: 'Forage · Spring · Cindergrove',
    sweetPea: 'Forage · Summer · verges',
    hedgeBerry: 'Forage · Summer · hedgerows',
    duskViolet: 'Forage · Summer evenings',
    chanterelle: 'Forage · Fall · Cindergrove',
    hazelnut: 'Forage · Fall · Cindergrove',
    emberCap: 'Forage · Fall · Cindergrove',
    frostHolly: 'Forage · Winter · Cindergrove',
    snowRoot: 'Forage · Winter · dig in the snow',
    crystalCone: 'Forage · Winter · pines',
    // The Hollowdeep.
    copperOre: 'Mine · Hollowdeep floors 1–20',
    ironOre: 'Mine · Hollowdeep floors 20+',
    quartz: 'Mine · any floor',
    amethyst: 'Mine · gem rocks',
    topaz: 'Mine · gem rocks',
    aquamarine: 'Mine · gem rocks',
    frostShard: 'Mine · the frozen floors',
    slimeGel: 'Mine · defeat slimes',
    // Barn & coop.
    egg: 'Coop · white hens',
    brownEgg: 'Coop · brown hens',
    duckEgg: 'Coop · ducks',
    milk: 'Barn · cows',
    goatMilk: 'Barn · goats',
    wool: 'Barn · sheep',
    hay: 'Scythe grass · or buy at the barn',
    // The beach.
    cockle: 'Beachcombing · Driftsand',
    seaGlass: 'Beachcombing · Driftsand',
    sandDollar: 'Beachcombing · Driftsand',
    spiralConch: 'Beachcombing · Driftsand',
    starfish: 'Beachcombing · low tide',
    crabCarapace: 'Beachcombing · Driftsand',
    bait: 'Craft · or the tackle shop',
    corkBobber: 'Tackle shop',
    treasureLure: 'Tackle shop',
    winterRoseTea: "Marigold's shop · Winter",
  };
  if (RES[itemId]) return RES[itemId]!;
  const d = itemDef(itemId);
  if (d?.kind === 'placeable') return 'Craft it';
  return '';
}

export function itemName(itemId: string, fallback?: string): string {
  return itemDef(itemId)?.name ?? fallback ?? itemId.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

/**
 * "Hearthvale from Gran's hill": a little dusk vignette for the journal. The Lantern Hall's six
 * windows glow in their rooms' colours as they relight, the Great Lantern over the doors brightens,
 * cottage windows and the lane lanterns come on with the story. `glimmer` = EverGlow white.
 */
export function valleySvg(rooms: { color: number; lit: boolean }[], glimmer = false): string {
  const id = `jv${uid++}`;
  const n = rooms.filter((r) => r.lit).length;
  const k = n / Math.max(1, rooms.length);
  const warm = glimmer ? '#e8f6ff' : '#ffd27a';
  const stars = [
    [34, 22, 1.4], [70, 40, 1], [112, 16, 1.2], [160, 34, 0.9], [206, 12, 1.3], [300, 20, 1], [352, 42, 1.4], [398, 14, 1], [466, 70, 1.2], [488, 18, 0.9], [252, 44, 0.8], [132, 52, 0.8], [20, 60, 0.8],
  ]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff8e0" opacity="${(0.5 + ((x! * 7) % 5) / 10).toFixed(2)}"/>`)
    .join('');
  const glow = (x: number, y: number, r: number, a: number): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="${warm}" opacity="${a.toFixed(2)}" filter="url(#${id}b)"/>`;
  // Hall windows: three either side of the doors (seed / harvest / craft west, sun / hearth / tide east).
  const win = (i: number, x: number, y: number): string => {
    const r = rooms[i];
    const on = !!r?.lit;
    const c = glimmer && on ? '#eaf8ff' : on ? css(r!.color) : '#2c2c44';
    return `${on ? `<rect x="${x - 7}" y="${y - 8}" width="26" height="32" rx="8" fill="${c}" opacity=".4" filter="url(#${id}b)"/>` : ''}<path d="M${x} ${y + 16} v-12 a6 6 0 0 1 12 0 v12 z" fill="${c}" stroke="#2e2638" stroke-width="1.6"/><path d="M${x + 6} ${y - 2} v18 M${x} ${y + 8} h12" stroke="#2e2638" stroke-width="1" opacity=".55"/>`;
  };
  const hallWins = [win(0, 196, 126), win(2, 214, 126), win(4, 232, 126), win(1, 272, 126), win(3, 290, 126), win(5, 308, 126)].join('');
  const cottage = (x: number, y: number, s: number, on: boolean, roof: string): string =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-16 0 v-18 h32 v18 z" fill="#4a3f52"/><path d="M-20 -17 L0 -32 L20 -17 z" fill="${roof}"/>${on ? `<rect x="-12" y="-17" width="15" height="15" rx="5" fill="${warm}" opacity=".35" filter="url(#${id}b)"/>` : ''}<rect x="-8" y="-13" width="7" height="7" rx="1.5" fill="${on ? warm : '#2a2a3c'}"/><rect x="4" y="-10" width="6" height="10" rx="1" fill="#2e2638"/></g>`;
  const lane = n >= 3;
  const lamps = [[120, 198], [158, 188], [194, 178], [224, 167]]
    .map(([x, y]) => `<path d="M${x} ${y} v-12" stroke="#2e2638" stroke-width="1.6"/>${lane ? glow(x!, y! - 13, 8, 0.35) : ''}<circle cx="${x}" cy="${y! - 13}" r="2.6" fill="${lane ? warm : '#3a3448'}"/>`)
    .join('');
  return `<svg class="jn-valley" viewBox="0 0 520 220" aria-hidden="true">
  <defs>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27305e"/><stop offset=".55" stop-color="#6a5a8e"/><stop offset=".85" stop-color="#e8a08a"/><stop offset="1" stop-color="#f6c89a"/></linearGradient>
    <radialGradient id="${id}g" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="${warm}" stop-opacity="${(0.12 + k * 0.55).toFixed(2)}"/><stop offset="1" stop-color="${warm}" stop-opacity="0"/></radialGradient>
    <filter id="${id}b" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>
    <clipPath id="${id}c"><rect x="0" y="0" width="520" height="220" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#${id}c)">
    <rect width="520" height="220" fill="url(#${id}s)"/>
    ${stars}
    <circle cx="438" cy="46" r="15" fill="#fff4d6"/><circle cx="445" cy="41" r="13" fill="#5a4e86"/>
    <path d="M0 150 C60 118 120 124 180 136 C240 146 300 112 380 118 C440 122 490 140 520 132 V220 H0 Z" fill="#4e4a78"/>
    <path d="M0 170 C80 150 140 158 200 160 C280 162 340 144 420 150 C470 154 500 164 520 160 V220 H0 Z" fill="#3a3e62"/>
    <ellipse cx="258" cy="138" rx="${(130 + k * 70).toFixed(0)}" ry="${(56 + k * 34).toFixed(0)}" fill="url(#${id}g)"/>
    ${cottage(110, 178, 1, n >= 1, '#8a4a4a')}${cottage(384, 172, 1.1, n >= 2, '#5a6a8a')}${cottage(436, 186, 0.9, n >= 4, '#8a6a3a')}${cottage(66, 192, 0.85, n >= 5, '#6a5a3a')}
    <path d="M184 152 V112 L258 72 L332 112 V152 Z" fill="#5a4a5e" stroke="#2e2638" stroke-width="2"/>
    <path d="M176 114 L258 68 L340 114" fill="none" stroke="#2e2638" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    ${n ? glow(258, 98, 19, 0.2 + k * 0.45) : ''}
    <circle cx="258" cy="98" r="10" fill="${n ? (glimmer ? '#eaf8ff' : '#ffcf7a') : '#2c2c44'}" stroke="#2e2638" stroke-width="2"/>
    <path d="M258 88 v20 M248 98 h20" stroke="#2e2638" stroke-width="1.2" opacity=".6"/>
    ${hallWins}
    <path d="M248 152 v-15 a10 10 0 0 1 20 0 v15 z" fill="#2e2638"/>
    ${k > 0 ? glow(258, 124, 9 + k * 12, 0.3 + k * 0.4) : ''}
    <path d="M258 112 v6" stroke="#2e2638" stroke-width="1.5"/><rect x="253" y="118" width="10" height="11" rx="2" fill="${k > 0 ? warm : '#3a3448'}" stroke="#2e2638" stroke-width="1.5"/>
    <path d="M0 220 V196 C60 188 120 200 170 190 C220 180 240 170 258 156 C280 172 320 186 380 192 C440 198 490 190 520 194 V220 Z" fill="#2a2c46"/>
    <path d="M90 220 C140 204 200 184 250 158" fill="none" stroke="#6a5a78" stroke-width="5" stroke-linecap="round" opacity=".6"/>
    ${lamps}
  </g>
  <rect x="1" y="1" width="518" height="218" rx="14" fill="none" stroke="rgba(90,60,30,.55)" stroke-width="2"/>
</svg>`;
}

/**
 * Painted vignette of the Lantern Hall as it stands in the 3D square: stone gable with the six-petal
 * rose window (a petal per room, lit in its colour), the clock tower and spire behind, the big stone
 * chimney (smoking once the Hearth Room burns), slate wings with arched windows per room, the double
 * door with its lantern and — once the Seed Room is lit — the blossom arch. Feathered watercolour
 * edges and paper grain so it reads as a painting in the journal, not a vector postcard.
 */
export function hallVignetteSvg(rooms: { id: string; color: number; lit: boolean }[], glimmer = false): string {
  const id = `jh${uid++}`;
  const n = rooms.filter((r) => r.lit).length;
  const k = n / Math.max(1, rooms.length);
  const warm = glimmer ? '#e8f6ff' : '#ffd27a';
  const lit = (rid: string): boolean => !!rooms.find((r) => r.id === rid)?.lit;
  const col = (rid: string): string => (glimmer ? '#eaf8ff' : css(rooms.find((r) => r.id === rid)?.color ?? 0xffd27a));
  // Stone courses: irregular rounded blocks in two tones.
  let stones = '';
  let sd = 7;
  const rnd = (): number => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let y = 92; y < 176; y += 9) {
    for (let x = 196 + ((y / 9) % 2) * 6; x < 324; x += 12 + rnd() * 6) {
      stones += `<rect x="${x.toFixed(1)}" y="${y}" width="${(9 + rnd() * 5).toFixed(1)}" height="7.4" rx="2.6" fill="${rnd() < 0.5 ? '#8a7a6e' : '#a08e7e'}" opacity=".55"/>`;
    }
  }
  const order = ['seed', 'harvest', 'craft', 'sun', 'hearth', 'tide'];
  const petals = order
    .map((rid, i) => {
      const a = (i / 6) * 360 - 90;
      const on = lit(rid);
      return `<ellipse cx="260" cy="88" rx="4.2" ry="8" transform="rotate(${a} 260 101)" fill="${on ? col(rid) : '#3a3650'}" stroke="#2e2638" stroke-width="1"/>`;
    })
    .join('');
  const archWin = (x: number, y: number, rid: string): string => {
    const on = lit(rid);
    const c = on ? col(rid) : '#2c2c44';
    return `${on ? `<ellipse cx="${x + 7}" cy="${y + 10}" rx="16" ry="20" fill="${c}" opacity=".45" filter="url(#${id}b)"/>` : ''}<path d="M${x} ${y + 22} v-14 a7 7 0 0 1 14 0 v14 z" fill="${on ? '#ffe2a8' : c}" stroke="#3a2a22" stroke-width="2"/>${on ? `<path d="M${x + 2} ${y + 22} v-12 a5 5 0 0 1 10 0 v12 z" fill="${c}" opacity=".55"/>` : ''}<path d="M${x + 7} ${y + 1} v21 M${x} ${y + 12} h14" stroke="#3a2a22" stroke-width="1.2" opacity=".7"/><path d="M${x - 2} ${y + 22} h18" stroke="#c8b8a4" stroke-width="2.4" stroke-linecap="round"/>`;
  };
  const wins = [archWin(152, 128, 'seed'), archWin(176, 132, 'harvest'), archWin(132, 134, 'craft'), archWin(330, 128, 'sun'), archWin(354, 132, 'hearth'), archWin(374, 134, 'tide')].join('');
  const smoke = lit('hearth')
    ? [0, 1, 2, 3].map((i) => `<circle cx="${172 + i * 5 + (i % 2) * 3}" cy="${52 - i * 11}" r="${5 + i * 2.4}" fill="#d8d0dc" opacity="${(0.35 - i * 0.07).toFixed(2)}" filter="url(#${id}b)"/>`).join('')
    : '';
  const arch = lit('seed')
    ? `<path d="M244 176 v-30 a16 16 0 0 1 32 0 v30" fill="none" stroke="#6a8a4a" stroke-width="3"/>${Array.from({ length: 16 }, (_, i) => {
        const a = Math.PI + (i / 15) * Math.PI;
        const x = 260 + Math.cos(a) * 17;
        const y = 146 + Math.sin(a) * 17;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.6 + (i % 3) * 0.8).toFixed(1)}" fill="${i % 2 ? '#f6a8c4' : '#ffd6e6'}"/>`;
      }).join('')}<circle cx="244" cy="166" r="3" fill="#f6a8c4"/><circle cx="276" cy="160" r="3" fill="#ffd6e6"/>`
    : '';
  const lamps = [[96, 196], [150, 190], [370, 190], [424, 196]]
    .map(([x, y], i) => {
      const on = i < Math.ceil(n * 0.7);
      return `<path d="M${x} ${y} v-24" stroke="#2e2638" stroke-width="2"/>${on ? `<circle cx="${x}" cy="${y! - 27}" r="11" fill="${warm}" opacity=".4" filter="url(#${id}b)"/>` : ''}<rect x="${x! - 3.5}" y="${y! - 32}" width="7" height="9" rx="2" fill="${on ? warm : '#3a3448'}" stroke="#2e2638" stroke-width="1.4"/>`;
    })
    .join('');
  return `<svg class="jn-valley jn-hallpaint" viewBox="0 0 520 220" aria-hidden="true">
  <defs>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f5c"/><stop offset=".5" stop-color="#5e4f86"/><stop offset=".82" stop-color="#d48e86"/><stop offset="1" stop-color="#f2c08e"/></linearGradient>
    <radialGradient id="${id}g" cx="50%" cy="62%" r="52%"><stop offset="0" stop-color="${warm}" stop-opacity="${(0.1 + k * 0.5).toFixed(2)}"/><stop offset="1" stop-color="${warm}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}v" cx="50%" cy="52%" r="62%"><stop offset=".62" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="${id}b" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="${id}w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5"/></filter>
    <filter id="${id}p"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.32  0 0 0 0 0.2  0 0 0 0.14 0"/></filter>
    <mask id="${id}m"><rect width="520" height="220" fill="url(#${id}v)" filter="url(#${id}w)"/></mask>
  </defs>
  <g mask="url(#${id}m)">
    <g filter="url(#${id}w)">
      <rect width="520" height="220" fill="url(#${id}s)"/>
      <ellipse cx="120" cy="58" rx="90" ry="10" fill="#8a6a9a" opacity=".35"/><ellipse cx="400" cy="44" rx="110" ry="9" fill="#b07a92" opacity=".3"/>
      <circle cx="446" cy="40" r="12" fill="#fff4d6"/><circle cx="452" cy="36" r="10.5" fill="#57508a"/>
      ${[[60, 26], [180, 18], [300, 30], [500, 70], [30, 80], [236, 46]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="#fff8e0" opacity=".8"/>`).join('')}
      <path d="M0 120 L30 92 L52 112 L80 80 L112 116 L140 96 L168 118 L520 118 L486 94 L462 108 L430 84 L400 112 L380 100 L360 118 Z" fill="#2e3452" opacity=".9"/>
      <ellipse cx="260" cy="150" rx="${(150 + k * 80).toFixed(0)}" ry="${(60 + k * 30).toFixed(0)}" fill="url(#${id}g)"/>
      ${smoke}
      <!-- chimney, tower + spire behind the gable -->
      <rect x="164" y="56" width="20" height="62" fill="#7a6a62" stroke="#3a2a22" stroke-width="2"/><rect x="161" y="52" width="26" height="7" fill="#5a4a44" stroke="#3a2a22" stroke-width="1.6"/>
      <rect x="226" y="40" width="30" height="50" fill="#6e5e58" stroke="#3a2a22" stroke-width="2"/>
      <path d="M222 42 L241 6 L260 42 Z" fill="#4a5a7a" stroke="#2e2638" stroke-width="2"/>
      <circle cx="241" cy="60" r="7" fill="#efe2c8" stroke="#3a2a22" stroke-width="1.6"/><path d="M241 60 v-5 M241 60 h3.5" stroke="#3a2a22" stroke-width="1.2"/>
      <rect x="232" y="68" width="18" height="12" fill="${k > 0 ? warm : '#2c2c44'}" opacity="${k > 0 ? 0.9 : 1}"/>
      <!-- slate wings -->
      <path d="M118 122 L150 100 H214 V176 H122 Z" fill="#8a7a70" stroke="#3a2a22" stroke-width="2"/>
      <path d="M402 122 L370 100 H306 V176 H398 Z" fill="#8a7a70" stroke="#3a2a22" stroke-width="2"/>
      <path d="M112 126 L148 96 H216 L216 110 H150 L120 132 Z" fill="#56627e" stroke="#2e2638" stroke-width="2"/>
      <path d="M408 126 L372 96 H304 L304 110 H370 L400 132 Z" fill="#56627e" stroke="#2e2638" stroke-width="2"/>
      ${wins}
      <!-- the stone gable -->
      <path d="M196 176 V100 L260 54 L324 100 V176 Z" fill="#9a8878" stroke="#3a2a22" stroke-width="2.4"/>
      ${stones}
      <path d="M188 104 L260 50 L332 104" fill="none" stroke="#4a3e44" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      ${n ? `<circle cx="260" cy="101" r="${(20 + k * 8).toFixed(1)}" fill="${warm}" opacity="${(0.25 + k * 0.4).toFixed(2)}" filter="url(#${id}b)"/>` : ''}
      <circle cx="260" cy="101" r="17" fill="#2c2840" stroke="#e8dcc8" stroke-width="3"/>
      ${petals}<circle cx="260" cy="101" r="4" fill="${n ? warm : '#3a3650'}" stroke="#2e2638" stroke-width="1"/>
      <!-- doors, lantern, steps -->
      ${k > 0 ? `<ellipse cx="260" cy="156" rx="${(14 + k * 12).toFixed(1)}" ry="${(16 + k * 10).toFixed(1)}" fill="${warm}" opacity="${(0.25 + k * 0.4).toFixed(2)}" filter="url(#${id}b)"/>` : ''}
      <path d="M248 176 v-22 a12 12 0 0 1 24 0 v22 z" fill="#5a3422" stroke="#2e1a10" stroke-width="2"/><path d="M260 142 v34" stroke="#2e1a10" stroke-width="1.6"/>
      <rect x="256" y="128" width="8" height="10" rx="2" fill="${k > 0 ? warm : '#3a3448'}" stroke="#2e2638" stroke-width="1.4"/>
      ${arch}
      <path d="M232 176 H288 L294 184 H226 Z" fill="#b8a898" stroke="#5a4a40" stroke-width="1.4"/><path d="M220 184 H300 L306 192 H214 Z" fill="#a89888" stroke="#5a4a40" stroke-width="1.4"/>
      <!-- the square -->
      <path d="M0 192 C120 184 200 190 260 192 C330 190 420 184 520 190 V220 H0 Z" fill="#4a4258"/>
      <path d="M0 204 C140 198 380 198 520 204" stroke="#6a5e70" stroke-width="2" fill="none" opacity=".6"/>
      ${lamps}
    </g>
    <rect width="520" height="220" filter="url(#${id}p)"/>
  </g>
</svg>`;
}
