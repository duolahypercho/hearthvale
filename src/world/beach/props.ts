/**
 * Driftsand Beach props (procedural, merged per material by MeshBuilder):
 *   pier       plank deck on stringers, barnacled pilings to the sea floor, X-bracing, rope rails on
 *              catenaries, a T-head with bench / crab pots / bait bucket / coiled rope / bollards / ladder
 *   shack      the fisherman's stilt shack: faded-teal board walls, slate shingles, stovepipe, porch,
 *              lit windows, porthole door, hanging buoys + oars, painted "Bait & Tackle" sign, drying net
 *   lighthouse red / white banded tower on a stone plinth, gallery, glazed lamp room, sweeping beam
 *   rowboat    lofted clinker hull (painted outside, wood inside), seats, oars
 *   driftwood  bleached, tapered, bent logs with branch stubs; campfire ring; sand fence; boardwalk
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, roundedBox, bevelCylinder, mat, prep } from '../geom';
import { catenary } from '../props/festival';
import { rockGeometry } from '../props/rocks';
import { type BuiltProp } from '../props/structures';
import { PIER, PIER_FISH_GAP } from './layout';
import { textures } from '../../render/textures';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial } from '../../render/patch';

const _up = new THREE.Vector3(0, 1, 0);

/** Tapered tube along a curve (radius r0 → r1), optional vertex tint gradient. */
export function taperTube(curve: THREE.Curve<THREE.Vector3>, segs: number, r0: number, r1: number, radial = 7, closed = true): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    const r = THREE.MathUtils.lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  if (!closed) return g;
  // Cap both ends with little discs.
  const parts: THREE.BufferGeometry[] = [g.toNonIndexed()];
  for (const [t, r] of [[0, r0], [1, r1]] as const) {
    const at = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const cap = new THREE.CircleGeometry(r, radial);
    cap.lookAt(tan.clone().multiplyScalar(t === 0 ? -1 : 1));
    cap.translate(at.x, at.y, at.z);
    parts.push(cap.toNonIndexed());
  }
  const out = mergeSimple(parts);
  return out;
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of parts) n += g.attributes.position!.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const U = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position!.count;
    P.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, o * 3);
    N.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, o * 3);
    if (g.attributes.uv) U.set((g.attributes.uv as THREE.BufferAttribute).array as Float32Array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return out;
}

/** Cylinder from a to b. */
function beam(r0: number, r1: number, a: THREE.Vector3, b: THREE.Vector3, radial = 7): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

function rope(b: MeshBuilder, a: THREE.Vector3, c: THREE.Vector3, sag: number, r = 0.022, tint = 0xc8a86a, material: THREE.Material | 'cloth' = 'cloth'): void {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) pts.push(catenary(a, c, sag, i / 12));
  const curve = new THREE.CatmullRomCurve3(pts);
  b.add(material, new THREE.TubeGeometry(curve, 14, r, 5, false), undefined, { tint });
}

/**
 * Pier rail rope: the shared cloth look, but it steps aside for farmers. Inside a capsule round each
 * farmer on the deck (`setRailAvoid`, up to 4, x / feet y / z / radius) the rope is dithered out, so a
 * farmer leaning on the rail — or fishing over it — is never sliced through the hips by it.
 */
const railAvoid = [new THREE.Vector4(1e5, 0, 1e5, 0), new THREE.Vector4(1e5, 0, 1e5, 0), new THREE.Vector4(1e5, 0, 1e5, 0), new THREE.Vector4(1e5, 0, 1e5, 0)];
let railMat: THREE.MeshStandardMaterial | null = null;
export function railRopeMaterial(): THREE.MeshStandardMaterial {
  if (railMat) return railMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  m.name = 'railRope';
  applyWorldFx(m);
  patchMaterial(m, 'rail-avoid', (shader) => {
    shader.uniforms.uRailAvoid = { value: railAvoid };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec4 uRailAvoid[4];\nvoid main() {')
      .replace(
        'void main() {',
        /* glsl */ `void main() {
        for (int i = 0; i < 4; i++) {
          vec4 a = uRailAvoid[i];
          float dh = length(vHvWorldPos.xz - a.xz);
          float dy = vHvWorldPos.y - a.y;
          // Soft, dithered edge (screen-door) so the cut never reads as a hard stump.
          float k = smoothstep(a.w, a.w * 0.72, dh) * step(-0.1, dy) * step(dy, 1.9);
          float dith = fract(dot(floor(gl_FragCoord.xy), vec2(0.5, 0.25)) + 0.125);
          if (k > dith) discard;
        }`,
      );
  });
  railMat = m;
  return m;
}

/** Farmers the pier rail rope makes way for this frame (world feet positions; radius in m). */
export function setRailAvoid(pts: { x: number; y: number; z: number }[], radius = 0.62): void {
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    if (p) railAvoid[i]!.set(p.x, p.y, p.z, radius);
    else railAvoid[i]!.set(1e5, 0, 1e5, 0);
  }
}

/** Barnacles + weed darken pilings from just above the water down. */
/** A nail head: one flat 6-sided disc (4 tris) on the plank top. */
const NAIL = new THREE.CircleGeometry(0.013, 6).rotateX(-Math.PI / 2);

const pilingAO = (p: THREE.Vector3): number => (p.y < 0.35 ? 0.42 + 0.2 * THREE.MathUtils.smoothstep(p.y, -1.5, 0.35) : 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, 0.35, 1.2));

// ───────────────────────────────────────────── pier

/**
 * Beach lantern: the shared lantern shape, but glazed with 'glass' (dark, sky-reflecting panes by
 * day that warm up at dusk) — cream 'lampGlow' panes read as lamps left burning at noon.
 */
function lantern(b: MeshBuilder, x: number, y: number, z: number, s = 1): void {
  b.add('metal', roundedBox(0.2 * s, 0.05 * s, 0.2 * s, 0.015), mat(x, y + 0.14 * s, z));
  b.add('metal', new THREE.ConeGeometry(0.15 * s, 0.1 * s, 4), mat(x, y + 0.21 * s, z, 0, Math.PI / 4, 0));
  b.add('glass', roundedBox(0.13 * s, 0.2 * s, 0.13 * s, 0.02), mat(x, y + 0.02 * s, z));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.add('metal', new THREE.BoxGeometry(0.02 * s, 0.24 * s, 0.02 * s), mat(x + dx * 0.075 * s, y + 0.02 * s, z + dz * 0.075 * s));
  }
  b.add('metal', roundedBox(0.18 * s, 0.035 * s, 0.18 * s, 0.01), mat(x, y - 0.1 * s, z));
}

/**
 * The pier in world coordinates (deck top at PIER.deckY). `groundAt` gives the sea floor / sand
 * height for pilings.
 */
