/**
 * Hearthvale town square (pure data). 64 × 48 tiles, +X east, +Z south (towards the camera).
 * The west road leads back to the farm; the Lantern Hall closes the north side of the plaza.
 */
export const TOWN_SIZE = { w: 64, d: 48 };
export const TOWN_EXTENT = { minX: -20, minZ: -20, maxX: 84, maxZ: 68 };
export const PLAZA = { x: 32, z: 25, r: 6.4 };

/** Cobbled streets (Catmull-Rom polylines). */
export const STREETS: [number, number][][] = [
  // west road (from the farm) → plaza
  [[-14, 26.5], [-4, 26.2], [4, 25.8], [12, 26.4], [20, 25.6], [26, 25.2]],
  // plaza → east road
  [[38, 25], [46, 25.4], [54, 24.8], [62, 25.6], [74, 25.2], [86, 25.5]],
  // plaza → Lantern Hall steps
  [[32, 19], [32, 16], [32, 13]],
  // plaza → south lane → cottages
  [[32, 31], [31.5, 35], [27, 37.2], [19, 37.2], [16, 36.6]],
  [[31.5, 35], [36, 37.3], [45, 37.2], [48, 36.6]],
  // shop fronts
  [[26, 21.5], [21, 20.2], [18.4, 19.6]],
  [[38, 21.5], [42, 20.4], [43.3, 19.6]],
];

export interface TownBuilding {
  id: string;
  kind: 'hall' | 'store' | 'bakery' | 'cottageA' | 'cottageB';
  x: number;
  z: number;
  rot?: number;
  /** Blocked footprint (tile rect, inclusive). */
  block: [number, number, number, number];
}

export const BUILDINGS: TownBuilding[] = [
  { id: 'lantern_hall', kind: 'hall', x: 32, z: 8.6, block: [26, 4, 37, 12] },
  { id: 'general_store', kind: 'store', x: 21, z: 15.8, block: [17, 13, 24, 18] },
  { id: 'bakery', kind: 'bakery', x: 43, z: 15.8, block: [39, 13, 46, 18] },
  { id: 'cottage_west', kind: 'cottageA', x: 16, z: 32.4, block: [13, 30, 18, 34] },
  { id: 'cottage_east', kind: 'cottageB', x: 48, z: 32.4, block: [45, 30, 50, 34] },
];

export type TownPropKind = 'fountain' | 'noticeBoard' | 'marketStall' | 'bench' | 'lanternPost' | 'planter' | 'hedge' | 'barrel' | 'crateStack' | 'flowerPot' | 'wheelbarrow' | 'flowerCart' | 'cafeSet' | 'sandwichBoard';

export interface TownProp {
  kind: TownPropKind;
  x: number;
  z: number;
  rot?: number;
  solid?: [number, number][];
  /** Hedge length / planter colours. */
  len?: number;
  colors?: number[];
}

const ring = (n: number, r: number, a0 = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return [PLAZA.x + Math.cos(a) * r, PLAZA.z + Math.sin(a) * r] as [number, number];
  });

export const TOWN_PROPS: TownProp[] = [
  { kind: 'fountain', x: PLAZA.x, z: PLAZA.z, solid: [[30, 23], [31, 23], [32, 23], [33, 23], [30, 24], [31, 24], [32, 24], [33, 24], [30, 25], [31, 25], [32, 25], [33, 25], [30, 26], [31, 26], [32, 26], [33, 26]] },
  { kind: 'noticeBoard', x: 27.2, z: 19.6, rot: 0.25, solid: [[27, 19]] },
  { kind: 'marketStall', x: 41.8, z: 31.0, rot: -0.55, solid: [[41, 30], [42, 30], [40, 31], [41, 31], [42, 31]] },
  ...ring(6, 7.6, Math.PI / 6).map(([x, z], i): TownProp => ({ kind: 'lanternPost', x, z, rot: Math.atan2(PLAZA.z - z, x - PLAZA.x) + Math.PI, solid: [[Math.floor(x), Math.floor(z)]] })).filter((_, i) => i !== 1 && i !== 4),
  { kind: 'bench', x: 27.4, z: 28.9, rot: Math.PI * 0.8, solid: [[27, 28]] },
  { kind: 'bench', x: 36.6, z: 28.9, rot: -Math.PI * 0.8, solid: [[36, 28]] },
  { kind: 'bench', x: 25.6, z: 23.8, rot: Math.PI / 2 + 0.15, solid: [[25, 23]] },
  { kind: 'planter', x: 24.3, z: 19.6, colors: [0xff7aa2, 0xffd166, 0xffffff], solid: [[24, 19]] },
  { kind: 'planter', x: 39.8, z: 19.6, colors: [0xc77dff, 0xffd166, 0xff9f1c], solid: [[39, 19]] },
  { kind: 'planter', x: 28.6, z: 14.2, colors: [0xff8fab, 0xffffff], solid: [[28, 14]] },
  { kind: 'planter', x: 35.4, z: 14.2, colors: [0xff8fab, 0xffffff], solid: [[35, 14]] },
  { kind: 'hedge', x: 16, z: 35.6, len: 4.4 },
  { kind: 'hedge', x: 48, z: 35.6, len: 4.4 },
  { kind: 'barrel', x: 46.9, z: 18.6, solid: [[46, 18]] },
  { kind: 'barrel', x: 16.6, z: 18.8, solid: [[16, 18]] },
  { kind: 'crateStack', x: 25.1, z: 17.4, rot: 0.2, solid: [[25, 17]] },
  { kind: 'flowerPot', x: 44.9, z: 18.9, colors: [0xff8fab] },
  { kind: 'flowerPot', x: 19.1, z: 18.9, colors: [0xffd166] },
  { kind: 'wheelbarrow', x: 44.2, z: 36.4, rot: 2.2, solid: [[44, 36]] },
  // Potted flowers around the fountain rim.
  ...[0.25, 1.82, 3.4, 4.97].map((a, i): TownProp => ({ kind: 'flowerPot', x: PLAZA.x + Math.cos(a) * 3.05, z: PLAZA.z + Math.sin(a) * 3.05, colors: [[0xff8fab, 0xffd166, 0xc77dff, 0xffffff][i]!] })),
  { kind: 'crateStack', x: 37.8, z: 31.8, rot: -0.4, solid: [[37, 31]] },
  { kind: 'barrel', x: 38.9, z: 32.6, solid: [[38, 32]] },
  { kind: 'planter', x: 24.6, z: 29.9, colors: [0xffd166, 0xff8fab, 0xffffff], rot: 0.6, solid: [[24, 29]] },
  // Everyday plaza life: the flower seller's cart, the bakery café table, chalk A-boards.
  { kind: 'flowerCart', x: 17.9, z: 22.1, rot: 0.35, solid: [[17, 21], [18, 21], [17, 22], [18, 22]] },
  { kind: 'cafeSet', x: 46.4, z: 21.7, rot: -0.2, solid: [[46, 21]] },
  { kind: 'sandwichBoard', x: 20.1, z: 20.3, rot: 0.3, colors: [0x5f8a7a] },
  { kind: 'sandwichBoard', x: 44.0, z: 20.4, rot: -0.35, colors: [0x9a5a3a] },
  { kind: 'flowerPot', x: 37.0, z: 20.3, colors: [0xc77dff] },
  { kind: 'flowerPot', x: 27.1, z: 29.9, colors: [0xffd166] },
  { kind: 'barrel', x: 36.9, z: 30.7, solid: [[36, 30]] },
];

