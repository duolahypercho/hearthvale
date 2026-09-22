/**
 * Procedural texture library. All textures are generated on canvas at startup (seeded,
 * tileable) and cached. Color maps are sRGB; bump/detail maps are linear.
 *
 *   const { map, bump } = textures.wood();
 *
 * Split by material family in render/tex/: ground (grass, dirt, soil, cliff, sand),
 * stone (stone, granite, cobble), wood (planks, grain, bark, shingles, thatch), foliage, fx.
 */
import { grassDetail, dirt, soil, wetSoil, cliff, sand } from './tex/ground';
import { stone, granite, cobble } from './tex/stone';
import { wood, woodGrain, bark, shingles, thatch } from './tex/wood';
import { leaves } from './tex/foliage';
import { softDot, smokePuff } from './tex/fx';

export { setMaxAnisotropy, type TexPair } from './tex/core';

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
  cobble,
  /** Friendly aliases matching DESIGN wording. */
  path: dirt,
  tilledSoil: soil,
  grass: grassDetail,
};
export type TextureName = keyof typeof textures;
