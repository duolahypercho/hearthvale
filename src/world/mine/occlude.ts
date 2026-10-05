/**
 * Mine see-through + foreground lift (shared by the cave shell, boulders, rocks and props).
 *
 *  - Cutaway: every farmer (local + co-op) and up to a few monsters get a screen-space ellipse
 *    around their body. Cave geometry that is IN FRONT of them (closer to the lens than they are)
 *    and above ankle height is cut away inside it, with a thin warm rim drawn along the cut edge,
 *    so nobody vanishes behind a pillar or a wall lip. Floor never gets cut (height test).
 *  - Foreground lift: the bottom band of the frame (rock between the lens and the floor) is pulled
 *    towards a dim biome tint instead of crushing to black holes beside the HUD.
 *
 * Everything is driven by shared uniforms (no recompiles per floor); `updateOcclusion` fills them
 * once a frame from the camera and the target positions.
 */
import * as THREE from 'three';
import { patchMaterial, after, before } from '../../render/patch';

export const OCC_MAX = 6;

export const OCC = {
  /** xy = screen px (gl_FragCoord space), z = radius px, w = view depth of the target. */
  uOcc: { value: Array.from({ length: OCC_MAX }, () => new THREE.Vector4(-1e4, -1e4, 0, 0)) },
  /** Feet height (world y) per target: geometry below feet + 0.35 m is never cut. */
  uOccY: { value: new Array<number>(OCC_MAX).fill(0) },
  /** Feet z (world) per target: only geometry SOUTH of the target (between it and the lens) is cut,
   * never the top of the wall behind it (that printed a ghost strip over the arrival ladder). */
  uOccZ: { value: new Array<number>(OCC_MAX).fill(0) },
  uOccN: { value: 0 },
  /** Frame buffer height (px) for the foreground band. */
  uOccH: { value: 0 },
  /** Dim tint the foreground band lifts towards (linear). */
  uFgLift: { value: new THREE.Color(0.03, 0.02, 0.014) },
  /** Camera projection x view (fragment shaders have no projectionMatrix). */
  uOccPV: { value: new THREE.Matrix4() },
};

const GLSL_PARS = /* glsl */ `
uniform vec4 uOcc[${OCC_MAX}];
uniform float uOccY[${OCC_MAX}];
uniform float uOccZ[${OCC_MAX}];
uniform int uOccN;
uniform float uOccH;
uniform vec3 uFgLift;
uniform mat4 uOccPV;
`;

/**
 * Patch a lit (Standard / Physical) material with the cutaway + foreground lift.
 * @param cut  false = only the foreground lift (e.g. the floor-only meshes).
 */
