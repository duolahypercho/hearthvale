/**
 * Farmhand cabins: one cozy log cabin per extra player on the farm (slots 1-3), door painted in the
 * owner's accent colour. All cabins are merged into one builder (one draw per material in total).
 * Interacting with a cabin door = going to bed there.
 */
import * as THREE from 'three';
import { MeshBuilder, roundedBox, bevelCylinder, mat, groundAO } from '../world/geom';
import type { GameMap } from '../world/map';
import { EmoteBubble } from '../entities/remote-emotes';
import { globalUniforms } from '../render/uniforms';
import { SmokeEmitter } from '../render/particles';
import { materials } from '../render/materials';

/** Footprint top-left tile of each cabin slot (3×3 tiles, door on the south side). */
export const CABIN_SITES: { x0: number; z0: number }[] = [
  { x0: 15, z0: 19 },
  { x0: 53, z0: 18 },
  { x0: 57, z0: 23 },
];

export const cabinDoor = (slot: number): { x: number; z: number } => {
  const s = CABIN_SITES[slot]!;
  return { x: s.x0 + 1, z: s.z0 + 2 };
};
/** Where the owner stands when waking up (just outside the door). */
export const cabinFront = (slot: number): { x: number; z: number } => {
  const s = CABIN_SITES[slot]!;
  return { x: s.x0 + 1.5, z: s.z0 + 3.6 };
};

// Materials: ONE tinted wood-grain mesh for the whole body (logs, stone, painted shingle rows) plus
// the night-glow window card (window + porch-lamp glass) — 2 draws + 1 shadow draw for ALL cabins
// together, ~6k tris a cabin (pillar 14: r3 was 8 draws / 25k tris each).
const W_ = 'woodGrain';
/** A log centred on its own origin (bevelCylinder grows up from y = 0). */
const log = (r: number, len: number, bevel = 0.03, radial = 7): THREE.BufferGeometry => bevelCylinder(r, r, len, bevel, radial).translate(0, -len / 2, 0);
/** Single-segment rounded box (108 tris: at cabin scale the 2-segment bevel is invisible). */
const rb = (w: number, h: number, d: number, r = 0.04): THREE.BufferGeometry => roundedBox(w, h, d, r, 1);

/**
 * (r7b) The shingle courses' own copy of the wood-grain material with a moonlit sky fill: after dusk the
 * roof plane turned away from the moon read as a near-black slab filling 40 % of the bedtime frame, so
 * the owner's colour was lost. A cool fill (∝ uNight, strongest on up-facing planes) keeps the shingle
 * hue at a readable value at night and does nothing by day. One extra draw for every cabin together.
 */
let roofMat: THREE.Material | null = null;
function roofMaterial(): THREE.Material {
  if (roofMat) return roofMat;
  const base = materials.get(W_);
  const m = base.clone();
  m.name = 'cabinRoof';
  const baseCompile = base.onBeforeCompile.bind(base);
  m.onBeforeCompile = (sh, r) => {
    baseCompile(sh, r);
    sh.uniforms.uCabinNight = globalUniforms.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uCabinNight;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `{
          // view-space up ≈ the camera's up axis tipped by the high 3/4 pitch
          float hvUp = clamp(dot(normalize(normal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0, 1.0);
          outgoingLight += diffuseColor.rgb * vec3(0.62, 0.7, 0.98) * uCabinNight * (0.16 + 0.22 * hvUp);
        }
        #include <opaque_fragment>`,
      );
  };
  const baseKey = base.customProgramCacheKey.bind(base);
  m.customProgramCacheKey = () => `${baseKey()}|cabinRoof`;
  roofMat = m;
  return m;
}

/** World positions of the chimney pots built by the last buildCabin calls (smoke origins). */
const chimneyTops: THREE.Vector3[] = [];

