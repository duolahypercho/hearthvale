/**
 * StoryWorldSystem: the valley's story dressing and the world beats of the cutscenes.
 *
 *   coach        the evening valley coach (sage + cream, roof rack of luggage, warm windows and
 *                headlamps) that brings you to Hearthvale: `coach:place` / `coach:arrive` / `coach:leave`
 *   restorations what each relit room gives back to the town — the Blossom Arch over the Hall steps,
 *                Market Day stalls, harvest lanterns along the west road, a smoking Hall chimney,
 *                flower baskets on the plaza lamps, glowing koi + candle lilies in the fountain.
 *                Visible once a room is restored; `town:restore` hides it for the reveal, `town:reveal`
 *                grows it in with a sparkle burst.
 *   Hall lantern the great lantern over the Hall doors glows brighter with every room lit.
 *   festival     `festival:on` dresses the square, `festival:greatLantern` flares the Hall lantern,
 *                `festival:skyLanterns` releases a sky full of paper lanterns (one instanced draw).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { MeshBuilder, roundedBox, bevelCylinder, lumpySphere, mat, mergeStatic } from '../world/geom';
import { materials } from '../render/materials';
import { buildMarketStall } from '../world/props/townkit';
import { buildLanternPole } from '../world/props/festival';
import { BurstFX, SmokeEmitter } from '../render/particles';
import { Rng } from '../core/rng';
import { ROOMS, type RoomId } from '../data/bundles';

const STOP = { x: 9.6, z: 26.2 };
const COACH_PARK = { x: STOP.x - 2.2, z: STOP.z - 0.7 };
const HALL_LANTERN = new THREE.Vector3(32, 3.35, 12.7);
const PLAZA = { x: 32, z: 25 };

// ─────────────────────────────────────────────── coach

/** Four lamp-lit coach windows on one canvas strip (curtains, a warm ceiling lamp, passengers' heads). */
let COACH_WIN: THREE.MeshStandardMaterial | null = null;
function coachWindowMaterial(): THREE.MeshStandardMaterial {
  if (COACH_WIN) return COACH_WIN;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  const heads = [[0.62, 0x3a2a24], [0.3, 0x6a4a2a], null, [0.5, 0x2a2a3a]] as const;
  for (let k = 0; k < 4; k++) {
    const x0 = k * 128;
    const bg = g.createRadialGradient(x0 + 64, 20, 4, x0 + 64, 40, 90);
    bg.addColorStop(0, '#ffe2a8');
    bg.addColorStop(0.55, '#f0a860');
    bg.addColorStop(1, '#8a4a2a');
    g.fillStyle = bg;
    g.fillRect(x0, 0, 128, 96);
    // Seat backs along the bottom.
    g.fillStyle = '#7a3a2e';
    g.beginPath();
    g.roundRect(x0 + 10, 66, 108, 40, 10);
    g.fill();
    // A passenger's head + shoulders (silhouette against the lamp).
    const h = heads[k];
    if (h) {
      const hx = x0 + 128 * h[0];
      g.fillStyle = `#${h[1].toString(16).padStart(6, '0')}`;
      g.beginPath();
      g.ellipse(hx, 60, 15, 17, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.roundRect(hx - 26, 72, 52, 40, 14);
      g.fill();
    }
    // Gathered curtains at both sides + a pelmet.
    for (const side of [0, 1]) {
      const cx = side ? x0 + 128 : x0;
      const grd = g.createLinearGradient(cx, 0, side ? cx - 30 : cx + 30, 0);
      grd.addColorStop(0, '#b8463a');
      grd.addColorStop(1, '#e0705a');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(cx, 0);
      g.lineTo(side ? cx - 34 : cx + 34, 0);
      g.quadraticCurveTo(side ? cx - 14 : cx + 14, 50, side ? cx - 22 : cx + 22, 96);
      g.lineTo(cx, 96);
      g.fill();
    }
    g.fillStyle = '#8a3a30';
    g.fillRect(x0, 0, 128, 9);
    // Mullion.
    g.fillStyle = 'rgba(60,40,28,0.9)';
    g.fillRect(x0 + 62, 0, 4, 96);
    g.fillStyle = 'rgba(40,24,14,0.95)';
    g.fillRect(x0, 0, 3, 96);
    g.fillRect(x0 + 125, 0, 3, 96);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  COACH_WIN = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0 });
  COACH_WIN.name = 'coach-window';
  return COACH_WIN;
}

