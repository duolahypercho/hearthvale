/**
 * InteriorMap: a cut-away "dollhouse" room seen from the usual high 3/4 camera.
 *
 *   back wall (z = 0) and side walls full height, a knee-high front wall with the door gap,
 *   a thick floor slab whose cut edge shows at the front, a dark wood cap on every cut wall top.
 *
 * Light: the room owns a stylised profile (`light`) that InteriorLighting (lighting.ts) swaps in for
 * the outdoor day/night rig while the room is the current map. Daylight is the real shadow-casting
 * sun, aimed through the windows: an invisible ceiling + front wall cast shadows so the floor only
 * lights up in window-shaped patches, and additive shaft volumes + drifting dust motes sell the
 * beams. Practical lights (hearth, lamps) are point lights with a constant count per room.
 *
 * Coordinates: room spans x ∈ [0, W], z ∈ [0, D], floor at y = 0; tile row z = D is the doorway
 * (warp back outside). Subclasses (house.ts, coop.ts, barn.ts) furnish the room.
 */
import * as THREE from 'three';
import type { Game } from '../../core/game';
import type { Facing } from '../../core/events';
import type { GameMap, MapWarp } from '../map';
import { TileGrid, TileType, TileFlag } from '../tiles';
import { Kit, imat, interiorEmissive, floorPlane, type IMat } from './kit';
import { shaftGradient, windowView, glowDisc, roomAO } from './textures';
import { textures } from '../../render/textures';
import { mergeStatic } from '../geom';

export interface WindowSpec {
  wall: 'back' | 'left' | 'right';
  /** Centre along the wall (x for back, z for side walls). */
  at: number;
  w: number;
  y0: number;
  y1: number;
  curtains?: number | null;
}

export interface RoomSpec {
  id: string;
  title: string;
  W: number;
  D: number;
  H: number;
  /** Door tile x (front wall). */
  doorX: number;
  exit: { to: string; x: number; z: number; facing: Facing };
  floor: IMat;
  style: 'house' | 'barn';
  windows: WindowSpec[];
  /** Direction the daylight travels FROM (towards the sun), room space. */
  sunDir: [number, number, number];
  /** Wall tint (barn boards / wallpaper). */
  wallTint?: number;
  /** Wall material override (default wallpaper for houses, barn boards otherwise). */
  wallMat?: IMat;
  /** Barn-style timber (posts, girts, sill) tint scale: 1 = dark oak, >1 lighter. */
  timberLight?: number;
  /** Floor tint (e.g. darker packed straw so fresh hay piles read). */
  floorTint?: number;
  wainscotTint?: number;
}

/** Everything the lighting hook needs this frame. */
export interface RoomLight {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  envI: number;
  exposure: number;
  bg: THREE.Color;
  lift: [number, number, number];
  gain: [number, number, number];
  sat: number;
  contrast: number;
  vignette: number;
  bloom: number;
  /** 0 = daylight .. 1 = night (lamps / fire lit). */
  night: number;
  /** Daylight strength 0..1 (shafts, window glow). */
  day: number;
}

interface Lamp {
  light: THREE.PointLight;
  day: number;
  night: number;
  flicker: number;
  seed: number;
}

const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _f = new THREE.Vector3();

export abstract class InteriorMap implements GameMap {
  readonly id: string;
  readonly title: string;
  readonly grid: TileGrid;
  readonly root = new THREE.Group();
  readonly spawn: { x: number; z: number; facing: Facing };
  readonly cameraBounds: THREE.Box2;
  readonly warps: MapWarp[];
  readonly interior = true;
  /** Camera framing used while inside. */
  camera = { yaw: 0, pitch: 50, distance: 16.5, offsetX: 0, offsetZ: -0.35 };
  readonly light: RoomLight = {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunI: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiI: 0,
    envI: 0.2,
    exposure: 1,
    bg: new THREE.Color(0x120c08),
    lift: [0.02, 0.015, 0.01],
    gain: [1.05, 1, 0.94],
    sat: 1.08,
    contrast: 1.06,
    vignette: 0.5,
    bloom: 0.4,
    night: 0,
    day: 1,
  };
  readonly center: THREE.Vector3;
  protected lamps: Lamp[] = [];
  protected statics: THREE.Object3D[] = [];
  protected updaters: ((dt: number, t: number, L: RoomLight) => void)[] = [];
  private shafts: THREE.Mesh[] = [];
  private shaftMat: THREE.ShaderMaterial;
  private viewMat: THREE.MeshBasicMaterial;
  private dust: THREE.Points;
  private dustSeeds: Float32Array;
  private dustBeams: { win: THREE.Vector3[]; floor: THREE.Vector3[] }[] = [];
  /** Room-specific daylight multiplier (barns are dim, the house is bright). */
  protected dayScale = 1;
  protected finalized = false;

