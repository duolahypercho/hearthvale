/**
 * Town kit: parameterised townhouses (general store, bakery, cottages), the dark Lantern Hall
 * with its bell tower, the plaza fountain, notice board, market stall, planters, hedges,
 * festival bunting + paper lanterns. Same conventions as structures.ts (MeshBuilder per
 * material, origin = ground centre of the footprint, +Z = front / street side).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere, sphericalNormals, uvScale } from '../geom';
import { lantern, windowUnit, type BuiltProp } from './structures';

const TRIM = 0xf3ead8;
const groundAO = (h = 0.5, min = 0.6) => (p: THREE.Vector3): number => min + (1 - min) * THREE.MathUtils.smoothstep(p.y, 0, h);

export interface HouseSpec {
  w: number;
  d: number;
  wallH: number;
  /** Plank walls ('wood') or smooth render ('plaster'). */
  wall: 'wood' | 'plaster' | 'stone';
  wallTint: number;
  roofTint: number;
  trimTint?: number;
  doorTint: number;
  shutterTint?: number;
  roof?: 'roofTile' | 'thatch';
  chimney?: boolean;
  /** Striped awning over the shop window: [stripe A, stripe B]. */
  awning?: [number, number];
  /** Hanging sign icon painted on a board. */
  sign?: 'store' | 'bakery' | 'none';
  flowerBoxes?: boolean;
  /** Side of the door (-1 left, 0 centre, 1 right). */
  doorX?: number;
}

function gableRoof(b: MeshBuilder, W: number, D: number, top: number, rise: number, over: number, tint: number, mat_: 'roofTile' | 'thatch'): number {
  const run = D / 2 + over;
  const slope = Math.atan2(rise, D / 2);
  const len = run / Math.cos(slope) + 0.1;
  const ridgeY = top + rise;
  for (const sz of [-1, 1]) {
    const g = boxUV(roundedBox(W + 2 * over, mat_ === 'thatch' ? 0.34 : 0.18, len, mat_ === 'thatch' ? 0.14 : 0.06), 1 / 1.7);
    const cy = ridgeY - Math.tan(slope) * (run / 2) + 0.02;
    b.add(mat_, g, mat(0, cy, sz * (run / 2 - 0.05), sz * slope, 0, 0), { tint, aoWorld: (p) => 0.78 + 0.22 * THREE.MathUtils.smoothstep(p.y, top - 0.4, ridgeY) });
    const ez = sz * (run - 0.02);
    const ey = ridgeY - Math.tan(slope) * run - 0.08;
    if (mat_ === 'roofTile') b.add('woodPaint', roundedBox(W + 2 * over + 0.04, 0.16, 0.08, 0.03), mat(0, ey, ez), { tint: TRIM });
  }
  const ridge = new THREE.CylinderGeometry(mat_ === 'thatch' ? 0.24 : 0.13, mat_ === 'thatch' ? 0.24 : 0.13, W + 2 * over + 0.06, 10);
  ridge.rotateZ(Math.PI / 2);
  b.add(mat_, ridge, mat(0, ridgeY + 0.1, 0), { tint: new THREE.Color(tint).multiplyScalar(0.85).getHex() });
  // Gable triangles
  return ridgeY;
}

function gableEnds(b: MeshBuilder, W: number, D: number, top: number, rise: number, material: 'wood' | 'plaster' | 'stone', tint: number): void {
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-D / 2 - 0.05, 0);
    shape.lineTo(D / 2 + 0.05, 0);
    shape.lineTo(0, rise + 0.02);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(sx * (W / 2) - 0.08, top, 0);
    boxUV(g, 1 / 1.8);
    b.add(material === 'plaster' ? 'plaster' : material, g, undefined, { tint });
  }
}

