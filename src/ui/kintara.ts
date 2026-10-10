/**
 * Kintara Exchange panel ('kintara'), HUD balance chip, and the mint ceremony.
 *
 *   KintaraScreen   keeper portrait + bubble + balance plate on the left; Ledger / Mint / Collection / Market tabs
 *   KintaraChip     "$KIN" chip under the gold register (click opens the panel; can be hidden from the Ledger tab)
 *   MintCeremony    a deed card stamps down over the panel with a canvas particle burst and the `kin-mint` sound
 *
 * All state lives in game.services.kintara; this file only draws it and forwards clicks.
 */
import './kintara.css';
import type { Game } from '../core/game';
import { Screen, el, frame, closeButton, sfx, replay, rollTo, escapeHtml } from './kit';
import { itemIcon, qualityStar, QUALITY_NAME } from './icons';
import { portraitSvg } from './portraits';
import { KEEPER, INTRO_LINES, SOURCES, RARITY_STYLE, FUND_TIERS, COUNTER, TITHE, MINT_PER_DAY, MINT_FEE, KIN, emissionFactor, type EarnSource } from '../data/kintara';
import type { DeedToken } from '../core/kintara-chain';

export const KIN_COIN = `<svg viewBox="0 0 24 24" class="kn-coin"><path d="M12 2.2 L20 6.8 V17.2 L12 21.8 L4 17.2 V6.8 Z" fill="#3aa6a0" stroke="#17525a" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 5.2 L17.4 8.3 V15.7 L12 18.8 L6.6 15.7 V8.3Z" fill="none" stroke="#bff2e8" stroke-width="1" opacity=".7"/><rect x="9.6" y="8.8" width="4.8" height="6.2" rx="1.4" fill="#ffd66a" stroke="#8a5a0a" stroke-width="1"/><path d="M10.4 8.8 L12 7 L13.6 8.8" fill="none" stroke="#8a5a0a" stroke-width="1"/></svg>`;

const KEYSTONE_ART = `<svg viewBox="0 0 48 48" class="u-ic"><path d="M10 38 L16 10 H32 L38 38 Z" fill="#c9b48a" stroke="#5a4426" stroke-width="2.4" stroke-linejoin="round"/><path d="M16 10 H32 L30 18 H18Z" fill="#e6d4a8"/><rect x="21" y="22" width="6" height="9" rx="2.4" fill="#ffd66a" stroke="#8a5a0a" stroke-width="1.6"/></svg>`;
const art = (itemId: string): string => (itemId === 'keystone' ? KEYSTONE_ART : itemIcon(itemId));

type Tab = 'ledger' | 'mint' | 'collection' | 'market';
const TABS: [Tab, string][] = [
  ['ledger', 'Ledger'],
  ['mint', 'Mint'],
  ['collection', 'Collection'],
  ['market', 'Market'],
];
const GLYPH: Record<EarnSource, string> = { ship: '▦', quest: '✎', festival: '✿', mine: '⛏', fish: '≈', hall: '✦' };
const EARN_RULES: Record<EarnSource, string> = {
  ship: '1 kin per 400g shipped, plus milestones',
  quest: '3 kin per notice-board job',
  festival: '8 kin for a first-place ribbon, 3 for joining in',
  mine: 'Once per floor that is a multiple of 5',
  fish: 'Once per new species; +1 for a longer record',
  hall: 'Once per bundle, room and the Hall',
};

