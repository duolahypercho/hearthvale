/**
 * Interior FX: hearth flames (additive noise-shader cards), crackling sparks, steam wisps.
 */
import * as THREE from 'three';
import { textures } from '../../render/textures';

const FLAME_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FLAME_FS = /* glsl */ `
uniform float uTime; uniform float uSeed; uniform float uGain;
varying vec2 vUv;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
float tongue(vec2 uv, float cx, float h, float w, float t, float sd) {
  // One licking tongue: a teardrop rising from the base, its upper half swaying + necking with noise.
  float y = uv.y / h;
  float n = fbm(vec2(uv.x * 3.1 + sd, uv.y * 2.4 - t * 2.1));
  float sway = (sin(t * 2.6 + sd * 4.0 + y * 3.4) * 0.06 + (n - 0.5) * 0.16) * y * y;
  float halfW = w * mix(1.0, 0.04, smoothstep(0.05, 1.0, y)) * (0.65 + 0.35 * smoothstep(0.0, 0.2, y));
  float d = abs(uv.x - cx - sway);
  float m = 1.0 - smoothstep(halfW * 0.55, halfW + 0.02, d);
  return m * (1.0 - smoothstep(0.82, 1.0, y + (n - 0.5) * 0.25)) * smoothstep(0.0, 0.08, uv.y);
}
void main() {
  vec2 uv = vUv;
  float t = uTime + uSeed * 7.0;
  // r13: three separate licking tongues per card (a tall middle one, two shorter side licks that
  // flicker in height) in saturated LINEAR colours under normal alpha blending — the old additive cards
  // stacked into a pale white-yellow lamp with a hood of glow above the logs.
  float f = 0.0;
  float core = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float sd = uSeed * 1.7 + fi * 2.31;
    float cx = 0.5 + (fi - 1.0) * 0.2 + sin(t * 0.9 + sd) * 0.03;
    float h = (i == 1 ? 0.95 : 0.62) * (0.82 + 0.18 * sin(t * (3.0 + fi) + sd * 2.0));
    float w = i == 1 ? 0.2 : 0.14;
    float m = tongue(uv, cx, h, w, t, sd);
    f = max(f, m);
    // Inner heat: the same tongue, narrower + shorter.
    core = max(core, tongue(uv, cx, h * 0.55, w * 0.5, t, sd + 0.5));
  }
  float n2 = fbm(vec2(uv.x * 7.0 - uSeed, uv.y * 5.0 - t * 3.4));
  // Gradient: deep red rims + tips → saturated orange body → a hot yellow-orange heart low down.
  vec3 deep = vec3(0.32, 0.018, 0.002);
  vec3 mid  = vec3(1.0, 0.2, 0.012);
  vec3 hot  = vec3(1.0, 0.52, 0.07);
  float body = smoothstep(0.15, 0.75, f) * (1.0 - smoothstep(0.55, 1.0, uv.y));
  vec3 col = mix(deep, mid, body);
  col = mix(col, hot, core * (1.0 - smoothstep(0.05, 0.45, uv.y)) * (0.75 + 0.25 * n2));
  // Brighter only at the base (that's all the bloom picks up).
  col *= (0.7 + 0.5 * uGain) * (1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.25, uv.y)) * core);
  float a = clamp(f * (0.82 + 0.18 * n2), 0.0, 1.0) * clamp(uGain * 1.6, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

/** A small campfire of crossed flame cards. `gain` 0..~2.5 (flicker is built in). */
export class HearthFlames {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  gain = 1.4;

  constructor(width = 0.7, height = 0.62, cards = 5) {
    this.group.name = 'flames';
    this.group.userData.noAO = true;
    for (let i = 0; i < cards; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 1.37 }, uGain: { value: 1 } },
        vertexShader: FLAME_VS,
        fragmentShader: FLAME_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.mats.push(m);
      const w = width * (0.55 + 0.25 * ((i * 7) % 3) / 2);
      const h = height * (0.75 + 0.3 * ((i * 5) % 4) / 3);
      const g = new THREE.PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.x = (i / (cards - 1) - 0.5) * width * 0.55;
      mesh.position.z = ((i * 3) % 3 - 1) * 0.05;
      mesh.rotation.y = (i / cards) * Math.PI;
      mesh.renderOrder = 7;
      this.group.add(mesh);
    }
  }

  update(t: number): void {
    for (const m of this.mats) {
      m.uniforms.uTime!.value = t;
      m.uniforms.uGain!.value = this.gain;
    }
  }
}

/** Sparks + a lazy curl of smoke above a fire, or steam from a kettle spout. */
export class Wisps {
  readonly points: THREE.Points;
  private age: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private acc = 0;

  constructor(
    private origin: THREE.Vector3,
    private opts: { rate: number; life: number; rise: number; spread: number; size: number; color: number; additive: boolean; count?: number; opacity?: number },
  ) {
    const n = opts.count ?? 60;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-999), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.age = new Float32Array(n).fill(99);
    this.life = new Float32Array(n).fill(1);
    this.vel = new Float32Array(n * 3);
    const m = new THREE.PointsMaterial({
      size: opts.size,
      map: (opts.additive ? textures.softDot() : textures.smokePuff()).map,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: opts.opacity ?? 1,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.userData.noAO = true;
    this.points.renderOrder = 8;
  }

  update(dt: number, strength = 1): void {
    const n = this.age.length;
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.points.geometry.attributes.color as THREE.BufferAttribute;
    this.acc += dt * this.opts.rate * strength;
    while (this.acc > 1) {
      this.acc -= 1;
      const i = this.next;
      this.next = (this.next + 1) % n;
      this.age[i] = 0;
      this.life[i] = this.opts.life * (0.6 + Math.random() * 0.8);
      pos.setXYZ(i, this.origin.x + (Math.random() - 0.5) * this.opts.spread, this.origin.y, this.origin.z + (Math.random() - 0.5) * this.opts.spread * 0.6);
      this.vel[i * 3] = (Math.random() - 0.5) * 0.25;
      this.vel[i * 3 + 1] = this.opts.rise * (0.7 + Math.random() * 0.6);
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
    }
    const c = new THREE.Color(this.opts.color);
    for (let i = 0; i < n; i++) {
      const a = (this.age[i]! += dt);
      const t = a / this.life[i]!;
      if (t >= 1) {
        col.setXYZ(i, 0, 0, 0);
        continue;
      }
      const w = Math.sin(a * 6 + i) * 0.3;
      pos.setXYZ(i, pos.getX(i) + (this.vel[i * 3]! + w) * dt, pos.getY(i) + this.vel[i * 3 + 1]! * dt, pos.getZ(i) + this.vel[i * 3 + 2]! * dt);
      const k = Math.min(1, t * 6) * (1 - t);
      col.setXYZ(i, c.r * k, c.g * k, c.b * k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
