/**
 * Carpenter's board ('carpenter'; interact with the little roofed notice board by the farm path):
 * a pinned-blueprint order sheet in the house UI style.
 *
 *   Buildings  coop / barn blueprints (painted SVG elevation), cost in gold + wood + stone with
 *              have / need colouring, status stamp (Order · Under construction · Built). Ordering
 *              raises a staked construction site; the building stands the next morning.
 *   Animals    one card per species (portrait, price, home, produce, occupancy x / 6) → Buy.
 *   Supplies   hay by the bale (×1 / ×10) for the feed troughs.
 */
import type { Game } from '../../core/game';
import { Screen, el, frame, closeButton, sfx, replay, escapeHtml } from '../../ui/kit';
import { ICONS, itemIcon } from '../../ui/icons';
import { LIVESTOCK, LIVESTOCK_ORDER, type Livestock } from '../../entities/animals-data';
import { registerAnimalIcons } from './icons';
import type { BuildingKind } from './farm';

const HAY_PRICE = 45;

type Tab = 'build' | 'animals' | 'supplies';

/** Painted blueprint elevations (80×56). */
const BLUEPRINT: Record<BuildingKind, string> = {
  coop: `<svg viewBox="0 0 80 56"><rect x="8" y="46" width="64" height="5" rx="2" fill="#9a8c7a"/>
    <rect x="14" y="24" width="52" height="23" fill="#c0503c" stroke="#5a2418" stroke-width="2"/>
    <path d="M8 26 L40 8 L72 26 Z" fill="#4f6a60" stroke="#26342e" stroke-width="2" stroke-linejoin="round"/>
    <rect x="34" y="30" width="12" height="17" fill="#f3ecdc" stroke="#5a2418" stroke-width="1.6"/>
    <path d="M34 30 L46 47 M46 30 L34 47" stroke="#c0503c" stroke-width="1.6"/>
    <rect x="19" y="30" width="9" height="8" fill="#ffe7a8" stroke="#f3ecdc" stroke-width="2"/>
    <rect x="52" y="39" width="7" height="6" rx="3" fill="#3a2418"/>
    <path d="M40 8 V2 M37 3 H43" stroke="#2e2a28" stroke-width="1.4"/></svg>`,
  barn: `<svg viewBox="0 0 80 56"><rect x="4" y="47" width="72" height="5" rx="2" fill="#9a8c7a"/>
    <path d="M10 48 V24 L18 12 L40 5 L62 12 L70 24 V48 Z" fill="#b8402e" stroke="#4a1a10" stroke-width="2" stroke-linejoin="round"/>
    <path d="M6 25 L18 11 L40 3 L62 11 L74 25" fill="none" stroke="#3a3a44" stroke-width="4" stroke-linejoin="round"/>
    <rect x="28" y="28" width="24" height="20" fill="#f3ecdc" stroke="#4a1a10" stroke-width="1.6"/>
    <path d="M28 28 L40 48 L52 28 M28 48 L40 28 L52 48" stroke="#b8402e" stroke-width="1.6" fill="none"/>
    <rect x="35" y="12" width="10" height="9" fill="#f3ecdc" stroke="#4a1a10" stroke-width="1.4"/>
    <path d="M35 12 L45 21 M45 12 L35 21" stroke="#b8402e" stroke-width="1.2"/></svg>`,
};

