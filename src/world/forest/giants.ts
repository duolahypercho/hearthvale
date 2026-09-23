/**
 * Old-growth giants for Cindergrove:
 *  - Elder: a broad-leaved ancient with a buttressed, fluted trunk, moss creeping up the roots and
 *    limb tops, four great limbs and a huge cloud-clustered canopy (bare, snow-dusted limbs in winter;
 *    every tree picks its own autumn hue).
 *  - Fir: a towering evergreen with ten drooping, jagged tiers over a flared, mossy bole.
 * A few geometry variants per kind, batched (one multi-draw per material), wind-swayed (shadows too).
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import type { Season } from '../../core/time';
import { MeshBuilder, lumpySphere, sphericalNormals, uvScale, smoothNormals } from '../geom';
import { textures } from '../../render/textures';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { InstancedSet, BatchPool } from '../props/instanced';
import type { GiantKind } from './layout';

const WIND_TRUNK = { mode: 'attribute' as const, amplitude: 0.1, flutter: 0 };
const WIND_LEAF = { mode: 'attribute' as const, amplitude: 0.16, flutter: 0.45 };

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
  // Limbs above the bole dissolve with the canopy (bare limbs poking through a cut-away crown read as spikes).
  applyOcclusionFade(barkMat, 1.6, 2.5, 'mix(1.0, 3.4, smoothstep(3.2, 4.6, vGLocalY))');
  return barkMat;
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
}

/**
 * Foliage masses read as many leaf clumps: 3D cellular noise shades each cell as its own little dome
 * (bent normals + soft seams), adds leaf-scale speckle, and near the silhouette cuts away the rim of
 * every clump so outlines are scalloped instead of clay-smooth. Needs applyWorldFx first.
 */
export function applyLeafClumps(m: THREE.Material, o: LeafClumpOptions): void {
  const f = `vec3(${o.freq.map((v) => v.toFixed(3)).join(', ')})`;
  const cut = (o.cut ?? 1).toFixed(3);
  patchMaterial(m, `leaf-clumps:${o.freq.join(',')}:${o.bend}:${o.seam}:${cut}`, (shader) => {
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', LEAF_CELLS_GLSL);
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
        float hvSil = (1.0 - smoothstep(0.06, 0.34, hvNdv)) * ${cut};
        float hvJit = hvNoise(vHvWorldPos.xz * 13.0 + vHvWorldPos.y * 7.0);
        // Only cut where a clump rim meets the outline (the mass stays whole, no floating chips).
        if (hvLeafEdge * (1.0 - hvD1 * 0.5) < hvSil * (0.2 + hvJit * 0.18)) discard;
        diffuseColor.rgb *= ${(1 - o.seam).toFixed(3)} + ${o.seam.toFixed(3)} * smoothstep(0.0, 0.22, hvLeafEdge);
        float hvSpk = hvNoise(vHvWorldPos.xz * 17.0 + vHvWorldPos.y * 11.0);
        diffuseColor.rgb *= 0.9 + 0.2 * smoothstep(0.35, 0.8, hvSpk);
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

const leafMats = new Map<GiantKind, THREE.MeshStandardMaterial>();
function canopyMaterial(kind: GiantKind): THREE.MeshStandardMaterial {
  let m = leafMats.get(kind);
  if (m) return m;
  const t = textures.leaves();
  m = new THREE.MeshStandardMaterial({ bumpMap: t.bump, bumpScale: 0.35, roughness: 0.93, vertexColors: true, color: 0xffffff });
  m.name = `giantLeaf-${kind}`;
  applyWorldFx(m, { snowUp: kind === 'fir' ? 0.38 : 0.6 });
  applyWind(m, WIND_LEAF);
  applyLeafClumps(m, kind === 'fir' ? { freq: [4.2, 2.6, 4.2], bend: 0.55, seam: 0.24 } : { freq: [3.1, 3.1, 3.1], bend: 0.7, seam: 0.24 });
  patchMaterial(m, 'giant-canopy', (shader) => {
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    let fs = shader.fragmentShader;
    if (!fs.includes('uniform vec3 uSunDir;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunDir;\nuniform vec3 uSunColor;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 fp = vHvWorldPos * 1.9;
        float clump = hvNoise(fp.xz + fp.y * 0.7) * 0.55 + hvNoise(fp.zy * 2.3 + 3.0) * 0.3 + hvNoise(fp.xy * 5.1) * 0.15;
        diffuseColor.rgb *= 0.74 + 0.4 * smoothstep(0.22, 0.8, clump);
        // Leaf dapple: small dark gaps between leaf clusters, brighter sprigs on top.
        float dap = hvNoise(fp.xz * 3.1 + fp.y * 2.3) * 0.6 + hvNoise(fp.zy * 4.7 + 1.3) * 0.4;
        diffuseColor.rgb *= 0.86 + 0.26 * smoothstep(0.3, 0.75, dap);
        // Shadowed / occluded leaves drift cooler (blue-green), sunlit tops warmer.
        float lumv = dot(vColor.rgb, vec3(0.333));
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.82, 0.95, 1.12), diffuseColor.rgb, smoothstep(0.25, 0.75, lumv));
        float top = smoothstep(0.1, 0.95, normalize(vHvWorldNormal).y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.1, 0.84), top * 0.55);
        // Autumn canopies keep a few green / russet clumps.
        float ah = hvNoise(fp.xz * 0.35 + 9.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 1.02, 0.62), smoothstep(0.66, 0.9, ah) * 0.45);
      }`,
    );
    fs = after(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec3 Vw = normalize(cameraPosition - vHvWorldPos);
        float back = pow(max(dot(-Vw, normalize(uSunDir)), 0.0), 3.0);
        float rim = pow(1.0 - max(dot(normalize(vHvWorldNormal), Vw), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (back * 0.5 + rim * 0.14) + diffuseColor.rgb * 0.02;
      }`,
    );
    shader.fragmentShader = fs;
  });
  applyOcclusionFade(m, 5.5, 2.2, '1.0', true);
  leafMats.set(kind, m);
  return m;
}


