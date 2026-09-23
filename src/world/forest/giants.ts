/**
 * Old-growth giants for Cindergrove:
 *  - Elder: a broad-leaved ancient with a fluted, gently buttressed trunk, root tubes diving into the
 *    ground, moss creeping up the roots and limb tops, four great limbs and a clustered canopy: soft
 *    puff volumes (painted 3-band light, per-puff hue / value jitter, back-lit translucency) fringed
 *    with camera-facing leaf-cluster cards so the silhouette breaks up into leaves (bare, snow-dusted
 *    limbs in winter; every tree picks its own autumn hue; spring cards carry petal clusters).
 *  - Fir: a towering evergreen of 6-7 smooth, scalloped, drooping bough tiers with needle-spray cards
 *    hanging off every tier rim, over a flared, mossy bole.
 * A few geometry variants per kind, batched (one multi-draw per material), wind-swayed (shadows too).
 * Canopies and trunks between the lens and the player open a soft round see-through window.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import type { Season } from '../../core/time';
import { MeshBuilder, lumpySphere, sphericalNormals, uvScale } from '../geom';
import { textures } from '../../render/textures';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { InstancedSet, BatchPool, type InstancedPart } from '../props/instanced';
import type { GiantKind } from './layout';
import { CardBuilder, leafClusterTexture, needleSprayTexture, applyBillboard, applyCardMap, applyPaintedLight, applySeeThrough } from './foliage';

const WIND_TRUNK = { mode: 'attribute' as const, amplitude: 0.1, flutter: 0 };
const WIND_LEAF = { mode: 'attribute' as const, amplitude: 0.16, flutter: 0.45 };
const WIND_CARD = { mode: 'attribute' as const, amplitude: 0.16, flutter: 0.8 };

/** Canopy tints per season (each tree picks one; fall mixes the whole autumn range). */
const ELDER_PALETTE: Record<Season, number[]> = {
  spring: [0x86c64e, 0x7dbd4a, 0x94cc58, 0x74b446],
  summer: [0x4f943a, 0x478a35, 0x5a9c3c, 0x3f8232],
  fall: [0xe8892a, 0xd64a28, 0xf0b53a, 0xc9612a, 0xe29c34, 0xb8402a],
  winter: [0xffffff],
};
const FIR_PALETTE: Record<Season, number[]> = {
  spring: [0x5c9c5a, 0x549458],
  summer: [0x4a8a52, 0x44844e],
  fall: [0x528452, 0x4a7c4e],
  winter: [0x4a7a64, 0x44725e],
};
const MOSS: Record<Season, number> = { spring: 0x6f9e2c, summer: 0x5a8f28, fall: 0x8a8a2c, winter: 0x5f6f3a };

const mossColor = new THREE.Color(MOSS.summer);

