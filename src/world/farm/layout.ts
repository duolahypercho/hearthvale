/**
 * Farm layout assembly: turns the data tables in data/farm-layout.ts into scene objects —
 * structures (house, bin, mailbox, lanterns, fences, dock), the authored prop vignettes
 * (with ground patches + baked contact AO), hero trees + plateau forest, pond / cliff / flower dressing.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import {
  POND,
  PLOT,
  BIN,
  HOUSE,
  FARM_WATER_LEVEL,
  HERO_TREES,
  VIGNETTES,
  STEPPING_STONES,
  type FarmPropKind,
  type PropPlacement,
} from '../../data/farm-layout';
import { TileFlag, TileType, type TileGrid } from '../tiles';
import type { Terrain } from '../terrain';
import type { TreeField, TreeSpecies } from '../props/trees';
import type { Nature, NatureKind } from '../props/nature';
import { buildFarmhouse, buildShippingBin, buildMailbox, buildLanternPost, buildWoodpile, buildChoppingBlock, buildBarrel, buildFence, buildDock, type BuiltProp } from '../props/structures';
import {
  buildScarecrow,
  buildWheelbarrow,
  buildWateringCanOnStump,
  buildHayBale,
  buildLaundryLine,
  buildBirdBath,
  buildBeehive,
  buildToolRack,
  buildBench,
  buildHarvestPile,
  buildFlowerPot,
  buildSignpost,
  buildSteppingStones,
  buildSnowman,
} from '../props/farmkit';
import { buildWoodShelter, buildSplitLogs, buildLaundryBasket, buildStoneSlab, buildChickenCoop, buildFeedTrough, buildGardenArch, buildWaterPump } from '../props/homestead';
import type { FarmShape } from './paint';

/** What the layout needs from the map under construction. */
export interface FarmBuildCtx {
  readonly root: THREE.Group;
  readonly grid: TileGrid;
  readonly terrain: Terrain;
  readonly shape: FarmShape;
  readonly rng: Rng;
  addProp(p: BuiltProp | THREE.Group, x: number, z: number, rotY?: number, opts?: { solid?: [number, number][]; dynamic?: boolean }): BuiltProp;
  seasonalProp(g: THREE.Group, x: number, z: number, rot: number, seasons: Season[], solid?: [number, number][]): void;
  addStatic(o: THREE.Object3D): void;
  readonly smokeAnchors: THREE.Vector3[];
  readonly leafSpots: { x: number; z: number; r: number }[];
  mailFlag: THREE.Object3D | null;
}

/** Contact-AO footprint radius (m) per prop kind (0 = the prop brings its own ground). */
const AO_RADIUS: Partial<Record<FarmPropKind, number>> = {
  scarecrow: 0.55,
  wateringCanStump: 0.6,
  wheelbarrow: 0.9,
  bench: 0.95,
  flowerPot: 0.35,
  harvestPumpkins: 0.6,
  harvestBasket: 0.45,
  harvestCrate: 0.5,
  laundryLine: 0,
  laundryBasket: 0.5,
  birdBath: 0.55,
  beehive: 0.55,
  stoneSlab: 0.7,
  hayRound: 0.85,
  chickenCoop: 1.25,
  feedTrough: 0.65,
  toolRack: 0.9,
  signpost: 0.35,
  snowman: 0.6,
  woodpile: 1.2,
  woodShelter: 1.5,
  choppingBlock: 0.5,
  splitLogs: 0.7,
  barrel: 0.45,
  gardenArch: 0,
  waterPump: 0.55,
};

function buildProp(kind: FarmPropKind, r: Rng, p: PropPlacement): BuiltProp | THREE.Group {
  switch (kind) {
    case 'scarecrow':
      return buildScarecrow(r);
    case 'wateringCanStump':
      return buildWateringCanOnStump();
    case 'wheelbarrow':
      return buildWheelbarrow();
    case 'bench':
      return buildBench();
    case 'flowerPot':
      return buildFlowerPot(r, p.color ?? 0xff8fab);
    case 'harvestPumpkins':
      return buildHarvestPile(r, 'pumpkins');
    case 'harvestBasket':
      return buildHarvestPile(r, 'basket');
    case 'harvestCrate':
      return buildHarvestPile(r, 'crate');
    case 'laundryLine':
      return buildLaundryLine(r, 3.3);
    case 'laundryBasket':
      return buildLaundryBasket(r);
    case 'birdBath':
      return buildBirdBath();
    case 'beehive':
      return buildBeehive();
    case 'stoneSlab':
      return buildStoneSlab(r);
    case 'hayRound':
      return buildHayBale(r, true);
    case 'chickenCoop':
      return buildChickenCoop(r);
    case 'feedTrough':
      return buildFeedTrough(r);
    case 'toolRack':
      return buildToolRack();
    case 'signpost':
      return buildSignpost();
    case 'snowman':
      return buildSnowman(r);
    case 'woodpile':
      return buildWoodpile(r);
    case 'woodShelter':
      return buildWoodShelter(r);
    case 'choppingBlock':
      return buildChoppingBlock();
    case 'splitLogs':
      return buildSplitLogs(r);
    case 'barrel':
      return buildBarrel();
    case 'gardenArch':
      return buildGardenArch(r);
    case 'waterPump':
      return buildWaterPump(r);
  }
}

