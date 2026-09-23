/**
 * Farmhand cabins: one cozy log cabin per extra player on the farm (slots 1-3), door painted in the
 * owner's accent colour. All cabins are merged into one builder (one draw per material in total).
 * Interacting with a cabin door = going to bed there.
 */
import * as THREE from 'three';
import { MeshBuilder, roundedBox, bevelCylinder, mat, groundAO } from '../world/geom';
import type { GameMap } from '../world/map';

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

// Materials: one tinted wood-grain mesh for the whole body, roof tiles, and the two night-glow
// materials (lit window, porch lamp) — 4 draws + 2 shadow draws for ALL cabins together.
const W_ = 'woodGrain';
/** A log centred on its own origin (bevelCylinder grows up from y = 0). */
const log = (r: number, len: number, bevel = 0.03, radial = 12): THREE.BufferGeometry => bevelCylinder(r, r, len, bevel, radial).translate(0, -len / 2, 0);

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
  b.add(W_, roundedBox(W + 0.34, base + 0.1, D + 0.34, 0.1), at(0, base / 2 - 0.02, 0), { tint: 0x9c968c, ao: groundAO(0.25, 0.6) });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + seed;
    b.add(W_, roundedBox(0.34, 0.16, 0.26, 0.07), at(Math.cos(a) * (W / 2 + 0.12), 0.1, Math.sin(a) * (D / 2 + 0.12), 0, a, 0), { tint: i % 2 ? 0xb0aa9e : 0x8e887e });
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
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(W_, new THREE.CylinderGeometry(lh * 0.46, lh * 0.46, 0.02, 12), at(sx * (W / 2 + 0.21), yy, sz * D * 0.5, 0, 0, Math.PI / 2), { tint: 0xf0cf98 });
  }
  b.add(W_, roundedBox(W - 0.12, wallH, D - 0.12, 0.04), at(0, base + wallH / 2, 0), { tint: 0x6a4428 });
  // Gable ends: vertical planks in a triangle
  const gh = 1.05;
  for (const sz of [-1, 1]) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5;
      const h = gh * (1 - Math.abs(u) * 2) + 0.04;
      b.add(W_, roundedBox(W / n + 0.01, h, 0.08, 0.015), at(u * W, top + h / 2, sz * (D * 0.5 - 0.02)), { tint: i % 2 ? 0xa87244 : 0x9a663c });
    }
  }
  // Roof: two tiled slabs with a deep overhang, a ridge log
  const pitch = Math.atan2(gh, W / 2);
  const slabW = Math.hypot(W / 2, gh) + 0.5;
  for (const sx of [-1, 1]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(cx + sx * (W / 4 + 0.16), y + top + gh / 2 + 0.12, cz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -sx * pitch)),
      new THREE.Vector3(1, 1, 1),
    );
    b.add('roofTile', roundedBox(slabW, 0.14, D + 0.9, 0.04), m, { tint: 0xd07052 });
  }
  b.add(W_, log(0.1, D + 1.0, 0.02, 10), at(0, top + gh + 0.2, 0, Math.PI / 2, 0, 0), { tint: 0x7a4e30 });
  // Chimney (stone) with a cap
  b.add(W_, roundedBox(0.44, 1.25, 0.44, 0.07), at(-W * 0.26, top + gh * 0.55, -D * 0.18), { tint: 0xa49e94 });
  b.add(W_, roundedBox(0.54, 0.1, 0.54, 0.03), at(-W * 0.26, top + gh * 0.55 + 0.64, -D * 0.18), { tint: 0x7e786e });
  // Door in the owner's colour: frame, planks, braces, brass knob
  const fz = D * 0.5 + 0.2;
  b.add(W_, roundedBox(0.9, 1.32, 0.1, 0.03), at(0, base + 0.64, fz - 0.03), { tint: 0x4e3220 });
  b.add(W_, roundedBox(0.72, 1.18, 0.08, 0.025), at(0, base + 0.6, fz + 0.01), { tint: accent });
  for (const dx of [-0.18, 0, 0.18]) b.add(W_, roundedBox(0.012, 1.1, 0.012, 0.004), at(dx + 0.09, base + 0.6, fz + 0.055), { tint: accDark });
  for (const dy of [0.28, 0.92]) b.add(W_, roundedBox(0.66, 0.08, 0.03, 0.01), at(0, base + dy, fz + 0.06), { tint: accDark });
  b.add(W_, new THREE.SphereGeometry(0.045, 8, 6), at(0.26, base + 0.58, fz + 0.09), { tint: 0xf0c850 });
  // Heart cut-out above the door (a warm touch)
  b.add(W_, roundedBox(0.16, 0.14, 0.02, 0.06), at(0, base + 1.08, fz + 0.06, 0, 0, Math.PI / 4), { tint: 0x3a2214 });
  // Window (west of the door): lit card, muntins, shutters in the accent colour, flower box
  const wx = -0.88;
  const wy = base + 0.95;
  b.add(W_, roundedBox(0.6, 0.56, 0.08, 0.02), at(wx, wy, fz - 0.06), { tint: 0x4e3220 });
  b.add('windowCard', new THREE.PlaneGeometry(0.46, 0.42), at(wx, wy, fz - 0.01));
  b.add(W_, roundedBox(0.03, 0.44, 0.03, 0.01), at(wx, wy, fz + 0.01), { tint: 0x4e3220 });
  b.add(W_, roundedBox(0.48, 0.03, 0.03, 0.01), at(wx, wy, fz + 0.01), { tint: 0x4e3220 });
  for (const s of [-1, 1]) b.add(W_, roundedBox(0.2, 0.56, 0.04, 0.02), at(wx + s * 0.42, wy, fz - 0.02, 0, s * 0.25, 0), { tint: acc.clone().lerp(new THREE.Color(0xffffff), 0.15).getHex() });
  b.add(W_, roundedBox(0.66, 0.15, 0.22, 0.03), at(wx, wy - 0.36, fz + 0.06), { tint: 0x8a5a34 });
  for (let i = 0; i < 5; i++) {
    const c = [0xf06a8a, 0xffd35a, 0xf5f0ff, 0xf09a4a, 0xb87ae0][(i + seed) % 5]!;
    b.add(W_, new THREE.SphereGeometry(0.065, 8, 6), at(wx - 0.24 + i * 0.12, wy - 0.24 + (i % 2) * 0.03, fz + 0.1), { tint: c });
    b.add(W_, new THREE.SphereGeometry(0.05, 6, 5), at(wx - 0.22 + i * 0.12, wy - 0.28, fz + 0.02), { tint: 0x5f9a3c });
  }
  // Porch lamp east of the door
  b.add(W_, roundedBox(0.05, 0.28, 0.05, 0.01), at(0.62, base + 1.18, fz + 0.02), { tint: 0x3a3230 });
  b.add(W_, roundedBox(0.17, 0.22, 0.17, 0.03), at(0.62, base + 1.02, fz + 0.12), { tint: 0x3a3230 });
  b.add('lampGlow', new THREE.SphereGeometry(0.065, 10, 8), at(0.62, base + 1.0, fz + 0.12));
  // Doorstep + mat
  b.add(W_, roundedBox(1.15, 0.14, 0.52, 0.04), at(0, 0.07, D * 0.5 + 0.5), { tint: 0xa77a50, ao: groundAO(0.2, 0.7) });
  b.add(W_, roundedBox(0.74, 0.02, 0.34, 0.01), at(0, 0.15, D * 0.5 + 0.52), { tint: acc.clone().lerp(new THREE.Color(0xf4e4c4), 0.55).getHex() });
  // Firewood stack along the east wall + a little barrel
  for (let i = 0; i < 6; i++) {
    const r = i < 3 ? 0 : i < 5 ? 1 : 2;
    const k = i < 3 ? i : i < 5 ? i - 3 : 0;
    b.add(W_, log(0.1, 0.62, 0.02, 8), at(W / 2 + 0.34, 0.11 + r * 0.19, -0.35 + k * 0.21 + r * 0.1, 0, 0, Math.PI / 2), { tint: 0xb88a5a });
  }
  b.add(W_, bevelCylinder(0.22, 0.2, 0.5, 0.04, 12), at(-W / 2 - 0.3, 0, D * 0.3), { tint: 0x8a5a34 });
}

export class Cabins {
  private group: THREE.Group | null = null;
  private key = '';

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
    this.group.userData.perfTag = 'cabins';
    // Only the body and roof cast shadows (the glow cards are tiny).
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /windowCard|lampGlow|glass/.test(m.name)) m.castShadow = false;
    });
    map.root.add(this.group);
  }
}
