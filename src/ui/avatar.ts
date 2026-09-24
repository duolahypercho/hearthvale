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

/** Lift a colour toward a warm key light (the 3D rig's toon ramp reads hair a good deal brighter + warmer). */
function warm(c: number, k: number): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const m = (v: number, t: number): number => Math.round(v + (t - v) * k);
  return `rgb(${m(r, 255)},${m(g, 190)},${m(b, 130)})`;
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

/** Tousled mop (the original farmer): big side puffs past the cheeks + a lobed fringe under the hat brim. */
function tousledBack(fill: string, dark: string): string {
  const ink = '#3b2313';
  return `<path d="M30 50 C20 54 18 70 26 80 C30 86 38 86 40 80 C36 72 36 62 40 54 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M90 50 C100 54 102 70 94 80 C90 86 82 86 80 80 C84 72 84 62 80 54 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M25 66 C24 72 26 77 30 80 M95 66 C96 72 94 77 90 80" fill="none" stroke="${dark}" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`;
}

function tousledFront(fill: string, dark: string, light: string): string {
  const ink = '#3b2313';
  // Lobes across the brow, each a rounded lock; a couple of highlight strokes.
  return `<path d="M30 56 C28 44 34 38 42 38 C46 34 54 33 60 36 C66 33 74 34 78 38 C86 38 92 44 90 56 C87 52 84 50 80 51 C78 55 74 56 71 53 C68 57 63 58 60 54 C57 58 52 57 49 53 C46 56 42 55 40 51 C36 50 33 52 30 56 Z" fill="${fill}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M40 44 C44 42 48 42 51 44 M66 42 C70 41 74 42 77 45" fill="none" stroke="${light}" stroke-width="2" stroke-linecap="round" opacity=".75"/>
  <path d="M49 53 C49 49 50 46 52 44 M71 53 C71 49 70 46 68 44" fill="none" stroke="${dark}" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>`;
}

/** The straw hat as the 3D rig wears it: tipped back (brim underside showing), domed crown, woven straw, slate band. */
function strawHat(id: string, bandCol: string): string {
  const ink = '#3b2313';
  return `<g transform="rotate(-6 60 34)">
  <ellipse cx="60" cy="36" rx="45" ry="12.5" fill="url(#${id}hu)" stroke="${ink}" stroke-width="2.5"/>
  <path d="M19 38 C34 44 86 44 101 38" fill="none" stroke="#fff3c8" stroke-width="1.6" opacity=".55"/>
  <path d="M38 36 C36 16 46 9 60 9 C74 9 84 16 82 36 C74 39 46 39 38 36 Z" fill="url(#${id}h)" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M38.4 30 C46 33 74 33 81.6 30 L82 36 C74 39 46 39 38 36 Z" fill="${bandCol}" stroke="${ink}" stroke-width="2"/>
  <path d="M44 22 C46 16 52 13 58 13" fill="none" stroke="#fff6d0" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>
  <g stroke="#a8782e" stroke-width="1" opacity=".55" fill="none"><path d="M44 28 C50 29 70 29 76 28 M42 22 C50 23 70 23 78 22 M47 16 C54 17 66 17 73 16"/><path d="M50 12 L49 29 M60 10 V29 M70 12 L71 29"/><path d="M24 34 C40 38 80 38 96 34 M30 40 C46 42 74 42 90 40" opacity=".7"/></g>
  </g>`;
}

