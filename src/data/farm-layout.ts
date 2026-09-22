/**
 * Farm layout (pure data): anchors, paths, hero trees and the authored prop vignettes.
 * The art / gameplay teams edit THIS file to move things around; world/farm/* reads it.
 *
 * Coordinates are world units = tiles (+X east, +Z south / towards the camera).
 * `solid` lists the tiles a prop blocks. `seasons` limits a prop to those seasons.
 */
import type { Season } from '../core/time';

export const FARM_SIZE = 64;
/** Terrain extent (beyond the 64×64 grid: cliffs, plateau forest, hills). */
export const FARM_EXTENT = { minX: -26, minZ: -26, maxX: 90, maxZ: 90 };
export const FARM_WATER_LEVEL = -0.32;

export const HOUSE = { x: 31.5, z: 13.5 };
export const POND = { x: 13, z: 40, r: 5.2 };
/** Fenced kitchen garden west of the house (tile coords, inclusive). */
export const PLOT = { x0: 21, z0: 13, x1: 25, z1: 16 };
/** Showcase / starter field south-west of the house (tile coords, inclusive). */
export const FIELD = { x0: 22, z0: 20, x1: 29, z1: 23 };
export const BIN = { x: 38, z: 16.5 };

/** Dirt path polylines (Catmull-Rom through the points). The last two are narrower spurs. */
export const PATHS: [number, number][][] = [
  // porch → east exit
  [[31.5, 18.2], [31.6, 21.5], [33.2, 25.2], [37.5, 27.8], [44, 28.2], [50, 27.6], [56, 28.6], [62, 28.5], [70, 28.2], [80, 28.8]],
  // junction → south exit
  [[33.2, 25.2], [31.8, 30], [31.4, 36], [33.6, 42], [34.2, 48], [32.8, 54], [33.2, 60], [33.4, 70], [33, 82]],
  // little spur to the pond dock
  [[31.6, 33.5], [27.5, 36.5], [23, 39.2], [19.5, 40]],
  // path to shipping bin
  [[32.2, 19.6], [35, 19.2], [37.8, 18.2]],
];
export const NARROW_PATHS = new Set([2, 3]);

export type TreeKind = 'oak' | 'maple' | 'pine' | 'blossom';
/** Hand-placed hero trees inside the basin: [species, x, z, scale]. */
export const HERO_TREES: [TreeKind, number, number, number][] = [
  ['oak', 22.5, 9.6, 1.15],
  ['maple', 42.5, 9.2, 1.05],
  ['blossom', 13.4, 27.2, 0.95],
  ['oak', 6.8, 33.5, 1.2],
  ['maple', 19.5, 47.5, 1.0],
  ['oak', 8.2, 50, 1.1],
  ['pine', 55.5, 13.5, 1.0],
  ['oak', 58, 40, 1.15],
  ['maple', 50.5, 55, 1.0],
  ['pine', 9.5, 19.5, 1.05],
  ['blossom', 49.5, 20.5, 0.9],
  ['oak', 15.5, 55.5, 1.05],
  ['pine', 5.8, 26.2, 0.95],
  ['maple', 60.2, 50.5, 1.05],
  // Tree line framing the top of the homestead shots.
  ['oak', 16.2, 10.8, 1.1],
  ['maple', 27.2, 8.0, 1.0],
  ['oak', 36.0, 7.9, 1.15],
  ['blossom', 48.4, 12.6, 0.95],
  ['maple', 51.5, 9.6, 1.05],
  ['oak', 12.6, 15.2, 1.0],
  // Scattered field trees (shade islands in the overgrowth).
  ['oak', 45.5, 40.5, 1.0],
  ['maple', 24.5, 52.5, 0.95],
  ['blossom', 52.0, 33.5, 0.85],
];

/** Every buildable prop the layout can reference (builders live in world/farm/layout.ts). */
export type FarmPropKind =
  | 'scarecrow'
  | 'wateringCanStump'
  | 'wheelbarrow'
  | 'bench'
  | 'flowerPot'
  | 'harvestPumpkins'
  | 'harvestBasket'
  | 'harvestCrate'
  | 'laundryLine'
  | 'laundryBasket'
  | 'birdBath'
  | 'beehive'
  | 'stoneSlab'
  | 'hayRound'
  | 'chickenCoop'
  | 'feedTrough'
  | 'toolRack'
  | 'signpost'
  | 'snowman'
  | 'woodpile'
  | 'woodShelter'
  | 'choppingBlock'
  | 'splitLogs'
  | 'barrel'
  | 'gardenArch'
  | 'waterPump';

export interface PropPlacement {
  kind: FarmPropKind;
  x: number;
  z: number;
  rot?: number;
  /** Extra height offset (stacking). */
  y?: number;
  solid?: [number, number][];
  seasons?: Season[];
  /** Tint parameter for props that take one (flower pots). */
  color?: number;
  /** Contact-AO footprint radius (m); default from the prop kind. 0 = none. */
  ao?: number;
}

