/**
 * Faceted cave-rock geometry (no moss, unlike the meadow rocks): a jittered, chiselled icosphere,
 * flat shaded so every facet catches the lantern as its own plane. Vertex colour carries the
 * tint, per-facet value jitter, a dark contact rim and an optional cap (frost / soot / dust).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';

export interface FacetOpts {
  /** Height squash (1 = round). */
  squash?: number;
  /** Extra chisel planes + jitter. */
  chunky?: boolean;
  /** Up-facing facets blend towards this colour (frost / dust / ash). */
  cap?: number;
  capAmt?: number;
  /** 0..1 how dark the ground contact rim is. */
  rim?: number;
  detail?: number;
  /** Facet value spread. */
  facet?: number;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

export function facetRock(r: Rng, radius: number, color: number, o: FacetOpts = {}): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, o.detail ?? 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const planes: THREE.Vector3[] = [];
  const nPlanes = (o.chunky ? 3 : 2) + r.int(0, 2);
  for (let i = 0; i < nPlanes; i++) {
    const a = r.next() * Math.PI * 2;
    const el = i === 0 ? 1.1 + r.next() * 0.4 : 0.05 + r.next() * 0.9;
    planes.push(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)));
  }
  const offs = planes.map((_, i) => (i === 0 ? 0.6 : 0.68) + r.next() * 0.16);
  const cache = new Map<string, [number, number, number]>();
  const stretch = 0.85 + r.next() * 0.4;
  const jit = o.chunky ? 0.22 : 0.17;
  const sq = o.squash ?? 0.7;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const key = `${_p.x.toFixed(3)},${_p.y.toFixed(3)},${_p.z.toFixed(3)}`;
    let v = cache.get(key);
    if (!v) {
      const q = _p.clone().multiplyScalar(1 + (r.next() * 2 - 1) * jit);
      planes.forEach((n, k) => {
        const t = q.dot(n) - offs[k]!;
        if (t > 0) q.addScaledVector(n, -t * 0.92);
      });
      if (q.y < -0.3) q.y = -0.3 + (q.y + 0.3) * 0.12;
      q.x *= stretch;
      q.z /= Math.sqrt(stretch);
      q.y *= sq;
      v = [q.x * radius, q.y * radius, q.z * radius];
      cache.set(key, v);
    }
    pos.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color).offsetHSL((r.next() - 0.5) * 0.02, (r.next() - 0.5) * 0.04, (r.next() - 0.5) * 0.05);
  const cap = o.cap !== undefined ? new THREE.Color(o.cap) : null;
  const yMin = -0.3 * sq * radius;
  const yMax = sq * radius;
  const rim = o.rim ?? 0.55;
  const spread = o.facet ?? 0.2;
  for (let f = 0; f < pos.count; f += 3) {
    const facet = 1 - spread / 2 + r.next() * spread;
    _n.fromBufferAttribute(nor, f);
    const capT = cap ? THREE.MathUtils.smoothstep(_n.y, 0.35, 0.8) * (o.capAmt ?? 0.8) : 0;
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      _p.fromBufferAttribute(pos, i);
      const h = THREE.MathUtils.clamp((_p.y - yMin) / (yMax - yMin), 0, 1);
      const ao = 1 - rim + rim * THREE.MathUtils.smoothstep(h, 0.0, 0.5);
      _c.copy(base).multiplyScalar(ao * facet * (0.94 + 0.14 * h));
      if (cap) _c.lerp(cap, capT * (0.6 + 0.4 * h));
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  g.translate(0, -yMin * 0.7, 0);
  return g;
}

/** Hexagonal crystal prism with a pointed tip (pivot at its base), flat shaded. */
export function crystalPrism(radius: number, height: number, tipFrac = 0.28): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(radius * 0.92, 0), new THREE.Vector2(radius, height * (1 - tipFrac)), new THREE.Vector2(0, height)];
  const g = new THREE.LatheGeometry(pts, 6).toNonIndexed();
  g.computeVertexNormals();
  return g;
}
