/**
 * Shop ('shop' or 'shop:<npcId>'): shopkeeper portrait in a carved frame with a speech bubble, purse,
 * Buy / Sell tabs, goods grouped by shelf, quantity picker (− / + / ×5 / max) with a live total, and a
 * payment choreography on purchase (coins purse → keeper, goods → "In your pack"). Buying goes through the `economy` service + `item:give`; selling takes the
 * stack from the backpack via the `inventory` service.
 */
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { CROPS, CROP_IDS, daysToRipe } from '../data/crops';
import { NPCS, type NpcId } from '../data/npcs';
import { portraitSvg } from './portraits';
import { ICONS, itemIcon, itemCategory, qualityStar, QUALITY_NAME } from './icons';
import { Screen, el, frame, closeButton, tooltip, sfx, replay, rollTo, escapeHtml } from './kit';
import { itemTooltipHtml, unitPrice, type StackView } from './itemtip';
import { flyCoins, flyItemTo, centerOf, popBadge } from './item-fly';

interface Good {
  id: string;
  price: number;
  shelf: string;
  note: string;
  off?: string;
  /** Sell tab: backpack slots holding this item (id + quality merged into one row). */
  slots?: number[];
  have?: number;
  quality?: number;
}

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };

const LINES: Record<string, { hello: string[]; buy: string[]; sell: string[]; broke: string[] }> = {
  marigold: {
    hello: ['Fresh seed, straight off the morning cart. Pip checked every packet. Twice.', 'Mind the cat, dear. Pip thinks the seed sacks are his throne.', 'Rain tomorrow, my knee says. Good for the parsnips.'],
    buy: ['A fine choice! Water them in the morning, not at noon.', 'Wrapped and ready. Grow something lovely.', 'Your grandmother bought those every spring, you know.'],
    sell: ['Oh, these are lovely. I’ll put them right in the window.', 'Fair price for fair work.', 'The bakery will want these, mark my words.'],
    broke: ['A little short, dear. After market day?', 'Oh — not quite enough, dear.'],
  },
  odessa: {
    hello: ['Mind the sparks. What are we making today?', 'Good ore sings when you strike it. Listen.', 'Bring me copper and I’ll show you what a sprinkler can be.'],
    buy: ['Forged true. It’ll outlast us both.', 'Tempered this morning. Treat it kindly.', 'That’s honest steel.'],
    sell: ['Hm. Decent grain in this. I’ll take it.', 'The forge will put that to good use.', 'Not bad for a farmer.'],
    broke: ['Steel isn’t cheap. Heavier purse next time.', 'Short on coin. The forge can wait.'],
  },
  rowan: {
    hello: ['Measure twice, buy once. What do you need built?', 'Kit borrowed my good hammer again. Browse, I’ll be a minute.', 'Fresh-cut oak today. Smell that?'],
    buy: ['Built it myself. Every joint’s square.', 'Mind the splinters.', 'That’ll hold. Probably forever.'],
    sell: ['Good timber. I’ll find a use for it.', 'Straight grain — that’s the stuff.', 'Deal. Stack it by the door?'],
    broke: ['Bit short there. After the harvest?', 'Short on coin? It’ll keep.'],
  },
};

/** Per-keeper shelves beyond Marigold's seed store: [itemId, price, shelf, note]. */
const STOCK: Record<string, [string, number, string, string][]> = {
  odessa: [
    ['coal', 40, 'Forge stock', 'Burns hot and long'],
    ['copperOre', 30, 'Forge stock', 'From the upper Hollows'],
    ['ironOre', 60, 'Forge stock', 'Heavy and honest'],
    ['goldOre', 150, 'Forge stock', 'For the ambitious'],
    ['sprinkler', 150, 'Sprinklers', 'Waters 4 tiles each morning'],
    ['brassSprinkler', 450, 'Sprinklers', 'Waters all 8 tiles around it'],
    ['goldSprinkler', 1100, 'Sprinklers', 'A whole 5×5 patch'],
    ['sword', 350, 'Blades', 'For things that wobble in the dark'],
  ],
  rowan: [
    ['wood', 10, 'Timber & stone', 'Seasoned oak, split and stacked'],
    ['stone', 20, 'Timber & stone', 'Good for paths and sprinklers'],
    ['fiber', 5, 'Timber & stone', 'Twisted twine'],
    ['hay', 50, 'Timber & stone', 'Sweet dried grass for the troughs'],
    ['chest', 250, 'Built to order', 'Holds 36 stacks of anything'],
    ['scarecrow', 150, 'Built to order', 'Keeps crows off 8 tiles'],
    ['woodFence', 6, 'Built to order', 'By the post'],
    ['stonePath', 8, 'Built to order', 'Per paving stone'],
  ],
};

