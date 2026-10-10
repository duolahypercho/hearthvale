/**
 * Town hedge (r13 critic: "a hedge is a row of identical green balls — a caterpillar"): one clipped
 * hedge body instead of a string of beads — a long soft-boxed core, its top and faces broken by
 * overlapping lobes of uneven size, height and depth in three greens (dark inner shade low down, mid
 * body, sunlit sprigs on top), a few lighter new-growth tufts poking out of the crown and a darker
 * skirt where it meets the ground. One MeshBuilder build (batched by material like the rest of the
 * town's static props).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, mat, lumpySphere, sphericalNormals, boxUV } from '../geom';

export function buildTownHedge(rng: Rng, length: number): THREE.Group {
  const b = new MeshBuilder();
  const L = Math.max(1.2, length);
  // Core: a clipped box, slightly lumpy, so lobes never show daylight between them.
  b.add('boxFlower', roundedBox(L, 0.62, 0.66, 0.24, 3), mat(0, 0.36, 0), { tint: 0x2f6a26 });
  // Lobes along the crown and both faces: sizes drawn from a wide range, positions jittered so no two
  // neighbours rhyme.
  const n = Math.max(4, Math.round(L / 0.32));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = -L / 2 + t * L + (rng.next() - 0.5) * 0.18;
    const r = 0.2 + rng.next() * 0.17;
    const y = 0.5 + rng.next() * 0.2;
    const z = (rng.next() - 0.5) * 0.3;
    const g = lumpySphere(r, 1, 0.2, rng, 2.8);
    sphericalNormals(g, new THREE.Vector3(), 0.55);
    g.scale(1.15 + rng.next() * 0.3, 0.8 + rng.next() * 0.25, 1);
    const tone = rng.next();
    b.add('boxFlower', g, mat(x, y, z), { tint: tone < 0.33 ? 0x3c7a2c : tone < 0.7 ? 0x4a8a34 : 0x58983a });
  }
  for (const side of [-1, 1]) {
    const m = Math.max(3, Math.round(L / 0.45));
    for (let i = 0; i < m; i++) {
      const x = -L / 2 + ((i + 0.3 + rng.next() * 0.4) / m) * L;
      const r = 0.16 + rng.next() * 0.12;
      const g = lumpySphere(r, 1, 0.22, rng, 3);
      sphericalNormals(g, new THREE.Vector3(), 0.5);
      g.scale(1.2, 1, 0.7);
      b.add('boxFlower', g, mat(x, 0.24 + rng.next() * 0.22, side * (0.3 + rng.next() * 0.04)), { tint: rng.next() < 0.5 ? 0x356f28 : 0x407e2e });
    }
  }
  // New growth: small light sprigs breaking the clipped crown line.
  const k = Math.max(3, Math.round(L / 0.5));
  for (let i = 0; i < k; i++) {
    const g = lumpySphere(0.06 + rng.next() * 0.045, 1, 0.3, rng, 3.2);
    g.scale(1.3, 0.8, 1.1);
    b.add('boxFlower', g, mat(-L / 2 + rng.next() * L, 0.72 + rng.next() * 0.1, (rng.next() - 0.5) * 0.36), { tint: 0x68a43e });
  }
  // Skirt: the shaded bottom edge sinking into the turf.
  b.add('boxFlower', roundedBox(L + 0.08, 0.14, 0.74, 0.06, 2), mat(0, 0.06, 0), { tint: 0x22481c });
  return b.build({ name: 'hedge' });
}

const plantAO = (h: number, min: number) => (p: THREE.Vector3): number => min + (1 - min) * THREE.MathUtils.smoothstep(p.y, 0, h);

/**
 * Town r17 planter (critic: the stone planters held "a caterpillar of green balls with pastel eggs"):
 * a cottage-garden box — a low mound of small, uneven leaf lobes in three greens filling the soil,
 * trailing sprigs spilling over the front lip, five-petal blooms (petals round a contrasting eye) in
 * the box's colours scattered at different heights, and a few upright spikes of tiny buds. Same
 * footprint as the kit planter (1.3 x 0.7 m).
 */
