/**
 * Cindergrove set pieces: mossy fallen giants with shelf fungi, mushroom clusters (incl. glowcaps
 * that light up at dusk), the Ember Shrine (menhir ring with glowing runes around an altar
 * holding the ever-burning ember crystal), the ruined watch tower, an arched footbridge and
 * stepping stones. Everything is built with MeshBuilder (merged per material by the map).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { MeshBuilder, mat, roundedBox, bevelCylinder, lumpySphere, uvScale, boxUV } from '../geom';
import { materials, nightGlow } from '../../render/materials';
import { applyWorldFx } from '../../render/worldfx';
import { applyWind } from '../../render/wind';
import { textures } from '../../render/textures';
import { rockGeometry } from '../props/rocks';
import type { InstancedPart } from '../props/instanced';
import { giantBarkMaterial } from './giants';

// ───────────────────────────────────────────── materials

let _fungus: THREE.MeshStandardMaterial | null = null;
function fungusMaterial(): THREE.MeshStandardMaterial {
  if (_fungus) return _fungus;
  _fungus = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, color: 0xffffff });
  _fungus.name = 'fungus';
  applyWorldFx(_fungus, { snowUp: 0.6 });
  return _fungus;
}

let _glow: THREE.MeshStandardMaterial | null = null;
/** Bioluminescent glowcaps: faint teal by day, glowing at dusk (driven by the night-glow rig). */
export function glowcapMaterial(): THREE.MeshStandardMaterial {
  if (_glow) return _glow;
  _glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, color: 0xbfeee8, emissive: 0x3ff0d8, emissiveIntensity: 0.15 });
  _glow.name = 'glowcap';
  nightGlow.push({ material: _glow, max: 2.6 });
  return _glow;
}

let _rune: THREE.MeshStandardMaterial | null = null;
/** Carved rune glow (intensity animated by the map: a slow breathing pulse, stronger at night). */
export function runeMaterial(): THREE.MeshStandardMaterial {
  if (_rune) return _rune;
  _rune = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.6, emissive: 0xff8a32, emissiveIntensity: 1.2 });
  _rune.name = 'rune';
  return _rune;
}

let _ember: THREE.MeshStandardMaterial | null = null;
export function emberMaterial(): THREE.MeshStandardMaterial {
  if (_ember) return _ember;
  _ember = new THREE.MeshStandardMaterial({ color: 0xffb46a, roughness: 0.25, metalness: 0.1, emissive: 0xff6a1a, emissiveIntensity: 2.4, flatShading: true });
  _ember.name = 'emberCrystal';
  return _ember;
}

let _ivy: THREE.MeshStandardMaterial | null = null;
function ivyMaterial(): THREE.MeshStandardMaterial {
  if (_ivy) return _ivy;
  const t = textures.leaves();
  _ivy = new THREE.MeshStandardMaterial({ bumpMap: t.bump, bumpScale: 1.2, vertexColors: true, roughness: 0.8, color: 0x5c9a3c });
  _ivy.name = 'ivy';
  applyWorldFx(_ivy, { snowUp: 0.55 });
  applyWind(_ivy, { mode: 'height', height: 8, amplitude: 0.02, flutter: 0.6 });
  return _ivy;
}

const CAP_RED = new THREE.Color(0xd8352a);
const CAP_TAN = new THREE.Color(0xa8703e);
const STEM = new THREE.Color(0xf2e8d2);

// ───────────────────────────────────────────── mossy log

