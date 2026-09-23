/**
 * Mine VFX (one-shot + ambient), all pooled, a few draw calls total:
 *  - Particles: two point pools (additive: sparks, sparkles, embers, glow motes; alpha: dust puffs,
 *    goo droplets, snow). Per-particle gravity, drag, size growth, colour fade, floor bounce.
 *  - Chunks: physical rock shards (instanced, flat-shaded) that tumble, bounce and shrink away.
 *  - Motes: ambient dust / snowflakes / rising embers around the player, brightest in the lantern.
 */
import * as THREE from 'three';
import { textures } from '../../render/textures';
import { facetRock } from './rockgeo';
import { Rng } from '../../core/rng';

const RUBBLE = 220;

const VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aSpin;
varying float vAlpha;
varying vec3 vColor;
varying float vSpin;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / -mvPosition.z;
  vAlpha = aAlpha;
  vColor = aColor;
  vSpin = aSpin;
  #include <fog_vertex>
}`;

const FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uStar;
varying float vAlpha;
varying vec3 vColor;
varying float vSpin;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a;
  if (vSpin > 0.5) {
    // 4-point star sparkle.
    float c = cos(vSpin * 3.0), s = sin(vSpin * 3.0);
    vec2 q = mat2(c, -s, s, c) * p;
    float star = max(0.0, 1.0 - abs(q.x) * 18.0) * max(0.0, 1.0 - abs(q.y) * 2.2) + max(0.0, 1.0 - abs(q.y) * 18.0) * max(0.0, 1.0 - abs(q.x) * 2.2);
    a = clamp(star + smoothstep(0.22, 0.0, length(p)) * 0.8, 0.0, 1.0);
  }
  gl_FragColor = vec4(vColor, a * vAlpha);
  if (gl_FragColor.a < 0.004) discard;
  #include <fog_fragment>
}`;

interface EmitOpts {
  color: number | THREE.Color;
  count?: number;
  speed?: number;
  up?: number;
  spread?: number;
  size?: number;
  grow?: number;
  gravity?: number;
  drag?: number;
  life?: number;
  /** Colour at end of life. */
  to?: number;
  star?: boolean;
  /** Direction bias (unit xz). */
  dir?: THREE.Vector3;
  cone?: number;
  alpha?: number;
}

class Pool {
  readonly points: THREE.Points;
  readonly n: number;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private spin: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private s0: Float32Array;
  private grow: Float32Array;
  private a0: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private next = 0;
  private live = 0;
  readonly material: THREE.ShaderMaterial;

