/**
 * Festival prop kit (same conventions as props/townkit.ts: MeshBuilder per material, origin =
 * ground centre, +Z = front). Static pieces are merged by the festival map; moving pieces (floats,
 * the lighthouse beam) are returned as their own groups.
 *
 * Spring: flower floats, flower arch, bandstand, blossom pole.
 * Summer: pier with lantern posts, cabanas, beach umbrellas, bonfire, lighthouse, boats, blankets.
 * Fall:   giant contest pumpkins + rosettes, show stage with banner, marquee tent, corn stalks,
 *         sack-race gate, apple-bobbing tub, cider press, produce stalls.
 * Winter: the Starfall tree (ornaments, garlands, star), gift piles, ice sculptures, stone bridge,
 *         cocoa stand.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere, sphericalNormals, uvScale, groundAO, prep } from '../geom';
import { materials } from '../../render/materials';
import { applyWorldFx } from '../../render/worldfx';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { catenary, FESTIVAL_COLORS } from '../props/festival';

export const PASTELS = [0xf7a8c0, 0xfde2a0, 0xb8e0f0, 0xd4b8f0, 0xc0e8b0, 0xffffff, 0xffc4a8];

function flowerHead(b: MeshBuilder, x: number, y: number, z: number, color: number, s = 1, rng?: Rng): void {
  const g = new THREE.IcosahedronGeometry(0.07 * s, 0);
  g.scale(1, 0.75, 1);
  b.add('boxFlower', g, mat(x, y, z, rng ? rng.next() : 0, rng ? rng.next() * 3 : 0, 0), { tint: color });
}

/** Mound of foliage studded with blooms (used on floats, arches, bandstand). */
function bloomMound(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, r: number, colors: readonly number[], density = 1): void {
  // Small mounds read fine as a lumpy icosahedron (20 tris); big ones get one subdivision.
  const leaf = lumpySphere(r, r < 0.25 ? 0 : 1, 0.22, rng, 2);
  sphericalNormals(leaf, new THREE.Vector3(), 0.5);
  b.add('boxFlower', leaf, mat(x, y, z), { tint: 0x4f9a3a, aoWorld: (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, y - r, y + r * 0.5) });
  const n = Math.round(10 * r * r * 12 * density);
  for (let i = 0; i < n; i++) {
    const u = rng.next() * Math.PI * 2;
    const v = Math.acos(1 - rng.next() * 1.3);
    const px = x + Math.sin(v) * Math.cos(u) * r * 0.98;
    const py = y + Math.cos(v) * r * 0.95;
    const pz = z + Math.sin(v) * Math.sin(u) * r * 0.98;
    flowerHead(b, px, py, pz, colors[i % colors.length]!, 0.9 + rng.next() * 0.6, rng);
  }
}

function wheel(b: MeshBuilder, x: number, y: number, z: number, r: number, tint = 0x7a5234): void {
  const rim = new THREE.TorusGeometry(r, 0.05, 6, 20);
  b.add('woodDark', rim, mat(x, y, z), { tint });
  b.add('metal', new THREE.TorusGeometry(r + 0.02, 0.02, 4, 20), mat(x, y, z), { tint: 0x3a3430 });
  for (let k = 0; k < 6; k++) b.add('woodDark', roundedBox(0.04, r * 2 - 0.04, 0.03, 0.01, 1), mat(x, y, z, 0, 0, (k / 6) * Math.PI), { tint });
  b.add('woodDark', bevelCylinder(0.08, 0.08, 0.12, 0.02, 8), mat(x, y, z - 0.06, Math.PI / 2, 0, 0), { tint: 0x5a3a24 });
}

// ═════════════════════════════════════════════ SPRING

/** Builder that folds every non-foliage material into one painted-wood material (moving props: 2 draw calls). */
class PaintBuilder extends MeshBuilder {
  override add(material: Parameters<MeshBuilder['add']>[0], geo: THREE.BufferGeometry, matrix?: THREE.Matrix4, opts: Parameters<MeshBuilder['add']>[3] = {}): this {
    const keep = material === 'boxFlower' || material === 'lampGlow' || material === 'paperLantern';
    const dim = material === 'woodDark' ? 0.62 : material === 'bark' ? 0.7 : material === 'metal' ? 0.4 : 1;
    const t = new THREE.Color(opts.tint ?? 0xffffff).multiplyScalar(dim);
    return super.add(keep ? material : 'woodPaint', geo, matrix, { ...opts, tint: t });
  }
}

/**
 * Parade float: a flower-skirted wagon on four spoked wheels with a centrepiece.
 * kind: 'tulip' (giant tulip bouquet), 'tree' (blossom tree), 'throne' (heart arch + seat for the
 * Blossom Queen; anchor `seat`). Origin = centre on the ground, float faces +X (direction of travel).
 */
export function buildFlowerFloat(rng: Rng, kind: 'tulip' | 'tree' | 'throne' | 'swan'): { group: THREE.Group; anchors: Record<string, THREE.Vector3> } {
  const b = new PaintBuilder();
  const L = 3.4;
  const W = 1.9;
  const deckY = 0.72;
  const anchors: Record<string, THREE.Vector3> = {};
  b.add('wood', boxUV(roundedBox(L, 0.16, W, 0.05), 1.2), mat(0, deckY, 0), { tint: 0xd8b890 });
  // Flower skirt: rows of blooms hiding the chassis, pastel bands.
  const bands = kind === 'throne' ? [0xf2e8e4, 0xf7a8c0, 0xf06a8a] : kind === 'tulip' ? [0xfde2a0, 0xffc4a8, 0xf7a8c0] : kind === 'swan' ? [0xb8e0f0, 0xffffff, 0xd4b8f0] : [0xffffff, 0xf7c6d6, 0xc0e8b0];
  for (let row = 0; row < 3; row++) {
    const y = deckY - 0.08 - row * 0.16;
    for (const sz of [-1, 1]) {
      for (let i = 0; i <= 15; i++) flowerHead(b, -L / 2 + ((i + (row % 2) * 0.5) / 15.5) * L, y + (rng.next() - 0.5) * 0.04, sz * (W / 2 + 0.03), bands[row]!, 1.6, rng);
    }
    for (const sx of [-1, 1]) for (let i = 0; i <= 8; i++) flowerHead(b, sx * (L / 2 + 0.03), y + (rng.next() - 0.5) * 0.04, -W / 2 + ((i + (row % 2) * 0.5) / 8.5) * W, bands[row]!, 1.6, rng);
  }
  b.add('boxFlower', roundedBox(L - 0.1, 0.46, W - 0.1, 0.06, 1), mat(0, deckY - 0.26, 0), { tint: 0x3f7a2e });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(b, sx * 1.05, 0.38, sz * (W / 2 + 0.12), 0.36);
  // Deck rim garland.
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const per = 2 * (L + W);
    let d = t * per;
    let x = -L / 2;
    let z = -W / 2;
    if (d < L) x += d;
    else if ((d -= L) < W) (x = L / 2), (z += d);
    else if ((d -= W) < L) (x = L / 2 - d), (z = W / 2);
    else (d -= L), (z = W / 2 - d);
    bloomMound(b, rng, x, deckY + 0.12, z, 0.12, [bands[i % 3]!], 0.4);
  }
  if (kind === 'tulip') {
    // Giant tulips in a green bundle.
    const tints = [0xf04a6a, 0xfde070, 0xff9ab8, 0xf57a3a, 0xffffff];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.45;
      const x = Math.cos(a) * r * (i ? 1 : 0);
      const z = Math.sin(a) * r * (i ? 1 : 0);
      const h = i === 0 ? 2.1 : 1.5 + rng.next() * 0.3;
      const lean = i === 0 ? 0 : 0.18;
      b.add('boxFlower', bevelCylinder(0.05, 0.06, h, 0.01, 6), mat(x, deckY + 0.08, z, Math.sin(a) * lean, 0, -Math.cos(a) * lean), { tint: 0x4f9a3a });
      const tx = x + Math.cos(a) * lean * h * (i ? 1 : 0);
      const tz = z + Math.sin(a) * lean * h * (i ? 1 : 0);
      const ty = deckY + 0.08 + h;
      for (let p = 0; p < 6; p++) {
        const pa = (p / 6) * Math.PI * 2;
        const pet = new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
        pet.scale(0.62, 1.35, 0.4);
        b.add('boxFlower', pet, mat(tx + Math.cos(pa) * 0.1, ty - 0.18, tz + Math.sin(pa) * 0.1, 0, -pa + Math.PI / 2, -0.15), { tint: tints[i]! });
      }
      for (const s of [-1, 1]) {
        const leaf = new THREE.SphereGeometry(0.2, 8, 6);
        leaf.scale(0.3, 1.8, 0.08);
        b.add('boxFlower', leaf, mat(x + s * 0.12, deckY + 0.5, z, 0, a, s * 0.45), { tint: 0x5aa83e });
      }
    }
    bloomMound(b, rng, 0, deckY + 0.3, 0, 0.55, [0xffffff, 0xfde2a0], 0.6);
  } else if (kind === 'tree') {
    b.add('bark', bevelCylinder(0.14, 0.2, 1.6, 0.03, 8), mat(0, deckY, 0), { tint: 0x8a6a5a });
    for (let i = 0; i < 3; i++) b.add('bark', bevelCylinder(0.05, 0.08, 0.7, 0.02, 6), mat(0, deckY + 1.2, 0, 0.6, (i / 3) * 6.28, 0), { tint: 0x8a6a5a });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.6;
      const g = lumpySphere(0.55 + rng.next() * 0.15, 1, 0.18, rng, 2);
      sphericalNormals(g, new THREE.Vector3(), 0.6);
      b.add('boxFlower', g, mat(Math.cos(a) * r, deckY + 2.0 + (i ? (rng.next() - 0.3) * 0.4 : 0.35), Math.sin(a) * r), { tint: [0xf7c6d6, 0xfad4e0, 0xf2b0c8][i % 3]! });
    }
    for (let i = 0; i < 40; i++) flowerHead(b, (rng.next() - 0.5) * 1.8, deckY + 1.8 + rng.next() * 0.9, (rng.next() - 0.5) * 1.6, 0xffffff, 0.8, rng);
    // Picnic of ribbons around the trunk base.
    bloomMound(b, rng, 0.9, deckY + 0.2, 0.4, 0.32, PASTELS);
    bloomMound(b, rng, -0.9, deckY + 0.2, -0.3, 0.3, PASTELS);
  } else if (kind === 'throne') {
    // Heart-shaped arch of roses behind a white seat that faces the crowd (+Z).
    const seatX = -0.2;
    b.add('woodPaint', roundedBox(0.9, 0.12, 0.7, 0.04), mat(seatX, deckY + 0.5, 0), { tint: 0xf0a8b8 });
    b.add('woodPaint', roundedBox(0.9, 0.9, 0.12, 0.04), mat(seatX, deckY + 0.85, -0.36), { tint: 0xf0a8b8 });
    for (const sx of [-1, 1]) b.add('woodPaint', roundedBox(0.1, 0.1, 0.7, 0.03), mat(seatX + sx * 0.42, deckY + 0.72, 0), { tint: 0xe8d8c8 });
    b.add('woodPaint', roundedBox(0.8, 0.44, 0.6, 0.05), mat(seatX, deckY + 0.24, 0), { tint: 0xe4d4c4 });
    anchors.seat = new THREE.Vector3(seatX, deckY + 0.34, 0.02);
    for (let i = 0; i <= 26; i++) {
      const t = (i / 26) * Math.PI * 2;
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      bloomMound(b, rng, seatX + hx * 0.075, deckY + 1.75 + hy * 0.07, -0.55, 0.2, i % 2 ? [0xf04a6a, 0xff8fab] : [0xffffff, 0xf7a8c0], 0.8);
    }
    bloomMound(b, rng, 1.15, deckY + 0.3, 0.3, 0.42, [0xf04a6a, 0xffffff, 0xff8fab]);
    bloomMound(b, rng, -1.25, deckY + 0.25, 0.4, 0.34, [0xffffff, 0xf7a8c0]);
  } else {
    // A swan of white petals with a pink beak, wings raised.
    const body = lumpySphere(0.75, 2, 0.06, rng, 2);
    body.scale(1.5, 0.75, 0.95);
    b.add('boxFlower', body, mat(0.1, deckY + 0.65, 0), { tint: 0xe8e0d8 });
    for (const s of [-1, 1]) {
      const wing = lumpySphere(0.6, 1, 0.12, rng, 2);
      wing.scale(1.4, 0.5, 0.35);
      b.add('boxFlower', wing, mat(-0.1, deckY + 1.2, s * 0.62, s * 0.7, 0, 0.45), { tint: 0xe6ded6 });
    }
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const x = 1.05 + Math.sin(t * 2.4) * 0.3 - t * 0.1;
      const y = deckY + 0.9 + t * 1.3;
      b.add('boxFlower', new THREE.SphereGeometry(0.17 - t * 0.05, 10, 8), mat(x, y, 0), { tint: 0xe8e0d8 });
    }
    b.add('boxFlower', new THREE.SphereGeometry(0.16, 10, 8), mat(1.05, deckY + 2.3, 0), { tint: 0xe8e0d8 });
    const beak = new THREE.ConeGeometry(0.07, 0.28, 8);
    beak.rotateZ(-Math.PI / 2);
    b.add('boxFlower', beak, mat(1.28, deckY + 2.27, 0), { tint: 0xf5a03a });
    for (const s of [-1, 1]) b.add('white', new THREE.SphereGeometry(0.03, 6, 4), mat(1.15, deckY + 2.35, s * 0.1), { tint: 0x1a1a1e });
    for (let i = 0; i < 30; i++) flowerHead(b, 0.1 + (rng.next() - 0.5) * 1.8, deckY + 0.95 + rng.next() * 0.2, (rng.next() - 0.5) * 1.1, [0xf7a8c0, 0xd4b8f0, 0xb8e0f0][i % 3]!, 1, rng);
  }
  // Pennant pole at the back.
  b.add('woodGrain', bevelCylinder(0.03, 0.03, 2.6, 0.01, 6), mat(-L / 2 + 0.2, deckY, 0), { tint: 0xd8b060 });
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.lineTo(0.7, -0.14);
  flag.lineTo(0, -0.34);
  flag.closePath();
  b.add('cloth', new THREE.ShapeGeometry(flag), mat(-L / 2 + 0.2, deckY + 2.55, 0.0, 0, Math.PI, 0), { tint: bands[2]! });
  return { group: b.build({ name: `float-${kind}` }), anchors };
}