/** A fallen giant lying along +X (origin = centre of the log on the ground). */
export function buildMossyLog(rng: Rng, len: number, radius: number): THREE.Group {
  const b = new MeshBuilder();
  const bark = giantBarkMaterial();
  const g = new THREE.CylinderGeometry(radius * 0.86, radius, len, 16, 6, true);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const s = 1 + Math.sin(p.y * 1.3 + Math.atan2(p.z, p.x) * 3) * 0.05 + (rng.next() - 0.5) * 0.04;
    pos.setXYZ(i, p.x * s, p.y + Math.sin(p.y * 0.6) * 0.0, p.z * s);
  }
  g.computeVertexNormals();
  uvScale(g, 3, len * 0.5);
  g.rotateZ(Math.PI / 2);
  g.translate(0, radius * 0.82, 0);
  b.add(bark, g, undefined, { aoWorld: (q) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(q.y, 0.05, radius * 1.1) });
  // Clean end-grain disc at +X, jagged snapped end at -X.
  const disc = new THREE.CircleGeometry(radius * 0.86, 16);
  disc.rotateY(Math.PI / 2);
  b.add('woodGrain', disc, mat(len / 2 - 0.01, radius * 0.82, 0), { tint: 0xd8b48a });
  const ring = new THREE.RingGeometry(radius * 0.3, radius * 0.36, 16);
  ring.rotateY(Math.PI / 2);
  b.add('woodDark', ring, mat(len / 2, radius * 0.82, 0));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const spl = new THREE.ConeGeometry(radius * 0.22, 0.5 + rng.next() * 0.7, 4);
    spl.rotateZ(Math.PI / 2);
    b.add(bark, spl, mat(-len / 2 - 0.2, radius * 0.82 + Math.sin(a) * radius * 0.62, Math.cos(a) * radius * 0.62, 0, 0, (rng.next() - 0.5) * 0.4));
  }
  // Shelf fungi stacked on the flanks.
  const fungus = fungusMaterial();
  for (let k = 0; k < 7; k++) {
    const side = rng.next() < 0.5 ? -1 : 1;
    const x = (rng.next() - 0.5) * len * 0.8;
    for (let s = 0; s < 1 + rng.int(0, 2); s++) {
      const sh = new THREE.CylinderGeometry(0.2 + rng.next() * 0.12, 0.22 + rng.next() * 0.12, 0.06, 10, 1, false, 0, Math.PI);
      sh.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const c = new THREE.Color(0xe8c890).lerp(new THREE.Color(0xc27a3a), rng.next() * 0.7);
      b.add(fungus, sh, mat(x + s * 0.18, radius * (0.55 + s * 0.28), side * radius * 0.92, (rng.next() - 0.5) * 0.2, 0, 0), { tint: c });
    }
  }
  const grp = b.build({ name: 'mossy-log' });
  return grp;
}

// ───────────────────────────────────────────── mushrooms (instanced)

function capGeo(r: number, h: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, h / r, 1);
  return g;
}

/** 'amanita' red spotted caps, 'bolete' fat brown caps, 'glowcap' clusters of tiny luminous caps. */
export type MushroomKind = 'amanita' | 'bolete' | 'glowcap';

