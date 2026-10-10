/**
 * Depth-aware atmosphere pass (runs right after the scene render, before AO / bloom):
 *
 *  - Analytic height fog: exponential density falling off above a base height, integrated exactly
 *    along each view ray (camera → reconstructed world point), with noise-advected density so the
 *    mist drifts in banks and pools in hollows. Forward-scatters warm towards the sun. Replaces the
 *    stacked fog planes (no hard lines where mist meets cliffs, trunks or the ground).
 *  - Volumetric light shafts: up to 32 soft cylinders along the sun direction (canopy gaps). Each
 *    pixel integrates its view segment against every shaft analytically, clipped by scene depth, so
 *    shafts pass behind trunks / canopies correctly and fade out softly (a true soft-particle).
 *
 * State lives in `atmosphere` (module level) so it survives quality changes (the post pipeline is
 * rebuilt then). The weather system drives the fog, maps register shafts. Disabled (skipped by the
 * composer) whenever both are idle.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { globalUniforms } from './uniforms';
import { NOISE_GLSL } from './shaders/noise';

export const MAX_SHAFTS = 32;

export const atmosphere = {
  /** 0..1 height-fog amount (0 = off). */
  fog: 0,
  /** World height the densest mist sits at (usually the map's low ground). */
  base: 0,
  /** Exponential falloff height (m). */
  falloff: 1.6,
  /** Peak extinction per metre at `base`. */
  density: 0.09,
  /** Light-shaft strength (0 = off). */
  shafts: 0,
  shaftList: [] as { x: number; y: number; z: number; w: number }[],
  /** Shaft length along the sun direction (m). */
  shaftLen: 14,
  /** The local farmer (feet, world): mist and shafts stay thin on him so he never goes milky. */
  player: new THREE.Vector3(1e4, 0, 1e4),
  /**
   * Terrain-following ground mist (0 = off): a layer `mistH` m thick that lies on the ground wherever
   * it is (valley floor, banks, plateau, over the water), read from the map's height texture. Dense
   * drifting banks with clear lanes between them; fades softly against anything standing in it.
   */
  mist: 0,
  mistH: 0.9,
  ground: null as { tex: THREE.Texture; origin: THREE.Vector2; size: THREE.Vector2; water: number } | null,
  /** Lightning strike point (xyz, world) + local flash 0..1 (w): the stroke lights its surroundings. */
  strike: new THREE.Vector4(0, 0, 0, 0),
};

const FogShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uCamFwd: { value: new THREE.Vector3(0, -1, 0) },
    uFog: { value: 0 },
    uBase: { value: 0 },
    uFalloff: { value: 1.6 },
    uDensity: { value: 0.09 },
    uLit: { value: new THREE.Color(1, 0.95, 0.9) },
    uShade: { value: new THREE.Color(0.7, 0.75, 0.82) },
    uShafts: { value: Array.from({ length: MAX_SHAFTS }, () => new THREE.Vector4()) },
    uShaftCount: { value: 0 },
    uShaftK: { value: 0 },
    uShaftLen: { value: 14 },
    uShaftCol: { value: new THREE.Color(1, 0.95, 0.8) },
    uStrike: { value: new THREE.Vector4() },
    uViewProj: { value: new THREE.Matrix4() },
    uPud: { value: 0 },
    uRainP: globalUniforms.uRain,
    uTime: globalUniforms.uTime,
    uWindDir: globalUniforms.uWindDir,
    uSunDir: globalUniforms.uSunDir,
    uPlayer: { value: new THREE.Vector3(1e4, 0, 1e4) },
    uMist: { value: 0 },
    uMistH: { value: 0.9 },
    uGround: { value: null as THREE.Texture | null },
    uGOrigin: { value: new THREE.Vector2() },
    uGSize: { value: new THREE.Vector2(1, 1) },
    uGWater: { value: -99 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform vec3 uCamFwd;
    uniform float uFog;
    uniform float uBase;
    uniform float uFalloff;
    uniform float uDensity;
    uniform vec3 uLit;
    uniform vec3 uShade;
    uniform vec4 uShafts[${MAX_SHAFTS}];
    uniform int uShaftCount;
    uniform float uShaftK;
    uniform float uShaftLen;
    uniform vec3 uShaftCol;
    uniform vec4 uStrike;
    uniform mat4 uViewProj;
    uniform float uPud;
    uniform float uRainP;
    uniform float uTime;
    uniform vec2 uWindDir;
    uniform vec3 uSunDir;
    uniform vec3 uPlayer;
    uniform float uMist;
    uniform float uMistH;
    uniform sampler2D uGround;
    uniform vec2 uGOrigin;
    uniform vec2 uGSize;
    uniform float uGWater;
    varying vec2 vUv;
    float hvGround(vec2 xz) {
      vec2 uv = clamp((xz - uGOrigin) / uGSize, vec2(0.001), vec2(0.999));
      return max(texture2D(uGround, uv).r, uGWater);
    }
    // Optical depth of exp(-(y - g) / H) along a segment (camera y0 → surface y1, both relative to g).
    float hvOptical(float L, float y0, float y1, float H) {
      float dy = y1 - y0;
      float e0 = exp(-max(y0, -2.0) / H);
      float e1 = exp(-max(y1, -2.0) / H);
      return abs(dy) > 1e-3 ? abs(L * H * (e0 - e1) / dy) : L * e0;
    }
    ${NOISE_GLSL}
    vec3 worldAt(vec2 uv, float d) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec4 v = uProjInv * ndc;
      v /= v.w;
      return (uCamWorld * v).xyz;
    }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float d = texture2D(tDepth, vUv).r;
      vec3 P = worldAt(vUv, min(d, 0.99999));
      vec3 ro = uCamPos;
      vec3 rd = P - ro;
      float L = length(rd);
      rd /= max(L, 1e-4);
      vec3 c = col.rgb;
      if (uPud > 0.001 && col.a < 0.52 && d < 0.99999) {
        // Puddle mirror (terrain tags standing water in alpha): trace the reflected ray through the
        // depth buffer and pick up the real scene — the farmer standing in it, trunks, the bridge —
        // with rain ripples wobbling the image and Fresnel (top-down: mostly the dark mud; grazing:
        // a mirror). Rays that leave the frame keep the terrain's own sky probe.
        float pud = clamp((0.5 - col.a) / 0.45, 0.0, 1.0);
        float rk = 0.025 + 0.11 * uRainP;
        vec2 rip = vec2(hvNoise(P.xz * 5.0 + vec2(uTime * 0.9, uTime * 0.4)), hvNoise(P.xz * 5.0 + vec2(7.3 - uTime * 0.5, 3.1 + uTime * 0.8))) - 0.5;
        vec3 N = normalize(vec3(rip.x * rk * 2.0, 1.0, rip.y * rk * 2.0));
        vec3 R = reflect(rd, N);
        float t = 0.12;
        float tPrev = 0.0;
        float hit = 0.0;
        vec2 huv = vec2(0.0);
        for (int i = 0; i < 20; i++) {
          vec3 Q = P + R * t;
          vec4 cq = uViewProj * vec4(Q, 1.0);
          vec2 uq = cq.xy / cq.w * 0.5 + 0.5;
          if (cq.w <= 0.0 || uq.x < 0.0 || uq.x > 1.0 || uq.y < 0.0 || uq.y > 1.0) break;
          float sd = texture2D(tDepth, uq).r;
          if (sd < 0.99999) {
            float dq = cq.w;
            float ds = dot(worldAt(uq, sd) - ro, uCamFwd);
            float thick = max(0.35, t * 0.4);
            if (ds < dq - 0.03 && ds > dq - thick) {
              // Refine between the last miss and this hit (4 bisections).
              float a = tPrev;
              float b = t;
              for (int k = 0; k < 4; k++) {
                float m = 0.5 * (a + b);
                vec4 cm = uViewProj * vec4(P + R * m, 1.0);
                vec2 um = cm.xy / cm.w * 0.5 + 0.5;
                float sm = dot(worldAt(um, texture2D(tDepth, um).r) - ro, uCamFwd);
                if (sm < cm.w - 0.03) b = m; else a = m;
              }
              vec4 cb = uViewProj * vec4(P + R * b, 1.0);
              huv = cb.xy / cb.w * 0.5 + 0.5;
              vec2 edge = smoothstep(vec2(0.0), vec2(0.08), huv) * smoothstep(vec2(0.0), vec2(0.08), 1.0 - huv);
              hit = edge.x * edge.y * (1.0 - smoothstep(6.0, 14.0, b));
              break;
            }
          }
          tPrev = t;
          t = t * 1.3 + 0.06;
        }
        if (hit > 0.0) {
          vec3 rc = texture2D(tDiffuse, huv).rgb * vec3(0.82, 0.88, 0.94);
          float fr = 0.36 + 0.5 * pow(1.0 - max(-rd.y, 0.0), 3.0);
          c = mix(c, rc, clamp(fr * hit * (0.35 + 0.65 * pud), 0.0, 0.85));
        }
      }
      // Pixels on the farmer (a 0.55 m column from the ankles up): fog and shafts at ~40 %.
      float onPlayer = (1.0 - smoothstep(0.42, 0.62, length(P.xz - uPlayer.xz))) * step(uPlayer.y + 0.12, P.y) * (1.0 - step(uPlayer.y + 2.2, P.y));
      float keepK = 1.0 - onPlayer * 0.6;
      // Near the farmer (the focus of every frame) beams stay subtle: a log or a bush standing in a
      // shaft must never turn into a translucent ghost.
      float nearFocus = 1.0 - smoothstep(1.2, 3.0, length(P.xz - uPlayer.xz));
      // Mist noise, reused by the height-fog banks below when both run (fog mornings, rain).
      float hvNb = -1.0;
      float hvNr = 0.0;
      if (uMist > 0.001) {
        // Ground under the surface point: the lowest of five taps (on a cliff face or a trunk the
        // foot of it is found, so walls are misted at their base only, not all the way up).
        // (Every term below is continuous in P: the old hard step on "over water" drew a sharp-edged
        // grey slab 1.4 m out along every straight bank.)
        float g0 = hvGround(P.xz);
        float g = g0;
        g = min(g, hvGround(P.xz + vec2(1.4, 0.0)));
        g = min(g, hvGround(P.xz - vec2(1.4, 0.0)));
        g = min(g, hvGround(P.xz + vec2(0.0, 1.4)));
        g = min(g, hvGround(P.xz - vec2(0.0, 1.4)));
        // Flat ground: the surface's own height (the min only matters on walls and trunks).
        g = mix(g, g0, smoothstep(0.6, 0.15, g0 - g));
        vec2 drift = uWindDir * uTime * 0.22;
        // Where mist gathers: over open water (the stream, the pool) and in the hollows (ground lower
        // than its surroundings 4 m out). Grass lanes and raised banks stay nearly clear, so the
        // mist reads as low-lying rivers of vapour, not a veil over the whole frame.
        float gw = 0.25 * (hvGround(P.xz + vec2(4.0, 0.0)) + hvGround(P.xz - vec2(4.0, 0.0)) + hvGround(P.xz + vec2(0.0, 4.0)) + hvGround(P.xz - vec2(0.0, 4.0)));
        // Over-water weight from the neighbourhood (not just this pixel's ground): the vapour spills a
        // few metres up the banks and thins out gradually instead of stopping at the waterline.
        float gNear = mix(g0, min(g, gw), 0.65);
        float overWater = 1.0 - smoothstep(uGWater + 0.05, uGWater + 1.3, gNear);
        float hollow = smoothstep(0.05, 0.7, gw - g0);
        // Banks: big slow ISOTROPIC cells (thickness) × soft billows (density) → dense pools, clear
        // lanes. (Stretched noise here drew long streaky ribbons — dirty glass, not vapour.) The
        // billow field varies with height a little, so the mist is a soft 3D volume, not a decal.
        float nb = hvFbm(P.xz * 0.075 - drift * 0.07 + 17.0);
        float nr = hvNoise(P.xz * 0.21 + vec2(P.y * 0.35, -P.y * 0.2) - drift * 0.18);
        float nw = hvNoise(P.xz * 0.55 + vec2(nb * 1.3, P.y * 0.6) - drift * 0.4);
        hvNb = nb;
        hvNr = nr;
        float bank = smoothstep(0.46, 0.72, nb);
        bank = max(bank * 0.3, max(overWater * (0.5 + 0.5 * nb), hollow * 0.25));
        // A ground-hugging band (~0-1.2 m): thickest over the water, thin on the banks.
        float H = uMistH * (0.4 + 0.85 * bank);
        float optical = hvOptical(L, ro.y - g, P.y - g, H);
        // Soft billows with real gaps: over the pool the dark water shows between them.
        float tear = smoothstep(0.32, 0.72, nr) * (0.45 + 0.55 * smoothstep(0.25, 0.75, nw));
        tear = 0.04 + 0.96 * tear * (2.0 - tear);
        float dens = uMist * (0.02 + 0.66 * bank * tear);
        float f = 1.0 - exp(-optical * dens);
        f *= d > 0.99999 ? 0.5 : 1.0;
        // Sun glints and foam on the water keep their sparkle through the mist.
        f *= 1.0 - 0.55 * smoothstep(0.75, 1.4, dot(c, vec3(0.3, 0.5, 0.2)));
        float sunF = pow(max(dot(rd, normalize(uSunDir)), 0.0), 3.0);
        float top = smoothstep(0.0, H * 1.2, P.y - g);
        vec3 fc = mix(uShade * 0.86, uLit * 0.98, 0.15 + 0.45 * tear + 0.25 * top);
        fc += uLit * sunF * 0.2;
        c = mix(c, fc, clamp(f * (1.0 - onPlayer * 0.8), 0.0, 0.4));
      }
      if (uFog > 0.001) {
        // Exact integral of exp(-(y-base)/H) along the segment.
        float H = uFalloff;
        float y0 = ro.y - uBase;
        float y1 = P.y - uBase;
        float dy = y1 - y0;
        float e0 = exp(-y0 / H);
        float e1 = exp(-y1 / H);
        float optical = abs(dy) > 1e-3 ? L * H * (e0 - e1) / (-dy) * -1.0 : L * e0;
        optical = abs(optical);
        // Drifting banks: density at the surface point (the mist lies on the ground).
        vec2 drift = uWindDir * uTime * 0.35;
        float n;
        float sheet;
        if (hvNb >= 0.0) {
          // The mist already sampled the bank field at this point: reuse it (6 noise taps saved).
          n = hvNb;
          sheet = hvNr;
          // (both isotropic now: no streaks)
        } else {
          n = hvFbm(P.xz * 0.075 - drift * 0.075) * 0.7 + hvNoise(P.xz * 0.23 + vec2(uTime * 0.03, -uTime * 0.02)) * 0.3;
          // Wispy sheets: a second, finer stretched layer tears the banks into drifting ribbons.
          sheet = hvNoise(P.xz * 0.2 - drift * 0.16);
        }
        // Separate pockets: banks with clear lanes between them (squared: thin mist stays thin).
        float bank = smoothstep(0.46, 0.78, n) * (0.35 + 0.65 * smoothstep(0.3, 0.7, sheet));
        float dens = uDensity * uFog * (0.02 + 3.4 * bank * bank);
        float f = 1.0 - exp(-optical * dens);
        // Sky pixels (far plane): keep only a thin veil.
        f *= d > 0.99999 ? 0.4 : 1.0;
        float sunF = pow(max(dot(rd, normalize(uSunDir)), 0.0), 4.0);
        vec3 fc = mix(uShade, uLit, 0.45 + 0.55 * bank);
        fc += uLit * sunF * 0.35;
        c = mix(c, fc, clamp(f * keepK, 0.0, 0.72));
      }
      if (uShaftK > 0.001) {
        // Art direction: beams fall steeply from the canopy (~35 deg off vertical), leaning across the
        // frame towards the sun's side, so they always read as slanted shafts from the diorama camera
        // (a low morning sun would otherwise lay them flat along the ground).
        vec2 hvSide = normalize(vec2(-uCamFwd.z, uCamFwd.x) + 1e-4);
        float hvLean = dot(normalize(uSunDir.xz + 1e-4), hvSide) >= 0.0 ? 1.0 : -1.0;
        vec3 Ls = normalize(vec3(hvSide.x * hvLean * 0.58, 0.82, hvSide.y * hvLean * 0.58) + vec3(uSunDir.x, 0.0, uSunDir.z) * 0.15);
        float acc = 0.0;
        float poolAcc = 0.0;
        for (int i = 0; i < ${MAX_SHAFTS}; i++) {
          if (i >= uShaftCount) break;
          vec4 s = uShafts[i];
          vec3 a = s.xyz;
          // Where the beam lands: a warm pool of dappled light on the forest floor under the gap.
          vec2 pd = P.xz - a.xz - Ls.xz * max(P.y - a.y, 0.0) / max(Ls.y, 0.3);
          poolAcc += exp(-dot(pd, pd) / (s.w * s.w * 2.6)) * (1.0 - smoothstep(0.4, 1.6, abs(P.y - a.y)));
          // Closest approach between the view segment and the shaft axis (a + Ls * t, t in 0..len).
          vec3 w0 = ro - a;
          float b = dot(rd, Ls);
          float dd = dot(rd, w0);
          float e = dot(Ls, w0);
          float den = 1.0 - b * b;
          float tr = den > 1e-4 ? (b * e - dd) / den : 0.0;
          tr = clamp(tr, 0.0, L);
          float ts = clamp(dot(ro + rd * tr - a, Ls), 0.0, uShaftLen);
          vec3 q = a + Ls * ts;
          float tr2 = clamp(dot(q - ro, rd), 0.0, L);
          float dist = length(ro + rd * tr2 - q);
          float wdt = s.w * (1.0 + ts / uShaftLen * 0.35);
          // Bright along the whole fall, fading only where the beam leaves the canopy / meets the ground.
          // (Reaching down to ~1 m: the beam lands in its dappled pool on the forest floor.)
          float along = smoothstep(0.03, 0.12, ts / uShaftLen) * (1.0 - smoothstep(0.62, 1.0, ts / uShaftLen));
          // Chord length through the soft cylinder ~ width / sin(angle between ray and axis).
          float chord = min(wdt * 2.0 / max(sqrt(den), 0.15), 8.0);
          float g = exp(-dist * dist / (wdt * wdt) * 3.0);
          // Most pixels are nowhere near most beams: skip the striation noise for them.
          if (g * along < 0.002) continue;
          // Striations: thinner rays inside each beam (light through leaves), slowly shifting.
          vec3 q2 = ro + rd * tr2 - q;
          float stri = 0.55 + 0.45 * hvNoise(vec2(dot(q2, cross(Ls, vec3(0.0, 0.0, 1.0))) * 2.6 + float(i) * 3.7, uTime * 0.08));
          float flick = (0.75 + 0.25 * hvNoise(vec2(float(i) * 7.3 + uTime * 0.25, ts * 0.3 - uTime * 0.1))) * stri;
          acc += g * along * chord * flick;
        }
        if (poolAcc > 0.002 && d < 0.99999) {
          // Sun flecks through the leaves: blotchy, slowly swimming spots, lighting the SURFACE
          // (multiplied into its colour, so moss and soil glow warm instead of going milky).
          float dap = smoothstep(0.38, 0.72, hvNoise(P.xz * 2.2 + vec2(uTime * 0.05, -uTime * 0.03)) * 0.7 + hvNoise(P.xz * 6.0) * 0.3);
          c += c * uShaftCol * min(poolAcc, 1.0) * (0.25 + 0.75 * dap) * uShaftK * 0.7 * keepK;
        }
        // Capped: a beam brightens the air, it never bleaches what stands in it.
        // In a misty morning the beams have something to light: brighter, and allowed to glow more.
        float misty = clamp(uMist, 0.0, 1.0);
        vec3 add = uShaftCol * acc * uShaftK * (0.22 + 0.1 * misty) * keepK * (1.0 - nearFocus * 0.4);
        float lum = dot(add, vec3(0.3, 0.5, 0.2));
        c += add * min(1.0, (0.2 + 0.2 * misty) / max(lum, 1e-4));
      }
      if (uStrike.w > 0.001 && d < 0.99999) {
        // Local lightning flash: everything within ~10 m of the strike is thrown into cold white
        // light (the rest of the storm stays dark: a pool of light, not a uniform exposure bump).
        vec3 dv = P - uStrike.xyz;
        dv.y *= 0.6;
        float lk = uStrike.w * exp(-dot(dv, dv) / 34.0);
        // (bright surfaces gain less: water and wet stone catch the light without bleaching to milk)
        float ll = dot(c, vec3(0.3, 0.55, 0.15));
        c += c * vec3(1.0, 1.15, 1.5) * lk * (1.0 - 0.85 * smoothstep(0.2, 0.6, ll)) + vec3(0.01, 0.013, 0.022) * lk;
      }
      gl_FragColor = vec4(c, col.a < 0.52 ? 1.0 : col.a);
    }`,
};

const _tint = new THREE.Color(1.05, 0.97, 0.8);
const _warmWhite = new THREE.Color(1.0, 0.96, 0.86);
const _shaftW = new THREE.Color();
const _frustum = new THREE.Frustum();
const _vp = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

export class HeightFogPass extends Pass {
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;

  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.mat = new THREE.ShaderMaterial({
      name: 'HeightFog',
      uniforms: THREE.UniformsUtils.clone(FogShader.uniforms),
      vertexShader: FogShader.vertexShader,
      fragmentShader: FogShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    // Shared (by reference) globals survive the clone above only if re-linked.
    this.mat.uniforms.uTime = globalUniforms.uTime;
    this.mat.uniforms.uWindDir = globalUniforms.uWindDir;
    this.mat.uniforms.uSunDir = globalUniforms.uSunDir;
    this.mat.uniforms.uRainP = globalUniforms.uRain;
    this.quad = new FullScreenQuad(this.mat);
    this.needsSwap = true;
  }

  /** Called before the composer renders: enable only when there is something to draw. */
  sync(): void {
    const a = atmosphere;
    const mist = a.ground ? a.mist : 0;
    // Puddles stand (terrain.ts) once the ground is soaked: the pass mirrors the scene in them.
    const pud = globalUniforms.uWet.value > 0.5 ? 1 : 0;
    this.enabled = pud > 0 || a.fog > 0.002 || mist > 0.002 || a.strike.w > 0.002 || (a.shafts > 0.002 && a.shaftList.length > 0);
    if (!this.enabled) return;
    const u = this.mat.uniforms;
    u.uPud!.value = pud;
    u.uFog!.value = a.fog;
    u.uBase!.value = a.base;
    u.uFalloff!.value = a.falloff;
    u.uDensity!.value = a.density;
    (u.uPlayer!.value as THREE.Vector3).copy(a.player);
    u.uMist!.value = mist;
    u.uMistH!.value = a.mistH;
    if (a.ground) {
      u.uGround!.value = a.ground.tex;
      (u.uGOrigin!.value as THREE.Vector2).copy(a.ground.origin);
      (u.uGSize!.value as THREE.Vector2).copy(a.ground.size);
      u.uGWater!.value = a.ground.water;
    }
    // Only the beams inside the view frustum go to the shader (the loop runs per pixel: 16 beams
    // map-wide, ~3-6 on screen). Bounding sphere around the whole leaning beam, generous margin.
    this.camera.updateMatrixWorld();
    _vp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_vp);
    const arr = u.uShafts!.value as THREE.Vector4[];
    let n = 0;
    const half = a.shaftLen * 0.5;
    for (const s of a.shaftList) {
      if (n >= MAX_SHAFTS) break;
      _sphere.center.set(s.x, s.y + half * 0.8, s.z);
      _sphere.radius = half * 1.15 + s.w * 3;
      if (!_frustum.intersectsSphere(_sphere)) continue;
      arr[n++]!.set(s.x, s.y, s.z, s.w);
    }
    u.uShaftCount!.value = n;
    u.uShaftK!.value = a.shafts;
    u.uShaftLen!.value = a.shaftLen;
    (u.uStrike!.value as THREE.Vector4).copy(a.strike);
    // Colours follow the day: lit mist takes the sun, shade the sky.
    const sun = globalUniforms.uSunColor.value;
    const sky = globalUniforms.uSkyColor.value;
    const hor = globalUniforms.uHorizonColor.value;
    const night = globalUniforms.uNight.value;
    (u.uLit!.value as THREE.Color).setRGB(0.62 + sun.r * 0.28 + hor.r * 0.12, 0.62 + sun.g * 0.26 + hor.g * 0.12, 0.62 + sun.b * 0.2 + hor.b * 0.12).multiplyScalar(1 - night * 0.8);
    (u.uShade!.value as THREE.Color).setRGB(0.48 + sky.r * 0.3, 0.52 + sky.g * 0.3, 0.6 + sky.b * 0.3).multiplyScalar(1 - night * 0.82);
    // Beams stay a warm white even at a low orange sun (a deep-orange beam over a dark crown reads as
    // a brown smear, not light).
    const sl = Math.max(0.05, sun.r * 0.3 + sun.g * 0.5 + sun.b * 0.2);
    (u.uShaftCol!.value as THREE.Color).copy(sun).multiply(_tint).lerp(_shaftW.copy(_warmWhite).multiplyScalar(sl), 0.55).multiplyScalar(1 - night);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.mat.uniforms;
    u.tDiffuse!.value = readBuffer.texture;
    u.tDepth!.value = readBuffer.depthTexture;
    this.camera.updateMatrixWorld();
    (u.uProjInv!.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.uCamWorld!.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    (u.uCamPos!.value as THREE.Vector3).setFromMatrixPosition(this.camera.matrixWorld);
    this.camera.getWorldDirection(u.uCamFwd!.value as THREE.Vector3);
    (u.uViewProj!.value as THREE.Matrix4).multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}
