/**
 * Cindergrove layout (pure data + the terrain shape).
 *
 * World units = tiles. +X east, +Z south (towards the camera). The farm's south exit arrives at
 * the north edge; a spring-fed stream tumbles off the north-west plateau as a waterfall into a
 * plunge pool, then winds south-east under a footbridge. East, behind a ring of elder trees, a
 * narrow deer path leads to the hidden Ember Glade (ancient shrine + ruined watch tower).
 */
import * as THREE from 'three';
import { Noise2D, smoothstep } from '../../core/noise';

export const FOREST_SIZE = { w: 64, d: 62 };
export const FOREST_EXTENT = { minX: -22, minZ: -24, maxX: 86, maxZ: 84 };
/** Lower stream / plunge pool surface. */
export const WATER_LOW = -0.36;
/** Plateau top and its spring-pool surface. */
export const PLATEAU_H = 3.9;
export const WATER_HIGH = PLATEAU_H - 0.42;

export const ENTRY = { x: 32.5, z: 2.6 };
export const FALLS = { x: 15.2, lipZ: 16.5, poolZ: 21.6, width: 2.7 };
export const POOL = { x: 15.6, z: 22.2, r: 4.4 };
export const GLADE = { x: 51, z: 19.5, r: 7.2 };
export const SHRINE = { x: 51.2, z: 18.6 };
export const TOWER = { x: 56.8, z: 13.6 };
export const BRIDGE = { x: 38.6, z: 39.2, rot: -0.72, len: 5.4 };

/** Lower stream centreline: plunge pool → south-east exit. */
export const STREAM: [number, number][] = [
  [15.6, 22.2], [18.4, 26.8], [22.6, 30.2], [27.6, 32.2], [32.8, 34.6], [36.6, 37.6], [40.2, 40.8], [44.2, 44.6], [47.4, 49.6], [51.6, 54.8], [56.4, 60.4], [62, 67], [68, 74], [74, 82],
];
/** Upper stream on the plateau: spring → waterfall lip. */
export const UPPER_STREAM: [number, number][] = [
  [9, -14], [11.5, -6], [13.8, 1.5], [16.6, 7.8], [15.6, 12.6], [FALLS.x, FALLS.lipZ + 0.6],
];

/** Paths (Catmull-Rom). 0 main trail, 1 pool spur, 2 south loop, 3 hidden deer path to the glade. */
export const PATHS: [number, number][][] = [
  [[32.5, -6], [32.6, 3], [32.1, 9.5], [33.4, 16.5], [34.4, 23.5], [36.2, 30.5], [BRIDGE.x - 1.9, BRIDGE.z - 2.2], [BRIDGE.x + 1.9, BRIDGE.z + 2.2], [42.6, 46], [41.6, 52.5], [37.5, 57.5]],
  [[34.1, 22.2], [29.4, 23.6], [24.4, 24.6], [21.3, 25.4]],
  [[42.6, 46], [48.6, 44.4], [53.5, 42.2]],
  [[34.0, 15.2], [38.6, 14.8], [42.4, 17.2], [45.2, 18.4], [GLADE.x - 1.6, GLADE.z + 0.4]],
];
export const PATH_WIDTH = [1.2, 0.8, 0.75, 0.55];

export type GiantKind = 'elder' | 'fir';
/** Hand-placed old-growth giants: [kind, x, z, scale]. */
export const GIANTS: [GiantKind, number, number, number][] = [
  // Flanking the waterfall on the plateau.
  ['elder', 8.2, 11.2, 1.05],
  ['elder', 22.6, 10.4, 1.0],
  ['fir', 3.2, 4.2, 1.0],
  ['fir', 19.8, 2.4, 0.95],
  // Central clearing frame.
  ['elder', 27.2, 16.8, 0.92],
  ['elder', 41.2, 26.8, 1.08],
  ['elder', 25.4, 38.8, 1.0],
  ['fir', 46.2, 34.4, 0.78],
  ['elder', 30.8, 46.8, 0.96],
  ['fir', 23.4, 48.6, 1.0],
  ['elder', 49.6, 51.4, 1.02],
  ['elder', 5.6, 28.8, 1.1],
  ['elder', 29.6, 29.2, 0.95],
  ['fir', 6.4, 44.6, 0.95],
  // The ring hiding the glade.
  ['elder', 43.6, 11.4, 1.0],
  ['elder', 61.4, 27.6, 1.0],
  ['elder', 60.6, 8.2, 1.0],
  ['fir', 48.2, 6.6, 0.9],
  ['elder', 38.2, 5.6, 0.9],
];

