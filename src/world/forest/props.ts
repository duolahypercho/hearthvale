/**
 * Cindergrove set pieces: mossy fallen giants with shelf fungi, mushroom clusters (incl. glowcaps
 * that light up at dusk), the Ember Shrine (menhir ring with glowing runes around an altar
 * holding the ever-burning ember crystal), the ruined watch tower, an arched footbridge and
 * stepping stones. Everything is built with MeshBuilder (merged per material by the map).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng';
import { MeshBuilder, mat, roundedBox, bevelCylinder, lumpySphere, uvScale, boxUV } from '../geom';
import { materials, nightGlow } from '../../render/materials';
import { applyWorldFx } from '../../render/worldfx';
import { textures } from '../../render/textures';
import { smoothRock, forestRockMaterial } from './rocks';
import type { InstancedPart } from '../props/instanced';
import type { Season } from '../../core/time';
import { forestMoss } from './rocks';
import { applyLeafClumps } from './giants';
import { ivyLeafTexture, applyCardMap } from './foliage';
import { patchMaterial, before, after } from '../../render/patch';

// ───────────────────────────────────────────── materials

let _fungus: THREE.MeshStandardMaterial | null = null;
export function fungusMaterial(): THREE.MeshStandardMaterial {
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

let _halo: THREE.MeshBasicMaterial | null = null;
/** Warm radial glow (additive, no depth write) for the ember crystal. */
function haloMaterial(): THREE.MeshBasicMaterial {
  if (_halo) return _halo;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,230,170,1)');
  g.addColorStop(0.18, 'rgba(255,170,80,0.55)');
  g.addColorStop(0.5, 'rgba(255,110,40,0.14)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _halo = new THREE.MeshBasicMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true, side: THREE.DoubleSide });
  _halo.name = 'emberHalo';
  return _halo;
}

let _dais: THREE.MeshStandardMaterial | null = null;
/** Pale, sun-bleached sandstone for the shrine dais (the shared cobble map reads as dark slate). */
function daisMaterial(): THREE.MeshStandardMaterial {
  if (_dais) return _dais;
  _dais = (materials.get('stone') as THREE.MeshStandardMaterial).clone();
  _dais.color.setRGB(1.75, 1.6, 1.38);
  _dais.bumpScale = 2;
  _dais.name = 'shrineStone';
  applyWorldFx(_dais);
  return _dais;
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
/** Four leaf hues per season (vertex colour R picks the slot, G the value jitter). */
const IVY: Record<Season, [number, number, number, number]> = {
  spring: [0x6fae3e, 0x86bf4a, 0x5c9c38, 0xa4c95a],
  summer: [0x3f8232, 0x4f9038, 0x376f2c, 0x5c9c3c],
  fall: [0xb8321e, 0xd6482a, 0xe07a2e, 0x6f8a34],
  winter: [0x6e5a3e, 0x84704c, 0x5a3a2a, 0x3f5a3a],
};
const ivyPal = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
/** Tower ivy follows the seasons (fresh greens, deep summer green, crimson / scarlet / orange in fall, dry in winter). */
export function setIvySeason(season: Season): void {
  IVY[season].forEach((h, i) => ivyPal[i]!.setHex(h));
  ivyMaterial();
}
function ivyMaterial(): THREE.MeshStandardMaterial {
  if (_ivy) return _ivy;
  _ivy = new THREE.MeshStandardMaterial({ map: ivyLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, color: 0xffffff });
  _ivy.name = 'ivy';
  IVY.summer.forEach((h, i) => ivyPal[i]!.setHex(h));
  applyWorldFx(_ivy, { snowUp: 0.5 });
  applyCardMap(_ivy);
  patchMaterial(_ivy, 'ivy-palette', (shader) => {
    shader.uniforms.uIvyPal = { value: ivyPal };
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', 'uniform vec3 uIvyPal[4];');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        // Undo the vertex tint (it only carries the palette slot + value jitter), apply the palette.
        vec3 hvLeafV = diffuseColor.rgb / max(vColor.rgb, vec3(1e-3));
        float hvSlot = vColor.r;
        vec3 hvPc = hvSlot < 0.2 ? uIvyPal[0] : hvSlot < 0.45 ? uIvyPal[1] : hvSlot < 0.7 ? uIvyPal[2] : uIvyPal[3];
        diffuseColor.rgb = hvPc * hvLeafV.g * vColor.g;
      }`,
    );
    shader.fragmentShader = fs;
  });
  return _ivy;
}

let _towerGlow: THREE.MeshStandardMaterial | null = null;
/** The tower's lit window: a warm lamp glow by day, brighter after dusk (animated by the map). */
export function towerWindowMaterial(): THREE.MeshStandardMaterial {
  if (_towerGlow) return _towerGlow;
  _towerGlow = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.35, emissive: 0xffa84a, emissiveIntensity: 1.3 });
  _towerGlow.name = 'towerWindow';
  return _towerGlow;
}

const CAP_RED = new THREE.Color(0xd8352a);
const CAP_TAN = new THREE.Color(0xa8703e);
const STEM = new THREE.Color(0xf2e8d2);

// ───────────────────────────────────────────── mossy log

let _logBark: THREE.MeshStandardMaterial | null = null;
/**
 * Fallen-log bark: opaque, no wind, never see-through. Moss is a world-space top-facing blend
 * (normal.y > ~0.4 with fbm breakup) so it cushions the upper flank instead of sitting in patches.
 */
function logBarkMaterial(): THREE.MeshStandardMaterial {
  if (_logBark) return _logBark;
  const t = textures.bark();
  _logBark = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.6, roughness: 0.94, vertexColors: true, color: 0xb09a86 });
  _logBark.name = 'logBark';
  patchMaterial(_logBark, 'log-moss', (shader) => {
    shader.uniforms.uLogMoss = forestMoss;
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', 'uniform vec3 uLogMoss;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 gn = normalize(vHvWorldNormal);
        vec2 mq = vHvWorldPos.xz * 1.9 + vHvWorldPos.y * 0.7;
        float mn = hvNoise(mq) * 0.6 + hvNoise(mq * 3.1 + 4.0) * 0.4;
        float top = smoothstep(0.38, 0.78, gn.y + (mn - 0.5) * 0.55);
        // Moss creeps a little way down the flanks in soft tongues.
        float drip = smoothstep(0.62, 0.8, hvNoise(vec2(vHvWorldPos.x * 2.3 + vHvWorldPos.z * 2.3, gn.y * 3.0))) * smoothstep(-0.2, 0.3, gn.y);
        float m = clamp(max(top, drip * 0.7), 0.0, 1.0);
        vec3 moss = uLogMoss * (0.55 + 0.6 * hvNoise(mq * 5.3)) * vec3(1.0, 1.05, 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, moss, m * 0.9 * (1.0 - hvSnowAmt));
      }`,
    );
    shader.fragmentShader = fs;
  });
  applyWorldFx(_logBark, { snowUp: 0.45 });
  return _logBark;
}

