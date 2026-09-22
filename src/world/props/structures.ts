/**
 * Hand-built structures: the farmhouse (hero asset) plus farm props — shipping bin, mailbox,
 * lantern post, woodpile, chopping block, barrel, crate, fence runs, dock.
 * All built from bevelled primitives merged per material via MeshBuilder.
 * Local origin = ground center of the footprint; +Z is the front.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere, sphericalNormals, uvScale } from '../geom';
import { materials } from '../../render/materials';

export interface BuiltProp {
  group: THREE.Group;
  /** Practical lights (added to the day/night rig as night lights). */
  lights: { light: THREE.PointLight; max: number }[];
  /** Named anchor points in the prop's local space. */
  anchors: Record<string, THREE.Vector3>;
}

const SHUTTER = 0x5d9484;
const DOOR = 0x3f7890;
const TRIM = 0xf3ead8;

export function lantern(b: MeshBuilder, x: number, y: number, z: number, s = 1): void {
  b.add('metal', roundedBox(0.2 * s, 0.05 * s, 0.2 * s, 0.015), mat(x, y + 0.14 * s, z));
  b.add('metal', new THREE.ConeGeometry(0.15 * s, 0.1 * s, 4), mat(x, y + 0.21 * s, z, 0, Math.PI / 4, 0));
  b.add('lampGlow', roundedBox(0.13 * s, 0.2 * s, 0.13 * s, 0.02), mat(x, y + 0.02 * s, z));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.add('metal', new THREE.BoxGeometry(0.02 * s, 0.24 * s, 0.02 * s), mat(x + dx * 0.075 * s, y + 0.02 * s, z + dz * 0.075 * s));
  }
  b.add('metal', roundedBox(0.18 * s, 0.035 * s, 0.18 * s, 0.01), mat(x, y - 0.1 * s, z));
}

export function windowUnit(b: MeshBuilder, w: number, h: number, shutters: boolean, flowerBox: boolean, rng: Rng): void {
  // Built facing +Z at origin (center of window).
  b.add('woodPaint', roundedBox(w + 0.18, h + 0.18, 0.1, 0.03), mat(0, 0, 0.0), { tint: TRIM });
  // Interior card: a dim room by day, warm lamp-light from late afternoon (materials 'windowCard').
  b.add('windowCard', new THREE.PlaneGeometry(w, h), mat(0, 0, 0.058));
  b.add('woodPaint', roundedBox(0.05, h, 0.05, 0.015), mat(0, 0, 0.07), { tint: TRIM });
  b.add('woodPaint', roundedBox(w, 0.05, 0.05, 0.015), mat(0, 0, 0.07), { tint: TRIM });
  b.add('woodPaint', roundedBox(w + 0.34, 0.08, 0.2, 0.03), mat(0, -h / 2 - 0.1, 0.08), { tint: TRIM });
  b.add('woodPaint', roundedBox(w + 0.28, 0.1, 0.14, 0.03), mat(0, h / 2 + 0.12, 0.05), { tint: TRIM });
  if (shutters) {
    for (const sx of [-1, 1]) {
      const g = roundedBox(w * 0.52, h + 0.1, 0.06, 0.02);
      b.add('woodGrain', g, mat(sx * (w / 2 + 0.2 + w * 0.26), 0, 0.02), { tint: SHUTTER });
      for (let k = -2; k <= 2; k++) {
        b.add('woodGrain', roundedBox(w * 0.44, 0.035, 0.05, 0.01), mat(sx * (w / 2 + 0.2 + w * 0.26), k * (h / 6), 0.06), { tint: 0x4c7d6f });
      }
    }
  }
  if (flowerBox) {
    const by = -h / 2 - 0.36;
    b.add('woodDark', roundedBox(w + 0.3, 0.26, 0.28, 0.04), mat(0, by, 0.2));
    b.add('white', roundedBox(w + 0.2, 0.04, 0.2, 0.02), mat(0, by + 0.13, 0.2), { tint: 0x4a3222 });
    const colors = [0xff7aa2, 0xffd166, 0xf25f5c, 0xc77dff, 0xffffff];
    for (let i = 0; i < 9; i++) {
      const fx = -w / 2 + (i / 8) * w;
      const leaf = lumpySphere(0.11, 1, 0.25, rng);
      b.add('boxFlower', leaf, mat(fx, by + 0.2, 0.2 + (rng.next() - 0.5) * 0.08), { tint: 0x4f9a3a });
      if (i % 2 === 0) {
        const fl = new THREE.SphereGeometry(0.06, 6, 5);
        b.add('boxFlower', fl, mat(fx + 0.03, by + 0.3, 0.26), { tint: colors[(i / 2) % colors.length]! });
      }
    }
  }
}

