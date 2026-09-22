/** Bootstrap only. */
import { Game } from './core/game';
import { installDebugApi, applyUrlParams } from './core/debug';
import type { Quality } from './core/events';

const params = new URLSearchParams(location.search);
const quality = (params.get('quality') as Quality | null) ?? 'high';

const game = new Game({
  container: document.getElementById('app')!,
  uiRoot: document.getElementById('ui-root')!,
  quality: ['low', 'medium', 'high', 'ultra'].includes(quality) ? quality : 'high',
  seed: params.get('seed') ?? 'hearthvale',
  hud: params.get('hud') !== '0',
});
const api = installDebugApi(game);

// URL params are applied before the first frame so ready() resolves on the staged scene.
void game.start('farm', () => applyUrlParams(api, params));
