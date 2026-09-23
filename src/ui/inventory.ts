/**
 * Backpack ('inventory'; E / I / Tab): the game menu's first tab.
 *   · farmer card (painted bust, farm, date, purse, energy)
 *   · toolbar row + 2 backpack rows of carved slots; drag & drop or click-to-carry, right-click takes half
 *     (or one more of the same), Esc returns a carried stack; stacks merge, swap and split
 *   · trash can (lid pops on hover) and Sort; hover / focus tooltips with category, quality and price
 * Talks to the inventory only through the `inventory` service.
 */
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { ICONS, itemIcon, itemCategory, qualityStar } from './icons';
import { CROPS, daysToRipe, type CropId } from '../data/crops';
import { Screen, el, frame, closeButton, tooltip, sfx, replay, escapeHtml } from './kit';
import { slotInner, itemTooltipHtml, unitPrice, starRow, type StackView } from './itemtip';
import { menuTabs } from './menutabs';
import { farmerAvatar } from './avatar';

export { slotHtml } from './itemtip';

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };

interface Held {
  stack: StackView;
  from: number;
}

export class InventoryScreen extends Screen {
  private grid!: HTMLElement;
  private cells: HTMLElement[] = [];
  private held: Held | null = null;
  private heldEl: HTMLElement;
  private drag: { slot: number; x: number; y: number; moved: boolean } | null = null;
  private card!: HTMLElement;
  private trash!: HTMLElement;
  private detail!: HTMLElement;
  private detailKey = '';

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-inventory', { backdrop: true });
    this.heldEl = el('div', 'u-held hv-hidden');
    document.getElementById('ui-root')?.appendChild(this.heldEl);
    game.events.on('inventory:change', () => {
      if (this.isOpen) this.refresh();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.held) return;
      this.heldEl.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
      if (this.drag && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) this.drag.moved = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (!this.isOpen || !this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (!d.moved || !this.held) return;
      const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-slot]') as HTMLElement | null;
      if (target) this.dropOn(Number(target.dataset.slot));
      else if ((document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.inv-trash')) this.trashHeld();
    });
  }

  private get inv() {
    return this.game.services.inventory;
  }

