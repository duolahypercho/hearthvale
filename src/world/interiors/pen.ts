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
  /** The manger / trough mouth point (floor coords): the animal stands `reach` behind it, facing feedHeading. */
  feed: THREE.Vector3;
  feedHeading: number;
  /** Where it sleeps (y > 0: a roost bar the bird flutters up onto). */
  bed: THREE.Vector3;
  /** Heading while asleep (default: random). */
  bedHeading?: number;
  /** Hay portion position in the manger / trough. */
  hay: THREE.Vector3;
  /** Own stall (barn): the animal lives inside this rect (root position), confined. */
  stall?: { x0: number; z0: number; x1: number; z1: number };
}

export interface PenAnchors {
  kind: 'coop' | 'barn';
  capacity: number;
  slots: PenSlot[];
  /** Egg spots (coop nesting boxes). */
  nests: THREE.Vector3[];
  /** Wander rectangle (room coords). */
  area: { x0: number; z0: number; x1: number; z1: number };
  /** Manger / trough tiles (inclusive): interact here holding hay (or with no animal in reach) to fill. */
  trough: { x0: number; z0: number; x1: number; z1: number };
  feedTile: { x: number; z: number };
  /** Stall name plaques (barn): where to hang each animal's name (facing +z). */
  plaques?: THREE.Vector3[];
  /** Chalkboard with the flock's names (coop): centre + yaw. */
  board?: { at: THREE.Vector3; ry: number };
  /** Roost perches (coop): chickens sleep up here (y = bar top), ducks keep to the slot beds. */
  perches?: THREE.Vector3[];
}

const STRAW = [0xf2dc94, 0xe0bc62, 0xf6e6aa, 0xd4a850, 0xe8cc7a];

/** Loose straws lying around (cx, cz within `spread`); `lift(dx, dz)` raises them onto a mound. */
export function strawTufts(k: Kit, rng: Rng, cx: number, y: number, cz: number, n: number, spread: number, lift?: (dx: number, dz: number) => number): void {
  for (let i = 0; i < n; i++) {
    const len = 0.1 + rng.next() * 0.16;
    const g = new THREE.CylinderGeometry(0.011, 0.008, len, 3, 1, true);
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
  k.add('straw', lumpySphere(0.5, 2, 0.2, rng), mat(x, -H * 0.12, z, 0, rng.next() * 3, 0, w, H * 2.1, d), { tint: 0xfff0c8 });
  const lumps = 3 + Math.floor(w * d * 3);
  for (let i = 0; i < lumps; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 0.2 + rng.next() * 0.25;
    const dx = Math.cos(a) * r * w;
    const dz = Math.sin(a) * r * d;
    const s = 0.18 + rng.next() * 0.14;
    k.add('straw', lumpySphere(0.5, 1, 0.3, rng), mat(x + dx, dome(dx, dz) * 0.55, z + dz, 0, rng.next() * 3, 0, s * w * 1.4, H * (0.7 + rng.next() * 0.6), s * d * 1.4), { tint: i % 2 ? 0xfff4d0 : 0xffe4a8 });
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

/** Tied burlap feed sack (lathe: slumped belly, pinched neck, twine); `open` rolls the top down to show grain. */
export function feedSack(k: Kit, x: number, z: number, ry: number, tint: number, open = false): void {
  const prof = open
    ? [[0, 0], [0.18, 0.01], [0.23, 0.12], [0.23, 0.32], [0.21, 0.44], [0.24, 0.47], [0.22, 0.5], [0, 0.5]]
    : [[0, 0], [0.18, 0.01], [0.23, 0.14], [0.22, 0.36], [0.15, 0.52], [0.06, 0.6], [0.05, 0.63], [0.09, 0.7], [0.03, 0.74], [0, 0.74]];
  const g = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a!, b!)), 18);
  g.scale(1, 1, 0.72);
  const lean = open ? 0 : 0.08;
  k.add('burlap', g, mat(x, 0, z, lean, ry, lean * 0.5), { tint });
  if (open) {
    k.add('ceramic', new THREE.CircleGeometry(0.2, 18).rotateX(-Math.PI / 2).scale(1, 1, 0.72), mat(x, 0.49, z, 0, ry, 0), { tint: 0xe8c050 });
    for (let i = 0; i < 14; i++) k.add('ceramic', new THREE.SphereGeometry(0.012, 5, 4), mat(x + Math.cos(i * 2.4) * 0.12 * (i % 3) * 0.5, 0.505, z + Math.sin(i * 2.4) * 0.08 * (i % 3) * 0.5), { tint: 0xd8a830 });
  } else {
    k.add('fabric', new THREE.TorusGeometry(0.055, 0.012, 5, 12), mat(x + Math.sin(lean) * 0.6, 0.62, z, Math.PI / 2, 0, 0), { tint: 0x8a6a3a });
  }
  // Stencilled label
  const lbl = new THREE.PlaneGeometry(0.2, 0.12);
  k.add('paint', lbl, mat(x + Math.sin(ry) * 0.17, 0.26, z + Math.cos(ry) * 0.17, 0, ry, 0), { tint: 0xb8503a });
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

/** Tall dairy can: shouldered lathe body, lid, two side handles. */
export function milkCan(k: Kit, x: number, z: number, ry = 0): void {
  const prof = [[0, 0], [0.15, 0], [0.16, 0.02], [0.16, 0.38], [0.14, 0.44], [0.08, 0.5], [0.075, 0.56], [0.085, 0.57], [0.085, 0.6], [0, 0.61]];
  k.add('tin', new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a!, b!)), 20), mat(x, 0, z, 0, ry, 0), { tint: 0xd4dade });
  for (const y of [0.06, 0.34]) k.add('tin', new THREE.TorusGeometry(0.162, 0.008, 5, 22), mat(x, y, z, Math.PI / 2, 0, 0), { tint: 0xa8b0b4 });
  for (const s of [-1, 1]) k.add('iron', new THREE.TorusGeometry(0.04, 0.009, 5, 10, Math.PI), mat(x + Math.cos(ry) * s * 0.15, 0.46, z - Math.sin(ry) * s * 0.15, 0, ry + Math.PI / 2, 0), { tint: 0x6a6a6a });
  k.cyl('tin', 0.09, 0.09, 0.03, [x, 0.6, z], { tint: 0xc0c8cc, seg: 16 });
}

