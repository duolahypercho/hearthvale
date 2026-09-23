/**
 * Outdoor farm buildings (hero props, merged per material by MeshBuilder):
 *   coop            red board-and-batten henhouse on a stone plinth, dutch door, pop-hole + ramp,
 *                   side nest box, flower box, rooster weathervane
 *   barn            classic gambrel barn: big sliding X-brace doors, hay-loft door + hoist beam,
 *                   white fascia trim, louvred cupola with a cow weathervane
 *   construction    staked + strung footprint, lumber stack, stone pile, sawhorse, plan sign
 *   carpenter board a little roofed notice board with pinned blueprints (opens the build menu)
 *   doghouse        painted kennel with a name plate + a food / water bowl
 * Local origin = ground centre of the footprint, +Z is the front (door side).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, boxUV, mat, groundAO, lumpySphere, bevelCylinder } from '../geom';
import { lantern, windowUnit } from '../props/structures';

const TRIM = 0xf3ecdc;
const RED = 0xb84a38;
const RED_D = 0x943a2c;

function plinth(b: MeshBuilder, W: number, D: number, h: number): void {
  b.add('stone', boxUV(roundedBox(W + 0.24, h, D + 0.24, 0.06), 0.8), mat(0, h / 2, 0), { tint: 0xd0c6b6, aoWorld: groundAO(h * 0.9, 0.55) });
}

/** Vertical battens across a wall face (local +Z facing). */
function battens(b: MeshBuilder, w: number, h: number, y0: number, z: number, step = 0.36, rotY = 0, xOff = 0): void {
  const n = Math.floor(w / step);
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + 0.06 + (i * (w - 0.12)) / n;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const lx = x;
    const lz = z;
    b.add('woodGrain', roundedBox(0.05, h - 0.04, 0.03, 0.012), mat(xOff + lx * c + lz * s, y0 + h / 2, -lx * s + lz * c, 0, rotY, 0), { tint: RED_D });
  }
}

function xBrace(b: MeshBuilder, w: number, h: number, x: number, y: number, z: number, tint = TRIM): void {
  const L = Math.hypot(w, h) - 0.06;
  const a = Math.atan2(h, w);
  for (const s of [-1, 1]) b.add('woodPaint', roundedBox(L, 0.07, 0.04, 0.015), mat(x, y + h / 2, z, 0, 0, s * a), { tint });
  b.add('woodPaint', roundedBox(w + 0.02, 0.08, 0.05, 0.015), mat(x, y + 0.04, z), { tint });
  b.add('woodPaint', roundedBox(w + 0.02, 0.08, 0.05, 0.015), mat(x, y + h - 0.04, z), { tint });
  for (const sx of [-1, 1]) b.add('woodPaint', roundedBox(0.08, h, 0.05, 0.015), mat(x + (sx * w) / 2, y + h / 2, z), { tint });
}

