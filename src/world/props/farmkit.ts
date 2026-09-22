/**
 * Farm prop kit — small hand-built pieces that make the homestead feel lived in:
 * sprinkler, scarecrow, wheelbarrow, watering can on a stump, hay bales, laundry line (cloth
 * sways in the wind), bird bath, beehive, tool rack, bench, seasonal harvest baskets /
 * pumpkins, potted plants, signpost, stepping stones, water trough, apple crate stack.
 * All bevelled primitives merged per material (MeshBuilder), local origin = ground center.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere, sphericalNormals, uvScale } from '../geom';
import { materials } from '../../render/materials';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';

const groundAO = (h = 0.35, min = 0.6) => (p: THREE.Vector3): number => min + (1 - min) * THREE.MathUtils.smoothstep(p.y, 0, h);

export function buildSprinkler(): THREE.Group {
  const b = new MeshBuilder();
  b.add('metal', bevelCylinder(0.16, 0.2, 0.08, 0.02, 12), undefined, { tint: 0xd8dde2 });
  b.add('metal', new THREE.CylinderGeometry(0.035, 0.045, 0.24, 8), mat(0, 0.18, 0), { tint: 0xf2c860 });
  b.add('metal', new THREE.SphereGeometry(0.06, 10, 8), mat(0, 0.31, 0), { tint: 0xffd878 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add('metal', roundedBox(0.16, 0.025, 0.03, 0.01), mat(Math.cos(a) * 0.09, 0.3, Math.sin(a) * 0.09, 0, -a, 0.25), { tint: 0xf2c860 });
  }
  return b.build({ name: 'sprinkler' });
}

export function buildScarecrow(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  b.add('woodGrain', roundedBox(0.1, 2.0, 0.1, 0.03), mat(0, 1.0, 0), { tint: 0xc8a070, aoWorld: groundAO(0.4) });
  b.add('woodGrain', roundedBox(1.35, 0.09, 0.09, 0.03), mat(0, 1.45, 0), { tint: 0xc8a070 });
  // Patched shirt body (cloth), straw poking out of cuffs
  b.add('cloth', roundedBox(0.62, 0.62, 0.3, 0.12), mat(0, 1.3, 0), { tint: 0x5c86a8 });
  b.add('cloth', roundedBox(0.2, 0.18, 0.02, 0.03), mat(0.12, 1.36, 0.155, 0, 0, 0.2), { tint: 0xd8b060 });
  for (const s of [-1, 1]) {
    b.add('cloth', roundedBox(0.42, 0.2, 0.22, 0.08), mat(s * 0.45, 1.45, 0), { tint: 0x4f7a9c });
    for (let i = 0; i < 5; i++) {
      const straw = new THREE.CylinderGeometry(0.008, 0.008, 0.2, 3);
      straw.rotateZ(Math.PI / 2 + (rng.next() - 0.5) * 0.8);
      b.add('white', straw, mat(s * (0.72 + rng.next() * 0.05), 1.45 + (rng.next() - 0.5) * 0.12, (rng.next() - 0.5) * 0.12), { tint: 0xe8c86a });
    }
  }
  // Rope belt + trousers
  b.add('cloth', new THREE.TorusGeometry(0.27, 0.025, 6, 16), mat(0, 1.02, 0, Math.PI / 2, 0, 0, 1, 0.55, 1), { tint: 0xb89060 });
  b.add('cloth', roundedBox(0.5, 0.3, 0.26, 0.1), mat(0, 0.86, 0), { tint: 0x8a6a4a });
  // Sack head with stitched face
  const head = lumpySphere(0.23, 2, 0.08, rng, 2);
  head.scale(1, 1.08, 0.95);
  b.add('cloth', head, mat(0, 1.9, 0), { tint: 0xe2c898 });
  for (const s of [-1, 1]) b.add('white', roundedBox(0.06, 0.06, 0.03, 0.02), mat(s * 0.08, 1.95, 0.205), { tint: 0x2a1c14 });
  for (let i = 0; i < 5; i++) b.add('white', roundedBox(0.02, 0.05, 0.02, 0.008), mat(-0.08 + i * 0.04, 1.83, 0.2, 0, 0, i % 2 ? 0.4 : -0.4), { tint: 0x2a1c14 });
  // Floppy hat
  b.add('thatch', new THREE.CylinderGeometry(0.38, 0.4, 0.04, 20), mat(0, 2.08, 0, 0.12, 0, 0.05), { tint: 0xd9b464 });
  b.add('thatch', new THREE.CylinderGeometry(0.17, 0.2, 0.2, 14), mat(0.01, 2.18, -0.02, 0.12, 0, 0.1), { tint: 0xd9b464 });
  b.add('cloth', new THREE.CylinderGeometry(0.205, 0.205, 0.05, 14, 1, true), mat(0.01, 2.12, -0.02, 0.12, 0, 0.1), { tint: 0xb8402e });
  // Crow perched on the arm
  b.add('white', lumpySphere(0.08, 1, 0.1, rng), mat(0.58, 1.57, 0, 0, 0, 0, 1.3, 0.9, 0.9), { tint: 0x22232a });
  b.add('white', new THREE.SphereGeometry(0.05, 8, 6), mat(0.66, 1.64, 0), { tint: 0x22232a });
  b.add('white', new THREE.ConeGeometry(0.018, 0.06, 5), mat(0.72, 1.64, 0, 0, 0, -Math.PI / 2), { tint: 0xe0a030 });
  return b.build({ name: 'scarecrow' });
}

export function buildWheelbarrow(): THREE.Group {
  const b = new MeshBuilder();
  // Tray: a tapered, bevelled tub (painted sage) tipped slightly forward, full of dark soil.
  const tub = new THREE.CylinderGeometry(0.46, 0.3, 0.34, 4, 1, false);
  tub.rotateY(Math.PI / 4);
  tub.scale(1.25, 1, 0.85);
  b.add('woodPaint', tub, mat(0.05, 0.55, 0, 0, 0, -0.08), { tint: 0x6f9a74, aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, 0.38, 0.7) });
  const rim = new THREE.TorusGeometry(0.46, 0.025, 5, 4);
  rim.rotateX(Math.PI / 2);
  rim.rotateY(Math.PI / 4);
  rim.scale(1.25, 1, 0.85);
  b.add('metal', rim, mat(0.05, 0.72, 0, 0, 0, -0.08), { tint: 0x9aa4ac });
  const soil = lumpySphere(0.34, 1, 0.18, new Rng('barrow'), 3);
  soil.scale(1.2, 0.3, 0.8);
  b.add('white', soil, mat(0.05, 0.72, 0), { tint: 0x4a3020 });
  // Handles + legs, wheel under the front lip
  for (const s of [-1, 1]) {
    b.add('woodGrain', roundedBox(1.3, 0.055, 0.055, 0.02), mat(-0.22, 0.46, s * 0.2, 0, 0, 0.14), { tint: 0xb88a5a });
    b.add('woodDark', roundedBox(0.05, 0.4, 0.05, 0.015), mat(-0.36, 0.22, s * 0.2, 0, 0, 0.12));
    b.add('woodGrain', roundedBox(0.16, 0.06, 0.06, 0.02), mat(-0.86, 0.54, s * 0.2), { tint: 0x7a5a3a });
  }
  b.add('metal', new THREE.CylinderGeometry(0.035, 0.035, 0.46, 8), mat(0.52, 0.22, 0, Math.PI / 2, 0, 0));
  const tyre = new THREE.TorusGeometry(0.17, 0.05, 8, 20);
  b.add('woodDark', tyre, mat(0.52, 0.22, 0), { tint: 0x3a3a3a });
  b.add('metal', new THREE.CylinderGeometry(0.12, 0.12, 0.05, 14), mat(0.52, 0.22, 0, Math.PI / 2, 0, 0), { tint: 0xc8403a });
  return b.build({ name: 'wheelbarrow' });
}

export function buildWateringCanOnStump(): THREE.Group {
  const b = new MeshBuilder();
  const stump = bevelCylinder(0.26, 0.3, 0.42, 0.04, 12);
  uvScale(stump, 3, 1);
  b.add('bark', stump, undefined, { aoWorld: groundAO(0.25) });
  const top = new THREE.CircleGeometry(0.24, 16);
  top.rotateX(-Math.PI / 2);
  b.add('woodPaint', top, mat(0, 0.425, 0), { tint: 0xd8b07a });
  const can = bevelCylinder(0.11, 0.13, 0.2, 0.02, 14);
  b.add('woodPaint', can, mat(0, 0.43, 0), { tint: 0x7fb0c8 });
  const spout = new THREE.CylinderGeometry(0.018, 0.028, 0.28, 8);
  b.add('woodPaint', spout, mat(0.17, 0.56, 0, 0, 0, -0.9), { tint: 0x7fb0c8 });
  b.add('woodPaint', new THREE.CylinderGeometry(0.045, 0.03, 0.04, 10), mat(0.29, 0.645, 0, 0, 0, -0.9), { tint: 0x6a98b0 });
  b.add('woodPaint', new THREE.TorusGeometry(0.09, 0.015, 6, 14, Math.PI), mat(-0.02, 0.63, 0), { tint: 0x6a98b0 });
  return b.build({ name: 'watering-can-stump' });
}

export function buildHayBale(rng: Rng, round = false): THREE.Group {
  const b = new MeshBuilder();
  const straw = materials.get('thatch');
  if (round) {
    const g = bevelCylinder(0.55, 0.55, 0.8, 0.12, 20);
    g.rotateZ(Math.PI / 2);
    g.translate(0.4, 0.55, 0);
    uvScale(g, 3, 1.5);
    b.add(straw, g, undefined, { tint: 0xe6c778, aoWorld: groundAO(0.4, 0.55) });
  } else {
    const g = boxUV(roundedBox(1.0, 0.5, 0.6, 0.1, 3), 1.6);
    b.add(straw, g, mat(0, 0.25, 0), { tint: 0xe8ca7a, aoWorld: groundAO(0.3, 0.55) });
    for (const x of [-0.25, 0.25]) b.add('cloth', roundedBox(0.035, 0.52, 0.62, 0.015), mat(x, 0.25, 0), { tint: 0xa8804a });
  }
  for (let i = 0; i < 10; i++) {
    const s = new THREE.CylinderGeometry(0.006, 0.006, 0.18, 3);
    s.rotateZ((rng.next() - 0.5) * 1.6);
    b.add('white', s, mat((rng.next() - 0.5) * 0.9, 0.03, (rng.next() - 0.5) * 0.7, 0, rng.next() * 3, Math.PI / 2 - 0.2), { tint: 0xe0c070 });
  }
  return b.build({ name: 'hay' });
}

/** Laundry line between two posts; the cloth pieces sway (wind attribute) and cast swaying shadows. */
export function buildLaundryLine(rng: Rng, length = 3.2): THREE.Group {
  const b = new MeshBuilder();
  for (const x of [-length / 2, length / 2]) {
    b.add('woodGrain', roundedBox(0.09, 1.75, 0.09, 0.03), mat(x, 0.87, 0), { tint: 0xc8a070, aoWorld: groundAO() });
    b.add('woodGrain', roundedBox(0.06, 0.06, 0.42, 0.02), mat(x, 1.68, 0), { tint: 0xc8a070 });
  }
  const group = b.build({ name: 'laundry-posts' });
  // Sagging lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9 });
  for (const z of [-0.15, 0.15]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector3(-length / 2 + t * length, 1.66 - Math.sin(t * Math.PI) * 0.12, z));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.008, 4), lineMat);
    tube.castShadow = true;
    group.add(tube);
  }
  // Cloth: sheets / shirts / socks hanging from the front line
  const colors = [0xf4efe4, 0xe08a6a, 0x7fb0d8, 0xf2d36a, 0xa8c890, 0xf4efe4];
  const pos: number[] = [];
  const col: number[] = [];
  const wind: number[] = [];
  const nor: number[] = [];
  let x = -length / 2 + 0.25;
  while (x < length / 2 - 0.35) {
    const w = 0.28 + rng.next() * 0.45;
    const h = 0.35 + rng.next() * 0.45;
    const c = new THREE.Color(colors[Math.floor(rng.next() * colors.length)]!);
    const segX = 4;
    const segY = 4;
    const t0 = (x + length / 2) / length;
    const top = 1.66 - Math.sin(t0 * Math.PI) * 0.12 - 0.01;
    const quad = (i: number, j: number): [number, number, number, number, number] => {
      const px = x + (i / segX) * w;
      const py = top - (j / segY) * h;
      const pz = -0.15 + Math.sin((i / segX) * Math.PI * 2) * 0.015;
      const shade = 0.85 + 0.15 * Math.cos((i / segX) * Math.PI * 2) - (j / segY) * 0.08;
      return [px, py, pz, (j / segY) * 0.9 + 0.1, shade];
    };
    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = quad(i, j);
        const bb = quad(i + 1, j);
        const cc = quad(i + 1, j + 1);
        const d = quad(i, j + 1);
        for (const v of [a, d, cc, a, cc, bb]) {
          pos.push(v[0], v[1], v[2]);
          col.push(c.r * v[4], c.g * v[4], c.b * v[4]);
          wind.push(v[3] * v[3]);
          nor.push(0, 0.3, 1);
        }
      }
    }
    // pegs
    x += w + 0.1 + rng.next() * 0.15;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 1));
  const clothOpts = { mode: 'attribute' as const, amplitude: 0.16, flutter: 0.9 };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  m.name = 'laundry';
  applyWorldFx(m, { snowUp: 0.9 });
  applyWind(m, clothOpts);
  const cloth = new THREE.Mesh(g, m);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  cloth.customDepthMaterial = windDepthMaterial(clothOpts);
  group.add(cloth);
  return group;
}

