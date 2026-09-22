/**
 * Procedural trees: oak, maple, pine, blossom. Each species has a few geometry variants
 * (trunk + limbs with root flare, lumpy foliage crown with baked AO and spherical normals)
 * rendered as instanced sets with wind sway (shadows sway too) and seasonal foliage.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import { MeshBuilder, lumpySphere, sphericalNormals, uvScale } from '../geom';
import { textures } from '../../render/textures';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { InstancedSet, BatchPool } from './instanced';

export type TreeSpecies = 'oak' | 'maple' | 'pine' | 'blossom';
export const TREE_SPECIES: readonly TreeSpecies[] = ['oak', 'maple', 'pine', 'blossom'];

const FOLIAGE_COLORS: Record<TreeSpecies, Record<Season, number | null>> = {
  oak: { spring: 0x68ad42, summer: 0x4a8e36, fall: 0xe0892e, winter: null },
  maple: { spring: 0x7fbf4c, summer: 0x559c38, fall: 0xd8432c, winter: null },
  pine: { spring: 0x3f7f4c, summer: 0x356f43, fall: 0x3b6e45, winter: 0x3a6650 },
  blossom: { spring: 0xf7c6d6, summer: 0x5f9f3e, fall: 0xe7a83c, winter: null },
};

const WIND_TRUNK = { mode: 'attribute' as const, amplitude: 0.14, flutter: 0 };
const WIND_LEAF = { mode: 'attribute' as const, amplitude: 0.14, flutter: 0.5 };

let barkMat: THREE.MeshStandardMaterial | null = null;
function treeBarkMaterial(): THREE.MeshStandardMaterial {
  if (barkMat) return barkMat;
  const t = textures.bark();
  barkMat = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 0.95, vertexColors: true, color: 0xd8c8b8 });
  barkMat.name = 'treeBark';
  applyWorldFx(barkMat, { snowUp: 0.7 });
  applyWind(barkMat, WIND_TRUNK);
  return barkMat;
}

const foliageMats = new Map<TreeSpecies, THREE.MeshStandardMaterial>();
function foliageMaterial(species: TreeSpecies): THREE.MeshStandardMaterial {
  let m = foliageMats.get(species);
  if (m) return m;
  const t = textures.leaves();
  m = new THREE.MeshStandardMaterial({
    bumpMap: t.bump,
    bumpScale: 1.1,
    roughness: 0.8,
    vertexColors: true,
    color: FOLIAGE_COLORS[species].summer ?? 0x4f9637,
  });
  m.name = `foliage-${species}`;
  applyWorldFx(m, { snowUp: species === 'pine' ? 0.45 : 0.6 });
  applyWind(m, WIND_LEAF);
  // Leafy clump breakup + sun-side translucency (uses worldfx varyings).
  patchMaterial(m, 'foliage', (shader) => {
    shader.uniforms.uSunDir = globalUniforms.uSunDir;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    let fs = shader.fragmentShader;
    if (!fs.includes('uniform vec3 uSunDir;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunDir;\nuniform vec3 uSunColor;');
    fs = after(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      {
        vec3 fp = vHvWorldPos * 2.6;
        float clump = hvNoise(fp.xz + fp.y * 0.7) * 0.6 + hvNoise(fp.zy * 1.9 + 3.0) * 0.4;
        diffuseColor.rgb *= 0.8 + 0.34 * smoothstep(0.2, 0.8, clump);
        float top = smoothstep(0.2, 0.95, normalize(vHvWorldNormal).y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.08, 0.86), top * 0.5);
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
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (back * 0.45 + rim * 0.12);
      }`,
    );
    shader.fragmentShader = fs;
  });
  foliageMats.set(species, m);
  return m;
}

const _up = new THREE.Vector3(0, 1, 0);

/** Tapered cylinder from a to b. */
function limb(r0: number, r1: number, a: THREE.Vector3, b: THREE.Vector3, radial = 7): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 3, false);
  uvScale(g, 1, len * 0.8);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

interface TreeGeo {
  trunk: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry | null;
  height: number;
}

function addWindAttr(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => number): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const w = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) w[i] = fn(p.fromBufferAttribute(pos, i));
  g.setAttribute('aWind', new THREE.BufferAttribute(w, 1));
}

function crownAO(center: THREE.Vector3, rx: number, ry: number) {
  return (p: THREE.Vector3, n: THREE.Vector3): number => {
    const dy = (p.y - center.y) / ry;
    const out = new THREE.Vector3(p.x - center.x, (p.y - center.y) * 0.5, p.z - center.z).length() / rx;
    const vert = THREE.MathUtils.smoothstep(dy, -1.1, 0.8);
    const shell = THREE.MathUtils.smoothstep(out, 0.35, 1.05);
    const up = THREE.MathUtils.clamp(n.y * 0.5 + 0.5, 0, 1);
    return 0.42 + 0.58 * (vert * 0.6 + shell * 0.25 + up * 0.15);
  };
}

