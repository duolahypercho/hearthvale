/**
 * Procedural rigid-skinned creature rigs: every part of an animal is merged into ONE SkinnedMesh
 * (one shared vertex-coloured material) and bound rigidly to a bone. Animating bones gives legs,
 * head, ears, tail, wings, blinking eyelids and fluffy wool for the cost of a single draw call per
 * animal (+ its shadow).
 *
 *   const r = new RigBuilder();
 *   r.bone('body', 'root', [0, 0.7, 0]);
 *   r.part('body', new THREE.SphereGeometry(0.4, 18, 14), mat(0, 0.7, 0), 0xffffff);
 *   const { mesh, bones } = r.build(animalMaterial());
 *
 * Model space: +Z is the animal's nose, y = 0 the ground.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { prep } from '../world/geom';
import { applyWorldFx } from '../render/worldfx';

let shared: THREE.MeshStandardMaterial | null = null;

/** GLSL twin of noise3() below (coat patches are evaluated per pixel, so their edges stay crisp). */
const GLSL_NOISE3 = /* glsl */ `
float hvNoise3(vec3 p, float seed) {
  return sin(p.x * 3.1 + seed * 1.7 + sin(p.z * 2.3 + seed) * 1.3) * 0.5
       + sin(p.z * 2.7 - seed * 0.9 + sin(p.y * 3.7 - p.x * 1.1) * 1.2) * 0.35
       + sin(p.y * 4.3 + p.x * 1.9 + seed * 2.3) * 0.25;
}`;