export function buildBirdBath(): THREE.Group {
  const b = new MeshBuilder();
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.24, 0),
    new THREE.Vector2(0.24, 0.06),
    new THREE.Vector2(0.12, 0.12),
    new THREE.Vector2(0.09, 0.55),
    new THREE.Vector2(0.14, 0.65),
    new THREE.Vector2(0.38, 0.72),
    new THREE.Vector2(0.4, 0.8),
    new THREE.Vector2(0.33, 0.8),
    new THREE.Vector2(0.3, 0.74),
    new THREE.Vector2(0, 0.74),
  ];
  const g = new THREE.LatheGeometry(pts, 20);
  boxUV(g, 2);
  b.add('rock', g, undefined, { tint: 0xe8e2d8, aoWorld: groundAO(0.3, 0.55) });
  const water = new THREE.CircleGeometry(0.31, 20);
  water.rotateX(-Math.PI / 2);
  b.add('stillWater', water, mat(0, 0.765, 0));
  return b.build({ name: 'bird-bath' });
}

export function buildBeehive(): THREE.Group {
  const b = new MeshBuilder();
  b.add('woodDark', roundedBox(0.62, 0.3, 0.62, 0.04), mat(0, 0.15, 0));
  const tones = [0xf2d38a, 0xe8c070, 0xf6dd98];
  for (let i = 0; i < 3; i++) b.add('woodPaint', boxUV(roundedBox(0.54, 0.24, 0.54, 0.035), 2), mat(0, 0.42 + i * 0.25, 0), { tint: tones[i]! });
  const roof = roundedBox(0.72, 0.08, 0.72, 0.03);
  b.add('woodPaint', roof, mat(0, 1.11, 0), { tint: 0xd8dde0 });
  b.add('woodDark', roundedBox(0.2, 0.03, 0.04, 0.01), mat(0, 0.32, 0.28));
  return b.build({ name: 'beehive' });
}