function weathervane(b: MeshBuilder, y: number, animal: 'rooster' | 'cow'): void {
  b.add('metal', new THREE.CylinderGeometry(0.018, 0.022, 0.8, 6), mat(0, y + 0.4, 0), { tint: 0x2e2a28 });
  b.add('metal', new THREE.SphereGeometry(0.05, 10, 8), mat(0, y + 0.45, 0), { tint: 0xc8a050 });
  for (const [dx, dz] of [[1, 0], [0, 1]] as const) b.add('metal', roundedBox(dx ? 0.5 : 0.02, 0.015, dz ? 0.5 : 0.02, 0.005), mat(0, y + 0.55, 0), { tint: 0x2e2a28 });
  b.add('metal', roundedBox(0.6, 0.02, 0.02, 0.005), mat(0, y + 0.78, 0), { tint: 0x2e2a28 });
  b.add('metal', new THREE.ConeGeometry(0.05, 0.12, 4).rotateZ(-Math.PI / 2), mat(0.32, y + 0.78, 0), { tint: 0x2e2a28 });
  // Silhouette (flat, in the XY plane)
  const s = new THREE.Shape();
  if (animal === 'rooster') {
    s.moveTo(-0.16, 0);
    s.bezierCurveTo(-0.22, 0.12, -0.2, 0.26, -0.12, 0.24);
    s.bezierCurveTo(-0.06, 0.1, 0.04, 0.08, 0.08, 0.14);
    s.lineTo(0.1, 0.24);
    s.lineTo(0.16, 0.2);
    s.lineTo(0.13, 0.12);
    s.bezierCurveTo(0.14, 0.02, 0.06, -0.04, -0.02, -0.02);
    s.lineTo(-0.16, 0);
  } else {
    s.moveTo(-0.2, 0);
    s.lineTo(-0.2, 0.14);
    s.lineTo(0.12, 0.14);
    s.lineTo(0.2, 0.2);
    s.lineTo(0.24, 0.14);
    s.lineTo(0.18, 0.06);
    s.lineTo(0.12, 0.06);
    s.lineTo(0.12, 0);
    s.lineTo(0.08, 0);
    s.lineTo(0.08, 0.05);
    s.lineTo(-0.14, 0.05);
    s.lineTo(-0.14, 0);
    s.lineTo(-0.2, 0);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
  g.translate(0, 0, -0.01);
  b.add('metal', g, mat(0, y + 0.82, 0, 0, 0.5, 0), { tint: 0x2e2a28 });
}

// ───────────────────────────────────────────── coop

export const COOP_SIZE = { W: 3.2, D: 2.9 };

export function buildCoopExterior(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const { W, D } = COOP_SIZE;
  const base = 0.32;
  const wallH = 1.75;
  const top = base + wallH;
  plinth(b, W, D, base);
  b.add('wood', boxUV(roundedBox(W, wallH, D, 0.05), 1 / 1.4), mat(0, base + wallH / 2, 0), { tint: RED, aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, base, base + 0.8) });
  battens(b, W, wallH, base, D / 2 + 0.015);
  battens(b, W, wallH, base, D / 2 + 0.015, 0.36, Math.PI);
  battens(b, D, wallH, base, W / 2 + 0.015, 0.36, Math.PI / 2);
  battens(b, D, wallH, base, W / 2 + 0.015, 0.36, -Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodPaint', roundedBox(0.12, wallH + 0.02, 0.12, 0.03), mat((sx * W) / 2, base + wallH / 2, (sz * D) / 2), { tint: TRIM });
  b.add('woodPaint', roundedBox(W + 0.14, 0.1, D + 0.14, 0.03), mat(0, base + 0.05, 0), { tint: TRIM });
  b.add('woodPaint', roundedBox(W + 0.14, 0.12, D + 0.14, 0.03), mat(0, top - 0.04, 0), { tint: TRIM });
  // Gable roof, ridge along X
  const over = 0.38;
  const rise = 1.05;
  const slope = Math.atan2(rise, D / 2);
  const run = D / 2 + over;
  const len = run / Math.cos(slope) + 0.08;
  const ridgeY = top + rise;
  for (const sz of [-1, 1]) {
    const g = boxUV(roundedBox(W + 2 * over, 0.14, len, 0.05), 1 / 1.5);
    b.add('roofTile', g, mat(0, ridgeY - Math.tan(slope) * (run / 2) + 0.03, sz * (run / 2 - 0.04), sz * slope, 0, 0), { tint: 0x4f6a60, aoWorld: (p) => 0.8 + 0.2 * THREE.MathUtils.smoothstep(p.y, top, ridgeY) });
    b.add('woodPaint', roundedBox(W + 2 * over + 0.04, 0.12, 0.07, 0.025), mat(0, ridgeY - Math.tan(slope) * run - 0.05, sz * (run - 0.02)), { tint: TRIM });
  }
  const ridge = new THREE.CylinderGeometry(0.1, 0.1, W + 2 * over + 0.06, 10);
  ridge.rotateZ(Math.PI / 2);
  b.add('roofTile', ridge, mat(0, ridgeY + 0.07, 0), { tint: 0x3e564e });
  for (const sx of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2 - 0.02, 0);
    tri.lineTo(D / 2 + 0.02, 0);
    tri.lineTo(0, rise);
    tri.closePath();
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.12, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate((sx * W) / 2 - 0.06, top, 0);
    boxUV(g, 1 / 1.4);
    b.add('wood', g, undefined, { tint: RED });
    // Round vent with a little hen-shaped glint
    const v = new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16);
    v.rotateZ(Math.PI / 2);
    b.add('woodPaint', v, mat(sx * (W / 2 + 0.04), top + 0.42, 0), { tint: TRIM });
    const vg = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16);
    vg.rotateZ(Math.PI / 2);
    b.add('white', vg, mat(sx * (W / 2 + 0.06), top + 0.42, 0), { tint: 0x2a1c14 });
  }
  weathervane(b, ridgeY + 0.12, 'rooster');
  // Front: Dutch door (centre), window + flower box (left), pop-hole + ramp (right)
  const fz = D / 2;
  b.add('woodPaint', roundedBox(0.95, 1.52, 0.1, 0.03), mat(0, base + 0.76, fz + 0.03), { tint: TRIM });
  for (const [y, h] of [[base + 0.06, 0.66], [base + 0.76, 0.66]] as const) {
    b.add('wood', boxUV(roundedBox(0.74, h, 0.08, 0.02), 1 / 0.8), mat(0, y + h / 2, fz + 0.07), { tint: 0xe8dcc0 });
    xBrace(b, 0.66, h - 0.06, 0, y + 0.03, fz + 0.12, 0xc8503a);
  }
  b.add('metal', new THREE.SphereGeometry(0.035, 8, 6), mat(0.26, base + 0.78, fz + 0.16), { tint: 0xc9a44a });
  lantern(b, 0.62, base + 1.3, fz + 0.14, 0.75);
  {
    const wb = new MeshBuilder();
    windowUnit(wb, 0.62, 0.52, false, true, rng);
    b.addBuilder(wb, mat(-0.98, base + 1.05, fz + 0.03));
  }
  // Pop hole + ramp
  const px = 1.05;
  b.add('white', roundedBox(0.34, 0.36, 0.02, 0.07), mat(px, base + 0.26, fz + 0.03), { tint: 0x1c120c });
  b.add('woodPaint', roundedBox(0.44, 0.06, 0.04, 0.015), mat(px, base + 0.47, fz + 0.04), { tint: TRIM });
  const rampLen = 0.95;
  const rh = base + 0.08;
  const ra = Math.asin(rh / rampLen);
  b.add('woodGrain', roundedBox(0.34, 0.04, rampLen, 0.015), mat(px, rh / 2, fz + Math.cos(ra) * rampLen * 0.5, ra, 0, 0), { tint: 0xc89a64, aoWorld: groundAO(0.2, 0.7) });
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    b.add('woodDark', roundedBox(0.34, 0.025, 0.03, 0.01), mat(px, rh * (1 - t) + 0.03, fz + Math.cos(ra) * rampLen * t, ra, 0, 0));
  }
  for (let i = 0; i < 12; i++) {
    const s = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 3);
    s.rotateZ(Math.PI / 2 - 0.2);
    b.add('white', s, mat(px + (rng.next() - 0.5) * 0.3, base + 0.1, fz + 0.06 + rng.next() * 0.12, 0, rng.next() * 3, 0), { tint: 0xe6c778 });
  }
  // Nest box bump-out on the east wall with its own lid
  b.add('wood', boxUV(roundedBox(0.46, 0.55, 1.5, 0.03), 1 / 1.3), mat(W / 2 + 0.23, base + 0.55, -0.1), { tint: RED });
  b.add('roofTile', boxUV(roundedBox(0.62, 0.07, 1.66, 0.02), 1 / 1.5), mat(W / 2 + 0.28, base + 0.87, -0.1, 0, 0, -0.32), { tint: 0x4f6a60 });
  for (const z of [-0.55, -0.1, 0.35]) b.add('metal', roundedBox(0.04, 0.05, 0.1, 0.01), mat(W / 2 + 0.47, base + 0.84, z), { tint: 0x2e2a28 });
  // A little hen sign over the door
  b.add('woodPaint', roundedBox(0.6, 0.24, 0.04, 0.03), mat(0, base + 1.66, fz + 0.1), { tint: 0xf6ead0 });
  b.add('white', lumpySphere(0.06, 1, 0.1, rng), mat(-0.05, base + 1.66, fz + 0.13, 0, 0, 0, 1.3, 1, 0.4), { tint: 0xc8503a });
  b.add('white', new THREE.SphereGeometry(0.035, 8, 6), mat(0.08, base + 1.72, fz + 0.13, 0, 0, 0, 1, 1, 0.4), { tint: 0xc8503a });
  // Feed bin + water dish by the door
  b.add('woodGrain', boxUV(roundedBox(0.5, 0.5, 0.4, 0.04), 1.4), mat(-1.9, 0.25, fz + 0.1), { tint: 0xc8a070, aoWorld: groundAO(0.3) });
  b.add('woodDark', roundedBox(0.56, 0.06, 0.46, 0.02), mat(-1.9, 0.52, fz + 0.1, -0.12, 0, 0));
  b.add('metal', bevelCylinder(0.2, 0.22, 0.08, 0.02, 16), mat(1.75, 0, fz + 0.75), { tint: 0xb8c0c4 });
  b.add('stillWater', new THREE.CircleGeometry(0.17, 16).rotateX(-Math.PI / 2), mat(1.75, 0.07, fz + 0.75));
  return b.build({ name: 'coop' });
}