export function buildTownPlanter(rng: Rng, colors: number[]): THREE.Group {
  const b = new MeshBuilder();
  b.add('stone', boxUV(roundedBox(1.3, 0.5, 0.7, 0.06), 1), mat(0, 0.25, 0), { tint: 0xd0c8ba, aoWorld: plantAO(0.25, 0.6) });
  b.add('white', roundedBox(1.2, 0.06, 0.6, 0.02), mat(0, 0.5, 0), { tint: 0x4a3222 });
  // Foliage mound: many small lobes, larger and darker at the core, lighter and smaller at the rim.
  const greens = [0x356f28, 0x407e2e, 0x4f9038, 0x5fa03e];
  for (let i = 0; i < 16; i++) {
    const u = rng.next() * 2 - 1;
    const v = rng.next() * 2 - 1;
    const core = 1 - Math.min(1, Math.hypot(u, v * 0.9));
    const r = 0.1 + 0.09 * core + rng.next() * 0.05;
    const g = lumpySphere(r, 1, 0.24, rng, 3);
    sphericalNormals(g, new THREE.Vector3(), 0.5);
    g.scale(1.2, 0.75 + rng.next() * 0.2, 1);
    b.add('boxFlower', g, mat(u * 0.5, 0.56 + core * 0.1 + rng.next() * 0.03, v * 0.22), { tint: greens[Math.min(3, Math.floor(rng.next() * 2 + (1 - core) * 2))]!, aoWorld: plantAO(0.75, 0.55) });
  }
  // A few leafy spills over the front lip (one lobe on the lip, a smaller one below it).
  for (let i = 0; i < 5; i++) {
    const x = -0.5 + (i / 4) * 1.0 + (rng.next() - 0.5) * 0.14;
    const g = lumpySphere(0.085 + rng.next() * 0.03, 1, 0.26, rng, 3.2);
    g.scale(1.5, 0.7, 0.8);
    b.add('boxFlower', g, mat(x, 0.5, 0.35), { tint: 0x4a8a34 });
    if (rng.next() < 0.6) {
      const h = lumpySphere(0.055, 1, 0.3, rng, 3.4);
      h.scale(1.3, 0.8, 0.7);
      b.add('boxFlower', h, mat(x + (rng.next() - 0.5) * 0.08, 0.42, 0.37), { tint: 0x5a9a3c });
    }
  }
  // Blooms: five petals round an eye, facing up and out.
  const petal = new THREE.SphereGeometry(0.05, 6, 4);
  petal.scale(1, 0.36, 0.64);
  const eye = new THREE.SphereGeometry(0.024, 6, 4);
  const n = 13;
  for (let i = 0; i < n; i++) {
    const c = colors[i % colors.length]!;
    const x = -0.52 + rng.next() * 1.04;
    const z = -0.08 + rng.next() * 0.36;
    const y = 0.76 + rng.next() * 0.06 - Math.abs(z - 0.05) * 0.2;
    const tilt = (rng.next() - 0.3) * 0.5;
    const yaw = rng.next() * Math.PI * 2;
    const sc = 0.8 + rng.next() * 0.5;
    const base = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(-tilt)).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeScale(sc, sc, sc));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const m = base.clone().multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeTranslation(0.047, 0, 0));
      b.add('boxFlower', petal.clone(), m, { tint: c });
    }
    const eyeC = c === 0xffffff || c === 0xfff6e0 ? 0xf2c43a : c === 0xffd166 ? 0x8a4a1e : 0xfff0c0;
    b.add('boxFlower', eye.clone(), base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.008, 0)), { tint: eyeC });
  }
  // A few upright spikes of tiny buds (lavender / foxglove), behind the blooms.
  for (let i = 0; i < 4; i++) {
    const x = -0.45 + (i / 3) * 0.9 + (rng.next() - 0.5) * 0.1;
    const z = -0.12 - rng.next() * 0.1;
    const h = 0.22 + rng.next() * 0.12;
    const c = i % 2 ? 0x9a7ad8 : 0xb88ae0;
    b.add('boxFlower', new THREE.CylinderGeometry(0.008, 0.012, h + 0.2, 4), mat(x, 0.66 + (h + 0.2) / 2 - 0.1, z), { tint: 0x3f7a2e });
    for (let k = 0; k < 8; k++) {
      const g = new THREE.SphereGeometry(0.032 - k * 0.0028, 5, 4);
      g.scale(1, 1.25, 1);
      b.add('boxFlower', g, mat(x + (k % 2 ? 0.012 : -0.012), 0.74 + (k / 7) * h, z), { tint: c });
    }
  }
  return b.build({ name: 'planter' });
}
