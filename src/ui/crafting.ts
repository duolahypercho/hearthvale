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
        <div class="cd-ings"><div class="cd-h">Ingredients</div>${ing}</div>
        <div class="cd-prev"><div class="cd-h">Placement</div>${previewSvg(r.out.itemId)}<small>${previewNote(r.out.itemId)}</small></div>
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
    const ped = this.detail.querySelector('.pedestal');
    replay(ped, 'strike');
    // Sparkle burst around the pedestal.
    const r = ped?.getBoundingClientRect();
    if (r)
      for (let i = 0; i < 12; i++) {
        const s = el('div', 'u-spark');
        const a = (i / 12) * Math.PI * 2;
        s.style.left = `${r.left + r.width / 2}px`;
        s.style.top = `${r.top + r.height / 2}px`;
        s.style.setProperty('--dx', `${Math.cos(a) * (60 + Math.random() * 30)}px`);
        s.style.setProperty('--dy', `${Math.sin(a) * (60 + Math.random() * 30)}px`);
        document.getElementById('ui-root')?.appendChild(s);
        setTimeout(() => s.remove(), 800);
      }
    this.qty = 1;
    this.refreshCards();
  }
}

// ── Placement preview: the item on a small tile grid with its area of effect ──

function previewSvg(itemId: string): string {
  const N = 7;
  const T = 26;
  const c = Math.floor(N / 2);
  const cells: string[] = [];
  const mark = new Map<string, string>();
  let extra = '';
  const isSprinkler = !!SPRINKLERS[itemId];
  if (isSprinkler) for (const [dx, dz] of sprinklerOffsets(itemId)) mark.set(`${c + dx},${c + dz}`, 'water');
  if (itemId === 'scarecrow') extra = `<circle cx="${(c + 0.5) * T}" cy="${(c + 0.5) * T}" r="${T * 3.3}" fill="rgba(255,220,120,0.18)" stroke="#e0a030" stroke-width="2" stroke-dasharray="5 4"/>`;
  const run = itemId === 'woodFence' ? [-2, -1, 0, 1, 2].map((dx) => `${c + dx},${c}`) : itemId === 'stonePath' ? [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => `${c + dx},${c + dz}`)) : [`${c},${c}`];
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const k = `${x},${z}`;
      const w = mark.get(k) === 'water';
      const soil = isSprinkler && Math.abs(x - c) <= 2 && Math.abs(z - c) <= 2;
      const base = soil ? (w ? '#6a4630' : '#9a6a44') : (x + z) % 2 ? '#8fcb5a' : '#86c252';
      cells.push(`<rect x="${x * T + 1}" y="${z * T + 1}" width="${T - 2}" height="${T - 2}" rx="4" fill="${base}"/>`);
      if (w) cells.push(`<rect x="${x * T + 1}" y="${z * T + 1}" width="${T - 2}" height="${T - 2}" rx="4" fill="#3f86d6" opacity=".28"/><path d="M${x * T + T / 2} ${z * T + 7} c3 5 3 8 0 9 c-3 -1 -3 -4 0 -9Z" fill="#9ee0ff" stroke="#24608a" stroke-width="1"/>`);
    }
  const icons = run.map((k) => {
    const [x, z] = k.split(',').map(Number) as [number, number];
    const ghost = k !== `${c},${c}`;
    return `<rect x="${x * T + 1}" y="${z * T + 1}" width="${T - 2}" height="${T - 2}" rx="4" fill="rgba(255,255,255,0.35)" stroke="#fff" stroke-width="1.6"/><image href="${itemIconUrl(itemId)}" x="${x * T - 3}" y="${z * T - 5}" width="${T + 6}" height="${T + 6}" opacity="${ghost ? 0.6 : 1}"/>`;
  });
  return `<svg class="grid" viewBox="0 0 ${N * T} ${N * T}"><rect width="${N * T}" height="${N * T}" rx="8" fill="#5e9a3a"/>${cells.join('')}${extra}${icons.join('')}<rect x="1" y="1" width="${N * T - 2}" height="${N * T - 2}" rx="8" fill="none" stroke="rgba(40,20,4,.35)" stroke-width="2"/></svg>`;
}

function previewNote(itemId: string): string {
  if (SPRINKLERS[itemId]) return `Waters ${sprinklerOffsets(itemId).length} tiles every morning`;
  if (itemId === 'scarecrow') return 'Crows stay clear within 8 tiles';
  if (itemId === 'woodFence') return 'Place in runs to pen animals';
  if (itemId === 'stonePath') return 'Pave walkways; blocks weeds';
  if (itemId === 'chest') return 'One tile · open with right-click';
  return 'Place it anywhere on the farm';
}