let barkMat: THREE.MeshStandardMaterial | null = null;
/** Deep-fissured bark with moss on up-facing roots / limbs, the damp north side and the foot of the bole. */
export function giantBarkMaterial(): THREE.MeshStandardMaterial {
  if (barkMat) return barkMat;
  const t = textures.bark();
  barkMat = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 3.2, roughness: 0.96, vertexColors: true, color: 0xc4b2a0 });
  barkMat.name = 'giantBark';
  patchMaterial(barkMat, 'giant-moss', (shader) => {
    shader.uniforms.uMoss = { value: mossColor };
    let vs = shader.vertexShader;
    vs = before(vs, 'void main() {', 'varying float vGLocalY;');
    vs = after(vs, '#include <begin_vertex>', 'vGLocalY = position.y;');
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', 'varying float vGLocalY;\nuniform vec3 uMoss;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 gn = normalize(vHvWorldNormal);
        vec2 mq = vHvWorldPos.xz * 1.7 + vHvWorldPos.y * 0.9;
        float mn = hvNoise(mq) * 0.65 + hvNoise(mq * 3.3 + 4.0) * 0.35;
        // Moss in cushions, not a coat: up-facing limb tops + root crowns, a damp north streak and a
        // ragged collar at the foot. Bark stays visible along every buttress ridge.
        float patchy = smoothstep(0.38, 0.62, mn);
        float up = smoothstep(0.35, 0.85, gn.y + (mn - 0.5) * 0.6) * (0.45 + 0.55 * smoothstep(1.2, 3.5, vGLocalY));
        float foot = smoothstep(1.1, 0.05, vGLocalY + (mn - 0.5) * 1.2);
        float north = smoothstep(0.2, 0.9, -gn.z) * smoothstep(6.0, 1.0, vGLocalY) * 0.55;
        float ridge = smoothstep(0.55, 0.95, hvNoise(vec2(atan(gn.z, gn.x) * 5.0, vGLocalY * 0.4)));
        float m = clamp(max(max(up * patchy, foot * 0.75 * (0.4 + 0.6 * patchy)), north * patchy) * (1.0 - ridge * 0.6), 0.0, 1.0);
        vec3 moss = uMoss * (0.55 + 0.6 * hvNoise(mq * 7.1));
        diffuseColor.rgb = mix(diffuseColor.rgb, moss, m * 0.88 * (1.0 - hvSnowAmt));
      }`,
    );
    shader.fragmentShader = fs;
  });
  applyWorldFx(barkMat, { snowUp: 0.62 });
  applyWind(barkMat, WIND_TRUNK);
  // Trunks stay solid (a dithered trunk reads as a screen door); only the canopy opens up.
  return barkMat;
}

let twigMat: THREE.MeshStandardMaterial | null = null;
/**
 * Winter crown: the fine, recursively forking twig structure of a bare elder (only drawn in winter,
 * when the leaves are down). Snow settles along the upper side of every branch.
 */
export function giantTwigMaterial(): THREE.MeshStandardMaterial {
  if (twigMat) return twigMat;
  const t = textures.bark();
  twigMat = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 1.6, roughness: 0.95, vertexColors: true, color: 0x9a8472 });
  twigMat.name = 'giantTwig';
  applyWorldFx(twigMat, { snowUp: 0.42 });
  applyWind(twigMat, WIND_TRUNK);
  return twigMat;
}

/**
 * Recursive, tapered, curved branching (3 levels, radius x0.65 and length x0.72 per level): each
 * branch is a short bezier bough bending up and out, children fork off its outer half.
 */
function branchTree(b: MeshBuilder, m: THREE.Material, rng: Rng, from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, level: number): void {
  const d = dir.clone().normalize();
  const end = from.clone().addScaledVector(d, len);
  // Branches arc upward towards the light, then droop a touch at the tips.
  const ctrl = from.clone().lerp(end, 0.5).add(new THREE.Vector3((rng.next() - 0.5) * len * 0.35, len * (0.12 + rng.next() * 0.18), (rng.next() - 0.5) * len * 0.35));
  // Lean geometry: the whole winter crown of an elder is ~3k triangles.
  bough(b, m, r, r * 0.62, from, ctrl, end, Math.max(3, 5 - level), level === 2 ? 1 : 2, 1);
  if (level >= 2) return;
  const curve = new THREE.QuadraticBezierCurve3(from, ctrl, end);
  const kids = level === 0 ? 3 : 2 + rng.int(0, 1);
  for (let k = 0; k < kids; k++) {
    const t = 0.45 + (k / kids) * 0.5 + rng.next() * 0.08;
    const p = curve.getPoint(Math.min(0.98, t));
    const tan = curve.getTangent(Math.min(0.98, t));
    const a = rng.next() * Math.PI * 2;
    const side = new THREE.Vector3(Math.cos(a), 0.25 + rng.next() * 0.5, Math.sin(a));
    const nd = tan.clone().multiplyScalar(0.55).add(side.multiplyScalar(0.6)).normalize();
    branchTree(b, m, rng, p, nd, len * (0.62 + rng.next() * 0.2), r * 0.65, level + 1);
  }
}

/** F1 / F2 cellular noise in 3D: direction from the nearest cell centre, border distance, F1. */
const LEAF_CELLS_GLSL = /* glsl */ `
vec3 hvHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
void hvLeafCells(vec3 p, out vec3 dir, out float edge, out float f1, out float rnd) {
  // Domain warp: irregular, organic sprig shapes instead of a honeycomb.
  p += (vec3(hvNoise(p.yz * 0.61), hvNoise(p.zx * 0.61 + 3.1), hvNoise(p.xy * 0.61 + 7.7)) - 0.5) * 1.1;
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec3 r1 = vec3(0.0, -1.0, 0.0);
  vec3 c1 = ip;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + 0.15 + hvHash33(ip + o) * 0.7 - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; r1 = r; c1 = ip + o; }
    else if (d < d2) { d2 = d; }
  }
  f1 = sqrt(d1);
  dir = -r1 / max(f1, 1e-4);
  edge = sqrt(d2) - f1;
  rnd = hvHash33(c1 + 17.31).x;
}
`;

export interface LeafClumpOptions {
  /** Cell frequency per world axis (cells per metre). */
  freq: [number, number, number];
  /** How strongly each clump bends the normal into its own dome (0..1). */
  bend: number;
  /** Darkening in the seams between clumps (0..1). */
  seam: number;
  /** Scalloped-silhouette cut strength (0 = off). */
  cut?: number;
  /** Spring blossom flecks on a share of the clumps (follows the season weights). */
  blossom?: boolean;
}

/**
 * Foliage masses read as many leaf clumps: 3D cellular noise shades each cell as its own little dome
 * (bent normals + soft seams), adds leaf-scale speckle, and near the silhouette cuts away the rim of
 * every clump so outlines are scalloped instead of clay-smooth. Needs applyWorldFx first.
 */
export function applyLeafClumps(m: THREE.Material, o: LeafClumpOptions): void {
  const f = `vec3(${o.freq.map((v) => v.toFixed(3)).join(', ')})`;
  const cut = (o.cut ?? 1).toFixed(3);
  patchMaterial(m, `leaf-clumps:${o.freq.join(',')}:${o.bend}:${o.seam}:${cut}:${o.blossom ? 1 : 0}`, (shader) => {
    shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', LEAF_CELLS_GLSL + (fs.includes('uniform vec4 uSeasonW;') ? '' : 'uniform vec4 uSeasonW;\n'));
    fs = after(fs, 'void main() {', 'vec3 hvLeafDir = vec3(0.0, 1.0, 0.0);\nfloat hvLeafEdge = 1.0;\nfloat hvLeafRnd = 0.5;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        float hvD1;
        hvLeafCells(vHvWorldPos * ${f}, hvLeafDir, hvLeafEdge, hvD1, hvLeafRnd);
        vec3 hvVw = normalize(cameraPosition - vHvWorldPos);
        float hvNdv = abs(dot(normalize(vHvWorldNormal), hvVw));
        float hvSil = (1.0 - smoothstep(0.03, 0.22, hvNdv)) * ${cut};
        float hvJit = hvNoise(vHvWorldPos.xz * 13.0 + vHvWorldPos.y * 7.0);
        // Only cut where a clump rim meets the outline (the mass stays whole, no floating chips).
        if (hvLeafEdge * (1.0 - hvD1 * 0.5) < hvSil * (0.2 + hvJit * 0.18)) discard;
        diffuseColor.rgb *= ${(1 - o.seam).toFixed(3)} + ${o.seam.toFixed(3)} * smoothstep(0.0, 0.22, hvLeafEdge);
        float hvSpk = hvNoise(vHvWorldPos.xz * 17.0 + vHvWorldPos.y * 11.0);
        diffuseColor.rgb *= 0.9 + 0.2 * smoothstep(0.35, 0.8, hvSpk);
        ${o.blossom ? `{
          // Spring: pale blossom flecks crowd the sunny side of a third of the clumps.
          // Round florets at the heart of a share of the clumps (not whole cells: those read as chips).
          float hvB = uSeasonW.x * step(0.62, hvLeafRnd) * smoothstep(0.3, 0.16, hvD1) * smoothstep(-0.3, 0.5, normalize(vHvWorldNormal).y);
          vec3 hvBc = mix(vec3(1.0, 0.55, 0.72), vec3(1.0, 0.84, 0.9), fract(hvLeafRnd * 7.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, hvBc, hvB);
        }` : ''}
      }`,
    );
    fs = after(
      fs,
      '#include <normal_fragment_maps>',
      /* glsl */ `
      {
        vec3 hvNw = normalize(vHvWorldNormal);
        // Bend fades to zero at the seams: no lighting discontinuity (reads as leaves, not tiles).
        vec3 hvBend = (hvLeafDir - hvNw * dot(hvLeafDir, hvNw)) * smoothstep(0.0, 0.3, hvLeafEdge);
        normal = normalize(normal + mat3(viewMatrix) * hvBend * ${o.bend.toFixed(3)});
      }`,
    );
    shader.fragmentShader = fs;
  });
}

