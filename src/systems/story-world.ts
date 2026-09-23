/**
 * StoryWorldSystem: the valley's story dressing and the world beats of the cutscenes.
 *
 *   coach        the evening valley coach (sage + cream, roof rack of luggage, warm windows and
 *                headlamps) that brings you to Hearthvale: `coach:place` / `coach:arrive` / `coach:leave`.
 *                Three draws: one tinted body, one emissive sheet (windows + lamps), four instanced wheels.
 *   Hall         the Lantern Hall as the square's landmark: a front gable with a great round lantern
 *                window, a lantern cupola on the ridge and broad steps. Both glow brighter with every
 *                room lit (cold EverGlow white on the Glimmerco path).
 *   restorations what each relit room gives back to the town — the Blossom Arch over the Hall steps,
 *                Market Day stalls, harvest lanterns along the west road, a smoking Hall chimney,
 *                flower baskets on the plaza lamps, glowing koi (wake trails, caustics) in the fountain.
 *                Visible once a room is restored; `town:restore` hides it for the reveal, `town:reveal`
 *                grows it in with a sparkle burst.
 *   Glimmerco    from Spring 15 an EverGlow kiosk by the fountain (F: read the flyer); once the charter
 *                is signed a van on the plaza, a floodlight blasting the Hall facade and a sign over its
 *                doors. The kiosk is packed away if you refuse.
 *   festival     `festival:on` dresses the square for the finale (lantern strings from the Hall eaves,
 *                braziers by the steps), `festival:greatLantern` flares the Hall, `festival:skyLanterns`
 *                releases a sky full of tapered paper lanterns from the crowd's hands.
 *   house:night  the intro's first night: a warm key light on Gran's table, bloom held off the lamp.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { MeshBuilder, roundedBox, bevelCylinder, lumpySphere, mat, mergeStatic } from '../world/geom';
import { materials } from '../render/materials';
import { buildMarketStall, buildSandwichBoard } from '../world/props/townkit';
import { buildLanternPole, buildBunting, buildBrazier } from '../world/props/festival';
import { buildHarvestPile, buildHayBale } from '../world/props/farmkit';
import { BurstFX, SmokeEmitter, FireFX } from '../render/particles';
import { Rng } from '../core/rng';
import { ROOMS, type RoomId } from '../data/bundles';

const STOP = { x: 9.6, z: 26.2 };
const COACH_PARK = { x: STOP.x - 2.2, z: STOP.z - 0.7 };
const HALL_LANTERN = new THREE.Vector3(32, 3.35, 12.7);
const PLAZA = { x: 32, z: 25 };
/** The Hall: centre x, front face z, eave height above its base, ridge height. */
const HALL = { x: 32, z: 8.6, front: 11.8, eave: 5.0, ridge: 7.7 };
const KIOSK = { x: 38.4, z: 30.2 };
const VAN = { x: 25.2, z: 30.4 };
const EVERGLOW = 0xdff4ff;

// ─────────────────────────────────────────────── shared glowing materials

function glowMat(color: number, name: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.4 });
  m.name = name;
  return m;
}

// ─────────────────────────────────────────────── coach

/**
 * Coach sheet: four lamp-lit windows (curtains, a warm ceiling lamp, passengers' heads) plus a warm
 * lamp swatch and a red tail-lamp swatch — every glowing part of the coach samples this one canvas.
 */
let COACH_WIN: THREE.MeshStandardMaterial | null = null;
const SLOTS = 6;
function coachWindowMaterial(): THREE.MeshStandardMaterial {
  if (COACH_WIN) return COACH_WIN;
  const c = document.createElement('canvas');
  c.width = 128 * SLOTS;
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
    g.fillStyle = '#7a3a2e';
    g.beginPath();
    g.roundRect(x0 + 10, 66, 108, 40, 10);
    g.fill();
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
    g.fillStyle = 'rgba(60,40,28,0.9)';
    g.fillRect(x0 + 62, 0, 4, 96);
    g.fillStyle = 'rgba(40,24,14,0.95)';
    g.fillRect(x0, 0, 3, 96);
    g.fillRect(x0 + 125, 0, 3, 96);
  }
  // Slot 4: warm lamp (headlamps, destination board). Slot 5: tail lamps.
  const lamp = g.createRadialGradient(4 * 128 + 64, 48, 2, 4 * 128 + 64, 48, 80);
  lamp.addColorStop(0, '#fffbe8');
  lamp.addColorStop(1, '#ffd08a');
  g.fillStyle = lamp;
  g.fillRect(4 * 128, 0, 128, 96);
  g.fillStyle = '#ff5a3a';
  g.fillRect(5 * 128, 0, 128, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  COACH_WIN = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0 });
  COACH_WIN.name = 'coach-window';
  return COACH_WIN;
}

/** Remap a geometry's UVs into one slot of the coach sheet. */
function slot<T extends THREE.BufferGeometry>(geo: T, k: number): T {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, (k + 0.1 + uv.getX(i) * 0.8) / SLOTS, 0.1 + uv.getY(i) * 0.8);
  return geo;
}

interface Coach {
  group: THREE.Group;
  wheels: THREE.InstancedMesh;
  spin: number;
}

