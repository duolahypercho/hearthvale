/**
 * Crafting ('crafting'): the game menu's workbench tab.
 *   left   recipe cards (craftable ones glow with a green check, locked ones are chalk silhouettes)
 *   right  selected recipe on a lit pedestal, ingredients with have/need progress bars, what it makes, a
 *          placement preview (the item on a little tile grid with its reach — watered tiles, crow-safe
 *          radius, fence run …) and a quantity + Craft button with a hammer-strike and sparkle burst.
 * Crafting goes through the `crafting` service; recipes come from data/recipes.ts.
 */
import type { Game } from '../core/game';
import { RECIPES, type RecipeDef } from '../data/recipes';
import { itemDef } from '../data/items';
import { sprinklerOffsets, SPRINKLERS } from '../data/crops';
import { ICONS, itemIcon, itemIconUrl, itemCategory } from './icons';
import { Screen, el, frame, closeButton, tooltip, sfx, replay, escapeHtml } from './kit';
import { itemTooltipHtml } from './itemtip';
import { menuTabs } from './menutabs';
import { flyItemTo } from './item-fly';

export class CraftingScreen extends Screen {
  private sel = 0;
  private qty = 1;
  private cards!: HTMLElement;
  private detail!: HTMLElement;
  private list: { r: RecipeDef; known: boolean }[] = [];

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-crafting', { backdrop: true });
    game.events.on('inventory:change', () => {
      if (this.isOpen) this.refreshCards();
    });
  }

  private count(id: string): number {
    return this.game.services.inventory?.count(id) ?? 0;
  }

  private can(r: RecipeDef, times = 1): boolean {
    return r.cost.every((c) => this.count(c.itemId) >= c.qty * times);
  }

  private maxTimes(r: RecipeDef): number {
    return Math.max(0, Math.min(99, ...r.cost.map((c) => Math.floor(this.count(c.itemId) / c.qty))));
  }

  protected render(arg?: string): void {
    this.root.querySelector('.u-pop')?.remove();
    const known = new Set((this.game.services.crafting?.recipes() ?? RECIPES.filter((r) => !r.unlock)).map((r) => r.id));
    this.list = RECIPES.map((r) => ({ r, known: known.has(r.id) }));
    // Craftable first keeps the eye on what you can do right now.
    this.list.sort((a, b) => Number(b.known) - Number(a.known) || Number(this.can(b.r)) - Number(this.can(a.r)));
    const want = arg ? this.list.findIndex((x) => x.r.id === arg) : -1;
    this.sel = want >= 0 ? want : 0;
    this.qty = 1;
    const wrap = el('div', 'craft-wrap u-pop');
    const { frame: f, body } = frame('Workbench', 'craft-frame');
    f.appendChild(closeButton(() => this.requestClose()));
    wrap.append(menuTabs(this.game, 'crafting'), f);
    const left = el('div', 'craft-left');
    left.appendChild(el('div', 'craft-head', `<span>Recipes</span><small>${this.list.filter((x) => x.known).length} / ${this.list.length} known</small>`));
    this.cards = el('div', 'craft-cards');
    left.appendChild(this.cards);
    this.detail = el('div', 'craft-detail');
    body.append(left, this.detail);
    this.root.appendChild(wrap);
    this.list.forEach((x, i) => {
      const c = el('div', 'craft-card');
      c.dataset.nav = '';
      c.style.animationDelay = `${i * 40}ms`;
      c.addEventListener('click', () => {
        if (this.sel !== i) sfx(this.game, 'click');
        this.sel = i;
        this.qty = 1;
        this.refreshCards();
      });
      c.addEventListener('dblclick', () => this.craft());
      c.addEventListener('pointerenter', () => x.known && tooltip.show(itemTooltipHtml({ id: x.r.out.itemId, qty: x.r.out.qty })));
      c.addEventListener('pointerleave', () => tooltip.hide());
      this.cards.appendChild(c);
    });
    this.refreshCards();
  }

  protected override initialFocus(): HTMLElement | null {
    return this.cards?.children[this.sel] as HTMLElement | null;
  }

  private refreshCards(): void {
    this.list.forEach((x, i) => {
      const c = this.cards.children[i] as HTMLElement;
      const ok = x.known && this.can(x.r);
      c.className = `craft-card${x.known ? '' : ' locked'}${ok ? ' ok' : ''}${i === this.sel ? ' on' : ''}`;
      const d = itemDef(x.r.out.itemId);
      c.innerHTML = x.known
        ? `<div class="pic">${itemIcon(x.r.out.itemId)}${x.r.out.qty > 1 ? `<span class="qty">×${x.r.out.qty}</span>` : ''}</div><div class="nm">${escapeHtml(x.r.name)}</div>${ok ? '<i class="chk"></i>' : ''}`
        : `<div class="pic"><img class="u-ic sil" src="${itemIconUrl(x.r.out.itemId)}" alt=""/></div><div class="nm">???</div><small>${escapeHtml(x.r.unlock ?? 'Undiscovered')}</small>`;
      void d;
    });
    this.renderDetail();
  }

  private renderDetail(): void {
    const x = this.list[this.sel];
    if (!x) {
      this.detail.innerHTML = '';
      return;
    }
    const { r, known } = x;
    const d = itemDef(r.out.itemId);
    const cat = itemCategory(r.out.itemId);
    const maxT = this.maxTimes(r);
    this.qty = Math.max(1, Math.min(this.qty, Math.max(1, maxT)));
    const ok = known && maxT >= this.qty;
    const ing = r.cost
      .map((c) => {
        const have = this.count(c.itemId);
        const need = c.qty * this.qty;
        const pct = Math.min(100, (have / need) * 100);
        return `<div class="ing ${have >= need ? 'have' : ''}"><div class="u-slot mini">${itemIcon(c.itemId)}</div><div class="bar"><b>${escapeHtml(itemDef(c.itemId)?.name ?? c.itemId)}</b><div class="track"><div class="fill" style="width:${pct}%"></div></div></div><div class="n"><b>${have}</b>/${need}</div></div>`;
      })
      .join('');
    this.detail.innerHTML = `
      <div class="cd-top">
        <div class="pedestal ${ok ? 'lit' : ''}">${known ? itemIcon(r.out.itemId) : `<img class="u-ic sil" src="${itemIconUrl(r.out.itemId)}" alt=""/>`}</div>
        <div class="cd-title"><b>${known ? escapeHtml(r.name) : 'Unknown recipe'}</b><span class="t-cat" style="background:${cat.color}">${r.placeable ? 'Placeable' : cat.label}</span>
          <p>${known ? escapeHtml(d?.description ?? '') : `Learn it: ${escapeHtml(r.unlock ?? 'keep exploring')}.`}</p></div>
      </div>
      <div class="cd-cols">
        <div class="cd-ings"><div class="cd-h">Ingredients</div>${ing}
          <div class="cd-out ${ok ? 'ready' : ''}"><div class="u-slot mini">${known ? itemIcon(r.out.itemId) : `<img class="u-ic sil" src="${itemIconUrl(r.out.itemId)}" alt=""/>`}</div><div><b>Makes ×${r.out.qty * this.qty}</b><small>In pack <em>${this.count(r.out.itemId)}</em>${maxT > 0 && known ? ` · up to <em>${maxT * r.out.qty}</em>` : ''}</small></div>${known ? `<span class="ar">${ok ? 'Ready' : 'Missing'}</span>` : ''}</div>
          <div class="cd-uses">${ICONS.quill ?? ''}<span>${escapeHtml(usesNote(r.out.itemId))}</span></div>
        </div>
        ${
          r.placeable
            ? `<div class="cd-prev"><div class="cd-h">Placement</div>${previewSvg(r.out.itemId)}<small>${previewNote(r.out.itemId)}</small></div>`
            : `<div class="cd-prev bag"><div class="cd-h">Goes to</div><div class="bagpic">${ICONS.bag ?? ''}<div class="in">${known ? itemIcon(r.out.itemId) : ''}</div></div><small>Into your backpack</small></div>`
        }
      </div>
      <div class="cd-go">
        <div class="pk-qty"><button class="u-btn small" data-q="-1" data-nav>−</button><div class="pk-n"><span>${this.qty}</span><small>× ${r.out.qty}</small></div><button class="u-btn small" data-q="1" data-nav>+</button><button class="u-btn small" data-q="max" data-nav>Max</button></div>
        <button class="u-btn green craft-go ${ok ? '' : 'disabled'}" data-nav>${ICONS.hammer}<span>Craft${this.qty > 1 ? ` ×${this.qty}` : ''}</span></button>
      </div>`;
    this.detail.querySelectorAll<HTMLElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        const q = b.dataset.q!;
        this.qty = q === 'max' ? Math.max(1, maxT) : Math.max(1, Math.min(Math.max(1, maxT), this.qty + Number(q)));
        sfx(this.game, 'tick');
        this.renderDetail();
        const again = this.detail.querySelector<HTMLElement>(`[data-q="${q}"]`);
        if (again) this.nav.set(again, document.body.classList.contains('u-kbd'));
      }),
    );
    this.detail.querySelector('.craft-go')!.addEventListener('click', () => this.craft());
  }

  private craft(): void {
    const x = this.list[this.sel];
    const go = this.detail.querySelector('.craft-go') as HTMLElement | null;
    const svc = this.game.services.crafting;
    if (!x || !x.known || !svc || !this.can(x.r, this.qty)) {
      replay(go, 'shake');
      sfx(this.game, 'error');
      return;
    }
    let made = 0;
    for (let i = 0; i < this.qty; i++) if (svc.craft(x.r.id)) made++;
    if (!made) return;
    sfx(this.game, 'craft');
    const outQty = made * x.r.out.qty;
    this.qty = 1;
    this.refreshCards();
    // Payoff (after the re-render, so it lands on the live nodes): card pops, pedestal strikes and bursts,
    // a "+N" rises, and the item arcs into the Backpack tab, which bounces and shows a count badge.
    const card = this.cards.children[this.sel] as HTMLElement | undefined;
    replay(card, 'made');
    const ped = this.detail.querySelector<HTMLElement>('.pedestal');
    replay(ped, 'strike');
    const r = ped?.getBoundingClientRect();
    const root = document.getElementById('ui-root');
    if (r && root) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      for (let i = 0; i < 16; i++) {
        const s = el('div', `u-spark${i % 3 === 0 ? ' big' : ''}`);
        const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
        const d = 70 + Math.random() * 50;
        s.style.left = `${cx}px`;
        s.style.top = `${cy}px`;
        s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
        s.style.setProperty('--dy', `${Math.sin(a) * d - 20}px`);
        s.style.animationDelay = `${(i % 4) * 25}ms`;
        root.appendChild(s);
        setTimeout(() => s.remove(), 900);
      }
      const ring = el('div', 'u-craftring');
      ring.style.left = `${cx}px`;
      ring.style.top = `${cy}px`;
      root.appendChild(ring);
      setTimeout(() => ring.remove(), 700);
      const plus = el('div', 'u-craftplus', `+${outQty} <small>${escapeHtml(itemDef(x.r.out.itemId)?.name ?? '')}</small>`);
      plus.style.left = `${cx}px`;
      plus.style.top = `${r.top}px`;
      root.appendChild(plus);
      setTimeout(() => plus.remove(), 1300);
      const tab = this.root.querySelector<HTMLElement>('.u-tabs .u-tab');
      window.setTimeout(() => {
        if (!this.isOpen) return;
        flyItemTo(x.r.out.itemId, { x: cx, y: cy }, tab, 0, () => {
          if (!tab || !this.isOpen) return;
          sfx(this.game, 'pickup');
          let badge = tab.querySelector<HTMLElement>('.u-tabbadge');
          if (!badge) {
            badge = el('b', 'u-tabbadge');
            badge.dataset.n = '0';
            tab.appendChild(badge);
          }
          const n = Number(badge.dataset.n) + outQty;
          badge.dataset.n = String(n);
          badge.textContent = `+${n}`;
          replay(badge, 'pop');
          replay(tab, 'got');
        }, 52);
      }, 180);
    }
  }
}

