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
import { lantern, windowUnit, type BuiltProp } from '../props/structures';
import { buildTownHouse } from '../props/townkit';
import { applyWorldFx } from '../../render/worldfx';
import { textures } from '../../render/textures';

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

// ───────────────────────────────────────────── Silhouette kit (dormers, porches, lean-tos)
// buildTownHouse makes one box + gable; these break the template so no two houses share a profile.

/**
 * A gabled dormer on the front roof slope of a buildTownHouse shell (W × D, wall height wallH):
 * cheek walls in `wall` tint, a little tiled roof, a mullioned window with a lit card at dusk.
 */
function dormer(b: MeshBuilder, rng: Rng, x: number, D: number, wallH: number, wallTint: number, roofTint: number, w = 1.15): void {
  const top = 0.35 + wallH;
  const rise = Math.max(1.4, D * 0.42);
  const tanS = rise / (D / 2);
  const roofY = (z: number): number => top + rise - tanS * z + 0.1;
  const zf = D / 2 - 0.5;
  const y0 = roofY(zf) - 0.08;
  const h = Math.min(1.0, top + rise - 0.25 - y0);
  const y1 = y0 + h;
  const zb = Math.max(0.15, (top + rise + 0.1 - y1) / tanS);
  const depth = zf - zb + 0.1;
  b.add('plaster', boxUV(roundedBox(w, h, depth, 0.04), 1 / 1.8), mat(x, y0 + h / 2, zb + depth / 2 - 0.05), { tint: wallTint });
  // Roof: two tiled slabs pitched ~38°, ridge running back into the main roof.
  const a = 0.66;
  const half = w / 2 + 0.16;
  const slab = half / Math.cos(a);
  const ry = y1 + Math.tan(a) * (w / 2);
  for (const sx of [-1, 1]) {
    const g = boxUV(roundedBox(slab, 0.1, depth + 0.3, 0.04), 1 / 1.7);
    b.add('roofTile', g, mat(x + sx * (half / 2 - 0.02), ry - Math.tan(a) * (half / 2) + 0.06, zb + depth / 2 + 0.05, 0, 0, -sx * a), { tint: roofTint });
  }
  const ridge = new THREE.CylinderGeometry(0.07, 0.07, depth + 0.32, 8);
  ridge.rotateX(Math.PI / 2);
  b.add('roofTile', ridge, mat(x, ry + 0.1, zb + depth / 2 + 0.05), { tint: new THREE.Color(roofTint).multiplyScalar(0.85).getHex() });
  // Gable triangle over the window + barge board.
  const tri = new THREE.Shape();
  tri.moveTo(-w / 2, 0);
  tri.lineTo(w / 2, 0);
  tri.lineTo(0, ry - y1);
  tri.closePath();
  const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.08, bevelEnabled: false });
  b.add('plaster', tg, mat(x, y1 - 0.01, zf + 0.0), { tint: wallTint });
  const wb = new MeshBuilder();
  windowUnit(wb, w * 0.56, h * 0.58, false, false, rng);
  b.addBuilder(wb, mat(x, y0 + h * 0.5, zf + 0.07));
}

/** A lean-to porch roof on posts across the front (+Z) of a house: depth `dz`, eave at `y`. */
function porchRoof(b: MeshBuilder, x: number, fz: number, width: number, dz: number, y: number, roofTint: number, postTint = 0xf2ecde): void {
  const slope = 0.32;
  const len = dz / Math.cos(slope) + 0.2;
  b.add('roofTile', boxUV(roundedBox(width + 0.3, 0.1, len, 0.04), 1 / 1.7), mat(x, y + Math.tan(slope) * dz * 0.5 + 0.05, fz + dz / 2, slope, 0, 0), { tint: roofTint });
  b.add('woodPaint', roundedBox(width + 0.34, 0.12, 0.08, 0.03), mat(x, y - 0.02, fz + dz + 0.06), { tint: postTint });
  for (const sx of [-1, 1]) {
    const px = x + sx * (width / 2 - 0.05);
    b.add('woodPaint', roundedBox(0.13, y, 0.13, 0.03), mat(px, y / 2, fz + dz - 0.05), { tint: postTint, aoWorld: groundAO(0.4) });
    b.add('woodPaint', roundedBox(0.36, 0.08, 0.08, 0.02), mat(px - sx * 0.14, y - 0.18, fz + dz - 0.05, 0, 0, sx * 0.7), { tint: postTint });
    b.add('stone', roundedBox(0.22, 0.12, 0.22, 0.03), mat(px, 0.06, fz + dz - 0.05), { tint: 0xc9c0b0 });
  }
  // Deck boards.
  b.add('woodGrain', boxUV(roundedBox(width, 0.12, dz, 0.03), 1), mat(x, 0.08, fz + dz / 2), { tint: 0xb89068, aoWorld: groundAO(0.2) });
}

/** A climbing rose on a trellis against a wall (+Z face at fz). */
function roseTrellis(b: MeshBuilder, rng: Rng, x: number, fz: number, h = 2.1): void {
  for (const k of [-0.3, 0, 0.3]) b.add('woodPaint', roundedBox(0.035, h, 0.035, 0.01), mat(x + k, h / 2, fz + 0.06), { tint: 0xf2ecde });
  for (let i = 1; i < 5; i++) b.add('woodPaint', roundedBox(0.7, 0.035, 0.035, 0.01), mat(x, (i * h) / 5, fz + 0.07), { tint: 0xf2ecde });
  for (let i = 0; i < 14; i++) {
    const t = rng.next();
    const g = lumpySphere(0.1 + rng.next() * 0.05, 1, 0.3, rng);
    sphericalNormals(g, new THREE.Vector3(), 0.5);
    const lx = x + (rng.next() - 0.5) * (0.5 + t * 0.4);
    const ly = 0.2 + t * h;
    b.add('boxFlower', g, mat(lx, ly, fz + 0.14), { tint: i % 3 ? 0x4f8a3a : 0x63a046 });
    if (i % 2 === 0) b.add('boxFlower', new THREE.IcosahedronGeometry(0.055, 0), mat(lx + 0.04, ly + 0.05, fz + 0.24), { tint: [0xe8506a, 0xff8fab, 0xf6e2e8][i % 3]! });
  }
}

// ───────────────────────────────────────────── Flint & Ember forge

/** buildTownHouse that remembers its spec on the group (r15: winter roof snow is fitted to it). */
function specHouse(rng: Rng, spec: Parameters<typeof buildTownHouse>[1]): BuiltProp {
  const bp = buildTownHouse(rng, spec);
  bp.group.userData.houseSpec = spec;
  return bp;
}

export function buildForge(rng: Rng): BuiltProp {
  const bp = specHouse(rng, { w: 6.2, d: 5, wallH: 2.9, wall: 'stone', wallTint: 0xc4b6a4, roofTint: 0x5c6878, doorTint: 0x5a3a24, shutterTint: 0x8a4a2a, chimney: true, doorX: -1, sign: 'none' });
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
  // r15 (critic: "the forge … doesn't sell as a destination"): the west gable the bridge road sees
  // gets a smithy's face — a slate emblem board with an anvil and sparks high on the gable, a rack of
  // horseshoes and a cartwheel waiting for its tyre on the wall, iron hoops stacked on the ground; and
  // the roofline an anvil weathervane at the ridge's west end.
  {
    const gx = -3.1 - 0.06;
    const top = baseH + 2.9;
    const rise = Math.max(1.4, 5 * 0.42);
    b.add('woodDark', roundedBox(0.08, 1.0, 1.3, 0.05), mat(gx - 0.02, top + rise * 0.36, 0), { tint: 0x5a3a24 });
    b.add('woodPaint', roundedBox(0.06, 0.88, 1.18, 0.04), mat(gx - 0.05, top + rise * 0.36, 0), { tint: 0x2e3640 });
    const ey = top + rise * 0.36;
    b.add('white', roundedBox(0.03, 0.16, 0.56, 0.03), mat(gx - 0.09, ey - 0.08, 0), { tint: 0xd8d0c0 });
    b.add('white', roundedBox(0.03, 0.12, 0.24, 0.02), mat(gx - 0.09, ey - 0.24, 0), { tint: 0xd8d0c0 });
    b.add('white', roundedBox(0.03, 0.08, 0.5, 0.02), mat(gx - 0.09, ey - 0.33, 0), { tint: 0xd8d0c0 });
    const hornG = new THREE.ConeGeometry(0.07, 0.24, 8);
    hornG.rotateX(Math.PI / 2);
    b.add('white', hornG, mat(gx - 0.09, ey - 0.06, 0.38), { tint: 0xd8d0c0 });
    for (let i = 0; i < 5; i++) b.add('white', roundedBox(0.03, 0.05, 0.05, 0.02), mat(gx - 0.09, ey + 0.14 + (i % 2) * 0.1, -0.3 + i * 0.15), { tint: i % 2 ? 0xf2b43a : 0xffd07a });
    // horseshoe rack
    b.add('woodDark', roundedBox(0.08, 0.1, 1.3, 0.03), mat(gx - 0.02, 2.05, -1.2), { tint: 0x6a4a32 });
    for (let i = 0; i < 5; i++) {
      const hs = new THREE.TorusGeometry(0.1, 0.024, 5, 12, Math.PI * 1.4);
      b.add('metal', hs, mat(gx - 0.08, 1.88, -1.7 + i * 0.25, 0, Math.PI / 2, Math.PI * 0.8), { tint: 0x5a4a44 });
    }
    // cartwheel leaning on the wall
    const rim = new THREE.TorusGeometry(0.55, 0.05, 6, 22);
    b.add('woodDark', rim, mat(gx - 0.2, 0.62, 1.2, 0, Math.PI / 2, 0), { tint: 0x7a5234 });
    for (let k = 0; k < 6; k++) b.add('woodDark', roundedBox(0.04, 1.04, 0.04, 0.01), mat(gx - 0.2, 0.62, 1.2, (k / 6) * Math.PI, 0, 0), { tint: 0x7a5234 });
    b.add('woodDark', new THREE.CylinderGeometry(0.1, 0.1, 0.14, 10).rotateZ(Math.PI / 2), mat(gx - 0.2, 0.62, 1.2), { tint: 0x5a3a24 });
    // iron hoops on the ground
    for (let k = 0; k < 4; k++) b.add('metal', new THREE.TorusGeometry(0.42 - k * 0.04, 0.025, 4, 18).rotateX(Math.PI / 2), mat(gx - 0.75, 0.03 + k * 0.05, 0.1), { tint: 0x3a3436 });
    // anvil weathervane
    const vx = -3.1 + 0.3;
    const vy = top + rise + 0.2;
    b.add('metal', new THREE.CylinderGeometry(0.025, 0.03, 1.1, 6), mat(vx, vy + 0.55, 0), { tint: 0x2e2a28 });
    b.add('metal', roundedBox(0.7, 0.02, 0.02, 0.005), mat(vx, vy + 0.62, 0), { tint: 0x2e2a28 });
    b.add('metal', roundedBox(0.02, 0.02, 0.7, 0.005), mat(vx, vy + 0.62, 0), { tint: 0x2e2a28 });
    b.add('metal', roundedBox(0.04, 0.12, 0.42, 0.02), mat(vx, vy + 1.0, 0), { tint: 0x2e2a28 });
    b.add('metal', roundedBox(0.04, 0.1, 0.16, 0.02), mat(vx, vy + 0.9, 0), { tint: 0x2e2a28 });
    b.add('metal', roundedBox(0.04, 0.06, 0.34, 0.02), mat(vx, vy + 0.84, 0), { tint: 0x2e2a28 });
    const vh = new THREE.ConeGeometry(0.05, 0.2, 6);
    vh.rotateX(Math.PI / 2);
    b.add('metal', vh, mat(vx, vy + 1.02, 0.3), { tint: 0x2e2a28 });
  }
  attach(bp, b, 'forge-shed');
  bp.anchors.hearth = new THREE.Vector3(hx, 1.3, hz + 0.3);
  bp.anchors.hearthSmoke = new THREE.Vector3(hx, 5.3, hz - 0.12);
  return bp;
}

// ───────────────────────────────────────────── The Copper Kettle inn

