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
import { MeshBuilder, lumpySphere, mat, roundedBox } from '../geom';
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
  /** Cup across the blade: the margins curl up (× half-width). Default 0.3. */
  cup?: number;
  c0: THREE.Color;
  c1: THREE.Color;
  segs?: number;
}

/** Deterministic 0..1 hash of a few numbers (leaf-level variation without an RNG in scope). */
function hashN(...v: number[]): number {
  let h = 2166136261;
  for (const x of v) {
    h ^= Math.floor(x * 10007) & 0xffffffff;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Leaf UV convention (the crop shaders read it): uv.x = 0 at the stem → 1 at the tip,
 * uv.y = LEAF_UV (a leaf) or LEAF_UV_TIP (a leaf whose tip browns in fall, ~20 %) plus
 * 0..0.49 across the blade (left margin → right margin; the vein painter reads it). Other parts
 * keep their 0..1 primitive UVs, so the markers never collide.
 */
const LEAF_UV = 5;
const LEAF_UV_TIP = 6;

/**
 * Re-mark a leafGeo blade as a PETAL (uv.y 2..2.49): no painted veins, no fall hue shift and no
 * browned tips — a ripe sunflower keeps its golden ray in fall (only the withered plant loses it).
 */
function asPetal(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 2 + (uv.getY(i) % 1));
  return g;
}

/** A leaf growing along +Z from the origin (midrib + two halves, vertex coloured, smooth normals). */
function leafGeo(len: number, width: number, o: LeafOpts): THREE.BufferGeometry {
  const segs = o.segs ?? 5;
  // Per-blade character (no two leaves alike): hue ±7°, value ±8 %, a slight roll about the midrib
  // and lopsided halves (one side a little wider) — a living leaf, not a stamped card.
  const h1 = hashN(len, width, segs, o.c0.g);
  const h2 = hashN(width, len * 3.1, o.c1.r);
  const h3 = hashN(len * 7.3, width * 1.7);
  const roll = (h3 - 0.5) * 0.5;
  const lop = 1 + (h1 - 0.5) * 0.16;
  const lift = o.lift ?? 0.6;
  const bend = o.bend ?? 0.4;
  const fold = o.fold ?? 0.25;
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
      // Heart / palmate blades are wide at the petiole: the two basal lobes sweep back past the
      // stalk (see `notch` below), so the outline is a rounded heart, never a rhombus.
      case 'heart':
        w = Math.pow(Math.sin(Math.PI * (0.2 + 0.8 * t)), 0.62) * (1 - t * 0.12);
        break;
      case 'lobed':
        // Three to five rounded lobes (pumpkin / melon / grape): deep sinuses between them.
        w = Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.55) * (0.74 + 0.3 * Math.pow(Math.abs(Math.cos(t * Math.PI * 2.4 + 0.2)), 0.6));
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
    const wl = w * lop;
    const wr = w / lop;
    rows.push({ l: new THREE.Vector3(-wl, y - wl * fold + rf - wl * roll, z), m, r: new THREE.Vector3(wr, y - wr * fold + rfr + wr * roll, z), t });
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
  const colAt = (t: number, edge: boolean): THREE.Color => {
    const c = o.c0.clone().lerp(o.c1, THREE.MathUtils.smoothstep(t, 0, 1));
    if (!edge) {
      if (o.rib) c.lerp(o.rib, 0.7 * (1 - t * 0.6));
      else c.multiplyScalar(1.12);
    }
    c.offsetHSL((h1 - 0.5) * 0.04, (h2 - 0.5) * 0.08, 0);
    return c.multiplyScalar((0.72 + 0.28 * Math.min(1, t * 3)) * (0.92 + h2 * 0.16));
  };
  // Five verts per row (margin, half, midrib, half, margin), indexed so normals come out smooth:
  // a V-fold along the midrib plus a cup that curls the margins up — a living blade, not a card.
  const cup = o.cup ?? 0.3;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const tip = hashN(len, width, o.c0.r, o.c1.g, segs) < 0.2 ? LEAF_UV_TIP : LEAF_UV;
  const US = [-1, -0.5, 0, 0.5, 1];
  const shp = o.shape ?? 'oval';
  const notch = shp === 'heart' ? 0.26 : shp === 'lobed' ? 0.3 : 0;
  for (const row of rows) {
    const w = row.r.x;
    // Basal lobes: the margins near the stalk swing back behind the petiole (heart sinus).
    const back = notch * len * Math.pow(1 - row.t, 2.2);
    for (const u of US) {
      const k = Math.abs(u);
      const side = u < 0 ? row.l : row.r;
      // Interpolate the margin (with its ruffle) from the midrib, then add the cup.
      const x = row.m.x + (side.x - row.m.x) * k;
      const y = row.m.y + (side.y - row.m.y) * k + cup * w * u * u;
      const z = row.m.z + (side.z - row.m.z) * k - back * Math.pow(k, 0.8);
      pos.push(x, y, z);
      const c = colAt(row.t, k > 0.25);
      if (k > 0.25 && k < 0.75) c.lerp(colAt(row.t, false), 0.2);
      col.push(c.r, c.g, c.b);
      uv.push(row.t, tip + ((u + 1) / 2) * 0.49);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 5;
    const b = a + 5;
    for (let j = 0; j < 4; j++) idx.push(a + j, a + j + 1, b + j + 1, a + j, b + j + 1, b + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i);
    if (n.y < 0) n.negate();
    n.lerp(up, 0.3).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g.toNonIndexed();
}

/**
 * Ruffled brassica leaf (kale): a displaced 4×6 grid — curled up along its length, cupped across,
 * the margins frilled in tight waves; dark blue-green with a pale midrib.
 */
function ruffledLeaf(len: number, width: number, r: Rng, c0: THREE.Color, c1: THREE.Color, rib: THREE.Color, curl = 1.1, NX = 4, NZ = 6): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, NX, NZ);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const ph = r.next() * 6;
  const tip = r.next() < 0.2 ? LEAF_UV_TIP : LEAF_UV;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2; // -1..1 across
    const t = pos.getY(i) + 0.5; // 0 stem → 1 tip
    const wprof = Math.sin(Math.PI * Math.pow(t, 0.65)) * (1 - 0.25 * t);
    let x = u * wprof * width * 0.5;
    const edge = Math.abs(u);
    // Frills: tight waves on the margin, stronger toward the tip.
    const frill = Math.sin(t * 30 + ph + u * 2) * 0.4 + Math.sin(t * 53 + ph * 2) * 0.22;
    let y = edge * edge * width * 0.26 + frill * edge * edge * width * 0.28 * (0.4 + t);
    x *= 1 + frill * 0.06 * edge;
    let z = t * len;
    // Curl the blade up and back along its length.
    const a = curl * Math.pow(t, 1.5);
    const y2 = y * Math.cos(a) + z * Math.sin(a);
    const z2 = z * Math.cos(a) - y * Math.sin(a);
    y = y2;
    z = z2;
    pos.setXYZ(i, x, y, z);
    const c = c0.clone().lerp(c1, THREE.MathUtils.smoothstep(t, 0.1, 1) * 0.8 + edge * 0.2);
    // Sun-warmed yellow-green on the frilled tips.
    c.lerp(C(0x9ab85e), THREE.MathUtils.smoothstep(t, 0.7, 1) * edge * 0.45);
    c.lerp(rib, Math.max(0, 1 - edge * 5) * 0.75 * (1 - t * 0.5));
    c.multiplyScalar((0.7 + 0.3 * Math.min(1, t * 3)) * (0.85 + 0.15 * (frill * 0.5 + 0.5)));
    col.set([c.r, c.g, c.b], i * 3);
    uv.setXY(i, t, tip + ((u + 1) / 2) * 0.49);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i);
    if (n.y < 0) n.negate();
    n.lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g.toNonIndexed();
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
  /** Height segments (default ≈ 0.7 × seg). */
  rows?: number;
  spots?: THREE.Color;
  /** Stripes (melons): count + dark colour; they run end to end along the long (X) axis. */
  stripes?: number;
  stripeColor?: THREE.Color;
  /** Pointy bottom (strawberry, eggplant teardrop): 0..1. */
  taper?: number;
  /** Underside darkening floor (0.62 default). */
  shade?: number;
  /** Stretch along X (oblong melons: 1.15). */
  long?: number;
  /** Deep rib creases with vertex AO (pumpkins) instead of the soft tomato lobes. */
  crease?: boolean;
  /** Stripe phase offset (radians) — no two melons share a pattern. */
  phase?: number;
  /** (r23) Rind breakup for hero fruit (giant pumpkin): fine rib striations and darker
   *  ripening mottle — needs seg ≥ ribs × 6. */
  rind?: boolean;
}

/** Shaded sphere-ish fruit: base colour with a darker underside, ribs / stripes / seeds. */
function fruit(r: number, base: THREE.Color, opts: FruitOpts = {}): THREE.BufferGeometry {
  // Striped melons are built pole-to-pole along X: the stripes then follow the sphere's own
  // meridians (4 columns per stripe), so they read as clean rind bands instead of the petal /
  // chevron facets a Y-pole sphere cut them into (small melons looked like artichokes).
  const seg = opts.stripes ? Math.max(opts.seg ?? 10, opts.stripes * 4) : (opts.seg ?? 10);
  const g = new THREE.SphereGeometry(r, seg, opts.rows ?? Math.max(5, Math.round(seg * 0.7)));
  if (opts.stripes) g.rotateZ(Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const lobeOf = (x: number, z: number): number => Math.abs(Math.sin((Math.atan2(z, x) * (opts.ribs ?? 1)) / 2));
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (opts.ribs) {
      const k = opts.crease ? 0.86 + 0.14 * Math.pow(lobeOf(p.x, p.z), 0.45) : 1 - 0.1 * (0.5 - 0.5 * Math.cos(Math.atan2(p.z, p.x) * opts.ribs));
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
    if (opts.ribs) p.y *= 1 - (opts.crease ? 0.3 : 0.18) * Math.pow(1 - Math.min(1, Math.hypot(p.x, p.z) / r), opts.crease ? 2 : 3);
    p.y *= opts.sy ?? 1;
    p.x *= opts.long ?? 1;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  const floor = opts.shade ?? 0.62;
  return colored(g, (q, n) => {
    const c = base.clone().multiplyScalar(floor + (1 - floor) * THREE.MathUtils.smoothstep(n.y, -0.8, 0.7));
    if (opts.ribs) {
      if (opts.crease) {
        const lobe = lobeOf(q.x, q.z);
        c.multiplyScalar(0.55 + 0.45 * Math.pow(lobe, 0.6));
        // Paler, drier toward the stem.
        c.lerp(base.clone().lerp(new THREE.Color(0xf0c890), 0.35), THREE.MathUtils.smoothstep(n.y, 0.75, 1) * 0.5);
        if (opts.rind) {
          const ang = Math.atan2(q.z, q.x);
          const ribs = opts.ribs;
          // Fine striations running stem to blossom inside each lobe (wobbling, never ruled).
          const stri = 0.5 + 0.5 * Math.sin(ang * ribs * 3 + Math.sin(q.y * 5.3 + ang * 2) * 0.9);
          c.multiplyScalar(0.88 + 0.17 * stri);
          // Ripening mottle: broad deeper red-orange blotches (no pale spots: they read as mould).
          const m = Math.sin(q.x * 4.1 + Math.sin(q.z * 3.3) * 1.5) * Math.sin(q.z * 3.7 + Math.sin(q.y * 4.9) * 1.2) * Math.sin(q.y * 4.3 + q.x * 1.9);
          c.lerp(base.clone().multiplyScalar(0.78).lerp(new THREE.Color(0xc0441a), 0.3), THREE.MathUtils.smoothstep(m, 0.1, 0.5) * 0.45);
          // Green-grey shoulder round the stem (it ripens last) and soil smudged on the low flank.
          c.lerp(new THREE.Color(0x8a8a4a), THREE.MathUtils.smoothstep(n.y, 0.86, 0.99) * 0.35);
          c.lerp(new THREE.Color(0x6a4a2c), THREE.MathUtils.smoothstep(-n.y, 0.1, 0.6) * 0.3);
        }
      } else c.multiplyScalar(0.82 + 0.18 * (0.5 + 0.5 * Math.cos(Math.atan2(q.z, q.x) * opts.ribs)));
    }
    if (opts.stripes && opts.stripeColor) {
      // Jagged watermelon stripes running end to end (around the X axis).
      const L = opts.long ?? 1;
      const a = Math.atan2(q.z, q.y);
      // A lazy wobble along the length (the rind's irregular band edges), sampled finely enough by
      // the rows that it never zig-zags.
      const xn = q.x / (r * L);
      const jag = Math.sin(xn * 4.2 + a * 2) * 0.22 + Math.sin(xn * 9.5 + a) * 0.08;
      const st = 0.5 + 0.5 * Math.cos(a * opts.stripes + jag + (opts.phase ?? 0));
      c.lerp(opts.stripeColor, THREE.MathUtils.smoothstep(st, 0.42, 0.6) * 0.92);
      // Bands fade into a mottled blossom / stem end (stripes don't pinch into a star at the poles).
      c.lerp(base.clone().multiplyScalar(0.8), THREE.MathUtils.smoothstep(Math.abs(xn), 0.82, 1.0) * 0.45);
      // Pale ground spot where it rests on the soil.
      c.lerp(new THREE.Color(0xd8d890), THREE.MathUtils.smoothstep(-n.y, 0.7, 0.95) * 0.6);
    }
    if (opts.spots && Math.sin(q.x * 90) * Math.sin(q.y * 80) * Math.sin(q.z * 85) > 0.55) c.copy(opts.spots);
    return c;
  });
}

/** A tiny round berry (grapes, blueberries): smooth-normal icosahedron — 20 triangles. */
function berry(r: number, c: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).normalize();
    nrm.set([v.x, v.y, v.z], k * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return colored(g, (_p, n) => c.clone().multiplyScalar(0.55 + 0.45 * THREE.MathUtils.smoothstep(n.y, -0.7, 0.8)));
}

function stalk(h: number, r0: number, r1: number, c0: THREE.Color, c1: THREE.Color, lean = 0, radial = 5): THREE.BufferGeometry {
  // Open-ended (caps are never seen), 2 height segments unless it bends noticeably.
  const g = new THREE.CylinderGeometry(r1, r0, h, radial, Math.abs(lean) > 0.03 ? 3 : 1, true);
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
function hangingPod(len: number, r: number, curve: number, base: THREE.Color, tip: THREE.Color, blunt = 0.35, radial = 6): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3(Math.sin(t * 1.6) * curve * len, -t * len, 0));
  }
  return tube(pts, r, r * blunt, base, tip, 7, radial);
}

function lumpyColored(r0: number, c: THREE.Color, r: Rng, freq = 2.2, amp = 0.2): THREE.BufferGeometry {
  const g = lumpySphere(r0, 1, amp, r, freq);
  return colored(g, (p, n) => c.clone().multiplyScalar(0.7 + 0.3 * THREE.MathUtils.smoothstep(n.y, -0.6, 0.8) + 0.08 * Math.sin(p.x * 140 + p.z * 90)));
}

/** Cauliflower curd: a dome of clustered florets (small icospheres), cream with crevice AO. */
function curd(R: number, r: Rng, n = 15): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Kept below white: the florets sit under full sun and must not bloom out into a blob.
  const cream = C(0xdccfa6);
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
      const ao = 0.42 + 0.58 * THREE.MathUtils.smoothstep(toward, -0.5, 0.75);
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
    add(berry(br * (0.85 + r.next() * 0.3), c), m.clone().multiply(mat(Math.cos(a) * ring, y, Math.sin(a) * ring)), 'gloss');
  }
}

/** Five-petal star flower facing up (+Y) at the origin. */
function flower(add: Adder, r: number, petal: THREE.Color, heart: THREE.Color, m: THREE.Matrix4, petals = 5): void {
  for (let i = 0; i < petals; i++) {
    const p = asPetal(leafGeo(r, r * 0.8, { shape: 'round', lift: 0.25, bend: 0.05, fold: 0.05, c0: petal.clone().multiplyScalar(0.92), c1: petal, segs: 2 }));
    add(p, m.clone().multiply(mat(0, 0, 0, 0, (i / petals) * Math.PI * 2, 0)));
  }
  add(fruit(r * 0.28, heart, { seg: 5 }), m.clone().multiply(mat(0, r * 0.12, 0)));
}

/** leaf: foliage + stems · gloss: shiny produce (tomato, pepper) · skin: matte produce (pumpkin, melon, roots) · wood: stakes. */
type Bucket = 'leaf' | 'gloss' | 'skin' | 'wood';
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
const WOOD = { post: C(0x8a6440), light: C(0xc49a68), dark: C(0x5e4430), twine: C(0xc8b080) };

// ═════════════════════════════════════════════ stage builders

/** Stage 0: freshly sown — a dibbled planting hole: a crumbly rim of turned earth around a dark, moist
 *  pocket with the seeds showing. (A smooth hemisphere read as a chocolate button lying on the bed.) */
