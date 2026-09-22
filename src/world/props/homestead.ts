/**
 * Homestead vignette pieces (the props that make the east yard tell stories):
 *   lean-to wood shelter, split logs + wood chips, laundry basket, stone slab (hive stand),
 *   chicken coop with ramp + nest box, feed trough, garden arch with climbing roses,
 *   cast-iron water pump with bucket.
 * Same conventions as farmkit: MeshBuilder per material, local origin = ground centre, +Z front.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere, sphericalNormals, uvScale } from '../geom';

const groundAO = (h = 0.35, min = 0.6) => (p: THREE.Vector3): number => min + (1 - min) * THREE.MathUtils.smoothstep(p.y, 0, h);

/** Lean-to roof over the woodpile: 4 posts, shingled mono-pitch roof, plank back wall. */
export function buildWoodShelter(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const W = 2.2;
  const D = 1.25;
  const hF = 1.85;
  const hB = 1.45;
  for (const [x, z, h] of [[-W / 2, D / 2, hF], [W / 2, D / 2, hF], [-W / 2, -D / 2, hB], [W / 2, -D / 2, hB]] as const) {
    b.add('woodGrain', roundedBox(0.11, h, 0.11, 0.03), mat(x, h / 2, z), { tint: 0xa87a50, aoWorld: groundAO(0.4) });
  }
  // Beams
  b.add('woodGrain', roundedBox(W + 0.3, 0.1, 0.12, 0.03), mat(0, hF - 0.03, D / 2), { tint: 0x9a6e46 });
  b.add('woodGrain', roundedBox(W + 0.3, 0.1, 0.12, 0.03), mat(0, hB - 0.03, -D / 2), { tint: 0x9a6e46 });
  // Roof: shingled slab tilted from front to back with a small overhang.
  const pitch = Math.atan2(hF - hB, D);
  const len = Math.hypot(D, hF - hB) + 0.5;
  const roof = boxUV(roundedBox(W + 0.55, 0.07, len, 0.025), 1.2);
  b.add('roof', roof, mat(0, (hF + hB) / 2 + 0.09, 0.05, pitch, 0, 0), { tint: 0xc0785c });
  // Ridge flashing strip
  b.add('woodDark', roundedBox(W + 0.6, 0.05, 0.1, 0.02), mat(0, hF + 0.13 + 0.1 * Math.sin(pitch), D / 2 + 0.25 * Math.cos(pitch)));
  // Back wall planks (gaps between), weathered tones
  for (let i = 0; i < 9; i++) {
    const x = -W / 2 + 0.13 + i * ((W - 0.26) / 8);
    const h = hB - 0.12 - rng.next() * 0.08;
    b.add('woodGrain', roundedBox(0.2, h, 0.04, 0.012), mat(x, h / 2, -D / 2 - 0.06), { tint: [0x9a7250, 0x8a6446, 0xa87e58][i % 3]!, aoWorld: groundAO(0.4, 0.5) });
  }
  // Side braces
  for (const s of [-1, 1]) b.add('woodGrain', roundedBox(0.06, 0.06, 0.9, 0.02), mat((s * W) / 2, hB - 0.35, 0, -0.55, 0, 0), { tint: 0x9a6e46 });
  // A hatchet hanging on the back wall
  b.add('woodGrain', roundedBox(0.04, 0.4, 0.04, 0.012), mat(0.75, 1.0, -D / 2 - 0.02, 0, 0, 0.1), { tint: 0xc89a64 });
  b.add('metal', roundedBox(0.16, 0.1, 0.03, 0.01), mat(0.72, 1.17, -D / 2 - 0.01, 0, 0, 0.1), { tint: 0xa0a8b0 });
  return b.build({ name: 'wood-shelter' });
}

/** Freshly split logs (quartered, pale heartwood facing up) + a scatter of wood chips. */
export function buildSplitLogs(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.13, 0.13, 0.42, 10, 1, false, 0, Math.PI / 2);
    uvScale(g, 1, 1);
    g.rotateZ(Math.PI / 2);
    const a = rng.next() * Math.PI * 2;
    const d = 0.1 + rng.next() * 0.45;
    b.add('bark', g, mat(Math.cos(a) * d, 0.05, Math.sin(a) * d, rng.next() * 0.3, rng.next() * 6, 0), { tint: 0xe2c8a4, aoWorld: groundAO(0.12, 0.55) });
  }
  // Two logs standing, waiting to be split
  for (let i = 0; i < 2; i++) {
    const g = bevelCylinder(0.15, 0.16, 0.4, 0.02, 10);
    uvScale(g, 2, 1);
    b.add('bark', g, mat(-0.45 + i * 0.3, 0, 0.35 - i * 0.1));
    const top = new THREE.CircleGeometry(0.14, 12);
    top.rotateX(-Math.PI / 2);
    b.add('woodPaint', top, mat(-0.45 + i * 0.3, 0.405, 0.35 - i * 0.1), { tint: 0xe0b682 });
  }
  // Wood chips
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * 0.95;
    b.add('woodPaint', new THREE.BoxGeometry(0.05 + rng.next() * 0.05, 0.012, 0.03 + rng.next() * 0.03), mat(Math.cos(a) * d, 0.008, Math.sin(a) * d, 0, rng.next() * 6, 0), {
      tint: rng.next() < 0.5 ? 0xf0d2a4 : 0xd8b07c,
    });
  }
  return b.build({ name: 'split-logs' });
}

