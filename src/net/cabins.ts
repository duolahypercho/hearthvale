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
  // Gable ends: one board-and-batten triangle each (a prism + 3 battens: ~60 tris, not 14 planks).
  const gh = 1.05;
  const tri = new THREE.Shape();
  tri.moveTo(-W / 2, 0);
  tri.lineTo(W / 2, 0);
  tri.lineTo(0, gh + 0.04);
  tri.closePath();
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.08, bevelEnabled: false, curveSegments: 1 });
  gable.translate(0, 0, -0.04);
  for (const sz of [-1, 1]) {
    b.add(W_, gable, at(0, top, sz * (D * 0.5 - 0.02)), { tint: 0xa06c40 });
    for (const u of [-0.27, 0, 0.27]) {
      const h = gh * (1 - Math.abs(u) * 2) * 0.92;
      b.add(W_, rb(0.06, h, 0.04, 0.012), at(u * W, top + h / 2, sz * (D * 0.5 + 0.03)), { tint: 0x8a5a34 });
    }
  }
  // Roof: each side is ONE pitched plane laid on the gable line — a continuous deck board, then
  // shingle courses lying flush on that same plane (eave course first, each higher course a hair
  // proud so its butt edge throws a thin shadow line), a fascia board along the eave, barge boards
  // up both gables and a ridge cap. Everything shares the side's transform, so nothing splays.
  const pitch = Math.atan2(gh, W / 2);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const rake = Math.hypot(W / 2, gh);
  const over = 0.42; // eave overhang along the slope
  const t0 = -0.06; // a touch past the ridge so the two decks meet under the cap
  const t1 = rake + over;
  const deckT = 0.09;
  const roofD = D + 0.86;
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
      const tone = r % 2 ? 0xc4604a : 0xd27456;
      b.add(W_, rb(courseW * 1.18, 0.06, roofD - 0.04, 0.025), onRoof(sx, tc, n, 0), { tint: tone });
    }
    // Fascia along the eave (a pale painted board standing square to the slope)
    b.add(W_, rb(0.06, 0.2, roofD + 0.04, 0.02), onRoof(sx, t1 + 0.01, deckT / 2 + 0.02, 0), { tint: 0xe8d8b8 });
    // Barge boards up each gable end, just proud of the deck edge
    for (const sz of [-1, 1]) b.add(W_, rb(t1 - t0 + 0.04, 0.2, 0.06, 0.02), onRoof(sx, (t0 + t1) / 2, deckT / 2 + 0.02, sz * (roofD / 2 + 0.02)), { tint: 0xe8d8b8 });
  }
  // Ridge cap: a rounded log saddled over both decks
  b.add(W_, log(0.11, roofD + 0.1, 0.02, 10), at(0, top + gh + deckT + 0.1, 0, Math.PI / 2, 0, 0), { tint: 0x8e4a32 });
  // Chimney (stone) with a cap
  b.add(W_, rb(0.44, 1.25, 0.44, 0.07), at(-W * 0.26, top + gh * 0.55, -D * 0.18), { tint: 0xa49e94 });
  b.add(W_, rb(0.54, 0.1, 0.54, 0.03), at(-W * 0.26, top + gh * 0.55 + 0.64, -D * 0.18), { tint: 0x7e786e });
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
  // Porch lamp east of the door
  b.add(W_, rb(0.05, 0.28, 0.05, 0.01), at(0.62, base + 1.18, fz + 0.02), { tint: 0x3a3230 });
  b.add(W_, rb(0.17, 0.22, 0.17, 0.03), at(0.62, base + 1.02, fz + 0.12), { tint: 0x3a3230 });
  b.add('windowCard', new THREE.BoxGeometry(0.12, 0.15, 0.12), at(0.62, base + 1.02, fz + 0.12));
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

  /**
   * Show the "asleep" bubble over each cabin in `sleeping` (slots), fade the rest. The bubble rides an
   * anchor just under the ridge (EmoteBubble lifts it above), so from the high camera it reads as
   * "someone's asleep in there" — the bedtime overlay names who; the farm shows where.
   */
  sleepers(map: GameMap | null, sleeping: Set<number>, dt: number, time: number): void {
    const glow = globalUniforms.uLamps.value as number;
    for (const l of this.lamps) l.intensity = 6 * glow;
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
    this.group.userData.perfTag = 'cabins';
    // Only the body and roof cast shadows (the glow cards are tiny).
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /windowCard|lampGlow|glass/.test(m.name)) m.castShadow = false;
    });
    map.root.add(this.group);
  }
}