// ───────────────────────────────────────────── barn

export const BARN_SIZE = { W: 5, D: 4.3 };

export function buildBarnExterior(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const { W, D } = BARN_SIZE;
  const base = 0.3;
  const wallH = 2.45;
  const eave = base + wallH;
  plinth(b, W, D, base);
  b.add('wood', boxUV(roundedBox(W, wallH, D, 0.06), 1 / 1.6), mat(0, base + wallH / 2, 0), { tint: RED, aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, base, base + 1.0) });
  battens(b, W, wallH, base, D / 2 + 0.015, 0.42);
  battens(b, D, wallH, base, W / 2 + 0.015, 0.42, Math.PI / 2);
  battens(b, D, wallH, base, W / 2 + 0.015, 0.42, -Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodPaint', roundedBox(0.16, wallH + 0.02, 0.16, 0.04), mat((sx * W) / 2, base + wallH / 2, (sz * D) / 2), { tint: TRIM });
  b.add('woodPaint', roundedBox(W + 0.16, 0.12, D + 0.16, 0.03), mat(0, base + 0.06, 0), { tint: TRIM });
  // Gambrel profile (ridge along Z): eave (±W/2, eave) → knee (±k, kneeY) → ridge (0, ridgeY)
  const kx = W * 0.3;
  const kneeY = eave + 1.25;
  const ridgeY = kneeY + 0.62;
  const over = 0.3;
  const prof: [number, number][] = [
    [-W / 2 - 0.16, eave - 0.08],
    [-kx, kneeY],
    [0, ridgeY],
    [kx, kneeY],
    [W / 2 + 0.16, eave - 0.08],
  ];
  // Roof planes
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = prof[i]!;
    const [x1, y1] = prof[i + 1]!;
    const L = Math.hypot(x1 - x0, y1 - y0) + 0.12;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const g = boxUV(roundedBox(L, 0.15, D + 2 * over, 0.05), 1 / 1.6);
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    b.add('roofTile', g, mat((x0 + x1) / 2 + nx * 0.08, (y0 + y1) / 2 + ny * 0.08, 0, 0, 0, a), { tint: 0x5c5a64, aoWorld: (p) => 0.78 + 0.22 * THREE.MathUtils.smoothstep(p.y, eave, ridgeY) });
    // White fascia along the front + back gable edges
    for (const sz of [-1, 1]) b.add('woodPaint', roundedBox(L, 0.14, 0.08, 0.03), mat((x0 + x1) / 2 + nx * 0.12, (y0 + y1) / 2 + ny * 0.12, sz * (D / 2 + over - 0.02), 0, 0, a), { tint: TRIM });
  }
  const ridge = new THREE.CylinderGeometry(0.1, 0.1, D + 2 * over + 0.05, 10);
  ridge.rotateX(Math.PI / 2);
  b.add('roofTile', ridge, mat(0, ridgeY + 0.12, 0), { tint: 0x46444c });
  // Gable ends (front + back): gambrel pentagon, planked red
  for (const sz of [-1, 1]) {
    const s = new THREE.Shape();
    s.moveTo(-W / 2, 0);
    s.lineTo(W / 2, 0);
    s.lineTo(kx, kneeY - eave);
    s.lineTo(0, ridgeY - eave);
    s.lineTo(-kx, kneeY - eave);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false });
    g.translate(0, eave, sz * (D / 2) - 0.07);
    boxUV(g, 1 / 1.6);
    b.add('wood', g, undefined, { tint: RED });
    b.add('woodPaint', roundedBox(W + 0.1, 0.12, 0.08, 0.03), mat(0, eave, sz * (D / 2 + 0.06)), { tint: TRIM });
  }
  const fz = D / 2 + 0.07;
  // Hay loft door + hoist beam with a pulley and rope
  const ly = eave + 0.2;
  b.add('woodPaint', roundedBox(1.0, 0.95, 0.06, 0.02), mat(0, ly + 0.47, fz), { tint: TRIM });
  b.add('wood', boxUV(roundedBox(0.84, 0.8, 0.05, 0.02), 1 / 0.8), mat(0, ly + 0.47, fz + 0.03), { tint: RED_D });
  xBrace(b, 0.78, 0.74, 0, ly + 0.1, fz + 0.07);
  b.add('woodDark', roundedBox(0.16, 0.16, 1.0, 0.03), mat(0, ridgeY - 0.35, fz + 0.4));
  b.add('metal', new THREE.TorusGeometry(0.08, 0.02, 6, 12), mat(0, ridgeY - 0.52, fz + 0.8), { tint: 0x3a3634 });
  b.add('cloth', new THREE.CylinderGeometry(0.012, 0.012, 1.3, 4), mat(0.07, ridgeY - 1.2, fz + 0.8), { tint: 0xc8a878 });
  b.add('metal', new THREE.TorusGeometry(0.05, 0.012, 5, 10), mat(0.07, ridgeY - 1.88, fz + 0.8), { tint: 0x3a3634 });
  // Big sliding doors: white frame, red leaves with X braces, top rail
  const dw = 2.2;
  const dh = 2.1;
  b.add('white', roundedBox(dw, dh, 0.04, 0.02), mat(0, base + dh / 2, fz - 0.03), { tint: 0x1e140e });
  for (const s of [-1, 1]) {
    const cx = s * (dw / 4 + 0.03);
    b.add('wood', boxUV(roundedBox(dw / 2 - 0.02, dh, 0.08, 0.02), 1 / 1.1), mat(cx, base + dh / 2, fz + 0.03), { tint: RED });
    xBrace(b, dw / 2 - 0.12, dh - 0.1, cx, base + 0.05, fz + 0.09);
    b.add('metal', roundedBox(0.04, 0.3, 0.05, 0.01), mat(s * 0.12, base + 1.05, fz + 0.13), { tint: 0x2e2a28 });
  }
  b.add('metal', roundedBox(dw * 1.9, 0.08, 0.06, 0.02), mat(dw * 0.2, base + dh + 0.08, fz + 0.1), { tint: 0x3a3634 });
  // Front windows flanking the doors + lanterns
  for (const s of [-1, 1]) {
    const wb = new MeshBuilder();
    windowUnit(wb, 0.52, 0.52, false, false, rng);
    b.addBuilder(wb, mat(s * 1.85, base + 1.6, fz - 0.03));
    xBrace(b, 0.5, 0.5, s * 1.85, base + 0.35, fz + 0.02);
    lantern(b, s * 1.32, base + 1.95, fz + 0.14, 0.8);
  }
  // Cupola with louvres + weathervane
  const cy = ridgeY + 0.1;
  b.add('wood', boxUV(roundedBox(0.7, 0.62, 0.7, 0.03), 1), mat(0, cy + 0.31, 0), { tint: TRIM });
  for (let i = 0; i < 4; i++) b.add('woodDark', roundedBox(0.52, 0.04, 0.02, 0.01), mat(0, cy + 0.2 + i * 0.1, 0.36, -0.4, 0, 0));
  const cap = new THREE.ConeGeometry(0.62, 0.42, 4);
  cap.rotateY(Math.PI / 4);
  b.add('roofTile', cap, mat(0, cy + 0.83, 0), { tint: 0x5c5a64 });
  weathervane(b, cy + 1.0, 'cow');
  // Dressing: hay bales, milk cans, a stone water trough on the side
  b.add('thatch', roundedBox(0.9, 0.42, 0.5, 0.07), mat(-W / 2 - 0.2, 0.21, fz + 0.45, 0, 0.25, 0), { tint: 0xe8c878, aoWorld: groundAO(0.25) });
  b.add('thatch', roundedBox(0.9, 0.42, 0.5, 0.07), mat(-W / 2 - 0.1, 0.63, fz + 0.4, 0, 0.1, 0), { tint: 0xf0d488 });
  b.add('cloth', roundedBox(0.03, 0.44, 0.52, 0.01), mat(-W / 2 - 0.4, 0.21, fz + 0.5, 0, 0.25, 0), { tint: 0xb8452e });
  for (const [x, z] of [[W / 2 + 0.3, fz + 0.3], [W / 2 + 0.55, fz + 0.05]] as const) {
    b.add('metal', bevelCylinder(0.15, 0.17, 0.5, 0.03, 14), mat(x, 0, z), { tint: 0xc8d0d4 });
    b.add('metal', bevelCylinder(0.09, 0.1, 0.14, 0.02, 12), mat(x, 0.5, z), { tint: 0xc8d0d4 });
  }
  return b.build({ name: 'barn' });
}

