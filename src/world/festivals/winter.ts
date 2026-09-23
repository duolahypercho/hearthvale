/**
 * Winter — Starfall in the snow-covered square.
 *
 *   north  a row of snow-roofed townhouses with lit windows and fir garlands; the aurora hangs in
 *          folded green-teal curtains above the hills behind them
 *   middle the Great Fir: a towering decorated tree (baubles, tinsel spirals, fairy lights, the
 *          glowing star that was the player's gran's), a ring of presents at its foot, carolers
 *          with song books, the gift exchange circle, the cocoa stand and three ice sculptures
 *   south  the frozen river with skaters looping across the ice, spanned by a snowy stone bridge
 *   air    soft snowfall + golden star-dust drifting down over the square
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { smoothstep } from '../../core/noise';
import { NPCS, NPC_IDS, type NpcLook } from '../../data/npcs';
import { OUTFIT_PALETTES } from '../../data/festivals';
import { TileType } from '../tiles';
import { textures } from '../../render/textures';
import { buildTownHouse, buildHedge, buildMarketStall } from '../props/townkit';
import { buildLanternPost } from '../props/structures';
import { buildBunting } from '../props/festival';
import { buildSnowman, buildBench } from '../props/farmkit';
import { FestivalMap, type PlayState } from './base';
import type { ActionPose, PlayerRig } from '../../entities/player';
import { buildStarTree, buildIceSculpture, buildBridge, buildCocoaStand, buildBonfire } from './kit';
import { Aurora, Snowfall, GlowPoints, Bonfire } from './fx';
import { FrozenRiver } from './sea';
import { randomLook, type CrowdSpec } from './crowd';
import { MeshBuilder, bevelCylinder, mat, lumpySphere, roundedBox } from '../geom';
import { materials } from '../../render/materials';
import { Rng } from '../../core/rng';

/** Per-frame scratch (no allocations in tick). */
const _dust = new THREE.Vector3();

const TREE = { x: 32, z: 19.5 };
const PLAZA_R = 7.6;
const ICE_Y = -0.18;
const BRIDGE_X = 32;
/** The warming fire west of the plaza (cocoa in hand, benches, sleds piled nearby). */
const FIRE = { x: 24.2, z: 25.4 };
/** Footpaths trodden through the snow from the plaza to the stalls, the fire, the sleds, the sculptures. */
const TRAILS: [number, number][][] = [
  [[25.2, 21.6], [22.6, 22.9], [21.2, 23.6]],
  [[26.0, 23.4], [24.8, 24.6], [21.0, 25.4], [16.8, 25.6]],
  [[25.0, 17.6], [21.2, 17.4], [17.6, 19.4], [15.2, 20.8]],
  [[39.2, 22.0], [42.0, 23.2], [44.2, 23.2], [48.0, 21.6], [49.6, 21.2]],
  [[39.6, 17.6], [43.0, 17.4]],
  [[37.0, 25.4], [38.2, 26.6]],
];
/** Starlight Skate reach (east of the bridge, inside the camera bounds). */
const SKATE = { x0: 34.6, x1: 49.5 };

export class StarfallSquare extends FestivalMap {
  private river!: FrozenRiver;
  private aurora!: Aurora;
  private snow!: Snowfall;
  private stardust!: Snowfall;
  private skaters: { i: number; cx: number; rx: number; rz: number; sp: number; a0: number; side: number }[] = [];
  private starLight!: THREE.PointLight;
  /** Starlight Skate: the player's run (laps of the east reach) + the course on the ice. */
  private run: { x: number; off: number; vx: number; dir: 1 | -1; leg: number; dist: number; stun: number; spray: number; turn: number; items: SkItem[]; combo: number; comboT: number; best: number; gates: number; stars: number; cracks: number; trailT: number } | null = null;
  private skateKit: SkateKit | null = null;
  private roamLight!: THREE.PointLight;
  private roamHome = new THREE.Vector3();
  private recipient: { i: number; x: number; z: number; yaw: number; anim: number } | null = null;
  /** Gift Exchange: the present someone wrapped for you, unwrapped in your hands. */
  private present: { g: THREE.Group; lid: THREE.Object3D; ribbons: THREE.Object3D[]; prize: THREE.Mesh; t0: number; open: number } | null = null;

  constructor(game: Game) {
    super(game, {
      id: 'fest-winter',
      title: 'Starfall · Hearthvale Square',
      size: { w: 64, d: 48 },
      extent: { minX: -20, minZ: -20, maxX: 84, maxZ: 68 },
      spawn: { x: 32, z: 40, facing: 'up' },
      bounds: [12, 12, 52, 38],
      terrain: { pathTexture: textures.cobble().map, pathScale: 0.48 },
      warps: [{ x0: 29, z0: 47, x1: 34, z1: 47, to: 'farm', x: 61.5, z: 28.5, facing: 'left' }],
    });
    this.activitySpots.push({ id: 'giftswap', x: TREE.x, z: TREE.z + 5.6, r: 2.6 }, { id: 'skate', x: 36.2, z: 29.4, r: 2.2 });
    this.visitorSpots.push({ x: 28.2, z: 27.9, yaw: 2.7 }, { x: 36.0, z: 27.2, yaw: -2.6 });
    this.confettiColors = [0xd8312a, 0xf2d27a, 0x2f6a4a, 0xffffff, 0x5ab8e0];
  }

  // ───────────────────────────────────────────── shape

  private riverZ(x: number): number {
    return 33.2 + 1.6 * Math.sin(x * 0.09 + 0.8) + 0.6 * Math.sin(x * 0.23);
  }

  private trailValue(x: number, z: number): number {
    let v = 0;
    for (const tr of TRAILS) {
      for (let i = 0; i + 1 < tr.length; i++) {
        const [ax, az] = tr[i]!;
        const [bx, bz] = tr[i + 1]!;
        const dx = bx - ax;
        const dz = bz - az;
        const u = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        const d = Math.hypot(x - ax - dx * u, z - az - dz * u) + this.noise.get(x * 0.9, z * 0.9) * 0.12;
        v = Math.max(v, smoothstep(0.62, 0.3, d));
      }
    }
    return v * 0.72;
  }

  private riverDist(x: number, z: number): number {
    return Math.abs(z - this.riverZ(x));
  }

  private rimDist(x: number, z: number): number {
    const qx = Math.abs(x - 32) - 23;
    const qz = Math.abs(z - 24.5) - 15;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.2;
  }

  private exitMask(x: number, z: number): number {
    const river = smoothstep(4.5, 2.5, this.riverDist(x, z)) * (smoothstep(4, -2, x) + smoothstep(58, 64, x));
    const south = smoothstep(3.2, 1.6, Math.abs(x - 31.5)) * smoothstep(40, 46, z);
    return Math.min(1, river + south);
  }

  protected height(x: number, z: number): number {
    const d = this.rimDist(x, z);
    const n = this.noise;
    const hills = (smoothstep(-0.5, 5, d) * 1.6 + smoothstep(4, 20, d) * (2.8 + n.fbm(x * 0.04 + 5, z * 0.04, 3) * 3)) * (1 - this.exitMask(x, z));
    const rise = smoothstep(16, 10, z) * 0.35;
    const rd = this.riverDist(x, z) + n.fbm(x * 0.3, z * 0.3, 2) * 0.3;
    const channel = -smoothstep(3.0, 1.9, rd) * 0.75;
    return hills + rise + channel + n.fbm(x * 0.05 + 3, z * 0.05, 2) * 0.12 * smoothstep(1.5, 3, rd);
  }

