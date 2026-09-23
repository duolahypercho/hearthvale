/**
 * Atmospheric weather set pieces (owned by the weather system, one draw call each, hidden when idle):
 *  - LightningBolt: a jagged, forking bolt from above the frame down to a strike point, drawn as
 *    screen-space additive ribbons (crisp 2-3 px white core, tight halo, soft blue glow) with a
 *    ground-flash disc.
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
  private maxVerts = 6000;
  /** Current strike point (world). */
  readonly strike = new THREE.Vector3();

  constructor() {
    const mk = (n: number) => new THREE.BufferAttribute(new Float32Array(this.maxVerts * n), n).setUsage(THREE.DynamicDrawUsage);
    // Screen-space ribbons: every vertex carries both segment ends and expands in pixels in the
    // vertex shader, so the bolt is a crisp 2-3 px core inside a 12-20 px glow at any distance.
    this.geo.setAttribute('position', mk(3));
    this.geo.setAttribute('aB', mk(3));
    this.geo.setAttribute('aSide', mk(2));
    this.geo.setAttribute('aW', mk(2));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uAlpha: { value: 0 },
        uRes: { value: new THREE.Vector2(1920, 1080) },
        uCore: { value: new THREE.Color(1.0, 0.99, 1.0) },
        uGlow: { value: new THREE.Color(0.52, 0.6, 1.0) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aB;
        attribute vec2 aSide;
        attribute vec2 aW;
        uniform vec2 uRes;
        varying float vPx;
        varying float vK;
        varying float vDisc;
        varying vec2 vDiscUv;
        void main() {
          vK = aW.y;
          vDisc = 0.0;
          vDiscUv = vec2(0.0);
          if (aW.x < 0.0) {
            // Ground flash disc (world-space quad, corners in aSide).
            vDisc = 1.0;
            vDiscUv = aSide;
            vPx = 0.0;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
            return;
          }
          vec4 ca = projectionMatrix * viewMatrix * vec4(position, 1.0);
          vec4 cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
          vec2 sa = ca.xy / ca.w * uRes * 0.5;
          vec2 sb = cb.xy / cb.w * uRes * 0.5;
          vec2 d = normalize(sb - sa + 1e-5);
          vec2 nrm = vec2(-d.y, d.x);
          // aSide.x: -1 / 1 across, aSide.y: 0 = start, 1 = end (joints overlap by a pixel or two).
          vec4 c = aSide.y < 0.5 ? ca : cb;
          vec2 off = (nrm * aSide.x * aW.x + d * (aSide.y < 0.5 ? -1.5 : 1.5)) / (uRes * 0.5) * c.w;
          c.xy += off;
          vPx = aSide.x * aW.x;
          gl_Position = c;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        uniform vec3 uCore;
        uniform vec3 uGlow;
        varying float vPx;
        varying float vK;
        varying float vDisc;
        varying vec2 vDiscUv;
        void main() {
          if (vDisc > 0.5) {
            float r = length(vDiscUv);
            float g = exp(-r * r * 5.0);
            gl_FragColor = vec4((uGlow * g * 0.55 + uCore * pow(g, 5.0) * 0.9) * uAlpha, 1.0);
            return;
          }
          float px = abs(vPx);
          // Crisp white-hot core (~2.5 px) + tight bright halo + wide soft glow.
          float coreW = 1.2 + vK * 0.5;
          float core = 1.0 - smoothstep(coreW, coreW + 0.9, px);
          float halo = exp(-px * px / 12.0);
          float glow = exp(-px * px / 90.0);
          vec3 c = uCore * core * 3.0 + mix(uGlow, uCore, 0.3) * halo * 0.45 + uGlow * glow * 0.22;
          gl_FragColor = vec4(c * vK * uAlpha, 1.0);
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

  /** Drawing-buffer size (pixel widths are in these units). */
  setResolution(w: number, h: number): void {
    (this.mat.uniforms.uRes!.value as THREE.Vector2).set(w, h);
  }

  /** Build a new bolt from high above `ground` down to it. */
  build(ground: THREE.Vector3, _camPos: THREE.Vector3, seed: number): void {
    const rnd = prng(seed);
    this.strike.copy(ground);
    // The channel leaves the frame top (well below the lens: the diorama camera sits ~17 m up), leaning
    // away from the camera so the whole bolt reads as one jagged stroke down the screen.
    const top = ground.clone().add(new THREE.Vector3((rnd() - 0.5) * 6, 13 + rnd() * 3, -9 - rnd() * 4));
    const segs: BoltSeg[] = [];
    // Midpoint displacement with sharp kinks (5-8 zig-zags per 10 m on the main channel).
    const channel = (a: THREE.Vector3, b: THREE.Vector3, depth: number, jag: number): THREE.Vector3[] => {
      let pts = [a.clone(), b.clone()];
      for (let d = 0; d < depth; d++) {
        const next: THREE.Vector3[] = [pts[0]!];
        const j = jag * (d < 2 ? 1.0 : 0.8);
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i]!;
          const q = pts[i + 1]!;
          const len = p.distanceTo(q);
          const mid = p.clone().lerp(q, 0.35 + rnd() * 0.3);
          // Mostly sideways kinks (across the screen), little in depth.
          mid.x += (rnd() - 0.5) * len * j;
          mid.z += (rnd() - 0.5) * len * j * 0.3;
          mid.y += (rnd() - 0.5) * len * j * 0.15;
          next.push(mid, q);
        }
        pts = next;
      }
      return pts;
    };
    // Pixel widths: main channel thickest where it leaves the cloud; forks thinner and dimmer.
    const emit = (pts: THREE.Vector3[], w0: number, w1: number, k: number): void => {
      for (let i = 0; i < pts.length - 1; i++) {
        const f = i / (pts.length - 1);
        segs.push({ a: pts[i]!, b: pts[i + 1]!, w: THREE.MathUtils.lerp(w0, w1, f), k: k * (0.85 + rnd() * 0.2) });
      }
    };
    const main = channel(top, ground, 6, 0.62);
    emit(main, 16, 13, 1);
    // 2-4 forks peeling off the upper two thirds, each with a twig or two.
    const forks = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < forks; k++) {
      const fi = Math.floor((0.1 + rnd() * 0.55) * (main.length - 2));
      const from = main[fi]!;
      const dir = main[fi + 1]!.clone().sub(from).normalize();
      const len = 6 + rnd() * 9;
      const side = new THREE.Vector3(rnd() - 0.5, 0, (rnd() - 0.5) * 0.5).normalize();
      const end = from.clone().add(dir.clone().multiplyScalar(0.5).add(side.multiplyScalar(0.9)).add(new THREE.Vector3(0, -0.8, 0)).normalize().multiplyScalar(len));
      const fp = channel(from, end, 4, 0.6);
      emit(fp, 11, 6, 0.6);
      for (let j = 0; j < 2; j++) {
        const si = 1 + Math.floor(rnd() * (fp.length - 3));
        const sf = fp[si]!;
        const se = sf.clone().add(new THREE.Vector3((rnd() - 0.5) * 2, -0.7 - rnd(), (rnd() - 0.5) * 1).normalize().multiplyScalar(1.5 + rnd() * 2.5));
        emit(channel(sf, se, 3, 0.6), 7, 4, 0.4);
      }
    }

    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const bb = this.geo.attributes.aB as THREE.BufferAttribute;
    const sd = this.geo.attributes.aSide as THREE.BufferAttribute;
    const ww = this.geo.attributes.aW as THREE.BufferAttribute;
    let v = 0;
    const push = (a: THREE.Vector3, b: THREE.Vector3, sx: number, sy: number, w: number, k: number): void => {
      if (v >= this.maxVerts) return;
      pos.setXYZ(v, a.x, a.y, a.z);
      bb.setXYZ(v, b.x, b.y, b.z);
      sd.setXY(v, sx, sy);
      ww.setXY(v, w, k);
      v++;
    };
    for (const s of segs) {
      push(s.a, s.b, -1, 0, s.w, s.k);
      push(s.a, s.b, 1, 0, s.w, s.k);
      push(s.a, s.b, 1, 1, s.w, s.k);
      push(s.a, s.b, -1, 0, s.w, s.k);
      push(s.a, s.b, 1, 1, s.w, s.k);
      push(s.a, s.b, -1, 1, s.w, s.k);
    }
    // Ground flash: a flat glowing disc (aW.x < 0 marks it; corners in aSide).
    const R = 3.2;
    const g = ground.clone().setY(ground.y + 0.12);
    const corner = (x: number, z: number) => g.clone().add(new THREE.Vector3(x * R, 0, z * R));
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const) push(corner(x, z), g, x, z, -1, 1);
    pos.needsUpdate = bb.needsUpdate = sd.needsUpdate = ww.needsUpdate = true;
    this.geo.setDrawRange(0, v);
  }

  set alpha(a: number) {
    this.mat.uniforms.uAlpha!.value = a;
    this.mesh.visible = a > 0.002;
  }
}

