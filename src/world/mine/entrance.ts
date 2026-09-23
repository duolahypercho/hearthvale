/**
 * Hollowdeep mine entrance ('mine-entrance'): a mountain shelf under a tall strata cliff. The
 * timber-framed mine mouth is cut into the cliff (a real recess with a rock lintel, darkness and
 * a warm lamp deep inside), rails run out of it past a loaded ore cart to a buffer stop, a lift
 * headframe with a big pulley wheel stands beside it (the elevator), and a miners' lean-to with
 * a workbench, barrels, crates and a woodpile sits on the west. Pines crown the cliff, boulders
 * and scree pile at its foot, and a dirt path winds south back towards the farm.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import { Rng } from '../../core/rng';
import { Noise2D, smoothstep } from '../../core/noise';
import type { Season, Weather } from '../../core/time';
import type { GameMap, MapWarp } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Terrain } from '../terrain';
import { GrassField } from '../grass';
import { TreeField } from '../props/trees';
import { Nature } from '../props/nature';
import { MeshBuilder, roundedBox, mat, boxUV, mergeStatic } from '../geom';
import { buildLanternPost, buildBarrel, buildCrate, buildWoodpile, type BuiltProp } from '../props/structures';
import { Ambience, SmokeEmitter } from '../../render/particles';
import { facetRock } from './rockgeo';
import { mineRockMaterial, poolMaterial } from './props';
import { buildTool } from '../props/tools';

const W = 44;
const D = 34;
/** Mine mouth centre (x) and cliff foot (z). */
export const MOUTH = { x: 22, z: 10.4, w: 3.2 };
export const ENTRANCE_SPAWN = { x: 22.5, z: 13.2 };
/** Lift headframe (elevator) interact point. */
export const LIFT = { x: 28.6, z: 11.4 };

export class MineEntranceMap implements GameMap {
  readonly id = 'mine-entrance';
  readonly title = 'Hollowdeep Mine';
  readonly grid = new TileGrid(W, D);
  readonly root = new THREE.Group();
  readonly spawn = { x: ENTRANCE_SPAWN.x, z: ENTRANCE_SPAWN.z, facing: 'down' as const };
  readonly cameraBounds = new THREE.Box2(new THREE.Vector2(10, 9), new THREE.Vector2(34, 24));
  readonly terrain: Terrain;
  readonly grass: GrassField;
  readonly warps: MapWarp[] = [{ x0: 17, z0: D - 2, x1: 26, z1: D - 1, to: 'farm', x: 31.5, z: 21.5, facing: 'down' }];
  readonly poi: Record<string, { x: number; y?: number; z: number; rot?: number }[]> = {};
  private trees: TreeField;
  private nature: Nature;
  private noise: Noise2D;
  private rng: Rng;
  private staticRoots: THREE.Object3D[] = [];
  private ambience: Ambience;
  private smoke: SmokeEmitter[] = [];
  private pathPts: { x: number; z: number; w: number }[] = [];
  private innerGlow: THREE.PointLight;

  constructor(private game: Game) {
    this.root.name = 'map:mine-entrance';
    this.rng = game.rng.fork('mine-entrance');
    this.noise = new Noise2D(this.rng.fork('n').seed);
    this.samplePath();
    this.terrain = new Terrain({ minX: -10, minZ: -10, maxX: W + 10, maxZ: D + 10, step: 0.5, height: (x, z) => this.height(x, z), waterLevel: -5 });
    this.root.add(this.terrain.mesh);
    this.terrain.paint('path', (x, z) => this.pathValue(x, z));
    this.terrain.commitSplat();
    this.terrain.paintCover('dry', (x, z) => smoothstep(0.3, 0.7, this.noise.fbm(x * 0.12 + 5, z * 0.12, 2) * 0.5 + 0.5) * 0.6, { x0: -10, z0: -10, x1: W + 10, z1: D + 10 });
    this.terrain.paintCover('moss', (x, z) => smoothstep(0.55, 0.8, this.noise.fbm(x * 0.2, z * 0.2 + 9, 2) * 0.5 + 0.5) * (1 - this.pathValue(x, z)), { x0: -10, z0: -10, x1: W + 10, z1: D + 10 });
    this.classify();
    this.trees = new TreeField(this.rng.fork('trees'));
    this.nature = new Nature(this.rng.fork('nature'));
    this.buildMouth();
    this.buildRails();
    this.buildLift();
    this.buildCamp();
    this.dress();
    this.terrain.commitCover();
    this.trees.finalize();
    this.nature.finalize();
    this.trees.group.userData.perfTag = 'trees';
    this.nature.group.userData.perfTag = 'nature';
    this.root.add(this.trees.group, this.nature.group);
    const merged = mergeStatic(this.staticRoots, 'mine-entrance-static');
    merged.userData.perfTag = 'props';
    this.root.add(merged);
    this.grass = new GrassField({
      bounds: { x0: -6, z0: -6, x1: W + 6, z1: D + 6 },
      density: (x, z) => this.grassDensity(x, z),
      tallness: (x, z) => 0.15 + 0.45 * smoothstep(0.1, 0.6, this.noise.fbm(x * 0.1, z * 0.1, 2)),
      height: (x, z) => this.terrain.heightAt(x, z),
      seed: 'mine-entrance-grass',
      densityScale: game.rc.preset.grassDensity,
      cover: this.terrain,
    });
    this.root.add(this.grass.group);
    this.ambience = new Ambience((x, z) => this.terrain.heightAt(x, z));
    this.root.add(this.ambience.group);
    // Lamp deep in the tunnel (always on: the miners never put it out).
    this.innerGlow = new THREE.PointLight(0xffa048, 6, 6, 1.6);
    this.innerGlow.position.set(MOUTH.x, this.terrain.heightAt(MOUTH.x, MOUTH.z) + 1.6, MOUTH.z - 1.9);
    this.root.add(this.innerGlow);
    this.poi.flowers = [{ x: 14, z: 20 }, { x: 31, z: 21 }];
    this.poi.birds = [{ x: 18, z: 18 }];
  }

