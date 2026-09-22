/**
 * Procedural villager portraits (inline SVG, 200×200) drawn from the same NpcLook as the 3D rig:
 * soft painted background, shoulders + outfit (apron / scarf), head with warm shading, style-specific
 * hair (bun / bob / baker's cap / short), big glossy eyes, brows, blush, smile, glasses, beard.
 * `mood` nudges brows + mouth ('happy' | 'neutral' | 'surprised').
 */
import type { NpcLook } from '../data/npcs';

const css = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
function shade(h: number, k: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((h >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((h >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((h & 255) * k)));
  return css((r << 16) | (g << 8) | b);
}

export type Mood = 'happy' | 'neutral' | 'surprised';

let uid = 0;

export function portraitSvg(look: NpcLook, bg: [number, number], mood: Mood = 'happy'): string {
  const id = `p${uid++}`;
  const skin = look.skin;
  const hair = look.hair;
  const wide = look.build;
  const sw = 62 * wide;
  const parts: string[] = [];
  parts.push(`<defs>
    <radialGradient id="${id}bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${shade(bg[0], 1.08)}"/><stop offset="1" stop-color="${css(bg[1])}"/></radialGradient>
    <radialGradient id="${id}sk" cx="42%" cy="36%" r="70%"><stop offset="0" stop-color="${shade(skin, 1.08)}"/><stop offset="0.75" stop-color="${css(skin)}"/><stop offset="1" stop-color="${shade(skin, 0.86)}"/></radialGradient>
    <linearGradient id="${id}hr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(hair, 1.2)}"/><stop offset="1" stop-color="${shade(hair, 0.82)}"/></linearGradient>
    <linearGradient id="${id}top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(look.top, 1.1)}"/><stop offset="1" stop-color="${shade(look.top, 0.8)}"/></linearGradient>
  </defs>`);
  parts.push(`<rect width="200" height="200" fill="url(#${id}bg)"/>`);
  // Soft bokeh dots
  for (let i = 0; i < 7; i++) {
    const x = (i * 53 + 17) % 200;
    const y = (i * 37 + 23) % 120;
    parts.push(`<circle cx="${x}" cy="${y}" r="${8 + (i % 3) * 5}" fill="#fff" opacity="${0.08 + (i % 2) * 0.06}"/>`);
  }
  // Shoulders / outfit
  parts.push(`<path d="M${100 - sw - 18} 200 C ${100 - sw - 10} 158 ${100 - sw + 8} 146 100 144 C ${100 + sw - 8} 146 ${100 + sw + 10} 158 ${100 + sw + 18} 200 Z" fill="url(#${id}top)"/>`);
  if (look.apron !== undefined) {
    parts.push(`<path d="M${100 - sw * 0.55} 200 L ${100 - sw * 0.42} 158 Q 100 150 ${100 + sw * 0.42} 158 L ${100 + sw * 0.55} 200 Z" fill="${css(look.apron)}"/>`);
    parts.push(`<path d="M${100 - sw * 0.42} 158 L ${100 - 16} 146 M ${100 + sw * 0.42} 158 L ${100 + 16} 146" stroke="${shade(look.apron, 0.8)}" stroke-width="5" stroke-linecap="round"/>`);
  }
  // Neck
  parts.push(`<path d="M86 128 L86 150 Q100 158 114 150 L114 128 Z" fill="${shade(skin, 0.9)}"/>`);
  if (look.scarf !== undefined) {
    parts.push(`<path d="M76 146 Q100 162 124 146 Q126 156 118 160 Q100 168 82 160 Q74 156 76 146 Z" fill="${css(look.scarf)}"/>`);
    parts.push(`<path d="M110 158 L118 188 L128 184 L120 156 Z" fill="${shade(look.scarf, 0.9)}"/>`);
  }
  // Back hair (behind head)
  if (look.hairStyle === 'bob') parts.push(`<path d="M52 92 Q48 146 72 150 L128 150 Q152 146 148 92 Z" fill="url(#${id}hr)"/>`);
  if (look.hairStyle === 'bun') parts.push(`<circle cx="100" cy="38" r="22" fill="url(#${id}hr)"/><circle cx="92" cy="32" r="6" fill="#fff" opacity="0.12"/>`);
  // Ears + head
  parts.push(`<ellipse cx="55" cy="96" rx="9" ry="12" fill="${shade(skin, 0.95)}"/><ellipse cx="145" cy="96" rx="9" ry="12" fill="${shade(skin, 0.95)}"/>`);
  parts.push(`<ellipse cx="100" cy="90" rx="46" ry="48" fill="url(#${id}sk)"/>`);
  // Beard under features
  if (look.beard) {
    parts.push(`<path d="M58 96 Q60 142 100 146 Q140 142 142 96 Q132 118 100 120 Q68 118 58 96 Z" fill="url(#${id}hr)"/>`);
  }
  // Blush
  parts.push(`<ellipse cx="70" cy="106" rx="10" ry="6" fill="#f29a86" opacity="0.55"/><ellipse cx="130" cy="106" rx="10" ry="6" fill="#f29a86" opacity="0.55"/>`);
  // Eyes
  const eyeY = 95;
  const eyeH = mood === 'surprised' ? 13 : 11.5;
  for (const x of [80, 120]) {
    parts.push(`<ellipse cx="${x}" cy="${eyeY}" rx="7.2" ry="${eyeH}" fill="#2a1c16"/>`);
    parts.push(`<ellipse cx="${x + 2.5}" cy="${eyeY - 4.5}" rx="2.8" ry="3.4" fill="#fff"/><circle cx="${x - 2.4}" cy="${eyeY + 4}" r="1.3" fill="#fff" opacity="0.8"/>`);
  }
  // Brows
  const browLift = mood === 'surprised' ? -6 : mood === 'happy' ? -1 : 0;
  const bc = look.beard || look.hairStyle === 'cap' ? shade(hair, 0.9) : shade(hair, 0.85);
  parts.push(`<path d="M70 ${78 + browLift} Q80 ${72 + browLift} 90 ${77 + browLift}" stroke="${bc}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  parts.push(`<path d="M110 ${77 + browLift} Q120 ${72 + browLift} 130 ${78 + browLift}" stroke="${bc}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  // Nose + mouth
  parts.push(`<path d="M99 101 Q102 106 99 108" stroke="${shade(skin, 0.75)}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  if (look.beard) parts.push(`<path d="M84 114 Q100 106 116 114 Q108 118 100 116 Q92 118 84 114 Z" fill="${shade(hair, 0.9)}"/>`);
  if (mood === 'surprised') parts.push(`<ellipse cx="100" cy="122" rx="5" ry="6" fill="#6a2a22"/>`);
  else parts.push(`<path d="M${mood === 'happy' ? 89 : 92} 119 Q100 ${mood === 'happy' ? 128 : 123} ${mood === 'happy' ? 111 : 108} 119" stroke="#6a2a22" stroke-width="3.2" fill="${mood === 'happy' ? '#b8483c' : 'none'}" stroke-linecap="round"/>`);
  // Glasses
  if (look.glasses) {
    parts.push(`<circle cx="80" cy="95" r="14" fill="#fff" opacity="0.12" stroke="#7a5234" stroke-width="3"/><circle cx="120" cy="95" r="14" fill="#fff" opacity="0.12" stroke="#7a5234" stroke-width="3"/><path d="M94 93 Q100 89 106 93" stroke="#7a5234" stroke-width="3" fill="none"/>`);
  }
  // Front hair
  switch (look.hairStyle) {
    case 'bun':
      parts.push(`<path d="M54 90 Q52 44 100 42 Q148 44 146 90 Q138 64 118 60 Q106 72 78 70 Q62 72 54 90 Z" fill="url(#${id}hr)"/>`);
      parts.push(`<path d="M54 90 Q50 108 58 118 Q60 100 62 90 Z M146 90 Q150 108 142 118 Q140 100 138 90 Z" fill="url(#${id}hr)"/>`);
      break;
    case 'bob':
      parts.push(`<path d="M52 96 Q46 40 100 38 Q154 40 148 96 Q142 70 128 62 Q120 78 98 74 Q86 86 70 76 Q58 82 52 96 Z" fill="url(#${id}hr)"/>`);
      parts.push(`<path d="M70 50 Q92 40 116 48" stroke="#fff" stroke-width="4" opacity="0.18" fill="none" stroke-linecap="round"/>`);
      break;
    case 'cap':
      parts.push(`<path d="M54 84 Q58 60 100 58 Q142 60 146 84 L146 76 Q146 56 100 54 Q54 56 54 76 Z" fill="url(#${id}hr)"/>`);
      parts.push(`<rect x="52" y="52" width="96" height="18" rx="6" fill="#f3ece0"/>`);
      parts.push(`<path d="M48 56 Q42 22 76 18 Q96 4 120 16 Q156 16 152 56 Z" fill="#fbf7ee"/>`);
      parts.push(`<path d="M70 30 Q84 22 100 28" stroke="#e8dfcf" stroke-width="4" fill="none" stroke-linecap="round"/>`);
      break;
    default:
      parts.push(`<path d="M54 88 Q52 40 100 40 Q148 40 146 88 Q132 58 100 62 Q68 58 54 88 Z" fill="url(#${id}hr)"/>`);
  }
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
