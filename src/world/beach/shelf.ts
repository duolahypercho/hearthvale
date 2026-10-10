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

/** GLSL-order smoothstep(edge0, edge1, x); edges may be reversed (falls from 1 to 0). */
const ss = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
import { applyWorldFx } from '../../render/worldfx';
import { beachRockMaterial } from './rocks';
import { TIDE_POOLS, TIDE_POOL_Y, type BeachShape } from './layout';

/** How far the slab's top stands proud of the ground under it (BeachMap.heightAt adds it for feet). */
export const SHELF_PROUD = 0.05;

/**
 * Pool outline scale at angle `a` round pool `i` (≥ 1: the stone grows into the round bowl): a few
 * low harmonics per pool, so every pool is an irregular, lobed rock basin — never a punched circle.
 */
export function poolLobe(i: number, a: number): number {
  const p = i * 1.7 + 0.4;
  const w = 0.5 + 0.28 * Math.sin(2 * a + p * 2.3) + 0.16 * Math.sin(3 * a + p * 4.1) + 0.08 * Math.sin(5 * a + p * 1.3);
  return 1 + 0.34 * Math.min(1, Math.max(0, w));
}

const poolD = (x: number, z: number): number => {
  let d = 9;
  TIDE_POOLS.forEach(([px, pz, pr], i) => {
    const dz = (z - pz) * 1.15;
    const dx = x - px;
    d = Math.min(d, (Math.hypot(dx, dz) / pr) * poolLobe(i, Math.atan2(dz, dx)));
  });
  return d;
};

/**
 * Stepped ledges: the slab breaks into 3-4 wave-cut terraces (≈ 17 cm risers with a steep, short
 * face), rising inland, so the shelf reads as bedded rock rather than one poured slab.
 */
const ledgeN = new Noise2D(91733);
function ledgeLevel(S: BeachShape, x: number, z: number): number {
  const wr = S.westRock(x, z);
  const inland = Math.min(1, Math.max(0, -wr / 0.7));
  const v = ledgeN.fbm(x * 0.12 + 5, z * 0.15 - 2, 2) * 0.55 + 0.5 + inland * 0.9;
  return Math.max(0, v * 2.4);
}
function ledgeAt(S: BeachShape, x: number, z: number): number {
  const lv = ledgeLevel(S, x, z);
  const base = Math.floor(lv);
  // A short, steep riser (≈ 0.3 m run for a 21 cm step): reads as a broken bed, not a ramp.
  const riser = ss(0.9, 0.985, lv - base);
  return (base + riser) * 0.21 * ss(0.05, -0.12, S.westRock(x, z));
}
/** Per-terrace stone tint (each bed its own warm / cool sandstone), keyed by ledge index. */
const LEDGE_TINT: [number, number, number][] = [
  [0.8, 0.86, 0.96],
  [1.1, 0.98, 0.84],
  [0.94, 0.92, 0.9],
  [1.16, 1.02, 0.8],
  [0.88, 0.9, 0.96],
];

/**
 * Bowl the slab down into a tide pool: a rounded rim (convex shoulder) that rolls over from the top
 * into a wall dropping below the waterline, then hugs just under the terrain's pool floor.
 */
function poolWall(S: BeachShape, x: number, z: number, top: number, pd: number, gmax: number): number {
  if (pd >= 1.34) return top;
  const floor = Math.min(TIDE_POOL_Y - 0.16, S.height(x, z) - 0.06);
  const t = ss(1.34, 0.8, pd);
  // Ease-in: the shoulder stays high then rolls over (reads as a worn, rounded lip).
  const k = t * t * (1.3 - 0.3 * t);
  const wall = top + (floor - top) * Math.min(1, k);
  // Below the rolled shoulder, the terrain's own lip (still above the water) must not poke through.
  return gmax > TIDE_POOL_Y + 0.02 && pd > 0.9 ? Math.max(wall, Math.min(top, gmax + 0.02)) : wall;
}

const groundMax = (S: BeachShape, groundAt: (x: number, z: number) => number, x: number, z: number): number =>
  Math.max(S.height(x, z), groundAt(x, z), groundAt(x + 0.25, z), groundAt(x - 0.25, z), groundAt(x, z + 0.25), groundAt(x, z - 0.25));

/** Top of the tide-pool slab at (x, z) (no fine pitting) — for things set on the stone. */
export function shelfTopAt(S: BeachShape, groundAt: (x: number, z: number) => number, x: number, z: number): number {
  const wr = S.westRock(x, z);
  const dive = ss(0.1, 0.22, wr);
  const gm = groundMax(S, groundAt, x, z);
  const base = dive < 0.999 ? gm : S.height(x, z);
  return poolWall(S, x, z, base + (SHELF_PROUD + 0.03) * (1 - dive) - 0.14 * dive + ledgeAt(S, x, z) * (1 - dive), poolD(x, z), gm);
}

