/**
 * CraftingSystem: recipes from data/recipes.ts, paid for through the `inventory` service.
 * Placeables go to the backpack; the placement grid preview is TODO(crafting team) and should
 * listen to `craft:made` / `item:use` for placeable items.
 *   out: craft:made, craft:failed
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { RECIPES, type RecipeDef } from '../data/recipes';

export interface CraftingApi {
  recipes(): RecipeDef[];
  canCraft(id: string): boolean;
  craft(id: string): boolean;
}

declare module '../core/game' {
  interface GameServices {
    crafting: CraftingApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'craft:made': { recipeId: string; itemId: string; qty: number };
    'craft:failed': { recipeId: string; missing: { itemId: string; qty: number }[] };
  }
}

export class CraftingSystem implements System, CraftingApi {
  readonly name = 'crafting';
  private game!: Game;
  private known = new Set(RECIPES.filter((r) => !r.unlock).map((r) => r.id));

  init(game: Game): void {
    this.game = game;
    game.provide('crafting', this);
  }

  recipes(): RecipeDef[] {
    return RECIPES.filter((r) => this.known.has(r.id));
  }

  private missing(r: RecipeDef): { itemId: string; qty: number }[] {
    const inv = this.game.services.inventory;
    return r.cost.filter((c) => (inv?.count(c.itemId) ?? 0) < c.qty).map((c) => ({ itemId: c.itemId, qty: c.qty - (inv?.count(c.itemId) ?? 0) }));
  }

  canCraft(id: string): boolean {
    const r = RECIPES.find((x) => x.id === id);
    return !!r && this.known.has(id) && this.missing(r).length === 0;
  }

  craft(id: string): boolean {
    const r = RECIPES.find((x) => x.id === id);
    const inv = this.game.services.inventory;
    if (!r || !inv) return false;
    const miss = this.missing(r);
    if (miss.length) {
      this.game.events.emit('craft:failed', { recipeId: id, missing: miss });
      return false;
    }
    for (const c of r.cost) inv.remove(c.itemId, c.qty);
    this.game.events.emit('item:give', { itemId: r.out.itemId, qty: r.out.qty });
    this.game.events.emit('craft:made', { recipeId: id, itemId: r.out.itemId, qty: r.out.qty });
    return true;
  }

  save(): unknown {
    return { known: [...this.known] };
  }

  load(data: unknown): void {
    for (const id of (data as { known?: string[] })?.known ?? []) this.known.add(id);
  }
}
