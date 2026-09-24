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
}

/** Smooth sea-worn boulder of `radius`, origin at the ground-contact centre (base at y ≈ 0). */
export function beachRockGeometry(rng: Rng, radius: number, o: BeachRockOpts = {}): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, o.detail ?? (radius > 1.1 ? 3 : 2));
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
  const planes: { n: THREE.Vector3; d: number }[] = [];
  const np = 1 + (rng.next() < 0.6 ? 1 : 0);
  for (let i = 0; i < np; i++) {
    const a = rng.next() * Math.PI * 2;
    const el = i === 0 ? 0.25 + rng.next() * 0.5 : -0.1 + rng.next() * 0.5;
    planes.push({ n: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), d: 0.58 + rng.next() * 0.16 });
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
      if (k > 0) v.addScaledVector(pl.n, -k * 0.92);
    }
    v.x *= elong;
    v.y *= squash;
    // Tabular top (wave-planed) + a flat, slightly flared base.
    if (v.y > squash * 0.62) v.y = squash * 0.62 + (v.y - squash * 0.62) * 0.45;
    if (v.y < -squash * 0.25) v.y = -squash * 0.25 + (v.y + squash * 0.25) * 0.15;
    pos.setXYZ(i, v.x * radius, (v.y + squash * 0.25 - 0.06) * radius, v.z * radius);
  }
  g.computeVertexNormals();
  // Vertex AO: dark contact rim at the base, darker hollows (low displacement), lighter bulges.
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    const base = THREE.MathUtils.smoothstep(y, -0.05, 0.28);
    const hollow = THREE.MathUtils.clamp(0.82 + disp[i]! * 0.9, 0.6, 1.08);
    const k = (0.55 + 0.45 * base) * hollow;
    col[i * 3] = k;
    col[i * 3 + 1] = k;
    col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  return g;
}

