import type { Game } from '../../core/game';
import { InteriorMap } from './room';

export class CoopInterior extends InteriorMap {
  constructor(game: Game) {
    super(game, {
      id: 'coop', title: 'Coop', W: 9, D: 7, H: 2.8, doorX: 4,
      exit: { to: 'farm', x: 39.5, z: 35.4, facing: 'down' },
      floor: 'straw', style: 'barn',
      windows: [{ wall: 'back', at: 2.2, w: 0.9, y0: 1.2, y1: 2.0 }],
      sunDir: [-0.3, 0.6, -0.74],
    });
    this.finalize();
  }
}