function buildCabin(b: MeshBuilder, cx: number, y: number, cz: number, accent: number, seed: number): void {
  const at = (x: number, yy: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 => mat(cx + x, y + yy, cz + z, rx, ry, rz, sx, sy, sz);
  const W = 2.7;
  const D = 2.5;
  const base = 0.3;
  const wallH = 1.62;
  const top = base + wallH;
  const acc = new THREE.Color(accent);
  const accDark = acc.clone().multiplyScalar(0.62).getHex();
  // Fieldstone plinth
  b.add(W_, rb(W + 0.34, base + 0.1, D + 0.34, 0.1), at(0, base / 2 - 0.02, 0), { tint: 0x9c968c, ao: groundAO(0.25, 0.6) });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + seed;
    b.add(W_, rb(0.34, 0.16, 0.26, 0.07), at(Math.cos(a) * (W / 2 + 0.12), 0.1, Math.sin(a) * (D / 2 + 0.12), 0, a, 0), { tint: i % 2 ? 0xb0aa9e : 0x8e887e });
  }
  // Log walls: front/back logs along X, side logs along Z, offset half a log so the corners interlock.
  const logs = 5;
  const lh = wallH / logs;
  for (let i = 0; i < logs; i++) {
    const yy = base + lh * (i + 0.5);
    const tone = i % 2 ? 0xd09a64 : 0xbd8654;
    for (const sz of [-1, 1]) b.add(W_, log(lh * 0.52, W + 0.42), at(0, yy, sz * D * 0.5, 0, 0, Math.PI / 2), { tint: tone });
    for (const sx of [-1, 1]) b.add(W_, log(lh * 0.5, D + 0.42), at(sx * W * 0.5, yy + lh * 0.25, 0, Math.PI / 2, 0, 0), { tint: tone });
    // Cut log ends at the corners (paler end grain)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(W_, new THREE.CylinderGeometry(lh * 0.46, lh * 0.46, 0.02, 7), at(sx * (W / 2 + 0.21), yy, sz * D * 0.5, 0, 0, Math.PI / 2), { tint: 0xf0cf98 });
  }
  b.add(W_, rb(W - 0.12, wallH, D - 0.12, 0.04), at(0, base + wallH / 2, 0), { tint: 0x6a4428 });
  // Gable ends: a backing triangle flush with the outer log faces (r5 sat it 0.2 m behind them, deep in
  // the eave's shadow: a hollow black void at night), lapped siding boards stepping in with the rake,
  // and a round vent window over the door that glows with the cabin's lamps.
  const gh = 1.05;
  const tri = new THREE.Shape();
  tri.moveTo(-W / 2 - 0.12, 0);
  tri.lineTo(W / 2 + 0.12, 0);
  tri.lineTo(0, gh + 0.08);
  tri.closePath();
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false, curveSegments: 1 });
  gable.translate(0, 0, -0.05);
  const gz = D * 0.5 + 0.13;
  const boards = 5;
  for (const sz of [-1, 1]) {
    // (clone: MeshBuilder.add transforms the geometry in place — re-adding the one shared prism doubled the
    // first transform and parked a stray gable triangle in mid-air at ~2x the cabin's coordinates)
    b.add(W_, gable.clone(), at(0, top - 0.02, sz * gz), { tint: 0x9a6438 });
    for (let k = 0; k < boards; k++) {
      // Each lap board spans the triangle at its own height (its ends tuck under the barge boards).
      const h0 = (k / boards) * gh * 0.9;
      const bh = (gh * 0.9) / boards;
      const w = (W + 0.24) * (1 - (h0 + bh * 0.5) / (gh + 0.08)) - 0.1;
      b.add(W_, rb(Math.max(0.12, w), bh * 1.04, 0.05, 0.015), at(0, top + h0 + bh * 0.5, sz * (gz + 0.06), -0.08 * sz, 0, 0), { tint: k % 2 ? 0xd29c66 : 0xc48a56 });
    }
  }
  // Round vent window in the front gable: dark frame ring + lit glass (windowCard glows at dusk).
  const vy = top + gh * 0.42;
  b.add(W_, bevelCylinder(0.2, 0.2, 0.06, 0.015, 12), at(0, vy, gz + 0.1, Math.PI / 2, 0, 0), { tint: 0x4e3220 });
  b.add('windowCard', new THREE.CircleGeometry(0.14, 12), at(0, vy, gz + 0.165));
  b.add(W_, rb(0.025, 0.28, 0.02, 0.008), at(0, vy, gz + 0.175), { tint: 0x4e3220 });
  b.add(W_, rb(0.28, 0.025, 0.02, 0.008), at(0, vy, gz + 0.175), { tint: 0x4e3220 });
  // Roof: each side is ONE pitched plane laid on the gable line — a continuous deck board, then
  // shingle courses lying flush on that same plane (eave course first, each higher course a hair
  // proud so its butt edge throws a thin shadow line), a fascia board along the eave, barge boards
  // up both gables and a ridge cap. Everything shares the side's transform, so nothing splays.
  // Shingles in the owner's colour (weathered toward a warm brown): whose cabin is whose reads from
  // across the farm, and a muted blue / green / ochre keeps its value under the night's blue moonlight
  // where the r5 terracotta went black.
  const weather = new THREE.Color(0xa47a62);
  // (r7: a value step lighter again — the owner's colour must survive the moonlight from the high lens)
  const roofA = acc.clone().lerp(weather, 0.24).lerp(new THREE.Color(0xffffff), 0.08).getHex();
  const roofB = acc.clone().lerp(weather, 0.14).lerp(new THREE.Color(0xffffff), 0.2).getHex();
  const pitch = Math.atan2(gh, W / 2);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const rake = Math.hypot(W / 2, gh);
  const over = 0.4; // eave overhang along the slope
  const t0 = -0.06; // a touch past the ridge so the two decks meet under the cap
  const t1 = rake + over;
  const deckT = 0.09;
  const roofD = D + 0.72; // ~0.23 m past the gable siding at each end
  const courses = 5;
  const courseW = (t1 - t0) / courses;
  /** A point on the side-`sx` roof plane: `t` m down the slope from the apex, `n` m off the gable line. */
  const onRoof = (sx: number, t: number, n: number, zz: number, extraRot = 0, w = 1, h = 1, d = 1): THREE.Matrix4 =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(cx + sx * (t * cosP + n * sinP), y + top + gh - t * sinP + n * cosP, cz + zz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -sx * (pitch + extraRot))),
      new THREE.Vector3(w, h, d),
    );
  for (const sx of [-1, 1]) {
    // Deck (dark underlayer: it only shows at the eave and gable edges)
    b.add(W_, rb(t1 - t0, deckT, roofD, 0.03), onRoof(sx, (t0 + t1) / 2, deckT / 2 + 0.02, 0), { tint: 0x7a3a28 });
    for (let r = 0; r < courses; r++) {
      // r = 0 at the eave; each course overlaps the one below by ~18% and sits 8 mm prouder.
      const tc = t1 - (r + 0.5) * courseW;
      const n = deckT + 0.02 + 0.03 + r * 0.008;
      const tone = r % 2 ? roofA : roofB;
      b.add(roofMaterial(), rb(courseW * 1.18, 0.06, roofD - 0.04, 0.025), onRoof(sx, tc, n, 0), { tint: tone });
    }
    // Fascia along the eave (a pale painted board standing square to the slope)
    b.add(W_, rb(0.06, 0.2, roofD + 0.04, 0.02), onRoof(sx, t1 + 0.01, deckT / 2 + 0.02, 0), { tint: 0xfff2d8 });
    // Barge boards up each gable end, just proud of the deck edge
    // (cream: at night they are the roof's readable rim, catching the porch lamp and the moon)
    for (const sz of [-1, 1]) b.add(W_, rb(t1 - t0 + 0.04, 0.24, 0.07, 0.02), onRoof(sx, (t0 + t1) / 2, deckT / 2 + 0.04, sz * (roofD / 2 + 0.02)), { tint: 0xfff2d8 });
  }
  // A lit skylight on the east slope (framed, lying on the shingles): from the high camera the roof
  // reads as a lived-in roof, not a dark slab, after dusk.
  {
    const sx = 1;
    const tS = rake * 0.52;
    const nS = deckT + 0.02 + 0.03 + 3 * 0.008 + 0.05;
    b.add(W_, rb(0.62, 0.07, 0.56, 0.02), onRoof(sx, tS, nS, -0.35), { tint: 0x5a3a22 });
    b.add('windowCard', new THREE.PlaneGeometry(0.48, 0.42).rotateX(-Math.PI / 2), onRoof(sx, tS, nS + 0.04, -0.35));
    b.add(W_, rb(0.5, 0.03, 0.025, 0.008), onRoof(sx, tS, nS + 0.05, -0.35), { tint: 0x5a3a22 });
  }
  // Festoon bulbs strung up the front gable's barge boards (a warm, readable roof line at night —
  // the r5 cabin roof read as a black trapezoid after dark): lampGlow follows the lamps' dusk curve.
  for (const sx of [-1, 1]) {
    const nB = 6;
    for (let k = 0; k < nB; k++) {
      const t = t0 + 0.2 + ((t1 - t0 - 0.3) * (k + 0.5)) / nB;
      b.add('lampGlow', new THREE.SphereGeometry(0.04, 7, 5), onRoof(sx, t, -0.05, roofD / 2 + 0.08));
    }
    b.add(W_, rb(t1 - t0 - 0.2, 0.012, 0.012, 0.004), onRoof(sx, (t0 + t1) / 2 + 0.05, -0.0, roofD / 2 + 0.08), { tint: 0x2a2420 });
  }
  b.add('lampGlow', new THREE.SphereGeometry(0.05, 7, 5), at(0, top + gh + 0.02, roofD / 2 + 0.1));
  // Ridge cap: a rounded log saddled over both decks
  b.add(roofMaterial(), log(0.11, roofD + 0.1, 0.02, 10), at(0, top + gh + deckT + 0.1, 0, Math.PI / 2, 0, 0), { tint: 0x8e4a32 });
  // Chimney: a fieldstone stack (staggered courses of 2 stones in alternating greys) with a slate cap
  // and a clay pot; smoke rises from the pot while the cabin is lived in (Cabins.update).
  const chx = -W * 0.26;
  const chz = -D * 0.18;
  const ch0 = top + gh * 0.05;
  const courseH = 0.2;
  for (let r = 0; r < 7; r++) {
    const yy = ch0 + r * courseH + courseH / 2;
    const flip = r % 2 ? 1 : -1;
    for (let k = 0; k < 2; k++) {
      const off = (k - 0.5) * 0.24 + flip * 0.03;
      const tone = [0xb4ada2, 0x9c968c, 0xa8a196, 0x8e887e][(r + k * 3 + seed) % 4]!;
      b.add(W_, rb(0.26, courseH * 0.94, 0.48, 0.05), at(chx + off, yy, chz + (k ? 0.012 : -0.012) * flip, 0, (k - 0.5) * 0.06, 0), { tint: tone });
    }
  }
  const capY = ch0 + 7 * courseH;
  b.add(W_, rb(0.62, 0.08, 0.62, 0.025), at(chx, capY + 0.04, chz), { tint: 0x5e5a56 });
  b.add(W_, bevelCylinder(0.1, 0.12, 0.2, 0.02, 9), at(chx, capY + 0.08, chz), { tint: 0xb4643c });
  chimneyTops.push(new THREE.Vector3(cx + chx, y + capY + 0.3, cz + chz));
  // Door in the owner's colour: frame, planks, braces, brass knob
  const fz = D * 0.5 + 0.2;
  b.add(W_, rb(0.9, 1.32, 0.1, 0.03), at(0, base + 0.64, fz - 0.03), { tint: 0x4e3220 });
  b.add(W_, rb(0.72, 1.18, 0.08, 0.025), at(0, base + 0.6, fz + 0.01), { tint: accent });
  for (const dx of [-0.18, 0, 0.18]) b.add(W_, rb(0.012, 1.1, 0.012, 0.004), at(dx + 0.09, base + 0.6, fz + 0.055), { tint: accDark });
  for (const dy of [0.28, 0.92]) b.add(W_, rb(0.66, 0.08, 0.03, 0.01), at(0, base + dy, fz + 0.06), { tint: accDark });
  b.add(W_, new THREE.SphereGeometry(0.045, 8, 6), at(0.26, base + 0.58, fz + 0.09), { tint: 0xf0c850 });
  // Heart cut-out above the door (a warm touch)
  b.add(W_, rb(0.16, 0.14, 0.02, 0.06), at(0, base + 1.08, fz + 0.06, 0, 0, Math.PI / 4), { tint: 0x3a2214 });
  // Window (west of the door): lit card, muntins, shutters in the accent colour, flower box
  const wx = -0.88;
  const wy = base + 0.95;
  b.add(W_, rb(0.6, 0.56, 0.08, 0.02), at(wx, wy, fz - 0.06), { tint: 0x4e3220 });
  b.add('windowCard', new THREE.PlaneGeometry(0.46, 0.42), at(wx, wy, fz - 0.01));
  b.add(W_, rb(0.03, 0.44, 0.03, 0.01), at(wx, wy, fz + 0.01), { tint: 0x4e3220 });
  b.add(W_, rb(0.48, 0.03, 0.03, 0.01), at(wx, wy, fz + 0.01), { tint: 0x4e3220 });
  for (const s of [-1, 1]) b.add(W_, rb(0.2, 0.56, 0.04, 0.02), at(wx + s * 0.42, wy, fz - 0.02, 0, s * 0.25, 0), { tint: acc.clone().lerp(new THREE.Color(0xffffff), 0.15).getHex() });
  b.add(W_, rb(0.66, 0.15, 0.22, 0.03), at(wx, wy - 0.36, fz + 0.06), { tint: 0x8a5a34 });
  for (let i = 0; i < 5; i++) {
    const c = [0xf06a8a, 0xffd35a, 0xf5f0ff, 0xf09a4a, 0xb87ae0][(i + seed) % 5]!;
    b.add(W_, new THREE.SphereGeometry(0.065, 6, 4), at(wx - 0.24 + i * 0.12, wy - 0.24 + (i % 2) * 0.03, fz + 0.1), { tint: c });
    b.add(W_, new THREE.SphereGeometry(0.05, 5, 4), at(wx - 0.22 + i * 0.12, wy - 0.28, fz + 0.02), { tint: 0x5f9a3c });
  }
  // Porch lantern east of the door: a bracket, a cap + base and four corner posts around a glass that
  // glows with the lamps (r6: the housing box swallowed the glass — an unlit dark box at 10:30 pm).
  const lx = 0.62;
  const ly = base + 1.02;
  const lz = fz + 0.14;
  b.add(W_, rb(0.05, 0.05, 0.16, 0.01), at(lx, ly + 0.2, fz + 0.06), { tint: 0x3a3230 });
  b.add(W_, rb(0.2, 0.05, 0.2, 0.02), at(lx, ly + 0.11, lz), { tint: 0x3a3230 });
  b.add(W_, new THREE.ConeGeometry(0.12, 0.08, 4), at(lx, ly + 0.17, lz, 0, Math.PI / 4, 0), { tint: 0x3a3230 });
  b.add(W_, rb(0.17, 0.04, 0.17, 0.015), at(lx, ly - 0.1, lz), { tint: 0x3a3230 });
  for (const ox of [-1, 1]) for (const oz of [-1, 1]) b.add(W_, rb(0.022, 0.2, 0.022, 0.006), at(lx + ox * 0.07, ly, lz + oz * 0.07), { tint: 0x3a3230 });
  b.add('lampGlow', new THREE.BoxGeometry(0.12, 0.17, 0.12), at(lx, ly, lz));
  // Coffee on the porch: a little crate side-table by the step with a cream mug on it (handle out,
  // dark coffee inside) — readable from the farm camera as "someone left you a coffee".
  const tx = 1.02;
  const tz = D * 0.5 + 0.42;
  b.add(W_, rb(0.36, 0.34, 0.32, 0.03), at(tx, 0.17, tz, 0, 0.15, 0), { tint: 0xb98a58, ao: groundAO(0.18, 0.6) });
  b.add(W_, rb(0.38, 0.03, 0.34, 0.01), at(tx, 0.35, tz, 0, 0.15, 0), { tint: 0x8a5a34 });
  b.add(W_, bevelCylinder(0.07, 0.065, 0.13, 0.015, 12), at(tx - 0.03, 0.365, tz + 0.02), { tint: 0xf4ead8 });
  b.add(W_, new THREE.CylinderGeometry(0.058, 0.058, 0.01, 12), at(tx - 0.03, 0.485, tz + 0.02), { tint: 0x4a2a16 });
  b.add(W_, new THREE.TorusGeometry(0.04, 0.012, 5, 10), at(tx + 0.045, 0.43, tz + 0.02, 0, 0, 0), { tint: 0xf4ead8 });
  // Doorstep + mat
  b.add(W_, rb(1.15, 0.14, 0.52, 0.04), at(0, 0.07, D * 0.5 + 0.5), { tint: 0xa77a50, ao: groundAO(0.2, 0.7) });
  b.add(W_, rb(0.74, 0.02, 0.34, 0.01), at(0, 0.15, D * 0.5 + 0.52), { tint: acc.clone().lerp(new THREE.Color(0xf4e4c4), 0.55).getHex() });
  // Firewood stack along the east wall + a little barrel
  for (let i = 0; i < 6; i++) {
    const r = i < 3 ? 0 : i < 5 ? 1 : 2;
    const k = i < 3 ? i : i < 5 ? i - 3 : 0;
    b.add(W_, log(0.1, 0.62, 0.02, 8), at(W / 2 + 0.34, 0.11 + r * 0.19, -0.35 + k * 0.21 + r * 0.1, 0, 0, Math.PI / 2), { tint: 0xb88a5a });
  }
  b.add(W_, bevelCylinder(0.22, 0.2, 0.5, 0.04, 9), at(-W / 2 - 0.3, 0, D * 0.3), { tint: 0x8a5a34 });
}