/** Little portrait medallions per species (64×64). */
const FACE: Record<Livestock, string> = {
  chicken: `<ellipse cx="32" cy="38" rx="18" ry="17" fill="#faf5ea" stroke="#7a5a3a" stroke-width="2.4"/><path d="M26 20 q3 -8 6 0 q3 -8 6 0" fill="#e8342c" stroke="#8a1a14" stroke-width="1.6"/><path d="M28 38 l4 5 l4 -5 z" fill="#f2b43a" stroke="#8a5a1a" stroke-width="1.4"/><circle cx="25" cy="33" r="2.8" fill="#1a1412"/><circle cx="39" cy="33" r="2.8" fill="#1a1412"/><ellipse cx="32" cy="47" rx="3" ry="4" fill="#e8342c"/><circle cx="21" cy="40" r="3" fill="#ff9a9a" opacity=".7"/><circle cx="43" cy="40" r="3" fill="#ff9a9a" opacity=".7"/>`,
  duck: `<ellipse cx="32" cy="36" rx="17" ry="17" fill="#2f7a4c" stroke="#123a24" stroke-width="2.4"/><ellipse cx="32" cy="45" rx="11" ry="5" fill="#e8c040" stroke="#8a6a1a" stroke-width="1.6"/><circle cx="25" cy="32" r="2.8" fill="#1a1412"/><circle cx="39" cy="32" r="2.8" fill="#1a1412"/><path d="M18 52 q14 6 28 0" stroke="#fff" stroke-width="3" fill="none"/>`,
  cow: `<ellipse cx="32" cy="34" rx="20" ry="17" fill="#f7f3ea" stroke="#3a2c26" stroke-width="2.4"/><path d="M36 18 q12 2 14 12 q-8 2 -14 -4 z" fill="#2c2826"/><ellipse cx="32" cy="44" rx="13" ry="8" fill="#f4bcae" stroke="#8a4a44" stroke-width="1.6"/><circle cx="27" cy="44" r="1.8" fill="#6a3a34"/><circle cx="37" cy="44" r="1.8" fill="#6a3a34"/><circle cx="24" cy="31" r="3" fill="#1a1412"/><circle cx="40" cy="31" r="3" fill="#1a1412"/><path d="M14 22 l-6 -6 M50 22 l6 -6" stroke="#f2e6c8" stroke-width="4" stroke-linecap="round"/>`,
  goat: `<ellipse cx="32" cy="32" rx="15" ry="17" fill="#7a4e30" stroke="#2e2420" stroke-width="2.4"/><ellipse cx="32" cy="42" rx="9" ry="7" fill="#8e6040"/><path d="M28 50 l4 9 l4 -9" fill="#2e2420"/><circle cx="26" cy="30" r="2.6" fill="#1a1412"/><circle cx="38" cy="30" r="2.6" fill="#1a1412"/><path d="M22 18 q-8 -6 -4 -12 M42 18 q8 -6 4 -12" stroke="#b8a888" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M17 28 l-9 2 M47 28 l9 2" stroke="#7a4e30" stroke-width="5" stroke-linecap="round"/>`,
  sheep: `<circle cx="32" cy="32" r="21" fill="#f7f1e4" stroke="#8a7a66" stroke-width="2.4" stroke-dasharray="6 3"/><ellipse cx="32" cy="36" rx="11" ry="13" fill="#4a3e3a"/><circle cx="27" cy="33" r="2.4" fill="#fff"/><circle cx="37" cy="33" r="2.4" fill="#fff"/><circle cx="27" cy="33" r="1.2" fill="#1a1412"/><circle cx="37" cy="33" r="1.2" fill="#1a1412"/><path d="M21 30 l-9 3 M43 30 l9 3" stroke="#4a3e3a" stroke-width="5" stroke-linecap="round"/>`,
  pig: `<circle cx="32" cy="34" r="19" fill="#f6b2aa" stroke="#8a4a48" stroke-width="2.4"/><ellipse cx="32" cy="40" rx="9" ry="6.5" fill="#f29890" stroke="#8a4a48" stroke-width="1.6"/><ellipse cx="29" cy="40" rx="1.6" ry="2.6" fill="#8a4a48"/><ellipse cx="35" cy="40" rx="1.6" ry="2.6" fill="#8a4a48"/><circle cx="25" cy="30" r="2.6" fill="#1a1412"/><circle cx="39" cy="30" r="2.6" fill="#1a1412"/><path d="M16 22 l4 -9 l6 6 z M48 22 l-4 -9 l-6 6 z" fill="#f4a49c" stroke="#8a4a48" stroke-width="1.6" stroke-linejoin="round"/>`,
};

const face = (s: Livestock) => `<svg viewBox="0 0 64 64">${FACE[s]}</svg>`;

