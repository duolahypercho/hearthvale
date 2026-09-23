/**
 * InventorySystem: 30 slots, the first 10 are the toolbar. Owns the "what is in my hand"
 * logic: turns `player:use` into `item:use` with the selected item, handles `item:give`,
 * publishes the `inventory` service and `inventory:change` events (HUD + panel listen).
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { itemDef } from '../data/items';

export interface Stack {
  id: string;
  qty: number;
  /** Produce quality: 0 normal · 1 silver · 2 gold · 3 radiant (stacks only merge at equal quality). */
  quality?: number;
}

export interface InventoryApi {
  readonly slots: (Stack | null)[];
  /** Currently selected toolbar stack. */
  selected(): Stack | null;
  /** Adds items; returns how many did not fit. */
  add(id: string, qty?: number): number;
  /** Removes qty of an item (from any slot); false if not enough. */
  remove(id: string, qty?: number): boolean;
  /** Removes qty from a specific slot; returns what was removed. */
  takeFromSlot(slot: number, qty?: number): Stack | null;
  count(id: string): number;
  // ── UI hooks (backpack drag & drop, sorting, trash) ──
  /** Replace a slot outright (null clears it). */
  setSlot(slot: number, stack: Stack | null): void;
  /** Move / merge / swap slot `from` onto slot `to`. */
  move(from: number, to: number): void;
  /** Sort the backpack rows (slots 10+) by kind, then name; merges partial stacks. */
  sort(): void;
  /** Max stack size for an item. */
  stackMax(id: string): number;
}

declare module '../core/game' {
  interface GameServices {
    inventory: InventoryApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'inventory:change': { slots: (Stack | null)[]; selected: number };
    /** The selected item was used on a tile (tools, seeds, placeables). */
    'item:use': { itemId: string; x: number; z: number; slot: number };
    /** Picked up / received items (HUD toast). */
    'item:gained': { itemId: string; qty: number };
  }
}

const SIZE = 30;
const STARTER: [string, number][] = [
  ['hoe', 1],
  ['wateringCan', 1],
  ['axe', 1],
  ['pickaxe', 1],
  ['scythe', 1],
  ['parsnipSeeds', 15],
  ['cauliflowerSeeds', 5],
  ['potatoSeeds', 8],
  ['sprinkler', 2],
  ['parsnip', 3],
];

export class InventorySystem implements System, InventoryApi {
  readonly name = 'inventory';
  readonly slots: (Stack | null)[] = new Array(SIZE).fill(null);
  private game!: Game;

  init(game: Game): void {
    this.game = game;
    STARTER.forEach(([id, qty], i) => (this.slots[i] = { id, qty }));
    game.provide('inventory', this);
    game.events.on('player:use', ({ x, z, slot }) => {
      const s = this.slots[slot];
      if (s) game.events.emit('item:use', { itemId: s.id, x, z, slot });
    });
    game.events.on('item:give', ({ itemId, qty }) => {
      if (!itemDef(itemId)) {
        console.warn(`[inventory] unknown item "${itemId}"`);
        return;
      }
      this.add(itemId, qty);
    });
    game.events.on('toolbar:select', () => this.changed());
    this.changed();
  }

  private changed(): void {
    this.game.events.emit('inventory:change', { slots: this.slots, selected: this.game.toolbarSlot });
  }

  selected(): Stack | null {
    return this.slots[this.game.toolbarSlot] ?? null;
  }

  add(id: string, qty = 1): number {
    const def = itemDef(id);
    const max = def?.stack ?? 999;
    let left = qty;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.qty < max) {
        const n = Math.min(left, max - s.qty);
        s.qty += n;
        left -= n;
      }
    }
    for (let i = 0; i < SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { id, qty: n };
        left -= n;
      }
    }
    if (qty - left > 0) this.game.events.emit('item:gained', { itemId: id, qty: qty - left });
    this.changed();
    return left;
  }

  remove(id: string, qty = 1): boolean {
    if (this.count(id) < qty) return false;
    let left = qty;
    for (let i = SIZE - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(left, s.qty);
        s.qty -= n;
        left -= n;
        if (s.qty <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  takeFromSlot(slot: number, qty = 1): Stack | null {
    const s = this.slots[slot];
    if (!s) return null;
    const n = Math.min(qty, s.qty);
    s.qty -= n;
    if (s.qty <= 0) this.slots[slot] = null;
    this.changed();
    return { id: s.id, qty: n };
  }

  setSlot(slot: number, stack: Stack | null): void {
    if (slot < 0 || slot >= SIZE) return;
    this.slots[slot] = stack && stack.qty > 0 ? { ...stack } : null;
    this.changed();
  }

  stackMax(id: string): number {
    return itemDef(id)?.stack ?? 999;
  }

  move(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= SIZE || to >= SIZE) return;
    const a = this.slots[from];
    const b = this.slots[to];
    if (!a) return;
    if (b && b.id === a.id && (b.quality ?? 0) === (a.quality ?? 0)) {
      const n = Math.min(a.qty, this.stackMax(a.id) - b.qty);
      b.qty += n;
      a.qty -= n;
      if (a.qty <= 0) this.slots[from] = null;
    } else {
      this.slots[from] = b;
      this.slots[to] = a;
    }
    this.changed();
  }

  sort(): void {
    const ORDER: Record<string, number> = { tool: 0, seed: 1, produce: 2, fish: 3, forage: 4, resource: 5, placeable: 6 };
    const items = this.slots.slice(10).filter((s): s is Stack => !!s);
    const merged: Stack[] = [];
    for (const s of items) {
      let left = s.qty;
      for (const m of merged) {
        if (left <= 0) break;
        if (m.id === s.id && (m.quality ?? 0) === (s.quality ?? 0) && m.qty < this.stackMax(m.id)) {
          const n = Math.min(left, this.stackMax(m.id) - m.qty);
          m.qty += n;
          left -= n;
        }
      }
      if (left > 0) merged.push({ ...s, qty: left });
    }
    merged.sort((x, y) => {
      const dx = itemDef(x.id);
      const dy = itemDef(y.id);
      return (ORDER[dx?.kind ?? ''] ?? 9) - (ORDER[dy?.kind ?? ''] ?? 9) || (dx?.name ?? x.id).localeCompare(dy?.name ?? y.id) || (y.quality ?? 0) - (x.quality ?? 0);
    });
    for (let i = 10; i < SIZE; i++) this.slots[i] = merged[i - 10] ?? null;
    this.changed();
  }

  count(id: string): number {
    return this.slots.reduce((a, s) => a + (s && s.id === id ? s.qty : 0), 0);
  }

  save(): unknown {
    return { slots: this.slots };
  }

  load(data: unknown): void {
    const d = data as { slots?: (Stack | null)[] };
    if (!d?.slots) return;
    for (let i = 0; i < SIZE; i++) this.slots[i] = d.slots[i] ?? null;
    this.changed();
  }
}