/** Wicker laundry basket with folded linens. */
export function buildLaundryBasket(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const body = new THREE.CylinderGeometry(0.34, 0.27, 0.3, 18, 3, true);
  body.scale(1, 1, 0.72);
  uvScale(body, 4, 1);
  b.add('thatch', body, mat(0, 0.15, 0), { tint: 0xcfa468, aoWorld: groundAO(0.15, 0.55) });
  const bottom = new THREE.CircleGeometry(0.27, 16);
  bottom.rotateX(-Math.PI / 2);
  bottom.scale(1, 1, 0.72);
  b.add('thatch', bottom, mat(0, 0.01, 0), { tint: 0x8a6438 });
  const rim = new THREE.TorusGeometry(0.34, 0.028, 6, 22);
  rim.rotateX(Math.PI / 2);
  rim.scale(1, 1, 0.72);
  b.add('thatch', rim, mat(0, 0.3, 0), { tint: 0xa87a44 });
  for (const s of [-1, 1]) b.add('thatch', new THREE.TorusGeometry(0.07, 0.018, 5, 10, Math.PI), mat(s * 0.33, 0.3, 0, 0, Math.PI / 2, 0), { tint: 0xa87a44 });
  const linens = [0xf4efe4, 0x9cc4e4, 0xf2d6d0, 0xf4efe4];
  for (let i = 0; i < 4; i++) {
    const g = roundedBox(0.36 - i * 0.03, 0.06, 0.24, 0.03, 2);
    b.add('cloth', g, mat((rng.next() - 0.5) * 0.08, 0.24 + i * 0.045, (rng.next() - 0.5) * 0.05, (rng.next() - 0.5) * 0.15, rng.next() * 0.6, 0), { tint: linens[i]! });
  }
  // A shirt draped over the rim
  const drape = roundedBox(0.26, 0.03, 0.3, 0.012, 1);
  b.add('cloth', drape, mat(0.3, 0.25, 0.05, 0, 0.3, -0.9), { tint: 0xe08a6a });
  return b.build({ name: 'laundry-basket' });
}

/** Flat fieldstone slab (hive stand / stepping pad), set into the ground. */
export function buildStoneSlab(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const g = lumpySphere(0.5, 2, 0.1, rng, 1.8);
  g.scale(1, 0.14, 0.9);
  sphericalNormals(g, new THREE.Vector3(0, -0.4, 0), 0.35);
  boxUV(g, 1.8);
  b.add('rock', g, mat(0, 0.02, 0), { tint: 0xb0a898, aoWorld: groundAO(0.06, 0.6) });
  return b.build({ name: 'stone-slab' });
}