export function buildToolRack(): THREE.Group {
  const b = new MeshBuilder();
  for (const x of [-0.6, 0.6]) b.add('woodGrain', roundedBox(0.1, 1.3, 0.1, 0.03), mat(x, 0.65, 0), { tint: 0xb88a5a, aoWorld: groundAO() });
  b.add('woodGrain', roundedBox(1.35, 0.1, 0.08, 0.03), mat(0, 1.2, 0), { tint: 0xb88a5a });
  b.add('woodGrain', roundedBox(1.35, 0.08, 0.08, 0.03), mat(0, 0.45, 0), { tint: 0xb88a5a });
  // Rake, shovel, pitchfork leaning on the rack
  const tools: [number, number][] = [[-0.35, 0.18], [0.0, -0.12], [0.35, 0.1]];
  tools.forEach(([x, lean], i) => {
    b.add('woodGrain', new THREE.CylinderGeometry(0.022, 0.025, 1.4, 6), mat(x, 0.7, 0.1, -0.15, 0, lean), { tint: 0xc89a64 });
    const hx = x - Math.sin(lean) * 0.05;
    if (i === 0) {
      b.add('metal', roundedBox(0.34, 0.04, 0.04, 0.01), mat(hx, 0.05, 0.12, -0.15, 0, lean));
      for (let k = 0; k < 6; k++) b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), mat(hx - 0.15 + k * 0.06, 0.0, 0.13, -0.15, 0, lean));
    } else if (i === 1) {
      b.add('metal', roundedBox(0.2, 0.28, 0.03, 0.04), mat(hx, 0.08, 0.12, -0.15, 0, lean), { tint: 0xa0a8b0 });
    } else {
      for (let k = -1; k <= 1; k++) b.add('metal', new THREE.CylinderGeometry(0.01, 0.006, 0.26, 4), mat(hx + k * 0.05, 0.02, 0.12, -0.15, 0, lean));
    }
  });
  return b.build({ name: 'tool-rack' });
}

