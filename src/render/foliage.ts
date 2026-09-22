/**
 * Shared shading patch for thin two-sided plant geometry (crops, weeds, flowers):
 *  - both faces lit with the up-biased front normal (no black back faces),
 *  - a small ambient floor so dense rosettes keep their form in shadow / at night,
 *  - sun-side translucency (leaves glow when back-lit) and a soft golden-hour rim.
 * Requires applyWorldFx() on the same material (uses its world-position varyings).
 */
import type * as THREE from 'three';
import { globalUniforms } from './uniforms';
import { patchMaterial, after, before } from './patch';

export function applyPlantLighting<M extends THREE.Material>(m: M, opts: { translucency?: number; floor?: number } = {}): M {
  const tr = (opts.translucency ?? 0.35).toFixed(3);
  const fl = (opts.floor ?? 0.045).toFixed(3);
  return patchMaterial(m, `plant-lighting:${tr}:${fl}`, (shader) => {
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    let fs = shader.fragmentShader;
    if (!fs.includes('uniform vec3 uSunDir;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunDir;\nuniform vec3 uSunColor;');
    fs = after(fs, '#include <normal_fragment_begin>', 'normal = normalize(vNormal);');
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 Vp = normalize(cameraPosition - vHvWorldPos);
        float backP = pow(max(dot(-Vp, normalize(uSunDir)), 0.0), 2.5);
        totalEmissiveRadiance += diffuseColor.rgb * (${fl} + uSunColor * backP * ${tr});
      }`,
    );
    shader.fragmentShader = fs;
  });
}