/** The farmhouse. Footprint 7 × 4.6 (+ porch 1.7 deep in front). */
export function buildFarmhouse(rng: Rng): BuiltProp {
  const b = new MeshBuilder();
  const W = 7;
  const D = 4.6;
  const baseH = 0.55;
  const wallH = 2.5;
  const top = baseH + wallH;
  const WALL_TINT = 0xffe7cc;

  // Foundation
  b.add('stone', boxUV(roundedBox(W + 0.3, baseH, D + 0.3, 0.08), 0.7), mat(0, baseH / 2, 0), { aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.4) });
  // Walls (planks, world-scaled UVs)
  b.add('wood', boxUV(roundedBox(W, wallH, D, 0.06), 1 / 1.8), mat(0, baseH + wallH / 2, 0), {
    tint: WALL_TINT,
    aoWorld: (p) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(p.y, baseH, baseH + 0.9),
  });
  // Corner posts + sill + top beams
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add('woodDark', roundedBox(0.26, wallH + 0.1, 0.26, 0.05), mat(sx * (W / 2), baseH + wallH / 2, sz * (D / 2)));
    }
  }
  b.add('woodDark', roundedBox(W + 0.2, 0.18, D + 0.2, 0.05), mat(0, top - 0.05, 0));
  b.add('woodDark', roundedBox(W + 0.1, 0.12, D + 0.1, 0.04), mat(0, baseH + 0.04, 0));

  // Gable roof (ridge along X)
  const over = 0.55;
  const rise = 2.05;
  const run = D / 2 + over;
  const slope = Math.atan2(rise, D / 2);
  const len = run / Math.cos(slope) + 0.1;
  const ridgeY = top + rise;
  for (const sz of [-1, 1]) {
    const g = boxUV(roundedBox(W + 2 * over + 0.3, 0.18, len, 0.06), 1 / 1.7);
    const cx = 0;
    const cz = sz * (run / 2 - 0.05) ;
    const cy = ridgeY - Math.tan(slope) * (run / 2) + 0.02;
    b.add('roof', g, mat(cx, cy, cz, sz * slope, 0, 0), { aoWorld: (p) => 0.78 + 0.22 * THREE.MathUtils.smoothstep(p.y, top - 0.4, ridgeY) });
    // Fascia board under the eave edge.
    const ez = sz * (run - 0.02);
    const ey = ridgeY - Math.tan(slope) * run - 0.08;
    b.add('woodPaint', roundedBox(W + 2 * over + 0.34, 0.16, 0.08, 0.03), mat(0, ey, ez), { tint: TRIM });
  }
  // Ridge cap
  const ridge = new THREE.CylinderGeometry(0.14, 0.14, W + 2 * over + 0.36, 10);
  ridge.rotateZ(Math.PI / 2);
  b.add('roof', ridge, mat(0, ridgeY + 0.1, 0), { tint: 0xb85a3c });
  // Gable ends (triangles, planked)
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-D / 2 - 0.05, 0);
    shape.lineTo(D / 2 + 0.05, 0);
    shape.lineTo(0, rise + 0.02);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(sx * (W / 2) - 0.09, top, 0);
    boxUV(g, 1 / 1.8);
    b.add('wood', g, undefined, { tint: WALL_TINT });
    // Round attic vent on gable
    const vent = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16);
    vent.rotateZ(Math.PI / 2);
    b.add('woodPaint', vent, mat(sx * (W / 2 + 0.06), top + 0.75, 0), { tint: TRIM });
    const vg = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16);
    vg.rotateZ(Math.PI / 2);
    b.add('glass', vg, mat(sx * (W / 2 + 0.09), top + 0.75, 0));
  }

  // Dormer on the front slope
  {
    const dx = -1.6;
    const dz = D / 2 - 0.85;
    const dy = top + 0.55;
    b.add('wood', boxUV(roundedBox(1.3, 1.1, 1.4, 0.04), 1 / 1.8), mat(dx, dy, dz - 0.1), { tint: WALL_TINT });
    for (const sx of [-1, 1]) {
      const g = boxUV(roundedBox(0.95, 0.12, 1.75, 0.04), 1 / 2.4);
      b.add('roof', g, mat(dx + sx * 0.38, dy + 0.85, dz - 0.05, 0, 0, -sx * 0.72));
    }
    const dw = new MeshBuilder();
    windowUnit(dw, 0.62, 0.62, false, false, rng);
    b.addBuilder(dw, mat(dx, dy - 0.02, dz + 0.62));
  }

  // Chimney (right gable end)
  const chX = W / 2 + 0.45;
  const chTop = ridgeY + 0.9;
  b.add('stone', boxUV(roundedBox(0.95, chTop, 1.0, 0.06), 0.9), mat(chX, chTop / 2, -0.4), { aoWorld: (p) => 0.62 + 0.38 * THREE.MathUtils.smoothstep(p.y, 0, 0.6) });
  b.add('stone', boxUV(roundedBox(1.15, 0.22, 1.2, 0.05), 0.9), mat(chX, chTop + 0.05, -0.4), { tint: 0xd0c8bc });
  b.add('metal', roundedBox(0.55, 0.15, 0.55, 0.03), mat(chX, chTop + 0.22, -0.4), { tint: 0x2a2624 });

  // Front: door
  const fz = D / 2;
  b.add('woodPaint', roundedBox(1.25, 2.15, 0.14, 0.04), mat(0, baseH + 1.04, fz + 0.02), { tint: TRIM });
  b.add('wood', boxUV(roundedBox(0.95, 1.9, 0.1, 0.03), 1 / 1.1), mat(0, baseH + 0.98, fz + 0.07), { tint: DOOR });
  b.add('glass', roundedBox(0.5, 0.36, 0.04, 0.02), mat(0, baseH + 1.55, fz + 0.12));
  b.add('woodPaint', roundedBox(0.04, 0.36, 0.05, 0.01), mat(0, baseH + 1.55, fz + 0.14), { tint: TRIM });
  const knob = new THREE.SphereGeometry(0.05, 10, 8);
  b.add('metal', knob, mat(0.33, baseH + 0.95, fz + 0.15), { tint: 0xc9a44a });
  // Wall lanterns flanking door
  lantern(b, -0.85, baseH + 1.75, fz + 0.2, 1);
  lantern(b, 0.85, baseH + 1.75, fz + 0.2, 1);
  // Front windows
  for (const wx of [-2.25, 2.25]) {
    const wb = new MeshBuilder();
    windowUnit(wb, 1.05, 1.0, true, true, rng);
    b.addBuilder(wb, mat(wx, baseH + 1.45, fz + 0.03));
  }
  // Side windows
  for (const sx of [-1, 1]) {
    const wb = new MeshBuilder();
    windowUnit(wb, 0.85, 0.9, true, false, rng);
    b.addBuilder(wb, mat(sx * (W / 2 + 0.03), baseH + 1.45, 0.5, 0, sx * (Math.PI / 2), 0));
  }
  // Back window (lights the back at night)
  {
    const wb = new MeshBuilder();
    windowUnit(wb, 0.9, 0.9, false, false, rng);
    b.addBuilder(wb, mat(1.5, baseH + 1.45, -D / 2 - 0.03, 0, Math.PI, 0));
  }

  // Porch
  const pz0 = fz;
  const pd = 1.75;
  const pw = 5.6;
  const ph = 0.48;
  b.add('wood', boxUV(roundedBox(pw, 0.14, pd, 0.04), 1 / 1.4), mat(0, ph - 0.07, pz0 + pd / 2), { tint: 0xe8c9a4 });
  b.add('stone', boxUV(roundedBox(pw - 0.1, ph - 0.12, pd - 0.1, 0.04), 0.7), mat(0, (ph - 0.12) / 2, pz0 + pd / 2), { tint: 0xc9c0b0 });
  // Steps
  for (let s = 0; s < 2; s++) {
    b.add('wood', boxUV(roundedBox(1.5, 0.14, 0.38, 0.04), 1 / 1.4), mat(0, ph - 0.17 - s * 0.16, pz0 + pd + 0.17 + s * 0.36), { tint: 0xdcbc98 });
    b.add('stone', roundedBox(1.46, ph - 0.2 - s * 0.16, 0.34, 0.03), mat(0, (ph - 0.2 - s * 0.16) / 2, pz0 + pd + 0.17 + s * 0.36), { tint: 0xb8b0a0 });
  }
  // Posts + railing
  const postH = 2.12;
  const postZ = pz0 + pd - 0.14;
  for (const px of [-pw / 2 + 0.15, -0.95, 0.95, pw / 2 - 0.15]) {
    b.add('woodPaint', roundedBox(0.2, postH, 0.2, 0.05), mat(px, ph + postH / 2, postZ), { tint: TRIM });
    b.add('woodPaint', roundedBox(0.3, 0.1, 0.3, 0.03), mat(px, ph + 0.05, postZ), { tint: TRIM });
    b.add('woodPaint', roundedBox(0.3, 0.1, 0.3, 0.03), mat(px, ph + postH - 0.05, postZ), { tint: TRIM });
  }
  for (const [x0, x1] of [[-pw / 2 + 0.15, -0.95], [0.95, pw / 2 - 0.15]] as const) {
    const cx = (x0 + x1) / 2;
    const lw = Math.abs(x1 - x0);
    b.add('woodPaint', roundedBox(lw, 0.09, 0.12, 0.03), mat(cx, ph + 0.82, postZ), { tint: TRIM });
    b.add('woodPaint', roundedBox(lw, 0.06, 0.08, 0.02), mat(cx, ph + 0.12, postZ), { tint: TRIM });
    const n = Math.round(lw / 0.22);
    for (let i = 1; i < n; i++) {
      b.add('woodPaint', roundedBox(0.05, 0.68, 0.05, 0.015), mat(x0 + (i / n) * (x1 - x0), ph + 0.47, postZ), { tint: TRIM });
    }
  }
  // Side railings
  for (const sx of [-1, 1]) {
    const x = sx * (pw / 2 - 0.15);
    b.add('woodPaint', roundedBox(0.12, 0.09, pd - 0.2, 0.03), mat(x, ph + 0.82, pz0 + pd / 2), { tint: TRIM });
    for (let i = 1; i < 6; i++) b.add('woodPaint', roundedBox(0.05, 0.68, 0.05, 0.015), mat(x, ph + 0.47, pz0 + (i / 6) * (pd - 0.14)), { tint: TRIM });
  }
  // Porch roof (shed)
  {
    const y0 = top - 0.05;
    const y1 = ph + postH + 0.05;
    const d = pd + 0.35;
    const ang = Math.atan2(y0 - y1, d);
    const L = d / Math.cos(ang) + 0.1;
    const g = boxUV(roundedBox(pw + 0.5, 0.14, L, 0.05), 1 / 2.4);
    b.add('roof', g, mat(0, (y0 + y1) / 2 + 0.08, pz0 + d / 2 - 0.02, ang, 0, 0));
    b.add('woodPaint', roundedBox(pw + 0.4, 0.2, 0.14, 0.04), mat(0, y1 + 0.02, postZ), { tint: TRIM });
  }
  // Porch dressing: welcome mat, bench, potted plants, barrel
  b.add('cloth', roundedBox(1.0, 0.03, 0.6, 0.01), mat(0, ph + 0.01, pz0 + 0.45), { tint: 0xb5523b });
  b.add('cloth', roundedBox(0.8, 0.035, 0.42, 0.01), mat(0, ph + 0.012, pz0 + 0.45), { tint: 0xd9a05b });
  {
    const bx = -2.0;
    const bz = pz0 + 0.45;
    b.add('woodGrain', roundedBox(1.2, 0.08, 0.42, 0.03), mat(bx, ph + 0.45, bz));
    b.add('woodGrain', roundedBox(1.2, 0.36, 0.07, 0.03), mat(bx, ph + 0.72, bz - 0.2));
    for (const lx of [-0.5, 0.5]) b.add('woodDark', roundedBox(0.08, 0.45, 0.36, 0.02), mat(bx + lx, ph + 0.22, bz));
  }
  for (const [px, pz] of [[1.55, pz0 + pd - 0.4], [-1.45, pz0 + pd - 0.4], [2.45, pz0 + 0.4]] as const) {
    b.add('soilPot', bevelCylinder(0.2, 0.15, 0.32, 0.04, 12), mat(px, ph, pz));
    const leaf = lumpySphere(0.26, 1, 0.25, rng);
    sphericalNormals(leaf, new THREE.Vector3(), 0.5);
    b.add('boxFlower', leaf, mat(px, ph + 0.5, pz), { tint: 0x5aa03e });
    for (let k = 0; k < 4; k++) {
      const fl = new THREE.SphereGeometry(0.05, 6, 5);
      const a = rng.next() * Math.PI * 2;
      b.add('boxFlower', fl, mat(px + Math.cos(a) * 0.2, ph + 0.55 + rng.next() * 0.12, pz + Math.sin(a) * 0.2), { tint: k % 2 ? 0xffd166 : 0xff8fab });
    }
  }
  // Barrel + firewood by chimney side
  const barrel = buildBarrelBuilder();
  b.addBuilder(barrel, mat(-W / 2 - 0.35, 0, D / 2 - 0.3));
  // Gutter downpipe
  b.add('metal', new THREE.CylinderGeometry(0.05, 0.05, top + 0.2, 6), mat(-W / 2 - 0.08, (top + 0.2) / 2, D / 2 + 0.52), { tint: 0x8a8580 });

  const group = b.build({ name: 'farmhouse' });

  // Practical lights
  const lights: { light: THREE.PointLight; max: number }[] = [];
  const porchLight = new THREE.PointLight(0xffb867, 0, 7, 1.6);
  porchLight.position.set(0, baseH + 1.9, fz + 0.9);
  group.add(porchLight);
  lights.push({ light: porchLight, max: 9 });
  for (const wx of [-2.25, 2.25]) {
    const l = new THREE.PointLight(0xffa850, 0, 4.5, 1.8);
    l.position.set(wx, baseH + 1.3, fz + 0.7);
    group.add(l);
    lights.push({ light: l, max: 4 });
  }

  return {
    group,
    lights,
    anchors: {
      chimney: new THREE.Vector3(chX, chTop + 0.3, -0.4),
      door: new THREE.Vector3(0, 0, pz0 + pd + 0.9),
    },
  };
}