const CSS = `
.hv-carpenter .cp-wrap { position:absolute; left:50%; top:50%; transform:translate(-50%,-48%); pointer-events:auto; }
.hv-carpenter .cp-frame > .u-paper { width: 820px; max-width: calc(100vw - 80px); padding: 26px 26px 20px; }
.cp-head { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
.cp-head .cp-hint { flex:1; font-size:14.5px; color:#7a5230; font-weight:700; line-height:1.35; }
.cp-purse { display:flex; align-items:center; gap:6px; padding:6px 14px; border-radius:12px; background:rgba(120,70,20,.12);
  font-family:var(--font-head); font-weight:700; font-size:20px; color:#5a3414; }
.cp-purse svg { width:24px; height:24px; }
.cp-tabs { display:flex; gap:8px; margin-bottom:14px; }
.cp-tab { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:8px 16px 9px; border-radius:12px; border:2.5px solid #7a4a22;
  background:linear-gradient(180deg,#f6e2b8,#e2c28a); color:#5a3414; font-family:var(--font-head); font-weight:700; font-size:16px; cursor:pointer;
  box-shadow: inset 0 2px 0 #fff4d8, 0 3px 0 #7a4a22; transition: transform 140ms var(--ease-back), filter 140ms; }
.cp-tab svg, .cp-tab img { width:24px; height:24px; flex:0 0 auto; }
.cp-tab:hover { transform: translateY(-2px); }
.cp-tab.on { background:linear-gradient(180deg,#8fd05a,#4f9a34); border-color:#24521a; color:#fff; text-shadow:0 2px 0 #24521a; box-shadow: inset 0 2px 0 #c8f0a0, 0 3px 0 #24521a; }
.cp-list { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:14px; max-height: 470px; overflow:auto; padding:4px 4px 8px; }
.cp-list.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hv-carpenter .cp-frame.wide > .u-paper { width: 940px; }
.cp-card { position:relative; display:flex; flex-direction:column; gap:8px; padding:14px; border-radius:16px; background:rgba(255,250,236,.75);
  border:2.5px solid rgba(122,74,34,.55); box-shadow: 0 3px 0 rgba(122,74,34,.35), inset 0 0 0 2px rgba(255,255,255,.5);
  animation: cp-in 260ms var(--ease-back) both; }
@keyframes cp-in { from { opacity:0; transform: translateY(10px) scale(.96);} to { opacity:1; transform:none; } }
.cp-card.pinned::before { content:''; position:absolute; top:-7px; left:50%; width:14px; height:14px; margin-left:-7px; border-radius:50%;
  background: radial-gradient(circle at 35% 30%, #ff9a8a, #d8342a 55%, #7a1410); box-shadow:0 2px 2px rgba(0,0,0,.35); }
.cp-bp { height:120px; border-radius:10px; display:grid; place-items:center;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.14) 0 1px, transparent 1px 14px), repeating-linear-gradient(90deg, rgba(255,255,255,.14) 0 1px, transparent 1px 14px), linear-gradient(160deg,#3f6f98,#2c5478);
  box-shadow: inset 0 0 0 3px rgba(255,255,255,.25); }
.cp-bp svg { width:170px; height:120px; filter: drop-shadow(0 3px 0 rgba(10,30,60,.35)); }
.cp-name { font-family:var(--font-head); font-weight:700; font-size:22px; color:#4a2810; display:flex; align-items:baseline; gap:8px; }
.cp-name small { font-family:var(--font-body); font-size:13px; color:#8a6a4a; font-weight:800; }
.cp-blurb { font-size:14px; line-height:1.35; color:#6a4424; font-weight:700; min-height:38px; }
.cp-cost { display:flex; flex-wrap:wrap; gap:6px; }
.cp-cost span { display:inline-flex; align-items:center; gap:4px; padding:3px 9px 3px 5px; border-radius:10px; background:rgba(120,70,20,.1);
  font-family:var(--font-head); font-weight:700; font-size:15px; color:#4a2810; }
.cp-cost span.short { color:#c0392b; background:rgba(200,60,40,.12); }
.cp-cost svg, .cp-cost img { width:22px; height:22px; flex:0 0 auto; }
.cp-row { display:flex; align-items:center; gap:10px; }
.cp-row .u-btn { font-size:17px; padding:7px 18px 9px; margin-left:auto; }
.cp-row .u-btn.off, .cp-row .u-btn:disabled { filter: grayscale(.85) brightness(.92); opacity:.7; cursor: not-allowed; box-shadow:none; }
.cp-stamp { margin-left:auto; padding:4px 12px; border:3px solid currentColor; border-radius:8px; font-family:var(--font-head); font-weight:700;
  font-size:15px; letter-spacing:.06em; text-transform:uppercase; transform: rotate(-6deg); opacity:.85; }
.cp-stamp.built { color:#3f8a2a; } .cp-stamp.pending { color:#c07a1a; }
.cp-animal { flex-direction:row; align-items:stretch; gap:12px; }
.cp-animal .cp-face { align-self:center; }
.cp-animal .cp-row { margin-top:auto; padding-top:4px; }
.cp-animal .cp-face { flex:0 0 64px; height:64px; border-radius:50%; display:grid; place-items:center; background: radial-gradient(circle at 40% 35%, #fff8e8, #f0d8a8);
  border:3px solid #a8743c; box-shadow: inset 0 -4px 0 rgba(150,90,30,.2); }
.cp-animal .cp-face svg { width:54px; height:54px; }
.cp-animal .cp-face img { width:52px; height:52px; }
.cp-animal .cp-body { flex:1; display:flex; flex-direction:column; gap:4px; min-width:0; }
.cp-animal .cp-name { font-size:19px; }
.cp-animal .cp-blurb { font-size:12.5px; min-height:0; }
.cp-occ { font-size:12.5px; font-weight:800; color:#8a6a4a; }
.cp-occ b { color:#4a2810; }
.cp-card.locked { opacity:.55; filter:saturate(.6); }
.cp-msg { margin-top:10px; min-height:22px; text-align:center; font-weight:800; font-size:15px; color:#7a5230; }
.cp-msg.bad { color:#c0392b; } .cp-msg.good { color:#3f8a2a; }
.cp-msg.pop { animation: cp-pop 380ms var(--ease-back); }
@keyframes cp-shake { 0%,100% { transform:none; } 20% { transform: translateX(-6px) rotate(-1deg);} 40% { transform: translateX(5px) rotate(1deg);} 60% { transform: translateX(-3px);} 80% { transform: translateX(2px);} }
.cp-card.cp-shake { animation: cp-shake 360ms ease-out; }
@keyframes cp-pop { 0% { transform: scale(.8); } 60% { transform: scale(1.08);} 100% { transform: none; } }
`;

