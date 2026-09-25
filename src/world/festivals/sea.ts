/**
 * NightSea: the Tide Lantern Night sea at Driftglass Cove.
 *
 *   surface   rolling swell + two octaves of scrolling ripple normals (~0.15 m/s, crossing); a
 *             Fresnel reflection of the night sky (gradient + reflected stars), a moon glitter path
 *             running out to the horizon, warm light pools under the pier / boat / arch lanterns
 *             (`pools`) with broken ripple glints
 *   shore     every wave runs up the sand as a thin sheet (in phase with the beach sand's swash,
 *             SWASH_GLSL): the crest pulses electric cyan as it breaks, lace foam glows in its wake,
 *             the leading edge flares on the run-up and dims on the backwash
 *   life      clustered plankton sparkles in the shallows; glowing rings / trails where feet stir the
 *             water (`feet`: villagers at the waterline + the player's recent steps)
 *   far       a plane beyond the near grid out to the horizon (same shading, no ground)
 *
 * One transparent draw call (+1 far), no shadows / AO.
 */
import * as THREE from 'three';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';
import { SWASH_GLSL, VORONOI_GLSL } from '../beach/ocean';
import type { Terrain } from '../terrain';

export interface NightSeaOptions {
  terrain: Terrain;
  level: number;
  near: { x0: number; z0: number; x1: number; z1: number };
  /** Direction the waves roll in from (unit xz, pointing shoreward). */
  shoreward?: THREE.Vector2;
  /** Bioluminescence strength (0..∞). */
  glow?: number;
}

export const SEA_POOLS = 10;
export const SEA_FEET = 16;

export class NightSea {
  readonly group = new THREE.Group();
  readonly glow = { value: 1 };
  /** Warm light (fireworks flash) tinting the water, rgb × intensity. */
  readonly flash = { value: new THREE.Color(0, 0, 0) };
  /** Warm light pools on the water: (x, z, radius, intensity). */
  readonly pools = { value: Array.from({ length: SEA_POOLS }, () => new THREE.Vector4(0, 0, 1, 0)) };
  /** Feet stirring the plankton: (x, z, age s, strength). */
  readonly feet = { value: Array.from({ length: SEA_FEET }, () => new THREE.Vector4(0, 0, 99, 0)) };

