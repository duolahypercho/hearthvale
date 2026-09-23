/**
 * SleepSystem: ends the day. Walk into the farmhouse and interact with grandmother's quilted bed
 * (after 18:00, or any time when exhausted): the screen fades, the day ends (shipping pays out,
 * crops grow, animals produce) and the end-of-day summary opens; you wake beside the bed at 6:00.
 * Staying up past 2 am makes the farmer pass out (Calendar ends the day itself), which costs 10 %
 * of the purse (max 1000g) and half the next day's energy (EnergySystem) — someone carries you home.
 *   in:  player:interact, day:end, day:start
 *   out: sleep:start, sleep:summary (end-of-day screen: shipping total, penalty, tomorrow), sleep:wake
 * Service `sleep`: sleep() (bed / debug; synchronous calendar roll), canSleep(), goToBed().
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';

export interface SleepApi {
  canSleep(): boolean;
  /** End the day right now (no fade, no teleport). */
  sleep(): void;
  /** The full bedtime: fade, end the day, wake up beside the bed. */
  goToBed(): Promise<void>;
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
    /** The farmer is up again (beside the bed, or carried home after passing out). */
    'sleep:wake': { passedOut: boolean };
  }
}

interface BedSpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  wakeX: number;
  wakeZ: number;
}

const SLEEP_FROM = 18;
const HOUSE = 'house';
/** Fallback wake spot if the house map doesn't publish its bed. */
const WAKE = { x: 9.6, z: 2.9 };

export class SleepSystem implements System, SleepApi {
  readonly name = 'sleep';
  private game!: Game;
  private shipped = 0;
  private busy = false;
  private carryHome = false;

  init(game: Game): void {
    this.game = game;
    game.provide('sleep', this);
    game.events.on('shipping:summary', ({ total }) => (this.shipped = total));
    game.events.on('player:interact', ({ x, z }) => {
      const bed = this.bed();
      if (!bed || x < Math.floor(bed.x0) || x > Math.floor(bed.x1) || z < Math.floor(bed.z0) || z > Math.floor(bed.z1)) return;
      if (this.canSleep()) void this.goToBed();
      else game.events.emit('ui:toast', { text: 'Not sleepy yet… the quilt can wait until <b>6 pm</b>', kind: 'info' });
    });
    game.events.on('day:end', ({ passedOut, day }) => {
      let penalty = 0;
      if (passedOut) {
        const eco = game.services.economy;
        penalty = eco ? Math.min(1000, Math.floor(eco.gold() * 0.1)) : 0;
        if (penalty) eco?.add(-penalty, 'passed-out');
        this.carryHome = !this.busy;
      }
      // Shipping pays out on day:end too; read its total after it has run.
      queueMicrotask(() => {
        game.events.emit('sleep:summary', { passedOut, shipped: this.shipped, penalty, day });
        this.shipped = 0;
      });
    });
    game.events.on('day:start', () => {
      if (!this.carryHome) return;
      this.carryHome = false;
      void this.wakeAtHome(true);
    });
  }

  private bed(): BedSpec | null {
    const m = this.game.world.current;
    if (m?.id !== HOUSE) return null;
    return (m as unknown as { bed?: BedSpec }).bed ?? null;
  }

  canSleep(): boolean {
    return this.game.calendar.hour >= SLEEP_FROM || !!this.game.services.energy?.exhausted();
  }

  sleep(): void {
    this.game.events.emit('sleep:start', { hour: this.game.calendar.hour });
    this.game.calendar.endDay(false);
  }

  async goToBed(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const g = this.game;
    g.player.controllable = false;
    const bed = this.bed();
    if (bed) {
      // Tuck in: step onto the quilt, face the room.
      g.player.teleport((bed.x0 + bed.x1) / 2, (bed.z0 + bed.z1) / 2 + 0.2);
      g.player.setFacing('down');
    }
    await g.hud.fade(true);
    await new Promise((r) => setTimeout(r, 450));
    this.sleep();
    await this.wakeAtHome(false);
    this.busy = false;
  }

  /** Put the farmer beside the bed in the farmhouse (fading in). */
  private async wakeAtHome(passedOut: boolean): Promise<void> {
    const g = this.game;
    g.player.controllable = false;
    if (passedOut) await g.hud.fade(true);
    try {
      if (g.world.current?.id !== HOUSE && g.world.has(HOUSE)) await g.world.load(HOUSE);
    } catch (err) {
      console.error('[sleep] could not load the farmhouse', err);
    }
    const bed = this.bed();
    g.player.teleport(bed?.wakeX ?? WAKE.x, bed?.wakeZ ?? WAKE.z);
    g.player.setFacing('down');
    g.followPlayer(true);
    await new Promise((r) => setTimeout(r, 250));
    await g.hud.fade(false);
    g.player.controllable = true;
    g.events.emit('sleep:wake', { passedOut });
  }
}
