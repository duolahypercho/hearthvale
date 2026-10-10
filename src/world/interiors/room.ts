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
  /** r16: this window's light-shaft strength (1 = the room's default). */
  shaft?: number;
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
  /** Height of the cut-away front knee wall (default skirting height 0.3; the coop's pop door needs 0.42). */
  kneeH?: number;
  wainscotTint?: number;
  /** Barn style: material of the lower wall band (with wainscotTint; default limewash). */
  lowerMat?: IMat;
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
const _c2 = new THREE.Color();

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
  /** Cool daylight bounce through the windows (0..1): blue-sky ambient against the warm wood + lamps. */
  protected coolFill = 0;
  /** Window shaft strength multiplier. */
  protected shaftK = 1;
  /** r16: lamps come on early (0..1 floor on the lamp level from 14:30 → 17:00). */
  protected lampEarly = 0;
  /** This frame's lamp level (0 day … 1 night), for room updaters. */
  protected lampK = 0;
  /** How much of the cool morning sky light this room takes (0..1). */
  protected morningCool = 0.6;
  /** This frame's cool-morning weight (computeLight). */
  protected coolK = 0;
  /** Moonlight shaft strength at night (the cool beam over the bed / floor). */
  protected moonShaft = 0.025;
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
        attribute float aK; attribute vec2 aWin;
        varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vK; varying vec2 vWin; varying float vDepth;
        void main() { vUv = uv; vK = aK; vWin = aWin; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor; uniform float uTime;
        varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vK; varying vec2 vWin; varying float vDepth;
        void main() {
          float a = texture2D(uMap, vUv).r * vK;
          float n = 0.8 + 0.2 * sin(vW.x * 3.1 + vW.y * 2.3 + uTime * 0.6) * sin(vW.z * 2.7 - uTime * 0.4);
          // Faces seen edge-on fade out: the beam's silhouette is soft, never a hard-edged slab.
          float facing = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
          // r18: the window's own framing carried down the beam (the cross of the glazing bars casts two
          // darker lanes, so a shaft reads as light through panes, not a flat translucent slab) …
          float bars = smoothstep(0.02, 0.075, abs(vWin.x - 0.5)) * smoothstep(0.025, 0.085, abs(vWin.y - 0.5));
          // … and it thins out with depth along the view (the far faces of the prism, behind the beam's
          // near face, add less: the volume has a front and a back instead of a doubled slab).
          float thin = mix(1.0, 0.55, smoothstep(0.0, 1.0, (vDepth - 9.0) / 8.0));
          // low-frequency breakup along the beam (the air is never evenly lit)
          float breakup = 0.72 + 0.28 * sin(vUv.y * 7.0 + vW.x * 1.7 - uTime * 0.25) * sin(vUv.x * 5.0 + vW.z * 1.3);
          gl_FragColor = vec4(uColor * a * n * mix(0.3, 1.0, bars) * thin * breakup * smoothstep(0.08, 0.6, facing), 1.0);
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
    // (r18: more, slightly bigger motes — the sparkle in the beam carries the light now)
    const N = 240;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.dustSeeds = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) this.dustSeeds[i] = Math.random();
    this.dust = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.042, map: textures.softDot().map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0d0, opacity: 0.8, fog: false }),
    );
    this.dust.frustumCulled = false;
    this.dust.userData.noAO = true;
    this.dust.name = 'dust';

    this.rim = new THREE.PointLight(0xffdcb4, 0, 3.6, 2);
    this.rim.castShadow = false;
    this.root.add(this.rim);

    this.buildShell();
    this.buildDoorway();
  }

  // ─────────────────────────────────────────── doorway (the way out must read at a glance)

  /**
   * The exit, readable at gameplay zoom: a painted door frame cut at the section line (jambs a little
   * proud of the knee wall, a dark lintel cap), a coir doormat inside, a fan of outside light spilling
   * in over the threshold (warm daylight / cool moonlight), and a pair of bobbing floor chevrons
   * pointing out of the door whenever the farmer is within two tiles of it.
   */
  private buildDoorway(): void {
    const { D, style } = this.spec;
    const T = 0.22;
    const kneeH = this.spec.kneeH ?? 0.3;
    const gap0 = this.spec.doorX - 0.1;
    const gap1 = this.spec.doorX + 1.1;
    const dc = this.spec.doorX + 0.5;
    const k = new Kit();
    const trim = style === 'house' ? 0xf6eedc : 0xf2ead8;
    const jh = kneeH + 0.46;
    for (const x of [gap0 - 0.04, gap1 + 0.04]) {
      k.box('paint', [0.16, jh, T + 0.08], [x, 0, D + T / 2], { tint: trim, r: 0.02 });
      k.box('wood', [0.2, 0.06, T + 0.12], [x, jh, D + T / 2], { tint: 0x6a4428, r: 0.02 });
      // Iron hinge pins on the right jamb (the door itself swung away out of the cut)
      if (x > dc) for (const y of [0.12, jh - 0.16]) k.box('iron', [0.05, 0.08, 0.05], [x - 0.09, y, D + T * 0.85], { tint: 0x2a2624, r: 0.01 });
    }
    if (style === 'house') {
      // (r9) The front door itself, swung open into the room against the left jamb: a sage dutch door's
      // lower leaf (cut at the section height like the walls), planked with a Z brace, strap hinges and a
      // brass knob — the gap reads as a door standing open, not two stubby posts.
      const lk = new Kit();
      const lw = gap1 - gap0 - 0.06;
      // (r10: closed, cut at the jambs' height — swung open it stood edge-on to the lens in the doorway)
      const lh = jh;
      const P = 4;
      for (let b = 0; b < P; b++) lk.box('paint', [lw / P - 0.012, lh, 0.05], [(b + 0.5) * (lw / P), 0.02, 0], { tint: b % 2 ? 0x7f9c86 : 0x89a68e, r: 0.012 });
      for (const y of [0.16, lh - 0.12]) lk.box('paint', [lw - 0.04, 0.1, 0.04], [lw / 2, y, -0.045], { tint: 0x6f8a76, r: 0.01 });
      lk.box('paint', [Math.hypot(lw - 0.16, lh - 0.36), 0.09, 0.035], [lw / 2, lh / 2 - 0.045, -0.05], { tint: 0x6f8a76, rz: Math.atan2(lh - 0.36, lw - 0.16) });
      lk.box('paint', [lw + 0.02, 0.05, 0.08], [lw / 2, lh, 0], { tint: trim, r: 0.015 });
      for (const y of [0.22, lh - 0.2]) lk.box('iron', [0.34, 0.035, 0.012], [0.17, y, 0.032], { tint: 0x2a2624, r: 0.005 });
      lk.sphere('brass', 0.035, [lw - 0.1, 0.62, 0.05]);
      lk.sphere('brass', 0.035, [lw - 0.1, 0.62, -0.08]);
      const leaf = lk.build('door-leaf');
      // Shut in the doorway: the painted, braced face to the lens, a section-cut slab like the walls.
      leaf.position.set(gap0 + 0.06, 0, D + T * 0.5);
      leaf.rotation.y = 0;
      this.statics.push(leaf);
    }
    // Coir doormat just inside: bristly tan field, dark woven border, two stripes
    // (on straw floors it sits on the board walk that runs to the door: lift it clear)
    const mz = D - 0.3;
    const my = this.spec.floor.startsWith('straw') ? 0.032 : 0;
    k.box('fabric', [1.0, 0.014, 0.48], [dc, my, mz], { tint: 0x5a3a22, r: 0.006 });
    k.box('burlap', [0.9, 0.018, 0.38], [dc, my, mz], { tint: 0xc89048, r: 0.006, uv: 0.6 });
    for (const dz of [-0.1, 0.1]) k.box('fabric', [0.9, 0.02, 0.035], [dc, my, mz + dz], { tint: 0x8a5a2e });
    const g = k.build('doorway');
    this.statics.push(g);

    // Light spill: a trapezoid fanning in from the door gap, bright at the threshold, feathered sides.
    const spill = new THREE.BufferGeometry();
    const w0 = (gap1 - gap0) * 0.5;
    const w1 = w0 + 0.75;
    const z0 = D + T * 0.5;
    const z1 = D - 2.3;
    const P = [dc - w0, z0, dc + w0, z0, dc + w1, z1, dc - w1, z1];
    const pos: number[] = [];
    const uv: number[] = [];
    const UV = [0, 1, 1, 1, 1, 0, 0, 0];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(P[i * 2]!, 0.016, P[i * 2 + 1]!);
      uv.push(UV[i * 2]!, UV[i * 2 + 1]!);
    }
    spill.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    spill.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const sm = new THREE.MeshBasicMaterial({ map: spillTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    const sMesh = new THREE.Mesh(spill, sm);
    sMesh.userData.noAO = true;
    sMesh.userData.dynamic = true;
    sMesh.renderOrder = 2;
    sMesh.name = 'door-spill';
    this.root.add(sMesh);
    const moon = new THREE.Color(0x6f86c9);
    this.updaters.push((_dt, _t, L) => sm.color.copy(L.sunColor).multiplyScalar(0.3 * L.day).add(_c.copy(moon).multiplyScalar(0.1 * L.night)).multiplyScalar(1 - this.dim));

    // Exit chevrons on the threshold (shown near the door only).
    const chev = new THREE.Shape();
    chev.moveTo(-0.22, 0);
    chev.lineTo(0, 0.16);
    chev.lineTo(0.22, 0);
    chev.lineTo(0.22, 0.08);
    chev.lineTo(0, 0.24);
    chev.lineTo(-0.22, 0.08);
    chev.closePath();
    const cg = new THREE.ShapeGeometry(chev);
    cg.rotateX(Math.PI / 2); // shape +y → world +z (out of the door)
    const arrows = new THREE.Group();
    arrows.name = 'exit-arrows';
    arrows.userData.dynamic = true;
    const am = new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
    const om = new THREE.MeshBasicMaterial({ color: 0x3a2414, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const o = new THREE.Mesh(cg, om);
      o.scale.set(1.22, 1, 1.32);
      o.position.set(0, 0.002, -0.03);
      const a = new THREE.Mesh(cg, am);
      const holder = new THREE.Group();
      holder.add(o, a);
      holder.position.set(0, 0, i * 0.26);
      for (const m of [o, a]) {
        m.renderOrder = 6;
        m.userData.noAO = true;
      }
      arrows.add(holder);
    }
    arrows.position.set(dc, 0.05, D - 0.55);
    arrows.visible = false;
    this.root.add(arrows);
    let shown = 0;
    this.updaters.push((dt, t) => {
      const pp = this.game.player.position;
      const near = this.game.world.current === this && Math.hypot(pp.x - dc, (pp.z - D) * 1.1) < 2.2 && !this.game.player.busy;
      shown += ((near ? 1 : 0) - shown) * (1 - Math.exp(-7 * dt));
      arrows.visible = shown > 0.02;
      if (!arrows.visible) return;
      arrows.position.z = D - 0.55 + ((t * 0.6) % 1) * 0.18;
      const pulse = 0.75 + 0.25 * Math.sin(t * 5);
      am.opacity = shown * pulse;
      om.opacity = shown * 0.55;
    });
  }


  // ─────────────────────────────────────────── shell

  private buildShell(): void {
    const { W, D, H, style } = this.spec;
    const k = new Kit();
    const T = 0.22;
    // Floor + slab (its cut edge shows under the knee wall at the front).
    k.add(this.spec.floor, floorPlane(W, D + 0.02, this.spec.floor.startsWith('straw') ? 0.5 : 1), new THREE.Matrix4().makeTranslation(W / 2, 0, D / 2), { tint: this.spec.floorTint ?? 0xffffff });
    k.box('stone', [W + 2 * T + 0.1, 0.5, D + 2 * T + 0.1], [W / 2, -0.52, D / 2], { tint: 0xa8947e, uv: 1.2 });
    k.box('wood', [W + 2 * T + 0.14, 0.1, 0.12], [W / 2, -0.07, D + T + 0.04], { tint: 0xa87048, r: 0.03, uv: 1.5 });

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

    // Knee wall at the front with the door gap: skirting height, capped with a plank of the room's own
    // floor (the cut section reads as the floor turning the corner, lit and warm, not a dark slab) and a
    // pale nosing on its outer edge (the section outline).
    const kneeH = this.spec.kneeH ?? 0.3;
    const gap0 = this.spec.doorX - 0.1;
    const gap1 = this.spec.doorX + 1.1;
    const frontTint = style === 'house' ? 0xe8dcc4 : 0xb89a78;
    const frontMat: IMat = style === 'house' ? 'bead' : 'barn';
    const straw = this.spec.floor.startsWith('straw');
    for (const [a, b] of [[-T, gap0], [gap1, W + T]] as const) {
      const w = b - a;
      k.box(frontMat, [w, kneeH, T], [(a + b) / 2, 0, D + T / 2], { tint: frontTint, uv: 1 });
      // (a limewashed coop gets a whitewashed cap: the bright section line of a painted diorama)
      const lime = this.spec.wallMat === 'limewash';
      k.box(lime ? 'limewash' : straw ? 'plank' : 'floor', [w + 0.06, 0.08, T + 0.1], [(a + b) / 2, kneeH, D + T / 2], { tint: lime ? 0xf2ead8 : straw ? 0xf4dcb4 : 0xfff0dc, r: 0.03, uv: straw ? 1.2 : 1 });
      k.box('paint', [w + 0.07, 0.035, 0.035], [(a + b) / 2, kneeH + 0.06, D + T + 0.035], { tint: style === 'house' ? 0xf6e8cc : 0xf0dcb8, r: 0.012 });
    }
    // Threshold (worn oak, lit like the floor) + a fieldstone doorstep outside it
    k.box(straw ? 'plank' : 'floor', [gap1 - gap0, 0.04, T + 0.1], [(gap0 + gap1) / 2, 0, D + T / 2], { tint: straw ? 0xd8bc98 : 0xe8d0b0, uv: 1 });
    k.box('stone', [gap1 - gap0 + 0.16, 0.14, 0.3], [(gap0 + gap1) / 2, -0.16, D + T + 0.17], { tint: 0xc8b8a0, r: 0.04, uv: 0.8 });
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
    front.position.set(W / 2, (this.spec.kneeH ?? 0.3) + H / 2, D + T + 0.3);
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
      // Optional whitewashed / limewashed lower boards up to the girt (a cool band under the warm wood).
      if (this.spec.wainscotTint != null) piece(this.spec.lowerMat ?? 'limewash', start + T, end, 0.2, 1.3, 0.03, inner + 0.005, this.spec.wainscotTint, 1.1);
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
  /**
   * Co-op presence (r10): two farmers never stand inside each other in a small room — each client
   * eases its OWN farmer out of any other farmer closer than ~0.7 m (both sides do it, so the pair
   * slides apart symmetrically; a dead-centre overlap splits by player id). Walkable tiles only.
   */
  private separateFarmers(dt: number, game: Game): void {
    const net = game.services.net as unknown as { remotes?: { list?: Map<number, { map: string; away?: boolean; id: number; farmer: { root: THREE.Object3D } }> }; myId?: () => number } | undefined;
    const list = net?.remotes?.list;
    if (!list || !list.size || game.cinematic) return;
    const pp = game.player.position;
    // (r11: 1 m, and the push leans sideways — two chibi heads ~0.9 m wide stacked one behind the other
    // from the high lens at 0.7 m, depth-apart reads as one silhouette with a doubled tag)
    const R = 1.0;
    for (const r of list.values()) {
      if (r.away || r.map !== this.id) continue;
      const o = r.farmer.root.position;
      let dx = pp.x - o.x;
      let dz = pp.z - o.z;
      let d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-3) {
        // Exactly on top: split along x, the lower id to the left.
        const mine = net?.myId?.() ?? 0;
        dx = mine < r.id ? -1 : 1;
        dz = 0.15;
        d = Math.hypot(dx, dz);
      }
      const push = Math.min((R - d) * 0.5, dt * 1.6);
      // Screen-sideways first: weight x over depth (z) so the pair ends side by side.
      let ux = dx / d;
      let uz = (dz / d) * 0.45;
      if (Math.abs(ux) < 0.25) {
        const mine = net?.myId?.() ?? 0;
        ux = (Math.abs(dx) > 0.02 ? Math.sign(dx) : mine < r.id ? -1 : 1) * 0.6;
      }
      const ul = Math.hypot(ux, uz);
      ux /= ul;
      uz /= ul;
      // Straight away from them; if furniture / a wall blocks that, slide sideways (either way) instead.
      for (const [cx, cz] of [[ux, uz], [-uz, ux], [uz, -ux], [ux * 0.7 - uz * 0.7, uz * 0.7 + ux * 0.7], [ux * 0.7 + uz * 0.7, uz * 0.7 - ux * 0.7]] as const) {
        const nx = pp.x + cx * push;
        const nz = pp.z + cz * push;
        const ex = nx + cx * 0.2;
        const ez = nz + cz * 0.2;
        if (this.grid.isWalkable(Math.floor(ex), Math.floor(ez))) {
          pp.set(nx, pp.y, nz);
          break;
        }
      }
    }
  }

  /** Every furniture rect passed to solid() (name cards keep off them on screen). */
  readonly propRects: { x0: number; z0: number; x1: number; z1: number; id: string }[] = [];

  protected solid(x0: number, z0: number, x1: number, z1: number, id = 'furniture'): void {
    this.propRects.push({ x0, z0, x1, z1, id });
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
    // r21: clipped to the room's floor (the walls' inner faces): a lamp pool by the front wall spilled
    // past it onto the black void round the cutaway diorama.
    const { W, D } = this.spec;
    const x0 = Math.max(x - r, 0.1);
    const x1 = Math.min(x + r, W - 0.1);
    const z0 = Math.max(z - r, 0.1);
    const z1 = Math.min(z + r, D - 0.1);
    if (x1 <= x0 || z1 <= z0) return;
    const g = floorPlane(x1 - x0, z1 - z0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i);
      const wz = cz + pos.getZ(i);
      uv.setXY(i, (wx - (x - r)) / (2 * r), 1 - (wz - (z - r)) / (2 * r));
    }
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(cx, y, cz);
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
    this.updaters.push((_dt, _t, L) => m.color.copy(L.sunColor).multiplyScalar(this.sunPoolK * 1.3 * L.day));
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
      // (r18: narrower — the beam enters through the glass, not the whole opening incl. the frame)
      const u0 = h.at - h.w / 2 + Math.max(0.04, h.w * 0.11);
      const u1 = h.at + h.w / 2 - Math.max(0.04, h.w * 0.11);
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
      const kk: number[] = [];
      const win: number[] = [];
      const WIN = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
      // 4 side faces of the prism window-quad → floor-quad (v: 1 at window, 0 at floor).
      for (let i = 0; i < 4; i++) {
        const wa = WIN[i]!;
        const wb = WIN[(i + 1) % 4]!;
        for (const w of [wa, wb, wb, wa, wb, wa]) win.push(w[0], w[1]);
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
        const fa = floor[i]!;
        const fb = floor[(i + 1) % 4]!;
        const quad = [a, b, fb, a, fb, fa];
        const quv = [[0, 1], [1, 1], [1, 0], [0, 1], [1, 0], [0, 0]];
        quad.forEach((p, j) => {
          pos.push(p.x, p.y, p.z);
          uv.push(quv[j]![0]!, quv[j]![1]!);
          kk.push(h.shaft ?? 1);
        });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
      g.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 2));
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
    // (r9: golden light only right at dawn and through the evening — at 8 am the room read as dusk.
    // Mornings to early afternoon get a cool near-white sky light through the windows, so the hearth and
    // lamps read as a warm pocket against it.)
    const warm = h < 12 ? 1 - S(h, 6.2, 7.8) : S(h, 15.5, 19);
    const cool = day * (1 - overcast * 0.6) * (h < 12 ? S(h, 6.4, 8.0) : 1 - S(h, 13.5, 16.5)) * this.morningCool;
    this.coolK = cool;
    const L = this.light;
    L.day = day * (1 - overcast * 0.85);
    L.night = night;
    // Sun through the windows: golden morning / evening, cream midday, cool moonlight at night.
    const sunDay = _c.setHex(0xfff1dc).lerp(new THREE.Color(0xffb46a), warm * 0.85).lerp(_c2.setHex(0xf0f4ff), cool * 0.78);
    L.sunColor.copy(sunDay).lerp(new THREE.Color(0x8aa6ff), night);
    L.sunI = day * 5.2 * (1 - overcast * 0.85) * this.dayScale + night * 1.35 * this.moonScale * (1 - overcast * 0.6);
    // Ambient: warm wood bounce by day; at night a cool moonlight fill through the windows so the
    // floor never crushes to black (the lamps then paint warm pools over it).
    L.hemiSky.setHex(0xf2dcc0).lerp(new THREE.Color(0x8a9ac8), overcast * 0.4).lerp(new THREE.Color(0x7684b4), night);
    if (this.coolFill > 0) L.hemiSky.lerp(new THREE.Color(0xb4c8ee), this.coolFill * day * (1 - overcast * 0.5));
    L.hemiSky.lerp(_c2.setHex(0xc2d0f2), cool * 0.68);
    L.hemiGround.setHex(0x8a5a36).lerp(new THREE.Color(0x3a2a24), night).lerp(_c2.setHex(0x665a54), cool * 0.5);
    L.hemiI = THREE.MathUtils.lerp((0.55 + day * 0.55) * (1 - overcast * 0.2) * (0.7 + 0.3 * this.dayScale), 0.46, night) * (1 - cool * 0.1);
    L.envI = 0.12 + day * 0.14 + night * 0.06;
    // +0.4 EV indoors at night.
    // (r13: +~0.15 EV more at night — the night house read dim on a store thumbnail)
    L.exposure = (1.0 + night * 0.18 + overcast * 0.1 + this.exposureBoost * day) * (1 + night * 0.42);
    L.bg.setHex(0x1c140e).lerp(new THREE.Color(0x0a0a12), night);
    // Night lift keeps the corners readable (the lamps stay the key, the shadows stay blue-brown).
    // (r24: a warmer night lift — the critic's "night edges fall into cyan-black": the shadow floor is a
    // dim walnut brown now, the moonlight only a cool fill on top)
    L.lift = [0.025 + night * 0.036, 0.018 + night * 0.024, 0.012 + night * 0.034];
    L.gain = [1.06 + warm * 0.04 - this.coolFill * day * 0.02 - cool * 0.045, 1.0, 0.93 - warm * 0.03 + night * 0.06 + this.coolFill * day * 0.05 + cool * 0.06];
    L.sat = 1.1 - night * 0.05;
    L.contrast = 1.06 + night * 0.04;
    // (r13: softer — the blind judge's "heavy vignette swallows the side walls")
    L.vignette = 0.4 + night * 0.08;
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
    this.separateFarmers(dt, game);
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
    // (r25: the critic's "backlit, muddy face at night" — a true frontal fill: face height, a stride
    // towards the lens; the brim shades it from above so the hat doesn't blow out)
    this.rim.position.set(pp.x + 0.1, pp.y + 1.15, pp.z + 1.7);
    this.rim.intensity = L.night * 1.5;
    this.groundMat.color.setScalar(0.55 + 0.45 * L.day);
    // (r16: dim rooms — the barn — light their lanterns from mid-afternoon)
    const lampK = Math.max(L.night, 1 - L.day * 1.05, this.lampEarly * THREE.MathUtils.smoothstep(game.calendar.hour, 14.5, 17.0));
    this.lampK = lampK;
    for (const l of this.lamps) {
      const base = THREE.MathUtils.lerp(l.day, l.night, THREE.MathUtils.clamp(lampK, 0, 1));
      const f = l.flicker ? 1 + l.flicker * (Math.sin(t * 13 + l.seed) * 0.35 + Math.sin(t * 7.3 + l.seed * 2) * 0.4 + Math.sin(t * 23.1 + l.seed) * 0.25) : 1;
      l.light.intensity = base * f * (1 - this.dim * 0.78);
    }
    for (const e of interiorEmissive) e.material.emissiveIntensity = THREE.MathUtils.lerp(e.day, e.night, THREE.MathUtils.clamp(lampK, 0, 1));
    // Shafts: warm by day, faint blue by moonlight.
    const shaft = this.shaftMat.uniforms;
    // (r18: 0.11 → 0.085 — the brightness moves into the dust motes and the bounced floor pool)
    (shaft.uColor!.value as THREE.Color).copy(L.sunColor).multiplyScalar(0.085 * L.day * this.dayScale * this.shaftK * (1 + this.coolK * 0.7) + this.moonShaft * L.night);
    shaft.uTime!.value = t;
    // Window views: bright painted day, deep blue at night.
    const vu = this.viewMat.uniforms;
    vu.uNight!.value = L.night;
    // (r24: 1.3 -> 1.0 peak — un-tonemapped, the coop's back window bloomed into a blank white slab)
    vu.uDayK!.value = 0.3 + 0.7 * L.day;
    vu.uInvExp!.value = 1 / Math.max(0.5, L.exposure);
    this.updateDust(dt, t, L);
    for (const u of this.updaters) u(dt, t, L);
  }

  private updateDust(dt: number, t: number, L: RoomLight): void {
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const nb = this.dustBeams.length;
    const mat = this.dust.material as THREE.PointsMaterial;
    mat.opacity = Math.min(1, 0.15 + 0.85 * L.day);
    mat.color.copy(L.sunColor);
    this.dust.visible = nb > 0;
    if (!nb) return;
    const s = this.dustSeeds;
    // (r24: scalar maths straight into the attribute array — the closure + Vector3 lerps per mote showed
    // up as ~7 KB/frame of allocation churn in the interiors' alloc profile)
    const arr = pos.array as Float32Array;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const beam = this.dustBeams[i % nb]!;
      const i4 = i * 4;
      const s0 = s[i4]!;
      const ph = s[i4 + 3]! * 100;
      const u = 0.1 + 0.8 * (s0 + Math.sin(t * 0.13 + ph) * 0.06);
      const w = 0.1 + 0.8 * (s[i4 + 1]! + Math.cos(t * 0.11 + ph) * 0.06);
      // Motes drift slowly down the beam and wrap.
      const k = 0.05 + ((s[i4 + 2]! + t * 0.008 * (0.6 + s0)) % 1) * 0.85;
      const a = beam.win;
      const f = beam.floor;
      const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!;
      const f0 = f[0]!, f1 = f[1]!, f2 = f[2]!, f3 = f[3]!;
      // bilinear: lerp(lerp(q0, q1, u), lerp(q3, q2, u), w)
      const ax = a0.x + (a1.x - a0.x) * u, ay = a0.y + (a1.y - a0.y) * u, az = a0.z + (a1.z - a0.z) * u;
      const bx = a3.x + (a2.x - a3.x) * u, by = a3.y + (a2.y - a3.y) * u, bz = a3.z + (a2.z - a3.z) * u;
      const cx = f0.x + (f1.x - f0.x) * u, cy = f0.y + (f1.y - f0.y) * u, cz = f0.z + (f1.z - f0.z) * u;
      const dx = f3.x + (f2.x - f3.x) * u, dy = f3.y + (f2.y - f3.y) * u, dz = f3.z + (f2.z - f3.z) * u;
      const wx = ax + (bx - ax) * w, wy = ay + (by - ay) * w, wz = az + (bz - az) * w;
      const gx = cx + (dx - cx) * w, gy = cy + (dy - cy) * w, gz = cz + (dz - cz) * w;
      const j = i * 3;
      arr[j] = wx + (gx - wx) * k;
      arr[j + 1] = wy + (gy - wy) * k + Math.sin(t * 0.7 + ph) * 0.03;
      arr[j + 2] = wz + (gz - wz) * k;
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

let _spill: THREE.CanvasTexture | null = null;
/** Door light spill: bright at the threshold (v = 1), fading into the room, feathered at the sides. */
function spillTexture(): THREE.CanvasTexture {
  if (_spill) return _spill;
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / (H - 1); // canvas top = uv v 1 (threshold)
    const along = Math.pow(v, 1.6);
    for (let x = 0; x < W; x++) {
      const u = Math.abs(x / (W - 1) - 0.5) * 2;
      const side = 1 - THREE.MathUtils.smoothstep(u, 0.45, 1);
      const a = along * side;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _spill = new THREE.CanvasTexture(c);
  _spill.colorSpace = THREE.SRGBColorSpace;
  return _spill;
}

/** Convenience: material handle (for subclasses creating custom meshes). */
export { imat };
