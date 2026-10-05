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

/** r5: recipe shelves (tabs over the card grid, so the grid scales to 30+ recipes). */
const CATS: { id: string; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'grid' },
  { id: 'farming', label: 'Farming', icon: 'sprout' },
  { id: 'storage', label: 'Storage', icon: 'bag' },
  { id: 'decor', label: 'Decor', icon: 'star' },
  { id: 'supplies', label: 'Supplies', icon: 'basket' },
];
function recipeCat(r: RecipeDef): string {
  const id = r.out.itemId;
  if (SPRINKLERS[id] || id === 'scarecrow' || /sprinkler|scarecrow|fertil/i.test(id)) return 'farming';
  if (/chest|crate|keg|jar/i.test(id)) return 'storage';
  if (/fence|path|lamp|sign|flower|torch|gate/i.test(id)) return 'decor';
  return 'supplies';
}

/** Recipes pictured by something other than their output (the Hay Bale recipe makes loose hay). */
const RECIPE_ART: Record<string, string> = { hay: 'hayBale', coal: 'charcoal' };

export class CraftingScreen extends Screen {
  private sel = 0;
  private qty = 1;
  private cards!: HTMLElement;
  private detail!: HTMLElement;
  private list: { r: RecipeDef; known: boolean }[] = [];
  private cat = 'all';
  private tabsEl!: HTMLElement;

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
    this.tabsEl = el('div', 'craft-tabs');
    left.appendChild(this.tabsEl);
    this.cards = el('div', 'craft-cards');
    left.appendChild(this.cards);
    this.detail = el('div', 'craft-detail');
    body.append(left, this.detail);
    this.root.appendChild(wrap);
    if (want >= 0 && this.cat !== 'all' && recipeCat(this.list[want]!.r) !== this.cat) this.cat = 'all';
    this.buildTabs();
    this.buildCards();
  }

  private buildTabs(): void {
    this.tabsEl.innerHTML = '';
    for (const c of CATS) {
      const n = c.id === 'all' ? this.list.length : this.list.filter((x) => recipeCat(x.r) === c.id).length;
      if (!n) continue;
      const b = el('button', `craft-tab${c.id === this.cat ? ' on' : ''}`, `<span>${c.label}</span><em>${n}</em>`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        if (this.cat === c.id) return;
        sfx(this.game, 'tab');
        this.cat = c.id;
        this.tabsEl.querySelectorAll('.craft-tab').forEach((t) => t.classList.toggle('on', t === b));
        // Keep the selection when it's on this shelf, else pick the shelf's first recipe.
        if (c.id !== 'all' && recipeCat(this.list[this.sel]!.r) !== c.id) this.sel = this.list.findIndex((x) => recipeCat(x.r) === c.id);
        this.qty = 1;
        this.buildCards();
      });
      this.tabsEl.appendChild(b);
    }
  }

  private buildCards(): void {
    this.cards.innerHTML = '';
    this.list.forEach((x, i) => {
      if (this.cat !== 'all' && recipeCat(x.r) !== this.cat) return;
      const c = el('div', 'craft-card');
      c.dataset.i = String(i);
      c.dataset.nav = '';
      c.style.animationDelay = `${this.cards.children.length * 30}ms`;
      c.addEventListener('click', () => {
        tooltip.hide();
        this.select(i);
      });
      c.addEventListener('dblclick', () => this.craft());
      // Keyboard / gamepad focus drives the selection (the detail column follows, like a click).
      c.addEventListener('u-focus', () => this.select(i));
      // Hover preview for the other recipes only (the selected one is already spelled out in the detail
      // column), docked outside the workbench's left edge (level with the card) so it never covers a recipe
      // or the ingredient counts; on narrow screens it falls back to the card's left.
      c.addEventListener('pointerenter', () => {
        if (x.known && i !== this.sel) tooltip.beside(itemTooltipHtml({ id: x.r.out.itemId, qty: x.r.out.qty }), c, 'left', 16, this.root.querySelector('.u-frame') ?? undefined);
      });
      c.addEventListener('pointerleave', () => tooltip.hide());
      this.cards.appendChild(c);
    });
    // Blank pages fill the shelf to whole rows (≥ 4 rows on "All"): the book has room for recipes yet to learn.
    const n = this.cards.children.length;
    const want = Math.max(this.cat === 'all' ? 16 : 8, Math.ceil(n / 4) * 4);
    for (let k = n; k < want; k++) {
      const b = el('div', 'craft-blank');
      b.style.animationDelay = `${k * 30}ms`;
      this.cards.appendChild(b);
    }
    this.refreshCards();
  }

  private select(i: number): void {
    if (this.sel === i) return;
    sfx(this.game, 'click');
    this.sel = i;
    this.qty = 1;
    this.refreshCards();
  }

  protected override initialFocus(): HTMLElement | null {
    return this.cardFor(this.sel) ?? (this.cards?.firstElementChild as HTMLElement | null);
  }

  private cardFor(i: number): HTMLElement | null {
    return this.cards?.querySelector<HTMLElement>(`.craft-card[data-i="${i}"]`) ?? null;
  }

  private refreshCards(): void {
    for (const c of [...this.cards.children] as HTMLElement[]) {
      if (!c.classList.contains('craft-card')) continue;
      const i = Number(c.dataset.i);
      const x = this.list[i];
      if (!x) continue;
      const ok = x.known && this.can(x.r);
      c.className = `craft-card${x.known ? '' : ' locked'}${ok ? ' ok' : x.known ? ' short' : ''}${i === this.sel ? ' on' : ''}${c === this.nav.current ? ' u-focus' : ''}`;
      // r5: neutral parchment cards; craftability reads from a per-ingredient progress strip (green when met)
      // and one line under it — "makes N" in green, or the missing ingredient's count in red.
      const segs = x.r.cost
        .map((k) => {
          const have = this.count(k.itemId);
          const p = Math.min(1, have / k.qty);
          return `<i class="${p >= 1 ? 'met' : p >= 0.5 ? 'half' : ''}" style="--p:${p.toFixed(3)}"></i>`;
        })
        .join('');
      const miss = x.r.cost.map((k) => ({ k, have: this.count(k.itemId) })).filter((m) => m.have < m.k.qty).sort((a, b) => a.have / a.k.qty - b.have / b.k.qty)[0];
      const line = ok
        ? `<small class="mk">makes ${this.maxTimes(x.r) * x.r.out.qty}</small>`
        : miss
          ? `<small class="ms"><b>${miss.have}</b>/${miss.k.qty} ${escapeHtml(shortItem(miss.k.itemId))}</small>`
          : '';
      c.innerHTML = x.known
        ? `<div class="pic">${itemIcon(RECIPE_ART[x.r.id] ?? x.r.out.itemId)}</div>${x.r.out.qty > 1 ? `<span class="yield">×${x.r.out.qty}</span>` : ''}<div class="nm">${escapeHtml(x.r.name)}</div><div class="prog">${segs}</div>${line}`
        : `<div class="pic"><img class="u-ic sil" src="${itemIconUrl(x.r.out.itemId)}" alt=""/></div><div class="nm">???</div><small>${escapeHtml(x.r.unlock ?? 'Undiscovered')}</small>`;
    }
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
    // One-ingredient recipes stack the "Uses" chips under the ingredients; longer recipes get a full-width strip.
    const few = r.cost.length <= 1;
    const factsHtml = `<div class="cd-facts${few ? ' stack' : ''}"><div class="cd-h">${known ? 'Uses' : 'How to learn'}</div><div class="chips">${
        known
          ? facts(r.out.itemId)
              .map(([ic, big, small]) => `<div class="fact">${ICONS[ic] ?? ''}<div><b>${escapeHtml(big)}</b><small>${escapeHtml(small)}</small></div></div>`)
              .join('')
          : `<div class="fact wide">${ICONS.question ?? ''}<div><b>${escapeHtml(r.unlock ?? 'Keep exploring')}</b><small>The recipe appears here once every ingredient has passed through your backpack.</small></div></div>`
      }</div>
      </div>`;
    this.detail.classList.toggle('many', r.cost.length >= 3);
    this.detail.innerHTML = `
      <div class="cd-top">
        <div class="pedestal ${ok ? 'lit' : ''}">${known ? itemIcon(RECIPE_ART[r.id] ?? r.out.itemId) : `<img class="u-ic sil" src="${itemIconUrl(r.out.itemId)}" alt=""/>`}</div>
        <div class="cd-title"><b>${known ? escapeHtml(r.name) : 'Unknown recipe'}</b><span class="t-cat" style="background:${cat.color}">${r.placeable ? 'Placeable' : cat.label}</span>
          <p>${known ? escapeHtml(d?.description || usesNote(r.out.itemId)) : `Learn it: ${escapeHtml(r.unlock ?? 'keep exploring')}.`}</p></div>
      </div>
      <div class="cd-cols">
        <div class="cd-ings"><div class="cd-h">Ingredients</div>${ing}
          <div class="cd-out ${ok ? 'ready' : ''}"><div class="u-slot mini">${known ? itemIcon(r.out.itemId) : `<img class="u-ic sil" src="${itemIconUrl(r.out.itemId)}" alt=""/>`}</div><div><b>Makes ×${r.out.qty * this.qty}</b><span class="cd-chips"><i>In pack <em>${this.count(r.out.itemId)}</em></i>${known ? `<i>Can make <em>${maxT * r.out.qty}</em></i>` : ''}</span></div>${known ? `<span class="ar">${ok ? 'Ready' : 'Missing'}</span>` : ''}</div>
          ${few ? factsHtml : ''}
        </div>
        ${
          r.placeable
            ? (() => {
                const sm = sampleWorld(this.game);
                const where = sm ? (sm.ok ? 'In front of you · free tile' : 'In front of you · blocked, step aside') : previewNote(r.out.itemId);
                return `<div class="cd-prev"><div class="cd-h">Placement<em class="${sm && !sm.ok ? 'no' : 'ok'}">${sm ? (sm.ok ? 'fits' : 'blocked') : ''}</em></div><div class="pv-stage">${previewSvg(r.out.itemId, sm)}</div><div class="pv-legend"><span><i class="ok"></i>free tile</span>${SPRINKLERS[r.out.itemId] ? '<span><i class="wet"></i>watered</span>' : r.out.itemId === 'scarecrow' ? '<span><i class="ring"></i>crow-safe</span>' : ''}<span><i class="no"></i>blocked</span></div><small title="${escapeHtml(previewNote(r.out.itemId))}">${where}</small></div>`;
              })()
            : `<div class="cd-prev bag"><div class="cd-h">Goes to</div><div class="pv-stage"><div class="bagpic">${ICONS.bag ?? ''}<div class="in">${known ? itemIcon(r.out.itemId) : ''}</div></div></div><small>Into your backpack</small></div>`
        }
      </div>
      ${few ? '' : factsHtml}
      <div class="cd-go">
        <div class="pk-qty"><button class="u-btn small" data-q="-1" data-nav>−</button><div class="pk-n"><span>${this.qty}</span><small>${r.out.qty > 1 ? `makes ${r.out.qty * this.qty}` : 'qty'}</small></div><button class="u-btn small" data-q="1" data-nav>+</button><button class="u-btn small" data-q="max" data-nav>Max</button></div>
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
    const card = this.cardFor(this.sel);
    replay(card, 'made');
    const ped = this.detail.querySelector<HTMLElement>('.pedestal');
    const go2 = this.detail.querySelector<HTMLElement>('.craft-go');
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
      // The "+N" rises off the Craft button and the item arcs from there into the Backpack tab (never over
      // the medallion art).
      const gr = go2?.getBoundingClientRect();
      const bx = gr && gr.width ? gr.left + gr.width / 2 : cx;
      const by = gr && gr.width ? gr.top : cy;
      const plus = el('div', 'u-craftplus', `+${outQty} <small>${escapeHtml(itemDef(x.r.out.itemId)?.name ?? '')}</small>`);
      plus.style.left = `${bx}px`;
      plus.style.top = `${by - 44}px`;
      root.appendChild(plus);
      setTimeout(() => plus.remove(), 1300);
      const tab = this.root.querySelector<HTMLElement>('.u-tabs .u-tab');
      window.setTimeout(() => {
        if (!this.isOpen) return;
        flyItemTo(x.r.out.itemId, { x: bx, y: by }, tab, 0, () => {
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

// ── Placement preview: a top-down-ish iso crop of the real farm in front of the farmer (r4) — the actual
// tiles (grass, tilled / watered soil, path, water, sand, floor) and what stands on them (crops, weeds, stones,
// trees, fences, buildings), the ghost item on the tile you'd place it on, tinted green (free) or red (blocked),
// with its reach. Off the farm / no world: the same slab, painted as an open meadow.

const TW = 30;
const TH = 23;
const Y0 = 30;
const DEPTH = 11;

/** One sampled tile: ground type + flags + what stands on it. */
interface PvTile {
  t: number;
  f: number;
  obj?: { kind: string; id: string };
}
export interface PvSample {
  n: number;
  tiles: PvTile[];
  /** Can the item go on the centre tile? */
  ok: boolean;
  real: boolean;
}

/** Sample an n×n window of the current map around the tile the farmer faces. */
export function sampleWorld(game: Game, n = 7): PvSample | null {
  const map = game.world.current;
  const grid = map?.grid;
  const pl = game.player as unknown as { facingTile?: () => { x: number; z: number } };
  if (!grid || !pl.facingTile) return null;
  const t = pl.facingTile();
  const c = Math.floor(n / 2);
  const tiles: PvTile[] = [];
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const gx = t.x + x - c;
      const gz = t.z + z - c;
      if (!grid.inBounds(gx, gz)) {
        tiles.push({ t: 5, f: 1 });
        continue;
      }
      const ty = grid.getType(gx, gz);
      let f = 0;
      for (const bit of [1, 2, 4, 8, 16, 32]) if (grid.hasFlag(gx, gz, bit)) f |= bit;
      const o = grid.getObject(gx, gz);
      tiles.push(o ? { t: ty, f, obj: { kind: String(o.kind), id: o.id } } : { t: ty, f });
    }
  const ok = grid.inBounds(t.x, t.z) && !grid.getObject(t.x, t.z) && grid.isWalkable(t.x, t.z) && !grid.hasFlag(t.x, t.z, 1 << 5);
  return { n, tiles, ok, real: true };
}

function meadow(n: number): PvSample {
  return { n, tiles: Array.from({ length: n * n }, () => ({ t: 1, f: 2 })), ok: true, real: false };
}

function h2(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((o) => parseInt(a.slice(o, o + 2), 16));
  const pb = [1, 3, 5].map((o) => parseInt(b.slice(o, o + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

function previewSvg(itemId: string, sample?: PvSample | null): string {
  const S = sample ?? meadow(7);
  const N = S.n;
  const X0 = (N * TW) / 2;
  const iso = (x: number, z: number): [number, number] => [X0 + ((x - z) * TW) / 2, Y0 + ((x + z) * TH) / 2];
  const diamond = (x: number, z: number, i = 0): string => {
    const [sx, sy] = iso(x, z);
    return `M${sx} ${sy + i} L${sx + TW / 2 - i * 2} ${sy + TH / 2} L${sx} ${sy + TH - i} L${sx - TW / 2 + i * 2} ${sy + TH / 2} Z`;
  };
  const c = Math.floor(N / 2);
  const isSprinkler = !!SPRINKLERS[itemId];
  const wet = new Set<string>();
  if (isSprinkler) for (const [dx, dz] of sprinklerOffsets(itemId)) wet.add(`${c + dx},${c + dz}`);
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
  const props: [number, string][] = [];
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const k = `${x},${z}`;
      const T = S.tiles[z * N + x]!;
      const j = h2(x + 17, z + 31);
      const tilled = (T.f & 4) !== 0;
      const watered = (T.f & 8) !== 0;
      let fill: string;
      if (paved.has(k)) fill = mix('#b8b2a6', '#9a9488', j);
      else if (tilled) fill = watered ? mix('#5e3c22', '#4e3220', j) : mix('#a8764a', '#9a6a40', j);
      else if (T.t === 4) fill = mix('#4a9ad0', '#3a86c0', j);
      else if (T.t === 3 || T.t === 8) fill = mix('#c8b48c', '#b8a47c', j);
      else if (T.t === 7) fill = mix('#ecd8a0', '#e0c88c', j);
      else if (T.t === 6) fill = mix('#c08a52', '#a87442', j);
      else if (T.t === 2) fill = mix('#a87e52', '#9a7048', j);
      else if (T.t === 5 || T.t === 0) fill = mix('#7a7466', '#6a6458', j);
      else fill = mix((x + z) % 2 ? '#8fcb5a' : '#86c252', '#9ad466', j * 0.5);
      out.push(`<path d="${diamond(x, z)}" fill="${fill}" stroke="rgba(40,60,20,.18)" stroke-width=".6"/>`);
      const [sx, sy] = iso(x, z);
      const cy = sy + TH / 2;
      if (paved.has(k)) {
        out.push(`<path d="${diamond(x, z, 2.2)}" fill="${mix('#d8d2c4', '#c4bcae', j)}"/><path d="M${sx - 5} ${cy} L${sx + 1} ${cy + 2} L${sx + 6} ${cy - 1}" stroke="#8a8478" stroke-width=".9" fill="none"/>`);
      } else if (tilled) {
        out.push(`<path d="M${sx - 8} ${cy + 1} L${sx - 1} ${cy - 2.5} M${sx - 2} ${cy + 4} L${sx + 6} ${cy + 0.5}" stroke="rgba(40,20,6,.35)" stroke-width="1.1" stroke-linecap="round"/>`);
      } else if (T.t === 4) {
        out.push(`<path d="M${sx - 6} ${cy} q3 -2 6 0 t6 0" stroke="#bfe6ff" stroke-width=".9" fill="none" opacity=".8"/>`);
      } else if (T.t === 1 && !T.obj) {
        if (j > 0.74) out.push(`<path d="M${sx - 3} ${cy + 2} l-1 -4 M${sx - 1} ${cy + 2} l0 -5 M${sx + 1} ${cy + 2} l1.5 -4" stroke="#4f8a30" stroke-width="1" stroke-linecap="round"/>`);
        else if (j < 0.07) out.push(`<circle cx="${sx + 3}" cy="${cy}" r="1.6" fill="${j < 0.035 ? '#fff4d0' : '#ffb3cf'}"/>`);
      }
      if (wet.has(k)) out.push(`<path class="pv-wet" d="${diamond(x, z, 1)}" fill="#4aa0e8" style="animation-delay:${(-j * 2).toFixed(2)}s"/><path d="M${sx} ${cy - 5} c2.4 3.4 2.4 5.4 0 6 c-2.4 -.6 -2.4 -2.6 0 -6Z" fill="#bfeaff" stroke="#24608a" stroke-width=".8"/>`);
      // What stands on the tile (drawn back-to-front with the item below).
      const o = T.obj;
      if (o) {
        const d = x + z;
        let g = '';
        if (o.kind === 'crop') g = `<path d="M${sx} ${cy + 1} c-4 -3 -6 -7 -5 -10 c3 1 5 4 5 10 c0 -6 2 -9 5 -10 c1 3 -1 7 -5 10Z" fill="#5fae45" stroke="#2f6b2a" stroke-width=".9"/>`;
        else if (o.kind === 'weed') g = `<path d="M${sx - 4} ${cy + 1} l-1 -6 M${sx} ${cy + 1} l0 -7 M${sx + 4} ${cy + 1} l1.5 -6" stroke="#3f7a2a" stroke-width="1.6" stroke-linecap="round"/>`;
        else if (o.kind === 'stone' || o.kind === 'boulder') g = `<ellipse cx="${sx}" cy="${cy - 2}" rx="${o.kind === 'boulder' ? 9 : 6}" ry="${o.kind === 'boulder' ? 6 : 4}" fill="#a8a296" stroke="#5e584e" stroke-width="1"/><ellipse cx="${sx - 2}" cy="${cy - 4}" rx="2.4" ry="1.2" fill="#fff" opacity=".5"/>`;
        else if (o.kind === 'twig' || o.kind === 'stump') g = `<ellipse cx="${sx}" cy="${cy - 1}" rx="6" ry="3.4" fill="#9a6a3a" stroke="#4a2c14" stroke-width="1"/><ellipse cx="${sx}" cy="${cy - 2}" rx="3.6" ry="1.8" fill="#e2b57a"/>`;
        else if (o.kind === 'tree' || o.kind === 'bush') {
          const r = o.kind === 'tree' ? 12 : 7;
          g = `<rect x="${sx - 1.6}" y="${cy - r}" width="3.2" height="${r}" fill="#6a4020"/><circle cx="${sx}" cy="${cy - r - r * 0.4}" r="${r}" fill="${mix('#3f7a2e', '#5a9a3a', j)}" stroke="#24461a" stroke-width="1"/><circle cx="${sx - r * 0.35}" cy="${cy - r - r * 0.7}" r="${r * 0.35}" fill="#8cc860" opacity=".5"/>`;
        } else if (o.kind === 'fence') g = `<path d="M${sx - 7} ${cy - 1} V${cy - 9} M${sx + 7} ${cy - 1} V${cy - 9} M${sx - 8} ${cy - 6} H${sx + 8}" stroke="#7a4a22" stroke-width="2.2" stroke-linecap="round"/>`;
        else if (o.kind === 'building') g = `<path d="${diamond(x, z, 0.5)}" fill="#8a5a32" opacity=".9"/><path d="M${sx - 12} ${cy} V${cy - 10} L${sx} ${cy - 18} L${sx + 12} ${cy - 10} V${cy}" fill="#c08a52" stroke="#4a2810" stroke-width="1"/>`;
        else g = `<rect x="${sx - 5}" y="${cy - 9}" width="10" height="9" rx="1.5" fill="#c08a52" stroke="#4a2810" stroke-width="1"/>`;
        props.push([d, g]);
      }
    }
  // Reach overlays.
  if (itemId === 'scarecrow') {
    const [sx, sy] = iso(c, c);
    const r = 3.3 * Math.SQRT2;
    out.push(`<ellipse class="pv-ring" cx="${sx}" cy="${sy + TH / 2}" rx="${(r * TW) / 2}" ry="${(r * TH) / 2}" fill="rgba(255,220,120,0.16)" stroke="#f0b040" stroke-width="1.6" stroke-dasharray="5 4"/>`);
  }
  // r5: the four neighbours take a soft tint (where you'd stand / what it touches), so the target tile reads.
  if (!fence.length && !paved.size)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][])
      out.push(`<path d="${diamond(c + dx, c + dz, 1)}" fill="${S.ok ? 'rgba(255,240,170,.26)' : 'rgba(255,170,150,.22)'}" stroke="${S.ok ? 'rgba(255,250,220,.7)' : 'rgba(255,210,200,.6)'}" stroke-width=".8" stroke-dasharray="3 2"/>`);
  // Target tile: green (free) / red with an X (blocked).
  const [tx, ty] = iso(c, c);
  out.push(
    S.ok
      ? `<path class="pv-frame" d="${diamond(c, c, 0.5)}" fill="rgba(120,230,110,.38)" stroke="#e8ffd8" stroke-width="1.8"/>`
      : `<path class="pv-frame bad" d="${diamond(c, c, 0.5)}" fill="rgba(230,70,60,.45)" stroke="#ffd8d0" stroke-width="1.8"/><path d="M${tx - 5} ${ty + TH / 2 - 3} l10 6 M${tx + 5} ${ty + TH / 2 - 3} l-10 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  );
  // Items + props, back to front.
  const placed: [number, number, boolean][] = fence.length ? fence.map(([x, z]) => [x, z, x !== c] as [number, number, boolean]) : paved.size ? [] : [[c, c, false]];
  const url = itemIconUrl(itemId);
  for (const [x, z, ghost] of placed) {
    const [sx, sy] = iso(x, z);
    const cy = sy + TH / 2;
    const w = fence.length ? 40 : 54;
    // Cast shadow: long and soft toward the lower right (the afternoon sun of the farm), anchored to the tile.
    props.push([x + z + 0.5, `<ellipse cx="${sx + w * 0.12}" cy="${cy + 2}" rx="${w * 0.4}" ry="${w * 0.13}" fill="#14200a" opacity=".38" transform="rotate(8 ${sx} ${cy})"/><g class="${ghost ? '' : 'pv-item'}"><image href="${url}" x="${sx - w / 2}" y="${cy - w * 0.86}" width="${w}" height="${w}" opacity="${ghost || !S.ok ? 0.6 : 0.95}"/></g>`]);
  }
  props.sort((a, b) => a[0] - b[0]);
  for (const [, g] of props) out.push(g);
  // The target tile's pulsing outline is drawn over everything (an item or crop on it never hides the mark).
  if (!fence.length && !paved.size) out.push(`<path class="pv-pulse${S.ok ? '' : ' bad'}" d="${diamond(c, c, 0.5)}" fill="none" stroke="${S.ok ? '#f4ffe0' : '#ffe0d8'}" stroke-width="2.2" stroke-linejoin="round"/>`);
  // r5: cropped to the middle ~80 % (the diamond's far tips are low-information) so the plate fills its card.
  const W = N * TW;
  return `<svg class="grid iso${S.real ? ' real' : ''}" viewBox="${(W * 0.09).toFixed(1)} 12 ${(W * 0.82).toFixed(1)} ${Y0 + N * TH + DEPTH - 10}">${out.join('')}</svg>`;
}

