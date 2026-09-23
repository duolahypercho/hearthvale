/**
 * Crop table (pure data). Six visual growth stages:
 *   0 seeded mound · 1 sprout (seed leaves) · 2 seedling · 3 young plant · 4 mature / flowering · 5 ripe
 * `stageDays[i]` = days spent in stage i (0..4); after the last one the crop is harvestable (RIPE_STAGE).
 * `regrow` = days from harvest back to ripe for multi-harvest crops (the plant drops back to stage 4).
 * `trellis` crops grow on a wooden frame and block movement; `giant` crops can fuse 3×3 blocks of
 * ripe plants into one giant crop overnight. Every crop grows year-round under glass (`greenhouse`).
 */
import type { Season } from '../core/time';

export type CropId =
  | 'parsnip'
  | 'potato'
  | 'cauliflower'
  | 'kale'
  | 'strawberry'
  | 'greenBean'
  | 'tomato'
  | 'corn'
  | 'sunflower'
  | 'blueberry'
  | 'melon'
  | 'hotPepper'
  | 'hops'
  | 'pumpkin'
  | 'eggplant'
  | 'grape'
  | 'beet'
  | 'yam';

export interface CropDef {
  id: CropId;
  name: string;
  seeds: string;
  produce: string;
  seasons: Season[];
  /** Days spent in stages 0..4 (then ripe). */
  stageDays: [number, number, number, number, number];
  regrow?: number;
  /** Grows up a wooden trellis (solid tile). */
  trellis?: boolean;
  /** Can fuse into a 3×3 giant crop. */
  giant?: boolean;
  /** Produce per harvest [min, max]. */
  yield?: [number, number];
  sell: number;
  seedPrice: number;
  /** Produce colour (icons, particles). */
  color: number;
  /** Leaf colour (harvest leaf burst). */
  leaf: number;
  /** Seed packet flavour text. */
  blurb: string;
}

const G = 0x5a9a3c;