export function buildInn(rng: Rng): BuiltProp {
  const bp = specHouse(rng, { w: 9.2, d: 6.0, wallH: 4.3, wall: 'plaster', wallTint: 0xf4dcb6, roofTint: 0x9a4a3a, doorTint: 0x6a3a22, shutterTint: 0x3f7a5a, chimney: true, flowerBoxes: true, doorX: 0, sign: 'none' });
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
  // r15 (critic: "the inn … doesn't sell as a destination"): the west gable the bridge sees carries a
  // big round copper-kettle emblem, cross-braced timbering and two wall lanterns; the ridge a little
  // copper-capped louvre cupola (a roofline no house shares).
  {
    const gx = 4.6 + 0.07;
    const top = baseH + 4.3;
    const rise = Math.max(1.4, 6 * 0.42);
    // timbering on the gable wall
    for (const z of [-2.9, 2.9]) b.add('woodDark', roundedBox(0.08, 4.3, 0.18, 0.03), mat(gx, baseH + 2.15, z), { tint: 0x5a3a24 });
    b.add('woodDark', roundedBox(0.08, 0.16, 6.0, 0.03), mat(gx, baseH + 2.2, 0), { tint: 0x5a3a24 });
    for (const sz of [-1, 1]) for (const lo of [0, 1]) b.add('woodDark', roundedBox(0.07, 2.4, 0.14, 0.02), mat(gx, baseH + (lo ? 1.1 : 3.25), sz * 1.9, sz * (lo ? 0.62 : -0.62), 0, 0), { tint: 0x5a3a24 });
    // round emblem on the gable triangle
    const ey = top + rise * 0.38;
    const disc = new THREE.CylinderGeometry(0.62, 0.62, 0.08, 24);
    disc.rotateZ(Math.PI / 2);
    b.add('woodPaint', disc, mat(gx + 0.02, ey, 0), { tint: 0xd8b060 });
    const disc2 = new THREE.CylinderGeometry(0.54, 0.54, 0.08, 24);
    disc2.rotateZ(Math.PI / 2);
    b.add('woodPaint', disc2, mat(gx + 0.05, ey, 0), { tint: 0x2f5a44 });
    const pot = new THREE.SphereGeometry(0.3, 16, 10);
    pot.scale(0.3, 0.78, 1);
    b.add(copperMat(), pot, mat(gx + 0.1, ey - 0.06, 0));
    b.add(copperMat(), new THREE.CylinderGeometry(0.04, 0.07, 0.3, 8), mat(gx + 0.1, ey - 0.02, 0.36, -1.0, 0, 0));
    b.add(copperMat(), new THREE.TorusGeometry(0.2, 0.025, 5, 14, Math.PI).rotateY(Math.PI / 2), mat(gx + 0.1, ey + 0.12, 0));
    // wall lanterns either side of the ground-floor window
    for (const z of [-1.6, 1.6]) lantern(b, gx + 0.2, 2.5, z, 0.8);
    // louvred cupola on the ridge
    const cy = top + rise;
    b.add('woodPaint', roundedBox(0.9, 0.7, 0.9, 0.04), mat(1.2, cy + 0.3, 0), { tint: 0xf3ead8 });
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) b.add('woodDark', roundedBox(0.04, 0.06, 0.7, 0.01), mat(1.2 + sx * 0.46, cy + 0.15 + k * 0.17, 0, 0, 0, sx * 0.4), { tint: 0x6a4a32 });
    const cap = new THREE.ConeGeometry(0.75, 0.6, 4);
    cap.rotateY(Math.PI / 4);
    b.add(copperMat(), cap, mat(1.2, cy + 0.95, 0));
    b.add('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), mat(1.2, cy + 1.45, 0), { tint: 0x2e2a28 });
    b.add(copperMat(), new THREE.SphereGeometry(0.07, 10, 8), mat(1.2, cy + 1.3, 0));
  }
  attach(bp, b, 'inn-porch');
  const l = new THREE.PointLight(0xffb45e, 0, 8, 1.8);
  l.position.set(0, 2.3, fz + 1.9);
  bp.group.add(l);
  // (kept soft: a hotter porch lamp blew the door + wall out into a bloom glare behind close shots)
  bp.lights.push({ light: l, max: 4.5 });
  bp.anchors.door = new THREE.Vector3(0, 0, fz + 2.2);
  return bp;
}

// ───────────────────────────────────────────── Willowmere Clinic

export function buildClinic(rng: Rng): BuiltProp {
  const bp = specHouse(rng, { w: 7.2, d: 5.0, wallH: 3.1, wall: 'plaster', wallTint: 0xf4f4ec, roofTint: 0x4a8a7e, doorTint: 0x3a7a8a, shutterTint: 0x4a8a7e, chimney: true, flowerBoxes: false, doorX: 0, sign: 'none' });
  const b = new MeshBuilder();
  const fz = 2.5;
  // A pedimented entry porch on white columns + two dormers + climbing roses: a doctor's house,
  // not another shop front.
  porchRoof(b, 0, fz, 1.9, 1.15, 2.55, 0x4a8a7e);
  for (const dx of [-2.2, 2.2]) dormer(b, rng, dx, 5.0, 3.1, 0xf4f4ec, 0x4a8a7e);
  for (const sx of [-1, 1]) roseTrellis(b, rng, sx * 1.55, fz, 2.3);
  // Round teal sign above the door: a white leaf cradled by a heart (the clinic's emblem).
  b.add('woodPaint', bevelCylinder(0.46, 0.46, 0.08, 0.03, 24).rotateX(Math.PI / 2), mat(0, 3.32, fz + 0.1), { tint: 0x2f7a74 });
  b.add('woodPaint', new THREE.TorusGeometry(0.46, 0.04, 6, 28), mat(0, 3.32, fz + 0.15), { tint: 0xf2e2b8 });
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.22);
  heart.bezierCurveTo(-0.3, 0.02, -0.18, 0.26, 0, 0.1);
  heart.bezierCurveTo(0.18, 0.26, 0.3, 0.02, 0, -0.22);
  b.add('white', new THREE.ExtrudeGeometry(heart, { depth: 0.03, bevelEnabled: false }), mat(0, 3.32, fz + 0.15), { tint: 0xfaf6ee });
  const leaf = new THREE.SphereGeometry(0.09, 10, 6);
  leaf.scale(0.5, 1.2, 0.3);
  b.add('white', leaf, mat(0.02, 3.36, fz + 0.2, 0, 0, -0.5), { tint: 0x5aa86a });
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
  const bp = specHouse(rng, { w: 4.8, d: 4.0, wallH: 2.5, wall: 'stone', wallTint: 0xdccfb8, roofTint: 0xcaa262, roof: 'thatch', doorTint: 0x5a7a4a, shutterTint: 0x5a7a4a, chimney: true, flowerBoxes: true, doorX: 0 });
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
  const bp = specHouse(rng, { w: 6.0, d: 4.6, wallH: 2.8, wall: 'wood', wallTint: 0xe6cca4, roofTint: 0x6a8e5a, doorTint: 0xb8573e, shutterTint: 0xb8573e, chimney: true, flowerBoxes: false, doorX: -1 });
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
  return specHouse(rng, { w: 5.2, d: 4.2, wallH: 2.7, wall: 'plaster', wallTint: 0xf0e0f0, roofTint: 0x7a6aa8, doorTint: 0xd89a3a, shutterTint: 0x7a6aa8, chimney: true, flowerBoxes: true, doorX: 0 });
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
  // (r9, pillar 14: one bevel segment on the 80 deck / parapet / coping blocks and the voussoirs —
  // the bridge was the town's heaviest prop, 65k triangles with its shadow)
  const N = 16;
  const seg = L / N;
  for (let i = 0; i < N; i++) {
    const x = -L / 2 + (i + 0.5) * seg;
    const y0 = deckY(br, x - seg / 2);
    const y1 = deckY(br, x + seg / 2);
    const ang = Math.atan2(y1 - y0, seg);
    const y = (y0 + y1) / 2;
    // Deck body (thick so the arch reads from the side).
    b.add('stone', boxUV(roundedBox(seg + 0.06, 0.34, W, 0.03, 1), 0.6), mat(x, y - 0.17, 0, 0, 0, ang), { tint: i % 2 ? 0xc8beb0 : 0xbeb4a4 });
    // Parapets: low walls with coping stones.
    for (const s of [-1, 1]) {
      b.add('stone', boxUV(roundedBox(seg + 0.04, 0.5, 0.3, 0.05, 1), 0.7), mat(x, y + 0.25, s * (W / 2 - 0.1), 0, 0, ang), { tint: (i + (s > 0 ? 1 : 0)) % 3 ? 0xcfc6b8 : 0xc2b8a8 });
      b.add('stone', roundedBox(seg + 0.08, 0.1, 0.38, 0.04, 1), mat(x, y + 0.54, s * (W / 2 - 0.1), 0, 0, ang), { tint: 0xe0d8ca });
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
      b.add('stone', roundedBox(0.42, 0.36, 0.14, 0.04, 1), mat(x, y, s * (W / 2 + 0.01), 0, 0, a - Math.PI / 2), { tint: k % 2 ? 0xb8ae9e : 0xc8beae });
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
  // (r16 critic: "a stray red octagonal prism lies on the cobbles and reads as a debug primitive" —
  // the end-post flower pots sat on the bridge's axis at z = 0, floating 1 m over the deck between the
  // two newels; the newels already carry their stone balls, so the pots are gone)
  // Planter boxes along the coping (geraniums + trailing ivy over the outer face) and moss in the
  // joints: the deck and parapets read as a lived-in town bridge, not a plain cobble ramp.
  const petals = [0xe8574a, 0xff8fab, 0xfff2f6, 0xffd166];
  for (const s of [-1, 1])
    for (const fx of [-0.27, 0.27]) {
      const x = fx * L + (s > 0 ? 0.35 : -0.2);
      const y = deckY(br, x) + 0.6;
      const ang = Math.atan2(deckY(br, x + 0.4) - deckY(br, x - 0.4), 0.8);
      const z = s * (W / 2 - 0.1);
      b.add('woodPaint', roundedBox(0.95, 0.2, 0.26, 0.03), mat(x, y + 0.1, z, 0, 0, ang), { tint: 0x5f8f86 });
      for (let i = 0; i < 6; i++) {
        const px = x - 0.36 + i * 0.145;
        const py = deckY(br, px) + 0.86 + (rng.next() - 0.5) * 0.04;
        b.add('boxFlower', lumpySphere(0.1, 1, 0.25, rng), mat(px, py, z + (rng.next() - 0.5) * 0.06), { tint: 0x4f9a3a });
        b.add('white', new THREE.SphereGeometry(0.05, 6, 5), mat(px + 0.02, py + 0.08, z + s * 0.04), { tint: petals[(i + (s > 0 ? 1 : 0)) % petals.length]!, keep: true });
      }
      for (let i = 0; i < 7; i++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.06, 0), mat(x - 0.4 + i * 0.13, y - 0.12 - rng.next() * 0.35, z + s * 0.2), { tint: i % 2 ? 0x3f7a2e : 0x4f8a34 });
    }
  for (let i = 0; i < 12; i++) {
    const x = (rng.next() - 0.5) * (L - 1.2);
    const s = rng.next() < 0.5 ? -1 : 1;
    const m = lumpySphere(0.07 + rng.next() * 0.05, 0, 0.35, rng);
    m.scale(1.6, 0.35, 1);
    b.add('boxFlower', m, mat(x, deckY(br, x) + 0.6, s * (W / 2 - 0.1 + (rng.next() - 0.5) * 0.2)), { tint: rng.next() < 0.5 ? 0x5a7a34 : 0x7a8a44 });
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
  // r17 (critic: "the stall canopy is blown out in town-day"): a sunlit near-white canvas top clipped
  // to paper white under the high sun — the light stripe is a sun-faded linen, a step down in value.
  const canopy = stripes.map((c) => {
    const col = new THREE.Color(c);
    const hsl = { h: 0, s: 0, l: 0 };
    col.getHSL(hsl);
    // (r19: still clipped facing the high sun at 0.84 — a warm unbleached linen, a further step down)
    return hsl.l > 0.82 ? col.lerp(new THREE.Color(0xd9ccb2), 0.5).multiplyScalar(0.8).getHex() : c;
  });
  for (let i = 0; i < n; i++) {
    const x = -W / 2 - 0.15 + (i + 0.5) * ((W + 0.3) / n);
    b.add('cloth', roundedBox((W + 0.3) / n + 0.01, 0.04, 1.4, 0.015), mat(x, 2.36, 0.05, 0.22, 0, 0), { tint: canopy[i % 2]! });
    const sc = new THREE.CylinderGeometry((W + 0.3) / n / 2, (W + 0.3) / n / 2, 0.035, 10, 1, false, 0, Math.PI);
    sc.rotateX(Math.PI / 2);
    b.add('cloth', sc, mat(x, 2.15, 0.74, 0, 0, Math.PI), { tint: canopy[i % 2]! });
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
      // Galvanised florist's buckets (painted 'white' kit, not the dark metal shader: they read black in shade).
      b.add('white', bevelCylinder(0.17, 0.13, 0.3, 0.02, 12), mat(cx, top, 0.05), { tint: [0xb8c4c8, 0xc8704a, 0xa8b8bc, 0xe8d8b8, 0xb0bcc0][c]! });
      b.add('white', new THREE.TorusGeometry(0.168, 0.012, 4, 16), mat(cx, top + 0.29, 0.05, Math.PI / 2, 0, 0), { tint: 0x8a989c });
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

/**
 * Restoration scaffold for a Lantern Hall window: two timber bays (poles, ledgers, X braces), plank
 * decks at two lifts, a lashed ladder, a canvas tarp half-drawn over the boarded window, paint pots,
 * a bucket of tools and a hand-lettered "Friends of the Hall" board. Built facing +Z, ~2.6 m wide.
 */
export function buildScaffold(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const W = 2.7;
  const H = 3.9;
  const zf = 0.42;
  const zb = -0.42;
  const pole = 0xb8946a;
  for (const x of [-W / 2, 0, W / 2])
    for (const z of [zf, zb]) b.add('woodGrain', new THREE.CylinderGeometry(0.05, 0.055, H, 7), mat(x + (rng.next() - 0.5) * 0.04, H / 2, z), { tint: pole });
  for (const y of [1.55, 3.0]) {
    // Ledgers + a plank deck at each lift.
    for (const z of [zf, zb]) b.add('woodGrain', roundedBox(W + 0.2, 0.08, 0.08, 0.02), mat(0, y, z), { tint: 0xa88050 });
    for (let i = 0; i < 4; i++) b.add('woodGrain', roundedBox(W + 0.1, 0.05, 0.2, 0.015), mat((rng.next() - 0.5) * 0.06, y + 0.07, zb + 0.12 + i * 0.205, 0, (rng.next() - 0.5) * 0.03, 0), { tint: i % 2 ? 0xe2c28e : 0xd8b07a });
    // Toe guard rail on the front.
    b.add('woodGrain', roundedBox(W + 0.1, 0.06, 0.05, 0.015), mat(0, y + 0.9, zf + 0.02), { tint: 0xa88050 });
  }
  // X braces on the front bays.
  for (const sx of [-1, 1]) {
    const len = Math.hypot(W / 2, 1.45);
    b.add('woodDark', roundedBox(0.05, len, 0.04, 0.01), mat(sx * W / 4, 0.8, zf + 0.06, 0, 0, sx * Math.atan2(W / 2, 1.45)), { tint: 0x8a6a42 });
  }
  // Ladder leaning on the east bay.
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.05, 3.2, 0.05, 0.015), mat(W / 2 + 0.28 + sx * 0.2, 1.55, zf + 0.42, -0.2, 0, 0), { tint: 0xc8a070 });
  for (let i = 0; i < 9; i++) b.add('woodGrain', roundedBox(0.42, 0.04, 0.04, 0.01), mat(W / 2 + 0.28, 0.2 + i * 0.34, zf + 0.42 + 0.075 - i * 0.068, -0.2, 0, 0), { tint: 0xb89060 });
  // Tarp: a canvas sheet hung from the top rail, swagged over half the window (sags in the middle).
  const tarp = new THREE.PlaneGeometry(1.4, 1.5, 6, 6);
  const tp = tarp.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i);
    const y = tp.getY(i);
    tp.setZ(i, Math.sin((x + 0.7) * 6) * 0.03 + (0.75 - y) * 0.03);
    tp.setY(i, y - Math.cos(x * 2.1) * 0.06 * (0.75 - y));
  }
  tarp.computeVertexNormals();
  b.add('cloth', tarp, mat(-0.55, 2.3, zb - 0.06), { tint: 0xe8dcc0 });
  b.add('cloth', new THREE.CylinderGeometry(0.06, 0.06, 1.45, 8).rotateZ(Math.PI / 2), mat(-0.55, 3.05, zb - 0.04), { tint: 0xd8c8a4 });
  // Paint pots and a tool bucket on the lower deck / ground.
  const pots = [0x2f6a5a, 0xc8a04a, 0xf2ece0];
  pots.forEach((c, i) => {
    b.add('metal', new THREE.CylinderGeometry(0.11, 0.1, 0.18, 10), mat(-0.9 + i * 0.32, 1.72, 0.05 + (i % 2) * 0.12), { tint: 0x9aa0a8 });
    b.add('white', new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10), mat(-0.9 + i * 0.32, 1.82, 0.05 + (i % 2) * 0.12), { tint: c });
  });
  b.add('metal', new THREE.CylinderGeometry(0.17, 0.14, 0.3, 10), mat(0.55, 0.15, zf + 0.35), { tint: 0x8a9098 });
  for (let i = 0; i < 3; i++) b.add('woodGrain', new THREE.CylinderGeometry(0.018, 0.018, 0.5, 5), mat(0.5 + i * 0.05, 0.4, zf + 0.33, 0.2 - i * 0.15, 0, 0.25 - i * 0.2), { tint: 0xb89060 });
  // "Friends of the Hall" board lashed to the front rail: a painted slate with a little lantern.
  b.add('woodDark', roundedBox(1.1, 0.42, 0.05, 0.03), mat(-0.15, 2.35, zf + 0.08), { tint: 0x6a4a2e });
  b.add('woodPaint', roundedBox(1.0, 0.32, 0.03, 0.02), mat(-0.15, 2.35, zf + 0.11), { tint: 0x2f5a4a });
  b.add('metal', new THREE.CylinderGeometry(0.045, 0.06, 0.12, 6).rotateX(Math.PI / 2), mat(-0.55, 2.35, zf + 0.14), { tint: 0xe8b84a });
  for (let i = 0; i < 3; i++) b.add('white', roundedBox(0.5 - i * 0.12, 0.03, 0.01, 0.005), mat(0.0, 2.43 - i * 0.07, zf + 0.13), { tint: 0xf2ead2 });
  // Climbing ivy trained up the west poles (green life, not ruin).
  for (let i = 0; i < 9; i++) {
    const leaf = lumpySphere(0.13, 0, 0.25, rng);
    b.add('boxFlower', leaf, mat(-W / 2 + (rng.next() - 0.5) * 0.18, 0.2 + i * 0.32, zf + 0.04, 0, 0, rng.next() * 3), { tint: i % 2 ? 0x3f7a2e : 0x5a9a3a });
  }
  return b.build({ name: 'scaffold' });
}