let _logEnd: THREE.MeshStandardMaterial | null = null;
/** Sawn / broken end grain: pale heartwood, growth rings, radial checks, sapwood and a dark bark lip. */
function logEndMaterial(): THREE.MeshStandardMaterial {
  if (_logEnd) return _logEnd;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const C = S / 2;
  const g = x.createRadialGradient(C * 0.96, C * 1.04, 0, C, C, C);
  g.addColorStop(0, '#caa06a');
  g.addColorStop(0.12, '#e6c996');
  g.addColorStop(0.7, '#d9b57e');
  g.addColorStop(0.84, '#eed6a8');
  g.addColorStop(0.88, '#6a4a30');
  g.addColorStop(1, '#3a2818');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  // Growth rings (slightly eccentric, wobbly).
  for (let r = 6; r < C * 0.84; r += 4 + Math.sin(r * 0.37) * 1.8 + 1.8) {
    x.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const rr = r * (1 + 0.035 * Math.sin(a * 3 + r * 0.1) + 0.02 * Math.sin(a * 7));
      const px = C * 0.97 + Math.cos(a) * rr;
      const py = C * 1.03 + Math.sin(a) * rr;
      if (k === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.strokeStyle = `rgba(120,80,45,${0.22 + 0.2 * Math.abs(Math.sin(r * 0.21))})`;
    x.lineWidth = 1.1 + Math.abs(Math.sin(r * 0.13)) * 1.2;
    x.stroke();
  }
  // Radial drying checks.
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + Math.sin(i * 3.1) * 0.4;
    const r0 = 10 + (i % 3) * 12;
    const r1 = C * (0.55 + (i % 2) * 0.25);
    x.beginPath();
    x.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
    x.lineTo(C + Math.cos(a + 0.05) * r1, C + Math.sin(a + 0.05) * r1);
    x.strokeStyle = 'rgba(60,38,22,0.75)';
    x.lineWidth = 2.2 - (i % 3) * 0.5;
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _logEnd = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, vertexColors: true });
  _logEnd.name = 'logEnd';
  applyWorldFx(_logEnd, { snowUp: 0.5 });
  return _logEnd;
}

/**
 * A fallen giant lying along +X (origin = centre of the log on the ground): an opaque, bevelled
 * 12-sided trunk (gentle taper + bow, bark ridges, baked AO dark underneath), a clean sawn end at +X
 * (ring texture, pale heartwood, dark bark lip), a snapped end at -X (jagged break + a few chunky
 * splinters), bracket fungi on the flanks. Moss comes from the material (top-facing blend).
 */
