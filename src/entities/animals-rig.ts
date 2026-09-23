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
    applyWorldFx(shared, { snow: false });
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
          attribute vec4 aPatchA; attribute vec4 aPatchB; attribute vec4 aPatchC;
          varying vec4 vPatchA; varying vec4 vPatchB; varying vec4 vPatchC; varying vec3 vRest;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vPatchA = aPatchA; vPatchB = aPatchB; vPatchC = aPatchC; vRest = position;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec4 vPatchA; varying vec4 vPatchB; varying vec4 vPatchC; varying vec3 vRest;
          ${GLSL_NOISE3}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vPatchB.x > 0.5) {
            float pv = hvNoise3(vRest * vPatchA.xyz, vPatchA.w) + vPatchB.z * sin(vRest.z * 9.0 + vRest.x * 4.0) + vPatchB.w * (vRest.y - vPatchC.w);
            float pw = fwidth(pv) * 0.9 + 0.002;
            diffuseColor.rgb = mix(diffuseColor.rgb, vPatchC.rgb, smoothstep(vPatchB.y - pw, vPatchB.y + pw, pv));
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        float hvFur = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += diffuseColor.rgb * hvFur * 0.16 * (1.0 - 0.7 * smoothstep(0.55, 0.9, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b))));`,
        );
    };
    shared.customProgramCacheKey = () => `${prevKey.call(shared)}|fur|patch`;
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
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

export class RigBuilder {
  private names = new Map<string, number>();
  private abs: THREE.Vector3[] = [];
  private parents: number[] = [];
  private geos: THREE.BufferGeometry[] = [];

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
    return this;
  }

  build(material: THREE.Material, name: string): { mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone> } {
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

/** Ellipsoid (sphere scaled per axis). */
export function ellipsoid(rx: number, ry: number, rz: number, ws = 14, hs = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
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
export function limb(r0: number, r1: number, y0: number, y1: number, seg = 8): THREE.BufferGeometry {
  const h = y0 - y1;
  const g = new THREE.CylinderGeometry(r0, r1, h, seg, 1);
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
