/**
 * Town-pod building + prop kit (extends props/townkit.ts): Flint & Ember forge with its open
 * work shed (glowing hearth, anvil, quench trough), The Copper Kettle inn, the Willowmere Clinic,
 * the lamplighter's cottage (ladder + old lanterns), the Birch house, a stone arch bridge and a
 * rope footbridge, plus market stalls with goods, a well, easels, a rowboat, lumber-yard pieces.
 * Conventions as townkit: MeshBuilder per material, origin = ground centre, +Z = front.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere, sphericalNormals } from '../geom';
import { lantern, type BuiltProp } from '../props/structures';
import { buildTownHouse } from '../props/townkit';
import { applyWorldFx } from '../../render/worldfx';

const groundAO = (h = 0.5, min = 0.6) => (p: THREE.Vector3): number => min + (1 - min) * THREE.MathUtils.smoothstep(p.y, 0, h);

let coals: THREE.MeshStandardMaterial | null = null;
/** Glowing forge coals / hearth mouth (emissive flicker driven by the town map). */
export function coalMaterial(): THREE.MeshStandardMaterial {
  if (!coals) {
    coals = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x3a2018, roughness: 0.9, emissive: 0xff5a1a, emissiveIntensity: 2.4 });
    coals.name = 'forgeCoals';
  }
  return coals;
}

let copper: THREE.MeshStandardMaterial | null = null;
function copperMat(): THREE.MeshStandardMaterial {
  if (!copper) {
    copper = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xd98a52, roughness: 0.32, metalness: 0.75 });
    copper.name = 'copper';
    applyWorldFx(copper);
  }
  return copper;
}

function attach(bp: BuiltProp, b: MeshBuilder, name: string): void {
  const g = b.build({ name });
  bp.group.add(g);
}

/** Wooden hanging sign on an iron bracket (board faces ±X, icon painted by `icon`). */
function hangingSign(b: MeshBuilder, x: number, y: number, z: number, board: number, icon: (b: MeshBuilder, ix: number, y: number, z: number, side: number) => void): void {
  b.add('metal', roundedBox(0.66, 0.04, 0.04, 0.01), mat(x, y + 0.42, z), { tint: 0x2e2a28 });
  b.add('metal', roundedBox(0.04, 0.04, 0.5, 0.01), mat(x - 0.28, y + 0.42, z - 0.05), { tint: 0x2e2a28 });
  for (const s of [-1, 1]) b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), mat(x + s * 0.2, y + 0.36, z), { tint: 0x2e2a28 });
  b.add('woodDark', roundedBox(0.07, 0.62, 0.66, 0.05), mat(x, y, z), { tint: 0x7a5234 });
  b.add('woodPaint', roundedBox(0.08, 0.54, 0.58, 0.04), mat(x, y, z), { tint: board });
  for (const side of [-1, 1]) icon(b, x + side * 0.045, y, z, side);
}

// ───────────────────────────────────────────── Flint & Ember forge

