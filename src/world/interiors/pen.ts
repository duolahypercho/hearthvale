/**
 * Shared bits for animal buildings: the anchor contract the animal system reads (where each animal
 * eats / sleeps / lays), plus small furnishing helpers (hay piles, straw tufts, lanterns, sacks,
 * pails, pitchforks, bales).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { mat, lumpySphere, roundedBox } from '../geom';
import type { Kit } from './kit';

export interface PenSlot {
  /** Where the animal stands to eat (floor, room coords). */
  feed: THREE.Vector3;
  feedHeading: number;
  /** Where it sleeps. */
  bed: THREE.Vector3;
  /** Hay portion position in the trough. */
  hay: THREE.Vector3;
}

export interface PenAnchors {
  kind: 'coop' | 'barn';
  capacity: number;
  slots: PenSlot[];
  /** Egg spots (coop nesting boxes). */
  nests: THREE.Vector3[];
  /** Wander rectangle (room coords). */
  area: { x0: number; z0: number; x1: number; z1: number };
  /** Interact with any tile in this rect (inclusive) to fill the trough. */
  trough: { x0: number; z0: number; x1: number; z1: number };
  feedTile: { x: number; z: number };
  /** Stall name plaques (barn): where to hang each animal's name. */
  plaques?: THREE.Vector3[];
}

const STRAW = [0xf2dc94, 0xe0bc62, 0xf6e6aa, 0xd4a850, 0xe8cc7a];

/** Loose straws lying around (cx, cz within `spread`); `lift(dx, dz)` raises them onto a mound. */
export function strawTufts(k: Kit, rng: Rng, cx: number, y: number, cz: number, n: number, spread: number, lift?: (dx: number, dz: number) => number): void {
  for (let i = 0; i < n; i++) {
    const len = 0.1 + rng.next() * 0.16;
    const g = new THREE.CylinderGeometry(0.011, 0.008, len, 3);
    g.scale(1, 1, 0.45);
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * spread;
    const dx = Math.cos(a) * r;
    const dz = Math.sin(a) * r * 0.9;
    const up = lift ? lift(dx, dz) : 0;
    const lie = up > 0.02 ? 0.6 + rng.next() * 0.9 : 1.25 + rng.next() * 0.3;
    k.add('fabric', g, mat(cx + dx, y + up + 0.012, cz + dz, lie, rng.next() * Math.PI, (rng.next() - 0.5) * 0.6), { tint: STRAW[Math.floor(rng.next() * STRAW.length)]! });
  }
}

/** A loose heap of hay / straw bedding: a soft dome of lumps bristling with straws. */
export function hayPile(k: Kit, rng: Rng, x: number, z: number, w: number, d: number, h: number): void {
  const H = Math.max(h, 0.1);
  const dome = (dx: number, dz: number) => {
    const q = 1 - (dx / (w * 0.5)) ** 2 - (dz / (d * 0.5)) ** 2;
    return q > 0 ? H * Math.sqrt(q) * 0.95 : 0;
  };
  k.add('straw', lumpySphere(0.5, 3, 0.2, rng), mat(x, -H * 0.12, z, 0, rng.next() * 3, 0, w, H * 2.1, d), { tint: 0xfff0c8 });
  const lumps = 3 + Math.floor(w * d * 3);
  for (let i = 0; i < lumps; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 0.2 + rng.next() * 0.25;
    const dx = Math.cos(a) * r * w;
    const dz = Math.sin(a) * r * d;
    const s = 0.18 + rng.next() * 0.14;
    k.add('straw', lumpySphere(0.5, 2, 0.3, rng), mat(x + dx, dome(dx, dz) * 0.55, z + dz, 0, rng.next() * 3, 0, s * w * 1.4, H * (0.7 + rng.next() * 0.6), s * d * 1.4), { tint: i % 2 ? 0xfff4d0 : 0xffe4a8 });
  }
  strawTufts(k, rng, x, 0, z, Math.round(26 + w * d * 30), Math.min(w, d) * 0.55, dome);
  // A skirt of stray straws on the floor around the heap
  strawTufts(k, rng, x, 0, z, Math.round(10 + w * d * 8), Math.max(w, d) * 0.75);
}

