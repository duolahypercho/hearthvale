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
  /** Shadow caster cull-volume version this list was culled with (-1 = none). */
  cv: number;
}

interface CacheState {
  slots: Map<THREE.Camera | null, Slot>;
  /** Depth-only passes of a batch with detail prefixes (shadow map, AO G-buffer) cull into their own slots. */
  dslots: Map<THREE.Camera | null, Slot>;
  ver: number;
  cap: number;
  base: THREE.DataTexture;
}

type Internal = THREE.BatchedMesh & {
  _hvCache?: CacheState;
  /** Per geometry id: vertex / index count of its non-detail prefix (geom.ts DETAIL_R). */
  _hvDetail?: (number | undefined)[];
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
let detailPass = false;
/** Runtime A/B for the detail prefix in depth-only passes. */
export const detailStats = { enabled: true };

/**
 * Depth-only pass flag (pillar 14): while set, batches draw only each geometry's non-detail prefix
 * (geom.ts DETAIL_R: moss, petals, beads), as the shadow pass always does. Set around the GTAO G-buffer.
 */
export function setDetailPass(on: boolean): void {
  detailPass = on;
}

/** Record a batch geometry's detail prefix (from MeshBuilder / mergeStatic `userData.shadowCount`). */
export function setBatchDetail(mesh: THREE.BatchedMesh, geometryId: number, geometry: THREE.BufferGeometry): void {
  const n = geometry.userData.shadowCount as number | undefined;
  if (n === undefined || geometry.index) return;
  const m = mesh as unknown as Internal;
  (m._hvDetail ??= [])[geometryId] = n;
}
const _m = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

/**
 * Shadow caster cull volume (pillar 14). The sun's ortho box is the light-space bounding rectangle of the
 * view's receivers, so its corners hold casters whose shadow can never reach the view (forest-fall:
 * 342k shadow triangles a frame vs 153k in the main pass — wind-swayed trees are re-drawn every frame).
 * render/lighting.ts hands over the light-space convex hull of the view's receivers as world planes
 * parallel to the light (the silhouette planes of a directional light's caster volume): a batched
 * instance wholly outside one of them (already widened by a margin) skips the shadow pass. The planes are
 * only re-committed after the view drifts past a fraction of the margin, so a still or slowly moving
 * camera does not re-cull (and the static shadow cache, keyed on the snapped sun box, stays whole).
 */
const MAX_CV = 16;
const _cv = { camera: null as THREE.Camera | null, planes: Array.from({ length: MAX_CV }, () => new THREE.Plane()), n: 0, ver: 0 };
export const shadowCullStats = { enabled: true, culled: 0, planes: 0, ver: 0 };

/** `planes` (inward normals, margin included) bound the casters that matter for `shadowCam`; null clears. */
export function setShadowCullPlanes(shadowCam: THREE.Camera | null, planes: readonly THREE.Plane[], n: number, drift: number): void {
  if (!shadowCam || !shadowCullStats.enabled || n <= 0 || n > MAX_CV) {
    if (_cv.camera) {
      _cv.camera = null;
      _cv.n = 0;
      _cv.ver++;
    }
    return;
  }
  let moved = n !== _cv.n || shadowCam !== _cv.camera;
  for (let i = 0; i < n && !moved; i++) {
    const a = planes[i]!;
    const b = _cv.planes[i]!;
    if (Math.abs(a.constant - b.constant) > drift || 1 - a.normal.dot(b.normal) > 4e-5) moved = true;
  }
  if (!moved) return;
  for (let i = 0; i < n; i++) _cv.planes[i]!.copy(planes[i]!);
  _cv.n = n;
  _cv.camera = shadowCam;
  _cv.ver++;
  shadowCullStats.planes = n;
  shadowCullStats.ver = _cv.ver;
}

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
    if (st) disposeSlots(st);
    st = { slots: new Map(), dslots: new Map(), ver: 0, cap: mesh._maxInstanceCount, base: mesh._indirectTexture };
    mesh._hvCache = st;
  }
  return st;
}

function disposeSlots(st: CacheState): void {
  for (const s of st.slots.values()) if (s.tex !== st.base) s.tex.dispose();
  for (const s of st.dslots.values()) if (s.tex !== st.base) s.tex.dispose();
}

function newSlot(mesh: Internal, st: CacheState): Slot {
  const cap = st.cap;
  const img = st.base.image as { width: number; height: number };
  // The first slot reuses the batch's own indirect texture; further cameras get their own.
  const baseUsed = [...st.slots.values(), ...st.dslots.values()].some((s) => s.tex === st.base);
  const tex = !baseUsed ? st.base : new THREE.DataTexture(new Uint32Array(img.width * img.height), img.width, img.height, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  void mesh;
  return { tex, starts: new Int32Array(cap), counts: new Int32Array(cap), count: 0, bpe: 0, key: new Float64Array(16).fill(NaN), ver: -1, cv: -1 };
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
      disposeSlots(st);
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
  // Shadow passes arrive via onBeforeShadow with a null scene.
  const det = detailStats.enabled && (scene === null || detailPass) ? this._hvDetail : undefined;
  const slots = det ? st.dslots : st.slots;
  // Without per-object culling the list is camera-independent: one shared slot.
  const slotKey = cull ? camera : null;
  let slot = slots.get(slotKey);
  if (!slot) {
    // Guard against throwaway cameras: keep at most a handful of slots.
    if (slots.size >= 6) {
      for (const [k, s] of slots) if (s.tex !== st.base) {
        s.tex.dispose();
        slots.delete(k);
      }
    }
    slots.set(slotKey, (slot = newSlot(this, st)));
  }

  const index = geometry.getIndex();
  const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;

  let same = slot.ver === st.ver && slot.bpe === bpe;
  const vol = cull && camera === _cv.camera && _cv.n > 0;
  const cvVer = cull && camera === _cv.camera ? _cv.ver : -1;
  if (cull && slot.cv !== cvVer) {
    same = false;
    slot.cv = cvVer;
  }
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
    const w = this.matrixWorld.elements;
    const ws = vol ? this.matrixWorld.getMaxScaleOnAxis() : 1;
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
        if (vol) {
          // The cull planes are in world space; the sphere is in the batch's local space.
          let out = false;
          const c = _sphere.center;
          const x = w[0]! * c.x + w[4]! * c.y + w[8]! * c.z + w[12]!;
          const y = w[1]! * c.x + w[5]! * c.y + w[9]! * c.z + w[13]!;
          const z = w[2]! * c.x + w[6]! * c.y + w[10]! * c.z + w[14]!;
          const rw = _sphere.radius * ws;
          for (let j = 0; j < _cv.n; j++) {
            const pl = _cv.planes[j]!;
            if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -rw) {
              out = true;
              break;
            }
          }
          if (out) {
            shadowCullStats.culled++;
            continue;
          }
        }
      }
      const g = geos[gi]!;
      const cnt = det ? (det[gi] ?? g.count) : g.count;
      if (cnt === 0) continue;
      const s = g.start * bpe;
      if (!changed && (indirect[n] !== i || n >= slot.count)) changed = true;
      starts[n] = s;
      counts[n] = cnt;
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
    disposeSlots(st);
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
    disposeSlots(st);
    this._hvCache = undefined;
  }
  return stockDispose.call(this);
} as typeof proto.dispose;