  // ───────────────────────────────────────────── shape

  /** z of the cliff foot for a given x (portal section kept straight). */
  private cliffZ(x: number): number {
    const n = this.noise.fbm(x * 0.12 + 2, 0.5, 3) * 1.6;
    const straight = smoothstep(4.5, 2.6, Math.abs(x - MOUTH.x));
    return MOUTH.z - 0.2 + n * (1 - straight) - smoothstep(10, 22, Math.abs(x - MOUTH.x)) * 1.5;
  }

  private height(x: number, z: number): number {
    const n = this.noise;
    const cz = this.cliffZ(x);
    // North cliff: steep strata face up to a pine-topped plateau.
    const cliff = smoothstep(cz + 0.25, cz - 1.25, z) * (7.2 + n.fbm(x * 0.08, z * 0.08 + 4, 3) * 2.2) + smoothstep(cz - 2, cz - 12, z) * 3;
    // Recess for the mine mouth.
    const inMouth = smoothstep(MOUTH.w / 2 + 0.2, MOUTH.w / 2 - 0.1, Math.abs(x - MOUTH.x)) * smoothstep(MOUTH.z - 2.4, MOUTH.z - 2.0, z);
    // Side slopes + scree skirts.
    const sides = smoothstep(9, 1, x) * (3.5 + n.fbm(x * 0.1, z * 0.1, 2) * 2) + smoothstep(W - 9, W - 1, x) * (3.5 + n.fbm(x * 0.1 + 7, z * 0.1, 2) * 2);
    const south = smoothstep(D - 5, D + 4, z) * -1.2 * smoothstep(8, 3, Math.abs(x - 21.5));
    const southRim = smoothstep(D - 4, D + 3, z) * 2.5 * smoothstep(5, 9, Math.abs(x - 21.5));
    const ripple = n.fbm(x * 0.15 + 3, z * 0.15, 2) * 0.28;
    const base = ripple + sides + south + southRim;
    return base + cliff * (1 - inMouth);
  }

  private samplePath(): void {
    const pts: [number, number][] = [
      [MOUTH.x, MOUTH.z - 0.8],
      [MOUTH.x, 13],
      [21, 17],
      [23, 22],
      [21.5, 27],
      [21.5, D + 2],
    ];
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const n = Math.ceil(curve.getLength() / 0.3);
    for (let k = 0; k <= n; k++) {
      const p = curve.getPointAt(k / n);
      this.pathPts.push({ x: p.x, z: p.z, w: 1.05 + (k < 12 ? 0.5 : 0) });
    }
    // Spur to the lean-to and to the lift.
    for (const [a, b] of [
      [[21, 16], [14.5, 14.5]],
      [[23, 13.2], [LIFT.x, LIFT.z + 0.6]],
    ] as [number, number][][]) {
      for (let t = 0; t <= 1; t += 0.05) this.pathPts.push({ x: a![0]! + (b![0]! - a![0]!) * t, z: a![1]! + (b![1]! - a![1]!) * t, w: 0.8 });
    }
  }

