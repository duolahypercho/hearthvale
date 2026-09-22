/**
 * Procedural crop meshes: 5 distinct growth stages per crop (seeded → sprout → young →
 * nearly ripe → ripe with produce), two random variants each, all vertex-coloured and
 * merged into ONE batched material (wind sway, snow, back-lit leaf translucency).
 *
 *   const cv = new CropVisuals();  root.add(cv.group);
 *   const h = cv.add('cauliflower', 3, x, y, z, seed);  cv.remove(h);
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { CropId } from '../../data/crops';
import { MeshBuilder, lumpySphere, mat } from '../geom';
import { applyWorldFx } from '../../render/worldfx';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyPlantLighting } from '../../render/foliage';
import { BatchPool, InstancedSet } from './instanced';

const C = (h: number): THREE.Color => new THREE.Color(h);

interface LeafOpts {
  bend?: number; // droop of the tip (0..1)
  lift?: number; // how steeply the leaf rises (0 flat .. 1.2 upright)
  fold?: number; // V-fold along the midrib
  shape?: 'oval' | 'lance' | 'round' | 'ribbon' | 'heart';
  serrate?: number;
  c0: THREE.Color;
  c1: THREE.Color;
  segs?: number;
}

/** A leaf growing along +Z from the origin (midrib + two halves, vertex coloured). */
function leafGeo(len: number, width: number, o: LeafOpts): THREE.BufferGeometry {
  const segs = o.segs ?? 6;
  const lift = o.lift ?? 0.6;
  const bend = o.bend ?? 0.4;
  const fold = o.fold ?? 0.25;
  const pos: number[] = [];
  const col: number[] = [];
  const rows: { l: THREE.Vector3; m: THREE.Vector3; r: THREE.Vector3; t: number }[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let w: number;
    switch (o.shape ?? 'oval') {
      case 'lance':
        w = Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - t * 0.35);
        break;
      case 'round':
        w = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1.1, 2)));
        break;
      case 'ribbon':
        w = (1 - t * 0.85) * Math.min(1, t * 8);
        break;
      case 'heart':
        w = Math.sin(Math.PI * Math.pow(t, 0.55)) * (1 - t * 0.2);
        break;
      default:
        w = Math.pow(Math.sin(Math.PI * t), 0.8);
    }
    if (o.serrate) w *= 1 + o.serrate * Math.sin(t * Math.PI * 9) * t;
    w *= width * 0.5;
    const z = t * len * (1 - bend * 0.25 * t);
    const y = len * (t * lift * 0.9 - t * t * bend * 0.9);
    const m = new THREE.Vector3(0, y, z);
    rows.push({ l: new THREE.Vector3(-w, y - w * fold, z), m, r: new THREE.Vector3(w, y - w * fold, z), t });
  }
  const push = (v: THREE.Vector3, c: THREE.Color): void => {
    pos.push(v.x, v.y, v.z);
    col.push(c.r, c.g, c.b);
  };
  const colAt = (t: number, edge: boolean): THREE.Color => {
    const c = o.c0.clone().lerp(o.c1, THREE.MathUtils.smoothstep(t, 0, 1));
    if (!edge) c.multiplyScalar(1.12);
    return c.multiplyScalar(0.72 + 0.28 * Math.min(1, t * 3));
  };
  for (let i = 0; i < segs; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    for (const [e0, e1] of [[a.l, b.l], [a.r, b.r]] as const) {
      push(e0, colAt(a.t, true));
      push(a.m, colAt(a.t, false));
      push(b.m, colAt(b.t, false));
      push(e0, colAt(a.t, true));
      push(b.m, colAt(b.t, false));
      push(e1, colAt(b.t, true));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i);
    if (n.y < 0) n.negate();
    n.lerp(new THREE.Vector3(0, 1, 0), 0.35).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function colored(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const c = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const cc = fn(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i));
    c[i * 3] = cc.r;
    c[i * 3 + 1] = cc.g;
    c[i * 3 + 2] = cc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** Shaded sphere-ish fruit: base colour with a darker underside and a soft highlight. */
function fruit(r: number, base: THREE.Color, opts: { sy?: number; ribs?: number; seg?: number; spots?: THREE.Color } = {}): THREE.BufferGeometry {
  const seg = opts.seg ?? 10;
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (opts.ribs) {
      const a = Math.atan2(p.z, p.x);
      const k = 1 - 0.09 * (0.5 - 0.5 * Math.cos(a * opts.ribs));
      p.x *= k;
      p.z *= k;
    }
    p.y *= opts.sy ?? 1;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return colored(g, (q, n) => {
    const c = base.clone().multiplyScalar(0.62 + 0.38 * THREE.MathUtils.smoothstep(n.y, -0.8, 0.7));
    if (opts.ribs) {
      const a = Math.atan2(q.z, q.x);
      c.multiplyScalar(0.86 + 0.14 * (0.5 + 0.5 * Math.cos(a * opts.ribs)));
    }
    if (opts.spots && Math.sin(q.x * 90) * Math.sin(q.y * 80) * Math.sin(q.z * 85) > 0.55) c.copy(opts.spots);
    return c;
  });
}

function stalk(h: number, r0: number, r1: number, c0: THREE.Color, c1: THREE.Color, lean = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 3);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + Math.pow(y / h, 2) * lean);
  }
  g.computeVertexNormals();
  return colored(g, (p) => c0.clone().lerp(c1, p.y / h));
}