export function buildMossyLog(rng: Rng, len: number, radius: number): THREE.Group {
  const b = new MeshBuilder();
  const bark = logBarkMaterial();
  const endM = logEndMaterial();
  const RAD = 12;
  const RINGS = 16;
  const cy = radius * 0.8;
  const phase = rng.next() * 6.28;
  const rOf = (u: number, th: number): number => {
    // u 0..1 from the snapped (-X) end to the sawn (+X) end.
    const taper = 1 - 0.14 * u;
    const ridge = 1 + 0.035 * Math.sin(th * RAD + u * 9 + phase) + 0.025 * Math.sin(th * 5 + u * 17);
    // Bevel: the last few cm round over into the end faces.
    const bevel = 1 - 0.07 * Math.pow(THREE.MathUtils.smoothstep(u, 0.95, 1.0), 1.5) - 0.05 * Math.pow(THREE.MathUtils.smoothstep(u, 0.06, 0.0), 1.5);
    return radius * taper * ridge * bevel;
  };
  const bow = (u: number): number => Math.sin(u * Math.PI) * radius * 0.08;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ringPts: THREE.Vector3[][] = [];
  for (let j = 0; j <= RINGS; j++) {
    const u = j / RINGS;
    const xx = (u - 0.5) * len;
    const row: THREE.Vector3[] = [];
    for (let i = 0; i <= RAD; i++) {
      const th = (i / RAD) * Math.PI * 2;
      const r = rOf(u, th);
      const p = new THREE.Vector3(xx, cy + bow(u) + Math.sin(th) * r, Math.cos(th) * r);
      pos.push(p.x, p.y, p.z);
      uv.push((i / RAD) * 2.5, xx * 0.45);
      row.push(p);
    }
    ringPts.push(row);
  }
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < RAD; i++) {
      const a = j * (RAD + 1) + i;
      const c2 = a + RAD + 1;
      idx.push(a, c2, a + 1, c2, c2 + 1, a + 1);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();
  // Weld the seam normals.
  const nor = trunk.attributes.normal as THREE.BufferAttribute;
  for (let j = 0; j <= RINGS; j++) {
    const a = j * (RAD + 1);
    const e = a + RAD;
    const nx = nor.getX(a) + nor.getX(e);
    const ny = nor.getY(a) + nor.getY(e);
    const nz = nor.getZ(a) + nor.getZ(e);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l);
    nor.setXYZ(e, nx / l, ny / l, nz / l);
  }
  // AO: dark underside / ground contact, a touch darker towards the ends.
  b.add(bark, trunk, undefined, { aoWorld: (q, n) => (0.34 + 0.66 * THREE.MathUtils.smoothstep(q.y, 0.02, cy + radius * 0.6)) * (0.82 + 0.18 * (n.y * 0.5 + 0.5)) });

  // Sawn end (+X): a flat fan with planar ring UVs; the bark lip is in the texture.
  {
    const row = ringPts[RINGS]!;
    const cxp = row.reduce((s, p) => s + p.x, 0) / row.length;
    const ctr = new THREE.Vector3(cxp + 0.005, cy + bow(1), 0);
    const ep: number[] = [ctr.x, ctr.y, ctr.z];
    const euv: number[] = [0.5, 0.5];
    const R = rOf(1, 0);
    for (let i = 0; i <= RAD; i++) {
      const p = row[i]!;
      ep.push(p.x + 0.004, p.y, p.z);
      euv.push(0.5 + (p.z / R) * 0.5, 0.5 + ((p.y - ctr.y) / R) * 0.5);
    }
    const ei: number[] = [];
    for (let i = 1; i <= RAD; i++) ei.push(0, i + 1, i);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    eg.setAttribute('uv', new THREE.Float32BufferAttribute(euv, 2));
    eg.setIndex(ei);
    eg.computeVertexNormals();
    b.add(endM, eg, undefined, { aoWorld: (q) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(q.y, 0.05, cy) });
  }
  // Snapped end (-X): a jagged, splintered break (a ragged cone of torn fibres) + chunky splinters.
  {
    const row = ringPts[0]!;
    const R = rOf(0, 0);
    const ctr = new THREE.Vector3(-len / 2 - radius * 0.28, cy + radius * 0.1, radius * 0.08);
    const ep: number[] = [ctr.x, ctr.y, ctr.z];
    const euv: number[] = [0.5, 0.5];
    for (let i = 0; i <= RAD; i++) {
      const p = row[i % RAD]!;
      // Every other rim vertex torn outward a little: a ragged, fibrous lip.
      const tear = i % 2 === 0 ? rng.next() * radius * 0.35 : 0;
      ep.push(p.x - tear, p.y, p.z);
      euv.push(0.5 + (p.z / R) * 0.46, 0.5 + ((p.y - cy) / R) * 0.46);
    }
    const ei: number[] = [];
    for (let i = 1; i <= RAD; i++) ei.push(0, i, i + 1);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    eg.setAttribute('uv', new THREE.Float32BufferAttribute(euv, 2));
    eg.setIndex(ei);
    eg.computeVertexNormals();
    b.add(endM, eg, undefined, { tint: 0xd8c4a4, aoWorld: (q) => 0.62 + 0.38 * THREE.MathUtils.smoothstep(q.y, 0.05, cy) });
    const n = 3 + rng.int(0, 2);
    for (let k = 0; k < n; k++) {
      const a = -0.6 + (k / (n - 1)) * 3.6 + (rng.next() - 0.5) * 0.4;
      const sl = radius * (0.55 + rng.next() * 0.6);
      const sw = radius * (0.16 + rng.next() * 0.08);
      const sp = new THREE.CylinderGeometry(sw * 0.15, sw, sl, 5, 1);
      sp.scale(1, 1, 0.55);
      sp.translate(0, sl / 2, 0);
      sp.rotateZ(Math.PI / 2 + (rng.next() - 0.5) * 0.35);
      const rr = R * (0.55 + rng.next() * 0.3);
      b.add(k % 2 ? bark : endM, sp, mat(-len / 2 + 0.05, cy + Math.sin(a) * rr, Math.cos(a) * rr, a * 0.3, (rng.next() - 0.5) * 0.3, 0), { tint: k % 2 ? 0xffffff : 0xcfb48a });
    }
  }
  // Bracket fungi: stacked shelves on the flanks, clustered in 3-4 groups.
  const fungus = fungusMaterial();
  const groups = 3 + rng.int(0, 1);
  for (let k = 0; k < groups; k++) {
    const side = rng.next() < 0.5 ? -1 : 1;
    const u = 0.15 + rng.next() * 0.7;
    const xx = (u - 0.5) * len;
    const r = rOf(u, 0);
    const nShelf = 2 + rng.int(0, 1);
    for (let s = 0; s < nShelf; s++) {
      const th = side * (0.15 + s * 0.32) + (rng.next() - 0.5) * 0.1;
      const sr = radius * (0.26 - s * 0.05) * (0.85 + rng.next() * 0.3);
      const sh = new THREE.SphereGeometry(sr, 10, 4, 0, Math.PI, 0, Math.PI / 2);
      sh.scale(1, 0.32, 0.85);
      sh.rotateY(side > 0 ? 0 : Math.PI);
      const c = new THREE.Color(0xd9a45a).lerp(new THREE.Color(0x9a5a2a), rng.next() * 0.6);
      const y = cy + bow(u) + Math.sin(th) * r * 0.9;
      const zz = side * Math.cos(th) * r * 0.96;
      b.add(fungus, sh, mat(xx + (s - 0.5) * sr * 0.8, y, zz, 0, 0, 0), { tint: c });
    }
  }
  return b.build({ name: 'mossy-log' });
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