const leafMats = new Map<string, THREE.MeshStandardMaterial>();

/** Shared canopy look: soft clump variation, cool occluded leaves, warm crowns, back-lit glow. */
function canopyLook(m: THREE.MeshStandardMaterial, key: string): void {
  patchMaterial(m, `giant-canopy:${key}`, (shader) => {
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    let fs = shader.fragmentShader;
    if (!fs.includes('uniform vec3 uSunDir;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunDir;');
    if (!fs.includes('uniform vec3 uSunColor;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunColor;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 fp = vHvWorldPos * 0.8;
        float clump = hvNoise(fp.xz + fp.y * 0.7) * 0.6 + hvNoise(fp.zy * 1.9 + 3.0) * 0.4;
        diffuseColor.rgb *= 0.9 + 0.18 * smoothstep(0.25, 0.8, clump);
        // Occluded leaves drift cooler (blue-green), sunlit crowns warmer.
        float lumv = dot(vColor.rgb, vec3(0.333));
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.8, 0.94, 1.1), diffuseColor.rgb, smoothstep(0.3, 0.8, lumv));
        float top = smoothstep(0.2, 0.95, normalize(vHvWorldNormal).y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.08, 0.86), top * 0.45);
        // Autumn canopies keep a few green / russet patches.
        float ah = hvNoise(fp.xz * 0.45 + 9.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 1.0, 0.66), smoothstep(0.68, 0.92, ah) * 0.4 * uSeasonW.z);
      }`,
    );
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 Vw = normalize(cameraPosition - vHvWorldPos);
        vec3 Nw = normalize(vHvWorldNormal);
        // Translucency: leaves glow where the sun shines through them towards the lens, and along the rim.
        float back = pow(max(dot(-Vw, normalize(uSunDir)), 0.0), 3.0);
        float rim = pow(1.0 - max(dot(Nw, Vw), 0.0), 3.0) * (0.4 + 0.6 * max(dot(Nw, normalize(uSunDir)), 0.0));
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (back * 0.45 + rim * 0.22) + diffuseColor.rgb * 0.02;
      }`,
    );
    if (!fs.includes('uniform vec4 uSeasonW;')) fs = before(fs, 'void main() {', 'uniform vec4 uSeasonW;');
    shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
    shader.fragmentShader = fs;
  });
}

/** Puff-shell material (the solid heart of each canopy clump / fir tier). */
function canopyMaterial(kind: GiantKind): THREE.MeshStandardMaterial {
  let m = leafMats.get(kind);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true, color: 0xffffff });
  m.name = `giantLeaf-${kind}`;
  applyWorldFx(m, kind === 'fir' ? { snowUp: 0.12 } : { snowUp: 0.6 });
  applyWind(m, WIND_LEAF);
  canopyLook(m, kind);
  applyPaintedLight(m);
  applySeeThrough(m, 5.5, 3);
  leafMats.set(kind, m);
  return m;
}

/** Leaf-cluster (elder) / needle-spray (fir) billboard cards. */
function cardMaterial(kind: GiantKind): THREE.MeshStandardMaterial {
  const key = `card-${kind}`;
  let m = leafMats.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: kind === 'fir' ? needleSprayTexture() : leafClusterTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.88,
    vertexColors: true,
    color: 0xffffff,
  });
  m.name = `giantCard-${kind}`;
  applyWorldFx(m, kind === 'fir' ? { snowUp: 0.05 } : { snowUp: 0.55 });
  applyWind(m, WIND_CARD);
  applyBillboard(m);
  applyCardMap(m, kind === 'elder');
  canopyLook(m, `card-${kind}`);
  applyPaintedLight(m);
  applySeeThrough(m, 5.5, 3);
  leafMats.set(key, m);
  return m;
}

const cardDepth = new Map<GiantKind, THREE.MeshDepthMaterial>();
/** Shadow caster for the cards: same billboard (towards the sun) + sway + alpha cut-out. */
function cardDepthMaterial(kind: GiantKind): THREE.MeshDepthMaterial {
  let m = cardDepth.get(kind);
  if (m) return m;
  m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: kind === 'fir' ? needleSprayTexture() : leafClusterTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  applyWind(m, WIND_CARD);
  applyBillboard(m);
  cardDepth.set(kind, m);
  return m;
}

const _up = new THREE.Vector3(0, 1, 0);

