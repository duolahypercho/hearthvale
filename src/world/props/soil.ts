/**
 * Tilled soil beds. Every tilled tile is a lofted mound: three rounded furrow ridges (~4 cm) run
 * along X over a low base, and wherever the tile borders untilled ground the mound rolls down a
 * ~30° shoulder and sinks into the turf, with a lip of torn sod clods (grass side up, roots
 * showing) flipped over by the hoe. Neighbouring tiles share ridges, so rows merge into beds.
 *
 * Wetness is a sub-tile mask (4×4 texels per tile) sampled in world space by ONE soil material:
 * watering floods outward from the pour point over ~0.35 s (radial front + noise-warped edge),
 * dry soil ≈ #6b4a32 darkens to ≈ #3a2618 and turns glossier. Fertilized tiles get a sprinkle
 * of granules. Winter: the beds settle, snow lies on the ridges and frozen husks poke through.
 *
 *   const soil = new SoilBeds(w, d);  root.add(soil.group);
 *   soil.set(x, z, y, { wet, mask, animate }) / soil.clear(x, z) / soil.setWet(x, z, wet, fade, from)
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
import { globalUniforms } from '../../render/uniforms';
import { lumpySphere } from '../geom';

/** Ridge crest height above the pad origin. */
export const SOIL_HEIGHT = 0.075;
/** Pads sit slightly above the tile-centre ground height so gentle slopes never poke through. */
export const SOIL_LIFT = 0.02;
/** Base of the mound (furrow troughs) above the pad origin; ridges add RIDGE on top. */
const BASE = 0.035;
const RIDGE = 0.04;
/** Wet-mask texels per tile edge. */
const WR = 4;

const ridgeAt = (z: number): number => Math.pow(Math.sin((z + 0.5) * Math.PI * 3), 2);

/** Sample positions across [-0.5, 0.5]: coarse inside, dense on open (sloping) edges. */
function samples(openLo: boolean, openHi: boolean, inner: number): number[] {
  const out = new Set<number>();
  for (let i = 0; i <= inner; i++) out.add(-0.5 + i / inner);
  const edge = [0, 0.035, 0.075, 0.12, 0.19];
  if (openLo) for (const e of edge) out.add(-0.5 + e);
  if (openHi) for (const e of edge) out.add(0.5 - e);
  return [...out].map((v) => Math.round(v * 1e4) / 1e4).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1]! > 1e-3);
}

