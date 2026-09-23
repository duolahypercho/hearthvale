/**
 * Cindergrove stone: smooth, weathered boulders (no faceting) and a shared "forest rock" material.
 *
 *  - smoothRock(): a welded icosphere pushed around by layered 3D noise, softly terraced (bedding
 *    planes), one or two gently rounded cleavage faces, a flattened / sunk base, smooth normals and
 *    baked vertex AO (contact rim + crevices).
 *  - forestRockMaterial(): broad triplanar value variation + speckle, faint bedding lines, and moss
 *    driven by a world-space top-facing blend with fbm breakup (never per-face patches); winter snow
 *    and rain gloss come from worldfx. The same palette is used for the cliff strata so rocks and
 *    cliffs read as one stone.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { applyPaintedLight } from './foliage';

/** Seasonal moss tint shared by rocks, logs and cliff ledges (linear colour, mutated in place). */
export const forestMoss = { value: new THREE.Color(0x5a8f28) };
const MOSS: Record<string, number> = { spring: 0x6f9e2c, summer: 0x5a8f28, fall: 0x8a8a2c, winter: 0x5f6f3a };
export function setForestMossSeason(season: string): void {
  forestMoss.value.setHex(MOSS[season] ?? MOSS.summer!);
}

export interface RockOpts {
  /** Horizontal stretch (1 = round). */
  elong?: number;
  /** Height relative to the radius (default 0.72). */
  squash?: number;
  /** Surface roughness of the silhouette (default 0.22). */
  lumpy?: number;
  /** Detail level of the base icosphere (default 3). */
  detail?: number;
  /** Bedding-plane terracing strength (default 0.5). */
  strata?: number;
}

/** Smooth weathered boulder, origin at the ground-contact centre, sitting ~0.12 r into the ground. */
export function smoothRock(rng: Rng, radius: number, o: RockOpts = {}): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, o.detail ?? 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const n1 = new Noise2D(Math.floor(rng.next() * 1e9));
  const n2 = new Noise2D(Math.floor(rng.next() * 1e9));
  const elong = o.elong ?? 0.85 + rng.next() * 0.45;
  const squash = o.squash ?? 0.66 + rng.next() * 0.14;
  const lumpy = o.lumpy ?? 0.22;
  const strata = o.strata ?? 0.5;
  const planes: { n: THREE.Vector3; d: number }[] = [];
  const np = 1 + rng.int(0, 1);
  for (let i = 0; i < np; i++) {
    const a = rng.next() * Math.PI * 2;
    const el = i === 0 ? 1.0 + rng.next() * 0.4 : 0.2 + rng.next() * 0.5;
    planes.push({ n: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), d: 0.72 + rng.next() * 0.12 });
  }
  const tilt = (rng.next() - 0.5) * 0.5;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    const nz = n1.get(p.x * 1.3 + p.z * 0.6, p.y * 1.3 - p.z * 0.4) * 0.65 + n2.get(p.x * 2.9 - p.y, p.z * 2.9 + p.y) * 0.35;
    let r = 1 + lumpy * nz;
    p.multiplyScalar(r);
    // Rounded cleavage faces: pull past-the-plane points back with a soft knee (no hard facet).
    for (const pl of planes) {
      const t = p.dot(pl.n) - pl.d;
      if (t > -0.12) {
        const k = t + 0.12;
        p.addScaledVector(pl.n, -(k * k) / (k + 0.12) * 0.85);
      }
    }
    // Flat, sunk base.
    if (p.y < -0.35) p.y = -0.35 + (p.y + 0.35) * 0.15;
    p.x *= elong;
    p.z /= Math.sqrt(elong);
    p.y *= squash;
    // Bedding planes: gentle terraces along a tilted axis.
    const s = p.y + p.x * tilt;
    p.y += Math.sin(s * 9.0) * 0.018 * strata;
    r = radius;
    pos.setXYZ(i, p.x * r, p.y * r + 0.12 * radius * squash, p.z * r);
  }
  g.computeVertexNormals();
  // Vertex AO: dark contact rim, lighter crown, darker concave spots (normal vs. radial direction).
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const nn = new THREE.Vector3();
  const top = radius * squash * 1.1;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nor, i);
    const h = THREE.MathUtils.clamp(p.y / top, 0, 1);
    const radial = p.clone().setY(p.y - top * 0.3).normalize();
    const cav = THREE.MathUtils.clamp(nn.dot(radial), 0, 1);
    const a = (0.45 + 0.55 * THREE.MathUtils.smoothstep(h, 0.0, 0.5)) * (0.78 + 0.22 * cav);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return g.toNonIndexed();
}

