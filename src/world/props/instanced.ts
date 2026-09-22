/**
 * InstancedSet: one logical prop type rendered as N InstancedMesh "parts" that share
 * transforms (e.g. flower stems + tinted petals, tree trunk + foliage).
 *   const set = new InstancedSet('rock', [{ geometry, material }], 256);
 *   const id = set.add(matrix, color);  set.remove(id);  set.finalize();
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

export class InstancedSet {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  private count = 0;
  private free: number[] = [];
  private static zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private white = new THREE.Color(1, 1, 1);

  constructor(
    readonly name: string,
    parts: InstancedPart[],
    readonly capacity: number,
  ) {
    this.group.name = name;
    for (const p of parts) {
      const m = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      m.count = 0;
      m.castShadow = p.castShadow ?? true;
      m.receiveShadow = p.receiveShadow ?? true;
      if (p.depthMaterial) m.customDepthMaterial = p.depthMaterial;
      m.name = `${name}:${p.material.name || 'part'}`;
      m.userData.tinted = p.tinted ?? false;
      m.frustumCulled = true;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    const i = this.free.length ? this.free.pop()! : this.count++;
    if (i >= this.capacity) throw new Error(`[InstancedSet] ${this.name} capacity ${this.capacity} exceeded`);
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.setColorAt(i, m.userData.tinted && color ? color : this.white);
      m.count = Math.max(m.count, i + 1);
    }
    return i;
  }

  setMatrix(i: number, matrix: THREE.Matrix4): void {
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  remove(i: number): void {
    this.setMatrix(i, InstancedSet.zero);
    this.free.push(i);
  }

  finalize(): void {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      m.computeBoundingBox();
    }
  }

  get size(): number {
    return this.count - this.free.length;
  }
}