export function buildBench(): THREE.Group {
  const b = new MeshBuilder();
  for (let i = 0; i < 3; i++) b.add('woodGrain', roundedBox(1.5, 0.06, 0.14, 0.025), mat(0, 0.45, -0.16 + i * 0.16), { tint: 0xc89a64 });
  for (let i = 0; i < 2; i++) b.add('woodGrain', roundedBox(1.5, 0.12, 0.05, 0.025), mat(0, 0.72 + i * 0.18, -0.26, -0.15, 0, 0), { tint: 0xc89a64 });
  for (const x of [-0.62, 0.62]) {
    b.add('woodDark', roundedBox(0.08, 0.45, 0.4, 0.03), mat(x, 0.22, -0.02));
    b.add('woodDark', roundedBox(0.07, 0.6, 0.07, 0.02), mat(x, 0.72, -0.27, -0.15, 0, 0));
  }
  return b.build({ name: 'bench' });
}

/** Seasonal harvest display: pumpkins (fall), baskets of greens (spring), produce crates (summer). */
export function buildHarvestPile(rng: Rng, kind: 'pumpkins' | 'basket' | 'crate'): THREE.Group {
  const b = new MeshBuilder();
  if (kind === 'pumpkins') {
    const n = 3 + rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const r = 0.16 + rng.next() * 0.14;
      const g = new THREE.SphereGeometry(r, 16, 10);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        const z = pos.getZ(k);
        const a = Math.atan2(z, x);
        const f = 1 - 0.08 * (0.5 - 0.5 * Math.cos(a * 9));
        pos.setXYZ(k, x * f, pos.getY(k) * 0.75, z * f);
      }
      g.computeVertexNormals();
      const a = (i / n) * Math.PI * 2;
      const tint = [0xe8741e, 0xf09a2e, 0xd86a1a, 0xf2e6c8][i % 4]!;
      b.add('white', g, mat(Math.cos(a) * 0.3 * (i ? 1 : 0), r * 0.72, Math.sin(a) * 0.3 * (i ? 1 : 0)), { tint, aoWorld: (p) => 0.65 + 0.35 * THREE.MathUtils.smoothstep(p.y, 0, 0.2) });
      b.add('woodDark', new THREE.CylinderGeometry(0.02, 0.028, 0.08, 6), mat(Math.cos(a) * 0.3 * (i ? 1 : 0), r * 1.48, Math.sin(a) * 0.3 * (i ? 1 : 0), 0.2, 0, 0.2), { tint: 0x6a7a3a });
    }
  } else if (kind === 'basket') {
    const g = new THREE.CylinderGeometry(0.28, 0.22, 0.26, 16, 1, true);
    b.add('thatch', g, mat(0, 0.13, 0), { tint: 0xc89858 });
    b.add('thatch', new THREE.CircleGeometry(0.22, 16).rotateX(-Math.PI / 2), mat(0, 0.01, 0), { tint: 0x8a6438 });
    b.add('thatch', new THREE.TorusGeometry(0.28, 0.03, 6, 18), mat(0, 0.26, 0, Math.PI / 2, 0, 0), { tint: 0xa87a44 });
    b.add('thatch', new THREE.TorusGeometry(0.25, 0.02, 6, 18, Math.PI), mat(0, 0.26, 0, 0, 0.3, 0), { tint: 0xa87a44 });
    for (let i = 0; i < 7; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = rng.next() * 0.15;
      const leafy = lumpySphere(0.09, 1, 0.3, rng, 3);
      b.add('white', leafy, mat(Math.cos(a) * d, 0.28, Math.sin(a) * d), { tint: i % 3 ? 0x6fae45 : 0xf2dfa8 });
    }
  } else {
    b.add('wood', boxUV(roundedBox(0.6, 0.34, 0.45, 0.03), 1.4), mat(0, 0.17, 0), { tint: 0xe0b484, aoWorld: groundAO(0.2) });
    for (let i = 0; i < 9; i++) {
      const g = new THREE.SphereGeometry(0.07, 10, 8);
      b.add('white', g, mat(-0.18 + (i % 3) * 0.18, 0.36, -0.12 + Math.floor(i / 3) * 0.12), { tint: rng.next() < 0.6 ? 0xe4432e : 0xf2c43a });
    }
  }
  return b.build({ name: `harvest-${kind}` });
}