export function buildForge(rng: Rng): BuiltProp {
  const bp = buildTownHouse(rng, { w: 6.2, d: 5, wallH: 2.9, wall: 'stone', wallTint: 0xc4b6a4, roofTint: 0x5c6878, doorTint: 0x5a3a24, shutterTint: 0x8a4a2a, chimney: true, doorX: -1, sign: 'none' });
  const b = new MeshBuilder();
  const X0 = 3.1; // east wall
  const SW = 3.9; // shed width
  const baseH = 0.35;
  // Shed floor: packed stone slab.
  b.add('stone', boxUV(roundedBox(SW + 0.3, 0.12, 4.6, 0.04), 0.8), mat(X0 + SW / 2, 0.06, 0.1), { tint: 0xa89c8c, aoWorld: groundAO(0.1, 0.7) });
  // Posts + beams.
  for (const [px, pz] of [[X0 + SW, -1.9], [X0 + SW, 2.1], [X0 + 0.15, 2.1]] as const) {
    b.add('woodDark', roundedBox(0.2, 3.0, 0.2, 0.04), mat(px, 1.5, pz), { tint: 0x6a4a32, aoWorld: groundAO(0.5) });
    b.add('stone', roundedBox(0.34, 0.16, 0.34, 0.04), mat(px, 0.08, pz), { tint: 0xb0a490 });
  }
  b.add('woodDark', roundedBox(0.16, 0.2, 4.3, 0.04), mat(X0 + SW, 2.95, 0.1), { tint: 0x6a4a32 });
  b.add('woodDark', roundedBox(SW, 0.2, 0.16, 0.04), mat(X0 + SW / 2, 3.05, 2.1, 0, 0, -0.12), { tint: 0x6a4a32 });
  // Knee braces.
  for (const pz of [-1.9, 2.1]) b.add('woodDark', roundedBox(0.1, 0.8, 0.1, 0.02), mat(X0 + SW - 0.28, 2.7, pz + (pz < 0 ? 0.28 : -0.28), pz < 0 ? 0.75 : -0.75, 0, 0), { tint: 0x6a4a32 });
  // Lean-to roof (slate shingles), sloping down to the east.
  const roofLen = SW + 0.8;
  const roof = boxUV(roundedBox(roofLen, 0.14, 5.0, 0.05), 1 / 1.7);
  b.add('roofTile', roof, mat(X0 + SW / 2 + 0.1, 3.3, 0.1, 0, 0, -0.2), { tint: 0x6a7482, aoWorld: (p) => 0.8 + 0.2 * THREE.MathUtils.smoothstep(p.y, 2.8, 3.6) });
  // Hearth: brick block with arched mouth and a hood rising through the roof.
  const hx = X0 + 1.55;
  const hz = -1.05;
  b.add('stone', boxUV(roundedBox(1.9, 1.0, 1.35, 0.06), 0.55), mat(hx, 0.5, hz), { tint: 0xb06a4a, aoWorld: groundAO(0.4, 0.55) });
  b.add('stone', roundedBox(2.0, 0.12, 1.45, 0.04), mat(hx, 1.02, hz), { tint: 0x8a7a6a });
  const hood = new THREE.CylinderGeometry(0.34, 0.9, 1.0, 4, 1);
  hood.rotateY(Math.PI / 4);
  b.add('stone', hood, mat(hx, 1.95, hz - 0.1, 0, 0, 0, 1.2, 1, 0.85), { tint: 0x9a5a3e });
  b.add('stone', boxUV(roundedBox(0.62, 2.8, 0.62, 0.05), 0.8), mat(hx, 3.6, hz - 0.12), { tint: 0xa0604a });
  b.add('stone', roundedBox(0.8, 0.14, 0.8, 0.04), mat(hx, 5.02, hz - 0.12), { tint: 0x8a7a6a });
  // Coals bed (emissive) + hearth mouth glow.
  for (let i = 0; i < 9; i++) {
    const c = lumpySphere(0.11 + rng.next() * 0.05, 0, 0.3, rng);
    b.add(coalMaterial(), c, mat(hx - 0.5 + (i % 5) * 0.25, 1.1 + rng.next() * 0.04, hz - 0.15 + Math.floor(i / 5) * 0.28), { tint: i % 3 === 0 ? 0xffd0a0 : 0xffffff });
  }
  const mouth = new THREE.CircleGeometry(0.36, 14, 0, Math.PI);
  b.add(coalMaterial(), mouth, mat(hx, 0.34, hz + 0.68), { tint: 0xffb080 });
  b.add('stone', roundedBox(0.8, 0.12, 0.1, 0.03), mat(hx, 0.3, hz + 0.7), { tint: 0x6a4a3a });
  // Bellows beside the hearth.
  b.add('woodDark', roundedBox(0.5, 0.12, 0.9, 0.04), mat(hx + 1.35, 0.8, hz, 0.18, 0, 0), { tint: 0x7a5234 });
  b.add('cloth', roundedBox(0.44, 0.2, 0.8, 0.08), mat(hx + 1.35, 0.68, hz, 0.1, 0, 0), { tint: 0x6a4028 });
  b.add('woodDark', roundedBox(0.5, 0.08, 0.9, 0.03), mat(hx + 1.35, 0.55, hz), { tint: 0x7a5234 });
  // Anvil on a stump (the smith's spot faces it from the south).
  const ax = 4.8 + 0.3;
  const az = 1.0;
  b.add('bark', bevelCylinder(0.34, 0.4, 0.55, 0.04, 12), mat(ax, 0, az), { tint: 0x8a6a4a });
  b.add('wood', new THREE.CylinderGeometry(0.33, 0.33, 0.02, 12), mat(ax, 0.56, az), { tint: 0xd8b48a });
  b.add('metal', roundedBox(0.32, 0.16, 0.24, 0.03), mat(ax, 0.64, az), { tint: 0x3a3a3e });
  b.add('metal', roundedBox(0.2, 0.14, 0.18, 0.03), mat(ax, 0.78, az), { tint: 0x3a3a3e });
  b.add('metal', roundedBox(0.62, 0.14, 0.26, 0.04), mat(ax + 0.05, 0.92, az), { tint: 0x46464c });
  const horn = new THREE.ConeGeometry(0.1, 0.4, 10);
  horn.rotateZ(Math.PI / 2);
  b.add('metal', horn, mat(ax + 0.52, 0.94, az), { tint: 0x46464c });
  b.add('metal', roundedBox(0.3, 0.04, 0.04, 0.01), mat(ax - 0.05, 1.01, az + 0.05, 0, 0.4, 0), { tint: 0x8a3a1a });
  // Quench trough.
  b.add('woodGrain', boxUV(roundedBox(1.1, 0.5, 0.55, 0.04), 1.2), mat(X0 + SW - 0.55, 0.25, -0.35), { tint: 0x8a6a4a, aoWorld: groundAO(0.3) });
  b.add('stillWater', roundedBox(0.98, 0.02, 0.44, 0.01), mat(X0 + SW - 0.55, 0.46, -0.35));
  // Tool rack on the east wall: tongs + hammers + horseshoes.
  b.add('woodDark', roundedBox(0.08, 0.12, 1.9, 0.03), mat(X0 + 0.05, 2.0, 0.6), { tint: 0x6a4a32 });
  for (let i = 0; i < 6; i++) {
    const z = -0.2 + i * 0.32;
    const len = 0.5 + (i % 3) * 0.12;
    b.add('metal', roundedBox(0.03, len, 0.04, 0.01), mat(X0 + 0.12, 2.0 - len / 2, z), { tint: 0x2e2e32 });
    if (i % 2 === 0) b.add('metal', roundedBox(0.1, 0.08, 0.16, 0.02), mat(X0 + 0.12, 2.0 - len, z), { tint: 0x3a3a3e });
  }
  for (let i = 0; i < 3; i++) {
    const shoe = new THREE.TorusGeometry(0.09, 0.022, 5, 12, Math.PI * 1.4);
    b.add('metal', shoe, mat(X0 + 0.1, 2.4, -0.4 + i * 0.26, 0, Math.PI / 2, -Math.PI * 0.2), { tint: 0x5a4a44 });
  }
  // Iron bar stock + coal heap.
  for (let i = 0; i < 5; i++) b.add('metal', roundedBox(1.4, 0.05, 0.05, 0.01), mat(X0 + 2.1, 0.18 + (i % 2) * 0.05, 1.7 + i * 0.07), { tint: 0x4a4448 });
  for (let i = 0; i < 7; i++) b.add('rock', lumpySphere(0.16, 0, 0.35, rng), mat(X0 + SW - 0.4 + (rng.next() - 0.5) * 0.5, 0.12 + (i > 4 ? 0.12 : 0), 1.55 + (rng.next() - 0.5) * 0.5), { tint: 0x2a2a2e });
  // Big front sign: crossed hammer + anvil on a slate board.
  const fz = 2.5;
  hangingSign(b, -0.7, baseH + 2.2, fz + 0.4, 0x3a4450, (bb, ix, y, z) => {
    bb.add('white', roundedBox(0.03, 0.1, 0.3, 0.02), mat(ix, y - 0.1, z), { tint: 0xd8d0c0 });
    bb.add('white', roundedBox(0.03, 0.07, 0.14, 0.02), mat(ix, y - 0.02, z - 0.05), { tint: 0xd8d0c0 });
    bb.add('white', roundedBox(0.03, 0.3, 0.035, 0.01), mat(ix, y + 0.08, z + 0.08, 0.6, 0, 0), { tint: 0xc89a64 });
    bb.add('white', roundedBox(0.03, 0.08, 0.16, 0.02), mat(ix, y + 0.19, z + 0.16, 0.6, 0, 0), { tint: 0xf2b43a });
  });
  // Horseshoe over the door, for luck (points up).
  const shoe = new THREE.TorusGeometry(0.14, 0.03, 6, 14, Math.PI * 1.35);
  b.add('metal', shoe, mat(-2.2, baseH + 2.35, fz + 0.1, 0, 0, -Math.PI * 0.18), { tint: 0x7a6a5a });
  attach(bp, b, 'forge-shed');
  bp.anchors.hearth = new THREE.Vector3(hx, 1.3, hz + 0.3);
  bp.anchors.hearthSmoke = new THREE.Vector3(hx, 5.3, hz - 0.12);
  return bp;
}

// ───────────────────────────────────────────── The Copper Kettle inn