/**
 * See-through fade for a top-down camera: canopy / bark fragments very close to the lens, or sitting
 * in the sight-line cylinder between the camera and the player, dissolve with an ordered dither
 * (their shadows stay — the depth pass is untouched).
 */
function applyOcclusionFade(m: THREE.Material, radius: number, near: number, radiusScale = '1.0', cellular = false): void {
  patchMaterial(m, `occlusion-fade:${radius}:${near}:${radiusScale}:${cellular}`, (shader) => {
    shader.uniforms.uPlayerPos = globalUniforms.uPlayerPos;
    let fs = shader.fragmentShader;
    fs = before(fs, 'void main() {', 'uniform vec3 uPlayerPos;\nfloat hvBayer4(vec2 p) { ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4; int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(b[i]) + 0.5) / 16.0; }');
    fs = after(
      fs,
      'void main() {',
      /* glsl */ `
      {
        vec3 hvRel = vHvWorldPos - cameraPosition;
        float hvCamD = length(hvRel);
        float hvKeep = smoothstep(${near.toFixed(2)}, ${(near + 5).toFixed(2)}, hvCamD);
        vec3 hvF = uPlayerPos + vec3(0.0, 0.9, 0.0) - cameraPosition;
        float hvL = length(hvF);
        vec3 hvDir = hvF / max(hvL, 0.001);
        float hvAlong = dot(hvRel, hvDir);
        float hvPerp = length(hvRel - hvDir * hvAlong);
        float hvRs = ${radiusScale};
        float hvCyl = hvAlong < hvL - 0.6 ? smoothstep(${(radius * 0.55).toFixed(2)} * hvRs, ${radius.toFixed(2)} * hvRs, hvPerp) : 1.0;
        hvKeep = min(hvKeep, hvCyl);
        // Organic cut-away: world-space noise shapes the holes (leafy edges, not a screen door),
        // a little ordered dither softens the rim.
        hvOccKeep = hvKeep;
        float hvCut = hvNoise(vHvWorldPos.xz * 1.7 + vHvWorldPos.y * 0.9) * 0.75 + hvBayer4(gl_FragCoord.xy) * 0.25;
        if (${cellular ? 'false' : 'true'} && hvKeep < 0.999 && hvKeep < hvCut) discard;
      }`,
    );
    fs = after(fs, 'void main() {', 'float hvOccKeep = 1.0;');
    if (cellular) {
      // Foliage dissolves clump by clump (whole leaf sprigs wink out), not as a pixel spray.
      fs = after(
        fs,
        '#include <normal_fragment_maps>',
        'if (hvOccKeep < 0.999 && hvOccKeep < hvLeafRnd * 0.85 + hvBayer4(gl_FragCoord.xy) * 0.15) discard;',
      );
    }
    shader.fragmentShader = fs;
  });
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
function bough(b: MeshBuilder, m: THREE.Material, r0: number, r1: number, a: THREE.Vector3, ctrl: THREE.Vector3, e: THREE.Vector3, radial: number, n = 3): void {
  const curve = new THREE.QuadraticBezierCurve3(a, ctrl, e);
  let prev = a.clone();
  for (let i = 1; i <= n; i++) {
    const p = curve.getPoint(i / n);
    const ra = THREE.MathUtils.lerp(r0, r1, (i - 1) / n);
    const rb = THREE.MathUtils.lerp(r0, r1, i / n);
    // Overlap the joints a little so there are no seams.
    const dir = p.clone().sub(prev).normalize();
    b.add(m, limb(ra, rb, prev.clone().addScaledVector(dir, -ra * 0.4), p, radial, 2));
    prev = p;
  }
}

/** Fluted, buttressed trunk: lathe with root lobes flaring into the ground. */
function trunkGeometry(rng: Rng, h: number, r0: number, lobes: number, flare: number, radial = 22, rings = 16): THREE.BufferGeometry {
  const noise = new Noise2D(Math.floor(rng.next() * 1e9));
  const phase = rng.next() * Math.PI * 2;
  const lobeAmp = Array.from({ length: lobes }, () => 0.7 + rng.next() * 0.6);
  const leanX = (rng.next() - 0.5) * 0.9;
  const leanZ = (rng.next() - 0.5) * 0.9;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const y0 = -0.5;
  for (let j = 0; j <= rings; j++) {
    const f = j / rings;
    const y = y0 + Math.pow(f, 1.25) * (h - y0);
    const base = r0 * (1 - 0.42 * THREE.MathUtils.smoothstep(y, 0, h));
    const fl = Math.exp(-Math.max(0, y) / 0.85) * flare;
    const cx = leanX * Math.pow(Math.max(0, y) / h, 1.6);
    const cz = leanZ * Math.pow(Math.max(0, y) / h, 1.6);
    for (let i = 0; i <= radial; i++) {
      const th = (i / radial) * Math.PI * 2;
      let lobe = 0;
      for (let k = 0; k < lobes; k++) {
        const c = Math.cos(th - phase - (k / lobes) * Math.PI * 2);
        lobe += Math.pow(Math.max(0, c), 9) * lobeAmp[k]!;
      }
      const flute = 1 + 0.06 * Math.sin(th * 9 + y * 0.8) * (1 - fl * 0.5);
      const n = 1 + noise.get(Math.cos(th) * 1.3 + y * 0.35, Math.sin(th) * 1.3) * 0.08;
      // Distinct buttress fins between shallow bays (a smooth cone reads as a volcano from above).
      const r = base * flute * n * (1 + fl * (0.1 + lobe * 1.45));
      const yy = y < 0.3 ? y - lobe * fl * 0.08 : y;
      pos.push(cx + Math.cos(th) * r, yy, cz + Math.sin(th) * r);
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
  return g;
}

interface GiantGeo {
  trunk: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
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

function elder(rng: Rng): GiantGeo {
  const b = new MeshBuilder();
  const bark = giantBarkMaterial();
  const leaf = canopyMaterial('elder');
  const trunkH = 4.5 + rng.next() * 0.8;
  const r0 = 0.95 + rng.next() * 0.2;
  const trunkAO = (p: THREE.Vector3) => 0.42 + 0.58 * THREE.MathUtils.smoothstep(p.y, -0.2, 2.2);
  b.add(bark, trunkGeometry(rng, trunkH + 0.6, r0, 5 + rng.int(0, 2), 1.2), undefined, { aoWorld: trunkAO });
  // Surface roots snaking out between the buttresses.
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * Math.PI * 2;
    const len = 1.5 + rng.next() * 1.2;
    const s = new THREE.Vector3(Math.cos(a) * r0 * 1.0, 0.5, Math.sin(a) * r0 * 1.0);
    const e = new THREE.Vector3(Math.cos(a + 0.3) * (r0 + len), -0.4, Math.sin(a + 0.3) * (r0 + len));
    const c = s.clone().lerp(e, 0.5).add(new THREE.Vector3(0, 0.3, 0));
    bough(b, bark, 0.36, 0.1, s, c, e, 7, 3);
  }
  const top = new THREE.Vector3(0, trunkH, 0);
  const crownY = trunkH + 2.9 + rng.next() * 0.7;
  const spread = 5.4 + rng.next() * 1.0;
  const blobs: Blob[] = [];
  const nLimbs = 4 + rng.int(0, 1);
  for (let i = 0; i < nLimbs; i++) {
    const a = (i / nLimbs) * Math.PI * 2 + rng.next() * 0.7;
    const start = top.clone().add(new THREE.Vector3(0, -rng.next() * 1.4, 0));
    const out = spread * (0.62 + rng.next() * 0.2);
    const end = new THREE.Vector3(Math.cos(a) * out, crownY - 0.6 + rng.next() * 1.4, Math.sin(a) * out);
    const ctrl = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 1.6, 0)).multiply(new THREE.Vector3(0.55, 1, 0.55));
    bough(b, bark, r0 * 0.46, 0.14, start, ctrl, end, 9, 4);
    // Secondary boughs + twigs (the bare winter silhouette).
    for (let k = 0; k < 3; k++) {
      const a2 = a + (rng.next() - 0.5) * 1.6;
      const from = start.clone().lerp(end, 0.55 + k * 0.15);
      const to = from.clone().add(new THREE.Vector3(Math.cos(a2) * (1.6 + rng.next() * 1.6), 0.8 + rng.next() * 1.4, Math.sin(a2) * (1.6 + rng.next() * 1.6)));
      bough(b, bark, 0.16, 0.04, from, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.5, 0)), to, 5, 2);
      for (let t = 0; t < 3; t++) {
        const tw = to.clone().add(new THREE.Vector3((rng.next() - 0.5) * 1.6, 0.4 + rng.next() * 0.9, (rng.next() - 0.5) * 1.6));
        b.add(bark, limb(0.045, 0.012, to.clone().lerp(from, 0.2), tw, 4, 1));
      }
      // Each secondary bough ends in a small cluster of leaf puffs.
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
    const crev = 1 - Math.min(1, occ) * 0.55;
    return (0.3 + 0.7 * (vert * 0.5 + shell * 0.25 + up * 0.25)) * crev;
  };
  const q = new THREE.Vector3();
  for (const bl of blobs) {
    // Inner fill is mostly hidden: a coarser mesh is plenty.
    const g = lumpySphere(bl.r, bl.inner ? 1 : 2, 0.16, rng, 1.6);
    g.scale(1, 0.8, 1);
    uvScale(g, 1.5, 1.1);
    g.translate(bl.c.x, bl.c.y, bl.c.z);
    // Each puff shades as its own rounded clump, loosely tied to the crown's overall volume.
    sphericalNormals(g, bl.c, 0.6);
    sphericalNormals(g, center, 0.25);
    const v = 0.86 + rng.next() * 0.26;
    const warm = rng.next() * 0.06;
    b.add(leaf, g, undefined, { aoWorld: ao, tint: new THREE.Color(v + warm, v + warm * 0.5, (v - warm) * 0.96) });
  }
  const geos = b.geometries();
  const trunk = geos.get(bark)!;
  const leaves = geos.get(leaf)!;
  const H = crownY + 3.2;
  addWindAttr(trunk, (p) => Math.pow(THREE.MathUtils.clamp((p.y - trunkH * 0.6) / (H - trunkH * 0.6), 0, 1), 1.6) * 0.8);
  addWindAttr(leaves, (p) => 0.3 + 0.7 * THREE.MathUtils.clamp((p.y - trunkH) / (H - trunkH), 0, 1));
  return { trunk, leaves, height: H, radius: spread + 2.5 };
}

