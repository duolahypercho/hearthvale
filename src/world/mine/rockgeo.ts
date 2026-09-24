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
  /** 0 = pure flat facets, 1 = fully smooth normals (0.5 = soft-cut stone). */
  smooth?: number;
  /** Low-frequency lump displacement (fraction of the radius) before chiselling. */
  lumps?: number;
  /** 0..1 baked crevice AO (pushed-in regions darken). */
  crevice?: number;
  /**
   * Cleaved stone: the chisel planes become crisp flat faces with hard creases (and a worn,
   * lighter edge along each crease) while the rest of the boulder keeps its soft normals.
   */
  cleave?: boolean;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

/** Deterministic sum-of-sines 3D lump field (cheap, smooth, seeded). */
function lumpField(r: Rng): (x: number, y: number, z: number) => number {
  const waves: [number, number, number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const k = i < 3 ? 1.6 + r.next() * 1.2 : 3.2 + r.next() * 2.4;
    const th = r.next() * Math.PI * 2;
    const ph = Math.acos(r.next() * 2 - 1);
    waves.push([Math.sin(ph) * Math.cos(th) * k, Math.cos(ph) * k, Math.sin(ph) * Math.sin(th) * k, r.next() * 6.28, i < 3 ? 0.5 : 0.22]);
  }
  return (x, y, z) => {
    let s = 0;
    for (const [a, b, c, p, w] of waves) s += Math.sin(a * x + b * y + c * z + p) * w;
    return s / 2.2;
  };
}