export function buildInn(rng: Rng): BuiltProp {
  const bp = buildTownHouse(rng, { w: 9.2, d: 6.0, wallH: 4.3, wall: 'plaster', wallTint: 0xf4dcb6, roofTint: 0x9a4a3a, doorTint: 0x6a3a22, shutterTint: 0x3f7a5a, chimney: true, flowerBoxes: true, doorX: 0, sign: 'none' });
  const b = new MeshBuilder();
  const fz = 3.0;
  const baseH = 0.35;
  // Porch canopy on two turned posts.
  for (const sx of [-1, 1]) {
    b.add('woodDark', bevelCylinder(0.09, 0.09, 2.5, 0.02, 10), mat(sx * 1.25, 0, fz + 1.35), { tint: 0x6a4a32, aoWorld: groundAO(0.4) });
    b.add('stone', roundedBox(0.3, 0.14, 0.3, 0.04), mat(sx * 1.25, 0.07, fz + 1.35), { tint: 0xc0b4a2 });
  }
  b.add('woodDark', roundedBox(2.9, 0.16, 0.16, 0.04), mat(0, 2.58, fz + 1.35), { tint: 0x6a4a32 });
  for (const s of [-1, 1]) b.add('roofTile', boxUV(roundedBox(3.3, 0.12, 1.25, 0.04), 1 / 1.7), mat(s * 0.78, 3.0, fz + 0.75, 0, 0, s * -0.45), { tint: 0x9a4a3a });
  const gable = new THREE.Shape();
  gable.moveTo(-1.45, 0);
  gable.lineTo(1.45, 0);
  gable.lineTo(0, 0.62);
  gable.closePath();
  const gg = new THREE.ExtrudeGeometry(gable, { depth: 0.1, bevelEnabled: false });
  b.add('woodPaint', gg, mat(0, 2.66, fz + 1.36), { tint: 0xf3ead8 });
  // Porch deck + steps.
  b.add('woodGrain', boxUV(roundedBox(3.2, 0.16, 1.7, 0.03), 1), mat(0, 0.2, fz + 0.75), { tint: 0xb88a5a, aoWorld: groundAO(0.2) });
  b.add('woodGrain', roundedBox(2.2, 0.1, 0.4, 0.03), mat(0, 0.07, fz + 1.75), { tint: 0xa87a50 });
  // Lanterns flanking the door.
  for (const sx of [-1, 1]) lantern(b, sx * 1.25, 2.25, fz + 1.5, 0.9);
  // Hanging copper-kettle sign from the upper storey.
  hangingSign(b, -2.6, baseH + 3.05, fz + 0.45, 0x2f5a44, (bb, ix, y, z) => {
    const pot = new THREE.SphereGeometry(0.14, 12, 8);
    pot.scale(0.25, 0.8, 1);
    bb.add(copperMat(), pot, mat(ix, y - 0.04, z));
    bb.add(copperMat(), roundedBox(0.03, 0.12, 0.05, 0.01), mat(ix, y - 0.02, z + 0.17, 0, 0, 0));
    bb.add(copperMat(), new THREE.TorusGeometry(0.09, 0.012, 4, 10, Math.PI).rotateY(Math.PI / 2), mat(ix, y + 0.08, z));
    bb.add('white', roundedBox(0.02, 0.05, 0.3, 0.01), mat(ix, y - 0.2, z), { tint: 0xf2d8a0 });
  });
  // A real copper kettle on the porch rail + casks by the door.
  const kettle = new THREE.SphereGeometry(0.2, 14, 10);
  kettle.scale(1, 0.8, 1);
  b.add(copperMat(), kettle, mat(1.9, 0.62, fz + 1.4));
  b.add(copperMat(), new THREE.CylinderGeometry(0.03, 0.05, 0.22, 8), mat(2.1, 0.66, fz + 1.4, 0, 0, -0.9));
  b.add(copperMat(), new THREE.TorusGeometry(0.13, 0.015, 5, 12, Math.PI), mat(1.9, 0.75, fz + 1.4));
  b.add('woodGrain', roundedBox(0.7, 0.44, 0.5, 0.04), mat(1.9, 0.22, fz + 1.4), { tint: 0x8a6a4a });
  // Upper-storey balcony rail with window boxes along the front.
  b.add('woodDark', roundedBox(8.6, 0.12, 0.5, 0.03), mat(0, baseH + 3.0, fz + 0.28), { tint: 0x6a4a32 });
  for (let i = 0; i < 18; i++) b.add('woodPaint', roundedBox(0.05, 0.5, 0.05, 0.01), mat(-4.2 + i * 0.49, baseH + 3.3, fz + 0.5), { tint: 0xf3ead8 });
  b.add('woodPaint', roundedBox(8.6, 0.08, 0.08, 0.02), mat(0, baseH + 3.58, fz + 0.5), { tint: 0xf3ead8 });
  for (let i = 0; i < 14; i++) {
    const x = -4 + i * 0.62;
    b.add('boxFlower', lumpySphere(0.14, 1, 0.3, rng), mat(x, baseH + 3.12, fz + 0.36), { tint: 0x4f9a3a });
    b.add('boxFlower', new THREE.IcosahedronGeometry(0.06, 0), mat(x + 0.04, baseH + 3.24, fz + 0.44), { tint: [0xff7aa2, 0xffd166, 0xf25f5c, 0xffffff][i % 4]! });
    if (i % 3 === 0) b.add('boxFlower', new THREE.IcosahedronGeometry(0.05, 0), mat(x + 0.1, baseH + 2.85 - rng.next() * 0.3, fz + 0.5), { tint: 0x3f7a2e });
  }
  attach(bp, b, 'inn-porch');
  const l = new THREE.PointLight(0xffb45e, 0, 8, 1.8);
  l.position.set(0, 2.3, fz + 1.9);
  bp.group.add(l);
  bp.lights.push({ light: l, max: 9 });
  bp.anchors.door = new THREE.Vector3(0, 0, fz + 2.2);
  return bp;
}

// ───────────────────────────────────────────── Willowmere Clinic

