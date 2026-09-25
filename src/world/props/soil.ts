/**
 * Tilled soil beds — worked earth, not slabs.
 *
 * Every tilled tile contributes a patch of ONE welded surface per 8×8-tile chunk. All heights are a
 * pure function of the world position (terrain height + a bed profile driven by a signed distance to
 * the bed's edge), so neighbouring tiles share their border vertices exactly: no seams, no steps,
 * no grass showing through. The profile:
 *   - furrow ridges run along X in WORLD space (three per metre), their phase warped and their height
 *     modulated by low-frequency noise plus two octaves of fine lumps — continuous across tiles, never
 *     the same twice;
 *   - within ~0.2 m of untilled ground the ridges flatten into a bevelled shoulder that rolls down to
 *     a low lip, then a ~0.2 m skirt beyond the tile edge sinks under the turf; the skirt fades into a
 *     paler, crumbly dirt fringe with a dithered, broken edge (so a bed melts into the grass);
 *   - clods sit on the crests, crumbs spill onto the skirt.
 * A per-tile RGBA "heave" texture (sampled bilinearly in the vertex shader, so animations stay
 * crack-free) drives the hoe's rise (a fresh tile appears from frame 1, ~40 % low, darker and moist,
 * and springs up with an overshoot) and the charged slam's punch-and-wobble.
 *
 * Wetness is a sub-tile mask (4×4 texels per tile) sampled in world space by the soil material:
 * watering floods outward from the pour point over ~0.35 s; dry soil is pale, warm and crazed with
 * hairline cracks, wet soil dark, cool and glossy. Fertilizer granules / winter husks are instanced.
 *
 *   const soil = new SoilBeds(w, d, heightAt);  root.add(soil.group);
 *   soil.set(x, z, y, { wet, animate }) / soil.clear(x, z) / soil.setWet(x, z, wet, fade, from)
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { textures } from '../../render/textures';
import { applyWorldFx } from '../../render/worldfx';
import { patchMaterial, after, before } from '../../render/patch';
import { NOISE_GLSL } from '../../render/shaders/noise';
import { BatchPool, InstancedSet } from './instanced';
import { globalUniforms } from '../../render/uniforms';

/** Ridge crest height above the terrain. */
export const SOIL_HEIGHT = 0.065;
/** Kept for callers: the beds now follow the terrain exactly (no pad lift). */
export const SOIL_LIFT = 0;
/** Furrow troughs above the terrain; ridges add RIDGE on top. */
const BASE = 0.03;
const RIDGE = 0.035;
/** Height of the bed's rim where it meets untilled ground (the bevel's foot). */
const LIP = 0.012;
/** Shoulder width inside the tile and skirt width outside it (m). */
const SH = 0.2;
const SK = 0.2;
/** Samples per tile (x across the furrows' length, z across the furrows) and skirt rows. */
const NX = 10;
const NZ = 18;
const SKN = 3;
/** Tiles per chunk edge (one welded mesh + one draw per chunk). */
const CH = 8;
/** Wet-mask texels per tile edge. */
const WR = 4;

// ─────────────────────────────────────────── noise (deterministic, world space)

