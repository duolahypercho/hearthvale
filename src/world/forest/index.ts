/**
 * Cindergrove — the old-growth forest south of the farm.
 *
 * Assembly only; the pieces live next door:
 *   layout.ts    anchors, stream / path polylines, hand-placed giants + the terrain shape
 *   giants.ts    old-growth elders and firs (buttressed, mossy, huge clustered canopies)
 *   props.ts     mossy logs, mushrooms, the Ember Shrine, ruined tower, footbridge, falls rocks
 *   stream.ts    waterfall, plunge churn, mist, flow ribbons
 *   foliage.ts   leaf / needle cards, painted light, see-through; rocks.ts smooth mossy stone
 *   (light shafts through the canopy gaps are volumetric: render/heightfog.ts `atmosphere.shaftList`)
 *   forage.ts    seasonal forageables (picked with interact)
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { Rng } from '../../core/rng';
import { smoothstep } from '../../core/noise';
import type { Season, Weather } from '../../core/time';
import type { GameMap, MapWarp } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Terrain } from '../terrain';
import { createWater } from '../water';
import { GrassField } from '../grass';
import { TreeField, type TreeSpecies } from '../props/trees';
import { Nature, type NatureKind } from '../props/nature';
import { BatchPool, InstancedSet } from '../props/instanced';
import { mergeStatic, MeshBuilder, mat } from '../geom';
import { LeafLitter } from '../props/decals';
import { Ambience, FireFX, BurstFX } from '../../render/particles';
import { globalUniforms } from '../../render/uniforms';
import { atmosphere } from '../../render/heightfog';
import { patchMaterial, before, replace } from '../../render/patch';
import {
  FOREST_SIZE,
  FOREST_EXTENT,
  WATER_LOW,
  WATER_HIGH,
  PLATEAU_H,
  ENTRY,
  FALLS,
  POOL,
  GLADE,
  SHRINE,
  TOWER,
  BRIDGE,
  STREAM,
  UPPER_STREAM,
  GIANTS,
  LOGS,
  ForestShape,
  type GiantKind,
} from './layout';
import { GiantGrove, ShrubField } from './giants';
import { buildMossyLog, buildMushroomCluster, buildShrine, buildRuinedTower, buildFootbridge, buildFallsRocks, buildSteppingStones, runeMaterial, emberMaterial, setIvySeason, type MushroomKind } from './props';
import { buildWaterfall, buildChurn, buildMist, buildFlow } from './stream';
import { ForageField, type ForageSpot } from './forage';
import { updateSeeThrough } from './foliage';
import { smoothRock, forestRockMaterial, setForestMossSeason, forestMoss } from './rocks';

export { FOREST_SIZE };

declare module '../../core/events' {
  interface GameEvents {
    /** A forageable was picked in Cindergrove. */
    'forage:picked': { itemId: string; x: number; z: number; map: string };
  }
}

export class ForestMap implements GameMap {
  readonly id = 'forest';
  readonly title = 'Cindergrove';
  readonly grid = new TileGrid(FOREST_SIZE.w, FOREST_SIZE.d);
  readonly root = new THREE.Group();
  readonly spawn = { x: ENTRY.x, z: ENTRY.z, facing: 'down' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(12, 9), new THREE.Vector2(53, 52));
  /** North edge → the farm's south gate. */
  readonly warps: MapWarp[] = [{ x0: 29, z0: 0, x1: 36, z1: 1, to: 'farm', x: 33.2, z: 61.4, facing: 'up' }];
  readonly terrain: Terrain;
  readonly grass: GrassField;
  readonly poi: Record<string, { x: number; y?: number; z: number; rot?: number }[]> = {};
  readonly shape: ForestShape;
  private rng: Rng;
  private giants: GiantGrove;
  private shrubs: ShrubField;
  private trees: TreeField;
  private nature: Nature;
  private pool = new BatchPool('forest-props');
  private staticRoots: THREE.Object3D[] = [];
  private ambience: Ambience;
  private litter: LeafLitter;
  private shafts: { x: number; y: number; z: number; w: number }[];
  private forage: ForageField;
  private forageSpots: ForageSpot[] = [];
  private fx = new BurstFX(200);
  private ember: FireFX;
  private emberLight: THREE.PointLight;
  private crystal: THREE.Mesh;
  private halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private crystalY = 0;
  private shrineGlow: THREE.PointLight;
  private season: Season = 'spring';
  private bufSize = new THREE.Vector2();

