/**
 * Procedural crop meshes: 6 distinct growth stages per crop (seeded mound → sprout → seedling →
 * young → mature / flowering → ripe with produce), two variants each, for 18 crops, plus
 * giant crops (3×3), withered plants (season change) and small "produce" meshes (harvest pop).
 *
 * Everything is vertex coloured and batched by material:
 *   crop    leaves / stems — wind sway, back-lit translucency, fall tint shift
 *   gloss   produce skin  — same wind (stays attached), low roughness for juicy highlights
 *   wood    trellis / stakes — static (no sway)
 *
 *   const cv = new CropVisuals();  root.add(cv.group);
 *   const h = cv.add('cauliflower', 3, x, y, z, seed);  cv.pose(h, sx, sy, lean);  cv.remove(h);
 */
import * as THREE from 'three';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { Rng } from '../../core/rng';
import { CROPS, RIPE_STAGE, type CropId } from '../../data/crops';
import { MeshBuilder, lumpySphere, mat } from '../geom';
import { applyWorldFx } from '../../render/worldfx';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyPlantLighting } from '../../render/foliage';
import { BatchPool, InstancedSet, type InstancedPart } from './instanced';

const C = (h: number): THREE.Color => new THREE.Color(h);

// ═════════════════════════════════════════════ geometry helpers

interface LeafOpts {
  bend?: number; // droop of the tip (0..1)
  lift?: number; // how steeply the leaf rises (0 flat .. 1.2 upright)
  fold?: number; // V-fold along the midrib
  shape?: 'oval' | 'lance' | 'round' | 'ribbon' | 'heart' | 'lobed';
  serrate?: number;
  /** Frilly edge: vertical ripple amplitude (× half-width) along both leaf margins. */
  ruffle?: number;
  /** Tip curls up and back over the plant (radians at the tip). */
  curl?: number;
  /** Midrib colour (defaults to a lighter c0→c1). */
  rib?: THREE.Color;
  c0: THREE.Color;
  c1: THREE.Color;
  segs?: number;
}

/** A leaf growing along +Z from the origin (midrib + two halves, vertex coloured). */
function leafGeo(len: number, width: number, o: LeafOpts): THREE.BufferGeometry {
  const segs = o.segs ?? 5;
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
      case 'lobed':
        w = Math.sin(Math.PI * Math.pow(t, 0.6)) * (0.8 + 0.25 * Math.cos(t * Math.PI * 5));
        break;
      default:
        w = Math.pow(Math.sin(Math.PI * t), 0.8);
    }
    if (o.serrate) w *= 1 + o.serrate * Math.sin(t * Math.PI * 9) * t;
    w *= width * 0.5;
    const z = t * len * (1 - bend * 0.25 * t);
    const y = len * (t * lift * 0.9 - t * t * bend * 0.9);
    const m = new THREE.Vector3(0, y, z);
    const rf = o.ruffle ? o.ruffle * w * Math.sin(t * Math.PI * 13) * Math.min(1, t * 4) : 0;
    const rfr = o.ruffle ? o.ruffle * w * Math.sin(t * Math.PI * 13 + 1.7) * Math.min(1, t * 4) : 0;
    rows.push({ l: new THREE.Vector3(-w, y - w * fold + rf, z), m, r: new THREE.Vector3(w, y - w * fold + rfr, z), t });
  }
  if (o.curl) {
    for (const row of rows) {
      const a = o.curl * Math.pow(row.t, 1.6);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      for (const v of [row.l, row.m, row.r]) {
        const y0 = v.y;
        const z0 = v.z;
        v.y = y0 * c + z0 * sn;
        v.z = z0 * c - y0 * sn;
      }
    }
  }
  const push = (v: THREE.Vector3, c: THREE.Color): void => {
    pos.push(v.x, v.y, v.z);
    col.push(c.r, c.g, c.b);
  };
  const colAt = (t: number, edge: boolean): THREE.Color => {
    const c = o.c0.clone().lerp(o.c1, THREE.MathUtils.smoothstep(t, 0, 1));
    if (!edge) {
      if (o.rib) c.lerp(o.rib, 0.7 * (1 - t * 0.6));
      else c.multiplyScalar(1.12);
    }
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
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i);
    if (n.y < 0) n.negate();
    n.lerp(up, 0.35).normalize();
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

interface FruitOpts {
  sy?: number;
  ribs?: number;
  seg?: number;
  spots?: THREE.Color;
  /** Stripes (melons): count + dark colour. */
  stripes?: number;
  stripeColor?: THREE.Color;
  /** Pointy bottom (strawberry, eggplant teardrop): 0..1. */
  taper?: number;
  /** Underside darkening floor (0.62 default). */
  shade?: number;
}

/** Shaded sphere-ish fruit: base colour with a darker underside, ribs / stripes / seeds. */
function fruit(r: number, base: THREE.Color, opts: FruitOpts = {}): THREE.BufferGeometry {
  const seg = opts.seg ?? 10;
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (opts.ribs) {
      const a = Math.atan2(p.z, p.x);
      const k = 1 - 0.1 * (0.5 - 0.5 * Math.cos(a * opts.ribs));
      p.x *= k;
      p.z *= k;
    }
    if (opts.taper) {
      const t = THREE.MathUtils.clamp(-p.y / r, 0, 1);
      const k = 1 - opts.taper * t * t;
      p.x *= k;
      p.z *= k;
    }
    // Ribbed fruit (pumpkins, tomatoes) are dimpled at the stem and the blossom end.
    if (opts.ribs) p.y *= 1 - 0.18 * Math.pow(1 - Math.min(1, Math.hypot(p.x, p.z) / r), 3);
    p.y *= opts.sy ?? 1;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  const floor = opts.shade ?? 0.62;
  return colored(g, (q, n) => {
    const c = base.clone().multiplyScalar(floor + (1 - floor) * THREE.MathUtils.smoothstep(n.y, -0.8, 0.7));
    const a = Math.atan2(q.z, q.x);
    if (opts.ribs) c.multiplyScalar(0.82 + 0.18 * (0.5 + 0.5 * Math.cos(a * opts.ribs)));
    if (opts.stripes && opts.stripeColor) {
      const s = Math.pow(0.5 + 0.5 * Math.cos(a * opts.stripes + Math.sin(q.y * 30) * 0.4), 3);
      c.lerp(opts.stripeColor, s * 0.85);
    }
    if (opts.spots && Math.sin(q.x * 90) * Math.sin(q.y * 80) * Math.sin(q.z * 85) > 0.55) c.copy(opts.spots);
    return c;
  });
}

function stalk(h: number, r0: number, r1: number, c0: THREE.Color, c1: THREE.Color, lean = 0, radial = 5): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, radial, 3);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + Math.pow(y / h, 2) * lean);
  }
  g.computeVertexNormals();
  return colored(g, (p) => c0.clone().lerp(c1, p.y / h));
}

/** A tube along a smooth path (vines, bean pods, pepper bodies). */
function tube(points: THREE.Vector3[], r0: number, r1: number, c0: THREE.Color, c1: THREE.Color, segs = 10, radial = 5): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  // Taper: rescale each ring about the curve.
  const pos = g.attributes.position as THREE.BufferAttribute;
  const ring = radial + 1;
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, t);
    for (let j = 0; j < ring; j++) {
      const k = i * ring + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.floor(i / ring) / segs;
    const cc = c0.clone().lerp(c1, t);
    col.set([cc.r, cc.g, cc.b], i * 3);
  }
  const out = g.toNonIndexed();
  const ci = new Float32Array(out.attributes.position!.count * 3);
  const idx = g.index!;
  for (let i = 0; i < idx.count; i++) {
    const v = idx.getX(i);
    ci.set([col[v * 3]!, col[v * 3 + 1]!, col[v * 3 + 2]!], i * 3);
  }
  out.setAttribute('color', new THREE.BufferAttribute(ci, 3));
  return out;
}

/** Hanging pod / pepper: tapered, curved tube hanging from its stem at the origin (downwards). */
function hangingPod(len: number, r: number, curve: number, base: THREE.Color, tip: THREE.Color, blunt = 0.35): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3(Math.sin(t * 1.6) * curve * len, -t * len, 0));
  }
  return tube(pts, r, r * blunt, base, tip, 8, 6);
}

