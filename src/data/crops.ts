/**
 * Crop table (pure data). `stageDays[i]` = days spent in growth stage i (0 seeded .. 3 nearly
 * ripe); after the last one the crop is harvestable (stage 4). `regrow` = days back from
 * harvest to ripe for multi-harvest crops.
 */
import type { Season } from '../core/time';

export type CropId = 'parsnip' | 'potato' | 'cauliflower' | 'kale' | 'strawberry' | 'tomato' | 'corn' | 'sunflower' | 'pumpkin';

export interface CropDef {
  id: CropId;
  name: string;
  seeds: string;
  produce: string;
  seasons: Season[];
  stageDays: [number, number, number, number];
  regrow?: number;
  sell: number;
  seedPrice: number;
  /** Produce colour (icons, particles). */
  color: number;
}

export const CROPS: Record<CropId, CropDef> = {
  parsnip: { id: 'parsnip', name: 'Parsnip', seeds: 'parsnipSeeds', produce: 'parsnip', seasons: ['spring'], stageDays: [1, 1, 1, 1], sell: 35, seedPrice: 20, color: 0xf2dfa8 },
  potato: { id: 'potato', name: 'Potato', seeds: 'potatoSeeds', produce: 'potato', seasons: ['spring'], stageDays: [1, 1, 2, 2], sell: 80, seedPrice: 50, color: 0xc8955a },
  cauliflower: { id: 'cauliflower', name: 'Cauliflower', seeds: 'cauliflowerSeeds', produce: 'cauliflower', seasons: ['spring'], stageDays: [1, 3, 4, 4], sell: 175, seedPrice: 80, color: 0xf3efe0 },
  kale: { id: 'kale', name: 'Kale', seeds: 'kaleSeeds', produce: 'kale', seasons: ['spring'], stageDays: [1, 2, 2, 1], sell: 110, seedPrice: 70, color: 0x3f7a5a },
  strawberry: { id: 'strawberry', name: 'Strawberry', seeds: 'strawberrySeeds', produce: 'strawberry', seasons: ['spring'], stageDays: [1, 2, 2, 3], regrow: 4, sell: 120, seedPrice: 100, color: 0xe0303c },
  tomato: { id: 'tomato', name: 'Tomato', seeds: 'tomatoSeeds', produce: 'tomato', seasons: ['summer'], stageDays: [2, 2, 3, 4], regrow: 4, sell: 60, seedPrice: 50, color: 0xe4432e },
  corn: { id: 'corn', name: 'Corn', seeds: 'cornSeeds', produce: 'corn', seasons: ['summer', 'fall'], stageDays: [2, 3, 3, 6], regrow: 4, sell: 50, seedPrice: 150, color: 0xf2c43a },
  sunflower: { id: 'sunflower', name: 'Sunflower', seeds: 'sunflowerSeeds', produce: 'sunflower', seasons: ['summer', 'fall'], stageDays: [1, 2, 3, 2], sell: 80, seedPrice: 200, color: 0xf7c52a },
  pumpkin: { id: 'pumpkin', name: 'Pumpkin', seeds: 'pumpkinSeeds', produce: 'pumpkin', seasons: ['fall'], stageDays: [1, 2, 3, 7], sell: 320, seedPrice: 100, color: 0xe8812e },
};

export const CROP_IDS = Object.keys(CROPS) as CropId[];
export const RIPE_STAGE = 4;

/** Stage (0..4) after `days` of growth. */
export function stageForDays(def: CropDef, days: number): number {
  let d = days;
  for (let s = 0; s < 4; s++) {
    if (d < def.stageDays[s]!) return s;
    d -= def.stageDays[s]!;
  }
  return RIPE_STAGE;
}

export function daysToRipe(def: CropDef): number {
  return def.stageDays.reduce((a, b) => a + b, 0);
}
