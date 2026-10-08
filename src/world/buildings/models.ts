/**
 * Outdoor farm buildings (hero props, merged per material by MeshBuilder):
 *   coop            limewashed board henhouse with oak trim on a fieldstone plinth, mossy terracotta
 *                   pantile roof, sage Dutch door, shuttered window + flower box, pop hole with a roped
 *                   hatch + cleated ramp, tiled nest-box bump-out, firewood stack, rooster weathervane
 *   barn            weathered red gambrel barn on fieldstone: big sliding X-brace doors, hay hood
 *                   projecting over the loft door (hoist beam, block + rope), shingle courses, flower
 *                   boxes, louvred cupola + cow weathervane, a west lean-to (bales, cart wheel, fork)
 *                   and an east fieldstone silo with a verdigris dome, ladder and feed chute
 *   pasture         plank water trough + enamel bucket, slatted hay manger with square bales
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
/** r14: the chicken-wire run on the coop's west wall (width, m). */
export const COOP_RUN = { W: 1.4 };

/** Weathered silver-grey boards, sage paint, oak trim and terracotta: the coop's own material story
 *  (the barn keeps the red + white). */
const COOP_BOARD = 0xe2dccc;
const COOP_BATTEN = 0xa8a090;
const COOP_TRIM = 0x8a6a4a;
const SAGE = 0x8aa58a;
const TERRA = [0xc8704a, 0xb8603c, 0xd28252, 0xbe6842];

/** Fieldstone plinth: a mortar core with lumpy dressed stones proud of every face. */
function fieldstonePlinth(b: MeshBuilder, W: number, D: number, h: number, rng: Rng): void {
  b.add('stone', boxUV(roundedBox(W + 0.2, h, D + 0.2, 0.05), 0.8), mat(0, h / 2, 0), { tint: 0x9a948a, aoWorld: groundAO(h * 0.9, 0.5) });
  const face = (len: number, place: (t: number) => [number, number, number]): void => {
    for (let row = 0; row < 2; row++) {
      let t = -len / 2 + (row ? 0.12 : 0);
      while (t < len / 2 - 0.08) {
        const w = 0.2 + rng.next() * 0.16;
        const [x, z, ry] = place(t + w / 2);
        const sh = h / 2 - 0.03;
        const tint = [0xc4bcae, 0xb4ac9c, 0xd0c8b8, 0xa8a090][Math.floor(rng.next() * 4)]!;
        b.add('stone', lumpySphere(0.5, 1, 0.18, rng), mat(x, sh * (row + 0.5) + 0.02, z, 0, ry, 0, w * 0.95, sh * 0.95, 0.12), { tint });
        t += w + 0.02;
      }
    }
  };
  face(W + 0.2, (t) => [t, D / 2 + 0.1, 0]);
  face(W + 0.2, (t) => [t, -D / 2 - 0.1, 0]);
  face(D + 0.2, (t) => [W / 2 + 0.1, t, Math.PI / 2]);
  face(D + 0.2, (t) => [-W / 2 - 0.1, t, Math.PI / 2]);
}

/** Terracotta pantiles over a roof slab (slab-local: tiles run down local Z, arch up local +Y). */
function pantiles(w: number, len: number, rng: Rng, moss: number): MeshBuilder {
  const tb = new MeshBuilder();
  const step = 0.21;
  const n = Math.floor(w / step);
  const courses = 3;
  const cl = len / courses;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + step / 2 + i * step + (w - n * step) / 2;
    for (let c = 0; c < courses; c++) {
      const g = new THREE.CylinderGeometry(0.085, 0.092, cl + 0.05, 7, 1, true, -Math.PI / 2, Math.PI);
      g.rotateX(-Math.PI / 2);
      // Courses step down the slope (the lower course tucks under the one above).
      const z = -len / 2 + cl * (c + 0.5);
      const tint = TERRA[Math.floor(rng.next() * TERRA.length)]!;
      tb.add('roofTile', g, mat(x, 0.06 + c * 0.012, z, -0.035, 0, 0), { tint, aoWorld: (p) => 0.82 + 0.18 * Math.min(1, Math.max(0, p.y / 0.12)) });
    }
  }
  // Moss cushions on the shady courses
  for (let i = 0; i < moss; i++) {
    const x = (rng.next() - 0.5) * (w - 0.4);
    const z = len / 2 - 0.15 - rng.next() * len * 0.45;
    tb.add('white', lumpySphere(0.07 + rng.next() * 0.05, 1, 0.4, rng), mat(x, 0.12, z, 0, rng.next() * 3, 0, 1.5, 0.3, 1), { tint: rng.next() < 0.5 ? 0x6a7a3a : 0x5a6a34 });
  }
  return tb;
}

/** Ledged Z-brace door leaf (cottage style; the barn keeps its X braces). */
function zBrace(b: MeshBuilder, w: number, h: number, x: number, y: number, z: number, tint: number): void {
  for (const ly of [0.12, h - 0.12]) b.add('woodPaint', roundedBox(w, 0.1, 0.04, 0.015), mat(x, y + ly, z), { tint });
  // Board grooves instead of a diagonal (a Z brace read as a painted letter from the high camera)
  for (const gx of [-w / 4, 0, w / 4]) b.add('woodPaint', roundedBox(0.018, h - 0.3, 0.02, 0.006), mat(x + gx, y + h / 2, z - 0.01), { tint: new THREE.Color(tint).multiplyScalar(0.85) });
}