function buildBarrelBuilder(): MeshBuilder {
  const b = new MeshBuilder();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.3 + Math.sin(t * Math.PI) * 0.06, t * 0.8));
  }
  pts.unshift(new THREE.Vector2(0, 0));
  pts.push(new THREE.Vector2(0, 0.8));
  const g = new THREE.LatheGeometry(pts, 14);
  uvScale(g, 2, 1);
  b.add('wood', g, undefined, { tint: 0xd8a878, aoWorld: (p) => 0.65 + 0.35 * THREE.MathUtils.smoothstep(p.y, 0, 0.3) });
  for (const y of [0.14, 0.66]) {
    const hoop = new THREE.TorusGeometry(0.34, 0.022, 5, 18);
    hoop.rotateX(Math.PI / 2);
    b.add('metal', hoop, mat(0, y, 0));
  }
  return b;
}

export function buildBarrel(): THREE.Group {
  return buildBarrelBuilder().build({ name: 'barrel' });
}

export function buildShippingBin(): BuiltProp {
  const b = new MeshBuilder();
  const W = 1.7;
  const D = 0.95;
  const H = 0.8;
  b.add('wood', boxUV(roundedBox(W, H, D, 0.06), 1 / 1.3), mat(0, H / 2, 0), { tint: 0xe0b484, aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.35) });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodDark', roundedBox(0.12, H + 0.04, 0.12, 0.03), mat(sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02)));
  // Lid, slightly open
  const lid = roundedBox(W + 0.1, 0.12, D + 0.1, 0.05);
  boxUV(lid, 1 / 1.3);
  b.add('wood', lid, mat(0, H + 0.1, -0.04, -0.12, 0, 0), { tint: 0xd09a64 });
  for (const x of [-0.55, 0.55]) b.add('metal', roundedBox(0.08, 0.14, D + 0.14, 0.02), mat(x, H + 0.11, -0.04, -0.12, 0, 0));
  b.add('metal', roundedBox(W + 0.04, 0.07, 0.04, 0.015), mat(0, H * 0.72, D / 2 + 0.01));
  b.add('metal', roundedBox(W + 0.04, 0.07, 0.04, 0.015), mat(0, H * 0.25, D / 2 + 0.01));
  // Little painted plaque
  b.add('woodPaint', roundedBox(0.5, 0.26, 0.04, 0.03), mat(0, H * 0.5, D / 2 + 0.04), { tint: 0xf3ead8 });
  b.add('white', roundedBox(0.16, 0.12, 0.02, 0.02), mat(0, H * 0.5, D / 2 + 0.065), { tint: 0xc0533b });
  return { group: b.build({ name: 'shipping-bin' }), lights: [], anchors: {} };
}

