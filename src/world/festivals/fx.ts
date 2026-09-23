/**
 * Festival effects, all GPU-animated from uTime (so they keep moving while the sim is paused and
 * cost one draw call each):
 *   PetalStorm      tumbling blossom petals riding wind gusts around the camera focus
 *   GroundScatter   petals / leaves / confetti lying on the ground (static instancing)
 *   Fireworks       scheduled shells (peony, ring, willow, palm) with rocket trails, sparkle
 *                   crackle and a mirrored copy for sea reflections; flash() drives a light
 *   FloatingLanterns lotus lanterns drifting on the sea (+ glow halos + reflection streaks)
 *   SkyLanterns     paper lanterns rising into the night
 *   Aurora          folded, ray-streaked curtains of light across the northern sky
 *   Snowfall        big soft bokeh flakes around the focus
 *   GlowPoints      twinkling fairy lights / lamp halos (additive, night-weighted)
 */
import * as THREE from 'three';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';
import { textures } from '../../render/textures';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { lumpySphere, prep, mat } from '../geom';
import type { Rng } from '../../core/rng';

const FOG_PARS_V = '#include <fog_pars_vertex>';
const FOG_V = '#include <fog_vertex>';
const FOG_PARS_F = '#include <fog_pars_fragment>';
const FOG_F = '#include <fog_fragment>';

function shared(u: Record<string, THREE.IUniform>): Record<string, THREE.IUniform> {
  return {
    ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    uTime: globalUniforms.uTime,
    uSunDir: globalUniforms.uSunDir,
    uSunColor: globalUniforms.uSunColor,
    uSkyColor: globalUniforms.uSkyColor,
    uNight: globalUniforms.uNight,
    uLamps: globalUniforms.uLamps,
    uWindDir: globalUniforms.uWindDir,
    ...u,
  };
}

const ROT_GLSL = /* glsl */ `
mat3 fxAxisAngle(vec3 a, float ang) {
  a = normalize(a); float c = cos(ang), s = sin(ang), t = 1.0 - c;
  return mat3(t*a.x*a.x + c, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
              t*a.x*a.y - s*a.z, t*a.y*a.y + c, t*a.y*a.z + s*a.x,
              t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
}`;

// ───────────────────────────────────────────── petals

/** Curved petal / leaf card (a few triangles, cupped). */
function petalGeometry(w: number, h: number, cup: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 2, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2);
    const y = p.getY(i) / (h / 2);
    // Rounded tip: pinch the corners in.
    p.setX(i, p.getX(i) * (1 - 0.45 * y * y));
    p.setZ(i, (x * x) * cup + y * y * cup * 0.4);
  }
  g.computeVertexNormals();
  return g;
}

export interface PetalOptions {
  count: number;
  box: THREE.Vector3;
  colors: number[];
  size?: number;
  /** Horizontal drift speed (m/s along the wind). */
  drift?: number;
  fall?: number;
  /** 'petal' (blossom) or 'leaf' (bigger, warmer, flutter). */
  kind?: 'petal' | 'leaf' | 'confetti';
}

export class PetalStorm {
  readonly mesh: THREE.Mesh;
  readonly center: { value: THREE.Vector3 };
  readonly gust = { value: 1 };

  constructor(o: PetalOptions) {
    const size = o.size ?? 1;
    const base = o.kind === 'leaf' ? petalGeometry(0.12 * size, 0.09 * size, 0.02) : o.kind === 'confetti' ? new THREE.PlaneGeometry(0.06 * size, 0.035 * size) : petalGeometry(0.075 * size, 0.055 * size, 0.012);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position!);
    g.setAttribute('normal', base.attributes.normal!);
    g.instanceCount = o.count;
    const seed = new Float32Array(o.count * 4);
    const col = new Float32Array(o.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < o.count; i++) {
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      c.setHex(o.colors[i % o.colors.length]!).convertSRGBToLinear();
      const v = 0.9 + Math.random() * 0.2;
      col[i * 3] = c.r * v;
      col[i * 3 + 1] = c.g * v;
      col[i * 3 + 2] = c.b * v;
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
    this.center = { value: new THREE.Vector3() };
    const m = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: true,
      uniforms: shared({ uCenter: this.center, uBox: { value: o.box.clone() }, uDrift: { value: o.drift ?? 1.4 }, uFall: { value: o.fall ?? 0.35 }, uGust: this.gust }),
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute vec3 aCol;
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWindDir; uniform float uDrift; uniform float uFall; uniform float uGust;
        varying vec3 vN; varying vec3 vCol; varying vec3 vW;
        ${FOG_PARS_V}
        ${NOISE_GLSL}
        ${ROT_GLSL}
        void main() {
          vec4 s = aSeed;
          float t = uTime;
          float spd = 0.55 + s.w * 0.9;
          // Gusts: coherent pulses travelling downwind.
          float gp = hvNoise(vec2(t * 0.18 + s.x * 0.6, s.z * 0.5));
          float gust = (0.6 + 1.2 * smoothstep(0.35, 0.8, gp)) * uGust;
          vec3 base = s.xyz * uBox;
          vec3 drift = vec3(uWindDir.x, 0.0, uWindDir.y) * t * spd * uDrift * gust;
          drift.y -= t * uFall * (0.6 + s.y * 0.8);
          float sw = t * (0.6 + s.w * 0.9) + s.x * 40.0;
          drift += vec3(sin(sw) * 0.8, sin(sw * 1.3 + s.z * 9.0) * 0.45 * gust, cos(sw * 0.77) * 0.8);
          vec3 lo = uCenter - uBox * 0.5;
          vec3 local = mod(base + drift - lo, uBox);
          vec3 wp = lo + local;
          float edge = min(min(local.x, uBox.x - local.x) / 3.0, min(local.z, uBox.z - local.z) / 3.0);
          edge = min(edge, min(local.y, uBox.y - local.y) / 0.8);
          float fade = clamp(edge, 0.0, 1.0);
          float ang = t * (2.5 + s.w * 4.5) * (0.6 + gust * 0.4) + s.x * 30.0;
          mat3 R = fxAxisAngle(vec3(s.y - 0.5, s.z - 0.5, s.x - 0.45) + 0.02, ang);
          vec3 v = R * (position * fade);
          vN = normalize(R * normal);
          vCol = aCol;
          vW = wp + v;
          vec4 mvPosition = viewMatrix * vec4(vW, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          ${FOG_V}
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform float uNight;
        varying vec3 vN; varying vec3 vCol; varying vec3 vW;
        ${FOG_PARS_F}
        void main() {
          vec3 n = normalize(vN);
          vec3 L = normalize(uSunDir);
          vec3 V = normalize(cameraPosition - vW);
          float d = abs(dot(n, L));
          float trans = pow(max(dot(-V, L), 0.0), 3.0);
          vec3 c = vCol * (uSunColor * (0.35 + 0.65 * d) * 0.95 + uSkyColor * 0.5 + vec3(0.04)) + vCol * uSunColor * trans * 0.6;
          gl_FragColor = vec4(c, 1.0);
          ${FOG_F}
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'petal-storm';
    this.mesh.userData.noAO = true;
    this.mesh.renderOrder = 4;
  }

  update(focus: THREE.Vector3): void {
    this.center.value.set(focus.x, focus.y + (this.mesh.material as THREE.ShaderMaterial).uniforms.uBox!.value.y * 0.5 - 0.3, focus.z);
  }
}

// ───────────────────────────────────────────── ground scatter

export class GroundScatter {
  readonly mesh: THREE.InstancedMesh;
  constructor(items: { x: number; y: number; z: number; rot: number; color: number; scale?: number }[], kind: 'petal' | 'leaf' | 'confetti' = 'petal') {
    const base = kind === 'leaf' ? petalGeometry(0.16, 0.11, 0.015) : kind === 'confetti' ? new THREE.PlaneGeometry(0.07, 0.04) : petalGeometry(0.085, 0.06, 0.008);
    base.rotateX(-Math.PI / 2);
    const g = prep(base);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    m.name = `scatter-${kind}`;
    applyWorldFx(m, { snow: false });
    this.mesh = new THREE.InstancedMesh(g, m, Math.max(1, items.length));
    this.mesh.count = items.length;
    const M = new THREE.Matrix4();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      const s = it.scale ?? 0.8 + Math.random() * 0.5;
      M.compose(new THREE.Vector3(it.x, it.y + 0.012, it.z), new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.4, it.rot, (Math.random() - 0.5) * 0.4)), new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(i, M);
      this.mesh.setColorAt(i, c.setHex(it.color).multiplyScalar(0.85 + Math.random() * 0.25));
    });
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noAO = true;
    this.mesh.name = `scatter-${kind}`;
    this.mesh.computeBoundingSphere();
  }
}