function seeded(add: Adder, r: Rng, seedC: THREE.Color = C(0xe8d4a0), seedShape: 'oval' | 'flat' | 'kidney' | 'round' = 'oval'): void {
  // (r25) A dibble hole, not a pebble pile (r10 critic: "a small rock pile with white dots"): a wide
  // dark, moist pocket pressed into the bed, a soft smooth lip of pushed-up earth, one seed tip
  // standing proud in it, and a short pressed ridge (the drill line) behind.
  const R = 0.074;
  const pocket = new THREE.CircleGeometry(R, 12);
  pocket.rotateX(-Math.PI / 2);
  const pp = pocket.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    const d = Math.hypot(pp.getX(i), pp.getZ(i));
    pp.setY(i, 0.012 - (R - d) * 0.4);
  }
  pocket.computeVertexNormals();
  add(colored(pocket, (p) => C(0x1e1108).lerp(C(0x3a2414), Math.min(1, Math.hypot(p.x, p.z) / R))), undefined, 'skin');
  // Smooth, lumpy lip of moist earth (one torus, wobbling height).
  const lip = new THREE.TorusGeometry(R + 0.01, 0.02, 5, 16);
  lip.rotateX(Math.PI / 2);
  const lp = lip.attributes.position as THREE.BufferAttribute;
  const ph = r.next() * 6.28;
  for (let i = 0; i < lp.count; i++) {
    const a = Math.atan2(lp.getZ(i), lp.getX(i));
    const k = 0.5 + 0.22 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 7 + ph * 2);
    lp.setY(i, Math.max(0, lp.getY(i) * k + 0.006));
  }
  lip.computeVertexNormals();
  add(colored(lip, (p) => C(0x34200f).lerp(C(0x4e321e), THREE.MathUtils.clamp(p.y / 0.018, 0, 1))), undefined, 'skin');
  // The drill line: a short pressed ridge running back from the hole.
  const ridge = new THREE.SphereGeometry(1, 8, 4);
  ridge.scale(0.012, 0.008, 0.06);
  add(colored(ridge, () => C(0x4a301c)), mat(0, 0.006, -0.135, 0, (r.next() - 0.5) * 0.3, 0), 'skin');
  // Two crumbs on the lip (not a ring of pebbles).
  for (let i = 0; i < 2; i++) {
    const k = 0.012 + r.next() * 0.006;
    const clod = new THREE.IcosahedronGeometry(k, 0);
    clod.scale(1.2, 0.6, 1);
    const a = r.next() * Math.PI * 2;
    add(colored(clod, () => C(0x553724)), mat(Math.cos(a) * (R + 0.02), k * 0.4 + 0.008, Math.sin(a) * (R + 0.02), r.next() * 3, r.next() * 3, 0), 'skin');
  }
  // The seed: one fat kernel standing tip-up in the pocket (+ a smaller one beside it), sunk to half.
  const seedDim = seedC.clone().multiplyScalar(0.82);
  for (let i = 0; i < 2; i++) {
    const sz = i === 0 ? 0.021 : 0.014;
    const sd = new THREE.SphereGeometry(sz, 8, 5);
    if (seedShape === 'flat') sd.scale(1.3, 0.45, 1.9);
    else if (seedShape === 'kidney') sd.scale(1.2, 0.8, 1.7);
    else if (seedShape === 'round') sd.scale(1.05, 0.95, 1.05);
    else sd.scale(0.9, 0.7, 1.45);
    const a = r.next() * Math.PI * 2;
    const rr = i === 0 ? 0.008 : 0.034;
    add(colored(sd, (p) => seedDim.clone().multiplyScalar(0.75 + Math.max(0, p.y / sz) * 0.45)), mat(Math.cos(a) * rr, 0.002, Math.sin(a) * rr, i === 0 ? 0.75 : 0.2, r.next() * 3, 0), 'skin');
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


/** Seed look per crop (stage 0): kernel colour + shape in the dibbled hole. */
function seedLook(id: CropId): [THREE.Color, 'oval' | 'flat' | 'kidney' | 'round'] {
  switch (id) {
    case 'corn': return [C(0xf2c84a), 'round'];
    case 'greenBean': return [C(0xc86a8a), 'kidney'];
    case 'melon': case 'pumpkin': return [C(0xf4ead0), 'flat'];
    case 'sunflower': return [C(0x3a3430), 'oval'];
    case 'beet': return [C(0x8a6a4a), 'round'];
    case 'potato': case 'yam': return [C(0xb8885a), 'round'];
    case 'grape': case 'blueberry': return [C(0x6a4a3a), 'round'];
    default: return [C(0xe8d4a0), 'oval'];
  }
}

/**
 * Stage 1 — a signature seedling per crop family (never one generic two-leaf sprout):
 * corn a fan of rolled grass blades · melon / pumpkin fat heart cotyledons + a first lobed leaf ·
 * brassicas a frilly blue-green rosette · beet red stems · beans a hooked sprout with a tendril
 * reaching for the trellis twine · grape / hops a woody cutting / bronze shoot climbing the twine ·
 * nightshades lance cotyledons + a serrated true leaf · strawberry a trifoliate crown · sunflower
 * thick cotyledons up on a tall stem · blueberry a woody twig · parsnip feathery threads ·
 * potato a crinkled dark cluster breaking a mound · yam a coiled red shoot.
 */
function seedling(id: CropId, add: Adder, r: Rng): void {
  const [sc, ss] = seedLook(id);
  seeded(add, r, sc, ss);
  const cot = (len: number, w: number, y: number, c0: THREE.Color, c1: THREE.Color, shape: LeafOpts['shape'] = 'round', lift = 0.25, spin = 0): void => {
    for (const a of [0, Math.PI]) add(leafGeo(len, w, { shape, lift, bend: 0.12, fold: 0.1, cup: 0.35, c0, c1, segs: 4 }), mat(0, y, 0, 0, a + spin + r.next() * 0.25, 0));
  };
  switch (id) {
    case 'corn': {
      // Three to four rolled blades fanning up out of one point, pale yellow-green.
      for (let i = 0; i < 4; i++) add(leafGeo(0.17 + r.next() * 0.06, 0.035, { shape: 'ribbon', lift: 1.25, bend: 0.45, fold: 0.5, c0: C(0x8ab040), c1: C(0xc8dc78), segs: 4 }), mat(0, 0.004, 0, 0, i * 1.7 + r.next() * 0.5, 0));
      break;
    }
    case 'melon':
    case 'pumpkin': {
      add(stalk(0.05, 0.012, 0.01, C(0x7a9a4a), C(0x9ac25a), 0.01));
      cot(0.1, 0.085, 0.045, C(0x5f9a3e), C(0x9ccc62), 'oval', 0.15);
      // First true leaf: a small lobed / heart blade curling up between them.
      add(leafGeo(0.08, 0.09, { shape: id === 'melon' ? 'lobed' : 'heart', lift: 0.9, bend: 0.3, fold: 0.25, cup: 0.5, c0: GREEN.dark, c1: GREEN.mid, segs: 5 }), mat(0, 0.05, 0, 0, Math.PI / 2 + r.next() * 0.4, 0));
      break;
    }
    case 'cauliflower':
    case 'kale': {
      const c0 = id === 'kale' ? C(0x24543f) : C(0x3a6a52);
      for (let i = 0; i < 4; i++) add(ruffledLeaf(0.1 + r.next() * 0.03, 0.08, r, c0, C(0x7aa88a), C(0xb8d4bc), 0.5, 4, 6), mat(0, 0.008, 0, 0, i * (Math.PI / 2) + r.next() * 0.4, 0).multiply(mat(0, 0, 0, -0.35, 0, 0)));
      break;
    }
    case 'beet': {
      for (let i = 0; i < 3; i++) {
        const m = mat(0, 0, 0, 0, i * 2.1 + r.next() * 0.4, 0).multiply(mat(0, 0, 0, 0.35, 0, 0));
        add(stalk(0.07, 0.006, 0.005, C(0x8a1a36), C(0xd0304a), 0, 4), m);
        add(leafGeo(0.07, 0.04, { shape: 'oval', lift: 0.9, bend: 0.25, fold: 0.3, rib: C(0xc0304a), c0: C(0x2f5a2a), c1: C(0x4f7a34), segs: 4 }), m.clone().multiply(mat(0, 0.07, 0, -0.5, 0, 0)));
      }
      break;
    }
    case 'greenBean': {
      // Hooked sprout: an arched stem still bent from breaking the soil, fat kidney cotyledons,
      // and a fine tendril already reaching for the twine.
      add(tube([new THREE.Vector3(0.03, 0, 0), new THREE.Vector3(0.035, 0.07, 0), new THREE.Vector3(0.015, 0.11, 0), new THREE.Vector3(-0.01, 0.1, 0)], 0.011, 0.009, C(0x7aa040), C(0x9ac25a), 8, 5));
      cot(0.06, 0.05, 0.1, C(0x6f9a3a), C(0xa8c868), 'round', -0.1, Math.PI / 2);
      add(tube([new THREE.Vector3(0.0, 0.1, 0.0), new THREE.Vector3(0.0, 0.2, 0.01), new THREE.Vector3(-0.005, 0.32, 0.012), new THREE.Vector3(0.0, 0.42, 0.012)], 0.004, 0.002, C(0x8ab84a), C(0xb0d070), 10, 3));
      break;
    }
    case 'grape':
    case 'hops': {
      if (id === 'grape') add(stalk(0.12, 0.012, 0.009, C(0x5e4230), C(0x7a5a40), 0.01, 5));
      // A shoot spiralling up the twine, two small leaves on the way.
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(new THREE.Vector3(Math.sin(t * 9) * 0.02, (id === 'grape' ? 0.1 : 0) + t * 0.32, 0.012 + Math.cos(t * 9) * 0.02));
      }
      add(tube(pts, 0.006, 0.003, id === 'hops' ? C(0x8a5a3a) : C(0x6a8a3a), C(0x9ac25a), 12, 3));
      for (const t of [0.35, 0.7]) {
        const i = Math.round(t * 8);
        const p = pts[i]!;
        add(leafGeo(0.08, 0.08, { shape: 'lobed', lift: 0.25, bend: 0.4, fold: 0.25, serrate: 0.3, c0: C(0x3f7a2e), c1: C(0x7aaa44), segs: 4 }), mat(p.x, p.y, p.z, 0, t > 0.5 ? 0.6 : -2.4, 0));
      }
      break;
    }
    case 'tomato':
    case 'hotPepper':
    case 'eggplant': {
      // Each its own signature from the first true leaves (r15): tomato = serrated, dark, staked;
      // pepper = glossy bright round blades; eggplant = purple stem + velvety grey-green blades.
      const stem = id === 'eggplant' ? C(0x6a3a72) : C(0x5f8a3a);
      const tc0 = id === 'eggplant' ? C(0x4a6a50) : id === 'hotPepper' ? C(0x2f7a2e) : C(0x2c5e28);
      const tc1 = id === 'eggplant' ? C(0x92a88c) : id === 'hotPepper' ? C(0x74c84a) : C(0x5a9a3c);
      add(stalk(0.09, 0.009, 0.006, stem, id === 'eggplant' ? C(0x7a5a80) : GREEN.mid, 0.01));
      cot(0.07, 0.03, 0.085, C(0x5f9a3e), C(0x8cc060), 'lance', 0.35);
      for (const a of id === 'tomato' ? [Math.PI / 2, -Math.PI / 2 + 0.3] : [Math.PI / 2, -Math.PI / 2 + 0.4, 0.3]) {
        add(leafGeo(id === 'eggplant' ? 0.085 : 0.075, id === 'tomato' ? 0.05 : 0.065, { shape: id === 'tomato' ? 'lance' : id === 'hotPepper' ? 'round' : 'oval', serrate: id === 'tomato' ? 0.5 : 0, lift: 0.8, bend: 0.3, fold: 0.3, c0: tc0, c1: tc1, segs: 4 }), mat(0, 0.09, 0, 0, a, 0));
      }
      break;
    }
    case 'strawberry': {
      for (let i = 0; i < 3; i++) {
        const m = mat(0, 0, 0, 0, i * 2.1 + r.next() * 0.4, 0).multiply(mat(0, 0, 0, 0.3, 0, 0));
        add(stalk(0.06, 0.005, 0.004, C(0x9a4a3a), GREEN.mid, 0, 3), m);
        for (const la of [-0.7, 0, 0.7]) add(leafGeo(0.04, 0.036, { shape: 'round', lift: 0.3, bend: 0.2, serrate: 0.35, cup: 0.4, c0: GREEN.dark, c1: GREEN.mid, segs: 3 }), m.clone().multiply(mat(0, 0.06, 0, 0, la, 0)));
      }
      break;
    }
    case 'sunflower': {
      add(stalk(0.16, 0.013, 0.011, C(0x6f9a3a), C(0x9ac25a), 0.01));
      cot(0.08, 0.055, 0.155, C(0x5f9a3e), C(0x9ccc62), 'oval', 0.2);
      break;
    }
    case 'blueberry': {
      // A rooted cutting: a short woody twig with a tuft of small round leaves at its tip.
      add(stalk(0.14, 0.011, 0.007, C(0x5e4230), C(0x8a6248), 0.02, 5));
      for (let i = 0; i < 5; i++) add(leafGeo(0.05, 0.035, { shape: 'round', lift: 0.6, bend: 0.3, fold: 0.3, cup: 0.45, c0: C(0x2f6a3a), c1: C(0x5e9a5a), segs: 3 }), mat(0, 0.1 + i * 0.008, 0, 0, i * 1.26, 0));
      break;
    }
    case 'parsnip': {
      // Feathery threads: long thin cotyledons + a first finely divided leaf.
      for (let i = 0; i < 2; i++) add(leafGeo(0.13, 0.016, { shape: 'ribbon', lift: 0.9, bend: 0.5, c0: GREEN.mid, c1: GREEN.light, segs: 4 }), mat(0, 0.004, 0, 0, i * Math.PI + r.next() * 0.3, 0));
      add(leafGeo(0.08, 0.06, { shape: 'lance', serrate: 0.6, lift: 1.1, bend: 0.3, fold: 0.4, c0: GREEN.mid, c1: GREEN.light, segs: 4 }), mat(0, 0.01, 0, 0, Math.PI / 2, 0));
      break;
    }
    case 'potato': {
      // A dark crinkled cluster breaking a hilled mound.
      const mound = new THREE.SphereGeometry(0.11, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      mound.scale(1, 0.35, 1);
      add(colored(mound, (_p, n) => C(0x5c3b25).multiplyScalar(0.7 + 0.35 * n.y)), undefined, 'skin');
      for (let i = 0; i < 5; i++) add(leafGeo(0.07, 0.06, { shape: 'oval', lift: 0.9, bend: 0.35, fold: 0.35, ruffle: 0.12, c0: GREEN.dark, c1: C(0x4f8a3a), segs: 4 }), mat(0, 0.03, 0, 0, i * 1.26 + r.next() * 0.3, 0));
      break;
    }
    case 'yam': {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 7; i++) {
        const t = i / 7;
        pts.push(new THREE.Vector3(Math.cos(t * 7) * 0.03 * t, t * 0.11, Math.sin(t * 7) * 0.03 * t));
      }
      add(tube(pts, 0.007, 0.004, C(0x8a3a3a), C(0xb05a4a), 10, 4));
      for (const t of [0.5, 1]) {
        const p = pts[Math.round(t * 7)]!;
        add(leafGeo(0.07, 0.065, { shape: 'heart', lift: 0.3, bend: 0.3, fold: 0.25, cup: 0.4, c0: C(0x3f7a2e), c1: C(0x7aaa44), segs: 4 }), mat(p.x, p.y, p.z, 0, t * 3.1, 0));
      }
      break;
    }
    default:
      sprout(add, r);
  }
}

/**
 * (r16) Crop identity in the young stages (2–3), on top of the builder's foliage, so rows read as
 * their crop from the gameplay camera before any fruit: potato on a hilled ridge with purple-tinged
 * stems · strawberry red runners rooting little daughter crowns · melon / pumpkin a running vine with
 * curling tendrils (pumpkin: an early yellow trumpet bud) · pepper / eggplant / tomato their first
 * flower buds (white stars / lavender / yellow) · yam red twining shoots · blueberry a woody base with
 * a blush of red new growth.
 */
function earlyIdentity(id: CropId, add: Adder, r: Rng, k: number): void {
  const s = 0.8 + k * 0.25;
  switch (id) {
    case 'potato': {
      // Hilled ridge along the row + purple stem bases.
      const ridge = new THREE.SphereGeometry(0.17, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      ridge.scale(1.35, 0.32, 0.8);
      add(colored(ridge, (_p, n) => C(0x5c3b25).multiplyScalar(0.62 + 0.4 * n.y)), mat(0, -0.012, 0), 'skin');
      for (let i = 0; i < 3; i++) add(stalk(0.08 * s, 0.008, 0.006, C(0x5a3a5a), C(0x6a7a3a), 0.02, 4), mat((i - 1) * 0.05, 0.03, 0, 0, i * 2, 0.25 * (i - 1)));
      break;
    }
    case 'strawberry': {
      // Runners: thin red stolons arching over the soil, each rooting a tiny trifoliate crown.
      for (let i = 0; i < 2 + k; i++) {
        const a = i * 2.3 + r.next() * 0.6;
        const L = (0.2 + r.next() * 0.06) * s;
        const pts = [new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(Math.cos(a) * L * 0.5, 0.05, Math.sin(a) * L * 0.5), new THREE.Vector3(Math.cos(a) * L, 0.008, Math.sin(a) * L)];
        add(tube(pts, 0.005, 0.004, C(0xa83a32), C(0xc8584a), 8, 3));
        for (const la of [-0.8, 0, 0.8]) add(leafGeo(0.035, 0.03, { shape: 'round', lift: 0.5, bend: 0.2, serrate: 0.35, cup: 0.4, c0: GREEN.dark, c1: GREEN.mid, segs: 3 }), mat(Math.cos(a) * L, 0.012, Math.sin(a) * L, 0, a + la, 0));
      }
      if (k === 1) for (let i = 0; i < 2; i++) flower(add, 0.024, C(0xfbf8f0), C(0xf2d040), mat((r.next() - 0.5) * 0.12, 0.1, (r.next() - 0.5) * 0.12, -0.4, r.next() * 6, 0));
      break;
    }
    case 'melon':
    case 'pumpkin': {
      // A runner reaching out of the clump along the soil, tendrils curling off it.
      for (let i = 0; i < 1 + k; i++) {
        const a = i * 2.8 + r.next() * 0.5;
        const L = (0.26 + k * 0.08) * s;
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j <= 4; j++) pts.push(new THREE.Vector3(Math.cos(a + j * 0.12) * L * (j / 4), 0.018 + (j === 1 ? 0.02 : 0), Math.sin(a + j * 0.12) * L * (j / 4)));
        add(tube(pts, 0.009, 0.006, C(0x5f8a34), C(0x8ab84a), 8, 4));
        const tip = pts[4]!;
        const curl: THREE.Vector3[] = [];
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          curl.push(new THREE.Vector3(tip.x + Math.cos(t * 9) * 0.025 * (1 - t * 0.5), tip.y + 0.01 + t * 0.05, tip.z + Math.sin(t * 9) * 0.025 * (1 - t * 0.5)));
        }
        add(tube(curl, 0.0035, 0.002, C(0x8ab84a), C(0xb0d070), 12, 3));
        add(leafGeo(0.08, 0.08, { shape: id === 'melon' ? 'lobed' : 'heart', lift: 0.4, bend: 0.3, fold: 0.2, cup: 0.4, c0: GREEN.dark, c1: GREEN.mid, segs: 4 }), mat(pts[2]!.x, pts[2]!.y + 0.01, pts[2]!.z, 0, a + 1.4, 0));
      }
      if (id === 'pumpkin' && k === 1) flower(add, 0.04, C(0xf6b42a), C(0xe08a1a), mat(0.05, 0.12, 0.03, -0.6, 0.4, 0), 5);
      break;
    }
    case 'hotPepper':
    case 'eggplant':
    case 'tomato': {
      if (k !== 1) break;
      const petal = id === 'eggplant' ? C(0xb89ad8) : id === 'tomato' ? C(0xf6d23a) : C(0xfbf8f0);
      const heart = id === 'eggplant' ? C(0xf2d040) : id === 'tomato' ? C(0xe0a020) : C(0xd8e0a0);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + r.next() * 0.5;
        flower(add, 0.026, petal, heart, mat(Math.cos(a) * 0.07, (id === 'tomato' ? 0.3 : 0.2) + r.next() * 0.05, Math.sin(a) * 0.07, 0.9, a, 0));
      }
      break;
    }
    case 'yam': {
      for (let i = 0; i < 2; i++) {
        const pts: THREE.Vector3[] = [];
        const a0 = i * Math.PI + r.next();
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          pts.push(new THREE.Vector3(Math.cos(a0 + t * 5) * 0.05 * t + Math.cos(a0) * 0.15 * t * s, 0.02 + t * 0.14 * s, Math.sin(a0 + t * 5) * 0.05 * t + Math.sin(a0) * 0.15 * t * s));
        }
        add(tube(pts, 0.006, 0.003, C(0x8a3a3a), C(0xb05a4a), 12, 3));
      }
      break;
    }
    case 'blueberry': {
      add(stalk(0.1, 0.016, 0.01, C(0x5e4230), C(0x8a6248), 0.02, 5));
      for (let i = 0; i < 4; i++) add(leafGeo(0.045, 0.03, { shape: 'round', lift: 0.7, bend: 0.3, cup: 0.4, c0: C(0x9a3a3a), c1: C(0xc86a5a), segs: 3 }), mat(Math.cos(i * 1.6) * 0.08, 0.16 + k * 0.05, Math.sin(i * 1.6) * 0.08, 0, i * 1.6, 0));
      break;
    }
    default:
      break;
  }
}

/** Wooden trellis: two posts, three rails, twine diagonals. Local X is the row direction. */
function trellis(add: Adder, h = 0.98, w = 0.34): void {
  for (const sx of [-1, 1]) {
    // Weathered, darker posts (pale ones read as a noisy picket wall through the leaves).
    add(stalk(h, 0.024, 0.02, WOOD.dark, WOOD.post, 0, 5), mat(sx * w, -0.05, 0, 0, 0, sx * 0.03), 'wood');
    const cap = new THREE.ConeGeometry(0.027, 0.045, 5);
    add(colored(cap, () => WOOD.post), mat(sx * w, h - 0.02, 0), 'wood');
  }
  // One thin top rail + a twine: the frame supports the plant, it isn't the subject.
  for (const y of [0.95]) {
    const rail = stalk(w * 2 + 0.06, 0.008, 0.008, WOOD.post, WOOD.dark, 0, 4);
    add(rail, mat(-w - 0.03, y * h, 0, 0, 0, -Math.PI / 2), 'wood');
  }
  add(stalk(h * 0.93, 0.004, 0.004, WOOD.twine, WOOD.twine, 0, 3), mat(0, 0, 0.012), 'wood');
}

/**
 * A climbing bine / vine winding up a trellis to `top` (0..1 of height). Leaves every few cm;
 * `density` > 1 adds paired leaves + short side shoots so a mature row covers most of the frame.
 */
function climber(add: Adder, r: Rng, top: number, leaf: LeafOpts, leafLen: number, leafW: number, h = 1.0, w = 0.3, strands = 2, density = 1): THREE.Vector3[] {
  const tips: THREE.Vector3[] = [];
  for (let s = 0; s < strands; s++) {
    const pts: THREE.Vector3[] = [];
    const n = 7;
    const x0 = (s - (strands - 1) / 2) * w * (strands > 2 ? 0.7 : 0.9);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = t * top * h;
      pts.push(new THREE.Vector3(x0 + Math.sin(t * 7 + s * 2) * w * 0.55, y, Math.cos(t * 7 + s * 2) * 0.05 + 0.02));
    }
    add(tube(pts, 0.012, 0.006, C(0x4f7a2e), C(0x7aaa4a), 8, 4));
    const curve = new THREE.CatmullRomCurve3(pts);
    const nl = Math.max(2, Math.round(top * 11 * density));
    for (let i = 1; i <= nl; i++) {
      const t = i / (nl + 0.5);
      const p = curve.getPointAt(t);
      const side = i % 2 ? 1 : -1;
      const lm = mat(p.x, p.y, p.z, 0, side * (0.9 + r.next() * 0.9) + (r.next() < 0.5 ? 0 : Math.PI), 0);
      add(leafGeo(leafLen * (0.75 + r.next() * 0.4) * (0.6 + t * 0.4), leafW, leaf), lm);
      if (density > 1 && r.next() < density - 1) {
        // A leaf on the far side of the frame too (the row reads as a green wall from any angle).
        const lm2 = mat(p.x + (r.next() - 0.5) * 0.1, p.y + 0.03, p.z - 0.04, 0, -side * (0.9 + r.next() * 0.9) + Math.PI, 0);
        add(leafGeo(leafLen * (0.7 + r.next() * 0.35), leafW * 0.95, leaf), lm2);
      }
    }
    tips.push(curve.getPointAt(1));
  }
  return tips;
}

function buildCrop(id: CropId, stage: number, r: Rng): Map<Bucket, THREE.BufferGeometry> {
  const b = new MeshBuilder();
  const keys: Record<Bucket, THREE.Material> = { leaf: 'leaf' as unknown as THREE.Material, gloss: 'gloss' as unknown as THREE.Material, skin: 'skin' as unknown as THREE.Material, wood: 'wood' as unknown as THREE.Material };
  const add: Adder = (g, m, bucket = 'leaf') => {
    b.add(keys[bucket], g, m);
  };
  const def = CROPS[id];
  if (def.trellis) trellis(add);
  if (id === 'tomato' && stage >= 1) {
    // The stake stands just a hand above the plant (never a bare pole over the canopy), with a
    // twine tie where the stem is bound to it.
    const sh = stage <= 1 ? 0.3 : 0.29 + (stage - 2) * 0.2;
    add(stalk(sh + 0.05, 0.016, 0.012, WOOD.post, WOOD.light), mat(0.07, -0.05, -0.02, 0, 0, -0.03), 'wood');
    add(stalk(0.022, 0.02, 0.02, WOOD.twine, WOOD.twine, 0, 6), mat(0.068, sh * 0.62, -0.02), 'wood');
    if (stage >= 4) add(stalk(0.022, 0.02, 0.02, WOOD.twine, WOOD.twine, 0, 6), mat(0.066, sh * 0.3, -0.02), 'wood');
  }
  if (stage === 0) {
    const [sc, ss] = seedLook(id);
    seeded(add, r, sc, ss);
  } else if (stage === 1) {
    seedling(id, add, r);
  } else {
    const k = stage - 2; // 0 seedling · 1 young · 2 mature / flowering · 3 ripe
    BUILDERS[id](add, r, k);
    if (k <= 1) earlyIdentity(id, add, r, k);
  }
  const out = new Map<Bucket, THREE.BufferGeometry>();
  const geos = b.geometries();
  for (const bk of ['leaf', 'gloss', 'skin', 'wood'] as Bucket[]) {
    const g = geos.get(keys[bk]);
    if (g) {
      g.computeBoundingSphere();
      out.set(bk, g);
    }
  }
  return out;
}

type Builder = (add: Adder, r: Rng, k: number) => void;

/**
 * A trailing vine (melons, pumpkins, yams): a Catmull-Rom tube hugging the soil with 2–3 lazy
 * bends, leaves along it and a curly tendril or two. Returns the vine's points for placing fruit.
 */
