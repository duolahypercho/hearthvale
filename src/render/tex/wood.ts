/** Wood materials: planks, grain, bark, shingles, thatch. */
import { Rng } from '../../core/rng';
import { makeTileNoise, tileFbm, PeriodicNoise, clamp, smoothstep } from '../../core/noise';
import { type TexPair, type RGB, hex, mix3, scale3, makeCanvas, toTexture, pixels, makeWorley, wrapDraw, cached } from './core';

/** Vertical wooden planks with grain + gaps. 1 repeat = 6 planks. */
export function wood(): TexPair {
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
export function woodGrain(): TexPair {
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
export function bark(): TexPair {
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
export function shingles(): TexPair {
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
export function thatch(): TexPair {
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