function lumpyColored(r0: number, c: THREE.Color, r: Rng, freq = 2.2, amp = 0.2): THREE.BufferGeometry {
  const g = lumpySphere(r0, 1, amp, r, freq);
  return colored(g, (p, n) => c.clone().multiplyScalar(0.7 + 0.3 * THREE.MathUtils.smoothstep(n.y, -0.6, 0.8) + 0.08 * Math.sin(p.x * 140 + p.z * 90)));
}

/** Cauliflower curd: a dome of clustered florets (small icospheres), cream with crevice AO. */
function curd(R: number, r: Rng, n = 15): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cream = C(0xf2e8c9);
  const core = new THREE.SphereGeometry(R * 0.86, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  core.scale(1, 0.62, 1);
  parts.push(colored(core, (_p, nn) => cream.clone().multiplyScalar(0.55 + 0.25 * Math.max(0, nn.y))));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const el = Math.acos(1 - t * 0.92);
    const az = i * 2.39996 + r.next() * 0.2;
    const dir = new THREE.Vector3(Math.sin(el) * Math.cos(az), Math.cos(el), Math.sin(el) * Math.sin(az));
    const fr = R * (0.36 + r.next() * 0.1) * (1 - t * 0.25);
    const g = new THREE.IcosahedronGeometry(fr, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, k);
      const bump = 1 + 0.12 * Math.sin(v.x * 90 + i) * Math.sin(v.z * 80 + v.y * 70);
      pos.setXYZ(k, v.x * bump, v.y * bump * 0.85, v.z * bump);
    }
    const nrm = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).normalize();
      nrm.set([v.x, v.y, v.z], k * 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const c = colored(g, (p, nn) => {
      const toward = nn.dot(dir);
      const ao = 0.5 + 0.5 * THREE.MathUtils.smoothstep(toward, -0.5, 0.75);
      const tone = cream.clone().multiplyScalar(ao * (0.94 + 0.06 * Math.sin(p.x * 200 + p.z * 170)));
      return tone.lerp(C(0xe6d6a8), (1 - ao) * 0.5);
    });
    c.translate(dir.x * R * 0.72, dir.y * R * 0.5, dir.z * R * 0.72);
    parts.push(c);
  }
  const b = new MeshBuilder();
  const M = 'curd' as unknown as THREE.Material;
  for (const p of parts) b.add(M, p);
  return b.geometries().get(M)!;
}

/** Berry cluster (grapes / blueberries): spheres packed into a hanging cone. */
function bunch(add: Adder, r: Rng, n: number, br: number, len: number, color: THREE.Color, m: THREE.Matrix4, bloom = 0): void {
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const ring = Math.sqrt(1 - t) * len * 0.42;
    const a = i * 2.39996 + r.next() * 0.4;
    const y = -t * len;
    const c = color.clone().multiplyScalar(0.8 + r.next() * 0.35);
    if (bloom) c.lerp(C(0xc8d4ee), bloom * r.next());
    add(fruit(br * (0.85 + r.next() * 0.3), c, { seg: 6, shade: 0.5 }), m.clone().multiply(mat(Math.cos(a) * ring, y, Math.sin(a) * ring)), 'gloss');
  }
}

/** Five-petal star flower facing up (+Y) at the origin. */
function flower(add: Adder, r: number, petal: THREE.Color, heart: THREE.Color, m: THREE.Matrix4, petals = 5): void {
  for (let i = 0; i < petals; i++) {
    const p = leafGeo(r, r * 0.8, { shape: 'round', lift: 0.25, bend: 0.05, fold: 0.05, c0: petal.clone().multiplyScalar(0.92), c1: petal, segs: 2 });
    add(p, m.clone().multiply(mat(0, 0, 0, 0, (i / petals) * Math.PI * 2, 0)));
  }
  add(fruit(r * 0.28, heart, { seg: 5 }), m.clone().multiply(mat(0, r * 0.12, 0)));
}

type Bucket = 'leaf' | 'gloss' | 'wood';
type Adder = (g: THREE.BufferGeometry, m?: THREE.Matrix4, bucket?: Bucket) => void;

function rosette(add: Adder, r: Rng, n: number, len: number, width: number, o: LeafOpts, spin = 0, y = 0): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + spin + (r.next() - 0.5) * 0.5;
    const l = len * (0.8 + r.next() * 0.4);
    const g = leafGeo(l, width * (0.85 + r.next() * 0.3), { ...o, lift: (o.lift ?? 0.6) * (0.8 + r.next() * 0.4) });
    add(g, mat(0, y, 0, 0, a, 0));
  }
}

const GREEN = { dark: C(0x2f6a2a), mid: C(0x4f9a3a), light: C(0x8cc85a), blue: C(0x5a8f7a), blueL: C(0x9cc4a8), yellow: C(0xb8cf5a) };
const WOOD = { post: C(0x9a7048), light: C(0xc49a68), twine: C(0xd8c088) };

// ═════════════════════════════════════════════ stage builders

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

/** Stage 1: sprout — two round seed leaves on a short, slightly crooked stem. */
function sprout(add: Adder, r: Rng, scale = 1): void {
  seeded(add, r);
  add(stalk(0.08 * scale, 0.008, 0.006, GREEN.mid, GREEN.light, 0.01));
  for (const a of [0, Math.PI]) {
    add(leafGeo(0.09 * scale, 0.07 * scale, { shape: 'round', lift: 0.25, bend: 0.1, c0: GREEN.mid, c1: GREEN.light, segs: 3 }), mat(0, 0.075 * scale, 0, 0, a + r.next() * 0.3, 0));
  }
}

/** Wooden trellis: two posts, three rails, twine diagonals. Local X is the row direction. */
function trellis(add: Adder, h = 1.05, w = 0.34): void {
  for (const sx of [-1, 1]) {
    add(stalk(h, 0.026, 0.022, WOOD.post, WOOD.light, 0, 5), mat(sx * w, -0.05, 0, 0, 0, sx * 0.03), 'wood');
    const cap = new THREE.ConeGeometry(0.03, 0.05, 5);
    add(colored(cap, () => WOOD.light), mat(sx * w, h - 0.02, 0), 'wood');
  }
  for (const y of [0.32, 0.64, 0.96]) {
    const rail = stalk(w * 2 + 0.06, 0.011, 0.011, WOOD.light, WOOD.post, 0, 4);
    add(rail, mat(-w - 0.03, y * h, 0, 0, 0, -Math.PI / 2), 'wood');
  }
  // Twine lattice
  for (let i = 0; i < 3; i++) {
    const x0 = -w + (i / 2) * w * 2;
    add(stalk(h * 0.93, 0.004, 0.004, WOOD.twine, WOOD.twine, 0, 3), mat(x0 * 0.8, 0, 0.012), 'wood');
  }
}

/** A climbing bine / vine winding up a trellis to `top` (0..1 of height). Leaves every few cm. */
function climber(add: Adder, r: Rng, top: number, leaf: LeafOpts, leafLen: number, leafW: number, h = 1.0, w = 0.3, strands = 2): THREE.Vector3[] {
  const tips: THREE.Vector3[] = [];
  for (let s = 0; s < strands; s++) {
    const pts: THREE.Vector3[] = [];
    const n = 7;
    const x0 = (s - (strands - 1) / 2) * w * 0.9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = t * top * h;
      pts.push(new THREE.Vector3(x0 + Math.sin(t * 7 + s * 2) * w * 0.55, y, Math.cos(t * 7 + s * 2) * 0.05 + 0.02));
    }
    add(tube(pts, 0.012, 0.006, C(0x4f7a2e), C(0x7aaa4a), 12, 4));
    const curve = new THREE.CatmullRomCurve3(pts);
    const nl = Math.max(2, Math.round(top * 11));
    for (let i = 1; i <= nl; i++) {
      const t = i / (nl + 0.5);
      const p = curve.getPointAt(t);
      const side = i % 2 ? 1 : -1;
      const lm = mat(p.x, p.y, p.z, 0, side * (0.9 + r.next() * 0.9) + (r.next() < 0.5 ? 0 : Math.PI), 0);
      add(leafGeo(leafLen * (0.75 + r.next() * 0.4) * (0.6 + t * 0.4), leafW, leaf), lm);
    }
    tips.push(curve.getPointAt(1));
  }
  return tips;
}