/** Mossy fallen giants: [x, z, rotY, length, radius]. */
export const LOGS: [number, number, number, number, number][] = [
  [24.8, 20.4, 0.18, 5.2, 0.52],
  [20.4, 42.6, -0.5, 5.4, 0.5],
  [46.2, 30.4, 1.25, 4.8, 0.46],
  [54.2, 46.8, 0.15, 5.6, 0.5],
];

// ───────────────────────────────────────────── polyline distance field

/** Distance to Catmull-Rom polylines with a coarse spatial hash (fast for per-texel queries). */
export class PolyField {
  private pts: { x: number; z: number; w: number; t: number }[] = [];
  private cells = new Map<number, number[]>();
  private readonly cell = 3;

  constructor(lines: [number, number][][], widths: number[], spacing = 0.3) {
    lines.forEach((line, li) => {
      const curve = new THREE.CatmullRomCurve3(line.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const n = Math.max(2, Math.ceil(curve.getLength() / spacing));
      for (let k = 0; k <= n; k++) {
        const p = curve.getPointAt(k / n);
        this.pts.push({ x: p.x, z: p.z, w: widths[li] ?? widths[0] ?? 1, t: k / n });
      }
    });
    this.pts.forEach((p, i) => {
      const key = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      let c = this.cells.get(key);
      if (!c) this.cells.set(key, (c = []));
      c.push(i);
    });
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 4096 + (cz + 512);
  }

  /** Nearest sample within `maxR` (else null). */
  nearest(x: number, z: number, maxR = 6): { d: number; w: number; t: number; x: number; z: number } | null {
    const r = Math.ceil(maxR / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = maxR * maxR;
    let bi = -1;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = this.cells.get(this.key(cx + dx, cz + dz));
        if (!c) continue;
        for (const i of c) {
          const p = this.pts[i]!;
          const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d2 < best) {
            best = d2;
            bi = i;
          }
        }
      }
    }
    if (bi < 0) return null;
    const p = this.pts[bi]!;
    return { d: Math.sqrt(best), w: p.w, t: p.t, x: p.x, z: p.z };
  }

  get samples(): readonly { x: number; z: number; w: number; t: number }[] {
    return this.pts;
  }
}

// ───────────────────────────────────────────── shape

export class ForestShape {
  readonly noise: Noise2D;
  readonly noise2: Noise2D;
  readonly stream: PolyField;
  readonly upper: PolyField;
  readonly paths: PolyField;

  constructor(seed: number) {
    this.noise = new Noise2D(seed);
    this.noise2 = new Noise2D(seed + 77);
    this.stream = new PolyField([STREAM], [1.25]);
    this.upper = new PolyField([UPPER_STREAM], [0.85]);
    this.paths = new PolyField(PATHS, PATH_WIDTH);
  }

  /** Signed distance to the playable basin (negative inside). */
  rimDist(x: number, z: number): number {
    const cx = 32;
    const cz = 30;
    const hx = 30.5;
    const hz = 29;
    const r = 9;
    const qx = Math.abs(x - cx) - (hx - r);
    const qz = Math.abs(z - cz) - (hz - r);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    return d + this.noise.fbm(x * 0.07, z * 0.07, 3) * 2.4;
  }

  /** Walk-out gaps in the rim: north (farm) and the stream's south-east valley. */
  exitMask(x: number, z: number): number {
    const north = smoothstep(4.2, 2.4, Math.abs(x - 32.6)) * smoothstep(9, 3, z);
    const s = this.stream.nearest(x, z, 8);
    const valley = s && s.t > 0.62 ? smoothstep(5.5, 2.5, s.d) : 0;
    return Math.max(north, valley);
  }