/**
 * Props kept out of the static merge. (Wind-animated parts such as laundry cloth carry a custom
 * depth material and are skipped by mergeStatic automatically, so their posts still merge.)
 */
const DYNAMIC: Partial<Record<FarmPropKind, boolean>> = {};

export function buildStructures(ctx: FarmBuildCtx): void {
  const r = ctx.rng.fork('structures');
  const { grid, terrain } = ctx;
  const blockRect = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid.setFlag(x, z, TileFlag.Blocked);
  };
  const house = ctx.addProp(buildFarmhouse(r), HOUSE.x, HOUSE.z);
  blockRect(28, 11, 35, 15);
  blockRect(29, 16, 33, 17);
  blockRect(27, 16, 27, 16);
  grid.setObject(31, 17, { kind: 'building', id: 'farmhouse_door', solid: true });
  ctx.smokeAnchors.push(house.anchors.chimney!.clone().add(house.group.position));
  // House footprint shadow on the ground (soft contact AO around the foundation).
  terrain.stampCover('ao', HOUSE.x, HOUSE.z + 0.4, 4.6, 0.55, 0.62);

  ctx.addProp(buildShippingBin(), BIN.x, BIN.z);
  for (const x of [37, 38]) grid.setObject(x, 16, { kind: 'building', id: 'shipping_bin', solid: true });
  terrain.stampCover('ao', BIN.x, BIN.z, 1.0, 0.8, 0.7);

  const mb = ctx.addProp(buildMailbox(), 35.7, 18.7, -0.2);
  ctx.mailFlag = mb.group.getObjectByName('mailbox-flag') ?? null;
  grid.setObject(35, 18, { kind: 'prop', id: 'mailbox', solid: true });

  ctx.addProp(buildLanternPost(), 29.4, 18.9, Math.PI);
  grid.setObject(29, 18, { kind: 'prop', id: 'lantern', solid: true });
  ctx.addProp(buildLanternPost(), 35.4, 25.6, 0);
  grid.setObject(35, 25, { kind: 'prop', id: 'lantern', solid: true });
  for (const [x, z] of [[29.4, 18.9], [35.4, 25.6], [35.7, 18.7]] as const) terrain.stampCover('ao', x, z, 0.4, 0.8);

  // Fenced garden plot (west of house) with a gate gap under the rose arch.
  const fx0 = PLOT.x0 - 0.5;
  const fx1 = PLOT.x1 + 1.5;
  const fz0 = PLOT.z0 - 0.5;
  const fz1 = PLOT.z1 + 1.5;
  // Gate posts meet the arch (x 23.05 / 24.95).
  const run: [number, number][] = [[23.05, fz1]];
  for (let x = 22.5; x >= fx0; x -= 1) run.push([x, fz1]);
  for (let z = fz1 - 1; z >= fz0; z -= 1) run.push([fx0, z]);
  for (let x = fx0 + 1; x <= fx1; x += 1) run.push([x, fz0]);
  for (let z = fz0 + 1; z <= fz1; z += 1) run.push([fx1, z]);
  for (let x = fx1 - 1; x >= 25.0; x -= 1) run.push([x, fz1]);
  run.push([24.95, fz1]);
  const fence = buildFence([run], (x, z) => terrain.heightAt(x, z), r);
  ctx.addStatic(fence);
  for (let x = PLOT.x0 - 1; x <= PLOT.x1 + 1; x++) {
    for (const z of [PLOT.z0 - 1, PLOT.z1 + 1]) {
      if (z === PLOT.z1 + 1 && (x === 23 || x === 24)) continue;
      grid.setObject(x, z, { kind: 'fence', id: 'wood_fence', solid: true });
    }
  }
  for (let z = PLOT.z0; z <= PLOT.z1; z++) {
    for (const x of [PLOT.x0 - 1, PLOT.x1 + 1]) grid.setObject(x, z, { kind: 'fence', id: 'wood_fence', solid: true });
  }
  // Fence along the path towards the east exit.
  const eastFence: [number, number][] = [];
  for (let x = 45; x <= 55; x += 1.25) eastFence.push([x, 26.2 + Math.sin(x * 0.4) * 0.15]);
  ctx.addStatic(buildFence([eastFence], (x, z) => terrain.heightAt(x, z), r));

  // Dock on the pond.
  const dock = buildDock(3.2, 1.3);
  dock.position.set(POND.x + POND.r + 1.5, FARM_WATER_LEVEL + 0.18, POND.z);
  ctx.addStatic(dock);
}