export function buildMushroomCluster(kind: MushroomKind, r: Rng): InstancedPart[] {
  const b = new MeshBuilder();
  const fungus = fungusMaterial();
  const glow = glowcapMaterial();
  const n = kind === 'glowcap' ? 5 + r.int(0, 3) : 2 + r.int(0, 2);
  for (let i = 0; i < n; i++) {
    const a = r.next() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.08 + r.next() * (kind === 'glowcap' ? 0.22 : 0.16);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const s = (i === 0 ? 1 : 0.55 + r.next() * 0.4) * (kind === 'glowcap' ? 0.5 : 1);
    const hgt = (kind === 'bolete' ? 0.16 : 0.24) * s;
    const lean = (r.next() - 0.5) * 0.4;
    const stem = kind === 'bolete' ? bevelCylinder(0.05 * s, 0.07 * s, hgt, 0.01, 8) : new THREE.CylinderGeometry(0.022 * s, 0.03 * s, hgt, 7);
    if (kind !== 'bolete') stem.translate(0, hgt / 2, 0);
    b.add(kind === 'glowcap' ? glow : fungus, stem, mat(x, 0, z, lean, 0, lean * 0.5), { tint: kind === 'glowcap' ? 0x9fd8d0 : STEM });
    const capR = (kind === 'bolete' ? 0.11 : kind === 'amanita' ? 0.1 : 0.06) * s;
    const cap = capGeo(capR, capR * (kind === 'amanita' ? 0.62 : 0.7));
    const cm = mat(x + Math.sin(lean) * hgt * 0.5, hgt * 0.96, z, lean * 0.6, 0, lean * 0.3);
    const col = kind === 'amanita' ? CAP_RED.clone().offsetHSL((r.next() - 0.5) * 0.03, 0, (r.next() - 0.5) * 0.06) : kind === 'bolete' ? CAP_TAN.clone().offsetHSL(0, 0, (r.next() - 0.5) * 0.1) : new THREE.Color(0x7ff5e0);
    b.add(kind === 'glowcap' ? glow : fungus, cap, cm, { tint: col });
    if (kind === 'amanita') {
      for (let k = 0; k < 6; k++) {
        const sa = r.next() * Math.PI * 2;
        const sr = capR * (0.2 + r.next() * 0.6);
        const sy = Math.sqrt(Math.max(0, 1 - (sr / capR) ** 2)) * capR * 0.62;
        const dot = new THREE.SphereGeometry(capR * 0.13, 5, 3);
        dot.scale(1, 0.45, 1);
        b.add(fungus, dot, cm.clone().multiply(mat(Math.cos(sa) * sr, sy, Math.sin(sa) * sr)), { tint: 0xfff6ea });
      }
    }
  }
  const out: InstancedPart[] = [];
  for (const [m, geo] of b.geometries()) out.push({ geometry: geo, material: m as THREE.Material, castShadow: false });
  return out;
}

// ───────────────────────────────────────────── Ember Shrine

export interface ShrineBuild {
  group: THREE.Group;
  /** Crystal (animated separately: bob + spin). */
  crystal: THREE.Mesh;
  /** Ember emitter origin (local). */
  ember: THREE.Vector3;
}

/** Glyph made of 2-4 short strokes (original rune shapes). */
function glyph(b: MeshBuilder, m: THREE.Material, r: Rng, x: number, y: number, z: number, rotY: number, s: number): void {
  const strokes = 2 + r.int(0, 2);
  for (let i = 0; i < strokes; i++) {
    const a = r.pick([0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]);
    const len = (0.14 + r.next() * 0.12) * s;
    const g = new THREE.BoxGeometry(0.028 * s, len, 0.02);
    const ox = (r.next() - 0.5) * 0.1 * s;
    const oy = (r.next() - 0.5) * 0.12 * s;
    b.add(m, g, mat(x, y, z, 0, rotY, 0).multiply(mat(ox, oy, 0, 0, 0, a)));
  }
}