  constructor(n: number, additive: boolean, map: THREE.Texture) {
    this.n = n;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    this.spin = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(99);
    this.life = new Float32Array(n).fill(1);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3);
    this.c1 = new Float32Array(n * 3);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: map }, uScale: { value: 1600 }, uStar: { value: 0 } }]),
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 9 : 8;
    this.points.userData.noAO = true;
  }

  emit(p: THREE.Vector3, o: EmitOpts): void {
    const c = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color);
    const c2 = o.to !== undefined ? new THREE.Color(o.to) : c;
    const n = o.count ?? 10;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 1.5) * (0.35 + Math.random() * 0.9);
      const spread = o.spread ?? 0.1;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread * 0.5;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      let vx = Math.cos(a) * sp;
      let vz = Math.sin(a) * sp;
      if (o.dir) {
        const cone = o.cone ?? 0.6;
        vx = vx * cone + o.dir.x * sp * (1 - cone) * 2;
        vz = vz * cone + o.dir.z * sp * (1 - cone) * 2;
      }
      this.vel[i * 3] = vx;
      this.vel[i * 3 + 1] = (o.up ?? 1) * sp * (0.5 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = vz;
      this.age[i] = 0;
      this.life[i] = (o.life ?? 0.6) * (0.65 + Math.random() * 0.7);
      this.grav[i] = o.gravity ?? 6;
      this.drag[i] = o.drag ?? 1.5;
      this.s0[i] = (o.size ?? 0.1) * (0.6 + Math.random() * 0.8);
      this.grow[i] = o.grow ?? 0;
      this.a0[i] = o.alpha ?? 1;
      this.spin[i] = o.star ? 0.6 + Math.random() * 2 : 0;
      const v = 0.85 + Math.random() * 0.3;
      this.c0[i * 3] = c.r * v;
      this.c0[i * 3 + 1] = c.g * v;
      this.c0[i * 3 + 2] = c.b * v;
      this.c1[i * 3] = c2.r * v;
      this.c1[i * 3 + 1] = c2.g * v;
      this.c1[i * 3 + 2] = c2.b * v;
    }
    this.live = Math.max(this.live, 1);
  }

  update(dt: number, viewportH: number, floorY: (x: number, z: number) => number): void {
    this.material.uniforms.uScale!.value = viewportH * 1.6;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const age = (this.age[i]! += dt);
      const t = age / this.life[i]!;
      if (t >= 1) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      alive++;
      const dk = Math.exp(-this.drag[i]! * dt);
      this.vel[i * 3]! *= dk;
      this.vel[i * 3 + 2]! *= dk;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * dk - this.grav[i]! * dt;
      let x = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      let y = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      const z = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
      if (this.grav[i]! > 0.5) {
        const fy = floorY(x, z) + 0.02;
        if (y < fy) {
          y = fy;
          this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]!) * 0.3;
          this.vel[i * 3]! *= 0.6;
          this.vel[i * 3 + 2]! *= 0.6;
        }
      }
      x = x;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.size[i] = this.s0[i]! * (1 + this.grow[i]! * t) * (this.spin[i]! > 0 ? Math.sin(Math.min(1, t * 1.2) * Math.PI) : 1 - t * 0.4);
      this.alpha[i] = this.a0[i]! * Math.min(1, (1 - t) * 2.5) * Math.min(1, t * 20 + 0.2);
      for (let k = 0; k < 3; k++) this.color[i * 3 + k] = this.c0[i * 3 + k]! + (this.c1[i * 3 + k]! - this.c0[i * 3 + k]!) * t;
      if (this.spin[i]! > 0) this.spin[i] = this.spin[i]! + dt * 2;
    }
    this.live = alive;
    const g = this.points.geometry;
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor', 'aSpin']) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

interface Chunk {
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  s: number;
  age: number;
  life: number;
  rest: boolean;
}

export class MineFX {
  readonly group = new THREE.Group();
  readonly glow: Pool;
  readonly soft: Pool;
  private chunkMesh: THREE.InstancedMesh;
  private chunks: Chunk[] = [];
  private chunkNext = 0;
  private rubbleMesh: THREE.InstancedMesh;
  private rubbleN = 0;
  private dummy = new THREE.Object3D();
  private motes: THREE.Points;
  private moteData: Float32Array;
  private moteKind: 'dust' | 'snow' | 'embers' = 'dust';
  private moteColor = new THREE.Color();
  private moteMat: THREE.ShaderMaterial;
  private readonly MOTES = 240;
  private floorY: (x: number, z: number) => number = () => 0;
  /** Brightness of the alpha (dust / goo) particles relative to their authored colour. */
  softGain = 0.5;

