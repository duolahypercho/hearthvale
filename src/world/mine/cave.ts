/**
 * Cave shell for one mine floor: a single heightfield that is floor where the layout is open and
 * rises into rock where it is solid.
 *  - Back walls (floor to their south) are full-height cliffs whose faces the 3/4 camera sees;
 *    walls with floor just to their NORTH ramp up gently (a lip you look over), so the camera
 *    never loses the player behind rock.
 *  - Albedo is baked per vertex: sediment strata banded by height, damp AO at the wall feet, a
 *    lit rim along the cliff tops and a fall-off into black void deeper into the rock.
 *  - The shader adds triplanar grit, gravel specks, Voronoi cracks (glowing seams in the lava band,
 *    pale fractures in the ice band), twinkling mineral glints and biome roughness (glossy ice).
 *  - Lava channels / puddles / frozen pools are dips in the floor under one liquid plane each, so
 *    their edges are exactly as organic as the floor.
 *  - Faceted boulders along the wall feet and rims + floor pebbles break the silhouette.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { Noise2D, smoothstep, clamp } from '../../core/noise';
import { globalUniforms } from '../../render/uniforms';
import { NOISE_GLSL } from '../../render/shaders/noise';
import { patchMaterial, after, before } from '../../render/patch';
import type { FloorLayout } from './gen';
import { BIOMES } from './biomes';
import { facetRock } from './rockgeo';

const STEP = 0.2;
const MARGIN = 2;
const FULL = 3.3;

export const CAVE_GLSL = /* glsl */ `
vec2 hvMineCell(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hvHash22(i + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2(sqrt(d1), sqrt(d2));
}
// Voronoi returning F1, F2, the nearest cell's hash and the vertical offset to its centre.
vec4 hvMineStone(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  float dy = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.15 + hvHash22(i + g) * 0.7;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hvHash12(i + g + 3.7); dy = r.y; } else if (d < d2) { d2 = d; }
    }
  }
  return vec4(sqrt(d1), sqrt(d2), id, dy);
}
`;

export interface CaveBuild {
  group: THREE.Group;
  /** Walkable surface height (floor / ice / puddle surface). */
  heightAt(x: number, z: number): number;
  /** Height of the cave shell itself (rises into the walls): props test they are not buried. */
  surfaceAt(x: number, z: number): number;
  update(time: number): void;
  dispose(): void;
}