/** Wooden wheelbarrow heaped with hay. */
export function wheelbarrow(k: Kit, rng: Rng, x: number, z: number, ry: number): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const m = (lx: number, ly: number, lz: number, rx = 0, rz = 0) => mat(x + lx * c + lz * s, ly, z - lx * s + lz * c, rx, ry, rz);
  // Tray (tapered box of planks)
  k.add('wood', roundedBox(0.62, 0.05, 0.78, 0.015), m(0, 0.36, 0), { tint: 0xa87450 });
  for (const sd of [-1, 1]) k.add('wood', roundedBox(0.04, 0.26, 0.82, 0.012), m(sd * 0.33, 0.49, 0, 0, sd * 0.2), { tint: 0xb88058 });
  k.add('wood', roundedBox(0.7, 0.26, 0.04, 0.012), m(0, 0.49, 0.41, -0.3, 0), { tint: 0xb07a52 });
  k.add('wood', roundedBox(0.66, 0.24, 0.04, 0.012), m(0, 0.48, -0.4), { tint: 0xb07a52 });
  // Handles + legs + wheel
  for (const sd of [-1, 1]) {
    k.add('wood', new THREE.CylinderGeometry(0.022, 0.022, 1.3, 7).rotateX(Math.PI / 2), m(sd * 0.25, 0.36, -0.2, -0.22), { tint: 0x8a5a3a });
    k.add('wood', new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6), m(sd * 0.22, 0.17, -0.42), { tint: 0x8a5a3a });
  }
  k.add('wood', new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16).rotateZ(Math.PI / 2), m(0, 0.17, 0.62), { tint: 0x7a5236 });
  k.add('iron', new THREE.TorusGeometry(0.17, 0.014, 5, 18).rotateY(Math.PI / 2), m(0, 0.17, 0.62), { tint: 0x3a3634 });
  // Heap of hay
  k.add('straw', lumpySphere(0.34, 2, 0.28, rng), m(0, 0.56, 0.02, 0, 0), { tint: 0xfff0c8 });
  strawTufts(k, rng, x, 0.72, z, 18, 0.3, () => 0);
}

/** Slatted wooden crate (optionally lying on another: y). */
export function crate(k: Kit, x: number, z: number, ry: number, tint: number, y = 0): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const m = (lx: number, ly: number, lz: number) => mat(x + lx * c + lz * s, y + ly, z - lx * s + lz * c, 0, ry, 0);
  k.add('wood', roundedBox(0.52, 0.04, 0.4, 0.01), m(0, 0.02, 0), { tint });
  for (const ly of [0.1, 0.26, 0.42]) {
    for (const sd of [-1, 1]) {
      k.add('wood', roundedBox(0.54, 0.1, 0.025, 0.01), m(0, ly, sd * 0.2), { tint: ly === 0.26 ? tint : 0xb08058 });
      k.add('wood', roundedBox(0.025, 0.1, 0.42, 0.01), m(sd * 0.265, ly, 0), { tint });
    }
  }
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) k.add('wood', roundedBox(0.04, 0.48, 0.04, 0.01), m(lx * 0.26, 0.24, lz * 0.19), { tint: 0x8a5a3a });
}

/** A low, flat drift of loose straw across the floor (breaks up the bedding texture). */
export function strawDrift(k: Kit, rng: Rng, x: number, z: number, w: number, d: number): void {
  // A loose kicked-up drift with real body: a darker trodden underlayer that feathers into the bedding,
  // plump fluffy lumps on top (lit crowns, shadowed flanks), and straws bristling out of the edges so the
  // outline never reads as a cut-out decal.
  const n = 2 + Math.floor(w * d * 1.2);
  k.add('straw', lumpySphere(0.5, 2, 0.25, rng), mat(x, -0.05, z, 0, rng.next() * 3, 0, w * 0.95, 0.16, d * 0.95), { tint: 0xe4c88c });
  const dome = (dx: number, dz: number): number => {
    const q = 1 - (dx / (w * 0.5)) ** 2 - (dz / (d * 0.5)) ** 2;
    return q > 0 ? 0.13 * Math.sqrt(q) : 0;
  };
  for (let i = 0; i < n; i++) {
    const dx = (rng.next() - 0.5) * w * 0.7;
    const dz = (rng.next() - 0.5) * d * 0.7;
    const s = 0.3 + rng.next() * 0.22;
    k.add('straw', lumpySphere(0.5, 2, 0.3, rng), mat(x + dx, -0.03, z + dz, 0, rng.next() * 3, 0, s * w * 0.85, 0.18 + rng.next() * 0.1, s * d * 0.85), { tint: i % 2 ? 0xf6e4bc : 0xefd8a4 });
  }
  strawTufts(k, rng, x, 0.02, z, Math.round(12 + w * d * 16), Math.max(w, d) * 0.55, dome);
}