function buildCrop(id: CropId, stage: number, r: Rng): Map<Bucket, THREE.BufferGeometry> {
  const b = new MeshBuilder();
  const keys: Record<Bucket, THREE.Material> = { leaf: 'leaf' as unknown as THREE.Material, gloss: 'gloss' as unknown as THREE.Material, wood: 'wood' as unknown as THREE.Material };
  const add: Adder = (g, m, bucket = 'leaf') => {
    b.add(keys[bucket], g, m);
  };
  const def = CROPS[id];
  if (def.trellis) trellis(add);
  if (id === 'tomato' && stage >= 1) {
    add(stalk(0.95, 0.018, 0.014, WOOD.post, WOOD.light), mat(0.07, -0.05, -0.02, 0, 0, -0.03), 'wood');
  }
  if (stage === 0) {
    seeded(add, r);
  } else if (stage === 1) {
    sprout(add, r, id === 'corn' || id === 'sunflower' || id === 'pumpkin' || id === 'melon' ? 1.3 : 1);
  } else {
    const k = stage - 2; // 0 seedling · 1 young · 2 mature / flowering · 3 ripe
    BUILDERS[id](add, r, k);
  }
  const out = new Map<Bucket, THREE.BufferGeometry>();
  const geos = b.geometries();
  for (const bk of ['leaf', 'gloss', 'wood'] as Bucket[]) {
    const g = geos.get(keys[bk]);
    if (g) {
      g.computeBoundingSphere();
      out.set(bk, g);
    }
  }
  return out;
}

type Builder = (add: Adder, r: Rng, k: number) => void;

