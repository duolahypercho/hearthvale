/**
 * Flora builders for the Nature instanced sets: weeds (3 kinds), ferns, tall meadow grass, bushes
 * (seasonal palette, optional berries), flowers (tinted petals), reeds, lily pads, mushrooms,
 * winter dead stalks, and the low ground-cover layer (clover, daisies, buttercups) that fills
 * the lawn between debris. Shared plant materials live in FloraMaterials (one per Nature).
 */
import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import type { Season } from '../../core/time';
import { MeshBuilder, lumpySphere, sphericalNormals, uvScale, mat, smoothNormals } from '../geom';
import { globalUniforms } from '../../render/uniforms';
import { patchMaterial, after, before } from '../../render/patch';
import { materials } from '../../render/materials';
import { textures } from '../../render/textures';
import { applyWind, windDepthMaterial, type WindOptions } from '../../render/wind';
import { applyWorldFx } from '../../render/worldfx';
import type { InstancedPart } from './instanced';

/** Three bush tones per season; each bush picks one per ~3-tile cluster (+ jitter). */
const BUSH_PALETTE: Record<Season, [number, number, number]> = {
  spring: [0x6fb543, 0x5ea63d, 0x84c24f],
  summer: [0x4a9136, 0x3e822f, 0x5c9e3a],
  fall: [0xe07a2a, 0xc0412c, 0xd2a236],
  winter: [0x6c7c62, 0x7a8769, 0x63725d],
};
const WEED_COLORS: Record<Season, number> = { spring: 0xffffff, summer: 0xe8ffe0, fall: 0xf0d09a, winter: 0xa89878 };
const _lin = (h: number): THREE.Color => new THREE.Color().setHex(h);

/** Per-instance origin varying for batched/instanced plant shaders. */
export function addOriginVarying(shader: THREE.WebGLProgramParametersWithUniforms): void {
  if (shader.vertexShader.includes('vHvOrigin')) return;
  shader.vertexShader = before(shader.vertexShader, 'void main() {', 'varying vec3 vHvOrigin;');
  shader.vertexShader = after(
    shader.vertexShader,
    '#include <begin_vertex>',
    `{ mat4 hvMo = modelMatrix;
    #ifdef USE_INSTANCING
      hvMo = modelMatrix * instanceMatrix;
    #endif
    #ifdef USE_BATCHING
      hvMo = modelMatrix * batchingMatrix;
    #endif
    vHvOrigin = (hvMo * vec4(0.0, 0.0, 0.0, 1.0)).xyz; }`,
  );
  shader.fragmentShader = before(shader.fragmentShader, 'void main() {', 'varying vec3 vHvOrigin;');
}

export function vcolor(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const c = fn(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A single curved leaf blade (for weeds/ferns/reeds). */
export function leafBlade(len: number, width: number, bend: number, segs = 4): THREE.BufferGeometry {
  const pos: number[] = [];
  const pts: [number, number, number][] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) * (1 - t * 0.3);
    const y = Math.sin(t * Math.PI * 0.5) * len * (1 - bend * 0.4);
    const z = t * t * bend * len;
    pts.push([w, y, z]);
  }
  for (let s = 0; s < segs; s++) {
    const [w0, y0, z0] = pts[s]!;
    const [w1, y1, z1] = pts[s + 1]!;
    pos.push(-w0, y0, z0, w0, y0, z0, -w1, y1, z1);
    pos.push(w0, y0, z0, w1, y1, z1, -w1, y1, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // soften: bias normals upward so leaves read as volume
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) {
    const n = new THREE.Vector3().fromBufferAttribute(nor, i).lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

export function plantMaterial(name: string, wind: WindOptions, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, ...extra });
  m.name = name;
  applyWorldFx(m, { snowUp: 0.6 });
  applyWind(m, wind);
  // Two-sided leaves: light both sides with the (up-biased) front normal so back faces never
  // go black, plus a small ambient floor so dense rosettes keep their form at night.
  patchMaterial(m, 'plant-lighting', (shader) => {
    shader.fragmentShader = after(shader.fragmentShader, '#include <normal_fragment_begin>', 'normal = normalize(vNormal);');
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      'totalEmissiveRadiance += diffuseColor.rgb * 0.045;',
    );
  });
  return m;
}