export function buildCoopExterior(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const { W, D } = COOP_SIZE;
  const base = 0.4;
  const wallH = 1.7;
  const top = base + wallH;
  fieldstonePlinth(b, W, D, base, rng);
  // Weathered vertical boards: grey core, each batten its own silvered tone, grime rising from the plinth
  b.add('woodPaint', boxUV(roundedBox(W, wallH, D, 0.05), 1 / 1.4), mat(0, base + wallH / 2, 0), { tint: COOP_BOARD, aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, base, base + 0.7) });
  const silver = (rotY: number, w: number, z: number): void => {
    const n = Math.floor(w / 0.3);
    for (let i = 0; i <= n; i++) {
      const lx = -w / 2 + 0.06 + (i * (w - 0.12)) / n;
      const c = Math.cos(rotY);
      const sn = Math.sin(rotY);
      const k = 0.88 + rng.next() * 0.2;
      const tint = new THREE.Color(COOP_BATTEN).multiplyScalar(k);
      b.add('woodGrain', roundedBox(0.06, wallH - 0.04, 0.03, 0.012), mat(lx * c + z * sn, base + wallH / 2, -lx * sn + z * c, 0, rotY, 0), { tint, aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, base, base + 0.6) });
    }
  };
  silver(0, W, D / 2 + 0.015);
  silver(Math.PI, W, D / 2 + 0.015);
  silver(Math.PI / 2, D, W / 2 + 0.015);
  silver(-Math.PI / 2, D, W / 2 + 0.015);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.13, wallH + 0.02, 0.13, 0.03), mat((sx * W) / 2, base + wallH / 2, (sz * D) / 2), { tint: COOP_TRIM });
  b.add('woodGrain', roundedBox(W + 0.14, 0.1, D + 0.14, 0.03), mat(0, base + 0.05, 0), { tint: 0x7a5a3c });
  b.add('woodGrain', roundedBox(W + 0.14, 0.12, D + 0.14, 0.03), mat(0, top - 0.04, 0), { tint: COOP_TRIM });
  // Gable roof (ridge along X): terracotta pantiles on a dark under-slab, mossy on the north slope
  const over = 0.36;
  const rise = 1.0;
  const slope = Math.atan2(rise, D / 2);
  const run = D / 2 + over;
  const len = run / Math.cos(slope) + 0.08;
  const ridgeY = top + rise;
  for (const sz of [-1, 1]) {
    const m = mat(0, ridgeY - Math.tan(slope) * (run / 2) + 0.03, sz * (run / 2 - 0.04), sz * slope, 0, 0);
    b.add('woodDark', boxUV(roundedBox(W + 2 * over, 0.08, len, 0.03), 1 / 1.5), m, { tint: 0x6a4a34 });
    // Tiles run down the slope: local +Z of the slab points down-slope on the front (sz = 1) side.
    const tm = m.clone().multiply(new THREE.Matrix4().makeRotationY(sz > 0 ? 0 : Math.PI));
    b.addBuilder(pantiles(W + 2 * over - 0.06, len, rng, sz < 0 ? 6 : 2), tm);
  }
  // Ridge: round terracotta ridge tiles
  for (let i = 0; i < 9; i++) {
    const L = (W + 2 * over) / 9;
    const g = new THREE.CylinderGeometry(0.12, 0.125, L + 0.03, 9, 1, true, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    b.add('roofTile', g, mat(-(W + 2 * over) / 2 + L * (i + 0.5), ridgeY + 0.07, 0, -Math.PI / 2, 0, 0), { tint: i % 2 ? 0xb05a38 : 0xa85434 });
  }
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
    b.add('woodPaint', g, undefined, { tint: 0xc8c2b2, aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, top + rise, top) });
    const rake = Math.hypot(D / 2 + 0.12, rise);
    for (const sd of [-1, 1]) b.add('woodGrain', roundedBox(0.06, 0.14, rake + 0.1, 0.02), mat(sx * (W / 2 + 0.03), top + rise / 2 + 0.04, (sd * (D / 2 + 0.06)) / 2, sd * slope, 0, 0), { tint: COOP_TRIM });
    // Round vent, sage ring
    const v = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16);
    v.rotateZ(Math.PI / 2);
    b.add('woodPaint', v, mat(sx * (W / 2 + 0.04), top + 0.42, 0), { tint: SAGE });
    const vg = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16);
    vg.rotateZ(Math.PI / 2);
    b.add('white', vg, mat(sx * (W / 2 + 0.06), top + 0.42, 0), { tint: 0x2a1c14 });
  }
  weathervane(b, ridgeY + 0.16, 'rooster');
  // Front: sage Dutch door with Z ledges (centre), shuttered window + flower box (left), pop hole (right)
  const fz = D / 2;
  b.add('woodGrain', roundedBox(0.95, 1.5, 0.1, 0.03), mat(0, base + 0.75, fz + 0.03), { tint: COOP_TRIM });
  for (const [y, h] of [[base + 0.06, 0.66], [base + 0.76, 0.64]] as const) {
    b.add('wood', boxUV(roundedBox(0.76, h, 0.08, 0.02), 1 / 0.8), mat(0, y + h / 2, fz + 0.07), { tint: SAGE });
    zBrace(b, 0.68, h - 0.04, 0, y + 0.02, fz + 0.12, 0x7a9478);
    for (const hy of [y + 0.14, y + h - 0.14]) b.add('metal', roundedBox(0.22, 0.04, 0.02, 0.008), mat(-0.27, hy, fz + 0.14), { tint: 0x2e2a28 });
  }
  b.add('metal', new THREE.SphereGeometry(0.035, 8, 6), mat(0.27, base + 0.78, fz + 0.16), { tint: 0xc9a44a });
  // Horseshoe over the door
  b.add('metal', new THREE.TorusGeometry(0.07, 0.014, 5, 12, Math.PI * 1.4), mat(0, base + 1.62, fz + 0.1, 0, 0, -Math.PI * 0.2 + Math.PI), { tint: 0x5a504a });
  lantern(b, 0.62, base + 1.28, fz + 0.14, 0.75);
  // r11: coop language, not cottage — the front window is a screened hen vent (chicken wire over a dark
  // opening, a top-hung board flap propped open on a stick) and a wire vent strip runs under the eaves.
  {
    const wx = -1.0;
    const wy = base + 1.05;
    const ww = 0.66;
    const wh = 0.48;
    b.add('white', roundedBox(ww, wh, 0.02, 0.01), mat(wx, wy, fz + 0.025), { tint: 0x1a120c });
    b.add(chickenWire(), wirePlane(ww, wh), mat(wx, wy, fz + 0.05));
    for (const sy of [-1, 1]) b.add('woodGrain', roundedBox(ww + 0.12, 0.06, 0.06, 0.015), mat(wx, wy + sy * (wh / 2 + 0.02), fz + 0.06), { tint: COOP_TRIM });
    for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.06, wh + 0.1, 0.06, 0.015), mat(wx + sx * (ww / 2 + 0.03), wy, fz + 0.06), { tint: COOP_TRIM });
    // The flap: boards hinged at the top, swung up ~55° on a prop stick.
    b.add('wood', boxUV(roundedBox(ww + 0.08, wh + 0.04, 0.04, 0.015), 1 / 0.8), mat(wx, wy + wh / 2 + 0.05 + Math.sin(0.95) * (wh / 2), fz + 0.1 + Math.cos(0.95) * (wh / 2) * 0.9, -0.95, 0, 0), { tint: SAGE });
    b.add('woodGrain', roundedBox(0.025, 0.42, 0.025, 0.008), mat(wx + 0.22, wy + 0.1, fz + 0.18, -0.55, 0, 0), { tint: 0x8a6a4a });
    // Flower box stays (a coop can be loved), lower and simpler.
    b.add('woodPaint', roundedBox(ww + 0.06, 0.14, 0.16, 0.02), mat(wx, wy - wh / 2 - 0.1, fz + 0.12), { tint: SAGE });
    for (let i = 0; i < 6; i++) b.add('white', new THREE.SphereGeometry(0.045, 7, 5), mat(wx - 0.28 + i * 0.11, wy - wh / 2 - 0.02, fz + 0.12 + (i % 2) * 0.03), { tint: [0xf2c43a, 0xe86a7a, 0xf8f0e0][i % 3] });
  }
  // Wire vent strip under the front eave (dark gap behind the mesh, trim battens either side).
  {
    const vy = top - 0.2;
    b.add('white', roundedBox(W - 0.5, 0.2, 0.02, 0.01), mat(0, vy, fz + 0.025), { tint: 0x1a120c });
    b.add(chickenWire(), wirePlane(W - 0.5, 0.2), mat(0, vy, fz + 0.05));
    for (const sy of [-1, 1]) b.add('woodGrain', roundedBox(W - 0.4, 0.045, 0.05, 0.012), mat(0, vy + sy * 0.12, fz + 0.06), { tint: COOP_TRIM });
  }
  // Pop hole + long cleated ramp
  const px = 1.05;
  b.add('white', roundedBox(0.34, 0.36, 0.02, 0.07), mat(px, base + 0.26, fz + 0.03), { tint: 0x1c120c });
  b.add('woodGrain', roundedBox(0.44, 0.06, 0.04, 0.015), mat(px, base + 0.47, fz + 0.04), { tint: COOP_TRIM });
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.04, 0.82, 0.05, 0.012), mat(px + sx * 0.21, base + 0.4, fz + 0.06), { tint: COOP_TRIM });
  // Pulley + rope for the sliding hatch
  b.add('metal', new THREE.TorusGeometry(0.04, 0.012, 5, 10), mat(px, base + 0.92, fz + 0.08), { tint: 0x3a3634 });
  b.add('cloth', new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), mat(px + 0.04, base + 0.68, fz + 0.09), { tint: 0xc8a878 });
  const rampLen = 1.1;
  const rh = base + 0.08;
  const ra = Math.asin(rh / rampLen);
  b.add('woodGrain', roundedBox(0.34, 0.04, rampLen, 0.015), mat(px, rh / 2, fz + Math.cos(ra) * rampLen * 0.5, ra, 0, 0), { tint: 0xa89a84, aoWorld: groundAO(0.2, 0.7) });
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    b.add('woodDark', roundedBox(0.34, 0.03, 0.035, 0.01), mat(px, rh * (1 - t) + 0.035, fz + Math.cos(ra) * rampLen * t, ra, 0, 0));
  }
  for (let i = 0; i < 12; i++) {
    const s = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 3);
    s.rotateZ(Math.PI / 2 - 0.2);
    b.add('white', s, mat(px + (rng.next() - 0.5) * 0.3, base + 0.1, fz + 0.06 + rng.next() * 0.12, 0, rng.next() * 3, 0), { tint: 0xe6c778 });
  }
  // Nest-box bump-out on the east wall: grey boards, a hinged terracotta-tiled lid with iron straps
  b.add('woodPaint', boxUV(roundedBox(0.46, 0.55, 1.5, 0.03), 1 / 1.3), mat(W / 2 + 0.23, base + 0.55, -0.1), { tint: COOP_BOARD });
  {
    const lid = new MeshBuilder();
    lid.add('woodDark', roundedBox(0.62, 0.05, 1.66, 0.02), mat(0, 0, 0), { tint: 0x6a4a34 });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.CylinderGeometry(0.075, 0.08, 0.62, 7, 1, true, -Math.PI / 2, Math.PI);
      g.rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
      lid.add('roofTile', g, mat(0, 0.03, -0.75 + i * 0.214), { tint: TERRA[i % 4]! });
    }
    b.addBuilder(lid, mat(W / 2 + 0.28, base + 0.87, -0.1, 0, 0, -0.32));
  }
  for (const z of [-0.55, -0.1, 0.35]) b.add('metal', roundedBox(0.3, 0.025, 0.05, 0.008), mat(W / 2 + 0.2, base + 0.9, z, 0, 0, -0.32), { tint: 0x2e2a28 });
  // Hen sign on the east gable
  b.add('woodPaint', roundedBox(0.04, 0.22, 0.52, 0.03), mat(W / 2 + 0.08, top + 0.11, 0), { tint: 0xf6ead0 });
  b.add('white', lumpySphere(0.06, 1, 0.1, rng), mat(W / 2 + 0.11, top + 0.11, 0.04, 0, 0, 0, 0.4, 1, 1.3), { tint: 0xc8503a });
  b.add('white', new THREE.SphereGeometry(0.035, 8, 6), mat(W / 2 + 0.11, top + 0.17, -0.08, 0, 0, 0, 0.4, 1, 1), { tint: 0xc8503a });
  // r14 coop language: a timber-framed chicken-wire RUN on the west wall (was a firewood stack) — wire
  // walls + a wire top over kick boards, a board-roofed back half for shade, a little hinged wire gate,
  // inside a dusted earth floor, a diagonal perch log and a galvanised feeder. With the ramp + pop hole
  // and the rooster vane it reads "henhouse", not "cottage", from the yard.
  {
    const RW = COOP_RUN.W;
    const x1 = -W / 2 - 0.05;
    const x0 = x1 - RW;
    const z0 = -D / 2 + 0.12;
    const z1 = D / 2 - 0.02;
    const RH = 1.05;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const post = (x: number, z: number): void => {
      b.add('woodGrain', roundedBox(0.08, RH + 0.04, 0.08, 0.02), mat(x, (RH + 0.04) / 2, z), { tint: COOP_TRIM, aoWorld: groundAO(0.25, 0.75) });
    };
    for (const x of [x0, x1]) for (const z of [z0, cz, z1]) post(x, z);
    post(cx, z1);
    post(cx, z0);
    // Top + mid rails and kick boards (sides: west, front, back)
    for (const y of [RH, 0.2]) {
      b.add('woodGrain', roundedBox(0.06, 0.06, z1 - z0, 0.015), mat(x0, y, cz), { tint: COOP_TRIM });
      b.add('woodGrain', roundedBox(0.06, 0.06, z1 - z0, 0.015), mat(x1, y, cz), { tint: COOP_TRIM });
      for (const z of [z0, z1]) b.add('woodGrain', roundedBox(RW, 0.06, 0.06, 0.015), mat(cx, y, z), { tint: COOP_TRIM });
    }
    b.add('woodPaint', boxUV(roundedBox(0.04, 0.2, z1 - z0, 0.012), 1 / 1.2), mat(x0, 0.1, cz), { tint: COOP_BOARD, aoWorld: groundAO(0.2, 0.7) });
    for (const z of [z0, z1]) b.add('woodPaint', boxUV(roundedBox(RW, 0.2, 0.04, 0.012), 1 / 1.2), mat(cx, 0.1, z), { tint: COOP_BOARD, aoWorld: groundAO(0.2, 0.7) });
    // Wire: west wall, front (round the gate), back, and the top's open front half
    const wh = RH - 0.2;
    const wy = 0.2 + wh / 2;
    const ww = chickenWire();
    // (a faint galvanised haze behind each wire panel: at yard distance the 7 cm mesh alone vanished and
    // the run read as an empty frame)
    const haze = runHaze();
    const wwest = wirePlane(z1 - z0, wh);
    wwest.rotateY(Math.PI / 2);
    b.add(ww, wwest, mat(x0 - 0.02, wy, cz));
    b.add(haze, wwest, mat(x0 - 0.02, wy, cz));
    b.add(ww, wirePlane(RW, wh), mat(cx, wy, z0 - 0.02));
    b.add(haze, wirePlane(RW, wh), mat(cx, wy, z0 - 0.02));
    // Front: a wire panel on the left half, a framed gate (diagonal brace) on the right half
    b.add(ww, wirePlane(RW / 2, wh), mat(x0 + RW / 4, wy, z1 + 0.02));
    b.add(haze, wirePlane(RW / 2, wh), mat(x0 + RW / 4, wy, z1 + 0.02));
    {
      const gx = x1 - RW / 4;
      b.add(ww, wirePlane(RW / 2 - 0.08, wh - 0.08), mat(gx, wy, z1 + 0.035));
      b.add(haze, wirePlane(RW / 2 - 0.08, wh - 0.08), mat(gx, wy, z1 + 0.035));
      for (const sy of [-1, 1]) b.add('woodGrain', roundedBox(RW / 2 - 0.04, 0.05, 0.04, 0.012), mat(gx, wy + sy * (wh / 2 - 0.03), z1 + 0.05), { tint: SAGE });
      for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.05, wh, 0.04, 0.012), mat(gx + sx * (RW / 4 - 0.04), wy, z1 + 0.05), { tint: SAGE });
      const diag = Math.hypot(RW / 2 - 0.1, wh - 0.1);
      b.add('woodGrain', roundedBox(0.04, diag, 0.03, 0.01), mat(gx, wy, z1 + 0.055, 0, 0, Math.atan2(RW / 2 - 0.1, wh - 0.1)), { tint: SAGE });
      b.add('metal', new THREE.TorusGeometry(0.03, 0.008, 5, 10), mat(gx - RW / 4 + 0.08, wy + 0.04, z1 + 0.08), { tint: 0x2e2a28 });
    }
    const top = wirePlane(RW, (z1 - z0) * 0.5);
    top.rotateX(-Math.PI / 2);
    b.add(ww, top, mat(cx, RH + 0.035, z1 - (z1 - z0) * 0.25));
    b.add(haze, top, mat(cx, RH + 0.035, z1 - (z1 - z0) * 0.25));
    // Board lean-to over the back half (shade), sloping down to the west, a dark underside
    b.add('woodDark', boxUV(roundedBox(RW + 0.2, 0.05, (z1 - z0) * 0.52, 0.015), 1 / 1.2), mat(cx, RH + 0.12, z0 + (z1 - z0) * 0.25, 0, 0, 0.12), { tint: 0x7a6a58 });
    for (let i = 0; i < 6; i++) b.add('woodGrain', roundedBox(0.035, 0.03, (z1 - z0) * 0.52, 0.01), mat(x0 + 0.1 + i * ((RW - 0.1) / 5), RH + 0.155 + (cx - (x0 + 0.1 + i * ((RW - 0.1) / 5))) * -0.12, z0 + (z1 - z0) * 0.25, 0, 0, 0.12), { tint: COOP_TRIM });
    // Inside: scratched earth, a perch log on the diagonal, a feeder and a few straws
    b.add('white', new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), mat(cx, 0.06, cz, 0, 0.4, 0, RW * 0.48, 1, (z1 - z0) * 0.46), { tint: 0x9a7a52 });
    {
      const g = new THREE.CylinderGeometry(0.05, 0.06, Math.hypot(RW, z1 - z0) * 0.62, 8);
      g.rotateZ(Math.PI / 2);
      b.add('bark', g, mat(cx, 0.32, cz + 0.1, 0, Math.atan2(z1 - z0, RW) * 0.7, 0.18), { tint: 0xb0a090 });
      for (const t of [-0.3, 0.3]) b.add('woodGrain', roundedBox(0.05, 0.3, 0.05, 0.01), mat(cx + t * RW * 0.7, 0.15, cz + 0.1 + t * 0.6), { tint: 0x8a6a4a });
    }
    b.add('metal', bevelCylinder(0.13, 0.16, 0.05, 0.015, 14), mat(x0 + 0.35, 0, z1 - 0.4), { tint: 0xa8b0b4 });
    b.add('metal', bevelCylinder(0.08, 0.09, 0.28, 0.02, 14), mat(x0 + 0.35, 0.05, z1 - 0.4), { tint: 0xb8c0c4 });
    for (let i = 0; i < 10; i++) {
      const st = new THREE.CylinderGeometry(0.006, 0.006, 0.14, 3);
      st.rotateZ(Math.PI / 2);
      b.add('white', st, mat(cx + (rng.next() - 0.5) * RW * 0.8, 0.025, cz + (rng.next() - 0.5) * (z1 - z0) * 0.8, 0, rng.next() * 3, 0), { tint: 0xe6c778 });
    }
  }
  // Feed bin (sage lid) + an enamel water dish by the door
  b.add('woodGrain', boxUV(roundedBox(0.5, 0.5, 0.4, 0.04), 1.4), mat(-1.95, 0.25, fz + 0.4), { tint: 0xa89a84, aoWorld: groundAO(0.3) });
  b.add('woodPaint', roundedBox(0.56, 0.06, 0.46, 0.02), mat(-1.95, 0.52, fz + 0.4, -0.12, 0, 0), { tint: SAGE });
  b.add('metal', bevelCylinder(0.2, 0.22, 0.08, 0.02, 16), mat(1.75, 0, fz + 0.85), { tint: 0x7aa4d8 });
  b.add('stillWater', new THREE.CircleGeometry(0.17, 16).rotateX(-Math.PI / 2), mat(1.75, 0.07, fz + 0.85), { tint: 0xb8e4ec });
  const g = b.build({ name: 'coop' });
  // (the see-through wire never casts a solid panel shadow)
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material === wireMat || (o as THREE.Mesh).material === hazeMat)) o.castShadow = false;
  });
  return g;
}

