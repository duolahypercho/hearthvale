/**
 * Atmospheric weather set pieces (owned by the weather system, one draw call each, hidden when idle):
 *  - LightningBolt: a fractal, branching bolt from above the frame down to a strike point, drawn as
 *    camera-facing additive ribbons (hot white core + violet glow) with a ground-impact bloom disc.
 *  - FogBank: morning ground mist — four translucent layers draped over the terrain (height texture)
 *    at 0.25–2.2 m, drifting noise wisps lit by the low sun, thinned on steep slopes.
 *  - Rainbow: a soft spectral arc (+ faint secondary) hung over the view after rain. The diorama
 *    camera never sees the horizon, so it is placed relative to the camera and drawn over the scene
 *    before post (it still gets the tilt-shift + grade).
 */
import * as THREE from 'three';
import { globalUniforms } from './uniforms';
import { NOISE_GLSL } from './shaders/noise';
import type { HeightSource } from './precipitation';

// ───────────────────────────────────────────── lightning

interface BoltSeg {
  a: THREE.Vector3;
  b: THREE.Vector3;
  w: number;
  /** Brightness (branches are dimmer). */
  k: number;
}

/** Deterministic-ish PRNG for bolt shapes (strikes are cosmetic; seeded so demos repeat). */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LightningBolt {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();
  private maxVerts = 4000;
  /** Current strike point (world). */
  readonly strike = new THREE.Vector3();

  constructor() {
    const pos = new Float32Array(this.maxVerts * 3);
    const uv = new Float32Array(this.maxVerts * 2);
    const k = new Float32Array(this.maxVerts);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aK', new THREE.BufferAttribute(k, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uAlpha: { value: 0 }, uCore: { value: new THREE.Color(1.0, 0.98, 1.0) }, uGlow: { value: new THREE.Color(0.55, 0.5, 1.0) } },
      vertexShader: /* glsl */ `
        attribute float aK;
        varying vec2 vUv;
        varying float vK;
        void main() {
          vUv = uv;
          vK = aK;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        uniform vec3 uCore;
        uniform vec3 uGlow;
        varying vec2 vUv;
        varying float vK;
        void main() {
          // uv.x: -1..1 across the ribbon; uv.y < 0 marks the ground-impact disc.
          if (vUv.y < -0.5) {
            float d = length(vec2(vUv.x, vUv.y + 2.0) * 2.0 - vec2(1.0));
            float g = exp(-d * d * 4.0);
            gl_FragColor = vec4((uGlow * g * 0.5 + uCore * pow(g, 6.0) * 0.8) * uAlpha, 1.0);
            return;
          }
          float x = abs(vUv.x);
          float core = smoothstep(0.22, 0.0, x);
          float glow = exp(-x * x * 5.0);
          vec3 c = (uCore * core * 2.2 + uGlow * glow * 0.8) * vK * uAlpha;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    this.mesh.name = 'lightning';
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'weather';
  }

  /** Build a new bolt from high above `ground` down to it, facing `camPos`. */
  build(ground: THREE.Vector3, camPos: THREE.Vector3, seed: number): void {
    const rnd = prng(seed);
    this.strike.copy(ground);
    const top = ground.clone().add(new THREE.Vector3((rnd() - 0.5) * 10, 34 + rnd() * 8, -6 - rnd() * 6));
    const segs: BoltSeg[] = [];
    // Midpoint displacement: jagged main channel.
    const channel = (a: THREE.Vector3, b: THREE.Vector3, depth: number, w: number, k: number, jag: number, branchP: number): void => {
      let pts = [a.clone(), b.clone()];
      for (let d = 0; d < depth; d++) {
        const next: THREE.Vector3[] = [pts[0]!];
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i]!;
          const q = pts[i + 1]!;
          const len = p.distanceTo(q);
          const mid = p.clone().lerp(q, 0.4 + rnd() * 0.2);
          mid.x += (rnd() - 0.5) * len * jag;
          mid.z += (rnd() - 0.5) * len * jag;
          mid.y += (rnd() - 0.5) * len * jag * 0.25;
          next.push(mid, q);
        }
        pts = next;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const f = i / (pts.length - 1);
        segs.push({ a: pts[i]!, b: pts[i + 1]!, w: w * (1 - f * 0.45), k });
        if (branchP > 0 && rnd() < branchP && f > 0.1 && f < 0.8 && segs.length < 400) {
          const from = pts[i]!;
          const dir = pts[i + 1]!.clone().sub(from).normalize();
          const len = (3 + rnd() * 7) * (1 - f * 0.6);
          const end = from.clone().add(new THREE.Vector3(dir.x + (rnd() - 0.5) * 1.6, -0.6 - rnd() * 0.6, dir.z + (rnd() - 0.5) * 1.6).normalize().multiplyScalar(len));
          channel(from, end, 4, w * 0.45, k * 0.6, 0.5, 0);
        }
      }
    };
    channel(top, ground, 7, 0.42, 1, 0.42, 0.09);

    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const uv = this.geo.attributes.uv as THREE.BufferAttribute;
    const kk = this.geo.attributes.aK as THREE.BufferAttribute;
    let v = 0;
    const push = (p: THREE.Vector3, u: number, w: number, k: number): void => {
      if (v >= this.maxVerts) return;
      pos.setXYZ(v, p.x, p.y, p.z);
      uv.setXY(v, u, w);
      kk.setX(v, k);
      v++;
    };
    const side = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();
    for (const s of segs) {
      const dir = s.b.clone().sub(s.a).normalize();
      toCam.copy(camPos).sub(s.a).normalize();
      side.crossVectors(dir, toCam).normalize();
      // Wide ribbon: the glow falls off across it, the core is the middle fifth.
      const w = s.w * 2.4;
      // Extend a touch along the segment so joints overlap.
      const a = s.a.clone().addScaledVector(dir, -s.w * 0.3);
      const b = s.b.clone().addScaledVector(dir, s.w * 0.3);
      p0.copy(a).addScaledVector(side, -w);
      p1.copy(a).addScaledVector(side, w);
      p2.copy(b).addScaledVector(side, w);
      p3.copy(b).addScaledVector(side, -w);
      push(p0, -1, 0, s.k);
      push(p1, 1, 0, s.k);
      push(p2, 1, 1, s.k);
      push(p0, -1, 0, s.k);
      push(p2, 1, 1, s.k);
      push(p3, -1, 1, s.k);
    }
    // Ground impact: a flat glowing disc (uv.y marks it).
    const R = 2.4;
    const g = ground.clone().setY(ground.y + 0.15);
    const c0 = g.clone().add(new THREE.Vector3(-R, 0, -R));
    const c1 = g.clone().add(new THREE.Vector3(R, 0, -R));
    const c2 = g.clone().add(new THREE.Vector3(R, 0, R));
    const c3 = g.clone().add(new THREE.Vector3(-R, 0, R));
    // Disc uv: x 0..1, y -2..-1 (the fragment shader keys on uv.y < -0.5).
    const disc: [THREE.Vector3, number, number][] = [
      [c0, 0, 0],
      [c1, 1, 0],
      [c2, 1, 1],
      [c0, 0, 0],
      [c2, 1, 1],
      [c3, 0, 1],
    ];
    for (const [p, x, y] of disc) push(p, x, y - 2, 1);
    pos.needsUpdate = uv.needsUpdate = kk.needsUpdate = true;
    this.geo.setDrawRange(0, v);
  }

  set alpha(a: number) {
    this.mat.uniforms.uAlpha!.value = a;
    this.mesh.visible = a > 0.002;
  }
}

// ───────────────────────────────────────────── ground fog

export class FogBank {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private readonly size = 70;

  constructor(layers = 4, seg = 56) {
    const g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1, seg, seg);
    plane.rotateX(-Math.PI / 2);
    g.index = plane.index;
    g.setAttribute('position', plane.attributes.position!);
    g.setAttribute('uv', plane.attributes.uv!);
    g.instanceCount = layers;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uCenter: { value: new THREE.Vector3() },
          uSize: { value: this.size },
          uLayers: { value: layers },
          uAmount: { value: 0 },
          uHeight: { value: null },
          uHOrigin: { value: new THREE.Vector2() },
          uHSize: { value: new THREE.Vector2(1, 1) },
          uWater: { value: -99 },
          uLit: { value: new THREE.Color(1, 0.95, 0.88) },
          uShade: { value: new THREE.Color(0.7, 0.76, 0.84) },
        },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        uniform vec3 uCenter;
        uniform float uSize;
        uniform float uLayers;
        uniform sampler2D uHeight;
        uniform vec2 uHOrigin;
        uniform vec2 uHSize;
        uniform float uWater;
        varying vec3 vW;
        varying float vLayer;
        varying float vSteep;
        varying float vEdge;
        float gh(vec2 xz) { return max(texture2D(uHeight, (xz - uHOrigin) / uHSize).r, uWater); }
        void main() {
          float L = float(gl_InstanceID);
          vLayer = L / max(uLayers - 1.0, 1.0);
          vec3 p = position * uSize;
          p.xz += uCenter.xz;
          float h = gh(p.xz);
          // Slope from a few taps: the mist pools in the hollows and thins on cliff faces.
          float e = 1.2;
          float hx = gh(p.xz + vec2(e, 0.0)) - gh(p.xz - vec2(e, 0.0));
          float hz = gh(p.xz + vec2(0.0, e)) - gh(p.xz - vec2(0.0, e));
          vSteep = length(vec2(hx, hz)) / (2.0 * e);
          // Smooth the drape so layers don't follow every root bump.
          float hs = (h * 2.0 + gh(p.xz + vec2(2.5, 0.0)) + gh(p.xz - vec2(2.5, 0.0)) + gh(p.xz + vec2(0.0, 2.5)) + gh(p.xz - vec2(0.0, 2.5))) / 6.0;
          p.y = max(h, hs) + 0.25 + vLayer * 1.95;
          vW = p;
          vEdge = 1.0 - smoothstep(0.32, 0.5, max(abs(position.x), abs(position.z)));
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uAmount;
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform vec3 uLit;
        uniform vec3 uShade;
        varying vec3 vW;
        varying float vLayer;
        varying float vSteep;
        varying float vEdge;
        ${NOISE_GLSL}
        void main() {
          vec2 drift = uWindDir * uTime * (0.25 + vLayer * 0.2);
          vec2 q = vW.xz * (0.09 - vLayer * 0.02) - drift * 0.09;
          float n = hvFbm(q + vLayer * 7.3);
          float wisp = hvNoise(vW.xz * 0.35 + vec2(uTime * 0.04, -uTime * 0.03) + vLayer * 3.1);
          // Banks with clear gaps between them (the ground shows through), feathered wisps at the edges.
          float d = smoothstep(0.48, 0.9, n * 0.85 + wisp * 0.3);
          float a = d * (0.17 - vLayer * 0.08) * uAmount * vEdge;
          a *= 1.0 - smoothstep(0.35, 0.9, vSteep);
          if (a < 0.004) discard;
          vec3 c = mix(uShade, uLit, 0.35 + 0.65 * n);
          gl_FragColor = vec4(c, a);
          #include <fog_fragment>
        }`,
    });
    this.mat.uniforms.uTime = globalUniforms.uTime;
    this.mat.uniforms.uWindDir = globalUniforms.uWindDir;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this.mesh.name = 'fog-bank';
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'weather';
  }

  setHeightSource(h: HeightSource | null): void {
    const u = this.mat.uniforms;
    u.uHeight!.value = h?.tex ?? null;
    if (h) {
      (u.uHOrigin!.value as THREE.Vector2).copy(h.origin);
      (u.uHSize!.value as THREE.Vector2).copy(h.size);
      u.uWater!.value = h.waterLevel;
    }
  }

  update(center: THREE.Vector3, amount: number): void {
    const u = this.mat.uniforms;
    // Snap the drape to a coarse grid so the mist doesn't swim over the ground as the camera follows.
    const cell = this.size / 56;
    (u.uCenter!.value as THREE.Vector3).set(Math.round(center.x / cell) * cell, center.y, Math.round(center.z / cell) * cell);
    u.uAmount!.value = amount;
    const sun = globalUniforms.uSunColor.value;
    const sky = globalUniforms.uSkyColor.value;
    const hor = globalUniforms.uHorizonColor.value;
    const night = globalUniforms.uNight.value;
    (u.uLit!.value as THREE.Color).setRGB(0.72 + sun.r * 0.3 + hor.r * 0.1, 0.72 + sun.g * 0.28 + hor.g * 0.1, 0.72 + sun.b * 0.22 + hor.b * 0.1).multiplyScalar(1 - night * 0.7);
    (u.uShade!.value as THREE.Color).setRGB(0.55 + sky.r * 0.3, 0.6 + sky.g * 0.3, 0.68 + sky.b * 0.3).multiplyScalar(1 - night * 0.75);
    this.mesh.visible = amount > 0.01 && u.uHeight!.value !== null;
  }
}