export function buildFlowerPot(rng: Rng, color: number): THREE.Group {
  const b = new MeshBuilder();
  b.add('soilPot', bevelCylinder(0.17, 0.13, 0.26, 0.03, 12), undefined, { aoWorld: groundAO(0.15) });
  b.add('white', new THREE.CircleGeometry(0.15, 12).rotateX(-Math.PI / 2), mat(0, 0.25, 0), { tint: 0x4a3222 });
  for (let i = 0; i < 5; i++) {
    const leaf = lumpySphere(0.08, 1, 0.3, rng);
    b.add('white', leaf, mat((rng.next() - 0.5) * 0.16, 0.32 + rng.next() * 0.06, (rng.next() - 0.5) * 0.16), { tint: 0x4f9a3a });
  }
  for (let i = 0; i < 4; i++) {
    b.add('white', new THREE.SphereGeometry(0.045, 8, 6), mat((rng.next() - 0.5) * 0.18, 0.4 + rng.next() * 0.05, (rng.next() - 0.5) * 0.18), { tint: color });
  }
  return b.build({ name: 'flower-pot' });
}

export function buildSignpost(): THREE.Group {
  const b = new MeshBuilder();
  b.add('woodGrain', roundedBox(0.1, 1.4, 0.1, 0.03), mat(0, 0.7, 0), { tint: 0xb88a5a, aoWorld: groundAO() });
  b.add('woodPaint', roundedBox(0.8, 0.24, 0.05, 0.04), mat(0.2, 1.2, 0.06, 0, 0, 0.04), { tint: 0xe8d8b8 });
  b.add('woodPaint', new THREE.ConeGeometry(0.12, 0.2, 3), mat(0.66, 1.2, 0.06, 0, 0, -Math.PI / 2), { tint: 0xe8d8b8 });
  b.add('woodPaint', roundedBox(0.7, 0.2, 0.05, 0.04), mat(-0.15, 0.9, 0.06, 0, 0, -0.05), { tint: 0xd8c8a8 });
  for (let i = 0; i < 4; i++) b.add('white', roundedBox(0.1, 0.03, 0.01, 0.005), mat(0.0 + i * 0.13, 1.2, 0.09), { tint: 0x5a4030 });
  return b.build({ name: 'signpost' });
}

