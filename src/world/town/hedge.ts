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
import { MeshBuilder, roundedBox, mat, lumpySphere, sphericalNormals } from '../geom';

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