function limb(r0: number, r1: number, a: THREE.Vector3, b: THREE.Vector3, radial = 8, segs = 3): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, segs, true);
  uvScale(g, 1.4, len * 0.5);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Curved limb: several tapered segments along a quadratic bezier (reads as a bough, not a stick). */
function bough(b: MeshBuilder, m: THREE.Material, r0: number, r1: number, a: THREE.Vector3, ctrl: THREE.Vector3, e: THREE.Vector3, radial: number, n = 3, segs = 2): void {
  const curve = new THREE.QuadraticBezierCurve3(a, ctrl, e);
  let prev = a.clone();
  for (let i = 1; i <= n; i++) {
    const p = curve.getPoint(i / n);
    const ra = THREE.MathUtils.lerp(r0, r1, (i - 1) / n);
    const rb = THREE.MathUtils.lerp(r0, r1, i / n);
    // Overlap the joints a little so there are no seams.
    const dir = p.clone().sub(prev).normalize();
    b.add(m, limb(ra, rb, prev.clone().addScaledVector(dir, -ra * 0.4), p, radial, segs));
    prev = p;
  }
}

/** Fluted trunk: lathe with shallow root lobes swelling into the ground (the roots are separate tubes). */
function trunkGeometry(rng: Rng, h: number, r0: number, lobes: number, flare: number, radial = 28, rings = 18): THREE.BufferGeometry {
  const noise = new Noise2D(Math.floor(rng.next() * 1e9));
  const phase = rng.next() * Math.PI * 2;
  const lobeAmp = Array.from({ length: lobes }, () => 0.7 + rng.next() * 0.6);
  const leanX = (rng.next() - 0.5) * 0.9;
  const leanZ = (rng.next() - 0.5) * 0.9;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const y0 = -0.6;
  for (let j = 0; j <= rings; j++) {
    const f = j / rings;
    const y = y0 + Math.pow(f, 1.35) * (h - y0);
    const base = r0 * (1 - 0.4 * THREE.MathUtils.smoothstep(y, 0, h));
    const fl = Math.exp(-Math.max(0, y) / 0.7) * flare;
    const cx = leanX * Math.pow(Math.max(0, y) / h, 1.6);
    const cz = leanZ * Math.pow(Math.max(0, y) / h, 1.6);
    for (let i = 0; i <= radial; i++) {
      const th = (i / radial) * Math.PI * 2;
      let lobe = 0;
      for (let k = 0; k < lobes; k++) {
        const c = Math.cos(th - phase - (k / lobes) * Math.PI * 2);
        lobe += Math.pow(Math.max(0, c), 5) * lobeAmp[k]!;
      }
      const flute = 1 + 0.045 * Math.sin(th * 9 + y * 0.8) * (1 - fl * 0.5);
      const n = 1 + noise.get(Math.cos(th) * 1.3 + y * 0.35, Math.sin(th) * 1.3) * 0.07;
      // Rounded root swell between shallow bays (no flat skirt).
      const r = base * flute * n * (1 + fl * (0.18 + lobe * 0.7));
      pos.push(cx + Math.cos(th) * r, y, cz + Math.sin(th) * r);
      uv.push((i / radial) * 3.5, y * 0.55);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Weld the lathe seam normals (first / last column share positions).
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let j = 0; j <= rings; j++) {
    const a = j * (radial + 1);
    const b = a + radial;
    const nx = nor.getX(a) + nor.getX(b);
    const ny = nor.getY(a) + nor.getY(b);
    const nz = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l);
    nor.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

/** Root tubes: arch out of the trunk foot and dive into the soil (each a tapered, curved limb). */
function roots(b: MeshBuilder, m: THREE.Material, rng: Rng, r0: number, n: number, reach: number, thick: number): void {
  const phase = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
    const len = reach * (0.7 + rng.next() * 0.5);
    const s = new THREE.Vector3(Math.cos(a) * r0 * 0.55, 0.95 + rng.next() * 0.4, Math.sin(a) * r0 * 0.55);
    const bend = a + (rng.next() - 0.5) * 0.5;
    const e = new THREE.Vector3(Math.cos(bend) * (r0 + len), -0.55, Math.sin(bend) * (r0 + len));
    const c = new THREE.Vector3(Math.cos(a) * (r0 + len * 0.35), 0.45, Math.sin(a) * (r0 + len * 0.35));
    bough(b, m, thick * (0.8 + rng.next() * 0.4), 0.07, s, c, e, 9, 5);
  }
}

interface GiantGeo {
  /** Winter-only fine twig crown (elders). */
  twigs?: THREE.BufferGeometry;
  trunk: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  cards: THREE.BufferGeometry;
  height: number;
  radius: number;
}

function addWindAttr(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => number): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const w = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) w[i] = fn(p.fromBufferAttribute(pos, i));
  g.setAttribute('aWind', new THREE.BufferAttribute(w, 1));
}

interface Blob {
  c: THREE.Vector3;
  r: number;
  inner?: boolean;
  tint?: THREE.Color;
}