// ───────────────────────────────────────────── construction site

export function buildConstruction(rng: Rng, W: number, D: number): THREE.Group {
  const b = new MeshBuilder();
  const hw = W / 2;
  const hd = D / 2;
  const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (const [x, z] of corners) {
    b.add('woodGrain', roundedBox(0.07, 0.6, 0.07, 0.015), mat(x, 0.3, z), { tint: 0xd8b888, aoWorld: groundAO(0.2) });
    b.add('cloth', roundedBox(0.09, 0.08, 0.09, 0.01), mat(x, 0.55, z), { tint: 0xff7a3a });
  }
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i]!;
    const [x1, z1] = corners[(i + 1) % 4]!;
    const L = Math.hypot(x1 - x0, z1 - z0);
    const a = Math.atan2(-(z1 - z0), x1 - x0);
    b.add('cloth', new THREE.BoxGeometry(L, 0.012, 0.012), mat((x0 + x1) / 2, 0.45, (z0 + z1) / 2, 0, a, 0), { tint: 0xf4f0e0 });
  }
  // Lumber stack
  for (let l = 0; l < 4; l++) {
    for (let i = 0; i < 5 - l; i++) {
      b.add('woodGrain', roundedBox(2.2, 0.1, 0.16, 0.02), mat(-0.6 + (rng.next() - 0.5) * 0.08, 0.08 + l * 0.1, -0.4 + i * 0.17 + l * 0.08, 0, (rng.next() - 0.5) * 0.04, 0), { tint: l % 2 ? 0xe0c090 : 0xd4b080 });
    }
  }
  for (const x of [-1.4, 0.2]) b.add('woodDark', roundedBox(0.12, 0.06, 1.0, 0.02), mat(x, 0.03, -0.05));
  // Stone pile
  for (let i = 0; i < 9; i++) {
    const r = 0.14 + rng.next() * 0.1;
    b.add('stone', lumpySphere(r, 1, 0.25, rng), mat(1.1 + (rng.next() - 0.5) * 0.7, r * 0.6 + (i > 5 ? 0.15 : 0), 0.5 + (rng.next() - 0.5) * 0.6, 0, rng.next() * 3, 0, 1, 0.7, 1), { tint: 0xc8c0b4 });
  }
  // Sawhorse
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) b.add('woodGrain', roundedBox(0.05, 0.7, 0.05, 0.01), mat(0.8 + s * 0.35, 0.33, -1.0 + t * 0.12, t * 0.25, 0, 0), { tint: 0xc8a070 });
  }
  b.add('woodGrain', roundedBox(0.9, 0.07, 0.08, 0.02), mat(0.8, 0.66, -1.0), { tint: 0xd0a878 });
  // Plan sign
  b.add('woodDark', roundedBox(0.06, 0.9, 0.06, 0.02), mat(-hw + 0.3, 0.45, hd + 0.2));
  b.add('woodPaint', roundedBox(0.7, 0.45, 0.04, 0.02), mat(-hw + 0.3, 0.85, hd + 0.23), { tint: 0xf4ecd8 });
  b.add('white', roundedBox(0.56, 0.3, 0.01, 0.01), mat(-hw + 0.3, 0.86, hd + 0.255), { tint: 0x5a8ac8 });
  return b.build({ name: 'construction' });
}