export class FloraMaterials {
  private bushMat: THREE.MeshStandardMaterial | null = null;
  private weedMat: THREE.MeshStandardMaterial | null = null;
  private bushPal = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  bush(): THREE.MeshStandardMaterial {
    if (!this.bushMat) {
      const t = textures.leaves();
      this.bushMat = new THREE.MeshStandardMaterial({ bumpMap: t.bump, bumpScale: 1.2, vertexColors: true, roughness: 0.8, color: 0xffffff });
      this.bushMat.name = 'bush';
      applyWorldFx(this.bushMat, { snowUp: 0.55 });
      applyWind(this.bushMat, { mode: 'height', height: 1.2, amplitude: 0.05, flutter: 0.6 });
      const pal = this.bushPal;
      this.setBushPalette('spring');
      patchMaterial(this.bushMat, 'bush-palette', (shader) => {
        addOriginVarying(shader);
        shader.uniforms.uBushA = { value: pal[0] };
        shader.uniforms.uBushB = { value: pal[1] };
        shader.uniforms.uBushC = { value: pal[2] };
        shader.uniforms.uSunDir = globalUniforms.uSunDir;
        shader.uniforms.uSunColor = globalUniforms.uSunColor;
        let fs = shader.fragmentShader;
        fs = before(fs, 'void main() {', 'uniform vec3 uBushA;\nuniform vec3 uBushB;\nuniform vec3 uBushC;');
        fs = after(
          fs,
          '#include <color_fragment>',
          /* glsl */ `
          {
            float hc = hvHash12(floor(vHvOrigin.xz * 0.34) + 17.0);
            float hj = hvHash12(floor(vHvOrigin.xz * 7.3));
            vec3 pal = hc < 0.34 ? uBushA : (hc < 0.67 ? uBushB : uBushC);
            pal *= vec3(0.92 + 0.16 * hj, 0.93 + 0.12 * fract(hj * 7.1), 0.92 + 0.14 * fract(hj * 3.7));
            diffuseColor.rgb *= pal;
            vec3 fp = vHvWorldPos * 3.1;
            float clump = hvNoise(fp.xz + fp.y * 0.7) * 0.6 + hvNoise(fp.zy * 1.9 + 3.0) * 0.4;
            diffuseColor.rgb *= 0.8 + 0.36 * smoothstep(0.2, 0.8, clump);
            float top = smoothstep(0.2, 0.95, normalize(vHvWorldNormal).y);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.08, 0.86), top * 0.45);
          }`,
        );
        fs = after(
          fs,
          '#include <emissivemap_fragment>',
          /* glsl */ `
          {
            vec3 Vw = normalize(cameraPosition - vHvWorldPos);
            float back = pow(max(dot(-Vw, normalize(uSunDir)), 0.0), 3.0);
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * 0.35;
          }`,
        );
        shader.fragmentShader = fs;
      });
    }
    return this.bushMat;
  }
  setBushPalette(season: Season): void {
    BUSH_PALETTE[season].forEach((h, i) => this.bushPal[i]!.copy(_lin(h)));
  }
  private _dead: THREE.MeshStandardMaterial | null = null;
  dead(): THREE.MeshStandardMaterial {
    if (!this._dead) this._dead = plantMaterial('deadTwig', { height: 0.4, amplitude: 0.05, flutter: 0.2 });
    return this._dead;
  }
  weed(): THREE.MeshStandardMaterial {
    if (!this.weedMat) this.weedMat = plantMaterial('weed', { height: 0.5, amplitude: 0.1, flutter: 0.6 });
    return this.weedMat;
  }
  private _stem: THREE.MeshStandardMaterial | null = null;
  stem(): THREE.MeshStandardMaterial {
    if (!this._stem) this._stem = plantMaterial('flowerStem', { height: 0.7, amplitude: 0.1, flutter: 0.5 });
    return this._stem;
  }
  private _petal: THREE.MeshStandardMaterial | null = null;
  petal(): THREE.MeshStandardMaterial {
    if (!this._petal) {
      this._petal = plantMaterial('flowerPetal', { height: 0.7, amplitude: 0.1, flutter: 0.5 }, { roughness: 0.6 });
      // Fall swaps the spring palette for mums & asters (rust, amber, gold, plum, cream).
      patchMaterial(this._petal, 'petal-season', (shader) => {
        addOriginVarying(shader);
        shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
        let fs = before(shader.fragmentShader, 'void main() {', 'uniform vec4 uSeasonW;');
        fs = after(
          fs,
          '#include <color_fragment>',
          /* glsl */ `
          {
            float hf = hvHash12(floor(vHvOrigin.xz * 1.7) + 3.0);
            vec3 mum = hf < 0.24 ? vec3(0.55, 0.09, 0.05) : hf < 0.46 ? vec3(0.8, 0.28, 0.04) : hf < 0.68 ? vec3(0.85, 0.55, 0.08) : hf < 0.86 ? vec3(0.3, 0.12, 0.45) : vec3(0.85, 0.75, 0.55);
            float lum = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
            diffuseColor.rgb = mix(diffuseColor.rgb, mum * (0.75 + 0.3 * lum), uSeasonW.z);
          }`,
        );
        shader.fragmentShader = fs;
      });
    }
    return this._petal;
  }
  private _reed: THREE.MeshStandardMaterial | null = null;
  reed(): THREE.MeshStandardMaterial {
    if (!this._reed) this._reed = plantMaterial('reed', { height: 1.3, amplitude: 0.12, flutter: 0.4 });
    return this._reed;
  }

