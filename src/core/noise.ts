/**
 * Seeded 2D simplex noise + fbm. CPU side, used for world generation.
 * (GLSL equivalents live in render/shaders/noise.ts — they are not bit-identical.)
 */
import { Rng } from './rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;

export class Noise2D {
  private perm = new Uint8Array(512);

  constructor(seed: number | string = 1) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  /** Simplex noise in [-1, 1]. */
  get(xin: number, yin: number): number {
    const perm = this.perm;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) {
      const g = GRAD[perm[ii + perm[jj]!]! & 7]!;
      tt *= tt;
      n += tt * tt * (g[0] * x0 + g[1] * y0);
    }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) {
      const g = GRAD[perm[ii + i1 + perm[jj + j1]!]! & 7]!;
      tt *= tt;
      n += tt * tt * (g[0] * x1 + g[1] * y1);
    }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) {
      const g = GRAD[perm[ii + 1 + perm[jj + 1]!]! & 7]!;
      tt *= tt;
      n += tt * tt * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  }

  /** Fractal sum, roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.get(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** Tileable value noise on an integer period — for seamless canvas textures. */
export class PeriodicNoise {
  private vals: Float32Array;
  constructor(private period: number, seed: number | string = 1) {
    const rng = new Rng(seed);
    this.vals = new Float32Array(period * period);
    for (let i = 0; i < this.vals.length; i++) this.vals[i] = rng.next();
  }
  private v(x: number, y: number): number {
    const p = this.period;
    return this.vals[(((y % p) + p) % p) * p + (((x % p) + p) % p)]!;
  }
  /** Value noise in [0,1] with coordinates in lattice units (period repeats). */
  get(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    const a = this.v(xi, yi);
    const b = this.v(xi + 1, yi);
    const c = this.v(xi, yi + 1);
    const d = this.v(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }
}

/**
 * Tileable fbm over a unit square: u,v in [0,1), base = lattice cells at octave 0.
 * Returns [0,1].
 */
export function tileFbm(
  noises: PeriodicNoise[],
  u: number,
  v: number,
  base: number,
  gain = 0.5,
): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = base;
  for (const n of noises) {
    sum += amp * n.get(u * f, v * f);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Build the octave stack for tileFbm (each octave has period base*2^i). */
export function makeTileNoise(base: number, octaves: number, seed: string): PeriodicNoise[] {
  const out: PeriodicNoise[] = [];
  let p = base;
  for (let i = 0; i < octaves; i++) {
    out.push(new PeriodicNoise(p, `${seed}:${i}`));
    p *= 2;
  }
  return out;
}

export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
