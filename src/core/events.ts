/**
 * Typed event bus. The ONLY sanctioned way for sibling systems to talk.
 *
 * Extending from another module (declaration merging):
 *
 *   declare module '../core/events' {
 *     interface GameEvents {
 *       'crop:harvested': { cropId: string; x: number; z: number; quality: number };
 *     }
 *   }
 */
import type { Season, Weather } from './time';

export type Facing = 'up' | 'down' | 'left' | 'right';
export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface GameEvents {
  /** Fired every 10 in-game minutes. */
  'time:tick': { hour: number; minute: number; totalMinutes: number };
  'time:hour': { hour: number };
  /** Hour was set directly (debug / sleeping). */
  'time:set': { hour: number };
  'day:start': { day: number; season: Season; year: number };
  'day:end': { day: number; season: Season; year: number; passedOut: boolean };
  'season:change': { season: Season; prev: Season };
  'weather:change': { weather: Weather; prev: Weather };

  'player:tile': { map: string; x: number; z: number };
  'player:facing': { facing: Facing };
  /** Player used the currently selected tool/item on a tile. */
  'player:use': { x: number; z: number; slot: number; itemId: string | null };
  /** Player pressed interact (right click / X) on a tile. */
  'player:interact': { x: number; z: number };

  'toolbar:select': { slot: number };
  'ui:open': { name: string };
  'ui:close': { name: string };

  'gold:change': { gold: number; delta: number };
  'energy:change': { energy: number; max: number };
  'item:give': { itemId: string; qty: number; /** Produce quality 0..3 (farming harvests). */ quality?: number };
  'crops:grow': { days: number };

  'map:change': { map: string; prev: string | null };
  'quality:change': { quality: Quality };

  'save:before': { slot: string };
  'save:after': { slot: string };
  'load:after': { slot: string };

  'game:ready': Record<string, never>;
  'game:pause': { paused: boolean };

  /** A demo scene was staged (systems add their showcase content, e.g. a planted field). */
  'demo:stage': { name: string; showcase: string[] };
  /** Snap season/weather visuals instantly (debug / demos / load) instead of blending. */
  'season:apply': { season: Season; instant: boolean };
  'weather:apply': { weather: Weather; instant: boolean };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private handlers = new Map<EventName, Set<Handler<EventName>>>();

  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as Handler<EventName>);
    return () => this.off(name, fn);
  }

  once<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends EventName>(name: K, fn: Handler<K>): void {
    this.handlers.get(name)?.delete(fn as Handler<EventName>);
  }

  /**
   * Co-op hook (net/): sees every event before any handler; return true to swallow it. Used to route
   * another farmer's action results (their items, their toasts) away from this machine's player.
   */
  interceptor: (<K extends EventName>(name: K, payload: GameEvents[K]) => boolean) | null = null;

  emit<K extends EventName>(name: K, payload: GameEvents[K]): void {
    if (this.interceptor?.(name, payload)) return;
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<K>)(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" threw`, err);
      }
    }
  }
}
