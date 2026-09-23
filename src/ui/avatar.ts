/**
 * Painted SVG bust of the farmer, driven by the character-creator look (skin, hair colour + style, shirt,
 * overalls, kerchief, hat style + colour). With no look it paints the original farmer (straw hat, auburn
 * hair, red kerchief, green overalls) — same palette as the 3D rig.
 */
import type { FarmerLook } from '../entities/remote-look';

let n = 0;

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Mix a colour toward black (k<0) or white (k>0). */
function shade(c: number, k: number): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const t = k < 0 ? 0 : 255;
  const a = Math.abs(k);
  const m = (v: number): number => Math.round(v + (t - v) * a);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

const ORIGINAL: FarmerLook = { skin: 0xecb48e, hair: 0x8a4a2a, hairStyle: 'tousled', shirt: 0xf0e4c8, overalls: 0x5f8a5c, scarf: 0xe07a5f, hat: 'straw', hatColor: 0xe6c275 };

function hairBack(look: FarmerLook, fill: string): string {
  const ink = '#3b2313';
  switch (look.hairStyle) {
    case 'long':
      return `<path d="M31 56 C28 76 30 94 38 104 L48 100 C42 88 40 74 42 60 Z M89 56 C92 76 90 94 82 104 L72 100 C78 88 80 74 78 60 Z" fill="${fill}" stroke="${ink}" stroke-width="2.3"/>`;
    case 'bob':
      return `<path d="M31 54 C28 66 30 78 38 84 L42 70 Z M89 54 C92 66 90 78 82 84 L78 70 Z" fill="${fill}" stroke="${ink}" stroke-width="2.3"/>`;
    case 'bun':
      return `<circle cx="60" cy="28" r="10" fill="${fill}" stroke="${ink}" stroke-width="2.4"/>`;
    default:
      return '';
  }
}

function hairFront(look: FarmerLook, fill: string): string {
  const ink = '#3b2313';
  switch (look.hairStyle) {
    case 'spiky':
      return `<path d="M33 56 C30 42 36 34 44 34 L46 26 L52 33 L58 23 L63 32 L70 24 L73 34 C82 34 90 42 87 56 C84 48 78 44 70 44 C64 48 56 50 46 48 C40 48 36 50 33 56 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>`;
    case 'buzz':
      return `<path d="M34 54 C32 40 42 33 60 33 C78 33 88 40 86 54 C80 46 70 43 60 43 C50 43 40 46 34 54 Z" fill="${fill}" stroke="${ink}" stroke-width="2.2"/>`;
    case 'bob':
    case 'long':
      return `<path d="M32 60 C28 40 40 31 60 31 C80 31 92 40 88 60 C84 50 76 45 66 45 C62 50 52 52 42 50 C38 52 34 55 32 60 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4"/>`;
    default:
      return `<path d="M33 56 C30 40 40 32 60 32 C80 32 90 40 87 56 C84 48 78 44 70 44 C66 48 58 50 48 48 C42 48 36 50 33 56 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4"/><path d="M34 58 C32 64 33 70 36 74 L38 62 Z M86 58 C88 64 87 70 84 74 L82 62 Z" fill="${fill}" stroke="${ink}" stroke-width="2"/>`;
  }
}