/** Ground treatment painted under a vignette (terrain cover channels). */
export interface GroundPatch {
  kind: 'packedDirt' | 'trampled' | 'moss' | 'clover' | 'straw';
  x: number;
  z: number;
  /** Radii (ellipse) in world units. */
  rx: number;
  rz: number;
  strength?: number;
}

export interface Vignette {
  name: string;
  ground: GroundPatch[];
  props: PropPlacement[];
  /** Flower clumps: [x, z, color]. */
  flowers?: [number, number, number][];
  /** Clear the overgrowth scatter within this radius of the first ground patch centre. */
  clearRadius?: number;
}

/**
 * Authored vignettes — each tells a small story on its own ground:
 *   woodshed corner · apiary · laundry yard · hen yard · garden gate · field edge · porch.
 */
export const VIGNETTES: Vignette[] = [
  {
    name: 'woodshed',
    clearRadius: 3.4,
    ground: [
      { kind: 'packedDirt', x: 40.4, z: 13.2, rx: 2.5, rz: 1.9, strength: 0.9 },
      { kind: 'straw', x: 40.1, z: 14.5, rx: 1.1, rz: 0.8, strength: 0.8 },
    ],
    props: [
      { kind: 'woodShelter', x: 41.3, z: 12.1, rot: -0.12, solid: [[40, 11], [41, 11], [42, 11], [40, 12], [41, 12], [42, 12]] },
      { kind: 'woodpile', x: 41.3, z: 12.2, rot: -0.12 },
      { kind: 'choppingBlock', x: 40.1, z: 14.5, rot: 0.4, solid: [[40, 14]] },
      { kind: 'splitLogs', x: 39.2, z: 14.9, rot: 0.9 },
      { kind: 'barrel', x: 38.3, z: 12.6, solid: [[38, 12]] },
      { kind: 'toolRack', x: 43.7, z: 13.9, rot: -0.1, solid: [[43, 13], [44, 13]] },
    ],
  },
  {
    name: 'apiary',
    clearRadius: 2.6,
    ground: [{ kind: 'clover', x: 46.3, z: 17.3, rx: 2.4, rz: 2.0, strength: 1 }],
    props: [
      { kind: 'stoneSlab', x: 45.6, z: 16.9, rot: -0.2, ao: 0 },
      { kind: 'beehive', x: 45.6, z: 16.9, rot: -0.2, y: 0.09, solid: [[45, 16]] },
      { kind: 'stoneSlab', x: 47.0, z: 17.7, rot: 0.15, ao: 0 },
      { kind: 'beehive', x: 47.0, z: 17.7, rot: 0.15, y: 0.09, solid: [[47, 17]] },
    ],
    flowers: [
      [44.3, 16.2, 0xc77dff], [44.5, 17.4, 0xc77dff], [44.9, 18.4, 0xffd166], [45.9, 18.9, 0xc77dff], [47.0, 19.1, 0xffffff],
      [48.1, 18.6, 0xc77dff], [48.5, 17.4, 0xffd166], [48.3, 16.3, 0xc77dff], [47.4, 15.6, 0xffffff], [46.2, 15.4, 0xc77dff],
      [45.1, 15.5, 0xffd166],
    ],
  },
  {
    name: 'laundry',
    clearRadius: 2.4,
    ground: [{ kind: 'trampled', x: 41.4, z: 19.4, rx: 2.3, rz: 1.1, strength: 0.85 }],
    props: [
      { kind: 'laundryLine', x: 41.4, z: 19.1, rot: 0.08, solid: [[39, 19], [43, 19]] },
      { kind: 'laundryBasket', x: 40.0, z: 19.95, rot: 0.5, solid: [[40, 19]] },
    ],
  },
  {
    name: 'henyard',
    clearRadius: 3,
    ground: [
      { kind: 'straw', x: 42.2, z: 22.9, rx: 2.2, rz: 1.6, strength: 0.9 },
      { kind: 'packedDirt', x: 41.4, z: 22.6, rx: 1.3, rz: 1.0, strength: 0.55 },
    ],
    props: [
      { kind: 'chickenCoop', x: 43.6, z: 22.0, rot: -0.35, solid: [[43, 21], [44, 21], [43, 22], [44, 22]] },
      { kind: 'feedTrough', x: 41.0, z: 23.4, rot: 0.1, solid: [[41, 23]] },
      { kind: 'hayRound', x: 45.4, z: 23.7, rot: 1.2, solid: [[45, 23], [46, 23]] },
      { kind: 'waterPump', x: 39.5, z: 21.9, rot: 0.6, solid: [[39, 21]] },
    ],
  },
  {
    name: 'garden-gate',
    ground: [{ kind: 'trampled', x: 24.0, z: 18.0, rx: 1.0, rz: 0.7, strength: 0.6 }],
    props: [{ kind: 'gardenArch', x: 24.0, z: 17.5, rot: 0, ao: 0 }],
  },
  {
    name: 'field-edge',
    ground: [],
    props: [
      { kind: 'scarecrow', x: FIELD.x0 - 0.55, z: FIELD.z0 + 1.6, rot: 0.25, solid: [[FIELD.x0 - 1, FIELD.z0 + 1]] },
      { kind: 'wateringCanStump', x: FIELD.x0 - 0.7, z: FIELD.z1 + 0.2, rot: 0.6, solid: [[FIELD.x0 - 1, FIELD.z1]] },
      { kind: 'wheelbarrow', x: FIELD.x1 + 1.5, z: FIELD.z1 - 0.6, rot: 0.35, solid: [[FIELD.x1 + 1, FIELD.z1 - 1], [FIELD.x1 + 1, FIELD.z1]] },
      { kind: 'signpost', x: 34.3, z: 27.3, rot: -0.3, solid: [[34, 27]] },
    ],
  },
  {
    name: 'porch',
    ground: [],
    props: [
      { kind: 'flowerPot', x: 29.85, z: 18.45, seasons: ['spring', 'summer'], color: 0xff8fab, solid: [[29, 18]] },
      { kind: 'flowerPot', x: 33.2, z: 18.45, seasons: ['spring', 'summer'], color: 0xffd166 },
      { kind: 'harvestPumpkins', x: 29.8, z: 18.5, rot: 0.3, seasons: ['fall'] },
      { kind: 'harvestPumpkins', x: 33.25, z: 18.5, rot: 1.3, seasons: ['fall'] },
      { kind: 'harvestBasket', x: 36.55, z: 17.75, rot: 0.2, seasons: ['spring'], solid: [[36, 17]] },
      { kind: 'harvestCrate', x: 36.55, z: 17.75, rot: 0.2, seasons: ['summer', 'fall'], solid: [[36, 17]] },
      { kind: 'bench', x: 26.3, z: 17.95, solid: [[26, 17]] },
      { kind: 'snowman', x: 36.4, z: 21.0, rot: -0.35, seasons: ['winter'], solid: [[36, 20], [36, 21]] },
    ],
  },
  {
    name: 'birdbath-garden',
    clearRadius: 1.6,
    ground: [{ kind: 'clover', x: 37.6, z: 22.6, rx: 1.4, rz: 1.1, strength: 0.8 }],
    props: [{ kind: 'birdBath', x: 37.6, z: 22.6, solid: [[37, 22]] }],
    flowers: [[36.9, 23.4, 0xffd166], [38.4, 22.1, 0xff8fab], [36.8, 22.0, 0xc77dff], [38.6, 23.3, 0xffffff]],
  },
];

