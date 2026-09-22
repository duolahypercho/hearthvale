/**
 * Lightweight GPU-point particle systems:
 *  - SmokeEmitter: soft billboard puffs rising, swelling and drifting with the wind (chimneys).
 *  - Ambience: pollen/dust motes by day, fireflies at night, drifting leaves in fall,
 *    all following the camera focus so the view is never perfectly still.
 */
import * as THREE from 'three';
import { textures } from './textures';
import { globalUniforms } from './uniforms';
import type { Season, Weather } from '../core/time';

const POINT_VS = /* glsl */ `
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

const POINT_FS = /* glsl */ `
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

function pointMaterial(map: THREE.Texture, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: map }, uScale: { value: 600 } }]),
    vertexShader: POINT_VS,
    fragmentShader: POINT_FS,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

class PointPool {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly color: Float32Array;
  readonly material: THREE.ShaderMaterial;

  constructor(readonly n: number, map: THREE.Texture, additive: boolean) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3).fill(1);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = pointMaterial(map, additive);
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  flush(): void {
    const g = this.points.geometry;
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor']) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }

  setViewportHeight(h: number): void {
    this.material.uniforms.uScale!.value = h * 1.6;
  }
}

export class SmokeEmitter {
  readonly object: THREE.Points;
  private pool: PointPool;
  private age: Float32Array;
  private life: Float32Array;
  private vel: Float32Array;
  private seed: Float32Array;
  private next = 0;
  private acc = 0;

  constructor(readonly origin: THREE.Vector3, private rate = 5, count = 48) {
    this.pool = new PointPool(count, textures.smokePuff().map, false);
    this.object = this.pool.points;
    this.object.name = 'smoke';
    this.object.renderOrder = 5;
    this.age = new Float32Array(count).fill(999);
    this.life = new Float32Array(count).fill(1);
    this.vel = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    // Pre-warm so the plume exists on the first frame.
    for (let i = 0; i < 60 * 8; i++) this.update(1 / 60, 0, 1080);
  }

  update(dt: number, night: number, viewportH: number): void {
    this.pool.setViewportHeight(viewportH);
    this.acc += dt * this.rate;
    while (this.acc > 1) {
      this.acc -= 1;
      const i = this.next;
      this.next = (this.next + 1) % this.pool.n;
      this.age[i] = 0;
      this.life[i] = 4 + Math.random() * 2.5;
      this.seed[i] = Math.random();
      this.pool.pos[i * 3] = this.origin.x + (Math.random() - 0.5) * 0.15;
      this.pool.pos[i * 3 + 1] = this.origin.y;
      this.pool.pos[i * 3 + 2] = this.origin.z + (Math.random() - 0.5) * 0.15;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.1;
      this.vel[i * 3 + 1] = 0.55 + Math.random() * 0.25;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }
    const wd = globalUniforms.uWindDir.value;
    const ws = globalUniforms.uWindStrength.value;
    const sun = globalUniforms.uSunColor.value;
    const sky = globalUniforms.uSkyColor.value;
    for (let i = 0; i < this.pool.n; i++) {
      const a = (this.age[i]! += dt);
      const t = a / this.life[i]!;
      if (t >= 1) {
        this.pool.alpha[i] = 0;
        continue;
      }
      this.vel[i * 3]! += wd.x * ws * 0.22 * dt;
      this.vel[i * 3 + 2]! += wd.y * ws * 0.22 * dt;
      this.vel[i * 3 + 1]! *= 1 - dt * 0.18;
      this.pool.pos[i * 3]! += this.vel[i * 3]! * dt + Math.sin(a * 1.3 + this.seed[i]! * 6) * 0.004;
      this.pool.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pool.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.pool.size[i] = 0.55 + t * 2.4;
      this.pool.alpha[i] = Math.min(1, t * 6) * Math.pow(1 - t, 1.6) * 0.55;
      const lum = 0.75 + 0.25 * this.seed[i]!;
      const r = (sun.r * 0.6 + sky.r * 0.5) * lum * (1 - night * 0.55) + 0.05;
      const g = (sun.g * 0.6 + sky.g * 0.5) * lum * (1 - night * 0.55) + 0.05;
      const bb = (sun.b * 0.6 + sky.b * 0.5) * lum * (1 - night * 0.55) + 0.07;
      this.pool.color[i * 3] = r;
      this.pool.color[i * 3 + 1] = g;
      this.pool.color[i * 3 + 2] = bb;
    }
    this.pool.flush();
  }
}

