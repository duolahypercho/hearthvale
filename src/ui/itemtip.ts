/**
 * Item tooltip + slot markup shared by the toolbar, backpack, shop, crafting and ledgers.
 */
import { itemDef } from '../data/items';
import { CROPS, daysToRipe, type CropId } from '../data/crops';
import { itemIcon, itemCategory, qualityStar, QUALITY_MULT, ICONS } from './icons';
import { escapeHtml } from './kit';

export interface StackView {
  id: string;
  qty: number;
  /** 0 normal · 1 silver · 2 gold · 3 radiant. */
  quality?: number;
}

const Q_NAMES = ['Normal', 'Silver', 'Gold', 'Radiant'];

export function unitPrice(s: StackView): number {
  const d = itemDef(s.id);
  return Math.floor((d?.sell ?? 0) * (QUALITY_MULT[s.quality ?? 0] ?? 1));
}

/** Inner HTML of a slot for a stack (icon + qty + quality star). */
export function slotInner(s: StackView | null | undefined): string {
  if (!s) return '';
  return itemIcon(s.id) + (s.qty > 1 ? `<span class="qty">${s.qty}</span>` : '') + qualityStar(s.quality ?? 0);
}

/** Quality as a row of three stars: `q` lit in the quality's colour, the rest as faint outlines. */
export function starRow(q: number): string {
  if (!q) return '';
  return Array.from({ length: 3 }, (_, i) => qualityStar(q, i < q ? 'u-star' : 'u-star dim')).join('');
}

/** Legacy helper (old HUD API). */
export function slotHtml(s: StackView | null): string {
  return slotInner(s);
}

const SEASON_LABEL: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };

export function itemTooltipHtml(s: StackView, opts: { hint?: string; price?: number; priceLabel?: string } = {}): string {
  const d = itemDef(s.id);
  const cat = itemCategory(s.id);
  const name = d?.name ?? s.id;
  let desc = d?.description ?? '';
  let meta = '';
  if (d?.kind === 'seed' && d.crop) {
    const c = CROPS[d.crop as CropId];
    if (c) {
      desc = desc || (c as { blurb?: string }).blurb || 'Plant in tilled soil and water daily.';
      meta = `<div class="t-meta">${ICONS.sprout} ${daysToRipe(c)} days · ${c.seasons.map((x) => SEASON_LABEL[x]).join(' / ')}${c.regrow ? ` · regrows every ${c.regrow}` : ''}</div>`;
    }
  } else if (d?.kind === 'produce' && !desc) desc = 'Fresh from the farm. Ship it, gift it, or cook with it.';
  else if (d?.kind === 'resource' && !desc) desc = 'A useful crafting material.';
  const q = s.quality ?? 0;
  const quality = q ? `<div class="t-q">${starRow(q)} <span>${Q_NAMES[q]} quality · ×${QUALITY_MULT[q]} value</span></div>` : '';
  const each = opts.price ?? unitPrice(s);
  let row = '';
  if (each > 0) {
    const total = each * Math.max(1, s.qty);
    row = `<div class="t-row">${ICONS.coin}<span>${each.toLocaleString()}g</span><span class="sp"></span>${s.qty > 1 && opts.price === undefined ? `<span style="color:#8a6440">×${s.qty} = ${total.toLocaleString()}g</span>` : `<span style="color:#8a6440">${opts.priceLabel ?? 'sell'}</span>`}</div>`;
  } else if (d?.kind === 'tool') row = `<div class="t-row" style="color:#8a6440">${ICONS.hammer}<span>Tool · can't be sold</span></div>`;
  return `<div class="t-in"><div class="t-head"><span class="t-ic">${itemIcon(s.id)}</span><div><div class="t-name">${escapeHtml(name)}</div><span class="t-cat" style="background:${cat.color}">${cat.label}</span></div></div>${quality}${desc ? `<div class="t-desc">${escapeHtml(desc)}</div>` : ''}${meta}${row}${opts.hint ? `<div class="t-hint">${opts.hint}</div>` : ''}</div>`;
}