/** A clump of `n` leaf puffs around `c` (one big + satellites spilling outward and down). */
function cluster(out: Blob[], rng: Rng, c: THREE.Vector3, r: number, n: number): void {
  out.push({ c: c.clone(), r: r * (1 + rng.next() * 0.15) });
  const dir = new THREE.Vector3(c.x, 0, c.z).normalize();
  for (let i = 1; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const o = new THREE.Vector3(Math.cos(a), (rng.next() - 0.6) * 0.7, Math.sin(a)).multiplyScalar(r * (0.75 + rng.next() * 0.3)).addScaledVector(dir, r * 0.3);
    out.push({ c: c.clone().add(o), r: r * (0.62 + rng.next() * 0.22) });
  }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function elder(rng: Rng): GiantGeo {
  const b = new MeshBuilder();
  const bark = giantBarkMaterial();
  const leaf = canopyMaterial('elder');
  const trunkH = 4.5 + rng.next() * 0.8;
  const r0 = 0.9 + rng.next() * 0.18;
  const trunkAO = (p: THREE.Vector3) => 0.4 + 0.6 * THREE.MathUtils.smoothstep(p.y, -0.3, 2.2);
  b.add(bark, trunkGeometry(rng, trunkH + 0.6, r0, 5 + rng.int(0, 2), 0.55), undefined, { aoWorld: trunkAO });
  // Root tubes diving into the ground between the swells.
  roots(b, bark, rng, r0, 6 + rng.int(0, 1), 1.5, 0.34);
  const tb = new MeshBuilder();
  const twig = giantTwigMaterial();
  const top = new THREE.Vector3(0, trunkH, 0);
  const crownY = trunkH + 2.9 + rng.next() * 0.7;
  const spread = 5.2 + rng.next() * 1.0;
  const blobs: Blob[] = [];
  const nLimbs = 4 + rng.int(0, 1);
  for (let i = 0; i < nLimbs; i++) {
    const a = (i / nLimbs) * Math.PI * 2 + rng.next() * 0.7;
    const start = top.clone().add(new THREE.Vector3(0, -rng.next() * 1.4, 0));
    const out = spread * (0.62 + rng.next() * 0.2);
    const end = new THREE.Vector3(Math.cos(a) * out, crownY - 0.6 + rng.next() * 1.4, Math.sin(a) * out);
    const ctrl = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 1.6, 0)).multiply(new THREE.Vector3(0.55, 1, 0.55));
    bough(b, bark, r0 * 0.46, 0.14, start, ctrl, end, 9, 4);
    branchTree(tb, twig, rng, end, end.clone().sub(ctrl).normalize().add(new THREE.Vector3(0, 0.5, 0)), 1.6, 0.1, 0);
    // Secondary boughs + twigs (the bare winter silhouette).
    for (let k = 0; k < 3; k++) {
      const a2 = a + (rng.next() - 0.5) * 1.6;
      const from = start.clone().lerp(end, 0.55 + k * 0.15);
      const to = from.clone().add(new THREE.Vector3(Math.cos(a2) * (1.6 + rng.next() * 1.6), 0.8 + rng.next() * 1.4, Math.sin(a2) * (1.6 + rng.next() * 1.6)));
      bough(b, bark, 0.17, 0.07, from, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.5, 0)), to, 6, 3);
      // Bare-crown twig tree off the end of every secondary bough (drawn in winter only).
      branchTree(tb, twig, rng, to, to.clone().sub(from).normalize().add(new THREE.Vector3(0, 0.35, 0)), 1.3 + rng.next() * 0.5, 0.075, 0);
      cluster(blobs, rng, to.clone().add(new THREE.Vector3(0, 0.45, 0)), 1.35, 2);
    }
    cluster(blobs, rng, end.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.7, 3);
  }
  // Crown dome + inner fill so the canopy reads as one mass of clustered clouds.
  cluster(blobs, rng, new THREE.Vector3(0, crownY + 1.5, 0), 1.9, 4);
  for (let i = 0; i < 4; i++) {
    const a = rng.next() * Math.PI * 2;
    const rr = spread * (0.2 + rng.next() * 0.3);
    blobs.push({ c: new THREE.Vector3(Math.cos(a) * rr, crownY + 0.3 + rng.next() * 1.2, Math.sin(a) * rr), r: 2.0 + rng.next() * 0.4, inner: true });
  }
  const center = new THREE.Vector3(0, crownY, 0);
  const q = new THREE.Vector3();
  const ao = (p: THREE.Vector3, n: THREE.Vector3): number => {
    const dy = (p.y - crownY) / 3.2;
    const out = Math.hypot(p.x, p.z) / (spread + 2);
    const vert = THREE.MathUtils.smoothstep(dy, -1.2, 0.9);
    const shell = THREE.MathUtils.smoothstep(out, 0.3, 1.0);
    const up = THREE.MathUtils.clamp(n.y * 0.5 + 0.5, 0, 1);
    // Crevice occlusion: how buried a point is in the neighbouring puffs (probe along the normal).
    q.copy(p).addScaledVector(n, 0.55);
    let occ = 0;
    for (const o of blobs) {
      const d = q.distanceTo(o.c);
      if (d < o.r + 0.3) occ += THREE.MathUtils.smoothstep(o.r + 0.3, o.r - 0.6, d);
    }
    const crev = 1 - Math.min(1, occ) * 0.5;
    return (0.36 + 0.64 * (vert * 0.5 + shell * 0.25 + up * 0.25)) * crev;
  };
  // Per-puff hue / value jitter (±8 %): the canopy reads as many clumps, not one dyed blob.
  for (const bl of blobs) {
    const v = 0.9 + rng.next() * 0.2;
    bl.tint = new THREE.Color(v, v, v).offsetHSL((rng.next() - 0.5) * 0.05, (rng.next() - 0.5) * 0.08, 0);
  }
  for (const bl of blobs) {
    // Inner fill is mostly hidden: a coarser mesh is plenty. Shells sit a touch inside the card fringe.
    const g = lumpySphere(bl.r * 0.82, 1, 0.12, rng, 1.4);
    g.scale(1, 0.8, 1);
    uvScale(g, 1.5, 1.1);
    g.translate(bl.c.x, bl.c.y, bl.c.z);
    // Each puff shades as its own rounded clump, tied into the crown's overall volume.
    sphericalNormals(g, bl.c, 0.55);
    sphericalNormals(g, center, 0.35);
    // Shells a shade darker than the cards: the gaps between leaf clusters read as depth.
    b.add(leaf, g, undefined, { aoWorld: ao, tint: bl.tint!.clone().multiplyScalar(0.72) });
  }
  // Leaf-cluster cards on every outer puff (none deep inside the crown or buried in a neighbour).
  const cards = new CardBuilder();
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const cc = new THREE.Color();
  for (const bl of blobs) {
    if (bl.inner) continue;
    const n = Math.round(12 + bl.r * 12);
    const rot0 = rng.next() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const y = 1 - ((i + 0.5) / n) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = rot0 + i * GOLDEN;
      dir.set(Math.cos(th) * rr, y, Math.sin(th) * rr);
      if (dir.y < -0.45 && rng.next() < 0.7) continue;
      p.copy(dir).multiplyScalar(bl.r * (0.78 + rng.next() * 0.24));
      p.y *= 0.8;
      p.add(bl.c);
      let buried = false;
      for (const o of blobs) {
        if (o === bl) continue;
        if (p.distanceTo(o.c) < o.r * 0.7) {
          buried = true;
          break;
        }
      }
      if (buried) continue;
      nrm.copy(p).sub(center).multiply(new THREE.Vector3(1, 1.25, 1)).normalize().lerp(dir, 0.55).normalize();
      const size = bl.r * (0.8 + rng.next() * 0.35);
      const a = ao(p, nrm);
      cc.copy(bl.tint!).multiplyScalar(a * (0.94 + rng.next() * 0.12));
      cards.add(p, nrm, size, size, rng.next() * Math.PI * 2, cc);
    }
  }
  const geos = b.geometries();
  const trunk = geos.get(bark)!;
  const leaves = geos.get(leaf)!;
  const cardGeo = cards.build();
  const H = crownY + 3.2;
  addWindAttr(trunk, (pp) => Math.pow(THREE.MathUtils.clamp((pp.y - trunkH * 0.6) / (H - trunkH * 0.6), 0, 1), 1.6) * 0.8);
  const leafW = (pp: THREE.Vector3) => 0.3 + 0.7 * THREE.MathUtils.clamp((pp.y - trunkH) / (H - trunkH), 0, 1);
  addWindAttr(leaves, leafW);
  addWindAttr(cardGeo, leafW);
  const twigs = tb.geometries().get(twig)!;
  addWindAttr(twigs, (pp) => 0.4 + 0.6 * Math.pow(THREE.MathUtils.clamp((pp.y - trunkH * 0.6) / (H - trunkH * 0.6), 0, 1), 1.4));
  return { trunk, leaves, cards: cardGeo, twigs, height: H, radius: spread + 2.5 };
}

