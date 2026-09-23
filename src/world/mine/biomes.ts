/**
 * Mine biome bands (pure data): every 10 floors the cave changes character.
 *   1–10  Earthen Hollows   warm umber strata, amber + teal crystals, glowcap mushrooms, timber shoring
 *  11–20  Frostvein Grotto  blue-white ice, huge cyan crystals, snow drifts, icicles, glossy floors
 *  21–30  Cinder Depths     basalt + obsidian, glowing lava channels, ember quartz, rising embers
 *  31+    the bands repeat with a difficulty tier (tougher monsters, richer ore).
 */

export type Biome = 'earth' | 'ice' | 'lava';

export type OreId = 'copperOre' | 'ironOre' | 'goldOre' | 'coal' | 'quartz' | 'amethyst' | 'topaz' | 'aquamarine' | 'frostShard' | 'ruby' | 'emberOpal' | 'diamond';

export interface OreStyle {
  /** Nugget / crystal colour (linear-ish sRGB hex). */
  color: number;
  /** 'metal' nuggets or 'gem' crystals poking out of the rock. */
  kind: 'metal' | 'gem' | 'coal';
  /** Emissive glow for gems (0 = none). */
  glow: number;
  /** Extra hits needed to break. */
  hp: number;
}

export const ORE_STYLE: Record<OreId, OreStyle> = {
  copperOre: { color: 0xe07a3a, kind: 'metal', glow: 0, hp: 1 },
  ironOre: { color: 0xc9ccd4, kind: 'metal', glow: 0, hp: 2 },
  goldOre: { color: 0xffc83a, kind: 'metal', glow: 0.25, hp: 3 },
  coal: { color: 0x3c3642, kind: 'coal', glow: 0, hp: 1 },
  quartz: { color: 0xcfcce6, kind: 'gem', glow: 0.1, hp: 1 },
  amethyst: { color: 0xb070ff, kind: 'gem', glow: 1.1, hp: 2 },
  topaz: { color: 0xffb030, kind: 'gem', glow: 1.0, hp: 2 },
  aquamarine: { color: 0x40e0e8, kind: 'gem', glow: 1.2, hp: 2 },
  frostShard: { color: 0x9fd8ff, kind: 'gem', glow: 1.3, hp: 2 },
  ruby: { color: 0xff2a48, kind: 'gem', glow: 1.3, hp: 3 },
  emberOpal: { color: 0xff7a1a, kind: 'gem', glow: 1.6, hp: 3 },
  diamond: { color: 0xeaffff, kind: 'gem', glow: 1.8, hp: 4 },
};

export type MonsterKind = 'slime' | 'bat' | 'crab';

export interface BiomeDef {
  id: Biome;
  name: string;
  /** Rock strata bands (bottom → top), hex. */
  strata: number[];
  /** Floor base + variation + damp/dark tone. */
  floor: [number, number, number];
  /** Breakable rock base tints. */
  rock: number[];
  /** Crystal colours (decor clusters, light pools). */
  crystals: number[];
  /** Decor crystal count per floor. */
  crystalCount: number;
  /** Hemisphere sky / ground colour + intensity (the only fill light besides practicals). */
  hemi: [number, number, number];
  /** Fog colour (also the void beyond the walls). */
  fog: number;
  /** Player lantern colour + intensity. */
  lantern: [number, number];
  exposure: number;
  /** Grade: lift, gain, saturation, contrast, vignette. */
  lift: [number, number, number];
  gain: [number, number, number];
  sat: number;
  contrast: number;
  vignette: number;
  bloom: [number, number];
  /** Floor roughness (ice is glossy). */
  floorRough: number;
  /** Ore table: [ore, weight] (null = plain rock). Scaled by floor inside the band. */
  ores: [OreId | null, number][];
  monsters: [MonsterKind, number][];
  /** Ambient particles: dust | snow | embers. */
  motes: 'dust' | 'snow' | 'embers';
  moteColor: number;
}