// ───────────────────────────────────────────── carpenter board

export function buildCarpenterBoard(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (const s of [-1, 1]) b.add('woodGrain', roundedBox(0.1, 1.7, 0.1, 0.025), mat(s * 0.62, 0.85, 0), { tint: 0xa87850, aoWorld: groundAO(0.3) });
  b.add('woodGrain', boxUV(roundedBox(1.2, 0.8, 0.06, 0.02), 1.4), mat(0, 1.05, 0.02), { tint: 0xc8a070 });
  b.add('woodDark', roundedBox(1.32, 0.07, 0.1, 0.02), mat(0, 0.62, 0.04));
  const roofL = 0.5;
  for (const s of [-1, 1]) b.add('roofTile', roundedBox(1.55, 0.05, roofL, 0.02), mat(0, 1.72, s * 0.18, s * 0.55, 0, 0), { tint: 0x4f6a60 });
  // Pinned papers: blueprints + notes
  const papers: [number, number, number, number, number][] = [
    [-0.3, 1.12, 0.46, 0.34, 0x5a8ac8],
    [0.22, 1.2, 0.34, 0.26, 0xf4ecd8],
    [0.25, 0.86, 0.36, 0.22, 0x6a9ad8],
    [-0.32, 0.8, 0.3, 0.2, 0xf8e8b0],
  ];
  for (const [x, y, w, h, c] of papers) {
    b.add('white', roundedBox(w, h, 0.01, 0.005), mat(x, y, 0.06, 0, 0, (rng.next() - 0.5) * 0.12), { tint: c });
    b.add('metal', new THREE.SphereGeometry(0.018, 6, 5), mat(x, y + h / 2 - 0.03, 0.07), { tint: 0xd83a3a });
    if (c !== 0xf4ecd8 && c !== 0xf8e8b0) {
      // Blueprint line drawing: a little barn outline
      for (const [lx, ly, lw, lh] of [[0, -0.05, 0.22, 0.01], [-0.11, 0, 0.01, 0.1], [0.11, 0, 0.01, 0.1], [-0.06, 0.08, 0.13, 0.01], [0.06, 0.08, 0.13, 0.01]] as const) {
        b.add('white', roundedBox(lw * w * 3, lh * 3, 0.004, 0.001), mat(x + lx * w * 2.5, y + ly * h * 2.2, 0.067, 0, 0, lx < 0 && ly > 0.05 ? 0.5 : lx > 0 && ly > 0.05 ? -0.5 : 0), { tint: 0xf0f6ff });
      }
    } else {
      for (let i = 0; i < 3; i++) b.add('white', roundedBox(w * 0.7, 0.012, 0.004, 0.001), mat(x, y + h * 0.2 - i * 0.05, 0.067), { tint: 0x8a7a6a });
    }
  }
  // Hammer + saw hanging on nails
  b.add('woodGrain', roundedBox(0.03, 0.26, 0.03, 0.01), mat(0.55, 1.28, 0.08, 0, 0, 0.3), { tint: 0xa87850 });
  b.add('metal', roundedBox(0.12, 0.05, 0.05, 0.01), mat(0.59, 1.4, 0.08, 0, 0, 0.3), { tint: 0x5a5a5a });
  return b.build({ name: 'carpenter-board' });
}

