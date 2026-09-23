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
    uTime: globalUniforms.uTime,
    uWindDir: globalUniforms.uWindDir,
    uSunDir: globalUniforms.uSunDir,
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
    uniform float uTime;
    uniform vec2 uWindDir;
    uniform vec3 uSunDir;
    varying vec2 vUv;
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
        float n = hvFbm(P.xz * 0.075 - drift * 0.075) * 0.7 + hvNoise(P.xz * 0.23 + vec2(uTime * 0.03, -uTime * 0.02)) * 0.3;
        // Wispy sheets: a second, finer stretched layer tears the banks into drifting ribbons.
        float sheet = hvNoise(vec2(P.x * 0.16 + P.z * 0.05, P.z * 0.42) - drift * 0.16);
        float bank = smoothstep(0.44, 0.8, n) * (0.5 + 0.5 * smoothstep(0.3, 0.7, sheet));
        float dens = uDensity * uFog * (0.06 + 1.8 * bank);
        float f = 1.0 - exp(-optical * dens);
        // Sky pixels (far plane): keep only a thin veil.
        f *= d > 0.99999 ? 0.4 : 1.0;
        float sunF = pow(max(dot(rd, normalize(uSunDir)), 0.0), 4.0);
        vec3 fc = mix(uShade, uLit, 0.45 + 0.55 * bank);
        fc += uLit * sunF * 0.35;
        c = mix(c, fc, clamp(f, 0.0, 0.8));
      }
      if (uShaftK > 0.001) {
        // Art direction: beams fall steeply from the canopy (~35 deg off vertical), leaning across the
        // frame towards the sun's side, so they always read as slanted shafts from the diorama camera
        // (a low morning sun would otherwise lay them flat along the ground).
        vec2 hvSide = normalize(vec2(-uCamFwd.z, uCamFwd.x) + 1e-4);
        float hvLean = dot(normalize(uSunDir.xz + 1e-4), hvSide) >= 0.0 ? 1.0 : -1.0;
        vec3 Ls = normalize(vec3(hvSide.x * hvLean * 0.58, 0.82, hvSide.y * hvLean * 0.58) + vec3(uSunDir.x, 0.0, uSunDir.z) * 0.15);
        float acc = 0.0;
        for (int i = 0; i < ${MAX_SHAFTS}; i++) {
          if (i >= uShaftCount) break;
          vec4 s = uShafts[i];
          vec3 a = s.xyz;
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
          float along = smoothstep(0.0, 0.08, ts / uShaftLen) * (1.0 - smoothstep(0.62, 1.0, ts / uShaftLen));
          // Chord length through the soft cylinder ~ width / sin(angle between ray and axis).
          float chord = min(wdt * 2.0 / max(sqrt(den), 0.15), 8.0);
          float g = exp(-dist * dist / (wdt * wdt) * 3.0);
          // Striations: thinner rays inside each beam (light through leaves), slowly shifting.
          vec3 q2 = ro + rd * tr2 - q;
          float stri = 0.55 + 0.45 * hvNoise(vec2(dot(q2, cross(Ls, vec3(0.0, 0.0, 1.0))) * 2.6 + float(i) * 3.7, uTime * 0.08));
          float flick = (0.75 + 0.25 * hvNoise(vec2(float(i) * 7.3 + uTime * 0.25, ts * 0.3 - uTime * 0.1))) * stri;
          acc += g * along * chord * flick;
        }
        c += uShaftCol * acc * uShaftK * 0.1;
      }
      gl_FragColor = vec4(c, col.a);
    }`,
};

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
    this.quad = new FullScreenQuad(this.mat);
    this.needsSwap = true;
  }

  /** Called before the composer renders: enable only when there is something to draw. */
  sync(): void {
    const a = atmosphere;
    this.enabled = a.fog > 0.002 || (a.shafts > 0.002 && a.shaftList.length > 0);
    if (!this.enabled) return;
    const u = this.mat.uniforms;
    u.uFog!.value = a.fog;
    u.uBase!.value = a.base;
    u.uFalloff!.value = a.falloff;
    u.uDensity!.value = a.density;
    const n = Math.min(MAX_SHAFTS, a.shaftList.length);
    u.uShaftCount!.value = n;
    u.uShaftK!.value = a.shafts;
    u.uShaftLen!.value = a.shaftLen;
    const arr = u.uShafts!.value as THREE.Vector4[];
    for (let i = 0; i < n; i++) {
      const s = a.shaftList[i]!;
      arr[i]!.set(s.x, s.y, s.z, s.w);
    }
    // Colours follow the day: lit mist takes the sun, shade the sky.
    const sun = globalUniforms.uSunColor.value;
    const sky = globalUniforms.uSkyColor.value;
    const hor = globalUniforms.uHorizonColor.value;
    const night = globalUniforms.uNight.value;
    (u.uLit!.value as THREE.Color).setRGB(0.62 + sun.r * 0.28 + hor.r * 0.12, 0.62 + sun.g * 0.26 + hor.g * 0.12, 0.62 + sun.b * 0.2 + hor.b * 0.12).multiplyScalar(1 - night * 0.8);
    (u.uShade!.value as THREE.Color).setRGB(0.48 + sky.r * 0.3, 0.52 + sky.g * 0.3, 0.6 + sky.b * 0.3).multiplyScalar(1 - night * 0.82);
    (u.uShaftCol!.value as THREE.Color).copy(sun).multiply(new THREE.Color(1.05, 0.97, 0.8)).multiplyScalar(1 - night);
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
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}