function deciduous(rng: Rng, species: TreeSpecies, detail = 2): TreeGeo {
  const b = new MeshBuilder();
  const bark = treeBarkMaterial();
  const foliage = foliageMaterial(species);
  const tall = species === 'maple';
  const wide = species === 'blossom';
  const trunkH = (tall ? 2.6 : wide ? 1.5 : 2.0) + rng.next() * 0.5;
  const r0 = tall ? 0.28 : 0.34;
  const lean = new THREE.Vector3((rng.next() - 0.5) * 0.35, 0, (rng.next() - 0.5) * 0.35);
  const top = new THREE.Vector3(lean.x, trunkH, lean.z);
  const trunkAO = (p: THREE.Vector3) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0, 1.2);
  const lo = detail < 2;
  b.add(bark, limb(r0, r0 * 0.62, new THREE.Vector3(0, -0.2, 0), top, lo ? 6 : 9), undefined, { aoWorld: trunkAO });
  // Root flare
  const roots = lo ? 3 : 5;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng.next() * 0.6;
    const len = 0.5 + rng.next() * 0.35;
    b.add(bark, limb(r0 * 0.55, 0.04, new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(Math.cos(a) * len, -0.08, Math.sin(a) * len), lo ? 4 : 6), undefined, { aoWorld: trunkAO });
  }
  // Limbs + crown blobs
  const crownY = trunkH + (tall ? 1.7 : wide ? 1.0 : 1.3);
  const crownR = tall ? 1.55 : wide ? 2.1 : 1.95;
  const crownRy = tall ? 2.1 : wide ? 1.25 : 1.55;
  const center = new THREE.Vector3(lean.x, crownY, lean.z);
  const nLimbs = 3 + rng.int(0, 1);
  const blobs: { c: THREE.Vector3; r: number }[] = [];
  for (let i = 0; i < nLimbs; i++) {
    const a = (i / nLimbs) * Math.PI * 2 + rng.next() * 0.8;
    const start = top.clone().lerp(new THREE.Vector3(0, 0, 0), rng.next() * 0.25);
    const out = crownR * (0.55 + rng.next() * 0.25);
    const end = new THREE.Vector3(center.x + Math.cos(a) * out, crownY - crownRy * 0.1 + rng.next() * crownRy * 0.5, center.z + Math.sin(a) * out);
    b.add(bark, limb(r0 * 0.45, 0.05, start, end, lo ? 4 : 6), undefined, { aoWorld: trunkAO });
    // twigs
    for (let k = 0; k < (lo ? 0 : 2); k++) {
      const tw = end.clone().add(new THREE.Vector3((rng.next() - 0.5) * 0.9, 0.3 + rng.next() * 0.5, (rng.next() - 0.5) * 0.9));
      b.add(bark, limb(0.05, 0.015, end.clone().lerp(start, 0.25), tw, 5));
    }
    blobs.push({ c: end.clone().add(new THREE.Vector3(0, 0.2, 0)), r: crownR * (0.52 + rng.next() * 0.15) });
  }
  blobs.push({ c: center.clone().add(new THREE.Vector3(0, crownRy * 0.35, 0)), r: crownR * 0.68 });
  const fill = detail < 2 ? 1 : tall ? 5 : 4;
  for (let i = 0; i < fill; i++) {
    const a = rng.next() * Math.PI * 2;
    const rr = crownR * (0.3 + rng.next() * 0.35);
    const yy = (rng.next() - 0.35) * crownRy * (tall ? 1.3 : 0.9);
    blobs.push({ c: new THREE.Vector3(center.x + Math.cos(a) * rr, crownY + yy, center.z + Math.sin(a) * rr), r: crownR * (0.45 + rng.next() * 0.2) });
  }
  const ao = crownAO(center, crownR, crownRy);
  for (const bl of blobs) {
    const g = lumpySphere(bl.r, detail, 0.2, rng, 1.9);
    g.scale(1, tall ? 1.05 : 0.86, 1);
    uvScale(g, 1.6, 1.1);
    g.translate(bl.c.x, bl.c.y, bl.c.z);
    sphericalNormals(g, center, 0.55);
    const v = 0.9 + rng.next() * 0.2;
    const warm = rng.next() * 0.08;
    b.add(foliage, g, undefined, { aoWorld: ao, tint: new THREE.Color(v + warm, v + warm * 0.5, v - warm) });
  }
  const geos = b.geometries();
  const trunk = geos.get(bark)!;
  const leaves = geos.get(foliage)!;
  const H = crownY + crownRy;
  addWindAttr(trunk, (p) => Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 2) * 0.8);
  addWindAttr(leaves, (p) => 0.25 + 0.75 * THREE.MathUtils.clamp((p.y - trunkH * 0.5) / (H - trunkH * 0.5), 0, 1));
  return { trunk, foliage: leaves, height: H };
}