// ───────────────────────────────────────────── doghouse + bowl

export function buildDoghouse(): THREE.Group {
  const b = new MeshBuilder();
  const W = 0.95;
  const D = 1.05;
  const H = 0.62;
  b.add('wood', boxUV(roundedBox(W, H, D, 0.04), 1.3), mat(0, H / 2 + 0.06, 0), { tint: 0x5a8ab0, aoWorld: groundAO(0.3) });
  b.add('woodPaint', roundedBox(W + 0.08, 0.08, D + 0.08, 0.02), mat(0, 0.06, 0), { tint: TRIM });
  const rise = 0.42;
  const a = Math.atan2(rise, W / 2);
  const L = W / 2 / Math.cos(a) + 0.16;
  for (const s of [-1, 1]) b.add('roofTile', boxUV(roundedBox(L, 0.06, D + 0.26, 0.02), 1.5), mat(s * (L / 2 - 0.1) * Math.cos(a), H + 0.06 + rise / 2 + 0.04, 0, 0, 0, -s * a), { tint: 0xc0503a });
  for (const sz of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2, 0);
    tri.lineTo(W / 2, 0);
    tri.lineTo(0, rise);
    tri.closePath();
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.05, bevelEnabled: false });
    g.translate(0, H + 0.06, sz * (D / 2) - 0.025);
    b.add('wood', g, undefined, { tint: 0x5a8ab0 });
  }
  // Arched doorway
  const arch = new THREE.Shape();
  arch.moveTo(-0.2, 0);
  arch.lineTo(0.2, 0);
  arch.lineTo(0.2, 0.3);
  arch.absarc(0, 0.3, 0.2, 0, Math.PI, false);
  arch.lineTo(-0.2, 0);
  const ag = new THREE.ShapeGeometry(arch, 10);
  b.add('white', ag, mat(0, 0.1, D / 2 + 0.012), { tint: 0x1a120e });
  const trim = new THREE.TorusGeometry(0.22, 0.03, 6, 14, Math.PI);
  b.add('woodPaint', trim, mat(0, 0.4, D / 2 + 0.02), { tint: TRIM });
  // Name plate with a bone
  b.add('woodPaint', roundedBox(0.4, 0.12, 0.03, 0.02), mat(0, H + 0.2, D / 2 + 0.03), { tint: 0xf4e4c0 });
  b.add('white', roundedBox(0.2, 0.035, 0.01, 0.015), mat(0, H + 0.2, D / 2 + 0.05), { tint: 0xffffff });
  for (const s of [-1, 1]) for (const t of [-1, 1]) b.add('white', new THREE.SphereGeometry(0.022, 8, 6), mat(s * 0.1, H + 0.2 + t * 0.018, D / 2 + 0.05), { tint: 0xffffff });
  // Cushion peeking out
  b.add('cloth', roundedBox(0.6, 0.08, 0.5, 0.04), mat(0, 0.1, 0.18), { tint: 0xd86a5a });
  return b.build({ name: 'doghouse' });
}

