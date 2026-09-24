/**
 * BatchedMesh per-camera draw-list cache (DESIGN pillar 14).
 *
 * Stock three rebuilds a BatchedMesh's visible-instance list and re-uploads its indirect
 * texture (texSubImage2D + setTextureParameters) in EVERY pass it is drawn in — main, sun shadow
 * and the GTAO normal pass — because the three cameras produce different lists and there is only
 * one indirect texture. With ~40 per-object-culled batches that was ~110 uploads and ~440
 * texParameteri per frame in town (≈ half the main thread).
 *
 * This patch keeps one draw list + indirect texture PER CAMERA and only:
 *   - re-culls when the camera × mesh matrix or the batch contents changed, and
 *   - re-uploads when the resulting list actually differs from the one on the GPU.
 * Result: a still camera costs zero culling and zero uploads; a moving camera re-culls but
 * uploads only when an instance enters / leaves the frustum. Per-instance culling, sorting and
 * rendering are otherwise identical to three's (sorted batches fall back to the stock path).
 *
 * Toggle for A/B: `setBatchCache(false)` restores the stock behaviour at runtime.
 */
import * as THREE from 'three';

interface Slot {
  tex: THREE.DataTexture;
  starts: Int32Array;
  counts: Int32Array;
  count: number;
  bpe: number;
  /** camera.projection × camera.viewInverse × mesh.matrixWorld of the last cull. */
  key: Float64Array;
  ver: number;
}

interface CacheState {
  slots: Map<THREE.Camera | null, Slot>;
  ver: number;
  cap: number;
  base: THREE.DataTexture;
}

type Internal = THREE.BatchedMesh & {
  _hvCache?: CacheState;
  _visibilityChanged: boolean;
  _maxInstanceCount: number;
  _indirectTexture: THREE.DataTexture;
  _matricesTexture: THREE.DataTexture;
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _multiDrawBytesPerElement: number;
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  _geometryInfo: { start: number; count: number; boundingSphere: THREE.Sphere | null }[];
};

const proto = THREE.BatchedMesh.prototype as unknown as Internal & {
  onBeforeRender: (r: THREE.WebGLRenderer, s: THREE.Scene | null, c: THREE.Camera, g: THREE.BufferGeometry, m: THREE.Material) => void;
};
const stockBeforeRender = proto.onBeforeRender;
const stockSetMatrixAt = proto.setMatrixAt;
const stockDispose = proto.dispose;
const stockSetInstanceCount = proto.setInstanceCount;

let enabled = true;
const _m = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

/** Runtime switch (A/B perf experiments). */
export function setBatchCache(on: boolean): void {
  enabled = on;
}
export function batchCacheEnabled(): boolean {
  return enabled;
}

function state(mesh: Internal): CacheState {
  let st = mesh._hvCache;
  if (!st || st.cap !== mesh._maxInstanceCount) {
    if (st) for (const s of st.slots.values()) if (s.tex !== st.base) s.tex.dispose();
    st = { slots: new Map(), ver: 0, cap: mesh._maxInstanceCount, base: mesh._indirectTexture };
    mesh._hvCache = st;
  }
  return st;
}