const rockMats: Partial<Record<'rock' | 'shelf', THREE.MeshStandardMaterial>> = {};

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
  patchMaterial(m, shelf ? 'beach-rock-shelf' : 'beach-rock', (shader) => {
    shader.uniforms.uBRGranite = { value: t.map };
    shader.uniforms.uBRTide = ROCK_TIDE;
    shader.uniforms.uBRTime = globalUniforms.uTime;
    shader.uniforms.uBRMoss = globalUniforms.uSeasonW;
    // uv.x = 1 - moss amount (0 = full moss, the default), uv.y = extra wetness (pool rims).
    let vs = before(shader.vertexShader, 'void main() {', 'varying vec3 vBRW;\nvarying vec3 vBRN;\nvarying vec2 vBRK;');
    vs = after(vs, '#include <worldpos_vertex>', 'vBRW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBRN = normalize(mat3(modelMatrix) * objectNormal);\nvBRK = vec2(1.0 - uv.x, uv.y);');
    shader.vertexShader = vs;
    let fs = before(
      shader.fragmentShader,
      'void main() {',
      /* glsl */ `
      ${shelf ? '#define BR_SHELF' : ''}
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
      float brHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float brNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(brHash(i), brHash(i + vec2(1.0, 0.0)), f.x), mix(brHash(i + vec2(0.0, 1.0)), brHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }`,
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
        float broad = brNoise(vBRW.xz * 0.35 + vBRW.y * 0.2);
        vec3 stone = mix(vec3(0.19, 0.175, 0.16), vec3(0.33, 0.3, 0.26), broad);
        stone = mix(stone, stone * vec3(1.08, 0.98, 0.9), smoothstep(0.55, 0.8, brNoise(vBRW.xz * 0.9 + 4.0)));
        // Big warm / cool slabs (ochre-stained vs blue-grey) so a wide shelf never reads as one flat grey.
        float slab = brNoise(vBRW.xz * 0.16 + 21.0);
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
        float up = smoothstep(0.55, 0.85, N.y);
        float breakup = smoothstep(0.38, 0.62, n1 * 0.65 + n2 * 0.35);
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
        // Sea-dark and saturated when wet; sun-bleached on the dry tops.
        diffuseColor.rgb *= mix(1.0, 0.5, wet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.1, 1.02), smoothstep(0.7, 0.95, N.y) * (1.0 - wet) * (1.0 - moss));
        #ifdef BR_SHELF
        {
          vec2 q = vBRW.xz;
          vec2 wq = q + vec2(brNoise(q * 0.3), brNoise(q * 0.3 + 7.0)) * 2.4;
          // Sedimentary bedding: broad warm / cool bands sweeping across the slab + fine laminae.
          float u = dot(wq, vec2(0.8, 0.6));
          diffuseColor.rgb *= mix(vec3(0.94, 0.96, 1.02), vec3(1.08, 1.0, 0.9), 0.5 + 0.5 * sin(u * 1.1));
          float lam = smoothstep(0.08, 0.0, abs(fract(u * 1.7) - 0.5) - 0.42) * smoothstep(0.45, 0.7, brNoise(q * 0.5 + 3.0));
          diffuseColor.rgb *= 1.0 - lam * 0.12;
          // A few long, jagged fractures (dark hairline + a sunlit lip on one side).
          float fr = brNoise(wq * 0.55 + 11.0) + (brNoise(q * 3.0) - 0.5) * 0.06;
          float fmask = smoothstep(0.45, 0.62, brNoise(q * 0.2 + 5.0));
          float crack = smoothstep(0.022, 0.004, abs(fr - 0.5)) * fmask;
          float lip = smoothstep(0.05, 0.022, fr - 0.5) * step(0.5, fr) * fmask;
          diffuseColor.rgb *= 1.0 - crack * 0.5;
          diffuseColor.rgb *= 1.0 + lip * 0.1;
          // Weathering pockmarks: round pits with a dark floor and a light rim; a few hold water.
          vec2 pq = q * 2.2;
          vec2 pc = floor(pq);
          float ph = brHash(pc + 3.7);
          vec2 pf = fract(pq) - 0.5 - (vec2(brHash(pc), brHash(pc + 1.3)) - 0.5) * 0.5;
          float pr = mix(0.1, 0.22, brHash(pc + 9.1));
          float pd = length(pf * vec2(1.0, 1.2));
          float pit = smoothstep(pr, pr * 0.75, pd) * step(ph, 0.16) * (1.0 - moss) * smoothstep(0.6, 0.85, N.y);
          float rimP = smoothstep(pr * 1.35, pr, pd) * (1.0 - smoothstep(pr, pr * 0.8, pd)) * step(ph, 0.16) * smoothstep(0.0, -pr, pf.y) * smoothstep(0.6, 0.85, N.y);
          diffuseColor.rgb *= 1.0 - pit * 0.38;
          diffuseColor.rgb *= 1.0 + rimP * 0.15;
          float pitWater = pit * step(ph, 0.06);
          // Puddles in the dips (glossy, dark, sky-reflecting through the roughness below).
          float pudN = brNoise(q * 0.45 + 13.0) * 0.8 + brNoise(q * 2.0) * 0.2;
          float pud = smoothstep(0.7, 0.74, pudN) * smoothstep(0.85, 0.97, N.y);
          // (Darkened wet stone with a cool sky cast — a flat grey-blue fill reads as paint.)
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62 + vec3(0.04, 0.06, 0.08), pud);
          diffuseColor.rgb += vec3(0.06, 0.07, 0.07) * smoothstep(0.018, 0.0, abs(pudN - 0.712)) * smoothstep(0.85, 0.97, N.y);
          hvBRWet = max(hvBRWet, max(pud * 0.95, pitWater));
          // Pink coralline crust + mussel clumps on the wet lips (pools / sea rim).
          float lipZ = max(vBRK.y * 1.6, wet * 0.8);
          float cor = smoothstep(0.45, 0.7, brNoise(q * 3.3 + 2.0)) * smoothstep(0.2, 0.6, lipZ);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.4, 0.42) * (0.8 + 0.3 * brNoise(q * 11.0)), cor * 0.4 * smoothstep(0.45, 0.8, N.y));
          vec2 mq = q * vec2(6.0, 7.5);
          vec2 mc = floor(mq);
          vec2 mf = fract(mq) - 0.5 - (vec2(brHash(mc + 2.0), brHash(mc + 5.0)) - 0.5) * 0.4;
          float musselZ = smoothstep(0.5, 0.75, brNoise(q * 0.9 + 21.0)) * smoothstep(0.3, 0.7, lipZ) * smoothstep(0.55, 0.8, N.y);
          float mus = smoothstep(0.3, 0.2, length(mf * vec2(1.0, 1.5))) * step(brHash(mc + 8.0), 0.4) * musselZ;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.04, 0.05, 0.08), vec3(0.16, 0.2, 0.3), smoothstep(0.0, -0.2, mf.y)), mus * 0.7);
          hvBRWet = max(hvBRWet, mus * 0.7);
        }
        #endif
      }`,
    );
    fs = after(fs, '#include <roughnessmap_fragment>', shelf ? 'roughnessFactor = mix(roughnessFactor, 0.16, hvBRWet);' : 'roughnessFactor = mix(roughnessFactor, 0.4, hvBRWet);');
    shader.fragmentShader = fs;
  });
  applyWorldFx(m, { snowUp: 0.62 });
  rockMats[kind] = m;
  return m;
}

/** A boulder in world coords (base centre at x,y,z), rotated about Y. */
export function addBeachRock(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, radius: number, o: BeachRockOpts = {}, rotY = rng.next() * Math.PI * 2): void {
  const g = beachRockGeometry(rng, radius, o);
  // A little random tilt (rocks never all sit level).
  const e = new THREE.Euler((rng.next() - 0.5) * 0.4, rotY, (rng.next() - 0.5) * 0.4, 'YXZ');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
  b.add(beachRockMaterial(), g, m, { tint: new THREE.Color(1, 1, 1).multiplyScalar(0.9 + rng.next() * 0.2) });
}
