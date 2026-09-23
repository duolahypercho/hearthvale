/**
 * Hearthvale town: the cobbled plaza with its fountain and the dark Lantern Hall to the north,
 * Thimble & Pip's store and The Hearth Oven bakery on the shop row, cottages to the south; a
 * market row running east to the Kettle Bridge over the river; across it, the Flint & Ember
 * forge, The Copper Kettle inn and the Birch house with its lumber yard; the Willowmere Clinic on
 * the south lane, the lamplighter's cottage by the west road (from the farm) and a rope
 * footbridge downstream. Villagers are spawned by systems/npcs.ts (names / spots in layout.ts).
 *
 * Static props are merged per district (west / middle / east) so the shadow + main passes can
 * frustum-cull whole quarters of town.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { Rng } from '../../core/rng';
import { Noise2D, smoothstep } from '../../core/noise';
import type { Season, Weather } from '../../core/time';
import type { GameMap, MapWarp } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Terrain } from '../terrain';
import { GrassField } from '../grass';
import { TreeField } from '../props/trees';
import { Nature } from '../props/nature';
import { mergeStatic } from '../geom';
import { createWater } from '../water';
import { textures } from '../../render/textures';
import { SmokeEmitter, Ambience, FireFX } from '../../render/particles';
import { LightPools } from '../props/decals';
import { buildLanternPost, buildBarrel, buildCrate, buildMailbox, buildDock, type BuiltProp } from '../props/structures';
import { buildBench, buildFlowerPot, buildWheelbarrow, buildSignpost, buildLaundryLine } from '../props/farmkit';
import { buildTownHouse, buildLanternHall, buildFountain, buildNoticeBoard, buildMarketStall, buildPlanter, buildHedge, buildFlowerCart, buildCafeSet, buildSandwichBoard, type HouseSpec } from '../props/townkit';
import { buildBunting, buildLanternPole, buildMaypole, buildFeastTable, buildBrazier } from '../props/festival';
import { PLAZA, STREETS, BUILDINGS, TOWN_PROPS, TOWN_TREES, FESTIVAL, TOWN_WARPS, TOWN_SPAWN, type TownBuilding } from '../../data/town-layout';
import {
  TOWN_W,
  TOWN_D,
  TOWN_EXTENT2,
  RIM,
  WATER_Y,
  RIVER_BED,
  RIVER,
  RIVER_HALF,
  RIVER_BANK,
  BRIDGES,
  EXTRA_STREETS,
  NEW_BUILDINGS,
  EXTRA_PROPS,
  EXTRA_TREES,
  TOWN_CAM_BOUNDS,
  type Bridge,
  type NewBuilding,
} from './layout';
import {
  buildForge,
  buildInn,
  buildClinic,
  buildKeeperCottage,
  buildBirchHouse,
  buildHouseNE,
  buildStoneBridge,
  buildFootbridge,
  buildStall,
  buildWell,
  buildEasel,
  buildRowboat,
  buildSawhorse,
  buildLumber,
  buildLogPile,
  buildSacks,
  buildProduceCrates,
  buildSwing,
  buildKettleSign,
  coalMaterial,
  deckY,
} from './buildings';

const HOUSES: Record<Exclude<TownBuilding['kind'], 'hall'>, HouseSpec> = {
  store: { w: 7, d: 5, wallH: 3.3, wall: 'plaster', wallTint: 0xfbeed8, roofTint: 0x5fa89a, doorTint: 0x3f7890, shutterTint: 0x5d9484, awning: [0xd8573e, 0xf6ecd8], sign: 'store', chimney: false, doorX: -1 },
  bakery: { w: 6.6, d: 5, wallH: 3.2, wall: 'stone', wallTint: 0xf0d2b8, roofTint: 0xd0724e, doorTint: 0x8a4a2a, awning: [0xe8b64a, 0xfbf2dc], sign: 'bakery', chimney: true, flowerBoxes: true, doorX: 1 },
  cottageA: { w: 5.4, d: 4.2, wallH: 2.6, wall: 'wood', wallTint: 0xf6e2c4, roofTint: 0xd8b068, roof: 'thatch', doorTint: 0x4f7fb0, shutterTint: 0x4f7fb0, chimney: true, flowerBoxes: true },
  cottageB: { w: 5.4, d: 4.2, wallH: 2.6, wall: 'plaster', wallTint: 0xe8f0e0, roofTint: 0xa87aa8, doorTint: 0x5a8a4a, shutterTint: 0x6a9a5a, chimney: true, flowerBoxes: true },
};

/** Static-merge districts (x ranges) for culling. */
const DISTRICTS = [
  { id: 'west', x0: -99, x1: 40 },
  { id: 'mid', x0: 40, x1: 69 },
  { id: 'east', x0: 69, x1: 999 },
];