function fir(rng: Rng): GiantGeo {
  const b = new MeshBuilder();
  const bark = giantBarkMaterial();
  const leaf = canopyMaterial('fir');
  const H = 10.8 + rng.next() * 2.0;
  const trunkAO = (p: THREE.Vector3) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(p.y, -0.2, 2.0);
  b.add(bark, trunkGeometry(rng, H * 0.9, 0.7, 5, 1.3, 16, 12), undefined, { aoWorld: trunkAO });
  const tiers = 10;
  const base = 2.3;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const r = THREE.MathUtils.lerp(3.7, 0.6, Math.pow(f, 0.9)) * (0.9 + rng.next() * 0.2);
    const th = THREE.MathUtils.lerp(2.6, 1.4, f);
    const y = base + f * (H - base - th * 0.7);
    const radial = 18;
    const g = new THREE.ConeGeometry(r, th, radial, 3, true);
    g.translate(0, th / 2, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const rot = rng.next() * Math.PI;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const rad = Math.hypot(p.x, p.z);
      if (rad > 0.01) {
        const ang = Math.atan2(p.z, p.x) + rot;
        const jag = 1 + 0.16 * Math.sin(ang * 7) + 0.07 * Math.sin(ang * 17 + t) + (rng.next() - 0.5) * 0.1;
        p.x *= jag;
        p.z *= jag;
        // Droop: skirt tips hang down, bough ends curl up a touch.
        const q = rad / r;
        p.y -= q * q * 0.75 - Math.pow(q, 6) * 0.2;
      }
      pos.setXYZ(i, p.x, p.y + y, p.z);
    }
    const gg = smoothNormals(g.toNonIndexed());
    uvScale(gg, 5, 2);
    // Normals fan up + out from below the tier: skirts catch the sun (and the snow) seen from above.
    sphericalNormals(gg, new THREE.Vector3(0, y - th * 0.9, 0), 0.55);
    const tierAO = (pp: THREE.Vector3) => {
      const local = THREE.MathUtils.clamp((pp.y - y + 0.6) / (th + 0.6), 0, 1);
      return (0.52 + 0.48 * local) * (0.82 + 0.18 * f);
    };
    b.add(leaf, gg, undefined, { aoWorld: tierAO });
  }
  const geos = b.geometries();
  const trunk = geos.get(bark)!;
  const leaves = geos.get(leaf)!;
  addWindAttr(trunk, (p) => Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 2) * 0.5);
  addWindAttr(leaves, (p) => 0.12 + 0.88 * Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 1.4));
  return { trunk, leaves, height: H, radius: 3.8 };
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
      s = new InstancedSet(
        `giant-${key}`,
        [
          { geometry: g.trunk, material: giantBarkMaterial(), depthMaterial: GiantGrove.depthTrunk },
          { geometry: g.leaves, material: canopyMaterial(kind), tinted: true, depthMaterial: GiantGrove.depthLeaf },
        ],
        this.pool,
      );
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
    const elderLeaf = leafMats.get('elder');
    if (elderLeaf) for (const mesh of this.pool.meshesFor(elderLeaf)) mesh.visible = season !== 'winter';
  }
}