/** Three "Uses" chips for the detail pane: [HUD glyph, headline, detail]. */
function facts(itemId: string): [string, string, string][] {
  const d = itemDef(itemId);
  if (SPRINKLERS[itemId]) {
    const n = sprinklerOffsets(itemId).length;
    const reach = Math.max(...sprinklerOffsets(itemId).map(([dx, dz]) => Math.max(Math.abs(dx), Math.abs(dz))));
    return [
      ['drop', `Waters ${n} tiles`, n <= 4 ? 'the four around it' : reach > 1 ? `a ${reach * 2 + 1}×${reach * 2 + 1} patch` : 'all eight around it'],
      ['clock', 'Every morning', 'before you wake'],
      ['sprout', 'Among crops', 'on any open tile'],
    ];
  }
  if (itemId === 'scarecrow') return [['crow', 'Radius 8', 'crows stay clear'], ['sprout', 'Mid-field', 'before seedlings sprout'], ['shield', 'Never wears', 'stands all year']];
  if (itemId === 'chest') return [['bag', '36 stacks', 'of anything at all'], ['grid', 'One tile', 'right-click to open'], ['basket', 'Harvest rush', 'overflow storage']];
  if (itemId === 'woodFence') return [['grid', 'Runs of 5', 'posts join up'], ['paw', 'Pens animals', 'paddocks & coops'], ['sprout', 'Garden edges', 'keeps paths tidy']];
  if (itemId === 'stonePath') return [['grid', '5 stones', 'one tile each'], ['shield', 'Blocks weeds', 'nothing grows through'], ['play', 'Tidy walks', 'between the beds']];
  if (itemId === 'hay') return [['paw', 'Feeds 1 animal', 'for a whole day'], ['basket', 'Into troughs', 'coop & barn'], ['sun', 'Keeps forever', 'stack up for winter']];
  if (itemId === 'coal') return [['flame', 'Smelting fuel', 'for the forge'], ['hammer', 'Odessa trades', 'bars & upgrades'], ['coin', `Sells ${d?.sell ?? 15}g`, 'at the bin']];
  return [
    ['star', d?.name ?? 'Crafted', 'handmade'],
    ['bag', 'Stacks', `up to ${d?.stack ?? 99}`],
    ['coin', `Sells ${d?.sell ?? 0}g`, 'at the bin'],
  ];
}

/** A short ingredient label for the card's missing-count line ("Copper Ore" → "copper"). */
function shortItem(id: string): string {
  const n = itemDef(id)?.name ?? id;
  return n.replace(/ (Ore|Bar)$/i, '').toLowerCase();
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
  // Reads the preview card itself (the Uses chips already say what the thing does).
  if (SPRINKLERS[itemId]) return 'Lit tiles get watered at dawn';
  if (itemId === 'scarecrow') return 'Lit ring = crow-free ground';
  if (itemId === 'woodFence') return 'Posts link up with their neighbours';
  if (itemId === 'stonePath') return 'Paves the tile it sits on';
  if (itemId === 'chest') return 'Toolbar → click a free tile to set it down';
  return 'Toolbar → click a free tile to place';
}
