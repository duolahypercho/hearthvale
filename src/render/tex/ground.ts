/** Ground materials: grass detail, packed dirt, tilled / wet soil, cliff strata, sand. */
import { Rng } from '../../core/rng';
import { makeTileNoise, tileFbm, PeriodicNoise, clamp, smoothstep } from '../../core/noise';
import { type TexPair, type RGB, hex, mix3, scale3, makeCanvas, toTexture, pixels, makeWorley, wrapDraw, cached } from './core';

/** Grayscale-ish grass detail (multiplied onto the seasonal grass tint). ~0.5 = neutral. 1 repeat ≈ 4 tiles. */
export function grassDetail(): TexPair {
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
export function dirt(): TexPair {
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
export function soilImpl(wet: boolean): TexPair {
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
export const soil = (): TexPair => soilImpl(false);
export const wetSoil = (): TexPair => soilImpl(true);

/** Layered rock strata for cliff faces (triplanar mapped). */
export function cliff(): TexPair {
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

export function sand(): TexPair {
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