export function occlusionPatch<M extends THREE.Material>(m: M, cut = true, fgCut = false): M {
  // One occlusion patch per material: a clone re-patched with other options replaces it.
  const list = (m as M & { __hvPatches?: { key: string }[] }).__hvPatches;
  if (list) for (let i = list.length - 1; i >= 0; i--) if (list[i]!.key.startsWith('mine-occ:')) list.splice(i, 1);
  (m as OccMarked).__hvOcc = { cut, fg: fgCut };
  patchMaterial(m, `mine-occ:${cut ? 1 : 0}:${fgCut ? 1 : 0}`, (shader) => {
    shader.uniforms.uOcc = OCC.uOcc;
    shader.uniforms.uOccY = OCC.uOccY;
    shader.uniforms.uOccZ = OCC.uOccZ;
    shader.uniforms.uOccN = OCC.uOccN;
    shader.uniforms.uOccH = OCC.uOccH;
    shader.uniforms.uFgLift = OCC.uFgLift;
    shader.uniforms.uOccPV = OCC.uOccPV;
    let fs = before(shader.fragmentShader, 'void main() {', GLSL_PARS);
    fs = after(
      fs,
      'void main() {',
      cut
        ? `
      float hvOccRim = 0.0;
      {
        vec3 occV = -vViewPosition;
        // World position from view space (transpose of the view rotation).
        vec3 occW = (vec4(occV - viewMatrix[3].xyz, 0.0) * viewMatrix).xyz;
        for (int i = 0; i < ${OCC_MAX}; i++) {
          if (i >= uOccN) break;
          vec4 o = uOcc[i];
          vec2 d = (gl_FragCoord.xy - o.xy) / vec2(o.z * 0.72, o.z);
          float r = length(d);
          if (r < 1.0 && -occV.z < o.w - 0.55 && occW.y > uOccY[i] + 0.35 && occW.z > uOccZ[i] - 0.15) {
            if (r < 0.9) discard;
            hvOccRim = max(hvOccRim, 1.0 - abs(r - 0.95) / 0.05);
          }
        }
      }`
        : 'float hvOccRim = 0.0;',
    );
    // Free-standing props / rim boulders standing in the bottom band of the frame (between the lens
    // and the floor, under the toolbar) are removed down to their footprint, like a diorama's open
    // front, with a dim lip along the cut (no screen-door dither, no hollow stubs).
    fs = after(
      fs,
      'void main() {',
      fgCut
        ? `float hvFgRim = 0.0;
      {
        vec3 fgV = -vViewPosition;
        vec3 fgW = (vec4(fgV - viewMatrix[3].xyz, 0.0) * viewMatrix).xyz;
        // Band from where the fragment's FOOT lands on screen (its ground point), so a tall
        // column standing in the foreground is cut as a whole, not only its lower fragments.
        vec4 fgG = uOccPV * vec4(fgW.x, uOccY[0], fgW.z, 1.0);
        float fgGY = (fgG.y / max(fgG.w, 1e-3) * 0.5 + 0.5) * uOccH;
        // (near-binary: an object is either whole or gone down to its footprint — a half-height
        // stub showed its hollow, back-face-culled inside as black slivers)
        float fgBand = 1.0 - smoothstep(uOccH * 0.17, uOccH * 0.21, fgGY);
        float cutH = mix(60.0, 0.07, fgBand);
        float hh = fgW.y - uOccY[0];
        if (uOccN > 0 && fgBand > 0.01) {
          if (hh > cutH) discard;
          hvFgRim = (1.0 - smoothstep(0.0, 0.05, cutH - hh)) * smoothstep(0.0, 0.2, fgBand);
        }
      }`
        : 'float hvFgRim = 0.0;',
    );
    fs = after(
      fs,
      '#include <dithering_fragment>',
      `{
        // Foreground lift: rock in the bottom band keeps its FORM (a soft fake key from above-front
        // over its own albedo + the biome tint) instead of crushing into a flat black mass.
        float fgk = 1.0 - smoothstep(uOccH * 0.03, uOccH * 0.3, gl_FragCoord.y);
        float fgN = clamp(dot(normal, normalize(vec3(0.25, 0.85, 0.45))), 0.0, 1.0);
        vec3 fgForm = diffuseColor.rgb * (0.12 + 0.35 * fgN * fgN) + uFgLift * (1.6 + 3.0 * fgN);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, max(gl_FragColor.rgb * 0.9, fgForm), fgk);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.9, 0.6, 0.3), clamp(hvOccRim, 0.0, 1.0) * 0.55);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFgLift * 4.0 + diffuseColor.rgb * 0.25, clamp(hvFgRim, 0.0, 1.0) * 0.8);
      }`,
    );
    shader.fragmentShader = fs;
  });
  return m;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * Fill the cutaway slots. `targets` = feet positions (farmers first, then monsters), `heights` =
 * body height per target (m). Screen size in device px.
 */
export function updateOcclusion(cam: THREE.Camera, targets: { pos: THREE.Vector3; h: number }[], w: number, h: number): void {
  OCC.uOccH.value = h;
  OCC.uOccPV.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  let n = 0;
  const viewZ = (p: THREE.Vector3): number => -_w.copy(p).applyMatrix4(cam.matrixWorldInverse).z;
  for (const t of targets) {
    if (n >= OCC_MAX) break;
    _v.copy(t.pos);
    _v.y += t.h * 0.55;
    const depth = viewZ(_v);
    if (depth <= 0.5) continue;
    _v.project(cam);
    if (Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) continue;
    const sx = (_v.x * 0.5 + 0.5) * w;
    const sy = (_v.y * 0.5 + 0.5) * h;
    // Radius: the body's half height (+ a margin) in pixels.
    _w.copy(t.pos);
    _w.y += t.h * 1.25;
    _w.project(cam);
    const top = (_w.y * 0.5 + 0.5) * h;
    const r = Math.max(24, (top - sy) * 1.05);
    OCC.uOcc.value[n]!.set(sx, sy, r, depth);
    OCC.uOccY.value[n] = t.pos.y;
    OCC.uOccZ.value[n] = t.pos.z;
    n++;
  }
  OCC.uOccN.value = n;
  applyVariants(w, h);
}


// ───────────────────────────────────────────── cut / solid variants (DESIGN pillar 14)
//
// A `discard` anywhere in a fragment shader switches off hidden-surface removal on tile-based GPUs
// (every Apple GPU): each overdrawn layer of the heavy cave shader gets fully shaded even where
// nothing is ever cut (r10: mine-lava 124 -> 43-58 fps, 9.6 of 22.8 ms from the discard alone).
// So every cut-patched material gets a SOLID twin (same patches, cutaway compiled out: identical
// pixels outside the cut) and each frame the CPU hands the cut variant only to what can reach an
// active cutaway ellipse or the foreground band:
//  - floor-wide merged meshes flagged `userData.occGroup = n` (cave shell, rim boulders) get their
//    triangles sorted into OCC_CELL cells once; each frame the cells that can be cut become at most
//    n cut draw ranges (geometry groups over [solid, cut]), the rest one or two solid ranges,
//  - every other cut-patched mesh / batched mesh switches as a whole (per-instance bounds).
// `?occvar=0` turns it off (A/B); OCC_STATS.force = 'solid' shows the (wrong-picture) upper bound.

type OccMarked = THREE.Material & { __hvOcc?: { cut: boolean; fg: boolean }; __hvPatches?: { key: string; fn: Parameters<typeof patchMaterial>[2] }[] };

interface OccEntry {
  mesh: THREE.Mesh | THREE.BatchedMesh;
  cutMat: THREE.Material;
  solidMat: THREE.Material;
  /** World-space bounds: one per cell (grouped), per instance (batched) or one for the mesh. */
  boxes: THREE.Box3[];
  cut: boolean;
  fg: boolean;
  /** Grouped meshes: index start / count per cell (cells contiguous in index order), max cut ranges. */
  cellStart?: Int32Array;
  cellCount?: Int32Array;
  maxCut?: number;
  /** Scratch: per-cell need, cut runs [a0, b0, a1, b1, ...] in cell indices. */
  need?: Uint8Array;
  runs?: Int32Array;
  total?: number;
}

const OCC_CELL = 4;
const entries: OccEntry[] = [];
let variantsReady = false;
let scanGen = 0;
const variantsOn = ((): boolean => {
  try {
    const q = new URLSearchParams(location.search).get('occvar');
    return !(q === '0' || q === 'false');
  } catch {
    return true;
  }
})();

/** Debug / perf report: registered pieces, boxes, pieces / ranges drawing the cut variant this frame. */
export const OCC_STATS = { enabled: variantsOn, force: '' as '' | 'solid', solidOnly: '' as '' | 'grouped' | 'whole', ready: false, entries: 0, boxes: 0, cut: 0, cells: 0, cutCells: 0, groups: 0 };

const solidCache = new WeakMap<THREE.Material, THREE.Material>();
function solidOf(src: OccMarked): THREE.Material {
  const hit = solidCache.get(src);
  if (hit) return hit;
  const c = src.clone();
  c.name = `${src.name}+solid`;
  for (const p of src.__hvPatches ?? []) {
    if (p.key.startsWith('mine-occ:')) occlusionPatch(c, false, false);
    else patchMaterial(c, p.key, p.fn);
  }
  solidCache.set(src, c);
  src.addEventListener('dispose', () => c.dispose());
  return c;
}

function cutOf(m: THREE.Material | THREE.Material[] | undefined): OccMarked | null {
  if (!m || Array.isArray(m)) return null;
  const o = (m as OccMarked).__hvOcc;
  return o && (o.cut || o.fg) ? (m as OccMarked) : null;
}

/**
 * Sort a merged mesh's triangles into OCC_CELL cells (column-major for cut-only meshes: a farmer's
 * ellipse covers a short z-run in one or two columns; row-major for foreground-band meshes: the
 * band is the near rows) and rewrite its index in that order. Returns per-cell bounds + ranges.
 */
function sortCells(mesh: THREE.Mesh, rowMajor: boolean): { boxes: THREE.Box3[]; start: Int32Array; count: Int32Array; total: number } | null {
  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos || geo.groups.length > 1 || Object.keys(geo.morphAttributes).length) return null;
  const idx = geo.index;
  const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
  if (triCount < 64) return null;
  const mw = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const vi = (k: number): number => (idx ? idx.getX(k) : k);
  const cx = new Float32Array(triCount);
  const cz = new Float32Array(triCount);
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let t = 0; t < triCount; t++) {
    let sx = 0;
    let sz = 0;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, vi(t * 3 + k)).applyMatrix4(mw);
      sx += v.x;
      sz += v.z;
    }
    cx[t] = sx / 3;
    cz[t] = sz / 3;
    x0 = Math.min(x0, cx[t]!);
    x1 = Math.max(x1, cx[t]!);
    z0 = Math.min(z0, cz[t]!);
    z1 = Math.max(z1, cz[t]!);
  }
  const nx = Math.floor((x1 - x0) / OCC_CELL) + 1;
  const nz = Math.floor((z1 - z0) / OCC_CELL) + 1;
  if (nx * nz < 2) return null;
  const key = new Int32Array(triCount);
  const counts = new Int32Array(nx * nz);
  for (let t = 0; t < triCount; t++) {
    const ix = Math.min(nx - 1, Math.floor((cx[t]! - x0) / OCC_CELL));
    const iz = Math.min(nz - 1, Math.floor((cz[t]! - z0) / OCC_CELL));
    const k = rowMajor ? iz * nx + ix : ix * nz + iz;
    key[t] = k;
    counts[k]!++;
  }
  const offs = new Int32Array(nx * nz);
  for (let k = 1; k < nx * nz; k++) offs[k] = offs[k - 1]! + counts[k - 1]!;
  const order = new Int32Array(triCount);
  const fill = offs.slice();
  for (let t = 0; t < triCount; t++) order[fill[key[t]!]!++] = t;
  const big = pos.count > 65535;
  const out = big ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
  for (let o = 0; o < triCount; o++) {
    const t = order[o]!;
    out[o * 3] = vi(t * 3);
    out[o * 3 + 1] = vi(t * 3 + 1);
    out[o * 3 + 2] = vi(t * 3 + 2);
  }
  // Non-empty cells in index order, with their world bounds.
  const boxes: THREE.Box3[] = [];
  const st: number[] = [];
  const ct: number[] = [];
  for (let k = 0; k < nx * nz; k++) {
    if (!counts[k]) continue;
    const b = new THREE.Box3();
    for (let o = offs[k]!; o < offs[k]! + counts[k]!; o++) for (let j = 0; j < 3; j++) b.expandByPoint(v.fromBufferAttribute(pos, out[o * 3 + j]!).applyMatrix4(mw));
    boxes.push(b);
    st.push(offs[k]! * 3);
    ct.push(counts[k]! * 3);
  }
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  geo.clearGroups();
  return { boxes, start: Int32Array.from(st), count: Int32Array.from(ct), total: triCount * 3 };
}