function padGeometry(mask: number, variant: number): THREE.BufferGeometry {
  const rng = new Rng(`soil:${mask}:${variant}`);
  const noise = new Noise2D(rng.int(0, 1e6));
  const open = { n: !(mask & 1), e: !(mask & 2), s: !(mask & 4), w: !(mask & 8) };
  /** 0 on an open rim → 1 once past the shoulder. */
  const shoulder = (x: number, z: number): number => {
    const jn = noise.get(x * 3.1 + 7, z * 3.1) * 0.035;
    let f = 1;
    const ramp = (d: number): number => THREE.MathUtils.smoothstep(d + jn, 0.015, 0.17);
    if (open.w) f *= ramp(x + 0.5);
    if (open.e) f *= ramp(0.5 - x);
    if (open.n) f *= ramp(z + 0.5);
    if (open.s) f *= ramp(0.5 - z);
    return f;
  };
  const hAt = (x: number, z: number): number => {
    const f = shoulder(x, z);
    const ridge = ridgeAt(z) * (0.85 + 0.15 * noise.get(x * 2.3, z * 5 + 3));
    const bumps = noise.get(x * 9, z * 9) * 0.006 + noise.get(x * 23 + 5, z * 23) * 0.003;
    return f * (BASE + RIDGE * ridge + bumps) - 0.032 * (1 - f);
  };
  const xs = samples(open.w, open.e, 4);
  const zs = samples(open.n, open.s, 12);
  const nx = xs.length;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  for (const z of zs) {
    for (const x of xs) {
      const y = hAt(x, z);
      pos.push(x, y, z);
      uv.push(x + 0.5, z + 0.5);
      const f = shoulder(x, z);
      const r = ridgeAt(z);
      // AO: dark in the troughs and where the shoulder meets the turf; crests catch light.
      const ao = (0.72 + 0.28 * (r * f + (1 - f) * 0.4)) * (0.6 + 0.4 * THREE.MathUtils.smoothstep(f, 0, 0.8)) * (0.94 + 0.06 * noise.get(x * 31, z * 31));
      col.push(ao, ao * 0.98, ao * 0.96);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g = g.toNonIndexed();
  // Clods: small lumps resting on the crests.
  const clods: THREE.BufferGeometry[] = [g];
  const nClods = 3 + rng.int(0, 2);
  for (let k = 0; k < nClods; k++) {
    const x = (rng.next() - 0.5) * 0.72;
    const z = (rng.next() - 0.5) * 0.72;
    const r = 0.016 + rng.next() * 0.024;
    const c = new THREE.IcosahedronGeometry(r, 0);
    c.scale(1, 0.65, 1);
    c.translate(x, hAt(x, z) + r * 0.2, z);
    clods.push(withAttrs(c, x + 0.5, z + 0.5 + 0.04, 0.7 + rng.next() * 0.45));
  }
  return mergeSimple(clods);
}

function withAttrs(geo: THREE.BufferGeometry, u: number, v: number, tone: number | ((p: THREE.Vector3, n: THREE.Vector3) => [number, number, number])): THREE.BufferGeometry {
  const cg = geo.index ? geo.toNonIndexed() : geo;
  if (!cg.attributes.normal) cg.computeVertexNormals();
  if (cg.attributes.uv) cg.deleteAttribute('uv');
  const n = cg.attributes.position!.count;
  const cu = new Float32Array(n * 2);
  const cc = new Float32Array(n * 3);
  const p = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    cu[i * 2] = u;
    cu[i * 2 + 1] = v;
    if (typeof tone === 'number') cc[i * 3] = cc[i * 3 + 1] = cc[i * 3 + 2] = tone;
    else {
      const c = tone(p.fromBufferAttribute(cg.attributes.position as THREE.BufferAttribute, i), nn.fromBufferAttribute(cg.attributes.normal as THREE.BufferAttribute, i));
      cc.set(c, i * 3);
    }
  }
  cg.setAttribute('uv', new THREE.BufferAttribute(cu, 2));
  cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return cg;
}

/**
 * Torn sod along the open edges: chunks of turf the hoe flipped over — grass on top, dark roots
 * and soil on the sides, tilted outward against the mound's shoulder, a few with blades sticking up.
 */
function sodGeometry(mask: number, variant: number): THREE.BufferGeometry | null {
  const open = [!(mask & 1), !(mask & 2), !(mask & 4), !(mask & 8)];
  if (!open.some(Boolean)) return null;
  const rng = new Rng(`sod:${mask}:${variant}`);
  const parts: THREE.BufferGeometry[] = [];
  const grass = new THREE.Color(0x5f8f38);
  const grassL = new THREE.Color(0x8ab452);
  const root = new THREE.Color(0x4a3222);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  // side: 0 N (z=-0.5, outward -Z), 1 E (+X), 2 S (+Z), 3 W (-X)
  for (let s = 0; s < 4; s++) {
    if (!open[s]) continue;
    const n = 3 + rng.int(0, 1);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.3 + rng.next() * 0.4) / n - 0.5; // along the edge
      const out = -0.47 + rng.next() * 0.05; // near the rim
      const w = 0.06 + rng.next() * 0.05;
      const g = lumpySphere(1, 0, 0.25, rng, 2.4);
      g.scale(w, 0.024 + rng.next() * 0.012, w * (0.7 + rng.next() * 0.4));
      const tint = 0.85 + rng.next() * 0.3;
      const blade = rng.next();
      let gg = withAttrs(g, 0, 0, (p, nn) => {
        const top = THREE.MathUtils.smoothstep(nn.y, 0.1, 0.6);
        const c = root.clone().lerp(grass.clone().lerp(grassL, blade * 0.6), top).multiplyScalar(tint * (0.75 + 0.25 * top));
        return [c.r, c.g, c.b];
      });
      // Tilted outward (flipped by the blade), resting on the shoulder.
      e.set((rng.next() - 0.5) * 0.5, rng.next() * Math.PI * 2, 0.25 + rng.next() * 0.45);
      q.setFromEuler(e);
      const local = new THREE.Vector3(out, -SOIL_LIFT + 0.012 + rng.next() * 0.01, t * 0.94);
      // rotate the local (x = outward, z = along) frame to the side
      const ang = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][s]!;
      const side = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      local.applyQuaternion(side);
      m.compose(local, side.clone().multiply(q), new THREE.Vector3(1, 1, 1));
      gg.applyMatrix4(m);
      parts.push(gg);
      // A few grass blades sticking out of the chunk.
      if (blade > 0.55) {
        for (let b = 0; b < 2; b++) {
          const h = 0.05 + rng.next() * 0.05;
          const bl = new THREE.BufferGeometry();
          bl.setAttribute('position', new THREE.Float32BufferAttribute([-0.006, 0, 0, 0.006, 0, 0, (rng.next() - 0.5) * 0.03, h, (rng.next() - 0.5) * 0.02], 3));
          bl.computeVertexNormals();
          gg = withAttrs(bl, 0, 0, (p) => {
            const c = grass.clone().lerp(grassL, p.y / h);
            return [c.r, c.g, c.b];
          });
          const bp = local.clone().add(new THREE.Vector3((rng.next() - 0.5) * 0.05, 0.01, (rng.next() - 0.5) * 0.05));
          gg.applyMatrix4(new THREE.Matrix4().compose(bp, new THREE.Quaternion().setFromEuler(new THREE.Euler((rng.next() - 0.5) * 0.8, rng.next() * 6.28, (rng.next() - 0.5) * 0.8)), new THREE.Vector3(1, 1, 1)));
          parts.push(gg);
        }
      }
    }
  }
  return mergeSimple(parts);
}

