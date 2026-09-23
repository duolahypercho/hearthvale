/**
 * Farming "juice" VFX — everything the tools and harvests throw into the world:
 *   Chunks   instanced 3D debris with real bounces: soil clods, stone chips, wood chips, seeds
 *   Leaves   instanced flutter leaves / grass clippings (drag + spin + sway)
 *   Drops    instanced water droplets stretched along their velocity; land → ring + mist
 *   Rings    additive expanding ripples (water landing, hoe impact shock ring, harvest pop)
 *   Puffs    soft sprite points: dust clouds, mist, sparkles / glints (two blend modes)
 *   Swing    motion smear ribbon behind a swinging tool head
 *   Pops     produce meshes that leap out of the soil in an arc (harvest), with a quality star
 * About 8 draw calls total; everything is pooled (no per-frame allocation).
 *
 *   const fx = new FarmFX((x, z) => groundY);  scene.add(fx.group);  fx.update(dt, camera, viewportH)
 */
import * as THREE from 'three';
import { textures } from '../../render/textures';
import { Rng } from '../../core/rng';
import { lumpySphere } from '../geom';

export type GroundFn = (x: number, z: number) => number;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** Cosmetic randomness, seeded so staged demos replay identically. */
const fxr = new Rng('farmfx');
const rnd = (a: number, b: number): number => a + fxr.next() * (b - a);

// ───────────────────────────────────────────── soft sprite points

const PTS_VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / -mvPosition.z;
  vAlpha = aAlpha;
  vColor = aColor;
  #include <fog_vertex>
}`;
const PTS_FS = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor, t.a * vAlpha);
  if (gl_FragColor.a < 0.004) discard;
  #include <fog_fragment>
}`;

class Puffs {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private next = 0;
  private live = 0;
  private mat: THREE.ShaderMaterial;

  constructor(readonly n: number, map: THREE.Texture, additive: boolean) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(99);
    this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: map }, uScale: { value: 1600 } }]),
      vertexShader: PTS_VS,
      fragmentShader: PTS_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: { color: number | THREE.Color; size: number; grow?: number; life: number; alpha?: number; gravity?: number; drag?: number }): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    const c = o.color instanceof THREE.Color ? o.color : _c.set(o.color);
    this.color.set([c.r, c.g, c.b], i * 3);
    this.age[i] = 0;
    this.life[i] = o.life;
    this.s0[i] = o.size;
    this.s1[i] = o.size * (o.grow ?? 1);
    this.a0[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 1.5;
    this.live = Math.max(this.live, 1);
  }

  clear(): void {
    this.age.fill(99);
    this.alpha.fill(0);
    this.points.visible = false;
  }

  update(dt: number, viewportH: number): void {
    this.mat.uniforms.uScale!.value = viewportH * 1.6;
    let any = 0;
    for (let i = 0; i < this.n; i++) {
      const a = (this.age[i]! += dt);
      const t = a / this.life[i]!;
      if (t >= 1) {
        this.alpha[i] = 0;
        continue;
      }
      any++;
      const k = Math.exp(-this.drag[i]! * dt);
      this.vel[i * 3]! *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * k - this.grav[i]! * dt;
      this.vel[i * 3 + 2]! *= k;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      const e = 1 - Math.pow(1 - t, 2);
      this.size[i] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * e;
      this.alpha[i] = this.a0[i]! * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
    }
    this.live = any;
    const g = this.points.geometry;
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor']) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    this.points.visible = any > 0;
  }
}

// ───────────────────────────────────────────── instanced physical debris

interface Body {
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: THREE.Vector3;
  age: number;
  life: number;
  gravity: number;
  drag: number;
  bounce: number;
  rest: boolean;
  flutter: number;
  active: boolean;
}

class Bodies {
  readonly mesh: THREE.InstancedMesh;
  private bodies: Body[] = [];
  private next = 0;
  private live = 0;