function hash2(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Furrow coordinate: world z, gently wandering so rows never read as ruled lines. */
function furrowW(wx: number, wz: number): number {
  return wz + (vnoise(wx * 0.45 + 11.3, wz * 0.45) - 0.5) * 0.09 + (vnoise(wx * 1.7, wz * 1.7 + 5.1) - 0.5) * 0.03;
}

/** 0 in a trough → 1 on a crest (slightly sharpened crests, rounded troughs). */
function ridgeOf(w: number): number {
  const s = Math.sin(3 * Math.PI * w);
  return Math.pow(s * s, 0.8);
}

/** Crest height modulation (0.7..1.1) and fine lumps (2 octaves). */
function ampAt(wx: number, wz: number): number {
  return 0.7 + 0.4 * vnoise(wx * 1.3 + 3.7, wz * 0.9);
}
function lumpsAt(wx: number, wz: number): number {
  return (vnoise(wx * 7.1, wz * 7.1) - 0.5) * 0.011 + (vnoise(wx * 19.3 + 2, wz * 19.3) - 0.5) * 0.005;
}

// ─────────────────────────────────────────── materials

let soilMat: THREE.MeshStandardMaterial | null = null;
let granMat: THREE.MeshStandardMaterial | null = null;
/** Per-texel wetness (R8, WR×WR texels per tile), shared by the soil material. */
const uWetMask = { value: null as THREE.DataTexture | null };
const uWetSize = { value: new THREE.Vector2(64, 64) };
/** Per-tile heave (R: height scale / 2, G: freshness, B: y offset), one texel per tile. */
const uHeave = { value: null as THREE.DataTexture | null };

function soilMaterial(): THREE.MeshStandardMaterial {
  if (!soilMat) {
    const d = textures.soil();
    soilMat = new THREE.MeshStandardMaterial({ map: d.map, bumpMap: d.bump, bumpScale: 2.2, roughness: 0.95, vertexColors: true, color: 0xe8d4c4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    soilMat.name = 'soil';
    // Snow settles on the crests (+ noise) and fully on the low rim, so the bed melts into the field.
    const snowMask = `clamp(max(smoothstep(0.34, 0.6, smoothstep(0.045, 0.062, vSoilH) * 0.45 + hvNoise(vHvWorldPos.xz * 2.1) * 0.45 + hvNoise(vHvWorldPos.xz * 6.3 + 3.0) * 0.3 - 0.04), 1.0 - smoothstep(0.004, 0.03 + hvNoise(vHvWorldPos.xz * 5.0) * 0.02, vSoilH)), 0.0, 1.0)`;
    applyWorldFx(soilMat, { snowUp: 0.2, snowMask });
    patchMaterial(soilMat, 'soil-bed', (shader) => {
      shader.uniforms.uWetMask = uWetMask;
      shader.uniforms.uWetSize = uWetSize;
      shader.uniforms.uHeave = uHeave;
      shader.uniforms.uSnowSink = globalUniforms.uSnow;
      let vs = shader.vertexShader;
      vs = before(vs, 'void main() {', 'attribute vec4 soilA;\nvarying float vSoilH;\nvarying float vSoilEdge;\nvarying float vSoilFresh;\nuniform float uSnowSink;\nuniform sampler2D uHeave;\nuniform vec2 uWetSize;');
      vs = after(
        vs,
        '#include <begin_vertex>',
        /* glsl */ `
        {
          // Bilinear heave field (one texel per tile): animated tiles stay welded to their neighbours.
          vec4 hv = texture2D(uHeave, (modelMatrix * vec4(position, 1.0)).xz / uWetSize);
          float h = soilA.x;
          // Under snow the beds settle: 60 % lower, so they read as soft mounds in the snowfield.
          float nh = h * hv.r * 2.0 * (1.0 - 0.6 * smoothstep(0.3, 1.0, uSnowSink));
          transformed.y += nh - h + (hv.b - 0.5) * 0.08 * smoothstep(-0.01, 0.02, h);
          vSoilH = h;
          vSoilEdge = soilA.y;
          vSoilFresh = hv.g;
        }`,
      );
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = before(fs, 'void main() {', `varying float vSoilH;\nvarying float vSoilEdge;\nvarying float vSoilFresh;\nuniform sampler2D uWetMask;\nuniform vec2 uWetSize;\n${NOISE_GLSL}\n`);
      // Crumbly fringe: the outer skirt breaks up into dirt specks over the turf.
      fs = after(
        fs,
        'void main() {',
        /* glsl */ `
        if (vSoilEdge < 0.45) {
          float crumb = hvNoise(vHvWorldPos.xz * 26.0) * 0.65 + hvNoise(vHvWorldPos.xz * 7.0 + 3.0) * 0.35;
          if (crumb > vSoilEdge * 2.1 + 0.08) discard;
        }`,
      );
      fs = after(
        fs,
        '#include <color_fragment>',
        /* glsl */ `
        float hvSoilWet;
        {
          vec2 wq = vHvWorldPos.xz;
          float wm = texture2D(uWetMask, wq / uWetSize).r;
          // Noise-edged front: the wet patch meanders instead of following the tile grid.
          float na = hvNoise(wq * 5.1);
          float nb = hvNoise(wq * 13.3 + 4.0);
          float we = (na - 0.5) * 0.22 + (nb - 0.5) * 0.1;
          hvSoilWet = smoothstep(0.34, 0.6, wm + we);
          // Damp halo just outside the watered area.
          float halo = smoothstep(0.1, 0.4, wm + we) * (1.0 - hvSoilWet);
          vec3 base = diffuseColor.rgb;
          // Dry: pale, warm, a little dusty, the ridge crests sun-bleached, a fine crazing of hairline
          // cracks between lighter crusted plates.
          vec3 dry = base * vec3(2.02, 1.94, 1.78);
          float dl = dot(dry, vec3(0.3, 0.59, 0.11));
          dry = mix(vec3(dl), dry, 0.62);
          float crest = smoothstep(0.05, 0.066, vSoilH);
          dry *= 1.0 + crest * 0.1;
          float cw = min(abs(na - 0.5), abs(nb - 0.5) * 1.3);
          float crack = (1.0 - smoothstep(0.012, 0.04, cw)) * smoothstep(0.35, 0.65, hvNoise(wq * 1.7 + 3.0));
          float plate = smoothstep(0.06, 0.2, cw);
          dry *= (1.0 - crack * 0.16) * (1.0 + plate * 0.05);
          // Wet: dark, cooler, saturated; the texture's crumbs still read.
          vec3 wet = base * vec3(0.66, 0.6, 0.6);
          vec3 c = mix(dry, wet, hvSoilWet);
          c *= 1.0 - halo * 0.18;
          // Freshly turned earth: darker and moist for a moment after the hoe bites.
          c = mix(c, base * vec3(0.95, 0.86, 0.8), vSoilFresh * (1.0 - hvSoilWet) * 0.85);
          // The fringe dries out into pale, dusty dirt as it spills over the turf.
          float fr = 1.0 - smoothstep(0.35, 1.0, vSoilEdge);
          c = mix(c, vec3(0.5, 0.4, 0.29) * (0.85 + 0.3 * hvNoise(wq * 17.0)), fr * 0.55 * (1.0 - hvSoilWet * 0.6));
          diffuseColor.rgb = c;
        }`,
      );
      fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, 0.42, max(hvSoilWet, vSoilFresh * 0.5));');
      shader.fragmentShader = fs;
    });
  }
  return soilMat;
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

let huskDepth: THREE.MeshDepthMaterial | null = null;
/** Shadow-pass twin of the husk material: without the same season scale the (invisible) husks still
 *  cast twiggy shadows onto summer beds. */
function huskDepthMaterial(): THREE.MeshDepthMaterial {
  if (!huskDepth) {
    huskDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    huskDepth.name = 'husk-depth';
    patchMaterial(huskDepth, 'husk-winter-depth', (shader) => {
      shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
      shader.vertexShader = before(shader.vertexShader, 'void main() {', 'uniform vec4 uSeasonW;');
      shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', 'transformed *= smoothstep(0.5, 0.9, uSeasonW.w);');
    });
  }
  return huskDepth;
}

// ─────────────────────────────────────────── small instanced parts

function paintGeo(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
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
  if (!gg.attributes.normal) gg.computeVertexNormals();
  return gg;
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

/** A sprinkle of fertilizer granules nestled in the furrows (tinted per instance). */
function granuleGeometry(): THREE.BufferGeometry {
  const rng = new Rng('fert');
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 26; k++) {
    const x = (rng.next() - 0.5) * 0.76;
    const z = (rng.next() - 0.5) * 0.76;
    const r = 0.007 + rng.next() * 0.006;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.translate(x, r * 0.3, z);
    const tone = 0.85 + rng.next() * 0.3;
    parts.push(paintGeo(g, () => new THREE.Color(tone, tone, tone)));
  }
  return mergeSimple(parts);
}

function huskGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(`husk:${variant}`);
  const parts: THREE.BufferGeometry[] = [];
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
    parts.push(paintGeo(g, (p) => base.clone().lerp(tip, THREE.MathUtils.clamp(p.y / h, 0, 1))));
    if (rng.next() < 0.7) {
      const leaf = new THREE.PlaneGeometry(0.05, 0.2, 1, 2);
      const lp = leaf.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < lp.count; k++) lp.setZ(k, Math.pow(lp.getY(k) + 0.1, 2) * 0.8);
      leaf.translate(0, -0.1, 0);
      leaf.rotateX(0.5 + rng.next() * 0.6);
      leaf.rotateY(rng.next() * Math.PI * 2);
      leaf.translate((rng.next() - 0.5) * 0.3, h * 0.7, (rng.next() - 0.5) * 0.3);
      const t = 0.85 + rng.next() * 0.3;
      parts.push(paintGeo(leaf, () => new THREE.Color(0x9a8260).multiplyScalar(t)));
    }
  }
  return mergeSimple(parts);
}