function buildCoach(): { group: THREE.Group; wheels: THREE.Object3D[] } {
  const b = new MeshBuilder();
  const L = 4.6;
  const W = 1.9;
  const SAGE = 0x6f9a7a;
  const CREAM = 0xf3e6c8;
  // Chassis + body: sage lower half, cream upper, rounded everything.
  b.add('white', roundedBox(L, 0.95, W, 0.28), mat(0, 0.95, 0), { tint: SAGE });
  b.add('white', roundedBox(L - 0.1, 0.85, W - 0.06, 0.3), mat(-0.05, 1.8, 0), { tint: CREAM });
  b.add('white', roundedBox(L - 0.3, 0.18, W - 0.2, 0.09), mat(-0.1, 2.3, 0), { tint: 0xe8d8b4 });
  b.add('white', roundedBox(L + 0.04, 0.1, W + 0.04, 0.04), mat(0, 1.45, 0), { tint: 0xc8573e }); // red waist stripe
  b.add('white', roundedBox(0.5, 0.55, W - 0.3, 0.2), mat(L / 2 - 0.05, 0.85, 0), { tint: SAGE }); // snout
  b.add('metal', roundedBox(0.12, 0.35, 1.1, 0.04), mat(L / 2 + 0.2, 0.85, 0), { tint: 0xd8dde4 }); // grille
  for (let k = 0; k < 5; k++) b.add('metal', roundedBox(0.03, 0.3, 0.02, 0.01), mat(L / 2 + 0.27, 0.85, -0.4 + k * 0.2), { tint: 0x8a9098 });
  b.add('metal', roundedBox(0.16, 0.12, W + 0.1, 0.05), mat(L / 2 + 0.2, 0.52, 0), { tint: 0xd8dde4 }); // bumper
  b.add('metal', roundedBox(0.16, 0.12, W + 0.1, 0.05), mat(-L / 2 - 0.08, 0.52, 0), { tint: 0xd8dde4 });
  // Windows: a row down each side + windscreen. Side windows are painted cards (lamp-lit interior,
  // gathered curtains, a passenger or two) framed in dark trim, so they read as rooms, not white slabs.
  const win = coachWindowMaterial();
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const x = -1.55 + k * 0.86;
      b.add('white', roundedBox(0.8, 0.58, 0.04, 0.05), mat(x, 1.86, sz * (W / 2 - 0.035)), { tint: 0x4a3a2c });
      const card = new THREE.PlaneGeometry(0.7, 0.48);
      const u0 = (k % 4) / 4;
      const uv = card.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) / 4);
      b.add(win, card, mat(x, 1.86, sz * (W / 2 + 0.002), 0, sz > 0 ? 0 : Math.PI, 0));
      b.add('white', roundedBox(0.76, 0.05, 0.08, 0.02), mat(x, 1.6, sz * (W / 2 + 0.01)), { tint: 0x4a3a2c }); // sill
    }
  }
  b.add('glass', roundedBox(0.04, 0.5, W - 0.5, 0.06), mat(L / 2 - 0.02, 1.86, 0));
  // Door (south side, towards the front).
  b.add('white', roundedBox(0.66, 1.3, 0.05, 0.04), mat(1.2, 1.12, W / 2 + 0.01), { tint: 0x5a8a6a });
  const doorWin = new THREE.PlaneGeometry(0.46, 0.4);
  const duv = doorWin.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < duv.count; i++) duv.setX(i, 0.5 + duv.getX(i) / 4);
  b.add(win, doorWin, mat(1.2, 1.52, W / 2 + 0.045));
  b.add('metal', roundedBox(0.08, 0.04, 0.05, 0.01), mat(0.98, 1.1, W / 2 + 0.05), { tint: 0xe8b84a });
  b.add('white', roundedBox(0.7, 0.1, 0.5, 0.04), mat(1.2, 0.36, W / 2 + 0.1), { tint: 0x4a4a4a }); // step
  // Headlamps + tail lamps.
  for (const sz of [-0.62, 0.62]) {
    b.add('metal', new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14).rotateZ(Math.PI / 2), mat(L / 2 + 0.25, 1.1, sz), { tint: 0xd8dde4 });
    b.add('lampGlow', new THREE.CylinderGeometry(0.13, 0.13, 0.04, 14).rotateZ(Math.PI / 2), mat(L / 2 + 0.31, 1.1, sz));
    b.add('lampGlow', roundedBox(0.04, 0.12, 0.2, 0.02), mat(-L / 2 - 0.03, 0.95, sz), { tint: 0xff6a4a });
  }
  // Roof rack with luggage.
  for (const sz of [-0.7, 0.7]) b.add('metal', roundedBox(3.0, 0.05, 0.05, 0.02), mat(-0.3, 2.5, sz), { tint: 0x5a554f });
  for (let k = 0; k < 4; k++) b.add('metal', roundedBox(0.05, 0.12, 1.45, 0.02), mat(-1.6 + k * 0.9, 2.44, 0), { tint: 0x5a554f });
  b.add('wood', roundedBox(0.9, 0.42, 0.7, 0.06), mat(-1.2, 2.72, -0.2), { tint: 0x8a5a36 });
  b.add('white', roundedBox(0.7, 0.3, 0.5, 0.08), mat(-0.3, 2.66, 0.3), { tint: 0xc8573e });
  b.add('white', roundedBox(0.55, 0.36, 0.42, 0.08), mat(0.5, 2.68, -0.25), { tint: 0x3f76a8 });
  b.add('white', roundedBox(0.12, 0.03, 0.44, 0.01), mat(0.5, 2.87, -0.25), { tint: 0x2a2a2a });
  // Destination board over the windscreen.
  b.add('white', roundedBox(0.06, 0.24, 1.2, 0.03), mat(L / 2 - 0.05, 2.28, 0), { tint: 0x2a2a2a });
  b.add('lampGlow', roundedBox(0.03, 0.14, 1.05, 0.02), mat(L / 2 - 0.01, 2.28, 0), { tint: 0xffd08a });
  const group = b.build({ name: 'coach' });
  // Wheels (separate so they can spin).
  const wheels: THREE.Object3D[] = [];
  const wb = new MeshBuilder();
  wb.add('white', bevelCylinder(0.42, 0.42, 0.3, 0.06, 18).rotateX(Math.PI / 2), undefined, { tint: 0x2a2624 });
  wb.add('metal', bevelCylinder(0.22, 0.22, 0.32, 0.03, 14).rotateX(Math.PI / 2), undefined, { tint: 0xd8dde4 });
  wb.add('metal', new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8).rotateX(Math.PI / 2), undefined, { tint: 0xc8573e });
  const wheel = wb.build({ name: 'coach-wheel' });
  for (const [x, z] of [[1.45, -0.86], [1.45, 0.86], [-1.45, -0.86], [-1.45, 0.86]] as const) {
    const w = wheel.clone();
    w.position.set(x, 0.42, z);
    group.add(w);
    wheels.push(w);
  }
  // Mudguards.
  for (const [x, z] of [[1.45, -0.9], [1.45, 0.9], [-1.45, -0.9], [-1.45, 0.9]] as const) {
    const arch = new THREE.TorusGeometry(0.5, 0.08, 6, 14, Math.PI);
    const m = new THREE.Mesh(arch, materials.get('white'));
    m.position.set(x, 0.45, z);
    (m.geometry as THREE.BufferGeometry).setAttribute('color', new THREE.Float32BufferAttribute(new Array(arch.attributes.position!.count * 3).fill(0.42), 3));
    m.castShadow = true;
    group.add(m);
  }
  group.traverse((o) => (o.userData.dynamic = true));
  return { group, wheels };
}