function pine(rng: Rng, radial = 11): TreeGeo {
  const b = new MeshBuilder();
  const bark = treeBarkMaterial();
  const foliage = foliageMaterial('pine');
  const H = 6.2 + rng.next() * 1.4;
  b.add(bark, limb(0.3, 0.06, new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, H * 0.92, 0), 8), undefined, {
    aoWorld: (p) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(p.y, 0, 1.5),
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.next();
    b.add(bark, limb(0.18, 0.03, new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(Math.cos(a) * 0.55, -0.08, Math.sin(a) * 0.55), 5));
  }
  const tiers = 5;
  const base = 1.1;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const r = THREE.MathUtils.lerp(1.9, 0.55, f) * (0.92 + rng.next() * 0.16);
    const th = THREE.MathUtils.lerp(1.9, 1.3, f);
    const y = base + f * (H - base - th * 0.8);
    const g = new THREE.ConeGeometry(r, th, radial, 3, false);
    g.translate(0, th / 2, 0);
    // Droop + jagged skirt.
    const pos = g.attributes.position as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const rad = Math.hypot(p.x, p.z);
      if (rad > 0.01) {
        const ang = Math.atan2(p.z, p.x);
        const jag = 1 + 0.12 * Math.sin(ang * 11 + t) + (rng.next() - 0.5) * 0.08;
        p.x *= jag;
        p.z *= jag;
        p.y -= (rad / r) * (rad / r) * 0.35;
      }
      pos.setXYZ(i, p.x, p.y + y, p.z);
    }
    g.computeVertexNormals();
    uvScale(g, 4, 2);
    sphericalNormals(g, new THREE.Vector3(0, y + th * 0.2, 0), 0.35);
    const tierAO = (pp: THREE.Vector3) => {
      const local = THREE.MathUtils.clamp((pp.y - y + 0.35) / (th + 0.35), 0, 1);
      return (0.45 + 0.55 * local) * (0.8 + 0.2 * f);
    };
    b.add(foliage, g, undefined, { aoWorld: tierAO });
  }
  const geos = b.geometries();
  const trunk = geos.get(bark)!;
  const leaves = geos.get(foliage)!;
  addWindAttr(trunk, (p) => Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 2) * 0.7);
  addWindAttr(leaves, (p) => 0.15 + 0.85 * Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 1.5));
  return { trunk, foliage: leaves, height: H };
}

export interface TreeHandle {
  species: TreeSpecies;
  set: InstancedSet;
  id: number;
  x: number;
  z: number;
}

export class TreeField {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('trees');
  private sets = new Map<string, InstancedSet>();
  private variants = new Map<string, TreeGeo[]>();
  private season: Season = 'spring';

  constructor(private rng: Rng) {
    this.group.name = 'trees';
    this.group.add(this.pool.group);
  }

  /** lod 0 = hero detail (play area), 1 = forest (distant plateau, ~4x fewer triangles). */
  private variantsFor(species: TreeSpecies, lod: number): TreeGeo[] {
    const key = `${species}:${lod}`;
    let v = this.variants.get(key);
    if (!v) {
      v = [];
      const r = this.rng.fork(`tree-${species}`);
      for (let i = 0; i < 3; i++) v.push(species === 'pine' ? pine(r, lod ? 8 : 11) : deciduous(r, species, lod ? 1 : 2));
      this.variants.set(key, v);
    }
    return v;
  }

  private static depthTrunk: THREE.MeshDepthMaterial | null = null;
  private static depthLeaf: THREE.MeshDepthMaterial | null = null;

  private setFor(species: TreeSpecies, vi: number, lod: number): InstancedSet {
    const key = `${species}:${vi}:${lod}`;
    let s = this.sets.get(key);
    if (!s) {
      const g = this.variantsFor(species, lod)[vi]!;
      TreeField.depthTrunk ??= windDepthMaterial(WIND_TRUNK);
      TreeField.depthLeaf ??= windDepthMaterial(WIND_LEAF);
      s = new InstancedSet(
        `tree-${key}`,
        [
          // Distant forest trunks sit under their canopies: skip them in the shadow pass.
          { geometry: g.trunk, material: treeBarkMaterial(), depthMaterial: TreeField.depthTrunk, castShadow: lod === 0 },
          { geometry: g.foliage!, material: foliageMaterial(species), tinted: true, depthMaterial: TreeField.depthLeaf },
        ],
        this.pool,
      );
      this.sets.set(key, s);
    }
    return s;
  }

  add(species: TreeSpecies, x: number, y: number, z: number, scale = 1, variant?: number, lod = 0): TreeHandle {
    const vi = variant ?? this.rng.int(0, 2);
    const set = this.setFor(species, vi, lod);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(_up, this.rng.next() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.92 + this.rng.next() * 0.16), scale),
    );
    const v = 0.88 + this.rng.next() * 0.22;
    const c = new THREE.Color(v * (0.95 + this.rng.next() * 0.1), v, v * (0.9 + this.rng.next() * 0.15));
    const id = set.add(m, c);
    return { species, set, id, x, z };
  }

  remove(h: TreeHandle): void {
    h.set.remove(h.id);
  }

  finalize(): void {
    this.setSeason(this.season);
  }

  setSeason(season: Season): void {
    this.season = season;
    for (const sp of TREE_SPECIES) {
      const m = foliageMats.get(sp);
      if (!m) continue;
      const c = FOLIAGE_COLORS[sp][season];
      if (c !== null) m.color.setHex(c);
      for (const mesh of this.pool.meshesFor(m)) mesh.visible = c !== null;
    }
  }
}
