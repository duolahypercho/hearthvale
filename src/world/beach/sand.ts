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

export function applyBeachSand(material: THREE.Material, seaLevel: number, pools: [number, number, number][] = []): void {
  patchMaterial(material, 'beach-sand', (shader) => {
    shader.uniforms.uBSea = { value: seaLevel };
    shader.uniforms.uBSun = globalUniforms.uSunColor;
    shader.uniforms.uBSunDir = globalUniforms.uSunDir;
    shader.uniforms.uBNight = globalUniforms.uNight;
    const pv = [0, 1, 2, 3].map((i) => (pools[i] ? new THREE.Vector3(pools[i]![0], pools[i]![1], pools[i]![2]) : new THREE.Vector3(1e5, 1e5, 0.01)));
    shader.uniforms.uBPools = { value: pv };
    let fs = shader.fragmentShader;
    fs = before(
      fs,
      'void main() {',
      /* glsl */ `
      uniform float uBSea;
      uniform vec3 uBSun;
      uniform vec3 uBSunDir;
      uniform float uBNight;
      uniform vec3 uBPools[4];
      float hvBWet = 0.0;
      float hvBCaus = 0.0;
      float hvBDepth = 0.0;
      float hvBMoon = 0.0;
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
        vec3 sDry = sand * vec3(0.88, 0.82, 0.7);
        vec3 sBeach = sand * vec3(0.86, 0.76, 0.61);
        vec3 s = mix(sBeach, sDry, smoothstep(0.8, 2.4, bh));
        // Broad warm / cool drifts (wind-sorted sand) + fine grain.
        float drift = hvNoise(p * 0.07 + 3.0);
        s *= mix(vec3(0.9, 0.9, 0.94), vec3(1.04, 1.0, 0.92), drift);
        s *= 0.92 + 0.14 * hvNoise(p * 0.35) + 0.05 * (tn2 - 0.5);
        // Wind ripples on the dunes / dry beach; wave ripples low down and under water.
        vec2 rd = normalize(vec2(0.35, 1.0));
        float warpR = hvNoise(p * 0.4) * 5.0 + hvNoise(p * 1.3) * 1.2;
        float ripF = bh > 0.35 ? 7.5 : 11.0;
        float rip = sin(dot(p, rd) * ripF + warpR);
        float ripAmt = (smoothstep(0.3, 1.2, bh) * 0.9 + smoothstep(0.1, -0.2, bh) * 0.7) * onSand;
        hvBRip = rd * cos(dot(p, rd) * ripF + warpR) * ripAmt * 0.22;
        s *= 1.0 + (rip * 0.07 + smoothstep(0.7, 1.0, rip) * 0.05) * ripAmt;
        // Shell flecks + tiny pebbles.
        vec2 fc = floor(p * 5.0);
        vec2 fo = hvHash22(fc) - 0.5;
        float fleck = smoothstep(0.06, 0.02, length(fract(p * 5.0) - 0.5 - fo * 0.6)) * step(hvHash12(fc + 3.1), 0.12);
        s = mix(s, mix(vec3(0.95, 0.9, 0.82), vec3(0.45, 0.4, 0.36), step(0.55, hvHash12(fc + 7.7))), fleck * 0.7 * step(0.05, bh));
        // Wrack line: dark kelp bits + bleached twigs at the high-tide mark.
        float wrackBand = smoothstep(0.34, 0.41, bh) * smoothstep(0.58, 0.47, bh);
        // Discrete bits (kelp scraps, bleached twigs) in drifts along the band, not smears.
        {
          vec2 kq = p * vec2(2.2, 3.4);
          vec2 kc = floor(kq);
          vec2 kf = fract(kq) - 0.5 - (hvHash22(kc) - 0.5) * 0.5;
          float kh = hvHash12(kc + 1.3);
          float ka = hvHash12(kc + 8.1) * 3.14;
          vec2 kr = vec2(kf.x * cos(ka) - kf.y * sin(ka), kf.x * sin(ka) + kf.y * cos(ka));
          float bit = smoothstep(0.2, 0.13, length(kr * vec2(1.0, 3.2)));
          float kd = smoothstep(0.4, 0.7, hvNoise(p * 0.25 + 1.7));
          vec3 kcol = kh < 0.22 ? vec3(0.78, 0.74, 0.64) : mix(vec3(0.16, 0.2, 0.08), vec3(0.3, 0.24, 0.1), hvHash12(kc + 2.2));
          s = mix(s, kcol, bit * step(kh, 0.55) * wrackBand * kd * 0.85);
          // A faint damp stain under the drift.
          s *= 1.0 - 0.06 * wrackBand * kd;
        }
        // Wet sand below the swash line (+ darkening where the sheet just left).
        float sheet = hvSwash(p, t);
        float ph = fract(hvSwashPhase(p, t));
        // Damp band reaches well up the beach (ragged top edge), soaked sand right at the swash.
        float dampTop = 0.42 + (hvNoise(p * vec2(0.5, 0.2)) - 0.5) * 0.16;
        float damp = smoothstep(dampTop, 0.02, bh);
        float soaked = smoothstep(0.14, 0.0, bh);
        vec3 wetS = sand * vec3(0.4, 0.35, 0.28);
        s = mix(s, mix(s * vec3(0.62, 0.6, 0.6), wetS, soaked), damp);
        // Darker tide mark along the top of the damp band.
        s *= 1.0 - 0.1 * smoothstep(0.06, 0.0, abs(bh - dampTop * 0.9)) * onSand;
        hvBWet = max(soaked * 0.7, damp * 0.12) * onSand;
        // Moonlit sand (night): the dry beach keeps a pale, cool value well above the sea's.
        hvBMoon = sandM * smoothstep(-0.04, 0.12, bh) * smoothstep(2.4, 1.4, bh) * (1.0 - soaked * 0.45) * (1.0 - rockM);
        // Foam lace stranded by the receding wave.
        float recede = step(0.22, ph) * smoothstep(0.95, 0.35, ph);
        float lace = hvLace(p * 1.1, t * 0.2) * smoothstep(0.4, 0.7, hvNoise(p * 0.13 + 1.3));
        float stranded = lace * smoothstep(0.012, 0.0, bh - sheet - 0.035) * smoothstep(-0.03, 0.0, bh - sheet) * recede;
        s = mix(s, vec3(0.93, 0.95, 0.94) * 0.9, stranded * 0.55 * smoothstep(0.35, 0.6, hvNoise(p * 0.9 + 4.0)) * onSand);
        // Seabed: cooler, darker with depth; caustics (applied as light below).
        float depth = max(0.0, -bh);
        hvBDepth = depth;
        vec3 bed = sand * vec3(0.6, 0.72, 0.68) * (0.88 + 0.12 * rip);
        s = mix(s, bed, smoothstep(0.0, 0.3, depth));
        s = mix(s, vec3(0.05, 0.16, 0.2), smoothstep(0.8, 3.5, depth));
        float caus = hvCaustic(p * 1.05, t);
        float patchC = smoothstep(0.2, 0.65, hvNoise(p * 0.16 + vec2(t * 0.02, 0.0)));
        hvBCaus = caus * patchC * smoothstep(0.08, 0.45, uBSunDir.y) * smoothstep(0.03, 0.2, depth) * (1.0 - smoothstep(0.45, 1.5, depth)) * sandM;
        ground = mix(ground, s, sandM);
        // Rock shelf (painted path channel): cracked grey-brown stone, weed + barnacles low down,
        // dark and glossy where the spray keeps it wet.
        if (pathM > 0.001) {
          // Large tonal slabs (warped, irregular) with darker seams, not a paving pattern.
          vec2 wq = p * 0.42 + vec2(hvNoise(p * 0.3), hvNoise(p * 0.3 + 5.0)) * 1.4;
          vec2 rv = hvVor(wq);
          float seam = smoothstep(0.09, 0.0, rv.y - rv.x) * smoothstep(0.3, 0.6, hvNoise(p * 0.9 + 2.0));
          float slab = hvHash12(floor(wq + 0.5)) * 0.5 + hvNoise(p * 0.8) * 0.5;
          float rn = hvNoise(p * 2.3) * 0.5 + hvNoise(p * 6.0) * 0.3 + hvNoise(p * 15.0) * 0.2;
          vec3 rock = mix(vec3(0.1, 0.085, 0.07), vec3(0.25, 0.2, 0.155), slab * 0.6 + rn * 0.4);
          rock = mix(rock, rock * vec3(1.05, 0.98, 0.9), smoothstep(0.4, 0.8, hvNoise(p * 0.2 + 9.0)));
          rock *= 1.0 - seam * 0.18;
          // Sun-bleached ledge tops for relief (broad, soft).
          rock = mix(rock, rock * vec3(1.3, 1.24, 1.12), smoothstep(0.55, 0.8, hvNoise(p * 0.6 + 11.0)) * smoothstep(0.7, 1.1, bh) * 0.5);
          // Wet, weedy rims around the tide pools; inside: a sandy, pebbled floor that darkens with depth.
          float ring = 0.0;
          float ddMin = 9.0;
          for (int i = 0; i < 4; i++) {
            vec3 tp = uBPools[i];
            float dd = length((p - tp.xy) * vec2(1.0, 1.15)) / tp.z;
            ring = max(ring, smoothstep(1.5 + 0.2 * hvNoise(p * 2.0 + float(i)), 1.02, dd));
            ddMin = min(ddMin, dd);
          }
          float inPool = smoothstep(1.02, 0.8, ddMin);
          // Pitting.
          rock *= 0.92 + 0.08 * smoothstep(0.3, 0.7, rn);
          // Lichen on the dry tops (mustard / orange rosettes).
          // Lichen: small crusty rosettes on the dry tops (speckled, never big blotches).
          float lichen = smoothstep(0.62, 0.8, hvNoise(p * 1.6 + 3.3)) * smoothstep(0.75, 1.05, bh) * (1.0 - ring);
          lichen *= smoothstep(0.55, 0.75, hvNoise(p * 9.0 + 1.0));
          rock = mix(rock, mix(vec3(0.5, 0.42, 0.2), vec3(0.58, 0.34, 0.16), hvNoise(p * 3.0)), lichen * 0.28);
          // Weed + algae low down near the waterline.
          // (No painted halo round the pools: the rims get real weed tufts, see shelf.ts.)
          float weed = smoothstep(0.62, 0.3, bh) * smoothstep(0.32, 0.62, hvNoise(p * 1.9 + 5.0) + hvNoise(p * 7.0) * 0.25);
          rock = mix(rock, mix(vec3(0.12, 0.2, 0.08), vec3(0.24, 0.3, 0.1), hvNoise(p * 5.0)), weed * 0.85);
          // Barnacles: round pale dots clustered in the splash zone.
          vec2 bq = p * 9.0;
          vec2 bc = floor(bq);
          vec2 bo = hvHash22(bc) - 0.5;
          float bd = length(fract(bq) - 0.5 - bo * 0.5);
          float barnZone = smoothstep(1.0, 0.5, bh) * smoothstep(0.35, 0.55, hvNoise(p * 1.1 + 7.0)) * (1.0 - weed);
          float barn = smoothstep(0.2, 0.13, bd) * step(hvHash12(bc + 4.4), 0.28) * barnZone;
          rock = mix(rock, vec3(0.5, 0.47, 0.4), barn * 0.6);
          rock *= 1.0 - smoothstep(0.24, 0.2, bd) * (1.0 - smoothstep(0.2, 0.13, bd)) * barnZone * 0.3;
          // Dark and wet where the spray reaches.
          rock *= mix(0.6, 1.0, smoothstep(0.3, 0.95, bh)) * (1.0 - ring * 0.3);
          if (inPool > 0.001) {
            vec2 pc = floor(p * 7.0);
            float peb = smoothstep(0.34, 0.2, length(fract(p * 7.0) - 0.5 - (hvHash22(pc) - 0.5) * 0.4)) * step(hvHash12(pc + 2.0), 0.45);
            vec3 floorC = mix(vec3(0.46, 0.44, 0.33), vec3(0.3, 0.36, 0.24), hvNoise(p * 2.5));
            floorC = mix(floorC, mix(vec3(0.62, 0.58, 0.5), vec3(0.28, 0.26, 0.24), hvHash12(pc + 5.0)), peb * 0.8);
            // Deeper towards the middle, a dark undercut ring just inside the lip.
            floorC *= mix(1.0, 0.62, smoothstep(0.85, 0.15, ddMin)) * (1.0 - 0.35 * smoothstep(0.62, 0.9, ddMin) * smoothstep(1.02, 0.92, ddMin));
            rock = mix(rock, floorC, inPool);
          }
          ground = mix(ground, rock, pathM);
          hvBCaus = max(hvBCaus, caus * inPool * 0.8 * smoothstep(0.08, 0.45, uBSunDir.y));
          hvBWet = max(hvBWet * (1.0 - pathM), pathM * max(smoothstep(0.7, 0.35, bh) * 0.3, ring * 0.3));
        }
      }
      `,
    );
    fs = after(fs, 'roughnessFactor = hvTerrainRough;', 'roughnessFactor = mix(roughnessFactor, 0.28, hvBWet);');
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 Vb = normalize(cameraPosition - vTWorld);
        float frb = 0.2 + 0.8 * pow(1.0 - max(Vb.y, 0.0), 3.0);
        // Wet-sand sky sheen; held back under a low sun so a sunset beach keeps its contrast.
        // (The moon drives uBSunDir at night: sheen + caustics fade out so the wet band never glows.)
        float dayK = 1.0 - uBNight;
        totalEmissiveRadiance += mix(uHorizonT, uSkyT, 0.45) * hvBWet * frb * 0.22 * mix(0.45, 1.0, smoothstep(0.08, 0.4, uBSunDir.y)) * mix(0.25, 1.0, dayK);
        hvBCaus *= dayK;
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.58, 0.62, 0.8) * hvBMoon * uBNight * 0.34;
        totalEmissiveRadiance += uBSun * hvBCaus * diffuseColor.rgb * 1.25;
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