  /** Plateau signed distance (negative on the plateau). */
  plateauDist(x: number, z: number): number {
    const n = this.noise2;
    const edgeZ = FALLS.lipZ + n.get(x * 0.11, 3.3) * 1.1 + n.get(x * 0.37, 8.1) * 0.35 + smoothstep(18, 27, x) * -3.5;
    const edgeX = 27.5 + n.get(z * 0.12, 11.7) * 1.3;
    const d = Math.max(z - edgeZ, x - edgeX);
    // Crisp notch where the waterfall leaves the lip.
    return d;
  }

  plateauMask(x: number, z: number): number {
    return smoothstep(1.05, -0.85, this.plateauDist(x, z) + this.noise.get(x * 0.45, z * 0.45) * 0.28);
  }

  streamCarve(x: number, z: number): number {
    const s = this.stream.nearest(x, z, 6);
    let carve = 0;
    if (s) {
      const wob = this.noise.get(x * 0.21 + 5, z * 0.21) * 0.3;
      carve = smoothstep(s.w + 1.25, s.w * 0.25, s.d + wob);
    }
    const pr = Math.hypot(x - POOL.x, (z - POOL.z) * 1.12) + this.noise.get(x * 0.3, z * 0.3) * 0.7;
    const pool = smoothstep(POOL.r + 1.4, POOL.r - 2.4, pr);
    return Math.max(carve * 0.92, pool * 1.45);
  }

  upperCarve(x: number, z: number): number {
    const s = this.upper.nearest(x, z, 4);
    if (!s) return 0;
    return smoothstep(s.w + 0.9, s.w * 0.2, s.d + this.noise.get(x * 0.3, z * 0.3) * 0.2);
  }

  height(x: number, z: number): number {
    const n = this.noise;
    const d = this.rimDist(x, z);
    const exit = this.exitMask(x, z);
    const rim = (smoothstep(-0.8, 3.2, d) * 1.4 + smoothstep(3, 18, d) * (2.4 + n.fbm(x * 0.04 + 5, z * 0.04, 3) * 3)) * (1 - exit);
    // Forest floor: soft root-mounds and hollows.
    const floor = n.fbm(x * 0.09 + 3, z * 0.09, 3) * 0.32 + n.get(x * 0.35, z * 0.35) * 0.06;
    const pm = this.plateauMask(x, z);
    // Strata steps on the cliff face.
    const strata = pm * (1 - pm) * 4 * (n.get(x * 0.6, z * 0.2) * 0.25);
    let h = Math.max(rim + floor, pm * (PLATEAU_H + n.fbm(x * 0.1, z * 0.1, 2) * 0.25) + floor * (1 - pm)) + strata;
    // Glade: a gently raised, level lawn.
    const gd = Math.hypot(x - GLADE.x, (z - GLADE.z) * 1.1);
    h = THREE.MathUtils.lerp(h, 0.34 + floor * 0.3, smoothstep(GLADE.r + 2, GLADE.r - 3, gd) * (1 - pm));
    // Water channels.
    const lowCarve = this.streamCarve(x, z) * (1 - pm * 0.98);
    h -= lowCarve * (h - WATER_LOW + 0.72);
    const up = this.upperCarve(x, z) * pm;
    h -= up * 0.78;
    // Waterfall notch: cut the lip so the upper channel spills over the edge.
    const notch = smoothstep(FALLS.width * 0.75, FALLS.width * 0.35, Math.abs(x - FALLS.x)) * smoothstep(FALLS.lipZ - 1.5, FALLS.lipZ + 0.4, z) * pm;
    h -= notch * 0.5;
    return h;
  }

  pathValue(x: number, z: number): number {
    const p = this.paths.nearest(x, z, 3);
    if (!p) return 0;
    const w = p.w + this.noise.get(x * 0.4, z * 0.4) * 0.18;
    return smoothstep(w + 0.55, w - 0.25, p.d);
  }
}
