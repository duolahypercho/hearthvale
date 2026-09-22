/**
 * Inventory panel (E / I / Tab, or __game.openUI('inventory')): 3 × 10 grid of slots in a
 * wood + parchment frame, with the hovered / selected item's name, description and value.
 * Reads from `inventory:change` events (no import of the inventory system).
 */
import type { Game } from '../core/game';
import type { Panel } from './hud';
import { itemDef } from '../data/items';
import { iconFor } from './icons';

type SlotView = { id: string; qty: number } | null;

export function slotHtml(s: SlotView): string {
  if (!s) return '';
  const d = itemDef(s.id);
  const icon = d ? iconFor(s.id, d.icon, d.color) : '';
  return icon + (s.qty > 1 ? `<span class="qty">${s.qty}</span>` : '');
}

export class InventoryPanel implements Panel {
  private el: HTMLElement;
  private grid: HTMLElement;
  private info: HTMLElement;
  private slots: SlotView[] = [];
  private hover = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hv-panel hv-inventory hv-hidden';
    this.el.innerHTML = `<div class="hv-title">Backpack</div><div class="hv-inner"><div class="grid"></div><div class="info"></div></div>`;
    parent.appendChild(this.el);
    this.grid = this.el.querySelector('.grid')!;
    this.info = this.el.querySelector('.info')!;
    game.events.on('inventory:change', ({ slots }) => {
      this.slots = slots.map((s) => (s ? { ...s } : null));
      if (!this.el.classList.contains('hv-hidden')) this.render();
    });
  }

  private render(): void {
    this.grid.innerHTML = '';
    this.slots.forEach((s, i) => {
      const c = document.createElement('div');
      c.className = 'hv-slot' + (i < 10 ? ' bar' : '') + (i === this.game.toolbarSlot ? ' sel' : '');
      c.innerHTML = slotHtml(s);
      c.addEventListener('pointerenter', () => {
        this.hover = i;
        this.renderInfo();
      });
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (i < 10) this.game.events.emit('toolbar:select', { slot: i });
        this.hover = i;
        this.render();
      });
      this.grid.appendChild(c);
    });
    this.renderInfo();
  }

  private renderInfo(): void {
    const s = this.slots[this.hover];
    const d = s ? itemDef(s.id) : undefined;
    this.info.innerHTML = d
      ? `<div class="name">${d.name}</div><div class="desc">${d.description ?? (d.kind === 'seed' ? 'Plant in tilled soil and water daily.' : d.kind === 'produce' ? 'Fresh from the farm.' : '')}</div>${d.sell ? `<div class="price">Sells for <b>${d.sell}g</b></div>` : ''}`
      : '<div class="desc">Hover an item to inspect it.</div>';
  }

  open(): void {
    this.hover = this.game.toolbarSlot;
    this.render();
    this.el.classList.remove('hv-hidden');
    this.el.classList.remove('hv-anim-in');
    void this.el.offsetWidth;
    this.el.classList.add('hv-anim-in');
  }

  close(): void {
    this.el.classList.add('hv-hidden');
  }
}