/** Authored vignettes: ground patches are painted by FarmShape; here the props + contact AO. */
export function buildVignettes(ctx: FarmBuildCtx, nature: Nature): void {
  const r = ctx.rng.fork('yard');
  const { terrain } = ctx;
  for (const v of VIGNETTES) {
    for (const p of v.props) {
      const g = buildProp(p.kind, r, p);
      const group = g instanceof THREE.Group ? g : g.group;
      const seasonal = !!p.seasons;
      const bp = seasonal
        ? (ctx.seasonalProp(group, p.x, p.z, p.rot ?? 0, p.seasons!, p.solid), null)
        : ctx.addProp(g, p.x, p.z, p.rot ?? 0, { solid: p.solid, dynamic: DYNAMIC[p.kind] });
      // Sink 3 cm so nothing hovers on gentle slopes; stacking offset on top.
      group.position.y += (p.y ?? 0) - 0.03;
      void bp;
      const ao = p.ao ?? AO_RADIUS[p.kind] ?? 0.5;
      if (ao > 0 && !seasonal) terrain.stampCover('ao', p.x, p.z, ao * 1.2, 0.7);
    }
    for (const [x, z, c] of v.flowers ?? []) {
      nature.place('flower', x, terrain.heightAt(x, z), z, { color: c, scale: 1.15 });
      nature.place('flower', x + 0.3, terrain.heightAt(x, z), z + 0.22, { color: c, scale: 0.9 });
    }
  }
  const st = buildSteppingStones(STEPPING_STONES, (x, z) => terrain.heightAt(x, z), r);
  ctx.addStatic(st);
}

export function placeTrees(ctx: FarmBuildCtx, trees: TreeField): void {
  const r = ctx.rng.fork('tree-place');
  const { shape, terrain, grid } = ctx;
  for (const [sp, x, z, s] of HERO_TREES) {
    if (shape.basinDist(x, z) > -0.8) continue;
    if (sp !== 'pine') ctx.leafSpots.push({ x, z, r: 2.6 * s });
    const h = trees.add(sp as TreeSpecies, x, terrain.heightAt(x, z) - 0.05, z, s);
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    grid.setObject(tx, tz, { kind: 'tree', id: sp, solid: true, hp: 10, onRemove: () => trees.remove(h) });
    // Shade + roots darken the ground under the canopy.
    terrain.stampCover('ao', x, z, 1.1 * s, 0.75);
    terrain.stampCover('moss', x, z, 2.2 * s, 0.55);
  }
  // Forest on the plateau and hills.
  const step = 2.5;
  for (let z = -20; z < 86; z += step) {
    for (let x = -22; x < 86; x += step) {
      const jx = x + (r.next() - 0.5) * step * 0.9;
      const jz = z + (r.next() - 0.5) * step * 0.9;
      const d = shape.basinDist(jx, jz);
      if (d < 1.6) continue;
      if (shape.exitMask(jx, jz) > 0.2) continue;
      const clearing = shape.noise2.fbm(jx * 0.05, jz * 0.05, 2);
      if (clearing < -0.25 && d < 12) continue;
      if (r.next() < 0.18) continue;
      const slope = terrain.slopeAt(jx, jz);
      if (slope < 0.75) continue;
      const pineBias = THREE.MathUtils.smoothstep(shape.noise.get(jx * 0.04 + 100, jz * 0.04), -0.2, 0.4);
      const sp: TreeSpecies = r.next() < pineBias * 0.8 ? 'pine' : r.next() < 0.55 ? 'oak' : r.next() < 0.8 ? 'maple' : 'blossom';
      const s = 0.85 + r.next() * 0.45;
      trees.add(sp, jx, terrain.heightAt(jx, jz) - 0.08, jz, s, undefined, d > 4 ? 1 : 0);
    }
  }
}

