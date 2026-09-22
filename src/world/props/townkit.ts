/**
 * Town kit: parameterised townhouses (general store, bakery, cottages), the dark Lantern Hall
 * with its bell tower, the plaza fountain, notice board, market stall, planters, hedges.
 * (Festival dressing lives in festival.ts.) Same conventions as structures.ts (MeshBuilder per
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

/** One tall arched hall window (built facing +Z, centred at x / y on the facade plane fz). */
function hallWindow(b: MeshBuilder, x: number, y: number, fz: number, rng: Rng): void {
  const w = 1.0;
  const h = 2.05;
  const archY = y + h / 2 + 0.05;
  // Stone surround + painted frame
  b.add('stone', boxUV(roundedBox(1.5, 2.55, 0.16, 0.05), 0.8), mat(x, y + 0.03, fz + 0.02), { tint: 0xc8bfae });
  const archS = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 18, 1, false, 0, Math.PI);
  archS.rotateX(Math.PI / 2);
  archS.rotateZ(Math.PI / 2);
  b.add('stone', archS, mat(x, archY + 0.05, fz + 0.02), { tint: 0xc8bfae });
  b.add('woodPaint', roundedBox(1.18, 2.22, 0.12, 0.04), mat(x, y, fz + 0.05), { tint: 0xe8e0d0 });
  const arch = new THREE.CylinderGeometry(0.6, 0.6, 0.12, 16, 1, false, 0, Math.PI);
  arch.rotateX(Math.PI / 2);
  arch.rotateZ(Math.PI / 2);
  b.add('woodPaint', arch, mat(x, archY, fz + 0.05), { tint: 0xe8e0d0 });
  // Interior card (rect + half-disc)
  const card = new THREE.PlaneGeometry(w, h);
  b.add('windowCard', card, mat(x, y, fz + 0.115));
  const cap = new THREE.CircleGeometry(w / 2, 16, 0, Math.PI);
  b.add('windowCard', cap, mat(x, archY - 0.05, fz + 0.115));
  // Curtains, gathered to the sides with tie-backs
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const fold = new THREE.CylinderGeometry(0.055, 0.075, h * 0.95, 6, 1, false, 0, Math.PI);
      b.add('cloth', fold, mat(x + sx * (w / 2 - 0.08 - k * 0.07), y + 0.02, fz + 0.13, 0, Math.PI, sx * 0.04), { tint: k === 1 ? 0x8e2a32 : 0xa8323a });
    }
    b.add('metal', roundedBox(0.05, 0.05, 0.04, 0.01), mat(x + sx * (w / 2 - 0.15), y - 0.15, fz + 0.2), { tint: 0xd8b060 });
  }
  b.add('cloth', roundedBox(w + 0.02, 0.18, 0.06, 0.03), mat(x, archY - 0.1, fz + 0.14), { tint: 0x8e2a32 });
  // Mullion cross (wood) + leaded cames
  b.add('woodPaint', roundedBox(0.07, h + 0.4, 0.06, 0.02), mat(x, y + 0.18, fz + 0.16), { tint: 0xe8e0d0 });
  b.add('woodPaint', roundedBox(w, 0.07, 0.06, 0.02), mat(x, y + 0.3, fz + 0.16), { tint: 0xe8e0d0 });
  for (const yy of [-0.55, -0.12]) b.add('metal', roundedBox(w, 0.025, 0.03, 0.008), mat(x, y + yy, fz + 0.15), { tint: 0x3a3632 });
  for (const xx of [-0.25, 0.25]) b.add('metal', roundedBox(0.025, h, 0.03, 0.008), mat(x + xx, y, fz + 0.15), { tint: 0x3a3632 });
  // Shutters (louvred, painted teal) folded open against the stone
  for (const sx of [-1, 1]) {
    const shx = x + sx * 1.0;
    b.add('woodGrain', roundedBox(0.44, h + 0.1, 0.06, 0.02), mat(shx, y, fz + 0.06), { tint: 0x4f8f86 });
    for (let k = -4; k <= 4; k++) b.add('woodGrain', roundedBox(0.36, 0.035, 0.05, 0.01), mat(shx, y + k * (h / 10), fz + 0.1, -0.3, 0, 0), { tint: 0x3f7a70 });
    b.add('metal', roundedBox(0.1, 0.03, 0.03, 0.01), mat(shx - sx * 0.2, y + 0.6, fz + 0.1), { tint: 0x2e2a28 });
  }
  // Sill + flower box
  b.add('stone', roundedBox(1.46, 0.12, 0.34, 0.04), mat(x, y - h / 2 - 0.08, fz + 0.15), { tint: 0xd8d0c2 });
  const by = y - h / 2 - 0.32;
  b.add('woodDark', roundedBox(1.3, 0.3, 0.3, 0.04), mat(x, by, fz + 0.28));
  b.add('white', roundedBox(1.2, 0.04, 0.22, 0.02), mat(x, by + 0.15, fz + 0.28), { tint: 0x4a3222 });
  const colors = [0xff7aa2, 0xffd166, 0xf25f5c, 0xc77dff, 0xffffff];
  for (let i = 0; i < 11; i++) {
    const fx = x - 0.55 + (i / 10) * 1.1;
    b.add('boxFlower', lumpySphere(0.12, 1, 0.25, rng), mat(fx, by + 0.22, fz + 0.28 + (rng.next() - 0.5) * 0.08), { tint: 0x4f9a3a });
    if (i % 2 === 0) b.add('boxFlower', new THREE.SphereGeometry(0.065, 6, 5), mat(fx + 0.03, by + 0.33, fz + 0.36), { tint: colors[(i / 2) % colors.length]! });
  }
  // Trailing ivy spilling from the box
  for (let i = 0; i < 6; i++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.06, 0), mat(x - 0.5 + i * 0.2, by - 0.18 - rng.next() * 0.25, fz + 0.44), { tint: 0x3f7a2e });
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
  // Tall arched windows: stone surround, lamp-lit interior card (warm from late afternoon), drawn-back
  // curtains, a wooden mullion cross + leaded cames, painted shutters and a sill flower box.
  for (const x of [-W / 3, W / 3]) hallWindow(b, x, baseH + 1.85, fz, rng);
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
  // Wreath on the doors: a ring of leafy lumps, berries and a red ribbon bow.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const leaf = lumpySphere(0.1, 0, 0.2, rng);
    b.add('boxFlower', leaf, mat(Math.cos(a) * 0.3, baseH + 1.75 + Math.sin(a) * 0.3, fz + 0.36, 0, 0, a), { tint: i % 2 ? 0x3f7a2e : 0x4f8a34 });
    if (i % 3 === 0) b.add('white', new THREE.SphereGeometry(0.035, 6, 5), mat(Math.cos(a + 0.2) * 0.3, baseH + 1.75 + Math.sin(a + 0.2) * 0.3, fz + 0.43), { tint: 0xc8242e });
  }
  for (const sx of [-1, 1]) b.add('cloth', new THREE.ConeGeometry(0.09, 0.2, 4), mat(sx * 0.08, baseH + 1.47, fz + 0.42, 0, 0, sx * 1.2), { tint: 0xc0392b });
  b.add('cloth', new THREE.SphereGeometry(0.05, 8, 6), mat(0, baseH + 1.47, fz + 0.43), { tint: 0xa82a24 });
  // Carved sign plaque above the arch: "Lantern Hall", a painted gold lantern between scrolls.
  b.add('woodDark', roundedBox(2.1, 0.5, 0.1, 0.05), mat(0, baseH + 3.62, fz + 0.3), { tint: 0x7a5234 });
  b.add('woodPaint', roundedBox(1.9, 0.36, 0.06, 0.04), mat(0, baseH + 3.62, fz + 0.35), { tint: 0x2f5a4a });
  b.add('metal', new THREE.CylinderGeometry(0.07, 0.09, 0.2, 6).rotateX(Math.PI / 2), mat(0, baseH + 3.6, fz + 0.39), { tint: 0xe8b84a });
  b.add('metal', new THREE.ConeGeometry(0.1, 0.07, 6).rotateX(Math.PI / 2), mat(0, baseH + 3.72, fz + 0.39), { tint: 0xe8b84a });
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) b.add('white', roundedBox(0.14, 0.04, 0.02, 0.01, 1), mat(sx * (0.28 + k * 0.17), baseH + 3.62 + (k % 2 ? 0.04 : -0.04), fz + 0.39), { tint: 0xf2e2b0 });
    // Wall lanterns flanking the doors
    b.add('metal', roundedBox(0.06, 0.06, 0.34, 0.02), mat(sx * 1.45, baseH + 2.35, fz + 0.3), { tint: 0x2e2a28 });
    lantern(b, sx * 1.45, baseH + 2.1, fz + 0.45, 1.15);
  }
  // Steps
  for (let i = 0; i < 3; i++) b.add('stone', boxUV(roundedBox(3.2 - i * 0.3, 0.2, 0.45, 0.04), 0.8), mat(0, baseH - 0.1 - i * 0.2, fz + 0.45 + i * 0.4), { tint: 0xc8c0b2 });
  // Potted bay trees either side of the steps
  for (const sx of [-1, 1]) {
    b.add('soilPot', bevelCylinder(0.24, 0.2, 0.42, 0.03, 12), mat(sx * 1.95, 0, fz + 0.75), { tint: 0xc8704a });
    const top = lumpySphere(0.36, 1, 0.12, rng, 2.4);
    sphericalNormals(top, new THREE.Vector3(), 0.5);
    b.add('boxFlower', top, mat(sx * 1.95, 1.05, fz + 0.75), { tint: 0x3f7a2e });
    b.add('woodDark', roundedBox(0.05, 0.5, 0.05, 0.01), mat(sx * 1.95, 0.62, fz + 0.75));
  }
  // Great lantern (unlit, hanging from a bracket)
  b.add('metal', roundedBox(0.08, 0.08, 0.56, 0.02), mat(0, baseH + 3.55, fz + 0.68), { tint: 0x2e2a28 });
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
  // Ivy climbing the stone: a curtain from the ground up the right corner, a tongue up the left
  // buttress, and tendrils creeping across the facade between the windows.
  const ivyLeaf = (x: number, y: number, z: number, face: 'front' | 'side'): void => {
    const leaf = new THREE.IcosahedronGeometry(0.1 + rng.next() * 0.06, 0);
    leaf.scale(1, 0.85, 0.35);
    const tint = [0x3f7a2e, 0x4f8a34, 0x5a9a3a, 0x2f6a26][Math.floor(rng.next() * 4)]!;
    if (face === 'side') b.add('boxFlower', leaf, mat(x, y, z, 0, Math.PI / 2, rng.next() * 3), { tint });
    else b.add('boxFlower', leaf, mat(x, y, z, 0, 0, rng.next() * 3), { tint });
  };
  for (let i = 0; i < 90; i++) {
    const t = Math.pow(rng.next(), 0.8);
    ivyLeaf(W / 2 + 0.02, baseH + t * wallH * 0.95, fz + 0.1 - rng.next() * 2.2 * (1 - t * 0.7), 'side');
  }
  for (let i = 0; i < 70; i++) {
    const t = Math.pow(rng.next(), 1.2);
    const x = W / 2 - 0.1 - rng.next() * 1.3 * (1 - t);
    ivyLeaf(x, baseH + t * wallH * 0.92, fz + 0.12 + rng.next() * 0.04, 'front');
  }
  for (let i = 0; i < 60; i++) {
    const t = Math.pow(rng.next(), 1.1);
    const x = -W / 2 + 0.05 + rng.next() * 0.9 * (1 - t * 0.6);
    ivyLeaf(x, baseH + t * wallH * 0.85, fz + 0.36 + rng.next() * 0.05, 'front');
  }
  // Tendril across the top of the facade (under the eave)
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const x = -W / 2 + 0.6 + t * (W - 1.2);
    const y = top - 0.35 - Math.abs(Math.sin(t * 9)) * 0.28 - rng.next() * 0.1;
    if (Math.abs(x) < 1.3) continue;
    ivyLeaf(x, y, fz + 0.12, 'front');
  }
  const group = b.build({ name: 'lantern-hall' });
  const l = new THREE.PointLight(0xffb867, 0, 6, 2);
  l.position.set(0, baseH + 2.1, fz + 1.1);
  group.add(l);
  return { group, lights: [{ light: l, max: 7 }], anchors: { door: new THREE.Vector3(0, 0, fz + 1.8), lantern: new THREE.Vector3(0, baseH + 2.75, fz + 0.9) } };
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

