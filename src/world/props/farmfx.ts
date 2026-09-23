/**
 * Farming "juice" VFX — everything the tools and harvests throw into the world:
 *   Chunks   instanced 3D debris with real bounces: soil clods, stone chips, wood chips, seeds
 *   Leaves   instanced flutter leaves / grass clippings (drag + spin + sway)
 *   Drops    instanced water droplets stretched along their velocity; land → ring + mist
 *   Rings    additive expanding ripples (water landing, hoe impact shock ring, harvest pop)
 *   Puffs    soft sprite points: dust clouds, mist, sparkles / glints (two blend modes)
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
const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

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

// ───────────────────────────────────────────── droplets

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: number;
  age: number;
  active: boolean;
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
  star: THREE.Mesh | null;
  from: THREE.Vector3;
  opts: PopOpts;
  age: number;
  arrived: boolean;
  spin: number;
}

function starGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.45 : 1;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  g.center();
  return g;
}

export class FarmFX {
  readonly group = new THREE.Group();
  private clods: Bodies;
  private leaves: Bodies;
  private dust: Puffs;
  private glow: Puffs;
  private drops: Drop[] = [];
  private dropMesh: THREE.InstancedMesh;
  private dropNext = 0;
  private rings: Ring[] = [];
  private ringMesh: THREE.InstancedMesh;
  private ringNext = 0;
  private pops: Pop[] = [];
  private popMat: THREE.MeshStandardMaterial;
  private starGeo = starGeometry();
  private time = 0;
  private dropsLive = false;
  private ringsLive = false;

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

    // Droplets: glossy, slightly emissive so they read against dark wet soil.
    const dropMat = new THREE.MeshStandardMaterial({ color: 0xd4f0ff, roughness: 0.05, metalness: 0.0, emissive: 0x3a6a8a, emissiveIntensity: 0.55, transparent: true, opacity: 0.85 });
    dropMat.name = 'fx-drop';
    this.dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), dropMat, 420);
    this.dropMesh.name = 'fx-drops';
    this.dropMesh.frustumCulled = false;
    this.dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 420; i++) {
      this.dropMesh.setMatrixAt(i, HIDDEN);
      this.drops.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0.02, age: 0, active: false });
    }
    this.dropMesh.visible = false;

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

    this.popMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.0 });
    this.popMat.name = 'fx-pop';

    this.group.add(this.clods.mesh, this.leaves.mesh, this.dropMesh, this.ringMesh, this.dust.points, this.glow.points);
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

  drop(p: THREE.Vector3, v: THREE.Vector3, r = 0.022): void {
    const d = this.drops[this.dropNext]!;
    this.dropNext = (this.dropNext + 1) % this.drops.length;
    d.p.copy(p);
    d.v.copy(v);
    d.r = r * rnd(0.7, 1.3);
    d.age = 0;
    d.active = true;
    this.dropsLive = true;
    this.dropMesh.visible = true;
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
    const n = Math.round(12 * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dirZ, dirX) + rnd(-1.1, 1.1);
      const sp = rnd(1.1, 2.6) * (0.7 + strength * 0.3);
      _v.set(Math.cos(a) * sp, rnd(2.2, 4.2), Math.sin(a) * sp);
      const p = center.clone().add(new THREE.Vector3(rnd(-0.18, 0.18), 0.04, rnd(-0.18, 0.18)));
      this.clod(p, _v, _c.set(soil).offsetHSL(0, 0, rnd(-0.06, 0.05)), rnd(0.03, 0.065));
    }
    for (let i = 0; i < 7; i++) {
      const a = rnd(0, Math.PI * 2);
      this.puff(center.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2)), new THREE.Vector3(Math.cos(a) * 0.9, rnd(0.3, 0.9), Math.sin(a) * 0.9), 0xb89a78, rnd(0.18, 0.3), rnd(0.7, 1.1), { alpha: 0.42 });
    }
    this.ring(center.clone().setY(center.y + 0.02), 0.15, 0.7, 0.35, 0x8a6a4a);
  }

  /** Watering landing on a tile: splash crown + ring + mist. */
  splash(p: THREE.Vector3, big = 1): void {
    this.ring(p.clone().setY(p.y + 0.015), 0.04, 0.24 * big, 0.45, 0x6fa8c8);
    for (let i = 0; i < 3; i++) {
      const a = rnd(0, Math.PI * 2);
      this.drop(p.clone().setY(p.y + 0.02), new THREE.Vector3(Math.cos(a) * 0.7, rnd(1.0, 1.8), Math.sin(a) * 0.7), 0.012);
    }
    if (Math.random() < 0.5) this.puff(p.clone().setY(p.y + 0.05), new THREE.Vector3(0, 0.25, 0), 0xe0f2ff, 0.16, 0.8, { alpha: 0.35 });
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

  /** Radial glint + sparkles when a crop pops out (brighter for quality). */
  harvestGlint(p: THREE.Vector3, color: number, quality: number): void {
    this.ring(p.clone().setY(p.y + 0.03), 0.1, 0.55 + quality * 0.12, 0.45, _c.set(color).lerp(new THREE.Color(0xffffff), 0.4));
    const n = 8 + quality * 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.sparkle(p.clone().add(new THREE.Vector3(0, 0.25, 0)), new THREE.Vector3(Math.cos(a) * rnd(0.8, 1.6), rnd(0.8, 2.2), Math.sin(a) * rnd(0.8, 1.6)), quality >= 2 ? 0xffe27a : 0xfff6d8, rnd(0.08, 0.14), rnd(0.5, 0.9), 1.5);
    }
  }

  /** Throw a produce mesh from `from` in an arc to opts.to() (squash on launch, spin, star). */
  pop(geo: THREE.BufferGeometry, from: THREE.Vector3, opts: PopOpts): void {
    const mesh = new THREE.Mesh(geo, this.popMat);
    mesh.castShadow = true;
    mesh.position.copy(from);
    mesh.scale.setScalar(0.01);
    let star: THREE.Mesh | null = null;
    if (opts.star != null) {
      const sm = new THREE.MeshStandardMaterial({ color: opts.star, emissive: opts.star, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.3 });
      star = new THREE.Mesh(this.starGeo, sm);
      star.scale.setScalar(0.001);
      this.group.add(star);
    }
    this.group.add(mesh);
    this.pops.push({ mesh, star, from: from.clone(), opts, age: 0, arrived: false, spin: rnd(-1, 1) });
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
  }

  private updateDrops(dt: number): void {
    if (!this.dropsLive) return;
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
        this.dropMesh.setMatrixAt(i, HIDDEN);
        if (d.r > 0.016 && Math.random() < 0.35) this.ring(new THREE.Vector3(d.p.x, gy + 0.012, d.p.z), 0.02, 0.1 + d.r * 3, 0.35, 0x5a8aa8);
        continue;
      }
      any = true;
      const sp = d.v.length();
      _v.copy(d.v).divideScalar(sp || 1);
      _q.setFromUnitVectors(UP, _v);
      const stretch = 1 + Math.min(2.2, sp * 0.35);
      _s.set(d.r, d.r * stretch, d.r);
      this.dropMesh.setMatrixAt(i, _m.compose(d.p, _q, _s));
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.dropsLive = any;
    this.dropMesh.visible = any;
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
      if (p.age < flight) {
        // Arc: launch with a squash, stretch along the rise, spin.
        const t = p.age / flight;
        const e = 1 - Math.pow(1 - t, 2);
        m.position.lerpVectors(p.from, to, e);
        m.position.y += Math.sin(t * Math.PI) * 0.9;
        const pop = t < 0.18 ? THREE.MathUtils.lerp(0.3, 1.25, t / 0.18) : THREE.MathUtils.lerp(1.25, 1, Math.min(1, (t - 0.18) / 0.4));
        const stretch = 1 + Math.sin(t * Math.PI) * 0.25;
        m.scale.set(S * pop / Math.sqrt(stretch), S * pop * stretch, S * pop / Math.sqrt(stretch));
        m.rotation.set(Math.sin(t * 6) * 0.3, t * 6 * p.spin + p.spin, 0);
      } else if (p.age < flight + hold) {
        if (!p.arrived) {
          p.arrived = true;
          p.opts.onArrive?.();
        }
        // Held aloft: settle bounce + slow turn, gentle glow.
        const t = (p.age - flight) / hold;
        const b = Math.sin(Math.min(1, t * 3) * Math.PI) * Math.exp(-t * 4) * 0.25;
        m.position.copy(to);
        m.position.y += Math.sin(t * Math.PI) * 0.04;
        m.scale.set(S * (1 + b), S * (1 - b * 0.8), S * (1 + b));
        m.rotation.set(0, m.rotation.y + dt * 2.2, 0);
        this.popMat.emissiveIntensity = 0;
      } else {
        // Zip into the backpack: shrink towards the farmer's chest.
        const t = Math.min(1, (p.age - flight - hold) / 0.22);
        m.position.copy(to).add(new THREE.Vector3(0, -0.55 * t * t, 0.1 * t));
        m.scale.setScalar(S * (1 - t * t));
        if (t >= 1) {
          p.opts.onDone?.(m.position.clone());
          m.removeFromParent();
          if (p.star) {
            p.star.removeFromParent();
            (p.star.material as THREE.Material).dispose();
          }
          this.pops.splice(i, 1);
          continue;
        }
      }
      if (p.star) {
        const st = p.star;
        const tt = Math.min(1, Math.max(0, (p.age - flight * 0.6) / 0.25));
        const sc = 0.075 * (tt < 1 ? THREE.MathUtils.lerp(0, 1.4, tt) : 1) * (p.age > flight + hold ? Math.max(0, 1 - (p.age - flight - hold) / 0.2) : 1);
        st.scale.setScalar(Math.max(0.001, sc));
        st.position.copy(m.position).add(new THREE.Vector3(0.17 * S, 0.14 * S, 0.12));
        st.rotation.set(0, Math.sin(p.age * 3) * 0.5, Math.sin(p.age * 2) * 0.15);
        if (Math.random() < dt * 10) this.sparkle(st.position.clone(), new THREE.Vector3(rnd(-0.3, 0.3), rnd(0.1, 0.5), rnd(-0.3, 0.3)), (st.material as THREE.MeshStandardMaterial).color.getHex(), 0.06, 0.5);
      }
    }
  }
}