/** Shared stone shading (triplanar value noise + bedding lines + speckle) as GLSL, sets `vec3 hvStone`. */
export const STONE_GLSL = /* glsl */ `
vec3 hvStoneColor(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(3.0));
  w /= (w.x + w.y + w.z);
  float bx = hvFbm(p.zy * vec2(0.45, 0.9));
  float by = hvFbm(p.xz * 0.45);
  float bz = hvFbm(p.xy * vec2(0.45, 0.9));
  float broad = bx * w.x + by * w.y + bz * w.z;
  float sx = hvNoise(p.zy * 6.0);
  float sy = hvNoise(p.xz * 6.0);
  float sz = hvNoise(p.xy * 6.0);
  float speck = sx * w.x + sy * w.y + sz * w.z;
  // Warm grey with cooler blue-grey and ochre drifts.
  // (linear albedo: ~0.45-0.55 in sRGB)
  vec3 c = mix(vec3(0.16, 0.15, 0.135), vec3(0.25, 0.235, 0.21), smoothstep(0.3, 0.75, broad));
  c = mix(c, vec3(0.16, 0.18, 0.2), smoothstep(0.55, 0.85, hvNoise(p.xz * 0.21 + p.y * 0.3)) * 0.5);
  c = mix(c, vec3(0.27, 0.21, 0.14), smoothstep(0.6, 0.9, hvNoise(p.xz * 0.17 - p.y * 0.2 + 7.0)) * 0.35);
  c *= 0.9 + 0.16 * speck;
  // Bedding lines (thin darker seams, wobbling).
  float bed = abs(fract(p.y * 1.35 + hvNoise(p.xz * 0.6) * 0.5) - 0.5);
  c *= 1.0 - smoothstep(0.06, 0.0, bed) * 0.22 * (1.0 - w.y);
  return c;
}
`;

let _rock: THREE.MeshStandardMaterial | null = null;
export function forestRockMaterial(): THREE.MeshStandardMaterial {
  if (_rock) return _rock;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, color: 0xffffff });
  m.name = 'forestRock';
  applyWorldFx(m, { snowUp: 0.5 });
  patchMaterial(m, 'forest-rock', (shader) => {
    shader.uniforms.uMossC = forestMoss;
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', 'uniform vec3 uMossC;\n' + STONE_GLSL);
    // Runs right after worldfx declares hvSnowAmt, i.e. before the snow blend (snow covers the moss).
    fs = after(
      fs,
      'float hvSnowAmt = 0.0;',
      /* glsl */ `
      {
        vec3 hvN = normalize(vHvWorldNormal);
        vec3 hvP = vHvWorldPos;
        diffuseColor.rgb *= hvStoneColor(hvP, hvN) * 1.05;
        // Moss: top-facing, broken up by world fbm, creeping a little down the damp north side.
        float mb = hvFbm(hvP.xz * 0.9 + hvP.y * 0.4);
        float mf = hvNoise(hvP.xz * 7.0 + hvP.y * 3.0);
        float moss = smoothstep(0.4, 0.75, hvN.y + (mb - 0.5) * 1.1 - 0.1 + max(-hvN.z, 0.0) * 0.18);
        moss *= 0.75 + 0.25 * mf;
        vec3 mc = uMossC * (0.62 + 0.55 * mb) * (0.85 + 0.3 * mf);
        diffuseColor.rgb = mix(diffuseColor.rgb, mc, moss * 0.9);
        hvRockMoss = moss;
      }`,
    );
    fs = after(fs, 'void main() {', 'float hvRockMoss = 0.0;');
    fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, 0.95, hvRockMoss);');
    shader.fragmentShader = fs;
  });
  applyPaintedLight(m, 0.55);
  _rock = m;
  return m;
}
