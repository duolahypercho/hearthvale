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
  // plaza → Meadow Lane
  { pts: [[31.5, 35], [31.8, 38.2], [32, 39.8]], w: 1.05 },
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
  // Meadow Lane: loops from the clinic lane round the schoolhouse and the south cottage.
  { pts: [[31.8, 39.4], [27.6, 41.2], [25.4, 45.4], [23.2, 50.4], [17.2, 51.6], [9.6, 51.0]], w: 0.85 },
  { pts: [[32.2, 39.4], [36.4, 41.2], [38.6, 45.4], [40.8, 50.4], [46.8, 51.6], [54.2, 50.8]], w: 0.85 },
  { pts: [[23.4, 50.2], [28, 51.3], [32, 51.5], [36, 51.3], [40.6, 50.2]], w: 0.85 },
  { pts: [[32, 48.2], [32, 51.2]], w: 0.8 },
  { pts: [[15.2, 49.2], [15.2, 51.4]], w: 0.7 },
  { pts: [[45.4, 49.2], [45.6, 51.4]], w: 0.65 },
];

export type NewBuildingKind = 'forge' | 'inn' | 'clinic' | 'keeper' | 'birch' | 'houseNE' | 'school' | 'cottageS';

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
  { id: 'clinic', kind: 'clinic', x: 32, z: 45.2, rot: 0, block: [28, 43, 35, 47] },
  { id: 'keeper_cottage', kind: 'keeper', x: 10.6, z: 15.2, rot: 0, block: [8, 13, 12, 16] },
  { id: 'birch_house', kind: 'birch', x: 80.2, z: 50.4, rot: Math.PI, block: [77, 49, 83, 52] },
  { id: 'house_ne', kind: 'houseNE', x: 90.4, z: 15.6, rot: 0, block: [88, 13, 92, 17] },
  // Meadow Lane (the south quarter).
  { id: 'schoolhouse', kind: 'school', x: 15.2, z: 46.6, rot: 0, block: [12, 44, 18, 48] },
  { id: 'cottage_south', kind: 'cottageS', x: 46.8, z: 46.8, rot: 0, block: [44, 44, 49, 48] },
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
  | 'kettleSign'
  | 'vegBed'
  | 'fence'
  | 'beehive'
  | 'chalkBoard'
  | 'sandwichBoard'
  | 'wheelbarrow'
  | 'flowerCart'
  | 'bicycle'
  | 'flowerRing';

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
  /** Fence runs: points relative to (x, z). flowerRing: [[r0, r1], [a0°, a1°]]. */
  pts?: [number, number][];
  /** Skip the shadow pass (small clutter). */
  noShadow?: boolean;
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
  { kind: 'easel', x: 26.5, z: 23.2, rot: -1.83 },
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
  { kind: 'bench', x: 36.6, z: 49.2, rot: 0, solid: [[36, 49]] },
  { kind: 'planter', x: 27.4, z: 49.0, colors: [0xffffff, 0xc77dff], solid: [[27, 49]] },
  { kind: 'flowerPot', x: 30.7, z: 48.5, colors: [0xff8fab] },
  { kind: 'flowerPot', x: 33.3, z: 48.5, colors: [0xffd166] },
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
  // Meadow Lane: the schoolyard (swing, bench, chalk board), lamps along the lane.
  { kind: 'swing', x: 20.6, z: 46.2, rot: -0.25 },
  { kind: 'bench', x: 10.2, z: 49.4, rot: Math.PI / 2 - 0.2, solid: [[10, 49]] },
  { kind: 'chalkBoard', x: 17.6, z: 50.0, rot: 0.25, colors: [0x2f4a3e] },
  { kind: 'flowerPot', x: 13.4, z: 49.3, colors: [0xff8fab] },
  { kind: 'flowerPot', x: 17.0, z: 49.3, colors: [0xffd166] },
  { kind: 'lampLit', x: 24.8, z: 48.2, rot: -Math.PI / 2, solid: [[24, 48]] },
  { kind: 'lamp', x: 39.4, z: 48.2, rot: Math.PI / 2, solid: [[39, 48]] },
  { kind: 'lamp', x: 11.8, z: 52.8, rot: Math.PI, solid: [[11, 52]] },
  // The south cottage's kitchen garden: fenced raised beds, beehives, a rain barrel, laundry.
  { kind: 'vegBed', x: 51.4, z: 45.6, rot: 0, solid: [[50, 45], [51, 45], [52, 45]] },
  { kind: 'vegBed', x: 51.4, z: 47.6, rot: 0, solid: [[50, 47], [51, 47], [52, 47]] },
  { kind: 'fence', x: 51.4, z: 46.6, pts: [[-2.2, -2.2], [0, -2.3], [2.3, -2.2], [2.3, 0], [2.2, 2.1]], solid: [[53, 44], [53, 45], [53, 46], [53, 47], [53, 48]] },
  { kind: 'beehive', x: 54.6, z: 44.6, rot: 0.3, solid: [[54, 44]] },
  { kind: 'beehive', x: 55.5, z: 45.4, rot: -0.2, solid: [[55, 45]] },
  { kind: 'laundry', x: 42.2, z: 47.8, rot: Math.PI / 2 + 0.1 },
  { kind: 'mailbox', x: 44.2, z: 50.6, rot: 0 },
  { kind: 'produce', x: 49.6, z: 49.6, rot: -0.3 },

  // ── Street life clutter round the square (round 2): shop-front stock, bikes, a barrow of blooms,
  // flower beds hugging the fountain's north side, café boards, market-row odds and ends.
  // Fountain flower beds (NW / NE arcs, north of the pots; the W / E / S chat spots stay clear).
  { kind: 'flowerRing', x: 32, z: 25, pts: [[3.35, 4.05], [100, 162]] },
  { kind: 'flowerRing', x: 32, z: 25, pts: [[3.35, 4.05], [18, 80]] },
  // Thimble & Pip's front.
  { kind: 'sacks', x: 22.6, z: 18.95, rot: 0.3 },
  { kind: 'produce', x: 21.5, z: 19.05, rot: -0.1 },
  { kind: 'bicycle', x: 16.9, z: 19.9, rot: Math.PI / 2 + 0.25, colors: [0x3f7fa8] },
  { kind: 'flowerPot', x: 23.4, z: 19.2, colors: [0xff7aa2] },
  // Hearth Oven front.
  { kind: 'sacks', x: 42.9, z: 18.9, rot: -0.3 },
  { kind: 'produce', x: 41.3, z: 19.0, rot: 0.15 },
  { kind: 'bicycle', x: 47.9, z: 20.6, rot: -Math.PI / 2 - 0.35, colors: [0xc8573e] },
  { kind: 'sandwichBoard', x: 38.9, z: 22.9, rot: 0.5, colors: [0x5a3a24] },
  // Lantern Hall steps.
  { kind: 'flowerPot', x: 29.9, z: 13.3, colors: [0xffd166] },
  { kind: 'flowerPot', x: 34.1, z: 13.3, colors: [0xff8fab] },
  { kind: 'crates', x: 37.4, z: 15.8, rot: 0.4, solid: [[37, 15]] },
  // West lawn + south edge of the square.
  { kind: 'wheelbarrow', x: 22.6, z: 31.4, rot: 0.7, solid: [[22, 31]] },
  { kind: 'flowerPot', x: 24.1, z: 26.9, colors: [0xc77dff] },
  { kind: 'flowerPot', x: 23.5, z: 27.5, colors: [0xffffff] },
  { kind: 'sacks', x: 43.4, z: 32.2, rot: 0.8 },
  { kind: 'crates', x: 44.9, z: 30.2, rot: -0.2, solid: [[44, 30]] },
  { kind: 'flowerPot', x: 39.7, z: 27.9, colors: [0xff8fab] },
  { kind: 'barrel', x: 40.1, z: 26.7, solid: [[40, 26]] },
  { kind: 'laundry', x: 47.6, z: 28.4, rot: 0.08 },
  // Market row odds and ends.
  { kind: 'flowerPot', x: 54.2, z: 20.4, colors: [0xffd166] },
  { kind: 'flowerPot', x: 57.2, z: 20.5, colors: [0xc77dff] },
  { kind: 'sacks', x: 49.1, z: 29.9, rot: 0.2 },
  { kind: 'produce', x: 55.9, z: 29.9, rot: 0.3 },
  { kind: 'sandwichBoard', x: 51.8, z: 23.9, rot: -0.4, colors: [0x2f4a3e] },
  // Copper Kettle terrace + clinic lane.
  { kind: 'flowerPot', x: 78.4, z: 32.6, colors: [0xff8fab] },
  { kind: 'flowerPot', x: 81.6, z: 32.6, colors: [0xffd166] },
  { kind: 'crates', x: 86.9, z: 31.9, rot: 0.3, solid: [[86, 31]] },
  { kind: 'bicycle', x: 35.9, z: 42.6, rot: 0.2, colors: [0x5f9a4a] },
  { kind: 'wheelbarrow', x: 48.4, z: 43.3, rot: -0.5, solid: [[48, 43]] },
  // South lawns of the square (round 2b): a raised bed and pots on the west lawn, a picnic table
  // with its own bed on the east one, so the walk down from the fountain isn't a bare green.
  { kind: 'planter', x: 25.6, z: 33.6, colors: [0xff8fab, 0xffffff, 0xffd166], solid: [[25, 33]] },
  { kind: 'flowerPot', x: 26.9, z: 34.2, colors: [0xc77dff] },
  { kind: 'flowerPot', x: 24.4, z: 34.3, colors: [0xffd166] },
  { kind: 'beehive', x: 20.8, z: 34.6, rot: 0.25, solid: [[20, 34]] },
  { kind: 'cafeSet', x: 40.2, z: 34.6, rot: 0.3, solid: [[40, 34]] },
  { kind: 'planter', x: 43.2, z: 35.8, colors: [0xffffff, 0xc77dff, 0xff8fab], solid: [[43, 35]] },
  { kind: 'flowerPot', x: 38.9, z: 36.1, colors: [0xff7aa2] },
  { kind: 'sandwichBoard', x: 35.4, z: 36.6, rot: -0.3, colors: [0x2f4a3e] },
];

