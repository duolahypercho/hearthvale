/** Stone materials: fieldstone cobbles, granite detail, town cobblestone paving. */
import { Rng } from '../../core/rng';
import { makeTileNoise, tileFbm, PeriodicNoise, clamp, smoothstep } from '../../core/noise';
import { type TexPair, type RGB, hex, mix3, scale3, makeCanvas, toTexture, pixels, makeWorley, wrapDraw, cached } from './core';

/** Rounded cobble/fieldstone blocks (foundations, chimneys, wells). */
export function stone(): TexPair {
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
export function granite(): TexPair {
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

/** Town paving: rounded cobblestones in loose courses, warm greys + sandstone, sandy joints. 1 repeat ≈ 3 m. */
export function cobble(): TexPair {
  return cached('cobble', () => {
    const S = 512;
    const w = makeWorley(9, 'cobble', 0.55);
    const n = makeTileNoise(8, 4, 'cobble-n');
    const tones: RGB[] = [hex(0xb4aa9c), hex(0x9f978c), hex(0xc2b39a), hex(0xa99c8a), hex(0x8e8880), hex(0xbfae98)];
    const { color, height } = pixels(S, (u, v) => {
      const c = w(u, v);
      const edge = c.f2 - c.f1;
      const f = tileFbm(n, u, v, 8);
      const tone = tones[Math.floor(c.id * tones.length)]!;
      const dome = smoothstep(0.0, 0.3, edge);
      const light = 1 + (-c.dx - c.dy) * 0.45 * (1 - smoothstep(0.0, 0.22, edge));
      let col = scale3(tone, (0.8 + f * 0.32) * light * (0.9 + dome * 0.12));
      const joint: RGB = mix3(hex(0x6a5e4e), hex(0x8a7a60), f);
      col = mix3(joint, col, smoothstep(0.03, 0.09, edge));
      return { c: col, h: dome * 0.9 + f * 0.1 };
    });
    return { map: toTexture(color, true), bump: toTexture(height, false) };
  });
}