export function buildTrough(): THREE.Group {
  const b = new MeshBuilder();
  b.add('wood', boxUV(roundedBox(1.3, 0.4, 0.55, 0.05), 1.4), mat(0, 0.28, 0), { tint: 0xc89a64, aoWorld: groundAO(0.3) });
  for (const x of [-0.5, 0.5]) b.add('woodDark', roundedBox(0.12, 0.14, 0.6, 0.03), mat(x, 0.07, 0));
  b.add('stillWater', roundedBox(1.18, 0.02, 0.43, 0.01), mat(0, 0.45, 0));
  return b.build({ name: 'trough' });
}

/** Round stepping stones along a polyline (flat, set into the grass). */
export function buildSteppingStones(points: [number, number][], heightAt: (x: number, z: number) => number, rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (const [x, z] of points) {
    const r = 0.26 + rng.next() * 0.1;
    const g = lumpySphere(r, 2, 0.12, rng, 2);
    g.scale(1, 0.12, 0.85);
    sphericalNormals(g, new THREE.Vector3(0, -r, 0), 0.3);
    boxUV(g, 2);
    b.add('rock', g, mat(x, heightAt(x, z) - 0.005, z, 0, rng.next() * 3, 0), { tint: 0xa8a092 });
  }
  return b.build({ name: 'stepping-stones' });
}

