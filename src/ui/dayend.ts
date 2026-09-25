/**
 * End of day ('dayend'; opened by `sleep:summary`, or `dayend` alone for a staged sample):
 * a painted moonlit valley over the sleeping farm (dayend-art.ts: layered, rim-lit, pointer parallax, fireflies,
 * chimney smoke, glowing windows), and an opaque ledger card that springs up from below —
 * shipped items tick in one by one grouped by category, the day's earnings count up with a coin shower,
 * pass-out penalty, the purse, tomorrow's forecast + birthdays, then "Good morning". Autosaves overnight.
 * A day with nothing shipped collapses the ledger into a "quiet day" vignette with a rest + forecast card.
 * `dayend:quiet` stages that variant.
 */
import type { Game } from '../core/game';
import { itemDef } from '../data/items';
import { NPCS } from '../data/npcs';
import { ICONS, itemIcon, itemIconUrl, itemCategory, qualityStar } from './icons';
import { Screen, el, sfx, rollTo, replay, escapeHtml } from './kit';
import { nightValleySvg, quietVignetteSvg } from './dayend-art';

interface Summary {
  passedOut: boolean;
  shipped: number;
  penalty: number;
  day: number;
  /** Staged preview (`ui=dayend`): the calendar has not rolled over yet. */
  sample?: boolean;
  /** The herd's night (systems/sleep.ts carries `animals:summary` in; absent without animals). */
  animals?: {
    total: number;
    fed: number;
    hungry: number;
    hungryNames: string[];
    petted: number;
    produce: { item: string; q: number }[];
    pet?: { name: string; species: string; bowl: boolean };
    chores?: { icon: string; text: string }[];
  };
}

type Line = { itemId: string; qty: number; value: number };

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };
const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const GROUP_ORDER = ['Farming', 'Foraging', 'Fishing', 'Mining', 'Other'];
const ALMANAC: Record<string, string[]> = {
  spring: ['Parsnips forgive a late watering. Cauliflower does not.', 'Plant on a rainy morning and let the sky do the work.', 'Strawberries come back, if you’re patient with them.'],
  summer: ['Water before the sun climbs over the ridge.', 'A sprinkler is worth a hundred trips to the well.', 'The river trout rise at dusk — bring your rod.'],
  fall: ['Pumpkins like room. Give them a little more than you think.', 'Stack wood now; winter comes quicker than you’d like.', 'The forest drops its best gifts after a wind.'],
  winter: ['Snow is a blanket, not an ending. Plan the spring beds.', 'The mines are warm in winter. Mind the slimes.', 'Visit folk. A kind word keeps longer than jam.'],
};
const GROUP_ICON: Record<string, string> = { Farming: 'sprout', Foraging: 'bag', Fishing: 'map', Mining: 'hammer', Other: 'coin' };

export class DayEndScreen extends Screen {
  private lastItems: { day: number; items: Line[] } | null = null;
  private timers: number[] = [];

