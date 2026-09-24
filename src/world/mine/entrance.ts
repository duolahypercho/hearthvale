/**
 * Hollowdeep mine entrance ('mine-entrance'): a mountain shelf under a tall strata cliff. The
 * timber-framed mine mouth is cut into the cliff (a real recess with a rock lintel, darkness and
 * a warm lamp deep inside), rails run out of it past a loaded ore cart to a buffer stop, a lift
 * headframe with a big pulley wheel stands beside it (the elevator), and a miners' lean-to with
 * a workbench, barrels, crates and a woodpile sits on the west. Pines crown the cliff, boulders
 * and scree pile at its foot, and a dirt path winds south back towards the farm.
 */
import * as THREE from 'three';
import { glowPoint } from './fx';
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
import { CAVE_GLSL } from './cave';
import { buildTool } from '../props/tools';
import { patchMaterial, after, before } from '../../render/patch';
import { NOISE_GLSL } from '../../render/shaders/noise';
import { globalUniforms } from '../../render/uniforms';

const W = 44;
const D = 34;
/** One projection of the cliff rock texture: x = albedo multiplier, y = bump height, z = grit. */
const CLIFF_TEX = /* glsl */ `
vec3 hvCliffTex(vec2 tp) {
  vec2 wq = tp * vec2(0.3, 0.72);
  wq += (vec2(hvFbm(tp * 0.3 + 3.0), hvFbm(tp * 0.3 + 9.0)) - 0.5) * 1.3;
  vec4 st = hvMineStone(wq);
  float edge = st.y - st.x;
  vec4 st2 = hvMineStone(wq * 2.7 + 4.1);
  float edge2 = st2.y - st2.x;
  // Only some slab borders open into joints (a cliff, not a dry-stone wall). Anti-aliased: a joint
  // thinning below ~2 px widens + fades into the cavity shading instead of breaking into dashes.
  float open = smoothstep(0.42, 0.66, hvNoise(floor(wq) * 0.41 + st.z * 5.0 + tp * 0.18));
  float aa = fwidth(edge) * 2.0;
  // Joints only where they are several pixels wide: thinner ones fade out entirely (at the
  // gameplay zoom they rasterised as dotted hairlines tracing every slab border).
  float crack = (1.0 - smoothstep(0.02, 0.09 + aa, edge)) * open * smoothstep(0.05, 0.015, aa);
  float cavity = (1.0 - smoothstep(0.0, 0.3, edge)) * (0.35 + 0.65 * open);
  float aa2 = fwidth(edge2) * 2.0;
  float craze = (1.0 - smoothstep(0.0, 0.035 + aa2, edge2)) * smoothstep(0.5, 0.75, hvNoise(tp * 0.8)) * (1.0 - cavity) * smoothstep(0.02, 0.006, aa2);
  float grit = hvNoise(tp * 5.0) * 0.55 + hvNoise(tp * 16.0) * 0.45;
  float h = smoothstep(0.0, 0.45, edge) * 0.12 * (0.4 + 0.6 * open) + (st.z - 0.5) * 0.05 + hvNoise(tp * 5.0) * 0.02 - craze * 0.012;
  float lit = mix(1.1, 0.86, smoothstep(-0.5, 0.5, st.w));
  float tone = (0.86 + 0.26 * st.z) * lit * (1.0 - crack * 0.62) * (1.0 - cavity * 0.18) * (1.0 - craze * 0.2) * (0.86 + 0.28 * grit);
  return vec3(tone, h, grit);
}
`;

