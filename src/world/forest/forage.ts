/**
 * Seasonal forageables in Cindergrove. Every morning ~10 fresh finds appear at seeded spots on
 * the forest floor (never on paths / water): spring leeks, morels and violets; summer berries,
 * fiddleheads and sweet peas; autumn chanterelles, hazelnuts and ember caps; winter snow roots,
 * frost holly and crystal cones. Interact (right click / X) to pick: item + a little burst.
 * Visuals are batched instanced sets (one draw per material). Item defs are registered here.
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { Rng as RngClass } from '../../core/rng';
import type { Season } from '../../core/time';
import { MeshBuilder, mat, lumpySphere } from '../geom';
import { applyWorldFx } from '../../render/worldfx';
import { applyPlantLighting } from '../../render/foliage';
import { InstancedSet, type BatchPool, type InstancedPart } from '../props/instanced';
import { ITEMS, type ItemDef } from '../../data/items';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { registerForestIcons } from './icons';

export interface ForageDef {
  id: string;
  name: string;
  season: Season;
  sell: number;
  color: number;
  blurb: string;
}

export const FOREST_FORAGE: ForageDef[] = [
  { id: 'wildLeek', name: 'Wild Leek', season: 'spring', sell: 60, color: 0x9fd07a, blurb: 'Pungent and sweet. Grows where the stream mist settles.' },
  { id: 'morel', name: 'Morel', season: 'spring', sell: 150, color: 0xa8845a, blurb: 'A honeycombed prize from the damp roots of old elders.' },
  { id: 'duskViolet', name: 'Dusk Violet', season: 'spring', sell: 45, color: 0x9a6ad8, blurb: 'Smells faintly of rain on warm stone.' },
  { id: 'hedgeBerry', name: 'Hedge Berry', season: 'summer', sell: 50, color: 0xd8344a, blurb: 'Tart little berries the jays fight over.' },
  { id: 'fiddlehead', name: 'Fiddlehead', season: 'summer', sell: 90, color: 0x6fae45, blurb: 'A young fern still curled like a sleeping snail.' },
  { id: 'sweetPea', name: 'Sweet Pea', season: 'summer', sell: 50, color: 0xf29ac0, blurb: 'Frilly and fragrant. Villagers love it on the table.' },
  { id: 'chanterelle', name: 'Chanterelle', season: 'fall', sell: 160, color: 0xf0a83a, blurb: 'Golden, apricot-scented and worth the hunt.' },
  { id: 'hazelnut', name: 'Hazelnut', season: 'fall', sell: 90, color: 0x9a6a3a, blurb: 'Rattles in its husk when shaken.' },
  { id: 'emberCap', name: 'Ember Cap', season: 'fall', sell: 120, color: 0xe0502a, blurb: 'Glossy red caps said to grow where the old fire slept.' },
  { id: 'snowRoot', name: 'Snow Root', season: 'winter', sell: 70, color: 0xe8dcc8, blurb: 'Crisp, peppery root dug from under the frost.' },
  { id: 'frostHolly', name: 'Frost Holly', season: 'winter', sell: 80, color: 0x3f8a4a, blurb: 'Glossy leaves, blood-red berries, a rime of ice.' },
  { id: 'crystalCone', name: 'Crystal Cone', season: 'winter', sell: 110, color: 0xbfe0f0, blurb: 'A fir cone glazed in clear ice. It chimes when tapped.' },
];

// Register item defs (kind 'forage') and their hand-drawn icons (world/forest/icons.ts).
for (const f of FOREST_FORAGE) {
  if (!ITEMS[f.id]) ITEMS[f.id] = { id: f.id, name: f.name, kind: 'forage', icon: f.id, sell: f.sell, stack: 999, color: f.color, description: f.blurb } as ItemDef;
}
registerForestIcons();

let _mat: THREE.MeshStandardMaterial | null = null;
function forageMaterial(): THREE.MeshStandardMaterial {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, color: 0xffffff, side: THREE.DoubleSide });
  _mat.name = 'forage';
  applyWorldFx(_mat, { snowUp: 0.9 });
  applyPlantLighting(_mat, { translucency: 0.3, floor: 0.08 });
  // A warm view-rim + a faint self-lit floor: finds separate from the ferns / clover around them
  // (the eye catches the glowing edge before it parses the shape).
  patchMaterial(_mat, 'forage-rim', (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    let fs = shader.fragmentShader;
    if (!/uniform float uTime;/.test(fs)) fs = before(fs, 'void main() {', 'uniform float uTime;');
    shader.fragmentShader = after(
      fs,
      '#include <emissivemap_fragment>',
      `{
        float fr = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 2.2);
        float pulse = 0.75 + 0.25 * sin(uTime * 2.4);
        totalEmissiveRadiance += vColor.rgb * (0.12 + fr * 0.55 * pulse) + vec3(1.0, 0.9, 0.6) * fr * 0.18 * pulse;
      }`,
    );
  });
  return _mat;
}

function blade(len: number, w: number, bend: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, len, 1, 4);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / len;
    p.setZ(i, y * y * bend);
    p.setX(i, p.getX(i) * (1 - y * 0.7));
  }
  g.computeVertexNormals();
  return g;
}

function build(id: string, r: Rng): InstancedPart[] {
  const b = new MeshBuilder();
  const m = forageMaterial();
  const C = (h: number) => new THREE.Color(h);
  switch (id) {
    case 'wildLeek':
      for (let i = 0; i < 4; i++) b.add(m, blade(0.42 + r.next() * 0.15, 0.07, 0.12), mat(0, 0.04, 0, 0, (i / 4) * Math.PI * 2 + r.next(), 0).multiply(mat(0, 0, 0, -0.18, 0, 0)), { tint: C(0x6fbf4a) });
      b.add(m, lumpySphere(0.06, 1, 0.1, r).scale(1, 1.2, 1), mat(0, 0.04, 0), { tint: C(0xf4f0e0) });
      break;
    case 'morel': {
      const cap = new THREE.ConeGeometry(0.08, 0.2, 9, 4);
      const p = cap.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const s = 1 + (Math.sin(p.getY(i) * 60) * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 7)) * 0.12;
        p.setX(i, p.getX(i) * s);
        p.setZ(i, p.getZ(i) * s);
      }
      cap.computeVertexNormals();
      b.add(m, new THREE.CylinderGeometry(0.035, 0.045, 0.1, 7), mat(0, 0.05, 0), { tint: C(0xf0e4c8) });
      b.add(m, cap, mat(0, 0.2, 0), { tint: C(0x9a7248) });
      break;
    }
    case 'duskViolet':
    case 'sweetPea': {
      const pc = id === 'duskViolet' ? C(0x9a62e0) : C(0xf49ac4);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const x = Math.cos(a) * 0.09;
        const z = Math.sin(a) * 0.09;
        const h = 0.14 + r.next() * 0.1;
        b.add(m, new THREE.CylinderGeometry(0.008, 0.01, h, 4).translate(0, h / 2, 0), mat(x, 0, z), { tint: C(0x4f8a34) });
        for (let k = 0; k < 4; k++) {
          const petal = new THREE.CircleGeometry(0.035, 5);
          petal.translate(0.03, 0, 0);
          b.add(m, petal, mat(x, h, z, -Math.PI / 2 + 0.4, (k / 4) * Math.PI * 2, 0), { tint: pc.clone().offsetHSL(0, 0, (r.next() - 0.5) * 0.08) });
        }
        b.add(m, new THREE.SphereGeometry(0.015, 5, 3), mat(x, h + 0.01, z), { tint: C(0xffe070) });
      }
      for (let i = 0; i < 5; i++) b.add(m, blade(0.16, 0.06, 0.06), mat(0, 0, 0, -0.9, i * 1.3, 0), { tint: C(0x5a9a3a) });
      break;
    }
    case 'hedgeBerry':
    case 'frostHolly': {
      const leaf = id === 'frostHolly' ? C(0x2f7a42) : C(0x4f9a38);
      for (let i = 0; i < 7; i++) {
        const lg = new THREE.CircleGeometry(0.09, 6);
        lg.scale(0.5, 1, 1);
        lg.translate(0, 0.09, 0);
        b.add(m, lg, mat(0, 0.05, 0, -0.9 + r.next() * 0.3, (i / 7) * Math.PI * 2, 0), { tint: leaf.clone().offsetHSL(0, 0, (r.next() - 0.5) * 0.1) });
      }
      for (let i = 0; i < 9; i++) {
        const a = r.next() * Math.PI * 2;
        const d = r.next() * 0.1;
        b.add(m, new THREE.SphereGeometry(0.032, 7, 5), mat(Math.cos(a) * d, 0.12 + r.next() * 0.06, Math.sin(a) * d), { tint: id === 'frostHolly' ? C(0xd8202c) : C(0xc8283e) });
      }
      break;
    }
    case 'fiddlehead':
      for (let i = 0; i < 3; i++) {
        const t = new THREE.TorusGeometry(0.05, 0.016, 5, 10, Math.PI * 1.6);
        const h = 0.18 + r.next() * 0.08;
        b.add(m, new THREE.CylinderGeometry(0.012, 0.016, h, 5).translate(0, h / 2, 0), mat((i - 1) * 0.06, 0, 0, 0, 0, (i - 1) * 0.2), { tint: C(0x6fae45) });
        b.add(m, t, mat((i - 1) * 0.08, h + 0.03, 0, 0, Math.PI / 2, 0), { tint: C(0x7fbe4f) });
      }
      break;
    case 'chanterelle':
    case 'emberCap':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r.next();
        const d = i === 0 ? 0 : 0.08;
        const h = 0.08 + r.next() * 0.05;
        const s = i === 0 ? 1 : 0.7;
        const col = id === 'chanterelle' ? C(0xf2a838) : C(0xd8401e);
        b.add(m, new THREE.CylinderGeometry(0.02 * s, 0.028 * s, h, 6).translate(0, h / 2, 0), mat(Math.cos(a) * d, 0, Math.sin(a) * d), { tint: id === 'chanterelle' ? col : C(0xf4ead8) });
        const cap = id === 'chanterelle' ? new THREE.CylinderGeometry(0.07 * s, 0.02 * s, 0.05, 9, 1, true) : new THREE.SphereGeometry(0.075 * s, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
        b.add(m, cap, mat(Math.cos(a) * d, h + (id === 'chanterelle' ? 0.02 : 0), Math.sin(a) * d), { tint: col });
      }
      break;
    case 'hazelnut':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        b.add(m, lumpySphere(0.045, 1, 0.08, r).scale(1, 1.15, 1), mat(Math.cos(a) * 0.06, 0.045, Math.sin(a) * 0.06), { tint: C(0x9a6a3a) });
        b.add(m, blade(0.07, 0.07, 0.02), mat(Math.cos(a) * 0.06, 0.07, Math.sin(a) * 0.06, 0, a, 0), { tint: C(0x8aa04a) });
      }
      break;
    case 'snowRoot':
      b.add(m, new THREE.ConeGeometry(0.05, 0.22, 7).rotateX(Math.PI).translate(0, 0.02, 0), mat(0, 0, 0, 1.3, 0.4, 0), { tint: C(0xe8d8c0) });
      for (let i = 0; i < 3; i++) b.add(m, blade(0.14, 0.05, 0.08), mat(0.08, 0.05, 0, -0.3, i * 2, 0), { tint: C(0x7a8a5a) });
      break;
    case 'crystalCone': {
      const cone = lumpySphere(0.07, 1, 0.25, r, 3).scale(1, 1.6, 1);
      b.add(m, cone, mat(0, 0.08, 0, 1.2, 0, 0.3), { tint: C(0x9a7050) });
      b.add(m, new THREE.OctahedronGeometry(0.05, 0).scale(1, 1.8, 1), mat(0.05, 0.13, 0.02, 0.3, 0, 0.2), { tint: C(0xd8f4ff) });
      b.add(m, new THREE.OctahedronGeometry(0.035, 0).scale(1, 1.8, 1), mat(-0.05, 0.1, 0.03, -0.3, 0, -0.2), { tint: C(0xd8f4ff) });
      break;
    }
  }
  return [...b.geometries()].map(([mm, geo]) => ({ geometry: geo, material: mm as THREE.Material, castShadow: false }));
}

export interface ForageSpot {
  x: number;
  y: number;
  z: number;
}

export interface ForageItem {
  def: ForageDef;
  tx: number;
  tz: number;
  set: InstancedSet;
  id: number;
  pos: THREE.Vector3;
  /** Resting transform (bob / pop animate around it). */
  rot: number;
  /** Per-item phase for the bob and the glint. */
  phase: number;
}