// ───────────────────────────────────────────── winter floor

let _holly: THREE.MeshStandardMaterial | null = null;
/** Evergreen winterberry leaves (dark glossy green, snow-capped). Winter-only props use their own materials so the map can toggle them. */
export function winterLeafMaterial(): THREE.MeshStandardMaterial {
  if (_holly) return _holly;
  _holly = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, color: 0xffffff });
  _holly.name = 'winterLeaf';
  applyWorldFx(_holly, { snowUp: 0.5 });
  applyLeafClumps(_holly, { freq: [7, 7, 7], bend: 0.6, seam: 0.4, cut: 0.9 });
  return _holly;
}
let _berry: THREE.MeshStandardMaterial | null = null;
export function winterBerryMaterial(): THREE.MeshStandardMaterial {
  if (_berry) return _berry;
  _berry = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, color: 0xffffff, emissive: 0x400000, emissiveIntensity: 0.25 });
  _berry.name = 'winterBerry';
  return _berry;
}
let _wtwig: THREE.MeshStandardMaterial | null = null;
export function winterTwigMaterial(): THREE.MeshStandardMaterial {
  if (_wtwig) return _wtwig;
  _wtwig = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, color: 0xffffff });
  _wtwig.name = 'winterTwig';
  applyWorldFx(_wtwig, { snowUp: 0.6 });
  return _wtwig;
}

/** A winterberry bush: dark evergreen mounds studded with clusters of red berries. */
export function buildWinterBerry(r: Rng): InstancedPart[] {
  const b = new MeshBuilder();
  const leaf = winterLeafMaterial();
  const berry = winterBerryMaterial();
  const n = 3 + r.int(0, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.next();
    const d = i === 0 ? 0 : 0.22 + r.next() * 0.12;
    const rad = i === 0 ? 0.38 : 0.26 + r.next() * 0.08;
    const g = lumpySphere(rad, 1, 0.16, r, 2.4);
    g.scale(1, 0.8, 1);
    b.add(leaf, g, mat(Math.cos(a) * d, rad * 0.62, Math.sin(a) * d), { tint: new THREE.Color(0x2c5234).multiplyScalar(0.85 + r.next() * 0.3), aoWorld: (q) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(q.y, 0, 0.6) });
    for (let k = 0; k < 6; k++) {
      const u = r.next() * Math.PI * 2;
      const v = 0.2 + r.next() * 0.9;
      const p = new THREE.Vector3(Math.cos(u) * Math.sin(v), Math.cos(v) * 0.8, Math.sin(u) * Math.sin(v)).multiplyScalar(rad * 1.02);
      for (let c = 0; c < 3; c++) {
        const bg = new THREE.SphereGeometry(0.035 + r.next() * 0.012, 6, 4);
        b.add(berry, bg, mat(Math.cos(a) * d + p.x + (r.next() - 0.5) * 0.06, rad * 0.62 + p.y + (r.next() - 0.5) * 0.05, Math.sin(a) * d + p.z + (r.next() - 0.5) * 0.06), { tint: new THREE.Color(0xc41e24).multiplyScalar(0.85 + r.next() * 0.3) });
      }
    }
  }
  const out: InstancedPart[] = [];
  for (const [m, geo] of b.geometries()) out.push({ geometry: geo, material: m as THREE.Material, castShadow: true });
  return out;
}