export function buildShrine(rng: Rng): ShrineBuild {
  const b = new MeshBuilder();
  const stone = materials.get('stone');
  const rock = materials.get('rock');
  const rune = runeMaterial();
  // Two-step round dais of fitted flagstones.
  for (const [rad, y, h] of [[3.4, 0.0, 0.22], [2.3, 0.2, 0.2]] as const) {
    const n = Math.round(rad * 4.2);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2 - 0.035;
      const g = new THREE.CylinderGeometry(rad, rad, h, 4, 1, false, a0, a1 - a0);
      const inner = new THREE.CylinderGeometry(rad - 0.9, rad - 0.9, h + 0.01, 4, 1, false, a0, a1 - a0);
      void inner;
      b.add(stone, g, mat(0, y + h / 2 + (rng.next() - 0.5) * 0.02, 0), { tint: new THREE.Color(0xc8c0b0).multiplyScalar(0.86 + rng.next() * 0.2) });
    }
  }
  const top = bevelCylinder(1.35, 1.4, 0.12, 0.04, 20);
  b.add(stone, top, mat(0, 0.4, 0), { tint: 0xb8b0a0 });
  // Inlaid rune circle on the dais.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    glyph(b, rune, rng, Math.cos(a) * 1.8, 0.435, Math.sin(a) * 1.8, 0, 0.9);
  }
  // Altar: tapered plinth + stone bowl.
  b.add(stone, boxUV(roundedBox(0.8, 0.9, 0.8, 0.08), 1.2), mat(0, 0.9, 0, 0, Math.PI / 4, 0), { tint: 0xb4ab9a });
  b.add(stone, bevelCylinder(0.5, 0.36, 0.26, 0.05, 14), mat(0, 1.46, 0), { tint: 0xa89f8e });
  b.add('metal', new THREE.TorusGeometry(0.46, 0.035, 6, 20), mat(0, 1.58, 0, Math.PI / 2, 0, 0), { tint: 0x8a6a3a });
  const coals = lumpySphere(0.3, 1, 0.3, rng, 2.4);
  coals.scale(1, 0.35, 1);
  b.add(rune, coals, mat(0, 1.56, 0));
  for (let f = 0; f < 4; f++) glyph(b, rune, rng, Math.cos(f * Math.PI / 2 + Math.PI / 4) * 0.42, 0.95, Math.sin(f * Math.PI / 2 + Math.PI / 4) * 0.42, -(f * Math.PI / 2 + Math.PI / 4) + Math.PI / 2, 1.2);
  // Ring of seven menhirs, each carved with a column of glowing glyphs facing the altar.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.25;
    const R = 4.6;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const h = 1.6 + rng.next() * 0.9;
    const geo = rockGeometry(rng, 0.62, 1, true);
    const face = -a - Math.PI / 2;
    const m = mat(x, -0.1, z, (rng.next() - 0.5) * 0.12, face, (rng.next() - 0.5) * 0.1).multiply(new THREE.Matrix4().makeScale(0.8, h / 0.62, 0.55));
    b.add(rock, geo, m);
    // Glyph column on the inner face.
    const inward = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
    for (let k = 0; k < 3; k++) {
      const gy = 0.55 + k * 0.38;
      if (gy > h * 0.8) break;
      glyph(b, rune, rng, x + inward.x * 0.34, gy, z + inward.z * 0.34, Math.atan2(inward.x, inward.z), 1.3);
    }
  }
  // Moss-covered fallen lintel.
  b.add(rock, rockGeometry(rng, 0.55, 1, true), mat(-3.6, 0, 3.2, 0, 1.1, Math.PI / 2 - 0.1).multiply(new THREE.Matrix4().makeScale(0.6, 2.4, 0.6)));
  const group = b.build({ name: 'ember-shrine' });
  // Floating ember crystal (dynamic).
  const cg = new THREE.OctahedronGeometry(0.24, 0);
  cg.scale(0.8, 1.7, 0.8);
  const crystal = new THREE.Mesh(cg, emberMaterial());
  crystal.position.set(0, 2.05, 0);
  crystal.castShadow = false;
  crystal.userData.dynamic = true;
  crystal.userData.noAO = true;
  group.add(crystal);
  return { group, crystal, ember: new THREE.Vector3(0, 1.62, 0) };
}

// ───────────────────────────────────────────── ruined watch tower