function newSlot(mesh: Internal, st: CacheState): Slot {
  const cap = st.cap;
  const img = st.base.image as { width: number; height: number };
  // The first slot reuses the batch's own indirect texture; further cameras get their own.
  const baseUsed = [...st.slots.values()].some((s) => s.tex === st.base);
  const tex = !baseUsed ? st.base : new THREE.DataTexture(new Uint32Array(img.width * img.height), img.width, img.height, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  void mesh;
  return { tex, starts: new Int32Array(cap), counts: new Int32Array(cap), count: 0, bpe: 0, key: new Float64Array(16).fill(NaN), ver: -1 };
}

function cachedBeforeRender(this: Internal, renderer: THREE.WebGLRenderer, scene: THREE.Scene | null, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material): void {
  if (!enabled || this.sortObjects || (camera as THREE.ArrayCamera).isArrayCamera || (material as THREE.Material & { wireframe?: boolean }).wireframe) {
    // Stock path; make sure the stock arrays / texture are in place.
    const st = this._hvCache;
    if (st) {
      this._indirectTexture = st.base;
      this._hvCache = undefined;
      this._multiDrawStarts = new Int32Array(this._maxInstanceCount);
      this._multiDrawCounts = new Int32Array(this._maxInstanceCount);
      this._visibilityChanged = true;
      for (const s of st.slots.values()) if (s.tex !== st.base) s.tex.dispose();
    }
    stockBeforeRender.call(this, renderer, scene, camera, geometry, material);
    return;
  }
  const st = state(this);
  if (this._visibilityChanged) {
    st.ver++;
    this._visibilityChanged = false;
  }
  const cull = this.perObjectFrustumCulled;
  // Without per-object culling the list is camera-independent: one shared slot.
  const slotKey = cull ? camera : null;
  let slot = st.slots.get(slotKey);
  if (!slot) {
    // Guard against throwaway cameras: keep at most a handful of slots.
    if (st.slots.size >= 6) {
      for (const [k, s] of st.slots) if (s.tex !== st.base) {
        s.tex.dispose();
        st.slots.delete(k);
      }
    }
    st.slots.set(slotKey, (slot = newSlot(this, st)));
  }

  const index = geometry.getIndex();
  const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;

  let same = slot.ver === st.ver && slot.bpe === bpe;
  if (cull) {
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    const e = _m.elements;
    const k = slot.key;
    for (let i = 0; i < 16; i++) {
      if (k[i] !== e[i]) {
        same = false;
        k[i] = e[i]!;
      }
    }
  }

  if (!same) {
    slot.ver = st.ver;
    slot.bpe = bpe;
    if (cull) _frustum.setFromProjectionMatrix(_m, camera.coordinateSystem, (camera as THREE.Camera & { reversedDepth?: boolean }).reversedDepth);
    const info = this._instanceInfo;
    const geos = this._geometryInfo;
    const mats = this._matricesTexture.image.data as Float32Array;
    const indirect = slot.tex.image.data as Uint32Array;
    const starts = slot.starts;
    const counts = slot.counts;
    let n = 0;
    let changed = false;
    for (let i = 0, l = info.length; i < l; i++) {
      const inst = info[i]!;
      if (!inst.visible || !inst.active) continue;
      const gi = inst.geometryIndex;
      if (cull) {
        let bs = geos[gi]!.boundingSphere;
        if (!bs) {
          this.getBoundingSphereAt(gi, _sphere); // computes + caches geometryInfo.boundingSphere
          bs = geos[gi]!.boundingSphere;
          if (!bs) continue;
        }
        // Transform the local bounding sphere by the instance matrix (inlined applyMatrix4).
        const o = i * 16;
        const cx = bs.center.x, cy = bs.center.y, cz = bs.center.z;
        const m0 = mats[o]!, m1 = mats[o + 1]!, m2 = mats[o + 2]!, m4 = mats[o + 4]!, m5 = mats[o + 5]!, m6 = mats[o + 6]!, m8 = mats[o + 8]!, m9 = mats[o + 9]!, m10 = mats[o + 10]!;
        _sphere.center.set(m0 * cx + m4 * cy + m8 * cz + mats[o + 12]!, m1 * cx + m5 * cy + m9 * cz + mats[o + 13]!, m2 * cx + m6 * cy + m10 * cz + mats[o + 14]!);
        const s2 = Math.max(m0 * m0 + m1 * m1 + m2 * m2, m4 * m4 + m5 * m5 + m6 * m6, m8 * m8 + m9 * m9 + m10 * m10);
        _sphere.radius = bs.radius * Math.sqrt(s2);
        if (!_frustum.intersectsSphere(_sphere)) continue;
      }
      const g = geos[gi]!;
      const s = g.start * bpe;
      if (!changed && (indirect[n] !== i || n >= slot.count)) changed = true;
      starts[n] = s;
      counts[n] = g.count;
      indirect[n] = i;
      n++;
    }
    if (n !== slot.count) changed = true;
    slot.count = n;
    if (changed) slot.tex.needsUpdate = true;
  }

  this._indirectTexture = slot.tex;
  this._multiDrawStarts = slot.starts;
  this._multiDrawCounts = slot.counts;
  this._multiDrawCount = slot.count;
  this._multiDrawBytesPerElement = slot.bpe;
}

proto.onBeforeRender = cachedBeforeRender as typeof proto.onBeforeRender;

// Instance moves don't flag `_visibilityChanged` in three (the stock path re-culls every pass
// anyway); bump the cache version so moved instances are re-culled.
proto.setMatrixAt = function (this: Internal, id: number, matrix: THREE.Matrix4) {
  const r = stockSetMatrixAt.call(this, id, matrix);
  if (this._hvCache) this._hvCache.ver++;
  return r;
} as typeof proto.setMatrixAt;

// Growing the instance buffer swaps the indirect texture: restore the canonical one first so
// three copies / disposes the right texture, then drop the per-camera slots.
proto.setInstanceCount = function (this: Internal, n: number) {
  const st = this._hvCache;
  if (st) {
    this._indirectTexture = st.base;
    for (const s of st.slots.values()) if (s.tex !== st.base) s.tex.dispose();
    this._hvCache = undefined;
  }
  const r = stockSetInstanceCount.call(this, n);
  this._visibilityChanged = true;
  return r;
} as typeof proto.setInstanceCount;

proto.dispose = function (this: Internal) {
  const st = this._hvCache;
  if (st) {
    this._indirectTexture = st.base;
    for (const s of st.slots.values()) if (s.tex !== st.base) s.tex.dispose();
    this._hvCache = undefined;
  }
  return stockDispose.call(this);
} as typeof proto.dispose;