/**
 * Blossom pole: tall white-and-rose striped pole on a stone drum, a big flower crown with a
 * ribbon ring (the ribbons themselves are dynamic, held by the dancers). Returns the crown anchor.
 */
export function buildBlossomPole(rng: Rng, H = 5.2): { group: THREE.Group; crown: THREE.Vector3 } {
  const b = new MeshBuilder();
  b.add('stone', boxUV(bevelCylinder(0.55, 0.65, 0.35, 0.06, 14), 1), mat(0, 0, 0), { tint: 0xd8d0c2, aoWorld: groundAO(0.2) });
  b.add('woodPaint', bevelCylinder(0.09, 0.12, H, 0.02, 12), mat(0, 0.3, 0), { tint: 0xf0e8dc });
  for (let i = 0; i < 30; i++) {
    const y = 0.5 + i * (H - 0.8) / 30;
    const band = new THREE.TorusGeometry(0.105, 0.02, 4, 12, Math.PI * 0.9);
    band.rotateX(Math.PI / 2 + 0.35);
    b.add('cloth', band, mat(0, y, 0, 0, i * 0.9, 0), { tint: i % 2 ? 0xe86a8a : 0x8ac0e0 });
  }
  const top = H + 0.3;
  const ring = new THREE.TorusGeometry(0.62, 0.09, 6, 22);
  ring.rotateX(Math.PI / 2);
  b.add('boxFlower', ring, mat(0, top - 0.3, 0), { tint: 0x4f9a3a });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    flowerHead(b, Math.cos(a) * 0.62, top - 0.22 + (i % 2) * 0.06, Math.sin(a) * 0.62, [0xf06a8a, 0xffffff, 0xfde070, 0xc77dff, 0xff9ab8][i % 5]!, 1.4, rng);
  }
  bloomMound(b, rng, 0, top + 0.05, 0, 0.32, [0xf06a8a, 0xffffff, 0xfde070], 1.2);
  b.add('metal', new THREE.SphereGeometry(0.12, 10, 8), mat(0, top + 0.45, 0), { tint: 0xd8b060 });
  // Trailing streamers from the crown ring.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    b.add('cloth', roundedBox(0.05, 0.9, 0.008, 0.004, 1), mat(Math.cos(a) * 0.66, top - 0.8, Math.sin(a) * 0.66, 0, -a, 0), { tint: FESTIVAL_COLORS[i % FESTIVAL_COLORS.length]! });
  }
  return { group: b.build({ name: 'blossom-pole' }), crown: new THREE.Vector3(0, top - 0.3, 0) };
}

/** Flower arch (arbor) spanning `span` metres, posts at ±span/2 on X. */
export function buildFlowerArch(rng: Rng, span: number, colors: readonly number[] = [0xf7a8c0, 0xffffff, 0xfde2a0, 0xd4b8f0]): THREE.Group {
  const b = new MeshBuilder();
  const H = 3.4;
  for (const sx of [-1, 1]) {
    b.add('woodPaint', roundedBox(0.16, H, 0.16, 0.04), mat(sx * span / 2, H / 2, 0), { tint: 0xf4efe6, aoWorld: groundAO(0.5) });
    b.add('stone', bevelCylinder(0.22, 0.26, 0.2, 0.04, 8), mat(sx * span / 2, 0, 0), { tint: 0xd0c8ba });
    // Vines up the posts.
    for (let i = 0; i < 9; i++) bloomMound(b, rng, sx * span / 2 + Math.sin(i * 1.7) * 0.1, 0.3 + i * 0.34, Math.cos(i * 1.7) * 0.1, 0.16, colors, 0.5);
  }
  // Semi-circular arch of blooms.
  const n = Math.round(span * 7);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    const x = Math.cos(a) * span / 2;
    const y = H + Math.sin(a) * span * 0.28;
    bloomMound(b, rng, x, y, 0, 0.26, colors, 0.7);
  }
  // Hanging ribbons.
  for (let i = 1; i < 6; i++) {
    const x = -span / 2 + (i / 6) * span;
    const y = H + Math.sin((i / 6) * Math.PI) * span * 0.28 - 0.3;
    b.add('cloth', roundedBox(0.06, 0.9, 0.01, 0.005, 1), mat(x, y - 0.45, 0.06, 0, 0, (rng.next() - 0.5) * 0.2), { tint: FESTIVAL_COLORS[i % FESTIVAL_COLORS.length]! });
  }
  return b.build({ name: 'flower-arch' });
}