  constructor(private game: Game) {
    this.root.name = 'map:forest';
    const T = performance.now();
    const mark = (label: string) => console.debug(`[forest] ${label} ${(performance.now() - T).toFixed(0)}ms`);
    this.rng = game.rng.fork('forest');
    this.shape = new ForestShape(this.rng.fork('shape').seed);
    const S = this.shape;

    this.terrain = new Terrain({ ...FOREST_EXTENT, step: 0.5, height: (x, z) => S.height(x, z), waterLevel: WATER_LOW });
    this.root.add(this.terrain.mesh);
    this.patchCliffs();
    mark('terrain');
    this.paintGround();
    this.classifyTiles();
    mark('paint + tiles');

    // Still water: plunge pool + stream, and the spring pool on the plateau.
    const low = createWater(this.terrain, { x0: 6, z0: 15, x1: 84, z1: 84 }, WATER_LOW);
    const high = createWater(this.terrain, { x0: 2, z0: -22, x1: 24, z1: FALLS.lipZ + 0.15 }, WATER_HIGH);
    // Drop plane triangles hanging over the cliffs (the shader only hides water *under* ground).
    this.clipWater(low, WATER_LOW, 99);
    this.clipWater(high, WATER_HIGH, 1.4);
    low.userData.perfTag = high.userData.perfTag = 'water';
    this.root.add(low, high);
    this.buildRunningWater();

    this.giants = new GiantGrove(this.rng.fork('giants'));
    this.trees = new TreeField(this.rng.fork('trees'));
    this.nature = new Nature(this.rng.fork('nature'));
    this.shrubs = new ShrubField(this.rng.fork('shrubs'));
    this.placeGiants();
    this.placeRimForest();
    mark('trees');
    const shrine = this.buildSetPieces();
    this.crystal = shrine.crystal;
    this.halo = shrine.halo;
    this.crystalY = shrine.crystal.position.y;
    this.placeUndergrowth();
    this.placeMushrooms();
    mark('nature');
    this.terrain.commitCover();
    this.giants.group.userData.perfTag = 'trees';
    this.trees.group.userData.perfTag = 'trees';
    this.nature.group.userData.perfTag = 'nature';
    this.pool.group.userData.perfTag = 'nature';
    this.trees.finalize();
    this.nature.finalize();
    this.shrubs.finalize();
    this.shrubs.pool.group.userData.perfTag = 'nature';
    this.root.add(this.giants.group, this.trees.group, this.nature.group, this.pool.group, this.shrubs.pool.group);
    const merged = mergeStatic(this.staticRoots, 'forest-static');
    merged.userData.perfTag = 'props';
    this.root.add(merged);

    // Ember shrine: rising sparks + a warm practical that breathes with the crystal.
    const emberAt = shrine.ember.clone().add(new THREE.Vector3(SHRINE.x, this.terrain.heightAt(SHRINE.x, SHRINE.z) + 0.2, SHRINE.z));
    this.ember = new FireFX([emberAt], 50);
    this.ember.object.userData.perfTag = 'fx';
    this.root.add(this.ember.object);
    this.emberLight = new THREE.PointLight(0xff8a3a, 0, 9, 1.8);
    this.emberLight.position.copy(emberAt).add(new THREE.Vector3(0, 0.6, 0));
    this.root.add(this.emberLight);
    this.shrineGlow = new THREE.PointLight(0x7ff5e0, 0, 7, 2);
    this.shrineGlow.position.set(POOL.x + 2, WATER_LOW + 1.2, POOL.z + 1.5);
    this.root.add(this.shrineGlow);

    this.litter = new LeafLitter(
      this.rng.fork('litter'),
      this.giants.handles.map((h) => ({ x: h.x, z: h.z, r: h.radius * 0.8 })),
      (x, z) => this.terrain.heightAt(x, z),
      5200,
    );
    this.root.add(this.litter.mesh);

    this.grass = new GrassField({
      bounds: { x0: -14, z0: -16, x1: 78, z1: 76 },
      density: (x, z) => this.grassDensity(x, z),
      tallness: (x, z) => 0.2 + 0.45 * smoothstep(-0.1, 0.5, S.noise.fbm(x * 0.1, z * 0.1, 2)),
      height: (x, z) => this.terrain.heightAt(x, z),
      seed: 'forest-grass',
      densityScale: game.rc.preset.grassDensity * 0.85,
      cover: this.terrain,
    });
    this.root.add(this.grass.group);
    mark(`grass (${this.grass.instanceCount})`);

    this.shafts = this.raySpots();
    this.ambience = new Ambience((x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.ambience.group);
    this.fx.object.userData.perfTag = 'fx';
    this.root.add(this.fx.object);

    this.forage = new ForageField(this.pool, this.rng.fork('forage'));
    this.collectForageSpots();
    this.respawnForage();
    game.events.on('day:start', () => this.respawnForage());
    game.events.on('season:change', () => this.respawnForage());
    game.events.on('player:interact', ({ x, z }) => this.pick(x, z));

    this.poi.birds = [{ x: 30, z: 24 }, { x: 36, z: 30 }, { x: GLADE.x, z: GLADE.z + 3 }];
    this.poi.flowers = [{ x: GLADE.x - 3, z: GLADE.z + 4 }, { x: 34, z: 25 }];
    this.poi.shrine = [{ x: SHRINE.x, z: SHRINE.z }];
    this.poi.waterfall = [{ x: FALLS.x, z: FALLS.poolZ }];
    // Rain drips off the canopy rims of the giants in the basin (read by the weather system).
    const dr = this.rng.fork('drips');
    this.poi.drips = [];
    for (const g of this.giants.handles) {
      if (this.shape.rimDist(g.x, g.z) > 2) continue;
      const n = g.kind === 'elder' ? 12 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + dr.next() * 0.5;
        const rr = g.radius * (g.kind === 'elder' ? 0.55 + dr.next() * 0.3 : 0.45 + dr.next() * 0.2);
        const x = g.x + Math.cos(a) * rr;
        const z = g.z + Math.sin(a) * rr;
        const y = this.terrain.heightAt(g.x, g.z) + g.height * (g.kind === 'elder' ? 0.58 : 0.18 + dr.next() * 0.2);
        this.poi.drips.push({ x, y, z });
      }
    }
    mark('done');
  }

  // ───────────────────────────────────────────── ground