/**
 * "Relight the Hall" banner for the Hall's east window (r7 blind judge: the boarded window's red X of
 * planks read as a placeholder / error marker): a painted canvas banner on a rod hung from two iron
 * brackets, a glowing lantern and hand lettering, tassels at the foot. Faces +Z, ~1.6 m wide.
 */
export function buildHallBanner(): THREE.Group {
  const b = new MeshBuilder();
  const W = 1.62;
  const top = 3.42;
  const H = 2.05;
  // Rod + finials + wall brackets.
  b.add('woodGrain', new THREE.CylinderGeometry(0.035, 0.035, W + 0.3, 8).rotateZ(Math.PI / 2), mat(0, top, 0.12), { tint: 0x7a5232 });
  for (const sx of [-1, 1]) {
    b.add('metal', new THREE.SphereGeometry(0.06, 8, 6), mat(sx * (W / 2 + 0.17), top, 0.12), { tint: 0xd8a84a });
    b.add('metal', roundedBox(0.04, 0.04, 0.2, 0.01), mat(sx * (W / 2 - 0.05), top + 0.04, 0.04), { tint: 0x3a3a3e });
  }
  // Tassels at the two lower corners.
  for (const sx of [-1, 1]) {
    b.add('cloth', new THREE.ConeGeometry(0.045, 0.2, 6), mat(sx * (W / 2 - 0.05), top - H - 0.14, 0.15, Math.PI, 0, 0), { tint: 0xd8a84a });
    b.add('cloth', new THREE.SphereGeometry(0.035, 6, 5), mat(sx * (W / 2 - 0.05), top - H - 0.03, 0.15), { tint: 0xc8412f });
  }
  const g = b.build({ name: 'hall-banner' });
  // The banner itself: a gently swagged canvas with its own painted texture.
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 0, 320);
  gr.addColorStop(0, '#2f5a4a');
  gr.addColorStop(1, '#244a3c');
  x.fillStyle = gr;
  x.fillRect(0, 0, 256, 320);
  x.strokeStyle = '#e8c86a';
  x.lineWidth = 6;
  x.strokeRect(12, 12, 232, 270);
  // Swallowtail foot.
  x.fillStyle = 'rgba(0,0,0,0)';
  x.clearRect(0, 290, 256, 30);
  x.fillStyle = '#244a3c';
  x.beginPath();
  x.moveTo(0, 288);
  x.lineTo(256, 288);
  x.lineTo(256, 320);
  x.lineTo(128, 296);
  x.lineTo(0, 320);
  x.closePath();
  x.fill();
  // Lantern with a warm glow.
  const glow = x.createRadialGradient(128, 112, 6, 128, 112, 70);
  glow.addColorStop(0, 'rgba(255,214,120,0.95)');
  glow.addColorStop(1, 'rgba(255,214,120,0)');
  x.fillStyle = glow;
  x.fillRect(40, 30, 176, 170);
  x.fillStyle = '#3a2a1e';
  x.fillRect(118, 52, 20, 10);
  x.beginPath();
  x.moveTo(98, 70);
  x.lineTo(158, 70);
  x.lineTo(150, 150);
  x.lineTo(106, 150);
  x.closePath();
  x.fill();
  x.fillStyle = '#ffd86a';
  x.beginPath();
  x.moveTo(106, 78);
  x.lineTo(150, 78);
  x.lineTo(144, 142);
  x.lineTo(112, 142);
  x.closePath();
  x.fill();
  x.fillStyle = '#ff9a3a';
  x.beginPath();
  x.ellipse(128, 116, 8, 16, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#f6ecd2';
  x.textAlign = 'center';
  x.font = '700 38px Fredoka, Nunito, sans-serif';
  x.fillText('RELIGHT', 128, 202);
  x.fillText('THE HALL', 128, 242);
  x.font = '700 18px Nunito, sans-serif';
  x.fillStyle = '#e8c86a';
  x.fillText('♥ friends of the hall ♥', 128, 272);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const geo = new THREE.PlaneGeometry(W, H, 6, 8);
  const pa = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    const px = pa.getX(i);
    const py = pa.getY(i);
    // A soft belly in the cloth and a ripple across it.
    pa.setZ(i, 0.05 * (1 - (2 * px / W) ** 2) * (0.5 - py / H) + Math.sin(px * 7 + py * 2) * 0.012);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, applyWorldFx(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide })));
  m.position.set(0, top - H / 2 - 0.02, 0.15);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return g;
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

// ───────────────────────────────────────────── Meadow Lane: schoolhouse + south cottage

/**
 * Hearthvale schoolhouse: a red-painted board school with a white bell cupola on the ridge,
 * a slate chalkboard by the door, a row of coat pegs and a bench of lunch pails.
 */
