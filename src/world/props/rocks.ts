/**
 * Rocks for the Nature instanced sets: chunky faceted stones / boulders and pebble skirts.
 *
 * Built from a low-res icosphere (detail 1) with per-vertex jitter (±18 %), a few chiselled
 * planes (flat tops / cleft faces), a squashed height and a flattened base, then FLAT shaded so
 * every facet catches the light as its own plane (hand-cut, not a smooth potato). Vertex colour
 * carries one of three stone tints (warm grey, blue grey, sandstone), per-facet value jitter,
 * moss on up-facing facets (normal.y > 0.6 → 0x6f8f3a) and a dark AO rim at the ground contact.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, mat, boxUV } from '../geom';
import { materials } from '../../render/materials';
import type { InstancedPart } from './instanced';

/** Warm grey, blue grey, sandstone. */
export const ROCK_TINTS = [0xa59c8f, 0x8e98a4, 0xb8aa88] as const;
const MOSS = new THREE.Color(0x6f8f3a);
const LICHEN = new THREE.Color(0xc9c07a);

/**
 * Faceted rock geometry. `tint` indexes ROCK_TINTS. Origin = ground contact centre.
 * `chunky` adds an extra chisel plane and more jitter (boulders).
 */
export function rockGeometry(r: Rng, radius: number, tint: number, chunky = false): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const planes: THREE.Vector3[] = [];
  const nPlanes = (chunky ? 3 : 2) + r.int(0, 2);
  for (let i = 0; i < nPlanes; i++) {
    const a = r.next() * Math.PI * 2;
    const el = i === 0 ? 1.1 + r.next() * 0.4 : 0.1 + r.next() * 0.9;
    planes.push(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)));
  }
  const offs = planes.map((_, i) => (i === 0 ? 0.62 : 0.7) + r.next() * 0.14);
  // Jitter must agree across the (non-indexed) copies of a vertex → cache by position.
  const cache = new Map<string, [number, number, number]>();
  const p = new THREE.Vector3();
  const stretch = 0.85 + r.next() * 0.45;
  const jit = chunky ? 0.2 : 0.18;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    let v = cache.get(key);
    if (!v) {
      const q = p.clone().multiplyScalar(1 + (r.next() * 2 - 1) * jit);
      planes.forEach((n, k) => {
        const t = q.dot(n) - offs[k]!;
        if (t > 0) q.addScaledVector(n, -t * 0.92);
      });
      if (q.y < -0.3) q.y = -0.3 + (q.y + 0.3) * 0.12;
      q.x *= stretch;
      q.z *= 1 / Math.sqrt(stretch);
      q.y *= 0.64;
      v = [q.x * radius, q.y * radius, q.z * radius];
      cache.set(key, v);
    }
    pos.setXYZ(i, v[0], v[1], v[2]);
  }
  // Flat shading: face normals on the non-indexed triangle soup.
  g.computeVertexNormals();
  boxUV(g, 2.2 / Math.max(radius, 0.2));
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(ROCK_TINTS[tint % ROCK_TINTS.length]!).offsetHSL((r.next() - 0.5) * 0.02, (r.next() - 0.5) * 0.04, (r.next() - 0.5) * 0.05);
  const yMin = -0.3 * 0.64 * radius;
  const yMax = 0.64 * radius;
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    // Per-facet tone: every chiselled face a slightly different value (reads as cut stone).
    const facet = 0.9 + r.next() * 0.18;
    n.fromBufferAttribute(nor, f);
    const mossy = THREE.MathUtils.smoothstep(n.y, 0.6, 0.85) * (r.next() < 0.75 ? 1 : 0.3);
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      p.fromBufferAttribute(pos, i);
      const h = THREE.MathUtils.clamp((p.y - yMin) / (yMax - yMin), 0, 1);
      // Dark contact rim at the ground, lighter crown.
      const ao = 0.42 + 0.58 * THREE.MathUtils.smoothstep(h, 0.0, 0.45);
      c.copy(base).multiplyScalar(ao * facet * (0.96 + 0.1 * h));
      c.lerp(MOSS, mossy * (0.55 + 0.3 * h));
      if (mossy < 0.2 && h > 0.5 && (i * 7919) % 11 === 0) c.lerp(LICHEN, 0.35);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.translate(0, -yMin * 0.7, 0);
  return g;
}

export function buildRock(kind: 'stone' | 'boulder', r: Rng, variant: number): InstancedPart[] {
  const boulder = kind === 'boulder';
  const geo = rockGeometry(r, boulder ? 0.8 : 0.34, variant, boulder);
  if (boulder && r.next() < 0.8) {
    // A chip or two resting against the boulder's foot.
    const b = new MeshBuilder();
    const m = materials.get('rock');
    b.add(m, geo);
    for (let i = 0; i < 1 + r.int(0, 1); i++) {
      const a = r.next() * Math.PI * 2;
      b.add(m, rockGeometry(r, 0.16 + r.next() * 0.08, variant), mat(Math.cos(a) * 0.82, 0, Math.sin(a) * 0.7, 0, r.next() * 6, 0));
    }
    return [{ geometry: b.geometries().get(m)!, material: m }];
  }
  return [{ geometry: geo, material: materials.get('rock') }];
}

export function buildPebbles(r: Rng, variant: number): InstancedPart[] {
  const b = new MeshBuilder();
  const m = materials.get('rock');
  const n = 3 + r.int(0, 2);
  for (let i = 0; i < n; i++) {
    const g = rockGeometry(r, 0.07 + r.next() * 0.06, variant + i);
    const a = r.next() * Math.PI * 2;
    const d = 0.12 + r.next() * 0.3;
    b.add(m, g, mat(Math.cos(a) * d, 0, Math.sin(a) * d, 0, r.next() * 6, 0));
  }
  return [{ geometry: b.geometries().get(m)!, material: m, castShadow: false }];
}
