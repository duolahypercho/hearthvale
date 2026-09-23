/**
 * Hearthvale town — extended layout (pure data, owned by the town pod). The original square
 * (data/town-layout.ts: plaza, Lantern Hall, store, bakery, two cottages) keeps its coordinates;
 * this adds the river + bridges, the east bank (Flint & Ember forge, The Copper Kettle inn, the
 * Birch house + lumber yard), the Willowmere Clinic, the lamplighter's cottage, the market row
 * and the named SPOTS villagers walk between.
 *
 * +X east, +Z south (towards the camera). 1 tile = 1 m.
 */
import type { Facing } from '../../core/events';

export const TOWN_W = 100;
export const TOWN_D = 64;
export const TOWN_EXTENT2 = { minX: -20, minZ: -20, maxX: 120, maxZ: 84 };
/** Rounded-rect rim of the valley floor: centre, half extents, corner radius. */
export const RIM = { cx: 49, cz: 31, hx: 47, hz: 28.5, r: 9 };

/** River surface height and bed depth. */
export const WATER_Y = -0.42;
export const RIVER_BED = -1.35;
/** River centreline (Catmull-Rom) and half widths: water / bank top. */
export const RIVER: [number, number][] = [
  [65.5, -14], [66.4, 2], [64.2, 13], [64.2, 25], [66.6, 35], [65.2, 46], [61.8, 56], [60.2, 70], [60, 86],
];
export const RIVER_HALF = 2.15;
export const RIVER_BANK = 3.6;

export interface Bridge {
  id: string;
  kind: 'stone' | 'wood';
  /** Centre, span along X, deck width along Z. */
  x: number;
  z: number;
  len: number;
  width: number;
  /** Deck arch rise (m) at the centre above the end height. */
  rise: number;
  /** Deck height at the ends. */
  endY: number;
}

export const BRIDGES: Bridge[] = [
  { id: 'kettle_bridge', kind: 'stone', x: 64.2, z: 25.3, len: 9.6, width: 3.3, rise: 0.62, endY: 0.06 },
  { id: 'reed_footbridge', kind: 'wood', x: 65.2, z: 46.2, len: 8.4, width: 1.9, rise: 0.34, endY: 0.06 },
];

/** Extra cobbled lanes (Catmull-Rom), [x, z] with a half width. */
export const EXTRA_STREETS: { pts: [number, number][]; w: number }[] = [
  // plaza → clinic
  { pts: [[31.5, 35], [31.8, 38.5], [32, 41.4]], w: 1.05 },
  // west road → lamplighter's cottage
  { pts: [[11.2, 26], [11, 22], [10.6, 18.4]], w: 0.8 },
  // east bank lane (bridge → inn → Birch house → footbridge)
  { pts: [[70.5, 25.4], [71.4, 31], [72.6, 38], [74.4, 44.2], [79, 46.2], [86, 45.9], [92, 45.2]], w: 0.95 },
  // forge apron
  { pts: [[77.6, 25.2], [77.4, 21.4], [76.2, 19.2]], w: 0.95 },
  { pts: [[84.4, 25.2], [84.6, 22.2], [84.6, 20.2]], w: 1.0 },
  // inn apron
  { pts: [[80, 25.4], [80, 28.6], [80, 31.2]], w: 1.2 },
  // south lane → footbridge
  { pts: [[45, 37.2], [52, 39.4], [57.4, 43.8], [60.6, 46.2]], w: 0.9 },
  { pts: [[69.8, 46.2], [72.4, 45.6], [74.4, 44.2]], w: 0.9 },
  // riverside dock path
  { pts: [[57.2, 27.2], [58.2, 31.6], [59.4, 36.4]], w: 0.7 },
];

export type NewBuildingKind = 'forge' | 'inn' | 'clinic' | 'keeper' | 'birch' | 'houseNE';

export interface NewBuilding {
  id: string;
  kind: NewBuildingKind;
  x: number;
  z: number;
  rot: number;
  /** Blocked footprint (tile rect, inclusive). */
  block: [number, number, number, number];
}

export const NEW_BUILDINGS: NewBuilding[] = [
  { id: 'forge', kind: 'forge', x: 77.4, z: 15.4, rot: 0, block: [74, 12, 80, 17] },
  { id: 'inn', kind: 'inn', x: 80, z: 35.6, rot: Math.PI, block: [75, 33, 84, 38] },
  { id: 'clinic', kind: 'clinic', x: 32, z: 45.2, rot: Math.PI, block: [28, 43, 35, 47] },
  { id: 'keeper_cottage', kind: 'keeper', x: 10.6, z: 15.2, rot: 0, block: [8, 13, 12, 16] },
  { id: 'birch_house', kind: 'birch', x: 80.2, z: 50.4, rot: Math.PI, block: [77, 49, 83, 52] },
  { id: 'house_ne', kind: 'houseNE', x: 90.4, z: 15.6, rot: 0, block: [88, 13, 92, 17] },
];

