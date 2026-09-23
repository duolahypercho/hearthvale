/**
 * Farmer appearance (character creator + co-op): skin, hair (colour + style), shirt, overalls,
 * neckerchief and hat. Pure data — the mesh is built by entities/remote-farmer.ts.
 * The DEFAULT look matches the original chibi farmer (entities/player.ts) exactly.
 */

export type HairStyle = 'tousled' | 'bob' | 'bun' | 'spiky' | 'long' | 'buzz';
export type HatStyle = 'straw' | 'cap' | 'beanie' | 'flower' | 'none';

export interface FarmerLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  shirt: number;
  overalls: number;
  /** Neckerchief — also the player's accent colour (name tag, chat, cabin door). */
  scarf: number;
  hat: HatStyle;
  hatColor: number;
}

export const HAIR_STYLES: HairStyle[] = ['tousled', 'bob', 'bun', 'spiky', 'long', 'buzz'];
export const HAT_STYLES: HatStyle[] = ['straw', 'cap', 'beanie', 'flower', 'none'];

export const PALETTE = {
  skin: [0xf7d7bd, 0xecb48e, 0xd99c72, 0xb97d55, 0x8d5a3b, 0x5f3b27],
  hair: [0x8a4a2a, 0x2b1d16, 0x5b3622, 0xc98a3a, 0xead08a, 0xc0512c, 0xdcd4cc, 0x5d7fcf, 0xe07fae, 0x5f9c6c],
  shirt: [0xf0e4c8, 0xf6f4ee, 0xf3c9c3, 0xc9e0f2, 0xf5e19e, 0xd9cdf2, 0xcfe8c4, 0x39424f],
  overalls: [0x5f8a5c, 0x4b6c9e, 0xa05a45, 0x7a6552, 0x6d4c8c, 0x3d4b5c, 0xc79a3c, 0x3f7f7a],
  scarf: [0xe07a5f, 0xe8b64a, 0x4e9ee0, 0x7cc46a, 0xd672b4, 0xf2f2ec, 0x9a6ad6, 0x3fb6a8],
  hatColor: [0xe6c275, 0xd9534f, 0x3d6f8f, 0x6aa84f, 0xf2f2ec, 0x8e6bbf, 0xf0a04b, 0x3a3a44],
} as const;

export const DEFAULT_LOOK: FarmerLook = {
  skin: 0xecb48e,
  hair: 0x8a4a2a,
  hairStyle: 'tousled',
  shirt: 0xf0e4c8,
  overalls: 0x5f8a5c,
  scarf: 0xe07a5f,
  hat: 'straw',
  hatColor: 0xe6c275,
};

/** Three hand-picked farmhand looks (demos, bots, first-time defaults for farmhands). */
export const PRESET_LOOKS: FarmerLook[] = [
  { skin: 0xd99c72, hair: 0x2b1d16, hairStyle: 'bun', shirt: 0xf3c9c3, overalls: 0x4b6c9e, scarf: 0xe8b64a, hat: 'flower', hatColor: 0xd9534f },
  { skin: 0xf7d7bd, hair: 0xead08a, hairStyle: 'spiky', shirt: 0xc9e0f2, overalls: 0xa05a45, scarf: 0x4e9ee0, hat: 'cap', hatColor: 0x3d6f8f },
  { skin: 0x8d5a3b, hair: 0x5b3622, hairStyle: 'long', shirt: 0xcfe8c4, overalls: 0x6d4c8c, scarf: 0x7cc46a, hat: 'beanie', hatColor: 0xf0a04b },
];

export function sameLook(a: FarmerLook, b: FarmerLook): boolean {
  return (Object.keys(DEFAULT_LOOK) as (keyof FarmerLook)[]).every((k) => a[k] === b[k]);
}

export function isDefaultLook(l: FarmerLook): boolean {
  return sameLook(l, DEFAULT_LOOK);
}

/** Validate / fill a look that came off the wire or out of storage. */
export function sanitizeLook(raw: unknown): FarmerLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof FarmerLook, unknown>>;
  const col = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 0xffffff ? Math.floor(v) : d);
  return {
    skin: col(r.skin, DEFAULT_LOOK.skin),
    hair: col(r.hair, DEFAULT_LOOK.hair),
    hairStyle: HAIR_STYLES.includes(r.hairStyle as HairStyle) ? (r.hairStyle as HairStyle) : DEFAULT_LOOK.hairStyle,
    shirt: col(r.shirt, DEFAULT_LOOK.shirt),
    overalls: col(r.overalls, DEFAULT_LOOK.overalls),
    scarf: col(r.scarf, DEFAULT_LOOK.scarf),
    hat: HAT_STYLES.includes(r.hat as HatStyle) ? (r.hat as HatStyle) : DEFAULT_LOOK.hat,
    hatColor: col(r.hatColor, DEFAULT_LOOK.hatColor),
  };
}

export function randomLook(rand: () => number = Math.random): FarmerLook {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length) % a.length]!;
  return {
    skin: pick(PALETTE.skin),
    hair: pick(PALETTE.hair),
    hairStyle: pick(HAIR_STYLES),
    shirt: pick(PALETTE.shirt),
    overalls: pick(PALETTE.overalls),
    scarf: pick(PALETTE.scarf),
    hat: pick(HAT_STYLES),
    hatColor: pick(PALETTE.hatColor),
  };
}

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

// ── Persistence of the local player's profile (name + look) ─────────────────

const KEY = 'hearthvale.profile';

export interface FarmerProfile {
  name: string;
  look: FarmerLook;
}

export function loadProfile(): FarmerProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { name?: unknown; look?: unknown };
    return { name: typeof p.name === 'string' ? p.name.slice(0, 20) : 'Farmer', look: sanitizeLook(p.look) };
  } catch {
    return null;
  }
}

export function saveProfile(p: FarmerProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked */
  }
}