function buildCoach(): Coach {
  const b = new MeshBuilder();
  const L = 4.6;
  const W = 1.9;
  const SAGE = 0x6f9a7a;
  const CREAM = 0xf3e6c8;
  const CHROME = 0xd8dde4;
  const win = coachWindowMaterial();
  // Everything that doesn't glow is one vertex-tinted 'white' mesh.
  b.add('white', roundedBox(L, 0.95, W, 0.28), mat(0, 0.95, 0), { tint: SAGE });
  b.add('white', roundedBox(L - 0.1, 0.85, W - 0.06, 0.3), mat(-0.05, 1.8, 0), { tint: CREAM });
  b.add('white', roundedBox(L - 0.3, 0.18, W - 0.2, 0.09), mat(-0.1, 2.3, 0), { tint: 0xe8d8b4 });
  b.add('white', roundedBox(L + 0.04, 0.1, W + 0.04, 0.04), mat(0, 1.45, 0), { tint: 0xc8573e });
  b.add('white', roundedBox(0.5, 0.55, W - 0.3, 0.2), mat(L / 2 - 0.05, 0.85, 0), { tint: SAGE });
  b.add('white', roundedBox(0.12, 0.35, 1.1, 0.04), mat(L / 2 + 0.2, 0.85, 0), { tint: CHROME });
  for (let k = 0; k < 5; k++) b.add('white', roundedBox(0.03, 0.3, 0.02, 0.01), mat(L / 2 + 0.27, 0.85, -0.4 + k * 0.2), { tint: 0x8a9098 });
  for (const x of [L / 2 + 0.2, -L / 2 - 0.08]) b.add('white', roundedBox(0.16, 0.12, W + 0.1, 0.05), mat(x, 0.52, 0), { tint: CHROME });
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const x = -1.55 + k * 0.86;
      b.add('white', roundedBox(0.8, 0.58, 0.04, 0.05), mat(x, 1.86, sz * (W / 2 - 0.035)), { tint: 0x4a3a2c });
      const card = new THREE.PlaneGeometry(0.7, 0.48);
      const uv = card.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / SLOTS);
      b.add(win, card, mat(x, 1.86, sz * (W / 2 + 0.002), 0, sz > 0 ? 0 : Math.PI, 0));
      b.add('white', roundedBox(0.76, 0.05, 0.08, 0.02), mat(x, 1.6, sz * (W / 2 + 0.01)), { tint: 0x4a3a2c });
    }
  }
  b.add('white', roundedBox(0.04, 0.5, W - 0.5, 0.06), mat(L / 2 - 0.02, 1.86, 0), { tint: 0x2a3440 });
  // Door with its own window (a slice of window 2).
  b.add('white', roundedBox(0.66, 1.3, 0.05, 0.04), mat(1.2, 1.12, W / 2 + 0.01), { tint: 0x5a8a6a });
  const doorWin = new THREE.PlaneGeometry(0.46, 0.4);
  const duv = doorWin.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < duv.count; i++) duv.setX(i, (2 + duv.getX(i)) / SLOTS);
  b.add(win, doorWin, mat(1.2, 1.52, W / 2 + 0.045));
  b.add('white', roundedBox(0.08, 0.04, 0.05, 0.01), mat(0.98, 1.1, W / 2 + 0.05), { tint: 0xe8b84a });
  b.add('white', roundedBox(0.7, 0.1, 0.5, 0.04), mat(1.2, 0.36, W / 2 + 0.1), { tint: 0x4a4a4a });
  // Headlamps (chrome rims + lamp swatch) and tail lamps (red swatch).
  for (const sz of [-0.62, 0.62]) {
    b.add('white', new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14).rotateZ(Math.PI / 2), mat(L / 2 + 0.25, 1.1, sz), { tint: CHROME });
    b.add(win, slot(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 14).rotateZ(Math.PI / 2), 4), mat(L / 2 + 0.31, 1.1, sz));
    b.add(win, slot(roundedBox(0.04, 0.12, 0.2, 0.02), 5), mat(-L / 2 - 0.03, 0.95, sz));
  }
  // Roof rack with luggage.
  for (const sz of [-0.7, 0.7]) b.add('white', roundedBox(3.0, 0.05, 0.05, 0.02), mat(-0.3, 2.5, sz), { tint: 0x5a554f });
  for (let k = 0; k < 4; k++) b.add('white', roundedBox(0.05, 0.12, 1.45, 0.02), mat(-1.6 + k * 0.9, 2.44, 0), { tint: 0x5a554f });
  b.add('white', roundedBox(0.9, 0.42, 0.7, 0.06), mat(-1.2, 2.72, -0.2), { tint: 0x8a5a36 });
  b.add('white', roundedBox(0.7, 0.3, 0.5, 0.08), mat(-0.3, 2.66, 0.3), { tint: 0xc8573e });
  b.add('white', roundedBox(0.55, 0.36, 0.42, 0.08), mat(0.5, 2.68, -0.25), { tint: 0x3f76a8 });
  b.add('white', roundedBox(0.12, 0.03, 0.44, 0.01), mat(0.5, 2.87, -0.25), { tint: 0x2a2a2a });
  // Destination board over the windscreen.
  b.add('white', roundedBox(0.06, 0.24, 1.2, 0.03), mat(L / 2 - 0.05, 2.28, 0), { tint: 0x2a2a2a });
  b.add(win, slot(roundedBox(0.03, 0.14, 1.05, 0.02), 4), mat(L / 2 - 0.01, 2.28, 0));
  // Mudguards.
  for (const [x, z] of [[1.45, -0.9], [1.45, 0.9], [-1.45, -0.9], [-1.45, 0.9]] as const) b.add('white', new THREE.TorusGeometry(0.5, 0.08, 6, 14, Math.PI), mat(x, 0.45, z), { tint: 0x6a8a72 });
  const group = b.build({ name: 'coach' });
  // Wheels: one tinted geometry, four instances (they spin).
  const wb = new MeshBuilder();
  wb.add('white', bevelCylinder(0.42, 0.42, 0.3, 0.06, 18).rotateX(Math.PI / 2), undefined, { tint: 0x2a2624 });
  wb.add('white', bevelCylinder(0.22, 0.22, 0.32, 0.03, 14).rotateX(Math.PI / 2), undefined, { tint: CHROME });
  for (let k = 0; k < 5; k++) wb.add('white', roundedBox(0.05, 0.36, 0.33, 0.01), mat(0, 0, 0, 0, 0, (k / 5) * Math.PI), { tint: 0xb8bec6 });
  wb.add('white', new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8).rotateX(Math.PI / 2), undefined, { tint: 0xc8573e });
  const wheelGeo = wb.geometries().get('white')!;
  const wheels = new THREE.InstancedMesh(wheelGeo, materials.get('white'), 4);
  wheels.name = 'coach-wheels';
  wheels.castShadow = true;
  wheels.frustumCulled = false;
  group.add(wheels);
  group.traverse((o) => (o.userData.dynamic = true));
  const c: Coach = { group, wheels, spin: 0 };
  setWheels(c);
  return c;
}

const _wm = new THREE.Object3D();
function setWheels(c: Coach): void {
  [[1.45, -0.86], [1.45, 0.86], [-1.45, -0.86], [-1.45, 0.86]].forEach(([x, z], i) => {
    _wm.position.set(x!, 0.42, z!);
    _wm.rotation.set(0, 0, c.spin);
    _wm.updateMatrix();
    c.wheels.setMatrixAt(i, _wm.matrix);
  });
  c.wheels.instanceMatrix.needsUpdate = true;
}

// ─────────────────────────────────────────────── the Hall as a landmark

interface Landmark {
  group: THREE.Group;
  window: THREE.MeshStandardMaterial;
  cupola: THREE.MeshStandardMaterial;
}