  private paintGround(): void {
    const S = this.shape;
    const t = this.terrain;
    t.paint('path', (x, z) => S.pathValue(x, z) * (1 - S.plateauMask(x, z)));
    // Pebbly, sandy stream banks.
    t.paint('sand', (x, z) => {
      const s = S.stream.nearest(x, z, 5);
      const u = S.upper.nearest(x, z, 3);
      // A continuous damp shingle band hugging the waterline (isolated sand blobs out in the grass
      // read as litter from the diorama camera).
      const bank = s ? smoothstep(s.w + 1.1, s.w + 0.5, s.d) : 0;
      const ub = u ? smoothstep(u.w + 0.75, u.w + 0.3, u.d) : 0;
      const pool = smoothstep(POOL.r + 0.8, POOL.r + 0.1, Math.hypot(x - POOL.x, (z - POOL.z) * 1.12));
      return Math.max(bank, ub, pool) * (0.55 + 0.4 * smoothstep(-0.3, 0.4, S.noise2.fbm(x * 0.7, z * 0.7, 2)));
    });
    t.commitSplat();
    const B = { x0: -10, z0: -12, x1: 76, z1: 74 };
    // Forest floor: moss carpets in the shade, clover in the sunny clearings.
    t.paintCover(
      'moss',
      (x, z) => {
        const n = S.noise2.fbm(x * 0.12 + 7, z * 0.12 + 3, 3) * 0.5 + 0.5;
        const s = S.stream.nearest(x, z, 6);
        const damp = s ? smoothstep(s.w + 5, s.w + 1, s.d) * 0.5 : 0;
        const glade = smoothstep(GLADE.r, GLADE.r - 3, Math.hypot(x - GLADE.x, z - GLADE.z));
        return Math.min(1, smoothstep(0.42, 0.7, n) + damp) * (1 - S.pathValue(x, z)) * (1 - glade * 0.6);
      },
      B,
    );
    t.paintCover(
      'clover',
      (x, z) => {
        const glade = smoothstep(GLADE.r + 1, GLADE.r - 2, Math.hypot(x - GLADE.x, z - GLADE.z));
        const clearing = smoothstep(6, 2, Math.hypot(x - 33.5, z - 24.5));
        const n = smoothstep(0.55, 0.72, S.noise.fbm(x * 0.15 + 9, z * 0.15, 2) * 0.5 + 0.5);
        return Math.max(glade * 0.8, clearing * 0.5, n * 0.5) * (1 - S.pathValue(x, z));
      },
      B,
    );
    t.paintCover('dry', (x, z) => smoothstep(0.62, 0.78, S.noise2.fbm(x * 0.18 + 30, z * 0.18, 2) * 0.5 + 0.5) * 0.5 * (1 - S.pathValue(x, z)), B);
  }

  /**
   * Cliff faces: layered sandstone / slate strata (horizontal bands of varying tone with lit tops,
   * shadowed undersides and vertical fractures) instead of the shared cracked-tile texture; moss and
   * grass drape over every band top (and snow settles there in winter via worldfx).
   */
  private patchCliffs(): void {
    patchMaterial(this.terrain.material, 'forest-cliff-strata', (shader) => {
      shader.uniforms.uMossC = forestMoss;
      let fs = shader.fragmentShader;
      fs = before(
        fs,
        'void main() {',
        /* glsl */ `
        uniform vec3 uMossC;
        vec3 hvCliffStrata(vec3 p, vec3 n, vec3 grass) {
          vec2 t2 = normalize(vec2(-n.z, n.x) + 1e-4);
          float along = dot(p.xz, t2);
          float warp = hvNoise(vec2(along * 0.25, p.y * 0.1)) * 0.9 + hvNoise(p.xz * 1.1) * 0.25;
          float yy = p.y * 1.45 + warp;
          float layer = floor(yy);
          float f = fract(yy);
          float lr = hvHash12(vec2(layer, 3.7));
          vec3 c = mix(vec3(0.13, 0.115, 0.095), vec3(0.24, 0.205, 0.16), lr);
          c = mix(c, vec3(0.13, 0.145, 0.16), step(0.68, hvHash12(vec2(layer, 9.1))) * 0.7);
          // Each band: lit, weathered top lip, darker undercut at its base.
          c *= 0.8 + 0.34 * smoothstep(0.05, 0.9, f);
          c *= 1.0 - smoothstep(0.14, 0.0, f) * 0.45;
          // Vertical joints, offset per band.
          float jn = hvNoise(vec2(along * 0.9 + layer * 3.1, layer * 1.7));
          c *= 1.0 - smoothstep(0.06, 0.0, abs(jn - 0.5)) * 0.4;
          c *= 0.9 + 0.18 * hvNoise(vec2(along * 5.0, p.y * 7.0));
          // Moss + grass tufts creeping over the band tops, dripping a little down the face.
          float mn = hvFbm(vec2(along * 0.6, p.y * 0.8) + 11.0);
          float moss = smoothstep(0.62, 0.95, f + (mn - 0.5) * 0.5) * smoothstep(0.35, 0.65, mn);
          c = mix(c, uMossC * (0.6 + 0.5 * mn), moss * 0.75);
          return c;
        }`,
      );
      fs = replace(fs, 'vec3 rock = rx * bw.x + ry * bw.y + rz * bw.z;', 'vec3 rock = hvCliffStrata(wp, wn, grass);');
      shader.fragmentShader = fs;
    });
  }

