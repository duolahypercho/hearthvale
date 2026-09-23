/** Wooden tab strip shared by the game-menu screens (Backpack · Crafting · Map · Settings). */
import type { Game } from '../core/game';
import { ICONS } from './icons';
import { el, sfx } from './kit';

const TABS: [string, string, string][] = [
  ['inventory', 'Backpack', 'bag'],
  ['crafting', 'Crafting', 'hammer'],
  ['map', 'Map', 'map'],
  ['settings', 'Options', 'gear'],
];

export function menuTabs(game: Game, active: string): HTMLElement {
  const box = el('div', 'u-tabs interactive');
  for (const [id, label, icon] of TABS) {
    const b = el('button', `u-tab${id === active ? ' on' : ''}`, `${ICONS[icon] ?? ''}<span>${label}</span>`);
    b.dataset.nav = '';
    b.title = `${label}  ([ / ])`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (id === active) return;
      sfx(game, 'tab');
      game.events.emit('ui:open', { name: id });
    });
    box.appendChild(b);
  }
  return box;
}