const BUILDERS: Record<CropId, Builder> = {
  parsnip(add, r, k) {
    rosette(add, r, 3 + k * 2, 0.13 + k * 0.07, 0.07, { shape: 'lance', serrate: 0.35, lift: 1.0 + k * 0.08, bend: 0.5, c0: GREEN.mid, c1: GREEN.light });
    if (k >= 2) {
      const R = k === 3 ? 0.085 : 0.06;
      const root = new THREE.ConeGeometry(R, 0.2, 10, 2, true);
      root.rotateX(Math.PI);
      root.translate(0, 0.02, 0);
      add(colored(root, (p) => C(0xf0dca0).multiplyScalar(0.85 + p.y * 1.5)), undefined, 'gloss');
      const cap = new THREE.SphereGeometry(R, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.45, 1);
      cap.translate(0, 0.12, 0);
      add(colored(cap, (_p, n) => C(0xf5e4b0).multiplyScalar(0.8 + 0.2 * n.y)), undefined, 'gloss');
    }
  },
  potato(add, r, k) {
    const yellow = k === 3 ? 0.35 : 0;
    const c0 = GREEN.dark.clone().lerp(C(0x8a8a3a), yellow);
    const c1 = GREEN.mid.clone().lerp(C(0xc8c060), yellow);
    rosette(add, r, 4 + k * 2, 0.14 + k * 0.06, 0.11, { shape: 'oval', lift: 0.75, bend: 0.35, fold: 0.3, c0, c1 });
    if (k >= 1) rosette(add, r, 3 + k, 0.11 + k * 0.05, 0.1, { shape: 'oval', lift: 1.0, bend: 0.3, c0: c1, c1: GREEN.light }, 0.6, 0.05 + k * 0.035);
    if (k === 2) {
      for (let i = 0; i < 5; i++) {
        const a = r.next() * Math.PI * 2;
        flower(add, 0.03, C(0xf4ecff), C(0xf2d040), mat(Math.cos(a) * 0.09, 0.26 + r.next() * 0.05, Math.sin(a) * 0.09, 0.3, a, 0));
      }
    }
    if (k === 3) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + r.next();
        add(lumpyColored(0.055 + r.next() * 0.02, C(0xc8955a), r), mat(Math.cos(a) * 0.2, 0.01, Math.sin(a) * 0.2, 0, 0, 0, 1, 0.7, 1), 'gloss');
      }
    }
  },
  cauliflower(add, r, k) {
    rosette(add, r, 4 + k, 0.18 + k * 0.09, 0.15 + k * 0.02, { shape: 'oval', lift: 0.5 + k * 0.08, bend: 0.45, fold: 0.3, ruffle: 0.12, rib: C(0xcfe0b8), c0: C(0x2c6238), c1: C(0x5f9c58) });
    if (k >= 2) {
      const R = k === 3 ? 0.14 : 0.07;
      add(curd(R, r, k === 3 ? 15 : 9), mat(0, 0.05 + (k - 2) * 0.04, 0), 'gloss');
      rosette(add, r, 5, R * 1.4, 0.13 + (k - 2) * 0.03, { shape: 'oval', lift: 1.1, bend: 0.05, fold: 0.45, curl: 0.9, rib: C(0xd6e6c0), c0: C(0x356e40), c1: C(0x6aa662) }, 0.3, 0.0);
    } else if (k === 1) {
      rosette(add, r, 4, 0.14, 0.12, { shape: 'oval', lift: 1.1, bend: 0.1, fold: 0.4, curl: 0.6, rib: C(0xd6e6c0), c0: C(0x356e40), c1: C(0x6aa662) }, 0.4, 0.0);
    }
  },
  kale(add, r, k) {
    const tiers = 1 + Math.min(2, k);
    for (let t = 0; t < tiers; t++) {
      const n = 4 + (k >= 2 ? 1 : 0);
      const len = 0.14 + k * 0.06 - t * 0.03;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.62 + (r.next() - 0.5) * 0.4;
        const m = mat(0, t * 0.035, 0, 0, a, 0);
        add(stalk(0.06 + t * 0.02, 0.008, 0.006, C(0xa8c890), C(0x9cc080), 0.02, 4), m.clone().multiply(mat(0, 0, 0.02, 0.5, 0, 0)));
        const dark = k === 3 ? C(0x24583a) : C(0x2f6a2c);
        add(leafGeo(len * (0.85 + r.next() * 0.3), 0.11 + k * 0.02, { shape: 'oval', serrate: 0.35, ruffle: 0.55, lift: 1.25 + t * 0.15, bend: 0.4, fold: 0.25, rib: C(0xb8d8a0), c0: dark, c1: C(0x5f9e44), segs: 7 }), m.clone().multiply(mat(0, 0.05, 0.02, 0, 0, 0)));
      }
    }
  },
  strawberry(add, r, k) {
    const nStem = 3 + k * 2;
    for (let i = 0; i < nStem; i++) {
      const a = (i / nStem) * Math.PI * 2 + r.next();
      const stemL = 0.08 + k * 0.025;
      const m = mat(0, 0, 0, 0, a, 0);
      add(stalk(stemL, 0.006, 0.005, GREEN.mid, GREEN.mid, 0.05, 4), m);
      for (const la of [-0.7, 0, 0.7]) {
        add(leafGeo(0.065 + k * 0.013, 0.06, { shape: 'round', lift: 0.25, bend: 0.2, serrate: 0.3, c0: GREEN.dark, c1: GREEN.mid, segs: 3 }), m.clone().multiply(mat(0, stemL, 0.04, 0, la, 0)));
      }
    }
    if (k >= 2) {
      for (let i = 0; i < 3 + k * 2; i++) {
        const a = r.next() * Math.PI * 2;
        const ripe = k === 3 && r.next() < 0.85;
        if (!ripe && k === 2 && r.next() < 0.5) {
          flower(add, 0.024, C(0xffffff), C(0xf2d040), mat(Math.cos(a) * 0.12, 0.1, Math.sin(a) * 0.12, 0.4, a, 0));
          continue;
        }
        const berry = fruit(0.038, ripe ? C(0xd8202c) : C(0xb8d880), { sy: 1.15, taper: 0.55, spots: C(0xf0e090), seg: 8 });
        add(berry, mat(Math.cos(a) * 0.17, 0.045, Math.sin(a) * 0.17, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3), 'gloss');
        add(rosetteCap(0.03), mat(Math.cos(a) * 0.17, 0.085, Math.sin(a) * 0.17));
      }
    }
  },
  greenBean(add, r, k) {
    const top = [0.3, 0.6, 0.95, 1.0][k]!;
    climber(add, r, top, { shape: 'heart', lift: 0.2, bend: 0.5, fold: 0.25, c0: GREEN.dark, c1: GREEN.mid, segs: 4 }, 0.12, 0.11, 1.0, 0.3, 2);
    if (k === 2) {
      for (let i = 0; i < 7; i++) flower(add, 0.022, C(0xf6e8ff), C(0xe0c8f0), mat((r.next() - 0.5) * 0.6, 0.3 + r.next() * 0.6, 0.08, Math.PI / 2, 0, 0));
    }
    if (k >= 2) {
      const n = k === 3 ? 12 : 4;
      for (let i = 0; i < n; i++) {
        const len = k === 3 ? 0.17 + r.next() * 0.05 : 0.07;
        add(hangingPod(len, 0.014, 0.25 + r.next() * 0.2, C(0x6aaa3a), C(0x9ad05a), 0.5), mat((r.next() - 0.5) * 0.62, 0.35 + r.next() * 0.55, (r.next() < 0.5 ? 1 : -1) * 0.06, 0, r.next() * 6, 0), 'gloss');
      }
    }
  },
  tomato(add, r, k) {
    const h = 0.22 + k * 0.2;
    add(stalk(h, 0.014, 0.008, GREEN.dark, GREEN.mid, 0.03));
    const tiers = 1 + k;
    for (let t = 0; t < tiers; t++) {
      const y = (t / tiers) * h * 0.9 + 0.04;
      rosette(add, r, k >= 2 ? 5 : 3, 0.11 + (1 - t / tiers) * 0.08 + k * 0.012, 0.1, { shape: 'lance', serrate: 0.4, lift: 0.3, bend: 0.5, fold: 0.3, c0: GREEN.dark, c1: GREEN.mid }, t * 1.1, y);
    }
    if (k === 2) for (let i = 0; i < 4; i++) flower(add, 0.02, C(0xffd83a), C(0xe8a020), mat((r.next() - 0.5) * 0.18, h * (0.5 + r.next() * 0.4), (r.next() - 0.5) * 0.18, 0.4, 0, 0), 6);
    if (k >= 2) {
      const n = k === 3 ? 12 : 5;
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const y = h * (0.25 + r.next() * 0.6);
        const ripe = k === 3 ? r.next() < 0.85 : false;
        const col = ripe ? C(0xe0301e) : r.next() < 0.3 ? C(0xe89a3a) : C(0x7fb040);
        add(fruit(k === 3 ? 0.05 : 0.035, col, { sy: 0.85, ribs: 5, seg: 9 }), mat(Math.cos(a) * 0.1, y, Math.sin(a) * 0.1), 'gloss');
        add(rosetteCap(0.028), mat(Math.cos(a) * 0.1, y + 0.04, Math.sin(a) * 0.1));
      }
    }
  },
  corn(add, r, k) {
    const h = [0.3, 0.6, 1.0, 1.05][k]!;
    for (const [ox, oz] of [[0, 0], [0.07, 0.05]] as const) {
      const hh = h * (ox ? 0.85 : 1);
      add(stalk(hh, 0.02, 0.012, C(0x6f9a3a), C(0x9ac25a), 0.03), mat(ox, 0, oz));
      const nl = 3 + k * 2;
      for (let i = 0; i < nl; i++) {
        const y = (i / nl) * hh * 0.85 + 0.06;
        const tan = k === 3 ? 0.35 * (1 - i / nl) : 0;
        add(leafGeo(0.24 + k * 0.08, 0.07, { shape: 'ribbon', lift: 0.7, bend: 0.8, fold: 0.2, c0: C(0x4f8a34).lerp(C(0xb8a050), tan), c1: C(0x9ac25a).lerp(C(0xe0c880), tan), segs: 6 }), mat(ox, y, oz, 0, i * 2.4 + r.next(), 0));
      }
      if (k >= 2) {
        for (let i = 0; i < 5; i++) add(stalk(0.14, 0.004, 0.002, k === 3 ? C(0xc8a050) : C(0xb8c870), k === 3 ? C(0xf0d890) : C(0xe0e0a0), 0.05, 3), mat(ox, hh, oz, 0, i * 1.3, 0));
        for (const s of [1, -1]) {
          if (k === 2 && s < 0) continue;
          const cob = new THREE.CapsuleGeometry(0.035, 0.1, 3, 8);
          if (k === 3) add(colored(cob, (p) => (Math.sin(p.y * 160) * Math.sin(Math.atan2(p.z, p.x) * 8) > 0 ? C(0xf5cf45) : C(0xe0b030))), mat(ox + s * 0.06, hh * 0.5, oz, 0, 0, s * 0.45), 'gloss');
          add(leafGeo(0.16, k === 3 ? 0.06 : 0.09, { shape: 'lance', lift: 1.3, bend: 0.1, fold: 0.6, c0: C(0x6f9a3a), c1: C(0xc8d88a), segs: 4 }), mat(ox + s * 0.05, hh * 0.42, oz, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
          // Silk
          add(stalk(0.05, 0.006, 0.002, C(0xc8a060), k === 3 ? C(0x8a5a30) : C(0xf0e0a0), 0.02, 3), mat(ox + s * 0.1, hh * 0.56, oz, 0, 0, s * 0.6));
        }
      }
    }
  },
  sunflower(add, r, k) {
    const h = [0.2, 0.5, 0.85, 0.95][k]!;
    add(stalk(h, 0.022, 0.015, C(0x5f8a34), C(0x8cb450), 0.04));
    const nl = 2 + k * 2;
    for (let i = 0; i < nl; i++) {
      const y = (i / nl) * h * 0.8 + 0.06;
      add(leafGeo(0.14 + k * 0.03, 0.13, { shape: 'heart', lift: 0.3, bend: 0.5, fold: 0.3, serrate: 0.15, c0: GREEN.dark, c1: GREEN.mid, segs: 4 }), mat(0, y, 0, 0, i * 2.2, 0));
    }
    const headY = h + 0.02;
    // Heads face the camera (+Z) and nod slightly down.
    const face = mat(0.04, headY, 0.03, -0.35, 0, 0);
    if (k === 2) {
      const bud = fruit(0.06, C(0x5f8a34), { sy: 0.7, seg: 8 });
      add(bud, face);
      for (let i = 0; i < 8; i++) {
        const pl = leafGeo(0.05, 0.03, { shape: 'lance', lift: 0.9, bend: 0.1, c0: C(0x6f9a3a), c1: C(0xe8c040), segs: 2 });
        add(pl, face.clone().multiply(mat(0, -0.01, 0, 0, (i / 8) * Math.PI * 2, 0)));
      }
    } else if (k === 3) {
      const disk = new THREE.CylinderGeometry(0.1, 0.085, 0.045, 16);
      disk.rotateX(Math.PI / 2);
      add(colored(disk, (p, n) => (n.z > 0.5 ? C(0x5a3418).multiplyScalar((0.7 + 0.5 * (Math.sin(p.x * 120) * Math.sin(p.y * 120) * 0.5 + 0.5)) * (1.25 - Math.hypot(p.x, p.y) * 3.5)) : GREEN.mid)), face, 'gloss');
      const np = 18;
      for (let ring = 0; ring < 2; ring++) {
        for (let i = 0; i < np; i++) {
          const pl = leafGeo(0.1 - ring * 0.015, 0.042, { shape: 'lance', lift: 0.05, bend: -0.1 + ring * 0.25, fold: 0.15, c0: C(0xe8a010), c1: C(0xffd84a), segs: 3 });
          pl.rotateX(-Math.PI / 2);
          add(pl, face.clone().multiply(mat(0, 0, 0.01 - ring * 0.01, 0, 0, ((i + ring * 0.5) / np) * Math.PI * 2)).multiply(mat(0, 0.085, 0, Math.PI / 2, 0, 0)));
        }
      }
    }
  },
  blueberry(add, r, k) {
    // A rounded shrub of small oval leaves on woody stems.
    const R = 0.11 + k * 0.055;
    const nl = 12 + k * 12;
    for (let i = 0; i < 3 + k; i++) {
      const a = (i / (3 + k)) * Math.PI * 2 + r.next();
      add(stalk(R * 1.6, 0.012, 0.006, C(0x7a5a3a), C(0x8a6a44), Math.cos(a) * 0.05, 4), mat(0, 0, 0, 0, a, 0.2));
    }
    for (let i = 0; i < nl; i++) {
      const t = (i + 0.5) / nl;
      const el = Math.acos(1 - t * 1.3);
      const az = i * 2.39996;
      const p = new THREE.Vector3(Math.sin(el) * Math.cos(az) * R, R * 0.9 + Math.cos(el) * R * 0.85, Math.sin(el) * Math.sin(az) * R);
      add(leafGeo(0.08, 0.05, { shape: 'oval', lift: 0.4, bend: 0.3, fold: 0.2, c0: C(0x2f6a3a), c1: C(0x5f9a5a), segs: 3 }), mat(p.x, p.y, p.z, 0, az + Math.PI / 2 + (r.next() - 0.5), 0));
    }
    if (k >= 2) {
      for (let i = 0; i < (k === 3 ? 11 : 6); i++) {
        const a = r.next() * Math.PI * 2;
        const e = 0.4 + r.next() * 0.9;
        const m = mat(Math.sin(e) * Math.cos(a) * R * 1.05, R * 0.85 + Math.cos(e) * R * 0.8, Math.sin(e) * Math.sin(a) * R * 1.05);
        if (k === 2) bunch(add, r, 4, 0.016, 0.04, r.next() < 0.5 ? C(0xa8c880) : C(0xc8a0b8), m);
        else bunch(add, r, 6, 0.02, 0.05, C(0x3a4ab0), m, 0.5);
      }
    }
  },
  melon(add, r, k) {
    const nv = 3 + k;
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * Math.PI * 2 + r.next();
      const d = 0.12 + r.next() * 0.16 + k * 0.05;
      add(tube([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(Math.cos(a) * d * 0.5, 0.05, Math.sin(a) * d * 0.5), new THREE.Vector3(Math.cos(a) * d, 0.03, Math.sin(a) * d)], 0.01, 0.006, GREEN.mid, GREEN.mid, 5, 4));
      add(leafGeo(0.12 + k * 0.03, 0.15 + k * 0.03, { shape: 'lobed', lift: 0.3, bend: 0.35, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 4 }), mat(Math.cos(a) * d, 0.04, Math.sin(a) * d, 0, a + Math.PI / 2 + r.next(), 0));
    }
    if (k === 2) {
      for (let i = 0; i < 3; i++) flower(add, 0.03, C(0xffd83a), C(0xe8a020), mat((r.next() - 0.5) * 0.3, 0.1, (r.next() - 0.5) * 0.3, 0.3, 0, 0));
      add(fruit(0.07, C(0x6a9a3a), { sy: 0.85, stripes: 8, stripeColor: C(0x2f5a24), seg: 10 }), mat(0.05, 0.055, 0.1), 'gloss');
    }
    if (k === 3) {
      add(fruit(0.16, C(0x8cbf4e), { sy: 0.88, stripes: 9, stripeColor: C(0x2c5a22), seg: 14 }), mat(0.04, 0.13, 0.08, 0, r.next() * 3, 0.1), 'gloss');
      add(stalk(0.04, 0.012, 0.01, C(0x6a7a3a), C(0x8a8a4a), 0.02, 4), mat(0.04, 0.27, 0.08));
    }
  },
  hotPepper(add, r, k) {
    const h = 0.14 + k * 0.08;
    add(stalk(h, 0.012, 0.008, GREEN.dark, GREEN.mid, 0.02, 4));
    for (let t = 0; t < 1 + k; t++) {
      rosette(add, r, 4, 0.08 + k * 0.015, 0.06, { shape: 'oval', lift: 0.4, bend: 0.4, fold: 0.3, c0: GREEN.dark, c1: C(0x5faa44), segs: 4 }, t * 0.8, 0.03 + t * h * 0.3);
    }
    if (k === 2) for (let i = 0; i < 4; i++) flower(add, 0.018, C(0xffffff), C(0xe8e0a0), mat((r.next() - 0.5) * 0.18, h * (0.6 + r.next() * 0.4), (r.next() - 0.5) * 0.18, 0.5, 0, 0));
    if (k >= 2) {
      const n = k === 3 ? 7 : 3;
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const ripe = k === 3 && r.next() < 0.85;
        add(hangingPod(k === 3 ? 0.1 : 0.06, 0.016, 0.35, ripe ? C(0xd82a1a) : C(0x5a9a2a), ripe ? C(0xf04a2a) : C(0x7aba3a), 0.25), mat(Math.cos(a) * 0.08, h * (0.55 + r.next() * 0.4), Math.sin(a) * 0.08, 0, a, 0), 'gloss');
      }
    }
  },
  hops(add, r, k) {
    const top = [0.3, 0.65, 1.0, 1.0][k]!;
    const tips = climber(add, r, top, { shape: 'lobed', lift: 0.2, bend: 0.5, fold: 0.25, serrate: 0.3, c0: C(0x3f7a2e), c1: C(0x6aaa3a), segs: 4 }, 0.12, 0.12, 1.08, 0.3, 2);
    void tips;
    if (k >= 2) {
      const n = k === 3 ? 14 : 6;
      for (let i = 0; i < n; i++) {
        const m = mat((r.next() - 0.5) * 0.62, 0.3 + r.next() * 0.72, (r.next() < 0.5 ? 1 : -1) * 0.07);
        add(hopCone(k === 3 ? 0.045 : 0.03, k === 3 ? C(0xc8e07a) : C(0x8ac04a)), m, 'gloss');
      }
    }
  },
  pumpkin(add, r, k) {
    const nv = 3 + k * 2;
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * Math.PI * 2 + r.next();
      const d = 0.12 + r.next() * 0.18 + k * 0.05;
      add(stalk(0.12, 0.008, 0.006, GREEN.mid, GREEN.mid, 0.04, 4), mat(Math.cos(a) * d, 0, Math.sin(a) * d));
      add(leafGeo(0.14 + k * 0.03, 0.18 + k * 0.03, { shape: 'heart', lift: 0.15, bend: 0.25, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 4 }), mat(Math.cos(a) * d, 0.1, Math.sin(a) * d, 0, a + Math.PI / 2, 0));
    }
    if (k === 2) {
      for (let i = 0; i < 2; i++) flower(add, 0.04, C(0xffc02a), C(0xe88a10), mat((r.next() - 0.5) * 0.3, 0.14, (r.next() - 0.5) * 0.3, 0.3, 0, 0));
      add(fruit(0.09, C(0x8fb048), { sy: 0.75, ribs: 9, seg: 12 }), mat(0.05, 0.065, 0.1), 'gloss');
    }
    if (k === 3) {
      add(fruit(0.2, C(0xe8741e), { sy: 0.72, ribs: 10, seg: 16 }), mat(0.05, 0.13, 0.1), 'gloss');
      add(stalk(0.07, 0.02, 0.012, C(0x6a7a3a), C(0x8a8a4a), 0.03, 5), mat(0.05, 0.26, 0.1));
    }
  },
  eggplant(add, r, k) {
    const h = 0.15 + k * 0.08;
    add(stalk(h, 0.016, 0.01, C(0x4a3a4a), C(0x5a7a3a), 0.02, 5));
    const velvet = { c0: C(0x3f6a3a), c1: C(0x7a9a6a), rib: C(0x8a7aa0) };
    for (let t = 0; t < 1 + Math.min(2, k); t++) {
      rosette(add, r, 3, 0.13 + k * 0.02 - t * 0.02, 0.11, { shape: 'oval', lift: 0.35, bend: 0.45, fold: 0.25, ruffle: 0.08, segs: 4, ...velvet }, t * 1.0, 0.03 + t * h * 0.35);
    }
    if (k === 2) for (let i = 0; i < 3; i++) flower(add, 0.024, C(0xb888e0), C(0xf0d040), mat((r.next() - 0.5) * 0.2, h * (0.6 + r.next() * 0.3), (r.next() - 0.5) * 0.2, 0.6, 0, 0));
    if (k >= 2) {
      const n = k === 3 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.next();
        const s = k === 3 ? 0.055 : 0.03;
        const y = h * (0.35 + r.next() * 0.3);
        add(fruit(s, C(0x4a1a5e), { sy: 1.5, taper: -0.25, seg: 10, shade: 0.45 }), mat(Math.cos(a) * 0.12, y - s * 1.2, Math.sin(a) * 0.12, 0, 0, 0.25), 'gloss');
        add(rosetteCap(0.03, C(0x5a7a3a)), mat(Math.cos(a) * 0.12, y + s * 0.2, Math.sin(a) * 0.12));
      }
    }
  },
  grape(add, r, k) {
    const top = [0.35, 0.7, 1.0, 1.0][k]!;
    climber(add, r, top, { shape: 'lobed', lift: 0.15, bend: 0.5, fold: 0.2, serrate: 0.25, c0: C(0x4a7a2e), c1: C(0x7aaa44), segs: 4 }, 0.14, 0.15, 1.0, 0.3, 2);
    if (k >= 2) {
      const n = k === 3 ? 6 : 4;
      for (let i = 0; i < n; i++) {
        const m = mat((i / (n - 1) - 0.5) * 0.56 + (r.next() - 0.5) * 0.06, 0.55 + r.next() * 0.35, (i % 2 ? 1 : -1) * 0.07);
        bunch(add, r, k === 3 ? 12 : 8, k === 3 ? 0.024 : 0.017, k === 3 ? 0.14 : 0.09, k === 3 ? C(0x5a2a78) : C(0x9ac060), m, k === 3 ? 0.45 : 0);
      }
    }
  },
  beet(add, r, k) {
    rosette(add, r, 3 + k * 2, 0.12 + k * 0.05, 0.1, { shape: 'oval', lift: 0.95, bend: 0.4, fold: 0.3, ruffle: 0.1, rib: C(0xc02a4a), c0: C(0x3a6a2a), c1: C(0x5f8a3a) });
    if (k >= 2) {
      const R = k === 3 ? 0.085 : 0.05;
      add(fruit(R, C(0x8a1a3a), { sy: 0.9, seg: 10, shade: 0.5 }), mat(0, R * 0.35, 0), 'gloss');
    }
  },
  yam(add, r, k) {
    const nv = 3 + k;
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * Math.PI * 2 + r.next();
      const d = 0.08 + k * 0.05 + r.next() * 0.06;
      add(tube([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(Math.cos(a) * d * 0.5, 0.08 + k * 0.02, Math.sin(a) * d * 0.5), new THREE.Vector3(Math.cos(a) * d, 0.06, Math.sin(a) * d)], 0.009, 0.005, C(0x6a4a3a), GREEN.mid, 5, 4));
      for (let j = 0; j < 2; j++) add(leafGeo(0.1 + k * 0.02, 0.1 + k * 0.015, { shape: 'heart', lift: 0.2, bend: 0.4, fold: 0.25, c0: C(0x3f7a2e), c1: C(0x7aaa44), segs: 4 }), mat(Math.cos(a) * d * (0.5 + j * 0.5), 0.07 + k * 0.015, Math.sin(a) * d * (0.5 + j * 0.5), 0, a + (j ? 0.6 : -0.6), 0));
    }
    if (k === 3) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r.next();
        const tb = lumpyColored(0.05, C(0xa8503a), r, 2, 0.15);
        tb.scale(1.7, 0.8, 0.9);
        add(tb, mat(Math.cos(a) * 0.16, 0.015, Math.sin(a) * 0.16, 0, -a, 0), 'gloss');
      }
    }
  },
};

