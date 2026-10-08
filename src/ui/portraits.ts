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
import { lookOwner, seasonLook, type NpcLook, type Mood, type Backdrop } from '../data/npcs';
import type { Season } from '../core/time';
import { renderVillagerPortrait, PORTRAIT_HEAD } from '../entities/villager';

export type { Mood };

/**
 * The cast's portraits are their own 3D models (entities/villager.ts renderVillagerPortrait: the
 * same mesh, colours, hair, hat, face rig and mood pose), composited here over the painted backdrop
 * with the mood's colour temperature and manga marks — so the card and the villager in the street
 * are unmistakably one character (r3 critic: the painted bust had other hair, skin and freckles).
 * The painted SVG bust below stays the fallback (no WebGL) and draws festival extras.
 */
let portraitSeason: Season = 'spring';
/** The season whose wardrobe the portraits wear (NpcSystem pushes it). */
export function setPortraitSeason(s: Season): void {
  portraitSeason = s;
}
const P3D = new Map<string, string | null>();
/** Where the head sits in each rendered bust (fractions of the frame) — the manga marks follow it. */
const P3D_HEAD = new Map<string, { x: number; y: number; r: number }>();
/** Painted-mode switch for A/B shots and tests (`__game` eval): false = the SVG bust. */
export const portraitOpts = { model3d: false, plate: true, persona: true };

/** Data URL of the 3D bust for this look + mood (cached), or null (not a villager / no WebGL). */
export function portrait3dUrl(look: NpcLook, mood: Mood): string | null {
  if (!portraitOpts.model3d) return null;
  const own = lookOwner(look);
  if (!own) return null;
  const L = own.season === null ? seasonLook(own.def, portraitSeason) : look;
  const key = `${own.def.id}|${own.season ?? portraitSeason}|${mood}`;
  if (P3D.has(key)) return P3D.get(key)!;
  const c = renderVillagerPortrait(own.def, L, mood);
  let url: string | null = null;
  if (c) {
    url = c.toDataURL('image/webp', 0.9);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
    const h = PORTRAIT_HEAD.get(c);
    if (h) P3D_HEAD.set(url, h);
  }
  P3D.set(key, url);
  return url;
}

/** Warm the cache (idle time, e.g. when the talk prompt pops over a villager). */
export function prewarmPortraits(look: NpcLook, moods: Mood[]): void {
  for (const m of moods) portrait3dUrl(look, m);
}

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
  wistful: { open: 0.55, smile: 0.15, gazeX: -1.5, gazeY: 2, pupil: 1, closed: false, browIn: -4, browOut: 2, browRaiseL: 0, blush: 0.5, tilt: 3 },
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
  wistful: { dx: 1, dy: 3, tilt: 4, scale: 1, shoulders: 3, hand: 'chest', tint: '#e8a87a', tintA: 0.22 },
};

/**
 * Head turn per mood (0 = square to the viewer, 1 ≈ 35° towards the dialogue text on the left):
 * a candid three-quarter view by default, squaring up in surprise or anger, looking away when shy,
 * sad or lost in thought.
 */
const TURN: Record<Mood, number> = { neutral: 0.42, happy: 0.36, laugh: 0.3, sad: 0.62, angry: 0.14, surprised: 0.06, blush: 0.72, worried: 0.46, thinking: 0.66, wistful: 0.55 };
/** Moods whose gaze leaves the viewer (the eyes don't swing back to meet the lens). */
const LOOK_AWAY = new Set<Mood>(['sad', 'blush', 'thinking']);

/**
 * r9 per-villager facial grammar (critic: "most faces share the same large-eye, small-nose, mouth
 * grammar; emotions lean on universal tears, sparkles and manga marks; cropped without hair or hats,
 * identities converge"). Each villager draws with their own iris-to-white ratio, lash / lid weight,
 * under-eye structure, a resting asymmetry, a mouth and lip shape (prim, wide, full, gap-toothed,
 * lopsided), age marks, a signature smudge and shoulder line — and only the marks they would make:
 * Tobias and Bram never cry on the card (the jaw sets), Odessa's one tear is rare and earned, Bram sweats,
 * Kit does all of it.
 */
interface Persona {
  /** Iris size within the eye (1 = the chibi default). */
  iris: number;
  /** Eye size multiplier on top of the face structure. */
  eye: number;
  /** Upper lash-line weight. */
  lid: number;
  /** Lower lid / under-eye structure (0 none … 1 heavy bags). */
  under: number;
  /** Resting asymmetry: + raises the viewer-left brow and lifts the mouth's right corner. */
  asym: number;
  mouth: 'plain' | 'prim' | 'wide' | 'full' | 'gap' | 'smirk' | 'soft';
  /** Lip colour for drawn lips (full / prim / soft). */
  lip?: number;
  /** Crow's feet, forehead lines, jowls, cheekbone shade (0–1.2). */
  crow: number;
  browLines: number;
  jowl: number;
  cheekbone: number;
  smudge?: { c: number; at: 'cheekL' | 'cheekR' | 'nose' | 'brow'; kind: 'flour' | 'soot' | 'paint' | 'dirt' };
  /** Shoulder width / slump (px). */
  sh: number;
  slump: number;
  /** Which marks this villager makes. */
  marks: ('tear' | 'sparkle' | 'burst' | 'vein' | 'sweat' | 'think')[];
}
const PERSONA: Record<string, Persona> = {
  marigold: { iris: 0.82, eye: 0.94, lid: 1.05, under: 0.75, asym: 0.45, mouth: 'prim', lip: 0xb86a7a, crow: 1, browLines: 0.5, jowl: 0.35, cheekbone: 0, sh: 0.92, slump: 1, marks: ['sparkle', 'think', 'vein'] },
  bram: { iris: 0.86, eye: 0.96, lid: 1.35, under: 0.45, asym: -0.25, mouth: 'wide', crow: 0.7, browLines: 0.2, jowl: 0.65, cheekbone: 0, smudge: { c: 0xfaf4ea, at: 'cheekL', kind: 'flour' }, sh: 1.14, slump: 0, marks: ['burst', 'sweat'] },
  wren: { iris: 1.06, eye: 1, lid: 0.9, under: 0, asym: 0.5, mouth: 'soft', lip: 0xd8707a, crow: 0, browLines: 0, jowl: 0, cheekbone: 0, smudge: { c: 0x4a8ab8, at: 'cheekR', kind: 'paint' }, sh: 0.9, slump: 0, marks: ['tear', 'sparkle', 'think', 'burst'] },
  odessa: { iris: 0.78, eye: 0.92, lid: 1.5, under: 0.3, asym: -0.35, mouth: 'full', lip: 0x7a3a34, crow: 0.2, browLines: 0, jowl: 0, cheekbone: 0.7, smudge: { c: 0x2a221e, at: 'cheekR', kind: 'soot' }, sh: 1.2, slump: -1, marks: ['sweat', 'tear'] },
  linus: { iris: 0.8, eye: 0.93, lid: 1.1, under: 0.85, asym: 0.3, mouth: 'prim', lip: 0xa8645a, crow: 0.6, browLines: 0.45, jowl: 0, cheekbone: 0.45, sh: 0.88, slump: 2, marks: ['sweat', 'think'] },
  june: { iris: 0.94, eye: 0.98, lid: 1.25, under: 0.25, asym: -0.2, mouth: 'full', lip: 0xc8484a, crow: 0.35, browLines: 0, jowl: 0.1, cheekbone: 0.2, sh: 1.04, slump: 0, marks: ['tear', 'vein', 'sparkle'] },
  tobias: { iris: 0.74, eye: 0.92, lid: 1.55, under: 1, asym: 0.25, mouth: 'plain', crow: 1.2, browLines: 1, jowl: 0.5, cheekbone: 0.3, sh: 0.94, slump: 4, marks: ['think'] },
  kit: { iris: 1.12, eye: 1.02, lid: 0.85, under: 0, asym: 0.2, mouth: 'gap', crow: 0, browLines: 0, jowl: 0, cheekbone: 0, sh: 0.84, slump: -1, marks: ['tear', 'sparkle', 'burst', 'sweat', 'think', 'vein'] },
  rowan: { iris: 0.84, eye: 0.95, lid: 1.3, under: 0.35, asym: -0.6, mouth: 'smirk', crow: 0.2, browLines: 0.15, jowl: 0, cheekbone: 0.55, smudge: { c: 0xd8b07a, at: 'brow', kind: 'dirt' }, sh: 1.1, slump: 1, marks: ['sweat', 'think'] },
  hazel: { iris: 0.86, eye: 0.95, lid: 1, under: 0.6, asym: -0.25, mouth: 'soft', lip: 0xc87a84, crow: 1.15, browLines: 0.75, jowl: 0.25, cheekbone: 0, smudge: { c: 0x6a4a2a, at: 'cheekL', kind: 'dirt' }, sh: 0.9, slump: 2, marks: ['tear', 'sparkle', 'think'] },
};
const PERSONA_DEFAULT: Persona = { iris: 1, eye: 1, lid: 1, under: 0, asym: 0, mouth: 'plain', crow: 0, browLines: 0, jowl: 0, cheekbone: 0, sh: 1, slump: 0, marks: ['tear', 'sparkle', 'burst', 'vein', 'sweat', 'think'] };
/** The villager's persona (`portraitOpts.persona = false`: the shared r8 grammar, for A/B). */
function personaOf(look: NpcLook): Persona {
  if (!portraitOpts.persona) return PERSONA_DEFAULT;
  const own = lookOwner(look);
  return (own && PERSONA[own.def.id]) || PERSONA_DEFAULT;
}

/** Lips drawn under / around the mood's mouth line for full, prim and soft mouths; teeth details. */
function mouthPersona(P: Persona, mood: Mood, cx: number, y: number, skin: number): string {
  const open = mood === 'happy' || mood === 'laugh' || mood === 'surprised' || mood === 'angry';
  const out: string[] = [];
  if (P.mouth === 'gap' && (mood === 'happy' || mood === 'laugh')) out.push(`<rect x="${cx + 1.5}" y="${y - (mood === 'laugh' ? 1.6 : 0.6)}" width="3.4" height="${mood === 'laugh' ? 4.6 : 3.8}" fill="#5a1e1a"/>`);
  if (P.mouth === 'wide' && (mood === 'happy' || mood === 'laugh')) out.push(`<path d="M${cx} ${y - (mood === 'laugh' ? 1 : 0.2)} v 3.2" stroke="#d8c8b8" stroke-width="0.9"/>`);
  if (P.lip === undefined) return out.join('');
  const lc = css(P.lip);
  if (P.mouth === 'full') {
    // A real lower lip under every closed mouth and an upper-lip bow; on open mouths just the bow.
    if (!open) out.push(`<path d="M${cx - 8} ${y + 3.5} Q ${cx} ${y + 11} ${cx + 8} ${y + 3.5} Q ${cx} ${y + 6.5} ${cx - 8} ${y + 3.5} Z" fill="${lc}" opacity="0.78"/><path d="M${cx - 3} ${y + 6.2} q 3 1.4 6 0" stroke="#fff" stroke-width="1.1" opacity="0.45" fill="none"/>`);
    out.push(`<path d="M${cx - 9} ${y + (open ? -1 : 1)} Q ${cx - 4} ${y - 4} ${cx} ${y - 1.8} Q ${cx + 4} ${y - 4} ${cx + 9} ${y + (open ? -1 : 1)}" stroke="${lc}" stroke-width="2.2" fill="none" opacity="0.65" stroke-linecap="round"/>`);
  } else if (P.mouth === 'prim') {
    // Pursed: small tucks at the corners, a thin tinted lower lip.
    if (!open) out.push(`<path d="M${cx - 9} ${y} l -1.2 2.6 M${cx + 9} ${y} l 1.2 2.6" stroke="${mix(P.lip, skin, 0.25)}" stroke-width="1.3" stroke-linecap="round" opacity="0.8"/><path d="M${cx - 5} ${y + 5.6} Q ${cx} ${y + 8} ${cx + 5} ${y + 5.6}" stroke="${lc}" stroke-width="2" fill="none" opacity="0.55" stroke-linecap="round"/>`);
  } else if (P.mouth === 'soft') {
    if (!open) out.push(`<path d="M${cx - 6} ${y + 4.6} Q ${cx} ${y + 9} ${cx + 6} ${y + 4.6}" stroke="${lc}" stroke-width="2.6" fill="none" opacity="0.6" stroke-linecap="round"/>`);
  }
  return out.join('');
}


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