/** A sprinkle of fertilizer granules on the ridges (tinted per instance). */
function granuleGeometry(): THREE.BufferGeometry {
  const rng = new Rng('fert');
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 26; k++) {
    const x = (rng.next() - 0.5) * 0.76;
    const z = (rng.next() - 0.5) * 0.76;
    const r = 0.007 + rng.next() * 0.006;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.translate(x, BASE + RIDGE * ridgeAt(z) + r * 0.4, z);
    parts.push(withAttrs(g, 0, 0, 0.85 + rng.next() * 0.3));
  }
  return mergeSimple(parts);
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
let sodMat: THREE.MeshStandardMaterial | null = null;
let granMat: THREE.MeshStandardMaterial | null = null;
/** Per-texel wetness (R8, WR×WR texels per tile), shared by the soil material. */
const uWetMask = { value: null as THREE.DataTexture | null };
const uWetSize = { value: new THREE.Vector2(64, 64) };

function soilMaterial(): THREE.MeshStandardMaterial {
  if (!soilMat) {
    const d = textures.soil();
    soilMat = new THREE.MeshStandardMaterial({ map: d.map, bumpMap: d.bump, bumpScale: 2.5, roughness: 0.95, vertexColors: true, color: 0xe8d4c4 });
    soilMat.name = 'soil';
    // Snow only on the furrow ridges (+ noise), full snow on the low rim so the pad melts into the field.
    const ridge = '(pow(sin(fract(vHvWorldPos.z) * 9.4248), 2.0))';
    const snowMask = `clamp(max(smoothstep(0.34, 0.6, ${ridge} * 0.45 + hvNoise(vHvWorldPos.xz * 2.1) * 0.45 + hvNoise(vHvWorldPos.xz * 6.3 + 3.0) * 0.3 - 0.04), 1.0 - smoothstep(0.004, 0.05 + hvNoise(vHvWorldPos.xz * 5.0) * 0.03, vSoilH)), 0.0, 1.0)`;
    applyWorldFx(soilMat, { snowUp: 0.2, snowMask });
    patchMaterial(soilMat, 'soil-wet', (shader) => {
      shader.uniforms.uWetMask = uWetMask;
      shader.uniforms.uWetSize = uWetSize;
      shader.uniforms.uSnowSink = globalUniforms.uSnow;
      let vs = shader.vertexShader;
      vs = before(vs, 'void main() {', 'varying float vSoilH;\nuniform float uSnowSink;');
      // Under snow the beds settle: 60 % lower, so they read as soft mounds in the snowfield.
      vs = after(vs, '#include <begin_vertex>', 'vSoilH = position.y;\ntransformed.y *= 1.0 - 0.6 * smoothstep(0.3, 1.0, uSnowSink);');
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = before(fs, 'void main() {', `varying float vSoilH;\nuniform sampler2D uWetMask;\nuniform vec2 uWetSize;\n${NOISE_GLSL}`);
      fs = after(
        fs,
        '#include <color_fragment>',
        /* glsl */ `
        float hvSoilWet;
        {
          vec2 wq = vHvWorldPos.xz;
          float wm = texture2D(uWetMask, wq / uWetSize).r;
          // Noise-edged front: the wet patch meanders instead of following the tile grid.
          float we = (hvNoise(wq * 5.1) - 0.5) * 0.22 + (hvNoise(wq * 13.3 + 4.0) - 0.5) * 0.1;
          hvSoilWet = smoothstep(0.34, 0.6, wm + we);
          // Damp halo just outside the watered area.
          float halo = smoothstep(0.1, 0.4, wm + we) * (1.0 - hvSoilWet);
          // dry ≈ #6b4a32 → wet ≈ #3a2618 (linear ratio ≈ 0.29), a touch cooler.
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.34, 0.3, 0.28), hvSoilWet);
          diffuseColor.rgb *= 1.0 - halo * 0.2;
        }`,
      );
      fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, 0.46, hvSoilWet);');
      shader.fragmentShader = fs;
    });
  }
  return soilMat;
}