export class KintaraScreen extends Screen {
  private tab: Tab = 'ledger';
  private content!: HTMLElement;
  private bubble!: HTMLElement;
  private plate!: HTMLElement;
  private portrait!: HTMLElement;
  private tabsEl!: HTMLElement;
  private typeT = 0;
  private counterKin = 5;
  private ceremony: MintCeremony | null = null;
  private introIx = -1;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-kintara', { backdrop: true });
    game.events.on('kintara:changed', () => {
      if (!this.isOpen) return;
      this.syncPlate();
      if (!this.ceremony?.active) this.renderTab(false);
    });
    game.events.on('kintara:minted', ({ deed, mine }) => {
      if (!this.isOpen || !mine) return;
      this.ceremony ??= new MintCeremony(game, this.root);
      this.ceremony.onEnd = () => this.isOpen && this.renderTab(false);
      this.ceremony.play(deed);
      this.say(this.svc().line('mint'));
    });
    game.events.on('kintara:earned', () => this.isOpen && this.plate && replay(this.plate, 'bump'));
  }

  private svc() {
    return this.game.services.kintara!;
  }

  protected render(arg?: string): void {
    this.root.querySelector('.kn-wrap')?.remove();
    this.tab = arg && TABS.some(([t]) => t === arg) ? (arg as Tab) : 'ledger';
    const k = this.svc();
    const wrap = el('div', 'kn-wrap u-pop');
    const { frame: f, body } = frame('Kintara Exchange', 'kn-frame');
    f.appendChild(closeButton(() => this.requestClose()));

    const left = el('div', 'kn-keeper');
    this.portrait = el('div', 'kn-portrait', portraitSvg(KEEPER.look, KEEPER.portraitBg, 'happy'));
    const name = el('div', 'kn-name', `<b>Perpetua</b><small>${escapeHtml(KEEPER.role)}</small>`);
    this.bubble = el('div', 'kn-bubble', '<p></p>');
    this.plate = el('div', 'kn-plate', `${KIN_COIN}<span class="v"></span><small>${KIN.symbol} in the farm wallet</small>`);
    left.append(this.portrait, name, this.bubble, this.plate);

    const right = el('div', 'kn-right');
    this.tabsEl = el('div', 'kn-tabs');
    for (const [t, label] of TABS) {
      const b = el('button', `kn-tab${t === this.tab ? ' on' : ''}`, label);
      b.dataset.nav = '';
      b.dataset.tab = t;
      b.addEventListener('click', () => {
        if (t === this.tab) return;
        this.tab = t;
        sfx(this.game, 'tab');
        this.tabsEl.querySelectorAll('.kn-tab').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.tab === t));
        this.renderTab(true);
      });
      this.tabsEl.appendChild(b);
    }
    const sim = el('span', 'kn-sim', k.network().simulated ? 'Simulated ledger' : escapeHtml(k.network().name));
    sim.title = 'Kintara is a game simulation: no real wallet, keys, network or money are involved.';
    this.tabsEl.appendChild(sim);
    this.content = el('div', 'kn-content');
    right.append(this.tabsEl, this.content);
    body.append(left, right);
    wrap.appendChild(f);
    this.root.appendChild(wrap);

    const v = this.plate.querySelector('.v') as HTMLElement;
    v.dataset.v = String(k.balance());
    v.textContent = k.balance().toLocaleString();
    if (!k.met()) {
      this.introIx = 0;
      this.say(INTRO_LINES[0]!);
    } else this.say(k.line('hello'));
    this.renderTab(true);
  }

  protected override onClose(): void {
    clearInterval(this.typeT);
    this.ceremony?.stop();
  }

  override back(): boolean {
    if (this.ceremony?.active) {
      this.ceremony.stop();
      return true;
    }
    return false;
  }

  private say(text: string): void {
    const node = this.bubble.querySelector('p')!;
    const paint = (i: number): void => {
      node.innerHTML = `<span>${escapeHtml(text.slice(0, i))}</span><span class="ghost">${escapeHtml(text.slice(i))}</span>`;
    };
    paint(0);
    clearInterval(this.typeT);
    let i = 0;
    this.typeT = window.setInterval(() => {
      i += 2;
      paint(Math.min(i, text.length));
      if (i >= text.length) clearInterval(this.typeT);
    }, 20);
    replay(this.portrait, 'nod');
    // First meeting: click the bubble to turn the page; the last page marks her as met.
    this.bubble.classList.toggle('intro', this.introIx >= 0);
    this.bubble.onclick = () => {
      if (this.introIx < 0) return;
      this.introIx++;
      if (this.introIx >= INTRO_LINES.length) {
        this.introIx = -1;
        this.svc().markMet();
        this.say(this.svc().line('hello'));
      } else this.say(INTRO_LINES[this.introIx]!);
    };
  }

  private syncPlate(): void {
    const v = this.plate?.querySelector('.v') as HTMLElement | null;
    if (!v) return;
    const b = this.svc().balance();
    if (v.dataset.v !== String(b)) rollTo(v, b, 600);
  }

  private notice(text: string, bad = false): void {
    sfx(this.game, bad ? 'error' : 'click');
    const n = el('div', `kn-note${bad ? ' bad' : ''}`, escapeHtml(text));
    this.content.prepend(n);
    setTimeout(() => n.remove(), 2600);
  }

  private renderTab(animate: boolean): void {
    const scroll = this.content.scrollTop;
    this.content.innerHTML = '';
    this.content.className = `kn-content kn-pg-${this.tab}`;
    if (this.tab === 'ledger') this.drawLedger();
    else if (this.tab === 'mint') this.drawMint();
    else if (this.tab === 'collection') this.drawCollection();
    else this.drawMarket();
    if (animate) replay(this.content, 'kn-in');
    else this.content.scrollTop = scroll;
    this.nav.attach(this.root, this.nav.current && this.root.contains(this.nav.current) ? this.nav.current : null);
  }

  // ── Ledger ──
  private drawLedger(): void {
    const k = this.svc();
    const t = k.today();
    const life = k.lifetime();
    const sup = k.supply();
    const yr = this.game.calendar.year;
    const pct = Math.min(100, Math.round((t.earned / Math.max(1, t.cap)) * 100));
    const stats = el(
      'div',
      'kn-stats',
      `<div class="kn-card"><small>Earned today</small><b>${t.earned} <i>/ ${t.cap}</i></b><div class="kn-bar"><i style="width:${pct}%"></i></div><em>Year ${yr} schedule: x${emissionFactor(yr).toFixed(2)}</em></div>
       <div class="kn-card"><small>Earned in all</small><b>${life.earned.toLocaleString()}</b><em>never bought, only written</em></div>
       <div class="kn-card"><small>Burned by sinks</small><b>${life.burned.toLocaleString()}</b><em>destroyed, paid to no one</em></div>`,
    );
    const srcs = el('div', 'kn-sources');
    srcs.appendChild(el('h4', '', 'How kin is written'));
    for (const id of Object.keys(SOURCES) as EarnSource[]) {
      const s = SOURCES[id];
      const got = t.bySource[id] ?? 0;
      const cap = Math.round(s.daily * emissionFactor(yr) * (1 + (k.fund().tier >= 2 ? 0.1 : 0)));
      srcs.appendChild(el('div', 'kn-src', `<span class="g">${GLYPH[id]}</span><div><b>${s.label}</b><small>${EARN_RULES[id]}</small></div><span class="n">${s.daily ? `${got}/${cap}` : 'one-time'}</span>`));
    }
    const feed = el('div', 'kn-feed');
    feed.appendChild(el('h4', '', 'Recent lines'));
    const items = k.feed().slice(0, 9);
    if (!items.length) feed.appendChild(el('div', 'kn-empty', 'Nothing written yet. Ship a crop, post a catch, or take a notice-board job.'));
    for (const e of items) feed.appendChild(el('div', `kn-line ${e.kind}`, `<span>${escapeHtml(e.text)}</span><b>${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount)}</b>`));
    const v = k.verify();
    const net = this.game.services.net?.role?.() ?? 'solo';
    const foot = el(
      'div',
      'kn-foot',
      `<div><small>Address</small><code>${escapeHtml(k.address())}</code></div>
       <div><small>Ledger</small><b class="${v.ok ? 'ok' : 'bad'}">${v.ok ? 'verified' : 'DAMAGED'}</b> <code>#${v.height}</code></div>
       <div><small>Reserve left</small><code>${sup.reserve.toLocaleString()}</code></div>
       <div><small>Tithe</small><code>${Math.round(TITHE.pct * 100)}% over ${TITHE.above}/day</code></div>`,
    );
    const opt = el('label', 'kn-opt', `<input type="checkbox" ${k.chipVisible() ? 'checked' : ''}/> Show the ${KIN.symbol} chip on screen`);
    opt.querySelector('input')!.addEventListener('change', (e) => k.setChipHidden(!(e.target as HTMLInputElement).checked));
    const note = el('div', 'kn-fine', `Kintara is a simulation inside Hearthvale: no real wallet, keys, network or money. ${net === 'solo' ? '' : 'In co-op the farm shares one wallet and the host keeps the ledger.'}`);
    const cols = el('div', 'kn-cols');
    cols.append(srcs, feed);
    this.content.append(stats, cols, foot, opt, note);
  }

  // ── Mint ──
  private drawMint(): void {
    const k = this.svc();
    const t = k.today();
    this.content.appendChild(el('div', 'kn-intro', `Sealing writes a <b>soulbound deed</b>: it cannot be sold, traded or moved. The fee is burned and the item goes into the vault (tools are only attested). Editions get dearer. <b>${t.mintLeft}</b> of ${MINT_PER_DAY} seals left today.`));
    const opts = k.mintOptions();
    const guide = el(
      'div',
      'kn-guide',
      `<h4>The fee board <small>burned when you seal; later editions of the same item cost x2, then x4</small></h4>
       <div class="kn-fees">${(['common', 'uncommon', 'rare', 'legendary'] as const).map((r) => `<span class="kn-rar" style="--c:${RARITY_STYLE[r].color}">${RARITY_STYLE[r].name}</span><b>${MINT_FEE[r]}</b>`).join('')}</div>
       <small>Crops gold or 160g+ · Fish 150g+ · Gems amethyst up · Tools any upgrade (attested)</small>`,
    );
    if (!opts.length) this.content.appendChild(el('div', 'kn-empty', 'Nothing in your pack can be sealed yet.'));
    for (const o of opts) {
      const r = RARITY_STYLE[o.rule.rarity];
      const row = el(
        'div',
        `kn-row${o.blocked ? ' off' : ''}`,
        `<div class="u-slot mini">${art(o.itemId)}${qualityStar(o.rule.category === 'tool' ? 0 : o.quality)}</div>
         <div class="nm"><b>${escapeHtml(o.name)}${o.quality && o.rule.category !== 'tool' ? ` <em class="q${o.quality}">${QUALITY_NAME[o.quality] ?? ''}</em>` : ''}</b>
         <small><span class="kn-rar" style="--c:${r.color}">${r.name}</span> Edition ${o.edition} of ${o.maxEdition}${o.rule.attest ? ' · attested, stays in your pack' : ''}</small></div>
         <div class="pr">${KIN_COIN}<span>${o.fee}</span></div>`,
      );
      const b = el('button', `u-btn small green${o.blocked ? ' disabled' : ''}`, 'Seal');
      b.dataset.nav = '';
      if (o.blocked) b.title = o.blocked;
      b.addEventListener('click', () => {
        if (o.blocked) return this.notice(o.blocked, true);
        const res = k.mint(o.itemId, o.quality);
        if (!res.ok) return this.notice(res.reason ?? 'Not now', true);
        if (res.pending) this.notice('Sent to the host to seal…');
      });
      row.appendChild(b);
      if (o.blocked) row.appendChild(el('div', 'why', escapeHtml(o.blocked)));
      this.content.appendChild(row);
    }
    this.content.appendChild(guide);
  }

  // ── Collection ──
  private drawCollection(): void {
    const deeds = this.svc().deeds();
    const cats: [string, string][] = [['crop', 'Crops'], ['fish', 'Fish'], ['gem', 'Gems'], ['tool', 'Tools'], ['keepsake', 'Keepsakes']];
    const chips = el('div', 'kn-chips');
    for (const [c, l] of cats) chips.appendChild(el('span', 'kn-chip', `${l} <b>${deeds.filter((d) => d.category === c).length}</b>`));
    this.content.appendChild(chips);
    if (!deeds.length) {
      this.content.appendChild(el('div', 'kn-empty', 'No deeds yet. Seal a rare crop, fish, gem or upgraded tool in the Mint tab and it will hang here for good.'));
      return;
    }
    const grid = el('div', 'kn-grid');
    for (const d of [...deeds].reverse()) grid.appendChild(deedCard(d));
    const ghosts: [string, string, string, string][] = [
      ['crop', 'pumpkin', 'Gold harvest', 'rare'],
      ['fish', 'lanternEel', 'A rare catch', 'rare'],
      ['gem', 'ruby', 'A hard-won gem', 'rare'],
      ['tool', 'pickaxe', 'An upgraded tool', 'uncommon'],
      ['keepsake', 'keystone', 'The Hall Keystone', 'legendary'],
    ];
    for (const [cat, item, label, rar] of ghosts) {
      if (deeds.some((d) => d.category === cat) || grid.children.length >= 8) continue;
      const rs = RARITY_STYLE[rar as keyof typeof RARITY_STYLE];
      const gh = el('div', 'kn-deed ghost', `<div class="art">${art(item)}</div><em class="ribbon" style="--c:${rs.color}"></em><b>${label}</b><span class="kn-rar" style="--c:${rs.color}">${rs.name}</span><small>not sealed yet</small>`);
      gh.style.setProperty('--rc', rs.color);
      grid.appendChild(gh);
    }
    const more: [string, string, string][] = [
      ['diamond', 'The deepest gem', 'legendary'],
      ['lanternjaw', 'The Lanternjaw', 'legendary'],
      ['melon', 'A giant-grown melon', 'rare'],
      ['emberKoi', 'Ember Koi, 2nd edition', 'rare'],
    ];
    for (const [item, label, rar] of more) {
      if (grid.children.length >= 8) break;
      const rs = RARITY_STYLE[rar as keyof typeof RARITY_STYLE];
      const gh = el('div', 'kn-deed ghost', `<div class="art">${art(item)}</div><em class="ribbon" style="--c:${rs.color}"></em><b>${label}</b><span class="kn-rar" style="--c:${rs.color}">${rs.name}</span><small>waiting to be sealed</small>`);
      gh.style.setProperty('--rc', rs.color);
      grid.appendChild(gh);
    }
    this.content.appendChild(grid);
  }

  private findStrip(deeds: DeedToken[]): HTMLElement {
    const hints: [string, string, string][] = [
      ['crop', 'Crops', 'a gold-quality harvest, or a pumpkin, melon, yam'],
      ['fish', 'Fish', 'an Ember Koi, Old Bristleback, the Lanternjaw'],
      ['gem', 'Gems', 'amethyst, topaz, ruby, aquamarine, diamond'],
      ['tool', 'Tools', 'upgrade a tool at the forge, then attest it'],
      ['keepsake', 'Keepsakes', 'the Hall Keystone, stamped when the Hall relights'],
    ];
    const box = el('div', 'kn-guide finds');
    box.appendChild(el('h4', '', 'Still to find <small>one deed on each shelf fills it</small>'));
    for (const [c, l, h] of hints) {
      const n = deeds.filter((d) => d.category === c).length;
      box.appendChild(el('div', `kn-find${n ? ' done' : ''}`, `<span>${n ? '&#10003;' : '&#9675;'}</span><b>${l}</b><small>${n ? `${n} sealed` : h}</small>`));
    }
    return box;
  }

  // ── Market ──
  private drawMarket(): void {
    const k = this.svc();
    const t = k.today();
    const q = k.quoteConvert(this.counterKin);
    const counter = el('div', 'kn-sect');
    counter.innerHTML = `<h4>Gold Counter <small>kin to gold only, never the other way</small></h4>
      <div class="kn-counter"><div class="kn-step"><button class="u-btn small" data-d="-5" data-nav>−5</button><button class="u-btn small" data-d="-1" data-nav>−</button><b>${this.counterKin}</b><button class="u-btn small" data-d="1" data-nav>+</button><button class="u-btn small" data-d="5" data-nav>+5</button></div>
      <div class="kn-quote"><span class="kn-q1">${KIN_COIN} ${q.kin} kin → <b>${q.gold}g</b></span><small>${q.rate.toFixed(1)}g per kin, slipping ${Math.round(COUNTER.slip * 100)}% for each kin traded today, ${Math.round(COUNTER.tax * 100)}% tax. ${t.counterLeft} of ${COUNTER.perDay} left today.</small></div>
      <button class="u-btn small blue kn-trade${q.kin < 1 ? ' disabled' : ''}" data-nav>Trade</button></div>`;
    counter.querySelectorAll<HTMLElement>('[data-d]').forEach((b) =>
      b.addEventListener('click', () => {
        this.counterKin = Math.max(1, Math.min(COUNTER.perDay, this.counterKin + Number(b.dataset.d)));
        sfx(this.game, 'tick');
        this.renderTab(false);
      }),
    );
    counter.querySelector('.kn-trade')!.addEventListener('click', () => {
      const r = k.convert(this.counterKin);
      if (!r.ok) return this.notice(r.reason ?? 'Not now', true);
      this.notice(r.pending ? 'Sent to the host…' : `Traded for ${r.gold}g`);
    });

    const goods = el('div', 'kn-sect');
    goods.appendChild(el('h4', '', 'Exchange goods <small>paid in kin, which is burned</small>'));
    const gg = el('div', 'kn-goods');
    for (const o of k.offers()) {
      const can = k.balance() >= o.kin;
      const row = el('div', `kn-row${can ? '' : ' off'}`, `<div class="u-slot mini">${itemIcon(o.itemId)}</div><div class="nm"><b>${o.qty > 1 ? `${o.qty}× ` : ''}${escapeHtml(o.name)}</b><small>${escapeHtml(o.note)}</small></div><div class="pr">${KIN_COIN}<span>${o.kin}</span></div>`);
      const b = el('button', `u-btn small green${can ? '' : ' disabled'}`, 'Buy');
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        const r = k.buy(o.id);
        if (!r.ok) return this.notice(r.reason ?? 'Not now', true);
        this.say(k.line('burn'));
      });
      row.appendChild(b);
      gg.appendChild(row);
    }
    goods.appendChild(gg);

    const f = k.fund();
    const next = FUND_TIERS[f.tier];
    const prev = FUND_TIERS[f.tier - 1]?.at ?? 0;
    const fund = el('div', 'kn-sect kn-fund');
    fund.innerHTML = `<h4>Lantern Fund <small>burn kin for the Hall's oil</small></h4>
      <div class="kn-fundbar"><i style="width:${next ? Math.min(100, ((f.kin - prev) / (next.at - prev)) * 100) : 100}%"></i><span>${f.kin} kin burned${next ? ` · next: ${next.title} at ${next.at}` : ' · every tier lit'}</span></div>
      <div class="kn-fundrow"><small>${next ? `Next perk: ${next.perk}` : 'Every perk is lit.'}</small><div class="kn-give"></div></div>`;
    const give = fund.querySelector('.kn-give')!;
    for (const n of [5, 25, 100]) {
      const b = el('button', `u-btn small${k.balance() >= n ? '' : ' disabled'}`, `Burn ${n}`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        const r = k.donate(n);
        if (!r.ok) return this.notice(r.reason ?? 'Not now', true);
        this.say(k.line('burn'));
      });
      give.appendChild(b);
    }
    const yr = this.game.calendar.year;
    const bars = [1, 2, 3, 4, 5, 6].map((y) => {
      const v = Math.max(10, Math.round(32 * emissionFactor(y)));
      return `<div class="kn-ebar${y === yr ? ' now' : ''}"><i style="height:${Math.round((v / 32) * 44)}px"></i><b>${v}</b><small>Y${y}</small></div>`;
    }).join('');
    const recent = k.feed().slice(0, 3).map((e) => `<div class="kn-line ${e.kind}"><span>${escapeHtml(e.text)}</span><b>${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount)}</b></div>`).join('');
    const sched = el('div', 'kn-sect kn-sched');
    sched.innerHTML = `<div class="kn-schedcol"><h4>Emission schedule <small>daily ceiling per farm</small></h4><div class="kn-ebars">${bars}</div></div><div class="kn-schedcol"><h4>Recent lines</h4>${recent || '<div class="kn-empty">Nothing written yet.</div>'}</div>`;
    this.content.append(counter, goods, fund, sched);
  }
}