export function buildSchoolhouse(rng: Rng): BuiltProp {
  const W = 6.4;
  const D = 4.6;
  const wallH = 2.9;
  const bp = specHouse(rng, { w: W, d: D, wallH, wall: 'wood', wallTint: 0xc8604a, roofTint: 0x5a6470, trimTint: 0xf6efe2, doorTint: 0x2f5a6a, shutterTint: 0xf2ead8, chimney: false, flowerBoxes: true, doorX: 0, sign: 'none' });
  const b = new MeshBuilder();
  const fz = D / 2;
  const top = 0.35 + wallH;
  const ridge = top + D * 0.42;
  // Bell cupola: square white tower on the ridge, open arches, a brass bell, a little pyramid roof.
  const cx = 0;
  const cy = ridge - 0.2;
  b.add('woodPaint', boxUV(roundedBox(1.0, 0.7, 1.0, 0.05), 1), mat(cx, cy + 0.35, 0), { tint: 0xf4efe4 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.add('woodPaint', roundedBox(0.14, 0.72, 0.14, 0.03), mat(cx + sx * 0.4, cy + 1.05, sz * 0.4), { tint: 0xf8f4ea });
  b.add('woodPaint', roundedBox(1.08, 0.1, 1.08, 0.03), mat(cx, cy + 0.72, 0), { tint: 0xe8e0d0 });
  b.add('woodPaint', roundedBox(1.12, 0.1, 1.12, 0.03), mat(cx, cy + 1.42, 0), { tint: 0xe8e0d0 });
  const pyr = new THREE.ConeGeometry(0.86, 0.8, 4);
  pyr.rotateY(Math.PI / 4);
  b.add('roofTile', pyr, mat(cx, cy + 1.86, 0), { tint: 0x5a6470 });
  b.add('metal', new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), mat(cx, cy + 2.45, 0), { tint: 0x3a3430 });
  b.add('metal', new THREE.SphereGeometry(0.05, 8, 6), mat(cx, cy + 2.72, 0), { tint: 0xd8b048 });
  const bell = new THREE.LatheGeometry([new THREE.Vector2(0.02, 0.28), new THREE.Vector2(0.12, 0.26), new THREE.Vector2(0.16, 0.12), new THREE.Vector2(0.24, 0.0), new THREE.Vector2(0.22, -0.02)], 14);
  b.add(brassMat(), bell, mat(cx, cy + 0.84, 0));
  b.add('metal', new THREE.SphereGeometry(0.04, 6, 5), mat(cx, cy + 0.82, 0), { tint: 0x3a3430 });
  // Chalkboard easel by the door ("Lessons 8–11") + coat pegs with two satchels.
  b.add('woodDark', roundedBox(0.9, 1.1, 0.06, 0.03), mat(1.75, 0.95, fz + 0.62, -0.16, -0.2, 0), { tint: 0x6a4a32 });
  b.add('woodPaint', roundedBox(0.78, 0.96, 0.03, 0.02), mat(1.75, 0.96, fz + 0.66, -0.16, -0.2, 0), { tint: 0x2f4a3e });
  for (let i = 0; i < 3; i++) b.add('white', roundedBox(0.44 - i * 0.1, 0.035, 0.01, 0.008, 1), mat(1.72 + i * 0.02, 1.2 - i * 0.18, fz + 0.69 - i * 0.03, -0.16, -0.2, 0), { tint: 0xf2efe6 });
  for (const s of [-1, 1]) b.add('woodDark', roundedBox(0.05, 1.3, 0.05, 0.02), mat(1.75 + s * 0.38, 0.62, fz + 0.5 + s * 0.08, 0.18, -0.2, 0), { tint: 0x5a3a24 });
  b.add('woodDark', roundedBox(1.4, 0.08, 0.06, 0.02), mat(-1.6, 1.62, fz + 0.06), { tint: 0x6a4a32 });
  for (let i = 0; i < 4; i++) b.add('metal', new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), mat(-2.15 + i * 0.36, 1.58, fz + 0.12, Math.PI / 2, 0, 0), { tint: 0x3a3430 });
  const bagC = [0xd8573e, 0x3f7fb0];
  bagC.forEach((c, i) => {
    b.add('cloth', roundedBox(0.26, 0.3, 0.1, 0.05), mat(-2.15 + i * 0.72, 1.36, fz + 0.14), { tint: c });
    b.add('cloth', roundedBox(0.27, 0.1, 0.11, 0.04), mat(-2.15 + i * 0.72, 1.46, fz + 0.15), { tint: new THREE.Color(c).multiplyScalar(0.8).getHex() });
  });
  // Bench with lunch pails under the pegs.
  b.add('woodGrain', roundedBox(1.5, 0.07, 0.34, 0.03), mat(-1.6, 0.44, fz + 0.36), { tint: 0xa87a50 });
  for (const sx of [-1, 1]) b.add('woodDark', roundedBox(0.07, 0.44, 0.3, 0.02), mat(-1.6 + sx * 0.64, 0.22, fz + 0.36));
  for (let i = 0; i < 3; i++) {
    b.add('metal', bevelCylinder(0.09, 0.08, 0.16, 0.015, 10), mat(-2.0 + i * 0.36, 0.48, fz + 0.36), { tint: [0x9ab0c0, 0xc8a050, 0x8ab08a][i]! });
    b.add('metal', new THREE.TorusGeometry(0.07, 0.008, 4, 10, Math.PI), mat(-2.0 + i * 0.36, 0.64, fz + 0.36), { tint: 0x5a5a5a });
  }
  // A lean-to woodshed on the west gable: split logs stacked under a slate skillion.
  {
    const sx0 = -W / 2 - 0.05;
    const sw = 1.3;
    const cxs = sx0 - sw / 2;
    b.add('woodGrain', boxUV(roundedBox(sw, 0.1, D * 0.7, 0.03), 1), mat(cxs, 0.05, -0.2), { tint: 0x8a6a4a });
    const sl = 0.42;
    b.add('roofTile', boxUV(roundedBox(sw / Math.cos(sl) + 0.3, 0.09, D * 0.78, 0.03), 1 / 1.7), mat(cxs - 0.05, 2.05 + Math.tan(sl) * sw * 0.5 - 0.3, -0.2, 0, 0, sl), { tint: 0x5a6470 });
    for (const sz of [-1, 1]) b.add('woodDark', roundedBox(0.1, 1.85, 0.1, 0.02), mat(sx0 - sw + 0.08, 0.92, -0.2 + sz * D * 0.33), { tint: 0x6a4a32 });
    // Two stacks of split logs, end grain to the lane (axis along z).
    for (const zc of [-0.75, 0.45])
      for (let row = 0; row < 5; row++)
        for (let i = 0; i < 5 - (row === 4 ? 1 : 0); i++) {
          const log = new THREE.CylinderGeometry(0.1, 0.11, 0.9, 7);
          log.rotateX(Math.PI / 2);
          b.add('woodGrain', log, mat(cxs + (i - 2) * 0.22 + (row % 2) * 0.11, 0.21 + row * 0.19, zc + (rng.next() - 0.5) * 0.08, 0, 0, rng.next() * 3), { tint: (i + row) % 3 ? 0xb88a5a : 0x9a6a3e });
        }
  }
  attach(bp, b, 'school-extras');
  bp.anchors.bell = new THREE.Vector3(cx, cy + 0.9, 0);
  return bp;
}

let brass: THREE.MeshStandardMaterial | null = null;
function brassMat(): THREE.MeshStandardMaterial {
  if (!brass) {
    brass = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xe0b050, roughness: 0.3, metalness: 0.8 });
    brass.name = 'brass';
    applyWorldFx(brass);
  }
  return brass;
}

/** The Pennywhistle cottage on Meadow Lane: sage plaster, a porch with two chairs and a rain barrel. */
export function buildSouthCottage(rng: Rng): BuiltProp {
  const bp = specHouse(rng, { w: 5.4, d: 4.4, wallH: 2.7, wall: 'plaster', wallTint: 0xdce8d0, roofTint: 0xb8674a, doorTint: 0xe0a83a, shutterTint: 0x5a7a8a, chimney: true, flowerBoxes: true, doorX: -1 });
  const b = new MeshBuilder();
  const fz = 2.2;
  // A deep veranda over the chairs and a single dormer: a farmhouse profile, not the shop box.
  porchRoof(b, 1.45, fz, 2.5, 1.25, 2.35, 0xb8674a, 0xf2ecde);
  dormer(b, rng, 1.2, 4.4, 2.7, 0xdce8d0, 0xb8674a, 1.05);
  roseTrellis(b, rng, -2.4, fz, 2.0);
  // Porch chairs + side table with a teapot.
  for (const sx of [0.9, 2.0]) {
    b.add('woodPaint', roundedBox(0.5, 0.06, 0.46, 0.02), mat(sx, 0.46, fz + 0.5), { tint: 0xf2ecde });
    b.add('woodPaint', roundedBox(0.5, 0.6, 0.06, 0.02), mat(sx, 0.78, fz + 0.28, -0.12, 0, 0), { tint: 0xf2ecde });
    for (const [lx, lz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]] as const) b.add('woodPaint', roundedBox(0.05, 0.46, 0.05, 0.015), mat(sx + lx, 0.23, fz + 0.5 + lz), { tint: 0xe8e0d0 });
  }
  b.add('woodGrain', bevelCylinder(0.22, 0.22, 0.05, 0.015, 12), mat(1.45, 0.5, fz + 0.62), { tint: 0xb88a5a });
  b.add('woodDark', new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), mat(1.45, 0.25, fz + 0.62), { tint: 0x6a4a32 });
  b.add('white', new THREE.SphereGeometry(0.09, 10, 8), mat(1.45, 0.6, fz + 0.62, 0, 0, 0, 1, 0.8, 1), { tint: 0x4a8ab0 });
  // Rain barrel under the downpipe.
  b.add('woodGrain', bevelCylinder(0.3, 0.27, 0.8, 0.04, 14), mat(-2.9, 0, fz - 0.4), { tint: 0x9a6a3a, aoWorld: groundAO(0.4) });
  for (const y of [0.18, 0.62]) b.add('metal', new THREE.TorusGeometry(0.3, 0.02, 4, 16), mat(-2.9, y, fz - 0.4, Math.PI / 2, 0, 0), { tint: 0x4a4a4a });
  attach(bp, b, 'southcottage-extras');
  return bp;
}

/** Raised vegetable bed: plank frame, dark soil, rows of cabbages / lettuces / carrot tops. */
export function buildVegBed(rng: Rng, len = 2.6): THREE.Group {
  const b = new MeshBuilder();
  const w = 1.0;
  for (const sz of [-1, 1]) b.add('woodGrain', boxUV(roundedBox(len, 0.3, 0.08, 0.02, 1), 1), mat(0, 0.15, sz * (w / 2)), { tint: 0xb08a5a, aoWorld: groundAO(0.25) });
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.08, 0.3, w, 0.02, 1), mat(sx * (len / 2), 0.15, 0), { tint: 0xa07a4a, aoWorld: groundAO(0.25) });
  b.add('soilPot', roundedBox(len - 0.1, 0.06, w - 0.1, 0.02, 1), mat(0, 0.26, 0), { tint: 0x5a3e2a });
  const kinds = [0x7ab05a, 0x9ac86a, 0x5a8a4a];
  for (let r = 0; r < 2; r++) {
    const kind = Math.floor(rng.next() * 3);
    for (let x = -len / 2 + 0.3; x < len / 2 - 0.15; x += 0.42) {
      const z = (r - 0.5) * 0.44;
      if (kind === 2) {
        for (let k = 0; k < 3; k++) b.add('boxFlower', new THREE.ConeGeometry(0.03, 0.26, 4), mat(x + (k - 1) * 0.05, 0.4, z, (k - 1) * 0.3, 0, 0), { tint: 0x6ab04a });
      } else {
        const g = lumpySphere(kind === 0 ? 0.15 : 0.12, 1, 0.25, rng);
        sphericalNormals(g, new THREE.Vector3(), 0.5);
        b.add('boxFlower', g, mat(x, 0.36, z, 0, 0, 0, 1, 0.75, 1), { tint: kinds[kind]! });
      }
    }
  }
  return b.build({ name: 'vegbed' });
}

/** A bicycle with a wicker basket of flowers, leaning on its kickstand (street clutter). */
export function buildBicycle(rng: Rng, frame = 0x3f7fa8): THREE.Group {
  const b = new MeshBuilder();
  const tilt = 0.14;
  const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 => new THREE.Matrix4().makeRotationZ(tilt).multiply(mat(x, y, z, rx, ry, rz));
  for (const sx of [-1, 1]) {
    b.add('metal', new THREE.TorusGeometry(0.3, 0.028, 6, 22), T(sx * 0.52, 0.32, 0, 0, Math.PI / 2, 0), { tint: 0x2a2a2e });
    b.add('metal', new THREE.TorusGeometry(0.26, 0.008, 3, 18), T(sx * 0.52, 0.32, 0, 0, Math.PI / 2, 0), { tint: 0xc8c8cc });
    b.add('metal', new THREE.CylinderGeometry(0.035, 0.035, 0.06, 8).rotateX(Math.PI / 2), T(sx * 0.52, 0.32, 0), { tint: 0x9a9aa0 });
  }
  const tube = (x0: number, y0: number, x1: number, y1: number, r = 0.022): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    b.add('woodPaint', new THREE.CylinderGeometry(r, r, len, 6), T((x0 + x1) / 2, (y0 + y1) / 2, 0, 0, 0, Math.atan2(x0 - x1, y1 - y0)), { tint: frame });
  };
  tube(-0.52, 0.32, -0.08, 0.34);
  tube(-0.08, 0.34, 0.36, 0.62);
  tube(-0.52, 0.32, -0.16, 0.66);
  tube(-0.16, 0.66, 0.36, 0.62);
  tube(-0.08, 0.34, -0.18, 0.72);
  tube(0.52, 0.32, 0.4, 0.8);
  b.add('woodGrain', roundedBox(0.2, 0.05, 0.1, 0.02), T(-0.19, 0.76, 0), { tint: 0x5a3a24 });
  b.add('metal', new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6).rotateX(Math.PI / 2), T(0.4, 0.82, 0), { tint: 0x9a9aa0 });
  // Wicker basket with a posy.
  b.add('woodGrain', bevelCylinder(0.14, 0.12, 0.16, 0.02, 10), T(0.58, 0.74, 0), { tint: 0xc89a5a });
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * Math.PI * 2;
    b.add('white', new THREE.SphereGeometry(0.045, 6, 5), T(0.58 + Math.cos(a) * 0.06, 0.84 + rng.next() * 0.04, Math.sin(a) * 0.06), { tint: [0xff8fab, 0xffd166, 0xffffff, 0xc77dff][i % 4]! });
  }
  return b.build({ name: 'bicycle' });
}

/** A low stone-edged flower bed curving round part of the fountain (annulus sector). */
export function buildFlowerRing(rng: Rng, r0: number, r1: number, a0: number, a1: number): THREE.Group {
  const b = new MeshBuilder();
  const seg = Math.max(6, Math.round(((a1 - a0) * (r0 + r1)) / 0.6));
  const kerb = new THREE.RingGeometry(r1 - 0.14, r1, seg, 1, a0, a1 - a0).rotateX(-Math.PI / 2);
  b.add('stone', kerb, mat(0, 0.16, 0), { tint: 0xc8bca8 });
  const kerbIn = new THREE.RingGeometry(r0, r0 + 0.12, seg, 1, a0, a1 - a0).rotateX(-Math.PI / 2);
  b.add('stone', kerbIn, mat(0, 0.14, 0), { tint: 0xbcb09c });
  const soil = new THREE.RingGeometry(r0 + 0.1, r1 - 0.12, seg, 1, a0, a1 - a0).rotateX(-Math.PI / 2);
  b.add('white', soil, mat(0, 0.1, 0), { tint: 0x6a4a32 });
  const cols = [0xff8fab, 0xffd166, 0xffffff, 0xc77dff, 0xff7a5a];
  const n = Math.round(seg * 2.4);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * (a1 - a0) + (rng.next() - 0.5) * 0.05;
    const r = r0 + 0.2 + rng.next() * (r1 - r0 - 0.4);
    const x = Math.cos(a) * r;
    const z = -Math.sin(a) * r;
    const bush = lumpySphere(0.12 + rng.next() * 0.05, 0, 0.25, rng);
    b.add('white', bush, mat(x, 0.2, z), { tint: 0x5f9a4a, keep: true });
    b.add('white', new THREE.SphereGeometry(0.05, 5, 4), mat(x + (rng.next() - 0.5) * 0.08, 0.31, z + (rng.next() - 0.5) * 0.08), { tint: cols[i % cols.length]!, keep: true });
  }
  return b.build({ name: 'flower-ring' });
}