export const CROPS: Record<CropId, CropDef> = {
  // ── spring
  parsnip: { id: 'parsnip', name: 'Parsnip', seeds: 'parsnipSeeds', produce: 'parsnip', seasons: ['spring'], stageDays: [1, 1, 1, 1, 0], sell: 35, seedPrice: 20, color: 0xf2dfa8, leaf: G, blurb: 'A sweet, pale root. Quick and forgiving.' },
  potato: { id: 'potato', name: 'Potato', seeds: 'potatoSeeds', produce: 'potato', seasons: ['spring'], stageDays: [1, 1, 1, 2, 1], yield: [1, 3], sell: 80, seedPrice: 50, color: 0xc8955a, leaf: 0x4f8a34, blurb: 'Dig deep — sometimes the plant gives more than one.' },
  cauliflower: { id: 'cauliflower', name: 'Cauliflower', seeds: 'cauliflowerSeeds', produce: 'cauliflower', seasons: ['spring'], stageDays: [1, 2, 3, 3, 3], giant: true, sell: 175, seedPrice: 80, color: 0xf3efe0, leaf: 0x3f7a62, blurb: 'Slow and valuable. Grown side by side, they may fuse into a giant.' },
  kale: { id: 'kale', name: 'Kale', seeds: 'kaleSeeds', produce: 'kale', seasons: ['spring'], stageDays: [1, 1, 2, 2, 0], sell: 110, seedPrice: 70, color: 0x3f7a5a, leaf: 0x3f7a4a, blurb: 'Frilly, hardy greens.' },
  strawberry: { id: 'strawberry', name: 'Strawberry', seeds: 'strawberrySeeds', produce: 'strawberry', seasons: ['spring'], stageDays: [1, 1, 2, 2, 2], regrow: 4, yield: [1, 2], sell: 120, seedPrice: 100, color: 0xe0303c, leaf: 0x3f7a34, blurb: 'Runners keep fruiting every few days.' },
  greenBean: { id: 'greenBean', name: 'Runner Bean', seeds: 'greenBeanSeeds', produce: 'greenBean', seasons: ['spring'], stageDays: [1, 1, 2, 3, 3], regrow: 3, trellis: true, sell: 40, seedPrice: 60, color: 0x7cbf4a, leaf: 0x4f9a3a, blurb: 'Climbs a trellis. Keeps giving until the season ends.' },
  // ── summer
  tomato: { id: 'tomato', name: 'Tomato', seeds: 'tomatoSeeds', produce: 'tomato', seasons: ['summer'], stageDays: [2, 1, 2, 3, 3], regrow: 4, yield: [1, 2], sell: 60, seedPrice: 50, color: 0xe4432e, leaf: 0x3f7a2e, blurb: 'Staked vines heavy with fruit.' },
  corn: { id: 'corn', name: 'Corn', seeds: 'cornSeeds', produce: 'corn', seasons: ['summer', 'fall'], stageDays: [2, 2, 3, 3, 4], regrow: 4, sell: 50, seedPrice: 150, color: 0xf2c43a, leaf: 0x6f9a3a, blurb: 'Grows through summer into fall.' },
  sunflower: { id: 'sunflower', name: 'Sunflower', seeds: 'sunflowerSeeds', produce: 'sunflower', seasons: ['summer', 'fall'], stageDays: [1, 2, 2, 2, 1], sell: 80, seedPrice: 200, color: 0xf7c52a, leaf: 0x4f8a2e, blurb: 'Tall, bright and always facing the morning.' },
  blueberry: { id: 'blueberry', name: 'Blueberry', seeds: 'blueberrySeeds', produce: 'blueberry', seasons: ['summer'], stageDays: [1, 2, 3, 3, 3], regrow: 4, yield: [3, 4], sell: 50, seedPrice: 80, color: 0x4a5fc8, leaf: 0x3f7a4a, blurb: 'A bush that fruits by the handful.' },
  melon: { id: 'melon', name: 'Melon', seeds: 'melonSeeds', produce: 'melon', seasons: ['summer'], stageDays: [1, 2, 3, 3, 3], giant: true, sell: 250, seedPrice: 80, color: 0x8fc45a, leaf: 0x4f8a34, blurb: 'Sprawling vines. A 3×3 patch may swell into a giant.' },
  hotPepper: { id: 'hotPepper', name: 'Hot Pepper', seeds: 'hotPepperSeeds', produce: 'hotPepper', seasons: ['summer'], stageDays: [1, 1, 1, 1, 1], regrow: 3, sell: 40, seedPrice: 40, color: 0xe0321e, leaf: 0x3f8a34, blurb: 'Fast, fiery and prolific.' },
  hops: { id: 'hops', name: 'Hops', seeds: 'hopsSeeds', produce: 'hops', seasons: ['summer'], stageDays: [1, 1, 2, 3, 4], regrow: 1, trellis: true, sell: 25, seedPrice: 60, color: 0xb8d86a, leaf: 0x4f9a3a, blurb: 'Climbing bines hung with papery cones — daily harvests.' },
  // ── fall
  pumpkin: { id: 'pumpkin', name: 'Pumpkin', seeds: 'pumpkinSeeds', produce: 'pumpkin', seasons: ['fall'], stageDays: [1, 2, 3, 4, 3], giant: true, sell: 320, seedPrice: 100, color: 0xe8812e, leaf: 0x4f8a34, blurb: 'The pride of the harvest fair. May grow giant.' },
  eggplant: { id: 'eggplant', name: 'Eggplant', seeds: 'eggplantSeeds', produce: 'eggplant', seasons: ['fall'], stageDays: [1, 1, 1, 1, 1], regrow: 5, sell: 60, seedPrice: 20, color: 0x5a2a6e, leaf: 0x4a7a3a, blurb: 'Glossy purple fruit under velvet leaves.' },
  grape: { id: 'grape', name: 'Grape', seeds: 'grapeSeeds', produce: 'grape', seasons: ['fall'], stageDays: [1, 1, 2, 3, 3], regrow: 3, trellis: true, sell: 80, seedPrice: 60, color: 0x7a3a8e, leaf: 0x5a8a34, blurb: 'Vines on a trellis, heavy with clusters.' },
  beet: { id: 'beet', name: 'Beet', seeds: 'beetSeeds', produce: 'beet', seasons: ['fall'], stageDays: [1, 1, 2, 2, 0], sell: 100, seedPrice: 20, color: 0x9a1e3e, leaf: 0x4a8a3a, blurb: 'Ruby roots under red-veined leaves.' },
  yam: { id: 'yam', name: 'Yam', seeds: 'yamSeeds', produce: 'yam', seasons: ['fall'], stageDays: [1, 3, 3, 3, 0], sell: 160, seedPrice: 60, color: 0xb85a3a, leaf: 0x4f8a34, blurb: 'Heart-leaved vines over earthy tubers.' },
};

