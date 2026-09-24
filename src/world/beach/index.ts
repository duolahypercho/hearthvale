/**
 * Driftsand Beach — the coast east of Hearthvale (town's east road → the boardwalk over the dunes).
 *
 * Assembly only; the pieces live next door:
 *   layout.ts    anchors + the height field (bluff → dunes → beach → sandbar → deep water)
 *   ocean.ts     stylised ocean (depth gradient, swash, breakers, foam lace, glints) + horizon clouds
 *   sand.ts      beach ground shading (wind ripples, wet band synced to the swash, wrack line, caustics)
 *   props.ts     pier, fisherman's shack, lighthouse, rowboat, driftwood, campfire, sand fence, boardwalk
 *   flora.ts     marram grass, sea thrift, wind-bent pines
 *   life.ts      gulls, crabs, leaping fish
 *   shells.ts    tide-line forageables (picked with interact) + tide-pool anemones / urchins
 *   tackle.ts / fishmesh.ts   fishing visuals (used by systems/fishing.ts on every map)
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { Rng } from '../../core/rng';
import { smoothstep } from '../../core/noise';
import type { Season, Weather } from '../../core/time';
import type { GameMap, MapWarp } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Terrain } from '../terrain';
import { GrassField } from '../grass';
import { MeshBuilder, mergeStatic } from '../geom';
import { Ambience, BurstFX, FireFX, SmokeEmitter } from '../../render/particles';
import { globalUniforms } from '../../render/uniforms';
import {
  BEACH_W,
  BEACH_D,
  BEACH_EXTENT,
  SEA_LEVEL,
  PIER,
  SHACK,
  LIGHTHOUSE,
  CAMPFIRE,
  ROWBOAT,
  TIDE_POOLS,
  TIDE_POOL_Y,
  BOARDWALK,
  SAND_FENCE,
  BEACH_WARPS,
  BEACH_SPAWN,
  GROYNE,
  BEACH_CLUSTERS,
  LIGHTHOUSE_PATH,
  BeachShape,
} from './layout';
import { addBeachRock, beachRockMaterial } from './rocks';
import { buildShelf, buildAlgaeTufts } from './shelf';
import { SeaProps, LampPools } from './sea';
import { createOcean, createHorizonClouds, setOceanPilings, setOceanLamps, createPoolWater } from './ocean';
import { applyBeachSand } from './sand';
import {
  buildPier,
  buildShack,
  buildLighthouse,
  buildRowboat,
  addDriftwood,
  addCampfire,
  addSandFence,
  addBoardwalk,
  addWrackLine,
  addBoatVignette,
  addCampVignette,
  addBeachSign,
  addSandcastle,
  addParasolVignette,
  setRailAvoid,
  type DriftKind,
  type Lighthouse,
} from './props';
import { BeachFlora } from './flora';
import { addNetRack, addPotStack, addDuneIsland } from './clusters';
import { BeachLife } from './life';
import { ShellField, buildTidePoolLife } from './shells';

export { BEACH_W, BEACH_D, SEA_LEVEL };

declare module '../../core/events' {
  interface GameEvents {
    /** A shell / sea star / sea glass was picked on Driftsand Beach. */
    'beach:forage': { itemId: string; x: number; z: number };
  }
}

export class BeachMap implements GameMap {
  readonly id = 'beach';
  readonly title = 'Driftsand Beach';
  readonly grid = new TileGrid(BEACH_W, BEACH_D);
  readonly root = new THREE.Group();
  readonly spawn = { x: BEACH_SPAWN.x, z: BEACH_SPAWN.z, facing: 'right' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(9, 9), new THREE.Vector2(71, 60));
  readonly warps: MapWarp[] = BEACH_WARPS;
  /** Sea level (read by the fishing system for the float height). */
  readonly waterLevel = SEA_LEVEL;
  readonly terrain: Terrain;
  readonly grass: GrassField;
  readonly shape: BeachShape;
  readonly poi: Record<string, { x: number; y?: number; z: number; rot?: number }[]> = {};
  private rng: Rng;
  private staticRoots: THREE.Object3D[] = [];
  private flora: BeachFlora;
  private life: BeachLife;
  private shells = new ShellField();
  private shellSpots: { x: number; y: number; z: number }[] = [];
  private ambience: Ambience;
  private fx = new BurstFX(160);
  private fire: FireFX;
  private fireLight: THREE.PointLight;
  private smoke: SmokeEmitter;
  private pools = new LampPools();
  private lighthouse: Lighthouse;
  private beamMat: THREE.ShaderMaterial;
  private clouds: THREE.Mesh;
  private ocean!: THREE.Group;
  private glintT = 0;
  private sea: SeaProps;
  /** Where the farmer stands to use the shack's Bait & Tackle honesty box. */
  private counter = new THREE.Vector3();
  private railAvoid: THREE.Vector3[] = [];