export function buildPier(rng: Rng, groundAt: (x: number, z: number) => number): { static: THREE.Group; lamps: THREE.Vector3[]; pilings: { x: number; z: number; r: number }[] } {
  const b = new MeshBuilder();
  const deck = PIER.deckY;
  const hw = PIER.w / 2;
  const cx = PIER.x;
  const wood = pierWoodMaterial();
  const plank = (x0: number, x1: number, z: number, w = 0.26): void => {
    const len = x1 - x0;
    const warp = (rng.next() - 0.5) * 0.02;
    // ±6 % value / slight hue jitter per plank; ~12 % sun-and-salt weathered grey boards.
    const v = 0.94 + rng.next() * 0.12;
    const grey = rng.next() < 0.12;
    const tint = new THREE.Color(grey ? 0xb4aca0 : 0xd6b48c).offsetHSL((rng.next() - 0.5) * 0.02, 0, 0).multiplyScalar(v);
    const g = roundedBox(len, 0.07, w, 0.018);
    // Fine grain: map U across the board (≈ 5 cm per ring), V along it, a random offset per plank.
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ou = rng.next() * 10;
    const ov = rng.next() * 10;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, ou + pos.getZ(i) / 0.5, ov + pos.getX(i) / 1.6);
    b.add(wood, g, mat((x0 + x1) / 2 + (rng.next() - 0.5) * 0.04, deck - 0.035 + warp, z, warp, (rng.next() - 0.5) * 0.02, 0), {
      tint,
      aoWorld: (p) => 0.8 + 0.2 * THREE.MathUtils.clamp((p.y - deck + 0.07) / 0.07, 0, 1),
    });
    // Two nail heads at each end.
    for (const nx of [x0 + 0.1, x1 - 0.1]) for (const dz of [-0.07, 0.07]) b.add('metal', NAIL.clone(), mat(nx + (rng.next() - 0.5) * 0.02, deck + 0.002, z + dz), { tint: 0x4a3c34 });
  };
  // Main walkway.
  for (let z = PIER.z0 + 0.15; z < PIER.head.z0; z += 0.3) plank(cx - hw, cx + hw, z);
  // Head platform.
  const H = PIER.head;
  for (let z = H.z0 + 0.15; z < H.z1; z += 0.3) plank(H.x0, H.x1, z);
  // Dark underlay: the gaps between boards read as deep shadow lines (AO), not see-through slits.
  b.add('woodDark', new THREE.BoxGeometry(PIER.w - 0.1, 0.02, H.z0 - PIER.z0), mat(cx, deck - 0.085, (PIER.z0 + H.z0) / 2), { tint: 0x2a1c12 });
  b.add('woodDark', new THREE.BoxGeometry(H.x1 - H.x0 - 0.1, 0.02, H.z1 - H.z0), mat((H.x0 + H.x1) / 2, deck - 0.085, (H.z0 + H.z1) / 2), { tint: 0x2a1c12 });
  // Stringers.
  for (const sx of [-hw + 0.2, 0, hw - 0.2]) {
    b.add('woodDark', roundedBox(0.14, 0.2, H.z0 - PIER.z0, 0.03), mat(cx + sx, deck - 0.17, (PIER.z0 + H.z0) / 2));
  }
  for (const sz of [H.z0 + 0.3, (H.z0 + H.z1) / 2, H.z1 - 0.3]) b.add('woodDark', roundedBox(H.x1 - H.x0, 0.2, 0.14, 0.03), mat((H.x0 + H.x1) / 2, deck - 0.17, sz));
  // Edge beams (the side fascia).
  for (const sx of [-hw, hw]) b.add('woodDark', roundedBox(0.1, 0.22, H.z0 - PIER.z0, 0.02), mat(cx + sx, deck - 0.12, (PIER.z0 + H.z0) / 2), { tint: 0xa89078 });
  // Pilings + posts (posts stick up as railing posts).
  const posts: THREE.Vector3[][] = [[], []];
  const pilings: { x: number; z: number; r: number }[] = [];
  const piling = (x: number, z: number, up: number): void => {
    const g = groundAt(x, z) - 0.4;
    const r = 0.15 + rng.next() * 0.03;
    if (g < -0.35) pilings.push({ x, z, r });
    b.add('woodDark', new THREE.CylinderGeometry(r * 0.94, r, deck + up - g, 9, 2), mat(x, (deck + up + g) / 2, z, 0, rng.next() * 6, (rng.next() - 0.5) * 0.02), { aoWorld: pilingAO, tint: 0xb09a86 });
    // Rope wrap near the top + barnacle rings at the tide line.
    if (up > 0.2) b.add('cloth', new THREE.TorusGeometry(r + 0.01, 0.025, 5, 12), mat(x, deck + up - 0.12, z, Math.PI / 2), { tint: 0xc8a86a });
    b.add('stone', new THREE.TorusGeometry(r + 0.015, 0.035, 5, 12), mat(x, 0.05 + rng.next() * 0.1, z, Math.PI / 2), { tint: 0x8a8a7a });
  };
  const span = 2.6;
  for (let z = PIER.z0 + 0.3; z <= H.z0 + 0.01; z += span) {
    for (const [k, sx] of [[0, -hw - 0.02], [1, hw + 0.02]] as const) {
      piling(cx + sx, z, 0.95);
      posts[k]!.push(new THREE.Vector3(cx + sx, deck + 0.85, z));
    }
  }
  // Bracing under the walkway: every brace runs piling-to-piling (ends on the pile centrelines, so
  // they emerge from the timber) and stays above the swell — nothing hangs in the water where the
  // sea's depth tint can't reach it. Side trusses zig-zag span to span; a sway brace crosses under
  // the deck at every other bent.
  const braceLow = (x: number, z: number): number => Math.max(0.46, groundAt(x, z) + 0.28);
  let flip = false;
  for (let z = PIER.z0 + 0.3; z + span <= H.z0 + 0.01; z += span) {
    flip = !flip;
    for (const sx of [-hw - 0.02, hw + 0.02]) {
      const za = flip ? z : z + span;
      const zb = flip ? z + span : z;
      const lo = braceLow(cx + sx, zb);
      if (lo > deck - 0.6) continue;
      b.add('woodDark', beam(0.055, 0.055, new THREE.Vector3(cx + sx, deck - 0.27, za), new THREE.Vector3(cx + sx, lo, zb), 5), undefined, { aoWorld: pilingAO, tint: 0xa89078 });
    }
    if (flip) {
      const lo = braceLow(cx + hw, z);
      if (lo < deck - 0.6) b.add('woodDark', beam(0.05, 0.05, new THREE.Vector3(cx - hw - 0.02, deck - 0.27, z), new THREE.Vector3(cx + hw + 0.02, lo, z), 5), undefined, { aoWorld: pilingAO, tint: 0xa89078 });
    }
  }
  // Head pilings + posts around the T.
  const headPosts: THREE.Vector3[] = [];
  const perim: [number, number][] = [
    [H.x0, H.z0], [H.x0, (H.z0 + H.z1) / 2], [H.x0, H.z1], [(H.x0 + cx - hw) / 2, H.z1], [cx, H.z1], [(H.x1 + cx + hw) / 2, H.z1], [H.x1, H.z1], [H.x1, (H.z0 + H.z1) / 2], [H.x1, H.z0],
  ];
  for (const [x, z] of perim) {
    piling(x, z, 0.95);
    headPosts.push(new THREE.Vector3(x, deck + 0.85, z));
  }
  // Rope rails (their own material: the rope makes way for farmers standing at it, see railRopeMaterial).
  const railM = railRopeMaterial();
  for (const [k, side] of posts.entries()) {
    for (let i = 0; i < side.length - 1; i++) {
      const a = side[i]!;
      const c = side[i + 1]!;
      // The walkway fishing spot (west side, z ≈ 50.6-53.2): the rail is unhooked and hung back on its
      // posts, a toe board along the deck edge — an open gap to cast from.
      if (k === 0 && a.z < PIER_FISH_GAP.z1 && c.z > PIER_FISH_GAP.z0) {
        for (const [p, dir] of [[a, 1], [c, -1]] as const) {
          rope(b, p.clone().setY(p.y - 0.05), new THREE.Vector3(p.x - 0.03, p.y - 0.42, p.z + dir * 0.2), 0.08, 0.022, 0xc8a86a, railM);
          b.add('metal', new THREE.TorusGeometry(0.035, 0.01, 4, 8), mat(p.x - 0.1, p.y - 0.46, p.z + dir * 0.2, 0, Math.PI / 2, 0), { tint: 0xb08a3a });
        }
        b.add('woodDark', roundedBox(0.07, 0.1, c.z - a.z - 0.3, 0.02), mat(a.x + 0.06, deck + 0.05, (a.z + c.z) / 2), { tint: 0xb89878 });
        continue;
      }
      rope(b, a, c, 0.18, 0.022, 0xc8a86a, railM);
    }
  }
  // Head rail: west edge → south → east edge, leaving the walkway joints open.
  for (let i = 0; i < headPosts.length - 1; i++) rope(b, headPosts[i]!, headPosts[i + 1]!, 0.16, 0.022, 0xc8a86a, railM);
  // Bollards + a coiled rope.
  for (const [x, z] of [[H.x0 + 0.5, H.z1 - 0.45], [H.x1 - 0.5, H.z1 - 0.45], [cx - hw + 0.3, PIER.z0 + 8]] as const) {
    b.add('metal', bevelCylinder(0.1, 0.13, 0.28, 0.03, 10), mat(x, deck, z), { tint: 0x3a3a3e });
    b.add('metal', new THREE.SphereGeometry(0.13, 10, 6), mat(x, deck + 0.3, z, 0, 0, 0, 1, 0.5, 1), { tint: 0x3a3a3e });
  }
  for (let i = 0; i < 4; i++) b.add('cloth', new THREE.TorusGeometry(0.22 - i * 0.03, 0.03, 5, 16), mat(H.x1 - 1.2, deck + 0.03 + i * 0.045, H.z0 + 0.9, Math.PI / 2), { tint: 0xc8a86a });
  // Ladder down into the water on the east side of the head.
  const lx = H.x1 + 0.12;
  const lz = H.z1 - 1.6;
  for (const dz of [-0.28, 0.28]) b.add('woodDark', roundedBox(0.06, 2.4, 0.06, 0.02), mat(lx, deck - 1.0, lz + dz), { aoWorld: pilingAO });
  for (let y = deck - 0.1; y > -1.0; y -= 0.34) b.add('woodDark', roundedBox(0.05, 0.05, 0.56, 0.01), mat(lx, y, lz), { aoWorld: pilingAO });
  // Bench (back to the sea), crab pots, bait bucket, tackle box, rod rack.
  const bx = cx - 1.9;
  const bz = H.z1 - 0.7;
  for (const dx of [-0.7, 0.7]) b.add('woodDark', roundedBox(0.08, 0.42, 0.34, 0.02), mat(bx + dx, deck + 0.21, bz));
  b.add('woodGrain', roundedBox(1.7, 0.07, 0.42, 0.02), mat(bx, deck + 0.45, bz), { tint: 0xd8b890 });
  b.add('woodGrain', roundedBox(1.7, 0.3, 0.06, 0.02), mat(bx, deck + 0.72, bz + 0.2, -0.15), { tint: 0xd8b890 });
  const pot = (x: number, y: number, z: number, rot: number): void => {
    const w = 0.62;
    const h = 0.38;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      b.add('metal', new THREE.CylinderGeometry(0.012, 0.012, h, 4), mat(x + (dx * w * Math.cos(rot)) / 2 - (dz * w * 0.8 * Math.sin(rot)) / 2, y + h / 2, z + (dx * w * Math.sin(rot)) / 2 + (dz * w * 0.8 * Math.cos(rot)) / 2), { tint: 0x5a6a6a });
    }
    // Netting panels (tinted cloth boxes, thin) + a blue rope handle.
    b.add('cloth', roundedBox(w, h, w * 0.8, 0.04), mat(x, y + h / 2, z, 0, rot, 0), { tint: 0x7a8a78 });
    b.add('cloth', new THREE.TorusGeometry(0.12, 0.015, 4, 10, Math.PI), mat(x, y + h, z, 0, rot, 0), { tint: 0x3f7ab0 });
  };
  pot(H.x1 - 0.9, deck, H.z0 + 0.6, 0.2);
  pot(H.x1 - 0.95, deck + 0.38, H.z0 + 0.62, -0.1);
  pot(H.x1 - 1.6, deck, H.z0 + 0.5, 0.5);
  // Bait bucket (+ water inside) and tackle box.
  b.add('metal', bevelCylinder(0.2, 0.17, 0.36, 0.02, 12), mat(cx + 1.0, deck, H.z1 - 0.6), { tint: 0x8aa0b0 });
  b.add('stillWater', new THREE.CircleGeometry(0.18, 12), mat(cx + 1.0, deck + 0.31, H.z1 - 0.6, -Math.PI / 2));
  b.add('metal', new THREE.TorusGeometry(0.2, 0.01, 4, 12, Math.PI), mat(cx + 1.0, deck + 0.36, H.z1 - 0.6, 0, 0.4, 0), { tint: 0x5a5a5a });
  b.add('woodPaint', roundedBox(0.5, 0.24, 0.3, 0.03), mat(cx + 1.6, deck + 0.12, H.z1 - 0.55, 0, 0.3, 0), { tint: 0x3f8a5a });
  b.add('metal', roundedBox(0.2, 0.04, 0.05, 0.01), mat(cx + 1.6, deck + 0.26, H.z1 - 0.55, 0, 0.3, 0), { tint: 0xd8a84a });
  // The walkway fishing spot (east half, z ≈ 51-53): an angler's kit — folding stool, tackle box
  // with its lid up, bait bucket with a tail sticking out, a coil of rope and a deck lantern.
  {
    const ex = cx + 0.85;
    const ez = 52.2;
    // Stool: canvas seat on crossed legs.
    for (const s of [-1, 1]) b.add('woodDark', beam(0.022, 0.022, new THREE.Vector3(ex - 0.16 * s, deck, ez - 0.14), new THREE.Vector3(ex + 0.16 * s, deck + 0.38, ez + 0.14), 5));
    for (const s of [-1, 1]) b.add('woodDark', beam(0.022, 0.022, new THREE.Vector3(ex - 0.16 * s, deck, ez + 0.14), new THREE.Vector3(ex + 0.16 * s, deck + 0.38, ez - 0.14), 5));
    b.add('cloth', roundedBox(0.4, 0.04, 0.34, 0.015), mat(ex, deck + 0.4, ez), { tint: 0x3f6a8a });
    // Tackle box (green, lid propped open, trays inside).
    const tx = ex + 0.1;
    const tz = ez - 0.75;
    b.add('woodPaint', roundedBox(0.5, 0.22, 0.28, 0.03), mat(tx, deck + 0.11, tz, 0, 0.25, 0), { tint: 0x3f8a5a });
    b.add('woodPaint', roundedBox(0.5, 0.04, 0.28, 0.015), mat(tx - Math.sin(0.25) * 0.14, deck + 0.3, tz - Math.cos(0.25) * 0.14 - 0.06, -1.1, 0.25, 0), { tint: 0x3f8a5a });
    for (const [dx, c] of [[-0.14, 0xe8483a], [0, 0xf5c542], [0.14, 0x4e9ee0]] as const) b.add('woodPaint', new THREE.BoxGeometry(0.1, 0.03, 0.08), mat(tx + dx, deck + 0.23, tz + 0.02, 0, 0.25, 0), { tint: c });
    b.add('metal', roundedBox(0.16, 0.03, 0.04, 0.01), mat(tx, deck + 0.24, tz + 0.12, 0, 0.25, 0), { tint: 0xd8a84a });
    // Bait bucket + a fish tail peeking out.
    const bx = ex - 0.05;
    const bz = ez + 0.72;
    b.add('woodPaint', bevelCylinder(0.19, 0.16, 0.34, 0.02, 12), mat(bx, deck, bz), { tint: 0xb8c6cc });
    b.add('stillWater', new THREE.CircleGeometry(0.17, 12), mat(bx, deck + 0.3, bz, -Math.PI / 2));
    b.add('metal', new THREE.TorusGeometry(0.19, 0.01, 4, 12, Math.PI), mat(bx, deck + 0.34, bz, 0, 0.9, 0), { tint: 0x5a5a5a });
    b.add('woodPaint', new THREE.ConeGeometry(0.06, 0.14, 4).scale(1, 1, 0.3), mat(bx + 0.05, deck + 0.38, bz - 0.03, 0.4, 0.3, 0.2), { tint: 0x8aa6b8 });
    // Rope coil.
    for (let i = 0; i < 3; i++) b.add('cloth', new THREE.TorusGeometry(0.2 - i * 0.035, 0.028, 5, 14), mat(ex + 0.45, deck + 0.03 + i * 0.045, ez + 0.2, Math.PI / 2), { tint: 0xc8a86a });
    // Deck lantern (glass lit at night).
    lantern(b, ex + 0.5, deck + 0.08, ez - 0.35, 0.7);
  }
  // A spare rod leaning on the far (east) rail by the crab pots, well away from the fishing spot.
  b.add('woodGrain', beam(0.02, 0.008, new THREE.Vector3(H.x1 - 0.45, deck, H.z0 + 1.6), new THREE.Vector3(H.x1 + 0.1, deck + 2.1, H.z0 + 2.3), 5), undefined, { tint: 0xa88a50 });
  // Lamp posts at the root, middle and head.
  const lamps: THREE.Vector3[] = [];
  for (const [x, z] of [[cx + hw + 0.02, PIER.z0 + 0.3 + span * 2], [cx - hw - 0.02, PIER.z0 + 0.3 + span * 6], [H.x1, H.z1]] as const) {
    b.add('woodDark', roundedBox(0.12, 1.25, 0.12, 0.03), mat(x, deck + 1.35, z));
    b.add('woodDark', roundedBox(0.5, 0.08, 0.08, 0.02), mat(x + (x > cx ? -0.2 : 0.2), deck + 1.95, z));
    lantern(b, x + (x > cx ? -0.4 : 0.4), deck + 1.62, z, 1.1);
    lamps.push(new THREE.Vector3(x + (x > cx ? -0.4 : 0.4), deck + 1.62, z));
  }
  const g = b.build({ name: 'pier' });
  return { static: g, lamps, pilings };
}