/** Rose-window tracery for the great round lantern window. */
function roseTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const bg = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  bg.addColorStop(0, '#fff6dc');
  bg.addColorStop(0.5, '#ffd38a');
  bg.addColorStop(1, '#e89a4a');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  // Six coloured petals (one per room) round a bright heart.
  const cols = ROOMS.map((r) => `#${r.color.toString(16).padStart(6, '0')}`);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    g.save();
    g.translate(S / 2 + Math.cos(a) * 62, S / 2 + Math.sin(a) * 62);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = cols[i]!;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.ellipse(0, 0, 24, 42, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#3a2a22';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(S / 2, S / 2, 26, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * 26, S / 2 + Math.sin(a) * 26);
    g.lineTo(S / 2 + Math.cos(a) * 124, S / 2 + Math.sin(a) * 124);
    g.stroke();
  }
  g.lineWidth = 5;
  g.beginPath();
  g.arc(S / 2, S / 2, 92, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildLandmark(y0: number): Landmark {
  const b = new MeshBuilder();
  const STONE = 0xd8cfc0;
  const ROOF = 0x7d8ea8;
  const { x, front } = HALL;
  // Front cross-gable: a stone pediment standing proud of the roof slope, its own little roof.
  const gw = 4.6;
  const gz0 = 8.6;
  const gz1 = front + 0.55;
  const base = y0 + 4.45;
  const apex = y0 + HALL.ridge + 0.55;
  const tri = new THREE.Shape();
  tri.moveTo(-gw / 2, 0);
  tri.lineTo(gw / 2, 0);
  tri.lineTo(0, apex - base);
  tri.closePath();
  const prism = new THREE.ExtrudeGeometry(tri, { depth: gz1 - gz0, bevelEnabled: false });
  b.add('stone', prism, mat(x, base, gz0), { tint: STONE });
  // Quoins down the pediment's front corners and a moulded cornice.
  b.add('stone', roundedBox(gw + 0.3, 0.22, 0.5, 0.05), mat(x, base - 0.05, gz1 - 0.1), { tint: 0xc8bfb0 });
  // Roof slabs over the gable, meeting at a ridge along z.
  const run = gw / 2 + 0.35;
  const rise = apex - base;
  const slope = Math.atan2(rise, gw / 2);
  const len = Math.hypot(run, rise * (run / (gw / 2)));
  for (const s of [-1, 1]) b.add('roofTile', roundedBox(len, 0.14, gz1 - gz0 + 0.5, 0.04), mat(x + (s * run) / 2, base + rise / 2 + 0.08, (gz0 + gz1) / 2 + 0.2, 0, 0, -s * slope), { tint: ROOF });
  b.add('stone', roundedBox(0.3, 0.3, gz1 - gz0 + 0.6, 0.06), mat(x, apex + 0.08, (gz0 + gz1) / 2 + 0.2), { tint: 0xb8b0a4 });
  // Stone ring round the great window.
  const wy = base + 1.25;
  const ring = new THREE.TorusGeometry(0.92, 0.13, 8, 32);
  b.add('stone', ring, mat(x, wy, gz1 + 0.03), { tint: 0xe2d8c8 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('stone', roundedBox(0.16, 0.26, 0.12, 0.03), mat(x + Math.cos(a) * 1.05, wy + Math.sin(a) * 1.05, gz1 + 0.05, 0, 0, a + Math.PI / 2), { tint: 0xc8bfb0 });
  }
  // Cupola on the ridge: a stone drum, four open arches round a lantern, a verdigris cap, a gold finial.
  const cy = y0 + HALL.ridge - 0.35;
  const cz = HALL.z;
  b.add('stone', roundedBox(1.7, 0.7, 1.7, 0.06), mat(x, cy + 0.35, cz), { tint: STONE });
  b.add('stone', roundedBox(1.9, 0.14, 1.9, 0.04), mat(x, cy + 0.74, cz), { tint: 0xc8bfb0 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.add('stone', roundedBox(0.26, 1.3, 0.26, 0.04), mat(x + dx * 0.7, cy + 1.46, cz + dz * 0.7), { tint: STONE });
  b.add('stone', roundedBox(1.9, 0.16, 1.9, 0.04), mat(x, cy + 2.16, cz), { tint: 0xc8bfb0 });
  const cap = new THREE.ConeGeometry(1.32, 1.5, 4, 1);
  cap.rotateY(Math.PI / 4);
  b.add('roofTile', cap, mat(x, cy + 2.98, cz), { tint: 0x6fa08e });
  b.add('metal', new THREE.SphereGeometry(0.12, 10, 8), mat(x, cy + 3.8, cz), { tint: 0xe8b84a });
  b.add('metal', new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), mat(x, cy + 4.1, cz), { tint: 0xe8b84a });
  // Broad stone steps and a landing in front of the doors (low: the square walks over them).
  for (let i = 0; i < 2; i++) b.add('stone', roundedBox(6.4 - i * 0.9, 0.09, 0.9, 0.03), mat(x, y0 - 0.02 + i * 0.07, front + 1.9 - i * 0.55), { tint: 0xcac2b4 });
  const group = b.build({ name: 'hall-landmark' });
  const window = glowMat(0xffffff, 'hall-rose');
  window.map = roseTexture();
  window.emissiveMap = window.map;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), window);
  disc.position.set(x, wy, gz1 + 0.02);
  group.add(disc);
  const cupola = glowMat(0xfff0d0, 'hall-cupola');
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.95, 8), cupola);
  core.position.set(x, cy + 1.3, cz);
  group.add(core);
  return { group, window, cupola };
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
    b.add('soilPot', bevelCylinder(0.3, 0.24, 0.42, 0.04, 12), mat(cx + sx * (span + 0.55), 0.21, cz + 0.3), { tint: 0xc8704a });
    for (let k = 0; k < 7; k++) b.add('boxFlower', lumpySphere(0.12, 0, 0.2, r), mat(cx + sx * (span + 0.55) + (r.next() - 0.5) * 0.4, 0.5 + r.next() * 0.1, cz + 0.3 + (r.next() - 0.5) * 0.4), { tint: [0xff8fab, 0xffffff, 0xffc0d0][k % 3] });
  }
  const arc = new THREE.TorusGeometry(span, 0.08, 6, 24, Math.PI);
  b.add('wood', arc, mat(cx, 2.6, cz), { tint: 0xf2ead8 });
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
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI;
    const sag = 0.12 * Math.sin(a * 8);
    b.add('lampGlow', new THREE.SphereGeometry(0.045, 8, 6), mat(cx + Math.cos(a) * (span - 0.05), 2.6 + Math.sin(a) * (span - 0.05) - 0.1 + sag * 0.3, cz + 0.2));
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) b.add('lampGlow', new THREE.SphereGeometry(0.045, 8, 6), mat(cx + sx * (span + 0.1), 0.6 + k * 0.36, cz + 0.16 * (k % 2 ? 1 : -1)));
  return b.build({ name: 'restore-seed' });
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

/**
 * The Road Home: harvest-lantern poles zig-zag up the west lane with strings of paper lanterns slung
 * across it between them, and the lane's verges dressed for the harvest — pumpkin piles and baskets
 * at the pole feet, a hay bale or two. (Merged by the caller: a handful of draws in all.)
 */
function buildRoadLanterns(r: Rng, heightAt: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group();
  const pts: [number, number][] = [[2.5, 28.2], [4.5, 24.2], [8.5, 28.3], [12.5, 24.4], [16.5, 28.0], [20.5, 23.9], [24.2, 27.6]];
  const H = 2.85;
  pts.forEach(([x, z], i) => {
    const p = buildLanternPole(r, i + 2);
    p.position.set(x, heightAt(x, z) - 0.03, z);
    p.rotation.y = z < 26 ? 0 : Math.PI;
    g.add(p);
    // The verge at the pole's foot, on the side away from the lane.
    const out = z < 26 ? -1 : 1;
    const pile = buildHarvestPile(r, i % 3 === 1 ? 'basket' : 'pumpkins');
    pile.position.set(x + (i % 2 ? 0.55 : -0.5), heightAt(x, z + out * 0.45), z + out * 0.45);
    pile.rotation.y = r.next() * Math.PI * 2;
    g.add(pile);
    if (i % 3 === 0) {
      const bale = buildHayBale(r, i % 2 === 0);
      bale.position.set(x - 1.1, heightAt(x - 1.1, z + out * 0.8), z + out * 0.8);
      bale.rotation.y = 0.3 + r.next();
      bale.scale.setScalar(0.8);
      g.add(bale);
    }
  });
  // Lantern strings across the lane: from each pole's inner arm to the next pole's.
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const a = new THREE.Vector3(ax + 0.46, heightAt(ax, az) + H - 0.1, az);
    const b = new THREE.Vector3(bx - 0.46, heightAt(bx, bz) + H - 0.1, bz);
    g.add(buildBunting(r, a, b, 0.55, 9, 2));
  }
  return g;
}

