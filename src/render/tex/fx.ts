/** FX sprites: soft dot, smoke puff. */
import { Rng } from '../../core/rng';
import { makeTileNoise, tileFbm, PeriodicNoise, clamp, smoothstep } from '../../core/noise';
import { type TexPair, type RGB, hex, mix3, scale3, makeCanvas, toTexture, pixels, makeWorley, wrapDraw, cached } from './core';

/** Soft round sprite (particles). */
export function softDot(): TexPair {
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
export function smokePuff(): TexPair {
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
