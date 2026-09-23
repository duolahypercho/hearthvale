/**
 * Coastal plants, batched (one draw call per material for the whole beach):
 *   marram     tall dune-grass tufts, grey-green bases fading to straw tips, strong wind sway
 *   thrift     sea-thrift cushions with pink pom-pom heads on wiry stems
 *   bentPine   wind-bent coastal pines: a trunk leaning away from the sea and flat, layered canopy
 *              pads streaming leeward (evergreen)
 *   holly      sea holly: a spiky silver-blue rosette with steel-blue thistle heads
 *   peaMat     beach pea: a low sprawling mat of round leaves with magenta / violet pea flowers
 *   sedge      short, fine, straw-and-green dune sedge tufts (fills between the marram)
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import { BatchPool, InstancedSet } from '../props/instanced';
import { leafBlade, plantMaterial } from '../props/flora';
import { lumpySphere, sphericalNormals, uvScale, MeshBuilder } from '../geom';
import { textures } from '../../render/textures';
import { applyWind, windDepthMaterial } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { globalUniforms } from '../../render/uniforms';
import { taperTube } from './props';

const MARRAM_WIND = { mode: 'height' as const, height: 1.0, amplitude: 0.16, flutter: 0.55 };
const THRIFT_WIND = { mode: 'height' as const, height: 0.4, amplitude: 0.05, flutter: 0.3 };
const PINE_TRUNK = { mode: 'attribute' as const, amplitude: 0.08, flutter: 0 };
const PINE_LEAF = { mode: 'attribute' as const, amplitude: 0.1, flutter: 0.35 };

function colorGeo(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    fn(p.fromBufferAttribute(pos, i)).toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position!.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const C = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position!.count;
    P.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, o * 3);
    N.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, o * 3);
    if (g.attributes.color) C.set((g.attributes.color as THREE.BufferAttribute).array as Float32Array, o * 3);
    else C.fill(1, o * 3, (o + c) * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return out;
}

const BASE = new THREE.Color(0x5e7a4a);
const MID = new THREE.Color(0x9aae5e);
const TIP = new THREE.Color(0xe2d08a);

function marramGeo(rng: Rng): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const n = 16 + rng.int(0, 6);
  for (let i = 0; i < n; i++) {
    const len = 0.55 + rng.next() * 0.5;
    const g = leafBlade(len, 0.022 + rng.next() * 0.012, 0.35 + rng.next() * 0.45, 5);
    const ry = rng.next() * Math.PI * 2;
    const tilt = 0.12 + rng.next() * 0.35;
    g.rotateX(-tilt * 0.3);
    g.rotateY(ry);
    g.translate((rng.next() - 0.5) * 0.18, 0, (rng.next() - 0.5) * 0.18);
    const warm = rng.next();
    colorGeo(g, (p) => {
      const t = THREE.MathUtils.clamp(p.y / len, 0, 1);
      const c = t < 0.5 ? BASE.clone().lerp(MID, t * 2) : MID.clone().lerp(TIP, (t - 0.5) * 2);
      return c.multiplyScalar(0.85 + warm * 0.25);
    });
    blades.push(g);
  }
  return merge(blades);
}

function thriftGeo(rng: Rng): { leaves: THREE.BufferGeometry; heads: THREE.BufferGeometry } {
  const cushion = lumpySphere(0.2, 1, 0.25, rng, 2.2);
  cushion.scale(1.2, 0.5, 1.2);
  cushion.translate(0, 0.05, 0);
  colorGeo(cushion, (p) => new THREE.Color(0x6f8a5a).multiplyScalar(0.7 + p.y * 2.2));
  const stems: THREE.BufferGeometry[] = [cushion];
  const heads: THREE.BufferGeometry[] = [];
  const k = 5 + rng.int(0, 4);
  for (let i = 0; i < k; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.next() * 0.18;
    const h = 0.22 + rng.next() * 0.16;
    const s = new THREE.CylinderGeometry(0.006, 0.008, h, 3);
    s.translate(Math.cos(a) * r, h / 2 + 0.05, Math.sin(a) * r);
    colorGeo(s, () => new THREE.Color(0x7a8a5a));
    stems.push(s);
    const head = new THREE.IcosahedronGeometry(0.045 + rng.next() * 0.015, 1);
    head.translate(Math.cos(a) * r, h + 0.07, Math.sin(a) * r);
    const pink = new THREE.Color(rng.next() < 0.2 ? 0xf6d8e6 : 0xf08ab8).multiplyScalar(0.9 + rng.next() * 0.2);
    colorGeo(head, (p) => pink.clone().multiplyScalar(0.8 + (p.y - h) * 3));
    heads.push(head);
  }
  return { leaves: merge(stems), heads: merge(heads) };
}

function hollyGeo(rng: Rng): { leaves: THREE.BufferGeometry; heads: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const n = 9 + rng.int(0, 4);
  for (let i = 0; i < n; i++) {
    const len = 0.16 + rng.next() * 0.12;
    const g = leafBlade(len, 0.05 + rng.next() * 0.02, 0.75 + rng.next() * 0.2, 4);
    g.rotateY((i / n) * Math.PI * 2 + rng.next() * 0.4);
    colorGeo(g, (p) => new THREE.Color(0x7a9aa0).lerp(new THREE.Color(0xc8d8d4), THREE.MathUtils.clamp(p.y / len, 0, 1)).multiplyScalar(0.8 + rng.next() * 0.1));
    parts.push(g);
  }
  const heads: THREE.BufferGeometry[] = [];
  const k = 3 + rng.int(0, 3);
  for (let i = 0; i < k; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 0.03 + rng.next() * 0.08;
    const h = 0.22 + rng.next() * 0.16;
    const stem = new THREE.CylinderGeometry(0.007, 0.01, h, 3).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    colorGeo(stem, () => new THREE.Color(0x7890a8));
    parts.push(stem);
    const head = new THREE.IcosahedronGeometry(0.04, 1).scale(1, 1.25, 1).translate(Math.cos(a) * r, h + 0.03, Math.sin(a) * r);
    colorGeo(head, (p) => new THREE.Color(0x5a78c8).multiplyScalar(0.75 + (p.y - h) * 5));
    heads.push(head);
    // Spiky ruff (bracts) under the head.
    for (let j = 0; j < 6; j++) {
      const br = leafBlade(0.07, 0.014, 0.9, 2);
      br.rotateZ(-1.1).rotateY((j / 6) * Math.PI * 2).translate(Math.cos(a) * r, h, Math.sin(a) * r);
      colorGeo(br, () => new THREE.Color(0x8aa6c8));
      heads.push(br);
    }
  }
  return { leaves: merge(parts), heads: merge(heads) };
}

function peaGeo(rng: Rng): { leaves: THREE.BufferGeometry; heads: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const heads: THREE.BufferGeometry[] = [];
  // Runners radiating over the sand, each with pairs of round leaves.
  const runners = 5 + rng.int(0, 3);
  for (let i = 0; i < runners; i++) {
    const a = (i / runners) * Math.PI * 2 + rng.next() * 0.5;
    const len = 0.35 + rng.next() * 0.35;
    for (let s = 1; s <= 4; s++) {
      const d = (s / 4) * len;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      for (const side of [-1, 1]) {
        const leaf = new THREE.CircleGeometry(0.045 + rng.next() * 0.02, 6).rotateX(-Math.PI / 2 + 0.35 * side).rotateY(a + side * 0.9).translate(x + Math.cos(a + side * 1.57) * 0.03, 0.04 + rng.next() * 0.03, z + Math.sin(a + side * 1.57) * 0.03);
        colorGeo(leaf, () => new THREE.Color(0x4f7a3e).multiplyScalar(0.8 + rng.next() * 0.35));
        parts.push(leaf);
      }
      if (s >= 3 && rng.next() < 0.6) {
        const f = new THREE.IcosahedronGeometry(0.035, 0).scale(1, 0.8, 1).translate(x, 0.09, z);
        const c = new THREE.Color(rng.next() < 0.5 ? 0xc84aa0 : 0x8a5ad0).multiplyScalar(0.9 + rng.next() * 0.2);
        colorGeo(f, () => c);
        heads.push(f);
      }
    }
  }
  return { leaves: merge(parts), heads: merge(heads) };
}

function sedgeGeo(rng: Rng): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const n = 22 + rng.int(0, 8);
  const straw = new THREE.Color(0xd8c690);
  const green = new THREE.Color(0x7a9a52);
  for (let i = 0; i < n; i++) {
    const len = 0.18 + rng.next() * 0.2;
    const g = leafBlade(len, 0.012, 0.5 + rng.next() * 0.45, 3);
    g.rotateY(rng.next() * Math.PI * 2);
    g.translate((rng.next() - 0.5) * 0.12, 0, (rng.next() - 0.5) * 0.12);
    const k = rng.next();
    colorGeo(g, (p) => green.clone().lerp(straw, THREE.MathUtils.clamp(k * 0.6 + p.y / len * 0.6, 0, 1)));
    blades.push(g);
  }
  return merge(blades);
}

let pineLeafMat: THREE.MeshStandardMaterial | null = null;
let pineBarkMat: THREE.MeshStandardMaterial | null = null;

function pineMaterials(): { bark: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial } {
  if (!pineBarkMat) {
    const t = textures.bark();
    pineBarkMat = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 0.95, vertexColors: true, color: 0xb8a898 });
    pineBarkMat.name = 'bentPineBark';
    applyWorldFx(pineBarkMat, { snowUp: 0.6 });
    applyWind(pineBarkMat, PINE_TRUNK);
  }
  if (!pineLeafMat) {
    const t = textures.leaves();
    pineLeafMat = new THREE.MeshStandardMaterial({ bumpMap: t.bump, bumpScale: 1.4, roughness: 0.82, vertexColors: true, color: 0x3d6e4a });
    pineLeafMat.name = 'bentPineLeaf';
    applyWorldFx(pineLeafMat, { snowUp: 0.5 });
    applyWind(pineLeafMat, PINE_LEAF);
    patchMaterial(pineLeafMat, 'bent-pine', (shader) => {
      shader.uniforms.uSunDir = globalUniforms.uSunDir;
      shader.uniforms.uSunColor = globalUniforms.uSunColor;
      let fs = shader.fragmentShader;
      if (!fs.includes('uniform vec3 uSunDir;')) fs = before(fs, 'void main() {', 'uniform vec3 uSunDir;\nuniform vec3 uSunColor;');
      fs = after(
        fs,
        '#include <color_fragment>',
        `{
          vec3 fp = vHvWorldPos * 3.1;
          float clump = hvNoise(fp.xz + fp.y * 0.7) * 0.6 + hvNoise(fp.zy * 2.3 + 3.0) * 0.4;
          diffuseColor.rgb *= 0.78 + 0.36 * smoothstep(0.2, 0.8, clump);
          float top = smoothstep(0.1, 0.9, normalize(vHvWorldNormal).y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.1, 0.82), top * 0.55);
        }`,
      );
      fs = after(
        fs,
        '#include <emissivemap_fragment>',
        `{
          vec3 Vw = normalize(cameraPosition - vHvWorldPos);
          float back = pow(max(dot(-Vw, normalize(uSunDir)), 0.0), 3.0);
          float rim = pow(1.0 - max(dot(normalize(vHvWorldNormal), Vw), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (back * 0.4 + rim * 0.14);
        }`,
      );
      shader.fragmentShader = fs;
    });
  }
  return { bark: pineBarkMat, leaf: pineLeafMat };
}

function addWind(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => number): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const w = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) w[i] = fn(p.fromBufferAttribute(pos, i));
  g.setAttribute('aWind', new THREE.BufferAttribute(w, 1));
}

/** Wind-bent pine: leans towards -Z (inland), canopy pads stream leeward. Origin at the root. */
function bentPineGeo(rng: Rng): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const { bark, leaf } = pineMaterials();
  const b = new MeshBuilder();
  const H = 5.2 + rng.next() * 1.6;
  const lean = 1.6 + rng.next() * 1.2;
  const pts = [
    new THREE.Vector3(0, -0.2, 0),
    new THREE.Vector3(0.1, H * 0.3, -lean * 0.2),
    new THREE.Vector3(-0.15, H * 0.62, -lean * 0.6),
    new THREE.Vector3(0.05, H * 0.9, -lean),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  b.add(bark, taperTube(curve, 12, 0.26, 0.08, 8, false), undefined, { aoWorld: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0, 1.4) });
  // Limbs reaching leeward + canopy pads (flattened lumps).
  const pads: { c: THREE.Vector3; r: number }[] = [];
  const top = curve.getPointAt(1);
  pads.push({ c: top.clone().add(new THREE.Vector3(0, 0.25, -0.3)), r: 1.35 });
  for (let i = 0; i < 4 + rng.int(0, 2); i++) {
    const t = 0.55 + rng.next() * 0.4;
    const base = curve.getPointAt(t);
    const a = (rng.next() - 0.5) * 2.4;
    const reach = 1.0 + rng.next() * 1.2;
    const end = base.clone().add(new THREE.Vector3(Math.sin(a) * reach, 0.35 + rng.next() * 0.5, -Math.abs(Math.cos(a)) * reach * 0.9 - 0.3));
    const lc = new THREE.CatmullRomCurve3([base, base.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.25, 0)), end]);
    b.add(bark, taperTube(lc, 5, 0.1, 0.035, 5, false));
    pads.push({ c: end.clone().add(new THREE.Vector3(0, 0.15, -0.2)), r: 0.85 + rng.next() * 0.45 });
  }
  const center = top.clone().add(new THREE.Vector3(0, -0.2, -0.6));
  for (const pd of pads) {
    const g = lumpySphere(pd.r, 2, 0.28, rng, 2.1);
    g.scale(1.25, 0.42, 1.05);
    uvScale(g, 2, 1.2);
    g.translate(pd.c.x, pd.c.y, pd.c.z);
    sphericalNormals(g, center, 0.4);
    const v = 0.88 + rng.next() * 0.2;
    b.add(leaf, g, undefined, {
      tint: new THREE.Color(v, v * 1.02, v * 0.95),
      aoWorld: (p, n) => 0.45 + 0.4 * THREE.MathUtils.smoothstep(p.y - pd.c.y, -pd.r * 0.4, pd.r * 0.4) + 0.15 * THREE.MathUtils.clamp(n.y, 0, 1),
    });
  }
  const geos = b.geometries();
  const trunk = geos.get(bark)!;
  const leaves = geos.get(leaf)!;
  addWind(trunk, (p) => Math.pow(THREE.MathUtils.clamp(p.y / H, 0, 1), 2) * 0.7);
  addWind(leaves, (p) => 0.3 + 0.7 * THREE.MathUtils.clamp(p.y / (H + 1), 0, 1));
  return { trunk, leaves };
}

