/**
 * Summer — Tide Lantern Night at Driftglass Cove.
 *
 *   north  the sea: an inky night swell whose breaking waves glow electric cyan (bioluminescence),
 *          a long pier strung with crook lanterns, rowboats with lamps, hundreds of lotus lanterns
 *          drifting out on the tide and fireworks blooming over the water (mirrored in it)
 *   west   the rocky headland with the red-and-white lighthouse, its beam sweeping the bay
 *   middle the beach: the driftwood Wish Arch at the waterline where villagers raise their
 *          lanterns before setting them on the water, a bonfire ring with log benches, blankets,
 *          umbrellas, a sandcastle, cabanas
 *   south  dune grass, the boardwalk with lantern poles + strung lights, food stalls
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { smoothstep } from '../../core/noise';
import type { Rng } from '../../core/rng';
import { NPCS, NPC_IDS, type NpcLook } from '../../data/npcs';
import { OUTFIT_PALETTES } from '../../data/festivals';
import { TileType } from '../tiles';
import { buildMarketStall } from '../props/townkit';
import { buildBunting, buildLanternPole } from '../props/festival';
import { FestivalMap, type PlayState } from './base';
import type { ActionPose, PlayerRig } from '../../entities/player';
import { buildPier, buildLanternCrook, buildCabana, buildUmbrella, buildBlanket, buildBonfire, buildLighthouse, buildBeam, buildRowboat, buildSandcastle, buildWishArch } from './kit';
import { Fireworks, Lanterns, GlowPoints, Bonfire } from './fx';
import { NightSea, SEA_FEET } from './sea';
import { applyBeachSand } from '../beach/sand';
import { swashPhase, WAVE_PERIOD } from '../beach/ocean';
import { MeshBuilder, roundedBox, mat } from '../geom';
import { randomLook, shoulderLift, type CrowdSpec } from './crowd';

/** Per-frame scratch (no allocations in tick). */
const _glow = new THREE.Vector3();

const PIER = { x: 41.5, z0: 21.2, len: 17.5, deckY: 0.78, w: 2.4 };
const ARCH = { x: 31.5, z: 19.6 };
const FIRE = { x: 21.5, z: 27.2 };
const LIGHTHOUSE = { x: 4.2, z: 8.6 };

export class SummerLanterns extends FestivalMap {
  private sea!: NightSea;
  private fireworks!: Fireworks;
  private beam!: THREE.Mesh;
  private flashLight!: THREE.PointLight;
  private boats: { g: THREE.Group; x: number; z: number; rot: number; seed: number; glow: THREE.Vector3 }[] = [];
  private bonfire!: Bonfire;
  /** Villagers standing where the swash reaches (their feet light the plankton). */
  private waders: { x: number; z: number }[] = [];
  /** The player's recent steps through the shallows. */
  private trail: { x: number; z: number; t: number }[] = [];
  private trailClock = 0;
  private releasers: { i: number; seed: number }[] = [];
  private flashCol = new THREE.Color();
  /** Lantern Release mini-game: the lantern in your hands + the ones you let go. */
  private wish: { meshes: THREE.Group[]; glow: GlowPoints; held: number; sailing: { k: number; t0: number; x: number; z: number; q: number }[] } | null = null;

  constructor(game: Game) {
    super(game, {
      id: 'fest-summer',
      title: 'Tide Lantern Night · Driftglass Cove',
      size: { w: 64, d: 48 },
      extent: { minX: -20, minZ: -30, maxX: 84, maxZ: 68 },
      spawn: { x: 32, z: 33, facing: 'up' },
      bounds: [12, 8, 52, 38],
      terrain: { waterLevel: 0 },
      warps: [{ x0: 29, z0: 47, x1: 34, z1: 47, to: 'farm', x: 61.5, z: 28.5, facing: 'left' }],
    });
    this.activitySpots.push({ id: 'lanterns', x: ARCH.x, z: ARCH.z + 0.6, r: 2.8 });
    this.visitorSpots.push({ x: 28.6, z: 23.4, yaw: 2.6 }, { x: 35.0, z: 23.2, yaw: -2.7 });
    this.confettiColors = [0xffb050, 0xff8a60, 0x5fd8e8, 0xf6c8d8, 0xffffff];
  }

  // ───────────────────────────────────────────── shape

  private shoreZ(x: number): number {
    return 17.2 + 1.5 * Math.sin(x * 0.12 + 0.5) + 0.8 * Math.sin(x * 0.31 + 1.3);
  }

  private headland(x: number, z: number): number {
    const hd = Math.hypot((x - 3.5) / 8.5, (z - 10.5) / 9.5) + this.noise.fbm(x * 0.15, z * 0.15, 2) * 0.18;
    return smoothstep(1.12, 0.55, hd) * (2.4 + this.noise.fbm(x * 0.3 + 4, z * 0.3, 2) * 0.8);
  }

  private rimDist(x: number, z: number): number {
    // Hills south and at the sides (the sea stays open to the north).
    const qx = Math.abs(x - 32) - 23;
    const qz = z - 38;
    const d = Math.max(qx, qz);
    return d + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.2;
  }

  private exitMask(x: number, z: number): number {
    return smoothstep(3.2, 1.6, Math.abs(x - 31.5)) * smoothstep(40, 46, z);
  }