/**
 * Pier deck boards: the shared wood-grain texture at 40 % less ring contrast (blended towards its
 * own mean colour), sampled with the fine per-plank UVs set in buildPier.
 */
let pierWood: THREE.MeshStandardMaterial | null = null;
function pierWoodMaterial(): THREE.MeshStandardMaterial {
  if (pierWood) return pierWood;
  const t = textures.woodGrain();
  const m = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 0.9, roughness: 0.82, vertexColors: true });
  m.name = 'pierWood';
  patchMaterial(m, 'pier-wood', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        vec3 meanC = vec3(0.3, 0.15, 0.06);
        sampledDiffuseColor.rgb = mix(meanC, sampledDiffuseColor.rgb, 0.6);
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
  });
  applyWorldFx(m);
  pierWood = m;
  return m;
}

// ───────────────────────────────────────────── shack

let signTex: THREE.CanvasTexture | null = null;
function signMaterial(): THREE.MeshStandardMaterial {
  if (!signTex) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#f2e6cc');
    grad.addColorStop(1, '#d8c4a0');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 128);
    g.globalAlpha = 0.18;
    for (let y = 6; y < 128; y += 9) {
      g.fillStyle = '#8a6a4a';
      g.fillRect(0, y + Math.sin(y) * 2, 512, 1.5);
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#2f5f6a';
    g.lineWidth = 8;
    g.strokeRect(8, 8, 496, 112);
    g.fillStyle = '#2f5f6a';
    g.font = 'bold 60px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BAIT  &  TACKLE', 256, 58);
    // little fish flourish
    g.fillStyle = '#c8483a';
    g.beginPath();
    g.ellipse(58, 64, 22, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(78, 64);
    g.lineTo(94, 52);
    g.lineTo(94, 76);
    g.fill();
    g.beginPath();
    g.ellipse(454, 64, 22, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(434, 64);
    g.lineTo(418, 52);
    g.lineTo(418, 76);
    g.fill();
    signTex = new THREE.CanvasTexture(c);
    signTex.colorSpace = THREE.SRGBColorSpace;
    signTex.anisotropy = 4;
  }
  const m = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 });
  m.name = 'shackSign';
  return m;
}

let netTex: THREE.CanvasTexture | null = null;
let dryNet: THREE.MeshStandardMaterial | null = null;
/**
 * Coarse net for nets draped on the sand (racks, pots): thick twine (≈ half the texel area), so the
 * mip-averaged alpha stays above the cut-off and the net still reads as a net from the gameplay camera.
 */
export function dryingNetMaterial(): THREE.MeshStandardMaterial {
  if (!dryNet) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 9;
    for (let i = -128; i <= 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 128, 128);
      g.stroke();
      g.beginPath();
      g.moveTo(i + 128, 0);
      g.lineTo(i, 128);
      g.stroke();
    }
    // Knots where the twine crosses.
    g.fillStyle = '#ffffff';
    for (let y = 0; y <= 128; y += 32) for (let x = 0; x <= 128; x += 32) for (const o of [0, 16]) {
      g.beginPath();
      g.arc(x + o, y + o, 6, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(9, 6);
    dryNet = new THREE.MeshStandardMaterial({ color: 0xcfc3a0, alphaMap: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.95 });
    dryNet.name = 'dryingNet';
    applyWorldFx(dryNet);
  }
  return dryNet;
}

function netMaterial(): THREE.MeshStandardMaterial {
  if (!netTex) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#d8cca8';
    g.lineWidth = 3;
    for (let i = -256; i < 512; i += 22) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 256, 256);
      g.stroke();
      g.beginPath();
      g.moveTo(i + 256, 0);
      g.lineTo(i, 256);
      g.stroke();
    }
    netTex = new THREE.CanvasTexture(c);
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(3, 2);
    netTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.MeshStandardMaterial({ map: netTex, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, roughness: 0.95 });
  m.alphaMap = netTex;
  m.name = 'net';
  return m;
}

