/**
 * Tilled soil beds: every tilled tile gets a raised, rounded soil pad with three shallow
 * furrows and a few clods. The pad only slopes down on sides that border untilled ground,
 * so neighbouring tiles merge into continuous beds with a soft, slightly irregular rim.
 * Wetness is a per-tile mask texture sampled in world space by ONE soil material: bilinear
 * between tile centres + a quarter-tile smoothstep + noise-warped edge, so watered ground bleeds
 * softly into dry ground (no checkerboard) and gets darker and glossier (roughness 0.96 → 0.5).
 *
 *   const soil = new SoilBeds();  root.add(soil.group);
 *   soil.set(x, z, y, { wet: true, mask }) / soil.clear(x, z)
 * `mask` bits: 1 = north (z-1) tilled, 2 = east (x+1), 4 = south (z+1), 8 = west (x-1).
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';
import { textures } from '../../render/textures';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { NOISE_GLSL } from '../../render/shaders/noise';
import { BatchPool, InstancedSet } from './instanced';

export const SOIL_HEIGHT = 0.075;
/** Pads sit slightly above the tile-centre ground height so gentle slopes never poke through. */
export const SOIL_LIFT = 0.035;

function padGeometry(mask: number, variant: number): THREE.BufferGeometry {
  const N = 12;
  const rng = new Rng(`soil:${mask}:${variant}`);
  const noise = new Noise2D(rng.int(0, 1e6));
  const open = { n: !(mask & 1), e: !(mask & 2), s: !(mask & 4), w: !(mask & 8) };
  const ext = 0.5;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const hAt = (x: number, z: number): number => {
    const jn = noise.get(x * 3.1 + 7, z * 3.1) * 0.06;
    let f = 1;
    if (open.w) f *= THREE.MathUtils.smoothstep(x, -0.5 + jn, -0.3 + jn);
    if (open.e) f *= 1 - THREE.MathUtils.smoothstep(x, 0.3 - jn, 0.5 - jn);
    if (open.n) f *= THREE.MathUtils.smoothstep(z, -0.5 + jn, -0.3 + jn);
    if (open.s) f *= 1 - THREE.MathUtils.smoothstep(z, 0.3 - jn, 0.5 - jn);
    const v = z + 0.5;
    const furrow = Math.sin(v * Math.PI * 2 * 3) * 0.014;
    const bumps = noise.get(x * 9, z * 9) * 0.008;
    return f * (SOIL_HEIGHT + furrow + bumps) - 0.045 * (1 - f);
  };
  const vert = (x: number, z: number): void => {
    const y = hAt(x, z);
    pos.push(x, y, z);
    uv.push(x + 0.5, z + 0.5);
    const v = z + 0.5;
    const ridge = Math.sin(v * Math.PI * 2 * 3) * 0.5 + 0.5;
    const edge = THREE.MathUtils.clamp(y / SOIL_HEIGHT, 0, 1);
    const ao = (0.78 + 0.22 * ridge) * (0.72 + 0.28 * edge);
    col.push(ao, ao, ao);
  };
  // Furrows run along X, so X needs far fewer samples than Z (the rim is handled by the edge rows).
  const NX = 7;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < NX; i++) {
      const x0 = -ext + (i / NX) * 2 * ext;
      const x1 = -ext + ((i + 1) / NX) * 2 * ext;
      const z0 = -ext + (j / N) * 2 * ext;
      const z1 = -ext + ((j + 1) / N) * 2 * ext;
      vert(x0, z0);
      vert(x0, z1);
      vert(x1, z1);
      vert(x0, z0);
      vert(x1, z1);
      vert(x1, z0);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Clods: small lumps resting on the ridges.
  const clods: THREE.BufferGeometry[] = [g];
  const nClods = 4 + rng.int(0, 4);
  for (let k = 0; k < nClods; k++) {
    const x = (rng.next() - 0.5) * 0.8;
    const z = (rng.next() - 0.5) * 0.8;
    const r = 0.022 + rng.next() * 0.03;
    const c = new THREE.IcosahedronGeometry(r, 0);
    c.scale(1, 0.65, 1);
    c.translate(x, hAt(x, z) + r * 0.25, z);
    const cg = c.index ? c.toNonIndexed() : c;
    cg.deleteAttribute('uv');
    const n = cg.attributes.position!.count;
    const cu = new Float32Array(n * 2);
    const cc = new Float32Array(n * 3);
    const tone = 0.7 + rng.next() * 0.45;
    for (let i = 0; i < n; i++) {
      cu[i * 2] = x + 0.5;
      cu[i * 2 + 1] = z + 0.5 + 0.04;
      cc[i * 3] = cc[i * 3 + 1] = cc[i * 3 + 2] = tone;
    }
    cg.setAttribute('uv', new THREE.BufferAttribute(cu, 2));
    cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    clods.push(cg);
  }
  g = mergeSimple(clods);
  return g;
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const attrs = ['position', 'normal', 'uv', 'color'] as const;
  const out = new THREE.BufferGeometry();
  for (const a of attrs) {
    const size = list[0]!.attributes[a]!.itemSize;
    const total = list.reduce((s, g) => s + g.attributes[a]!.count * size, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of list) {
      arr.set(g.attributes[a]!.array as Float32Array, o);
      o += g.attributes[a]!.count * size;
    }
    out.setAttribute(a, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

let soilMat: THREE.MeshStandardMaterial | null = null;
/** Per-tile wetness (R8, 1 texel per tile), shared by the soil material. */
const uWetMask = { value: null as THREE.DataTexture | null };
const uWetSize = { value: new THREE.Vector2(64, 64) };

function soilMaterial(): THREE.MeshStandardMaterial {
  if (!soilMat) {
    const d = textures.soil();
    soilMat = new THREE.MeshStandardMaterial({ map: d.map, bumpMap: d.bump, bumpScale: 2.5, roughness: 0.96, vertexColors: true, color: 0xf2e6dc });
    soilMat.name = 'soil';
    applyWorldFx(soilMat, { snowUp: 0.2 });
    patchMaterial(soilMat, 'soil-wet', (shader) => {
      shader.uniforms.uWetMask = uWetMask;
      shader.uniforms.uWetSize = uWetSize;
      let fs = shader.fragmentShader;
      fs = before(fs, 'void main() {', `uniform sampler2D uWetMask;\nuniform vec2 uWetSize;\n${NOISE_GLSL}`);
      fs = after(
        fs,
        '#include <color_fragment>',
        /* glsl */ `
        float hvSoilWet;
        {
          vec2 wq = vHvWorldPos.xz;
          float wm = texture2D(uWetMask, wq / uWetSize).r;
          // Noise-edged border: the wet front meanders instead of following the tile grid.
          float we = (hvNoise(wq * 3.1) - 0.5) * 0.34 + (hvNoise(wq * 9.3 + 4.0) - 0.5) * 0.12;
          hvSoilWet = smoothstep(0.375, 0.625, wm + we);
          // Damp halo just outside the watered area.
          float halo = smoothstep(0.12, 0.45, wm + we) * (1.0 - hvSoilWet);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.364, 0.322, 0.302), hvSoilWet);
          diffuseColor.rgb *= 1.0 - halo * 0.22;
        }`,
      );
      fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, 0.5, hvSoilWet);');
      shader.fragmentShader = fs;
    });
  }
  return soilMat;
}

export class SoilBeds {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('soil');
  private sets = new Map<string, InstancedSet>();
  private tiles = new Map<string, { set: InstancedSet; id: number }>();
  private wetData: Uint8Array;
  private wetTex: THREE.DataTexture;

  constructor(readonly width = 64, readonly depth = 64) {
    this.group.name = 'soil';
    this.group.add(this.pool.group);
    this.wetData = new Uint8Array(width * depth);
    this.wetTex = new THREE.DataTexture(this.wetData, width, depth, THREE.RedFormat, THREE.UnsignedByteType);
    this.wetTex.magFilter = THREE.LinearFilter;
    this.wetTex.minFilter = THREE.LinearFilter;
    this.wetTex.needsUpdate = true;
    uWetMask.value = this.wetTex;
    uWetSize.value.set(width, depth);
  }

  private setFor(mask: number, variant: number): InstancedSet {
    const key = `${mask}:${variant}`;
    let s = this.sets.get(key);
    if (!s) {
      const geo = padGeometry(mask, variant);
      s = new InstancedSet(`soil-${key}`, [{ geometry: geo, material: soilMaterial(), tinted: true, castShadow: false }], this.pool);
      this.sets.set(key, s);
    }
    return s;
  }

  /** Mark a tile watered / dry in the wetness mask (visual only). */
  setWet(x: number, z: number, wet: boolean): void {
    if (x < 0 || z < 0 || x >= this.width || z >= this.depth) return;
    const v = wet ? 255 : 0;
    const i = z * this.width + x;
    if (this.wetData[i] === v) return;
    this.wetData[i] = v;
    this.wetTex.needsUpdate = true;
  }

  set(x: number, z: number, y: number, opts: { wet: boolean; mask: number }): void {
    this.clear(x, z);
    this.setWet(x, z, opts.wet);
    const h = (x * 73856093) ^ (z * 19349663);
    const variant = Math.abs(h) % 3;
    const set = this.setFor(opts.mask, variant);
    const m = new THREE.Matrix4().makeTranslation(x + 0.5, y + SOIL_LIFT, z + 0.5);
    const j = ((Math.abs(h >> 4) % 100) / 100 - 0.5) * 0.08;
    const c = new THREE.Color(1 + j, 1 + j * 0.8, 1 + j * 0.6);
    this.tiles.set(`${x},${z}`, { set, id: set.add(m, c) });
  }

  clear(x: number, z: number): void {
    this.setWet(x, z, false);
    const t = this.tiles.get(`${x},${z}`);
    if (!t) return;
    t.set.remove(t.id);
    this.tiles.delete(`${x},${z}`);
  }

  has(x: number, z: number): boolean {
    return this.tiles.has(`${x},${z}`);
  }
}