  constructor(protected game: Game, readonly spec: RoomSpec) {
    this.id = spec.id;
    this.title = spec.title;
    this.root.name = `map:${spec.id}`;
    const { W, D } = spec;
    this.grid = new TileGrid(W, D + 1);
    this.grid.forEach((x, z) => {
      this.grid.setType(x, z, TileType.Floor);
      if (z === D && x !== spec.doorX) this.grid.setFlag(x, z, TileFlag.Blocked);
    });
    this.spawn = { x: spec.doorX + 0.5, z: D - 0.45, facing: 'up' };
    this.center = new THREE.Vector3(W / 2, 0, D / 2);
    this.cameraBounds = new THREE.Box2(new THREE.Vector2(W / 2 - 0.9, D / 2 - 0.5), new THREE.Vector2(W / 2 + 0.9, D / 2 + 0.6));
    this.warps = [{ x0: spec.doorX, z0: D, x1: spec.doorX, z1: D, to: spec.exit.to, x: spec.exit.x, z: spec.exit.z, facing: spec.exit.facing }];
    this.light.sunDir.set(...spec.sunDir).normalize();

    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: shaftGradient().map }, uColor: { value: new THREE.Color() }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor; uniform float uTime;
        varying vec2 vUv; varying vec3 vW;
        void main() {
          float a = texture2D(uMap, vUv).r;
          float n = 0.8 + 0.2 * sin(vW.x * 3.1 + vW.y * 2.3 + uTime * 0.6) * sin(vW.z * 2.7 - uTime * 0.4);
          gl_FragColor = vec4(uColor * a * n, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.viewMat = new THREE.MeshBasicMaterial({ map: windowView().map, color: 0xffffff, toneMapped: true, fog: false });

    // Dust motes (filled in finalize once shafts exist).
    const N = 180;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.dustSeeds = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) this.dustSeeds[i] = Math.random();
    this.dust = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.035, map: textures.softDot().map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0d0, opacity: 0.8, fog: false }),
    );
    this.dust.frustumCulled = false;
    this.dust.userData.noAO = true;
    this.dust.name = 'dust';

    this.buildShell();
  }

  // ─────────────────────────────────────────── shell

  private buildShell(): void {
    const { W, D, H, style } = this.spec;
    const k = new Kit();
    const T = 0.22;
    // Floor + slab (its cut edge shows under the knee wall at the front).
    k.add(this.spec.floor, floorPlane(W, D + 0.02, this.spec.floor === 'straw' ? 0.5 : 1), new THREE.Matrix4().makeTranslation(W / 2, 0, D / 2), { tint: this.spec.floorTint ?? 0xffffff });
    k.box('stone', [W + 2 * T + 0.1, 0.5, D + 2 * T + 0.1], [W / 2, -0.52, D / 2], { tint: 0x8a7a6a, uv: 1.2 });
    k.box('wood', [W + 2 * T + 0.14, 0.08, 0.1], [W / 2, -0.06, D + T + 0.04], { tint: 0x5a3a24 });

    const wallMat: IMat = this.spec.wallMat ?? (style === 'house' ? 'wallpaper' : 'barn');
    const wallTint = this.spec.wallTint ?? (style === 'house' ? 0xffffff : 0xd8c8b0);
    // Back wall + side walls with window holes.
    const holes = (wall: WindowSpec['wall']) => this.spec.windows.filter((w) => w.wall === wall);
    this.wall(k, wallMat, wallTint, 'back', W + 2 * T, H, T, holes('back'));
    this.wall(k, wallMat, wallTint, 'left', D + 2 * T, H, T, holes('left'));
    this.wall(k, wallMat, wallTint, 'right', D + 2 * T, H, T, holes('right'));
    // Cut caps on wall tops (dark top plate reads as the dollhouse section line).
    const cap = 0x3a2618;
    k.box('wood', [W + 2 * T + 0.04, 0.1, T + 0.04], [W / 2, H, -T / 2], { tint: cap });
    k.box('wood', [T + 0.04, 0.1, D + 2 * T + 0.04], [-T / 2, H, D / 2], { tint: cap });
    k.box('wood', [T + 0.04, 0.1, D + 2 * T + 0.04], [W + T / 2, H, D / 2], { tint: cap });

    // Knee wall at the front with the door gap.
    const kneeH = 0.42;
    const gap0 = this.spec.doorX - 0.1;
    const gap1 = this.spec.doorX + 1.1;
    const frontTint = style === 'house' ? 0xe8dcc4 : 0xb89a78;
    const frontMat: IMat = style === 'house' ? 'bead' : 'barn';
    for (const [a, b] of [[-T, gap0], [gap1, W + T]] as const) {
      const w = b - a;
      k.box(frontMat, [w, kneeH, T], [(a + b) / 2, 0, D + T / 2], { tint: frontTint, uv: 1 });
      k.box('wood', [w + 0.02, 0.07, T + 0.06], [(a + b) / 2, kneeH, D + T / 2], { tint: cap });
    }
    // Threshold + mat
    k.box('wood', [gap1 - gap0, 0.04, T + 0.1], [(gap0 + gap1) / 2, 0, D + T / 2], { tint: 0x7a5236 });
    this.statics.push(k.build('shell'));

    // Contact AO card: the floor darkens softly into every wall and corner (multiplied over the floor).
    const ao = new THREE.Mesh(
      floorPlane(W, D + 0.3),
      new THREE.MeshBasicMaterial({
        map: roomAO().map,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor,
        blendEquation: THREE.AddEquation,
      }),
    );
    ao.position.set(W / 2, 0.003, (D + 0.3) / 2 - 0.05);
    ao.renderOrder = 1;
    ao.userData.noAO = true;
    ao.userData.dynamic = true;
    ao.name = 'room-ao';
    this.root.add(ao);

    // Invisible shadow casters: ceiling + upper front wall (daylight only enters via windows).
    const caster = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 0.3, D + 4), caster);
    ceil.position.set(W / 2, H + 0.25, D / 2);
    const front = new THREE.Mesh(new THREE.BoxGeometry(W + 4, H, 0.3), caster);
    front.position.set(W / 2, kneeH + H / 2, D + T + 0.3);
    for (const m of [ceil, front]) {
      m.castShadow = true;
      m.receiveShadow = false;
      m.userData.noAO = true;
      m.userData.dynamic = true;
      m.name = 'shadow-caster';
      this.root.add(m);
    }
  }

  /** A wall with window holes, lining (wallpaper / wainscot / trim), timber posts and window dressing. */
  private wall(k: Kit, m: IMat, tint: number, side: WindowSpec['wall'], len: number, H: number, T: number, holes: WindowSpec[]): void {
    const { W, D, style } = this.spec;
    // Local wall frame: u along the wall, y up, inner face towards the room.
    // back: u = x (from -T), inner normal +z, placed at z = -T/2
    // left: u = z (from -T), inner normal +x, at x = -T/2 ; right: at x = W + T/2, inner normal -x
    const toWorld = (u: number, y: number, n: number): [number, number, number] => {
      if (side === 'back') return [u, y, -T / 2 + n];
      if (side === 'left') return [-T / 2 + n, y, u];
      return [W + T / 2 - n, y, u];
    };
    const start = -T;
    const end = start + len;
    const spans: [number, number][] = [];
    let cur = start;
    const sorted = [...holes].sort((a, b) => a.at - b.at);
    for (const h of sorted) {
      spans.push([cur, h.at - h.w / 2]);
      cur = h.at + h.w / 2;
    }
    spans.push([cur, end]);
    const piece = (mm: IMat, u0: number, u1: number, y0: number, y1: number, thick: number, n: number, tt: number, uv = 1.25) => {
      if (u1 - u0 < 1e-3 || y1 - y0 < 1e-3) return;
      const [x, y, z] = toWorld((u0 + u1) / 2, y0, n);
      const size: [number, number, number] = side === 'back' ? [u1 - u0, y1 - y0, thick] : [thick, y1 - y0, u1 - u0];
      k.box(mm, size, [x, y, z], { tint: tt, uv, r: 0.005 });
    };
    // Structural wall
    for (const [a, b] of spans) piece(m, a, b, 0, H, T, 0, tint);
    for (const h of sorted) {
      piece(m, h.at - h.w / 2, h.at + h.w / 2, 0, h.y0, T, 0, tint);
      piece(m, h.at - h.w / 2, h.at + h.w / 2, h.y1, H, T, 0, tint);
    }
    const inner = T / 2 + 0.015;
    if (style === 'house') {
      // Beadboard wainscot + chair rail + baseboard, crown moulding.
      const wain = this.spec.wainscotTint ?? 0xa9bfa2;
      const a = start + T;
      const b = end - T;
      // Wainscot / rail / baseboard stop at window sills that dip below the rail.
      piece('bead', a, b, 0, 1.0, 0.03, inner, wain, 1);
      piece('paint', a, b, 0.98, 1.06, 0.07, inner + 0.02, 0xf2e8d2);
      piece('paint', a, b, 0, 0.14, 0.05, inner + 0.01, 0x6a4a34);
      piece('paint', a, b, H - 0.12, H, 0.08, inner + 0.02, 0xf2e8d2);
      // Timber posts
      const posts = side === 'back' ? [3.9, W - 3.9] : [];
      for (const p of posts) piece('wood', p - 0.1, p + 0.1, 0, H, 0.08, inner + 0.03, 0x6a4630, 1);
    } else {
      // Barn: heavy horizontal girts + vertical posts, dark sill.
      const tl = this.spec.timberLight ?? 1;
      const tt = (c: number) => _c.setHex(c).multiplyScalar(tl).getHex();
      piece('wood', start + T, end, 0, 0.2, 0.06, inner, tt(0x5a3e2a), 1);
      piece('wood', start + T, end, 1.3, 1.46, 0.1, inner + 0.03, tt(0x6a4a30), 1);
      piece('wood', start + T, end, H - 0.3, H - 0.1, 0.12, inner + 0.03, tt(0x5a3e2a), 1);
      const n = Math.max(2, Math.round(len / 3));
      for (let i = 0; i <= n; i++) {
        const p = start + T + ((len - T * 2) * i) / n;
        piece('wood', p - 0.12, p + 0.12, 0, H, 0.12, inner + 0.05, tt(0x5e4230), 1);
      }
    }
    // Windows: casing, sill, muntins, the painted view behind, curtains.
    for (const h of sorted) {
      const u0 = h.at - h.w / 2;
      const u1 = h.at + h.w / 2;
      const trim = style === 'house' ? 0xf4ecda : 0x7a5a3e;
      const tm: IMat = style === 'house' ? 'paint' : 'wood';
      piece(tm, u0 - 0.1, u0, h.y0 - 0.06, h.y1 + 0.1, 0.06, inner + 0.03, trim);
      piece(tm, u1, u1 + 0.1, h.y0 - 0.06, h.y1 + 0.1, 0.06, inner + 0.03, trim);
      piece(tm, u0 - 0.1, u1 + 0.1, h.y1, h.y1 + 0.12, 0.07, inner + 0.03, trim);
      piece(tm, u0 - 0.16, u1 + 0.16, h.y0 - 0.07, h.y0, 0.16, inner + 0.06, trim);
      // Muntins (cross) in the middle of the wall thickness
      piece(tm, (u0 + u1) / 2 - 0.025, (u0 + u1) / 2 + 0.025, h.y0, h.y1, 0.04, 0, trim);
      piece(tm, u0, u1, (h.y0 + h.y1) / 2 - 0.025, (h.y0 + h.y1) / 2 + 0.025, 0.04, 0, trim);
      // View card just outside
      const view = new THREE.Mesh(new THREE.PlaneGeometry(h.w + 0.3, h.y1 - h.y0 + 0.3), this.viewMat);
      const [vx, vy, vz] = toWorld((u0 + u1) / 2, (h.y0 + h.y1) / 2, -T / 2 - 0.25);
      view.position.set(vx, vy, vz);
      view.rotation.y = side === 'back' ? 0 : side === 'left' ? Math.PI / 2 : -Math.PI / 2;
      view.userData.noAO = true;
      view.userData.dynamic = true;
      this.root.add(view);
      // Curtains: two gathered panels + rod
      if (h.curtains != null) {
        const ct = h.curtains;
        for (const s of [-1, 1]) {
          const cu = s < 0 ? u0 - 0.12 : u1 + 0.12;
          for (let f = 0; f < 3; f++) {
            const [x, y, z] = toWorld(cu + s * f * 0.07 - s * 0.07, h.y0 - 0.25, inner + 0.12 + (f % 2) * 0.03);
            const g = new THREE.CylinderGeometry(0.06, 0.09, h.y1 - h.y0 + 0.45, 8, 1);
            k.add('fabric', g, new THREE.Matrix4().makeTranslation(x, y + (h.y1 - h.y0 + 0.45) / 2, z), { tint: _c.set(ct).multiplyScalar(f === 1 ? 0.88 : 1).getHex() });
          }
          const [tx, ty, tz] = toWorld(cu, h.y0 + (h.y1 - h.y0) * 0.45, inner + 0.16);
          k.add('fabric', new THREE.TorusGeometry(0.1, 0.02, 5, 10), new THREE.Matrix4().makeTranslation(tx, ty, tz), { tint: 0xd8b060 });
        }
        const [rx, ry, rz] = toWorld((u0 + u1) / 2, h.y1 + 0.22, inner + 0.14);
        const rod = new THREE.CylinderGeometry(0.02, 0.02, h.w + 0.6, 6);
        rod.rotateZ(Math.PI / 2);
        if (side !== 'back') rod.rotateY(Math.PI / 2);
        k.add('brass', rod, new THREE.Matrix4().makeTranslation(rx, ry, rz));
      }
    }
    void D;
  }

  // ─────────────────────────────────────────── helpers for subclasses

  /** Block every tile whose centre lies inside the world rect. */
  protected solid(x0: number, z0: number, x1: number, z1: number, id = 'furniture'): void {
    for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
        const cx = x + 0.5;
        const cz = z + 0.5;
        if (cx < x0 - 0.2 || cx > x1 + 0.2 || cz < z0 - 0.2 || cz > z1 + 0.2) continue;
        this.grid.setObject(x, z, { kind: 'prop', id, solid: true });
      }
    }
  }

  protected addLamp(pos: THREE.Vector3, color: number, day: number, night: number, flicker = 0, distance = 7): THREE.PointLight {
    const l = new THREE.PointLight(color, 0, distance, 2);
    l.position.copy(pos);
    l.castShadow = false;
    this.root.add(l);
    this.lamps.push({ light: l, day, night, flicker, seed: Math.random() * 100 });
    return l;
  }

  /** Soft additive glow pool on the floor (under lamps / in front of the hearth). */
  protected glowPool(x: number, z: number, r: number, color: number, strength: () => number, y = 0.012): void {
    const m = new THREE.MeshBasicMaterial({ map: glowDisc().map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const mesh = new THREE.Mesh(floorPlane(r * 2, r * 2), m);
    mesh.position.set(x, y, z);
    mesh.userData.noAO = true;
    mesh.userData.dynamic = true;
    mesh.renderOrder = 2;
    this.root.add(mesh);
    const c0 = new THREE.Color(color);
    this.updaters.push(() => m.color.copy(c0).multiplyScalar(strength()));
  }

  /** Call once after furnishing: merges statics, builds light shafts + dust for the windows. */
  protected finalize(): void {
    const merged = mergeStatic(this.statics, `${this.id}-static`);
    merged.userData.perfTag = `${this.id}-room`;
    this.root.add(merged);
    this.buildShafts();
    this.root.add(this.dust);
    this.finalized = true;
  }

  private buildShafts(): void {
    const { W, D } = this.spec;
    const L = this.light.sunDir.clone().negate(); // travel direction
    const T = 0.22;
    for (const h of this.spec.windows) {
      const u0 = h.at - h.w / 2 + 0.04;
      const u1 = h.at + h.w / 2 - 0.04;
      const corners: THREE.Vector3[] = [];
      for (const [u, y] of [[u0, h.y0], [u1, h.y0], [u1, h.y1], [u0, h.y1]] as const) {
        if (h.wall === 'back') corners.push(new THREE.Vector3(u, y, 0));
        else if (h.wall === 'left') corners.push(new THREE.Vector3(0, y, u));
        else corners.push(new THREE.Vector3(W, y, u));
      }
      // Only windows the light actually enters through get a shaft.
      const inward = h.wall === 'back' ? new THREE.Vector3(0, 0, 1) : h.wall === 'left' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
      if (L.dot(inward) < 0.15 || L.y > -0.1) continue;
      const floor = corners.map((c) => c.clone().addScaledVector(L, c.y / -L.y));
      // Clip the far end at the room bounds (shafts shouldn't poke out of the front)
      for (const f of floor) {
        f.x = THREE.MathUtils.clamp(f.x, 0.05, W - 0.05);
        f.z = THREE.MathUtils.clamp(f.z, 0.05, D + T);
      }
      const pos: number[] = [];
      const uv: number[] = [];
      // 4 side faces of the prism window-quad → floor-quad (v: 1 at window, 0 at floor).
      for (let i = 0; i < 4; i++) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
        const fa = floor[i]!;
        const fb = floor[(i + 1) % 4]!;
        const quad = [a, b, fb, a, fb, fa];
        const quv = [[0, 1], [1, 1], [1, 0], [0, 1], [1, 0], [0, 0]];
        quad.forEach((p, j) => {
          pos.push(p.x, p.y, p.z);
          uv.push(quv[j]![0]!, quv[j]![1]!);
        });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(g, this.shaftMat);
      mesh.renderOrder = 5;
      mesh.userData.noAO = true;
      mesh.userData.dynamic = true;
      mesh.name = 'light-shaft';
      this.root.add(mesh);
      this.shafts.push(mesh);
      this.dustBeams.push({ win: corners, floor });
    }
  }

  // ─────────────────────────────────────────── lighting profile

  /** Compute this frame's room light from the calendar (called every frame). */
  protected computeLight(): void {
    const cal = this.game.calendar;
    const h = cal.hour;
    const w = cal.weather;
    const overcast = w === 'rain' ? 0.85 : w === 'storm' ? 1 : w === 'snow' ? 0.5 : 0;
    const S = THREE.MathUtils.smoothstep;
    // Daylight 0..1: dawn 5.8 → 7.6, dusk 18.2 → 20.2.
    const day = h < 12 ? S(h, 5.8, 7.6) : 1 - S(h, 18.2, 20.2);
    const night = 1 - day;
    const warm = h < 12 ? 1 - S(h, 7, 10.5) : S(h, 15.5, 19);
    const L = this.light;
    L.day = day * (1 - overcast * 0.85);
    L.night = night;
    // Sun through the windows: golden morning / evening, cream midday, cool moonlight at night.
    const sunDay = _c.setHex(0xfff1dc).lerp(new THREE.Color(0xffb46a), warm * 0.85);
    L.sunColor.copy(sunDay).lerp(new THREE.Color(0x8aa6ff), night);
    L.sunI = (day * 5.2 * (1 - overcast * 0.85) + night * 0.9) * this.dayScale;
    // Ambient: warm wood bounce by day, dim dusky blue-brown at night.
    L.hemiSky.setHex(0xf2dcc0).lerp(new THREE.Color(0x8a9ac8), overcast * 0.4).lerp(new THREE.Color(0x3a3a5a), night);
    L.hemiGround.setHex(0x8a5a36).lerp(new THREE.Color(0x2a1a14), night);
    L.hemiI = (0.55 + day * 0.55) * (1 - overcast * 0.2) * (0.7 + 0.3 * this.dayScale);
    L.envI = 0.12 + day * 0.14;
    L.exposure = 1.0 + night * 0.18 + overcast * 0.1;
    L.bg.setHex(0x1c140e).lerp(new THREE.Color(0x0a0a12), night);
    L.lift = [0.025 + night * 0.01, 0.018, 0.012 + night * 0.03];
    L.gain = [1.06 + warm * 0.04, 1.0, 0.93 - warm * 0.03 + night * 0.06];
    L.sat = 1.1 - night * 0.05;
    L.contrast = 1.06 + night * 0.04;
    L.vignette = 0.52 + night * 0.12;
    L.bloom = 0.35 + night * 0.25;
  }

  // ─────────────────────────────────────────── GameMap

  heightAt(): number {
    return 0;
  }

  update(dt: number, game: Game): void {
    this.computeLight();
    const L = this.light;
    const t = game.time;
    const lampK = Math.max(L.night, 1 - L.day * 1.05);
    for (const l of this.lamps) {
      const base = THREE.MathUtils.lerp(l.day, l.night, THREE.MathUtils.clamp(lampK, 0, 1));
      const f = l.flicker ? 1 + l.flicker * (Math.sin(t * 13 + l.seed) * 0.35 + Math.sin(t * 7.3 + l.seed * 2) * 0.4 + Math.sin(t * 23.1 + l.seed) * 0.25) : 1;
      l.light.intensity = base * f;
    }
    for (const e of interiorEmissive) e.material.emissiveIntensity = THREE.MathUtils.lerp(e.day, e.night, THREE.MathUtils.clamp(lampK, 0, 1));
    // Shafts: warm by day, faint blue by moonlight.
    const shaft = this.shaftMat.uniforms;
    (shaft.uColor!.value as THREE.Color).copy(L.sunColor).multiplyScalar(0.11 * L.day * this.dayScale + 0.025 * L.night);
    shaft.uTime!.value = t;
    // Window views: bright painted day, deep blue at night.
    this.viewMat.color.setRGB(1, 1, 1).multiplyScalar(0.25 + 1.05 * L.day).lerp(new THREE.Color(0.05, 0.07, 0.16), L.night * 0.95);
    this.updateDust(dt, t, L);
    for (const u of this.updaters) u(dt, t, L);
  }

  private updateDust(dt: number, t: number, L: RoomLight): void {
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const nb = this.dustBeams.length;
    const mat = this.dust.material as THREE.PointsMaterial;
    mat.opacity = 0.15 + 0.75 * L.day;
    mat.color.copy(L.sunColor);
    this.dust.visible = nb > 0;
    if (!nb) return;
    const s = this.dustSeeds;
    const bil = (q: THREE.Vector3[], u: number, w: number, out: THREE.Vector3) =>
      out.copy(q[0]!).lerp(q[1]!, u).lerp(_b.copy(q[3]!).lerp(q[2]!, u), w);
    for (let i = 0; i < pos.count; i++) {
      const beam = this.dustBeams[i % nb]!;
      const ph = s[i * 4 + 3]! * 100;
      const u = 0.1 + 0.8 * (s[i * 4]! + Math.sin(t * 0.13 + ph) * 0.06);
      const w = 0.1 + 0.8 * (s[i * 4 + 1]! + Math.cos(t * 0.11 + ph) * 0.06);
      // Motes drift slowly down the beam and wrap.
      const k = (s[i * 4 + 2]! + t * 0.008 * (0.6 + s[i * 4]!)) % 1;
      bil(beam.win, u, w, _a);
      bil(beam.floor, u, w, _f);
      _a.lerp(_f, 0.05 + k * 0.85);
      pos.setXYZ(i, _a.x, _a.y + Math.sin(t * 0.7 + ph) * 0.03, _a.z);
    }
    pos.needsUpdate = true;
    void dt;
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** Convenience: material handle (for subclasses creating custom meshes). */
export { imat };