  private pathValue(x: number, z: number): number {
    let best = 0;
    for (const s of this.pathPts) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (Math.abs(dx) > 2.4 || Math.abs(dz) > 2.4) continue;
      const v = smoothstep(s.w + 0.6, s.w - 0.3, Math.sqrt(dx * dx + dz * dz) + this.noise.get(x * 0.7, z * 0.7) * 0.25);
      if (v > best) best = v;
    }
    // Trampled apron in front of the mouth.
    const apron = smoothstep(3.6, 2.2, Math.hypot((x - MOUTH.x) * 0.8, z - (MOUTH.z + 1.6)));
    return Math.max(best, apron);
  }

  private classify(): void {
    const g = this.grid;
    g.forEach((x, z, i) => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const h = this.terrain.heightAt(cx, cz);
      g.height[i] = h;
      const steep = this.terrain.slopeAt(cx, cz) < 0.8;
      if (steep || h > 1.6 || x < 1 || x >= W - 1 || z < 1) {
        g.type[i] = TileType.Cliff;
        g.flags[i] = TileFlag.Blocked;
        return;
      }
      g.type[i] = this.terrain.splatAt(cx, cz, 'path') > 0.5 ? TileType.Dirt : TileType.Grass;
    });
    // The mouth itself is not walkable past the threshold (entering is handled by the mining system).
    for (let x = Math.floor(MOUTH.x - 1.5); x <= Math.floor(MOUTH.x + 1.4); x++) for (let z = Math.floor(MOUTH.z - 3); z < Math.floor(MOUTH.z - 0.6); z++) g.setFlag(x, z, TileFlag.Blocked);
  }

  private grassDensity(x: number, z: number): number {
    const t = this.terrain;
    if (t.slopeAt(x, z) < 0.8) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.3) return 0;
    if (z < this.cliffZ(x) + 0.6) return 0;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (this.grid.inBounds(tx, tz) && this.grid.hasFlag(tx, tz, TileFlag.Blocked) && this.grid.getType(tx, tz) !== TileType.Cliff) return 0;
    const clump = smoothstep(-0.2, 0.5, this.noise.fbm(x * 0.14 + 4, z * 0.14, 2));
    return (2 + clump * 4) * (pv > 0.05 ? 0.5 : 1);
  }

  private H(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  private add(g: THREE.Object3D, x: number, z: number, rot = 0, solid: [number, number][] = [], y?: number): void {
    g.position.set(x, y ?? this.H(x, z) - 0.03, z);
    g.rotation.y = rot;
    this.root.add(g);
    this.staticRoots.push(g);
    for (const [tx, tz] of solid) this.grid.setObject(tx, tz, { kind: 'prop', id: g.name, solid: true });
  }

  // ───────────────────────────────────────────── build

  private buildMouth(): void {
    const b = new MeshBuilder();
    const y0 = this.H(MOUTH.x, MOUTH.z);
    const halfW = MOUTH.w / 2;
    const H = 3.0;
    const wood = 0xb88a5a;
    // Heavy timber frame: posts, lintel, knee braces, iron straps + bolts.
    for (const sx of [-1, 1]) {
      b.add('woodGrain', boxUV(roundedBox(0.42, H, 0.42, 0.06), 1.5), mat(sx * (halfW - 0.05), H / 2, 0.05, 0, 0, sx * 0.03), { tint: wood, aoWorld: (p) => 0.5 + 0.5 * smoothstep(0, 0.9, p.y) });
      b.add('woodGrain', roundedBox(0.22, 0.95, 0.24, 0.04), mat(sx * (halfW - 0.45), H - 0.45, 0.12, 0, 0, sx * 0.72), { tint: wood });
      for (const yy of [0.5, H - 0.6]) {
        b.add('metal', roundedBox(0.46, 0.08, 0.46, 0.015), mat(sx * (halfW - 0.05), yy, 0.05), { tint: 0x4a4440 });
        b.add('metal', new THREE.SphereGeometry(0.035, 8, 6), mat(sx * (halfW - 0.05), yy, 0.29), { tint: 0x8a8076 });
      }
      // Stone plinths.
      b.add('stone', boxUV(roundedBox(0.62, 0.35, 0.62, 0.08), 1.2), mat(sx * (halfW - 0.05), 0.12, 0.05), { tint: 0xb0a898 });
    }
    b.add('woodGrain', boxUV(roundedBox(MOUTH.w + 1.1, 0.5, 0.5, 0.07), 1.2), mat(0, H + 0.2, 0.08), { tint: 0xa87a4a });
    b.add('woodGrain', boxUV(roundedBox(MOUTH.w + 0.6, 0.28, 0.36, 0.05), 1.2), mat(0, H + 0.62, -0.05), { tint: 0x9a6c40 });
    for (const x of [-1.2, 0, 1.2]) b.add('metal', new THREE.SphereGeometry(0.045, 8, 6), mat(x, H + 0.2, 0.34), { tint: 0x8a8076 });
    // Tunnel liner: side planks, ceiling boards, dark back.
    const depth = 2.3;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 5; k++) b.add('woodDark', roundedBox(0.08, 0.34, depth, 0.02), mat(sx * (halfW - 0.2), 0.3 + k * 0.52, -depth / 2 - 0.1), { tint: 0x7a5a40, aoWorld: (p) => 0.35 + 0.65 * smoothstep(-depth, 0, p.z) });
    }
    for (let k = 0; k < 4; k++) b.add('woodDark', roundedBox(MOUTH.w - 0.3, 0.18, 0.22, 0.03), mat(0, H - 0.1, -0.4 - k * 0.6), { tint: 0x6a4a30, aoWorld: (p) => 0.3 + 0.7 * smoothstep(-depth, 0, p.z) });
    // Rock lintel mass bridging the recess top into the cliff.
    const r = this.rng.fork('lintel');
    for (let k = 0; k < 7; k++) {
      const g = facetRock(r, 0.62 + r.next() * 0.3, [0x6e6258, 0x5e544a, 0x7a6c5e][k % 3]!, { chunky: true, squash: 0.75, rim: 0.2 });
      b.add(mineRockMaterial(), g, mat(-2.1 + k * 0.7 + (r.next() - 0.5) * 0.3, H + 0.55 + r.next() * 0.35, -1.5 - r.next() * 0.6, r.next(), r.next() * 6, r.next()));
    }
    // Hanging lantern just inside + the sign board.
    const lan = new MeshBuilder();
    lan.add('metal', new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), mat(0, H - 0.25, -0.35));
    lanternKit(lan, 0, H - 0.62, -0.35, 1.25);
    this.add(lan.build({ name: 'mouth-lantern' }), MOUTH.x, MOUTH.z, 0, [], y0);
    this.add(b.build({ name: 'mine-mouth' }), MOUTH.x, MOUTH.z, 0, [], y0);
    // Darkness inside: a gradient card at the back, and a soft dark floor fade.
    const dark = new THREE.Mesh(
      new THREE.PlaneGeometry(MOUTH.w - 0.3, H + 0.3),
      new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; void main(){ vec2 q = vUv - vec2(0.5, 0.35); float g = smoothstep(0.55, 0.0, length(q * vec2(1.4, 1.0))); vec3 c = mix(vec3(0.0), vec3(0.42, 0.2, 0.07), g * 0.55); gl_FragColor = vec4(c, 1.0); }`,
      }),
    );
    dark.position.set(MOUTH.x, y0 + (H + 0.3) / 2, MOUTH.z - depth - 0.05);
    this.root.add(dark);
    const fade = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH.w - 0.2, depth + 0.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false }));
    fade.position.set(MOUTH.x, y0 + 0.03, MOUTH.z - depth / 2 - 0.2);
    fade.renderOrder = 1;
    this.root.add(fade);
    // Sign: "HOLLOWDEEP" on a weathered board hung from the lintel.
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 0.08), [
      ...Array(4).fill(new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9 })),
      new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9 }),
    ]);
    sign.position.set(MOUTH.x, y0 + H + 1.05, MOUTH.z + 0.4);
    sign.rotation.x = -0.12;
    sign.castShadow = true;
    this.root.add(sign);
    // Warm spill of lamplight on the apron.
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3).rotateX(-Math.PI / 2), poolMaterial(0xffa050, 0.18));
    pool.position.set(MOUTH.x, y0 + 0.05, MOUTH.z + 0.4);
    pool.renderOrder = 2;
    this.root.add(pool);
    this.grid.setObject(Math.floor(MOUTH.x - halfW), Math.floor(MOUTH.z), { kind: 'prop', id: 'mouth-post', solid: true });
    this.grid.setObject(Math.floor(MOUTH.x + halfW - 0.1), Math.floor(MOUTH.z), { kind: 'prop', id: 'mouth-post', solid: true });
  }

  private buildRails(): void {
    // Rails out of the mouth, curving east to a buffer stop, with a loaded cart.
    const curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(MOUTH.x, 0, MOUTH.z - 2.2),
        new THREE.Vector3(MOUTH.x, 0, MOUTH.z + 0.8),
        new THREE.Vector3(MOUTH.x + 1.6, 0, MOUTH.z + 2.6),
        new THREE.Vector3(MOUTH.x + 4.2, 0, MOUTH.z + 3.4),
      ],
      false,
      'centripetal',
    );
    const b = new MeshBuilder();
    const len = curve.getLength();
    const n = Math.ceil(len / 0.5);
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const yaw = Math.atan2(t.x, t.z);
      const y = this.H(p.x, p.z);
      b.add('woodDark', roundedBox(0.9, 0.07, 0.17, 0.02), mat(p.x, y + 0.02, p.z, 0, yaw + Math.sin(k * 7.1) * 0.06, 0), { tint: 0x9a7a5a });
    }
    for (const side of [-0.3, 0.3]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= n * 2; k++) {
        const u = k / (n * 2);
        const p = curve.getPointAt(u);
        const t = curve.getTangentAt(u);
        const nrm = new THREE.Vector3(t.z, 0, -t.x).normalize();
        const q = p.clone().addScaledVector(nrm, side);
        q.y = this.H(q.x, q.z) + 0.1;
        pts.push(q);
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 4, 0.032, 5, false);
      b.add('metal', tube, undefined, { tint: 0x8a8480 });
    }
    // Buffer stop.
    const end = curve.getPointAt(1);
    b.add('woodDark', roundedBox(0.9, 0.5, 0.25, 0.05), mat(end.x + 0.3, this.H(end.x, end.z) + 0.3, end.z + 0.1, 0, Math.PI / 2 - 0.3, 0), { tint: 0xc05a3a });
    this.add(b.build({ name: 'rails' }), 0, 0, 0, [], 0);
    // Ore cart.
    const cp = curve.getPointAt(0.62);
    const ct = curve.getTangentAt(0.62);
    const cart = buildCart(this.rng.fork('cart'));
    this.add(cart, cp.x, cp.z, Math.atan2(ct.x, ct.z) + Math.PI / 2, [[Math.floor(cp.x), Math.floor(cp.z)]]);
  }

  private buildLift(): void {
    const b = new MeshBuilder();
    const H = 5.6;
    const wood = 0xa8805a;
    // Tapered 4-post headframe with cross bracing.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.add('woodGrain', boxUV(roundedBox(0.22, H, 0.22, 0.04), 1.4), mat(sx * 0.95, H / 2, sz * 0.8, sz * -0.06, 0, sx * -0.06), { tint: wood, aoWorld: (p) => 0.55 + 0.45 * smoothstep(0, 1, p.y) });
      }
      for (let k = 0; k < 3; k++) {
        const y = 1.2 + k * 1.5;
        b.add('woodGrain', roundedBox(0.12, 2.2, 0.1, 0.02), mat(sx * (0.9 - k * 0.07), y + 0.3, 0, (k % 2 ? 1 : -1) * 0.62, 0, 0), { tint: 0x98704a });
        b.add('woodGrain', roundedBox(1.9 - k * 0.15, 0.12, 0.12, 0.02), mat(0, y, sx * (0.78 - k * 0.07)), { tint: 0x98704a });
      }
    }
    b.add('woodGrain', roundedBox(2.3, 0.22, 2.0, 0.04), mat(0, H, 0), { tint: 0x98704a });
    // Pulley wheel (spoked) + axle + cable into the shaft.
    const wheel = new THREE.TorusGeometry(0.78, 0.07, 8, 28);
    b.add('metal', wheel, mat(0, H + 0.85, 0), { tint: 0x5a5048 });
    for (let k = 0; k < 8; k++) b.add('metal', roundedBox(0.05, 1.5, 0.05, 0.01), mat(0, H + 0.85, 0, 0, 0, (k / 8) * Math.PI), { tint: 0x6a6058 });
    b.add('metal', new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10), mat(0, H + 0.85, 0, Math.PI / 2, 0, 0), { tint: 0x8a8070 });
    for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.16, 1.0, 0.16, 0.03), mat(0, H + 0.45, sz * 0.25), { tint: wood });
    b.add('metal', new THREE.CylinderGeometry(0.018, 0.018, H + 0.4, 5), mat(0.72, (H + 0.8) / 2, 0), { tint: 0x3a3632 });
    // Cage at the bottom (open front), floor plate, gate chain.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('metal', roundedBox(0.07, 2.1, 0.07, 0.015), mat(sx * 0.62, 1.05, sz * 0.55), { tint: 0x6a625a });
    b.add('metal', roundedBox(1.4, 0.08, 1.25, 0.02), mat(0, 2.12, 0), { tint: 0x6a625a });
    b.add('wood', boxUV(roundedBox(1.3, 0.1, 1.15, 0.02), 1), mat(0, 0.1, 0), { tint: 0xc09060 });
    for (let k = -2; k <= 2; k++) b.add('metal', new THREE.CylinderGeometry(0.014, 0.014, 1.9, 5), mat(k * 0.24, 1.05, -0.55), { tint: 0x6a625a });
    // Control lever box with a little brass bell.
    b.add('woodDark', roundedBox(0.4, 0.9, 0.3, 0.04), mat(1.25, 0.45, 0.75), { tint: 0x8a6040 });
    b.add('metal', new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), mat(1.25, 1.1, 0.82, 0.45, 0, 0), { tint: 0xb0a898 });
    b.add('metal', new THREE.SphereGeometry(0.07, 10, 8), mat(1.25, 1.38, 0.95), { tint: 0xc03a2a });
    b.add('metal', new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(-1.1, 2.3, 0.85, Math.PI, 0, 0), { tint: 0xd8a848 });
    const g = b.build({ name: 'lift' });
    const x = LIFT.x;
    const z = LIFT.z - 1.4;
    this.add(g, x, z, 0, [
      [Math.floor(x - 1), Math.floor(z)],
      [Math.floor(x), Math.floor(z)],
      [Math.floor(x + 0.9), Math.floor(z)],
    ]);
    const lp = buildLanternPost();
    this.addLit(lp, x - 1.9, z + 1.2, 0);
  }

  private addLit(bp: BuiltProp, x: number, z: number, rot: number): void {
    this.add(bp.group, x, z, rot, [[Math.floor(x), Math.floor(z)]]);
    bp.group.updateMatrixWorld(true);
    for (const l of bp.lights) {
      l.light.castShadow = false;
      l.light.distance = 7;
      this.game.lighting.addNightLight(l.light, Math.max(l.max, 6) * 1.5);
    }
  }

  private buildCamp(): void {
    const r = this.rng.fork('camp');
    // Lean-to: 3 posts, sloped plank roof, back wall; workbench, tools on the wall.
    const b = new MeshBuilder();
    const wood = 0xb08458;
    for (const sx of [-1, 0, 1]) {
      b.add('woodGrain', boxUV(roundedBox(0.18, 2.3, 0.18, 0.04), 2), mat(sx * 1.4, 1.15, 0.8), { tint: wood });
      b.add('woodGrain', boxUV(roundedBox(0.18, 2.9, 0.18, 0.04), 2), mat(sx * 1.4, 1.45, -0.9), { tint: wood });
    }
    for (let k = 0; k < 9; k++) b.add('roofTile', boxUV(roundedBox(0.36, 0.07, 2.4, 0.02), 1.4), mat(-1.45 + k * 0.36, 2.62, -0.05, -0.28, 0, (r.next() - 0.5) * 0.04), { tint: k % 3 === 0 ? 0x8a5a3a : 0x9a6a44 });
    for (let k = 0; k < 6; k++) b.add('woodGrain', boxUV(roundedBox(3.1, 0.34, 0.08, 0.02), 1.4), mat(0, 0.25 + k * 0.42, -0.95), { tint: k % 2 ? 0xa07a50 : 0x92704a, aoWorld: (p) => 0.65 + 0.35 * smoothstep(0, 1.2, p.y) });
    // Workbench.
    b.add('wood', boxUV(roundedBox(1.6, 0.1, 0.7, 0.03), 1), mat(-0.6, 0.85, -0.45), { tint: 0xc89868 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodDark', roundedBox(0.08, 0.85, 0.08, 0.02), mat(-0.6 + sx * 0.7, 0.42, -0.45 + sz * 0.28), { tint: 0x7a5a3a });
    b.add('metal', roundedBox(0.3, 0.12, 0.16, 0.02), mat(-1.0, 0.96, -0.45), { tint: 0x5a5a5a });
    const g = b.build({ name: 'lean-to' });
    this.add(g, 13.2, 13.6, 0.12, [
      [12, 13],
      [13, 13],
      [14, 13],
      [12, 12],
      [13, 12],
      [14, 12],
    ]);
    // Tools leaning on the lean-to.
    const pick = buildTool('pickaxe', 0);
    pick.name = 'leaning-pick';
    this.add(pick, 15.0, 13.9, 0.2, [], this.H(15, 13.9) + 0.35);
    pick.rotation.set(-0.35, 0.3, 0.12);
    const pick2 = buildTool('pickaxe', 1);
    this.add(pick2, 11.6, 14.1, -0.4, [], this.H(11.6, 14.1) + 0.35);
    pick2.rotation.set(-0.3, -0.5, -0.2);
    this.add(buildBarrel(), 15.9, 15.2, 0.3, [[15, 15]]);
    this.add(buildBarrel(), 16.6, 14.5, 1.1, [[16, 14]]);
    const c1 = buildCrate();
    this.add(c1, 10.9, 15.3, 0.4, [[10, 15]]);
    const c2 = buildCrate();
    this.add(c2, 10.9, 15.3, 1.1, [], this.H(10.9, 15.3) + 0.58);
    this.add(buildWoodpile(r), 9.4, 12.6, 0.1, [
      [8, 12],
      [9, 12],
      [10, 12],
    ]);
    const lp = buildLanternPost();
    this.addLit(lp, 19.1, 11.9, Math.PI);
    const lp2 = buildLanternPost();
    this.addLit(lp2, 25.3, 12.1, 0);
    // Ore pile + spare rails by the cart.
    const ob = new MeshBuilder();
    for (let k = 0; k < 14; k++) {
      const a = r.next() * Math.PI * 2;
      const d = r.next() * 0.7;
      const col = [0xe07a3a, 0x8a7a6a, 0x9a9088, 0xc9ccd4, 0x6a5a4a][k % 5]!;
      ob.add(mineRockMaterial(), facetRock(r, 0.16 + r.next() * 0.12, col, { detail: 0, squash: 0.8 }), mat(Math.cos(a) * d, d < 0.3 ? 0.18 : 0.02, Math.sin(a) * d, 0, r.next() * 6, 0));
    }
    this.add(ob.build({ name: 'ore-pile' }), 27.6, 15.4, 0, [[27, 15]]);
    // A painted signpost at the path.
    const sp = new MeshBuilder();
    sp.add('woodGrain', roundedBox(0.13, 1.6, 0.13, 0.03), mat(0, 0.8, 0), { tint: 0x9a7048 });
    sp.add('woodPaint', roundedBox(0.95, 0.26, 0.06, 0.04), mat(0.3, 1.35, 0.05, 0, 0, 0.06), { tint: 0xe8d0a0 });
    sp.add('woodPaint', roundedBox(0.8, 0.24, 0.06, 0.04), mat(-0.25, 1.02, 0.05, 0, 0, -0.08), { tint: 0xd8b888 });
    this.add(sp.build({ name: 'signpost' }), 19.6, 21.4, 0.3, [[19, 21]]);
  }

  private dress(): void {
    const r = this.rng.fork('dress');
    // Pines on the plateau and slopes; a few maples on the shelf edges.
    for (let z = -8; z < D + 8; z += 2.1) {
      for (let x = -8; x < W + 8; x += 2.1) {
        const jx = x + (r.next() - 0.5) * 1.8;
        const jz = z + (r.next() - 0.5) * 1.8;
        const onPlateau = jz < this.cliffZ(jx) - 1.8;
        const onSides = jx < 5 || jx > W - 5 || jz > D - 2;
        if (!onPlateau && !onSides) continue;
        if (Math.abs(jx - MOUTH.x) < 3.2 && jz > MOUTH.z - 5) continue;
        if (Math.abs(jx - 21.5) < 5 && jz > D - 6) continue;
        if (this.terrain.slopeAt(jx, jz) < 0.7 || r.next() < 0.25) continue;
        const sp = onPlateau || r.next() < 0.75 ? 'pine' : 'maple';
        this.trees.add(sp, jx, this.H(jx, jz) - 0.1, jz, 0.8 + r.next() * 0.5, undefined, onPlateau && jz < this.cliffZ(jx) - 5 ? 1 : 0);
      }
    }
    // Scree + boulders at the cliff foot, stones on the shelf, ferns / bushes at edges.
    for (let x = 1; x < W - 1; x += 0.8) {
      const cz = this.cliffZ(x);
      if (Math.abs(x - MOUTH.x) < 2.6 || (x > LIFT.x - 2 && x < LIFT.x + 1.6)) continue;
      const z = cz + 0.4 + r.next() * 0.9;
      if (r.next() < 0.55) this.nature.place(r.next() < 0.35 ? 'boulder' : 'stone', x, this.H(x, z), z, { scale: 0.7 + r.next() * 0.6 });
      if (r.next() < 0.5) this.nature.place('pebbles', x + 0.3, this.H(x + 0.3, z + 0.6), z + 0.6);
    }
    const g = this.grid;
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        if (!g.isWalkable(x, z) || g.getType(x, z) !== TileType.Grass) continue;
        const cx = x + 0.5 + (r.next() - 0.5) * 0.6;
        const cz = z + 0.5 + (r.next() - 0.5) * 0.6;
        const y = this.H(cx, cz);
        const roll = r.next();
        const edge = x < 7 || x > W - 8 || z > D - 5;
        if (edge && roll < 0.14) this.nature.place(r.next() < 0.5 ? 'bush' : 'fern', cx, y, cz, { scale: 0.8 + r.next() * 0.4 });
        else if (roll < 0.035) this.nature.place('stone', cx, y, cz, { scale: 0.5 + r.next() * 0.4 });
        else if (roll < 0.06) this.nature.place('flower', cx, y, cz, { color: [0xffffff, 0xc77dff, 0xffd166, 0x7ec8ff][Math.floor(r.next() * 4)]! });
        else if (roll < 0.07) this.nature.place('tallGrass', cx, y, cz, { scale: 0.8 + r.next() * 0.4 });
      }
    }
    // Contact AO under the big props.
    this.terrain.stampCover('ao', MOUTH.x, MOUTH.z + 0.4, 2.4, 0.8);
    this.terrain.stampCover('ao', LIFT.x, LIFT.z - 1.4, 1.8, 0.7);
    this.terrain.stampCover('ao', 13.2, 13.4, 2.2, 0.6);
    // Chimney-less camp: a thin smoke curl from the tunnel mouth (warm air meeting the evening).
    const s = new SmokeEmitter(new THREE.Vector3(MOUTH.x, this.H(MOUTH.x, MOUTH.z) + 3.2, MOUTH.z + 0.2), 1.2, 24);
    this.smoke.push(s);
    this.root.add(s.object);
  }

  // ───────────────────────────────────────────── runtime

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  clearGroundCover(x: number, z: number): void {
    this.grass.clearTile(x, z);
  }

  update(dt: number, game: Game): void {
    this.grass.update(game.rc.rig.focus);
    const h = game.rc.renderer.domElement.height;
    for (const s of this.smoke) s.update(dt, game.lighting.night, h);
    this.ambience.update(dt, game.time, game.rc.rig.focus, game.lighting.night, h);
    this.innerGlow.intensity = 5 + Math.sin(game.time * 9) * 0.4 + Math.sin(game.time * 23) * 0.3;
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

function lanternKit(b: MeshBuilder, x: number, y: number, z: number, s = 1): void {
  b.add('metal', roundedBox(0.2 * s, 0.05 * s, 0.2 * s, 0.015), mat(x, y + 0.14 * s, z));
  b.add('metal', new THREE.ConeGeometry(0.15 * s, 0.1 * s, 4), mat(x, y + 0.21 * s, z, 0, Math.PI / 4, 0));
  b.add('lampGlow', roundedBox(0.13 * s, 0.2 * s, 0.13 * s, 0.02), mat(x, y + 0.02 * s, z));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.add('metal', new THREE.BoxGeometry(0.02 * s, 0.24 * s, 0.02 * s), mat(x + dx * 0.075 * s, y + 0.02 * s, z + dz * 0.075 * s));
  b.add('metal', roundedBox(0.18 * s, 0.035 * s, 0.18 * s, 0.01), mat(x, y - 0.1 * s, z));
}

export function buildCart(r: Rng): THREE.Group {
  const cb = new MeshBuilder();
  const top = new THREE.CylinderGeometry(0.72, 0.52, 0.62, 4, 1, true);
  top.rotateY(Math.PI / 4);
  top.scale(1.25, 1, 0.85);
  cb.add('metal', top, mat(0, 0.62, 0), { tint: 0x6e5a4a });
  cb.add('metal', roundedBox(0.95, 0.06, 0.62, 0.02), mat(0, 0.32, 0), { tint: 0x4a403a });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12);
      w.rotateX(Math.PI / 2);
      cb.add('metal', w, mat(sx * 0.32, 0.16, sz * 0.32), { tint: 0x3a3430 });
    }
  }
  for (const y of [0.45, 0.8]) cb.add('metal', roundedBox(1.28, 0.05, 0.92, 0.02), mat(0, y, 0, 0, 0, 0, y > 0.6 ? 1.02 : 0.85, 1, y > 0.6 ? 1.0 : 0.85), { tint: 0x9a8a72 });
  for (let k = 0; k < 11; k++) {
    const ore = [0xe07a3a, 0x8a7a6a, 0xc9ccd4, 0x6a5a4a, 0xffc83a][k % 5]!;
    cb.add(mineRockMaterial(), facetRock(r, 0.15 + r.next() * 0.08, ore, { detail: 0, squash: 0.8 }), mat((r.next() - 0.5) * 0.75, 0.8 + r.next() * 0.15, (r.next() - 0.5) * 0.5));
  }
  return cb.build({ name: 'ore-cart' });
}

function signTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 136;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 136);
  grad.addColorStop(0, '#8a5e3a');
  grad.addColorStop(1, '#6a4428');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 136);
  // Plank seams + grain.
  g.strokeStyle = 'rgba(40,20,8,0.5)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 68);
  g.lineTo(512, 68);
  g.stroke();
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(30,15,5,${0.08 + Math.random() * 0.1})`;
    g.lineWidth = 1;
    g.beginPath();
    const y = Math.random() * 136;
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + Math.random() * 6 - 3, 340, y + Math.random() * 6 - 3, 512, y);
    g.stroke();
  }
  g.font = '700 70px Fredoka, Nunito, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#3a200e';
  g.strokeText('HOLLOWDEEP', 256, 72);
  g.fillStyle = '#f4dca8';
  g.fillText('HOLLOWDEEP', 256, 72);
  for (const x of [22, 490]) {
    g.fillStyle = '#3a3430';
    g.beginPath();
    g.arc(x, 68, 8, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