// ───────────────────────────────────────────── barn

export const BARN_SIZE = { W: 5, D: 4.3 };
/** How far the barn's hay hood (the peak) projects past the front gable. */
const HOOD = 0.85;

export function buildBarnExterior(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const { W, D } = BARN_SIZE;
  const base = 0.42;
  const wallH = 2.75;
  const eave = base + wallH;
  fieldstonePlinth(b, W, D, base, rng);
  // Sun-faded red: grime and splash darken the lower boards, each batten its own weathered shade.
  b.add('wood', boxUV(roundedBox(W, wallH, D, 0.06), 1 / 1.6), mat(0, base + wallH / 2, 0), { tint: RED, aoWorld: (p) => 0.62 + 0.38 * THREE.MathUtils.smoothstep(p.y, base, base + 1.1) });
  const weathered = (w: number, z: number, rotY: number): void => {
    const n = Math.floor(w / 0.42);
    for (let i = 0; i <= n; i++) {
      const lx = -w / 2 + 0.06 + (i * (w - 0.12)) / n;
      const c = Math.cos(rotY);
      const sn = Math.sin(rotY);
      const tint = new THREE.Color(RED_D).lerp(new THREE.Color(0xa86452), rng.next() * 0.45).multiplyScalar(0.92 + rng.next() * 0.14);
      b.add('woodGrain', roundedBox(0.05, wallH - 0.04, 0.03, 0.012), mat(lx * c + z * sn, base + wallH / 2, -lx * sn + z * c, 0, rotY, 0), { tint, aoWorld: (p) => 0.68 + 0.32 * THREE.MathUtils.smoothstep(p.y, base, base + 0.9) });
    }
  };
  weathered(W, D / 2 + 0.015, 0);
  weathered(D, W / 2 + 0.015, Math.PI / 2);
  weathered(D, W / 2 + 0.015, -Math.PI / 2);
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
    // The upper (steep-to-ridge) planes run on past the front gable as the hay hood over the loft door.
    const upper = i === 1 || i === 2;
    const front = upper ? HOOD : 0;
    const depth = D + 2 * over + front;
    const g = boxUV(roundedBox(L, 0.15, depth, 0.05), 1 / 1.6);
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    b.add('roofTile', g, mat((x0 + x1) / 2 + nx * 0.08, (y0 + y1) / 2 + ny * 0.08, front / 2, 0, 0, a), { tint: 0x5c5a64, aoWorld: (p) => 0.78 + 0.22 * THREE.MathUtils.smoothstep(p.y, eave, ridgeY) });
    // Shingle courses: a raised butt-edge every 0.3 m down the plane (relief that catches the sun)
    const rows = Math.max(2, Math.floor(L / 0.3));
    for (let r = 1; r < rows; r++) {
      const k = r / rows;
      const cx = x1 + (x0 - x1) * k;
      const cy = y1 + (y0 - y1) * k;
      b.add('roofTile', roundedBox(0.05, 0.035, depth - 0.04, 0.012), mat(cx + nx * 0.165, cy + ny * 0.165, front / 2, 0, 0, a), { tint: r % 2 ? 0x4a4852 : 0x52505a });
    }
    // White fascia along the front + back gable edges
    for (const sz of [-1, 1]) b.add('woodPaint', roundedBox(L, 0.14, 0.08, 0.03), mat((x0 + x1) / 2 + nx * 0.12, (y0 + y1) / 2 + ny * 0.12, sz > 0 ? D / 2 + over + front - 0.02 : -(D / 2 + over - 0.02), 0, 0, a), { tint: TRIM });
  }
  // Hood soffit: the triangle under the projecting peak, boarded white
  {
    const s = new THREE.Shape();
    s.moveTo(-kx, 0);
    s.lineTo(kx, 0);
    s.lineTo(0, ridgeY - kneeY);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false });
    g.translate(0, kneeY, D / 2 + over + HOOD - 0.16);
    b.add('woodPaint', g, undefined, { tint: 0xe8dcc8 });
  }
  const ridge = new THREE.CylinderGeometry(0.1, 0.1, D + 2 * over + HOOD + 0.05, 10);
  ridge.rotateX(Math.PI / 2);
  b.add('roofTile', ridge, mat(0, ridgeY + 0.12, HOOD / 2), { tint: 0x46444c });
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
  // Hoist beam out under the hood, a block + rope with a hook (a bale half-way up)
  b.add('woodDark', roundedBox(0.16, 0.16, 1.2, 0.03), mat(0, ridgeY - 0.42, fz + 0.5));
  b.add('metal', new THREE.TorusGeometry(0.09, 0.025, 6, 12), mat(0, ridgeY - 0.6, fz + 0.95), { tint: 0x3a3634 });
  b.add('woodDark', roundedBox(0.08, 0.2, 0.12, 0.02), mat(0, ridgeY - 0.6, fz + 0.95));
  for (const dx of [-0.09, 0.09]) b.add('cloth', new THREE.CylinderGeometry(0.012, 0.012, 1.25, 4), mat(dx, ridgeY - 1.25, fz + 0.95), { tint: 0xc8a878 });
  b.add('metal', new THREE.TorusGeometry(0.06, 0.014, 5, 10, Math.PI * 1.5), mat(0.09, ridgeY - 1.92, fz + 0.95), { tint: 0x3a3634 });
  // Big sliding doors: white frame, red leaves with X braces, top rail
  const dw = 2.2;
  const dh = 2.1;
  b.add('white', roundedBox(dw, dh, 0.04, 0.02), mat(0, base + dh / 2, fz - 0.03), { tint: 0x1e140e });
  // (Left leaf fixed; the right leaf is the pasture door and slides open along the rail: barnLeaf().)
  {
    const cx = -(dw / 4 + 0.03);
    b.add('wood', boxUV(roundedBox(dw / 2 - 0.02, dh, 0.08, 0.02), 1 / 1.1), mat(cx, base + dh / 2, fz + 0.03), { tint: RED });
    xBrace(b, dw / 2 - 0.12, dh - 0.1, cx, base + 0.05, fz + 0.09);
    b.add('metal', roundedBox(0.04, 0.3, 0.05, 0.01), mat(-0.12, base + 1.05, fz + 0.13), { tint: 0x2e2a28 });
  }
  // Inside the opening: a glimpse of straw + a dim interior so an open leaf reads as a way in.
  b.add('thatch', roundedBox(dw * 0.46, 0.06, 0.5, 0.02), mat(dw / 4, base + 0.03, fz - 0.28), { tint: 0xc8a050 });
  b.add('metal', roundedBox(dw * 1.9, 0.08, 0.06, 0.02), mat(dw * 0.2, base + dh + 0.08, fz + 0.1), { tint: 0x3a3634 });
  // Front windows flanking the doors + lanterns
  for (const s of [-1, 1]) {
    const wb = new MeshBuilder();
    windowUnit(wb, 0.52, 0.52, false, true, rng);
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
  leanTo(b, -W / 2, D, eave, rng);
  silo(b, W / 2 + BARN_SILO.dx, BARN_SILO.dz, rng);
  // Crates by the east corner
  for (const [x, y, z, r] of [[W / 2 + 0.5, 0, fz - 0.75, 0.2], [W / 2 + 0.48, 0.44, fz - 0.7, -0.1]] as const) {
    b.add('woodGrain', boxUV(roundedBox(0.5, 0.42, 0.42, 0.03), 1.6), mat(x, y + 0.21, z, 0, r, 0), { tint: 0xc09a6a, aoWorld: groundAO(0.2) });
    for (const dy of [0.08, 0.34]) b.add('woodDark', roundedBox(0.52, 0.05, 0.44, 0.01), mat(x, y + dy, z, 0, r, 0));
  }
  return b.build({ name: 'barn' });
}