/** A picnic on the lawn: a gingham blanket (rumpled), a wicker basket with a loaf, a jug and two cups. */
export function buildPicnic(rng: Rng, cloth = 0xd8573e): THREE.Group {
  const b = new MeshBuilder();
  // Blanket: a subdivided plane with soft rumples, checks painted per cell.
  const N = 6;
  const S = 1.9 / N;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const g = new THREE.PlaneGeometry(S + 0.004, S + 0.004, 2, 2);
      g.rotateX(-Math.PI / 2);
      const pa = g.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pa.count; v++) {
        const wx = pa.getX(v) + (i - N / 2 + 0.5) * S;
        const wz = pa.getZ(v) + (j - N / 2 + 0.5) * S;
        pa.setY(v, 0.075 + 0.018 * Math.sin(wx * 4.1 + 1.3) * Math.sin(wz * 3.3) + (Math.abs(wx) > 0.88 || Math.abs(wz) > 0.88 ? -0.02 : 0));
      }
      g.computeVertexNormals();
      const c = (i + j) % 2 === 0 ? cloth : i % 2 && j % 2 ? 0xf6efe2 : new THREE.Color(cloth).lerp(new THREE.Color(0xf6efe2), 0.55).getHex();
      b.add('cloth', g, mat((i - N / 2 + 0.5) * S, 0, (j - N / 2 + 0.5) * S), { tint: c });
    }
  // Basket: woven body, lid half open, a handle arch, a baguette poking out.
  b.add('woodGrain', boxUV(roundedBox(0.46, 0.26, 0.32, 0.06), 3), mat(0.42, 0.16, -0.38, 0, 0.3, 0), { tint: 0xc89a5a });
  b.add('woodGrain', roundedBox(0.48, 0.04, 0.17, 0.02), mat(0.42, 0.31, -0.46, -0.5, 0.3, 0), { tint: 0xb88a4a });
  b.add('woodGrain', new THREE.TorusGeometry(0.17, 0.018, 5, 14, Math.PI), mat(0.42, 0.29, -0.38, 0, 0.3, 0), { tint: 0xa87a3a });
  const loaf = new THREE.CapsuleGeometry(0.05, 0.36, 4, 8);
  b.add('white', loaf, mat(0.36, 0.36, -0.32, 0.2, 0.3, 1.1), { tint: 0xd89048 });
  // Jug + cups + a plate of strawberries.
  b.add('white', new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.08, 0.01), new THREE.Vector2(0.1, 0.1), new THREE.Vector2(0.06, 0.2), new THREE.Vector2(0.07, 0.24)], 12), mat(-0.35, 0.03, -0.3), { tint: 0x5a8ab0 });
  for (const [x, z] of [[-0.1, 0.25], [0.12, 0.38]] as const) b.add('white', bevelCylinder(0.045, 0.038, 0.09, 0.01, 10), mat(x, 0.03, z), { tint: 0xf6efe2 });
  b.add('white', bevelCylinder(0.17, 0.15, 0.03, 0.01, 16), mat(-0.32, 0.03, 0.22), { tint: 0xf6efe2 });
  for (let i = 0; i < 7; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.next() * 0.09;
    b.add('white', new THREE.SphereGeometry(0.03, 6, 5), mat(-0.32 + Math.cos(a) * r, 0.08, 0.22 + Math.sin(a) * r, 0, 0, 0, 1, 1.2, 1), { tint: 0xe03a3a });
  }
  return b.build({ name: 'picnic' });
}

/** A clump of tall meadow flowers (cosmos / foxglove spikes / daisies) to break up bare lawn. */
export function buildWildflowers(rng: Rng, colors: number[] = [0xff8fab, 0xffffff, 0xc77dff, 0xffd166]): THREE.Group {
  const b = new MeshBuilder();
  for (let i = 0; i < 12; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * 0.65;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.8;
    const h = 0.35 + rng.next() * 0.45 * (1 - r * 0.6);
    const lean = (rng.next() - 0.5) * 0.3;
    // (r9, pillar 14: a 4-sided open stem — the 1.8 cm bevelled box was 108 triangles a stem)
    b.add('boxFlower', new THREE.CylinderGeometry(0.01, 0.012, h, 4, 1, true), mat(x, h / 2, z, lean, 0, (rng.next() - 0.5) * 0.3), { tint: 0x4f8a3a });
    if (i % 2 === 0) b.add('boxFlower', new THREE.IcosahedronGeometry(0.07, 0), mat(x, 0.08, z, 0, 0, 0, 1.4, 0.6, 1.4), { tint: i % 4 ? 0x5a9a42 : 0x4a8a3a });
    const c = colors[i % colors.length]!;
    if (i % 4 === 3) {
      // foxglove spike: stacked bells
      for (let k = 0; k < 4; k++) b.add('boxFlower', new THREE.SphereGeometry(0.035 - k * 0.005, 6, 5), mat(x + Math.sin(lean) * h * 0.3, h * 0.72 + k * 0.07, z, 0, 0, 0, 1, 1.3, 1), { tint: c });
    } else {
      b.add('boxFlower', new THREE.CylinderGeometry(0.06, 0.05, 0.02, 7), mat(x + Math.sin(lean) * h * 0.5, h, z, 0.3, 0, 0), { tint: c });
      b.add('boxFlower', new THREE.SphereGeometry(0.022, 6, 4), mat(x + Math.sin(lean) * h * 0.5, h + 0.015, z), { tint: 0xf2b830 });
    }
  }
  return b.build({ name: 'wildflowers' });
}

/** The roof numbers buildTownHouse uses (plinth 0.35 m, rise ≥ 1.4 m or 42 % of the depth, 0.45 m overhang). */
function roofOf(d: number, wallH: number): { top: number; rise: number; tanS: number; ridgeY: number; slope: number } {
  const top = 0.35 + wallH;
  const rise = Math.max(1.4, d * 0.42);
  const tanS = rise / (d / 2);
  return { top, rise, tanS, ridgeY: top + rise, slope: Math.atan(tanS) };
}

/**
 * Breaks up a town house's big roof planes (r3 critic: "huge flat unbroken planes"): a segmented
 * capping ridge, dormers on the front slope, moss and lichen clumps, and a scatter of odd-toned
 * slipped tiles. Local space of the house (ground centre, +Z front); merged with the town's statics.
 */
export function buildRoofDressing(rng: Rng, s: { w: number; d: number; wallH: number; wallTint: number; roofTint: number; roof?: 'roofTile' | 'thatch' }, dormers: number[] = []): THREE.Group {
  const b = new MeshBuilder();
  const { top, rise, tanS, ridgeY, slope } = roofOf(s.d, s.wallH);
  const W = s.w + 0.9;
  const tile = s.roof !== 'thatch';
  const dark = new THREE.Color(s.roofTint).multiplyScalar(0.7).getHex();
  if (tile) {
    const cap = new THREE.CylinderGeometry(0.11, 0.11, W + 0.1, 10);
    cap.rotateZ(Math.PI / 2);
    b.add('roofTile', cap, mat(0, ridgeY + 0.1, 0), { tint: dark });
    for (let x = -W / 2 + 0.25; x < W / 2 - 0.1; x += 0.46) {
      const ring = new THREE.CylinderGeometry(0.128, 0.128, 0.07, 10);
      ring.rotateZ(Math.PI / 2);
      b.add('roofTile', ring, mat(x, ridgeY + 0.1, 0), { tint: new THREE.Color(dark).multiplyScalar(0.88).getHex() });
    }
  } else {
    // Thatch: a fat rolled ridge with hazel spars.
    const roll = new THREE.CylinderGeometry(0.2, 0.2, W + 0.2, 10);
    roll.rotateZ(Math.PI / 2);
    b.add('thatch', roll, mat(0, ridgeY + 0.12, 0), { tint: new THREE.Color(s.roofTint).multiplyScalar(0.86).getHex() });
    for (let x = -W / 2 + 0.3; x < W / 2; x += 0.5) for (const sz of [-1, 1]) b.add('woodDark', roundedBox(0.04, 0.04, 0.42, 0.01), mat(x, ridgeY - 0.02, sz * 0.24, sz * 0.6, 0, 0), { tint: 0x8a6a3a });
  }
  for (const x of dormers) dormer(b, rng, x, s.d, s.wallH, s.wallTint, s.roofTint);
  // Moss and lichen on the front slope (thicker towards the eaves and the shaded ends).
  const roofY = (z: number): number => top + rise - tanS * z + (tile ? 0.12 : 0.22);
  // (small, dark and clustered low on the slope / at the ends — not pale discs strewn over the tiles)
  for (let c = 0; c < 4; c++) {
    const cx0 = (c % 2 ? 1 : -1) * (W / 2 - 0.5 - rng.next() * 1.4);
    const cz0 = s.d / 2 - 0.1 - rng.next() * 0.6;
    if (dormers.some((dx) => Math.abs(dx - cx0) < 1.1)) continue;
    for (let i = 0; i < 5; i++) {
      const x = cx0 + (rng.next() - 0.5) * 0.9;
      const z = Math.min(s.d / 2 + 0.3, cz0 + (rng.next() - 0.5) * 0.6);
      // (r16 critic: "the mossy roof patches are identical stickers" — each clump its own size,
      // stretch, turn and tone, from dark cushion moss to a pale grey-gold lichen)
      const r = 0.045 + Math.pow(rng.next(), 1.6) * 0.16;
      const clump = lumpySphere(r, 1, 0.45, rng, 2.2 + rng.next() * 1.5);
      clump.scale(0.9 + rng.next() * 0.8, 0.14 + rng.next() * 0.1, 0.6 + rng.next() * 0.7);
      const mc = new THREE.Color([0x4f6a2a, 0x5f7a30, 0x6a7a3a, 0x7a8a44, 0x9a9a6a, 0x5a6a3a][Math.floor(rng.next() * 6)]!).multiplyScalar(0.85 + rng.next() * 0.3);
      b.add('white', clump, mat(x, roofY(z) - 0.02, z, slope, rng.next() * 6.28, 0), { tint: mc.getHex() });
    }
  }
  if (tile)
    for (let i = 0; i < 14; i++) {
      const x = (rng.next() - 0.5) * (W - 0.4);
      const z = 0.4 + rng.next() * (s.d / 2);
      const k = 0.8 + rng.next() * 0.35;
      b.add('roofTile', roundedBox(0.34, 0.05, 0.3, 0.015), mat(x, roofY(z) - 0.035, z, slope, (rng.next() - 0.5) * 0.25, 0), { tint: new THREE.Color(s.roofTint).multiplyScalar(k).getHex() });
    }
  return b.build({ name: 'roof-dressing' });
}

/**
 * Winter on a house's front eave: a rounded lip of drifted snow along the gutter and a row of
 * icicles (r3 critic: snow roofs read as flat white slabs). Local space of the house; the town
 * merges every house's eaves into one winter-only mesh.
 */
export function eaveWinter(b: MeshBuilder, rng: Rng, s: { w: number; d: number; wallH: number }, M: THREE.Matrix4): void {
  const { top, rise, tanS } = roofOf(s.d, s.wallH);
  const W = s.w + 0.9;
  const ze = s.d / 2 + 0.43;
  const ye = top + rise - tanS * ze + 0.06;
  // (pillar 14: bumps and icicles are AO detail — they skip the half-res GTAO G-buffer)
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, tint: number, detail = false): void => {
    b.add('white', geo, M.clone().multiply(m), { tint, detail });
  };
  const lip = new THREE.CapsuleGeometry(0.1, W - 0.2, 4, 10);
  lip.rotateZ(Math.PI / 2);
  lip.scale(1, 1.15, 1.25);
  add(lip, mat(0, ye + 0.06, ze - 0.04), 0xf2f6fb);
  for (let i = 0; i < 6; i++) {
    const bump = lumpySphere(0.14 + rng.next() * 0.08, 1, 0.2, rng, 1.6);
    bump.scale(1.6, 0.55, 1);
    add(bump, mat(-W / 2 + 0.4 + rng.next() * (W - 0.8), ye + 0.1, ze - 0.12), 0xf4f7fb, true);
  }
  for (let x = -W / 2 + 0.2; x < W / 2 - 0.1; x += 0.16 + rng.next() * 0.22) {
    if (rng.next() < 0.25) continue;
    const len = 0.12 + Math.pow(rng.next(), 1.6) * 0.42;
    // (open base: it sits inside the lip, never seen; 6 tris instead of 12)
    const ic = new THREE.ConeGeometry(0.025 + rng.next() * 0.02, len, 6, 1, true);
    ic.rotateX(Math.PI);
    add(ic, mat(x, ye - 0.02 - len / 2, ze + 0.02), 0xdcefff, true);
  }
}

/**
 * A snow slab (pillar 14): the silhouette and shading of roundedBox(w, h, d, r, 1) — 108 triangles —
 * in 36. Each bevel is one chamfer whose vertex normals run from the face it leaves to the face it
 * meets (the same smooth roll RoundedBoxGeometry's single segment shades), corners are one triangle,
 * and the bottom (pressed onto the roof) is a flat octagon.
 */