export function buildClinic(rng: Rng): BuiltProp {
  const bp = buildTownHouse(rng, { w: 7.2, d: 5.0, wallH: 3.1, wall: 'plaster', wallTint: 0xf4f4ec, roofTint: 0x4a8a7e, doorTint: 0x3a7a8a, shutterTint: 0x4a8a7e, awning: [0x4a9a8a, 0xf4f4ec], chimney: false, doorX: 0, sign: 'none' });
  const b = new MeshBuilder();
  const fz = 2.5;
  // Round teal sign above the door: a white leaf cradled by a heart (the clinic's emblem).
  b.add('woodPaint', bevelCylinder(0.46, 0.46, 0.08, 0.03, 24).rotateX(Math.PI / 2), mat(0, 3.02, fz + 0.1), { tint: 0x2f7a74 });
  b.add('woodPaint', new THREE.TorusGeometry(0.46, 0.04, 6, 28), mat(0, 3.02, fz + 0.15), { tint: 0xf2e2b8 });
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.22);
  heart.bezierCurveTo(-0.3, 0.02, -0.18, 0.26, 0, 0.1);
  heart.bezierCurveTo(0.18, 0.26, 0.3, 0.02, 0, -0.22);
  b.add('white', new THREE.ExtrudeGeometry(heart, { depth: 0.03, bevelEnabled: false }), mat(0, 3.02, fz + 0.15), { tint: 0xfaf6ee });
  const leaf = new THREE.SphereGeometry(0.09, 10, 6);
  leaf.scale(0.5, 1.2, 0.3);
  b.add('white', leaf, mat(0.02, 3.06, fz + 0.2, 0, 0, -0.5), { tint: 0x5aa86a });
  // Herb planters under the windows.
  for (const sx of [-1, 1]) {
    b.add('woodPaint', boxUV(roundedBox(1.3, 0.42, 0.45, 0.04), 1), mat(sx * 2.4, 0.21, fz + 0.45), { tint: 0x4a8a7e, aoWorld: groundAO(0.3) });
    for (let i = 0; i < 6; i++) {
      const g = lumpySphere(0.14, 1, 0.3, rng);
      sphericalNormals(g, new THREE.Vector3(), 0.5);
      b.add('boxFlower', g, mat(sx * 2.4 - 0.5 + i * 0.2, 0.52, fz + 0.45 + (rng.next() - 0.5) * 0.15), { tint: i % 2 ? 0x5a9a4a : 0x7ab05a });
    }
    for (let i = 0; i < 4; i++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.05, 0), mat(sx * 2.4 - 0.4 + i * 0.26, 0.66, fz + 0.5), { tint: 0xc8a8f0 });
  }
  attach(bp, b, 'clinic-extras');
  return bp;
}

// ───────────────────────────────────────────── Lamplighter's cottage