  private pathValue(x: number, z: number): number {
    const nz = this.noise.get(x * 0.4, z * 0.4) * 0.25;
    const td = Math.hypot(x - TREE.x, z - TREE.z);
    let v = smoothstep(PLAZA_R + 0.4, PLAZA_R - 0.3, td + nz);
    v = Math.max(v, smoothstep(1.3, 0.9, Math.abs(x - BRIDGE_X + nz)) * smoothstep(TREE.z, TREE.z + 2, z));
    v = Math.max(v, smoothstep(1.1, 0.7, Math.abs(z - 16.2 + nz)) * smoothstep(8, 10, x) * smoothstep(56, 54, x));
    for (const hx of [14.5, 23.5, 40.5, 49.5]) v = Math.max(v, smoothstep(0.7, 0.4, Math.abs(x - hx)) * smoothstep(13.8, 14.4, z) * smoothstep(17, 16, z));
    v = Math.max(v, this.trailValue(x, z));
    return v * smoothstep(1.8, 2.6, this.riverDist(x, z));
  }

  protected paint(): void {
    this.terrain.paint('path', (x, z) => this.pathValue(x, z));
  }

  protected override tileBlocked(x: number, z: number): boolean {
    if (this.onBridge(x, z)) return false;
    return (this.rimDist(x, z) > -0.2 && this.exitMask(x, z) < 0.5) || this.riverDist(x, z) < 2.1;
  }

  private onBridge(x: number, z: number): boolean {
    return Math.abs(x - BRIDGE_X) < 0.9 && Math.abs(z - this.riverZ(BRIDGE_X)) < 3.6;
  }

  override heightAt(x: number, z: number): number {
    if (this.run && this.riverDist(x, z) < 2.4) return ICE_Y + 0.02;
    if (this.terrain && this.onBridge(x, z)) {
      const t = (z - (this.riverZ(BRIDGE_X) - 3.4)) / 6.8;
      return Math.max(this.terrain.heightAt(x, z), 0.35 + Math.sin(THREE.MathUtils.clamp(t, 0, 1) * Math.PI) * 0.5);
    }
    return super.heightAt(x, z);
  }

  protected override tileType(x: number, z: number): TileType {
    return this.terrain.splatAt(x, z, 'path') > 0.5 ? TileType.Stone : TileType.Grass;
  }

