/**
 * Story UI art (inline SVG, procedural): room lanterns that glow with progress, cloth bundle sacks,
 * push pins, wax seals, envelopes and the little hall floor-plan used by the journal.
 */
import { itemDef } from '../data/items';
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

export function itemName(itemId: string, fallback?: string): string {
  return itemDef(itemId)?.name ?? fallback ?? itemId.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}