/** Eye cut per NpcLook.eyeShape: half width, upper / lower lid height, iris scale, outer-corner lift, heavy-lid cover. */
const EYE_CUT: Record<string, { W: number; up: number; low: number; ik: number; lift: number; lid: number }> = {
  round: { W: 9.5, up: 11.5, low: 8.5, ik: 1, lift: 0, lid: 0 },
  wide: { W: 10.4, up: 13, low: 9.5, ik: 1.08, lift: 0.5, lid: 0 },
  almond: { W: 10.8, up: 10, low: 6.6, ik: 0.95, lift: 2.4, lid: 0 },
  narrow: { W: 10, up: 7.4, low: 5.2, ik: 0.86, lift: 1.2, lid: 0 },
  sleepy: { W: 10, up: 10, low: 7.5, ik: 1, lift: -0.8, lid: 0.42 },
  beady: { W: 7.6, up: 9, low: 7.2, ik: 0.74, lift: 0, lid: 0 },
};

function eye(id: string, x: number, y: number, side: -1 | 1, m: MoodParams, iris: number, lash: string, skin: number, old: boolean, cut = EYE_CUT.round!, lashes = false, P: Persona = PERSONA_DEFAULT): string {
  const W = cut.W;
  const lw = P.lid;
  const out: string[] = [];
  if (m.closed) {
    // ^ ^ closed happy eyes
    out.push(`<path d="M${x - W} ${y + 1} Q ${x} ${y - 9} ${x + W} ${y + 1}" stroke="${lash}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`);
    out.push(`<path d="M${x + side * W} ${y + 1} l ${side * 3} -2" stroke="${lash}" stroke-width="2.4" stroke-linecap="round"/>`);
    return out.join('');
  }
  const up = cut.up * m.open;
  const low = cut.low - m.smile * 4 * (cut.low / 8.5);
  // (outer corner lifted for almond / narrow cuts; the outer corner is on the eye's own side)
  const yl = y - (side < 0 ? cut.lift : 0);
  const yr = y - 1 - (side > 0 ? cut.lift : 0);
  const sclera = `M${x - W} ${yl} Q ${x - W * 0.6} ${y - up} ${x + side * 1} ${y - up} Q ${x + W * 0.8} ${y - up * 0.9} ${x + W} ${yr} Q ${x + W * 0.5} ${y + low} ${x} ${y + low} Q ${x - W * 0.6} ${y + low} ${x - W} ${yl} Z`;
  out.push(`<clipPath id="${id}c${side}"><path d="${sclera}"/></clipPath>`);
  out.push(`<path d="${sclera}" fill="#fffaf4"/>`);
  const ix = x + m.gazeX + side * 0.3;
  const iy = y - 1 + m.gazeY;
  out.push(`<g clip-path="url(#${id}c${side})">`);
  // Lid shadow on the white
  out.push(`<path d="M${x - W} ${y - up + 1} L ${x + W} ${y - up + 1} L ${x + W} ${y - up + 5} Q ${x} ${y - up + 7} ${x - W} ${y - up + 5} Z" fill="${shade(skin, 0.7)}" opacity="0.35"/>`);
  const k = cut.ik;
  out.push(`<ellipse cx="${ix}" cy="${iy}" rx="${6.6 * k}" ry="${8 * k}" fill="url(#${id}iris)"/>`);
  out.push(`<ellipse cx="${ix}" cy="${iy}" rx="${6.6 * k}" ry="${8 * k}" fill="none" stroke="${shade(iris, 0.45)}" stroke-width="1.1"/>`);
  out.push(`<ellipse cx="${ix}" cy="${iy + 0.6}" rx="${3.1 * m.pupil * k}" ry="${4.2 * m.pupil * k}" fill="#1a1010"/>`);
  out.push(`<ellipse cx="${ix + 2.4 * k}" cy="${iy - 3.4 * k}" rx="${2.3 * Math.max(0.8, k)}" ry="${2.7 * Math.max(0.8, k)}" fill="#fff"/>`);
  out.push(`<circle cx="${ix - 2.4 * k}" cy="${iy + 3.6 * k}" r="1.2" fill="#fff" opacity="0.85"/>`);
  if (cut.lid > 0) {
    // Heavy upper lid (sleepy cut): skin over the top of the iris, its edge the lash line.
    const ly = y - up + up * cut.lid * 1.7;
    out.push(`<path d="M${x - W - 2} ${y - up - 3} L ${x + W + 2} ${y - up - 3} L ${x + W + 2} ${ly - 1} Q ${x} ${ly + 2.2} ${x - W - 2} ${ly - 1} Z" fill="${shade(skin, 0.93)}"/>`);
  }
  out.push(`</g>`);
  // Lash line (thicker on the outer corner) + lower lid hint
  if (cut.lid > 0) {
    const ly = y - up + up * cut.lid * 1.7;
    out.push(`<path d="M${x - W - 0.5} ${ly - 0.4} Q ${x} ${ly + 2.6} ${x + W + 0.5} ${ly - 0.6}" stroke="${lash}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    out.push(`<path d="M${x - W - 0.5} ${yl + 0.5} Q ${x - W * 0.6} ${y - up - 0.8} ${x + side * 1} ${y - up - 0.8} Q ${x + W * 0.8} ${y - up * 0.9 - 0.8} ${x + W + 0.5} ${yr}" stroke="${shade(skin, 0.62)}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`);
  } else out.push(`<path d="M${x - W - 0.5} ${yl + 0.5} Q ${x - W * 0.6} ${y - up - 0.8} ${x + side * 1} ${y - up - 0.8} Q ${x + W * 0.8} ${y - up * 0.9 - 0.8} ${x + W + 0.5} ${yr}" stroke="${lash}" stroke-width="${(3 * lw).toFixed(2)}" fill="none" stroke-linecap="round"/>`);
  const oy = side > 0 ? yr : yl;
  out.push(`<path d="M${x + side * W} ${oy} l ${side * 3.2} ${-2.6}" stroke="${lash}" stroke-width="2.4" stroke-linecap="round"/>`);
  if (lashes) out.push(`<path d="M${x + side * (W - 2.5)} ${oy - up * 0.55} l ${side * 2.8} ${-3}" stroke="${lash}" stroke-width="1.9" stroke-linecap="round"/><path d="M${x + side * (W + 0.5)} ${oy + 1.6} l ${side * 3.4} ${-0.6}" stroke="${lash}" stroke-width="1.6" stroke-linecap="round"/>`);
  out.push(`<path d="M${x - W * 0.7} ${y + low - 0.5} Q ${x} ${y + low + 1.5} ${x + W * 0.7} ${y + low - 0.5}" stroke="${shade(skin, 0.62)}" stroke-width="${(1.1 + P.under * 0.5).toFixed(2)}" fill="none" opacity="0.7"/>`);
  // Under-eye structure: a second, softer crescent (bags / a tired lower lid) for the older faces.
  if (P.under >= 0.5) out.push(`<path d="M${x - W * 0.75} ${y + low + 2.6} Q ${x + side * 1} ${y + low + 6 + P.under * 1.6} ${x + W * 0.75} ${y + low + 2.2}" stroke="${shade(skin, 0.7)}" stroke-width="1" fill="none" opacity="${(0.35 + P.under * 0.3).toFixed(2)}" stroke-linecap="round"/>`);
  // Crease above the lid
  out.push(`<path d="M${x - W * 0.7} ${y - up - 3.6} Q ${x} ${y - up - 6} ${x + W * 0.8} ${y - up - 3}" stroke="${shade(skin, 0.7)}" stroke-width="1" fill="none" opacity="0.6"/>`);
  if (old || P.crow > 0.5) {
    // Crow's feet fan from the outer corner (three for the oldest faces).
    const n = P.crow >= 1 ? 3 : 2;
    let d = '';
    for (let i = 0; i < n; i++) d += `M${x + side * (W + 2.6)} ${y + 0.5 + i * 2.4} l ${side * (4 + P.crow * 1.5)} ${-2.6 + i * 2.2} `;
    out.push(`<path d="${d}" stroke="${shade(skin, 0.66)}" stroke-width="0.95" opacity="0.8" stroke-linecap="round"/>`);
  }
  return out.join('');
}

/**
 * A tapered painted brow: a filled crescent (thick at the inner head, a fine tail) with a dark ink
 * edge, bent by the mood and the villager's own arch. Returns the path and its lowest point (the
 * audit keeps every brow clear above the upper lid).
 */
function browShape(x: number, y: number, side: -1 | 1, m: MoodParams, thick: number, arch: number): { d: string; low: number } {
  const inner = y + m.browIn * 0.8;
  const outer = y + m.browOut * 0.8 + (side === -1 ? m.browRaiseL : 0);
  const xi = x - side * 9;
  const xo = x + side * 10.5;
  const cy = Math.min(inner, outer) - 4 * (1 + arch * 1.6);
  const t0 = thick * 0.62;
  const t1 = thick * 0.18;
  // top edge inner→outer, bottom edge outer→inner
  const d = `M${xi} ${inner - t0} Q ${x} ${cy - t0 * 0.8} ${xo} ${outer + 1 - t1} Q ${xo + side * 1.2} ${outer + 1.4} ${xo - side * 0.4} ${outer + 1 + t1} Q ${x} ${cy + t0 * 1.1} ${xi} ${inner + t0} Q ${xi - side * 1.6} ${inner} ${xi} ${inner - t0} Z`;
  return { d, low: Math.max(inner + t0, outer + 1 + t1) };
}
function brow(x: number, y: number, side: -1 | 1, m: MoodParams, color: string, thick: number, arch = 0, inkC = '#2a120c'): string {
  const b = browShape(x, y, side, m, thick, arch);
  return `<path d="${b.d}" fill="${color}" stroke="${inkC}" stroke-width="1.1" stroke-linejoin="round"/>`;
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
      if (L.hat === 'flatcap' || L.hat === 'beanie' || L.hat === 'bandana') {
        // Tufts curling out from under the hat over each ear (soft tapered locks, not blocks).
        const tuft = (sx: number): string =>
          `<path d="M${cx + sx * (w - 9)} ${t + 26} Q ${cx + sx * (w + 7)} ${t + 30} ${cx + sx * (w + 5)} ${t + 46} Q ${cx + sx * (w + 3)} ${t + 54} ${cx + sx * (w - 1)} ${t + 60} Q ${cx + sx * (w + 1)} ${t + 50} ${cx + sx * (w - 3)} ${t + 44} Q ${cx + sx * (w - 4)} ${t + 34} ${cx + sx * (w - 9)} ${t + 26} Z" fill="${H}" ${s}/>` +
          `<path d="M${cx + sx * (w - 2)} ${t + 32} Q ${cx + sx * (w + 2)} ${t + 40} ${cx + sx * (w + 1)} ${t + 48}" stroke="${hl}" stroke-width="1.6" fill="none" opacity="0.5" stroke-linecap="round"/>`;
        return tuft(-1) + tuft(1);
      }
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
  const url = portrait3dUrl(look, mood);
  if (url) return modelPortraitSvg(url, look, bg, mood);
  return paintedPortraitSvg(look, bg, mood);
}

/**
 * The 3D bust over the painted place: backdrop + the mood's light (warm joy, cool sorrow, a hot red
 * edge for anger, rays for surprise / laughter), a soft contact shadow, the render, then manga marks
 * round the head (tear, sweat drop, anger vein, sparkles, thought bubbles) and the canvas grain.
 * The head sits at ≈ (100, 90) with a radius of ≈ 64 (see renderVillagerPortrait's framing).
 */
function modelPortraitSvg(url: string, look: NpcLook, bg: [number, number], mood: Mood): string {
  const id = `p${uid++}`;
  const p: string[] = [];
  p.push(`<defs>
    <radialGradient id="${id}bg" cx="42%" cy="34%" r="80%"><stop offset="0" stop-color="${shade(bg[0], 1.1)}"/><stop offset="0.6" stop-color="${css(bg[0])}"/><stop offset="1" stop-color="${css(bg[1])}"/></radialGradient>
    <radialGradient id="${id}vig" cx="50%" cy="46%" r="72%"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2a1408" stop-opacity="0.34"/></radialGradient>
    <linearGradient id="${id}shaft" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff8e0" stop-opacity="0"/><stop offset="0.5" stop-color="#fff8e0" stop-opacity="0.32"/><stop offset="1" stop-color="#fff8e0" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}cool" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a7a" stop-opacity="0.05"/><stop offset="1" stop-color="#2a3a7a" stop-opacity="0.35"/></linearGradient>
    <radialGradient id="${id}hot" cx="50%" cy="46%" r="70%"><stop offset="0.55" stop-color="#ff3a1a" stop-opacity="0"/><stop offset="1" stop-color="#c81a0a" stop-opacity="0.5"/></radialGradient>
    <radialGradient id="${id}halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff8e6" stop-opacity="0.55"/><stop offset="1" stop-color="#fff8e6" stop-opacity="0"/></radialGradient>
    <filter id="${id}dof" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <filter id="${id}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="${id}grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>`);
  p.push(backdrop(id, bg, look.backdrop));
  // Winter: the place outside is under snow (a cool, bright wash and falling flakes behind the bust).
  if (portraitSeason === 'winter') {
    p.push(`<rect width="200" height="200" fill="#dfe8f6" opacity="0.42" style="mix-blend-mode:screen"/><rect y="120" width="200" height="80" fill="#f4f7fb" opacity="0.35"/>`);
    p.push(`<g fill="#fff" opacity="0.85">${Array.from({ length: 22 }, (_, i) => `<circle cx="${(i * 37 + 13) % 200}" cy="${(i * 53 + 7) % 190}" r="${1.2 + (i % 3) * 0.8}"/>`).join('')}</g>`);
  }
  const pz = POSE[mood] ?? POSE.neutral;
  p.push(`<rect width="200" height="200" fill="${pz.tint}" opacity="${pz.tintA}" style="mix-blend-mode:${mood === 'sad' || mood === 'worried' ? 'multiply' : 'soft-light'}"/>`);
  if (mood === 'sad') p.push(`<rect width="200" height="200" fill="url(#${id}cool)"/>`);
  if (mood === 'angry') p.push(`<rect width="200" height="200" fill="url(#${id}hot)"/>`);
  if (mood === 'surprised' || mood === 'laugh')
    p.push(`<g opacity="${mood === 'surprised' ? 0.45 : 0.3}" stroke="#fffbe8" stroke-width="4" stroke-linecap="round">${Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      return `<path d="M${100 + Math.cos(a) * 74} ${80 + Math.sin(a) * 74} L ${100 + Math.cos(a) * 104} ${80 + Math.sin(a) * 104}"/>`;
    }).join('')}</g>`);
  // A soft light pool behind the head lifts the silhouette off the busy backdrop.
  p.push(`<ellipse cx="96" cy="84" rx="80" ry="74" fill="url(#${id}halo)"/>`);
  p.push(`<ellipse cx="104" cy="206" rx="78" ry="22" fill="#2a1408" opacity="0.3" filter="url(#${id}soft)"/>`);
  p.push(`<image href="${url}" x="0" y="0" width="200" height="200" preserveAspectRatio="xMidYMid meet"/>`);
  // Manga marks round the head (head centre ≈ 100,76, radius ≈ 56; the face turns to the left).
  const hd = P3D_HEAD.get(url);
  const hx = hd ? hd.x * 200 : 100;
  const R = hd ? Math.min(84, hd.r * 200 * 1.12) : 64;
  const top = hd ? Math.max(8, hd.y * 200 - R * 0.85) : 22;
  if (mood === 'worried') p.push(`<path d="M${hx + R - 4} ${top + 26} q -7 10 0 15 q 7 -5 0 -15 Z" fill="#9ad4f4" stroke="#4a8ac0" stroke-width="1.4"/>`);
  if (mood === 'angry') p.push(`<g stroke="#d8342a" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M${hx + R - 14} ${top + 6} q 5 5 10 0 M${hx + R - 9} ${top + 1} q 5 5 0 10 M${hx + R + 1} ${top + 6} q -5 5 -10 0"/></g>`);
  if (mood === 'surprised') p.push(`<g stroke="#5a3a2a" stroke-width="2.6" stroke-linecap="round"><path d="M${hx - R - 4} ${top + 10} l -9 -7 M${hx - R + 2} ${top} l -5 -10 M${hx + R + 4} ${top + 10} l 9 -7 M${hx + R - 2} ${top} l 5 -10"/></g>`);
  if (mood === 'blush' || mood === 'laugh' || mood === 'happy') p.push(`<g fill="#fff6c0" stroke="#e8b84a" stroke-width="0.9"><path d="M${hx + R + 8} ${top + 8} l 2.4 6 l 6 2.4 l -6 2.4 l -2.4 6 l -2.4 -6 l -6 -2.4 l 6 -2.4 Z"/>${mood === 'happy' ? '' : `<path d="M${hx - R - 8} ${top + 34} l 1.6 4 l 4 1.6 l -4 1.6 l -1.6 4 l -1.6 -4 l -4 -1.6 l 4 -1.6 Z"/>`}</g>`);
  if (mood === 'blush') p.push(`<g fill="#ff8fab" stroke="#c8506a" stroke-width="1"><path d="M${hx + R + 2} ${top + 40} c -4 -5 -10 -1 -6 4 l 6 6 l 6 -6 c 4 -5 -2 -9 -6 -4 Z"/></g>`);
  if (mood === 'thinking') p.push(`<g fill="#fffaf0" stroke="#7a5a3a" stroke-width="1.5"><circle cx="${hx + R + 6}" cy="${top + 8}" r="3.2"/><circle cx="${hx + R + 15}" cy="${top - 3}" r="4.8"/><circle cx="${hx + R + 26}" cy="${top - 18}" r="7.5"/></g>`);
  if (mood === 'sad') p.push(`<g stroke="#4a6ab0" stroke-width="2" stroke-linecap="round" opacity="0.55"><path d="M${hx - R - 6} ${top + 20} v 12 M${hx - R - 14} ${top + 30} v 12 M${hx + R + 8} ${top + 24} v 12"/></g>`);
  p.push(`<rect width="200" height="200" filter="url(#${id}grain)" opacity="0.09" style="mix-blend-mode:overlay"/>`);
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${p.join('')}</svg>`;
}

const lum = (h: number): number => (0.299 * ((h >> 16) & 255) + 0.587 * ((h >> 8) & 255) + 0.114 * (h & 255)) / 255;
/** Mean value of each painted place behind the bust (measured from the rendered cards, see auditPainted). */
const BACK_L: Record<string, number> = { shop: 0.67, bakery: 0.51, river: 0.76, forge: 0.25, clinic: 0.8, inn: 0.38, hall: 0.41, meadow: 0.81, workshop: 0.68, garden: 0.74 };
/**
 * The wash that keeps a ≥ .3 value gap between skin and backdrop: deep skin gets a cool pale plate,
 * light skin the place's own hue sunk dark. Returns colour + alpha (0 = none needed).
 */
export function valuePlate(skin: number, bg: [number, number], kind?: Backdrop): { c: number; a: number; skinL: number; backL: number } {
  const sk = lum(skin);
  const b0 = BACK_L[kind ?? ''] ?? (lum(bg[0]) + lum(bg[1])) / 2;
  let c: number;
  let target: number;
  if (sk < 0.62) {
    c = 0xe4ecf4;
    target = Math.min(0.9, sk + 0.34);
  } else {
    // (the backdrop's darker stop, sunk to a deep tone of its own hue)
    const h = bg[1];
    const k = 0.26 / Math.max(0.05, lum(h));
    c = (Math.min(255, Math.round(((h >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((h >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((h & 255) * k));
    target = Math.max(0.14, sk - 0.4);
  }
  const pl = lum(c);
  const need = sk < 0.62 ? b0 < target : b0 > target;
  const a = need ? Math.min(0.86, Math.max(0, (target - b0) / (pl - b0 || 1e-3))) : 0;
  return { c, a, skinL: sk, backL: b0 * (1 - a) + pl * a };
}

/** Close crop for the painted bust: scale round (100, 100) → (100, Y0), fitted to hats and brims. */
function portraitCrop(L: NpcLook, f: Face): { t: string; k: number } {
  const extra = L.hat === 'beanie' ? 34 : L.hat === 'sunhat' ? 30 : L.hat === 'bandana' ? 24 : L.hat === 'flatcap' ? 16 : L.hairStyle === 'cap' ? 34 : L.hairStyle === 'bun' ? 27 : L.hairStyle === 'spiky' ? 26 : L.hairStyle === 'curly' ? 16 : 8;
  const Y0 = 104;
  let k = Math.min(1.27, Math.max(1.0, (Y0 - 5) / (100 - (f.top - extra))));
  if (L.hat === "sunhat") k = Math.min(k, 1.2); // (the brim runs off both card edges, as a painter would crop it)
  return { t: `translate(100 ${Y0}) scale(${k.toFixed(3)}) translate(-100 -100)`, k };
}

/** The painted SVG bust (fallback without WebGL; festival extras). */
export function paintedPortraitSvg(look: NpcLook, bg: [number, number], mood: Mood = 'happy'): string {
  const id = `p${uid++}`;
  const L = look;
  const m0 = MOOD[mood] ?? MOOD.happy;
  const skin = L.skin;
  const hair = L.hair;
  const acc = new Set(L.acc ?? []);
  const old = acc.has('wrinkles') || (L.fp?.lines ?? 0) >= 0.3;
  const faceKind = L.face ?? 'round';
  const hs = L.head ?? 1;
  const w = (faceKind === 'long' ? 42 : faceKind === 'square' ? 47 : 45) * (hs > 1.05 ? 1.04 : 1);
  const f: Face = { cx: 100, top: faceKind === 'long' ? 42 : 46, chin: faceKind === 'long' ? 144 : faceKind === 'heart' ? 141 : 138, w, jaw: faceKind === 'square' ? 1.4 : faceKind === 'heart' ? 0.5 : faceKind === 'long' ? 0.9 : 1 };
  // Face structure (NpcLook.fp, the same numbers that shape the 3D head): width, jaw, length, chin.
  const fp = L.fp ?? {};
  f.w *= 0.55 + 0.45 * Math.min(1.2, Math.max(0.85, fp.w ?? 1));
  if (fp.jaw !== undefined) f.jaw = 0.55 + fp.jaw * 0.85;
  f.chin += ((fp.h ?? 1) - 1) * 36 + (fp.chin ?? 0) * 3;
  const sw = 58 * Math.min(1.35, Math.max(0.85, L.build)) * personaOf(L).sh;
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
  const this_brows: { side: number; low: number; eyeTop: number }[] = [];
  const plate = portraitOpts.plate ? valuePlate(skin, bg, L.backdrop) : { c: 0, a: 0, skinL: 0, backL: 0 };
  const crop = portraitCrop(L, f);
  const P = personaOf(L);
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
    <filter id="${id}ol" x="-8%" y="-8%" width="116%" height="116%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.35" result="d"/><feFlood flood-color="#2a120a"/><feComposite in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="${id}plate" cx="50%" cy="44%" r="70%"><stop offset="0" stop-color="${css(plate.c)}" stop-opacity="${plate.a.toFixed(3)}"/><stop offset="1" stop-color="${css(plate.c)}" stop-opacity="${(plate.a * 0.92).toFixed(3)}"/></radialGradient>
    <filter id="${id}grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/></filter>
    <filter id="${id}brush" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.07" numOctaves="3" seed="9"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>`);
  p.push(backdrop(id, bg, L.backdrop));
  // Colour temperature of the moment: warm gold for joy, cool blue for sorrow, a red rim for anger.
  const pz = POSE[mood] ?? POSE.neutral;
  p.push(`<rect width="200" height="200" fill="${pz.tint}" opacity="${pz.tintA}" style="mix-blend-mode:${mood === 'sad' || mood === 'worried' ? 'multiply' : 'soft-light'}"/>`);
  if (mood === 'sad') p.push(`<rect width="200" height="200" fill="url(#${id}cool)"/>`);
  if (mood === 'angry') p.push(`<rect width="200" height="200" fill="url(#${id}hot)"/>`);
  // Value plate (r7: Odessa's brown face on a brown forge): the backdrop is pushed ≥ .3 in value away
  // from the skin — a cool pale wash behind deep skin, the place's own hue sunk dark behind light skin.
  p.push(`<rect width="200" height="200" fill="url(#${id}plate)"/>`);
  if (mood === 'surprised' || mood === 'laugh')
    p.push(`<g opacity="${mood === 'surprised' ? 0.45 : 0.3}" stroke="#fffbe8" stroke-width="4" stroke-linecap="round">${Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      return `<path d="M${100 + Math.cos(a) * 70} ${88 + Math.sin(a) * 70} L ${100 + Math.cos(a) * 98} ${88 + Math.sin(a) * 98}"/>`;
    }).join('')}</g>`);
  const HT = `translate(${pz.dx} ${pz.dy}) rotate(${pz.tilt} 100 ${f.chin}) translate(100 ${f.chin}) scale(${pz.scale}) translate(-100 ${-f.chin})`;
  const ST = `translate(0 ${pz.shoulders * 0.7 + P.slump})`;
  // The bust is drawn slightly larger than the frame for a closer, more intimate crop.
  // Close crop (r7: the face must fill the card): head + shoulders scaled round a pivot so the face
  // spans ≥ 55 % of the card; an ink outline round the whole bust separates it from the place.
  p.push(`<g transform="${crop.t}"><g filter="url(#${id}ol)"><g filter="url(#${id}wob)">`);
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
    const ek = Math.min(1.3, Math.max(0.8, L.fp?.ears ?? 1));
    p.push(`<ellipse cx="${ex}" cy="${eyeY + 2}" rx="${8.5 * ek}" ry="${12 * ek}" fill="${shade(skin, 0.96)}" stroke="${ink(skin)}" stroke-width="1.6"/><path d="M${ex - sx * 1} ${eyeY - 4 * ek} q ${sx * 4 * ek} ${6 * ek} 0 ${12 * ek}" stroke="${mix(skin, 0x8a3028, 0.35)}" stroke-width="1.6" fill="none"/>`);
    if (acc.has('earrings')) p.push(`<circle cx="${ex + sx * 1}" cy="${eyeY + 15}" r="3.6" fill="#f2c43a" stroke="#a87a1a" stroke-width="1.2"/><circle cx="${ex + sx * 0.4}" cy="${eyeY + 14}" r="1.1" fill="#fff" opacity="0.8"/>`);
  }
  // Face
  p.push(`<path d="${facePath(f, tn)}" fill="url(#${id}sk)" stroke="${ink(skin)}" stroke-width="2"/>`);
  p.push(`<g clip-path="url(#${id}face)">`);
  // Cel shadow on the far cheek + rim light on the near one
  const warmShadow = mix(skin, 0x8a3028, 0.42);
  // (two-tone cel: a crisp-edged shadow shape, only a hair of blur)
  p.push(`<g filter="url(#${id}soft2)">`);
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
  // (r8b: tired lids as a warm mauve crescent tucked under each eye, following the head's turn — the
  // r7 blue ellipse sat out on the cheek and read as a bruise)
  if (mood === 'sad' || mood === 'worried') for (const sx of [-1, 1]) p.push(`<path d="M${X(sx * 20 - 7) } ${eyeY + 7} Q ${X(sx * 20)} ${eyeY + 12} ${X(sx * 20 + 7)} ${eyeY + 7}" stroke="${mix(skin, 0x6a3a5a, 0.45)}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="0.32" filter="url(#${id}soft2)"/>`);
  // Stubble / beard base inside the face
  if (beard === 'stubble') {
    // Five o'clock shadow as one soft cool-grey wash inside the jaw band (r7: stippled stubble read as
    // dirt / an eyepatch-dark ear) — under the mouth and along the jaw, never up the cheek.
    p.push(`<path transform="translate(${(d0 * 0.6).toFixed(2)} 0)" d="M${100 - f.w * 0.82} ${mouthY - 4} Q ${100 - f.w * 0.5} ${mouthY + 6} 100 ${mouthY + 4} Q ${100 + f.w * 0.5} ${mouthY + 6} ${100 + f.w * 0.82} ${mouthY - 4} Q ${100 + f.w * 0.8} ${f.chin} 100 ${f.chin + 3} Q ${100 - f.w * 0.8} ${f.chin} ${100 - f.w * 0.82} ${mouthY - 4} Z" fill="${mix(skin, 0x46505a, 0.42)}" opacity="0.32" filter="url(#${id}soft2)"/>`);
  }
  p.push(`</g>`);
  if (beard === 'full') p.push(`<path transform="translate(${(d0 * 0.5).toFixed(2)} 0)" d="M${100 - f.w + 2} ${eyeY + 6} Q ${100 - f.w + 2} ${f.chin + 12} 100 ${f.chin + 14} Q ${100 + f.w - 2} ${f.chin + 12} ${100 + f.w - 2} ${eyeY + 6} Q ${100 + f.w - 8} ${mouthY + 2} 100 ${mouthY + 2} Q ${100 - f.w + 8} ${mouthY + 2} ${100 - f.w + 2} ${eyeY + 6} Z" fill="url(#${id}hr)" stroke="${ink(hair)}" stroke-width="1.8"/><path d="M92 ${f.chin + 2} q 8 6 16 0" stroke="${shade(hair, 1.35)}" stroke-width="2" fill="none" opacity="0.5"/>`);
  // Blush
  // Blush: soft gradient ovals only (r7: stroked blush read as scrapes), stronger for rosy-cheeked
  // villagers, a wide warm flush across the nose when shy, a hot wash when angry.
  const cheekK = Math.min(1.3, Math.max(0.35, (L.fp?.cheeks ?? 0.6) / 0.6));
  const bo = Math.min(1, m.blush * (mood === 'blush' || mood === 'angry' ? 1 : cheekK));
  for (const sx of [-1, 1]) p.push(`<ellipse cx="${X(sx * 27)}" cy="${eyeY + 15}" rx="${(11 + m.blush * 3) * WS(sx * 27)}" ry="${6.5 + m.blush * 1.5}" fill="url(#${id}bl)" opacity="${bo}"/>`);
  if (mood === 'blush') p.push(`<ellipse cx="${X(0, 6)}" cy="${eyeY + 15}" rx="${f.w * 0.7}" ry="7" fill="url(#${id}bl)" opacity="0.45"/>`);
  if (mood === 'blush') for (const sx of [-1, 1]) p.push(`<ellipse cx="${X(sx * 25) - 3}" cy="${eyeY + 12}" rx="2.2" ry="1.4" fill="#fff" opacity="0.6"/>`);
  if (acc.has('freckles')) for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) p.push(`<circle cx="${X(sx * (16 + (i % 3) * 5 + (i > 2 ? 2 : 0)))}" cy="${eyeY + 10 + (i > 2 ? 5 : 0) + (i % 2)}" r="1.2" fill="${shade(skin, 0.62)}" opacity="0.75"/>`);
  if (old) {
    p.push(`<g transform="translate(${d0.toFixed(2)} 0)">`);
    // (forehead lines only for the oldest faces; the cheek lines read as scratches — r7 Hazel)
    if ((L.fp?.lines ?? 0) >= 0.75) p.push(`<path d="M${100 - 22} ${f.top + 18} q 22 -4 44 0" stroke="${mix(skin, 0x8a3028, 0.3)}" stroke-width="1" fill="none" opacity="0.5" stroke-linecap="round"/>`);
    p.push(`</g>`);
  }
  // Eyes + brows
  const kid = hs > 1.05;
  const ex = (kid ? 21.5 : acc.has('wrinkles') ? 20 : 20.5) * Math.min(1.12, Math.max(0.9, fp.gap ?? 1));
  const es = (kid ? 1.14 : acc.has('wrinkles') ? 0.93 : 1) * Math.min(1.18, Math.max(0.86, fp.eye ?? 1)) * P.eye;
  const cut0 = EYE_CUT[L.eyeShape ?? 'round'] ?? EYE_CUT.round!;
  const cut = { ...cut0, ik: cut0.ik * P.iris };
  // Each eye (and its brow / lens) is drawn square-on, then moved + foreshortened onto the turned head.
  const onHead = (x: number, svg: string, k = es): string => `<g transform="translate(${X(x).toFixed(2)} ${eyeY}) scale(${(k * WS(x)).toFixed(3)} ${k}) translate(${-x} ${-eyeY})">${svg}</g>`;
  p.push(onHead(-ex, eye(id, -ex, eyeY, -1, m, iris, lash, skin, old, cut, !!L.lashes, P)));
  p.push(onHead(ex, eye(id, ex, eyeY, 1, m, iris, lash, skin, old, cut, !!L.lashes, P)));
  // Brows: tapered painted crescents, thickness / arch from the look; light hair gets a darker brow
  // so it reads. Clamped clear above the upper lid (r7: a grey brow bar lay across Hazel's eye).
  const lightHair = ((hair >> 16) & 255) + ((hair >> 8) & 255) + (hair & 255) > 520;
  const browC = lightHair ? shade(hair, 0.68) : shade(hair, 0.85);
  const browT = (2.6 + 2.3 * Math.min(1.7, Math.max(0.6, L.brow ?? 1))) * (kid ? 1.05 : 1) + (mood === 'angry' ? 1.2 : 0);
  const arch = L.browArch ?? 0.2;
  const lidTop = cut.up * m0.open * es + (cut.lid > 0 ? 0 : 0);
  for (const side of [-1, 1] as const) {
    let by = eyeY - Math.max(18, cut.up * es + 6) - (side === -1 ? Math.max(0, P.asym) : Math.max(0, -P.asym)) * 3;
    const b0 = browShape(side * ex, by, side, m, browT, arch);
    const clear = eyeY - (m.closed ? 4 : lidTop) - 2.2;
    if (b0.low > clear) by -= b0.low - clear;
    this_brows.push({ side, low: browShape(side * ex, by, side, m, browT, arch).low, eyeTop: eyeY - (m.closed ? 4 : lidTop) });
    p.push(onHead(side * ex, brow(side * ex, by, side, m, browC, browT, arch, mix(hair, 0x1a0a06, 0.7)), 1));
  }
  // Nose
  // Painted nose: soft shadow down the far side of the bridge, a nostril shade, a lit tip.
  const nk = L.fp?.nose ?? 'button';
  const nl = (kid ? 0.8 : faceKind === 'long' ? 1.15 : 1) * (nk === 'long' || nk === 'hook' ? 1.18 : nk === 'snub' || nk === 'button' ? 0.86 : 1);
  const nwk = nk === 'broad' ? 1.45 : nk === 'bulb' ? 1.25 : nk === 'button' ? 0.85 : 1;
  const nd = X(0, 9) - 100;
  if (th > 0.05) p.push(`<path d="M${X(-4, 2) - 1} ${eyeY + 1} Q ${100 + nd - 5 - (nk === 'hook' ? 2.5 : 0)} ${eyeY + 9 * nl} ${100 + nd - 3.5} ${eyeY + 15.5 * nl}" stroke="${mix(skin, 0x8a3028, 0.4)}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="${Math.min(0.8, th * 2.6).toFixed(2)}"/>`);
  p.push(`<g transform="translate(${nd.toFixed(2)} 0)">`);
  // Cel shadow under / beside the nose (crisp edge, two tones), a lit tip.
  p.push(`<path d="M${101} ${eyeY + 3} Q ${106} ${eyeY + 10 * nl} ${104.5} ${eyeY + 16 * nl} Q ${100} ${eyeY + 19.5 * nl} ${95} ${eyeY + 17 * nl} Q ${100} ${eyeY + 17.5 * nl} ${102.5} ${eyeY + 14 * nl} Q ${103.5} ${eyeY + 9 * nl} ${101} ${eyeY + 3} Z" fill="${mix(skin, 0x8a3028, 0.32)}" opacity="0.55"/>`);
  if (nk === 'bulb') p.push(`<circle cx="99.5" cy="${eyeY + 14.5 * nl}" r="5.6" fill="${shade(skin, 1.02)}" stroke="${mix(skin, 0x8a3028, 0.45)}" stroke-width="1.2"/>`);
  p.push(`<path d="M${100 - 4 * nwk} ${eyeY + 16 * nl} Q ${100} ${eyeY + 18.8 * nl} ${100 + 4 * nwk} ${eyeY + 15.6 * nl}" stroke="${mix(skin, 0x6a2018, 0.48)}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`);
  if (nk === 'snub' || nk === 'broad') p.push(`<ellipse cx="${100 - 2.4 * nwk}" cy="${eyeY + 16.4 * nl}" rx="1.3" ry="0.9" fill="${mix(skin, 0x4a1410, 0.55)}"/><ellipse cx="${100 + 2.6 * nwk}" cy="${eyeY + 16.2 * nl}" rx="1.3" ry="0.9" fill="${mix(skin, 0x4a1410, 0.55)}"/>`);
  if (nk === 'hook') p.push(`<path d="M${101.5} ${eyeY + 4} Q ${105.5} ${eyeY + 7} ${103} ${eyeY + 10}" stroke="${mix(skin, 0x8a3028, 0.45)}" stroke-width="1.3" fill="none"/>`);
  p.push(`<ellipse cx="${98.6}" cy="${eyeY + 12.5 * nl}" rx="2.3" ry="1.8" fill="#fff" opacity="0.55"/>`);
  p.push(`</g>`);
  // Age: smile folds and a cleft chin from the face structure.
  if ((L.fp?.lines ?? 0) >= 0.5) for (const sx of [-1, 1]) p.push(`<path d="M${X(sx * 13, 2)} ${eyeY + 17} q ${sx * -5} 8 ${sx * -2} 16" transform="translate(${(d0 * 0.4).toFixed(2)} 0)" stroke="${mix(skin, 0x8a3028, 0.32)}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.55"/>`);
  if (L.fp?.cleft && beard !== 'full') p.push(`<path d="M${X(0, 3) - 2.5} ${f.chin - 7} q 2.5 3 5 0" stroke="${mix(skin, 0x8a3028, 0.42)}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`);
  if (beard === 'full' || beard === 'mustache') {
    const mc = `url(#${id}hr)`;
    p.push(`<path transform="translate(${(X(0, 4) - 100).toFixed(2)} 0)" d="M${100} ${mouthY - 7} Q ${88} ${mouthY - 12} ${78} ${mouthY - 2} Q ${86} ${mouthY - 3} ${92} ${mouthY - 1} Q ${97} ${mouthY - 3} ${100} ${mouthY - 5} Q ${103} ${mouthY - 3} ${108} ${mouthY - 1} Q ${114} ${mouthY - 3} ${122} ${mouthY - 2} Q ${112} ${mouthY - 12} ${100} ${mouthY - 7} Z" fill="${mc}" stroke="${ink(hair)}" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  const my = mouthY + (beard === 'full' || beard === 'mustache' ? 2 : 0);
  const mwk = Math.min(1.22, Math.max(0.8, L.fp?.mouth ?? 1));
  p.push(`<g transform="translate(${(X(0, 2) - 100).toFixed(2)} 0) translate(100 ${my}) rotate(${(-P.asym * 5).toFixed(2)}) scale(${((1 - 0.28 * Math.sin(th)) * mwk).toFixed(3)} 1) translate(-100 ${-my})">${mouthPersona(P, mood, 100, my, skin)}${mouth(mood, 100, my, skin, !!beard)}</g>`);
  // Structure + age (r9): cheekbone shade, forehead lines, jowls, a signature smudge.
  {
    const lineC = mix(skin, 0x8a3028, 0.32);
    const g: string[] = [];
    // (cheekbone: a soft hollow under the bone on the shadow side only — r9a's inked line on both
    // cheeks read as a scar)
    if (P.cheekbone > 0) g.push(`<path d="M${X(f.w - 8)} ${eyeY + 10} Q ${X(f.w - 15)} ${eyeY + 19} ${X(f.w - 24)} ${eyeY + 23}" stroke="${mix(skin, 0x6a2a20, 0.3)}" stroke-width="${(3 + P.cheekbone * 3).toFixed(2)}" fill="none" opacity="${(0.12 + P.cheekbone * 0.2).toFixed(2)}" stroke-linecap="round" filter="url(#${id}soft2)"/>`);
    if (P.browLines > 0.3) for (let i = 0; i < (P.browLines >= 0.9 ? 3 : 2); i++) g.push(`<path transform="translate(${(d0 * 0.8).toFixed(2)} 0)" d="M${100 - 16 + i * 2} ${f.top + 13 + i * 4.4} q ${16 - i * 2} ${-3.2} ${32 - i * 4} 0" stroke="${lineC}" stroke-width="1" fill="none" opacity="${(0.3 + P.browLines * 0.25).toFixed(2)}" stroke-linecap="round"/>`);
    if (P.jowl > 0.3 && beard !== 'full') for (const sx of [-1, 1]) g.push(`<path d="M${X(sx * (f.w - 12))} ${mouthY + 4} q ${sx * 3} 7 ${sx * -1} 12" stroke="${lineC}" stroke-width="1.1" fill="none" opacity="${(0.25 + P.jowl * 0.4).toFixed(2)}" stroke-linecap="round"/>`);
    if (P.smudge) {
      const sm = P.smudge;
      const sx = sm.at === 'cheekL' ? X(-24) : sm.at === 'cheekR' ? X(26) : sm.at === 'nose' ? X(0, 8) : X(14);
      const sy = sm.at === 'brow' ? f.top + 18 : eyeY + 17;
      const op = sm.kind === 'flour' ? 0.85 : sm.kind === 'paint' ? 0.8 : 0.5;
      // soot / dirt: a thin swipe of a thumb; flour / paint: a dab
      if (sm.kind === 'soot' || sm.kind === 'dirt') g.push(`<path d="M${sx - 7} ${sy + 1} q 6 -3 13 -1" stroke="${css(sm.c)}" stroke-width="2.6" fill="none" opacity="${op}" stroke-linecap="round" filter="url(#${id}soft2)"/>`);
      else g.push(`<path d="M${sx - 6} ${sy} q 3 -3 7 -1 q 4 1 5 4 q -5 2 -9 0 q -3 -1 -3 -3 Z" fill="${css(sm.c)}" opacity="${op}" filter="url(#${id}soft2)"/>`);
      if (sm.kind === 'paint') g.push(`<circle cx="${sx + 9}" cy="${sy - 4}" r="1.6" fill="${css(0xe8574a)}" opacity="0.8"/>`);
    }
    p.push(g.join(''));
  }
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
    // Two-tone hair: a crisp lit band across the crown + a crisp shade band where it meets the face.
    p.push(`<g clip-path="url(#${id}hc)"><g><path d="M${100 - f.w * 0.8} ${f.top + 10} Q ${100 - 4} ${f.top - 4} ${100 + f.w * 0.55} ${f.top + 8}" stroke="${mix(L.hair, 0xfff6e0, 0.42)}" stroke-width="5" fill="none" opacity="0.6" stroke-linecap="round"/>`);
    p.push(`<path d="M${100 - f.w} ${f.top + 36} Q 100 ${f.top + 22} ${100 + f.w} ${f.top + 36}" stroke="${shade(L.hair, 0.55)}" stroke-width="10" fill="none" opacity="0.5"/></g></g>`);
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
  const mk = new Set(P.marks);
  if (mood === 'sad' && mk.has('tear')) p.push(`<path d="M${100 + ex + 4} ${eyeY + 6} q -3 7 0 10 q 3 -3 0 -10 Z" fill="#8ac8f0" stroke="#4a8ac0" stroke-width="1"/>`);
  // (no tear: the jaw sets — a clenched muscle line at the cheek's back corner)
  if (mood === 'sad' && !mk.has('tear')) p.push(`<path d="M${100 + f.w - 9} ${mouthY - 6} q 3 4 1 9" stroke="${mix(skin, 0x6a2a20, 0.4)}" stroke-width="1.6" fill="none" opacity="0.6" stroke-linecap="round"/>`);
  if (mood === 'worried' && mk.has('sweat')) p.push(`<path d="M${100 + f.w - 6} ${f.top + 22} q -6 9 0 13 q 6 -4 0 -13 Z" fill="#9ad4f4" stroke="#4a8ac0" stroke-width="1.2"/>`);
  if (mood === 'angry' && mk.has('vein')) p.push(`<g stroke="#d8342a" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M${100 + f.w - 16} ${f.top + 8} q 4 4 8 0 M${100 + f.w - 12} ${f.top + 4} q 4 4 0 8 M${100 + f.w - 4} ${f.top + 8} q -4 4 -8 0"/></g>`);
  if (mood === 'surprised' && mk.has('burst')) p.push(`<g stroke="#5a3a2a" stroke-width="2.2" stroke-linecap="round"><path d="M${100 - f.w - 6} ${f.top + 4} l -8 -6 M${100 - f.w - 2} ${f.top - 4} l -4 -9 M${100 + f.w + 6} ${f.top + 4} l 8 -6 M${100 + f.w + 2} ${f.top - 4} l 4 -9"/></g>`);
  if ((mood === 'blush' || mood === 'laugh') && mk.has('sparkle')) p.push(`<g fill="#fff6c0" stroke="#e8b84a" stroke-width="0.8"><path d="M${100 + f.w + 8} ${f.top + 10} l 2 5 l 5 2 l -5 2 l -2 5 l -2 -5 l -5 -2 l 5 -2 Z"/><path d="M${100 - f.w - 10} ${f.top + 30} l 1.4 3.6 l 3.6 1.4 l -3.6 1.4 l -1.4 3.6 l -1.4 -3.6 l -3.6 -1.4 l 3.6 -1.4 Z"/></g>`);
  if (mood === 'thinking' && mk.has('think')) p.push(`<g fill="#fffaf0" stroke="#7a5a3a" stroke-width="1.4"><circle cx="${100 + f.w + 10}" cy="${f.top + 4}" r="3"/><circle cx="${100 + f.w + 18}" cy="${f.top - 6}" r="4.5"/><circle cx="${100 + f.w + 28}" cy="${f.top - 20}" r="7"/></g>`);
  p.push(`</g>`);
  p.push(`</g>`);
  // (r8: only the thinking hand under the chin stays — the floating mitten at a cheek / mouth read as a prop)
  if (pz.hand === 'chin') {
    const sleeve = L.coat ?? L.top;
    const cy = f.chin + pz.dy;
    const hx = 100 + pz.dx + d0;
    if (pz.hand === 'chin') p.push(hand(hx + 16, cy + 8, -18, skin, sleeve));
    else if (pz.hand === 'cheek') p.push(hand(hx - f.w + 4, eyeY + pz.dy + 26, 24, skin, sleeve));
    else if (pz.hand === 'mouth') p.push(hand(hx + 30, mouthY + pz.dy + 14, -34, skin, sleeve));
    else if (pz.hand === 'fist') p.push(hand(100 - sw * 0.55, 186 + pz.shoulders * 0.7, 8, skin, sleeve, true));
    else if (pz.hand === 'chest') p.push(hand(100 + 6, 184 + pz.shoulders * 0.7, -6, skin, sleeve));
  }
  p.push(`</g></g></g>`);
  // Painted surface: brush streaks + fine canvas grain.
  p.push(`<rect width="200" height="200" filter="url(#${id}brush)" opacity="0.15" style="mix-blend-mode:soft-light"/>`);
  p.push(`<rect width="200" height="200" filter="url(#${id}grain)" opacity="0.13" style="mix-blend-mode:overlay"/>`);
  PAINT_AUDIT.last = { brows: this_brows, skinL: plate.skinL, backL: plate.backL, faceH: ((f.chin - f.top + 18) * crop.k) / 200, faceW: (2 * f.w * crop.k) / 200 };
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${p.join('')}</svg>`;
}

/** The last painted bust's own measurements (auditPainted). */
export const PAINT_AUDIT: { last: { brows: { side: number; low: number; eyeTop: number }[]; skinL: number; backL: number; faceH: number; faceW: number } | null } = { last: null };

/**
 * Painted-portrait gate (r8): every villager in every mood — each brow clear above its upper lid,
 * a ≥ .25 value gap between skin and backdrop, the face (brow line to chin) ≥ 55 % of the card's
 * height. `stats` lists each villager's numbers.
 */
export function auditPainted(looks: { id: string; look: NpcLook; bg: [number, number] }[], moods: Mood[]): { checked: number; fails: string[]; stats: Record<string, string> } {
  const out = { checked: 0, fails: [] as string[], stats: {} as Record<string, string> };
  for (const v of looks)
    for (const m of moods) {
      PAINT_AUDIT.last = null;
      paintedPortraitSvg(v.look, v.bg, m);
      const a = PAINT_AUDIT.last as { brows: { side: number; low: number; eyeTop: number }[]; skinL: number; backL: number; faceH: number; faceW: number } | null;
      if (!a) continue;
      out.checked++;
      const k = `${v.id}/${m}`;
      for (const b of a.brows) if (b.low > b.eyeTop - 1.5) out.fails.push(`${k}: brow over the ${b.side < 0 ? 'left' : 'right'} eye (${(b.low - b.eyeTop).toFixed(1)})`);
      const dv = Math.abs(a.skinL - a.backL);
      if (dv < 0.25) out.fails.push(`${k}: skin / backdrop value gap ${dv.toFixed(2)}`);
      if (a.faceH < 0.55) out.fails.push(`${k}: face only ${(a.faceH * 100).toFixed(0)} % of the card`);
      if (m === moods[0]) out.stats[v.id] = `skin ${a.skinL.toFixed(2)} back ${a.backL.toFixed(2)} face ${(a.faceH * 100).toFixed(0)}%×${(a.faceW * 100).toFixed(0)}%`;
    }
  return out;
}

// ───────────────────────────────────────────── heart-event insert cards
/**
 * Insert shots for heart events (r7 critic: "events never show what they are about" — the canvas was
 * edge-on, the letters were never seen). A small painted illustration of the thing a line is about
 * (the letter, the canvas, the ledger, the cat on the board…) that the dialogue box pins beside the
 * scene while the line plays. Inline SVG, 240 × 180, warm ink over flat colour with a soft backdrop.
 */
export type InsertKind = 'cat' | 'ledger' | 'loaf' | 'hall' | 'painting' | 'greyhall' | 'hinge' | 'cage' | 'biscuit' | 'letter' | 'chair' | 'candle' | 'match' | 'bench' | 'frog' | 'map' | 'swing' | 'rose' | 'tin' | 'invite' | 'key' | 'bread' | 'recipe' | 'hook' | 'badge' | 'sign' | 'bloom' | 'colourhall';
const IK = '#3a1c10';
const ins = (bg0: string, bg1: string, body: string): string =>
  `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="ibg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="${bg0}"/><stop offset="1" stop-color="${bg1}"/></radialGradient></defs><rect width="240" height="180" fill="url(#ibg)"/><g stroke="${IK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
/** Handwriting: wavy ink lines in a box. */
const scrawl = (x: number, y: number, w: number, rows: number, gap: number, col = '#5a3a2a'): string => {
  let d = '';
  for (let r = 0; r < rows; r++) {
    const yy = y + r * gap;
    const ww = w * (r === rows - 1 ? 0.55 : 0.85 + ((r * 37) % 15) / 100);
    d += `M${x} ${yy}`;
    for (let k = 0; k < ww; k += 9) d += ` q 2.2 ${-3 - ((k + r) % 3)} 4.5 0 t 4.5 0`;
  }
  return `<path d="${d}" stroke="${col}" stroke-width="1.5" fill="none"/>`;
};
const INSERTS = {
  letter: () =>
    ins('#fff3dc', '#e8c99a', `<path d="M40 30 L196 22 L204 150 L46 158 Z" fill="#fbf2dc"/><path d="M40 30 L196 22" stroke="#d8c09a" stroke-width="1.2"/>${scrawl(58, 52, 120, 7, 13)}<path d="M150 136 q 10 -8 22 -2" stroke="#5a3a2a" stroke-width="1.8" fill="none"/><circle cx="182" cy="134" r="12" fill="#c8412f"/><path d="M176 132 q 6 -6 12 0 q -6 6 -12 0" stroke="#7a1e14" stroke-width="1.4" fill="#e05a44"/><path d="M42 98 L200 92" stroke="#e6d4b0" stroke-width="1.2" fill="none"/>`),
  ledger: () =>
    ins('#f6e6c4', '#b8925a', `<path d="M22 44 Q 120 30 120 44 L120 160 Q 120 148 22 158 Z" fill="#f4e6c4"/><path d="M218 44 Q 120 30 120 44 L120 160 Q 120 148 218 158 Z" fill="#efdcb4"/><path d="M120 44 L120 160" stroke="#a8865a"/>${scrawl(34, 64, 74, 6, 14)}${scrawl(132, 64, 74, 5, 14)}<g stroke="#b8402e" stroke-width="1.6" fill="none"><path d="M136 140 q 18 -6 36 0"/><text x="140" y="138" font-family="Georgia,serif" font-style="italic" font-size="13" fill="#b8402e" stroke="none">paid in pie</text></g><circle cx="196" cy="140" r="7" fill="#e8a85a" stroke-width="1.6"/>`),
  cat: () =>
    ins('#e8f2ff', '#9ab8d8', `<path d="M30 70 L120 40 L210 70 Z" fill="#9a3a2e"/><path d="M42 70 L198 70 L198 150 L42 150 Z" fill="#7a5236"/><rect x="58" y="82" width="58" height="50" fill="#f4ead0"/>${scrawl(64, 96, 44, 3, 11)}<rect x="126" y="80" width="56" height="54" fill="#d8e4f0"/><text x="132" y="98" font-family="Fredoka,sans-serif" font-size="11" fill="#3a5a8a" stroke="none">GLIMMER</text><path d="M120 44 q -26 -2 -34 12 q 30 10 66 -2 q -10 -14 -32 -10 Z" fill="#e8903e"/><path d="M92 46 l -6 -12 l 12 6 M130 42 l 8 -11 l 2 13" fill="#e8903e"/><path d="M98 52 q 4 3 8 0 M114 52 q 4 3 8 0" fill="none" stroke-width="2"/><path d="M150 50 q 22 4 18 -12" fill="none" stroke="#e8903e" stroke-width="7"/><path d="M150 50 q 22 4 18 -12" fill="none" stroke-width="1.6"/><text x="136" y="30" font-family="Fredoka,sans-serif" font-size="16" fill="#3a1c10" stroke="none">z z</text>`),
  loaf: () =>
    ins('#f4d8b8', '#8a5a3a', `<ellipse cx="120" cy="140" rx="96" ry="18" fill="#c8b8a0"/><path d="M48 132 Q 40 70 120 64 Q 200 70 192 132 Z" fill="#2a1c16"/><path d="M80 82 q 10 -8 20 2 M112 74 q 10 -8 20 2 M146 82 q 10 -8 20 2" stroke="#5a3a2a" fill="none"/><path d="M66 120 Q 120 112 174 120" stroke="#4a2e22" fill="none"/><g stroke="none" fill="#8a8a8a" opacity="0.7"><circle cx="96" cy="46" r="10"/><circle cx="112" cy="34" r="13"/><circle cx="134" cy="26" r="11"/><circle cx="150" cy="40" r="9"/></g>`),
  hall: () =>
    ins('#3a4a7a', '#141a34', `<path d="M60 160 L60 82 L120 40 L180 82 L180 160 Z" fill="#5a5a72"/><path d="M50 86 L120 34 L190 86" fill="none" stroke-width="4"/><circle cx="120" cy="86" r="16" fill="#2a2c44"/><path d="M104 86 L136 86 M120 70 L120 102" stroke-width="1.6"/><rect x="78" y="108" width="20" height="30" rx="10" fill="#2a2c44"/><rect x="142" y="108" width="20" height="30" rx="10" fill="#2a2c44"/><rect x="108" y="122" width="24" height="38" rx="4" fill="#4a3a2e"/><g fill="#ffd27a" stroke="none"><path d="M196 52 q 6 -2 6 -10 l 0 -14 l 8 -2 l 0 20 q -2 8 -10 8 q -6 0 -4 -2 Z"/><path d="M30 64 q 5 -1 5 -8 l 0 -12 l 7 -2 l 0 16 q -2 7 -8 7 q -6 0 -4 -1 Z"/></g><g fill="#fff6c8" stroke="none"><circle cx="40" cy="24" r="1.5"/><circle cx="200" cy="18" r="1.5"/><circle cx="160" cy="28" r="1.2"/><circle cx="86" cy="20" r="1.2"/></g>`),
  painting: () =>
    ins('#f0f6ff', '#a8c4d8', `<path d="M80 168 L104 30 M160 168 L136 30 M120 168 L120 120" stroke-width="5" stroke="#8a5a32"/><rect x="40" y="26" width="160" height="104" fill="#fbf4e4" stroke-width="3"/><rect x="48" y="34" width="144" height="88" fill="#bfe0f2" stroke="none"/><path d="M48 88 q 36 -10 72 0 t 72 0 L192 122 L48 122 Z" fill="#4a8ab8" stroke="none"/><path d="M52 100 q 14 -6 28 0 M96 108 q 16 -6 32 0 M140 98 q 14 -6 28 0" stroke="#d8f0ff" stroke-width="2" fill="none"/><path d="M62 90 Q 120 46 178 90" fill="none" stroke="#8a6a4a" stroke-width="7"/><path d="M62 90 Q 120 46 178 90" fill="none" stroke-width="1.6"/><path d="M80 78 L80 92 M100 66 L100 88 M120 62 L120 86 M140 66 L140 88 M160 78 L160 92" stroke-width="1.6"/><path d="M48 56 q 20 -14 40 -4 q 14 -10 30 0" stroke="#5a9a4a" stroke-width="6" fill="none"/><path d="M188 132 l 16 -22 l 6 4 l -16 22 Z" fill="#e8b04a" stroke-width="1.6"/><path d="M204 110 l 4 -6 l 6 4 l -4 6" fill="#3a7aa8" stroke-width="1.4"/>`),
  greyhall: () =>
    ins('#f6efe2', '#c8bca8', `<rect x="34" y="20" width="172" height="128" fill="#fbf6ea" stroke-width="3"/><rect x="42" y="28" width="156" height="112" fill="#d0d0d4" stroke="none"/><path d="M82 136 L82 78 L120 52 L158 78 L158 136 Z" fill="#9a9aa4" stroke="#6a6a74" stroke-width="2"/><circle cx="120" cy="80" r="10" fill="#7a7a84" stroke="#5a5a64" stroke-width="1.6"/><rect x="112" y="108" width="16" height="28" rx="3" fill="#7a7a84" stroke="#5a5a64" stroke-width="1.6"/><path d="M42 140 L198 140" stroke="#8a8a92" stroke-width="2"/><path d="M60 40 l 6 6 M180 40 l -6 6" stroke="#a8a8b0" stroke-width="2"/><g stroke="none"><circle cx="196" cy="160" r="9" fill="#8a8a92"/><circle cx="214" cy="164" r="7" fill="#b8b8c0"/><circle cx="178" cy="166" r="6" fill="#6a6a72"/></g>`),
  hinge: () =>
    ins('#ffd8a0', '#8a3a1e', `<rect x="40" y="58" width="72" height="64" rx="6" fill="#4a4a52"/><rect x="128" y="58" width="72" height="64" rx="6" fill="#5a5a62"/><rect x="108" y="48" width="24" height="84" rx="10" fill="#6a6a74"/><g fill="#2a2a30"><circle cx="60" cy="76" r="5"/><circle cx="60" cy="104" r="5"/><circle cx="180" cy="76" r="5"/><circle cx="180" cy="104" r="5"/></g><path d="M112 60 L128 60 M112 120 L128 120" stroke="#9a9aa4"/><g stroke="#ffd25a" stroke-width="2.4"><path d="M150 40 l 14 -16 M164 44 l 22 -8 M140 36 l 2 -20 M172 58 l 22 2"/></g><g fill="#fff0a0" stroke="none"><circle cx="166" cy="22" r="3"/><circle cx="190" cy="34" r="2.5"/><circle cx="142" cy="14" r="2"/></g>`),
  cage: () =>
    ins('#2a3a6a', '#0e1430', `<path d="M120 22 L120 36" stroke="#c8b070" stroke-width="3"/><circle cx="120" cy="18" r="6" fill="none" stroke="#c8b070" stroke-width="3"/><path d="M84 52 Q 120 28 156 52 L156 140 Q 120 156 84 140 Z" fill="#1e2440" stroke="#c8b070" stroke-width="4"/><g stroke="#c8b070" stroke-width="3" fill="none"><path d="M96 46 L96 146 M108 40 L108 150 M120 38 L120 152 M132 40 L132 150 M144 46 L144 146"/><path d="M84 80 Q 120 70 156 80 M84 112 Q 120 102 156 112"/></g><g fill="#e8d090" stroke="none"><circle cx="96" cy="80" r="2.6"/><circle cx="120" cy="76" r="2.6"/><circle cx="144" cy="80" r="2.6"/><circle cx="96" cy="112" r="2.6"/><circle cx="144" cy="112" r="2.6"/></g><path d="M112 128 l 16 0 l -2 -14 l -12 0 Z" fill="#4a4a5a" stroke="#c8b070" stroke-width="2"/>`),
  biscuit: () =>
    ins('#fff4dc', '#d8b07a', `<ellipse cx="120" cy="140" rx="76" ry="16" fill="#e8e4dc"/><ellipse cx="120" cy="134" rx="62" ry="12" fill="#f8f6f2"/><circle cx="120" cy="104" r="40" fill="#d89a52"/><circle cx="120" cy="104" r="30" fill="none" stroke="#a86a32" stroke-width="1.6" stroke-dasharray="4 5"/><g fill="#7a4a24" stroke="none"><circle cx="106" cy="94" r="3"/><circle cx="132" cy="92" r="3"/><circle cx="120" cy="112" r="3"/><circle cx="104" cy="116" r="2.5"/><circle cx="138" cy="114" r="2.5"/></g><path d="M176 70 q 16 -4 20 8 q -4 12 -18 8" fill="#f2c8a8" stroke-width="2"/><path d="M60 52 l 12 8 M176 40 l -8 12" stroke="#c8412f" stroke-width="2"/>`),
  chair: () =>
    ins('#ffe6c4', '#a86a3a', `<path d="M70 30 L80 100 M150 24 L160 96" stroke="#8a5a32" stroke-width="9"/><path d="M76 40 L154 34 M78 60 L156 54" stroke="#9a6a3a" stroke-width="7"/><path d="M60 100 L176 92 L184 110 L68 118 Z" fill="#b07a42"/><path d="M72 118 L62 166 M178 108 L192 160 M100 116 L98 158 M150 112 L156 154" stroke="#8a5a32" stroke-width="7"/><g fill="#e8d8b0" stroke-width="1.4"><rect x="88" y="128" width="14" height="6" rx="2" transform="rotate(-20 95 131)"/><rect x="146" y="124" width="14" height="6" rx="2" transform="rotate(25 153 127)"/></g><text x="168" y="44" font-family="Fredoka,sans-serif" font-size="13" fill="#7a2e1e" stroke="none">no.4</text>`),
  candle: () =>
    ins('#3a3a6a', '#141430', `<rect x="40" y="24" width="160" height="124" rx="6" fill="#1e2244" stroke="#8a6a4a" stroke-width="6"/><path d="M120 24 L120 148 M40 86 L200 86" stroke="#8a6a4a" stroke-width="5"/><circle cx="120" cy="104" r="44" fill="#ffd27a" opacity="0.25" stroke="none"/><rect x="108" y="104" width="24" height="40" rx="3" fill="#f6efe0"/><path d="M120 104 L120 96" stroke-width="2"/><path d="M120 76 q 10 12 0 20 q -10 -8 0 -20 Z" fill="#ffd25a" stroke="#e8902a" stroke-width="1.6"/><path d="M98 146 L142 146" stroke="#6a4a2e" stroke-width="6"/>`),
  match: () =>
    ins('#2e2a44', '#100e1e', `<circle cx="150" cy="56" r="44" fill="#ffb84a" opacity="0.18" stroke="none"/><rect x="40" y="96" width="92" height="56" rx="4" fill="#c8412f"/><rect x="40" y="96" width="92" height="14" fill="#8a2a1e"/><text x="52" y="136" font-family="Fredoka,sans-serif" font-size="13" fill="#ffe6b0" stroke="none">LAST</text><path d="M110 120 L168 58" stroke="#e8c890" stroke-width="7"/><path d="M110 120 L168 58" stroke-width="1.6"/><ellipse cx="170" cy="56" rx="8" ry="10" fill="#7a1e1a" transform="rotate(42 170 56)"/>`),
  bench: () =>
    ins('#fff0d8', '#9ab07a', `<path d="M36 92 L204 84" stroke="#8a5a32" stroke-width="12"/><path d="M38 72 L202 64" stroke="#9a6a3a" stroke-width="10"/><path d="M50 98 L46 150 M190 90 L196 146" stroke="#5a5a62" stroke-width="7"/><rect x="104" y="100" width="44" height="18" rx="3" fill="#e0c06a" stroke-width="2"/>${scrawl(110, 110, 30, 1, 0, '#6a4a1e')}<path d="M64 60 q 6 -16 18 -10 l 0 22 l -18 0 Z" fill="#f4f0e6"/><path d="M82 56 q 8 0 6 8" fill="none" stroke-width="2"/><path d="M70 46 q 2 -6 0 -10 M76 46 q 2 -6 0 -10" stroke="#b0a090" stroke-width="1.6" fill="none"/>`),
  frog: () =>
    ins('#d8f2e0', '#5a9a7a', `<ellipse cx="120" cy="150" rx="96" ry="22" fill="#4a8ab8"/><ellipse cx="120" cy="140" rx="58" ry="12" fill="#5a9a4a"/><path d="M76 132 Q 74 92 120 88 Q 166 92 164 132 Z" fill="#6ab84a"/><circle cx="98" cy="88" r="14" fill="#6ab84a"/><circle cx="142" cy="88" r="14" fill="#6ab84a"/><circle cx="98" cy="86" r="7" fill="#1d1612" stroke="none"/><circle cx="142" cy="86" r="7" fill="#1d1612" stroke="none"/><circle cx="100" cy="83" r="2.4" fill="#fff" stroke="none"/><circle cx="144" cy="83" r="2.4" fill="#fff" stroke="none"/><path d="M104 112 q 16 10 32 0" fill="none"/><path d="M92 52 l 10 -14 l 8 10 l 10 -14 l 10 14 l 8 -10 l 10 14 Z" fill="#ffd25a" stroke-width="2"/>`),
  map: () =>
    ins('#fff0cc', '#c89a5a', `<path d="M24 34 L92 22 L148 36 L216 24 L216 150 L148 162 L92 148 L24 160 Z" fill="#f4e2b0"/><path d="M92 22 L92 148 M148 36 L148 162" stroke="#d8b878" stroke-width="1.6"/><path d="M40 60 q 20 -10 34 6 t 34 4" stroke="#4a8ab8" stroke-width="5" fill="none"/><g fill="#5a9a4a" stroke-width="1.6"><circle cx="170" cy="62" r="10"/><circle cx="186" cy="70" r="8"/><circle cx="160" cy="76" r="7"/></g><rect x="44" y="104" width="30" height="22" fill="#e8b04a" stroke-width="1.8"/><path d="M42 106 L59 92 L76 106" fill="#c8412f" stroke-width="1.8"/><path d="M80 124 q 30 10 50 -10 t 40 6" stroke="#c8412f" stroke-width="2.4" stroke-dasharray="6 6" fill="none"/><path d="M168 110 l 16 16 M184 110 l -16 16" stroke="#c8412f" stroke-width="5"/><circle cx="110" cy="132" r="7" fill="#e8843a"/><text x="96" y="152" font-family="Fredoka,sans-serif" font-size="11" fill="#3a1c10" stroke="none">you</text>`),
  swing: () =>
    ins('#e8f6ff', '#8ab8a0', `<path d="M20 30 Q 120 14 220 34" stroke="#7a5236" stroke-width="16" fill="none"/><path d="M84 30 L92 126 M156 28 L148 124" stroke="#c8a870" stroke-width="3.4"/><path d="M84 30 L92 126 M156 28 L148 124" stroke="#e8d8a8" stroke-width="1.4" stroke-dasharray="3 4"/><rect x="80" y="122" width="80" height="14" rx="4" fill="#b07a42"/><path d="M90 130 L150 128" stroke="#8a5a32" stroke-width="1.4"/><path d="M40 160 q 40 -16 80 -4 t 80 0" stroke="#5a9a4a" stroke-width="8" fill="none"/>`),
  rose: () =>
    ins('#ffeef2', '#c88aa0', `<path d="M48 164 L64 120 L176 120 L192 164 Z" fill="#b8643a"/><path d="M56 124 L184 124" stroke="#8a4a2a" stroke-width="5"/><path d="M120 120 Q 112 80 124 44" stroke="#4a7a3a" stroke-width="5" fill="none"/><path d="M118 92 q -26 -8 -30 -26 q 22 0 30 22 Z M124 74 q 22 -12 34 -4 q -14 14 -34 8 Z" fill="#6aa84a" stroke-width="2"/><path d="M114 44 q 10 -24 20 0 q -4 12 -10 12 q -6 0 -10 -12 Z" fill="#d8406a" stroke-width="2"/><path d="M118 42 q 6 -4 12 0" stroke="#9a2040" stroke-width="1.6" fill="none"/><path d="M120 54 l -6 6 M128 54 l 6 6" stroke="#4a7a3a" stroke-width="3"/><text x="150" y="40" font-family="Fredoka,sans-serif" font-size="18" fill="#9a2040" stroke="none">…?</text>`),
  tin: () =>
    ins('#f2f0e0', '#8aa87a', `<ellipse cx="120" cy="148" rx="64" ry="14" fill="#7a8a92"/><path d="M56 70 L56 146 Q 120 166 184 146 L184 70 Z" fill="#5a8aa8"/><ellipse cx="120" cy="70" rx="64" ry="14" fill="#8ab8d0"/><rect x="80" y="92" width="80" height="34" rx="4" fill="#f4ead0" stroke-width="2"/><text x="88" y="114" font-family="Georgia,serif" font-style="italic" font-size="13" fill="#5a3a2a" stroke="none">R. — roses</text><g fill="#7a5a32" stroke="none"><ellipse cx="200" cy="150" rx="5" ry="3"/><ellipse cx="212" cy="140" rx="4" ry="3"/><ellipse cx="196" cy="134" rx="4" ry="2.5"/></g>`),
};
// r9: the long-form arc's cards — invitations, keys, recipes, the keepsakes the villagers hand over.
const INSERTS_R9 = {
  invite: () =>
    ins('#fff4e0', '#d8b48a', `<path d="M36 40 L204 32 L210 150 L42 158 Z" fill="#fdf6e6"/><path d="M48 50 L194 43 L199 140 L53 147 Z" fill="none" stroke="#c8a060" stroke-width="2.4" stroke-dasharray="2 5"/><path d="M60 58 q 6 -10 14 0 q 8 10 14 0" fill="none" stroke="#c8412f" stroke-width="2"/><text x="120" y="88" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="21" fill="#5a2a1a" stroke="none">You’re invited</text>${scrawl(78, 108, 84, 2, 13)}<circle cx="178" cy="134" r="13" fill="#c8412f"/><path d="M172 134 q 6 -9 12 0 q -6 8 -12 0" fill="#e8786a" stroke="none"/>`),
  key: () =>
    ins('#fff0d0', '#b8905a', `<circle cx="78" cy="92" r="34" fill="none" stroke="#b8862e" stroke-width="13"/><circle cx="78" cy="92" r="34" fill="none" stroke="#e8c060" stroke-width="5"/><path d="M110 92 L206 92" stroke="#b8862e" stroke-width="13"/><path d="M110 92 L206 92" stroke="#e8c060" stroke-width="4"/><path d="M176 92 L176 120 M194 92 L194 114" stroke="#b8862e" stroke-width="11"/><path d="M58 128 q 20 22 52 22" fill="none" stroke="#c8412f" stroke-width="3"/><path d="M104 146 l 14 6 l -12 8" fill="#c8412f" stroke-width="1.6"/>`),
  bread: () =>
    ins('#fff0d8', '#c8905a', `<ellipse cx="120" cy="142" rx="98" ry="16" fill="#b89068"/><path d="M42 134 Q 30 68 118 58 Q 210 66 198 134 Z" fill="#d89a4a"/><path d="M60 120 Q 56 82 120 74 Q 182 80 180 120" fill="#e8b46a" stroke="none"/><path d="M78 92 q 12 -14 26 0 M112 84 q 12 -14 26 0 M146 92 q 12 -14 26 0" stroke="#8a5a2a" stroke-width="3" fill="none"/><g fill="#f4e2b0" stroke="none"><ellipse cx="96" cy="104" rx="4" ry="2"/><ellipse cx="140" cy="100" rx="4" ry="2"/><ellipse cx="160" cy="112" rx="3" ry="2"/></g><path d="M100 30 q 6 -10 0 -18 M120 26 q 6 -10 0 -18 M140 30 q 6 -10 0 -18" stroke="#d8c8b0" stroke-width="2.4" fill="none"/>`),
  recipe: () =>
    ins('#fff6e4', '#d8a86a', `<path d="M40 30 L196 26 L200 156 L44 160 Z" fill="#fbf0d8"/><path d="M40 30 L196 26 L200 156 L44 160 Z" fill="none" stroke="#e0c8a0" stroke-width="1"/><text x="58" y="58" font-family="Georgia,serif" font-style="italic" font-size="20" fill="#6a3a1a" stroke="none">Honey cake</text>${scrawl(58, 80, 124, 5, 13)}<ellipse cx="170" cy="138" rx="22" ry="9" fill="#f4f0e8" opacity="0.8" stroke="none"/><circle cx="160" cy="134" r="3" fill="#e8d8b8" stroke="none"/><circle cx="178" cy="140" r="2" fill="#e8d8b8" stroke="none"/>`),
  hook: () =>
    ins('#2a3048', '#141828', `<path d="M70 40 L70 70 Q 70 92 92 92 L150 92" fill="none" stroke="#3a3a42" stroke-width="12"/><path d="M70 40 L70 70 Q 70 92 92 92 L150 92" fill="none" stroke="#6a6a74" stroke-width="4"/><path d="M150 92 Q 176 92 176 118 Q 176 132 162 132" fill="none" stroke="#3a3a42" stroke-width="10"/><circle cx="70" cy="52" r="6" fill="#b8862e"/><circle cx="102" cy="92" r="6" fill="#c8c8d0"/><circle cx="162" cy="146" r="18" fill="#ffd27a" stroke="#c8862e" stroke-width="3"/><circle cx="162" cy="146" r="34" fill="#ffd27a" opacity="0.18" stroke="none"/>`),
  badge: () =>
    ins('#e8f6ff', '#8ab8d8', `<path d="M120 24 L138 60 L178 64 L148 90 L158 130 L120 110 L82 130 L92 90 L62 64 L102 60 Z" fill="#ffd25a" stroke-width="3"/><circle cx="120" cy="80" r="22" fill="#6ab84a" stroke-width="2.4"/><circle cx="111" cy="74" r="4" fill="#1d1612" stroke="none"/><circle cx="129" cy="74" r="4" fill="#1d1612" stroke="none"/><path d="M110 88 q 10 7 20 0" fill="none" stroke-width="2"/><text x="120" y="160" text-anchor="middle" font-family="Fredoka,sans-serif" font-size="17" fill="#c8412f" stroke="none">FOREVER MEMBER</text>`),
  sign: () =>
    ins('#eef6e4', '#9ab07a', `<path d="M60 168 L66 92 M180 168 L174 92" stroke="#7a5236" stroke-width="10"/><path d="M34 54 Q 120 38 206 54 L204 112 Q 120 98 36 112 Z" fill="#c8945a" stroke-width="3"/><path d="M48 62 Q 120 50 192 62" stroke="#a87444" stroke-width="1.6" fill="none"/><text x="120" y="88" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="17" fill="#4a2a16" stroke="none">ROSALIND &amp; YOU</text><path d="M86 100 q 34 -6 68 0" stroke="#4a2a16" stroke-width="1.4" fill="none"/>`),
  bloom: () =>
    ins('#fff0f2', '#d88aa0', `<path d="M120 170 Q 116 120 122 70" stroke="#3f7a3a" stroke-width="5" fill="none"/><path d="M120 128 q -34 -6 -42 -26 q 26 -4 42 22 Z M122 104 q 28 -16 44 -8 q -16 18 -44 10 Z" fill="#5a9a4a" stroke-width="2"/><g stroke-width="2.4"><circle cx="122" cy="58" r="30" fill="#e8607e"/><path d="M98 50 q 24 -26 48 0 q -6 22 -24 24 q -18 -2 -24 -24 Z" fill="#f088a0"/><path d="M110 54 q 12 -14 24 0 q -4 12 -12 12 q -8 0 -12 -12 Z" fill="#c83a5a"/></g><g fill="#fff6c8" stroke="none" opacity="0.9"><circle cx="176" cy="40" r="3"/><circle cx="64" cy="70" r="2.4"/><circle cx="168" cy="96" r="2"/></g>`),
  colourhall: () =>
    ins('#fff4dc', '#d8b07a', `<rect x="34" y="18" width="172" height="134" fill="#fbf6ea" stroke-width="3"/><rect x="42" y="26" width="156" height="118" fill="#3a3c78" stroke="none"/><circle cx="168" cy="44" r="10" fill="#fff4c8" stroke="none"/><path d="M76 140 L76 80 L120 50 L164 80 L164 140 Z" fill="#c89a6a" stroke="#6a3a2a" stroke-width="2"/><circle cx="120" cy="80" r="12" fill="#ffd25a" stroke-width="2"/><path d="M108 80 L132 80 M120 68 L120 92" stroke="#c8412f" stroke-width="1.6"/><rect x="108" y="104" width="24" height="36" fill="#ffb84a" stroke-width="2"/><path d="M76 140 L164 140" stroke-width="2"/><circle cx="120" cy="96" r="44" fill="#ffd27a" opacity="0.22" stroke="none"/><path d="M96 140 l -2 -10 M146 140 l 2 -10" stroke="#e8607e" stroke-width="4"/>`),
};
const ALL_INSERTS: Record<InsertKind, () => string> = { ...INSERTS, ...INSERTS_R9 };
export function insertArt(kind: string): string | null {
  return kind in ALL_INSERTS ? ALL_INSERTS[kind as InsertKind]() : null;
}
