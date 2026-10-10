/**
 * Driftsand coastal stone: smooth, sea-worn boulders (no facets) and the shared "beach rock"
 * material used by the boulders, the groyne and the tide-pool shelf.
 *
 *  - beachRockGeometry(): welded icosphere pushed around by layered noise (2 octaves), flattened
 *    base, a gently tabular top, smooth vertex normals; vertex AO baked (contact rim + hollows).
 *  - beachRockMaterial(): world-space triplanar granite detail; moss / weed on up-facing faces above
 *    the tide (normal.y > 0.6, broken up by noise); a dark, glossy wet band below the tide line with
 *    a crust of pale barnacles along its top edge; sun-bleached dry tops. Rain gloss / snow come from
 *    worldfx like every outdoor material.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { textures } from '../../render/textures';
import { globalUniforms } from '../../render/uniforms';
import type { MeshBuilder } from '../geom';

/** Height (world y) of the wet band's top edge on beach stone (spray + high tide). */
export const ROCK_TIDE = { value: 0.34 };

export interface BeachRockOpts {
  elong?: number;
  squash?: number;
  detail?: number;
  lumpy?: number;
  /** 0 = smooth normals, 1 = hard facets (default 0.72). */
  facet?: number;
  /** Colour multiplier (e.g. warm sandstone rubble on the tide-pool shelf). */
  tint?: number;
}