  constructor() {
    this.group.name = 'mine-fx';
    this.group.userData.perfTag = 'mine-fx';
    this.group.userData.noAO = true;
    const dot = textures.softDot().map;
    this.glow = new Pool(900, true, dot);
    this.soft = new Pool(500, false, textures.smokePuff().map);
    this.group.add(this.glow.points, this.soft.points);

    // Rock shards.
    const r = new Rng('mine-chunks');
    const cg = facetRock(r, 0.1, 0xffffff, { detail: 0, squash: 0.9, chunky: true, rim: 0.2 });
    const cm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, flatShading: true });
    cm.name = 'mine-chunk';
    // Lit chunks, not dark flecks: a little self-light in their own colour + a bright view rim, so
    // every shard reads against the floor from the 17–25 m camera.
    cm.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
          totalEmissiveRadiance += diffuseColor.rgb * (0.22 + fr * 0.9);
        }`,
      );
    };
    cm.customProgramCacheKey = () => 'mine-chunk-lit';
    this.chunkMesh = new THREE.InstancedMesh(cg, cm, 96);
    this.chunkMesh.name = 'mine-chunks';
    this.chunkMesh.castShadow = true;
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.count = 96;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < 96; i++) {
      this.chunks.push({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 0, age: 99, life: 1, rest: true });
      this.dummy.position.set(0, -50, 0);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.chunkMesh.setMatrixAt(i, this.dummy.matrix);
      this.chunkMesh.setColorAt(i, white);
    }
    this.group.add(this.chunkMesh);

    // Persistent rubble left where rocks broke (cleared per floor).
    const rg = facetRock(new Rng('mine-rubble'), 0.1, 0xffffff, { detail: 0, squash: 0.45, chunky: true, rim: 0.3 });
    const rmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    rmat.name = 'mine-rubble-fx';
    this.rubbleMesh = new THREE.InstancedMesh(rg, rmat, RUBBLE);
    this.rubbleMesh.name = 'mine-rubble-fx';
    this.rubbleMesh.frustumCulled = false;
    this.rubbleMesh.receiveShadow = true;
    this.rubbleMesh.count = 0;
    this.rubbleMesh.userData.noAO = false;
    this.group.add(this.rubbleMesh);

    // Ambient motes.
    const mg = new THREE.BufferGeometry();
    this.moteData = new Float32Array(this.MOTES * 4);
    const mp = new Float32Array(this.MOTES * 3);
    const ms = new Float32Array(this.MOTES);
    for (let i = 0; i < this.MOTES; i++) {
      this.moteData[i * 4] = Math.random();
      this.moteData[i * 4 + 1] = Math.random();
      this.moteData[i * 4 + 2] = Math.random();
      this.moteData[i * 4 + 3] = Math.random();
      ms[i] = Math.random();
    }
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
    this.moteMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMap: { value: dot }, uScale: { value: 1600 }, uColor: { value: new THREE.Color() }, uLight: { value: new THREE.Vector3() }, uKind: { value: 0 } },
      ]),
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uScale; uniform vec3 uLight; uniform float uKind;
        varying float vA;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float d = distance(position, uLight);
          float lit = uKind > 1.5 ? 1.0 : smoothstep(7.0, 1.5, d);
          vA = lit * (0.35 + 0.65 * aSeed);
          gl_PointSize = (uKind > 0.5 && uKind < 1.5 ? 0.09 : uKind > 1.5 ? 0.07 : 0.045) * (0.6 + aSeed) * uScale / -mvPosition.z;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
        #include <fog_pars_fragment>
        void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA); if (gl_FragColor.a < 0.004) discard;
        #include <fog_fragment>
        }`,
    });
    this.motes = new THREE.Points(mg, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 9;
    this.group.add(this.motes);
  }

  setFloor(floorY: (x: number, z: number) => number, kind: 'dust' | 'snow' | 'embers', color: number): void {
    this.floorY = floorY;
    this.moteKind = kind;
    this.moteColor.setHex(color);
    (this.moteMat.uniforms.uColor!.value as THREE.Color).copy(this.moteColor).multiplyScalar(kind === 'embers' ? 2.2 : kind === 'snow' ? 0.9 : 0.8);
    this.moteMat.uniforms.uKind!.value = kind === 'dust' ? 0 : kind === 'snow' ? 1 : 2;
    this.moteMat.blending = kind === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.moteMat.needsUpdate = true;
    for (const c of this.chunks) {
      c.age = 99;
      c.p.set(0, -50, 0);
    }
    this.rubbleN = 0;
    this.rubbleMesh.count = 0;
  }

  /** Leave a little persistent scree where a rock broke. */
  rubble(p: THREE.Vector3, color: THREE.Color, count = 4, spread = 0.42): void {
    const tmp = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = this.rubbleN % RUBBLE;
      this.rubbleN++;
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * spread;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      this.dummy.position.set(x, this.floorY(x, z) - 0.01, z);
      this.dummy.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6, (Math.random() - 0.5) * 0.4);
      this.dummy.scale.setScalar(0.6 + Math.random() * 1.1 * (k === 0 ? 1.6 : 1));
      this.dummy.updateMatrix();
      this.rubbleMesh.setMatrixAt(i, this.dummy.matrix);
      tmp.copy(color).multiplyScalar(0.7 + Math.random() * 0.35);
      this.rubbleMesh.setColorAt(i, tmp);
    }
    this.rubbleMesh.count = Math.min(RUBBLE, this.rubbleN);
    this.rubbleMesh.instanceMatrix.needsUpdate = true;
    if (this.rubbleMesh.instanceColor) this.rubbleMesh.instanceColor.needsUpdate = true;
  }

  /** Sparks / sparkles / embers (additive). */
  sparks(p: THREE.Vector3, o: EmitOpts): void {
    this.glow.emit(p, o);
  }

  /** Dust puffs, goo, snow (alpha). */
  puff(p: THREE.Vector3, o: EmitOpts): void {
    // Unlit alpha sprites: pre-darken to the lantern-lit exposure so dust never blooms to white.
    const c = (o.color instanceof THREE.Color ? o.color.clone() : new THREE.Color(o.color)).multiplyScalar(this.softGain);
    this.soft.emit(p, { ...o, color: c });
  }

  /** Rock shards bursting from p. */
  shatter(p: THREE.Vector3, color: number | THREE.Color, count = 8, power = 1, dir?: THREE.Vector3, big = false): void {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const tmp = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = this.chunkNext;
      this.chunkNext = (this.chunkNext + 1) % this.chunks.length;
      const ch = this.chunks[i]!;
      const a = Math.random() * Math.PI * 2;
      const sp = (1.4 + Math.random() * 2.2) * power;
      ch.p.set(p.x + Math.cos(a) * 0.15, p.y + 0.15 + Math.random() * 0.25, p.z + Math.sin(a) * 0.15);
      ch.v.set(Math.cos(a) * sp + (dir?.x ?? 0) * 1.5, 2.2 + Math.random() * 2.8 * power, Math.sin(a) * sp + (dir?.z ?? 0) * 1.5);
      ch.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      ch.w.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      ch.s = big ? 1.2 + Math.random() * 1.3 : 0.7 + Math.random() * 1.1;
      ch.age = 0;
      ch.life = big ? 1.2 + Math.random() * 0.6 : 1.1 + Math.random() * 0.9;
      ch.rest = false;
      tmp.copy(c).multiplyScalar(0.8 + Math.random() * 0.35);
      this.chunkMesh.setColorAt(i, tmp);
    }
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, time: number, viewportH: number, focus: THREE.Vector3, light: THREE.Vector3): void {
    this.glow.update(dt, viewportH, this.floorY);
    this.soft.update(dt, viewportH, this.floorY);
    // Chunks.
    const q = new THREE.Quaternion();
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i]!;
      if (c.age > c.life) {
        if (c.s !== 0) {
          c.s = 0;
          this.dummy.position.set(0, -50, 0);
          this.dummy.scale.setScalar(0);
          this.dummy.updateMatrix();
          this.chunkMesh.setMatrixAt(i, this.dummy.matrix);
        }
        continue;
      }
      c.age += dt;
      if (!c.rest) {
        c.v.y -= 16 * dt;
        c.p.addScaledVector(c.v, dt);
        const fy = this.floorY(c.p.x, c.p.z) + 0.05 * c.s;
        if (c.p.y < fy) {
          c.p.y = fy;
          if (Math.abs(c.v.y) < 2.2) {
            c.v.set(0, 0, 0);
            c.rest = true;
          } else {
            c.v.y = -c.v.y * 0.38;
            c.v.x *= 0.55;
            c.v.z *= 0.55;
            c.w.multiplyScalar(0.6);
          }
        }
        q.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt));
        c.q.multiply(q);
      }
      const t = c.age / c.life;
      const s = c.s * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      this.dummy.position.copy(c.p);
      this.dummy.quaternion.copy(c.q);
      this.dummy.scale.setScalar(Math.max(0.0001, s));
      this.dummy.updateMatrix();
      this.chunkMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.chunkMesh.instanceMatrix.needsUpdate = true;

    // Motes: a box around the focus that wraps; dust drifts, snow falls, embers rise.
    const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const R = 9;
    for (let i = 0; i < this.MOTES; i++) {
      const s0 = this.moteData[i * 4]!;
      const s1 = this.moteData[i * 4 + 1]!;
      const s2 = this.moteData[i * 4 + 2]!;
      const s3 = this.moteData[i * 4 + 3]!;
      let x: number;
      let y: number;
      let z: number;
      if (this.moteKind === 'snow') {
        const fall = (s1 * 5 - time * (0.25 + s3 * 0.25)) % 5;
        y = fall < 0 ? fall + 5 : fall;
        x = s0 * 2 * R + Math.sin(time * 0.6 + s2 * 20) * 0.4 + time * 0.1;
        z = s2 * 2 * R + Math.cos(time * 0.5 + s0 * 20) * 0.3;
      } else if (this.moteKind === 'embers') {
        const rise = (s1 * 4 + time * (0.35 + s3 * 0.5)) % 4;
        y = rise;
        x = s0 * 2 * R + Math.sin(time * 1.3 + s2 * 20) * 0.35;
        z = s2 * 2 * R + Math.cos(time * 1.1 + s0 * 20) * 0.35;
      } else {
        y = 0.2 + s1 * 2.8 + Math.sin(time * 0.3 + s3 * 30) * 0.3;
        x = s0 * 2 * R + Math.sin(time * 0.15 + s2 * 20) * 1.2;
        z = s2 * 2 * R + Math.cos(time * 0.13 + s0 * 20) * 1.2;
      }
      // Wrap into the box around the focus.
      x = focus.x - R + ((((x - (focus.x - R)) % (2 * R)) + 2 * R) % (2 * R));
      z = focus.z - R + ((((z - (focus.z - R)) % (2 * R)) + 2 * R) % (2 * R));
      pos.setXYZ(i, x, focus.y + y, z);
    }
    pos.needsUpdate = true;
    this.moteMat.uniforms.uScale!.value = viewportH * 1.6;
    (this.moteMat.uniforms.uLight!.value as THREE.Vector3).copy(light);
  }

  dispose(): void {
    this.glow.dispose();
    this.soft.dispose();
    this.chunkMesh.geometry.dispose();
    (this.chunkMesh.material as THREE.Material).dispose();
    this.rubbleMesh.geometry.dispose();
    (this.rubbleMesh.material as THREE.Material).dispose();
    this.motes.geometry.dispose();
    this.moteMat.dispose();
  }
}

/**
 * A single additive glow dot (halo) as THREE.Points: unlike a Sprite it is skipped by the AO
 * G-buffer pass (which only hides meshes / points / lines), so it never stamps a dark square.
 * `size` is roughly its diameter in metres.
 */
export function glowPoint(color: number, size: number, opacity = 0.8): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const m = new THREE.PointsMaterial({ map: textures.softDot().map, color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 9;
  p.userData.noAO = true;
  return p;
}
