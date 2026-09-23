/**
 * The west tide-pool shelf as real stone: a finely tessellated slab (0.2 m grid) that follows the
 * height field — including its SHELF_LIFT-thick bevelled rim — with slab seams and pitting pushed
 * into the surface, smooth normals and the shared beach-rock material (triplanar granite, weed only
 * low down, a glossy wet band + barnacle crust along the sea edge and around the pool lips).
 * The pool interiors are cut out: the terrain's sandy, caustic-lit pool floor shows through the
 * clear pool water, framed by the stone lip.
 *
 * Plus AlgaeTufts: sparse clumps of drooping weed ribbons hanging over the pool rims and the wet
 * sea edge (instead of a painted green halo).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import { applyWorldFx } from '../../render/worldfx';
import { beachRockMaterial } from './rocks';
import { TIDE_POOLS, TIDE_POOL_Y, type BeachShape } from './layout';

const poolD = (x: number, z: number): number => {
  let d = 9;
  for (const [px, pz, pr] of TIDE_POOLS) d = Math.min(d, Math.hypot(x - px, (z - pz) * 1.15) / pr);
  return d;
};

export function buildShelf(S: BeachShape, seed: number): THREE.Mesh {
  const step = 0.2;
  const x0 = -6;
  const x1 = 22;
  const z0 = 35;
  const z1 = 55;
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const n = new Noise2D(seed);
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const inside = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * step;
      const z = z0 + j * step;
      const wr = S.westRock(x, z);
      const pd = poolD(x, z);
      inside[k] = wr < 0.24 && pd > 0.86 ? 1 : 0;
      // Slab seams (worn cracks) + pitting pressed into the stone.
      const cr = Math.abs(n.fbm(x * 0.55, z * 0.55, 2));
      const seam = THREE.MathUtils.smoothstep(0.07, 0.0, cr);
      const pit = n.fbm(x * 3.1 + 11, z * 3.1, 2);
      const topK = THREE.MathUtils.smoothstep(0.06, -0.06, wr) * THREE.MathUtils.smoothstep(1.0, 1.35, pd);
      // Sits 5 cm proud of the (coarser) terrain so the ground never pokes through; past the rim the
      // slab dives under the sand, so the visible edge is the smooth contour, never grid steps.
      const dive = THREE.MathUtils.smoothstep(0.1, 0.22, wr);
      const y = S.height(x, z) + 0.05 * (1 - dive) - 0.14 * dive + (pit * 0.02 - seam * 0.025) * topK;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      // Vertex AO: seams / pits darker, the rim foot (meeting the sand) darker.
      const foot = THREE.MathUtils.smoothstep(-0.02, 0.09, wr);
      const a = (1 - seam * 0.35 * topK) * (0.9 + pit * 0.12) * (1 - foot * 0.35);
      col[k * 3] = a;
      col[k * 3 + 1] = a;
      col[k * 3 + 2] = a;
      // uv.x = 1 - moss: weed only on the low, spray-fed parts; uv.y = wet lip around the pools.
      const low = THREE.MathUtils.smoothstep(0.72, 0.45, y);
      uv[k * 2] = 1 - Math.min(1, low * 0.6 + THREE.MathUtils.smoothstep(1.3, 1.0, pd) * 0.25);
      uv[k * 2 + 1] = THREE.MathUtils.smoothstep(1.28, 0.95, pd) * 0.85;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (inside[a]! + inside[b]! + inside[c]! + inside[d]! < 3) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, beachRockMaterial());
  m.name = 'tide-shelf';
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.perfTag = 'props';
  return m;
}

/**
 * Drooping weed tufts on the pool lips and along the shelf's sea edge: 4–6 tapered ribbons per
 * clump, dark kelp-green at the root → olive tips.
 */
export function buildAlgaeTufts(S: BeachShape, rng: Rng, heightAt: (x: number, z: number) => number): THREE.Mesh {
  const P: number[] = [];
  const C: number[] = [];
  const N: number[] = [];
  const root = new THREE.Color(0x4a5a1c);
  const tip = new THREE.Color(0xa8a444);
  const tmp = new THREE.Color();
  const tuft = (x: number, z: number, outX: number, outZ: number, size: number): void => {
    const y0 = heightAt(x, z);
    const ribbons = 4 + Math.floor(rng.next() * 3);
    for (let r = 0; r < ribbons; r++) {
      const a = Math.atan2(outZ, outX) + (rng.next() - 0.5) * 1.6;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const len = size * (0.35 + rng.next() * 0.35);
      const w = size * 0.07 * (0.7 + rng.next() * 0.6);
      const segs = 5;
      const sx = -dz;
      const sz = dx;
      const ox = x + (rng.next() - 0.5) * size * 0.25;
      const oz = z + (rng.next() - 0.5) * size * 0.25;
      let prevL: number[] | null = null;
      let prevR: number[] | null = null;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        // Arc up a touch, then droop over the lip.
        const px = ox + dx * len * t;
        const pz = oz + dz * len * t;
        const py = y0 + 0.03 + Math.sin(t * Math.PI * 0.8) * len * 0.3 - t * t * len * 0.28;
        const hw = w * (1 - t * 0.85);
        const L = [px + sx * hw, py, pz + sz * hw];
        const R = [px - sx * hw, py, pz - sz * hw];
        if (prevL && prevR) {
          // Both windings, both lit from above (no dark flipped back faces).
          for (const v of [prevL, prevR, L, prevR, R, L, prevL, L, prevR, prevR, L, R]) P.push(v[0]!, v[1]!, v[2]!);
          tmp.copy(root).lerp(tip, t);
          const tp = tmp.clone();
          const tq = new THREE.Color().copy(root).lerp(tip, (s - 1) / segs);
          for (const c of [tq, tq, tp, tq, tp, tp, tq, tp, tq, tq, tp, tp]) C.push(c.r, c.g, c.b);
          for (let q = 0; q < 12; q++) N.push(0, 1, 0);
        }
        prevL = L;
        prevR = R;
      }
    }
  };
  // Pool lips: clumps hanging inwards over the water (in gaps between the anemone colonies).
  for (const [px, pz, pr] of TIDE_POOLS) {
    const k = Math.round(pr * 5);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + rng.next() * 0.6;
      const x = px + Math.cos(a) * pr * 0.98;
      const z = pz + (Math.sin(a) * pr * 0.98) / 1.15;
      if (heightAt(x, z) < TIDE_POOL_Y) continue;
      tuft(x, z, -Math.cos(a), -Math.sin(a), 0.55 + rng.next() * 0.3);
    }
  }
  // Sea edge of the shelf: weed draped down the wet rim towards the surf.
  for (let i = 0; i < 90 && P.length < 60000; i++) {
    const x = -4 + rng.next() * 24;
    const z = 37 + rng.next() * 17;
    const wr = S.westRock(x, z);
    if (wr < -0.02 || wr > 0.06) continue;
    const y = heightAt(x, z);
    if (y > 0.75 || y < -0.05) continue;
    const gx = S.westRock(x + 0.3, z) - S.westRock(x - 0.3, z);
    const gz = S.westRock(x, z + 0.3) - S.westRock(x, z - 0.3);
    const gl = Math.hypot(gx, gz) || 1;
    tuft(x, z, gx / gl, gz / gl, 0.5 + rng.next() * 0.35);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
  mat.name = 'algaeTuft';
  applyWorldFx(mat, { snow: false });
  const m = new THREE.Mesh(g, mat);
  m.name = 'algae-tufts';
  m.receiveShadow = true;
  m.userData.perfTag = 'props';
  return m;
}
