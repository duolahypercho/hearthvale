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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, boxUV, mat, lumpySphere, sphericalNormals, uvScale, groundAO, prep } from '../geom';
import { materials } from '../../render/materials';
import { applyWorldFx } from '../../render/worldfx';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
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

/** Cupped petal / feather card: base at the origin, tip at +Y, edges curling towards +Z (8 tris). */
export function petalCard(w: number, h: number, cup = 0.3): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 2, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2);
    const y = p.getY(i) / (h / 2);
    const taper = (1 - 0.42 * Math.max(0, y) ** 2) * (0.62 + 0.38 * (1 - Math.max(0, -y)));
    p.setX(i, p.getX(i) * taper);
    p.setZ(i, x * x * cup * w * 0.5 + (y + 1) * 0.02 * h);
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
/** Matrix placing a card at `p` with its tip along `tip` and its face along `normal`. */
function cardAt(p: THREE.Vector3, tip: THREE.Vector3, normal: THREE.Vector3, lift = 0.25, roll = 0): THREE.Matrix4 {
  _bz.copy(normal).normalize();
  const along = tip.dot(_bz);
  _by.copy(tip).addScaledVector(_bz, -along).normalize();
  // Tip lifts off the surface a little (shingles / feathers stand proud).
  _by.addScaledVector(_bz, lift).normalize();
  _bx.crossVectors(_by, _bz).normalize();
  _bz.crossVectors(_bx, _by).normalize();
  const m = new THREE.Matrix4().makeBasis(_bx, _by, _bz).setPosition(p);
  if (roll) m.multiply(new THREE.Matrix4().makeRotationY(roll));
  return m;
}

/**
 * Cover an ellipsoid with overlapping petal cards in latitude rows, tips pointing down the
 * meridians (scales / feathers / shingles). `keep(theta, phi)` can skip patches; `tint` colours
 * each card. A solid under-body fills the gaps.
 */
function shingleEllipsoid(b: MeshBuilder, rng: Rng, c: THREE.Vector3, rad: THREE.Vector3, card: { w: number; h: number; cup?: number; step?: number }, tint: (theta: number, phi: number) => number, keep: (theta: number, phi: number) => boolean = () => true, thetaMax = Math.PI * 0.92): void {
  const under = new THREE.SphereGeometry(1, 16, 10);
  under.scale(rad.x * 0.97, rad.y * 0.97, rad.z * 0.97);
  b.add('boxFlower', under, mat(c.x, c.y, c.z), { tint: tint(Math.PI / 2, 0), aoWorld: (q) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(q.y, c.y - rad.y, c.y + rad.y * 0.4) });
  const step = card.step ?? card.h * 0.55;
  const geo = petalCard(card.w, card.h, card.cup ?? 0.3);
  const meanR = (rad.x + rad.y + rad.z) / 3;
  const rows = Math.max(3, Math.round((thetaMax * meanR) / step));
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const th = 0.12 + (r / (rows - 1)) * (thetaMax - 0.12);
    const ring = 2 * Math.PI * Math.sin(th) * Math.sqrt((rad.x * rad.x + rad.z * rad.z) / 2);
    const k = Math.max(4, Math.round(ring / (card.w * 0.62)));
    for (let i = 0; i < k; i++) {
      const ph = ((i + (r % 2) * 0.5) / k) * Math.PI * 2 + (rng.next() - 0.5) * 0.08;
      if (!keep(th, ph)) continue;
      const st = Math.sin(th);
      const ct = Math.cos(th);
      p.set(rad.x * st * Math.cos(ph), rad.y * ct, rad.z * st * Math.sin(ph)).add(c);
      n.set((st * Math.cos(ph)) / rad.x, ct / rad.y, (st * Math.sin(ph)) / rad.z).normalize();
      d.set(rad.x * ct * Math.cos(ph), -rad.y * st, rad.z * ct * Math.sin(ph)).normalize();
      b.add('boxFlower', geo.clone(), cardAt(p.addScaledVector(n, -0.01), d, n, 0.2 + rng.next() * 0.12, (rng.next() - 0.5) * 0.3), { tint: tint(th, ph) });
    }
  }
}