function deedCard(d: DeedToken): HTMLElement {
  const r = RARITY_STYLE[d.rarity];
  const c = el(
    'div',
    `kn-deed ${d.rarity}`,
    `<div class="art">${art(d.itemId)}${d.category === 'tool' ? '' : qualityStar(d.quality)}</div>
     <i class="foil"></i><em class="ribbon" style="--c:${r.color}"></em>
     <b>${escapeHtml(d.name)}</b><span class="kn-rar" style="--c:${r.color}">${r.name}</span>
     <small>${escapeHtml(d.note)}</small>
     <small>${d.tokenId} · Edition ${d.edition}</small>
     <small class="by">${escapeHtml(d.mintedBy)} · ${escapeHtml(d.date)}</small>
     <code>${d.tx}</code><i class="lock" title="Soulbound: cannot be transferred">&#128274;</i>`,
  );
  c.style.setProperty('--glow', r.glow);
  c.style.setProperty('--rc', r.color);
  return c;
}

// ───────────────────────────────────────────────────────────── mint ceremony

export class MintCeremony {
  active = false;
  onEnd: (() => void) | null = null;
  private box: HTMLElement | null = null;
  private raf = 0;
  private timer = 0;

  constructor(
    private game: Game,
    private parent: HTMLElement,
  ) {}