/** The barn's stone silo (offset from the barn's east wall + centre): solid tiles + clearance (farm.ts). */
export const BARN_SILO = { dx: 1.2, dz: 0.35, r: 0.95 };

/** Open-fronted lean-to along the barn's west wall: shed roof on three posts, bales + a cart wheel + tools. */
function leanTo(b: MeshBuilder, x0: number, D: number, eave: number, rng: Rng): void {
  const w = 1.25;
  const d = D - 0.5;
  const hi = eave - 0.35;
  const lo = 1.65;
  const a = Math.atan2(hi - lo, w);
  const L = Math.hypot(w + 0.25, hi - lo);
  for (const z of [-d / 2 + 0.1, 0, d / 2 - 0.1]) {
    b.add('woodGrain', roundedBox(0.12, lo, 0.12, 0.03), mat(x0 - w, lo / 2, z), { tint: 0x7a5a3c, aoWorld: groundAO(0.3) });
    b.add('woodGrain', roundedBox(0.07, 0.07, Math.hypot(w, 0.6), 0.02), mat(x0 - w / 2, lo - 0.3, z, 0, Math.PI / 2, -0.45), { tint: 0x6a4a30 });
  }
  b.add('woodGrain', roundedBox(0.12, 0.14, d + 0.2, 0.03), mat(x0 - w, lo + 0.02, 0), { tint: 0x7a5a3c });
  const rm = mat(x0 - w / 2 - 0.1, (hi + lo) / 2 + 0.1, 0, 0, 0, a);
  b.add('roofTile', boxUV(roundedBox(L, 0.1, d + 0.4, 0.03), 1 / 1.6), rm, { tint: 0x6a6870 });
  for (let r = 1; r < 4; r++) {
    const k = r / 4;
    b.add('roofTile', roundedBox(0.04, 0.03, d + 0.36, 0.01), mat(x0 - w / 2 - 0.1 + (k - 0.5) * L * Math.cos(a), (hi + lo) / 2 + 0.16 + (k - 0.5) * L * Math.sin(a), 0, 0, 0, a), { tint: 0x56545c });
  }
  // Bales stacked inside, a spare cart wheel leaning on a post, a hay fork
  bale(b, x0 - 0.62, 0, -d / 2 + 0.55, Math.PI / 2, 0xe0c070, rng);
  bale(b, x0 - 0.62, 0, -d / 2 + 1.06, Math.PI / 2, 0xd8b868, rng);
  bale(b, x0 - 0.62, 0.42, -d / 2 + 0.8, Math.PI / 2 + 0.05, 0xe8cc7c, rng);
  const wheel = new THREE.TorusGeometry(0.42, 0.04, 6, 18);
  b.add('woodGrain', wheel, mat(x0 - w - 0.02, 0.44, d / 2 - 0.55, 0, Math.PI / 2, 0.18), { tint: 0x7a5434 });
  for (let i = 0; i < 6; i++) b.add('woodGrain', roundedBox(0.03, 0.8, 0.03, 0.008), mat(x0 - w - 0.02, 0.44, d / 2 - 0.55, (i / 6) * Math.PI, Math.PI / 2, 0.18), { tint: 0x8a6442 });
  b.add('metal', new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10).rotateZ(Math.PI / 2), mat(x0 - w - 0.02, 0.44, d / 2 - 0.55), { tint: 0x3a3634 });
  b.add('woodGrain', roundedBox(0.035, 1.3, 0.035, 0.01), mat(x0 - 0.15, 0.68, d / 2 - 0.25, 0.25, 0, 0.1), { tint: 0xb08a5a });
  b.add('metal', roundedBox(0.2, 0.2, 0.03, 0.01), mat(x0 - 0.12, 1.36, d / 2 - 0.08, 0.25, 0, 0.1), { tint: 0x5a5450 });
}