export function farmerAvatar(bg: [string, string] = ['#bfe4ff', '#8fc8a0'], look: FarmerLook | null = null): string {
  const L = look ?? ORIGINAL;
  const id = `fa${n++}`;
  const skin = L.skin;
  const hairFill = `url(#${id}hr)`;
  const hairDark = shade(L.hair, -0.35);
  const hairLight = shade(L.hair, 0.45);
  const tousled = L.hairStyle === 'tousled';
  // Other styles were drawn for a narrower head: widen them to the chibi head.
  const fit = (g: string): string => (g ? `<g transform="translate(60 60) scale(1.13 1.05) translate(-60 -58)">${g}</g>` : '');
  const back = tousled ? tousledBack(hairFill, hairDark) : fit(hairBack(L, hairFill));
  const front = tousled ? tousledFront(hairFill, hairDark, hairLight) : fit(hairFront(L, hairFill));
  const hatSvg = L.hat === 'straw' ? strawHat(id, L.hatColor === ORIGINAL.hatColor ? '#3d6f8f' : shade(L.hatColor, -0.45)) : `<g transform="translate(0 1)">${hat(L, id)}</g>`;
  return `<svg viewBox="0 0 120 120" class="u-avatar"><defs>
  <radialGradient id="${id}b" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
  <radialGradient id="${id}s" cx="42%" cy="36%" r="72%"><stop offset="0" stop-color="${shade(skin, 0.25)}"/><stop offset=".72" stop-color="${hex(skin)}"/><stop offset="1" stop-color="${shade(skin, -0.14)}"/></radialGradient>
  <linearGradient id="${id}hr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${warm(L.hair, 0.42)}"/><stop offset=".55" stop-color="${warm(L.hair, 0.2)}"/><stop offset="1" stop-color="${shade(L.hair, -0.05)}"/></linearGradient>
  <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.hatColor, 0.4)}"/><stop offset="1" stop-color="${shade(L.hatColor, -0.08)}"/></linearGradient>
  <linearGradient id="${id}hu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.hatColor, 0.25)}"/><stop offset=".55" stop-color="${shade(L.hatColor, -0.12)}"/><stop offset="1" stop-color="${shade(L.hatColor, -0.3)}"/></linearGradient>
  <linearGradient id="${id}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.overalls, 0.14)}"/><stop offset="1" stop-color="${shade(L.overalls, -0.22)}"/></linearGradient>
  <clipPath id="${id}c"><circle cx="60" cy="60" r="58"/></clipPath></defs>
  <g clip-path="url(#${id}c)">
  <rect width="120" height="120" fill="url(#${id}b)"/>
  <path d="M0 98 C20 88 40 92 60 94 C82 96 100 86 120 92 V120 H0 Z" fill="#6aae45" opacity=".55"/>
  ${back}
  <path d="M16 120 C16 99 34 90 60 90 C86 90 104 99 104 120 Z" fill="${hex(L.shirt)}" stroke="#3b2313" stroke-width="2.5"/>
  <path d="M22 108 C26 100 32 96 38 95 M98 108 C94 100 88 96 82 95" fill="none" stroke="${shade(L.shirt, -0.18)}" stroke-width="1.6" opacity=".8"/>
  <path d="M36 120 V104 C36 100 40 98 44 98 H76 C80 98 84 100 84 104 V120 Z" fill="url(#${id}o)" stroke="#3b2313" stroke-width="2.5"/>
  <rect x="50" y="104" width="20" height="11" rx="3" fill="${shade(L.overalls, -0.2)}" stroke="#2a2418" stroke-width="1.5"/>
  <path d="M40 98 L44 90 M80 98 L76 90" stroke="${shade(L.overalls, -0.1)}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="44" cy="102" r="2.6" fill="#e0c060" stroke="#6a5010"/><circle cx="76" cy="102" r="2.6" fill="#e0c060" stroke="#6a5010"/>
  <path d="M42 89 C50 96 70 96 78 89 L76 84 C68 90 52 90 44 84 Z" fill="${hex(L.scarf)}" stroke="#3b2313" stroke-width="2.3"/>
  <path d="M60 93 L54 105 L63 103 Z" fill="${shade(L.scarf, -0.18)}" stroke="#3b2313" stroke-width="2"/>
  <ellipse cx="60" cy="62" rx="31" ry="27.5" fill="url(#${id}s)" stroke="#3b2313" stroke-width="2.6"/>
  <path d="M47 55.5 C49 54 52 54 54 55.5 M66 55.5 C68 54 71 54 73 55.5" fill="none" stroke="${shade(L.hair, -0.3)}" stroke-width="2.2" stroke-linecap="round"/>
  <ellipse cx="49" cy="65" rx="5.2" ry="6.6" fill="#241610"/><ellipse cx="71" cy="65" rx="5.2" ry="6.6" fill="#241610"/>
  <circle cx="50.8" cy="62.4" r="2.2" fill="#fff"/><circle cx="72.8" cy="62.4" r="2.2" fill="#fff"/>
  <circle cx="47.6" cy="67.6" r="1" fill="#fff" opacity=".8"/><circle cx="69.6" cy="67.6" r="1" fill="#fff" opacity=".8"/>
  <ellipse cx="40" cy="73" rx="6" ry="3.6" fill="#f5846e" opacity=".55"/><ellipse cx="80" cy="73" rx="6" ry="3.6" fill="#f5846e" opacity=".55"/>
  <ellipse cx="60" cy="71" rx="2.8" ry="2.1" fill="${shade(skin, -0.16)}"/><ellipse cx="59.2" cy="70.3" rx="1" ry=".7" fill="#fff" opacity=".6"/>
  <path d="M52 76.5 C55.5 81.5 64.5 81.5 68 76.5" fill="#8a3a2a" stroke="#3b2313" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M56 79.6 C58.5 80.6 61.5 80.6 64 79.6" fill="none" stroke="#e8707a" stroke-width="1.6" stroke-linecap="round"/>
  ${front}
  ${hatSvg}
  </g><circle cx="60" cy="60" r="58" fill="none" stroke="#3b2313" stroke-width="3"/></svg>`;
}