/** Little calyx star on top of a fruit. */
function rosetteCap(r0: number, c = C(0x4f8a2e)): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const M = 'cap' as unknown as THREE.Material;
  for (let i = 0; i < 5; i++) b.add(M, leafGeo(r0, r0 * 0.45, { shape: 'lance', lift: -0.2, bend: 0.1, fold: 0.1, c0: c, c1: c.clone().multiplyScalar(1.2), segs: 2 }), mat(0, 0, 0, 0, (i / 5) * Math.PI * 2, 0));
  return b.geometries().get(M)!;
}

/** Hop cone: overlapping bracts in a papery spindle. */
function hopCone(r0: number, c: THREE.Color): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const M = 'hop' as unknown as THREE.Material;
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const rr = r0 * Math.sin(Math.PI * (0.15 + t * 0.7));
    const g = new THREE.ConeGeometry(rr, r0 * 0.9, 6, 1, true);
    g.rotateX(Math.PI);
    b.add(M, colored(g, (_p, n) => c.clone().multiplyScalar(0.72 + 0.35 * Math.max(0, n.y + 0.4) + t * 0.06)), mat(0, -t * r0 * 1.3, 0, 0, i * 0.5, 0));
  }
  return b.geometries().get(M)!;
}

// ═════════════════════════════════════════════ withered / giant / produce