  constructor(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    readonly n: number,
    private ground: GroundFn,
    name: string,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, material, n);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, _c.set(0xffffff));
      this.bodies.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), age: 0, life: 1, gravity: 9, drag: 0.3, bounce: 0.3, rest: false, flutter: 0, active: false });
    }
    this.mesh.count = n;
    this.mesh.visible = false;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, o: { color: number | THREE.Color; size: number; life?: number; gravity?: number; drag?: number; bounce?: number; flutter?: number; flat?: number; spin?: number }): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const b = this.bodies[i]!;
    b.p.copy(p);
    b.v.copy(v);
    b.rot.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28));
    const sp = o.spin ?? 12;
    b.spin.set(rnd(-sp, sp), rnd(-sp, sp), rnd(-sp, sp));
    const s = o.size * rnd(0.7, 1.3);
    b.scale.set(s, s * (o.flat ?? rnd(0.6, 1)), s * rnd(0.8, 1.2));
    b.age = 0;
    b.life = (o.life ?? 1.6) * rnd(0.8, 1.25);
    b.gravity = o.gravity ?? 9.5;
    b.drag = o.drag ?? 0.3;
    b.bounce = o.bounce ?? 0.32;
    b.flutter = o.flutter ?? 0;
    b.rest = false;
    b.active = true;
    const c = o.color instanceof THREE.Color ? o.color : _c.set(o.color);
    this.mesh.setColorAt(i, _c.copy(c).multiplyScalar(rnd(0.85, 1.12)));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.live++;
    this.mesh.visible = true;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) {
      this.bodies[i]!.active = false;
      this.mesh.setMatrixAt(i, HIDDEN);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = false;
  }

  update(dt: number, t: number): void {
    if (!this.mesh.visible) return;
    let any = 0;
    for (let i = 0; i < this.n; i++) {
      const b = this.bodies[i]!;
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) {
        b.active = false;
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      any++;
      if (!b.rest) {
        const k = Math.exp(-b.drag * dt);
        b.v.x *= k;
        b.v.z *= k;
        b.v.y = b.v.y * k - b.gravity * dt;
        if (b.flutter) {
          // Leaves: side-to-side pendulum drift while falling.
          const w = Math.sin(t * 6 + i) * b.flutter;
          b.p.x += w * dt;
          b.p.z += Math.cos(t * 5 + i * 1.7) * b.flutter * 0.6 * dt;
        }
        b.p.addScaledVector(b.v, dt);
        b.rot.x += b.spin.x * dt;
        b.rot.y += b.spin.y * dt;
        b.rot.z += b.spin.z * dt;
        const gy = this.ground(b.p.x, b.p.z) + b.scale.y * 0.5;
        if (b.p.y < gy) {
          b.p.y = gy;
          if (Math.abs(b.v.y) > 0.9 && b.bounce > 0) {
            b.v.y = -b.v.y * b.bounce;
            b.v.x *= 0.55;
            b.v.z *= 0.55;
            b.spin.multiplyScalar(0.5);
          } else {
            b.rest = true;
            b.v.set(0, 0, 0);
            if (b.flutter) b.rot.x = b.rot.z = 0;
          }
        }
      }
      // Shrink away over the last 25 % of life (sinks into the soil).
      const f = THREE.MathUtils.smoothstep(b.age / b.life, 0.72, 1);
      _s.copy(b.scale).multiplyScalar(1 - f);
      _q.setFromEuler(b.rot);
      _v.copy(b.p);
      _v.y -= f * b.scale.y * 0.5;
      this.mesh.setMatrixAt(i, _m.compose(_v, _q, _s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = any;
    if (!any) this.mesh.visible = false;
  }
}

// ───────────────────────────────────────────── droplets (velocity-stretched streaks)

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: number;
  age: number;
  active: boolean;
  /** Spawn a tiny splash crown where it lands. */
  crown: boolean;
}

const STREAK_VS = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec2 aSize;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec3 axis = length(aVel) > 1e-4 ? normalize(aVel) : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - aPos);
  vec3 side = cross(axis, toCam);
  side = length(side) > 1e-4 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  vec3 wp = aPos + side * position.x * aSize.x + axis * position.y * aSize.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = position.xy;
  vAlpha = aAlpha;
  #include <fog_vertex>
}`;
const STREAK_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHi;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  // Capsule: soft across the width, tapering tail (behind the head at +y).
  float across = 1.0 - smoothstep(0.35, 1.0, abs(vUv.x) * 2.0);
  float along = smoothstep(-0.5, 0.1, vUv.y) * (1.0 - smoothstep(0.38, 0.5, vUv.y));
  float a = across * along * vAlpha;
  if (a < 0.01) discard;
  // Bright core line + bluish body (no emissive: stays under the bloom threshold).
  vec3 c = mix(uColor, uHi, smoothstep(0.5, 0.0, abs(vUv.x) * 2.0) * smoothstep(-0.2, 0.4, vUv.y));
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Instanced velocity-aligned water streaks (one draw call). */
class Streaks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private geo: THREE.InstancedBufferGeometry;

  constructor(readonly n: number) {
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index;
    g.setAttribute('position', q.attributes.position!);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n * 2);
    this.alpha = new Float32Array(n);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0x9cc8e8) }, uHi: { value: new THREE.Color(0xeef8ff) } }]),
      vertexShader: STREAK_VS,
      fragmentShader: STREAK_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    m.name = 'fx-streak';
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'fx-drops';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** Write the live drops (packed). */
  write(drops: Drop[]): void {
    let k = 0;
    for (const d of drops) {
      if (!d.active) continue;
      const sp = d.v.length();
      this.pos.set([d.p.x, d.p.y, d.p.z], k * 3);
      this.vel.set([d.v.x, d.v.y, d.v.z], k * 3);
      // 3–4× longer than wide at speed; round-ish when slow.
      this.size[k * 2] = d.r * 1.7;
      this.size[k * 2 + 1] = d.r * 1.8 + Math.min(0.2, sp * 0.02);
      this.alpha[k] = 0.62 * Math.min(1, d.age * 30);
      k++;
      if (k >= this.n) break;
    }
    this.geo.instanceCount = k;
    for (const a of ['aPos', 'aVel', 'aSize', 'aAlpha']) {
      const at = this.geo.attributes[a] as THREE.InstancedBufferAttribute;
      at.needsUpdate = true;
      at.clearUpdateRanges();
      at.addUpdateRange(0, k * at.itemSize);
    }
    this.mesh.visible = k > 0;
  }
}

// ───────────────────────────────────────────── ground decals (wet spots, cracks)

const DECAL_VS = /* glsl */ `
attribute float aAlpha;
attribute float aRot;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float c = cos(aRot), s = sin(aRot);
  vUv = mat2(c, -s, s, c) * (uv - 0.5) + 0.5;
  vAlpha = aAlpha;
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const DECAL_FS = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

interface Decal {
  p: THREE.Vector3;
  r: number;
  age: number;
  fadeIn: number;
  life: number;
  alpha: number;
  grow: number;
  active: boolean;
}

/** Flat ground decals with a per-instance fade (one draw call per texture). */
class Decals {
  readonly mesh: THREE.InstancedMesh;
  private list: Decal[] = [];
  private next = 0;
  private alphaA: Float32Array;
  private rotA: Float32Array;
  private live = false;

  constructor(n: number, tex: THREE.Texture, color: number, name: string) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.alphaA = new Float32Array(n);
    this.rotA = new Float32Array(n);
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alphaA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.InstancedBufferAttribute(this.rotA, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: tex }, uColor: { value: new THREE.Color(color) } }]),
      vertexShader: DECAL_VS,
      fragmentShader: DECAL_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    m.name = name;
    this.mesh = new THREE.InstancedMesh(g, m, n);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.list.push({ p: new THREE.Vector3(), r: 1, age: 0, fadeIn: 0.1, life: 1, alpha: 1, grow: 0, active: false });
    }
    this.mesh.visible = false;
  }

  add(p: THREE.Vector3, r: number, o: { life: number; fadeIn?: number; alpha?: number; grow?: number; rot?: number }): void {
    const i = this.next;
    this.next = (this.next + 1) % this.list.length;
    const d = this.list[i]!;
    d.p.copy(p);
    d.r = r;
    d.age = 0;
    d.life = o.life;
    d.fadeIn = o.fadeIn ?? 0.08;
    d.alpha = o.alpha ?? 1;
    d.grow = o.grow ?? 0;
    d.active = true;
    this.rotA[i] = o.rot ?? rnd(0, Math.PI * 2);
    (this.mesh.geometry.attributes.aRot as THREE.BufferAttribute).needsUpdate = true;
    this.live = true;
    this.mesh.visible = true;
  }

  clear(): void {
    for (const d of this.list) d.age = d.life;
  }

  update(dt: number): void {
    if (!this.live) return;
    let any = false;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i]!;
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.active = false;
        this.alphaA[i] = 0;
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      any = true;
      const t = d.age / d.life;
      const a = Math.min(1, d.age / d.fadeIn) * (1 - THREE.MathUtils.smoothstep(t, 0.55, 1));
      this.alphaA[i] = a * d.alpha;
      const r = d.r * (1 + d.grow * (1 - Math.pow(1 - Math.min(1, d.age / 0.3), 3)));
      _s.set(r, 1, r);
      this.mesh.setMatrixAt(i, _m.compose(d.p, _q.identity(), _s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    this.live = any;
    this.mesh.visible = any;
  }
}