/**
 * `groundAt`: the coarse terrain's own height (its 0.5 m grid bows above the analytic surface in the
 * dips) — the slab keeps clear of it everywhere, so no sand / old rock splat pokes through as flakes.
 */
export function buildShelf(S: BeachShape, seed: number, groundAt: (x: number, z: number) => number): THREE.Mesh {
  const step = 0.2;
  const x0 = -6;
  const x1 = 22;
  const z0 = 35;
  const z1 = 55;
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const n = new Noise2D(seed);
  /** Slab surface height at (x, z) (with seams + pitting). */
  const heightOf = (x: number, z: number): number => {
    const wr = S.westRock(x, z);
    const pd = poolD(x, z);
    const cr = Math.abs(n.fbm(x * 0.55, z * 0.55, 2));
    const seam = ss(0.07, 0.0, cr);
    const pit = n.fbm(x * 3.1 + 11, z * 3.1, 2);
    const topK = ss(0.06, -0.06, wr) * ss(1.0, 1.35, pd);
    // Sits 5 cm proud of the (coarser) terrain so the ground never pokes through; past the rim the
    // slab dives under the sand, so the visible edge is the smooth contour, never grid steps.
    const dive = ss(0.1, 0.22, wr);
    const gm = groundMax(S, groundAt, x, z);
    const base = dive < 0.999 ? gm : S.height(x, z);
    let y = base + (SHELF_PROUD + 0.03) * (1 - dive) - 0.14 * dive + (pit * 0.02 - seam * 0.025) * topK + ledgeAt(S, x, z) * (1 - dive);
    if (dive < 0.999) y = poolWall(S, x, z, y, pd, gm);
    return y;
  };
  const P: number[] = [];
  const C: number[] = [];
  const U: number[] = [];
  const Nn: number[] = [];
  /** Append one vertex (y given: T-junction edges take the coarse neighbour's interpolated height). */
  const vert = (x: number, z: number, y: number): number => {
    const wr = S.westRock(x, z);
    const pd = poolD(x, z);
    const cr = Math.abs(n.fbm(x * 0.55, z * 0.55, 2));
    const seam = ss(0.07, 0.0, cr);
    const pit = n.fbm(x * 3.1 + 11, z * 3.1, 2);
    const topK = ss(0.06, -0.06, wr) * ss(1.0, 1.35, pd);
    P.push(x, y, z);
    // Vertex AO: seams / pits darker, the rim foot (meeting the sand) darker.
    const foot = ss(-0.02, 0.09, wr);
    // Ledge risers: the step face and its foot sit in shade (AO), the lip above catches light.
    const lg = ledgeAt(S, x + 0.15, z) - ledgeAt(S, x - 0.15, z);
    const lz = ledgeAt(S, x, z + 0.15) - ledgeAt(S, x, z - 0.15);
    const riser = Math.min(1, Math.hypot(lg, lz) * 5);
    const a = (1 - seam * 0.35 * topK) * (0.9 + pit * 0.12) * (1 - foot * 0.35) * (1 - riser * 0.55);
    // Terrace tint (cross-faded over the riser so a bed's colour turns the corner with it).
    const lvv = ledgeLevel(S, x, z);
    const li = Math.floor(lvv);
    const tf = ss(0.9, 0.985, lvv - li);
    const t0 = LEDGE_TINT[li % LEDGE_TINT.length]!;
    const t1 = LEDGE_TINT[(li + 1) % LEDGE_TINT.length]!;
    // The sunlit lip of each step (just above the riser) catches a pale highlight.
    const lip = ss(0.0, 0.06, lvv - li) * ss(0.22, 0.06, lvv - li) * (li > 0 ? 1 : 0) * 0.12;
    C.push(a * (t0[0] + (t1[0] - t0[0]) * tf + lip), a * (t0[1] + (t1[1] - t0[1]) * tf + lip), a * (t0[2] + (t1[2] - t0[2]) * tf + lip));
    // uv.x = 1 - moss: weed only on the low, spray-fed parts; uv.y = wet lip around the pools.
    const low = ss(0.72, 0.45, y);
    U.push(1 - Math.min(1, low * 0.6 + ss(1.3, 1.0, pd) * 0.25), ss(1.3, 0.95, pd) * 0.75);
    // Normals from the height function itself (one smooth field across coarse + refined cells).
    const e = 0.12;
    const hx = heightOf(x + e, z) - heightOf(x - e, z);
    const hz = heightOf(x, z + e) - heightOf(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    Nn.push(-hx / l, (2 * e) / l, -hz / l);
    return P.length / 3 - 1;
  };
  const H = new Float32Array(nx * nz);
  const inside = new Uint8Array(nx * nz);
  const gid = new Int32Array(nx * nz).fill(-1);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * step;
      const z = z0 + j * step;
      // Pools are NOT cut out of the grid (a 0.2 m grid cut reads as a saw-tooth rim): the slab
      // itself curves down into each bowl and slips under the still water, so the visible pool edge
      // is the waterline. Only the deep centre (under the terrain floor) is skipped.
      inside[k] = S.westRock(x, z) < 0.24 && poolD(x, z) > 0.5 ? 1 : 0;
      H[k] = heightOf(x, z);
    }
  }
  const cellKept = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return false;
    const a = j * nx + i;
    return inside[a]! + inside[a + 1]! + inside[a + nx]! + inside[a + nx + 1]! >= 3;
  };
  // Cells the pool waterline crosses are refined 5×5 (4 cm): the still water meets the stone wall
  // along a smooth curve instead of the 0.2 m grid's polygon.
  const W = TIDE_POOL_Y;
  const refine = (i: number, j: number): boolean => {
    if (!cellKept(i, j)) return false;
    const a = j * nx + i;
    const hs = [H[a]!, H[a + 1]!, H[a + nx]!, H[a + nx + 1]!];
    const x = x0 + (i + 0.5) * step;
    const z = z0 + (j + 0.5) * step;
    return poolD(x, z) < 1.45 && Math.min(...hs) < W + 0.06 && Math.max(...hs) > W - 0.06;
  };
  const fine = new Uint8Array((nx - 1) * (nz - 1));
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) fine[j * (nx - 1) + i] = refine(i, j) ? 1 : 0;
  const isFine = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx - 1 && j < nz - 1 && fine[j * (nx - 1) + i] === 1;
  const gv = (i: number, j: number): number => {
    const k = j * nx + i;
    if (gid[k]! < 0) gid[k] = vert(x0 + i * step, z0 + j * step, H[k]!);
    return gid[k]!;
  };
  const idx: number[] = [];
  const R = 5;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (!cellKept(i, j)) continue;
      if (!isFine(i, j)) {
        const a = gv(i, j);
        const b = gv(i + 1, j);
        const c = gv(i, j + 1);
        const d = gv(i + 1, j + 1);
        idx.push(a, c, b, b, c, d);
        continue;
      }
      // Refined cell: shared corners from the coarse grid; edges facing a coarse neighbour follow
      // that neighbour's straight edge (no T-junction cracks).
      const h00 = H[j * nx + i]!;
      const h10 = H[j * nx + i + 1]!;
      const h01 = H[(j + 1) * nx + i]!;
      const h11 = H[(j + 1) * nx + i + 1]!;
      const coarseW = !isFine(i - 1, j);
      const coarseE = !isFine(i + 1, j);
      const coarseN = !isFine(i, j - 1);
      const coarseS = !isFine(i, j + 1);
      const ids: number[] = [];
      for (let v = 0; v <= R; v++) {
        for (let u = 0; u <= R; u++) {
          if ((u === 0 || u === R) && (v === 0 || v === R)) {
            ids.push(gv(i + u / R, j + v / R));
            continue;
          }
          const fu = u / R;
          const fv = v / R;
          const x = x0 + (i + fu) * step;
          const z = z0 + (j + fv) * step;
          let y: number;
          if (u === 0 && coarseW) y = h00 + (h01 - h00) * fv;
          else if (u === R && coarseE) y = h10 + (h11 - h10) * fv;
          else if (v === 0 && coarseN) y = h00 + (h10 - h00) * fu;
          else if (v === R && coarseS) y = h01 + (h11 - h01) * fu;
          else y = heightOf(x, z);
          ids.push(vert(x, z, y));
        }
      }
      for (let v = 0; v < R; v++) {
        for (let u = 0; u < R; u++) {
          const a = ids[v * (R + 1) + u]!;
          const b = ids[v * (R + 1) + u + 1]!;
          const c = ids[(v + 1) * (R + 1) + u]!;
          const d = ids[(v + 1) * (R + 1) + u + 1]!;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
  }
  // Refined cells duplicate their edge vertices with a neighbouring refined cell: identical
  // positions + normals (same functions), so no seam.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, beachRockMaterial('shelf'));
  m.name = 'tide-shelf';
  // Flat slab: its own shadow adds nothing but triangles; stone AO is baked into the vertices.
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.noAO = true;
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
  for (const [pi, [px, pz, pr]] of TIDE_POOLS.entries()) {
    const k = Math.round(pr * 5);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + rng.next() * 0.6;
      const rr = (pr * 0.99) / poolLobe(pi, a);
      const x = px + Math.cos(a) * rr;
      const z = pz + (Math.sin(a) * rr) / 1.15;
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

/**
 * Barnacle + limpet crust on the shelf: clustered (never a uniform speckle) along the wet sea rim,
 * round the pool lips and in the seams — real little cones with dark craters that catch the light,
 * instead of painted dots. One merged, flat-shaded mesh (~15k tris).
 */
export function buildShelfCrust(S: BeachShape, rng: Rng, heightAt: (x: number, z: number) => number): THREE.Mesh {
  const P: number[] = [];
  const C: number[] = [];
  const tri = (a: number[], b: number[], c: number[], ca: number[], cb: number[], cc: number[]): void => {
    P.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
    C.push(ca[0]!, ca[1]!, ca[2]!, cb[0]!, cb[1]!, cb[2]!, cc[0]!, cc[1]!, cc[2]!);
  };
  /** A barnacle: a 6-sided volcano (pale plates, dark crater). */
  const barnacle = (x: number, y: number, z: number, r: number, tone: number): void => {
    const h = r * (0.7 + rng.next() * 0.5);
    const sides = 6;
    const a0 = rng.next() * 6.28;
    // (Weathered grey-buff, darker than the stone's sunlit top: bright cones read as spray.)
    const base = [0.2 * tone, 0.19 * tone, 0.17 * tone];
    const rim = [0.34 * tone, 0.32 * tone, 0.28 * tone];
    const hole = [0.1, 0.09, 0.08];
    const cx = [x, y + h * 0.55, z];
    for (let i = 0; i < sides; i++) {
      const a = a0 + (i / sides) * 6.283;
      const b = a0 + ((i + 1) / sides) * 6.283;
      const w = 1 + (rng.next() - 0.5) * 0.2;
      const B0 = [x + Math.cos(a) * r * w, y - 0.01, z + Math.sin(a) * r * w];
      const B1 = [x + Math.cos(b) * r, y - 0.01, z + Math.sin(b) * r];
      const T0 = [x + Math.cos(a) * r * 0.42, y + h, z + Math.sin(a) * r * 0.42];
      const T1 = [x + Math.cos(b) * r * 0.42, y + h, z + Math.sin(b) * r * 0.42];
      tri(B0, T0, B1, base, rim, base);
      tri(B1, T0, T1, base, rim, rim);
      tri(T0, cx, T1, rim, hole, rim);
    }
  };
  /** A limpet: a low ribbed cone, off-centre apex, banded brown / cream. */
  const limpet = (x: number, y: number, z: number, r: number): void => {
    const sides = 8;
    const a0 = rng.next() * 6.28;
    const ap = [x + (rng.next() - 0.5) * r * 0.3, y + r * (0.5 + rng.next() * 0.2), z + (rng.next() - 0.5) * r * 0.3];
    const tip = [0.78, 0.72, 0.6];
    for (let i = 0; i < sides; i++) {
      const a = a0 + (i / sides) * 6.283;
      const b = a0 + ((i + 1) / sides) * 6.283;
      const c = i % 2 ? [0.42, 0.33, 0.24] : [0.62, 0.54, 0.42];
      tri([x + Math.cos(a) * r, y - 0.005, z + Math.sin(a) * r], ap, [x + Math.cos(b) * r, y - 0.005, z + Math.sin(b) * r], c, tip, c);
    }
  };
  const cluster = (x: number, z: number, spread: number, n: number, limpets: number): void => {
    // Packed tighter in the middle; bigger barnacles in the middle, a fringe of small ones.
    for (let i = 0; i < n; i++) {
      const rr = Math.pow(rng.next(), 0.8) * spread;
      const a = rng.next() * 6.283;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr * 0.8;
      const r = (0.03 + rng.next() * 0.035) * (1.15 - (rr / spread) * 0.5);
      barnacle(px, heightAt(px, pz), pz, r, 0.8 + rng.next() * 0.3);
    }
    for (let i = 0; i < limpets; i++) {
      const rr = (0.6 + rng.next() * 0.6) * spread;
      const a = rng.next() * 6.283;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      limpet(px, heightAt(px, pz), pz, 0.035 + rng.next() * 0.03);
    }
  };
  let placed = 0;
  // The wet sea rim: dense colonies.
  for (let i = 0; i < 900 && placed < 70; i++) {
    const x = -5 + rng.next() * 26;
    const z = 36 + rng.next() * 18;
    const wr = S.westRock(x, z);
    if (wr < -0.25 || wr > 0.04) continue;
    if (poolD(x, z) < 1.1 || heightAt(x, z) > 0.8) continue;
    cluster(x, z, 0.2 + rng.next() * 0.25, 22 + Math.floor(rng.next() * 20), Math.floor(rng.next() * 3));
    placed++;
  }
  // (No colonies on the pool walls: on the steep bowl they stack into vertical streaks that read
  // as spray.)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  mat.name = 'shelfCrust';
  applyWorldFx(mat, { snowUp: 0.7 });
  const m = new THREE.Mesh(g, mat);
  m.name = 'shelf-crust';
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.perfTag = 'props';
  return m;
}
