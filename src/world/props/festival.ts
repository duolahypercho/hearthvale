/**
 * Festival kit (Lantern Night on the plaza): catenary bunting, paper-lantern poles, a ribboned
 * maypole rising from the fountain, a long harvest table laden with food, fire braziers.
 * Same conventions as townkit.ts (MeshBuilder per material, origin = ground centre, +Z front).
 * Everything here is static and merged by the town map into a handful of draw calls.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere } from '../geom';

export const FESTIVAL_COLORS = [0xe8674a, 0xf5c542, 0x5fa8d3, 0x8fce6a, 0xf29ac0, 0xb38be0] as const;

/** Point on a hanging cord between a and b (parabolic catenary approximation), t in 0..1. */
export function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.copy(a).lerp(b, t);
  out.y -= 4 * sag * t * (1 - t);
  return out;
}

function cord(b: MeshBuilder, p: THREE.Vector3, q: THREE.Vector3, r = 0.012, tint = 0x4a3a2a): void {
  const d = q.clone().sub(p);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, 4);
  g.rotateZ(Math.PI / 2);
  b.add('white', g, mat((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2, 0, -Math.atan2(d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z))), { tint });
}

/**
 * Bunting in a catenary arc from a to b: `flags` pennants (triangles hanging in the plane of the
 * cord, alternating festival colours), optional paper lanterns every few flags. World coords.
 */
export function buildBunting(rng: Rng, a: THREE.Vector3, bPt: THREE.Vector3, sag: number, flags: number, lanternEvery = 0): THREE.Group {
  const b = new MeshBuilder();
  const segs = flags + 1;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    catenary(a, bPt, sag, i / segs, p);
    catenary(a, bPt, sag, (i + 1) / segs, q);
    cord(b, p, q);
  }
  const yaw = -Math.atan2(bPt.z - a.z, bPt.x - a.x);
  const off = Math.floor(rng.next() * FESTIVAL_COLORS.length);
  for (let i = 1; i <= flags; i++) {
    const t = i / (flags + 1);
    catenary(a, bPt, sag, t, p);
    if (lanternEvery && i % lanternEvery === 0) {
      const lan = lumpySphere(0.15, 1, 0.04, rng, 2);
      lan.scale(1, 1.25, 1);
      b.add('paperLantern', lan, mat(p.x, p.y - 0.26, p.z), { tint: [0xff9a50, 0xffc860, 0xff7060][i % 3]! });
      b.add('white', new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8), mat(p.x, p.y - 0.06, p.z), { tint: 0x3a2a1e });
      continue;
    }
    // Pennant: flat triangle in the cord's vertical plane, point down, a slight flutter.
    const s = new THREE.Shape();
    s.moveTo(-0.13, 0);
    s.lineTo(0.13, 0);
    s.lineTo(0, -0.3);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
    g.translate(0, 0, -0.006);
    b.add('cloth', g, mat(p.x, p.y, p.z, (rng.next() - 0.5) * 0.35, yaw, (rng.next() - 0.5) * 0.12), { tint: FESTIVAL_COLORS[(i + off) % FESTIVAL_COLORS.length]! });
  }
  return b.build({ name: 'bunting' });
}