/** Flower seller's hand cart: two big wheels, a tilted bed of potted blooms and buckets of stems. */
export function buildFlowerCart(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  b.add('wood', boxUV(roundedBox(1.7, 0.1, 0.95, 0.03), 1.2), mat(0, 0.72, 0, 0, 0, -0.05), { tint: 0x6f9a8a });
  for (const sz of [-1, 1]) b.add('wood', boxUV(roundedBox(1.7, 0.3, 0.07, 0.02), 1.2), mat(0, 0.9, sz * 0.46, 0, 0, -0.05), { tint: 0x5f8a7a });
  for (const sx of [-1, 1]) b.add('wood', boxUV(roundedBox(0.07, 0.3, 0.95, 0.02), 1.2), mat(sx * 0.83, 0.9 - sx * 0.04, 0, 0, 0, -0.05), { tint: 0x5f8a7a });
  for (const sz of [-1, 1]) {
    const wheel = new THREE.TorusGeometry(0.36, 0.045, 6, 18);
    b.add('woodDark', wheel, mat(-0.25, 0.38, sz * 0.54), { tint: 0x7a5234 });
    for (let k = 0; k < 4; k++) b.add('woodDark', roundedBox(0.04, 0.68, 0.03, 0.01), mat(-0.25, 0.38, sz * 0.54, 0, 0, (k / 4) * Math.PI));
  }
  b.add('woodDark', roundedBox(0.06, 0.66, 0.06, 0.02), mat(0.72, 0.36, 0), { tint: 0x7a5234 });
  for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.7, 0.05, 0.05, 0.02), mat(1.15, 0.78, sz * 0.3, 0, 0, 0.25), { tint: 0xa87a50 });
  const blooms = [0xff8fab, 0xffd166, 0xffffff, 0xc77dff, 0xf25f5c, 0x7ec8ff];
  for (let i = 0; i < 8; i++) {
    const x = -0.6 + (i % 4) * 0.4;
    const z = i < 4 ? -0.2 : 0.2;
    b.add('soilPot', bevelCylinder(0.13, 0.1, 0.2, 0.02, 10), mat(x, 0.76 - x * 0.05, z), { tint: 0xc8704a });
    b.add('boxFlower', lumpySphere(0.16, 1, 0.25, rng), mat(x, 1.05 - x * 0.05, z), { tint: 0x4f9a3a });
    for (let k = 0; k < 4; k++) b.add('boxFlower', new THREE.IcosahedronGeometry(0.06, 0), mat(x + (rng.next() - 0.5) * 0.2, 1.14 - x * 0.05 + rng.next() * 0.06, z + (rng.next() - 0.5) * 0.2), { tint: blooms[(i + k) % blooms.length]! });
  }
  return b.build({ name: 'flower-cart' });
}