export class TownMap implements GameMap {
  readonly id = 'town';
  readonly title = 'Hearthvale';
  readonly grid = new TileGrid(TOWN_W, TOWN_D);
  readonly root = new THREE.Group();
  readonly spawn = { x: TOWN_SPAWN.x, z: TOWN_SPAWN.z, facing: 'right' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(TOWN_CAM_BOUNDS.x0, TOWN_CAM_BOUNDS.z0), new THREE.Vector2(TOWN_CAM_BOUNDS.x1, TOWN_CAM_BOUNDS.z1));
  readonly terrain: Terrain;
  readonly grass: GrassField;
  readonly warps: MapWarp[] = TOWN_WARPS;
  readonly poi: Record<string, { x: number; y?: number; z: number; rot?: number }[]> = {};
  private trees: TreeField;
  private nature: Nature;
  private rng: Rng;
  private noise: Noise2D;
  private streetSamples: { x: number; z: number; w: number }[] = [];
  private riverSamples: THREE.Vector3[] = [];
  private staticRoots: THREE.Object3D[] = [];
  private smoke: SmokeEmitter[] = [];
  private ambience: Ambience;
  private pools = new LightPools();
  private festival = new THREE.Group();
  private festivalOn = false;
  private fire: FireFX | null = null;
  private forgeFire: FireFX | null = null;
  private forgeLight: THREE.PointLight | null = null;
  /** Festival practicals (budget: 4 point lights), always in the scene so toggling never recompiles. */
  private festivalLights: { light: THREE.PointLight; max: number; seed: number }[] = [];

