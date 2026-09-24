/**
 * Heightfield terrain with a splat-blended ground shader:
 *   grass (seasonal tint × detail) / packed-dirt path / tilled soil / wet soil / sand
 *   + triplanar rock strata on steep slopes (cliffs) + muddy pond beds below water.
 *
 * Splat map: RGBA8 DataTexture at SPLAT_RES texels per world unit covering the terrain extent.
 *   r = path/dirt, g = tilled, b = wet, a = sand
 * Farming later calls `terrain.setTileSplat(x, z, { tilled: 1, wet: 1 })` + `commitSplat()`.
 */
import * as THREE from 'three';
import { textures } from '../render/textures';
import { globalUniforms } from '../render/uniforms';
import { NOISE_GLSL } from '../render/shaders/noise';
import { applyWorldFx } from '../render/worldfx';
import { patchMaterial, after, before, replace } from '../render/patch';

export const SPLAT_RES = 2;
/** Ground-cover texels per world unit (clover / moss / dry-trampled / contact AO). */
export const COVER_RES = 4;

export interface TerrainOptions {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Vertex spacing in world units. */
  step: number;
  height: (x: number, z: number) => number;
  waterLevel: number;
  /** Texture for the 'path' splat channel (default packed dirt; the town uses cobblestones). */
  pathTexture?: THREE.Texture;
  /** World-space UV scale of the path texture (default 0.34). */
  pathScale?: number;
}

export type SplatChannel = 'path' | 'tilled' | 'wet' | 'sand';
const CH: Record<SplatChannel, number> = { path: 0, tilled: 1, wet: 2, sand: 3 };
/** Cover channels: r = clover, g = moss, b = dry / trampled straw, a = baked contact AO under props. */
export type CoverChannel = 'clover' | 'moss' | 'dry' | 'ao';
const CCH: Record<CoverChannel, number> = { clover: 0, moss: 1, dry: 2, ao: 3 };

export class Terrain {
  /** Terrain chunks (split for frustum / shadow culling); all share one material. */
  readonly mesh: THREE.Group;
  readonly material: THREE.MeshStandardMaterial;
  readonly splat: THREE.DataTexture;
  readonly heightTex: THREE.DataTexture;
  readonly nx: number;
  readonly nz: number;
  private heights: Float32Array;
  private splatData: Uint8Array;
  readonly splatW: number;
  readonly splatH: number;
  /** Ground-cover mask (see CoverChannel), COVER_RES texels per unit over the terrain extent. */
  readonly cover: THREE.DataTexture;
  private coverData: Uint8Array;
  readonly coverW: number;
  readonly coverH: number;