export function snowSlab(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const a = w / 2 - rr;
  const c = d / 2 - rr;
  const X = w / 2;
  const Z = d / 2;
  const yt = h / 2;
  const ym = h / 2 - rr;
  const yb = -h / 2;
  type V = [number, number, number, number, number, number];
  const T = (sx: number, sz: number): V => [sx * a, yt, sz * c, 0, 1, 0];
  const SxU = (sx: number, sz: number): V => [sx * X, ym, sz * c, sx, 0, 0];
  const SxL = (sx: number, sz: number): V => [sx * X, yb, sz * c, sx, 0, 0];
  const SzU = (sx: number, sz: number): V => [sx * a, ym, sz * Z, 0, 0, sz];
  const SzL = (sx: number, sz: number): V => [sx * a, yb, sz * Z, 0, 0, sz];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const tri = (p: V, q: V, s: V): void => {
    // Wind outward: the geometric normal must agree with the summed vertex normals.
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * (p[3] + q[3] + s[3]) + ny * (p[4] + q[4] + s[4]) + nz * (p[5] + q[5] + s[5]) < 0) [q, s] = [s, q];
    for (const v of [p, q, s]) {
      pos.push(v[0], v[1], v[2]);
      nor.push(v[3], v[4], v[5]);
      uv.push(v[0] / w + 0.5, v[2] / d + 0.5);
    }
  };
  const quad = (p: V, q: V, s: V, t: V): void => {
    tri(p, q, s);
    tri(p, s, t);
  };
  quad(T(-1, -1), T(1, -1), T(1, 1), T(-1, 1));
  for (const k of [-1, 1]) {
    quad(T(k, -1), T(k, 1), SxU(k, 1), SxU(k, -1));
    quad(T(-1, k), T(1, k), SzU(1, k), SzU(-1, k));
    quad(SxU(k, -1), SxU(k, 1), SxL(k, 1), SxL(k, -1));
    quad(SzU(-1, k), SzU(1, k), SzL(1, k), SzL(-1, k));
    for (const j of [-1, 1]) {
      tri(T(k, j), SxU(k, j), SzU(k, j));
      quad(SxU(k, j), SzU(k, j), SzL(k, j), SxL(k, j));
    }
  }
  const down = (v: V): V => [v[0], v[1], v[2], 0, -1, 0];
  const ring = [SxL(1, -1), SxL(1, 1), SzL(1, 1), SzL(-1, 1), SxL(-1, 1), SxL(-1, -1), SzL(-1, -1), SzL(1, -1)].map(down);
  for (let i = 1; i < ring.length - 1; i++) tri(ring[0]!, ring[i]!, ring[i + 1]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

let wetTiles: THREE.MeshStandardMaterial | null = null;
/** Melt-darkened tiles showing through the snow (no world-fx: it must never whiten). */
function wetTileMaterial(): THREE.MeshStandardMaterial {
  if (wetTiles) return wetTiles;
  const t = textures.shingles();
  const map = t.map.clone();
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 1.6);
  map.needsUpdate = true;
  wetTiles = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.38, metalness: 0 });
  wetTiles.name = 'roof-wet-tiles';
  return wetTiles;
}

/**
 * r15 winter roofs (critic: "roofs … lose value separation; snow reads as uniform coating rather than
 * accumulated material responding to architecture"): each slope carries snow as a stepped pack —
 * strips of slab 10–17 cm thick reaching different heights up the slope, so their ragged top edge is a
 * row of lit steps; above them the tiles show through, melt-darkened and wet where the house's warmth
 * rises to the ridge and round the chimney; a cornice droops past the eave with a cool underside.
 * Local house space (ground centre, +Z front, ridge along X). `b` takes the 'white' snow, the wet tiles
 * go in their own material.
 */
export function roofSnowWinter(b: MeshBuilder, rng: Rng, s: { w: number; d: number; wallH: number; roofTint: number; roof?: 'roofTile' | 'thatch'; chimney?: boolean }, M: THREE.Matrix4): void {
  const { top, rise, tanS, slope } = roofOf(s.d, s.wallH);
  const W = s.w + 0.9;
  const run = s.d / 2 + 0.45;
  const cosS = Math.cos(slope);
  const surf = (z: number): number => top + rise - tanS * z + (s.roof === 'thatch' ? 0.22 : 0.12);
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, tint: number | THREE.Material, col = 0xffffff): void => {
    if (typeof tint === 'number') b.add('white', geo, M.clone().multiply(m), { tint });
    else b.add(tint, geo, M.clone().multiply(m), { tint: col });
  };
  const wet = new THREE.Color(s.roofTint).multiplyScalar(0.42).lerp(new THREE.Color(0x2a2c36), 0.35).getHex();
  for (const sz of [-1, 1]) {
    // Exposed wet band: ridge down to just under the lowest snow step (the slabs sit on top of it).
    const bandLen = (run * 0.62) / cosS;
    const bz = run * 0.31;
    const band = roundedBox(W - 0.04, 0.03, bandLen, 0.012, 1);
    add(band, mat(0, surf(bz) + 0.005, sz * bz, sz * slope, 0, 0), wetTileMaterial(), wet);
    // The snow pack in strips: each reaches its own height (stepped, ragged top edge).
    // (the reach wanders along the roof as a slow wave plus jitter: a soft scalloped melt line with
    // a few deeper bites, not a crenellated row of equal notches)
    const ph = rng.next() * 6.28;
    let x = -W / 2;
    while (x < W / 2 - 0.05) {
      // (r16 critic: "stair-stepped jaggies along the roof snow edges" — wider strips that overlap
      // their neighbours, reaching along one slow wave with only a little jitter: a soft melt line)
      const sw = Math.min(W / 2 - x, 0.55 + rng.next() * 0.35);
      const xc = x + sw / 2;
      const reach = THREE.MathUtils.clamp(0.66 + 0.1 * Math.sin(xc * 0.75 + ph) + 0.04 * Math.sin(xc * 1.9 + ph * 2) + (rng.next() - 0.5) * 0.03, 0.48, 0.84);
      const th = 0.12 + rng.next() * 0.03;
      const len = (run * reach) / cosS;
      const zc = run - (run * reach) / 2;
      const slab = snowSlab(sw + 0.24, th, len, Math.min(0.06, th * 0.5));
      // (r18 critic: "a uniform coating" — each strip its own value: older, wind-glazed strips a cool
      // blue-grey, fresh ones bright, so the pack reads as laid-down layers, not one white sheet)
      const fresh = rng.next();
      const tone = new THREE.Color(0xeef3fa).lerp(new THREE.Color(0xc9d4e6), (1 - fresh) * 0.55 * (0.6 + 0.4 * (1 - reach))).getHex();
      add(slab, mat(xc, surf(zc) + th / 2 / cosS + 0.01, sz * zc, sz * slope, 0, 0), tone);
      // A wind-packed roll along each step's upper edge rounds it off.
      const zt = run - run * reach + 0.06;
      const lump = lumpySphere(0.1 + rng.next() * 0.06, 0, 0.22, rng, 1.8);
      lump.scale((sw + 0.24) / 0.24, 0.42, 0.75);
      // (AO detail: a 4 cm roll on the slab adds nothing to the half-res GTAO G-buffer)
      b.add('white', lump, M.clone().multiply(mat(xc, surf(zt) + th * 0.85, sz * zt, sz * slope, 0, 0)), { tint: 0xf2f6fb, detail: true });
      x += sw;
    }
    // Cornice: snow creeping over the eave, drooping, with a cool shaded underside (the back eave;
    // the front one is eaveWinter's lip + icicles).
    if (sz < 0) {
      const lip = new THREE.CapsuleGeometry(0.11, W - 0.25, 4, 10);
      lip.rotateZ(Math.PI / 2);
      lip.scale(1, 1.1, 1.3);
      add(lip, mat(0, surf(run) + 0.07, -run + 0.02), 0xe6eef8);
    }
  }
  // Ridge: the warm roof sheds its snow there — the cap stays dark and wet.
  const cap = new THREE.CylinderGeometry(0.125, 0.125, W + 0.12, 10);
  cap.rotateZ(Math.PI / 2);
  add(cap, mat(0, top + rise + 0.11, 0), wetTileMaterial(), new THREE.Color(wet).multiplyScalar(0.85).getHex());
}

// ───────────────────────────────────────────── Plaza identities (r11)
// r8 critic: "two near-mirrored storefront masses". The store and the bakery share buildTownHouse's
// box + gable; these give each its own roofline, sign and working threshold: Thimble & Pip's gets a
// jettied, half-timbered loading gable with a hoist and a crate of stock on the rope; The Hearth Oven
// a domed brick bread oven glowing on its plaza side, a tall round flue, a louvred ridge vent with a
// wheat-sheaf vane and a painted board standing on the roof.

let shopSign: THREE.MeshStandardMaterial | null = null;
/** One canvas atlas for both painted name boards (top half the store, bottom half the bakery). */
function shopSignMaterial(): THREE.MeshStandardMaterial {
  if (shopSign) return shopSign;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d')!;
  const board = (y0: number, bg: [string, string], rim: string, title: string, sub: string, ink: string, subInk: string): void => {
    const g = x.createLinearGradient(0, y0, 0, y0 + 256);
    g.addColorStop(0, bg[0]);
    g.addColorStop(1, bg[1]);
    x.fillStyle = g;
    x.fillRect(0, y0, 1024, 256);
    // Brushed grain + worn edges.
    x.globalAlpha = 0.08;
    for (let i = 0; i < 40; i++) {
      x.fillStyle = i % 2 ? '#000' : '#fff';
      x.fillRect(0, y0 + ((i * 37) % 256), 1024, 2 + (i % 3));
    }
    x.globalAlpha = 1;
    x.strokeStyle = rim;
    x.lineWidth = 10;
    x.strokeRect(22, y0 + 22, 980, 212);
    x.lineWidth = 3;
    x.strokeRect(38, y0 + 38, 948, 180);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.font = '700 112px Fredoka, Nunito, sans-serif';
    const tw = x.measureText(title).width;
    if (tw > 900) x.font = `700 ${Math.floor((112 * 900) / tw)}px Fredoka, Nunito, sans-serif`;
    x.fillText(title, 515, y0 + 112);
    x.fillStyle = ink;
    x.fillText(title, 512, y0 + 108);
    x.font = '700 40px Nunito, sans-serif';
    x.fillStyle = subInk;
    x.fillText(sub, 512, y0 + 192);
  };
  board(0, ['#2f6a64', '#245650'], '#e8c86a', 'THIMBLE & PIP', '· general goods · seeds · sundries ·', '#f6ecd2', '#e8c86a');
  board(256, ['#f3e2bf', '#e6cc9c'], '#8a3a22', 'THE HEARTH OVEN', '~ fresh loaves from the fire ~', '#7a2e1a', '#9a5a2a');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  shopSign = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  shopSign.name = 'shopSign';
  applyWorldFx(shopSign);
  return shopSign;
}

/** A name board quad (w × h, facing +Z) mapped to one half of the sign atlas. */
function signQuad(w: number, h: number, half: 'store' | 'bakery'): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (half === 'store' ? 0.5 : 0) + uv.getY(i) * 0.5);
  return g;
}

/**
 * Thimble & Pip's loading gable: a jettied, half-timbered cross-gable over the shop windows (it breaks
 * the eave and rises nearly to the ridge), the painted name board on its band, a loft door standing
 * open on a lit storeroom, and a hoist beam with a pulley and a crate of stock mid-lift.
 * Local space of the store (buildTownHouse: ground centre, +Z front).
 */