function shopName(id: string): string {
  if (id === 'marigold') return 'Thimble &amp; Pip’s';
  const n = NPCS[id as NpcId];
  if (!n) return 'Shop';
  const at = n.role.indexOf(' at ');
  return escapeHtml(at >= 0 ? n.role.slice(at + 4) : `${n.name.split(' ')[0]}’s Workshop`);
}

function portraitFor(id: string): string {
  const n = NPCS[id as NpcId];
  if (!n) return '';
  try {
    return portraitSvg(n.look, n.portraitBg, 'happy');
  } catch {
    return '';
  }
}

export class ShopScreen extends Screen {
  private keeper = 'marigold';
  private tab: 'buy' | 'sell' = 'buy';
  private goods: Good[] = [];
  private sel = 0;
  private qty = 1;
  private list!: HTMLElement;
  private bubble!: HTMLElement;
  private purse!: HTMLElement;
  private picker!: HTMLElement;
  private rail!: HTMLElement;
  private more!: HTMLElement;
  private portrait!: HTMLElement;
  private have!: HTMLElement;
  private moreBar!: HTMLElement;
  private typeT = 0;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-shop', { backdrop: true });
    // The purse mirrors the economy wherever gold changes (debug, shipping, quests…), with the HUD's roll.
    game.events.on('gold:change', ({ gold }) => {
      if (!this.isOpen || !this.purse) return;
      const v = this.purse.querySelector('.v') as HTMLElement | null;
      if (!v || v.dataset.v === String(gold)) return;
      rollTo(v, gold, 650);
      replay(this.purse, 'bump');
      if (this.tab === 'buy') this.buildPicker();
    });
    game.events.on('inventory:change', () => {
      if (this.isOpen && this.tab === 'sell' && !this.selling) this.build();
    });
  }
  private selling = false;
  private wasShort = false;

  private line(kind: 'hello' | 'buy' | 'sell' | 'broke'): void {
    const set = (LINES[this.keeper] ?? LINES.marigold!)[kind];
    const text = set[Math.floor(Math.random() * set.length)]!;
    const node = this.bubble.querySelector('p')!;
    node.textContent = '';
    clearInterval(this.typeT);
    let i = 0;
    this.typeT = window.setInterval(() => {
      i += 2;
      node.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(this.typeT);
    }, 22);
    replay(this.portrait, kind === 'broke' ? 'sad' : 'nod');
  }

  protected render(arg?: string): void {
    this.keeper = arg && NPCS[arg as NpcId] ? arg : 'marigold';
    this.tab = 'buy';
    this.qty = 1;
    this.sel = 0;
    this.wasShort = false;
    this.root.querySelector('.u-pop')?.remove();
    const npc = NPCS[this.keeper as NpcId];
    const wrap = el('div', 'shop-wrap u-pop');
    const { frame: f, body } = frame(shopName(this.keeper), 'shop-frame');
    f.appendChild(closeButton(() => this.requestClose()));

    const left = el('div', 'shop-keeper');
    this.portrait = el('div', 'shop-portrait', portraitFor(this.keeper));
    const plate = el('div', 'shop-name', `<b>${escapeHtml(npc?.name.split(' ')[0] ?? 'Shopkeeper')}</b><small>${escapeHtml(npc?.role ?? '')}</small>`);
    this.bubble = el('div', 'shop-bubble', '<p></p>');
    this.purse = el('div', 'shop-purse', `${ICONS.coin}<span class="v"></span><small>your purse</small>`);
    // "In your pack": the selected good's count + free slots — where bought goods land (they fly in here).
    this.have = el('div', 'shop-have');
    left.append(this.portrait, plate, this.bubble, this.have, this.purse);

    const right = el('div', 'shop-right');
    const tabs = el('div', 'shop-tabs');
    for (const t of ['buy', 'sell'] as const) {
      const b = el('button', `shop-tab${t === this.tab ? ' on' : ''}`, t === 'buy' ? `${ICONS.bag}<span>Buy</span>` : `${ICONS.coin}<span>Sell</span>`);
      b.dataset.nav = '';
      b.dataset.tab = t;
      b.addEventListener('click', () => this.setTab(t));
      tabs.appendChild(b);
    }
    this.list = el('div', 'shop-list');
    // Wood scroll rail + "more below" chevron: the list scrolls under a soft bottom fade, the rail shows where
    // you are (native scrollbars are hidden on many setups), and the chevron lives in its own gutter under the
    // list, so it never sits on a row.
    const lw = el('div', 'shop-listwrap');
    this.rail = el('div', 'shop-rail', '<i></i>');
    this.more = el('button', 'shop-more', `<svg viewBox="0 0 20 12" width="18" height="11"><path d="M3 3 L10 9 L17 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>more</span>`);
    this.more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.list.scrollBy({ top: 150, behavior: 'smooth' });
    });
    this.rail.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = this.rail.getBoundingClientRect();
      const k = (e.clientY - r.top) / Math.max(1, r.height);
      this.list.scrollTo({ top: k * (this.list.scrollHeight - this.list.clientHeight), behavior: 'smooth' });
    });
    this.list.addEventListener('scroll', () => this.syncRail(), { passive: true });
    lw.append(this.list, this.rail);
    this.moreBar = el('div', 'shop-morebar');
    this.moreBar.appendChild(this.more);
    this.picker = el('div', 'shop-picker');
    right.append(tabs, lw, this.moreBar, this.picker);
    body.append(left, right);
    wrap.appendChild(f);
    this.root.appendChild(wrap);
    const pv = this.purse.querySelector('.v') as HTMLElement;
    pv.dataset.v = String(this.game.services.economy?.gold() ?? 0);
    pv.textContent = (this.game.services.economy?.gold() ?? 0).toLocaleString();
    this.line('hello');
    this.build();
  }

  private setTab(t: 'buy' | 'sell'): void {
    if (t === this.tab) return;
    this.tab = t;
    this.sel = 0;
    this.qty = 1;
    sfx(this.game, 'tab');
    this.root.querySelectorAll<HTMLElement>('.shop-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    this.build();
  }

  private stock(): Good[] {
    const own = STOCK[this.keeper];
    if (own) return own.filter(([id]) => itemDef(id)).map(([id, price, shelf, note]) => ({ id, price, shelf, note }));
    const season = this.game.calendar.season;
    const out: Good[] = [];
    const ids = [...CROP_IDS].sort((a, b) => Number(!CROPS[a].seasons.includes(season)) - Number(!CROPS[b].seasons.includes(season)));
    for (const id of ids) {
      const c = CROPS[id];
      if (!itemDef(c.seeds)) continue;
      const inSeason = c.seasons.includes(season);
      out.push({
        id: c.seeds,
        price: c.seedPrice,
        shelf: inSeason ? `${SEASON_NAME[season]} seeds` : 'Out of season',
        note: `${daysToRipe(c)} days · sells ${c.sell}g${c.regrow ? ' · regrows' : ''}`,
        off: inSeason ? undefined : c.seasons.map((s) => SEASON_NAME[s]).join(' / '),
      });
    }
    const supplies: [string, number, string][] = [
      ['wood', 10, 'Seasoned oak, split and stacked'],
      ['stone', 20, 'Good for paths and sprinklers'],
      ['fiber', 5, 'Twisted twine for scarecrows'],
    ];
    for (const [id, price, note] of supplies) if (itemDef(id)) out.splice(out.findIndex((g) => g.off) < 0 ? out.length : out.findIndex((g) => g.off), 0, { id, price, shelf: 'Supplies', note });
    return out;
  }

  /** Sell rows: one per item id + quality (stacks merged), produce first, then by value. */
  private sellables(): Good[] {
    const inv = this.game.services.inventory;
    const rows = new Map<string, Good>();
    inv?.slots.forEach((s, i) => {
      if (!s) return;
      const d = itemDef(s.id);
      if (!d || d.kind === 'tool' || d.sell <= 0) return;
      const sv = s as StackView;
      const key = `${s.id}|${sv.quality ?? 0}`;
      const row = rows.get(key);
      if (row) {
        row.have = (row.have ?? 0) + s.qty;
        row.slots!.push(i);
        row.note = `You have ${row.have}`;
        return;
      }
      rows.set(key, { id: s.id, price: unitPrice(sv), shelf: itemCategory(s.id).label, note: `You have ${s.qty}`, slots: [i], have: s.qty, quality: sv.quality });
    });
    const order = ['Vegetable', 'Fruit', 'Flower', 'Artisan Good', 'Fish', 'Forage', 'Cooking', 'Mineral', 'Resource', 'Crafted', 'Seed'];
    const rank = (g: Good): number => {
      const k = order.indexOf(g.shelf);
      return k < 0 ? order.length : k;
    };
    return [...rows.values()].sort((a, b) => rank(a) - rank(b) || b.price - a.price || a.id.localeCompare(b.id));
  }

  private build(): void {
    this.goods = this.tab === 'buy' ? this.stock() : this.sellables();
    this.sel = Math.min(this.sel, Math.max(0, this.goods.length - 1));
    this.list.innerHTML = '';
    if (!this.goods.length) {
      this.list.innerHTML = `<div class="shop-empty">${this.tab === 'sell' ? 'Nothing in your pack I can buy, dear.' : 'Sold out!'}</div>`;
    }
    let shelf = '';
    const gold = this.game.services.economy?.gold() ?? 0;
    this.goods.forEach((g, i) => {
      if (g.shelf !== shelf) {
        shelf = g.shelf;
        this.list.appendChild(el('div', 'shop-shelf', `<span>${escapeHtml(shelf)}</span>`));
      }
      const d = itemDef(g.id);
      const row = el(
        'div',
        `shop-row${g.off ? ' off' : ''}${i === this.sel ? ' on' : ''}${this.tab === 'buy' && g.price > gold ? ' cant' : ''}`,
        `<div class="u-slot mini">${itemIcon(g.id)}${g.quality ? qualityStar(g.quality) : ''}</div>
         <div class="nm"><b>${escapeHtml(d?.name ?? g.id)}${g.quality ? ` <em class="q${g.quality}">${QUALITY_NAME[g.quality] ?? ''}</em>` : ''}</b><small>${g.off ? `${g.off} only` : escapeHtml(g.note)}</small></div>
         <div class="pr">${ICONS.coin}<span>${g.price.toLocaleString()}</span></div>`,
      );
      row.dataset.nav = '';
      row.style.animationDelay = `${Math.min(i, 12) * 22}ms`;
      row.addEventListener('click', () => this.pick(i));
      row.addEventListener('dblclick', () => this.commit());
      // Mouse hover: the item card docks beside the shop frame (never over the list, the picker or the Buy
      // button). Keyboard / gamepad focus *selects* the row instead — the purchase bar already shows the item,
      // so Buy always buys what the focus ring is on.
      row.addEventListener('pointerenter', () => tooltip.anchor(itemTooltipHtml({ id: g.id, qty: 1, quality: g.quality }, { price: g.price, priceLabel: this.tab === 'buy' ? 'each' : 'we pay' }), row, this.root.querySelector('.shop-frame') ?? row));
      row.addEventListener('pointerleave', () => tooltip.hide());
      row.addEventListener('u-focus', () => {
        tooltip.hide();
        this.pick(i);
      });
      this.list.appendChild(row);
    });
    this.buildPicker();
    this.nav.attach(this.root, this.list.querySelector<HTMLElement>('.shop-row.on'));
    this.list.scrollTop = 0;
    requestAnimationFrame(() => this.syncRail());
  }

  private syncRail(): void {
    const l = this.list;
    const over = l.scrollHeight - l.clientHeight;
    const scrolls = over > 4;
    this.rail.classList.toggle('hv-hidden', !scrolls);
    const atEnd = !scrolls || l.scrollTop >= over - 6;
    this.more.classList.toggle('gone', atEnd);
    this.moreBar.classList.toggle('end', scrolls && atEnd);
    if (scrolls && !atEnd) {
      // How many rows are still (even partly) hidden below the fold.
      const bottom = l.getBoundingClientRect().bottom - 20;
      const below = [...l.querySelectorAll('.shop-row')].filter((r) => r.getBoundingClientRect().bottom > bottom).length;
      const sp = this.more.querySelector('span');
      if (sp) sp.textContent = below ? `${below} more` : 'more';
    }
    if (!scrolls) return;
    const rh = this.rail.clientHeight;
    const th = Math.max(34, (l.clientHeight / l.scrollHeight) * rh);
    const thumb = this.rail.firstElementChild as HTMLElement;
    thumb.style.height = `${th}px`;
    thumb.style.transform = `translateY(${(l.scrollTop / over) * (rh - th)}px)`;
  }

  private pick(i: number): void {
    if (this.sel !== i) {
      this.sel = i;
      this.qty = 1;
      sfx(this.game, 'click');
    }
    this.list.querySelectorAll('.shop-row').forEach((r, k) => r.classList.toggle('on', k === i));
    this.buildPicker();
  }

  /** Buy tab: can't afford even one of the selected good. */
  private short(): boolean {
    const g = this.goods[this.sel];
    return this.tab === 'buy' && !!g && !g.off && g.price > (this.game.services.economy?.gold() ?? 0);
  }

  /** Left-column "In your pack" card for the selected good. */
  private buildHave(): void {
    const g = this.goods[this.sel];
    const inv = this.game.services.inventory;
    const free = inv ? inv.slots.filter((s) => !s).length : 0;
    const size = inv?.slots.length ?? 30;
    const n = g ? (inv?.count(g.id) ?? 0) : 0;
    const after = g && this.tab === 'buy' ? n + this.qty : g && this.tab === 'sell' ? Math.max(0, n - this.qty) : n;
    const no = this.short() || !!g?.off;
    this.have.innerHTML = g
      ? `<div class="u-slot mini">${itemIcon(g.id)}</div><div class="hv"><small>In your pack</small><b><span class="n">${n.toLocaleString()}</span>${after !== n ? `<em class="to${no ? ' no' : ''}">→ ${after.toLocaleString()}</em>` : ''}</b></div><div class="fr"><small>Free slots</small><i class="meter"><i style="width:${Math.round((free / Math.max(1, size)) * 100)}%"></i></i><b>${free}<em>/${size}</em></b></div>`
      : '';
  }

  private maxQty(g: Good): number {
    if (this.tab === 'sell') return g.have ?? 1;
    const gold = this.game.services.economy?.gold() ?? 0;
    return Math.max(1, Math.min(999, Math.floor(gold / Math.max(1, g.price))));
  }

  private buildPicker(): void {
    const g = this.goods[this.sel];
    if (!g) {
      this.picker.innerHTML = '';
      this.buildHave();
      return;
    }
    const d = itemDef(g.id);
    this.qty = Math.max(1, Math.min(this.qty, this.maxQty(g)));
    this.buildHave();
    const total = g.price * this.qty;
    const gold = this.game.services.economy?.gold() ?? 0;
    const can = this.tab === 'sell' || (!g.off && total <= gold);
    // Selecting something you can't afford: the keeper says so (once per change), instead of a stale "fair price".
    const short = this.short();
    if (short && !this.wasShort) this.line('broke');
    this.wasShort = short;
    // Keep keyboard / pad focus on the Buy button across re-renders (A, A, A buys again and again).
    const goHadFocus = !!this.nav.current?.classList.contains('pk-go');
    this.picker.innerHTML = `
      <div class="pk-item"><div class="u-slot">${itemIcon(g.id)}</div><div><b title="${escapeHtml(d?.name ?? g.id)}">${escapeHtml(d?.name ?? g.id)}</b><small>${g.price}g each</small></div></div>
      <div class="pk-qty">
        <button class="u-btn small" data-q="-1" data-nav>−</button>
        <div class="pk-n"><span>${this.qty}</span><small>qty</small></div>
        <button class="u-btn small" data-q="1" data-nav>+</button>
        <button class="u-btn small" data-q="5" data-nav>×5</button>
        <button class="u-btn small" data-q="max" data-nav>Max</button>
      </div>
      <div class="pk-total">${ICONS.coin}<span>${total.toLocaleString()}</span></div>
      <button class="u-btn ${this.tab === 'buy' ? 'green' : 'blue'} pk-go${can ? '' : ' disabled'}" data-nav>${this.tab === 'buy' ? `${ICONS.bag} Buy` : `${ICONS.coin} Sell`}</button>`;
    this.picker.querySelectorAll<HTMLElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        const q = b.dataset.q!;
        const max = this.maxQty(g);
        this.qty = q === 'max' ? max : Math.max(1, Math.min(max, q === '5' ? (this.qty === 1 ? 5 : this.qty + 5) : this.qty + Number(q)));
        sfx(this.game, 'tick');
        const focus = q;
        // ←→ on a goods row press these too: the focus stays on the row then.
        const had = this.nav.current === b;
        this.buildPicker();
        const again = this.picker.querySelector<HTMLElement>(`[data-q="${focus}"]`);
        if (again && had) this.nav.set(again, document.body.classList.contains('u-kbd'));
        replay(this.picker.querySelector('.pk-n span'), 'bump');
      }),
    );
    const goBtn = this.picker.querySelector<HTMLElement>('.pk-go')!;
    goBtn.addEventListener('click', () => this.commit());
    if (goHadFocus) this.nav.set(goBtn, false);
  }

  private commit(): void {
    const g = this.goods[this.sel];
    const eco = this.game.services.economy;
    const go = this.picker.querySelector('.pk-go') as HTMLElement | null;
    if (!g || !eco) return;
    if (this.tab === 'buy') {
      if (g.off) {
        replay(go, 'shake');
        sfx(this.game, 'error');
        return;
      }
      const total = g.price * this.qty;
      if (!eco.spend(total, 'shop')) {
        replay(go, 'shake');
        sfx(this.game, 'error');
        this.line('broke');
        return;
      }
      const from = centerOf(this.picker.querySelector('.pk-item .u-slot'));
      this.game.events.emit('item:give', { itemId: g.id, qty: this.qty });
      sfx(this.game, 'buy');
      this.payoff(g.id, this.qty, from, false);
      this.line('buy');
    } else {
      const inv = this.game.services.inventory;
      if (!inv || !g.slots?.length) return;
      let left = this.qty;
      let sold = 0;
      this.selling = true;
      for (const slot of g.slots) {
        if (left <= 0) break;
        const got = inv.takeFromSlot(slot, left);
        if (got) {
          sold += got.qty;
          left -= got.qty;
        }
      }
      this.selling = false;
      if (!sold) return;
      const from = centerOf(this.picker.querySelector('.pk-item .u-slot'));
      eco.add(g.price * sold, 'shop-sell');
      sfx(this.game, 'sell');
      this.payoff(g.id, sold, from, true);
      this.line('sell');
      this.qty = 1;
      this.build();
    }
    // The purse rolls via the gold:change subscription (same path as gold changed anywhere else).
    if (this.tab === 'buy') this.buildPicker();
  }

  /**
   * Purchase choreography. Buy: coins leave the purse for the shopkeeper (the payment) while the goods
   * arc from the picker into the "In your pack" card with a "+N". Sell: the goods go to the shopkeeper and
   * the coins come back into the purse. The shopkeeper gives a little bounce either way.
   */
  private payoff(itemId: string, qty: number, from: { x: number; y: number } | null, sell: boolean): void {
    const purse = centerOf(this.purse.querySelector('svg') ?? this.purse);
    const keeper = centerOf(this.portrait);
    if (!purse || !keeper) return;
    const face = { x: keeper.x, y: keeper.y + 30 };
    const price = this.goods[this.sel]?.price ?? 0;
    const n = Math.min(7, 3 + Math.ceil(Math.log10(Math.max(10, qty * price))));
    const bounce = (): void => {
      this.portrait.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05) translateY(-3px)' }, { transform: 'scale(.99)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    };
    if (!sell) {
      flyCoins(ICONS.coin!, purse, face, n, bounce, this.aroundBubble(purse, face));
      if (from) {
        // Resolve the landing slot at launch (the card re-renders on every inventory change).
        const slotEl = (): HTMLElement => this.have.querySelector<HTMLElement>('.u-slot') ?? this.have;
        window.setTimeout(() => {
          if (!this.isOpen) return;
          flyItemTo(itemId, from, slotEl(), 0, () => {
            if (!this.isOpen) return;
            popBadge(slotEl(), `+${qty}`, 'good');
            this.buildHave();
            replay(this.have, 'got');
          }, 48, { duration: 560 });
        }, 120);
      }
    } else {
      if (from) flyItemTo(itemId, from, this.portrait, 0, bounce, 48, { duration: 520, bounce: 1.04 });
      const back = this.aroundBubble(face, purse);
      window.setTimeout(() => this.isOpen && flyCoins(ICONS.coin!, face, purse, n, () => popBadge(this.purse, `+${(qty * price).toLocaleString()}g`, 'gold'), back), 260);
    }
  }

  /** Cubic handles that carry the coins out past the keeper column's left edge, around the speech bubble. */
  private aroundBubble(a: { x: number; y: number }, b: { x: number; y: number }): [{ x: number; y: number }, { x: number; y: number }] | undefined {
    const col = this.root.querySelector('.shop-keeper')?.getBoundingClientRect();
    if (!col || !col.width) return undefined;
    const x = col.left - 84;
    return [
      { x, y: a.y + (a.y > b.y ? 10 : 40) },
      { x, y: b.y + (a.y > b.y ? 40 : 10) },
    ];
  }

  protected override initialFocus(): HTMLElement | null {
    return this.list?.querySelectorAll<HTMLElement>('.shop-row')[this.sel] ?? null;
  }

  /**
   * Keyboard / gamepad flow: ↑↓ walk the goods (focus = selection, so the purchase bar always shows what Buy will
   * buy), ←→ on a row change the quantity, Enter / A on a row hops to the Buy button (A again buys), ↑ from the
   * purchase bar returns to the selected row. Past the first row ↑ reaches the Buy / Sell tabs.
   */
  private navKey(code: string): boolean {
    const nav = this.nav;
    const rows = [...this.list.querySelectorAll<HTMLElement>('.shop-row')];
    if (!rows.length) return false;
    const cur = nav.current;
    const at = cur ? rows.indexOf(cur) : -1;
    const up = code === 'ArrowUp' || code === 'KeyW';
    const down = code === 'ArrowDown' || code === 'KeyS';
    const left = code === 'ArrowLeft' || code === 'KeyA';
    const right = code === 'ArrowRight' || code === 'KeyD';
    const go = this.picker.querySelector<HTMLElement>('.pk-go');
    if (at < 0) {
      // Focus on the purchase bar: ↑ goes back to the list. Nothing focused yet: land on the selected row.
      if (!cur || !nav.items().includes(cur)) {
        if (up || down) {
          nav.set(rows[this.sel] ?? rows[0]!);
          return true;
        }
        return false;
      }
      if (up && this.picker.contains(cur)) {
        nav.set(rows[this.sel] ?? rows[0]!);
        return true;
      }
      if (down && cur.closest('.shop-tabs, .shop-tab')) {
        nav.set(rows[this.sel] ?? rows[0]!);
        return true;
      }
      return false;
    }
    if (up || down) {
      const next = at + (down ? 1 : -1);
      if (next >= rows.length) {
        if (go) nav.set(go);
      } else if (next < 0) {
        const tab = this.root.querySelector<HTMLElement>('.shop-tab.on') ?? this.root.querySelector<HTMLElement>('.shop-tab');
        if (tab) nav.set(tab);
      } else nav.set(rows[next]!);
      sfx(this.game, 'hover');
      return true;
    }
    if (left || right) {
      this.picker.querySelector<HTMLElement>(`[data-q="${left ? '-1' : '1'}"]`)?.click();
      return true;
    }
    if ((code === 'Enter' || code === 'Space') && go) {
      nav.set(go);
      return true;
    }
    return false;
  }

  override key(code: string): boolean {
    if (this.navKey(code)) return true;
    if (code === 'Minus' || code === 'Equal') {
      const b = this.picker.querySelector<HTMLElement>(`[data-q="${code === 'Minus' ? '-1' : '1'}"]`);
      b?.click();
      return true;
    }
    if (code === 'KeyQ' || code === 'BracketLeft' || code === 'BracketRight') {
      this.setTab(this.tab === 'buy' ? 'sell' : 'buy');
      return true;
    }
    return false;
  }

  protected override onClose(): void {
    clearInterval(this.typeT);
  }
}