/** Rectangular hay bale with twine bands. `ry` yaw. */
export function hayBale(k: Kit, x: number, y: number, z: number, ry = 0, s = 1): void {
  const m = (lx: number, ly: number, lz: number) => {
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    return mat(x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c, 0, ry, 0);
  };
  k.add('thatch', roundedBox(0.9 * s, 0.42 * s, 0.5 * s, 0.07), m(0, 0.21 * s, 0), { tint: 0xf4dc98 });
  for (const lx of [-0.22, 0.22]) k.add('fabric', roundedBox(0.03, 0.44 * s, 0.52 * s, 0.01), m(lx * s, 0.21 * s, 0), { tint: 0xb8452e });
}

export function lanternHook(k: Kit, x: number, y: number, z: number): void {
  k.cyl('iron', 0.006, 0.006, 0.5, [x, y, z], { tint: 0x2a2624 });
  k.cyl('iron', 0.09, 0.07, 0.03, [x, y - 0.02, z], { tint: 0x2a2624 });
  k.add('glow', new THREE.CylinderGeometry(0.06, 0.07, 0.2, 12), mat(x, y - 0.14, z), { tint: 0xffd49a });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    k.cyl('iron', 0.008, 0.008, 0.24, [x + Math.cos(a) * 0.075, y - 0.27, z + Math.sin(a) * 0.075], { tint: 0x2a2624 });
  }
  k.cyl('iron', 0.1, 0.09, 0.03, [x, y - 0.29, z], { tint: 0x2a2624 });
  k.add('iron', new THREE.ConeGeometry(0.1, 0.08, 12), mat(x, y + 0.02, z), { tint: 0x2a2624 });
}

/** Tied burlap feed sack; `open` folds the top down and shows grain. */
export function feedSack(k: Kit, x: number, z: number, ry: number, tint: number, open = false): void {
  k.add('fabric', roundedBox(0.42, open ? 0.5 : 0.62, 0.3, 0.12, 3), mat(x, open ? 0.25 : 0.31, z, 0, ry, 0), { tint });
  if (open) {
    k.add('fabric', roundedBox(0.44, 0.08, 0.32, 0.04), mat(x, 0.5, z, 0, ry, 0), { tint: 0xa88a5c });
    k.add('ceramic', roundedBox(0.34, 0.03, 0.22, 0.02), mat(x, 0.53, z, 0, ry, 0), { tint: 0xe8c050 });
  } else {
    k.add('fabric', new THREE.ConeGeometry(0.1, 0.14, 8), mat(x, 0.67, z, 0, ry, 0), { tint });
    k.add('fabric', new THREE.TorusGeometry(0.05, 0.012, 5, 10), mat(x, 0.63, z, Math.PI / 2, 0, 0), { tint: 0x8a6a3a });
  }
  k.add('paint', new THREE.PlaneGeometry(0.2, 0.14), mat(x + Math.sin(ry) * 0.155, open ? 0.25 : 0.3, z + Math.cos(ry) * 0.155, 0, ry, 0), { tint: 0xc8503a });
}

export function bucket(k: Kit, x: number, z: number, tint = 0xb8c0c4, milk = false): void {
  k.cyl('tin', 0.14, 0.11, 0.26, [x, 0, z], { tint, seg: 18 });
  k.add('tin', new THREE.TorusGeometry(0.14, 0.012, 5, 18), mat(x, 0.26, z, Math.PI / 2, 0, 0), { tint: 0xb8c0c4 });
  k.add('iron', new THREE.TorusGeometry(0.13, 0.008, 5, 16, Math.PI), mat(x, 0.26, z, 0, 0.3, 0), { tint: 0x5a5a5a });
  if (milk) k.cyl('ceramic', 0.13, 0.13, 0.01, [x, 0.22, z], { tint: 0xfbf8f0, seg: 18 });
}

export function pitchfork(k: Kit, x: number, z: number, lean = 0.2, ry = 0): void {
  k.add('wood', new THREE.CylinderGeometry(0.018, 0.018, 1.5, 6), mat(x, 0.9, z, 0, ry, lean), { tint: 0xb08858 });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(0.006, 0.004, 0.3, 4);
    k.add('iron', g, mat(x + Math.sin(-lean) * -0.75 + (i - 1) * 0.04, 1.75, z, 0, ry, lean), { tint: 0x5a5a5a });
  }
}