export function buildRuinedTower(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const stone = materials.get('stone');
  const R = 2.5;
  const courses = 17;
  const ch = 0.42;
  const door = { a: Math.PI * 0.62, w: 0.42 };
  for (let c = 0; c < courses; c++) {
    const n = 16;
    const off = (c % 2) * 0.5;
    // Broken crown: the top courses crumble away on one side.
    const breakA = 1.2 + Math.sin(c * 1.7) * 0.4;
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      if (c >= 12) {
        const keep = Math.cos(a - 4.4) * 0.5 + 0.5;
        if (keep < (c - 11) * 0.17 + rng.next() * 0.2 - 0.05 * breakA) continue;
      }
      if (c < 6 && Math.abs(Math.atan2(Math.sin(a - door.a), Math.cos(a - door.a))) < door.w) continue;
      if ((c === 9 || c === 10) && Math.abs(Math.atan2(Math.sin(a - 5.2), Math.cos(a - 5.2))) < 0.2) continue;
      const w = (2 * Math.PI * R) / n + 0.02;
      const tint = new THREE.Color(0xc4baa6).multiplyScalar(0.8 + rng.next() * 0.26).lerp(new THREE.Color(0x7d8a5a), c < 3 ? 0.35 * rng.next() : 0);
      b.add(stone, boxUV(roundedBox(w * 0.97, ch * 0.94, 0.55, 0.06, 1), 1.3), mat(Math.cos(a) * R, c * ch + ch / 2, Math.sin(a) * R, 0, -a + Math.PI / 2, 0).multiply(mat((rng.next() - 0.5) * 0.03, 0, (rng.next() - 0.5) * 0.06)), { tint });
    }
  }
  // Door arch + lintel + dark interior floor.
  const da = door.a;
  const dx = Math.cos(da) * R;
  const dz = Math.sin(da) * R;
  b.add(stone, boxUV(roundedBox(1.5, 0.35, 0.65, 0.06), 1), mat(dx, 6 * ch + 0.1, dz, 0, -da + Math.PI / 2, 0), { tint: 0xb0a690 });
  b.add('woodDark', new THREE.CircleGeometry(R - 0.2, 20).rotateX(-Math.PI / 2), mat(0, 0.05, 0), { tint: 0x3a3028 });
  // Protruding floor beams (the upper floor rotted away).
  for (let i = 0; i < 3; i++) {
    const a = 1.4 + i * 1.3;
    b.add('woodDark', roundedBox(0.22, 0.22, 1.3, 0.04), mat(Math.cos(a) * (R - 0.3), 3.3 + i * 0.05, Math.sin(a) * (R - 0.3), 0, -a + Math.PI / 2, 0.15), { tint: 0x6a5238 });
  }
  // Rubble at the foot.
  const rock = materials.get('rock');
  for (let i = 0; i < 9; i++) {
    const a = 3.6 + rng.next() * 1.8;
    const d = R + 0.5 + rng.next() * 1.6;
    b.add(rock, rockGeometry(rng, 0.2 + rng.next() * 0.2, 0), mat(Math.cos(a) * d, 0, Math.sin(a) * d, 0, rng.next() * 6, 0));
  }
  // Ivy curtains down the south-west face.
  const ivy = ivyMaterial();
  for (let i = 0; i < 26; i++) {
    const a = 1.9 + (rng.next() - 0.5) * 1.9;
    const y = rng.next() * 5.6;
    const r = 0.28 + rng.next() * 0.28 * (1 - y / 7);
    const g = lumpySphere(r, 1, 0.3, rng, 2.2);
    g.scale(1, 1.3, 0.55);
    b.add(ivy, g, mat(Math.cos(a) * (R + 0.26), y, Math.sin(a) * (R + 0.26), 0, -a + Math.PI / 2, 0), { tint: new THREE.Color(1, 1, 1).multiplyScalar(0.8 + rng.next() * 0.3) });
  }
  return b.build({ name: 'ruined-tower' });
}

// ───────────────────────────────────────────── footbridge