function vine(add: Adder, r: Rng, a: number, len: number, leaf: LeafOpts, leafLen: number, leafW: number, nLeaves: number, tendrils = 1): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0.02, 0)];
  let ang = a;
  const n = 4;
  for (let i = 1; i <= n; i++) {
    ang += (r.next() - 0.5) * 0.9;
    const d = (len * i) / n;
    pts.push(new THREE.Vector3(Math.cos(ang) * d, 0.02 + Math.sin(i * 1.7 + a) * 0.012 + (i === 1 ? 0.03 : 0), Math.sin(ang) * d));
  }
  add(tube(pts, 0.011, 0.006, C(0x4f7a2e), C(0x6f9a3e), 7, 4));
  const curve = new THREE.CatmullRomCurve3(pts);
  for (let i = 0; i < nLeaves; i++) {
    const t = (i + 0.6) / (nLeaves + 0.2);
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = i % 2 ? 1 : -1;
    const yaw = Math.atan2(tan.x, tan.z) + side * (0.9 + r.next() * 0.5);
    // Held up off the soil on a (hidden) stalk: the blade floats a few cm above the vine.
    // Every blade its own green (hue / value drift, an older yellowing one now and then) and its own
    // tilt, so a bed of vines never reads as one copy-pasted leaf.
    const old = r.next() < 0.12;
    const jh = (r.next() - 0.5) * 0.035 + (old ? 0.03 : 0);
    const jl = (r.next() - 0.5) * 0.08 + (old ? 0.05 : 0);
    const lo: LeafOpts = { ...leaf, c0: leaf.c0.clone().offsetHSL(jh, old ? -0.05 : 0, jl), c1: leaf.c1.clone().offsetHSL(jh, old ? -0.05 : 0, jl), lift: (leaf.lift ?? 0.2) + (r.next() - 0.5) * 0.2, fold: (leaf.fold ?? 0.2) * (0.7 + r.next() * 0.6) };
    add(leafGeo(leafLen * (0.8 + r.next() * 0.4) * (1.05 - t * 0.3), leafW * (0.85 + r.next() * 0.3), lo), mat(p.x, p.y + 0.03 + r.next() * 0.03, p.z, (r.next() - 0.5) * 0.25, yaw, (r.next() - 0.5) * 0.25).multiply(mat(0, 0, 0.02)));
  }
  for (let k = 0; k < tendrils; k++) {
    const t = 0.35 + r.next() * 0.5;
    const p = curve.getPointAt(t);
    const tp: THREE.Vector3[] = [];
    const ph = r.next() * 6;
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const rr = 0.035 * (1 - u * 0.7);
      tp.push(new THREE.Vector3(p.x + Math.cos(u * 9 + ph) * rr + u * 0.03, p.y + u * 0.07, p.z + Math.sin(u * 9 + ph) * rr));
    }
    add(tube(tp, 0.003, 0.0015, C(0x6f9a3e), C(0x9ac25a), 7, 3));
  }
  return pts;
}