  constructor(private game: Game) {
    this.root.name = 'map:beach';
    const T = performance.now();
    const mark = (label: string) => console.debug(`[beach] ${label} ${(performance.now() - T).toFixed(0)}ms`);
    this.rng = game.rng.fork('beach');
    this.shape = new BeachShape(this.rng.fork('shape').seed);
    const S = this.shape;

    this.terrain = new Terrain({ ...BEACH_EXTENT, step: 0.5, height: (x, z) => S.height(x, z), waterLevel: SEA_LEVEL });
    applyBeachSand(this.terrain.material, SEA_LEVEL, TIDE_POOLS);
    this.root.add(this.terrain.mesh);
    this.paintGround();
    this.classifyTiles();
    mark('terrain');

    // Sea (near grid covers the shoreline + pier; flat far planes run to the horizon).
    const ocean = createOcean({ terrain: this.terrain, level: SEA_LEVEL, near: { x0: -26, z0: 28, x1: 106, z1: 104 } });
    this.root.add(ocean);
    this.ocean = ocean;
    this.clouds = createHorizonClouds();
    this.root.add(this.clouds);
    this.buildTidePools();
    mark('ocean');

    this.flora = new BeachFlora(this.rng.fork('flora'));
    const props = this.buildProps();
    this.lighthouse = props.lighthouse;
    this.beamMat = this.lighthouse.beam.material as THREE.ShaderMaterial;
    this.placeFlora();
    this.terrain.commitCover();
    this.root.add(this.flora.group);
    const merged = mergeStatic(this.staticRoots, 'beach-static');
    merged.userData.perfTag = 'props';
    // Render-budget trims: flat / tiny batches cast no shadow; stone (vertex-AO baked) skips GTAO.
    merged.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const n = (m.material as THREE.Material).name;
      // Wrack-line bits (kelp, shell chips 'white', eel-grass 'cloth'), nails, nets: no shadow, no AO.
      if (n === 'kelp' || n === 'metal' || n === 'netHeap' || n === 'boxFlower' || n === 'white') m.castShadow = false;
      if (n === 'beachRock' || n === 'kelp' || n === 'white' || n === 'metal') m.userData.noAO = true;
    });
    this.root.add(merged);
    mark('props');

    // Campfire (lit from late afternoon), shack stove smoke, pier lamp pools.
    this.fire = new FireFX([props.flame], 70);
    this.fire.object.userData.perfTag = 'fx';
    this.root.add(this.fire.object);
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 10, 1.7);
    this.fireLight.position.copy(props.flame).add(new THREE.Vector3(0, 0.7, 0));
    this.root.add(this.fireLight);
    this.smoke = new SmokeEmitter(props.chimney, 3.5);
    this.smoke.object.userData.perfTag = 'fx';
    this.root.add(this.smoke.object);
    this.root.add(this.pools.group);

    this.grass = new GrassField({
      bounds: { x0: -12, z0: -14, x1: 92, z1: 50 },
      density: (x, z) => this.grassDensity(x, z),
      tallness: (x, z) => 0.35 + 0.4 * smoothstep(-0.2, 0.5, S.n2fbm(x * 0.12, z * 0.12)),
      height: (x, z) => this.terrain.heightAt(x, z),
      seed: 'beach-grass',
      densityScale: game.rc.preset.grassDensity * 0.8,
      cover: this.terrain,
    });
    this.root.add(this.grass.group);
    mark(`grass (${this.grass.instanceCount})`);

    // Wildlife: gulls perch on the pier lamps + a driftwood log, crabs work the wet sand.
    const perches = props.lamps.map((l) => new THREE.Vector3(l.x + (l.x > PIER.x ? 0.2 : -0.2), PIER.deckY + 2.02, l.z));
    perches.push(new THREE.Vector3(36.2, this.terrain.heightAt(36.2, 36.6) + 0.34, 36.6));
    // Crabs: Poisson-disk scattered (≥ 2.5 m apart) over a deep band of wet + damp sand, never lined up.
    const crabs: THREE.Vector3[] = [];
    const cr = this.rng.fork('crabs');
    for (let tries = 0; tries < 400 && crabs.length < 12; tries++) {
      const x = 18 + cr.next() * 50;
      const band = cr.next();
      const z = S.shoreZ(x) - 0.5 - band * band * 6.5;
      if (Math.abs(x - PIER.x) < 2.6 || S.westRock(x, z) < 0.4 || S.eastHead(x, z) < 0.35 || S.groyneDist(x, z).d < 1.8) continue;
      if (Math.hypot(x - ROWBOAT.x, z - ROWBOAT.z) < 2 || Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z) < 3) continue;
      if (crabs.some((c) => Math.hypot(c.x - x, c.z - z) < 2.5)) continue;
      crabs.push(new THREE.Vector3(x, this.terrain.heightAt(x, z), z));
    }
    this.life = new BeachLife(this.rng.fork('life'), (x, z) => this.terrain.heightAt(x, z), SEA_LEVEL, perches, crabs);
    this.root.add(this.life.group);
    // Open water off the pier: a moored dory, the swim-area buoy line, drifting weed, a fish school.
    this.sea = new SeaProps(
      this.rng.fork('sea'),
      SEA_LEVEL,
      [
        [PIER.x - PIER.w / 2 - 0.3, 47.2],
        [43.2, 48.2],
        [37.8, 48.9],
        [34.2, 48.4],
      ],
      { x: 40.4, z: 54.6, rot: 0.32 },
      { x: 41.2, z: 51.4, r: 3.0 },
      // Kept out of the walkway cast corridor (x 37-48, z 50-55): at most one in the fishing frame.
      [
        [42.6, 57.9],
        [58.6, 53.2],
        [36.2, 45.6],
        [29.5, 55.0],
        [43.4, 61.8],
        [61.5, 58.4],
        [25.8, 50.2],
        [56.2, 47.0],
      ],
    );
    this.root.add(this.sea.group);

    // Motes and leaves drift over land only (over the sea they'd hang in the water): lift them out of view.
    this.ambience = new Ambience((x, z) => {
      const hh = this.heightAt(x, z);
      return hh < SEA_LEVEL - 0.05 ? 400 : hh;
    });
    this.root.add(this.ambience.group);
    this.fx.object.userData.perfTag = 'fx';
    this.root.add(this.fx.object);

    this.root.add(this.shells.group);
    this.collectShellSpots();
    this.respawnShells();
    game.events.on('day:start', () => this.respawnShells());
    game.events.on('season:change', () => this.respawnShells());
    game.events.on('player:interact', ({ x, z }) => this.pick(x, z));

    this.poi.pier = [{ x: PIER.x, y: PIER.deckY, z: PIER.head.z0 + 2 }];
    // The angler's kit on the walkway (east half): solid, the west half stays a path.
    this.blockRect(PIER.x + 0.35, 51.2, PIER.x + 1.3, 53.2, 'tackle-kit');
    this.poi.campfire = [{ x: CAMPFIRE.x, z: CAMPFIRE.z }];
    this.poi.shack = [{ x: SHACK.x, z: SHACK.z }];
    this.poi.tidepools = TIDE_POOLS.map(([x, z]) => ({ x, z }));
    mark('done');
  }

  // ───────────────────────────────────────────── ground

  private paintGround(): void {
    const S = this.shape;
    const t = this.terrain;
    // (+ the trodden track up the headland to the lighthouse door, ragged-edged.)
    t.paint('sand', (x, z) => Math.max(S.sandMask(x, z, S.height(x, z)), smoothstep(1.05, 0.45, this.pathDist(x, z) + S.n2fbm(x * 0.9, z * 0.9) * 0.3) * 0.9));
    // Rock shelf + headland flanks read as bare rock (path channel = the sand shader's rock tint).
    // (The west shelf is its own stone mesh now: the rock splat stays well inside it, so the coarse
    // splat never shows a stepped edge on the sand.)
    // (+ the sea stack off the headland: rock all the way down, never a sand cone.)
    t.paint('path', (x, z) => Math.max(smoothstep(-0.02, -0.25, S.westRock(x, z)), smoothstep(0.25, -0.1, S.eastHead(x, z)) * smoothstep(3.2, 1.2, S.height(x, z)), smoothstep(3.1, 2.3, Math.hypot(x - 69.5, z - 56.5))));
    t.commitSplat();
    const B = { x0: -20, z0: -16, x1: 100, z1: 60 };
    // Bluff top: clover in the hollows, dry straw along the dune edge.
    t.paintCover('clover', (x, z) => (1 - S.sandMask(x, z, S.height(x, z))) * smoothstep(0.1, 0.6, S.n2fbm(x * 0.14, z * 0.14) * 0.5 + 0.5) * 0.7, B);
    // (+ a wind-burnt, straw-coloured rim round the headland top, in ragged drifts.)
    t.paintCover('dry', (x, z) => smoothstep(8, 13, z) * smoothstep(15, 12, z) * 0.8 + smoothstep(0.55, 0.75, S.n2fbm(x * 0.2 + 9, z * 0.2) * 0.5 + 0.5) * 0.4 + smoothstep(-0.32, -0.06, S.eastHead(x, z)) * smoothstep(0.1, -0.05, S.eastHead(x, z)) * smoothstep(0.35, 0.65, S.n2fbm(x * 0.3 + 2, z * 0.3) * 0.5 + 0.5) * 0.7, B);
  }

  /** Distance to the lighthouse track (m). */
  private pathDist(x: number, z: number): number {
    let best = 99;
    for (let i = 0; i < LIGHTHOUSE_PATH.length - 1; i++) {
      const [ax, az] = LIGHTHOUSE_PATH[i]!;
      const [bx, bz] = LIGHTHOUSE_PATH[i + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  }

  private onPierDeck(x: number, z: number): boolean {
    const H = PIER.head;
    if (x >= H.x0 && x <= H.x1 && z >= H.z0 && z <= H.z1) return true;
    return Math.abs(x - PIER.x) <= PIER.w / 2 && z >= PIER.z0 && z <= H.z1;
  }

  private classifyTiles(): void {
    const g = this.grid;
    const S = this.shape;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const h = this.terrain.heightAt(cx, cz);
      g.height[i] = h;
      if (this.onPierDeck(cx, cz)) {
        g.type[i] = TileType.Floor;
        g.height[i] = Math.max(h, PIER.deckY);
        return;
      }
      // Map edges: bluff wall to the north, the headland cliffs east, scrub west (except the road).
      const edge = z < 2 || x > 77 || (x < 1 && !(z >= 16 && z <= 23));
      const slope = this.terrain.slopeAt(cx, cz);
      if (edge || slope < 0.72) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      if (h < SEA_LEVEL - 0.1) {
        g.type[i] = TileType.Water;
        g.flags[i] = TileFlag.WaterSource;
        return;
      }
      // Tide pools: wet, not walkable (and too small to fish).
      for (const [px, pz, pr] of TIDE_POOLS) {
        if (Math.hypot(cx - px, (cz - pz) * 1.15) < pr * 0.8) {
          g.type[i] = TileType.Water;
          g.flags[i] = TileFlag.Blocked;
          return;
        }
      }
      if (S.groyneDist(cx, cz).d < 1.2) {
        g.type[i] = TileType.Stone;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      if (S.westRock(cx, cz) < 0 || (S.eastHead(cx, cz) < 0.1 && h < 3)) g.type[i] = TileType.Stone;
      else g.type[i] = S.sandMask(cx, cz, h) > 0.5 ? TileType.Sand : TileType.Grass;
    });
    // The pier deck stands well above the sand: its flanks are only reachable from the root.
    for (let z = Math.floor(PIER.z0); z <= Math.ceil(PIER.head.z1); z++) {
      for (let x = Math.floor(PIER.head.x0) - 1; x <= Math.ceil(PIER.head.x1); x++) {
        const cx = x + 0.5;
        const cz = z + 0.5;
        if (this.onPierDeck(cx, cz) || !g.inBounds(x, z)) continue;
        const near = this.onPierDeck(cx - 1, cz) || this.onPierDeck(cx + 1, cz) || this.onPierDeck(cx, cz + 1);
        if (near && PIER.deckY - this.terrain.heightAt(cx, cz) > 0.45 && !g.hasFlag(x, z, TileFlag.WaterSource)) g.setFlag(x, z, TileFlag.Blocked, true);
      }
    }
  }

  private grassDensity(x: number, z: number): number {
    const t = this.terrain;
    const S = this.shape;
    const h = t.heightAt(x, z);
    if (h < 0.6 || t.slopeAt(x, z) < 0.78) return 0;
    const sand = S.sandMask(x, z, h);
    if (sand > 0.55) return 0;
    if (S.westRock(x, z) < 0.2) return 0;
    if (this.pathDist(x, z) < 0.9) return 0;
    const clump = smoothstep(-0.2, 0.5, S.n2fbm(x * 0.13 + 4, z * 0.13));
    // The headland top: a thick, wind-combed sward (not a mown lawn).
    const head = smoothstep(0.0, -0.25, S.eastHead(x, z));
    return (1.5 + clump * 3.4) * (1 - sand * 1.6) * (1 + head * 1.6);
  }

  private buildTidePools(): void {
    // Clear, still pool water (the ocean shader in pool mode); the terrain's rim lip hides the edge.
    // Water only over the pool bowls (never a sheet hanging past a lip).
    const S = this.shape;
    const w = createPoolWater(this.terrain, TIDE_POOL_Y, { x0: 2, z0: 39, x1: 19, z1: 53 }, (x, z) => TIDE_POOLS.some(([px, pz, pr]) => Math.hypot(x - px, (z - pz) * 1.15) < pr * 1.05) && S.height(x, z) < TIDE_POOL_Y + 0.04);
    this.root.add(w);
    this.root.add(buildShelf(S, this.rng.fork('shelf').seed));
    const algae = buildAlgaeTufts(S, this.rng.fork('algae'), (x, z) => S.height(x, z) + 0.05);
    algae.userData.noAO = true;
    this.root.add(algae);
    const life = buildTidePoolLife(this.rng.fork('tidepool'), TIDE_POOLS, (x, z) => this.terrain.heightAt(x, z));
    life.userData.noAO = true;
    this.root.add(life);
  }

  // ───────────────────────────────────────────── props

  private block(x: number, z: number, r: number, id: string): void {
    for (let tz = Math.floor(z - r); tz <= Math.floor(z + r); tz++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (Math.hypot(tx + 0.5 - x, tz + 0.5 - z) < r && this.grid.inBounds(tx, tz)) this.grid.setObject(tx, tz, { kind: 'prop', id, solid: true });
      }
    }
  }

  private blockRect(x0: number, z0: number, x1: number, z1: number, id: string): void {
    for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) if (this.grid.inBounds(x, z)) this.grid.setObject(x, z, { kind: 'prop', id, solid: true });
  }

  private buildProps(): { lamps: THREE.Vector3[]; flame: THREE.Vector3; chimney: THREE.Vector3; lighthouse: Lighthouse } {
    const r = this.rng.fork('props');
    const hAt = (x: number, z: number) => this.terrain.heightAt(x, z);
    const T = this.terrain;

    // Pier.
    const pier = buildPier(r.fork('pier'), hAt);
    setOceanPilings(this.ocean, pier.pilings);
    setOceanLamps(this.ocean, pier.lamps);
    this.root.add(pier.static);
    this.staticRoots.push(pier.static);
    for (const l of pier.lamps) {
      const light = new THREE.PointLight(0xffb060, 0, 7, 1.8);
      light.position.copy(l);
      this.root.add(light);
      this.game.lighting.addNightLight(light, 5);
      // Lamp pool on the planks only (centred on the deck so it never hangs out over the water).
      const onHead = l.z > PIER.head.z0;
      this.pools.add(onHead ? l.x - 1.3 : PIER.x, onHead ? l.z - 1.3 : l.z, PIER.deckY, onHead ? 2.1 : 2.0);
    }

    // Fisherman's shack.
    const shack = buildShack(r.fork('shack'));
    const sy = hAt(SHACK.x, SHACK.z);
    const ss = SHACK.scale;
    shack.group.position.set(SHACK.x, sy - 0.08, SHACK.z);
    shack.group.rotation.y = SHACK.rot;
    shack.group.scale.setScalar(ss);
    this.root.add(shack.group);
    shack.group.updateMatrixWorld(true);
    this.staticRoots.push(shack.group);
    T.stampCover('ao', SHACK.x, SHACK.z, 4.2 * ss, 0.55);
    this.blockRect(SHACK.x - (SHACK.d / 2 + 0.2) * ss, SHACK.z - (SHACK.w / 2) * ss, SHACK.x + (SHACK.d / 2) * ss, SHACK.z + (SHACK.w / 2 - 0.2) * ss, 'shack');
    const chimney = shack.anchors.chimney!.clone().applyMatrix4(shack.group.matrixWorld);
    this.counter.copy(shack.anchors.door!).applyMatrix4(shack.group.matrixWorld);
    this.poi.tackle = [{ x: this.counter.x, z: this.counter.z }];
    const lampW = shack.anchors.lamp!.clone().applyMatrix4(shack.group.matrixWorld);
    const sl = new THREE.PointLight(0xffa24a, 0, 6, 1.8);
    sl.position.copy(lampW);
    this.root.add(sl);
    this.game.lighting.addNightLight(sl, 4);
    this.pools.add(lampW.x, lampW.z, hAt(lampW.x, lampW.z), 2.8);
    this.pools.build();
    for (const l of shack.lights) {
      this.root.add(l.light);
      this.game.lighting.addNightLight(l.light, l.max);
    }

    // Lighthouse on the headland.
    const lh = buildLighthouse(r.fork('lighthouse'));
    lh.group.position.set(LIGHTHOUSE.x, hAt(LIGHTHOUSE.x, LIGHTHOUSE.z) - 0.25, LIGHTHOUSE.z);
    this.root.add(lh.group);
    // Keep the rotating beam out of the static merge.
    lh.group.remove(lh.beam);
    lh.beam.position.add(lh.group.position);
    this.root.add(lh.beam);
    this.staticRoots.push(lh.group);
    this.block(LIGHTHOUSE.x, LIGHTHOUSE.z, 2.6, 'lighthouse');
    const lamp = new THREE.PointLight(0xfff0c0, 0, 14, 1.6);
    lamp.position.copy(lh.lampPos).add(lh.group.position);
    this.root.add(lamp);
    this.game.lighting.addNightLight(lamp, 8);

    // Rowboat pulled up on the sand.
    const boat = buildRowboat(r.fork('boat'));
    boat.position.set(ROWBOAT.x, hAt(ROWBOAT.x, ROWBOAT.z) - 0.06, ROWBOAT.z);
    boat.rotation.set(0.04, ROWBOAT.rot, 0.1);
    this.root.add(boat);
    this.staticRoots.push(boat);
    T.stampCover('ao', ROWBOAT.x, ROWBOAT.z, 2.2, 0.5, 0.5);
    this.block(ROWBOAT.x, ROWBOAT.z, 1.3, 'rowboat');

    // Small stuff: driftwood, campfire ring, sand fences, boardwalk, coastal rocks.
    const b = new MeshBuilder();
    const flame = addCampfire(b, r, CAMPFIRE.x, hAt(CAMPFIRE.x, CAMPFIRE.z), CAMPFIRE.z);
    addCampVignette(b, r.fork('camp'), CAMPFIRE.x, CAMPFIRE.z, hAt);
    this.block(CAMPFIRE.x - 1.7, CAMPFIRE.z + 1.4, 0.4, 'crate');
    addBoatVignette(b, r.fork('boatv'), ROWBOAT.x, ROWBOAT.z, ROWBOAT.rot, hAt);
    addBeachSign(b, 26.2, 29.2, hAt);
    addSandcastle(b, r.fork('castle'), 45.6, 35.2, hAt);
    addParasolVignette(b, r.fork('parasol'), 41.6, 31.4, hAt);
    this.block(41.6, 31.4, 0.5, 'parasol');
    this.block(40.9, 31.8, 0.4, 'cooler');
    T.stampCover('ao', 42.1, 32.2, 1.6, 0.25);
    this.block(45.6, 35.2, 0.9, 'sandcastle');
    T.stampCover('ao', 45.6, 35.2, 1.2, 0.35);
    this.block(26.2, 29.2, 0.6, 'sign');
    T.stampCover('ao', CAMPFIRE.x, CAMPFIRE.z, 1.4, 0.6);
    this.block(CAMPFIRE.x, CAMPFIRE.z, 0.9, 'campfire');
    // Log benches around the fire.
    for (const [dx, dz, rot, len] of [[-1.9, 0.3, 1.45, 2.2], [0.4, 1.9, 0.1, 2.0], [1.6, -1.3, -0.7, 1.7]] as const) {
      const x = CAMPFIRE.x + dx;
      const z = CAMPFIRE.z + dz;
      addDriftwood(b, r, x, hAt(x, z) - 0.05, z, len, rot, 0.2, 'fork');
    }
    // Driftwood: four silhouettes, sizes 0.6-1.4x, never the same one twice in a row.
    const drift: [number, number, number, number, DriftKind][] = [
      [36, 36.8, 0.3, 3.8, 'log'], [45.4, 39.6, -0.5, 1.6, 'plank'], [24.6, 38.8, 0.9, 2.2, 'fork'], [63.2, 37.4, 2.6, 3.4, 'log'], [16.5, 34.4, -0.2, 1.0, 'stump'],
      [68.8, 34.2, 0.6, 1.5, 'plank'], [28.8, 30.2, 2.1, 1.4, 'fork'], [55.6, 38.8, 1.2, 0.9, 'stump'], [20.4, 32.2, -1.1, 2.6, 'fork'],
    ];
    for (const [x, z, rot, len, kind] of drift) {
      addDriftwood(b, r, x, hAt(x, z) - 0.04, z, len, rot, 0.12 + len * 0.025, kind);
      T.stampCover('ao', x, z, len * 0.45, 0.4, 0.5);
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      for (let k = -len / 2 + 0.4; k <= len / 2 - 0.4; k += 0.6) this.grid.setObject(Math.floor(x + c * k), Math.floor(z - s * k), { kind: 'prop', id: 'driftwood', solid: true });
    }
    addWrackLine(b, r.fork('wrack'), this.wrackLine(), hAt);
    // A second, sparser tide line down on the wet band (shells, kelp scraps the last tide left).
    addWrackLine(b, r.fork('wrack-low'), this.wrackLine(0.2, 0.45), hAt);
    // Mid-scale clusters on the open sand: a net drying on its rack, a stack of lobster pots, and two
    // fenced dune-grass islands (marram planted in placeFlora).
    for (const c of BEACH_CLUSTERS.nets) {
      addNetRack(b, r.fork(`net${c.x}`), c.x, c.z, c.rot, hAt);
      this.blockRect(c.x - 1.6, c.z - 0.7, c.x + 1.6, c.z + 0.7, 'net-rack');
      T.stampCover('ao', c.x, c.z, 1.8, 0.3, 0.5);
    }
    for (const c of BEACH_CLUSTERS.pots) {
      addPotStack(b, r.fork(`pots${c.x}`), c.x, c.z, c.rot, hAt);
      this.block(c.x, c.z, 0.9, 'lobster-pots');
      T.stampCover('ao', c.x, c.z, 1.1, 0.4, 0.5);
    }
    for (const c of BEACH_CLUSTERS.islands) {
      addDuneIsland(b, r.fork(`isle${c.x}`), c.x, c.z, c.rx, c.rz, hAt);
      this.block(c.x, c.z, Math.min(c.rx, c.rz) * 0.8, 'dune-island');
    }
    for (const f of SAND_FENCE) addSandFence(b, r, f, hAt);
    addBoardwalk(b, r, BOARDWALK, hAt);
    // Rocks (smooth, sea-worn; wet band + barnacles below the tide line): the west shelf rim, the
    // headland toe, a few awash in the surf.
    const rr = r.fork('rocks');
    const rock = (x: number, z: number, rad: number, squash: number, sink = 0.12): void => addBeachRock(b, rr, x, hAt(x, z) - rad * sink, z, rad, { squash });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rr.next() * 0.2;
      const x = 8 + Math.cos(a) * 11 * (0.95 + rr.next() * 0.15);
      const z = 45 + Math.sin(a) * 7.5 * (0.95 + rr.next() * 0.15);
      if (z < 38.5) continue;
      const rad = 0.6 + rr.next() * 0.9;
      rock(x, z, rad, 0.5 + rr.next() * 0.3);
      this.block(x, z, rad * 0.8, 'rock');
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.PI * (0.55 + rr.next() * 1.0);
      const x = 77 + Math.cos(a) * 9.5 * (1 + rr.next() * 0.12);
      const z = 42 + Math.sin(a) * 11.5 * (1 + rr.next() * 0.12);
      const rad = 0.8 + rr.next() * 1.3;
      rock(x, z, rad, 0.6 + rr.next() * 0.35, 0.2);
      this.block(x, z, rad * 0.8, 'rock');
    }
    // Shelf clutter: a few loose boulders + cobbles on the shelf (never inside a pool), for relief.
    for (let i = 0; i < 26; i++) {
      const x = -2 + rr.next() * 22;
      const z = 38 + rr.next() * 15;
      if (this.shape.westRock(x, z) > -0.08) continue;
      if (TIDE_POOLS.some(([px, pz, pr]) => Math.hypot(x - px, (z - pz) * 1.15) < pr * 1.3)) continue;
      const rad = 0.3 + rr.next() * 0.4;
      addBeachRock(b, rr, x, hAt(x, z) - rad * 0.12, z, rad, { squash: 0.5 + rr.next() * 0.25 });
    }
    for (const [x, z, rad] of [[69.5, 56.5, 1.6], [67.4, 57.8, 0.9], [71.4, 55.2, 1.1]] as const) rock(x, z, rad, 0.85, 0.25);
    // The groyne: boulders piled two abreast along the ridge, smaller + lower out into the surf.
    {
      const gr = r.fork('groyne');
      let acc = 0;
      for (let i = 0; i < GROYNE.length - 1; i++) {
        const [ax, az] = GROYNE[i]!;
        const [bx, bz] = GROYNE[i + 1]!;
        const L = Math.hypot(bx - ax, bz - az);
        const sx = -(bz - az) / L;
        const sz = (bx - ax) / L;
        for (let d = 0; d < L; d += 1.05) {
          const k = (acc + d) / 13;
          for (const side of [-1, 1]) {
            if (gr.next() < 0.15) continue;
            const x = ax + ((bx - ax) * d) / L + sx * side * (0.55 + gr.next() * 0.25);
            const z = az + ((bz - az) * d) / L + sz * side * (0.55 + gr.next() * 0.25);
            const rad = (gr.next() < 0.3 ? 0.4 + gr.next() * 0.2 : 0.62 + gr.next() * 0.6) * (1 - k * 0.2);
            addBeachRock(b, gr, x, hAt(x, z) - rad * 0.25, z, rad, { squash: 0.6 + gr.next() * 0.25, elong: 1 + gr.next() * 0.4 });
          }
          // A capstone on the crest now and then.
          if (gr.next() < 0.5) {
            const x = ax + ((bx - ax) * (d + 0.5)) / L;
            const z = az + ((bz - az) * (d + 0.5)) / L;
            addBeachRock(b, gr, x, hAt(x, z) - 0.05, z, 0.5 + gr.next() * 0.25, { squash: 0.55 });
          }
        }
        acc += L;
      }
    }
    // Bluff boulders.
    for (let i = 0; i < 10; i++) {
      const x = 4 + rr.next() * 66;
      const z = 3 + rr.next() * 8;
      const rad = 0.5 + rr.next() * 0.7;
      rock(x, z, rad, 0.65, 0.15);
      this.block(x, z, rad * 0.7, 'rock');
    }
    void beachRockMaterial;
    const small = b.build({ name: 'beach-bits' });
    this.root.add(small);
    this.staticRoots.push(small);

    return { lamps: pier.lamps, flame, chimney, lighthouse: lh };
  }

  /** Samples along a tide mark (default the high-tide mark, ~0.47 m above the sea) with a clumping weight. */
  private wrackLine(above = 0.47, weight = 1): { x: number; z: number; w: number }[] {
    const S = this.shape;
    const out: { x: number; z: number; w: number }[] = [];
    for (let x = 3; x < 76; x += 0.4) {
      if (Math.abs(x - PIER.x) < 2.3) continue;
      let z = S.shoreZ(x) - 9;
      while (z < S.shoreZ(x) && this.terrain.heightAt(x, z) > SEA_LEVEL + above) z += 0.1;
      if (S.westRock(x, z) < 0.35 || S.eastHead(x, z) < 0.35 || S.groyneDist(x, z).d < 1.6) continue;
      if (Math.hypot(x - ROWBOAT.x, z - ROWBOAT.z) < 2.2 || Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z) < 2.5) continue;
      const w = (0.25 + 0.75 * smoothstep(-0.25, 0.45, S.n2fbm(x * 0.13 + above * 9, 7.3))) * weight;
      out.push({ x, z, w });
    }
    return out;
  }

  // ───────────────────────────────────────────── flora

  private boardwalkDist(x: number, z: number): number {
    let best = 99;
    for (let i = 0; i < BOARDWALK.length - 1; i++) {
      const [ax, az] = BOARDWALK[i]!;
      const [bx, bz] = BOARDWALK[i + 1]!;
      const dx = bx - ax;
      const dz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  }

  private placeFlora(): void {
    const r = this.rng.fork('flora-place');
    const S = this.shape;
    const F = this.flora;
    const hAt = (x: number, z: number) => this.terrain.heightAt(x, z);
    // Marram on the dunes (thick on the crests, thinning towards the beach), thrift on the bluff edge.
    for (let z = 6; z < 32; z += 0.6) {
      for (let x = -8; x < 88; x += 0.6) {
        const jx = x + (r.next() - 0.5) * 0.6;
        const jz = z + (r.next() - 0.5) * 0.6;
        if (this.boardwalkDist(jx, jz) < 1.3) continue;
        if (Math.hypot(jx - PIER.x, 0) < 2.4 && jz > 26) continue;
        if (S.eastHead(jx, jz) < 0.3 || S.westRock(jx, jz) < 0.3) continue;
        const h = hAt(jx, jz);
        const s = jz - S.shoreZ(jx);
        const dune = smoothstep(-5, -12, s) * smoothstep(8, 13, jz);
        const clump = smoothstep(0.05, 0.5, S.n2fbm(jx * 0.2, jz * 0.2) + S.n2fbm(jx * 0.7 + 3, jz * 0.7) * 0.25);
        const p = dune * (0.025 + clump * 0.95);
        const roll = r.next();
        // Species mix by a second noise field: marram crests, sedge swales, holly / pea on the lee
        // slopes, thrift on the bluff edge.
        const mix = S.n2fbm(jx * 0.09 + 13, jz * 0.11);
        if (roll < p * 0.8) {
          if (mix < -0.25 && clump < 0.6) F.addSedge(jx, h, jz, 0.9 + r.next() * 0.5);
          else F.addMarram(jx, h, jz, 0.75 + r.next() * 0.55 + clump * 0.45);
          this.terrain.stampCover('ao', jx, jz, 0.5, 0.25);
        } else if (jz < 14 && jz > 9 && roll < p * 0.8 + 0.05) F.addThrift(jx, h, jz, 0.9 + r.next() * 0.6);
        else if (dune > 0.2 && roll < p * 0.8 + 0.035 * dune) {
          if (mix > 0.15) F.addHolly(jx, h, jz, 0.9 + r.next() * 0.5);
          else if (mix > -0.15) F.addPea(jx, h, jz, 0.9 + r.next() * 0.6);
          else F.addSedge(jx, h, jz, 0.8 + r.next() * 0.4);
        }
      }
    }
    // A few stray tufts down on the dry beach.
    for (let i = 0; i < 40; i++) {
      const x = 4 + r.next() * 70;
      const z = S.shoreZ(x) - 5 - r.next() * 6;
      if (Math.abs(x - PIER.x) < 2.5 || S.eastHead(x, z) < 0.3 || S.westRock(x, z) < 0.3) continue;
      if (Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z) < 3 || Math.hypot(x - SHACK.x, z - SHACK.z) < 4.5) continue;
      const k = r.next();
      if (k < 0.45) F.addMarram(x, hAt(x, z), z, 0.6 + r.next() * 0.4);
      else if (k < 0.7) F.addSedge(x, hAt(x, z), z, 0.8 + r.next() * 0.4);
      else if (k < 0.85) F.addPea(x, hAt(x, z), z, 0.9 + r.next() * 0.5);
      else F.addHolly(x, hAt(x, z), z, 0.8 + r.next() * 0.4);
    }
    // Marram + sedge crowding the fenced dune islands (thick in the middle, thinning to the fence).
    for (const c of BEACH_CLUSTERS.islands) {
      for (let i = 0; i < 26; i++) {
        const a = r.next() * Math.PI * 2;
        const k = Math.sqrt(r.next()) * 0.85;
        const x = c.x + Math.cos(a) * c.rx * k;
        const z = c.z + Math.sin(a) * c.rz * k;
        if (r.next() < 0.7) F.addMarram(x, hAt(x, z), z, 0.8 + (1 - k) * 0.6 + r.next() * 0.3);
        else if (r.next() < 0.6) F.addSedge(x, hAt(x, z), z, 0.8 + r.next() * 0.4);
        else F.addPea(x, hAt(x, z), z, 0.9 + r.next() * 0.4);
      }
      this.terrain.stampCover('ao', c.x, c.z, Math.max(c.rx, c.rz) * 1.1, 0.35, 0.6);
    }
    // The headland: cushions of sea thrift along the rim, wind-combed sedge + marram, beach pea in
    // the lee of the tower — never on the track or against the lighthouse plinth.
    for (let i = 0; i < 1500; i++) {
      const x = 67 + r.next() * 20;
      const z = 31 + r.next() * 23;
      const eh = S.eastHead(x, z);
      const h = hAt(x, z);
      if (eh > -0.04 || h < 2.2 || this.terrain.slopeAt(x, z) < 0.8) continue;
      if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 3.1 || this.pathDist(x, z) < 1.1) continue;
      const clump = smoothstep(-0.1, 0.45, S.n2fbm(x * 0.35 + 21, z * 0.35));
      if (r.next() > 0.14 + clump * 0.6) continue;
      const rim = smoothstep(-0.35, -0.08, eh);
      const k = r.next();
      if (k < 0.2 + rim * 0.45) F.addThrift(x, h, z, 0.9 + r.next() * 0.7);
      else if (k < 0.62) F.addSedge(x, h, z, 0.8 + r.next() * 0.5);
      else if (k < 0.88) F.addMarram(x, h, z, 0.6 + r.next() * 0.4);
      else F.addPea(x, h, z, 0.9 + r.next() * 0.5);
    }
    // Wind-bent pines along the bluff and on the headland; they lean inland (away from the sea).
    const pines: [number, number, number][] = [
      [-4, 4, 1.25], [3.5, 8.6, 1.05], [9, 3.2, 1.3], [15.5, 6.8, 1.1], [22, 2.2, 1.35], [29.5, 5.6, 1.0], [36, 1.6, 1.3],
      [44.5, 4.8, 1.15], [51, 1.2, 1.3], [58.5, 5.2, 1.05], [65, 2.4, 1.3], [72, 6.4, 1.1], [79, 3.2, 1.25], [86, 7, 1.2],
      [-10, 10, 1.3], [-12, 1, 1.35], [92, 2, 1.3], [80.5, 36.5, 1.0], [83, 45, 1.15], [72.8, 38.2, 0.85],
    ];
    for (const [x, z, s] of pines) {
      F.addPine(x, hAt(x, z), z, s * (0.95 + r.next() * 0.15), 0);
      this.terrain.stampCover('ao', x, z, 2.2 * s, 0.5);
      this.block(x, z, 0.7, 'pine');
    }
  }

  // ───────────────────────────────────────────── forage

  private collectShellSpots(): void {
    const S = this.shape;
    const r = this.rng.fork('shell-spots');
    for (let x = 4; x < 74; x++) {
      const zs = S.shoreZ(x + 0.5);
      for (let z = Math.floor(zs - 6); z <= Math.floor(zs - 0.5); z++) {
        if (!this.grid.inBounds(x, z) || !this.grid.isWalkable(x, z) || this.grid.getObject(x, z)) continue;
        if (this.grid.getType(x, z) !== TileType.Sand && this.grid.getType(x, z) !== TileType.Stone) continue;
        const cx = x + 0.25 + r.next() * 0.5;
        const cz = z + 0.25 + r.next() * 0.5;
        this.shellSpots.push({ x: cx, y: this.terrain.heightAt(cx, cz), z: cz });
      }
    }
  }

  private respawnShells(): void {
    const c = this.game.calendar;
    const r = this.rng.fork(`shells:${c.year}:${c.season}:${c.day}`);
    this.shells.spawn(r, c.season, this.shellSpots, 9, (tx, tz, it) => {
      if (!it) {
        const o = this.grid.getObject(tx, tz);
        if (o?.kind === 'forage') this.grid.setObject(tx, tz, null);
        return true;
      }
      if (this.grid.getObject(tx, tz)) return false;
      this.grid.setObject(tx, tz, { kind: 'forage', id: it.def.id, solid: false, onRemove: () => void this.shells.take(tx, tz) });
      return true;
    });
  }

  private pick(x: number, z: number): void {
    if (this.game.world.current !== this) return;
    const p = this.game.player.position;
    // The shack's honesty box: bait, tackle and rod upgrades.
    if (Math.hypot(p.x - this.counter.x, p.z - this.counter.z) < 2.4 || Math.hypot(x + 0.5 - this.counter.x, z + 0.5 - this.counter.z) < 1.6) {
      this.game.events.emit('ui:open', { name: 'tackle' });
      return;
    }
    for (const [tx, tz] of [[x, z], [Math.floor(p.x), Math.floor(p.z)]] as const) {
      const o = this.grid.getObject(tx, tz);
      if (o?.kind !== 'forage') continue;
      const it = this.shells.take(tx, tz);
      this.grid.setObject(tx, tz, null);
      if (!it) return;
      this.fx.emit(it.pos.clone().setY(it.pos.y + 0.15), { color: it.def.color, count: 12, speed: 1.3, size: 0.09, gravity: 4, up: 1.3 });
      this.fx.emit(it.pos.clone().setY(it.pos.y + 0.25), { color: 0xfff2b0, count: 8, speed: 0.9, size: 0.07, gravity: 0.3, up: 1.1, life: 0.9 });
      this.game.player.swing();
      this.game.events.emit('item:give', { itemId: it.def.id, qty: 1 });
      this.game.events.emit('beach:forage', { itemId: it.def.id, x: tx, z: tz });
      return;
    }
  }

  // ───────────────────────────────────────────── runtime

  heightAt(x: number, z: number): number {
    const h = this.terrain.heightAt(x, z);
    return this.onPierDeck(x, z) ? Math.max(h, PIER.deckY) : h;
  }

  clearGroundCover(x: number, z: number): void {
    this.grass.clearTile(x, z);
  }

  update(dt: number, game: Game): void {
    const focus = game.rc.rig.focus;
    this.grass.update(focus);
    const h = game.rc.renderer.domElement.height;
    const night = game.lighting.night;
    const t = game.time;
    this.ambience.update(dt, t, focus, night, h);
    this.fx.update(dt, h);
    const hr0 = game.calendar.hour;
    this.life.update(dt, t, game.player.position, h, game.rc.camera, hr0);
    this.sea.update(dt, t);
    this.sea.setNight(night);
    this.smoke.update(dt, night, h);
    this.pools.update();
    // Farmers at the pier rail: the rope makes way (local farmer + any remote / demo farmers here).
    {
      const av = this.railAvoid;
      av.length = 0;
      const near = (p: THREE.Vector3): boolean => Math.abs(p.x - PIER.x) < 6 && p.z > PIER.z0 - 1 && p.y > PIER.deckY - 0.6;
      if (near(game.player.position)) av.push(game.player.position);
      for (const o of game.scene.children) if (av.length < 4 && o.name === 'remote-farmer' && o.visible && near(o.position)) av.push(o.position);
      setRailAvoid(av);
    }
    // Campfire: lit from late afternoon until late night, out in the rain.
    const hr = game.calendar.hour;
    const lit = (hr >= 17 || hr < 1.5) && globalUniforms.uRain.value < 0.3;
    this.fire.active = lit;
    this.fire.update(dt, h);
    const flick = 0.8 + 0.2 * Math.sin(t * 9.1) * Math.sin(t * 5.3 + 1);
    this.fireLight.intensity = lit ? (1.4 + night * 5) * flick : 0;
    // Lighthouse: the beam sweeps once lamps are on.
    const lamps = globalUniforms.uLamps.value;
    this.lighthouse.beam.rotation.y = t * 0.55;
    this.beamMat.uniforms.uOpacity!.value = lamps * 0.5;
    this.lighthouse.beam.visible = lamps > 0.02;
    // Sparkle on the forageables now and then so they read at gameplay zoom.
    this.glintT -= dt;
    if (this.glintT <= 0 && this.shells.list.length) {
      this.glintT = 0.35 + Math.random() * 0.5;
      const it = this.shells.list[Math.floor(Math.random() * this.shells.list.length)]!;
      this.fx.emit(it.pos.clone().setY(it.pos.y + 0.12), { color: 0xfffbe0, count: 2, speed: 0.15, size: 0.12, gravity: -0.1, up: 0.2, life: 0.6 });
    }
  }

  setSeason(season: Season): void {
    this.flora.setSeason(season);
    this.ambience.setSeason(season);
  }

  setWeather(weather: Weather): void {
    this.ambience.setWeather(weather);
    this.clouds.visible = weather !== 'storm';
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
