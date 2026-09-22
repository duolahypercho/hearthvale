/** Foliage: leafy clump detail. */
import { Rng } from '../../core/rng';
import { makeTileNoise, tileFbm, PeriodicNoise, clamp, smoothstep } from '../../core/noise';
import { type TexPair, type RGB, hex, mix3, scale3, makeCanvas, toTexture, pixels, makeWorley, wrapDraw, cached } from './core';

/** Leafy clumps, grayscale (tint via material.color / vertex colors). */
export function leaves(): TexPair {
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
