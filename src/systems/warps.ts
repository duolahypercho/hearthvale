/**
 * WarpSystem: walking into a map's warp zone (GameMap.warps) fades to black, loads the target
 * map, places the player at the arrival point and shows the location banner.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';

export class WarpSystem implements System {
  readonly name = 'warps';
  private busy = false;

  init(game: Game): void {
    game.events.on('player:tile', ({ x, z }) => {
      const map = game.world.current;
      if (!map?.warps || this.busy || game.paused) return;
      const w = map.warps.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
      if (!w || !game.world.has(w.to)) return;
      this.busy = true;
      void (async () => {
        game.player.controllable = false;
        await game.hud.fade(true);
        await game.teleport(w.to, w.x, w.z);
        game.player.setFacing(w.facing);
        await new Promise((r) => setTimeout(r, 120));
        await game.hud.fade(false);
        const title = game.world.current?.title;
        if (title) game.hud.banner(title);
        game.player.controllable = true;
        this.busy = false;
      })();
    });
  }
}