/** Generic two-storey-feel townhouse with shop front options. */
export function buildTownHouse(rng: Rng, s: HouseSpec): BuiltProp {
  const b = new MeshBuilder();
  const { w: W, d: D, wallH } = s;
  const baseH = 0.35;
  const top = baseH + wallH;
  const trim = s.trimTint ?? TRIM;
  const wallMat = s.wall === 'plaster' ? 'plaster' : s.wall;
  b.add('stone', boxUV(roundedBox(W + 0.25, baseH, D + 0.25, 0.06), 0.7), mat(0, baseH / 2, 0), { aoWorld: groundAO(0.3) });
  b.add(wallMat, boxUV(roundedBox(W, wallH, D, 0.05), 1 / 1.8), mat(0, baseH + wallH / 2, 0), {
    tint: s.wallTint,
    aoWorld: (p) => 0.74 + 0.26 * THREE.MathUtils.smoothstep(p.y, baseH, baseH + 0.9),
  });
  // Timber frame accents on plaster
  if (s.wall === 'plaster') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodDark', roundedBox(0.2, wallH + 0.06, 0.2, 0.04), mat((sx * W) / 2, baseH + wallH / 2, (sz * D) / 2));
    b.add('woodDark', roundedBox(W + 0.12, 0.14, D + 0.12, 0.04), mat(0, baseH + wallH * 0.52, 0));
    for (let i = 1; i < 4; i++) b.add('woodDark', roundedBox(0.12, wallH * 0.46, 0.06, 0.02), mat(-W / 2 + (i * W) / 4, baseH + wallH * 0.76, D / 2 + 0.02, 0, 0, (i % 2 ? 1 : -1) * 0.5));
  }
  b.add('woodDark', roundedBox(W + 0.16, 0.16, D + 0.16, 0.05), mat(0, top - 0.04, 0));
  const rise = Math.max(1.4, D * 0.42);
  const roofMat = s.roof ?? 'roofTile';
  const ridgeY = gableRoof(b, W, D, top, rise, 0.45, s.roofTint, roofMat);
  gableEnds(b, W, D, top, rise, s.wall, s.wallTint);

  // Front: door + windows
  const fz = D / 2;
  const dx = (s.doorX ?? 0) * (W / 2 - 1.0);
  b.add('woodPaint', roundedBox(1.15, 2.05, 0.12, 0.04), mat(dx, baseH + 1.0, fz + 0.02), { tint: trim });
  b.add('wood', boxUV(roundedBox(0.88, 1.85, 0.1, 0.03), 1 / 1.1), mat(dx, baseH + 0.95, fz + 0.07), { tint: s.doorTint });
  b.add('glass', roundedBox(0.44, 0.34, 0.04, 0.02), mat(dx, baseH + 1.5, fz + 0.12));
  b.add('metal', new THREE.SphereGeometry(0.045, 10, 8), mat(dx + 0.3, baseH + 0.92, fz + 0.15), { tint: 0xc9a44a });
  b.add('stone', roundedBox(1.3, 0.14, 0.5, 0.04), mat(dx, 0.07, fz + 0.3), { tint: 0xc9c0b0 });
  lantern(b, dx + 0.78, baseH + 1.7, fz + 0.2, 0.95);
  const winXs: number[] = [];
  for (let x = -W / 2 + 1.1; x <= W / 2 - 1.0; x += 1.7) if (Math.abs(x - dx) > 1.2) winXs.push(x);
  for (const wx of winXs) {
    const wb = new MeshBuilder();
    windowUnit(wb, s.awning ? 1.3 : 0.95, s.awning ? 1.1 : 0.95, !s.awning && !!s.shutterTint, !!s.flowerBoxes, rng);
    b.addBuilder(wb, mat(wx, baseH + 1.35, fz + 0.03));
  }
  // Upper floor windows
  for (const wx of [-W / 4, W / 4]) {
    const wb = new MeshBuilder();
    windowUnit(wb, 0.7, 0.75, !!s.shutterTint, false, rng);
    b.addBuilder(wb, mat(wx, baseH + wallH * 0.78, fz + 0.03));
  }
  // Striped shop awning
  if (s.awning) {
    const aw = W - 0.4;
    const n = Math.round(aw / 0.36);
    for (let i = 0; i < n; i++) {
      const x = -aw / 2 + (i + 0.5) * (aw / n);
      b.add('cloth', roundedBox(aw / n + 0.01, 0.05, 1.05, 0.02), mat(x, baseH + 2.25, fz + 0.5, 0.42, 0, 0), { tint: i % 2 ? s.awning[1] : s.awning[0] });
      // Scalloped valance
      const sc = new THREE.CylinderGeometry(aw / n / 2, aw / n / 2, 0.04, 10, 1, false, 0, Math.PI);
      sc.rotateX(Math.PI / 2);
      b.add('cloth', sc, mat(x, baseH + 1.98, fz + 0.97, 0, 0, Math.PI), { tint: i % 2 ? s.awning[1] : s.awning[0] });
    }
    for (const sx of [-1, 1]) b.add('metal', new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), mat(sx * (aw / 2), baseH + 2.2, fz + 0.5, Math.PI / 2 - 0.42, 0, 0), { tint: 0x3a3a3a });
  }
  // Hanging sign on a bracket
  if (s.sign && s.sign !== 'none') {
    const sx = dx - 0.95;
    b.add('metal', roundedBox(0.6, 0.04, 0.04, 0.01), mat(sx, baseH + 2.45, fz + 0.3), { tint: 0x2e2a28 });
    b.add('metal', roundedBox(0.04, 0.04, 0.5, 0.01), mat(sx - 0.25, baseH + 2.45, fz + 0.25), { tint: 0x2e2a28 });
    b.add('woodPaint', roundedBox(0.06, 0.62, 0.62, 0.05), mat(sx + 0.15, baseH + 2.05, fz + 0.4), { tint: 0xf2e2c0 });
    b.add('woodDark', roundedBox(0.07, 0.68, 0.68, 0.05), mat(sx + 0.145, baseH + 2.05, fz + 0.4), { tint: 0x7a5234 });
    // Painted icon on both faces
    for (const side of [-1, 1]) {
      const ix = sx + 0.15 + side * 0.035;
      if (s.sign === 'store') {
        // Seed sack with a sprout
        b.add('white', lumpySphere(0.16, 1, 0.1, rng), mat(ix, baseH + 1.98, fz + 0.4, 0, 0, 0, 0.2, 1.1, 0.9), { tint: 0xc89858 });
        b.add('white', roundedBox(0.04, 0.12, 0.03, 0.01), mat(ix, baseH + 2.2, fz + 0.4), { tint: 0x5a9a3a });
        b.add('white', lumpySphere(0.06, 1, 0.2, rng), mat(ix, baseH + 2.3, fz + 0.36, 0, 0, 0, 0.3, 0.6, 1), { tint: 0x6fb04a });
      } else {
        // Loaf of bread
        const loaf = new THREE.CapsuleGeometry(0.1, 0.18, 4, 10);
        loaf.rotateX(Math.PI / 2);
        b.add('white', loaf, mat(ix, baseH + 2.03, fz + 0.4, 0, 0, 0, 0.3, 0.8, 1), { tint: 0xd89048 });
        for (let k = -1; k <= 1; k++) b.add('white', roundedBox(0.02, 0.03, 0.1, 0.01), mat(ix + side * 0.02, baseH + 2.1, fz + 0.4 + k * 0.08, 0, 0, 0), { tint: 0xf2d8a0 });
      }
    }
  }
  if (s.chimney) {
    const chX = W / 2 - 0.8;
    const chTop = ridgeY + 0.7;
    b.add('stone', boxUV(roundedBox(0.7, chTop - top + 0.4, 0.75, 0.05), 0.9), mat(chX, (chTop + top - 0.4) / 2, -D / 4), { tint: 0xc0b0a0 });
    b.add('stone', roundedBox(0.85, 0.16, 0.9, 0.04), mat(chX, chTop, -D / 4), { tint: 0xd0c8bc });
  }
  // Side windows
  for (const sxx of [-1, 1]) {
    const wb = new MeshBuilder();
    windowUnit(wb, 0.7, 0.8, false, false, rng);
    b.addBuilder(wb, mat(sxx * (W / 2 + 0.03), baseH + 1.4, 0, 0, sxx * (Math.PI / 2), 0));
  }
  const group = b.build({ name: 'townhouse' });
  const lights: { light: THREE.PointLight; max: number }[] = [];
  const l = new THREE.PointLight(0xffb867, 0, 6, 2);
  l.position.set(dx + 0.78, baseH + 1.7, fz + 0.7);
  group.add(l);
  lights.push({ light: l, max: 7 });
  return {
    group,
    lights,
    anchors: {
      chimney: new THREE.Vector3(W / 2 - 0.8, ridgeY + 0.9, -D / 4),
      door: new THREE.Vector3(dx, 0, fz + 0.8),
    },
  };
}