// ───────────────────────────────────────────── rainbow

export class Rainbow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.PlaneGeometry(2, 2);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      uniforms: { uAmount: { value: 0 }, uAspect: { value: 1.6 }, uTime: globalUniforms.uTime },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // Full-screen quad in clip space, drawn with the scene (before post) so it gets the grade + tilt-shift.
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmount;
        uniform float uAspect;
        uniform float uTime;
        varying vec2 vUv;
        ${NOISE_GLSL}
        vec3 spectrum(float t) {
          // t: 0 inner (violet) .. 1 outer (red)
          vec3 c = vec3(0.0);
          c += vec3(0.55, 0.25, 0.85) * exp(-pow((t - 0.05) * 7.0, 2.0));
          c += vec3(0.25, 0.4, 1.0) * exp(-pow((t - 0.22) * 7.0, 2.0));
          c += vec3(0.2, 0.85, 0.55) * exp(-pow((t - 0.42) * 7.0, 2.0));
          c += vec3(1.0, 0.92, 0.3) * exp(-pow((t - 0.6) * 7.0, 2.0));
          c += vec3(1.0, 0.55, 0.2) * exp(-pow((t - 0.76) * 7.0, 2.0));
          c += vec3(1.0, 0.25, 0.25) * exp(-pow((t - 0.92) * 7.0, 2.0));
          return c;
        }
        void main() {
          vec2 p = (vUv - vec2(0.4, -0.95)) * vec2(uAspect, 1.0);
          float r = length(p);
          float R = 1.72;
          float W = 0.085;
          float t = (r - (R - W)) / (2.0 * W);
          float band = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.88, 1.0, t));
          vec3 c = spectrum(clamp(t, 0.0, 1.0)) * band;
          // Faint secondary bow (reversed colours) and the brighter sky inside the primary.
          float t2 = (r - (R + 0.22)) / (2.0 * W * 1.3);
          c += spectrum(1.0 - clamp(t2, 0.0, 1.0)) * smoothstep(0.0, 0.2, t2) * (1.0 - smoothstep(0.8, 1.0, t2)) * 0.28;
          c += vec3(0.08, 0.08, 0.1) * smoothstep(R - W, R - W - 0.5, r) * smoothstep(R - W - 1.2, R - W - 0.2, r);
          // Fades out towards the bottom of the frame and where it meets the screen edge; soft breakup.
          float fade = smoothstep(0.08, 0.55, vUv.y) * (0.75 + 0.25 * hvNoise(vec2(atan(p.y, p.x) * 6.0, uTime * 0.05)));
          gl_FragColor = vec4(c * fade * uAmount * 0.36, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    this.mesh.name = 'rainbow';
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'weather';
  }

  update(amount: number, aspect: number): void {
    this.mat.uniforms.uAmount!.value = amount * (1 - globalUniforms.uNight.value);
    this.mat.uniforms.uAspect!.value = aspect;
    this.mesh.visible = this.mat.uniforms.uAmount!.value > 0.01;
  }
}