/** Pond, house-garden, cliff-base and plateau dressing (the field overgrowth lives in overgrowth.ts). */
export function placeNature(ctx: FarmBuildCtx, nature: Nature): void {
  const r = ctx.rng.fork('nature-place');
  const { grid, terrain, shape } = ctx;
  const place = (kind: NatureKind, x: number, z: number, opts: { scale?: number; color?: number; solid?: boolean; register?: boolean; hp?: number } = {}) => {
    const h = nature.place(kind, x, terrain.heightAt(x, z), z, { scale: opts.scale, color: opts.color });
    if (opts.register) {
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      const objKind = kind === 'boulder' ? 'boulder' : kind === 'stone' ? 'stone' : 'bush';
      grid.setObject(tx, tz, { kind: objKind, id: kind, solid: opts.solid ?? true, hp: opts.hp, onRemove: () => nature.remove(h) });
    }
    return h;
  };
  const free = (x: number, z: number): boolean => grid.inBounds(x, z) && grid.isWalkable(x, z) && grid.getType(x, z) === TileType.Grass && !grid.getObject(x, z);

  // Hand-placed dressing around the house.
  place('bush', 27.0, 16.5, { register: true, scale: 1.0 });
  place('berryBush', 26.7, 11.5, { register: true, scale: 1.1, color: 0xd6344a });
  place('bush', 36.3, 11.3, { register: true, scale: 0.9 });
  place('bush', 42.3, 16.2, { register: true, scale: 1.05 });
  for (const [x, z, c] of [[28.1, 17.2, 0xff8fab], [28.6, 17.6, 0xffd166], [34.8, 17.3, 0xffffff], [34.4, 17.8, 0xc77dff], [30.2, 19.8, 0xff8fab], [33.5, 19.9, 0xffd166]] as const) {
    place('flower', x, z, { color: c, scale: 1.1 });
  }
  // Reeds, lilies and stones around the pond.
  for (let i = 0; i < 30; i++) {
    const a = r.next() * Math.PI * 2;
    const rr = POND.r - 0.4 + r.next() * 1.1;
    const x = POND.x + Math.cos(a) * rr;
    const z = POND.z + (Math.sin(a) * rr) / 1.1;
    if (x > POND.x + POND.r - 1 && Math.abs(z - POND.z) < 1.2) continue; // keep dock clear
    if (r.next() < 0.6) place('reed', x, z, { scale: 0.8 + r.next() * 0.5 });
    else place('stone', x, z, { scale: 0.8 + r.next() * 0.8 });
  }
  for (let i = 0; i < 16; i++) {
    const a = r.next() * Math.PI * 2;
    const rr = r.next() * (POND.r - 1.6);
    const x = POND.x + Math.cos(a) * rr;
    const z = POND.z + (Math.sin(a) * rr) / 1.1;
    nature.place('lilypad', x, FARM_WATER_LEVEL + 0.01, z, { scale: 0.8 + r.next() * 0.6 });
  }

  // Cliff base: boulders, bushes, ferns (a dense, shaded rim around the basin).
  for (let z = 0; z < grid.depth; z++) {
    for (let x = 0; x < grid.width; x++) {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const d = shape.basinDist(cx, cz);
      if (d <= -1.8 || d >= -0.2 || !free(x, z)) continue;
      if (terrain.splatAt(cx, cz, 'path') > 0.1) continue;
      const ox = cx + (r.next() - 0.5) * 0.4;
      const oz = cz + (r.next() - 0.5) * 0.4;
      const roll = r.next();
      if (roll < 0.08) place('boulder', ox, oz, { register: true, scale: 0.7 + r.next() * 0.6 });
      else if (roll < 0.22) place(r.next() < 0.25 ? 'berryBush' : 'bush', ox, oz, { register: true, scale: 0.8 + r.next() * 0.45, color: 0x4a6ad8 });
      else if (roll < 0.4) place('fern', ox, oz, { scale: 0.9 + r.next() * 0.5 });
    }
  }
  // Plateau dressing (outside the grid, purely visual).
  for (let i = 0; i < 700; i++) {
    const x = -18 + r.next() * 100;
    const z = -18 + r.next() * 100;
    const d = shape.basinDist(x, z);
    if (d < 1.4 || terrain.slopeAt(x, z) < 0.8) continue;
    const roll = r.next();
    const kind: NatureKind = roll < 0.35 ? 'bush' : roll < 0.55 ? 'fern' : roll < 0.75 ? 'flower' : roll < 0.87 ? 'stone' : roll < 0.95 ? 'boulder' : 'mushroom';
    nature.place(kind, x, terrain.heightAt(x, z), z, { color: kind === 'flower' ? shape.flowerColor(x, z) : undefined, scale: 0.8 + r.next() * 0.5, lod: 1 });
  }
}