export function buildStoreFront(rng: Rng, s: { w: number; d: number; wallH: number; wallTint: number; roofTint: number; doorTint: number }): THREE.Group {
  const b = new MeshBuilder();
  const { top, ridgeY } = roofOf(s.d, s.wallH);
  const fz = s.d / 2;
  const cx = 0;
  const hw = 1.3;
  const zf = fz + 0.55;
  const zb = 0.3;
  const y0 = top - 0.6;
  const yE = y0 + 0.66;
  const peak = ridgeY - 0.18;
  const timber = 0x5a3a26;
  // Body: band + gable triangle, extruded back into the roof.
  const sh = new THREE.Shape();
  sh.moveTo(-hw, 0);
  sh.lineTo(hw, 0);
  sh.lineTo(hw, yE - y0);
  sh.lineTo(0, peak - y0);
  sh.lineTo(-hw, yE - y0);
  sh.closePath();
  const body = new THREE.ExtrudeGeometry(sh, { depth: zf - zb, bevelEnabled: false });
  boxUV(body, 1 / 1.8);
  b.add('plaster', body, mat(cx, y0, zb), { tint: s.wallTint });
  // Timber frame on the face: sole plate, posts, tie beam, king post, braces, barge boards.
  const fzT = zf + 0.03;
  b.add('woodDark', roundedBox(2 * hw + 0.16, 0.16, 0.16, 0.04), mat(cx, y0 + 0.02, fzT), { tint: timber });
  b.add('woodDark', roundedBox(2 * hw + 0.12, 0.13, 0.12, 0.03), mat(cx, yE, fzT), { tint: timber });
  for (const sx of [-1, 1]) b.add('woodDark', roundedBox(0.14, yE - y0 + 0.1, 0.12, 0.03), mat(cx + sx * hw, (y0 + yE) / 2, fzT), { tint: timber });
  const doorW = 0.78;
  const doorH = 0.98;
  const dy = yE + 0.08;
  b.add('woodDark', roundedBox(0.12, peak - (dy + doorH) - 0.1, 0.1, 0.03), mat(cx, (dy + doorH + peak - 0.1) / 2, fzT), { tint: timber });
  const rake = Math.atan2(peak - yE, hw);
  for (const sx of [-1, 1]) {
    // Raking braces from the tie beam's ends up towards the door head.
    const ax = cx + sx * (hw - 0.1);
    const bx = cx + sx * (doorW / 2 + 0.12);
    const by = dy + doorH;
    const len = Math.hypot(ax - bx, by - yE);
    b.add('woodDark', roundedBox(0.1, len, 0.09, 0.02), mat((ax + bx) / 2, (yE + by) / 2, fzT, 0, 0, Math.atan2(ax - bx, by - yE)), { tint: timber });
  }
  // Loft door: frame, a leaf swung open against the wall, the lit storeroom behind.
  b.add('woodPaint', roundedBox(doorW + 0.16, doorH + 0.1, 0.08, 0.03), mat(cx, dy + doorH / 2, zf + 0.02), { tint: 0xf3ead8 });
  b.add('windowCard', new THREE.PlaneGeometry(doorW, doorH - 0.04), mat(cx, dy + doorH / 2, zf + 0.07));
  b.add('wood', boxUV(roundedBox(doorW / 2 - 0.02, doorH - 0.06, 0.06, 0.02), 1 / 1.1), mat(cx + doorW / 2 + 0.16, dy + doorH / 2, zf + 0.22, 0, -1.25, 0), { tint: s.doorTint });
  b.add('wood', boxUV(roundedBox(doorW / 2 - 0.02, doorH - 0.06, 0.06, 0.02), 1 / 1.1), mat(cx - doorW / 2 - 0.1, dy + doorH / 2, zf + 0.16, 0, 1.45, 0), { tint: s.doorTint });
  b.add('woodDark', roundedBox(doorW + 0.3, 0.08, 0.3, 0.02), mat(cx, dy - 0.03, zf + 0.14), { tint: timber });
  // Sacks waiting on the loft sill.
  for (const k of [-0.2, 0.16]) b.add('white', lumpySphere(0.15, 1, 0.15, rng), mat(cx + k, dy + 0.15, zf - 0.04, 0, k * 3, 0, 1, 1.15, 0.8), { tint: 0xd8b880 });
  // Roof: two steep slabs over the gable + ridge roll + painted barge boards.
  const half = hw + 0.28;
  const slab = half / Math.cos(rake);
  const ry = peak + 0.13;
  const z0 = zb - 0.35;
  const z1 = zf + 0.42;
  for (const sx of [-1, 1]) {
    const g = boxUV(roundedBox(slab, 0.15, z1 - z0, 0.05), 1 / 1.7);
    b.add('roofTile', g, mat(cx + sx * (half / 2), ry - Math.tan(rake) * (half / 2), (z0 + z1) / 2, 0, 0, -sx * rake), { tint: s.roofTint });
    b.add('woodPaint', roundedBox(slab + 0.05, 0.15, 0.07, 0.03), mat(cx + sx * (half / 2), ry - Math.tan(rake) * (half / 2) - 0.07, z1 + 0.02, 0, 0, -sx * rake), { tint: 0xf3ead8 });
  }
  const ridge = new THREE.CylinderGeometry(0.1, 0.1, z1 - z0 + 0.04, 10);
  ridge.rotateX(Math.PI / 2);
  b.add('roofTile', ridge, mat(cx, ry + 0.06, (z0 + z1) / 2), { tint: new THREE.Color(s.roofTint).multiplyScalar(0.8).getHex() });
  // A carved finial at the apex.
  b.add('woodPaint', new THREE.ConeGeometry(0.07, 0.42, 6), mat(cx, ry + 0.3, z1 + 0.04), { tint: 0xf3ead8 });
  b.add('woodPaint', new THREE.SphereGeometry(0.07, 8, 6), mat(cx, ry + 0.08, z1 + 0.04), { tint: 0xf3ead8 });
  // Jetty corbels under the overhang.
  for (const sx of [-1, 1]) {
    const L = Math.hypot(zf - fz, 0.42);
    b.add('woodDark', roundedBox(0.13, L, 0.13, 0.03), mat(cx + sx * (hw - 0.12), y0 - 0.17, (fz + zf) / 2 - 0.02, Math.atan2(zf - fz, 0.42), 0, 0), { tint: timber });
  }
  // Painted name board on the band.
  b.add('woodDark', roundedBox(2 * hw - 0.12, yE - y0 - 0.12, 0.06, 0.02), mat(cx, (y0 + yE) / 2 + 0.03, zf + 0.06), { tint: 0x3a2a1e });
  b.add(shopSignMaterial(), signQuad(2 * hw - 0.24, yE - y0 - 0.22, 'store'), mat(cx, (y0 + yE) / 2 + 0.03, zf + 0.1));
  // Hoist: a beam out of the apex, an iron pulley, a rope down to a crate of stock mid-lift.
  const hy = peak - 0.42;
  b.add('woodDark', roundedBox(0.17, 0.17, 1.1, 0.04), mat(cx, hy, zf + 0.45), { tint: timber });
  b.add('woodDark', roundedBox(0.1, 0.62, 0.1, 0.02), mat(cx, hy - 0.28, zf + 0.2, 0.75, 0, 0), { tint: timber });
  const wheel = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12);
  wheel.rotateZ(Math.PI / 2);
  b.add('metal', wheel, mat(cx, hy - 0.2, zf + 0.86), { tint: 0x3a3634 });
  b.add('metal', roundedBox(0.04, 0.22, 0.04, 0.01), mat(cx, hy - 0.1, zf + 0.86), { tint: 0x3a3634 });
  // (hoisted high, just under the pulley: lower, the crate covered the name board from the plaza lens)
  const crateY = hy - 0.86;
  const rope = (x0: number, y0r: number, z0r: number, x1: number, y1r: number, z1r: number): void => {
    const len = Math.hypot(x1 - x0, y1r - y0r, z1r - z0r);
    const g = new THREE.CylinderGeometry(0.016, 0.016, len, 5);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(x0, y0r, z0r), new THREE.Vector3(x1, y1r, z1r), new THREE.Vector3(0, 1, 0));
    g.rotateX(Math.PI / 2);
    b.add('cloth', g, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0r + y1r) / 2, (z0r + z1r) / 2).multiply(m), { tint: 0xc8a878 });
  };
  rope(cx, hy - 0.3, zf + 0.98, cx, crateY + 0.5, zf + 0.98);
  rope(cx, hy - 0.3, zf + 0.74, cx + 0.3, dy + 0.5, zf + 0.12);
  for (const sx of [-1, 1]) rope(cx, crateY + 0.5, zf + 0.98, cx + sx * 0.24, crateY + 0.34, zf + 0.98);
  b.add('woodGrain', boxUV(roundedBox(0.56, 0.36, 0.46, 0.04), 1), mat(cx, crateY + 0.16, zf + 0.98, 0, 0.18, 0.04), { tint: 0xb08a58 });
  for (const k of [-0.13, 0, 0.13]) b.add('boxFlower', lumpySphere(0.08, 1, 0.3, rng), mat(cx + k, crateY + 0.37, zf + 0.98 + (rng.next() - 0.5) * 0.1), { tint: [0xe0563a, 0xf2a03a, 0x6fae4a][Math.abs(Math.round(k * 10)) % 3]! });
  return b.build({ name: 'store-front' });
}

/**
 * The Hearth Oven: a domed brick bread oven on the plaza (west) gable with a glowing mouth and a
 * firewood stack, a tall round brick flue, a louvred ridge vent with a gilded wheat-sheaf vane and a
 * painted name board standing on the front roof slope. Returns the flue top as `anchors.chimney`.
 */
export function buildBakeryFront(rng: Rng, s: { w: number; d: number; wallH: number; roofTint: number }): BuiltProp {
  const b = new MeshBuilder();
  const { top, rise, tanS, ridgeY, slope } = roofOf(s.d, s.wallH);
  const W = s.w;
  const brick = 0xb8644a;
  const ox = -W / 2 - 0.06;
  const oz = -0.55;
  const r = 0.66;
  // Oven: plinth drum + dome, a soot-dark arched mouth with the fire in it, an iron door hung open.
  b.add('stone', boxUV(bevelCylinder(r, r + 0.04, 1.0, 0.05, 18), 0.6), mat(ox, 0, oz), { tint: brick, aoWorld: groundAO(0.35) });
  const dome = new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.82, 1);
  b.add('stone', boxUV(dome, 0.6), mat(ox, 0.98, oz), { tint: 0xc4745a });
  b.add('stone', new THREE.TorusGeometry(r + 0.02, 0.05, 5, 22).rotateX(Math.PI / 2), mat(ox, 1.0, oz), { tint: 0x9a5038 });
  const mx = ox - r + 0.02;
  b.add('stone', roundedBox(0.16, 0.62, 0.7, 0.05), mat(mx - 0.04, 1.0, oz), { tint: 0x8a4a34 });
  const arch = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 12, 1, false, 0, Math.PI);
  arch.rotateZ(Math.PI / 2);
  b.add('woodDark', roundedBox(0.06, 0.3, 0.5, 0.02), mat(mx - 0.1, 0.9, oz), { tint: 0x221410 });
  b.add('woodDark', arch, mat(mx - 0.1, 1.05, oz), { tint: 0x221410 });
  b.add('lampGlow', lumpySphere(0.13, 1, 0.3, rng), mat(mx - 0.12, 0.84, oz - 0.08, 0, 0, 0, 1, 0.5, 1.2), { tint: 0xff9a4a });
  b.add('lampGlow', lumpySphere(0.1, 1, 0.3, rng), mat(mx - 0.12, 0.84, oz + 0.1, 0, 0, 0, 1, 0.5, 1.2), { tint: 0xffb05a });
  b.add('metal', roundedBox(0.03, 0.3, 0.42, 0.01), mat(mx - 0.22, 0.95, oz + 0.42, 0, -1.0, 0), { tint: 0x2e2a28 });
  // Flue: a tall round brick stack on the gable, banded, with a clay pot.
  const fx = -W / 2 - 0.2;
  const fzf = oz - 0.3;
  const flueTop = ridgeY + 1.05;
  b.add('stone', boxUV(new THREE.CylinderGeometry(0.24, 0.3, flueTop - 1.3, 12), 0.6), mat(fx, (flueTop + 1.3) / 2, fzf), { tint: brick });
  for (const yb of [top - 0.2, ridgeY - 0.2, flueTop - 0.1]) b.add('stone', new THREE.CylinderGeometry(0.31, 0.31, 0.12, 12), mat(fx, yb, fzf), { tint: 0x9a5038 });
  b.add('soilPot', new THREE.CylinderGeometry(0.13, 0.17, 0.32, 10), mat(fx, flueTop + 0.12, fzf), { tint: 0xc0704a });
  // Firewood stacked against the gable in front of the oven, a peel leaning on it.
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 4 - row; i++) {
      const log = new THREE.CylinderGeometry(0.08, 0.08, 0.62, 7);
      log.rotateX(Math.PI / 2);
      b.add('woodGrain', log, mat(ox + 0.12 - (i + row * 0.5) * 0.16, 0.08 + row * 0.14, oz + 1.22 + (rng.next() - 0.5) * 0.06), { tint: [0x8a6a44, 0x9a7a52, 0x7a5a3a][(i + row) % 3]! });
    }
  b.add('woodGrain', roundedBox(0.05, 1.5, 0.05, 0.01), mat(ox - 0.35, 0.75, oz + 1.62, 0.12, 0, 0.25), { tint: 0xc8a070 });
  b.add('woodGrain', roundedBox(0.03, 0.3, 0.26, 0.02), mat(ox - 0.17, 1.5, oz + 1.7, 0.12, 0, 0.25), { tint: 0xc8a070 });
  // Ridge vent: a louvred box under its own little roof, a gilded wheat-sheaf weathervane on top.
  const vx = 1.0;
  const vy = ridgeY + 0.1;
  b.add('woodPaint', roundedBox(0.84, 0.56, 0.74, 0.04), mat(vx, vy + 0.22, 0), { tint: 0xf3ead8 });
  for (const sz of [-1, 1]) for (let i = 0; i < 3; i++) b.add('woodDark', roundedBox(0.7, 0.05, 0.08, 0.01), mat(vx, vy + 0.08 + i * 0.14, sz * 0.38, sz * 0.5, 0, 0), { tint: 0x6a4a32 });
  for (const sz of [-1, 1]) b.add('roofTile', boxUV(roundedBox(1.04, 0.08, 0.66, 0.03), 1 / 1.7), mat(vx, vy + 0.68 - 0.12, sz * 0.27, sz * 0.62, 0, 0), { tint: s.roofTint });
  const gold = 0xd8a84a;
  b.add('metal', new THREE.CylinderGeometry(0.018, 0.018, 0.9, 5), mat(vx, vy + 1.15, 0), { tint: 0x3a3634 });
  b.add('metal', roundedBox(0.7, 0.03, 0.03, 0.01), mat(vx, vy + 1.3, 0), { tint: 0x3a3634 });
  b.add('metal', new THREE.ConeGeometry(0.06, 0.16, 4).rotateZ(-Math.PI / 2), mat(vx + 0.38, vy + 1.3, 0), { tint: 0x3a3634 });
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.13;
    b.add('metal', new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), mat(vx - 0.2 + Math.sin(a) * 0.12, vy + 1.42, 0, 0, 0, a), { tint: gold });
    const ear = new THREE.SphereGeometry(0.035, 6, 4);
    ear.scale(0.7, 1.8, 0.7);
    b.add('metal', ear, mat(vx - 0.2 + Math.sin(a) * 0.32, vy + 1.62 + Math.cos(a) * 0.04, 0, 0, 0, a), { tint: gold });
  }
  // Name board standing on the front slope on two braced posts.
  const bz = 1.15;
  const roofAt = (z: number): number => top + rise - tanS * z + 0.12;
  const bw = 3.1;
  const bh = 0.66;
  const bx = -0.55;
  const by = roofAt(bz) + 0.5 + bh / 2;
  for (const sx of [-1, 1]) {
    const px = bx + sx * (bw / 2 - 0.25);
    const h = by + bh / 2 - roofAt(bz) + 0.05;
    b.add('woodDark', roundedBox(0.1, h, 0.1, 0.02), mat(px, roofAt(bz) + h / 2 - 0.05, bz - 0.06), { tint: 0x5a3a26 });
    const L = 0.7;
    b.add('woodDark', roundedBox(0.07, L, 0.07, 0.02), mat(px, roofAt(bz - 0.3) + 0.25, bz - 0.36, -0.75, 0, 0), { tint: 0x5a3a26 });
  }
  b.add('woodDark', roundedBox(bw + 0.12, bh + 0.12, 0.08, 0.03), mat(bx, by, bz), { tint: 0x5a3a26 });
  b.add(shopSignMaterial(), signQuad(bw - 0.04, bh - 0.04, 'bakery'), mat(bx, by, bz + 0.05));
  // Gilded loaf finials on the board's corners.
  for (const sx of [-1, 1]) {
    const loaf = new THREE.CapsuleGeometry(0.08, 0.14, 4, 8);
    loaf.rotateZ(Math.PI / 2);
    b.add('metal', loaf, mat(bx + sx * (bw / 2 + 0.02), by + bh / 2 + 0.1, bz), { tint: gold });
  }
  void slope;
  const group = b.build({ name: 'bakery-front' });
  return { group, lights: [], anchors: { chimney: new THREE.Vector3(fx, flueTop + 0.35, fzf) } };
}