/** Smooth sea-worn boulder of `radius`, origin at the ground-contact centre (base at y ≈ 0). */
export function beachRockGeometry(rng: Rng, radius: number, o: BeachRockOpts = {}): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, o.detail ?? (radius > 1.1 ? 2 : 1));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const n1 = new Noise2D(Math.floor(rng.next() * 1e9));
  const n2 = new Noise2D(Math.floor(rng.next() * 1e9));
  const elong = o.elong ?? 0.85 + rng.next() * 0.5;
  const squash = o.squash ?? 0.55 + rng.next() * 0.2;
  const lumpy = o.lumpy ?? 0.26;
  // One or two cleavage planes: broad, slightly rounded flat faces so it reads as broken stone,
  // not a smooth blob.
  // Three to five broad cleavage planes (spread round the stone) cut it into a chunky, faceted block
  // with softly chipped edges: broken coastal stone, never a smooth clay blob.
  const planes: { n: THREE.Vector3; d: number }[] = [];
  const np = 3 + rng.int(0, 2);
  const a0 = rng.next() * Math.PI * 2;
  for (let i = 0; i < np; i++) {
    const a = a0 + (i / np) * Math.PI * 2 + (rng.next() - 0.5) * 0.9;
    const el = i === 0 ? 0.55 + rng.next() * 0.4 : -0.15 + rng.next() * 0.55;
    planes.push({ n: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), d: 0.5 + rng.next() * 0.2 });
  }
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const disp = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Two octaves of "3D" noise from two planar projections.
    const a = n1.fbm(v.x * 1.3 + v.z * 0.4 + 3, v.y * 1.3 + v.z * 0.9, 2);
    const b = n2.fbm(v.x * 3.1 - v.y * 0.7, v.z * 3.1 + v.y * 0.5 + 7, 2);
    const d = 1 + a * lumpy + b * lumpy * 0.35;
    disp[i] = a;
    v.multiplyScalar(d);
    for (const pl of planes) {
      const k = v.dot(pl.n) - pl.d;
      if (k > 0) v.addScaledVector(pl.n, -k * 0.97);
    }
    v.x *= elong;
    v.y *= squash;
    // Tabular top (wave-planed) + a flat, slightly flared base.
    if (v.y > squash * 0.62) v.y = squash * 0.62 + (v.y - squash * 0.62) * 0.45;
    if (v.y < -squash * 0.25) v.y = -squash * 0.25 + (v.y + squash * 0.25) * 0.15;
    pos.setXYZ(i, v.x * radius, (v.y + squash * 0.25 - 0.06) * radius, v.z * radius);
  }
  g.computeVertexNormals();
  // Curvature from the mesh Laplacian (neighbour mean minus the vertex, along its normal): chipped
  // convex edges catch light, creases and cavities go dark (baked into the vertex AO below).
  const idx = g.index!;
  const nsum = new Float32Array(pos.count * 3);
  const ncnt = new Uint16Array(pos.count);
  for (let f = 0; f < idx.count; f += 3) {
    const tri = [idx.getX(f), idx.getX(f + 1), idx.getX(f + 2)];
    for (let e = 0; e < 3; e++) {
      const i0 = tri[e]!;
      for (const j of [tri[(e + 1) % 3]!, tri[(e + 2) % 3]!]) {
        nsum[i0 * 3] += pos.getX(j);
        nsum[i0 * 3 + 1] += pos.getY(j);
        nsum[i0 * 3 + 2] += pos.getZ(j);
        ncnt[i0]++;
      }
    }
  }
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const curv = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const c = ncnt[i] || 1;
    const lx = nsum[i * 3]! / c - pos.getX(i);
    const ly = nsum[i * 3 + 1]! / c - pos.getY(i);
    const lz = nsum[i * 3 + 2]! / c - pos.getZ(i);
    // > 0: convex (neighbours sit below the tangent plane) → edge; < 0: concave → cavity.
    curv[i] = -(lx * nrm.getX(i) + ly * nrm.getY(i) + lz * nrm.getZ(i)) / radius;
  }
  // Vertex AO: dark contact rim at the base, darker hollows (low displacement), lighter bulges,
  // bright chipped edges and dark cavities.
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    const base = THREE.MathUtils.smoothstep(y, -0.05, 0.28);
    const hollow = THREE.MathUtils.clamp(0.82 + disp[i]! * 0.9, 0.6, 1.08);
    const edge = THREE.MathUtils.clamp(curv[i]! * 9, -0.45, 0.3);
    const k = (0.55 + 0.45 * base) * hollow * (1 + edge);
    // Wind-blown sand dusting the foot and settled in the low hollows (warm, a touch lighter), so the
    // stone sits *in* the beach rather than on it.
    const dust = (1 - THREE.MathUtils.smoothstep(y, 0.04, 0.3)) * 0.55 + THREE.MathUtils.clamp(-disp[i]! * 0.8, 0, 0.25);
    col[i * 3] = k * (1 + dust * 0.32);
    col[i * 3 + 1] = k * (1 + dust * 0.16);
    col[i * 3 + 2] = k * (1 - dust * 0.08);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  // Faceted, chipped stone: split the faces and lean every normal most of the way to its face's
  // own normal (flat-ish planes with a soft roll at the edges) — reads as broken rock, not clay.
  const flat = o.facet ?? 0.72;
  if (flat <= 0) return g;
  const ng = g.toNonIndexed();
  const p2 = ng.attributes.position as THREE.BufferAttribute;
  const nA = ng.attributes.normal as THREE.BufferAttribute;
  const c2 = ng.attributes.color as THREE.BufferAttribute;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const fnm = new THREE.Vector3();
  const sn = new THREE.Vector3();
  for (let f = 0; f < p2.count; f += 3) {
    va.fromBufferAttribute(p2, f);
    vb.fromBufferAttribute(p2, f + 1);
    vc.fromBufferAttribute(p2, f + 2);
    fnm.subVectors(vc, vb).cross(va.clone().sub(vb)).normalize();
    // Facet shade: faces turned up / to the sun-side read a touch lighter, steep undercuts darker.
    const shade = 0.94 + fnm.y * 0.08;
    for (let k = 0; k < 3; k++) {
      sn.fromBufferAttribute(nA, f + k).lerp(fnm, flat).normalize();
      nA.setXYZ(f + k, sn.x, sn.y, sn.z);
      c2.setXYZ(f + k, c2.getX(f + k) * shade, c2.getY(f + k) * shade, c2.getZ(f + k) * shade);
    }
  }
  g.dispose();
  return ng;
}

const rockMats: Partial<Record<'rock' | 'shelf', THREE.MeshStandardMaterial>> = {};