  protected height(x: number, z: number): number {
    const d = z - this.shoreZ(x);
    const n = this.noise;
    let h: number;
    // A swash berm: the sand steps up out of the water so the waterline crowd stands on dry sand.
    if (d >= 0) h = smoothstep(-0.2, 2.4, d) * 0.3 + smoothstep(0, 15, d) * 0.75 + smoothstep(12, 22, d) * (0.35 + n.fbm(x * 0.12, z * 0.12, 2) * 0.35);
    else h = -3.4 * (1 - Math.exp(d * 0.16)) + n.fbm(x * 0.2, z * 0.2, 2) * 0.12 * smoothstep(-1, -6, d);
    h += n.fbm(x * 0.4 + 7, z * 0.4, 2) * 0.05 * smoothstep(-0.5, 2, d);
    const rd = this.rimDist(x, z);
    h += (smoothstep(-0.5, 5, rd) * 1.6 + smoothstep(4, 18, rd) * (2.6 + n.fbm(x * 0.04 + 5, z * 0.04, 3) * 3)) * (1 - this.exitMask(x, z)) * smoothstep(-6, 4, d);
    const hl = this.headland(x, z);
    if (hl > 0.02) h = Math.max(h, hl + Math.min(0, h) * 0.2);
    return h;
  }

  private pathValue(x: number, z: number): number {
    // Boardwalk along the dunes + the path to the south exit.
    let v = smoothstep(1.2, 0.8, Math.abs(z - 33.2 - Math.sin(x * 0.2) * 0.4)) * smoothstep(8, 11, x) * smoothstep(58, 55, x);
    v = Math.max(v, smoothstep(1.1, 0.7, Math.abs(x - 31.5)) * smoothstep(33, 34, z));
    return v;
  }

  protected paint(): void {
    // Warm beach sand: dune ripples, a damp band + stranded foam lace in phase with the swash, shell
    // flecks (shared beach-sand shading; the path channel stays empty — it paints rock there).
    applyBeachSand(this.terrain.material, 0);
    this.terrain.paint('sand', (x, z) => {
      const d = z - this.shoreZ(x);
      return Math.max(smoothstep(15.5, 11, d + this.noise.fbm(x * 0.2, z * 0.2, 2) * 2.5) * (1 - smoothstep(0.6, 1.6, this.headland(x, z))), this.pathValue(x, z) * 0.85);
    });
    this.terrain.paintCover('dry', (x, z) => smoothstep(10, 16, z - this.shoreZ(x)) * 0.6, { x0: -2, z0: 10, x1: 66, z1: 50 });
  }

  protected override tileBlocked(x: number, z: number): boolean {
    if (this.onPier(x, z)) return false;
    const d = z - this.shoreZ(x);
    return d < -0.4 || (this.rimDist(x, z) > -0.2 && this.exitMask(x, z) < 0.5) || this.headland(x, z) > 1.2;
  }

  protected override tileType(x: number, z: number): TileType {
    if (this.onPier(x, z) || this.pathValue(x, z) > 0.5) return TileType.Stone;
    return this.terrain.splatAt(x, z, 'sand') > 0.5 ? TileType.Sand : TileType.Grass;
  }

  private onPier(x: number, z: number): boolean {
    return Math.abs(x - PIER.x) < PIER.w / 2 - 0.2 && z < PIER.z0 + 0.3 && z > PIER.z0 - PIER.len - 2.2;
  }

  override heightAt(x: number, z: number): number {
    if (this.terrain && this.onPier(x, z)) return Math.max(PIER.deckY + 0.04, this.terrain.heightAt(x, z));
    return super.heightAt(x, z);
  }