  protected grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.8) return 0;
    if (t.splatAt(x, z, 'path') > 0.2 || this.riverDist(x, z) < 2.6) return 0;
    return 1.5 + 3 * smoothstep(-0.1, 0.5, this.noise.fbm(x * 0.13 + 4, z * 0.13, 2));
  }

  // ───────────────────────────────────────────── dressing

  protected dress(): void {
    const r = this.rng.fork('dress');
    this.buildTree(r);
    this.buildHouses(r);
    this.buildRiver(r);
    this.buildSquare(r);
    this.plantTrees(r);
    this.plantNature(r);
    this.buildCrowd(r);
    this.buildSky();
    // Snow drifts piled against the rim, the river banks and props.
    this.terrain.setDrift((x, z) => {
      const rim = smoothstep(-3, 1, this.rimDist(x, z));
      const bank = smoothstep(3.6, 2.4, this.riverDist(x, z)) * smoothstep(1.9, 2.3, this.riverDist(x, z));
      const n = smoothstep(0.1, 0.6, this.noise.fbm(x * 0.2 + 3, z * 0.2, 2));
      return Math.min(1, rim * 0.8 + bank * 0.7 + n * 0.25) * (1 - this.pathValue(x, z));
    });
  }

  private buildTree(r: Rng): void {
    const t = buildStarTree(r, 11.5);
    this.addProp(t.group, TREE.x, TREE.z, 0.2, { solidR: 3.0, ao: 4.2 });
    const y = this.H(TREE.x, TREE.z) - 0.03;
    const rot = new THREE.Matrix4().makeRotationY(0.2);
    const warm = [0xffd27a, 0xfff0c0, 0xffb060];
    t.lights.forEach((p, i) => {
      const q = p.clone().applyMatrix4(rot);
      this.glowPt(TREE.x + q.x, y + q.y, TREE.z + q.z, i % 5 === 0 ? 0xff7a6a : warm[i % 3]!, 0.36, 0.55);
    });
    // Specular sparkle on a few baubles (small, so they stay saturated glass, not lamps).
    for (const b of t.baubles) {
      if (r.next() < 0.7) continue;
      const q = b.p.clone().applyMatrix4(rot);
      this.glowPt(TREE.x + q.x, y + q.y + 0.08, TREE.z + q.z + 0.08, 0xfff4e0, 0.16, 0.6);
    }
    // Star halo kept small: the five points must survive the bloom.
    this.glowPt(TREE.x, y + t.star.y, TREE.z, 0xffc860, 1.5, 0.1);
    this.starLight = this.addLight(TREE.x, y + t.star.y - 1.4, TREE.z + 1.6, 0xffd890, 9, 0.04, 14);
    this.addLight(TREE.x, y + 4.6, TREE.z + 4.6, 0xffc070, 9, 0.03, 12);
  }

  private buildHouses(r: Rng): void {
    const houses: [number, number, Parameters<typeof buildTownHouse>[1]][] = [
      [14.5, 10.4, { w: 5.6, d: 4.4, wallH: 2.8, wall: 'plaster', wallTint: 0xf2e6d8, roofTint: 0x8a3a32, doorTint: 0x2f5a4a, shutterTint: 0x2f5a4a, chimney: true, flowerBoxes: false }],
      [23.5, 10.0, { w: 6.4, d: 4.8, wallH: 3.1, wall: 'wood', wallTint: 0xe8d8c0, roofTint: 0x3f5a6a, doorTint: 0xa83a2a, awning: [0xc8302a, 0xf6f0e6], flowerBoxes: false, doorX: 1 }],
      [40.5, 10.0, { w: 6.2, d: 4.6, wallH: 3.0, wall: 'stone', wallTint: 0xe6ddd0, roofTint: 0x5a4a6a, doorTint: 0x2f6a4a, shutterTint: 0x8a2a2a, chimney: true, flowerBoxes: false, doorX: -1 }],
      [49.5, 10.4, { w: 5.6, d: 4.4, wallH: 2.7, wall: 'wood', wallTint: 0xf0e2c8, roofTint: 0xd8b068, roof: 'thatch', doorTint: 0x3f6a9a, shutterTint: 0x3f6a9a, chimney: true, flowerBoxes: false }],
    ];
    for (const [x, z, spec] of houses) {
      const bp = buildTownHouse(r, spec);
      this.addProp(bp, x, z, 0, { solidRect: [spec.w + 0.4, spec.d + 0.4], ao: spec.w * 0.62 });
      if (bp.anchors.chimney) this.addSmoke(bp.anchors.chimney.clone().applyMatrix4(bp.group.matrixWorld), 3);
      // Fir garland with little lights along the eaves.
      const A = new THREE.Vector3(x - spec.w / 2 - 0.1, this.H(x, z) + spec.wallH + 0.2, z + spec.d / 2 + 0.25);
      const B = new THREE.Vector3(x + spec.w / 2 + 0.1, A.y, A.z);
      this.addProp(buildBunting(r, A, B, 0.35, Math.round(spec.w * 1.6), 2), 0, 0, 0, { y: 0 });
      for (let i = 1; i < 10; i++) this.glowPt(A.x + ((B.x - A.x) * i) / 10, A.y - Math.sin((i / 10) * Math.PI) * 0.35 - 0.05, A.z + 0.02, [0xffd27a, 0xff7a6a, 0x7ad0ff, 0x9aff9a][i % 4]!, 0.28, 0.6);
      // Warm window spill on the snow.
      this.pools.add(x, z + spec.d / 2 + 1.2, this.H(x, z), 2.4);
    }
    // A hedge + the cocoa stand in the gap north-centre, facing the tree.
    this.addProp(buildHedge(r, 3.6), 32, 9.6, 0, { solidRect: [3.6, 0.8] });
  }

  private buildRiver(r: Rng): void {
    this.river = new FrozenRiver(this.terrain, ICE_Y, { x0: -20, z0: 24, x1: 84, z1: 44 });
    // Boot prints (weather system) skip ground under the water level: tell it the frozen channel is
    // "water" so skating leaves blade scratches, not snow footprints. The terrain shader's water
    // uniform was captured at build time, so the snowy banks keep their shading.
    (this.terrain.opts as { waterLevel: number }).waterLevel = ICE_Y + 0.05;
    this.root.add(this.river.mesh);
    const bz = this.riverZ(BRIDGE_X);
    const br = buildBridge(r, 7.2, 2.2, 0.35);
    this.addProp(br, BRIDGE_X, bz, Math.PI / 2, { y: 0 });
    // Lanterns along both reaches light the ice (their pools + reflections are drawn by the ice).
    const lamps: THREE.Vector3[] = [];
    const post = (x: number, z: number, rot: number): void => {
      // addProp turns the post's lamp into a glow sprite (world position) — mirror those.
      const n0 = this.glowList.length;
      this.addProp(buildLanternPost(), x, z, rot, { solidR: 0.35, lights: 'glow' });
      for (const g of this.glowList.slice(n0)) lamps.push(new THREE.Vector3(g.x, g.y, g.z));
    };
    for (const x of [38.5, 44.5, 50.5]) post(x, this.riverZ(x) - 3.1, Math.PI);
    for (const x of [15.5, 21.5, 26.8]) post(x, this.riverZ(x) - 3.1, 0);
    for (const x of [18.5, 45.5]) post(x, this.riverZ(x) + 3.2, x < BRIDGE_X ? 0 : Math.PI);
    // Lamps at the bridge ends.
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) post(BRIDGE_X + sx * 1.5, bz + sz * 4.0, sx < 0 ? 0 : Math.PI);
    }
    this.river.setLamps(lamps);
    // The bridge-end lamps also light the deck (the lane over the ice is never a dark trench).
    for (const sz of [-1, 1]) this.pools.add(BRIDGE_X, bz + sz * 2.6, 0.75, 2.0);
  }

  private buildSquare(r: Rng): void {
    // Lamp ring around the plaza.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      // Gaps where the stalls / fire open onto the plaza (the ring isn't a fence of identical posts).
      if (Math.abs(a - Math.PI / 2) < 0.3 || i === 3 || i === 7) continue;
      const x = TREE.x + Math.cos(a) * (PLAZA_R + 0.9);
      const z = TREE.z + Math.sin(a) * (PLAZA_R + 0.9);
      this.addProp(buildLanternPost(), x, z, -a + Math.PI, { solidR: 0.35 });
    }
    const cocoa = buildCocoaStand(r);
    this.addProp(cocoa.group, 20.8, 22.6, 0.55, { solidRect: [2.6, 1.2], ao: 1.8 });
    const sp = cocoa.steam.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.55);
    this.addSmoke(new THREE.Vector3(20.8 + sp.x, this.H(20.8, 22.6) + sp.y, 22.6 + sp.z), 1.6);
    this.glowPt(20.8, this.H(20.8, 22.6) + 2.2, 22.6 + 0.6, 0xffc070, 1.1, 0.03);
    // The third (and last) dynamic light on this map: the cocoa stand's lamp. During the Starlight
    // Skate it rides along with the skater instead (≤ 3 point lights a festival map, constant count).
    this.roamLight = this.addLight(21.4, this.H(20.8, 22.6) + 2.0, 23.6, 0xffb060, 6, 0.03, 7);
    this.roamHome.set(21.4, this.H(20.8, 22.6) + 2.0, 23.6);
    this.pools.add(20.8, 23.8, this.H(20.8, 23.8), 2.4);
    this.addProp(buildIceSculpture(r, 'swan'), 42.8, 24.6, -0.6, { solidR: 0.7 });
    this.addProp(buildIceSculpture(r, 'deer'), 44.6, 17.0, -1.2, { solidR: 0.7 });
    this.addProp(buildIceSculpture(r, 'star'), 19.8, 16.6, 0.4, { solidR: 0.7 });
    // A small cold uplight at each sculpture's plinth (not a big halo over the ice).
    for (const [x, z] of [[42.8, 24.6], [44.6, 17.0], [19.8, 16.6]] as const) this.glowPt(x, this.H(x, z) + 0.55, z + 0.5, 0x9ad8ff, 0.7, 0.1);
    // Winter market: two stalls at the plaza's flanks (roasted chestnuts, knitted things).
    this.addProp(buildMarketStall(r, [0xc8302a, 0xf6f0e6]), 14.6, 21.6, 0.85, { solidRect: [2.8, 1.2], ao: 1.6 });
    this.addProp(buildMarketStall(r, [0x2f6a4a, 0xf6f0e6]), 49.8, 21.0, -0.85, { solidRect: [2.8, 1.2], ao: 1.6 });
    // Stall lanterns under the awnings: warm halos + a pool of light on the snow in front.
    for (const [x, z, rot] of [[14.6, 21.6, 0.85], [49.8, 21.0, -0.85]] as const) {
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      for (const s2 of [-1, 1]) this.glowPt(x + fz * s2 * 0.9 + fx * 0.55, this.H(x, z) + 2.0, z - fx * s2 * 0.9 + fz * 0.55, 0xffc070, 0.8, 0.05);
      this.pools.add(x + fx * 1.4, z + fz * 1.4, this.H(x, z), 2.3);
    }
    // The warming fire: a stone ring, flame tongues, embers + smoke, a warm pool on the snow.
    const fire = buildBonfire(r);
    this.addProp(fire.group, FIRE.x, FIRE.z, 0.4, { solidR: 0.9, ao: 1.4 });
    const fy = this.H(FIRE.x, FIRE.z);
    const flames = new Bonfire(new THREE.Vector3(FIRE.x, fy + 0.15, FIRE.z), 1.1);
    flames.group.userData.perfTag = 'fire';
    this.root.add(flames.group);
    this.fx.push({ update: (_dt, _g, h) => flames.setViewportHeight(h) });
    this.addSmoke(new THREE.Vector3(FIRE.x, fy + 1.8, FIRE.z), 2);
    this.pools.add(FIRE.x, FIRE.z, fy, 3.4);
    this.glowPt(FIRE.x, fy + 0.7, FIRE.z, 0xff9a40, 1.3, 0.25);
    // Sleds: a pile by the snowman, one left out on the slope.
    for (const [x, z, rot, lift, tint] of [[16.4, 25.2, 0.3, 0, 0xc8302a], [16.6, 25.3, 0.5, 0.16, 0x2f6a4a], [17.4, 24.4, -0.6, 0, 0x3a5a9a], [46.8, 26.2, 1.9, 0, 0xd8a040]] as const) {
      this.addProp(buildSled(tint), x, z, rot, { y: this.H(x, z) + lift, solidR: lift ? 0 : 0.45 });
    }
    this.addProp(buildSnowman(r), 15.6, 27.6, 0.4, { solidR: 0.5 });
    this.addProp(buildSnowman(r), 49.4, 27.2, -0.5, { solidR: 0.5 });
    this.addProp(buildBench(), 25.4, 27.2, Math.PI + 0.5, { solidR: 0.6 });
    this.addProp(buildBench(), 38.6, 27.2, Math.PI - 0.5, { solidR: 0.6 });
  }

  private plantTrees(r: Rng): void {
    for (const [x, z, s] of [[8.5, 18, 1.1], [56, 18.5, 1.05], [9.5, 27, 0.95], [55.5, 26.5, 1.0], [19, 8.2, 0.85], [45, 8.2, 0.9], [11, 41, 1.0], [53, 41.5, 1.05], [15.5, 43, 0.9], [48.5, 43.2, 0.95]] as const) this.addTree('pine', x, z, s);
    for (let z = -18; z < 66; z += 2.4) {
      for (let x = -18; x < 82; x += 2.4) {
        const jx = x + (r.next() - 0.5) * 2;
        const jz = z + (r.next() - 0.5) * 2;
        const d = this.rimDist(jx, jz);
        if (d < 1.2 || this.exitMask(jx, jz) > 0.2 || r.next() < 0.3) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.75) continue;
        // Keep the lens clear south of the bridge (arrival framing).
        if (jz > 38 && jz < 56 && Math.abs(jx - 32) < 14) continue;
        const sp = r.next() < 0.7 ? 'pine' : 'oak';
        this.trees.add(sp, jx, this.H(jx, jz) - 0.08, jz, 0.85 + r.next() * 0.45, undefined, d > 2.2 ? 1 : 0);
      }
    }
  }

  private plantNature(r: Rng): void {
    const g = this.grid;
    for (let z = 0; z < g.depth; z++) {
      for (let x = 0; x < g.width; x++) {
        const cx = x + 0.5 + (r.next() - 0.5) * 0.6;
        const cz = z + 0.5 + (r.next() - 0.5) * 0.6;
        const rd = this.riverDist(cx, cz);
        const y = this.H(cx, cz);
        if (rd > 3.0 && rd < 3.8 && r.next() < 0.25) {
          this.nature.place('reed', cx, y, cz, { scale: 0.9 + r.next() * 0.4, color: 0xb8a878 });
          continue;
        }
        if (!g.isWalkable(x, z) || this.terrain.splatAt(cx, cz, 'path') > 0.05) continue;
        const roll = r.next();
        if (this.rimDist(cx, cz) > -2.4) {
          if (roll < 0.2) this.nature.place('bush', cx, y, cz, { scale: 0.8 + r.next() * 0.4, lod: 1 });
          else if (roll < 0.3) this.nature.place('boulder', cx, y - 0.2, cz, { scale: 0.6 + r.next() * 0.5 });
        } else if (roll < 0.04) this.nature.place('deadTwig', cx, y, cz, {});
      }
    }
  }

  // ───────────────────────────────────────────── crowd

  private buildCrowd(r: Rng): void {
    const P = OUTFIT_PALETTES.winter;
    const specs: CrowdSpec[] = [];
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(r.next() * a.length)]!;
    const person = (look: NpcLook, anim: CrowdSpec['anim'], x: number, z: number, yaw: number, extra: Partial<CrowdSpec> = {}): number => {
      specs.push({ look, outfit: 'winter', anim, x, z, yaw, top: pick(P.tops), accent: pick(P.accents), hatTint: pick(P.hats), phase: r.next(), speed: 0.85 + r.next() * 0.3, ...extra });
      return specs.length - 1;
    };
    const face = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tx - x, tz - z);
    // Gift exchange circle south of the tree.
    const gx = TREE.x;
    const gz = TREE.z + 5.6;
    const named = NPC_IDS.slice();
    const circle: [string | null, CrowdSpec['anim']][] = [
      ['marigold', 'talk'],
      ['bram', 'cheer'],
      ['wren', 'wave'],
      [null, 'clap'],
      [null, 'cheer'],
      [null, 'talk'],
    ];
    circle.forEach(([id, anim], k) => {
      const a = Math.PI * 0.15 + (k / circle.length) * Math.PI * 1.7 - Math.PI / 2 + Math.PI;
      const x = gx + Math.cos(a) * 2.1;
      const z = gz + Math.sin(a) * 1.5;
      const look = id ? { ...NPCS[id as keyof typeof NPCS].look } : randomLook(r, { palette: P.tops, child: k === 4 });
      person(look, anim, x, z, face(x, z, gx, gz), { id: id ?? undefined, props: ['gift'], accent: pick(P.accents) });
    });
    // Carolers by the tree with song books.
    for (const [dx, dz, id] of [[-3.8, 2.6, null], [-2.9, 3.4, null], [-4.6, 1.6, null], [3.9, 2.8, null]] as const) {
      const x = TREE.x + dx;
      const z = TREE.z + dz;
      person(randomLook(r, { palette: P.tops }), 'carol', x, z, face(x, z, TREE.x, TREE.z + 8), { id: id ?? undefined, props: ['songbook'] });
    }
    // Other named villagers around the square.
    const toFire = (x: number, z: number): number => face(x, z, FIRE.x, FIRE.z);
    const around: [number, number, number, CrowdSpec['anim'], CrowdSpec['props']][] = [
      [22.6, 24.3, toFire(22.6, 24.3), 'toast', ['mug']],
      [25.7, 24.2, toFire(25.7, 24.2), 'talk', ['mug']],
      [42.0, 25.6, -0.4, 'clap', []],
      [45.4, 18.2, -2.2, 'idle', []],
      [25.4, 27.8, Math.PI, 'sit', ['mug']],
      [38.6, 27.8, Math.PI, 'sit', []],
      [16.4, 28.4, 0.8, 'cheer', []],
    ];
    let k = 0;
    // Odessa rents skates on the bank by the bridge.
    person({ ...NPCS.odessa.look }, 'wave', 36.4, 29.0, Math.PI + 0.5, { id: 'odessa', props: ['skates'] });
    for (const id of named) {
      if (id === 'marigold' || id === 'bram' || id === 'wren' || id === 'odessa') continue;
      const s = around[k++ % around.length]!;
      person({ ...NPCS[id].look }, s[3], s[0], s[1], s[2], { id, props: s[4], lift: s[3] === 'sit' ? 0.2 : 0 });
    }
    // Skaters looping on the ice in pairs, hand in hand (animated in tick), away from the race reach.
    const loops: [number, number, number, number, number][] = [
      // cx, rx, rz, angular speed, pair (1 = two skaters side by side)
      [20, 5.5, 0.7, 0.3, 1],
      [11, 3.5, 0.5, -0.4, 1],
      [27, 2.6, 0.45, 0.42, 0],
      [56, 3.2, 0.5, -0.34, 1],
    ];
    loops.forEach(([cx, rx, rz, sp, pair], k2) => {
      const a0 = r.next() * 6.28;
      for (let m = 0; m <= pair; m++) {
        const i = person(randomLook(r, { palette: P.tops, child: (k2 + m) % 3 === 2 }), 'skate', cx, this.riverZ(cx), 0, { props: ['skates'], lift: ICE_Y - this.H(cx, this.riverZ(cx)), phase: pair ? 0.2 : r.next() });
        this.skaters.push({ i, cx, rx, rz, sp, a0, side: pair ? (m ? 0.32 : -0.32) : 0 });
      }
    });
    // Warming their hands at the fire; stall customers; a kid dragging a sled up the slope.
    for (const [x, z, anim, props] of [[23.0, 26.6, 'idle', []], [25.6, 26.4, 'toast', ['mug']], [15.8, 22.9, 'talk', []], [48.8, 22.4, 'idle', ['mug']], [50.8, 22.6, 'talk', []]] as const) {
      person(randomLook(r, { palette: P.tops, child: r.next() < 0.25 }), anim, x, z, x < 30 && z > 24 ? toFire(x, z) : face(x, z, x < 30 ? 14.6 : 49.8, x < 30 ? 21.6 : 21.0), { props: [...props] });
    }
    person(randomLook(r, { palette: P.tops, child: true }), 'cheer', 47.6, 25.4, -0.4, {});
    // Onlookers on the banks + bridge, watching the ice (facing south, toward the camera).
    for (const [x, z, yaw, anim] of [[29.6, 29.0, 0.3, 'wave'], [35.4, 28.8, -0.2, 'cheer'], [17.8, 29.4, 0.5, 'clap'], [47.0, 29.2, -0.4, 'wave']] as const) {
      person(randomLook(r, { palette: P.tops, child: r.next() < 0.3 }), anim, x, z, yaw, {});
    }
    this.crowdSpecs = specs;
  }

  private buildSky(): void {
    // The diorama camera never sees open sky, so the curtains hang low over the forest just behind the
    // rooftops: a luminous veil rising out of the northern treeline (houses occlude its hem).
    // Folded curtains low over the northern treeline, west and east of the Great Fir (its column is
    // masked out so the star keeps a clean silhouette) + a fainter far curtain behind.
    this.aurora = new Aurora(
      [
        // Five folded curtains at staggered depths: two hero veils either side of the Great Fir
        // hanging low over the treeline (their hems among the treetops), two behind, one far wash.
        { path: [[-8, 3], [2, 6.5], [10, 3], [17, 7], [24, 4.5]], base: 3.2, height: 9, strength: 1 },
        { path: [[40, 4.5], [46, 7.5], [54, 3.5], [62, 7], [72, 2.5]], base: 3.2, height: 9, strength: 1 },
        { path: [[-14, -2], [-2, 1], [10, -3], [22, 0.5]], base: 5.0, height: 10, strength: 0.7 },
        { path: [[42, 0], [54, -3], [66, 1], [80, -2]], base: 5.0, height: 10, strength: 0.7 },
        { path: [[-12, -9], [8, -5], [30, -11], [52, -5], [76, -9]], base: 7.5, height: 11, strength: 0.45 },
      ],
      { x: TREE.x, halfWidth: 6.0 },
    );
    this.aurora.group.userData.perfTag = 'sky';
    this.root.add(this.aurora.group);
    this.snow = new Snowfall(1600, new THREE.Vector3(40, 14, 32));
    this.snow.points.userData.perfTag = 'festival';
    this.root.add(this.snow.points);
    this.stardust = new Snowfall(260, new THREE.Vector3(18, 12, 18), { color: new THREE.Color(1.0, 0.82, 0.45), size: 0.7, fall: 0.35, twinkle: 1 });
    this.stardust.points.userData.perfTag = 'festival';
    this.root.add(this.stardust.points);
  }

  // ───────────────────────────────────────────── runtime

  // ───────────────────────────────────────────── Gift Exchange + Starlight Skate mini-games

  protected override onBeginPlay(play: PlayState): void {
    if (play.id === 'skate' && this.run) this.clearRun();
    if (play.id === 'giftswap') {
      const gx = TREE.x;
      const gz = TREE.z + 5.6;
      this.placePlayer(gx, gz + 0.4, 'up');
      const i = play.partner ? this.named.get(play.partner) : undefined;
      const c = this.crowd;
      if (c && i !== undefined) {
        const m = c.members[i]!;
        this.recipient = { i, x: m.x, z: m.z, yaw: m.yaw, anim: m.anim };
        c.place(i, gx, gz - 1.0, 0, 0);
        c.setAnim(i, 'talk');
        c.commit();
      }
      this.frame({ pitch: 34, distance: 15, yaw: 0, ox: 0, oz: -2.4 });
    } else if (play.id === 'skate') {
      this.startRun(play);
      this.frame({ pitch: 48, distance: 18.5, yaw: 0, ox: 0.6, oz: -3.0 });
    }
  }

  /**
   * Starlight Skate: LAPS out-and-back laps of the east reach. Each leg lays out lantern gates to
   * thread (combo), star lights to collect and cracked ice to dodge (a crack = a stumble, the combo
   * breaks, you lose speed). ↑ ↓ steer across the ice, Space pushes off harder.
   */
  private startRun(play: PlayState): void {
    const kit = (this.skateKit ??= this.buildSkateKit());
    const rr = new Rng(`skate-course`);
    const items: SkItem[] = [];
    const legs = LAPS * 2;
    for (let leg = 0; leg < legs; leg++) {
      const dir = leg % 2 ? -1 : 1;
      // Five beats per leg: gate, star, crack(+star), gate, star — offsets alternate so you weave.
      const plan: SkItem['kind'][] = leg % 3 === 2 ? ['star', 'gate', 'crack', 'gate', 'star'] : ['gate', 'star', 'crack', 'star', 'gate'];
      let prev = (rr.next() - 0.5) * 1.6;
      plan.forEach((kind, k) => {
        const f = 0.16 + (k / (plan.length - 1)) * 0.68;
        const x = dir > 0 ? SKATE.x0 + f * (SKATE.x1 - SKATE.x0) : SKATE.x1 - f * (SKATE.x1 - SKATE.x0);
        let off = THREE.MathUtils.clamp(-prev * 0.8 + (rr.next() - 0.5) * 0.9, -1.15, 1.15);
        if (kind === 'crack') off = THREE.MathUtils.clamp(prev + (rr.next() - 0.5) * 0.3, -1.1, 1.1);
        items.push({ kind, x, off, leg, done: false });
        if (kind !== 'crack') prev = off;
        if (kind === 'crack' && leg >= 2) items.push({ kind: 'star', x: x + dir * 0.2, off: THREE.MathUtils.clamp(off + (off > 0 ? -1.0 : 1.0), -1.2, 1.2), leg, done: false });
      });
    }
    const n = (k: SkItem['kind']) => items.filter((it) => it.kind === k).length;
    this.run = { x: SKATE.x0, off: 0, vx: 0, dir: 1, leg: 0, dist: 0, stun: 0, spray: 0, turn: 0, items, combo: 0, comboT: 0, best: 0, gates: 0, stars: 0, cracks: 0, trailT: 0 };
    play.total = n('star');
    play.stats = { lap: 1, laps: LAPS, gates: 0, gatesTotal: n('gate'), stars: 0, starsTotal: n('star'), cracks: 0, combo: 0, comboT: 0, best: 0, stun: 0 };
    kit.trail.reset();
    this.placePlayer(SKATE.x0, this.riverZ(SKATE.x0), 'right', ICE_Y + 0.02);
    this.layoutLeg();
  }

  private clearRun(): void {
    this.run = null;
    const k = this.skateKit;
    if (!k) return;
    k.posts.count = 0;
    k.cracks.count = 0;
    for (let i = 0; i < SK_GLOWS; i++) k.glow.set(i, 0, -50, 0, 0);
  }

  /** Instanced lantern-gate posts, crack decals, beacon glows and the blade trail. */
  private buildSkateKit(): SkateKit {
    const b = new MeshBuilder();
    b.add('woodPaint', bevelCylinder(0.035, 0.045, 1.05, 0.01, 6), mat(0, 0, 0), { tint: 0x2f6a4a });
    b.add('woodPaint', bevelCylinder(0.09, 0.1, 0.05, 0.01, 8), mat(0, 0, 0), { tint: 0xe8e0d4 });
    const lan = lumpySphere(0.1, 1, 0.03, new Rng('gate-lantern'), 2);
    lan.scale(1, 1.25, 1);
    b.add('paperLantern', lan, mat(0, 1.14, 0), { tint: 0xffd070 });
    b.add('cloth', new THREE.ConeGeometry(0.08, 0.14, 3), mat(0, 1.02, 0.02, Math.PI, 0, 0), { tint: 0xc8302a });
    const postGeo = [...b.geometries().entries()];
    const group = new THREE.Group();
    group.name = 'skate-kit';
    group.userData.perfTag = 'festival';
    // One instanced mesh per material part of the post.
    const posts: THREE.InstancedMesh[] = postGeo.map(([m, g]) => {
      const im = new THREE.InstancedMesh(g, typeof m === 'string' ? materials.get(m) : m, 16);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.userData.noAO = true;
      group.add(im);
      return im;
    });
    // Thin-ice decal: a frosted, star-shattered patch with dark water showing through its heart.
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const g2 = c.getContext('2d')!;
    const rr = new Rng('crack');
    const frost = g2.createRadialGradient(128, 80, 6, 128, 80, 78);
    frost.addColorStop(0, 'rgba(4,14,26,0.92)');
    frost.addColorStop(0.28, 'rgba(20,48,72,0.75)');
    frost.addColorStop(0.55, 'rgba(190,225,250,0.45)');
    frost.addColorStop(1, 'rgba(190,225,250,0)');
    g2.save();
    g2.scale(1, 160 / 256);
    g2.translate(0, (256 - 160) / 2);
    g2.fillStyle = frost;
    g2.beginPath();
    g2.arc(128, 128, 90, 0, Math.PI * 2);
    g2.fill();
    g2.restore();
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
      let px = x;
      let py = y;
      for (let i = 0; i < 6; i++) {
        const nx = px + (Math.cos(a) * len) / 6 + (rr.next() - 0.5) * 7;
        const ny = py + (Math.sin(a) * len * 0.62) / 6 + (rr.next() - 0.5) * 5;
        g2.strokeStyle = 'rgba(240,250,255,0.95)';
        g2.lineWidth = w;
        g2.beginPath();
        g2.moveTo(px, py);
        g2.lineTo(nx, ny);
        g2.stroke();
        if (depth > 0 && rr.next() < 0.4) branch(nx, ny, a + (rr.next() - 0.5) * 1.6, len * 0.45, w * 0.6, depth - 1);
        px = nx;
        py = ny;
        a += (rr.next() - 0.5) * 0.6;
      }
    };
    for (let k = 0; k < 9; k++) branch(128, 80, (k / 9) * Math.PI * 2 + rr.next() * 0.4, 70 + rr.next() * 45, 3.2, 2);
    // A ring fracture around the hole.
    g2.strokeStyle = 'rgba(235,248,255,0.9)';
    g2.lineWidth = 2.5;
    g2.beginPath();
    g2.ellipse(128, 80, 30, 19, 0.2, 0, Math.PI * 2);
    g2.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const cm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true });
    const plane = new THREE.PlaneGeometry(1.7, 1.06);
    plane.rotateX(-Math.PI / 2);
    const cracks = new THREE.InstancedMesh(plane, cm, 8);
    cracks.count = 0;
    cracks.frustumCulled = false;
    cracks.renderOrder = 2;
    cracks.userData.noAO = true;
    group.add(cracks);
    const glow = new GlowPoints(Array.from({ length: SK_GLOWS }, () => ({ x: 0, y: -50, z: 0, color: 0xffd84a, size: 0, twinkle: 0.3, day: 1 })), 'skate-glow');
    glow.points.frustumCulled = false;
    group.add(glow.points);
    const trail = new SkateTrail(ICE_Y + 0.012);
    group.add(trail.mesh);
    this.root.add(group);
    const kit: SkateKit = {
      group,
      posts: { set count(n: number) { for (const p of posts) p.count = n; }, get count() { return posts[0]!.count; }, setMatrixAt: (i: number, m: THREE.Matrix4) => posts.forEach((p) => p.setMatrixAt(i, m)), commit: () => posts.forEach((p) => (p.instanceMatrix.needsUpdate = true)) },
      cracks,
      glow,
      trail,
    };
    return kit;
  }

  /** Show the current leg's gates + cracks. */
  private layoutLeg(): void {
    const run = this.run;
    const kit = this.skateKit;
    if (!run || !kit) return;
    const M = new THREE.Matrix4();
    let pi = 0;
    let ci = 0;
    for (const it of run.items) {
      if (it.leg !== run.leg) continue;
      const z = this.riverZ(it.x) + it.off;
      if (it.kind === 'gate') {
        for (const s of [-1, 1]) M.makeTranslation(it.x, ICE_Y, z + s * 0.6), kit.posts.setMatrixAt(pi++, M);
      } else if (it.kind === 'crack') {
        M.makeRotationY((it.x * 7.3) % 3).setPosition(it.x, ICE_Y + 0.004, z);
        kit.cracks.setMatrixAt(ci++, M);
      }
    }
    kit.posts.count = pi;
    kit.posts.commit();
    kit.cracks.count = ci;
    kit.cracks.instanceMatrix.needsUpdate = true;
  }

  protected override onPlayEvent(play: PlayState, kind: string, value: number): void {
    const p = this.game.player.position;
    if (kind === 'restart') {
      // Attract mode loops: back to the start line.
      if (play.id === 'skate') this.startRun(play);
      return;
    }
    if (play.id === 'giftswap') {
      const r = this.recipient;
      const rp = r ? this.memberPos(r.i) : p;
      if (kind === 'given') {
        // Heart burst sized by the reaction tier (love / like / neutral).
        const col = value >= 3 ? 0xff5a7a : value === 2 ? 0xffa0b8 : 0xfff0e0;
        this.burst(rp.x, rp.y + 1.7, rp.z, { color: col, count: value * 12, speed: 1.5, size: value >= 3 ? 0.18 : 0.13, gravity: -0.4, life: 1.9, up: 0.9, spread: 0.4 });
        if (r) {
          this.crowd?.setAnim(r.i, value >= 3 ? 'cheer' : value === 2 ? 'wave' : 'talk');
          this.crowd?.commit();
        }
      } else if (kind === 'gift-appear') {
        this.showPresent();
      } else if (kind === 'unwrap') {
        if (this.present) this.present.open = this.game.time;
        for (const c of [0xd8312a, 0xf2d27a, 0x2f6a4a, 0xffffff]) this.burst(p.x, p.y + 1.2, p.z + 0.55, { color: c, count: 22, speed: 2.8, size: 0.11, gravity: 2.5, life: 1.8, up: 1.6, spread: 0.3 });
      }
    }
  }

  /** A wrapped present held out in front of you (box, lid, crossed ribbon + bow, a keepsake inside). */
  private showPresent(): void {
    if (!this.present) {
      const red = new THREE.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.55 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xf2c84a, roughness: 0.35, metalness: 0.3 });
      const g = new THREE.Group();
      g.name = 'present';
      const body = new THREE.Mesh(roundedBoxGeo(0.46, 0.34, 0.46), red);
      body.position.y = 0.17;
      const lid = new THREE.Group();
      const lidBox = new THREE.Mesh(roundedBoxGeo(0.5, 0.1, 0.5), red);
      lid.add(lidBox);
      lid.position.y = 0.38;
      const ribbons: THREE.Object3D[] = [];
      for (const r of [0, Math.PI / 2]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.475), gold);
        band.position.y = 0.17;
        band.rotation.y = r;
        g.add(band);
        ribbons.push(band);
        const lb = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.51), gold);
        lb.rotation.y = r;
        lid.add(lb);
      }
      for (const sx of [-1, 1]) {
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 12), gold);
        loop.position.set(sx * 0.07, 0.1, 0);
        loop.rotation.set(0, Math.PI / 2, sx * 0.6);
        lid.add(loop);
      }
      const prize = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffb040, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.4 }));
      prize.position.y = 0.2;
      prize.visible = false;
      g.add(body, lid, prize);
      g.traverse((o) => {
        o.castShadow = true;
        o.userData.noAO = true;
      });
      g.userData.perfTag = 'festival';
      this.root.add(g);
      this.present = { g, lid, ribbons, prize, t0: 0, open: -1 };
    }
    const pr = this.present;
    // Turn round to show it to the crowd (and the camera): the present is held out towards us.
    this.game.player.setFacing('down');
    pr.t0 = this.game.time;
    pr.open = -1;
    pr.g.visible = true;
    pr.lid.position.set(0, 0.38, 0);
    pr.lid.rotation.set(0, 0, 0);
    for (const r of pr.ribbons) (r.visible = true), r.scale.setScalar(1);
    pr.prize.visible = false;
  }

  private updatePresent(game: Game): void {
    const pr = this.present;
    if (!pr || !pr.g.visible) return;
    const p = game.player.position;
    const t = game.time - pr.t0;
    // Held out in both hands, bobbing; pops in with a little overshoot.
    const pop = Math.min(1, t / 0.35);
    const sc = pop < 1 ? 0.3 + pop * 0.8 + Math.sin(pop * Math.PI) * 0.15 : 1;
    pr.g.scale.setScalar(sc);
    pr.g.position.set(p.x, p.y + 0.78 + Math.sin(game.time * 3) * 0.03, p.z + 0.55);
    if (pr.open < 0) {
      pr.g.rotation.z = Math.sin(game.time * 14) * 0.05 * (t > 0.4 ? 1 : 0);
      return;
    }
    const u = game.time - pr.open;
    pr.g.rotation.z = 0;
    // Lid pops up and tumbles away, the ribbon springs off, the keepsake rises out glowing.
    pr.lid.position.set(u * 0.6, 0.38 + u * 2.4 - u * u * 2.6, -u * 0.3);
    pr.lid.rotation.set(-u * 2.2, u * 1.5, u * 3.1);
    for (const r of pr.ribbons) r.scale.set(Math.max(0.01, 1 - u * 3), 1, 1);
    pr.prize.visible = true;
    pr.prize.position.y = 0.2 + Math.min(1, u / 0.7) * 0.65;
    pr.prize.rotation.y = u * 4;
    if (u > 1.3) pr.lid.visible = false;
    else pr.lid.visible = true;
  }

  protected override onEndPlay(play: PlayState): void {
    if (this.present) this.present.g.visible = false;
    const c = this.crowd;
    if (play.id === 'giftswap' && c && this.recipient) {
      const r = this.recipient;
      c.place(r.i, r.x, r.z, r.yaw);
      c.members[r.i]!.anim = r.anim;
      c.commit();
      this.recipient = null;
    }
    if (play.id === 'skate' && this.run) {
      this.clearRun();
      this.roamLight.position.copy(this.roamHome);
      // Step off the ice onto the bank.
      this.placePlayer(35.4, 29.6, 'up');
    }
  }

  protected override playerPose(rig: PlayerRig, play: PlayState): ActionPose | null {
    rig.tool.visible = false;
    if (play.id === 'skate') {
      const t = play.t;
      const stun = play.stats.stun ?? 0;
      if (stun > 0) {
        // Windmilling arms, wobbling on the ice.
        const w = Math.sin(t * 18);
        rig.torso.rotation.set(0.1, 0, w * 0.25);
        rig.head.rotation.set(-0.1, 0, -w * 0.2);
        rig.armL.rotation.set(-2.4 + w * 0.6, 0, 1.2);
        rig.armR.rotation.set(-2.4 - w * 0.6, 0, -1.2);
        rig.legL.rotation.set(-0.3, 0, 0.3);
        rig.legR.rotation.set(0.2, 0, -0.3);
        return { bob: 0.02, sy: 0.94 };
      }
      const push = play.live ? Math.sin(t * (play.boost ? 7 : 4.5)) : 0;
      // Lean into the glide, arms out for balance, long alternating strokes.
      rig.torso.rotation.set(0.38, push * 0.15, -play.steer * 0.18);
      rig.head.rotation.set(-0.3, 0, play.steer * 0.1);
      rig.legL.rotation.set(Math.max(0, push) * -0.7, 0, 0.12 + Math.max(0, push) * 0.25);
      rig.legR.rotation.set(Math.max(0, -push) * -0.7, 0, -0.12 - Math.max(0, -push) * 0.25);
      rig.armL.rotation.set(-0.3 + push * 0.4, 0, 1.0 - play.steer * 0.3);
      rig.armR.rotation.set(-0.3 - push * 0.4, 0, -1.0 - play.steer * 0.3);
      return { bob: Math.abs(push) * 0.03 - 0.04, sy: 0.96 };
    }
    if (play.id === 'giftswap') {
      // Holding the present out with both hands.
      const b = Math.sin(play.t * 3) * 0.05;
      rig.armL.rotation.set(-1.2 + b, 0, 0.25);
      rig.armR.rotation.set(-1.2 + b, 0, -0.25);
      return null;
    }
    return null;
  }

  private updateSkate(dt: number, game: Game): void {
    const run = this.run;
    const play = this.play;
    const kit = this.skateKit;
    if (!run || !play || play.id !== 'skate' || !kit) return;
    const st = play.stats;
    const burst = (x: number, z: number, color: number, count: number): void => this.burst(x, ICE_Y + 0.6, z, { color, count, speed: 2, size: 0.12, gravity: 1, life: 1, up: 1, spread: 0.2 });
    if (play.live && !play.done) {
      // Autopilot (attract mode): aim for the next gate / star on this leg, swerve round cracks.
      if (st.auto) {
        const next = run.items.filter((it) => it.leg === run.leg && !it.done && (it.x - run.x) * run.dir > -0.2).sort((p, q) => (p.x - q.x) * run.dir)[0];
        let goal = next ? next.off : 0;
        if (next?.kind === 'crack') goal = next.off + (next.off > 0 ? -0.95 : 0.95);
        play.steer = THREE.MathUtils.clamp((goal - run.off) * 2.2, -1, 1);
        play.boost = !next || Math.abs(next.x - run.x) > 3;
      }
      run.stun = Math.max(0, run.stun - dt);
      run.turn = Math.max(0, run.turn - dt);
      const target = run.stun > 0 ? 0.7 : run.turn > 0 ? 1.4 : play.boost ? 3.6 : 2.3;
      run.vx += (target - run.vx) * (1 - Math.exp(-(run.stun > 0 ? 5 : 1.5) * dt));
      run.x += run.vx * dt * run.dir;
      run.dist += run.vx * dt;
      // ↑ ↓ steer across the ice (screen-relative: down the screen = toward the near bank).
      run.off = THREE.MathUtils.clamp(run.off + play.steer * (run.stun > 0 ? 0.6 : 2.4) * dt, -1.45, 1.45);
      // Items on this leg: thread gates, grab stars, dodge cracks.
      for (const it of run.items) {
        if (it.done || it.leg !== run.leg || Math.abs(it.x - run.x) > 0.3) continue;
        it.done = true;
        const z = this.riverZ(it.x) + it.off;
        const d = Math.abs(run.off - it.off);
        if (it.kind === 'gate') {
          if (d < 0.52) {
            run.gates++;
            run.combo++;
            run.comboT = 1;
            burst(it.x, z, 0xffd84a, 26);
            it.hit = true;
          } else {
            run.combo = 0;
            run.comboT = 0;
          }
        } else if (it.kind === 'star') {
          if (d < 0.55) {
            run.stars++;
            play.score++;
            run.combo++;
            run.comboT = 1;
            burst(it.x, z, 0xfff0a0, 22);
          }
        } else if (d < 0.46) {
          run.cracks++;
          run.stun = 1.1;
          run.combo = 0;
          run.comboT = 0;
          this.burst(it.x, ICE_Y + 0.1, z, { color: 0xd8ecff, count: 34, speed: 2.6, size: 0.09, gravity: 5, life: 0.8, up: 1.2, spread: 0.4 });
        }
        run.best = Math.max(run.best, run.combo);
      }
      run.comboT = Math.max(0, run.comboT - dt / 3.2);
      if (run.comboT <= 0) run.combo = 0;
      // Turn at the end of the reach (a hockey-stop spray), next leg.
      const end = run.dir > 0 ? run.x >= SKATE.x1 : run.x <= SKATE.x0;
      if (end) {
        this.burst(run.x, ICE_Y + 0.05, this.riverZ(run.x) + run.off, { color: 0xe8f4ff, count: 30, speed: 2, size: 0.09, gravity: 4, life: 0.6, up: 0.7, spread: 0.3 });
        run.leg++;
        if (run.leg >= LAPS * 2) play.done = true;
        else {
          run.dir = run.dir > 0 ? -1 : 1;
          run.turn = 0.5;
          run.x = THREE.MathUtils.clamp(run.x, SKATE.x0, SKATE.x1);
          this.game.player.setFacing(run.dir > 0 ? 'right' : 'left');
          this.layoutLeg();
        }
      }
      play.progress[0] = THREE.MathUtils.clamp(run.dist / ((SKATE.x1 - SKATE.x0) * LAPS * 2), 0, 1);
      // Ice spray off the blades.
      run.spray -= dt;
      if (run.spray <= 0) {
        run.spray = play.boost ? 0.06 : 0.14;
        const z = this.riverZ(run.x) + run.off;
        this.burst(run.x - 0.2 * run.dir, ICE_Y + 0.05, z, { color: 0xe8f4ff, count: play.boost || Math.abs(play.steer) > 0.5 ? 5 : 2, speed: 0.9, size: 0.07, gravity: 4, life: 0.5, up: 0.6, spread: 0.2 });
      }
    }
    Object.assign(st, { lap: Math.min(LAPS, Math.floor(run.leg / 2) + 1), gates: run.gates, stars: run.stars, cracks: run.cracks, combo: run.combo, comboT: run.comboT, best: run.best, stun: run.stun, leg: run.leg });
    const z = this.riverZ(run.x) + run.off;
    this.movePlayer(run.x, z, ICE_Y + 0.02);
    // Blade scratches follow you across the ice.
    run.trailT -= dt;
    if (run.trailT <= 0 && play.live) {
      run.trailT = 0.05;
      kit.trail.push(run.x, z, game.time, run.dir);
    }
    kit.trail.update(game.time);
    // A warm lantern glow rides along with the skater.
    this.roamLight.position.set(run.x + run.dir * 1.2, ICE_Y + 2.4, z - 1.4);
    this.roamLight.intensity *= 0.4;
    const h = game.rc.renderer.domElement.height;
    kit.glow.setViewportHeight(h);
    // Beacons: stars (gold) and gate lanterns (blue until threaded, then gold) on this leg.
    let gi = 0;
    for (const it of run.items) {
      if (it.leg !== run.leg || it.kind === 'crack' || gi >= SK_GLOWS - 1) continue;
      const iz = this.riverZ(it.x) + it.off;
      if (it.kind === 'star') kit.glow.set(gi++, it.x, ICE_Y + 0.55 + Math.sin(game.time * 2 + it.x) * 0.08, iz, it.done ? 0 : 1.2);
      else for (const s of [-1, 1]) if (gi < SK_GLOWS) kit.glow.set(gi++, it.x, ICE_Y + 1.14, iz + s * 0.6, it.hit ? 1.0 : 0.55);
    }
    for (; gi < SK_GLOWS; gi++) kit.glow.set(gi, 0, -50, 0, 0);
  }

  protected override lampLevel(game: Game): number {
    return Math.max(0.3, super.lampLevel(game));
  }

  protected override tick(dt: number, game: Game): void {
    this.updateSkate(dt, game);
    this.updatePresent(game);
    const t = game.time;
    const h = game.rc.renderer.domElement.height;
    this.snow.update(game.rc.rig.focus, h);
    this.stardust.update(_dust.set(TREE.x, this.H(TREE.x, TREE.z) + 1, TREE.z + 2), h);
    this.starLight.intensity *= 0.85 + 0.15 * Math.sin(t * 2.1);
    const crowd = this.crowd;
    if (!crowd) return;
    for (const s of this.skaters) {
      const a = s.a0 + t * s.sp;
      const x0 = s.cx + Math.cos(a) * s.rx;
      const zc = this.riverZ(x0);
      const z0 = zc + Math.sin(a) * s.rz;
      const dx = -Math.sin(a) * s.rx * Math.sign(s.sp);
      const dz = Math.cos(a) * s.rz * Math.sign(s.sp) + (this.riverZ(x0 + 0.1) - zc) * 10 * dx;
      const l = Math.hypot(dx, dz) || 1;
      // Pairs skate side by side (offset across the direction of travel).
      const x = x0 + (dz / l) * s.side;
      const z = z0 - (dx / l) * s.side;
      const m = crowd.members[s.i]!;
      m.x = x;
      m.z = z;
      m.y = ICE_Y + 0.02;
      m.yaw = Math.atan2(dx, dz);
    }
    crowd.commit();
  }
}