/** Dead plant after a season change: brown, drooping, collapsed. */
function buildWithered(r: Rng, trellised: boolean): Map<Bucket, THREE.BufferGeometry> {
  const b = new MeshBuilder();
  const keys: Record<Bucket, THREE.Material> = { leaf: 'leaf' as unknown as THREE.Material, gloss: 'gloss' as unknown as THREE.Material, wood: 'wood' as unknown as THREE.Material };
  const add: Adder = (g, m, bucket = 'leaf') => void b.add(keys[bucket], g, m);
  const brown0 = C(0x5a4630);
  const brown1 = C(0x9a7c52);
  if (trellised) {
    trellis(add);
    climber(add, r, 0.7, { shape: 'heart', lift: -0.2, bend: 0.9, fold: 0.4, c0: brown0, c1: brown1, segs: 3 }, 0.1, 0.09, 1.0, 0.3, 2);
  } else {
    // A slumped, straw-coloured husk: a bent main stalk with a broken, nodding top, drooping
    // papery leaves, a couple of side stems and curled leaves fallen onto the soil.
    const straw0 = C(0x6a5234);
    const straw1 = C(0xc8a86e);
    const lean = 0.18 + r.next() * 0.12;
    add(stalk(0.34, 0.016, 0.007, brown0, straw1, lean, 5));
    add(stalk(0.12, 0.008, 0.005, brown0, brown1, -0.06, 3), mat(lean * 0.9, 0.3, 0, 0, 0, -2.2));
    for (let i = 0; i < 2; i++) {
      const a = r.next() * Math.PI * 2;
      add(stalk(0.2, 0.01, 0.005, brown0, brown1, 0.1, 4), mat(0, 0, 0, 0, a, 0.5));
    }
    rosette(add, r, 6, 0.19, 0.1, { shape: 'lance', lift: 0.5, bend: 0.85, fold: 0.5, ruffle: 0.3, c0: straw0, c1: straw1, segs: 4 });
    rosette(add, r, 4, 0.13, 0.08, { shape: 'oval', lift: 0.35, bend: 1.0, fold: 0.6, curl: 0.5, c0: C(0x6a5436), c1: C(0xb89a62), segs: 3 }, 0.5, 0.16);
    for (let i = 0; i < 3; i++) {
      const a = r.next() * Math.PI * 2;
      const d = 0.12 + r.next() * 0.12;
      add(leafGeo(0.1, 0.06, { shape: 'oval', lift: 0.05, bend: 0.1, fold: 0.5, curl: 0.7, c0: C(0x7a603e), c1: C(0xb08e5c), segs: 3 }), mat(Math.cos(a) * d, 0.005, Math.sin(a) * d, 0, a, 0));
    }
  }
  const out = new Map<Bucket, THREE.BufferGeometry>();
  for (const [k, g] of b.geometries()) {
    const bk = (Object.keys(keys) as Bucket[]).find((x) => keys[x] === k)!;
    g.computeBoundingSphere();
    out.set(bk, g);
  }
  return out;
}

export type GiantKind = 'cauliflower' | 'melon' | 'pumpkin';

