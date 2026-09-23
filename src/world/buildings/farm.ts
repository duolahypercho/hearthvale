import type { Game } from '../../core/game';
import type { GameMap } from '../map';

export type BuildingKind = 'coop' | 'barn';

export const SITES = {
  coop: { x: 39.5, z: 32.6, door: { x: 39, z: 34 } },
  barn: { x: 46.5, z: 32.4, door: { x: 46, z: 34 } },
  pasture: { x0: 36, z0: 36.2, x1: 51.5, z1: 43.5 },
} as const;

export class FarmBuildings {
  constructor(private game: Game, private map: GameMap) {}
  sync(_built: Set<BuildingKind>, _orders: Set<BuildingKind>): void {}
  isBoard(_x: number, _z: number): boolean { return false; }
  update(_dt: number, _game: Game): void {}
}