/** Little red hen house on legs: gable roof, pop-hole + ramp, side nest box, white trim. */
export function buildChickenCoop(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const W = 1.5;
  const D = 1.0;
  const H = 0.85;
  const legs = 0.38;
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-D / 2 + 0.08, D / 2 - 0.08]) b.add('woodDark', roundedBox(0.09, legs + 0.05, 0.09, 0.02), mat(x, (legs + 0.05) / 2, z), { aoWorld: groundAO(0.3) });
  // Body: vertical board-and-batten in barn red
  b.add('wood', boxUV(roundedBox(W, H, D, 0.04), 1.3), mat(0, legs + H / 2, 0), { tint: 0xb8503a });
  for (let i = 0; i <= 6; i++) b.add('woodPaint', roundedBox(0.035, H - 0.04, 0.02, 0.01), mat(-W / 2 + 0.05 + i * ((W - 0.1) / 6), legs + H / 2, D / 2 + 0.01), { tint: 0x9c3e2c });
  // White trim at corners and floor line
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) b.add('woodPaint', roundedBox(0.07, H + 0.04, 0.07, 0.02), mat(x, legs + H / 2, z), { tint: 0xf2ece0 });
  b.add('woodPaint', roundedBox(W + 0.08, 0.06, D + 0.08, 0.02), mat(0, legs + 0.02, 0), { tint: 0xf2ece0 });
  // Gable roof (ridge along X)
  const pitch = 0.62;
  const half = D / 2 / Math.cos(pitch) + 0.18;
  for (const s of [-1, 1]) {
    const g = boxUV(roundedBox(W + 0.3, 0.06, half, 0.02), 1.2);
    b.add('roof', g, mat(0, legs + H + Math.tan(pitch) * (D / 4) + 0.02, (s * D) / 4 + s * 0.04, s * pitch, 0, 0), { tint: 0x7a8a96 });
  }
  // Gable end triangles
  for (const x of [-W / 2, W / 2]) {
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2, 0);
    tri.lineTo(D / 2, 0);
    tri.lineTo(0, Math.tan(pitch) * (D / 2));
    tri.lineTo(-D / 2, 0);
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    b.add('wood', g, mat(x - 0.02, legs + H, 0), { tint: 0xb8503a });
  }
  // Pop hole + ramp with cleats
  b.add('white', roundedBox(0.3, 0.34, 0.02, 0.06), mat(-0.35, legs + 0.22, D / 2 + 0.02), { tint: 0x1c120c });
  b.add('woodPaint', roundedBox(0.4, 0.05, 0.03, 0.015), mat(-0.35, legs + 0.42, D / 2 + 0.03), { tint: 0xf2ece0 });
  const rampLen = 0.95;
  const rampA = Math.asin((legs + 0.04) / rampLen);
  b.add('woodGrain', roundedBox(0.3, 0.04, rampLen, 0.015), mat(-0.35, (legs + 0.04) / 2, D / 2 + Math.cos(rampA) * rampLen * 0.5, rampA, 0, 0), { tint: 0xc89a64, aoWorld: groundAO(0.2, 0.7) });
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    b.add('woodDark', roundedBox(0.3, 0.025, 0.03, 0.01), mat(-0.35, (legs + 0.04) * (1 - t) + 0.035, D / 2 + Math.cos(rampA) * rampLen * t, rampA, 0, 0));
  }
  // Nest box on the east side with a lid
  b.add('wood', boxUV(roundedBox(0.34, 0.36, 0.7, 0.03), 1.3), mat(W / 2 + 0.17, legs + 0.3, 0), { tint: 0xa84a36 });
  b.add('roof', roundedBox(0.42, 0.04, 0.78, 0.015), mat(W / 2 + 0.2, legs + 0.52, 0, 0, 0, -0.35), { tint: 0x7a8a96 });
  // Window with a heart cut-out feel (small square + cross)
  b.add('white', roundedBox(0.26, 0.2, 0.02, 0.04), mat(0.3, legs + 0.55, D / 2 + 0.02), { tint: 0x2a2018 });
  b.add('woodPaint', roundedBox(0.3, 0.035, 0.03, 0.01), mat(0.3, legs + 0.55, D / 2 + 0.03), { tint: 0xf2ece0 });
  b.add('woodPaint', roundedBox(0.035, 0.24, 0.03, 0.01), mat(0.3, legs + 0.55, D / 2 + 0.03), { tint: 0xf2ece0 });
  // Straw spilling out of the pop hole
  for (let i = 0; i < 10; i++) {
    const s = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 3);
    s.rotateZ(Math.PI / 2 - 0.2);
    b.add('white', s, mat(-0.35 + (rng.next() - 0.5) * 0.25, legs + 0.07, D / 2 + 0.04 + rng.next() * 0.1, 0, rng.next() * 3, 0), { tint: 0xe6c778 });
  }
  return b.build({ name: 'chicken-coop' });
}

/** Low feed trough with scattered grain. */
export function buildFeedTrough(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  b.add('wood', boxUV(roundedBox(0.9, 0.2, 0.32, 0.03), 1.4), mat(0, 0.13, 0), { tint: 0xc89a64, aoWorld: groundAO(0.15) });
  for (const x of [-0.38, 0.38]) b.add('woodDark', roundedBox(0.08, 0.1, 0.44, 0.02), mat(x, 0.05, 0));
  b.add('white', roundedBox(0.8, 0.02, 0.24, 0.01), mat(0, 0.225, 0), { tint: 0xd8b060 });
  for (let i = 0; i < 30; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = 0.35 + rng.next() * 0.55;
    b.add('white', new THREE.SphereGeometry(0.012, 4, 3), mat(Math.cos(a) * d, 0.01, Math.sin(a) * d * 0.7), { tint: 0xe8c860 });
  }
  return b.build({ name: 'feed-trough' });
}

/**
 * Garden gate arch: two lattice posts and a painted arch over the gap in the garden fence,
 * wrapped in a climbing rose (leafy vine spirals + blooms; seasonal via the boxFlower material:
 * rust leaves + mums in fall, evergreen sprigs + holly berries in winter).
 */
