/**
 * Batched instancing.
 *
 * BatchPool: one THREE.BatchedMesh per (material, depth material, shadow flags, attribute layout).
 * Every geometry variant that shares a material lives in the same batch, so a whole forest of
 * oak/maple/pine variants is ONE multi-draw call per material, with per-instance frustum culling
 * (main camera and shadow camera) done by three on the CPU. Batches grow on demand.
 *
 * InstancedSet: one logical prop type rendered as N parts (e.g. trunk + foliage, stem + petals)
 * that share transforms. API:
 *   const set = new InstancedSet('rock', [{ geometry, material }], pool);
 *   const id = set.add(matrix, color);  set.setMatrix(id, m);  set.remove(id);  set.finalize();
 *
 * Shader patches must handle `USE_BATCHING` (batchingMatrix) next to `USE_INSTANCING`; the
 * helpers in render/wind.ts, render/worldfx.ts do.
 */
import * as THREE from 'three';

export interface InstancedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Receives per-instance colour (others stay white). */
  tinted?: boolean;
  depthMaterial?: THREE.Material;
}

const WHITE = new THREE.Color(1, 1, 1);

class BatchEntry {
  readonly mesh: THREE.BatchedMesh;
  private geoIds = new Map<THREE.BufferGeometry, number>();
  private maxV: number;
  private usedV = 0;
  private maxI: number;
  private usedI = 0;
  private maxInst: number;
  private instCount = 0;
  private colored = false;

  constructor(part: InstancedPart, name: string) {
    this.maxV = 16384;
    this.maxI = part.geometry.index ? 32768 : 0;
    this.maxInst = 64;
    this.mesh = new THREE.BatchedMesh(this.maxInst, this.maxV, this.maxI || this.maxV * 2, part.material);
    this.mesh.name = name;
    this.mesh.castShadow = part.castShadow ?? true;
    this.mesh.receiveShadow = part.receiveShadow ?? true;
    if (part.depthMaterial) this.mesh.customDepthMaterial = part.depthMaterial;
    // Per-instance culling happens inside the batch; the batch-level sphere is never stale.
    this.mesh.frustumCulled = false;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
  }

  geometryId(geo: THREE.BufferGeometry): number {
    let id = this.geoIds.get(geo);
    if (id !== undefined) return id;
    const v = geo.attributes.position!.count;
    const i = geo.index ? geo.index.count : 0;
    if (this.usedV + v > this.maxV || this.usedI + i > this.maxI) {
      while (this.usedV + v > this.maxV) this.maxV *= 2;
      if (geo.index) while (this.usedI + i > this.maxI) this.maxI *= 2;
      this.mesh.setGeometrySize(this.maxV, this.maxI || this.maxV * 2);
    }
    id = this.mesh.addGeometry(geo);
    this.usedV += v;
    this.usedI += i;
    this.geoIds.set(geo, id);
    return id;
  }

  addInstance(geoId: number, matrix: THREE.Matrix4, color: THREE.Color | null): number {
    if (this.instCount >= this.maxInst) {
      this.maxInst *= 2;
      this.mesh.setInstanceCount(this.maxInst);
    }
    const id = this.mesh.addInstance(geoId);
    this.instCount++;
    this.mesh.setMatrixAt(id, matrix);
    if (color || this.colored) {
      this.colored = true;
      this.mesh.setColorAt(id, color ?? WHITE);
    }
    return id;
  }

  deleteInstance(id: number): void {
    this.mesh.deleteInstance(id);
  }
}

export class BatchPool {
  readonly group = new THREE.Group();
  private entries = new Map<string, BatchEntry>();

  constructor(readonly name: string) {
    this.group.name = `batch:${name}`;
  }

  private static attrSig(g: THREE.BufferGeometry): string {
    return Object.keys(g.attributes).sort().join(',') + (g.index ? '|i' : '');
  }

  entry(part: InstancedPart): BatchEntry {
    const key = `${part.material.uuid}|${part.depthMaterial?.uuid ?? ''}|${part.castShadow ?? true}|${part.receiveShadow ?? true}|${BatchPool.attrSig(part.geometry)}`;
    let e = this.entries.get(key);
    if (!e) {
      e = new BatchEntry(part, `${this.name}:${part.material.name || 'mat'}`);
      this.entries.set(key, e);
      this.group.add(e.mesh);
    }
    return e;
  }

  /** All batch meshes drawing with `material` (e.g. to hide deciduous foliage in winter). */
  meshesFor(material: THREE.Material): THREE.BatchedMesh[] {
    const out: THREE.BatchedMesh[] = [];
    for (const e of this.entries.values()) if (e.mesh.material === material) out.push(e.mesh);
    return out;
  }

  get meshes(): THREE.BatchedMesh[] {
    return [...this.entries.values()].map((e) => e.mesh);
  }
}

export class InstancedSet {
  private parts: { entry: BatchEntry; geoId: number; tinted: boolean }[];
  /** Per logical instance: batch instance ids per part (null = removed). */
  private ids: (number[] | null)[] = [];
  private visible = true;

  constructor(
    readonly name: string,
    parts: InstancedPart[],
    readonly pool: BatchPool,
  ) {
    this.parts = parts.map((p) => {
      const entry = pool.entry(p);
      return { entry, geoId: entry.geometryId(p.geometry), tinted: p.tinted ?? false };
    });
  }

  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    const ids = this.parts.map((p) => {
      const id = p.entry.addInstance(p.geoId, matrix, p.tinted ? (color ?? WHITE) : null);
      if (!this.visible) p.entry.mesh.setVisibleAt(id, false);
      return id;
    });
    this.ids.push(ids);
    return this.ids.length - 1;
  }

  setMatrix(i: number, matrix: THREE.Matrix4): void {
    const ids = this.ids[i];
    if (!ids) return;
    this.parts.forEach((p, k) => p.entry.mesh.setMatrixAt(ids[k]!, matrix));
  }

  setColor(i: number, color: THREE.Color): void {
    const ids = this.ids[i];
    if (!ids) return;
    this.parts.forEach((p, k) => {
      if (p.tinted) p.entry.mesh.setColorAt(ids[k]!, color);
    });
  }

  remove(i: number): void {
    const ids = this.ids[i];
    if (!ids) return;
    this.parts.forEach((p, k) => p.entry.deleteInstance(ids[k]!));
    this.ids[i] = null;
  }

  /** Show/hide every instance of this set (seasonal props). */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    for (const ids of this.ids) {
      if (!ids) continue;
      this.parts.forEach((p, k) => p.entry.mesh.setVisibleAt(ids[k]!, v));
    }
  }

  finalize(): void {
    /* batches update lazily; kept for API compatibility */
  }

  get size(): number {
    return this.ids.filter(Boolean).length;
  }
}
