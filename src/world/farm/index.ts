/**
 * The farm: grandmother's overgrown homestead in a cliff-ringed basin (64×64 tiles).
 *
 * Assembly only — the pieces live next door:
 *   data/farm-layout.ts   anchors, paths, hero trees, prop vignettes, overgrowth weights (edit me)
 *   farm/paint.ts         terrain shape, splat + ground-cover masks, grass density
 *   farm/layout.ts        structures, vignettes (+ contact AO), trees, pond / cliff dressing
 *   farm/overgrowth.ts    seeded Poisson-disk debris scatter (clearable tiles)
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { Rng } from '../../core/rng';
import type { Season, Weather } from '../../core/time';
import type { GameMap } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Terrain, SPLAT_RES } from '../terrain';
import { createWater } from '../water';
import { GrassField } from '../grass';
import { TreeField } from '../props/trees';
import { Nature } from '../props/nature';
import type { BuiltProp } from '../props/structures';
import { SmokeEmitter, Ambience, Bees } from '../../render/particles';
import { mergeStatic } from '../geom';
import { LeafLitter, LightPools, Footprints } from '../props/decals';
import { FARM_SIZE, FARM_EXTENT, FARM_WATER_LEVEL, POND, PLOT, FIELD, VIGNETTES, SNOW_TRAIL, FARM_POI } from '../../data/farm-layout';
import { FarmShape } from './paint';
import { buildStructures, buildVignettes, placeTrees, placeNature, type FarmBuildCtx } from './layout';
import { scatterOvergrowth } from './overgrowth';

export { FARM_SIZE, FARM_WATER_LEVEL };

export class FarmMap implements GameMap, FarmBuildCtx {
  readonly id = 'farm';
  readonly grid = new TileGrid(FARM_SIZE, FARM_SIZE);
  readonly root = new THREE.Group();
  readonly spawn = { x: 31.5, z: 19.5, facing: 'down' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(9, 10), new THREE.Vector2(55, 58));
  readonly title = "Rosalind's Farm";
  /** East exit → the town square. */
  readonly warps = [{ x0: 63, z0: 25, x1: 63, z1: 32, to: 'town', x: 2.8, z: 26.2, facing: 'right' as const }];
  readonly terrain: Terrain;
  readonly grass: GrassField;
  readonly trees: TreeField;
  readonly nature: Nature;
  readonly shape: FarmShape;
  readonly rng: Rng;
  readonly plots = { garden: PLOT, field: FIELD };
  readonly poi: Record<string, { x: number; y?: number; z: number; rot?: number }[]> = { ...FARM_POI };
  readonly smokeAnchors: THREE.Vector3[] = [];
  readonly leafSpots: { x: number; z: number; r: number }[] = [];
  mailFlag: THREE.Object3D | null = null;
  /** Debris scatter stats (debug / tests). */
  overgrowth = { placed: 0, byPiece: {} as Record<string, number> };
  private litter: LeafLitter;
  private footprints: Footprints;
  private pools: LightPools;
  private bees: Bees;
  private seasonal: { group: THREE.Object3D; seasons: Season[] }[] = [];
  private staticRoots: THREE.Object3D[] = [];
  private smoke: SmokeEmitter[] = [];
  private ambience: Ambience;

  constructor(private game: Game) {
    this.root.name = 'map:farm';
    const T = performance.now();
    const mark = (label: string) => console.debug(`[farm] ${label} ${(performance.now() - T).toFixed(0)}ms`);
    this.rng = game.rng.fork('farm');
    this.shape = new FarmShape(this.rng);

    this.terrain = new Terrain({ ...FARM_EXTENT, step: 0.5, height: (x, z) => this.shape.height(x, z), waterLevel: FARM_WATER_LEVEL });
    this.root.add(this.terrain.mesh);
    mark('terrain');
    const patches = VIGNETTES.flatMap((v) => v.ground);
    this.shape.paintSplat(this.terrain, patches);
    this.shape.paintCover(this.terrain, patches);
    mark('splat + cover');
    this.classifyTiles();
    mark('tiles');

    this.root.add(createWater(this.terrain, { x0: POND.x - 8, z0: POND.z - 8, x1: POND.x + 8, z1: POND.z + 8 }, FARM_WATER_LEVEL));

    this.trees = new TreeField(this.rng.fork('trees'));
    this.nature = new Nature(this.rng.fork('nature'));
    this.pools = new LightPools();
    buildStructures(this);
    buildVignettes(this, this.nature);
    for (const a of this.smokeAnchors) {
      const smoke = new SmokeEmitter(a, 4.5);
      this.smoke.push(smoke);
      this.root.add(smoke.object);
    }
    this.footprints = new Footprints(SNOW_TRAIL, (x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.footprints.mesh);
    mark('structures');
    placeTrees(this, this.trees);
    mark('trees');
    placeNature(this, this.nature);
    this.overgrowth = scatterOvergrowth(this.rng.fork('overgrowth'), this.shape, this.terrain, this.grid, this.nature);
    mark(`nature (+${this.overgrowth.placed} debris)`);
    this.terrain.commitCover();
    this.trees.finalize();
    this.nature.finalize();
    this.root.add(this.trees.group, this.nature.group);
    this.trees.group.userData.perfTag = 'trees';
    this.nature.group.userData.perfTag = 'nature';
    this.bakeSnowDrifts();
    // Merge every static prop into one mesh per material (draw-call budget).
    const merged = mergeStatic(this.staticRoots, 'farm-static');
    merged.userData.perfTag = 'props';
    this.root.add(merged);
    this.litter = new LeafLitter(this.rng.fork('litter'), this.leafSpots, (x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.litter.mesh, this.pools.group);

    this.grass = new GrassField({
      bounds: { x0: -16, z0: -14, x1: 80, z1: 80 },
      density: (x, z) => this.shape.grassDensity(this.terrain, this.grid, x, z),
      tallness: (x, z) => this.shape.tallness(x, z),
      height: (x, z) => this.terrain.heightAt(x, z),
      seed: 'farm-grass',
      densityScale: game.rc.preset.grassDensity,
      cover: this.terrain,
    });
    this.root.add(this.grass.group);
    mark(`grass (${this.grass.instanceCount})`);

    this.ambience = new Ambience((x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.ambience.group);
    this.bees = new Bees(FARM_POI.bees ?? [], (x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.bees.object);
  }

  // ───────────────────────────────────────────── FarmBuildCtx

  addProp(p: BuiltProp | THREE.Group, x: number, z: number, rotY = 0, opts: { solid?: [number, number][]; dynamic?: boolean } = {}): BuiltProp {
    const bp: BuiltProp = p instanceof THREE.Group ? { group: p, lights: [], anchors: {} } : p;
    bp.group.position.set(x, this.terrain.heightAt(x, z), z);
    bp.group.rotation.y = rotY;
    this.root.add(bp.group);
    if (!opts.dynamic) this.staticRoots.push(bp.group);
    this.countTris(bp.group);
    bp.group.updateMatrixWorld(true);
    for (const l of bp.lights) {
      l.light.castShadow = false;
      // Warm practical pools (#ffb45e): short physical falloff so a lamp lights its porch / post
      // and a painted ground glow, never the whole yard (and never blows out snow).
      l.light.color.setHex(0xffb45e);
      l.light.distance = 6.5;
      l.light.decay = 2;
      this.game.lighting.addNightLight(l.light, Math.max(l.max, 6) * 1.6);
      const wp = l.light.getWorldPosition(new THREE.Vector3());
      this.pools.add(wp.x, wp.z, this.terrain.heightAt(wp.x, wp.z), Math.min(3.4, 1.4 + wp.y - this.terrain.heightAt(wp.x, wp.z)));
    }
    for (const [tx, tz] of opts.solid ?? []) this.grid.setObject(tx, tz, { kind: 'prop', id: bp.group.name, solid: true });
    return bp;
  }

  /** Seasonal prop: only visible in the given seasons. */
  seasonalProp(g: THREE.Group, x: number, z: number, rot: number, seasons: Season[], solid?: [number, number][]): void {
    this.addProp(g, x, z, rot, { dynamic: true, solid });
    this.seasonal.push({ group: g, seasons });
  }

  addStatic(o: THREE.Object3D): void {
    this.root.add(o);
    this.staticRoots.push(o);
    this.countTris(o);
  }

  /** Triangles per static prop name (debug: which props eat the budget). */
  readonly propTris: Record<string, number> = {};
  private countTris(o: THREE.Object3D): void {
    let n = 0;
    o.traverse((m) => {
      const g = (m as THREE.Mesh).geometry;
      if (g) n += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    });
    this.propTris[o.name] = (this.propTris[o.name] ?? 0) + Math.round(n);
  }

  // ───────────────────────────────────────────── tiles

  private classifyTiles(): void {
    const g = this.grid;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const h = this.terrain.heightAt(cx, cz);
      g.height[i] = h;
      const d = this.shape.basinDist(cx, cz);
      const exit = this.shape.exitMask(cx, cz);
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

  /** Winter drifts: distance field (in tiles) from buildings / fences / big props, fed to the terrain. */
  private bakeSnowDrifts(): void {
    const g = this.grid;
    const W = g.width;
    const D = g.depth;
    const dist = new Float32Array(W * D).fill(99);
    const q: number[] = [];
    g.forEach((x, z, i) => {
      const o = g.getObject(x, z);
      const walled = (g.hasFlag(x, z, TileFlag.Blocked) && g.getType(x, z) !== TileType.Cliff) || (o && (o.kind === 'fence' || o.kind === 'building' || o.kind === 'prop'));
      if (walled) {
        dist[i] = 0;
        q.push(i);
      }
    });
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!;
      const x = i % W;
      const z = Math.floor(i / W);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        const j = nz * W + nx;
        if (dist[j]! > dist[i]! + 1) {
          dist[j] = dist[i]! + 1;
          if (dist[j]! < 3) q.push(j);
        }
      }
    }
    const sample = (x: number, z: number): number => {
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      if (tx < 0 || tz < 0 || tx >= W || tz >= D) return 99;
      return dist[tz * W + tx]!;
    };
    this.terrain.setDrift((x, z) => {
      // Min of the 4 nearest tiles gives rounded drift shoulders.
      const d = Math.min(sample(x - 0.5, z - 0.5), sample(x + 0.5, z - 0.5), sample(x - 0.5, z + 0.5), sample(x + 0.5, z + 0.5), sample(x, z) + 0.5);
      const n = 0.7 + 0.3 * this.shape.noise2.get(x * 0.6, z * 0.6);
      return THREE.MathUtils.smoothstep(d, 1.8, 0.4) * n * (1 - this.shape.pathValue(x, z) * 0.8);
    });
  }

  /** Remove grass tufts on a tile (tilling, placing objects). */
  clearGroundCover(x: number, z: number): void {
    this.grass.clearTile(x, z);
  }

  // ───────────────────────────────────────────── runtime

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  update(dt: number, game: Game): void {
    this.pools.update();
    // A letter is waiting: flag up, with a little springy wiggle every few seconds.
    if (this.mailFlag) {
      const t = game.time % 4;
      this.mailFlag.rotation.x = -0.05 + (t < 0.6 ? Math.sin(t * 22) * Math.exp(-t * 5) * 0.35 : 0);
    }
    this.grass.update(game.rc.rig.focus);
    const h = game.rc.renderer.domElement.height;
    for (const s of this.smoke) s.update(dt, game.lighting.night, h);
    this.ambience.update(dt, game.time, game.rc.rig.focus, game.lighting.night, h);
    this.bees.update(dt, game.time, game.lighting.night, h);
  }

  setSeason(season: Season): void {
    this.trees.setSeason(season);
    this.nature.setSeason(season);
    this.ambience.setSeason(season);
    this.bees.setSeason(season);
    this.litter.mesh.visible = season === 'fall';
    this.footprints.mesh.visible = season === 'winter';
    for (const s of this.seasonal) s.group.visible = s.seasons.includes(season);
  }

  setWeather(weather: Weather): void {
    this.ambience.setWeather(weather);
    this.bees.setWeather(weather);
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
