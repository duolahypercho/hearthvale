/**
 * Fishing tackle visuals (driven by systems/fishing.ts, works on any map):
 *   rod     bamboo blank rebuilt every frame as a bent tube (bend follows line tension), cork grip + brass reel
 *   line    verlet rope (24 nodes) from the rod tip to the bobber, floats on the water, rendered as a
 *           camera-facing ribbon so it stays a crisp ~1.5 px thread
 *   bobber  red / white float with a quill, bobbing + nibble dips
 *   ripples expanding rings on the water (pool), splash droplets (BurstFX), a fish shadow that
 *           circles in towards the bobber before a bite
 *   catch   the procedural fish (fishmesh.ts) held up over the farmer's head
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BurstFX } from '../../render/particles';
import { globalUniforms } from '../../render/uniforms';
import type { FishDef } from '../../data/fish';
import { buildFishMesh, type FishMesh } from './fishmesh';

/** Merge [geometry, colour, transform] parts into one vertex-coloured geometry. */
function mergeColored(parts: [THREE.BufferGeometry, number, THREE.Matrix4][]): THREE.BufferGeometry {
  const list = parts.map(([g, c, m]) => {
    const n = (g.index ? g.toNonIndexed() : g).applyMatrix4(m);
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    const col = new THREE.Color(c);
    const a = new Float32Array(n.attributes.position!.count * 3);
    for (let i = 0; i < a.length; i += 3) {
      a[i] = col.r;
      a[i + 1] = col.g;
      a[i + 2] = col.b;
    }
    n.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return n;
  });
  return mergeGeometries(list)!;
}

/**
 * Held-fish length (m, the mesh is unit length): a per-species base from its median size, times the
 * rolled length over that median (0.7-1.8x) — a 105 cm grouper is a lot more fish than a 41 cm
 * flounder, and a record-size catch visibly out-sizes a typical one of its kind.
 */
export function heldFishScale(def: FishDef, lengthCm: number): number {
  // The held mesh is the fish's real length (the card's cm) at the farmers' scale (a farmer stands
  // 2.3 m to the hat: × 1.3 of a person), lightly exaggerated for small fish so a 20 cm sardine still
  // reads in the fist: 20 cm → 0.52 m, 50 → 0.83, 100 → 1.34, 150 → 1.85.
  void def;
  const m = lengthCm / 100;
  return THREE.MathUtils.clamp((0.24 + m * 0.79) * 1.3, 0.52, 1.9);
}

/** A held fish this long (m) or more is a trophy (a bigger hop, a wider sunburst). */
export const TROPHY_SCALE = 1.25;

const ROD_LEN = 2.15;
const ROD_SEG = 14;
const ROD_SIDES = 7;
const LINE_N = 24;
/** Blank radius: butt → tip (m). Chunky enough to read at gameplay zoom. */
const ROD_R0 = 0.03;
const ROD_R1 = 0.012;

/** Rod tiers (fishing system upgrades): blank / node / wrap colours. */
export const ROD_LOOKS = [
  { name: 'Bamboo Rod', blank: 0xf0cf84, node: 0xa8772e, wrap: 0xc8382a },
  { name: 'Fiberglass Rod', blank: 0x3f9a6a, node: 0x1f5a3a, wrap: 0xf2c84a },
  { name: 'Iridium Rod', blank: 0x8a5ad8, node: 0x3e2470, wrap: 0x5ad8d0 },
];

