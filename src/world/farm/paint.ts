/**
 * Farm terrain shape + ground painting (pure functions of the seeded noise):
 *   basin / cliff height field, exits, pond bowl, path splines, splat + cover masks,
 *   grass density. No scene objects are created here.
 */
import * as THREE from 'three';
import { Noise2D, smoothstep, clamp } from '../../core/noise';
import { hash2, type Rng } from '../../core/rng';
import { HOUSE, POND, PATHS, NARROW_PATHS, FARM_WATER_LEVEL } from '../../data/farm-layout';
import type { GroundPatch } from '../../data/farm-layout';
import type { Terrain } from '../terrain';
import { TileFlag, TileType, type TileGrid } from '../tiles';

export class FarmShape {
  readonly noise: Noise2D;
  readonly noise2: Noise2D;
  private pathSamples: { x: number; z: number; w: number }[] = [];

  constructor(rng: Rng) {
    this.noise = new Noise2D(rng.fork('n1').seed);
    this.noise2 = new Noise2D(rng.fork('n2').seed);
    this.samplePaths();
  }

  /** Signed distance to the basin rim (negative inside the farm), noise-warped. */
  basinDist(x: number, z: number): number {
    const cx = 32;
    const cz = 33;
    const hx = 29;
    const hz = 27.5;
    const r = 7;
    const qx = Math.abs(x - cx) - (hx - r);
    const qz = Math.abs(z - cz) - (hz - r);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
    const d = outside + Math.min(Math.max(qx, qz), 0) - r;
    return d + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.4 + this.noise2.get(x * 0.35, z * 0.35) * 0.45;
  }

  exitMask(x: number, z: number): number {
    const south = smoothstep(4.2, 2.6, Math.abs(x - 33.2)) * smoothstep(52, 58, z);
    const east = smoothstep(4.2, 2.6, Math.abs(z - 28.5)) * smoothstep(54, 60, x);
    return Math.max(south, east);
  }

  height(x: number, z: number): number {
    const d = this.basinDist(x, z);
    const n = this.noise;
    const cliff1 = smoothstep(-0.2, 1.1, d) * 2.5;
    const t2 = smoothstep(7.5, 8.7, d + n.get(x * 0.05 + 40, z * 0.05) * 3) * 2.1;
    const hills = smoothstep(11, 26, d) * (1.5 + n.fbm(x * 0.03 + 9, z * 0.03, 3) * 3);
    const bumps = smoothstep(1.5, 3.5, d) * n.fbm(x * 0.15, z * 0.15, 2) * 0.35;
    let h = (cliff1 + t2 + hills + bumps) * (1 - this.exitMask(x, z));
    // Gentle interior undulation, flattened around the house yard.
    const yard = smoothstep(9, 5, Math.hypot((x - HOUSE.x) * 0.8, z - HOUSE.z - 1.5));
    h += n.fbm(x * 0.06 + 3, z * 0.06, 2) * 0.12 * (1 - yard) * smoothstep(0.5, -2, d);
    // Pond bowl
    const pr = Math.hypot(x - POND.x, (z - POND.z) * 1.1) + n.get(x * 0.25, z * 0.25) * 0.9;
    h -= smoothstep(POND.r + 1.2, POND.r - 2.6, pr) * 1.35;
    return h;
  }