export function buildKeeperCottage(rng: Rng): BuiltProp {
  const bp = buildTownHouse(rng, { w: 4.8, d: 4.0, wallH: 2.5, wall: 'stone', wallTint: 0xdccfb8, roofTint: 0xcaa262, roof: 'thatch', doorTint: 0x5a7a4a, shutterTint: 0x5a7a4a, chimney: true, flowerBoxes: true, doorX: 0 });
  const b = new MeshBuilder();
  const fz = 2.0;
  // The lamplighter's ladder leaning on the wall.
  for (const s of [-1, 1]) b.add('woodGrain', roundedBox(0.07, 3.3, 0.07, 0.02), mat(1.55 + s * 0.2, 1.55, fz + 0.45, -0.22, 0, 0), { tint: 0xb89060 });
  for (let i = 0; i < 9; i++) b.add('woodGrain', roundedBox(0.44, 0.045, 0.045, 0.01), mat(1.55, 0.25 + i * 0.33, fz + 0.75 - i * 0.073), { tint: 0xa88050 });
  // A rail of old lanterns under the eave (his collection).
  b.add('woodDark', roundedBox(0.08, 0.08, 1.4, 0.02), mat(-2.5, 2.55, 0.6), { tint: 0x6a4a32 });
  for (let i = 0; i < 3; i++) {
    b.add('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.2, 4), mat(-2.55, 2.42, 0.1 + i * 0.5));
    lantern(b, -2.55, 2.18, 0.1 + i * 0.5, 0.75 + (i % 2) * 0.15);
  }
  // Bench by the door with a folded blanket.
  b.add('woodGrain', roundedBox(1.2, 0.07, 0.36, 0.03), mat(-1.3, 0.45, fz + 0.4), { tint: 0xa87a50 });
  for (const sx of [-1, 1]) b.add('woodDark', roundedBox(0.07, 0.45, 0.3, 0.02), mat(-1.3 + sx * 0.5, 0.22, fz + 0.4));
  b.add('cloth', roundedBox(0.4, 0.08, 0.3, 0.04), mat(-1.0, 0.52, fz + 0.4), { tint: 0x8a3a3a });
  attach(bp, b, 'keeper-extras');
  return bp;
}

// ───────────────────────────────────────────── Birch house + NE house

export function buildBirchHouse(rng: Rng): BuiltProp {
  const bp = buildTownHouse(rng, { w: 6.0, d: 4.6, wallH: 2.8, wall: 'wood', wallTint: 0xe6cca4, roofTint: 0x6a8e5a, doorTint: 0xb8573e, shutterTint: 0xb8573e, chimney: true, flowerBoxes: false, doorX: -1 });
  const b = new MeshBuilder();
  const fz = 2.3;
  // Workbench against the front wall.
  b.add('woodGrain', boxUV(roundedBox(1.6, 0.1, 0.6, 0.03), 1), mat(1.5, 0.85, fz + 0.4), { tint: 0xc89a64 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodDark', roundedBox(0.08, 0.85, 0.08, 0.02), mat(1.5 + sx * 0.7, 0.42, fz + 0.4 + sz * 0.22));
  b.add('metal', roundedBox(0.3, 0.06, 0.08, 0.02), mat(1.2, 0.93, fz + 0.4), { tint: 0x5a5a5a });
  b.add('woodGrain', roundedBox(0.9, 0.05, 0.18, 0.02), mat(1.7, 0.93, fz + 0.35, 0, 0.2, 0), { tint: 0xe0c090 });
  // Kit's treasures: a toy boat + a bucket.
  b.add('woodPaint', roundedBox(0.3, 0.1, 0.12, 0.04), mat(-0.4, 0.08, fz + 0.9, 0, 0.5, 0), { tint: 0xd8573e });
  b.add('white', new THREE.ConeGeometry(0.06, 0.16, 3), mat(-0.4, 0.2, fz + 0.9), { tint: 0xf6f0e0 });
  b.add('metal', bevelCylinder(0.13, 0.1, 0.22, 0.02, 10), mat(0.2, 0, fz + 0.95), { tint: 0x7a9ab0 });
  attach(bp, b, 'birch-extras');
  return bp;
}

export function buildHouseNE(rng: Rng): BuiltProp {
  return buildTownHouse(rng, { w: 5.2, d: 4.2, wallH: 2.7, wall: 'plaster', wallTint: 0xf0e0f0, roofTint: 0x7a6aa8, doorTint: 0xd89a3a, shutterTint: 0x7a6aa8, chimney: true, flowerBoxes: true, doorX: 0 });
}

// ───────────────────────────────────────────── Bridges

/** Deck height above the bridge's base at local x in [-len/2, len/2]. */
export function deckY(br: { len: number; rise: number; endY: number }, lx: number): number {
  const t = THREE.MathUtils.clamp(lx / br.len + 0.5, 0, 1);
  return br.endY + br.rise * Math.sin(Math.PI * t);
}

/** Stone arch bridge along X (deck top follows deckY). */
export function buildStoneBridge(rng: Rng, br: { len: number; width: number; rise: number; endY: number }, bedY: number): THREE.Group {
  const b = new MeshBuilder();
  const L = br.len;
  const W = br.width;
  const N = 16;
  const seg = L / N;
  for (let i = 0; i < N; i++) {
    const x = -L / 2 + (i + 0.5) * seg;
    const y0 = deckY(br, x - seg / 2);
    const y1 = deckY(br, x + seg / 2);
    const ang = Math.atan2(y1 - y0, seg);
    const y = (y0 + y1) / 2;
    // Deck body (thick so the arch reads from the side).
    b.add('stone', boxUV(roundedBox(seg + 0.06, 0.34, W, 0.03), 0.6), mat(x, y - 0.17, 0, 0, 0, ang), { tint: i % 2 ? 0xc8beb0 : 0xbeb4a4 });
    // Parapets: low walls with coping stones.
    for (const s of [-1, 1]) {
      b.add('stone', boxUV(roundedBox(seg + 0.04, 0.5, 0.3, 0.05), 0.7), mat(x, y + 0.25, s * (W / 2 - 0.1), 0, 0, ang), { tint: (i + (s > 0 ? 1 : 0)) % 3 ? 0xcfc6b8 : 0xc2b8a8 });
      b.add('stone', roundedBox(seg + 0.08, 0.1, 0.38, 0.04), mat(x, y + 0.54, s * (W / 2 - 0.1), 0, 0, ang), { tint: 0xe0d8ca });
    }
  }
  // End piers + newel posts with little lanterns.
  for (const sx of [-1, 1]) {
    for (const s of [-1, 1]) {
      const x = sx * (L / 2 - 0.1);
      b.add('stone', boxUV(roundedBox(0.52, 0.95, 0.52, 0.06), 0.7), mat(x, br.endY + 0.45, s * (W / 2 - 0.05)), { tint: 0xd0c6b6, aoWorld: groundAO(0.4) });
      b.add('stone', roundedBox(0.62, 0.12, 0.62, 0.04), mat(x, br.endY + 0.96, s * (W / 2 - 0.05)), { tint: 0xe4dccc });
      b.add('stone', new THREE.SphereGeometry(0.16, 12, 8), mat(x, br.endY + 1.12, s * (W / 2 - 0.05)), { tint: 0xe4dccc });
    }
  }
  // Arch faces: voussoir ring on both sides, barrel under.
  const archR = L * 0.3;
  const archCY = br.endY + br.rise - 0.35 - archR;
  const K = 13;
  for (const s of [-1, 1]) {
    for (let k = 0; k <= K; k++) {
      const a = Math.PI * (k / K);
      const x = Math.cos(a) * (archR + 0.18);
      const y = archCY + Math.sin(a) * (archR + 0.18);
      if (y < bedY - 0.2) continue;
      b.add('stone', roundedBox(0.42, 0.36, 0.14, 0.04), mat(x, y, s * (W / 2 + 0.01), 0, 0, a - Math.PI / 2), { tint: k % 2 ? 0xb8ae9e : 0xc8beae });
    }
    // Spandrel fill between arch and deck (dark stone, set back).
    for (const sx of [-1, 1]) {
      const g = new THREE.Shape();
      g.moveTo(sx * archR * 0.2, deckY(br, sx * archR * 0.2) - 0.35);
      g.lineTo(sx * (L / 2 - 0.3), deckY(br, sx * (L / 2 - 0.3)) - 0.35);
      g.lineTo(sx * (L / 2 - 0.3), bedY - 0.3);
      g.lineTo(sx * archR * 1.02, bedY - 0.3);
      g.lineTo(sx * archR * 0.95, archCY + archR * 0.3);
      g.lineTo(sx * archR * 0.6, archCY + archR * 0.8);
      g.closePath();
      const eg = new THREE.ExtrudeGeometry(g, { depth: 0.12, bevelEnabled: false });
      boxUV(eg, 0.6);
      b.add('stone', eg, mat(0, 0, s > 0 ? W / 2 - 0.12 : -W / 2), { tint: 0xa89e8e });
    }
  }
  const barrel = new THREE.CylinderGeometry(archR, archR, W - 0.1, 20, 1, true, -Math.PI / 2, Math.PI);
  barrel.rotateX(Math.PI / 2);
  barrel.scale(1, 1, 1);
  b.add('stone', barrel, mat(0, archCY, 0, 0, 0, 0), { tint: 0x7a7266 });
  // Moss trim along the waterline.
  for (let i = 0; i < 10; i++) {
    const x = (rng.next() - 0.5) * archR * 2.6;
    const m = lumpySphere(0.14, 0, 0.35, rng);
    m.scale(1.4, 0.5, 1);
    b.add('boxFlower', m, mat(x, bedY + 0.9, (rng.next() < 0.5 ? -1 : 1) * (W / 2 + 0.05)), { tint: 0x5a8a3a });
  }
  // Flower pots on the end posts.
  for (const sx of [-1, 1]) {
    b.add('soilPot', bevelCylinder(0.16, 0.12, 0.2, 0.02, 10), mat(sx * (L / 2 - 0.1), br.endY + 1.02, 0), { tint: 0xc8704a });
  }
  const g = b.build({ name: 'stone-bridge' });
  return g;
}

/** Rope-and-plank footbridge along X. */
export function buildFootbridge(rng: Rng, br: { len: number; width: number; rise: number; endY: number }, bedY: number): THREE.Group {
  const b = new MeshBuilder();
  const L = br.len;
  const W = br.width;
  const n = Math.round(L / 0.3);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const y = deckY(br, x);
    b.add('woodGrain', roundedBox(0.26, 0.07, W + (rng.next() - 0.5) * 0.1, 0.02), mat(x, y - 0.035, 0, (rng.next() - 0.5) * 0.04, (rng.next() - 0.5) * 0.05, 0), { tint: i % 3 ? 0xc9a07a : 0xb88e62 });
  }
  for (const s of [-1, 1]) {
    // Stringers.
    for (let i = 0; i < 8; i++) {
      const x0 = -L / 2 + (i / 8) * L;
      const x1 = -L / 2 + ((i + 1) / 8) * L;
      const y0 = deckY(br, x0);
      const y1 = deckY(br, x1);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      b.add('woodDark', roundedBox(L / 8 + 0.04, 0.14, 0.1, 0.02), mat((x0 + x1) / 2, (y0 + y1) / 2 - 0.12, s * (W / 2 - 0.04), 0, 0, ang), { tint: 0x7a5a3e });
      b.add('woodGrain', roundedBox(L / 8 + 0.04, 0.07, 0.07, 0.02), mat((x0 + x1) / 2, (y0 + y1) / 2 + 0.78, s * (W / 2 - 0.04), 0, 0, ang), { tint: 0xa8804e });
    }
    // Posts.
    for (let i = 0; i <= 4; i++) {
      const x = -L / 2 + (i / 4) * L;
      const y = deckY(br, x);
      const deep = i === 0 || i === 4 ? 0.2 : y - bedY + 0.2;
      b.add('woodDark', roundedBox(0.12, 0.85 + deep, 0.12, 0.02), mat(x, y + 0.42 - deep / 2, s * (W / 2 - 0.04)), { tint: 0x6a4a32 });
    }
  }
  return b.build({ name: 'footbridge' });
}

// ───────────────────────────────────────────── Props

/** Market stall with a canopy and goods on the counter. */
export function buildStall(rng: Rng, stripes: [number, number], goods: 'produce' | 'fish' | 'flowers' | 'pottery'): THREE.Group {
  const b = new MeshBuilder();
  const W = 2.6;
  b.add('wood', boxUV(roundedBox(W, 0.9, 0.9, 0.04), 1 / 1.2), mat(0, 0.45, 0), { tint: 0xc89a64, aoWorld: groundAO(0.3) });
  b.add('woodGrain', roundedBox(W + 0.2, 0.08, 1.05, 0.03), mat(0, 0.94, 0.02), { tint: 0xd8b48a });
  // Skirt cloth in the stall colour.
  b.add('cloth', roundedBox(W + 0.1, 0.5, 0.04, 0.02), mat(0, 0.66, 0.5), { tint: stripes[0] });
  for (let i = 0; i < 9; i++) {
    const sc = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 8, 1, false, 0, Math.PI);
    sc.rotateX(Math.PI / 2);
    b.add('cloth', sc, mat(-W / 2 + 0.14 + i * 0.29, 0.41, 0.52, 0, 0, Math.PI), { tint: stripes[0] });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.09, 2.3, 0.09, 0.03), mat(sx * (W / 2 + 0.05), 1.15, sz * 0.5), { tint: 0xa87a50 });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 - 0.15 + (i + 0.5) * ((W + 0.3) / n);
    b.add('cloth', roundedBox((W + 0.3) / n + 0.01, 0.04, 1.4, 0.015), mat(x, 2.36, 0.05, 0.22, 0, 0), { tint: stripes[i % 2]! });
    const sc = new THREE.CylinderGeometry((W + 0.3) / n / 2, (W + 0.3) / n / 2, 0.035, 10, 1, false, 0, Math.PI);
    sc.rotateX(Math.PI / 2);
    b.add('cloth', sc, mat(x, 2.15, 0.74, 0, 0, Math.PI), { tint: stripes[i % 2]! });
  }
  const top = 0.98;
  if (goods === 'produce') {
    const produce = [0xe4432e, 0xf2c43a, 0x6fae45, 0xe8741e];
    for (let c = 0; c < 4; c++) {
      const cx = -0.95 + c * 0.63;
      b.add('wood', boxUV(roundedBox(0.52, 0.2, 0.5, 0.02), 1.4), mat(cx, top + 0.1, 0.08, -0.25, 0, 0), { tint: 0xe0b484 });
      for (let i = 0; i < 9; i++) {
        const g = c === 2 ? lumpySphere(0.09, 0, 0.3, rng) : new THREE.SphereGeometry(0.075, 8, 6);
        b.add('white', g, mat(cx - 0.15 + (i % 3) * 0.15, top + 0.22 + (i < 3 ? 0.05 : i < 6 ? 0.0 : -0.05), -0.05 + Math.floor(i / 3) * 0.14), { tint: produce[c]! });
      }
    }
  } else if (goods === 'fish') {
    // Ice trays with fish, a hanging scale.
    for (let c = 0; c < 3; c++) {
      const cx = -0.85 + c * 0.85;
      b.add('wood', boxUV(roundedBox(0.75, 0.12, 0.6, 0.02), 1.4), mat(cx, top + 0.06, 0.05, -0.2, 0, 0), { tint: 0x7aa0b8 });
      b.add('white', roundedBox(0.66, 0.05, 0.5, 0.02), mat(cx, top + 0.12, 0.05, -0.2, 0, 0), { tint: 0xe8f4fa });
      for (let i = 0; i < 3; i++) {
        const f = new THREE.SphereGeometry(0.07, 10, 6);
        f.scale(2.6, 0.7, 1);
        const tint = [0x8aa0b0, 0xc8a870, 0x6a8a9a][c]!;
        b.add('white', f, mat(cx - 0.1 + (i % 2) * 0.12, top + 0.18, -0.12 + i * 0.16, -0.2, 0.3 * (i - 1), 0), { tint });
        const tail = new THREE.ConeGeometry(0.06, 0.1, 3);
        tail.rotateZ(Math.PI / 2);
        b.add('white', tail, mat(cx + 0.14 + (i % 2) * 0.12, top + 0.18, -0.12 + i * 0.16, -0.2, 0.3 * (i - 1), 0), { tint });
      }
    }
    b.add('metal', new THREE.CylinderGeometry(0.12, 0.12, 0.03, 12), mat(0.9, 1.7, 0.45), { tint: 0xb8b0a0 });
    b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), mat(0.9, 1.95, 0.45), { tint: 0x3a3a3a });
  } else if (goods === 'flowers') {
    const blooms = [0xff8fab, 0xffd166, 0xffffff, 0xc77dff, 0xf25f5c, 0x7ec8ff];
    for (let c = 0; c < 5; c++) {
      const cx = -1.0 + c * 0.5;
      b.add('metal', bevelCylinder(0.17, 0.13, 0.3, 0.02, 10), mat(cx, top, 0.05), { tint: 0x8aa0a8 });
      for (let k = 0; k < 7; k++) {
        const a = rng.next() * Math.PI * 2;
        const r = rng.next() * 0.1;
        b.add('boxFlower', roundedBox(0.015, 0.3, 0.015, 0.005, 1), mat(cx + Math.cos(a) * r, top + 0.4, 0.05 + Math.sin(a) * r, (rng.next() - 0.5) * 0.4, 0, (rng.next() - 0.5) * 0.4), { tint: 0x4f8a3a });
        b.add('boxFlower', new THREE.IcosahedronGeometry(0.06, 0), mat(cx + Math.cos(a) * r * 1.6, top + 0.58 + rng.next() * 0.06, 0.05 + Math.sin(a) * r * 1.6), { tint: blooms[(c + k) % blooms.length]! });
      }
    }
  } else {
    for (let c = 0; c < 6; c++) {
      const cx = -1.0 + c * 0.4;
      const pot = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.1, 0.01), new THREE.Vector2(0.13, 0.1), new THREE.Vector2(0.08, 0.22), new THREE.Vector2(0.09, 0.26)], 12);
      b.add('white', pot, mat(cx, top, 0.05), { tint: [0xc8704a, 0x5a8aa8, 0xe8d8b8][c % 3]! });
    }
  }
  // Chalk price board.
  b.add('woodDark', roundedBox(0.6, 0.8, 0.05, 0.02), mat(W / 2 + 0.35, 0.42, 0.55, -0.2, -0.4, 0));
  b.add('white', roundedBox(0.5, 0.66, 0.02, 0.01), mat(W / 2 + 0.36, 0.43, 0.58, -0.2, -0.4, 0), { tint: 0x2e3a32 });
  for (let i = 0; i < 3; i++) b.add('white', roundedBox(0.3, 0.025, 0.01, 0.005, 1), mat(W / 2 + 0.36, 0.6 - i * 0.14, 0.595 - i * 0.03, -0.2, -0.4, 0), { tint: 0xf0f0e0 });
  return b.build({ name: 'stall' });
}

