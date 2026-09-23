import type { Game } from '../../core/game';
import type { Panel } from '../../ui/hud';

export class CarpenterPanel implements Panel {
  constructor(private game: Game, private parent: HTMLElement) {}
  open(): void {}
  close(): void {}
}
