/**
 * FishingSystem (stub, typed): cast → wait → bite → reel → catch / escape state machine.
 * The reel minigame UI (ui/panels.ts FishingPanel) drives `reel(progress)`; the fish table is
 * data/fish.ts. TODO(fishing team): power meter, bobber visuals, fish AI in the reel bar.
 *   in:  item:use (rod) · out: fishing:cast, fishing:bite, fishing:catch, fishing:escape
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { FISH, type FishDef } from '../data/fish';

export type FishingState = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling';

export interface FishingApi {
  state(): FishingState;
  /** Fish that can bite here and now. */
  available(): FishDef[];
  cast(power: number): void;
  /** Minigame progress 0..1 (≥ 1 catches, ≤ 0 escapes). */
  reel(progress: number): void;
}

declare module '../core/game' {
  interface GameServices {
    fishing: FishingApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'fishing:cast': { power: number; x: number; z: number };
    'fishing:bite': { fishId: string };
    'fishing:catch': { fishId: string; perfect: boolean };
    'fishing:escape': { fishId: string };
  }
}

export class FishingSystem implements System, FishingApi {
  readonly name = 'fishing';
  private game!: Game;
  private st: FishingState = 'idle';
  private timer = 0;
  private hooked: FishDef | null = null;

  init(game: Game): void {
    this.game = game;
    game.provide('fishing', this);
    game.events.on('item:use', ({ itemId }) => {
      if (itemId === 'rod' && this.st === 'idle') this.cast(0.7);
    });
  }

  state(): FishingState {
    return this.st;
  }

  available(): FishDef[] {
    const c = this.game.calendar;
    const map = this.game.world.current?.id ?? '';
    return FISH.filter((f) => f.maps.includes(map) && f.seasons.includes(c.season) && c.hour >= f.hours[0] && c.hour <= f.hours[1] && (!f.weather || f.weather.includes(c.weather)));
  }

  cast(power: number): void {
    const p = this.game.player.position;
    this.st = 'waiting';
    this.timer = 2 + Math.random() * 6 * (1.2 - power);
    this.game.services.energy?.spend(4);
    this.game.events.emit('fishing:cast', { power, x: p.x, z: p.z });
  }

  reel(progress: number): void {
    if (this.st !== 'reeling' || !this.hooked) return;
    if (progress >= 1) {
      this.game.events.emit('fishing:catch', { fishId: this.hooked.id, perfect: false });
      this.game.events.emit('item:give', { itemId: this.hooked.id, qty: 1 });
      this.reset();
    } else if (progress <= 0) {
      this.game.events.emit('fishing:escape', { fishId: this.hooked.id });
      this.reset();
    }
  }

  private reset(): void {
    this.st = 'idle';
    this.hooked = null;
  }

  fixedUpdate(dt: number): void {
    if (this.st !== 'waiting' && this.st !== 'bite') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.st === 'waiting') {
      const pool = this.available();
      if (!pool.length) return this.reset();
      this.hooked = pool[Math.floor(Math.random() * pool.length)]!;
      this.st = 'bite';
      this.timer = 1.2;
      this.game.events.emit('fishing:bite', { fishId: this.hooked.id });
      this.game.events.emit('ui:open', { name: 'fishing' });
      this.st = 'reeling';
    }
  }
}
