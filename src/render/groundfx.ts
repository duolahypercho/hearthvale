/**
 * Near-ground weather detail, all GPU-animated (a few uniforms per frame, one draw call each):
 *  - Drips: fat drops falling from roof eaves / canopy edges while it rains (and for a while after),
 *    each ending in a tiny splash ring on the ground (height texture). `findEaves()` derives drip
 *    points from any roof-named material in a map.
 *  - Footprints: boot prints pressed into snow behind the player (ring buffer, fade over ~90 s).
 *  - LeafGusts: leaves / petals tumbling across the view on windy days (seasonal palette).
 */
import * as THREE from 'three';
import { globalUniforms } from './uniforms';
import { NOISE_GLSL } from './shaders/noise';
import type { HeightSource } from './precipitation';

// ───────────────────────────────────────────── drips

export interface DripPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Eave points of every roof-like mesh under `root` (material name matching roof / thatch / shingle):
 * boundary cells of the roof footprint whose outside neighbour lies downhill of the roof slope.
 */
export function findEaves(root: THREE.Object3D, max = 360, cell = 0.45): DripPoint[] {
  const cells = new Map<number, { min: number; x: number; z: number }>();
  const key = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats.some((mt) => mt && /roof|thatch|shingle/i.test(mt.name))) return;
    const pos = m.geometry?.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    // Merged static meshes carry several materials in groups: only the roof groups count.
    const ranges: [number, number][] = [];
    const idx = m.geometry.index;
    if (Array.isArray(m.material) && m.geometry.groups.length) {
      for (const g of m.geometry.groups) {
        const mt = (m.material as THREE.Material[])[g.materialIndex ?? 0];
        if (mt && /roof|thatch|shingle/i.test(mt.name)) ranges.push([g.start, g.start + g.count]);
      }
    } else ranges.push([0, idx ? idx.count : pos.count]);
    const step = Math.max(1, Math.floor(pos.count / 60000));
    for (const [a, b] of ranges) {
      for (let i = a; i < b; i += step) {
        const vi = idx ? idx.getX(i) : i;
        v.fromBufferAttribute(pos, vi).applyMatrix4(m.matrixWorld);
        const cx = Math.floor(v.x / cell);
        const cz = Math.floor(v.z / cell);
        const k = key(cx, cz);
        const c = cells.get(k);
        if (!c) cells.set(k, { min: v.y, x: cx, z: cz });
        else if (v.y < c.min) c.min = v.y;
      }
    }
  });
  const out: DripPoint[] = [];
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const c of cells.values()) {
    const get = (dx: number, dz: number) => cells.get(key(c.x + dx, c.z + dz));
    // Roof slope from the neighbours' lowest points.
    const hx = (get(1, 0)?.min ?? c.min) - (get(-1, 0)?.min ?? c.min);
    const hz = (get(0, 1)?.min ?? c.min) - (get(0, -1)?.min ?? c.min);
    const gl = Math.hypot(hx, hz);
    if (gl < 0.05) continue;
    for (const [dx, dz] of dirs) {
      if (get(dx, dz)) continue;
      // Outside neighbour must be downhill (eave), not across the slope (gable end).
      if ((-hx * dx - hz * dz) / gl > 0.6) {
        out.push({ x: (c.x + 0.5) * cell + dx * cell * 0.4, y: c.min - 0.02, z: (c.z + 0.5) * cell + dz * cell * 0.4 });
        break;
      }
    }
  }
  // Thin to `max` evenly.
  if (out.length > max) {
    const k = out.length / max;
    return Array.from({ length: max }, (_, i) => out[Math.floor(i * k)]!);
  }
  return out;
}

export class Drips {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private readonly max: number;