  private worldReady = false;
  /** The farm at dusk, grabbed from the live renderer (evening, on the farm): the day-end backdrop. */
  private dusk: { cv: HTMLCanvasElement; day: number; hour: number } | null = null;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-dayend', {});
    game.events.on('shipping:summary', ({ items }) => (this.lastItems = { day: game.calendar.day, items }));
    game.events.on('game:ready', () => (this.worldReady = true));
    // Once per in-game hour after 5pm on the farm (one extra frame render, ~every 40 s of play): keep the
    // latest evening view of *this* farm for tonight's summary. Nothing in the menus or while faded to black.
    game.events.on('time:hour', ({ hour }) => {
      if (hour < 17 || game.world.current?.id !== 'farm' || game.hud.openPanelName) return;
      const cv = this.grab();
      if (cv) this.dusk = { cv, day: game.calendar.day, hour };
    });
  }

  /**
   * Render one frame and copy it (pre-blurred, 640×360) off the WebGL canvas; null for a black frame. The DOM
   * sleep fade sits above the canvas, so a frame grabbed while faded is still the world.
   */
  private grab(): HTMLCanvasElement | null {
    if (!this.worldReady) return null;
    try {
      const rc = this.game.rc as unknown as { backdropHz?: number };
      const hz = rc.backdropHz;
      if (hz !== undefined) rc.backdropHz = 0;
      this.game.rc.render(0, this.game.time);
      if (hz !== undefined) rc.backdropHz = hz;
      const src = this.game.rc.renderer.domElement;
      const cv = document.createElement('canvas');
      cv.width = 640;
      cv.height = 360;
      const g = cv.getContext('2d', { willReadFrequently: true });
      if (!g) return null;
      const k = Math.min(src.width / 16, src.height / 9);
      g.filter = 'blur(2.5px) saturate(0.9)';
      g.drawImage(src, (src.width - k * 16) / 2, (src.height - k * 9) / 2, k * 16, k * 9, -8, -5, 656, 370);
      g.filter = 'none';
      // Reject black frames (mid-fade, shader compile) and flat ones (the clear colour before the world loads).
      const px = g.getImageData(0, 0, 640, 360).data;
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 4 * 97) {
        const l = px[i]! * 0.3 + px[i + 1]! * 0.59 + px[i + 2]! * 0.11;
        sum += l;
        sq += l * l;
        n++;
      }
      const mean = sum / Math.max(1, n);
      const sd = Math.sqrt(Math.max(0, sq / Math.max(1, n) - mean * mean));
      return mean < 10 || sd < 9 ? null : cv;
    } catch {
      return null;
    }
  }

  /** Outdoors right now (passed out in a field, or the staged demo): the live world is tonight's backdrop. */
  private outdoors(s: Summary): boolean {
    const here = this.game.world.current?.id ?? '';
    return here === 'farm' || (s.passedOut && !!here && here !== 'house' && !here.startsWith('mine'));
  }

  /** Tonight's backdrop frame: the world right now if we're outdoors (passed out, staged demo), else the dusk grab. */
  private backdrop(s: Summary): { cv: HTMLCanvasElement; day: boolean } | null {
    if (this.outdoors(s)) {
      const cv = this.grab();
      if (cv) {
        const h = this.game.calendar.hour;
        return { cv, day: h >= 5.5 && h < 18.5 };
      }
    }
    if (this.dusk && this.game.calendar.day - this.dusk.day <= 1) return { cv: this.dusk.cv, day: this.dusk.hour < 18 };
    return null;
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
    this.root.querySelectorAll('.de-bg, .de-sky, .de-card, .de-land, .de-flies').forEach((n) => n.remove());
    let s: Summary;
    let items: Line[];
    if (arg && arg.startsWith('{')) {
      s = JSON.parse(arg) as Summary;
      items = this.lastItems && this.lastItems.day === s.day ? this.lastItems.items : [];
    } else if (arg === 'quiet') {
      s = { passedOut: false, shipped: 0, penalty: 0, day: this.game.calendar.day, sample: true };
      items = [];
    } else ({ s, items } = this.sample());
    const c = this.game.calendar;
    const endedSeason = c.day === 1 && s.day === 28 ? (['winter', 'spring', 'summer', 'fall'][['spring', 'summer', 'fall', 'winter'].indexOf(c.season)] ?? c.season) : c.season;

    // Night backdrop: gradient sky, twinkling stars + a shooting star, the painted valley, fireflies in front.
    const bg = el('div', 'de-bg');
    const sky = el('div', 'de-sky');
    const stars = Array.from({ length: 150 }, (_, i) => {
      const x = (i * 73.13) % 100;
      const y = ((i * 37.7) % 58) + (i % 3);
      const sz = 0.8 + ((i * 7) % 4) * 0.55;
      return `<i style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation-delay:${-(i % 11) * 0.37}s;opacity:${0.45 + ((i * 13) % 10) / 18}"></i>`;
    }).join('');
    sky.innerHTML = `<div class="stars">${stars}</div><div class="shoot"></div>`;
    const land = el('div', 'de-land', nightValleySvg(7 + (s.day % 5), endedSeason));
    const flies = el(
      'div',
      'de-flies',
      Array.from({ length: 22 }, (_, i) => `<b style="left:${(i * 61 + 7) % 100}%;top:${66 + ((i * 29) % 30)}%;animation-delay:${-(i * 0.9)}s;animation-duration:${6 + (i % 5)}s;scale:${0.6 + (i % 4) * 0.2}"></b>`).join(''),
    );
    // The living-diorama backdrop: tonight's farm itself (a soft, moonlit, slowly drifting frame of the real 3D
    // world) — the painted valley stands in only when there's no frame of this farm to show.
    let layers: { g: HTMLElement | SVGGElement; d: number }[] = [];
    const usePhoto = (shot: { cv: HTMLCanvasElement; day: boolean }, late = false): void => {
      land.className = `de-land de-photo${shot.day ? ' d2n' : ''}${late ? ' late' : ''}`;
      land.innerHTML = '<div class="de-l ph" data-depth="16"></div><div class="de-grade"></div><div class="de-moon"></div>';
      land.querySelector('.ph')!.appendChild(shot.cv);
      sky.classList.add('photo');
      layers = [...land.querySelectorAll<HTMLElement>('.de-l')].map((g) => ({ g, d: Number(g.dataset.depth ?? 0) }));
    };
    const shot = this.backdrop(s);
    if (shot) usePhoto(shot);
    else if (this.outdoors(s)) {
      // The world isn't on screen yet (staged straight from the URL): keep trying for a few seconds, then
      // cross-fade from the painted valley to the real farm.
      let tries = 0;
      const again = (): void => {
        if (!land.isConnected && tries > 0) return;
        const cv = this.grab();
        if (cv) {
          const h = this.game.calendar.hour;
          return usePhoto({ cv, day: h >= 5.5 && h < 18.5 }, true);
        }
        if (++tries < 24) this.timers.push(window.setTimeout(again, 500));
      };
      this.timers.push(window.setTimeout(again, 400));
    }
    if (!layers.length) layers = [...land.querySelectorAll<SVGGElement>('.de-l')].map((g) => ({ g, d: Number(g.dataset.depth ?? 0) }));
    let raf = 0;
    this.root.onpointermove = (e) => {
      const px = e.clientX / innerWidth - 0.5;
      const py = e.clientY / innerHeight - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        for (const { g, d } of layers) g.style.transform = `translate(${(-px * d * 0.9).toFixed(1)}px, ${(-py * d * 0.3).toFixed(1)}px)`;
      });
    };

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
      ? `<div class="de-star"><div class="de-h">Pick of the day</div><div class="st"><div class="u-slot">${itemIcon(best.itemId)}</div><div class="tx"><b>${escapeHtml(itemDef(best.itemId)?.name ?? best.itemId)}</b><small>×${best.qty} · ${best.value.toLocaleString()}g</small></div><span class="medal">${ICONS.sun}</span></div><div class="de-count"><span><b class="cn" data-v="0">0</b> items shipped</span><span><b class="kn" data-v="0">0</b> kinds</span></div></div>`
      : '';
    const title = s.passedOut ? 'You passed out…' : `Day ${s.day} complete`;
    const quiet = !items.length;
    const en = this.game.services.energy;
    const eMax = en?.max() ?? 270;
    const eNow = s.passedOut ? Math.round(eMax * 0.5) : eMax;
    const gold = (this.game.services.economy?.gold() ?? 0) + (s.sample ? total : 0);
    const tmrCard = `<div class="de-tmr"><div class="de-h">Tomorrow</div><div class="fc"><span class="ic">${ICONS[w] ?? ICONS.sun}</span><div><b>${tomorrow}</b><small>${forecast}</small></div></div>${bdays.length ? `<div class="fc"><span class="ic">${ICONS.heart}</span><div><b>${escapeHtml(bdays.join(' & '))}’s birthday</b><small>bring a gift!</small></div></div>` : ''}</div>`;
    const penCard = s.passedOut
      ? `<div class="de-pen"><b>−${s.penalty.toLocaleString()}g</b><small>A neighbour found you asleep in the field and carried you home. They kept a little for the trouble.</small></div>`
      : '';
    // Animals: fed / produce tally, the morning's produce with quality stars, hungry names, the pet's bowl.
    const an = s.animals;
    const animalsCard = an && an.total
      ? (() => {
          const gold = an.produce.filter((p) => p.q >= 2).length;
          const icons = an.produce
            .slice(0, 8)
            .map((p) => `<div class="u-slot mini" style="width:40px;height:40px;border-radius:9px">${itemIcon(p.item)}${qualityStar(p.q)}</div>`)
            .join('');
          const hungry = an.hungry
            ? `<small style="display:block;margin-top:5px;color:#b8321e;font-weight:800">${escapeHtml(an.hungryNames.slice(0, 3).join(', '))}${an.hungry > 3 ? ` +${an.hungry - 3}` : ''} went hungry — fill the trough</small>`
            : '';
          const pet = an.pet ? `<small style="display:block;margin-top:3px;color:#8a6440;font-weight:700">${escapeHtml(an.pet.name)}’s bowl was ${an.pet.bowl ? 'full' : 'empty'}${an.pet.bowl ? ' ♥' : ''}</small>` : '';
          return `<div class="de-animals" style="margin-top:12px;padding:10px 12px;border-radius:14px;background:rgba(255,252,240,.72);box-shadow:inset 0 0 0 2px rgba(138,100,64,.2)">
            <div class="de-h" style="margin-bottom:4px">Animals</div>
            <div style="display:flex;gap:14px;align-items:baseline;font-weight:800;color:#8a6440"><span><b style="font-family:var(--font-head);font-size:21px;color:var(--ink)">${an.fed}/${an.total}</b> fed</span><span><b style="font-family:var(--font-head);font-size:21px;color:var(--ink)">${an.produce.length}</b> produce</span>${gold ? `<span><b style="font-family:var(--font-head);font-size:21px;color:#b8860b">${gold}</b> gold-star</span>` : ''}<span><b style="font-family:var(--font-head);font-size:21px;color:var(--ink)">${an.petted}</b> petted</span></div>
            ${icons ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${icons}</div>` : ''}
            ${hungry}${pet}
          </div>`;
        })()
      : '';
    // Tomorrow's chores (animals): fills the side column on a quiet day.
    const chores = an?.chores ?? [];
    const choresCard = chores.length
      ? `<div class="de-chores" style="margin-top:10px;padding:9px 12px 10px;border-radius:14px;background:rgba(255,252,240,.6);box-shadow:inset 0 0 0 2px rgba(138,100,64,.16)">
          <div class="de-h" style="margin-bottom:5px">Tomorrow’s chores</div>
          ${chores
            .map(
              (c, i) =>
                `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-weight:800;font-size:14px;color:#6a4424;${i ? 'border-top:1px dashed rgba(138,100,64,.25);' : ''}"><span style="flex:0 0 24px;height:24px;display:grid;place-items:center">${c.icon === 'heart' ? (ICONS.heart ?? '').replace('<svg ', '<svg style="width:20px;height:20px" ') : `<img src="${itemIconUrl(c.icon)}" alt="" style="width:24px;height:24px"/>`}</span><span style="flex:1;min-width:0">${escapeHtml(c.text)}</span><span style="flex:0 0 14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 2px rgba(122,74,34,.45)"></span></div>`,
            )
            .join('')}
        </div>`
      : '';
    const body = quiet
      ? `<div class="de-body quiet">
          <div class="de-quiet"><div class="qv-art">${quietVignetteSvg()}</div><div class="qv-tx"><h3>${animalsCard ? 'A day with the animals' : 'A quiet day'}</h3><p>${animalsCard ? 'Nothing went in the shipping bin, but the coop and the barn kept you busy.' : 'Nothing went in the shipping bin — and that’s alright. The valley keeps its own pace.'}</p><small>Produce left in the bin by the porch is collected overnight.</small>${animalsCard}</div></div>
          <div class="de-side">
            ${penCard}
            <div class="de-rest"><div class="de-h">Rest</div><div class="bar"><i style="--e:${(eNow / eMax).toFixed(3)}"></i></div><div class="rl"><span>${ICONS.bolt ?? ''}Energy</span><b><span class="ev" data-v="0">0</span> / ${eMax}</b></div><small>${s.passedOut ? 'You slept where you fell — half your energy returns.' : 'A full night’s sleep. You wake refreshed.'}</small></div>
            ${tmrCard}
            <div class="de-purse"><span>Purse</span><b>${ICONS.coin}<span class="pv">${gold.toLocaleString()}</span>g</b></div>
            ${choresCard}
            <div class="de-note"><small>From Grandmother’s almanac</small><p>${(ALMANAC[tSeason] ?? ALMANAC.spring!)[s.day % 3]}</p></div>
          </div>
        </div>`
      : `<div class="de-body">
        <div class="de-ledger">
          <div class="de-h">Shipped today</div>
          <div class="de-rows fit${k > 9 ? ' dense' : ''}"${animalsCard ? ' style="height:250px"' : ''}>${rows.join('')}</div>
          ${animalsCard}
        </div>
        <div class="de-side">
          <div class="de-earn"><div class="de-h">Earnings</div><div class="amt">${ICONS.coin}<span class="v" data-v="0">0</span><small>g</small></div></div>
          ${penCard}
          <div class="de-purse"><span>Purse</span><b>${ICONS.coin}<span class="pv" data-v="${Math.max(0, gold - total)}">${Math.max(0, gold - total).toLocaleString()}</span>g</b></div>
          ${star}
          ${tmrCard}
        </div>
      </div>`;
    card.innerHTML = `
      <div class="u-ribbon"><span>${title}</span></div>
      <div class="de-head"><span>${SEASON_NAME[endedSeason]} ${s.day}, Year ${c.year}</span><span class="saving">${ICONS.save}<em>Saving…</em></span></div>
      ${body}
      <div class="de-foot"><span class="zz">z<i>z</i><b>z</b></span><button class="u-btn green is-default" data-nav>${ICONS.sun}<span>Good morning</span></button></div>`;
    card.classList.toggle('quiet', quiet);
    this.root.append(bg, sky, land, flies, card);
    card.querySelector('button')!.addEventListener('click', () => this.requestClose());

    // Choreography: rows tick in, then the total counts up with coins.
    const n = k;
    const rowT = Math.min(110, 1400 / Math.max(1, n));
    const box = (card.querySelector('.de-rows') as HTMLElement | null) ?? el('div');
    const syncFade = (): void => {
      box.classList.toggle('more', box.scrollHeight > box.clientHeight + 4);
      box.classList.toggle('end', box.scrollTop + box.clientHeight >= box.scrollHeight - 4);
      box.classList.toggle('top', box.scrollTop > 4);
    };
    box.addEventListener('scroll', syncFade, { passive: true });
    requestAnimationFrame(syncFade);
    const lines = [...card.querySelectorAll<HTMLElement>('.de-grp, .de-row')];
    // The ledger starts ticking as the card lands (no blank left column while the right one fills).
    const t0 = 420;
    lines.forEach((r, i) => {
      r.style.animationDelay = `${t0 + i * rowT}ms`;
      this.timers.push(
        window.setTimeout(() => {
          sfx(this.game, 'tick');
          // Keep the newest ledger line in view while the list ticks in — scrolled to a whole line, so the
          // top of the ledger never shows half a row.
          if (r.offsetTop + r.offsetHeight <= box.scrollTop + box.clientHeight - 6) return;
          const want = r.offsetTop + r.offsetHeight - box.clientHeight + 10;
          const top = lines.find((l) => l.offsetTop >= want - 10);
          if (top) box.scrollTop = top.offsetTop - 10;
        }, t0 + i * rowT),
      );
    });
    // Rest: the energy number fills in step with its bar (same delay and length as the CSS fill).
    const ev = card.querySelector<HTMLElement>('.de-rest .ev');
    if (ev) this.timers.push(window.setTimeout(() => rollTo(ev, eNow, 1300, (v) => String(v)), 500));
    // The card springs up at ~0.35 s; rows tick in as it lands.
    const tEarn = t0 + 150 + n * rowT;
    (card.querySelector('.de-star') as HTMLElement | null)?.style.setProperty('--d', `${tEarn + 250}ms`);
    this.timers.push(
      window.setTimeout(() => {
        const v = card.querySelector('.de-earn .v') as HTMLElement | null;
        if (v) rollTo(v, total, 1100);
        const cn = card.querySelector('.de-count .cn') as HTMLElement | null;
        const kn = card.querySelector('.de-count .kn') as HTMLElement | null;
        if (cn) rollTo(cn, count, 900);
        if (kn) rollTo(kn, items.length, 600);
        const pv = card.querySelector('.de-purse .pv') as HTMLElement | null;
        if (pv && total > 0) this.timers.push(window.setTimeout(() => (rollTo(pv, gold, 900), replay(card.querySelector('.de-purse'), 'bump')), 1150));
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
