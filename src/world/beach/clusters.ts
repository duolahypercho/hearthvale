/**
 * Mid-scale set dressing for the open sand (so the beach between the parasol, the dory and the pier
 * never reads as a flat beige field):
 *   net rack     two driftwood A-frames + a ridge pole with a fishing net draped over it to dry,
 *                floats strung along the head rope, a couple fallen on the sand
 *   pot stack    three slatted lobster pots stacked 2 + 1, a coil of rope, a marker buoy and its pole
 *   dune island  a hummock of sand held by a ring of weathered picket fence (the marram is planted
 *                in index.ts: flora is its own batch)
 * Everything merges into the beach's static batches (MeshBuilder, shared materials).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, mat } from '../geom';
import { dryingNetMaterial } from './props';

type HeightAt = (x: number, z: number) => number;

const _up = new THREE.Vector3(0, 1, 0);

function pole(r0: number, r1: number, a: THREE.Vector3, b: THREE.Vector3, radial = 6): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Local (dx along the rack, dz across) → world, on the ground. */
function frame(x: number, z: number, rot: number, hAt: HeightAt) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (dx: number, dz: number, dy = 0): THREE.Vector3 => {
    const wx = x + dx * c + dz * s;
    const wz = z - dx * s + dz * c;
    return new THREE.Vector3(wx, hAt(wx, wz) + dy, wz);
  };
}

const DRIFT = 0xc8bca8;

/** A net hung to dry over a driftwood rack. Footprint ≈ 3.2 × 1.6 m. */
export function addNetRack(b: MeshBuilder, rng: Rng, x: number, z: number, rot: number, hAt: HeightAt): void {
  const at = frame(x, z, rot, hAt);
  const H = 1.55;
  const half = 1.45;
  // A-frames at each end (legs splayed across the rack, sunk a little into the sand).
  for (const ex of [-half, half]) {
    const top = at(ex, 0, H);
    for (const s of [-1, 1]) b.add('woodGrain', pole(0.05, 0.035, at(ex + (rng.next() - 0.5) * 0.1, s * 0.62, -0.12), top, 6), undefined, { tint: new THREE.Color(DRIFT).multiplyScalar(0.85 + rng.next() * 0.2) });
    // Lashing where the legs cross.
    b.add('cloth', new THREE.TorusGeometry(0.06, 0.018, 4, 8), mat(top.x, top.y - 0.08, top.z, Math.PI / 2, rot, 0), { tint: 0xc8a86a });
  }
  // Ridge pole, a touch past each end.
  b.add('woodGrain', pole(0.042, 0.038, at(-half - 0.3, 0, H + 0.02), at(half + 0.35, 0, H + 0.05), 7), undefined, { tint: 0xd4c8b0 });
  // Draped net: a sagging sheet folded over the pole, hanging lower on the sea side, lifted by the breeze.
  {
    const nx = 18;
    const ny = 10;
    const g = new THREE.PlaneGeometry(1, 1, nx, ny);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5; // along the pole
      const v = pos.getY(i) + 0.5; // 0 = hem on one side .. 1 = hem on the other
      const dx = (u - 0.5) * half * 1.85;
      const side = v < 0.5 ? -1 : 1;
      const k = Math.abs(v - 0.5) * 2; // 0 at the pole → 1 at the hem
      const drop = (side < 0 ? 1.05 : 1.3) * k;
      const sag = Math.sin(u * Math.PI) * 0.1 * k;
      const billow = Math.sin(u * 7 + side) * 0.05 * k + Math.sin(u * 13) * 0.02;
      const p = at(dx, side * (0.08 + k * (0.34 + 0.08 * Math.sin(u * 5))) + billow, H - drop - sag);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    g.computeVertexNormals();
    b.add(dryingNetMaterial(), g, undefined, { tint: 0xe8dcc0 });
  }
  // Floats strung along the head rope (just under the pole) + two dropped on the sand.
  for (let i = 0; i < 6; i++) {
    const p = at(-half + 0.25 + (i / 5) * (half * 2 - 0.5), 0.1, H - 0.14);
    b.add('woodPaint', new THREE.SphereGeometry(0.075, 10, 6).scale(1, 0.8, 1).translate(p.x, p.y, p.z), undefined, { tint: i % 2 ? 0xf2c84a : 0xe8483a });
  }
  for (const [dx, dz, c] of [[0.6, 0.95, 0xe8483a], [-1.1, -0.9, 0xf2c84a]] as const) {
    const p = at(dx, dz, 0.05);
    b.add('woodPaint', new THREE.SphereGeometry(0.08, 10, 6).scale(1, 0.75, 1).translate(p.x, p.y, p.z), undefined, { tint: c });
  }
  // A wooden net needle + a mending basket at the foot.
  const bp = at(half + 0.55, 0.45);
  const basket = new THREE.CylinderGeometry(0.22, 0.17, 0.26, 12, 1, true);
  b.add('woodGrain', basket.translate(bp.x, bp.y + 0.13, bp.z), undefined, { tint: 0xb08a58 });
  b.add('woodGrain', new THREE.CircleGeometry(0.2, 12).rotateX(-Math.PI / 2).translate(bp.x, bp.y + 0.2, bp.z), undefined, { tint: 0x8a6a48 });
  b.add('cloth', new THREE.TorusGeometry(0.1, 0.03, 5, 12).rotateX(Math.PI / 2).translate(bp.x, bp.y + 0.24, bp.z), undefined, { tint: 0xc8a86a });
}

