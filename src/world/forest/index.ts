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
  BRIDGE_DIR,
  STREAM,
  UPPER_STREAM,
  GIANTS,
  LOGS,
  STAGE_SPOTS,
  ForestShape,
  type GiantKind,
} from './layout';
import { GiantGrove, ShrubField, giantBarkMaterial } from './giants';
import { buildMossyLog, buildMushroomCluster, buildShrine, buildRuinedTower, buildFootbridge, buildBridgeIcicles, buildFallsRocks, buildSteppingStones, runeMaterial, emberMaterial, setIvySeason, fungusMaterial, glowcapMaterial, towerWindowMaterial, buildWinterBerry, buildWinterTwigs, buildFallenBranch, buildSnowHummock, buildHareTracks, winterTrackMaterial, winterLeafMaterial, winterBerryMaterial, winterTwigMaterial, type MushroomKind } from './props';
import { buildWaterfall, buildChurn, buildMist, buildFlow } from './stream';
import { ForageField, forageKey, type ForageSpot, type ForageItem } from './forage';
import { PluckAction } from './pluck';
import { ArrivalCard } from './arrival';
import { flyItemToToolbar } from '../../ui/item-fly';
import { updateSeeThrough } from './foliage';
import { ShaftMotes } from './motes';
import { CLIFF_STRATA_GLSL, buildCliffWall } from './cliffs';
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
  /** Shown on arrival by our own card (world/forest/arrival.ts), not the generic banner. */
  readonly areaName = 'Cindergrove';
  readonly grid = new TileGrid(FOREST_SIZE.w, FOREST_SIZE.d);
  readonly root = new THREE.Group();
  readonly spawn = { x: ENTRY.x, z: ENTRY.z, facing: 'down' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(12, 6.5), new THREE.Vector2(53, 52));
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
  private motes = new ShaftMotes();
  /** Snow-drift catchers: trunks, boulders, logs (x, z, radius). */
  private obstacles: { x: number; z: number; r: number }[] = [];
  private forage: ForageField;
  private forageSpots: ForageSpot[] = [];
  private forageDay = '';
  private pluck: PluckAction;
  private card: ArrivalCard;
  /** Farmhand picks waiting for the host's verdict (the item is granted on 'ok'). */
  private awaiting = new Map<number, ForageItem>();
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
    // The spring pool only lives in the upper channel: a dip on the plateau rim or the top of the cliff
    // face that happens to sit under the pool level must not grow a stray sliver of water.
    this.clipWater(high, WATER_HIGH, 1.4, (x, z) => (S.upper.nearest(x, z, 2.4)?.d ?? 9) < 2.1 && S.plateauMask(x, z) > 0.9);
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
    this.placeWinterFloor();
    this.dressCliffs();
    mark('nature');
    this.terrain.commitCover();
    this.bakeDrifts();
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
    this.root.add(this.motes.points);
    this.ambience = new Ambience((x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.ambience.group);
    this.fx.object.userData.perfTag = 'fx';
    this.root.add(this.fx.object);

    this.forage = new ForageField(this.pool, this.rng.fork('forage'));
    this.root.add(this.forage.group);
    this.pluck = new PluckAction(game.player);
    this.card = new ArrivalCard(game.opts.uiRoot);
    game.events.on('demo:stage', ({ name }) => {
      if (name === 'forest-arrival') requestAnimationFrame(() => this.showArrivalCard());
    });
    // Walking in from the farm: the carved area plate (demos stage paused and skip it).
    game.events.on('map:change', ({ map, prev }) => {
      // Only a real walk-in (arrival at the north gate), never a demo / debug teleport.
      if (map !== this.id || prev !== 'farm') return;
      setTimeout(() => {
        const p = game.player.position;
        if (game.world.current === this && !game.paused && Math.hypot(p.x - ENTRY.x, p.z - ENTRY.z) < 4) this.card.show(this.areaName, this.season);
      }, 380);
    });
    this.collectForageSpots();
    this.respawnForage();
    game.events.on('day:start', () => this.respawnForage());
    game.events.on('season:change', () => this.respawnForage());
    game.events.on('season:apply', () => this.respawnForage());
    game.events.on('player:interact', ({ x, z }) => this.pick(x, z));
    // Co-op (world/forest/coop.ts): another farmer's pick, the host's verdict on ours, join sync.
    game.events.on('forage:removed', ({ day, tx, tz }) => {
      if (day !== this.forageDay) return;
      this.releaseTile(tx, tz);
      const it = this.forage.take(tx, tz);
      if (!it) return;
      if (game.world.current === this) this.forage.burstAt(it, 0.6);
      this.forage.drop(it);
    });
    game.events.on('forage:ledger', ({ day, tiles }) => {
      if (day !== this.forageDay) return;
      for (const [tx, tz] of tiles) {
        this.releaseTile(tx, tz);
        this.forage.remove(tx, tz);
      }
    });
    game.events.on('forage:verdict', ({ day, tx, tz, ok }) => {
      const k = forageKey(tx, tz);
      const it = this.awaiting.get(k);
      this.awaiting.delete(k);
      if (!it || day !== this.forageDay) return;
      if (ok) this.grant(it);
      else game.events.emit('ui:toast', { text: 'Someone beat you to it!', icon: it.def.id });
    });

    this.poi.birds = [{ x: 30, z: 24 }, { x: 36, z: 30 }, { x: GLADE.x, z: GLADE.z + 3 }];
    this.poi.flowers = [{ x: GLADE.x - 3, z: GLADE.z + 4 }, { x: 34, z: 25 }];
    this.poi.shrine = [{ x: SHRINE.x, z: SHRINE.z }];
    this.poi.waterfall = [{ x: FALLS.x, z: FALLS.poolZ }];
    // Where the storm demo's posed lightning bolt lands (open bank east of the plunge pool).
    // Hero strike spots per demo (weather.ts picks an open, in-frame tile otherwise).
    this.poi.strike = [{ x: 14.2, z: 23.6, demo: 'storm' } as { x: number; z: number }, { x: 13.6, z: 31.4, demo: 'storm-meadow' } as { x: number; z: number }, { x: 12.2, z: 32.6, demo: 'coop-forest' } as { x: number; z: number }];
    // Spray bow in the waterfall mist (weather: rainbows after rain); `rot` carries its radius.
    this.poi.rainbow = [{ x: FALLS.x + 0.2, y: WATER_LOW - 0.35, z: FALLS.lipZ + 3.4, rot: 2.9 }];
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
   * Cliff faces: hand-cut layered sandstone / slate. Beds of varying thickness (0.5-1.1 m, each
   * coarse bed split at a random height), a 2-octave domain warp so the bedding dips and swells,
   * vertical fracture columns that run through several beds (each block shaded on its own), dark
   * water-stain streaks and moss / ivy tongues dripping down from the ledges; snow settles on every
   * ledge in winter. Chunky overhang ledges, fallen blocks and hanging roots are real geometry
   * (`dressCliffs`).
   */
  private patchCliffs(): void {
    patchMaterial(this.terrain.material, 'forest-cliff-strata2', (shader) => {
      shader.uniforms.uMossC = forestMoss;
      let fs = shader.fragmentShader;
      fs = before(
        fs,
        'void main() {',
        /* glsl */ `
        uniform vec3 uMossC;
        ${CLIFF_STRATA_GLSL}`,
      );
      // Only steep pixels pay for the strata (the forest floor skips it; the triplanar reads go dead).
      fs = replace(fs, 'vec3 rock = rx * bw.x + ry * bw.y + rz * bw.z;', 'vec3 rock = rockM > 0.002 ? hvCliffStrata(wp, wn, dot(wp.xz, normalize(vec2(-wn.z, wn.x) + 1e-4))) : vec3(0.0);');
      shader.fragmentShader = fs;
    });
  }

  /**
   * Break the cliff's straight wall: chunky overhanging ledge slabs every 4-6 m at different heights,
   * fallen blocks + boulders heaped at the foot, and roots of the plateau trees hanging over the lip.
   */
  private dressCliffs(): void {
    const r = this.rng.fork('cliff-dress');
    const S = this.shape;
    const t = this.terrain;
    const wall = buildCliffWall(t, r.fork('wall'), { x0: -12, x1: 26.4, lipZ: FALLS.lipZ, topY: PLATEAU_H });
    this.root.add(wall.mesh);
    const rb = new MeshBuilder();
    const rockM = forestRockMaterial();
    const bark = giantBarkMaterial();
    const lineAt = (x: number) => {
      let best = wall.line[0];
      for (const p of wall.line) if (best === undefined || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      return best;
    };
    // Face point at relative height v (0 top .. 1 foot), pushed out by the wall's mean bulge.
    const faceAt = (x: number, v: number): { y: number; z: number } | null => {
      const p = lineAt(x);
      if (!p || Math.abs(p.x - x) > 0.3) return null;
      const y = THREE.MathUtils.lerp(PLATEAU_H - 0.18, p.yBot - 0.45, v);
      const z = THREE.MathUtils.lerp(p.zTop - 0.12, p.zBot + 0.35, Math.pow(v, 1.15)) + 0.3 + Math.sin(Math.PI * v) * 0.2;
      return { y, z };
    };
    let x = -2 + r.next() * 2;
    while (x < 26) {
      if (Math.abs(x - FALLS.x) > FALLS.width * 1.3 && S.upperCarve(x, FALLS.lipZ - 1) < 0.1) {
        // 1-2 chunky overhanging ledges per stretch, at varied heights.
        const n = 1 + (r.next() < 0.45 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const f = faceAt(x + k * 1.3, k === 0 ? 0.3 + r.next() * 0.3 : 0.08 + r.next() * 0.12);
          if (!f) continue;
          const rad = 0.7 + r.next() * 0.4;
          const g = smoothRock(r, rad, { squash: 0.45 + r.next() * 0.12, elong: 1.6 + r.next() * 0.4, detail: 2, strata: 0.9 });
          rb.add(rockM, g, mat(x + k * 1.3, f.y - rad * 0.28, f.z - rad * 0.5, (r.next() - 0.5) * 0.1, (r.next() - 0.5) * 0.3, (r.next() - 0.5) * 0.1));
        }
        // Fallen blocks heaped at the foot.
        const foot = lineAt(x + 0.8);
        if (foot && r.next() < 0.8) {
          const bx = x + 0.8 + (r.next() - 0.5);
          const bz = foot.zBot + 0.7 + r.next() * 0.6;
          if (t.heightAt(bx, bz) > WATER_LOW + 0.05) {
            const rad = 0.45 + r.next() * 0.45;
            rb.add(rockM, smoothRock(r, rad, { detail: 2 }), mat(bx, t.heightAt(bx, bz) - 0.08, bz, 0, r.next() * 6.28, 0));
            if (r.next() < 0.6) rb.add(rockM, smoothRock(r, rad * 0.5, { detail: 1 }), mat(bx + rad * 1.1, t.heightAt(bx + rad * 1.1, bz + 0.3) - 0.05, bz + 0.3, 0, r.next() * 6.28, 0));
            this.obstacles.push({ x: bx, z: bz, r: rad });
          }
        }
        // Roots spilling over the lip and hanging down the face.
        const lipP = lineAt(x + 0.4);
        if (lipP && r.next() < 0.55) {
          const zl = lipP.zTop + 0.05;
          const nR = 1 + r.int(0, 1);
          for (let q = 0; q < nR; q++) {
            const rx = x + 0.4 + (r.next() - 0.5) * 0.8;
            const top = new THREE.Vector3(rx, PLATEAU_H + 0.05, zl - 0.7);
            const lip = new THREE.Vector3(rx + (r.next() - 0.5) * 0.3, PLATEAU_H - 0.15, zl + 0.2);
            const drop = 0.8 + r.next() * 1.6;
            const mid = new THREE.Vector3(rx + (r.next() - 0.5) * 0.5, PLATEAU_H - 0.2 - drop * 0.5, zl + 0.45);
            const end = new THREE.Vector3(rx + (r.next() - 0.5) * 0.7, PLATEAU_H - 0.2 - drop, zl + 0.45 + r.next() * 0.2);
            const curve = new THREE.CatmullRomCurve3([top, lip, mid, end]);
            const tube = new THREE.TubeGeometry(curve, 10, 0.045 + r.next() * 0.03, 5, false);
            // Taper towards the tip.
            const pos = tube.attributes.position as THREE.BufferAttribute;
            const pts = curve.getSpacedPoints(10);
            for (let i = 0; i < pos.count; i++) {
              const ring = Math.floor(i / 6);
              const c = pts[Math.min(ring, pts.length - 1)]!;
              const k2 = 1 - (ring / 10) * 0.75;
              pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k2, c.y + (pos.getY(i) - c.y) * k2, c.z + (pos.getZ(i) - c.z) * k2);
            }
            tube.computeVertexNormals();
            rb.add(bark, tube);
          }
        }
      }
      x += 4 + r.next() * 2;
    }
    const g = rb.build({ name: 'forest-cliff-dress' });
    this.root.add(g);
    this.staticRoots.push(g);
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
    // Nothing grows through the fallen logs (blades poking through read as a see-through log).
    for (const [lx, lz, rot, len, rad] of LOGS) {
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const dx = x - lx;
      const dz = z - lz;
      const along = dx * c - dz * sn;
      const across = dx * sn + dz * c;
      if (Math.abs(along) < len / 2 + 0.5 && Math.abs(across) < rad + 0.25) return 0;
    }
    const moss = t.coverAt(x, z, 'moss');
    return (1.2 + clump * 3.6 + glade * 3 + pm * 2) * (1 - shade * 0.75) * (1 - moss * 0.45) * (pv > 0.05 ? 0.5 : 1);
  }

  // ───────────────────────────────────────────── water

  /** Drop triangles far above the ground (> 0.9 m) or hanging over a drop deeper than `maxDepth`. */
  private clipWater(mesh: THREE.Mesh, level: number, maxDepth: number, where?: (x: number, z: number) => boolean): void {
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
      if (!(ok(a) && ok(b) && ok(c) && (wet(a) || wet(b) || wet(c)))) continue;
      if (where && !where((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3)) continue;
      keep.push(a, b, c);
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
        if (onPlateau) {
          // The plateau is seen side-on from the falls: only the painted giants hold up there (the
          // generic low-poly trees show their bare undersides at that angle).
          if (r.next() < 0.55) this.giants.add(r.next() < 0.55 ? 'fir' : 'elder', jx, y, jz, 0.8 + r.next() * 0.3);
        } else if (d < 7) {
          // Front rows of the wall: painted giants (the generic pine reads as a flat low-poly cone
          // next to them); broad-leaved filler only behind.
          if (r.next() < 0.55 || d < 3.5) this.giants.add(r.next() < 0.55 ? 'fir' : 'elder', jx, y, jz, 0.8 + r.next() * 0.3);
          else this.trees.add(r.pick(['oak', 'maple'] as TreeSpecies[]), jx, y, jz, 1.2 + r.next() * 0.4, undefined, 1);
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
    // Seat the abutments on the lower of the two banks (the deck ends flush with the trail).
    const bank = Math.min(
      this.terrain.heightAt(BRIDGE.x + BRIDGE_DIR.x * BRIDGE.len * 0.5, BRIDGE.z + BRIDGE_DIR.z * BRIDGE.len * 0.5),
      this.terrain.heightAt(BRIDGE.x - BRIDGE_DIR.x * BRIDGE.len * 0.5, BRIDGE.z - BRIDGE_DIR.z * BRIDGE.len * 0.5),
    );
    bridge.position.set(BRIDGE.x, Math.max(WATER_LOW + 0.2, bank - 0.24), BRIDGE.z);
    bridge.rotation.y = BRIDGE.rot;
    this.root.add(bridge);
    this.staticRoots.push(bridge);
    // Winter: icicles fringe the stringers and handrails (toggled in setSeason).
    this.bridgeIce = buildBridgeIcicles(r.fork('bridge-ice'), BRIDGE.len);
    this.bridgeIce.position.copy(bridge.position);
    this.bridgeIce.rotation.y = BRIDGE.rot;
    this.bridgeIce.visible = false;
    this.root.add(this.bridgeIce);
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

  /**
   * Winter drifts (terrain `aDrift`, raised with the snow cover): wind-blown banks piled against the
   * windward side of every trunk, boulder and log, a deep bank along the foot of the cliffs, and a
   * gentle rolling undulation everywhere else; trampled flat on the paths.
   */
  private bakeDrifts(): void {
    const S = this.shape;
    const obst = [...this.obstacles];
    for (const g of this.giants.handles) obst.push({ x: g.x, z: g.z, r: (g.kind === 'elder' ? 1.2 : 0.8) * g.scale });
    for (const [x, z, rot, len, rad] of LOGS) {
      for (let k = -len / 2; k <= len / 2; k += 0.8) obst.push({ x: x + Math.cos(rot) * k, z: z - Math.sin(rot) * k, r: rad });
    }
    const wind = globalUniforms.uWindDir.value;
    this.terrain.setDrift((x, z) => {
      if (this.terrain.heightAt(x, z) < WATER_LOW + 0.04) return 0;
      let d = 0;
      for (const o of obst) {
        const dx = x - o.x;
        const dz = z - o.z;
        if (Math.abs(dx) > o.r + 3 || Math.abs(dz) > o.r + 3) continue;
        const l = Math.hypot(dx, dz);
        const gap = l - o.r;
        // Snow piles up on the windward face (wind blows towards +windDir).
        const windward = 0.55 + 0.45 * -((dx * wind.x + dz * wind.y) / Math.max(l, 1e-3));
        d = Math.max(d, THREE.MathUtils.smoothstep(gap, 2.6, 0.1) * windward * 1.9);
      }
      const pd = S.plateauDist(x, z);
      if (pd > 0) d = Math.max(d, THREE.MathUtils.smoothstep(pd, 3.0, 0.6) * 1.6);
      const und = 0.55 * THREE.MathUtils.smoothstep(S.noise.fbm(x * 0.14 + 3, z * 0.14, 2), -0.3, 0.6);
      return Math.min(2.6, (d + und) * (1 - S.pathValue(x, z) * 0.85));
    });
  }

  /** Inside a demo staging spot (kept clear of ferns / shrubs / tufts)? */
  private staged(x: number, z: number): boolean {
    for (const [sx, sz, r] of STAGE_SPOTS) if (Math.hypot(x - sx, z - sz) < r) return true;
    return false;
  }

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
        if (this.staged(jx, jz)) continue;
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
        if (this.terrain.heightAt(tx, tz) < WATER_LOW + 0.05 || this.staged(tx, tz)) continue;
        if (r.next() < 0.35) place('fern', tx, tz, { scale: 0.8 + r.next() * 0.5 });
        else tuft(tx, tz, 0.7 + r.next() * 0.4);
      }
      if (solid) this.grid.setObject(Math.floor(x), Math.floor(z), { kind: 'boulder', id: 'boulder', solid: true });
      this.obstacles.push({ x, z, r: rad });
    };
    for (let i = 0; i < 30; i++) {
      const x = 6 + r.next() * 54;
      const z = 12 + r.next() * 46;
      if (!this.freeTile(x, z) || S.streamCarve(x, z) > 0.1 || this.staged(x, z)) continue;
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

  /**
   * Winter-only floor dressing (the summer understory dies back under the snow): winterberry bushes
   * with red berry clusters and dead twigs / dry stalks poking through the snow, scattered over the
   * open floor so the snowfield never reads as an empty white sheet.
   */
  private placeWinterFloor(): void {
    const r = this.rng.fork('winter-floor');
    const berries = [0, 1, 2].map((v) => new InstancedSet(`winterberry-${v}`, buildWinterBerry(r.fork(`b${v}`)), this.pool));
    const twigs = [0, 1, 2].map((v) => new InstancedSet(`wintertwig-${v}`, buildWinterTwigs(r.fork(`t${v}`)), this.pool));
    const put = (set: InstancedSet, x: number, z: number, s: number) =>
      set.add(new THREE.Matrix4().compose(new THREE.Vector3(x, this.terrain.heightAt(x, z) - 0.02, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6.28), new THREE.Vector3(s, s * (0.85 + r.next() * 0.3), s)));
    // Fallen branches, snow hummocks (buried stones / stumps) and hare trails: about one feature per
    // 4 m² of open snow, so a winter clearing is never a flat empty white field.
    const branches = [0, 1, 2].map((v) => new InstancedSet(`winterbranch-${v}`, buildFallenBranch(r.fork(`fb${v}`)), this.pool));
    const hummocks = [0, 1].map((v) => new InstancedSet(`winterhummock-${v}`, buildSnowHummock(r.fork(`h${v}`)), this.pool));
    const tracks = [0, 1].map((v) => new InstancedSet(`winterhare-${v}`, buildHareTracks(r.fork(`hr${v}`)), this.pool));
    const snowY = (x: number, z: number) => this.terrain.heightAt(x, z) + this.terrain.driftAt(x, z) * 0.2;
    // The open bank east of the footbridge trail (the right half of the snow-day view) gets a dressed
    // corner of its own: two berry thickets, a buried stone and a fallen bough.
    const ok = (x: number, z: number) => this.freeTile(x, z) && this.shape.pathValue(x, z) <= 0.05 && !this.staged(x, z);
    for (const [x, z, s] of [[43.3, 35.3, 1.25], [44.1, 35.9, 0.85], [45.9, 36.9, 1.1], [42.4, 32.2, 0.9]] as const) if (ok(x, z)) put(berries[0], x, z, s);
    if (ok(44.6, 33.4)) hummocks[0].add(new THREE.Matrix4().compose(new THREE.Vector3(44.6, snowY(44.6, 33.4) - 0.04, 33.4), new THREE.Quaternion(), new THREE.Vector3(1.3, 1.1, 1.3)));
    if (ok(41.9, 37.6)) branches[0].add(new THREE.Matrix4().compose(new THREE.Vector3(41.9, snowY(41.9, 37.6) - 0.025, 37.6), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(1.15, 1.15, 1.15)));
    for (let i = 0; i < 1500; i++) {
      const x = 2 + r.next() * 60;
      const z = 8 + r.next() * 52;
      if (!this.freeTile(x, z) || this.shape.pathValue(x, z) > 0.05 || this.staged(x, z)) continue;
      const u = r.next();
      // Evergreen berry bushes in small clumps of 1-3: the dark masses that give a snowfield its
      // value structure (a white sheet with lone tufts read as empty).
      if (u < 0.1) {
        const n = 1 + Math.floor(r.next() * 2.6);
        for (let k = 0; k < n; k++) {
          const a = r.next() * 6.28;
          const d = k === 0 ? 0 : 0.9 + r.next() * 0.5;
          const bx = x + Math.cos(a) * d;
          const bz = z + Math.sin(a) * d;
          if (k > 0 && (!this.freeTile(bx, bz) || this.shape.pathValue(bx, bz) > 0.05 || this.staged(bx, bz))) continue;
          put(r.pick(berries), bx, bz, (k === 0 ? 0.95 : 0.7) + r.next() * 0.55);
        }
      } else if (u < 0.36) put(r.pick(twigs), x, z, 0.8 + r.next() * 0.5);
      else if (u < 0.5) {
        const s = 0.85 + r.next() * 0.4;
        r.pick(branches).add(new THREE.Matrix4().compose(new THREE.Vector3(x, snowY(x, z) - 0.025, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6.28), new THREE.Vector3(s, s, s)));
      } else if (u < 0.6) {
        const s = 0.8 + r.next() * 0.6;
        r.pick(hummocks).add(new THREE.Matrix4().compose(new THREE.Vector3(x, snowY(x, z) - 0.04, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6.28), new THREE.Vector3(s, s * (0.8 + r.next() * 0.4), s)));
      } else if (u < 0.625) {
        r.pick(tracks).add(new THREE.Matrix4().compose(new THREE.Vector3(x, snowY(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.next() * 6.28), new THREE.Vector3(1, 1, 1)));
      }
    }
    this.buildSnowCollars(snowY);
  }

  /**
   * Winter drift collars: snow banks up against every giant's foot in a soft lumpy mound, burying
   * the root tips so only the arching knees break the surface as rounded humps (seen from the game
   * camera, fully exposed snow-capped roots read as a ring of white-topped fins). One merged mesh
   * that follows the terrain + drift height, with a cool contact shade where it meets the bark.
   */
  private buildSnowCollars(snowY: (x: number, z: number) => number): void {
    const RAD = 32;
    const RINGS = 9;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (const h of this.giants.handles) {
      // Only the walkable map: the rim forest beyond it is seen through fog / from far above.
      if (h.x < -3 || h.x > FOREST_SIZE.w + 3 || h.z < -3 || h.z > FOREST_SIZE.d + 3) continue;
      const elder = h.kind === 'elder';
      const s = h.scale;
      const R = (elder ? 3.4 : 2.1) * s;
      const rIn = (elder ? 0.72 : 0.42) * s;
      const peak = (elder ? 1.35 : 0.66) * s;
      const sd = h.seed * 97;
      const base = pos.length / 3;
      for (let i = 0; i <= RINGS; i++) {
        const t = i / RINGS;
        for (let j = 0; j < RAD; j++) {
          const a = (j / RAD) * Math.PI * 2;
          const Rj = R * (0.84 + 0.14 * Math.sin(a * 3 + sd) + 0.08 * Math.sin(a * 5 + sd * 1.7));
          const rr = THREE.MathUtils.lerp(rIn, Rj, t);
          const x = h.x + Math.cos(a) * rr;
          const z = h.z + Math.sin(a) * rr;
          // Rounded shoulder near the trunk easing out to nothing at the rim (slightly sunk there so
          // the edge melts into the ground snow instead of drawing a line).
          const lump = 0.8 + 0.22 * Math.sin(a * 3 + sd * 2.3) + 0.08 * Math.sin(a * 5 + sd);
          // Never banked up out of the (frozen) stream or the pool: it thins away over the water.
          const sd2 = this.shape.stream.nearest(x, z, 4)?.d ?? 9;
          const dry = THREE.MathUtils.smoothstep(sd2, 1.3, 2.6) * THREE.MathUtils.smoothstep(Math.hypot(x - POOL.x, z - POOL.z), POOL.r + 0.4, POOL.r + 1.8);
          const hgt = peak * (1 - THREE.MathUtils.smoothstep(t, 0, 1)) * Math.pow(1 - t, 0.3) * lump * dry;
          pos.push(x, snowY(x, z) + hgt - 0.035, z);
          const shade = THREE.MathUtils.smoothstep(t, 0, 0.3);
          col.push(0.8 + 0.2 * shade, 0.85 + 0.15 * shade, 0.97 + 0.03 * shade);
        }
      }
      for (let i = 0; i < RINGS; i++)
        for (let j = 0; j < RAD; j++) {
          const a = base + i * RAD + j;
          const b = base + i * RAD + ((j + 1) % RAD);
          const c = a + RAD;
          const d = b + RAD;
          idx.push(a, b, c, b, d, c);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, winterTwigMaterial());
    m.name = 'snow-collars';
    m.receiveShadow = true;
    m.userData.perfTag = 'nature';
    m.visible = false;
    this.snowCollars = m;
    this.root.add(m);
  }

  // ───────────────────────────────────────────── light shafts

  /**
   * Light-shaft anchors (ground end of each beam). A handful of wide hero beams framed for the
   * pool, the clearing and the glade, plus a few narrow ones under the canopy edges of the giants
   * nearest the trails (not one per tree: dozens of faint beams read as haze, not shafts).
   */
  private raySpots(): { x: number; y: number; z: number; w: number }[] {
    const r = this.rng.fork('rays');
    const out: { x: number; y: number; z: number; w: number }[] = [];
    for (const [x, z, w] of [
      [POOL.x + 2.6, POOL.z + 1.4, 0.7],
      [POOL.x - 2.8, POOL.z - 0.6, 0.5],
      [POOL.x + 0.2, POOL.z + 3.6, 0.4],
      // (not over the mossy log east of the pool: a log standing in a beam read as a translucent ghost)
      [POOL.x - 1.4, POOL.z + 6.2, 0.55],
      [GLADE.x - 1.5, GLADE.z + 1, 0.8],
      [GLADE.x + 2.5, GLADE.z - 1.5, 0.55],
      [GLADE.x - 3.8, GLADE.z - 2.2, 0.4],
      [33.5, 24.5, 0.7],
      [30.5, 34, 0.55],
      [38.4, 31.6, 0.45],
      // The footbridge reach (fog mornings are staged there).
      [40.6, 42.6, 0.6],
      [37.2, 40.8, 0.45],
      [43.4, 46.8, 0.5],
    ] as const) {
      out.push({ x, y: this.terrain.heightAt(x, z), z, w });
    }
    for (const g of this.giants.handles) {
      if (out.length >= 16) break;
      if (g.x < 6 || g.x > 60 || g.z < 12 || g.z > 56 || g.kind !== 'elder') continue;
      const a = r.next() * Math.PI * 2;
      const d = g.radius * (0.6 + r.next() * 0.3);
      const x = g.x + Math.cos(a) * d;
      const z = g.z + Math.sin(a) * d;
      out.push({ x, y: this.terrain.heightAt(x, z), z, w: 0.3 + r.next() * 0.3 });
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
    const day = `forage:${c.year}:${c.season}:${c.day}`;
    const ledger = this.game.services.forageNet;
    this.forageDay = day;
    this.awaiting.clear();
    this.forage.spawn(
      day,
      c.season,
      this.forageSpots,
      11,
      (tx, tz, item) => {
        if (ledger?.isPicked(tx, tz, day)) return 'picked';
        if (this.grid.getObject(tx, tz)) return false;
        this.grid.setObject(tx, tz, { kind: 'forage', id: item.def.id, solid: false, onRemove: () => this.forage.remove(tx, tz) });
        return true;
      },
      // Yesterday's finds give their tiles back (else they pile up as invisible ghosts).
      (tx, tz) => this.releaseTile(tx, tz),
    );
  }

  /** Free a forage tile in the grid (only if it still holds a forage entry). */
  private releaseTile(tx: number, tz: number): void {
    if (this.grid.getObject(tx, tz)?.kind === 'forage') this.grid.setObject(tx, tz, null);
  }

  /** Nearest live find within `r` of (x, z) (demos, bots). */
  forageNear(x: number, z: number, r: number): { tx: number; tz: number; x: number; z: number } | null {
    let best: { tx: number; tz: number; x: number; z: number } | null = null;
    let bd = r;
    for (const it of this.forage.items.values()) {
      const d = Math.hypot(it.pos.x - x, it.pos.z - z);
      if (d < bd) {
        bd = d;
        best = { tx: it.tx, tz: it.tz, x: it.pos.x, z: it.pos.z };
      }
    }
    return best;
  }

  /** Forage objects in the grid (tests: must never exceed the day's finds). */
  forageTiles(): number {
    let n = 0;
    this.grid.forEach((x, z) => {
      if (this.grid.getObject(x, z)?.kind === 'forage') n++;
    });
    return n;
  }

  private pick(x: number, z: number): void {
    if (this.game.world.current !== this || this.pluck.active) return;
    // Facing tile first, then the tile underfoot.
    const p = this.game.player.position;
    for (const [tx, tz] of [[x, z], [Math.floor(p.x), Math.floor(p.z)]] as const) {
      const o = this.grid.getObject(tx, tz);
      if (o?.kind !== 'forage') continue;
      const it = this.forage.take(tx, tz);
      this.grid.setObject(tx, tz, null);
      // A stale entry (no find behind it) must not swallow the interact: try the next tile.
      if (!it) continue;
      const verdict = this.game.services.forageNet?.claim(tx, tz) ?? 'grant';
      if (verdict === 'deny') {
        this.forage.drop(it);
        continue;
      }
      // Face the find, crouch, pluck on the grab frame.
      const dx = it.pos.x - p.x;
      const dz = it.pos.z - p.z;
      if (Math.hypot(dx, dz) > 0.25) this.game.player.setFacing(Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : dz > 0 ? 'down' : 'up');
      this.pluck.start(() => {
        this.forage.pluck(it, (world) => {
          if (verdict === 'grant') this.grant(it, world);
          else this.awaiting.set(forageKey(tx, tz), it);
        });
        this.game.events.emit('tool:impact', { tool: 'hand', x: tx, z: tz, hit: 'crop', strength: 0.6 });
      });
      return;
    }
  }

  /** The find is ours: item, toolbar flight, events. */
  private grant(it: ForageItem, world = it.pos.clone().setY(it.pos.y + 0.6)): void {
    this.game.events.emit('item:give', { itemId: it.def.id, qty: 1 });
    this.game.events.emit('forage:picked', { itemId: it.def.id, x: it.tx, z: it.tz, map: this.id });
    if (this.game.world.current !== this) return;
    try {
      const v = world.clone().project(this.game.rc.camera);
      const el = this.game.rc.renderer.domElement.getBoundingClientRect();
      const inv = this.game.services.inventory;
      const slot = inv ? inv.slots.findIndex((s) => s?.id === it.def.id) : -1;
      // Past the ten toolbar slots the find lands on the bar itself (it squash-bumps), never on a
      // hidden backpack row the farmer cannot see.
      const bar = this.game.opts.uiRoot.querySelectorAll('.hv-toolbar .u-slot').length || 10;
      const visible = Math.min(10, bar);
      flyItemToToolbar(this.game.opts.uiRoot, it.def.id, { x: el.left + (v.x * 0.5 + 0.5) * el.width, y: el.top + (-v.y * 0.5 + 0.5) * el.height }, slot < visible ? slot : -1, 0, { duration: 520, bounce: 1.2 });
    } catch {
      /* HUD not mounted (tests) */
    }
  }

  // ───────────────────────────────────────────── runtime

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** Open sky over (x, z)? (weather: lightning only lands where the bolt can be seen.) */
  openSky(x: number, z: number): boolean {
    if (this.shape.rimDist(x, z) > -1.5 || this.shape.plateauMask(x, z) > 0.1 || this.shape.plateauDist(x, z) < 4) return false;
    for (const g of this.giants.handles) {
      if (Math.hypot(x - g.x, z - g.z) < g.radius * (g.kind === 'elder' ? 1.05 : 0.8) + 0.6) return false;
    }
    return this.terrain.heightAt(x, z) > WATER_LOW - 0.1;
  }

  clearGroundCover(x: number, z: number): void {
    this.grass.clearTile(x, z);
  }

  private fogBoost = 0;
  private bridgeIce: THREE.Object3D | null = null;
  private snowCollars: THREE.Mesh | null = null;
  /** Morning-fog boost for the light shafts (set by the weather system through `setAtmosphere`). */
  /** Demo stills: show the arrival plate and hold it. */
  showArrivalCard(pin = true): void {
    this.card.show(this.areaName, this.season);
    if (pin) setTimeout(() => this.card.pin(), 900);
  }

  setAtmosphere(fog: number): void {
    this.fogBoost = fog;
  }

  update(dt: number, game: Game): void {
    this.grass.update(game.rc.rig.focus);
    const buf = game.rc.renderer.getDrawingBufferSize(this.bufSize);
    // The entry corridor (farm gate → first clearing) opens a ~4-tile window: the first view of
    // Cindergrove must be the forest floor and the farmer, not a wall of crowns.
    const pp = game.player.position;
    const entry = THREE.MathUtils.smoothstep(pp.z, 15, 9) * THREE.MathUtils.smoothstep(Math.abs(pp.x - ENTRY.x), 7, 3);
    updateSeeThrough(game.rc.camera, pp, buf.x, buf.y, entry);
    const h = game.rc.renderer.domElement.height;
    const night = game.lighting.night;
    this.ambience.update(dt, game.time, game.rc.rig.focus, night, h);
    this.fx.update(dt, h);
    this.forage.update(dt, game.time, h);
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
    // Somebody keeps a lamp in the tower: a warm window by day, glowing after dusk (candle flicker).
    towerWindowMaterial().emissiveIntensity = (1.1 + night * 2.4) * (0.92 + 0.05 * Math.sin(t * 9.1) + 0.03 * Math.sin(t * 23.7));
    this.emberLight.intensity = (1.2 + night * 5) * breath;
    this.shrineGlow.intensity = globalUniforms.uLamps.value * 2.2;
    // Volumetric shafts through the canopy gaps: strong with a low sun / morning mist, off under overcast.
    const sun = globalUniforms.uSunColor.value;
    const lum = sun.r * 0.3 + sun.g * 0.5 + sun.b * 0.2;
    atmosphere.shaftList = this.shafts;
    atmosphere.shaftLen = 17;
    atmosphere.shafts = Math.max(0, 1 - globalUniforms.uRain.value * 1.2) * (1 - globalUniforms.uSnow.value * 0.4) * THREE.MathUtils.smoothstep(lum, 0.08, 0.5) * (1 - night) * (0.7 + this.fogBoost * 0.9);
    this.motes.update(t, this.shafts, atmosphere.shafts * (0.35 + this.fogBoost * 0.65), globalUniforms.uSunDir.value, game.rc.camera, h);
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
    if (this.bridgeIce) this.bridgeIce.visible = season === 'winter';
    if (this.snowCollars) this.snowCollars.visible = season === 'winter';
    setIvySeason(season);
    // Mushrooms are an autumn-to-summer thing: none poke through the winter snow; winterberries and
    // dead stalks only show up under it.
    for (const m of [...this.pool.meshesFor(fungusMaterial()), ...this.pool.meshesFor(glowcapMaterial())]) m.visible = season !== 'winter';
    for (const m of [...this.pool.meshesFor(winterLeafMaterial()), ...this.pool.meshesFor(winterBerryMaterial()), ...this.pool.meshesFor(winterTwigMaterial()), ...this.pool.meshesFor(winterTrackMaterial())]) m.visible = season === 'winter';
  }

  setWeather(weather: Weather): void {
    this.ambience.setWeather(weather);
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