  private classifyTiles(): void {
    const g = this.grid;
    const S = this.shape;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const h = this.terrain.heightAt(cx, cz);
      g.height[i] = h;
      const d = S.rimDist(cx, cz);
      const exit = S.exitMask(cx, cz);
      const pm = S.plateauMask(cx, cz);
      if ((d > -0.2 && exit < 0.5) || this.terrain.slopeAt(cx, cz) < 0.8 || pm > 0.15) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      if (h < WATER_LOW - 0.06) {
        g.type[i] = TileType.Water;
        g.flags[i] = TileFlag.WaterSource;
        return;
      }
      g.type[i] = this.terrain.splatAt(cx, cz, 'path') > 0.5 ? TileType.Path : TileType.Grass;
    });
  }

  private grassDensity(x: number, z: number): number {
    const t = this.terrain;
    const S = this.shape;
    if (t.slopeAt(x, z) < 0.8) return 0;
    const h = t.heightAt(x, z);
    if (h < WATER_LOW + 0.05) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.3) return 0;
    const pm = S.plateauMask(x, z);
    const glade = smoothstep(GLADE.r + 1, GLADE.r - 2, Math.hypot(x - GLADE.x, z - GLADE.z));
    const clump = smoothstep(-0.15, 0.5, S.noise.fbm(x * 0.13 + 4, z * 0.13, 2));
    // Shade under giants thins the grass.
    let shade = 0;
    for (const g of this.giants.handles) {
      const d = Math.hypot(x - g.x, z - g.z);
      if (d < g.radius) shade = Math.max(shade, smoothstep(g.radius, g.radius * 0.35, d));
    }
    const moss = t.coverAt(x, z, 'moss');
    return (1.2 + clump * 3.6 + glade * 3 + pm * 2) * (1 - shade * 0.75) * (1 - moss * 0.45) * (pv > 0.05 ? 0.5 : 1);
  }

  // ───────────────────────────────────────────── water

  /** Drop triangles far above the ground (> 0.9 m) or hanging over a drop deeper than `maxDepth`. */
  private clipWater(mesh: THREE.Mesh, level: number, maxDepth: number): void {
    const g = mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index!;
    const keep: number[] = [];
    const ok = (i: number): boolean => {
      const h = this.terrain.heightAt(pos.getX(i), pos.getZ(i));
      return h > level - maxDepth && h < level + 0.9;
    };
    const wet = (i: number): boolean => this.terrain.heightAt(pos.getX(i), pos.getZ(i)) < level + 0.05;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      if (ok(a) && ok(b) && ok(c) && (wet(a) || wet(b) || wet(c))) keep.push(a, b, c);
    }
    g.setIndex(keep);
    g.computeBoundingSphere();
  }

  private buildRunningWater(): void {
    const top = WATER_HIGH;
    const falls = buildWaterfall({ x: FALLS.x, lipZ: FALLS.lipZ, top, bottom: WATER_LOW, width: FALLS.width, throw: 2.4 });
    this.root.add(falls);
    const baseZ = FALLS.lipZ + 2.3;
    this.root.add(buildChurn(FALLS.x, WATER_LOW + 0.015, baseZ + 0.2, 2.0));
    this.root.add(buildMist(FALLS.x, WATER_LOW + 0.2, baseZ + 0.2, FALLS.width * 1.2));
    this.root.add(buildFlow(STREAM, WATER_LOW + 0.012, (t) => 0.9 + t * 0.4, 1.0, 0.06, 1));
    this.root.add(buildFlow(UPPER_STREAM, WATER_HIGH + 0.012, () => 0.7, 1.6, 0.0, 0.985));
  }

  // ───────────────────────────────────────────── trees

  private placeGiants(): void {
    for (const [kind, x, z, s] of GIANTS) this.addGiant(kind, x, z, s, true);
  }

  private addGiant(kind: GiantKind, x: number, z: number, s: number, solid: boolean): void {
    const y = this.terrain.heightAt(x, z) - 0.15;
    this.giants.add(kind, x, y, z, s);
    this.terrain.stampCover('ao', x, z, kind === 'elder' ? 2.6 * s : 2 * s, 0.75);
    this.terrain.stampCover('moss', x, z, 3.8 * s, 0.7);
    if (!solid) return;
    const r = kind === 'elder' ? 1.3 * s : 0.9 * s;
    for (let tz = Math.floor(z - r); tz <= Math.floor(z + r); tz++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (Math.hypot(tx + 0.5 - x, tz + 0.5 - z) < r + 0.2) this.grid.setObject(tx, tz, { kind: 'tree', id: `giant-${kind}`, solid: true });
      }
    }
  }

  /** Dense forest wall beyond the rim (giant firs + elders, then filler trees at lower detail). */
  private placeRimForest(): void {
    const r = this.rng.fork('rim');
    const S = this.shape;
    for (let z = -20; z < 82; z += 3.6) {
      for (let x = -20; x < 84; x += 3.6) {
        const jx = x + (r.next() - 0.5) * 3;
        const jz = z + (r.next() - 0.5) * 3;
        const d = S.rimDist(jx, jz);
        const pm = S.plateauMask(jx, jz);
        const onPlateau = pm > 0.9 && S.upperCarve(jx, jz) < 0.1 && Math.abs(jx - FALLS.x) > 4;
        if ((d < 1.4 && !onPlateau) || S.exitMask(jx, jz) > 0.2) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.72) continue;
        if (S.streamCarve(jx, jz) > 0.05) continue;
        const y = this.terrain.heightAt(jx, jz) - 0.1;
        // Near the rim: a second row of giants; farther out: cheaper filler.
        if (d < 7 || onPlateau) {
          if (r.next() < 0.55) this.giants.add(r.next() < 0.55 ? 'fir' : 'elder', jx, y, jz, 0.8 + r.next() * 0.3);
          else this.trees.add(r.pick(['oak', 'maple', 'pine', 'pine'] as TreeSpecies[]), jx, y, jz, 1.2 + r.next() * 0.4, undefined, 1);
        } else if (r.next() < 0.8) {
          this.trees.add(r.pick(['pine', 'pine', 'oak', 'maple'] as TreeSpecies[]), jx, y, jz, 1.25 + r.next() * 0.45, undefined, 1);
        }
      }
    }
  }

  // ───────────────────────────────────────────── set pieces

  private addStatic(o: THREE.Object3D, x: number, z: number, rot = 0, sink = 0.04): THREE.Object3D {
    o.position.set(x, this.terrain.heightAt(x, z) - sink, z);
    o.rotation.y = rot;
    this.root.add(o);
    this.staticRoots.push(o);
    return o;
  }

  private blockDisc(x: number, z: number, r: number, id: string): void {
    for (let tz = Math.floor(z - r); tz <= Math.floor(z + r); tz++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (Math.hypot(tx + 0.5 - x, tz + 0.5 - z) < r) this.grid.setObject(tx, tz, { kind: 'prop', id, solid: true });
      }
    }
  }

  private buildSetPieces(): ReturnType<typeof buildShrine> {
    const r = this.rng.fork('set');
    // Mossy fallen giants.
    for (const [x, z, rot, len, rad] of LOGS) {
      this.addStatic(buildMossyLog(r, len, rad), x, z, rot, 0.12);
      this.terrain.stampCover('ao', x, z, len * 0.45, 0.6, 0.45);
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      for (let k = -len / 2 + 0.3; k <= len / 2 - 0.3; k += 0.5) this.grid.setObject(Math.floor(x + c * k), Math.floor(z - s * k), { kind: 'prop', id: 'log', solid: true });
    }
    // The Ember Shrine + ruined tower in the glade.
    const shrine = buildShrine(r);
    const sy = this.terrain.heightAt(SHRINE.x, SHRINE.z);
    shrine.group.position.set(SHRINE.x, sy - 0.05, SHRINE.z);
    this.root.add(shrine.group);
    this.staticRoots.push(shrine.group);
    this.terrain.stampCover('ao', SHRINE.x, SHRINE.z, 3.8, 0.5);
    this.blockDisc(SHRINE.x, SHRINE.z, 1.1, 'altar');
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.25;
      this.grid.setObject(Math.floor(SHRINE.x + Math.cos(a) * 4.6), Math.floor(SHRINE.z + Math.sin(a) * 4.6), { kind: 'prop', id: 'menhir', solid: true });
    }
    this.addStatic(buildRuinedTower(r), TOWER.x, TOWER.z, 0.35, 0.1);
    this.terrain.stampCover('ao', TOWER.x, TOWER.z, 3.4, 0.7);
    this.blockDisc(TOWER.x, TOWER.z, 3.0, 'tower');
    // Footbridge over the stream on the main trail.
    const bridge = buildFootbridge(r, BRIDGE.len);
    bridge.position.set(BRIDGE.x, WATER_LOW + 0.2, BRIDGE.z);
    bridge.rotation.y = BRIDGE.rot;
    this.root.add(bridge);
    this.staticRoots.push(bridge);
    // Bridge deck is walkable: override water tiles under it.
    const bc = Math.cos(BRIDGE.rot);
    const bs = Math.sin(BRIDGE.rot);
    for (let k = -BRIDGE.len / 2; k <= BRIDGE.len / 2; k += 0.4) {
      for (const o of [-0.4, 0, 0.4]) {
        const x = BRIDGE.x + bc * k + bs * o;
        const z = BRIDGE.z - bs * k + bc * o;
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        this.grid.setType(tx, tz, TileType.Path);
        this.grid.setFlag(tx, tz, TileFlag.Blocked, false);
      }
    }
    // Waterfall rocks + stepping stones across the stream bend.
    const lip = new THREE.Vector3(FALLS.x, PLATEAU_H - 0.3, FALLS.lipZ);
    const poolC = new THREE.Vector3(POOL.x, WATER_LOW, POOL.z);
    const fr = buildFallsRocks(r, lip, poolC, FALLS.width);
    this.root.add(fr);
    this.staticRoots.push(fr);
    const stones: [number, number][] = [[26.8, 30.4], [27.5, 31.4], [28.0, 32.5], [28.8, 33.5]];
    const ss = buildSteppingStones(r, stones, WATER_LOW - 0.05);
    this.root.add(ss);
    this.staticRoots.push(ss);
    for (const [x, z] of stones) {
      this.grid.setType(Math.floor(x), Math.floor(z), TileType.Stone);
    }
    return shrine;
  }

  // ───────────────────────────────────────────── undergrowth

  private freeTile(x: number, z: number): boolean {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    return this.grid.isWalkable(tx, tz) && this.grid.getType(tx, tz) === TileType.Grass && this.terrain.splatAt(x, z, 'path') < 0.1;
  }

  private placeUndergrowth(): void {
    const r = this.rng.fork('undergrowth');
    const S = this.shape;
    const N = this.nature;
    const place = (k: NatureKind, x: number, z: number, o: Parameters<Nature['place']>[4] = {}) => N.place(k, x, this.terrain.heightAt(x, z), z, o);
    // Tall grass tufts without the winter "dead twig" stand-in (snow hides the floor instead).
    const tuft = (x: number, z: number, scale: number) => {
      const h = place('tallGrass', x, z, { scale });
      if (h.extra) {
        N.remove(h.extra);
        h.extra = undefined;
      }
    };
    // Old-growth understory: fern beds and shrubs crowd the tree bases, the rim and the banks, leaf
    // litter and moss carpets under the canopies, clover / flowers in the sunny clearings.
    for (let z = -6; z < 70; z += 0.75) {
      for (let x = -6; x < 72; x += 0.75) {
        const jx = x + (r.next() - 0.5) * 0.7;
        const jz = z + (r.next() - 0.5) * 0.7;
        const h = this.terrain.heightAt(jx, jz);
        if (h < WATER_LOW + 0.08) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.78) continue;
        const pv = S.pathValue(jx, jz);
        if (pv > 0.2) continue;
        const d = S.rimDist(jx, jz);
        const pm = S.plateauMask(jx, jz);
        if (pm > 0.2 && pm < 0.9) continue;
        // Far outside the rim only the edge of the wall is seen: skip the deep forest.
        if (d > 7 && pm < 0.9) continue;
        let nearGiant = 0;
        for (const g of this.giants.handles) {
          const dd = Math.hypot(jx - g.x, jz - g.z);
          if (dd < 6) nearGiant = Math.max(nearGiant, smoothstep(6, 1.8, dd));
        }
        const s = S.stream.nearest(jx, jz, 4);
        const bank = s ? smoothstep(s.w + 2.6, s.w + 1.0, s.d) : 0;
        const glade = smoothstep(GLADE.r, GLADE.r - 3, Math.hypot(jx - GLADE.x, jz - GLADE.z));
        const clearing = smoothstep(5.5, 2.5, Math.hypot(jx - 33.5, jz - 24.5));
        const edge = smoothstep(-5, 0, d);
        const pathEdge = smoothstep(0.02, 0.18, pv);
        // Fern beds: patchy (noise-clumped), strongest by roots, the rim and damp banks.
        const bed = smoothstep(0.42, 0.7, S.noise2.fbm(jx * 0.16 + 40, jz * 0.16, 2) * 0.5 + 0.5);
        const open = (1 - glade * 0.85) * (1 - clearing * 0.85);
        const fernP = (0.04 + nearGiant * 0.3 + edge * 0.35 + bank * 0.18 + pm * 0.25 + bed * 0.32) * open * (1 - pathEdge * 0.6);
        const roll = r.next();
        const walk = d < -0.2 && pm < 0.2;
        if (walk && !this.freeTile(jx, jz)) continue;
        if (roll < fernP * 0.5) place('fern', jx, jz, { scale: 1.0 + r.next() * 0.9 + bed * 0.4 });
        else if (roll < fernP * 0.5 + edge * 0.1 + nearGiant * 0.035 + bed * 0.02) this.shrubs.add(jx, h, jz, 0.8 + r.next() * 0.7);
        else if (bank > 0.3 && roll < fernP * 0.5 + 0.16 * bank) place('reed', jx, jz, { scale: 0.9 + r.next() * 0.4 });
        else if (roll < fernP * 0.5 + 0.02 + nearGiant * 0.12) place('leaves', jx, jz, { scale: 1.0 + r.next() * 0.6 });
        else if ((glade > 0.3 || clearing > 0.3) && roll < 0.36) place(r.pick(['flower', 'daisy', 'buttercup', 'flower'] as NatureKind[]), jx, jz, { color: r.pick([0xffffff, 0xffd166, 0xc77dff, 0x9fd4ff, 0xff8fab]), scale: 1.05 });
        else if (roll < fernP * 0.5 + 0.16 + nearGiant * 0.22) place('clover', jx, jz, { scale: 0.9 + r.next() * 0.5 });
        else if (roll < fernP * 0.5 + 0.2 + bank * 0.1) tuft(jx, jz, 0.8 + r.next() * 0.5);
        else if (bank > 0.2 && roll < 0.26) place('pebbles', jx, jz, { scale: 0.8 + r.next() * 0.6 });
        else if (pathEdge > 0.2 && roll < 0.3) place(r.next() < 0.5 ? 'pebbles' : 'daisy', jx, jz, { scale: 0.8 + r.next() * 0.4 });
      }
    }
    // Weathered boulders (smooth, mossy) with grass / fern tufts and contact shade at their feet.
    const rb = new MeshBuilder();
    const rockM = forestRockMaterial();
    const boulder = (x: number, z: number, rad: number, solid: boolean) => {
      const y = this.terrain.heightAt(x, z);
      rb.add(rockM, smoothRock(r, rad, { detail: rad > 0.5 ? 3 : 2 }), mat(x, y - 0.05, z, 0, r.next() * 6.28, 0));
      this.terrain.stampCover('ao', x, z, rad * 1.5, 0.55);
      this.terrain.stampCover('moss', x, z, rad * 2.2, 0.5);
      const n = 3 + Math.round(rad * 4);
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const dd = rad * (0.95 + r.next() * 0.4);
        const tx = x + Math.cos(a) * dd;
        const tz = z + Math.sin(a) * dd;
        if (this.terrain.heightAt(tx, tz) < WATER_LOW + 0.05) continue;
        if (r.next() < 0.35) place('fern', tx, tz, { scale: 0.8 + r.next() * 0.5 });
        else tuft(tx, tz, 0.7 + r.next() * 0.4);
      }
      if (solid) this.grid.setObject(Math.floor(x), Math.floor(z), { kind: 'boulder', id: 'boulder', solid: true });
    };
    for (let i = 0; i < 30; i++) {
      const x = 6 + r.next() * 54;
      const z = 12 + r.next() * 46;
      if (!this.freeTile(x, z) || S.streamCarve(x, z) > 0.1) continue;
      boulder(x, z, 0.45 + r.next() * 0.55, true);
    }
    // Small stones scattered in clusters near roots and banks.
    for (let i = 0; i < 70; i++) {
      const x = 2 + r.next() * 62;
      const z = 6 + r.next() * 56;
      if (S.rimDist(x, z) > 1 || S.pathValue(x, z) > 0.3 || this.terrain.heightAt(x, z) < WATER_LOW + 0.05) continue;
      if (this.terrain.slopeAt(x, z) < 0.8) continue;
      const y = this.terrain.heightAt(x, z);
      rb.add(rockM, smoothRock(r, 0.12 + r.next() * 0.16, { detail: 1 }), mat(x, y - 0.03, z, 0, r.next() * 6.28, 0));
    }
    const rocks = rb.build({ name: 'forest-boulders' });
    this.root.add(rocks);
    this.staticRoots.push(rocks);
    // Stumps of long-fallen giants.
    for (const [x, z] of [[36.5, 20.4], [22.4, 33.6], [47.6, 38.8], [18.6, 50.4]] as const) {
      place('stump', x, z, { scale: 1.6 });
      this.grid.setObject(Math.floor(x), Math.floor(z), { kind: 'stump', id: 'stump', solid: true });
      for (let i = 0; i < 5; i++) {
        const a = r.next() * Math.PI * 2;
        place(i < 2 ? 'fern' : 'clover', x + Math.cos(a) * 0.9, z + Math.sin(a) * 0.9, { scale: 0.8 + r.next() * 0.4 });
      }
    }
    // Lily pads in the plunge pool's calm side and along slow bends.
    for (let i = 0; i < 20; i++) {
      const a = r.next() * Math.PI * 2;
      const d = 1.6 + r.next() * 2.2;
      const x = POOL.x + Math.cos(a) * d + 1.2;
      const z = POOL.z + Math.sin(a) * d * 0.8 + 0.8;
      if (this.terrain.heightAt(x, z) > WATER_LOW - 0.12) continue;
      if (Math.abs(x - FALLS.x) < 1.6 && z < POOL.z) continue;
      N.place('lilypad', x, WATER_LOW + 0.01, z, { scale: 0.8 + r.next() * 0.5 });
    }
    // Ferns spilling over the plateau lip beside the falls + along the whole cliff crest.
    for (let i = 0; i < 26; i++) {
      const x = FALLS.x + (r.next() < 0.5 ? -1 : 1) * (FALLS.width * 0.7 + r.next() * 5);
      const z = FALLS.lipZ - 0.6 - r.next() * 2.4;
      if (S.upperCarve(x, z) > 0.2) continue;
      place('fern', x, z, { scale: 1.2 + r.next() * 0.8 });
    }
    for (let x = 0; x < 28; x += 0.6) {
      for (let k = 0; k < 2; k++) {
        const jx = x + (r.next() - 0.5) * 0.5;
        // Walk inward from the crest until the ground is on the plateau top.
        let z = FALLS.lipZ + 2;
        while (z > FALLS.lipZ - 8 && S.plateauDist(jx, z) > -0.35 - k * 0.8) z -= 0.25;
        if (Math.abs(jx - FALLS.x) < FALLS.width * 0.8 || S.upperCarve(jx, z) > 0.2) continue;
        if (this.terrain.slopeAt(jx, z) < 0.7) continue;
        const roll = r.next();
        if (roll < 0.45) place('fern', jx, z, { scale: 1.0 + r.next() * 0.7 });
        else if (roll < 0.7) tuft(jx, z, 0.9 + r.next() * 0.4);
        else if (roll < 0.8) this.shrubs.add(jx, this.terrain.heightAt(jx, z), z, 0.8 + r.next() * 0.4);
      }
    }
  }

  private placeMushrooms(): void {
    const r = this.rng.fork('mushrooms');
    const sets = new Map<MushroomKind, InstancedSet[]>();
    for (const k of ['amanita', 'bolete', 'glowcap'] as MushroomKind[]) {
      sets.set(
        k,
        [0, 1, 2].map((v) => new InstancedSet(`mush-${k}-${v}`, buildMushroomCluster(k, r.fork(`${k}${v}`)), this.pool)),
      );
    }
    const put = (k: MushroomKind, x: number, z: number, s = 1) => {
      const set = r.pick(sets.get(k)!);
      set.add(new THREE.Matrix4().compose(new THREE.Vector3(x, this.terrain.heightAt(x, z) - 0.02, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6.28), new THREE.Vector3(s, s, s)));
    };
    // Rings of mushrooms around giant roots + along the logs; glowcaps by the water and in the glade.
    for (const g of this.giants.handles) {
      if (g.x < -2 || g.x > 66 || g.z < -2 || g.z > 64) continue;
      const n = 2 + r.int(0, 3);
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const d = (g.kind === 'elder' ? 1.9 : 1.3) * g.scale + r.next() * 1.3;
        put(r.next() < 0.45 ? 'amanita' : r.next() < 0.5 ? 'bolete' : 'glowcap', g.x + Math.cos(a) * d, g.z + Math.sin(a) * d, 1.1 + r.next() * 0.6);
      }
    }
    for (const [x, z, rot, len] of LOGS) {
      for (let i = 0; i < 4; i++) {
        const k = (r.next() - 0.5) * len * 0.9;
        const side = r.next() < 0.5 ? -1 : 1;
        put(r.next() < 0.5 ? 'bolete' : 'glowcap', x + Math.cos(rot) * k + Math.sin(rot) * side * 0.8, z - Math.sin(rot) * k + Math.cos(rot) * side * 0.8, 1 + r.next() * 0.5);
      }
    }
    for (let i = 0; i < 18; i++) {
      const s = this.shape.stream.samples[Math.floor(r.next() * this.shape.stream.samples.length)]!;
      const a = r.next() * Math.PI * 2;
      const x = s.x + Math.cos(a) * (s.w + 1.4 + r.next());
      const z = s.z + Math.sin(a) * (s.w + 1.4 + r.next());
      if (this.terrain.heightAt(x, z) < WATER_LOW + 0.1) continue;
      put('glowcap', x, z, 1 + r.next() * 0.5);
    }
    for (let i = 0; i < 9; i++) {
      const a = r.next() * Math.PI * 2;
      put('glowcap', SHRINE.x + Math.cos(a) * (5.2 + r.next()), SHRINE.z + Math.sin(a) * (5.2 + r.next()), 1.2);
    }
  }

  // ───────────────────────────────────────────── light shafts

  private raySpots(): { x: number; y: number; z: number; w: number }[] {
    const r = this.rng.fork('rays');
    const out: { x: number; y: number; z: number; w: number }[] = [];
    for (const g of this.giants.handles) {
      if (g.x < 2 || g.x > 64 || g.z < 2 || g.z > 60) continue;
      const n = g.kind === 'elder' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const d = g.radius * (0.55 + r.next() * 0.35);
        const x = g.x + Math.cos(a) * d;
        const z = g.z + Math.sin(a) * d;
        out.push({ x, y: this.terrain.heightAt(x, z), z, w: 0.7 + r.next() * 1.1 });
      }
    }
    // Wide shafts into the glade and over the pool.
    for (const [x, z, w] of [[GLADE.x - 1.5, GLADE.z + 1, 2.6], [GLADE.x + 2.5, GLADE.z - 1.5, 1.8], [POOL.x + 1, POOL.z + 1, 2.2], [33.5, 24.5, 2.0], [30.5, 34, 1.6]] as const) {
      out.push({ x, y: this.terrain.heightAt(x, z), z, w });
    }
    return out;
  }

  // ───────────────────────────────────────────── forage

  private collectForageSpots(): void {
    const S = this.shape;
    const r = this.rng.fork('forage-spots');
    for (let z = 3; z < this.grid.depth - 2; z++) {
      for (let x = 2; x < this.grid.width - 2; x++) {
        if (!this.grid.isWalkable(x, z) || this.grid.getType(x, z) !== TileType.Grass) continue;
        const cx = x + 0.3 + r.next() * 0.4;
        const cz = z + 0.3 + r.next() * 0.4;
        if (S.pathValue(cx, cz) > 0.05 || S.rimDist(cx, cz) > -1.5) continue;
        if (Math.hypot(cx - ENTRY.x, cz - ENTRY.z) < 4) continue;
        this.forageSpots.push({ x: cx, y: this.terrain.heightAt(cx, cz), z: cz });
      }
    }
  }

  private respawnForage(): void {
    const c = this.game.calendar;
    this.forage.spawn(`forage:${c.year}:${c.season}:${c.day}`, c.season, this.forageSpots, 11, (tx, tz, item) => {
      if (this.grid.getObject(tx, tz)) return false;
      this.grid.setObject(tx, tz, { kind: 'forage', id: item.def.id, solid: false, onRemove: () => this.forage.take(tx, tz) });
      return true;
    });
  }

  private pick(x: number, z: number): void {
    if (this.game.world.current !== this) return;
    // Facing tile first, then the tile underfoot.
    const p = this.game.player.position;
    for (const [tx, tz] of [[x, z], [Math.floor(p.x), Math.floor(p.z)]] as const) {
      const o = this.grid.getObject(tx, tz);
      if (o?.kind !== 'forage') continue;
      const it = this.forage.take(tx, tz);
      this.grid.setObject(tx, tz, null);
      if (!it) return;
      this.fx.emit(it.pos.clone().setY(it.pos.y + 0.2), { color: it.def.color, count: 14, speed: 1.4, size: 0.1, gravity: 4, up: 1.4 });
      this.fx.emit(it.pos.clone().setY(it.pos.y + 0.3), { color: 0xfff2b0, count: 8, speed: 0.9, size: 0.07, gravity: 0.3, up: 1.1, life: 0.9 });
      this.game.player.swing();
      this.game.events.emit('item:give', { itemId: it.def.id, qty: 1 });
      this.game.events.emit('forage:picked', { itemId: it.def.id, x: tx, z: tz, map: this.id });
      return;
    }
  }

  // ───────────────────────────────────────────── runtime

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  clearGroundCover(x: number, z: number): void {
    this.grass.clearTile(x, z);
  }

  private fogBoost = 0;
  /** Morning-fog boost for the light shafts (set by the weather system through `setAtmosphere`). */
  setAtmosphere(fog: number): void {
    this.fogBoost = fog;
  }

  update(dt: number, game: Game): void {
    this.grass.update(game.rc.rig.focus);
    const buf = game.rc.renderer.getDrawingBufferSize(this.bufSize);
    updateSeeThrough(game.rc.camera, game.player.position, buf.x, buf.y);
    const h = game.rc.renderer.domElement.height;
    const night = game.lighting.night;
    this.ambience.update(dt, game.time, game.rc.rig.focus, night, h);
    this.fx.update(dt, h);
    this.ember.update(dt, h);
    const t = game.time;
    // Crystal bobs and turns; runes breathe; the practical flickers with it.
    this.crystal.position.y = this.crystalY + Math.sin(t * 1.3) * 0.08;
    this.crystal.rotation.y = t * 0.6;
    const breath = 0.75 + 0.25 * Math.sin(t * 1.1) + 0.05 * Math.sin(t * 7.3);
    runeMaterial().emissiveIntensity = (1.0 + night * 1.4) * breath;
    this.halo.position.y = this.crystal.position.y + 0.05;
    this.halo.quaternion.copy(game.rc.camera.quaternion);
    this.halo.scale.setScalar((1.8 + night * 1.6) * (0.92 + 0.08 * breath));
    this.halo.material.opacity = (0.45 + night * 0.55) * breath;
    emberMaterial().emissiveIntensity = (1.8 + night * 1.5) * breath;
    this.emberLight.intensity = (1.2 + night * 5) * breath;
    this.shrineGlow.intensity = globalUniforms.uLamps.value * 2.2;
    // Volumetric shafts through the canopy gaps: strong with a low sun / morning mist, off under overcast.
    const sun = globalUniforms.uSunColor.value;
    const lum = sun.r * 0.3 + sun.g * 0.5 + sun.b * 0.2;
    atmosphere.shaftList = this.shafts;
    atmosphere.shaftLen = 15;
    atmosphere.shafts = Math.max(0, 1 - globalUniforms.uRain.value * 1.2) * (1 - globalUniforms.uSnow.value * 0.4) * THREE.MathUtils.smoothstep(lum, 0.08, 0.5) * (1 - night) * (0.8 + this.fogBoost * 1.8);
  }

  setSeason(season: Season): void {
    this.season = season;
    this.giants.setSeason(season);
    this.shrubs.setSeason(season);
    setForestMossSeason(season);
    this.trees.setSeason(season);
    this.nature.setSeason(season);
    this.ambience.setSeason(season);
    this.litter.mesh.visible = season === 'fall';
    setIvySeason(season);
  }

  setWeather(weather: Weather): void {
    this.ambience.setWeather(weather);
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