  constructor(private game: Game) {
    this.root.name = 'map:town';
    this.rng = game.rng.fork('town');
    this.noise = new Noise2D(this.rng.fork('n').seed);
    this.sampleRiver();
    this.sampleStreets();
    this.terrain = new Terrain({ ...TOWN_EXTENT2, step: 0.5, height: (x, z) => this.height(x, z), waterLevel: WATER_Y, pathTexture: textures.cobble().map, pathScale: 0.48 });
    this.root.add(this.terrain.mesh);
    this.terrain.paint('path', (x, z) => this.streetValue(x, z));
    // Sandy / pebbly river banks.
    this.terrain.paint('sand', (x, z) => {
      const d = this.riverDist(x, z);
      return smoothstep(RIVER_BANK + 0.9, RIVER_HALF + 0.2, d) * (0.55 + 0.45 * smoothstep(-0.2, 0.4, this.noise.fbm(x * 0.4, z * 0.4, 2))) * (1 - this.streetValue(x, z));
    });
    this.terrain.commitSplat();
    this.terrain.paintCover('clover', (x, z) => smoothstep(0.62, 0.75, this.noise.fbm(x * 0.15 + 9, z * 0.15, 2) * 0.5 + 0.5) * (1 - this.streetValue(x, z)), { x0: -2, z0: -2, x1: 102, z1: 66 });
    this.terrain.paintCover('moss', (x, z) => smoothstep(RIVER_BANK + 2.5, RIVER_BANK, this.riverDist(x, z)) * 0.8, { x0: 50, z0: -4, x1: 80, z1: 70 });
    this.classifyTiles();

    this.trees = new TreeField(this.rng.fork('trees'));
    this.nature = new Nature(this.rng.fork('nature'));
    this.buildBuildings();
    this.buildNewBuildings();
    this.buildProps();
    this.buildExtraProps();
    this.buildRiver();
    this.placeTrees();
    this.placeNature();
    this.terrain.commitCover();
    this.trees.finalize();
    this.nature.finalize();
    this.trees.group.userData.perfTag = 'trees';
    this.nature.group.userData.perfTag = 'nature';
    this.root.add(this.trees.group, this.nature.group, this.pools.group);
    this.mergeDistricts();
    this.festival.name = 'festival';
    this.festival.visible = false;
    this.festival.userData.perfTag = 'festival';
    this.root.add(this.festival);
    this.buildFestival();

    this.grass = new GrassField({
      bounds: { x0: -12, z0: -10, x1: 112, z1: 74 },
      density: (x, z) => this.grassDensity(x, z),
      tallness: (x, z) => 0.1 + 0.4 * smoothstep(0.1, 0.6, this.noise.fbm(x * 0.09, z * 0.09, 2)) * smoothstep(8, 14, Math.hypot(x - PLAZA.x, z - PLAZA.z)) + 0.25 * smoothstep(RIVER_BANK + 2, RIVER_BANK, this.riverDist(x, z)),
      height: (x, z) => this.terrain.heightAt(x, z),
      seed: 'town-grass',
      densityScale: game.rc.preset.grassDensity,
      cover: this.terrain,
    });
    this.root.add(this.grass.group);
    this.ambience = new Ambience((x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.ambience.group);
    game.events.on('demo:stage', ({ showcase }) => this.setFestival(showcase.includes('festival')));
    // Ambient life anchors for the critter system.
    this.poi.flowers = [{ x: 20.5, z: 19.2 }, { x: 43, z: 19.2 }, { x: 16, z: 35 }, { x: 48, z: 35 }, { x: PLAZA.x, z: PLAZA.z + 4 }, { x: 55.8, z: 22.4 }, { x: 30.2, z: 41.9 }];
    this.poi.birds = [{ x: 29.5, z: 28.5 }, { x: 35.5, z: 21.5 }, { x: 58.4, z: 33.6 }, { x: 78, z: 28.6 }];
    this.poi.water = [{ x: 64.4, z: 32 }, { x: 65.6, z: 40 }, { x: 64.4, z: 18 }];
  }

  // ───────────────────────────────────────────── shape

  private rimDist(x: number, z: number): number {
    const { cx, cz, hx, hz, r } = RIM;
    const qx = Math.abs(x - cx) - (hx - r);
    const qz = Math.abs(z - cz) - (hz - r);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    return d + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.2;
  }

  private exitMask(x: number, z: number): number {
    return smoothstep(4.5, 2.8, Math.abs(z - 26)) * (smoothstep(4, -2, x) + smoothstep(94, 100, x));
  }

  private sampleRiver(): void {
    const curve = new THREE.CatmullRomCurve3(RIVER.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const n = Math.ceil(curve.getLength() / 0.5);
    for (let k = 0; k <= n; k++) this.riverSamples.push(curve.getPointAt(k / n));
  }

  /** Distance to the river centreline (meandering width via noise). */
  riverDist(x: number, z: number): number {
    if (x < 50 || x > 80) return 99;
    let best = 99;
    for (const p of this.riverSamples) {
      const dz = p.z - z;
      if (Math.abs(dz) > 6) continue;
      const d = Math.hypot(p.x - x, dz);
      if (d < best) best = d;
    }
    return best - this.noise.get(x * 0.18 + 40, z * 0.18) * 0.45;
  }

  private height(x: number, z: number): number {
    const d = this.rimDist(x, z);
    const n = this.noise;
    // The river cuts through the rim at both ends: no hills in its valley.
    const rd = this.riverDist(x, z);
    const valley = smoothstep(9, 4, rd);
    const hills = (smoothstep(-0.5, 5, d) * 1.6 + smoothstep(4, 20, d) * (2.5 + n.fbm(x * 0.04 + 5, z * 0.04, 3) * 3)) * (1 - Math.min(1, this.exitMask(x, z))) * (1 - valley);
    const ripple = n.fbm(x * 0.05 + 3, z * 0.05, 2) * 0.18 * smoothstep(6, 12, Math.hypot(x - PLAZA.x, z - PLAZA.z));
    const rise = smoothstep(10, 4, Math.hypot((x - 32) * 0.7, z - 8)) * 0.35;
    let h = hills + ripple + rise;
    // River channel: bank shoulders, a sloped beach, then the bed.
    if (rd < RIVER_BANK + 1.5) {
      const t = smoothstep(RIVER_BANK + 1.5, RIVER_HALF - 0.6, rd);
      const bed = RIVER_BED + n.fbm(x * 0.3, z * 0.3, 2) * 0.15;
      h = THREE.MathUtils.lerp(h, bed, t);
    }
    return h;
  }

  private sampleStreets(): void {
    const add = (pts: [number, number][], w: number): void => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const n = Math.ceil(curve.getLength() / 0.3);
      for (let k = 0; k <= n; k++) {
        const p = curve.getPointAt(k / n);
        this.streetSamples.push({ x: p.x, z: p.z, w: w + this.noise.get(p.x * 0.2, p.z * 0.2) * 0.12 });
      }
    };
    STREETS.forEach((pts, i) => add(pts, i <= 1 ? 1.35 : i === 2 ? 1.25 : 0.95));
    for (const s of EXTRA_STREETS) add(s.pts, s.w);
  }

  private streetValue(x: number, z: number): number {
    let best = 0;
    for (const s of this.streetSamples) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (Math.abs(dx) > 2.6 || Math.abs(dz) > 2.6) continue;
      const v = smoothstep(s.w + 0.55, s.w - 0.25, Math.sqrt(dx * dx + dz * dz));
      if (v > best) best = v;
    }
    const pd = Math.hypot(x - PLAZA.x, z - PLAZA.z) + this.noise.get(x * 0.5, z * 0.5) * 0.35;
    best = Math.max(best, smoothstep(PLAZA.r + 0.5, PLAZA.r - 0.3, pd));
    const hall = Math.max(Math.abs(x - 32) - 4.5, Math.abs(z - 13.4) - 1.1);
    best = Math.max(best, smoothstep(0.5, -0.2, hall));
    // Forge shed + inn terrace aprons.
    best = Math.max(best, smoothstep(0.5, -0.2, Math.max(Math.abs(x - 83.4) - 2.6, Math.abs(z - 19.4) - 1.4)));
    best = Math.max(best, smoothstep(0.5, -0.2, Math.max(Math.abs(x - 80) - 5.8, Math.abs(z - 29.6) - 1.3)));
    // Don't pave the river bed.
    if (this.riverDist(x, z) < RIVER_HALF + 0.4) best = 0;
    return best;
  }

  private bridgeAt(x: number, z: number): Bridge | null {
    for (const b of BRIDGES) if (Math.abs(x - b.x) <= b.len / 2 && Math.abs(z - b.z) <= b.width / 2 - 0.15) return b;
    return null;
  }

