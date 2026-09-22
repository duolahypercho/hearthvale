/**
 * Procedural texture library. All textures are generated on canvas at startup (seeded,
 * tileable) and cached. Color maps are sRGB; bump/detail maps are linear.
 *
 *   const { map, bump } = textures.wood();
 *
 * Available: grassDetail, dirt (path), soil (tilled), wetSoil, stone (cobbles), cliff (strata),
 * wood (planks), woodGrain, bark, shingles, thatch, leaves, sand.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { makeTileNoise, tileFbm, PeriodicNoise, clamp, smoothstep } from '../core/noise';

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

type RGB = [number, number, number];

function hex(h: number): RGB {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
function mix3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function scale3(a: RGB, s: number): RGB {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
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
function pixels(
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
function makeWorley(cells: number, seed: string, jitter = 0.8) {
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
function wrapDraw(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * size;
      const py = y + oy * size;
      if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
      draw(px, py);
    }
  }
}

function cached(key: string, build: () => TexPair): TexPair {
  let t = cache.get(key);
  if (!t) {
    t = build();
    cache.set(key, t);
  }
  return t;
}

// ───────────────────────────────────────────────────────────────── textures

/** Grayscale-ish grass detail (multiplied onto the seasonal grass tint). ~0.5 = neutral. 1 repeat ≈ 4 tiles. */
function grassDetail(): TexPair {
  return cached('grassDetail', () => {
    const S = 512;
    const n = makeTileNoise(4, 5, 'grass');
    const { color } = pixels(S, (u, v) => {
      const f = tileFbm(n, u, v, 4);
      const g = 0.5 + (f - 0.5) * 0.35;
      const val = g * 255;
      return { c: [val, val, val] };
    });
    const ctx = color.getContext('2d')!;
    const rng = new Rng('grass-strokes');
    ctx.lineCap = 'round';
    for (let i = 0; i < 5200; i++) {
      const x = rng.next() * S;
      const y = rng.next() * S;
      const len = 5 + rng.next() * 9;
      const ang = -Math.PI / 2 + (rng.next() - 0.5) * 1.1;
      const light = rng.next();
      const l = light < 0.5 ? 70 + light * 80 : 150 + light * 60;
      ctx.strokeStyle = `rgba(${l},${l},${l},${0.25 + rng.next() * 0.3})`;
      ctx.lineWidth = 1 + rng.next() * 1.4;
      wrapDraw(S, x, y, len, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(
          px + Math.cos(ang) * len * 0.5 + (rng.next() - 0.5) * 3,
          py + Math.sin(ang) * len * 0.5,
          px + Math.cos(ang) * len,
          py + Math.sin(ang) * len,
        );
        ctx.stroke();
      });
    }
    return { map: toTexture(color, false) };
  });
}

