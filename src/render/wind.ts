/**
 * Wind vertex-shader helper usable by ANY material (Standard, Lambert, Depth, instanced or not).
 *
 *   applyWind(material, { mode: 'height', height: 0.6, amplitude: 0.25 });   // grass: y-based weight
 *   applyWind(material, { mode: 'attribute', amplitude: 0.12 });             // trees: bake `aWind` (0 trunk base..1 tips)
 *
 * For swaying shadows also set `mesh.customDepthMaterial = windDepthMaterial(sameOpts)`.
 * Displacement is computed in world space (so instanced rotation doesn't matter),
 * phase-shifted by the instance/object origin, with travelling gusts driven by global uniforms.
 */
import * as THREE from 'three';
import { globalUniforms } from './uniforms';
import { NOISE_GLSL } from './shaders/noise';
import { patchMaterial, after, before } from './patch';

export interface WindOptions {
  /** 'height': weight = clamp(localY / height)^2. 'attribute': weight = aWind attribute. */
  mode?: 'height' | 'attribute';
  /** Reference height for mode 'height' (local units). */
  height?: number;
  /** World units of sway at weight 1 and wind strength 1. */
  amplitude?: number;
  /** Extra high-frequency leaf flutter (0..1). */
  flutter?: number;
  /** Grass-style push away from the player. */
  playerPush?: boolean;
}

/**
 * Travelling gust fronts on windy / stormy days: narrow waves rolling downwind with a wobbly,
 * patchy crest (0 on calm days). Shared by the sway below and the grass sheen (grass.ts), so the
 * bright band in the grass and the bending blades travel together. Needs NOISE_GLSL.
 */
export const GUST_GLSL = /* glsl */ `
float hvGustWave(vec2 xz, float t, vec2 dir, float strength) {
  float along = dot(xz, dir);
  float across = dot(xz, vec2(-dir.y, dir.x));
  float ph = along * 0.11 - t * (0.7 + 0.35 * strength) + hvNoise(vec2(across * 0.045, t * 0.04)) * 2.5;
  float crest = pow(0.5 + 0.5 * sin(ph), 7.0);
  float gate = smoothstep(0.3, 0.7, hvNoise(vec2(across * 0.035 + 7.0, floor(ph / 6.2832) * 1.7)));
  return crest * gate * smoothstep(1.2, 2.1, strength);
}
`;

export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform vec3 uPlayerPos;
${NOISE_GLSL}
${GUST_GLSL}
vec3 hvWindOffset(vec3 wpos, vec3 origin, float w, float amp, float flutter) {
  vec2 dir = uWindDir;
  float t = uTime;
  float phase = dot(origin.xz, dir) * 0.45 + hvHash12(floor(origin.xz * 7.13)) * 6.28;
  float gust = hvNoise(origin.xz * 0.07 - dir * t * 0.55);
  gust = gust * gust * 1.6;
  float sway = sin(t * 1.6 + phase) * 0.55 + sin(t * 2.7 + phase * 1.3) * 0.3;
  float s = uWindStrength;
  float front = hvGustWave(origin.xz, t, dir, s);
  vec2 off = dir * (0.25 * s + gust * s + sway * 0.45 * s + front * 1.6 * s);
  float fl = sin(t * 8.5 + dot(wpos, vec3(3.1, 2.3, 2.7))) * flutter * s;
  vec3 o = vec3(off.x + fl * 0.3 * dir.y, 0.0, off.y - fl * 0.3 * dir.x) * amp;
  o.y = fl * 0.25 * amp - length(o.xz) * 0.35;
  return o * w;
}
`;

function windKey(o: Required<WindOptions>): string {
  return `wind:${o.mode}:${o.height}:${o.amplitude}:${o.flutter}:${o.playerPush ? 1 : 0}`;
}

function resolve(opts: WindOptions): Required<WindOptions> {
  return {
    mode: opts.mode ?? 'height',
    height: opts.height ?? 1,
    amplitude: opts.amplitude ?? 0.15,
    flutter: opts.flutter ?? 0.3,
    playerPush: opts.playerPush ?? false,
  };
}

export function applyWind<M extends THREE.Material>(material: M, opts: WindOptions = {}): M {
  const o = resolve(opts);
  return patchMaterial(material, windKey(o), (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uWindStrength = globalUniforms.uWindStrength;
    shader.uniforms.uWindDir = globalUniforms.uWindDir;
    shader.uniforms.uPlayerPos = globalUniforms.uPlayerPos;
    const weight =
      o.mode === 'attribute'
        ? 'float hvW = aWind;'
        : `float hvW = clamp(position.y / ${o.height.toFixed(4)}, 0.0, 1.0); hvW *= hvW;`;
    let vs = shader.vertexShader;
    vs = before(
      vs,
      'void main() {',
      WIND_GLSL + (o.mode === 'attribute' ? '\nattribute float aWind;\n' : ''),
    );
    vs = after(
      vs,
      '#include <begin_vertex>',
      /* glsl */ `
      {
        mat4 hvM = modelMatrix;
        #ifdef USE_INSTANCING
          hvM = modelMatrix * instanceMatrix;
        #endif
        #ifdef USE_BATCHING
          hvM = modelMatrix * batchingMatrix;
        #endif
        vec3 hvWp = (hvM * vec4(transformed, 1.0)).xyz;
        vec3 hvOrigin = (hvM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        ${weight}
        vec3 hvOff = hvWindOffset(hvWp, hvOrigin, hvW, ${o.amplitude.toFixed(4)}, ${o.flutter.toFixed(4)});
        ${
          o.playerPush
            ? `vec2 hvD = hvOrigin.xz - uPlayerPos.xz;
        float hvDist = length(hvD);
        float hvPush = (1.0 - smoothstep(0.15, 0.95, hvDist)) * step(abs(hvOrigin.y - uPlayerPos.y), 1.5);
        hvOff.xz += (hvD / max(hvDist, 0.001)) * hvPush * 0.55 * hvW;
        hvOff.y -= hvPush * 0.3 * hvW;`
            : ''
        }
        transformed += inverse(mat3(hvM)) * hvOff;
      }`,
    );
    shader.vertexShader = vs;
  });
}

const depthCache = new Map<string, THREE.MeshDepthMaterial>();

/**
 * Depth material with the same sway, for `mesh.customDepthMaterial` so shadows move too.
 * Shared per wind setting (lets batches with equal settings merge into one shadow draw).
 */
export function windDepthMaterial(opts: WindOptions = {}): THREE.MeshDepthMaterial {
  const k = windKey(resolve(opts));
  let m = depthCache.get(k);
  if (!m) {
    m = applyWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), opts);
    depthCache.set(k, m);
  }
  return m;
}
