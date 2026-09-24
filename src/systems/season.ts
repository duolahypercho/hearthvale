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

  private busy = false;

  private apply(season: Season, instant: boolean): void {
    const g = this.game;
    // Foliage / flowers swap in one frame, so the ground palette + snow cover snap with them (a
    // blended ground under already-wintry trees read as a mismatched frame). A live change (not
    // behind the day-end screen) hides the swap behind a short soft fade.
    const hud = g.hud as unknown as { fade?(on: boolean): Promise<void>; fadeEl?: HTMLElement } | undefined;
    const black = !!hud?.fadeEl?.classList.contains('on');
    const swap = (): void => {
      g.lighting.setSeason(season, true);
      g.world.current?.setSeason?.(season);
    };
    if (instant || black || !hud?.fade || g.paused || this.busy || !g.world.current) {
      swap();
      return;
    }
    this.busy = true;
    void hud
      .fade(true)
      .then(() => {
        swap();
        return new Promise((r) => setTimeout(r, 120));
      })
      .then(() => hud.fade!(false))
      .finally(() => {
        this.busy = false;
      });
  }
}