function fir(rng: Rng): GiantGeo {
  const b = new MeshBuilder();
  const bark = giantBarkMaterial();
  const leaf = canopyMaterial('fir');
  const H = 10.8 + rng.next() * 2.0;
  const trunkAO = (p: THREE.Vector3) => 0.42 + 0.58 * THREE.MathUtils.smoothstep(p.y, -0.3, 2.0);
  b.add(bark, trunkGeometry(rng, H * 0.9, 0.62, 5, 0.6, 20, 14), undefined, { aoWorld: trunkAO });
  roots(b, bark, rng, 0.62, 5, 1.0, 0.24);
  const cards = new CardBuilder();
  const tiers = 6 + rng.int(0, 1);
  const base = 2.0;
  const cc = new THREE.Color();
  const nrm = new THREE.Vector3();
  const pp = new THREE.Vector3();
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const r = THREE.MathUtils.lerp(3.9, 1.0, Math.pow(f, 0.85)) * (0.92 + rng.next() * 0.16);
    const th = THREE.MathUtils.lerp(3.0, 1.9, f);
    const y = base + f * (H - base - th * 0.75);
    const radial = 30;
    const lobes = 7 + rng.int(0, 2);
    const ph = rng.next() * Math.PI * 2;
    const g = new THREE.ConeGeometry(r, th, radial, 5, true);
    g.translate(0, th / 2, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const droopAt = (q: number) => q * q * 0.85 - Math.pow(q, 6) * 0.15;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const rad = Math.hypot(p.x, p.z);
      if (rad > 0.01) {
        const ang = Math.atan2(p.z, p.x);
        const q = rad / r;
        // Smooth bough scallops that grow towards the rim (no stair-stepped jag).
        const sc = 1 + 0.12 * Math.sin(ang * lobes + ph) * q + 0.04 * Math.sin(ang * (lobes * 2 + 1) + ph * 2) * q;
        p.x *= sc;
        p.z *= sc;
        p.y -= droopAt(q) + 0.18 * Math.max(0, Math.sin(ang * lobes + ph)) * q * q;
      }
      pos.setXYZ(i, p.x, p.y + y, p.z);
    }
    g.computeVertexNormals();
    uvScale(g, 5, 2);
    const gg = g.toNonIndexed();
    // Normals fan up + out from below the tier: skirts catch the sun (and the snow) seen from above.
    sphericalNormals(gg, new THREE.Vector3(0, y - th * 0.6, 0), 0.5);
    const tierAO = (q: THREE.Vector3) => {
      const local = THREE.MathUtils.clamp((q.y - y + 0.9) / (th + 0.9), 0, 1);
      return (0.5 + 0.5 * local) * (0.8 + 0.2 * f);
    };
    b.add(leaf, gg, undefined, { aoWorld: tierAO });
    // Needle sprays hanging off the tier rim + a few lying on the tier top (break the skirt outline).
    const tint = new THREE.Color(1, 1, 1).offsetHSL((rng.next() - 0.5) * 0.03, 0, (rng.next() - 0.5) * 0.06);
    const nRim = Math.round(r * 8.5);
    for (let k = 0; k < nRim; k++) {
      const ang = (k / nRim) * Math.PI * 2 + (rng.next() - 0.5) * 0.3;
      const sc = 1 + 0.12 * Math.sin(ang * lobes + ph) + 0.04 * Math.sin(ang * (lobes * 2 + 1) + ph * 2);
      const q = 0.93 + rng.next() * 0.08;
      const rr = r * sc * q;
      const yy = y - droopAt(q) - 0.18 * Math.max(0, Math.sin(ang * lobes + ph)) * q * q + 0.1;
      pp.set(Math.cos(ang) * rr, yy, Math.sin(ang) * rr);
      nrm.set(Math.cos(ang), 0.75, Math.sin(ang)).normalize();
      const s = (0.9 + rng.next() * 0.35) * (0.75 + 0.25 * (1 - f));
      cc.copy(tint).multiplyScalar(tierAO(pp) * (0.92 + rng.next() * 0.22));
      cards.add(pp, nrm, s * 0.9, s * 1.25, (rng.next() - 0.5) * 0.5, cc, { anchorY: 0.78 });
    }
    // Sprays lying all over the tier tops: seen from the diorama camera the tiers read as layered
    // needle boughs instead of smooth dark cones.
    const nTop = Math.round(r * 8);
    for (let k = 0; k < nTop; k++) {
      const ang = rng.next() * Math.PI * 2;
      const q = 0.25 + rng.next() * 0.6;
      pp.set(Math.cos(ang) * r * q, y + th * (1 - q) - droopAt(q) + 0.15, Math.sin(ang) * r * q);
      nrm.set(Math.cos(ang) * 0.6, 1, Math.sin(ang) * 0.6).normalize();
      const s = 0.9 + rng.next() * 0.5;
      cc.copy(tint).multiplyScalar(tierAO(pp) * (1.0 + rng.next() * 0.22));
      cards.add(pp, nrm, s, s * 1.1, rng.next() * Math.PI * 2, cc);
    }
  }
  // Crown tip spray.
  cards.add(new THREE.Vector3(0, H - 0.1, 0), new THREE.Vector3(0, 1, 0), 1.2, 1.6, 0, new THREE.Color(1, 1, 1), { anchorY: 0.35 });
  const geos = b.geometries();
  const trunk = geos.get(bark)!;
  const leaves = geos.get(leaf)!;
  const cardGeo = cards.build();
  addWindAttr(trunk, (p) => Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 2) * 0.5);
  const lw = (p: THREE.Vector3) => 0.12 + 0.88 * Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 1.4);
  addWindAttr(leaves, lw);
  addWindAttr(cardGeo, lw);
  return { trunk, leaves, cards: cardGeo, height: H, radius: 3.9 };
}