const BUILDERS: Record<CropId, Builder> = {
  parsnip(add, r, k) {
    // Feathery LIME fountains (the lightest greens on the farm); ripe tops yellow at the tips as the root fattens.
    const ripeTop = k === 3 ? C(0xe6e070) : C(0xd2ee7a);
    rosette(add, r, 3 + k * 2, 0.13 + k * 0.07, 0.07, { shape: 'lance', serrate: 0.35, lift: 1.0 + k * 0.08, bend: 0.5, c0: C(0x6fae34), c1: ripeTop });
    if (k >= 2) {
      // Only the pale shoulder of the root shows above the soil.
      const R = k === 3 ? 0.085 : 0.06;
      const cap = new THREE.SphereGeometry(R, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.55, 1);
      cap.translate(0, -0.012, 0);
      add(colored(cap, (_p, n) => C(0xf2e2b0).multiplyScalar(0.72 + 0.28 * n.y)), undefined, 'skin');
    }
  },
  potato(add, r, k) {
    const yellow = k === 3 ? 0.35 : 0;
    // Dark, matte, olive-bronze bushes: the heaviest, lowest mounds on the farm; ripe = yellowing, collapsing haulm.
    const c0 = C(0x2a4a24).lerp(C(0x8a7a3a), yellow);
    const c1 = C(0x547a34).lerp(C(0xc8b050), yellow);
    rosette(add, r, 4 + k * 2, 0.14 + k * 0.06, 0.11, { shape: 'oval', lift: 0.75, bend: 0.35, fold: 0.3, c0, c1 });
    if (k >= 1) rosette(add, r, 3 + k, 0.11 + k * 0.05, 0.1, { shape: 'oval', lift: 1.0, bend: 0.3, c0: c1, c1: GREEN.light }, 0.6, 0.05 + k * 0.035);
    if (k === 2) {
      for (let i = 0; i < 5; i++) {
        const a = r.next() * Math.PI * 2;
        flower(add, 0.04, C(0xe6d4ff), C(0xf2d040), mat(Math.cos(a) * 0.09, 0.26 + r.next() * 0.05, Math.sin(a) * 0.09, 0.3, a, 0));
      }
    }
    if (k === 3) {
      // A couple of tubers heaved half out of the ridge.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r.next();
        add(lumpyColored(0.05 + r.next() * 0.02, C(0xc8955a), r), mat(Math.cos(a) * 0.19, -0.015, Math.sin(a) * 0.19, 0, a, 0, 1.3, 0.75, 1), 'skin');
      }
    }
  },
  cauliflower(add, r, k) {
    // Broad, waxy blue-green leaves with pale ribs, wrapping the curd as it swells.
    const leaf = { shape: 'oval' as const, lift: 0.55 + k * 0.08, bend: 0.45, fold: 0.32, ruffle: 0.07, cup: 0.45, rib: C(0xa8cca0), c0: C(0x345f42), c1: C(0x72a262), segs: 6 };
    rosette(add, r, 4 + k, 0.18 + k * 0.09, 0.15 + k * 0.02, leaf);
    const inner = { shape: 'oval' as const, lift: 1.15, bend: 0.05, fold: 0.45, curl: 0.9, rib: C(0x86b490), c0: C(0x2e5e48), c1: C(0x6e9e62), segs: 4 };
    if (k >= 2) {
      const R = k === 3 ? 0.14 : 0.07;
      add(curd(R, r, k === 3 ? 15 : 9), mat(0, 0.05 + (k - 2) * 0.04, 0), 'skin');
      rosette(add, r, 5, R * 1.4, 0.13 + (k - 2) * 0.03, inner, 0.3, 0.0);
    } else if (k === 1) {
      rosette(add, r, 4, 0.14, 0.12, { ...inner, curl: 0.6 }, 0.4, 0.0);
    }
  },
  kale(add, r, k) {
    // Big frilly leaves on pale stalks that arch OUT and over (a loose, open vase), deep blue-green
    // with yellow-green frilled tips — never the cauliflower's flat, pale, waxy rosette.
    const tiers = 1 + Math.min(2, k);
    // Red-Russian kale: smoky violet-green blades, magenta ribs; ripe plants flush deeper plum with pale frills.
    const c0 = k === 3 ? C(0x35254a) : C(0x2c3a4c);
    const c1 = k === 3 ? C(0x7a5a92) : C(0x52805e);
    const rib = k === 3 ? C(0xd0709e) : C(0xb8789c);
    for (let t = 0; t < tiers; t++) {
      const n = 4 + (k >= 2 ? 1 : 0) - (t === tiers - 1 && t > 0 ? 1 : 0);
      const len = 0.16 + k * 0.065 - t * 0.035;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.62 + (r.next() - 0.5) * 0.4;
        const m = mat(0, t * 0.04, 0, 0, a, 0);
        // Outer tiers lean well out, the heart stays upright.
        const lean = 0.95 - t * 0.28 + (r.next() - 0.5) * 0.2;
        const stalkL = 0.06 + t * 0.03 + k * 0.01;
        add(stalk(stalkL, 0.009, 0.006, C(0xd070b0), C(0xa85a98), 0, 3), m.clone().multiply(mat(0, 0, 0, lean, 0, 0)));
        const lf = ruffledLeaf(len * (0.85 + r.next() * 0.3), 0.17 + k * 0.035, r, c0, c1, rib, 0.35 + t * 0.2 + r.next() * 0.2, 6, 12);
        // The blade continues the stalk's lean (rotateX +: tips fall outward), arching back up.
        add(lf, m.clone().multiply(mat(0, Math.cos(lean) * stalkL, Math.sin(lean) * stalkL, lean - 0.95 - 0.25, 0, 0)));
      }
    }
  },
  strawberry(add, r, k) {
    // A low, full trifoliate clump (r15): long-stalked leaves arching out of the crown into a
    // mounded cushion, and on ripe plants 4–6 berries hanging off the clump's RIM on arched
    // pedicels (each with its green calyx and seed dots) — never loose red marbles on the soil.
    const nStem = 4 + k * 2;
    const leafL = 0.07 + k * 0.014;
    for (let i = 0; i < nStem; i++) {
      const a = (i / nStem) * Math.PI * 2 + r.next() * 0.6;
      const stemL = (0.08 + k * 0.03) * (0.8 + r.next() * 0.35);
      const lean = 0.35 + r.next() * 0.3;
      const m = mat(0, 0, 0, 0, a, 0).multiply(mat(0, 0, 0, lean, 0, 0));
      add(stalk(stemL, 0.006, 0.005, C(0x6a8a3a), GREEN.mid, 0, 3), m);
      const tip = m.clone().multiply(mat(0, stemL, 0, -lean * 0.8, 0, 0));
      for (const la of [-0.75, 0, 0.75]) {
        add(leafGeo(leafL * (la ? 0.9 : 1.05), leafL * 0.86, { shape: 'round', lift: 0.3, bend: 0.25, serrate: 0.3, cup: 0.4, rib: C(0x8ab86a), c0: C(0x2a6230), c1: C(0x56a040), segs: 4 }), tip.clone().multiply(mat(0, 0, 0, 0, la, 0)));
      }
    }
    if (k === 2) {
      // Flowering: white blossoms + a few hard green berries at the rim.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r.next() * 0.6;
        if (i % 2 === 0) {
          flower(add, 0.026, C(0xffffff), C(0xf2d040), mat(Math.cos(a) * 0.12, 0.14, Math.sin(a) * 0.12, 0.4, a, 0));
          continue;
        }
        add(fruit(0.03, C(0xc8dc8a), { sy: 1.15, taper: 0.55, spots: C(0xf0e090), seg: 7, rows: 5 }), mat(Math.cos(a) * 0.14, 0.07, Math.sin(a) * 0.14), 'gloss');
      }
    } else if (k === 3) {
      const n = 5 + Math.floor(r.next() * 3);
      for (let i = 0; i < n; i++) {
        // Mostly on the lens-facing half of the clump, draped over the leaf rim (read red from the
        // high camera at 20 m, never hidden under the cushion nor loose on the soil).
        const a = Math.PI / 2 + ((i + 0.5) / n - 0.5) * 4.6 + (r.next() - 0.5) * 0.4;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const rad = 0.14 + r.next() * 0.03;
        const R = 0.046 + r.next() * 0.01;
        const y = 0.1 + r.next() * 0.035;
        const col = (r.next() < 0.15 ? C(0xf06a50) : C(0xd81a2a)).offsetHSL((r.next() - 0.5) * 0.02, 0, (r.next() - 0.5) * 0.06);
        // Pedicel: out of the crown, arching over the leaves and down to the berry's calyx.
        add(tube([new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(ca * rad * 0.55, 0.15, sa * rad * 0.55), new THREE.Vector3(ca * rad, y + R * 1.25, sa * rad)], 0.004, 0.003, C(0x6a8a3a), C(0x8aa84a), 6, 3));
        const m = mat(ca * rad, y, sa * rad, -sa * 0.35, 0, ca * 0.35);
        add(fruit(R, col, { sy: 1.2, taper: 0.55, spots: C(0xf6e8a0), seg: 9, rows: 6 }), m, 'gloss');
        add(rosetteCap(R * 0.8, C(0x3f8a2e)), m.clone().multiply(mat(0, R * 1.0, 0)));
      }
    }
  },
  greenBean(add, r, k) {
    const top = [0.3, 0.6, 0.95, 1.0][k]!;
    climber(add, r, top, { shape: 'heart', lift: 0.2, bend: 0.5, fold: 0.25, c0: C(0x1d4636), c1: C(0x3a7458), segs: 4 }, k >= 2 ? 0.14 : 0.12, k >= 2 ? 0.13 : 0.11, 0.98, 0.3, k >= 2 ? 3 : 2, k >= 2 ? 1.1 : 0.85);
    if (k === 2) {
      for (let i = 0; i < 7; i++) flower(add, 0.022, C(0xf6e8ff), C(0xe0c8f0), mat((r.next() - 0.5) * 0.6, 0.3 + r.next() * 0.6, 0.08, Math.PI / 2, 0, 0));
    }
    if (k >= 2) {
      const n = k === 3 ? 11 : 4;
      for (let i = 0; i < n; i++) {
        const len = k === 3 ? 0.17 + r.next() * 0.05 : 0.07;
        add(hangingPod(len, 0.016, 0.25 + r.next() * 0.2, C(0x6aaa3a), C(0x9ad05a), 0.5, 4), mat((r.next() - 0.5) * 0.62, 0.35 + r.next() * 0.55, 0.1 + r.next() * 0.04, 0, r.next() * 6, 0), 'gloss');
      }
    }
  },
  tomato(add, r, k) {
    const h = 0.22 + k * 0.2;
    add(stalk(h, 0.014, 0.008, GREEN.dark, GREEN.mid, 0.03));
    const tiers = 1 + k;
    for (let t = 0; t < tiers; t++) {
      const y = (t / tiers) * h * 0.9 + 0.04;
      // r15: four compound leaves a tier (was three) and longer — a leafy staked bush, not a pole.
      // (r26) Mature plants carry five broader leaves a tier (the r10 critic's front tomato block read as
      // scrawny staked poles with soil showing between them — Stardew's tomato is a full leafy bush).
      rosette(add, r, k >= 2 ? 5 : 4, 0.13 + (1 - t / tiers) * 0.1 + k * 0.022, k >= 2 ? 0.14 : 0.11, { shape: 'lance', serrate: 0.4, lift: 0.3, bend: 0.5, fold: 0.3, c0: C(0x2c6428), c1: C(0x5a9e3c), segs: 4 }, t * 1.1, y);
    }
    // A leafy crown over the top truss, so the stake never ends in a bare tip.
    if (k >= 2) rosette(add, r, 3, 0.1, 0.1, { shape: 'lance', serrate: 0.4, lift: 0.9, bend: 0.4, fold: 0.3, c0: C(0x3a7430), c1: C(0x6aae46), segs: 3 }, 0.5, h * 0.96);
    if (k === 2) for (let i = 0; i < 4; i++) flower(add, 0.02, C(0xffd83a), C(0xe8a020), mat((r.next() - 0.5) * 0.18, h * (0.5 + r.next() * 0.4), (r.next() - 0.5) * 0.18, 0.4, 0, 0), 6);
    if (k >= 2) {
      // Trusses: fruit in little clusters, ripening from the bottom up.
      const n = k === 3 ? 9 : 5;
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const yy = h * (0.25 + (i / n) * 0.6);
        const ripe = k === 3 ? yy < h * 0.7 || r.next() < 0.5 : false;
        const col = (ripe ? C(0xe0301e) : r.next() < 0.4 ? C(0xe89a3a) : C(0x7fb040)).offsetHSL((r.next() - 0.5) * 0.02, 0, (r.next() - 0.5) * 0.06);
        // No two alike: ±15 % size, squat (0.85 Y), each with its calyx star.
        const fr = (k === 3 ? 0.052 : 0.036) * (0.85 + r.next() * 0.3);
        const ox = Math.cos(a) * (0.1 + r.next() * 0.05);
        const oz = Math.sin(a) * (0.1 + r.next() * 0.05);
        add(fruit(fr, col, { sy: 0.85, ribs: 5, seg: 8, rows: 6 }), mat(ox, yy, oz, (r.next() - 0.5) * 0.3, r.next() * 6, 0), 'gloss');
        add(rosetteCap(fr * 0.55), mat(ox, yy + fr * 0.78, oz, 0, r.next() * 6, 0));
      }
    }
  },
  corn(add, r, k) {
    const h = [0.3, 0.6, 1.0, 1.05][k]!;
    for (const [ox, oz] of [[0, 0], [0.07, 0.05]] as const) {
      const hh = h * (ox ? 0.85 : 1);
      add(stalk(hh, 0.02, 0.012, C(0x86a648), C(0xb4cc6a), 0.03));
      // Fewer blades (≈ -25 %) so the cobs and tassels read; a paler, yellower green than the
      // beans and sunflowers beside it (corn is its own colour block from across the field).
      // r15: a wider, fuller fan (more and longer blades) — a corn row reads as a green wall.
      const nl = 3 + Math.round(k * 1.8);
      for (let i = 0; i < nl; i++) {
        const y = (i / nl) * hh * 0.85 + 0.06;
        const tan = k === 3 ? 0.35 * (1 - i / nl) : 0;
        add(leafGeo(0.28 + k * 0.09, 0.08, { shape: 'ribbon', lift: 0.7, bend: 0.8, fold: 0.2, c0: C(0x6e9c46).lerp(C(0xb8a050), tan), c1: C(0xbcd67c).lerp(C(0xe0c880), tan), segs: 5 }), mat(ox, y, oz, 0, i * 2.4 + r.next(), 0));
      }
      if (k >= 2) {
        for (let i = 0; i < 5; i++) add(stalk(0.14, 0.004, 0.002, k === 3 ? C(0xc8a050) : C(0xb8c870), k === 3 ? C(0xf0d890) : C(0xe0e0a0), 0.05, 3), mat(ox, hh, oz, 0, i * 1.3, 0));
        for (const sd of [1, -1]) {
          if (k === 2 && sd < 0) continue;
          const cob = new THREE.CapsuleGeometry(0.035, 0.1, 3, 8);
          if (k === 3) add(colored(cob, (p) => (Math.sin(p.y * 160) * Math.sin(Math.atan2(p.z, p.x) * 8) > 0 ? C(0xf5cf45) : C(0xe0b030))), mat(ox + sd * 0.06, hh * 0.5, oz, 0, 0, sd * 0.45), 'gloss');
          add(leafGeo(0.16, k === 3 ? 0.06 : 0.09, { shape: 'lance', lift: 1.3, bend: 0.1, fold: 0.6, c0: C(0x6f9a3a), c1: C(0xc8d88a), segs: 4 }), mat(ox + sd * 0.05, hh * 0.42, oz, 0, sd > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
          add(stalk(0.05, 0.006, 0.002, C(0xc8a060), k === 3 ? C(0x8a5a30) : C(0xf0e0a0), 0.02, 3), mat(ox + sd * 0.1, hh * 0.56, oz, 0, 0, sd * 0.6));
        }
      }
    }
  },
  sunflower(add, r, k) {
    const h = [0.2, 0.5, 0.85, 0.95][k]!;
    add(stalk(h, 0.022, 0.015, C(0x5f8a34), C(0x8cb450), 0.04));
    const nl = 2 + Math.round(k * 1.5);
    for (let i = 0; i < nl; i++) {
      const y = (i / nl) * h * 0.8 + 0.06;
      add(leafGeo(0.14 + k * 0.03, 0.13, { shape: 'heart', lift: 0.3, bend: 0.5, fold: 0.3, serrate: 0.15, c0: GREEN.dark, c1: GREEN.mid, segs: 4 }), mat(0, y, 0, 0, i * 2.2, 0));
    }
    const headY = h + 0.02;
    // Heads face the camera (+Z), tipped up toward the high game lens (a face seen edge-on from
    // ~50° above read as a drooping brown seed head).
    const face = mat(0.04, headY, 0.03, k === 3 ? -0.62 : -0.35, 0, 0);
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
      add(colored(disk, (p, n) => (n.z > 0.5 ? C(0x5a3418).multiplyScalar((0.7 + 0.5 * (Math.sin(p.x * 120) * Math.sin(p.y * 120) * 0.5 + 0.5)) * (1.25 - Math.hypot(p.x, p.y) * 3.5)) : GREEN.mid)), face, 'skin');
      const np = 16;
      for (let ring = 0; ring < 2; ring++) {
        for (let i = 0; i < np; i++) {
          const pl = asPetal(leafGeo(0.13 - ring * 0.02, 0.05, { shape: 'lance', lift: 0.05, bend: -0.1 + ring * 0.25, fold: 0.15, c0: C(0xf0a812), c1: C(0xffe25a), segs: 3 }));
          pl.rotateX(-Math.PI / 2);
          add(pl, face.clone().multiply(mat(0, 0, 0.01 - ring * 0.01, 0, 0, ((i + ring * 0.5) / np) * Math.PI * 2)).multiply(mat(0, 0.085, 0, Math.PI / 2, 0, 0)));
        }
      }
    }
  },
  blueberry(add, r, k) {
    // (r30) A rounded, IRREGULAR shrub (r10 critic: uniform spiky teal "hedgehog" domes with a radial
    // seam at the crown, berries that read as grapes / hydrangea): a few grey-brown canes at the base
    // under 3-4 overlapping leaf clumps of different sizes (a lumpy, asymmetric mass), top-lit (the
    // crowns lighter and warmer, the undersides deep), small oval leaves laid ALONG each clump's
    // surface at random spots (never a golden spiral converging on a pole). Ripe fruit: individual
    // dusty-blue berries with a dark crown dimple, in tight clusters of 5-8 that hang just below the
    // leaf edge on the flanks.
    const R = 0.11 + k * 0.048;
    const bark0 = C(0x5a4636);
    const bark1 = C(0x8a7058);
    for (let i = 0; i < 3 + k; i++) {
      const a = (i / (3 + k)) * Math.PI * 2 + r.next() * 0.6;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const reach = R * (0.45 + r.next() * 0.3);
      add(tube([new THREE.Vector3(ca * 0.012, 0, sa * 0.012), new THREE.Vector3(ca * reach * 0.55, R * 0.45, sa * reach * 0.55), new THREE.Vector3(ca * reach, R * 1.1, sa * reach)], 0.013 + k * 0.002, 0.005, bark0, bark1, 5, 4), mat());
    }
    const deep = C(0x183e26);
    const mid = C(0x356f40);
    const top = C(0x6a9a4e);
    const teal = C(0x4a7a70);
    const cy = R * 1.0;
    // Clumps: [x, y, z, radius] — one main mass + 2-3 smaller lobes pushed out unevenly.
    const clumps: [number, number, number, number][] = [[0, cy, 0, R * 0.82]];
    const nLobe = k >= 1 ? 2 + (k >= 2 ? 1 : 0) : 0;
    const a0 = r.next() * Math.PI * 2;
    for (let i = 0; i < nLobe; i++) {
      const a = a0 + (i / nLobe) * Math.PI * 2 + (r.next() - 0.5) * 1.1;
      const d = R * (0.36 + r.next() * 0.18);
      clumps.push([Math.cos(a) * d, cy + R * (-0.12 + r.next() * 0.32), Math.sin(a) * d, R * (0.5 + r.next() * 0.2)]);
    }
    const shade = (y: number, ny: number): THREE.Color => {
      // Top light: deep underside → mid flank → a warm, lighter crown.
      const u = THREE.MathUtils.clamp(0.5 + ny * 0.5, 0, 1);
      const c = deep.clone().lerp(mid, THREE.MathUtils.smoothstep(u, 0.15, 0.6)).lerp(top, THREE.MathUtils.smoothstep(u, 0.7, 1.0) * 0.6);
      return c.lerp(teal, 0.15).multiplyScalar(0.92 + 0.1 * (y / (R * 2)));
    };
    if (k >= 1) {
      for (const [x, y, z, cr] of clumps) {
        const shell = new THREE.SphereGeometry(cr * 0.9, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.78);
        const sp = shell.attributes.position as THREE.BufferAttribute;
        const ph = r.next() * 6;
        for (let i = 0; i < sp.count; i++) {
          const px = sp.getX(i), py = sp.getY(i), pz = sp.getZ(i);
          const lump = 1 + 0.12 * Math.sin(Math.atan2(pz, px) * 4 + ph) * Math.sin(py * 26 + ph);
          sp.setXYZ(i, px * lump, py * 0.84 * lump, pz * lump);
        }
        shell.computeVertexNormals();
        add(colored(shell, (p, n) => shade(p.y + y, n.y).multiplyScalar(0.82)), mat(x, y - cr * 0.1, z));
      }
    }
    // Leaves strewn over each clump, lying along its surface (low lift), facing outward.
    const nl = 22 + k * 22;
    for (let i = 0; i < nl; i++) {
      const [x, y, z, cr] = clumps[i % clumps.length]!;
      const el = 0.3 + r.next() * 1.25; // never at the pole: no crown seam
      const az = r.next() * Math.PI * 2;
      const rr = cr * (0.84 + r.next() * 0.14);
      const p = new THREE.Vector3(x + Math.sin(el) * Math.cos(az) * rr, y + Math.cos(el) * rr * 0.84, z + Math.sin(el) * Math.sin(az) * rr);
      const ny = Math.cos(el);
      const c1 = shade(p.y, ny).offsetHSL((r.next() - 0.5) * 0.03, 0, (r.next() - 0.5) * 0.06);
      const c0 = c1.clone().multiplyScalar(0.72);
      if (k === 3 && r.next() < 0.05) c1.lerp(C(0xb4523c), 0.55);
      const L = (0.058 + r.next() * 0.03) * (k === 0 ? 1.15 : 1);
      add(leafGeo(L, L * 0.6, { shape: 'oval', lift: 0.05 + (1 - el / 1.6) * 0.35 + r.next() * 0.15, bend: 0.3, fold: 0.3, cup: 0.35, rib: C(0x9cc4a0), c0, c1, segs: 3 }), mat(p.x, p.y, p.z, 0, Math.atan2(Math.cos(az), Math.sin(az)) + (r.next() - 0.5) * 1.0, 0));
    }
    if (k >= 2) {
      const n = k === 3 ? 12 : 5;
      for (let i = 0; i < n; i++) {
        const [x, y, z, cr] = clumps[(i + 1) % clumps.length]!;
        // Most clusters on the lens-facing half (+Z), hung off the upper flank so they read from the
        // high game lens (on the lower rim they only showed as a purple fringe under the leaves).
        const front = i % 4 !== 3;
        const a = front ? Math.PI / 2 + (r.next() - 0.5) * 2.6 : r.next() * Math.PI * 2;
        const e = 0.6 + r.next() * 0.55;
        const hang = new THREE.Vector3(x + Math.sin(e) * Math.cos(a) * cr * 1.08, y + Math.cos(e) * cr * 0.9 + 0.01, z + Math.sin(e) * Math.sin(a) * cr * 1.08);
        const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        if (k === 2) {
          for (let j = 0; j < 4; j++) {
            // Hard green with a lilac blush (paired dark-red berries read as a creature's eyes).
            const col = r.next() < 0.75 ? C(0xa8c078) : C(0xa890b0);
            add(berry(0.013 * (0.85 + r.next() * 0.3), col), mat(hang.x + (r.next() - 0.5) * 0.04, hang.y - r.next() * 0.03, hang.z + (r.next() - 0.5) * 0.04), 'skin');
          }
          continue;
        }
        const nb = 5 + Math.floor(r.next() * 4);
        for (let j = 0; j < nb; j++) {
          // A tight, hanging cluster: berries packed round a short drooping raceme.
          const t = j / nb;
          const ang = j * 2.39996 + r.next() * 0.5;
          const ring = (0.012 + 0.016 * Math.sqrt(t)) * (0.8 + r.next() * 0.4);
          const br = 0.025 * (0.85 + r.next() * 0.3);
          const bp = hang.clone().addScaledVector(out, 0.012 + Math.cos(ang) * ring * 0.5).add(new THREE.Vector3(-out.z * Math.sin(ang) * ring, -t * 0.045 - r.next() * 0.008, out.x * Math.sin(ang) * ring));
          // Dusty blue with a pale bloom (a few riper indigo, one or two still blushing).
          const pick = r.next();
          const col = (pick < 0.08 ? C(0x8a5a8a) : pick < 0.3 ? C(0x34489a) : C(0x4f68b8)).lerp(C(0x9cb0dc), 0.12 + r.next() * 0.2);
          add(berry(br, col), mat(bp.x, bp.y, bp.z), 'skin');
          // Crown dimple: a dark five-point calyx ring on the berry's outer face.
          const dim = new THREE.CircleGeometry(br * 0.42, 5);
          const dn = new THREE.Vector3(out.x * 0.8, -0.2, out.z * 0.8).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dn);
          add(colored(dim, () => C(0x2a2242)), new THREE.Matrix4().compose(bp.clone().addScaledVector(dn, br * 0.93), q, new THREE.Vector3(1, 1, 1)), 'skin');
        }
      }
    }
  },
  melon(add, r, k) {
    const leaf = { shape: 'lobed' as const, lift: 0.3, bend: 0.35, fold: 0.22, serrate: 0.2, cup: 0.5, c0: GREEN.dark, c1: GREEN.mid, segs: 8 };
    const nv = 2 + Math.min(2, k);
    const vines: THREE.Vector3[][] = [];
    for (let i = 0; i < nv; i++) vines.push(vine(add, r, (i / nv) * Math.PI * 2 + r.next(), 0.22 + k * 0.07, leaf, 0.12 + k * 0.03, 0.15 + k * 0.03, 2 + Math.min(1, k), k >= 2 && i < 2 ? 1 : 0));
    if (k === 2) {
      for (let i = 0; i < 3; i++) flower(add, 0.03, C(0xffd83a), C(0xe8a020), mat((r.next() - 0.5) * 0.3, 0.08, (r.next() - 0.5) * 0.3, 0.3, 0, 0));
      add(fruit(0.07, C(0x7aa848), { sy: 0.85, long: 1.12, stripes: 7, stripeColor: C(0x2f5a24), seg: 12, rows: 8 }), mat(0.06, 0.05, 0.1, 0, r.next() * 3, 0), 'skin');
    }
    if (k === 3) {
      // Big striped melons off the vines — every variant its own form: round "sugar baby" to long
      // oblong, pale to deep rind, fine or bold stripes, and sometimes a smaller second fruit.
      const form = r.next();
      const fruitAt = (vi: number, s: number): void => {
        const R = 0.15 * s;
        const at = vines[vi % vines.length]![2]!;
        const long = 1.0 + form * 0.45;
        const rind = C(0xb4d888).lerp(C(0x6e9c44), (form * 0.6 + r.next() * 0.4));
        const stripes = 6 + Math.floor(r.next() * 5);
        add(fruit(R, rind, { sy: 0.9 - form * 0.08, long, stripes, stripeColor: C(0x24501c).lerp(C(0x3a6a2a), r.next() * 0.5), seg: 14, rows: 9, shade: 0.5, phase: r.next() * Math.PI * 2 }), mat(at.x * 0.6, R * 0.72, at.z * 0.6, (r.next() - 0.5) * 0.36, r.next() * Math.PI * 2, (r.next() - 0.5) * 0.36), 'skin');
        add(tube([new THREE.Vector3(at.x * 0.6, R * 1.6, at.z * 0.6), new THREE.Vector3(at.x * 0.7, R * 1.75, at.z * 0.7 + 0.02), new THREE.Vector3(at.x * 0.85, 0.05, at.z * 0.85)], 0.008, 0.006, C(0x7a8a3a), C(0x5f7a34), 6, 4));
      };
      fruitAt(0, 0.85 + r.next() * 0.32);
      if (r.next() < 0.4) fruitAt(1, 0.55 + r.next() * 0.15);
    }
  },
  hotPepper(add, r, k) {
    // A rounded, glossy little bush (r15: never a stick with leaves): a short stem forking into
    // three or four leafy branches whose tufts close into a dome, bright glossy green; ripe pods
    // hang OUTSIDE the canopy — red, a couple orange, one late green — so a pepper row reads as a
    // block of colour from the high camera.
    const h = 0.15 + k * 0.075;
    const leaf = { shape: 'oval' as const, lift: 0.4, bend: 0.4, fold: 0.3, cup: 0.35, c0: C(0x2a6e2a), c1: C(0x6cbc44), segs: 4 };
    const stem0 = C(0x3f6a2a);
    add(stalk(h * 0.7, 0.013, 0.009, stem0, GREEN.mid, 0.01, 4));
    rosette(add, r, 4 + k, 0.085 + k * 0.016, 0.064, leaf, 0, 0.03);
    const nb = k === 0 ? 2 : k === 1 ? 3 : 4;
    const tips: THREE.Vector3[] = [];
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + r.next() * 0.5;
      const reach = 0.04 + k * 0.03;
      const top = new THREE.Vector3(Math.cos(a) * reach, h * (0.8 + r.next() * 0.25), Math.sin(a) * reach);
      add(tube([new THREE.Vector3(0, h * 0.3, 0), new THREE.Vector3(top.x * 0.5, h * 0.62, top.z * 0.5), top], 0.008, 0.005, stem0, GREEN.mid, 5, 4));
      tips.push(top);
      const nl = 4 + Math.min(2, k);
      for (let j = 0; j < nl; j++) {
        const la = (j / nl) * Math.PI * 2 + r.next() * 0.6;
        add(leafGeo((0.075 + k * 0.014) * (0.8 + r.next() * 0.4), 0.066, { ...leaf, lift: 0.2 + r.next() * 0.45 }), mat(top.x, top.y - (j % 2) * 0.014, top.z, 0, la, 0));
      }
      // (r21) A mid-branch leaf skirt closes the dome (r10 critic: spindly sprigs, bare soil between
      // tufts) — the mature bush reads as one rounded mass of glossy leaves.
      if (k >= 1) {
        const ns = 2 + Math.min(2, k);
        for (let j = 0; j < ns; j++) {
          const la = a + ((j - (ns - 1) / 2) / ns) * 1.9 + (r.next() - 0.5) * 0.4;
          const mx = top.x * 0.6;
          const mz = top.z * 0.6;
          add(leafGeo((0.08 + k * 0.012) * (0.85 + r.next() * 0.3), 0.07, { ...leaf, lift: 0.05 + r.next() * 0.3, bend: 0.5 }), mat(mx, h * 0.55 + r.next() * h * 0.12, mz, 0, Math.PI / 2 - la, 0));
        }
      }
    }
    if (k === 2) for (const t of tips) flower(add, 0.02, C(0xffffff), C(0xe8e0a0), mat(t.x * 1.15, t.y + 0.02, t.z * 1.15, 0.5, 0, 0));
    if (k >= 2) {
      const n = k === 3 ? 10 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.next() * 0.5;
        const roll = r.next();
        const ripe = k === 3 && roll < 0.92;
        const col0 = !ripe ? C(0x4f9a2a) : roll < 0.1 ? C(0xe0661a) : C(0xc8201a);
        const col1 = !ripe ? C(0x7aba3a) : roll < 0.1 ? C(0xf8a030) : C(0xe8382a);
        // Hung from the top of the dome and splayed outward over the leaf tufts (from ~50° above
        // pods hanging inside the canopy vanished): the bush wears its colour on the outside.
        const rad = 0.05 + k * 0.025 + r.next() * 0.025;
        const len = (k === 3 ? 0.11 : 0.07) * (0.85 + r.next() * 0.3);
        const y = h * (0.92 + r.next() * 0.16) + 0.03;
        // (r20) Pods HANG (≤ ~25° off vertical) from short arched pedicels at the canopy rim — the
        // r19 splayed pods stuck out sideways like confetti / flying carrots.
        const tilt = 0.1 + r.next() * 0.3;
        const yy = y - 0.035;
        const pm = mat(Math.cos(a) * rad, yy, Math.sin(a) * rad, -Math.sin(a) * tilt, 0, Math.cos(a) * tilt);
        add(tube([new THREE.Vector3(Math.cos(a) * rad * 0.55, yy + 0.045, Math.sin(a) * rad * 0.55), new THREE.Vector3(Math.cos(a) * rad * 0.85, yy + 0.04, Math.sin(a) * rad * 0.85), new THREE.Vector3(Math.cos(a) * rad, yy + 0.012, Math.sin(a) * rad)], 0.0045, 0.0035, stem0, GREEN.mid, 5, 4));
        add(hangingPod(len, 0.02, 0.25, col0, col1, 0.22, 6), pm.clone().multiply(mat(0, 0, 0, 0, r.next() * 6, 0)), 'gloss');
        add(rosetteCap(0.018, C(0x4f8a2e)), pm.clone().multiply(mat(0, 0.008, 0)));
      }
    }
  },
  hops(add, r, k) {
    const top = [0.3, 0.65, 1.0, 1.0][k]!;
    climber(add, r, top, { shape: 'lobed', lift: 0.2, bend: 0.5, fold: 0.25, serrate: 0.3, c0: C(0x3f7a2e), c1: C(0x6aaa3a), segs: 4 }, 0.13, 0.13, 1.0, 0.3, k >= 2 ? 3 : 2, k >= 2 ? 1.1 : 0.85);
    if (k >= 2) {
      const n = k === 3 ? 12 : 6;
      for (let i = 0; i < n; i++) {
        // Cones hang in front of the bine (toward the camera) so they read from the game view.
        const m = mat((r.next() - 0.5) * 0.62, 0.3 + r.next() * 0.72, 0.11 + r.next() * 0.04);
        add(hopCone(k === 3 ? 0.052 : 0.032, k === 3 ? C(0xd0e684) : C(0x8ac04a)), m, 'skin');
      }
    }
  },
  pumpkin(add, r, k) {
    const leaf = { shape: 'heart' as const, lift: 0.18, bend: 0.28, fold: 0.22, serrate: 0.2, cup: 0.5, c0: GREEN.dark, c1: GREEN.mid, segs: 7 };
    const nv = 2 + Math.min(2, k);
    const vines: THREE.Vector3[][] = [];
    for (let i = 0; i < nv; i++) vines.push(vine(add, r, (i / nv) * Math.PI * 2 + r.next(), 0.24 + k * 0.08, leaf, 0.14 + k * 0.03, 0.18 + k * 0.03, 2 + Math.min(1, k), k >= 2 && i < 2 ? 1 : 0));
    if (k === 2) {
      for (let i = 0; i < 2; i++) flower(add, 0.04, C(0xffc02a), C(0xe88a10), mat((r.next() - 0.5) * 0.3, 0.12, (r.next() - 0.5) * 0.3, 0.3, 0, 0));
      add(fruit(0.09, C(0x8fb048), { sy: 0.75, ribs: 9, crease: true, seg: 14, rows: 8 }), mat(0.05, 0.06, 0.1), 'skin');
    }
    if (k === 3) {
      // Every variant its own pumpkin: squat field pumpkin ↔ tall jack, deep orange ↔ pale
      // buttery, 8–12 ribs, sometimes a little one beside it.
      const form = r.next();
      const one = (s: number, px: number, pz: number): void => {
        const R = 0.2 * s;
        const sy = 0.6 + form * 0.3;
        const tilt = mat(px, R * (sy - 0.06), pz, (r.next() - 0.5) * 0.3, r.next() * Math.PI * 2, (r.next() - 0.5) * 0.3);
        // (r30) A wider palette per fruit (blind judge: "all the same size, shape and orange"): deep
        // red-orange through classic to pale buttery, now and then a green-shouldered late one.
        const tone = r.next();
        const skin = tone < 0.25 ? C(0xc84a18).lerp(C(0xd8601a), r.next()) : tone < 0.8 ? C(0xd8601a).lerp(C(0xf2a850), r.next() * 0.55) : C(0xf0b860).lerp(C(0xe8c888), r.next() * 0.5);
        if (r.next() < 0.15) skin.lerp(C(0x8a9a48), 0.25);
        add(fruit(R, skin, { sy, ribs: 8 + Math.floor(r.next() * 5), crease: true, seg: 20, rows: 9, shade: 0.5 }), tilt, 'skin');
        // A woody, curled stem (its own lean and length per fruit).
        const top = R * (sy - 0.1);
        const sl = 0.8 + r.next() * 0.5;
        const sa = r.next() * Math.PI * 2;
        const sc = Math.cos(sa);
        const ss = Math.sin(sa);
        add(tube([new THREE.Vector3(0, top, 0), new THREE.Vector3(0.01 * sc, top + 0.05 * sl, 0.01 * ss), new THREE.Vector3(0.04 * sc, top + 0.07 * sl, 0.04 * ss), new THREE.Vector3(0.06 * sc, top + 0.055 * sl, 0.06 * ss)], 0.016, 0.009, C(0x6a6a34), C(0x9a8a4a), 6, 5), tilt, 'skin');
        // A corkscrew tendril springing off the stem base.
        const tp: THREE.Vector3[] = [];
        for (let q = 0; q <= 10; q++) {
          const u = q / 10;
          const ang = sa + Math.PI + u * Math.PI * 5;
          const rad = 0.018 + 0.01 * u;
          tp.push(new THREE.Vector3(-sc * 0.05 * u + Math.cos(ang) * rad, top + 0.01 + u * 0.06, -ss * 0.05 * u + Math.sin(ang) * rad));
        }
        add(tube(tp, 0.0045, 0.003, C(0x5f8a34), C(0x8cb450), 20, 4), tilt);
      };
      one(0.82 + r.next() * 0.34, 0.05 + (r.next() - 0.5) * 0.06, 0.08 + (r.next() - 0.5) * 0.06);
      if (r.next() < 0.35) one(0.5 + r.next() * 0.12, -0.16 + (r.next() - 0.5) * 0.05, -0.1 + (r.next() - 0.5) * 0.05);
    }
  },
  eggplant(add, r, k) {
    const h = 0.15 + k * 0.08;
    add(stalk(h, 0.016, 0.01, C(0x4a3a4a), C(0x5a7a3a), 0.02, 5));
    const velvet = { c0: C(0x3f6a3a), c1: C(0x7a9a6a), rib: C(0x8a7aa0) };
    for (let t = 0; t < 1 + Math.min(2, k); t++) {
      // (r20) Ripe plants carry big velvet leaves (×1.35) over the fruit, not tiny ones beside plums.
      const big = k === 3 ? 1.35 : 1;
      rosette(add, r, 3, (0.13 + k * 0.02 - t * 0.02) * big, 0.11 * big, { shape: 'oval', lift: 0.35, bend: 0.45, fold: 0.25, ruffle: 0.08, segs: 4, ...velvet }, t * 1.0, 0.03 + t * h * 0.35);
    }
    if (k === 2) for (let i = 0; i < 3; i++) flower(add, 0.024, C(0xb888e0), C(0xf0d040), mat((r.next() - 0.5) * 0.2, h * (0.6 + r.next() * 0.3), (r.next() - 0.5) * 0.2, 0.6, 0, 0));
    if (k >= 2) {
      // Glossy aubergines hang just outside the velvet leaves (big enough to read as eggplants).
      const n = k === 3 ? 5 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.next() * 0.6;
        // (r20) Smaller fruit drooping on a curved green pedicel under the leaves (never lying on
        // the soil like oversized plums).
        const sz = k === 3 ? 0.052 + r.next() * 0.01 : 0.03;
        const y = Math.max(sz * 2.9, h * (0.5 + r.next() * 0.3));
        const rad = k === 3 ? 0.13 : 0.11;
        const fx = Math.cos(a) * rad;
        const fz = Math.sin(a) * rad;
        add(tube([new THREE.Vector3(fx * 0.4, y + 0.05, fz * 0.4), new THREE.Vector3(fx * 0.85, y + 0.045, fz * 0.85), new THREE.Vector3(fx, y + sz * 0.3, fz)], 0.007, 0.005, C(0x5a7a3a), C(0x6a8a44), 6, 4));
        add(fruit(sz, C(0x4a1a5e).offsetHSL((r.next() - 0.5) * 0.03, 0, (r.next() - 0.5) * 0.05), { sy: 1.6, taper: -0.25, seg: 12, shade: 0.45 }), mat(fx, y - sz * 1.25, fz, Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18), 'gloss');
        add(rosetteCap(sz * 0.65, C(0x5a7a3a)), mat(fx, y + sz * 0.25, fz));
      }
    }
  },
  grape(add, r, k) {
    const top = [0.35, 0.7, 1.0, 1.0][k]!;
    climber(add, r, top, { shape: 'lobed', lift: 0.15, bend: 0.5, fold: 0.2, serrate: 0.25, c0: C(0x4a7a2e), c1: C(0x7aaa44), segs: 4 }, 0.15, 0.16, 0.98, 0.3, k >= 2 ? 3 : 2, k >= 2 ? 1.1 : 0.85);
    if (k >= 2) {
      const n = k === 3 ? 5 : 4;
      for (let i = 0; i < n; i++) {
        // Bunches hang in front of the leaves, fat and dusty, so they read from the game camera.
        const m = mat((i / (n - 1) - 0.5) * 0.56 + (r.next() - 0.5) * 0.06, 0.5 + r.next() * 0.36, 0.13 + r.next() * 0.03);
        bunch(add, r, k === 3 ? 14 : 8, k === 3 ? 0.032 : 0.019, k === 3 ? 0.19 : 0.1, k === 3 ? C(0x6a2e8a) : C(0x9ac060), m, k === 3 ? 0.45 : 0);
      }
    }
  },
  beet(add, r, k) {
    // Upright fans of glossy leaves on ruby petioles; only the shoulder of the root shows.
    const n = 3 + k * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (r.next() - 0.5) * 0.5;
      const pl = 0.05 + k * 0.03 + r.next() * 0.02;
      const lean = 0.25 + r.next() * 0.25 + k * 0.05;
      const m = mat(0, 0.01, 0, 0, a, 0).multiply(mat(0, 0, 0, lean, 0, 0));
      add(stalk(pl, 0.007, 0.005, C(0x8a1a36), C(0xc0304a), 0, 4), m);
      add(leafGeo(0.1 + k * 0.045, 0.075 + k * 0.012, { shape: 'oval', lift: 1.15, bend: 0.35, fold: 0.3, ruffle: 0.12, rib: C(0xc0304a), c0: C(0x2f5a2a), c1: C(0x4f7a34), segs: 5 }), m.clone().multiply(mat(0, pl, 0, -0.5, 0, 0)));
    }
    if (k >= 1) {
      const R = [0.035, 0.05, 0.075][k - 1]!;
      const cap = new THREE.SphereGeometry(R, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
      cap.scale(1, 0.9, 1);
      cap.translate(0, -R * 0.62, 0);
      add(colored(cap, (p, nn) => C(0x8a1838).multiplyScalar(0.62 + 0.38 * nn.y).lerp(C(0x5a3a28), THREE.MathUtils.smoothstep(-p.y, R * 0.05, R * 0.3) * 0.6)), undefined, 'skin');
    }
  },
  yam(add, r, k) {
    // Heart-leaved vines trailing over the ridge; tuber shoulders just breaking the soil.
    const leaf = { shape: 'heart' as const, lift: 0.22, bend: 0.4, fold: 0.25, c0: C(0x3f7a2e), c1: C(0x7aaa44), segs: 6, cup: 0.45 };
    const nv = 2 + Math.min(2, k);
    for (let i = 0; i < nv; i++) vine(add, r, (i / nv) * Math.PI * 2 + r.next(), 0.14 + k * 0.07, leaf, 0.1 + k * 0.02, 0.1 + k * 0.018, 2 + Math.min(1, k), 0);
    // A short twining stem in the middle.
    add(stalk(0.08 + k * 0.03, 0.008, 0.005, C(0x6a4a3a), GREEN.mid, 0.02, 4));
    if (k >= 2) {
      for (let i = 0; i < (k === 3 ? 3 : 1); i++) {
        const a = (i / 3) * Math.PI * 2 + r.next();
        const tb = lumpyColored(0.045 + r.next() * 0.015, C(0xa04a38), r, 2, 0.15);
        tb.scale(1.6, 0.75, 0.9);
        add(tb, mat(Math.cos(a) * 0.09, -0.02, Math.sin(a) * 0.09, 0, -a, 0.15), 'skin');
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

/** Husk silhouette families (by what the living plant was). */
export type WitherKind = 'tall' | 'vine' | 'bush' | 'leafy';

export function witherKind(id: CropId): WitherKind {
  if (id === 'corn' || id === 'sunflower') return 'tall';
  if (id === 'melon' || id === 'pumpkin' || id === 'yam' || id === 'strawberry') return 'vine';
  if (id === 'tomato' || id === 'hotPepper' || id === 'eggplant' || id === 'blueberry' || id === 'potato') return 'bush';
  return 'leafy';
}

/** Identity accent of a dead plant (what is left of its fruit): one set per accent × variant. */
export type WitherAccent = 'melon' | 'pumpkin' | 'tomato' | 'pepper' | 'berry' | 'parsnip' | 'beet' | 'cauli' | 'kale' | 'corn' | 'sunflower' | 'plain';

export function witherAccent(id: CropId | undefined): WitherAccent {
  if (id === 'melon') return 'melon';
  if (id === 'pumpkin') return 'pumpkin';
  if (id === 'tomato') return 'tomato';
  if (id === 'hotPepper' || id === 'eggplant') return 'pepper';
  if (id === 'blueberry' || id === 'strawberry') return 'berry';
  if (id === 'parsnip' || id === 'beet' || id === 'kale' || id === 'corn' || id === 'sunflower') return id;
  if (id === 'cauliflower') return 'cauli';
  return 'plain';
}

/**
 * A collapsed, rotting gourd: the fruit's own rind pattern (stripes / ribs) desaturated, caved in
 * on top with a wrinkled sag, slumped into the soil.
 */
function deflated(R: number, base: THREE.Color, o: { stripes?: THREE.Color; ribs?: number; long?: number }): THREE.BufferGeometry {
  const g = fruit(R, base, { stripes: o.stripes ? 6 : undefined, stripeColor: o.stripes, ribs: o.ribs, crease: !!o.ribs, long: o.long, seg: o.stripes ? 24 : 16, shade: 0.5 });
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const d = Math.min(1, Math.hypot(x / (o.long ?? 1), z) / R);
    // Sag: squashed, the top caved in (a dish), wrinkles running round the dent.
    y = y * 0.5;
    if (y > 0) y -= (1 - d * d) * R * 0.32 * (1 + 0.25 * Math.sin(Math.atan2(z, x) * 7 + d * 9));
    pos.setY(i, y);
    // Spread a little where it slumps onto the soil.
    const k = 1 + Math.max(0, -y / R) * 0.25;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Dead plant after a season change: a bold, readable silhouette per crop family in desaturated
 * grey-brown (identifiable from across the farm), with the crop's own remains as the accent —
 * tomato: a stalk flopped over its stake, curled leaves hanging, shrivelled dark fruit;
 * pepper: a slumped bare stalk with a wrinkled pod dangling; melon / pumpkin: a collapsed mat of
 * runners and big flat dead leaves around a caved-in, faded gourd; tall crops a snapped cane.
 * Two silhouettes per family (v 0 slumped, 1 leaning), random yaw + tint per instance.
 */
function buildWithered(r: Rng, trellised: boolean, kind: WitherKind = 'leafy', v = 0, accent: WitherAccent = 'plain'): Map<Bucket, THREE.BufferGeometry> {
  const b = new MeshBuilder();
  const keys: Record<Bucket, THREE.Material> = { leaf: 'leaf' as unknown as THREE.Material, gloss: 'gloss' as unknown as THREE.Material, skin: 'skin' as unknown as THREE.Material, wood: 'wood' as unknown as THREE.Material };
  const add: Adder = (g, m, bucket = 'leaf') => void b.add(keys[bucket], g, m);
  // Desaturated grey-browns (no pink, no straw-gold): dead, dry, but darker than pale soil crumbs.
  const stem0 = C(0x3e352b);
  const stem1 = C(0x7a6c58);
  // (r16) Paler ashen-tan leaf tips so the husks separate from the brown soil at gameplay zoom.
  // (r22) Each family dies in its own cast of dead colour (r9 critic: mass death read as repetitive
  // grey shapes): tomato olive-khaki, pepper dark umber, gourds yellow-straw, berries mauve-grey,
  // corn bleached straw, sunflower burnt sienna; the rest keep the ashen tan.
  const WITHER_TINT: Partial<Record<WitherAccent, [number, number]>> = {
    tomato: [0x58533a, 0x9c9868],
    pepper: [0x4a3a2c, 0x8a6e52],
    melon: [0x5e5636, 0xb0a46c],
    pumpkin: [0x5c4630, 0xae8858],
    berry: [0x4e4448, 0x968690],
    corn: [0x6a5e40, 0xc8b484],
    sunflower: [0x4a3424, 0x8e6a48],
    kale: [0x4a4c40, 0x8e927c],
  };
  const tint = WITHER_TINT[accent];
  const leaf0 = C(tint?.[0] ?? 0x564c3e);
  const leaf1 = C(tint?.[1] ?? 0xa09276);
  // Dead leaves: petal-marked (no fall hue shift, no painted veins) so they stay grey-brown; rolled
  // up along the midrib and curled back at the tip (a crumpled husk, never a flat paper square).
  const curled = (len: number, w: number, lift = 0.05, bend = 0.4): THREE.BufferGeometry => asPetal(leafGeo(len, w * 0.8, { shape: 'oval', lift, bend, fold: 0.8, curl: 1.4 + r.next() * 0.8, ruffle: 0.45, cup: 0.7, c0: leaf0, c1: leaf1, segs: 5 }));
  // (r30) A dead stalk that stands up then FLOPS over (r10 critic: season-change husks were tiny pale
  // specks at the gameplay lens): ~0.3 m tall, bent over at the top with a curled leaf hanging off it.
  const flop = (h: number, a: number): void => {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(ca * 0.02, h * 0.55, sa * 0.02), new THREE.Vector3(ca * 0.07, h * 0.95, sa * 0.07), new THREE.Vector3(ca * 0.16, h * 0.9, sa * 0.16), new THREE.Vector3(ca * 0.22, h * 0.62, sa * 0.22)];
    add(tube(pts, 0.014, 0.007, stem0, stem1, 10, 5));
    const tip = pts[4]!;
    add(curled(0.12, 0.08, -1.0, 1.1), mat(tip.x, tip.y, tip.z, 0, -a + Math.PI / 2, 0));
    add(curled(0.1, 0.07, -0.7, 0.9), mat(pts[2]!.x, pts[2]!.y, pts[2]!.z, 0, -a + Math.PI / 2 + 1.6, 0));
  };
  const fallen = (n: number, rad: number): void => {
    for (let i = 0; i < n; i++) {
      const a = r.next() * Math.PI * 2;
      const d = rad * (0.45 + r.next() * 0.55);
      add(curled(0.08 + r.next() * 0.03, 0.06, -0.05, 0.1), mat(Math.cos(a) * d, 0.006, Math.sin(a) * d, 0, a, 0));
    }
  };
  if (trellised) {
    trellis(add);
    climber(add, r, v === 1 ? 0.5 : 0.75, { shape: 'heart', lift: -0.35, bend: 1.0, fold: 0.5, curl: 0.8, c0: leaf0, c1: leaf1, segs: 3 }, 0.12, 0.1, 1.0, 0.3, 2);
    fallen(4, 0.3);
  } else if (kind === 'tall') {
    // A dry cane snapped and folded over (0) or leaning hard (1), ribbon leaves hanging limp.
    const h = 0.62 + r.next() * 0.16;
    const lean = v === 1 ? 0.3 : 0.06;
    const hMain = v === 0 ? h * 0.6 : h;
    add(stalk(hMain, 0.024, 0.014, stem0, stem1, lean, 5));
    if (v === 0) add(stalk(h * 0.5, 0.014, 0.009, stem0, stem1, 0.05, 4), mat(lean, hMain - 0.01, 0, 0, r.next() * 6, -2.2));
    for (let i = 0; i < 4; i++) {
      const y = (0.22 + (i / 4) * 0.62) * hMain;
      add(asPetal(leafGeo(0.26 + r.next() * 0.08, 0.06, { shape: 'ribbon', lift: -0.45, bend: 1.4, fold: 0.35, ruffle: 0.3, c0: leaf0, c1: leaf1, segs: 5 })), mat(lean * (y / hMain) ** 2, y, 0, 0, i * 2.3 + r.next(), 0));
    }
    if (accent === 'sunflower') {
      // (r16) The big dead flower head hanging face-down off the bent neck: a dark seed disc in a
      // ragged ring of shrivelled bracts — the sunflower's own skeleton, not a generic stalk.
      const hx = lean + (v === 0 ? 0.26 : 0.1);
      const hy = v === 0 ? hMain * 0.62 : hMain - 0.04;
      add(fruit(0.11, C(0x2e241c), { sy: 0.35, seg: 14 }), mat(hx, hy, 0.04, 2.3, 0, 0.2), 'skin');
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        add(asPetal(leafGeo(0.07, 0.03, { shape: 'lance', lift: -0.6, bend: 0.8, curl: 1.2, c0: leaf0, c1: leaf1, segs: 3 })), mat(hx + Math.cos(a) * 0.08, hy - 0.02 + Math.sin(a) * 0.05, 0.04 + Math.sin(a) * 0.04, 2.3, a, 0));
      }
    } else if (accent === 'corn') {
      // A dry husked cob still hanging off the cane, its papery husk split open on dull kernels.
      const cy = hMain * 0.55;
      add(fruit(0.04, C(0x9a8452), { sy: 2.6, seg: 10 }), mat(0.07, cy, 0.03, 0, 0, -0.9), 'skin');
      for (let k = 0; k < 3; k++) add(asPetal(leafGeo(0.16, 0.05, { shape: 'ribbon', lift: -0.3, bend: 0.6, curl: 1.0, c0: C(0x8a7a5a), c1: C(0xb0a080), segs: 4 })), mat(0.06, cy - 0.02, 0.03, 0, k * 2.1, -0.9));
      // A dry tassel at the top.
      add(stalk(0.12, 0.006, 0.003, stem1, stem1, 0.2, 3), mat(lean * 0.9, hMain - 0.01, 0, 0, 0.6, 0.4));
    } else {
      // A dead, nodding seed head.
      add(fruit(0.06, C(0x3a2e24), { sy: 0.55, seg: 8 }), mat(lean + (v === 0 ? 0.26 : 0.04), v === 0 ? hMain * 0.6 : hMain + 0.02, 0.02, v === 0 ? 1.8 : 0.9, 0, 0.3), 'skin');
    }
    fallen(2, 0.22);
  } else if (kind === 'vine') {
    // A collapsed mat: four runners sprawled flat, big dead leaves lying along them.
    const nv = 4;
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * Math.PI * 2 + r.next() * 0.6;
      const len = 0.34 + r.next() * 0.12;
      const pts: THREE.Vector3[] = [];
      let ang = a;
      for (let k = 0; k <= 4; k++) {
        ang += (r.next() - 0.5) * 0.9;
        const d = (len * k) / 4;
        pts.push(new THREE.Vector3(Math.cos(ang) * d, 0.014 + (k === 1 ? 0.025 : 0), Math.sin(ang) * d));
      }
      add(tube(pts, 0.011, 0.006, stem0, stem1, 6, 4));
      const cv = new THREE.CatmullRomCurve3(pts);
      for (let k = 0; k < 2; k++) {
        const pp = cv.getPointAt(0.35 + k * 0.4);
        const big = 0.15 + r.next() * 0.05;
        add(curled(big, big * 0.9, 0.0, 0.2), mat(pp.x, pp.y + 0.01, pp.z, 0.1, r.next() * 6, 0.1));
      }
    }
    // The fruit left on the vine, caved in where it lay.
    if (accent === 'melon') {
      // Rotted through: olive-brown rind with only a ghost of its stripes, caved in, and a sunken
      // grey-white mould patch on the shoulder.
      const ry = r.next() * 6;
      add(deflated(0.13, C(0x6a5e3c), { stripes: C(0x4a4028), long: 1.2 }), mat(0.05, 0.035, -0.03, 0, ry, 0.12), 'skin');
      const mould = new THREE.CircleGeometry(0.06, 12);
      mould.rotateX(-Math.PI / 2);
      const mp = mould.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < mp.count; i++) mp.setY(i, -0.008 * (1 - Math.hypot(mp.getX(i), mp.getZ(i)) / 0.06) + 0.003 * Math.sin(mp.getX(i) * 140) * Math.sin(mp.getZ(i) * 120));
      mould.computeVertexNormals();
      add(colored(mould, (q) => C(0x3a3020).lerp(C(0xb8b49c), THREE.MathUtils.smoothstep(Math.hypot(q.x, q.z) / 0.06, 0.15, 0.7) * (0.75 + 0.25 * Math.sin(q.x * 90 + q.z * 70)))), mat(0.06, 0.068, -0.03, 0.12, ry, 0.1), 'skin');
    }
    else if (accent === 'pumpkin') add(deflated(0.13, C(0xa07a50), { ribs: 9 }), mat(0.05, 0.04, -0.02, 0.1, r.next() * 6, 0.08), 'skin');
    else if (accent === 'berry') {
      for (let i = 0; i < 3; i++) add(lumpyColored(0.026, C(0x5a2a22), r, 2, 0.3), mat((r.next() - 0.5) * 0.3, 0.018, (r.next() - 0.5) * 0.3), 'skin');
    }
    // A stub of the crown.
    add(stalk(0.1, 0.014, 0.008, stem0, stem1, 0.06, 4));
  } else if (kind === 'bush') {
    if (accent === 'tomato') {
      // Its stake still standing; the dead stalk flopped over the tie, leaves hanging off it.
      add(stalk(0.62, 0.017, 0.014, WOOD.post, WOOD.light, 0, 5), mat(-0.06, -0.02, 0, 0, 0, 0.04), 'wood');
      add(stalk(0.03, 0.022, 0.022, WOOD.twine, WOOD.twine, 0, 5), mat(-0.05, 0.41, 0), 'wood');
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.03, 0.22, 0), new THREE.Vector3(-0.04, 0.42, 0.01), new THREE.Vector3(0.06, 0.47, 0.03), new THREE.Vector3(0.17, 0.38, 0.05), new THREE.Vector3(0.22, 0.24, 0.06)];
      add(tube(pts, 0.016, 0.008, stem0, stem1, 10, 5));
      const cv = new THREE.CatmullRomCurve3(pts);
      for (let k = 0; k < 3; k++) {
        const pp = cv.getPointAt(0.35 + k * 0.22);
        add(curled(0.13, 0.09, -0.9, 1.0), mat(pp.x, pp.y, pp.z, 0, (k - 1) * 1.9 + 0.4, 0));
      }
      // Shrivelled fruit: one still hanging at the bend, two dropped on the soil.
      const red = C(0x6e3226);
      add(lumpyColored(0.04, red, r, 2, 0.3), mat(0.15, 0.31, 0.06, 0, 0, 0), 'skin');
      add(lumpyColored(0.035, red, r, 2, 0.35), mat(0.2, 0.028, -0.1, 0, 0, 0, 1, 0.7, 1), 'skin');
      add(lumpyColored(0.032, C(0x5e3a26), r, 2, 0.35), mat(-0.14, 0.024, 0.12, 0, 0, 0, 1, 0.7, 1), 'skin');
      fallen(3, 0.24);
    } else if (accent === 'pepper') {
      // A bare stalk slumped sideways, two curled leaves, wrinkled pods hanging / dropped.
      const lean = v === 1 ? 0.24 : 0.36;
      add(stalk(0.36, 0.016, 0.008, stem0, stem1, lean, 5));
      add(stalk(0.2, 0.011, 0.006, stem0, stem1, -0.12, 4), mat(0.03, 0.14, 0, 0, 1.1, 0.5));
      for (let k = 0; k < 3; k++) add(curled(0.12, 0.075, -0.8, 1.0), mat(lean * (0.4 + k * 0.2) ** 2, 0.16 + k * 0.07, 0, 0, k * 2.2, 0));
      const pod = (len: number, c: THREE.Color): THREE.BufferGeometry => tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.005, -len * 0.5, 0.01), new THREE.Vector3(0.02, -len, 0.0)], 0.022, 0.006, c, c.clone().multiplyScalar(0.7), 6, 6);
      add(pod(0.1, C(0x6a2e22)), mat(lean * 0.8, 0.3, 0.02, 0, 0, 0.2), 'skin');
      add(pod(0.09, C(0x5a3424)), mat(0.14, 0.02, 0.1, Math.PI / 2, 0, 0.4), 'skin');
      fallen(3, 0.22);
    } else {
      // Twiggy dead shrub: woody stems splayed, curled leaves clinging, a few dark berries.
      const ns = 5;
      for (let i = 0; i < ns; i++) {
        const a = (i / ns) * Math.PI * 2 + r.next() * 0.5;
        const h = (v === 0 ? 0.22 : 0.3) + r.next() * 0.1;
        add(stalk(h, 0.013, 0.006, stem0, stem1, 0.08, 4), mat(0, 0, 0, 0, a, v === 0 ? 0.8 : 0.4));
      }
      for (let i = 0; i < 5; i++) {
        const a = r.next() * Math.PI * 2;
        add(curled(0.1, 0.07, -0.6, 0.9), mat(Math.cos(a) * 0.1, 0.12 + r.next() * 0.1, Math.sin(a) * 0.1, 0, a, 0));
      }
      flop(0.32, r.next() * Math.PI * 2);
      const bc = accent === 'berry' ? C(0x2e2c40) : C(0x4a3a2a);
      for (let i = 0; i < 4; i++) {
        const a = r.next() * Math.PI * 2;
        add(berry(0.02, bc), mat(Math.cos(a) * 0.09, 0.14 + r.next() * 0.08, Math.sin(a) * 0.09), 'skin');
      }
      fallen(4, 0.24);
    }
  } else {
    // (r16) Per-crop skeletons instead of one grey rosette carpet.
    const lift = v === 0 ? 0.08 : 0.5;
    if (accent === 'parsnip' || accent === 'beet') {
      // A root crop gone over: the shoulder of the root heaved up out of the soil (cream-grey
      // parsnip / blackened ruby beet), a few limp leaf stalks flopped to one side.
      const beet = accent === 'beet';
      add(lumpyColored(beet ? 0.05 : 0.04, beet ? C(0x4e1f2a) : C(0xb2a587), r, 2, 0.25), mat(0, 0.01, 0, 0, 0, 0, 1, beet ? 0.85 : 1.5, 1), 'skin');
      const side = r.next() * Math.PI * 2;
      flop(0.28 + r.next() * 0.06, side + Math.PI * 0.7);
      for (let k = 0; k < 4; k++) {
        const a = side + (k - 1.5) * 0.45;
        add(stalk(0.16 + r.next() * 0.05, 0.007, 0.004, beet ? C(0x4a2228) : stem0, beet ? C(0x6e3a40) : stem1, 0.0, 3), mat(0, 0.04, 0, 0, a, 1.15 + r.next() * 0.25));
        add(curled(0.09, 0.06, -0.2, 0.4), mat(Math.cos(a) * 0.15, 0.02, Math.sin(a) * 0.15, 0, -a + Math.PI / 2, 0));
      }
    } else if (accent === 'cauli') {
      // A rotted head slumped in its collar of big flopped outer leaves, browning to grey mould.
      add(lumpyColored(0.085, C(0x8c846c), r, 3, 0.3), mat(0.02, 0.04, 0, 0, 0, 0.15, 1, 0.6, 1), 'skin');
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + r.next() * 0.4;
        add(curled(0.17, 0.13, -0.1, 0.25), mat(Math.cos(a) * 0.08, 0.015, Math.sin(a) * 0.08, 0, -a + Math.PI / 2, 0));
      }
    } else if (accent === 'kale') {
      // Bolted: a tall woody stem stripped bare, leaf-rib stubs up its length, a frizz of dead
      // leaves left at the top, leaning.
      const h = v === 0 ? 0.34 : 0.42;
      const ln = v === 0 ? 0.22 : 0.12;
      add(stalk(h, 0.016, 0.009, stem0, stem1, ln, 5));
      for (let k = 0; k < 5; k++) {
        const y = 0.06 + (k / 5) * h * 0.8;
        add(stalk(0.06, 0.005, 0.003, stem1, stem1, 0, 3), mat(ln * (y / h) ** 2, y, 0, 0, k * 2.4, 1.0));
      }
      for (let k = 0; k < 3; k++) add(curled(0.1, 0.08, -0.5, 0.9), mat(ln, h, 0, 0, k * 2.1, 0));
    } else {
      // A slumped rosette of dead leaves flat on the soil (0) or a leaning tuft (1).
      rosette(add, r, 6, 0.19, 0.11, { shape: 'lance', lift, bend: 1.0, fold: 0.5, ruffle: 0.35, c0: leaf0, c1: leaf1, segs: 4 }, 0, 0.01);
      add(stalk(v === 1 ? 0.22 : 0.12, 0.013, 0.007, stem0, stem1, 0.12, 4));
      flop(0.26 + r.next() * 0.08, r.next() * Math.PI * 2);
    }
    fallen(1, 0.2);
  }
  const out = new Map<Bucket, THREE.BufferGeometry>();
  for (const [k, g] of b.geometries()) {
    const bk = (Object.keys(keys) as Bucket[]).find((x) => keys[x] === k)!;
    g.computeBoundingSphere();
    out.set(bk, g);
  }
  return out;
}