/** Fisherman's shack, local frame: front (door, porch) faces +Z; floor at y = 0.55. */
export function buildShack(rng: Rng): BuiltProp {
  const b = new MeshBuilder();
  const W = 5.4;
  const D = 4.2;
  const F = 0.55; // floor height (stilts)
  const WH = 2.5; // wall height
  const porch = 1.7;
  const paint = [0x6fa8a8, 0x78b0ae, 0x6aa0a4, 0x82b4b0, 0x9ab8b0];
  // Stilts.
  for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2, D / 2 + porch - 0.15]) b.add('woodDark', new THREE.CylinderGeometry(0.1, 0.12, F + 0.5, 8), mat(x, (F - 0.5) / 2, z), { aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, -0.2, 0.4) });
  // Floor + porch decking.
  b.add('woodDark', roundedBox(W + 0.2, 0.16, D + 0.2, 0.03), mat(0, F - 0.08, 0));
  for (let x = -W / 2 + 0.1; x < W / 2; x += 0.3) b.add('woodGrain', roundedBox(0.27, 0.06, porch, 0.015), mat(x + 0.13, F - 0.03, D / 2 + porch / 2), { tint: new THREE.Color(0xd6b48c).multiplyScalar(0.85 + rng.next() * 0.2) });
  // Steps down from the porch.
  for (let i = 0; i < 3; i++) b.add('woodGrain', roundedBox(1.2, 0.07, 0.3, 0.015), mat(-W / 2 + 1.0, F - 0.2 - i * 0.18, D / 2 + porch + 0.18 + i * 0.28), { tint: 0xcaa880 });
  // Board-and-batten walls.
  const board = (x: number, z: number, h: number, ry: number, y0 = F): void => {
    const c = new THREE.Color(paint[Math.floor(rng.next() * paint.length)]!).multiplyScalar(0.9 + rng.next() * 0.15);
    // Weathering: some boards lose paint towards the bottom.
    // (Plain boxes: 12 tris vs 108 for a 1 cm bevel nobody sees at gameplay zoom.)
    b.add('woodPaint', new THREE.BoxGeometry(0.21, h, 0.06), mat(x, y0 + h / 2, z, 0, ry, 0), {
      tint: c,
      aoWorld: (p) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(p.y, y0, y0 + 0.9),
    });
  };
  for (let x = -W / 2 + 0.1; x <= W / 2 - 0.05; x += 0.2) {
    board(x, D / 2, WH, 0);
    board(x, -D / 2, WH, 0);
  }
  // Gable walls: boards grow taller towards the ridge.
  for (let z = -D / 2 + 0.1; z <= D / 2 - 0.05; z += 0.2) {
    const h = WH + (1 - Math.abs(z) / (D / 2)) * 1.25;
    board(-W / 2, z, h, Math.PI / 2);
    board(W / 2, z, h, Math.PI / 2);
  }
  // Corner trims + band.
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]] as const) b.add('woodPaint', roundedBox(0.14, WH, 0.14, 0.02), mat(x, F + WH / 2, z), { tint: 0xf2eee4 });
  b.add('woodPaint', roundedBox(W + 0.16, 0.1, 0.1, 0.02), mat(0, F + WH - 0.05, D / 2 + 0.04), { tint: 0xf2eee4 });
  b.add('woodPaint', roundedBox(W + 0.16, 0.1, 0.1, 0.02), mat(0, F + WH - 0.05, -D / 2 - 0.04), { tint: 0xf2eee4 });
  // Roof: two slabs of slate shingles, fascia, ridge cap.
  const rise = 1.3;
  const half = D / 2 + 0.45;
  const slope = Math.atan2(rise, D / 2);
  const len = Math.hypot(half, rise * (half / (D / 2)));
  for (const s of [-1, 1]) {
    b.add('roofTile', roundedBox(W + 0.7, 0.14, len, 0.04), mat(0, F + WH + rise / 2 + 0.02, (s * len) / 2 * Math.cos(slope) * 0.98, s * slope, 0, 0), {
      tint: 0x5f7488,
      aoWorld: (p) => 0.75 + 0.25 * THREE.MathUtils.smoothstep(p.y, F + WH, F + WH + rise),
    });
  }
  b.add('woodPaint', roundedBox(W + 0.8, 0.14, 0.2, 0.03), mat(0, F + WH + rise + 0.1, 0), { tint: 0x46566a });
  // Stovepipe.
  b.add('metal', new THREE.CylinderGeometry(0.11, 0.11, 1.3, 10), mat(W / 2 - 1.0, F + WH + rise + 0.3, -0.6), { tint: 0x4a4a4e });
  b.add('metal', new THREE.ConeGeometry(0.22, 0.2, 10), mat(W / 2 - 1.0, F + WH + rise + 1.05, -0.6), { tint: 0x3a3a3e });
  // Door (planked, with a round porthole) on the front, left of centre.
  const dx = -W / 2 + 1.0;
  b.add('woodPaint', roundedBox(0.95, 1.95, 0.08, 0.03), mat(dx, F + 0.98, D / 2 + 0.06), { tint: 0xc8583a });
  for (const px of [-0.25, 0, 0.25]) b.add('woodPaint', roundedBox(0.03, 1.8, 0.02, 0.005), mat(dx + px, F + 0.98, D / 2 + 0.11), { tint: 0x8a3a24 });
  b.add('metal', new THREE.TorusGeometry(0.17, 0.035, 6, 16), mat(dx, F + 1.45, D / 2 + 0.12), { tint: 0xd8a84a });
  b.add('glass', new THREE.CircleGeometry(0.15, 14), mat(dx, F + 1.45, D / 2 + 0.115));
  b.add('metal', new THREE.SphereGeometry(0.04, 6, 4), mat(dx + 0.35, F + 0.95, D / 2 + 0.13), { tint: 0xd8a84a });
  b.add('woodPaint', roundedBox(1.15, 0.12, 0.12, 0.03), mat(dx, F + 2.02, D / 2 + 0.08), { tint: 0xf2eee4 });
  // Windows (lit interior) with white frames + little boxes of sea thrift.
  const win = (x: number, z: number, ry: number): void => {
    const o = new THREE.Matrix4().compose(new THREE.Vector3(x, F + 1.35, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    const sub = new MeshBuilder();
    sub.add('windowCard', new THREE.PlaneGeometry(0.8, 0.8), mat(0, 0, 0.05));
    sub.add('woodPaint', roundedBox(1.0, 0.1, 0.1, 0.02), mat(0, 0.45, 0.06), { tint: 0xf2eee4 });
    sub.add('woodPaint', roundedBox(1.05, 0.1, 0.18, 0.02), mat(0, -0.45, 0.08), { tint: 0xf2eee4 });
    for (const sx of [-0.45, 0.45]) sub.add('woodPaint', roundedBox(0.1, 0.9, 0.1, 0.02), mat(sx, 0, 0.06), { tint: 0xf2eee4 });
    sub.add('woodPaint', roundedBox(0.05, 0.8, 0.05, 0.01), mat(0, 0, 0.07), { tint: 0xf2eee4 });
    sub.add('woodPaint', roundedBox(0.8, 0.05, 0.05, 0.01), mat(0, 0, 0.07), { tint: 0xf2eee4 });
    // Shutters.
    for (const sx of [-0.72, 0.72]) sub.add('woodPaint', roundedBox(0.42, 0.9, 0.05, 0.02), mat(sx, 0, 0.07), { tint: 0x3f6a8a });
    sub.add('woodDark', roundedBox(0.9, 0.18, 0.22, 0.02), mat(0, -0.6, 0.15));
    for (let i = 0; i < 6; i++) sub.add('boxFlower', new THREE.IcosahedronGeometry(0.09, 0), mat(-0.35 + i * 0.14, -0.47, 0.15), { tint: i % 2 ? 0xf29ac0 : 0xe86a9a });
    b.addBuilder(sub, o);
  };
  win(W / 2 - 1.5, D / 2 + 0.03, 0);
  win(W / 2 + 0.03, 0.2, Math.PI / 2);
  win(-W / 2 - 0.03, -0.3, -Math.PI / 2);
  // Porch railing + posts + awning posts.
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) b.add('woodPaint', roundedBox(0.12, 1.1, 0.12, 0.02), mat(x, F + 0.55, D / 2 + porch - 0.1), { tint: 0xf2eee4 });
  b.add('woodPaint', roundedBox(W - 2.0, 0.08, 0.08, 0.02), mat(0.9, F + 0.95, D / 2 + porch - 0.1), { tint: 0xf2eee4 });
  for (let x = -W / 2 + 2.1; x < W / 2 - 0.1; x += 0.3) b.add('woodPaint', roundedBox(0.05, 0.9, 0.05, 0.01), mat(x, F + 0.47, D / 2 + porch - 0.1), { tint: 0xf2eee4 });
  // Buoys hanging on the front wall + crossed oars.
  const buoyCols = [0xe8483a, 0xf5c542, 0xf2f0ea, 0xe8483a, 0x3f86d6];
  for (let i = 0; i < 4; i++) {
    const x = -0.1 + i * 0.4;
    const y = F + 1.95 - (i % 2) * 0.22;
    b.add('cloth', new THREE.CylinderGeometry(0.008, 0.008, F + 2.3 - y, 3), mat(x, (F + 2.3 + y) / 2, D / 2 + 0.2), { tint: 0xc8a86a });
    b.add('woodPaint', new THREE.SphereGeometry(0.15, 12, 8), mat(x, y - 0.1, D / 2 + 0.2, 0, 0, 0, 1, 1.3, 1), { tint: buoyCols[i]! });
    b.add('woodPaint', new THREE.TorusGeometry(0.15, 0.025, 5, 12), mat(x, y - 0.1, D / 2 + 0.2, Math.PI / 2), { tint: 0xf2f0ea });
  }
  for (const s of [-1, 1]) {
    b.add('woodGrain', beam(0.03, 0.03, new THREE.Vector3(W / 2 - 0.5 + s * 0.35, F + 0.1, D / 2 + 0.2), new THREE.Vector3(W / 2 - 0.5 - s * 0.35, F + 2.0, D / 2 + 0.22), 6), undefined, { tint: 0xd8b890 });
    b.add('woodPaint', roundedBox(0.18, 0.5, 0.03, 0.01), mat(W / 2 - 0.5 - s * 0.38, F + 2.05, D / 2 + 0.23, 0, 0, s * 0.35), { tint: 0xe8483a });
  }
  // Porch clutter: bench, barrel, crates, rope coil, lantern hook.
  b.add('woodDark', roundedBox(1.3, 0.08, 0.4, 0.02), mat(W / 2 - 1.2, F + 0.45, D / 2 + 0.4));
  for (const x of [-0.5, 0.5]) b.add('woodDark', roundedBox(0.08, 0.42, 0.36, 0.02), mat(W / 2 - 1.2 + x, F + 0.21, D / 2 + 0.4));
  lantern(b, dx + 0.7, F + 2.05, D / 2 + 0.28, 0.9);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), signMaterial());
  sign.position.set(0.35, F + WH + 0.42, D / 2 + 0.16);
  sign.castShadow = true;
  const signBoard = new MeshBuilder();
  signBoard.add('woodDark', roundedBox(2.55, 0.72, 0.08, 0.03), mat(0.35, F + WH + 0.42, D / 2 + 0.1));
  b.addBuilder(signBoard, new THREE.Matrix4());
  // Net drying on the east gable on two poles.
  const net = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6, 8, 4), netMaterial());
  const np = net.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < np.count; i++) {
    const x = np.getX(i);
    const y = np.getY(i);
    np.setZ(i, Math.sin((x + 1.3) * 2.2) * 0.08 + (0.8 - y) * 0.05);
    np.setY(i, y - Math.cos((x / 1.3) * Math.PI * 0.5) * 0.25 * (1 - (y + 0.8) / 1.6));
  }
  net.geometry.computeVertexNormals();
  net.position.set(W / 2 + 0.7, F + 1.3, -0.2);
  net.rotation.y = Math.PI / 2;
  net.castShadow = true;
  for (const z of [-1.5, 1.1]) b.add('woodDark', new THREE.CylinderGeometry(0.05, 0.06, 2.5, 6), mat(W / 2 + 0.7, F + 0.7, z - 0.2));
  // Floats along the net's head rope.
  for (let i = 0; i < 6; i++) b.add('woodPaint', new THREE.SphereGeometry(0.07, 8, 6), mat(W / 2 + 0.72, F + 2.05 - Math.sin((i / 5) * Math.PI) * 0.08, -1.45 + i * 0.5), { tint: i % 2 ? 0xf5c542 : 0xe8483a });
  const group = b.build({ name: 'shack' });
  group.add(sign, net);
  return {
    group,
    lights: [],
    anchors: { chimney: new THREE.Vector3(W / 2 - 1.0, F + WH + rise + 1.15, -0.6), door: new THREE.Vector3(dx, 0, D / 2 + porch + 0.8), lamp: new THREE.Vector3(dx + 0.7, F + 1.8, D / 2 + 0.28) },
  };
}

// ───────────────────────────────────────────── lighthouse

export interface Lighthouse {
  group: THREE.Group;
  beam: THREE.Mesh;
  lampPos: THREE.Vector3;
}

