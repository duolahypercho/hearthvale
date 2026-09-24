/**
 * Cave stone shading (breakable rocks + props that opt in): a procedural "texture" evaluated in
 * the fragment shader instead of flat vertex colour —
 *  - 3D value-noise fbm in rock space (no UVs, no seams, no stretching on steep faces: the 3D
 *    equivalent of triplanar sampling) → blotchy albedo, fine grain, pale / dark speckle, faint
 *    sediment banding; a matching roughness breakup;
 *  - derivative bump mapping from the same height field (pitted, chipped surface under the lantern);
 *  - ore VEINS carved into the rock itself (not stuck-on blobs): ridged noise in rock space picks
 *    thin branching seams that thicken into pockets. Each ore kind has its own metal response —
 *    copper (metalness .8, roughness .35) with teal verdigris at the seam edges, blue-grey iron
 *    with rust bleeding out of it, high-spec gold with a twinkling star glint, glossy black coal,
 *    and gem-coloured glowing inclusions — plus a fake environment sheen so metal reads in the dark.
 *
 * Ore data travels per vertex (`aOre` = rgb ore colour, w = kind code) so every rock variant is
 * still one batched multi-draw. Rock space = object position + a per-instance offset taken from
 * the instance origin, so two instances of the same variant never share a vein pattern.
 */
import * as THREE from 'three';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';

/** `aOre.w` codes. */
export const ORE_CODE = { none: 0, copper: 1, iron: 2, gold: 3, coal: 4, gem: 5 } as const;

const NOISE = /* glsl */ `
float hvS_h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hvS_n(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hvS_h(i), hvS_h(i + vec3(1,0,0)), f.x), mix(hvS_h(i + vec3(0,1,0)), hvS_h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hvS_h(i + vec3(0,0,1)), hvS_h(i + vec3(1,0,1)), f.x), mix(hvS_h(i + vec3(0,1,1)), hvS_h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float hvS_fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * hvS_n(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }
`;

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * @param veins  the material carries `aOre` (breakable rocks); false = plain stone (props, rubble).
 * @param scale  noise frequency multiplier (world-space props use ~0.6: bigger features).
 */