/** Lobster pots stacked by a rope coil and a marker buoy. Footprint ≈ 1.8 m. */
export function addPotStack(b: MeshBuilder, rng: Rng, x: number, z: number, rot: number, hAt: HeightAt): void {
  const at = frame(x, z, rot, hAt);
  const pot = (p: THREE.Vector3, r: number): void => {
    const w = 0.7;
    const d = 0.46;
    // Wooden base + slatted arched hoops, netting between them.
    b.add('woodGrain', roundedBox(w, 0.05, d, 0.015), mat(p.x, p.y + 0.025, p.z, 0, r, 0), { tint: 0xa88a64 });
    for (const k of [-0.3, 0, 0.3]) {
      const hoop = new THREE.TorusGeometry(d / 2 - 0.02, 0.016, 4, 10, Math.PI);
      const c = Math.cos(r);
      const s = Math.sin(r);
      b.add('woodGrain', hoop, mat(p.x + k * c, p.y + 0.04, p.z - k * s, 0, r + Math.PI / 2, 0), { tint: 0xb89a70 });
    }
    // Slats along the top.
    for (const a of [-0.9, -0.3, 0.3, 0.9]) {
      const c = Math.cos(r);
      const s = Math.sin(r);
      const oy = Math.cos(a) * (d / 2 - 0.02);
      const oz = Math.sin(a) * (d / 2 - 0.02);
      b.add('woodGrain', roundedBox(w - 0.02, 0.022, 0.035, 0.006), mat(p.x + oz * s, p.y + 0.04 + oy, p.z + oz * c, a, r, 0), { tint: 0xc8aa80 });
    }
    // Netting skin (half-cylinder, a little inside the hoops).
    const skin = new THREE.CylinderGeometry(d / 2 - 0.035, d / 2 - 0.035, w - 0.06, 10, 1, true, 0, Math.PI);
    b.add(dryingNetMaterial(), skin, mat(p.x, p.y + 0.04, p.z, 0, r, Math.PI / 2), { tint: 0x9aa48a });
  };
  const r0 = rot + (rng.next() - 0.5) * 0.2;
  pot(at(-0.38, 0), r0);
  pot(at(0.38, 0.04), r0 + 0.06);
  pot(at(0, 0.02, 0.27), r0 - 0.08);
  // Rope coil beside the stack + a tail running off to the pots.
  const rc = at(0.35, 0.72);
  for (let i = 0; i < 4; i++) b.add('cloth', new THREE.TorusGeometry(0.24 - i * 0.04, 0.03, 5, 16).rotateX(Math.PI / 2).translate(rc.x, rc.y + 0.03 + i * 0.05, rc.z), undefined, { tint: 0xd0b07a });
  // Marker buoy on a pole, leaning on the stack.
  const b0 = at(-0.95, 0.45, -0.05);
  const b1 = at(-0.35, 0.1, 1.35);
  b.add('woodGrain', pole(0.025, 0.02, b0, b1, 5), undefined, { tint: 0xd8cbb0 });
  const bm = b0.clone().lerp(b1, 0.35);
  b.add('woodPaint', new THREE.SphereGeometry(0.15, 12, 8).scale(1, 1.25, 1).translate(bm.x, bm.y, bm.z), undefined, { tint: 0xe8483a });
  b.add('woodPaint', new THREE.CylinderGeometry(0.152, 0.152, 0.07, 12).translate(bm.x, bm.y + 0.06, bm.z), undefined, { tint: 0xf4efe2 });
  // Small flag at the top.
  b.add('cloth', new THREE.PlaneGeometry(0.22, 0.14).translate(0.11, 0, 0).rotateY(-rot).translate(b1.x, b1.y - 0.1, b1.z), undefined, { tint: 0xf2c84a });
}

/** A ring of weathered picket fence round a sand hummock (marram planted separately). */
export function addDuneIsland(b: MeshBuilder, rng: Rng, x: number, z: number, rx: number, rz: number, hAt: HeightAt): void {
  const n = Math.round(((rx + rz) * Math.PI) / 0.2);
  const gapAt = rng.next() * n;
  for (let i = 0; i < n; i++) {
    // Leave a trampled gap in the ring (a path through), and the odd missing slat.
    if (Math.abs(i - gapAt) < 3 || rng.next() < 0.07) continue;
    const a = (i / n) * Math.PI * 2;
    const px = x + Math.cos(a) * rx * (1 + (rng.next() - 0.5) * 0.05);
    const pz = z + Math.sin(a) * rz * (1 + (rng.next() - 0.5) * 0.05);
    const y = hAt(px, pz);
    const h = 0.55 + rng.next() * 0.18;
    const lean = (rng.next() - 0.3) * 0.18;
    const tint = new THREE.Color(0xc8b8a0).multiplyScalar(0.78 + rng.next() * 0.28);
    b.add('woodGrain', new THREE.BoxGeometry(0.06, h, 0.02), mat(px, y + h / 2 - 0.12, pz, lean, -a, 0), { tint, aoWorld: (q) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(q.y - y, 0, 0.25) });
  }
  // Two wires round the ring.
  for (const hy of [0.08, 0.34]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const px = x + Math.cos(a) * rx;
      const pz = z + Math.sin(a) * rz;
      pts.push(new THREE.Vector3(px, hAt(px, pz) + hy, pz));
    }
    b.add('metal', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 40, 0.007, 3, true), undefined, { tint: 0x6a6a64 });
  }
}
