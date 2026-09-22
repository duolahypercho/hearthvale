/**
 * Procedural texture toolkit: canvas helpers, periodic Worley noise, tileable pixel painting and
 * the texture cache. Material families live in ./ground, ./stone, ./wood, ./foliage, ./fx.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { clamp } from '../../core/noise';

export interface TexPair {
  map: THREE.Texture;
  bump?: THREE.Texture;
}

const cache = new Map<string, TexPair>();
const allTextures: THREE.Texture[] = [];
let maxAnisotropy = 8;

export function setMaxAnisotropy(n: number): void {
  maxAnisotropy = n;
  for (const t of allTextures) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

export type RGB = [number, number, number];

export function hex(h: number): RGB {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
export function mix3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function scale3(a: RGB, s: number): RGB {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
}

export function toTexture(canvas: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  allTextures.push(t);
  return t;
}

/** Fill a canvas per-pixel. fn returns [r,g,b] in 0..255 and optional height 0..1. */
export function pixels(
  size: number,
  fn: (u: number, v: number, x: number, y: number) => { c: RGB; h?: number },
): { color: HTMLCanvasElement; height: HTMLCanvasElement } {
  const [cc, cctx] = makeCanvas(size);
  const [hc, hctx] = makeCanvas(size);
  const ci = cctx.createImageData(size, size);
  const hi = hctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { c, h = 0.5 } = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      ci.data[i] = clamp(c[0], 0, 255);
      ci.data[i + 1] = clamp(c[1], 0, 255);
      ci.data[i + 2] = clamp(c[2], 0, 255);
      ci.data[i + 3] = 255;
      const hv = clamp(h) * 255;
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv;
      hi.data[i + 3] = 255;
    }
  }
  cctx.putImageData(ci, 0, 0);
  hctx.putImageData(hi, 0, 0);
  return { color: cc, height: hc };
}

/** Periodic worley: returns f1, f2 distances (in cell units) and id of nearest cell. */
export function makeWorley(cells: number, seed: string, jitter = 0.8) {
  const rng = new Rng(seed);
  const pts = new Float32Array(cells * cells * 2);
  const ids = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    pts[i * 2] = 0.5 + (rng.next() - 0.5) * jitter;
    pts[i * 2 + 1] = 0.5 + (rng.next() - 0.5) * jitter;
    ids[i] = rng.next();
  }
  return (u: number, v: number, sx = 1): { f1: number; f2: number; id: number; dx: number; dy: number } => {
    const cx = cells * sx;
    const x = u * cx;
    const y = v * cells;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    let dx = 0;
    let dy = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = xi + ox;
        const gy = yi + oy;
        const wx = ((gx % cx) + cx) % cx;
        const wy = ((gy % cells) + cells) % cells;
        const k = (wy * cells + (wx % cells)) | 0;
        const px = gx + pts[k * 2]!;
        const py = gy + pts[k * 2 + 1]!;
        const ddx = (px - x) / sx;
        const ddy = py - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = ids[k]!;
          dx = ddx;
          dy = ddy;
        } else if (d < f2) f2 = d;
      }
    }
    return { f1, f2, id, dx, dy };
  };
}

/** Draw a shape wrapped across tile edges. */
export function wrapDraw(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * size;
      const py = y + oy * size;
      if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
      draw(px, py);
    }
  }
}

export function cached(key: string, build: () => TexPair): TexPair {
  let t = cache.get(key);
  if (!t) {
    t = build();
    cache.set(key, t);
  }
  return t;
}