/** Mine mouth centre (x) and cliff foot (z). */
export const MOUTH = { x: 22, z: 10.4, w: 3.2 };
export const ENTRANCE_SPAWN = { x: 22.5, z: 13.2 };
/** Lift headframe (elevator) interact point. */
export const LIFT = { x: 28.6, z: 11.4 };
/** Depth of the timbered tunnel behind the portal (m). */
const TUNNEL = 3.8;

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
  /** Lantern practicals on this shelf light up early (16:30): the miners work late. */
  private lamps: { light: THREE.PointLight; max: number; glow: THREE.Mesh }[] = [];
  private coldAir: THREE.Points | null = null;
  /** World height of the rock over the portal (the cliff sheet is cut below it). */
  private portalTop = 3.6;

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
    this.buildCliffFace();
    this.buildRails();
    this.buildLift();
    this.buildCamp();
    this.buildYard();
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
    this.innerGlow = new THREE.PointLight(0xffa048, 0.7, 4.2, 1.6);
    this.innerGlow.position.set(MOUTH.x, this.terrain.heightAt(MOUTH.x, MOUTH.z) + 2.3, MOUTH.z - 0.6);
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

  private height(x: number, z: number, mouth = true): number {
    const n = this.noise;
    const cz = this.cliffZ(x);
    // North cliff: steep strata face up to a pine-topped plateau.
    const cliff = smoothstep(cz + 0.25, cz - 1.25, z) * (7.2 + n.fbm(x * 0.08, z * 0.08 + 4, 3) * 2.2) + smoothstep(cz - 2, cz - 12, z) * 3;
    // Recess for the mine mouth.
    const inMouth = mouth ? smoothstep(MOUTH.w / 2 + 0.2, MOUTH.w / 2 - 0.1, Math.abs(x - MOUTH.x)) * smoothstep(MOUTH.z - TUNNEL - 0.5, MOUTH.z - TUNNEL - 0.1, z) : 0;
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
    // Tunnel: a 3.8 m timbered drift. Timber sets (two posts + cap) every metre, lagging boards
    // between them, a rock roof, all baked darker with depth (exponential), then fog cards so the
    // drift falls off to black instead of reading as a flat dark rectangle.
    const depth = TUNNEL;
    const fogK = (z: number): number => Math.exp(-Math.max(0, -z - 0.4) * 0.55);
    for (let d = 0.9; d < depth; d += 1.0) {
      for (const sx of [-1, 1]) {
        b.add('woodGrain', boxUV(roundedBox(0.2, H - 0.1, 0.2, 0.04), 1.5), mat(sx * (halfW - 0.28), (H - 0.1) / 2, -d, 0, 0, sx * 0.04), { tint: 0xa07448, aoWorld: (p) => fogK(p.z) * (0.55 + 0.45 * smoothstep(0, 0.9, p.y)) });
      }
      b.add('woodGrain', boxUV(roundedBox(MOUTH.w - 0.2, 0.22, 0.24, 0.04), 1.5), mat(0, H - 0.2, -d), { tint: 0x9a6c40, aoWorld: (p) => fogK(p.z) });
    }
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 5; k++) b.add('woodDark', roundedBox(0.07, 0.4, depth, 0.02), mat(sx * (halfW - 0.4), 0.3 + k * 0.52, -depth / 2 - 0.1), { tint: 0x7a5a40, aoWorld: (p) => 0.25 + 0.75 * fogK(p.z) });
    }
    for (let k = 0; k < 7; k++) b.add('woodDark', roundedBox(MOUTH.w - 0.4, 0.07, 0.42, 0.02), mat(0, H - 0.04, -0.4 - k * 0.52), { tint: 0x6a4a30, aoWorld: (p) => fogK(p.z) });
    // Rock roof over the drift (the camera looks down into the slot).
    b.add(mineRockMaterial(), boxUV(roundedBox(MOUTH.w + 1.3, 0.9, depth, 0.25), 1), mat(0, H + 0.62, -depth / 2 - 0.35), { tint: 0x5e5244 });
    // Mossy ledges stepping up the cliff over the portal (not a pile of loose boulders).
    this.portalTop = y0 + H + 0.45;
    const r = this.rng.fork('lintel');
    /** z (local, from the portal plane) of the uncut rock face at height y over portal column x. */
    const faceAt = (lx: number, y: number): number => {
      for (let dz = 0.6; dz > -4; dz -= 0.05) if (this.height(MOUTH.x + lx, MOUTH.z + dz, false) - y0 >= y) return dz;
      return -1.5;
    };
    const ledges: [number, number, number, number][] = [
      [-0.7, H + 1.0, 2.3, 0.0],
      [1.0, H + 1.75, 1.9, 0.25],
      [-0.9, H + 2.6, 2.1, -0.2],
    ];
    for (const [lx, ly, w, yaw] of ledges) {
      const lz = faceAt(lx, ly) - 0.15;
      const g = facetRock(r, 0.62, [0xa08c70, 0x94806a, 0xac9676][Math.floor(r.next() * 3)]!, { chunky: true, squash: 0.62, cap: 0x5f7f38, capAmt: 0.45, rim: 0.45, detail: 2, smooth: 0.3 });
      g.scale(w / 1.24, 0.95, 1.3);
      b.add(mineRockMaterial(), g, mat(lx, ly, lz, (r.next() - 0.5) * 0.08, yaw, (r.next() - 0.5) * 0.08));
    }
    // Hanging lantern just inside (its own dimmer glass so it never blooms to white) + sign board.
    const lan = new MeshBuilder();
    lan.add('metal', new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), mat(0, H - 0.25, -0.55));
    lanternKit(lan, 0, H - 0.62, -0.55, 1.15, mouthGlass());
    // A second, dimmer lamp ~3 m down the drift: the tunnel has depth (warm light far inside).
    lan.add('metal', new THREE.CylinderGeometry(0.01, 0.01, 0.35, 4), mat(0.35, H - 0.3, -2.9));
    lanternKit(lan, 0.35, H - 0.68, -2.9, 0.9, mouthGlass());
    this.add(lan.build({ name: 'mouth-lantern' }), MOUTH.x, MOUTH.z, 0, [], y0);
    const deepGlow = glowPoint(0xffa050, 1.6, 0.35);
    deepGlow.position.set(MOUTH.x + 0.35, y0 + H - 0.75, MOUTH.z - 2.85);
    this.root.add(deepGlow);
    const deepPool = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4).rotateX(-Math.PI / 2), poolMaterial(0xffa050, 0.22));
    deepPool.position.set(MOUTH.x + 0.2, y0 + 0.05, MOUTH.z - 2.6);
    deepPool.renderOrder = 3;
    this.root.add(deepPool);
    this.add(b.build({ name: 'mine-mouth' }), MOUTH.x, MOUTH.z, 0, [], y0);
    // Darkness at the end of the drift, and a floor fade that deepens with depth.
    const dark = new THREE.Mesh(
      new THREE.PlaneGeometry(MOUTH.w - 0.3, H + 0.3),
      new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; void main(){ gl_FragColor = vec4(vec3(0.004, 0.003, 0.004), 1.0); }`,
      }),
    );
    dark.position.set(MOUTH.x, y0 + (H + 0.3) / 2, MOUTH.z - depth - 0.05);
    this.root.add(dark);
    const fade = new THREE.Mesh(
      new THREE.PlaneGeometry(MOUTH.w - 0.2, depth + 0.4).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        // uv.y = 1 at the portal, 0 at the far end: black soaks in exponentially.
        fragmentShader: `varying vec2 vUv; void main(){ float a = 1.0 - exp(-(1.0 - vUv.y) * 3.2) * 0.75; gl_FragColor = vec4(vec3(0.0), a); }`,
      }),
    );
    fade.position.set(MOUTH.x, y0 + 0.03, MOUTH.z - depth / 2 - 0.2);
    fade.renderOrder = 1;
    this.root.add(fade);
    // Exponential fog: a stack of thin black cards through the drift; each swallows a bit more.
    const fogMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; void main(){ float side = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x); float top = 0.85 + 0.15 * smoothstep(0.2, 0.9, vUv.y); gl_FragColor = vec4(vec3(0.0), 0.3 * mix(0.7, 1.0, side) * top); }`,
    });
    for (let d = 1.35; d < depth; d += 0.6) {
      const veil = new THREE.Mesh(new THREE.PlaneGeometry(MOUTH.w - 0.3, H + 0.1), fogMat);
      veil.position.set(MOUTH.x, y0 + (H + 0.1) / 2, MOUTH.z - d);
      veil.renderOrder = 2;
      veil.userData.noAO = true;
      this.root.add(veil);
    }
    // Cold air: faint pale motes drifting out of the dark and sinking over the apron.
    {
      const N = 42;
      const seed = new Float32Array(N * 3);
      const r = this.rng.fork('cold');
      for (let i = 0; i < N; i++) seed.set([r.next(), r.next(), r.next()], i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3(MOUTH.x, y0, MOUTH.z - 1.4) } },
        vertexShader: /* glsl */ `
          attribute vec3 aSeed; uniform float uTime; uniform vec3 uOrigin; varying float vA;
          void main(){
            float t = fract(uTime * (0.07 + aSeed.z * 0.05) + aSeed.x);
            vec3 p = uOrigin + vec3((aSeed.y - 0.5) * 2.4 + sin(uTime * 0.7 + aSeed.x * 20.0) * 0.25 * t, 0.3 + aSeed.z * 2.2 - t * t * 1.4, t * 3.6);
            vA = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.55, 1.0, t)) * 0.5;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (40.0 + aSeed.z * 60.0) / -mv.z;
          }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.0) * vA; gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * a, a); }`,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 3;
      pts.userData.noAO = true;
      this.coldAir = pts;
      this.root.add(pts);
    }
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

  /**
   * The strata cliff: a displaced sheet laid over the terrain's steep band (which otherwise shows
   * the shared crackle rock texture). Bedded layers of differing hardness jut out as ledges or
   * recede, vertical joints split them into blocks, ledge tops catch moss, and triplanar grit +
   * macro noise break up the albedo, so the wall has real relief under the low evening sun.
   */
  private buildCliffFace(): void {
    const x0 = -8;
    const x1 = W + 8;
    const dx = 0.25;
    const cols = Math.round((x1 - x0) / dx) + 1;
    const rows = 62;
    const n = this.noise;
    const pos = new Float32Array(cols * rows * 3);
    const col = new Float32Array(cols * rows * 3);
    const PAL = [0xa89272, 0x8e7a62, 0xb49e7e, 0x7c6a58, 0x9c886c, 0x86725c, 0xa0907a].map((h) => new THREE.Color(h));
    const moss = new THREE.Color(0x6a8a40);
    const c = new THREE.Color();
    const hash = (a: number): number => {
      const v = Math.sin(a * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const bandH = 0.66;
    for (let i = 0; i < cols; i++) {
      const x = x0 + i * dx;
      const cz = this.cliffZ(x);
      for (let j = 0; j < rows; j++) {
        const t = j / (rows - 1);
        // Deep enough to climb the recess back wall over the portal (the lintel rock above it).
        const z = cz + 0.45 - t * 3.1;
        // The sheet follows the cliff as if uncut: over the portal it becomes the rock face the
        // drift is driven into (no open notch up the cliff).
        const y = this.height(x, z, false);
        const e = 0.05;
        const gx = (this.height(x + e, z, false) - this.height(x - e, z, false)) / (2 * e);
        const gz = (this.height(x, z + e, false) - this.height(x, z - e, false)) / (2 * e);
        const nrm = new THREE.Vector3(-gx, 1, -gz).normalize();
        const steep = smoothstep(0.8, 2.6, Math.hypot(gx, gz));
        const v = (y + n.fbm(x * 0.09 + 3, 1.5, 2) * 1.4) / bandH;
        const band = Math.floor(v);
        const f = v - band;
        const hard = hash(band * 1.7 + 0.3);
        // Vertical joints: a few per band, at hashed x positions.
        const jw = 1.4 + hash(band * 3.1) * 2.2;
        const ju = (x + hash(band * 5.3) * 9) / jw;
        const jf = ju - Math.floor(ju);
        // (joints / ledge shadows span several vertex rows: one-row-wide dark lines rendered as dashes)
        const joint = 1 - smoothstep(0.0, 0.32, Math.min(jf, 1 - jf) * jw);
        const block = hash(Math.floor(ju) * 0.71 + band * 13.3);
        // Ledge lips ramp over ~3 vertex rows (a one-row step rendered as a dashed dark stitch).
        const prof = smoothstep(0.0, 0.2, f) * (1 - smoothstep(0.82, 1.0, f)) * (0.75 + 0.25 * f);
        let disp = 0.03 + steep * (0.05 + (0.08 + hard * 0.26) * prof + (block - 0.5) * 0.06 - joint * 0.12 + n.fbm(x * 0.35, y * 0.35 + 7, 2) * 0.12);
        disp = Math.max(0.05, disp);
        const k = (i * rows + j) * 3;
        pos[k] = x + nrm.x * disp;
        pos[k + 1] = y + nrm.y * disp + 0.015;
        pos[k + 2] = z + nrm.z * disp;
        // Albedo: per-band tone, lighter band tops, dark under-ledge shadow + joints, moss on ledges.
        c.copy(PAL[((band % PAL.length) + PAL.length) % PAL.length]!).multiplyScalar(0.86 + block * 0.22);
        c.multiplyScalar((0.55 + 0.45 * smoothstep(0.0, 0.34, f)) * (1 - joint * 0.35) * (0.88 + 0.24 * smoothstep(0.6, 1.0, f)));
        const foot = smoothstep(1.4, 0.0, y - this.height(x, cz + 0.8, false));
        c.multiplyScalar(1 - foot * 0.3);
        const ledgeTop = smoothstep(0.86, 0.98, f) * steep * (0.4 + 0.6 * smoothstep(0.1, 0.5, n.fbm(x * 0.4, y * 0.4, 2) + 0.2));
        const topLip = (1 - steep) * smoothstep(3, 6, y);
        c.lerp(moss, Math.min(1, ledgeTop * 0.75 + topLip * 0.7));
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < cols - 1; i++) {
      const xm = x0 + (i + 0.5) * dx;
      const mouthCol = Math.abs(xm - MOUTH.x) < MOUTH.w / 2 + 0.12;
      for (let j = 0; j < rows - 1; j++) {
        const a = i * rows + j;
        const b = a + rows;
        // Leave the portal itself open (recess floor + back card), keep the rock above it.
        if (mouthCol && (pos[a * 3 + 1]! < this.portalTop || pos[b * 3 + 1]! < this.portalTop)) continue;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    m.name = 'entrance-cliff';
    // The sheet lies a few cm over the terrain's own steep band: bias it forward so the two never
    // z-fight into dashed stitches along the ledges at distance.
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -4;
    patchMaterial(m, 'entrance-cliff-r3', (shader) => {
      let vs = before(shader.vertexShader, 'void main() {', 'varying vec3 vCfW; varying vec3 vCfN;');
      vs = after(vs, '#include <project_vertex>', 'vCfW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCfN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.vertexShader = vs;
      let fs = before(shader.fragmentShader, 'void main() {', `varying vec3 vCfW; varying vec3 vCfN;\n${NOISE_GLSL}\n${CAVE_GLSL}\n${CLIFF_TEX}`);
      fs = after(
        fs,
        '#include <color_fragment>',
        /* glsl */ `
          // Rock texture at 2–3 m tiling: warped Voronoi slabs (wider than tall = bedding), open
          // joints, crazing, grit; bump-mapped below. Sampled on all three planes and BLENDED by the
          // normal (a hard plane switch left dashed seams along every ledge lip).
          vec3 cn = normalize(vCfN);
          vec3 w3 = pow(abs(cn), vec3(4.0));
          w3 /= max(w3.x + w3.y + w3.z, 1e-4);
          // (all three evaluated unconditionally: fwidth / dFdx inside a per-pixel branch are
          // undefined at the branch border and printed dashed seams)
          vec3 ra = hvCliffTex(vCfW.zy);
          vec3 rb = hvCliffTex(vCfW.xz);
          vec3 rc = hvCliffTex(vCfW.xy);
          vec3 rr = ra * w3.x + rb * w3.y + rc * w3.z;
          diffuseColor.rgb *= rr.x;
          float cfH = rr.y;
          float grit = rr.z;
          // Mineral streaks weeping down the face.
          float streak = smoothstep(0.62, 0.82, hvNoise(vec2(vCfW.x * 2.2, vCfW.y * 0.25 + 3.0)));
          diffuseColor.rgb *= 1.0 - streak * 0.12;
          // Moss on the up-facing ledges and slab tops.
          float up = smoothstep(0.35, 0.75, normalize(vCfN).y);
          float mossN = smoothstep(0.35, 0.6, hvFbm(vCfW.xz * 0.9 + 2.0) + grit * 0.25);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.3, 0.1) * (0.8 + 0.4 * grit), up * mossN * 0.85);
        `,
      );
      fs = after(
        fs,
        '#include <normal_fragment_maps>',
        /* glsl */ `
        {
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          float dhx = dFdx(cfH);
          float dhy = dFdy(cfH);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          // Fade the bump out on grazing / back-leaning facets (ledge undersides): there the
          // derivatives blow up and flipped normals printed dashed black lines along every lip.
          float graze = smoothstep(0.08, 0.35, abs(dot(normal, normalize(vViewPosition))));
          if (abs(det) > 1e-8) {
            // Limit the tilt: where the height field aliases, unclamped derivative bumps flipped
            // normals into dashed black stitches along every ledge.
            vec3 nb = normalize(abs(det) * normal - grad * 1.6);
            vec3 dn = nb - normal;
            float L = length(dn);
            if (L > 0.45) nb = normalize(normal + dn * (0.45 / L));
            normal = normalize(mix(normal, nb, graze));
          }
        }`,
      );
      shader.fragmentShader = fs;
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'strata-cliff';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.perfTag = 'terrain';
    this.root.add(mesh);
  }

  /**
   * The east yard (it was bare grass): the miners' notice board, a spur of track with a second ore
   * cart glinting with fresh ore, and a stack of open ore crates.
   */
  private buildYard(): void {
    const r = this.rng.fork('yard');
    // Notice board.
    {
      const b = new MeshBuilder();
      for (const sx of [-0.75, 0.75]) b.add('woodGrain', boxUV(roundedBox(0.14, 2.1, 0.14, 0.03), 2), mat(sx, 1.05, 0), { tint: 0x9a7048, aoWorld: (p) => 0.55 + 0.45 * smoothstep(0, 0.6, p.y) });
      b.add('woodGrain', boxUV(roundedBox(1.7, 1.0, 0.08, 0.03), 1.4), mat(0, 1.38, 0.02), { tint: 0xb08a5c });
      b.add('woodDark', roundedBox(1.95, 0.08, 0.42, 0.02), mat(0, 2.02, 0.04, 0.22, 0, 0), { tint: 0x7a5234 });
      b.add('woodDark', roundedBox(1.95, 0.08, 0.42, 0.02), mat(0, 2.02, -0.2, -0.22, 0, 0), { tint: 0x6a4a30 });
      const notes: [number, number, number, number, number][] = [
        [-0.45, 1.55, 0.36, 0.44, 0xf4ead0],
        [0.05, 1.5, 0.4, 0.3, 0xe8d8b0],
        [0.5, 1.58, 0.3, 0.36, 0xf8f0dc],
        [-0.2, 1.12, 0.46, 0.3, 0xefe2c0],
        [0.42, 1.14, 0.34, 0.32, 0xe4c890],
      ];
      for (const [x, y, w, h, tint] of notes) {
        b.add('white', new THREE.BoxGeometry(w, h, 0.012), mat(x, y, 0.075, 0, 0, (r.next() - 0.5) * 0.12), { tint });
        b.add('metal', new THREE.SphereGeometry(0.018, 6, 4), mat(x, y + h / 2 - 0.04, 0.085), { tint: 0xc03a2a });
      }
      this.add(b.build({ name: 'notice-board' }), 30.2, 16.1, -0.12, [[30, 16]]);
    }
    // Rail spur + second cart with ore glints.
    {
      const b = new MeshBuilder();
      const z = 17.4;
      for (let x = 25.9; x <= 31.0; x += 0.5) b.add('woodDark', roundedBox(0.17, 0.07, 0.9, 0.02), mat(x, this.H(x, z) + 0.02, z, 0, Math.sin(x * 7.1) * 0.06, 0), { tint: 0x9a7a5a });
      for (const sz of [-0.3, 0.3]) b.add('metal', new THREE.CylinderGeometry(0.032, 0.032, 5.3, 5).rotateZ(Math.PI / 2), mat(28.45, this.H(28.45, z + sz) + 0.1, z + sz), { tint: 0x8a8480 });
      b.add('woodDark', roundedBox(0.25, 0.5, 0.9, 0.05), mat(31.3, this.H(31.3, z) + 0.3, z), { tint: 0xc05a3a });
      this.add(b.build({ name: 'yard-rails' }), 0, 0, 0, [], 0);
      const cart = buildCart(r.fork('cart2'));
      this.add(cart, 28.6, z, 0, [[28, 17]]);
      this.addGlints([new THREE.Vector3(28.4, this.H(28.6, z) + 1.0, z - 0.1), new THREE.Vector3(28.85, this.H(28.6, z) + 0.95, z + 0.15), new THREE.Vector3(28.2, this.H(28.6, z) + 0.93, z + 0.2)]);
    }
    // Open ore crates.
    {
      const spots: [number, number, number][] = [
        [31.7, 15.3, 0.2],
        [32.5, 16.1, -0.35],
      ];
      const glints: THREE.Vector3[] = [];
      spots.forEach(([x, z, rot], i) => {
        const b = new MeshBuilder();
        const w = 0.9;
        for (const [px, pz, ry] of [
          [0, -w / 2, 0],
          [0, w / 2, 0],
          [-w / 2, 0, Math.PI / 2],
          [w / 2, 0, Math.PI / 2],
        ] as const)
          for (let k = 0; k < 3; k++) b.add('woodGrain', boxUV(roundedBox(w + 0.06, 0.17, 0.05, 0.015), 1.3), mat(px, 0.1 + k * 0.19, pz, 0, ry, 0), { tint: k % 2 ? 0xb08858 : 0xa07a4c });
        b.add('wood', roundedBox(w, 0.04, w, 0.01), mat(0, 0.04, 0), { tint: 0x8a6a44 });
        const ores = i === 0 ? [0xd0743a, 0x58c0a0, 0xd0743a, 0x9a8a7a] : [0x8c9cb4, 0xffc22a, 0x8c9cb4, 0x6a5a4a];
        for (let k = 0; k < 12; k++) {
          const g = facetRock(r, 0.11 + r.next() * 0.07, ores[k % ores.length]!, { detail: 1, squash: 0.8, smooth: 0.5 });
          b.add(mineRockMaterial(), g, mat((r.next() - 0.5) * 0.62, 0.5 + r.next() * 0.1, (r.next() - 0.5) * 0.62, 0, r.next() * 6, 0));
        }
        this.add(b.build({ name: 'ore-crate' }), x, z, rot, [[Math.floor(x), Math.floor(z)]]);
        glints.push(new THREE.Vector3(x + 0.15, this.H(x, z) + 0.72, z), new THREE.Vector3(x - 0.2, this.H(x, z) + 0.7, z + 0.2));
      });
      this.addGlints(glints);
      const lan = new MeshBuilder();
      lanternKit(lan, 0, 0.72, 0, 1.0);
      this.add(lan.build({ name: 'crate-lantern' }), 32.5, 16.1, 0, [], this.H(32.5, 16.1) + 0.02);
      const lamp = new THREE.PointLight(0xffb060, 0, 5, 1.8);
      lamp.position.set(32.5, this.H(32.5, 16.1) + 0.9, 16.1);
      this.root.add(lamp);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      halo.position.copy(lamp.position).setY(lamp.position.y - 0.16);
      halo.scale.set(0.6, 0.9, 0.6);
      halo.userData.dynamic = true;
      this.root.add(halo);
      this.lamps.push({ light: lamp, max: 6, glow: halo });
    }
  }

  private glintPts: THREE.Vector3[] = [];

  /** Twinkling star glints on fresh ore (one Points draw for the whole shelf, built lazily). */
  private addGlints(pts: THREE.Vector3[]): void {
    this.glintPts.push(...pts);
    if (this.glints) {
      this.glints.removeFromParent();
      this.glints.geometry.dispose();
    }
    const g = new THREE.BufferGeometry().setFromPoints(this.glintPts);
    const ph = new Float32Array(this.glintPts.length).map((_, i) => (i * 0.618) % 1);
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    this.glintMat ??= new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime },
      vertexShader: `attribute float aPh; uniform float uTime; varying float vA; void main(){ float t = fract(uTime * 0.55 + aPh); vA = pow(max(0.0, sin(t * 3.14159)), 8.0); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 140.0 * (0.4 + vA) / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ vec2 q = abs(gl_PointCoord - 0.5) * 2.0; float star = max(1.0 - smoothstep(0.0, 0.12, q.x) - q.y * 0.0, 0.0) * (1.0 - q.y) + max(1.0 - smoothstep(0.0, 0.12, q.y), 0.0) * (1.0 - q.x); float core = pow(max(0.0, 1.0 - length(q)), 3.0); float a = clamp(star * 0.8 + core, 0.0, 1.0) * vA; gl_FragColor = vec4(vec3(1.0, 0.96, 0.8) * a, a); }`,
    });
    this.glints = new THREE.Points(g, this.glintMat);
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 6;
    this.glints.userData.noAO = true;
    this.root.add(this.glints);
  }

  private glints: THREE.Points | null = null;
  private glintMat: THREE.ShaderMaterial | null = null;

  private buildRails(): void {
    // Rails out of the mouth, curving east to a buffer stop, with a loaded cart.
    const curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(MOUTH.x, 0, MOUTH.z - TUNNEL + 0.3),
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
      l.light.distance = 7.5;
      l.light.intensity = 0;
      // Our own schedule (16:30 on), plus a warm halo on the glass so the lamp itself reads lit.
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      halo.position.copy(l.light.position);
      halo.scale.set(0.62, 0.9, 0.62);
      halo.userData.noAO = true;
      halo.userData.dynamic = true;
      halo.visible = false;
      bp.group.add(halo);
      this.lamps.push({ light: l.light, max: Math.max(l.max, 6) * 1.6, glow: halo });
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
    // (No smoke curl off the lintel any more: it smeared the sign and the rock over the portal.)
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
    this.innerGlow.intensity = 1.5 + Math.sin(game.time * 9) * 0.12 + Math.sin(game.time * 23) * 0.08;
    // Shelf lanterns: on from 16:30 until dawn (a warm glow + a real light pool on the apron).
    const hr = game.calendar.hour;
    const on = hr >= 12 ? THREE.MathUtils.smoothstep(hr, 16.3, 16.9) : 1 - THREE.MathUtils.smoothstep(hr, 6.2, 6.8);
    const fl = 0.94 + Math.sin(game.time * 8.3) * 0.04 + Math.sin(game.time * 19.1) * 0.02;
    for (const l of this.lamps) {
      l.light.intensity = l.max * on * fl;
      (l.glow.material as THREE.MeshBasicMaterial).opacity = on;
      l.glow.visible = on > 0.01;
    }
    if (this.coldAir) (this.coldAir.material as THREE.ShaderMaterial).uniforms.uTime!.value = game.time;
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

let glassMat: THREE.MeshStandardMaterial | null = null;
/** Warm lantern glass at ~60 % of the shared lamp glow (the portal lantern must not bloom white). */
function mouthGlass(): THREE.MeshStandardMaterial {
  glassMat ??= new THREE.MeshStandardMaterial({ color: 0xffc27a, emissive: 0xffa24a, emissiveIntensity: 1.35, roughness: 0.4 });
  glassMat.name = 'mouth-lantern-glass';
  return glassMat;
}

function lanternKit(b: MeshBuilder, x: number, y: number, z: number, s = 1, glass?: THREE.Material): void {
  b.add('metal', roundedBox(0.2 * s, 0.05 * s, 0.2 * s, 0.015), mat(x, y + 0.14 * s, z));
  b.add('metal', new THREE.ConeGeometry(0.15 * s, 0.1 * s, 4), mat(x, y + 0.21 * s, z, 0, Math.PI / 4, 0));
  b.add(glass ?? 'lampGlow', roundedBox(0.13 * s, 0.2 * s, 0.13 * s, 0.02), mat(x, y + 0.02 * s, z));
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
