/** Icon sheet ('icons'): every item in data/items.ts on one parchment, grouped by kind — art review aid. */
import type { Game } from '../core/game';
import { ITEMS } from '../data/items';
import { itemIcon, itemCategory } from './icons';
import { Screen, el, frame, closeButton, tooltip, escapeHtml } from './kit';
import { itemTooltipHtml } from './itemtip';

export class IconSheetScreen extends Screen {
  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-icons', { backdrop: true });
  }

  protected render(): void {
    this.root.querySelector('.u-pop')?.remove();
    const wrap = el('div', 'icons-wrap u-pop');
    const all = Object.values(ITEMS);
    const { frame: f, body } = frame(`Item Almanac · ${all.length}`, 'icons-frame');
    f.appendChild(closeButton(() => this.requestClose()));
    const kinds = [...new Set(all.map((d) => d.kind))];
    for (const k of kinds) {
      const sec = el('section', 'ic-sec', `<h4>${escapeHtml(k)}</h4>`);
      const grid = el('div', 'ic-grid');
      for (const d of all.filter((x) => x.kind === k)) {
        const c = el('div', 'ic-cell', `<div class="u-slot">${itemIcon(d.id)}</div><span>${escapeHtml(d.name)}</span>`);
        c.dataset.nav = '';
        c.style.setProperty('--c', itemCategory(d.id).color);
        c.addEventListener('pointerenter', (ev) => tooltip.show(itemTooltipHtml({ id: d.id, qty: 1 }), ev));
        c.addEventListener('pointerleave', () => tooltip.hide());
        grid.appendChild(c);
      }
      sec.appendChild(grid);
      body.appendChild(sec);
    }
    wrap.appendChild(f);
    this.root.appendChild(wrap);
  }
}