export interface GiantHandle {
  kind: GiantKind;
  set: InstancedSet;
  id: number;
  x: number;
  z: number;
  seed: number;
  radius: number;
  height: number;
  scale: number;
}

export class GiantGrove {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('giants');
  readonly handles: GiantHandle[] = [];
  private variants = new Map<GiantKind, GiantGeo[]>();
  private sets = new Map<string, InstancedSet>();
  private static depthTrunk: THREE.MeshDepthMaterial | null = null;
  private static depthLeaf: THREE.MeshDepthMaterial | null = null;
  static leafDepth(): THREE.MeshDepthMaterial {
    GiantGrove.depthLeaf ??= windDepthMaterial(WIND_LEAF);
    return GiantGrove.depthLeaf;
  }

  constructor(private rng: Rng) {
    this.group.name = 'giants';
    this.group.add(this.pool.group);
  }

  private variantsFor(kind: GiantKind): GiantGeo[] {
    let v = this.variants.get(kind);
    if (!v) {
      const r = this.rng.fork(`giant-${kind}`);
      v = [];
      for (let i = 0; i < 3; i++) v.push(kind === 'elder' ? elder(r) : fir(r));
      this.variants.set(kind, v);
    }
    return v;
  }

  private setFor(kind: GiantKind, vi: number): InstancedSet {
    const key = `${kind}:${vi}`;
    let s = this.sets.get(key);
    if (!s) {
      const g = this.variantsFor(kind)[vi]!;
      GiantGrove.depthTrunk ??= windDepthMaterial(WIND_TRUNK);
      GiantGrove.depthLeaf ??= windDepthMaterial(WIND_LEAF);
      const parts: InstancedPart[] = [
        { geometry: g.trunk, material: giantBarkMaterial(), depthMaterial: GiantGrove.depthTrunk },
        { geometry: g.leaves, material: canopyMaterial(kind), tinted: true, depthMaterial: GiantGrove.depthLeaf },
        { geometry: g.cards, material: cardMaterial(kind), tinted: true, depthMaterial: cardDepthMaterial(kind) },
      ];
      if (g.twigs) parts.push({ geometry: g.twigs, material: giantTwigMaterial(), depthMaterial: GiantGrove.depthTrunk });
      s = new InstancedSet(`giant-${key}`, parts, this.pool);
      this.sets.set(key, s);
    }
    return s;
  }

  add(kind: GiantKind, x: number, y: number, z: number, scale = 1, variant?: number): GiantHandle {
    const vi = variant ?? this.rng.int(0, 2);
    const set = this.setFor(kind, vi);
    const geo = this.variantsFor(kind)[vi]!;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(_up, this.rng.next() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.94 + this.rng.next() * 0.12), scale),
    );
    const id = set.add(m, new THREE.Color(1, 1, 1));
    const h: GiantHandle = { kind, set, id, x, z, seed: this.rng.next(), radius: geo.radius * scale, height: geo.height * scale, scale };
    this.handles.push(h);
    return h;
  }

  setSeason(season: Season): void {
    mossColor.setHex(MOSS[season]);
    const c = new THREE.Color();
    for (const h of this.handles) {
      const pal = (h.kind === 'elder' ? ELDER_PALETTE : FIR_PALETTE)[season];
      c.setHex(pal[Math.floor(h.seed * pal.length) % pal.length]!);
      const v = 0.92 + ((h.seed * 7.3) % 1) * 0.16;
      c.multiplyScalar(v);
      h.set.setColor(h.id, c);
    }
    for (const key of ['elder', 'card-elder']) {
      const m = leafMats.get(key);
      if (m) for (const mesh of this.pool.meshesFor(m)) mesh.visible = season !== 'winter';
    }
    for (const mesh of this.pool.meshesFor(giantTwigMaterial())) mesh.visible = season === 'winter';
  }
}