/** Dead twigs and dry stalks poking up through the snow. */
export function buildWinterTwigs(r: Rng): InstancedPart[] {
  const b = new MeshBuilder();
  const m = winterTwigMaterial();
  const n = 3 + r.int(0, 3);
  for (let i = 0; i < n; i++) {
    const len = 0.35 + r.next() * 0.5;
    const g = new THREE.CylinderGeometry(0.008, 0.02, len, 4);
    g.translate(0, len / 2, 0);
    const a = r.next() * 6.28;
    const off = r.next() * 0.25;
    b.add(m, g, mat(Math.cos(a) * off, -0.05, Math.sin(a) * off, (r.next() - 0.5) * 0.9, r.next() * 6.28, (r.next() - 0.5) * 0.9), { tint: new THREE.Color(r.next() < 0.5 ? 0x4a3a2c : 0x8a7454).multiplyScalar(0.8 + r.next() * 0.4) });
    // A forked tip on some.
    if (r.next() < 0.5) {
      const f = new THREE.CylinderGeometry(0.005, 0.01, len * 0.4, 3);
      f.translate(0, len * 0.2, 0);
      b.add(m, f, mat(Math.cos(a) * off, len * 0.6, Math.sin(a) * off, 0.6, r.next() * 6.28, 0), { tint: 0x5a4838 });
    }
  }
  const out: InstancedPart[] = [];
  for (const [mm, geo] of b.geometries()) out.push({ geometry: geo, material: mm as THREE.Material, castShadow: false });
  return out;
}

// ───────────────────────────────────────────── Ember Shrine

export interface ShrineBuild {
  group: THREE.Group;
  /** Soft additive glow card around the crystal (billboarded + animated by the map). */
  halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
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

/**
 * A standing stone: a tapered slab (not a cone) with a slanted, chipped crown, bulging weathered
 * faces, knocked-off corners and a notch; origin at the ground centre, carved face towards +Z.
 */
function menhirGeometry(rng: Rng, h: number): THREE.BufferGeometry {
  const w = 0.95 + rng.next() * 0.2;
  const d = 0.55 + rng.next() * 0.1;
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, d, 4, 10, 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const slope = (rng.next() - 0.5) * 0.7;
  const notchX = (rng.next() - 0.5) * w * 0.5;
  const chips = Array.from({ length: 4 }, () => ({ x: (rng.next() < 0.5 ? -1 : 1) * w * 0.5, y: rng.next() * h, z: (rng.next() < 0.5 ? -1 : 1) * d * 0.5, r: 0.18 + rng.next() * 0.16 }));
  const ph = rng.next() * 10;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i) + h / 2;
    let z = pos.getZ(i);
    const f = y / h;
    // Taper + gentle belly.
    const taper = 1 - 0.28 * f + 0.06 * Math.sin(f * Math.PI);
    x *= taper;
    z *= 1 - 0.18 * f;
    // Weathered bulges.
    const bump = Math.sin(y * 3.1 + ph) * Math.cos(x * 5.3 + ph) * 0.03 + Math.sin(y * 7.7 + x * 4.1) * 0.012;
    const nx = Math.sign(x) || 1;
    const nz = Math.sign(z) || 1;
    x += nx * bump;
    z += nz * bump * 0.7;
    // Slanted, chipped crown with a notch.
    const crown = h * 0.86 + x * slope - (Math.abs(x - notchX) < 0.14 ? 0.12 : 0);
    if (y > crown) y = crown + (y - crown) * 0.25;
    // Knocked-off corners.
    for (const c of chips) {
      const dd = Math.hypot(x - c.x, y - c.y, z - c.z);
      if (dd < c.r) {
        const k = (c.r - dd) / c.r;
        x -= Math.sign(c.x) * k * c.r * 0.45;
        z -= Math.sign(c.z) * k * c.r * 0.35;
      }
    }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildShrine(rng: Rng): ShrineBuild {
  const b = new MeshBuilder();
  const stone = daisMaterial();
  const rock = forestRockMaterial();
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
      b.add(stone, g, mat(0, y + h / 2 + (rng.next() - 0.5) * 0.02, 0), { tint: new THREE.Color(0xe6d8bc).multiplyScalar(0.9 + rng.next() * 0.2) });
    }
  }
  const top = bevelCylinder(1.35, 1.4, 0.12, 0.04, 20);
  b.add(stone, top, mat(0, 0.4, 0), { tint: 0xd8cab0 });
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
    const h = 2.3 + rng.next() * 1.1;
    const geo = menhirGeometry(rng, h);
    const face = -a - Math.PI / 2;
    const m = mat(x, -0.15, z, (rng.next() - 0.5) * 0.1, face, (rng.next() - 0.5) * 0.08);
    b.add(rock, geo, m, { tint: new THREE.Color(0xf0e8da).multiplyScalar(0.95 + rng.next() * 0.12) });
    // Glyph column on the inner face.
    const inward = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
    for (let k = 0; k < 4; k++) {
      const gy = 0.6 + k * 0.42;
      if (gy > h * 0.8) break;
      glyph(b, rune, rng, x + inward.x * 0.4, gy, z + inward.z * 0.4, Math.atan2(inward.x, inward.z), 1.4);
    }
  }
  // Moss-covered fallen lintel.
  b.add(rock, smoothRock(rng, 0.55, { elong: 1, squash: 1, detail: 2, lumpy: 0.14 }), mat(-3.6, 0, 3.2, 0, 1.1, Math.PI / 2 - 0.1).multiply(new THREE.Matrix4().makeScale(0.6, 2.4, 0.6)));
  const group = b.build({ name: 'ember-shrine' });
  // Floating ember crystal (dynamic).
  const cg = new THREE.OctahedronGeometry(0.34, 0);
  cg.scale(0.8, 1.7, 0.8);
  const crystal = new THREE.Mesh(cg, emberMaterial());
  crystal.position.set(0, 2.05, 0);
  crystal.castShadow = false;
  crystal.userData.dynamic = true;
  crystal.userData.noAO = true;
  group.add(crystal);
  // A mesh card, not a Sprite: the AO G-buffer pass only knows how to skip meshes.
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMaterial());
  halo.position.set(0, 2.1, 0);
  halo.scale.setScalar(2.2);
  halo.castShadow = false;
  halo.receiveShadow = false;
  halo.userData.dynamic = true;
  halo.userData.noAO = true;
  halo.renderOrder = 5;
  group.add(halo);
  return { group, halo, crystal, ember: new THREE.Vector3(0, 1.62, 0) };
}