export function buildLighthouse(rng: Rng): Lighthouse {
  const b = new MeshBuilder();
  // Plinth: chunky dressed stones.
  b.add('stone', bevelCylinder(2.1, 2.3, 0.8, 0.08, 18), mat(0, -0.2, 0), { tint: 0xc8c0b0, aoWorld: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, -0.2, 0.5) });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.add('stone', roundedBox(0.7, 0.36, 0.5, 0.08), mat(Math.cos(a) * 2.05, 0.1, Math.sin(a) * 2.05, 0, -a, 0), { tint: new THREE.Color(0xb8b0a0).multiplyScalar(0.85 + rng.next() * 0.25) });
  }
  // Tower: stacked banded lathe slices.
  const H = 8.4;
  const r = (y: number): number => 1.45 - (y / H) * 0.5 - Math.sin((y / H) * Math.PI) * 0.06;
  const bands: [number, number, number][] = [
    [0.6, 2.2, 0xf4f0e6],
    [2.2, 3.5, 0xd8483a],
    [3.5, 5.1, 0xf4f0e6],
    [5.1, 6.4, 0xd8483a],
    [6.4, H, 0xf4f0e6],
  ];
  for (const [y0, y1, c] of bands) {
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 4; k++) {
      const y = y0 + ((y1 - y0) * k) / 4;
      pts.push(new THREE.Vector2(r(y), y));
    }
    b.add('plaster', new THREE.LatheGeometry(pts, 28), undefined, { tint: c, aoWorld: (p) => 0.78 + 0.22 * THREE.MathUtils.smoothstep(p.y, 0.4, 2.2) });
  }
  // Door + little windows up the tower (facing south-west).
  const face = (y: number, ang: number, w: number, h: number, material: 'glass' | 'woodPaint', tint?: number): void => {
    const rr = r(y) + 0.02;
    b.add(material, material === 'glass' ? new THREE.PlaneGeometry(w, h) : roundedBox(w, h, 0.1, 0.03), mat(Math.sin(ang) * rr, y, Math.cos(ang) * rr, 0, ang, 0), tint !== undefined ? { tint } : {});
  };
  face(1.35, 0.5, 0.8, 1.5, 'woodPaint', 0x2f5f6a);
  face(2.25, 0.5, 1.0, 0.14, 'woodPaint', 0xf4f0e6);
  for (const [y, a] of [[3.0, 0.3], [4.6, -0.5], [6.0, 0.4]] as const) {
    face(y, a, 0.36, 0.55, 'glass');
    face(y + 0.34, a, 0.46, 0.08, 'woodPaint', 0x2f5f6a);
  }
  // Gallery deck + railing.
  b.add('metal', bevelCylinder(1.45, 1.3, 0.16, 0.03, 24), mat(0, H, 0), { tint: 0x3a4248 });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    b.add('metal', new THREE.CylinderGeometry(0.025, 0.025, 0.62, 4), mat(Math.cos(a) * 1.36, H + 0.47, Math.sin(a) * 1.36), { tint: 0x2a3036 });
  }
  b.add('metal', new THREE.TorusGeometry(1.36, 0.035, 5, 32), mat(0, H + 0.78, 0, Math.PI / 2), { tint: 0x2a3036 });
  // Lamp room: glazing, mullions, the lamp, the red cap + vent ball + weather vane.
  b.add('metal', bevelCylinder(0.95, 0.95, 0.3, 0.03, 16), mat(0, H + 0.16, 0), { tint: 0xf4f0e6 });
  b.add('glass', new THREE.CylinderGeometry(0.82, 0.82, 1.15, 16, 1, true), mat(0, H + 1.03, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('metal', roundedBox(0.06, 1.15, 0.06, 0.01), mat(Math.cos(a) * 0.83, H + 1.03, Math.sin(a) * 0.83), { tint: 0x2a3036 });
  }
  b.add('lampGlow', new THREE.SphereGeometry(0.34, 14, 10), mat(0, H + 1.0, 0));
  b.add('roofTile', new THREE.ConeGeometry(1.08, 0.95, 16), mat(0, H + 2.05, 0), { tint: 0xc83a2e });
  b.add('metal', new THREE.SphereGeometry(0.14, 10, 8), mat(0, H + 2.6, 0), { tint: 0x2a3036 });
  b.add('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), mat(0, H + 2.95, 0), { tint: 0x2a3036 });
  b.add('metal', roundedBox(0.5, 0.12, 0.02, 0.005), mat(0.18, H + 3.1, 0), { tint: 0x2a3036 });
  const group = b.build({ name: 'lighthouse' });
  // Sweeping beam: two long soft cones (additive), rotated each frame. Volumetric look: bright down the
  // cone's axis (N·V), soft at its silhouette, fading out along its length; `uOpacity` is driven by the map.
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float along = pow(clamp(vUv.y, 0.0, 1.0), 2.4);
        float a = core * along * uOpacity;
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.74), a);
      }`,
  });
  const beamGeo = new THREE.ConeGeometry(2.4, 26, 16, 1, true);
  beamGeo.translate(0, -13, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beam2 = beamGeo.clone().rotateY(Math.PI);
  const beamMesh = new THREE.Mesh(mergeSimple([beamGeo.toNonIndexed(), beam2.toNonIndexed()]), beamMat);
  beamMesh.position.set(0, H + 1.0, 0);
  beamMesh.renderOrder = 8;
  beamMesh.userData.noAO = true;
  group.add(beamMesh);
  return { group, beam: beamMesh, lampPos: new THREE.Vector3(0, H + 1.0, 0) };
}

// ───────────────────────────────────────────── rowboat

/** Clinker rowboat, bow towards +X, keel at y = 0. */
export function buildRowboat(rng: Rng, hull = 0x2f7a8a, stripe = 0xf2eee4): THREE.Group {
  const b = new MeshBuilder();
  const L = 3.3;
  const NS = 18;
  const NR = 10;
  const halfW = (s: number): number => {
    // s: 0 stern (transom) → 1 bow (point)
    const bow = Math.pow(Math.max(0, 1 - Math.pow((s - 0.35) / 0.65, 2)), 0.55);
    const stern = 0.62 + 0.38 * Math.sin(Math.min(1, s / 0.35) * Math.PI * 0.5);
    return 0.72 * (s < 0.35 ? stern : bow);
  };
  const depthAt = (s: number): number => 0.55 + Math.pow(Math.abs(s - 0.45) * 1.8, 2) * 0.12; // sheer rises at the ends
  const shell = (inner: boolean): THREE.BufferGeometry => {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const cHull = new THREE.Color(hull);
    const cStripe = new THREE.Color(stripe);
    const cBottom = new THREE.Color(0xa8402e);
    const cWood = new THREE.Color(0xc89a68);
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      const x = -L / 2 + s * L;
      const w = halfW(s) * (inner ? 0.9 : 1);
      const dep = depthAt(s);
      for (let j = 0; j <= NR; j++) {
        const u = j / NR; // 0 port gunwale → 1 starboard gunwale
        const th = (u - 0.5) * Math.PI;
        const z = Math.sin(th) * w;
        let y = dep - Math.cos(th) * dep * (s > 0.92 ? 0.3 : 1);
        if (inner) y += 0.05;
        // Clinker steps: quantise the height slightly per strake.
        const strake = Math.floor(Math.abs(u - 0.5) * 8);
        pos.push(x, y + (inner ? 0 : strake * 0.004), z * (1 + (inner ? 0 : strake * 0.004)));
        let c = cWood;
        if (!inner) c = Math.abs(u - 0.5) > 0.42 ? cStripe : Math.abs(u - 0.5) < 0.2 ? cBottom : cHull;
        const shade = inner ? 0.75 + 0.25 * Math.abs(u - 0.5) * 2 : 0.85 + (strake % 2) * 0.08;
        col.push(c.r * shade, c.g * shade, c.b * shade);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NR; j++) {
        const a = i * (NR + 1) + j;
        const c = a + NR + 1;
        if (inner) idx.push(a, a + 1, c, c, a + 1, c + 1);
        else idx.push(a, c, a + 1, c, c + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  b.add('woodPaint', shell(false));
  b.add('woodGrain', shell(true));
  // Transom.
  const tw = halfW(0);
  const tr = new THREE.Shape();
  tr.moveTo(-tw, depthAt(0));
  tr.quadraticCurveTo(-tw * 0.9, 0.05, 0, 0.02);
  tr.quadraticCurveTo(tw * 0.9, 0.05, tw, depthAt(0));
  tr.lineTo(-tw, depthAt(0));
  const tg = new THREE.ShapeGeometry(tr, 6);
  tg.rotateY(-Math.PI / 2);
  tg.translate(-L / 2, 0, 0);
  b.add('woodPaint', tg, undefined, { tint: hull });
  // Gunwale rails.
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const s = i / 12;
      pts.push(new THREE.Vector3(-L / 2 + s * L, depthAt(s) + 0.01, side * halfW(s)));
    }
    b.add('woodGrain', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.035, 5, false), undefined, { tint: 0xd8b890 });
  }
  // Thwarts (seats) + oars.
  for (const s of [0.28, 0.58]) b.add('woodGrain', roundedBox(0.28, 0.05, halfW(s) * 1.85, 0.015), mat(-L / 2 + s * L, depthAt(s) - 0.18, 0), { tint: 0xd8b890 });
  for (const side of [-1, 1]) {
    const a = new THREE.Vector3(-0.2, 0.5, side * 0.3);
    const c = new THREE.Vector3(1.1, 0.42, side * 0.12);
    b.add('woodGrain', beam(0.028, 0.028, a, c, 6), undefined, { tint: 0xe0c090 });
    b.add('woodPaint', roundedBox(0.5, 0.03, 0.14, 0.01), mat(1.28, 0.41, side * 0.1, 0, 0, -0.06), { tint: 0xe0c090 });
  }
  // Painter rope at the bow.
  b.add('cloth', new THREE.TorusGeometry(0.12, 0.02, 5, 12), mat(L / 2 - 0.15, 0.62, 0, Math.PI / 2), { tint: 0xc8a86a });
  void rng;
  return b.build({ name: 'rowboat' });
}

// ───────────────────────────────────────────── driftwood, campfire, fence, boardwalk

export type DriftKind = 'log' | 'fork' | 'stump' | 'plank';

/**
 * Bleached driftwood (world coords). Four silhouettes so a beach never reads as one clone:
 *   log    long, fat trunk with a flared root plate of radiating roots
 *   fork   a bent branch that splits into a Y, with a couple of stubs
 *   stump  a short, thick chunk with broken root stubs
 *   plank  sea-worn boat planks (grey-bleached, rusty nail heads), one propped on the other
 * `len` is the overall length, `r` the base radius; `kind` defaults to a seeded pick.
 */
export function addDriftwood(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, len: number, rot: number, r = 0.16, kind?: DriftKind): void {
  const k: DriftKind = kind ?? rng.pick(['log', 'fork', 'stump', 'plank'] as DriftKind[]);
  const m = mat(x, y, z, 0, rot, 0);
  const tint = new THREE.Color(0xd8cebc).multiplyScalar(0.8 + rng.next() * 0.25).lerp(new THREE.Color(0xb8aa94), rng.next() * 0.4);
  const ao = (p: THREE.Vector3): number => 0.5 + 0.5 * THREE.MathUtils.smoothstep(p.y - y, 0, r * 1.3);
  const tube = (pts: THREE.Vector3[], r0: number, r1: number, segs: number, radial = 7): void => {
    b.add('woodGrain', taperTube(new THREE.CatmullRomCurve3(pts), segs, r0, r1, radial).applyMatrix4(m), undefined, { tint, aoWorld: ao });
  };
  // A random twist around the trunk so stubs / roots never sit at the same clock position.
  const roll = rng.next() * Math.PI * 2;
  const around = (a: number, rad: number): [number, number] => [Math.cos(a + roll) * rad, Math.sin(a + roll) * rad];
  if (k === 'plank') {
    const w = 0.22 + rng.next() * 0.08;
    const tp = new THREE.Color(0xc8c0b0).multiplyScalar(0.85 + rng.next() * 0.2);
    b.add('woodGrain', roundedBox(len, 0.05, w, 0.02).applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, mat(0, 0.03, 0, 0, 0, (rng.next() - 0.5) * 0.06))), undefined, { tint: tp, aoWorld: ao });
    const l2 = len * (0.5 + rng.next() * 0.3);
    b.add('woodGrain', roundedBox(l2, 0.05, w * 0.9, 0.02).applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, mat(len * 0.18, 0.1, w * 0.7, 0, 0.35, 0.12))), undefined, { tint: tp.clone().multiplyScalar(0.92), aoWorld: ao });
    for (let i = 0; i < 4; i++) {
      const nx = -len / 2 + 0.12 + (i % 2) * (len - 0.24);
      b.add('metal', new THREE.CylinderGeometry(0.014, 0.014, 0.012, 5).applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, mat(nx, 0.058, (i < 2 ? -1 : 1) * w * 0.3))), undefined, { tint: 0x8a4a2a });
    }
    return;
  }
  if (k === 'stump') {
    const L = Math.min(len, 1.1);
    const R = r * 1.6;
    tube([new THREE.Vector3(-L / 2, R * 0.8, 0), new THREE.Vector3(0, R * 0.85, 0.03), new THREE.Vector3(L / 2, R * 0.75, 0)], R, R * 0.85, 6, 9);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng.next() * 0.5;
      const [cy, cz] = around(a, 1);
      const reach = 0.25 + rng.next() * 0.3;
      tube([new THREE.Vector3(-L / 2, R * 0.8 + cy * R * 0.6, cz * R * 0.6), new THREE.Vector3(-L / 2 - reach * 0.6, R * 0.8 + cy * reach, cz * reach), new THREE.Vector3(-L / 2 - reach, Math.max(0.03, R * 0.8 + cy * reach * 1.3), cz * reach * 1.4)], R * 0.35, R * 0.1, 4, 5);
    }
    // Splintered top of the break.
    b.add('woodGrain', new THREE.ConeGeometry(R * 0.8, R * 0.9, 7).rotateZ(-Math.PI / 2).translate(L / 2 + R * 0.35, R * 0.75, 0).applyMatrix4(m), undefined, { tint, aoWorld: ao });
    return;
  }
  // Trunk (log / fork): bent, tapered, lying on the sand.
  const pts: THREE.Vector3[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(t * len - len / 2, r * 0.7 + Math.sin(t * Math.PI) * 0.06 * len * (rng.next() * 0.6), (rng.next() - 0.5) * 0.25 * len * t * (1 - t) * 2));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  b.add('woodGrain', taperTube(curve, 16, r * (k === 'log' ? 1.15 : 1), r * (k === 'log' ? 0.55 : 0.4), 8).applyMatrix4(m), undefined, { tint, aoWorld: ao });
  if (k === 'log') {
    // Root plate: a ring of thick, radiating roots at the butt end.
    const cnt = 6 + rng.int(0, 3);
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * Math.PI * 2 + rng.next() * 0.4;
      const [cy, cz] = around(a, 1);
      const reach = 0.35 + rng.next() * 0.35;
      const base = new THREE.Vector3(-len / 2, r * 0.7, 0);
      tube([base, base.clone().add(new THREE.Vector3(-0.12, cy * reach * 0.55, cz * reach * 0.55)), new THREE.Vector3(-len / 2 - 0.2 - rng.next() * 0.15, Math.max(0.04, r * 0.7 + cy * reach), cz * reach * 1.1)], r * 0.5, r * 0.08, 5, 5);
    }
  } else {
    // Fork: the thin end splits in two, plus a stub.
    const at = curve.getPointAt(0.62);
    const side = rng.next() < 0.5 ? 1 : -1;
    tube([at, at.clone().add(new THREE.Vector3(0.35, 0.08, side * 0.28)), at.clone().add(new THREE.Vector3(0.75, 0.05, side * 0.62))], r * 0.5, r * 0.18, 6, 6);
    const t = 0.25 + rng.next() * 0.2;
    const p = curve.getPointAt(t);
    const [cy, cz] = around(rng.next() * Math.PI, 1);
    tube([p, p.clone().add(new THREE.Vector3(0.06, Math.abs(cy) * 0.3 + 0.08, cz * 0.25))], r * 0.4, r * 0.15, 3, 5);
  }
}

/** Kelp strands, eel-grass, shell bits and twigs strewn along the high-tide line (world coords). */
export function addWrackLine(
  b: MeshBuilder,
  rng: Rng,
  line: { x: number; z: number; w: number }[],
  heightAt: (x: number, z: number) => number,
): void {
  const kelp = kelpMaterial();
  for (const s of line) {
    if (s.w <= 0) continue;
    const n = Math.round(s.w * 3 + rng.next());
    for (let i = 0; i < n; i++) {
      const x = s.x + (rng.next() - 0.5) * 0.5;
      const z = s.z + (rng.next() - 0.5) * 0.7;
      const y = heightAt(x, z);
      const roll = rng.next();
      if (roll < 0.5) {
        // Kelp strand: a flat, wavy ribbon (with a few air bladders).
        const len = 0.35 + rng.next() * 0.6;
        const a = rng.next() * Math.PI * 2;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 4; k++) {
          const t = k / 4;
          pts.push(new THREE.Vector3(Math.cos(a) * len * t + Math.sin(a) * Math.sin(t * 5 + i) * 0.06, 0.012, Math.sin(a) * len * t - Math.cos(a) * Math.sin(t * 5 + i) * 0.06));
        }
        const g = taperTube(new THREE.CatmullRomCurve3(pts), 8, 0.03 + rng.next() * 0.02, 0.012, 4, false);
        g.scale(1, 0.3, 1).translate(x, y, z);
        const c = new THREE.Color().setHSL(0.13 + rng.next() * 0.06, 0.55, 0.13 + rng.next() * 0.08);
        b.add(kelp, g, undefined, { tint: c });
        if (rng.next() < 0.5) for (let k = 1; k < 3; k++) b.add(kelp, new THREE.SphereGeometry(0.022, 6, 4).scale(1, 0.7, 1).translate(x + pts[k * 2]!.x * 0.9, y + 0.02, z + pts[k * 2]!.z * 0.9), undefined, { tint: c.clone().multiplyScalar(1.3) });
      } else if (roll < 0.72) {
        // Eel-grass / dried sea-grass: a tangle of thin pale blades lying flat.
        const c = new THREE.Color(0xc8b884).multiplyScalar(0.75 + rng.next() * 0.3);
        for (let k = 0; k < 4; k++) {
          const a = rng.next() * Math.PI * 2;
          const l = 0.25 + rng.next() * 0.3;
          b.add('cloth', new THREE.PlaneGeometry(l, 0.02).rotateX(-Math.PI / 2).rotateY(a).translate(x + Math.cos(a) * l * 0.3, y + 0.008 + k * 0.002, z - Math.sin(a) * l * 0.3), undefined, { tint: c });
        }
      } else if (roll < 0.9) {
        // Shell bits: little pale half-domes, some pink.
        const c = new THREE.Color(rng.next() < 0.3 ? 0xf2c8b8 : 0xf4ead8).multiplyScalar(0.85 + rng.next() * 0.15);
        const r = 0.03 + rng.next() * 0.03;
        b.add('white', new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.2, 0.5, 1).rotateY(rng.next() * 6).translate(x, y - 0.005, z), undefined, { tint: c });
      } else {
        // Bleached twig.
        const a = rng.next() * Math.PI;
        const l = 0.2 + rng.next() * 0.3;
        const p0 = new THREE.Vector3(x - Math.cos(a) * l * 0.5, y + 0.015, z + Math.sin(a) * l * 0.5);
        const p1 = new THREE.Vector3(x + Math.cos(a) * l * 0.5, y + 0.02, z - Math.sin(a) * l * 0.5);
        b.add('woodGrain', beam(0.014, 0.008, p0, p1, 4), undefined, { tint: 0xd8d0c0 });
      }
    }
  }
}

let kelpMat: THREE.MeshStandardMaterial | null = null;
function kelpMaterial(): THREE.MeshStandardMaterial {
  if (!kelpMat) {
    kelpMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 });
    kelpMat.name = 'kelp';
  }
  return kelpMat;
}

/** Beached-boat vignette dressing around (x, z): heaped net with floats, a crab pot, an oar in the sand, an anchor. */
export function addBoatVignette(b: MeshBuilder, rng: Rng, x: number, z: number, rot: number, heightAt: (x: number, z: number) => number): void {
  const at = (dx: number, dz: number): THREE.Vector3 => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const wx = x + dx * c + dz * s;
    const wz = z - dx * s + dz * c;
    return new THREE.Vector3(wx, heightAt(wx, wz), wz);
  };
  // Heaped net: lumpy mound + draped strands + a row of cork / red floats.
  const np = at(-2.3, 0.9);
  // Two lumpy, folded mounds of net (not a disc), floats caught in the folds.
  for (const [ox, oz, r0, hk] of [[0, 0, 0.6, 0.85], [0.55, 0.35, 0.42, 0.7]] as const) {
    const heap = new THREE.SphereGeometry(r0, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const hp = heap.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const vx = hp.getX(i);
      const vz = hp.getZ(i);
      const fold = 0.55 + 0.35 * Math.sin(vx * 11 + vz * 3) * Math.cos(vz * 9 - vx * 2) + 0.25 * Math.sin(Math.atan2(vz, vx) * 5);
      hp.setY(i, hp.getY(i) * hk * fold);
      hp.setX(i, vx * 1.3);
    }
    heap.computeVertexNormals();
    b.add(netHeapMaterial(), heap.rotateY(rot + 0.4 + ox).translate(np.x + ox, np.y - 0.03, np.z + oz));
  }
  for (const [dx, dz, dy, c] of [[-0.3, 0.2, 0.3, 0xe8483a], [0.25, -0.3, 0.22, 0xf2c84a], [0.75, 0.45, 0.2, 0xe8483a], [-0.65, -0.1, 0.1, 0xf2c84a], [0.4, 0.75, 0.08, 0xf2f0ea]] as const) {
    b.add('woodPaint', new THREE.SphereGeometry(0.11, 12, 8).scale(1, 0.8, 1).translate(np.x + dx, np.y + dy, np.z + dz), undefined, { tint: c });
  }
  // A few loose net strands trailing off the heap towards the boat.
  for (let i = 0; i < 3; i++) {
    const a = at(-1.6 + i * 0.15, 0.4 + i * 0.25);
    const c = at(-2.0 + i * 0.1, 0.9 - i * 0.1);
    b.add('cloth', beam(0.012, 0.012, a.setY(a.y + 0.03), c.setY(c.y + 0.25), 4), undefined, { tint: 0xd8cca8 });
  }
  // Crab pot (slatted box + netting) on its side.
  const cp = at(1.9, 1.3);
  const cr = rot + 0.8;
  b.add('cloth', roundedBox(0.62, 0.4, 0.5, 0.05), mat(cp.x, cp.y + 0.2, cp.z, 0, cr, 0.05), { tint: 0x7a8a78 });
  for (const dx of [-0.31, 0.31]) for (const dz of [-0.25, 0.25]) b.add('woodDark', roundedBox(0.04, 0.42, 0.04, 0.01), mat(cp.x + Math.cos(cr) * dx + Math.sin(cr) * dz, cp.y + 0.21, cp.z - Math.sin(cr) * dx + Math.cos(cr) * dz, 0, cr, 0));
  b.add('cloth', new THREE.TorusGeometry(0.13, 0.018, 4, 10, Math.PI), mat(cp.x, cp.y + 0.41, cp.z, 0, cr, 0), { tint: 0x3f7ab0 });
  // Oar stuck blade-up in the sand.
  const op = at(0.4, -1.4);
  b.add('woodGrain', beam(0.03, 0.03, op.clone().setY(op.y - 0.2), op.clone().add(new THREE.Vector3(0.12, 1.35, 0.05)), 6), undefined, { tint: 0xe0c090 });
  b.add('woodPaint', roundedBox(0.16, 0.5, 0.03, 0.01), mat(op.x + 0.14, op.y + 1.5, op.z + 0.06, 0, rot, 0.08), { tint: 0xe8483a });
  // Anchor half-buried with a rope back to the bow.
  const ap = at(2.4, -0.4);
  b.add('metal', beam(0.03, 0.03, ap.clone().setY(ap.y - 0.05), ap.clone().add(new THREE.Vector3(0.1, 0.55, 0)), 6), undefined, { tint: 0x4a4a50 });
  b.add('metal', new THREE.TorusGeometry(0.22, 0.03, 5, 12, Math.PI), mat(ap.x, ap.y + 0.02, ap.z, 0, rot, Math.PI), { tint: 0x4a4a50 });
  b.add('metal', new THREE.TorusGeometry(0.06, 0.015, 4, 8), mat(ap.x + 0.1, ap.y + 0.6, ap.z, 0, rot, 0), { tint: 0x4a4a50 });
  const bow = at(1.5, 0);
  rope(b, ap.clone().add(new THREE.Vector3(0.1, 0.6, 0)), bow.setY(bow.y + 0.6), 0.45, 0.018);
  void rng;
}

let netHeapMat: THREE.MeshStandardMaterial | null = null;
function netHeapMaterial(): THREE.MeshStandardMaterial {
  if (!netHeapMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2e4a3c';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#c8b27a';
    g.lineWidth = 3;
    for (let i = -128; i < 256; i += 12) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 128, 128);
      g.stroke();
      g.beginPath();
      g.moveTo(i + 128, 0);
      g.lineTo(i, 128);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    t.colorSpace = THREE.SRGBColorSpace;
    netHeapMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
    netHeapMat.name = 'netHeap';
  }
  return netHeapMat;
}

/** Campfire vignette: a bucket, a kettle on a flat stone, a crate of bottles, a striped blanket. */
export function addCampVignette(b: MeshBuilder, rng: Rng, x: number, z: number, heightAt: (x: number, z: number) => number): void {
  const put = (dx: number, dz: number): THREE.Vector3 => new THREE.Vector3(x + dx, heightAt(x + dx, z + dz), z + dz);
  const bk = put(1.35, 0.95);
  b.add('metal', bevelCylinder(0.19, 0.15, 0.34, 0.02, 12), mat(bk.x, bk.y, bk.z), { tint: 0x7a96a8 });
  b.add('stillWater', new THREE.CircleGeometry(0.17, 12), mat(bk.x, bk.y + 0.3, bk.z, -Math.PI / 2));
  b.add('metal', new THREE.TorusGeometry(0.19, 0.01, 4, 12, Math.PI), mat(bk.x, bk.y + 0.34, bk.z, 0, 0.6, 0), { tint: 0x4a4a4a });
  const ks = put(-0.35, -0.95);
  b.add('rock', new THREE.CylinderGeometry(0.28, 0.32, 0.12, 9), mat(ks.x, ks.y + 0.03, ks.z), { tint: 0x8a8278 });
  b.add('metal', new THREE.SphereGeometry(0.16, 12, 8).scale(1, 0.85, 1), mat(ks.x, ks.y + 0.22, ks.z), { tint: 0x3a3a3e });
  b.add('metal', new THREE.CylinderGeometry(0.02, 0.03, 0.16, 6), mat(ks.x + 0.16, ks.y + 0.26, ks.z, 0, 0, -0.9), { tint: 0x3a3a3e });
  const cb = put(-1.7, 1.4);
  b.add('woodGrain', roundedBox(0.55, 0.32, 0.4, 0.03), mat(cb.x, cb.y + 0.16, cb.z, 0, 0.35, 0), { tint: 0xc8a070 });
  for (let i = 0; i < 3; i++) b.add('glass', new THREE.CylinderGeometry(0.04, 0.045, 0.22, 8), mat(cb.x - 0.12 + i * 0.12, cb.y + 0.38, cb.z + (i - 1) * 0.04));
  const bl = put(0.25, 2.05);
  const blanket = new THREE.PlaneGeometry(1.3, 0.9, 6, 4).rotateX(-Math.PI / 2);
  const bp = blanket.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    bp.setY(i, 0.02 + Math.sin(bp.getX(i) * 5 + bp.getZ(i) * 3) * 0.015);
    const stripe = Math.floor((bp.getX(i) + 0.65) / 0.22) % 2;
    new THREE.Color(stripe ? 0xe8483a : 0xf2eee4).toArray(col, i * 3);
  }
  blanket.setAttribute('color', new THREE.BufferAttribute(col, 3));
  b.add('cloth', blanket, mat(bl.x, bl.y, bl.z, 0, 0.25, 0));
  void rng;
}

/** A child's sandcastle with a moat, a shell-studded keep, a flag, and a pail and spade left beside it. */
export function addSandcastle(b: MeshBuilder, rng: Rng, x: number, z: number, heightAt: (x: number, z: number) => number): void {
  const y = heightAt(x, z);
  const sand = 0xe2c894;
  const wet = 0xb89a68;
  b.add('plaster', new THREE.TorusGeometry(0.95, 0.12, 5, 24).rotateX(Math.PI / 2).scale(1, 0.35, 1), mat(x, y - 0.02, z), { tint: wet });
  b.add('plaster', bevelCylinder(0.72, 0.8, 0.22, 0.06, 18), mat(x, y - 0.02, z), { tint: sand });
  b.add('plaster', bevelCylinder(0.34, 0.4, 0.42, 0.05, 12), mat(x, y + 0.18, z), { tint: sand });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add('plaster', roundedBox(0.09, 0.08, 0.09, 0.02), mat(x + Math.cos(a) * 0.33, y + 0.63, z + Math.sin(a) * 0.33, 0, -a, 0), { tint: sand });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const tx = x + Math.cos(a) * 0.58;
    const tz = z + Math.sin(a) * 0.58;
    const h = 0.34 + rng.next() * 0.12;
    b.add('plaster', bevelCylinder(0.13, 0.16, h, 0.03, 10), mat(tx, y + 0.18, tz), { tint: sand });
    b.add('plaster', new THREE.ConeGeometry(0.15, 0.2, 10), mat(tx, y + 0.18 + h + 0.09, tz), { tint: 0xd8bc86 });
  }
  // Shell windows + a flag on the keep.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.add('white', new THREE.SphereGeometry(0.035, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), mat(x + Math.cos(a) * 0.38, y + 0.36, z + Math.sin(a) * 0.38, 0, -a + Math.PI / 2, 0), { tint: i % 2 ? 0xf6c8b8 : 0xf6eee0 });
  }
  b.add('woodGrain', beam(0.012, 0.01, new THREE.Vector3(x, y + 0.6, z), new THREE.Vector3(x, y + 1.05, z), 4), undefined, { tint: 0xe0c8a0 });
  b.add('cloth', new THREE.PlaneGeometry(0.22, 0.13).translate(0.11, 0, 0), mat(x, y + 0.97, z, 0, -0.5, 0), { tint: 0xe8483a });
  // Pail (tipped over) and a spade.
  b.add('woodPaint', bevelCylinder(0.13, 0.1, 0.24, 0.02, 12), mat(x + 1.3, y + 0.12, z + 0.4, 0, 0.6, Math.PI / 2), { tint: 0xe8483a });
  b.add('metal', new THREE.TorusGeometry(0.12, 0.008, 4, 10, Math.PI), mat(x + 1.28, y + 0.12, z + 0.42, 0, 0.6, 0), { tint: 0xf2eee4 });
  b.add('woodPaint', roundedBox(0.04, 0.03, 0.42, 0.01), mat(x - 1.1, y + 0.03, z + 0.5, 0, 0.9, 0), { tint: 0x3f86d6 });
  b.add('woodPaint', roundedBox(0.16, 0.02, 0.18, 0.01), mat(x - 1.28, y + 0.03, z + 0.36, 0, 0.9, 0), { tint: 0x3f86d6 });
}

let beachSignMat: THREE.MeshStandardMaterial | null = null;
function beachSignMaterial(): THREE.MeshStandardMaterial {
  if (!beachSignMat) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 188;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2f6f7a';
    g.fillRect(0, 0, 512, 188);
    g.globalAlpha = 0.16;
    g.fillStyle = '#0e2a30';
    for (let y = 8; y < 188; y += 14) g.fillRect(0, y + Math.sin(y) * 2, 512, 2);
    g.globalAlpha = 1;
    g.strokeStyle = '#f2eee4';
    g.lineWidth = 7;
    g.strokeRect(12, 12, 488, 164);
    g.fillStyle = '#f7f2e4';
    g.font = 'bold 74px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('DRIFTSAND', 256, 76);
    g.font = 'bold 34px Georgia, serif';
    g.fillStyle = '#f5c542';
    g.fillText('~  BEACH  ~', 256, 136);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    beachSignMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
    beachSignMat.name = 'beachSign';
  }
  return beachSignMat;
}

/** Driftsand welcome sign + a lifebuoy stand where the boardwalk meets the beach. */
export function addBeachSign(b: MeshBuilder, x: number, z: number, heightAt: (x: number, z: number) => number): void {
  const y = heightAt(x, z);
  for (const dx of [-0.55, 0.55]) b.add('woodDark', roundedBox(0.1, 1.5, 0.1, 0.02), mat(x + dx, y + 0.6, z));
  b.add('woodPaint', roundedBox(1.5, 0.62, 0.06, 0.03), mat(x, y + 1.15, z + 0.02, 0, 0, 0.03), { tint: 0x2f6f7a });
  b.add(beachSignMaterial(), new THREE.PlaneGeometry(1.36, 0.5), mat(x, y + 1.15, z + 0.056, 0, 0, 0.03));
  // Lifebuoy on its own post.
  const lx = x + 1.2;
  b.add('woodDark', roundedBox(0.1, 1.4, 0.1, 0.02), mat(lx, y + 0.6, z));
  b.add('woodPaint', new THREE.TorusGeometry(0.26, 0.075, 8, 20), mat(lx, y + 1.0, z + 0.1), { tint: 0xf2eee4 });
  for (let i = 0; i < 4; i++) b.add('woodPaint', new THREE.TorusGeometry(0.26, 0.08, 8, 5, Math.PI / 5), mat(lx, y + 1.0, z + 0.1, 0, 0, (i / 4) * Math.PI * 2), { tint: 0xe8483a });
}

/** Stone fire ring with a teepee of charred logs (world coords). Returns the flame position. */
export function addCampfire(b: MeshBuilder, rng: Rng, x: number, y: number, z: number): THREE.Vector3 {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng.next() * 0.2;
    const g = rockGeometry(rng, 0.19 + rng.next() * 0.06, 1, false);
    g.applyMatrix4(mat(x + Math.cos(a) * 0.62, y - 0.02, z + Math.sin(a) * 0.62, 0, rng.next() * 6, 0));
    b.add('rock', g, undefined, { tint: 0x9a948a });
  }
  b.add('stone', new THREE.CircleGeometry(0.55, 16), mat(x, y + 0.02, z, -Math.PI / 2), { tint: 0x2a2420 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const base = new THREE.Vector3(x + Math.cos(a) * 0.42, y + 0.02, z + Math.sin(a) * 0.42);
    const top = new THREE.Vector3(x + Math.cos(a) * 0.05, y + 0.55, z + Math.sin(a) * 0.05);
    b.add('woodDark', beam(0.06, 0.04, base, top, 6), undefined, { tint: 0x4a3a30, aoWorld: (p) => 0.35 + 0.65 * THREE.MathUtils.smoothstep(p.y - y, 0.0, 0.5) });
  }
  return new THREE.Vector3(x, y + 0.2, z);
}

/** Weathered sand fence: uneven slats wired together, half-buried (world coords). */
export function addSandFence(b: MeshBuilder, rng: Rng, pts: [number, number][], heightAt: (x: number, z: number) => number): void {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const len = curve.getLength();
  const n = Math.floor(len / 0.16);
  const wireA: THREE.Vector3[] = [];
  const wireB: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const gap = Math.sin(t * 37) > 0.93; // a few missing slats
    const y = heightAt(p.x, p.z);
    const h = 0.75 + Math.sin(t * 91) * 0.08 + (rng.next() - 0.5) * 0.12;
    const lean = (rng.next() - 0.5) * 0.12 + Math.sin(t * 5) * 0.08;
    if (!gap) {
      const tint = new THREE.Color(0xc8b8a0).multiplyScalar(0.8 + rng.next() * 0.25);
      // Thin slats: a plain box (12 tris) reads the same as a rounded one at this size (108 tris).
      b.add('woodGrain', new THREE.BoxGeometry(0.06, h, 0.02), mat(p.x, y + h / 2 - 0.15, p.z, lean, Math.atan2(tan.x, tan.z) + Math.PI / 2, 0), { tint, aoWorld: (q) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(q.y - y, 0, 0.3) });
    }
    wireA.push(new THREE.Vector3(p.x, y + 0.12, p.z));
    wireB.push(new THREE.Vector3(p.x, y + h - 0.28, p.z));
    if (i % 18 === 0) b.add('woodDark', new THREE.CylinderGeometry(0.05, 0.06, 1.1, 6), mat(p.x, y + 0.35, p.z));
  }
  for (const w of [wireA, wireB]) b.add('metal', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(w), Math.max(8, w.length), 0.008, 3, false), undefined, { tint: 0x6a6a64 });
}

/** Boardwalk planks following a curve over the dunes (world coords). */
export function addBoardwalk(b: MeshBuilder, rng: Rng, pts: [number, number][], heightAt: (x: number, z: number) => number): void {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const len = curve.getLength();
  const n = Math.floor(len / 0.28);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    const y = Math.max(heightAt(p.x - tan.z * 0.7, p.z + tan.x * 0.7), heightAt(p.x + tan.z * 0.7, p.z - tan.x * 0.7), heightAt(p.x, p.z)) + 0.1;
    const tint = new THREE.Color(0xc8a47a).multiplyScalar(0.8 + rng.next() * 0.25);
    b.add('woodGrain', roundedBox(1.55, 0.06, 0.24, 0.015), mat(p.x, y, p.z, 0, yaw, (rng.next() - 0.5) * 0.03), { tint });
    if (i % 4 === 0) {
      for (const s of [-1, 1]) b.add('woodDark', roundedBox(0.1, 0.2, 0.1, 0.02), mat(p.x + Math.cos(yaw) * 0.7 * s, y - 0.1, p.z - Math.sin(yaw) * 0.7 * s));
    }
  }
}

/** Big coastal rock (world coords) with a wet, darker skirt and pale barnacle crust. */
export function addCoastRock(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, radius: number, yScale = 1): void {
  const g = rockGeometry(rng, radius, rng.int(0, 2), true);
  g.applyMatrix4(mat(x, y, z, 0, rng.next() * 6, 0, 1, yScale, 1));
  const tint = new THREE.Color(0x9a948c).multiplyScalar(0.85 + rng.next() * 0.2);
  b.add('rock', g, undefined, {
    tint,
    aoWorld: (p) => (p.y < 0.35 ? 0.5 + 0.2 * THREE.MathUtils.smoothstep(p.y, -0.6, 0.35) : 0.75 + 0.25 * THREE.MathUtils.smoothstep(p.y, 0.35, 1.2)),
  });
  void prep;
}

/**
 * Sunbather's corner: a tilted striped parasol, a striped towel with a folded book, a cooler and a
 * beach ball (world coords, base on the sand).
 */
export function addParasolVignette(b: MeshBuilder, rng: Rng, x: number, z: number, heightAt: (x: number, z: number) => number): void {
  const y = heightAt(x, z);
  const tilt = 0.18;
  const lean = 0.6;
  // Pole (leaning towards the sun a touch).
  const top = new THREE.Vector3(x + Math.sin(lean) * tilt * 2.1, y + 2.05, z + Math.cos(lean) * tilt * 2.1);
  b.add('woodPaint', beam(0.025, 0.025, new THREE.Vector3(x, y - 0.25, z), top, 6), undefined, { tint: 0xf2eee4 });
  // Canopy: 12 alternating panels (coral / cream), a scalloped rim, a finial.
  const cone = new THREE.ConeGeometry(1.25, 0.42, 12, 1, true).toNonIndexed();
  const pos = cone.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const A = new THREE.Color(0xe8584a);
  const B = new THREE.Color(0xf6eedc);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12 + 0.5) % 2;
    for (let k = 0; k < 3; k++) (seg ? A : B).toArray(col, (i + k) * 3);
  }
  cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Matrix4().compose(top.clone().add(new THREE.Vector3(0, -0.12, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(lean) * tilt, 0, -Math.sin(lean) * tilt)), new THREE.Vector3(1, 1, 1));
  b.add('cloth', cone, m);
  // Underside (so the canopy isn't see-through from below / shadowed side).
  const under = new THREE.ConeGeometry(1.24, 0.4, 12, 1, true);
  under.scale(1, 1, 1);
  const flip = new THREE.Matrix4().makeScale(1, 1, -1);
  b.add('cloth', under.applyMatrix4(flip), m, { tint: 0xd8c8b0 });
  b.add('woodPaint', new THREE.SphereGeometry(0.06, 8, 6), mat(top.x, top.y + 0.12, top.z), { tint: 0xe8584a });
  // Towel: 5 stripes, lying flat, slightly rumpled.
  const tx = x + 0.6;
  const tz = z + 0.9;
  const ty = heightAt(tx, tz);
  const rot = 0.35;
  const stripes = [0x3f7ab0, 0xf6eedc, 0xf2b84a, 0xf6eedc, 0x3f7ab0];
  stripes.forEach((c, i) => {
    const off = (i - 2) * 0.36;
    b.add('cloth', new THREE.BoxGeometry(0.36, 0.025, 1.0), mat(tx + Math.cos(rot) * off, ty + 0.012 + Math.sin(i * 1.7) * 0.004, tz - Math.sin(rot) * off, 0, rot, (rng.next() - 0.5) * 0.02), { tint: c });
  });
  // A paperback left open, face down, on the towel.
  b.add('woodPaint', new THREE.BoxGeometry(0.16, 0.03, 0.22), mat(tx + 0.2, ty + 0.04, tz - 0.15, 0, rot + 0.3, 0.35), { tint: 0x5a8a6a });
  b.add('woodPaint', new THREE.BoxGeometry(0.16, 0.03, 0.22), mat(tx + 0.34, ty + 0.04, tz - 0.08, 0, rot + 0.3, -0.35), { tint: 0x5a8a6a });
  // Cooler (teal box, white lid, handle).
  const cx = x - 0.7;
  const cz = z + 0.4;
  const cy = heightAt(cx, cz);
  b.add('woodPaint', roundedBox(0.55, 0.36, 0.36, 0.05), mat(cx, cy + 0.18, cz, 0, 0.5, 0), { tint: 0x3fa89a });
  b.add('woodPaint', roundedBox(0.58, 0.07, 0.39, 0.03), mat(cx, cy + 0.38, cz, 0, 0.5, 0), { tint: 0xf2eee4 });
  // Beach ball.
  const bx = x + 1.7;
  const bz = z - 0.2;
  const ball = new THREE.SphereGeometry(0.22, 12, 8).toNonIndexed();
  const bp = ball.attributes.position as THREE.BufferAttribute;
  const bc = new Float32Array(bp.count * 3);
  const cols = [0xe8484a, 0xf6eedc, 0x3f8ad0, 0xf6eedc, 0xf2c23a, 0xf6eedc].map((h) => new THREE.Color(h));
  for (let i = 0; i < bp.count; i += 3) {
    const a = Math.atan2((bp.getZ(i) + bp.getZ(i + 1) + bp.getZ(i + 2)) / 3, (bp.getX(i) + bp.getX(i + 1) + bp.getX(i + 2)) / 3);
    const c = cols[Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) % 6]!;
    for (let k = 0; k < 3; k++) c.toArray(bc, (i + k) * 3);
  }
  ball.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  b.add('woodPaint', ball, mat(bx, heightAt(bx, bz) + 0.2, bz, 0.4, 0.2, 0.3));
}