  protected render(): void {
    this.root.querySelector('.u-pop')?.remove();
    const wrap = el('div', 'inv-wrap u-pop');
    const { frame: f, body } = frame('Backpack', 'inv-frame');
    f.appendChild(closeButton(() => this.requestClose()));
    wrap.append(menuTabs(this.game, 'inventory'), f);

    this.card = el('div', 'inv-card');
    const side = el('div', 'inv-main');
    const rowLabel = el('div', 'inv-label', `<span>Toolbar</span><i></i><small>drag items here to equip</small>`);
    this.grid = el('div', 'inv-grid');
    this.cells = [];
    const n = this.inv?.slots.length ?? 30;
    for (let i = 0; i < n; i++) {
      const c = el('div', `u-slot${i < 10 ? ' bar' : ''}`);
      c.dataset.slot = String(i);
      c.dataset.nav = '';
      c.dataset.noclick = '1';
      if (i === 10) this.grid.appendChild(el('div', 'inv-sep', '<span>Backpack</span>'));
      c.addEventListener('pointerdown', (e) => this.onSlotDown(i, e));
      c.addEventListener('u-activate', () => this.clickSlot(i));
      c.addEventListener('pointerenter', () => this.hover(i));
      c.addEventListener('u-focus', () => this.hover(i, true));
      c.addEventListener('pointerleave', () => tooltip.hide());
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      this.grid.appendChild(c);
      this.cells.push(c);
    }
    this.detail = el('div', 'inv-detail');
    this.grid.addEventListener('pointerleave', () => this.showDetail(null));
    const foot = el('div', 'inv-foot');
    const sort = el('button', 'u-btn small', `${ICONS.sort}<span>Sort</span>`);
    sort.dataset.nav = '';
    sort.addEventListener('click', () => {
      this.returnHeld();
      this.inv?.sort();
      sfx(this.game, 'sort');
      this.cells.slice(10).forEach((c, k) => {
        c.style.animationDelay = `${k * 12}ms`;
        replay(c, 'shuffle');
      });
    });
    this.trash = el('div', 'inv-trash', `<div class="lid">${ICONS.trash}</div><span>Trash</span>`);
    this.trash.dataset.nav = '';
    this.trash.dataset.noclick = '1';
    this.trash.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.held) this.trashHeld();
    });
    this.trash.addEventListener('u-activate', () => this.held && this.trashHeld());
    const hint = el('div', 'inv-hint', `<b>Click</b> to pick up · <b>Right-click</b> to split · <b>[ ]</b> switch tabs`);
    foot.append(hint, sort, this.trash);
    side.append(rowLabel, this.grid, this.detail, foot);
    body.append(this.card, side);
    this.root.appendChild(wrap);
    this.refresh();
  }

  protected override initialFocus(): HTMLElement | null {
    return this.cells[this.game.toolbarSlot] ?? null;
  }

  private refresh(): void {
    const slots = this.inv?.slots ?? [];
    this.cells.forEach((c, i) => {
      const s = slots[i] as StackView | null;
      const html = slotInner(s);
      if (c.innerHTML !== html) c.innerHTML = html;
      c.classList.toggle('empty', !s);
      c.classList.toggle('sel', i === this.game.toolbarSlot);
    });
    const cal = this.game.calendar;
    const gold = this.game.services.economy?.gold() ?? 0;
    const en = this.game.services.energy;
    const worth = slots.reduce((a, s) => a + (s ? unitPrice(s) * s.qty : 0), 0);
    this.card.innerHTML = `
      <div class="av">${farmerAvatar()}</div>
      <div class="nm">Farmer</div>
      <div class="farm">Rosalind's Farm</div>
      <div class="stats">
        <div><span>${ICONS[cal.season]}</span><b>${SEASON_NAME[cal.season]} ${cal.day}</b><small>Year ${cal.year}</small></div>
        <div><span>${ICONS.coin}</span><b>${gold.toLocaleString()}g</b><small>purse</small></div>
        <div><span>${ICONS.bolt}</span><b>${en ? `${en.value()}/${en.max()}` : '—'}</b><small>energy</small></div>
        <div><span>${ICONS.bag}</span><b>${worth.toLocaleString()}g</b><small>pack value</small></div>
      </div>`;
    this.renderHeld();
    this.showDetail(null);
  }

  /**
   * Item card under the grid: big icon, name, quality, category, what it's for and what it's worth.
   * `null` = the selected toolbar item (so the card is never empty while the backpack is open).
   */
  private showDetail(i: number | null): void {
    if (!this.detail) return;
    const slots = this.inv?.slots ?? [];
    const idx = i ?? this.game.toolbarSlot;
    const s = (this.held && i === null ? this.held.stack : slots[idx]) as StackView | null | undefined;
    const key = s ? `${idx}|${s.id}|${s.qty}|${s.quality ?? 0}|${this.held ? 1 : 0}` : `empty|${idx}`;
    if (key === this.detailKey) return;
    this.detailKey = key;
    if (!s) {
      this.detail.innerHTML = `<div class="idt-empty">${ICONS.bag}<span>Hover an item to inspect it · drag to rearrange</span></div>`;
      return;
    }
    const d = itemDef(s.id);
    const cat = itemCategory(s.id);
    const q = s.quality ?? 0;
    let desc = d?.description ?? '';
    let meta = '';
    if (d?.kind === 'seed' && d.crop) {
      const c = CROPS[d.crop as CropId];
      if (c) {
        desc = desc || 'Plant in tilled soil and water daily.';
        meta = `${ICONS.sprout}<span>${daysToRipe(c)} days · ${c.seasons.map((x) => SEASON_NAME[x]).join(' / ')}${c.regrow ? ` · regrows` : ''}</span>`;
      }
    } else if (d?.kind === 'produce' && !desc) desc = 'Fresh from the farm. Ship it, gift it, or cook with it.';
    else if (d?.kind === 'resource' && !desc) desc = 'A useful crafting material.';
    const each = unitPrice(s);
    const val =
      each > 0
        ? `<div class="idt-val">${ICONS.coin}<b>${each.toLocaleString()}g</b><small>${s.qty > 1 ? `×${s.qty} = ${(each * s.qty).toLocaleString()}g` : 'sell price'}</small></div>`
        : d?.kind === 'tool'
          ? `<div class="idt-val tool">${ICONS.hammer}<b>Tool</b><small>not for sale</small></div>`
          : '';
    const stars = q ? `<span class="idt-q">${starRow(q)}</span>` : '';
    this.detail.innerHTML = `
      <div class="u-slot idt-pic">${itemIcon(s.id)}${qualityStar(q)}</div>
      <div class="idt-txt">
        <div class="idt-name"><b>${escapeHtml(d?.name ?? s.id)}</b>${stars}<span class="t-cat" style="background:${cat.color}">${cat.label}</span></div>
        <p>${escapeHtml(desc)}</p>${meta ? `<div class="idt-meta">${meta}</div>` : ''}
      </div>${val}`;
    replay(this.detail, 'swap');
  }

  private hover(i: number, anchor = false): void {
    if (this.held) {
      tooltip.hide();
      if (anchor) this.placeHeldOver(this.cells[i]!);
      return;
    }
    const s = this.inv?.slots[i] as StackView | null;
    this.showDetail(s ? i : null);
    if (!s) {
      tooltip.hide();
      return;
    }
    // Keyboard / gamepad focus reads the detail card under the grid — a floating tip would cover the
    // neighbouring slots the player is navigating to.
    if (anchor) {
      tooltip.hide();
      return;
    }
    const hint = i < 10 ? 'Toolbar slot' : '';
    tooltip.show(itemTooltipHtml(s, { hint }));
  }

  private onSlotDown(i: number, e: PointerEvent): void {
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2) {
      this.rightClick(i);
      return;
    }
    if (e.button !== 0) return;
    const hadHeld = !!this.held;
    this.clickSlot(i);
    if (!hadHeld && this.held) this.drag = { slot: i, x: e.clientX, y: e.clientY, moved: false };
    this.heldEl.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
  }

  /** Pick up / put down / merge / swap (click, Enter, gamepad A). */
  private clickSlot(i: number): void {
    const inv = this.inv;
    if (!inv) return;
    if (!this.held) {
      const s = inv.slots[i];
      if (!s) return;
      this.held = { stack: { ...s }, from: i };
      inv.setSlot(i, null);
      sfx(this.game, 'pickup');
      tooltip.hide();
      this.renderHeld();
      if (document.body.classList.contains('u-kbd')) this.placeHeldOver(this.cells[i]!);
      return;
    }
    this.dropOn(i);
  }

  private dropOn(i: number): void {
    const inv = this.inv;
    if (!inv || !this.held) return;
    const h = this.held.stack;
    const s = inv.slots[i];
    if (!s) {
      inv.setSlot(i, h);
      this.held = null;
    } else if (s.id === h.id && (s.quality ?? 0) === (h.quality ?? 0)) {
      const room = inv.stackMax(h.id) - s.qty;
      const n = Math.min(room, h.qty);
      inv.setSlot(i, { ...s, qty: s.qty + n });
      h.qty -= n;
      if (h.qty <= 0) this.held = null;
    } else {
      inv.setSlot(i, h);
      this.held = { stack: { ...s }, from: i };
    }
    sfx(this.game, 'drop');
    replay(this.cells[i], 'land');
    this.renderHeld();
    if (!this.held) this.hover(i, document.body.classList.contains('u-kbd'));
  }

  private rightClick(i: number): void {
    const inv = this.inv;
    if (!inv) return;
    const s = inv.slots[i];
    if (this.held) {
      const h = this.held.stack;
      if (!s) {
        inv.setSlot(i, { ...h, qty: 1 });
        h.qty -= 1;
      } else if (s.id === h.id && (s.quality ?? 0) === (h.quality ?? 0) && h.qty < inv.stackMax(h.id)) {
        h.qty += 1;
        inv.setSlot(i, s.qty > 1 ? { ...s, qty: s.qty - 1 } : null);
      } else return;
      if (h.qty <= 0) this.held = null;
    } else if (s) {
      const take = Math.ceil(s.qty / 2);
      this.held = { stack: { ...s, qty: take }, from: i };
      inv.setSlot(i, s.qty - take > 0 ? { ...s, qty: s.qty - take } : null);
    } else return;
    sfx(this.game, 'pickup');
    this.renderHeld();
  }

  private trashHeld(): void {
    if (!this.held) return;
    const d = itemDef(this.held.stack.id);
    if (d?.kind === 'tool') {
      replay(this.trash, 'shake');
      sfx(this.game, 'error');
      this.game.events.emit('ui:toast', { text: `Grandmother's ${d.name.toLowerCase()}? <b>Never.</b>`, icon: this.held.stack.id, kind: 'bad' });
      return;
    }
    this.held = null;
    replay(this.trash, 'gulp');
    sfx(this.game, 'trash');
    this.renderHeld();
  }

  /** Put a carried stack back (origin slot, else anywhere). */
  private returnHeld(): void {
    const inv = this.inv;
    if (!this.held || !inv) return;
    const { stack, from } = this.held;
    this.held = null;
    if (!inv.slots[from]) inv.setSlot(from, stack);
    else {
      const left = inv.add(stack.id, stack.qty);
      if (left > 0) console.warn(`[ui] backpack full; ${left}× ${stack.id} lost`);
    }
    this.renderHeld();
  }

  private placeHeldOver(c: HTMLElement): void {
    const r = c.getBoundingClientRect();
    this.heldEl.style.transform = `translate(${r.left + r.width * 0.45}px, ${r.top - 22}px)`;
  }

  private renderHeld(): void {
    const h = this.held;
    this.heldEl.classList.toggle('hv-hidden', !h);
    this.root.classList.toggle('carrying', !!h);
    if (h) this.heldEl.innerHTML = itemIcon(h.stack.id, '') + (h.stack.qty > 1 ? `<span class="qty">${h.stack.qty}</span>` : '');
  }

  override back(): boolean {
    if (this.held) {
      this.returnHeld();
      sfx(this.game, 'drop');
      return true;
    }
    return false;
  }

  protected override onClose(): void {
    this.returnHeld();
    this.drag = null;
  }
}

/** Legacy export name. */
export { InventoryScreen as InventoryPanel };