export class BeachFlora {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('beach-flora');
  private marram: InstancedSet[] = [];
  private thrift: InstancedSet[] = [];
  private pines: InstancedSet[] = [];
  private holly: InstancedSet[] = [];
  private pea: InstancedSet[] = [];
  private sedge: InstancedSet[] = [];
  private marramMat: THREE.MeshStandardMaterial;
  private thriftLeafMat: THREE.MeshStandardMaterial;
  private thriftHeadMat: THREE.MeshStandardMaterial;

  constructor(private rng: Rng) {
    this.group.name = 'beach-flora';
    this.group.userData.perfTag = 'nature';
    this.group.add(this.pool.group);
    this.marramMat = plantMaterial('marram', MARRAM_WIND, { roughness: 0.85 });
    this.thriftLeafMat = plantMaterial('thriftLeaf', THRIFT_WIND, { roughness: 0.9 });
    this.thriftHeadMat = plantMaterial('thriftHead', THRIFT_WIND, { roughness: 0.7 });
    const mDepth = windDepthMaterial(MARRAM_WIND);
    for (let i = 0; i < 4; i++) {
      this.marram.push(new InstancedSet(`marram${i}`, [{ geometry: marramGeo(rng), material: this.marramMat, depthMaterial: mDepth, tinted: true }], this.pool));
    }
    const tDepth = windDepthMaterial(THRIFT_WIND);
    for (let i = 0; i < 3; i++) {
      const g = thriftGeo(rng);
      this.thrift.push(
        new InstancedSet(
          `thrift${i}`,
          [
            { geometry: g.leaves, material: this.thriftLeafMat, depthMaterial: tDepth, castShadow: false },
            { geometry: g.heads, material: this.thriftHeadMat, depthMaterial: tDepth, castShadow: false },
          ],
          this.pool,
        ),
      );
    }
    const lowWind = { mode: 'height' as const, height: 0.35, amplitude: 0.04, flutter: 0.3 };
    const hollyLeaf = plantMaterial('seaHolly', lowWind, { roughness: 0.6 });
    const hollyHead = plantMaterial('seaHollyHead', lowWind, { roughness: 0.55 });
    const peaLeaf = plantMaterial('beachPea', lowWind, { roughness: 0.75 });
    const peaFlower = plantMaterial('beachPeaFlower', lowWind, { roughness: 0.6 });
    const sedgeMat = plantMaterial('duneSedge', MARRAM_WIND, { roughness: 0.85 });
    const lDepth = windDepthMaterial(lowWind);
    for (let i = 0; i < 1; i++) {
      const h = hollyGeo(rng);
      this.holly.push(new InstancedSet(`holly${i}`, [{ geometry: h.leaves, material: hollyLeaf, depthMaterial: lDepth, castShadow: false }, { geometry: h.heads, material: hollyHead, depthMaterial: lDepth, castShadow: false }], this.pool));
      const p = peaGeo(rng);
      this.pea.push(new InstancedSet(`pea${i}`, [{ geometry: p.leaves, material: peaLeaf, depthMaterial: lDepth, castShadow: false }, { geometry: p.heads, material: peaFlower, depthMaterial: lDepth, castShadow: false }], this.pool));
      this.sedge.push(new InstancedSet(`sedge${i}`, [{ geometry: sedgeGeo(rng), material: sedgeMat, depthMaterial: mDepth, tinted: true, castShadow: false }], this.pool));
    }
    const { bark, leaf } = pineMaterials();
    const dT = windDepthMaterial(PINE_TRUNK);
    const dL = windDepthMaterial(PINE_LEAF);
    for (let i = 0; i < 3; i++) {
      const g = bentPineGeo(rng);
      this.pines.push(
        new InstancedSet(
          `bentPine${i}`,
          [
            { geometry: g.trunk, material: bark, depthMaterial: dT },
            { geometry: g.leaves, material: leaf, depthMaterial: dL, tinted: true },
          ],
          this.pool,
        ),
      );
    }
  }