/** Fieldstone silo with a copper-green dome, an iron ladder and a chute down to a feed bin. */
function silo(b: MeshBuilder, x: number, z: number, rng: Rng): void {
  const R = BARN_SILO.r;
  const H = 5.2;
  b.add('stone', bevelCylinder(R + 0.08, R + 0.12, 0.35, 0.05, 20), mat(x, 0, z), { tint: 0x8e887e, aoWorld: groundAO(0.3, 0.5) });
  const body = new THREE.CylinderGeometry(R, R + 0.04, H, 22, 6, true);
  b.add('stone', boxUV(body, 0.9), mat(x, H / 2 + 0.3, z), { tint: 0xc8bfae, aoWorld: (p) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(p.y, 0.3, 1.6) });
  // Coursed stones proud of the shell (a band every 0.55 m, staggered)
  for (let row = 0; row < 9; row++) {
    const y = 0.55 + row * 0.55;
    const n = 9;
    for (let i = 0; i < n; i++) {
      if (rng.next() < 0.35) continue;
      const a = ((i + (row % 2) * 0.5) / n) * Math.PI * 2;
      const tint = [0xd6cebe, 0xb8b0a0, 0xc4bcaa][Math.floor(rng.next() * 3)]!;
      b.add('stone', lumpySphere(0.5, 1, 0.15, rng), mat(x + Math.sin(a) * (R + 0.01), y, z + Math.cos(a) * (R + 0.01), 0, a, 0, 0.42, 0.26, 0.08), { tint });
    }
  }
  // Iron hoops
  for (const y of [1.6, 3.2, 4.8]) b.add('metal', new THREE.TorusGeometry(R + 0.035, 0.025, 5, 26).rotateX(Math.PI / 2), mat(x, y, z), { tint: 0x3a3634 });
  // Dome cap (verdigris copper) + finial
  const dome = new THREE.SphereGeometry(R + 0.12, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add('roofTile', dome, mat(x, H + 0.3, z, 0, 0, 0, 1, 0.62, 1), { tint: 0x6a9a88 });
  b.add('metal', new THREE.TorusGeometry(R + 0.1, 0.04, 5, 26).rotateX(Math.PI / 2), mat(x, H + 0.32, z), { tint: 0x4e7a6a });
  b.add('metal', new THREE.SphereGeometry(0.08, 8, 6), mat(x, H + 0.3 + (R + 0.12) * 0.62 + 0.04, z), { tint: 0xc8a050 });
  // Ladder up the camera-facing side
  const la = 0.55;
  const lx = x + Math.sin(la) * (R + 0.07);
  const lz = z + Math.cos(la) * (R + 0.07);
  for (const s of [-1, 1]) b.add('metal', roundedBox(0.03, H - 0.5, 0.03, 0.008), mat(lx + Math.cos(la) * 0.15 * s, (H - 0.5) / 2 + 0.6, lz - Math.sin(la) * 0.15 * s), { tint: 0x3a3634 });
  for (let i = 0; i < 14; i++) b.add('metal', roundedBox(0.3, 0.02, 0.02, 0.005), mat(lx, 0.8 + i * 0.32, lz, 0, la, 0), { tint: 0x3a3634 });
  // Chute + a wooden feed bin at the foot
  b.add('metal', new THREE.CylinderGeometry(0.09, 0.09, 1.0, 8), mat(x - R - 0.1, 0.95, z + 0.3, 0, 0, 0.5), { tint: 0x7a8288 });
  b.add('woodGrain', boxUV(roundedBox(0.6, 0.5, 0.5, 0.03), 1.6), mat(x - R - 0.35, 0.25, z + 0.55), { tint: 0xb08a5a, aoWorld: groundAO(0.25) });
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

/** Square straw bale with two jute twine bands (local origin = foot centre, long side along X). */
export function bale(b: MeshBuilder, x: number, y: number, z: number, rotY = 0, tint = 0xe8c878, rng?: Rng): void {
  const m = mat(x, y + 0.21, z, 0, rotY, 0);
  b.add('thatch', boxUV(roundedBox(0.9, 0.42, 0.48, 0.06), 1.6), m, { tint, aoWorld: (p) => 0.78 + 0.22 * THREE.MathUtils.smoothstep(p.y, 0, 0.3) });
  const c = Math.cos(rotY);
  const sn = Math.sin(rotY);
  for (const t of [-0.22, 0.22]) b.add('cloth', roundedBox(0.035, 0.44, 0.5, 0.012), mat(x + t * c, y + 0.21, z - t * sn, 0, rotY, 0), { tint: 0x9a7448 });
  // Loose straws poking out of the cut ends
  if (rng)
    for (let i = 0; i < 6; i++) {
      const e = i % 2 ? 1 : -1;
      const g = new THREE.CylinderGeometry(0.008, 0.006, 0.16, 3);
      const lx = e * (0.45 + rng.next() * 0.03);
      const lz = (rng.next() - 0.5) * 0.4;
      b.add('thatch', g, mat(x + lx * c + lz * sn, y + 0.08 + rng.next() * 0.3, z - lx * sn + lz * c, rng.next() * 2, rotY, Math.PI / 2 + (rng.next() - 0.5)), { tint: 0xf2d890 });
    }
}

/** Plank water trough on stone feet, iron-banded, brimming with water; a blue enamel bucket at one end.
 *  Local +Z = long side front. */
export function buildWaterTrough(): THREE.Group {
  const b = new MeshBuilder();
  const L = 1.9;
  const W = 0.62;
  const H = 0.5;
  for (const s of [-1, 1]) b.add('stone', roundedBox(0.36, 0.14, W + 0.12, 0.05), mat(s * (L / 2 - 0.28), 0.07, 0), { tint: 0xb4aea4, aoWorld: groundAO(0.15) });
  const y0 = 0.12;
  // Plank sides (three boards each, weathered tone steps) + end boards + bottom
  for (const sz of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const tint = [0x8a6442, 0x9a7250, 0x7e5a3c][(i + (sz > 0 ? 1 : 0)) % 3]!;
      b.add('woodGrain', boxUV(roundedBox(L, H / 3 - 0.01, 0.06, 0.015), 1.2), mat(0, y0 + (H / 3) * (i + 0.5), sz * (W / 2 - 0.03)), { tint, aoWorld: (p) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(p.y, y0, y0 + H) });
    }
  for (const sx of [-1, 1]) b.add('woodGrain', boxUV(roundedBox(0.07, H, W, 0.015), 1.2), mat(sx * (L / 2 - 0.035), y0 + H / 2, 0), { tint: 0x7a5636 });
  b.add('woodDark', roundedBox(L - 0.1, 0.05, W - 0.1, 0.01), mat(0, y0 + 0.03, 0));
  // Cap rail along both lips (darker, worn pale where chins rest)
  for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(L + 0.06, 0.05, 0.11, 0.02), mat(0, y0 + H + 0.02, sz * (W / 2 - 0.02)), { tint: 0xb08a60 });
  // Iron bands
  for (const sx of [-0.55, 0.55]) {
    for (const sz of [-1, 1]) b.add('metal', roundedBox(0.06, H + 0.02, 0.012, 0.004), mat(sx, y0 + H / 2, sz * (W / 2 + 0.002)), { tint: 0x3a3634 });
  }
  // Water just under the lip + a few floating straws
  b.add('stillWater', new THREE.PlaneGeometry(L - 0.16, W - 0.14).rotateX(-Math.PI / 2), mat(0, y0 + H - 0.05, 0), { tint: 0xb8e4ec });
  for (const [x, z, r] of [[-0.4, 0.08, 0.4], [0.2, -0.1, 1.9], [0.55, 0.12, 2.6]] as const) {
    const g = new THREE.CylinderGeometry(0.008, 0.008, 0.2, 3).rotateZ(Math.PI / 2);
    b.add('thatch', g, mat(x, y0 + H - 0.04, z, 0, r, 0), { tint: 0xf0d488 });
  }
  // Blue enamel bucket by the end (a cool accent in a warm yard), white rim, wire bail
  const bx = L / 2 + 0.32;
  const bz = 0.18;
  const pail = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.13, 0), new THREE.Vector2(0.16, 0.3), new THREE.Vector2(0.15, 0.3), new THREE.Vector2(0.12, 0.02), new THREE.Vector2(0, 0.02)], 16);
  b.add('metal', pail, mat(bx, 0, bz), { tint: 0x7aa4d8 });
  b.add('white', new THREE.TorusGeometry(0.155, 0.014, 5, 18).rotateX(Math.PI / 2), mat(bx, 0.3, bz), { tint: 0xf4f2ea });
  b.add('metal', new THREE.TorusGeometry(0.15, 0.007, 4, 14, Math.PI), mat(bx, 0.3, bz, 0, 0.4, 0), { tint: 0x3a3634 });
  b.add('stillWater', new THREE.CircleGeometry(0.135, 14).rotateX(-Math.PI / 2), mat(bx, 0.26, bz), { tint: 0xb8e4ec });
  return b.build({ name: 'water-trough' });
}

