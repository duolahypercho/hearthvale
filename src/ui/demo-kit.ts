/**
 * Screenshot staging for the UI screens. When a demo has been staged (`?demo=…` / `__game.demo()`), the first
 * backpack / shop / workbench open stocks a lived-in backpack — quality produce, fish, ores, crafting stock —
 * so critics see full grids, star badges, craftable recipes and a discovered one. Never runs in normal play
 * (it only arms on `demo:stage`), and only fills empty backpack slots.
 *
 * `ui-*` demos (demos.ts) name each screen; `ui-hud` also fires a few toasts and bumps the toolbar;
 * `ui-placement` holds a sprinkler so the in-world placement ghost shows.
 */
import type { Game } from '../core/game';
import { itemDef } from '../data/items';

const STOCK: [string, number, number][] = [
  // [item, qty, quality]
  ['parsnip', 12, 2],
  ['cauliflower', 3, 3],
  ['strawberry', 9, 1],
  ['potato', 14, 0],
  ['kale', 5, 1],
  ['pondPerch', 2, 0],
  ['lanternEel', 1, 2],
  ['cockle', 4, 0],
  ['wood', 86, 0],
  ['stone', 64, 0],
  ['fiber', 40, 0],
  ['copperOre', 14, 0],
  ['ironOre', 6, 0],
  ['quartz', 2, 0],
  ['amethyst', 1, 0],
  ['brassSprinkler', 1, 0],
];

export class DemoKit {
  private armed = false;
  private stocked = false;
  /** `ui-hud`: toasts linger so a screenshot taken seconds after boot still shows the stack. */
  holdToasts = false;

  constructor(private game: Game) {
    game.events.on('demo:stage', ({ name }) => {
      this.armed = true;
      if (name === 'ui-hud' || name === 'ui-hud-low') {
        this.holdToasts = true;
        this.hudShow();
      }
      // `ui-hud-low` (or any demo with &energy= / &health=): stage the tubes.
      const q = new URLSearchParams(location.search);
      const en = q.get('energy') ?? (name === 'ui-hud-low' ? '0.1' : null);
      const hp = q.get('health') ?? (name === 'ui-hud-low' ? '0.2' : null);
      setTimeout(() => {
        const e = this.game.services.energy;
        const h = (this.game.services as { health?: { max(): number; set(n: number): void } }).health;
        if (en !== null && e) e.set(Number(en) <= 1 ? Math.round(Number(en) * e.max()) : Number(en));
        if (hp !== null && h) h.set(Number(hp) <= 1 ? Math.round(Number(hp) * h.max()) : Number(hp));
      }, 120);
      // `ui-placement`: hold the first placeable on the toolbar so the in-world ghost + reach tint shows.
      if (name === 'ui-placement')
        setTimeout(() => {
          const slots = this.game.services.inventory?.slots ?? [];
          const i = slots.slice(0, 10).findIndex((s) => !!s && itemDef(s.id)?.kind === 'placeable');
          if (i >= 0) this.game.events.emit('toolbar:select', { slot: i });
        }, 200);
    });
  }

  /** Called by the router before a screen opens. */
  beforeOpen(name: string): void {
    if (!this.armed || this.stocked) return;
    if (name !== 'inventory' && name !== 'shop' && name !== 'crafting') return;
    this.stock();
  }

  private stock(): void {
    const inv = this.game.services.inventory;
    if (!inv) return;
    this.stocked = true;
    let slot = 10;
    for (const [id, qty, quality] of STOCK) {
      if (!itemDef(id)) continue;
      // Merge into a matching stack first (same id + quality) — e.g. wood from an earlier give() — like add() does.
      const same = inv.slots.findIndex((s) => !!s && s.id === id && (s.quality ?? 0) === quality);
      if (same >= 0) {
        const s = inv.slots[same]!;
        inv.setSlot(same, { ...s, qty: Math.min(inv.stackMax(id), s.qty + qty) });
        continue;
      }
      while (slot < inv.slots.length && inv.slots[slot]) slot++;
      if (slot >= inv.slots.length) break;
      // setSlot → inventory:change, which also lets recipe discovery see the ores.
      inv.setSlot(slot, quality ? { id, qty, quality } : { id, qty });
    }
  }

  private hudShow(): void {
    this.stock();
    const ev = this.game.events;
    // After the fade-in: a pickup, a merged pickup, a craft, a gold gain and a selection bounce.
    setTimeout(() => {
      ev.emit('item:gained', { itemId: 'parsnip', qty: 3 });
      ev.emit('ui:toast', { text: 'New recipe: <b>Brass Sprinkler</b>', icon: 'brassSprinkler', kind: 'good' });
      ev.emit('item:gained', { itemId: 'copperOre', qty: 2 });
      this.game.services.economy?.add(175, 'shipping');
      ev.emit('toolbar:select', { slot: 5 });
    }, 250);
    setTimeout(() => ev.emit('item:gained', { itemId: 'parsnip', qty: 2 }), 700);
  }
}