/** Stepping stones from the porch yard to the garden gate. */
export const STEPPING_STONES: [number, number][] = [[28.6, 18.7], [27.7, 18.95], [26.8, 18.8], [25.9, 18.55], [25.0, 18.3], [24.1, 18.2]];

/** Winter trail of boot prints: porch → shipping bin → yard → field edge. */
export const SNOW_TRAIL: [number, number][] = [[31.4, 18.1], [31.9, 19.2], [34.2, 19.4], [36.6, 18.3], [37.2, 18.9], [36.0, 20.1], [33.2, 20.9], [31.3, 20.3]];

/** Ambient life anchors (world coords). */
export const FARM_POI: Record<string, { x: number; z: number; rot?: number }[]> = {
  cat: [{ x: 33.9, z: 18.1, rot: -0.5 }],
  chickens: [{ x: 41.6, z: 22.6 }],
  birds: [{ x: 37.4, z: 20.6 }, { x: 27.6, z: 21.6 }],
  bees: [{ x: 45.6, z: 16.9 }, { x: 47.0, z: 17.7 }],
  flowers: [
    { x: 28.4, z: 17.5 },
    { x: 34.6, z: 17.5 },
    { x: FIELD.x0 + 2, z: FIELD.z0 + 1 },
    { x: FIELD.x1 - 1, z: FIELD.z1 },
    { x: 46.3, z: 17.3 },
    { x: 37.6, z: 22.6 },
  ],
};

/**
 * "Overgrown inheritance" debris scatter (grandmother's farm has gone wild).
 * Poisson-disk candidates over every free grass tile, kept by a clustered noise density so
 * there are thick thickets and clear glades. Weights pick the object mix per cluster biome.
 */
export const OVERGROWTH = {
  /** Poisson-disk minimum spacing (m). */
  spacing: 0.95,
  /** Target mean per-tile density across the field (0.25–0.4). */
  density: 0.48,
  /** Noise scale of the thicket / glade clustering (1/m). */
  clusterScale: 0.085,
  /** Keep-out margins (m). */
  pathMargin: 1.3,
  /** Chance a debris piece gathers 1-2 small satellites (pebbles / twigs / weeds) into a clump. */
  clumpChance: 0.45,
  /** Biome mixes (relative weights). */
  meadow: { weedA: 3, weedB: 2, weedC: 2, tallGrass: 5, stone: 1, branch: 1, bush: 0.6 },
  rocky: { stone: 5, boulder: 1.2, pebbles: 2, weedA: 1, tallGrass: 1, branch: 0.5 },
  woody: { stump: 1.1, branch: 3, log: 0.7, bush: 2.4, weedB: 1.2, tallGrass: 2.6, stone: 0.6 },
} as const;