/**
 * The Lantern Hall: the town's heart, gone dark. Stone hall with tall arched (unlit) windows,
 * double doors, a bell tower with an open belfry, and a great iron lantern over the door that
 * the player's quest will relight.
 */
export function buildLanternHall(rng: Rng): BuiltProp {
  const b = new MeshBuilder();
  const W = 10;
  const D = 6.4;
  const baseH = 0.6;
  const wallH = 3.8;
  const top = baseH + wallH;
  b.add('stone', boxUV(roundedBox(W + 0.4, baseH, D + 0.4, 0.08), 0.6), mat(0, baseH / 2, 0), { tint: 0xb8b0a4, aoWorld: groundAO(0.4) });
  b.add('stone', boxUV(roundedBox(W, wallH, D, 0.06), 0.55), mat(0, baseH + wallH / 2, 0), {
    tint: 0xd8cfc0,
    aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, baseH, baseH + 1.2),
  });
  // Buttresses
  for (const x of [-W / 2, -W / 6, W / 6, W / 2]) b.add('stone', boxUV(roundedBox(0.45, wallH + 0.2, 0.55, 0.06), 0.7), mat(x, baseH + wallH / 2 - 0.1, D / 2 + 0.12), { tint: 0xc8bfb0 });
  b.add('woodDark', roundedBox(W + 0.2, 0.2, D + 0.2, 0.05), mat(0, top, 0));
  const ridgeY = gableRoof(b, W, D, top + 0.05, 2.6, 0.5, 0x7d8ea8, 'roofTile');
  gableEnds(b, W, D, top + 0.05, 2.6, 'stone', 0xd8cfc0);
  const fz = D / 2;
  // Tall arched windows (dark: the hall hasn't been lit in years)
  for (const x of [-W / 3, W / 3]) {
    b.add('woodPaint', roundedBox(1.25, 2.3, 0.14, 0.05), mat(x, baseH + 1.9, fz + 0.03), { tint: 0xe8e0d0 });
    b.add('white', roundedBox(1.0, 2.05, 0.06, 0.03), mat(x, baseH + 1.85, fz + 0.08), { tint: 0x2a3444 });
    const arch = new THREE.CylinderGeometry(0.62, 0.62, 0.14, 16, 1, false, 0, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(Math.PI / 2);
    b.add('woodPaint', arch, mat(x, baseH + 3.05, fz + 0.03, 0, 0, 0), { tint: 0xe8e0d0 });
    const archG = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16, 1, false, 0, Math.PI);
    archG.rotateX(Math.PI / 2);
    archG.rotateZ(Math.PI / 2);
    b.add('white', archG, mat(x, baseH + 2.95, fz + 0.08), { tint: 0x2a3444 });
    // Lead cames
    b.add('metal', roundedBox(0.04, 2.5, 0.03, 0.01), mat(x, baseH + 2.1, fz + 0.12), { tint: 0x3a3632 });
    for (let i = 0; i < 4; i++) b.add('metal', roundedBox(1.0, 0.03, 0.03, 0.01), mat(x, baseH + 1.1 + i * 0.55, fz + 0.12), { tint: 0x3a3632 });
  }
  // Double doors with iron straps under a stone arch
  b.add('stone', boxUV(roundedBox(2.4, 3.1, 0.3, 0.08), 0.7), mat(0, baseH + 1.5, fz + 0.1), { tint: 0xc0b6a6 });
  for (const sx of [-1, 1]) {
    b.add('wood', boxUV(roundedBox(0.92, 2.5, 0.12, 0.03), 1 / 1.2), mat(sx * 0.48, baseH + 1.25, fz + 0.24), { tint: 0x6a4a34 });
    for (const y of [0.5, 1.4, 2.2]) b.add('metal', roundedBox(0.8, 0.07, 0.03, 0.01), mat(sx * 0.48, baseH + y, fz + 0.31), { tint: 0x2e2a28 });
  }
  const doorArch = new THREE.CylinderGeometry(0.96, 0.96, 0.14, 18, 1, false, 0, Math.PI);
  doorArch.rotateX(Math.PI / 2);
  doorArch.rotateZ(Math.PI / 2);
  b.add('wood', doorArch, mat(0, baseH + 2.5, fz + 0.24), { tint: 0x5e4230 });
  // Steps
  for (let i = 0; i < 3; i++) b.add('stone', boxUV(roundedBox(3.2 - i * 0.3, 0.2, 0.45, 0.04), 0.8), mat(0, baseH - 0.1 - i * 0.2, fz + 0.45 + i * 0.4), { tint: 0xc8c0b2 });
  // Great lantern (unlit, hanging from a bracket)
  b.add('metal', roundedBox(0.08, 0.08, 0.9, 0.02), mat(0, baseH + 3.55, fz + 0.5), { tint: 0x2e2a28 });
  b.add('metal', new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5), mat(0, baseH + 3.38, fz + 0.9), { tint: 0x2e2a28 });
  b.add('metal', new THREE.ConeGeometry(0.34, 0.26, 6), mat(0, baseH + 3.12, fz + 0.9), { tint: 0x2e2a28 });
  b.add('white', new THREE.CylinderGeometry(0.2, 0.24, 0.5, 6), mat(0, baseH + 2.75, fz + 0.9), { tint: 0x3a4250 });
  b.add('metal', new THREE.CylinderGeometry(0.28, 0.22, 0.08, 6), mat(0, baseH + 2.47, fz + 0.9), { tint: 0x2e2a28 });
  // Bell tower on the left gable
  const tx = -W / 2 + 1.3;
  const tH = ridgeY + 2.6;
  b.add('stone', boxUV(roundedBox(1.9, tH - baseH, 1.9, 0.06), 0.6), mat(tx, baseH + (tH - baseH) / 2, fz - 1.2), { tint: 0xd2c8b8 });
  // Open belfry: 4 posts + bell
  const by = tH;
  for (const [px, pz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) b.add('woodPaint', roundedBox(0.18, 1.3, 0.18, 0.04), mat(tx + px, by + 0.65, fz - 1.2 + pz), { tint: 0xf0e8da });
  b.add('woodPaint', roundedBox(2.0, 0.14, 2.0, 0.04), mat(tx, by + 1.32, fz - 1.2), { tint: 0xf0e8da });
  const bell = new THREE.LatheGeometry([new THREE.Vector2(0, 0.5), new THREE.Vector2(0.14, 0.48), new THREE.Vector2(0.2, 0.3), new THREE.Vector2(0.26, 0.06), new THREE.Vector2(0.34, 0), new THREE.Vector2(0.3, 0.04), new THREE.Vector2(0, 0.06)], 16);
  b.add('metal', bell, mat(tx, by + 0.6, fz - 1.2), { tint: 0xc8a050 });
  const spire = new THREE.ConeGeometry(1.5, 2.2, 4);
  b.add('roofTile', spire, mat(tx, by + 2.45, fz - 1.2, 0, Math.PI / 4, 0), { tint: 0x7d8ea8 });
  b.add('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5), mat(tx, by + 3.8, fz - 1.2), { tint: 0xc8a050 });
  b.add('metal', new THREE.SphereGeometry(0.08, 8, 6), mat(tx, by + 4.15, fz - 1.2), { tint: 0xc8a050 });
  // Ivy creeping up the right corner (unkempt)
  for (let i = 0; i < 70; i++) {
    const t = rng.next();
    const x = W / 2 - 0.1 + (rng.next() - 0.2) * 0.3;
    const y = baseH + t * wallH * 0.95;
    const z = fz + 0.12 - rng.next() * 1.8 * (1 - t);
    const leaf = new THREE.IcosahedronGeometry(0.12 + rng.next() * 0.06, 0);
    leaf.scale(1, 0.8, 0.4);
    b.add('white', leaf, mat(x + 0.12, y, z, 0, Math.PI / 2, rng.next() * 3), { tint: rng.next() < 0.5 ? 0x3f7a2e : 0x5a9a3a });
  }
  const group = b.build({ name: 'lantern-hall' });
  return { group, lights: [], anchors: { door: new THREE.Vector3(0, 0, fz + 1.8), lantern: new THREE.Vector3(0, baseH + 2.75, fz + 0.9) } };
}

/** Plaza fountain: stone basin, tiered bowl, water sheet (animated by the water material elsewhere). */
export function buildFountain(rng: Rng): BuiltProp {
  const b = new MeshBuilder();
  const rim = new THREE.TorusGeometry(2.0, 0.22, 10, 40);
  rim.rotateX(Math.PI / 2);
  b.add('stone', rim, mat(0, 0.45, 0), { tint: 0xd8d0c2 });
  const wall = new THREE.CylinderGeometry(2.05, 2.15, 0.5, 40, 1, true);
  uvScale(wall, 6, 0.6);
  b.add('stone', wall, mat(0, 0.25, 0), { tint: 0xc8c0b2, aoWorld: groundAO(0.3, 0.55) });
  b.add('stillWater', new THREE.CircleGeometry(1.95, 40).rotateX(-Math.PI / 2), mat(0, 0.36, 0));
  b.add('stone', bevelCylinder(0.35, 0.45, 1.2, 0.06, 16), mat(0, 0.3, 0), { tint: 0xd0c8ba });
  const bowl = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.9, 0.05), new THREE.Vector2(1.0, 0.28), new THREE.Vector2(0.9, 0.3), new THREE.Vector2(0, 0.18)], 32);
  b.add('stone', bowl, mat(0, 1.5, 0), { tint: 0xe0d8ca });
  b.add('stillWater', new THREE.CircleGeometry(0.85, 32).rotateX(-Math.PI / 2), mat(0, 1.74, 0));
  b.add('stone', bevelCylinder(0.12, 0.18, 0.6, 0.04, 12), mat(0, 1.7, 0), { tint: 0xd0c8ba });
  b.add('stone', new THREE.SphereGeometry(0.2, 14, 10), mat(0, 2.4, 0), { tint: 0xe8e0d2 });
  // Moss / lily flowers in the basin
  for (let i = 0; i < 6; i++) {
    const a = rng.next() * Math.PI * 2;
    const pad = new THREE.CircleGeometry(0.18 + rng.next() * 0.08, 10);
    pad.rotateX(-Math.PI / 2);
    b.add('white', pad, mat(Math.cos(a) * 1.4, 0.37, Math.sin(a) * 1.4), { tint: 0x4f9a3a });
  }
  const group = b.build({ name: 'fountain' });
  return { group, lights: [], anchors: { spout: new THREE.Vector3(0, 2.4, 0) } };
}

