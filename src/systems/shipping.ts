/**
 * ShippingSystem: interact with the shipping bin while holding a sellable item to drop the
 * whole stack in; everything shipped is paid out overnight (`day:end`) with a summary event.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { itemDef } from '../data/items';

declare module '../core/events' {
  interface GameEvents {
    'shipping:add': { itemId: string; qty: number; value: number };
    'shipping:summary': { items: { itemId: string; qty: number; value: number }[]; total: number };
  }
}

export class ShippingSystem implements System {
  readonly name = 'shipping';
  private game!: Game;
  private bin: { itemId: string; qty: number }[] = [];

  init(game: Game): void {
    this.game = game;
    game.events.on('player:interact', ({ x, z }) => {
      const obj = game.world.current?.grid.getObject(x, z);
      if (obj?.id !== 'shipping_bin') return;
      const inv = game.services.inventory;
      const s = inv?.selected();
      const def = s ? itemDef(s.id) : undefined;
      if (!inv || !s || !def || def.sell <= 0 || def.kind === 'tool') return;
      const taken = inv.takeFromSlot(game.toolbarSlot, s.qty);
      if (!taken) return;
      this.bin.push({ itemId: taken.id, qty: taken.qty });
      game.events.emit('shipping:add', { itemId: taken.id, qty: taken.qty, value: def.sell * taken.qty });
    });
    game.events.on('day:end', () => this.payout());
  }

  private payout(): void {
    if (!this.bin.length) return;
    const items = this.bin.map((b) => ({ ...b, value: (itemDef(b.itemId)?.sell ?? 0) * b.qty }));
    const total = items.reduce((a, b) => a + b.value, 0);
    this.bin = [];
    this.game.services.economy?.add(total, 'shipping');
    this.game.events.emit('shipping:summary', { items, total });
  }

  save(): unknown {
    return { bin: this.bin };
  }

  load(data: unknown): void {
    this.bin = (data as { bin?: { itemId: string; qty: number }[] })?.bin ?? [];
  }
}
