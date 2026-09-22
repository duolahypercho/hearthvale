/**
 * MiningSystem (stub, typed): the mine below the valley. Tracks the deepest floor reached and
 * the current floor; floor generation (rocks with ores, ladder, slimes) belongs to a future
 * world/mine map that reads `mining.floor()` and a seeded `game.rng.fork('mine:<n>')`.
 *   out: mine:floor, mine:rock
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';

export interface MiningApi {
  floor(): number;
  deepest(): number;
  descend(): void;
  /** A rock broke on the current floor (drops are rolled by the map). */
  breakRock(x: number, z: number, ore: string | null): void;
}

declare module '../core/game' {
  interface GameServices {
    mining: MiningApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'mine:floor': { floor: number; deepest: number };
    'mine:rock': { x: number; z: number; ore: string | null; floor: number };
  }
}

export class MiningSystem implements System, MiningApi {
  readonly name = 'mining';
  private game!: Game;
  private cur = 0;
  private best = 0;

  init(game: Game): void {
    this.game = game;
    game.provide('mining', this);
  }

  floor(): number {
    return this.cur;
  }

  deepest(): number {
    return this.best;
  }

  descend(): void {
    this.cur++;
    this.best = Math.max(this.best, this.cur);
    this.game.events.emit('mine:floor', { floor: this.cur, deepest: this.best });
  }

  breakRock(x: number, z: number, ore: string | null): void {
    this.game.services.energy?.spend(2);
    this.game.events.emit('mine:rock', { x, z, ore, floor: this.cur });
    if (ore) this.game.events.emit('item:give', { itemId: ore, qty: 1 });
  }

  onMapChange(mapId: string): void {
    if (mapId !== 'mine') this.cur = 0;
  }

  save(): unknown {
    return { deepest: this.best };
  }

  load(data: unknown): void {
    this.best = (data as { deepest?: number })?.deepest ?? 0;
  }
}