// ── Placement preview: a tiny isometric diorama slab — the item on its tile, with its reach ──

const N = 7;
const TW = 30;
const TH = 15;
const X0 = 105;
const Y0 = 40;
const DEPTH = 11;

function h2(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Top vertex of tile (x, z) in the iso view. */
function iso(x: number, z: number): [number, number] {
  return [X0 + ((x - z) * TW) / 2, Y0 + ((x + z) * TH) / 2];
}

function diamond(x: number, z: number, inset = 0): string {
  const [sx, sy] = iso(x, z);
  const i = inset;
  return `M${sx} ${sy + i} L${sx + TW / 2 - i * 2} ${sy + TH / 2} L${sx} ${sy + TH - i} L${sx - TW / 2 + i * 2} ${sy + TH / 2} Z`;
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((o) => parseInt(a.slice(o, o + 2), 16));
  const pb = [1, 3, 5].map((o) => parseInt(b.slice(o, o + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

function previewSvg(itemId: string): string {
  const c = Math.floor(N / 2);
  const isSprinkler = !!SPRINKLERS[itemId];
  const wet = new Set<string>();
  if (isSprinkler) for (const [dx, dz] of sprinklerOffsets(itemId)) wet.add(`${c + dx},${c + dz}`);
  const reach = isSprinkler ? Math.max(1, ...sprinklerOffsets(itemId).map(([dx, dz]) => Math.max(Math.abs(dx), Math.abs(dz)))) + 1 : 0;
  const paved = new Set(itemId === 'stonePath' ? [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => `${c + dx},${c + dz}`)) : []);
  const fence = itemId === 'woodFence' ? [-2, -1, 0, 1, 2].map((dx) => [c + dx, c] as [number, number]) : [];
  const out: string[] = [];
  // Slab sides (dirt) + grass lip.
  const [lx, ly] = iso(0, N);
  const [bx, by] = iso(N, N);
  const [rx, ry] = iso(N, 0);
  out.push(`<path d="M${lx} ${ly} L${bx} ${by} L${bx} ${by + DEPTH} L${lx} ${ly + DEPTH} Z" fill="#7a4e2c"/>`);
  out.push(`<path d="M${bx} ${by} L${rx} ${ry} L${rx} ${ry + DEPTH} L${bx} ${by + DEPTH} Z" fill="#5e3a1e"/>`);
  out.push(`<path d="M${lx} ${ly + 5} L${bx} ${by + 5} L${bx} ${by + 7} L${lx} ${ly + 7} Z" fill="#4a2c14" opacity=".25"/>`);
  out.push(`<path d="M${lx} ${ly} L${bx} ${by} L${rx} ${ry} L${bx} ${by + 3.5} Z" fill="#5a9a3a"/>`);
  // Tiles.
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const k = `${x},${z}`;
      const j = h2(x, z);
      const soil = isSprinkler && Math.abs(x - c) <= reach && Math.abs(z - c) <= reach;
      let fill: string;
      if (paved.has(k)) fill = mix('#b8b2a6', '#9a9488', j);
      else if (soil) fill = wet.has(k) ? mix('#6a4428', '#5a3a22', j) : mix('#a8764a', '#9a6a40', j);
      else fill = mix((x + z) % 2 ? '#8fcb5a' : '#86c252', '#9ad466', j * 0.5);
      out.push(`<path d="${diamond(x, z)}" fill="${fill}" stroke="rgba(40,60,20,.18)" stroke-width=".6"/>`);
      const [sx, sy] = iso(x, z);
      const cy = sy + TH / 2;
      if (paved.has(k)) {
        out.push(`<path d="${diamond(x, z, 2.2)}" fill="${mix('#d8d2c4', '#c4bcae', j)}"/><path d="M${sx - 5} ${cy} L${sx + 1} ${cy + 2} L${sx + 6} ${cy - 1}" stroke="#8a8478" stroke-width=".9" fill="none"/>`);
      } else if (soil) {
        out.push(`<path d="M${sx - 8} ${cy + 1} L${sx - 1} ${cy - 2.5} M${sx - 2} ${cy + 4} L${sx + 6} ${cy + 0.5}" stroke="rgba(40,20,6,.35)" stroke-width="1.1" stroke-linecap="round"/>`);
        if (wet.has(k)) out.push(`<path class="pv-wet" d="${diamond(x, z, 1)}" fill="#4aa0e8" style="animation-delay:${(-j * 2).toFixed(2)}s"/><path d="M${sx} ${cy - 5} c2.4 3.4 2.4 5.4 0 6 c-2.4 -.6 -2.4 -2.6 0 -6Z" fill="#bfeaff" stroke="#24608a" stroke-width=".8"/>`);
      } else if (j > 0.72) {
        out.push(`<path d="M${sx - 3} ${cy + 2} l-1 -4 M${sx - 1} ${cy + 2} l0 -5 M${sx + 1} ${cy + 2} l1.5 -4" stroke="#4f8a30" stroke-width="1" stroke-linecap="round"/>`);
      } else if (j < 0.08) {
        out.push(`<circle cx="${sx + 3}" cy="${cy}" r="1.6" fill="${j < 0.04 ? '#fff4d0' : '#ffb3cf'}"/>`);
      }
    }
  // Reach overlays.
  if (itemId === 'scarecrow') {
    const [sx, sy] = iso(c, c);
    const r = 3.3 * Math.SQRT2;
    out.push(`<ellipse class="pv-ring" cx="${sx}" cy="${sy + TH / 2}" rx="${(r * TW) / 2}" ry="${(r * TH) / 2}" fill="rgba(255,220,120,0.16)" stroke="#f0b040" stroke-width="1.6" stroke-dasharray="5 4"/>`);
  }
  // Target tile frame.
  out.push(`<path class="pv-frame" d="${diamond(c, c, 0.5)}" fill="rgba(255,255,255,.28)" stroke="#fff" stroke-width="1.6"/>`);
  // Items, back to front.
  const placed: [number, number, boolean][] = fence.length ? fence.map(([x, z]) => [x, z, x !== c] as [number, number, boolean]) : paved.size ? [] : [[c, c, false]];
  placed.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const url = itemIconUrl(itemId);
  for (const [x, z, ghost] of placed) {
    const [sx, sy] = iso(x, z);
    const cy = sy + TH / 2;
    const w = fence.length ? 34 : 56;
    out.push(`<ellipse cx="${sx}" cy="${cy + 1}" rx="${w * 0.34}" ry="${w * 0.12}" fill="#1e3010" opacity=".3"/>`);
    out.push(`<g class="${ghost ? '' : 'pv-item'}"><image href="${url}" x="${sx - w / 2}" y="${cy - w * 0.9}" width="${w}" height="${w}" opacity="${ghost ? 0.62 : 1}"/></g>`);
  }
  return `<svg class="grid iso" viewBox="0 0 210 ${Y0 + N * TH + DEPTH + 6}">${out.join('')}</svg>`;
}

function usesNote(itemId: string): string {
  if (SPRINKLERS[itemId]) return 'Set it among crops and forget the watering can.';
  if (itemId === 'scarecrow') return 'Plant it mid-field before the crows find the seedlings.';
  if (itemId === 'woodFence') return 'Pens, garden borders and cow paddocks.';
  if (itemId === 'stonePath') return 'Tidy paths between beds; nothing grows through.';
  if (itemId === 'chest') return 'Extra storage for the harvest rush.';
  if (itemId === 'hay') return 'Fill the feed troughs in the coop and barn.';
  if (itemId === 'coal') return 'Fuel for the smith and for smelting ore.';
  return itemDef(itemId)?.description ?? '';
}

function previewNote(itemId: string): string {
  if (SPRINKLERS[itemId]) return `Waters ${sprinklerOffsets(itemId).length} tiles every morning`;
  if (itemId === 'scarecrow') return 'Crows stay clear within 8 tiles';
  if (itemId === 'woodFence') return 'Place in runs to pen animals';
  if (itemId === 'stonePath') return 'Pave walkways; blocks weeds';
  if (itemId === 'chest') return 'One tile · open with right-click';
  return 'Place it anywhere on the farm';
}