export function facetRock(r: Rng, radius: number, color: number, o: FacetOpts = {}): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, o.detail ?? 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const planes: THREE.Vector3[] = [];
  const nPlanes = (o.chunky ? 3 : 2) + r.int(0, 2) + (o.cleave ? 1 : 0);
  for (let i = 0; i < nPlanes; i++) {
    const a = r.next() * Math.PI * 2;
    const el = i === 0 ? 1.1 + r.next() * 0.4 : 0.05 + r.next() * 0.9;
    planes.push(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)));
  }
  const offs = planes.map((_, i) => (i === 0 ? 0.6 : 0.68) + r.next() * 0.16);
  const cache = new Map<string, [number, number, number, number, number]>();
  const stretch = 0.85 + r.next() * 0.4;
  const lumps = o.lumps ?? 0;
  const field = lumps > 0 ? lumpField(r) : null;
  const jit = (o.chunky ? 0.22 : 0.17) * (lumps > 0 ? 0.35 : 1);
  const sq = o.squash ?? 0.7;
  const keys: string[] = new Array(pos.count);
  const lumpV = new Float32Array(pos.count);
  // Which chisel plane each vertex was cut onto (-1 = the natural surface).
  const cutV = new Int8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const key = `${_p.x.toFixed(3)},${_p.y.toFixed(3)},${_p.z.toFixed(3)}`;
    keys[i] = key;
    let v = cache.get(key);
    if (!v) {
      const lv = field ? field(_p.x, _p.y, _p.z) : 0;
      const q = _p.clone().multiplyScalar(1 + (r.next() * 2 - 1) * jit + lv * lumps);
      let cut = -1;
      let cutT = 0.004;
      planes.forEach((n, k) => {
        const t = q.dot(n) - offs[k]!;
        if (t > cutT) {
          cut = k;
          cutT = t;
        }
        if (t > 0) q.addScaledVector(n, -t * (o.cleave ? 1 : 0.92));
      });
      if (q.y < -0.3) q.y = -0.3 + (q.y + 0.3) * 0.12;
      q.x *= stretch;
      q.z /= Math.sqrt(stretch);
      q.y *= sq;
      v = [q.x * radius, q.y * radius, q.z * radius, lv, cut];
      cache.set(key, v);
    }
    pos.setXYZ(i, v[0], v[1], v[2]);
    lumpV[i] = v[3];
    cutV[i] = v[4];
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  // Soft-cut stone: blend the flat facet normals with the averaged (smooth) ones.
  const smooth = o.smooth ?? 0;
  if (smooth > 0) {
    const acc = new Map<string, THREE.Vector3>();
    for (let i = 0; i < pos.count; i++) {
      _n.fromBufferAttribute(nor, i);
      const a = acc.get(keys[i]!);
      if (a) a.add(_n);
      else acc.set(keys[i]!, _n.clone());
    }
    for (let i = 0; i < pos.count; i++) {
      _n.fromBufferAttribute(nor, i);
      const sm = acc.get(keys[i]!)!.clone().normalize();
      _n.lerp(sm, smooth).normalize();
      nor.setXYZ(i, _n.x, _n.y, _n.z);
    }
  }
  // Cleaved faces: every triangle lying wholly on one chisel plane takes that plane's (squashed)
  // normal — a crisp flat cut catching the lantern as one sheet, meeting the soft boulder at a hard
  // crease. Crease vertices (cut, in a mixed triangle) are remembered for the worn edge highlight.
  const face = new Int8Array(pos.count).fill(-1);
  const crease = new Uint8Array(pos.count);
  if (o.cleave) {
    const pn = planes.map((n) => new THREE.Vector3(n.x / stretch, n.y / sq, n.z * Math.sqrt(stretch)).normalize());
    for (let f = 0; f < pos.count; f += 3) {
      const c0 = cutV[f]!;
      if (c0 >= 0 && cutV[f + 1] === c0 && cutV[f + 2] === c0) {
        for (let k = 0; k < 3; k++) {
          nor.setXYZ(f + k, pn[c0]!.x, pn[c0]!.y, pn[c0]!.z);
          face[f + k] = c0;
        }
      } else for (let k = 0; k < 3; k++) if (cutV[f + k]! >= 0) crease[f + k] = 1;
    }
  }
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color).offsetHSL((r.next() - 0.5) * 0.02, (r.next() - 0.5) * 0.04, (r.next() - 0.5) * 0.05);
  const cap = o.cap !== undefined ? new THREE.Color(o.cap) : null;
  const yMin = -0.3 * sq * radius;
  const yMax = sq * radius;
  const rim = o.rim ?? 0.55;
  const spread = (o.facet ?? 0.2) * (smooth > 0 ? 0.55 : 1);
  const crev = o.crevice ?? (lumps > 0 ? 0.45 : 0);
  for (let f = 0; f < pos.count; f += 3) {
    let facet = 1 - spread / 2 + r.next() * spread;
    // A cleaved face is fresher stone: a touch lighter, one even value per plane.
    if (face[f]! >= 0) facet = 1.07 + (face[f]! % 3) * 0.035;
    _n.fromBufferAttribute(nor, f);
    const capT = cap ? THREE.MathUtils.smoothstep(_n.y, 0.35, 0.8) * (o.capAmt ?? 0.8) : 0;
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      _p.fromBufferAttribute(pos, i);
      const h = THREE.MathUtils.clamp((_p.y - yMin) / (yMax - yMin), 0, 1);
      const ao = (1 - rim + rim * THREE.MathUtils.smoothstep(h, 0.0, 0.5)) * (1 - crev + crev * THREE.MathUtils.smoothstep(lumpV[i]!, -0.55, 0.35));
      const cleaved = face[i]! >= 0;
      // (cut faces shed most of the crevice darkening: they are fresh planes, not pits)
      const aoK = cleaved ? 0.55 + 0.45 * ao : ao;
      _c.copy(base).multiplyScalar(aoK * facet * (0.94 + 0.14 * h) * (crease[i] ? 1.16 : 1));
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

/** Rounded lumpy knob (smooth normals), pivot at its centre: copper knobs, gold nuggets. */
export function knob(r: Rng, radius: number, detail = 1, squash = 0.8): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const f = lumpField(r);
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const key = `${_p.x.toFixed(4)},${_p.y.toFixed(4)},${_p.z.toFixed(4)}`;
    let v = cache.get(key);
    if (!v) {
      const s = 1 + f(_p.x / radius, _p.y / radius, _p.z / radius) * 0.28;
      v = [_p.x * s, _p.y * s * squash, _p.z * s];
      cache.set(key, v);
    }
    pos.setXYZ(i, v[0], v[1], v[2]);
  }
  const m = mergeVertsForNormals(g);
  return m;
}

function mergeVertsForNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  // Smooth normals on a non-indexed polyhedron: average per position.
  g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const acc = new Map<string, THREE.Vector3>();
  const keys: string[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    keys.push(k);
    _n.fromBufferAttribute(nor, i);
    const a = acc.get(k);
    if (a) a.add(_n);
    else acc.set(k, _n.clone());
  }
  for (let i = 0; i < pos.count; i++) {
    const n = acc.get(keys[i]!)!.clone().normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  g.deleteAttribute('uv');
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  const col = new Float32Array(pos.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Hexagonal crystal prism with a pointed tip (pivot at its base), flat shaded. */
export function crystalPrism(radius: number, height: number, tipFrac = 0.28): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(radius * 0.92, 0), new THREE.Vector2(radius, height * (1 - tipFrac)), new THREE.Vector2(0, height)];
  const g = new THREE.LatheGeometry(pts, 6).toNonIndexed();
  g.computeVertexNormals();
  return g;
}