/** Tile key shared by the field, the grid and the co-op ledger. */
export const forageKey = (tx: number, tz: number): number => tz * 4096 + tx;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** Finds read from across the clearing (~1.4x the old 1.35: a hazelnut was a 20 px blob). */
const SCALE = 1.9;

// ───────────────────────────────────────────── glints

/**
 * One point per find: a soft warm halo on the ground-cover and a 4-point star that flashes every
 * 2-3 s (phase-offset per item) so a find reads from across the clearing. One draw call.
 */
class ForageGlints {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private ph: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  readonly max = 32;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 3);
    this.ph = new Float32Array(this.max);
    this.col = new Float32Array(this.max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aPhase', new THREE.BufferAttribute(this.ph, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime, uPx: { value: 1080 }, uNight: globalUniforms.uNight },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uPx;
        varying float vFlash;
        varying float vHalo;
        varying vec3 vCol;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Draw a little in front so the halo is not eaten by the find's own leaves.
          gl_Position.z -= 0.002 * gl_Position.w;
          float period = 2.2 + fract(aPhase * 7.13) * 0.9;
          float c = fract(uTime / period + aPhase);
          vFlash = smoothstep(0.0, 0.05, c) * (1.0 - smoothstep(0.05, 0.26, c));
          vHalo = 0.55 + 0.45 * sin(uTime * 2.4 + aPhase * 6.28);
          vCol = aColor;
          // ~64 px at 1080p gameplay zoom, capped so it never balloons near the camera.
          gl_PointSize = clamp(uPx * 1.25 / -mv.z, 18.0, 90.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vFlash;
        varying float vHalo;
        varying vec3 vCol;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          // Soft halo (the find's colour, warmed), strongest at night.
          float halo = exp(-r * r * 5.0) * (0.11 + vHalo * 0.07) * (1.0 + uNight * 1.2);
          // 4-point star: two thin crossed lobes + a hot core, rotated 20 deg.
          vec2 q = mat2(0.94, -0.34, 0.34, 0.94) * p;
          float star = (exp(-abs(q.x) * 26.0) * exp(-abs(q.y) * 3.2) + exp(-abs(q.y) * 26.0) * exp(-abs(q.x) * 3.2)) * 0.9;
          star += exp(-r * r * 60.0) * 1.2;
          vec3 c = mix(vCol, vec3(1.0, 0.95, 0.8), 0.55) * halo + vec3(1.0, 0.97, 0.86) * star * vFlash;
          if (max(c.r, max(c.g, c.b)) < 0.003) discard;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.name = 'forage-glints';
    this.points.userData.perfTag = 'fx';
    this.points.userData.noAO = true;
  }

  set(items: Iterable<ForageItem>, pxHeight: number): void {
    let n = 0;
    for (const it of items) {
      if (n >= this.max) break;
      this.pos[n * 3] = it.pos.x;
      this.pos[n * 3 + 1] = it.pos.y + 0.24;
      this.pos[n * 3 + 2] = it.pos.z;
      this.ph[n] = it.phase;
      const c = new THREE.Color(it.def.color);
      this.col[n * 3] = c.r;
      this.col[n * 3 + 1] = c.g;
      this.col[n * 3 + 2] = c.b;
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aPhase', 'aColor']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    ((this.points.material as THREE.ShaderMaterial).uniforms.uPx!.value as number) = pxHeight;
  }

  setPx(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uPx!.value = px;
  }
}

// ───────────────────────────────────────────── contact shadows

/**
 * A soft, slightly squashed dark blob under every find (one draw): it sits the find on the ground
 * and separates it from grass of the same value.
 */
class ForageShadows {
  readonly points: THREE.Points;
  private pos = new Float32Array(32 * 3);
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPx: { value: 1080 } },
      vertexShader: /* glsl */ `
        uniform float uPx;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z -= 0.001 * gl_Position.w;
          gl_PointSize = clamp(uPx * 0.95 / -mv.z, 8.0, 80.0);
        }`,
      fragmentShader: /* glsl */ `
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          p.y *= 1.55;
          float a = exp(-dot(p, p) * 3.2) * 0.42;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.06, 0.05, 0.02, a);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.name = 'forage-shadows';
    this.points.userData.perfTag = 'fx';
    this.points.userData.noAO = true;
  }

  set(items: Iterable<ForageItem>, pxHeight: number): void {
    let n = 0;
    for (const it of items) {
      if (n >= 32) break;
      this.pos[n * 3] = it.pos.x;
      this.pos[n * 3 + 1] = it.pos.y + 0.03;
      this.pos[n * 3 + 2] = it.pos.z;
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.uPx!.value = pxHeight;
  }
}

// ───────────────────────────────────────────── pluck burst

/**
 * Leaf / petal burst for a pluck: ~26 tumbling cards (3x the old specks) in the find's colours +
 * forest greens, flung up and out, fluttering down. One instanced draw.
 */
class LeafBurst {
  readonly mesh: THREE.InstancedMesh;
  private max = 96;
  private n = 0;
  private p: { pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; life: number; age: number; s: number }[] = [];

  constructor() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.5);
    shape.quadraticCurveTo(0.42, -0.1, 0, 0.5);
    shape.quadraticCurveTo(-0.42, -0.1, 0, -0.5);
    const g = new THREE.ShapeGeometry(shape, 4);
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7, color: 0xffffff });
    m.name = 'forage-burst';
    applyWorldFx(m, { snow: false });
    applyPlantLighting(m, { translucency: 0.5, floor: 0.12 });
    this.mesh = new THREE.InstancedMesh(g, m, this.max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'forage-burst';
    this.mesh.userData.perfTag = 'fx';
    this.mesh.userData.noAO = true;
  }

  emit(at: THREE.Vector3, colors: number[], count = 26): void {
    for (let i = 0; i < count; i++) {
      if (this.p.length >= this.max) this.p.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = 0.9 + Math.random() * 1.6;
      this.p.push({
        pos: at.clone().add(new THREE.Vector3(Math.cos(a) * 0.08, 0.05 + Math.random() * 0.1, Math.sin(a) * 0.08)),
        vel: new THREE.Vector3(Math.cos(a) * sp, 2.2 + Math.random() * 1.8, Math.sin(a) * sp),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14),
        life: 1.1 + Math.random() * 0.7,
        age: 0,
        s: 0.07 + Math.random() * 0.07,
      });
      const c = new THREE.Color(colors[i % colors.length]!).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.12);
      (this.p[this.p.length - 1] as unknown as { c: THREE.Color }).c = c;
    }
  }

  update(dt: number): void {
    let n = 0;
    const out = this.p;
    for (let i = out.length - 1; i >= 0; i--) {
      const q = out[i]!;
      q.age += dt;
      if (q.age >= q.life) {
        out.splice(i, 1);
        continue;
      }
      // Flutter: heavy drag once falling, sideways sway.
      q.vel.y -= 7.5 * dt;
      const drag = q.vel.y < 0 ? 4.2 : 1.2;
      q.vel.multiplyScalar(Math.exp(-drag * dt));
      q.pos.addScaledVector(q.vel, dt);
      q.pos.x += Math.sin(q.age * 9 + i) * dt * 0.35;
      q.rot.x += q.spin.x * dt;
      q.rot.y += q.spin.y * dt;
      q.rot.z += q.spin.z * dt;
    }
    for (const q of out) {
      if (n >= this.max) break;
      const k = q.age / q.life;
      const s = q.s * (k < 0.1 ? k / 0.1 : 1) * (1 - Math.max(0, k - 0.75) / 0.25);
      _m.compose(q.pos, _q.setFromEuler(q.rot), _s.set(s, s, s));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, (q as unknown as { c: THREE.Color }).c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}

// ───────────────────────────────────────────── field

interface Pop {
  it: ForageItem;
  t: number;
  onDone: (world: THREE.Vector3) => void;
}

export class ForageField {
  private sets = new Map<string, InstancedSet>();
  readonly items = new Map<number, ForageItem>();
  readonly group = new THREE.Group();
  private glints = new ForageGlints();
  private shadows = new ForageShadows();
  private burst = new LeafBurst();
  private pops: Pop[] = [];
  private dirty = true;
  private px = 1080;

  constructor(
    private pool: BatchPool,
    private rng: Rng,
  ) {
    this.group.name = 'forage-fx';
    this.group.add(this.shadows.points, this.glints.points, this.burst.mesh);
  }

  private setFor(id: string): InstancedSet {
    let s = this.sets.get(id);
    if (!s) {
      s = new InstancedSet(`forage-${id}`, build(id, this.rng.fork(`forage-${id}`)), this.pool);
      this.sets.set(id, s);
    }
    return s;
  }

  /**
   * Remove everything: visuals AND the tile claims (`release(tx, tz)` for each live find, so the
   * grid never keeps ghost entries from an earlier day).
   */
  clear(release?: (tx: number, tz: number) => void): void {
    for (const it of this.items.values()) {
      release?.(it.tx, it.tz);
      it.set.remove(it.id);
    }
    this.items.clear();
    for (const p of this.pops) p.it.set.remove(p.it.id);
    this.pops = [];
    this.dirty = true;
  }

  /**
   * Fresh finds for a day: `count` picks from the season's table at seeded spots.
   * `claim` reserves a tile (returns false if occupied / already picked); `release` frees the
   * tiles of the previous day's finds first.
   */
  spawn(seedKey: string, season: Season, spots: ForageSpot[], count: number, claim: (tx: number, tz: number, item: ForageItem) => boolean | 'picked', release?: (tx: number, tz: number) => void): void {
    this.clear(release);
    const table = FOREST_FORAGE.filter((f) => f.season === season);
    if (!table.length || !spots.length) return;
    const r = new RngClass(seedKey);
    const order = r.shuffle(spots.map((_, i) => i));
    let placed = 0;
    for (const i of order) {
      if (placed >= count) break;
      const s = spots[i]!;
      const def = table[Math.floor(r.next() * table.length)]!;
      const tx = Math.floor(s.x);
      const tz = Math.floor(s.z);
      const rot = r.next() * 6.28;
      // Every machine rolls the same list: the tile claim may still refuse (a picked tile in co-op).
      const item: ForageItem = { def, tx, tz, set: null as unknown as InstancedSet, id: -1, pos: new THREE.Vector3(s.x, s.y, s.z), rot, phase: r.next() };
      if (this.items.has(forageKey(tx, tz))) continue;
      const c = claim(tx, tz, item);
      if (c === 'picked') {
        // Already picked today (co-op ledger): it still counts, so every farmer rolls the same set.
        placed++;
        continue;
      }
      if (!c) continue;
      item.set = this.setFor(def.id);
      item.id = item.set.add(this.rest(item, 0));
      this.items.set(forageKey(tx, tz), item);
      placed++;
    }
    this.dirty = true;
  }

  private rest(it: ForageItem, t: number): THREE.Matrix4 {
    // A 0.5 Hz breathing bob + sway: the find swells and lifts a hair on every beat (alive and
    // "pick me", like a forage twinkle), but stays planted on its contact shadow.
    const b = Math.sin(t * Math.PI + it.phase * 6.28);
    const s = SCALE * (1 + b * 0.05);
    _q.setFromAxisAngle(UP, it.rot + Math.sin(t * 0.8 + it.phase * 9) * 0.1);
    return _m.compose(_v.set(it.pos.x, it.pos.y - 0.01 + Math.max(0, b) * 0.035, it.pos.z), _q, _s.set(s, s * (1 + b * 0.07), s));
  }

  /** Remove a find from the field (its visual stays until `pluck` / `drop`). */
  take(tx: number, tz: number): ForageItem | null {
    const k = forageKey(tx, tz);
    const it = this.items.get(k);
    if (!it) return null;
    this.items.delete(k);
    this.dirty = true;
    return it;
  }

  /** Drop a taken find's visual right away (someone else picked it / the day rolled over). */
  drop(it: ForageItem): void {
    it.set.remove(it.id);
  }

  /** Remove the find at a tile (visual included), e.g. when another farmer picked it. */
  remove(tx: number, tz: number): ForageItem | null {
    const it = this.take(tx, tz);
    if (it) this.drop(it);
    return it;
  }

  /**
   * The pluck: squash into the ground (0.08 s), pop half a tile up with a stretch and a spin,
   * hang for a beat, then `onDone(worldPos)` (the caller flies the icon to the toolbar).
   * A leaf / petal burst fires at the pop.
   */
  pluck(it: ForageItem, onDone: (world: THREE.Vector3) => void): void {
    this.pops.push({ it, t: 0, onDone });
    this.burstAt(it, 1);
  }

  /** A burst of leaves in the find's colours (1 = a full pluck, less for someone else's). */
  burstAt(it: ForageItem, k: number): void {
    const greens = [0x5a9a3a, 0x7fbe4f, 0x4f8a34];
    this.burst.emit(it.pos.clone().setY(it.pos.y + 0.12), [it.def.color, it.def.color, ...greens], Math.round(26 * k));
  }

  update(dt: number, t: number, pxHeight: number): void {
    for (const it of this.items.values()) it.set.setMatrix(it.id, this.rest(it, t));
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]!;
      p.t += dt;
      const it = p.it;
      const T = p.t;
      let y = 0;
      let sy = 1;
      let sx = 1;
      let spin = 0;
      if (T < 0.08) {
        const k = T / 0.08;
        sy = 1 - 0.3 * k;
        sx = 1 + 0.18 * k;
      } else {
        const k = Math.min(1, (T - 0.08) / 0.24);
        const e = 1 - Math.pow(1 - k, 3);
        y = 0.55 * e;
        sy = 1 + 0.35 * (1 - k) - 0.05;
        sx = 1 - 0.15 * (1 - k);
        spin = e * 3.4;
      }
      const s = SCALE * 1.25;
      _q.setFromAxisAngle(UP, it.rot + spin);
      it.set.setMatrix(it.id, _m.compose(_v.set(it.pos.x, it.pos.y + y, it.pos.z), _q, _s.set(s * sx, s * sy, s * sx)));
      if (T >= 0.46) {
        this.pops.splice(i, 1);
        it.set.remove(it.id);
        p.onDone(new THREE.Vector3(it.pos.x, it.pos.y + 0.55 + 0.1, it.pos.z));
      }
    }
    if (this.dirty || pxHeight !== this.px) {
      this.px = pxHeight;
      this.glints.set(this.items.values(), pxHeight);
      this.shadows.set(this.items.values(), pxHeight);
      this.dirty = false;
    }
    this.burst.update(dt);
  }
}