/** Tapered tube along a curve (limbs, necks, stems). */
export function taperTube(curve: THREE.Curve<THREE.Vector3>, segs: number, r0: number, r1: number, radial = 6): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, P);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      N.copy(frames.normals[i]!).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i]!, Math.sin(a));
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nor.push(N.x, N.y, N.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b2 = a + radial + 1;
      idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Parade float: a petal-skirted wagon (the skirt hangs to the cobbles and hides the wheels) with a
 * tall themed centrepiece, 2–2.8 m above the deck:
 *   'swan'   a petal-feathered swan, wings raised, S-curved neck, a flower crown
 *   'tulip'  a bouquet of giant tulips (the centre one 2.6 m), broad leaves
 *   'sun'    a beaming sunflower-sun on a stalk, two rings of petal rays
 *   'throne' the Blossom Queen's rose heart arch + seat (anchor `seat`)
 * Origin = centre on the ground, the float travels along +X, the crowd side is +Z.
 */
export function buildFlowerFloat(rng: Rng, kind: 'tulip' | 'sun' | 'throne' | 'swan'): { group: THREE.Group; anchors: Record<string, THREE.Vector3> } {
  const b = new PaintBuilder();
  const L = 3.4;
  const W = 1.9;
  const deckY = 0.72;
  const anchors: Record<string, THREE.Vector3> = {};
  b.add('wood', boxUV(roundedBox(L, 0.16, W, 0.05), 1.2), mat(0, deckY, 0), { tint: 0xd8b890 });
  const bands = kind === 'throne' ? [0xfff2f4, 0xf7b8c8, 0xf07a98, 0xe0507a] : kind === 'tulip' ? [0xfff0c8, 0xfde2a0, 0xffc4a8, 0xf7a080] : kind === 'swan' ? [0xf6fbff, 0xd8ecf8, 0xb8d8f0, 0x9ac0e8] : [0xfff6c8, 0xffe070, 0xffc040, 0xf09a30];
  // Wheels tucked in under the skirt (only the lower rim peeks out).
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(b, sx * 1.05, 0.32, sz * (W / 2 - 0.22), 0.3);
  b.add('boxFlower', roundedBox(L - 0.2, 0.5, W - 0.2, 0.06, 1), mat(0, deckY - 0.3, 0), { tint: 0x3f7a2e });
  // Petal skirt: overlapping rows of big petals hanging from the deck edge down to the cobbles.
  const card = petalCard(0.24, 0.3, 0.45);
  const rows = 4;
  const per = 2 * (L + W);
  for (let row = 0; row < rows; row++) {
    const y = deckY + 0.05 - row * 0.17;
    const n = Math.round(per / 0.16);
    for (let i = 0; i < n; i++) {
      let d = ((i + (row % 2) * 0.5) / n) * per;
      let x = -L / 2;
      let z = -W / 2;
      let nx = 0;
      let nz = -1;
      if (d < L) (x += d), (nz = -1);
      else if ((d -= L) < W) (x = L / 2), (z += d), (nx = 1), (nz = 0);
      else if ((d -= W) < L) (x = L / 2 - d), (z = W / 2), (nx = 0), (nz = 1);
      else (d -= L), (x = -L / 2), (z = W / 2 - d), (nx = -1), (nz = 0);
      const out = new THREE.Vector3(nx, 0, nz);
      const p = new THREE.Vector3(x + nx * (0.05 + row * 0.012), y, z + nz * (0.05 + row * 0.012));
      const c = new THREE.Color(bands[row]!).multiplyScalar(0.92 + rng.next() * 0.12);
      b.add('boxFlower', card.clone(), cardAt(p, new THREE.Vector3(0, -1, 0), out, 0.12 + rng.next() * 0.1, (rng.next() - 0.5) * 0.25), { tint: c.getHex() });
    }
  }
  // Deck rim: a rope of blooms.
  for (let i = 0; i < 44; i++) {
    let d = (i / 44) * per;
    let x = -L / 2;
    let z = -W / 2;
    if (d < L) x += d;
    else if ((d -= L) < W) (x = L / 2), (z += d);
    else if ((d -= W) < L) (x = L / 2 - d), (z = W / 2);
    else (d -= L), (z = W / 2 - d);
    flowerHead(b, x, deckY + 0.1, z, [0xffffff, bands[2]!, 0xfde070][i % 3]!, 2.0, rng);
  }
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  if (kind === 'swan') {
    const white = (th: number, ph: number): number => new THREE.Color(0xe0d6cc).lerp(new THREE.Color(0xe8b4c4), THREE.MathUtils.smoothstep(th, 1.9, 2.8) * 0.6 + (Math.cos(ph) < -0.6 ? 0.15 : 0)).multiplyScalar(0.94 + rng.next() * 0.08).getHex();
    shingleEllipsoid(b, rng, P(-0.05, deckY + 0.78, 0), P(1.0, 0.6, 0.66), { w: 0.2, h: 0.24, cup: 0.35 }, white, undefined, Math.PI * 0.7);
    // Raised wings: flattened petal-feathered ellipsoids, tips swept back.
    for (const s of [-1, 1]) {
      const wing = new MeshBuilder();
      shingleEllipsoid(wing, rng, P(0, 0, 0), P(0.85, 0.5, 0.16), { w: 0.18, h: 0.26, cup: 0.3 }, white, (th) => th < 2.2, Math.PI * 0.85);
      b.addBuilder(wing, mat(-0.35, deckY + 1.35, s * 0.55, s * 0.55, 0, 0.55));
    }
    // Tail plume.
    for (let i = 0; i < 9; i++) {
      const a = -0.6 + (i / 8) * 1.2;
      b.add('boxFlower', petalCard(0.2, 0.5, 0.4), cardAt(P(-0.95, deckY + 0.95, a * 0.3), P(-1, 0.55, a * 0.6), P(-0.2, 1, a * 0.3), 0.1), { tint: 0xe0d6cc });
    }
    // S-curved neck (tapered tube) + head, beak, eyes, a little flower crown.
    const neck = new THREE.CatmullRomCurve3([P(0.75, deckY + 0.95, 0), P(1.1, deckY + 1.45, 0), P(0.88, deckY + 2.05, 0), P(1.05, deckY + 2.5, 0)]);
    b.add('boxFlower', taperTube(neck, 14, 0.2, 0.12, 9), undefined, { tint: 0xe0d6cc });
    const head = new THREE.SphereGeometry(0.2, 12, 9);
    head.scale(1.25, 0.95, 0.9);
    b.add('boxFlower', head, mat(1.12, deckY + 2.6, 0), { tint: 0xe0d6cc });
    const beak = new THREE.ConeGeometry(0.085, 0.34, 8);
    beak.rotateZ(-Math.PI / 2);
    b.add('boxFlower', beak, mat(1.42, deckY + 2.56, 0, 0, 0, -0.15), { tint: 0xf5a03a });
    b.add('boxFlower', new THREE.SphereGeometry(0.06, 8, 6), mat(1.3, deckY + 2.6, 0), { tint: 0x2a2a2a });
    for (const s of [-1, 1]) b.add('white', new THREE.SphereGeometry(0.035, 8, 6), mat(1.22, deckY + 2.66, s * 0.15), { tint: 0x1a1a1e });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      flowerHead(b, 1.08 + Math.cos(a) * 0.14, deckY + 2.8, Math.sin(a) * 0.14, [0xf06a8a, 0xffd166, 0xc77dff][i % 3]!, 1.3, rng);
    }
    bloomMound(b, rng, 0.2, deckY + 0.28, 0.72, 0.3, [0xb8e0f0, 0xffffff, 0xd4b8f0], 0.8);
    bloomMound(b, rng, 0.2, deckY + 0.28, -0.72, 0.3, [0xb8e0f0, 0xffffff, 0xd4b8f0], 0.8);
    anchors.seat = P(-1.25, deckY + 0.12, 0.45);
  } else if (kind === 'tulip') {
    // A bouquet of giant tulips: the centre one towers at 2.6 m.
    const tints = [0xf04a6a, 0xfde070, 0xff9ab8, 0xf57a3a, 0xffffff, 0xc86ae0];
    const stems: [number, number, number, number][] = [[0, 0, 2.6, 0], [0.55, 0.3, 1.9, 0.2], [-0.55, 0.25, 2.0, -0.18], [0.35, -0.45, 1.7, 0.15], [-0.4, -0.45, 1.75, -0.2], [1.05, -0.1, 1.4, 0.3]];
    stems.forEach(([x, z, h, lean], i) => {
      const top = P(x + lean * h * 0.4, deckY + 0.08 + h, z + lean * 0.2);
      const stem = new THREE.CatmullRomCurve3([P(x, deckY + 0.08, z), P(x + lean * h * 0.15, deckY + 0.08 + h * 0.5, z), top]);
      b.add('boxFlower', taperTube(stem, 6, 0.065, 0.045, 6), undefined, { tint: 0x4f9a3a });
      const big = i === 0 ? 1.45 : 1;
      const pr = 0.24 * big;
      // Cup of 6 petals (inner 3 + outer 3), lighter at the tips.
      for (let p = 0; p < 6; p++) {
        const pa = (p / 6) * Math.PI * 2 + (p % 2) * 0.2;
        const pet = new THREE.SphereGeometry(pr, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
        pet.scale(0.66, 1.45, 0.42);
        const col = new THREE.Color(tints[i % tints.length]!);
        b.add('boxFlower', pet, mat(top.x + Math.cos(pa) * 0.1 * big, top.y - 0.2 * big, top.z + Math.sin(pa) * 0.1 * big, 0, -pa + Math.PI / 2, -0.18 - (p % 2) * 0.1), { tint: col.getHex(), aoWorld: (q) => 0.75 + 0.35 * THREE.MathUtils.smoothstep(q.y, top.y - 0.35 * big, top.y + 0.3 * big) });
      }
      for (const s of [-1, 1]) {
        const leaf = new THREE.SphereGeometry(0.26, 8, 6);
        leaf.scale(0.3, 2.2, 0.08);
        b.add('boxFlower', leaf, mat(x + s * 0.14, deckY + 0.55 + h * 0.08, z, 0, s * 0.6 + i, s * 0.5), { tint: 0x5aa83e });
      }
    });
    bloomMound(b, rng, 0, deckY + 0.3, 0, 0.6, [0xffffff, 0xfde2a0, 0xf7a8c0], 0.6);
    anchors.seat = P(1.2, deckY + 0.12, 0.5);
  } else if (kind === 'sun') {
    // A beaming sunflower-sun on a stalk, facing the crowd (+Z) and the street behind (-Z).
    const c = P(0.1, deckY + 2.2, 0);
    const stalk = new THREE.CatmullRomCurve3([P(0.2, deckY + 0.08, 0), P(0.0, deckY + 1.0, 0), c.clone().setY(c.y - 0.3)]);
    b.add('boxFlower', taperTube(stalk, 8, 0.12, 0.08, 7), undefined, { tint: 0x4f9a3a });
    for (const s of [-1, 1]) {
      const leaf = new THREE.SphereGeometry(0.4, 10, 6);
      leaf.scale(1.4, 0.12, 0.6);
      b.add('boxFlower', leaf, mat(0.1 + s * 0.45, deckY + 0.95 + (s > 0 ? 0.25 : 0), 0, 0, 0, s * 0.35), { tint: 0x5aa83e });
    }
    for (const face of [1, -1]) {
      // Two rings of petal rays.
      for (let ring = 0; ring < 2; ring++) {
        const n = 16;
        for (let i = 0; i < n; i++) {
          const a = ((i + ring * 0.5) / n) * Math.PI * 2;
          const dir = P(Math.cos(a), Math.sin(a), 0);
          const base = c.clone().addScaledVector(dir, 0.5 - ring * 0.04).setZ(face * (0.05 + ring * 0.05));
          b.add('boxFlower', petalCard(0.3, 0.62 - ring * 0.12, 0.35), cardAt(base, dir, P(0, 0, face), -0.05 * face), { tint: ring ? 0xffc53a : 0xffe062 });
        }
      }
    }
    const disc = new THREE.SphereGeometry(0.58, 20, 12);
    disc.scale(1, 1, 0.32);
    b.add('boxFlower', disc, mat(c.x, c.y, c.z), { tint: 0x8a4a1e });
    // Seed spiral (a golden-angle dimple field) + a cheerful face on the crowd side.
    for (let i = 0; i < 70; i++) {
      const r = Math.sqrt(i / 70) * 0.5;
      const a = i * 2.39996;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const zc = Math.sqrt(Math.max(0, 1 - (r / 0.58) ** 2)) * 0.18 + 0.01;
      b.add('boxFlower', new THREE.IcosahedronGeometry(0.035, 0), mat(c.x + x, c.y + y, zc), { tint: i % 3 ? 0x6a3614 : 0xa8622a });
    }
    for (const s of [-1, 1]) {
      b.add('white', new THREE.SphereGeometry(0.07, 8, 6), mat(c.x + s * 0.19, c.y + 0.1, 0.19, 0, 0, 0, 0.8, 1.1, 0.5), { tint: 0x1e1410 });
      b.add('white', new THREE.SphereGeometry(0.08, 8, 6), mat(c.x + s * 0.3, c.y - 0.08, 0.17, 0, 0, 0, 1, 0.7, 0.4), { tint: 0xf07a5a });
    }
    const smile = new THREE.TorusGeometry(0.2, 0.03, 5, 14, Math.PI);
    b.add('white', smile, mat(c.x, c.y - 0.02, 0.2, 0, 0, Math.PI), { tint: 0x1e1410 });
    bloomMound(b, rng, 0.9, deckY + 0.3, 0.45, 0.36, [0xffc53a, 0xf57a3a, 0xffffff], 0.8);
    bloomMound(b, rng, -0.9, deckY + 0.28, -0.35, 0.34, [0xffc53a, 0xf57a3a, 0xffe070], 0.8);
    anchors.seat = P(-1.15, deckY + 0.12, 0.5);
  } else {
    // The Blossom Queen: rose heart arch behind a white seat that faces the crowd (+Z).
    const seatX = -0.2;
    b.add('woodPaint', roundedBox(0.9, 0.12, 0.7, 0.04), mat(seatX, deckY + 0.5, 0), { tint: 0xf0a8b8 });
    b.add('woodPaint', roundedBox(0.9, 0.9, 0.12, 0.04), mat(seatX, deckY + 0.85, -0.36), { tint: 0xf0a8b8 });
    for (const sx of [-1, 1]) b.add('woodPaint', roundedBox(0.1, 0.1, 0.7, 0.03), mat(seatX + sx * 0.42, deckY + 0.72, 0), { tint: 0xe8d8c8 });
    b.add('woodPaint', roundedBox(0.8, 0.44, 0.6, 0.05), mat(seatX, deckY + 0.24, 0), { tint: 0xe4d4c4 });
    anchors.seat = new THREE.Vector3(seatX, deckY + 0.34, 0.02);
    for (let i = 0; i <= 30; i++) {
      const t = (i / 30) * Math.PI * 2;
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      bloomMound(b, rng, seatX + hx * 0.085, deckY + 1.95 + hy * 0.08, -0.55, 0.22, i % 2 ? [0xf04a6a, 0xff8fab] : [0xffffff, 0xf7a8c0], 0.8);
    }
    bloomMound(b, rng, 1.15, deckY + 0.3, 0.3, 0.42, [0xf04a6a, 0xffffff, 0xff8fab]);
    bloomMound(b, rng, -1.25, deckY + 0.25, 0.4, 0.34, [0xffffff, 0xf7a8c0]);
  }
  // Pennant pole at the back.
  b.add('woodGrain', bevelCylinder(0.03, 0.03, 2.6, 0.01, 6), mat(-L / 2 + 0.2, deckY, -W / 2 + 0.25), { tint: 0xd8b060 });
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.lineTo(0.7, -0.14);
  flag.lineTo(0, -0.34);
  flag.closePath();
  b.add('cloth', new THREE.ShapeGeometry(flag), mat(-L / 2 + 0.2, deckY + 2.55, -W / 2 + 0.25, 0, Math.PI, 0), { tint: bands[2]! });
  return { group: b.build({ name: `float-${kind}` }), anchors };
}

/**
 * Cherry trees: a crooked trunk splitting into 4–6 dark limbs, each ending in its own blossom clump
 * (lighter crowns, shaded undersides, white flecks) so the branch structure shows between clumps.
 * Bark is static (merged); the blossom clumps sway in the wind (one draw call + swaying shadow).
 */
export function buildCherryTrees(rng: Rng, trees: { x: number; y: number; z: number; s: number }[]): { bark: THREE.Group; bloom: THREE.Mesh; canopies: { x: number; y: number; z: number; r: number; ground: number }[] } {
  const bark = new MeshBuilder();
  const bloom = new MeshBuilder();
  const canopies: { x: number; y: number; z: number; r: number; ground: number }[] = [];
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const pinks = [0xf0a2bc, 0xf4b4c8, 0xec94b0, 0xf6c2d2];
  for (const t of trees) {
    const s = t.s;
    const base = P(t.x, t.y - 0.05, t.z);
    const lean = rng.next() * Math.PI * 2;
    const fork = base.clone().add(P(Math.cos(lean) * 0.25 * s, 1.5 * s, Math.sin(lean) * 0.25 * s));
    const trunk = new THREE.CatmullRomCurve3([base, base.clone().add(P(Math.cos(lean) * 0.05, 0.7 * s, Math.sin(lean) * 0.05)), fork]);
    bark.add('bark', taperTube(trunk, 6, 0.24 * s, 0.15 * s, 8), undefined, { tint: 0x5a3e36, aoWorld: groundAO(0.6) });
    // Root flare.
    for (let i = 0; i < 4; i++) {
      const a = lean + (i / 4) * Math.PI * 2;
      const root = new THREE.CatmullRomCurve3([base.clone().add(P(0, 0.35 * s, 0)), base.clone().add(P(Math.cos(a) * 0.45 * s, 0.02, Math.sin(a) * 0.45 * s))]);
      bark.add('bark', taperTube(root, 2, 0.12 * s, 0.03 * s, 5), undefined, { tint: 0x4a322a });
    }
    const n = 4 + Math.floor(rng.next() * 2);
    let top = 0;
    for (let i = 0; i < n; i++) {
      const a = lean + (i / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
      const up = 0.55 + rng.next() * 0.5;
      const len = (1.3 + rng.next() * 0.6) * s;
      const out = P(Math.cos(a), 0, Math.sin(a));
      const mid = fork.clone().addScaledVector(out, len * 0.45).add(P(0, len * up * 0.55, 0));
      const end = fork.clone().addScaledVector(out, len).add(P(0, len * up, 0));
      const limb = new THREE.CatmullRomCurve3([fork, mid, end]);
      bark.add('bark', taperTube(limb, 5, 0.1 * s, 0.035 * s, 6), undefined, { tint: 0x4e3630 });
      // A twig off each limb.
      const tw = mid.clone().add(P(-out.z * 0.5 * s, 0.35 * s, out.x * 0.5 * s));
      bark.add('bark', taperTube(new THREE.CatmullRomCurve3([mid, mid.clone().lerp(tw, 0.5).add(P(0, 0.1 * s, 0)), tw]), 3, 0.04 * s, 0.015 * s, 5), undefined, { tint: 0x4e3630 });
      // Blossom clumps at the limb end (a cluster of 3 puffs) + a smaller one on the twig.
      const puffs: [THREE.Vector3, number][] = [[tw.clone().add(P(0, 0.08 * s, 0)), 0.34 * s]];
      const cr0 = (0.55 + rng.next() * 0.2) * s;
      puffs.push([end.clone().add(P(0, 0.1 * s, 0)), cr0]);
      for (let q = 0; q < 2; q++) {
        const qa = a + (q ? 1 : -1) * (0.7 + rng.next() * 0.4);
        puffs.push([end.clone().add(P(Math.cos(qa) * cr0 * 0.75, -0.08 * s + rng.next() * 0.2 * s, Math.sin(qa) * cr0 * 0.75)), cr0 * (0.6 + rng.next() * 0.15)]);
      }
      for (const [cp, cr] of puffs) {
        const g = lumpySphere(cr, cr > 0.5 * s ? 2 : 1, 0.34, rng, 2.6);
        g.scale(1.08, 0.74, 1.08);
        sphericalNormals(g, new THREE.Vector3(), 0.8);
        const tint = pinks[Math.floor(rng.next() * pinks.length)]!;
        const seed = rng.next() * 100;
        bloom.add('boxFlower', g, mat(cp.x, cp.y, cp.z), {
          tint,
          aoWorld: (q, nn) => {
            const hi = THREE.MathUtils.smoothstep(q.y, cp.y - cr * 0.6, cp.y + cr * 0.55);
            // Florets: speckled light / deep-pink blossoms over the clump.
            const f = Math.sin(q.x * 41 + seed) * Math.sin(q.z * 37 - seed) * Math.sin(q.y * 43 + seed * 0.5);
            const fl = f > 0.35 ? 1.14 : f < -0.45 ? 0.82 : 1;
            return (0.6 + 0.42 * hi) * (nn.y < -0.3 ? 0.78 : 1) * fl;
          },
        });
        top = Math.max(top, cp.y);
      }
    }
    canopies.push({ x: fork.x, y: top, z: fork.z, r: 1.9 * s, ground: t.y });
  }
  const barkGroup = bark.build({ name: 'cherry-bark' });
  const geos = [...bloom.geometries().values()];
  const mergedBloom = mergeGeometries(geos)!;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  m.name = 'cherry-bloom';
  applyWorldFx(m);
  // Florets: the clump surface resolves into little five-petal blossoms (pale petals, a deep pink
  // eye, shadowed gaps between) — 3D cells in world space, so no UVs are needed.
  patchMaterial(m, 'cherry-florets', (shader) => {
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 q = vHvWorldPos * 7.5;
        vec3 ci = floor(q);
        vec3 cf = fract(q) - 0.5;
        vec3 h = fract(sin(vec3(dot(ci, vec3(127.1, 311.7, 74.7)), dot(ci, vec3(269.5, 183.3, 246.1)), dot(ci, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
        vec3 o = cf - (h - 0.5) * 0.5;
        float d = length(o);
        float ang = atan(o.z, o.x) + h.x * 6.28;
        float petal = 0.3 + 0.1 * cos(ang * 5.0);
        float bloom = 1.0 - smoothstep(petal - 0.05, petal, d);
        float eye = 1.0 - smoothstep(0.05, 0.09, d);
        vec3 pale = mix(vec3(1.0, 0.9, 0.93), vec3(1.0, 0.78, 0.86), h.y);
        vec3 c = diffuseColor.rgb;
        c = mix(c * 0.78, c * pale * 1.18, bloom);
        c = mix(c, c * vec3(0.8, 0.42, 0.55), eye * bloom);
        diffuseColor.rgb = c;
      }`,
    );
  });
  const windOpts = { mode: 'height' as const, height: 5, amplitude: 0.1, flutter: 0.35 };
  applyWind(m, windOpts);
  const mesh = new THREE.Mesh(mergedBloom, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = windDepthMaterial(windOpts);
  mesh.name = 'cherry-bloom';
  mesh.geometry.computeBoundingSphere();
  return { bark: barkGroup, bloom: mesh, canopies };
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
  // Ember bed: charcoal with a glowing heart.
  b.add('rock', new THREE.CylinderGeometry(0.5, 0.55, 0.06, 12), mat(0, 0.03, 0), { tint: 0x2a1c16 });
  b.add('paperLantern', lumpySphere(0.3, 1, 0.3, rng, 3).scale(1, 0.25, 1), mat(0, 0.07, 0), { tint: 0x8a2a0a });
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

/** Flip a geometry inside out (reverse winding + normals) — inner shells of hulls, bowls. */
function inside(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.index;
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const n = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/**
 * Little clinker rowboat: a solid painted hull (outside) with a darker varnished inside, a gunwale
 * rail, strakes, floor boards, two thwarts, oars shipped along the side and a lantern on a pole.
 */
export function buildRowboat(rng: Rng, tint = 0x4f8fb0): { group: THREE.Group; glow: THREE.Vector3 } {
  const b = new MeshBuilder();
  // Hull: lower half of an ellipsoid, pinched at the bow (+X) and stern.
  const hull = (): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const bow = x > 0 ? 1 - 0.35 * x * x : 1 - 0.12 * x * x;
      p.setXYZ(i, x * 1.45, p.getY(i) * 0.46, p.getZ(i) * 0.64 * bow);
    }
    g.computeVertexNormals();
    return g;
  };
  b.add('woodPaint', hull(), mat(0, 0.42, 0), { tint, aoWorld: (q) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(q.y, 0.0, 0.42) });
  const inner = inside(hull());
  inner.scale(0.93, 0.9, 0.9);
  b.add('woodGrain', inner, mat(0, 0.43, 0), { tint: 0x8a5a36, aoWorld: (q) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(q.y, 0.05, 0.4) });
  // Strakes (clinker planks) as thin bands on the outside, a pale waterline stripe.
  for (const [y, c] of [[0.3, shadeHex(tint, 0.82)], [0.2, 0xf2ece0], [0.12, shadeHex(tint, 0.7)]] as const) {
    const k = 1 - Math.pow((0.42 - y) / 0.46, 2);
    const band = new THREE.TorusGeometry(1, 0.018, 3, 28);
    band.rotateX(Math.PI / 2);
    band.scale(1.45 * Math.sqrt(k) * 1.005, 1, 0.64 * Math.sqrt(k) * 1.01);
    b.add('woodPaint', band, mat(0, y, 0), { tint: c });
  }
  const rim = new THREE.TorusGeometry(1, 0.045, 5, 30);
  rim.rotateX(Math.PI / 2);
  rim.scale(1.45, 1, 0.61);
  b.add('woodGrain', rim, mat(0, 0.43, 0), { tint: 0xd8b48a });
  // Floor boards + thwarts.
  for (let i = -2; i <= 2; i++) b.add('woodGrain', roundedBox(1.5 - Math.abs(i) * 0.15, 0.03, 0.1, 0.01, 1), mat(0, 0.1, i * 0.11), { tint: 0xb88a5a });
  b.add('woodGrain', roundedBox(0.26, 0.05, 1.08, 0.015, 1), mat(0.28, 0.3, 0), { tint: 0xc8a07a });
  b.add('woodGrain', roundedBox(0.26, 0.05, 0.92, 0.015, 1), mat(-0.62, 0.3, 0), { tint: 0xc8a07a });
  // Oars shipped along the thwarts.
  for (const s of [-1, 1]) {
    b.add('woodGrain', bevelCylinder(0.022, 0.022, 1.9, 0.005, 5), mat(-0.95, 0.4, s * 0.42, 0, 0, -Math.PI / 2 + 0.05), { tint: 0xd8b48a });
    b.add('woodGrain', roundedBox(0.34, 0.02, 0.12, 0.008, 1), mat(0.92, 0.47, s * 0.42), { tint: 0xd8b48a });
  }
  // Lantern pole at the bow.
  b.add('woodGrain', bevelCylinder(0.02, 0.02, 1.25, 0.005, 5), mat(1.0, 0.2, 0), { tint: 0x8a6a4a });
  b.add('woodGrain', roundedBox(0.22, 0.02, 0.02, 0.005, 1), mat(1.1, 1.42, 0), { tint: 0x8a6a4a });
  const lan = lumpySphere(0.13, 1, 0.03, rng, 2);
  lan.scale(1, 1.3, 1);
  b.add('paperLantern', lan, mat(1.2, 1.2, 0), { tint: 0xffa850 });
  b.add('white', new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8), mat(1.2, 1.37, 0), { tint: 0x3a2a1e });
  return { group: b.build({ name: 'rowboat' }), glow: new THREE.Vector3(1.2, 1.2, 0) };
}

function shadeHex(c: number, k: number): number {
  return new THREE.Color(c).multiplyScalar(k).getHex();
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

/** Rounded scallop (half-disc flap) hanging from `y`, facing +Z. */
function scallop(r: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-r, 0);
  sh.absarc(0, 0, r, Math.PI, 2 * Math.PI, false);
  sh.lineTo(-r, 0);
  const g = new THREE.ShapeGeometry(sh, 10);
  g.rotateZ(Math.PI);
  return g;
}

/**
 * Big striped marquee tent (round, peaked): smooth walls (many segments per stripe), a sagging
 * conical roof between the ribs, a rounded scalloped valance, pennant, tied-back door flaps, guy
 * ropes. Door faces +Z.
 */
export function buildMarquee(rng: Rng, R = 3.6, stripes: [number, number] = [0xd8473a, 0xf6ecd8]): THREE.Group {
  const b = new MeshBuilder();
  const wallH = 2.4;
  const n = 16;
  const seg = 4;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    if (Math.abs(((a0 + Math.PI / n) % (Math.PI * 2)) - Math.PI / 2) < 0.3) continue; // door gap
    const g = new THREE.CylinderGeometry(R, R * 1.02, wallH, seg, 3, true, a0, (Math.PI * 2) / n);
    b.add('cloth', g, mat(0, wallH / 2, 0), { tint: stripes[i % 2]!, aoWorld: groundAO(0.6, 0.7) });
  }
  const roofH = 2.6;
  const Rr = R + 0.3;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const g = new THREE.ConeGeometry(Rr, roofH, seg * 2, 6, true, a0, (Math.PI * 2) / n);
    // Sag the roof panels between the ribs (smoothly, following the canvas).
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      let a = Math.atan2(x, z) - a0;
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const mid = Math.sin(THREE.MathUtils.clamp(a / ((Math.PI * 2) / n), 0, 1) * Math.PI);
      const rr = Math.hypot(x, z);
      pos.setY(k, pos.getY(k) - mid * 0.16 * Math.sin((rr / Rr) * Math.PI));
    }
    g.computeVertexNormals();
    b.add('cloth', g, mat(0, wallH + roofH / 2 - 0.05, 0), { tint: stripes[i % 2]! });
    // Rounded scallops along the eave, two per stripe.
    for (let k = 0; k < 2; k++) {
      const am = a0 + ((k + 0.5) / 2) * ((Math.PI * 2) / n);
      const sr = (Rr * Math.PI) / n / 2;
      b.add('cloth', scallop(sr * 1.02), mat(Math.sin(am) * (Rr - 0.02), wallH - 0.04, Math.cos(am) * (Rr - 0.02), 0.12, am, 0), { tint: stripes[(i + k) % 2]! });
    }
  }
  b.add('cloth', new THREE.TorusGeometry(Rr - 0.02, 0.035, 5, 48), mat(0, wallH - 0.03, 0, Math.PI / 2, 0, 0), { tint: 0xf2d27a });
  b.add('woodGrain', bevelCylinder(0.07, 0.08, wallH + roofH + 0.6, 0.02, 8), mat(0, 0, 0), { tint: 0xa87a50 });
  b.add('metal', new THREE.SphereGeometry(0.12, 10, 8), mat(0, wallH + roofH + 0.62, 0), { tint: 0xd8b060 });
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.quadraticCurveTo(0.5, 0.05, 0.95, -0.22);
  flag.quadraticCurveTo(0.5, -0.3, 0, -0.45);
  flag.closePath();
  b.add('cloth', new THREE.ShapeGeometry(flag, 6), mat(0.05, wallH + roofH + 0.55, 0, 0, -0.4, 0), { tint: 0xf2b928 });
  // Door flaps tied back + guy ropes and pegs.
  for (const s2 of [-1, 1]) {
    const flap = lumpySphere(0.35, 2, 0.08, rng, 2);
    flap.scale(0.4, 3.2, 0.35);
    b.add('cloth', flap, mat(s2 * 0.9, wallH / 2, R - 0.05, 0, 0, s2 * 0.1), { tint: stripes[0] });
    b.add('cloth', new THREE.TorusGeometry(0.12, 0.025, 4, 12), mat(s2 * 0.9, wallH * 0.42, R + 0.02, Math.PI / 2, 0, 0), { tint: 0xf2d27a });
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

/** A string of hanging gourds + dried corn cobs between a and b (world coords, catenary). */
export function buildGourdGarland(rng: Rng, a: THREE.Vector3, bPt: THREE.Vector3, n = 9): THREE.Group {
  const b = new MeshBuilder();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < 16; i++) {
    catenary(a, bPt, 0.22, i / 16, p);
    catenary(a, bPt, 0.22, (i + 1) / 16, q);
    const d = q.clone().sub(p);
    const g = new THREE.CylinderGeometry(0.01, 0.01, d.length(), 3);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    b.add('white', g, mat(p.x, p.y, p.z), { tint: 0x8a6a3a });
  }
  const tints = [0xe8862a, 0xf2c040, 0x8a9a4a, 0xe8d8b0, 0xd8573e];
  for (let i = 1; i <= n; i++) {
    catenary(a, bPt, 0.22, i / (n + 1), p);
    const drop = 0.12 + rng.next() * 0.12;
    b.add('white', new THREE.CylinderGeometry(0.006, 0.006, drop, 3), mat(p.x, p.y - drop / 2, p.z), { tint: 0x6a4a2a });
    if (i % 3 === 0) {
      // Dried corn: a cob with husks flared up.
      b.add('white', new THREE.CapsuleGeometry(0.045, 0.16, 2, 6), mat(p.x, p.y - drop - 0.12, p.z), { tint: [0xd8402a, 0xe8a030, 0x8a3a8a][i % 3]! });
      for (const s2 of [-1, 1]) b.add('white', new THREE.ConeGeometry(0.03, 0.16, 4), mat(p.x + s2 * 0.03, p.y - drop - 0.01, p.z, 0, 0, s2 * 0.4), { tint: 0xe8d8a0 });
    } else {
      const gr = new THREE.SphereGeometry(0.09, 9, 7);
      const pos = gr.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k);
        pos.setY(k, y * (y > 0 ? 1.6 : 1));
        const neck = y > 0.02 ? 1 - 0.45 * (y / 0.09) : 1;
        pos.setX(k, pos.getX(k) * neck);
        pos.setZ(k, pos.getZ(k) * neck);
      }
      gr.computeVertexNormals();
      b.add('white', gr, mat(p.x, p.y - drop - 0.1, p.z, 0, 0, Math.PI), { tint: tints[i % tints.length]! });
    }
  }
  return b.build({ name: 'gourd-garland' });
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
  // Tassel: a golden spray of spikelets.
  b.add('white', new THREE.CylinderGeometry(0.008, 0.012, 0.36, 3), mat(0, h + 0.14, 0), { tint: 0xd8b060 });
  for (let i = 0; i < 5; i++) b.add('white', new THREE.ConeGeometry(0.018, 0.34, 3), mat(Math.cos(i * 1.26) * 0.06, h + 0.2, Math.sin(i * 1.26) * 0.06, Math.cos(i * 1.26) * 0.7, 0, -Math.sin(i * 1.26) * 0.7), { tint: i % 2 ? 0xe8c070 : 0xd8a850 });
  const merged = [...b.geometries().values()][0]!;
  return merged;
}

/** Instanced corn field: `spots` (x, y, z, rot, scale). One draw call (+ swaying shadow). */
export function buildCornField(rng: Rng, spots: [number, number, number, number, number][]): THREE.InstancedMesh {
  const g = cornStalkGeometry(rng, 2.75);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  m.name = 'corn';
  applyWorldFx(m);
  const windOpts = { mode: 'height' as const, height: 2.9, amplitude: 0.22, flutter: 0.5 };
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

let firMat: THREE.MeshStandardMaterial | null = null;
let baubleMat: THREE.MeshStandardMaterial | null = null;
let starMat: THREE.MeshStandardMaterial | null = null;
function festiveMaterials(): { fir: THREE.MeshStandardMaterial; bauble: THREE.MeshStandardMaterial; star: THREE.MeshStandardMaterial } {
  if (!firMat) {
    // Needles: vertex-coloured (trunk AO → lit tips), snow settles on the top faces (world fx).
    firMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
    firMat.name = 'great-fir';
    applyWorldFx(firMat, { snowUp: 0.5 });
    // Glossy glass baubles: saturated, a tight highlight, a soft inner glow under the lamps.
    baubleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.6, envMapIntensity: 1.6 });
    baubleMat.name = 'baubles';
    patchMaterial(baubleMat, 'bauble-glow', (shader) => {
      shader.uniforms.uLamps = globalUniforms.uLamps;
      shader.fragmentShader = before(shader.fragmentShader, 'void main() {', 'uniform float uLamps;');
      shader.fragmentShader = after(shader.fragmentShader, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * 0.35 * uLamps;');
    });
    // The star: gold, emissive capped so bloom keeps its five points.
    starMat = new THREE.MeshStandardMaterial({ color: 0xffd36a, emissive: 0xffb440, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.5 });
    starMat.name = 'star';
  }
  return { fir: firMat, bauble: baubleMat!, star: starMat! };
}

/**
 * The Starfall tree (the Great Fir): eight tiers of drooping, snow-laden bough clusters around a
 * trunk (smooth-shaded, darker toward the trunk, lighter at the tips), a gold bead garland and a
 * red ribbon swag that hug the actual bough surface, glossy glass baubles, fairy lights and the
 * five-point star. Returns bauble / fairy-light / star positions (offsets from the origin).
 */
export function buildStarTree(rng: Rng, H = 11): { group: THREE.Group; lights: THREE.Vector3[]; baubles: { p: THREE.Vector3; c: number }[]; star: THREE.Vector3 } {
  const M = festiveMaterials();
  const b = new MeshBuilder();
  b.add('bark', bevelCylinder(0.32, 0.46, H * 0.6, 0.05, 10), mat(0, 0, 0), { tint: 0x6a4a36 });
  b.add('stone', boxUV(bevelCylinder(1.9, 2.05, 0.5, 0.08, 20), 0.9), mat(0, 0, 0), { tint: 0xc8c0b2, aoWorld: groundAO(0.3) });
  const tiers = 8;
  const base = 1.0;
  type Tier = { y: number; R: number; th: number };
  const tierList: Tier[] = [];
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    tierList.push({ y: base + Math.pow(f, 0.92) * (H - base - 1.9), R: THREE.MathUtils.lerp(3.35, 0.72, f), th: THREE.MathUtils.lerp(1.9, 1.05, f) });
  }
  const needle = [0x2c5e3e, 0x2f6a44, 0x34724a, 0x28573a];
  for (const [ti, tr] of tierList.entries()) {
    const { y, R, th } = tr;
    // Core cone (fills between boughs), drooping hem.
    const core = new THREE.ConeGeometry(R * 0.78, th * 1.15, 18, 2, true);
    core.translate(0, th * 0.575, 0);
    const cp = core.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const rr = Math.hypot(cp.getX(i), cp.getZ(i));
      cp.setY(i, cp.getY(i) - (rr / R) * (rr / R) * 0.35);
    }
    core.computeVertexNormals();
    b.add(M.fir, core, mat(0, y, 0), { tint: 0x234c32, aoWorld: (q) => 0.45 + 0.4 * THREE.MathUtils.clamp(Math.hypot(q.x, q.z) / R, 0, 1) });
    // Boughs: lumpy, outward-pointing, tips drooping, smooth normals.
    const n = Math.round(7 + R * 3.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ti * 0.37 + (rng.next() - 0.5) * 0.2;
      const len = R * (0.62 + rng.next() * 0.1);
      const g = lumpySphere(1, 1, 0.22, rng, 2.2);
      g.scale(len * 0.55, th * 0.3, R * 0.2 + 0.15);
      sphericalNormals(g, new THREE.Vector3(), 0.85);
      const droop = 0.28 + rng.next() * 0.12;
      const m = new THREE.Matrix4().makeTranslation(0, y + th * 0.28, 0).multiply(new THREE.Matrix4().makeRotationY(-a)).multiply(new THREE.Matrix4().makeTranslation(len * 0.62, -len * 0.12, 0)).multiply(new THREE.Matrix4().makeRotationZ(-droop));
      b.add(M.fir, g, m, {
        tint: needle[Math.floor(rng.next() * needle.length)]!,
        aoWorld: (q, nn) => {
          const rad = THREE.MathUtils.clamp(Math.hypot(q.x, q.z) / R, 0, 1.1);
          return (0.42 + 0.62 * THREE.MathUtils.smoothstep(rad, 0.15, 1.0)) * (nn.y < -0.2 ? 0.72 : 1);
        },
      });
    }
  }
  // Surface radius of the canopy at height y (max over tiers), so garlands rest on the boughs.
  const envAt = (yy: number): number => {
    let r = 0.3;
    for (const tr of tierList) {
      const k = (yy - tr.y) / (tr.th * 1.1);
      if (k < -0.15 || k > 1) continue;
      r = Math.max(r, tr.R * 0.92 * (1 - Math.max(0, k) * 0.78));
    }
    return r;
  };
  const lights: THREE.Vector3[] = [];
  const baubles: { p: THREE.Vector3; c: number }[] = [];
  // Garlands: a gold bead string + a red velvet ribbon, spiralling up on the canopy surface.
  const garland = (phase: number, turns: number, y0: number, y1: number, kind: 'beads' | 'ribbon'): void => {
    const pts: THREE.Vector3[] = [];
    const N = 260;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const yy = y0 + u * (y1 - y0);
      const a = u * turns * Math.PI * 2 + phase;
      const r = envAt(yy) * 1.02 + 0.04;
      // Swags: the string dips between the boughs it rests on.
      const dip = Math.abs(Math.sin(u * turns * 14)) * 0.12;
      pts.push(new THREE.Vector3(Math.cos(a) * r, yy - dip, Math.sin(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    if (kind === 'beads') {
      b.add(M.bauble, new THREE.TubeGeometry(curve, 420, 0.025, 4, false), undefined, { tint: 0xd8a830 });
      const L = curve.getLength();
      const nb = Math.floor(L / 0.28);
      for (let i = 0; i < nb; i++) {
        const q = curve.getPointAt(i / nb);
        b.add(M.bauble, new THREE.IcosahedronGeometry(0.065, 1), mat(q.x, q.y, q.z), { tint: i % 5 === 0 ? 0xfff0c0 : 0xf2c040 });
        if (i % 3 === 0) lights.push(q.clone().multiplyScalar(1.03).setY(q.y));
      }
    } else {
      b.add('cloth', new THREE.TubeGeometry(curve, 360, 0.075, 5, false), undefined, { tint: 0xb8222a });
    }
  };
  garland(0, 3.6, base + 0.7, H - 1.8, 'beads');
  garland(Math.PI, 3.2, base + 0.9, H - 2.6, 'ribbon');
  // Baubles: hung at the bough tips (the outer rim of each tier), saturated red / gold / teal.
  const colors = [0xd41e2a, 0xf2b010, 0x1a9a9a, 0xd41e2a, 0xf2b010, 0x2a5ad8, 0xb82a8a];
  for (const [ti, tr] of tierList.entries()) {
    const k = Math.round(4 + tr.R * 3.4);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + ti * 0.9 + rng.next() * 0.3;
      const r = tr.R * (0.9 + rng.next() * 0.08);
      const p = new THREE.Vector3(Math.cos(a) * r, tr.y + tr.th * 0.08 - rng.next() * 0.1, Math.sin(a) * r);
      const c = colors[(i + ti) % colors.length]!;
      const rad = 0.13 + rng.next() * 0.05 + (ti < 3 ? 0.03 : 0);
      b.add(M.bauble, new THREE.SphereGeometry(rad, 12, 9), mat(p.x, p.y, p.z), { tint: c });
      b.add('metal', new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6), mat(p.x, p.y + rad + 0.02, p.z), { tint: 0xd8b060 });
      baubles.push({ p, c });
    }
  }
  // Star: a gold 5-point star (emissive face, darker metal bevel keeps the silhouette under bloom).
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.3 : 0.74;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06, bevelSegments: 2 });
  sg.translate(0, 0, -0.07);
  const starY = H + 0.2;
  b.add(M.star, sg, mat(0, starY, 0), { tint: 0xffffff });
  b.add('metal', bevelCylinder(0.05, 0.08, 0.7, 0.02, 8), mat(0, starY - 0.95, 0), { tint: 0xc8a040 });
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
