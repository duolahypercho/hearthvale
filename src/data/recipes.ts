/** Crafting recipes (pure data). `unlock` = friendship / story flag, empty = known from the start. */
export interface RecipeDef {
  id: string;
  name: string;
  /** Item produced (and how many). */
  out: { itemId: string; qty: number };
  cost: { itemId: string; qty: number }[];
  /** Placed on the grid with a preview (vs. goes to the backpack). */
  placeable: boolean;
  unlock?: string;
}

export const RECIPES: RecipeDef[] = [
  { id: 'chest', name: 'Chest', out: { itemId: 'chest', qty: 1 }, cost: [{ itemId: 'wood', qty: 50 }], placeable: true },
  { id: 'sprinkler', name: 'Sprinkler', out: { itemId: 'sprinkler', qty: 1 }, cost: [{ itemId: 'stone', qty: 10 }, { itemId: 'wood', qty: 10 }], placeable: true },
  { id: 'scarecrow', name: 'Scarecrow', out: { itemId: 'scarecrow', qty: 1 }, cost: [{ itemId: 'wood', qty: 20 }, { itemId: 'fiber', qty: 20 }], placeable: true },
  { id: 'woodFence', name: 'Wood Fence', out: { itemId: 'woodFence', qty: 5 }, cost: [{ itemId: 'wood', qty: 5 }], placeable: true },
  { id: 'stonePath', name: 'Stone Path', out: { itemId: 'stonePath', qty: 5 }, cost: [{ itemId: 'stone', qty: 5 }], placeable: true },
  { id: 'hay', name: 'Hay Bale', out: { itemId: 'hay', qty: 3 }, cost: [{ itemId: 'fiber', qty: 10 }], placeable: false },
  { id: 'coal', name: 'Charcoal', out: { itemId: 'coal', qty: 1 }, cost: [{ itemId: 'wood', qty: 20 }], placeable: false },
  // Discovered (crafting system) once every ingredient has passed through the backpack.
  { id: 'brassSprinkler', name: 'Brass Sprinkler', out: { itemId: 'brassSprinkler', qty: 1 }, cost: [{ itemId: 'copperOre', qty: 5 }, { itemId: 'ironOre', qty: 2 }, { itemId: 'stone', qty: 10 }], placeable: true, unlock: 'Dig copper and iron in the Old Mine' },
  { id: 'goldSprinkler', name: 'Gilded Sprinkler', out: { itemId: 'goldSprinkler', qty: 1 }, cost: [{ itemId: 'goldOre', qty: 5 }, { itemId: 'ironOre', qty: 5 }, { itemId: 'aquamarine', qty: 1 }], placeable: true, unlock: 'Bring up gold and aquamarine' },
];