/** Slatted wooden feed manger on legs, one broken square bale inside, a stack of bales beside it, and a
 *  salt lick on a post. Local +Z = the side the animals eat from. */
export function buildHayRack(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const L = 1.6;
  const W = 0.7;
  const y0 = 0.32;
  const H = 0.46;
  // Corner legs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.1, y0 + H + 0.06, 0.1, 0.02), mat(sx * (L / 2 - 0.05), (y0 + H + 0.06) / 2, sz * (W / 2 - 0.05)), { tint: 0x7a5434, aoWorld: groundAO(0.25) });
  // Floor + slatted sides (gaps so hay pokes through) + top rails
  b.add('woodGrain', roundedBox(L - 0.06, 0.06, W - 0.06, 0.015), mat(0, y0, 0), { tint: 0x8a6442 });
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 9; i++) b.add('woodGrain', roundedBox(0.06, H, 0.04, 0.012), mat(-L / 2 + 0.14 + (i * (L - 0.28)) / 8, y0 + H / 2, sz * (W / 2 - 0.03)), { tint: i % 3 ? 0xa8805a : 0x987048 });
    b.add('woodGrain', roundedBox(L + 0.04, 0.08, 0.09, 0.02), mat(0, y0 + H + 0.02, sz * (W / 2 - 0.03)), { tint: 0xb08a60 });
    b.add('woodGrain', roundedBox(L - 0.1, 0.07, 0.06, 0.02), mat(0, y0 + 0.08, sz * (W / 2 - 0.03)), { tint: 0x8a6442 });
  }
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.06, H, W - 0.1, 0.015), mat(sx * (L / 2 - 0.05), y0 + H / 2, 0), { tint: 0x8a6442 });
  // A broken bale inside: two flakes still square + loose hay mounded over
  b.add('thatch', boxUV(roundedBox(0.42, 0.34, 0.46, 0.06), 1.6), mat(-0.42, y0 + 0.2, 0, 0, 0, 0.12), { tint: 0xe8c878 });
  b.add('thatch', boxUV(roundedBox(0.36, 0.3, 0.46, 0.06), 1.6), mat(0.08, y0 + 0.18, 0.02, 0, 0, -0.25), { tint: 0xdcbc6c });
  for (let i = 0; i < 4; i++) b.add('thatch', new THREE.IcosahedronGeometry(0.2, 1), mat(-0.55 + i * 0.36, y0 + 0.42 + rng.next() * 0.05, (rng.next() - 0.5) * 0.15, rng.next(), rng.next(), 0, 1.3, 0.55, 1.2), { tint: 0xf0d488 });
  for (let i = 0; i < 26; i++) {
    const g = new THREE.CylinderGeometry(0.009, 0.007, 0.24, 3);
    b.add('thatch', g, mat(-L / 2 + 0.15 + rng.next() * (L - 0.3), y0 + 0.5 + rng.next() * 0.1, (rng.next() - 0.5) * (W + 0.15), (rng.next() - 0.5) * 2, rng.next() * 3, (rng.next() - 0.5) * 2), { tint: 0xf4dc98 });
  }
  // Stack of square bales at the west end (2 + 1), twine bound
  bale(b, -L / 2 - 0.62, 0, -0.05, Math.PI / 2 + 0.06, 0xe4c474, rng);
  bale(b, -L / 2 - 0.62, 0.42, 0.0, Math.PI / 2 - 0.08, 0xeccf80, rng);
  bale(b, -L / 2 - 0.1, 0, -W / 2 - 0.42, 0.1, 0xdcbc6c, rng);
  // Stray straws at the feet
  for (let i = 0; i < 26; i++) {
    const g = new THREE.CylinderGeometry(0.01, 0.008, 0.22, 3);
    b.add('thatch', g, mat(-L / 2 - 0.6 + rng.next() * (L + 0.9), 0.02, (rng.next() - 0.3) * 1.3, Math.PI / 2 - 0.1, rng.next() * 3, 0), { tint: 0xf0d488 });
  }
  // Salt lick on a post
  b.add('woodGrain', roundedBox(0.1, 0.62, 0.1, 0.02), mat(L / 2 + 0.45, 0.31, 0.1), { tint: 0x7a5434, aoWorld: groundAO(0.2) });
  b.add('stone', roundedBox(0.22, 0.16, 0.2, 0.05), mat(L / 2 + 0.45, 0.68, 0.1), { tint: 0xf2d8d0 });
  return b.build({ name: 'hay-rack' });
}