// ───────────────────────────────────────────── ruined watch tower

/**
 * Climbing ivy on a round wall: vines branch down from the crown as tapered stems, carrying leaf
 * sprays (flat alpha-tested cards lying on the stone, varied size / tilt / palette slot).
 */
function towerIvy(b: MeshBuilder, rng: Rng, R: number, a0: number, a1: number, top: number): void {
  const ivy = ivyMaterial();
  const leaf = (a: number, y: number, s: number, slot: number): void => {
    const g = new THREE.PlaneGeometry(s, s * 1.1);
    // Lie on the wall (normal = radial), a little tilt off the stone, random spin.
    const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng.next() - 0.5) * 0.7, (rng.next() - 0.5) * 0.7, rng.next() * 6.28));
    q.multiply(tilt);
    const r = R + 0.3 + rng.next() * 0.08;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
    b.add(ivy, g, m, { tint: new THREE.Color(slot, 0.82 + rng.next() * 0.3, 1) });
  };
  const slotPick = (): number => {
    const u = rng.next();
    return u < 0.34 ? 0.1 : u < 0.64 ? 0.33 : u < 0.88 ? 0.58 : 0.9;
  };
  const vine = (a: number, y: number, len: number, depth: number): void => {
    const pts: THREE.Vector3[] = [];
    let aa = a;
    let yy = y;
    const seg = 0.3;
    const n = Math.max(2, Math.round(len / seg));
    for (let i = 0; i <= n; i++) {
      const rr = R + 0.29;
      pts.push(new THREE.Vector3(Math.cos(aa) * rr, yy, Math.sin(aa) * rr));
      // Dense leaf sprays along the vine, smaller towards its tip.
      const f = i / n;
      const k = 2 + (rng.next() < 0.5 ? 1 : 0);
      for (let j = 0; j < k; j++) leaf(aa + (rng.next() - 0.5) * 0.14, yy + (rng.next() - 0.5) * 0.25, (0.62 - f * 0.22) * (0.75 + rng.next() * 0.5) * (depth ? 0.85 : 1), slotPick());
      if (depth < 2 && i > 1 && i < n - 1 && rng.next() < 0.16) vine(aa, yy, len * (0.35 + rng.next() * 0.3), depth + 1);
      aa += (rng.next() - 0.5) * 0.14 + (depth ? (rng.next() < 0.5 ? -0.05 : 0.05) : 0);
      yy -= seg * (0.85 + rng.next() * 0.3);
      if (yy < 0.25) break;
    }
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, pts.length * 2, 0.03 - depth * 0.008, 4, false);
    b.add('woodDark', tube, undefined, { tint: 0x6a5238 });
  };
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = a0 + ((k + 0.5) / n) * (a1 - a0) + (rng.next() - 0.5) * 0.12;
    vine(a, top - rng.next() * 0.6, 2.2 + rng.next() * 3.6, 0);
  }
  // A thick cap of leaves spilling over the crown.
  for (let i = 0; i < 30; i++) leaf(a0 + rng.next() * (a1 - a0), top + 0.1 + rng.next() * 0.4, 0.6 + rng.next() * 0.3, slotPick());
}

/**
 * The glade's old watch tower, re-roofed by whoever keeps the ember: coursed stone with a corbelled
 * crown, a slate cone roof (slightly crooked) with an ember finial, an arched oak door with iron
 * straps, a warm lit window, ivy vines, rubble at the foot.
 */
