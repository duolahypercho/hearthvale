/**
 * EnergySystem: the stamina bar. Tools spend it through the `energy` service; it refills
 * overnight — fully after a proper sleep, only half after passing out at 2 am, and to 3/4 if
 * the farmer went to bed exhausted.
 *   out: energy:change { energy, max }, energy:exhausted
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';

export interface EnergyApi {
  value(): number;
  max(): number;
  /** Spend stamina (never below 0). Returns false if the farmer was already exhausted. */
  spend(n: number): boolean;
  restore(n: number): void;
  set(n: number): void;
  exhausted(): boolean;
}

declare module '../core/game' {
  interface GameServices {
    energy: EnergyApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    /** Energy just hit 0 (player slows, HUD pulses, a sigh SFX). */
    'energy:exhausted': Record<string, never>;
  }
}

export const MAX_ENERGY = 270;

export class EnergySystem implements System, EnergyApi {
  readonly name = 'energy';
  private game!: Game;
  private cur = MAX_ENERGY;
  private cap = MAX_ENERGY;
  private passedOut = false;

  init(game: Game): void {
    this.game = game;
    game.provide('energy', this);
    game.events.on('day:end', ({ passedOut }) => (this.passedOut = passedOut));
    game.events.on('day:start', () => {
      const wasExhausted = this.cur <= 0;
      this.set(this.passedOut ? this.cap * 0.5 : wasExhausted ? this.cap * 0.75 : this.cap);
      this.passedOut = false;
    });
  }

  value(): number {
    return this.cur;
  }

  max(): number {
    return this.cap;
  }

  exhausted(): boolean {
    return this.cur <= 0;
  }

  spend(n: number): boolean {
    const was = this.cur;
    this.set(this.cur - n);
    if (was > 0 && this.cur <= 0) this.game.events.emit('energy:exhausted', {});
    return was > 0;
  }

  restore(n: number): void {
    this.set(this.cur + n);
  }

  set(n: number): void {
    this.cur = Math.max(0, Math.min(this.cap, Math.round(n)));
    this.game.events.emit('energy:change', { energy: this.cur, max: this.cap });
  }

  save(): unknown {
    return { energy: this.cur, max: this.cap };
  }

  load(data: unknown): void {
    const d = data as { energy?: number; max?: number };
    if (typeof d?.max === 'number') this.cap = d.max;
    if (typeof d?.energy === 'number') this.set(d.energy);
  }
}