/** Barn pasture door (the right sliding leaf): local origin = its closed centre at the foot. */
export function barnLeaf(): { obj: THREE.Group; closed: THREE.Vector3; slide: THREE.Vector3 } {
  const b = new MeshBuilder();
  const dw = 2.2;
  const dh = 2.1;
  b.add('wood', boxUV(roundedBox(dw / 2 - 0.02, dh, 0.08, 0.02), 1 / 1.1), mat(0, dh / 2, 0), { tint: RED });
  xBrace(b, dw / 2 - 0.12, dh - 0.1, 0, 0.05, 0.06);
  b.add('metal', roundedBox(0.04, 0.3, 0.05, 0.01), mat(-(dw / 4 + 0.03) + 0.12, 1.05, 0.1), { tint: 0x2e2a28 });
  for (const sx of [-0.3, 0.3]) b.add('metal', new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10).rotateX(Math.PI / 2), mat(sx, dh + 0.06, 0.06), { tint: 0x3a3634 });
  const obj = b.build({ name: 'barn-leaf', castShadow: true, receiveShadow: true });
  const base = 0.42;
  const fz = BARN_SIZE.D / 2;
  return { obj, closed: new THREE.Vector3(dw / 4 + 0.03, base, fz + 0.03), slide: new THREE.Vector3(1.08, 0, 0.16) };
}

