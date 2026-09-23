/**
 * "World FX" material patch for anything that sits outdoors: applyWorldFx(material).
 *  - Snow on up-facing surfaces: noisy coverage, soft wind-drift micro normals, cool blue
 *    skylight in its shadows and hashed sun glints. `snowMask` / `slush` let a material
 *    reduce coverage (trampled paths) or tint it towards grey-brown slush.
 *  - Rain wetness: darker albedo + glossier.
 *  - Soft moving cloud shadows on direct light.
 *  - Golden-hour back-rim: a fresnel × sun-colour edge light driven by globalUniforms.uRim.
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
  rim?: boolean;
  /** GLSL float expression (fragment, main scope) multiplying snow coverage. */
  snowMask?: string;
  /** GLSL float expression 0..1: how much of the snow reads as trampled slush. */
  slush?: string;
}

export function applyWorldFx<M extends THREE.Material>(material: M, opts: WorldFxOptions = {}): M {
  const snow = opts.snow ?? true;
  const clouds = opts.clouds ?? true;
  const wet = opts.wet ?? true;
  const rim = opts.rim ?? true;
  const snowUp = opts.snowUp ?? 0.55;
  const mask = opts.snowMask ?? '1.0';
  const slush = opts.slush ?? '0.0';
  const key = `wfx:${snow ? 1 : 0}${clouds ? 1 : 0}${wet ? 1 : 0}${rim ? 1 : 0}:${snowUp}:${mask}:${slush}`;
  return patchMaterial(material, key, (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uSnow = globalUniforms.uSnow;
    shader.uniforms.uWet = globalUniforms.uWet;
    shader.uniforms.uCloudShadow = globalUniforms.uCloudShadow;
    shader.uniforms.uRim = globalUniforms.uRim;
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;

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
          #ifdef USE_BATCHING
            hvM2 = modelMatrix * batchingMatrix;
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
    const decl = ['uTime', 'uSnow', 'uWet', 'uCloudShadow', 'uRim']
      .filter((u) => !fs.includes(`uniform float ${u};`))
      .map((u) => `uniform float ${u};`)
      .join('\n');
    const vdecl = ['uSunDir', 'uSunColor'].filter((u) => !fs.includes(`uniform vec3 ${u};`)).map((u) => `uniform vec3 ${u};`).join('\n');
    fs = before(fs, 'void main() {', `${decl}\n${vdecl}\n${NOISE_GLSL}`);
    let albedo = 'float hvSnowAmt = 0.0;';
    if (snow) {
      albedo += /* glsl */ `
      {
        float hvUp = smoothstep(${snowUp.toFixed(3)}, ${(snowUp + 0.3).toFixed(3)}, normalize(vHvWorldNormal).y);
        float hvN = hvNoise(vHvWorldPos.xz * 2.3) * 0.5 + hvNoise(vHvWorldPos.xz * 9.0) * 0.5;
        float hvS = smoothstep(0.0, 0.35, uSnow * hvUp * (${mask}) - (1.0 - hvN) * 0.35 * (1.0 - uSnow));
        hvSnowAmt = hvS;
        float hvDrift = hvNoise(vHvWorldPos.xz * 0.9 + 3.0);
        // Albedo capped at ~0.82 so lamp-lit snow never clips into a bloom blob at night.
        // Albedo held well below white so sunlit snow keeps its form and shadows can go properly blue.
        vec3 hvSnowCol = vec3(0.8, 0.85, 0.93) * 0.78 * (0.93 + 0.07 * hvN) * (0.95 + 0.08 * hvDrift);
        hvSnowCol = mix(hvSnowCol, vec3(0.62, 0.58, 0.52) * (0.9 + 0.2 * hvN), clamp(${slush}, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, hvSnowCol, hvS);
      }`;
    }
    if (wet) {
      albedo += /* glsl */ `
      // Rain soaks surfaces ~40 % darker (and glossier, below): wet bark, stone and soil read at a glance.
      diffuseColor.rgb *= 1.0 - uWet * 0.4 * (1.0 - hvSnowAmt);`;
    }
    fs = after(fs, '#include <color_fragment>', albedo);
    if (wet && fs.includes('#include <roughnessmap_fragment>')) {
      fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.3, uWet);');
    }
    if (snow && fs.includes('#include <roughnessmap_fragment>')) {
      fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, 0.62, hvSnowAmt);');
    }
    if (snow && fs.includes('#include <normal_fragment_maps>')) {
      // Soft wind-drift ripples in the snow.
      fs = after(
        fs,
        '#include <normal_fragment_maps>',
        /* glsl */ `
        if (hvSnowAmt > 0.01) {
          vec2 hq = vHvWorldPos.xz * 1.1;
          vec3 hd = vec3(hvNoise(hq) - 0.5, 0.0, hvNoise(hq + 7.3) - 0.5) + vec3(hvNoise(hq * 3.7) - 0.5, 0.0, hvNoise(hq * 3.7 + 2.1) - 0.5) * 0.4;
          // Sastrugi: wind-carved ridges running across the prevailing wind, wandering and fading in
          // and out in patches (only on open, up-facing snow).
          float hvRidgeK = smoothstep(0.35, 0.7, hvNoise(vHvWorldPos.xz * 0.12 + 5.0)) * smoothstep(0.85, 0.97, normalize(vHvWorldNormal).y);
          float hvRidge = cos(dot(vHvWorldPos.xz, vec2(0.8, 0.6)) * 2.6 + hvNoise(vHvWorldPos.xz * 0.35) * 7.0);
          hd += vec3(0.8, 0.0, 0.6) * hvRidge * 0.32 * hvRidgeK;
          normal = normalize(normal + mat3(viewMatrix) * hd * 0.55 * hvSnowAmt);
        }`,
      );
    }
    if (clouds || snow || rim) {
      let light = '';
      if (clouds) {
        light += /* glsl */ `
        {
          float hvC = hvCloudShadow(vHvWorldPos.xz, uTime, uCloudShadow);
          reflectedLight.directDiffuse *= hvC;
          reflectedLight.directSpecular *= hvC;
        }`;
      }
      if (snow) {
        light += /* glsl */ `
        if (hvSnowAmt > 0.01) {
          // Cool skylight in snow shadows + glints where the sun hits.
          reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(0.66, 0.82, 1.28), hvSnowAmt);
          vec3 hvV = normalize(cameraPosition - vHvWorldPos);
          vec2 hvCell = floor(vHvWorldPos.xz * 34.0);
          float hvG = step(0.987, hvHash12(hvCell + floor(hvV.xz * 5.0) * 13.1));
          float hvLit = dot(reflectedLight.directDiffuse, vec3(0.333));
          reflectedLight.directSpecular += vec3(hvG * 3.5 * hvSnowAmt * hvLit);
        }`;
      }
      fs = after(fs, '#include <lights_fragment_end>', light);
    }
    if (rim && fs.includes('#include <emissivemap_fragment>')) {
      fs = after(
        fs,
        '#include <emissivemap_fragment>',
        /* glsl */ `
        if (uRim > 0.001) {
          vec3 hvVr = normalize(cameraPosition - vHvWorldPos);
          float hvFr = pow(1.0 - clamp(dot(normalize(vHvWorldNormal), hvVr), 0.0, 1.0), 3.0);
          float hvToward = max(dot(normalize(vHvWorldNormal), normalize(uSunDir)), 0.0);
          totalEmissiveRadiance += uSunColor * diffuseColor.rgb * hvFr * (0.25 + 0.75 * hvToward) * uRim * 0.9;
        }`,
      );
    }
    shader.fragmentShader = fs;
  });
}