export const CROP_IDS = Object.keys(CROPS) as CropId[];
export const STAGES = 6;
export const RIPE_STAGE = 5;

/** Stage (0..RIPE_STAGE) after `days` of growth. Zero-length stages are skipped. */
export function stageForDays(def: CropDef, days: number): number {
  let d = days;
  for (let s = 0; s < RIPE_STAGE; s++) {
    if (d < def.stageDays[s]!) return s;
    d -= def.stageDays[s]!;
  }
  return RIPE_STAGE;
}

export function daysToRipe(def: CropDef): number {
  return def.stageDays.reduce((a, b) => a + b, 0);
}

/** Minimum growth days to reach `stage`. */
export function daysForStage(def: CropDef, stage: number): number {
  let d = 0;
  for (let s = 0; s < Math.min(stage, RIPE_STAGE); s++) d += def.stageDays[s]!;
  return d;
}

/** Crops that can grow in `season` outdoors. */
export function cropsFor(season: Season): CropId[] {
  return CROP_IDS.filter((id) => CROPS[id].seasons.includes(season));
}

// ── Produce quality ──────────────────────────────────────────────
export type CropQuality = 0 | 1 | 2 | 3;
export const QUALITY_NAMES = ['Normal', 'Silver', 'Gold', 'Radiant'] as const;
export const QUALITY_COLORS = [0xffffff, 0xd8e2ee, 0xffcf3a, 0xc88cff] as const;
/** Sell-price multiplier per quality. */
export const QUALITY_MULT = [1, 1.25, 1.5, 2] as const;

// ── Tools ────────────────────────────────────────────────────────
export type ToolTier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ['Basic', 'Copper', 'Iron', 'Gold'] as const;
/** Metal tint per tier (tool heads, can bodies). */
export const TIER_COLORS = [0xb7bcc2, 0xd4804a, 0xdfe6ee, 0xf2c24a] as const;
/** Watering can capacity per tier. */
export const CAN_CAPACITY = [40, 55, 70, 90] as const;

/** Sprinkler tiers: tiles watered around the sprinkler (Chebyshev radius, 0 = 4 neighbours only). */
export const SPRINKLERS: Record<string, { tier: number; reach: number; cross: boolean }> = {
  sprinkler: { tier: 0, reach: 1, cross: true },
  brassSprinkler: { tier: 1, reach: 1, cross: false },
  goldSprinkler: { tier: 2, reach: 2, cross: false },
};

/** Tiles a sprinkler waters (offsets). */
export function sprinklerOffsets(id: string): [number, number][] {
  const s = SPRINKLERS[id] ?? SPRINKLERS.sprinkler!;
  const out: [number, number][] = [];
  for (let dz = -s.reach; dz <= s.reach; dz++) {
    for (let dx = -s.reach; dx <= s.reach; dx++) {
      if (!dx && !dz) continue;
      if (s.cross && dx && dz) continue;
      out.push([dx, dz]);
    }
  }
  return out;
}

/** Scarecrow protection radius (tiles). */
export const SCARECROW_RADIUS = 8.5;