/** Paper-lantern pole: turned post, a cross-arm with two lanterns and a little pennant crown. */
export function buildLanternPole(rng: Rng, hue = 0): THREE.Group {
  const b = new MeshBuilder();
  const H = 2.9;
  b.add('stone', bevelCylinder(0.2, 0.24, 0.18, 0.04, 10), mat(0, 0, 0), { tint: 0xc8c0b2 });
  b.add('woodGrain', bevelCylinder(0.06, 0.075, H, 0.02, 8), mat(0, 0.12, 0), { tint: 0xb07c50 });
  b.add('woodGrain', roundedBox(1.1, 0.07, 0.07, 0.02), mat(0, H - 0.05, 0), { tint: 0xa06c44 });
  b.add('metal', new THREE.SphereGeometry(0.06, 8, 6), mat(0, H + 0.26, 0), { tint: 0xd8b060 });
  const tints = [[0xff8a4a, 0xffc860], [0xff6a6a, 0xffb050], [0xffd070, 0xff9a60]][hue % 3]!;
  for (const [k, sx] of [[0, -1], [1, 1]] as const) {
    const x = sx * 0.46;
    b.add('white', new THREE.CylinderGeometry(0.006, 0.006, 0.26, 3), mat(x, H - 0.2, 0), { tint: 0x3a2a1e });
    const lan = lumpySphere(0.2, 1, 0.04, rng, 2);
    lan.scale(1, 1.3, 1);
    b.add('paperLantern', lan, mat(x, H - 0.55, 0), { tint: tints[k]! });
    // Rib bands + caps
    for (const y of [-0.12, 0.12]) {
      const band = new THREE.TorusGeometry(0.19, 0.012, 4, 14);
      band.rotateX(Math.PI / 2);
      b.add('white', band, mat(x, H - 0.55 + y, 0), { tint: 0x8a3a22 });
    }
    b.add('white', new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8), mat(x, H - 0.3, 0), { tint: 0x3a2a1e });
    b.add('white', new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8), mat(x, H - 0.81, 0), { tint: 0x3a2a1e });
    b.add('cloth', new THREE.ConeGeometry(0.03, 0.18, 5), mat(x, H - 0.93, 0, Math.PI, 0, 0), { tint: 0xe8574a });
  }
  // Pennant crown on top
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tri = new THREE.ConeGeometry(0.06, 0.2, 3);
    tri.rotateX(Math.PI);
    b.add('cloth', tri, mat(Math.cos(a) * 0.08, H + 0.1, Math.sin(a) * 0.08, 0, a, 0, 1, 1, 0.25), { tint: FESTIVAL_COLORS[i % FESTIVAL_COLORS.length]! });
  }
  return b.build({ name: 'lantern-pole' });
}

/**
 * Maypole standing in the fountain's upper bowl: striped pole, flower crown, ribbons fanning down
 * in gentle catenaries to the basin rim (radius `rimR`, height `rimY`). Origin = fountain centre.
 */
export function buildMaypole(rng: Rng, baseY: number, rimR: number, rimY: number): THREE.Group {
  const b = new MeshBuilder();
  const top = baseY + 4.2;
  const H = top - baseY;
  b.add('woodPaint', bevelCylinder(0.07, 0.09, H, 0.02, 10), mat(0, baseY, 0), { tint: 0xf6efe0 });
  // Spiral stripe wrap
  for (let i = 0; i < 26; i++) {
    const y = baseY + 0.2 + i * (H - 0.4) / 26;
    const band = new THREE.TorusGeometry(0.085, 0.018, 4, 10, Math.PI * 0.9);
    band.rotateX(Math.PI / 2 + 0.35);
    b.add('cloth', band, mat(0, y, 0, 0, i * 0.9, 0), { tint: i % 2 ? 0xe8574a : 0x5fa8d3 });
  }
  // Flower crown
  const ring = new THREE.TorusGeometry(0.34, 0.07, 6, 18);
  ring.rotateX(Math.PI / 2);
  b.add('boxFlower', ring, mat(0, top - 0.1, 0), { tint: 0x4f9a3a });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.add('boxFlower', new THREE.IcosahedronGeometry(0.07, 0), mat(Math.cos(a) * 0.34, top - 0.04, Math.sin(a) * 0.34), { tint: [0xff8fab, 0xffd166, 0xffffff, 0xc77dff][i % 4]! });
  }
  b.add('metal', new THREE.SphereGeometry(0.12, 10, 8), mat(0, top + 0.12, 0), { tint: 0xd8b060 });
  // Ribbons: 12 streamers to the rim
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.13;
    const A = new THREE.Vector3(Math.cos(a) * 0.12, top - 0.22, Math.sin(a) * 0.12);
    const B = new THREE.Vector3(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR);
    const tint = FESTIVAL_COLORS[i % FESTIVAL_COLORS.length]!;
    const segs = 10;
    for (let k = 0; k < segs; k++) {
      catenary(A, B, 0.35, k / segs, p);
      catenary(A, B, 0.35, (k + 1) / segs, q);
      const d = q.clone().sub(p);
      const L = d.length();
      const g = roundedBox(L + 0.01, 0.012, 0.07, 0.004, 1);
      b.add('cloth', g, mat((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2, 0, -Math.atan2(d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z))), { tint });
    }
    // Ribbon tail knot + a small flower where it's tied to the rim
    b.add('boxFlower', new THREE.IcosahedronGeometry(0.06, 0), mat(B.x, B.y + 0.04, B.z), { tint: [0xff8fab, 0xffd166, 0xffffff][i % 3]! });
  }
  void rng;
  return b.build({ name: 'maypole' });
}

