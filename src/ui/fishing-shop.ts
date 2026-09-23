/**
 * Bait & Tackle counter at the Driftsand shack (`__game.openUI('tackle')`, or interact at the shack
 * porch): an honesty-box counter selling bait, tackle and rod upgrades. Shows the fishing skill
 * (level, XP to next) and the current rod; higher goods unlock with the fishing level.
 */
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { TACKLE_GOODS, ROD_TIERS, FISHING_XP } from '../data/fish';
import { Screen, el, frame, closeButton, sfx, escapeHtml, tooltip } from './kit';
import { ICONS, itemIcon } from './icons';
import { ROD_LOOKS } from '../world/beach/tackle';

function rodIcon(tier: number): string {
  const l = ROD_LOOKS[tier] ?? ROD_LOOKS[0]!;
  const c = (n: number): string => '#' + n.toString(16).padStart(6, '0');
  return `<svg viewBox="0 0 24 24" class="ic" xmlns="http://www.w3.org/2000/svg" stroke-linecap="round">
    <path d="M4 21 L20 3.5" stroke="#3a2412" stroke-width="3.3"/><path d="M4 21 L20 3.5" stroke="${c(l.blank)}" stroke-width="2"/>
    <path d="M8.2 16.4 l0.9 0.9 M11.4 12.9 l0.9 0.9 M14.6 9.4 l0.9 0.9" stroke="${c(l.node)}" stroke-width="1.2"/>
    <path d="M18.6 5 L20 3.5" stroke="${c(l.wrap)}" stroke-width="2.2"/>
    <path d="M3.6 21.4 L7.4 17.2" stroke="#5a3a1a" stroke-width="3.8"/><path d="M3.6 21.4 L7.4 17.2" stroke="#d8a070" stroke-width="2.4"/>
    <circle cx="8.6" cy="18.2" r="2.1" fill="#e8b850" stroke="#6a4a1a" stroke-width="1"/>
    <path d="M20 3.5 Q21.5 9 20.2 14.2" stroke="#f4f4f4" stroke-width="0.7" fill="none"/>
  </svg>`;
}

export class TackleScreen extends Screen {
  private list!: HTMLElement;
  private purse!: HTMLElement;
  private skill!: HTMLElement;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hvf-tackle', { backdrop: true });
  }

  protected render(): void {
    this.root.querySelector('.u-pop')?.remove();
    const wrap = el('div', 'hvf-tackle-wrap u-pop');
    const { frame: f, body } = frame('Bait &amp; Tackle', 'hvf-tackle-frame');
    f.appendChild(closeButton(() => this.requestClose()));
    const left = el('div', 'hvf-tk-left');
    left.innerHTML = `<div class="hvf-tk-note"><b>Honesty box</b><p>Gone out on the tide. Take what you need, leave the coins in the tin. Mind the gulls.</p><i>— W.</i></div>`;
    this.skill = el('div', 'hvf-tk-skill');
    this.purse = el('div', 'hvf-tk-purse');
    left.append(this.skill, this.purse);
    this.list = el('div', 'hvf-tk-list');
    body.append(left, this.list);
    wrap.appendChild(f);
    this.root.appendChild(wrap);
    this.build();
  }

  private build(): void {
    const fishing = this.game.services.fishing;
    const lv = fishing?.level() ?? 0;
    const xp = fishing?.xp() ?? 0;
    const tier = fishing?.rodTier() ?? 0;
    const lo = FISHING_XP[lv]!;
    const hi = FISHING_XP[Math.min(FISHING_XP.length - 1, lv + 1)]!;
    const frac = hi > lo ? (xp - lo) / (hi - lo) : 1;
    this.skill.innerHTML = `<div class="rod">${rodIcon(tier)}<div><b>${escapeHtml(ROD_TIERS[tier]!.name)}</b><small>Fishing Lv ${lv}${lv < 10 ? ` · ${Math.max(0, hi - xp)} XP to Lv ${lv + 1}` : ' · Master'}</small></div></div>
      <div class="bar"><i style="width:${Math.round(frac * 100)}%"></i></div>`;
    const gold = this.game.services.economy?.gold() ?? 0;
    this.purse.innerHTML = `${ICONS.coin ?? ''}<span>${gold.toLocaleString()}</span><small>your purse</small>`;
    this.list.innerHTML = '';
    TACKLE_GOODS.forEach((g, i) => {
      const rodTier = g.kind === 'rod' ? Number(g.id.slice(3)) : -1;
      const owned = g.kind === 'rod' && tier >= rodTier;
      const locked = lv < g.level;
      const name = g.kind === 'rod' ? ROD_TIERS[rodTier]!.name : `${itemDef(g.id)?.name ?? g.id}${g.qty > 1 ? ` ×${g.qty}` : ''}`;
      const icon = g.kind === 'rod' ? rodIcon(rodTier) : itemIcon(g.id);
      const afford = gold >= g.price;
      const state = owned ? 'owned' : locked ? 'locked' : afford ? '' : 'poor';
      const row = el(
        'div',
        `hvf-tk-row ${state}`,
        `<div class="u-slot mini">${icon}</div>
         <div class="nm"><b>${escapeHtml(name)}</b><small>${locked && !owned ? `Needs Fishing Lv ${g.level}` : escapeHtml(g.note)}</small></div>
         <button class="u-btn small green buy${owned || locked || !afford ? ' disabled' : ''}" data-nav>${owned ? 'Owned' : `${ICONS.coin ?? ''}<span>${g.price.toLocaleString()}</span>`}</button>`,
      );
      row.style.animationDelay = `${i * 30}ms`;
      row.querySelector('.buy')!.addEventListener('click', () => this.buy(i));
      if (g.kind === 'item') {
        row.addEventListener('pointerenter', () => tooltip.show(`<b>${escapeHtml(name)}</b><br>${escapeHtml(itemDef(g.id)?.description ?? '')}`));
        row.addEventListener('pointerleave', () => tooltip.hide());
      }
      this.list.appendChild(row);
    });
    this.nav.attach(this.root, this.list.querySelector<HTMLElement>('.buy:not(.disabled)'));
  }

  private buy(i: number): void {
    const g = TACKLE_GOODS[i]!;
    const fishing = this.game.services.fishing;
    const eco = this.game.services.economy;
    if (!fishing || !eco) return;
    const rodTier = g.kind === 'rod' ? Number(g.id.slice(3)) : -1;
    if (fishing.level() < g.level || (g.kind === 'rod' && fishing.rodTier() >= rodTier)) return;
    if (!eco.spend(g.price, 'tackle')) {
      sfx(this.game, 'error');
      return;
    }
    if (g.kind === 'rod') {
      fishing.upgradeRod(rodTier);
      this.game.events.emit('ui:toast', { text: `Your rod is now a ${ROD_TIERS[rodTier]!.name}!`, kind: 'good' });
    } else {
      this.game.events.emit('item:give', { itemId: g.id, qty: g.qty });
    }
    sfx(this.game, 'buy');
    this.build();
  }
}