/**
 * Hazel's plant theatre on the west gable of her cottage (r8 critic: "auxiliary neighbourhoods lean on
 * repeated cottage geometry"): a lean-to of white posts under a whitewashed glazed roof (one vent pane
 * propped open) sheltering three tiers of staging crowded with potted pelargoniums, auriculas and
 * seedlings, a potting bench with trays by the front end and a water butt at the back.
 * Local space of a buildTownHouse cottage (W wide, +Z front).
 */
export function buildGlasshouse(rng: Rng, s: { w: number; wallH: number }): THREE.Group {
  const b = new MeshBuilder();
  const x0 = -s.w / 2;
  const depth = 1.25;
  const xo = x0 - depth;
  const zl = 1.45;
  const yOut = 2.0;
  const yIn = Math.min(0.35 + s.wallH - 0.05, 2.75);
  // (r19: an off-white — the paper-white bars and posts clipped under the noon sun in town-day)
  const white = 0xe2dccd;
  // Posts + a plate along the outer eave, brackets at the wall.
  for (const z of [-zl, 0, zl]) {
    b.add('woodPaint', roundedBox(0.1, yOut, 0.1, 0.02), mat(xo + 0.05, yOut / 2, z), { tint: white, aoWorld: groundAO(0.3) });
    b.add('stone', roundedBox(0.2, 0.1, 0.2, 0.03), mat(xo + 0.05, 0.05, z), { tint: 0xc9c0b0 });
    b.add('woodPaint', roundedBox(0.07, 0.07, 0.5, 0.015), mat(x0 - 0.2, yIn - 0.35, z, 0.0, 0, 0.75), { tint: white });
  }
  b.add('woodPaint', roundedBox(0.12, 0.1, 2 * zl + 0.2, 0.02), mat(xo + 0.05, yOut, 0), { tint: white });
  b.add('woodPaint', roundedBox(0.1, 0.1, 2 * zl + 0.2, 0.02), mat(x0 - 0.04, yIn + 0.04, 0), { tint: white });
  // Staging: three tiers stepping up to the wall, crowded with pots.
  const greens = [0x4f8a3a, 0x63a046, 0x7ab05a, 0x3f7a30];
  const blooms = [0xe8506a, 0xff8fab, 0xf6e2e8, 0xffd166, 0xc77dff, 0xf25f5c, 0xffffff];
  for (let t = 0; t < 3; t++) {
    const tx = xo + 0.3 + t * 0.34;
    const ty = 0.42 + t * 0.36;
    b.add('woodGrain', boxUV(roundedBox(0.36, 0.05, 2 * zl - 0.1, 0.015), 1), mat(tx, ty, 0), { tint: [0xb08a5a, 0xa07a4e, 0x96704a][t]! });
    for (const z of [-zl + 0.1, zl - 0.1]) b.add('woodGrain', roundedBox(0.05, ty, 0.05, 0.01), mat(tx - 0.12, ty / 2, z), { tint: 0x8a6a44, aoWorld: groundAO(0.3) });
    const n = 8 - t;
    for (let i = 0; i < n; i++) {
      const z = -zl + 0.28 + (i + (t % 2) * 0.5) * ((2 * zl - 0.56) / (n - 0.5));
      const pr = 0.075 + rng.next() * 0.02;
      b.add('soilPot', new THREE.CylinderGeometry(pr, pr * 0.75, pr * 1.6, 8), mat(tx, ty + pr * 0.8 + 0.025, z), { tint: [0xc0704a, 0xb8643e, 0xcc8458][i % 3]! });
      const leaf = lumpySphere(pr * 1.35, 1, 0.3, rng);
      sphericalNormals(leaf, new THREE.Vector3(), 0.5);
      const ly = ty + pr * 1.6 + 0.07;
      b.add('boxFlower', leaf, mat(tx, ly, z), { tint: greens[(i + t) % greens.length]! });
      if ((i + t) % 3 !== 2) for (let k = 0; k < 3; k++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.035 + rng.next() * 0.015, 0), mat(tx + (rng.next() - 0.5) * pr * 2, ly + 0.06 + rng.next() * 0.05, z + (rng.next() - 0.5) * pr * 2), { tint: blooms[(i * 3 + t + k) % blooms.length]! });
    }
  }
  // Pots spilling onto the ground along the front.
  for (let i = 0; i < 5; i++) {
    const z = -zl + 0.3 + i * 0.6 + (rng.next() - 0.5) * 0.15;
    const px = xo - 0.18 + (rng.next() - 0.5) * 0.1;
    b.add('soilPot', new THREE.CylinderGeometry(0.1, 0.075, 0.16, 8), mat(px, 0.08, z), { tint: 0xc0704a, aoWorld: groundAO(0.2) });
    const leaf = lumpySphere(0.13, 1, 0.3, rng);
    sphericalNormals(leaf, new THREE.Vector3(), 0.5);
    b.add('boxFlower', leaf, mat(px, 0.26, z), { tint: greens[i % greens.length]! });
    if (i % 2 === 0) for (let k = 0; k < 3; k++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.045, 0), mat(px + (rng.next() - 0.5) * 0.18, 0.34 + rng.next() * 0.05, z + (rng.next() - 0.5) * 0.18), { tint: blooms[(i + k) % blooms.length]! });
  }
  // Roof: a whitewashed glazed slope on white glazing bars; one vent pane propped open.
  const run = depth + 0.14;
  const fall = yIn - yOut;
  const a = Math.atan2(fall, run);
  const len = Math.hypot(run, fall) + 0.12;
  const cxr = x0 - run / 2;
  const cyr = (yIn + yOut) / 2 + 0.06;
  // (r19: sage-grey glass — the near-white slab read as boards, not glazing)
  b.add('white', roundedBox(len, 0.03, 2 * zl + 0.2, 0.01), mat(cxr, cyr, 0, 0, 0, -a), { tint: 0x9ab8b2 });
  for (let i = 0; i <= 6; i++) {
    const z = -zl - 0.05 + (i * (2 * zl + 0.1)) / 6;
    b.add('woodPaint', roundedBox(len, 0.06, 0.05, 0.015), mat(cxr, cyr + 0.03, z, 0, 0, -a), { tint: white });
  }
  const vz = zl * 0.34;
  b.add('white', roundedBox(len * 0.48, 0.03, (2 * zl) / 6 - 0.04, 0.01), mat(x0 - run * 0.28, yIn - fall * 0.28 + 0.18, vz, 0, 0, -a + 0.38), { tint: 0x8eaea8 });
  b.add('woodPaint', roundedBox(len * 0.5, 0.05, 0.05, 0.01), mat(x0 - run * 0.28, yIn - fall * 0.28 + 0.22, vz - 0.22, 0, 0, -a + 0.38), { tint: white });
  b.add('metal', roundedBox(0.02, 0.3, 0.02, 0.005), mat(x0 - run * 0.5, yIn - fall * 0.5 + 0.14, vz, 0, 0, 0.3), { tint: 0x3a3634 });
  // A hanging basket from the eave plate at each end.
  for (const z of [-zl + 0.35, zl - 0.35]) {
    b.add('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.4, 3), mat(xo + 0.05, yOut - 0.22, z), { tint: 0x3a3634 });
    const bask = lumpySphere(0.2, 1, 0.3, rng);
    sphericalNormals(bask, new THREE.Vector3(), 0.5);
    b.add('boxFlower', bask, mat(xo + 0.05, yOut - 0.5, z), { tint: 0x5a9a4a });
    for (let k = 0; k < 6; k++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.045, 0), mat(xo + 0.05 + Math.cos(k) * 0.17, yOut - 0.5 + (rng.next() - 0.3) * 0.2, z + Math.sin(k) * 0.17), { tint: blooms[(k + 1) % blooms.length]! });
  }
  // Potting bench at the front end: trays of seedlings, stacked pots, a trowel.
  const bx = x0 - 0.55;
  const bz = zl + 0.55;
  b.add('woodGrain', boxUV(roundedBox(1.1, 0.07, 0.5, 0.02), 1), mat(bx, 0.82, bz), { tint: 0xa8865a });
  b.add('woodGrain', roundedBox(1.0, 0.05, 0.42, 0.02), mat(bx, 0.3, bz), { tint: 0x9a7a52 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.06, 0.82, 0.06, 0.015), mat(bx + sx * 0.48, 0.41, bz + sz * 0.19), { tint: 0x8a6a44, aoWorld: groundAO(0.3) });
  for (const k of [-0.3, 0.1]) {
    b.add('woodGrain', roundedBox(0.34, 0.06, 0.26, 0.015), mat(bx + k, 0.89, bz), { tint: 0x7a5a3a });
    for (let i = 0; i < 6; i++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.035, 0), mat(bx + k - 0.12 + (i % 3) * 0.12, 0.94, bz - 0.06 + Math.floor(i / 3) * 0.12), { tint: greens[i % 3]! });
  }
  for (let i = 0; i < 3; i++) b.add('soilPot', new THREE.CylinderGeometry(0.08, 0.06, 0.12, 9), mat(bx + 0.4, 0.92 + i * 0.07, bz - 0.04), { tint: 0xc0704a });
  for (let i = 0; i < 4; i++) b.add('soilPot', new THREE.CylinderGeometry(0.09, 0.07, 0.14, 9), mat(bx - 0.35 + i * 0.2, 0.4, bz + 0.02), { tint: 0xb8643e });
  b.add('metal', roundedBox(0.05, 0.015, 0.16, 0.005), mat(bx + 0.25, 0.87, bz + 0.12, 0, 0.6, 0), { tint: 0x9aa0a4 });
  // Water butt at the back corner.
  b.add('woodGrain', bevelCylinder(0.32, 0.3, 0.86, 0.03, 12), mat(xo - 0.2, 0, -zl - 0.2), { tint: 0x5a7a5a, aoWorld: groundAO(0.4) });
  for (const yb of [0.18, 0.66]) b.add('metal', new THREE.TorusGeometry(0.315, 0.015, 4, 16).rotateX(Math.PI / 2), mat(xo - 0.2, yb, -zl - 0.2), { tint: 0x3a3634 });
  b.add('stillWater', new THREE.CircleGeometry(0.28, 14).rotateX(-Math.PI / 2), mat(xo - 0.2, 0.8, -zl - 0.2));
  return b.build({ name: 'glasshouse' });
}