/** Long harvest table: trestles, cloth + runner, pies, bread, fruit bowls, pumpkins, jugs, candles. */
export function buildFeastTable(rng: Rng, len = 5.4): THREE.Group {
  const b = new MeshBuilder();
  const W = 0.95;
  const H = 0.78;
  b.add('woodGrain', boxUV(roundedBox(len, 0.07, W, 0.02), 1.2), mat(0, H, 0), { tint: 0xc08a5a });
  for (const x of [-len / 2 + 0.4, 0, len / 2 - 0.4]) {
    for (const sz of [-1, 1]) b.add('woodGrain', roundedBox(0.08, H, 0.08, 0.02), mat(x, H / 2, sz * (W / 2 - 0.12), sz * 0.18, 0, 0), { tint: 0x9a6a44 });
    b.add('woodGrain', roundedBox(0.08, 0.06, W - 0.2, 0.02), mat(x, 0.28, 0), { tint: 0x9a6a44 });
  }
  // Tablecloth draping over the long edges + red runner
  b.add('cloth', roundedBox(len + 0.08, 0.02, W + 0.12, 0.01), mat(0, H + 0.045, 0), { tint: 0xf6ecd8 });
  for (const sz of [-1, 1]) b.add('cloth', roundedBox(len + 0.08, 0.26, 0.02, 0.01), mat(0, H - 0.08, sz * (W / 2 + 0.06)), { tint: 0xf0e2c8 });
  b.add('cloth', roundedBox(len - 0.3, 0.012, 0.34, 0.005), mat(0, H + 0.06, 0), { tint: 0xc0392b });
  // Benches both sides
  for (const sz of [-1, 1]) {
    b.add('woodGrain', roundedBox(len - 0.4, 0.06, 0.32, 0.02), mat(0, 0.45, sz * 0.95), { tint: 0xb07c50 });
    for (const x of [-len / 2 + 0.5, len / 2 - 0.5]) b.add('woodGrain', roundedBox(0.07, 0.45, 0.26, 0.02), mat(x, 0.22, sz * 0.95), { tint: 0x9a6a44 });
  }
  const top = H + 0.07;
  let x = -len / 2 + 0.35;
  let k = 0;
  while (x < len / 2 - 0.3) {
    const z = (k % 2 ? 0.2 : -0.2) + (rng.next() - 0.5) * 0.06;
    const kind = k % 7;
    // Plate under everything
    const plate = new THREE.CylinderGeometry(0.17, 0.13, 0.025, 14);
    b.add('white', plate, mat(x, top + 0.012, z), { tint: 0xf4f0e8 });
    if (kind === 0) {
      // Pie with lattice
      b.add('white', new THREE.CylinderGeometry(0.15, 0.13, 0.06, 14), mat(x, top + 0.05, z), { tint: 0xd89048 });
      b.add('white', new THREE.CylinderGeometry(0.13, 0.13, 0.012, 14), mat(x, top + 0.082, z), { tint: 0x8a2a3a });
      for (let i = -1; i <= 1; i++) {
        b.add('white', roundedBox(0.26, 0.012, 0.025, 0.005, 1), mat(x, top + 0.09, z + i * 0.07), { tint: 0xe8b060 });
        b.add('white', roundedBox(0.025, 0.012, 0.26, 0.005, 1), mat(x + i * 0.07, top + 0.092, z), { tint: 0xe8b060 });
      }
    } else if (kind === 1) {
      // Bread loaves
      for (const dz of [-0.05, 0.06]) {
        const loaf = new THREE.CapsuleGeometry(0.06, 0.14, 4, 8);
        loaf.rotateZ(Math.PI / 2);
        b.add('white', loaf, mat(x, top + 0.07, z + dz, 0, rng.next() * 0.4, 0, 1, 0.8, 1), { tint: 0xc8803a });
      }
    } else if (kind === 2) {
      // Fruit bowl
      const bowl = new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      b.add('white', bowl, mat(x, top + 0.14, z), { tint: 0x7a9ab8 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        b.add('white', new THREE.IcosahedronGeometry(0.055, 1), mat(x + Math.cos(a) * 0.07, top + 0.14 + (i % 2) * 0.03, z + Math.sin(a) * 0.07), { tint: [0xe4432e, 0xf2c43a, 0x6fae45, 0xe8741e][i % 4]! });
      }
      b.add('white', new THREE.IcosahedronGeometry(0.06, 1), mat(x, top + 0.2, z), { tint: 0x8a4ab0 });
    } else if (kind === 3) {
      // Pumpkin
      const pk = new THREE.SphereGeometry(0.14, 12, 8);
      pk.scale(1, 0.72, 1);
      b.add('white', pk, mat(x, top + 0.11, z), { tint: 0xe8741e });
      b.add('white', new THREE.CylinderGeometry(0.015, 0.02, 0.06, 5), mat(x, top + 0.22, z), { tint: 0x5a7a2a });
    } else if (kind === 4) {
      // Jug + two cups
      const jug = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.07, 0), new THREE.Vector2(0.09, 0.08), new THREE.Vector2(0.06, 0.2), new THREE.Vector2(0.07, 0.24), new THREE.Vector2(0, 0.24)], 12);
      b.add('white', jug, mat(x, top + 0.02, z), { tint: 0xb8643e });
      for (const dx of [-0.12, 0.13]) b.add('white', new THREE.CylinderGeometry(0.035, 0.03, 0.08, 8), mat(x + dx, top + 0.06, z + 0.1), { tint: 0xe8e0d0 });
    } else if (kind === 5) {
      // Candle cluster (glows)
      for (const [dx, dz, h] of [[0, 0, 0.16], [0.06, 0.05, 0.11], [-0.05, 0.04, 0.09]] as const) {
        b.add('white', new THREE.CylinderGeometry(0.022, 0.024, h, 8), mat(x + dx, top + 0.02 + h / 2, z + dz), { tint: 0xf6ecd0 });
        b.add('lampGlow', new THREE.SphereGeometry(0.02, 6, 5), mat(x + dx, top + 0.05 + h, z + dz, 0, 0, 0, 1, 1.6, 1));
      }
    } else {
      // Cake
      b.add('white', new THREE.CylinderGeometry(0.13, 0.13, 0.12, 16), mat(x, top + 0.08, z), { tint: 0xf8e8d8 });
      b.add('white', new THREE.CylinderGeometry(0.135, 0.135, 0.02, 16), mat(x, top + 0.13, z), { tint: 0xf29ac0 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add('white', new THREE.IcosahedronGeometry(0.02, 0), mat(x + Math.cos(a) * 0.09, top + 0.15, z + Math.sin(a) * 0.09), { tint: 0xd8313a });
      }
    }
    x += 0.44 + rng.next() * 0.12;
    k++;
  }
  return b.build({ name: 'feast-table' });
}