  constructor(o: NightSeaOptions) {
    this.glow.value = o.glow ?? 1;
    const t = o.terrain.opts;
    const uniforms = {
      ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      uHeight: { value: o.terrain.heightTex },
      uHOrigin: { value: new THREE.Vector2(t.minX, t.minZ) },
      uHSize: { value: new THREE.Vector2(t.maxX - t.minX, t.maxZ - t.minZ) },
      uLevel: { value: o.level },
      uShore: { value: (o.shoreward ?? new THREE.Vector2(0, 1)).clone().normalize() },
      uTime: globalUniforms.uTime,
      uSunDir: globalUniforms.uSunDir,
      uSunColor: globalUniforms.uSunColor,
      uSkyColor: globalUniforms.uSkyColor,
      uHorizonColor: globalUniforms.uHorizonColor,
      uNight: globalUniforms.uNight,
      uLamps: globalUniforms.uLamps,
      uGlow: this.glow,
      uFlash: this.flash,
      uPools: this.pools,
      uFeet: this.feet,
      uMoonDir: { value: new THREE.Vector3(0.18, 0.3, -1).normalize() },
      uFar: { value: 0 },
    };
    const make = (far: boolean): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: { ...uniforms, uFar: { value: far ? 1 : 0 } },
        vertexShader: /* glsl */ `
          uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform vec2 uHSize; uniform float uLevel; uniform float uTime; uniform vec2 uShore; uniform float uFar;
          varying vec3 vW;
          varying float vSheet;
          ${NOISE_GLSL}
          ${SWASH_GLSL}
          #include <fog_pars_vertex>
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vec2 huv = (wp.xz - uHOrigin) / uHSize;
            float ground = texture(uHeight, clamp(huv, 0.0, 1.0)).r;
            float d0 = uLevel - ground;
            // Rolling swell out deep; near the beach the water runs up the sand as a thin sheet.
            float along = dot(wp.xz, uShore);
            float sw = sin(along * 0.55 - uTime * 1.1) * 0.05 + sin(dot(wp.xz, vec2(0.31, 0.12)) + uTime * 0.7) * 0.03;
            float sheet = max(hvSwash(wp.xz, uTime), 0.0);
            float nearShore = 1.0 - smoothstep(0.25, 1.1, d0);
            wp.y += (sw * smoothstep(0.3, 1.5, d0) + sheet * nearShore) * (1.0 - uFar);
            vSheet = sheet * nearShore;
            vW = wp.xyz;
            vec4 mvPosition = viewMatrix * wp;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uHorizonColor;
          uniform float uNight; uniform float uLamps; uniform float uGlow; uniform vec3 uFlash; uniform vec2 uShore; uniform float uLevel; uniform float uFar;
          uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform vec2 uHSize; uniform vec3 uMoonDir;
          uniform vec4 uPools[${SEA_POOLS}];
          uniform vec4 uFeet[${SEA_FEET}];
          varying vec3 vW;
          varying float vSheet;
          ${NOISE_GLSL}
          ${SWASH_GLSL}
          ${VORONOI_GLSL}
          #include <fog_pars_fragment>
          float cellSpark(vec2 p, float t) {
            // Clustered plankton: sparse cells blink on and off.
            vec2 i = floor(p);
            vec2 f = fract(p) - 0.5;
            vec2 h = hvHash22(i);
            vec2 o = (h - 0.5) * 0.7;
            float d = length(f - o);
            float blink = pow(max(0.0, sin(t * (1.5 + h.x * 3.0) + h.y * 40.0)), 6.0);
            return (1.0 - smoothstep(0.0, 0.12, d)) * blink;
          }
          float ripples(vec2 p, float t) {
            // Two crossing octaves scrolling at ~0.15 m/s.
            return hvNoise(p * 0.85 + vec2(t * 0.15, t * 0.09)) * 0.65 + hvNoise(p * 2.6 + vec2(-t * 0.12, t * 0.16)) * 0.35;
          }
          void main() {
            vec2 huv = (vW.xz - uHOrigin) / uHSize;
            float ground = texture(uHeight, clamp(huv, 0.0, 1.0)).r;
            if (uFar > 0.5 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) ground = uLevel - 6.0;
            float depth = vW.y - ground;
            if (depth < 0.0) discard;
            float dSea = max(uLevel - ground, 0.0);
            vec2 p = vW.xz;
            float t = uTime;
            // Normals: scrolling ripples + the swell, calmer in the thin swash sheet.
            float e = 0.12;
            float h0 = ripples(p, t);
            float hx = ripples(p + vec2(e, 0.0), t);
            float hz = ripples(p + vec2(0.0, e), t);
            float along = dot(p, uShore);
            float swl = cos(along * 0.55 - t * 1.1) * 0.55 * 0.05;
            float calm = smoothstep(0.0, 0.5, dSea);
            vec3 n = normalize(vec3(-(hx - h0) / e * 0.22 * (0.4 + 0.6 * calm) - uShore.x * swl, 1.0, -(hz - h0) / e * 0.22 * (0.4 + 0.6 * calm) - uShore.y * swl));
            vec3 V = normalize(cameraPosition - vW);
            float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            // Body: ink-teal shallows over sand → deep indigo.
            float dk = 1.0 - exp(-dSea * 0.8);
            vec3 col = mix(vec3(0.03, 0.075, 0.09), vec3(0.008, 0.02, 0.05), dk);
            // Night-sky reflection (gradient + reflected stars), strongest at grazing angles.
            vec3 R = reflect(-V, n);
            vec3 sky = mix(uHorizonColor * 0.85, uSkyColor * 0.55, smoothstep(-0.05, 0.45, R.y));
            vec2 sc = floor(R.xz / max(R.y + 0.25, 0.08) * 60.0);
            float star = step(0.992, hvHash12(sc)) * (0.5 + 0.5 * sin(t * 3.0 + hvHash12(sc + 3.0) * 30.0));
            sky += vec3(0.8, 0.85, 1.0) * star * uNight * 0.6;
            col = mix(col, sky, clamp(fres * 1.1 + 0.08, 0.0, 1.0) * 0.85);
            // Moon glitter path: a broad column of broken sparkles out to the horizon + a hot core.
            vec3 M = normalize(uMoonDir);
            float rm = max(dot(R, M), 0.0);
            float lobe = pow(rm, 70.0);
            float spark = smoothstep(0.62, 0.9, hvNoise(p * vec2(1.6, 4.0) + vec2(t * 0.5, -t * 0.8))) * smoothstep(0.4, 0.8, hvNoise(p * 0.7 - t * 0.2));
            vec3 moon = vec3(0.75, 0.82, 1.0);
            col += moon * (lobe * spark * 0.55 + pow(rm, 900.0) * 0.9 + lobe * 0.03) * uNight;
            // Sun glint by day.
            vec3 L = normalize(uSunDir);
            col += uSunColor * pow(max(dot(R, L), 0.0), 220.0) * 2.0 * (1.0 - uNight);
            // Warm light pools under lanterns / boats (+ rippled glints inside them) and, for the
            // small (boat / lantern) pools, a soft cyan plankton wake ring — one pass over the pools.
            vec3 warm = vec3(1.0, 0.55, 0.2);
            float glint = smoothstep(0.55, 0.85, h0 + hvNoise(p * 3.1 + t * 0.4) * 0.35);
            float wakeRings = 0.0;
            for (int i = 0; i < ${SEA_POOLS}; i++) {
              vec4 q = uPools[i];
              if (q.w <= 0.0) continue;
              vec2 dq = p - q.xy;
              float dd2 = dot(dq, dq);
              float fall = exp(-dd2 / (q.z * q.z));
              col += warm * q.w * fall * (0.12 + 0.55 * fres + glint * 0.9) * (0.3 + uLamps * 0.7);
              if (q.z <= 1.7) {
                float dd = sqrt(dd2);
                wakeRings += exp(-pow((dd - 0.9 - 0.12 * sin(t * 1.3 + q.x)) / 0.14, 2.0)) * 0.45 + exp(-dd2 * 0.9) * 0.05;
              }
            }
            // Fireworks wash.
            col += uFlash * (0.2 + fres * 0.9) * (0.4 + 0.6 * h0);
            // ── bioluminescent surf (only evaluated in the last 2.6 m of depth: open water skips the
            // swash / lace / feet work entirely — most of the screen is open bay)
            float crest = 0.0;
            float lace = 0.0;
            float wake = 0.0;
            float edge = 0.0;
            float film = 0.0;
            float plank = 0.0;
            float stir = 0.0;
            float sheetZone = smoothstep(0.03, -0.02, uLevel - ground);
            float ph = 0.5;
            if (dSea < 2.6) {
              ph = fract(hvSwashPhase(p, t));
              // The breaking crest rolls in over the last metre of depth, flaring as it breaks.
              // Two sets of breakers: the main wave + a smaller one half a period behind.
              float ph2 = fract(ph + 0.5);
              float crestDepth = mix(1.3, 0.0, smoothstep(0.0, 0.26, ph));
              float crestDepth2 = mix(0.9, 0.0, smoothstep(0.0, 0.26, ph2));
              crest = exp(-pow((dSea - crestDepth) / 0.16, 2.0)) * step(ph, 0.3) * smoothstep(1.4, 0.15, crestDepth) * (1.0 - sheetZone);
              crest += 0.55 * exp(-pow((dSea - crestDepth2) / 0.12, 2.0)) * step(ph2, 0.3) * smoothstep(1.0, 0.15, crestDepth2) * (1.0 - sheetZone);
              crest *= 0.6 + 0.4 * smoothstep(0.3, 0.7, hvNoise(p * vec2(0.35, 0.8) + t * 0.1));
              lace = dSea < 1.2 ? hvLace(p * 1.2, t * 0.3) : 0.0;
              // Foam left behind the crest (a lacy glow decaying with the backwash).
              wake = lace * smoothstep(1.1, 0.0, dSea) * (0.35 + 0.65 * (1.0 - smoothstep(0.2, 0.95, ph))) * (0.5 + 0.5 * calm);
              // Swash sheet on the sand: leading edge flares on the run-up, dims on the backwash.
              edge = (1.0 - smoothstep(0.0, 0.04, depth)) * max(sheetZone, 1.0 - smoothstep(0.0, 0.1, dSea)) * (step(ph, 0.26) * 1.0 + 0.3);
              film = sheetZone * lace * 0.5;
              plank = (cellSpark(p * 2.6, t) + cellSpark(p * 5.1 + 7.0, t * 1.3) * 0.6) * (1.0 - smoothstep(0.2, 2.5, dSea)) * (0.35 + 0.65 * smoothstep(0.3, 0.7, hvNoise(p * 0.25 + t * 0.02)));
              // Feet stirring the plankton: bright rings that fade.
              if (dSea < 1.2) {
                for (int i = 0; i < ${SEA_FEET}; i++) {
                  vec4 f = uFeet[i];
                  if (f.w <= 0.0) continue;
                  float d = length(p - f.xy);
                  float ring = exp(-pow((d - 0.25 - f.z * 0.35) / 0.12, 2.0)) + exp(-d * d * 10.0) * 0.8;
                  stir += ring * f.w * exp(-f.z * 1.1);
                }
                stir *= (1.0 - smoothstep(0.1, 1.2, dSea));
              }
            }
            // Open water: only SPARSE plankton speckles in slow drifting patches (no filament lines),
            // plus soft cyan rings where the boats rock / lanterns bob (the glow belongs to the break
            // line, the wakes and the feet in the shallows — not a noise texture across the bay).
            float bloomMask = smoothstep(0.58, 0.86, hvNoise(p * 0.05 + 11.0 + vec2(t * 0.004, 0.0)));
            float fleck = cellSpark(p * 2.2 + 13.0, t * 0.8) * 0.7 + cellSpark(p * 4.1 - 4.0, t * 1.1) * 0.35;
            float soft = smoothstep(0.55, 0.95, hvNoise(p * 0.16 - t * 0.01)) * 0.04;
            float drift = (fleck * 0.5 + soft) * bloomMask * smoothstep(0.6, 2.4, dSea);
            drift += wakeRings * (0.5 + 0.5 * hvNoise(p * 4.0 + t * 0.5));
            float bright = crest * 3.0 * (0.55 + 0.45 * lace) + wake * 2.0 + edge * 2.2 + film + plank * 2.4 + stir * 2.6 + drift * 1.1;
            vec3 cyan = vec3(0.2, 0.95, 1.0);
            vec3 blue = vec3(0.08, 0.42, 1.0);
            vec3 teal = vec3(0.05, 0.75, 0.72);
            vec3 bio = mix(blue, cyan, clamp(crest + edge + stir * 0.5, 0.0, 1.0)) * (bright - drift * 1.1) + mix(blue, teal, clamp(fleck, 0.0, 1.0)) * drift * 1.1;
            col += bio * uGlow * smoothstep(0.35, 0.85, uNight) * (1.0 - uFar);
            // Pale foam by day.
            col = mix(col, vec3(0.82, 0.86, 0.86), clamp(crest + wake * 0.5 + edge, 0.0, 1.0) * 0.5 * (1.0 - uNight));
            float alpha = mix(0.55, 0.97, smoothstep(0.0, 0.9, dSea)) * mix(1.0, smoothstep(0.0, 0.05, depth) * 0.75, sheetZone);
            alpha = max(alpha, clamp(bright * 0.6, 0.0, 1.0) * (1.0 - uFar));
            gl_FragColor = vec4(col, alpha);
            #include <fog_fragment>
          }`,
      });
      m.name = far ? 'night-sea-far' : 'night-sea';
      return m;
    };
    const n = o.near;
    const w = n.x1 - n.x0;
    const d = n.z1 - n.z0;
    const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 0.45), Math.ceil(d / 0.45));
    geo.rotateX(-Math.PI / 2);
    geo.translate(n.x0 + w / 2, o.level, n.z0 + d / 2);
    const near = new THREE.Mesh(geo, make(false));
    near.renderOrder = 2;
    near.frustumCulled = false;
    near.userData.noAO = true;
    near.name = 'night-sea';
    this.group.add(near);
    // Far: beyond the near grid, out to the horizon (north).
    const fg = new THREE.PlaneGeometry(900, 420, 8, 8);
    fg.rotateX(-Math.PI / 2);
    fg.translate((n.x0 + n.x1) / 2, o.level - 0.01, n.z0 - 210);
    const far = new THREE.Mesh(fg, make(true));
    far.renderOrder = 2;
    far.frustumCulled = false;
    far.userData.noAO = true;
    far.name = 'night-sea-far';
    this.group.add(far);
    this.group.name = 'night-sea';
    this.group.userData.perfTag = 'water';
    this.group.userData.noAO = true;
  }

  /** Set warm pool k (x, z, radius, intensity); intensity 0 disables it. */
  setPool(k: number, x: number, z: number, r: number, i: number): void {
    this.pools.value[k]?.set(x, z, r, i);
  }
}

