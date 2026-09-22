import type { Game } from './game';

/**
 * A gameplay/presentation system. Register in core/game.ts (SYSTEMS list) with one line.
 *
 * Lifecycle:
 *   init(game)          once, after the world + player exist. May be async (awaited before ready()).
 *   fixedUpdate(dt)     simulation, fixed 60 Hz; skipped while game.paused.
 *   update(dt)          every rendered frame (animation, visuals); runs even while paused
 *                       (dt is real time; use game.simDt for sim-scaled time).
 *   onMapChange(map)    after a map finished loading.
 *   dispose()           teardown.
 * Persistence: implement save()/load() and the Game registers you with SaveManager under `name`.
 */
export interface System {
  readonly name: string;
  init?(game: Game): void | Promise<void>;
  fixedUpdate?(dt: number, game: Game): void;
  update?(dt: number, game: Game): void;
  onMapChange?(mapId: string, game: Game): void;
  save?(): unknown;
  load?(data: unknown): void;
  dispose?(): void;
}