/**
 * The cut / solid split only matters to the colour pass. Depth-only passes (the GTAO G-buffer with
 * its scene.overrideMaterial, shadow maps) draw the whole mesh in its first range and skip the
 * others (a negative count returns before the draw call), so the split costs no extra draws there.
 */
function collapseOffColour(mesh: THREE.Mesh, total: number): void {
  let ss = 0;
  let sc = 0;
  const collapse = (geo: THREE.BufferGeometry, g: THREE.Group | { start: number; count: number } | null): void => {
    const gr = g as { start: number; count: number } | null;
    if (!gr) return;
    ss = gr.start;
    sc = gr.count;
    if (gr === geo.groups[0]) {
      gr.start = 0;
      gr.count = total;
    } else gr.count = -1;
  };
  const restore = (g: unknown): void => {
    const gr = g as { start: number; count: number } | null;
    if (!gr) return;
    gr.start = ss;
    gr.count = sc;
  };
  const pb = mesh.onBeforeRender;
  const pa = mesh.onAfterRender;
  mesh.onBeforeRender = function (r, scene, cam, geo, mat, group) {
    pb.call(this, r, scene, cam, geo, mat, group);
    if (scene.overrideMaterial) collapse(geo, group);
  };
  mesh.onAfterRender = function (r, scene, cam, geo, mat, group) {
    if (scene.overrideMaterial) restore(group);
    pa.call(this, r, scene, cam, geo, mat, group);
  };
  mesh.onBeforeShadow = (_r, _o, _c, _sc, geo, _m, group) => collapse(geo, group);
  mesh.onAfterShadow = (_r, _o, _c, _sc, _geo, _m, group) => restore(group);
}