function buildChimney(): THREE.Group {
  const b = new MeshBuilder();
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
    // Hung low and out from the post, below the lamp's glare: a wicker bowl brimming with blooms and trailing ivy.
    const dx = -Math.cos(a) * 0.62;
    const dz = -Math.sin(a) * 0.62;
    const by = y0 + 1.3;
    b.add('metal', roundedBox(0.04, 0.04, 0.68, 0.01), mat(px + dx / 2, y0 + 1.72, pz + dz / 2, 0, Math.atan2(dx, dz), 0), { tint: 0x2e2a28 });
    for (let k = 0; k < 3; k++) {
      const t = (k / 3) * Math.PI * 2;
      b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4), mat(px + dx + Math.cos(t) * 0.12, by + 0.26, pz + dz + Math.sin(t) * 0.12, Math.sin(t) * 0.25, 0, -Math.cos(t) * 0.25), { tint: 0x2e2a28 });
    }
    b.add('wood', bevelCylinder(0.28, 0.17, 0.24, 0.04, 14), mat(px + dx, by, pz + dz), { tint: 0xb88048 });
    b.add('wood', new THREE.TorusGeometry(0.28, 0.025, 5, 16), mat(px + dx, by + 0.12, pz + dz, Math.PI / 2, 0, 0), { tint: 0x8a5a2e });
    for (let k = 0; k < 18; k++) {
      const t = (k / 18) * Math.PI * 2 + r.next() * 0.3;
      const rad = k < 12 ? 0.24 : 0.1;
      b.add('boxFlower', lumpySphere(0.075 + r.next() * 0.035, 1, 0.18, r), mat(px + dx + Math.cos(t) * rad, by + 0.2 + (k < 12 ? 0 : 0.08) + r.next() * 0.05, pz + dz + Math.sin(t) * rad), { tint: [0xff7aa2, 0xffffff, 0xc77dff, 0xffd166, 0xff9a5a][k % 5]! });
    }
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * Math.PI * 2 + 0.3;
      const len = 0.25 + r.next() * 0.3;
      for (let j = 0; j < 4; j++) b.add('boxFlower', lumpySphere(0.045, 0, 0.2, r), mat(px + dx + Math.cos(t) * (0.27 + j * 0.01), by + 0.05 - (j / 3) * len, pz + dz + Math.sin(t) * (0.27 + j * 0.01)), { tint: j % 2 ? 0x3f7a2c : 0x5a9a3a });
    }
  }
  return b.build({ name: 'restore-craft' });
}

/**
 * Lantern Koi: six glowing fish (orange, gold, calico bodies lit from within by the Tide Lantern's
 * teal) circling the basin, each trailing an additive wake; caustic light plays over the water and
 * a soft deep-water shade darkens the middle of the basin so it reads as depth, not paint.
 */