// ───────────────────────────────────────────── fireworks

const FW_PALETTE: [number, number, number][] = [
  [1.0, 0.72, 0.3],
  [1.0, 0.32, 0.45],
  [0.35, 0.8, 1.0],
  [0.55, 1.0, 0.45],
  [0.78, 0.45, 1.0],
  [1.0, 0.84, 0.3],
  [1.0, 0.45, 0.15],
];

function fract(x: number): number {
  return x - Math.floor(x);
}
/** Same as GLSL hvHash12 (for CPU-side flash colours). */
function hash12(x: number, y: number): number {
  let p3x = fract(x * 0.1031);
  let p3y = fract(y * 0.1031);
  let p3z = fract(x * 0.1031);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d;
  p3y += d;
  p3z += d;
  return fract((p3x + p3y) * p3z);
}

export interface FireworksOptions {
  /** Launch area centre (x, z) and extents (w, d). */
  area: THREE.Vector4;
  /** Burst altitude range. */
  heights: THREE.Vector2;
  groundY: number;
  shells?: number;
  sparks?: number;
  /** Mirror plane (sea level) for the reflection copy. */
  mirrorY?: number;
  /** Burst size multiplier (diorama scale: 0.5–0.7 keeps shells inside a high camera's frame). */
  spread?: number;
  /** Point size multiplier. */
  size?: number;
}

const FW_LAUNCH = 1.15;
const FW_LIFE = 2.9;

export class Fireworks {
  readonly group = new THREE.Group();
  private uniforms: Record<string, THREE.IUniform>;
  private shells: { period: number; offset: number }[] = [];
  readonly scale = { value: 1000 };
  readonly intensity = { value: 1 };