// ─────────────────────────────────────────────── restorations

function buildBlossomArch(r: Rng): THREE.Group {
  const b = new MeshBuilder();
  const cx = 32;
  const cz = 14.55;
  const span = 1.95;
  for (const sx of [-1, 1]) {
    b.add('wood', roundedBox(0.16, 2.6, 0.16, 0.04), mat(cx + sx * span, 1.3, cz), { tint: 0xf2ead8 });
    b.add('stone', roundedBox(0.36, 0.2, 0.36, 0.05), mat(cx + sx * span, 0.1, cz), { tint: 0xc8c0b2 });
    // planter at the foot
    b.add('soilPot', bevelCylinder(0.3, 0.24, 0.42, 0.04, 12), mat(cx + sx * (span + 0.55), 0.21, cz + 0.3), { tint: 0xc8704a });
    for (let k = 0; k < 7; k++) b.add('boxFlower', lumpySphere(0.12, 0, 0.2, r), mat(cx + sx * (span + 0.55) + (r.next() - 0.5) * 0.4, 0.5 + r.next() * 0.1, cz + 0.3 + (r.next() - 0.5) * 0.4), { tint: [0xff8fab, 0xffffff, 0xffc0d0][k % 3] });
  }
  const arc = new THREE.TorusGeometry(span, 0.08, 6, 24, Math.PI);
  b.add('wood', arc, mat(cx, 2.6, cz), { tint: 0xf2ead8 });
  // Blossom clusters climbing the posts and crowding the arch.
  for (let k = 0; k < 70; k++) {
    const t = r.next();
    let x: number;
    let y: number;
    if (t < 0.55) {
      const a = r.next() * Math.PI;
      x = cx + Math.cos(a) * span;
      y = 2.6 + Math.sin(a) * span;
    } else {
      const sx = r.next() < 0.5 ? -1 : 1;
      x = cx + sx * span;
      y = 0.4 + r.next() * 2.2;
    }
    const leafy = r.next() < 0.35;
    b.add('boxFlower', lumpySphere(0.14 + r.next() * 0.1, 1, 0.22, r), mat(x + (r.next() - 0.5) * 0.25, y + (r.next() - 0.5) * 0.2, cz + (r.next() - 0.5) * 0.3), { tint: leafy ? [0x4f8a34, 0x5a9a3a][k % 2]! : [0xff9ec0, 0xffc0d4, 0xffffff, 0xff7aa2][k % 4]! });
  }
  // A string of warm fairy bulbs threaded through the blossoms (glow after dusk).
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI;
    const sag = 0.12 * Math.sin(a * 8);
    b.add('lampGlow', new THREE.SphereGeometry(0.045, 8, 6), mat(cx + Math.cos(a) * (span - 0.05), 2.6 + Math.sin(a) * (span - 0.05) - 0.1 + sag * 0.3, cz + 0.2));
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) b.add('lampGlow', new THREE.SphereGeometry(0.045, 8, 6), mat(cx + sx * (span + 0.1), 0.6 + k * 0.36, cz + 0.16 * (k % 2 ? 1 : -1)));
  const g = b.build({ name: 'restore-seed' });
  return g;
}