/**
 * Register every cut-patched mesh under `root` (a freshly built mine floor): sort the flagged
 * floor-wide ones into cells, build the solid twins and have `compile` build both programs
 * off-thread. Until that resolves every piece keeps its cut material (the pre-r11 look and cost).
 */
export function occlusionScan(root: THREE.Object3D, compile?: (root: THREE.Object3D) => Promise<unknown> | void): void {
  occlusionClear();
  if (!variantsOn) return;
  const gen = scanGen;
  root.updateMatrixWorld(true);
  const found: (THREE.Mesh | THREE.BatchedMesh)[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh & { isBatchedMesh?: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if ((m.isMesh || m.isBatchedMesh) && !m.isInstancedMesh && !m.isSkinnedMesh && cutOf(m.material)) found.push(m);
  });
  const mtx = new THREE.Matrix4();
  for (const m of found) {
    const cutMat = cutOf(m.material)!;
    const flags = cutMat.__hvOcc!;
    const solidMat = solidOf(cutMat);
    const base = { mesh: m, cutMat, solidMat, cut: flags.cut, fg: flags.fg };
    const bm = m as THREE.BatchedMesh;
    if (bm.isBatchedMesh) {
      const info = (bm as unknown as { _instanceInfo: { active: boolean; geometryIndex: number }[] })._instanceInfo;
      const boxes: THREE.Box3[] = [];
      for (let i = 0; i < info.length; i++) {
        if (!info[i]!.active) continue;
        bm.getMatrixAt(i, mtx);
        const b = bm.getBoundingBoxAt(info[i]!.geometryIndex, new THREE.Box3());
        if (b) boxes.push(b.applyMatrix4(mtx).applyMatrix4(bm.matrixWorld));
      }
      if (boxes.length) entries.push({ ...base, boxes });
      continue;
    }
    const mesh = m as THREE.Mesh;
    // Unflagged floor-wide merges (rubble, merged props per material) get one cut range.
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const wide = mesh.geometry.boundingSphere!.radius * mesh.matrixWorld.getMaxScaleOnAxis() > 6;
    const maxCut = (mesh.userData.occGroup as number | undefined) ?? (wide ? 1 : 0);
    const cells = maxCut > 0 ? sortCells(mesh, flags.fg) : null;
    if (cells) {
      mesh.material = [solidMat, cutMat];
      mesh.geometry.addGroup(0, cells.total, 1);
      collapseOffColour(mesh, cells.total);
      entries.push({ ...base, boxes: cells.boxes, cellStart: cells.start, cellCount: cells.count, maxCut, need: new Uint8Array(cells.boxes.length), runs: new Int32Array(cells.boxes.length * 2 + 2), total: cells.total });
      OCC_STATS.cells += cells.boxes.length;
      continue;
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    entries.push({ ...base, boxes: [mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)] });
  }
  OCC_STATS.entries = entries.length;
  OCC_STATS.boxes = entries.reduce((s, e) => s + e.boxes.length, 0);
  if (!entries.length) return;
  // Build both programs for every piece (grouped meshes carry both materials; the others get the
  // solid twin swapped in for the synchronous program build, then straight back), so a swap never
  // meets an uncompiled program (the shader gate would hold the piece out of the frame: a hole).
  const duck = {
    traverse: (cb: (o: THREE.Object3D) => void) => {
      for (const e of entries) {
        cb(e.mesh);
        if (e.cellStart) continue;
        e.mesh.material = e.solidMat;
        cb(e.mesh);
        e.mesh.material = e.cutMat;
      }
    },
    traverseVisible: () => {},
  } as unknown as THREE.Object3D;
  let job: Promise<unknown> | void = undefined;
  try {
    job = compile?.(duck);
  } catch {
    job = undefined;
  }
  const done = (): void => {
    if (gen !== scanGen) return;
    variantsReady = true;
    OCC_STATS.ready = true;
  };
  if (job && typeof (job as Promise<unknown>).then === 'function') void (job as Promise<unknown>).then(done, done);
  else done();
}