/** Coop pop door: a little planked hatch on a rope that slides up its guide rails. */
export function coopHatch(): { obj: THREE.Group; closed: THREE.Vector3; slide: THREE.Vector3 } {
  const b = new MeshBuilder();
  b.add('wood', boxUV(roundedBox(0.38, 0.4, 0.04, 0.015), 1 / 0.5), mat(0, 0.2, 0), { tint: SAGE });
  for (const y of [0.08, 0.32]) b.add('woodPaint', roundedBox(0.34, 0.06, 0.03, 0.01), mat(0, y, 0.03), { tint: 0x9cb89a });
  b.add('metal', new THREE.TorusGeometry(0.035, 0.008, 5, 10), mat(0, 0.36, 0.035), { tint: 0x2e2a28 });
  const obj = b.build({ name: 'coop-hatch', castShadow: true, receiveShadow: true });
  const base = 0.4;
  return { obj, closed: new THREE.Vector3(1.05, base + 0.07, COOP_SIZE.D / 2 + 0.07), slide: new THREE.Vector3(0, 0.38, 0) };
}

/** A plane whose UVs run in metres (the wire tile repeats every 7 cm whatever the panel size). */
function wirePlane(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return g;
}

let hazeMat: THREE.MeshStandardMaterial | null = null;
/** r14: the run's wire panels read from the yard as a faint grey veil (one shared material). */
function runHaze(): THREE.MeshStandardMaterial {
  if (hazeMat) return hazeMat;
  hazeMat = new THREE.MeshStandardMaterial({ color: 0xd4d8dc, transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  hazeMat.name = 'run-haze';
  return hazeMat;
}
let wireMat: THREE.MeshStandardMaterial | null = null;
/** Galvanised hex chicken wire: an alpha-blended canvas tile (thin grey wires, open holes). Blended, not
 *  alpha-tested, so far away the mip-averaged mesh reads as a faint grey veil instead of shimmering. */
export function chickenWire(): THREE.MeshStandardMaterial {
  if (wireMat) return wireMat;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(205,210,206,1)';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  // Two hex cells per tile (twisted-wire honeycomb), drawn wrap-safe.
  const hex = (cx: number, cy: number, r: number): void => {
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 1.15;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  const r = S / 4 / Math.cos(Math.PI / 6);
  for (const [ox, oy] of [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2], [S / 2, -S / 2], [S / 2, S * 1.5], [-S / 2, S / 2], [S * 1.5, S / 2]] as const) hex(ox, oy, r);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 0.07, 1 / 0.07);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  wireMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
  wireMat.name = 'chicken-wire';
  return wireMat;
}
