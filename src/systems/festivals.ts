/**
 * FestivalSystem: the four seasonal festivals.
 *
 *  - Registers one map per festival (built lazily on first visit): fest-spring, fest-summer,
 *    fest-fall, fest-winter (see world/festivals/*).
 *  - Calendar: on a festival day the morning shows an invitation; walking into town during the
 *    open hours leads to the festival grounds instead (once per day, leaving goes home).
 *  - Demo staging: `demo:stage` for a festival map stages its showcase moment.
 *  - Events for other teams: 'festival:start' / 'festival:end' (+ 'festival:music' mood hints
 *    for the audio system), 'festival:minigame' results.
 *  - Service `festivals`: today(), active(), enter(id), mapFor(id).
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { FESTIVALS, festivalOn, festivalForMap, type FestivalDef, type FestivalId } from '../data/festivals';
import { SpringParade } from '../world/festivals/spring';
import type { FestivalMap } from '../world/festivals/base';

export interface FestivalApi {
  /** Festival scheduled for today (any hour), if any. */
  today(): FestivalDef | null;
  /** Festival whose grounds the player is on right now. */
  active(): FestivalDef | null;
  /** Travel to a festival's grounds. */
  enter(id: FestivalId): Promise<void>;
  mapFor(id: FestivalId): string;
}

declare module '../core/game' {
  interface GameServices {
    festivals: FestivalApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'festival:start': { id: string; name: string; map: string };
    'festival:end': { id: string };
    /** Mood hint for the music system: tempo (bpm), mode, timbre. */
    'festival:music': { id: string; tempo: number; mode: string; timbre: string; intensity: number };
    'festival:minigame': { id: string; game: string; score: number; won: boolean };
  }
}

type MapCtor = new (game: Game) => FestivalMap;
const MAPS: Partial<Record<string, MapCtor>> = {
  'fest-spring': SpringParade,
};

export class FestivalSystem implements System {
  readonly name = 'festivals';
  private game!: Game;
  private current: FestivalDef | null = null;
  private visited = new Set<string>();
  private invited = -1;

  init(game: Game): void {
    this.game = game;
    for (const [id, Ctor] of Object.entries(MAPS)) {
      if (!Ctor) continue;
      game.world.registerMap(id, (g) => new Ctor(g).build());
    }
    game.provide('festivals', {
      today: () => festivalOn(game.calendar.season, game.calendar.day),
      active: () => this.current,
      enter: (id) => this.enter(id),
      mapFor: (id) => FESTIVALS[id].map,
    });
    game.events.on('demo:stage', ({ name }) => {
      const map = game.world.current as FestivalMap | null;
      if (map && festivalForMap(map.id) && name.startsWith('fest')) map.stage();
    });
    game.events.on('day:start', ({ day, season }) => {
      const f = festivalOn(season, day);
      if (f && this.invited !== day) {
        this.invited = day;
        game.hud.banner(`${f.name} today!`);
      }
    });
    // Walking into town during a festival leads to the festival grounds (once per day).
    game.events.on('map:change', ({ map }) => {
      const cal = game.calendar;
      const f = festivalOn(cal.season, cal.day);
      const onGrounds = festivalForMap(map);
      if (onGrounds) {
        if (this.current?.id !== onGrounds.id) {
          this.current = onGrounds;
          game.events.emit('festival:start', { id: onGrounds.id, name: onGrounds.name, map });
          game.events.emit('festival:music', { id: onGrounds.id, ...onGrounds.music, intensity: 1 });
        }
        return;
      }
      if (this.current) {
        game.events.emit('festival:end', { id: this.current.id });
        this.current = null;
      }
      const key = `${cal.year}:${cal.season}:${cal.day}`;
      if (map === 'town' && f && cal.hour >= f.open && cal.hour < f.close && !this.visited.has(key) && game.world.has(f.map) && !game.paused) {
        this.visited.add(key);
        void this.enter(f.id);
      }
    });
  }

  private async enter(id: FestivalId): Promise<void> {
    const f = FESTIVALS[id];
    if (!this.game.world.has(f.map)) return;
    await this.game.hud.fade(true);
    await this.game.teleport(f.map, f.arrive.x, f.arrive.z);
    this.game.player.setFacing('up');
    await this.game.hud.fade(false);
    this.game.hud.banner(f.name);
  }
}