/** Ambient motes around the camera focus. */
export class Ambience {
  readonly group = new THREE.Group();
  private motes: PointPool;
  private moteVel: Float32Array;
  private moteSeed: Float32Array;
  private leaves: THREE.InstancedMesh;
  private leafState: Float32Array; // x,y,z, rot, spin, fall, seed
  private leafCount = 90;
  private season: Season = 'spring';
  private weather: Weather = 'sun';
  private dummy = new THREE.Object3D();
  private halfExtent = 16;

  constructor(private heightAt: (x: number, z: number) => number) {
    this.group.name = 'ambience';
    const N = 260;
    this.motes = new PointPool(N, textures.softDot().map, true);
    this.moteVel = new Float32Array(N * 3);
    this.moteSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.moteSeed[i] = Math.random();
      this.motes.pos[i * 3] = (Math.random() - 0.5) * 2 * this.halfExtent;
      this.motes.pos[i * 3 + 1] = Math.random() * 3;
      this.motes.pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * this.halfExtent;
    }
    this.motes.points.renderOrder = 6;
    this.group.add(this.motes.points);

    const leafGeo = new THREE.PlaneGeometry(0.16, 0.11);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 });
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, this.leafCount);
    this.leaves.frustumCulled = false;
    this.leaves.castShadow = false;
    this.leafState = new Float32Array(this.leafCount * 7);
    const palette = [0xe07a2e, 0xd4452c, 0xf0b23c, 0xb8562a];
    const c = new THREE.Color();
    for (let i = 0; i < this.leafCount; i++) {
      this.leafState[i * 7] = (Math.random() - 0.5) * 2 * this.halfExtent;
      this.leafState[i * 7 + 1] = Math.random() * 6;
      this.leafState[i * 7 + 2] = (Math.random() - 0.5) * 2 * this.halfExtent;
      this.leafState[i * 7 + 3] = Math.random() * 6;
      this.leafState[i * 7 + 4] = 1 + Math.random() * 3;
      this.leafState[i * 7 + 5] = 0.35 + Math.random() * 0.4;
      this.leafState[i * 7 + 6] = Math.random();
      this.leaves.setColorAt(i, c.setHex(palette[i % palette.length]!));
    }
    this.group.add(this.leaves);
  }

  setSeason(s: Season): void {
    this.season = s;
  }
  setWeather(w: Weather): void {
    this.weather = w;
  }

  update(dt: number, time: number, center: THREE.Vector3, night: number, viewportH: number): void {
    this.motes.setViewportHeight(viewportH);
    const H = this.halfExtent;
    const wd = globalUniforms.uWindDir.value;
    const ws = globalUniforms.uWindStrength.value;
    const raining = this.weather === 'rain' || this.weather === 'storm';
    const fireflyAmt = this.season === 'winter' || raining ? 0 : THREE.MathUtils.smoothstep(night, 0.4, 0.9);
    const pollenAmt = (this.season === 'winter' || raining ? 0.25 : 1) * (1 - THREE.MathUtils.smoothstep(night, 0.2, 0.6));
    const sun = globalUniforms.uSunColor.value;
    for (let i = 0; i < this.motes.n; i++) {
      const s = this.moteSeed[i]!;
      let x = this.motes.pos[i * 3]!;
      let y = this.motes.pos[i * 3 + 1]!;
      let z = this.motes.pos[i * 3 + 2]!;
      const isFly = s < 0.35;
      const t = time * (0.3 + s * 0.4) + s * 100;
      if (isFly) {
        x += (Math.sin(t * 1.3) * 0.35 + Math.sin(t * 0.37) * 0.2) * dt;
        z += (Math.cos(t * 1.1) * 0.35 + Math.cos(t * 0.29) * 0.2) * dt;
        y += Math.sin(t * 0.9) * 0.2 * dt;
      } else {
        x += (wd.x * ws * 0.35 + Math.sin(t) * 0.15) * dt;
        z += (wd.y * ws * 0.35 + Math.cos(t * 0.8) * 0.15) * dt;
        y += Math.sin(t * 0.6) * 0.08 * dt;
      }
      // wrap around the camera focus
      if (x < center.x - H) x += 2 * H;
      if (x > center.x + H) x -= 2 * H;
      if (z < center.z - H) z += 2 * H;
      if (z > center.z + H) z -= 2 * H;
      const ground = this.heightAt(x, z);
      const minY = ground + (isFly ? 0.35 : 0.2);
      const maxY = ground + (isFly ? 1.8 : 3.2);
      if (y < minY) y = minY + 0.01;
      if (y > maxY) y = maxY - 0.01;
      this.motes.pos[i * 3] = x;
      this.motes.pos[i * 3 + 1] = y;
      this.motes.pos[i * 3 + 2] = z;
      if (isFly) {
        const blink = Math.max(0, Math.sin(time * (1.5 + s * 2) + s * 40));
        this.motes.size[i] = 0.07 + blink * 0.07;
        this.motes.alpha[i] = fireflyAmt * (0.2 + blink * blink * 0.8);
        this.motes.color[i * 3] = 1.6;
        this.motes.color[i * 3 + 1] = 1.5;
        this.motes.color[i * 3 + 2] = 0.55;
      } else {
        this.motes.size[i] = 0.05 + s * 0.05;
        this.motes.alpha[i] = pollenAmt * (0.12 + 0.12 * Math.sin(time * 2 + s * 30));
        this.motes.color[i * 3] = 0.6 + sun.r * 0.6;
        this.motes.color[i * 3 + 1] = 0.55 + sun.g * 0.6;
        this.motes.color[i * 3 + 2] = 0.4 + sun.b * 0.45;
      }
    }
    this.motes.flush();

    // Falling leaves (fall, or windy days).
    const leafAmt = this.season === 'fall' ? 1 : this.weather === 'wind' ? 0.6 : 0;
    this.leaves.visible = leafAmt > 0;
    if (leafAmt > 0) {
      const st = this.leafState;
      for (let i = 0; i < this.leafCount; i++) {
        const o = i * 7;
        const seed = st[o + 6]!;
        st[o]! += (wd.x * ws * 0.9 + Math.sin(time * 1.7 + seed * 20) * 0.4) * dt;
        st[o + 2]! += (wd.y * ws * 0.9 + Math.cos(time * 1.3 + seed * 20) * 0.4) * dt;
        st[o + 1]! -= st[o + 5]! * dt;
        st[o + 3]! += st[o + 4]! * dt;
        let x = st[o]!;
        let z = st[o + 2]!;
        if (x < center.x - H) x += 2 * H;
        if (x > center.x + H) x -= 2 * H;
        if (z < center.z - H) z += 2 * H;
        if (z > center.z + H) z -= 2 * H;
        st[o] = x;
        st[o + 2] = z;
        const g = this.heightAt(x, z);
        if (st[o + 1]! < g + 0.05) st[o + 1] = g + 4 + Math.random() * 3;
        this.dummy.position.set(x, st[o + 1]!, z);
        this.dummy.rotation.set(st[o + 3]!, st[o + 3]! * 0.7, Math.sin(st[o + 3]!) * 0.8);
        this.dummy.scale.setScalar(i < this.leafCount * leafAmt ? 1 : 0);
        this.dummy.updateMatrix();
        this.leaves.setMatrixAt(i, this.dummy.matrix);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
  }
}

/**
 * Honey bees buzzing around hive anchors: small dark-gold points on looping Lissajous paths
 * (hive → flower ring → back). Only on warm, dry days.
 */
export class Bees {
  readonly object: THREE.Points;
  private pool: PointPool;
  private seeds: Float32Array;
  private season: Season = 'spring';
  private weather: Weather = 'sun';

  constructor(private hives: { x: number; z: number }[], private heightAt: (x: number, z: number) => number, perHive = 9) {
    const n = Math.max(1, hives.length * perHive);
    this.pool = new PointPool(n, textures.softDot().map, false);
    this.object = this.pool.points;
    this.object.name = 'bees';
    this.object.renderOrder = 6;
    this.seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) this.seeds[i] = Math.random();
  }

  setSeason(s: Season): void {
    this.season = s;
  }
  setWeather(w: Weather): void {
    this.weather = w;
  }

  update(_dt: number, time: number, night: number, viewportH: number): void {
    this.pool.setViewportHeight(viewportH);
    const on = this.season !== 'winter' && this.weather !== 'rain' && this.weather !== 'storm' && this.weather !== 'snow' ? 1 - THREE.MathUtils.smoothstep(night, 0.1, 0.5) : 0;
    this.object.visible = on > 0.01 && this.hives.length > 0;
    if (!this.object.visible) return;
    const per = this.pool.n / this.hives.length;
    for (let i = 0; i < this.pool.n; i++) {
      const h = this.hives[Math.min(this.hives.length - 1, Math.floor(i / per))]!;
      const s = this.seeds[i]!;
      const t = time * (0.55 + s * 0.5) + s * 50;
      // Out-and-back loops to the flower ring (radius ~1.8 m) with a fast buzzing jitter.
      const reach = 0.5 + 1.4 * (0.5 + 0.5 * Math.sin(t * 0.7 + s * 9));
      const a = t * (s < 0.5 ? 1 : -1) + s * 6.28;
      const x = h.x + Math.cos(a) * reach + Math.sin(time * 23 + s * 90) * 0.03;
      const z = h.z + Math.sin(a * 1.3) * reach * 0.8 + Math.cos(time * 19 + s * 70) * 0.03;
      const y = this.heightAt(x, z) + 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.7 + s * 4)) + Math.sin(time * 31 + s * 40) * 0.02;
      this.pool.pos[i * 3] = x;
      this.pool.pos[i * 3 + 1] = y;
      this.pool.pos[i * 3 + 2] = z;
      this.pool.size[i] = 0.045;
      this.pool.alpha[i] = on * 0.95;
      const stripe = Math.sin(time * 40 + s * 30) > 0 ? 1 : 0.55;
      this.pool.color[i * 3] = 0.55 * stripe;
      this.pool.color[i * 3 + 1] = 0.38 * stripe;
      this.pool.color[i * 3 + 2] = 0.06;
    }
    this.pool.flush();
  }
}

