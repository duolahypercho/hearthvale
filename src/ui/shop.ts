/**
 * Shop ('shop' or 'shop:<npcId>'): shopkeeper portrait in a carved frame with a speech bubble, purse,
 * Buy / Sell tabs, goods grouped by shelf, quantity picker (− / + / ×5 / max) with a live total, and a
 * coin-burst on purchase. Buying goes through the `economy` service + `item:give`; selling takes the
 * stack from the backpack via the `inventory` service.
 */
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { CROPS, CROP_IDS, daysToRipe } from '../data/crops';
import { NPCS, type NpcId } from '../data/npcs';
import { portraitSvg } from './portraits';
import { ICONS, itemIcon, itemCategory } from './icons';
import { Screen, el, frame, closeButton, tooltip, sfx, replay, rollTo, escapeHtml } from './kit';
import { itemTooltipHtml, unitPrice, type StackView } from './itemtip';

interface Good {
  id: string;
  price: number;
  shelf: string;
  note: string;
  off?: string;
  /** Sell tab: backpack slot. */
  slot?: number;
  have?: number;
  quality?: number;
}

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };

const LINES: Record<string, { hello: string[]; buy: string[]; sell: string[]; broke: string[] }> = {
  marigold: {
    hello: ['Fresh seed, straight off the morning cart. Pip checked every packet. Twice.', 'Mind the cat, dear. Pip thinks the seed sacks are his throne.', 'Rain tomorrow, my knee says. Good for the parsnips.'],
    buy: ['A fine choice! Water them in the morning, not at noon.', 'Wrapped and ready. Grow something lovely.', 'Your grandmother bought those every spring, you know.'],
    sell: ['Oh, these are lovely. I’ll put them right in the window.', 'Fair price for fair work.', 'The bakery will want these, mark my words.'],
    broke: ['Ah — a little short, dear. Come back after market day.'],
  },
  odessa: {
    hello: ['Mind the sparks. What are we making today?', 'Good ore sings when you strike it. Listen.', 'Bring me copper and I’ll show you what a sprinkler can be.'],
    buy: ['Forged true. It’ll outlast us both.', 'Tempered this morning. Treat it kindly.', 'That’s honest steel.'],
    sell: ['Hm. Decent grain in this. I’ll take it.', 'The forge will put that to good use.', 'Not bad for a farmer.'],
    broke: ['Steel isn’t cheap. Come back with a heavier purse.'],
  },
  rowan: {
    hello: ['Measure twice, buy once. What do you need built?', 'Kit borrowed my good hammer again. Browse, I’ll be a minute.', 'Fresh-cut oak today. Smell that?'],
    buy: ['Built it myself. Every joint’s square.', 'Mind the splinters.', 'That’ll hold. Probably forever.'],
    sell: ['Good timber. I’ll find a use for it.', 'Straight grain — that’s the stuff.', 'Deal. Stack it by the door?'],
    broke: ['Tell you what — come back when the harvest’s in.'],
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
  private portrait!: HTMLElement;
  private typeT = 0;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-shop', { backdrop: true });
  }

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
    left.append(this.portrait, plate, this.bubble, this.purse);

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
    this.picker = el('div', 'shop-picker');
    right.append(tabs, this.list, this.picker);
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

  private sellables(): Good[] {
    const inv = this.game.services.inventory;
    const out: Good[] = [];
    inv?.slots.forEach((s, i) => {
      if (!s) return;
      const d = itemDef(s.id);
      if (!d || d.kind === 'tool' || d.sell <= 0) return;
      const sv = s as StackView;
      out.push({ id: s.id, price: unitPrice(sv), shelf: itemCategory(s.id).label, note: `You have ${s.qty}`, slot: i, have: s.qty, quality: sv.quality });
    });
    return out;
  }

  private build(): void {
    this.goods = this.tab === 'buy' ? this.stock() : this.sellables();
    this.sel = Math.min(this.sel, Math.max(0, this.goods.length - 1));
    this.list.innerHTML = '';
    if (!this.goods.length) {
      this.list.innerHTML = `<div class="shop-empty">${this.tab === 'sell' ? 'Nothing in your pack I can buy, dear.' : 'Sold out!'}</div>`;
    }
    let shelf = '';
    this.goods.forEach((g, i) => {
      if (g.shelf !== shelf) {
        shelf = g.shelf;
        this.list.appendChild(el('div', 'shop-shelf', `<span>${escapeHtml(shelf)}</span>`));
      }
      const d = itemDef(g.id);
      const row = el(
        'div',
        `shop-row${g.off ? ' off' : ''}${i === this.sel ? ' on' : ''}`,
        `<div class="u-slot mini">${itemIcon(g.id)}${g.quality ? '' : ''}</div>
         <div class="nm"><b>${escapeHtml(d?.name ?? g.id)}</b><small>${g.off ? `${g.off} only` : escapeHtml(g.note)}</small></div>
         <div class="pr">${ICONS.coin}<span>${g.price.toLocaleString()}</span></div>`,
      );
      row.dataset.nav = '';
      row.style.animationDelay = `${Math.min(i, 12) * 22}ms`;
      row.addEventListener('click', () => this.pick(i));
      row.addEventListener('dblclick', () => this.commit());
      row.addEventListener('pointerenter', () => tooltip.show(itemTooltipHtml({ id: g.id, qty: 1, quality: g.quality }, { price: g.price, priceLabel: this.tab === 'buy' ? 'each' : 'we pay' })));
      row.addEventListener('pointerleave', () => tooltip.hide());
      this.list.appendChild(row);
    });
    this.buildPicker();
    this.nav.attach(this.root, this.list.querySelector<HTMLElement>('.shop-row.on'));
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

  private maxQty(g: Good): number {
    if (this.tab === 'sell') return g.have ?? 1;
    const gold = this.game.services.economy?.gold() ?? 0;
    return Math.max(1, Math.min(999, Math.floor(gold / Math.max(1, g.price))));
  }

  private buildPicker(): void {
    const g = this.goods[this.sel];
    if (!g) {
      this.picker.innerHTML = '';
      return;
    }
    const d = itemDef(g.id);
    this.qty = Math.max(1, Math.min(this.qty, this.maxQty(g)));
    const total = g.price * this.qty;
    const gold = this.game.services.economy?.gold() ?? 0;
    const can = this.tab === 'sell' || (!g.off && total <= gold);
    this.picker.innerHTML = `
      <div class="pk-item"><div class="u-slot">${itemIcon(g.id)}</div><div><b>${escapeHtml(d?.name ?? g.id)}</b><small>${g.price}g each</small></div></div>
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
        this.buildPicker();
        const again = this.picker.querySelector<HTMLElement>(`[data-q="${focus}"]`);
        if (again) this.nav.set(again, document.body.classList.contains('u-kbd'));
        replay(this.picker.querySelector('.pk-n span'), 'bump');
      }),
    );
    this.picker.querySelector('.pk-go')!.addEventListener('click', () => this.commit());
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
      this.game.events.emit('item:give', { itemId: g.id, qty: this.qty });
      sfx(this.game, 'buy');
      this.burst(go, false);
      this.line('buy');
    } else {
      const inv = this.game.services.inventory;
      if (!inv || g.slot === undefined) return;
      const got = inv.takeFromSlot(g.slot, this.qty);
      if (!got) return;
      eco.add(g.price * got.qty, 'shop-sell');
      sfx(this.game, 'sell');
      this.burst(go, true);
      this.line('sell');
      this.qty = 1;
      this.build();
    }
    rollTo(this.purse.querySelector('.v') as HTMLElement, eco.gold(), 650);
    replay(this.purse, 'bump');
    if (this.tab === 'buy') this.buildPicker();
  }

  /** Coins arc from the button into the purse (buy) or the other way (sell). */
  private burst(from: HTMLElement | null, toPurse: boolean): void {
    if (!from) return;
    const a = from.getBoundingClientRect();
    const b = this.purse.getBoundingClientRect();
    const [sx, sy, ex, ey] = toPurse ? [a.left + a.width / 2, a.top, b.left + 24, b.top + b.height / 2] : [b.left + 24, b.top + b.height / 2, a.left + a.width / 2, a.top];
    for (let i = 0; i < 7; i++) {
      const c = el('div', 'u-coinfly', ICONS.coin);
      c.style.left = `${sx}px`;
      c.style.top = `${sy}px`;
      c.style.setProperty('--dx', `${ex - sx + (Math.random() - 0.5) * 30}px`);
      c.style.setProperty('--dy', `${ey - sy}px`);
      c.style.setProperty('--arc', `${-60 - Math.random() * 60}px`);
      c.style.animationDelay = `${i * 45}ms`;
      document.getElementById('ui-root')?.appendChild(c);
      setTimeout(() => c.remove(), 900 + i * 45);
    }
  }

  override key(code: string): boolean {
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
