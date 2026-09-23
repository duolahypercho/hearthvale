/**
 * Driftsand Beach layout (pure data + the height field). +X east, +Z south = out to sea
 * (the ocean fills the bottom of the gameplay view, like looking down a real beach).
 *
 *   z  0..12   grassy bluff with wind-bent pines (the road from town comes in at the west edge)
 *   z 12..27   dunes: marram grass, sea thrift, a sand fence, a boardwalk down to the beach
 *   z 27..40   dry sand: fisherman's shack, campfire ring, driftwood, rowboat, the pier's root
 *   z 38..43   wet sand + swash; the waterline wanders with the cove
 *   z 43..     sea: sandbar breakers, then deep water; the pier runs out to z ≈ 63
 *   west       a rock shelf with tide pools reaching into the surf
 *   east       a rocky headland with the lighthouse
 */
import { Noise2D, smoothstep } from '../../core/noise';

export const BEACH_W = 80;
export const BEACH_D = 66;
export const BEACH_EXTENT = { minX: -26, minZ: -18, maxX: 106, maxZ: 104 };
export const SEA_LEVEL = 0;

export const PIER = { x: 50, z0: 29.5, z1: 63, w: 3.1, deckY: 1.28, head: { x0: 45.5, x1: 54.5, z0: 58.5, z1: 63.4 } };
export const SHACK = { x: 58.6, z: 30.6, w: 5.4, d: 4.2, rot: -Math.PI / 2 };
export const LIGHTHOUSE = { x: 75.5, z: 44.5 };
export const CAMPFIRE = { x: 31.5, z: 33.6 };
export const ROWBOAT = { x: 40.6, z: 38.2, rot: 0.5 };
export const TIDE_POOLS: [number, number, number][] = [
  [9.2, 44.6, 1.5],
  [13.4, 47.6, 1.15],
  [6.2, 48.8, 1.0],
  [15.8, 43.2, 0.85],
];
export const TIDE_POOL_Y = 0.42;
/** Boardwalk down the dunes (Catmull-Rom, x/z). */
export const BOARDWALK: [number, number][] = [
  [0.5, 19.5],
  [6, 20.5],
  [12, 22.8],
  [18, 26.2],
  [23.5, 28.8],
];
export const SAND_FENCE: [number, number][][] = [
  [
    [20, 17.5],
    [26, 18.8],
    [32, 18.2],
    [38, 19.6],
    [44, 19],
  ],
  [
    [52, 20.2],
    [58, 19.4],
    [64, 20.6],
  ],
];
export const BEACH_WARPS = [{ x0: 0, z0: 16, x1: 0, z1: 23, to: 'town', x: 97.4, z: 26, facing: 'left' as const }];
export const BEACH_SPAWN = { x: 2.6, z: 19.8 };

/** Height field + shoreline helpers (deterministic per seed). */
export class BeachShape {
  private n: Noise2D;
  private n2: Noise2D;

  constructor(seed: number) {
    this.n = new Noise2D(seed);
    this.n2 = new Noise2D(seed + 17);
  }

  /** Low-frequency 2-octave noise in [-1, 1] (dressing masks). */
  n2fbm(x: number, z: number): number {
    return this.n2.fbm(x, z, 2);
  }

  /** Waterline z at x (the cove bows inland around the pier). */
  shoreZ(x: number): number {
    return 41 + Math.sin(x * 0.065 + 0.8) * 1.6 + this.n.fbm(x * 0.045, 3.1, 2) * 1.8 - smoothstep(34, 50, x) * smoothstep(66, 50, x) * 1.2;
  }

  /** Signed distance-ish into the west rock shelf (< 0 inside). */
  westRock(x: number, z: number): number {
    const dx = (x - 8) / 11;
    const dz = (z - 45) / 7.5;
    return Math.hypot(dx, dz) - 1 + this.n2.fbm(x * 0.18, z * 0.18, 2) * 0.35;
  }

  /** Signed distance-ish into the east headland (< 0 inside). */
  eastHead(x: number, z: number): number {
    const dx = (x - 77) / 9;
    const dz = (z - 42) / 11;
    return Math.hypot(dx, dz) - 1 + this.n2.fbm(x * 0.12 + 7, z * 0.12, 2) * 0.3;
  }

  height(x: number, z: number): number {
    const n = this.n;
    const s = z - this.shoreZ(x);
    let h: number;
    if (s < 0) {
      // Beach: gentle rise, then dunes, then the bluff.
      h = -s * 0.1 + n.fbm(x * 0.2, z * 0.2, 2) * 0.05;
      const dune = smoothstep(-11, -18, s) * (1.3 + n.fbm(x * 0.06 + 2, z * 0.09, 3) * 1.2);
      const duneRip = smoothstep(-12, -20, s) * Math.sin(x * 0.35 + n.fbm(x * 0.05, z * 0.05, 2) * 6) * 0.25;
      h += dune + duneRip;
      h += smoothstep(13.5, 6.5, z) * (2.8 + n.fbm(x * 0.05, z * 0.05 + 4, 3) * 1.1);
    } else {
      // Sea floor: shelf, sandbar (breaker line), then deep water.
      h = -s * 0.085 - smoothstep(7, 26, s) * 2.6 + 0.32 * Math.exp(-Math.pow((s - 8.5) / 2.4, 2)) + n.fbm(x * 0.1, z * 0.1, 2) * 0.12;
      h = Math.max(h, -4.2);
    }
    // West rock shelf with tide pools.
    const wr = this.westRock(x, z);
    if (wr < 0.35) {
      const shelf = 0.62 + n.fbm(x * 0.4, z * 0.4, 2) * 0.28 + smoothstep(0, -0.6, wr) * 0.35;
      const k = smoothstep(0.35, -0.05, wr);
      h = Math.max(h, h * (1 - k) + shelf * k);
      for (const [px, pz, pr] of TIDE_POOLS) {
        const d = Math.hypot(x - px, (z - pz) * 1.15) / pr;
        if (d < 1.25) h = Math.min(h, h * smoothstep(0.55, 1.2, d) + 0.12 * (1 - smoothstep(0.55, 1.2, d)));
        // Rock lip: every pool is enclosed above its water line (no water plane hanging over low ground).
        if (d > 0.75 && d < 1.7) {
          const k = smoothstep(0.75, 1.0, d) * smoothstep(1.7, 1.25, d);
          const lip = TIDE_POOL_Y + 0.13;
          if (h < lip) h += (lip - h) * k;
        }
      }
    }
    // East headland: a grassy rock knoll the lighthouse stands on.
    const eh = this.eastHead(x, z);
    if (eh < 0.45) {
      const top = 3.6 + n.fbm(x * 0.15, z * 0.15, 2) * 0.5;
      const k = smoothstep(0.45, -0.25, eh);
      h = h * (1 - k) + Math.max(h, top) * k;
    }
    // Sea stack off the headland.
    const st = Math.hypot(x - 69.5, z - 56.5);
    if (st < 3) h = Math.max(h, (1 - smoothstep(1.2, 2.6, st)) * 3.6 - 0.6);
    return h;
  }

  /** 0 on the grassy bluff / headland tops .. 1 on sand. */
  sandMask(x: number, z: number, h: number): number {
    const bluff = smoothstep(11.5, 14.5, z + this.n.fbm(x * 0.1, z * 0.1, 2) * 2.5);
    const head = smoothstep(-0.05, 0.25, this.eastHead(x, z)) + smoothstep(2.2, 1.5, h) * 0.0;
    return Math.min(bluff, Math.max(head, smoothstep(2.4, 1.6, h)));
  }
}