  private m(x: number, y: number, z: number, s: number, ry: number): THREE.Matrix4 {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s * (0.85 + this.rng.next() * 0.3), s));
  }

  addMarram(x: number, y: number, z: number, s = 1): void {
    const v = 0.85 + this.rng.next() * 0.3;
    this.rng.pick(this.marram).add(this.m(x, y - 0.03, z, s, this.rng.next() * 6.28), new THREE.Color(v, v, v * (0.9 + this.rng.next() * 0.15)));
  }

  addThrift(x: number, y: number, z: number, s = 1): void {
    this.rng.pick(this.thrift).add(this.m(x, y - 0.02, z, s, this.rng.next() * 6.28));
  }

  addHolly(x: number, y: number, z: number, s = 1): void {
    this.rng.pick(this.holly).add(this.m(x, y - 0.02, z, s, this.rng.next() * 6.28));
  }

  addPea(x: number, y: number, z: number, s = 1): void {
    this.rng.pick(this.pea).add(this.m(x, y - 0.02, z, s, this.rng.next() * 6.28));
  }

  addSedge(x: number, y: number, z: number, s = 1): void {
    const v = 0.85 + this.rng.next() * 0.3;
    this.rng.pick(this.sedge).add(this.m(x, y - 0.02, z, s, this.rng.next() * 6.28), new THREE.Color(v, v, v));
  }

  /** `lean` = yaw of the lean (0 = leaning towards -Z / inland). */
  addPine(x: number, y: number, z: number, s = 1, lean = 0): void {
    const v = 0.85 + this.rng.next() * 0.25;
    this.rng.pick(this.pines).add(this.m(x, y - 0.1, z, s, lean + (this.rng.next() - 0.5) * 0.5), new THREE.Color(v, v, v));
  }

  setSeason(season: Season): void {
    const c = season === 'fall' ? 0xf0d6a0 : season === 'winter' ? 0xd8d8cc : season === 'summer' ? 0xf4f0d8 : 0xffffff;
    this.marramMat.color.setHex(c);
    this.thriftHeadMat.color.setHex(season === 'winter' ? 0x8a7a70 : season === 'fall' ? 0xc8a090 : 0xffffff);
    this.thriftLeafMat.color.setHex(season === 'winter' ? 0xb8b8a8 : 0xffffff);
    for (const t of this.thrift) t.setVisible(true);
  }
}