  setSeason(season: Season): void {
    this.setBushPalette(season);
    this.weedMat?.color.setHex(WEED_COLORS[season]);
  }
}

export type FloraKind = 'deadTwig' | 'tallGrass' | 'weed' | 'fern' | 'bush' | 'berryBush' | 'flower' | 'tallFlower' | 'reed' | 'lilypad' | 'mushroom' | GroundCoverKind;
/** Low, non-clearable lawn cover (shares the weed batch: no extra draw calls, no shadow pass). */
export type GroundCoverKind = 'clover' | 'daisy' | 'buttercup';

/** Trifoliate clover leaf (3 notched lobes) lying almost flat, facing +Y. */
function cloverLeaf(size: number, col: THREE.Color, r: Rng): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.CircleGeometry(size, 6);
    g.scale(1, 0.85, 1);
    g.translate(size * 0.95, 0, 0);
    g.rotateZ((k / 3) * Math.PI * 2 + r.next() * 0.2);
    g.rotateX(-Math.PI / 2 + 0.25);
    vcolor(g, (p) => col.clone().multiplyScalar(0.8 + 0.35 * Math.min(1, Math.hypot(p.x, p.z) / (size * 2))));
    out.push(g);
  }
  return out;
}

/** Flat radial flower head: n petals around a domed centre. */
function flowerHead(b: MeshBuilder, m: THREE.Material, x: number, y: number, z: number, petal: number, n: number, pc: THREE.Color, cc: THREE.Color, r: Rng, tilt = 0.2): void {
  for (let k = 0; k < n; k++) {
    const g = new THREE.CircleGeometry(petal, 4);
    g.scale(1, 0.38, 1);
    g.translate(petal * 0.95, 0, 0);
    g.rotateX(-Math.PI / 2);
    g.rotateY((k / n) * Math.PI * 2);
    vcolor(g, (p) => pc.clone().multiplyScalar(0.82 + 0.25 * Math.min(1, Math.hypot(p.x, p.z) / (petal * 1.9))));
    b.add(m, g, mat(x, y, z, tilt * (r.next() - 0.5), 0, tilt * (r.next() - 0.5)));
  }
  const c = new THREE.IcosahedronGeometry(petal * 0.42, 0);
  c.scale(1, 0.55, 1);
  vcolor(c, () => cc);
  b.add(m, c, mat(x, y + 0.008, z));
}

