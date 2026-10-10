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

/**
 * Perf g14: directional lights at exactly zero colour skip their shadow lookup (5 PCF taps) and BRDF.
 * The mine keeps the sun in its slot at intensity 0 (constant light layout = no recompiles), so every
 * lit fragment underground paid for a sun that adds nothing. `directionalLights[i].color` is a
 * uniform, so the branch is uniform per draw (no divergence) and the image is bit-identical
 * (0 x shadow + 0 irradiance). `?dirskip=0` keeps the old always-on loop (A/B only).
 */
function skipDarkDirLights(src: string): string {
  const INFO = 'getDirectionalLightInfo( directionalLight, directLight );';
  const i = src.indexOf(INFO);
  const j = i < 0 ? -1 : src.indexOf(CALL, i);
  if (i < 0 || j < 0 || src.indexOf(INFO, i + 1) >= 0) return src; // three changed: leave the chunk untouched
  const a = i + INFO.length;
  const b = j + CALL.length;
  return `${src.slice(0, a)}\n\t\tif ( any( notEqual( directLight.color, vec3( 0.0 ) ) ) ) {${src.slice(a, b)}\n\t\t}${src.slice(b)}`;
}
const dirOn = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('dirskip') !== '0';
  } catch {
    return true;
  }
})();
if (dirOn && chunks.lights_fragment_begin) chunks.lights_fragment_begin = skipDarkDirLights(chunks.lights_fragment_begin);