export const TOWN_TREES: ['oak' | 'maple' | 'pine' | 'blossom', number, number, number][] = [
  ['blossom', 13.2, 22.5, 0.95],
  ['blossom', 21.6, 31.4, 0.8],
  ['blossom', 50.6, 22.2, 0.9],
  ['oak', 10.5, 14.5, 1.15],
  ['maple', 53.5, 13.8, 1.1],
  ['oak', 23.5, 7.0, 1.05],
  ['maple', 41.5, 6.5, 1.0],
  ['blossom', 23.5, 41.5, 0.9],
  ['oak', 40.5, 42.0, 1.05],
  ['pine', 7.5, 36.5, 1.0],
  ['pine', 56.5, 38.5, 1.05],
  ['oak', 58.5, 30.5, 1.1],
  ['maple', 5.5, 20.5, 1.0],
];

/** Plaza lamp-post tops (ring of 4 around the fountain), used as bunting anchors. */
const POST_TOPS: [number, number, number][] = [30, 150, 210, 330].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return [PLAZA.x + Math.cos(a) * 7.6, 2.4, PLAZA.z + Math.sin(a) * 7.6] as [number, number, number];
});
const [POST_SE, POST_SW, POST_NW, POST_NE] = POST_TOPS as [[number, number, number], [number, number, number], [number, number, number], [number, number, number]];
/** Maypole crown (fountain centre). */
export const MAYPOLE_TOP: [number, number, number] = [PLAZA.x, 5.9, PLAZA.z];

/**
 * Festival layout (shown for festivals). Bunting spans are [from, to, sag m, flags, lantern every N]
 * — anchored only to lamp posts, eaves and the maypole crown, never hung down the view axis.
 */
export const FESTIVAL = {
  bunting: [
    // Under the Lantern Hall eave, across the facade.
    [[26.9, 4.4, 12.4], [37.1, 4.4, 12.4], 0.5, 16, 4],
    // Across the north side of the plaza, post to post.
    [POST_NW, POST_NE, 0.55, 16, 5],
    // Along the shop eaves.
    [[17.9, 3.75, 18.8], [24.2, 3.75, 18.8], 0.4, 12, 0],
    [[39.8, 3.65, 18.8], [46.1, 3.65, 18.8], 0.4, 12, 0],
    // Maypole crown back out to the two north lamp posts (never towards the camera).
    [MAYPOLE_TOP, POST_NW, 0.45, 13, 4],
    [MAYPOLE_TOP, POST_NE, 0.45, 13, 4],
  ] as [[number, number, number], [number, number, number], number, number, number][],
  /** Paper-lantern poles flanking every street mouth. */
  poles: [
    [24.2, 22.9], [24.2, 27.4], [39.8, 22.9], [39.8, 27.4],
    [29.6, 17.3], [34.4, 17.3], [29.9, 32.3], [34.1, 32.3],
  ] as [number, number][],
  /** Market stalls: [x, z, rotY, stripe A, stripe B]. */
  stalls: [
    [21.4, 22.3, 0.55, 0xd8473a, 0xf6ecd8],
    [42.6, 22.3, -0.55, 0x3f7fb0, 0xf6ecd8],
  ] as [number, number, number, number, number][],
  /** Harvest table [x, z, rotY, length]. */
  table: [32, 19.3, 0, 5.4] as [number, number, number, number],
  /** Fire braziers. */
  braziers: [[28.2, 16.4], [35.8, 16.4]] as [number, number][],
};

/** Warps back to the farm (tile rect → farm spawn). */
export const TOWN_WARPS = [
  { x0: 0, z0: 23, x1: 0, z1: 29, to: 'farm', x: 61.5, z: 28.5, facing: 'left' as const },
  // East road → Driftsand Beach (world/beach).
  { x0: 99, z0: 23, x1: 99, z1: 29, to: 'beach', x: 2.6, z: 19.8, facing: 'right' as const },
];
export const TOWN_SPAWN = { x: 3.5, z: 26.2 };