/** Packed-earth path with pebbles. 1 repeat ≈ 3 tiles. */
function dirt(): TexPair {
  return cached('dirt', () => {
    const S = 512;
    const n = makeTileNoise(4, 5, 'dirt');
    const n2 = makeTileNoise(16, 3, 'dirt2');
    const base = hex(0xc49a6c);
    const dark = hex(0x9a7148);
    const light = hex(0xdcb98a);
    const { color, height } = pixels(S, (u, v) => {
      const f = tileFbm(n, u, v, 4);
      const g = tileFbm(n2, u, v, 16);
      let c = mix3(dark, base, smoothstep(0.25, 0.6, f));
      c = mix3(c, light, smoothstep(0.62, 0.85, f) * 0.6);
      c = scale3(c, 0.9 + g * 0.2);
      return { c, h: 0.4 + f * 0.2 };
    });
    const ctx = color.getContext('2d')!;
    const hctx = height.getContext('2d')!;
    const rng = new Rng('pebbles');
    for (let i = 0; i < 420; i++) {
      const x = rng.next() * S;
      const y = rng.next() * S;
      const r = 1.5 + rng.next() * rng.next() * 7;
      const rot = rng.next() * Math.PI;
      const tone = 150 + rng.next() * 70;
      wrapDraw(S, x, y, r * 2, (px, py) => {
        ctx.fillStyle = 'rgba(70,50,30,0.35)';
        ctx.beginPath();
        ctx.ellipse(px + 1.2, py + 1.6, r * 1.15, r * 0.8, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgb(${tone},${tone * 0.92},${tone * 0.82})`;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.72, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,245,225,0.35)';
        ctx.beginPath();
        ctx.ellipse(px - r * 0.25, py - r * 0.25, r * 0.45, r * 0.3, rot, 0, Math.PI * 2);
        ctx.fill();
        hctx.fillStyle = 'rgba(255,255,255,0.8)';
        hctx.beginPath();
        hctx.ellipse(px, py, r, r * 0.72, rot, 0, Math.PI * 2);
        hctx.fill();
      });
    }
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Tilled soil with furrows. 1 repeat = 1 tile (3 furrows). */
function soilImpl(wet: boolean): TexPair {
  return cached(wet ? 'wetSoil' : 'soil', () => {
    const S = 256;
    const n = makeTileNoise(4, 4, 'soil');
    const n2 = makeTileNoise(32, 2, 'soil-fine');
    const base: RGB = wet ? hex(0x4a3222) : hex(0x7a5438);
    const dark: RGB = wet ? hex(0x2e1d14) : hex(0x553824);
    const light: RGB = wet ? hex(0x5e4230) : hex(0x9a7050);
    const { color, height } = pixels(S, (u, v) => {
      const f = tileFbm(n, u, v, 4);
      const fine = tileFbm(n2, u, v, 32);
      const furrow = Math.sin((v + (f - 0.5) * 0.05) * Math.PI * 2 * 3);
      const ridge = furrow * 0.5 + 0.5;
      const slope = Math.cos((v + (f - 0.5) * 0.05) * Math.PI * 2 * 3);
      let c = mix3(dark, base, ridge);
      c = mix3(c, light, Math.max(0, -slope) * ridge * 0.55);
      c = scale3(c, 0.85 + fine * 0.3);
      return { c, h: ridge * 0.8 + fine * 0.2 };
    });
    const ctx = color.getContext('2d')!;
    const rng = new Rng(wet ? 'clods-w' : 'clods');
    for (let i = 0; i < 160; i++) {
      const x = rng.next() * S;
      const y = rng.next() * S;
      const r = 1.2 + rng.next() * 3.2;
      const t = rng.next();
      wrapDraw(S, x, y, r * 2, (px, py) => {
        ctx.fillStyle = wet ? 'rgba(20,12,8,0.5)' : 'rgba(40,24,14,0.45)';
        ctx.beginPath();
        ctx.ellipse(px + 0.8, py + 1.2, r, r * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = wet ? `rgba(${90 + t * 30},${64 + t * 20},${46 + t * 14},1)` : `rgba(${140 + t * 40},${100 + t * 30},${70 + t * 20},1)`;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}
const soil = (): TexPair => soilImpl(false);
const wetSoil = (): TexPair => soilImpl(true);

/** Rounded cobble/fieldstone blocks (foundations, chimneys, wells). */
function stone(): TexPair {
  return cached('stone', () => {
    const S = 512;
    const w = makeWorley(5, 'stone', 0.75);
    const n = makeTileNoise(8, 4, 'stone-n');
    const tones: RGB[] = [hex(0xa9a49a), hex(0x8f8a82), hex(0xb8ad98), hex(0x9c978f), hex(0x857f76)];
    const { color, height } = pixels(S, (u, v) => {
      const c = w(u, v);
      const edge = c.f2 - c.f1;
      const f = tileFbm(n, u, v, 8);
      const tone = tones[Math.floor(c.id * tones.length)]!;
      const bevel = smoothstep(0.0, 0.16, edge);
      const light = 1 + (-c.dx - c.dy) * 0.35 * (1 - bevel);
      let col = scale3(tone, (0.82 + f * 0.3) * light);
      const mortar: RGB = hex(0x4e463d);
      col = mix3(mortar, col, smoothstep(0.02, 0.07, edge));
      return { c: col, h: bevel * 0.85 + f * 0.15 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Neutral speckled granite detail (multiplied onto vertex-coloured boulders/pebbles) + bump. */
function granite(): TexPair {
  return cached('granite', () => {
    const S = 256;
    const n = makeTileNoise(4, 5, 'granite');
    const n2 = makeTileNoise(24, 2, 'granite-fine');
    const w = makeWorley(6, 'granite-w', 0.9);
    const { color, height } = pixels(S, (u, v) => {
      const f = tileFbm(n, u, v, 4);
      const fine = tileFbm(n2, u, v, 24);
      const c = w(u, v);
      const crack = smoothstep(0.0, 0.05, c.f2 - c.f1);
      const speck = fine > 0.72 ? 0.82 : fine < 0.22 ? 1.08 : 1;
      const l = (0.84 + f * 0.24) * speck * (0.8 + 0.2 * crack);
      const tint: RGB = [255 * l, 252 * l, 246 * l];
      return { c: tint, h: f * 0.6 + fine * 0.25 + crack * 0.15 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Layered rock strata for cliff faces (triplanar mapped). */
function cliff(): TexPair {
  return cached('cliff', () => {
    const S = 512;
    const n = makeTileNoise(4, 5, 'cliff');
    const n2 = makeTileNoise(12, 3, 'cliff2');
    const w = makeWorley(6, 'cliff-w', 0.9);
    const bands: RGB[] = [hex(0x9d8f7c), hex(0x8a7d6b), hex(0xab9d86), hex(0x7f7262), hex(0x968a78), hex(0xb3a58e)];
    const { color, height } = pixels(S, (u, v) => {
      const f = tileFbm(n, u, v, 4);
      const g = tileFbm(n2, u, v, 12);
      const vv = v * 6 + (f - 0.5) * 1.6;
      const bi = Math.floor(vv);
      const bf = vv - bi;
      const band = bands[((bi % bands.length) + bands.length) % bands.length]!;
      const c = w(u, v, 1);
      const crack = smoothstep(0.0, 0.05, c.f2 - c.f1);
      const ledge = smoothstep(0.0, 0.12, bf) * (1 - smoothstep(0.8, 1.0, bf) * 0.5);
      let col = scale3(band, 0.78 + g * 0.35);
      col = scale3(col, 0.62 + 0.38 * ledge);
      col = mix3(hex(0x3f372e), col, 0.35 + 0.65 * crack);
      return { c: col, h: ledge * 0.6 + crack * 0.25 + g * 0.15 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Vertical wooden planks with grain + gaps. 1 repeat = 6 planks. */
function wood(): TexPair {
  return cached('wood', () => {
    const S = 512;
    const planks = 6;
    const n = makeTileNoise(4, 4, 'wood');
    const grainN = new PeriodicNoise(8, 'grain');
    const rng = new Rng('planks');
    const plankTone: number[] = [];
    const plankOff: number[] = [];
    const plankSeam: number[] = [];
    for (let i = 0; i < planks; i++) {
      plankTone.push(0.82 + rng.next() * 0.3);
      plankOff.push(rng.next() * 10);
      plankSeam.push(rng.next());
    }
    const base = hex(0xa0714a);
    const dark = hex(0x6e4a2e);
    const { color, height } = pixels(S, (u, v) => {
      const pu = u * planks;
      const pi = Math.floor(pu);
      const pf = pu - pi;
      const f = tileFbm(n, u, v, 4);
      const grain = Math.sin((pf * 3 + grainN.get(pf * 2 + plankOff[pi]!, v * 8) * 5 + plankOff[pi]!) * 6.0);
      const gl = grain * 0.5 + 0.5;
      let c = mix3(dark, base, 0.55 + gl * 0.45);
      c = scale3(c, plankTone[pi]! * (0.9 + f * 0.2));
      const edge = Math.min(pf, 1 - pf);
      const gap = smoothstep(0.0, 0.035, edge);
      const seamV = Math.abs(v - plankSeam[pi]!);
      const seam = smoothstep(0.0, 0.006, seamV);
      const bevel = smoothstep(0.02, 0.1, edge);
      c = scale3(c, 0.55 + 0.45 * gap * seam);
      c = scale3(c, 0.85 + 0.15 * bevel);
      return { c, h: gap * seam * (0.7 + 0.2 * bevel) + gl * 0.1 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Continuous wood grain (posts, crates, tool handles). */
function woodGrain(): TexPair {
  return cached('woodGrain', () => {
    const S = 256;
    const g = new PeriodicNoise(6, 'wg');
    const n = makeTileNoise(4, 3, 'wg2');
    const base = hex(0xa8794f);
    const dark = hex(0x734d2f);
    const { color, height } = pixels(S, (u, v) => {
      const f = tileFbm(n, u, v, 4);
      const ring = Math.sin((u * 10 + g.get(u * 6, v * 2) * 4) * Math.PI * 2) * 0.5 + 0.5;
      const c = scale3(mix3(dark, base, 0.4 + ring * 0.6), 0.9 + f * 0.2);
      return { c, h: 0.4 + ring * 0.2 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Tree bark, vertical ridges. */
function bark(): TexPair {
  return cached('bark', () => {
    const S = 256;
    const n = makeTileNoise(4, 4, 'bark');
    const r = new PeriodicNoise(10, 'bark-r');
    const base = hex(0x7a5a40);
    const dark = hex(0x3e2b1e);
    const { color, height } = pixels(S, (u, v) => {
      const f = tileFbm(n, u, v, 4);
      const ridge = r.get(u * 10 + f * 1.5, v * 2.5);
      const rr = smoothstep(0.3, 0.75, ridge);
      const c = scale3(mix3(dark, base, rr), 0.85 + f * 0.3);
      return { c, h: rr };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Scalloped roof shingles. 1 repeat = 8 rows. Neutral warm tone; tint via material.color. */
function shingles(): TexPair {
  return cached('shingles', () => {
    const S = 512;
    const rows = 8;
    const cols = 7;
    const n = makeTileNoise(8, 3, 'shing');
    const rng = new Rng('shing');
    const tones: number[] = [];
    for (let i = 0; i < rows * cols * 2; i++) tones.push(0.8 + rng.next() * 0.35);
    const { color, height } = pixels(S, (u, v) => {
      const rv = v * rows;
      const ri = Math.floor(rv);
      const rf = rv - ri;
      const off = (ri % 2) * 0.5;
      const cu = u * cols + off;
      const ci = Math.floor(cu);
      const cf = cu - ci;
      // rounded bottom: shingle ends at rf ~ 1 with curved edge
      const curve = 0.82 + 0.18 * Math.sqrt(Math.max(0, 1 - Math.pow((cf - 0.5) * 2, 2)));
      const inShingle = rf < curve ? 1 : 0;
      const tone = tones[(ri * cols + (((ci % cols) + cols) % cols)) % tones.length]!;
      const f = tileFbm(n, u, v, 8);
      const shade = inShingle ? 0.62 + 0.38 * smoothstep(0, 0.75, rf) : 0.35;
      const side = smoothstep(0.0, 0.06, Math.min(cf, 1 - cf));
      const val = 200 * tone * shade * (0.75 + 0.25 * side) * (0.88 + f * 0.24);
      return { c: [val, val * 0.97, val * 0.94], h: inShingle ? rf * 0.9 * side : 0.05 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}

/** Straw thatch. */
function thatch(): TexPair {
  return cached('thatch', () => {
    const S = 512;
    const [c, ctx] = makeCanvas(S);
    const [h, hctx] = makeCanvas(S);
    ctx.fillStyle = '#8a6a36';
    ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#404040';
    hctx.fillRect(0, 0, S, S);
    const rng = new Rng('thatch');
    ctx.lineCap = 'round';
    hctx.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = rng.next() * S;
      const y = rng.next() * S;
      const len = 18 + rng.next() * 30;
      const ang = Math.PI / 2 + (rng.next() - 0.5) * 0.35;
      const t = rng.next();
      const r = 170 + t * 70;
      ctx.strokeStyle = `rgba(${r},${r * 0.8},${r * 0.45},0.9)`;
      ctx.lineWidth = 1 + rng.next() * 1.5;
      hctx.strokeStyle = `rgba(${150 + t * 100},${150 + t * 100},${150 + t * 100},0.9)`;
      hctx.lineWidth = ctx.lineWidth;
      wrapDraw(S, x, y, len, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
        hctx.beginPath();
        hctx.moveTo(px, py);
        hctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        hctx.stroke();
      });
    }
    for (let r = 0; r < 6; r++) {
      const y = (r / 6) * S;
      const g = ctx.createLinearGradient(0, y, 0, y + S / 6);
      g.addColorStop(0, 'rgba(40,25,10,0.35)');
      g.addColorStop(0.3, 'rgba(40,25,10,0)');
      g.addColorStop(1, 'rgba(40,25,10,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, S, S / 6);
    }
    return { map: toTexture(c, true), bump: toTexture(h, false) };
  });
}

/** Leafy clumps, grayscale (tint via material.color / vertex colors). */
function leaves(): TexPair {
  return cached('leaves', () => {
    const S = 512;
    const [c, ctx] = makeCanvas(S);
    const [h, hctx] = makeCanvas(S);
    ctx.fillStyle = 'rgb(200,200,200)';
    ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = 'rgb(90,90,90)';
    hctx.fillRect(0, 0, S, S);
    const rng = new Rng('leaves');
    for (let i = 0; i < 2600; i++) {
      const x = rng.next() * S;
      const y = rng.next() * S;
      const r = 6 + rng.next() * 9;
      const rot = rng.next() * Math.PI * 2;
      const t = rng.next();
      const l = 180 + t * 75;
      wrapDraw(S, x, y, r * 2, (px, py) => {
        ctx.fillStyle = 'rgba(60,60,60,0.12)';
        ctx.beginPath();
        ctx.ellipse(px + 1.5, py + 2.5, r, r * 0.5, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgb(${l},${l},${l})`;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.5, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${l * 0.75},${l * 0.75},${l * 0.75},0.8)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(rot) * r * 0.8, py - Math.sin(rot) * r * 0.8);
        ctx.lineTo(px + Math.cos(rot) * r * 0.8, py + Math.sin(rot) * r * 0.8);
        ctx.stroke();
        const hv = 120 + t * 135;
        hctx.fillStyle = `rgb(${hv},${hv},${hv})`;
        hctx.beginPath();
        hctx.ellipse(px, py, r, r * 0.5, rot, 0, Math.PI * 2);
        hctx.fill();
      });
    }
    return { map: toTexture(c, true), bump: toTexture(h, false) };
  });
}