function buildMarket(r: Rng): THREE.Group {
  const g = new THREE.Group();
  const spots: [number, number, number, number, number][] = [
    [22.4, 28.6, 0.75, 0xe8574a, 0xf6ecd8],
    [41.4, 27.6, -0.75, 0xf2c43a, 0xf6ecd8],
  ];
  for (const [x, z, rot, a, c] of spots) {
    const s = buildMarketStall(r, [a, c]);
    s.position.set(x, 0, z);
    s.rotation.y = rot;
    g.add(s);
  }
  // Produce crates + baskets in front of the stalls.
  const b = new MeshBuilder();
  for (const [x, z, rot] of spots) {
    for (let k = 0; k < 3; k++) {
      const ox = Math.cos(rot) * (k - 1) * 0.7 + Math.sin(rot) * 1.0;
      const oz = -Math.sin(rot) * (k - 1) * 0.7 + Math.cos(rot) * 1.0;
      b.add('wood', roundedBox(0.55, 0.3, 0.42, 0.03), mat(x + ox, 0.15, z + oz, 0, rot, 0), { tint: 0xb8864f });
      const col = [0xe4432e, 0xf2c43a, 0x8ac44a, 0xe8812e][(k + Math.round(x)) % 4]!;
      for (let q = 0; q < 6; q++) b.add('boxFlower', new THREE.SphereGeometry(0.08, 8, 6), mat(x + ox + (r.next() - 0.5) * 0.36, 0.34, z + oz + (r.next() - 0.5) * 0.26), { tint: col });
    }
  }
  g.add(b.build({ name: 'market-produce' }));
  return g;
}

/** mergeStatic, keeping whatever it can't merge (swaying cloth etc.) in the returned group. */
function mergeKeep(g: THREE.Group, name: string): THREE.Group {
  const out = mergeStatic([g], name);
  for (const c of [...g.children]) {
    let meshes = 0;
    c.traverse((o) => ((o as THREE.Mesh).isMesh ? meshes++ : 0));
    if (meshes) out.add(c);
  }
  return out;
}

function buildRoadLanterns(r: Rng, heightAt: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group();
  const pts: [number, number][] = [
    [4.5, 24.2], [8.5, 28.3], [12.5, 24.4], [16.5, 28.0], [20.5, 23.9],
  ];
  pts.forEach(([x, z], i) => {
    const p = buildLanternPole(r, i + 2);
    p.position.set(x, heightAt(x, z) - 0.03, z);
    p.rotation.y = z < 26 ? 0 : Math.PI;
    g.add(p);
  });
  return g;
}