/** Iron fire brazier on a stone plinth (flames + embers are particles, see FireFX). */
export function buildBrazier(): { group: THREE.Group; fire: THREE.Vector3 } {
  const b = new MeshBuilder();
  b.add('stone', bevelCylinder(0.34, 0.4, 0.45, 0.05, 10), mat(0, 0, 0), { tint: 0xc8c0b2 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add('metal', roundedBox(0.05, 0.75, 0.05, 0.015), mat(Math.cos(a) * 0.2, 0.8, Math.sin(a) * 0.2, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25), { tint: 0x2e2a28 });
  }
  const bowl = new THREE.SphereGeometry(0.42, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  b.add('metal', bowl, mat(0, 1.42, 0), { tint: 0x3a3430 });
  const rim = new THREE.TorusGeometry(0.42, 0.03, 5, 18);
  rim.rotateX(Math.PI / 2);
  b.add('metal', rim, mat(0, 1.42, 0), { tint: 0x5a4a3a });
  // Glowing coals + split logs
  b.add('lampGlow', new THREE.CylinderGeometry(0.36, 0.3, 0.08, 12), mat(0, 1.34, 0), { tint: 0xff7a30 });
  for (let i = 0; i < 4; i++) {
    const log = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6);
    log.rotateZ(Math.PI / 2);
    b.add('bark', log, mat(0, 1.42 + (i % 2) * 0.06, 0, 0.5, (i / 4) * Math.PI, 0.35));
  }
  return { group: b.build({ name: 'brazier' }), fire: new THREE.Vector3(0, 1.5, 0) };
}