export class Cabins {
  private group: THREE.Group | null = null;
  private key = '';
  /** A sleepy bubble drifting over the roof of every cabin whose farmhand has turned in (slot → bubble). */
  private zzz = new Map<number, { anchor: THREE.Object3D; bubble: EmoteBubble; on: boolean }>();
  private lamps: THREE.PointLight[] = [];
  /** A thin wisp from every cabin's chimney pot (1 draw each, only while the farm is on screen). */
  private smoke: SmokeEmitter[] = [];

  /**
   * Show the "asleep" bubble over each cabin in `sleeping` (slots), fade the rest. The bubble rides an
   * anchor just under the ridge (EmoteBubble lifts it above), so from the high camera it reads as
   * "someone's asleep in there" — the bedtime overlay names who; the farm shows where.
   */
  sleepers(map: GameMap | null, sleeping: Set<number>, dt: number, time: number, night = 0, viewH = 1080): void {
    const glow = globalUniforms.uLamps.value as number;
    for (const l of this.lamps) l.intensity = 6 * glow;
    if (map) for (const sm of this.smoke) sm.update(Math.min(dt, 0.1), night, viewH);
    for (const slot of sleeping) {
      const s = CABIN_SITES[slot];
      if (!s || !map || this.zzz.get(slot)?.on) continue;
      let z = this.zzz.get(slot);
      if (!z) {
        const anchor = new THREE.Object3D();
        anchor.name = 'cabin-zzz';
        z = { anchor, bubble: new EmoteBubble(anchor), on: false };
        this.zzz.set(slot, z);
      }
      z.anchor.position.set(s.x0 + 1.5 + 0.55, map.heightAt(s.x0 + 1.5, s.z0 + 1.5) + 0.75, s.z0 + 1.5);
      if (z.anchor.parent !== map.root) map.root.add(z.anchor);
      z.bubble.show('sleepy', 1e6);
      z.on = true;
    }
    for (const [slot, z] of this.zzz) {
      if (z.on && !sleeping.has(slot)) {
        z.on = false;
        z.bubble.show('sleepy', 0.3);
      }
      z.bubble.update(dt, time);
    }
  }