function decalTexture(kind: 'wet' | 'crack'): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rng = new Rng(`decal:${kind}`);
  if (kind === 'wet') {
    // Irregular soaked blotch: overlapping soft discs.
    for (let i = 0; i < 9; i++) {
      const x = S / 2 + (rng.next() - 0.5) * S * 0.3;
      const y = S / 2 + (rng.next() - 0.5) * S * 0.3;
      const r = S * (0.18 + rng.next() * 0.14);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)');
      gr.addColorStop(0.7, 'rgba(0,0,0,0.35)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Ground cracks: jagged branching lines out from the centre + a darker bruise.
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.45);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(0,0,0,0.95)';
    g.lineCap = 'round';
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
      let px = x;
      let py = y;
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        a += (rng.next() - 0.5) * 0.9;
        const nx = px + Math.cos(a) * (len / steps);
        const ny = py + Math.sin(a) * (len / steps);
        g.lineWidth = w * (1 - i / steps) + 0.6;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(nx, ny);
        g.stroke();
        if (depth > 0 && rng.next() < 0.35) branch(nx, ny, a + (rng.next() < 0.5 ? 0.9 : -0.9), len * 0.45, w * 0.6, depth - 1);
        px = nx;
        py = ny;
      }
    };
    for (let i = 0; i < 6; i++) branch(S / 2, S / 2, (i / 6) * Math.PI * 2 + rng.next() * 0.6, S * (0.3 + rng.next() * 0.14), 3.2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

// ───────────────────────────────────────────── watering-can stream

const STREAM_N = 18;
const STREAM_R = 6;

/**
 * A continuous stream of water from the can's rose to the ground: a lit, tapered tube along the
 * ballistic arc that grows out of the spout when the pour starts, wobbles while it runs and
 * detaches + falls when it stops (droplets break off its end — see FarmFX.pourStream).
 */
class Stream {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private nor: Float32Array;
  private from = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private T = 0.35;
  private head = 0;
  private tail = 0;
  private on = false;
  private t = 0;

  constructor() {
    const n = (STREAM_N + 1) * (STREAM_R + 1);
    this.pos = new Float32Array(n * 3);
    this.nor = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < STREAM_N; i++) {
      for (let j = 0; j < STREAM_R; j++) {
        const a = i * (STREAM_R + 1) + j;
        const b = a + STREAM_R + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    g.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({ color: 0xc4e6fa, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.82, depthWrite: false, envMapIntensity: 1.8 });
    m.name = 'fx-stream';
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'fx-stream';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** Aim the stream this frame (spout world pos → landing point). */
  aim(from: THREE.Vector3, to: THREE.Vector3, T = 0.34): void {
    this.from.copy(from);
    this.T = T;
    this.vel.set((to.x - from.x) / T, (to.y - from.y) / T + 4.9 * T, (to.z - from.z) / T);
    if (!this.on) {
      this.on = true;
      this.head = 0;
      this.tail = 0;
    }
  }

  stop(): void {
    this.on = false;
  }

  get active(): boolean {
    return this.mesh.visible;
  }

  /** Point on the arc at flight time `s` (0 = spout). */
  at(s: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.from.x + this.vel.x * s, this.from.y + this.vel.y * s - 4.9 * s * s, this.from.z + this.vel.z * s);
  }

  /** Flight time of the stream's leading end (droplets break off here). */
  get end(): number {
    return this.head;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.on) this.head = Math.min(this.T, this.head + dt);
    else this.tail += dt;
    if (!this.on && this.tail >= this.head) {
      this.mesh.visible = false;
      return;
    }
    if (this.head <= 0) return;
    this.mesh.visible = true;
    const s0 = Math.min(this.tail, this.head);
    const s1 = this.head;
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const bin = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= STREAM_N; i++) {
      const u = i / STREAM_N;
      const s = s0 + (s1 - s0) * u;
      this.at(s, p);
      this.at(s + 0.01, q);
      tan.subVectors(q, p).normalize();
      bin.crossVectors(tan, up);
      if (bin.lengthSq() < 1e-6) bin.set(1, 0, 0);
      bin.normalize();
      nrm.crossVectors(bin, tan).normalize();
      // Thick at the rose, thinning as it falls and breaks up; a travelling wobble.
      const r = (0.034 - 0.014 * (s / this.T)) * (1 + 0.18 * Math.sin(this.t * 38 - s * 60)) * (u > 0.94 ? (1 - u) / 0.06 * 0.6 + 0.4 : 1);
      const wob = Math.sin(this.t * 23 + s * 40) * 0.006 * (s / this.T);
      for (let j = 0; j <= STREAM_R; j++) {
        const a = (j / STREAM_R) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const k = (i * (STREAM_R + 1) + j) * 3;
        const ox = bin.x * cx + nrm.x * cy;
        const oy = bin.y * cx + nrm.y * cy;
        const oz = bin.z * cx + nrm.z * cy;
        this.pos[k] = p.x + ox * r + bin.x * wob;
        this.pos[k + 1] = p.y + oy * r;
        this.pos[k + 2] = p.z + oz * r + bin.z * wob;
        this.nor[k] = ox;
        this.nor[k + 1] = oy;
        this.nor[k + 2] = oz;
      }
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ───────────────────────────────────────────── rings

interface Ring {
  p: THREE.Vector3;
  r0: number;
  r1: number;
  age: number;
  life: number;
  color: THREE.Color;
  active: boolean;
}

// ───────────────────────────────────────────── produce pops

export interface PopOpts {
  /** World position the item is thrown to (e.g. above the farmer's head). */
  to: () => THREE.Vector3;
  /** Seconds in flight. */
  flight?: number;
  /** Seconds it hangs at `to` before zipping away. */
  hold?: number;
  /** Quality star colour (null = none). */
  star?: number | null;
  scale?: number;
  onArrive?: () => void;
  onDone?: (pos: THREE.Vector3) => void;
}

interface Pop {
  mesh: THREE.Mesh;
  star: THREE.Sprite | null;
  from: THREE.Vector3;
  opts: PopOpts;
  age: number;
  arrived: boolean;
  spin: number;
}

// ───────────────────────────────────────────── swing smear

const TRAIL_N = 40;

/**
 * Motion smear behind a swinging tool head: a ribbon between an inner and an outer point on the
 * tool, sampled every frame while the swing is live. Alpha fades with age and toward the inner
 * edge, so fast arcs read as a soft crescent (the classic "swoosh" of a hand-drawn swing).
 * One draw call; the ribbon collapses to nothing when idle.
 */
export class SwingTrail {
  readonly mesh: THREE.Mesh;
  private inner: THREE.Vector3[] = [];
  private outer: THREE.Vector3[] = [];
  private age: number[] = [];
  private count = 0;
  private life = 0.16;
  private pos: Float32Array;
  private col: Float32Array;
  private tint = new THREE.Color(0xfff6e0);
  private strength = 1;
  /** Camera view direction (world). Edge-on smears (swings toward / away from the camera) fade out
   *  so they never read as a stripe across the farmer's face. */
  readonly view = new THREE.Vector3(0, -1, 0);
  private n = new THREE.Vector3();
  private e = new THREE.Vector3();
  private minOpen = 0.18;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(TRAIL_N * 2 * 3);
    this.col = new Float32Array(TRAIL_N * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: true });
    m.name = 'fx-swing';
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'fx-swing';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    for (let i = 0; i < TRAIL_N; i++) {
      this.inner.push(new THREE.Vector3());
      this.outer.push(new THREE.Vector3());
      this.age.push(99);
    }
  }

  /** Start a fresh smear (tint + opacity scale, e.g. gold for charged slams). */
  begin(color = 0xfff6e0, strength = 1, life = 0.16, minOpen = 0.18): void {
    this.count = 0;
    this.minOpen = minOpen;
    this.tint.set(color);
    this.strength = strength;
    this.life = life;
  }

  /**
   * Push the tool's current inner / outer edge (world space). Fast frames are subdivided so the
   * crescent stays smooth even when the blade travels half a metre between two frames.
   */
  sample(inner: THREE.Vector3, outer: THREE.Vector3): void {
    if (this.count > 0) {
      const d = this.outer[0]!.distanceTo(outer);
      if (d < 0.03) return;
      const steps = Math.min(6, Math.floor(d / 0.09));
      if (steps > 0) {
        const pi = this.inner[0]!.clone();
        const po = this.outer[0]!.clone();
        for (let k = 1; k <= steps; k++) {
          const f = k / (steps + 1);
          this.push(_v.lerpVectors(pi, inner, f), _s.lerpVectors(po, outer, f));
        }
      }
    }
    this.push(inner, outer);
  }

  private push(inner: THREE.Vector3, outer: THREE.Vector3): void {
    // Shift the ring (newest at 0).
    const lastI = this.inner.pop()!;
    const lastO = this.outer.pop()!;
    this.age.pop();
    this.inner.unshift(lastI.copy(inner));
    this.outer.unshift(lastO.copy(outer));
    this.age.unshift(0);
    this.count = Math.min(TRAIL_N, this.count + 1);
  }

  update(dt: number): void {
    if (!this.count) {
      this.mesh.visible = false;
      return;
    }
    let alive = 0;
    // How open does the crescent look from the camera? (swing-plane normal vs view direction)
    const last = Math.max(0, this.count - 1);
    this.n.subVectors(this.outer[0]!, this.inner[0]!).cross(this.e.subVectors(this.outer[last]!, this.outer[0]!));
    const open = this.n.lengthSq() > 1e-8 ? Math.abs(this.n.normalize().dot(this.view)) : 0;
    const face = THREE.MathUtils.smoothstep(open, this.minOpen, this.minOpen + 0.25);
    for (let i = 0; i < TRAIL_N; i++) {
      if (i < this.count) this.age[i]! += dt;
      const src = Math.min(i, this.count - 1);
      const k = i < this.count ? Math.max(0, 1 - this.age[i]! / this.life) : 0;
      if (k > 0) alive++;
      // Taper toward the tail (the ribbon narrows onto the outer edge as it ages); outer edge
      // bright, inner edge transparent.
      const tail = Math.pow(1 - i / TRAIL_N, 1.3);
      const a = k * tail * this.strength * face;
      const I = this.inner[src]!;
      const O = this.outer[src]!;
      const w = 0.2 + 0.8 * k * tail;
      this.pos.set([O.x + (I.x - O.x) * w, O.y + (I.y - O.y) * w, O.z + (I.z - O.z) * w, O.x, O.y, O.z], i * 6);
      this.col.set([this.tint.r, this.tint.g, this.tint.b, a * 0.08, this.tint.r, this.tint.g, this.tint.b, a * 0.85], i * 8);
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = alive > 1;
    if (!alive) this.count = 0;
  }
}


const starMats = new Map<number, THREE.SpriteMaterial>();
/** Quality star badge: a chunky five-point star with an ink outline and a highlight (sprite). */
function starSpriteMaterial(color: number): THREE.SpriteMaterial {
  let m = starMats.get(color);
  if (m) return m;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const path = (r0: number, r1: number): void => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const r = i % 2 ? r1 : r0;
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 + 4 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };
  g.lineJoin = 'round';
  path(56, 25);
  g.fillStyle = '#2a1a0e';
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = '#2a1a0e';
  g.stroke();
  path(50, 22);
  const col = new THREE.Color(color);
  const hi = col.clone().lerp(new THREE.Color(0xffffff), 0.55);
  const lo = col.clone().multiplyScalar(0.72);
  const gr = g.createLinearGradient(0, 10, 0, S - 10);
  gr.addColorStop(0, `#${hi.getHexString()}`);
  gr.addColorStop(0.55, `#${col.getHexString()}`);
  gr.addColorStop(1, `#${lo.getHexString()}`);
  g.fillStyle = gr;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.ellipse(S / 2 - 10, S / 2 - 12, 9, 5, -0.6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false });
  m.name = 'fx-star';
  starMats.set(color, m);
  return m;
}