/** The rock shader's own tiny sin-hash value noise (worldfx may or may not have injected hvNoise). */
const BR_NOISE_GLSL = /* glsl */ `
      float brHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float brNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(brHash(i), brHash(i + vec2(1.0, 0.0)), f.x), mix(brHash(i + vec2(0.0, 1.0)), brHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }`;
/** BR_VN: the shelf's broad noise fields come per vertex (off under ?rockfast=0, i.e. BR_NOGATE). */
const BR_VN_DEFS = /* glsl */ `
      #if defined(BR_SHELF) && !defined(BR_NOGATE)
      #define BR_VN
      #define BR_VN_OR(v, f) (v)
      #else
      #define BR_VN_OR(v, f) (f)
      #endif`;

function rockFast(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('rockfast');
    return !(q === '0' || q === 'false');
  } catch {
    return true;
  }
}

/**
 * `shelf`: the flat tide-pool slab variant — soft granite grain only (at slab scale its crack cells
 * read as crazy paving), plus sweeping sedimentary bedding, a few long jagged fractures, weathering
 * pockmarks (some holding water), glossy spray puddles in the dips, pink coralline crust and
 * mussel clumps round the wet pool lips.
 */
export function beachRockMaterial(kind: 'rock' | 'shelf' = 'rock'): THREE.MeshStandardMaterial {
  const cached = rockMats[kind];
  if (cached) return cached;
  const shelf = kind === 'shelf';
  const t = textures.granite();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, color: 0xffffff });
  m.name = shelf ? 'beachShelf' : 'beachRock';
  // `?rockfast=0`: every shader layer pays for its noise everywhere (the pre-r19 cost; A/B only).
  if (!rockFast()) m.defines = { ...m.defines, BR_NOGATE: '' };
  patchMaterial(m, shelf ? 'beach-rock-shelf' : 'beach-rock', (shader) => {
    shader.uniforms.uBRGranite = { value: t.map };
    shader.uniforms.uBRTide = ROCK_TIDE;
    shader.uniforms.uBRTime = globalUniforms.uTime;
    shader.uniforms.uBRMoss = globalUniforms.uSeasonW;
    // uv.x = 1 - moss amount (0 = full moss, the default), uv.y = extra wetness (pool rims).
    let vs = before(shader.vertexShader, 'void main() {', 'varying vec3 vBRW;\nvarying vec3 vBRN;\nvarying vec2 vBRK;');
    vs = after(vs, '#include <worldpos_vertex>', 'vBRW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBRN = normalize(mat3(modelMatrix) * objectNormal);\nvBRK = vec2(1.0 - uv.x, uv.y);');
    if (shelf) {
      // Perf r19 (BR_VN): the slab's broad noise fields (2-6 m cells: tone, warm / cool slabs, the
      // bedding warp, laminae, fracture, puddle and pit zones) per vertex on its 0.2 m grid — linear
      // interpolation of a smooth field across 1/10-1/30 of a cell. ?rockfast=0 keeps them per pixel.
      vs = before(vs, 'void main() {', `#define BR_SHELF\n${BR_VN_DEFS}\n${BR_NOISE_GLSL}\n#ifdef BR_VN\nvarying vec4 vBRL0;\nvarying vec4 vBRL1;\n#endif`);
      vs = after(
        vs,
        'vBRK = vec2(1.0 - uv.x, uv.y);',
        /* glsl */ `#ifdef BR_VN
        vBRL0 = vec4(brNoise(vBRW.xz * 0.35 + vBRW.y * 0.2), brNoise(vBRW.xz * 0.16 + 21.0), brNoise(vBRW.xz * 0.3), brNoise(vBRW.xz * 0.3 + 7.0));
        vBRL1 = vec4(brNoise(vBRW.xz * 0.5 + 3.0), brNoise(vBRW.xz * 0.2 + 5.0), brNoise(vBRW.xz * 0.3 + 2.0), brNoise(vBRW.xz * 0.35 + 17.0));
        #endif`,
      );
    }
    shader.vertexShader = vs;
    let fs = before(
      shader.fragmentShader,
      'void main() {',
      /* glsl */ `
      ${shelf ? '#define BR_SHELF' : ''}
      ${BR_VN_DEFS}
      #ifdef BR_VN
      varying vec4 vBRL0;
      varying vec4 vBRL1;
      #endif
      varying vec3 vBRW;
      varying vec3 vBRN;
      varying vec2 vBRK;
      uniform sampler2D uBRGranite;
      uniform float uBRTide;
      uniform float uBRTime;
      uniform vec4 uBRMoss;
      float hvBRWet = 0.0;
      `,
    );
    // Own tiny value noise (worldfx may or may not have injected hvNoise already).
    fs = before(
      fs,
      'void main() {',
      /* glsl */ `
      #ifdef BR_NOGATE
      #define BR_IF(c) if (true)
      #else
      #define BR_IF(c) if (c)
      #endif
      ${BR_NOISE_GLSL}`,
    );
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 N = normalize(vBRN);
        vec3 bw = pow(abs(N), vec3(4.0));
        bw /= dot(bw, vec3(1.0));
        vec3 P = vBRW * 0.45;
        vec3 gx = texture2D(uBRGranite, P.zy).rgb;
        vec3 gy = texture2D(uBRGranite, P.xz).rgb;
        vec3 gz = texture2D(uBRGranite, P.xy).rgb;
        vec3 gr = gx * bw.x + gy * bw.y + gz * bw.z;
        #ifdef BR_SHELF
        gr = mix(vec3(1.0), gr, 0.3);
        #endif
        // Warm sandstone-grey base with broad tonal variation.
        float broad = BR_VN_OR(vBRL0.x, brNoise(vBRW.xz * 0.35 + vBRW.y * 0.2));
        vec3 stone = mix(vec3(0.19, 0.175, 0.16), vec3(0.33, 0.3, 0.26), broad);
        stone = mix(stone, stone * vec3(1.08, 0.98, 0.9), smoothstep(0.55, 0.8, brNoise(vBRW.xz * 0.9 + 4.0)));
        // Big warm / cool slabs (ochre-stained vs blue-grey) so a wide shelf never reads as one flat grey.
        float slab = BR_VN_OR(vBRL0.y, brNoise(vBRW.xz * 0.16 + 21.0));
        stone *= mix(vec3(0.9, 0.95, 1.04), vec3(1.14, 1.02, 0.86), smoothstep(0.3, 0.75, slab));
        diffuseColor.rgb *= stone * (0.4 + 0.8 * gr);
        float y = vBRW.y;
        float n1 = brNoise(vBRW.xz * 2.3 + vBRW.y * 1.7);
        float n2 = brNoise(vBRW.xz * 7.1 - vBRW.y * 3.0);
        // Wet band (+ its ragged top edge).
        float edge = uBRTide + (n1 - 0.5) * 0.16;
        float wet = max(1.0 - smoothstep(edge - 0.08, edge + 0.05, y), vBRK.y);
        hvBRWet = wet;
        // Weed / moss on up-facing faces: green-olive above the tide, dark kelp-green in the wet.
        float up = smoothstep(0.6, 0.88, N.y);
        #ifdef BR_SHELF
        float breakup = smoothstep(0.38, 0.62, n1 * 0.65 + n2 * 0.35);
        #else
        // Boulders: lichen / moss only as small ragged rosettes on the up-facing tops (~20 % cover),
        // clustered where a broad noise allows it, plus a thin green fringe in the hollows by the tide.
        vec2 rq = (vBRW.xz + vBRW.y * 0.3) * 3.2;
        vec2 rc = floor(rq);
        vec2 rf = fract(rq) - 0.5 - (vec2(brHash(rc + 1.7), brHash(rc + 8.3)) - 0.5) * 0.5;
        float rr = mix(0.16, 0.36, brHash(rc + 4.4)) * (0.7 + 0.6 * n2);
        float breakup = smoothstep(rr, rr * 0.6, length(rf)) * step(brHash(rc + 13.1), 0.42) * smoothstep(0.35, 0.6, n1);
        #endif
        float moss = up * breakup * vBRK.x;
        vec3 mossDry = mix(vec3(0.33, 0.4, 0.14), vec3(0.45, 0.47, 0.2), n2);
        mossDry = mix(mossDry, vec3(0.5, 0.42, 0.18), uBRMoss.z * 0.6);
        vec3 weedWet = mix(vec3(0.1, 0.17, 0.07), vec3(0.18, 0.24, 0.08), n2);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(mossDry, weedWet, wet) * (0.75 + 0.35 * n2), moss * mix(0.8, 0.9, wet) * step(0.001, y - edge + 0.35));
        // Barnacle crust just above and at the tide line: pale speckles.
        vec2 bq = vec2(vBRW.x + vBRW.z * 0.7, vBRW.y * 1.3 + vBRW.z * 0.3) * 10.0;
        vec2 bc = floor(bq);
        float bd = length(fract(bq) - 0.5 - (vec2(brHash(bc), brHash(bc + 3.1)) - 0.5) * 0.5);
        float band = smoothstep(edge - 0.32, edge - 0.08, y) * (1.0 - smoothstep(edge + 0.02, edge + 0.22, y));
        float barn = smoothstep(0.22, 0.12, bd) * step(brHash(bc + 7.7), 0.45) * band * (1.0 - moss * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.69, 0.62), barn * 0.75);
        #ifndef BR_SHELF
        {
          // Crustose lichen on the dry, sunlit stone: pale grey-white rosettes and a few sulphur /
          // orange crusts (well above the spray line), plus dark weathering streaks down the sides.
          float dryK = smoothstep(edge + 0.25, edge + 0.6, y) * smoothstep(0.2, 0.7, N.y);
          // (Sparse, ragged, clustered where a broad noise allows: never an even polka-dot field.)
          vec2 lq = (vBRW.xz + vBRW.y * 0.5) * 2.6;
          vec2 lc = floor(lq);
          float lh = brHash(lc + 2.9);
          // (Perf r19: the rosette's zone noise only where a rosette can land, the streak noise only on
          // the steep sides — skipped layers mixed by 0.0, same output.)
          BR_IF(dryK > 0.0 && lh <= 0.3 && moss < 1.0) {
            float lr = mix(0.14, 0.34, brHash(lc + 6.1));
            float ld = length((fract(lq) - 0.5 - (vec2(brHash(lc + 0.7), brHash(lc + 5.3)) - 0.5) * 0.5) * vec2(1.0, 1.4));
            float zone = smoothstep(0.5, 0.72, brNoise(vBRW.xz * 0.6 + 13.0));
            float spot = smoothstep(lr, lr * 0.55, ld + (n2 - 0.5) * 0.22) * step(lh, 0.3) * dryK * (1.0 - moss) * zone;
            vec3 lichen = lh < 0.08 ? vec3(0.78, 0.56, 0.24) : lh < 0.15 ? vec3(0.7, 0.68, 0.38) : vec3(0.62, 0.62, 0.56);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4 + lichen * 0.6 * (0.85 + 0.2 * n1), spot * 0.55);
          }
          float steep = 1.0 - smoothstep(0.3, 0.7, N.y);
          BR_IF(steep > 0.0) {
            float streak = smoothstep(0.55, 0.85, brNoise(vec2((vBRW.x + vBRW.z) * 3.0, vBRW.y * 0.4))) * steep;
            diffuseColor.rgb *= 1.0 - streak * 0.22 * (1.0 - wet);
          }
        }
        #endif
        // Sea-dark and saturated when wet; sun-bleached on the dry tops.
        diffuseColor.rgb *= mix(1.0, 0.5, wet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.1, 1.02), smoothstep(0.7, 0.95, N.y) * (1.0 - wet) * (1.0 - moss));
        #ifdef BR_SHELF
        {
          vec2 q = vBRW.xz;
          // A touch darker and warmer than the boulders (sandstone, not concrete).
          diffuseColor.rgb *= vec3(0.94, 0.89, 0.82);
          // (Perf r19: every layer below pays for its noise only where its weight can be > 0 —
          // BR_IF(c) is if (c), or if (true) under ?rockfast=0. A skipped layer would have multiplied
          // by 1.0 / mixed by 0.0, so the output is the same; ~25 -> ~8 value-noise calls on most
          // of the slab.)
          // Bedding-plane striations on the ledge risers (steep faces): thin dark / light laminae.
          // (Never on the pool walls: concentric laminae round a bowl read as contour lines.)
          float riserF = (1.0 - smoothstep(0.55, 0.85, N.y)) * (1.0 - smoothstep(0.0, 0.12, vBRK.y));
          BR_IF(riserF > 0.0) {
            float bed = sin(vBRW.y * 40.0 + brNoise(q * 1.3) * 3.0);
            riserF *= smoothstep(0.3, 0.6, brNoise(q * 0.8 + vBRW.y * 2.0));
            diffuseColor.rgb *= 1.0 - riserF * (0.12 * smoothstep(0.3, 0.9, bed) - 0.05 * smoothstep(-0.2, -0.9, bed));
            diffuseColor.rgb *= 1.0 - riserF * 0.12;
          }
          vec2 wq = q + BR_VN_OR(vBRL0.zw, vec2(brNoise(q * 0.3), brNoise(q * 0.3 + 7.0))) * 2.4;
          // Sedimentary bedding: broad warm / cool bands sweeping across the slab + fine laminae.
          float u = dot(wq, vec2(0.8, 0.6));
          diffuseColor.rgb *= mix(vec3(0.94, 0.96, 1.02), vec3(1.08, 1.0, 0.9), 0.5 + 0.5 * sin(u * 1.1));
          float lam = smoothstep(0.08, 0.0, abs(fract(u * 1.7) - 0.5) - 0.42) * smoothstep(0.45, 0.7, BR_VN_OR(vBRL1.x, brNoise(q * 0.5 + 3.0)));
          diffuseColor.rgb *= 1.0 - lam * 0.12;
          // A few long, jagged fractures (dark hairline + a sunlit lip on one side).
          float fmask = smoothstep(0.45, 0.62, BR_VN_OR(vBRL1.y, brNoise(q * 0.2 + 5.0)));
          BR_IF(fmask > 0.0) {
            float fr = brNoise(wq * 0.55 + 11.0) + (brNoise(q * 3.0) - 0.5) * 0.06;
            float crack = smoothstep(0.022, 0.004, abs(fr - 0.5)) * fmask;
            float lip = smoothstep(0.05, 0.022, fr - 0.5) * step(0.5, fr) * fmask;
            diffuseColor.rgb *= 1.0 - crack * 0.5;
            diffuseColor.rgb *= 1.0 + lip * 0.1;
          }
          // Weathering pockmarks: round pits with a dark floor and a light rim; a few hold water.
          vec2 pq = q * 2.2;
          vec2 pc = floor(pq);
          float ph = brHash(pc + 3.7);
          float pitUp = smoothstep(0.6, 0.85, N.y);
          float pitWater = 0.0;
          BR_IF(ph <= 0.2 && pitUp > 0.0) {
            vec2 pf = fract(pq) - 0.5 - (vec2(brHash(pc), brHash(pc + 1.3)) - 0.5) * 0.5;
            float pr = mix(0.1, 0.22, brHash(pc + 9.1));
            float pd = length(pf * vec2(1.0, 1.2));
            // (Clustered where a broad noise allows it, not a uniform polka-dot field.)
            float pitZone = smoothstep(0.55, 0.72, BR_VN_OR(vBRL1.w, brNoise(q * 0.35 + 17.0)));
            float pit = smoothstep(pr, pr * 0.75, pd) * step(ph, 0.2) * pitZone * (1.0 - moss) * pitUp;
            float rimP = smoothstep(pr * 1.35, pr, pd) * (1.0 - smoothstep(pr, pr * 0.8, pd)) * step(ph, 0.2) * pitZone * smoothstep(0.0, -pr, pf.y) * pitUp;
            diffuseColor.rgb *= 1.0 - pit * 0.38;
            diffuseColor.rgb *= 1.0 + rimP * 0.15;
            pitWater = pit * step(ph, 0.06);
          }
          // Puddles in the dips (glossy, dark, sky-reflecting through the roughness below).
          // (Small, scattered: a puddle metres wide reads as a painted grey decal, not spray water.)
          float pud = 0.0;
          float pudUp = smoothstep(0.85, 0.97, N.y);
          BR_IF(pudUp > 0.0) {
            float pudZ = smoothstep(0.6, 0.75, BR_VN_OR(vBRL1.z, brNoise(q * 0.3 + 2.0)));
            BR_IF(pudZ > 0.0) {
              float pudN = brNoise(q * 1.3 + 13.0) * 0.8 + brNoise(q * 4.0) * 0.2;
              pud = smoothstep(0.8, 0.83, pudN) * pudZ * pudUp;
              // (Darkened wet stone with a cool sky cast — a flat grey-blue fill reads as paint.)
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62 + vec3(0.04, 0.06, 0.08), pud);
              diffuseColor.rgb += vec3(0.06, 0.07, 0.07) * smoothstep(0.018, 0.0, abs(pudN - 0.812)) * pudZ * pudUp;
            }
          }
          hvBRWet = max(hvBRWet, max(pud * 0.95, pitWater));
          // Lichen rosettes on the dry, sunlit tops (the spray zone's zonation): sparse clusters of
          // muted orange with ragged edges, never in the wet / puddles.
          float dryTop = smoothstep(edge + 0.12, edge + 0.4, y) * (1.0 - pud) * smoothstep(0.8, 0.95, N.y) * (1.0 - wet);
          vec2 lq = q * 1.5;
          vec2 lc = floor(lq);
          BR_IF(dryTop > 0.0 && brHash(lc + 12.3) <= 0.14) {
            float rosZ = smoothstep(0.55, 0.72, brNoise(q * 0.45 + 41.0));
            BR_IF(rosZ > 0.0) {
              vec2 lf = fract(lq) - 0.5 - (vec2(brHash(lc + 4.2), brHash(lc + 6.6)) - 0.5) * 0.45;
              float lr = mix(0.14, 0.3, brHash(lc + 2.9)) * (0.75 + 0.5 * brNoise(q * 9.0));
              // Ragged edge: the radius wobbles with angle-ish noise, and the inside is broken (crustose
              // lichen is never a solid disc).
              float lrr = lr * 0.7 * (0.7 + 0.6 * brNoise(lf * 9.0 + lc));
              float ros = smoothstep(lrr, lrr * 0.5, length(lf)) * step(brHash(lc + 12.3), 0.14) * rosZ * dryTop;
              ros *= 0.55 + 0.45 * smoothstep(0.35, 0.6, brNoise(q * 22.0));
              diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.62, 0.4, 0.16), vec3(0.72, 0.52, 0.22), brNoise(q * 14.0)) * (0.75 + 0.25 * brNoise(q * 30.0)), ros * 0.45);
            }
          }
          // Pink coralline crust + mussel clumps on the wet lips (pools / sea rim).
          float lipZ = max(vBRK.y * 1.6, wet * 0.8);
          // Zonation round every pool: a dark wet band at the waterline and a ragged ring of green
          // weed (≈ 10-20 cm) just above it, then the pale dry stone.
          // (Patchy, never a continuous collar: weed grows in clumps where the wash keeps it wet.)
          // (ringN in [0, 1): the ring's smoothstep is 0 for vBRK.y <= 0.22, its fade for >= 0.7.)
          BR_IF(vBRK.y > 0.22 && vBRK.y < 0.7) {
            float ringN = brNoise(q * 4.0 + 31.0);
            float weedRing = smoothstep(0.32, 0.46, vBRK.y + (ringN - 0.5) * 0.2) * (1.0 - smoothstep(0.58, 0.7, vBRK.y)) * smoothstep(0.38, 0.62, brNoise(q * 1.6 + 9.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.1, 0.19, 0.06), vec3(0.24, 0.32, 0.1), ringN) * (0.8 + 0.3 * brNoise(q * 12.0)), weedRing * 0.85);
          }
          diffuseColor.rgb *= 1.0 - smoothstep(0.6, 0.72, vBRK.y) * 0.3;
          BR_IF(lipZ > 0.2 && N.y > 0.45) {
            float cor = smoothstep(0.45, 0.7, brNoise(q * 3.3 + 2.0)) * smoothstep(0.2, 0.6, lipZ);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.4, 0.42) * (0.8 + 0.3 * brNoise(q * 11.0)), cor * 0.4 * smoothstep(0.45, 0.8, N.y));
          }
          BR_IF(lipZ > 0.3 && N.y > 0.55) {
            vec2 mq = q * vec2(6.0, 7.5);
            vec2 mc = floor(mq);
            vec2 mf = fract(mq) - 0.5 - (vec2(brHash(mc + 2.0), brHash(mc + 5.0)) - 0.5) * 0.4;
            float musselZ = smoothstep(0.5, 0.75, brNoise(q * 0.9 + 21.0)) * smoothstep(0.3, 0.7, lipZ) * smoothstep(0.55, 0.8, N.y);
            float mus = smoothstep(0.3, 0.2, length(mf * vec2(1.0, 1.5))) * step(brHash(mc + 8.0), 0.4) * musselZ;
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.04, 0.05, 0.08), vec3(0.16, 0.2, 0.3), smoothstep(0.0, -0.2, mf.y)), mus * 0.7);
            hvBRWet = max(hvBRWet, mus * 0.7);
          }
        }
        #endif
      }`,
    );
    fs = after(fs, '#include <roughnessmap_fragment>', shelf ? 'roughnessFactor = mix(roughnessFactor, 0.16, hvBRWet);' : 'roughnessFactor = mix(roughnessFactor, 0.4, hvBRWet);');
    // (r7b, critic r6: at dusk the far rock headland melted into the pink fog with no silhouette.)
    // The rocks take ~60 % of the distance fog, so they keep a dark, rim-lit shape against the haze.
    fs = fs.replace(
      '#include <fog_fragment>',
      '#ifdef USE_FOG\n  float brFog = smoothstep(fogNear, fogFar, vFogDepth) * 0.6;\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, brFog);\n#endif',
    );
    shader.fragmentShader = fs;
  });
  applyWorldFx(m, { snowUp: 0.62 });
  rockMats[kind] = m;
  return m;
}

const ROCK_HUES = [
  new THREE.Color(1.12, 1.0, 0.84),
  new THREE.Color(1.08, 0.98, 0.86),
  new THREE.Color(0.86, 0.93, 1.06),
  new THREE.Color(0.92, 0.96, 1.02),
  new THREE.Color(0.66, 0.66, 0.7),
  new THREE.Color(1.16, 0.92, 0.78),
  new THREE.Color(1.0, 1.0, 1.0),
];

/** A boulder in world coords (base centre at x,y,z), rotated about Y. */
export function addBeachRock(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, radius: number, o: BeachRockOpts = {}, rotY = rng.next() * Math.PI * 2): void {
  const g = beachRockGeometry(rng, radius, o);
  // A little random tilt (rocks never all sit level).
  const e = new THREE.Euler((rng.next() - 0.5) * 0.4, rotY, (rng.next() - 0.5) * 0.4, 'YXZ');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
  // Each stone its own mineral: warm ochre sandstone, cool blue-grey granite, a dark basalt now and
  // then, a rusty iron-stained one (a field of boulders never reads as one flat grey).
  // (One draw from the stream, as before: every later stone keeps its seeded place.)
  const v = rng.next();
  const hue = o.tint !== undefined ? new THREE.Color(o.tint) : ROCK_HUES[Math.floor(((v * 7.31) % 1) * ROCK_HUES.length)]!.clone();
  b.add(beachRockMaterial(), g, m, { tint: hue.multiplyScalar(0.88 + v * 0.24) });
}
