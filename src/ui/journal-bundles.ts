/**
 * Bundle altar ('bundles:<roomId>'): opened at a room's lantern plinth in the Lantern Hall.
 *   left    the room's lantern (glows brighter with every item given), name, blurb, what it restores
 *   top     one cloth sack per bundle (plump + gold ribbon when complete) with n / m progress
 *   centre  the selected bundle: big item slots (ghosted until given, counts, fill rings), its reward
 *   bottom  the backpack; items the bundle wants glow — click to offer them (icon flies into the slot)
 * Everything goes through the `quests` + `inventory` services.
 */
import './journal.css';
import './journal-ui.css';
import type { Game } from '../core/game';
import { Screen, el, frame, closeButton, tooltip, sfx, replay, escapeHtml } from './kit';
import { ROOMS, roomDef, type BundleDef } from '../data/bundles';
import { itemDef } from '../data/items';
import { lanternSvg, sackSvg, iconOf, itemName, whereFrom, CHECK, COIN } from './journal-art';
import { itemIcon } from './icons';
import { loadStoryFonts } from './journal-cutscene';

const css = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;

export class BundlePanel extends Screen {
  private room = 'seed';
  private sel = 0;
  private left!: HTMLElement;
  private sacks!: HTMLElement;
  private card!: HTMLElement;
  private pack!: HTMLElement;
  private stamp!: HTMLElement;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent.parentElement?.querySelector('.hv-screens') ?? parent, 'hv-bundles', { backdrop: true });
    loadStoryFonts();
    game.events.on('inventory:change', () => {
      if (this.isOpen) this.renderPack();
    });
    game.events.on('quest:sync', () => {
      if (this.isOpen) this.refresh();
    });
  }

  private get q() {
    return this.game.services.quests;
  }

  protected render(arg?: string): void {
    this.root.querySelector('.u-pop')?.remove();
    this.room = arg && roomDef(arg) ? arg : 'seed';
    const def = roomDef(this.room)!;
    const st = this.q?.room(this.room);
    // Start on the first unfinished bundle.
    this.sel = Math.max(0, st?.bundles.findIndex((b) => !b.done) ?? 0);
    const wrap = el('div', 'jb-wrap u-pop');
    wrap.style.setProperty('--room', css(def.color));
    wrap.style.setProperty('--room-soft', css(def.accent));
    const { frame: f, body } = frame(def.name, 'jb-frame');
    f.appendChild(closeButton(() => this.requestClose()));
    this.left = el('div', 'jb-left');
    const right = el('div', 'jb-right');
    this.sacks = el('div', 'jb-sacks');
    this.card = el('div', 'jb-card');
    const packWrap = el('div', 'jb-packwrap', `<div class="jb-packhead"><span>Your backpack</span><small>Click glowing items to offer them</small><button class="u-btn green jb-all" data-nav>Offer all</button></div>`);
    packWrap.querySelector('.jb-all')?.addEventListener('click', () => this.offerAll());
    this.pack = el('div', 'jb-pack');
    packWrap.appendChild(this.pack);
    right.append(this.sacks, this.card, packWrap);
    body.append(this.left, right);
    this.stamp = el('div', 'jb-stamp');
    f.appendChild(this.stamp);
    wrap.appendChild(f);
    this.root.appendChild(wrap);
    this.refresh();
  }

  private refresh(): void {
    this.renderLeft();
    this.renderSacks();
    this.renderCard();
    this.renderPack();
  }

  private progress(): number {
    const st = this.q?.room(this.room);
    if (!st) return 0;
    let have = 0;
    let need = 0;
    for (const b of st.bundles) {
      for (const it of b.def.items) {
        need += it.qty;
        have += Math.min(it.qty, b.given[it.itemId] ?? 0);
      }
      if (b.def.gold) {
        need += 10;
        have += Math.round((b.paid / b.def.gold) * 10);
      }
    }
    return need ? have / need : 0;
  }

  private renderLeft(): void {
    const def = roomDef(this.room)!;
    const st = this.q?.room(this.room);
    const doneN = st?.bundles.filter((b) => b.done).length ?? 0;
    const total = st?.bundles.length ?? 0;
    const glow = st?.done ? 1 : this.progress() * 0.75;
    const season = def.season === 'any' ? 'All year' : def.season[0]!.toUpperCase() + def.season.slice(1);
    this.left.innerHTML = `
      <div class="jb-lanternbox">${lanternSvg(def.color, glow, 'jl-lantern big')}</div>
      <div class="jb-lname">${escapeHtml(def.lantern)}</div>
      <div class="jb-season">${season} room · ${doneN} / ${total} bundles</div>
      <p class="jb-blurb">${escapeHtml(def.blurb)}</p>
      <div class="jb-restores ${st?.done ? 'on' : ''}">
        <small>${st?.done ? 'Restored to the valley' : 'When this lantern burns'}</small>
        <b>${escapeHtml(def.restores.title)}</b>
        <span>${escapeHtml(def.restores.text)}</span>
      </div>
      <div class="jb-hall"><small>The Hall · ${this.q?.lanternsLit() ?? 0} of ${ROOMS.length} lanterns</small><div class="row">${ROOMS.map((r) => `<i class="${r.id === this.room ? 'me' : ''}" title="${escapeHtml(r.name)}">${lanternSvg(this.q?.room(r.id)?.glimmer ? 0xdff4ff : r.color, this.q?.room(r.id)?.done ? 1 : 0, 'jl-mini')}</i>`).join('')}</div></div>`;
  }

  private renderSacks(): void {
    const st = this.q?.room(this.room);
    this.sacks.innerHTML = '';
    st?.bundles.forEach((b, i) => {
      const need = b.def.items.reduce((s, it) => s + it.qty, 0) + (b.def.gold ? 1 : 0);
      const have = b.def.items.reduce((s, it) => s + Math.min(it.qty, b.given[it.itemId] ?? 0), 0) + (b.def.gold && b.paid >= b.def.gold ? 1 : 0);
      const t = el('button', `jb-sack${i === this.sel ? ' on' : ''}${b.done ? ' done' : ''}`);
      t.dataset.nav = '';
      t.innerHTML = `${sackSvg(b.def.color, b.done, need ? have / need : 0)}<span class="nm">${escapeHtml(b.def.name)}</span><span class="pr">${b.done ? 'Complete' : b.def.gold ? `${b.paid.toLocaleString()} / ${b.def.gold.toLocaleString()}g` : `${have} / ${need}`}</span>`;
      t.addEventListener('click', () => {
        if (this.sel !== i) sfx(this.game, 'tab');
        this.sel = i;
        this.renderSacks();
        this.renderCard();
        this.renderPack();
      });
      this.sacks.appendChild(t);
    });
  }

  private bundle(): { def: BundleDef; given: Record<string, number>; paid: number; done: boolean } | undefined {
    return this.q?.room(this.room)?.bundles[this.sel];
  }

  private renderCard(): void {
    const b = this.bundle();
    if (!b) {
      this.card.innerHTML = '';
      return;
    }
    const d = b.def;
    const slots = d.items
      .map((it) => {
        const have = Math.min(it.qty, b.given[it.itemId] ?? 0);
        const full = have >= it.qty;
        const pct = have / it.qty;
        return `<div class="jb-slot ${full ? 'full' : have ? 'part' : ''}" data-item="${it.itemId}" style="--p:${pct}">
          <div class="ring"></div><div class="ic">${iconOf(it.itemId, it)}</div>
          <div class="cnt">${full ? CHECK : `${have}/${it.qty}`}</div>
          <div class="lbl">${escapeHtml(itemName(it.itemId, it.name))}</div>${!full && whereFrom(it.itemId) ? `<div class="src">${escapeHtml(whereFrom(it.itemId))}</div>` : ''}</div>`;
      })
      .join('');
    const gold = d.gold
      ? `<div class="jb-gold ${b.paid >= d.gold ? 'full' : ''}"><div class="coins">${COIN}${COIN}${COIN}</div><b>${d.gold.toLocaleString()}g</b><small>${b.paid >= d.gold ? 'Paid in full' : `${b.paid.toLocaleString()}g given`}</small>
          ${b.paid < d.gold ? `<button class="u-btn green jb-pay" data-nav>Pay ${(d.gold - b.paid).toLocaleString()}g</button>` : ''}</div>`
      : '';
    const r = d.reward;
    const reward = r.itemId ? `${itemIcon(r.itemId)}<b>${r.qty ?? 1} × ${escapeHtml(itemDef(r.itemId)?.name ?? r.itemId)}</b>` : r.gold ? `${COIN}<b>${r.gold.toLocaleString()}g</b>` : `<b>${escapeHtml(r.label ?? '—')}</b>`;
    this.card.innerHTML = `
      <div class="jb-cardhead"><div><h3>${escapeHtml(d.name)}</h3><div class="note">${escapeHtml(d.note)}</div></div>
        <div class="jb-reward ${b.done ? 'got' : ''}"><small>${b.done ? 'Received' : 'Reward'}</small><div>${reward}</div></div></div>
      <div class="jb-slots">${slots}${gold}</div>
      <div class="jb-bigsack" aria-hidden="true">${sackSvg(d.color, b.done, this.fillOf(b))}</div>
      ${b.done ? `<div class="jb-done">Bundle complete</div>` : ''}`;
    this.card.querySelector('.jb-pay')?.addEventListener('click', () => this.payGold());
    replay(this.card, 'swap');
  }

  /** 0..1: how much of a bundle has been given (items + coins). */
  private fillOf(b: { def: BundleDef; given: Record<string, number>; paid: number; done: boolean }): number {
    if (b.done) return 1;
    let have = 0;
    let need = 0;
    for (const it of b.def.items) {
      have += Math.min(it.qty, b.given[it.itemId] ?? 0);
      need += it.qty;
    }
    if (b.def.gold) {
      have += (b.paid / b.def.gold) * Math.max(1, need);
      need += Math.max(1, need);
    }
    return need ? have / need : 0;
  }

  private renderPack(): void {
    const inv = this.game.services.inventory;
    const b = this.bundle();
    const want = new Set(b && !b.done ? b.def.items.filter((it) => (b.given[it.itemId] ?? 0) < it.qty).map((it) => it.itemId) : []);
    this.pack.innerHTML = '';
    const all = this.pack.parentElement?.querySelector<HTMLElement>('.jb-all');
    if (all) all.classList.toggle('hv-hidden', !(inv?.slots ?? []).some((s) => s && want.has(s.id)));
    (inv?.slots ?? []).slice(0, 30).forEach((s, i) => {
      const c = el('div', `u-slot jb-pslot${s && want.has(s.id) ? ' want' : ''}${!s ? ' empty' : ''}`);
      if (s) {
        c.dataset.id = s.id;
        c.innerHTML = `${itemIcon(s.id)}${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}`;
        c.addEventListener('pointerenter', () => tooltip.show(`<b>${escapeHtml(itemDef(s.id)?.name ?? s.id)}</b>${want.has(s.id) ? '<br/><span style="color:#3f8a2e">Wanted by this bundle — click to offer</span>' : ''}`));
        c.addEventListener('pointerleave', () => tooltip.hide());
        c.addEventListener('click', () => this.offer(s.id, c));
        if (want.has(s.id)) c.dataset.nav = '';
      }
      if (i === 10 || i === 20) this.pack.appendChild(el('i', 'jb-break'));
      this.pack.appendChild(c);
    });
  }

  private offer(itemId: string, from: HTMLElement): void {
    const b = this.bundle();
    const q = this.q;
    if (!b || !q || b.done) return;
    const need = b.def.items.find((it) => it.itemId === itemId);
    if (!need || (b.given[itemId] ?? 0) >= need.qty) {
      replay(from, 'nope');
      sfx(this.game, 'error');
      return;
    }
    const roomWasDone = !!q.room(this.room)?.done;
    const n = q.contribute(b.def.id, itemId, need.qty);
    if (n <= 0) return;
    sfx(this.game, 'drop');
    const target = this.card.querySelector<HTMLElement>(`.jb-slot[data-item="${itemId}"]`);
    this.fly(from, target);
    window.setTimeout(() => this.afterGive(roomWasDone), 380);
  }

  /** Offer every wanted item in the backpack to the selected bundle at once. */
  private offerAll(): void {
    const b = this.bundle();
    const q = this.q;
    if (!b || !q || b.done) return;
    const roomWasDone = !!q.room(this.room)?.done;
    let given = 0;
    let delay = 0;
    for (const it of b.def.items) {
      const left = it.qty - (b.given[it.itemId] ?? 0);
      if (left <= 0) continue;
      const from = this.pack.querySelector<HTMLElement>(`.jb-pslot.want[data-id="${it.itemId}"]`);
      const n = q.contribute(b.def.id, it.itemId, left);
      if (n <= 0) continue;
      given += n;
      const target = this.card.querySelector<HTMLElement>(`.jb-slot[data-item="${it.itemId}"]`);
      if (from) window.setTimeout(() => this.fly(from, target), delay);
      delay += 90;
    }
    if (!given) {
      sfx(this.game, 'error');
      return;
    }
    sfx(this.game, 'drop');
    window.setTimeout(() => this.afterGive(roomWasDone), 380 + delay);
  }

  private payGold(): void {
    const b = this.bundle();
    if (!b || !this.q) return;
    const roomWasDone = !!this.q.room(this.room)?.done;
    const n = this.q.contributeGold(b.def.id);
    if (n <= 0) {
      sfx(this.game, 'error');
      replay(this.card.querySelector('.jb-gold'), 'nope');
      return;
    }
    sfx(this.game, 'coin');
    this.afterGive(roomWasDone);
  }

  private afterGive(roomWasDone: boolean): void {
    const b = this.bundle();
    this.renderLeft();
    this.renderSacks();
    this.renderCard();
    this.renderPack();
    const slot = this.card.querySelectorAll('.jb-slot');
    slot.forEach((s) => s.classList.contains('full') && replay(s, 'pop'));
    const room = this.q?.room(this.room);
    if (room?.done && !roomWasDone) {
      this.stamp.innerHTML = `<div class="st-in"><small>The ${escapeHtml(roomDef(this.room)!.lantern)} stirs…</small><b>${escapeHtml(roomDef(this.room)!.name)} restored!</b></div>`;
      replay(this.stamp, 'show');
      sfx(this.game, 'buy');
    } else if (b?.done) {
      replay(this.card.querySelector('.jb-done'), 'show');
      sfx(this.game, 'craft');
      // Hop to the next unfinished bundle after a beat.
      window.setTimeout(() => {
        const st = this.q?.room(this.room);
        const next = st?.bundles.findIndex((x) => !x.done) ?? -1;
        if (this.isOpen && next >= 0 && next !== this.sel) {
          this.sel = next;
          this.renderSacks();
          this.renderCard();
          this.renderPack();
        }
      }, 1100);
    }
  }

  private fly(from: HTMLElement, to: HTMLElement | null): void {
    const img = from.querySelector('img, svg');
    if (!img || !to) return;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ghost = img.cloneNode(true) as HTMLElement;
    ghost.classList.add('jb-fly');
    Object.assign(ghost.style, { left: `${a.left + a.width / 2 - 24}px`, top: `${a.top + a.height / 2 - 24}px` });
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    ghost.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(1.35)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.8)`, opacity: 0.2 },
      ],
      { duration: 420, easing: 'cubic-bezier(.3,.1,.3,1)' },
    ).onfinish = () => ghost.remove();
  }

  override back(): boolean {
    return false;
  }
}

/** All rooms in a stable order (journal overview). */
export const ROOM_ORDER = ROOMS.map((r) => r.id);