  private samplePaths(): void {
    PATHS.forEach((pts, pi) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const len = curve.getLength();
      const n = Math.ceil(len / 0.3);
      for (let i = 0; i <= n; i++) {
        const p = curve.getPointAt(i / n);
        const w = 0.72 + this.noise2.get(p.x * 0.2, p.z * 0.2) * 0.22 + (NARROW_PATHS.has(pi) ? -0.12 : 0);
        this.pathSamples.push({ x: p.x, z: p.z, w });
      }
    });
  }

  /** 0..1 path strength at a world point. */
  pathValue(x: number, z: number): number {
    let best = 0;
    for (const s of this.pathSamples) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (Math.abs(dx) > 2.2 || Math.abs(dz) > 2.2) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      const v = smoothstep(s.w + 0.75, s.w - 0.35, d);
      if (v > best) best = v;
    }
    // Packed-dirt yard in front of the porch.
    const yd = Math.hypot((x - HOUSE.x) / 2.6, (z - 18.9) / 1.35);
    best = Math.max(best, smoothstep(1.25, 0.75, yd));
    return best;
  }

  /** Distance (m) to the nearest path centreline sample (capped at 9). */
  pathDistance(x: number, z: number): number {
    let best = 81;
    for (const s of this.pathSamples) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (Math.abs(dx) > 9 || Math.abs(dz) > 9) continue;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  paintSplat(t: Terrain, patches: GroundPatch[]): void {
    t.paint('path', (x, z) => {
      let v = this.pathValue(x, z);
      for (const p of patches) if (p.kind === 'packedDirt') v = Math.max(v, this.patchValue(p, x, z) * 0.62);
      return v;
    });
    // Wet sand ring around the pond.
    t.paint('sand', (x, z) => {
      const pr = Math.hypot(x - POND.x, (z - POND.z) * 1.1);
      return smoothstep(POND.r + 0.9, POND.r + 0.1, pr) * 0.6;
    });
    t.commitSplat();
  }

  /** Noise-edged elliptical patch mask 0..1. */
  patchValue(p: GroundPatch, x: number, z: number): number {
    const d = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz) + this.noise2.get(x * 0.9 + 13, z * 0.9) * 0.28;
    return smoothstep(1.0, 0.55, d) * (p.strength ?? 1);
  }

  /**
   * Ground-cover masks painted into the terrain's cover texture (0 draw calls):
   *   clover (lush dark green + tiny white flowers), moss (velvety olive), trampled / dry straw.
   * Wild patches come from low-frequency noise; vignette patches from the layout.
   */
  paintCover(t: Terrain, patches: GroundPatch[]): void {
    const n = this.noise;
    const n2 = this.noise2;
    const B = { x0: -3, z0: -3, x1: 67, z1: 67 };
    const pathAt = (x: number, z: number): number => t.splatAt(x, z, 'path');
    const inside = (x: number, z: number): number => smoothstep(-0.2, -2.2, this.basinDist(x, z));
    t.paintCover(
      'clover',
      (x, z) => {
        let v = smoothstep(0.58, 0.72, n.fbm(x * 0.16 + 31, z * 0.16, 2) * 0.5 + 0.5) * 0.9;
        for (const p of patches) if (p.kind === 'clover') v = Math.max(v, this.patchValue(p, x, z));
        return v <= 0 ? 0 : v * (1 - pathAt(x, z)) * inside(x, z);
      },
      B,
    );
    t.paintCover(
      'moss',
      (x, z) => {
        // Moss collects in the damp shade along the cliff base and around the pond.
        const bd = this.basinDist(x, z);
        const cliff = smoothstep(-3.4, -1.0, bd) * smoothstep(0.2, -0.5, bd);
        const pond = smoothstep(POND.r + 4, POND.r + 1.4, Math.hypot(x - POND.x, (z - POND.z) * 1.1));
        const wild = smoothstep(0.62, 0.75, n2.fbm(x * 0.2 + 7, z * 0.2 + 3, 2) * 0.5 + 0.5) * 0.7;
        let v = Math.max(cliff * 0.85, pond * 0.6, wild) * smoothstep(0.3, 0.55, n2.get(x * 0.6, z * 0.6) * 0.5 + 0.5 + 0.15);
        for (const p of patches) if (p.kind === 'moss') v = Math.max(v, this.patchValue(p, x, z));
        return v <= 0 ? 0 : v * (1 - pathAt(x, z)) * inside(x, z);
      },
      B,
    );
    t.paintCover(
      'dry',
      (x, z) => {
        let v = 0;
        // Trampled verge along the paths.
        const pv = pathAt(x, z);
        v = Math.max(v, smoothstep(0.0, 0.2, pv) * (1 - smoothstep(0.35, 0.6, pv)) * 0.3);
        for (const p of patches) if (p.kind === 'trampled' || p.kind === 'straw') v = Math.max(v, this.patchValue(p, x, z) * (p.kind === 'straw' ? 1 : 0.8));
        return v <= 0 ? 0 : v * inside(x, z);
      },
      B,
    );
    t.commitCover();
  }

  flowerColor(x: number, z: number): number {
    const palette = [0xffffff, 0xffd166, 0xff8fab, 0xc77dff, 0x7ec8ff, 0xff9f1c];
    const nn = this.noise.get(x * 0.08 + 50, z * 0.08);
    const idx = Math.floor(clamp((nn + 1) / 2, 0, 0.999) * palette.length);
    return hash2(Math.floor(x), Math.floor(z), 3) < 0.2 ? palette[(idx + 2) % palette.length]! : palette[idx]!;
  }

  grassDensity(t: Terrain, grid: TileGrid, x: number, z: number): number {
    if (t.slopeAt(x, z) < 0.78) return 0;
    const h = t.heightAt(x, z);
    if (h < FARM_WATER_LEVEL + 0.12) return 0;
    const pv = t.splatAt(x, z, 'path');
    if (pv > 0.3) return 0;
    if (t.splatAt(x, z, 'tilled') > 0.2) return 0;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (grid.inBounds(tx, tz) && grid.hasFlag(tx, tz, TileFlag.Blocked) && grid.getType(tx, tz) !== TileType.Cliff) return 0.4;
    const clump = smoothstep(-0.1, 0.5, this.noise2.fbm(x * 0.13, z * 0.13, 2));
    const edge = pv > 0.05 ? 0.6 : 1;
    // Moss / trampled ground carries fewer blades.
    const cover = 1 - t.coverAt(x, z, 'moss') * 0.45 - t.coverAt(x, z, 'dry') * 0.3;
    return (3.2 + clump * 5.5) * edge * cover;
  }

  /** Probability a tuft is the tall variant: meadow swells, trimmed near the homestead. */
  tallness(x: number, z: number): number {
    const home = smoothstep(9, 13, Math.hypot((x - HOUSE.x) * 0.8, z - HOUSE.z - 3));
    return 0.1 + 0.62 * smoothstep(0.1, 0.6, this.noise2.fbm(x * 0.09, z * 0.09, 2)) * (0.45 + 0.55 * home);
  }
}