/** Octagonal bandstand: stone plinth, white posts, fretwork rail, domed roof + finial. */
export function buildBandstand(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const R = 2.3;
  const plinth = bevelCylinder(R + 0.2, R + 0.3, 0.55, 0.06, 8);
  b.add('stone', boxUV(plinth, 0.9), mat(0, 0, 0, 0, Math.PI / 8, 0), { tint: 0xd8d0c2, aoWorld: groundAO(0.3) });
  b.add('woodGrain', bevelCylinder(R + 0.05, R + 0.05, 0.08, 0.02, 8), mat(0, 0.55, 0, 0, Math.PI / 8, 0), { tint: 0xc89a6a });
  for (let s = 0; s < 3; s++) b.add('stone', roundedBox(1.2, 0.18, 0.4, 0.04), mat(0, 0.09 + s * 0.18 - 0.18, R + 0.35 + (2 - s) * 0.3), { tint: 0xd0c8ba });
  const top = 3.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    b.add('woodPaint', bevelCylinder(0.08, 0.09, top - 0.6, 0.02, 8), mat(x, 0.6, z), { tint: 0xf8f4ec });
    // Rail between posts (skip the front opening).
    const a2 = ((i + 1) / 8) * Math.PI * 2;
    const x2 = Math.cos(a2) * R;
    const z2 = Math.sin(a2) * R;
    const mx = (x + x2) / 2;
    const mz = (z + z2) / 2;
    const len = Math.hypot(x2 - x, z2 - z);
    const yaw = -Math.atan2(z2 - z, x2 - x);
    const front = Math.abs(Math.atan2(mz, mx) - Math.PI / 2) < 0.3;
    if (!front) {
      b.add('woodPaint', roundedBox(len, 0.07, 0.07, 0.02), mat(mx, 1.45, mz, 0, yaw, 0), { tint: 0xf8f4ec });
      for (let k = 1; k < 6; k++) b.add('woodPaint', roundedBox(0.035, 0.8, 0.035, 0.01, 1), mat(x + ((x2 - x) * k) / 6, 1.02, z + ((z2 - z) * k) / 6), { tint: 0xf8f4ec });
    }
    // Scalloped valance + bunting under the eave.
    b.add('woodPaint', roundedBox(len, 0.2, 0.05, 0.02), mat(mx, top - 0.15, mz, 0, yaw, 0), { tint: 0xe86a7a });
    for (let k = 0; k < 4; k++) {
      const sc = new THREE.CylinderGeometry(len / 8, len / 8, 0.04, 10, 1, false, 0, Math.PI);
      sc.rotateX(Math.PI / 2);
      b.add('woodPaint', sc, mat(x + ((x2 - x) * (k + 0.5)) / 4, top - 0.25, z + ((z2 - z) * (k + 0.5)) / 4, 0, yaw, Math.PI), { tint: 0xf8f4ec });
    }
  }
  // Roof: 8 striped segments + finial.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
    const g = new THREE.ConeGeometry(R + 0.55, 1.5, 1, 1, true, a + Math.PI / 2, Math.PI / 4);
    b.add('roofTile', g, mat(0, top + 0.72, 0), { tint: i % 2 ? 0xf2e8d8 : 0xe86a7a });
  }
  b.add('metal', new THREE.SphereGeometry(0.14, 10, 8), mat(0, top + 1.55, 0), { tint: 0xd8b060 });
  b.add('metal', bevelCylinder(0.02, 0.03, 0.6, 0.01, 6), mat(0, top + 1.5, 0), { tint: 0xd8b060 });
  // Hanging flower baskets.
  for (let i = 0; i < 8; i += 2) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    bloomMound(b, rng, Math.cos(a) * (R - 0.2), top - 0.7, Math.sin(a) * (R - 0.2), 0.22, PASTELS, 0.9);
  }
  // Music stands.
  for (const [x, z] of [[-0.8, -0.3], [0.8, -0.2]] as const) {
    b.add('metal', bevelCylinder(0.015, 0.015, 1.1, 0.005, 5), mat(x, 0.6, z), { tint: 0x2e2a28 });
    b.add('white', roundedBox(0.4, 0.28, 0.02, 0.01, 1), mat(x, 1.65, z + 0.05, -0.4, 0, 0), { tint: 0x2e2a28 });
  }
  return b.build({ name: 'bandstand' });
}

// ═════════════════════════════════════════════ SUMMER

/** Long pier heading -Z (north) from the origin, with posts, rails and lantern-post anchors. */
export function buildPier(rng: Rng, length: number, width = 2.4): { group: THREE.Group; lamps: THREE.Vector3[] } {
  const b = new MeshBuilder();
  const n = Math.round(length / 0.34);
  for (let i = 0; i < n; i++) {
    const z = -i * 0.34 - 0.17;
    b.add('woodGrain', roundedBox(width, 0.08, 0.3, 0.025), mat((rng.next() - 0.5) * 0.04, 0.0 + (rng.next() - 0.5) * 0.02, z, 0, (rng.next() - 0.5) * 0.02, 0), { tint: i % 4 === 0 ? 0xb89070 : 0xd0a882 });
  }
  const lamps: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    b.add('woodDark', roundedBox(0.12, 0.12, length, 0.03), mat(sx * (width / 2 - 0.06), -0.1, -length / 2));
    for (let z = 0; z <= length; z += 2.6) {
      b.add('woodDark', bevelCylinder(0.12, 0.14, 4.2, 0.03, 8), mat(sx * (width / 2 + 0.05), -3.2, -z), { tint: 0x6a4a36 });
      b.add('woodGrain', roundedBox(0.1, 0.9, 0.1, 0.03), mat(sx * (width / 2 - 0.05), 0.45, -z), { tint: 0xa87a50 });
      if (Math.round(z / 2.6) % 2 === 0 && z > 0) lamps.push(new THREE.Vector3(sx * (width / 2 - 0.05), 1.9, -z));
    }
    b.add('woodGrain', roundedBox(0.08, 0.08, length, 0.02), mat(sx * (width / 2 - 0.05), 0.9, -length / 2), { tint: 0xb88a5a });
  }
  // Platform at the end with a bench.
  b.add('woodGrain', roundedBox(width + 2.2, 0.1, 2.6, 0.03), mat(0, 0.0, -length - 1.2), { tint: 0xc8a07a });
  for (const sx of [-1, 1]) for (const sz of [0, 1]) b.add('woodDark', bevelCylinder(0.13, 0.14, 4.2, 0.03, 8), mat(sx * (width / 2 + 1.05), -3.2, -length - sz * 2.4), { tint: 0x6a4a36 });
  // Rope coils + a crate.
  b.add('cloth', new THREE.TorusGeometry(0.2, 0.06, 6, 14), mat(width / 2 - 0.35, 0.08, -length * 0.4, Math.PI / 2, 0, 0), { tint: 0xc8a870 });
  b.add('wood', boxUV(roundedBox(0.5, 0.4, 0.5, 0.03), 1.4), mat(-width / 2 + 0.4, 0.24, -length * 0.62, 0, 0.3, 0), { tint: 0xd8b080 });
  return { group: b.build({ name: 'pier' }), lamps };
}

/** Tall wooden lantern post (paper lantern hanging from a crook). Glow anchor returned. */
export function buildLanternCrook(rng: Rng, tint = 0xffb050): { group: THREE.Group; glow: THREE.Vector3 } {
  const b = new MeshBuilder();
  b.add('woodGrain', bevelCylinder(0.05, 0.06, 2.3, 0.015, 6), mat(0, 0, 0), { tint: 0x8a6a4a });
  const crook = new THREE.TorusGeometry(0.22, 0.03, 5, 10, Math.PI);
  b.add('woodGrain', crook, mat(0.22, 2.3, 0), { tint: 0x8a6a4a });
  b.add('white', new THREE.CylinderGeometry(0.006, 0.006, 0.2, 3), mat(0.44, 2.2, 0), { tint: 0x3a2a1e });
  const lan = lumpySphere(0.16, 1, 0.03, rng, 2);
  lan.scale(1, 1.3, 1);
  b.add('paperLantern', lan, mat(0.44, 1.93, 0), { tint });
  b.add('white', new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8), mat(0.44, 2.14, 0), { tint: 0x3a2a1e });
  b.add('white', new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), mat(0.44, 1.72, 0), { tint: 0x3a2a1e });
  b.add('cloth', new THREE.ConeGeometry(0.025, 0.14, 5), mat(0.44, 1.62, 0, Math.PI, 0, 0), { tint: 0xe8574a });
  return { group: b.build({ name: 'lantern-crook' }), glow: new THREE.Vector3(0.44, 1.93, 0) };
}

/** Beach cabana: four posts, a striped cloth roof with scallops, two curtains tied back. */
export function buildCabana(rng: Rng, stripes: [number, number]): THREE.Group {
  const b = new MeshBuilder();
  const W = 2.2;
  const D = 1.8;
  const H = 2.3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('woodPaint', roundedBox(0.09, H, 0.09, 0.03), mat(sx * W / 2, H / 2, sz * D / 2), { tint: 0xf6efe2, aoWorld: groundAO(0.4) });
  const n = 8;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 - 0.1 + ((i + 0.5) * (W + 0.2)) / n;
    for (const sz of [-1, 1]) b.add('cloth', roundedBox((W + 0.2) / n + 0.01, 0.035, D / 2 + 0.25, 0.012), mat(x, H + 0.28, sz * (D / 4 + 0.08), sz * 0.5, 0, 0), { tint: stripes[i % 2]! });
    const sc = new THREE.CylinderGeometry((W + 0.2) / n / 2, (W + 0.2) / n / 2, 0.03, 8, 1, false, 0, Math.PI);
    sc.rotateX(Math.PI / 2);
    b.add('cloth', sc, mat(x, H - 0.05, D / 2 + 0.2, 0, 0, Math.PI), { tint: stripes[i % 2]! });
  }
  for (const sx of [-1, 1]) {
    const cur = lumpySphere(0.3, 1, 0.1, rng, 2);
    cur.scale(0.35, 3.4, 0.35);
    b.add('cloth', cur, mat(sx * W / 2, H / 2, D / 2, 0, 0, sx * 0.05), { tint: stripes[1] });
    b.add('cloth', new THREE.TorusGeometry(0.1, 0.02, 4, 10), mat(sx * W / 2, H * 0.45, D / 2, Math.PI / 2, 0, 0), { tint: stripes[0] });
  }
  // Loungers inside.
  for (const sx of [-0.5, 0.5]) {
    b.add('woodGrain', roundedBox(0.6, 0.08, 1.5, 0.03), mat(sx, 0.35, 0.05, -0.08, 0, 0), { tint: 0xd8b48a });
    b.add('cloth', roundedBox(0.55, 0.06, 1.2, 0.03), mat(sx, 0.42, 0.1, -0.08, 0, 0), { tint: stripes[0] });
    for (const z of [-0.6, 0.6]) b.add('woodGrain', roundedBox(0.5, 0.32, 0.06, 0.02), mat(sx, 0.16, z), { tint: 0xa87a50 });
  }
  return b.build({ name: 'cabana' });
}

