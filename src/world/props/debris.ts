/**
 * Woody debris for the Nature instanced sets: fallen sticks (chunky, forked, leafy), branches,
 * stumps, logs and a small drift of dry fallen leaves.
 *
 * Sticks are deliberately thick (a stick must read as a stick at gameplay zoom, never as a
 * scratch): light warm bark (0x8a5a36) with darker lengthwise streaks, pale cut ends, a forked
 * side twig with a few leaf cards. Contact shadows come from the terrain AO stamp at placement.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, bevelCylinder, uvScale, mat } from '../geom';
import { materials } from '../../render/materials';
import type { InstancedPart } from './instanced';
import { vcolor, leafBlade, type FloraMaterials } from './flora';

const BARK = new THREE.Color(0x86603f);
const BARK_DARK = new THREE.Color(0x4f3826);
const CUT = new THREE.Color(0xe0bb85);
const CUT_RING = new THREE.Color(0xb88a58);

/** Bark-coloured cylinder along +X (length `len`, radii r0 → r1), streaked lengthwise. */
function stick(r: Rng, len: number, r0: number, r1: number, sides = 7): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 2, true);
  g.rotateZ(-Math.PI / 2);
  const seed = r.next() * 10;
  vcolor(g, (p) => {
    const ang = Math.atan2(p.z, p.y);
    const streak = 0.5 + 0.5 * Math.sin(ang * 5 + seed + p.x * 3.1);
    const under = THREE.MathUtils.smoothstep(p.y, -r0, r0 * 0.6);
    return BARK_DARK.clone().lerp(BARK, 0.45 + 0.4 * streak).multiplyScalar(0.62 + 0.45 * under);
  });
  return g;
}

/** Pale sawn / snapped end cap with growth rings, facing ±X. */
function cutEnd(radius: number, sign: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius * 0.98, 9);
  g.rotateY((sign * Math.PI) / 2);
  vcolor(g, (p) => {
    const d = Math.hypot(p.y, p.z) / radius;
    return CUT.clone().lerp(CUT_RING, (0.5 + 0.5 * Math.sin(d * 16)) * 0.5 + THREE.MathUtils.smoothstep(d, 0.75, 1) * 0.5);
  });
  return g;
}

/** Fallen stick bundle: two chunky forked sticks lying in the grass. */
export function buildTwig(r: Rng, mats: FloraMaterials): InstancedPart[] {
  const b = new MeshBuilder();
  const m = materials.get('white');
  const lm = mats.weed();
  for (let i = 0; i < 2; i++) {
    const len = 0.55 + r.next() * 0.3;
    const rad = 0.06 + r.next() * 0.015;
    const yaw = r.next() * Math.PI + i * 0.9;
    const cx = (r.next() - 0.5) * 0.15;
    const cz = (r.next() - 0.5) * 0.15;
    const y = rad * 0.85 + i * rad * 0.9;
    const tf = mat(cx, y, cz, 0, yaw, 0.03);
    b.add(m, stick(r, len, rad, rad * 0.75), tf);
    b.add(m, cutEnd(rad, 1), new THREE.Matrix4().multiplyMatrices(tf, mat(len / 2, 0, 0)));
    b.add(m, cutEnd(rad * 0.75, -1), new THREE.Matrix4().multiplyMatrices(tf, mat(-len / 2, 0, 0)));
    const fork = stick(r, 0.22, rad * 0.55, rad * 0.35, 5);
    fork.translate(0.11, 0, 0);
    b.add(m, fork, new THREE.Matrix4().multiplyMatrices(tf, mat(len * 0.15, 0, 0, 0, 0.7 * (i ? 1 : -1), 0.15)));
    if (i === 0) {
      for (let k = 0; k < 2; k++) {
        const leaf = leafBlade(0.14, 0.07, 0.3, 3);
        vcolor(leaf, () => new THREE.Color(k ? 0x7a9a3a : 0xa8a247));
        b.add(lm, leaf, new THREE.Matrix4().multiplyMatrices(tf, mat(len * 0.15 + 0.2, 0.03, (k - 0.5) * 0.12, 1.2, k * 2.5, 0)));
      }
    }
  }
  const geos = b.geometries();
  return [
    { geometry: geos.get(m)!, material: m },
    { geometry: geos.get(lm)!, material: lm, castShadow: false },
  ];
}