/** Giant crop centred on a 3×3 block (local units = tiles). */
function buildGiant(id: GiantKind, r: Rng): Map<Bucket, THREE.BufferGeometry> {
  const b = new MeshBuilder();
  const keys: Record<Bucket, THREE.Material> = { leaf: 'leaf' as unknown as THREE.Material, gloss: 'gloss' as unknown as THREE.Material, wood: 'wood' as unknown as THREE.Material };
  const add: Adder = (g, m, bucket = 'leaf') => void b.add(keys[bucket], g, m);
  if (id === 'pumpkin') {
    add(fruit(1.15, C(0xe8741e), { sy: 0.66, ribs: 12, seg: 28 }), mat(0, 0.66, 0), 'gloss');
    add(stalk(0.34, 0.1, 0.06, C(0x6a6a34), C(0x9a8a4a), 0.14, 7), mat(0, 1.34, 0, 0, 0, 0.2));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r.next();
      add(leafGeo(0.7, 0.85, { shape: 'heart', lift: 0.1, bend: 0.25, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 6 }), mat(Math.cos(a) * 0.95, 0.05, Math.sin(a) * 0.95, 0, a + Math.PI / 2, 0));
    }
    add(tube([new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0.3, 1.5, 0.1), new THREE.Vector3(0.45, 1.38, 0.3), new THREE.Vector3(0.4, 1.3, 0.45)], 0.02, 0.008, GREEN.mid, GREEN.light, 10, 4));
  } else if (id === 'melon') {
    add(fruit(1.1, C(0x8cbf4e), { sy: 0.78, stripes: 11, stripeColor: C(0x2c5a22), seg: 28 }), mat(0, 0.8, 0), 'gloss');
    add(stalk(0.22, 0.06, 0.04, C(0x6a7a3a), C(0x8a8a4a), 0.08, 6), mat(0, 1.64, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r.next();
      add(leafGeo(0.6, 0.7, { shape: 'lobed', lift: 0.15, bend: 0.3, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 6 }), mat(Math.cos(a) * 0.95, 0.04, Math.sin(a) * 0.95, 0, a + Math.PI / 2, 0));
    }
  } else {
    add(curd(1.0, r, 30), mat(0, 0.45, 0), 'gloss');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r.next() * 0.3;
      add(leafGeo(1.25, 0.95, { shape: 'oval', lift: 0.75, bend: 0.4, fold: 0.3, ruffle: 0.12, curl: 0.5, rib: C(0xcfe0b8), c0: C(0x2c6238), c1: C(0x5f9c58), segs: 7 }), mat(Math.cos(a) * 0.35, 0.02, Math.sin(a) * 0.35, 0, a + Math.PI / 2, 0));
    }
  }
  const out = new Map<Bucket, THREE.BufferGeometry>();
  for (const [k, g] of b.geometries()) {
    const bk = (Object.keys(keys) as Bucket[]).find((x) => keys[x] === k)!;
    g.computeBoundingSphere();
    out.set(bk, g);
  }
  return out;
}

const produceCache = new Map<string, THREE.BufferGeometry>();

/** A single harvested item as a small mesh (~0.35 m), origin at its centre. */
export function produceGeometry(id: CropId): THREE.BufferGeometry {
  const hit = produceCache.get(id);
  if (hit) return hit;
  const r = new Rng(`produce:${id}`);
  const b = new MeshBuilder();
  const M = 'p' as unknown as THREE.Material;
  const add: Adder = (g, m) => void b.add(M, g, m);
  const leafy = (n: number, len: number, w: number, c0: number, c1: number, y = 0.05): void => {
    for (let i = 0; i < n; i++) add(leafGeo(len, w, { shape: 'lance', lift: 1.2, bend: 0.3, c0: C(c0), c1: C(c1), segs: 3 }), mat(0, y, 0, 0, (i / n) * Math.PI * 2, 0));
  };
  switch (id) {
    case 'parsnip': {
      const root = new THREE.ConeGeometry(0.07, 0.26, 10);
      root.rotateX(Math.PI);
      add(colored(root, (p) => C(0xf0dca0).multiplyScalar(0.85 + (p.y + 0.13) * 1.2)));
      leafy(4, 0.14, 0.05, 0x4f9a3a, 0x8cc85a, 0.12);
      break;
    }
    case 'beet':
      add(fruit(0.09, C(0x8a1a3a), { sy: 0.95, taper: 0.4, seg: 12 }));
      leafy(4, 0.14, 0.07, 0x3a6a2a, 0x5f8a3a, 0.07);
      break;
    case 'potato':
    case 'yam': {
      const g = lumpyColored(0.08, C(id === 'potato' ? 0xc8955a : 0xa8503a), r, 2, 0.18);
      g.scale(1.3, 0.85, 0.95);
      add(g);
      break;
    }
    case 'cauliflower':
      add(curd(0.1, r, 12), mat(0, 0, 0));
      rosette(add, r, 5, 0.12, 0.1, { shape: 'oval', lift: 1.1, bend: 0.05, fold: 0.45, curl: 0.9, c0: C(0x356e40), c1: C(0x6aa662), segs: 4 }, 0.3, -0.03);
      break;
    case 'kale':
      for (let i = 0; i < 5; i++) add(leafGeo(0.2, 0.12, { shape: 'oval', serrate: 0.35, ruffle: 0.55, lift: 1.4, bend: 0.3, c0: C(0x2f6a2c), c1: C(0x5f9e44), segs: 6 }), mat(0, -0.08, 0, 0, (i / 5) * Math.PI * 2, 0));
      break;
    case 'strawberry':
      add(fruit(0.07, C(0xd8202c), { sy: 1.15, taper: 0.55, spots: C(0xf0e090), seg: 12 }));
      add(rosetteCap(0.05), mat(0, 0.06, 0));
      break;
    case 'greenBean':
      for (let i = 0; i < 3; i++) add(hangingPod(0.22, 0.02, 0.3, C(0x6aaa3a), C(0x9ad05a), 0.5), mat((i - 1) * 0.04, 0.1, 0, 0, i * 0.4, 0.2));
      break;
    case 'tomato':
      add(fruit(0.09, C(0xe0301e), { sy: 0.85, ribs: 5, seg: 12 }));
      add(rosetteCap(0.05), mat(0, 0.075, 0));
      break;
    case 'corn': {
      const cob = new THREE.CapsuleGeometry(0.055, 0.18, 4, 10);
      add(colored(cob, (p) => (Math.sin(p.y * 110) * Math.sin(Math.atan2(p.z, p.x) * 8) > 0 ? C(0xf5cf45) : C(0xe0b030))), mat(0, 0, 0, 0, 0, 0.6));
      for (const s of [-1, 1]) add(leafGeo(0.24, 0.1, { shape: 'lance', lift: 1.2, bend: 0.25, fold: 0.5, c0: C(0x6f9a3a), c1: C(0xc8d88a), segs: 4 }), mat(0.06, -0.08, 0, 0, s * 1.4, 0.6));
      break;
    }
    case 'sunflower': {
      const disk = new THREE.CylinderGeometry(0.09, 0.08, 0.04, 16);
      disk.rotateX(Math.PI / 2);
      add(colored(disk, (_p, n) => (n.z > 0.5 ? C(0x5a3418) : GREEN.mid)));
      for (let i = 0; i < 16; i++) {
        const pl = leafGeo(0.08, 0.04, { shape: 'lance', lift: 0.05, bend: 0.1, c0: C(0xf2b418), c1: C(0xffd84a), segs: 2 });
        pl.rotateX(-Math.PI / 2);
        add(pl, mat(0, 0, 0, 0, 0, (i / 16) * Math.PI * 2).multiply(mat(0, 0.08, 0, Math.PI / 2, 0, 0)));
      }
      break;
    }
    case 'blueberry':
      bunch(add, r, 9, 0.035, 0.12, C(0x3a4ab0), mat(0, 0.07, 0), 0.5);
      break;
    case 'grape':
      bunch(add, r, 16, 0.032, 0.22, C(0x5a2a78), mat(0, 0.11, 0), 0.45);
      add(stalk(0.05, 0.008, 0.006, C(0x6a5a3a), C(0x6a5a3a), 0, 4), mat(0, 0.1, 0));
      break;
    case 'melon':
      add(fruit(0.13, C(0x8cbf4e), { sy: 0.88, stripes: 9, stripeColor: C(0x2c5a22), seg: 16 }));
      break;
    case 'hotPepper':
      add(hangingPod(0.2, 0.03, 0.35, C(0xd82a1a), C(0xf04a2a), 0.25), mat(0, 0.1, 0));
      add(rosetteCap(0.035), mat(0, 0.11, 0));
      break;
    case 'hops':
      add(hopCone(0.08, C(0xc8e07a)), mat(0, 0.08, 0));
      break;
    case 'pumpkin':
      add(fruit(0.12, C(0xe8741e), { sy: 0.75, ribs: 10, seg: 16 }));
      add(stalk(0.06, 0.018, 0.012, C(0x6a7a3a), C(0x8a8a4a), 0.02, 5), mat(0, 0.08, 0));
      break;
    case 'eggplant':
      add(fruit(0.07, C(0x4a1a5e), { sy: 1.6, taper: -0.25, seg: 12, shade: 0.45 }));
      add(rosetteCap(0.05, C(0x5a7a3a)), mat(0, 0.1, 0));
      break;
  }
  const g = b.geometries().get(M)!;
  g.computeBoundingBox();
  const c = new THREE.Vector3();
  g.boundingBox!.getCenter(c);
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingSphere();
  produceCache.set(id, g);
  return g;
}