/** Forget the registered pieces (floor teardown): every piece back on its cut material. */
export function occlusionClear(): void {
  for (const e of entries) setAll(e, true);
  entries.length = 0;
  variantsReady = false;
  scanGen++;
  OCC_STATS.ready = false;
  OCC_STATS.entries = OCC_STATS.boxes = OCC_STATS.cut = OCC_STATS.cells = OCC_STATS.cutCells = OCC_STATS.groups = 0;
}

/** Whole piece on one variant. */
function setAll(e: OccEntry, cut: boolean): void {
  if (e.cellStart) {
    const geo = (e.mesh as THREE.Mesh).geometry;
    const g0 = geo.groups[0];
    if (geo.groups.length !== 1 || !g0) {
      geo.clearGroups();
      geo.addGroup(0, e.total!, cut ? 1 : 0);
    } else {
      g0.start = 0;
      g0.count = e.total!;
      g0.materialIndex = cut ? 1 : 0;
    }
    return;
  }
  const mat = cut ? e.cutMat : e.solidMat;
  if (e.mesh.material !== mat) e.mesh.material = mat;
}

const _c = new THREE.Vector4();
/** Pixel margin for the CPU test (rasterisation + a frame of camera drift between update and draw). */
const PAD = 24;

/** Can any fragment of `b` be cut by target `i` (shader conditions, conservatively)? */
function hitsEllipse(b: THREE.Box3, i: number, pv: THREE.Matrix4, w: number, h: number): boolean {
  const o = OCC.uOcc.value[i]!;
  const y0 = Math.max(b.min.y, OCC.uOccY.value[i]! + 0.35 - 0.05);
  const z0 = Math.max(b.min.z, OCC.uOccZ.value[i]! - 0.15 - 0.05);
  if (y0 > b.max.y || z0 > b.max.z) return false;
  let minW = Infinity;
  let x0 = Infinity;
  let x1 = -Infinity;
  let sy0 = Infinity;
  let sy1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    _c.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : y0, k & 4 ? b.max.z : z0, 1).applyMatrix4(pv);
    if (_c.w < 0.05) return true;
    minW = Math.min(minW, _c.w);
    const sx = (_c.x / _c.w * 0.5 + 0.5) * w;
    const sy = (_c.y / _c.w * 0.5 + 0.5) * h;
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    sy0 = Math.min(sy0, sy);
    sy1 = Math.max(sy1, sy);
  }
  if (minW >= o.w - 0.55 + 0.1) return false;
  const rx = o.z * 0.72 + PAD;
  const ry = o.z + PAD;
  return x1 >= o.x - rx && x0 <= o.x + rx && sy1 >= o.y - ry && sy0 <= o.y + ry;
}