class Koi {
  readonly group = new THREE.Group();
  private fish: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  // Warm inner glow (the orange / gold / calico reads through it); the Tide Lantern's teal lives in the wakes + caustics.
  private mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff9a4a, emissiveIntensity: 0.3, roughness: 0.3, side: THREE.DoubleSide });
  private lilyMat = new THREE.MeshStandardMaterial({ color: 0x4f8a3a, roughness: 0.7 });
  private candleMat = new THREE.MeshStandardMaterial({ color: 0xfff2dc, emissive: 0xffb050, emissiveIntensity: 2.6 });
  private wake: THREE.Mesh;
  private wakePos: Float32Array;
  private wakeA: Float32Array;
  private hist: THREE.Vector3[][] = [];
  private caustic: THREE.ShaderMaterial;
  private t = 0;
  private static SEG = 14;
  constructor(private y: number) {
    // A koi seen from above: a plump body tapering to the tail stalk, a flat forked tail fan that
    // reads as a silhouette on the lit water, and two pectoral fins.
    const body = new THREE.SphereGeometry(0.1, 16, 10);
    body.scale(1, 0.48, 2.5);
    const bp = body.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < bp.count; k++) {
      const z = bp.getZ(k);
      const f = z < 0 ? Math.max(0.28, 1 + (z / 0.25) * 0.72) : 1 - (z / 0.25) * 0.12;
      bp.setXYZ(k, bp.getX(k) * f, bp.getY(k) * f, z);
    }
    body.computeVertexNormals();
    const fan = new THREE.Shape();
    fan.moveTo(0, 0.02);
    fan.quadraticCurveTo(-0.07, -0.06, -0.13, -0.17);
    fan.quadraticCurveTo(-0.04, -0.12, 0, -0.1);
    fan.quadraticCurveTo(0.04, -0.12, 0.13, -0.17);
    fan.quadraticCurveTo(0.07, -0.06, 0, 0.02);
    const tail = new THREE.ShapeGeometry(fan, 6);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0.005, -0.2);
    const fins = mergeGeometries([-1, 1].map((sx) => {
      const g = new THREE.CircleGeometry(0.055, 10);
      g.scale(1.3, 0.7, 1);
      g.rotateX(-Math.PI / 2);
      g.rotateY(sx * 0.7);
      g.translate(sx * 0.1, -0.01, 0.07);
      return g.toNonIndexed();
    }))!;
    const fishGeo = mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), fins])!;
    fishGeo.computeVertexNormals();
    this.fish = new THREE.InstancedMesh(fishGeo, this.mat, 6);
    [0xff5a14, 0xffa020, 0xfff4ea, 0xe8401a, 0xffc040, 0xff7424].forEach((c, i) => this.fish.setColorAt(i, new THREE.Color(c)));
    this.fish.userData.noAO = true;
    this.fish.frustumCulled = false;
    this.fish.castShadow = false;
    this.group.add(this.fish);
    // Wake ribbons: one additive strip per fish, following its last positions.
    const n = 6 * Koi.SEG * 2;
    this.wakePos = new Float32Array(n * 3);
    this.wakeA = new Float32Array(n);
    const idx: number[] = [];
    for (let f = 0; f < 6; f++) {
      for (let s = 0; s < Koi.SEG - 1; s++) {
        const a = (f * Koi.SEG + s) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      this.hist.push([]);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(this.wakePos, 3).setUsage(THREE.DynamicDrawUsage));
    wg.setAttribute('aA', new THREE.BufferAttribute(this.wakeA, 1).setUsage(THREE.DynamicDrawUsage));
    wg.setIndex(idx);
    this.wake = new THREE.Mesh(
      wg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(0.45, 1.0, 0.92) * vA * 0.55, vA); }',
      }),
    );
    this.wake.frustumCulled = false;
    this.wake.userData.noAO = true;
    this.wake.renderOrder = 4;
    this.group.add(this.wake);
    // Caustics + deep-water shade on an annulus just over the water surface.
    this.caustic = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uGlow: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uGlow; varying vec2 vP;
        float cell(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); float d = 1.0;
          for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ vec2 g = vec2(float(x),float(y));
            vec2 h = fract(sin(vec2(dot(i+g, vec2(127.1,311.7)), dot(i+g, vec2(269.5,183.3))))*43758.5); vec2 o = 0.5 + 0.5*sin(uTime*0.9 + 6.2831*h);
            d = min(d, length(g + o - f)); }
          return d; }
        void main(){
          float r = length(vP);
          float edge = smoothstep(0.55, 0.8, r) * smoothstep(2.15, 1.85, r);
          float c = pow(1.0 - cell(vP * 2.6), 6.0) + 0.6 * pow(1.0 - cell(vP * 4.1 + 3.0), 8.0);
          float deep = smoothstep(2.1, 0.7, r);
          vec3 col = vec3(0.55, 1.0, 0.9) * c * 0.9 * uGlow;
          // Premultiplied: darken toward the middle (depth), add the caustic light.
          gl_FragColor = vec4(col * edge, edge * (0.28 * deep));
        }`,
    });
    this.caustic.blending = THREE.CustomBlending;
    this.caustic.blendSrc = THREE.OneFactor;
    this.caustic.blendDst = THREE.OneMinusSrcAlphaFactor;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 2.2, 48, 1), this.caustic);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(PLAZA.x, y + 0.012, PLAZA.z);
    ring.userData.noAO = true;
    ring.renderOrder = 3;
    this.group.add(ring);
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
  private fishAt(i: number, t: number, out: THREE.Vector3): number {
    const dir = i % 2 ? 1 : -1;
    const a = t * (0.35 + i * 0.04) * dir + i * 1.3;
    const rad = 1.05 + (i % 3) * 0.28 + Math.sin(t * 0.7 + i) * 0.08;
    out.set(PLAZA.x + Math.cos(a) * rad, this.y - 0.03 + Math.sin(t * 2 + i) * 0.015, PLAZA.z + Math.sin(a) * rad);
    return a;
  }
  private p = new THREE.Vector3();
  private q = new THREE.Vector3();
  update(dt: number, night: number): void {
    this.t += dt;
    if (!this.group.visible || !this.group.parent?.visible) return;
    const p = this.p;
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      const a = this.fishAt(i, this.t, p);
      const f = this.tmp;
      f.position.copy(p);
      f.rotation.set(0, -a + (dir > 0 ? 0 : Math.PI), Math.sin(this.t * 6 + i) * 0.15);
      f.updateMatrix();
      this.fish.setMatrixAt(i, f.matrix);
      // Wake: sample the path behind the fish (analytic, so it's always a smooth arc).
      for (let s = 0; s < Koi.SEG; s++) {
        const q = this.q;
        const ta = this.fishAt(i, this.t - s * 0.09, q);
        const tx = -Math.sin(ta) * dir;
        const tz = Math.cos(ta) * dir;
        const w = 0.07 * (1 - s / Koi.SEG) + 0.015;
        const k = (i * Koi.SEG + s) * 2;
        const wp = this.wakePos;
        const o = k * 3;
        wp[o] = q.x - tz * w;
        wp[o + 1] = wp[o + 4] = this.y + 0.004;
        wp[o + 2] = q.z + tx * w;
        wp[o + 3] = q.x + tz * w;
        wp[o + 5] = q.z - tx * w;
        const al = (1 - s / Koi.SEG) * (0.35 + night * 0.65);
        this.wakeA[k] = this.wakeA[k + 1] = al;
      }
    }
    this.fish.instanceMatrix.needsUpdate = true;
    (this.wake.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.wake.geometry.attributes.aA as THREE.BufferAttribute).needsUpdate = true;
    this.mat.emissiveIntensity = 0.12 + night * 0.5;
    this.caustic.uniforms.uTime!.value = this.t;
    this.caustic.uniforms.uGlow!.value = 0.3 + night * 0.32;
    this.candleMat.emissiveIntensity = (0.8 + night * 2.2) * (0.9 + Math.sin(this.t * 9) * 0.06);
  }
}

// ─────────────────────────────────────────────── Glimmerco in the valley

/** The Glimmerco mark: a cyan sunburst in a silver ring + wordmark, on a canvas card. */
function glimmerSign(w: number, h: number, text: string, sub: string): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  const H = c.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f4fbff');
  bg.addColorStop(1, '#cfe6f2');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, H);
  g.strokeStyle = '#8aa4b8';
  g.lineWidth = 8;
  g.strokeRect(6, 6, 500, H - 12);
  const cx = H * 0.5;
  const cy = H * 0.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.strokeStyle = '#2fc8e8';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * H * 0.18, cy + Math.sin(a) * H * 0.18);
    g.lineTo(cx + Math.cos(a) * H * 0.34, cy + Math.sin(a) * H * 0.34);
    g.stroke();
  }
  g.fillStyle = '#2fc8e8';
  g.beginPath();
  g.arc(cx, cy, H * 0.14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a3a52';
  g.font = `800 ${Math.round(H * 0.36)}px Fredoka, Nunito, sans-serif`;
  g.textBaseline = 'middle';
  g.fillText(text, H * 0.95, H * 0.42);
  g.fillStyle = '#4a7088';
  g.font = `700 ${Math.round(H * 0.16)}px Nunito, sans-serif`;
  g.fillText(sub, H * 0.97, H * 0.76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.3 });
  m.name = 'glimmer-sign';
  return m;
}

/**
 * The EverGlow kiosk: a glossy white pod with a cyan light strip, a curved shell canopy, a row of
 * glowing sample bulbs under glass domes and a giant bulb beacon on a chrome mast — the one thing on
 * the plaza that is not made of wood, stone or cloth, and it wants you to notice.
 */
function buildKiosk(): THREE.Group {
  const b = new MeshBuilder();
  const WHITE = 0xf2f7fa;
  const SILVER = 0xb8c6d2;
  const CYAN = 0x3fc8e0;
  // Pod counter (rounded hard) + plinth shadow gap + cyan kick strip.
  b.add('white', roundedBox(1.95, 0.08, 1.05, 0.03), mat(0, 0.04, 0), { tint: 0x8a98a4 });
  b.add('white', roundedBox(1.9, 0.98, 1.0, 0.2), mat(0, 0.57, 0), { tint: WHITE });
  b.add('white', roundedBox(1.98, 0.09, 1.08, 0.04), mat(0, 1.08, 0), { tint: SILVER });
  // Back panel with rounded shoulders, and the mast rising out of it.
  b.add('white', roundedBox(1.9, 1.45, 0.16, 0.08), mat(0, 1.8, -0.42), { tint: WHITE });
  b.add('white', roundedBox(1.96, 0.07, 0.2, 0.03), mat(0, 2.54, -0.42), { tint: CYAN });
  for (const sx of [-1, 1]) b.add('metal', bevelCylinder(0.035, 0.035, 1.45, 0.01, 8), mat(sx * 0.9, 1.1, 0.42), { tint: SILVER });
  // Curved shell canopy: a half-tube over the counter, cyan scallop trim along its lip.
  const shell = new THREE.CylinderGeometry(0.62, 0.62, 2.15, 20, 1, true, -Math.PI / 2, Math.PI);
  shell.rotateZ(Math.PI / 2);
  shell.scale(1, 0.55, 1);
  b.add('white', shell, mat(0, 2.52, 0.02), { tint: WHITE });
  for (let i = 0; i < 9; i++) {
    const sc = new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    sc.scale(1, 0.55, 0.5);
    b.add('cloth', sc, mat(-0.96 + i * 0.24, 2.52, 0.64), { tint: CYAN });
  }
  b.add('metal', bevelCylinder(0.03, 0.04, 0.9, 0.01, 8), mat(0, 3.1, -0.42), { tint: SILVER });
  b.add('metal', bevelCylinder(0.14, 0.1, 0.16, 0.02, 14), mat(0, 3.58, -0.42), { tint: SILVER });
  // Boxed bulbs stacked at the counter end.
  for (let k = 0; k < 4; k++) b.add('white', roundedBox(0.2, 0.24, 0.2, 0.03), mat(0.62 + (k % 2) * 0.22, 1.25 + Math.floor(k / 2) * 0.25, 0.12 - (k % 2) * 0.04, 0, k * 0.2, 0), { tint: k % 2 ? 0xf4fbff : CYAN });
  // Sample-bulb stands.
  for (let k = 0; k < 3; k++) b.add('metal', bevelCylinder(0.09, 0.11, 0.07, 0.02, 12), mat(-0.66 + k * 0.4, 1.16, 0.12), { tint: SILVER });
  const g = b.build({ name: 'glimmer-kiosk' });
  // Everything that glows shares one cold-white material: strip, sample bulbs, the beacon.
  const glow = new MeshBuilder();
  const gm = glowMat(EVERGLOW, 'glimmer-kiosk-glow');
  gm.emissiveIntensity = 1.8;
  glow.add(gm, roundedBox(1.92, 0.05, 1.02, 0.02), mat(0, 0.2, 0));
  for (let k = 0; k < 3; k++) glow.add(gm, new THREE.SphereGeometry(0.085, 14, 10), mat(-0.66 + k * 0.4, 1.29, 0.12));
  glow.add(gm, new THREE.SphereGeometry(0.28, 20, 14), mat(0, 3.92, -0.42));
  const gg = glow.build({ name: 'glimmer-kiosk-glow' });
  gg.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o.castShadow = false), (o.userData.noAO = true)) : 0));
  g.add(gg);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.46), glimmerSign(1.6, 0.46, 'EverGlow', 'by Glimmerco · 15% off!'));
  sign.position.set(0, 1.95, -0.335);
  g.add(sign);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5), glimmerSign(1.5, 0.5, 'Glimmerco', 'Brighter. Faster. Forever.'));
  front.position.set(0, 0.62, 0.505);
  g.add(front);
  const board = buildSandwichBoard(CYAN);
  board.position.set(1.45, 0, 0.7);
  board.rotation.y = -0.5;
  g.add(board);
  return g;
}

function buildVan(): THREE.Group {
  const b = new MeshBuilder();
  const SILVER = 0xd8e2ea;
  b.add('white', roundedBox(3.6, 1.7, 1.8, 0.3), mat(0, 1.25, 0), { tint: SILVER });
  b.add('white', roundedBox(1.1, 1.1, 1.74, 0.28), mat(1.95, 0.95, 0), { tint: SILVER });
  b.add('white', roundedBox(0.06, 0.55, 1.5, 0.08), mat(2.47, 1.28, 0), { tint: 0x2a3440 });
  b.add('white', roundedBox(3.64, 0.14, 1.84, 0.04), mat(0, 0.72, 0), { tint: 0x3fc8e0 });
  for (const [x, z] of [[1.6, -0.85], [1.6, 0.85], [-1.2, -0.85], [-1.2, 0.85]] as const) b.add('white', bevelCylinder(0.36, 0.36, 0.26, 0.05, 14).rotateX(Math.PI / 2), mat(x, 0.36, z), { tint: 0x2a2624 });
  b.add('white', new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), mat(-0.6, 2.35, 0), { tint: 0x8a9aa8 });
  b.add('white', new THREE.SphereGeometry(0.22, 12, 8), mat(-0.6, 2.62, 0), { tint: 0xf4fbff });
  const g = b.build({ name: 'glimmer-van' });
  for (const sz of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), glimmerSign(2.6, 0.9, 'Glimmerco', 'EverGlow™ Valley Services'));
    s.position.set(-0.2, 1.35, sz * 0.91);
    s.rotation.y = sz > 0 ? 0 : Math.PI;
    g.add(s);
  }
  return g;
}

function buildFloodlight(): THREE.Group {
  const b = new MeshBuilder();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    b.add('white', new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), mat(Math.cos(a) * 0.3, 0.7, Math.sin(a) * 0.3, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35), { tint: 0x5a646e });
  }
  b.add('white', roundedBox(0.7, 0.5, 0.3, 0.06), mat(0, 1.55, 0, -0.5, 0, 0), { tint: 0x8a9aa8 });
  const g = b.build({ name: 'glimmer-flood' });
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.38), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: EVERGLOW, emissiveIntensity: 4, roughness: 0.2 }));
  lens.position.set(0, 1.62, -0.16);
  lens.rotation.x = Math.PI + 0.5;
  lens.userData.noAO = true;
  g.add(lens);
  return g;
}

interface GlimmerSet {
  kiosk: THREE.Group;
  after: THREE.Group;
  spot: THREE.SpotLight;
}

// ─────────────────────────────────────────────── finale dressing + sky lanterns

/** Tapered paper lantern: bright at the mouth (the flame), shading up into the paper. */
function paperLanternGeo(): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0.001, -0.2), new THREE.Vector2(0.11, -0.19), new THREE.Vector2(0.17, -0.05), new THREE.Vector2(0.2, 0.12), new THREE.Vector2(0.17, 0.22), new THREE.Vector2(0.001, 0.24)];
  const g = new THREE.LatheGeometry(pts, 10);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = THREE.MathUtils.clamp(1 - (y + 0.2) / 0.44, 0, 1);
    const v = 0.55 + k * 1.9;
    col.set([v * 1.0, v * 0.78, v * 0.52], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

class SkyLanterns {
  readonly mesh: THREE.InstancedMesh;
  private n = 130;
  private data: { x: number; y: number; z: number; v: number; ph: number; s: number; t0: number; drift: number }[] = [];
  private tmp = new THREE.Object3D();
  active = false;
  private t = 0;
  constructor() {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
    m.name = 'sky-lantern';
    this.mesh = new THREE.InstancedMesh(paperLanternGeo(), m, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.userData.noAO = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'sky-lanterns';
    const r = new Rng('sky-lanterns');
    for (let i = 0; i < this.n; i++) {
      // Released from the crowd round the steps first, then from all over the square.
      const early = i < 36;
      const a = early ? (r.next() - 0.5) * Math.PI * 1.1 : r.next() * Math.PI * 2;
      const rad = early ? 3.6 + r.next() * 1.6 : 3 + r.next() * 14;
      const cx = early ? 32 : PLAZA.x;
      const cz = early ? 14.9 : PLAZA.z - 3;
      this.data.push({ x: cx + Math.sin(a) * rad, y: 1.4 + r.next() * 0.4, z: cz + Math.abs(Math.cos(a)) * rad * (early ? 1 : 0.7), v: 0.5 + r.next() * 0.5, ph: r.next() * 10, s: 0.7 + r.next() * 0.6, t0: early ? r.next() * 1.8 : 1.2 + r.next() * 5, drift: (r.next() - 0.5) * 0.3 });
      this.mesh.setColorAt(i, new THREE.Color().setHSL(0.04 + r.next() * 0.07, 0.9, 0.5 + r.next() * 0.2));
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
      // Ease off the hands (slow first second), then a steady climb with a lazy sway.
      const climb = t < 1.2 ? t * t * 0.42 : 0.6 + (t - 1.2) * d.v;
      const y = d.y + climb;
      this.tmp.position.set(d.x + Math.sin(t * 0.45 + d.ph) * 0.35 + t * d.drift, y, d.z + Math.cos(t * 0.33 + d.ph) * 0.3 - t * 0.12);
      this.tmp.rotation.set(Math.sin(t * 0.9 + d.ph) * 0.1, t * 0.15 + d.ph, Math.cos(t * 0.7 + d.ph) * 0.1);
      const s = t > 0 ? d.s * Math.min(1, t * 3) : 0;
      this.tmp.scale.setScalar(s * (y > 30 ? Math.max(0, 1 - (y - 30) / 10) : 1));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function buildFinale(r: Rng, H: (x: number, z: number) => number): { group: THREE.Group; fires: THREE.Vector3[] } {
  const parts = new THREE.Group();
  const eave = H(32, 12.4) + 4.35;
  const post = (deg: number): THREE.Vector3 => {
    const a = (deg * Math.PI) / 180;
    const x = PLAZA.x + Math.cos(a) * 7.6;
    const z = PLAZA.z + Math.sin(a) * 7.6;
    return new THREE.Vector3(x, H(x, z) + 3.0, z);
  };
  // Lantern strings fanning from the Hall eaves out to the plaza lamp posts, and one across the steps.
  const strings: [THREE.Vector3, THREE.Vector3, number][] = [
    [new THREE.Vector3(27.4, eave, 12.5), post(210), 0.6],
    [new THREE.Vector3(36.6, eave, 12.5), post(330), 0.6],
    [new THREE.Vector3(29.6, eave, 12.5), post(150), 0.8],
    [new THREE.Vector3(34.4, eave, 12.5), post(30), 0.8],
    [post(210), post(330), 0.55],
  ];
  for (const [a, b, sag] of strings) parts.add(buildBunting(r, a, b, sag, 14, 2));
  const fires: THREE.Vector3[] = [];
  for (const x of [28.2, 35.8]) {
    const z = 15.6;
    const br = buildBrazier();
    br.group.position.set(x, H(x, z) - 0.03, z);
    parts.add(br.group);
    fires.push(br.fire.clone().add(br.group.position));
  }
  const group = mergeKeep(parts, 'finale-dressing');
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.userData.noAO = true;
    }
  });
  return { group, fires };
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
  private coach: Coach | null = null;
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
  private landmark: Landmark | null = null;
  private glimmer: GlimmerSet | null = null;
  private finale: { group: THREE.Group; fire: FireFX; light: THREE.PointLight } | null = null;
  private hallFlare = 0;
  private anims: Anim[] = [];
  private festivalLit = false;
  /** Finale on the Glimmerco path: the EverGlow is switched off and the Hall burns warm again. */
  private everglowOff = false;
  private dim = 0;
  /** Demo override for the Glimmerco dressing ('glimmer' / 'kiosk'). */
  private glimmerPreview: 'glimmer' | 'kiosk' | null = null;
  private houseNight = false;
  private houseKey = new THREE.PointLight(0xffc890, 0, 3.2, 1.8);

  init(game: Game): void {
    this.game = game;
    this.burst.object.userData.noAO = true;
    this.houseKey.position.set(2.5, 1.75, 5.2);
    game.scene.add(this.houseKey);
    game.events.on('map:change', ({ map }) => this.onMap(map));
    game.events.on('quest:room', () => this.refresh());
    game.events.on('quest:sync', () => this.refresh());
    game.events.on('quest:hallRestored', () => this.refresh());
    game.events.on('story:beat', () => this.refresh());
    game.events.on('day:start', () => this.refresh());
    game.events.on('demo:stage', ({ showcase }) => {
      this.festivalLit = showcase.includes('story:festival');
      this.glimmerPreview = showcase.includes('story:glimmer') ? 'glimmer' : showcase.includes('story:kiosk') ? 'kiosk' : null;
      this.hidden.clear();
      this.everglowOff = false;
      if (!showcase.includes('story:festival')) this.sky.stop();
      this.refresh();
    });
    game.events.on('cutscene:end', () => {
      this.hidden.clear();
      this.houseNight = false;
      this.refresh();
    });
    game.events.on('cutscene:cue', ({ cue, arg, instant }) => this.cue(cue, arg, instant));
    game.events.on('player:interact', ({ x, z }) => {
      if (game.world.current?.id !== 'town' || !this.glimmer?.kiosk.visible) return;
      const p = game.player.position;
      if (Math.min(Math.hypot(p.x - KIOSK.x, p.z - KIOSK.z), Math.hypot(x + 0.5 - KIOSK.x, z + 0.5 - KIOSK.z)) < 2.2) void game.services.letters?.show('glimmer-flyer');
    });
    // The intro's first night: hold bloom off the table lamp (runs after the interior light rig).
    const scene = game.scene;
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      prev.apply(scene, args);
      const on = this.houseNight && game.world.current?.id === 'house';
      this.houseKey.intensity = on ? 2.4 : 0;
      if (on) game.rc.post.setBloom(0.3, 1.6);
    };
  }

  /** Kiosk up from Spring 15 until the offer is answered (kept if signed); van + floodlight once signed. */
  private glimmerState(): { kiosk: boolean; after: boolean } {
    if (this.glimmerPreview === 'glimmer') return { kiosk: true, after: true };
    if (this.glimmerPreview === 'kiosk') return { kiosk: true, after: false };
    const flag = this.game.services.story?.flag('glimmer');
    const c = this.game.calendar;
    const intro = this.game.services.story?.flag('intro') === 'done';
    const past15 = c.year > 1 || c.season !== 'spring' || c.day >= 15;
    const signed = flag === 'accepted' && !this.everglowOff;
    return { kiosk: intro && ((past15 && flag !== 'refused') || flag === 'accepted') && !this.everglowOff, after: signed };
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
    // The Hall's landmark dressing (always there).
    const hy = H(HALL.x, HALL.z) - 0.03 + 0.6;
    this.landmark = buildLandmark(hy);
    root.add(this.landmark.group);
    // The great lantern over the Hall doors: a glowing core inside the existing iron lantern.
    HALL_LANTERN.y = H(32, 8.6) - 0.03 + 3.35;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.255, 0.5, 6), this.hallGlow);
    core.position.copy(HALL_LANTERN);
    core.userData.noAO = true;
    root.add(core);
    this.hallLight.position.copy(core.position).add(new THREE.Vector3(0, -0.2, 0.5));
    root.add(this.hallLight);
    // Glimmerco: kiosk, and (after the charter) van + floodlight + sign over the Hall doors.
    const kiosk = buildKiosk();
    kiosk.position.set(KIOSK.x, H(KIOSK.x, KIOSK.z) - 0.02, KIOSK.z);
    // Front to the street (where the gameplay camera sees it), a quarter-turn toward the fountain.
    kiosk.rotation.y = -0.42;
    const after = new THREE.Group();
    const van = buildVan();
    van.position.set(VAN.x, H(VAN.x, VAN.z) - 0.02, VAN.z);
    van.rotation.y = 0.35;
    after.add(van);
    for (const x of [28.4, 35.6]) {
      const f = buildFloodlight();
      f.position.set(x, H(x, 16.2) - 0.02, 16.2);
      f.rotation.y = Math.atan2(32 - x, 11.8 - 16.2) + Math.PI;
      after.add(f);
    }
    const hallSign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.62), glimmerSign(2.3, 0.62, 'EverGlow Hall', 'a Glimmerco venue'));
    hallSign.position.set(32, hy + 3.08, HALL.front + 0.46);
    after.add(hallSign);
    const spot = new THREE.SpotLight(0xe8f6ff, 0, 22, 0.75, 0.5, 1.2);
    spot.position.set(32, H(32, 17) + 1.6, 17.2);
    spot.target.position.set(32, hy + 2.6, HALL.front);
    root.add(spot, spot.target, kiosk, after);
    this.glimmer = { kiosk, after, spot };
    // Finale dressing (hidden until the festival).
    const fin = buildFinale(r, H);
    const fire = new FireFX(fin.fires);
    fin.group.add(fire.object);
    const light = new THREE.PointLight(0xff8a3a, 0, 11, 1.6);
    light.position.set(32, H(32, 15.6) + 1.8, 15.9);
    root.add(light);
    fin.group.visible = false;
    root.add(fin.group);
    this.finale = { group: fin.group, fire, light };
    root.add(this.burst.object, this.sky.mesh);
    // Render budget: these props sit on already-AO'd ground and mostly read at a distance, so they
    // skip the AO G-buffer; only the structural pieces (posts, stalls, chimney, Hall) cast shadows.
    const CASTS = new Set(['wood', 'stone', 'white', 'woodGrain', 'roofTile']);
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
    const gs = this.glimmerState();
    if (this.glimmer) {
      this.glimmer.kiosk.visible = gs.kiosk && !this.festivalLit;
      this.glimmer.after.visible = gs.after;
    }
    if (this.finale) {
      this.finale.group.visible = this.festivalLit;
      this.finale.fire.active = this.festivalLit;
    }
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
      case 'festival:on':
      case 'festival:onGlimmer':
        this.festivalLit = true;
        this.everglowOff = false;
        this.refresh();
        break;
      case 'festival:everglowOff':
        this.everglowOff = true;
        this.dim = instant ? 0 : 1;
        this.refresh();
        break;
      case 'festival:greatLantern':
        this.hallFlare = instant ? 0.4 : 1;
        this.burst.emit(HALL_LANTERN.clone(), { color: 0xffd070, count: 40, speed: 2.5, size: 0.18, gravity: 0.8, life: 2, up: 1.4, spread: 0.4 });
        break;
      case 'festival:skyLanterns':
        this.sky.start(instant ? 6.5 : 0);
        break;
      case 'house:night':
        this.houseNight = true;
        break;
      case 'house:off':
        this.houseNight = false;
        break;
    }
  }

  update(dt: number, game: Game): void {
    if (!this.built || game.world.current?.id !== 'town') return;
    const night = game.lighting.night;
    const cm = this.coachMove;
    if (cm && this.coach) {
      cm.t += dt;
      const u = Math.min(1, cm.t / cm.dur);
      const k = cm.leave ? u * u : 1 - Math.pow(1 - u, 3);
      const prev = this.coach.group.position.x;
      this.coach.group.position.x = cm.from + (cm.to - cm.from) * k;
      this.coach.spin -= (this.coach.group.position.x - prev) / 0.42;
      setWheels(this.coach);
      this.coach.group.position.y = game.world.heightAt(this.coach.group.position.x, COACH_PARK.z) + 0.02 + Math.abs(Math.sin(cm.t * 9)) * 0.015 * (1 - u);
      if (u >= 1) {
        this.coachMove = null;
        if (cm.leave) this.coach.group.removeFromParent();
      }
    }
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
    // Hall lantern, rose window and cupola: brighter with every room lit; flare for the festival.
    const lit = game.services.quests?.lanternsLit() ?? 0;
    const gs = this.glimmerState();
    const glimmer = !this.everglowOff && (gs.after || (game.services.quests?.rooms().some((r) => r.glimmer) ?? false));
    this.dim = Math.max(0, this.dim - dt * 0.6);
    const base = this.festivalLit ? 1 : lit / 6;
    this.hallFlare = Math.max(this.festivalLit ? 0.25 : 0, this.hallFlare - dt * 0.25);
    const flick = 0.92 + Math.sin(game.time * 9) * 0.05;
    const hum = glimmer ? 0.94 + (Math.sin(game.time * 47) > 0.96 ? -0.25 : 0) : flick;
    const off = 1 - Math.min(1, this.dim * 1.6);
    this.hallGlow.emissive.setHex(glimmer ? EVERGLOW : 0xffb050);
    this.hallGlow.emissiveIntensity = (glimmer ? 5 : base * (0.8 + night * 2.6) + this.hallFlare * 6) * hum * off;
    this.hallLight.color.setHex(glimmer ? 0xd8f0ff : 0xffb45e);
    this.hallLight.intensity = (glimmer ? 9 * night + 3 : base * night * 7 + this.hallFlare * 14) * hum * off;
    if (this.landmark) {
      const w = glimmer ? 1 : Math.max(0.12, base);
      this.landmark.window.emissive.setHex(glimmer ? 0xbfe6ff : 0xffffff);
      this.landmark.window.emissiveIntensity = (glimmer ? 2.6 : w * (0.35 + night * 1.5) + this.hallFlare * 1.5) * hum * off;
      this.landmark.cupola.emissive.setHex(glimmer ? EVERGLOW : 0xffb050);
      this.landmark.cupola.emissiveIntensity = (glimmer ? 5 : base * (0.6 + night * 2.8) + this.hallFlare * 5) * hum * off;
    }
    if (this.glimmer) this.glimmer.spot.intensity = this.glimmer.after.visible ? (14 + night * 26) * hum : 0;
    if (this.finale) {
      const on = this.finale.group.visible;
      this.finale.light.intensity = on ? 6 * (0.85 + Math.sin(game.time * 11) * 0.08 + Math.sin(game.time * 23) * 0.05) : 0;
      if (on) this.finale.fire.update(dt, game.rc.renderer.domElement.height);
    }
  }
}