export type ExtraPropKind =
  | 'stall'
  | 'lamp'
  | 'lampLit'
  | 'bench'
  | 'well'
  | 'easel'
  | 'barrel'
  | 'crates'
  | 'sacks'
  | 'flowerPot'
  | 'signpost'
  | 'laundry'
  | 'dock'
  | 'rowboat'
  | 'sawhorse'
  | 'lumber'
  | 'logpile'
  | 'cafeSet'
  | 'planter'
  | 'mailbox'
  | 'produce'
  | 'swing'
  | 'hedge'
  | 'kettleSign';

export interface ExtraProp {
  kind: ExtraPropKind;
  x: number;
  z: number;
  rot?: number;
  solid?: [number, number][];
  /** Stall goods / pot colour / hedge length. */
  goods?: 'produce' | 'fish' | 'flowers' | 'pottery';
  colors?: number[];
  len?: number;
}

export const EXTRA_PROPS: ExtraProp[] = [
  // Market row on the east road.
  { kind: 'stall', x: 50.4, z: 21.3, rot: 0, goods: 'produce', colors: [0xd8573e, 0xf6ecd8], solid: [[49, 21], [50, 21], [51, 21]] },
  { kind: 'stall', x: 55.8, z: 21.5, rot: 0.08, goods: 'flowers', colors: [0x8a5ab0, 0xf6ecd8], solid: [[54, 21], [55, 21], [56, 21]] },
  { kind: 'stall', x: 53.0, z: 29.3, rot: Math.PI, goods: 'fish', colors: [0x3f7fb0, 0xf6ecd8], solid: [[52, 29], [53, 29], [54, 29]] },
  { kind: 'crates', x: 48.2, z: 21.0, rot: 0.3, solid: [[48, 21]] },
  { kind: 'sacks', x: 52.6, z: 20.7, rot: -0.2 },
  { kind: 'produce', x: 57.9, z: 21.2, rot: 0.2 },
  { kind: 'barrel', x: 55.4, z: 29.6, solid: [[55, 29]] },
  { kind: 'crates', x: 50.9, z: 29.9, rot: -0.4, solid: [[50, 29]] },
  // Road lamps (the east road + bridge + lanes).
  { kind: 'lampLit', x: 46.4, z: 23.2, rot: Math.PI, solid: [[46, 23]] },
  { kind: 'lamp', x: 58.8, z: 23.3, rot: Math.PI, solid: [[58, 23]] },
  { kind: 'lamp', x: 69.8, z: 27.3, rot: 0, solid: [[69, 27]] },
  { kind: 'lampLit', x: 76.0, z: 27.1, rot: 0, solid: [[76, 27]] },
  { kind: 'lamp', x: 88.6, z: 23.4, rot: Math.PI, solid: [[88, 23]] },
  { kind: 'lamp', x: 12.8, z: 23.8, rot: Math.PI, solid: [[12, 23]] },
  { kind: 'lamp', x: 30.0, z: 38.6, rot: 0, solid: [[29, 38]] },
  { kind: 'lamp', x: 73.8, z: 41.0, rot: 0, solid: [[73, 41]] },
  // Riverside: bench, dock, rowboat, easel.
  { kind: 'bench', x: 57.6, z: 33.6, rot: -Math.PI / 2 - 0.2, solid: [[57, 33]] },
  { kind: 'dock', x: 62.6, z: 36.6, rot: Math.PI },
  { kind: 'rowboat', x: 62.9, z: 39.6, rot: 0.5 },
  { kind: 'easel', x: 60.1, z: 22.3, rot: -Math.PI / 2 + 0.2, solid: [[60, 22]] },
  { kind: 'easel', x: 25.3, z: 21.6, rot: Math.PI * 0.95, solid: [[25, 21]] },
  // Forge yard.
  { kind: 'barrel', x: 81.6, z: 18.8, solid: [[81, 18]] },
  { kind: 'logpile', x: 73.0, z: 17.2, rot: Math.PI / 2, solid: [[72, 16], [72, 17], [73, 17]] },
  // Inn terrace.
  { kind: 'cafeSet', x: 75.4, z: 29.4, rot: 0, solid: [[75, 29]] },
  { kind: 'cafeSet', x: 84.6, z: 29.4, rot: 0, solid: [[84, 29]] },
  { kind: 'barrel', x: 77.2, z: 31.6, solid: [[77, 31]] },
  { kind: 'barrel', x: 82.9, z: 31.7, solid: [[82, 31]] },
  { kind: 'kettleSign', x: 86.6, z: 27.0, rot: 0.3, solid: [[86, 26]] },
  { kind: 'planter', x: 74.2, z: 32.0, colors: [0xff8fab, 0xffd166, 0xffffff], solid: [[74, 31]] },
  // Birch house + lumber yard.
  { kind: 'sawhorse', x: 86.4, z: 47.9, rot: 0.1, solid: [[86, 47]] },
  { kind: 'lumber', x: 89.2, z: 49.2, rot: 0.2, solid: [[88, 48], [89, 48], [90, 48], [88, 49], [89, 49], [90, 49]] },
  { kind: 'logpile', x: 84.6, z: 50.8, rot: 0, solid: [[84, 50], [85, 50]] },
  { kind: 'swing', x: 73.2, z: 49.2, rot: 0.2 },
  { kind: 'laundry', x: 76.6, z: 53.8, rot: 0.1 },
  // Clinic.
  { kind: 'bench', x: 36.4, z: 41.6, rot: Math.PI, solid: [[36, 41]] },
  { kind: 'planter', x: 28.4, z: 41.8, colors: [0xffffff, 0xc77dff], solid: [[28, 41]] },
  { kind: 'flowerPot', x: 30.4, z: 41.9, colors: [0xff8fab] },
  { kind: 'flowerPot', x: 33.6, z: 41.9, colors: [0xffd166] },
  // Lamplighter's cottage + west entrance.
  { kind: 'signpost', x: 6.2, z: 23.6, rot: 0.3, solid: [[6, 23]] },
  { kind: 'mailbox', x: 12.6, z: 18.6, rot: 0 },
  { kind: 'well', x: 22.6, z: 38.9, solid: [[22, 38], [23, 38], [22, 39], [23, 39]] },
  { kind: 'laundry', x: 10.2, z: 33.8, rot: 0.25 },
  { kind: 'crates', x: 13.6, z: 17.6, rot: -0.3, solid: [[13, 17]] },
  // East bank north house.
  { kind: 'flowerPot', x: 92.4, z: 18.9, colors: [0xff8fab] },
  { kind: 'mailbox', x: 88.2, z: 19.6, rot: 0 },
  // Bridge-end signpost.
  { kind: 'signpost', x: 70.4, z: 22.9, rot: -0.4, solid: [[70, 22]] },
  { kind: 'hedge', x: 36.2, z: 43.6, rot: Math.PI / 2, len: 3.2 },
  { kind: 'hedge', x: 27.8, z: 43.6, rot: Math.PI / 2, len: 3.2 },
];