  constructor(max = 480) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aPoint', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uAmount: { value: 0 },
          uHeight: { value: null },
          uHOrigin: { value: new THREE.Vector2() },
          uHSize: { value: new THREE.Vector2(1, 1) },
          uWater: { value: -99 },
          uColor: { value: new THREE.Color(0xdde8ff) },
        },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        uniform float uTime;
        uniform float uAmount;
        uniform sampler2D uHeight;
        uniform vec2 uHOrigin;
        uniform vec2 uHSize;
        uniform float uWater;
        attribute vec4 aPoint;
        varying vec2 vUv;
        varying float vMode;
        varying float vA;
        void main() {
          float seed = aPoint.w;
          float ground = max(texture2D(uHeight, (aPoint.xz - uHOrigin) / uHSize).r, uWater) + 0.02;
          float drop = max(aPoint.y - ground, 0.2);
          float fall = sqrt(2.0 * drop / 9.8);
          // Each point drips every 0.7-1.9 s (fewer as the rain eases off).
          float period = mix(1.9, 0.7, fract(seed * 7.13)) / max(uAmount, 0.3);
          float t = mod(uTime + seed * 31.0, period);
          float hang = period - fall - 0.35;
          float on = step(fract(seed * 3.7), uAmount);
          vec3 p;
          vec3 wp;
          if (t < hang) {
            // Swelling bead under the eave.
            float s = 0.03 + 0.03 * smoothstep(0.0, hang, t);
            vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            wp = aPoint.xyz + (right * position.x + up * (position.y - 1.0)) * s;
            vMode = 0.0;
            vA = on * 0.8;
          } else if (t < hang + fall) {
            float tf = t - hang;
            p = aPoint.xyz - vec3(0.0, 4.9 * tf * tf, 0.0);
            // Streak stretched along the fall, camera-facing across.
            float v = 9.8 * tf;
            float len = clamp(v * 0.03, 0.06, 0.35);
            vec3 toCam = normalize(cameraPosition - p);
            vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
            wp = p + side * position.x * 0.035 + vec3(0.0, position.y * len, 0.0);
            vMode = 0.0;
            vA = on;
          } else {
            // Splash ring on the ground.
            float ts = (t - hang - fall) / 0.35;
            float s = 0.05 + ts * 0.28;
            wp = vec3(aPoint.x + position.x * s, ground + 0.015, aPoint.z + (position.y - 0.5) * s);
            vMode = 1.0 + ts;
            vA = on * (1.0 - ts);
          }
          vUv = uv;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vMode;
        varying float vA;
        void main() {
          float a;
          if (vMode < 0.5) {
            vec2 q = vUv - 0.5;
            a = (1.0 - smoothstep(0.3, 0.5, abs(q.x))) * (0.55 + 0.45 * vUv.y);
            a *= 0.7;
          } else {
            float d = length(vUv - 0.5) * 2.0;
            a = smoothstep(0.6, 0.8, d) * (1.0 - smoothstep(0.85, 1.0, d)) * 0.7;
          }
          a *= vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.name = 'drips';
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'weather';
  }

  setPoints(pts: DripPoint[]): void {
    const a = this.geo.attributes.aPoint as THREE.InstancedBufferAttribute;
    const n = Math.min(this.max, pts.length);
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453;
      a.setXYZW(i, p.x, p.y, p.z, h - Math.floor(h));
    }
    a.needsUpdate = true;
    this.geo.instanceCount = n;
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

  update(amount: number, time: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    u.uAmount!.value = amount;
    const sky = globalUniforms.uSkyColor.value;
    (u.uColor!.value as THREE.Color).setRGB(0.7 + sky.r * 0.3, 0.76 + sky.g * 0.3, 0.84 + sky.b * 0.3).multiplyScalar(1 - globalUniforms.uNight.value * 0.55);
    this.mesh.visible = amount > 0.02 && this.geo.instanceCount > 0 && u.uHeight!.value !== null;
  }
}

// ───────────────────────────────────────────── footprints

export class Footprints {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private next = 0;
  private count = 0;
  private readonly max: number;