/** Closed or open beach umbrella stuck in the sand. */
export function buildUmbrella(colors: [number, number], tilt = 0.12): THREE.Group {
  const b = new MeshBuilder();
  b.add('woodGrain', bevelCylinder(0.03, 0.03, 2.3, 0.01, 6), mat(0, -0.2, 0, tilt, 0, 0), { tint: 0xe8dcc8 });
  const n = 12;
  const top = new THREE.Vector3(0, 2.1, 0).applyEuler(new THREE.Euler(tilt, 0, 0));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const g = new THREE.ConeGeometry(1.2, 0.42, 3, 1, true, a, (Math.PI * 2) / n);
    b.add('cloth', g, mat(top.x, top.y, top.z, tilt, 0, 0), { tint: colors[i % 2]! });
  }
  b.add('woodGrain', new THREE.SphereGeometry(0.05, 6, 5), mat(top.x, top.y + 0.23, top.z), { tint: 0xe8dcc8 });
  return b.build({ name: 'umbrella' });
}

/** Picnic blanket (checked) with a basket and a jug. */
export function buildBlanket(rng: Rng, colors: [number, number], w = 1.8, d = 1.4): THREE.Group {
  const b = new MeshBuilder();
  const nx = 6;
  const nz = 5;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const c = (i + j) % 2 ? colors[0] : colors[1];
      b.add('cloth', roundedBox(w / nx + 0.002, 0.02, d / nz + 0.002, 0.005, 1), mat(-w / 2 + (i + 0.5) * (w / nx), 0.012 + (rng.next() - 0.5) * 0.008, -d / 2 + (j + 0.5) * (d / nz)), { tint: c });
    }
  }
  b.add('thatch', new THREE.CylinderGeometry(0.22, 0.18, 0.22, 12, 1, true), mat(w / 2 - 0.35, 0.11, -d / 2 + 0.35), { tint: 0xc89858 });
  b.add('thatch', new THREE.CircleGeometry(0.2, 12).rotateX(-Math.PI / 2), mat(w / 2 - 0.35, 0.18, -d / 2 + 0.35), { tint: 0xb07a3a });
  b.add('thatch', new THREE.TorusGeometry(0.19, 0.02, 4, 12, Math.PI), mat(w / 2 - 0.35, 0.22, -d / 2 + 0.35, 0, 0.4, 0), { tint: 0xa87a44 });
  const jug = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.07, 0), new THREE.Vector2(0.09, 0.08), new THREE.Vector2(0.05, 0.2), new THREE.Vector2(0.06, 0.24), new THREE.Vector2(0, 0.24)], 10);
  b.add('white', jug, mat(-w / 2 + 0.3, 0.02, d / 2 - 0.3), { tint: 0xb8643e });
  for (let i = 0; i < 3; i++) b.add('white', new THREE.SphereGeometry(0.06, 8, 6), mat(-0.2 + i * 0.14, 0.07, 0.1), { tint: [0xe4432e, 0xf2c43a, 0x6fae45][i]! });
  return b.build({ name: 'blanket' });
}

/** Stone-ringed bonfire with a log teepee (flames are FireFX at the returned anchor). */
export function buildBonfire(rng: Rng): { group: THREE.Group; fire: THREE.Vector3 } {
  const b = new MeshBuilder();
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const g = lumpySphere(0.2, 1, 0.25, rng, 2);
    g.scale(1, 0.7, 1);
    b.add('rock', g, mat(Math.cos(a) * 0.72, 0.1, Math.sin(a) * 0.72), { tint: 0x9a948c });
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const log = new THREE.CylinderGeometry(0.06, 0.08, 1.3, 7);
    b.add('bark', log, mat(Math.cos(a) * 0.22, 0.45, Math.sin(a) * 0.22, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4), { tint: 0x8a6a50 });
  }
  b.add('lampGlow', new THREE.CylinderGeometry(0.45, 0.5, 0.06, 12), mat(0, 0.03, 0), { tint: 0xff7a30 });
  // Driftwood log benches.
  for (const [a, r] of [[0.5, 2.1], [2.4, 2.2], [4.1, 2.0]] as const) {
    const log = new THREE.CylinderGeometry(0.2, 0.22, 1.8, 10);
    log.rotateZ(Math.PI / 2);
    b.add('bark', log, mat(Math.cos(a) * r, 0.16, Math.sin(a) * r, 0, -a + Math.PI / 2, 0), { tint: 0xc8b8a0 });
  }
  return { group: b.build({ name: 'bonfire' }), fire: new THREE.Vector3(0, 0.45, 0) };
}

/** Red-and-white lighthouse on a rock; returns the lamp anchor for the beam. */
export function buildLighthouse(rng: Rng): { group: THREE.Group; lamp: THREE.Vector3 } {
  const b = new MeshBuilder();
  for (let i = 0; i < 9; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.next() * 2.2;
    const g = lumpySphere(1.0 + rng.next() * 0.8, 1, 0.25, rng, 1.6);
    g.scale(1, 0.6, 1);
    b.add('rock', g, mat(Math.cos(a) * r, -0.3 + rng.next() * 0.3, Math.sin(a) * r), { tint: 0x8e8a84 });
  }
  const H = 9;
  const segs = 6;
  for (let s = 0; s < segs; s++) {
    const y0 = 0.6 + (s * H) / segs;
    const r0 = 1.25 - (s / segs) * 0.45;
    const r1 = 1.25 - ((s + 1) / segs) * 0.45;
    const g = new THREE.CylinderGeometry(r1, r0, H / segs, 18);
    b.add('plaster', g, mat(0, y0 + H / segs / 2, 0), { tint: s % 2 ? 0xf6f0e6 : 0xd8413a });
  }
  const top = 0.6 + H;
  b.add('stone', bevelCylinder(1.05, 0.9, 0.25, 0.04, 16), mat(0, top, 0), { tint: 0x3a3a40 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add('metal', roundedBox(0.04, 0.5, 0.04, 0.01, 1), mat(Math.cos(a) * 1.0, top + 0.5, Math.sin(a) * 1.0), { tint: 0x2e2a28 });
  }
  b.add('metal', new THREE.TorusGeometry(1.0, 0.03, 4, 18), mat(0, top + 0.75, 0, Math.PI / 2), { tint: 0x2e2a28 });
  b.add('glass', new THREE.CylinderGeometry(0.62, 0.62, 1.1, 12), mat(0, top + 0.8, 0), { tint: 0xffffff });
  b.add('lampGlow', new THREE.SphereGeometry(0.34, 12, 10), mat(0, top + 0.8, 0), { tint: 0xfff0c0 });
  b.add('roofTile', new THREE.ConeGeometry(0.85, 0.8, 16), mat(0, top + 1.75, 0), { tint: 0xc8392f });
  b.add('metal', new THREE.SphereGeometry(0.1, 8, 6), mat(0, top + 2.2, 0), { tint: 0x2e2a28 });
  // Door + windows.
  b.add('woodDark', roundedBox(0.5, 0.9, 0.1, 0.03), mat(0, 1.05, 1.2), { tint: 0x5a3a24 });
  for (const y of [3.4, 6.2]) b.add('glass', roundedBox(0.28, 0.4, 0.06, 0.02), mat(0, y, 1.12 - (y / H) * 0.4), { tint: 0xffffff });
  return { group: b.build({ name: 'lighthouse' }), lamp: new THREE.Vector3(0, top + 0.8, 0) };
}

/** Additive rotating beam cone (dynamic). */
export function buildBeam(): THREE.Mesh {
  const g = new THREE.CylinderGeometry(0.3, 3.2, 40, 16, 1, true);
  g.rotateZ(-Math.PI / 2);
  g.translate(20, 0, 0);
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ float along = vP.x / 40.0; vec3 V = normalize(cameraPosition - vW); float edge = pow(abs(dot(normalize(vN), V)), 1.5); float a = (1.0 - along) * (1.0 - along) * edge * 0.22; gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * a, 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'lighthouse-beam';
  mesh.renderOrder = 9;
  mesh.userData.noAO = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Little rowboat with a lantern on a pole. */
export function buildRowboat(rng: Rng, tint = 0x4f8fb0): { group: THREE.Group; glow: THREE.Vector3 } {
  const b = new MeshBuilder();
  const hull = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hull.scale(1.4, 0.45, 0.62);
  b.add('woodPaint', hull, mat(0, 0.35, 0), { tint });
  const rim = new THREE.TorusGeometry(1, 0.05, 4, 24);
  rim.rotateX(Math.PI / 2);
  rim.scale(1.4, 1, 0.62);
  b.add('woodGrain', rim, mat(0, 0.36, 0), { tint: 0xd8b48a });
  b.add('woodGrain', roundedBox(0.3, 0.06, 1.1, 0.02), mat(0.3, 0.22, 0), { tint: 0xc8a07a });
  b.add('woodGrain', roundedBox(0.3, 0.06, 0.9, 0.02), mat(-0.6, 0.22, 0), { tint: 0xc8a07a });
  b.add('woodGrain', bevelCylinder(0.02, 0.02, 1.4, 0.005, 5), mat(1.05, 0.2, 0), { tint: 0x8a6a4a });
  const lan = lumpySphere(0.13, 1, 0.03, rng, 2);
  lan.scale(1, 1.3, 1);
  b.add('paperLantern', lan, mat(1.05, 1.45, 0), { tint: 0xffa850 });
  const oar = roundedBox(0.06, 0.03, 1.8, 0.01, 1);
  b.add('woodGrain', oar, mat(-0.1, 0.4, 0.5, 0.2, 0.6, 0), { tint: 0xc8a07a });
  return { group: b.build({ name: 'rowboat' }), glow: new THREE.Vector3(1.05, 1.45, 0) };
}

/**
 * Wish arch at the waterline: two bleached driftwood posts, a bowed crossbeam, paper lanterns and
 * wish ribbons hanging from it. Spans `span` along X; returns lantern anchors (local) for glows.
 */
export function buildWishArch(rng: Rng, span = 4.6): { group: THREE.Group; lamps: THREE.Vector3[] } {
  const b = new MeshBuilder();
  const H = 3.1;
  const drift = 0xc8b8a0;
  for (const sx of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.11, 0.16, H + 0.3, 8, 4);
    const pp = post.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) pp.setX(i, pp.getX(i) + Math.sin(pp.getY(i) * 1.7 + sx) * 0.05);
    post.computeVertexNormals();
    b.add('bark', post, mat(sx * span / 2, (H + 0.3) / 2 - 0.15, 0, 0, 0, sx * 0.04), { tint: drift, aoWorld: groundAO(0.5) });
    // Rope lashing + a cairn of pale stones at the foot.
    for (let i = 0; i < 3; i++) b.add('cloth', new THREE.TorusGeometry(0.15, 0.025, 4, 10), mat(sx * span / 2, H - 0.25 - i * 0.07, 0, Math.PI / 2, 0, 0), { tint: 0xd8c090 });
    for (let i = 0; i < 5; i++) {
      const st = lumpySphere(0.16 + rng.next() * 0.08, 1, 0.2, rng, 2);
      st.scale(1, 0.6, 1);
      const a = rng.next() * Math.PI * 2;
      b.add('rock', st, mat(sx * span / 2 + Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3), { tint: 0xd8d0c4 });
    }
  }
  // Bowed crossbeam (segments following an arc).
  const N = 12;
  const beam = (t: number): THREE.Vector3 => new THREE.Vector3(-span / 2 - 0.35 + t * (span + 0.7), H + Math.sin(t * Math.PI) * 0.45 - 0.1, 0);
  for (let i = 0; i < N; i++) {
    const p = beam(i / N);
    const q = beam((i + 1) / N);
    const d = q.clone().sub(p);
    const g = new THREE.CylinderGeometry(0.1, 0.1, d.length() + 0.04, 7);
    g.rotateZ(Math.PI / 2);
    b.add('bark', g, mat((p.x + q.x) / 2, (p.y + q.y) / 2, 0, 0, 0, Math.atan2(d.y, d.x)), { tint: drift });
  }
  const lamps: THREE.Vector3[] = [];
  const tints = [0xffa850, 0xff8a60, 0xffc870, 0xff7a70];
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const p = beam(t);
    const drop = 0.35 + (i % 2) * 0.35 + rng.next() * 0.1;
    b.add('white', new THREE.CylinderGeometry(0.006, 0.006, drop, 3), mat(p.x, p.y - drop / 2 - 0.05, 0), { tint: 0x3a2a1e });
    const lan = lumpySphere(0.15, 1, 0.04, rng, 2);
    lan.scale(1, 1.3, 1);
    const ly = p.y - drop - 0.22;
    b.add('paperLantern', lan, mat(p.x, ly, 0), { tint: tints[i % tints.length]! });
    b.add('white', new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8), mat(p.x, ly + 0.2, 0), { tint: 0x3a2a1e });
    b.add('cloth', new THREE.ConeGeometry(0.025, 0.14, 5), mat(p.x, ly - 0.28, 0, Math.PI, 0, 0), { tint: 0xe8574a });
    lamps.push(new THREE.Vector3(p.x, ly, 0));
  }
  // Wish ribbons knotted along the beam.
  const rib = [0xf6c8d8, 0x5fd8e8, 0xfff0c8, 0xf2b928, 0xb8a8f0];
  for (let i = 0; i < 16; i++) {
    const t = (i + 0.3) / 16;
    const p = beam(t);
    const len = 0.5 + rng.next() * 0.6;
    b.add('cloth', roundedBox(0.05, len, 0.008, 0.004, 1), mat(p.x + 0.05, p.y - len / 2 - 0.06, 0.08, 0, 0, (rng.next() - 0.5) * 0.25), { tint: rib[i % rib.length]! });
  }
  return { group: b.build({ name: 'wish-arch' }), lamps };
}