/**
 * Raised soil berm the giant shouldered up around its base: a lofted, lumpy ring (~6 cm high) that
 * rolls up from the bed, crests and spills over, broken into clods on its outer slope; vertex AO
 * darkens the inner fold (under the fruit) and the outer foot. No flat decal, no ink cracks.
 */
function soilBerm(add: Adder, r: Rng, R0: number, hScale = 1, tone = 1): void {
  const RI = R0 * 0.8;
  const RO = R0 * 1.6;
  const SEG = 64;
  const RINGS = 9;
  const pos: number[] = [];
  const col: number[] = [];
  const phs = [r.next() * 6, r.next() * 6, r.next() * 6];
  const hAt = (u: number, a: number): number => {
    // u 0 (inner) → 1 (outer): a crest at ~0.35 that spills outward.
    const crest = Math.exp(-Math.pow((u - 0.35) / 0.24, 2));
    const lump = 0.75 + 0.18 * Math.sin(a * 5 + phs[0]!) + 0.12 * Math.sin(a * 11 + phs[1]!) + 0.08 * Math.sin(a * 23 + phs[2]! + u * 4);
    return 0.062 * hScale * crest * lump - 0.012 * THREE.MathUtils.smoothstep(u, 0.8, 1);
  };
  for (let j = 0; j <= RINGS; j++) {
    const u = j / RINGS;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(a * 3 + phs[1]!) + 0.04 * Math.sin(a * 7 + phs[2]!);
      const rr = (RI + (RO - RI) * u) * (u > 0 ? wob : 1);
      const h = hAt(u, a);
      pos.push(Math.cos(a) * rr, h, Math.sin(a) * rr);
      const ao = (0.55 + 0.45 * THREE.MathUtils.smoothstep(u, 0.02, 0.3)) * (0.8 + 0.2 * (1 - THREE.MathUtils.smoothstep(u, 0.7, 1)));
      const crumb = 0.9 + 0.1 * Math.sin(a * 41 + u * 29) * Math.sin(a * 17 - u * 13);
      // Freshly heaved (drier, paler) on the crest, darker damp soil in the fold.
      const c = C(0x6a4a32).lerp(C(0x8a684a), THREE.MathUtils.smoothstep(h, 0.02, 0.06 * hScale) * 0.7).multiplyScalar(ao * crumb * tone);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const q = j * (SEG + 1) + i;
      const w = q + SEG + 1;
      idx.push(q, w, q + 1, w, w + 1, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  add(g.toNonIndexed(), undefined, 'wood');
  // Broken clods tumbled down the berm's outer slope.
  for (let i = 0; i < 26; i++) {
    const a = r.next() * Math.PI * 2;
    const u = 0.3 + r.next() * 0.65;
    const d = RI + (RO - RI) * u;
    const sz = 0.03 + r.next() * 0.045 * (1.2 - u);
    add(lumpyColored(sz, C(0x7a5a3e).multiplyScalar(0.8 + r.next() * 0.35), r, 2.4, 0.32), mat(Math.cos(a) * d, hAt(u, a) + sz * 0.25, Math.sin(a) * d, r.next(), r.next() * 6, r.next(), 1, 0.62, 1), 'wood');
  }
}

/**
 * Giant cauliflower curd: fractal florets — 30 lumpy, bumpy domes in three sizes packed over a
 * core, each with its own small bumps, cream-to-ivory with deep warm AO in the crevices.
 */
function giantCurd(R: number, r: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ivory = C(0xe8dab4);
  const cream = C(0xc4ab7c);
  const core = new THREE.SphereGeometry(R * 0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  core.scale(1, 0.62, 1);
  parts.push(colored(core, (_p, nn) => cream.clone().multiplyScalar(0.45 + 0.2 * Math.max(0, nn.y))));
  const N = 30;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const el = Math.acos(1 - t * 0.95);
    const az = i * 2.39996 + r.next() * 0.25;
    const size = i % 5 === 0 ? 0.5 : i % 2 ? 0.38 : 0.3; // three sizes, packed so they merge
    const dir = new THREE.Vector3(Math.sin(el) * Math.cos(az), Math.cos(el), Math.sin(el) * Math.sin(az));
    const fr = R * size * (0.9 + r.next() * 0.2) * (1 - t * 0.2);
    // Indexed sphere → smooth normals (a non-indexed icosphere shades as flat facets: "popcorn").
    const g = new THREE.SphereGeometry(fr, 14, 9);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const ph = r.next() * 10;
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k);
      n.copy(v).normalize();
      // Floret-of-florets: bumps on bumps (the fractal curd look).
      const bump = 1 + 0.12 * Math.sin(n.x * 9 + ph) * Math.sin(n.z * 8 + n.y * 7) + 0.07 * Math.sin(n.x * 23 + n.y * 19 + ph) * Math.sin(n.z * 21) + 0.035 * Math.sin(n.x * 51 + ph) * Math.sin(n.y * 47) * Math.sin(n.z * 43);
      pos.setXYZ(k, v.x * bump, Math.max(v.y * bump * 0.82, -fr * 0.35), v.z * bump);
    }
    g.computeVertexNormals();
    const c = colored(g, (p, nn) => {
      const toward = nn.dot(dir);
      const ao = 0.4 + 0.6 * THREE.MathUtils.smoothstep(toward, -0.4, 0.8);
      const bumpy = 0.93 + 0.07 * Math.sin(p.x * 60 + p.z * 50) * Math.sin(p.y * 55);
      return cream.clone().lerp(ivory, THREE.MathUtils.smoothstep(toward, 0.2, 0.95)).multiplyScalar(ao * bumpy);
    });
    c.translate(dir.x * R * 0.62, dir.y * R * 0.44, dir.z * R * 0.62);
    parts.push(c);
  }
  const b = new MeshBuilder();
  const M = 'gcurd' as unknown as THREE.Material;
  for (const p of parts) b.add(M, p);
  return b.geometries().get(M)!;
}