  constructor(max = 220) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    // x, y, z, yaw | birth time, side (-1 / 1)
    g.setAttribute('aPrint', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMeta', new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    // Modulate blending (dst * 2 * src): 0.5 is neutral, lower presses a shaded dent into whatever
    // light the snow has, higher brightens the crumbled rim. Works in sun and shadow alike.
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcColorFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uTime: { value: 0 },
        uSnow: { value: 0 },
        uLife: { value: 90 },
        uSunDir: globalUniforms.uSunDir,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aPrint;
        attribute vec2 aMeta;
        uniform float uTime;
        uniform float uLife;
        varying vec2 vUv;
        varying float vAge;
        varying vec2 vSun;
        varying float vFade;
        uniform vec3 uSunDir;
        void main() {
          float c = cos(aPrint.w);
          float s = sin(aPrint.w);
          // Boot print ~0.21 x 0.39 m (reads at diorama distance), offset to its side of the stride;
          // the quad is padded so the blue shadow AO can bleed past the rim.
          vec2 lp = vec2(position.x * 0.36, position.z * 0.6) + vec2(aMeta.y * 0.13, 0.0);
          vec2 r = vec2(lp.x * c + lp.y * s, -lp.x * s + lp.y * c);
          vec3 wp = vec3(aPrint.x + r.x, aPrint.y + 0.012, aPrint.z + r.y);
          vUv = uv;
          vAge = (uTime - aMeta.x) / uLife;
          // Sun direction in the print's local frame.
          vec2 sd = normalize(uSunDir.xz + 1e-4);
          vSun = vec2(sd.x * c - sd.y * s, sd.x * s + sd.y * c);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          vFade = 1.0 - smoothstep(38.0, 60.0, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uSnow;
        varying vec2 vUv;
        varying float vAge;
        varying vec2 vSun;
        varying float vFade;
        ${NOISE_GLSL}
        // Signed distance to a boot sole: a toe ellipse and a separate heel pad with a gap between.
        float sole(vec2 p) {
          vec2 t = (p - vec2(0.5, 0.64)) / vec2(0.3, 0.27);
          vec2 h = (p - vec2(0.5, 0.26)) / vec2(0.24, 0.15);
          float dt = (length(t) - 1.0) * 0.27;
          float dh = (length(h) - 1.0) * 0.16;
          return min(dt, dh);
        }
        void main() {
          if (vAge > 1.0 || vAge < 0.0) discard;
          // Quad is padded 1.25x: remap so the sole keeps its proportions.
          vec2 uv = (vUv - 0.5) * 1.25 + 0.5;
          float n = (hvNoise(uv * 9.0) - 0.5) * 0.03;
          float d = sole(uv) + n;
          float inside = smoothstep(0.012, -0.02, d);
          float rim = smoothstep(0.05, 0.01, d) * (1.0 - inside);
          // The wall facing the sun is lit, the one facing away sits in the dent's own shadow.
          vec2 dir = normalize(uv - 0.5 + 1e-4);
          float toward = dot(dir, vSun);
          // Prints soften as fresh snow sifts in (fade over their life).
          float k = smoothstep(0.3, 0.7, uSnow) * (1.0 - smoothstep(0.35, 1.0, vAge)) * vFade;
          // Compressed snow: a soft cool shadow (~sky tint), deepest on the wall facing away from the sun.
          vec3 dent = mix(vec3(1.0), vec3(0.78, 0.83, 0.93) * (0.92 - 0.06 * toward), inside);
          float halo = smoothstep(0.08, 0.0, d) * (1.0 - inside);
          vec3 ao = mix(vec3(1.0), vec3(0.93, 0.95, 0.99), halo * 0.6);
          // Crumbled, raised rim catches the sun on its sunward side.
          vec3 lip = mix(vec3(1.0), vec3(1.1, 1.09, 1.07), rim * smoothstep(-0.2, 0.6, toward));
          vec3 m = mix(vec3(1.0), dent * lip * ao, k);
          gl_FragColor = vec4(m * 0.5, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.mesh.name = 'footprints';
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'weather';
  }

  stamp(x: number, y: number, z: number, yaw: number, side: number, time: number): void {
    const p = this.geo.attributes.aPrint as THREE.InstancedBufferAttribute;
    const m = this.geo.attributes.aMeta as THREE.InstancedBufferAttribute;
    p.setXYZW(this.next, x, y, z, yaw);
    m.setXY(this.next, time, side);
    p.needsUpdate = m.needsUpdate = true;
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.geo.instanceCount = this.count;
  }

  clear(): void {
    this.count = 0;
    this.next = 0;
    this.geo.instanceCount = 0;
  }

  update(snow: number, time: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    u.uSnow!.value = snow;
    this.mesh.visible = snow > 0.3 && this.count > 0;
  }
}

// ───────────────────────────────────────────── leaves on the wind

export type GustPalette = 'petals' | 'green' | 'autumn' | 'none';

const PALETTES: Record<Exclude<GustPalette, 'none'>, [number, number, number]> = {
  petals: [0xffc2d6, 0xfff0f4, 0xf7a8c4],
  green: [0x7fbf4a, 0xa5d65a, 0x5e9e3a],
  autumn: [0xe8892a, 0xd64a28, 0xf0c040],
};

export class LeafGusts {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(private readonly max = 640) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(max * 4);
    let s = 20240917;
    for (let i = 0; i < seeds.length; i++) {
      s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
      seeds[i] = (s >>> 8) / 16777216;
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(26, 3.0, 22) },
          uAmount: { value: 0 },
          uCount: { value: max },
          uWind: { value: new THREE.Vector2(1, 0) },
          uSpeed: { value: 4 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
          uC2: { value: new THREE.Color() },
          uSize: { value: 0.16 },
          uGloom: { value: 0 },
          uPetals: { value: 0 },
          uSunDir: globalUniforms.uSunDir,
          uSunColor: globalUniforms.uSunColor,
          uSkyColor: globalUniforms.uSkyColor,
        },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform float uAmount;
        uniform float uCount;
        uniform vec2 uWind;
        uniform float uSpeed;
        uniform float uSize;
        attribute vec4 aSeed;
        varying vec2 vUv;
        varying float vPick;
        varying float vShade;
        varying float vShape;
        float lgHash(float n) { return fract(sin(n) * 43758.5453); }
        float lgNoise(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(lgHash(i), lgHash(i + 1.0), f); }
        mat3 rot(vec3 a) {
          float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
          return mat3(cy * cz, cy * sz, -sy, sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy);
        }
        void main() {
          float idx = float(gl_InstanceID);
          float on = step(idx, uCount * uAmount);
          float sp = uSpeed * (0.6 + 0.8 * aSeed.w);
          vec3 size = uBox * 2.0;
          // Travel along the wind, wrapping inside a box around the camera focus.
          vec3 p = vec3(aSeed.x * size.x, aSeed.y * size.y, aSeed.z * size.z);
          vec3 wind = vec3(uWind.x, 0.0, uWind.y);
          p += wind * uTime * sp;
          float ph = aSeed.w * 50.0;
          // Gusty loops and flutter-down.
          p.y += sin(uTime * 1.3 + ph) * 0.8 + sin(uTime * 3.1 + ph * 1.7) * 0.25 - uTime * 0.35 * (0.5 + aSeed.x);
          p += vec3(-uWind.y, 0.0, uWind.x) * sin(uTime * 0.9 + ph * 0.6) * 1.2;
          vec3 base = uCenter - vec3(uBox.x, 0.0, uBox.z);
          vec3 rel = p;
          rel.xz = mod(rel.xz, size.xz);
          rel.y = mod(rel.y, size.y) + 0.3;
          vec3 wp = base + rel;
          // Gust bursts: leaves ride in on travelling fronts (clouds of them), a few stragglers between.
          float along = dot(wp.xz, uWind);
          float front = lgNoise(along * 0.09 - uTime * 0.55 + aSeed.y * 0.6);
          float burst = mix(0.25, 1.0, smoothstep(0.45, 0.75, front));
          wp.y += burst * 0.8;
          // Tumble: spin about a per-leaf axis (faster in the gust).
          float spin = 1.0 + burst * 1.5;
          vec3 ang = vec3(uTime * (2.0 + aSeed.x * 4.0) * spin + ph, uTime * (1.3 + aSeed.y * 3.0) * spin + ph * 0.7, uTime * (0.7 + aSeed.z * 2.0));
          mat3 R = rot(ang);
          float keep = step(aSeed.x * 0.999, burst);
          // Leaves right in front of the lens would read as giant blotches: shrink them away.
          float camD = length(cameraPosition - wp);
          float nearK = smoothstep(7.0, 12.0, camD);
          vec3 local = R * vec3(position.x, position.y, 0.0) * uSize * (0.75 + 0.6 * aSeed.z) * on * keep * nearK;
          vShade = 0.6 + 0.4 * abs((R * vec3(0.0, 0.0, 1.0)).y);
          vUv = uv;
          vPick = fract(aSeed.x * 7.0 + aSeed.z * 3.0);
          vShape = fract(aSeed.y * 11.0 + aSeed.w * 5.0);
          vec4 mvPosition = viewMatrix * vec4(wp + local, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform vec3 uC0;
        uniform vec3 uC1;
        uniform vec3 uC2;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform float uGloom;
        uniform float uPetals;
        varying vec2 vUv;
        varying float vPick;
        varying float vShade;
        varying float vShape;
        // Three alpha-tested silhouettes (+ a petal): returns coverage, midrib / vein darkening in y.
        vec2 leafShape(vec2 q, float shape) {
          // q: -1..1, stem at -y, tip at +y.
          if (uPetals > 0.5) {
            // Cherry petal: rounded teardrop with a notch at the tip.
            float w = sqrt(max(0.0, 1.0 - q.y * q.y)) * (0.55 + 0.25 * q.y);
            float notch = smoothstep(0.14, 0.0, abs(q.x)) * smoothstep(0.62, 0.95, q.y);
            float inside = step(abs(q.x), w) * (1.0 - notch);
            return vec2(inside, smoothstep(0.05, 0.0, abs(q.x)) * 0.2);
          }
          float stem = step(abs(q.x), 0.045) * step(q.y, -0.62) * step(-0.98, q.y);
          float vein = smoothstep(0.05, 0.0, abs(q.x)) * step(q.y, 0.85);
          if (shape < 0.34) {
            // Oval leaf with a pointed tip.
            float t = q.y * 0.5 + 0.5;
            float w = pow(max(0.0, sin(t * 3.14159)), 0.8) * 0.5 * (1.0 - 0.35 * smoothstep(0.55, 1.0, t));
            float side = smoothstep(0.04, 0.0, abs(fract(q.y * 2.6 + abs(q.x) * 2.2) - 0.5)) * step(abs(q.x), w * 0.85) * 0.5;
            return vec2(max(step(abs(q.x), w) * step(-0.72, q.y), stem), max(vein, side));
          } else if (shape < 0.67) {
            // Maple: five pointed lobes around the base of the stem.
            vec2 p = q - vec2(0.0, -0.35);
            float a = atan(p.x, p.y);
            float r = length(p);
            float lobes = 0.52 + 0.3 * pow(abs(cos(a * 2.5)), 3.0) - 0.12 * smoothstep(1.9, 2.8, abs(a));
            float inside = step(r, lobes * 1.25) * step(-0.62, q.y);
            float rib = smoothstep(0.05, 0.0, abs(fract(a / 1.2566 + 0.5) - 0.5) * r * 3.0) * step(r, lobes);
            return vec2(max(inside, stem), rib * 0.7);
          }
          // Needle cluster: three slim needles fanning from one point.
          float acc = 0.0;
          for (int i = 0; i < 3; i++) {
            float ang = (float(i) - 1.0) * 0.38;
            vec2 d = vec2(cos(ang) * q.x - sin(ang) * (q.y + 0.9), sin(ang) * q.x + cos(ang) * (q.y + 0.9));
            acc = max(acc, step(abs(d.x), 0.07 * (1.0 - d.y / 1.9)) * step(0.0, d.y) * step(d.y, 1.85));
          }
          return vec2(acc, 0.0);
        }
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          vec2 ls = leafShape(q, vShape);
          if (ls.x < 0.5) discard;
          vec3 c = vPick < 0.34 ? uC0 : vPick < 0.67 ? uC1 : uC2;
          // Two-tone: the underside is paler and cooler (visible as the leaf flips over in the wind).
          if (!gl_FrontFacing) c = mix(c, c * vec3(1.1, 1.12, 0.92) + 0.06, 0.55);
          c *= 1.0 - ls.y * 0.22;
          // Storm / rain: soaked and dim, pulled towards a dark olive so they never glow in the grade.
          c = mix(c, vec3(0.31, 0.48, 0.23) * 0.8, uGloom * 0.55);
          vec3 light = uSkyColor * 0.42 + uSunColor * 0.7 * vShade;
          light *= 1.0 - uGloom * 0.35;
          gl_FragColor = vec4(c * light, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.name = 'leaf-gusts';
    this.mesh.userData.perfTag = 'weather';
  }

  setPalette(p: GustPalette): void {
    if (p === 'none') return;
    const [a, b, c] = PALETTES[p];
    const u = this.mat.uniforms;
    (u.uC0!.value as THREE.Color).setHex(a);
    (u.uC1!.value as THREE.Color).setHex(b);
    (u.uC2!.value as THREE.Color).setHex(c);
    // ~28-40 px at gameplay zoom: readable leaves / petals, not confetti.
    u.uSize!.value = p === 'petals' ? 0.36 : 0.52;
    u.uPetals!.value = p === 'petals' ? 1 : 0;
  }

  update(center: THREE.Vector3, amount: number, time: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    (u.uCenter!.value as THREE.Vector3).copy(center);
    u.uAmount!.value = amount;
    const wd = globalUniforms.uWindDir.value;
    (u.uWind!.value as THREE.Vector2).copy(wd);
    u.uSpeed!.value = 1.2 + globalUniforms.uWindStrength.value * 2.2;
    u.uGloom!.value = Math.min(1, globalUniforms.uRain.value * 1.1);
    this.mesh.visible = amount > 0.01;
  }
}

/**
 * Wind ribbons: a handful of faint, long, wavy white streaks sliding along the wind a couple of
 * metres up (the classic "you can see the wind" read). Only on windy / stormy days. One draw call.
 */
export class WindRibbons {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(private readonly max = 26) {
    // A strip of 24 segments along +x (0..1), across -0.5..0.5.
    const seg = 24;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) pos.push(i / seg, -0.5, 0, i / seg, 0.5, 0);
    for (let i = 0; i < seg; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const seeds = new Float32Array(max * 4);
    let sd = 777;
    for (let i = 0; i < seeds.length; i++) {
      sd = (Math.imul(sd ^ (sd >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
      seeds[i] = (sd >>> 8) / 16777216;
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(1, 0) }, uAmount: { value: 0 }, uPx: { value: 0.0006 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec2 uWind;
        uniform float uAmount;
        uniform float uPx;
        attribute vec4 aSeed;
        varying float vA;
        varying float vU;
        void main() {
          vec3 wind = normalize(vec3(uWind.x, 0.0, uWind.y) + 1e-4);
          vec3 side = vec3(-wind.z, 0.0, wind.x);
          float life = 3.2 + aSeed.w * 2.4;
          float t = uTime / life + aSeed.x * 7.0;
          float cyc = fract(t);
          float id = floor(t);
          float h1 = fract(sin((id + aSeed.y * 13.0) * 12.9898) * 43758.5453);
          float h2 = fract(sin((id + aSeed.z * 17.0) * 78.233) * 43758.5453);
          float len = 3.5 + aSeed.z * 4.0;
          // Each ribbon slides ~9 m along the wind over its life, spawning around the focus.
          vec3 base = uCenter + side * (h1 - 0.5) * 30.0 + wind * ((h2 - 0.5) * 24.0 + (cyc - 0.5) * 9.0);
          float u = position.x;
          vec3 p = base + wind * (u - 0.5) * len;
          p.y += 1.3 + aSeed.y * 2.2 + sin(u * 6.28 * (0.8 + aSeed.w) + uTime * 2.0 + aSeed.x * 20.0) * 0.28;
          p += side * sin(u * 3.14 * 1.4 + uTime * 1.3 + aSeed.z * 9.0) * 0.35;
          float camD = length(cameraPosition - p);
          // ~1.5 px wide, tapered at both ends.
          float w = camD * uPx * 1.6 * sin(u * 3.14159);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 across = normalize(cross(wind, toCam));
          p += across * position.y * w;
          vA = uAmount * sin(cyc * 3.14159) * smoothstep(0.0, 0.25, u) * (1.0 - smoothstep(0.55, 1.0, u)) * step(float(gl_InstanceID), 26.0 * uAmount);
          vU = u;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vU;
        void main() {
          if (vA < 0.004) discard;
          gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * vA * 0.16, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    this.mesh.name = 'wind-ribbons';
    this.mesh.userData.perfTag = 'weather';
    this.mesh.userData.noAO = true;
  }

  update(center: THREE.Vector3, amount: number, time: number, pxAngle: number): void {
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    (u.uCenter!.value as THREE.Vector3).copy(center);
    (u.uWind!.value as THREE.Vector2).copy(globalUniforms.uWindDir.value);
    u.uAmount!.value = amount;
    u.uPx!.value = pxAngle;
    this.mesh.visible = amount > 0.01;
  }
}