  constructor(readonly opts: TerrainOptions) {
    const { minX, minZ, maxX, maxZ, step } = opts;
    this.nx = Math.round((maxX - minX) / step) + 1;
    this.nz = Math.round((maxZ - minZ) / step) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.heights[j * this.nx + i] = opts.height(minX + i * step, minZ + j * step);
      }
    }

    this.splatW = Math.round((maxX - minX) * SPLAT_RES);
    this.splatH = Math.round((maxZ - minZ) * SPLAT_RES);
    this.splatData = new Uint8Array(this.splatW * this.splatH * 4);
    this.splat = new THREE.DataTexture(this.splatData, this.splatW, this.splatH, THREE.RGBAFormat);
    this.splat.magFilter = THREE.LinearFilter;
    this.splat.minFilter = THREE.LinearFilter;
    this.splat.wrapS = this.splat.wrapT = THREE.ClampToEdgeWrapping;
    this.splat.needsUpdate = true;

    this.coverW = Math.round((maxX - minX) * COVER_RES);
    this.coverH = Math.round((maxZ - minZ) * COVER_RES);
    this.coverData = new Uint8Array(this.coverW * this.coverH * 4);
    this.cover = new THREE.DataTexture(this.coverData, this.coverW, this.coverH, THREE.RGBAFormat);
    this.cover.magFilter = THREE.LinearFilter;
    this.cover.minFilter = THREE.LinearFilter;
    this.cover.wrapS = this.cover.wrapT = THREE.ClampToEdgeWrapping;
    this.cover.needsUpdate = true;

    const half = new Uint16Array(this.nx * this.nz);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(this.heights[i]!);
    this.heightTex = new THREE.DataTexture(half, this.nx, this.nz, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;

    this.material = this.buildMaterial();
    this.mesh = new THREE.Group();
    this.mesh.name = 'terrain';
    // 5×5 chunks: frustum culling in the main + AO passes without too many draw calls.
    for (const g of this.splitGeometry(this.buildGeometry(), 5)) {
      const m = new THREE.Mesh(g, this.material);
      m.receiveShadow = true;
      m.castShadow = false;
      m.name = 'terrain-chunk';
      this.mesh.add(m);
    }
    this.mesh.add(this.buildShadowProxy());
  }

  /**
   * Shadow-only casters: the heightfield at half resolution (¼ of the triangles), sunk 6 cm so
   * the full-res surface never self-shadows against it. It skips the main / AO passes by
   * collapsing its draw range in onBeforeRender (shadow rendering calls onBeforeShadow instead).
   */
  private buildShadowProxy(): THREE.Group {
    const { minX, minZ, step } = this.opts;
    const S = 2;
    const w = Math.floor((this.nx - 1) / S) + 1;
    const d = Math.floor((this.nz - 1) / S) + 1;
    const group = new THREE.Group();
    group.name = 'terrain-shadow-proxy';
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    // 3×3 chunks so the shadow pass culls what's outside the (view-fitted) shadow frustum.
    const N = 3;
    for (let cj = 0; cj < N; cj++) {
      for (let ci = 0; ci < N; ci++) {
        const i0 = Math.floor((ci * (w - 1)) / N);
        const i1 = Math.floor(((ci + 1) * (w - 1)) / N);
        const j0 = Math.floor((cj * (d - 1)) / N);
        const j1 = Math.floor(((cj + 1) * (d - 1)) / N);
        const cw = i1 - i0 + 1;
        const cd = j1 - j0 + 1;
        const pos = new Float32Array(cw * cd * 3);
        for (let j = 0; j < cd; j++) {
          for (let i = 0; i < cw; i++) {
            const k = j * cw + i;
            const gi = (i0 + i) * S;
            const gj = (j0 + j) * S;
            pos[k * 3] = minX + gi * step;
            pos[k * 3 + 1] = this.heights[gj * this.nx + gi]! - 0.06;
            pos[k * 3 + 2] = minZ + gj * step;
          }
        }
        const idx: number[] = [];
        for (let j = 0; j < cd - 1; j++) {
          for (let i = 0; i < cw - 1; i++) {
            const a = j * cw + i;
            idx.push(a, a + cw, a + 1, a + 1, a + cw, a + cw + 1);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat);
        m.name = 'terrain-shadow-chunk';
        m.castShadow = true;
        m.receiveShadow = false;
        m.userData.noAO = true;
        const n = idx.length;
        m.onBeforeRender = () => g.setDrawRange(n + 3, 0);
        m.onAfterRender = () => g.setDrawRange(0, Infinity);
        group.add(m);
      }
    }
    return group;
  }

  /** Bilinear ground height at world x,z. */
  heightAt(x: number, z: number): number {
    const { minX, minZ, step } = this.opts;
    const fx = THREE.MathUtils.clamp((x - minX) / step, 0, this.nx - 1.001);
    const fz = THREE.MathUtils.clamp((z - minZ) / step, 0, this.nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const a = h[j * this.nx + i]!;
    const b = h[j * this.nx + i + 1]!;
    const c = h[(j + 1) * this.nx + i]!;
    const d = h[(j + 1) * this.nx + i + 1]!;
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** Approximate surface normal y (1 = flat). */
  slopeAt(x: number, z: number): number {
    const e = 0.35;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return new THREE.Vector3(-dx, 2 * e, -dz).normalize().y;
  }

  /** Set one splat texel (world coords). */
  setSplatTexel(sx: number, sz: number, ch: SplatChannel, v: number): void {
    if (sx < 0 || sz < 0 || sx >= this.splatW || sz >= this.splatH) return;
    this.splatData[(sz * this.splatW + sx) * 4 + CH[ch]] = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
  }

  getSplatTexel(sx: number, sz: number, ch: SplatChannel): number {
    if (sx < 0 || sz < 0 || sx >= this.splatW || sz >= this.splatH) return 0;
    return this.splatData[(sz * this.splatW + sx) * 4 + CH[ch]]! / 255;
  }

  /** Paint a continuous field over the splat map: fn(worldX, worldZ) -> 0..1 (max-blended). */
  paint(ch: SplatChannel, fn: (x: number, z: number) => number): void {
    const { minX, minZ } = this.opts;
    for (let j = 0; j < this.splatH; j++) {
      for (let i = 0; i < this.splatW; i++) {
        const x = minX + (i + 0.5) / SPLAT_RES;
        const z = minZ + (j + 0.5) / SPLAT_RES;
        const v = fn(x, z);
        if (v > 0) this.setSplatTexel(i, j, ch, Math.max(v, this.getSplatTexel(i, j, ch)));
      }
    }
  }

  /** Set a whole tile's splat channels (tile coords = world integer coords). */
  setTileSplat(tx: number, tz: number, v: Partial<Record<SplatChannel, number>>): void {
    const { minX, minZ } = this.opts;
    const sx0 = Math.round((tx - minX) * SPLAT_RES);
    const sz0 = Math.round((tz - minZ) * SPLAT_RES);
    for (let dz = 0; dz < SPLAT_RES; dz++) {
      for (let dx = 0; dx < SPLAT_RES; dx++) {
        for (const k of Object.keys(v) as SplatChannel[]) this.setSplatTexel(sx0 + dx, sz0 + dz, k, v[k]!);
      }
    }
  }

  /** Sample a splat channel at world pos (nearest texel). */
  splatAt(x: number, z: number, ch: SplatChannel): number {
    const { minX, minZ } = this.opts;
    return this.getSplatTexel(Math.floor((x - minX) * SPLAT_RES), Math.floor((z - minZ) * SPLAT_RES), ch);
  }

  commitSplat(): void {
    this.splat.needsUpdate = true;
  }

  /**
   * Paint a ground-cover channel: fn(worldX, worldZ) → 0..1 (max-blended), optionally only
   * inside `bounds` (world rect) to keep it cheap.
   */
  paintCover(ch: CoverChannel, fn: (x: number, z: number) => number, bounds?: { x0: number; z0: number; x1: number; z1: number }): void {
    const { minX, minZ } = this.opts;
    const i0 = bounds ? Math.max(0, Math.floor((bounds.x0 - minX) * COVER_RES)) : 0;
    const i1 = bounds ? Math.min(this.coverW, Math.ceil((bounds.x1 - minX) * COVER_RES)) : this.coverW;
    const j0 = bounds ? Math.max(0, Math.floor((bounds.z0 - minZ) * COVER_RES)) : 0;
    const j1 = bounds ? Math.min(this.coverH, Math.ceil((bounds.z1 - minZ) * COVER_RES)) : this.coverH;
    const c = CCH[ch];
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const v = fn(minX + (i + 0.5) / COVER_RES, minZ + (j + 0.5) / COVER_RES);
        if (v <= 0) continue;
        const k = (j * this.coverW + i) * 4 + c;
        this.coverData[k] = Math.max(this.coverData[k]!, Math.round(Math.min(1, v) * 255));
      }
    }
  }

  /** Radial soft blob into a cover channel (contact AO under props, trampled spots...). */
  stampCover(ch: CoverChannel, x: number, z: number, radius: number, strength = 1, squashZ = 1): void {
    const r = radius + 0.3;
    this.paintCover(
      ch,
      (px, pz) => {
        const d = Math.hypot(px - x, (pz - z) / squashZ) / radius;
        return strength * (1 - THREE.MathUtils.smoothstep(d, 0.35, 1.0));
      },
      { x0: x - r, z0: z - r * squashZ, x1: x + r, z1: z + r * squashZ },
    );
  }

  /** Cover channel value at a world point (nearest texel). */
  coverAt(x: number, z: number, ch: CoverChannel): number {
    const { minX, minZ } = this.opts;
    const i = Math.floor((x - minX) * COVER_RES);
    const j = Math.floor((z - minZ) * COVER_RES);
    if (i < 0 || j < 0 || i >= this.coverW || j >= this.coverH) return 0;
    return this.coverData[(j * this.coverW + i) * 4 + CCH[ch]]! / 255;
  }

  commitCover(): void {
    this.cover.needsUpdate = true;
  }

  private buildGeometry(): THREE.BufferGeometry {
    const { minX, minZ, step } = this.opts;
    const { nx, nz } = this;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const h = this.heights;
    const R = Math.max(1, Math.round(1.5 / step));
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = minX + i * step;
        const z = minZ + j * step;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h[k]!;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x;
        uv[k * 2 + 1] = z;
        // Cavity AO: darker where neighbours are higher (cliff bases, pond banks).
        let sum = 0;
        let cnt = 0;
        for (let dj = -R; dj <= R; dj += R) {
          for (let di = -R; di <= R; di += R) {
            const ii = THREE.MathUtils.clamp(i + di, 0, nx - 1);
            const jj = THREE.MathUtils.clamp(j + dj, 0, nz - 1);
            sum += h[jj * nx + ii]!;
            cnt++;
          }
        }
        const cav = THREE.MathUtils.clamp((sum / cnt - h[k]!) * 0.55, 0, 0.45);
        const ao = 1 - cav;
        col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        // Alternate diagonal along the steepest direction for nicer cliffs.
        if (Math.abs(h[a]! - h[d]!) < Math.abs(h[b]! - h[c]!)) idx.push(a, c, d, a, d, b);
        else idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  private driftFn: ((x: number, z: number) => number) | null = null;

  /** Drift mask at a point (the raised winter snow = driftAt * 0.2 m at full snow cover). */
  driftAt(x: number, z: number): number {
    return this.driftFn ? this.driftFn(x, z) : 0;
  }

  /** Bake the winter snow-drift mask (0..1 per vertex): fn(worldX, worldZ). */
  setDrift(fn: (x: number, z: number) => number): void {
    this.driftFn = fn;
    for (const m of this.mesh.children as THREE.Mesh[]) {
      const dr = m.geometry?.attributes.aDrift as THREE.BufferAttribute | undefined;
      if (!dr) continue;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) dr.setX(i, fn(pos.getX(i), pos.getZ(i)));
      dr.needsUpdate = true;
      // Leave room for the raised drifts in culling bounds.
      m.geometry.computeBoundingSphere();
      if (m.geometry.boundingSphere) m.geometry.boundingSphere.radius += 0.3;
    }
  }

  /** Split the full grid (normals already computed on the whole) into n×n chunk geometries. */
  private splitGeometry(full: THREE.BufferGeometry, n: number): THREE.BufferGeometry[] {
    const { nx, nz } = this;
    const out: THREE.BufferGeometry[] = [];
    const pos = full.attributes.position as THREE.BufferAttribute;
    const nor = full.attributes.normal as THREE.BufferAttribute;
    const col = full.attributes.color as THREE.BufferAttribute;
    const uv = full.attributes.uv as THREE.BufferAttribute;
    const h = this.heights;
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const i0 = Math.floor((ci * (nx - 1)) / n);
        const i1 = Math.floor(((ci + 1) * (nx - 1)) / n);
        const j0 = Math.floor((cj * (nz - 1)) / n);
        const j1 = Math.floor(((cj + 1) * (nz - 1)) / n);
        const w = i1 - i0 + 1;
        const d = j1 - j0 + 1;
        const P = new Float32Array(w * d * 3);
        const N = new Float32Array(w * d * 3);
        const C = new Float32Array(w * d * 3);
        const U = new Float32Array(w * d * 2);
        for (let j = 0; j < d; j++) {
          for (let i = 0; i < w; i++) {
            const src = (j0 + j) * nx + (i0 + i);
            const dst = j * w + i;
            P.set([pos.getX(src), pos.getY(src), pos.getZ(src)], dst * 3);
            N.set([nor.getX(src), nor.getY(src), nor.getZ(src)], dst * 3);
            C.set([col.getX(src), col.getY(src), col.getZ(src)], dst * 3);
            U.set([uv.getX(src), uv.getY(src)], dst * 2);
          }
        }
        const idx: number[] = [];
        for (let j = 0; j < d - 1; j++) {
          for (let i = 0; i < w - 1; i++) {
            const a = j * w + i;
            const b = a + 1;
            const c = a + w;
            const e = c + 1;
            const ga = (j0 + j) * nx + (i0 + i);
            if (Math.abs(h[ga]! - h[ga + nx + 1]!) < Math.abs(h[ga + 1]! - h[ga + nx]!)) idx.push(a, c, e, a, e, b);
            else idx.push(a, c, b, b, c, e);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(P, 3));
        g.setAttribute('aDrift', new THREE.BufferAttribute(new Float32Array(w * d), 1));
        g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        g.setAttribute('color', new THREE.BufferAttribute(C, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        out.push(g);
      }
    }
    full.dispose();
    return out;
  }

  private buildMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true });
    m.name = 'terrain';
    const { minX, minZ, maxX, maxZ } = this.opts;
    const u = {
      uSplat: { value: this.splat },
      uCover: { value: this.cover },
      uSplatOrigin: { value: new THREE.Vector2(minX, minZ) },
      uSplatSize: { value: new THREE.Vector2(maxX - minX, maxZ - minZ) },
      uGrassTex: { value: textures.grassDetail().map },
      uDirtTex: { value: this.opts.pathTexture ?? textures.dirt().map },
      uPathScale: { value: this.opts.pathScale ?? 0.34 },
      uSoilTex: { value: textures.soil().map },
      uWetSoilTex: { value: textures.wetSoil().map },
      uCliffTex: { value: textures.cliff().map },
      uSandTex: { value: textures.sand().map },
      uWaterLevel: { value: this.opts.waterLevel },
    };
    patchMaterial(m, 'terrain', (shader) => {
      Object.assign(shader.uniforms, u);
      shader.uniforms.uGrassA = globalUniforms.uGrassA;
      shader.uniforms.uGrassB = globalUniforms.uGrassB;
      shader.uniforms.uGrassDry = globalUniforms.uGrassDry;
      shader.uniforms.uGrassTip = globalUniforms.uGrassTip;
      shader.uniforms.uDryAmt = globalUniforms.uDryAmt;
      shader.uniforms.uSeasonW = globalUniforms.uSeasonW;
      shader.uniforms.uRain = globalUniforms.uRain;
      shader.uniforms.uWetT = globalUniforms.uWet;
      shader.uniforms.uTimeT = globalUniforms.uTime;
      shader.uniforms.uSkyT = globalUniforms.uSkyColor;
      shader.uniforms.uHorizonT = globalUniforms.uHorizonColor;
      shader.uniforms.uSnowV = globalUniforms.uSnow;
      let vs = shader.vertexShader;
      vs = before(vs, 'void main() {', 'varying vec3 vTWorld;\nvarying vec3 vTNormal;\nattribute float aDrift;\nuniform float uSnowV;');
      // Winter: snow drifts pile up against walls and fences.
      vs = after(vs, '#include <begin_vertex>', 'transformed.y += aDrift * 0.2 * smoothstep(0.3, 1.0, uSnowV);');
      vs = after(vs, '#include <project_vertex>', 'vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNormal = normalize(mat3(modelMatrix) * objectNormal);');
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = before(
        fs,
        'void main() {',
        /* glsl */ `
        varying vec3 vTWorld;
        varying vec3 vTNormal;
        uniform sampler2D uSplat;
        uniform sampler2D uCover;
        uniform vec2 uSplatOrigin;
        uniform vec2 uSplatSize;
        uniform sampler2D uGrassTex;
        uniform sampler2D uDirtTex;
        uniform float uPathScale;
        uniform sampler2D uSoilTex;
        uniform sampler2D uWetSoilTex;
        uniform sampler2D uCliffTex;
        uniform sampler2D uSandTex;
        uniform vec3 uGrassA;
        uniform vec3 uGrassB;
        uniform vec3 uGrassDry;
        uniform vec3 uGrassTip;
        uniform float uWaterLevel;
        uniform float uDryAmt;
        uniform vec4 uSeasonW;
        uniform float uRain;
        uniform float uWetT;
        uniform float uTimeT;
        uniform vec3 uSkyT;
        uniform vec3 uHorizonT;
        ${NOISE_GLSL}
        // Rain ripples: expanding rings in a jittered cell grid, returns a normal offset (xz).
        vec2 hvRipples(vec2 p, float t) {
          vec2 acc = vec2(0.0);
          for (int k = 0; k < 2; k++) {
            vec2 q = p * (k == 0 ? 2.2 : 3.1) + float(k) * 7.7;
            vec2 id = floor(q);
            vec2 f = fract(q) - 0.5;
            vec2 jit = hvHash22(id) - 0.5;
            float ph = fract(t * (0.9 + 0.4 * hvHash12(id + 3.0)) + hvHash12(id));
            vec2 d = f - jit * 0.5;
            float r = length(d);
            float ring = sin((r - ph * 0.55) * 60.0) * smoothstep(0.08, 0.0, abs(r - ph * 0.55)) * (1.0 - ph);
            acc += normalize(d + 1e-4) * ring;
          }
          return acc;
        }
        `,
      );
      fs = replace(
        fs,
        '#include <map_fragment>',
        /* glsl */ `
        vec3 wp = vTWorld;
        vec3 wn = normalize(vTNormal);
        vec2 suv = (wp.xz - uSplatOrigin) / uSplatSize;
        float tn1 = hvNoise(wp.xz * 1.9);
        float tn2 = hvNoise(wp.xz * 5.3 + 4.0);
        vec2 warp = (vec2(hvNoise(wp.xz * 0.8 + 3.1), hvNoise(wp.xz * 0.8 + 8.7)) - 0.5) * 0.55;
        vec4 spW = texture2D(uSplat, suv + warp / uSplatSize);
        vec4 spR = texture2D(uSplat, suv);

        // Grass: seasonal two-tone + dry patches + detail strokes.
        float gmix = smoothstep(0.3, 0.72, hvFbm(wp.xz * 0.055));
        vec3 grass = mix(uGrassA, uGrassB, gmix);
        float dryLo = 0.62 - 0.14 * uSeasonW.z;
        grass = mix(grass, uGrassDry, smoothstep(dryLo, dryLo + 0.22, hvFbm(wp.xz * 0.09 + 5.0)) * uDryAmt);
        grass = mix(grass, uGrassTip, smoothstep(0.55, 0.95, hvNoise(wp.xz * 0.35)) * 0.18);
        float gd = texture2D(uGrassTex, wp.xz * 0.23).r;
        float gd2 = texture2D(uGrassTex, wp.xz * 0.071 + 0.37).r;
        float lush = smoothstep(0.35, 0.78, hvFbm(wp.xz * 0.11 + 20.0));
        grass = mix(grass, uGrassA * vec3(0.7, 0.86, 0.74), lush * 0.55);
        grass *= (0.62 + gd * 0.55 + gd2 * 0.25) * 0.86;
        grass = hvMeadowVar(grass, wp.xz);
        grass = hvMottle(grass, wp.xz);

        // Ground cover: clover carpets, moss, dry / trampled straw (+ baked contact AO, below).
        vec4 cov = texture2D(uCover, suv + warp * 0.35 / uSplatSize);
        {
          float cl = smoothstep(0.15, 0.75, cov.r + (tn2 - 0.5) * 0.3);
          vec2 cq = mat2(0.866, 0.5, -0.5, 0.866) * wp.xz;
          float leafN = hvNoise(cq * 6.3) * 0.6 + hvNoise(cq * 13.1 + 5.0) * 0.4;
          vec3 clover = uGrassA * vec3(0.82, 1.02, 0.86) * (0.8 + 0.28 * leafN);
          vec2 fc = floor(wp.xz * 3.1);
          vec2 fo = hvHash22(fc) - 0.5;
          float fdot = smoothstep(0.075, 0.035, length(fract(wp.xz * 3.1) - 0.5 - fo * 0.6)) * step(hvHash12(fc + 9.0), 0.2);
          clover = mix(clover, vec3(0.93, 0.92, 0.86), fdot * (1.0 - uSeasonW.w) * (1.0 - uSeasonW.z * 0.6));
          grass = mix(grass, clover, cl * 0.75);
          float mo = smoothstep(0.15, 0.7, cov.g + (tn1 - 0.5) * 0.25);
          vec3 moss = mix(vec3(0.05, 0.11, 0.016), vec3(0.1, 0.18, 0.028), hvNoise(cq * 5.7)) * (0.88 + 0.24 * hvNoise(cq * 17.0));
          moss = mix(moss, moss * vec3(1.25, 1.0, 0.6), uSeasonW.z);
          grass = mix(grass, moss, mo * 0.6);
          float dr = smoothstep(0.12, 0.7, cov.b + (tn2 - 0.5) * 0.3);
          float streak = hvNoise(vec2(wp.x * 7.0 + wp.z * 2.0, wp.z * 1.3));
          // Trampled / dry: an olive-straw cast over the grass (keeps the blade texture), not bare sand.
          vec3 straw = mix(grass * vec3(1.2, 1.08, 0.62), uGrassDry * vec3(1.1, 1.0, 0.7), 0.45) * (0.85 + 0.3 * streak);
          grass = mix(grass, straw, dr * 0.6);
        }

        // Path (packed dirt) with trampled rim.
        float pv = spW.r + (tn1 - 0.5) * 0.32 + (tn2 - 0.5) * 0.12;
        float pathM = smoothstep(0.46, 0.54, pv);
        float rim = smoothstep(0.26, 0.46, pv) * (1.0 - pathM);
        vec3 dirt = texture2D(uDirtTex, wp.xz * uPathScale).rgb;
        dirt *= 0.92 + 0.12 * smoothstep(0.5, 0.9, pv);
        grass = mix(grass, grass * vec3(0.78, 0.8, 0.62) + dirt * 0.12, rim * 0.8);

        // Sand
        float sandM = smoothstep(0.4, 0.6, spW.a + (tn1 - 0.5) * 0.3);
        vec3 sand = texture2D(uSandTex, wp.xz * 0.3).rgb;

        // Tilled + wet soil (crisp tile squares).
        float tillM = smoothstep(0.44, 0.56, spR.g + (tn2 - 0.5) * 0.06);
        float tillRim = smoothstep(0.2, 0.45, spR.g) * (1.0 - tillM);
        float wetM = smoothstep(0.4, 0.6, spR.b);
        vec3 soil = mix(texture2D(uSoilTex, wp.xz).rgb, texture2D(uWetSoilTex, wp.xz).rgb, wetM);

        vec3 ground = grass;
        ground = mix(ground, sand, sandM);
        ground = mix(ground, dirt, pathM);
        ground = mix(ground, ground * 0.72, tillRim * 0.8);
        ground = mix(ground, soil, tillM);

        // Cliffs: triplanar strata on steep slopes.
        float slope = 1.0 - wn.y;
        float rockM = smoothstep(0.26, 0.42, slope + (tn1 - 0.5) * 0.14);
        vec3 bw = pow(abs(wn), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        vec3 rx = texture2D(uCliffTex, vec2(wp.z * 0.23, wp.y * 0.3)).rgb;
        vec3 rz = texture2D(uCliffTex, vec2(wp.x * 0.23, wp.y * 0.3)).rgb;
        vec3 ry = texture2D(uCliffTex, wp.xz * 0.2).rgb;
        vec3 rock = rx * bw.x + ry * bw.y + rz * bw.z;
        // Grass creeping over rock tops.
        rock = mix(rock, grass * 0.85, smoothstep(0.35, 0.2, slope) * 0.6);
        ground = mix(ground, rock, rockM);

        // Pond bed: wet sand at the shore, dark mud below.
        float depthB = uWaterLevel - wp.y;
        float shore = smoothstep(-0.25, 0.02, depthB);
        // Muddy, mossy bank rather than a bright beach liner.
        vec3 wetSand = mix(sand * vec3(0.5, 0.47, 0.4), grass * 0.55, 0.35);
        ground = mix(ground, wetSand, shore * (1.0 - rockM * 0.5));
        ground = mix(ground, vec3(0.16, 0.15, 0.1) + sand * 0.12, smoothstep(0.1, 0.7, depthB));

        // Puddles: noise-masked on flat ground (paths and soil most likely) while it's wet.
        float flatG = smoothstep(0.965, 0.995, wn.y);
        float pudN = hvFbm(wp.xz * 0.42 + 11.0) + pathM * 0.08;
        float hvWetK = smoothstep(0.5, 0.95, uWetT);
        // Islands, not sheets: only the deepest dips of the path hold water.
        float hvPuddle = smoothstep(0.625, 0.67, pudN) * flatG * hvWetK * (1.0 - rockM) * pathM * (1.0 - tillM);
        // 1-2 px bright meniscus right at the waterline.
        float hvPudW = max(fwidth(pudN), 1e-4);
        float hvPudEdge = (1.0 - smoothstep(0.0, hvPudW * 1.6, abs(pudN - 0.629))) * flatG * hvWetK * (1.0 - rockM) * pathM * (1.0 - tillM);
        // Muddy, darker rim soaking out around every puddle.
        float hvPudRim = smoothstep(0.53, 0.63, pudN) * (1.0 - hvPuddle) * flatG * hvWetK * (1.0 - rockM) * pathM;
        // Soaked dirt: darker and a little richer everywhere on the path (on top of worldfx's wet
        // darkening), never lighter.
        float hvWetPath = hvWetK * pathM * (1.0 - rockM);
        vec3 hvWetG = ground * mix(1.0, 0.8, hvWetPath);
        float hvLum = dot(hvWetG, vec3(0.333));
        ground = mix(vec3(hvLum), hvWetG, 1.0 + 0.18 * hvWetPath);
        ground *= mix(1.0, 0.68, hvPudRim);
        ground *= mix(1.0, 0.26, hvPuddle);
        ground = mix(ground, ground * vec3(0.86, 0.94, 1.1), hvPuddle);
        float hvTPath = pathM;

        // Baked contact AO under props / vignettes (painted blobs), strongest in the centre.
        ground *= 1.0 - cov.a * 0.5 * (1.0 - rockM);
        diffuseColor.rgb *= ground;
        float hvTerrainRough = mix(0.95, 0.55, wetM * tillM);
        hvTerrainRough = mix(hvTerrainRough, 0.6, shore);
        hvTerrainRough = mix(hvTerrainRough, 0.82, hvWetPath * (1.0 - hvPuddle));
        hvTerrainRough = mix(hvTerrainRough, 0.05, hvPuddle);
        `,
      );
      fs = after(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = hvTerrainRough;');
      // Puddles mirror the (overcast) sky.
      fs = after(
        fs,
        '#include <emissivemap_fragment>',
        /* glsl */ `
        if (hvPuddle > 0.01) {
          vec3 Vp = normalize(cameraPosition - vTWorld);
          float fr = 0.5 + 0.5 * pow(1.0 - max(Vp.y, 0.0), 2.0);
          // Mirror of the sky with the dark masses of trees / eaves reflected in it (a cheap
          // screen-free "probe": low-frequency blotches offset along the view direction).
          vec2 rq = vTWorld.xz - Vp.xz * 6.0;
          float trees = smoothstep(0.4, 0.56, hvFbm(rq * 0.12 + 3.0));
          // Bright overcast sky with a soft brighter streak (the cloud break), dark crowns across it.
          float cloud = 0.85 + 0.3 * hvNoise(rq * 0.05 + 9.0);
          vec3 refl = mix(mix(uHorizonT, uSkyT, 0.35) * 1.2 * cloud, mix(uHorizonT, uSkyT, 0.5) * vec3(0.1, 0.13, 0.11), trees * 0.92);
          // Ripple rings catch the light.
          float rr = length(hvRipples(vTWorld.xz, uTimeT)) * uRain;
          // A faint sky hint only: the real sheen comes from the environment specular (roughness 0.05).
          totalEmissiveRadiance += (refl * fr * 0.62 + vec3(rr * 0.16)) * hvPuddle;
        }
        totalEmissiveRadiance += mix(uHorizonT, uSkyT, 0.3) * hvPudEdge * 0.05;`,
      );
      fs = after(
        fs,
        '#include <normal_fragment_maps>',
        /* glsl */ `
        if (hvPuddle > 0.01 && uRain > 0.01) {
          vec2 rp = hvRipples(vTWorld.xz, uTimeT) * 0.9 * hvPuddle * uRain;
          normal = normalize(normal + mat3(viewMatrix) * vec3(rp.x, 0.0, rp.y));
        }`,
      );
      shader.fragmentShader = fs;
    });
    // Worldfx after the terrain patch so the snow can read the path mask (trampled slush).
    applyWorldFx(m, { snowUp: 0.7, snowMask: '(1.0 - hvTPath * 0.3)', slush: '(hvTPath * 0.8)' });
    return m;
  }
}