export function buildBowl(): THREE.Group {
  const b = new MeshBuilder();
  const g = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.15, 0), new THREE.Vector2(0.19, 0.08), new THREE.Vector2(0.16, 0.09), new THREE.Vector2(0.13, 0.03), new THREE.Vector2(0, 0.03)], 20);
  b.add('metal', g, mat(0, 0, 0), { tint: 0xd84a4a });
  b.add('white', new THREE.TorusGeometry(0.175, 0.012, 5, 20).rotateX(Math.PI / 2), mat(0, 0.085, 0), { tint: 0xf4f0e6 });
  return b.build({ name: 'pet-bowl' });
}

// ───────────────────────────────────────────── pasture furniture

/** Split-log water trough on stone feet, brimming with still water. Local +Z = long side front. */
export function buildWaterTrough(): THREE.Group {
  const b = new MeshBuilder();
  const L = 1.9;
  for (const s of [-1, 1]) b.add('stone', roundedBox(0.34, 0.2, 0.62, 0.06), mat(s * (L / 2 - 0.25), 0.1, 0), { tint: 0xb8b0a2, aoWorld: groundAO(0.2) });
  // Hollowed log: outer half-cylinder shell + end caps
  const shell = new THREE.CylinderGeometry(0.32, 0.32, L, 18, 1, true, Math.PI / 2, Math.PI);
  shell.rotateZ(Math.PI / 2);
  b.add('woodGrain', shell, mat(0, 0.52, 0), { tint: 0x7a5434 });
  const inner = new THREE.CylinderGeometry(0.27, 0.27, L - 0.08, 18, 1, true, Math.PI / 2, Math.PI);
  inner.rotateZ(Math.PI / 2);
  inner.scale(1, 1, 1);
  b.add('woodGrain', inner, mat(0, 0.52, 0, 0, 0, 0), { tint: 0xb88a5a });
  for (const s of [-1, 1]) {
    const cap = new THREE.CircleGeometry(0.32, 18, Math.PI, Math.PI);
    b.add('woodGrain', cap, mat(s * (L / 2), 0.52, 0, 0, s * Math.PI / 2, 0), { tint: 0xc89868 });
  }
  b.add('woodGrain', roundedBox(L + 0.04, 0.05, 0.08, 0.02), mat(0, 0.53, 0.3), { tint: 0xa87850 });
  b.add('woodGrain', roundedBox(L + 0.04, 0.05, 0.08, 0.02), mat(0, 0.53, -0.3), { tint: 0xa87850 });
  b.add('stillWater', new THREE.PlaneGeometry(L - 0.12, 0.5).rotateX(-Math.PI / 2), mat(0, 0.47, 0));
  return b.build({ name: 'water-trough' });
}

