/**
 * Lantern Hall bundles (pure data): the story spine. Each lantern of the hall is relit by a
 * bundle of seasonal goods; relighting all of them restores the hall (and the festival).
 */
export interface BundleDef {
  id: string;
  lantern: string;
  name: string;
  items: { itemId: string; qty: number }[];
  reward: { gold?: number; itemId?: string; qty?: number };
}

export const BUNDLES: BundleDef[] = [
  { id: 'springSeeds', lantern: 'east', name: 'Spring Sowing', items: [{ itemId: 'parsnip', qty: 5 }, { itemId: 'potato', qty: 3 }, { itemId: 'cauliflower', qty: 1 }], reward: { itemId: 'sprinkler', qty: 3 } },
  { id: 'summerGold', lantern: 'south', name: 'Summer Gold', items: [{ itemId: 'tomato', qty: 5 }, { itemId: 'corn', qty: 3 }, { itemId: 'sunflower', qty: 1 }], reward: { gold: 500 } },
  { id: 'fallHarvest', lantern: 'west', name: 'Harvest Table', items: [{ itemId: 'pumpkin', qty: 2 }, { itemId: 'corn', qty: 5 }], reward: { gold: 750 } },
  { id: 'crafters', lantern: 'north', name: "Crafter's Lantern", items: [{ itemId: 'wood', qty: 99 }, { itemId: 'stone', qty: 99 }, { itemId: 'fiber', qty: 50 }], reward: { gold: 300 } },
];