  /** Rebuild the cabins for `slots` (slot index → accent colour) on the farm map. */
  set(map: GameMap | null, slots: Map<number, number>): void {
    const key = [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([s, c]) => `${s}:${c}`).join(',');
    if (key === this.key && this.group?.parent === map?.root) return;
    this.key = key;
    if (this.group) {
      this.group.removeFromParent();
      this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.group = null;
    }
    if (!map || !slots.size) return;
    const b = new MeshBuilder();
    chimneyTops.length = 0;
    for (const [slot, accent] of slots) {
      const s = CABIN_SITES[slot];
      if (!s) continue;
      const cx = s.x0 + 1.5;
      const cz = s.z0 + 1.5;
      let y = Infinity;
      for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3], [1.5, 1.5]] as const) y = Math.min(y, map.heightAt(s.x0 + dx, s.z0 + dz));
      buildCabin(b, cx, y, cz, accent, slot);
    }
    this.group = b.build({ castShadow: true, receiveShadow: true, name: 'cabins' });
    // A real porch light per cabin (a warm pool on the doorstep + whoever stands there). Point lights
    // go through the renderer's light budget (constant count, nearest-the-view win), so this adds no
    // shader cost; intensity follows the lamps' dusk curve (uLamps) in sleepers().
    this.lamps = [];
    for (const slot of slots.keys()) {
      const s = CABIN_SITES[slot];
      if (!s) continue;
      const l = new THREE.PointLight(0xffb060, 0, 6.5, 1.3);
      l.position.set(s.x0 + 1.5 + 0.62, map.heightAt(s.x0 + 1.5, s.z0 + 1.5) + 1.45, s.z0 + 1.5 + 2.5 * 0.5 + 1.0);
      l.castShadow = false;
      this.group.add(l);
      this.lamps.push(l);
    }
    this.smoke = chimneyTops.map((p) => {
      const sm = new SmokeEmitter(p.clone(), 1.8, 28);
      this.group!.add(sm.object);
      return sm;
    });
    this.group.userData.perfTag = 'cabins';
    // Only the body and roof cast shadows (the glow cards are tiny).
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /windowCard|lampGlow|glass/.test(m.name)) m.castShadow = false;
    });
    map.root.add(this.group);
  }
}