type Adder = (g: THREE.BufferGeometry, m?: THREE.Matrix4) => void;

function rosette(add: Adder, r: Rng, n: number, len: number, width: number, o: LeafOpts, spin = 0, y = 0): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + spin + (r.next() - 0.5) * 0.5;
    const l = len * (0.8 + r.next() * 0.4);
    const g = leafGeo(l, width * (0.85 + r.next() * 0.3), { ...o, lift: (o.lift ?? 0.6) * (0.8 + r.next() * 0.4) });
    add(g, mat(0, y, 0, 0, a, 0));
  }
}

const GREEN = { dark: C(0x2f6a2a), mid: C(0x4f9a3a), light: C(0x8cc85a), blue: C(0x5a8f7a), blueL: C(0x9cc4a8), yellow: C(0xb8cf5a) };

/** Stage 0: freshly sown — a little seed mound with a couple of seeds showing. */
function seeded(add: Adder, r: Rng): void {
  const mound = new THREE.SphereGeometry(0.12, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1, 0.28, 1);
  add(colored(mound, (p) => C(0x5a3a24).multiplyScalar(0.8 + p.y * 3)));
  for (let i = 0; i < 3; i++) {
    const s = new THREE.SphereGeometry(0.018, 6, 4);
    s.scale(1, 0.6, 1.3);
    add(colored(s, () => C(0xe0c890)), mat((r.next() - 0.5) * 0.12, 0.03, (r.next() - 0.5) * 0.12, 0, r.next() * 3, 0));
  }
}

/** Stage 1: sprout — two round seed leaves on a short stem. */
function sprout(add: Adder, r: Rng, scale = 1): void {
  seeded(add, r);
  add(stalk(0.08 * scale, 0.008, 0.006, GREEN.mid, GREEN.light));
  for (const a of [0, Math.PI]) {
    add(leafGeo(0.09 * scale, 0.07 * scale, { shape: 'round', lift: 0.25, bend: 0.1, c0: GREEN.mid, c1: GREEN.light, segs: 4 }), mat(0, 0.075 * scale, 0, 0, a + r.next() * 0.3, 0));
  }
}

