/**
 * Procedural geometry helpers: rounded/bevelled primitives, lumpy blobs, vertex-color AO baking,
 * and MeshBuilder which merges many parts into one mesh per material (few draw calls).
 *
 * Every geometry going through `prep()` is non-indexed and has position/normal/uv/color,
 * so anything can be merged with anything.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Rng } from '../core/rng';
import type { MaterialName } from '../render/materials';
import { materials } from '../render/materials';
import { Noise2D } from '../core/noise';

export type AOFn = (p: THREE.Vector3, n: THREE.Vector3) => number;

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Normalize a geometry: non-indexed, has uv + color. Optional tint and AO (in local space). */
export function prep(geo: THREE.BufferGeometry, tint?: THREE.ColorRepresentation, ao?: AOFn): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const k of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position!.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  const tc = new THREE.Color(tint ?? 0xffffff);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  let col = g.attributes.color as THREE.BufferAttribute | undefined;
  if (!col) {
    col = new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3);
    g.setAttribute('color', col);
  }
  for (let i = 0; i < count; i++) {
    let a = 1;
    if (ao) {
      _p.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(nor, i);
      a = ao(_p, _n);
    }
    col.setXYZ(i, col.getX(i) * tc.r * a, col.getY(i) * tc.g * a, col.getZ(i) * tc.b * a);
  }
  g.groups.length = 0;
  return g;
}

/** Ground-contact AO: darker near local y=0 (in world after transform, use aoWorld). */
export const groundAO =
  (height = 0.6, min = 0.55): AOFn =>
  (p) =>
    min + (1 - min) * THREE.MathUtils.smoothstep(p.y, 0, height);

export function roundedBox(w: number, h: number, d: number, r = 0.06, seg = 2): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  // Thin slats / small bevels read identically with a single corner segment (108 vs 300 tris).
  const s = rr < 0.03 || Math.min(w, h, d) < 0.12 ? 1 : seg;
  return new RoundedBoxGeometry(w, h, d, s, Math.max(rr, 0.001));
}

/** Cylinder with bevelled top/bottom edges (lathe). */
export function bevelCylinder(rTop: number, rBot: number, h: number, bevel = 0.04, radial = 12): THREE.BufferGeometry {
  const b = Math.min(bevel, h / 3, rTop * 0.9, rBot * 0.9);
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(rBot - b, 0),
    new THREE.Vector2(rBot - b * 0.3, b * 0.3),
    new THREE.Vector2(rBot, b),
    new THREE.Vector2(rTop, h - b),
    new THREE.Vector2(rTop - b * 0.3, h - b * 0.3),
    new THREE.Vector2(rTop - b, h),
    new THREE.Vector2(0, h),
  ];
  return new THREE.LatheGeometry(pts, radial);
}

/** Lumpy icosphere blob: noise-displaced, for foliage, bushes, rocks, clouds. */
export function lumpySphere(radius: number, detail: number, amp: number, rng: Rng, freq = 1.6): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const noise = new Noise2D(Math.floor(rng.next() * 1e9));
  const pos = g.attributes.position as THREE.BufferAttribute;
  // Deduplicate vertices so displacement stays watertight.
  const map = new Map<string, number>();
  const disp: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const key = `${_p.x.toFixed(4)},${_p.y.toFixed(4)},${_p.z.toFixed(4)}`;
    let d = map.get(key);
    if (d === undefined) {
      const nx = _p.x / radius;
      const ny = _p.y / radius;
      const nz = _p.z / radius;
      d = 1 + amp * (noise.get(nx * freq + nz * 0.7, ny * freq - nz * 0.3) * 0.7 + noise.get(nx * freq * 2.3, nz * freq * 2.3 + ny) * 0.3);
      map.set(key, d);
    }
    disp.push(d);
  }
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).multiplyScalar(disp[i]!);
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  return smoothNormals(g);
}

/** Smooth (position-welded) vertex normals for a non-indexed geometry. */
export function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const acc = new Map<string, THREE.Vector3>();
  const keys: string[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    keys.push(`${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`);
  }
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    for (let k = 0; k < 3; k++) {
      const key = keys[i + k]!;
      let v = acc.get(key);
      if (!v) {
        v = new THREE.Vector3();
        acc.set(key, v);
      }
      v.add(n);
    }
  }
  const nor = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = acc.get(keys[i]!)!.clone().normalize();
    nor[i * 3] = v.x;
    nor[i * 3 + 1] = v.y;
    nor[i * 3 + 2] = v.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** Spherical normals: point normals away from `center` (soft stylized foliage lighting). */
export function sphericalNormals(g: THREE.BufferGeometry, center: THREE.Vector3, blend = 0.7): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    v.copy(_p).sub(center).normalize();
    _n.lerp(v, blend).normalize();
    nor.setXYZ(i, _n.x, _n.y, _n.z);
  }
  return g;
}