export function stoneMaterial(veins: boolean, scale = 1, frost = false): THREE.MeshStandardMaterial {
  const key = `${veins ? 'ore' : 'plain'}:${scale}:${frost ? 'frost' : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  m.name = veins ? 'mine-rock-ore' : 'mine-stone';
  applyStone(m, veins, scale, frost);
  cache.set(key, m);
  return m;
}

/**
 * Patch the procedural stone onto an existing material (its own flags / extra patches kept): cave
 * boulders and entrance rocks share the breakables' surface instead of flat vertex colour.
 */
export function applyStone<M extends THREE.MeshStandardMaterial>(m: M, veins: boolean, scale = 1, frost = false): M {
  const key = `${veins ? 'ore' : 'plain'}:${scale}:${frost ? 'frost' : ''}`;
  patchMaterial(m, `mine-stone:${key}`, (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    let vs = before(shader.vertexShader, 'void main() {', `varying vec3 vStP;\n${veins ? 'attribute vec4 aOre; varying vec4 vOre;' : ''}`);
    vs = after(
      vs,
      '#include <begin_vertex>',
      veins
        ? `{
          vec3 hvO = vec3(0.0);
          #ifdef USE_BATCHING
            hvO = batchingMatrix[3].xyz;
          #endif
          #ifdef USE_INSTANCING
            hvO = instanceMatrix[3].xyz;
          #endif
          vStP = transformed * ${(2.0 * scale).toFixed(3)} + hvO * 1.731;
          vOre = aOre;
        }`
        : `{
          vec4 hvW = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            hvW = batchingMatrix * hvW;
          #endif
          #ifdef USE_INSTANCING
            hvW = instanceMatrix * hvW;
          #endif
          vStP = (modelMatrix * hvW).xyz * ${(1.1 * scale).toFixed(3)};
        }`,
    );
    shader.vertexShader = vs;
    let fs = before(shader.fragmentShader, 'void main() {', `uniform float uTime; varying vec3 vStP;\n${veins ? 'varying vec4 vOre;' : ''}\n${NOISE}`);
    // Albedo + height field.
    fs = after(
      fs,
      '#include <color_fragment>',
      `float hvBlot = hvS_fbm(vStP * 0.9);
       float hvGrain = hvS_n(vStP * 3.6);
       float hvSpeck = hvS_n(vStP * 8.5);
       float hvTone = 0.86 + 0.34 * (hvBlot - 0.5) + 0.1 * (hvGrain - 0.5);
       diffuseColor.rgb *= hvTone;
       // Pale mineral flecks + dark pits.
       diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + 0.02, smoothstep(0.8, 0.92, hvSpeck) * 0.5);
       diffuseColor.rgb *= 1.0 - smoothstep(0.14, 0.04, hvSpeck) * 0.3;
       float hvHeight = hvBlot * 0.6 + hvGrain * 0.4;
       float hvVein = 0.0;
       float hvKind = 0.0;
       vec3 hvOreC = vec3(0.0);
       ${
         veins
           ? `hvKind = vOre.w;
       hvOreC = vOre.rgb;
       if (hvKind > 0.5) {
         // Seams: the thin level sets of two fbm fields (branching, wandering lines), widened into
         // pockets where a third field is high.
         vec3 q = vStP * 0.8;
         float d1 = abs(hvS_fbm(q + 3.1) - 0.5);
         float d2 = abs(hvS_fbm(q * 1.9 + 7.7) - 0.5);
         float pocket = smoothstep(0.6, 0.72, hvS_n(q * 1.3 + 19.0));
         float w = hvKind > 4.5 ? 0.03 : hvKind > 3.5 ? 0.055 : hvKind > 1.5 ? 0.042 : 0.05;
         float r1 = 1.0 - smoothstep(w * 0.45, w, d1);
         float r2 = 1.0 - smoothstep(w * 0.3, w * 0.7, d2);
         hvVein = max(r1, r2 * 0.9);
         float pk = hvKind < 1.5 ? 0.9 : hvKind < 2.5 ? 0.35 : hvKind < 3.5 ? 0.35 : hvKind < 4.5 ? 0.7 : 0.0;
         hvVein = clamp(hvVein + pocket * pk * (1.0 - smoothstep(w, w * 3.0, min(d1, d2))), 0.0, 1.0);
         // Gems break out as crystal clusters (separate mesh): the host rock only carries flecks.
         if (hvKind > 4.5) hvVein = 0.0;
         // Dark host-rock halo along each seam (contrast at gameplay zoom).
         float halo = (1.0 - smoothstep(w, w * 2.2, min(d1, d2 * 1.4))) * (1.0 - hvVein);
         diffuseColor.rgb *= 1.0 - halo * 0.45;
         // Seams sink a touch below the stone (they read as carved, catching a rim of light).
         hvHeight -= hvVein * 0.35;
         vec3 c = hvOreC;
         if (hvKind < 1.5) {
           // Copper: warm metal, teal verdigris crusting the seam edges.
           float pat = smoothstep(0.62, 0.8, hvS_n(vStP * 2.4 + 2.0)) + (1.0 - smoothstep(0.0, 0.7, hvVein)) * 0.6;
           c = mix(vec3(0.95, 0.34, 0.07), vec3(0.12, 0.62, 0.5), clamp(pat, 0.0, 1.0) * 0.85);
         } else if (hvKind < 2.5) {
           float rust = smoothstep(0.55, 0.85, hvS_n(vStP * 2.2 + 5.0));
           c = mix(vec3(0.34, 0.4, 0.52), vec3(0.6, 0.26, 0.09), rust * 0.75);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.24, 0.1), rust * smoothstep(0.0, 0.5, 1.0 - hvVein) * 0.35 * step(0.001, pocket + r1 - 0.6));
         } else if (hvKind < 3.5) {
           c = vec3(1.0, 0.58, 0.07);
         } else if (hvKind < 4.5) {
           c = vec3(0.045, 0.042, 0.05);
         }
         diffuseColor.rgb = mix(diffuseColor.rgb, c, hvVein);
       }`
           : ''
       }`,
    );
    fs = after(
      fs,
      '#include <roughnessmap_fragment>',
      `roughnessFactor = clamp(roughnessFactor + (hvGrain - 0.5) * 0.18 - hvSpeck * 0.06, 0.3, 1.0);
       ${
         veins
           ? `if (hvKind > 0.5) {
         float vr = hvKind < 1.5 ? 0.35 : hvKind < 2.5 ? 0.42 : hvKind < 3.5 ? 0.24 : hvKind < 4.5 ? 0.28 : 0.15;
         roughnessFactor = mix(roughnessFactor, vr, hvVein);
       }`
           : ''
       }`,
    );
    fs = after(
      fs,
      '#include <metalnessmap_fragment>',
      veins
        ? `if (hvKind > 0.5) {
         float vm = hvKind < 1.5 ? 0.55 : hvKind < 2.5 ? 0.5 : hvKind < 3.5 ? 0.8 : hvKind < 4.5 ? 0.2 : 0.1;
         metalnessFactor = mix(metalnessFactor, vm, hvVein);
       }`
        : '',
    );
    // Derivative bump (screen-space) from the height field.
    fs = after(
      fs,
      '#include <normal_fragment_maps>',
      `{
        vec3 dpx = dFdx(-vViewPosition);
        vec3 dpy = dFdy(-vViewPosition);
        vec2 dh = vec2(dFdx(hvHeight), dFdy(hvHeight));
        vec3 r1 = cross(dpy, normal);
        vec3 r2 = cross(normal, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
        normal = normalize(abs(det) * normal - grad * 0.3);
      }`,
    );
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      (frost
        ? `{
          // Frosted ice-rock: a translucent blue skin — cool fresnel rim, faint inner glow on the
          // thin top edges (fake subsurface), sparkling rime on the up-facing surfaces.
          vec3 fnW = normalize(inverseTransformDirection(normal, viewMatrix));
          float frr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
          totalEmissiveRadiance += vec3(0.35, 0.62, 1.0) * frr * 0.45 + vec3(0.2, 0.45, 0.7) * smoothstep(0.3, 0.9, fnW.y) * 0.1;
          vec3 rc = floor(vStP * 5.0);
          float rh = hvS_h(rc + 9.1);
          float rd = smoothstep(0.14, 0.0, length(fract(vStP * 5.0) - 0.5 - (vec3(hvS_h(rc), hvS_h(rc + 2.0), hvS_h(rc + 4.0)) - 0.5) * 0.6));
          totalEmissiveRadiance += vec3(0.8, 0.92, 1.0) * step(0.8, rh) * rd * smoothstep(0.2, 0.7, fnW.y) * (0.35 + 0.65 * pow(max(0.0, sin(uTime * 1.8 + rh * 50.0)), 8.0));
        }`
        : '') +
      (veins
        ? `if (hvKind > 0.5 && hvVein > 0.01) {
          float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
          vec3 sheen = hvKind < 1.5 ? diffuseColor.rgb : hvKind < 2.5 ? diffuseColor.rgb * 0.55 : hvKind < 3.5 ? vec3(1.0, 0.62, 0.1) : hvKind < 4.5 ? vec3(0.3, 0.3, 0.36) : hvOreC;
          // Fake environment: metal would read black in a cave without it.
          float env = hvKind > 4.5 ? 0.5 : hvKind < 3.5 && hvKind > 2.5 ? 0.3 : 0.14;
          totalEmissiveRadiance += sheen * hvVein * (env + fr * 0.55);
          // Glints: sparse cells twinkle (gold / gems / coal flecks).
          vec3 cp = vStP * 3.0;
          vec3 cell = floor(cp);
          float h = hvS_h(cell + 3.7);
          vec3 off = vec3(hvS_h(cell + 1.3), hvS_h(cell + 5.1), hvS_h(cell + 8.9)) * 0.6 + 0.2;
          float dot_ = smoothstep(0.16, 0.0, length(fract(cp) - off));
          float tw = pow(max(0.0, sin(uTime * (1.3 + h * 2.2) + h * 60.0)), 16.0) * step(0.55, h) * dot_;
          float gl = hvKind > 2.5 && hvKind < 3.5 ? 3.0 : hvKind > 4.5 ? 2.2 : hvKind > 3.5 ? 1.2 : 0.8;
          totalEmissiveRadiance += mix(sheen, vec3(1.0), 0.6) * tw * hvVein * gl;
        }`
        : ''),
    );
    shader.fragmentShader = fs;
  });
  return m;
}
