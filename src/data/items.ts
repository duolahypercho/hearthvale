/** Item table (pure data). Icons are keys into ui/icons.ts ICONS. */
import { CROPS, CROP_IDS, type CropId } from './crops';

export type ItemKind = 'tool' | 'seed' | 'produce' | 'resource' | 'placeable';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  icon: string;
  /** Shipping value (0 = can't be shipped). */
  sell: number;
  stack: number;
  /** Seeds: which crop they grow. */
  crop?: CropId;
  /** Tint used by generic icons (seed packets, produce). */
  color?: number;
  description?: string;
}

const base: ItemDef[] = [
  { id: 'hoe', name: 'Hoe', kind: 'tool', icon: 'hoe', sell: 0, stack: 1, description: 'Tills soil for planting.' },
  { id: 'wateringCan', name: 'Watering Can', kind: 'tool', icon: 'wateringCan', sell: 0, stack: 1, description: 'Waters tilled soil.' },
  { id: 'axe', name: 'Axe', kind: 'tool', icon: 'axe', sell: 0, stack: 1, description: 'Chops twigs, stumps and trees.' },
  { id: 'pickaxe', name: 'Pickaxe', kind: 'tool', icon: 'pickaxe', sell: 0, stack: 1, description: 'Breaks stones.' },
  { id: 'scythe', name: 'Scythe', kind: 'tool', icon: 'scythe', sell: 0, stack: 1, description: 'Cuts weeds and harvests crops.' },
  { id: 'wood', name: 'Wood', kind: 'resource', icon: 'wood', sell: 2, stack: 999 },
  { id: 'stone', name: 'Stone', kind: 'resource', icon: 'stone', sell: 2, stack: 999 },
  { id: 'fiber', name: 'Fiber', kind: 'resource', icon: 'fiber', sell: 1, stack: 999 },
  { id: 'sprinkler', name: 'Sprinkler', kind: 'placeable', icon: 'sprinkler', sell: 50, stack: 99, description: 'Waters the 4 adjacent tiles each morning.' },
];

for (const id of CROP_IDS) {
  const c = CROPS[id];
  base.push({ id: c.seeds, name: `${c.name} Seeds`, kind: 'seed', icon: 'seeds', sell: Math.floor(c.seedPrice / 2), stack: 999, crop: id, color: c.color });
  base.push({ id: c.produce, name: c.name, kind: 'produce', icon: id, sell: c.sell, stack: 999, color: c.color });
}

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(base.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}