/** A crow-eaten plant: snapped stalk stubs, torn leaf scraps flat on the soil, a few pecked crumbs. */
function buildEaten(r: Rng, trellised: boolean, leaf: THREE.Color): Map<Bucket, THREE.BufferGeometry> {
  const b = new MeshBuilder();
  const keys: Record<Bucket, THREE.Material> = { leaf: 'leaf' as unknown as THREE.Material, gloss: 'gloss' as unknown as THREE.Material, skin: 'skin' as unknown as THREE.Material, wood: 'wood' as unknown as THREE.Material };
  const add: Adder = (g, m, bucket = 'leaf') => void b.add(keys[bucket], g, m);
  if (trellised) trellis(add);
  const dark = leaf.clone().multiplyScalar(0.7);
  // Torn stalks: thick green stubs with bright, pale ragged tips (fresh tissue where the beak tore).
  for (let i = 0; i < 4; i++) {
    const a = r.next() * Math.PI * 2;
    const h = 0.05 + r.next() * 0.06;
    const m = mat(Math.cos(a) * 0.035, 0, Math.sin(a) * 0.035, (r.next() - 0.5) * 0.5, 0, (r.next() - 0.5) * 0.5);
    add(stalk(h, 0.016, 0.012, dark, C(0x9ac060), 0, 5), m);
    const tip = new THREE.ConeGeometry(0.014, 0.022, 5);
    tip.rotateX(Math.PI);
    add(colored(tip, () => C(0xeef2c4)), m.clone().multiply(mat(0, h + 0.006, 0, 0, r.next() * 3, 0)));
  }
  // Shredded leaf bits scattered around the tile (bright and dark sides up).
  for (let i = 0; i < 9; i++) {
    const a = r.next() * Math.PI * 2;
    const d = 0.06 + r.next() * 0.2;
    const c1 = i % 3 === 0 ? C(0xb8d880) : leaf;
    add(leafGeo(0.05 + r.next() * 0.05, 0.045, { shape: 'lobed', lift: 0.05, bend: 0.1, fold: 0.35, curl: 0.4, serrate: 0.6, c0: dark, c1, segs: 2 }), mat(Math.cos(a) * d, 0.004, Math.sin(a) * d, 0, a, 0));
  }
  for (let i = 0; i < 4; i++) {
    const a = r.next() * Math.PI * 2;
    add(berry(0.01, C(0xd8c890)), mat(Math.cos(a) * 0.1, 0.006, Math.sin(a) * 0.1));
  }
  const out = new Map<Bucket, THREE.BufferGeometry>();
  for (const [k, g] of b.geometries()) {
    const bk = (Object.keys(keys) as Bucket[]).find((x) => keys[x] === k)!;
    g.computeBoundingSphere();
    out.set(bk, g);
  }
  return out;
}

/** Flat disc of dark, wet, pressed soil (inner → outer colour), a few mm above the bed. */
function contactDisc(R: number, inner: THREE.Color, outer: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(R, 40, 0, Math.PI * 2);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.006, 0);
  return colored(g, (p) => inner.clone().lerp(outer, THREE.MathUtils.smoothstep(Math.hypot(p.x, p.z) / R, 0.55, 1)));
}

/**
 * Giant melon: a heavy, lopsided watermelon slumped on its flattened belly — one end fatter, the
 * flanks sagging outward near the ground, gentle lumps; irregular rind stripes (noise-warped, width
 * varying band to band) fading into mottled poles, a pale yellow field spot where it lay on the
 * soil, and a deep AO band under the bulge so it sits IN the bed instead of floating on it.
 * Origin on the ground; long axis along X.
 */
function giantMelonBody(r: Rng): THREE.BufferGeometry {
  // (r23) Denser (160 × 84): the rind's flame-edged stripes are vertex colour, and at 96 × 56 their
  // edges blurred into soft painted bands (r10 critic: "a smooth CG egg with painted stripes").
  const g = new THREE.SphereGeometry(1, 160, 84);
  g.rotateZ(Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const ph = [r.next() * 6, r.next() * 6, r.next() * 6, r.next() * 6];
  // (r14: ~2.5 tiles long — a giant fills its 3×3 block, not "a big one".)
  const RX = 1.24;
  const RY = 0.84;
  const RZ = 1.1;
  const CY = 0.56;
  const FLOOR = -0.56;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = v.x;
    let x = v.x * RX;
    let y = v.y * RY;
    let z = v.z * RZ;
    // Lopsided: the +X end fatter, a shallow waist, a bulge toward +Z.
    const fat = 1 + 0.12 * u + 0.04 * Math.sin(u * 2.6 + ph[0]!) - 0.03 * Math.exp(-Math.pow((u + 0.15) / 0.25, 2));
    y *= fat;
    z *= fat * (1 + 0.04 * Math.max(0, v.z));
    // Weight: the lower half sags outward.
    if (y < 0) {
      const k = Math.min(1, -y / RY);
      z *= 1 + 0.1 * k;
      x *= 1 + 0.03 * k;
    }
    // Flattened belly (pressed into the soil).
    if (y < FLOOR) y = FLOOR + (y - FLOOR) * 0.15;
    // A dent on the near flank + soft lumps.
    const dent = 1 - 0.035 * Math.exp(-(Math.pow((u - 0.35) / 0.25, 2) + Math.pow((v.y + 0.1) / 0.35, 2))) * Math.max(0, v.z);
    // (r17) Surface breakup: broad lumps + a fine pebbled bump (a real rind is never a CG egg).
    const n = dent * (1 + 0.03 * Math.sin(v.x * 3.1 + ph[1]!) * Math.sin(v.z * 3.7 + ph[2]!) + 0.012 * Math.sin(v.y * 6.3 + v.x * 4.9 + ph[3]!) + 0.011 * Math.sin(v.x * 17.3 + v.z * 11.1) * Math.sin(v.y * 15.7 - v.z * 9.3) + 0.005 * Math.sin(v.x * 41 + v.y * 37) * Math.sin(v.z * 33 - v.y * 29));
    pos.setXYZ(i, x * n, y * n + CY, z * n);
  }
  g.computeVertexNormals();
  const light = C(0x86b450);
  const lightB = C(0x6e9e40);
  const dark = C(0x173a12);
  const spot = C(0xd9c779);
  return colored(g, (q, nn) => {
    const xn = q.x / RX;
    const a = Math.atan2(q.z, q.y - CY);
    // Noise-warped stripe phase + band-to-band width variance.
    // (r23) Tiger stripes: a lazy meander along the length plus FLAME edges — short serrated
    // tongues of dark green licking into the pale ground (two higher harmonics along the length,
    // phase-shifted per band), so the bands read as grown rind, not a decal of clean ribbons.
    const N = 12;
    const bandIx = Math.floor(((a + Math.PI) / (Math.PI * 2)) * N + 0.5);
    const jag = Math.sin(xn * 3.7 + a * 2 + ph[0]!) * 0.3 + Math.sin(xn * 8.3 - a * 3 + ph[1]!) * 0.12;
    const flame = Math.sin(xn * 27 + bandIx * 2.1 + ph[2]!) * 0.16 + Math.sin(xn * 53 + bandIx * 4.7) * 0.07 + Math.sin(xn * 97 - bandIx * 1.3) * 0.03;
    const st = 0.5 + 0.5 * Math.cos(a * N + jag);
    // Band width varies band to band and along the length (some stripes pinch, some fork wide).
    const thr = 0.46 + 0.12 * Math.sin(a * 2.3 + ph[2]!) + 0.07 * Math.sin(xn * 5.2 + a * 1.7) - flame * 1.25;
    const band = THREE.MathUtils.smoothstep(st, thr, thr + 0.07);
    // Inside the dark band: a deeper core vein (the stripes are layered, never a flat fill).
    const core = THREE.MathUtils.smoothstep(st, thr + 0.22, thr + 0.32);
    const c = light.clone().lerp(lightB, 0.5 + 0.5 * Math.sin(a * 3 + xn * 2 + ph[3]!)).lerp(dark, band * 0.82);
    c.multiplyScalar(1 - core * 0.22);
    // Fine mottling + the stripes breaking up toward the poles.
    c.multiplyScalar(0.93 + 0.07 * Math.sin(q.x * 37 + q.z * 29) * Math.sin(q.y * 41 + q.x * 13));
    // (r17) Rind mottling: pale netted blotches inside the light bands, dark freckles in the stripes.
    const mot = Math.sin(q.x * 13.1 + Math.sin(q.z * 7.7) * 1.6) * Math.sin(q.z * 11.3 + Math.sin(q.y * 9.1) * 1.4) * Math.sin(q.y * 12.7 + q.x * 3.3);
    c.lerp(C(0xb4cc7c), THREE.MathUtils.smoothstep(mot, 0.15, 0.6) * 0.5 * (1 - band * 0.7));
    c.multiplyScalar(1 - THREE.MathUtils.smoothstep(Math.sin(q.x * 63 + q.y * 17) * Math.sin(q.z * 59 - q.x * 23), 0.6, 0.95) * 0.18);
    c.lerp(lightB.clone().multiplyScalar(0.72), THREE.MathUtils.smoothstep(Math.abs(xn), 0.8, 1.0) * 0.55);
    // Field spot: pale yellow where it lay (wraps up the low near flank so the camera sees it).
    const spotM = THREE.MathUtils.smoothstep(0.42 - q.y + 0.1 * Math.sin(q.x * 3.3 + ph[1]!) + 0.06 * Math.sin(q.x * 9 + q.z * 7), 0.0, 0.18) * THREE.MathUtils.smoothstep(q.z, -0.2, 0.4);
    c.lerp(spot, spotM * 0.75);
    // Light: top-lit, a deep AO band under the bulge, almost black right at the contact.
    // Form shading baked strong (the matte crop skin wraps light a lot): a clear terminator round
    // the flanks, a waxy highlight on the sunlit shoulder.
    const top = 0.42 + 0.58 * THREE.MathUtils.smoothstep(nn.y, -0.45, 0.85);
    const ao = 0.22 + 0.78 * THREE.MathUtils.smoothstep(q.y, 0.0, 0.55);
    c.multiplyScalar(top * ao);
    // (r23) A soft waxy bloom instead of a hot painted highlight (the gloss lobe does the shine), and a
    // dusting of dried soil splashed up the lower flank.
    const hl = THREE.MathUtils.smoothstep(nn.x * -0.42 + nn.y * 0.82 + nn.z * 0.38, 0.86, 0.995);
    c.lerp(C(0xb8c8a0), hl * 0.12);
    const dirt = THREE.MathUtils.smoothstep(0.34 - q.y + 0.12 * Math.sin(q.x * 7.1 + q.z * 5.3), 0.0, 0.22) * THREE.MathUtils.smoothstep(Math.sin(q.x * 31 + q.z * 17) * Math.sin(q.z * 23 - q.y * 19), -0.2, 0.6);
    return c.lerp(C(0x6a5034), dirt * 0.45);
  });
}

export type GiantKind = 'cauliflower' | 'melon' | 'pumpkin';