/** Can any fragment of `b` fall in the foreground band (ground point in the bottom ~21 % of the frame)? */
function hitsBand(b: THREE.Box3, pv: THREE.Matrix4, h: number): boolean {
  const fy = OCC.uOccY.value[0]!;
  if (b.max.y - fy <= 0.05) return false;
  const lim = h * 0.21 + PAD;
  for (let k = 0; k < 4; k++) {
    _c.set(k & 1 ? b.max.x : b.min.x, fy, k & 2 ? b.max.z : b.min.z, 1).applyMatrix4(pv);
    if (_c.w < 0.05) return true;
    if ((_c.y / _c.w * 0.5 + 0.5) * h <= lim) return true;
  }
  return false;
}

function needOf(e: OccEntry, b: THREE.Box3, n: number, pv: THREE.Matrix4, w: number, h: number): boolean {
  if (e.fg && hitsBand(b, pv, h)) return true;
  if (e.cut) for (let i = 0; i < n; i++) if (hitsEllipse(b, i, pv, w, h)) return true;
  return false;
}

function putGroup(groups: THREE.BufferGeometry['groups'], gi: number, start: number, end: number, mi: number): number {
  if (end <= start) return gi;
  const g = groups[gi];
  if (!g) groups.push({ start, count: end - start, materialIndex: mi });
  else {
    g.start = start;
    g.count = end - start;
    g.materialIndex = mi;
  }
  return gi + 1;
}