/** Winter-only: a jolly snowman with coal eyes, carrot nose, twig arms, scarf and bucket hat. */
export function buildSnowman(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const snow = 0xf4f7fc;
  const ys = [0.34, 0.86, 1.28];
  const rs = [0.42, 0.32, 0.23];
  ys.forEach((y, i) => {
    const g = lumpySphere(rs[i]!, 2, 0.05, rng, 2);
    b.add('white', g, mat(0, y, 0), { tint: snow, aoWorld: (p) => 0.78 + 0.22 * THREE.MathUtils.smoothstep(p.y, y - rs[i]!, y) });
  });
  for (const sx of [-1, 1]) b.add('white', new THREE.SphereGeometry(0.03, 8, 6), mat(sx * 0.08, 1.34, 0.2), { tint: 0x1a1a1e });
  for (let i = 0; i < 5; i++) {
    const a = -0.5 + i * 0.25;
    b.add('white', new THREE.SphereGeometry(0.018, 6, 4), mat(Math.sin(a) * 0.12, 1.2 - Math.cos(a) * 0.02 + Math.abs(a) * 0.05, 0.2), { tint: 0x1a1a1e });
  }
  for (let i = 0; i < 3; i++) b.add('white', new THREE.SphereGeometry(0.028, 8, 6), mat(0, 0.78 + i * 0.12, 0.31 - i * 0.015), { tint: 0x1a1a1e });
  const nose = new THREE.ConeGeometry(0.035, 0.22, 8);
  nose.rotateX(Math.PI / 2);
  b.add('white', nose, mat(0, 1.27, 0.32), { tint: 0xf07a20 });
  for (const sx of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.014, 0.02, 0.62, 5);
    b.add('woodDark', arm, mat(sx * 0.5, 1.0, 0, 0, 0, sx * -1.05));
    b.add('woodDark', new THREE.CylinderGeometry(0.008, 0.01, 0.16, 4), mat(sx * 0.7, 1.16, 0, 0, 0, sx * -0.3));
  }
  b.add('cloth', new THREE.TorusGeometry(0.22, 0.05, 8, 18), mat(0, 1.1, 0, Math.PI / 2, 0, 0), { tint: 0xc8402e });
  b.add('cloth', roundedBox(0.09, 0.26, 0.03, 0.02), mat(0.12, 0.98, 0.2, 0.2, 0, 0.15), { tint: 0xc8402e });
  b.add('metal', bevelCylinder(0.13, 0.16, 0.2, 0.02, 14), mat(0.02, 1.47, -0.02, -0.15, 0, 0.12), { tint: 0x6a7f94 });
  return b.build({ name: 'snowman' });
}