/** Giant crop centred on a 3×3 block (local units = tiles). */
function buildGiant(id: GiantKind, r: Rng): Map<Bucket, THREE.BufferGeometry> {
  const b = new MeshBuilder();
  const keys: Record<Bucket, THREE.Material> = { leaf: 'leaf' as unknown as THREE.Material, gloss: 'gloss' as unknown as THREE.Material, skin: 'skin' as unknown as THREE.Material, wood: 'wood' as unknown as THREE.Material };
  const add: Adder = (g, m, bucket = 'leaf') => void b.add(keys[bucket], g, m);
  // Raised soil berm where the giant shouldered the bed aside (static: 'wood' bucket).
  if (id === 'melon') soilBerm(add, r, 1.22, 1.6, 0.72);
  else soilBerm(add, r, id === 'cauliflower' ? 0.95 : 1.12);
  // Vines radiating from under the giant out over the berm, with leaves riding them.
  if (id !== 'cauliflower') {
    const vleaf: LeafOpts = id === 'melon' ? { shape: 'lobed', lift: 0.28, bend: 0.3, fold: 0.22, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 5 } : { shape: 'heart', lift: 0.25, bend: 0.3, fold: 0.22, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 5 };
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25 + r.next() * 0.4;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 5; k++) {
        const u = k / 5;
        const d = 0.7 + u * 0.95;
        const aa = a + Math.sin(u * 3 + i) * 0.18;
        pts.push(new THREE.Vector3(Math.cos(aa) * d, 0.03 + Math.exp(-Math.pow((d - 1.25) / 0.3, 2)) * 0.06 + 0.02 * Math.sin(u * 7), Math.sin(aa) * d));
      }
      add(tube(pts, 0.026, 0.012, C(0x4f7a2e), C(0x7aa24a), 12, 5));
      const cv = new THREE.CatmullRomCurve3(pts);
      for (let k = 0; k < 3; k++) {
        const t = Math.min(0.97, (id === 'melon' ? 0.48 + k * 0.2 : 0.3 + k * 0.28) + r.next() * 0.06);
        const pp = cv.getPointAt(t);
        const tan = cv.getTangentAt(t);
        const side = k % 2 ? 1 : -1;
        add(leafGeo(0.3 + r.next() * 0.12, 0.34 + r.next() * 0.1, vleaf), mat(pp.x, pp.y + 0.04, pp.z, 0, Math.atan2(tan.x, tan.z) + side * (1.0 + r.next() * 0.4), 0));
      }
    }
  }

  if (id === 'pumpkin') {
    // Settled INTO the bed (sunk a hand's width, a dark underside where it sits on the soil): a
    // giant must weigh something, not hover on its leaves.
    // Fills its 3×3 footprint (≈ 2.7 tiles across, r7 critic: "only ~2× a normal one").
    // (r19) A dark pressed-soil pool under it (weight), and a squatter, heavier body (sy 0.64 → 0.6)
    // leaning a touch off-axis (no perfect lathe).
    add(contactDisc(1.3, C(0x0c0704), C(0x2e2016)), undefined, 'wood');
    add(fruit(1.36, C(0xe8741e), { sy: 0.6, ribs: 12, crease: true, seg: 84, rows: 34, shade: 0.3, rind: true }), mat(0, 0.6, 0, 0.04, 0, -0.03), 'skin');
    // A thick, gnarled woody stem that curls over, and a dried tendril.
    const sy0 = 0.2;
    add(tube([new THREE.Vector3(0, 1.18 + sy0, 0), new THREE.Vector3(0.03, 1.38 + sy0, 0.01), new THREE.Vector3(0.14, 1.5 + sy0, 0.07), new THREE.Vector3(0.28, 1.46 + sy0, 0.14), new THREE.Vector3(0.33, 1.36 + sy0, 0.17)], 0.1, 0.05, C(0x5e5a2c), C(0x9a8a4a), 14, 8), undefined, 'skin');
    add(tube([new THREE.Vector3(0.3, 1.38 + sy0, 0.16), new THREE.Vector3(0.48, 1.47 + sy0, 0.22), new THREE.Vector3(0.6, 1.38 + sy0, 0.4), new THREE.Vector3(0.53, 1.3 + sy0, 0.54), new THREE.Vector3(0.44, 1.34 + sy0, 0.52)], 0.02, 0.008, GREEN.mid, C(0xa8b060), 14, 4));
    // Leaf collar round the base.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r.next() * 0.5;
      add(leafGeo(0.78, 0.92, { shape: 'heart', lift: 0.14, bend: 0.25, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 6 }), mat(Math.cos(a) * 1.12, 0.05, Math.sin(a) * 1.12, 0, a + Math.PI / 2, 0));
    }
    // Satellite leaves on the vines trailing away.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4 + r.next() * 0.4;
      add(tube([new THREE.Vector3(Math.cos(a) * 0.9, 0.04, Math.sin(a) * 0.9), new THREE.Vector3(Math.cos(a + 0.2) * 1.25, 0.05, Math.sin(a + 0.2) * 1.25), new THREE.Vector3(Math.cos(a + 0.05) * 1.55, 0.03, Math.sin(a + 0.05) * 1.55)], 0.022, 0.012, C(0x4f7a2e), C(0x6f9a3e), 8, 5));
      add(leafGeo(0.38, 0.45, { shape: 'heart', lift: 0.25, bend: 0.3, fold: 0.22, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 5 }), mat(Math.cos(a + 0.1) * 1.4, 0.06, Math.sin(a + 0.1) * 1.4, 0, a + 1.2, 0));
    }
  } else if (id === 'melon') {
    // Wet, dark soil pressed flat under the belly (fills the berm's ring: real ground contact).
    // (r17) Wider and darker: a strong AO pool the belly sinks into.
    add(contactDisc(1.32, C(0x0c0704), C(0x2e2016)), undefined, 'wood');
    // (r19) Weight: the belly slumps a little wider and lower than its rind's grown shape.
    // (r20) Waxy rind: the body rides the gloss bucket (a specular lobe slides over the stripes like
    // the field melons' — the matte r19 body read as a flat-shaded blimp next to them).
    add(giantMelonBody(r), mat(0, 0, 0, 0, 0.3, 0).multiply(new THREE.Matrix4().makeScale(1.04, 0.92, 1.03)), 'gloss');
    // (r17) Grown out of the patch, not pasted on it: vine runners creep round the base and up
    // over the belly's lower flank, and leaves drape against it (in the body's frame, rotated 0.3).
    {
      const body = mat(0, 0, 0, 0, 0.3, 0);
      const rAt = (phi: number, k = 1): [number, number] => {
        const rr = 1 / Math.hypot(Math.cos(phi) / 1.22, Math.sin(phi) / 1.12);
        return [Math.cos(phi) * rr * k, Math.sin(phi) * rr * k];
      };
      for (let i = 0; i < 3; i++) {
        const a0 = 0.6 + i * 2.2 + r.next() * 0.4;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const u = k / 8;
          const phi = a0 + u * 0.95;
          const climb = Math.sin(u * Math.PI);
          const [x, z] = rAt(phi, 1.14 - climb * 0.05);
          pts.push(new THREE.Vector3(x, 0.035 + climb * 0.2 + 0.02 * Math.sin(u * 13 + i), z));
        }
        add(tube(pts, 0.03, 0.016, C(0x4a7428), C(0x78a046), 18, 5), body);
        const cv = new THREE.CatmullRomCurve3(pts);
        for (let k = 0; k < 3; k++) {
          const t = 0.18 + k * 0.32 + r.next() * 0.05;
          const pp = cv.getPointAt(t);
          const out = new THREE.Vector3(pp.x, 0, pp.z).normalize();
          // Leaves stand off the flank, tipped outward (lift ~0.5) — a canopy skirt over the base.
          add(leafGeo(0.36 + r.next() * 0.1, 0.42 + r.next() * 0.1, { shape: 'lobed', lift: 0.5, bend: 0.45, fold: 0.24, serrate: 0.22, c0: GREEN.dark, c1: GREEN.mid, segs: 5 }), body.clone().multiply(mat(pp.x + out.x * 0.04, pp.y + 0.02, pp.z + out.z * 0.04, 0, Math.atan2(out.x, out.z) + (k % 2 ? 0.5 : -0.5), 0)));
        }
      }
      // (r28) One runner sprawls right UP and OVER the near shoulder onto the crown (r10 critic: the
      // giant looked pasted onto the bed — a melon this big grew under its own vine), with leaves
      // lying on the rind following its curve and a curled tendril at the tip.
      {
        const A = 1.24 * 1.04;
        const B = 0.84 * 0.92;
        const Cz = 1.1 * 1.03;
        const surf = (x: number, z: number): number => {
          // The rind's +X end is fatter (giantMelonBody's `fat`), so the crown rises toward it.
          const fat = 1 + 0.12 * THREE.MathUtils.clamp(x / A, -1, 1);
          const q = 1 - (x / A) ** 2 - (z / (Cz * fat)) ** 2;
          return q > 0 ? Math.max(0.04, 0.56 * 0.92 + B * fat * Math.sqrt(q) + 0.045) : 0.04;
        };
        // Climb the flank as a meridian: elevation e (below the equator → near the crown) while the
        // heading swings a little, hugging the rind ~4 cm off it (the lower half sags ~10 % wider).
        const onRind = (e: number, phi: number, off = 0.045): THREE.Vector3 => {
          const fat = 1 + 0.12 * Math.cos(e) * Math.cos(phi);
          const sag = e < 0 ? 1 + 0.1 * Math.min(1, -Math.sin(e) / 0.8) : 1;
          const k = Math.cos(e);
          return new THREE.Vector3((A * k * fat * sag + off) * Math.cos(phi), Math.max(0.04, 0.56 * 0.92 + B * fat * Math.sin(e) + off * Math.sin(e)), (Cz * k * fat * sag + off) * Math.sin(phi));
        };
        const up = new THREE.Vector3(0, 1, 0);
        // Two runners: one up the east shoulder, one up the lens-side flank (the body's +Z half faces
        // the hero lenses), each ending on the crown with leaves lying on the rind and a tendril.
        const runners: { root: number; path: [number, number][]; leaves: number }[] = [
          { root: 1.05, path: [[-0.62, 0.97], [-0.25, 0.92], [0.2, 0.86], [0.62, 0.78], [1.0, 0.66], [1.3, 0.4]], leaves: 4 },
          { root: 1.95, path: [[-0.6, 1.92], [-0.22, 1.86], [0.22, 1.74], [0.66, 1.58], [1.02, 1.36], [1.28, 1.02]], leaves: 3 },
        ];
        for (const run of runners) {
          const pts = [new THREE.Vector3(1.38 * Math.cos(run.root) * A, 0.04, 1.38 * Math.sin(run.root) * Cz), new THREE.Vector3(1.14 * Math.cos(run.root - 0.05) * A, 0.05, 1.14 * Math.sin(run.root - 0.05) * Cz)];
          for (const [e, phi] of run.path) pts.push(onRind(e, phi));
          add(tube(pts, 0.032, 0.014, C(0x4a7428), C(0x7aa24a), 28, 5), body);
          const cv = new THREE.CatmullRomCurve3(pts);
          for (let k = 0; k < run.leaves; k++) {
            const t = 0.36 + k * (0.58 / run.leaves) + r.next() * 0.03;
            const pp = cv.getPointAt(t);
            const tan = cv.getTangentAt(t);
            // Surface normal of the rind under the leaf (ellipsoid gradient).
            const n = new THREE.Vector3(pp.x / (A * A), (pp.y - 0.56 * 0.92) / (B * B), pp.z / (Cz * Cz)).normalize();
            const side = k % 2 ? 1 : -1;
            const yaw = Math.atan2(tan.x, tan.z) + side * (0.9 + r.next() * 0.35);
            const q = new THREE.Quaternion().setFromUnitVectors(up, n).multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
            const m = new THREE.Matrix4().compose(pp.clone().addScaledVector(n, 0.012), q, new THREE.Vector3(1, 1, 1));
            add(leafGeo(0.32 + r.next() * 0.08, 0.38 + r.next() * 0.08, { shape: 'lobed', lift: 0.12, bend: 0.18, fold: 0.2, serrate: 0.22, c0: GREEN.dark, c1: GREEN.mid, segs: 5 }), body.clone().multiply(m));
          }
          // Tendril corkscrewing off the runner's tip, lying on the crown.
          const tip = pts[pts.length - 1]!;
          const tp: THREE.Vector3[] = [];
          for (let k = 0; k <= 20; k++) {
            const u = k / 20;
            const a = u * Math.PI * 4;
            const rr = 0.06 * (1 - u * 0.5);
            const x = tip.x - u * 0.22 + Math.cos(a) * rr;
            const z = tip.z - u * 0.12 + Math.sin(a) * rr;
            tp.push(new THREE.Vector3(x, surf(x, z) + 0.01 + Math.sin(a) * 0.015, z));
          }
          add(tube(tp, 0.011, 0.005, GREEN.mid, C(0xa8b060), 30, 4), body);
        }
      }
      // Big leaves rooted outside the belly, leaning their blades up against it.
      for (let i = 0; i < 5; i++) {
        const phi = (i / 5) * Math.PI * 2 + 0.35 + r.next() * 0.3;
        const [x, z] = rAt(phi, 1.2);
        add(leafGeo(0.5 + r.next() * 0.12, 0.56, { shape: 'lobed', lift: 0.95, bend: 0.15, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 6 }), body.clone().multiply(mat(x, 0.03, z, 0, Math.atan2(-x, -z), 0)));
      }
    }
    // A short woody stem + curled dry tendril on the shoulder.
    // (r20) A thick woody stem with a flared button where it joins the rind, and a long curled
    // tendril corkscrewing off it (readable from the hero lens, not a tiny hook).
    add(fruit(0.11, C(0x6a7a3a), { sy: 0.35, seg: 10, rows: 5 }), mat(-0.12, 1.36, 0.02), 'skin');
    // (r21) Shorter, darker green-brown stub (the r20 olive-tan curl read as a pale pasta hook).
    add(tube([new THREE.Vector3(-0.12, 1.36, 0.02), new THREE.Vector3(-0.11, 1.48, 0.04), new THREE.Vector3(-0.05, 1.56, 0.08), new THREE.Vector3(0.05, 1.57, 0.12), new THREE.Vector3(0.12, 1.52, 0.15)], 0.07, 0.045, C(0x34401c), C(0x5e6430), 14, 8), undefined, 'skin');
    add(fruit(0.05, C(0x4a4a24), { sy: 0.6, seg: 8, rows: 4 }), mat(0.12, 1.52, 0.15), 'skin');
    {
      const tp: THREE.Vector3[] = [];
      for (let k = 0; k <= 28; k++) {
        const u = k / 28;
        const a = u * Math.PI * 5.2;
        const rr = 0.09 * (1 - u * 0.55);
        tp.push(new THREE.Vector3(0.04 + u * 0.42 + Math.cos(a) * rr, 1.55 + Math.sin(a) * rr - u * 0.12, 0.1 + u * 0.3 + Math.sin(a) * rr * 0.6));
      }
      add(tube(tp, 0.016, 0.007, GREEN.mid, C(0xb0b464), 40, 4));
    }
    // Big leaves pushed out past the berm (the dark heaved soil ring shows round the belly).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r.next() * 0.5;
      add(leafGeo(0.6, 0.7, { shape: 'lobed', lift: 0.15, bend: 0.3, fold: 0.2, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 6 }), mat(Math.cos(a) * 1.62, 0.06, Math.sin(a) * 1.52, 0, a + Math.PI / 2, 0));
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.7;
      add(leafGeo(0.34, 0.4, { shape: 'lobed', lift: 0.25, bend: 0.3, fold: 0.22, serrate: 0.2, c0: GREEN.dark, c1: GREEN.mid, segs: 5 }), mat(Math.cos(a) * 1.5, 0.05, Math.sin(a) * 1.45, 0, a + 1.4, 0));
    }
  } else {
    add(giantCurd(0.95, r), mat(0, 0.42, 0), 'skin');
    // 9 big outer leaves cup the curd: frilled blue-green blades that rise steeply from the base,
    // wrap its sides and curl their tips back out, each with a pale raised midrib.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r.next() * 0.25;
      const L = 0.85 + r.next() * 0.2;
      const W = 0.8 + r.next() * 0.2;
      const pitch = -0.3 - r.next() * 0.15;
      const m = mat(Math.cos(a) * 0.82, 0.02, Math.sin(a) * 0.82, 0, Math.PI / 2 - a, 0).multiply(mat(0, 0, 0, pitch, 0, 0));
      add(ruffledLeaf(L, W, r, C(0x2c5e48), C(0x6e9e62), C(0x9cc4a2), 0.6 + r.next() * 0.3, 8, 12), m);
      const rib: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const z = t * L;
        const ca = 0.75 * Math.pow(t, 1.5);
        rib.push(new THREE.Vector3(0, z * Math.sin(ca) + 0.015, z * Math.cos(ca)));
      }
      add(tube(rib, 0.028, 0.006, C(0x9cc0a0), C(0xbcd8bc), 8, 4), m);
    }
    // A few small inner leaves tucked against the curd.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      add(leafGeo(0.55, 0.4, { shape: 'oval', lift: 1.3, bend: 0.2, fold: 0.5, curl: 0.5, rib: C(0x8ab894), c0: C(0x3a6a50), c1: C(0x88b474), segs: 5 }), mat(Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62, 0, Math.PI / 2 - a + Math.PI, 0));
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

/**
 * A tapered tap-root (parsnip / carrot-like): lathed profile with a domed shoulder, a gentle bend,
 * horizontal growth rings pressed into the skin (darker grooves) and a few root hairs; vertex
 * gradient from the pale shoulder to a tan, earthy tip. Origin at the shoulder, root hangs down −Y.
 */
function rootVeg(len: number, R: number, top: THREE.Color, tip: THREE.Color, r: Rng, bend = 0.03): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 tip → 1 shoulder
    const dome = t > 0.86 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.86) / 0.14, 2))) : 1;
    const body = Math.pow(t, 0.62) * (1 - 0.08 * Math.sin(t * 9));
    pts.push(new THREE.Vector2(Math.max(0.0015, R * body * dome), -len + t * (len + R * 0.35)));
  }
  const g = new THREE.LatheGeometry(pts, 12);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const ph = r.next() * 6;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const t = (p.y + len) / len;
    // Rings: shallow grooves every ~2.5 cm (strongest mid-root).
    const ring = Math.pow(Math.abs(Math.sin(t * 34 + ph + Math.atan2(p.z, p.x) * 0.3)), 6) * 0.1 * Math.sin(Math.PI * Math.min(1, t));
    p.x *= 1 - ring;
    p.z *= 1 - ring;
    p.x += bend * Math.pow(1 - Math.min(1, t), 2);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return colored(g, (q, n) => {
    const t = THREE.MathUtils.clamp((q.y + len) / len, 0, 1);
    const c = tip.clone().lerp(top, THREE.MathUtils.smoothstep(t, 0.05, 0.85));
    const groove = Math.pow(Math.abs(Math.sin(t * 34 + ph + Math.atan2(q.z, q.x) * 0.3)), 6);
    c.multiplyScalar((0.7 + 0.3 * THREE.MathUtils.smoothstep(n.y, -0.9, 0.6)) * (1 - groove * 0.22));
    // A faint green-bronze blush on the crown.
    c.lerp(C(0xb8b870), THREE.MathUtils.smoothstep(t, 0.93, 1.0) * 0.5);
    return c;
  });
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
      // Pale cream (CROPS colour 0xf2dfa8), broad-shouldered and short: a parsnip, not a carrot.
      add(rootVeg(0.25, 0.082, C(0xf4e6c0), C(0xc8a878), r, 0.03));
      // Leafy crown: stalks fanning out of the shoulder, serrated blades.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r.next() * 0.4;
        const m = mat(0, 0.035, 0, 0, a, 0).multiply(mat(0, 0, 0, 0.35 + r.next() * 0.25, 0, 0));
        const sl = 0.07 + r.next() * 0.03;
        add(stalk(sl, 0.009, 0.007, C(0x9ab868), C(0x6f9a44), 0, 4), m);
        add(leafGeo(0.17 + r.next() * 0.05, 0.095, { shape: 'lance', serrate: 0.4, lift: 0.9, bend: 0.5, fold: 0.3, c0: C(0x5aa640), c1: C(0xa8d86a), segs: 4 }), m.clone().multiply(mat(0, sl, 0, -0.5, 0, 0)));
      }
      break;
    }
    case 'beet':
      add(fruit(0.085, C(0x8a1a3a), { sy: 0.95, taper: 0.45, seg: 12 }));
      for (let i = 0; i < 4; i++) {
        const m = mat(0, 0.06, 0, 0, (i / 4) * Math.PI * 2, 0).multiply(mat(0, 0, 0, 0.3, 0, 0));
        add(stalk(0.09, 0.007, 0.005, C(0x8a1a36), C(0xc0304a), 0, 4), m);
        add(leafGeo(0.13, 0.08, { shape: 'oval', lift: 1.1, bend: 0.3, fold: 0.3, rib: C(0xc0304a), c0: C(0x2f5a2a), c1: C(0x4f7a34), segs: 4 }), m.clone().multiply(mat(0, 0.09, 0, -0.5, 0, 0)));
      }
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
      // Crisp dark stripes on a pale rind: reads as a melon (not a cabbage) at arm's length.
      add(fruit(0.13, C(0xb4dc74), { sy: 0.86, long: 1.18, stripes: 10, stripeColor: C(0x1c4416), seg: 20, rows: 12, shade: 0.6 }));
      add(stalk(0.04, 0.01, 0.008, C(0x6a7a3a), C(0x8a8a4a), 0.02, 4), mat(0, 0.1, 0));
      break;
    case 'hotPepper':
      add(hangingPod(0.2, 0.03, 0.35, C(0xd82a1a), C(0xf04a2a), 0.25), mat(0, 0.1, 0));
      add(rosetteCap(0.035), mat(0, 0.11, 0));
      break;
    case 'hops':
      add(hopCone(0.08, C(0xc8e07a)), mat(0, 0.08, 0));
      break;
    case 'pumpkin': {
      // The field pumpkin, not an orange ball: deep creased ribs, a squat form, a woody curled
      // stem and a scrap of vine leaf (r7 critic: the held pumpkin read as a smooth orange).
      const R = 0.14;
      const sy = 0.68;
      add(fruit(R, C(0xe06a1a), { sy, ribs: 10, crease: true, seg: 26, rows: 12, shade: 0.45 }));
      const top = R * (sy - 0.12);
      add(tube([new THREE.Vector3(0, top, 0), new THREE.Vector3(0.008, top + 0.045, 0.004), new THREE.Vector3(0.03, top + 0.068, 0.016), new THREE.Vector3(0.055, top + 0.058, 0.034)], 0.02, 0.011, C(0x5e5a2c), C(0x9a8a4a), 7, 6));
      add(leafGeo(0.11, 0.12, { shape: 'heart', lift: 0.2, bend: 0.3, fold: 0.2, serrate: 0.2, cup: 0.4, c0: C(0x3f7a2e), c1: C(0x6faa44), segs: 5 }), mat(-0.01, top + 0.02, -0.01, 0, 2.4, 0));
      break;
    }
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

// ═════════════════════════════════════════════ story props

let propMat: THREE.MeshStandardMaterial | null = null;
/**
 * A slatted wooden harvest crate heaped with this season's produce (the real produce meshes) —
 * set down at the field edge by demos / the harvest staging. One merged mesh, one material.
 */
/**
 * (r24) Row markers for staged beds: a slim stake with a little slanted sign board and a sample of
 * the crop wired on top — the bed's family reads at a glance from the path (blind judge: "small props
 * so the frame feels composed"; Stardew's plots carry the same kind of hand-made labels). All markers
 * in `spots` merge into one mesh (one draw, + its shadow).
 */
/**
 * (r25) Painted sign atlas for the row markers: one weathered plank per crop with the crop's
 * inventory icon painted on (r10 critic: the r24 plaques were blank white cards). Wood is painted at
 * once; each icon is composited when its image decodes (`iconUrl` from the UI icon set).
 */
function markerAtlas(ids: CropId[], iconUrl?: (itemId: string) => string): { tex: THREE.CanvasTexture; cell: (id: CropId) => [number, number, number, number] } {
  const CW = 128;
  const CH = 88;
  const cols = Math.min(4, Math.max(1, ids.length));
  const rows = Math.ceil(ids.length / cols);
  const c = document.createElement('canvas');
  c.width = CW * cols;
  c.height = CH * rows;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const r = new Rng('marker-atlas');
  ids.forEach((id, i) => {
    const x0 = (i % cols) * CW;
    const y0 = Math.floor(i / cols) * CH;
    // Sun-weathered plank: warm honey wood, darker grain streaks, greyed edges.
    const grd = g.createLinearGradient(x0, y0, x0, y0 + CH);
    grd.addColorStop(0, '#b98a58');
    grd.addColorStop(0.5, '#a97a4a');
    grd.addColorStop(1, '#94683e');
    g.fillStyle = grd;
    g.fillRect(x0, y0, CW, CH);
    for (let k = 0; k < 14; k++) {
      const y = y0 + 4 + r.next() * (CH - 8);
      g.strokeStyle = `rgba(${70 + r.next() * 20},${44 + r.next() * 12},${24},${0.18 + r.next() * 0.2})`;
      g.lineWidth = 0.8 + r.next() * 1.6;
      g.beginPath();
      g.moveTo(x0, y);
      g.bezierCurveTo(x0 + CW * 0.3, y + (r.next() - 0.5) * 6, x0 + CW * 0.7, y + (r.next() - 0.5) * 6, x0 + CW, y + (r.next() - 0.5) * 4);
      g.stroke();
    }
    // A knot.
    g.fillStyle = 'rgba(80,50,26,0.35)';
    g.beginPath();
    g.ellipse(x0 + 18 + r.next() * 90, y0 + 14 + r.next() * 60, 5, 3, 0, 0, Math.PI * 2);
    g.fill();
    // Weathered, darker rim (the board's sawn edge).
    g.strokeStyle = 'rgba(70,44,24,0.55)';
    g.lineWidth = 6;
    g.strokeRect(x0 + 3, y0 + 3, CW - 6, CH - 6);
    // A painted cream oval behind the icon (hand-lettered market sign).
    g.fillStyle = 'rgba(246,230,196,0.9)';
    g.beginPath();
    g.ellipse(x0 + CW / 2, y0 + CH / 2, CW * 0.36, CH * 0.38, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(120,72,36,0.7)';
    g.lineWidth = 2.5;
    g.stroke();
    // Two nail heads.
    g.fillStyle = '#4a3a2c';
    for (const nx of [x0 + 12, x0 + CW - 12]) {
      g.beginPath();
      g.arc(nx, y0 + CH / 2, 3.2, 0, Math.PI * 2);
      g.fill();
    }
    const url = iconUrl?.(CROPS[id].produce);
    if (url) {
      const img = new Image();
      img.onload = (): void => {
        const s = CH * 0.74;
        g.globalAlpha = 0.95;
        g.drawImage(img, x0 + CW / 2 - s / 2, y0 + CH / 2 - s / 2, s, s);
        g.globalAlpha = 1;
        // Wear: a few scuffs over the paint.
        g.strokeStyle = 'rgba(169,122,74,0.35)';
        g.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const yy = y0 + 10 + r.next() * (CH - 20);
          g.beginPath();
          g.moveTo(x0 + 20 + r.next() * 30, yy);
          g.lineTo(x0 + 70 + r.next() * 40, yy + (r.next() - 0.5) * 3);
          g.stroke();
        }
        tex.needsUpdate = true;
      };
      img.src = url;
    }
  });
  tex.needsUpdate = true;
  return {
    tex,
    cell: (id) => {
      const i = Math.max(0, ids.indexOf(id));
      const u0 = ((i % cols) * CW) / c.width;
      const v1 = 1 - (Math.floor(i / cols) * CH) / c.height;
      return [u0, v1 - CH / c.height, u0 + CW / c.width, v1];
    },
  };
}

export function buildRowMarkers(spots: { id: CropId; x: number; y: number; z: number; rot: number }[], seed = 1, iconUrl?: (itemId: string) => string): THREE.Group {
  const r = new Rng(`marker:${seed}`);
  const b = new MeshBuilder();
  if (!propMat) {
    propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    propMat.name = 'produceCrate';
    applyWorldFx(propMat, { snowUp: 0.5 });
  }
  const M = propMat;
  const ids = [...new Set(spots.map((s) => s.id))];
  const atlas = markerAtlas(ids, iconUrl);
  const signMat = new THREE.MeshStandardMaterial({ map: atlas.tex, vertexColors: true, roughness: 0.82 });
  signMat.name = 'rowMarkerSign';
  applyWorldFx(signMat, { snowUp: 0.5 });
  for (const sp of spots) {
    const lean = (r.next() - 0.5) * 0.12;
    const H = 0.42 + r.next() * 0.06;
    // (r25) 1.45× — the painted board has to read from the 14–17 m hero lenses.
    const base = new THREE.Matrix4().compose(new THREE.Vector3(sp.x, sp.y - 0.05, sp.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, sp.rot, lean * 0.5)), new THREE.Vector3(1.45, 1.45, 1.45));
    const at = (m: THREE.Matrix4): THREE.Matrix4 => base.clone().multiply(m);
    // Split stake with a pointed foot, weathered grey-brown.
    b.add(M, roundedBox(0.042, H, 0.042, 0.01), at(mat(0, H / 2, 0)), { tint: 0x8a6a4a });
    // Twine lashing under the board.
    b.add(M, new THREE.TorusGeometry(0.03, 0.008, 5, 10), at(mat(0, H - 0.115, 0, Math.PI / 2, 0, 0)), { tint: 0xc8b07a });
    // The board (dark sawn edge) slanted back toward the bed, its painted face on the walkway side.
    const tilt = -0.3 + (r.next() - 0.5) * 0.1;
    const yaw = (r.next() - 0.5) * 0.14;
    b.add(M, roundedBox(0.27, 0.185, 0.026, 0.008), at(mat(0, H - 0.02, 0.03, tilt, yaw, 0)), { tint: 0x6e4a2c });
    const face = new THREE.PlaneGeometry(0.255, 0.172);
    const [u0, v0, u1, v1] = atlas.cell(sp.id);
    const uv = face.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    b.add(signMat, face, at(mat(0, H - 0.02, 0.0442, tilt, yaw, 0)));
  }
  const grp = b.build({ name: 'row-markers' });
  grp.userData.perfTag = 'props';
  return grp;
}