export function buildCave(L: FloorLayout, rng: Rng): CaveBuild {
  const def = BIOMES[L.biome];
  const W = L.w;
  const D = L.d;
  const noise = new Noise2D(rng.int(0, 1e9));
  const x0 = -MARGIN;
  const z0 = -MARGIN;
  const nx = Math.round((W + MARGIN * 2) / STEP) + 1;
  const nz = Math.round((D + MARGIN * 2) / STEP) + 1;
  const N = nx * nz;
  const tileSolid = (x: number, z: number): boolean => x < 0 || z < 0 || x >= W || z >= D || L.solid[z * W + x] === 1;
  const tileMask = (arr: Uint8Array, x: number, z: number): number => (x < 0 || z < 0 || x >= W || z >= D ? 0 : arr[z * W + x]!);
  /** Bilinear tile-centre sample of a 0/1 mask. */
  const maskAt = (arr: Uint8Array, px: number, pz: number): number => {
    const fx = px - 0.5;
    const fz = pz - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = tileMask(arr, ix, iz);
    const b = tileMask(arr, ix + 1, iz);
    const c = tileMask(arr, ix, iz + 1);
    const d = tileMask(arr, ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  const floorBase = (px: number, pz: number): number => {
    const n = noise.fbm(px * 0.35, pz * 0.35, 2) * 0.035 + noise.get(px * 1.7, pz * 1.7) * 0.012;
    const lava = smoothstep(0.3, 0.72, maskAt(L.lava, px, pz));
    const pool = smoothstep(0.28, 0.7, maskAt(L.pool, px, pz));
    return 0.05 + n - lava * 0.42 - pool * 0.12;
  };

  // ── signed distance to the rock boundary (tile units, + inside rock) ─────────
  const sd = new Float32Array(N);
  const hArr = new Float32Array(N);
  const wallArr = new Float32Array(N);
  const dn = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    const pz = z0 + j * STEP;
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * STEP;
      const tx = Math.floor(px);
      const tz = Math.floor(pz);
      const inWall = tileSolid(tx, tz);
      let best = 3.6;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const sx = tx + dx;
          const sz = tz + dz;
          if (tileSolid(sx, sz) === inWall) continue;
          const ex = Math.max(sx - px, 0, px - (sx + 1));
          const ez = Math.max(sz - pz, 0, pz - (sz + 1));
          const d = Math.sqrt(ex * ex + ez * ez);
          if (d < best) best = d;
        }
      }
      sd[j * nx + i] = inWall ? best : -best;
      // Distance north to open floor: how far this rock sits in front of (south of) a hall.
      let t = 0;
      if (inWall) {
        t = 4.2;
        for (let s = 0; s <= 4.2; s += 0.2) {
          if (!tileSolid(tx, Math.floor(pz - s))) {
            t = s;
            break;
          }
        }
      }
      dn[j * nx + i] = t;
    }
  }
  // Blur the "north distance" across columns so front lips don't step per tile.
  const dnB = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      let w = 0;
      for (let k = -3; k <= 3; k++) {
        const ii = Math.min(nx - 1, Math.max(0, i + k));
        const wk = 4 - Math.abs(k);
        s += dn[j * nx + ii]! * wk;
        w += wk;
      }
      dnB[j * nx + i] = s / w;
    }
  }

  // ── heights + baked albedo ─────────────────────────────────────
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const aWall = new Float32Array(N);
  const aVoid = new Float32Array(N);
  const aLava = new Float32Array(N);
  const aCrest = new Float32Array(N);
  const strata = def.strata.map((h) => new THREE.Color(h));
  const fl0 = new THREE.Color(def.floor[0]);
  const fl1 = new THREE.Color(def.floor[1]);
  const fl2 = new THREE.Color(def.floor[2]);
  const c = new THREE.Color();
  const cw = new THREE.Color();
  const ember = new THREE.Color(0xff5a1a);
  const frost = new THREE.Color(0xf2f8ff);
  for (let j = 0; j < nz; j++) {
    const pz = z0 + j * STEP;
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * STEP;
      const k = j * nx + i;
      const s = sd[k]!;
      const jit = noise.get(px * 0.7 + 11, pz * 0.7) * 0.3 + noise.get(px * 2.1, pz * 2.1 + 5) * 0.1;
      const w = smoothstep(-0.1, 0.62, s + jit);
      const cap = Math.min(FULL, 0.5 + dnB[k]! * 0.76);
      const bumps = noise.fbm(px * 0.45 + 3, pz * 0.45, 3) * 0.45 * smoothstep(0.4, 1.6, s);
      const fh = floorBase(px, pz);
      const top = cap + bumps;
      const h = fh * (1 - w) + w * top;
      hArr[k] = h;
      wallArr[k] = w;
      pos[k * 3] = px;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = pz;

      // Floor albedo: two-tone dirt, damp + darker at the wall feet, pools darker still.
      const fn = noise.fbm(px * 0.22 + 7, pz * 0.22, 3) * 0.5 + 0.5;
      c.copy(fl0).lerp(fl1, clamp(fn * 1.2 - 0.1));
      const near = 1 - smoothstep(-1.3, -0.05, s);
      c.lerp(fl2, (1 - near) * 0.35 + 0 * near);
      const damp = smoothstep(-1.1, -0.05, s);
      c.lerp(fl2, damp * 0.45);
      c.multiplyScalar(0.62 + 0.38 * (1 - smoothstep(-0.9, -0.02, s)));
      const pm = maskAt(L.pool, px, pz);
      if (pm > 0.05) c.lerp(fl2, smoothstep(0.1, 0.6, pm) * 0.5);
      const lm = maskAt(L.lava, px, pz);
      aLava[k] = smoothstep(0.02, 0.5, lm);

      // Rock albedo: sediment strata by height (+ slow warp), AO at the foot, lit rim, void above.
      const sv = (h + noise.fbm(px * 0.3, pz * 0.3 + 9, 2) * 0.55) * 1.35;
      const bi = Math.floor(sv);
      const bf = sv - bi;
      const n0 = strata.length;
      cw.copy(strata[((bi % n0) + n0) % n0]!).lerp(strata[(((bi + 1) % n0) + n0) % n0]!, smoothstep(0.78, 1.0, bf));
      cw.multiplyScalar(0.9 + noise.get(px * 1.3, pz * 1.3 + h * 2) * 0.18);
      const rel = h - fh;
      cw.multiplyScalar(0.42 + 0.58 * smoothstep(0.0, 1.1, rel));
      // Rim light along the cliff crest.
      const crest = smoothstep(0.45, 0.8, s) * (1 - smoothstep(1.0, 1.6, s)) * smoothstep(0.6, 1.4, rel);
      aCrest[k] = crest;
      cw.multiplyScalar(1 + crest * 0.45);
      if (L.biome === 'ice') cw.lerp(frost, crest * 0.55 + smoothstep(1.2, 2.5, rel) * 0.15);
      const voidK = smoothstep(0.9, 2.6, s);
      aVoid[k] = voidK;
      // Deep rock fades towards the fog, but keeps a dim silhouette (never a flat black hole).
      cw.multiplyScalar(1 - voidK * 0.72);
      aWall[k] = w;
      c.lerp(cw, w);
      if (L.biome === 'lava') c.lerp(ember, aLava[k]! * (1 - w) * 0.35);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aWall', new THREE.BufferAttribute(aWall, 1));
  geo.setAttribute('aVoid', new THREE.BufferAttribute(aVoid, 1));
  geo.setAttribute('aLava', new THREE.BufferAttribute(aLava, 1));
  geo.setAttribute('aCrest', new THREE.BufferAttribute(aCrest, 1));
  const uv = new Float32Array(N * 2);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const index: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const cc = a + nx;
      const d = cc + 1;
      // Split along the flatter diagonal (cleaner cliff edges).
      if (Math.abs(hArr[a]! - hArr[d]!) < Math.abs(hArr[b]! - hArr[cc]!)) index.push(a, cc, d, a, d, b);
      else index.push(a, cc, b, b, cc, d);
    }
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const shell = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  shell.name = `cave-${L.biome}`;
  const uGlint = { value: new THREE.Color(L.biome === 'earth' ? 0xffd27a : L.biome === 'ice' ? 0xc8f4ff : 0xff8a3a).multiplyScalar(L.biome === 'ice' ? 3.2 : 2.6) };
  const uCrack = { value: L.biome === 'lava' ? 1 : L.biome === 'ice' ? 2 : 0 };
  const uRimCol = { value: new THREE.Color(L.biome === 'earth' ? 0x6a4428 : L.biome === 'ice' ? 0x3c6a9c : 0x8a2408).multiplyScalar(L.biome === 'lava' ? 0.55 : 0.4) };
  const uFloorRough = { value: def.floorRough };
  patchMaterial(shell, `mine-cave-${L.biome}`, (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uGlint = uGlint;
    shader.uniforms.uCrack = uCrack;
    shader.uniforms.uFloorRough = uFloorRough;
    shader.uniforms.uRimCol = uRimCol;
    let vs = shader.vertexShader;
    vs = before(vs, 'void main() {', 'attribute float aWall; attribute float aVoid; attribute float aLava; attribute float aCrest;\nvarying float vWall; varying float vVoid; varying float vLava; varying float vCrest; varying vec3 vCW; varying vec3 vCN;');
    vs = after(vs, '#include <project_vertex>', 'vWall = aWall; vVoid = aVoid; vLava = aLava; vCrest = aCrest; vCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = before(
      fs,
      'void main() {',
      `uniform float uTime; uniform vec3 uGlint; uniform float uCrack; uniform float uFloorRough; uniform vec3 uRimCol;
varying float vWall; varying float vVoid; varying float vLava; varying float vCrest; varying vec3 vCW; varying vec3 vCN;
${NOISE_GLSL}
${CAVE_GLSL}`,
    );
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      vec3 cwn = normalize(vCN);
      vec2 tp = abs(cwn.y) > 0.6 ? vCW.xz : (abs(cwn.x) > abs(cwn.z) ? vCW.zy : vCW.xy);
      float grit = hvNoise(tp * 4.3) * 0.45 + hvNoise(tp * 13.0) * 0.35 + hvNoise(tp * 1.4) * 0.2;
      diffuseColor.rgb *= 0.84 + 0.32 * grit;
      float onFloor = 1.0 - smoothstep(0.15, 0.5, vWall);
      float onWall = smoothstep(0.3, 0.75, vWall) * (1.0 - vVoid * 0.85);
      float hvCrackV = 0.0;
      vec2 fp = vCW.xz;
      if (uCrack < 0.5) {
        // EARTH: packed dirt. Trodden (lighter, smoother) lanes, darker gravel patches with dense
        // specks, a few faint hairline cracks (30 % of the old crazing).
        float trod = smoothstep(0.52, 0.72, hvFbm(fp * 0.16 + 3.0));
        float grav = smoothstep(0.56, 0.7, hvFbm(fp * 0.3 + 11.0));
        diffuseColor.rgb *= mix(1.0, mix(1.1, 0.8, grav), onFloor);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.05, 1.0), trod * onFloor * 0.8);
        vec2 gcell = floor(fp * 9.0);
        float gh = hvHash12(gcell);
        vec2 gf = fract(fp * 9.0) - 0.5 - (hvHash22(gcell + 3.1) - 0.5) * 0.5;
        float speck = step(0.8 - grav * 0.35 + trod * 0.1, gh) * smoothstep(0.3, 0.14, length(gf)) * onFloor;
        diffuseColor.rgb *= mix(1.0, gh > 0.93 ? 1.4 : 0.58, speck);
        float cl = abs(hvNoise(fp * 0.55 + hvNoise(fp * 2.1) * 0.5) - 0.5);
        float crack = (1.0 - smoothstep(0.0, 0.018, cl)) * onFloor * smoothstep(0.55, 0.75, hvNoise(fp * 0.21 + 7.0));
        diffuseColor.rgb *= 1.0 - crack * 0.3;
      } else if (uCrack > 1.5) {
        // ICE: smooth frosted sheet, soft blue-white drifts, sparse long fracture lines.
        float drift = hvFbm(fp * 0.12 + 5.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.94, 1.08), smoothstep(0.45, 0.25, drift) * onFloor);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), smoothstep(0.6, 0.8, drift) * onFloor * 0.5);
        vec2 w = fp + vec2(hvNoise(fp * 0.3), hvNoise(fp * 0.3 + 9.0)) * 2.4;
        float l1 = abs(hvNoise(w * 0.22) - 0.5);
        float l2 = abs(hvNoise(w * 0.5 + 31.0) - 0.5);
        float mask = smoothstep(0.5, 0.7, hvNoise(fp * 0.09 + 2.0));
        float frac = max(1.0 - smoothstep(0.0, 0.01, l1), (1.0 - smoothstep(0.0, 0.008, l2)) * 0.6) * mask * onFloor;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.99, 1.0), frac * 0.85);
        hvCrackV = frac;
      } else {
        // CINDER: dark basalt floor under grey ash drifts; fissures only where the rock is hot.
        float ash = smoothstep(0.5, 0.72, hvFbm(fp * 0.2 + 13.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.38, 0.36) * (0.8 + 0.4 * grit), ash * onFloor * 0.7);
        vec2 w = fp + vec2(hvNoise(fp * 0.7), hvNoise(fp * 0.7 + 5.0)) * 0.9;
        float fl = abs(hvNoise(w * 0.8) - 0.5);
        float fis = (1.0 - smoothstep(0.0, 0.03, fl)) * onFloor * (1.0 - ash);
        diffuseColor.rgb *= 1.0 - fis * 0.55;
        hvCrackV = fis;
      }
      // WALLS: bedded strata courses. Wavy horizontal ledges ~0.4 m tall broken into blocks of
      // random width; each block is pillowed (edges roll into dark joints), lit along its top and
      // shadowed under the ledge above, so the face reads as layered rock with scale.
      if (onWall > 0.01) {
        float steep = smoothstep(0.35, 0.75, 1.0 - abs(cwn.y));
        float rowH = 0.42;
        float vv = tp.y / rowH + (hvNoise(vec2(tp.x * 0.3, 1.7)) - 0.5) * 1.1;
        float row = floor(vv);
        float fv = fract(vv);
        float rh = hvHash12(vec2(row, 7.1));
        float bw = 0.6 + rh * 0.9;
        float uu = tp.x / bw + hvHash12(vec2(row, 1.3)) * 10.0 + (hvNoise(vec2(tp.y * 2.0, row)) - 0.5) * 0.35;
        float colI = floor(uu);
        float fu = fract(uu);
        float id = hvHash12(vec2(row, colI) + 0.37);
        float e = min(min(fu, 1.0 - fu) * bw, min(fv, 1.0 - fv) * rowH) + (hvNoise(tp * 11.0) - 0.5) * 0.035;
        float joint = 1.0 - smoothstep(0.012, 0.05, e);
        float pillow = mix(0.7, 1.0, smoothstep(0.0, 0.11, e));
        float lip = mix(0.72, 1.12, smoothstep(0.05, 0.95, fv));
        float stone = (0.8 + 0.32 * id) * pillow * lip * (1.0 - joint * 0.78);
        diffuseColor.rgb *= mix(1.0, stone * 1.08, onWall * steep);
      }
      `,
    );
    fs = after(
      fs,
      '#include <roughnessmap_fragment>',
      `roughnessFactor = mix(uFloorRough * (0.85 + 0.3 * hvNoise(vCW.xz * 1.7)), 0.9, smoothstep(0.1, 0.6, vWall));
      if (uCrack > 1.5) roughnessFactor = mix(roughnessFactor, 0.12, hvCrackV);`,
    );
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        // Mineral glints that twinkle on the rock faces (not in the void, not on the floor).
        // Point-like specks (a tiny disc per lucky cell of the triplanar plane), never whole cells.
        vec3 gn = normalize(vCN);
        vec2 gtp = abs(gn.y) > 0.6 ? vCW.xz : (abs(gn.x) > abs(gn.z) ? vCW.zy : vCW.xy);
        vec2 gc = floor(gtp * 5.0);
        float gh2 = hvHash12(gc + 13.7);
        vec2 gof = fract(gtp * 5.0) - 0.5 - (hvHash22(gc + 5.3) - 0.5) * 0.6;
        float dotK = smoothstep(0.07, 0.0, length(gof));
        float tw = pow(max(0.0, sin(uTime * 1.7 + gh2 * 71.0)), 10.0);
        totalEmissiveRadiance += uGlint * step(0.93, gh2) * dotK * (0.25 + tw) * smoothstep(0.3, 0.7, vWall) * (1.0 - vVoid);
        // Lit lip along every cliff crest: the wall silhouette always reads against the dark.
        totalEmissiveRadiance += uRimCol * vCrest * (0.75 + 0.25 * hvNoise(vCW.xz * 2.0));
        if (uCrack > 0.5 && uCrack < 1.5) {
          // Lava band: seams glow and breathe, stronger near the channels.
          float pulse = 0.65 + 0.35 * sin(uTime * 1.3 + vCW.x * 0.7 + vCW.z * 0.4);
          totalEmissiveRadiance += vec3(1.0, 0.24, 0.03) * (hvCrackV * (0.03 + vLava * vLava * 1.6) * pulse * 1.3 + vLava * onFloor * 0.12);
        }
      }`,
    );
    shader.fragmentShader = fs;
  });

  const group = new THREE.Group();
  group.name = 'cave';
  group.userData.perfTag = 'mine-cave';
  const mesh = new THREE.Mesh(geo, shell);
  mesh.name = 'cave-shell';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);

  // ── liquids ────────────────────────────────────────────────────
  const disposables: { dispose(): void }[] = [geo, shell];
  const lavaUniforms = { uTime: globalUniforms.uTime };
  const bbox = (arr: Uint8Array): THREE.Box2 | null => {
    const b = new THREE.Box2();
    let any = false;
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++)
        if (arr[z * W + x]) {
          b.expandByPoint(new THREE.Vector2(x, z));
          b.expandByPoint(new THREE.Vector2(x + 1, z + 1));
          any = true;
        }
    return any ? b.expandByScalar(1) : null;
  };
  const lb = bbox(L.lava);
  if (lb) {
    // Molten river: a finely tessellated sheet whose cooled crust rafts drift with the flow
    // (~5 cm/s), ride 4 cm proud of the melt, glow along their cracked rims and catch a fake
    // lantern key on their relief. The open melt pulses; a heat-haze sheet shimmers above it.
    const wdt = lb.max.x - lb.min.x;
    const dep = lb.max.y - lb.min.y;
    const g = new THREE.PlaneGeometry(wdt, dep, Math.ceil(wdt / 0.22), Math.ceil(dep / 0.22)).rotateX(-Math.PI / 2);
    g.translate((lb.min.x + lb.max.x) / 2, -0.17, (lb.min.y + lb.max.y) / 2);
    const LAVA_FN = /* glsl */ `
      float hvCrust(vec2 p, float t) {
        vec2 q = p - vec2(0.05, 0.028) * t;
        vec2 w = vec2(hvFbm(q * 0.32 + t * 0.012), hvFbm(q * 0.32 + 17.0 - t * 0.01));
        return hvFbm(q * 0.62 + w * 1.7);
      }`;
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      fog: true,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vW;
        #include <fog_pars_vertex>
        ${NOISE_GLSL}
        ${LAVA_FN}
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float n = hvCrust(wp.xz, uTime);
          wp.y += smoothstep(0.57, 0.67, n) * 0.045 + hvNoise(wp.xz * 3.0) * 0.012;
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vW;
        #include <fog_pars_fragment>
        ${NOISE_GLSL}
        ${LAVA_FN}
        void main() {
          vec2 p = vW.xz;
          float t = uTime;
          float n = hvCrust(p, t);
          float crust = smoothstep(0.57, 0.63, n);
          // Crust relief lighting from finite differences (lantern from above-front).
          float e = 0.06;
          float nx = hvCrust(p + vec2(e, 0.0), t) - n;
          float nz = hvCrust(p + vec2(0.0, e), t) - n;
          vec3 nrm = normalize(vec3(-nx * 9.0, 1.0, -nz * 9.0));
          float lit = 0.5 + 0.9 * max(0.0, dot(nrm, normalize(vec3(-0.3, 0.8, 0.5))));
          float pulse = 0.8 + 0.2 * sin(t * 1.7 + p.x * 0.9 + p.y * 0.6);
          // Melt: deep red in the slow middle, orange as it thins, yellow-white only where hottest.
          float hot = 1.0 - smoothstep(0.3, 0.52, n);
          float swirl = hvNoise(p * 1.7 - vec2(t * 0.12, t * 0.07));
          vec3 molten = mix(vec3(0.42, 0.05, 0.008), vec3(0.95, 0.3, 0.03), smoothstep(0.2, 0.75, hot * 0.7 + swirl * 0.45));
          molten = mix(molten, vec3(1.35, 0.78, 0.24), smoothstep(0.78, 1.0, hot) * pulse * 0.8);
          // Crust rafts: near-black basalt (linear!), a faint sheen on the relief.
          float grain = hvNoise(p * 7.0) * 0.6 + hvNoise(p * 19.0) * 0.4;
          vec3 crustC = mix(vec3(0.006, 0.003, 0.003), vec3(0.028, 0.012, 0.01), grain) * lit;
          float cr = abs(hvNoise(p * 2.6 + hvNoise(p * 5.0) * 0.4) - 0.5);
          crustC += vec3(0.55, 0.08, 0.005) * (1.0 - smoothstep(0.0, 0.03, cr)) * 0.5 * pulse;
          // The crust edge cools gradually: dull red rim before the seam.
          float edgeHeat = 1.0 - smoothstep(0.57, 0.7, n);
          crustC += vec3(0.25, 0.03, 0.0) * edgeHeat * crust;
          vec3 col = mix(molten, crustC, crust);
          // Bright glowing seam where crust meets melt.
          float seam = 1.0 - smoothstep(0.0, 0.025, abs(n - 0.585));
          col += vec3(1.3, 0.55, 0.08) * seam * pulse;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    m.uniforms.uTime = lavaUniforms.uTime;
    const lm = new THREE.Mesh(g, m);
    lm.name = 'lava';
    lm.userData.noAO = true;
    lm.renderOrder = -1;
    group.add(lm);
    disposables.push(g, m);
    // Heat haze: an additive shimmer sheet a little above the melt (wobbling bright streaks rising).
    const hg = new THREE.PlaneGeometry(wdt, dep, 1, 1).rotateX(-Math.PI / 2);
    hg.translate((lb.min.x + lb.max.x) / 2, 0.42, (lb.min.y + lb.max.y) / 2);
    const mask = new THREE.DataTexture(new Uint8Array(Array.from(L.lava, (v) => v * 255)), W, D, THREE.RedFormat);
    mask.magFilter = THREE.LinearFilter;
    mask.minFilter = THREE.LinearFilter;
    mask.needsUpdate = true;
    const hm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime, uMask: { value: mask }, uSize: { value: new THREE.Vector2(W, D) } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uMask; uniform vec2 uSize; varying vec3 vW;
        ${NOISE_GLSL}
        void main(){
          float mk = texture2D(uMask, vW.xz / uSize).r;
          vec2 p = vW.xz * vec2(1.6, 0.7) + vec2(hvNoise(vW.xz * 1.3 + uTime * 0.6) * 0.8, uTime * 0.9);
          float s = pow(hvNoise(p), 3.0) * 1.6;
          float a = smoothstep(0.25, 0.8, mk) * s * 0.07;
          gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a, a);
        }`,
    });
    const haze = new THREE.Mesh(hg, hm);
    haze.name = 'lava-haze';
    haze.renderOrder = 9;
    haze.userData.noAO = true;
    group.add(haze);
    disposables.push(hg, hm, mask);
  }
  const pb = bbox(L.pool);
  if (pb) {
    const g = new THREE.PlaneGeometry(pb.max.x - pb.min.x, pb.max.y - pb.min.y, 1, 1).rotateX(-Math.PI / 2);
    g.translate((pb.min.x + pb.max.x) / 2, -0.015, (pb.min.y + pb.max.y) / 2);
    const ice = L.biome === 'ice';
    const m = new THREE.MeshStandardMaterial({
      color: ice ? 0x9ccbe8 : 0x121a22,
      roughness: ice ? 0.06 : 0.03,
      metalness: ice ? 0.1 : 0.3,
      transparent: true,
      opacity: ice ? 0.78 : 0.82,
      emissive: ice ? 0x1c5a80 : 0x000000,
      emissiveIntensity: ice ? 0.35 : 0,
      depthWrite: false,
    });
    const pm = new THREE.Mesh(g, m);
    pm.name = ice ? 'frozen-pool' : 'puddle';
    pm.receiveShadow = true;
    pm.userData.noAO = true;
    group.add(pm);
    disposables.push(g, m);
  }

  // ── boulders + pebbles ─────────────────────────────────────────
  const sampleArr = (arr: Float32Array, px: number, pz: number): number => {
    const fi = clamp((px - x0) / STEP, 0, nx - 1.001);
    const fj = clamp((pz - z0) / STEP, 0, nz - 1.001);
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const ti = fi - i;
    const tj = fj - j;
    const a = arr[j * nx + i]!;
    const b = arr[j * nx + i + 1]!;
    const cc = arr[(j + 1) * nx + i]!;
    const d = arr[(j + 1) * nx + i + 1]!;
    return (a * (1 - ti) + b * ti) * (1 - tj) + (cc * (1 - ti) + d * ti) * tj;
  };
  const geos: THREE.BufferGeometry[] = [];
  const capCol = L.biome === 'ice' ? 0xf0f7ff : L.biome === 'lava' ? 0x6a3a30 : 0xb09070;
  const capAmt = L.biome === 'ice' ? 0.85 : L.biome === 'lava' ? 0.25 : 0.25;
  const r = rng.fork('boulders');
  for (let pz = -1; pz < D + 1; pz += 0.62) {
    for (let px = -1; px < W + 1; px += 0.62) {
      const x = px + (r.next() - 0.5) * 0.5;
      const z = pz + (r.next() - 0.5) * 0.5;
      const s = sampleArr(sd, x, z);
      const foot = s > 0.05 && s < 0.5;
      const rim = s > 0.75 && s < 1.5;
      if (!foot && !rim) continue;
      if (r.next() > (foot ? 0.42 : 0.28)) continue;
      const h = sampleArr(hArr, x, z);
      const rad = foot ? 0.28 + r.next() * 0.42 : 0.35 + r.next() * 0.5;
      const band = strata[Math.floor(r.next() * 3)]!.clone().multiplyScalar(foot ? 1.0 : 0.85);
      const g = facetRock(r, rad, band.getHex(), { chunky: true, squash: 0.62 + r.next() * 0.3, cap: capCol, capAmt, rim: 0.6, detail: rad > 0.4 ? 2 : 1, smooth: 0.45, lumps: 0.14 });
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, (foot ? floorBase(x, z) : h) - rad * 0.15, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((r.next() - 0.5) * 0.3, r.next() * 6, (r.next() - 0.5) * 0.3)), new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      geos.push(g);
    }
  }
  // Floor pebbles.
  const pr = rng.fork('pebbles');
  let pebbles = 0;
  for (let t = 0; t < 1400 && pebbles < 320; t++) {
    const x = 2 + pr.next() * (W - 4);
    const z = 2 + pr.next() * (D - 4);
    const s = sampleArr(sd, x, z);
    if (s > -0.15 || maskAt(L.lava, x, z) > 0.05) continue;
    // Denser near walls.
    if (pr.next() > 0.25 + smoothstep(-2.5, -0.2, s) * 0.75) continue;
    const rad = 0.035 + pr.next() * pr.next() * 0.12;
    const tint = pr.next() < 0.5 ? def.rock[0]! : def.strata[pr.int(0, 2)]!;
    const g = facetRock(pr, rad, tint, { squash: 0.55, cap: capCol, capAmt: capAmt * 0.6, detail: 0, rim: 0.4 });
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, floorBase(x, z) - 0.01, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pr.next() * 6, 0)), new THREE.Vector3(1, 1, 1)));
    geos.push(g);
    pebbles++;
  }
  if (geos.length) {
    const merged = mergeGeos(geos);
    const rm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: L.biome === 'ice' ? 0.5 : 0.88, metalness: 0 });
    rm.name = 'cave-boulders';
    const bm = new THREE.Mesh(merged, rm);
    bm.name = 'cave-boulders';
    bm.castShadow = true;
    bm.receiveShadow = true;
    group.add(bm);
    disposables.push(merged, rm);
  }

  const heightAt = (x: number, z: number): number => {
    const fh = floorBase(x, z);
    const pm = maskAt(L.pool, x, z);
    return pm > 0.3 && L.biome === 'ice' ? Math.max(fh, -0.015) : Math.max(fh, -0.1);
  };

  return {
    group,
    heightAt,
    surfaceAt: (x: number, z: number) => sampleArr(hArr, x, z),
    update: () => {
      /* animated via shared uTime */
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/** Concatenate non-indexed geometries with identical attribute layouts. */
export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(list[0]!.attributes);
  let count = 0;
  for (const g of list) count += g.attributes.position!.count;
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0]!.attributes[n]!.itemSize;
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const g of list) {
      const a = g.attributes[n] as THREE.BufferAttribute;
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  for (const g of list) g.dispose();
  out.computeBoundingSphere();
  return out;
}