  protected grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.8) return 0;
    if (this.pathValue(x, z) > 0.2) return 0;
    const sand = t.splatAt(x, z, 'sand');
    if (sand > 0.7) return 0;
    const clump = smoothstep(-0.1, 0.45, this.noise.fbm(x * 0.2 + 4, z * 0.2, 2));
    return (1.5 + clump * 5) * (1 - sand);
  }

  protected override grassTallness(x: number, z: number): number {
    return 0.35 + 0.4 * smoothstep(0.0, 0.5, this.noise.fbm(x * 0.12, z * 0.12, 2));
  }

  // ───────────────────────────────────────────── dressing

  protected dress(): void {
    const r = this.rng.fork('dress');
    this.buildSea();
    this.buildPierAndBoats(r);
    this.buildBeach(r);
    this.buildBoardwalk(r);
    this.plantTrees(r);
    this.plantNature(r);
    this.buildCrowd(r);
    this.buildSky(r);
  }

  private poolK = 0;
  private boatGlow!: GlowPoints;

  private buildSea(): void {
    this.sea = new NightSea({ terrain: this.terrain, level: 0, near: { x0: -20, z0: -30, x1: 84, z1: 26 }, shoreward: new THREE.Vector2(0.05, 1), glow: 1.15 });
    this.root.add(this.sea.group);
  }

  private buildPierAndBoats(r: Rng): void {
    const pier = buildPier(r, PIER.len, PIER.w);
    const bp = this.addProp(pier.group, PIER.x, PIER.z0, 0, { y: PIER.deckY });
    void bp;
    // Crook lanterns along the pier + at the head.
    const crooks: [number, number, number][] = pier.lamps.map((l) => [PIER.x + l.x, PIER.z0 + l.z, l.x < 0 ? Math.PI : 0]);
    crooks.push([PIER.x - 2.1, PIER.z0 - PIER.len - 2.2, Math.PI], [PIER.x + 2.1, PIER.z0 - PIER.len - 2.2, 0]);
    crooks.forEach(([x, z, rot], i) => {
      const c = buildLanternCrook(r, [0xffb050, 0xff9a60, 0xffc870][i % 3]);
      this.addProp(c.group, x, z, rot, { y: PIER.deckY });
      const g = c.glow.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      this.glowPt(x + g.x, PIER.deckY + g.y, z + g.z, 0xffa850, 1.1, 0.08);
      // Every other pier lantern lays a warm pool on the water beside the pier.
      if (i % 2 === 0 && this.poolK < 6) this.sea.setPool(this.poolK++, x + g.x * 1.6, z + g.z, 1.8, 0.9);
    });
    // Rowboats on the water (bobbing, dynamic) + one hauled up on the sand.
    for (const [x, z, rot, tint] of [[27.5, 8.5, 0.5, 0x4f8fb0], [51.5, 6.2, -0.6, 0xd8573e], [35, 1.5, 0.15, 0xf2e6d0]] as const) {
      const b = buildRowboat(r, tint);
      b.group.userData.perfTag = 'boats';
      this.root.add(b.group);
      this.boats.push({ g: b.group, x, z, rot, seed: r.next() * 10, glow: b.glow.clone() });
    }
    this.boatGlow = new GlowPoints(this.boats.map(() => ({ x: 0, y: -50, z: 0, color: 0xffa850, size: 1.0, twinkle: 0.1 })), 'boat-glow');
    this.boatGlow.points.frustumCulled = false;
    this.boatGlow.points.userData.perfTag = 'boats';
    this.root.add(this.boatGlow.points);
    const beached = buildRowboat(r, 0x3f7a6a);
    this.addProp(beached.group, 13.8, 19.8, 1.9, { ao: 1.4 });
    const lh = buildLighthouse(r);
    this.addProp(lh.group, LIGHTHOUSE.x, LIGHTHOUSE.z, 0.3, { solidR: 1.6 });
    const lampY = this.H(LIGHTHOUSE.x, LIGHTHOUSE.z) - 0.03 + lh.lamp.y;
    this.beam = buildBeam();
    this.beam.position.set(LIGHTHOUSE.x, lampY, LIGHTHOUSE.z);
    this.beam.userData.perfTag = 'festival';
    this.root.add(this.beam);
    // The lamp room is a glow sprite + the sweeping beam (no point light: ≤ 3 dynamic lights a map).
    this.glowPt(LIGHTHOUSE.x, lampY, LIGHTHOUSE.z, 0xfff0c0, 3.2, 0.02);
  }

  private buildBeach(r: Rng): void {
    // Wish arch at the waterline.
    const arch = buildWishArch(r, 4.8);
    this.addProp(arch.group, ARCH.x, ARCH.z, 0, {});
    this.blockCircle(ARCH.x - 2.4, ARCH.z, 0.35);
    this.blockCircle(ARCH.x + 2.4, ARCH.z, 0.35);
    const ay = this.H(ARCH.x, ARCH.z);
    for (const l of arch.lamps) this.glowPt(ARCH.x + l.x, ay + l.y, ARCH.z + l.z, 0xffa850, 1.05, 0.07);
    this.addLight(ARCH.x, ay + 2.4, ARCH.z + 0.6, 0xffa860, 7, 0.05, 8);
    this.sea.setPool(this.poolK++, ARCH.x, this.shoreZ(ARCH.x) - 1.2, 2.6, 0.8);
    // Bonfire ring.
    const bf = buildBonfire(r);
    this.addProp(bf.group, FIRE.x, FIRE.z, 0.3, { solidR: 0.9, ao: 1.4 });
    const fy = this.H(FIRE.x, FIRE.z);
    // Flame tongues + rising embers (no bloom blob), smoke, a flickering fire light.
    this.bonfire = new Bonfire(new THREE.Vector3(FIRE.x, fy + 0.15, FIRE.z), 1.35);
    this.bonfire.group.userData.perfTag = 'fire';
    this.root.add(this.bonfire.group);
    this.addLight(FIRE.x, fy + 1.1, FIRE.z, 0xff8a3a, 9, 0.3, 10);
    this.addSmoke(new THREE.Vector3(FIRE.x, fy + 2.1, FIRE.z), 2.2);
    this.pools.add(FIRE.x, FIRE.z, fy, 3.2);
    // Beach life.
    this.addProp(buildCabana(r, [0x3a6aa8, 0xf6efe2]), 50.6, 28.6, -0.15, { solidRect: [2.4, 2.0], ao: 1.8 });
    this.addProp(buildCabana(r, [0xd8573e, 0xf6efe2]), 55.8, 27.6, -0.35, { solidRect: [2.4, 2.0], ao: 1.8 });
    this.addProp(buildUmbrella([0xf2b928, 0xf6efe2], 0.1), 46.4, 24.8, 0.4, { solidR: 0.3 });
    this.addProp(buildUmbrella([0x3aa8b0, 0xf6efe2], -0.12), 15.8, 25.4, 1.2, { solidR: 0.3 });
    this.addProp(buildUmbrella([0xf06a8a, 0xf6efe2], 0.14), 36.4, 27.8, 2.2, { solidR: 0.3 });
    this.addProp(buildBlanket(r, [0xd8573e, 0xf6efe2]), 26.8, 24.8, 0.2, {});
    this.addProp(buildBlanket(r, [0x3a6aa8, 0xf2e6d0]), 36.2, 25.8, -0.25, {});
    this.addProp(buildBlanket(r, [0xf2b928, 0x8a3a4a]), 46.8, 26.8, 0.4, {});
    this.addProp(buildSandcastle(r), 38.4, 22.6, 0.3, { solidR: 0.6 });
    // Driftwood + shells on the strand.
    for (const [x, z, rot] of [[10.5, 22.5, 0.4], [57.5, 21.5, -0.3], [44.6, 21.6, 1.2]] as const) this.nature.place('log', x, this.H(x, z), z, { rot, scale: 0.9, color: 0xc8b8a0 });
  }

  private buildBoardwalk(r: Rng): void {
    // Plank boardwalk along the dunes + the spur to the south exit.
    const bw = new MeshBuilder();
    for (let x = 8.6; x <= 56.6; x += 0.36) {
      const z = 33.2 + Math.sin(x * 0.2) * 0.4;
      const y = this.H(x, z) + 0.06;
      bw.add('woodGrain', roundedBox(0.32, 0.06, 1.9, 0.02, 1), mat(x, y, z, (r.next() - 0.5) * 0.03, Math.cos(x * 0.2) * 0.08 + (r.next() - 0.5) * 0.03, 0), { tint: r.next() < 0.2 ? 0xb8926a : 0xcaa47c });
    }
    for (let z = 34.4; z <= 47.5; z += 0.36) {
      const y = this.H(31.5, z) + 0.06;
      bw.add('woodGrain', roundedBox(1.7, 0.06, 0.32, 0.02, 1), mat(31.5, y, z, 0, (r.next() - 0.5) * 0.04, 0), { tint: r.next() < 0.2 ? 0xb8926a : 0xcaa47c });
    }
    this.addProp(bw.build({ name: 'boardwalk' }), 0, 0, 0, { y: 0 });
    const posts: THREE.Vector3[] = [];
    for (const x of [12, 20, 28, 35, 43, 51]) {
      const z = 31.2 + Math.sin(x * 0.2) * 0.4;
      this.addProp(buildLanternPole(r, posts.length), x, z, 0, { solidR: 0.4 });
      const y = this.H(x, z);
      for (const sx of [-1, 1]) this.glowPt(x + sx * 0.46, y + 2.9 - 0.55, z, 0xffa850, 0.9, 0.05);
      posts.push(new THREE.Vector3(x, y + 2.86, z));
    }
    for (let i = 0; i + 1 < posts.length; i++) this.addProp(buildBunting(r, posts[i]!, posts[i + 1]!, 0.55, 12, 3), 0, 0, 0, { y: 0 });
    // Food stalls.
    this.addProp(buildMarketStall(r, [0x3a6aa8, 0xf4ecd8]), 25.6, 35.6, 0.05, { solidRect: [2.8, 1.2], ao: 1.6, lights: 'none' });
    this.addProp(buildMarketStall(r, [0xf06a5a, 0xf4ecd8]), 38.2, 35.8, -0.05, { solidRect: [2.8, 1.2], ao: 1.6, lights: 'none' });
    for (const [x, z] of [[25.6, 35.0], [38.2, 35.2]] as const) {
      this.glowPt(x - 0.9, this.H(x, z) + 2.0, z + 0.5, 0xffc070, 0.9, 0.04);
      this.glowPt(x + 0.9, this.H(x, z) + 2.0, z + 0.5, 0xffc070, 0.9, 0.04);
      // Stall lamps: halo sprites + a warm pool decal on the boardwalk (faked, not a point light).
      this.pools.add(x, z + 1.0, this.H(x, z + 1), 2.2);
    }
  }

  private plantTrees(r: Rng): void {
    for (let z = -18; z < 66; z += 2.4) {
      for (let x = -18; x < 82; x += 2.4) {
        const jx = x + (r.next() - 0.5) * 2;
        const jz = z + (r.next() - 0.5) * 2;
        const d = this.rimDist(jx, jz);
        if (d < 1.2 || this.exitMask(jx, jz) > 0.2 || r.next() < 0.25) continue;
        if (jz - this.shoreZ(jx) < 6) continue;
        // Keep the lens clear south of the beach (arrival framing): no tall trees in the camera corridor.
        if (jz > 36 && jz < 54 && Math.abs(jx - 31.5) < 14) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.75) continue;
        const roll = r.next();
        const sp = roll < 0.55 ? 'pine' : roll < 0.85 ? 'oak' : 'maple';
        this.trees.add(sp, jx, this.H(jx, jz) - 0.08, jz, 0.85 + r.next() * 0.45, undefined, d > 2.2 ? 1 : 0);
      }
    }
    for (const [x, z, s] of [[9, 36, 1.0], [56, 36.5, 1.1], [13.5, 40.5, 0.9], [50.5, 41, 0.95]] as const) this.addTree('pine', x, z, s);
  }

  private plantNature(r: Rng): void {
    const g = this.grid;
    for (let z = 0; z < g.depth; z++) {
      for (let x = 0; x < g.width; x++) {
        const cx = x + 0.5 + (r.next() - 0.5) * 0.7;
        const cz = z + 0.5 + (r.next() - 0.5) * 0.7;
        if (!g.isWalkable(x, z)) continue;
        if (this.pathValue(cx, cz) > 0.1) continue;
        const d = cz - this.shoreZ(cx);
        const y = this.H(cx, cz);
        const roll = r.next();
        if (d > 11) {
          if (roll < 0.12) this.nature.place('reed', cx, y, cz, { scale: 1 + r.next() * 0.5, color: 0xb8b070 });
          else if (roll < 0.18) this.nature.place('tallGrass', cx, y, cz, { scale: 1.2 });
          else if (roll < 0.21) this.nature.place('bush', cx, y, cz, { scale: 0.7 + r.next() * 0.3, lod: 1 });
          else if (roll < 0.24) this.nature.place('flower', cx, y, cz, { color: [0xf6c8d8, 0xffffff, 0xf2b928][Math.floor(r.next() * 3)]! });
        } else if (d > 1.5 && roll < 0.05) {
          this.nature.place('pebbles', cx, y, cz, { scale: 0.8, color: 0xe8dcc8 });
        }
      }
    }
    // Rocks along the headland and the east point.
    for (let i = 0; i < 26; i++) {
      const a = r.next() * Math.PI * 2;
      const rr = 5 + r.next() * 5;
      const x = LIGHTHOUSE.x + Math.cos(a) * rr * 1.1;
      const z = LIGHTHOUSE.z + 1 + Math.sin(a) * rr;
      this.nature.place('boulder', x, this.H(x, z) - 0.3, z, { scale: 1.2 + r.next() * 1.4, rot: r.next() * 6 });
    }
    for (let i = 0; i < 10; i++) {
      const x = 58 + r.next() * 8;
      const z = 14 + r.next() * 8;
      this.nature.place('boulder', x, this.H(x, z) - 0.25, z, { scale: 0.8 + r.next() * 1.2, rot: r.next() * 6 });
    }
  }

  // ───────────────────────────────────────────── crowd

  private buildCrowd(r: Rng): void {
    const P = OUTFIT_PALETTES.summer;
    const specs: CrowdSpec[] = [];
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(r.next() * a.length)]!;
    const person = (look: NpcLook, anim: CrowdSpec['anim'], x: number, z: number, yaw: number, extra: Partial<CrowdSpec> = {}): number => {
      specs.push({ look, outfit: 'summer', anim, x, z, yaw, top: pick(P.tops), accent: pick(P.accents), hatTint: pick(P.hats), phase: r.next(), speed: 0.85 + r.next() * 0.3, ...extra });
      return specs.length - 1;
    };
    const warm = [0xffb050, 0xff8a60, 0xffc870, 0xf6c8d8];
    // Lantern releasers along the waterline, turned three-quarters to the sea (faces to camera).
    const shoreXs = [14.5, 17.2, 20.4, 23.6, 26.2, 29.0, 35.6, 38.0, 45.2, 48.4, 51.2, 54.6];
    shoreXs.forEach((x, k) => {
      const child = r.next() < 0.3;
      const z = this.shoreZ(x) + 0.7 + r.next() * 0.6;
      const yaw = Math.PI + (k % 2 ? -1 : 1) * (1.05 + r.next() * 0.35);
      const i = person(randomLook(r, { child, palette: P.tops }), child ? 'cheer' : 'lantern', x, z, yaw, { props: [child ? 'lanternPole' : 'lantern'], accent: pick(warm) });
      this.releasers.push({ i, seed: r.next() * 20 });
      this.waders.push({ x, z });
    });
    // Named villagers.
    const spot: Record<string, [number, number, number, CrowdSpec['anim'], CrowdSpec['props']]> = {
      marigold: [29.4, 21.3, Math.PI - 0.9, 'lantern', ['lantern']],
      bram: [25.6, 37.0, 0.3, 'talk', ['mug']],
      wren: [PIER.x - 0.5, PIER.z0 - PIER.len - 1.4, Math.PI + 0.9, 'cheer', ['lanternPole']],
    };
    // The bonfire: two sitters per driftwood log (seated on the log top, facing the fire).
    const seats: [number, number, number][] = [];
    for (const [a, rr] of [[0.5, 2.1], [2.4, 2.2], [4.1, 2.0]] as const) {
      const wa = a - 0.3;
      const cx = FIRE.x + Math.cos(wa) * (rr + 0.1);
      const cz = FIRE.z + Math.sin(wa) * (rr + 0.1);
      const tx = -Math.sin(wa);
      const tz = Math.cos(wa);
      for (const s2 of [-0.45, 0.45]) {
        const x = cx + tx * s2;
        const z = cz + tz * s2;
        seats.push([x, z, Math.atan2(FIRE.x - x, FIRE.z - z)]);
      }
    }
    let seatK = 0;
    const logTop = 0.37 - 0.46;
    let k = 0;
    const around: [number, number, number, CrowdSpec['anim'], CrowdSpec['props']][] = [
      [0, 0, 0, 'perch', ['mug']],
      [0, 0, 0, 'perch', ['mug']],
      [35.4, 20.8, Math.PI + 1.2, 'lantern', ['lantern']],
      [PIER.x + 0.6, PIER.z0 - PIER.len - 0.9, Math.PI - 0.9, 'lantern', ['lantern']],
      [47.2, 27.6, 0.4, 'sit', []],
      [36.0, 26.6, -0.5, 'sit', []],
      [18.4, 23.2, 0.6, 'wave', []],
    ];
    for (const id of NPC_IDS) {
      const def = NPCS[id];
      let s2 = spot[id] ?? around[k++ % around.length]!;
      if (s2[3] === 'perch') {
        const st = seats[seatK++]!;
        s2 = [st[0], st[1], st[2], 'perch', s2[4]];
      }
      const onPier = this.onPier(s2[0], s2[1]);
      const lift = onPier ? PIER.deckY + 0.02 - this.H(s2[0], s2[1]) : s2[3] === 'sit' ? 0.02 : s2[3] === 'perch' ? logTop : 0;
      person({ ...def.look }, s2[3], s2[0], s2[1], s2[2], { id, props: s2[4], lift, accent: pick(warm) });
    }
    // Pier-end lantern launchers.
    for (const [dx, dz, yaw] of [[-1.6, -1.8, Math.PI + 0.9], [1.4, -2.0, Math.PI - 1.0], [0.2, -2.6, Math.PI + 0.3]] as const) {
      const x = PIER.x + dx;
      const z = PIER.z0 - PIER.len + dz;
      person(randomLook(r, { palette: P.tops }), 'lantern', x, z, yaw, { props: ['lantern'], lift: PIER.deckY + 0.02 - this.H(x, z), accent: pick(warm) });
    }
    // The rest of the bonfire seats.
    while (seatK < seats.length) {
      const st = seats[seatK++]!;
      person(randomLook(r, { palette: P.tops, child: r.next() < 0.2 }), pick(['perch', 'perch', 'sway'] as const), st[0], st[1], st[2], { lift: logTop, props: r.next() < 0.4 ? ['mug'] : [] });
    }
    // A child on a grown-up's shoulders, both watching the fireworks over the bay.
    {
      const a = randomLook(r, { palette: P.tops });
      const c = randomLook(r, { palette: P.tops, child: true });
      person(a, 'lantern', 41.6, 24.4, Math.PI - 0.4, { pinned: true });
      person(c, 'ride', 41.6, 24.4, Math.PI - 0.4, { lift: shoulderLift(a, c), props: ['lanternPole'], accent: 0xffb050 });
    }
    // Blanket sitters + stall customers (turned to the camera / each other).
    person(randomLook(r, { palette: P.tops }), 'sit', 26.4, 24.6, 0.5, { lift: 0.02 });
    person(randomLook(r, { palette: P.tops }), 'sit', 27.4, 25.0, -0.6, { lift: 0.02 });
    person(randomLook(r, { palette: P.tops, child: true }), 'clap', 36.8, 25.2, 0.2, { lift: 0.02 });
    person(randomLook(r, { palette: P.tops }), 'talk', 38.0, 37.0, -0.6, {});
    person(randomLook(r, { palette: P.tops }), 'toast', 24.5, 37.2, 0.4, { props: ['mug'] });
    person(randomLook(r, { palette: P.tops }), 'sway', 42.6, 30.2, -0.4, { props: ['lantern'], accent: 0xffb050 });
    person(randomLook(r, { palette: P.tops, child: true }), 'cheer', 44.0, 29.6, 0.5, { props: ['lanternPole'], accent: 0xff8a60 });
    this.crowdSpecs = specs;
  }

  // ───────────────────────────────────────────── sky / water effects

  private buildSky(r: Rng): void {
    // Lotus lanterns set on the water from the shore + the pier head, drifting out on the tide.
    const pts: [number, number][] = [];
    for (let x = 13; x <= 56; x += 1.6) pts.push([x, this.shoreZ(x) - 0.4]);
    for (let i = 0; i < 6; i++) pts.push([PIER.x - 2.5 + i, PIER.z0 - PIER.len - 3.6]);
    const floating = new Lanterns({ count: 130, area: new THREE.Vector4(12, 58, 18, 34), seaY: 0.02, mode: 'float', rng: r.fork('float'), points: pts });
    floating.group.userData.perfTag = 'lanterns';
    this.root.add(floating.group);
    const sky = new Lanterns({ count: 26, area: new THREE.Vector4(14, 54, 20, 30), seaY: 1.2, mode: 'sky', rng: r.fork('sky'), points: pts.filter((_, i) => i % 3 === 0) });
    sky.group.userData.perfTag = 'lanterns';
    this.root.add(sky.group);
    // Shells burst low over the bay, inside the high diorama camera's frame (the sky is never in
    // shot), and read twice: once in the air and again as coloured reflections on the water.
    this.fireworks = new Fireworks({ area: new THREE.Vector4(28.5, 9.0, 14, 4), heights: new THREE.Vector2(4.4, 6.4), groundY: 0.2, shells: 8, sparks: 150, mirrorY: 0, spread: 1.0, size: 1.2 });
    this.fireworks.group.userData.perfTag = 'fireworks';
    this.root.add(this.fireworks.group);
    this.flashLight = new THREE.PointLight(0xffffff, 0, 60, 1.2);
    this.flashLight.position.set(33, 12, -2);
    this.root.add(this.flashLight);
  }

  // ───────────────────────────────────────────── runtime

  protected override lampLevel(game: Game): number {
    return Math.max(0.35, super.lampLevel(game));
  }

  protected override tick(dt: number, game: Game): void {
    const t = game.time;
    const h = game.rc.renderer.domElement.height;
    this.fireworks.setViewportHeight(h);
    this.boatGlow.setViewportHeight(h);
    this.wish?.glow.setViewportHeight(h);
    // Fireworks light the bay: flash light + warm tint on the water.
    const f = this.fireworks.flash(t, this.flashCol);
    const night = game.lighting.night;
    this.flashLight.color.copy(this.flashCol.r + this.flashCol.g + this.flashCol.b > 0 ? this.flashCol : this.flashLight.color);
    this.flashLight.intensity = Math.min(f, 2.5) * 16 * night;
    this.sea.flash.value.copy(this.flashCol).multiplyScalar(Math.min(f, 2) * 0.12 * night);
    this.fireworks.intensity.value = 0.25 + night * 0.75;
    // Lighthouse beam sweeps the bay.
    this.beam.rotation.y = t * 0.55;
    (this.beam.material as THREE.ShaderMaterial).visible = night > 0.2;
    // Boats bob on the swell; each lantern lays a warm pool on the water.
    this.bonfire.setViewportHeight(h);
    this.boats.forEach((b, k) => {
      const y = Math.sin(t * 1.1 + b.seed) * 0.05 + Math.sin(t * 0.7 + b.x * 0.3) * 0.03;
      b.g.position.set(b.x + Math.sin(t * 0.13 + b.seed) * 0.3, y - 0.14, b.z);
      b.g.rotation.set(Math.sin(t * 0.9 + b.seed) * 0.04, b.rot + Math.sin(t * 0.2 + b.seed) * 0.08, Math.sin(t * 1.2 + b.seed * 2) * 0.05);
      b.g.updateMatrixWorld();
      const gp = _glow.copy(b.glow).applyMatrix4(b.g.matrixWorld);
      this.boatGlow.set(k, gp.x, gp.y, gp.z, 1.0);
      this.sea.setPool(this.poolK + k, gp.x, gp.z, 1.6, 1.1);
    });
    // Feet in the swash light the plankton each time a wave runs up; the player leaves a trail.
    const feet = this.sea.feet.value;
    let fk = 0;
    for (const w of this.waders) {
      if (fk >= SEA_FEET - 5) break;
      const age = (((swashPhase(w.x, t) % 1) + 1) % 1) * WAVE_PERIOD;
      feet[fk++]!.set(w.x, w.z - 0.2, age, 0.8);
    }
    const p = game.player.position;
    this.trailClock -= dt;
    if (this.trailClock <= 0 && p.z - this.shoreZ(p.x) < 1.6) {
      this.trailClock = 0.3;
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.25) this.trail.push({ x: p.x, z: p.z, t });
      if (this.trail.length > 5) this.trail.shift();
    }
    for (const s of this.trail) if (fk < SEA_FEET) feet[fk++]!.set(s.x, s.z, t - s.t, 1.2);
    while (fk < SEA_FEET) feet[fk++]!.set(0, 0, 99, 0);
    this.updateWish(game);
    this.cheerT = Math.max(0, this.cheerT - dt);
    // Releasers: raise the lantern, stoop to set it on the water, straighten up and watch it go.
    const crowd = this.crowd;
    if (crowd && this.cheerT <= 0) {
      for (const p of this.releasers) {
        const m = crowd.members[p.i]!;
        if (m.spec.props?.includes('lanternPole')) continue;
        const ph = (t * 0.08 + p.seed) % 1;
        const a = ph < 0.72 ? 'lantern' : 'wave';
        crowd.setAnim(p.i, a);
      }
      crowd.commit();
    }
  }

  override stage(): void {
    super.stage();
  }

  // ───────────────────────────────────────────── Lantern Release mini-game

  private buildWishLanterns(): NonNullable<SummerLanterns['wish']> {
    const paper = new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xff9a40, emissiveIntensity: 1.6, roughness: 0.8, transparent: true, opacity: 0.96 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a3a1a, roughness: 0.9 });
    const body = new THREE.CylinderGeometry(0.17, 0.2, 0.3, 10, 1, true);
    const cap = new THREE.CylinderGeometry(0.06, 0.18, 0.06, 10);
    const base = new THREE.CylinderGeometry(0.21, 0.19, 0.05, 10);
    const petals = new THREE.ConeGeometry(0.34, 0.14, 8, 1, true);
    const petalMat = new THREE.MeshStandardMaterial({ color: 0xf6c8d8, emissive: 0xff7a9a, emissiveIntensity: 0.35, roughness: 0.7, side: THREE.DoubleSide });
    const meshes: THREE.Group[] = [];
    for (let k = 0; k < 6; k++) {
      const g = new THREE.Group();
      // Own paper per lantern: it takes the colour of its release (gold radiant … dim sputter).
      const b = new THREE.Mesh(body, paper.clone());
      b.name = 'paper';
      b.position.y = 0.2;
      const c = new THREE.Mesh(cap, wood);
      c.position.y = 0.38;
      const bs = new THREE.Mesh(base, wood);
      bs.position.y = 0.04;
      const lotus = new THREE.Mesh(petals, petalMat);
      lotus.rotation.x = Math.PI;
      lotus.position.y = 0.08;
      g.add(b, c, bs, lotus);
      g.visible = false;
      g.userData.perfTag = 'lanterns';
      this.root.add(g);
      meshes.push(g);
    }
    const glow = new GlowPoints(
      meshes.map(() => ({ x: 0, y: -50, z: 0, color: 0xffa850, size: 0, twinkle: 0.1, day: 1 })),
      'wish-glow',
    );
    glow.points.frustumCulled = false;
    glow.points.userData.perfTag = 'lanterns';
    this.root.add(glow.points);
    return { meshes, glow, held: 0, sailing: [] };
  }

  protected override onBeginPlay(play: PlayState): void {
    if (play.id !== 'lanterns') return;
    this.wish ??= this.buildWishLanterns();
    this.wish.held = 0;
    this.wish.sailing = [];
    this.wish.meshes.forEach((m) => {
      m.visible = false;
      const pm = (m.getObjectByName('paper') as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
      pm?.color.setHex(0xffc070);
      pm?.emissive.setHex(0xff9a40);
      if (pm) pm.emissiveIntensity = 1.6;
    });
    this.placePlayer(ARCH.x, ARCH.z + 1.1, 'up');
    this.frame({ pitch: 30, distance: 16, yaw: 0, ox: 0, oz: -3.5 });
  }

  protected override onPlayEvent(play: PlayState, kind: string, value: number): void {
    if (play.id !== 'lanterns' || !this.wish) return;
    const w = this.wish;
    const p = this.game.player.position;
    if (kind === 'restart') {
      w.held = 0;
      w.sailing = w.sailing.filter((s) => this.game.time - s.t0 < 0);
      return;
    }
    if (kind === 'release') {
      const k = w.held;
      w.sailing.push({ k, t0: this.game.time, x: p.x, z: p.z, q: value });
      w.held = Math.min(5, k + 1);
      // Colour-coded by accuracy: radiant = white-gold, aloft = warm amber, wobbly = rose, sputter = dull.
      const paperM = (w.meshes[k]?.getObjectByName('paper') as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
      if (paperM) {
        const [c, e, ei] = ([[0xa89078, 0x7a4a2a, 0.35], [0xf0a8b8, 0xff6a8a, 1.0], [0xffc070, 0xff9a40, 1.6], [0xfff0b0, 0xffd060, 2.6]] as const)[Math.max(0, Math.min(3, value))]!;
        paperM.color.setHex(c);
        paperM.emissive.setHex(e);
        paperM.emissiveIntensity = ei;
      }
      const cols = value >= 2 ? [0xffd27a, 0xfff0c0, 0x7ae8f0] : [0xffb050, 0xc8a080];
      for (const c of cols) this.burst(p.x, p.y + 1.5, p.z - 0.5, { color: c, count: value >= 2 ? 18 : 8, speed: 1.6, size: 0.1, gravity: -0.3, life: 1.6, up: 1, spread: 0.5 });
      // The waterline crowd cheers a good release.
      if (value >= 2 && this.crowd) {
        for (const r of this.releasers.slice(3, 9)) this.crowd.setAnim(r.i, 'cheer');
        this.cheerT = 2.5;
      }
    }
  }

  private cheerT = 0;

  protected override onEndPlay(): void {
    // Released lanterns keep sailing; the held one goes away.
    if (this.wish) this.wish.held = 5;
  }

  protected override playerPose(rig: PlayerRig, play: PlayState): ActionPose | null {
    if (play.id !== 'lanterns') return null;
    rig.tool.visible = false;
    const v = play.progress[0] ?? 0;
    // Cradle the lantern at the chest, then lift it up over your head.
    const up = -1.1 - v * 1.7;
    rig.armL.rotation.set(up, 0, 0.3 - v * 0.15);
    rig.armR.rotation.set(up, 0, -0.3 + v * 0.15);
    rig.torso.rotation.set(-0.08 - v * 0.12, 0, 0);
    rig.head.rotation.set(-0.25 - v * 0.2, 0, 0);
    return { sy: 1 + v * 0.05, bob: v * 0.04 };
  }

  private updateWish(game: Game): void {
    const w = this.wish;
    if (!w) return;
    const play = this.play;
    const p = game.player.position;
    // In-hand lantern.
    const holding = play?.id === 'lanterns' && w.held < 5;
    w.meshes.forEach((m, k) => {
      const s = w.sailing.find((q) => q.k === k);
      if (holding && k === w.held && !s) {
        const v = play.progress[0] ?? 0;
        m.visible = true;
        m.position.set(p.x, p.y + 0.95 + v * 0.75, p.z - 0.32 - v * 0.08);
        m.rotation.set(0, 0, Math.sin(game.time * 3) * 0.05);
        w.glow.set(k, m.position.x, m.position.y + 0.2, m.position.z, 1.1 + v * 0.4);
        return;
      }
      if (!s) {
        m.visible = false;
        w.glow.set(k, 0, -50, 0, 0);
        return;
      }
      // Sailing: arc down to the water, then drift out on the tide.
      const a = game.time - s.t0;
      const u = Math.min(1, a / 1.6);
      const out = a < 1.6 ? u * 2.2 : 2.2 + (a - 1.6) * (0.35 + s.q * 0.12);
      const x = s.x + Math.sin(a * 0.3 + k) * 0.8 * Math.min(1, out / 6) + (k - 2) * 0.45 * u;
      const z = s.z - 0.4 - out;
      const hy = s.z - out < this.shoreZ(x) ? 0.02 + Math.sin(game.time * 1.4 + k) * 0.03 : this.H(x, z) + 0.02;
      const y = a < 1.6 ? THREE.MathUtils.lerp(p.y + 1.6, hy, u * u) + Math.sin(u * Math.PI) * 0.5 : hy;
      m.visible = true;
      m.position.set(x, y, z);
      m.rotation.set(Math.sin(game.time * 1.1 + k) * 0.06, a * 0.2, Math.sin(game.time * 1.3 + k) * 0.06);
      w.glow.set(k, x, y + 0.2, z, [0.45, 0.9, 1.5, 2.1][Math.max(0, Math.min(3, s.q))]! * (1 + 0.1 * Math.sin(game.time * 3 + k)));
      if (out > 40) {
        m.visible = false;
        w.glow.set(k, 0, -50, 0, 0);
      }
    });
  }
}