function sand(): TexPair {
  return cached('sand', () => {
    const S = 256;
    const n = makeTileNoise(8, 4, 'sand');
    const base = hex(0xe2cc9a);
    const { color } = pixels(S, (u, v, x, y) => {
      const f = tileFbm(n, u, v, 8);
      const speck = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      return { c: scale3(base, 0.9 + f * 0.15 + Math.abs(speck) * 0.06) };
    });
    return { map: toTexture(color, true) };
  });
}

/** Soft round sprite (particles). */
function softDot(): TexPair {
  return cached('softDot', () => {
    const S = 64;
    const [c, ctx] = makeCanvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return { map: toTexture(c, false, false) };
  });
}

/** Puffy smoke sprite. */
function smokePuff(): TexPair {
  return cached('smokePuff', () => {
    const S = 128;
    const [c, ctx] = makeCanvas(S);
    const rng = new Rng('smoke');
    for (let i = 0; i < 14; i++) {
      const x = S / 2 + (rng.next() - 0.5) * S * 0.4;
      const y = S / 2 + (rng.next() - 0.5) * S * 0.4;
      const r = S * (0.15 + rng.next() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    return { map: toTexture(c, false, false) };
  });
}

export const textures = {
  grassDetail,
  dirt,
  soil,
  wetSoil,
  stone,
  cliff,
  wood,
  woodGrain,
  bark,
  shingles,
  thatch,
  leaves,
  sand,
  softDot,
  smokePuff,
  granite,
  /** Friendly aliases matching DESIGN wording. */
  path: dirt,
  tilledSoil: soil,
  grass: grassDetail,
};
export type TextureName = keyof typeof textures;
