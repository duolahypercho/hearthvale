/**
 * The farm: grandmother's overgrown homestead in a cliff-ringed basin (64×64 tiles).
 *
 * Layout (tile coords, +X east, +Z south/towards camera):
 *   - Farmhouse centered x≈31.5, z≈13.5, porch facing south; shipping bin east of the porch.
 *   - Path from the porch winding south-east to the east exit (→ town) and south to the bottom exit.
 *   - Pond in the south-west with a little dock; fenced garden plot west of the house.
 *   - Field (x 14..58, z 21..58) overgrown with weeds, stones, twigs, stumps.
 *   - Cliffs with stone strata ring the basin; forested plateau and rolling hills beyond.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import { Rng, hash2 } from '../core/rng';
import { Noise2D, smoothstep, clamp } from '../core/noise';
import type { Season, Weather } from '../core/time';
import type { GameMap } from './map';
import { TileGrid, TileType, TileFlag } from './tiles';
import { Terrain, SPLAT_RES } from './terrain';
import { createWater } from './water';
import { GrassField } from './grass';
import { TreeField, type TreeSpecies } from './props/trees';
import { Nature, type NatureKind } from './props/nature';
import {
  buildFarmhouse,
  buildShippingBin,
  buildMailbox,
  buildLanternPost,
  buildWoodpile,
  buildChoppingBlock,
  buildCrate,
  buildBarrel,
  buildFence,
  buildDock,
  type BuiltProp,
} from './props/structures';
import { SmokeEmitter, Ambience } from '../render/particles';

export const FARM_SIZE = 64;
const EXT = { minX: -26, minZ: -26, maxX: 90, maxZ: 90 };
export const FARM_WATER_LEVEL = -0.32;

const HOUSE = { x: 31.5, z: 13.5 };
const POND = { x: 13, z: 40, r: 5.2 };
const PLOT = { x0: 21, z0: 13, x1: 25, z1: 16 };
const BIN = { x: 38, z: 16.5 };

const PATHS: [number, number][][] = [
  // porch → east exit
  [[31.5, 18.2], [31.6, 21.5], [33.2, 25.2], [37.5, 27.8], [44, 28.2], [50, 27.6], [56, 28.6], [62, 28.5], [70, 28.2], [80, 28.8]],
  // junction → south exit
  [[33.2, 25.2], [31.8, 30], [31.4, 36], [33.6, 42], [34.2, 48], [32.8, 54], [33.2, 60], [33.4, 70], [33, 82]],
  // little spur to the pond dock
  [[31.6, 33.5], [27.5, 36.5], [23, 39.2], [19.5, 40]],
  // path to shipping bin
  [[32.2, 19.6], [35, 19.2], [37.8, 18.2]],
];

export class FarmMap implements GameMap {
  readonly id = 'farm';
  readonly grid = new TileGrid(FARM_SIZE, FARM_SIZE);
  readonly root = new THREE.Group();
  readonly spawn = { x: 31.5, z: 19.5, facing: 'down' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(9, 10), new THREE.Vector2(55, 58));
  readonly terrain: Terrain;
  readonly grass: GrassField;
  readonly trees: TreeField;
  readonly nature: Nature;
  private smoke: SmokeEmitter[] = [];
  private ambience: Ambience;
  private noise: Noise2D;
  private noise2: Noise2D;
  private pathSamples: { x: number; z: number; w: number }[] = [];
  private rng: Rng;

  constructor(private game: Game) {
    this.root.name = 'map:farm';
    const T = performance.now();
    const mark = (label: string) => console.debug(`[farm] ${label} ${(performance.now() - T).toFixed(0)}ms`);
    this.rng = game.rng.fork('farm');
    this.noise = new Noise2D(this.rng.fork('n1').seed);
    this.noise2 = new Noise2D(this.rng.fork('n2').seed);
    this.samplePaths();

    this.terrain = new Terrain({ ...EXT, step: 0.5, height: (x, z) => this.height(x, z), waterLevel: FARM_WATER_LEVEL });
    this.root.add(this.terrain.mesh);
    mark('terrain');
    this.paintSplat();
    mark('splat');
    this.classifyTiles();
    mark('tiles');

    this.root.add(createWater(this.terrain, { x0: POND.x - 8, z0: POND.z - 8, x1: POND.x + 8, z1: POND.z + 8 }, FARM_WATER_LEVEL));

    this.trees = new TreeField(this.rng.fork('trees'));
    this.nature = new Nature(this.rng.fork('nature'));
    this.buildStructures();
    mark('structures');
    this.placeTrees();
    mark('trees');
    this.placeNature();
    mark('nature');
    this.trees.finalize();
    this.nature.finalize();
    this.root.add(this.trees.group, this.nature.group);

    this.grass = new GrassField({
      bounds: { x0: -16, z0: -14, x1: 80, z1: 80 },
      density: (x, z) => this.grassDensity(x, z),
      tallness: (x, z) => 0.12 + 0.55 * smoothstep(0.1, 0.6, this.noise2.fbm(x * 0.09, z * 0.09, 2)),
      height: (x, z) => this.terrain.heightAt(x, z),
      seed: 'farm-grass',
      densityScale: game.rc.preset.grassDensity,
    });
    this.root.add(this.grass.group);
    mark(`grass (${this.grass.instanceCount})`);

    this.ambience = new Ambience((x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.ambience.group);
  }

  // ───────────────────────────────────────────── terrain shape

  private basinDist(x: number, z: number): number {
    const cx = 32;
    const cz = 33;
    const hx = 29;
    const hz = 27.5;
    const r = 7;
    const qx = Math.abs(x - cx) - (hx - r);
    const qz = Math.abs(z - cz) - (hz - r);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
    const d = outside + Math.min(Math.max(qx, qz), 0) - r;
    return d + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.4 + this.noise2.get(x * 0.35, z * 0.35) * 0.45;
  }

  private exitMask(x: number, z: number): number {
    const south = smoothstep(4.2, 2.6, Math.abs(x - 33.2)) * smoothstep(52, 58, z);
    const east = smoothstep(4.2, 2.6, Math.abs(z - 28.5)) * smoothstep(54, 60, x);
    return Math.max(south, east);
  }

  private height(x: number, z: number): number {
    const d = this.basinDist(x, z);
    const n = this.noise;
    const cliff1 = smoothstep(-0.2, 1.1, d) * 2.5;
    const t2 = smoothstep(7.5, 8.7, d + n.get(x * 0.05 + 40, z * 0.05) * 3) * 2.1;
    const hills = smoothstep(11, 26, d) * (1.5 + n.fbm(x * 0.03 + 9, z * 0.03, 3) * 3);
    const bumps = smoothstep(1.5, 3.5, d) * n.fbm(x * 0.15, z * 0.15, 2) * 0.35;
    let h = (cliff1 + t2 + hills + bumps) * (1 - this.exitMask(x, z));
    // Gentle interior undulation, flattened around the house yard.
    const yard = smoothstep(9, 5, Math.hypot((x - HOUSE.x) * 0.8, z - HOUSE.z - 1.5));
    h += n.fbm(x * 0.06 + 3, z * 0.06, 2) * 0.12 * (1 - yard) * smoothstep(0.5, -2, d);
    // Pond bowl
    const pr = Math.hypot(x - POND.x, (z - POND.z) * 1.1) + n.get(x * 0.25, z * 0.25) * 0.9;
    h -= smoothstep(POND.r + 1.2, POND.r - 2.6, pr) * 1.35;
    return h;
  }

  // ───────────────────────────────────────────── paths & splat

  private samplePaths(): void {
    for (const pts of PATHS) {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const len = curve.getLength();
      const n = Math.ceil(len / 0.3);
      for (let i = 0; i <= n; i++) {
        const p = curve.getPointAt(i / n);
        const w = 0.72 + this.noise2.get(p.x * 0.2, p.z * 0.2) * 0.22 + (pts === PATHS[3] || pts === PATHS[2] ? -0.12 : 0);
        this.pathSamples.push({ x: p.x, z: p.z, w });
      }
    }
  }

  /** 0..1 path strength at a world point. */
  pathValue(x: number, z: number): number {
    let best = 0;
    for (const s of this.pathSamples) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (Math.abs(dx) > 2.2 || Math.abs(dz) > 2.2) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      const v = smoothstep(s.w + 0.75, s.w - 0.35, d);
      if (v > best) best = v;
    }
    // Packed-dirt yard in front of the porch.
    const yd = Math.hypot((x - HOUSE.x) / 2.6, (z - 18.9) / 1.35);
    best = Math.max(best, smoothstep(1.25, 0.75, yd));
    return best;
  }

  private paintSplat(): void {
    const t = this.terrain;
    t.paint('path', (x, z) => this.pathValue(x, z));
    // Wet sand ring around the pond.
    t.paint('sand', (x, z) => {
      const pr = Math.hypot(x - POND.x, (z - POND.z) * 1.1);
      return smoothstep(POND.r + 1.3, POND.r + 0.3, pr) * 0.9;
    });
    for (let z = PLOT.z0; z <= PLOT.z1; z++) {
      for (let x = PLOT.x0; x <= PLOT.x1; x++) {
        t.setTileSplat(x, z, { tilled: 1, wet: hash2(x, z, 7) < 0.45 ? 1 : 0 });
      }
    }
    t.commitSplat();
  }

  private classifyTiles(): void {
    const g = this.grid;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const h = this.terrain.heightAt(cx, cz);
      g.height[i] = h;
      const d = this.basinDist(cx, cz);
      const exit = this.exitMask(cx, cz);
      const slope = this.terrain.slopeAt(cx, cz);
      if ((d > 0.1 && exit < 0.5) || slope < 0.8) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      if (h < FARM_WATER_LEVEL - 0.08) {
        g.type[i] = TileType.Water;
        g.flags[i] = TileFlag.WaterSource;
        return;
      }
      const pv = this.terrain.splatAt(cx, cz, 'path');
      if (pv > 0.5) {
        g.type[i] = TileType.Path;
        return;
      }
      g.type[i] = TileType.Grass;
      g.flags[i] = TileFlag.Tillable;
      if (this.terrain.splatAt(cx, cz, 'tilled') > 0.5) {
        g.type[i] = TileType.Dirt;
        g.flags[i] = TileFlag.Tillable | TileFlag.Tilled | (this.terrain.splatAt(cx, cz, 'wet') > 0.5 ? TileFlag.Watered : 0);
      }
    });
  }

  private blockRect(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid.setFlag(x, z, TileFlag.Blocked);
  }

  private free(x: number, z: number): boolean {
    const g = this.grid;
    return g.inBounds(x, z) && g.isWalkable(x, z) && g.getType(x, z) === TileType.Grass && !g.getObject(x, z);
  }

  // ───────────────────────────────────────────── structures

  private addProp(p: BuiltProp | THREE.Group, x: number, z: number, rotY = 0): BuiltProp {
    const bp: BuiltProp = p instanceof THREE.Group ? { group: p, lights: [], anchors: {} } : p;
    bp.group.position.set(x, this.terrain.heightAt(x, z), z);
    bp.group.rotation.y = rotY;
    this.root.add(bp.group);
    for (const l of bp.lights) {
      l.light.castShadow = false;
      this.game.lighting.addNightLight(l.light, l.max);
    }
    return bp;
  }

  private buildStructures(): void {
    const r = this.rng.fork('structures');
    const house = this.addProp(buildFarmhouse(r), HOUSE.x, HOUSE.z);
    this.blockRect(28, 11, 35, 15);
    this.blockRect(29, 16, 33, 17);
    this.blockRect(27, 16, 27, 16);
    this.grid.setObject(31, 17, { kind: 'building', id: 'farmhouse_door', solid: true });
    const chim = house.anchors.chimney!.clone().add(house.group.position);
    const smoke = new SmokeEmitter(chim, 4.5);
    this.smoke.push(smoke);
    this.root.add(smoke.object);

    this.addProp(buildShippingBin(), BIN.x, BIN.z);
    for (const x of [37, 38]) this.grid.setObject(x, 16, { kind: 'building', id: 'shipping_bin', solid: true });

    this.addProp(buildMailbox(), 35.7, 18.7, -0.2);
    this.grid.setObject(35, 18, { kind: 'prop', id: 'mailbox', solid: true });

    this.addProp(buildLanternPost(), 29.4, 18.9, Math.PI);
    this.grid.setObject(29, 18, { kind: 'prop', id: 'lantern', solid: true });
    this.addProp(buildLanternPost(), 35.4, 25.6, 0);
    this.grid.setObject(35, 25, { kind: 'prop', id: 'lantern', solid: true });

    this.addProp(buildWoodpile(r), 41.2, 12.4, -0.15);
    this.blockRect(40, 12, 41, 12);
    this.addProp(buildChoppingBlock(), 40.2, 14.6);
    this.grid.setObject(40, 14, { kind: 'prop', id: 'chopping_block', solid: true });
    this.addProp(buildCrate(), 38.9, 12.0, 0.3);
    this.addProp(buildCrate(), 39.1, 12.1, 0.1).group.position.y += 0.6;
    this.addProp(buildBarrel(), 38.2, 13.1);
    this.blockRect(38, 12, 39, 13);

    // Fenced garden plot (west of house) with a gate gap facing the path.
    const fx0 = PLOT.x0 - 0.5;
    const fx1 = PLOT.x1 + 1.5;
    const fz0 = PLOT.z0 - 0.5;
    const fz1 = PLOT.z1 + 1.5;
    const run: [number, number][] = [];
    for (let x = 23.5; x >= fx0; x -= 1) run.push([x, fz1]);
    for (let z = fz1 - 1; z >= fz0; z -= 1) run.push([fx0, z]);
    for (let x = fx0 + 1; x <= fx1; x += 1) run.push([x, fz0]);
    for (let z = fz0 + 1; z <= fz1; z += 1) run.push([fx1, z]);
    for (let x = fx1 - 1; x >= 24.5; x -= 1) run.push([x, fz1]);
    this.root.add(buildFence([run], (x, z) => this.terrain.heightAt(x, z), r));
    for (let x = PLOT.x0 - 1; x <= PLOT.x1 + 1; x++) {
      for (const z of [PLOT.z0 - 1, PLOT.z1 + 1]) {
        if (z === PLOT.z1 + 1 && (x === 23 || x === 24)) continue;
        this.grid.setObject(x, z, { kind: 'fence', id: 'wood_fence', solid: true });
      }
    }
    for (let z = PLOT.z0; z <= PLOT.z1; z++) {
      for (const x of [PLOT.x0 - 1, PLOT.x1 + 1]) this.grid.setObject(x, z, { kind: 'fence', id: 'wood_fence', solid: true });
    }
    // Fence along the path towards the east exit.
    const eastFence: [number, number][] = [];
    for (let x = 45; x <= 55; x += 1.25) eastFence.push([x, 26.2 + Math.sin(x * 0.4) * 0.15]);
    this.root.add(buildFence([eastFence], (x, z) => this.terrain.heightAt(x, z), r));

    // Dock on the pond.
    const dock = buildDock(3.2, 1.3);
    dock.position.set(POND.x + POND.r + 1.5, FARM_WATER_LEVEL + 0.18, POND.z);
    this.root.add(dock);
  }

  // ───────────────────────────────────────────── trees & nature

  private placeTrees(): void {
    const r = this.rng.fork('tree-place');
    const heroes: [TreeSpecies, number, number, number][] = [
      ['oak', 22.5, 9.6, 1.15],
      ['maple', 42.5, 9.2, 1.05],
      ['blossom', 18.6, 20.4, 0.95],
      ['oak', 6.8, 33.5, 1.2],
      ['maple', 19.5, 47.5, 1.0],
      ['oak', 8.2, 50, 1.1],
      ['pine', 55.5, 13.5, 1.0],
      ['oak', 58, 40, 1.15],
      ['maple', 50.5, 55, 1.0],
      ['pine', 9.5, 19.5, 1.05],
      ['blossom', 46.5, 21.5, 0.9],
      ['oak', 15.5, 55.5, 1.05],
      ['pine', 5.8, 26.2, 0.95],
      ['maple', 60.2, 50.5, 1.05],
    ];
    for (const [sp, x, z, s] of heroes) {
      const h = this.trees.add(sp, x, this.terrain.heightAt(x, z) - 0.05, z, s);
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      this.grid.setObject(tx, tz, { kind: 'tree', id: sp, solid: true, hp: 10, onRemove: () => this.trees.remove(h) });
    }
    // Forest on the plateau and hills.
    const step = 2.5;
    for (let z = -20; z < 86; z += step) {
      for (let x = -22; x < 86; x += step) {
        const jx = x + (r.next() - 0.5) * step * 0.9;
        const jz = z + (r.next() - 0.5) * step * 0.9;
        const d = this.basinDist(jx, jz);
        if (d < 1.6) continue;
        if (this.exitMask(jx, jz) > 0.2) continue;
        const clearing = this.noise2.fbm(jx * 0.05, jz * 0.05, 2);
        if (clearing < -0.25 && d < 12) continue;
        if (r.next() < 0.18) continue;
        const slope = this.terrain.slopeAt(jx, jz);
        if (slope < 0.75) continue;
        const pineBias = smoothstep(-0.2, 0.4, this.noise.get(jx * 0.04 + 100, jz * 0.04));
        const sp: TreeSpecies = r.next() < pineBias * 0.8 ? 'pine' : r.next() < 0.55 ? 'oak' : r.next() < 0.8 ? 'maple' : 'blossom';
        const s = 0.85 + r.next() * 0.45;
        this.trees.add(sp, jx, this.terrain.heightAt(jx, jz) - 0.08, jz, s);
      }
    }
  }

  private placeNature(): void {
    const r = this.rng.fork('nature-place');
    const g = this.grid;
    const place = (kind: NatureKind, x: number, z: number, opts: { scale?: number; color?: number; solid?: boolean; register?: boolean; hp?: number } = {}) => {
      const h = this.nature.place(kind, x, this.terrain.heightAt(x, z), z, { scale: opts.scale, color: opts.color });
      if (opts.register) {
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        const objKind = kind === 'weed' ? 'weed' : kind === 'stone' ? 'stone' : kind === 'twig' ? 'twig' : kind === 'stump' ? 'stump' : kind === 'boulder' ? 'boulder' : kind === 'log' ? 'stump' : 'bush';
        g.setObject(tx, tz, { kind: objKind, id: kind, solid: opts.solid ?? true, hp: opts.hp, onRemove: () => this.nature.remove(h) });
      }
      return h;
    };

    // Hand-placed dressing around the house.
    place('bush', 27.0, 16.5, { register: true, scale: 1.0 });
    place('berryBush', 26.7, 11.5, { register: true, scale: 1.1, color: 0xd6344a });
    place('bush', 36.3, 11.3, { register: true, scale: 0.9 });
    place('bush', 42.3, 16.5, { register: true, scale: 1.05 });
    for (const [x, z, c] of [[28.1, 17.2, 0xff8fab], [28.6, 17.6, 0xffd166], [34.8, 17.3, 0xffffff], [34.4, 17.8, 0xc77dff], [30.2, 19.8, 0xff8fab], [33.5, 19.9, 0xffd166]] as const) {
      place('flower', x, z, { color: c, scale: 1.1 });
    }
    // Reeds, lilies and stones around the pond.
    for (let i = 0; i < 26; i++) {
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
      this.nature.place('lilypad', x, FARM_WATER_LEVEL + 0.01, z, { scale: 0.8 + r.next() * 0.6 });
    }

    // Field debris + wild flowers + cliff-base dressing.
    for (let z = 0; z < FARM_SIZE; z++) {
      for (let x = 0; x < FARM_SIZE; x++) {
        const cx = x + 0.5;
        const cz = z + 0.5;
        const d = this.basinDist(cx, cz);
        if (!this.free(x, z)) continue;
        const nearHouse = Math.hypot((cx - HOUSE.x) * 0.8, cz - HOUSE.z - 1) < 7.5;
        const nearPlot = cx > PLOT.x0 - 1.5 && cx < PLOT.x1 + 2.5 && cz > PLOT.z0 - 1.5 && cz < PLOT.z1 + 2.5;
        const pv = this.terrain.splatAt(cx, cz, 'path');
        const nearPath = this.pathValue(cx, cz) > 0.15 || pv > 0.1;
        const pondD = Math.hypot(cx - POND.x, (cz - POND.z) * 1.1);
        const ox = cx + (r.next() - 0.5) * 0.4;
        const oz = cz + (r.next() - 0.5) * 0.4;
        // Cliff base: boulders, bushes, ferns.
        if (d > -1.8 && d < -0.2) {
          const roll = r.next();
          if (roll < 0.07) place('boulder', ox, oz, { register: true, scale: 0.7 + r.next() * 0.6 });
          else if (roll < 0.19) place(r.next() < 0.25 ? 'berryBush' : 'bush', ox, oz, { register: true, scale: 0.8 + r.next() * 0.45, color: 0x4a6ad8 });
          else if (roll < 0.3) place('fern', ox, oz, { scale: 0.9 + r.next() * 0.5 });
          continue;
        }
        if (nearHouse || nearPlot || nearPath || pondD < POND.r + 1.4) {
          if (!nearHouse && !nearPath && r.next() < 0.05) place('flower', ox, oz, { color: this.flowerColor(cx, cz) });
          continue;
        }
        const inField = cx > 12 && cx < 60 && cz > 20 && cz < 60;
        const wild = 0.5 + 0.5 * this.noise2.fbm(cx * 0.1, cz * 0.1, 2);
        const roll = r.next();
        if (inField) {
          if (roll < 0.1 * (0.6 + wild)) place('weed', ox, oz, { register: true, solid: false, scale: 0.85 + r.next() * 0.35, hp: 1 });
          else if (roll < 0.15 * (0.6 + wild) + 0.0) place('stone', ox, oz, { register: true, scale: 0.9 + r.next() * 0.5, hp: 1 });
          else if (roll < 0.18 * (0.6 + wild)) place('twig', ox, oz, { register: true, hp: 1 });
          else if (roll < 0.186 * (0.6 + wild)) place(r.next() < 0.7 ? 'stump' : 'log', cx, cz, { register: true, hp: 5 });
          else if (roll < 0.25 + wild * 0.12) {
            place('flower', ox, oz, { color: this.flowerColor(cx, cz) });
            if (r.next() < 0.5) place('flower', cx + (r.next() - 0.5) * 0.8, cz + (r.next() - 0.5) * 0.8, { color: this.flowerColor(cx, cz), scale: 0.8 });
          }
          else if (roll < 0.262) place('mushroom', ox, oz);
        } else {
          if (roll < 0.06) place('weed', ox, oz, { register: true, solid: false, hp: 1 });
          else if (roll < 0.16) place('flower', ox, oz, { color: this.flowerColor(cx, cz) });
          else if (roll < 0.18) place('bush', ox, oz, { register: true, scale: 0.8 + r.next() * 0.4 });
          else if (roll < 0.2) place('stone', ox, oz, { register: true, hp: 1 });
        }
      }
    }
    // Plateau dressing (outside the grid, purely visual).
    for (let i = 0; i < 900; i++) {
      const x = -18 + r.next() * 100;
      const z = -18 + r.next() * 100;
      const d = this.basinDist(x, z);
      if (d < 1.4 || this.terrain.slopeAt(x, z) < 0.8) continue;
      const roll = r.next();
      const kind: NatureKind = roll < 0.35 ? 'bush' : roll < 0.55 ? 'fern' : roll < 0.75 ? 'flower' : roll < 0.87 ? 'stone' : roll < 0.95 ? 'boulder' : 'mushroom';
      this.nature.place(kind, x, this.terrain.heightAt(x, z), z, { color: kind === 'flower' ? this.flowerColor(x, z) : undefined, scale: 0.8 + r.next() * 0.5 });
    }
  }

  private flowerColor(x: number, z: number): number {
    const palette = [0xffffff, 0xffd166, 0xff8fab, 0xc77dff, 0x7ec8ff, 0xff9f1c];
    const n = this.noise.get(x * 0.08 + 50, z * 0.08);
    const idx = Math.floor(clamp((n + 1) / 2, 0, 0.999) * palette.length);
    return hash2(Math.floor(x), Math.floor(z), 3) < 0.2 ? palette[(idx + 2) % palette.length]! : palette[idx]!;
  }

  private grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.78) return 0;
    const h = t.heightAt(x, z);
    if (h < FARM_WATER_LEVEL + 0.12) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.3) return 0;
    if (t.splatAt(x, z, 'tilled') > 0.2) return 0;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (this.grid.inBounds(tx, tz) && this.grid.hasFlag(tx, tz, TileFlag.Blocked) && this.grid.getType(tx, tz) !== TileType.Cliff) return 0.4;
    const clump = smoothstep(-0.1, 0.5, this.noise2.fbm(x * 0.13, z * 0.13, 2));
    const edge = pv > 0.05 ? 0.6 : 1;
    return (3.2 + clump * 5.5) * edge;
  }

  // ───────────────────────────────────────────── runtime

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  update(dt: number, game: Game): void {
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

  /** Splat texels per tile (for farming teams painting soil). */
  static readonly splatRes = SPLAT_RES;

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
  }
}