/** Extra trees: [species, x, z, scale]. */
export const EXTRA_TREES: ['oak' | 'maple' | 'pine' | 'blossom', number, number, number][] = [
  ['oak', 72.6, 49.8, 1.1],
  ['blossom', 70.6, 33.2, 0.85],
  ['maple', 86.8, 11.4, 1.0],
  ['pine', 93.8, 30.2, 1.05],
  ['oak', 58.4, 14.6, 1.05],
  ['blossom', 52.8, 43.4, 0.9],
  ['maple', 40.6, 45.2, 1.0],
  ['oak', 22.6, 46.0, 1.1],
  ['blossom', 5.8, 13.4, 0.85],
  ['pine', 94.6, 44.4, 1.0],
  ['maple', 69.8, 12.6, 0.95],
  ['oak', 90.8, 54.6, 1.0],
  // Meadow Lane orchard.
  ['blossom', 19.5, 56.0, 0.85],
  ['oak', 27.5, 56.6, 0.95],
  ['blossom', 36.8, 56.2, 0.9],
  ['maple', 44.5, 56.8, 0.95],
];

/** Square trees moved out of heart-event sight lines: [fromX, fromZ, toX, toZ]. */
export const TREE_MOVES: [number, number, number, number][] = [[58.5, 30.5, 49.6, 41.4], [56.5, 38.5, 56.8, 52.6], [50.6, 22.2, 49.8, 16.9]];

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
  fountain_w: [28.3, 25.4, 'right'],
  fountain_e: [35.8, 25.7, 'left'],
  fountain_s: [32.6, 28.5, 'down'],
  bench_sw: [27.4, 28.9, Math.PI * 0.8],
  bench_se: [36.6, 28.9, -Math.PI * 0.8],
  hall_steps: [32.0, 13.8, 'down'],
  hall_lantern: [33.3, 14.3, 'up'],
  planters_hall: [28.6, 15.3, 'up'],
  plaza_play: [36.4, 32.4, 'down'],
  market_produce: [50.4, 23.1, 'up'],
  market_flowers: [55.6, 23.2, 'up'],
  easel_river: [59.3, 22.5, 'right'],
  easel_plaza: [25.4, 22.9, 1.3],
  bridge_mid: [64.4, 26.25, 'down'],
  river_dock: [61.3, 36.6, 'right'],
  river_walk: [58.6, 31.6, 'right'],
  forge_anvil: [84.6, 19.5, 'up'],
  inn_front: [78.2, 30.6, 'down'],
  inn_tables: [76.12, 29.4, -Math.PI / 2],
  clinic_front: [33.8, 49.9, 'down'],
  garden_east: [51.6, 36.4, 'up'],
  lumber_yard: [86.4, 46.9, 'down'],
  school_yard: [19.4, 48.4, 'down'],
  school_bench: [10.9, 49.5, Math.PI / 2 - 0.2],
  veg_garden: [49.6, 46.6, 'right'],
};

