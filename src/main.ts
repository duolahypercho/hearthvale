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

// Plain boot (no demo / map / ui params) opens on the title screen; `?notitle=1` skips it.
const staged = ['demo', 'map', 'x', 'z', 'ui'].some((k) => params.has(k));
const showTitle = !staged && params.get('notitle') !== '1';

// URL params are applied before the first frame so ready() resolves on the staged scene.
void game.start('farm', async () => {
  await applyUrlParams(api, params);
  if (showTitle) await api.demo('title');
});