export function buildFootbridge(rng: Rng, len: number): THREE.Group {
  const b = new MeshBuilder();
  const arch = (t: number) => Math.sin(t * Math.PI) * 0.55;
  const n = Math.round(len / 0.34);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (t - 0.5) * len;
    const y = 0.32 + arch(t);
    const slope = Math.cos(t * Math.PI) * 0.55 * Math.PI / len;
    b.add('wood', boxUV(roundedBox(0.3, 0.08, 1.35 + (rng.next() - 0.5) * 0.06, 0.025, 1), 1), mat(x, y, (rng.next() - 0.5) * 0.04, 0, (rng.next() - 0.5) * 0.04, Math.atan(slope)), {
      tint: new THREE.Color(0xd8b890).multiplyScalar(0.82 + rng.next() * 0.25),
    });
  }
  for (const side of [-1, 1]) {
    // Stringers.
    for (let k = 0; k < 6; k++) {
      const t0 = k / 6;
      const t1 = (k + 1) / 6;
      const a = new THREE.Vector3((t0 - 0.5) * len, 0.22 + arch(t0), side * 0.62);
      const c = new THREE.Vector3((t1 - 0.5) * len, 0.22 + arch(t1), side * 0.62);
      const d = c.clone().sub(a);
      b.add('woodDark', roundedBox(d.length() + 0.08, 0.14, 0.12, 0.03, 1), mat((a.x + c.x) / 2, (a.y + c.y) / 2, side * 0.62, 0, 0, Math.atan2(d.y, d.x)));
    }
    // Posts + curved handrail.
    for (let k = 0; k <= 4; k++) {
      const t = 0.06 + (k / 4) * 0.88;
      const x = (t - 0.5) * len;
      b.add('woodDark', roundedBox(0.12, 0.95, 0.12, 0.03, 1), mat(x, 0.36 + arch(t) + 0.45, side * 0.66));
    }
    for (let k = 0; k < 8; k++) {
      const t0 = 0.06 + (k / 8) * 0.88;
      const t1 = 0.06 + ((k + 1) / 8) * 0.88;
      const a = new THREE.Vector3((t0 - 0.5) * len, 1.22 + arch(t0), side * 0.66);
      const c = new THREE.Vector3((t1 - 0.5) * len, 1.22 + arch(t1), side * 0.66);
      const d = c.clone().sub(a);
      b.add('wood', roundedBox(d.length() + 0.06, 0.09, 0.1, 0.03, 1), mat((a.x + c.x) / 2, (a.y + c.y) / 2, side * 0.66, 0, 0, Math.atan2(d.y, d.x)), { tint: 0xc8a070 });
    }
  }
  // Stone abutments.
  for (const e of [-1, 1]) b.add('stone', boxUV(roundedBox(0.7, 0.5, 1.7, 0.1), 1), mat(e * (len / 2 - 0.1), 0.1, 0), { tint: 0xa8a090 });
  return b.build({ name: 'footbridge' });
}

// ───────────────────────────────────────────── waterfall dressing

/** Boulders framing the waterfall lip and the plunge pool. */
export function buildFallsRocks(rng: Rng, lip: THREE.Vector3, pool: THREE.Vector3, width: number): THREE.Group {
  const b = new MeshBuilder();
  const rock = materials.get('rock');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const r = 0.7 + rng.next() * 0.5;
      b.add(rock, rockGeometry(rng, r, 1, true), mat(lip.x + side * (width * 0.62 + i * 0.7 + rng.next() * 0.3), lip.y - 0.35 - i * 0.2, lip.z - 0.3 + i * 0.5, 0, rng.next() * 6, 0));
    }
  }
  // Pool rim.
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * (0.05 + rng.next() * 0.9) + (i % 2 ? Math.PI : 0) * 0.15;
    const d = 3.2 + rng.next() * 1.4;
    const r = 0.35 + rng.next() * 0.55;
    b.add(rock, rockGeometry(rng, r, rng.int(0, 2), rng.next() < 0.5), mat(pool.x + Math.cos(a) * d * 1.1, pool.y - 0.15, pool.z + Math.sin(a) * d * 0.5 - 1.6, 0, rng.next() * 6, 0));
  }
  // Rocks the falling water breaks over at the base.
  for (let i = 0; i < 4; i++) {
    b.add(rock, rockGeometry(rng, 0.4 + rng.next() * 0.3, 1, true), mat(lip.x + (rng.next() - 0.5) * width * 1.1, pool.y - 0.3, pool.z - 0.6 + rng.next() * 0.6, 0, rng.next() * 6, 0));
  }
  return b.build({ name: 'falls-rocks' });
}

export function buildSteppingStones(rng: Rng, pts: [number, number][], y: number): THREE.Group {
  const b = new MeshBuilder();
  const rock = materials.get('rock');
  for (const [x, z] of pts) {
    const g = rockGeometry(rng, 0.42 + rng.next() * 0.1, 0, false);
    g.scale(1, 0.55, 1);
    b.add(rock, g, mat(x, y, z, 0, rng.next() * 6, 0));
  }
  return b.build({ name: 'stepping-stones' });
}