// ───────────────────────────────────────────── strike scorch

/**
 * Scorch marks where lightning hits: a charred, cracked disc draped on the terrain (height texture)
 * with glowing ember cracks that cool within seconds; the mark itself fades over ~40 s. Up to 4 at
 * once, one draw call.
 */
export class StrikeScorch {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private slot = 0;
  private readonly max = 4;

  constructor() {
    const plane = new THREE.PlaneGeometry(1, 1, 10, 10);
    plane.rotateX(-Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.attributes.position!);
    g.setAttribute('uv', plane.attributes.uv!);
    g.setAttribute('aStrike', new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4).fill(-999), 4));
    g.instanceCount = this.max;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uHeight: { value: null }, uHOrigin: { value: new THREE.Vector2() }, uHSize: { value: new THREE.Vector2(1, 1) }, uWater: { value: -99 }, uNow: { value: 0 } },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        uniform sampler2D uHeight;
        uniform vec2 uHOrigin;
        uniform vec2 uHSize;
        uniform float uWater;
        uniform float uNow;
        attribute vec4 aStrike;
        varying vec2 vUv;
        varying float vAge;
        void main() {
          vUv = uv;
          vAge = uNow - aStrike.w;
          vec3 p = vec3(aStrike.x + position.x * 3.4, 0.0, aStrike.z + position.z * 3.4);
          p.y = max(texture2D(uHeight, (p.xz - uHOrigin) / uHSize).r, uWater) + 0.04;
          if (vAge < 0.0 || vAge > 45.0) p = vec3(0.0, -999.0, 0.0);
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        varying vec2 vUv;
        varying float vAge;
        ${NOISE_GLSL}
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float r = length(q);
          float ang = atan(q.y, q.x);
          float n = hvNoise(q * 4.0) * 0.6 + hvNoise(q * 11.0) * 0.4;
          // Ragged charred blot + radial burn streaks.
          float streak = pow(abs(sin(ang * 7.0 + n * 3.0)), 8.0) * smoothstep(0.95, 0.3, r);
          float blot = smoothstep(0.62 + n * 0.25, 0.1, r);
          float a = max(blot, streak * 0.7) * 0.85;
          float fade = 1.0 - smoothstep(25.0, 45.0, vAge);
          a *= fade;
          if (a < 0.01) discard;
          vec3 col = vec3(0.05, 0.04, 0.035);
          // Ember cracks glowing for the first seconds.
          float crack = smoothstep(0.08, 0.0, abs(hvNoise(q * 6.0 + 3.0) - 0.5)) * smoothstep(0.7, 0.1, r);
          float hot = exp(-vAge * 0.9);
          col += vec3(1.8, 0.7, 0.2) * crack * hot * 2.5 + vec3(1.2, 0.5, 0.15) * smoothstep(0.25, 0.0, r) * hot * 1.5;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.name = 'strike-scorch';
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
    this.clear();
  }

  clear(): void {
    const a = this.geo.attributes.aStrike as THREE.InstancedBufferAttribute;
    (a.array as Float32Array).fill(-999);
    a.needsUpdate = true;
  }

  add(x: number, z: number, now: number): void {
    const a = this.geo.attributes.aStrike as THREE.InstancedBufferAttribute;
    a.setXYZW(this.slot, x, 0, z, now);
    a.needsUpdate = true;
    this.slot = (this.slot + 1) % this.max;
  }

  update(now: number): void {
    this.mat.uniforms.uNow!.value = now;
    const a = this.geo.attributes.aStrike as THREE.InstancedBufferAttribute;
    let live = false;
    for (let i = 0; i < this.max; i++) if (now - a.getW(i) < 45) live = true;
    this.mesh.visible = live && this.mat.uniforms.uHeight!.value !== null;
  }
}

// ───────────────────────────────────────────── ground fog

export class FogBank {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private readonly size = 70;
  private readonly seg: number;

  constructor(layers = 4, seg = 40) {
    this.seg = seg;
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
    const cell = this.size / this.seg;
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
          gl_FragColor = vec4(c * fade * uAmount * 0.27, 1.0);
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