export class FarmFX {
  readonly group = new THREE.Group();
  private clods: Bodies;
  private leaves: Bodies;
  private dust: Puffs;
  private glow: Puffs;
  private drops: Drop[] = [];
  private streaks: Streaks;
  private dropNext = 0;
  private wet: Decals;
  private cracks: Decals;
  /** Watering-can pour stream (aimed each frame by the farming system while pouring). */
  readonly stream = new Stream();
  private outlineMat: THREE.MeshBasicMaterial;
  private rings: Ring[] = [];
  private ringMesh: THREE.InstancedMesh;
  private ringNext = 0;
  private pops: Pop[] = [];
  private popMat: THREE.MeshStandardMaterial;
  private time = 0;
  private dropsLive = false;
  private ringsLive = false;
  /** Tool swing smear (sampled by the farming system while a swing is live). */
  readonly trail = new SwingTrail();

  constructor(private ground: GroundFn) {
    this.group.name = 'farmfx';
    this.group.userData.perfTag = 'farmfx';
    this.group.userData.noAO = true;

    // Clods / chips: one lumpy low-poly rock, tinted per instance.
    const clodGeo = lumpySphere(1, 0, 0.35, new Rng('clod'), 2.2);
    const clodMat = new THREE.MeshStandardMaterial({ roughness: 0.92, color: 0xffffff });
    clodMat.name = 'fx-clod';
    this.clods = new Bodies(clodGeo, clodMat, 220, ground, 'fx-clods');

    // Leaves: a small cupped leaf blade, double sided.
    const lg = new THREE.PlaneGeometry(1, 1.6, 1, 2);
    const lp = lg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      const y = lp.getY(i);
      lp.setX(i, lp.getX(i) * (1 - Math.abs(y) / 1.1));
      lp.setZ(i, Math.abs(lp.getX(i)) * 0.4 - y * y * 0.1);
    }
    lg.rotateX(-Math.PI / 2);
    lg.computeVertexNormals();
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide, color: 0xffffff });
    leafMat.name = 'fx-leaf';
    this.leaves = new Bodies(lg, leafMat, 160, ground, 'fx-leaves');
    this.leaves.mesh.castShadow = false;

    this.dust = new Puffs(260, textures.smokePuff().map, false);
    this.dust.points.name = 'fx-dust';
    this.glow = new Puffs(260, textures.softDot().map, true);
    this.glow.points.name = 'fx-glow';

    // Droplets: velocity-stretched streaks (no emissive; alpha ~0.6), one draw call.
    this.streaks = new Streaks(640);
    for (let i = 0; i < 640; i++) this.drops.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0.02, age: 0, active: false, crown: false });
    this.streaks.mesh.visible = false;
    this.wet = new Decals(96, decalTexture('wet'), 0x0e0a06, 'fx-wet');
    this.cracks = new Decals(24, decalTexture('crack'), 0x1a0f08, 'fx-cracks');
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x2a1a0e, side: THREE.BackSide });
    this.outlineMat.name = 'fx-outline';

    const rg = new THREE.RingGeometry(0.78, 1, 28);
    rg.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    ringMat.name = 'fx-ring';
    this.ringMesh = new THREE.InstancedMesh(rg, ringMat, 64);
    this.ringMesh.name = 'fx-rings';
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 6;
    for (let i = 0; i < 64; i++) {
      this.ringMesh.setMatrixAt(i, HIDDEN);
      this.ringMesh.setColorAt(i, _c.set(0));
      this.rings.push({ p: new THREE.Vector3(), r0: 0, r1: 1, age: 0, life: 1, color: new THREE.Color(), active: false });
    }
    this.ringMesh.visible = false;

    this.popMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    this.popMat.name = 'fx-pop';

    this.group.add(this.clods.mesh, this.leaves.mesh, this.streaks.mesh, this.ringMesh, this.dust.points, this.glow.points, this.trail.mesh, this.wet.mesh, this.cracks.mesh, this.stream.mesh);
  }

  // ═══════════════════════════════════════ primitives

  clod(p: THREE.Vector3, v: THREE.Vector3, color: number | THREE.Color, size = 0.045, life = 1.8): void {
    this.clods.spawn(p, v, { color, size, life });
  }

  leaf(p: THREE.Vector3, v: THREE.Vector3, color: number | THREE.Color, size = 0.05): void {
    this.leaves.spawn(p, v, { color, size, life: rnd(1.6, 2.6), gravity: 2.2, drag: 2.6, bounce: 0, flutter: 1.2, flat: 1, spin: 5 });
  }

  puff(p: THREE.Vector3, v: THREE.Vector3, color: number | THREE.Color, size: number, life: number, opts: { grow?: number; alpha?: number; gravity?: number; drag?: number } = {}): void {
    this.dust.emit(p, v, { color, size, life, grow: opts.grow ?? 2.4, alpha: opts.alpha ?? 0.55, gravity: opts.gravity ?? -0.15, drag: opts.drag ?? 3 });
  }

  sparkle(p: THREE.Vector3, v: THREE.Vector3, color: number | THREE.Color, size: number, life: number, gravity = 0): void {
    this.glow.emit(p, v, { color, size, life, grow: 0.3, alpha: 1, gravity, drag: 1.2 });
  }

  drop(p: THREE.Vector3, v: THREE.Vector3, r = 0.022, crown = false): void {
    const d = this.drops[this.dropNext]!;
    this.dropNext = (this.dropNext + 1) % this.drops.length;
    d.p.copy(p);
    d.v.copy(v);
    d.r = r * rnd(0.7, 1.3);
    d.age = 0;
    d.active = true;
    d.crown = crown;
    this.dropsLive = true;
  }

  private radius: THREE.Mesh | null = null;
  private radiusKey = '';
  private radiusK = 0;
  private radiusOn = false;

  /**
   * Protection radius of a scarecrow as a faint ground ring draped over the terrain: a whisper of
   * warm tint inside, a dashed brighter edge. Shown while a scarecrow is selected / just placed.
   */
  showRadius(c: THREE.Vector3 | null, r = 8.5): void {
    this.radiusOn = !!c;
    if (!c) return;
    const key = `${c.x.toFixed(2)},${c.z.toFixed(2)},${r}`;
    if (key === this.radiusKey && this.radius) return;
    this.radiusKey = key;
    const SEG = 160;
    const RINGS = [0, 0.9, 0.975, 0.988, 0.995, 1.0];
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < RINGS.length; j++) {
      const rr = r * RINGS[j]!;
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const x = c.x + Math.cos(a) * rr;
        const z = c.z + Math.sin(a) * rr;
        pos.push(x, this.ground(x, z) + 0.16, z); // at grass-tip height, so the lawn doesn't swallow it
        const edge = j >= 3;
        const dash = Math.floor(i / 2) % 2 === 0 ? 1 : 0.25;
        const al = [0.0, 0.0, 0.05, 0.7 * dash, 0.7 * dash, 0.0][j]!;
        col.push(edge ? 1 : 1, edge ? 0.93 : 0.95, edge ? 0.7 : 0.8, al);
      }
    }
    for (let j = 0; j < RINGS.length - 1; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * (SEG + 1) + i;
        const b = a + SEG + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    if (!this.radius) {
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
      m.name = 'fx-radius';
      this.radius = new THREE.Mesh(g, m);
      this.radius.name = 'fx-radius';
      this.radius.frustumCulled = false;
      this.radius.renderOrder = 3;
      this.group.add(this.radius);
    } else {
      this.radius.geometry.dispose();
      this.radius.geometry = g;
    }
  }

  private updateRadius(dt: number): void {
    if (!this.radius) return;
    this.radiusK += ((this.radiusOn ? 1 : 0) - this.radiusK) * (1 - Math.exp(-dt * 8));
    this.radius.visible = this.radiusK > 0.02;
    (this.radius.material as THREE.MeshBasicMaterial).opacity = this.radiusK * (0.85 + 0.15 * Math.sin(this.time * 3));
  }

  /** A soaked, darker patch on the ground (grass / path) that fades over `life`. */
  wetSpot(p: THREE.Vector3, r: number, life = 2.5, alpha = 0.7): void {
    this.wet.add(p.clone().setY(p.y + 0.012), r, { life, fadeIn: 0.25, alpha, grow: 0.5 });
  }

  /** Cracked, bruised ground under a heavy impact (fades in over 0.25 s, then out). */
  crack(p: THREE.Vector3, r = 0.55, life = 1.6): void {
    this.cracks.add(p.clone().setY(p.y + 0.015), r, { life, fadeIn: 0.12, alpha: 0.85, grow: 0.15 });
  }

  /** A 0.2 s splash crown where water lands: droplets flicked up and out in a ring. */
  crown(p: THREE.Vector3, size = 1, n = 7): void {
    const a0 = rnd(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
      const sp = rnd(0.45, 0.8) * size;
      this.drop(p.clone().setY(p.y + 0.01), new THREE.Vector3(Math.cos(a) * sp, rnd(0.9, 1.4) * size, Math.sin(a) * sp), 0.007 * size);
    }
  }

  /**
   * Dust wall for a charged slam: soft dust billows along the rim of the struck block, rolling
   * outward and up, plus a cracked-ground decal per tile. `tiles` are tile centres (world).
   */
  dustWall(tiles: THREE.Vector3[], dirX: number, dirZ: number, color = 0xb89a78): void {
    if (!tiles.length) return;
    const min = tiles[0]!.clone();
    const max = tiles[0]!.clone();
    for (const t of tiles) {
      min.min(t);
      max.max(t);
    }
    min.x -= 0.5;
    min.z -= 0.5;
    max.x += 0.5;
    max.z += 0.5;
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const y = tiles.reduce((a, t) => a + t.y, 0) / tiles.length;
    const per = 2 * (max.x - min.x + max.z - min.z);
    const n = Math.round(per * 7);
    for (let i = 0; i < n; i++) {
      const u = (i / n) * per;
      let x: number;
      let z: number;
      const w = max.x - min.x;
      const d = max.z - min.z;
      if (u < w) [x, z] = [min.x + u, min.z];
      else if (u < w + d) [x, z] = [max.x, min.z + (u - w)];
      else if (u < 2 * w + d) [x, z] = [max.x - (u - w - d), max.z];
      else [x, z] = [min.x, max.z - (u - 2 * w - d)];
      const ox = x - cx;
      const oz = z - cz;
      const l = Math.hypot(ox, oz) || 1;
      this.puff(new THREE.Vector3(x, y + rnd(0.02, 0.12), z), new THREE.Vector3((ox / l) * rnd(1.4, 2.4), rnd(0.35, 0.9), (oz / l) * rnd(1.4, 2.4)), color, rnd(0.26, 0.4), rnd(0.8, 1.2), { alpha: 0.5, grow: 2.2, drag: 3.2 });
    }
    for (const t of tiles) this.crack(t, rnd(0.62, 0.72), rnd(1.4, 1.8));
    void dirX;
    void dirZ;
  }

  ring(p: THREE.Vector3, r0: number, r1: number, life: number, color: number | THREE.Color): void {
    const g = this.rings[this.ringNext]!;
    this.ringNext = (this.ringNext + 1) % this.rings.length;
    g.p.copy(p);
    g.r0 = r0;
    g.r1 = r1;
    g.age = 0;
    g.life = life;
    g.color.set(color instanceof THREE.Color ? color.getHex() : color);
    g.active = true;
    this.ringsLive = true;
    this.ringMesh.visible = true;
  }

  // ═══════════════════════════════════════ composite effects

  /** Hoe bites the ground: clods thrown away from the farmer, dust, a shock ring. */
  hoeImpact(center: THREE.Vector3, dirX: number, dirZ: number, soil: number, strength = 1): void {
    const n = Math.round(22 * strength);
    for (let i = 0; i < n; i++) {
      // The blade drags soil back toward the farmer: most clods fan out sideways / backwards.
      const back = i % 3 !== 0;
      const a = Math.atan2(dirZ, dirX) + (back ? Math.PI : 0) + rnd(-1.25, 1.25);
      const sp = rnd(0.9, 2.3) * (0.7 + strength * 0.3);
      _v.set(Math.cos(a) * sp, rnd(2.4, 4.6), Math.sin(a) * sp);
      const p = center.clone().add(new THREE.Vector3(rnd(-0.18, 0.18), 0.04, rnd(-0.18, 0.18)));
      this.clod(p, _v, _c.set(soil).offsetHSL(0, 0, rnd(-0.06, 0.05)), i < 4 ? rnd(0.06, 0.085) : rnd(0.03, 0.06));
    }
    for (let i = 0; i < 7; i++) {
      const a = rnd(0, Math.PI * 2);
      this.puff(center.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2)), new THREE.Vector3(Math.cos(a) * 0.9, rnd(0.3, 0.9), Math.sin(a) * 0.9), 0xb89a78, rnd(0.18, 0.3), rnd(0.7, 1.1), { alpha: 0.42 });
    }
  }

  /** Watering landing on a tile: a quick splash crown (the soil itself darkens underneath). */
  splash(p: THREE.Vector3, big = 1): void {
    this.crown(p, big, 5 + Math.round(big * 2));
  }

  /** Seeds scattered into a tile + a little dust. */
  sow(p: THREE.Vector3, color: number): void {
    for (let i = 0; i < 5; i++) {
      this.clods.spawn(p.clone().add(new THREE.Vector3(rnd(-0.08, 0.08), 0.35, rnd(-0.08, 0.08))), new THREE.Vector3(rnd(-0.5, 0.5), rnd(0.3, 0.9), rnd(-0.5, 0.5)), { color: _c.set(0xe8d09a).lerp(_c.clone().set(color), 0.2), size: 0.018, life: 1.2, bounce: 0.2 });
    }
    for (let i = 0; i < 3; i++) this.puff(p.clone().setY(p.y + 0.05), new THREE.Vector3(rnd(-0.4, 0.4), 0.3, rnd(-0.4, 0.4)), 0xb89a78, 0.14, 0.7, { alpha: 0.35 });
    this.sparkle(p.clone().setY(p.y + 0.15), new THREE.Vector3(0, 0.5, 0), 0xfff2c0, 0.14, 0.5);
  }

  /** Leafy burst (harvest, scything weeds, crows). */
  leafBurst(p: THREE.Vector3, color: number, n = 10, speed = 1.6): void {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      this.leaf(p.clone().add(new THREE.Vector3(rnd(-0.15, 0.15), rnd(0, 0.2), rnd(-0.15, 0.15))), new THREE.Vector3(Math.cos(a) * speed * rnd(0.5, 1), rnd(1.2, 2.6), Math.sin(a) * speed * rnd(0.5, 1)), _c.set(color).offsetHSL(rnd(-0.02, 0.02), 0, rnd(-0.08, 0.08)), rnd(0.035, 0.06));
    }
  }

  /** Chips (pickaxe on stone, axe on wood). */
  chips(p: THREE.Vector3, color: number, n = 10, dirX = 0, dirZ = 0): void {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dirZ, dirX) + rnd(-1.4, 1.4);
      const sp = rnd(1.4, 3);
      this.clods.spawn(p.clone().add(new THREE.Vector3(0, 0.15, 0)), new THREE.Vector3(Math.cos(a) * sp, rnd(2, 4), Math.sin(a) * sp), { color: _c.set(color).offsetHSL(0, 0, rnd(-0.08, 0.06)), size: rnd(0.025, 0.05), life: 1.4, flat: 0.4 });
    }
    for (let i = 0; i < 4; i++) this.puff(p.clone().setY(p.y + 0.15), new THREE.Vector3(rnd(-0.6, 0.6), 0.4, rnd(-0.6, 0.6)), 0xc8c0b0, 0.2, 0.8, { alpha: 0.4 });
  }

  /**
   * A few warm glints when a crop pops out (more for quality). Kept dim — additive sprites that
   * stack past the bloom threshold would blow the produce out into a white blob.
   */
  harvestGlint(p: THREE.Vector3, color: number, quality: number): void {
    void color;
    const n = 4 + quality * 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
      this.glow.emit(p.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3(Math.cos(a) * rnd(0.7, 1.3), rnd(0.9, 1.8), Math.sin(a) * rnd(0.7, 1.3)), { color: quality >= 2 ? 0x7a5a18 : 0x5a5446, size: rnd(0.06, 0.1), life: rnd(0.45, 0.7), grow: 0.3, alpha: 1, gravity: 1.5, drag: 1.2 });
    }
  }

  /** Throw a produce mesh from `from` in an arc to opts.to() (squash on launch, spin, star). */
  pop(geo: THREE.BufferGeometry, from: THREE.Vector3, opts: PopOpts): void {
    const mesh = new THREE.Mesh(geo, this.popMat);
    mesh.castShadow = true;
    mesh.position.copy(from);
    mesh.scale.setScalar(0.01);
    // Inverted-hull ink outline: switched on while the produce is held up for show.
    const hull = new THREE.Mesh(geo, this.outlineMat);
    hull.name = 'outline';
    hull.scale.setScalar(1.09);
    hull.visible = false;
    mesh.add(hull);
    let star: THREE.Sprite | null = null;
    if (opts.star != null) {
      star = new THREE.Sprite(starSpriteMaterial(opts.star));
      star.scale.setScalar(0.001);
      star.renderOrder = 9;
      this.group.add(star);
    }
    this.group.add(mesh);
    this.pops.push({ mesh, star, from: from.clone(), opts, age: 0, arrived: false, spin: rnd(-1, 1) });
  }

  /** Drop every live effect (demo staging: nothing from the previous scene leaks into the next). */
  clear(): void {
    this.clods.clear();
    this.leaves.clear();
    this.dust.clear();
    this.glow.clear();
    for (const d of this.drops) d.active = false;
    this.streaks.write(this.drops);
    this.dropsLive = false;
    for (const r of this.rings) r.active = false;
    this.ringMesh.visible = false;
    this.ringsLive = false;
    for (const p of this.pops) {
      p.mesh.removeFromParent();
      p.star?.removeFromParent();
    }
    this.pops.length = 0;
    this.trail.update(99);
    this.wet.clear();
    this.cracks.clear();
    this.wet.update(0);
    this.cracks.update(0);
    this.stream.stop();
    this.stream.update(99);
  }

  get busy(): boolean {
    return this.pops.length > 0;
  }

  // ═══════════════════════════════════════ update

  update(dt: number, viewportH: number): void {
    this.time += dt;
    this.clods.update(dt, this.time);
    this.leaves.update(dt, this.time);
    this.dust.update(dt, viewportH);
    this.glow.update(dt, viewportH);
    this.updateDrops(dt);
    this.updateRings(dt);
    this.updatePops(dt);
    this.trail.update(dt);
    this.wet.update(dt);
    this.cracks.update(dt);
    this.stream.update(dt);
    this.updateRadius(dt);
  }

  private updateDrops(dt: number): void {
    if (!this.dropsLive) {
      this.streaks.mesh.visible = false;
      return;
    }
    let any = false;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]!;
      if (!d.active) continue;
      d.age += dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      const gy = this.ground(d.p.x, d.p.z);
      if (d.p.y <= gy || d.age > 2) {
        d.active = false;
        if (d.crown) this.crown(new THREE.Vector3(d.p.x, gy, d.p.z), 0.6, 4);
        continue;
      }
      any = true;
    }
    this.streaks.write(this.drops);
    this.dropsLive = any;
  }

  private updateRings(dt: number): void {
    if (!this.ringsLive) return;
    let any = false;
    for (let i = 0; i < this.rings.length; i++) {
      const g = this.rings[i]!;
      if (!g.active) continue;
      g.age += dt;
      const t = g.age / g.life;
      if (t >= 1) {
        g.active = false;
        this.ringMesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      any = true;
      const e = 1 - Math.pow(1 - t, 3);
      const r = g.r0 + (g.r1 - g.r0) * e;
      _s.set(r, 1, r);
      this.ringMesh.setMatrixAt(i, _m.compose(g.p, _q.identity(), _s));
      this.ringMesh.setColorAt(i, _c.copy(g.color).multiplyScalar((1 - t) * (1 - t) * 0.9));
    }
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
    this.ringsLive = any;
    this.ringMesh.visible = any;
  }

  private updatePops(dt: number): void {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]!;
      p.age += dt;
      const flight = p.opts.flight ?? 0.42;
      const hold = p.opts.hold ?? 0.55;
      const S = p.opts.scale ?? 1;
      const to = p.opts.to();
      const m = p.mesh;
      const hull = m.children[0];
      if (p.age < flight) {
        // Arc: launch with a squash, stretch along the rise, spin.
        const t = p.age / flight;
        const e = 1 - Math.pow(1 - t, 2);
        m.position.lerpVectors(p.from, to, e);
        m.position.y += Math.sin(t * Math.PI) * 0.9;
        const pop = t < 0.18 ? THREE.MathUtils.lerp(0.3, 1.1, t / 0.18) : THREE.MathUtils.lerp(1.1, 1, Math.min(1, (t - 0.18) / 0.4));
        const stretch = 1 + Math.sin(t * Math.PI) * 0.25;
        m.scale.set((S * pop) / Math.sqrt(stretch), S * pop * stretch, (S * pop) / Math.sqrt(stretch));
        m.rotation.set(Math.sin(t * 6) * 0.3, t * 6 * p.spin + p.spin, 0);
        if (hull) hull.visible = false;
      } else if (p.age < flight + hold) {
        if (!p.arrived) {
          p.arrived = true;
          p.opts.onArrive?.();
        }
        // Held up for show: lands squashed (1.25 / 0.8) and springs back to 1, outlined, slow turn.
        const th = p.age - flight;
        const osc = Math.exp(-th * 9) * Math.cos(th * 24);
        m.position.copy(to);
        m.position.y += Math.sin(Math.min(1, th / hold) * Math.PI) * 0.04;
        m.scale.set(S * (1 + 0.25 * osc), S * (1 - 0.2 * osc), S * (1 + 0.25 * osc));
        m.rotation.set(0, m.rotation.y + dt * 1.6, Math.sin(th * 5) * 0.08);
        if (hull) hull.visible = true;
      } else {
        // Zip into the backpack: shrink towards the farmer's chest.
        const t = Math.min(1, (p.age - flight - hold) / 0.2);
        m.position.copy(to).add(new THREE.Vector3(0, -0.55 * t * t, 0.1 * t));
        m.scale.setScalar(S * (1 - t * t));
        if (hull) hull.visible = t < 0.4;
        if (t >= 1) {
          p.opts.onDone?.(m.position.clone());
          m.removeFromParent();
          p.star?.removeFromParent();
          this.pops.splice(i, 1);
          continue;
        }
      }
      if (p.star) {
        // The quality star pops in above the produce once it lands overhead, bounces, then follows it out.
        const st = p.star;
        const ts = p.age - flight;
        const k = ts < 0 ? 0 : ts < 0.14 ? THREE.MathUtils.lerp(0, 1.35, ts / 0.14) : 1 + 0.35 * Math.exp(-(ts - 0.14) * 10) * Math.cos((ts - 0.14) * 30);
        const out = p.age > flight + hold ? Math.max(0, 1 - (p.age - flight - hold) / 0.18) : 1;
        st.scale.setScalar(Math.max(0.001, 0.26 * k * out));
        st.position.copy(m.position).add(new THREE.Vector3(0, 0.3 * S + 0.08, 0));
        st.material.rotation = Math.sin(p.age * 4) * 0.18;
      }
    }
  }
}