function buildChimney(): THREE.Group {
  const b = new MeshBuilder();
  // Stone chimney stack rising from the Hall roof (right side, behind the ridge).
  b.add('stone', roundedBox(0.9, 2.2, 0.9, 0.06), mat(35.4, 6.6, 7.4), { tint: 0xc8bca8 });
  b.add('stone', roundedBox(1.1, 0.2, 1.1, 0.05), mat(35.4, 7.75, 7.4), { tint: 0xb0a492 });
  b.add('soilPot', bevelCylinder(0.16, 0.18, 0.4, 0.03, 10), mat(35.25, 8.05, 7.3), { tint: 0xb8643e });
  b.add('soilPot', bevelCylinder(0.14, 0.16, 0.34, 0.03, 10), mat(35.6, 8.02, 7.5), { tint: 0xa8583a });
  return b.build({ name: 'restore-hearth' });
}

function buildBaskets(r: Rng, heightAt: (x: number, z: number) => number): THREE.Group {
  const b = new MeshBuilder();
  for (const deg of [30, 150, 210, 330]) {
    const a = (deg * Math.PI) / 180;
    const px = PLAZA.x + Math.cos(a) * 7.6;
    const pz = PLAZA.z + Math.sin(a) * 7.6;
    const y0 = heightAt(px, pz);
    // Hang from a little bracket on the plaza side of the post.
    const dx = -Math.cos(a) * 0.5;
    const dz = -Math.sin(a) * 0.5;
    b.add('metal', roundedBox(0.04, 0.04, 0.55, 0.01), mat(px + dx / 2, y0 + 1.95, pz + dz / 2, 0, Math.atan2(dx, dz), 0), { tint: 0x2e2a28 });
    b.add('metal', new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4), mat(px + dx, y0 + 1.8, pz + dz), { tint: 0x2e2a28 });
    b.add('wood', bevelCylinder(0.24, 0.16, 0.2, 0.03, 12), mat(px + dx, y0 + 1.58, pz + dz), { tint: 0xa8743f });
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      const trail = k % 3 === 0 ? 0.2 + r.next() * 0.25 : 0;
      b.add('boxFlower', lumpySphere(0.08 + r.next() * 0.04, 0, 0.2, r), mat(px + dx + Math.cos(t) * 0.22, y0 + 1.66 - trail, pz + dz + Math.sin(t) * 0.22), { tint: trail ? 0x4f8a34 : [0xff7aa2, 0xffffff, 0xc77dff, 0xffd166][k % 4]! });
    }
  }
  return b.build({ name: 'restore-craft' });
}

class Koi {
  readonly group = new THREE.Group();
  /** Six fish in one instanced draw; lily pads + floating candles merged into two static meshes. */
  private fish: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private mat = new THREE.MeshStandardMaterial({ color: 0xffb070, emissive: 0xff8a3a, emissiveIntensity: 1.2, roughness: 0.4 });
  private lilyMat = new THREE.MeshStandardMaterial({ color: 0x4f8a3a, roughness: 0.7 });
  private candleMat = new THREE.MeshStandardMaterial({ color: 0xfff2dc, emissive: 0xffb050, emissiveIntensity: 2.6 });
  private t = 0;
  constructor(private y: number) {
    const body = new THREE.SphereGeometry(0.16, 10, 8);
    body.scale(1, 0.45, 2.2);
    const tail = new THREE.ConeGeometry(0.12, 0.22, 4);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0, -0.42);
    const fishGeo = mergeGeometries([body.toNonIndexed(), tail.toNonIndexed()])!;
    this.fish = new THREE.InstancedMesh(fishGeo, this.mat, 6);
    this.fish.userData.noAO = true;
    this.fish.frustumCulled = false;
    this.group.add(this.fish);
    const r = new Rng('koi-lilies');
    const b = new MeshBuilder();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const rad = 1.25 + r.next() * 0.35;
      const px = PLAZA.x + Math.cos(a) * rad;
      const pz = PLAZA.z + Math.sin(a) * rad;
      b.add(this.lilyMat, new THREE.CircleGeometry(0.2, 12, 0.3, Math.PI * 1.8).rotateX(-Math.PI / 2), mat(px, y + 0.02, pz));
      b.add(this.candleMat, new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8), mat(px, y + 0.08, pz));
    }
    const statics = b.build({ name: 'koi-lilies' });
    statics.traverse((o) => (o.castShadow = false));
    this.group.add(statics);
    this.group.name = 'restore-tide';
  }
  update(dt: number, night: number): void {
    this.t += dt;
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      const a = this.t * (0.35 + i * 0.04) * dir + i * 1.3;
      const rad = 1.05 + (i % 3) * 0.28;
      const f = this.tmp;
      f.position.set(PLAZA.x + Math.cos(a) * rad, this.y - 0.05 + Math.sin(this.t * 2 + i) * 0.02, PLAZA.z + Math.sin(a) * rad);
      f.rotation.set(0, -a + (dir > 0 ? 0 : Math.PI), Math.sin(this.t * 6 + i) * 0.15);
      f.updateMatrix();
      this.fish.setMatrixAt(i, f.matrix);
    }
    this.fish.instanceMatrix.needsUpdate = true;
    this.mat.emissiveIntensity = 0.6 + night * 1.6;
    this.candleMat.emissiveIntensity = (0.8 + night * 2.2) * (0.9 + Math.sin(this.t * 9) * 0.06);
  }
}