/** Town camera bounds (look-target clamp). */
export const TOWN_CAM_BOUNDS = { x0: 10, z0: 12, x1: 90, z1: 52 };

/** Plaza lamp posts (the ring in data/town-layout.ts: 30°, 150°, 210°, 330° at r 7.6 round the fountain). */
const PLAZA_C = { x: 32, z: 25, r: 7.6 };
const post = (deg: number): [number, number] => [PLAZA_C.x + Math.cos((deg * Math.PI) / 180) * PLAZA_C.r, PLAZA_C.z + Math.sin((deg * Math.PI) / 180) * PLAZA_C.r];
const [SE, SW, NW, NE] = [post(30), post(150), post(210), post(330)];
/** Mast top on a plaza lamp post (m above ground). */
const MAST = 3.05;
/** Festoon pole top (m above ground). */
const POLE = 3.3;

/** Festoon poles planted for the light strings: [x, z]. */
export const FESTOON_POLES: [number, number][] = [
  // Market row zig-zag (south side of the east road, then north side).
  [49.6, 27.7],
  [53.2, 23.0],
  // Copper Kettle terrace front.
  [73.6, 28.2],
  [86.2, 28.6],
];

/** Plaza lamp posts that get an iron mast for the strings: [x, z]. */
export const FESTOON_MASTS: [number, number][] = [SE, SW, NW, NE];