  play(d: DeedToken): void {
    this.stop();
    this.active = true;
    const box = el('div', 'kn-ceremony interactive');
    box.innerHTML = `<canvas></canvas><div class="kn-seal"><div class="ring"></div>${deedCard(d).outerHTML}<p>Sealed to the Tally</p></div>`;
    box.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.stop();
    });
    this.parent.appendChild(box);
    this.box = box;
    sfx(this.game, 'kin-mint');
    if (!document.body.classList.contains('u-calm')) this.burst(box.querySelector('canvas')!, RARITY_STYLE[d.rarity].color);
    this.timer = window.setTimeout(() => this.stop(), 3600);
  }

  stop(): void {
    const was = this.active;
    this.active = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.box?.remove();
    this.box = null;
    if (was) this.onEnd?.();
  }

  private burst(cv: HTMLCanvasElement, tint: string): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = (cv.width = Math.floor(cv.clientWidth * dpr) || 1200);
    const h = (cv.height = Math.floor(cv.clientHeight * dpr) || 700);
    const g = cv.getContext('2d')!;
    const cols = ['#ffd66a', '#bff2e8', '#3aa6a0', tint, '#fff6d0'];
    const ps = Array.from({ length: 150 }, (_, i) => {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 360) * dpr * (i < 40 ? 1.5 : 1);
      return { x: w / 2, y: h * 0.47, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * dpr, s: (2 + Math.random() * 4) * dpr, c: cols[i % cols.length]!, life: 0.9 + Math.random() * 1.1, star: i % 7 === 0 };
    });
    const t0 = performance.now();
    let last = t0;
    const step = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const age = (now - t0) / 1000;
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      for (const p of ps) {
        if (age > p.life) continue;
        p.vy += 520 * dpr * dt;
        p.vx *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.globalAlpha = Math.max(0, 1 - age / p.life);
        g.fillStyle = p.c;
        if (p.star) {
          g.fillRect(p.x - p.s * 1.6, p.y - 0.7 * dpr, p.s * 3.2, 1.4 * dpr);
          g.fillRect(p.x - 0.7 * dpr, p.y - p.s * 1.6, 1.4 * dpr, p.s * 3.2);
        } else {
          g.beginPath();
          g.arc(p.x, p.y, p.s, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (age < 2.2 && this.active) this.raf = requestAnimationFrame(step);
      else g.clearRect(0, 0, w, h);
    };
    this.raf = requestAnimationFrame(step);
  }
}