let styled = false;

export class CarpenterPanel extends Screen {
  private tab: Tab = 'build';
  private list!: HTMLElement;
  private msg!: HTMLElement;
  private purse!: HTMLElement;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-carpenter', { backdrop: true });
    registerAnimalIcons();
    if (!styled) {
      styled = true;
      const s = document.createElement('style');
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }

  protected render(arg?: string): void {
    this.tab = arg === 'animals' || arg === 'supplies' ? arg : 'build';
    this.root.querySelector('.cp-wrap')?.remove();
    const wrap = el('div', 'cp-wrap u-pop');
    const { frame: f, body } = frame('Carpenter’s Board', 'cp-frame');
    f.appendChild(closeButton(() => this.requestClose()));
    const head = el('div', 'cp-head');
    head.append(
      el('div', 'cp-hint', 'Pin an order and the carpenter’s crew raises it by tomorrow morning. Animals arrive the same day — they’ll be waiting inside.'),
    );
    this.purse = el('div', 'cp-purse');
    head.appendChild(this.purse);
    const tabs = el('div', 'cp-tabs');
    const defs: [Tab, string, string][] = [
      ['build', 'Buildings', ICONS.hammer ?? ICONS.bag ?? ''],
      ['animals', 'Animals', itemIcon('egg')],
      ['supplies', 'Supplies', itemIcon('hay')],
    ];
    for (const [t, label, icon] of defs) {
      const b = el('button', `cp-tab${t === this.tab ? ' on' : ''}`, `${icon}<span>${label}</span>`);
      b.dataset.nav = '';
      b.dataset.tab = t;
      b.addEventListener('click', () => {
        if (this.tab === t) return;
        this.tab = t;
        sfx(this.game, 'tab');
        this.root.querySelectorAll<HTMLElement>('.cp-tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
        this.build();
      });
      tabs.appendChild(b);
    }
    this.list = el('div', 'cp-list');
    this.msg = el('div', 'cp-msg');
    body.append(head, tabs, this.list, this.msg);
    wrap.appendChild(f);
    this.root.appendChild(wrap);
    this.build();
  }

  private say(text: string, kind: 'good' | 'bad' | '' = ''): void {
    this.msg.className = `cp-msg ${kind}`;
    this.msg.innerHTML = text;
    replay(this.msg, 'pop');
  }

  private refreshPurse(): void {
    this.purse.innerHTML = `${ICONS.coin}<span>${(this.game.services.economy?.gold() ?? 0).toLocaleString()}</span>`;
  }

  private build(): void {
    this.refreshPurse();
    this.list.innerHTML = '';
    this.list.classList.toggle('three', this.tab !== 'build');
    this.root.querySelector('.cp-frame')?.classList.toggle('wide', this.tab !== 'build');
    if (this.tab === 'build') this.buildings();
    else if (this.tab === 'animals') this.animals();
    else this.supplies();
    this.nav.attach(this.root, this.list.querySelector<HTMLElement>('[data-nav]'));
  }

  private buildings(): void {
    const b = this.game.services.buildings;
    const inv = this.game.services.inventory;
    const gold = this.game.services.economy?.gold() ?? 0;
    for (const kind of ['coop', 'barn'] as const) {
      const c = COSTS_VIEW[kind];
      const card = el('div', 'cp-card pinned');
      card.style.animationDelay = `${kind === 'coop' ? 0 : 60}ms`;
      const cost = el('div', 'cp-cost');
      const chip = (icon: string, have: number, need: number, label: string) => `<span class="${have < need ? 'short' : ''}">${icon}${label}</span>`;
      cost.innerHTML =
        chip(ICONS.coin ?? '', gold, c.gold, `${c.gold.toLocaleString()}g`) +
        chip(itemIcon('wood'), inv?.count('wood') ?? 0, c.wood, `${inv?.count('wood') ?? 0} / ${c.wood}`) +
        chip(itemIcon('stone'), inv?.count('stone') ?? 0, c.stone, `${inv?.count('stone') ?? 0} / ${c.stone}`);
      const row = el('div', 'cp-row');
      row.appendChild(cost);
      const built = b?.has(kind);
      const pending = b?.pending(kind);
      if (built || pending) row.appendChild(el('div', `cp-stamp ${built ? 'built' : 'pending'}`, built ? 'Built' : 'Tomorrow'));
      else {
        const can = gold >= c.gold && (inv?.count('wood') ?? 0) >= c.wood && (inv?.count('stone') ?? 0) >= c.stone;
        const btn = el('button', `u-btn${can ? '' : ' off'}`, 'Order');
        btn.dataset.nav = '';
        btn.addEventListener('click', () => {
          const err = b?.order(kind) ?? 'The carpenter is out.';
          if (err) {
            sfx(this.game, 'error');
            this.say(escapeHtml(err), 'bad');
            replay(card, 'cp-shake');
            return;
          }
          sfx(this.game, 'buy');
          this.say(`The crew is staking out your <b>${c.name.toLowerCase()}</b> — it’ll stand by morning!`, 'good');
          this.build();
        });
        row.appendChild(btn);
      }
      card.append(el('div', 'cp-bp', BLUEPRINT[kind]), el('div', 'cp-name', `${c.name}<small>houses ${c.houses}</small>`), el('div', 'cp-blurb', c.blurb), row);
      this.list.appendChild(card);
    }
  }

  private animals(): void {
    const b = this.game.services.buildings;
    const an = this.game.services.animals;
    LIVESTOCK_ORDER.forEach((s, i) => {
      const info = LIVESTOCK[s];
      const has = !!b?.has(info.home);
      const n = an?.count(info.home) ?? 0;
      const card = el('div', `cp-card cp-animal${has ? '' : ' locked'}`);
      card.style.animationDelay = `${i * 40}ms`;
      const body = el('div', 'cp-body');
      body.innerHTML = `<div class="cp-name">${info.name}</div><div class="cp-blurb">${info.blurb}</div>
        <div class="cp-occ">${has ? `${info.home === 'coop' ? 'Coop' : 'Barn'} <b>${n} / 6</b>` : `Needs a <b>${info.home}</b>`}</div>`;
      const row = el('div', 'cp-row');
      const afford = (this.game.services.economy?.gold() ?? 0) >= info.price;
      row.innerHTML = `<div class="cp-cost"><span${afford ? '' : ' class="short" title="Not enough gold"'}>${ICONS.coin ?? ''}${info.price.toLocaleString()}g</span></div>`;
      const ok = has && n < 6 && afford;
      const btn = el('button', `u-btn${ok ? '' : ' off'}`, 'Buy');
      if (!ok) btn.setAttribute('aria-disabled', 'true');
      btn.dataset.nav = '';
      btn.addEventListener('click', () => {
        const err = an?.buy(s) ?? 'Nobody is selling today.';
        if (err) {
          sfx(this.game, 'error');
          this.say(escapeHtml(err), 'bad');
          replay(card, 'cp-shake');
          return;
        }
        const last = an?.roster().at(-1);
        sfx(this.game, 'buy');
        this.say(`Say hello to <b>${escapeHtml(last?.name ?? info.name)}</b>! They’re settling into the ${info.home}.`, 'good');
        this.build();
      });
      row.appendChild(btn);
      body.appendChild(row);
      card.append(el('div', 'cp-face', face(s)), body);
      this.list.appendChild(card);
    });
  }

  private supplies(): void {
    for (const [qty, i] of [[1, 0], [10, 1], [30, 2]] as const) {
      const card = el('div', 'cp-card cp-animal');
      card.style.animationDelay = `${i * 50}ms`;
      const body = el('div', 'cp-body');
      body.innerHTML = `<div class="cp-name">Hay ×${qty}</div><div class="cp-blurb">Sweet meadow hay. One portion per animal per day in the feed trough.</div>`;
      const row = el('div', 'cp-row');
      const afford = (this.game.services.economy?.gold() ?? 0) >= qty * HAY_PRICE;
      row.innerHTML = `<div class="cp-cost"><span${afford ? '' : ' class="short"'}>${ICONS.coin ?? ''}${(qty * HAY_PRICE).toLocaleString()}g</span></div>`;
      const btn = el('button', `u-btn${afford ? '' : ' off'}`, 'Buy');
      btn.dataset.nav = '';
      btn.addEventListener('click', () => {
        const eco = this.game.services.economy;
        if (!eco?.spend(qty * HAY_PRICE, 'hay')) {
          sfx(this.game, 'error');
          this.say(`Needs ${(qty * HAY_PRICE).toLocaleString()}g.`, 'bad');
          return;
        }
        this.game.events.emit('item:give', { itemId: 'hay', qty });
        sfx(this.game, 'buy');
        this.say(`${qty} hay loaded onto your cart.`, 'good');
        this.refreshPurse();
      });
      row.appendChild(btn);
      body.appendChild(row);
      card.append(el('div', 'cp-face', itemIcon('hay')), body);
      this.list.appendChild(card);
    }
  }
}

/** Mirror of the build costs (system.ts owns the authoritative table; kept in sync by COSTS import there). */
export const COSTS_VIEW: Record<BuildingKind, { gold: number; wood: number; stone: number; name: string; blurb: string; houses: string }> = {
  coop: { gold: 3600, wood: 240, stone: 80, name: 'Coop', blurb: 'A snug red henhouse with nesting boxes, a roost ladder and a feed trough.', houses: 'chickens · ducks' },
  barn: { gold: 5800, wood: 320, stone: 120, name: 'Barn', blurb: 'A tall gambrel barn with straw stalls, a hay loft and a long feed trough.', houses: 'cows · goats · sheep · pigs' },
};
