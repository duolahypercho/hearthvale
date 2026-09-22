/**
 * EconomySystem: owns the purse. Everything that earns or spends gold goes through the
 * `economy` service so shops, shipping, quests and penalties never race on a shared field.
 *   out: gold:change { gold, delta }   (HUD count-up, audio "coin" cue)
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';

export interface EconomyApi {
  gold(): number;
  /** Set the purse outright (debug / load). */
  set(n: number, reason?: string): void;
  /** Add (or subtract, with a negative delta) gold, clamped at 0. Returns the new total. */
  add(delta: number, reason?: string): number;
  /** Spend if affordable; false (and nothing changes) otherwise. */
  spend(n: number, reason?: string): boolean;
}

declare module '../core/game' {
  interface GameServices {
    economy: EconomyApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    /** A purchase was refused (UI shake / "not enough gold" toast). */
    'gold:insufficient': { need: number; have: number; reason?: string };
  }
}

export const START_GOLD = 500;

export class EconomySystem implements System, EconomyApi {
  readonly name = 'economy';
  private game!: Game;
  private purse = START_GOLD;

  init(game: Game): void {
    this.game = game;
    game.provide('economy', this);
  }

  gold(): number {
    return this.purse;
  }

  set(n: number): void {
    const next = Math.max(0, Math.floor(n));
    const delta = next - this.purse;
    this.purse = next;
    this.game.events.emit('gold:change', { gold: next, delta });
  }

  add(delta: number): number {
    this.set(this.purse + delta);
    return this.purse;
  }

  spend(n: number, reason?: string): boolean {
    if (n > this.purse) {
      this.game.events.emit('gold:insufficient', { need: n, have: this.purse, reason });
      return false;
    }
    this.set(this.purse - n);
    return true;
  }

  save(): unknown {
    return { gold: this.purse };
  }

  load(data: unknown): void {
    const g = (data as { gold?: number })?.gold;
    if (typeof g === 'number') this.set(g);
  }
}
