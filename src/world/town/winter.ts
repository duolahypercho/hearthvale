/**
 * Winter dressing for the town: snowmen the village children built (each a little different:
 * knitted hat or flowerpot hat, scarf colour, twig arms waving or drooping, a lopsided head).
 * Everything is one merged 'white' mesh (colours in vertex tints), shown only in winter.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, lumpySphere, bevelCylinder, mat } from '../geom';

const SNOW = 0xeef2f7;

/** A snowman at (x, y, z) facing `rot` (+Z front) into builder `b`. */
function snowman(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, rot: number, style: number): void {
  const R = new THREE.Matrix4().makeRotationY(rot);
  const T = new THREE.Matrix4().makeTranslation(x, y, z);
  const W = T.multiply(R);
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, tint: number): void => {
    b.add('white', geo, W.clone().multiply(m), { tint });
  };
  const r0 = 0.44;
  const r1 = 0.33;
  const r2 = 0.24;
  const y0 = r0 * 0.82;
  const y1 = y0 + r0 * 0.72 + r1 * 0.72;
  const y2 = y1 + r1 * 0.74 + r2 * 0.78;
  const lean = (rng.next() - 0.5) * 0.12;
  const s0 = lumpySphere(r0, 2, 0.06, rng, 1.4);
  s0.scale(1.04, 0.9, 1.0);
  add(s0, mat(0, y0, 0), SNOW);
  add(lumpySphere(r1, 2, 0.05, rng, 1.5), mat(0.02, y1, 0, 0, 0, lean), SNOW);
  const hx = Math.sin(-lean) * 0.1;
  add(lumpySphere(r2, 2, 0.04, rng, 1.6), mat(hx, y2, 0.01, 0, 0, lean * 1.6), SNOW);
  // Snow skirt where the base meets the ground.
  const skirt = lumpySphere(r0 * 1.25, 1, 0.08, rng, 1.2);
  skirt.scale(1, 0.18, 1);
  add(skirt, mat(0, 0.02, 0), SNOW);
  // Coal eyes + smile, carrot nose.
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.028, 6, 5), mat(hx + s * 0.085, y2 + 0.06, r2 * 0.92), 0x1c1a1a);
  for (let i = 0; i < 5; i++) {
    const a = -0.55 + (i / 4) * 1.1;
    add(new THREE.SphereGeometry(0.017, 5, 4), mat(hx + Math.sin(a) * 0.11, y2 - 0.07 + Math.cos(a * 1.2) * 0.02 - 0.02, r2 * 0.93 - Math.abs(a) * 0.03), 0x1c1a1a);
  }
  const nose = new THREE.ConeGeometry(0.035, 0.2, 7);
  nose.rotateX(Math.PI / 2);
  add(nose, mat(hx, y2 + 0.0, r2 + 0.08, 0.15 * (rng.next() - 0.5), 0, 0), 0xf07a2a);
  // Coal buttons down the middle ball.
  for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.03, 6, 5), mat(0.02, y1 + 0.14 - i * 0.13, r1 * 0.95 - Math.abs(i - 1) * 0.02), 0x1c1a1a);
  // Scarf: a wrap and a hanging tail.
  const scarfC = [0xd8443a, 0x3f7fb0, 0x4a9a5a][style % 3]!;
  const wrap = new THREE.TorusGeometry(r2 * 0.9, 0.055, 6, 16);
  wrap.rotateX(Math.PI / 2);
  add(wrap, mat(hx * 0.5, y2 - r2 * 0.72, 0, 0.1, 0, 0), scarfC);
  const tail = bevelCylinder(0.06, 0.06, 0.34, 0.02, 6);
  tail.scale(1, 1, 0.45);
  add(tail, mat(0.12, y2 - r2 * 0.72 - 0.18, r2 * 0.72, 0.2, 0, 0.25), scarfC);
  // Twig arms (three-pronged), one raised in a wave for the second snowman.
  for (const s of [-1, 1]) {
    const up = style % 2 === 1 && s === 1 ? 0.9 : 0.25;
    const arm = new THREE.CylinderGeometry(0.014, 0.022, 0.55, 5);
    arm.translate(0, 0.275, 0);
    add(arm, mat(s * r1 * 0.85, y1 + 0.06, 0, 0, 0, -s * (Math.PI / 2 - up)), 0x5a3a24);
    const tipX = s * (r1 * 0.85 + Math.cos(up) * 0.55);
    const tipY = y1 + 0.06 + Math.sin(up) * 0.55;
    for (const f of [-0.5, 0.5]) {
      const tw = new THREE.CylinderGeometry(0.008, 0.012, 0.16, 4);
      tw.translate(0, 0.08, 0);
      add(tw, mat(tipX - s * 0.02, tipY - 0.02, 0, 0, 0, -s * (Math.PI / 2 - up) + f), 0x5a3a24);
    }
  }
  // Hat: a knitted bobble hat, or an upturned flowerpot.
  if (style % 2 === 0) {
    const hat = new THREE.SphereGeometry(r2 * 0.98, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    add(hat, mat(hx, y2 + r2 * 0.25, 0, -0.12, 0, lean * 1.6), 0xc8443a);
    const band = new THREE.TorusGeometry(r2 * 0.97, 0.035, 5, 16);
    band.rotateX(Math.PI / 2);
    add(band, mat(hx, y2 + r2 * 0.27, 0, -0.12, 0, lean * 1.6), 0xf2ead8);
    add(lumpySphere(0.06, 1, 0.1, rng), mat(hx - 0.02, y2 + r2 * 1.25, -0.03), 0xf2ead8);
  } else {
    add(bevelCylinder(0.12, 0.16, 0.2, 0.02, 12), mat(hx, y2 + r2 * 0.95, -0.01, -0.1, 0, 0.12), 0xb8643e);
    add(bevelCylinder(0.175, 0.175, 0.04, 0.012, 12), mat(hx, y2 + r2 * 0.82, -0.01, -0.1, 0, 0.12), 0xa8563a);
  }
}

/** Snowmen at [x, z, rot] (terrain height via `h`). */
export function buildSnowmen(rng: Rng, spots: [number, number, number][], h: (x: number, z: number) => number): THREE.Group {
  const b = new MeshBuilder();
  spots.forEach(([x, z, rot], i) => snowman(b, rng, x, h(x, z) - 0.04, z, rot, i));
  const g = b.build({ name: 'snowmen' });
  g.userData.perfTag = 'props';
  return g;
}