/** A lumpy clod (indexed icosahedron, 20 tris), unit radius. */
const CLOD = (() => {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const merged = new THREE.BufferGeometry();
  // Weld the icosahedron so the lumps shade soft.
  const src = g.attributes.position as THREE.BufferAttribute;
  const verts: THREE.Vector3[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    p.fromBufferAttribute(src, i);
    let k = verts.findIndex((v) => v.distanceToSquared(p) < 1e-6);
    if (k < 0) {
      k = verts.length;
      verts.push(p.clone());
    }
    idx.push(k);
  }
  const r = new Rng('soil-clod');
  const pos: number[] = [];
  for (const v of verts) {
    const s = 0.8 + r.next() * 0.4;
    pos.push(v.x * s, v.y * s, v.z * s);
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setIndex(idx);
  merged.computeVertexNormals();
  return { pos: merged.attributes.position!.array as Float32Array, nrm: merged.attributes.normal!.array as Float32Array, idx: Uint16Array.from(idx) };
})();

// ─────────────────────────────────────────── per-tile surface patch

interface TileGeo {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  attr: Float32Array;
  idx: Uint32Array;
}

interface Flood {
  /** Pour point in tile-local [0,1]². */
  cx: number;
  cz: number;
  t: number;
}

interface HeaveAnim {
  t: number;
  x: number;
  z: number;
  /** 1 = fresh till (rise with overshoot, fades from dark); < 1 = slam punch (amplitude). */
  amp: number;
}

export class SoilBeds {
  readonly group = new THREE.Group();
  readonly pool = new BatchPool('soil');
  private tilled: Uint8Array;
  private tileGeo = new Map<number, TileGeo>();
  private chunks = new Map<number, THREE.Mesh>();
  private dirty = new Set<number>();
  private tiles = new Map<number, { y: number; husk?: { set: InstancedSet; id: number }; fert?: number }>();
  private anims = new Map<number, HeaveAnim>();
  /** Tile wet state (0 / 1) — the target of the texel mask. */
  private wetTile: Uint8Array;
  private floods = new Map<number, Flood>();
  private drying = new Map<number, number>();
  private huskSets: InstancedSet[] = [];
  private fertSet: InstancedSet | null = null;
  private fertIds = new Map<number, number>();
  private wetData: Uint8Array;
  private wetTex: THREE.DataTexture;
  private heaveData: Uint8Array;
  private heaveTex: THREE.DataTexture;
  private tw: number;
  private cw: number;

  constructor(readonly width = 64, readonly depth = 64, private heightAt: (x: number, z: number) => number = () => 0) {
    this.group.name = 'soil';
    this.group.userData.perfTag = 'soil';
    this.group.add(this.pool.group);
    this.tw = width * WR;
    this.cw = Math.ceil(width / CH);
    this.tilled = new Uint8Array(width * depth);
    this.wetTile = new Uint8Array(width * depth);
    this.wetData = new Uint8Array(width * WR * depth * WR);
    this.wetTex = new THREE.DataTexture(this.wetData, width * WR, depth * WR, THREE.RedFormat, THREE.UnsignedByteType);
    this.wetTex.magFilter = THREE.LinearFilter;
    this.wetTex.minFilter = THREE.LinearFilter;
    this.wetTex.needsUpdate = true;
    this.heaveData = new Uint8Array(width * depth * 4);
    for (let i = 0; i < width * depth; i++) this.heaveData.set([128, 0, 128, 255], i * 4);
    this.heaveTex = new THREE.DataTexture(this.heaveData, width, depth, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.heaveTex.magFilter = THREE.LinearFilter;
    this.heaveTex.minFilter = THREE.LinearFilter;
    this.heaveTex.needsUpdate = true;
    uWetMask.value = this.wetTex;
    uHeave.value = this.heaveTex;
    uWetSize.value.set(width, depth);
  }

  // ─────────────────────────── surface function

  private isT(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth && this.tilled[z * this.width + x] === 1;
  }

  /** Signed distance to the bed edge: + inside tilled ground, − outside (clamped to ±1). */
  private sd(wx: number, wz: number): number {
    const cx = Math.floor(wx);
    const cz = Math.floor(wz);
    const inside = this.isT(cx, cz);
    let best = 1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (this.isT(cx + dx, cz + dz) === inside) continue;
        const ex = Math.max(cx + dx - wx, 0, wx - (cx + dx + 1));
        const ez = Math.max(cz + dz - wz, 0, wz - (cz + dz + 1));
        const d = Math.hypot(ex, ez);
        if (d < best) best = d;
      }
    }
    return inside ? best : -best;
  }

  /** Bed profile above the terrain at a world point (+ the edge factor for the fringe). */
  private profile(wx: number, wz: number, s: number): number {
    const lumps = lumpsAt(wx, wz);
    if (s >= 0) {
      const f = smooth(0, SH, s);
      const r = ridgeOf(furrowW(wx, wz)) * ampAt(wx, wz);
      const mound = BASE + RIDGE * r * (0.3 + 0.7 * f);
      return LIP + (mound - LIP) * f + lumps * (0.5 + 0.5 * f);
    }
    const u = Math.min(1, -s / SK);
    const e = smooth(0, 1, u);
    return LIP * (1 - e) - 0.024 * e + (vnoise(wx * 6.3 + 9, wz * 6.3) - 0.5) * 0.014 * u + lumps * 0.5 * (1 - u);
  }

  private surfY(wx: number, wz: number): number {
    return this.heightAt(wx, wz) + this.profile(wx, wz, this.sd(wx, wz));
  }

  private genTile(x: number, z: number): TileGeo {
    const oW = !this.isT(x - 1, z);
    const oE = !this.isT(x + 1, z);
    const oN = !this.isT(x, z - 1);
    const oS = !this.isT(x, z + 1);
    const axis = (lo: boolean, hi: boolean, n: number): number[] => {
      const out: number[] = [];
      if (lo) for (let k = SKN; k >= 1; k--) out.push((-SK * k) / SKN);
      for (let i = 0; i <= n; i++) out.push(i / n);
      if (hi) for (let k = 1; k <= SKN; k++) out.push(1 + (SK * k) / SKN);
      return out;
    };
    const us = axis(oW, oE, NX);
    const vs = axis(oN, oS, NZ);
    // Corner skirts only where the diagonal cell is open ground too (else it's another bed's surface).
    const skipCorner = (u: number, v: number): boolean => {
      if (u < 0 && v < 0) return this.isT(x - 1, z - 1);
      if (u > 1 && v < 0) return this.isT(x + 1, z - 1);
      if (u < 0 && v > 1) return this.isT(x - 1, z + 1);
      if (u > 1 && v > 1) return this.isT(x + 1, z + 1);
      return false;
    };
    const nu = us.length;
    const nv = vs.length;
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const attr: number[] = [];
    const E = 0.02;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const wx = x + us[i]!;
        const wz = z + vs[j]!;
        const s = this.sd(wx, wz);
        const t = this.heightAt(wx, wz);
        const h = this.profile(wx, wz, s);
        pos.push(wx, t + h, wz);
        const dx = this.surfY(wx + E, wz) - this.surfY(wx - E, wz);
        const dz = this.surfY(wx, wz + E) - this.surfY(wx, wz - E);
        const l = Math.hypot(dx, 2 * E, dz);
        nrm.push(-dx / l, (2 * E) / l, -dz / l);
        const w = furrowW(wx, wz);
        uv.push(wx, w - 1 / 12);
        const f = s >= 0 ? smooth(0, SH, s) : 0;
        const edge = s >= 0 ? 1 : 1 - Math.min(1, -s / SK);
        const r = s >= 0 ? ridgeOf(w) : 0;
        // Vertex AO: troughs and the foot of the shoulder darker, crests catch the light.
        const n = 0.94 + 0.06 * vnoise(wx * 31, wz * 31);
        const ao = s >= 0 ? (0.74 + 0.26 * (r * f + (1 - f) * 0.45)) * (0.72 + 0.28 * f) * n : 0.72 * (0.9 + 0.1 * edge) * n;
        col.push(ao, ao * 0.98, ao * 0.96);
        attr.push(h, edge, 0, 0);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const cu = (us[i]! + us[i + 1]!) / 2;
        const cv = (vs[j]! + vs[j + 1]!) / 2;
        if (skipCorner(cu, cv)) continue;
        const a = j * nu + i;
        const b = a + 1;
        const c = a + nu;
        const d = c + 1;
        if ((i + j) % 2) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    // Clods on the crests + crumbs spilled over open edges.
    const rng = new Rng(`soil-clods:${x}:${z}`);
    const spots: [number, number, number][] = [];
    const nc = 3 + rng.int(0, 2);
    for (let k = 0; k < nc; k++) spots.push([0.1 + rng.next() * 0.8, 0.1 + rng.next() * 0.8, 0.014 + rng.next() * 0.02]);
    const spill = (open: boolean, fu: () => [number, number]): void => {
      if (!open) return;
      for (let k = 0; k < 2; k++) {
        const [u, v] = fu();
        spots.push([u, v, 0.008 + rng.next() * 0.01]);
      }
    };
    spill(oW, () => [-0.03 - rng.next() * 0.12, 0.1 + rng.next() * 0.8]);
    spill(oE, () => [1.03 + rng.next() * 0.12, 0.1 + rng.next() * 0.8]);
    spill(oN, () => [0.1 + rng.next() * 0.8, -0.03 - rng.next() * 0.12]);
    spill(oS, () => [0.1 + rng.next() * 0.8, 1.03 + rng.next() * 0.12]);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const [u, vv, r] of spots) {
      const wx = x + u;
      const wz = z + vv;
      const s = this.sd(wx, wz);
      const t = this.heightAt(wx, wz);
      const h = this.profile(wx, wz, s);
      q.setFromEuler(new THREE.Euler(rng.next() * 3, rng.next() * 6, rng.next() * 3));
      m.compose(v.set(wx, t + h + r * 0.25, wz), q, new THREE.Vector3(r, r * 0.62, r));
      nm.getNormalMatrix(m);
      const base = pos.length / 3;
      const tone = 0.72 + rng.next() * 0.38;
      const edge = s >= 0 ? 1 : 1 - Math.min(1, -s / SK);
      for (let k = 0; k < CLOD.pos.length; k += 3) {
        v.set(CLOD.pos[k]!, CLOD.pos[k + 1]!, CLOD.pos[k + 2]!).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        v.set(CLOD.nrm[k]!, CLOD.nrm[k + 1]!, CLOD.nrm[k + 2]!).applyMatrix3(nm).normalize();
        nrm.push(v.x, v.y, v.z);
        uv.push(wx + CLOD.pos[k]! * r, wz + CLOD.pos[k + 2]! * r);
        const ao = tone * (0.7 + 0.3 * Math.max(0, v.y));
        col.push(ao, ao * 0.97, ao * 0.94);
        // Clods count as crest height (they sit on top), and never fringe-dither away.
        attr.push(h + r * 0.4, Math.max(0.6, edge), 0, 0);
      }
      for (let k = 0; k < CLOD.idx.length; k++) idx.push(base + CLOD.idx[k]!);
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), col: new Float32Array(col), attr: new Float32Array(attr), idx: new Uint32Array(idx) };
  }

  private chunkOf(x: number, z: number): number {
    return Math.floor(z / CH) * this.cw + Math.floor(x / CH);
  }

  /** A tile's tilled state changed: its 3×3 neighbourhood's patches (and chunks) rebuild. */
  private invalidate(x: number, z: number): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = x + dx;
        const tz = z + dz;
        if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.depth) continue;
        this.tileGeo.delete(tz * this.width + tx);
        this.dirty.add(this.chunkOf(tx, tz));
      }
    }
  }

  private rebuild(ci: number): void {
    const cx0 = (ci % this.cw) * CH;
    const cz0 = Math.floor(ci / this.cw) * CH;
    const parts: TileGeo[] = [];
    for (let z = cz0; z < Math.min(this.depth, cz0 + CH); z++) {
      for (let x = cx0; x < Math.min(this.width, cx0 + CH); x++) {
        const i = z * this.width + x;
        if (!this.tilled[i]) continue;
        let g = this.tileGeo.get(i);
        if (!g) {
          g = this.genTile(x, z);
          this.tileGeo.set(i, g);
        }
        parts.push(g);
      }
    }
    const old = this.chunks.get(ci);
    if (!parts.length) {
      if (old) {
        old.geometry.dispose();
        old.removeFromParent();
        this.chunks.delete(ci);
      }
      return;
    }
    let nv = 0;
    let ni = 0;
    for (const p of parts) {
      nv += p.pos.length / 3;
      ni += p.idx.length;
    }
    const pos = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const col = new Float32Array(nv * 3);
    const attr = new Float32Array(nv * 4);
    const idx = new Uint32Array(ni);
    let ov = 0;
    let oi = 0;
    for (const p of parts) {
      pos.set(p.pos, ov * 3);
      nrm.set(p.nrm, ov * 3);
      uv.set(p.uv, ov * 2);
      col.set(p.col, ov * 3);
      attr.set(p.attr, ov * 4);
      for (let k = 0; k < p.idx.length; k++) idx[oi + k] = p.idx[k]! + ov;
      ov += p.pos.length / 3;
      oi += p.idx.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('soilA', new THREE.BufferAttribute(attr, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    if (old) {
      old.geometry.dispose();
      old.geometry = g;
    } else {
      const mesh = new THREE.Mesh(g, soilMaterial());
      mesh.name = `soil-chunk-${ci}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.chunks.set(ci, mesh);
    }
  }

  // ─────────────────────────── wetness

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

  // ─────────────────────────── tiles

  /** Show (x, z) as tilled soil (`y` = terrain height at the tile centre, for husks / granules). */
  set(x: number, z: number, y: number, opts: { wet: boolean; mask?: number; animate?: boolean; fert?: number }): void {
    if (x < 0 || z < 0 || x >= this.width || z >= this.depth) return;
    const i = z * this.width + x;
    const prev = this.tiles.get(i);
    const pending = this.floods.has(i);
    if (!opts.wet) this.setWet(x, z, false);
    else if (!pending && !this.isWet(x, z)) this.setWet(x, z, true);
    if (!this.tilled[i]) {
      this.tilled[i] = 1;
      this.invalidate(x, z);
    }
    let husk = prev?.husk;
    const h = (x * 73856093) ^ (z * 19349663);
    if (!prev && Math.abs(h >> 9) % 100 < 45) {
      if (!this.huskSets.length) for (let v = 0; v < 3; v++) this.huskSets.push(new InstancedSet(`husk-${v}`, [{ geometry: huskGeometry(v), material: huskMaterial(), depthMaterial: huskDepthMaterial(), castShadow: true }], this.pool));
      const hs = this.huskSets[Math.abs(h >> 13) % 3]!;
      const hm = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, y + BASE, z + 0.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.abs(h >> 5) % 628) / 100), new THREE.Vector3(1, 1, 1));
      husk = { set: hs, id: hs.add(hm) };
    }
    const tile = { y, husk, fert: prev?.fert ?? opts.fert };
    this.tiles.set(i, tile);
    if (tile.fert && !this.fertIds.has(i)) this.setFert(x, z, tile.fert);
    // Freshly hoed: the bed is there from the first frame, low and dark, and springs up.
    if (opts.animate) {
      this.anims.set(i, { t: 0, x, z, amp: 1 });
      this.writeHeave(x, z, 0.55, 1, 0.5);
    }
  }

  /** Fertilizer granules on a tilled tile (tier 1 / 2 tint; 0 removes). */
  setFert(x: number, z: number, tier: number, tint = tier >= 2 ? 0x8fd0c0 : 0xe6dcc4): void {
    const i = z * this.width + x;
    const t = this.tiles.get(i);
    const old = this.fertIds.get(i);
    if (old !== undefined) {
      this.fertSet?.remove(old);
      this.fertIds.delete(i);
    }
    if (!t) return;
    t.fert = tier || undefined;
    if (!tier) return;
    if (!this.fertSet) this.fertSet = new InstancedSet('fert', [{ geometry: granuleGeometry(), material: granuleMaterial(), tinted: true, castShadow: false }], this.pool);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, t.y + BASE + RIDGE * 0.45, z + 0.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (((x * 7 + z * 13) % 4) * Math.PI) / 2), new THREE.Vector3(1, 1, 1));
    this.fertIds.set(i, this.fertSet.add(m, new THREE.Color(tint)));
  }

  /** A slam / impact heave on an existing bed (staggered by `delay`). */
  heave(x: number, z: number, delay = 0, amp = 0.6): void {
    const i = z * this.width + x;
    if (this.tilled[i]) this.anims.set(i, { t: -delay, x, z, amp });
  }

  clear(x: number, z: number, keepWet = false): void {
    if (x < 0 || z < 0 || x >= this.width || z >= this.depth) return;
    if (!keepWet) this.setWet(x, z, false);
    const i = z * this.width + x;
    const t = this.tiles.get(i);
    if (t?.husk) t.husk.set.remove(t.husk.id);
    const f = this.fertIds.get(i);
    if (f !== undefined) {
      this.fertSet?.remove(f);
      this.fertIds.delete(i);
    }
    this.tiles.delete(i);
    if (this.anims.delete(i)) this.writeHeave(x, z, 0.5, 0, 0.5);
    if (this.tilled[i]) {
      this.tilled[i] = 0;
      this.invalidate(x, z);
    }
  }

  has(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth && this.tilled[z * this.width + x] === 1;
  }

  private writeHeave(x: number, z: number, scale: number, fresh: number, off: number): void {
    const o = (z * this.width + x) * 4;
    this.heaveData[o] = Math.round(THREE.MathUtils.clamp(scale, 0, 1) * 255);
    this.heaveData[o + 1] = Math.round(THREE.MathUtils.clamp(fresh, 0, 1) * 255);
    this.heaveData[o + 2] = Math.round(THREE.MathUtils.clamp(off, 0, 1) * 255);
    this.heaveTex.needsUpdate = true;
  }

  /** Rebuild dirty chunks, animate heaves + wetness floods / drying. Call every frame. */
  tick(dt: number): void {
    if (this.dirty.size) {
      for (const ci of this.dirty) this.rebuild(ci);
      this.dirty.clear();
    }
    if (this.floods.size) {
      for (const [i, f] of this.floods) {
        f.t += dt;
        const x = i % this.width;
        const z = Math.floor(i / this.width);
        // Radial front from the pour point: reaches the far corner in ~0.4 s.
        const R = (f.t / 0.4) * 1.15;
        for (let jj = 0; jj < WR; jj++) {
          const row = (z * WR + jj) * this.tw + x * WR;
          for (let ii = 0; ii < WR; ii++) {
            const d = Math.hypot((ii + 0.5) / WR - f.cx, (jj + 0.5) / WR - f.cz);
            const v = Math.round(THREE.MathUtils.clamp((R - d) / 0.3, 0, 1) * 255);
            if (v > this.wetData[row + ii]!) this.wetData[row + ii] = v;
          }
        }
        if (f.t >= 0.55) {
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
    if (!this.anims.size || dt <= 0) return;
    for (const [i, a] of this.anims) {
      a.t += dt;
      if (a.t < 0) continue;
      if (a.amp >= 1) {
        // Rise with an overshoot (easeOutBack) from 55 %, the moist darkness fading over ~1.6 s.
        const t = Math.min(1, a.t / 0.3);
        const c1 = 2.4;
        const e = 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        const scale = 0.55 + 0.45 * e;
        const fresh = 1 - smooth(0.25, 1.6, a.t);
        this.writeHeave(a.x, a.z, scale / 2, fresh, 0.5);
        if (a.t >= 1.6) {
          this.writeHeave(a.x, a.z, 0.5, 0, 0.5);
          this.anims.delete(i);
        }
      } else {
        // Slam heave: the bed is punched down, then springs back with a wobble.
        const osc = Math.exp(-a.t * 9) * Math.cos(a.t * 26);
        this.writeHeave(a.x, a.z, (1 - osc * 0.45 * a.amp) / 2, 0, 0.5 - osc * 0.12 * a.amp);
        if (a.t > 0.5) {
          this.writeHeave(a.x, a.z, 0.5, 0, 0.5);
          this.anims.delete(i);
        }
      }
    }
  }
}