export function buildGardenArch(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const span = 1.9;
  const H = 1.9;
  const white = 0xf0ebe0;
  for (const s of [-1, 1]) {
    for (const dz of [-0.14, 0.14]) b.add('woodPaint', roundedBox(0.07, H, 0.07, 0.02), mat((s * span) / 2, H / 2, dz), { tint: white, aoWorld: groundAO(0.4, 0.6) });
    for (let i = 0; i < 6; i++) b.add('woodPaint', roundedBox(0.04, 0.03, 0.3, 0.01), mat((s * span) / 2, 0.25 + i * 0.28, 0), { tint: white });
  }
  // Arch: two bent rails
  for (const dz of [-0.14, 0.14]) {
    const g = new THREE.TorusGeometry(span / 2, 0.035, 6, 24, Math.PI);
    b.add('woodPaint', g, mat(0, H, dz), { tint: white });
  }
  for (let i = 1; i < 10; i++) {
    const a = (i / 10) * Math.PI;
    b.add('woodPaint', roundedBox(0.03, 0.03, 0.32, 0.01), mat(Math.cos(a) * (span / 2), H + Math.sin(a) * (span / 2), 0), { tint: white });
  }
  // Climbing rose: leaves along a spiral up each post and over the arch.
  const leafG = (): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(0.07, 0);
    g.scale(1, 0.35, 0.65);
    return g;
  };
  const vinePoint = (t: number, side: number): THREE.Vector3 => {
    // t 0..1 : up the post (0..0.45), over the arch (0.45..1) towards the centre.
    if (t < 0.45) {
      const y = (t / 0.45) * H;
      const a = y * 5 + side;
      return new THREE.Vector3((side * span) / 2 + Math.cos(a) * 0.12, y, Math.sin(a) * 0.16);
    }
    const u = (t - 0.45) / 0.55;
    const a = Math.PI * (side > 0 ? u * 0.5 : 1 - u * 0.5);
    const r = span / 2;
    const w = u * 14 + side;
    return new THREE.Vector3(Math.cos(a) * r, H + Math.sin(a) * r + Math.cos(w) * 0.06, Math.sin(w) * 0.16);
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < 46; i++) {
      const t = i / 46 + rng.next() * 0.01;
      const p = vinePoint(t, side);
      p.x += (rng.next() - 0.5) * 0.12;
      p.z += (rng.next() - 0.5) * 0.1;
      const tone = rng.next();
      b.add('boxFlower', leafG(), mat(p.x, p.y, p.z, rng.next() * 3, rng.next() * 6, rng.next() * 3), { tint: tone < 0.4 ? 0x3f7a2e : tone < 0.8 ? 0x4f8f36 : 0x6aa845 });
      if (rng.next() < (t > 0.3 ? 0.45 : 0.15)) {
        const bloom = lumpySphere(0.055 + rng.next() * 0.025, 0, 0.25, rng, 3);
        const c = rng.next();
        b.add('boxFlower', bloom, mat(p.x + (rng.next() - 0.5) * 0.06, p.y + 0.03, p.z + (rng.next() > 0.5 ? 0.08 : -0.08)), { tint: c < 0.5 ? 0xf06a8a : c < 0.8 ? 0xffa8c0 : 0xfff0f0 });
      }
    }
  }
  return b.build({ name: 'garden-arch' });
}

/** Cast-iron hand pump on a stone plinth, with a pail under the spout. */
export function buildWaterPump(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const base = lumpySphere(0.42, 2, 0.08, rng, 2);
  base.scale(1, 0.32, 1);
  boxUV(base, 2);
  b.add('rock', base, mat(0, 0.08, 0), { tint: 0xa8a092, aoWorld: groundAO(0.1, 0.6) });
  b.add('metal', bevelCylinder(0.08, 0.1, 0.9, 0.02, 12), mat(0, 0.18, 0), { tint: 0x3f5a4a });
  b.add('metal', new THREE.SphereGeometry(0.1, 12, 8), mat(0, 1.1, 0), { tint: 0x3f5a4a });
  const spout = new THREE.CylinderGeometry(0.03, 0.04, 0.32, 8);
  b.add('metal', spout, mat(0, 0.88, 0.16, Math.PI / 2 - 0.25, 0, 0), { tint: 0x3f5a4a });
  b.add('metal', roundedBox(0.04, 0.04, 0.6, 0.015), mat(0, 1.2, -0.22, 0.45, 0, 0), { tint: 0x2e443a });
  // Pail
  b.add('metal', new THREE.CylinderGeometry(0.15, 0.12, 0.24, 14, 1, true), mat(0.02, 0.3, 0.42), { tint: 0x9aa4ac });
  b.add('stillWater', new THREE.CircleGeometry(0.14, 14).rotateX(-Math.PI / 2), mat(0.02, 0.38, 0.42));
  b.add('metal', new THREE.TorusGeometry(0.15, 0.012, 5, 14, Math.PI), mat(0.02, 0.42, 0.42, 0, 0.4, 0), { tint: 0x7a848c });
  return b.build({ name: 'water-pump' });
}