export function buildSandcastle(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const sand = 0xe6cc98;
  b.add('white', bevelCylinder(0.55, 0.65, 0.3, 0.08, 12), mat(0, 0, 0), { tint: sand });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    b.add('white', bevelCylinder(0.14, 0.16, 0.4, 0.03, 8), mat(Math.cos(a) * 0.42, 0.25, Math.sin(a) * 0.42), { tint: sand });
    b.add('white', new THREE.ConeGeometry(0.14, 0.18, 8), mat(Math.cos(a) * 0.42, 0.74, Math.sin(a) * 0.42), { tint: 0xe0c28a });
  }
  b.add('white', bevelCylinder(0.22, 0.26, 0.65, 0.04, 10), mat(0, 0.25, 0), { tint: sand });
  b.add('white', new THREE.ConeGeometry(0.22, 0.3, 10), mat(0, 1.05, 0), { tint: 0xe0c28a });
  b.add('cloth', new THREE.ConeGeometry(0.06, 0.16, 3), mat(0.05, 1.3, 0, 0, 0, Math.PI / 2), { tint: 0xe8574a });
  b.add('white', bevelCylinder(0.006, 0.006, 0.2, 0.002, 3), mat(0, 1.2, 0), { tint: 0x8a6a4a });
  for (let i = 0; i < 6; i++) b.add('white', new THREE.SphereGeometry(0.04, 6, 4), mat((rng.next() - 0.5) * 1.4, 0.03, 0.5 + rng.next() * 0.3), { tint: [0xf8e8e0, 0xf6c8b8, 0xe8d8c8][i % 3]! });
  return b.build({ name: 'sandcastle' });
}

// ═════════════════════════════════════════════ FALL

/** Ribbed giant pumpkin (contest entry). */
export function pumpkinGeometry(r: number, ribs = 12, squash = 0.72): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 28, 16);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    const y = pos.getY(k);
    const a = Math.atan2(z, x);
    const rib = 1 - 0.07 * Math.pow(0.5 - 0.5 * Math.cos(a * ribs), 0.6);
    const flat = 1 - 0.25 * Math.pow(Math.abs(y / r), 6);
    pos.setXYZ(k, x * rib * flat, y * squash - (y > 0 ? Math.pow(1 - Math.hypot(x, z) / r, 4) * r * 0.2 : 0), z * rib * flat);
  }
  g.computeVertexNormals();
  return g;
}

export function buildGiantPumpkin(rng: Rng, r: number, tint: number, plinth = true): { group: THREE.Group; top: number } {
  const b = new MeshBuilder();
  let base = 0;
  if (plinth) {
    b.add('wood', boxUV(roundedBox(r * 2.4, 0.3, r * 2.4, 0.05), 1.2), mat(0, 0.15, 0), { tint: 0xc8a070, aoWorld: groundAO(0.2) });
    b.add('thatch', roundedBox(r * 2.2, 0.08, r * 2.2, 0.04), mat(0, 0.32, 0), { tint: 0xe8c878 });
    base = 0.36;
  }
  const g = pumpkinGeometry(r, 12, 0.74);
  b.add('white', g, mat(0, base + r * 0.72, 0), { tint, aoWorld: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, base, base + r * 0.7) });
  const stem = new THREE.CylinderGeometry(r * 0.07, r * 0.12, r * 0.35, 7);
  b.add('woodDark', stem, mat(0.02, base + r * 1.5, 0, 0.25, 0, 0.2), { tint: 0x6a7a3a });
  // Curly vine + two leaves.
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    b.add('boxFlower', new THREE.SphereGeometry(r * 0.025, 5, 4), mat(Math.cos(t * 7) * r * 0.25 + r * 0.1, base + r * 1.46 + t * r * 0.05, Math.sin(t * 7) * r * 0.25), { tint: 0x5a8a3a });
  }
  for (const s of [-1, 1]) {
    const leaf = new THREE.SphereGeometry(r * 0.28, 8, 6);
    leaf.scale(1, 0.12, 0.8);
    b.add('boxFlower', leaf, mat(s * r * 0.28, base + r * 1.43, -r * 0.1, 0.2, s * 0.8, s * 0.3), { tint: 0x5a8a3a });
  }
  void rng;
  return { group: b.build({ name: 'giant-pumpkin' }), top: base + r * 1.45 };
}

/** Prize rosette (ribbon medal) standing on a little easel card. place = 1 gold, 2 blue, 3 red. */
export function buildRosette(place: 1 | 2 | 3): THREE.Group {
  const b = new MeshBuilder();
  const c = place === 1 ? 0xf2b928 : place === 2 ? 0x3f6fd0 : 0xd8392f;
  const c2 = place === 1 ? 0xfff0a0 : 0xf8f4ec;
  b.add('woodGrain', roundedBox(0.03, 0.6, 0.03, 0.01, 1), mat(0, 0.3, -0.05, -0.2, 0, 0), { tint: 0x8a6a4a });
  const petals = 14;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const p = new THREE.SphereGeometry(0.07, 6, 4);
    p.scale(1, 0.5, 0.25);
    b.add('cloth', p, mat(Math.cos(a) * 0.12, 0.62 + Math.sin(a) * 0.12, 0, 0, 0, a), { tint: c });
  }
  b.add('cloth', new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), mat(0, 0.62, 0.02, Math.PI / 2, 0, 0), { tint: c2 });
  b.add('metal', new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12), mat(0, 0.62, 0.035, Math.PI / 2, 0, 0), { tint: 0xd8b060 });
  for (const s of [-1, 1]) {
    const tail = new THREE.Shape();
    tail.moveTo(-0.045, 0);
    tail.lineTo(0.045, 0);
    tail.lineTo(0.045, -0.36);
    tail.lineTo(0, -0.3);
    tail.lineTo(-0.045, -0.36);
    tail.closePath();
    b.add('cloth', new THREE.ShapeGeometry(tail), mat(s * 0.05, 0.54, 0.005, 0, 0, s * 0.18), { tint: c });
  }
  return b.build({ name: `rosette-${place}` });
}

