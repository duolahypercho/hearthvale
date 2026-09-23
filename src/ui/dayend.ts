/**
 * End of day ('dayend'; opened by `sleep:summary`, or `dayend` alone for a staged sample):
 * a starry night over the sleeping farm (moon, drifting fireflies, lit window), and a ledger card —
 * shipped items tick in one by one grouped by category, the day's earnings count up with a coin shower,
 * pass-out penalty, the purse, tomorrow's forecast + birthdays, then "Good morning". Autosaves overnight.
 */
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { NPCS } from '../data/npcs';
import { ICONS, itemIcon, itemCategory } from './icons';
import { Screen, el, sfx, rollTo, replay, escapeHtml } from './kit';

interface Summary {
  passedOut: boolean;
  shipped: number;
  penalty: number;
  day: number;
  /** Staged preview (`ui=dayend`): the calendar has not rolled over yet. */
  sample?: boolean;
}

type Line = { itemId: string; qty: number; value: number };

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };
const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const GROUP_ORDER = ['Farming', 'Foraging', 'Fishing', 'Mining', 'Other'];
const GROUP_ICON: Record<string, string> = { Farming: 'sprout', Foraging: 'bag', Fishing: 'map', Mining: 'hammer', Other: 'coin' };

export class DayEndScreen extends Screen {
  private lastItems: { day: number; items: Line[] } | null = null;
  private timers: number[] = [];

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-dayend', {});
    game.events.on('shipping:summary', ({ items }) => (this.lastItems = { day: game.calendar.day, items }));
  }

  private sample(): { s: Summary; items: Line[] } {
    const want: [string, number][] = [
      ['parsnip', 14],
      ['cauliflower', 3],
      ['potato', 9],
      ['strawberry', 6],
      ['kale', 4],
      ['cockle', 2],
      ['pondPerch', 1],
      ['wood', 40],
      ['fiber', 12],
    ];
    const items = want.filter(([id]) => itemDef(id)).map(([id, qty]) => ({ itemId: id, qty, value: (itemDef(id)?.sell ?? 0) * qty }));
    const total = items.reduce((a, b) => a + b.value, 0);
    return { s: { passedOut: false, shipped: total, penalty: 0, day: this.game.calendar.day, sample: true }, items };
  }

  protected render(arg?: string): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.root.querySelectorAll('.de-sky, .de-card, .de-land').forEach((n) => n.remove());
    let s: Summary;
    let items: Line[];
    if (arg && arg.startsWith('{')) {
      s = JSON.parse(arg) as Summary;
      items = this.lastItems && this.lastItems.day === s.day ? this.lastItems.items : [];
    } else ({ s, items } = this.sample());
    const c = this.game.calendar;
    const endedSeason = c.day === 1 && s.day === 28 ? (['winter', 'spring', 'summer', 'fall'][['spring', 'summer', 'fall', 'winter'].indexOf(c.season)] ?? c.season) : c.season;

    // Sky, stars, moon, fireflies, sleeping farm silhouette.
    const sky = el('div', 'de-sky');
    const stars = Array.from({ length: 90 }, (_, i) => {
      const x = (i * 73.13) % 100;
      const y = ((i * 37.7) % 62) + (i % 3);
      const sz = 1 + ((i * 7) % 3) * 0.7;
      return `<i style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation-delay:${-(i % 11) * 0.37}s"></i>`;
    }).join('');
    const flies = Array.from({ length: 16 }, (_, i) => `<b style="left:${(i * 61) % 100}%;top:${62 + ((i * 29) % 30)}%;animation-delay:${-(i * 0.9)}s;animation-duration:${6 + (i % 5)}s"></b>`).join('');
    sky.innerHTML = `<div class="stars">${stars}</div><div class="moon"></div><div class="flies">${flies}</div>`;
    const land = el(
      'div',
      'de-land',
      `<svg viewBox="0 0 1600 300" preserveAspectRatio="none"><path d="M0 170 C200 110 380 130 560 160 C760 196 900 120 1100 130 C1300 140 1450 100 1600 120 V300 H0 Z" fill="#1a2440"/><path d="M0 230 C240 190 520 206 800 220 C1080 234 1340 196 1600 210 V300 H0 Z" fill="#121a30"/>
      <g transform="translate(1180 150)"><rect x="-60" y="-10" width="120" height="70" fill="#1c2238"/><path d="M-76 -6 L0 -64 L76 -6 Z" fill="#241a2a"/><rect x="18" y="8" width="22" height="20" fill="#ffcf6a" class="win"/><rect x="-44" y="8" width="22" height="20" fill="#3a3050"/><rect x="36" y="-58" width="14" height="30" fill="#1c2238"/></g>
      ${Array.from({ length: 12 }, (_, i) => `<g transform="translate(${80 + i * 128 + ((i * 37) % 40)} ${190 + (i % 3) * 8})"><circle r="${22 + (i % 3) * 6}" fill="#0f1628"/><rect x="-3" y="10" width="6" height="30" fill="#0f1628"/></g>`).join('')}</svg>`,
    );

    // Ledger card.
    const card = el('div', 'de-card');
    const groups = new Map<string, Line[]>();
    for (const it of items) {
      const g = itemCategory(it.itemId).group;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(it);
    }
    const total = s.shipped || items.reduce((a, b) => a + b.value, 0);
    const rows: string[] = [];
    let k = 0;
    for (const g of GROUP_ORDER) {
      const list = groups.get(g);
      if (!list) continue;
      const sub = list.reduce((a, b) => a + b.value, 0);
      rows.push(`<div class="de-grp" style="--i:${k++}"><span>${ICONS[GROUP_ICON[g]!] ?? ''}${g}</span><b>${sub.toLocaleString()}g</b></div>`);
      for (const it of list.sort((a, b) => b.value - a.value)) {
        const d = itemDef(it.itemId);
        rows.push(`<div class="de-row" style="--i:${k++}"><div class="u-slot mini">${itemIcon(it.itemId)}</div><span class="nm">${escapeHtml(d?.name ?? it.itemId)}</span><span class="q">×${it.qty}</span><b>${it.value.toLocaleString()}g</b></div>`);
      }
    }
    // A real summary arrives after the calendar rolled over; the staged sample shows the day after today.
    const tDay = s.sample ? (c.day % 28) + 1 : c.day;
    const tSeason = s.sample && c.day === 28 ? (['summer', 'fall', 'winter', 'spring'][['spring', 'summer', 'fall', 'winter'].indexOf(c.season)] ?? c.season) : c.season;
    const tomorrow = `${WEEKDAY[(tDay - 1) % 7]}, ${SEASON_NAME[tSeason]} ${tDay}`;
    const bdays = Object.values(NPCS)
      .filter((n) => {
        const b = (n as { birthday?: { season: string; day: number } }).birthday;
        return b && b.season === tSeason && b.day === tDay;
      })
      .map((n) => n.name.split(' ')[0]!);
    const w = c.weather;
    const forecast = w === 'sun' ? 'Sunny and mild' : w === 'rain' ? 'Rain all day — no watering needed' : w === 'storm' ? 'Thunderstorms. Stay near home' : w === 'snow' ? 'Snow on the fields' : 'A breezy day';
    // Pick of the day: the most valuable line in the bin, plus the day's tally.
    const best = [...items].sort((a, b) => b.value - a.value)[0];
    const count = items.reduce((a, b) => a + b.qty, 0);
    const star = best
      ? `<div class="de-star"><div class="de-h">Pick of the day</div><div class="st"><div class="u-slot">${itemIcon(best.itemId)}</div><div class="tx"><b>${escapeHtml(itemDef(best.itemId)?.name ?? best.itemId)}</b><small>×${best.qty} · ${best.value.toLocaleString()}g</small></div><span class="medal">${ICONS.sun}</span></div><div class="de-count"><span><b>${count.toLocaleString()}</b> items shipped</span><span><b>${items.length}</b> kinds</span></div></div>`
      : '';
    const title = s.passedOut ? 'You passed out…' : `Day ${s.day} complete`;
    card.innerHTML = `
      <div class="u-ribbon"><span>${title}</span></div>
      <div class="de-head"><span>${SEASON_NAME[endedSeason]} ${s.day}, Year ${c.year}</span><span class="saving">${ICONS.save}<em>Saving…</em></span></div>
      <div class="de-body">
        <div class="de-ledger">
          <div class="de-h">Shipped today</div>
          <div class="de-rows">${rows.join('') || `<div class="de-empty">${itemIcon('parsnip')}<p>Nothing in the shipping bin today.<br/><small>Drop produce in the bin by the porch — it’s collected overnight.</small></p></div>`}</div>
        </div>
        <div class="de-side">
          <div class="de-earn"><div class="de-h">Earnings</div><div class="amt">${ICONS.coin}<span class="v" data-v="0">0</span><small>g</small></div></div>
          ${s.passedOut ? `<div class="de-pen"><b>−${s.penalty.toLocaleString()}g</b><small>A neighbour found you asleep in the field and carried you home. They kept a little for the trouble.</small></div>` : ''}
          <div class="de-purse"><span>Purse</span><b>${ICONS.coin}${((this.game.services.economy?.gold() ?? 0) + (s.sample ? total : 0)).toLocaleString()}g</b></div>
          ${star}
          <div class="de-tmr"><div class="de-h">Tomorrow</div><div class="fc"><span class="ic">${ICONS[w] ?? ICONS.sun}</span><div><b>${tomorrow}</b><small>${forecast}</small></div></div>${bdays.length ? `<div class="fc"><span class="ic">${ICONS.heart}</span><div><b>${escapeHtml(bdays.join(' & '))}’s birthday</b><small>bring a gift!</small></div></div>` : ''}</div>
        </div>
      </div>
      <div class="de-foot"><span class="zz">z<i>z</i><b>z</b></span><button class="u-btn green is-default" data-nav>${ICONS.sun}<span>Good morning</span></button></div>`;
    this.root.append(sky, land, card);
    card.querySelector('button')!.addEventListener('click', () => this.requestClose());

    // Choreography: rows tick in, then the total counts up with coins.
    const n = k;
    const rowT = Math.min(110, 1400 / Math.max(1, n));
    const box = card.querySelector('.de-rows') as HTMLElement;
    const syncFade = (): void => {
      box.classList.toggle('more', box.scrollHeight > box.clientHeight + 4);
      box.classList.toggle('end', box.scrollTop + box.clientHeight >= box.scrollHeight - 4);
      box.classList.toggle('top', box.scrollTop > 4);
    };
    box.addEventListener('scroll', syncFade, { passive: true });
    requestAnimationFrame(syncFade);
    const lines = [...card.querySelectorAll<HTMLElement>('.de-grp, .de-row')];
    lines.forEach((r, i) => {
      r.style.animationDelay = `${500 + i * rowT}ms`;
      this.timers.push(
        window.setTimeout(() => {
          sfx(this.game, 'tick');
          // Keep the newest ledger line in view while the list ticks in — scrolled to a whole line, so the
          // top of the ledger never shows half a row.
          if (r.offsetTop + r.offsetHeight <= box.scrollTop + box.clientHeight - 6) return;
          const want = r.offsetTop + r.offsetHeight - box.clientHeight + 10;
          const top = lines.find((l) => l.offsetTop >= want - 10);
          if (top) box.scrollTop = top.offsetTop - 10;
        }, 500 + i * rowT),
      );
    });
    const tEarn = 600 + n * rowT;
    this.timers.push(
      window.setTimeout(() => {
        const v = card.querySelector('.de-earn .v') as HTMLElement;
        rollTo(v, total, 1100);
        // The ledger has ticked in: glide back to its first line (the bottom fade says there's more).
        if (box.scrollTop > 0) this.timers.push(window.setTimeout(() => box.scrollTo({ top: 0, behavior: 'smooth' }), 900));
        replay(card.querySelector('.de-earn'), 'go');
        if (total > 0) {
          sfx(this.game, 'coin');
          this.coinShower(card.querySelector('.de-earn') as HTMLElement);
        }
      }, tEarn),
    );
    // Overnight autosave (DESIGN pillar 12).
    this.timers.push(
      window.setTimeout(() => {
        const ok = this.game.saves.save('auto');
        const sv = card.querySelector('.saving');
        sv?.classList.add(ok ? 'done' : 'fail');
        const em = sv?.querySelector('em');
        if (em) em.textContent = ok ? 'Saved' : 'Not saved';
      }, 900),
    );
  }

  private coinShower(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    for (let i = 0; i < 18; i++) {
      const c = el('div', 'u-coinfly rain', ICONS.coin);
      c.style.left = `${r.left + 30 + Math.random() * (r.width - 60)}px`;
      c.style.top = `${r.top - 20}px`;
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 80}px`);
      c.style.setProperty('--dy', `${40 + Math.random() * 50}px`);
      c.style.setProperty('--arc', `${-50 - Math.random() * 70}px`);
      c.style.animationDelay = `${i * 40}ms`;
      document.getElementById('ui-root')?.appendChild(c);
      setTimeout(() => c.remove(), 1000 + i * 40);
    }
  }

  protected override onClose(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  override back(): boolean {
    return false;
  }
}