export function buildMailbox(): BuiltProp {
  const b = new MeshBuilder();
  // Stone footing + wooden post with grain + little support bracket
  b.add('stone', boxUV(roundedBox(0.34, 0.14, 0.34, 0.05), 1.5), mat(0, 0.07, 0), { aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.12) });
  b.add('woodGrain', boxUV(roundedBox(0.13, 1.0, 0.13, 0.03), 2.2), mat(0, 0.6, 0), { tint: 0xc89a64, aoWorld: (p) => 0.65 + 0.35 * THREE.MathUtils.smoothstep(p.y, 0.1, 0.45) });
  b.add('woodGrain', roundedBox(0.1, 0.06, 0.46, 0.02), mat(0, 1.07, 0.03), { tint: 0xb88a5a });
  b.add('woodGrain', roundedBox(0.06, 0.24, 0.06, 0.02), mat(0, 0.95, 0.14, -0.7, 0, 0), { tint: 0xb88a5a });
  // Body: box with a half-cylinder lid (painted sheet metal), door + rivets
  const W = 0.3;
  const L = 0.5;
  b.add('woodPaint', roundedBox(W, 0.16, L, 0.03), mat(0, 1.18, 0.03), { tint: 0x5f8fa8 });
  const lid = new THREE.CylinderGeometry(W / 2, W / 2, L, 16, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  lid.rotateY(Math.PI / 2);
  b.add('woodPaint', lid, mat(0, 1.26, 0.03, 0, 0, Math.PI / 2), { tint: 0x6a9cb6 });
  b.add('metal', roundedBox(W + 0.02, 0.29, 0.03, 0.012), mat(0, 1.25, 0.03 + L / 2), { tint: 0x4f7f98 });
  b.add('metal', new THREE.SphereGeometry(0.022, 8, 6), mat(0, 1.3, 0.05 + L / 2), { tint: 0xd8b458 });
  for (const zz of [-0.18, 0.0, 0.18]) for (const sx of [-1, 1]) b.add('metal', new THREE.SphereGeometry(0.01, 6, 4), mat(sx * (W / 2 + 0.003), 1.14, 0.03 + zz), { tint: 0x3a5a6a });
  // Painted house number
  b.add('white', roundedBox(0.004, 0.07, 0.14, 0.01), mat(W / 2 + 0.004, 1.2, 0.03), { tint: 0xf3ead8 });
  const group = b.build({ name: 'mailbox' });
  // Red flag (separate so it can wave when a letter is waiting)
  const fb = new MeshBuilder();
  fb.add('metal', roundedBox(0.02, 0.26, 0.03, 0.008), mat(0, 0.12, 0), { tint: 0x7a7f86 });
  fb.add('white', roundedBox(0.02, 0.1, 0.15, 0.015), mat(0, 0.22, -0.07), { tint: 0xd8412f });
  const flag = fb.build({ name: 'mailbox-flag' });
  flag.position.set(W / 2 + 0.02, 1.18, -0.08);
  flag.traverse((o) => (o.userData.dynamic = true));
  group.add(flag);
  return { group, lights: [], anchors: { flag: flag.position.clone() } };
}

