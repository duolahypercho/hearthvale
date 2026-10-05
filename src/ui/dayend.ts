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
import { Screen, el, sfx, rollTo, replay, escapeHtml, shortName } from './kit';
import { nightValleySvg, quietVignetteSvg } from './dayend-art';
import { flyItemTo } from './item-fly';

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
    /** Eggs still in the nests from earlier days (apart from tonight's produce). */
    leftover?: number;
  };
}

type Line = { itemId: string; qty: number; value: number; quality?: number };

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };
const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const GROUP_ORDER = ['Farming', 'Foraging', 'Fishing', 'Mining', 'Other'];
const ALMANAC: Record<string, string[]> = {
  spring: ['Parsnips forgive a late watering. Cauliflower does not.', 'Plant on a rainy morning and let the sky do the work.', 'Strawberries come back, if you’re patient with them.'],
  summer: ['Water before the sun climbs over the ridge.', 'A sprinkler is worth a hundred trips to the well.', 'The river trout rise at dusk — bring your rod.'],
  fall: ['Pumpkins like room. Give them a little more than you think.', 'Stack wood now; winter comes quicker than you’d like.', 'The forest drops its best gifts after a wind.'],
  winter: ['Snow is a blanket, not an ending. Plan the spring beds.', 'The mines are warm in winter. Mind the slimes.', 'Visit folk. A kind word keeps longer than jam.'],
};
/** Fair-ribbon rosette for the day's best line (a sun here read as tomorrow's weather). */
const ROSETTE = `<svg viewBox="0 0 40 44" xmlns="http://www.w3.org/2000/svg"><path d="M13 22 L7 41 L13.5 37.5 L16.5 43 L21 25 Z" fill="#3f7fc4" stroke="#1d3f66" stroke-width="1.4" stroke-linejoin="round"/><path d="M27 22 L33 41 L26.5 37.5 L23.5 43 L19 25 Z" fill="#3474b8" stroke="#1d3f66" stroke-width="1.4" stroke-linejoin="round"/><path d="M20 2 L23.2 5.4 L27.8 4.4 L28.8 9 L33.2 10.8 L31.8 15.3 L34.6 19 L31.2 22.2 L31.6 26.9 L27 27.5 L24.6 31.6 L20 29.8 L15.4 31.6 L13 27.5 L8.4 26.9 L8.8 22.2 L5.4 19 L8.2 15.3 L6.8 10.8 L11.2 9 L12.2 4.4 L16.8 5.4 Z" fill="#f2b632" stroke="#8a5a0a" stroke-width="1.4" stroke-linejoin="round"/><circle cx="20" cy="17" r="8.6" fill="#ffe28a" stroke="#b07a14" stroke-width="1.3"/><path d="M20 11.4 L21.7 15 L25.6 15.4 L22.7 18 L23.5 21.9 L20 19.9 L16.5 21.9 L17.3 18 L14.4 15.4 L18.3 15 Z" fill="#fff6d0" stroke="#b07a14" stroke-width="1" stroke-linejoin="round"/><ellipse cx="15.5" cy="12" rx="3" ry="1.4" fill="#fff" opacity=".6" transform="rotate(-35 15.5 12)"/></svg>`;
/** r5: lifetime shipping milestones (the side column's progress bar). */
const MILESTONES: [number, string][] = [
  [1000, 'First thousand'],
  [5000, 'Market regular'],
  [15000, 'Trusted grower'],
  [40000, 'Valley supplier'],
  [100000, 'Harvest baron'],
  [250000, 'Legend of the valley'],
  [1e9, 'Legend of the valley'],
];
/** The shipping crate the ledger's lines fly into. */
const BIN_SVG = `<svg viewBox="0 0 48 44" xmlns="http://www.w3.org/2000/svg"><path d="M5 14 L43 14 L40 41 L8 41 Z" fill="#a8672e" stroke="#4a2810" stroke-width="2" stroke-linejoin="round"/><path d="M7 22 H41 M8 31 H40" stroke="#6e3c16" stroke-width="2"/><path d="M14 15 L16 40 M34 15 L32 40" stroke="#c98a4a" stroke-width="2.4" opacity=".7"/><path d="M3 9 Q24 1 45 9 L44 15 L4 15 Z" fill="#c8843c" stroke="#4a2810" stroke-width="2" stroke-linejoin="round"/><path d="M8 9.5 Q24 4 40 9.5" stroke="#f0c07a" stroke-width="2" fill="none" opacity=".8"/><circle cx="18" cy="11" r="3.4" fill="#e04a3a" stroke="#4a2810" stroke-width="1.3"/><circle cx="27" cy="9.5" r="3.6" fill="#f2c94c" stroke="#4a2810" stroke-width="1.3"/><path d="M33 12 q2 -6 6 -5 q-1 4 -6 5Z" fill="#5aa040" stroke="#2c5a1c" stroke-width="1.2"/></svg>`;
const GROUP_ICON: Record<string, string> = { Farming: 'sprout', Foraging: 'basket', Fishing: 'fish', Mining: 'pick', Other: 'coin' };