// ───────────────────────────────────────────────────────────── HUD chip

export class KintaraChip {
  private node: HTMLElement;
  private num: HTMLElement;
  private shown = -1;

  constructor(
    private game: Game,
    plate: HTMLElement,
  ) {
    this.node = el('button', 'kn-chip-hud interactive hv-hidden', `${KIN_COIN}<span class="v">0</span><small>${KIN.symbol.replace('$', '')}</small>`);
    this.num = this.node.querySelector('.v') as HTMLElement;
    this.node.title = 'Kintara Exchange: your kin';
    this.node.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.node.addEventListener('click', () => game.events.emit('ui:open', { name: 'kintara' }));
    plate.appendChild(this.node);
    const sync = (): void => {
      const k = game.services.kintara;
      if (!k) return;
      this.node.classList.toggle('hv-hidden', !k.chipVisible());
      const b = k.balance();
      if (b !== this.shown) {
        if (this.shown < 0) {
          this.num.dataset.v = String(b);
          this.num.textContent = b.toLocaleString();
        } else rollTo(this.num, b, 600);
        this.shown = b;
      }
    };
    game.events.on('kintara:changed', sync);
    game.events.on('load:after', sync);
    game.events.on('kintara:earned', ({ amount }) => this.float(`+${amount}`, true));
    game.events.on('kintara:burned', ({ amount }) => this.float(`−${amount}`, false));
    setTimeout(sync, 0);
  }

  private float(text: string, up: boolean): void {
    replay(this.node, 'bump');
    const d = el('div', `kn-delta ${up ? 'up' : 'down'}`, text);
    this.node.appendChild(d);
    setTimeout(() => d.remove(), 1700);
  }
}
