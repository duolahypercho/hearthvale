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
import type { Rng } from '../../core/rng';
import { NPCS, NPC_IDS, type NpcLook } from '../../data/npcs';
import { OUTFIT_PALETTES } from '../../data/festivals';
import { TileType } from '../tiles';
import { textures } from '../../render/textures';
import { buildTownHouse, buildHedge } from '../props/townkit';
import { buildLanternPost } from '../props/structures';
import { buildBunting } from '../props/festival';
import { buildSnowman, buildBench } from '../props/farmkit';
import { FestivalMap, type PlayState } from './base';
import type { ActionPose, PlayerRig } from '../../entities/player';
import { buildStarTree, buildIceSculpture, buildBridge, buildCocoaStand } from './kit';
import { Aurora, Snowfall, GlowPoints } from './fx';
import { FrozenRiver } from './sea';
import { randomLook, type CrowdSpec } from './crowd';

const TREE = { x: 32, z: 19.5 };
const PLAZA_R = 7.6;
const ICE_Y = -0.18;
const BRIDGE_X = 32;
/** Starlight Skate reach (east of the bridge, inside the camera bounds). */
const SKATE = { x0: 34.6, x1: 51.5 };

export class StarfallSquare extends FestivalMap {
  private river!: FrozenRiver;
  private aurora!: Aurora;
  private snow!: Snowfall;
  private stardust!: Snowfall;
  private skaters: { i: number; cx: number; rx: number; rz: number; sp: number; a0: number }[] = [];
  private starLight!: THREE.PointLight;
  /** Starlight Skate: the player's run along the river + the star lights to collect. */
  private run: { x: number; off: number; vx: number; dir: 1 | -1; dist: number; stars: { x: number; off: number; got: boolean }[]; glow: GlowPoints; spray: number } | null = null;
  private skateLight: THREE.PointLight | null = null;
  private recipient: { i: number; x: number; z: number; yaw: number; anim: number } | null = null;

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
  }

  // ───────────────────────────────────────────── shape

  private riverZ(x: number): number {
    return 33.2 + 1.6 * Math.sin(x * 0.09 + 0.8) + 0.6 * Math.sin(x * 0.23);
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
      this.glowPt(TREE.x + q.x, y + q.y, TREE.z + q.z, i % 5 === 0 ? 0xff7a6a : warm[i % 3]!, 0.42, 0.55);
    });
    for (const b of t.baubles) {
      if (r.next() < 0.6) continue;
      const q = b.p.clone().applyMatrix4(rot);
      this.glowPt(TREE.x + q.x, y + q.y, TREE.z + q.z, b.c, 0.3, 0.2);
    }
    this.glowPt(TREE.x, y + t.star.y, TREE.z, 0xffd070, 4.0, 0.12);
    this.glowPt(TREE.x, y + t.star.y, TREE.z, 0xfff6d8, 1.3, 0.3);
    this.starLight = this.addLight(TREE.x, y + t.star.y - 1, TREE.z + 1, 0xffd890, 14, 0.04, 16);
    this.addLight(TREE.x, y + 3, TREE.z + 4.2, 0xffc070, 18, 0.03, 12);
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
    this.root.add(this.river.mesh);
    const bz = this.riverZ(BRIDGE_X);
    const br = buildBridge(r, 7.2, 2.2, 0.35);
    this.addProp(br, BRIDGE_X, bz, Math.PI / 2, { y: 0 });
    // Lanterns along the east reach light the skating lane.
    for (const x of [38.5, 44.5, 50.5]) {
      const z = this.riverZ(x) - 3.1;
      this.addProp(buildLanternPost(), x, z, Math.PI, { solidR: 0.35 });
    }
    // Lamps at the bridge ends.
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const x = BRIDGE_X + sx * 1.5;
        const z = bz + sz * 4.0;
        this.addProp(buildLanternPost(), x, z, sx < 0 ? 0 : Math.PI, { solidR: 0.35 });
      }
    }
  }

  private buildSquare(r: Rng): void {
    // Lamp ring around the plaza.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (Math.abs(a - Math.PI / 2) < 0.3) continue;
      const x = TREE.x + Math.cos(a) * (PLAZA_R + 0.9);
      const z = TREE.z + Math.sin(a) * (PLAZA_R + 0.9);
      this.addProp(buildLanternPost(), x, z, -a + Math.PI, { solidR: 0.35 });
    }
    const cocoa = buildCocoaStand(r);
    this.addProp(cocoa.group, 20.8, 22.6, 0.55, { solidRect: [2.6, 1.2], ao: 1.8 });
    const sp = cocoa.steam.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.55);
    this.addSmoke(new THREE.Vector3(20.8 + sp.x, this.H(20.8, 22.6) + sp.y, 22.6 + sp.z), 1.6);
    this.glowPt(20.8, this.H(20.8, 22.6) + 2.2, 22.6 + 0.6, 0xffc070, 1.1, 0.03);
    this.addLight(21.4, this.H(20.8, 22.6) + 2.0, 23.6, 0xffb060, 6, 0.03, 7);
    this.addProp(buildIceSculpture(r, 'swan'), 42.8, 24.6, -0.6, { solidR: 0.7 });
    this.addProp(buildIceSculpture(r, 'deer'), 44.6, 17.0, -1.2, { solidR: 0.7 });
    this.addProp(buildIceSculpture(r, 'star'), 19.8, 16.6, 0.4, { solidR: 0.7 });
    for (const [x, z] of [[42.8, 24.6], [44.6, 17.0], [19.8, 16.6]] as const) this.glowPt(x, this.H(x, z) + 1.3, z, 0x8ad0ff, 1.6, 0.1);
    this.addProp(buildSnowman(r), 15.6, 27.6, 0.4, { solidR: 0.5 });
    this.addProp(buildSnowman(r), 49.4, 27.2, -0.5, { solidR: 0.5 });
    this.addProp(buildBench(), 25.4, 27.2, Math.PI + 0.5, { solidR: 0.6 });
    this.addProp(buildBench(), 38.6, 27.2, Math.PI - 0.5, { solidR: 0.6 });
  }

  private plantTrees(r: Rng): void {
    for (const [x, z, s] of [[8.5, 18, 1.1], [56, 18.5, 1.05], [9.5, 27, 0.95], [55.5, 26.5, 1.0], [19, 8.2, 0.85], [45, 8.2, 0.9], [11, 41, 1.0], [53, 41.5, 1.05], [20, 42, 0.9], [44, 42.6, 0.95]] as const) this.addTree('pine', x, z, s);
    for (let z = -18; z < 66; z += 2.4) {
      for (let x = -18; x < 82; x += 2.4) {
        const jx = x + (r.next() - 0.5) * 2;
        const jz = z + (r.next() - 0.5) * 2;
        const d = this.rimDist(jx, jz);
        if (d < 1.2 || this.exitMask(jx, jz) > 0.2 || r.next() < 0.3) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.75) continue;
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
        if (rd > 2.0 && rd < 3.0 && r.next() < 0.3) {
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
      specs.push({ look, outfit: 'winter', anim, x, z, yaw, top: pick(P.tops), accent: pick(P.accents), phase: r.next(), speed: 0.85 + r.next() * 0.3, ...extra });
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
    const around: [number, number, number, CrowdSpec['anim'], CrowdSpec['props']][] = [
      [21.8, 24.4, 0.6, 'toast', ['mug']],
      [23.0, 23.6, -0.9, 'talk', ['mug']],
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
    // Skaters looping on the ice (animated in tick).
    const loops: [number, number, number, number][] = [
      [20, 5.5, 0.9, 0.35],
      [21, 4.5, 0.7, -0.3],
      [44, 6, 0.9, 0.28],
      [43, 4, 0.6, -0.4],
      [12, 3.5, 0.6, 0.45],
      [52, 3.5, 0.7, -0.33],
      [26, 3.0, 0.5, 0.5],
    ];
    loops.forEach(([cx, rx, rz, sp], k2) => {
      const i = person(randomLook(r, { palette: P.tops, child: k2 % 3 === 2 }), 'skate', cx, this.riverZ(cx), 0, { props: ['skates'], lift: ICE_Y - this.H(cx, this.riverZ(cx)) });
      this.skaters.push({ i, cx, rx, rz, sp, a0: r.next() * 6.28 });
    });
    // Onlookers on the banks + bridge.
    for (const [x, z, yaw, anim] of [[29.6, 29.0, Math.PI, 'wave'], [35.4, 28.8, Math.PI + 0.3, 'cheer'], [17.8, 29.4, Math.PI - 0.4, 'clap'], [47.0, 29.2, Math.PI + 0.2, 'wave']] as const) {
      person(randomLook(r, { palette: P.tops, child: r.next() < 0.3 }), anim, x, z, yaw, {});
    }
    this.crowdSpecs = specs;
  }

  private buildSky(): void {
    // The diorama camera never sees open sky, so the curtains hang low over the forest just behind the
    // rooftops: a luminous veil rising out of the northern treeline (houses occlude its hem).
    this.aurora = new Aurora(new THREE.Vector3(32, 0, 36), 30, 3, { base: 2.5, height: 15, arc: 0.95, spacing: 0.035 });
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
    if (play.id === 'skate' && this.run) {
      this.run.glow.points.removeFromParent();
      this.run = null;
    }
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
      // Out along the east reach (clear of the bridge), a U-turn at the bend, and back.
      const stars: { x: number; off: number; got: boolean }[] = [];
      for (let x = SKATE.x0 + 2.5; x <= SKATE.x1 - 1; x += 2.4) stars.push({ x, off: 0.75 + 0.45 * Math.sin(x * 0.9), got: false });
      for (let x = SKATE.x1 - 2.2; x >= SKATE.x0 + 1.5; x -= 2.4) stars.push({ x, off: -0.75 - 0.45 * Math.sin(x * 1.3), got: false });
      const glow = new GlowPoints(stars.map((s) => ({ x: s.x, y: ICE_Y + 0.6, z: this.riverZ(s.x) + s.off, color: 0xffd84a, size: 1.1, twinkle: 0.3, day: 1 })), 'skate-stars');
      glow.points.frustumCulled = false;
      glow.points.userData.perfTag = 'festival';
      this.root.add(glow.points);
      this.run = { x: SKATE.x0, off: 0, vx: 0, dir: 1, dist: 0, stars, glow, spray: 0 };
      play.total = stars.length;
      this.placePlayer(SKATE.x0, this.riverZ(SKATE.x0), 'right', ICE_Y + 0.02);
      this.frame({ pitch: 46, distance: 19, yaw: 0, ox: 2.4, oz: -3.2 });
      if (!this.skateLight) this.skateLight = this.addLight(SKATE.x0, 1.6, 30, 0xffc890, 5, 0.02, 7);
    }
  }

  protected override onPlayEvent(play: PlayState, kind: string, value: number): void {
    const p = this.game.player.position;
    if (kind === 'restart') {
      // Attract mode loops: back to the start line.
      if (play.id === 'skate') this.onBeginPlay(play);
      return;
    }
    if (play.id === 'giftswap') {
      const r = this.recipient;
      const rp = r ? this.memberPos(r.i) : p;
      if (kind === 'given') {
        const col = value >= 3 ? 0xff6a8a : value === 2 ? 0xffc0d0 : 0xfff0e0;
        this.burst(rp.x, rp.y + 1.6, rp.z, { color: col, count: value * 10, speed: 1.4, size: 0.14, gravity: -0.4, life: 1.8, up: 0.8, spread: 0.4 });
        if (r && value >= 2) {
          this.crowd?.setAnim(r.i, 'cheer');
          this.crowd?.commit();
        }
      } else if (kind === 'unwrap') {
        for (const c of [0xd8312a, 0xf2d27a, 0x2f6a4a, 0xffffff]) this.burst(p.x, p.y + 1.2, p.z - 0.4, { color: c, count: 16, speed: 2.4, size: 0.1, gravity: 2.5, life: 1.6, up: 1.2, spread: 0.3 });
      }
    }
    void value;
  }

  protected override onEndPlay(play: PlayState): void {
    const c = this.crowd;
    if (play.id === 'giftswap' && c && this.recipient) {
      const r = this.recipient;
      c.place(r.i, r.x, r.z, r.yaw);
      c.members[r.i]!.anim = r.anim;
      c.commit();
      this.recipient = null;
    }
    if (play.id === 'skate' && this.run) {
      this.run.glow.points.removeFromParent();
      this.run.glow.points.geometry.dispose();
      this.run = null;
      this.skateLight?.position.set(0, -50, 0);
      // Step off the ice onto the bank.
      this.placePlayer(35.4, 29.6, 'up');
    }
  }

  protected override playerPose(rig: PlayerRig, play: PlayState): ActionPose | null {
    rig.tool.visible = false;
    if (play.id === 'skate') {
      const t = play.t;
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
    if (!run || !play || play.id !== 'skate') return;
    if (play.live && !play.done) {
      const target = play.boost ? 4.4 : 2.7;
      run.vx += (target - run.vx) * (1 - Math.exp(-1.6 * dt));
      run.x += run.vx * dt * run.dir;
      run.dist += run.vx * dt;
      // Steering is screen-relative (◀ ▶ = north / south of the ice as you face along it).
      run.off = THREE.MathUtils.clamp(run.off - play.steer * run.dir * 2.1 * dt, -1.45, 1.45);
      if (run.dir > 0 && run.x >= SKATE.x1) {
        run.dir = -1;
        this.game.player.setFacing('left');
        this.burst(run.x, ICE_Y + 0.05, this.riverZ(run.x) + run.off, { color: 0xe8f4ff, count: 26, speed: 1.8, size: 0.09, gravity: 4, life: 0.6, up: 0.7, spread: 0.3 });
      }
      const L = (SKATE.x1 - SKATE.x0) * 2;
      play.progress[0] = THREE.MathUtils.clamp(run.dist / L, 0, 1);
      if (run.dir < 0 && run.x <= SKATE.x0) play.done = true;
      // Ice spray off the blades.
      run.spray -= dt;
      if (run.spray <= 0) {
        run.spray = play.boost ? 0.06 : 0.14;
        const z = this.riverZ(run.x) + run.off;
        this.burst(run.x - 0.2 * run.dir, ICE_Y + 0.05, z, { color: 0xe8f4ff, count: play.boost || Math.abs(play.steer) > 0.5 ? 5 : 2, speed: 0.9, size: 0.07, gravity: 4, life: 0.5, up: 0.6, spread: 0.2 });
      }
    }
    const z = this.riverZ(run.x) + run.off;
    this.movePlayer(run.x, z, ICE_Y + 0.02);
    // A warm lantern glow rides along with the skater.
    this.skateLight?.position.set(run.x - run.dir * 0.4, ICE_Y + 1.7, z + 0.8);
    const h = game.rc.renderer.domElement.height;
    run.glow.setViewportHeight(h);
    run.stars.forEach((s, k) => {
      const sz = this.riverZ(s.x) + s.off;
      if (!s.got && Math.hypot(s.x - run.x, sz - z) < 0.8) {
        s.got = true;
        play.score++;
        this.burst(s.x, ICE_Y + 0.7, sz, { color: 0xffd84a, count: 22, speed: 2, size: 0.12, gravity: 1, life: 1, up: 1, spread: 0.2 });
      }
      run.glow.set(k, s.x, ICE_Y + 0.55 + Math.sin(game.time * 2 + k) * 0.08, sz, s.got ? 0 : 1.1);
    });
  }

  protected override lampLevel(game: Game): number {
    return Math.max(0.3, super.lampLevel(game));
  }

  protected override tick(dt: number, game: Game): void {
    this.updateSkate(dt, game);
    const t = game.time;
    const h = game.rc.renderer.domElement.height;
    this.snow.update(game.rc.rig.focus, h);
    this.stardust.update(new THREE.Vector3(TREE.x, this.H(TREE.x, TREE.z) + 1, TREE.z + 2), h);
    this.starLight.intensity *= 0.85 + 0.15 * Math.sin(t * 2.1);
    const crowd = this.crowd;
    if (!crowd) return;
    for (const s of this.skaters) {
      const a = s.a0 + t * s.sp;
      const x = s.cx + Math.cos(a) * s.rx;
      const zc = this.riverZ(x);
      const z = zc + Math.sin(a) * s.rz;
      const dx = -Math.sin(a) * s.rx * Math.sign(s.sp);
      const dz = Math.cos(a) * s.rz * Math.sign(s.sp) + (this.riverZ(x + 0.1) - zc) * 10 * dx;
      const m = crowd.members[s.i]!;
      m.x = x;
      m.z = z;
      m.y = ICE_Y + 0.02;
      m.yaw = Math.atan2(dx, dz);
    }
    crowd.commit();
  }
}