export class DayEndScreen extends Screen {
  private lastItems: { day: number; items: Line[] } | null = null;
  private timers: number[] = [];

  private worldReady = false;
  /** The farm at dusk, grabbed from the live renderer (evening, on the farm): the day-end backdrop. */
  private dusk: { cv: HTMLCanvasElement; day: number; hour: number } | null = null;

  /** r5: each night's bin total (season-so-far strip + shipping milestones); saved with the farm. */
  private history: { y: number; s: string; d: number; g: number }[] = [];
  private lifetime = 0;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-dayend', {});
    game.saves.register('dayendLedger', {
      save: () => ({ history: this.history.slice(-120), lifetime: this.lifetime }),
      load: (d) => {
        const v = (d ?? {}) as { history?: DayEndScreen['history']; lifetime?: number };
        this.history = Array.isArray(v.history) ? v.history : [];
        this.lifetime = Number(v.lifetime) || 0;
      },
    });
    game.events.on('shipping:summary', ({ items }) => (this.lastItems = { day: game.calendar.day, items }));
    game.events.on('game:ready', () => (this.worldReady = true));
    // Once per in-game hour after 5pm on the farm (one extra frame render, ~every 40 s of play): keep the
    // latest evening view of *this* farm for tonight's summary. Nothing in the menus or while faded to black.
    // `ui-sleep` stages bed at dusk straight from the URL: take this evening's frame once the farm is on screen.
    game.events.on('demo:stage', ({ name }) => {
      if (name !== 'ui-sleep') return;
      let tries = 0;
      const take = (): void => {
        const cv = this.grab();
        if (cv) this.dusk = { cv, day: game.calendar.day, hour: Math.floor(game.calendar.hour) };
        else if (++tries < 12) window.setTimeout(take, 400);
      };
      window.setTimeout(take, 900);
    });
    // r5: the dusk hours only (17–20: lamps lit, sky still holding light) — a midnight grab made the ledger float
    // over a near-black field. A later hour is taken only when there's no frame of today yet.
    game.events.on('time:hour', ({ hour }) => {
      if (hour < 17 || game.world.current?.id !== 'farm' || game.hud.openPanelName) return;
      if (hour > 20 && this.dusk && this.dusk.day === game.calendar.day) return;
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
      // r4: progressive dual-filter blur (Kawase-style) instead of one big blur on a hard 4x downsample —
      // halve twice with high-quality smoothing, dip to 320x180 and come back up, so the moonlit frame is
      // soft bokeh rather than aliased mosaic blocks. (The film grain is a full-resolution CSS layer on top.)
      const pass = (w: number, h: number, from: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, filter = 'none', read = false): HTMLCanvasElement => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d', read ? { willReadFrequently: true } : undefined)!;
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = 'high';
        x.filter = filter;
        x.drawImage(from, sx, sy, sw, sh, 0, 0, w, h);
        return c;
      };
      const k = Math.min(src.width / 16, src.height / 9);
      const ox = (src.width - k * 16) / 2 + k * 0.2;
      const oy = (src.height - k * 9) / 2 + k * 0.12;
      // r5: a lighter blur (~40 %): the farmhouse, its lit windows and the bin still read as shapes behind the card.
      const half = pass(1280, 720, src, ox, oy, k * 15.6, k * 8.76);
      const quarter = pass(640, 360, half, 0, 0, 1280, 720, 'blur(0.6px)');
      const cv = pass(640, 360, quarter, 0, 0, 640, 360, 'blur(1.1px) saturate(1.05)', true);
      const g = cv.getContext('2d', { willReadFrequently: true });
      if (!g) return null;
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
      if (mean < 10 || sd < 9) return null;
      // A frame that is mostly one flat colour with a few specks (fog/sky with only the farmer drawn — the
      // world mid-swap at the overnight rollover) passes the sd test on the specks alone: reject it too.
      let flat = 0;
      for (let i = 0; i < px.length; i += 4 * 97) {
        const l = px[i]! * 0.3 + px[i + 1]! * 0.59 + px[i + 2]! * 0.11;
        if (Math.abs(l - mean) < 14) flat++;
      }
      return flat / Math.max(1, n) > 0.8 ? null : cv;
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
    // A real night's summary arrives after the calendar rolled over (world mid-swap, clock at 6am): this
    // evening's grab of the farm is the truthful picture; the live frame is only for the staged sample.
    const recent = this.dusk && (this.game.calendar.day - this.dusk.day + 28) % 28 <= 1 ? this.dusk : null;
    if (!s.sample && recent) return { cv: recent.cv, day: recent.hour < 18 };
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

  private sample(big = false): { s: Summary; items: Line[] } {
    // `dayend:big` (r5): a harvest-festival bin of ~20 kinds — the ledger goes two-column and never hides a line.
    const extra: [string, number][] = big
      ? [['greenBean', 18], ['egg', 6], ['brownEgg', 4], ['milk', 3], ['wool', 2], ['truffle', 1], ['copperOre', 12], ['ironOre', 5], ['quartz', 2], ['amethyst', 1], ['coal', 6], ['stone', 30], ['morel', 3], ['chanterelle', 2], ['hazelnut', 9]]
      : [];
    const want: [string, number][] = [
      ...extra,
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
    // A staged evening's bin: a few quality pulls (silver strawberries, gold cauliflower) so the stars show.
    const q: Record<string, number> = { strawberry: 1, cauliflower: 2, pondPerch: 1 };
    const items = want
      .filter(([id]) => itemDef(id))
      .map(([id, qty]) => {
        const ql = q[id] ?? 0;
        const value = Math.floor((itemDef(id)?.sell ?? 0) * (ql === 1 ? 1.25 : ql === 2 ? 1.5 : ql === 3 ? 2 : 1)) * qty;
        return ql ? { itemId: id, qty, value, quality: ql } : { itemId: id, qty, value };
      });
    const total = items.reduce((a, b) => a + b.value, 0);
    return { s: { passedOut: false, shipped: total, penalty: 0, day: this.sampleDay(), sample: true }, items };
  }

  /** The staged sample reads as a lived-in week (Spring 9 when staged on day 1), so the season strip has a story. */
  private sampleDay(): number {
    const d = this.game.calendar.day;
    return d === 1 ? 9 : d;
  }

  /** Season-so-far bars (index 0 = day 1) and the lifetime figure for the milestone bar. */
  private seasonSoFar(s: Summary, season: string, total: number): { days: (number | null)[]; life: number } {
    const y = this.game.calendar.year;
    const days: (number | null)[] = Array.from({ length: 28 }, () => null);
    let life = this.lifetime;
    if (s.sample) {
      // Staged earlier days: a believable early-season curve (quiet clearing days, then the first harvests).
      const fake = [0, 120, 85, 260, 0, 610, 940, 1480, 2210, 1960, 2600, 3100];
      for (let d = 1; d < s.day; d++) days[d - 1] = fake[(d - 1) % fake.length]! + ((d * 37) % 90);
      days[s.day - 1] = total;
      life = days.reduce<number>((a, b) => a + (b ?? 0), 0) + 2400;
    } else {
      for (const h of this.history) if (h.y === y && h.s === season && h.d >= 1 && h.d <= 28) days[h.d - 1] = h.g;
      for (let d = 1; d < s.day; d++) if (days[d - 1] === null) days[d - 1] = 0;
      days[s.day - 1] = total;
    }
    return { days, life };
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
    } else ({ s, items } = this.sample(arg === 'big'));
    const c = this.game.calendar;
    const endedSeason0 = c.day === 1 && s.day === 28 ? (['winter', 'spring', 'summer', 'fall'][['spring', 'summer', 'fall', 'winter'].indexOf(c.season)] ?? c.season) : c.season;
    if (!s.sample) {
      const binTotal = s.shipped || items.reduce((a, b) => a + b.value, 0);
      const y = c.year;
      if (!this.history.some((h) => h.y === y && h.s === endedSeason0 && h.d === s.day)) {
        this.history.push({ y, s: endedSeason0, d: s.day, g: binTotal });
        this.lifetime += binTotal;
      }
    }
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
        rows.push(`<div class="de-row" style="--i:${k++}" data-id="${escapeHtml(it.itemId)}" data-q="${it.quality ?? 0}" data-g="${it.value}"><div class="u-slot mini">${itemIcon(it.itemId)}${qualityStar(it.quality ?? 0)}</div><span class="nm">${escapeHtml(d?.name ?? it.itemId)}</span><span class="q">×${it.qty}</span><b><span class="rv">${it.value.toLocaleString()}</span>g</b></div>`);
      }
    }
    // A real summary arrives after the calendar rolled over; the staged sample shows the day after today.
    const tDay = s.sample ? (s.day % 28) + 1 : c.day;
    const tSeason = s.sample && s.day === 28 ? (['summer', 'fall', 'winter', 'spring'][['spring', 'summer', 'fall', 'winter'].indexOf(c.season)] ?? c.season) : c.season;
    const tomorrow = `${WEEKDAY[(tDay - 1) % 7]}, ${SEASON_NAME[tSeason]} ${tDay}`;
    const bdays = Object.values(NPCS)
      .filter((n) => {
        const b = (n as { birthday?: { season: string; day: number } }).birthday;
        return b && b.season === tSeason && b.day === tDay;
      })
      .map((n) => shortName(n.name));
    const w = c.weather;
    const forecast = w === 'sun' ? 'Sunny and mild' : w === 'rain' ? 'Rain all day — no watering needed' : w === 'storm' ? 'Thunderstorms. Stay near home' : w === 'snow' ? 'Snow on the fields' : 'A breezy day';
    // Pick of the day: the most valuable line in the bin, plus the day's tally.
    // Ties (two lines worth the same) go to the dearer item each, then the higher quality — and say why.
    const unit = (l: Line): number => l.value / Math.max(1, l.qty);
    const ranked = [...items].sort((a, b) => b.value - a.value || unit(b) - unit(a) || (b.quality ?? 0) - (a.quality ?? 0));
    const best = ranked[0];
    const tied = !!best && !!ranked[1] && ranked[1].value === best.value;
    const why = !best ? '' : tied ? ' · best per item' : ranked[1] ? ' · top earner' : '';
    const count = items.reduce((a, b) => a + b.qty, 0);
    const star = best
      ? `<div class="de-star"><div class="de-h">Pick of the day</div><div class="st"><div class="u-slot">${itemIcon(best.itemId)}${qualityStar(best.quality ?? 0)}</div><div class="tx"><b>${escapeHtml(itemDef(best.itemId)?.name ?? best.itemId)}</b><small>×${best.qty} · ${best.value.toLocaleString()}g${why}</small></div><span class="medal">${ROSETTE}</span></div><div class="de-count"><span><b class="cn" data-v="0">0</b> items shipped</span><span><b class="kn" data-v="0">0</b> kinds</span></div></div>`
      : '';
    const title = s.passedOut ? 'You passed out…' : `Day ${s.day} complete`;
    const quiet = !items.length;
    const en = this.game.services.energy;
    const eMax = en?.max() ?? 270;
    const eNow = s.passedOut ? Math.round(eMax * 0.5) : eMax;
    const gold = (this.game.services.economy?.gold() ?? 0) + (s.sample ? total : 0);
    // r5: season-so-far strip (28 day bars, today's in gold) + the next lifetime shipping milestone.
    const sf = this.seasonSoFar(s, endedSeason, total);
    const seasonSum = sf.days.reduce<number>((a, b) => a + (b ?? 0), 0);
    const peak = Math.max(1, ...sf.days.map((v) => v ?? 0));
    const bestDay = sf.days.reduce<number>((a, b) => Math.max(a, b ?? 0), 0);
    const bars = sf.days
      .map((v, i) => {
        const today = i === s.day - 1;
        if (v === null) return `<i class="fut"></i>`;
        const h = v > 0 ? Math.max(0.09, v / peak) : 0.04;
        return `<i class="${today ? 'now' : v === bestDay && v > 0 ? 'best' : ''}" style="--h:${h.toFixed(3)};--j:${i}"></i>`;
      })
      .join('');
    const ms = MILESTONES.find(([g]) => g > sf.life) ?? MILESTONES[MILESTONES.length - 1]!;
    const msPrev = [...MILESTONES].reverse().find(([g]) => g <= sf.life)?.[0] ?? 0;
    const msP = Math.max(0, Math.min(1, (sf.life - msPrev) / Math.max(1, ms[0] - msPrev)));
    const seasonCard = `<div class="de-season"><div class="de-h"><span>${SEASON_NAME[endedSeason]} so far</span><b>${seasonSum.toLocaleString()}g</b></div><div class="spark">${bars}</div><div class="sl"><span>Best day <b>${bestDay.toLocaleString()}g</b></span><span>Day ${s.day} of 28</span></div><div class="ms"><div class="mt"><span>Next: <b>${ms[1]}</b></span><em>${sf.life.toLocaleString()} / ${ms[0].toLocaleString()}g</em></div><div class="bar"><i style="--p:${msP.toFixed(3)}"></i></div></div></div>`;
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
            <div style="display:flex;gap:${an.leftover ? 7 : 14}px;align-items:baseline;font-weight:800;color:#8a6440;white-space:nowrap"><span><b style="font-family:var(--font-head);font-size:21px;color:var(--ink)">${an.fed}/${an.total}</b> fed</span><span><b style="font-family:var(--font-head);font-size:21px;color:var(--ink)">${an.produce.length}</b> ${an.leftover ? 'new' : 'produce'}</span>${an.leftover ? `<span><b style="font-family:var(--font-head);font-size:21px;color:var(--ink)">${an.leftover}</b> in nests</span>` : ''}${gold ? `<span><b style="font-family:var(--font-head);font-size:21px;color:#b8860b">${gold}</b> gold-star</span>` : ''}<span><b style="font-family:var(--font-head);font-size:21px;color:var(--ink)">${an.petted}</b> petted</span></div>
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
          <div class="de-quiet"><div class="qv-art">${quietVignetteSvg(s.animals?.pet?.species)}</div><div class="qv-tx"><h3>${animalsCard ? 'A day with the animals' : 'A quiet day'}</h3><p>${animalsCard ? 'Nothing went in the shipping bin, but the coop and the barn kept you busy.' : 'Nothing went in the shipping bin — and that’s alright. The valley keeps its own pace.'}</p><small>Produce left in the bin by the porch is collected overnight.</small>${animalsCard}</div></div>
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
          <div class="de-rows fit${items.length > 10 ? ' dense' : ''}${items.length > 13 ? ' cols' : ''}"${animalsCard ? ' style="max-height:250px;min-height:0"' : ''}>${rows.join('')}</div>
          <button class="de-more" hidden tabindex="-1"></button>
          <div class="de-tot"><i class="de-stamp">Paid<small>${SEASON_NAME[endedSeason]} ${s.day}</small></i><span class="de-bin">${BIN_SVG}</span><span>Bin total</span><b><span class="bt" data-v="0">0</span>g</b></div>
          ${animalsCard}
        </div>
        <div class="de-side">
          <div class="de-earn"><div class="de-h">Earnings</div><div class="amt">${ICONS.coin}<span class="v" data-v="0">0</span><small>g</small></div></div>
          ${penCard}
          <div class="de-purse sum"><span>Purse</span><b><s>${Math.max(0, gold - total).toLocaleString()}g</s><i class="ar">→</i>${ICONS.coin}<span class="pv">${gold.toLocaleString()}</span>g</b></div>
          ${star}
          ${tmrCard}
          ${seasonCard}
        </div>
      </div>`;
    card.innerHTML = `
      <div class="u-ribbon"><span>${title}</span></div>
      <div class="de-head"><span>${SEASON_NAME[endedSeason]} ${s.day}, Year ${c.year}</span><span class="saving">${ICONS.save}<em>Saving…</em></span></div>
      ${body}
      <div class="de-foot"><span class="zz">z<i>z</i><b>z</b></span><span class="de-keys kb-hint"><kbd>Enter</kbd> wake up · <em>autosaved overnight</em></span><button class="u-btn green is-default" data-nav>${ICONS.sun}<span>Good morning</span></button></div>`;
    card.classList.toggle('quiet', quiet);
    this.root.append(bg, sky, land, flies, card);
    card.querySelector('button')!.addEventListener('click', () => this.requestClose());

    // Choreography (r5): every ledger line ticks in on an 80 ms stagger with a coin tick; each item's icon hops
    // into the shipping crate and the bin total counts up line by line. The EARNINGS odometer rolls only once
    // the last line has landed, then the stamp thumps and the purse settles (old → new, never a half-rolled sum).
    const n = k;
    const rowT = n > 18 ? Math.max(45, 1500 / n) : 80;
    const box = (card.querySelector('.de-rows') as HTMLElement | null) ?? el('div');
    const more = card.querySelector<HTMLButtonElement>('.de-more');
    const lines = [...card.querySelectorAll<HTMLElement>('.de-grp, .de-row')];
    // Whatever doesn't fit gets a visible "+N more" chip on its own line (and a real scrollbar), never a silent fade.
    const syncMore = (): void => {
      if (!more) return;
      const bottom = box.scrollTop + box.clientHeight;
      const hidden = lines.filter((l) => l.classList.contains('de-row') && l.offsetTop + l.offsetHeight * 0.6 > bottom).length;
      more.hidden = hidden === 0;
      more.innerHTML = `+${hidden} more <i>▾</i>`;
      box.classList.toggle('more', hidden > 0);
    };
    box.addEventListener('scroll', syncMore, { passive: true });
    more?.addEventListener('click', () => box.scrollBy({ top: box.clientHeight * 0.7, behavior: 'smooth' }));
    requestAnimationFrame(syncMore);
    const bin = card.querySelector<HTMLElement>('.de-bin');
    const bt = card.querySelector<HTMLElement>('.de-tot .bt');
    let running = 0;
    const t0 = 420;
    let flown = 0;
    lines.forEach((r, i) => {
      r.style.animationDelay = `${t0 + i * rowT}ms`;
      this.timers.push(
        window.setTimeout(() => {
          if (!r.classList.contains('de-row')) return sfx(this.game, 'tick');
          sfx(this.game, i % 2 ? 'tick' : 'coin');
          const g = Number(r.dataset.g) || 0;
          const rv = r.querySelector<HTMLElement>('.rv');
          if (rv) (rv.dataset.v = '0'), rollTo(rv, g, 260);
          running += g;
          if (bt) rollTo(bt, running, 220);
          // Up to 10 icons hop into the crate (a long list would turn into a swarm).
          const icon = r.querySelector('.u-slot');
          const ir = icon?.getBoundingClientRect();
          if (bin && ir && ir.width && flown++ < 10 && r.offsetTop < box.scrollTop + box.clientHeight)
            flyItemTo(r.dataset.id ?? '', { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2 }, bin, Number(r.dataset.q) || 0, undefined, 30, { duration: 440, bounce: 1.3, z: 120 });
        }, t0 + i * rowT),
      );
    });
    // Rest: the energy number fills in step with its bar (same delay and length as the CSS fill).
    const ev = card.querySelector<HTMLElement>('.de-rest .ev');
    if (ev) this.timers.push(window.setTimeout(() => rollTo(ev, eNow, 1300, (v) => String(v)), 500));
    // The last line lands (+ its icon's hop into the crate), then the earnings roll.
    const tEarn = t0 + Math.max(0, n - 1) * rowT + 480;
    (card.querySelector('.de-star') as HTMLElement | null)?.style.setProperty('--d', `${tEarn + 250}ms`);
    card.style.setProperty('--tEarn', `${tEarn}ms`);
    this.timers.push(
      window.setTimeout(() => {
        if (bt) rollTo(bt, total, 200);
        const v = card.querySelector('.de-earn .v') as HTMLElement | null;
        if (v) rollTo(v, total, 900);
        const cn = card.querySelector('.de-count .cn') as HTMLElement | null;
        const kn = card.querySelector('.de-count .kn') as HTMLElement | null;
        if (cn) rollTo(cn, count, 800);
        if (kn) rollTo(kn, items.length, 600);
        if (total > 0) this.timers.push(window.setTimeout(() => replay(card.querySelector('.de-purse'), 'bump'), 950));
        replay(card.querySelector('.de-earn'), 'go');
        card.classList.add('paid');
        // The carter's rubber stamp thumps onto the ledger as the earnings roll.
        card.querySelector('.de-tot')?.classList.add('go');
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
