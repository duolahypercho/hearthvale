/**
 * QuestSystem: the Lantern Hall bundles (data/bundles.ts) — the story spine. Contributing
 * items fills a bundle; a full bundle relights one of the hall's lanterns and pays its reward.
 * When every lantern burns, `quest:hallRestored` fires (festival unlock, Glimmerco beat).
 *   out: quest:bundle (progress), quest:lantern (relit), quest:hallRestored
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { BUNDLES, type BundleDef } from '../data/bundles';

export interface BundleState {
  def: BundleDef;
  given: Record<string, number>;
  done: boolean;
}

export interface QuestApi {
  bundles(): BundleState[];
  /** Hand in up to `qty` of an item to a bundle; returns how many were accepted. */
  contribute(bundleId: string, itemId: string, qty?: number): number;
  lanternsLit(): number;
}

declare module '../core/game' {
  interface GameServices {
    quests: QuestApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'quest:bundle': { bundleId: string; itemId: string; qty: number };
    'quest:lantern': { bundleId: string; lantern: string; lit: number; total: number };
    'quest:hallRestored': Record<string, never>;
  }
}

export class QuestSystem implements System, QuestApi {
  readonly name = 'quests';
  private game!: Game;
  private state: BundleState[] = BUNDLES.map((def) => ({ def, given: {}, done: false }));

  init(game: Game): void {
    this.game = game;
    game.provide('quests', this);
  }

  bundles(): BundleState[] {
    return this.state;
  }

  lanternsLit(): number {
    return this.state.filter((s) => s.done).length;
  }

  contribute(bundleId: string, itemId: string, qty = 1): number {
    const s = this.state.find((b) => b.def.id === bundleId);
    const need = s?.def.items.find((i) => i.itemId === itemId);
    const inv = this.game.services.inventory;
    if (!s || s.done || !need || !inv) return 0;
    const n = Math.min(qty, need.qty - (s.given[itemId] ?? 0), inv.count(itemId));
    if (n <= 0 || !inv.remove(itemId, n)) return 0;
    s.given[itemId] = (s.given[itemId] ?? 0) + n;
    this.game.events.emit('quest:bundle', { bundleId, itemId, qty: n });
    if (s.def.items.every((i) => (s.given[i.itemId] ?? 0) >= i.qty)) {
      s.done = true;
      const r = s.def.reward;
      if (r.gold) this.game.services.economy?.add(r.gold, `bundle:${bundleId}`);
      if (r.itemId) this.game.events.emit('item:give', { itemId: r.itemId, qty: r.qty ?? 1 });
      this.game.events.emit('quest:lantern', { bundleId, lantern: s.def.lantern, lit: this.lanternsLit(), total: this.state.length });
      if (this.lanternsLit() === this.state.length) this.game.events.emit('quest:hallRestored', {});
    }
    return n;
  }

  save(): unknown {
    return { bundles: this.state.map((s) => ({ id: s.def.id, given: s.given, done: s.done })) };
  }

  load(data: unknown): void {
    const d = (data as { bundles?: { id: string; given: Record<string, number>; done: boolean }[] })?.bundles ?? [];
    for (const b of d) {
      const s = this.state.find((x) => x.def.id === b.id);
      if (s) Object.assign(s, { given: b.given ?? {}, done: !!b.done });
    }
  }
}
