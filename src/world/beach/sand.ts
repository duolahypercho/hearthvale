/**
 * Beach ground shading, layered on top of the shared terrain shader (patch after 'terrain'):
 *   dunes      pale, wind-rippled sand (normal-perturbed ripples following the dune flow)
 *   beach      warm sand with shell flecks and a wrack line of dark kelp bits at the high-tide mark
 *   swash zone dark wet sand with a mirror sheen (sky reflection), foam lace left behind by the
 *              receding wave (in phase with the ocean's swash, SWASH_GLSL)
 *   seabed     sand ripples + animated caustic network, absorbed with depth (seen through the water)
 * Also provides the tint for the rock shelf (painted into the terrain's path channel).
 */
import * as THREE from 'three';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { SWASH_GLSL, VORONOI_GLSL } from './ocean';

export function applyBeachSand(material: THREE.Material, seaLevel: number): void {
  patchMaterial(material, 'beach-sand', (shader) => {
    shader.uniforms.uBSea = { value: seaLevel };
    shader.uniforms.uBSun = globalUniforms.uSunColor;
    shader.uniforms.uBSunDir = globalUniforms.uSunDir;
    let fs = shader.fragmentShader;
    fs = before(
      fs,
      'void main() {',
      /* glsl */ `
      uniform float uBSea;
      uniform vec3 uBSun;
      uniform vec3 uBSunDir;
      float hvBWet = 0.0;
      float hvBCaus = 0.0;
      float hvBDepth = 0.0;
      vec2 hvBRip = vec2(0.0);
      ${SWASH_GLSL}
      ${VORONOI_GLSL}
      `,
    );
    fs = before(
      fs,
      '// Baked contact AO under props / vignettes',
      /* glsl */ `
      {
        float bh = wp.y - uBSea;
        float t = uTimeT;
        vec2 p = wp.xz;
        float onSand = sandM * (1.0 - rockM);
        // Base tones: pale dune sand high up, warm beach sand lower down.
        vec3 sDry = sand * vec3(1.08, 1.02, 0.9);
        vec3 sBeach = sand * vec3(1.02, 0.93, 0.8);
        vec3 s = mix(sBeach, sDry, smoothstep(0.8, 2.4, bh));
        s *= 0.92 + 0.14 * hvNoise(p * 0.35) + 0.05 * (tn2 - 0.5);
        // Wind ripples on the dunes / dry beach; wave ripples low down and under water.
        vec2 rd = normalize(vec2(0.35, 1.0));
        float warpR = hvNoise(p * 0.4) * 5.0 + hvNoise(p * 1.3) * 1.2;
        float ripF = bh > 0.35 ? 7.5 : 11.0;
        float rip = sin(dot(p, rd) * ripF + warpR);
        float ripAmt = (smoothstep(0.3, 1.2, bh) * 0.9 + smoothstep(0.1, -0.2, bh) * 0.7) * onSand;
        hvBRip = rd * cos(dot(p, rd) * ripF + warpR) * ripAmt * 0.22;
        s *= 1.0 + rip * 0.035 * ripAmt;
        // Shell flecks + tiny pebbles.
        vec2 fc = floor(p * 5.0);
        vec2 fo = hvHash22(fc) - 0.5;
        float fleck = smoothstep(0.06, 0.02, length(fract(p * 5.0) - 0.5 - fo * 0.6)) * step(hvHash12(fc + 3.1), 0.12);
        s = mix(s, mix(vec3(0.95, 0.9, 0.82), vec3(0.45, 0.4, 0.36), step(0.55, hvHash12(fc + 7.7))), fleck * 0.7 * step(0.05, bh));
        // Wrack line: dark kelp bits + bleached twigs at the high-tide mark.
        float wrackBand = smoothstep(0.28, 0.42, bh) * smoothstep(0.78, 0.55, bh);
        float wrackN = smoothstep(0.62, 0.8, hvNoise(p * vec2(1.6, 4.2)) * 0.7 + hvNoise(p * 6.0) * 0.4);
        s = mix(s, vec3(0.1, 0.11, 0.05), wrackBand * wrackN * 0.75);
        // Wet sand below the swash line (+ darkening where the sheet just left).
        float sheet = hvSwash(p, t);
        float ph = fract(hvSwashPhase(p, t));
        float damp = smoothstep(0.22, -0.02, bh);
        float soaked = smoothstep(0.11, 0.0, bh);
        vec3 wetS = sand * vec3(0.52, 0.47, 0.4);
        s = mix(s, mix(s * 0.82, wetS, soaked), damp);
        hvBWet = max(soaked * 0.85, damp * 0.35) * onSand;
        // Foam lace stranded by the receding wave.
        float recede = step(0.22, ph) * smoothstep(0.95, 0.35, ph);
        float lace = hvLace(p * 2.1, t * 0.2);
        float stranded = lace * smoothstep(0.012, 0.0, bh - sheet - 0.035) * smoothstep(-0.03, 0.0, bh - sheet) * recede;
        s = mix(s, vec3(0.93, 0.95, 0.94) * 0.9, stranded * 0.8 * onSand);
        // Seabed: cooler, darker with depth; caustics (applied as light below).
        float depth = max(0.0, -bh);
        hvBDepth = depth;
        vec3 bed = sand * vec3(0.72, 0.8, 0.74) * (0.9 + 0.1 * rip);
        s = mix(s, bed, smoothstep(0.0, 0.3, depth));
        s = mix(s, vec3(0.05, 0.16, 0.2), smoothstep(0.8, 3.5, depth));
        vec2 cv = hvVor(p * 0.9 + vec2(t * 0.11, t * 0.07));
        vec2 cv2 = hvVor(p * 1.3 - vec2(t * 0.08, -t * 0.12) + 4.0);
        float caus = smoothstep(0.22, 0.0, cv.y - cv.x) * 0.6 + smoothstep(0.18, 0.0, cv2.y - cv2.x) * 0.5;
        hvBCaus = caus * smoothstep(0.02, 0.25, depth) * (1.0 - smoothstep(0.6, 3.2, depth)) * sandM;
        ground = mix(ground, s, sandM);
        // Rock shelf (painted path channel): wet dark at the bottom, barnacle-pale tops.
        float rockTint = pathM * (1.0 - smoothstep(0.35, 0.8, bh) * 0.0);
        ground = mix(ground, ground * mix(vec3(0.55, 0.58, 0.6), vec3(1.0), smoothstep(0.1, 0.7, bh)), rockTint * 0.6);
      }
      `,
    );
    fs = after(fs, 'roughnessFactor = hvTerrainRough;', 'roughnessFactor = mix(roughnessFactor, 0.16, hvBWet);');
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 Vb = normalize(cameraPosition - vTWorld);
        float frb = 0.2 + 0.8 * pow(1.0 - max(Vb.y, 0.0), 3.0);
        totalEmissiveRadiance += mix(uHorizonT, uSkyT, 0.45) * hvBWet * frb * 0.22;
        totalEmissiveRadiance += uBSun * hvBCaus * 0.75 * diffuseColor.rgb * 2.2;
      }`,
    );
    fs = after(
      fs,
      '#include <normal_fragment_maps>',
      /* glsl */ `
      if (dot(hvBRip, hvBRip) > 1e-5) normal = normalize(normal + mat3(viewMatrix) * vec3(hvBRip.x, 0.0, hvBRip.y));`,
    );
    shader.fragmentShader = fs;
  });
}