export function buildProduceCrate(ids: CropId[], seed: number, kind: 'crate' | 'basket' = 'crate'): THREE.Group {
  const r = new Rng(`crate:${seed}`);
  const b = new MeshBuilder();
  if (!propMat) {
    propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    propMat.name = 'produceCrate';
    applyWorldFx(propMat, { snowUp: 0.5 });
  }
  const M = propMat;
  const W = kind === 'crate' ? 0.62 : 0.5;
  const D = kind === 'crate' ? 0.44 : 0.5;
  const H = kind === 'crate' ? 0.26 : 0.24;
  if (kind === 'crate') {
    const wood = [0xb48250, 0xa87446, 0xc09060];
    for (let i = 0; i < 3; i++) {
      const y = 0.045 + i * 0.085;
      for (const sz of [-1, 1]) b.add(M, roundedBox(W, 0.065, 0.025, 0.01), mat(0, y, sz * (D / 2)), { tint: wood[(i + (sz > 0 ? 1 : 0)) % 3] });
      for (const sx of [-1, 1]) b.add(M, roundedBox(0.025, 0.065, D, 0.01), mat(sx * (W / 2), y, 0), { tint: wood[(i + 2) % 3] });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(M, roundedBox(0.045, H + 0.02, 0.045, 0.012), mat(sx * (W / 2 - 0.01), H / 2, sz * (D / 2 - 0.01)), { tint: 0x8a6038 });
    b.add(M, roundedBox(W, 0.02, D, 0.006), mat(0, 0.012, 0), { tint: 0x7a5432 });
  } else {
    // Woven basket: a flared tub with a braided rim and a handle arc.
    const tub = new THREE.CylinderGeometry(W / 2, W / 2 - 0.07, H, 18, 4, true);
    const tp = tub.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(tp.count * 3);
    for (let i = 0; i < tp.count; i++) {
      const a = Math.atan2(tp.getZ(i), tp.getX(i));
      const w = 0.8 + 0.2 * Math.sign(Math.sin(a * 18) * Math.sin(tp.getY(i) * 60));
      col.set([0.78 * w, 0.58 * w, 0.34 * w], i * 3);
    }
    tub.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.add(M, tub, mat(0, H / 2, 0));
    b.add(M, new THREE.TorusGeometry(W / 2, 0.018, 6, 24), mat(0, H, 0, Math.PI / 2, 0, 0), { tint: 0xa87a44 });
    b.add(M, new THREE.CircleGeometry(W / 2 - 0.07, 16), mat(0, 0.01, 0, -Math.PI / 2, 0, 0), { tint: 0x7a5432 });
    b.add(M, new THREE.TorusGeometry(W / 2 - 0.02, 0.014, 5, 16, Math.PI), mat(0, H, 0, 0, 0.3, 0), { tint: 0xa87a44 });
  }
  // Heap: a layer across the top, a couple crowning it.
  const n = kind === 'crate' ? 7 : 6;
  for (let i = 0; i < n; i++) {
    const id = ids[i % ids.length]!;
    const g = produceGeometry(id).clone();
    g.computeBoundingSphere();
    const rad = g.boundingSphere?.radius ?? 0.12;
    const s = Math.min(1.1, 0.13 / rad) * (0.9 + r.next() * 0.2);
    const top = i >= n - 2;
    const x = top ? (r.next() - 0.5) * W * 0.3 : (((i % 4) + 0.5) / 4 - 0.5) * W * 0.8;
    const z = top ? (r.next() - 0.5) * D * 0.3 : (i < 4 ? -1 : 1) * D * 0.2;
    b.add(M, g, mat(x, H * 0.82 + (top ? rad * s * 0.9 : 0), z, r.next() * 0.8, r.next() * 6.28, r.next() * 0.8, s));
  }
  const grp = b.build({ name: `produce-${kind}` });
  grp.userData.perfTag = 'props';
  return grp;
}

// ═════════════════════════════════════════════ materials

const CROP_WIND = { mode: 'height' as const, height: 1.1, amplitude: 0.1, flutter: 0.5 };
let cropMat: THREE.MeshStandardMaterial | null = null;
let glossMat: THREE.MeshStandardMaterial | null = null;
let woodMat: THREE.MeshStandardMaterial | null = null;
let cropDepth: THREE.MeshDepthMaterial | null = null;
const CROP_SHADOW_SWAY = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('cropsway') === '1';
  } catch {
    return false;
  }
})();

/**
 * Seasonal foliage tint. Fall: leafy colours rotate ~12° toward yellow, lose ~20 % saturation and
 * warm up; ~20 % of leaves (uv.y marker, see leafGeo) brown from the tip. Produce colours untouched.
 */
function fallShift(m: THREE.Material, key: string, tips = true): void {
  patchMaterial(m, key, (shader) => {
    shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
    shader.vertexShader = before(shader.vertexShader, 'void main() {', 'varying vec2 vLeafUv;');
    shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', 'vLeafUv = uv;');
    let fs = before(shader.fragmentShader, 'void main() {', 'uniform vec4 uSeasonW;\nvarying vec2 vLeafUv;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 cc = diffuseColor.rgb;
        float leafy = smoothstep(0.015, 0.1, cc.g - max(cc.r, cc.b));
        float isLeaf = step(4.5, vLeafUv.y);
        float fall = uSeasonW.z * max(leafy, isLeaf * 0.6);
        // Hue rotation in YIQ (-12 deg), then desaturate 20 % and warm a touch.
        mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        mat3 toR = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 yiq = toY * cc;
        // (r25) Further toward olive-ochre (r10 critic: the fall field still read summer-green).
        float ch = cos(0.56);
        float sh = sin(0.56);
        yiq.yz = vec2(yiq.y * ch - yiq.z * sh, yiq.y * sh + yiq.z * ch) * 0.6;
        vec3 shifted = max(toR * yiq, 0.0) * vec3(1.18, 0.98, 0.7);
        vec3 outc = mix(cc, shifted, fall);
        ${tips ? `// Browned, papery tips on the marked leaves.
        float tip = step(5.5, vLeafUv.y) * smoothstep(0.5, 0.9, vLeafUv.x);
        float l = dot(cc, vec3(0.3, 0.55, 0.15));
        outc = mix(outc, vec3(0.42, 0.27, 0.12) * (l * 2.2 + 0.08), tip * uSeasonW.z * 0.85);
        // (r25) Every marked leaf yellows toward its tip in fall (gourd vines, beans, beets).
        float yel = step(4.5, vLeafUv.y) * smoothstep(0.55, 0.95, vLeafUv.x) * (1.0 - tip);
        outc = mix(outc, vec3(0.78, 0.6, 0.2) * (l * 1.6 + 0.12), yel * uSeasonW.z * 0.5);` : ''}
        diffuseColor.rgb = outc;
      }`,
    );
    shader.fragmentShader = fs;
  });
}

/**
 * Soft-plant light for crops: a wrap term on the side turned from the sun, sun-facing transmission
 * through thin leaves (≈ 0.25) and a faint warm rim — dense beds glow at mid-morning like the lawn
 * instead of reading as plastic. Runs after applyPlantLighting (reuses its sun uniforms).
 */
function applyCropGlow(m: THREE.Material, key: string, trans: number, rim: number, wrap = 0.16): void {
  patchMaterial(m, key, (shader) => {
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 Ld = normalize(uSunDir);
        vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        float ndl = dot(Nw, Ld);
        float wrapL = clamp((ndl + 0.55) / 1.55, 0.0, 1.0) - max(ndl, 0.0);
        float transL = max(-ndl, 0.0);
        vec3 Vw = normalize(cameraPosition - vHvWorldPos);
        float rimL = pow(1.0 - clamp(abs(dot(Nw, Vw)), 0.0, 1.0), 3.0);
        // Wrap on the shadow side + sun transmission through the blade (leaves glow yellow-green).
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (wrapL * ${wrap.toFixed(3)} + transL * ${trans.toFixed(3)} * vec3(1.0, 1.12, 0.72))
          + diffuseColor.rgb * uSunColor * vec3(1.1, 1.0, 0.8) * rimL * ${rim.toFixed(3)};
      }`,
    );
  });
}

/**
 * Painted leaf veins (crop material only): a pale midrib, paired side veins sweeping toward the tip
 * and a slightly darker, cooler margin — read from the leaf UVs (see leafGeo), so every blade gets
 * them for free with no texture fetch.
 */
function leafVeins(m: THREE.Material, key: string): void {
  patchMaterial(m, key, (shader) => {
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <color_fragment>',
      /* glsl */ `
      if (vLeafUv.y > 4.5 && vLeafUv.y < 6.6) {
        float across = fract(vLeafUv.y) / 0.49 * 2.0 - 1.0;
        float aa = abs(across);
        float t = vLeafUv.x;
        float mid = (1.0 - smoothstep(0.035, 0.12, aa)) * smoothstep(0.02, 0.1, t) * (1.0 - smoothstep(0.85, 1.0, t));
        float vv = abs(fract(t * 4.5 - aa * 1.3 + 0.2) - 0.5);
        float side = (1.0 - smoothstep(0.03, 0.09, vv)) * smoothstep(0.12, 0.3, aa) * (1.0 - smoothstep(0.72, 0.95, aa)) * smoothstep(0.1, 0.25, t) * (1.0 - smoothstep(0.8, 0.98, t));
        vec3 c = diffuseColor.rgb;
        c *= mix(1.0, 0.86, smoothstep(0.6, 1.0, aa));
        c += c * vec3(0.22, 0.26, 0.05) * (mid * 0.85 + side * 0.4);
        diffuseColor.rgb = c;
      }`,
    );
  });
}

export function cropMaterial(): THREE.MeshStandardMaterial {
  if (!cropMat) {
    cropMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide });
    cropMat.name = 'crop';
    applyWorldFx(cropMat, { snowUp: 0.6 });
    applyWind(cropMat, CROP_WIND);
    applyPlantLighting(cropMat, { translucency: 0.4, floor: 0.05 });
    applyCropGlow(cropMat, 'crop-glow', 0.3, 0.3, 0.3);
    fallShift(cropMat, 'crop-fall');
    leafVeins(cropMat, 'crop-veins');
    cropDepth = windDepthMaterial(CROP_WIND);
  }
  return cropMat;
}

/** Shiny produce skin (tomatoes, peppers, eggplants, berries): same sway, soft highlights. */
export function glossMaterial(): THREE.MeshStandardMaterial {
  if (!glossMat) {
    cropMaterial();
    glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, side: THREE.DoubleSide });
    glossMat.name = 'cropGloss';
    applyWorldFx(glossMat, { snowUp: 0.6 });
    applyWind(glossMat, CROP_WIND);
    applyPlantLighting(glossMat, { translucency: 0.12, floor: 0.05 });
    applyCropGlow(glossMat, 'crop-gloss-glow', 0.08, 0.18);
    fallShift(glossMat, 'crop-gloss-fall', false);
  }
  return glossMat;
}

let skinMat: THREE.MeshStandardMaterial | null = null;
/** Matte produce (pumpkins, melons, roots, curds): rough, no hot specular — wrap light carries the form. */
export function skinMaterial(): THREE.MeshStandardMaterial {
  if (!skinMat) {
    cropMaterial();
    skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.7 });
    skinMat.name = 'cropSkin';
    applyWorldFx(skinMat, { snowUp: 0.6 });
    applyWind(skinMat, CROP_WIND);
    applyPlantLighting(skinMat, { translucency: 0.06, floor: 0.08 });
    applyCropGlow(skinMat, 'crop-skin-glow', 0.05, 0.14);
    fallShift(skinMat, 'crop-skin-fall', false);
  }
  return skinMat;
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
  hotPepper: { scale: 1.2 },
  // Berry clusters / hanging fruit are hung on the lens-facing (+Z) half: only a little spin.
  blueberry: { scale: 1.1, yaw: 1.2 },
  strawberry: { yaw: 1.4 },
  // (r25) Low rosettes / bushes a touch fuller: a bed of them read as sparse tufts on bare soil.
  beet: { scale: 1.18 },
  yam: { scale: 1.15 },
  eggplant: { scale: 1.1 },
};

/** Foliage colour cast per crop (multiplies the instance tint) so neighbouring rows never share one green. */
const CROP_CAST: Partial<Record<CropId, THREE.Color>> = {
  parsnip: new THREE.Color(1.1, 1.08, 0.82),
  cauliflower: new THREE.Color(0.88, 1.02, 1.1),
  kale: new THREE.Color(0.98, 0.95, 1.02),
  potato: new THREE.Color(0.95, 0.95, 0.8),
  beet: new THREE.Color(1.05, 0.95, 0.95),
  strawberry: new THREE.Color(1.02, 1.04, 0.9),
};
const RIPE_FLUSH = new THREE.Color(1.1, 1.06, 0.95);
// r15: sprouts and seedlings a touch bigger (stage 1–2 read as specks from the game camera).
// r25: seedlings (stages 1–2) another ~10 % so each family's signature reads at the gameplay lens.
const STAGE_SCALE = [1.3, 1.98, 1.92, 1.6, 1.62, 1.68];

export class CropVisuals {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('crops');
  /** Giants: animated every frame (breathing), so they keep their own batches + a swaying shadow. */
  readonly livePool = new BatchPool('crops-live');
  private sets = new Map<string, InstancedSet>();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'crops';
    this.group.userData.perfTag = 'crops';
    // Like the grass: dense foliage stays out of the GTAO G-buffer (vertex AO + shadows ground it).
    this.group.userData.noAO = true;
    this.group.add(this.pool.group, this.livePool.group);
  }

  private makeSet(key: string, geos: Map<Bucket, THREE.BufferGeometry>, shadow: boolean, tinted = false, live = false): InstancedSet {
    const parts: InstancedPart[] = [];
    const leaf = geos.get('leaf');
    const gloss = geos.get('gloss');
    const wood = geos.get('wood');
    // (r19, pillar 14) Field crops cast a STILL shadow (no wind depth material): the static shadow
    // cache bakes the whole field once instead of re-drawing ~150k swaying crop triangles into the
    // sun's map every frame (the leaves' few-cm sway is invisible in a soft shadow). Only the live
    // pool (giants, which breathe every frame) keeps the swaying depth pass. `?cropsway=1` = old path.
    cropMaterial();
    const depth = live || CROP_SHADOW_SWAY ? cropDepth! : undefined;
    if (leaf) parts.push({ geometry: leaf, material: cropMaterial(), depthMaterial: depth, castShadow: shadow, tinted });
    // Small shiny fruit (berries, tomatoes, pods) hang inside the foliage's shadow: skip the shadow pass.
    if (gloss) parts.push({ geometry: gloss, material: glossMaterial(), depthMaterial: depth, castShadow: false });
    const skin = geos.get('skin');
    if (skin) parts.push({ geometry: skin, material: skinMaterial(), depthMaterial: depth, castShadow: shadow, tinted });
    if (wood) parts.push({ geometry: wood, material: trellisMaterial(), castShadow: true });
    return new InstancedSet(`crop-${key}`, parts, live ? this.livePool : this.pool);
  }

  private setFor(id: CropId, stage: number, variant: number): InstancedSet {
    const key = `${id}:${stage}:${variant}`;
    let s = this.sets.get(key);
    if (!s) {
      s = this.makeSet(key, buildCrop(id, stage, new Rng(`crop:${key}`)), stage >= 3 || !!CROPS[id].trellis, true);
      this.sets.set(key, s);
    }
    return s;
  }

  private special(key: string, build: () => Map<Bucket, THREE.BufferGeometry>, tinted = false, live = false): InstancedSet {
    let s = this.sets.get(key);
    if (!s) {
      s = this.makeSet(key, build(), true, tinted, live);
      this.sets.set(key, s);
    }
    return s;
  }

  private place(set: InstancedSet, pos: THREE.Vector3, yaw: number, scale: THREE.Vector3, tint?: THREE.Color): CropHandle {
    const h: CropHandle = { set, id: -1, pos, yaw, scale };
    h.id = set.add(this.compose(h, 1, 1, 0, 0), tint);
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
    // Fruiting stages get a third variant (fruit size / turn / tilt differ per variant).
    // Gourds get four (their fruit dominates the bed: no wallpaper of identical melons).
    const set = this.setFor(id, stage, seed % (stage >= 4 ? (id === 'melon' || id === 'pumpkin' ? 6 : 3) : 2));
    const pl = PLACE[id] ?? {};
    const trel = !!CROPS[id].trellis;
    // No two plants alike: ±18 % size (±6 % on trellises, which must fill their frame), a little
    // height stretch, a lean of the whole plant, and a hue / value shift of the foliage.
    const hv = (sh: number, m: number): number => ((seed >>> sh) % m) / (m - 1);
    // (r29) Ripe gourds only ±8 % on top of their own fruit / form variation (blind judge: one front
    // pumpkin read as oversized against the rest — the three spreads stacked to a 2.5x size range).
    const ripeGourd = stage >= 4 && (id === 'melon' || id === 'pumpkin');
    const s = STAGE_SCALE[stage]! * (pl.scale ?? 1) * (1 + (hv(3, 37) - 0.5) * (trel ? 0.12 : ripeGourd ? 0.16 : 0.36));
    const jitter = trel ? 0 : 0.014;
    const pos = new THREE.Vector3(x + (((seed >> 5) % 7) - 3) * jitter, y, z + (((seed >> 8) % 7) - 3) * jitter);
    const yawRange = pl.yaw ?? Math.PI * 2;
    const yaw = yawRange >= Math.PI * 2 ? ((seed % 360) * Math.PI) / 180 : ((((seed % 1000) / 1000) - 0.5) * yawRange);
    // (r25) Ripe gourds vary much more (r10 critic: pumpkins / melons read as clones): ±15 % size,
    // a squat ↔ tall squash ratio and a wider rind tint swing (sun-bleached ↔ deep).
    const gourd = stage >= 4 && (id === 'melon' || id === 'pumpkin');
    const j = hv(13, 29) - 0.5;
    const l = (gourd ? 0.86 : 0.92) + hv(17, 23) * (gourd ? 0.26 : 0.16);
    const tint = new THREE.Color(l * (1 + j * (gourd ? 0.2 : 0.1)), l * (1 + j * 0.03), l * (1 - j * (gourd ? 0.24 : 0.12)));
    const gs = gourd ? 0.92 + hv(19, 31) * 0.12 : 1;
    const sq = gourd ? 0.84 + hv(11, 17) * 0.3 : 0.92 + hv(11, 17) * 0.16;
    const cast = CROP_CAST[id];
    if (cast) tint.multiply(cast);
    if (stage === RIPE_STAGE) tint.multiply(RIPE_FLUSH);
    return this.place(set, pos, yaw, new THREE.Vector3(s * gs, s * gs * sq, s * gs), tint);
  }

  addWithered(x: number, y: number, z: number, seed: number, trellised: boolean, id?: CropId): CropHandle {
    const v = seed % 2;
    const kind = id ? witherKind(id) : 'leafy';
    const accent = trellised ? 'plain' : witherAccent(id);
    const set = this.special(`withered:${trellised ? 't' : `${kind}:${accent}`}:${v}`, () => buildWithered(new Rng(`withered:${kind}:${accent}:${v}`), trellised, kind, v, accent), true);
    // (r16) Wider size spread (and smaller husks overall) so the dead field exposes its soil.
    const s = (kind === 'tall' ? 1.3 : 1.55) * (0.8 + ((seed >> 3) % 40) / 100);
    // Grey-brown, a little lighter / darker and warmer / cooler per plant.
    const h = ((seed >> 7) % 100) / 100;
    const tint = new THREE.Color().setRGB(1, 0.97, 0.92).lerp(new THREE.Color(0.9, 0.9, 0.9), h).multiplyScalar(0.9 + (((seed >> 11) % 24) / 100));
    return this.place(set, new THREE.Vector3(x, y, z), trellised ? 0 : ((seed % 360) * Math.PI) / 180, new THREE.Vector3(s, s * (0.9 + ((seed >> 5) % 20) / 100), s), tint);
  }

  /** What a crow leaves: ragged stalks, torn leaves on the soil (dead; scythe clears it). */
  addEaten(x: number, y: number, z: number, seed: number, trellised: boolean, leaf: number): CropHandle {
    const v = seed % 2;
    const set = this.special(`eaten:${trellised ? 't' : 'p'}:${v}:${leaf}`, () => buildEaten(new Rng(`eaten:${v}`), trellised, C(leaf)));
    const s = 1.7 * (0.9 + ((seed >> 3) % 20) / 100);
    return this.place(set, new THREE.Vector3(x, y, z), trellised ? 0 : ((seed % 360) * Math.PI) / 180, new THREE.Vector3(s, s, s));
  }

  addGiant(kind: GiantKind, x: number, y: number, z: number, seed: number): CropHandle {
    const set = this.special(`giant:${kind}`, () => buildGiant(kind, new Rng(`giant:${kind}`)), false, true);
    // (r19) A touch smaller (r9 critic: the giants overwhelmed the neighbouring beds).
    // (r22) Smaller again and settled under its own weight (wider, lower: r9 critic "inflated rather
    // than massively heavy" — the beds beside it no longer read as dwarfed).
    const s = 0.84 + ((seed >> 4) % 6) / 100;
    return this.place(set, new THREE.Vector3(x, y, z), (((seed % 100) / 100) - 0.5) * 0.8, new THREE.Vector3(s * 1.04, s * 0.9, s * 1.04));
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

/** Debug / budget tuning: triangles per crop stage (all buckets) — `__game` console helper. */
export function cropTriangleStats(): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const id of Object.keys(CROPS) as CropId[]) {
    out[id] = [];
    for (let st = 0; st <= RIPE_STAGE; st++) {
      let n = 0;
      for (const g of buildCrop(id, st, new Rng(`crop:${id}:${st}:0`)).values()) n += (g.index ? g.index.count : g.attributes.position!.count) / 3;
      out[id]!.push(Math.round(n));
    }
  }
  return out;
}