  constructor(private o: FireworksOptions) {
    const S = o.shells ?? 9;
    const M = o.sparks ?? 110;
    const TR = 3;
    for (let i = 0; i < S; i++) this.shells.push({ period: 4.3 + ((i * 7) % 5) * 0.55 + i * 0.13, offset: i * 1.37 });
    const n = S * M * TR;
    const pos = new Float32Array(n * 3);
    const dir = new Float32Array(n * 3);
    const info = new Float32Array(n * 4);
    let k = 0;
    const v = new THREE.Vector3();
    for (let s = 0; s < S; s++) {
      for (let j = 0; j < M; j++) {
        // Even-ish sphere distribution (fibonacci) with jitter.
        const y = 1 - (2 * (j + 0.5)) / M;
        const r = Math.sqrt(1 - y * y);
        const a = j * 2.39996 + Math.random() * 0.2;
        v.set(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
        for (let t = 0; t < TR; t++) {
          dir.set([v.x, v.y, v.z], k * 3);
          info.set([s, j, t, Math.random()], k * 4);
          k++;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    const shellData = this.shells.flatMap((sh) => [sh.period, sh.offset]);
    this.uniforms = {
      uTime: globalUniforms.uTime,
      uArea: { value: o.area.clone() },
      uHeights: { value: o.heights.clone() },
      uGround: { value: o.groundY },
      uShell: { value: shellData },
      uMap: { value: textures.softDot().map },
      uScale: this.scale,
      uIntensity: this.intensity,
      uSpread: { value: o.spread ?? 1 },
      uSize: { value: o.size ?? 1 },
    };
    const make = (mirror: boolean): THREE.Points => {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        defines: { NSHELL: S, MIRROR: mirror ? 1 : 0 },
        uniforms: { ...this.uniforms, uMirrorY: { value: o.mirrorY ?? 0 } },
        vertexShader: /* glsl */ `
          attribute vec3 aDir; attribute vec4 aInfo;
          uniform float uTime; uniform vec4 uArea; uniform vec2 uHeights; uniform float uGround; uniform float uShell[NSHELL * 2];
          uniform float uScale; uniform float uMirrorY; uniform float uIntensity; uniform float uSpread; uniform float uSize;
          varying vec3 vCol; varying float vA;
          ${NOISE_GLSL}
          vec3 fwPal(float h) {
            ${FW_PALETTE.map((c, i) => `if (h < ${((i + 1) / FW_PALETTE.length).toFixed(4)}) return vec3(${c.map((x) => x.toFixed(3)).join(',')});`).join('\n            ')}
            return vec3(1.0);
          }
          void main() {
            int si = int(aInfo.x + 0.5);
            float per = uShell[si * 2];
            float off = uShell[si * 2 + 1];
            float tt = uTime + off;
            float cyc = floor(tt / per);
            float lt = tt - cyc * per;
            float h1 = hvHash12(vec2(aInfo.x * 7.1, cyc));
            float h2 = hvHash12(vec2(cyc, aInfo.x * 3.3 + 1.7));
            float h3 = hvHash12(vec2(aInfo.x + 11.0, cyc * 1.3));
            float h4 = hvHash12(vec2(cyc * 0.7 + 5.0, aInfo.x * 1.9));
            float h5 = hvHash12(vec2(aInfo.x * 2.3 + cyc, 9.1));
            vec3 burst = vec3(uArea.x + (h1 - 0.5) * uArea.z, uHeights.x + h3 * (uHeights.y - uHeights.x), uArea.y + (h2 - 0.5) * uArea.w);
            vec3 start = vec3(burst.x + (h2 - 0.5) * 3.0, uGround, burst.z + 2.0);
            int type = int(h4 * 4.0);
            vec3 c1 = fwPal(h5);
            vec3 c2 = fwPal(fract(h5 + 0.37));
            float j = aInfo.y;
            float tr = aInfo.z;
            float rnd = aInfo.w;
            vec3 p = vec3(0.0, -1000.0, 0.0);
            float a = 0.0;
            float size = 0.0;
            vec3 col = vec3(1.0);
            if (lt < ${FW_LAUNCH.toFixed(2)}) {
              // Rocket comet + spark trail: a handful of vertices.
              if (j < 10.0 && tr < 0.5) {
                float lag = j * 0.035;
                float u = clamp((lt - lag) / ${FW_LAUNCH.toFixed(2)}, 0.0, 1.0);
                float e = 1.0 - (1.0 - u) * (1.0 - u);
                p = mix(start, burst, e);
                p.x += sin(u * 18.0 + aInfo.x) * 0.08 * (1.0 - u);
                p.y -= j * 0.02;
                a = (1.0 - j / 10.0) * step(lag, lt);
                size = j < 0.5 ? 0.42 : 0.22 * (1.0 - j / 12.0);
                col = mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.5, 0.2), j / 10.0) * 1.6;
              }
            } else {
              float tb = lt - ${FW_LAUNCH.toFixed(2)} - tr * 0.05;
              float life = type == 2 ? ${(FW_LIFE * 1.3).toFixed(2)} : ${FW_LIFE.toFixed(2)};
              if (tb > 0.0 && tb < life) {
                vec3 d = aDir;
                float v0 = 8.5;
                float k = 1.7;
                float gEff = 4.2;
                if (type == 1) { // ring (tilted plane)
                  d = normalize(vec3(d.x, d.y * 0.08, d.z));
                  float tilt = (h1 - 0.5) * 1.2;
                  d = vec3(d.x, d.y * cos(tilt) - d.z * sin(tilt), d.y * sin(tilt) + d.z * cos(tilt));
                  v0 = 9.5;
                } else if (type == 2) { // willow: gold, droopy
                  v0 = 6.5; gEff = 3.0; k = 1.2; c1 = vec3(1.0, 0.7, 0.28); c2 = vec3(1.0, 0.45, 0.12);
                } else if (type == 3) { // palm: fewer, fatter streamers
                  if (mod(j, 5.0) > 0.5) { d = vec3(0.0); v0 = 0.0; }
                  v0 = 10.5;
                }
                v0 *= (0.85 + rnd * 0.3) * uSpread; gEff *= uSpread;
                float drag = (1.0 - exp(-k * tb)) / k;
                p = burst + d * v0 * drag;
                p.y -= gEff * (tb - drag) / k * 1.4;
                float f = tb / life;
                a = pow(1.0 - f, 1.4) * (1.0 - tr * 0.3);
                if (dot(d, d) < 0.01) a = 0.0;
                // Crackle / twinkle at the end.
                float tw = hvHash12(vec2(j + aInfo.x * 131.0, floor(uTime * 22.0)));
                a *= f > 0.55 ? step(0.45, tw) * 1.4 : 1.0;
                vec3 hot = vec3(1.0, 0.95, 0.85);
                // Hot white only for the first instant, then saturated colour (additive overlap would
                // otherwise sum a dense shell to white).
                col = mix(hot, mix(c1, c2, step(0.5, fract(j * 0.37))), smoothstep(0.0, 0.08, f)) * 1.45;
                size = (0.34 - tr * 0.08) * (1.0 - f * 0.45) * (type == 3 ? 1.5 : 1.0);
                // Initial white flash core.
                if (tb < 0.12 && j < 1.5) { size = 2.2 * (1.0 - tb / 0.12); a = 1.0; col = vec3(1.0, 0.9, 0.75) * 2.0; }
              }
            }
            #if MIRROR == 1
              p.y = 2.0 * uMirrorY - p.y;
              p.x += sin(p.y * 2.3 + uTime * 3.0) * 0.12;
              a *= 0.32 * step(p.y, uMirrorY);
              size *= 1.3;
            #endif
            vCol = col * uIntensity;
            vA = a;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = size * uSize * uScale / max(-mv.z, 0.5);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec3 vCol; varying float vA;
          void main() {
            float m = texture2D(uMap, gl_PointCoord).a;
            if (vA * m < 0.003) discard;
            gl_FragColor = vec4(vCol * m * vA, 1.0);
          }`,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = mirror ? 3 : 8;
      pts.userData.noAO = true;
      pts.name = mirror ? 'fireworks-reflection' : 'fireworks';
      return pts;
    };
    this.group.add(make(false));
    if (o.mirrorY !== undefined) this.group.add(make(true));
    this.group.name = 'fireworks';
  }

  setViewportHeight(h: number): void {
    this.scale.value = h * 1.3;
  }

  /** Current flash (0..∞) and colour of the brightest young burst — drives a sky light. */
  flash(time: number, out: THREE.Color): number {
    let best = 0;
    out.setRGB(0, 0, 0);
    this.shells.forEach((sh, i) => {
      const tt = time + sh.offset;
      const cyc = Math.floor(tt / sh.period);
      const lt = tt - cyc * sh.period;
      const tb = lt - FW_LAUNCH;
      if (tb < 0 || tb > 1.6) return;
      const k = Math.exp(-tb * 2.6) * (tb < 0.05 ? tb / 0.05 : 1);
      const h5 = hash12(i * 2.3 + cyc, 9.1);
      const c = FW_PALETTE[Math.min(FW_PALETTE.length - 1, Math.floor(h5 * FW_PALETTE.length))]!;
      out.r += c[0] * k;
      out.g += c[1] * k;
      out.b += c[2] * k;
      best += k;
    });
    if (best > 0) out.multiplyScalar(1 / best);
    return best;
  }
}

// ───────────────────────────────────────────── lanterns

/** Lotus float + boxy paper lantern (floating) or a tall sky lantern. Vertex colour + aGlow. */
function lanternGeometry(rng: Rng, kind: 'float' | 'sky'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Matrix4, tint: number, glow: number): void => {
    const p = prep(g, tint);
    p.applyMatrix4(m);
    p.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(p.attributes.position!.count).fill(glow), 1));
    parts.push(p);
  };
  if (kind === 'float') {
    // Lotus petals around a paper box.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pet = new THREE.SphereGeometry(0.11, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      pet.scale(0.55, 1.1, 1);
      add(pet, mat(Math.cos(a) * 0.14, 0.0, Math.sin(a) * 0.14, -0.9, -a + Math.PI / 2, 0), i % 2 ? 0xf6b8c8 : 0xf8d2dc, 0.12);
    }
    add(new THREE.CylinderGeometry(0.16, 0.13, 0.05, 10), mat(0, 0.0, 0), 0x6a9a4a, 0);
    const box = lumpySphere(0.12, 1, 0.02, rng, 2);
    box.scale(1, 1.3, 1);
    add(box, mat(0, 0.2, 0), 0xffc27a, 1);
    add(new THREE.CylinderGeometry(0.06, 0.08, 0.025, 8), mat(0, 0.36, 0), 0x3a2a1e, 0);
  } else {
    const body = new THREE.CylinderGeometry(0.2, 0.15, 0.5, 10, 2, true);
    add(body, mat(0, 0.25, 0), 0xffb070, 1);
    const top = new THREE.SphereGeometry(0.2, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    add(top, mat(0, 0.5, 0), 0xffa060, 0.9);
    add(new THREE.TorusGeometry(0.15, 0.012, 4, 10), mat(0, 0.0, 0, Math.PI / 2), 0x3a2a1e, 0);
    add(new THREE.SphereGeometry(0.05, 6, 4), mat(0, 0.06, 0), 0xfff0c0, 2.5);
  }
  return mergeParts(parts);
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position!.count;
  const out = new THREE.BufferGeometry();
  for (const [k, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['aGlow', 1]] as const) {
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const p of parts) {
      const a = p.attributes[k] as THREE.BufferAttribute;
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

const LANTERN_MOTION = /* glsl */ `
vec3 lanternPos(vec4 b, float t, float seaY, float mode, vec4 area) {
  // mode 0: floating on the sea (drift outwards, bob). mode 1: rising sky lantern.
  if (mode < 0.5) {
    float sp = 0.05 + b.w * 0.07;
    float z = b.y - mod(t * sp + b.z * 40.0, area.w);
    float x = b.x + sin(t * 0.07 + b.z * 20.0) * 1.2 + sin(t * 0.21 + b.z * 7.0) * 0.3;
    float y = seaY + sin(t * 1.3 + b.z * 30.0) * 0.035 + sin(t * 0.7 + x * 0.3) * 0.03;
    return vec3(x, y, z);
  }
  float per = 70.0;
  float lt = mod(t + b.z * per, per);
  float y = seaY + lt * (0.28 + b.w * 0.18);
  float z = b.y - lt * (0.45 + b.w * 0.3);
  float x = b.x + sin(lt * 0.15 + b.z * 9.0) * 2.0 + lt * 0.08 * (b.w - 0.5);
  return vec3(x, y, z);
}
float lanternFade(vec4 b, float t, float mode, vec4 area) {
  if (mode < 0.5) {
    float sp = 0.05 + b.w * 0.07;
    float u = mod(t * sp + b.z * 40.0, area.w) / area.w;
    return smoothstep(0.0, 0.04, u) * (1.0 - smoothstep(0.8, 1.0, u));
  }
  float lt = mod(t + b.z * 70.0, 70.0);
  return smoothstep(0.0, 2.0, lt) * (1.0 - smoothstep(58.0, 70.0, lt));
}
`;

export interface LanternOptions {
  count: number;
  /** Spawn band: x range (x0, x1), z start, drift depth. */
  area: THREE.Vector4;
  seaY: number;
  mode: 'float' | 'sky';
  rng: Rng;
  /** Optional explicit base points (x, z). */
  points?: [number, number][];
}

export class Lanterns {
  readonly group = new THREE.Group();
  readonly scale = { value: 1000 };

  constructor(o: LanternOptions) {
    const geo = lanternGeometry(o.rng, o.mode);
    const g = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]!);
    g.instanceCount = o.count;
    const base = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count; i++) {
      const pt = o.points?.[i % o.points.length];
      const x = pt ? pt[0] + (o.rng.next() - 0.5) * 1.2 : o.area.x + o.rng.next() * (o.area.y - o.area.x);
      const z = pt ? pt[1] : o.area.z;
      base.set([x, z, o.rng.next(), o.rng.next()], i * 4);
    }
    const aBase = new THREE.InstancedBufferAttribute(base, 4);
    g.setAttribute('aBase', aBase);
    const U = { uSeaY: { value: o.seaY }, uMode: { value: o.mode === 'float' ? 0 : 1 }, uArea: { value: o.area.clone() } };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide });
    m.name = `lantern-${o.mode}`;
    patchMaterial(m, `lanterns-${o.mode}`, (shader) => {
      Object.assign(shader.uniforms, U, { uTime: globalUniforms.uTime, uLamps: globalUniforms.uLamps });
      let vs = before(shader.vertexShader, 'void main() {', `attribute vec4 aBase; attribute float aGlow; varying float vGlow; uniform float uTime; uniform float uSeaY; uniform float uMode; uniform vec4 uArea;\n${LANTERN_MOTION}`);
      vs = after(
        vs,
        '#include <begin_vertex>',
        /* glsl */ `
        {
          vec3 lp = lanternPos(aBase, uTime, uSeaY, uMode, uArea);
          float f = lanternFade(aBase, uTime, uMode, uArea);
          float sw = sin(uTime * 1.1 + aBase.z * 20.0) * (uMode > 0.5 ? 0.12 : 0.06);
          transformed = vec3(transformed.x * cos(sw) - transformed.y * sin(sw), transformed.x * sin(sw) + transformed.y * cos(sw), transformed.z) * f + lp;
          vGlow = aGlow * (0.85 + 0.15 * sin(uTime * 9.0 + aBase.z * 50.0) * sin(uTime * 13.0 + aBase.w * 30.0));
        }`,
      );
      shader.vertexShader = vs;
      let fs = before(shader.fragmentShader, 'void main() {', 'varying float vGlow; uniform float uLamps;');
      fs = after(fs, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * vGlow * (0.6 + uLamps * 2.2);');
      shader.fragmentShader = fs;
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.userData.noAO = true;
    mesh.name = `lanterns-${o.mode}`;
    this.group.add(mesh);

    // Halos (+ water reflection streaks for floating lanterns).
    const hg = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    hg.index = quad.index;
    hg.setAttribute('position', quad.attributes.position!);
    hg.setAttribute('uv', quad.attributes.uv!);
    hg.setAttribute('aBase', aBase);
    hg.instanceCount = o.count;
    const mkHalo = (streak: boolean): THREE.Mesh => {
      const hm = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
        uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), ...U, uTime: globalUniforms.uTime, uLamps: globalUniforms.uLamps, uStreak: { value: streak ? 1 : 0 } },
        vertexShader: /* glsl */ `
          attribute vec4 aBase; uniform float uTime; uniform float uSeaY; uniform float uMode; uniform vec4 uArea; uniform float uStreak;
          varying vec2 vUv; varying float vF; varying float vFl;
          ${LANTERN_MOTION}
          ${FOG_PARS_V}
          void main() {
            vec3 lp = lanternPos(aBase, uTime, uSeaY, uMode, uArea);
            vF = lanternFade(aBase, uTime, uMode, uArea);
            vFl = 0.85 + 0.15 * sin(uTime * 9.0 + aBase.z * 50.0) + (uStreak > 0.5 ? sin(uTime * 1.7 + lp.x * 0.8 + lp.z * 0.5) * 0.1 : 0.0);
            vUv = uv;
            vec4 mvPosition;
            if (uStreak > 0.5) {
              // Reflection streak lying on the water, stretched towards the camera.
              vec3 toCam = cameraPosition - lp; toCam.y = 0.0; toCam = normalize(toCam);
              vec3 side = vec3(toCam.z, 0.0, -toCam.x);
              float len = 1.9 + aBase.w * 0.8;
              vec3 wp = vec3(lp.x, uSeaY + 0.02, lp.z) + side * position.x * (0.4 + 0.12 * sin(uTime * 2.0 + aBase.z * 9.0)) + toCam * (position.y + 0.5) * len;
              wp.x += sin(position.y * 9.0 + uTime * 3.0 + aBase.z * 20.0) * 0.06;
              mvPosition = viewMatrix * vec4(wp, 1.0);
            } else {
              vec3 c = lp + vec3(0.0, uMode > 0.5 ? 0.3 : 0.2, 0.0);
              mvPosition = viewMatrix * vec4(c, 1.0);
              mvPosition.xy += position.xy * (uMode > 0.5 ? 1.3 : 0.95);
            }
            gl_Position = projectionMatrix * mvPosition;
            ${FOG_V}
          }`,
        fragmentShader: /* glsl */ `
          uniform float uLamps; uniform float uStreak;
          varying vec2 vUv; varying float vF; varying float vFl;
          ${FOG_PARS_F}
          void main() {
            vec2 d = vUv - 0.5;
            float a;
            if (uStreak > 0.5) {
              // Broken, wave-jittered column of light (brighter near the lantern).
              float br = 0.55 + 0.45 * sin(vUv.y * 38.0 - vFl * 20.0 + vF * 3.0);
              a = exp(-d.x * d.x * 26.0) * (1.0 - smoothstep(0.05, 0.5, abs(d.y))) * (1.0 - vUv.y * 0.7) * 0.8 * br;
            } else {
              float r = length(d) * 2.0;
              a = exp(-r * r * 5.0) * 0.55 + exp(-r * r * 30.0) * 0.4;
            }
            vec3 c = vec3(1.0, 0.5, 0.18) * a * vF * vFl * (0.15 + uLamps * (uStreak > 0.5 ? 1.1 : 0.55));
            gl_FragColor = vec4(c, 1.0);
            #ifdef USE_FOG
              float fogDepth2 = vFogDepth;
              gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, fogDepth2);
            #endif
          }`,
      });
      const mm = new THREE.Mesh(hg, hm);
      mm.frustumCulled = false;
      mm.renderOrder = streak ? 3 : 7;
      mm.userData.noAO = true;
      mm.name = streak ? 'lantern-streaks' : 'lantern-halos';
      return mm;
    };
    this.group.add(mkHalo(false));
    if (o.mode === 'float') this.group.add(mkHalo(true));
    this.group.name = `lanterns-${o.mode}`;
  }
}