export interface RodPose {
  /** Grip (hand) position, world. */
  hand: THREE.Vector3;
  /** Unit direction of the unbent blank. */
  dir: THREE.Vector3;
  /** 0..1 bend towards `bendTo` (line tension). */
  bend: number;
  bendTo: THREE.Vector3;
  /** Reel handle angle (radians). */
  crank: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _rodPts: THREE.Vector3[] = Array.from({ length: ROD_SEG + 1 }, () => new THREE.Vector3());

export class FishingGear {
  readonly group = new THREE.Group();
  readonly fx = new BurstFX(360);
  /** World position of the rod tip (valid after update). */
  readonly tip = new THREE.Vector3();
  private rodGeo: THREE.BufferGeometry;
  private rod: THREE.Mesh;
  /** Inverted-hull outline around the blank (dark), so the rod reads against bright water. */
  private rodLineGeo: THREE.BufferGeometry;
  private rodLine: THREE.Mesh;
  private rodTier = -1;
  private foam: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; age: number; size: number }[] = [];
  private crowns: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; age: number; size: number }[] = [];
  private grip: THREE.Group;
  private reelHandle: THREE.Mesh;
  private line: THREE.Mesh;
  private lineGeo: THREE.BufferGeometry;
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  /** Smoothed copy of the rope used for the ribbon (render only). */
  private renderPts: THREE.Vector3[] = Array.from({ length: LINE_N }, () => new THREE.Vector3());
  readonly bobber: THREE.Group;
  /** The float's fluorescent antenna tip (faint emissive pulse; brighter while a fish bites). */
  private tipMat: THREE.MeshStandardMaterial;
  /** 0..1 extra tip glow (set by the fishing system on a bite / nibble). */
  tipFlash = 0;
  private ripples: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; age: number; life: number; size: number }[] = [];
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private held: { def: FishDef; mesh: FishMesh } | null = null;
  readonly heldRoot = new THREE.Group();
  /** Camera-facing quad (a Mesh, not a Sprite, so the AO G-buffer pass can skip it via `noAO`). */
  readonly glory: THREE.Mesh;
  private gloryMat: THREE.MeshBasicMaterial;
  private meshCache = new Map<string, FishMesh>();
  /** Landing reticle on the water while charging a cast. */
  readonly reticle: THREE.Mesh;
  private reticleMat: THREE.ShaderMaterial;
  /** Line state: slack 0 (taut) .. 1 (lazy curve on the water). */
  slack = 1;
  /** 0..1: how hard the rope is pulled towards a clean catenary each frame (no kinks while it's moving). */
  ease = 0;
  lineVisible = false;
  waterY = 0;
  /** Taut-line hum: sideways vibration amplitude (m) of the line's middle (0 = still). */
  vibrate = 0;
  /** Bite / hook twang (1 → 0): the line snaps tight and wobbles for a beat. */
  twang = 0;

  constructor() {
    this.group.name = 'fishing-gear';
    this.group.userData.perfTag = 'fishing';
    this.group.userData.noAO = true;

    // Rod blank (dynamic tube).
    this.rodGeo = new THREE.BufferGeometry();
    const nv = (ROD_SEG + 1) * ROD_SIDES;
    this.rodGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.rodGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.rodGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < ROD_SEG; i++) {
      for (let j = 0; j < ROD_SIDES; j++) {
        const a = i * ROD_SIDES + j;
        const b = i * ROD_SIDES + ((j + 1) % ROD_SIDES);
        // Outward-facing winding (so the lit near side renders, and the outline hull's BackSide sits behind).
        idx.push(a, b, a + ROD_SIDES, b, b + ROD_SIDES, a + ROD_SIDES);
      }
    }
    this.rodGeo.setIndex(idx);
    const rodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05, emissive: 0x2a1a08, emissiveIntensity: 0.35 });
    rodMat.name = 'rod';
    this.rod = new THREE.Mesh(this.rodGeo, rodMat);
    this.rod.frustumCulled = false;
    this.rod.castShadow = true;
    this.rodLineGeo = new THREE.BufferGeometry();
    this.rodLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.rodLineGeo.setIndex(idx);
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x24160a, side: THREE.BackSide, fog: true });
    outlineMat.name = 'rodOutline';
    this.rodLine = new THREE.Mesh(this.rodLineGeo, outlineMat);
    this.rodLine.frustumCulled = false;
    this.setRodTier(0);

    // Grip + reel (local frame: +Y along the blank, +Z = the blank's upper side, reel hangs below),
    // merged into one vertex-coloured mesh + the turning handle (2 draw calls instead of 11).
    this.grip = new THREE.Group();
    const CORK = 0xd8a070;
    const BRASS = 0xe8b850;
    const DARK = 0x3a2a1a;
    const T = (x: number, y: number, z: number, rz = 0): THREE.Matrix4 => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz), new THREE.Vector3(1, 1, 1));
    const gripGeo = mergeColored([
      [new THREE.CylinderGeometry(0.046, 0.04, 0.4, 12), CORK, T(0, -0.08, 0)],
      [new THREE.CylinderGeometry(0.036, 0.042, 0.1, 12), CORK, T(0, 0.2, 0)],
      [new THREE.SphereGeometry(0.05, 12, 8), DARK, T(0, -0.3, 0)],
      [new THREE.CylinderGeometry(0.038, 0.038, 0.12, 10), BRASS, T(0, 0.08, 0)],
      [new THREE.BoxGeometry(0.03, 0.1, 0.07), BRASS, T(0, 0.08, -0.06)],
      [new THREE.CylinderGeometry(0.075, 0.075, 0.06, 18), BRASS, T(0, 0.08, -0.11, Math.PI / 2)],
      [new THREE.CylinderGeometry(0.058, 0.058, 0.062, 18), 0xf2ece0, T(0, 0.08, -0.11, Math.PI / 2)],
      [new THREE.CylinderGeometry(0.088, 0.088, 0.012, 18), DARK, T(-0.036, 0.08, -0.11, Math.PI / 2)],
      [new THREE.CylinderGeometry(0.088, 0.088, 0.012, 18), DARK, T(0.036, 0.08, -0.11, Math.PI / 2)],
    ]);
    const gripMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
    gripMat.name = 'rodGrip';
    const gripMesh = new THREE.Mesh(gripGeo, gripMat);
    const handleHub = new THREE.Group();
    handleHub.position.set(0.05, 0.08, -0.11);
    this.reelHandle = new THREE.Mesh(
      mergeColored([
        [new THREE.BoxGeometry(0.016, 0.11, 0.02), DARK, T(0, 0.05, 0)],
        [new THREE.CylinderGeometry(0.018, 0.018, 0.04, 8), CORK, T(0.03, 0.1, 0, Math.PI / 2)],
      ]),
      gripMat,
    );
    handleHub.add(this.reelHandle);
    this.grip.add(gripMesh, handleHub);

    // Line ribbon.
    this.lineGeo = new THREE.BufferGeometry();
    // Two ribbons in one mesh: a dark under-stroke shifted ≈ 1 px down-screen, then the pale line on
    // top (≈ 2 px): a two-tone line that reads on dusk water, bright shallows and sand alike (critic
    // r4). (A dark core inside a 2 px ribbon aliased into a dotted line.)
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_N * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const lcol = new Float32Array(LINE_N * 4 * 3);
    const pale = new THREE.Color(0xf2ecdc);
    const core = new THREE.Color(0x3a2c20);
    for (let i = 0; i < LINE_N; i++) for (let j = 0; j < 4; j++) (j < 2 ? core : pale).toArray(lcol, (i * 4 + j) * 3);
    this.lineGeo.setAttribute('color', new THREE.BufferAttribute(lcol, 3));
    const lidx: number[] = [];
    // Dark ribbon first, the pale one drawn over it.
    for (const j of [0, 2]) {
      for (let i = 0; i < LINE_N - 1; i++) {
        const a = i * 4 + j;
        const b = a + 4;
        lidx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    this.lineGeo.setIndex(lidx);
    const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: true });
    lineMat.name = 'fishingLine';
    this.line = new THREE.Mesh(this.lineGeo, lineMat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
    for (let i = 0; i < LINE_N; i++) {
      this.pts.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }

    // Bobber: a tall stick float (nothing else on the water has this silhouette): a slim spindle body —
    // cream belly, deep-red shoulder, black waist band — with a long antenna and a fluorescent
    // amber tip that pulses faintly (its own emissive mesh), so your float reads at a glance.
    this.bobber = new THREE.Group();
    const RED = 0xc8281e;
    const CREAM = 0xf4eee0;
    const INK = 0x1e1612;
    const bandM = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const spindle = (y0: number, y1: number, r0: number, r1: number, rMid: number): THREE.BufferGeometry => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        const r = THREE.MathUtils.lerp(r0, r1, k) + Math.sin(k * Math.PI) * (rMid - (r0 + r1) / 2);
        pts.push(new THREE.Vector2(Math.max(0.002, r), THREE.MathUtils.lerp(y0, y1, k)));
      }
      return new THREE.LatheGeometry(pts, 12);
    };
    const bobMesh = new THREE.Mesh(
      mergeColored([
        [spindle(-0.16, 0, 0.004, 0.058, 0.05), CREAM, new THREE.Matrix4()],
        [spindle(0, 0.11, 0.058, 0.012, 0.05), RED, new THREE.Matrix4()],
        [new THREE.TorusGeometry(0.058, 0.01, 6, 18), INK, bandM],
        [new THREE.CylinderGeometry(0.0085, 0.011, 0.2, 6), CREAM, new THREE.Matrix4().makeTranslation(0, 0.2, 0)],
        [new THREE.CylinderGeometry(0.0115, 0.0115, 0.022, 6), INK, new THREE.Matrix4().makeTranslation(0, 0.2, 0)],
        [new THREE.SphereGeometry(0.012, 6, 4), RED, new THREE.Matrix4().makeTranslation(0, 0.11, 0)],
      ]),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }),
    );
    bobMesh.castShadow = true;
    this.tipMat = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff7a10, emissiveIntensity: 0.3, roughness: 0.3 });
    this.tipMat.name = 'floatTip';
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.075, 8).translate(0, 0.335, 0), this.tipMat);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.372, 0), this.tipMat);
    this.bobber.add(bobMesh, tip, cap);
    this.bobber.scale.setScalar(1.7);

    // Ripple rings (shader: soft ring at radius r, fading).
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uAge: { value: 0 }, uAlpha: { value: 1 }, uSky: globalUniforms.uSkyColor, uSun: globalUniforms.uSunColor },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uAge; uniform float uAlpha; uniform vec3 uSky; uniform vec3 uSun;
          void main(){
            float r = length(vUv - 0.5) * 2.0;
            float rr = uAge * 0.92;
            float ring = smoothstep(0.07, 0.0, abs(r - rr)) + 0.55 * smoothstep(0.05, 0.0, abs(r - rr * 0.62)) * step(0.2, uAge);
            float a = ring * (1.0 - uAge) * uAlpha * smoothstep(1.0, 0.92, r);
            vec3 c = mix(uSky, vec3(1.0), 0.65) + uSun * 0.25;
            gl_FragColor = vec4(c, a * 0.8);
          }`,
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.visible = false;
      m.renderOrder = 4;
      this.ripples.push({ mesh: m, mat, age: 1, life: 1, size: 1 });
      this.group.add(m);
    }

    // Cast reticle: soft double ring + 4 ticks, pulsing; red over dry land.
    this.reticleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { uT: globalUniforms.uTime, uPower: { value: 0 }, uBad: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uT; uniform float uPower; uniform float uBad; uniform float uAlpha;
        void main(){
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float pulse = 0.5 + 0.5 * sin(uT * 7.0);
          float ring = smoothstep(0.06, 0.0, abs(r - 0.82 - pulse * 0.04));
          float inner = smoothstep(0.045, 0.0, abs(r - 0.34)) * 0.7;
          float a = atan(d.y, d.x) + uT * 0.8;
          float ticks = smoothstep(0.12, 0.0, abs(r - 0.6)) * smoothstep(0.9, 0.97, abs(cos(a * 2.0)));
          float glow = smoothstep(1.0, 0.0, r) * 0.18;
          float v = max(max(ring, inner), ticks) + glow;
          vec3 good = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.82, 0.3), smoothstep(0.85, 1.0, uPower));
          vec3 c = mix(good, vec3(1.0, 0.4, 0.3), uBad);
          gl_FragColor = vec4(c, v * uAlpha * smoothstep(1.0, 0.94, r));
        }`,
    });
    this.reticle = new THREE.Mesh(ringGeo, this.reticleMat);
    this.reticle.name = 'cast-reticle';
    this.reticle.visible = false;
    this.reticle.renderOrder = 6;
    this.group.add(this.reticle);

    // Foam discs (splash aftermath: a white, broken patch that spreads and fizzes out).
    const foamGeo = new THREE.PlaneGeometry(1, 1);
    foamGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uAge: { value: 1 }, uSeed: { value: i * 7.3 }, uSky: globalUniforms.uSkyColor, uSun: globalUniforms.uSunColor },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uAge; uniform float uSeed; uniform vec3 uSky; uniform vec3 uSun;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          void main(){
            vec2 q = vUv - 0.5;
            float r = length(q) * 2.0;
            float breakup = n(q * 9.0 + uSeed) * 0.6 + n(q * 21.0 - uSeed) * 0.4;
            // A ring of broken lace pushed out by the crown (hollow middle: the water there is churned
            // clear), fizzing apart as it ages; a tiny bright core only for the first couple of frames.
            float rr = 0.35 + uAge * 0.45;
            float ring = smoothstep(0.32, 0.0, abs(r - rr + (breakup - 0.5) * 0.25));
            float lace = smoothstep(0.42 + uAge * 0.4, 0.62 + uAge * 0.3, breakup);
            float core = smoothstep(0.45, 0.0, r) * smoothstep(0.1, 0.0, uAge);
            float a = (ring * lace * 0.62 + ring * 0.12 + core * 0.85) * (1.0 - uAge) * smoothstep(1.0, 0.85, r);
            vec3 c = vec3(0.97, 0.99, 1.0) * (0.72 + uSun * 0.25) + uSky * 0.1;
            gl_FragColor = vec4(c, a);
          }`,
      });
      const m = new THREE.Mesh(foamGeo, mat);
      m.visible = false;
      m.renderOrder = 4;
      this.foam.push({ mesh: m, mat, age: 1, size: 1 });
      this.group.add(m);
    }

    // Crown sheets (splash): an open, flaring cylinder of thin water, ragged at the rim, translucent.
    const crownGeo = new THREE.CylinderGeometry(1, 0.55, 1, 20, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uAge: { value: 1 }, uSeed: { value: 0 }, uSky: globalUniforms.uSkyColor, uSun: globalUniforms.uSunColor },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uAge; uniform float uSeed; uniform vec3 uSky; uniform vec3 uSun;
          float h(float x){ return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
          float n(float x){ float i = floor(x); float f = fract(x); f = f*f*(3.0-2.0*f); return mix(h(i), h(i + 1.0), f); }
          void main(){
            // Ragged rim: spikes where the sheet tears into droplets.
            // (Broad tears, a soft body: a few big spikes read as a crown, many thin ones as a coil.)
            float rim = 0.5 + 0.5 * (n(vUv.x * 9.0) * 0.75 + n(vUv.x * 19.0) * 0.25);
            float body = smoothstep(rim, rim - 0.3, vUv.y);
            float thin = smoothstep(0.0, 0.5, vUv.y) * 0.7 + 0.15;
            float a = body * thin * pow(1.0 - uAge, 1.6) * (0.6 + 0.4 * n(vUv.x * 6.0 + 3.0));
            vec3 c = mix(uSky, vec3(1.0), 0.7) * (0.8 + uSun * 0.2);
            gl_FragColor = vec4(c, a * 0.42);
          }`,
      });
      const m = new THREE.Mesh(crownGeo, mat);
      m.visible = false;
      m.renderOrder = 5;
      m.frustumCulled = false;
      this.crowns.push({ mesh: m, mat, age: 1, size: 1 });
      this.group.add(m);
    }

    // Fish shadow (a dark soft ellipse below the surface).
    const sc = document.createElement('canvas');
    sc.width = 128;
    sc.height = 64;
    const sg = sc.getContext('2d')!;
    const rg = sg.createRadialGradient(56, 32, 2, 56, 32, 40);
    rg.addColorStop(0, 'rgba(8,24,32,0.9)');
    rg.addColorStop(1, 'rgba(8,24,32,0)');
    sg.fillStyle = rg;
    sg.beginPath();
    sg.ellipse(56, 32, 44, 16, 0, 0, Math.PI * 2);
    sg.fill();
    sg.beginPath();
    sg.moveTo(92, 32);
    sg.lineTo(124, 18);
    sg.lineTo(120, 32);
    sg.lineTo(124, 46);
    sg.closePath();
    sg.fillStyle = 'rgba(8,24,32,0.35)';
    sg.fill();
    const stex = new THREE.CanvasTexture(sc);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false, opacity: 0 });
    const sgeo = new THREE.PlaneGeometry(0.9, 0.45);
    sgeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sgeo, this.shadowMat);
    this.shadow.renderOrder = 1;

    // Catch "glory": a slowly turning sunburst behind the fish held overhead.
    const gc = document.createElement('canvas');
    gc.width = gc.height = 256;
    const gg = gc.getContext('2d')!;
    gg.translate(128, 128);
    for (let i = 0; i < 18; i++) {
      gg.rotate((Math.PI * 2) / 18);
      const w = i % 2 ? 7 : 13;
      const len = i % 2 ? 100 : 126;
      const lg = gg.createLinearGradient(0, 0, 0, -len);
      lg.addColorStop(0, 'rgba(255,236,190,0.5)');
      lg.addColorStop(1, 'rgba(255,214,140,0)');
      gg.fillStyle = lg;
      gg.beginPath();
      gg.moveTo(-2, 0);
      gg.lineTo(-w, -len);
      gg.lineTo(w, -len);
      gg.lineTo(2, 0);
      gg.closePath();
      gg.fill();
    }
    const rg2 = gg.createRadialGradient(0, 0, 0, 0, 0, 120);
    rg2.addColorStop(0, 'rgba(255,244,215,0.6)');
    rg2.addColorStop(0.3, 'rgba(255,220,150,0.25)');
    rg2.addColorStop(1, 'rgba(255,200,110,0)');
    gg.fillStyle = rg2;
    gg.fillRect(-128, -128, 256, 256);
    const gtex = new THREE.CanvasTexture(gc);
    gtex.colorSpace = THREE.SRGBColorSpace;
    // Tone-mapped and kept under the bloom threshold: a soft warm glow, never a white blowout that
    // bleeds (bloom) across the farmer's face or washes the posts behind into ghosts.
    this.gloryMat = new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false, toneMapped: true });
    this.glory = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.gloryMat);
    this.glory.castShadow = false;
    this.glory.receiveShadow = false;
    this.glory.frustumCulled = false;
    this.glory.renderOrder = 7;
    this.glory.visible = false;
    this.glory.userData.noAO = true;

    this.fx.object.userData.perfTag = 'fishing';
    this.heldRoot.name = 'held-fish';
    this.group.add(this.rod, this.rodLine, this.grip, this.line, this.bobber, this.shadow, this.fx.object, this.heldRoot, this.glory);
    this.setRodVisible(false);
    this.bobber.visible = false;
    this.line.visible = false;
  }

  setRodVisible(v: boolean): void {
    this.rod.visible = v;
    this.rodLine.visible = v;
    this.grip.visible = v;
  }

  /** Blank colours per rod tier (0 bamboo, 1 fiberglass, 2 iridium). */
  setRodTier(tier: number): void {
    const k = THREE.MathUtils.clamp(Math.round(tier), 0, ROD_LOOKS.length - 1);
    if (k === this.rodTier) return;
    this.rodTier = k;
    const look = ROD_LOOKS[k]!;
    const blank = new THREE.Color(look.blank);
    const node = new THREE.Color(look.node);
    const wrap = new THREE.Color(look.wrap);
    const col = this.rodGeo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i <= ROD_SEG; i++) {
      // Bamboo nodes / guide wraps every few segments, a coloured tip.
      const c = i >= ROD_SEG - 1 ? wrap : i % 3 === 0 ? node : blank.clone().multiplyScalar(0.92 + 0.12 * Math.sin(i * 1.7));
      for (let j = 0; j < ROD_SIDES; j++) c.toArray(col.array as Float32Array, (i * ROD_SIDES + j) * 3);
    }
    col.needsUpdate = true;
  }

  get rodVisible(): boolean {
    return this.rod.visible;
  }

  /** Rebuild the bent blank for this frame; updates `tip`. */
  poseRod(p: RodPose): void {
    const pos = this.rodGeo.attributes.position as THREE.BufferAttribute;
    const nor = this.rodGeo.attributes.normal as THREE.BufferAttribute;
    const opos = this.rodLineGeo.attributes.position as THREE.BufferAttribute;
    const dir = _a.copy(p.dir).normalize();
    // Bend: the blank curves (quadratically along its length) towards the line direction.
    const toward = _b.copy(p.bendTo).sub(p.hand).normalize();
    const perp = toward.sub(_c.copy(dir).multiplyScalar(toward.dot(dir)));
    const bendAmt = p.bend * ROD_LEN * 0.55;
    const side = _d.crossVectors(dir, _up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const pts = _rodPts;
    for (let i = 0; i <= ROD_SEG; i++) {
      const s = i / ROD_SEG;
      pts[i]!.copy(p.hand).addScaledVector(dir, s * ROD_LEN * (1 - p.bend * 0.2 * s)).addScaledVector(perp, bendAmt * s * s);
    }
    this.tip.copy(pts[ROD_SEG]!);
    const t = _e;
    const n1 = _b;
    const n2 = _c;
    for (let i = 0; i <= ROD_SEG; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(ROD_SEG, i + 1)]!;
      t.subVectors(b, a).normalize();
      n1.crossVectors(t, side).normalize();
      n2.crossVectors(t, n1).normalize();
      const r = THREE.MathUtils.lerp(ROD_R0, ROD_R1, Math.pow(i / ROD_SEG, 0.85)) * (i % 3 === 0 && i < ROD_SEG ? 1.22 : 1);
      const ro = r + 0.0065;
      for (let j = 0; j < ROD_SIDES; j++) {
        const ang = (j / ROD_SIDES) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nx = n1.x * ca + n2.x * sa;
        const ny = n1.y * ca + n2.y * sa;
        const nz = n1.z * ca + n2.z * sa;
        const k = i * ROD_SIDES + j;
        const P = pts[i]!;
        pos.setXYZ(k, P.x + nx * r, P.y + ny * r, P.z + nz * r);
        opos.setXYZ(k, P.x + nx * ro, P.y + ny * ro, P.z + nz * ro);
        nor.setXYZ(k, nx, ny, nz);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    opos.needsUpdate = true;
    this.rodGeo.computeBoundingSphere();
    // Grip aligned with the blank at the hand, reel hanging on the underside.
    const Y = _a.copy(p.dir).normalize();
    const Z = _b.copy(_up).addScaledVector(Y, -Y.dot(_up));
    if (Z.lengthSq() < 1e-4) Z.set(0, 0, 1);
    Z.normalize();
    const X = _c.crossVectors(Y, Z).normalize();
    _m.makeBasis(X, Y, Z);
    this.grip.position.copy(p.hand);
    this.grip.quaternion.setFromRotationMatrix(_m);
    this.reelHandle.parent!.rotation.x = p.crank;
  }

  /** Reset the rope as a straight line from the tip to `end` (on cast). */
  resetLine(end: THREE.Vector3): void {
    for (let i = 0; i < LINE_N; i++) {
      this.pts[i]!.lerpVectors(this.tip, end, i / (LINE_N - 1));
      this.prev[i]!.copy(this.pts[i]!);
    }
  }

  /**
   * Verlet rope between the rod tip and the bobber; lays on the water surface. Distance constraints
   * + a bending constraint (node i ↔ i+2, stiffness 0.3) keep it a smooth catenary; the water is a
   * floor with friction (a node that touches it loses its sideways drift), so a slack line settles
   * into a lazy curve instead of piling up in a zig-zag by the float.
   */
  updateLine(dt: number, end: THREE.Vector3, camera: THREE.Camera): void {
    const n = LINE_N;
    const pts = this.pts;
    const straight = this.tip.distanceTo(end);
    // Only a touch of spare line (more piles up on the water as scribble).
    const rest = (straight / (n - 1)) * (1 + this.slack * 0.035);
    const g = -9.8 * dt * dt;
    const floor = this.waterY + 0.006;
    // The last few nodes rise smoothly to the float's eye (no V-kink where the line leaves the water).
    const rise = Math.max(0, end.y - floor);
    const floorAt = (i: number): number => (i >= n - 6 ? floor + rise * ((i - (n - 6)) / 5) ** 2.2 : floor);
    for (let i = 1; i < n - 1; i++) {
      const p = pts[i]!;
      const q = this.prev[i]!;
      const onWater = p.y <= floor + 0.002;
      const damp = onWater ? 0.6 : 0.96;
      const vx = (p.x - q.x) * damp;
      const vy = (p.y - q.y) * 0.96;
      const vz = (p.z - q.z) * damp;
      q.copy(p);
      p.x += vx;
      p.y += vy + g * (0.35 + this.slack * 0.65);
      p.z += vz;
    }
    pts[0]!.copy(this.tip);
    pts[n - 1]!.copy(end);
    for (let it = 0; it < 16; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        _a.subVectors(b, a);
        const d = _a.length() || 1e-6;
        const diff = (d - rest) / d;
        const wa = i === 0 ? 0 : 0.5;
        const wb = i + 1 === n - 1 ? 0 : 0.5;
        const k = wa + wb || 1;
        a.addScaledVector(_a, (diff * wa) / k);
        b.addScaledVector(_a, (-diff * wb) / k);
      }
      // Bending: pull each node towards the midpoint of its neighbours (no kinks, no zig-zags).
      if (it % 2 === 0) {
        for (let i = 1; i < n - 1; i++) {
          _b.addVectors(pts[i - 1]!, pts[i + 1]!).multiplyScalar(0.5);
          pts[i]!.lerp(_b, 0.3);
        }
      }
      // Float on the water.
      for (let i = 1; i < n - 1; i++) {
        const f = floorAt(i);
        if (pts[i]!.y < f) pts[i]!.y = f;
      }
      pts[n - 1]!.copy(end);
    }
    // Ease the nodes towards a clean catenary between tip and float so the rod's shake never leaves
    // kinks in it (the part that reaches the water lies along the surface, straight to the float).
    if (this.ease > 0) {
      const sag = straight * (0.03 + this.slack * 0.1);
      // A slack line also bows sideways in the breeze, so the curve reads from the steep play
      // camera (a vertical sag alone is invisible from above).
      _d.subVectors(pts[n - 1]!, pts[0]!).setY(0);
      _e.set(-_d.z, 0, _d.x);
      if (_e.lengthSq() > 1e-6) _e.normalize();
      const bow = straight * this.slack * 0.075;
      const k = this.ease;
      for (let i = 1; i < n - 1; i++) {
        const t = i / (n - 1);
        _a.lerpVectors(pts[0]!, pts[n - 1]!, t);
        _a.y -= sag * 4 * t * (1 - t);
        _a.addScaledVector(_e, bow * 4 * t * (1 - t) * (1 - t * 0.4));
        if (_a.y < floorAt(i)) _a.y = floorAt(i);
        pts[i]!.lerp(_a, k);
      }
    }
    // Render copy, smoothed (a few Laplacian passes): where the hanging line touches down on the
    // water it bends round in a soft curve instead of a hard corner. The sim nodes stay untouched.
    const rp = this.renderPts;
    for (let i = 0; i < n; i++) rp[i]!.copy(pts[i]!);
    const lo = this.waterY + 0.004;
    for (let it = 0; it < 5; it++) {
      for (let i = 1; i < n - 1; i++) {
        _b.addVectors(rp[i - 1]!, rp[i + 1]!).multiplyScalar(0.5);
        rp[i]!.lerp(_b, 0.5);
        if (rp[i]!.y < lo) rp[i]!.y = lo;
      }
    }
    // A taut line hums: a fast standing-wave quiver across its span (hidden in the slack case).
    const vib0 = this.vibrate;
    if (this.twang > 0) {
      this.vibrate += this.twang * 0.05;
      this.twang = Math.max(0, this.twang - dt * 3.2);
    }
    if (this.vibrate > 0) {
      const ph = performance.now() * 0.001;
      _d.subVectors(rp[n - 1]!, rp[0]!).normalize();
      _e.crossVectors(_d, _up).normalize();
      for (let i = 1; i < n - 1; i++) {
        const k = i / (n - 1);
        const amp = this.vibrate * Math.sin(k * Math.PI) * (Math.sin(ph * 71 + k * 3) * 0.7 + Math.sin(ph * 113 - k * 7) * 0.3);
        rp[i]!.addScaledVector(_e, amp).y += amp * 0.6;
      }
    }
    this.vibrate = vib0;
    // Ribbon facing the camera: ≈ 2 px at 720p, ≈ 3 px at 1080p (dark core, pale halo), never bright
    // enough to bloom.
    const pos = this.lineGeo.attributes.position as THREE.BufferAttribute;
    const camPos = camera.position;
    const w = 0.0062;
    _d.setFromMatrixColumn(camera.matrixWorld, 1);
    for (let i = 0; i < n; i++) {
      const a = rp[Math.max(0, i - 1)]!;
      const b = rp[Math.min(n - 1, i + 1)]!;
      _a.subVectors(b, a).normalize();
      _b.subVectors(camPos, rp[i]!).normalize();
      _c.crossVectors(_a, _b).normalize().multiplyScalar(w * (1 + camPos.distanceTo(rp[i]!) * 0.06));
      const P = rp[i]!;
      const sh = _c.length() * 1.15;
      const sx = P.x - _d.x * sh;
      const sy = P.y - _d.y * sh;
      const sz = P.z - _d.z * sh;
      pos.setXYZ(i * 4, sx + _c.x, sy + _c.y, sz + _c.z);
      pos.setXYZ(i * 4 + 1, sx - _c.x, sy - _c.y, sz - _c.z);
      pos.setXYZ(i * 4 + 2, P.x + _c.x, P.y + _c.y, P.z + _c.z);
      pos.setXYZ(i * 4 + 3, P.x - _c.x, P.y - _c.y, P.z - _c.z);
    }
    pos.needsUpdate = true;
    this.line.visible = this.lineVisible;
  }

  ripple(p: THREE.Vector3, size = 1, life = 1.4): void {
    const r = this.ripples.reduce((best, x) => (x.age / x.life > best.age / best.life ? x : best), this.ripples[0]!);
    r.age = 0;
    r.life = life;
    r.size = size;
    r.mesh.position.set(p.x, this.waterY + 0.012, p.z);
    r.mesh.visible = true;
  }

  /**
   * A splash: a crown of droplets thrown up and out on a ring (gravity brings them back down), a short-
   * lived translucent crown sheet, a thin spout of spray on a big one, then a ring of broken foam and
   * expanding ripples. Nothing opaque sits on the water for more than a couple of frames.
   */
  splash(p: THREE.Vector3, big = false): void {
    const at = _e.set(p.x, this.waterY + 0.02, p.z);
    const n = big ? 22 : 12;
    const r0 = big ? 0.13 : 0.08;
    const ph = Math.random() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      _d.set(at.x + dx * r0, at.y + 0.03, at.z + dz * r0);
      this.fx.emitDir(_d, dx * 0.55, dz * 0.55, { color: i % 3 ? 0xe8f6fb : 0xffffff, count: 1, speed: (big ? 2.1 : 1.45) * (0.8 + Math.random() * 0.45), size: big ? 0.05 : 0.038, gravity: 9.8, life: big ? 0.62 : 0.48 });
    }
    // A finer mist of droplets inside the crown.
    this.fx.emit(at, { color: 0xd8eef6, count: big ? 10 : 5, speed: big ? 1.3 : 0.8, size: 0.03, gravity: 9.8, life: 0.45, up: 1.5, spread: r0 });
    if (big) {
      // The spout: a few heavier drops straight up from the middle (the fish's tail kick).
      this.fx.emit(at, { color: 0xf4fbff, count: 7, speed: 1.15, size: 0.06, gravity: 9.8, life: 0.75, up: 2.3, spread: 0.05 });
    }
    this.crown(p, big ? 1 : 0.62);
    this.foamDisc(p, big ? 1.25 : 0.6);
    this.ripple(p, big ? 2.4 : 1.2, big ? 1.6 : 1.2);
    if (big) this.ripple(p, 1.3, 1.0);
  }

  /** The splash's crown sheet: a thin translucent lip that rises, flares out and collapses in ~0.35 s. */
  private crown(p: THREE.Vector3, size: number): void {
    const c = this.crowns.reduce((best, x) => (x.age > best.age ? x : best), this.crowns[0]!);
    c.age = 0;
    c.size = size;
    c.mesh.position.set(p.x, this.waterY, p.z);
    c.mesh.rotation.y = Math.random() * 6.28;
    c.mat.uniforms.uSeed!.value = Math.random() * 40;
    c.mesh.visible = true;
  }

  /** A patch of white foam on the water that breaks up and fades (splash aftermath). */
  foamDisc(p: THREE.Vector3, size: number): void {
    const f = this.foam.reduce((best, x) => (x.age > best.age ? x : best), this.foam[0]!);
    f.age = 0;
    f.size = size;
    f.mesh.position.set(p.x, this.waterY + 0.015, p.z);
    f.mesh.rotation.y = Math.random() * 6.28;
    f.mesh.visible = true;
  }

  /** Predicted landing point while charging (null hides); `bad` = it would land on dry ground. */
  setReticle(p: THREE.Vector3 | null, power = 0, bad = false, dt = 0): void {
    const u = this.reticleMat.uniforms;
    const target = p ? 1 : 0;
    u.uAlpha!.value += (target - u.uAlpha!.value) * Math.min(1, dt * 10 || 1);
    this.reticle.visible = u.uAlpha!.value > 0.02;
    if (!p) return;
    this.reticle.position.set(p.x, p.y + 0.03, p.z);
    const s = 0.9 + power * 0.9;
    this.reticle.scale.set(s, 1, s);
    u.uPower!.value = power;
    u.uBad!.value = bad ? 1 : 0;
  }

  /** Fish shadow near the bobber (0 = hidden). */
  setShadow(p: THREE.Vector3 | null, alpha: number, yaw = 0): void {
    this.shadowMat.opacity = p ? alpha * 0.55 : 0;
    this.shadow.visible = !!p && alpha > 0.01;
    if (p) {
      this.shadow.position.set(p.x, this.waterY - 0.18, p.z);
      this.shadow.rotation.y = yaw;
    }
  }

  /** Sunburst behind `pos` (pushed away from the camera); null hides it. */
  setGlory(pos: THREE.Vector3 | null, camera: THREE.Camera, alpha: number, t: number, size = 2.6): void {
    this.glory.visible = !!pos && alpha > 0.01;
    if (!pos || !this.glory.visible) return;
    _a.copy(pos).sub(camera.position).normalize();
    // Well behind the farmer (so the body, hat and the near rail always occlude it), scaled up by the
    // same ratio so it keeps its apparent size round the fish.
    const d0 = pos.distanceTo(camera.position);
    const push = 2.6;
    this.glory.position.copy(pos).addScaledVector(_a, push);
    size *= (d0 + push) / Math.max(1, d0);
    this.glory.scale.setScalar(size * (0.96 + 0.04 * Math.sin(t * 3)));
    this.glory.quaternion.copy(camera.quaternion);
    this.glory.rotateZ(t * 0.35);
    this.gloryMat.opacity = alpha;
  }

  /**
   * Turn the held fish squarely to the camera: flank facing the eye, head screen-left, back up (a true
   * billboard, so the steep play camera never sees it edge-on as a sliver), plus a `roll` wiggle.
   */
  faceHeld(camera: THREE.Camera, roll: number): void {
    camera.updateMatrixWorld();
    const X = _a.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const Z = _b.copy(camera.position).sub(this.heldRoot.position).normalize();
    const Y = _c.crossVectors(Z, X).normalize();
    X.crossVectors(Y, Z).normalize();
    _m.makeBasis(X, Y, Z);
    this.heldRoot.quaternion.setFromRotationMatrix(_m);
    this.heldRoot.rotateZ(roll);
  }

  /**
   * Hang the held fish from a fist by the tail (the wrist of the tail fin in the hand, head down,
   * flank squarely to the camera), swinging by `sway` (rad). Writes the fish's middle to `out`.
   */
  hangHeld(fist: THREE.Vector3, camera: THREE.Camera, sway: number, out: THREE.Vector3): THREE.Vector3 {
    const r = this.heldRoot;
    r.position.copy(fist);
    this.faceHeld(camera, Math.PI / 2 + sway);
    // Peduncle (mesh x = +0.3, head at -0.5) sits in the fist; a touch towards the lens so the body
    // hangs in front of the farmer's side, never through it.
    const s = r.scale.x * (this.held?.mesh.group.scale.x ?? 1);
    _a.set(0.3 * s, 0, 0).applyQuaternion(r.quaternion);
    _b.copy(camera.position).sub(fist).normalize();
    // (Just behind the fist, so the hand reads as gripping the tail wrist, not hidden by the fin.)
    r.position.sub(_a).addScaledVector(_b, -0.05);
    return out.copy(r.position);
  }

  /** Show a fish held above the head (null to hide). */
  hold(def: FishDef | null, lengthCm = 40): void {
    if (this.held) this.heldRoot.remove(this.held.mesh.group);
    this.held = null;
    if (!def) return;
    let mesh = this.meshCache.get(def.id);
    if (!mesh) {
      mesh = buildFishMesh(def);
      this.meshCache.set(def.id, mesh);
    }
    mesh.group.scale.setScalar(heldFishScale(def, lengthCm));
    this.heldRoot.add(mesh.group);
    this.held = { def, mesh };
  }

  update(dt: number, t: number, h: number): void {
    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.age += dt / r.life;
      if (r.age >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const s = r.size * (0.35 + r.age * 1.1);
      r.mesh.scale.set(s, 1, s);
      r.mat.uniforms.uAge!.value = r.age;
    }
    for (const f of this.foam) {
      if (!f.mesh.visible) continue;
      f.age += dt / 1.1;
      if (f.age >= 1) {
        f.mesh.visible = false;
        continue;
      }
      const s = f.size * (0.7 + Math.sqrt(f.age) * 0.6);
      f.mesh.scale.set(s, 1, s);
      f.mat.uniforms.uAge!.value = f.age;
    }
    for (const c of this.crowns) {
      if (!c.mesh.visible) continue;
      c.age += dt / 0.36;
      if (c.age >= 1) {
        c.mesh.visible = false;
        continue;
      }
      // Rises fast, flares out, then slumps back into the water.
      const k = c.age;
      const r = c.size * (0.1 + 0.26 * Math.sqrt(k));
      const ht = c.size * 0.42 * Math.sin(Math.min(1, k * 1.25) * Math.PI) + 0.01;
      c.mesh.scale.set(r, ht, r);
      c.mat.uniforms.uAge!.value = k;
    }
    this.fx.update(dt, h);
    // Faint pulse (never a bloom spike: 0.2–0.4, up to ~1 on a bite flash).
    this.tipFlash = Math.max(0, this.tipFlash - dt * 1.5);
    this.tipMat.emissiveIntensity = 0.3 + Math.sin(t * 3.2) * 0.1 + this.tipFlash * 0.6;
    // (Held by the tail: a wriggle, not a curl — a curled fish loses the length the card states.)
    if (this.held) this.held.mesh.flex(t, 0.3 + 0.2 * Math.sin(t * 3));
  }
}