/** Fallen branch: a crooked chunky limb in 3 bends, side shoots with clinging leaves, cut butt. */
export function buildBranch(r: Rng, mats: FloraMaterials): InstancedPart[] {
  const b = new MeshBuilder();
  const m = materials.get('white');
  const leafM = mats.weed();
  const len = 1.15 + r.next() * 0.4;
  let x = -len / 2;
  let z = 0;
  let ang = (r.next() - 0.5) * 0.3;
  let rad = 0.13;
  for (let sI = 0; sI < 3; sI++) {
    const sl = len / 3;
    const cx = x + (Math.cos(ang) * sl) / 2;
    const cz = z + (Math.sin(ang) * sl) / 2;
    const tf = mat(cx, rad * 0.82, cz, 0, -ang, 0);
    b.add(m, stick(r, sl + 0.06, rad, rad * 0.8), tf);
    if (sI === 0) b.add(m, cutEnd(rad, -1), new THREE.Matrix4().multiplyMatrices(tf, mat(-(sl + 0.06) / 2, 0, 0)));
    if (sI === 2) b.add(m, cutEnd(rad * 0.8, 1), new THREE.Matrix4().multiplyMatrices(tf, mat((sl + 0.06) / 2, 0, 0)));
    if (sI > 0) {
      const side = r.next() < 0.5 ? 1 : -1;
      const tl = 0.36 + r.next() * 0.12;
      const tw = stick(r, tl, rad * 0.5, rad * 0.28, 5);
      tw.translate(tl / 2, 0, 0);
      const ftf = mat(cx, rad * 0.9, cz, 0, -ang + side * 0.8, 0.25);
      b.add(m, tw, ftf);
      for (let k = 0; k < 3; k++) {
        const leaf = leafBlade(0.17, 0.085, 0.3, 3);
        vcolor(leaf, () => new THREE.Color([0x6f9a36, 0x94a843, 0xb09a45][k]!));
        b.add(leafM, leaf, new THREE.Matrix4().multiplyMatrices(ftf, mat(tl * (0.55 + k * 0.2), 0.03, (k - 1) * 0.07, 1.0 + r.next() * 0.4, r.next() * 6, 0)));
      }
    }
    x += Math.cos(ang) * sl;
    z += Math.sin(ang) * sl;
    ang += (r.next() - 0.5) * 0.7;
    rad *= 0.8;
  }
  const geos = b.geometries();
  return [
    { geometry: geos.get(m)!, material: m },
    { geometry: geos.get(leafM)!, material: leafM, castShadow: false },
  ];
}

export function buildStump(r: Rng): InstancedPart[] {
  const b = new MeshBuilder();
  const bark = materials.get('bark');
  const h = 0.38 + r.next() * 0.15;
  const g = bevelCylinder(0.34, 0.4, h, 0.05, 11);
  uvScale(g, 3, 1);
  b.add(bark, g, undefined, { aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.3) });
  const top = new THREE.CircleGeometry(0.3, 16);
  top.rotateX(-Math.PI / 2);
  vcolor(top, (p) => {
    const d = Math.hypot(p.x, p.z);
    const ring = 0.85 + 0.15 * Math.sin(d * 60);
    return new THREE.Color(0xd8b07a).multiplyScalar(ring * (1 - d * 0.6));
  });
  b.add('woodPaint', top, mat(0, h + 0.005, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r.next();
    const root = new THREE.CylinderGeometry(0.03, 0.13, 0.5, 6);
    root.rotateZ(Math.PI / 2 - 0.35);
    b.add(bark, root, mat(Math.cos(a) * 0.38, 0.08, Math.sin(a) * 0.38, 0, -a, 0));
  }
  const geos = b.geometries();
  return [
    { geometry: geos.get(bark)!, material: bark },
    { geometry: geos.get('woodPaint')!, material: materials.get('woodPaint') },
  ];
}

export function buildLog(r: Rng): InstancedPart[] {
  const b = new MeshBuilder();
  const bark = materials.get('bark');
  const len = 1.6 + r.next() * 0.6;
  const g = new THREE.CylinderGeometry(0.22, 0.26, len, 10, 1, true);
  uvScale(g, 3, 2);
  g.rotateZ(Math.PI / 2);
  b.add(bark, g, mat(0, 0.22, 0));
  for (const sgn of [-1, 1]) {
    const cap = new THREE.CircleGeometry(sgn < 0 ? 0.26 : 0.22, 12);
    cap.rotateY((sgn * Math.PI) / 2);
    vcolor(cap, (p) => new THREE.Color(0xcfa270).multiplyScalar(0.85 + 0.15 * Math.sin(Math.hypot(p.y, p.z) * 55)));
    b.add('woodPaint', cap, mat((sgn * len) / 2, 0.22, 0));
  }
  const geos = b.geometries();
  return [
    { geometry: geos.get(bark)!, material: bark },
    { geometry: geos.get('woodPaint')!, material: materials.get('woodPaint') },
  ];
}

/** A small drift of dry fallen leaves (tan, ochre, russet) lying flat, for under canopies. */
export function buildLeaves(r: Rng, mats: FloraMaterials): InstancedPart[] {
  const b = new MeshBuilder();
  const m = mats.weed();
  const hues = [0xb08a4a, 0xc79a3e, 0x9a5a2e, 0x8a7a3a, 0xd0a856];
  const n = 9 + r.int(0, 4);
  for (let i = 0; i < n; i++) {
    const g = new THREE.CircleGeometry(0.5, 6);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k);
      const py = pos.getY(k);
      pos.setXYZ(k, px * 0.55 * (1 - Math.abs(py) * 0.35), py, px * px * 0.3);
    }
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    const c = new THREE.Color(hues[Math.floor(r.next() * hues.length)]!).multiplyScalar(0.8 + r.next() * 0.3);
    vcolor(g, (p) => c.clone().multiplyScalar(0.85 + 0.25 * (0.5 - Math.abs(p.z))));
    const a = r.next() * Math.PI * 2;
    const d = Math.sqrt(r.next()) * 0.35;
    const s = 0.11 + r.next() * 0.06;
    b.add(m, g, mat(Math.cos(a) * d, 0.02 + r.next() * 0.02, Math.sin(a) * d, (r.next() - 0.5) * 0.4, r.next() * 6, (r.next() - 0.5) * 0.4, s, s, s));
  }
  return [{ geometry: b.geometries().get(m)!, material: m, castShadow: false }];
}