export function buildLanternPost(): BuiltProp {
  const b = new MeshBuilder();
  b.add('stone', boxUV(roundedBox(0.4, 0.2, 0.4, 0.05), 1), mat(0, 0.1, 0));
  b.add('woodDark', roundedBox(0.16, 2.2, 0.16, 0.04), mat(0, 1.2, 0));
  b.add('woodDark', roundedBox(0.6, 0.1, 0.1, 0.03), mat(0.22, 2.2, 0));
  b.add('woodDark', roundedBox(0.08, 0.35, 0.08, 0.02), mat(0.1, 2.02, 0, 0, 0, -0.8));
  b.add('metal', new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), mat(0.45, 2.08, 0));
  lantern(b, 0.45, 1.85, 0, 1.1);
  const group = b.build({ name: 'lantern-post' });
  const l = new THREE.PointLight(0xffb060, 0, 7, 1.7);
  l.position.set(0.45, 1.85, 0);
  group.add(l);
  return { group, lights: [{ light: l, max: 8 }], anchors: {} };
}

export function buildWoodpile(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const n = 5 - Math.floor(r / 2);
    for (let i = 0; i < n; i++) {
      const g = new THREE.CylinderGeometry(0.13, 0.13, 1.1, 8);
      g.rotateX(Math.PI / 2);
      const x = (i - (n - 1) / 2) * 0.27 + (r % 2) * 0.06;
      b.add('bark', g, mat(x, 0.14 + r * 0.23, (rng.next() - 0.5) * 0.12));
      const cap = new THREE.CircleGeometry(0.12, 8);
      b.add('woodPaint', cap, mat(x, 0.14 + r * 0.23, 0.56 + (rng.next() - 0.5) * 0.08), { tint: 0xd8aa74 });
    }
  }
  // posts
  for (const x of [-0.8, 0.8]) b.add('woodDark', roundedBox(0.1, 1.1, 0.1, 0.02), mat(x, 0.55, 0));
  return b.build({ name: 'woodpile' });
}

