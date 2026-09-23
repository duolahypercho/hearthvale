/**
 * Story UI art (inline SVG, procedural): room lanterns that glow with progress, cloth bundle sacks,
 * push pins, wax seals, envelopes and the little hall floor-plan used by the journal.
 */
import { itemDef } from '../data/items';
import { CROPS } from '../data/crops';
import { fishDef } from '../data/fish';
import { itemIcon } from './icons';

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
  return `<svg class="${cls}${lit ? ' lit' : ''}" viewBox="0 0 100 140" aria-hidden="true" style="--g:${g.toFixed(2)};--c:${css(color)}">
  <defs>
    <radialGradient id="${id}f" cx="50%" cy="58%" r="55%"><stop offset="0" stop-color="#fffbe8"/><stop offset=".35" stop-color="${shade(color, 1.25)}"/><stop offset="1" stop-color="${shade(color, 0.7)}"/></radialGradient>
    <radialGradient id="${id}h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${css(color)}" stop-opacity=".65"/><stop offset="1" stop-color="${css(color)}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}d" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3a4250"/><stop offset="1" stop-color="#232833"/></linearGradient>
  </defs>
  ${lit ? `<circle cx="50" cy="78" r="${46 + g * 8}" fill="url(#${id}h)" opacity="${(0.35 + g * 0.65).toFixed(2)}"/>` : ''}
  <path d="M50 4 v10" stroke="#2e2a28" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="50" cy="6" r="4.5" fill="none" stroke="#2e2a28" stroke-width="3"/>
  <path d="M26 34 L50 16 L74 34 Z" fill="#3a3430" stroke="#1e1a18" stroke-width="2" stroke-linejoin="round"/>
  <rect x="24" y="33" width="52" height="6" rx="2" fill="#4a423c"/>
  <rect x="29" y="39" width="42" height="62" rx="8" fill="url(#${id}d)"/>
  <rect x="29" y="39" width="42" height="62" rx="8" fill="url(#${id}f)" opacity="${g.toFixed(2)}"/>
  ${lit ? `<path d="M50 ${86 - g * 22} C ${43 - g * 2} ${80 - g * 10}, 44 88, 50 92 C 56 88, ${57 + g * 2} ${80 - g * 10}, 50 ${86 - g * 22} Z" fill="#fffdf2" opacity="${(0.5 + g * 0.5).toFixed(2)}"/>` : `<path d="M50 80 v10" stroke="#5a5048" stroke-width="2.5" stroke-linecap="round"/>`}
  <path d="M50 39 V101 M29 70 H71" stroke="#2e2a28" stroke-width="3" opacity=".9"/>
  <rect x="29" y="39" width="42" height="62" rx="8" fill="none" stroke="#2e2a28" stroke-width="4"/>
  <path d="M34 44 q4 -2 6 2 v22" stroke="#fff" stroke-width="2.5" fill="none" opacity="${lit ? 0.45 : 0.18}" stroke-linecap="round"/>
  <path d="M24 101 H76 L68 112 H32 Z" fill="#3a3430" stroke="#1e1a18" stroke-width="2" stroke-linejoin="round"/>
  <path d="M44 112 v8 h12 v-8" fill="#2e2a28"/>
</svg>`;
}

/** Cloth bundle sack tied with a ribbon; plump + gold ribbon when complete. */
export function sackSvg(color: number, done: boolean, fill = 0): string {
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
  const RES: Record<string, string> = { wood: 'Chop branches & stumps', stone: 'Break stones', fiber: 'Scythe weeds', sprinkler: 'Craft at the bench' };
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