function sodMaterial(): THREE.MeshStandardMaterial {
  if (!sodMat) {
    sodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
    sodMat.name = 'sod';
    applyWorldFx(sodMat, { snowUp: 0.35 });
    // Fall: the turf lips go olive-straw with the lawn.
    patchMaterial(sodMat, 'sod-season', (shader) => {
      shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
      shader.fragmentShader = before(shader.fragmentShader, 'void main() {', 'uniform vec4 uSeasonW;');
      shader.fragmentShader = after(shader.fragmentShader, '#include <color_fragment>', 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.35, 1.05, 0.55), uSeasonW.z * 0.55);');
    });
  }
  return sodMat;
}

function granuleMaterial(): THREE.MeshStandardMaterial {
  if (!granMat) {
    granMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    granMat.name = 'fert';
    applyWorldFx(granMat, { snowUp: 0.2 });
  }
  return granMat;
}

let huskMat: THREE.MeshStandardMaterial | null = null;
/** Frozen crop husks: only exist in winter (scaled to nothing otherwise, no season plumbing). */
function huskMaterial(): THREE.MeshStandardMaterial {
  if (!huskMat) {
    huskMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    huskMat.name = 'husk';
    applyWorldFx(huskMat, { snowUp: 0.75 });
    patchMaterial(huskMat, 'husk-winter', (shader) => {
      shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
      shader.vertexShader = before(shader.vertexShader, 'void main() {', 'uniform vec4 uSeasonW;');
      shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', 'transformed *= smoothstep(0.5, 0.9, uSeasonW.w);');
    });
  }
  return huskMat;
}

function huskGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(`husk:${variant}`);
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry => {
    const gg = g.index ? g.toNonIndexed() : g;
    const pos = gg.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const c = fn(p.fromBufferAttribute(pos, i));
      col.set([c.r, c.g, c.b], i * 3);
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
    gg.computeVertexNormals();
    return gg;
  };
  const base = new THREE.Color(0x6e5840);
  const tip = new THREE.Color(0xb49a72);
  const n = 3 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const h = 0.22 + rng.next() * 0.28;
    const g = new THREE.CylinderGeometry(0.008, 0.016, h, 4);
    g.translate(0, h / 2, 0);
    g.rotateZ((rng.next() - 0.5) * 0.7);
    g.rotateY(rng.next() * Math.PI * 2);
    g.translate((rng.next() - 0.5) * 0.35, 0, (rng.next() - 0.5) * 0.35);
    parts.push(paint(g, (p) => base.clone().lerp(tip, THREE.MathUtils.clamp(p.y / h, 0, 1))));
    if (rng.next() < 0.7) {
      // A broken, papery leaf hanging off the stalk.
      const leaf = new THREE.PlaneGeometry(0.05, 0.2, 1, 2);
      const lp = leaf.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < lp.count; k++) lp.setZ(k, Math.pow(lp.getY(k) + 0.1, 2) * 0.8);
      leaf.translate(0, -0.1, 0);
      leaf.rotateX(0.5 + rng.next() * 0.6);
      leaf.rotateY(rng.next() * Math.PI * 2);
      leaf.translate((rng.next() - 0.5) * 0.3, h * 0.7, (rng.next() - 0.5) * 0.3);
      parts.push(paint(leaf, () => new THREE.Color(0x9a8260).multiplyScalar(0.85 + rng.next() * 0.3)));
    }
  }
  return mergeSimple(parts);
}

interface Flood {
  /** Pour point in tile-local [0,1]². */
  cx: number;
  cz: number;
  t: number;
}

export class SoilBeds {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('soil');
  private sets = new Map<string, InstancedSet>();
  private tiles = new Map<string, { set: InstancedSet; id: number; y: number; husk?: { set: InstancedSet; id: number }; fert?: number }>();
  private anims = new Map<string, { t: number; x: number; z: number; y: number; delay: number; amp: number }>();
  /** Tile wet state (0 / 1) — the target of the texel mask. */
  private wetTile: Uint8Array;
  private floods = new Map<number, Flood>();
  private drying = new Map<number, number>();
  private huskSets: InstancedSet[] = [];
  private fertSet: InstancedSet | null = null;
  private fertIds = new Map<string, number>();
  private wetData: Uint8Array;
  private wetTex: THREE.DataTexture;
  private tw: number;

