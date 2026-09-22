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
];
