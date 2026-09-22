/**
 * "World FX" material patch: seasonal snow cover on up-facing surfaces, rain wetness
 * (darker albedo + glossier), and soft moving cloud shadows on direct light.
 * Apply to anything that sits outdoors: applyWorldFx(material).
 */
import type * as THREE from 'three';
import { globalUniforms } from './uniforms';
import { NOISE_GLSL } from './shaders/noise';
import { patchMaterial, after, before } from './patch';

export interface WorldFxOptions {
  snow?: boolean;
  /** Snow threshold on world normal.y (lower = snow on steeper faces). */
  snowUp?: number;
  clouds?: boolean;
  wet?: boolean;
}

export function applyWorldFx<M extends THREE.Material>(material: M, opts: WorldFxOptions = {}): M {
  const snow = opts.snow ?? true;
  const clouds = opts.clouds ?? true;
  const wet = opts.wet ?? true;
  const snowUp = opts.snowUp ?? 0.55;
  const key = `wfx:${snow ? 1 : 0}${clouds ? 1 : 0}${wet ? 1 : 0}:${snowUp}`;
  return patchMaterial(material, key, (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uSnow = globalUniforms.uSnow;
    shader.uniforms.uWet = globalUniforms.uWet;
    shader.uniforms.uCloudShadow = globalUniforms.uCloudShadow;

    let vs = shader.vertexShader;
    if (!vs.includes('varying vec3 vHvWorldPos;')) {
      vs = before(vs, 'void main() {', 'varying vec3 vHvWorldPos;\nvarying vec3 vHvWorldNormal;');
      vs = after(
        vs,
        '#include <project_vertex>',
        /* glsl */ `
        {
          mat4 hvM2 = modelMatrix;
          #ifdef USE_INSTANCING
            hvM2 = modelMatrix * instanceMatrix;
          #endif
          vHvWorldPos = (hvM2 * vec4(transformed, 1.0)).xyz;
          vHvWorldNormal = normalize(mat3(hvM2) * objectNormal);
        }`,
      );
    }
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    if (!fs.includes('varying vec3 vHvWorldPos;')) {
      fs = before(fs, 'void main() {', 'varying vec3 vHvWorldPos;\nvarying vec3 vHvWorldNormal;');
    }
    fs = before(
      fs,
      'void main() {',
      `uniform float uTime;\nuniform float uSnow;\nuniform float uWet;\nuniform float uCloudShadow;\n${NOISE_GLSL}`,
    );
    let albedo = '';
    if (snow) {
      albedo += /* glsl */ `
      {
        float hvUp = smoothstep(${snowUp.toFixed(3)}, ${(snowUp + 0.3).toFixed(3)}, normalize(vHvWorldNormal).y);
        float hvN = hvNoise(vHvWorldPos.xz * 2.3) * 0.5 + hvNoise(vHvWorldPos.xz * 9.0) * 0.5;
        float hvS = smoothstep(0.0, 0.35, uSnow * hvUp - (1.0 - hvN) * 0.35 * (1.0 - uSnow));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97) * (0.92 + 0.08 * hvN), hvS);
      }`;
    }
    if (wet) {
      albedo += /* glsl */ `
      diffuseColor.rgb *= 1.0 - uWet * 0.28;`;
    }
    fs = after(fs, '#include <color_fragment>', albedo);
    if (wet && fs.includes('#include <roughnessmap_fragment>')) {
      fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, uWet);');
    }
    if (clouds) {
      fs = after(
        fs,
        '#include <lights_fragment_end>',
        /* glsl */ `
        {
          float hvC = hvCloudShadow(vHvWorldPos.xz, uTime, uCloudShadow);
          reflectedLight.directDiffuse *= hvC;
          reflectedLight.directSpecular *= hvC;
        }`,
      );
    }
    shader.fragmentShader = fs;
  });
}