/** Extra trees: [species, x, z, scale]. */
export const EXTRA_TREES: ['oak' | 'maple' | 'pine' | 'blossom', number, number, number][] = [
  ['oak', 72.6, 49.8, 1.1],
  ['blossom', 70.6, 33.2, 0.85],
  ['maple', 86.8, 11.4, 1.0],
  ['pine', 93.8, 30.2, 1.05],
  ['oak', 58.4, 14.6, 1.05],
  ['blossom', 56.2, 40.2, 0.9],
  ['maple', 40.6, 45.2, 1.0],
  ['oak', 22.6, 46.0, 1.1],
  ['blossom', 5.8, 13.4, 0.85],
  ['pine', 94.6, 44.4, 1.0],
  ['maple', 69.8, 12.6, 0.95],
  ['oak', 90.8, 54.6, 1.0],
];

/**
 * Named places villagers walk to. [x, z, facing or yaw radians]. 'door:<buildingId>' spots are
 * added at runtime from the building door anchors.
 */
export const SPOTS: Record<string, [number, number, Facing | number]> = {
  store_front: [20.2, 20.9, 'down'],
  store_counter: [23.0, 20.5, 'down'],
  bakery_front: [42.6, 20.7, 'down'],
  cafe: [45.72, 21.85, Math.PI / 2 - 0.2],
  notice: [27.4, 20.9, 'up'],
  fountain_w: [28.9, 25.3, 'right'],
  fountain_e: [35.2, 25.6, 'left'],
  fountain_s: [32.3, 27.6, 'down'],
  bench_sw: [27.4, 28.9, Math.PI * 0.8],
  bench_se: [36.6, 28.9, -Math.PI * 0.8],
  hall_steps: [32.0, 13.8, 'down'],
  hall_lantern: [33.3, 14.3, 'up'],
  planters_hall: [28.6, 15.3, 'up'],
  plaza_play: [36.4, 32.4, 'down'],
  market_produce: [50.4, 23.1, 'up'],
  market_flowers: [55.6, 23.2, 'up'],
  easel_river: [59.3, 22.5, 'right'],
  easel_plaza: [25.4, 22.4, 'up'],
  bridge_mid: [64.4, 26.25, 'down'],
  river_dock: [61.3, 36.6, 'right'],
  river_walk: [58.6, 31.6, 'right'],
  forge_anvil: [84.6, 19.5, 'up'],
  inn_front: [78.2, 30.6, 'down'],
  inn_tables: [76.12, 29.4, -Math.PI / 2],
  clinic_front: [34.0, 40.6, 'down'],
  garden_east: [51.6, 36.4, 'up'],
  lumber_yard: [86.4, 46.9, 'down'],
};

/** Town camera bounds (look-target clamp). */
export const TOWN_CAM_BOUNDS = { x0: 10, z0: 12, x1: 90, z1: 52 };