/** Café set outside the bakery: round table, two chairs, a striped parasol, a teapot and cake. */
export function buildCafeSet(): THREE.Group {
  const b = new MeshBuilder();
  b.add('metal', bevelCylinder(0.05, 0.05, 0.72, 0.01, 8), mat(0, 0, 0), { tint: 0x2e2a28 });
  b.add('metal', bevelCylinder(0.26, 0.3, 0.04, 0.01, 12), mat(0, 0, 0), { tint: 0x2e2a28 });
  b.add('woodPaint', bevelCylinder(0.46, 0.46, 0.05, 0.02, 20), mat(0, 0.72, 0), { tint: 0xf2ead8 });
  for (const sx of [-1, 1]) {
    const cx = sx * 0.72;
    b.add('woodPaint', roundedBox(0.42, 0.05, 0.42, 0.02), mat(cx, 0.46, 0), { tint: 0x4f8f86 });
    b.add('woodPaint', roundedBox(0.05, 0.5, 0.42, 0.02), mat(cx + sx * 0.2, 0.72, 0), { tint: 0x4f8f86 });
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] as const) b.add('metal', roundedBox(0.03, 0.46, 0.03, 0.01), mat(cx + lx, 0.23, lz), { tint: 0x2e2a28 });
  }
  b.add('woodGrain', bevelCylinder(0.025, 0.025, 2.2, 0.01, 6), mat(0, 0.72, 0), { tint: 0xa87a50 });
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const g = new THREE.ConeGeometry(1.15, 0.45, 3, 1, true, a, (Math.PI * 2) / n);
    b.add('cloth', g, mat(0, 2.72, 0), { tint: i % 2 ? 0xf6ecd8 : 0xe8b64a });
  }
  const pot = new THREE.SphereGeometry(0.09, 12, 8);
  pot.scale(1, 0.85, 1);
  b.add('white', pot, mat(-0.12, 0.84, 0.05), { tint: 0xf4f0e8 });
  b.add('white', new THREE.CylinderGeometry(0.1, 0.09, 0.07, 14), mat(0.15, 0.79, -0.05), { tint: 0xf8e8d8 });
  b.add('white', new THREE.CylinderGeometry(0.1, 0.1, 0.015, 14), mat(0.15, 0.83, -0.05), { tint: 0xf29ac0 });
  return b.build({ name: 'cafe-set' });
}

/** A-frame chalk sign ("Fresh bread!", "Seeds in!"). */
export function buildSandwichBoard(tint = 0x2e3a32): THREE.Group {
  const b = new MeshBuilder();
  for (const s of [-1, 1]) {
    b.add('woodDark', roundedBox(0.56, 0.84, 0.05, 0.02), mat(0, 0.42, s * 0.14, s * 0.18, 0, 0), { tint: 0x7a5234 });
    b.add('white', roundedBox(0.46, 0.64, 0.02, 0.01), mat(0, 0.46, s * 0.175, s * 0.18, 0, 0), { tint });
    for (let i = 0; i < 3; i++) b.add('white', roundedBox(0.3 - i * 0.05, 0.03, 0.01, 0.005, 1), mat(0, 0.66 - i * 0.14, s * (0.19 - i * 0.025), s * 0.18, 0, 0), { tint: [0xf0f0e0, 0xffd166, 0xff8fab][i]! });
  }
  return b.build({ name: 'sandwich-board' });
}
