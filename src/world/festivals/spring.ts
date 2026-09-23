/**
 * Spring — the Blossom Parade on Petal Lane.
 *
 *   north  hills + forest rim, a row of pastel townhouses with flower boxes and garlands
 *   middle Petal Lane: a cobbled avenue carpeted with petals, lamp posts strung with pastel
 *          bunting, two flower arches; the parade floats (tulips, blossom tree, the Blossom
 *          Queen's heart throne, a petal swan) roll east through it
 *   south  the Dance Green: a ribboned blossom pole with two rings of dancers weaving opposite
 *          ways, the bandstand (fiddle, flute, singer), a bun stall, the flower cart, picnic tables
 *   air    a petal storm riding the gusts
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { smoothstep } from '../../core/noise';
import { NPCS, NPC_IDS, type NpcLook } from '../../data/npcs';
import { OUTFIT_PALETTES } from '../../data/festivals';
import { TileType } from '../tiles';
import { textures } from '../../render/textures';
import { buildTownHouse, buildMarketStall, buildFlowerCart, buildPlanter, buildHedge } from '../props/townkit';
import { buildLanternPost } from '../props/structures';
import { buildBench } from '../props/farmkit';
import { buildBunting, buildFeastTable, FESTIVAL_COLORS } from '../props/festival';
import { FestivalMap, type PlayState } from './base';
import type { ActionPose, PlayerRig } from '../../entities/player';
import { buildFlowerFloat, buildFlowerArch, buildBandstand, buildBlossomPole, buildCherryTrees } from './kit';
import { PetalStorm, GroundScatter, PetalFall, Ribbons } from './fx';
import { patchMaterial, after, before } from '../../render/patch';
import { randomLook, type CrowdSpec } from './crowd';
import { Rng } from '../../core/rng';

const AVENUE: [number, number][] = [[-16, 22.6], [-2, 22.2], [10, 21.2], [22, 20.6], [32, 21.0], [42, 21.5], [54, 20.8], [66, 21.2], [82, 21.8]];
const GREEN = { x: 32, z: 31.2, r: 5.6 };
const POLE_R = 3.4;
/** Blossom pole: height of the ribbon crown above the ground, plait radius, max plait length. */
const POLE_H = 5.2;
const PLAIT_R = 0.2;
const PLAIT_MAX = 2.7;
/** Ribbon dancers (one ring, alternate dancers circling opposite ways, weaving in and out). */
const DANCERS = 8;
const RIBBON_COLORS = [0xf06a8a, 0xffd166, 0x7ec8ff, 0xc77dff, 0x8fce6a, 0xffffff, 0xff9a6a, 0x5fd8c8];

export class SpringParade extends FestivalMap {
  private curve!: THREE.CatmullRomCurve3;
  private avenueSamples: { x: number; z: number }[] = [];
  private floats: { group: THREE.Group; s: number; rider?: number; riderLocal?: THREE.Vector3; riderYawOff: number }[] = [];
  private dancers: { i: number; dir: 1 | -1; a: number }[] = [];
  private ribbons!: Ribbons;
  private plait!: THREE.Mesh;
  private plaitLen = { value: 0.8 };
  private poleY = 0;
  private hand = new THREE.Vector3();
  private anchor = new THREE.Vector3();
  /** Partner hop (squash-and-stretch spring) during the Ribbon Dance. */
  private hop = { v: 0, x: 0 };
  private petals!: PetalStorm;
  private curveLen = 1;
  /** Dance partner while the Ribbon Dance mini-game runs. */
  private partner: { i: number; x: number; z: number; yaw: number; anim: number } | null = null;

