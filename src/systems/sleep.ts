/**
 * SleepSystem: ends the day. Interact with the farmhouse door after 18:00 (or when exhausted)
 * to go to bed; staying up past 2 am makes the farmer pass out (Calendar ends the day itself),
 * which costs 10 % of the purse (max 1000g) and half the next day's energy (EnergySystem).
 *   in:  player:interact, day:end
 *   out: sleep:start, sleep:summary (end-of-day screen: shipping total, penalty, tomorrow)
 * Service `sleep`: sleep() (bed / debug), canSleep().
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';

export interface SleepApi {
  canSleep(): boolean;
  sleep(): void;
}

declare module '../core/game' {
  interface GameServices {
    sleep: SleepApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'sleep:start': { hour: number };
    'sleep:summary': { passedOut: boolean; shipped: number; penalty: number; day: number };
  }
}

/** Bed = the farmhouse door (porch). */
const BED = { map: 'farm', x: 31.5, z: 17.2, r: 1.4 };
const SLEEP_FROM = 18;

export class SleepSystem implements System, SleepApi {
  readonly name = 'sleep';
  private game!: Game;
  private shipped = 0;

  init(game: Game): void {
    this.game = game;
    game.provide('sleep', this);
    game.events.on('shipping:summary', ({ total }) => (this.shipped = total));
    game.events.on('player:interact', ({ x, z }) => {
      if (game.world.current?.id !== BED.map || Math.hypot(x + 0.5 - BED.x, z + 0.5 - BED.z) > BED.r) return;
      if (this.canSleep()) this.sleep();
    });
    game.events.on('day:end', ({ passedOut, day }) => {
      let penalty = 0;
      if (passedOut) {
        const eco = game.services.economy;
        penalty = eco ? Math.min(1000, Math.floor(eco.gold() * 0.1)) : 0;
        if (penalty) eco?.add(-penalty, 'passed-out');
      }
      // Shipping pays out on day:end too; read its total after it has run.
      queueMicrotask(() => {
        game.events.emit('sleep:summary', { passedOut, shipped: this.shipped, penalty, day });
        this.shipped = 0;
      });
    });
  }

  canSleep(): boolean {
    return this.game.calendar.hour >= SLEEP_FROM || !!this.game.services.energy?.exhausted();
  }

  sleep(): void {
    this.game.events.emit('sleep:start', { hour: this.game.calendar.hour });
    this.game.calendar.endDay(false);
  }
}