  private classifyTiles(): void {
    const g = this.grid;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const br = this.bridgeAt(cx, cz);
      if (br) {
        g.height[i] = br.endY + deckY(br, cx - br.x);
        g.type[i] = br.kind === 'stone' ? TileType.Stone : TileType.Floor;
        return;
      }
      g.height[i] = this.terrain.heightAt(cx, cz);
      const rd = this.riverDist(cx, cz);
      if (rd < RIVER_HALF + 0.35 || g.height[i]! < WATER_Y + 0.05) {
        g.type[i] = TileType.Water;
        g.flags[i] = TileFlag.WaterSource;
        return;
      }
      const d = this.rimDist(cx, cz);
      if ((d > -0.2 && this.exitMask(cx, cz) < 0.5 && rd > RIVER_BANK + 2) || this.terrain.slopeAt(cx, cz) < 0.8) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      g.type[i] = this.terrain.splatAt(cx, cz, 'path') > 0.5 ? TileType.Stone : TileType.Grass;
    });
    // Bridge parapets block the deck edges.
    for (const b of BRIDGES) {
      for (let x = Math.floor(b.x - b.len / 2); x <= Math.floor(b.x + b.len / 2); x++) {
        for (const zz of [b.z - b.width / 2 - 0.2, b.z + b.width / 2 + 0.2]) {
          const tz = Math.floor(zz);
          if (this.grid.getType(x, tz) === TileType.Water) this.grid.setFlag(x, tz, TileFlag.Blocked);
        }
      }
    }
  }

  private grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.78) return 0;
    if (this.riverDist(x, z) < RIVER_HALF + 0.9) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.25) return 0;
    const sand = t.splatAt(x, z, 'sand');
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (this.grid.inBounds(tx, tz) && this.grid.hasFlag(tx, tz, TileFlag.Blocked) && this.grid.getType(tx, tz) !== TileType.Cliff) return 0.3;
    const clump = smoothstep(-0.1, 0.5, this.noise.fbm(x * 0.13 + 4, z * 0.13, 2));
    return (3 + clump * 4.5) * (pv > 0.05 ? 0.55 : 1) * (1 - sand * 0.7);
  }

  // ───────────────────────────────────────────── build

  private addProp(p: BuiltProp | THREE.Group, x: number, z: number, rot = 0, solid?: [number, number][], opts: { lights?: 'full' | 'pool' | 'none'; y?: number } = {}): BuiltProp {
    const bp: BuiltProp = p instanceof THREE.Group ? { group: p, lights: [], anchors: {} } : p;
    bp.group.position.set(x, opts.y ?? this.terrain.heightAt(x, z) - 0.03, z);
    bp.group.rotation.y = rot;
    this.root.add(bp.group);
    this.staticRoots.push(bp.group);
    bp.group.updateMatrixWorld(true);
    const mode = opts.lights ?? 'full';
    for (const l of bp.lights) {
      const wp = l.light.getWorldPosition(new THREE.Vector3());
      if (mode !== 'none') this.pools.add(wp.x, wp.z, this.terrain.heightAt(wp.x, wp.z), Math.min(3.4, 1.4 + wp.y - this.terrain.heightAt(wp.x, wp.z)));
      if (mode !== 'full') {
        l.light.removeFromParent();
        continue;
      }
      l.light.castShadow = false;
      l.light.color.setHex(0xffb45e);
      l.light.distance = 6.5;
      l.light.decay = 2;
      this.game.lighting.addNightLight(l.light, Math.max(l.max, 6) * 1.6);
    }
    for (const [tx, tz] of solid ?? []) this.grid.setObject(tx, tz, { kind: 'prop', id: bp.group.name, solid: true });
    return bp;
  }

  private addDoorAndSmoke(bp: BuiltProp, id: string, smokeRate: number): void {
    if (bp.anchors.chimney && smokeRate > 0) {
      const s = new SmokeEmitter(bp.anchors.chimney.clone().applyMatrix4(bp.group.matrixWorld), smokeRate);
      this.smoke.push(s);
      this.root.add(s.object);
    }
    if (bp.anchors.door) {
      const d = bp.anchors.door.clone().applyMatrix4(bp.group.matrixWorld);
      (this.poi[id] ??= []).push({ x: d.x, z: d.z });
    }
  }

  private buildBuildings(): void {
    const r = this.rng.fork('buildings');
    for (const b of BUILDINGS) {
      const bp = b.kind === 'hall' ? buildLanternHall(r) : buildTownHouse(r, HOUSES[b.kind]);
      bp.group.name = b.id;
      this.addProp(bp, b.x, b.z, b.rot ?? 0, undefined, { lights: b.kind === 'hall' || b.kind === 'store' || b.kind === 'bakery' ? 'full' : 'pool' });
      const [x0, z0, x1, z1] = b.block;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid.setFlag(x, z, TileFlag.Blocked);
      this.terrain.stampCover('ao', b.x, b.z + 0.3, (x1 - x0 + 1) * 0.62, 0.55, (z1 - z0 + 1) / (x1 - x0 + 1));
      this.addDoorAndSmoke(bp, b.id, b.kind === 'store' ? 0 : b.kind === 'bakery' ? 6 : 3.5);
    }
  }

  private buildNewBuildings(): void {
    const r = this.rng.fork('buildings2');
    const make = (b: NewBuilding): BuiltProp => {
      switch (b.kind) {
        case 'forge':
          return buildForge(r);
        case 'inn':
          return buildInn(r);
        case 'clinic':
          return buildClinic(r);
        case 'keeper':
          return buildKeeperCottage(r);
        case 'birch':
          return buildBirchHouse(r);
        case 'houseNE':
          return buildHouseNE(r);
      }
    };
    for (const b of NEW_BUILDINGS) {
      const bp = make(b);
      bp.group.name = b.id;
      this.addProp(bp, b.x, b.z, b.rot, undefined, { lights: b.kind === 'inn' ? 'full' : 'pool' });
      const [x0, z0, x1, z1] = b.block;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid.setFlag(x, z, TileFlag.Blocked);
      this.terrain.stampCover('ao', b.x, b.z, (x1 - x0 + 1) * 0.62, 0.55, (z1 - z0 + 1) / (x1 - x0 + 1));
      this.addDoorAndSmoke(bp, b.id, b.kind === 'inn' ? 5 : b.kind === 'forge' ? 0 : 3);
      if (b.kind === 'forge') {
        // Hearth: shed collision, flames + embers, forge smoke, a flickering practical light.
        for (let z = 14; z <= 16; z++) for (let x = 82; x <= 85; x++) this.grid.setObject(x, z, { kind: 'prop', id: 'hearth', solid: true });
        this.grid.setObject(84, 18, { kind: 'prop', id: 'anvil', solid: true });
        this.grid.setObject(86, 17, { kind: 'prop', id: 'trough', solid: true });
        const hearth = bp.anchors.hearth!.clone().applyMatrix4(bp.group.matrixWorld);
        this.forgeFire = new FireFX([hearth.clone().setY(hearth.y - 0.18)], 60);
        this.root.add(this.forgeFire.object);
        const s = new SmokeEmitter(bp.anchors.hearthSmoke!.clone().applyMatrix4(bp.group.matrixWorld), 5);
        this.smoke.push(s);
        this.root.add(s.object);
        this.forgeLight = new THREE.PointLight(0xff7a2a, 3, 7, 1.6);
        this.forgeLight.position.copy(hearth).add(new THREE.Vector3(0, 0.4, 0.8));
        this.root.add(this.forgeLight);
        this.pools.add(hearth.x, hearth.z + 1.2, this.terrain.heightAt(hearth.x, hearth.z + 1.2), 2.6);
        this.poi.forge = [{ x: hearth.x, z: hearth.z }];
      }
    }
  }

  private buildProps(): void {
    const r = this.rng.fork('props');
    for (const p of TOWN_PROPS) {
      let g: BuiltProp | THREE.Group;
      switch (p.kind) {
        case 'fountain':
          g = buildFountain(r);
          break;
        case 'noticeBoard':
          g = buildNoticeBoard(r);
          break;
        case 'marketStall':
          g = buildMarketStall(r);
          break;
        case 'bench':
          g = buildBench();
          break;
        case 'lanternPost':
          g = buildLanternPost();
          break;
        case 'planter':
          g = buildPlanter(r, p.colors ?? [0xff8fab]);
          break;
        case 'hedge':
          g = buildHedge(r, p.len ?? 3);
          break;
        case 'barrel':
          g = buildBarrel();
          break;
        case 'crateStack': {
          const grp = new THREE.Group();
          const c1 = buildCrate();
          const c2 = buildCrate();
          c2.position.set(0.1, 0.6, 0.05);
          c2.rotation.y = 0.4;
          grp.add(c1, c2);
          g = grp;
          break;
        }
        case 'flowerPot':
          g = buildFlowerPot(r, p.colors?.[0] ?? 0xff8fab);
          break;
        case 'wheelbarrow':
          g = buildWheelbarrow();
          break;
        case 'flowerCart':
          g = buildFlowerCart(r);
          break;
        case 'cafeSet':
          g = buildCafeSet();
          break;
        case 'sandwichBoard':
          g = buildSandwichBoard(p.colors?.[0]);
          break;
      }
      this.addProp(g, p.x, p.z, p.rot ?? 0, p.solid);
      if (p.kind !== 'hedge') this.terrain.stampCover('ao', p.x, p.z, p.kind === 'fountain' ? 2.8 : p.kind === 'marketStall' ? 1.6 : 0.6, 0.6);
    }
    this.grid.forEach((x, z) => {
      if (Math.hypot(x + 0.5 - PLAZA.x, z + 0.5 - PLAZA.z) < 2.45) this.grid.setObject(x, z, { kind: 'prop', id: 'fountain', solid: true });
    });
    this.poi.plaza = [{ x: PLAZA.x, z: PLAZA.z }];
  }

  private buildExtraProps(): void {
    const r = this.rng.fork('props2');
    for (const p of EXTRA_PROPS) {
      let g: BuiltProp | THREE.Group;
      let lights: 'full' | 'pool' | 'none' = 'none';
      switch (p.kind) {
        case 'stall':
          g = buildStall(r, (p.colors ?? [0x3f8f7a, 0xf4ecd8]) as [number, number], p.goods ?? 'produce');
          break;
        case 'lamp':
        case 'lampLit':
          g = buildLanternPost();
          lights = p.kind === 'lampLit' ? 'full' : 'pool';
          break;
        case 'bench':
          g = buildBench();
          break;
        case 'well':
          g = buildWell(r);
          break;
        case 'easel':
          g = buildEasel(r);
          break;
        case 'barrel':
          g = buildBarrel();
          break;
        case 'crates': {
          const grp = new THREE.Group();
          const c1 = buildCrate();
          const c2 = buildCrate();
          c2.position.set(0.55, 0, 0.1);
          c2.rotation.y = 0.3;
          const c3 = buildCrate();
          c3.position.set(0.2, 0.6, 0.05);
          c3.rotation.y = -0.4;
          grp.add(c1, c2, c3);
          g = grp;
          break;
        }
        case 'sacks':
          g = buildSacks(r);
          break;
        case 'produce':
          g = buildProduceCrates(r);
          break;
        case 'flowerPot':
          g = buildFlowerPot(r, p.colors?.[0] ?? 0xff8fab);
          break;
        case 'signpost':
          g = buildSignpost();
          break;
        case 'laundry':
          g = buildLaundryLine(r, 3.4);
          break;
        case 'dock':
          g = buildDock(3.2, 1.4);
          break;
        case 'rowboat':
          g = buildRowboat();
          break;
        case 'sawhorse':
          g = buildSawhorse(r);
          break;
        case 'lumber':
          g = buildLumber(r);
          break;
        case 'logpile':
          g = buildLogPile(r);
          break;
        case 'cafeSet':
          g = buildCafeSet();
          break;
        case 'planter':
          g = buildPlanter(r, p.colors ?? [0xff8fab]);
          break;
        case 'mailbox':
          g = buildMailbox();
          break;
        case 'swing':
          g = buildSwing();
          break;
        case 'hedge':
          g = buildHedge(r, p.len ?? 3);
          break;
        case 'kettleSign':
          g = buildKettleSign();
          break;
      }
      // Dock + rowboat sit at the water line.
      const y = p.kind === 'dock' ? WATER_Y + 0.16 : p.kind === 'rowboat' ? WATER_Y - 0.12 : undefined;
      this.addProp(g, p.x, p.z, p.rot ?? 0, p.solid, { lights, y });
      if (!['hedge', 'dock', 'rowboat', 'laundry'].includes(p.kind)) this.terrain.stampCover('ao', p.x, p.z, p.kind === 'stall' ? 1.6 : p.kind === 'well' ? 1.2 : 0.6, 0.6);
    }
    // The dock is walkable: a short jetty over the water.
    for (let x = 60; x <= 62; x++) {
      this.grid.setType(x, 36, TileType.Floor);
      this.grid.setFlag(x, 36, TileFlag.WaterSource, false);
      this.grid.height[this.grid.idx(x, 36)] = WATER_Y + 0.22;
    }
  }

  private buildRiver(): void {
    const r = this.rng.fork('river');
    const water = createWater(this.terrain, { x0: 52, z0: -12, x1: 76, z1: 76 }, WATER_Y);
    water.name = 'river';
    water.userData.perfTag = 'water';
    water.userData.noAO = true;
    this.root.add(water);
    for (const br of BRIDGES) {
      const g = br.kind === 'stone' ? buildStoneBridge(r, br, RIVER_BED) : buildFootbridge(r, br, RIVER_BED);
      g.name = br.id;
      this.addProp(g, br.x, br.z, 0, undefined, { y: 0 });
    }
    // Reeds, lily pads and river stones along the banks.
    for (const p of this.riverSamples) {
      if (p.z < -4 || p.z > 68) continue;
      for (const side of [-1, 1]) {
        if (r.next() < 0.45) continue;
        const nx = p.x + side * (RIVER_HALF + 0.3 + r.next() * 0.9);
        const nz = p.z + (r.next() - 0.5) * 0.8;
        if (this.bridgeAt(nx, nz) || Math.abs(nz - 25.3) < 2.6 || Math.abs(nz - 46.2) < 1.8 || Math.abs(nz - 36.6) < 1.4) continue;
        const y = this.terrain.heightAt(nx, nz);
        const roll = r.next();
        if (roll < 0.55) this.nature.place('reed', nx, y, nz, { scale: 0.9 + r.next() * 0.5 });
        else if (roll < 0.75) this.nature.place('stone', nx, y, nz, { scale: 0.5 + r.next() * 0.4, lod: 1 });
        else this.nature.place('tallGrass', nx, y, nz, { scale: 0.9 + r.next() * 0.3 });
      }
      if (r.next() < 0.22) {
        const lx = p.x + (r.next() - 0.5) * RIVER_HALF * 1.4;
        const lz = p.z + (r.next() - 0.5) * 1.0;
        if (!this.bridgeAt(lx, lz) && Math.abs(lz - 25.3) > 2.4) this.nature.place('lilypad', lx, WATER_Y + 0.02, lz, { scale: 0.8 + r.next() * 0.5 });
      }
    }
  }

  private mergeDistricts(): void {
    const buckets = DISTRICTS.map(() => [] as THREE.Object3D[]);
    for (const o of this.staticRoots) {
      const x = o.position.x;
      const i = DISTRICTS.findIndex((d) => x >= d.x0 && x < d.x1);
      buckets[Math.max(0, i)]!.push(o);
    }
    DISTRICTS.forEach((d, i) => {
      if (!buckets[i]!.length) return;
      const merged = mergeStatic(buckets[i]!, `town-${d.id}`);
      merged.userData.perfTag = 'props';
      this.root.add(merged);
    });
  }

  private placeTrees(): void {
    const r = this.rng.fork('trees');
    const clear = (x: number, z: number): boolean => {
      for (const b of NEW_BUILDINGS) {
        const [x0, z0, x1, z1] = b.block;
        if (x > x0 - 2 && x < x1 + 3 && z > z0 - 2 && z < z1 + 3) return false;
      }
      return this.riverDist(x, z) > RIVER_BANK + 0.6;
    };
    for (const [sp, x, z, s] of [...TOWN_TREES, ...EXTRA_TREES]) {
      if (!clear(x, z) && !EXTRA_TREES.some((t) => t[1] === x && t[2] === z)) continue;
      const h = this.trees.add(sp, x, this.terrain.heightAt(x, z) - 0.05, z, s);
      this.grid.setObject(Math.floor(x), Math.floor(z), { kind: 'tree', id: sp, solid: true, onRemove: () => this.trees.remove(h) });
      this.terrain.stampCover('ao', x, z, 1.1 * s, 0.7);
    }
    for (let z = -18; z < 82; z += 2.4) {
      for (let x = -18; x < 118; x += 2.4) {
        const jx = x + (r.next() - 0.5) * 2;
        const jz = z + (r.next() - 0.5) * 2;
        const d = this.rimDist(jx, jz);
        if (d < 1.2 || this.exitMask(jx, jz) > 0.2 || r.next() < 0.2) continue;
        if (this.riverDist(jx, jz) < RIVER_BANK + 1.2) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.75) continue;
        const sp = r.next() < 0.35 ? 'pine' : r.next() < 0.5 ? 'oak' : r.next() < 0.75 ? 'maple' : 'blossom';
        this.trees.add(sp, jx, this.terrain.heightAt(jx, jz) - 0.08, jz, 0.85 + r.next() * 0.45, undefined, d > 3.5 ? 1 : 0);
      }
    }
  }

  private placeNature(): void {
    const r = this.rng.fork('nature');
    const g = this.grid;
    for (let z = 0; z < g.depth; z++) {
      for (let x = 0; x < g.width; x++) {
        const cx = x + 0.5 + (r.next() - 0.5) * 0.5;
        const cz = z + 0.5 + (r.next() - 0.5) * 0.5;
        if (!g.isWalkable(x, z) || g.getType(x, z) !== TileType.Grass) continue;
        if (this.terrain.splatAt(cx, cz, 'path') > 0.05) continue;
        const d = this.rimDist(cx, cz);
        const roll = r.next();
        const y = this.terrain.heightAt(cx, cz);
        if (d > -2.2) {
          if (roll < 0.18) this.nature.place(r.next() < 0.3 ? 'berryBush' : 'bush', cx, y, cz, { scale: 0.8 + r.next() * 0.4, color: 0xd6344a, lod: 1 });
          else if (roll < 0.3) this.nature.place('fern', cx, y, cz, { scale: 0.9 + r.next() * 0.4 });
          continue;
        }
        if (roll < 0.1) this.nature.place('flower', cx, y, cz, { color: [0xffffff, 0xffd166, 0xff8fab, 0xc77dff, 0x7ec8ff][Math.floor(r.next() * 5)]!, scale: 1.05 });
        else if (roll < 0.12) this.nature.place('tallGrass', cx, y, cz, { scale: 0.8 + r.next() * 0.3 });
        else if (roll < 0.13) this.nature.place('stone', cx, y, cz, { scale: 0.6 + r.next() * 0.3, lod: 1 });
      }
    }
    const beds: [number, number, number][] = [[17.2, 23.8, 19.0], [40.2, 46.2, 19.0], [13.4, 18.6, 34.9], [45.4, 50.6, 34.9], [8.6, 12.6, 17.7], [88.4, 92.4, 18.3], [29.0, 35.0, 42.3]];
    for (const [x0, x1, z] of beds) {
      for (let x = x0; x <= x1; x += 0.55) {
        const c = [0xff8fab, 0xffd166, 0xffffff, 0xc77dff][Math.floor(r.next() * 4)]!;
        this.nature.place('flower', x, this.terrain.heightAt(x, z), z + (r.next() - 0.5) * 0.3, { color: c, scale: 1.15 });
      }
    }
    // Hazel's cottage garden: rows of tall flowers east of the cottage.
    for (let row = 0; row < 3; row++) {
      for (let x = 51.2; x <= 54.6; x += 0.5) {
        const z = 32.2 + row * 0.9;
        this.nature.place('tallFlower', x, this.terrain.heightAt(x, z), z, { color: [0xff7aa2, 0xffd166, 0xc77dff][row]!, scale: 1.0 + r.next() * 0.2 });
      }
    }
  }

  /**
   * Lantern Night dressing: catenary bunting (posts / eaves / maypole crown only), paper-lantern
   * poles at every street mouth, a ribboned maypole in the fountain, two striped market stalls,
   * a harvest table and two fire braziers (flames + embers), lit by 4 warm point lights.
   * Built once, merged into a few draw calls, hidden until a festival is on.
   */
  private buildFestival(): void {
    const r = this.rng.fork('festival');
    const H = (x: number, z: number) => this.terrain.heightAt(x, z);
    const parts: THREE.Object3D[] = [];
    const place = (g: THREE.Object3D, x: number, z: number, rot = 0): void => {
      g.position.set(x, H(x, z) - 0.03, z);
      g.rotation.y = rot;
      this.festival.add(g);
      parts.push(g);
    };
    for (const [a, b, sag, flags, every] of FESTIVAL.bunting) {
      const A = new THREE.Vector3(a[0], a[1] + H(a[0], a[2]), a[2]);
      const B = new THREE.Vector3(b[0], b[1] + H(b[0], b[2]), b[2]);
      const g = buildBunting(r, A, B, sag, flags, every);
      this.festival.add(g);
      parts.push(g);
    }
    FESTIVAL.poles.forEach(([x, z], i) => place(buildLanternPole(r, i), x, z, Math.atan2(PLAZA.x - x, PLAZA.z - z) + Math.PI / 2));
    place(buildMaypole(r, 1.75, 2.0, 0.64), PLAZA.x, PLAZA.z);
    for (const [x, z, rot, a, b] of FESTIVAL.stalls) place(buildMarketStall(r, [a, b]), x, z, rot);
    const [tx, tz, trot, tlen] = FESTIVAL.table;
    place(buildFeastTable(r, tlen), tx, tz, trot);
    const fires: THREE.Vector3[] = [];
    for (const [x, z] of FESTIVAL.braziers) {
      const br = buildBrazier();
      place(br.group, x, z);
      fires.push(br.fire.clone().add(new THREE.Vector3(x, H(x, z) - 0.03, z)));
    }
    const merged = mergeStatic(parts, 'festival-static');
    merged.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const name = (m.material as THREE.Material).name;
      if (!['wood', 'woodGrain', 'stone'].includes(name)) m.userData.noAO = true;
    });
    this.festival.add(merged);
    this.fire = new FireFX(fires);
    this.festival.add(this.fire.object);
    const lp: [number, number, number, number, number][] = [
      [fires[0]!.x, fires[0]!.y + 0.4, fires[0]!.z, 0xff8a3a, 9],
      [fires[1]!.x, fires[1]!.y + 0.4, fires[1]!.z, 0xff8a3a, 9],
      [tx, H(tx, tz) + 1.9, tz + 0.2, 0xffb45a, 6],
      [PLAZA.x, H(PLAZA.x, PLAZA.z) + 4.6, PLAZA.z + 1.2, 0xffc070, 7],
    ];
    for (const [x, y, z, c, max] of lp) {
      const l = new THREE.PointLight(c, 0, 9, 1.6);
      l.position.set(x, y, z);
      this.root.add(l);
      this.festivalLights.push({ light: l, max, seed: Math.random() * 10 });
    }
  }

  // ───────────────────────────────────────────── runtime

  /** Festival dressing (bunting + paper lanterns) on / off. */
  setFestival(on: boolean): void {
    this.festivalOn = on;
    this.festival.visible = on;
    if (this.fire) this.fire.active = on;
  }

  heightAt(x: number, z: number): number {
    const br = this.bridgeAt(x, z);
    if (br) return deckY(br, x - br.x);
    if (x > 59.8 && x < 63.2 && z > 35.7 && z < 37.5) return WATER_Y + 0.22;
    return this.terrain.heightAt(x, z);
  }

  clearGroundCover(x: number, z: number): void {
    this.grass.clearTile(x, z);
  }

  update(dt: number, game: Game): void {
    this.pools.update();
    this.grass.update(game.rc.rig.focus);
    const h = game.rc.renderer.domElement.height;
    for (const s of this.smoke) s.update(dt, game.lighting.night, h);
    this.ambience.update(dt, game.time, game.rc.rig.focus, game.lighting.night, h);
    if (this.festivalOn && this.fire) this.fire.update(dt, h);
    if (this.forgeFire) this.forgeFire.update(dt, h);
    // Forge hearth: coals breathe, the light flickers (brighter against the dusk).
    const t = game.time;
    const flick = 0.78 + 0.12 * Math.sin(t * 11.3) + 0.07 * Math.sin(t * 27.1 + 1.3) + 0.05 * Math.sin(t * 3.1);
    coalMaterial().emissiveIntensity = 2.0 + 0.9 * flick;
    if (this.forgeLight) this.forgeLight.intensity = (2.2 + 5 * game.lighting.night) * flick;
    const lamps = this.festivalOn ? Math.max(0.35, game.lighting.night) : 0;
    for (const f of this.festivalLights) {
      const fl = f.max > 8 ? 0.82 + 0.1 * Math.sin(game.time * 13 + f.seed) + 0.08 * Math.sin(game.time * 31 + f.seed * 3) : 1;
      f.light.intensity = f.max * lamps * fl;
    }
  }

  setSeason(season: Season): void {
    this.trees.setSeason(season);
    this.nature.setSeason(season);
    this.ambience.setSeason(season);
  }

  setWeather(weather: Weather): void {
    this.ambience.setWeather(weather);
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