// ─────────────────────────────────────────────── sky lanterns

class SkyLanterns {
  readonly mesh: THREE.InstancedMesh;
  private n = 90;
  private data: { x: number; y: number; z: number; v: number; ph: number; s: number; t0: number }[] = [];
  private tmp = new THREE.Object3D();
  active = false;
  private t = 0;
  constructor() {
    const g = new THREE.CylinderGeometry(0.16, 0.12, 0.34, 8);
    const m = new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xff9a3a, emissiveIntensity: 3.2, roughness: 0.6 });
    this.mesh = new THREE.InstancedMesh(g, m, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.userData.noAO = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'sky-lanterns';
    const r = new Rng('sky-lanterns');
    for (let i = 0; i < this.n; i++) {
      const a = r.next() * Math.PI * 2;
      const rad = 2 + r.next() * 16;
      this.data.push({ x: PLAZA.x + Math.cos(a) * rad, y: 1 + r.next() * 0.5, z: PLAZA.z - 4 + Math.sin(a) * rad * 0.7, v: 0.45 + r.next() * 0.55, ph: r.next() * 10, s: 0.8 + r.next() * 0.5, t0: r.next() * 5 });
      this.mesh.setColorAt(i, new THREE.Color().setHSL(0.06 + r.next() * 0.06, 0.9, 0.6 + r.next() * 0.15));
    }
  }
  start(prewarm = 0): void {
    this.active = true;
    this.t = prewarm;
    this.mesh.count = this.n;
    this.update(0);
  }
  stop(): void {
    this.active = false;
    this.mesh.count = 0;
  }
  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    this.data.forEach((d, i) => {
      const t = Math.max(0, this.t - d.t0);
      const y = d.y + t * d.v;
      this.tmp.position.set(d.x + Math.sin(t * 0.4 + d.ph) * 0.6 + t * 0.12, y, d.z + Math.cos(t * 0.3 + d.ph) * 0.4 - t * 0.08);
      this.tmp.rotation.set(Math.sin(t + d.ph) * 0.12, t * 0.2, Math.cos(t * 0.8 + d.ph) * 0.12);
      const s = t > 0 ? d.s * Math.min(1, t * 2) : 0;
      this.tmp.scale.setScalar(s * (y > 26 ? Math.max(0, 1 - (y - 26) / 8) : 1));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ─────────────────────────────────────────────── system

interface Anim {
  obj: THREE.Object3D;
  t: number;
  dur: number;
}

export class StoryWorldSystem implements System {
  readonly name = 'story-world';
  private game!: Game;
  private coach: { group: THREE.Group; wheels: THREE.Object3D[] } | null = null;
  private coachMove: { from: number; to: number; t: number; dur: number; leave: boolean } | null = null;
  private restore = new Map<RoomId, THREE.Object3D>();
  private hidden = new Set<RoomId>();
  private built: THREE.Object3D | null = null;
  private koi: Koi | null = null;
  private smoke: SmokeEmitter | null = null;
  private burst = new BurstFX(360);
  private sky = new SkyLanterns();
  private hallGlow = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.3 });
  private hallLight = new THREE.PointLight(0xffb45e, 0, 10, 1.6);
  private hallFlare = 0;
  private anims: Anim[] = [];
  private festivalLit = false;
  /** Finale on the Glimmerco path: the EverGlow is switched off and the Hall burns warm again. */
  private everglowOff = false;
  private dim = 0;

  init(game: Game): void {
    this.game = game;
    this.burst.object.userData.noAO = true;
    game.events.on('map:change', ({ map }) => this.onMap(map));
    game.events.on('quest:room', () => this.refresh());
    game.events.on('quest:sync', () => this.refresh());
    game.events.on('quest:hallRestored', () => this.refresh());
    game.events.on('demo:stage', ({ showcase }) => {
      this.festivalLit = showcase.includes('story:festival');
      this.hidden.clear();
      if (!showcase.includes('story:festival')) this.sky.stop();
      this.refresh();
    });
    game.events.on('cutscene:end', () => {
      this.hidden.clear();
      this.refresh();
    });
    game.events.on('cutscene:cue', ({ cue, arg, instant }) => this.cue(cue, arg, instant));
  }

  private onMap(map: string): void {
    if (map !== 'town') return;
    const town = this.game.world.current;
    if (!town) return;
    if (!this.built) this.buildTown();
    town.root.add(this.built!);
    this.refresh();
  }

  private buildTown(): void {
    const town = this.game.world.current!;
    const r = new Rng('story-world');
    const H = (x: number, z: number): number => town.heightAt(x, z);
    const root = new THREE.Group();
    root.name = 'story-world';
    root.userData.perfTag = 'story';
    const place = (id: RoomId, o: THREE.Object3D, y = 0): void => {
      o.position.y += y;
      root.add(o);
      this.restore.set(id, o);
    };
    place('seed', buildBlossomArch(r), H(32, 14.55) - 0.02);
    const market = buildMarket(r);
    market.children.forEach((c) => {
      if (c.name !== 'market-produce') c.position.y = H(c.position.x, c.position.z) - 0.03;
    });
    market.getObjectByName('market-produce')!.position.y = H(31.5, 28) - 0.02;
    // Kit props arrive as many small meshes: merge each restoration by material (render budget).
    place('sun', mergeKeep(market, 'restore-sun'));
    place('harvest', mergeKeep(buildRoadLanterns(r, H), 'restore-harvest'));
    const chimney = new THREE.Group();
    chimney.add(buildChimney());
    place('hearth', chimney);
    place('craft', buildBaskets(r, H));
    this.koi = new Koi(H(PLAZA.x, PLAZA.z) + 0.42);
    place('tide', this.koi.group);
    this.smoke = new SmokeEmitter(new THREE.Vector3(35.4, 8.3, 7.4), 5);
    root.add(this.smoke.object);
    // The great lantern over the Hall doors: a glowing core inside the existing iron lantern.
    HALL_LANTERN.y = H(32, 8.6) - 0.03 + 3.35;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.255, 0.5, 6), this.hallGlow);
    core.position.copy(HALL_LANTERN);
    core.userData.noAO = true;
    root.add(core);
    this.hallLight.position.copy(core.position).add(new THREE.Vector3(0, -0.2, 0.5));
    root.add(this.hallLight);
    root.add(this.burst.object, this.sky.mesh);
    // Render budget: these props sit on already-AO'd ground and mostly read at a distance, so they
    // skip the AO G-buffer; only the structural pieces (posts, stalls, chimney) cast shadows.
    const CASTS = new Set(['wood', 'stone', 'white', 'woodGrain']);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.noAO = true;
      const name = (Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? '';
      if (m.castShadow && !CASTS.has(name.replace(/^.*:/, ''))) m.castShadow = false;
    });
    this.built = root;
  }

  private visibleRooms(): Set<RoomId> {
    const q = this.game.services.quests;
    const out = new Set<RoomId>();
    for (const r of ROOMS) if ((q?.room(r.id)?.done || this.festivalLit) && !this.hidden.has(r.id)) out.add(r.id);
    return out;
  }

  private refresh(): void {
    if (!this.built) return;
    const vis = this.visibleRooms();
    for (const [id, o] of this.restore) o.visible = vis.has(id);
    if (this.smoke) this.smoke.object.visible = vis.has('hearth');
  }

  private cue(cue: string, arg: string | undefined, instant: boolean): void {
    const g = this.game;
    switch (cue) {
      case 'coach:place':
      case 'coach:arrive': {
        const town = g.world.current;
        if (!town) return;
        if (!this.coach) this.coach = buildCoach();
        const c = this.coach.group;
        town.root.add(c);
        const toX = COACH_PARK.x;
        const fromX = cue === 'coach:place' && arg === 'offstage' ? -16 : cue === 'coach:arrive' ? -16 : toX;
        c.position.set(instant || cue === 'coach:place' ? (arg === 'offstage' ? fromX : toX) : fromX, town.heightAt(toX, COACH_PARK.z) + 0.02, COACH_PARK.z);
        c.rotation.y = 0;
        if (cue === 'coach:arrive') {
          if (instant) c.position.x = toX;
          else this.coachMove = { from: fromX, to: toX, t: 0, dur: 4.2, leave: false };
        }
        break;
      }
      case 'coach:leave':
        if (this.coach && !instant) this.coachMove = { from: this.coach.group.position.x, to: this.coach.group.position.x + 24, t: 0, dur: 6, leave: true };
        else this.coach?.group.removeFromParent();
        break;
      case 'town:restore':
        if (arg) this.hidden.add(arg as RoomId);
        this.refresh();
        break;
      case 'town:reveal': {
        if (!arg) return;
        this.hidden.delete(arg as RoomId);
        this.refresh();
        const o = this.restore.get(arg as RoomId);
        if (o && !instant) {
          this.anims.push({ obj: o, t: 0, dur: 1.1 });
          const box = new THREE.Box3().setFromObject(o);
          const c = box.getCenter(new THREE.Vector3());
          const col = ROOMS.find((r) => r.id === arg)?.color ?? 0xffd070;
          for (let k = 0; k < 4; k++) this.burst.emit(new THREE.Vector3(c.x + (Math.random() - 0.5) * 2, box.min.y + 0.5, c.z + (Math.random() - 0.5) * 2), { color: col, count: 18, speed: 2.2, size: 0.16, gravity: 1.5, life: 1.6, up: 1.6, spread: 1.2 });
        }
        break;
      }
      case 'festival:on': {
        const town = g.world.current as unknown as { setFestival?: (on: boolean) => void };
        town.setFestival?.(true);
        this.festivalLit = true;
        this.refresh();
        break;
      }
      case 'festival:everglowOff':
        this.everglowOff = true;
        this.dim = instant ? 0 : 1;
        break;
      case 'festival:greatLantern':
        this.hallFlare = instant ? 0.4 : 1;
        this.burst.emit(HALL_LANTERN.clone(), { color: 0xffd070, count: 40, speed: 2.5, size: 0.18, gravity: 0.8, life: 2, up: 1.4, spread: 0.4 });
        break;
      case 'festival:skyLanterns':
        this.sky.start(instant ? 7 : 0);
        break;
    }
  }

  update(dt: number, game: Game): void {
    if (!this.built || game.world.current?.id !== 'town') return;
    const night = game.lighting.night;
    // Coach drive (ease in / out), wheels spin with distance.
    const cm = this.coachMove;
    if (cm && this.coach) {
      cm.t += dt;
      const u = Math.min(1, cm.t / cm.dur);
      const k = cm.leave ? u * u : 1 - Math.pow(1 - u, 3);
      const prev = this.coach.group.position.x;
      this.coach.group.position.x = cm.from + (cm.to - cm.from) * k;
      const d = this.coach.group.position.x - prev;
      for (const w of this.coach.wheels) w.rotation.z -= d / 0.42;
      this.coach.group.position.y = game.world.heightAt(this.coach.group.position.x, COACH_PARK.z) + 0.02 + Math.abs(Math.sin(cm.t * 9)) * 0.015 * (1 - u);
      if (u >= 1) {
        this.coachMove = null;
        if (cm.leave) this.coach.group.removeFromParent();
      }
    }
    // Reveal: grow in with an overshoot.
    this.anims = this.anims.filter((a) => {
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      const s = u < 1 ? 1 + Math.sin(u * Math.PI) * 0.12 - Math.pow(1 - u, 3) : 1;
      a.obj.scale.set(1, Math.max(0.001, s), 1);
      return u < 1;
    });
    this.koi?.update(dt, night);
    if (this.smoke?.object.visible) this.smoke.update(dt, night, game.rc.renderer.domElement.height);
    this.burst.update(dt, game.rc.renderer.domElement.height);
    this.sky.update(dt);
    // Hall lantern: brighter with every room lit; flares for the festival.
    const lit = game.services.quests?.lanternsLit() ?? 0;
    const glimmer = !this.everglowOff && (game.services.quests?.rooms().some((r) => r.glimmer) ?? false);
    this.dim = Math.max(0, this.dim - dt * 0.6);
    const base = this.festivalLit ? 1 : lit / 6;
    this.hallFlare = Math.max(this.festivalLit ? 0.25 : 0, this.hallFlare - dt * 0.25);
    const flick = 0.92 + Math.sin(game.time * 9) * 0.05;
    this.hallGlow.emissive.setHex(glimmer ? 0xdff4ff : 0xffb050);
    const off = 1 - Math.min(1, this.dim * 1.6);
    this.hallGlow.emissiveIntensity = (base * (0.8 + night * 2.6) + this.hallFlare * 6) * flick * off;
    this.hallLight.intensity = (base * night * 7 + this.hallFlare * 14) * flick * off;
  }
}