/**
 * Light strings: anchors are [x, height above ground, z]; sag in metres. Everything hangs across
 * the view or along the plaza's sides — nothing droops down the camera axis over the fountain.
 */
export const FESTOON_SPANS: { a: [number, number, number]; b: [number, number, number]; sag: number }[] = [
  // Across the plaza, north and south of the fountain (mast to mast, across the view).
  { a: [NW[0], MAST, NW[1]], b: [NE[0], MAST, NE[1]], sag: 0.34 },
  { a: [SE[0], MAST, SE[1]], b: [SW[0], MAST, SW[1]], sag: 0.34 },
  // Shop-front corners (under the eaves) out to the north masts.
  { a: [24.35, 3.2, 18.45], b: [NW[0], MAST, NW[1]], sag: 0.14 },
  { a: [39.65, 3.15, 18.45], b: [NE[0], MAST, NE[1]], sag: 0.14 },
  // Market row: lamp → pole → pole, zig-zagging over the road, then along the stall fronts to the
  // bridge lamp (no pole south of the road by the bridge: that bank is the heart-event stage).
  { a: [46.4, 2.28, 23.2], b: [49.6, POLE, 27.7], sag: 0.22 },
  { a: [49.6, POLE, 27.7], b: [53.2, POLE, 23.0], sag: 0.26 },
  { a: [53.2, POLE, 23.0], b: [58.8, 2.28, 23.3], sag: 0.3 },
  // Copper Kettle terrace: along the front, and back up to the facade.
  { a: [73.6, POLE, 28.2], b: [86.2, POLE, 28.6], sag: 0.42 },
  { a: [73.6, POLE, 28.2], b: [76.0, 3.7, 32.45], sag: 0.2 },
  { a: [86.2, POLE, 28.6], b: [84.0, 3.7, 32.45], sag: 0.2 },
];

/** Winter snowmen: [x, z, rot] — plaza lawns and the schoolyard. */
export const SNOWMEN: [number, number, number][] = [
  [28.3, 17.5, 0.3],
  [36.1, 17.3, -0.35],
  [21.0, 49.2, 0.1],
];