export function buildChoppingBlock(): THREE.Group {
  const b = new MeshBuilder();
  const g = bevelCylinder(0.3, 0.34, 0.5, 0.04, 12);
  uvScale(g, 3, 1);
  b.add('bark', g);
  const top = new THREE.CircleGeometry(0.28, 16);
  top.rotateX(-Math.PI / 2);
  b.add('woodPaint', top, mat(0, 0.505, 0), { tint: 0xd9b07c });
  // Axe stuck in the block
  b.add('woodGrain', roundedBox(0.06, 0.75, 0.06, 0.02), mat(0.02, 0.8, 0.05, 0.5, 0, 0.1));
  b.add('metal', roundedBox(0.05, 0.16, 0.26, 0.02), mat(0.0, 0.52, -0.06, 0.5, 0, 0.1), { tint: 0x9aa0a6 });
  return b.build({ name: 'chopping-block' });
}

export function buildCrate(): THREE.Group {
  const b = new MeshBuilder();
  b.add('wood', boxUV(roundedBox(0.7, 0.6, 0.7, 0.04), 1 / 1.2), mat(0, 0.3, 0), { tint: 0xe6c090 });
  for (const y of [0.08, 0.52]) b.add('woodDark', roundedBox(0.74, 0.08, 0.74, 0.02), mat(0, y, 0));
  return b.build({ name: 'crate' });
}