export function buildRuinedTower(rng: Rng): THREE.Group {
  const b = new MeshBuilder();
  const stone = materials.get('stone');
  const R = 2.5;
  const courses = 16;
  const ch = 0.42;
  const door = { a: Math.PI * 0.62, w: 0.25 };
  const win = { a: 1.6, w: 0.13, c0: 8, c1: 9 };
  const angDist = (a: number, b2: number) => Math.abs(Math.atan2(Math.sin(a - b2), Math.cos(a - b2)));
  for (let c = 0; c < courses; c++) {
    const n = 16;
    const off = (c % 2) * 0.5;
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      if (c < 5 && angDist(a, door.a) < door.w + 0.12) continue;
      if (c >= win.c0 && c <= win.c1 && angDist(a, win.a) < win.w + 0.1) continue;
      if ((c === 9 || c === 10) && angDist(a, 5.2) < 0.2) continue;
      const w = (2 * Math.PI * R) / n + 0.02;
      const tint = new THREE.Color(0xc4baa6).multiplyScalar(0.8 + rng.next() * 0.26).lerp(new THREE.Color(0x7d8a5a), c < 3 ? 0.35 * rng.next() : 0);
      b.add(stone, boxUV(roundedBox(w * 0.97, ch * 0.94, 0.55, 0.06, 1), 1.3), mat(Math.cos(a) * R, c * ch + ch / 2, Math.sin(a) * R, 0, -a + Math.PI / 2, 0).multiply(mat((rng.next() - 0.5) * 0.03, 0, (rng.next() - 0.5) * 0.06)), { tint });
    }
  }
  const topY = courses * ch;
  // Corbelled crown: a jutting ring of blocks on stone brackets.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    b.add(stone, boxUV(roundedBox(0.92, 0.36, 0.7, 0.06, 1), 1.3), mat(Math.cos(a) * (R + 0.14), topY + 0.18, Math.sin(a) * (R + 0.14), 0, -a + Math.PI / 2, 0), { tint: new THREE.Color(0xb8ae98).multiplyScalar(0.85 + rng.next() * 0.2) });
    if (i % 2 === 0) b.add(stone, boxUV(roundedBox(0.26, 0.3, 0.4, 0.05, 1), 1), mat(Math.cos(a) * (R + 0.18), topY - 0.12, Math.sin(a) * (R + 0.18), 0, -a + Math.PI / 2, 0), { tint: 0xa89e88 });
  }
  // Slate cone roof, leaning a touch, with a finial holding a small ember.
  const roofH = 3.9;
  const roof = new THREE.ConeGeometry(R + 0.6, roofH, 24, 6, true);
  const rp = roof.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const y = rp.getY(i) + roofH / 2;
    const k = y / roofH;
    // Sagging, slightly bell-shaped eaves + a crooked tip.
    const flare = 1 + 0.12 * Math.pow(1 - k, 3);
    rp.setXYZ(i, rp.getX(i) * flare + k * k * 0.35, rp.getY(i) - Math.pow(1 - k, 4) * 0.2, rp.getZ(i) * flare + k * k * 0.15);
  }
  roof.computeVertexNormals();
  uvScale(roof, 5, 3.2);
  b.add('roofTile', roof, mat(0, topY + 0.36 + roofH / 2, 0), { tint: 0x55606c, aoWorld: (q) => 0.62 + 0.38 * THREE.MathUtils.smoothstep(q.y, topY + 0.4, topY + 1.4) });
  const tip = new THREE.Vector3(0.35, topY + 0.36 + roofH, 0.15);
  b.add('metal', new THREE.CylinderGeometry(0.035, 0.05, 0.9, 6), mat(tip.x, tip.y + 0.35, tip.z, 0, 0, -0.08), { tint: 0x3a3430 });
  b.add(emberMaterial(), new THREE.OctahedronGeometry(0.16, 0).scale(0.8, 1.6, 0.8), mat(tip.x + 0.06, tip.y + 0.92, tip.z));
  // Arched oak door with iron straps and a ring pull, a worn stone step.
  const da = door.a;
  const dw = door.w + 0.12;
  const planks = 5;
  for (let k = 0; k < planks; k++) {
    const a = da - dw + ((k + 0.5) / planks) * dw * 2;
    const ph = 2.05 - Math.pow((k + 0.5) / planks - 0.5, 2) * 1.6;
    b.add('wood', boxUV(roundedBox(dw * 2 * R / planks * 0.96, ph, 0.1, 0.02, 1), 1), mat(Math.cos(a) * (R - 0.12), ph / 2, Math.sin(a) * (R - 0.12), 0, -a + Math.PI / 2, 0), { tint: new THREE.Color(0x8a5a36).multiplyScalar(0.85 + rng.next() * 0.25) });
  }
  for (const y of [0.45, 1.5]) {
    for (let k = 0; k < 4; k++) {
      const a = da - dw * 0.8 + (k / 3) * dw * 1.6;
      b.add('metal', roundedBox(0.34, 0.07, 0.03, 0.01, 1), mat(Math.cos(a) * (R - 0.05), y, Math.sin(a) * (R - 0.05), 0, -a + Math.PI / 2, 0), { tint: 0x2e2a28 });
    }
  }
  b.add('metal', new THREE.TorusGeometry(0.09, 0.018, 6, 12), mat(Math.cos(da + 0.1) * (R - 0.02), 1.05, Math.sin(da + 0.1) * (R - 0.02), 0, -da, 0), { tint: 0x4a403a });
  b.add(stone, boxUV(roundedBox(1.5, 0.35, 1.3, 0.1), 1), mat(Math.cos(da) * (R - 0.1), 5 * ch + 0.18, Math.sin(da) * (R - 0.1), 0, -da + Math.PI / 2, 0), { tint: 0xb0a690 });
  b.add(stone, boxUV(roundedBox(1.3, 0.16, 0.7, 0.05), 1), mat(Math.cos(da) * (R + 0.45), 0.02, Math.sin(da) * (R + 0.45), 0, -da + Math.PI / 2, 0), { tint: 0xa09882 });
  // Lit window: glowing pane, oak frame with a cross muntin, stone sill + lintel.
  {
    const a = win.a;
    const wy = win.c0 * ch + ((win.c1 - win.c0 + 1) * ch) / 2;
    const ww = (win.w + 0.1) * 2 * R * 0.92;
    const wh = (win.c1 - win.c0 + 1) * ch;
    const rot = mat(Math.cos(a) * (R - 0.08), wy, Math.sin(a) * (R - 0.08), 0, -a + Math.PI / 2, 0);
    b.add(towerWindowMaterial(), new THREE.PlaneGeometry(ww, wh), rot);
    b.add('woodDark', roundedBox(0.07, wh, 0.08, 0.02, 1), rot.clone().multiply(mat(0, 0, 0.03)));
    b.add('woodDark', roundedBox(ww, 0.07, 0.08, 0.02, 1), rot.clone().multiply(mat(0, 0.05, 0.03)));
    b.add(stone, boxUV(roundedBox(ww + 0.35, 0.14, 0.75, 0.04, 1), 1), mat(Math.cos(a) * R, wy - wh / 2 - 0.05, Math.sin(a) * R, 0, -a + Math.PI / 2, 0), { tint: 0xb8ae98 });
    b.add(stone, boxUV(roundedBox(ww + 0.3, 0.2, 0.62, 0.04, 1), 1), mat(Math.cos(a) * R, wy + wh / 2 + 0.08, Math.sin(a) * R, 0, -a + Math.PI / 2, 0), { tint: 0xb0a690 });
  }
  b.add('woodDark', new THREE.CircleGeometry(R - 0.2, 20).rotateX(-Math.PI / 2), mat(0, 0.05, 0), { tint: 0x3a3028 });
  // Rubble at the foot.
  const rock = forestRockMaterial();
  for (let i = 0; i < 9; i++) {
    const a = 3.6 + rng.next() * 1.8;
    const d = R + 0.5 + rng.next() * 1.6;
    b.add(rock, smoothRock(rng, 0.2 + rng.next() * 0.2, { detail: 1 }), mat(Math.cos(a) * d, 0, Math.sin(a) * d, 0, rng.next() * 6, 0));
  }
  // Ivy over the sunny south-west face (leaves the door and window clear).
  towerIvy(b, rng, R, 2.35, 3.6, topY - 0.2);
  towerIvy(b, rng, R, 0.5, 1.02, topY - 1.5);
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
  const rock = forestRockMaterial();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const r = 0.7 + rng.next() * 0.5;
      b.add(rock, smoothRock(rng, r), mat(lip.x + side * (width * 0.62 + i * 0.7 + rng.next() * 0.3), lip.y - 0.35 - i * 0.2, lip.z - 0.3 + i * 0.5, 0, rng.next() * 6, 0));
    }
  }
  // Pool rim.
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * (0.05 + rng.next() * 0.9) + (i % 2 ? Math.PI : 0) * 0.15;
    const d = 3.2 + rng.next() * 1.4;
    const r = 0.35 + rng.next() * 0.55;
    b.add(rock, smoothRock(rng, r, { detail: 2 }), mat(pool.x + Math.cos(a) * d * 1.1, pool.y - 0.15, pool.z + Math.sin(a) * d * 0.5 - 1.6, 0, rng.next() * 6, 0));
  }
  // Rocks the falling water breaks over at the base.
  for (let i = 0; i < 4; i++) {
    b.add(rock, smoothRock(rng, 0.4 + rng.next() * 0.3, { detail: 2 }), mat(lip.x + (rng.next() - 0.5) * width * 1.1, pool.y - 0.3, pool.z - 0.6 + rng.next() * 0.6, 0, rng.next() * 6, 0));
  }
  return b.build({ name: 'falls-rocks' });
}

export function buildSteppingStones(rng: Rng, pts: [number, number][], y: number): THREE.Group {
  const b = new MeshBuilder();
  const rock = forestRockMaterial();
  for (const [x, z] of pts) {
    const g = smoothRock(rng, 0.42 + rng.next() * 0.1, { detail: 2, squash: 0.45, elong: 1.1 });
    b.add(rock, g, mat(x, y, z, 0, rng.next() * 6, 0));
  }
  return b.build({ name: 'stepping-stones' });
}