/** The one material every farm animal shares (vertex colours carry all the art). */
export function animalMaterial(): THREE.MeshStandardMaterial {
  if (!shared) {
    shared = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    shared.name = 'animal';
    // (r7: fur, fleece and feathers stay matte in the rain — full wet gloss turned wool into latex balloons)
    applyWorldFx(shared, { snow: false, wetGloss: 0.92, wetDark: 0.18 });
    // Soft fur sheen: a gentle fresnel rim in the coat's own colour (velvety, never plastic).
    // Coat patches (holstein spots, pig spots, saddles): a per-pixel noise threshold in rest-pose
    // model space with an fwidth()-sized edge — crisp at any zoom, still one draw call.
    const prev = shared.onBeforeCompile;
    const prevKey = shared.customProgramCacheKey;
    shared.onBeforeCompile = (sh, r) => {
      prev.call(shared, sh, r);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aPatchA; attribute vec4 aPatchB; attribute vec4 aPatchC; attribute float aCoat;
          varying vec4 vPatchA; varying vec4 vPatchB; varying vec4 vPatchC; varying vec3 vRest; varying float vCoat;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vPatchA = aPatchA; vPatchB = aPatchB; vPatchC = aPatchC; vRest = position; vCoat = aCoat;`,
        )
        // r13: an extra 4 cm normal offset for the shadow lookup — the smooth round barrels caught
        // self-shadow acne from the low sun as broad horizontal bands ("flat planes on the cow's back").
        .replace(
          '#include <shadowmap_vertex>',
          `#if defined( USE_SHADOWMAP ) && defined( HAS_NORMAL )
            vec4 hvWorldPos = worldPosition;
            worldPosition.xyz += normalize(transformNormalByInverseViewMatrix(transformedNormal, viewMatrix)) * 0.04;
          #endif
          #include <shadowmap_vertex>
          #if defined( USE_SHADOWMAP ) && defined( HAS_NORMAL )
            worldPosition = hvWorldPos;
          #endif`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec4 vPatchA; varying vec4 vPatchB; varying vec4 vPatchC; varying vec3 vRest; varying float vCoat;
          ${GLSL_NOISE3}
          // Screen-derivative bump (no tangents needed): tilt the normal by the gradient of h.
          vec3 hvBump(vec3 pos, vec3 n, float h) {
            vec3 dpx = dFdx(pos); vec3 dpy = dFdy(pos);
            float dhx = dFdx(h); float dhy = dFdy(h);
            vec3 r1 = cross(dpy, n); vec3 r2 = cross(n, dpx);
            float det = dot(dpx, r1);
            vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
            return normalize(abs(det) * n - grad);
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (vCoat > 0.5) {
            // r11 coat relief in rest-pose space: 1 short hair (combed streaks), 2 wool (lumpy curls),
            // 3 feathers (overlapping scale rows), 4 bristly skin (pig: a faint pore stipple).
            vec3 q = vRest;
            float hh;
            float amp;
            if (vCoat < 1.5) {
              hh = hvNoise3(q * vec3(120.0, 105.0, 38.0), 2.0) * 0.6 + hvNoise3(q * vec3(230.0, 210.0, 64.0), 4.0) * 0.4;
              amp = 0.0016;
            } else if (vCoat < 2.5) {
              float a = hvNoise3(q * 24.0, 1.0);
              float b = hvNoise3(q * 52.0 + 3.0, 2.0);
              float c = hvNoise3(q * 105.0 + 7.0, 3.0);
              hh = abs(a) * 0.55 + abs(b) * 0.3 + c * 0.15;
              amp = 0.011;
            } else if (vCoat < 3.5) {
              // (r11b: bigger, softer scales — fine rows read as a sandpaper stipple from the camera)
              float row = q.z * 15.0 - q.y * 7.0 + hvNoise3(q * 5.0, 5.0) * 0.3;
              float col = (q.x * 17.0 + floor(row) * 0.5);
              float fr = fract(row);
              float fc = fract(col) - 0.5;
              hh = smoothstep(0.0, 0.9, fr) * (1.0 - fc * fc * 2.4) * (1.0 - smoothstep(0.9, 1.0, fr));
              amp = 0.0042;
            } else {
              hh = hvNoise3(q * 160.0, 6.0);
              amp = 0.0006;
            }
            float fade = 1.0 - smoothstep(0.35, 0.95, fwidth(hh));
            normal = hvBump(-vViewPosition, normal, hh * amp * fade);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vPatchB.x > 0.5) {
            float pv = hvNoise3(vRest * vPatchA.xyz, vPatchA.w) + vPatchB.z * sin(vRest.z * 9.0 + vRest.x * 4.0) + vPatchB.w * (vRest.y - vPatchC.w);
            float pw = fwidth(pv) * 0.9 + 0.002;
            diffuseColor.rgb = mix(diffuseColor.rgb, vPatchC.rgb, smoothstep(vPatchB.y - pw, vPatchB.y + pw, pv));
          }
          {
            // Fur grain: fine streaks combed along the body (rest-pose z), faded out before they can
            // shimmer (fwidth); skipped on catchlights (near-white) and eyes / hooves (near-black).
            // (r17: z stretch 13 -> 30 and gentler on dark coats — the long combed streaks read as wood grain
            // on the fawn Jersey from the 11-14 m camera)
            vec3 fp = vRest * vec3(72.0, 66.0, 30.0);
            float fa = 1.0 - smoothstep(0.35, 1.3, length(fwidth(fp)));
            float fv = hvNoise3(fp, 3.0) * 0.6 + hvNoise3(fp * 2.1 + 5.0, 1.0) * 0.4;
            float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
            float mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
            float coat = (1.0 - step(0.965, mn)) * smoothstep(0.06, 0.16, mx);
            // (pale coats get a whisper of it: at full strength it read as grime specks on white cows / fleece)
            diffuseColor.rgb *= 1.0 + fv * mix(0.045, 0.022, smoothstep(0.55, 0.85, mx)) * fa * coat;
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        float hvFur = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += diffuseColor.rgb * hvFur * 0.16 * (1.0 - 0.7 * smoothstep(0.55, 0.9, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b))));`,
        );
    };
    shared.customProgramCacheKey = () => `${prevKey.call(shared)}|fur|patch|coat`;
  }
  return shared;
}

/**
 * A crisp coat patch evaluated per pixel: where
 *   noise3(p * freq, seed) + sinAmp * sin(p.z*9 + p.x*4) + yK * (p.y - y0)  >  edge
 * the coat turns `color`. p = rest-pose model-space position.
 */
export interface CoatPatch {
  color: THREE.ColorRepresentation;
  freq: [number, number, number];
  seed: number;
  edge: number;
  sinAmp?: number;
  yK?: number;
  y0?: number;
}

export type Paint = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void;

interface PartOpts {
  /** Per-vertex colour painter (model-space position / normal). */
  paint?: Paint;
  /** Skip the soft underside occlusion (eyes, highlights). */
  flat?: boolean;
  /** Extra darkening near the ground (legs). */
  ground?: boolean;
  /** Crisp per-pixel coat patch (see CoatPatch). */
  patch?: CoatPatch;
  /** Coat relief (0 none, 1 short hair, 2 wool, 3 feathers, 4 skin). Default: the builder's `coat`
   *  (0 for `flat` parts: eyes, noses, hooves, horns, catchlights). */
  coat?: number;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _h = new THREE.Vector3();

export class RigBuilder {
  private names = new Map<string, number>();
  private abs: THREE.Vector3[] = [];
  private parents: number[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private geoBone: number[] = [];
  private chibiOpts: { bodyZ: number; head: number } | null = null;
  /** Default coat relief for parts (see PartOpts.coat). */
  coat = 0;

  constructor() {
    this.bone('root', null, [0, 0, 0]);
  }

  /** Declare a bone at an absolute model-space pivot. */
  bone(name: string, parent: string | null, at: [number, number, number]): this {
    const i = this.abs.length;
    this.names.set(name, i);
    this.abs.push(new THREE.Vector3(...at));
    this.parents.push(parent == null ? -1 : this.idx(parent));
    return this;
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  private idx(name: string): number {
    const i = this.names.get(name);
    if (i === undefined) throw new Error(`[rig] unknown bone "${name}"`);
    return i;
  }

  /** Add a part bound to `bone`. `m` places the geometry in model space. */
  part(bone: string, geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, tint: THREE.ColorRepresentation, opts: PartOpts = {}): this {
    const g = prep(geo, tint);
    if (m) g.applyMatrix4(m);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    const n = pos.count;
    const pa = new Float32Array(n * 4);
    const pb = new Float32Array(n * 4);
    const pc = new Float32Array(n * 4);
    const P = opts.patch;
    const pcol = P ? new THREE.Color(P.color) : null;
    for (let i = 0; i < n; i++) {
      _p.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(nor, i);
      _c.fromBufferAttribute(col, i);
      opts.paint?.(_p, _n, _c);
      let ao = 1;
      if (!opts.flat) {
        // Soft sky occlusion: bellies and chins sit in their own shade, backs catch the light.
        ao = 0.72 + 0.28 * THREE.MathUtils.smoothstep(_n.y, -0.9, 0.35);
        if (opts.ground) ao *= 0.62 + 0.38 * THREE.MathUtils.smoothstep(_p.y, 0.0, 0.22);
        _c.multiplyScalar(ao);
      }
      col.setXYZ(i, _c.r, _c.g, _c.b);
      if (P && pcol) {
        pa.set([P.freq[0], P.freq[1], P.freq[2], P.seed], i * 4);
        pb.set([1, P.edge, P.sinAmp ?? 0, P.yK ?? 0], i * 4);
        pc.set([pcol.r * ao, pcol.g * ao, pcol.b * ao, P.y0 ?? 0], i * 4);
      }
    }
    g.setAttribute('aPatchA', new THREE.Float32BufferAttribute(pa, 4));
    g.setAttribute('aPatchB', new THREE.Float32BufferAttribute(pb, 4));
    g.setAttribute('aPatchC', new THREE.Float32BufferAttribute(pc, 4));
    g.setAttribute('aCoat', new THREE.Float32BufferAttribute(new Float32Array(n).fill(opts.coat ?? (opts.flat ? 0 : this.coat)), 1));
    const bi = this.idx(bone);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.geos.push(g);
    this.geoBone.push(bi);
    return this;
  }

  /** Raise every part and bone except those on `keep` (legs) by `dy`: longer legs without re-authoring
   *  every absolute height in a model (the kept legs must already be built to the raised top). */
  lift(dy: number, keep: readonly string[]): this {
    const kept = new Set(keep.filter((k) => this.names.has(k)).map((k) => this.idx(k)));
    kept.add(this.idx('root'));
    this.geos.forEach((g, i) => {
      if (!kept.has(this.geoBone[i]!)) g.translate(0, dy, 0);
    });
    this.abs.forEach((a, i) => {
      if (!kept.has(i)) a.y += dy;
    });
    return this;
  }

  /**
   * Chibi proportions, applied at build: the trunk (everything not on the head) is compressed along
   * the body axis by `bodyZ`, and the head group (head / eyes / ears) grows by `head` about the neck
   * pivot, which rides along with the shortened body. One place, so every part and bone stays in step.
   */
  chibi(bodyZ: number, head: number): this {
    this.chibiOpts = { bodyZ, head };
    return this;
  }

  /** Where a model-space point ends up after chibi() (for gait numbers: reach, heart height). */
  chibiPoint(p: THREE.Vector3, onHead: boolean): THREE.Vector3 {
    const o = this.chibiOpts;
    if (!o) return p;
    if (!onHead) return p.set(p.x, p.y, p.z * o.bodyZ);
    const H = this.abs[this.idx('head')]!;
    return p.sub(H).multiplyScalar(o.head).add(_h.set(H.x, H.y, H.z * o.bodyZ));
  }

  private applyChibi(): void {
    const o = this.chibiOpts;
    if (!o || !this.names.has('head')) return;
    const hi = this.idx('head');
    const group = new Set<number>([hi]);
    for (const nm of ['eyes', 'earL', 'earR']) if (this.names.has(nm)) group.add(this.idx(nm));
    const H = this.abs[hi]!.clone();
    const trunk = new THREE.Matrix4().makeScale(1, 1, o.bodyZ);
    const head = new THREE.Matrix4()
      .makeTranslation(H.x, H.y, H.z * o.bodyZ)
      .multiply(new THREE.Matrix4().makeScale(o.head, o.head, o.head))
      .multiply(new THREE.Matrix4().makeTranslation(-H.x, -H.y, -H.z));
    this.geos.forEach((g, i) => g.applyMatrix4(group.has(this.geoBone[i]!) ? head : trunk));
    this.abs.forEach((a, i) => {
      if (group.has(i) && i !== hi) a.applyMatrix4(head);
      else a.z *= o.bodyZ;
    });
    this.chibiOpts = null;
  }

  build(material: THREE.Material, name: string): { mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone> } {
    this.applyChibi();
    const geo = mergeGeometries(this.geos)!;
    for (const g of this.geos) g.dispose();
    geo.computeBoundingBox();
    const bones: THREE.Bone[] = [];
    const out: Record<string, THREE.Bone> = {};
    for (const [nm, i] of this.names) {
      const b = new THREE.Bone();
      b.name = nm;
      bones[i] = b;
      out[nm] = b;
    }
    for (let i = 0; i < bones.length; i++) {
      const p = this.parents[i]!;
      const local = this.abs[i]!.clone();
      if (p >= 0) {
        local.sub(this.abs[p]!);
        bones[p]!.add(bones[i]!);
      }
      bones[i]!.position.copy(local);
    }
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.name = name;
    mesh.add(bones[0]!);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Generous fixed bound (poses never leave it) so culling works without per-frame recompute.
    const bb = geo.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    mesh.boundingSphere = new THREE.Sphere(c, bb.getSize(new THREE.Vector3()).length() * 0.62 + 0.15);
    return { mesh, bones: out };
  }
}

// ───────────────────────────────────────────── small geometry helpers

/**
 * Tessellation scale for the helpers below (1 = full). The far LOD templates (outdoor herd seen from the
 * high farm camera) are built at ~0.55: same parts, same bones, about a third of the triangles.
 */
export const RIG_DETAIL = { k: 1 };
const seg = (n: number, min: number): number => Math.max(min, Math.round(n * RIG_DETAIL.k));

/** Ellipsoid (sphere scaled per axis). */
export function ellipsoid(rx: number, ry: number, rz: number, ws?: number, hs?: number): THREE.BufferGeometry {
  // (r13: default tessellation follows size — a big chibi head at 14 × 10 showed its facets at the 11 m
  // petting camera, while a 4 cm nostril needs nothing like it)
  const big = Math.max(rx, ry, rz);
  const w = ws ?? Math.max(12, Math.min(30, Math.round(10 + big * 64)));
  const h = hs ?? Math.max(8, Math.round(w * 0.7));
  const g = new THREE.SphereGeometry(1, seg(w, 6), seg(h, 4));
  g.scale(rx, ry, rz);
  return g;
}

/** Capsule lying along Z. */
export function capsuleZ(r: number, len: number, cap = 8, radial = 16): THREE.BufferGeometry {
  // Budget (DESIGN render budget, 4-player co-op farms): ~4-6k tris per animal at gameplay zoom.
  const g = new THREE.CapsuleGeometry(r, len, Math.max(cap, 6), Math.max(radial, 18), 3);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Tapered limb from y0 (top) down to y1, radius r0 → r1. */
export function limb(r0: number, r1: number, y0: number, y1: number, n = 8): THREE.BufferGeometry {
  const h = y0 - y1;
  const g = new THREE.CylinderGeometry(r0, r1, h, seg(n, 5), 1);
  g.translate(0, y1 + h / 2, 0);
  return g;
}

/** Soft-edged coat patch: blend `c` towards `patch` where noise crosses `edge`. */
export function blendPatch(c: THREE.Color, patch: THREE.ColorRepresentation, v: number, edge: number, soft = 0.12): void {
  const k = THREE.MathUtils.smoothstep(v, edge - soft, edge + soft);
  if (k > 0) c.lerp(_c2.set(patch), k);
}
const _c2 = new THREE.Color();

/** Smooth 3D value noise (cow patches, dapples). */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const s = Math.sin;
  return (
    s(x * 3.1 + seed * 1.7 + s(z * 2.3 + seed) * 1.3) * 0.5 +
    s(z * 2.7 - seed * 0.9 + s(y * 3.7 - x * 1.1) * 1.2) * 0.35 +
    s(y * 4.3 + x * 1.9 + seed * 2.3) * 0.25
  );
}

// ───────────────────────────────────────────── r13 sculpted lofts

/**
 * One station of a loft: a cross-section centred on `p` (model space) with half-width `w`, height
 * above the spine `up` and depth below it `dn`. `n` / `nb` are superellipse exponents for the top /
 * bottom halves (2 = round, 3 = boxy shoulders / rump corners, < 2 = a keel: brisket, dewlap).
 */
export interface LoftStation {
  p: [number, number, number];
  w: number;
  up: number;
  dn: number;
  n?: number;
  nb?: number;
}

const _lA = new THREE.Vector3();
const _lB = new THREE.Vector3();
const _lT = new THREE.Vector3();
const _lX = new THREE.Vector3();
const _lU = new THREE.Vector3();

function cr(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/**
 * A smooth sculpted body swept through `stations` (Catmull-Rom on the spine and on every radius):
 * one closed, seamless, indexed surface with smooth normals — no lathe banding, no capsule seams.
 * Both ends are closed with a pole. `ring` = vertices round each section, `sub` = samples per span.
 * `bump(theta, s)` optionally scales the radius (wool lumps, hair tufts): theta round the section
 * (0 = +x side, π/2 = top), s ∈ [0, 1] along the spine.
 */
export function loft(stations: LoftStation[], ring = 32, sub = 4, bump?: (theta: number, s: number) => number): THREE.BufferGeometry {
  const R = Math.max(10, Math.round(ring * RIG_DETAIL.k / 2) * 2);
  const S = Math.max(2, Math.round(sub * Math.max(0.6, RIG_DETAIL.k)));
  const N = stations.length;
  const at = (i: number): LoftStation => stations[Math.max(0, Math.min(N - 1, i))]!;
  // Sample the spine.
  type Sec = { p: THREE.Vector3; w: number; up: number; dn: number; n: number; nb: number };
  const secs: Sec[] = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < (i === N - 2 ? S + 1 : S); j++) {
      const t = j / S;
      const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
      const f = (k: (s: LoftStation) => number): number => cr(k(a), k(b), k(c), k(d), t);
      secs.push({
        p: new THREE.Vector3(f((s) => s.p[0]), f((s) => s.p[1]), f((s) => s.p[2])),
        w: Math.max(0.0005, f((s) => s.w)),
        up: Math.max(0.0005, f((s) => s.up)),
        dn: Math.max(0.0005, f((s) => s.dn)),
        n: f((s) => s.n ?? 2),
        nb: f((s) => s.nb ?? s.n ?? 2),
      });
    }
  }
  const M = secs.length;
  const pos: number[] = [];
  const idx: number[] = [];
  // Pole at the start.
  const first = secs[0]!;
  const last = secs[M - 1]!;
  _lA.copy(secs[1]!.p).sub(first.p).normalize();
  pos.push(first.p.x - _lA.x * first.w * 0.2, first.p.y - _lA.y * first.w * 0.2, first.p.z - _lA.z * first.w * 0.2);
  for (let i = 0; i < M; i++) {
    const s = secs[i]!;
    _lA.copy(secs[Math.max(0, i - 1)]!.p);
    _lB.copy(secs[Math.min(M - 1, i + 1)]!.p);
    _lT.subVectors(_lB, _lA).normalize();
    // Side axis: world X projected off the tangent (spines run fore-aft or vertically).
    _lX.set(1, 0, 0).addScaledVector(_lT, -_lT.x);
    if (_lX.lengthSq() < 1e-6) _lX.set(0, 0, 1);
    _lX.normalize();
    _lU.crossVectors(_lT, _lX).normalize();
    if (_lU.y < 0 && Math.abs(_lT.y) < 0.9) _lU.negate();
    const sv = i / (M - 1);
    for (let k = 0; k < R; k++) {
      const th = (k / R) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const e = sn >= 0 ? s.n : s.nb;
      const cx = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
      const sy = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e);
      const b = bump ? bump(th, sv) : 1;
      const x = cx * s.w * b;
      const y = sy * (sn >= 0 ? s.up : s.dn) * b;
      pos.push(s.p.x + _lX.x * x + _lU.x * y, s.p.y + _lX.y * x + _lU.y * y, s.p.z + _lX.z * x + _lU.z * y);
    }
  }
  _lA.copy(last.p).sub(secs[M - 2]!.p).normalize();
  pos.push(last.p.x + _lA.x * last.w * 0.2, last.p.y + _lA.y * last.w * 0.2, last.p.z + _lA.z * last.w * 0.2);
  const end = 1 + M * R;
  // Winding: outward-facing for a spine running +Z with the section going +x → +y.
  for (let k = 0; k < R; k++) idx.push(0, 1 + ((k + 1) % R), 1 + k);
  for (let i = 0; i < M - 1; i++) {
    const a0 = 1 + i * R;
    const b0 = 1 + (i + 1) * R;
    for (let k = 0; k < R; k++) {
      const k1 = (k + 1) % R;
      idx.push(a0 + k, a0 + k1, b0 + k);
      idx.push(a0 + k1, b0 + k1, b0 + k);
    }
  }
  const l0 = 1 + (M - 1) * R;
  for (let k = 0; k < R; k++) idx.push(end, l0 + k, l0 + ((k + 1) % R));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A cupped leaf (ears): a flattened ellipsoid tapered to a tip along +x and bent so its inner face
 * is concave (towards -y). Closed mesh — no backface holes from the high camera.
 */
export function leaf(len: number, wid: number, thick: number, cup = 0.5, taper = 0.75, ws = 16, hs = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, Math.max(8, Math.round(ws * RIG_DETAIL.k)), Math.max(6, Math.round(hs * RIG_DETAIL.k)));
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i);
    const t = (x0 + 1) / 2; // 0 base → 1 tip
    const k = 1 - taper * t * t;
    const x = x0 * len * 0.5 + len * 0.5;
    const z = p.getZ(i) * wid * 0.5 * k;
    let y = p.getY(i) * thick * 0.5 * (0.6 + 0.4 * k);
    // Cup: lift the rims (|z|) so the middle is a hollow facing -y.
    y += cup * (z * z) / Math.max(1e-4, wid * 0.5) * (0.4 + 0.6 * k);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