export function buildGroundCover(kind: GroundCoverKind, r: Rng, variant: number, mats: FloraMaterials): InstancedPart[] {
  const b = new MeshBuilder();
  const m = mats.weed();
  const stemC = new THREE.Color(0x5a8a34);
  switch (kind) {
    case 'clover': {
      // A spreading clover patch: 7-9 trifoliate leaves + a couple of white/pink pom heads.
      const leafC = new THREE.Color(variant === 1 ? 0x4f8c2c : 0x5f9a36);
      const n = 7 + r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const d = Math.sqrt(r.next()) * 0.24;
        const y = 0.025 + r.next() * 0.05;
        for (const g of cloverLeaf(0.042 + r.next() * 0.012, leafC.clone().offsetHSL((r.next() - 0.5) * 0.03, 0, (r.next() - 0.5) * 0.06), r)) b.add(m, g, mat(Math.cos(a) * d, y, Math.sin(a) * d, 0, r.next() * 6, 0));
      }
      const heads = variant === 2 ? 0 : 1 + r.int(0, 1);
      for (let i = 0; i < heads; i++) {
        const a = r.next() * Math.PI * 2;
        const d = r.next() * 0.16;
        const h = 0.1 + r.next() * 0.05;
        const st = new THREE.CylinderGeometry(0.005, 0.007, h, 3);
        st.translate(0, h / 2, 0);
        vcolor(st, () => stemC);
        b.add(m, st, mat(Math.cos(a) * d, 0, Math.sin(a) * d));
        const hd = new THREE.IcosahedronGeometry(0.034, 0);
        hd.scale(1, 1.1, 1);
        const pink = r.next() < 0.35;
        vcolor(hd, (p) => new THREE.Color(pink ? 0xf2b8cc : 0xf4f1e6).multiplyScalar(0.8 + 0.25 * (p.y / 0.04 + 0.5)));
        b.add(m, hd, mat(Math.cos(a) * d, h + 0.02, Math.sin(a) * d));
      }
      break;
    }
    case 'daisy': {
      // 3-4 lawn daisies on short stems over a flat leaf rosette.
      const n = 3 + r.int(0, 1);
      for (let i = 0; i < 5; i++) {
        const g = leafBlade(0.1, 0.035, 0.9, 2);
        vcolor(g, () => new THREE.Color(0x4c8a2e));
        b.add(m, g, mat(0, 0.01, 0, 0.3, (i / 5) * Math.PI * 2, 0));
      }
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.next();
        const d = 0.05 + r.next() * 0.12;
        const h = 0.08 + r.next() * 0.08;
        const st = new THREE.CylinderGeometry(0.005, 0.007, h, 3);
        st.translate(0, h / 2, 0);
        vcolor(st, () => stemC);
        b.add(m, st, mat(Math.cos(a) * d, 0, Math.sin(a) * d));
        const pc = variant === 1 && i === 0 ? new THREE.Color(0xf6c6d6) : new THREE.Color(0xfbfaf4);
        flowerHead(b, m, Math.cos(a) * d, h, Math.sin(a) * d, 0.034, 7, pc, new THREE.Color(0xf2bf26), r);
      }
      break;
    }
    case 'buttercup': {
      // Buttercups / violets: tiny glossy cups a hand above the grass.
      const violet = variant === 1;
      const pc = new THREE.Color(violet ? 0x9a72d8 : 0xffd12a);
      const n = 4 + r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const d = Math.sqrt(r.next()) * 0.18;
        const h = 0.1 + r.next() * 0.1;
        const st = new THREE.CylinderGeometry(0.005, 0.007, h, 3);
        st.translate(0, h / 2, 0);
        vcolor(st, () => stemC);
        b.add(m, st, mat(Math.cos(a) * d, 0, Math.sin(a) * d, (r.next() - 0.5) * 0.3, 0, (r.next() - 0.5) * 0.3));
        flowerHead(b, m, Math.cos(a) * d, h, Math.sin(a) * d, 0.026, 5, pc, new THREE.Color(violet ? 0xf5e08a : 0xffa21a), r, 0.5);
      }
      const lf = leafBlade(0.09, 0.03, 0.8, 2);
      vcolor(lf, () => new THREE.Color(0x4f8a30));
      for (let i = 0; i < 3; i++) b.add(m, lf.clone(), mat(0, 0.01, 0, 0.3, r.next() * 6, 0));
      break;
    }
  }
  return [{ geometry: b.geometries().get(m)!, material: m, castShadow: false }];
}