function buildCrop(id: CropId, stage: number, r: Rng): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const M = 'crop' as unknown as THREE.Material;
  const add: Adder = (g, m) => {
    b.add(M, g, m);
  };
  if (stage === 0) {
    seeded(add, r);
  } else if (stage === 1) {
    sprout(add, r, id === 'corn' || id === 'sunflower' || id === 'pumpkin' ? 1.3 : 1);
  } else {
    const k = stage - 2; // 0 young, 1 nearly ripe, 2 ripe
    switch (id) {
      case 'parsnip': {
        rosette(add, r, 4 + k * 2, 0.2 + k * 0.1, 0.07, { shape: 'lance', serrate: 0.35, lift: 1.1, bend: 0.5, c0: GREEN.mid, c1: GREEN.light });
        if (k === 2) {
          const root = new THREE.ConeGeometry(0.075, 0.2, 10, 2, true);
          root.rotateX(Math.PI);
          root.translate(0, 0.02, 0);
          add(colored(root, (p) => C(0xf0dca0).multiplyScalar(0.85 + p.y * 1.5)));
          const cap = new THREE.SphereGeometry(0.075, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
          cap.scale(1, 0.4, 1);
          cap.translate(0, 0.12, 0);
          add(colored(cap, () => C(0xf5e4b0)));
        }
        break;
      }
      case 'potato': {
        rosette(add, r, 5 + k * 2, 0.17 + k * 0.07, 0.11, { shape: 'oval', lift: 0.75, bend: 0.35, fold: 0.3, c0: GREEN.dark, c1: GREEN.mid });
        rosette(add, r, 3 + k, 0.12 + k * 0.05, 0.1, { shape: 'oval', lift: 1.0, bend: 0.3, c0: GREEN.mid, c1: GREEN.light }, 0.6, 0.06 + k * 0.04);
        if (k >= 1) {
          for (let i = 0; i < 3 + k; i++) {
            const a = r.next() * Math.PI * 2;
            const fl = fruit(0.028, C(0xf4f0ff), { seg: 6 });
            add(fl, mat(Math.cos(a) * 0.1, 0.22 + k * 0.06 + r.next() * 0.04, Math.sin(a) * 0.1));
          }
        }
        if (k === 2) {
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + r.next();
            add(lumpySphereColored(0.06 + r.next() * 0.02, C(0xc8955a), r), mat(Math.cos(a) * 0.2, 0.01, Math.sin(a) * 0.2, 0, 0, 0, 1, 0.7, 1));
          }
        }
        break;
      }
      case 'cauliflower': {
        rosette(add, r, 5 + k * 2, 0.22 + k * 0.1, 0.16, { shape: 'oval', lift: 0.8 + k * 0.1, bend: 0.4, fold: 0.35, c0: GREEN.blue, c1: GREEN.blueL });
        if (k >= 1) {
          const head = lumpySphereColored(0.1 + k * 0.05, C(0xf4efdc), r, 5.5, 0.14);
          add(head, mat(0, 0.07 + k * 0.03, 0, 0, 0, 0, 1, 0.72, 1));
          rosette(add, r, 5, 0.16 + k * 0.05, 0.13, { shape: 'oval', lift: 1.2, bend: 0.2, fold: 0.5, c0: GREEN.blue, c1: GREEN.blueL }, 0.3, 0.02);
        }
        break;
      }
      case 'kale': {
        for (let t = 0; t < 2 + k; t++) {
          rosette(add, r, 5, 0.18 + k * 0.07 - t * 0.03, 0.1, { shape: 'lance', serrate: 0.6, lift: 1.0 + t * 0.2, bend: 0.55, fold: 0.4, c0: C(0x2c5a44), c1: C(0x5a8f78) }, t * 0.7, t * 0.05);
        }
        break;
      }
      case 'strawberry': {
        for (let i = 0; i < 4 + k * 2; i++) {
          const a = (i / (4 + k * 2)) * Math.PI * 2 + r.next();
          const stemL = 0.1 + k * 0.03;
          const m = mat(0, 0, 0, 0, a, 0);
          add(stalk(stemL, 0.006, 0.005, GREEN.mid, GREEN.mid, 0.05), m);
          for (const la of [-0.7, 0, 0.7]) {
            add(leafGeo(0.07 + k * 0.015, 0.06, { shape: 'round', lift: 0.25, bend: 0.2, serrate: 0.3, c0: GREEN.dark, c1: GREEN.mid, segs: 4 }), m.clone().multiply(mat(0, stemL, 0.04, 0, la, 0)));
          }
        }
        if (k >= 1) {
          for (let i = 0; i < 2 + k * 2; i++) {
            const a = r.next() * Math.PI * 2;
            const ripe = k === 2 && r.next() < 0.8;
            if (!ripe && k === 1 && r.next() < 0.5) {
              add(fruit(0.022, C(0xffffff), { seg: 6 }), mat(Math.cos(a) * 0.14, 0.08, Math.sin(a) * 0.14));
              continue;
            }
            const berry = fruit(0.035, ripe ? C(0xd8202c) : C(0xa8d070), { sy: 1.3, spots: C(0xf0e090), seg: 8 });
            add(berry, mat(Math.cos(a) * 0.17, 0.035, Math.sin(a) * 0.17, Math.PI, 0, 0));
          }
        }
        break;
      }
      case 'tomato': {
        const h = 0.35 + k * 0.22;
        add(stalk(h + 0.15, 0.018, 0.014, C(0x9a7a50), C(0xb89468)), mat(0.05, -0.05, 0));
        add(stalk(h, 0.014, 0.008, GREEN.dark, GREEN.mid, 0.03));
        const tiers = 2 + k;
        for (let t = 0; t < tiers; t++) {
          const y = (t / tiers) * h * 0.9 + 0.05;
          rosette(add, r, 3, 0.13 + (1 - t / tiers) * 0.06, 0.09, { shape: 'lance', serrate: 0.4, lift: 0.3, bend: 0.5, fold: 0.3, c0: GREEN.dark, c1: GREEN.mid }, t * 1.1, y);
        }
        if (k >= 1) {
          for (let i = 0; i < 3 + k * 2; i++) {
            const a = r.next() * Math.PI * 2;
            const y = h * (0.35 + r.next() * 0.5);
            const ripe = k === 2 ? r.next() < 0.85 : r.next() < 0.2;
            add(fruit(0.045, ripe ? C(0xe0301e) : C(0x7fb040), { sy: 0.85, ribs: 5 }), mat(Math.cos(a) * 0.1, y, Math.sin(a) * 0.1));
          }
        }
        break;
      }
      case 'corn': {
        const h = 0.55 + k * 0.45;
        for (const [ox, oz] of [[0, 0], [0.06, 0.04]] as const) {
          const hh = h * (ox ? 0.85 : 1);
          add(stalk(hh, 0.02, 0.012, C(0x6f9a3a), C(0x9ac25a), 0.03), mat(ox, 0, oz));
          for (let i = 0; i < 4 + k * 2; i++) {
            const y = (i / (4 + k * 2)) * hh * 0.85 + 0.08;
            add(leafGeo(0.3 + k * 0.08, 0.07, { shape: 'ribbon', lift: 0.7, bend: 0.8, fold: 0.2, c0: C(0x4f8a34), c1: C(0x9ac25a), segs: 7 }), mat(ox, y, oz, 0, i * 2.4 + r.next(), 0));
          }
          if (k === 2) {
            // tassel + two cobs in husks
            for (let i = 0; i < 5; i++) add(stalk(0.14, 0.004, 0.002, C(0xd8c070), C(0xf0dc90), 0.05), mat(ox, hh, oz, 0, i * 1.3, 0));
            for (const s of [1, -1]) {
              const cob = new THREE.CapsuleGeometry(0.035, 0.1, 3, 8);
              add(colored(cob, (p) => (Math.sin(p.y * 160) * Math.sin(Math.atan2(p.z, p.x) * 8) > 0 ? C(0xf5cf45) : C(0xe0b030))), mat(ox + s * 0.06, hh * 0.5, oz, 0, 0, s * 0.45));
              add(leafGeo(0.16, 0.07, { shape: 'lance', lift: 1.3, bend: 0.1, fold: 0.6, c0: C(0x6f9a3a), c1: C(0xc8d88a), segs: 4 }), mat(ox + s * 0.05, hh * 0.42, oz, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
            }
          }
        }
        break;
      }
      case 'sunflower': {
        const h = 0.5 + k * 0.4;
        add(stalk(h, 0.022, 0.015, C(0x5f8a34), C(0x8cb450), 0.04));
        for (let i = 0; i < 3 + k * 2; i++) {
          const y = (i / (3 + k * 2)) * h * 0.8 + 0.08;
          add(leafGeo(0.18 + k * 0.03, 0.14, { shape: 'heart', lift: 0.3, bend: 0.5, fold: 0.3, serrate: 0.15, c0: GREEN.dark, c1: GREEN.mid }), mat(0, y, 0, 0, i * 2.2, 0));
        }
        const headY = h + 0.02;
        const face = mat(0.04, headY, 0.02, -0.45, 0, 0);
        if (k >= 1) {
          const disk = new THREE.CylinderGeometry(0.06 + k * 0.035, 0.05 + k * 0.03, 0.04, 14);
          disk.rotateX(Math.PI / 2);
          add(colored(disk, (p, n) => (n.z > 0.5 ? C(0x5a3418).multiplyScalar(0.8 + 0.4 * (Math.sin(p.x * 120) * Math.sin(p.y * 120) * 0.5 + 0.5)) : GREEN.mid)), face);
          const np = k === 2 ? 16 : 10;
          for (let i = 0; i < np; i++) {
            const pl = leafGeo(0.07 + k * 0.03, 0.035, { shape: 'lance', lift: 0.05, bend: 0.1, fold: 0.1, c0: C(0xf2b418), c1: C(0xffd84a), segs: 3 });
            pl.rotateX(-Math.PI / 2);
            add(pl, face.clone().multiply(mat(0, 0, 0.012, 0, 0, (i / np) * Math.PI * 2)).multiply(mat(0, 0.05 + k * 0.03, 0, Math.PI / 2, 0, 0)));
          }
        }
        break;
      }
      case 'pumpkin': {
        // Sprawling vine with big round leaves; the pumpkin swells from green to orange.
        for (let i = 0; i < 3 + k * 2; i++) {
          const a = (i / (3 + k * 2)) * Math.PI * 2 + r.next();
          const d = 0.12 + r.next() * 0.2 + k * 0.05;
          add(stalk(0.12, 0.008, 0.006, GREEN.mid, GREEN.mid, 0.04), mat(Math.cos(a) * d, 0, Math.sin(a) * d));
          add(leafGeo(0.16 + k * 0.03, 0.2 + k * 0.03, { shape: 'heart', lift: 0.15, bend: 0.25, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 5 }), mat(Math.cos(a) * d, 0.1, Math.sin(a) * d, 0, a + Math.PI / 2, 0));
        }
        if (k >= 1) {
          const R = k === 2 ? 0.2 : 0.11;
          add(fruit(R, k === 2 ? C(0xe8741e) : C(0x8fb048), { sy: 0.72, ribs: 9, seg: 16 }), mat(0.05, R * 0.62, 0.1));
          add(stalk(0.06, 0.018, 0.012, C(0x6a7a3a), C(0x8a8a4a), 0.03), mat(0.05, R * 1.3, 0.1));
        }
        break;
      }
    }
  }
  const g = b.geometries().get(M)!;
  g.computeBoundingSphere();
  return g;
}

function lumpySphereColored(r0: number, c: THREE.Color, r: Rng, freq = 2.2, amp = 0.2): THREE.BufferGeometry {
  const g = lumpySphere(r0, 1, amp, r, freq);
  return colored(g, (p, n) => c.clone().multiplyScalar(0.7 + 0.3 * THREE.MathUtils.smoothstep(n.y, -0.6, 0.8) + 0.08 * Math.sin(p.x * 140 + p.z * 90)));
}

let cropMat: THREE.MeshStandardMaterial | null = null;
let cropDepth: THREE.MeshDepthMaterial | null = null;
const CROP_WIND = { mode: 'height' as const, height: 1.1, amplitude: 0.1, flutter: 0.5 };

export function cropMaterial(): THREE.MeshStandardMaterial {
  if (!cropMat) {
    cropMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide });
    cropMat.name = 'crop';
    applyWorldFx(cropMat, { snowUp: 0.6 });
    applyWind(cropMat, CROP_WIND);
    applyPlantLighting(cropMat, { translucency: 0.4, floor: 0.05 });
    cropDepth = windDepthMaterial(CROP_WIND);
  }
  return cropMat;
}