/**
 * FrozenRiver: a glossy ice sheet over a terrain channel (discarded where the ground rises above
 * it). Blue-green depth under clear ice, milky snow-dusted edges, criss-crossing skate scratches,
 * frozen bubbles and cracks, a sky / aurora-tinted Fresnel sheen and warm lamp glints.
 */
const MAX_ICE_LAMPS = 12;

export class FrozenRiver {
  readonly mesh: THREE.Mesh;
  readonly aurora = { value: 1 };
  /** Bank lanterns mirrored in the ice (xyz = lamp head, up to MAX_ICE_LAMPS). */
  private lampPos = Array.from({ length: MAX_ICE_LAMPS }, () => new THREE.Vector3());
  private lampN = { value: 0 };
  constructor(terrain: Terrain, level: number, bounds: { x0: number; z0: number; x1: number; z1: number }) {
    const t = terrain.opts;
    const w = bounds.x1 - bounds.x0;
    const d = bounds.z1 - bounds.z0;
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(bounds.x0 + w / 2, level, bounds.z0 + d / 2);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
        uHeight: { value: terrain.heightTex },
        uHOrigin: { value: new THREE.Vector2(t.minX, t.minZ) },
        uHSize: { value: new THREE.Vector2(t.maxX - t.minX, t.maxZ - t.minZ) },
        uLevel: { value: level },
        uTime: globalUniforms.uTime,
        uSunDir: globalUniforms.uSunDir,
        uSunColor: globalUniforms.uSunColor,
        uSkyColor: globalUniforms.uSkyColor,
        uHorizonColor: globalUniforms.uHorizonColor,
        uNight: globalUniforms.uNight,
        uLamps: globalUniforms.uLamps,
        uAurora: this.aurora,
        uLampPos: { value: this.lampPos },
        uLampN: this.lampN,
      },
      defines: { NLAMP: MAX_ICE_LAMPS },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform vec2 uHSize; uniform float uLevel; uniform float uTime;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uHorizonColor; uniform float uNight; uniform float uLamps; uniform float uAurora;
        uniform vec3 uLampPos[NLAMP]; uniform int uLampN;
        varying vec3 vW;
        ${NOISE_GLSL}
        #include <fog_pars_fragment>
        float scratch(vec2 p, float ang, float freq) {
          vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
          float n = hvNoise(vec2(q.x * 0.35, q.y * freq));
          return smoothstep(0.93, 0.99, n) * smoothstep(0.3, 0.7, hvNoise(q * 0.2));
        }
        void main() {
          vec2 huv = (vW.xz - uHOrigin) / uHSize;
          float ground = texture2D(uHeight, clamp(huv, 0.0, 1.0)).r;
          float depth = uLevel - ground;
          if (depth < 0.0) discard;
          vec2 p = vW.xz;
          vec3 V = normalize(cameraPosition - vW);
          // Near-mirror sheet: faint frozen ripples + cracks in the normal.
          float r1 = hvFbm(p * 0.6);
          float r2 = hvFbm(p * 0.6 + vec2(0.12, 0.0));
          float r3 = hvFbm(p * 0.6 + vec2(0.0, 0.12));
          vec3 n = normalize(vec3((r1 - r2) * 0.22, 1.0, (r1 - r3) * 0.22));
          float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
          // Cool blue-grey body: clear black ice over the deep channel, milky grey-blue in the shallows.
          // Milky white-blue shelf ice along the banks, a band of dark clear ice down mid-channel
          // (the black ice you see the frozen river through), with a cold teal glow between.
          float dk = smoothstep(0.03, 0.3, depth);
          vec3 clear = vec3(0.5, 0.6, 0.7);
          vec3 mid = vec3(0.16, 0.3, 0.38);
          vec3 deep = vec3(0.03, 0.065, 0.11);
          vec3 col = mix(clear, mid, smoothstep(0.0, 0.5, dk));
          col = mix(col, deep, smoothstep(0.45, 1.0, dk));
          // Suspended frost clouds + streaky white veils frozen into the body.
          float veil = smoothstep(0.5, 0.8, hvFbm(vec2(p.x * 0.18, p.y * 0.55) + 11.0));
          col = mix(col, vec3(0.62, 0.72, 0.8), veil * 0.28 * (1.0 - dk * 0.5));
          // Frozen bubbles + cloudy white inclusions.
          vec2 bc = floor(p * 3.0);
          vec2 bf = fract(p * 3.0) - 0.5 - (hvHash22(bc) - 0.5) * 0.6;
          float bub = (1.0 - smoothstep(0.02, 0.07, length(bf))) * step(0.78, hvHash12(bc + 3.1));
          // Strings of tiny trapped bubbles (a second, finer layer) in the clear band.
          vec2 bc2 = floor(p * vec2(9.0, 5.0));
          vec2 bf2 = fract(p * vec2(9.0, 5.0)) - 0.5 - (hvHash22(bc2 + 9.0) - 0.5) * 0.5;
          float bub2 = (1.0 - smoothstep(0.02, 0.06, length(bf2 * vec2(1.0, 1.8)))) * step(0.9, hvHash12(bc2 + 1.7)) * dk;
          col += bub * vec3(0.34, 0.4, 0.46) + bub2 * vec3(0.4, 0.48, 0.55);
          col = mix(col, vec3(0.55, 0.62, 0.7), smoothstep(0.55, 0.85, hvFbm(p * 0.35 + 4.0)) * 0.35);
          // Skate scratches (criss-crossing arcs) + crack lines.
          float sc = scratch(p, 0.35, 5.0) + scratch(p + 7.0, -0.5, 6.0) + scratch(p * 1.3 + 3.0, 1.2, 4.0) * 0.6;
          // Carved skate arcs: sweeping curves left by the looping skaters (partial circles).
          for (int k = 0; k < 2; k++) {
            float cell = k == 0 ? 5.5 : 3.7;
            vec2 q = p + float(k) * vec2(2.3, 1.1);
            vec2 c = floor(q / cell);
            vec2 hh = hvHash22(c + float(k) * 17.0);
            vec2 ctr = (c + 0.5 + (hh - 0.5) * 0.3) * cell;
            float R = cell * (0.22 + 0.16 * hvHash12(c + 5.0 + float(k)));
            float dd = abs(length(q - ctr) - R);
            float an = atan(q.y - ctr.y, q.x - ctr.x) / 6.2831 + hh.x;
            float gap = smoothstep(0.02, 0.08, fract(an)) * (1.0 - smoothstep(0.55, 0.65, fract(an)));
            sc += (1.0 - smoothstep(0.008, 0.028, dd)) * gap * step(0.25, hh.y) * 0.9;
          }
          float cr = (1.0 - smoothstep(0.0, 0.03, abs(hvFbm(p * 0.35 + 2.0) - 0.5))) * 0.6;
          // Light: sky + moon on the ice body (the albedo multiplies every light; nothing warm is added).
          vec3 L = normalize(uSunDir);
          float ndl = max(dot(n, L), 0.0);
          vec3 lit = col * (uSkyColor * 0.95 + uSunColor * ndl * 0.3 + vec3(0.07, 0.085, 0.11)) * (0.85 + uLamps * 0.35);
          lit += vec3(0.85, 0.92, 1.0) * (sc * 0.5 + cr * 0.22) * (uSkyColor * 1.3 + uSunColor * 0.35 + 0.05 + uLamps * 0.06);
          // Clear-coat reflection: sky gradient + the aurora's green-violet bands + stars.
          vec3 R = reflect(-V, n);
          vec3 sky = mix(uHorizonColor * 1.1, uSkyColor, smoothstep(0.0, 0.6, R.y));
          // Broad drifting curtains (shaped, not a product of two noises that averages out to a
          // faint wash) with fine vertical rays inside them, like the curtains overhead.
          float b1 = hvNoise(vec2(p.x * 0.07 + uTime * 0.02, p.y * 0.018 + 2.0));
          float b2 = hvNoise(vec2(p.x * 1.1 - uTime * 0.05, 1.3));
          float band = smoothstep(0.38, 0.72, b1) * (0.4 + 0.6 * b2);
          vec3 aur = mix(vec3(0.12, 0.95, 0.55), vec3(0.62, 0.28, 0.85), smoothstep(0.35, 0.7, hvNoise(p * 0.05 + 4.0))) * band * 0.42 * uAurora * smoothstep(0.4, 0.9, uNight);
          vec2 sc2 = floor(p * 5.0);
          vec2 so = fract(p * 5.0) - 0.5 - (hvHash22(sc2 + 5.0) - 0.5) * 0.6;
          float star = step(0.985, hvHash12(sc2)) * (1.0 - smoothstep(0.02, 0.07, length(so))) * (0.5 + 0.5 * sin(uTime * 2.0 + hvHash12(sc2 + 1.0) * 30.0)) * uNight;
          // (The aurora also lies on the ice as soft moving green / violet sheen — the high camera sees
          // the river far more than it sees sky.)
          lit += aur * (0.15 + fres * 0.6) * dk;
          // Fresnel sky sheen: strong at grazing angles only, so the clear band stays dark and deep.
          lit = mix(lit, sky * 0.85 + aur, clamp(fres * 0.95 + 0.05, 0.0, 1.0) * 0.72) + star * vec3(0.7, 0.8, 1.0) * 0.4 * (1.0 - smoothstep(0.02, 0.2, 1.0 - dk));
          // Glassy glints: cool-white sparkles (lamp-lit ones warm only in their own glint).
          vec2 gc = floor(p * 2.2);
          vec2 gf = fract(p * 2.2) - 0.5 - (hvHash22(gc + 2.1) - 0.5) * 0.6;
          float dot0 = 1.0 - smoothstep(0.0, 0.06, length(gf));
          float gl = dot0 * step(0.86, hvHash12(gc + 7.7)) * pow(max(0.0, sin(uTime * (0.6 + hvHash12(gc) * 1.4) + hvHash12(gc + 1.3) * 30.0)), 8.0);
          lit += mix(vec3(0.85, 0.92, 1.0), vec3(1.0, 0.8, 0.55), 0.35) * gl * (0.4 + uLamps * 0.6);
          float spec = pow(max(dot(R, L), 0.0), 400.0);
          lit += uSunColor * spec * 2.5;
          // Snow-dusted, milky edges.
          float edge = 1.0 - smoothstep(0.02, 0.12, depth);
          float drift = smoothstep(0.45, 0.75, hvFbm(p * 0.7 + 9.0));
          vec3 snow = vec3(0.86, 0.9, 0.98) * (uSkyColor * 0.9 + uSunColor * 0.35 * ndl + 0.05);
          // Bank lanterns: a warm pool on the ice under each lamp + its reflection, a tall streak
          // pulled toward the viewer (mirror image of the lamp, smeared vertically by the frozen
          // ripples) — the classic lamplight-on-black-ice read.
          vec3 warm = vec3(1.0, 0.5, 0.18);
          vec3 vv = normalize(vW - cameraPosition);
          float pool = 0.0;
          float strk = 0.0;
          for (int i = 0; i < NLAMP; i++) {
            if (i >= uLampN) break;
            vec3 lp = uLampPos[i];
            vec2 dxz = lp.xz - vW.xz;
            pool += exp(-dot(dxz, dxz) * 0.45);
            vec3 lm = vec3(lp.x, 2.0 * uLevel - lp.y, lp.z);
            vec3 vl = normalize(lm - cameraPosition);
            vec3 rt = normalize(cross(vl, vec3(0.0, 1.0, 0.0)));
            vec3 up = cross(rt, vl);
            vec3 dv = vv - vl;
            float h = dot(dv, rt) + (r1 - r2) * 0.018;
            float v = dot(dv, up);
            float body = exp(-h * h / 0.00003 - v * v / 0.0012);
            float core = exp(-h * h / 0.00001 - v * v / 0.00015);
            strk += body * (0.35 + 0.65 * hvNoise(vec2(v * 90.0, uTime * 0.6 + float(i)))) + core * 0.9;
          }
          float lampK = uLamps * (1.0 - edge * 0.6);
          lit += warm * col * pool * lampK;
          lit += warm * strk * 0.5 * lampK;
          lit = mix(lit, snow, clamp(edge + drift * 0.12, 0.0, 1.0));
          gl_FragColor = vec4(lit, 1.0);
          #include <fog_fragment>
        }`,
    });
    m.name = 'frozen-river';
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = 'frozen-river';
    this.mesh.receiveShadow = false;
    this.mesh.userData.noAO = true;
    this.mesh.userData.perfTag = 'water';
    this.mesh.renderOrder = 1;
  }

  /** Lamp heads (world space) whose light pools and reflects on the ice. */
  setLamps(list: readonly THREE.Vector3[]): void {
    const n = Math.min(MAX_ICE_LAMPS, list.length);
    for (let i = 0; i < n; i++) this.lampPos[i]!.copy(list[i]!);
    this.lampN.value = n;
  }
}