export function buildWell(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const wall = new THREE.CylinderGeometry(0.85, 0.92, 0.8, 20, 1, true);
  b.add('stone', wall, mat(0, 0.4, 0), { tint: 0xc8bfae, aoWorld: groundAO(0.4, 0.55) });
  const rim = new THREE.TorusGeometry(0.86, 0.12, 8, 24);
  rim.rotateX(Math.PI / 2);
  b.add('stone', rim, mat(0, 0.82, 0), { tint: 0xd8d0c2 });
  b.add('stillWater', new THREE.CircleGeometry(0.78, 20).rotateX(-Math.PI / 2), mat(0, 0.35, 0));
  for (const sx of [-1, 1]) b.add('woodDark', roundedBox(0.14, 2.0, 0.14, 0.03), mat(sx * 0.95, 1.0, 0), { tint: 0x6a4a32 });
  const axle = new THREE.CylinderGeometry(0.07, 0.07, 1.9, 8);
  axle.rotateZ(Math.PI / 2);
  b.add('woodGrain', axle, mat(0, 1.6, 0), { tint: 0xa87a50 });
  b.add('woodDark', roundedBox(0.06, 0.3, 0.06, 0.01), mat(1.1, 1.5, 0.1), { tint: 0x6a4a32 });
  for (const s of [-1, 1]) b.add('roofTile', boxUV(roundedBox(2.4, 0.1, 1.05, 0.04), 1 / 1.7), mat(0, 2.25, s * 0.42, s * 0.62, 0, 0), { tint: 0xb85a3e });
  b.add('roofTile', new THREE.CylinderGeometry(0.08, 0.08, 2.4, 8).rotateZ(Math.PI / 2), mat(0, 2.56, 0), { tint: 0x9a4a32 });
  b.add('metal', new THREE.CylinderGeometry(0.004, 0.004, 0.6, 3), mat(0, 1.3, 0), { tint: 0x8a7a60 });
  b.add('woodGrain', bevelCylinder(0.15, 0.12, 0.24, 0.02, 10), mat(0, 0.9, 0), { tint: 0x8a6a4a });
  void rng;
  return b.build({ name: 'well' });
}