// ───────────────────────────────────────────── aurora

export interface AuroraCurtain {
  /** Path of the curtain's lower hem (world xz), left → right. */
  path: [number, number][];
  /** Hem height and curtain height (m). */
  base: number;
  height: number;
  /** 0..1 brightness. */
  strength?: number;
}

/**
 * Aurora: 3–4 folded curtain ribbons hanging low over the northern hills. Each curtain is a strip
 * along a sinuous spline, green at its soft lower hem shading to magenta at the top, with
 * noise-driven fold brightness (bright pleats, not searchlight rays) and a slow ~0.05 Hz drift of the
 * folds. `mask` keeps a column clear (the Great Fir's silhouette). One draw call per curtain.
 */
export class Aurora {
  readonly group = new THREE.Group();
  readonly strength = { value: 1 };
  constructor(curtains: AuroraCurtain[], mask: { x: number; halfWidth: number } | null = null) {
    curtains.forEach((c, ci) => {
      const W = 140;
      const curve = new THREE.CatmullRomCurve3(c.path.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const g = new THREE.PlaneGeometry(1, 1, W, 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const P = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) + 0.5;
        const v = pos.getY(i) + 0.5;
        curve.getPointAt(u, P);
        pos.setXYZ(i, P.x, c.base + v * c.height, P.z);
        uv.setXY(i, u, v);
      }
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: { uTime: globalUniforms.uTime, uNight: globalUniforms.uNight, uStrength: this.strength, uBand: { value: ci }, uK: { value: c.strength ?? 1 }, uMask: { value: new THREE.Vector2(mask?.x ?? 1e5, mask?.halfWidth ?? 0) } },
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vW; uniform float uTime; uniform float uBand;
          void main() {
            vUv = uv;
            vec3 p = position;
            // Curtains ripple sideways in slow travelling folds (the top sways more than the hem).
            float drift = uTime * 0.314;
            p.z += sin(uv.x * 11.0 + drift + uBand * 2.0) * (0.8 + uv.y * 2.2) + sin(uv.x * 29.0 - drift * 1.7) * 0.35 * uv.y;
            p.x += cos(uv.x * 7.0 + drift * 0.8) * 1.2 * uv.y;
            vec4 w = modelMatrix * vec4(p, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vW; uniform float uTime; uniform float uNight; uniform float uStrength; uniform float uBand; uniform float uK; uniform vec2 uMask;
          ${NOISE_GLSL}
          void main() {
            float u = vUv.x; float v = vUv.y;
            float t = uTime * 0.314;
            // Pleats: broad bright folds drifting slowly along the curtain, a little fine texture.
            float fold = hvNoise(vec2(u * 9.0 - t * 0.6 + uBand * 5.0, 0.5 + v * 0.35));
            fold = 0.25 + 0.75 * smoothstep(0.3, 0.85, fold);
            float fine = 0.85 + 0.15 * hvNoise(vec2(u * 60.0 + t, v * 2.0));
            // Soft lower hem (brightest just above it), fading out towards the top.
            float hem = smoothstep(0.0, 0.1 + 0.06 * hvNoise(vec2(u * 20.0, t)), v);
            float body = hem * (0.35 + 0.65 * pow(1.0 - v, 1.4)) * (1.0 + 1.2 * exp(-v * 9.0));
            float ends = smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(0.86, 1.0, u));
            vec3 green = vec3(0.16, 1.0, 0.5);
            vec3 teal = vec3(0.12, 0.8, 0.75);
            vec3 magenta = vec3(0.8, 0.22, 0.78);
            vec3 col = mix(green, teal, smoothstep(0.1, 0.45, v));
            col = mix(col, magenta, smoothstep(0.4, 0.95, v));
            float clear = smoothstep(uMask.y * 0.55, uMask.y, abs(vW.x - uMask.x));
            float a = body * fold * fine * ends * clear * uK;
            gl_FragColor = vec4(col * a * 0.9 * uStrength * smoothstep(0.4, 0.9, uNight), 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = -900 + ci;
      mesh.userData.noAO = true;
      mesh.name = 'aurora';
      this.group.add(mesh);
    });
    this.group.name = 'aurora';
  }
}

// ───────────────────────────────────────────── snowfall

export class Snowfall {
  readonly points: THREE.Points;
  readonly center = { value: new THREE.Vector3() };
  readonly scale = { value: 1000 };
  constructor(count = 1800, box = new THREE.Vector3(36, 14, 30), o: { color?: THREE.Color; size?: number; fall?: number; twinkle?: number } = {}) {
    const g = new THREE.BufferGeometry();
    const s = new Float32Array(count * 4);
    for (let i = 0; i < s.length; i++) s[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uTime: globalUniforms.uTime, uCenter: this.center, uBox: { value: box }, uScale: this.scale, uTint: { value: o.color ?? new THREE.Color(0.85, 0.9, 1.0) }, uSz: { value: o.size ?? 1 }, uFall: { value: o.fall ?? 1 }, uTw: { value: o.twinkle ?? 0 }, uMap: { value: textures.softDot().map }, uSkyColor: globalUniforms.uSkyColor, uLamps: globalUniforms.uLamps },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uScale; uniform float uSz; uniform float uFall; uniform float uTw;
        varying float vA;
        ${FOG_PARS_V}
        void main() {
          vec4 s = aSeed;
          vec3 base = s.xyz * uBox;
          float t = uTime;
          vec3 d = vec3(sin(t * (0.3 + s.w * 0.4) + s.x * 30.0) * 0.6 + t * 0.15, -t * (0.55 + s.w * 0.45) * uFall, cos(t * (0.25 + s.y * 0.3) + s.z * 20.0) * 0.5);
          vec3 lo = uCenter - uBox * 0.5;
          vec3 local = mod(base + d - lo, uBox);
          float fade = clamp(min(local.y, uBox.y - local.y) / 1.5, 0.0, 1.0) * clamp(min(min(local.x, uBox.x - local.x), min(local.z, uBox.z - local.z)) / 3.0, 0.0, 1.0);
          vec4 mvPosition = viewMatrix * vec4(lo + local, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float sz = (0.05 + s.w * s.w * 0.1) * uSz;
          gl_PointSize = sz * uScale / -mvPosition.z;
          vA = fade * (0.55 + 0.45 * s.y) * (1.0 - uTw + uTw * pow(0.5 + 0.5 * sin(t * (3.0 + s.x * 5.0) + s.z * 60.0), 4.0));
          ${FOG_V}
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uSkyColor; uniform float uLamps; uniform vec3 uTint; uniform float uTw;
        varying float vA;
        ${FOG_PARS_F}
        void main() {
          float m = texture2D(uMap, gl_PointCoord).a;
          vec3 c = mix(uTint, vec3(1.0, 0.9, 0.78), uLamps * 0.35 * (1.0 - uTw)) * mix(0.55 + uSkyColor * 0.6, vec3(2.2), uTw);
          gl_FragColor = vec4(c, m * vA * 0.85);
          if (gl_FragColor.a < 0.01) discard;
          ${FOG_F}
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    this.points.userData.noAO = true;
    this.points.name = 'snowfall';
  }
  update(focus: THREE.Vector3, viewportH: number): void {
    this.center.value.set(focus.x, focus.y + 5, focus.z + 2);
    this.scale.value = viewportH * 1.4;
  }
}

// ───────────────────────────────────────────── glow points

export interface GlowPoint {
  x: number;
  y: number;
  z: number;
  color: number;
  size: number;
  /** 0 steady .. 1 strong twinkle. */
  twinkle?: number;
  /** Also shown by day (else fades in with the lamps). */
  day?: number;
}

export class GlowPoints {
  readonly points: THREE.Points;
  readonly scale = { value: 1000 };
  readonly strength = { value: 1 };
  constructor(list: GlowPoint[], name = 'glow') {
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const info = new Float32Array(n * 4);
    const c = new THREE.Color();
    list.forEach((p, i) => {
      pos.set([p.x, p.y, p.z], i * 3);
      c.setHex(p.color).convertSRGBToLinear();
      col.set([c.r, c.g, c.b], i * 3);
      info.set([p.size, p.twinkle ?? 0, Math.random(), p.day ?? 0], i * 4);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uTime: globalUniforms.uTime, uLamps: globalUniforms.uLamps, uScale: this.scale, uStrength: this.strength, uMap: { value: textures.softDot().map } },
      vertexShader: /* glsl */ `
        attribute vec3 aCol; attribute vec4 aInfo; uniform float uTime; uniform float uLamps; uniform float uScale; uniform float uStrength;
        varying vec3 vCol;
        ${FOG_PARS_V}
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float tw = 1.0 - aInfo.y * (0.5 + 0.5 * sin(uTime * (2.0 + aInfo.z * 3.0) + aInfo.z * 40.0)) * (0.6 + 0.4 * sin(uTime * 7.3 + aInfo.z * 17.0));
          float on = max(uLamps, aInfo.w) * uStrength;
          gl_PointSize = aInfo.x * uScale / -mvPosition.z * (0.75 + 0.25 * tw);
          vCol = aCol * tw * on;
          ${FOG_V}
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vCol;
        ${FOG_PARS_F}
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float a = exp(-r * r * 4.0) * 0.6 + exp(-r * r * 26.0) * 0.9;
          gl_FragColor = vec4(vCol * a * 1.6, 1.0);
          #ifdef USE_FOG
            gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.renderOrder = 7;
    this.points.userData.noAO = true;
    this.points.name = name;
  }
  setViewportHeight(h: number): void {
    this.scale.value = h * 1.3;
  }
  /** Move / resize one point at runtime (mini-game beacons). size 0 hides it. */
  set(i: number, x: number, y: number, z: number, size?: number): void {
    const g = this.points.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(i, x, y, z);
    pos.needsUpdate = true;
    if (size !== undefined) {
      const info = g.attributes.aInfo as THREE.BufferAttribute;
      info.setX(i, size);
      info.needsUpdate = true;
    }
  }
}

// ───────────────────────────────────────────── falling petals under trees

/**
 * Petals drifting down out of tree canopies and settling on the grass under them (then fading):
 * every canopy is an emitter. GPU-animated, one draw call for the whole grove.
 */
export class PetalFall {
  readonly mesh: THREE.Mesh;
  constructor(canopies: { x: number; y: number; z: number; r: number; ground: number }[], perTree = 70, colors = [0xf9c6d6, 0xfbd8e2, 0xffffff, 0xf4aec4]) {
    const base = petalGeometry(0.085, 0.062, 0.014);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position!);
    g.setAttribute('normal', base.attributes.normal!);
    const n = canopies.length * perTree;
    g.instanceCount = n;
    const seed = new Float32Array(n * 4);
    const tree = new Float32Array(n * 4);
    const ground = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const t = canopies[Math.floor(i / perTree)]!;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      tree.set([t.x, t.y, t.z, t.r], i * 4);
      ground[i] = t.ground;
      c.setHex(colors[i % colors.length]!).convertSRGBToLinear();
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aTree', new THREE.InstancedBufferAttribute(tree, 4));
    g.setAttribute('aGround', new THREE.InstancedBufferAttribute(ground, 1));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: true,
      uniforms: shared({}),
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute vec4 aTree; attribute float aGround; attribute vec3 aCol;
        uniform float uTime; uniform vec2 uWindDir;
        varying vec3 vN; varying vec3 vCol; varying vec3 vW;
        ${FOG_PARS_V}
        ${ROT_GLSL}
        void main() {
          vec4 s = aSeed;
          float per = 7.0 + s.w * 5.0;
          float lt = mod(uTime + s.x * per, per);
          float h = aTree.y - aGround;
          float spd = 0.38 + s.y * 0.3;
          float dur = h / spd;
          float a0 = s.z * 6.2831;
          float rr = sqrt(s.y) * aTree.w;
          vec3 start = vec3(aTree.x + cos(a0) * rr, aTree.y - s.w * 0.6, aTree.z + sin(a0) * rr);
          float ft = min(lt, dur);
          vec3 wind = vec3(uWindDir.x, 0.0, uWindDir.y) * ft * 0.35;
          vec3 sway = vec3(sin(ft * 1.7 + s.x * 20.0), 0.0, cos(ft * 1.3 + s.z * 17.0)) * 0.35 * min(ft, 1.0);
          vec3 p = start + wind + sway;
          p.y = max(aGround + 0.02, aTree.y - s.w * 0.6 - ft * spd);
          bool landed = lt >= dur;
          float fade = smoothstep(0.0, 0.6, lt) * (1.0 - smoothstep(dur + 1.5, per, lt));
          float ang = landed ? s.x * 6.0 : ft * (3.0 + s.w * 3.0) + s.x * 30.0;
          mat3 R = landed ? mat3(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0) * fxAxisAngle(vec3(0.0, 0.0, 1.0), ang) : fxAxisAngle(vec3(s.y - 0.5, s.z - 0.5, s.x - 0.45) + 0.02, ang);
          vec3 v = R * (position * fade * 1.1);
          vN = normalize(R * normal);
          vCol = aCol;
          vW = p + v;
          vec4 mvPosition = viewMatrix * vec4(vW, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          ${FOG_V}
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor;
        varying vec3 vN; varying vec3 vCol; varying vec3 vW;
        ${FOG_PARS_F}
        void main() {
          vec3 n = normalize(vN);
          vec3 L = normalize(uSunDir);
          vec3 V = normalize(cameraPosition - vW);
          float d = abs(dot(n, L));
          float trans = pow(max(dot(-V, L), 0.0), 3.0);
          vec3 c = vCol * (uSunColor * (0.35 + 0.65 * d) * 0.95 + uSkyColor * 0.5 + vec3(0.04)) + vCol * uSunColor * trans * 0.6;
          gl_FragColor = vec4(c, 1.0);
          ${FOG_F}
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'petal-fall';
    this.mesh.userData.noAO = true;
    this.mesh.renderOrder = 4;
  }
}

// ───────────────────────────────────────────── maypole ribbons

/**
 * Satin ribbons strung from the pole crown to each dancer's raised hand: a catenary sag, a
 * travelling flutter and a slow twist. CPU-updated strips (a few hundred vertices), one draw call.
 */
export class Ribbons {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private readonly segs: number;
  constructor(readonly count: number, colors: number[], segs = 22) {
    this.segs = segs;
    const n = count * (segs + 1) * 2;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    const col = new Float32Array(n * 3);
    const idx: number[] = [];
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      c.setHex(colors[k % colors.length]!).convertSRGBToLinear();
      for (let i = 0; i <= segs; i++) {
        const v = (k * (segs + 1) + i) * 2;
        // Satin sheen: the two edges a touch different.
        col.set([c.r, c.g, c.b], v * 3);
        col.set([c.r * 0.88, c.g * 0.88, c.b * 0.88], (v + 1) * 3);
        if (i < segs) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    g.setAttribute('position', this.pos);
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide });
    m.name = 'ribbons';
    applyWorldFx(m, { snow: false });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noAO = true;
    this.mesh.name = 'ribbons';
  }

  private static A = new THREE.Vector3();
  private static D = new THREE.Vector3();
  private static S = new THREE.Vector3();
  private static U = new THREE.Vector3();
  private static P = new THREE.Vector3();
  private static W = new THREE.Vector3();

  /** Re-string ribbon k from `a` (pole) to `b` (hand). `slack` adds sag (m). */
  set(k: number, a: THREE.Vector3, b: THREE.Vector3, t: number, slack = 0.12, width = 0.075): void {
    const { A, D, S, U, P, W } = Ribbons;
    D.subVectors(b, a);
    const len = D.length();
    S.set(-D.z, 0, D.x).normalize();
    U.crossVectors(D, S).normalize();
    for (let i = 0; i <= this.segs; i++) {
      const u = i / this.segs;
      A.copy(a).addScaledVector(D, u);
      A.y -= slack * 4 * u * (1 - u) * (0.6 + 0.4 * len / 5);
      const fl = Math.sin(u * 10 - t * 7 + k * 1.9) * 0.06 * u * (1 - u) * 4;
      A.addScaledVector(S, fl).addScaledVector(U, Math.sin(u * 7 - t * 5 + k) * 0.025 * u);
      const tw = Math.sin(u * 5 + t * 2.3 + k * 2.1) * 0.7 + 0.3;
      W.copy(S).multiplyScalar(Math.cos(tw)).addScaledVector(U, Math.sin(tw)).multiplyScalar(width / 2);
      const v = (k * (this.segs + 1) + i) * 2;
      P.copy(A).add(W);
      this.pos.setXYZ(v, P.x, P.y, P.z);
      P.copy(A).sub(W);
      this.pos.setXYZ(v + 1, P.x, P.y, P.z);
    }
  }

  commit(): void {
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

// ───────────────────────────────────────────── bonfire

/**
 * A living bonfire: 5 camera-facing flame cards shaped by scrolling noise (hot core → orange →
 * ember-red rim, tonemapped so bloom keeps the tongue shapes), plus rising embers that sway and
 * wink out. GPU-animated, two draw calls.
 */
export class Bonfire {
  readonly group = new THREE.Group();
  constructor(center: THREE.Vector3, scale = 1) {
    const cards = 5;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position!);
    g.setAttribute('uv', quad.attributes.uv!);
    g.instanceCount = cards;
    const info = new Float32Array(cards * 4);
    for (let i = 0; i < cards; i++) {
      const a = (i / cards) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.2;
      // offset x, offset z, size, seed
      info.set([Math.cos(a) * r * scale, Math.sin(a) * r * scale, (i === 0 ? 1.55 : 1.0 + (i % 2) * 0.25) * scale, Math.random() * 10], i * 4);
    }
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uTime: globalUniforms.uTime, uCenter: { value: center.clone() } },
      vertexShader: /* glsl */ `
        attribute vec4 aInfo; uniform vec3 uCenter; uniform float uTime;
        varying vec2 vUv; varying float vSeed;
        ${FOG_PARS_V}
        void main() {
          vUv = uv;
          vSeed = aInfo.w;
          vec3 c = uCenter + vec3(aInfo.x, 0.0, aInfo.y);
          vec4 mvPosition = viewMatrix * vec4(c, 1.0);
          float s = aInfo.z * (0.92 + 0.08 * sin(uTime * 7.0 + aInfo.w));
          mvPosition.xy += vec2(position.x * s * 0.62, position.y * s);
          gl_Position = projectionMatrix * mvPosition;
          ${FOG_V}
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv; varying float vSeed;
        ${NOISE_GLSL}
        ${FOG_PARS_F}
        void main() {
          vec2 uv = vUv;
          float t = uTime;
          float n = hvNoise(vec2(uv.x * 3.0 + vSeed, uv.y * 3.5 - t * 2.6)) * 0.62 + hvNoise(vec2(uv.x * 7.0 - vSeed, uv.y * 7.0 - t * 4.2)) * 0.38;
          float y = uv.y;
          float w = 0.46 * pow(max(1.0 - y, 0.0), 0.75) * (0.75 + 0.25 * sin(y * 6.0 - t * 5.0 + vSeed));
          float sway = (n - 0.5) * 0.35 * y + sin(t * 3.0 + vSeed + y * 4.0) * 0.05 * y;
          float d = abs(uv.x - 0.5 - sway) / max(w, 0.001);
          float body = 1.0 - smoothstep(0.35, 1.0, d + (n - 0.5) * 0.9 * y + y * 0.25);
          body *= smoothstep(0.0, 0.08, y);
          float core = 1.0 - smoothstep(0.0, 0.55, d + y * 0.9);
          vec3 red = vec3(0.55, 0.05, 0.0);
          vec3 orange = vec3(1.0, 0.28, 0.02);
          vec3 gold = vec3(1.0, 0.55, 0.12);
          vec3 c = mix(red, orange, smoothstep(0.0, 0.55, body));
          c = mix(c, gold, core * 0.55);
          gl_FragColor = vec4(c * body * 0.9, 1.0);
          #ifdef USE_FOG
            gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
        }`,
    });
    const flames = new THREE.Mesh(g, m);
    flames.frustumCulled = false;
    flames.renderOrder = 8;
    flames.userData.noAO = true;
    flames.name = 'bonfire-flames';
    this.group.add(flames);
    // Embers.
    const N = 70;
    const eg = new THREE.BufferGeometry();
    const seeds = new Float32Array(N * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const em = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uTime: globalUniforms.uTime, uCenter: { value: center.clone() }, uScale: { value: 1000 }, uMap: { value: textures.softDot().map } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uScale;
        varying float vA;
        ${FOG_PARS_V}
        void main() {
          vec4 s = aSeed;
          float per = 1.8 + s.w * 1.6;
          float lt = mod(uTime + s.x * per, per) / per;
          vec3 p = uCenter + vec3((s.y - 0.5) * 0.5, 0.2, (s.z - 0.5) * 0.5);
          p.y += lt * (2.2 + s.w * 1.8);
          p.x += sin(lt * 9.0 + s.x * 20.0) * 0.25 * lt;
          p.z += cos(lt * 7.0 + s.z * 20.0) * 0.25 * lt;
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = (0.035 + s.y * 0.04) * uScale / -mvPosition.z;
          vA = (1.0 - lt) * smoothstep(0.0, 0.08, lt) * (0.6 + 0.4 * sin(uTime * 20.0 + s.z * 50.0));
          ${FOG_V}
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vA;
        ${FOG_PARS_F}
        void main() {
          float m = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vec3(1.0, 0.6, 0.2) * m * vA * 2.2, 1.0);
          #ifdef USE_FOG
            gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
        }`,
    });
    const embers = new THREE.Points(eg, em);
    embers.frustumCulled = false;
    embers.renderOrder = 8;
    embers.userData.noAO = true;
    embers.name = 'bonfire-embers';
    this.group.add(embers);
    this.embersScale = em.uniforms.uScale!;
    this.group.name = 'bonfire';
  }
  private embersScale: THREE.IUniform;
  setViewportHeight(h: number): void {
    this.embersScale.value = h * 1.3;
  }
}