/** Notice board with pinned flyers (story hook: "Relight the Lantern Hall!"). */
export function buildNoticeBoard(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.14, 2.1, 0.14, 0.04), mat(sx * 0.85, 1.05, 0), { tint: 0xa87a50, aoWorld: groundAO(0.4) });
  b.add('wood', boxUV(roundedBox(1.9, 1.15, 0.1, 0.04), 1 / 1.2), mat(0, 1.35, 0), { tint: 0xc89a64 });
  const roof = roundedBox(2.2, 0.08, 0.55, 0.02);
  for (const s of [-1, 1]) b.add('roof', roof.clone(), mat(0, 2.08, s * 0.12, s * 0.5, 0, 0), { tint: 0xb87258 });
  const papers = [0xfbf4e2, 0xf6e7c4, 0xf9f0dc, 0xe8f0f8, 0xfbeede];
  for (let i = 0; i < 5; i++) {
    const w = 0.34 + rng.next() * 0.16;
    const h = 0.42 + rng.next() * 0.14;
    const x = -0.62 + i * 0.31 + (rng.next() - 0.5) * 0.08;
    const y = 1.35 + (rng.next() - 0.5) * 0.3;
    b.add('white', roundedBox(w, h, 0.01, 0.005, 1), mat(x, y, 0.06, 0, 0, (rng.next() - 0.5) * 0.15), { tint: papers[i]! });
    b.add('white', new THREE.SphereGeometry(0.02, 6, 4), mat(x, y + h / 2 - 0.04, 0.075), { tint: 0xd8412f });
  }
  // The big lantern flyer: a golden lantern drawing in the middle
  b.add('white', roundedBox(0.5, 0.62, 0.012, 0.005, 1), mat(0.05, 1.38, 0.07), { tint: 0xfff4d8 });
  b.add('white', new THREE.CylinderGeometry(0.08, 0.1, 0.18, 6).rotateX(Math.PI / 2), mat(0.05, 1.4, 0.085, 0, 0, 0), { tint: 0xf2b43a });
  b.add('white', new THREE.ConeGeometry(0.12, 0.08, 6).rotateX(Math.PI / 2), mat(0.05, 1.52, 0.085), { tint: 0x5a3a1e });
  return b.build({ name: 'notice-board' });
}