/** Wooden fence along polylines of world points (posts at every point, rails between). */
export function buildFence(runs: [number, number][][], heightAt: (x: number, z: number) => number, rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (const run of runs) fenceRun(b, run, heightAt, rng);
  return b.build({ name: 'fence' });
}

function fenceRun(b: MeshBuilder, points: [number, number][], heightAt: (x: number, z: number) => number, rng: Rng): void {
  const postH = 0.95;
  for (const [x, z] of points) {
    const y = heightAt(x, z);
    const g = roundedBox(0.15, postH, 0.15, 0.04, 1);
    b.add('woodGrain', g, mat(x, y + postH / 2 - 0.05, z, (rng.next() - 0.5) * 0.06, rng.next() * 0.4, (rng.next() - 0.5) * 0.06), {
      tint: 0xd9b48a,
      aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y - y, 0, 0.35),
    });
    const cap = new THREE.ConeGeometry(0.11, 0.12, 4);
    b.add('woodGrain', cap, mat(x, y + postH + 0.0, z, 0, Math.PI / 4, 0), { tint: 0xcaa47a });
  }
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i]!;
    const [x1, z1] = points[i + 1]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    const ang = Math.atan2(-dz, dx);
    const y0 = heightAt(x0, z0);
    const y1 = heightAt(x1, z1);
    for (const ry of [0.32, 0.68]) {
      const g = roundedBox(L + 0.05, 0.1, 0.06, 0.025, 1);
      b.add('woodGrain', g, mat((x0 + x1) / 2, (y0 + y1) / 2 + ry + (rng.next() - 0.5) * 0.03, (z0 + z1) / 2, 0, ang, (rng.next() - 0.5) * 0.03), { tint: 0xe2c098 });
    }
  }
}

/** Small wooden dock extending from (0,0) towards -X. */
export function buildDock(length: number, width: number): THREE.Group {
  const b = new MeshBuilder();
  const n = Math.round(length / 0.32);
  for (let i = 0; i < n; i++) {
    const x = -i * 0.32 - 0.16;
    b.add('woodGrain', roundedBox(0.29, 0.08, width, 0.025), mat(x, 0.06, 0, 0, 0, 0), { tint: i % 3 === 0 ? 0xc9a07a : 0xdab48c });
  }
  for (const sz of [-1, 1]) {
    b.add('woodDark', roundedBox(length, 0.1, 0.1, 0.02), mat(-length / 2, -0.02, sz * (width / 2 - 0.08)));
    for (let i = 0; i <= 2; i++) {
      b.add('woodDark', new THREE.CylinderGeometry(0.08, 0.09, 1.4, 8), mat(-i * (length / 2) - 0.1, -0.45, sz * (width / 2 - 0.05)));
    }
  }
  return b.build({ name: 'dock' });
}
