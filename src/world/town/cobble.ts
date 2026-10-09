/**
 * Town street cobbles (r16 critic: "the voronoi cobbles are large flat grey plates with little colour
 * variation and fill 30–40 % of plaza frames"). Hearthvale's own sett texture for the terrain's path
 * channel: smaller stones (13 cells a tile, set tighter), each with its own hue — warm sandstone,
 * cool blue-grey granite, a few rust and moss-green stones — and value, a worn crown lit on one side
 * with a darker rounded shoulder, chipped / worn edges, soil and moss in the joints.
 */
import { makeTileNoise, tileFbm, smoothstep } from '../../core/noise';
import { type TexPair, type RGB, hex, mix3, scale3, toTexture, pixels, makeWorley, cached } from '../../render/tex/core';

export function townCobble(): TexPair {
  return cached('town-cobble', () => {
    const S = 512;
    const w = makeWorley(13, 'town-cobble', 0.62);
    const n = makeTileNoise(8, 4, 'town-cobble-n');
    const chip = makeTileNoise(32, 3, 'town-cobble-chip');
    // A palette with real hue spread: sandstones, blue-grey granite, slate, a few warm rust stones.
    const tones: RGB[] = [hex(0xb4aa96), hex(0xa89e8a), hex(0xbcb098), hex(0x9e9e9c), hex(0x949aa0), hex(0xa8a49c), hex(0xb0a08a), hex(0xa09484), hex(0xbab4a8), hex(0x908e8a)];
    const { color, height } = pixels(S, (u, v) => {
      const c = w(u, v);
      const edge = c.f2 - c.f1;
      const f = tileFbm(n, u, v, 8);
      const ch = tileFbm(chip, u, v, 32);
      let tone = tones[Math.floor(c.id * tones.length)]!;
      // A per-stone value jitter on top of the palette (no two neighbours the same grey).
      const vj = 0.86 + ((c.id * 7.31) % 1) * 0.24;
      if ((c.id * 13.7) % 1 < 0.06) tone = mix3(tone, hex(0x7a8a5a), 0.35);
      tone = scale3(tone, vj);
      // Worn edges: the joint eats into the stone where the chip noise is high.
      const e = edge - (ch - 0.5) * 0.05;
      const dome = smoothstep(0.0, 0.26, e);
      const light = 1 + (-c.dx - c.dy) * 0.5 * (1 - smoothstep(0.0, 0.2, e));
      let col = scale3(tone, (0.82 + f * 0.28) * light * (0.88 + dome * 0.16));
      // Polished crown (foot traffic) — a little lighter and less textured in each stone's middle.
      col = mix3(col, scale3(tone, 1.08), smoothstep(0.16, 0.34, e) * 0.35);
      const joint: RGB = mix3(hex(0x5e523e), hex(0x6e7a46), smoothstep(0.45, 0.7, f));
      col = mix3(joint, col, smoothstep(0.025, 0.085, e));
      return { c: col, h: dome * 0.9 + f * 0.1 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}