/** Market stall: counter, striped canopy on poles, crates of produce, a chalk price board. */
export function buildMarketStall(rng: Rng, stripes: [number, number] = [0x3f8f7a, 0xf4ecd8]): THREE.Group {
  const b = new MeshBuilder();
  const W = 2.6;
  b.add('wood', boxUV(roundedBox(W, 0.9, 0.9, 0.04), 1 / 1.2), mat(0, 0.45, 0), { tint: 0xc89a64, aoWorld: groundAO(0.3) });
  b.add('woodGrain', roundedBox(W + 0.2, 0.08, 1.05, 0.03), mat(0, 0.94, 0.02), { tint: 0xd8b48a });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.09, 2.3, 0.09, 0.03), mat(sx * (W / 2 + 0.05), 1.15, sz * 0.5), { tint: 0xa87a50 });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 - 0.15 + (i + 0.5) * ((W + 0.3) / n);
    b.add('cloth', roundedBox((W + 0.3) / n + 0.01, 0.04, 1.4, 0.015), mat(x, 2.36, 0.05, 0.22, 0, 0), { tint: stripes[i % 2]! });
    const sc = new THREE.CylinderGeometry((W + 0.3) / n / 2, (W + 0.3) / n / 2, 0.035, 10, 1, false, 0, Math.PI);
    sc.rotateX(Math.PI / 2);
    b.add('cloth', sc, mat(x, 2.15, 0.74, 0, 0, Math.PI), { tint: stripes[i % 2]! });
  }
  // Produce crates on the counter
  const produce = [0xe4432e, 0xf2c43a, 0x6fae45, 0xe8741e, 0x8a4ab0];
  for (let c = 0; c < 4; c++) {
    const cx = -0.95 + c * 0.63;
    b.add('wood', boxUV(roundedBox(0.52, 0.2, 0.5, 0.02), 1.4), mat(cx, 1.08, 0.08, -0.25, 0, 0), { tint: 0xe0b484 });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.SphereGeometry(0.075, 8, 6);
      b.add('white', g, mat(cx - 0.14 + (i % 3) * 0.14, 1.2 + (i < 3 ? 0.03 : -0.02), 0.0 + Math.floor(i / 3) * 0.16, 0, 0, 0), { tint: produce[c]! });
    }
  }
  // Chalk board sign leaning on the stall
  b.add('woodDark', roundedBox(0.6, 0.8, 0.05, 0.02), mat(W / 2 + 0.35, 0.42, 0.55, -0.2, -0.4, 0));
  b.add('white', roundedBox(0.5, 0.66, 0.02, 0.01), mat(W / 2 + 0.36, 0.43, 0.58, -0.2, -0.4, 0), { tint: 0x2e3a32 });
  for (let i = 0; i < 3; i++) b.add('white', roundedBox(0.3, 0.025, 0.01, 0.005, 1), mat(W / 2 + 0.36, 0.6 - i * 0.14, 0.595 - i * 0.03, -0.2, -0.4, 0), { tint: 0xf0f0e0 });
  return b.build({ name: 'market-stall' });
}

