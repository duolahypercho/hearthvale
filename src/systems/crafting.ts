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
    /** A locked recipe was discovered (every ingredient has now passed through the backpack). */
    'craft:learned': { recipeId: string };
  }
}

export class CraftingSystem implements System, CraftingApi {
  readonly name = 'crafting';
  private game!: Game;
  private known = new Set(RECIPES.filter((r) => !r.unlock).map((r) => r.id));
  /** Items that have ever been in the backpack (drives recipe discovery). */
  private seen = new Set<string>();

  init(game: Game): void {
    this.game = game;
    game.provide('crafting', this);
    game.events.on('item:gained', ({ itemId }) => this.see(itemId));
    game.events.on('inventory:change', ({ slots }) => {
      for (const s of slots) if (s) this.see(s.id, true);
      this.discover(false);
    });
  }

  private see(itemId: string, quiet = false): void {
    if (this.seen.has(itemId)) return;
    this.seen.add(itemId);
    if (!quiet) this.discover(true);
  }

  /** Learn locked recipes whose ingredients have all been seen. */
  private discover(announce: boolean): void {
    for (const r of RECIPES) {
      if (this.known.has(r.id) || !r.unlock) continue;
      if (!r.cost.every((c) => this.seen.has(c.itemId))) continue;
      this.known.add(r.id);
      this.game.events.emit('craft:learned', { recipeId: r.id });
      if (announce) this.game.events.emit('ui:toast', { text: `New recipe: <b>${r.name}</b>`, icon: r.out.itemId, kind: 'good' });
    }
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
    return { known: [...this.known], seen: [...this.seen] };
  }

  load(data: unknown): void {
    const d = data as { known?: string[]; seen?: string[] } | undefined;
    for (const id of d?.known ?? []) this.known.add(id);
    for (const id of d?.seen ?? []) this.seen.add(id);
  }
}
