/**
 * SeasonSystem: applies the calendar season to the lighting rig (palette, grade) and to the
 * current map (foliage, flowers, props). Blends on `season:change`, snaps on `season:apply`.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Season } from '../core/time';

export class SeasonSystem implements System {
  readonly name = 'season';
  private game!: Game;

  init(game: Game): void {
    this.game = game;
    game.events.on('season:change', ({ season }) => this.apply(season, false));
    game.events.on('season:apply', ({ season, instant }) => this.apply(season, instant));
  }

  onMapChange(): void {
    this.apply(this.game.calendar.season, true);
  }

  private apply(season: Season, instant: boolean): void {
    this.game.lighting.setSeason(season, instant);
    this.game.world.current?.setSeason?.(season);
  }
}