// ═════════════════════════════════════════════ materials

const CROP_WIND = { mode: 'height' as const, height: 1.1, amplitude: 0.1, flutter: 0.5 };
let cropMat: THREE.MeshStandardMaterial | null = null;
let glossMat: THREE.MeshStandardMaterial | null = null;
let woodMat: THREE.MeshStandardMaterial | null = null;
let cropDepth: THREE.MeshDepthMaterial | null = null;

function fallShift(m: THREE.Material, key: string): void {
  // Fall: leafy greens take a warm shift (produce colours — pumpkins, corn — untouched).
  patchMaterial(m, key, (shader) => {
    shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
    let fs = before(shader.fragmentShader, 'void main() {', 'uniform vec4 uSeasonW;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 cc = diffuseColor.rgb;
        float leafy = smoothstep(0.02, 0.12, cc.g - max(cc.r, cc.b));
        vec3 warm = vec3(dot(cc, vec3(0.45, 0.45, 0.1))) * vec3(1.25, 1.05, 0.55);
        diffuseColor.rgb = mix(cc, mix(cc, warm, 0.35), leafy * uSeasonW.z * 0.45);
      }`,
    );
    shader.fragmentShader = fs;
  });
}

export function cropMaterial(): THREE.MeshStandardMaterial {
  if (!cropMat) {
    cropMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide });
    cropMat.name = 'crop';
    applyWorldFx(cropMat, { snowUp: 0.6 });
    applyWind(cropMat, CROP_WIND);
    applyPlantLighting(cropMat, { translucency: 0.4, floor: 0.05 });
    fallShift(cropMat, 'crop-fall');
    cropDepth = windDepthMaterial(CROP_WIND);
  }
  return cropMat;
}

/** Produce skin: same sway, glossy (sun glints on tomatoes, peppers, eggplants). */
export function glossMaterial(): THREE.MeshStandardMaterial {
  if (!glossMat) {
    cropMaterial();
    glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, side: THREE.DoubleSide });
    glossMat.name = 'cropGloss';
    applyWorldFx(glossMat, { snowUp: 0.6 });
    applyWind(glossMat, CROP_WIND);
    applyPlantLighting(glossMat, { translucency: 0.12, floor: 0.05 });
    fallShift(glossMat, 'crop-gloss-fall');
  }
  return glossMat;
}

export function trellisMaterial(): THREE.MeshStandardMaterial {
  if (!woodMat) {
    woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    woodMat.name = 'trellis';
    applyWorldFx(woodMat, { snowUp: 0.5 });
  }
  return woodMat;
}

// ═════════════════════════════════════════════ batched visuals

export interface CropHandle {
  set: InstancedSet;
  id: number;
  pos: THREE.Vector3;
  yaw: number;
  scale: THREE.Vector3;
}

/** Per-crop placement tweaks: overall scale and how much the plant may be spun. */
const PLACE: Partial<Record<CropId, { scale?: number; yaw?: number }>> = {
  sunflower: { yaw: 0.5 },
  greenBean: { yaw: 0.08, scale: 0.95 },
  hops: { yaw: 0.08, scale: 1.0 },
  grape: { yaw: 0.08, scale: 0.95 },
  corn: { scale: 0.92 },
  tomato: { yaw: 0.6 },
};

const STAGE_SCALE = [1.15, 1.3, 1.42, 1.54, 1.62, 1.68];

export class CropVisuals {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('crops');
  private sets = new Map<string, InstancedSet>();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'crops';
    this.group.userData.perfTag = 'crops';
    this.group.add(this.pool.group);
  }

  private makeSet(key: string, geos: Map<Bucket, THREE.BufferGeometry>, shadow: boolean): InstancedSet {
    const parts: InstancedPart[] = [];
    const leaf = geos.get('leaf');
    const gloss = geos.get('gloss');
    const wood = geos.get('wood');
    if (leaf) parts.push({ geometry: leaf, material: cropMaterial(), depthMaterial: cropDepth!, castShadow: shadow });
    if (gloss) parts.push({ geometry: gloss, material: glossMaterial(), depthMaterial: cropDepth!, castShadow: shadow });
    if (wood) parts.push({ geometry: wood, material: trellisMaterial(), castShadow: true });
    return new InstancedSet(`crop-${key}`, parts, this.pool);
  }

  private setFor(id: CropId, stage: number, variant: number): InstancedSet {
    const key = `${id}:${stage}:${variant}`;
    let s = this.sets.get(key);
    if (!s) {
      s = this.makeSet(key, buildCrop(id, stage, new Rng(`crop:${key}`)), stage >= 3 || !!CROPS[id].trellis);
      this.sets.set(key, s);
    }
    return s;
  }

  private special(key: string, build: () => Map<Bucket, THREE.BufferGeometry>): InstancedSet {
    let s = this.sets.get(key);
    if (!s) {
      s = this.makeSet(key, build(), true);
      this.sets.set(key, s);
    }
    return s;
  }

  private place(set: InstancedSet, pos: THREE.Vector3, yaw: number, scale: THREE.Vector3): CropHandle {
    const h: CropHandle = { set, id: -1, pos, yaw, scale };
    h.id = set.add(this.compose(h, 1, 1, 0, 0));
    return h;
  }

  private compose(h: CropHandle, sxz: number, sy: number, leanX: number, leanZ: number): THREE.Matrix4 {
    this.q.setFromAxisAngle(this.up, h.yaw);
    if (leanX || leanZ) {
      const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(leanZ, 0, -leanX));
      this.q.premultiply(lq);
    }
    return this.tmp.compose(h.pos, this.q, new THREE.Vector3(h.scale.x * sxz, h.scale.y * sy, h.scale.z * sxz));
  }

  add(id: CropId, stage: number, x: number, y: number, z: number, seed: number): CropHandle {
    const set = this.setFor(id, stage, seed % 2);
    const pl = PLACE[id] ?? {};
    const s = STAGE_SCALE[stage]! * (pl.scale ?? 1) * (0.93 + ((seed >> 3) % 15) / 100);
    const jitter = CROPS[id].trellis ? 0 : 0.012;
    const pos = new THREE.Vector3(x + (((seed >> 5) % 7) - 3) * jitter, y, z + (((seed >> 8) % 7) - 3) * jitter);
    const yawRange = pl.yaw ?? Math.PI * 2;
    const yaw = yawRange >= Math.PI * 2 ? ((seed % 360) * Math.PI) / 180 : ((((seed % 1000) / 1000) - 0.5) * yawRange);
    return this.place(set, pos, yaw, new THREE.Vector3(s, s * (0.94 + ((seed >> 11) % 13) / 100), s));
  }

  addWithered(x: number, y: number, z: number, seed: number, trellised: boolean): CropHandle {
    const v = seed % 3;
    const set = this.special(`withered:${trellised ? 't' : 'p'}:${v}`, () => buildWithered(new Rng(`withered:${v}`), trellised));
    const s = 1.4 * (0.9 + ((seed >> 3) % 20) / 100);
    return this.place(set, new THREE.Vector3(x, y, z), trellised ? 0 : ((seed % 360) * Math.PI) / 180, new THREE.Vector3(s, s, s));
  }

  addGiant(kind: GiantKind, x: number, y: number, z: number, seed: number): CropHandle {
    const set = this.special(`giant:${kind}`, () => buildGiant(kind, new Rng(`giant:${kind}`)));
    const s = 0.98 + ((seed >> 4) % 6) / 100;
    return this.place(set, new THREE.Vector3(x, y, z), (((seed % 100) / 100) - 0.5) * 0.8, new THREE.Vector3(s, s, s));
  }

  /** Squash / stretch / lean an instance about its base (animation). */
  pose(h: CropHandle, sxz: number, sy: number, leanX = 0, leanZ = 0): void {
    h.set.setMatrix(h.id, this.compose(h, sxz, sy, leanX, leanZ));
  }

  remove(h: CropHandle): void {
    h.set.remove(h.id);
  }
}

export { RIPE_STAGE };