/** Grouped mesh: cut cells -> at most maxCut cut ranges (smallest solid gaps merged), solid elsewhere. */
function applyGrouped(e: OccEntry, n: number, pv: THREE.Matrix4, w: number, h: number): void {
  const need = e.need!;
  const runs = e.runs!;
  const cells = e.boxes.length;
  let nr = 0;
  let open = false;
  for (let k = 0; k < cells; k++) {
    const v = n > 0 && needOf(e, e.boxes[k]!, n, pv, w, h);
    need[k] = v ? 1 : 0;
    if (v) OCC_STATS.cutCells++;
    if (v && !open) {
      runs[nr * 2] = k;
      open = true;
    } else if (!v && open) {
      runs[nr * 2 + 1] = k - 1;
      nr++;
      open = false;
    }
  }
  if (open) runs[nr++ * 2 + 1] = cells - 1;
  const st = e.cellStart!;
  const ct = e.cellCount!;
  // Merge the cheapest gaps (fewest solid indices between two cut runs) until maxCut runs remain.
  while (nr > e.maxCut!) {
    let best = 0;
    let bestGap = Infinity;
    for (let r = 0; r < nr - 1; r++) {
      const gap = st[runs[r * 2 + 2]!]! - (st[runs[r * 2 + 1]!]! + ct[runs[r * 2 + 1]!]!);
      if (gap < bestGap) {
        bestGap = gap;
        best = r;
      }
    }
    runs[best * 2 + 1] = runs[best * 2 + 3]!;
    for (let r = best + 1; r < nr - 1; r++) {
      runs[r * 2] = runs[r * 2 + 2]!;
      runs[r * 2 + 1] = runs[r * 2 + 3]!;
    }
    nr--;
  }
  const geo = (e.mesh as THREE.Mesh).geometry;
  const groups = geo.groups;
  let gi = 0;
  let at = 0;
  for (let r = 0; r < nr; r++) {
    const a = st[runs[r * 2]!]!;
    const b = st[runs[r * 2 + 1]!]! + ct[runs[r * 2 + 1]!]!;
    gi = putGroup(groups, gi, at, a, 0);
    gi = putGroup(groups, gi, a, b, 1);
    at = b;
  }
  gi = putGroup(groups, gi, at, e.total!, 0);
  groups.length = gi;
  OCC_STATS.groups += gi;
  if (nr) OCC_STATS.cut++;
}

/** Per frame (end of updateOcclusion): cut variant only where a cut can land, solid everywhere else. */
function applyVariants(w: number, h: number): void {
  if (!variantsReady) return;
  if (!OCC_STATS.enabled || OCC_STATS.force) {
    // Runtime A/B (abprof): everything on the cut variant (or, force = 'solid', none cut: wrong
    // picture, upper bound of the saving).
    const solid = OCC_STATS.enabled && OCC_STATS.force === 'solid';
    for (const e of entries) setAll(e, !solid);
    OCC_STATS.cut = solid ? 0 : entries.length;
    return;
  }
  const n = OCC.uOccN.value;
  const pv = OCC.uOccPV.value;
  OCC_STATS.cut = 0;
  OCC_STATS.cutCells = 0;
  OCC_STATS.groups = 0;
  for (const e of entries) {
    if (OCC_STATS.solidOnly && (OCC_STATS.solidOnly === 'grouped') === !!e.cellStart) {
      setAll(e, false);
      continue;
    }
    if (e.cellStart) {
      applyGrouped(e, n, pv, w, h);
      continue;
    }
    let need = false;
    if (n > 0) for (let j = 0; j < e.boxes.length && !need; j++) need = needOf(e, e.boxes[j]!, n, pv, w, h);
    setAll(e, need);
    if (need) OCC_STATS.cut++;
  }
}