export function buildEasel(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (const [x, rz, rx] of [[-0.28, -0.12, 0.1], [0.28, 0.12, 0.1], [0, 0, -0.35]] as const) b.add('woodGrain', roundedBox(0.05, 1.6, 0.05, 0.015), mat(x, 0.78, rx < 0 ? -0.26 : 0.02, rx, 0, rz), { tint: 0xb89060 });
  b.add('woodGrain', roundedBox(0.7, 0.05, 0.1, 0.015), mat(0, 0.78, 0.06), { tint: 0xb89060 });
  // Canvas with a painted view (little strokes of sky, hills, a bridge).
  b.add('white', roundedBox(0.72, 0.56, 0.03, 0.01), mat(0, 1.1, 0.07, -0.1, 0, 0), { tint: 0xf8f4ea });
  const strokes: [number, number, number, number, number][] = [
    [0, 1.26, 0.64, 0.2, 0x9ac8e8],
    [0, 1.12, 0.64, 0.1, 0x7ab05a],
    [0, 1.0, 0.64, 0.14, 0x4a8aa8],
    [-0.1, 1.08, 0.3, 0.06, 0xc8b8a0],
    [0.2, 1.24, 0.1, 0.1, 0xffd166],
  ];
  for (const [x, y, w, h, c] of strokes) b.add('white', roundedBox(w, h, 0.01, 0.005, 1), mat(x, y, 0.09 - (y - 1.1) * 0.1, -0.1, 0, 0), { tint: c });
  // Paint box + stool.
  b.add('woodGrain', roundedBox(0.36, 0.1, 0.24, 0.02), mat(0.5, 0.05, 0.3, 0, 0.4, 0), { tint: 0x8a5a3a });
  for (let i = 0; i < 4; i++) b.add('white', new THREE.SphereGeometry(0.03, 6, 4), mat(0.42 + i * 0.05, 0.11, 0.28 + (i % 2) * 0.04), { tint: [0xe8574a, 0x4a8aa8, 0xffd166, 0x7ab05a][i]! });
  void rng;
  return b.build({ name: 'easel' });
}

export function buildRowboat(): THREE.Group {
  const b = new MeshBuilder();
  const hull = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hull.scale(2.6, 0.7, 1.1);
  b.add('woodGrain', hull, mat(0, 0.36, 0), { tint: 0x5a8aa8 });
  const rim = new THREE.TorusGeometry(0.5, 0.05, 6, 24);
  rim.rotateX(Math.PI / 2);
  rim.scale(2.6, 1, 1.1);
  b.add('woodGrain', rim, mat(0, 0.36, 0), { tint: 0xe8e0d0 });
  for (const x of [-0.35, 0.4]) b.add('woodGrain', roundedBox(0.2, 0.05, 1.0, 0.02), mat(x, 0.3, 0), { tint: 0xc89a64 });
  const oar = roundedBox(1.6, 0.04, 0.06, 0.02);
  b.add('woodGrain', oar, mat(0.1, 0.42, 0.3, 0, 0.12, 0.05), { tint: 0xd8b48a });
  b.add('woodGrain', roundedBox(0.3, 0.02, 0.14, 0.01), mat(0.85, 0.42, 0.4, 0, 0.12, 0.05), { tint: 0xd8b48a });
  return b.build({ name: 'rowboat' });
}

export function buildSawhorse(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  b.add('woodGrain', roundedBox(1.2, 0.1, 0.12, 0.02), mat(0, 0.7, 0), { tint: 0xb89060 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.06, 0.78, 0.06, 0.015), mat(sx * 0.45, 0.35, sz * 0.14, sz * 0.25, 0, 0), { tint: 0xa88050 });
  b.add('woodGrain', roundedBox(1.9, 0.05, 0.24, 0.015), mat(0.2, 0.78, 0, 0, 0.1, 0), { tint: 0xe2c28e });
  // Sawdust heap.
  const dust = lumpySphere(0.4, 1, 0.2, rng);
  dust.scale(1.2, 0.12, 1);
  b.add('white', dust, mat(0.4, 0.0, 0.2), { tint: 0xe8d0a0 });
  return b.build({ name: 'sawhorse' });
}