export interface CropHandle {
  set: InstancedSet;
  id: number;
}

export class CropVisuals {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('crops');
  private sets = new Map<string, InstancedSet>();

  constructor() {
    this.group.name = 'crops';
    this.group.add(this.pool.group);
  }

  private setFor(id: CropId, stage: number, variant: number): InstancedSet {
    const key = `${id}:${stage}:${variant}`;
    let s = this.sets.get(key);
    if (!s) {
      const geo = buildCrop(id, stage, new Rng(`crop:${key}`));
      const material = cropMaterial();
      s = new InstancedSet(`crop-${key}`, [{ geometry: geo, material, depthMaterial: cropDepth!, castShadow: stage >= 2 }], this.pool);
      this.sets.set(key, s);
    }
    return s;
  }

  add(id: CropId, stage: number, x: number, y: number, z: number, seed: number): CropHandle {
    const set = this.setFor(id, stage, seed % 2);
    // Crops read at gameplay zoom: mature plants fill most of their tile.
    const base = stage >= 2 ? 1.55 : stage === 1 ? 1.35 : 1.15;
    const s = base * (0.92 + ((seed >> 3) % 17) / 100);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x + (((seed >> 5) % 7) - 3) * 0.012, y, z + (((seed >> 8) % 7) - 3) * 0.012),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((seed % 360) * Math.PI) / 180),
      new THREE.Vector3(s, s * (0.94 + ((seed >> 11) % 13) / 100), s),
    );
    return { set, id: set.add(m) };
  }

  remove(h: CropHandle): void {
    h.set.remove(h.id);
  }
}
