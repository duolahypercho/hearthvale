/**
 * Hearthvale town square: cobbled plaza with a fountain, the dark Lantern Hall to the north,
 * Thimble & Pip's general store, The Hearth Oven bakery, two cottages, a market stall, lamp
 * posts, planters and hedges, framed by blossom trees and a forested rim. The west road leads
 * back to the farm. Villagers are spawned by systems/npcs.ts.
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
import { textures } from '../../render/textures';
import { SmokeEmitter, Ambience } from '../../render/particles';
import { LightPools } from '../props/decals';
import { buildLanternPost, buildBarrel, buildCrate, type BuiltProp } from '../props/structures';
import { buildBench, buildFlowerPot, buildWheelbarrow } from '../props/farmkit';
import { buildTownHouse, buildLanternHall, buildFountain, buildNoticeBoard, buildMarketStall, buildPlanter, buildHedge, buildFestivalString, type HouseSpec } from '../props/townkit';
import { TOWN_SIZE, TOWN_EXTENT, PLAZA, STREETS, BUILDINGS, TOWN_PROPS, TOWN_TREES, BUNTING, TOWN_WARPS, TOWN_SPAWN, type TownBuilding } from '../../data/town-layout';

const HOUSES: Record<Exclude<TownBuilding['kind'], 'hall'>, HouseSpec> = {
  store: { w: 7, d: 5, wallH: 3.3, wall: 'plaster', wallTint: 0xfbeed8, roofTint: 0x5fa89a, doorTint: 0x3f7890, shutterTint: 0x5d9484, awning: [0xd8573e, 0xf6ecd8], sign: 'store', chimney: false, doorX: -1 },
  bakery: { w: 6.6, d: 5, wallH: 3.2, wall: 'stone', wallTint: 0xf0d2b8, roofTint: 0xd0724e, doorTint: 0x8a4a2a, awning: [0xe8b64a, 0xfbf2dc], sign: 'bakery', chimney: true, flowerBoxes: true, doorX: 1 },
  cottageA: { w: 5.4, d: 4.2, wallH: 2.6, wall: 'wood', wallTint: 0xf6e2c4, roofTint: 0xd8b068, roof: 'thatch', doorTint: 0x4f7fb0, shutterTint: 0x4f7fb0, chimney: true, flowerBoxes: true },
  cottageB: { w: 5.4, d: 4.2, wallH: 2.6, wall: 'plaster', wallTint: 0xe8f0e0, roofTint: 0xa87aa8, doorTint: 0x5a8a4a, shutterTint: 0x6a9a5a, chimney: true, flowerBoxes: true },
};

export class TownMap implements GameMap {
  readonly id = 'town';
  readonly title = 'Hearthvale Square';
  readonly grid = new TileGrid(TOWN_SIZE.w, TOWN_SIZE.d);
  readonly root = new THREE.Group();
  readonly spawn = { x: TOWN_SPAWN.x, z: TOWN_SPAWN.z, facing: 'right' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(10, 12), new THREE.Vector2(54, 38));
  readonly terrain: Terrain;
  readonly grass: GrassField;
  readonly warps: MapWarp[] = TOWN_WARPS;
  readonly poi: Record<string, { x: number; y?: number; z: number; rot?: number }[]> = {};
  private trees: TreeField;
  private nature: Nature;
  private rng: Rng;
  private noise: Noise2D;
  private streetSamples: { x: number; z: number; w: number }[] = [];
  private staticRoots: THREE.Object3D[] = [];
  private smoke: SmokeEmitter[] = [];
  private ambience: Ambience;
  private pools = new LightPools();
  private festival = new THREE.Group();

  constructor(private game: Game) {
    this.root.name = 'map:town';
    this.rng = game.rng.fork('town');
    this.noise = new Noise2D(this.rng.fork('n').seed);
    this.sampleStreets();
    this.terrain = new Terrain({ ...TOWN_EXTENT, step: 0.5, height: (x, z) => this.height(x, z), waterLevel: -5, pathTexture: textures.cobble().map, pathScale: 0.36 });
    this.root.add(this.terrain.mesh);
    this.terrain.paint('path', (x, z) => this.streetValue(x, z));
    this.terrain.commitSplat();
    this.terrain.paintCover('clover', (x, z) => smoothstep(0.62, 0.75, this.noise.fbm(x * 0.15 + 9, z * 0.15, 2) * 0.5 + 0.5) * (1 - this.streetValue(x, z)), { x0: -2, z0: -2, x1: 66, z1: 50 });
    this.classifyTiles();

    this.trees = new TreeField(this.rng.fork('trees'));
    this.nature = new Nature(this.rng.fork('nature'));
    this.buildBuildings();
    this.buildProps();
    this.placeTrees();
    this.placeNature();
    this.terrain.commitCover();
    this.trees.finalize();
    this.nature.finalize();
    this.trees.group.userData.perfTag = 'trees';
    this.nature.group.userData.perfTag = 'nature';
    this.root.add(this.trees.group, this.nature.group, this.pools.group);
    const merged = mergeStatic(this.staticRoots, 'town-static');
    merged.userData.perfTag = 'props';
    this.root.add(merged);
    this.festival.name = 'festival';
    this.festival.visible = false;
    this.root.add(this.festival);

    this.grass = new GrassField({
      bounds: { x0: -12, z0: -10, x1: 76, z1: 60 },
      density: (x, z) => this.grassDensity(x, z),
      tallness: (x, z) => 0.1 + 0.4 * smoothstep(0.1, 0.6, this.noise.fbm(x * 0.09, z * 0.09, 2)) * smoothstep(8, 14, Math.hypot(x - PLAZA.x, z - PLAZA.z)),
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
    this.poi.flowers = [{ x: 20.5, z: 19.2 }, { x: 43, z: 19.2 }, { x: 16, z: 35 }, { x: 48, z: 35 }, { x: PLAZA.x, z: PLAZA.z + 4 }];
    this.poi.birds = [{ x: 29.5, z: 28.5 }, { x: 35.5, z: 21.5 }];
  }

  // ───────────────────────────────────────────── shape

  private rimDist(x: number, z: number): number {
    const cx = 32;
    const cz = 24;
    const hx = 30;
    const hz = 21;
    const r = 8;
    const qx = Math.abs(x - cx) - (hx - r);
    const qz = Math.abs(z - cz) - (hz - r);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    return d + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.2;
  }

  private exitMask(x: number, z: number): number {
    return smoothstep(4.5, 2.8, Math.abs(z - 26)) * (smoothstep(4, -2, x) + smoothstep(58, 64, x));
  }

  private height(x: number, z: number): number {
    const d = this.rimDist(x, z);
    const n = this.noise;
    const hills = (smoothstep(-0.5, 5, d) * 1.6 + smoothstep(4, 20, d) * (2.5 + n.fbm(x * 0.04 + 5, z * 0.04, 3) * 3)) * (1 - Math.min(1, this.exitMask(x, z)));
    const ripple = n.fbm(x * 0.05 + 3, z * 0.05, 2) * 0.18 * smoothstep(6, 12, Math.hypot(x - PLAZA.x, z - PLAZA.z));
    // Hall sits on a slight rise.
    const rise = smoothstep(10, 4, Math.hypot((x - 32) * 0.7, z - 8)) * 0.35;
    return hills + ripple + rise;
  }

  private sampleStreets(): void {
    STREETS.forEach((pts, i) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const n = Math.ceil(curve.getLength() / 0.3);
      for (let k = 0; k <= n; k++) {
        const p = curve.getPointAt(k / n);
        const w = (i <= 1 ? 1.35 : i === 2 ? 1.25 : 0.95) + this.noise.get(p.x * 0.2, p.z * 0.2) * 0.12;
        this.streetSamples.push({ x: p.x, z: p.z, w });
      }
    });
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
    // Round plaza + a paved apron in front of the hall.
    const pd = Math.hypot(x - PLAZA.x, z - PLAZA.z) + this.noise.get(x * 0.5, z * 0.5) * 0.35;
    best = Math.max(best, smoothstep(PLAZA.r + 0.5, PLAZA.r - 0.3, pd));
    const hall = Math.max(Math.abs(x - 32) - 4.5, Math.abs(z - 13.4) - 1.1);
    best = Math.max(best, smoothstep(0.5, -0.2, hall));
    return best;
  }

  private classifyTiles(): void {
    const g = this.grid;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      g.height[i] = this.terrain.heightAt(cx, cz);
      const d = this.rimDist(cx, cz);
      if ((d > -0.2 && this.exitMask(cx, cz) < 0.5) || this.terrain.slopeAt(cx, cz) < 0.8) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      g.type[i] = this.terrain.splatAt(cx, cz, 'path') > 0.5 ? TileType.Stone : TileType.Grass;
    });
  }

  private grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.78) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.25) return 0;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (this.grid.inBounds(tx, tz) && this.grid.hasFlag(tx, tz, TileFlag.Blocked) && this.grid.getType(tx, tz) !== TileType.Cliff) return 0.3;
    const clump = smoothstep(-0.1, 0.5, this.noise.fbm(x * 0.13 + 4, z * 0.13, 2));
    return (3 + clump * 4.5) * (pv > 0.05 ? 0.55 : 1);
  }

  // ───────────────────────────────────────────── build

  private addProp(p: BuiltProp | THREE.Group, x: number, z: number, rot = 0, solid?: [number, number][], dynamic = false): BuiltProp {
    const bp: BuiltProp = p instanceof THREE.Group ? { group: p, lights: [], anchors: {} } : p;
    bp.group.position.set(x, this.terrain.heightAt(x, z) - 0.03, z);
    bp.group.rotation.y = rot;
    this.root.add(bp.group);
    if (!dynamic) this.staticRoots.push(bp.group);
    bp.group.updateMatrixWorld(true);
    for (const l of bp.lights) {
      l.light.castShadow = false;
      l.light.color.setHex(0xffb45e);
      l.light.distance = 6.5;
      l.light.decay = 2;
      this.game.lighting.addNightLight(l.light, Math.max(l.max, 6) * 1.6);
      const wp = l.light.getWorldPosition(new THREE.Vector3());
      this.pools.add(wp.x, wp.z, this.terrain.heightAt(wp.x, wp.z), Math.min(3.4, 1.4 + wp.y - this.terrain.heightAt(wp.x, wp.z)));
    }
    for (const [tx, tz] of solid ?? []) this.grid.setObject(tx, tz, { kind: 'prop', id: bp.group.name, solid: true });
    return bp;
  }

  private buildBuildings(): void {
    const r = this.rng.fork('buildings');
    for (const b of BUILDINGS) {
      const bp = b.kind === 'hall' ? buildLanternHall(r) : buildTownHouse(r, HOUSES[b.kind]);
      bp.group.name = b.id;
      this.addProp(bp, b.x, b.z, b.rot ?? 0);
      const [x0, z0, x1, z1] = b.block;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid.setFlag(x, z, TileFlag.Blocked);
      this.terrain.stampCover('ao', b.x, b.z + 0.3, (x1 - x0 + 1) * 0.62, 0.55, (z1 - z0 + 1) / (x1 - x0 + 1));
      if (bp.anchors.chimney && b.kind !== 'store') {
        const s = new SmokeEmitter(bp.anchors.chimney.clone().applyMatrix4(bp.group.matrixWorld), b.kind === 'bakery' ? 6 : 3.5);
        this.smoke.push(s);
        this.root.add(s.object);
      }
      if (bp.anchors.door) {
        const d = bp.anchors.door.clone().applyMatrix4(bp.group.matrixWorld);
        (this.poi[b.id] ??= []).push({ x: d.x, z: d.z });
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
      }
      this.addProp(g, p.x, p.z, p.rot ?? 0, p.solid);
      if (p.kind !== 'hedge') this.terrain.stampCover('ao', p.x, p.z, p.kind === 'fountain' ? 2.8 : p.kind === 'marketStall' ? 1.6 : 0.6, 0.6);
    }
    // Fountain collision: every tile whose centre is inside the basin.
    this.grid.forEach((x, z) => {
      if (Math.hypot(x + 0.5 - PLAZA.x, z + 0.5 - PLAZA.z) < 2.45) this.grid.setObject(x, z, { kind: 'prop', id: 'fountain', solid: true });
    });
    // Festival bunting + paper lanterns (hidden until a festival).
    for (const [a, b] of BUNTING) {
      const s = buildFestivalString(r, new THREE.Vector3(a[0], a[1] + this.terrain.heightAt(a[0], a[2]), a[2]), new THREE.Vector3(b[0], b[1] + this.terrain.heightAt(b[0], b[2]), b[2]));
      this.festival.add(s);
    }
    this.poi.plaza = [{ x: PLAZA.x, z: PLAZA.z }];
  }

  private placeTrees(): void {
    const r = this.rng.fork('trees');
    for (const [sp, x, z, s] of TOWN_TREES) {
      const h = this.trees.add(sp, x, this.terrain.heightAt(x, z) - 0.05, z, s);
      this.grid.setObject(Math.floor(x), Math.floor(z), { kind: 'tree', id: sp, solid: true, onRemove: () => this.trees.remove(h) });
      this.terrain.stampCover('ao', x, z, 1.1 * s, 0.7);
    }
    for (let z = -18; z < 66; z += 2.4) {
      for (let x = -18; x < 82; x += 2.4) {
        const jx = x + (r.next() - 0.5) * 2;
        const jz = z + (r.next() - 0.5) * 2;
        const d = this.rimDist(jx, jz);
        if (d < 1.2 || this.exitMask(jx, jz) > 0.2 || r.next() < 0.2) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.75) continue;
        const sp = r.next() < 0.35 ? 'pine' : r.next() < 0.5 ? 'oak' : r.next() < 0.75 ? 'maple' : 'blossom';
        this.trees.add(sp, jx, this.terrain.heightAt(jx, jz) - 0.08, jz, 0.85 + r.next() * 0.45, undefined, d > 3.5 ? 1 : 0);
      }
    }
  }

  private placeNature(): void {
    const r = this.rng.fork('nature');
    const g = this.grid;
    // Flower beds along building fronts + scattered wildflowers, bushes at the rim.
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
    // Flower beds in front of the store / bakery / cottages.
    for (const [x0, x1, z] of [[17.2, 23.8, 19.0], [40.2, 46.2, 19.0], [13.4, 18.6, 34.9], [45.4, 50.6, 34.9]] as const) {
      for (let x = x0; x <= x1; x += 0.55) {
        const c = [0xff8fab, 0xffd166, 0xffffff, 0xc77dff][Math.floor(r.next() * 4)]!;
        this.nature.place('flower', x, this.terrain.heightAt(x, z), z + (r.next() - 0.5) * 0.3, { color: c, scale: 1.15 });
      }
    }
  }

  // ───────────────────────────────────────────── runtime

  /** Festival dressing (bunting + paper lanterns) on / off. */
  setFestival(on: boolean): void {
    this.festival.visible = on;
  }

  heightAt(x: number, z: number): number {
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