/** Transform helper: build a matrix from position / euler / scale. */
export function mat(
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Scale UVs of a geometry (for tiling textures in world-ish units). */
export function uvScale(g: THREE.BufferGeometry, su: number, sv = su): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** Box-project UVs from local position (world-scale texturing on arbitrary shapes). */
export function boxUV(g: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = _p.x;
      v = _p.z;
    } else if (ax >= az) {
      u = _p.z;
      v = _p.y;
    } else {
      u = _p.x;
      v = _p.y;
    }
    uvs[i * 2] = u * scale;
    uvs[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

interface Part {
  geo: THREE.BufferGeometry;
}

/** Materials that are a tinted copy of another (see MeshBuilder.add). */
const MATERIAL_ALIAS: Partial<Record<MaterialName, { to: MaterialName; tint: number }>> = {
  woodDark: { to: 'woodGrain', tint: 0x8a6a55 },
  cloth: { to: 'white', tint: 0xffffff },
  soilPot: { to: 'white', tint: 0xb8643e },
};

/**
 * Accumulates parts per material and merges them.
 *   const b = new MeshBuilder();
 *   b.add('wood', roundedBox(1,1,1), mat(0,0.5,0), { tint: 0xffeedd, ao: groundAO() });
 *   group.add(b.build({ castShadow: true }));
 * `aoWorld` receives the transformed (builder-space) position, handy for contact shadows.
 */
export class MeshBuilder {
  private parts = new Map<MaterialName | THREE.Material, Part[]>();

  add(
    material: MaterialName | THREE.Material,
    geo: THREE.BufferGeometry,
    matrix?: THREE.Matrix4,
    opts: { tint?: THREE.ColorRepresentation; ao?: AOFn; aoWorld?: AOFn } = {},
  ): this {
    // Material aliases: variants that only differ by base colour share one material (fewer draw
    // calls after merging); the colour moves into the vertex tint.
    const alias = typeof material === 'string' ? MATERIAL_ALIAS[material] : undefined;
    if (alias) {
      material = alias.to;
      const t = new THREE.Color(opts.tint ?? 0xffffff).multiply(new THREE.Color(alias.tint));
      opts = { ...opts, tint: t };
    }
    let g = prep(geo, opts.tint, opts.ao);
    if (matrix) g.applyMatrix4(matrix);
    if (opts.aoWorld) {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const nor = g.attributes.normal as THREE.BufferAttribute;
      const col = g.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        _p.fromBufferAttribute(pos, i);
        _n.fromBufferAttribute(nor, i);
        const a = opts.aoWorld(_p, _n);
        col.setXYZ(i, col.getX(i) * a, col.getY(i) * a, col.getZ(i) * a);
      }
    }
    let list = this.parts.get(material);
    if (!list) {
      list = [];
      this.parts.set(material, list);
    }
    list.push({ geo: g });
    g = g; // keep lint quiet
    return this;
  }

  /** Merge a finished builder into this one with a transform. */
  addBuilder(other: MeshBuilder, matrix: THREE.Matrix4): this {
    for (const [m, list] of other.parts) {
      for (const p of list) {
        const g = p.geo.clone().applyMatrix4(matrix);
        let dst = this.parts.get(m);
        if (!dst) {
          dst = [];
          this.parts.set(m, dst);
        }
        dst.push({ geo: g });
      }
    }
    return this;
  }

  /** Merged geometries per material (for instancing). */
  geometries(): Map<MaterialName | THREE.Material, THREE.BufferGeometry> {
    const out = new Map<MaterialName | THREE.Material, THREE.BufferGeometry>();
    for (const [m, list] of this.parts) {
      const merged = mergeGeometries(list.map((p) => p.geo));
      if (merged) out.set(m, merged);
    }
    return out;
  }

  build(opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Group {
    const group = new THREE.Group();
    group.name = opts.name ?? 'built';
    for (const [m, geo] of this.geometries()) {
      const material = typeof m === 'string' ? materials.get(m) : m;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.name = `${group.name}:${material.name}`;
      group.add(mesh);
    }
    return group;
  }
}

/**
 * Merge every plain static Mesh under `roots` into one mesh per (material, attribute layout,
 * shadow flags), baking world transforms. Meshes with custom depth materials, morphs,
 * instancing or `userData.dynamic` are left alone. Lights and other objects are kept.
 * Big draw-call saver for hand-placed props that never move.
 */
export function mergeStatic(roots: THREE.Object3D[], name = 'static'): THREE.Group {
  const out = new THREE.Group();
  out.name = name;
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
  const victims: THREE.Mesh[] = [];
  for (const r of roots) {
    r.updateMatrixWorld(true);
    r.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.BatchedMesh).isBatchedMesh) return;
      if (m.customDepthMaterial || m.userData.dynamic || Array.isArray(m.material)) return;
      const g = m.geometry;
      const sig = Object.keys(g.attributes).sort().join(',') + (g.index ? '|i' : '');
      const key = `${(m.material as THREE.Material).uuid}|${sig}|${m.castShadow}|${m.receiveShadow}`;
      let b = buckets.get(key);
      if (!b) {
        b = { material: m.material as THREE.Material, cast: m.castShadow, recv: m.receiveShadow, geos: [] };
        buckets.set(key, b);
      }
      const gg = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m.matrixWorld);
      b.geos.push(gg);
      victims.push(m);
    });
  }
  for (const v of victims) v.removeFromParent();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.name = `${name}:${b.material.name || 'mat'}`;
    out.add(mesh);
  }
  return out;
}