function hat(look: FarmerLook, id: string): string {
  const ink = '#3b2313';
  const c = look.hatColor;
  switch (look.hat) {
    case 'straw':
      return `<path d="M14 40 C24 34 96 34 106 40 C100 46 20 46 14 40 Z" fill="url(#${id}h)" stroke="${ink}" stroke-width="2.5"/>
  <path d="M36 40 C36 20 84 20 84 40 Z" fill="url(#${id}h)" stroke="${ink}" stroke-width="2.5"/>
  <path d="M36.5 34 H83.5 V40 H36.5 Z" fill="#3d6f8f" stroke="${ink}" stroke-width="2"/>
  <path d="M42 26 C48 22 56 21 62 22" fill="none" stroke="#fff6d0" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>
  <path d="M40 24 L44 31 M50 21 L52 30 M62 21 L62 30 M72 22 L71 30" stroke="#b8893a" stroke-width="1.2" opacity=".6"/>`;
    case 'cap':
      return `<path d="M34 42 C34 24 86 24 86 42 Z" fill="${hex(c)}" stroke="${ink}" stroke-width="2.5"/><path d="M34 42 C48 38 60 40 74 42 C86 44 98 44 104 48 C92 52 70 48 60 46 C50 46 40 46 34 42 Z" fill="${shade(c, -0.25)}" stroke="${ink}" stroke-width="2.3"/><circle cx="60" cy="25" r="3" fill="${shade(c, -0.3)}" stroke="${ink}" stroke-width="1.5"/><path d="M44 30 C50 26 56 25 62 26" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".5"/>`;
    case 'beanie':
      return `<path d="M33 46 C31 22 89 22 87 46 Z" fill="${hex(c)}" stroke="${ink}" stroke-width="2.5"/><path d="M32 44 H88 V52 C70 49 50 49 32 52 Z" fill="${shade(c, -0.2)}" stroke="${ink}" stroke-width="2.3"/><path d="M40 44 V51 M48 44 V50 M56 44 V50 M64 44 V50 M72 44 V50 M80 44 V51" stroke="${shade(c, -0.4)}" stroke-width="1.4"/><circle cx="60" cy="20" r="6" fill="${shade(c, 0.35)}" stroke="${ink}" stroke-width="2.2"/>`;
    case 'flower':
      return `<g transform="translate(79 40)">${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="0" cy="-6.5" rx="4.5" ry="6.5" fill="${hex(c)}" stroke="${ink}" stroke-width="1.6" transform="rotate(${i * 72})"/>`).join('')}<circle r="3.6" fill="#ffd66a" stroke="${ink}" stroke-width="1.5"/></g>`;
    default:
      return '';
  }
}

export function farmerAvatar(bg: [string, string] = ['#bfe4ff', '#8fc8a0'], look: FarmerLook | null = null): string {
  const L = look ?? ORIGINAL;
  const id = `fa${n++}`;
  const skin = L.skin;
  const hair = hex(L.hair);
  return `<svg viewBox="0 0 120 120" class="u-avatar"><defs>
  <radialGradient id="${id}b" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
  <radialGradient id="${id}s" cx="42%" cy="38%" r="70%"><stop offset="0" stop-color="${shade(skin, 0.22)}"/><stop offset=".75" stop-color="${hex(skin)}"/><stop offset="1" stop-color="${shade(skin, -0.12)}"/></radialGradient>
  <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.hatColor, 0.35)}"/><stop offset="1" stop-color="${shade(L.hatColor, -0.1)}"/></linearGradient>
  <linearGradient id="${id}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.overalls, 0.14)}"/><stop offset="1" stop-color="${shade(L.overalls, -0.22)}"/></linearGradient>
  <clipPath id="${id}c"><circle cx="60" cy="60" r="58"/></clipPath></defs>
  <g clip-path="url(#${id}c)">
  <rect width="120" height="120" fill="url(#${id}b)"/>
  <path d="M0 96 C20 86 40 90 60 92 C82 94 100 84 120 90 V120 H0 Z" fill="#6aae45" opacity=".55"/>
  ${hairBack(L, hair)}
  <path d="M18 120 C18 96 36 86 60 86 C84 86 102 96 102 120 Z" fill="${hex(L.shirt)}" stroke="#3b2313" stroke-width="2.5"/>
  <path d="M34 120 V100 C34 96 38 94 42 94 H78 C82 94 86 96 86 100 V120 Z" fill="url(#${id}o)" stroke="#3b2313" stroke-width="2.5"/>
  <rect x="50" y="100" width="20" height="12" rx="3" fill="${shade(L.overalls, -0.2)}" stroke="#2a2418" stroke-width="1.5"/>
  <circle cx="42" cy="99" r="2.6" fill="#e0c060" stroke="#6a5010"/><circle cx="78" cy="99" r="2.6" fill="#e0c060" stroke="#6a5010"/>
  <path d="M40 86 C48 94 72 94 80 86 L78 80 C70 86 50 86 42 80 Z" fill="${hex(L.scarf)}" stroke="#3b2313" stroke-width="2.3"/>
  <path d="M60 90 L54 104 L62 102 Z" fill="${shade(L.scarf, -0.18)}" stroke="#3b2313" stroke-width="2"/>
  <ellipse cx="60" cy="58" rx="27" ry="26" fill="url(#${id}s)" stroke="#3b2313" stroke-width="2.6"/>
  ${hairFront(L, hair)}
  <ellipse cx="49" cy="61" rx="4" ry="5" fill="#2a1a12"/><ellipse cx="71" cy="61" rx="4" ry="5" fill="#2a1a12"/>
  <circle cx="50.4" cy="59" r="1.6" fill="#fff"/><circle cx="72.4" cy="59" r="1.6" fill="#fff"/>
  <ellipse cx="42" cy="69" rx="5" ry="3" fill="#f5a38c" opacity=".7"/><ellipse cx="78" cy="69" rx="5" ry="3" fill="#f5a38c" opacity=".7"/>
  <path d="M53 72 C56 76 64 76 67 72" fill="none" stroke="#3b2313" stroke-width="2.4" stroke-linecap="round"/>
  ${hat(L, id)}
  </g><circle cx="60" cy="60" r="58" fill="none" stroke="#3b2313" stroke-width="3"/></svg>`;
}