/** A-frame hay rack (a slatted V on legs) heaped with hay; a salt lick on a post beside it. */
export function buildHayRack(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const L = 1.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.08, 1.0, 0.08, 0.02), mat(sx * (L / 2), 0.5, sz * 0.32, sz * -0.28, 0, 0), { tint: 0x9a6a44, aoWorld: groundAO(0.25) });
    b.add('woodGrain', roundedBox(0.08, 0.08, 0.7, 0.02), mat(sx * (L / 2), 0.36, 0), { tint: 0x8a5a38 });
  }
  for (const sz of [-1, 1]) {
    b.add('woodGrain', roundedBox(L + 0.1, 0.07, 0.07, 0.02), mat(0, 1.0, sz * 0.46), { tint: 0x9a6a44 });
    for (let i = 0; i < 7; i++) b.add('woodGrain', roundedBox(0.035, 0.66, 0.035, 0.01), mat(-L / 2 + 0.12 + (i * (L - 0.24)) / 6, 0.7, sz * 0.26, sz * -0.62, 0, 0), { tint: 0xb88a5a });
  }
  // Hay heaped in the V (thatch lumps + straws sticking out)
  for (let i = 0; i < 5; i++) {
    const x = -L / 2 + 0.2 + i * 0.28;
    b.add('thatch', new THREE.IcosahedronGeometry(0.26, 1), mat(x, 0.92 + rng.next() * 0.06, (rng.next() - 0.5) * 0.12, rng.next(), rng.next(), 0, 1.1, 0.75, 1.3), { tint: 0xf0d488 });
  }
  for (let i = 0; i < 24; i++) {
    const g = new THREE.CylinderGeometry(0.01, 0.008, 0.26, 3);
    b.add('thatch', g, mat(-L / 2 + 0.1 + rng.next() * (L - 0.2), 1.1 + rng.next() * 0.1, (rng.next() - 0.5) * 0.6, (rng.next() - 0.5) * 1.8, rng.next() * 3, (rng.next() - 0.5) * 1.8), { tint: 0xf4dc98 });
  }
  // Stray straws at the feet
  for (let i = 0; i < 18; i++) {
    const g = new THREE.CylinderGeometry(0.01, 0.008, 0.22, 3);
    b.add('thatch', g, mat(-L / 2 + rng.next() * L, 0.02, 0.35 + rng.next() * 0.35, Math.PI / 2 - 0.1, rng.next() * 3, 0), { tint: 0xf0d488 });
  }
  // Salt lick on a post
  b.add('woodGrain', roundedBox(0.1, 0.62, 0.1, 0.02), mat(L / 2 + 0.55, 0.31, 0.1), { tint: 0x8a5a38, aoWorld: groundAO(0.2) });
  b.add('stone', roundedBox(0.22, 0.16, 0.2, 0.05), mat(L / 2 + 0.55, 0.68, 0.1), { tint: 0xf2d8d0 });
  return b.build({ name: 'hay-rack' });
}