export const BIOMES: Record<Biome, BiomeDef> = {
  earth: {
    id: 'earth',
    name: 'Earthen Hollows',
    strata: [0x5a3d2b, 0x7a5236, 0x94673f, 0x6e4a33, 0xa8794a, 0x80573a],
    floor: [0x8a6a4c, 0x6f5238, 0x4a3526],
    rock: [0x8d7a66, 0x7d6c5c, 0x9a8670],
    crystals: [0x3fe0c8, 0xffb347, 0x6fd8ff, 0x3fe0c8],
    crystalCount: 10,
    hemi: [0x8a7a90, 0x3a2618, 0.86],
    fog: 0x0e0a08,
    lantern: [0xffb46a, 26],
    exposure: 1.18,
    lift: [0.02, 0.012, 0.025],
    gain: [1.08, 1.0, 0.92],
    sat: 1.12,
    contrast: 1.08,
    vignette: 0.7,
    bloom: [0.55, 0.82],
    floorRough: 0.92,
    ores: [
      [null, 60],
      ['copperOre', 22],
      ['coal', 6],
      ['ironOre', 4],
      ['quartz', 4],
      ['amethyst', 2.2],
      ['topaz', 1.5],
    ],
    monsters: [
      ['slime', 5],
      ['bat', 2],
      ['crab', 2],
    ],
    motes: 'dust',
    moteColor: 0xffd9a0,
  },
  ice: {
    id: 'ice',
    name: 'Frostvein Grotto',
    strata: [0x3e5a7c, 0x5f84ac, 0x86acd0, 0x6a8fb8, 0xb4d2ea, 0x7fa4c8],
    floor: [0xbcd4e6, 0x8fb0cc, 0x5a7896],
    rock: [0x9fb4c8, 0x8aa2ba, 0xb8cadc],
    crystals: [0x5fe8ff, 0x8fb8ff, 0xc8f4ff],
    crystalCount: 18,
    hemi: [0x7fa8e0, 0x1c2c48, 0.85],
    fog: 0x070d18,
    lantern: [0xffb466, 30],
    exposure: 1.1,
    lift: [0.01, 0.02, 0.05],
    gain: [0.96, 1.0, 1.08],
    sat: 1.1,
    contrast: 1.08,
    vignette: 0.72,
    bloom: [0.55, 0.84],
    floorRough: 0.34,
    ores: [
      [null, 56],
      ['copperOre', 6],
      ['ironOre', 20],
      ['coal', 4],
      ['frostShard', 6],
      ['aquamarine', 3],
      ['quartz', 4],
      ['goldOre', 2],
    ],
    monsters: [
      ['slime', 4],
      ['bat', 3],
      ['crab', 2],
    ],
    motes: 'snow',
    moteColor: 0xdff4ff,
  },
  lava: {
    id: 'lava',
    name: 'Cinder Depths',
    strata: [0x1e1618, 0x2e2224, 0x3a2a28, 0x241a1c, 0x4a3430, 0x2a1e20],
    floor: [0x5e4840, 0x44322c, 0x261c1a],
    rock: [0x4e4240, 0x3e3434, 0x5a4a44],
    crystals: [0xff6a1a, 0xff3a2a, 0xffb040],
    crystalCount: 9,
    hemi: [0x8a4a3a, 0x2a0c06, 0.9],
    fog: 0x120505,
    lantern: [0xffc890, 30],
    exposure: 1.1,
    lift: [0.03, 0.01, 0.01],
    gain: [1.08, 0.97, 0.9],
    sat: 1.1,
    contrast: 1.12,
    vignette: 0.74,
    bloom: [0.55, 0.86],
    floorRough: 0.8,
    ores: [
      [null, 52],
      ['ironOre', 10],
      ['goldOre', 18],
      ['coal', 6],
      ['ruby', 4],
      ['emberOpal', 4],
      ['diamond', 1],
    ],
    monsters: [
      ['slime', 4],
      ['bat', 3],
      ['crab', 2],
    ],
    motes: 'embers',
    moteColor: 0xff8a3a,
  },
};

export function biomeForFloor(floor: number): Biome {
  const band = Math.floor((Math.max(1, floor) - 1) / 10) % 3;
  return band === 0 ? 'earth' : band === 1 ? 'ice' : 'lava';
}

/** Difficulty tier: 0 for floors 1–30, 1 for 31–60, … */
export function tierForFloor(floor: number): number {
  return Math.floor((Math.max(1, floor) - 1) / 30);
}

export const ELEVATOR_EVERY = 5;
export const MAX_FLOOR = 60;