/** Canvas banner text (original wording). */
function bannerMaterial(text: string, bg: string, fg: string, w = 1024, h = 192): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,240,200,0.9)';
  g.lineWidth = 8;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.setLineDash([18, 12]);
  g.lineWidth = 3;
  g.strokeRect(28, 28, w - 56, h - 56);
  g.font = `700 ${Math.round(h * 0.46)}px Fredoka, Nunito, "Trebuchet MS", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillText(text, w / 2 + 4, h / 2 + 6);
  g.fillStyle = fg;
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, vertexColors: true });
  m.name = `banner:${text}`;
  applyWorldFx(m);
  return m;
}

/** Show stage for the pumpkin judging: plank platform, steps, bunting'd backdrop with a banner. */
export function buildShowStage(rng: Rng, text: string): THREE.Group {
  const b = new MeshBuilder();
  const W = 7.2;
  const D = 3.2;
  const H = 0.7;
  b.add('wood', boxUV(roundedBox(W, H, D, 0.05), 1 / 1.1), mat(0, H / 2, 0), { tint: 0xc89a6a, aoWorld: groundAO(0.3) });
  for (let i = 0; i < 18; i++) b.add('woodGrain', roundedBox(W / 18 - 0.02, 0.05, D + 0.1, 0.015), mat(-W / 2 + (i + 0.5) * (W / 18), H + 0.02, 0), { tint: i % 3 ? 0xd8b080 : 0xc8a070 });
  for (let s = 0; s < 3; s++) b.add('wood', roundedBox(1.6, 0.22, 0.34, 0.04), mat(0, 0.11 + s * 0.22 - 0.1, D / 2 + 0.5 - s * 0.3), { tint: 0xb88a5a });
  // Skirt of bunting along the front edge.
  for (let i = 0; i < 16; i++) {
    const tri = new THREE.ConeGeometry(0.2, 0.3, 3);
    tri.rotateX(Math.PI);
    b.add('cloth', tri, mat(-W / 2 + 0.25 + i * ((W - 0.5) / 15), H - 0.15, D / 2 + 0.03, 0, 0, 0, 1, 1, 0.12), { tint: [0xd8573e, 0xf2b928, 0x8a4a2a, 0xe8864a][i % 4]! });
  }
  // Backdrop frame + banner.
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.16, 3.6, 0.16, 0.04), mat(sx * (W / 2 - 0.3), H + 1.8, -D / 2 + 0.15), { tint: 0x8a6444 });
  b.add('woodGrain', roundedBox(W - 0.3, 0.16, 0.16, 0.04), mat(0, H + 3.6, -D / 2 + 0.15), { tint: 0x8a6444 });
  const banner = new THREE.PlaneGeometry(W - 1.2, 1.1);
  b.add(bannerMaterial(text, '#8a2a1e', '#fbe7b0'), banner, mat(0, H + 2.9, -D / 2 + 0.26), { tint: 0xffffff });
  // Corn-sheaf + pumpkin dressing at the corners.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.add('thatch', bevelCylinder(0.02, 0.03, 1.4, 0.005, 4), mat(sx * (W / 2 - 0.3) + Math.cos(a) * 0.12, H, -D / 2 + 0.5 + Math.sin(a) * 0.12, Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15), { tint: 0xd8b060 });
    }
    b.add('cloth', new THREE.TorusGeometry(0.16, 0.03, 4, 10), mat(sx * (W / 2 - 0.3), H + 0.6, -D / 2 + 0.5, Math.PI / 2, 0, 0), { tint: 0x8a2a1e });
  }
  // Judges' table.
  b.add('cloth', roundedBox(1.8, 0.8, 0.7, 0.03), mat(W / 2 - 1.3, H + 0.4, -0.6), { tint: 0xf6ecd8 });
  b.add('cloth', roundedBox(1.84, 0.02, 0.4, 0.01), mat(W / 2 - 1.3, H + 0.81, -0.6), { tint: 0x8a2a1e });
  void rng;
  return b.build({ name: 'show-stage' });
}

/** Big striped marquee tent (round, peaked, scalloped valance, pennant). Door faces +Z. */
export function buildMarquee(rng: Rng, R = 3.6, stripes: [number, number] = [0xd8473a, 0xf6ecd8]): THREE.Group {
  const b = new MeshBuilder();
  const wallH = 2.4;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    if (Math.abs(((a0 + Math.PI / n) % (Math.PI * 2)) - Math.PI / 2) < 0.3) continue; // door gap
    const g = new THREE.CylinderGeometry(R, R, wallH, 3, 1, true, a0, (Math.PI * 2) / n);
    b.add('cloth', g, mat(0, wallH / 2, 0), { tint: stripes[i % 2]!, aoWorld: groundAO(0.6, 0.7) });
  }
  const roofH = 2.6;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const g = new THREE.ConeGeometry(R + 0.3, roofH, 3, 4, true, a0, (Math.PI * 2) / n);
    // Sag the roof panels between the ribs.
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      const a = Math.atan2(x, z) - a0;
      const mid = Math.sin(((a % ((Math.PI * 2) / n)) / ((Math.PI * 2) / n)) * Math.PI);
      const rr = Math.hypot(x, z);
      pos.setY(k, pos.getY(k) - mid * 0.12 * Math.sin((rr / (R + 0.3)) * Math.PI));
    }
    g.computeVertexNormals();
    b.add('cloth', g, mat(0, wallH + roofH / 2 - 0.05, 0), { tint: stripes[i % 2]! });
    const sc = new THREE.CylinderGeometry(((R + 0.3) * Math.PI) / n, ((R + 0.3) * Math.PI) / n, 0.04, 10, 1, false, 0, Math.PI);
    sc.rotateX(Math.PI / 2);
    const am = a0 + Math.PI / n;
    b.add('cloth', sc, mat(Math.sin(am) * (R + 0.28), wallH - 0.06, Math.cos(am) * (R + 0.28), 0, am, Math.PI), { tint: stripes[(i + 1) % 2]! });
  }
  b.add('woodGrain', bevelCylinder(0.07, 0.08, wallH + roofH + 0.6, 0.02, 8), mat(0, 0, 0), { tint: 0xa87a50 });
  b.add('metal', new THREE.SphereGeometry(0.12, 8, 6), mat(0, wallH + roofH + 0.62, 0), { tint: 0xd8b060 });
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.lineTo(0.9, -0.2);
  flag.lineTo(0, -0.45);
  flag.closePath();
  b.add('cloth', new THREE.ShapeGeometry(flag), mat(0.05, wallH + roofH + 0.55, 0, 0, -0.4, 0), { tint: 0xf2b928 });
  // Door flaps tied back + guy ropes and pegs.
  for (const s of [-1, 1]) {
    const flap = lumpySphere(0.35, 1, 0.1, rng, 2);
    flap.scale(0.4, 3.2, 0.35);
    b.add('cloth', flap, mat(s * 0.9, wallH / 2, R - 0.05, 0, 0, s * 0.1), { tint: stripes[0] });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const p = new THREE.Vector3(Math.sin(a) * (R + 0.25), wallH, Math.cos(a) * (R + 0.25));
    const q = new THREE.Vector3(Math.sin(a) * (R + 1.6), 0.05, Math.cos(a) * (R + 1.6));
    const d = q.clone().sub(p);
    const g = new THREE.CylinderGeometry(0.012, 0.012, d.length(), 3);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    b.add('white', g, mat(p.x, p.y, p.z), { tint: 0xe8dcc0 });
    b.add('woodDark', roundedBox(0.06, 0.25, 0.06, 0.02, 1), mat(q.x, 0.08, q.z));
  }
  return b.build({ name: 'marquee' });
}

/** One corn stalk (for instancing): stem, arching leaves, a cob with husk + tassel. */
export function cornStalkGeometry(rng: Rng, h: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.add('white', new THREE.CylinderGeometry(0.02, 0.035, h, 5), mat(0, h / 2, 0), { tint: 0xc8c070, aoWorld: (p) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(p.y, 0, h * 0.6) });
  for (let i = 0; i < 7; i++) {
    const y = 0.25 + (i / 7) * (h - 0.5);
    const a = i * 2.3 + rng.next();
    const leaf = new THREE.PlaneGeometry(0.13, 0.85, 1, 4);
    const pos = leaf.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const t = (pos.getY(k) + 0.425) / 0.85;
      pos.setXYZ(k, pos.getX(k) * (1 - t * 0.75) * (0.6 + Math.sin(t * Math.PI) * 0.6), t * 0.42, t * t * 0.55);
    }
    leaf.computeVertexNormals();
    b.add('white', leaf, mat(0, y, 0, 0, a, 0), { tint: i < 2 ? 0xd8c070 : 0xe8e0a0, aoWorld: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0, h) });
  }
  const cob = new THREE.CapsuleGeometry(0.045, 0.16, 1, 5);
  b.add('white', cob, mat(0.06, h * 0.55, 0, 0, 0, -0.4), { tint: 0xf2c040 });
  const husk = new THREE.ConeGeometry(0.055, 0.22, 5);
  b.add('white', husk, mat(0.08, h * 0.55 - 0.03, 0, 0, 0, -0.4 + Math.PI), { tint: 0xe0d08a });
  for (let i = 0; i < 2; i++) b.add('white', new THREE.CylinderGeometry(0.006, 0.004, 0.32, 3), mat(Math.cos(i * 2.6) * 0.04, h + 0.1, Math.sin(i * 2.6) * 0.04, Math.cos(i) * 0.5, 0, Math.sin(i) * 0.5), { tint: 0xd8a860 });
  const merged = [...b.geometries().values()][0]!;
  return merged;
}

/** Instanced corn field: `spots` (x, y, z, rot, scale). One draw call (+ swaying shadow). */
export function buildCornField(rng: Rng, spots: [number, number, number, number, number][]): THREE.InstancedMesh {
  const g = cornStalkGeometry(rng, 2.3);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  m.name = 'corn';
  applyWorldFx(m);
  const windOpts = { mode: 'height' as const, height: 2.4, amplitude: 0.22, flutter: 0.5 };
  applyWind(m, windOpts);
  const mesh = new THREE.InstancedMesh(g, m, spots.length);
  const M = new THREE.Matrix4();
  const c = new THREE.Color();
  spots.forEach(([x, y, z, r, s], i) => {
    M.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng.next() - 0.5) * 0.08, r, (rng.next() - 0.5) * 0.08)), new THREE.Vector3(s, s * (0.9 + rng.next() * 0.2), s));
    mesh.setMatrixAt(i, M);
    const green = rng.next() < 0.55;
    mesh.setColorAt(i, green ? c.setHSL(0.17 + rng.next() * 0.04, 0.42 + rng.next() * 0.15, 0.5 + rng.next() * 0.08) : c.setHSL(0.11 + rng.next() * 0.03, 0.55 + rng.next() * 0.15, 0.56 + rng.next() * 0.1));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = windDepthMaterial(windOpts);
  mesh.name = 'corn-field';
  mesh.computeBoundingSphere();
  return mesh;
}

/** Start / finish gate for the sack race: two posts + a hanging banner ribbon. */
export function buildRaceGate(rng: Rng, span: number, text: string, bg = '#2f6a8a'): THREE.Group {
  const b = new MeshBuilder();
  const H = 2.6;
  for (const sx of [-1, 1]) {
    b.add('woodGrain', roundedBox(0.14, H, 0.14, 0.04), mat(sx * span / 2, H / 2, 0), { tint: 0xa87a50, aoWorld: groundAO(0.4) });
    for (let i = 0; i < 6; i++) b.add('cloth', new THREE.TorusGeometry(0.085, 0.018, 4, 8), mat(sx * span / 2, 0.4 + i * 0.36, 0, Math.PI / 2, 0, 0), { tint: i % 2 ? 0xf6ecd8 : 0xd8473a });
  }
  b.add(bannerMaterial(text, bg, '#fff4d8', 768, 160), new THREE.PlaneGeometry(span - 0.3, 0.6), mat(0, H - 0.4, 0.02), { tint: 0xffffff });
  b.add(bannerMaterial(text, bg, '#fff4d8', 768, 160), new THREE.PlaneGeometry(span - 0.3, 0.6), mat(0, H - 0.4, -0.02, 0, Math.PI, 0), { tint: 0xffffff });
  const A = new THREE.Vector3(-span / 2, H - 0.05, 0);
  const B = new THREE.Vector3(span / 2, H - 0.05, 0);
  const p = new THREE.Vector3();
  for (let i = 1; i < 12; i++) {
    catenary(A, B, 0.12, i / 12, p);
    const tri = new THREE.ConeGeometry(0.1, 0.22, 3);
    tri.rotateX(Math.PI);
    b.add('cloth', tri, mat(p.x, p.y - 0.12, 0, 0, 0, 0, 1, 1, 0.12), { tint: FESTIVAL_COLORS[(i + rng.int(0, 5)) % FESTIVAL_COLORS.length]! });
  }
  return b.build({ name: 'race-gate' });
}

/** Apple-bobbing tub: barrel half, water, floating apples. */
export function buildAppleTub(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const g = new THREE.CylinderGeometry(0.6, 0.52, 0.55, 16, 1, true);
  uvScale(g, 4, 1);
  b.add('wood', g, mat(0, 0.28, 0), { tint: 0xb88a5a, aoWorld: groundAO(0.2) });
  for (const y of [0.1, 0.46]) b.add('metal', new THREE.TorusGeometry(0.58, 0.02, 4, 18), mat(0, y, 0, Math.PI / 2, 0, 0), { tint: 0x4a4440 });
  b.add('stillWater', new THREE.CircleGeometry(0.56, 18).rotateX(-Math.PI / 2), mat(0, 0.47, 0));
  for (let i = 0; i < 9; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.next() * 0.42;
    b.add('white', new THREE.SphereGeometry(0.075, 8, 6), mat(Math.cos(a) * r, 0.49, Math.sin(a) * r), { tint: i % 3 ? 0xd8312a : 0x8ac040 });
  }
  return b.build({ name: 'apple-tub' });
}

/** Cider press: wooden frame, big screw wheel, a tub and jugs. */
export function buildCiderPress(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.14, 1.6, 0.14, 0.04), mat(sx * 0.5, 0.8, 0), { tint: 0x8a6444, aoWorld: groundAO(0.4) });
  b.add('woodGrain', roundedBox(1.2, 0.18, 0.2, 0.04), mat(0, 1.55, 0), { tint: 0x8a6444 });
  b.add('metal', bevelCylinder(0.04, 0.04, 0.8, 0.01, 8), mat(0, 0.9, 0), { tint: 0x5a5450 });
  b.add('woodDark', new THREE.TorusGeometry(0.3, 0.035, 5, 16), mat(0, 1.75, 0, Math.PI / 2, 0, 0), { tint: 0x6a4a30 });
  for (let i = 0; i < 4; i++) b.add('woodDark', roundedBox(0.6, 0.03, 0.03, 0.01, 1), mat(0, 1.75, 0, 0, (i / 4) * Math.PI, 0));
  const tub = new THREE.CylinderGeometry(0.42, 0.42, 0.45, 14, 1, true);
  b.add('wood', tub, mat(0, 0.35, 0), { tint: 0xb88a5a });
  b.add('white', new THREE.CircleGeometry(0.4, 14).rotateX(-Math.PI / 2), mat(0, 0.5, 0), { tint: 0xa8602a });
  b.add('wood', roundedBox(1.3, 0.14, 0.8, 0.03), mat(0, 0.07, 0), { tint: 0x9a7a54 });
  for (let i = 0; i < 3; i++) {
    const jug = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.08, 0), new THREE.Vector2(0.1, 0.1), new THREE.Vector2(0.06, 0.24), new THREE.Vector2(0.04, 0.3), new THREE.Vector2(0, 0.3)], 10);
    b.add('white', jug, mat(0.85 + i * 0.22, 0, 0.2 - i * 0.1), { tint: [0xd8a060, 0xb8643e, 0xe8d8b8][i]! });
  }
  void rng;
  return b.build({ name: 'cider-press' });
}

// ═════════════════════════════════════════════ WINTER

/**
 * The Starfall tree: a tall layered fir with snow shelves, glossy baubles, gold tinsel garlands
 * spiralling up, a glowing star on top. Returns the bauble / fairy-light / star positions (world
 * offsets from the origin) for glow points.
 */
export function buildStarTree(rng: Rng, H = 11): { group: THREE.Group; lights: THREE.Vector3[]; baubles: { p: THREE.Vector3; c: number }[]; star: THREE.Vector3 } {
  const b = new MeshBuilder();
  b.add('bark', bevelCylinder(0.35, 0.5, 1.6, 0.05, 10), mat(0, 0, 0), { tint: 0x7a5a44 });
  // Planter ring of logs + a stone base.
  b.add('stone', boxUV(bevelCylinder(1.9, 2.05, 0.5, 0.08, 20), 0.9), mat(0, 0, 0), { tint: 0xc8c0b2, aoWorld: groundAO(0.3) });
  const tiers = 9;
  const base = 1.1;
  const needles = materials.get('boxFlower');
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const r = THREE.MathUtils.lerp(3.4, 0.6, f) * (0.95 + rng.next() * 0.1);
    const th = THREE.MathUtils.lerp(2.0, 1.2, f);
    const y = base + f * (H - base - th * 0.9);
    const g = new THREE.ConeGeometry(r, th, 22, 3, false);
    g.translate(0, th / 2, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const rad = Math.hypot(p.x, p.z);
      if (rad > 0.01) {
        const ang = Math.atan2(p.z, p.x);
        const jag = 1 + 0.1 * Math.sin(ang * 13 + t * 2) + (rng.next() - 0.5) * 0.06;
        p.x *= jag;
        p.z *= jag;
        p.y -= (rad / r) * (rad / r) * 0.4;
      }
      pos.setXYZ(i, p.x, p.y + y, p.z);
    }
    g.computeVertexNormals();
    sphericalNormals(g, new THREE.Vector3(0, y + th * 0.2, 0), 0.3);
    b.add(needles, g, undefined, { tint: 0x2f6a44, aoWorld: (pp) => (0.45 + 0.55 * THREE.MathUtils.clamp((pp.y - y + 0.4) / (th + 0.4), 0, 1)) * (0.85 + 0.15 * f) });
  }
  const lights: THREE.Vector3[] = [];
  const baubles: { p: THREE.Vector3; c: number }[] = [];
  const radiusAt = (y: number): number => THREE.MathUtils.lerp(3.25, 0.25, THREE.MathUtils.clamp((y - base) / (H - base), 0, 1));
  // Tinsel garlands spiralling up + fairy lights along them.
  for (let s = 0; s < 2; s++) {
    const turns = 4.2;
    const N = 180;
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const y = base + 0.6 + u * (H - base - 1.6);
      const a = u * turns * Math.PI * 2 + s * Math.PI;
      const r = radiusAt(y) * 0.98 + 0.1;
      const q = new THREE.Vector3(Math.cos(a) * r, y - 0.25 * Math.sin(u * turns * Math.PI * 4), Math.sin(a) * r);
      if (prev) {
        const d = q.clone().sub(prev);
        const g = new THREE.CylinderGeometry(0.045, 0.045, d.length() + 0.02, 5);
        g.translate(0, d.length() / 2, 0);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
        b.add('metal', g, mat(prev.x, prev.y, prev.z), { tint: s ? 0xe8c060 : 0xd8d8e0 });
      }
      if (i % 3 === 0) lights.push(q.clone().multiplyScalar(1.02).setY(q.y - 0.05));
      prev = q;
    }
  }
  // Baubles.
  const colors = [0xd8312a, 0xf2b928, 0x3f6fd0, 0xf6f0e6, 0x9a3ad0, 0x2a9a6a];
  for (let i = 0; i < 70; i++) {
    const y = base + 0.5 + rng.next() * (H - base - 1.8);
    const a = rng.next() * Math.PI * 2;
    const r = radiusAt(y) * 0.95;
    const p = new THREE.Vector3(Math.cos(a) * r, y - 0.2, Math.sin(a) * r);
    const c = colors[i % colors.length]!;
    b.add('metal', new THREE.SphereGeometry(0.13 + rng.next() * 0.06, 10, 8), mat(p.x, p.y, p.z), { tint: c });
    b.add('metal', new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6), mat(p.x, p.y + 0.16, p.z), { tint: 0xd8b060 });
    baubles.push({ p, c });
  }
  // Star.
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.28 : 0.7;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  sg.translate(0, 0, -0.08);
  const starY = H + 0.35;
  b.add('lampGlow', sg, mat(0, starY, 0), { tint: 0xffe08a });
  b.add('lampGlow', sg.clone(), mat(0, starY, 0, 0, Math.PI / 2, 0), { tint: 0xffe08a });
  // Gifts ring at the base.
  giftPile(b, rng, 0, 0, 2.4, 22);
  return { group: b.build({ name: 'star-tree' }), lights, baubles, star: new THREE.Vector3(0, starY, 0) };
}

/** Wrapped presents scattered in a ring (or pile when r ~ 0). */
export function giftPile(b: MeshBuilder, rng: Rng, cx: number, cz: number, r: number, n: number): void {
  const wraps: [number, number][] = [[0xd8312a, 0xf2d27a], [0x2a7a4a, 0xf2d27a], [0x3f6fd0, 0xf6f0e6], [0xf6f0e6, 0xd8312a], [0x9a3ad0, 0xf2d27a], [0xf2b928, 0xd8312a]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.next() * 0.3;
    const rr = r + (rng.next() - 0.5) * 0.6;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const w = 0.3 + rng.next() * 0.35;
    const h = 0.25 + rng.next() * 0.35;
    const d = 0.3 + rng.next() * 0.3;
    const [c, rib] = wraps[i % wraps.length]!;
    const rot = rng.next() * 3;
    b.add('cloth', roundedBox(w, h, d, 0.03, 1), mat(x, h / 2, z, 0, rot, 0), { tint: c, aoWorld: groundAO(0.2, 0.6) });
    b.add('cloth', roundedBox(w + 0.01, h + 0.01, 0.05, 0.01, 1), mat(x, h / 2, z, 0, rot, 0), { tint: rib });
    b.add('cloth', roundedBox(0.05, h + 0.01, d + 0.01, 0.01, 1), mat(x, h / 2, z, 0, rot, 0), { tint: rib });
    for (const s of [-1, 1]) {
      const loop = new THREE.TorusGeometry(0.06, 0.02, 4, 8);
      b.add('cloth', loop, mat(x + Math.cos(rot) * s * 0.05, h + 0.04, z - Math.sin(rot) * s * 0.05, 0, rot, s * 0.6), { tint: rib });
    }
  }
}

let iceMat: THREE.MeshStandardMaterial | null = null;
function ice(): THREE.MeshStandardMaterial {
  if (!iceMat) {
    iceMat = new THREE.MeshStandardMaterial({ color: 0xcfe8f8, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.78, emissive: 0x5aa8e0, emissiveIntensity: 0.18, vertexColors: true });
    iceMat.name = 'ice-sculpture';
  }
  return iceMat;
}

/** Ice sculpture on a snow plinth: 'swan', 'star' or 'deer'. */
export function buildIceSculpture(rng: Rng, kind: 'swan' | 'star' | 'deer'): THREE.Group {
  const b = new MeshBuilder();
  b.add('white', boxUV(roundedBox(1.1, 0.5, 1.1, 0.1), 1), mat(0, 0.25, 0), { tint: 0xf2f6fa, aoWorld: groundAO(0.3) });
  const I = ice();
  if (kind === 'swan') {
    const body = lumpySphere(0.5, 2, 0.05, rng, 2);
    body.scale(1.3, 0.7, 0.8);
    b.add(I, body, mat(0, 0.9, 0));
    for (const s of [-1, 1]) {
      const w = lumpySphere(0.4, 1, 0.1, rng, 2);
      w.scale(1.2, 0.45, 0.3);
      b.add(I, w, mat(-0.1, 1.2, s * 0.35, s * 0.6, 0, 0.5));
    }
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      b.add(I, new THREE.SphereGeometry(0.11 - t * 0.02, 8, 6), mat(0.55 + Math.sin(t * 2.4) * 0.2, 1.1 + t * 0.8, 0));
    }
    const beak = new THREE.ConeGeometry(0.05, 0.2, 6);
    beak.rotateZ(-Math.PI / 2);
    b.add(I, beak, mat(0.78, 1.88, 0));
  } else if (kind === 'star') {
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.28 : 0.65;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    star.closePath();
    const g = new THREE.ExtrudeGeometry(star, { depth: 0.2, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    g.translate(0, 0, -0.1);
    b.add(I, g, mat(0, 1.35, 0, 0, 0.3, 0));
    b.add(I, bevelCylinder(0.12, 0.2, 0.6, 0.03, 8), mat(0, 0.5, 0));
  } else {
    const body = lumpySphere(0.4, 2, 0.05, rng, 2);
    body.scale(1.4, 0.8, 0.7);
    b.add(I, body, mat(0, 1.15, 0));
    for (const [x, z] of [[-0.35, -0.15], [-0.35, 0.15], [0.35, -0.15], [0.35, 0.15]] as const) b.add(I, bevelCylinder(0.06, 0.07, 0.65, 0.02, 6), mat(x, 0.5, z));
    b.add(I, bevelCylinder(0.1, 0.14, 0.5, 0.03, 8), mat(0.5, 1.35, 0, 0, 0, -0.5));
    const head = lumpySphere(0.18, 1, 0.05, rng, 2);
    head.scale(1.4, 1, 0.9);
    b.add(I, head, mat(0.72, 1.62, 0));
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) b.add(I, bevelCylinder(0.02, 0.025, 0.35, 0.01, 5), mat(0.68 + k * 0.05, 1.85 + k * 0.1, s * (0.1 + k * 0.05), s * 0.5, 0, -0.3 + k * 0.3));
  }
  const g = b.build({ name: `ice-${kind}` });
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === I) {
      o.castShadow = false;
      o.userData.dynamic = true;
      o.userData.noAO = true;
    }
  });
  return g;
}

/** Stone arch footbridge spanning `span` along X (deck at `deckY`). */
export function buildBridge(rng: Rng, span: number, width = 2.2, deckY = 0.9): THREE.Group {
  const b = new MeshBuilder();
  const n = 16;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const x0 = -span / 2 + t0 * span;
    const x1 = -span / 2 + t1 * span;
    const y0 = deckY + Math.sin(t0 * Math.PI) * 0.5;
    const y1 = deckY + Math.sin(t1 * Math.PI) * 0.5;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    b.add('stone', boxUV(roundedBox(len + 0.05, 0.3, width, 0.05), 1), mat((x0 + x1) / 2, (y0 + y1) / 2 - 0.15, 0, 0, 0, ang), { tint: 0xc8c0b2 });
    for (const sz of [-1, 1]) b.add('stone', boxUV(roundedBox(len + 0.05, 0.45, 0.22, 0.05), 1), mat((x0 + x1) / 2, (y0 + y1) / 2 + 0.22, sz * (width / 2 - 0.11), 0, 0, ang), { tint: 0xb8b0a2 });
  }
  // Arch underside.
  const arch = new THREE.TorusGeometry(span * 0.36, 0.35, 6, 20, Math.PI);
  arch.scale(1, 0.55, 1);
  for (const sz of [-1, 1]) b.add('stone', boxUV(arch.clone(), 1), mat(0, deckY - 0.9, sz * (width / 2 - 0.3), 0, 0, 0, 1, 1, 1), { tint: 0xa8a092 });
  for (const sx of [-1, 1]) b.add('stone', boxUV(roundedBox(1.2, deckY + 0.6, width + 0.2, 0.08), 1), mat(sx * (span / 2 + 0.3), (deckY + 0.6) / 2 - 0.6, 0), { tint: 0xb8b0a2 });
  void rng;
  return b.build({ name: 'bridge' });
}

/** Cocoa stand: a little wooden hut-counter with a kettle, mugs, and a painted sign. */
export function buildCocoaStand(rng: Rng): { group: THREE.Group; steam: THREE.Vector3 } {
  const b = new MeshBuilder();
  const W = 2.4;
  b.add('wood', boxUV(roundedBox(W, 1.0, 1.0, 0.04), 1 / 1.2), mat(0, 0.5, 0), { tint: 0x9a6a44, aoWorld: groundAO(0.3) });
  b.add('woodGrain', roundedBox(W + 0.2, 0.08, 1.15, 0.03), mat(0, 1.04, 0.03), { tint: 0xc8a07a });
  for (const sx of [-1, 1]) b.add('woodGrain', roundedBox(0.1, 2.4, 0.1, 0.03), mat(sx * (W / 2 - 0.05), 1.2, -0.45), { tint: 0x7a5234 });
  // Little gable roof.
  for (const s of [-1, 1]) b.add('roofTile', boxUV(roundedBox(W + 0.4, 0.12, 1.0, 0.04), 1 / 1.6), mat(0, 2.55, s * 0.3 - 0.2, s * 0.55, 0, 0), { tint: 0x2f6a4a });
  b.add('woodPaint', roundedBox(1.4, 0.4, 0.06, 0.03), mat(0, 2.05, -0.38), { tint: 0xf6ecd8 });
  for (let i = 0; i < 3; i++) b.add('woodPaint', roundedBox(0.3 - i * 0.05, 0.04, 0.02, 0.01, 1), mat(-0.3 + i * 0.3, 2.05, -0.34), { tint: [0xd8312a, 0x6a3a1e, 0x2f6a4a][i]! });
  const pot = new THREE.SphereGeometry(0.22, 12, 8);
  pot.scale(1, 0.85, 1);
  b.add('metal', pot, mat(-0.6, 1.28, 0), { tint: 0x8a4a2a });
  b.add('metal', new THREE.TorusGeometry(0.16, 0.02, 4, 10, Math.PI), mat(-0.6, 1.45, 0), { tint: 0x3a3430 });
  for (let i = 0; i < 6; i++) b.add('white', new THREE.CylinderGeometry(0.06, 0.055, 0.12, 10), mat(0.1 + (i % 3) * 0.2, 1.14, -0.1 + Math.floor(i / 3) * 0.2), { tint: [0xd8312a, 0xf6f0e6, 0x2f6a4a][i % 3]! });
  // Garland along the counter.
  for (let i = 0; i < 14; i++) {
    const g = lumpySphere(0.09, 1, 0.3, rng, 3);
    b.add('boxFlower', g, mat(-W / 2 + (i + 0.5) * (W / 14), 0.95 - Math.sin((i / 13) * Math.PI) * 0.12, 0.52), { tint: 0x2f5a3a });
  }
  return { group: b.build({ name: 'cocoa-stand' }), steam: new THREE.Vector3(-0.6, 1.5, 0) };
}

/** Frozen river ice sheet (dynamic material): glossy, scratched by skates, reflecting lamps. */
export function iceSheetMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xb8d4e6, roughness: 0.12, metalness: 0.15, vertexColors: true });
  m.name = 'river-ice';
  return m;
}

export { prep };
