import type { Game } from '../../core/game';
import { InteriorMap } from './room';

export class BarnInterior extends InteriorMap {
  constructor(game: Game) {
    super(game, {
      id: 'barn', title: 'Barn', W: 13, D: 9, H: 3.6, doorX: 6,
      exit: { to: 'farm', x: 46.5, z: 35.9, facing: 'down' },
      floor: 'straw', style: 'barn',
      windows: [{ wall: 'back', at: 3, w: 1.0, y0: 1.8, y1: 2.8 }],
      sunDir: [-0.3, 0.6, -0.74],
    });
    this.finalize();
  }
}