/** A little wooden sled: two curled runners, slatted seat, a pull rope. */
function buildSled(tint: number): THREE.Group {
  const b = new MeshBuilder();
  for (const sz of [-1, 1]) {
    const pts = [new THREE.Vector3(-0.55, 0.04, 0), new THREE.Vector3(0.35, 0.04, 0), new THREE.Vector3(0.58, 0.14, 0), new THREE.Vector3(0.52, 0.28, 0)];
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.025, 5);
    b.add('metal', tube, mat(0, 0, sz * 0.2), { tint: 0x4a4a52 });
    for (const x of [-0.35, 0.2]) b.add('woodPaint', roundedBox(0.04, 0.14, 0.04, 0.01), mat(x, 0.1, sz * 0.2), { tint });
  }
  for (let i = 0; i < 5; i++) b.add('woodPaint', roundedBox(0.16, 0.035, 0.5, 0.012), mat(-0.45 + i * 0.19, 0.18, 0), { tint: i % 2 ? tint : 0xe8d8b8 });
  const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.52, 0.26, -0.18), new THREE.Vector3(0.75, 0.05, 0), new THREE.Vector3(0.52, 0.26, 0.18)]), 8, 0.012, 4);
  b.add('cloth', rope, undefined, { tint: 0xc8a878 });
  return b.build({ name: 'sled' });
}

function roundedBoxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  return roundedBox(w, h, d, 0.03, 2);
}

const LAPS = 4;
const SK_GLOWS = 14;

interface SkItem {
  kind: 'gate' | 'star' | 'crack';
  x: number;
  off: number;
  leg: number;
  done: boolean;
  hit?: boolean;
}

interface SkateKit {
  group: THREE.Group;
  posts: { count: number; setMatrixAt(i: number, m: THREE.Matrix4): void; commit(): void };
  cracks: THREE.InstancedMesh;
  glow: GlowPoints;
  trail: SkateTrail;
}

/** Twin blade scratches behind the skater: a strip per blade, fading over a few seconds. */
class SkateTrail {
  readonly mesh: THREE.Mesh;
  private pts: { x: number; z: number; t: number; dir: number }[] = [];
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private static N = 120;
  constructor(private y: number) {
    const N = SkateTrail.N;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(N * 4 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(N * 4 * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      for (const b of [0, 2]) {
        const a = i * 4 + b;
        const c = (i + 1) * 4 + b;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.userData.noAO = true;
    this.mesh.name = 'skate-trail';
  }
  reset(): void {
    this.pts = [];
  }
  push(x: number, z: number, t: number, dir: number): void {
    this.pts.push({ x, z, t, dir });
    if (this.pts.length > SkateTrail.N) this.pts.shift();
  }
  update(t: number): void {
    const N = SkateTrail.N;
    const n = this.pts.length;
    for (let i = 0; i < N; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const q = this.pts[Math.min(i + 1, n - 1)] ?? p;
      if (!p || i >= n) {
        for (let k = 0; k < 4; k++) this.col.setXYZW(i * 4 + k, 0, 0, 0, 0);
        continue;
      }
      let dx = (q?.x ?? p.x) - p.x;
      let dz = (q?.z ?? p.z) - p.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const a = Math.max(0, 1 - (t - p.t) / 5) * 0.55;
      let k = 0;
      for (const blade of [-0.11, 0.11]) {
        for (const w of [-0.012, 0.012]) {
          const o = blade + w;
          this.pos.setXYZ(i * 4 + k, p.x - dz * o, this.y, p.z + dx * o);
          this.col.setXYZW(i * 4 + k, 0.88, 0.94, 1.0, a);
          k++;
        }
      }
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}