export function buildLumber(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < 5 - (layer % 2); i++) {
      b.add('woodGrain', roundedBox(2.4 - layer * 0.1, 0.1, 0.24, 0.02), mat((rng.next() - 0.5) * 0.1, 0.18 + layer * 0.14, -0.55 + i * 0.27 + (layer % 2) * 0.13), { tint: layer % 2 ? 0xe2c28e : 0xd8b07a, aoWorld: groundAO(0.4, 0.65) });
    }
    b.add('woodDark', roundedBox(0.1, 0.06, 1.4, 0.02), mat(-0.9, 0.11 + layer * 0.14, 0), { tint: 0x7a5a3e });
    b.add('woodDark', roundedBox(0.1, 0.06, 1.4, 0.02), mat(0.9, 0.11 + layer * 0.14, 0), { tint: 0x7a5a3e });
  }
  return b.build({ name: 'lumber' });
}

export function buildLogPile(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const rows = [4, 3, 2];
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const rad = 0.2 + rng.next() * 0.04;
      const log = new THREE.CylinderGeometry(rad, rad, 1.5 + rng.next() * 0.2, 10);
      log.rotateX(Math.PI / 2);
      b.add('bark', log, mat(-((n - 1) * 0.42) / 2 + i * 0.42, 0.21 + r * 0.36, 0), { tint: 0x8a6a4a, aoWorld: groundAO(0.5, 0.6) });
      for (const s of [-1, 1]) b.add('wood', new THREE.CircleGeometry(rad * 0.94, 10), mat(-((n - 1) * 0.42) / 2 + i * 0.42, 0.21 + r * 0.36, s * 0.78, 0, s > 0 ? 0 : Math.PI, 0), { tint: 0xe8c890 });
    }
  });
  return b.build({ name: 'logpile' });
}

export function buildSacks(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (let i = 0; i < 4; i++) {
    const s = lumpySphere(0.3, 1, 0.12, rng, 1.2);
    s.scale(1, 1.25, 0.85);
    b.add('cloth', s, mat((i % 2) * 0.5 - 0.25, 0.34 + (i > 1 ? 0.45 : 0), (i > 1 ? 0.05 : 0) + (rng.next() - 0.5) * 0.1, 0, rng.next(), (rng.next() - 0.5) * 0.3), { tint: i % 2 ? 0xe0cca0 : 0xd4bc8c, aoWorld: groundAO(0.4, 0.6) });
    b.add('cloth', new THREE.CylinderGeometry(0.05, 0.1, 0.14, 8), mat((i % 2) * 0.5 - 0.25, 0.72 + (i > 1 ? 0.45 : 0), 0), { tint: 0xc8b080 });
  }
  return b.build({ name: 'sacks' });
}

export function buildProduceCrates(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const fill = [0xe4432e, 0x6fae45, 0xf2c43a];
  for (let c = 0; c < 3; c++) {
    const x = (c - 1) * 0.62;
    const y = c === 1 ? 0.5 : 0;
    b.add('wood', boxUV(roundedBox(0.56, 0.36, 0.46, 0.02), 1.4), mat(x * (c === 1 ? 0 : 1), y + 0.18, c === 1 ? 0.05 : 0), { tint: 0xd8ac7a, aoWorld: groundAO(0.3, 0.65) });
    for (let i = 0; i < 9; i++) b.add('white', c === 1 ? lumpySphere(0.09, 0, 0.3, rng) : new THREE.SphereGeometry(0.08, 8, 6), mat(x * (c === 1 ? 0 : 1) - 0.15 + (i % 3) * 0.15, y + 0.39, (c === 1 ? 0.05 : 0) - 0.13 + Math.floor(i / 3) * 0.13), { tint: fill[c]! });
  }
  return b.build({ name: 'produce' });
}

/** Rope swing hanging from a crossbar frame (Rowan's build for Kit). */
export function buildSwing(): THREE.Group {
  const b = new MeshBuilder();
  for (const sx of [-1, 1]) {
    b.add('woodGrain', roundedBox(0.12, 2.5, 0.12, 0.03), mat(sx * 0.95, 1.2, 0.4, -0.3, 0, 0), { tint: 0xb89060 });
    b.add('woodGrain', roundedBox(0.12, 2.5, 0.12, 0.03), mat(sx * 0.95, 1.2, -0.4, 0.3, 0, 0), { tint: 0xb89060 });
  }
  b.add('woodGrain', roundedBox(2.2, 0.14, 0.14, 0.03), mat(0, 2.38, 0), { tint: 0xa88050 });
  for (const sx of [-0.28, 0.28]) b.add('white', new THREE.CylinderGeometry(0.012, 0.012, 1.8, 4), mat(sx, 1.46, 0), { tint: 0xd8c8a0 });
  b.add('woodGrain', roundedBox(0.7, 0.06, 0.26, 0.02), mat(0, 0.56, 0), { tint: 0xd8573e });
  return b.build({ name: 'swing' });
}

/** Free-standing inn sign on a post: "The Copper Kettle" (kettle silhouette + board). */
export function buildKettleSign(): THREE.Group {
  const b = new MeshBuilder();
  b.add('woodDark', roundedBox(0.14, 2.3, 0.14, 0.03), mat(0, 1.15, 0), { tint: 0x6a4a32, aoWorld: groundAO(0.4) });
  b.add('woodDark', roundedBox(0.9, 0.1, 0.1, 0.03), mat(0.35, 2.22, 0), { tint: 0x6a4a32 });
  b.add('woodPaint', roundedBox(0.8, 0.5, 0.06, 0.04), mat(0.4, 1.8, 0), { tint: 0x2f5a44 });
  b.add('woodPaint', roundedBox(0.86, 0.56, 0.05, 0.04), mat(0.4, 1.8, -0.005), { tint: 0xd8b060 });
  const pot = new THREE.SphereGeometry(0.14, 12, 8);
  pot.scale(1, 0.8, 0.3);
  for (const s of [-1, 1]) {
    b.add(copperMat(), pot, mat(0.4, 1.78, s * 0.04));
    b.add(copperMat(), new THREE.TorusGeometry(0.09, 0.014, 4, 10, Math.PI), mat(0.4, 1.88, s * 0.04));
  }
  b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.24, 4), mat(0.12, 2.1, 0), { tint: 0x2e2a28 });
  b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.24, 4), mat(0.7, 2.1, 0), { tint: 0x2e2a28 });
  return b.build({ name: 'kettle-sign' });
}