/** Stone planter with a flower mound. */
export function buildPlanter(rng: Rng, colors: number[]): THREE.Group {
  const b = new MeshBuilder();
  b.add('stone', boxUV(roundedBox(1.3, 0.5, 0.7, 0.06), 1), mat(0, 0.25, 0), { tint: 0xd0c8ba, aoWorld: groundAO(0.25) });
  b.add('white', roundedBox(1.2, 0.06, 0.6, 0.02), mat(0, 0.5, 0), { tint: 0x4a3222 });
  for (let i = 0; i < 6; i++) {
    const leaf = lumpySphere(0.2, 1, 0.25, rng);
    sphericalNormals(leaf, new THREE.Vector3(), 0.5);
    b.add('boxFlower', leaf, mat(-0.45 + i * 0.18, 0.62, (rng.next() - 0.5) * 0.2), { tint: 0x4f9a3a });
  }
  for (let i = 0; i < 12; i++) {
    const fl = new THREE.SphereGeometry(0.06, 6, 5);
    b.add('boxFlower', fl, mat(-0.5 + rng.next() * 1.0, 0.72 + rng.next() * 0.1, (rng.next() - 0.5) * 0.4), { tint: colors[i % colors.length]! });
  }
  return b.build({ name: 'planter' });
}

/** Clipped box hedge segment. */
export function buildHedge(rng: Rng, length: number): THREE.Group {
  const b = new MeshBuilder();
  const n = Math.max(2, Math.round(length / 0.55));
  for (let i = 0; i < n; i++) {
    const g = lumpySphere(0.42, 1, 0.12, rng, 2.5);
    sphericalNormals(g, new THREE.Vector3(), 0.4);
    g.scale(1.1, 0.95, 0.9);
    b.add('boxFlower', g, mat(-length / 2 + (i + 0.5) * (length / n), 0.4, 0), { tint: i % 2 ? 0x3f7a2e : 0x4a8a34, aoWorld: groundAO(0.4, 0.55) });
  }
  return b.build({ name: 'hedge' });
}