export function buildFlora(kind: FloraKind, r: Rng, variant: number, lod: number, mats: FloraMaterials): InstancedPart[] {
  const detail = lod ? 1 : 2;
  switch (kind) {
    case 'deadTwig': {
      // Winter stand-in for weeds: a few bare, frost-tipped stalks poking out of the snow.
      const b = new MeshBuilder();
      const m = mats.dead();
      const n = 5 + r.int(0, 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.next();
        const len = 0.22 + r.next() * 0.22;
        const g = new THREE.CylinderGeometry(0.006, 0.014, len, 4);
        g.translate(0, len / 2, 0);
        vcolor(g, (p) => new THREE.Color(0x6b5a44).lerp(new THREE.Color(0xc9b996), THREE.MathUtils.smoothstep(p.y, 0, len)));
        b.add(m, g, mat(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, 0.35 + r.next() * 0.35, -a + Math.PI / 2, 0));
        if (r.next() < 0.6) {
          const s2 = new THREE.SphereGeometry(0.022, 5, 4);
          vcolor(s2, () => new THREE.Color(0xd8c9a0));
          b.add(m, s2, mat(Math.cos(a) * (0.04 + len * 0.3), len * 0.92, Math.sin(a) * (0.04 + len * 0.3)));
        }
      }
      return [{ geometry: b.geometries().get(m)!, material: m, castShadow: true }];
    }
    case 'tallGrass': {
      // Unmown meadow clump: long arching blades, a few seed plumes. Scythe-able.
      const b = new MeshBuilder();
      const m = mats.weed();
      const n = 13 + r.int(0, 4);
      const dark = new THREE.Color(0x2f5a1c);
      const light = new THREE.Color(0x9cc24e);
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const d = Math.sqrt(r.next()) * 0.22;
        const len = 0.5 + r.next() * 0.42;
        const g = leafBlade(len, 0.05, 0.35 + r.next() * 0.45, 3);
        vcolor(g, (p) => dark.clone().lerp(light, THREE.MathUtils.smoothstep(p.y, 0, len * 0.9)));
        b.add(m, g, mat(Math.cos(a) * d, 0, Math.sin(a) * d, -0.05, a + Math.PI / 2 + (r.next() - 0.5), 0));
      }
      for (let i = 0; i < 3 + r.int(0, 2); i++) {
        const a = r.next() * Math.PI * 2;
        const h = 0.7 + r.next() * 0.3;
        const stem = new THREE.CylinderGeometry(0.006, 0.009, h, 4);
        stem.translate(0, h / 2, 0);
        vcolor(stem, () => new THREE.Color(0x8aa04a));
        const lean = (r.next() - 0.5) * 0.4;
        b.add(m, stem, mat(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08, lean, a, 0));
        const plume = new THREE.CylinderGeometry(0.012, 0.024, 0.16, 4);
        vcolor(plume, () => new THREE.Color(0xd8c98a));
        b.add(m, plume, mat(Math.cos(a) * 0.08 + Math.sin(lean) * 0.0, h + 0.05, Math.sin(a) * 0.08 + Math.sin(lean) * h * 0.9, lean, a, 0));
      }
      // No shadow pass: dozens of clumps on screen; baked ground AO + GTAO-free blades read fine.
      return [{ geometry: b.geometries().get(m)!, material: m, castShadow: false }];
    }
    case 'weed':
    case 'fern': {
      const fern = kind === 'fern';
      const b = new MeshBuilder();
      const wm = mats.weed();
      if (!fern && variant === 1) {
        // Broadleaf dock: wide oval leaves on reddish stalks + a rusty seed spike.
        const n = 6 + r.int(0, 2);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r.next() * 0.4;
          const g = leafBlade(0.34 + r.next() * 0.12, 0.2, 0.55 + r.next() * 0.3, 5);
          vcolor(g, (p) => new THREE.Color(0x3a6a22).lerp(new THREE.Color(0x7fae44), THREE.MathUtils.smoothstep(p.y, 0, 0.3)).lerp(new THREE.Color(0x8a3a2a), Math.max(0, 0.35 - p.z * 2)));
          b.add(wm, g, mat(0, 0, 0, -0.1, a, 0));
        }
        const spike = new THREE.CylinderGeometry(0.008, 0.012, 0.5, 4);
        spike.translate(0, 0.25, 0);
        vcolor(spike, () => new THREE.Color(0x7a4a2a));
        b.add(wm, spike, mat(0.02, 0, 0.01, 0.1, 0, 0));
        for (let k = 0; k < 5; k++) {
          const s = new THREE.SphereGeometry(0.022, 5, 3);
          vcolor(s, () => new THREE.Color(0xa0582e));
          b.add(wm, s, mat(0.02 + 0.03 * k * 0.1, 0.3 + k * 0.045, 0.01 + k * 0.004));
        }
      } else if (!fern && variant === 2) {
        // Dandelion: flat serrated rosette + yellow flowers / a seed clock.
        const n = 8 + r.int(0, 3);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r.next() * 0.3;
          const g = leafBlade(0.26 + r.next() * 0.08, 0.075, 0.95, 5);
          vcolor(g, (p) => new THREE.Color(0x3f7a26).lerp(new THREE.Color(0x86bb48), THREE.MathUtils.smoothstep(p.z, 0, 0.2)));
          b.add(wm, g, mat(0, 0.01, 0, 0.35, a, 0));
        }
        for (let k = 0; k < 2; k++) {
          const h = 0.2 + r.next() * 0.12;
          const a = r.next() * Math.PI * 2;
          const stem = new THREE.CylinderGeometry(0.008, 0.01, h, 4);
          stem.translate(0, h / 2, 0);
          vcolor(stem, () => new THREE.Color(0x6a9a3a));
          b.add(wm, stem, mat(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05));
          const head = new THREE.SphereGeometry(k === 0 ? 0.05 : 0.055, 8, 5);
          if (k === 0) head.scale(1, 0.55, 1);
          vcolor(head, () => new THREE.Color(k === 0 ? 0xffc81e : 0xf4f2ea));
          b.add(wm, head, mat(Math.cos(a) * 0.05, h + 0.01, Math.sin(a) * 0.05));
        }
      } else {
        const n = fern ? 9 : 7 + r.int(0, 3);
        const dark = new THREE.Color(fern ? 0x2f6b2e : 0x3d6e22);
        const light = new THREE.Color(fern ? 0x7dbb4a : 0x8cc04a);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r.next() * 0.5;
          const g = leafBlade(fern ? 0.62 : 0.34 + r.next() * 0.2, fern ? 0.1 : 0.085, 0.5 + r.next() * 0.5);
          vcolor(g, (p) => dark.clone().lerp(light, THREE.MathUtils.smoothstep(p.y, 0, 0.35)));
          b.add(wm, g, mat(0, 0, 0, -0.15, a, 0));
        }
        if (!fern) {
          // tiny seed-heads
          for (let k = 0; k < 2; k++) {
            const s = new THREE.SphereGeometry(0.04, 6, 4);
            vcolor(s, () => new THREE.Color(0xe8e0a0));
            b.add(wm, s, mat(0.05 - k * 0.1, 0.42 - k * 0.08, 0.02 + k * 0.04));
          }
        }
      }
      const g = b.geometries().get(wm)!;
      // Ferns (few, big) cast; the hundreds of field weeds rely on baked ground AO instead.
      return [{ geometry: g, material: wm, depthMaterial: windDepthMaterial({ height: 0.5, amplitude: 0.1 }), castShadow: fern }];
    }
    case 'bush':
    case 'berryBush': {
      const b = new MeshBuilder();
      const m = mats.bush();
      const center = new THREE.Vector3(0, 0.45, 0);
      const n = 4 + r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.next();
        const rr = 0.25 + r.next() * 0.2;
        const g = lumpySphere(0.42 + r.next() * 0.16, detail, 0.22, r, 2.2);
        uvScale(g, 1.2);
        g.translate(Math.cos(a) * rr, 0.4 + r.next() * 0.25, Math.sin(a) * rr);
        sphericalNormals(g, center, 0.55);
        b.add(m, g, undefined, { aoWorld: (p) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(p.y, 0.0, 0.95) });
      }
      const top = lumpySphere(0.45, detail, 0.2, r, 2.2);
      uvScale(top, 1.2);
      top.translate(0, 0.75, 0);
      sphericalNormals(top, center, 0.55);
      b.add(m, top, undefined, { aoWorld: (p) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(p.y, 0.0, 0.95) });
      const parts: InstancedPart[] = [
        { geometry: b.geometries().get(m)!, material: m, depthMaterial: windDepthMaterial({ height: 1.2, amplitude: 0.05 }), castShadow: !lod },
      ];
      if (kind === 'berryBush') {
        const bb = new MeshBuilder();
        const bm = materials.get('white');
        for (let i = 0; i < 14; i++) {
          const dir = new THREE.Vector3(r.next() - 0.5, r.next() * 0.8, r.next() - 0.5).normalize();
          const p = center.clone().add(new THREE.Vector3(dir.x * 0.68, 0.1 + dir.y * 0.5, dir.z * 0.68));
          bb.add(bm, new THREE.SphereGeometry(0.055, 7, 5), mat(p.x, p.y, p.z));
        }
        parts.push({ geometry: bb.geometries().get(bm)!, material: bm, tinted: true, castShadow: false });
      }
      return parts;
    }
    case 'flower':
    case 'tallFlower': {
      const tall = kind === 'tallFlower';
      const stems = new MeshBuilder();
      const petals = new MeshBuilder();
      const sm = mats.stem();
      const pm = mats.petal();
      const heads = tall ? 1 : 3 + r.int(0, 2);
      for (let h = 0; h < heads; h++) {
        const a = r.next() * Math.PI * 2;
        const d = tall ? 0 : r.next() * 0.16;
        const hh = tall ? 0.7 + r.next() * 0.2 : 0.16 + r.next() * 0.14;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const stem = new THREE.CylinderGeometry(0.008, 0.012, hh, 4);
        vcolor(stem, () => new THREE.Color(0x4f8a2e));
        stems.add(sm, stem, mat(x, hh / 2, z));
        const leaf = leafBlade(tall ? 0.18 : 0.1, 0.035, 0.6, 3);
        vcolor(leaf, () => new THREE.Color(0x5a9a34));
        stems.add(sm, leaf, mat(x, 0, z, 0, r.next() * 6, 0));
        const np = tall ? 7 : 5;
        const ps = tall ? 0.075 : 0.045;
        const tilt = -0.3 + r.next() * 0.2;
        for (let k = 0; k < np; k++) {
          const pa = (k / np) * Math.PI * 2;
          const petal = new THREE.SphereGeometry(ps, 5, 3);
          petal.scale(1, 0.3, 0.55);
          petal.translate(ps * 0.9, 0, 0);
          petal.rotateY(pa);
          petal.rotateX(tilt);
          vcolor(petal, (p) => new THREE.Color(1, 1, 1).multiplyScalar(0.8 + 0.2 * THREE.MathUtils.clamp(Math.hypot(p.x, p.z) / (ps * 2), 0, 1)));
          petals.add(pm, petal, mat(x, hh, z));
        }
        const c = new THREE.SphereGeometry(ps * 0.5, 6, 4);
        vcolor(c, () => new THREE.Color(0xf2c230));
        stems.add(sm, c, mat(x, hh + 0.01, z, 0, 0, 0, 1, 0.6, 1));
      }
      return [
        { geometry: stems.geometries().get(sm)!, material: sm, castShadow: false },
        { geometry: petals.geometries().get(pm)!, material: pm, tinted: true, castShadow: false },
      ];
    }
    case 'reed': {
      const b = new MeshBuilder();
      const m = mats.reed();
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = r.next() * Math.PI * 2;
        const d = r.next() * 0.25;
        const len = 0.8 + r.next() * 0.6;
        const g = leafBlade(len, 0.035, 0.25 + r.next() * 0.3, 5);
        vcolor(g, (p) => new THREE.Color(0x3f6e2a).lerp(new THREE.Color(0x9cc05a), THREE.MathUtils.smoothstep(p.y, 0, len)));
        b.add(m, g, mat(Math.cos(a) * d, 0, Math.sin(a) * d, 0, r.next() * 6, 0));
        if (i < 3) {
          const hh = len * 0.9;
          const stalk = new THREE.CylinderGeometry(0.01, 0.012, hh, 4);
          vcolor(stalk, () => new THREE.Color(0x5b7a34));
          b.add(m, stalk, mat(Math.cos(a) * d, hh / 2, Math.sin(a) * d));
          const head = new THREE.CapsuleGeometry(0.035, 0.16, 3, 6);
          vcolor(head, () => new THREE.Color(0x6a4228));
          b.add(m, head, mat(Math.cos(a) * d, hh + 0.08, Math.sin(a) * d));
        }
      }
      return [{ geometry: b.geometries().get(m)!, material: m, depthMaterial: windDepthMaterial({ height: 1.3, amplitude: 0.12 }) }];
    }
    case 'lilypad': {
      const b = new MeshBuilder();
      const m = materials.get('white');
      const shape = new THREE.Shape();
      const R = 0.28 + r.next() * 0.1;
      shape.moveTo(0, 0);
      shape.absarc(0, 0, R, 0.25, Math.PI * 2 - 0.25, false);
      shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 18 });
      g.rotateX(-Math.PI / 2);
      {
        // Rim curls up a little (cupped pad), strongest away from the V-notch.
        const pp = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pp.count; i++) {
          const x = pp.getX(i);
          const z = pp.getZ(i);
          const rr = Math.hypot(x, z) / R;
          pp.setY(i, pp.getY(i) + Math.pow(rr, 3) * 0.05);
        }
        g.computeVertexNormals();
      }
      smoothNormals(g.index ? g.toNonIndexed() : g);
      vcolor(g, (p) => new THREE.Color(0x4f9a3a).multiplyScalar(0.8 + 0.3 * (Math.hypot(p.x, p.z) / R)).lerp(new THREE.Color(0xa8b85a), Math.max(0, Math.hypot(p.x, p.z) / R - 0.85) * 3));
      b.add(m, g);
      if (r.next() < 0.45) {
        for (let k = 0; k < 6; k++) {
          const petal = new THREE.SphereGeometry(0.05, 6, 4);
          petal.scale(1, 0.5, 0.45);
          petal.translate(0.05, 0.06, 0);
          petal.rotateZ(0.5);
          petal.rotateY((k / 6) * Math.PI * 2);
          vcolor(petal, () => new THREE.Color(0xffc6d8));
          b.add(m, petal, mat(0.04, 0.02, 0.03));
        }
      }
      return [{ geometry: b.geometries().get(m)!, material: m, castShadow: false }];
    }
    case 'mushroom': {
      const b = new MeshBuilder();
      const m = materials.get('white');
      for (let i = 0; i < 3; i++) {
        const h = 0.08 + r.next() * 0.08;
        const x = (r.next() - 0.5) * 0.25;
        const z = (r.next() - 0.5) * 0.25;
        const stem = new THREE.CylinderGeometry(0.02, 0.028, h, 6);
        vcolor(stem, () => new THREE.Color(0xf0e6d0));
        b.add(m, stem, mat(x, h / 2, z));
        const cap = new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, 0.7, 1);
        vcolor(cap, (p) => (Math.sin(p.x * 90) * Math.sin(p.z * 90) > 0.6 ? new THREE.Color(0xfff8f0) : new THREE.Color(0xc8482c)));
        b.add(m, cap, mat(x, h, z));
      }
      return [{ geometry: b.geometries().get(m)!, material: m }];
    }
    default:
      return buildGroundCover(kind, r, variant, mats);
  }
}