/**
 * One-shot particle bursts (dirt puffs when hoeing, water droplets, harvest sparkle).
 *   const fx = new BurstFX();  scene.add(fx.object);
 *   fx.emit(pos, { color: 0x8a5a3a, count: 14, speed: 1.6, size: 0.12, gravity: 6 });
 *   fx.update(dt, viewportH) every frame.
 */
export class BurstFX {
  readonly object: THREE.Points;
  private pool: PointPool;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private grav: Float32Array;
  private size0: Float32Array;
  private next = 0;

  constructor(count = 640) {
    this.pool = new PointPool(count, textures.softDot().map, false);
    this.object = this.pool.points;
    this.object.name = 'bursts';
    this.object.renderOrder = 6;
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count).fill(99);
    this.life = new Float32Array(count).fill(1);
    this.grav = new Float32Array(count);
    this.size0 = new Float32Array(count);
  }

  emit(
    p: THREE.Vector3,
    o: { color: number; count?: number; speed?: number; size?: number; gravity?: number; life?: number; up?: number; spread?: number },
  ): void {
    const c = new THREE.Color(o.color);
    const n = o.count ?? 12;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.pool.n;
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 1.5) * (0.4 + Math.random() * 0.8);
      const spread = o.spread ?? 0.15;
      this.pool.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pool.pos[i * 3 + 1] = p.y + Math.random() * 0.1;
      this.pool.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = Math.cos(a) * sp * 0.6;
      this.vel[i * 3 + 1] = (o.up ?? 1.2) * sp;
      this.vel[i * 3 + 2] = Math.sin(a) * sp * 0.6;
      this.age[i] = 0;
      this.life[i] = (o.life ?? 0.7) * (0.7 + Math.random() * 0.6);
      this.grav[i] = o.gravity ?? 6;
      this.size0[i] = (o.size ?? 0.1) * (0.6 + Math.random() * 0.8);
      const v = 0.85 + Math.random() * 0.3;
      this.pool.color[i * 3] = c.r * v;
      this.pool.color[i * 3 + 1] = c.g * v;
      this.pool.color[i * 3 + 2] = c.b * v;
    }
  }

  /** Directional spray (sprinklers): particles leave along (dx, dz) with an upward arc. */
  emitDir(p: THREE.Vector3, dx: number, dz: number, o: { color: number; count?: number; speed?: number; size?: number; gravity?: number; life?: number }): void {
    const c = new THREE.Color(o.color);
    for (let k = 0; k < (o.count ?? 2); k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.pool.n;
      const sp = (o.speed ?? 1.5) * (0.8 + Math.random() * 0.4);
      const j = (Math.random() - 0.5) * 0.3;
      this.pool.pos[i * 3] = p.x;
      this.pool.pos[i * 3 + 1] = p.y;
      this.pool.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = (dx + j) * sp;
      this.vel[i * 3 + 1] = sp * 0.9;
      this.vel[i * 3 + 2] = (dz - j) * sp;
      this.age[i] = 0;
      this.life[i] = (o.life ?? 0.6) * (0.8 + Math.random() * 0.4);
      this.grav[i] = o.gravity ?? 6;
      this.size0[i] = (o.size ?? 0.06) * (0.7 + Math.random() * 0.6);
      this.pool.color[i * 3] = c.r;
      this.pool.color[i * 3 + 1] = c.g;
      this.pool.color[i * 3 + 2] = c.b;
    }
  }

  update(dt: number, viewportH: number): void {
    this.pool.setViewportHeight(viewportH);
    for (let i = 0; i < this.pool.n; i++) {
      const a = (this.age[i]! += dt);
      const t = a / this.life[i]!;
      if (t >= 1) {
        this.pool.alpha[i] = 0;
        continue;
      }
      this.vel[i * 3 + 1]! -= this.grav[i]! * dt;
      this.pool.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pool.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pool.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.pool.size[i] = this.size0[i]! * (1 - t * 0.5);
      this.pool.alpha[i] = Math.min(1, (1 - t) * 2.2);
    }
    this.pool.flush();
  }
}