  constructor(game: Game) {
    super(game, {
      id: 'fest-spring',
      title: 'Blossom Parade · Petal Lane',
      size: { w: 64, d: 48 },
      extent: { minX: -20, minZ: -20, maxX: 84, maxZ: 68 },
      spawn: { x: 31.5, z: 38.5, facing: 'up' },
      bounds: [12, 12, 52, 38],
      terrain: { pathTexture: textures.cobble().map, pathScale: 0.48 },
      warps: [{ x0: 29, z0: 47, x1: 34, z1: 47, to: 'farm', x: 61.5, z: 28.5, facing: 'left' }],
    });
    this.curve = new THREE.CatmullRomCurve3(AVENUE.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    this.curveLen = this.curve.getLength();
    const n = Math.ceil(this.curveLen / 0.4);
    for (let k = 0; k <= n; k++) {
      const p = this.curve.getPointAt(k / n);
      this.avenueSamples.push({ x: p.x, z: p.z });
    }
    this.activitySpots.push({ id: 'dance', x: GREEN.x, z: GREEN.z, r: POLE_R + 2.2 });
  }

  // ───────────────────────────────────────────── shape

  private rimDist(x: number, z: number): number {
    const qx = Math.abs(x - 32) - (31 - 8);
    const qz = Math.abs(z - 25) - (22 - 8);
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - 8 + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.2;
  }

  private exitMask(x: number, z: number): number {
    const lane = smoothstep(4.2, 2.6, Math.abs(z - 21.5)) * (smoothstep(4, -2, x) + smoothstep(58, 64, x));
    const south = smoothstep(3.2, 1.6, Math.abs(x - 31.5)) * smoothstep(42, 48, z);
    return Math.min(1, lane + south);
  }

  private avenueDist(x: number, z: number): number {
    let best = 99;
    for (const s of this.avenueSamples) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  }

  protected height(x: number, z: number): number {
    const d = this.rimDist(x, z);
    const n = this.noise;
    const hills = (smoothstep(-0.5, 5, d) * 1.6 + smoothstep(4, 20, d) * (2.8 + n.fbm(x * 0.04 + 5, z * 0.04, 3) * 3)) * (1 - this.exitMask(x, z));
    // Houses sit on a gentle rise north of the lane.
    const rise = smoothstep(17, 11, z) * 0.35;
    const green = -smoothstep(GREEN.r + 1.5, GREEN.r - 1, Math.hypot(x - GREEN.x, z - GREEN.z)) * 0.08;
    return hills + rise + green + n.fbm(x * 0.05 + 3, z * 0.05, 2) * 0.12;
  }

  private pathValue(x: number, z: number): number {
    const ad = this.avenueDist(x, z) + this.noise.get(x * 0.4, z * 0.4) * 0.2;
    let v = smoothstep(3.0, 2.3, ad);
    // Ring path around the dance green + spokes to the bandstand / picnic / south exit.
    const gd = Math.hypot(x - GREEN.x, z - GREEN.z);
    v = Math.max(v, smoothstep(0.75, 0.35, Math.abs(gd - (GREEN.r + 0.5))));
    v = Math.max(v, smoothstep(0.9, 0.5, Math.abs(x - 31.5)) * smoothstep(GREEN.z + GREEN.r, GREEN.z + GREEN.r + 1, z));
    v = Math.max(v, smoothstep(0.8, 0.45, Math.abs(z - 31.4)) * smoothstep(GREEN.x + GREEN.r, GREEN.x + GREEN.r + 1, x) * smoothstep(44.5, 43.5, x));
    v = Math.max(v, smoothstep(0.8, 0.45, Math.abs(z - 31.0)) * smoothstep(GREEN.x - GREEN.r, GREEN.x - GREEN.r - 1, x) * smoothstep(17, 18.5, x));
    v = Math.max(v, smoothstep(2.4, 1.6, Math.hypot(x - 46, z - 31.5)));
    // Doorstep paths from the houses.
    for (const hx of [14.5, 23.5, 32, 40.5, 49.5]) v = Math.max(v, smoothstep(0.75, 0.4, Math.abs(x - hx)) * smoothstep(15.2, 16, z) * smoothstep(19.5, 18.5, z));
    return v;
  }

  protected paint(): void {
    this.terrain.paint('path', (x, z) => this.pathValue(x, z));
    this.terrain.paintCover('clover', (x, z) => smoothstep(0.6, 0.75, this.noise.fbm(x * 0.15 + 9, z * 0.15, 2) * 0.5 + 0.5) * (1 - this.pathValue(x, z)), { x0: -2, z0: -2, x1: 66, z1: 50 });
  }

  protected override tileBlocked(x: number, z: number): boolean {
    return this.rimDist(x, z) > -0.2 && this.exitMask(x, z) < 0.5;
  }

  protected override tileType(x: number, z: number): TileType {
    return this.terrain.splatAt(x, z, 'path') > 0.5 ? TileType.Stone : TileType.Grass;
  }

  protected grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.78) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.25) return 0;
    const onGreen = Math.hypot(x - GREEN.x, z - GREEN.z) < GREEN.r;
    const clump = smoothstep(-0.1, 0.5, this.noise.fbm(x * 0.13 + 4, z * 0.13, 2));
    return (onGreen ? 5 : 3 + clump * 4.5) * (pv > 0.05 ? 0.55 : 1);
  }

  protected override grassTallness(x: number, z: number): number {
    const onGreen = Math.hypot(x - GREEN.x, z - GREEN.z) < GREEN.r + 0.3;
    return onGreen ? 0.12 : 0.15 + 0.4 * smoothstep(0.1, 0.6, this.noise.fbm(x * 0.09, z * 0.09, 2)) * smoothstep(-6, -1, this.rimDist(x, z));
  }

  // ───────────────────────────────────────────── dressing

  protected dress(): void {
    const r = this.rng.fork('dress');
    this.buildHouses(r);
    this.buildLane(r);
    this.buildGreen(r);
    this.buildFloats(r);
    this.plantTrees(r);
    this.plantNature(r);
    this.buildCrowd(r);
    this.petals = new PetalStorm({ count: 3200, box: new THREE.Vector3(46, 9, 34), colors: [0xf9c6d6, 0xfbd8e2, 0xffffff, 0xf4aec4, 0xfde8ee], drift: 1.3, fall: 0.3, size: 1.7 });
    this.root.add(this.petals.mesh);
    this.fx.push({ update: (_dt, game) => this.petals.update(game.rc.rig.focus) });
    // Petal carpet on the lane and the green's ring.
    const items: { x: number; y: number; z: number; rot: number; color: number }[] = [];
    const cr = new Rng('petal-carpet');
    for (let i = 0; i < 5200; i++) {
      const x = 4 + cr.next() * 56;
      const z = 13 + cr.next() * 26;
      const pv = this.terrain.splatAt(x, z, 'path');
      const nearTree = cr.next();
      if (pv < 0.4 && nearTree > 0.35) continue;
      if (this.grid.inBounds(Math.floor(x), Math.floor(z)) && !this.grid.isWalkable(Math.floor(x), Math.floor(z)) && pv < 0.4) continue;
      const clump = this.noise.fbm(x * 0.35, z * 0.35, 2);
      if (clump < -0.15 && cr.next() < 0.7) continue;
      items.push({ x, y: this.H(x, z), z, rot: cr.next() * 6.28, color: [0xf9c6d6, 0xffffff, 0xf4aec4, 0xfbd8e2, 0xf06a8a][Math.floor(cr.next() * 5)]! });
    }
    const carpet = new GroundScatter(items, 'petal');
    carpet.mesh.userData.perfTag = 'festival';
    this.root.add(carpet.mesh);
  }

  private buildHouses(r: Rng): void {
    const houses: [number, number, Parameters<typeof buildTownHouse>[1]][] = [
      [14.5, 11.8, { w: 5.6, d: 4.4, wallH: 2.8, wall: 'plaster', wallTint: 0xfbe6ec, roofTint: 0xd87a8a, doorTint: 0x5a8ab0, shutterTint: 0x7ab0c8, chimney: true, flowerBoxes: true }],
      [23.5, 11.4, { w: 6.4, d: 4.8, wallH: 3.1, wall: 'wood', wallTint: 0xf6ecd0, roofTint: 0x7ab0a0, doorTint: 0xd06a5a, awning: [0xf7a8c0, 0xfbf2e8], flowerBoxes: true, doorX: 1 }],
      [32, 10.9, { w: 7.0, d: 5.0, wallH: 3.4, wall: 'stone', wallTint: 0xf2e2d0, roofTint: 0x8a7ab8, doorTint: 0x3f7a6a, awning: [0xb8e0f0, 0xfbf2e8], flowerBoxes: true, chimney: true }],
      [40.5, 11.4, { w: 6.2, d: 4.6, wallH: 3.0, wall: 'plaster', wallTint: 0xeaf4e4, roofTint: 0xe0a060, doorTint: 0x8a5a9a, shutterTint: 0xb07ab0, flowerBoxes: true, doorX: -1 }],
      [49.5, 11.8, { w: 5.6, d: 4.4, wallH: 2.7, wall: 'wood', wallTint: 0xfff0dc, roofTint: 0xd8b068, roof: 'thatch', doorTint: 0x4f7fb0, shutterTint: 0x4f7fb0, chimney: true, flowerBoxes: true }],
    ];
    for (const [x, z, spec] of houses) {
      const bp = buildTownHouse(r, spec);
      this.addProp(bp, x, z, 0, { solidRect: [spec.w + 0.4, spec.d + 0.4], ao: spec.w * 0.62 });
      if (bp.anchors.chimney) this.addSmoke(bp.anchors.chimney.clone().applyMatrix4(bp.group.matrixWorld), 2.5);
      // Flower garland swag across the facade.
      const A = new THREE.Vector3(x - spec.w / 2 - 0.1, this.H(x, z) + spec.wallH + 0.25, z + spec.d / 2 + 0.25);
      const B = new THREE.Vector3(x + spec.w / 2 + 0.1, A.y, A.z);
      this.addProp(buildBunting(r, A, B, 0.45, Math.round(spec.w * 2.3), 0), 0, 0, 0, { y: 0 });
      for (const sx of [-1, 1]) this.addProp(buildPlanter(r, [0xff8fab, 0xffffff, 0xffd166, 0xc77dff]), x + sx * (spec.w / 2 - 0.6), z + spec.d / 2 + 1.0, 0, { solidR: 0.5 });
    }
  }

  private buildLane(r: Rng): void {
    // Lamp posts on both kerbs + pastel bunting criss-crossing the lane between them.
    const posts: THREE.Vector3[] = [];
    for (const x of [10, 19, 27.5, 36.5, 45, 54]) {
      let best = this.avenueSamples[0]!;
      for (const s of this.avenueSamples) if (Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
      for (const side of [-1, 1]) {
        const px = x;
        const pz = best.z + side * 3.1;
        const bp = buildLanternPost();
        this.addProp(bp, px, pz, side > 0 ? Math.PI : 0, { solidR: 0.4 });
        posts.push(new THREE.Vector3(px, this.H(px, pz) + 2.35, pz));
      }
    }
    for (let i = 0; i + 2 < posts.length; i += 2) {
      const [n0, s0, n1, s1] = [posts[i]!, posts[i + 1]!, posts[i + 2]!, posts[i + 3]!];
      if (!n1 || !s1) break;
      this.addProp(buildBunting(r, n0, s1, 0.5, 14, 0), 0, 0, 0, { y: 0 });
      this.addProp(buildBunting(r, s0, n1, 0.5, 14, 0), 0, 0, 0, { y: 0 });
    }
    // Flower arches over the lane.
    for (const x of [16.5, 48.5]) {
      let best = this.avenueSamples[0]!;
      for (const s of this.avenueSamples) if (Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
      const arch = buildFlowerArch(r, 6.2);
      this.addProp(arch, x, best.z, Math.PI / 2, {});
      this.blockCircle(x, best.z - 3.1, 0.4);
      this.blockCircle(x, best.z + 3.1, 0.4);
    }
    // Hedges + planters along the south kerb.
    for (const x of [12.5, 22.5, 41.5, 51.5]) this.addProp(buildHedge(r, 3.2), x, 25.2, 0, { solidRect: [3.2, 0.8] });
  }

  private buildGreen(r: Rng): void {
    const pole = buildBlossomPole(r, POLE_H);
    this.addProp(pole.group, GREEN.x, GREEN.z, 0, { solidR: 0.7, ao: 0.9 });
    this.poleY = this.H(GREEN.x, GREEN.z) - 0.03;
    // Ribbons (strung to the dancers' hands every frame) + the plait that weaves down the pole.
    this.ribbons = new Ribbons(DANCERS, RIBBON_COLORS);
    this.ribbons.mesh.userData.perfTag = 'festival';
    this.root.add(this.ribbons.mesh);
    this.plait = this.buildPlait();
    this.plait.position.set(GREEN.x, this.poleY + POLE_H - 0.06, GREEN.z);
    this.root.add(this.plait);
    // Bandstand east, picnic + bun stall west.
    this.addProp(buildBandstand(r), 46, 31.5, 0, { solidR: 2.7, ao: 3 });
    this.addProp(buildMarketStall(r, [0xf7a8c0, 0xfbf2e8]), 20.2, 27.6, 0.35, { solidRect: [2.8, 1.2], ao: 1.6 });
    this.addProp(buildFlowerCart(r), 14.6, 30.4, 0.6, { solidRect: [2, 1.2] });
    this.addProp(buildFeastTable(r, 4.2), 19.4, 34.2, 0.12, { solidRect: [4.4, 2.4], ao: 2 });
    this.addProp(buildBench(), 26.0, 38.2, Math.PI, { solidR: 0.6 });
    this.addProp(buildBench(), 38.0, 38.2, Math.PI, { solidR: 0.6 });
    this.addProp(buildMarketStall(r, [0xb8e0f0, 0xfbf2e8]), 44.4, 26.6, -0.3, { solidRect: [2.8, 1.2], ao: 1.6 });
  }

  /**
   * The maypole plait: a sleeve around the pole below the crown, woven from the ribbon colours in
   * a basket-weave (over / under diamonds). `plaitLen` (m) reveals it from the top down as the
   * dancers weave; the ribbons leave the pole from its lower edge.
   */
  private buildPlait(): THREE.Mesh {
    const g = new THREE.CylinderGeometry(PLAIT_R * 0.92, PLAIT_R, PLAIT_MAX, 28, 12, true);
    g.translate(0, -PLAIT_MAX / 2, 0);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.04 });
    m.name = 'maypole-plait';
    const cols = RIBBON_COLORS.map((c) => new THREE.Color(c).convertSRGBToLinear());
    patchMaterial(m, 'maypole-plait', (shader) => {
      shader.uniforms.uPlaitLen = this.plaitLen;
      shader.uniforms.uRib = { value: cols };
      shader.vertexShader = before(shader.vertexShader, 'void main() {', 'varying vec3 vPlait;');
      shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', 'vPlait = position;');
      let fs = before(shader.fragmentShader, 'void main() {', 'varying vec3 vPlait; uniform float uPlaitLen; uniform vec3 uRib[8];');
      fs = after(
        fs,
        '#include <color_fragment>',
        /* glsl */ `
        {
          float dn = -vPlait.y;
          if (dn > uPlaitLen) discard;
          float ang = atan(vPlait.z, vPlait.x) / 6.2831853 + 0.5;
          float a1 = ang * 8.0 + dn * 2.6;
          float a2 = ang * 8.0 - dn * 2.6;
          float i1 = floor(a1);
          float i2 = floor(a2);
          float over = mod(i1 + i2, 2.0);
          int k = over > 0.5 ? int(mod(i1, 8.0)) : int(mod(i2 + 3.0, 8.0));
          vec3 c = uRib[k];
          float e = over > 0.5 ? fract(a1) : fract(a2);
          float x = over > 0.5 ? fract(a2) : fract(a1);
          // Rounded satin bands: darker at the weave crossings, a sheen down the middle.
          float shade = (0.62 + 0.38 * sin(e * 3.14159)) * (0.8 + 0.2 * smoothstep(0.0, 0.18, min(x, 1.0 - x)));
          // The freshest turn (the lower lip) sits a little proud and bright.
          shade *= 1.0 + 0.15 * smoothstep(uPlaitLen - 0.12, uPlaitLen, dn);
          diffuseColor.rgb = c * shade;
        }`,
      );
      shader.fragmentShader = fs;
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noAO = true;
    mesh.userData.perfTag = 'festival';
    mesh.name = 'maypole-plait';
    return mesh;
  }

  private buildFloats(r: Rng): void {
    const kinds = ['throne', 'tulip', 'swan', 'sun'] as const;
    kinds.forEach((k, i) => {
      const f = buildFlowerFloat(r, k);
      f.group.userData.perfTag = 'floats';
      // Moving props skip the GTAO pass (contact shade comes from their shadows).
      f.group.traverse((o) => (o.userData.noAO = true));
      this.root.add(f.group);
      // Showcase spacing: the queen centre stage, others fore and aft.
      const s = [0.47, 0.375, 0.575, 0.285][i]!;
      this.floats.push({ group: f.group, s, riderLocal: f.anchors.seat, riderYawOff: k === 'throne' ? 0 : -Math.PI / 2 + 0.5 });
    });
  }

  private plantTrees(r: Rng): void {
    // Hero cherry trees (sculpted limbs + blossom clumps) along the south kerb and between houses.
    const hero: [number, number, number][] = [[9.5, 25.6, 1.0], [27.0, 25.9, 0.9], [37.0, 25.9, 0.9], [55.5, 25.4, 1.0], [19, 9.6, 0.95], [28, 9.0, 0.9], [36.3, 9.0, 0.9], [45, 9.4, 0.95], [8.2, 14, 1.1], [56.2, 14.2, 1.05], [12, 38.5, 0.95], [52.5, 38.8, 1.0], [24.5, 42, 0.9], [41, 42.5, 0.95]];
    const trees = hero.map(([x, z, s]) => ({ x, y: this.H(x, z), z, s }));
    const cherry = buildCherryTrees(r.fork('cherry'), trees);
    this.addProp(cherry.bark, 0, 0, 0, { y: 0 });
    cherry.bloom.userData.perfTag = 'trees';
    this.root.add(cherry.bloom);
    for (const t of trees) {
      this.blockCircle(t.x, t.z, 0.55 * t.s);
      this.terrain.stampCover('ao', t.x, t.z, 1.8 * t.s, 0.5);
    }
    const fall = new PetalFall(cherry.canopies, 60);
    fall.mesh.userData.perfTag = 'festival';
    this.root.add(fall.mesh);
    this.addTree('oak', 6, 31, 1.1);
    this.addTree('maple', 58, 31, 1.05);
    for (let z = -18; z < 66; z += 2.4) {
      for (let x = -18; x < 82; x += 2.4) {
        const jx = x + (r.next() - 0.5) * 2;
        const jz = z + (r.next() - 0.5) * 2;
        const d = this.rimDist(jx, jz);
        if (d < 1.2 || this.exitMask(jx, jz) > 0.2 || r.next() < 0.3) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.75) continue;
        // Keep the lens clear south of the green (arrival / dance framing).
        if (jz > 40 && jz < 56 && Math.abs(jx - 31.5) < 13) continue;
        const roll = r.next();
        const sp = roll < 0.3 ? 'pine' : roll < 0.55 ? 'oak' : roll < 0.7 ? 'maple' : 'blossom';
        this.trees.add(sp, jx, this.H(jx, jz) - 0.08, jz, 0.85 + r.next() * 0.45, undefined, d > 2.2 ? 1 : 0);
      }
    }
  }

  private plantNature(r: Rng): void {
    const g = this.grid;
    const blooms = [0xffffff, 0xffd166, 0xff8fab, 0xc77dff, 0x7ec8ff, 0xf06a8a];
    for (let z = 0; z < g.depth; z++) {
      for (let x = 0; x < g.width; x++) {
        const cx = x + 0.5 + (r.next() - 0.5) * 0.6;
        const cz = z + 0.5 + (r.next() - 0.5) * 0.6;
        if (!g.isWalkable(x, z)) continue;
        if (this.terrain.splatAt(cx, cz, 'path') > 0.05) continue;
        if (Math.hypot(cx - GREEN.x, cz - GREEN.z) < GREEN.r - 0.2) continue;
        const d = this.rimDist(cx, cz);
        const roll = r.next();
        const y = this.H(cx, cz);
        if (d > -2.4) {
          if (roll < 0.2) this.nature.place(r.next() < 0.3 ? 'berryBush' : 'bush', cx, y, cz, { scale: 0.8 + r.next() * 0.4, color: 0xf06a8a, lod: 1 });
          else if (roll < 0.34) this.nature.place('tallFlower', cx, y, cz, { color: blooms[Math.floor(r.next() * blooms.length)]!, scale: 1.1 });
          continue;
        }
        if (roll < 0.2) this.nature.place('flower', cx, y, cz, { color: blooms[Math.floor(r.next() * blooms.length)]!, scale: 1.1 });
        else if (roll < 0.24) this.nature.place('tallFlower', cx, y, cz, { color: blooms[Math.floor(r.next() * blooms.length)]!, scale: 1 });
        else if (roll < 0.3) this.nature.place('daisy', cx, y, cz, {});
      }
    }
    // Dense flower beds in front of the houses.
    for (const [x0, x1, z] of [[11.5, 17.5, 16.0], [20.5, 26.5, 16.0], [29, 35, 15.8], [37.5, 43.5, 16.0], [46.5, 52.5, 16.0]] as const) {
      for (let x = x0; x <= x1; x += 0.45) {
        if (Math.abs(x - (x0 + x1) / 2) < 0.9) continue;
        this.nature.place('flower', x, this.H(x, z), z + (r.next() - 0.5) * 0.4, { color: blooms[Math.floor(r.next() * blooms.length)]!, scale: 1.2 });
      }
    }
  }

  // ───────────────────────────────────────────── crowd

  private buildCrowd(r: Rng): void {
    const P = OUTFIT_PALETTES.spring;
    const specs: CrowdSpec[] = [];
    const pick = <T,>(a: T[]): T => a[Math.floor(r.next() * a.length)]!;
    const person = (look: NpcLook, anim: CrowdSpec['anim'], x: number, z: number, yaw: number, extra: Partial<CrowdSpec> = {}): number => {
      specs.push({ look, outfit: 'spring', anim, x, z, yaw, top: pick(P.tops), accent: pick(P.accents), phase: r.next(), speed: 0.85 + r.next() * 0.3, ...extra });
      return specs.length - 1;
    };
    // Named villagers.
    const named = NPC_IDS.map((id) => NPCS[id]);
    const spot: Record<string, [number, number, number, CrowdSpec['anim'], CrowdSpec['props']]> = {
      marigold: [15.6, 28.6, 0.9, 'wave', ['bouquet']],
      bram: [20.4, 26.6, 0.35, 'talk', ['pie']],
      wren: [29.2, 26.8, -2.6, 'cheer', ['flag']],
      // Hazel runs the Ribbon Dance from the west edge of the green.
      hazel: [25.9, 30.4, 1.35, 'clap', ['bouquet']],
    };
    let extraIdx = 0;
    for (const def of named) {
      const s = spot[def.id];
      if (s) {
        const i = person({ ...def.look, apron: undefined }, s[3], s[0], s[1], s[2], { id: def.id, props: s[4] });
        void i;
      } else {
        // Other named villagers line the lane.
        const x = 13 + extraIdx * 5.3;
        extraIdx++;
        person({ ...def.look, apron: undefined }, extraIdx % 2 ? 'cheer' : 'clap', x, 17.9 + (r.next() - 0.5) * 0.4, (r.next() - 0.5) * 0.5, { id: def.id });
      }
    }
    // Townsfolk on both kerbs (north faces the lane / camera; south mostly faces the lane).
    const kerbN = [11.2, 12.8, 17.6, 19.2, 21.4, 25.8, 27.4, 30.6, 33.8, 35.4, 38.6, 43.6, 47.2, 52.6];
    for (const x of kerbN) {
      const child = r.next() < 0.3;
      person(randomLook(r, { child, palette: P.tops }), pick(['cheer', 'wave', 'clap', 'cheer', 'wave'] as const), x + (r.next() - 0.5) * 0.4, 17.7 + (r.next() - 0.5) * 0.5, (r.next() - 0.5) * 0.6, { props: child ? [pick(['balloon', 'flag', 'balloon'] as const)] : r.next() < 0.3 ? ['flag'] : [] });
    }
    // South kerb: townsfolk with their backs to the lane, watching the ribbon dance on the green
    // (faces toward the camera, a few turned to chat).
    const kerbS = [13.4, 18.2, 24.4, 34.4, 39.8, 50.2, 53.8];
    for (const x of kerbS) {
      const child = r.next() < 0.35;
      person(randomLook(r, { child, palette: P.tops }), pick(['cheer', 'clap', 'wave', 'idle'] as const), x + (r.next() - 0.5) * 0.4, 24.6 + (r.next() - 0.5) * 0.4, (r.next() - 0.5) * 1.2, { props: child ? ['balloon'] : [] });
    }
    // Ribbon dancers: one ring round the blossom pole, alternate dancers circling opposite ways and
    // weaving in and out of each other; each holds the end of a ribbon up in the hand nearest the pole.
    for (let k = 0; k < DANCERS; k++) {
      const dir: 1 | -1 = k % 2 ? 1 : -1;
      const a = (k / DANCERS) * Math.PI * 2;
      const i = person(randomLook(r, { palette: P.tops }), dir > 0 ? 'ribbonL' : 'ribbonR', GREEN.x + Math.cos(a) * 3, GREEN.z + Math.sin(a) * 3, 0, { speed: 1 });
      this.dancers.push({ i, dir, a });
    }
    // Band in the bandstand.
    const bx = 46;
    const bz = 31.5;
    person(randomLook(r, { palette: P.tops }), 'fiddle', bx - 0.9, bz - 0.4, 0.3, { props: ['fiddle'], lift: 0.62 });
    person(randomLook(r, { palette: P.tops }), 'toast', bx + 0.9, bz - 0.3, -0.3, { props: ['flute'], lift: 0.62 });
    person(randomLook(r, { palette: P.tops }), 'carol', bx, bz + 0.6, 0, { props: ['songbook'], lift: 0.62 });
    // Picnickers + onlookers on the green's edge.
    person(randomLook(r, { palette: P.tops }), 'sit', 18.6, 33.1, 0, { lift: 0.18 });
    person(randomLook(r, { palette: P.tops }), 'toast', 20.4, 35.3, Math.PI, { props: ['mug'] });
    person(randomLook(r, { child: true, palette: P.tops }), 'cheer', 36.8, 35.2, -2.3, {});
    person(randomLook(r, { palette: P.tops }), 'clap', 26.2, 35.6, 2.4, {});
    person(randomLook(r, { palette: P.tops }), 'clap', 38.6, 28.4, -1.1, {});
    // Float riders: the Blossom Queen on her throne, waving kids on the other three.
    const queen = person({ skin: 0xf2c8a2, hair: 0xb8542a, hairStyle: 'bob', top: 0xffffff, bottom: 0xf7a8c0, scale: 0.95, build: 1, skirt: true }, 'wave', 0, 0, 0, { lift: 0, top: 0xfff4f8, accent: 0xf06a8a, props: ['bouquet'] });
    this.floats[0]!.rider = queen;
    for (const k of [1, 2, 3]) {
      const kid = person(randomLook(r, { child: true, palette: P.tops }), k === 2 ? 'cheer' : 'wave', 0, 0, 0, { props: k === 1 ? ['flag'] : k === 3 ? ['balloon'] : [] });
      this.floats[k]!.rider = kid;
    }
    this.crowdSpecs = specs;
  }

  // ───────────────────────────────────────────── runtime

  private placeFloats(t: number): void {
    const crowd = this.crowd;
    const tan = new THREE.Vector3();
    for (const f of this.floats) {
      const u = (((f.s + t * 0.0055) % 1) + 1) % 1;
      const p = this.curve.getPointAt(u);
      this.curve.getTangentAt(u, tan);
      const yaw = Math.atan2(-tan.z, tan.x);
      const y = this.H(p.x, p.z);
      // Gentle rock over the cobbles.
      f.group.position.set(p.x, y + Math.abs(Math.sin(t * 3 + f.s * 20)) * 0.02, p.z);
      f.group.rotation.set(Math.sin(t * 2.3 + f.s * 9) * 0.012, yaw, Math.sin(t * 1.7 + f.s * 7) * 0.01);
      f.group.updateMatrixWorld(true);
      if (crowd && f.rider !== undefined && f.riderLocal) {
        const w = f.riderLocal.clone().applyMatrix4(f.group.matrixWorld);
        const m = crowd.members[f.rider]!;
        m.x = w.x;
        m.z = w.z;
        m.y = w.y;
        m.yaw = yaw + f.riderYawOff;
      }
    }
  }

  protected override tick(dt: number, game: Game): void {
    const t = game.time;
    // Parade clock restarts with the showcase so demo frames catch the floats mid-lane.
    this.placeFloats(this.showT);
    const crowd = this.crowd;
    if (!crowd) return;
    // The plait grows down the pole as the dancers weave (the Ribbon Dance: as you hit the beats).
    const play = this.play?.id === 'dance' ? this.play : null;
    const goal = play ? 0.35 + (play.progress[0] ?? 0) * (PLAIT_MAX - 0.35) : 0.55 + 1.5 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 110));
    this.plaitLen.value += (goal - this.plaitLen.value) * (1 - Math.exp(-1.5 * dt));
    const wrap = this.plaitLen.value / PLAIT_MAX;
    const R0 = 3.2 - wrap * 0.55;
    const w = 0.3;
    const at = (d: { dir: 1 | -1; a: number }, tt: number): [number, number] => {
      const a = d.a + d.dir * w * tt;
      const r = R0 + d.dir * 0.42 * Math.sin(4 * a);
      return [GREEN.x + Math.cos(a) * r, GREEN.z + Math.sin(a) * r];
    };
    for (const d of this.dancers) {
      const [x, z] = at(d, t);
      const [x2, z2] = at(d, t + 0.05);
      crowd.place(d.i, x, z);
      // Face along the weave, turned a touch in towards the pole (the ribbon hand).
      crowd.members[d.i]!.yaw = Math.atan2(x2 - x, z2 - z) + (d.dir > 0 ? -0.3 : 0.3);
    }
    // Partner hop: a damped spring driven by Bloom! hits (squash-and-stretch).
    const h = this.hop;
    h.v += (-90 * h.x - 9 * h.v) * dt;
    h.x += h.v * dt;
    if (this.partner && play) {
      // The partner mirrors your skip-steps beside you.
      const s = this.danceSpot();
      const b = play.live ? play.beat : play.t * 1.6;
      const sway = Math.sin(b * Math.PI) * 0.1;
      const m = crowd.members[this.partner.i]!;
      crowd.place(this.partner.i, s.qx + sway, s.qz, -0.5 + Math.sin(b * Math.PI * 0.5) * 0.3, Math.max(0, -h.x) * 0.6);
      m.squash = 1 + h.x;
      m.lean *= Math.exp(-4 * dt);
    }
    crowd.commit();
    // Ribbons: pole (just under the plait) → each dancer's raised hand.
    const top = this.poleY + POLE_H - 0.06;
    for (let k = 0; k < this.dancers.length; k++) {
      const d = this.dancers[k]!;
      crowd.ribbonHand(d.i, t, this.hand);
      const m = crowd.members[d.i]!;
      const dx = m.x - GREEN.x;
      const dz = m.z - GREEN.z;
      const dl = Math.hypot(dx, dz) || 1;
      this.anchor.set(GREEN.x + (dx / dl) * PLAIT_R * 0.8, top - this.plaitLen.value + 0.04, GREEN.z + (dz / dl) * PLAIT_R * 0.8);
      this.ribbons.set(k, this.anchor, this.hand, t, 0.1 + 0.05 * Math.sin(t * 1.3 + k), 0.11);
    }
    this.ribbons.commit();
  }

  override stage(): void {
    super.stage();
    this.plaitLen.value = 1.2;
  }

  // ───────────────────────────────────────────── Ribbon Dance mini-game

  private danceSpot(): { px: number; pz: number; qx: number; qz: number } {
    const z = GREEN.z + POLE_R + 2.7;
    return { px: GREEN.x - 0.9, pz: z, qx: GREEN.x + 0.9, qz: z };
  }

  protected override onBeginPlay(play: PlayState): void {
    if (play.id !== 'dance') return;
    const s = this.danceSpot();
    // Side by side facing the crowd (and the camera), turned in towards each other.
    this.placePlayer(s.px, s.pz, 'down');
    const i = play.partner ? this.named.get(play.partner) : undefined;
    const c = this.crowd;
    if (c && i !== undefined) {
      const m = c.members[i]!;
      this.partner = { i, x: m.x, z: m.z, yaw: m.yaw, anim: m.anim };
      c.place(i, s.qx, s.qz, -0.5, 0);
      c.setAnim(i, 'dance');
      c.commit();
    }
    this.plaitLen.value = 0.35;
    this.frame({ pitch: 38, distance: 19.5, yaw: 0, ox: 0.4, oz: -4.4 });
  }

  protected override onPlayEvent(play: PlayState, kind: string, value: number): void {
    if (play.id !== 'dance') return;
    const c = this.crowd;
    const pm = this.partner && c ? c.members[this.partner.i]! : null;
    if (kind === 'restart') {
      this.plaitLen.value = 0.35;
      return;
    }
    const cols = [0xf9c6d6, 0xffffff, 0xf4aec4, 0xfde2a0];
    if (kind === 'perfect' || kind === 'good') {
      const big = kind === 'perfect';
      if (pm) {
        // A petal burst at your partner + a squash-and-stretch hop.
        this.burst(pm.x, pm.y + 1.5, pm.z, { color: cols[value % cols.length]!, count: big ? 26 : 10, speed: big ? 2.8 : 1.8, size: 0.13, gravity: 1.2, life: 1.4, up: 1.6, spread: 0.35 });
        this.hop.v -= big ? 3.2 : 1.6;
      }
      const s = this.danceSpot();
      this.burst(s.px, this.H(s.px, s.pz) + 1.4, s.pz, { color: cols[(value + 1) % cols.length]!, count: big ? 12 : 5, speed: 1.8, size: 0.12, gravity: 1.2, life: 1.2, up: 1.3, spread: 0.3 });
      if (big && value > 0 && value % 8 === 0) {
        // Every 8-combo: a swirl of petals round the whole ring + up the plait.
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          this.burst(GREEN.x + Math.cos(a) * POLE_R, this.poleY + 2.2, GREEN.z + Math.sin(a) * POLE_R, { color: cols[k % cols.length]!, count: 10, speed: 2, size: 0.14, gravity: 0.8, life: 1.8, up: 1.2, spread: 0.6 });
        }
        this.burst(GREEN.x, this.poleY + POLE_H - this.plaitLen.value, GREEN.z, { color: 0xffd166, count: 30, speed: 2.4, size: 0.12, gravity: 1, life: 1.6, up: 0.6, spread: 0.3 });
      }
    } else if (kind === 'miss' && pm) {
      // A stumble: the partner wobbles.
      pm.lean = (value % 2 ? 1 : -1) * 0.22;
      this.hop.v += 1.2;
    }
  }

  protected override onEndPlay(): void {
    const c = this.crowd;
    const p = this.partner;
    if (c && p) {
      c.place(p.i, p.x, p.z, p.yaw);
      const m = c.members[p.i]!;
      m.anim = p.anim;
      m.squash = 1;
      m.lean = 0;
      c.commit();
    }
    this.partner = null;
  }

  protected override playerPose(rig: PlayerRig, play: PlayState): ActionPose | null {
    if (play.id !== 'dance') return null;
    rig.tool.visible = false;
    const live = play.live;
    const b = live ? play.beat : play.t * 1.6;
    const ph = b * Math.PI;
    const s = Math.sin(ph);
    const step = Math.abs(Math.sin(ph));
    // Ribbon-dance: skip-steps on the beat, arms sweeping up and across, a twirl every 4 bars.
    const fr = (((b % 16) + 16) % 16) - 14;
    const twirl = live && fr > 0 ? THREE.MathUtils.smootherstep(fr / 2, 0, 1) * Math.PI * 2 : 0;
    rig.legL.rotation.x = Math.max(0, s) * 0.7;
    rig.legR.rotation.x = Math.max(0, -s) * 0.7;
    rig.armL.rotation.set(-1.6 - 0.9 * Math.max(0, s), 0, 0.35 + 0.25 * step);
    rig.armR.rotation.set(-1.6 - 0.9 * Math.max(0, -s), 0, -0.35 - 0.25 * step);
    rig.torso.rotation.set(0.05, s * 0.28, s * 0.08);
    rig.head.rotation.set(-0.1, -s * 0.2, s * 0.1);
    rig.body.rotation.y += twirl + 0.4 + s * 0.2;
    return { bob: step * 0.16, sy: 1 + (step - 0.5) * 0.08 };
  }
}