/** Festival string: bunting flags + paper lanterns (emissive at night) along a sagging line. */
export function buildFestivalString(rng: Rng, a: THREE.Vector3, bPt: THREE.Vector3): THREE.Group {
  const b = new MeshBuilder();
  const n = Math.max(4, Math.round(a.distanceTo(bPt) / 0.55));
  const colors = [0xe8674a, 0xf5c542, 0x5fa8d3, 0x8fce6a, 0xf29ac0];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(bPt, t);
    p.y -= Math.sin(t * Math.PI) * 0.7;
    if (i < n) {
      const q = a.clone().lerp(bPt, (i + 1) / n);
      q.y -= Math.sin(((i + 1) / n) * Math.PI) * 0.7;
      const d = q.clone().sub(p);
      const L = d.length();
      const cord = new THREE.CylinderGeometry(0.008, 0.008, L, 3);
      cord.rotateZ(Math.PI / 2);
      b.add('white', cord, mat((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2, 0, -Math.atan2(d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z))), { tint: 0x4a3a2a });
    }
    if (i % 3 === 1) {
      const lan = lumpySphere(0.13, 1, 0.05, rng, 2);
      lan.scale(1, 1.2, 1);
      b.add('paperLantern', lan, mat(p.x, p.y - 0.22, p.z), { tint: [0xff9a50, 0xffc860, 0xff7060][i % 3]! });
    } else if (i > 0 && i < n) {
      const tri = new THREE.ConeGeometry(0.12, 0.26, 3);
      tri.rotateX(Math.PI);
      b.add('cloth', tri, mat(p.x, p.y - 0.14, p.z, 0, rng.next(), 0, 1, 1, 0.2), { tint: colors[i % colors.length]! });
    }
  }
  return b.build({ name: 'festival-string' });
}
