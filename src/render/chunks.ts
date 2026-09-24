/**
 * Global shader-chunk tweaks (DESIGN pillar 14). Applied once at import, before any program is built.
 *
 * Point / spot light loop: three runs the full BRDF (RE_Direct) for every forward light on every lit
 * fragment, even when the light contributes exactly nothing there (beyond its `distance` cutoff, or
 * a lamp at intensity 0 in daylight that the light budget keeps in its slot so the shader permutation
 * never changes). `directLight.visible` is already `color != 0`; branching on it skips only zero
 * contributions, so the image is bit-identical while most fragments skip most of the 8 unrolled BRDFs.
 */
import * as THREE from 'three';

const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
const CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

function skipDarkLights(src: string): string {
  // Only the point + spot loops (the first two calls); directional / sun lights are always lit.
  let out = src;
  let from = 0;
  for (let k = 0; k < 2; k++) {
    const i = out.indexOf(CALL, from);
    if (i < 0) return src; // three changed: leave the chunk untouched
    const wrapped = `if ( directLight.visible ) { ${CALL} }`;
    out = out.slice(0, i) + wrapped + out.slice(i + CALL.length);
    from = i + wrapped.length;
  }
  return out;
}

const on = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('lightskip') !== '0';
  } catch {
    return true;
  }
})();
if (on && chunks.lights_fragment_begin) chunks.lights_fragment_begin = skipDarkLights(chunks.lights_fragment_begin);