  constructor(readonly width = 64, readonly depth = 64) {
    this.group.name = 'soil';
    this.group.userData.perfTag = 'soil';
    this.group.add(this.pool.group);
    this.tw = width * WR;
    this.wetTile = new Uint8Array(width * depth);
    this.wetData = new Uint8Array(width * WR * depth * WR);
    this.wetTex = new THREE.DataTexture(this.wetData, width * WR, depth * WR, THREE.RedFormat, THREE.UnsignedByteType);
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
      const parts = [{ geometry: padGeometry(mask, variant), material: soilMaterial(), tinted: true, castShadow: false }];
      const sod = sodGeometry(mask, variant);
      if (sod) parts.push({ geometry: sod, material: sodMaterial(), tinted: false, castShadow: false });
      s = new InstancedSet(`soil-${key}`, parts, this.pool);
      this.sets.set(key, s);
    }
    return s;
  }

  private fillTile(x: number, z: number, v: number): void {
    for (let j = 0; j < WR; j++) {
      const row = (z * WR + j) * this.tw + x * WR;
      for (let i = 0; i < WR; i++) this.wetData[row + i] = v;
    }
    this.wetTex.needsUpdate = true;
  }

  /** Is the tile (visually) wet or getting wet? */
  isWet(x: number, z: number): boolean {
    return this.wetTile[z * this.width + x] === 1;
  }

  /**
   * Mark a tile watered / dry (visual only). `fade`: watering floods outward from `from` (world
   * point, default tile centre) over ~0.35 s; drying fades over ~0.7 s. Otherwise it snaps.
   */
  setWet(x: number, z: number, wet: boolean, fade = false, from?: { x: number; z: number }): void {
    if (x < 0 || z < 0 || x >= this.width || z >= this.depth) return;
    const i = z * this.width + x;
    const was = this.wetTile[i] === 1;
    this.wetTile[i] = wet ? 1 : 0;
    if (!fade) {
      this.floods.delete(i);
      this.drying.delete(i);
      this.fillTile(x, z, wet ? 255 : 0);
      return;
    }
    if (wet && !was) {
      this.drying.delete(i);
      const cx = from ? THREE.MathUtils.clamp(from.x - x, 0.1, 0.9) : 0.5;
      const cz = from ? THREE.MathUtils.clamp(from.z - z, 0.1, 0.9) : 0.5;
      this.floods.set(i, { cx, cz, t: 0 });
    } else if (!wet && was) {
      this.floods.delete(i);
      this.drying.set(i, 1);
    }
  }

  set(x: number, z: number, y: number, opts: { wet: boolean; mask: number; animate?: boolean; fert?: number }): void {
    const k = `${x},${z}`;
    const prev = this.tiles.get(k);
    const i = z * this.width + x;
    const pending = this.floods.has(i);
    this.clear(x, z, true);
    if (!opts.wet) this.setWet(x, z, false);
    else if (!pending && !this.isWet(x, z)) this.setWet(x, z, true);
    const h = (x * 73856093) ^ (z * 19349663);
    const variant = Math.abs(h) % 3;
    const set = this.setFor(opts.mask, variant);
    const m = new THREE.Matrix4().makeTranslation(x + 0.5, y + SOIL_LIFT, z + 0.5);
    const j = ((Math.abs(h >> 4) % 100) / 100 - 0.5) * 0.08;
    const c = new THREE.Color(1 + j, 1 + j * 0.8, 1 + j * 0.6);
    let husk: { set: InstancedSet; id: number } | undefined;
    if (Math.abs(h >> 9) % 100 < 45) {
      if (!this.huskSets.length) for (let v = 0; v < 3; v++) this.huskSets.push(new InstancedSet(`husk-${v}`, [{ geometry: huskGeometry(v), material: huskMaterial(), castShadow: true }], this.pool));
      const hs = this.huskSets[Math.abs(h >> 13) % 3]!;
      const hm = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, y + SOIL_LIFT + 0.02, z + 0.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.abs(h >> 5) % 628) / 100), new THREE.Vector3(1, 1, 1));
      husk = { set: hs, id: hs.add(hm) };
    }
    const tile = { set, id: set.add(m, c), husk, y, fert: prev?.fert ?? opts.fert };
    this.tiles.set(k, tile);
    if (tile.fert) this.setFert(x, z, tile.fert);
    // Freshly hoed: the pad heaves up out of the ground with a little overshoot.
    if (opts.animate) this.anims.set(k, { t: 0, x, z, y, delay: 0, amp: 1 });
    else if (prev && this.anims.has(k)) this.anims.set(k, { ...this.anims.get(k)!, y });
  }

  /** Fertilizer granules on a tilled tile (tier 1 / 2 tint; 0 removes). */
  setFert(x: number, z: number, tier: number, tint = tier >= 2 ? 0x8fd0c0 : 0xe6dcc4): void {
    const k = `${x},${z}`;
    const t = this.tiles.get(k);
    const old = this.fertIds.get(k);
    if (old !== undefined) {
      this.fertSet?.remove(old);
      this.fertIds.delete(k);
    }
    if (!t) return;
    t.fert = tier || undefined;
    if (!tier) return;
    if (!this.fertSet) this.fertSet = new InstancedSet('fert', [{ geometry: granuleGeometry(), material: granuleMaterial(), tinted: true, castShadow: false }], this.pool);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, t.y + SOIL_LIFT, z + 0.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (((x * 7 + z * 13) % 4) * Math.PI) / 2), new THREE.Vector3(1, 1, 1));
    this.fertIds.set(k, this.fertSet.add(m, new THREE.Color(tint)));
  }

  /** A slam / impact heave on an existing pad (staggered by `delay`). */
  heave(x: number, z: number, delay = 0, amp = 0.6): void {
    const k = `${x},${z}`;
    const t = this.tiles.get(k);
    if (t) this.anims.set(k, { t: -delay, x, z, y: t.y, delay, amp });
  }

  clear(x: number, z: number, keepWet = false): void {
    if (!keepWet) this.setWet(x, z, false);
    const k = `${x},${z}`;
    const t = this.tiles.get(k);
    if (!t) return;
    t.set.remove(t.id);
    if (t.husk) t.husk.set.remove(t.husk.id);
    const f = this.fertIds.get(k);
    if (f !== undefined) {
      this.fertSet?.remove(f);
      this.fertIds.delete(k);
    }
    this.tiles.delete(k);
  }

  /** Animate till heaves + wetness floods / drying. Call every frame. */
  tick(dt: number): void {
    if (this.floods.size) {
      for (const [i, f] of this.floods) {
        f.t += dt;
        const x = i % this.width;
        const z = Math.floor(i / this.width);
        // Radial front from the pour point: reaches the far corner in ~0.35 s.
        const R = (f.t / 0.35) * 1.15;
        for (let jj = 0; jj < WR; jj++) {
          const row = (z * WR + jj) * this.tw + x * WR;
          for (let ii = 0; ii < WR; ii++) {
            const d = Math.hypot((ii + 0.5) / WR - f.cx, (jj + 0.5) / WR - f.cz);
            const v = Math.round(THREE.MathUtils.clamp((R - d) / 0.3, 0, 1) * 255);
            if (v > this.wetData[row + ii]!) this.wetData[row + ii] = v;
          }
        }
        if (f.t >= 0.5) {
          this.floods.delete(i);
          this.fillTile(x, z, 255);
        }
      }
      this.wetTex.needsUpdate = true;
    }
    if (this.drying.size) {
      for (const [i, k0] of this.drying) {
        const k = Math.max(0, k0 - dt / 0.7);
        const x = i % this.width;
        const z = Math.floor(i / this.width);
        this.fillTile(x, z, Math.round(k * 255));
        if (k <= 0) this.drying.delete(i);
        else this.drying.set(i, k);
      }
    }
    if (!this.anims.size) return;
    const m = new THREE.Matrix4();
    for (const [k, a] of this.anims) {
      a.t += dt;
      if (a.t < 0) continue;
      const tile = this.tiles.get(k);
      if (!tile) {
        this.anims.delete(k);
        continue;
      }
      let sy: number;
      let sxz: number;
      let dy = 0;
      let done: boolean;
      if (a.amp >= 1) {
        const t = Math.min(1, a.t / 0.32);
        // Rise with an overshoot (easeOutBack), plus a sideways squash that settles.
        const c1 = 2.2;
        const e = 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        sy = Math.max(0.05, e);
        sxz = 1 + (1 - t) * 0.06 * Math.sin(t * Math.PI);
        dy = -(1 - Math.min(1, e)) * 0.02;
        done = t >= 1;
      } else {
        // Slam heave: the pad is punched down, then springs back with a wobble.
        const t = a.t;
        const osc = Math.exp(-t * 9) * Math.cos(t * 26);
        sy = 1 - osc * 0.35 * a.amp;
        sxz = 1 + osc * 0.05 * a.amp;
        done = t > 0.45;
      }
      m.makeScale(sxz, sy, sxz).setPosition(a.x + 0.5, tile.y + SOIL_LIFT + dy, a.z + 0.5);
      tile.set.setMatrix(tile.id, m);
      if (done) {
        m.makeTranslation(a.x + 0.5, tile.y + SOIL_LIFT, a.z + 0.5);
        tile.set.setMatrix(tile.id, m);
        this.anims.delete(k);
      }
    }
  }

  has(x: number, z: number): boolean {
    return this.tiles.has(`${x},${z}`);
  }
}
