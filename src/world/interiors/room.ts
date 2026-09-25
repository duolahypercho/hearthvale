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
import { shaftGradient, windowView, windowViewNight, glowDisc, roomAO } from './textures';
import { textures } from '../../render/textures';
import { mergeStatic } from '../geom';
import { atmosphere } from '../../render/heightfog';

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
  camera = { yaw: 0, pitch: 50, distance: 17.2, offsetX: 0, offsetZ: -0.35 };
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
  private viewMat: THREE.ShaderMaterial;
  private dust: THREE.Points;
  private dustSeeds: Float32Array;
  private dustBeams: { win: THREE.Vector3[]; floor: THREE.Vector3[] }[] = [];
  private groundMat!: THREE.MeshBasicMaterial;
  /** Cool moon rim on the farmer at night (keeps the silhouette off the dark floor). */
  private rim: THREE.PointLight;
  /** Room-specific daylight multiplier (barns are dim, the house is bright). */
  protected dayScale = 1;
  /** Extra exposure in daylight (small, dim-walled rooms read too murky otherwise). */
  protected exposureBoost = 0;
  /** Moonlight through the windows at night (the cool accent against the lamp light). */
  protected moonScale = 1;
  /** Soft additive sun patch where each window shaft lands (0 = off; straw floors swallow the real one). */
  protected sunPoolK = 0;
  protected finalized = false;
  /** Bedtime dimming 0..1 (sleep system): lamps, fire and exposure ease down before the fade. */
  dim = 0;

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
    // The whole diorama stays in frame: the camera only breathes a little with the farmer (a room that
    // slides half off-screen when you walk to a wall reads as a broken camera, not a cutaway).
    this.cameraBounds = new THREE.Box2(new THREE.Vector2(W / 2 - 0.22, D / 2 - 0.2), new THREE.Vector2(W / 2 + 0.22, D / 2 + 0.25));
    this.warps = [{ x0: spec.doorX, z0: D, x1: spec.doorX, z1: D, to: spec.exit.to, x: spec.exit.x, z: spec.exit.z, facing: spec.exit.facing }];
    this.light.sunDir.set(...spec.sunDir).normalize();

    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: shaftGradient().map }, uColor: { value: new THREE.Color() }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor; uniform float uTime;
        varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main() {
          float a = texture2D(uMap, vUv).r;
          float n = 0.8 + 0.2 * sin(vW.x * 3.1 + vW.y * 2.3 + uTime * 0.6) * sin(vW.z * 2.7 - uTime * 0.4);
          // Faces seen edge-on fade out: the beam's silhouette is soft, never a hard-edged slab.
          float facing = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
          gl_FragColor = vec4(uColor * a * n * smoothstep(0.04, 0.5, facing), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // Window views: the painted day card cross-faded into a real night card (indigo sky, moon, stars,
    // black hills, two warm far windows). The night side divides out the room's exposure so the +EV
    // indoor night boost can never lift it back towards daylight.
    this.viewMat = new THREE.ShaderMaterial({
      uniforms: { uDay: { value: windowView().map }, uNightMap: { value: windowViewNight().map }, uNight: { value: 0 }, uDayK: { value: 1 }, uInvExp: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDay; uniform sampler2D uNightMap; uniform float uNight; uniform float uDayK; uniform float uInvExp;
        varying vec2 vUv;
        void main() {
          vec3 d = texture2D(uDay, vUv).rgb * uDayK;
          vec3 n = texture2D(uNightMap, vUv).rgb * 0.85 * uInvExp;
          gl_FragColor = vec4(mix(d, n, smoothstep(0.0, 1.0, uNight)), 1.0);
        }`,
      fog: false,
      toneMapped: false,
    });

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

    this.rim = new THREE.PointLight(0xffcf9a, 0, 2.6, 2);
    this.rim.castShadow = false;
    this.root.add(this.rim);

    this.buildShell();
  }

  // ─────────────────────────────────────────── shell

  private buildShell(): void {
    const { W, D, H, style } = this.spec;
    const k = new Kit();
    const T = 0.22;
    // Floor + slab (its cut edge shows under the knee wall at the front).
    k.add(this.spec.floor, floorPlane(W, D + 0.02, this.spec.floor === 'straw' ? 0.5 : 1), new THREE.Matrix4().makeTranslation(W / 2, 0, D / 2), { tint: this.spec.floorTint ?? 0xffffff });
    k.box('stone', [W + 2 * T + 0.1, 0.5, D + 2 * T + 0.1], [W / 2, -0.52, D / 2], { tint: 0xa8947e, uv: 1.2 });
    k.box('wood', [W + 2 * T + 0.14, 0.1, 0.12], [W / 2, -0.07, D + T + 0.04], { tint: 0x8a5a38, r: 0.03, uv: 1.5 });

    const wallMat: IMat = this.spec.wallMat ?? (style === 'house' ? 'wallpaper' : 'barn');
    const wallTint = this.spec.wallTint ?? (style === 'house' ? 0xffffff : 0xd8c8b0);
    // Back wall + side walls with window holes.
    const holes = (wall: WindowSpec['wall']) => this.spec.windows.filter((w) => w.wall === wall);
    this.wall(k, wallMat, wallTint, 'back', W + 2 * T, H, T, holes('back'));
    this.wall(k, wallMat, wallTint, 'left', D + 2 * T, H, T, holes('left'));
    this.wall(k, wallMat, wallTint, 'right', D + 2 * T, H, T, holes('right'));
    // Cut caps on wall tops: a bevelled, lit wood-grain top plate (the dollhouse section line reads as
    // crafted trim, not a black slab).
    const cap = 0x8a5a38;
    k.box('wood', [W + 2 * T + 0.12, 0.12, T + 0.12], [W / 2, H, -T / 2], { tint: cap, r: 0.04, uv: 1.5 });
    k.box('wood', [T + 0.12, 0.12, D + 2 * T + 0.12], [-T / 2, H, D / 2], { tint: cap, r: 0.04, uv: 1.5 });
    k.box('wood', [T + 0.12, 0.12, D + 2 * T + 0.12], [W + T / 2, H, D / 2], { tint: cap, r: 0.04, uv: 1.5 });

    // Knee wall at the front with the door gap.
    const kneeH = 0.42;
    const gap0 = this.spec.doorX - 0.1;
    const gap1 = this.spec.doorX + 1.1;
    const frontTint = style === 'house' ? 0xe8dcc4 : 0xb89a78;
    const frontMat: IMat = style === 'house' ? 'bead' : 'barn';
    for (const [a, b] of [[-T, gap0], [gap1, W + T]] as const) {
      const w = b - a;
      k.box(frontMat, [w, kneeH, T], [(a + b) / 2, 0, D + T / 2], { tint: frontTint, uv: 1 });
      k.box('wood', [w + 0.06, 0.1, T + 0.12], [(a + b) / 2, kneeH, D + T / 2], { tint: cap, r: 0.04, uv: 1.5 });
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

    // The diorama sits on a dark warm surface: a soft pool of bounce light under the model fading to
    // the backdrop colour, darkest right against the plinth (contact shadow).
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 16, D + 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: dioramaGround(W, D), fog: false, depthWrite: true }));
    ground.position.set(W / 2, -0.53, D / 2);
    ground.userData.noAO = true;
    ground.userData.dynamic = true;
    ground.name = 'diorama-ground';
    this.root.add(ground);
    this.groundMat = ground.material;

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

  /**
   * A window-shaped pool of warm sun on the floor where a shaft lands: the shaft's floor quad, grown
   * 35 % about its centre, textured with the soft glow disc (so the edges feather out), additive,
   * tinted with the sun colour and faded by daylight.
   */
  private sunPool(floor: THREE.Vector3[]): void {
    const c = new THREE.Vector3();
    for (const f of floor) c.add(f);
    c.multiplyScalar(1 / floor.length);
    const q = floor.map((f) => f.clone().sub(c).multiplyScalar(1.35).add(c));
    const pos: number[] = [];
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    for (const i of [0, 1, 2, 0, 2, 3]) pos.push(q[i]!.x, 0.014, q[i]!.z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.MeshBasicMaterial({ map: glowDisc().map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.noAO = true;
    mesh.userData.dynamic = true;
    mesh.renderOrder = 2;
    mesh.name = 'sun-pool';
    this.root.add(mesh);
    this.updaters.push((_dt, _t, L) => m.color.copy(L.sunColor).multiplyScalar(this.sunPoolK * L.day));
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
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.shaftMat);
      mesh.renderOrder = 5;
      mesh.userData.noAO = true;
      mesh.userData.dynamic = true;
      mesh.name = 'light-shaft';
      this.root.add(mesh);
      this.shafts.push(mesh);
      this.dustBeams.push({ win: corners, floor });
      if (this.sunPoolK > 0) this.sunPool(floor);
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
    // Daylight 0..1: dawn 5.5 → 7.0 (shafts ramp in with it), dusk 18.2 → 20.2.
    const day = h < 12 ? S(h, 5.5, 7.0) : 1 - S(h, 18.2, 20.2);
    const night = 1 - day;
    const warm = h < 12 ? 1 - S(h, 7, 10.5) : S(h, 15.5, 19);
    const L = this.light;
    L.day = day * (1 - overcast * 0.85);
    L.night = night;
    // Sun through the windows: golden morning / evening, cream midday, cool moonlight at night.
    const sunDay = _c.setHex(0xfff1dc).lerp(new THREE.Color(0xffb46a), warm * 0.85);
    L.sunColor.copy(sunDay).lerp(new THREE.Color(0x8aa6ff), night);
    L.sunI = day * 5.2 * (1 - overcast * 0.85) * this.dayScale + night * 1.35 * this.moonScale * (1 - overcast * 0.6);
    // Ambient: warm wood bounce by day; at night a cool moonlight fill through the windows so the
    // floor never crushes to black (the lamps then paint warm pools over it).
    L.hemiSky.setHex(0xf2dcc0).lerp(new THREE.Color(0x8a9ac8), overcast * 0.4).lerp(new THREE.Color(0x6f86c9), night);
    L.hemiGround.setHex(0x8a5a36).lerp(new THREE.Color(0x3a2a24), night);
    L.hemiI = THREE.MathUtils.lerp((0.55 + day * 0.55) * (1 - overcast * 0.2) * (0.7 + 0.3 * this.dayScale), 0.46, night);
    L.envI = 0.12 + day * 0.14 + night * 0.06;
    // +0.4 EV indoors at night.
    L.exposure = (1.0 + night * 0.18 + overcast * 0.1 + this.exposureBoost * day) * (1 + night * 0.32);
    L.bg.setHex(0x1c140e).lerp(new THREE.Color(0x0a0a12), night);
    // Night lift keeps the corners readable (the lamps stay the key, the shadows stay blue-brown).
    L.lift = [0.025 + night * 0.028, 0.018 + night * 0.02, 0.012 + night * 0.05];
    L.gain = [1.06 + warm * 0.04, 1.0, 0.93 - warm * 0.03 + night * 0.06];
    L.sat = 1.1 - night * 0.05;
    L.contrast = 1.06 + night * 0.04;
    L.vignette = 0.52 + night * 0.12;
    L.bloom = 0.35 + night * 0.12;
  }

  // ─────────────────────────────────────────── GameMap

  heightAt(): number {
    return 0;
  }

  /** Weather hands every map its fog amount right after writing the height-fog state (and before the
   *  post pass syncs it): indoors there is no ground mist and no canopy shafts, the room's own shaft
   *  cards carry the daylight. Without this the outdoor morning mist filled the room as a milky box. */
  setAtmosphere(): void {
    atmosphere.fog = 0;
    atmosphere.shafts = 0;
  }

  update(dt: number, game: Game): void {
    this.setAtmosphere();
    this.computeLight();
    const L = this.light;
    L.exposure *= 1 - this.dim * 0.32;
    L.bloom *= 1 - this.dim * 0.4;
    const t = game.time;
    const pp = game.player.position;
    // Night: a soft warm bounce fill in front of the farmer at chest height (the lamplight coming back
    // off the floorboards), so the face reads instead of a silhouette against the hearth. Low and in
    // front, so it never blows the straw hat out from above.
    this.rim.position.set(pp.x + 0.3, pp.y + 0.8, pp.z + 1.0);
    this.rim.intensity = L.night * 0.95;
    this.groundMat.color.setScalar(0.55 + 0.45 * L.day);
    const lampK = Math.max(L.night, 1 - L.day * 1.05);
    for (const l of this.lamps) {
      const base = THREE.MathUtils.lerp(l.day, l.night, THREE.MathUtils.clamp(lampK, 0, 1));
      const f = l.flicker ? 1 + l.flicker * (Math.sin(t * 13 + l.seed) * 0.35 + Math.sin(t * 7.3 + l.seed * 2) * 0.4 + Math.sin(t * 23.1 + l.seed) * 0.25) : 1;
      l.light.intensity = base * f * (1 - this.dim * 0.78);
    }
    for (const e of interiorEmissive) e.material.emissiveIntensity = THREE.MathUtils.lerp(e.day, e.night, THREE.MathUtils.clamp(lampK, 0, 1));
    // Shafts: warm by day, faint blue by moonlight.
    const shaft = this.shaftMat.uniforms;
    (shaft.uColor!.value as THREE.Color).copy(L.sunColor).multiplyScalar(0.11 * L.day * this.dayScale + 0.025 * L.night);
    shaft.uTime!.value = t;
    // Window views: bright painted day, deep blue at night.
    const vu = this.viewMat.uniforms;
    vu.uNight!.value = L.night;
    vu.uDayK!.value = 0.35 + 0.95 * L.day;
    vu.uInvExp!.value = 1 / Math.max(0.5, L.exposure);
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

/** Backdrop surface under the diorama: warm bounce pool under the plinth, contact-dark at its edge. */
function dioramaGround(W: number, D: number): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const px = (m: number, of: number) => (m / of) * S;
  const TW = W + 16;
  const TD = D + 16;
  g.fillStyle = '#140e0a';
  g.fillRect(0, 0, S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, px(Math.min(W, D) * 0.3, TW), S / 2, S / 2, px(Math.max(W, D) * 0.95, TW));
  grad.addColorStop(0, '#3b2a1d');
  grad.addColorStop(0.55, '#2a1d14');
  grad.addColorStop(1, '#140e0a');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // Contact shadow hugging the plinth
  g.filter = 'blur(6px)';
  g.fillStyle = 'rgba(8,5,3,0.85)';
  const w = px(W + 1.0, TW);
  const d = px(D + 1.0, TD);
  g.fillRect(S / 2 - w / 2, S / 2 - d / 2, w, d);
  g.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Convenience: material handle (for subclasses creating custom meshes). */
export { imat };