// ───────────────────────────────────────────── understory shrubs

/** Shrub tints per season (winter shrubs are evergreen box / holly: dark green under their snow caps). */
const SHRUB_PALETTE: Record<Season, number[]> = {
  spring: [0x7fbf4c, 0x8cc656, 0x70ae48],
  summer: [0x4f943a, 0x5a9c3c, 0x478a35],
  fall: [0xd8782a, 0xc9552a, 0x9a8a34, 0xe0a034],
  winter: [0x3f6a48, 0x456f4a],
};

function shrubGeometry(rng: Rng): { shell: THREE.BufferGeometry; cards: THREE.BufferGeometry } {
  const b = new MeshBuilder();
  const leaf = canopyMaterial('elder');
  const blobs: Blob[] = [];
  const n = 3 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.next();
    const d = i === 0 ? 0 : 0.35 + rng.next() * 0.2;
    const r = i === 0 ? 0.62 : 0.4 + rng.next() * 0.15;
    blobs.push({ c: new THREE.Vector3(Math.cos(a) * d, r * 0.75 + (i === 0 ? 0.12 : 0), Math.sin(a) * d), r });
  }
  const center = new THREE.Vector3(0, 0.3, 0);
  const ao = (p: THREE.Vector3, nn: THREE.Vector3) => (0.42 + 0.58 * THREE.MathUtils.smoothstep(p.y, 0.0, 0.9)) * (0.8 + 0.2 * (nn.y * 0.5 + 0.5));
  const cards = new CardBuilder();
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const cc = new THREE.Color();
  for (const bl of blobs) {
    const v = 0.9 + rng.next() * 0.2;
    const tint = new THREE.Color(v, v, v).offsetHSL((rng.next() - 0.5) * 0.05, 0, 0);
    const g = lumpySphere(bl.r * 0.8, 1, 0.12, rng, 1.4);
    g.scale(1, 0.85, 1);
    g.translate(bl.c.x, bl.c.y, bl.c.z);
    sphericalNormals(g, bl.c, 0.5);
    sphericalNormals(g, center, 0.4);
    b.add(leaf, g, undefined, { aoWorld: ao, tint: tint.clone().multiplyScalar(0.72) });
    const k = Math.round(9 + bl.r * 14);
    const rot0 = rng.next() * 6.28;
    for (let i = 0; i < k; i++) {
      const y = 1 - ((i + 0.5) / k) * 2;
      if (y < -0.35) continue;
      const rr = Math.sqrt(1 - y * y);
      const th = rot0 + i * GOLDEN;
      dir.set(Math.cos(th) * rr, y, Math.sin(th) * rr);
      p.copy(dir).multiplyScalar(bl.r * (0.8 + rng.next() * 0.2)).add(bl.c);
      nrm.copy(p).sub(center).normalize().lerp(dir, 0.5).normalize();
      const s = bl.r * (0.9 + rng.next() * 0.4);
      cc.copy(tint).multiplyScalar(ao(p, nrm) * (0.94 + rng.next() * 0.12));
      cards.add(p, nrm, s, s, rng.next() * 6.28, cc);
    }
  }
  const shell = b.geometries().get(leaf)!;
  const cg = cards.build();
  const w = (q: THREE.Vector3) => THREE.MathUtils.clamp(q.y / 1.2, 0, 1) * 0.35;
  addWindAttr(shell, w);
  addWindAttr(cg, w);
  return { shell, cards: cg };
}

/**
 * Leafy understory shrubs in the same painted style as the giants' canopies (shell + leaf cards).
 * Winter turns them into evergreen mounds with snow caps (worldfx), fall into russet / gold.
 */
export class ShrubField {
  readonly pool = new BatchPool('shrubs');
  private sets: InstancedSet[] = [];
  private items: { set: InstancedSet; id: number; seed: number }[] = [];

  constructor(private rng: Rng) {
    for (let i = 0; i < 3; i++) {
      const g = shrubGeometry(rng.fork(`shrub-${i}`));
      GiantGrove.leafDepth();
      this.sets.push(
        new InstancedSet(
          `shrub-${i}`,
          [
            { geometry: g.shell, material: canopyMaterial('elder'), tinted: true, depthMaterial: GiantGrove.leafDepth() },
            { geometry: g.cards, material: cardMaterial('elder'), tinted: true, depthMaterial: cardDepthMaterial('elder') },
          ],
          this.pool,
        ),
      );
    }
  }

  add(x: number, y: number, z: number, scale = 1): void {
    const set = this.sets[this.rng.int(0, this.sets.length - 1)]!;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y - 0.05, z),
      new THREE.Quaternion().setFromAxisAngle(_up, this.rng.next() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.85 + this.rng.next() * 0.3), scale),
    );
    const id = set.add(m, new THREE.Color(1, 1, 1));
    this.items.push({ set, id, seed: this.rng.next() });
  }

  finalize(): void {
    for (const s of this.sets) s.finalize();
  }

  setSeason(season: Season): void {
    const c = new THREE.Color();
    const pal = SHRUB_PALETTE[season];
    for (const it of this.items) {
      c.setHex(pal[Math.floor(it.seed * pal.length) % pal.length]!).multiplyScalar(0.92 + ((it.seed * 13.7) % 1) * 0.16);
      it.set.setColor(it.id, c);
    }
  }
}
