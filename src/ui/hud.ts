/**
 * HUD + screen router.
 *
 *   top-right   sky medallion (sun / moon travel an arc over seasonal hills; stars at night) + date plate
 *               (weekday, day, weather + season badges, time) + a brass gold register with rolling digits
 *   bottom      toolbar: 10 slots, keycaps, bouncing selection, item tooltips, selected-item name flag
 *   bottom-rt   energy + health tubes (squash-bounce on change, low-energy pulse)
 *   bottom-lt   toast stack (item gains merge, gold / craft / save / warning toasts; `ui:toast` for anyone)
 *
 * Panels register by name (`game.hud.registerPanel(name, panel)`; `__game.openUI(name[:arg])`). The router
 * owns input gating, pausing for menus, Esc / E / M routing, keyboard focus navigation and gamepad input.
 */
import './hud.css';
import './screens.css';
import './ui.css';
import * as THREE from 'three';
import type { Game } from '../core/game';
import { ICONS, WEATHER_ICON, itemIcon } from './icons';
import { el, installTextures, tooltip, replay, sfx, Screen, type NavDir } from './kit';
import { slotInner, itemTooltipHtml, type StackView } from './itemtip';
import { InventoryScreen } from './inventory';
import { DialoguePanel } from './dialogue';
import { TitlePanel } from './title';
import { FishingPanel } from './panels';
import { ShopScreen } from './shop';
import { CraftingScreen } from './crafting';
import { MapScreen } from './mapscreen';
import { SettingsScreen, loadSettings, settings } from './settings';
import { PauseScreen, SavesScreen, installSaveThumbs } from './pause';
import { DayEndScreen } from './dayend';
import { IconSheetScreen } from './iconsheet';
import { PlacementGhost } from './placement';
import { DemoKit } from './demo-kit';
import { NewGameScreen } from './newgame';
import { itemDef } from '../data/items';
import { loadJournal, registerJournalSave, journal } from './profile';

export { slotHtml } from './itemtip';

export interface Panel {
  open(arg?: string): void;
  close(): void;
}

type RichPanel = Panel & Partial<Pick<Screen, 'back' | 'update' | 'key' | 'nav'>>;

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SEASON_NAME = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' } as const;
/** Panels that stop the clock while open. */
const PAUSING = new Set(['inventory', 'crafting', 'map', 'settings', 'shop', 'dayend', 'pause', 'saves', 'icons']);
/** Game-menu tabs (E closes, [ ] / LB RB cycle). */
export const MENU_TABS = ['inventory', 'crafting', 'map', 'settings'] as const;
/** Screens that keep the clock / purse plate sharp above their blurred backdrop (you shop with your purse in view). */
const NOPE_TOOLS = new Set(['hoe', 'pickaxe', 'axe', 'scythe', 'wateringCan']);
const CRISP_CLOCK = new Set(['inventory', 'crafting', 'map', 'settings', 'shop']);

const HILLS: Record<string, [string, string]> = {
  spring: ['#8fcf5a', '#5fa83c'],
  summer: ['#6fb04a', '#3f8a34'],
  fall: ['#e0a040', '#b8602a'],
  winter: ['#f2f6fa', '#c4d4e4'],
};

interface Toast {
  node: HTMLElement;
  key: string;
  qty: number;
  t: number;
}

export class Hud {
  /** Measured frames per second (HUD frame counter). */
  static fps = 0;
  /** Frame rate during live play (not behind a menu). */
  static playFps = 0;
  readonly root: HTMLElement;
  readonly screens: HTMLElement;
  private panels = new Map<string, RichPanel>();
  private openPanel: string | null = null;
  private pausedByUi = false;
  private pauseBefore = false;

  // clock
  private sky!: HTMLElement;
  private stars!: HTMLElement;
  private orb!: HTMLElement;
  private hills!: HTMLElement;
  private dateEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private weatherEl!: HTMLElement;
  private seasonEl!: HTMLElement;
  private lastClock = '';
  private lastSkyKey = '';
  // gold
  private goldEl!: HTMLElement;
  private odo!: HTMLElement;
  private goldShown = -1;
  // bars
  private energyBar!: HTMLElement;
  private healthBar!: HTMLElement;
  private energyShown = -1;
  private healthShown = -1;
  // toolbar
  private toolbar!: HTMLElement;
  private slots: HTMLElement[] = [];
  private stacks: (StackView | null)[] = [];
  private selName!: HTMLElement;
  // toasts
  private toastBox!: HTMLElement;
  private toasts: Toast[] = [];

  private fadeEl: HTMLElement;
  private bannerEl: HTMLElement;
  private ghost: PlacementGhost;
  private demoKit: DemoKit;
  private pad = { prev: [] as boolean[], navT: 0, navDir: '' as NavDir | '', keys: {} as Record<string, boolean> };
  private fpsEl: HTMLElement;
  private fpsT = 0;
  private fpsN = 0;
  private fpsLast = performance.now();

  constructor(private game: Game, uiRoot: HTMLElement, visible: boolean) {
    installTextures();
    loadSettings(game);
    loadJournal();
    registerJournalSave(game);
    installSaveThumbs(game, () => {
      try {
        return localStorage.getItem('hearthvale.journal') ? journal.slot : null;
      } catch {
        return null;
      }
    });
    this.root = el('div', 'hv-hud');
    uiRoot.appendChild(this.root);
    if (!visible) this.root.classList.add('hv-hidden');
    this.screens = el('div', 'hv-screens');
    uiRoot.appendChild(this.screens);
    this.buildClock();
    this.buildToolbar();
    this.buildBars();
    this.toastBox = el('div', 'h-toasts');
    this.root.appendChild(this.toastBox);
    this.fpsEl = el('div', 'h-fps hv-hidden');
    this.root.appendChild(this.fpsEl);

    const S = this.screens;
    this.registerPanel('inventory', new InventoryScreen(game, S));
    this.registerPanel('dialogue', new DialoguePanel(game, this.root));
    this.registerPanel('title', new TitlePanel(game, S));
    this.registerPanel('shop', new ShopScreen(game, S));
    this.registerPanel('crafting', new CraftingScreen(game, S));
    this.registerPanel('map', new MapScreen(game, S));
    this.registerPanel('fishing', new FishingPanel(game, this.root));
    this.registerPanel('settings', new SettingsScreen(game, S));
    this.registerPanel('pause', new PauseScreen(game, S));
    this.registerPanel('saves', new SavesScreen(game, S));
    this.registerPanel('dayend', new DayEndScreen(game, S));
    this.registerPanel('icons', new IconSheetScreen(game, S));
    this.registerPanel('newgame', new NewGameScreen(game, S));
    // 'place:<itemId>' — hold a placeable on the toolbar so the in-world ghost shows (staging / tutorials).
    this.registerPanel('place', {
      open: (arg?: string) => {
        const inv = game.services.inventory;
        const id = arg && itemDef(arg) ? arg : 'chest';
        const find = (): number => inv?.slots.slice(0, 10).findIndex((st) => st?.id === id) ?? -1;
        if (find() < 0) game.events.emit('item:give', { itemId: id, qty: 1 });
        setTimeout(() => {
          let k = find();
          if (k < 0 && inv) {
            // Given into the backpack: swap it onto the toolbar's last slot.
            const j = inv.slots.findIndex((st) => st?.id === id);
            if (j >= 0) {
              const bar = inv.slots[9] ?? null;
              inv.setSlot(9, inv.slots[j]!);
              inv.setSlot(j, bar);
              k = 9;
            }
          }
          if (k >= 0) game.events.emit('toolbar:select', { slot: k });
          this.open('none');
        }, 0);
      },
      close: () => {},
    });
    this.fadeEl = el('div', 'hv-fade');
    this.bannerEl = el('div', 'hv-banner');
    uiRoot.append(this.fadeEl, this.bannerEl);
    this.ghost = new PlacementGhost(game);
    this.demoKit = new DemoKit(game);

    game.events.on('toolbar:select', ({ slot }) => this.select(slot, true));
    game.events.on('inventory:change', ({ slots }) => {
      this.stacks = slots.map((s) => (s ? { ...s } : null));
      this.stacks.slice(0, 10).forEach((st, i) => {
        const s = this.slots[i];
        if (!s) return;
        const html = `<span class="key">${(i + 1) % 10}</span>` + slotInner(st);
        if (s.innerHTML !== html) s.innerHTML = html;
        s.classList.toggle('empty', !st);
      });
    });
    // Silent failures feel broken: a tool that finds nothing to do gets a little red "nope" at the tile.
    game.events.on('tool:impact', ({ tool, x, z, hit }) => {
      if (hit !== 'none' || !NOPE_TOOLS.has(tool)) return;
      this.nope(x + 0.5, z + 0.5);
    });
    game.events.on('item:use', ({ slot }) => {
      if (slot >= 0 && slot < 10) replay(this.slots[slot], 'use');
    });
    game.events.on('item:gained', ({ itemId, qty }) => {
      const d = itemDef(itemId);
      this.toast({ key: `item:${itemId}`, icon: itemIcon(itemId), qty, text: (n) => `<b>+${n}</b> ${d?.name ?? itemId}`, kind: 'good' });
    });
    game.events.on('ui:toast', ({ text, icon, kind }) => {
      const ic = icon ? (icon.startsWith('raw:') ? (ICONS[icon.slice(4)] ?? '') : itemIcon(icon)) : ICONS.quill!;
      this.toast({ key: `t:${text}`, icon: ic, qty: 1, text: () => text, kind: kind ?? 'info' });
    });
    game.events.on('gold:insufficient', ({ need, have }) =>
      this.toast({ key: 'gold:no', icon: ICONS.coin!, qty: 1, text: () => `Not enough gold <b>${(need - have).toLocaleString()}g</b> short`, kind: 'bad' }),
    );
    game.events.on('craft:made', ({ itemId, qty }) => {
      const d = itemDef(itemId);
      this.toast({ key: `craft:${itemId}`, icon: itemIcon(itemId), qty, text: (n) => `Crafted <b>${d?.name ?? itemId}</b>${n > 1 ? ` ×${n}` : ''}`, kind: 'good' });
    });
    game.events.on('save:after', ({ slot }) => {
      if (slot !== 'smoke' && slot !== 'auto') this.toast({ key: 'save', icon: ICONS.save!, qty: 1, text: () => `Game saved <b>✓</b>`, kind: 'info' });
    });
    game.events.on('energy:exhausted', () => this.toast({ key: 'tired', icon: ICONS.bolt!, qty: 1, text: () => `You're <b>exhausted</b>… time for bed`, kind: 'bad' }));
    game.events.on('gold:change', ({ delta }) => {
      if (!delta || this.goldShown < 0) return;
      const d = el('div', `h-delta ${delta > 0 ? 'up' : 'down'}`, `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()}g`);
      this.goldEl.appendChild(d);
      setTimeout(() => d.remove(), 1700);
      replay(this.goldEl, 'bump');
    });
    game.events.on('sleep:summary', (s) => {
      if (this.openPanel === 'title') return;
      this.open(`dayend:${JSON.stringify(s)}`);
    });
    game.events.on('ui:open', ({ name }) => this.open(name));
    game.events.on('weather:change', () => this.refreshBadges(true));
    game.events.on('season:change', () => this.refreshBadges(true));
    game.events.on('map:change', () => (this.healthShown = -1));
    window.addEventListener('keydown', this.onKey);
  }

  // ── Build ──────────────────────────────────────────────────────────────

  private buildClock(): void {
    const wrap = el('div', 'h-clock h-el h-in');
    const dial = el('div', 'h-dial');
    this.sky = el('div', 'h-sky');
    this.stars = el('div', 'stars');
    this.orb = el('div', 'orb');
    this.hills = el('div', 'hills');
    this.sky.append(this.stars, this.orb, this.hills);
    dial.append(this.sky, el('div', 'ticks'));
    const plate = el('div', 'h-plate');
    const paper = el('div', 'paper');
    const date = el('div', 'h-date');
    this.dateEl = el('div', 'd');
    this.weatherEl = el('div', 'h-badge');
    this.seasonEl = el('div', 'h-badge');
    date.append(this.dateEl, this.weatherEl, this.seasonEl);
    this.timeEl = el('div', 'h-time');
    paper.append(date, this.timeEl);
    this.goldEl = el('div', 'h-gold', ICONS.coin);
    this.odo = el('div', 'odo');
    this.goldEl.appendChild(this.odo);
    plate.append(paper, this.goldEl);
    wrap.append(dial, plate);
    this.root.appendChild(wrap);
    this.refreshBadges(false);
  }

  private buildToolbar(): void {
    this.toolbar = el('div', 'hv-toolbar interactive h-in');
    this.toolbar.style.animationDelay = '120ms';
    const row = el('div', 'row');
    for (let i = 0; i < 10; i++) {
      const s = el('div', 'u-slot empty', `<span class="key">${(i + 1) % 10}</span>`);
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.game.events.emit('toolbar:select', { slot: i });
        sfx(this.game, 'tab');
      });
      s.addEventListener('pointerenter', () => {
        const st = this.stacks[i];
        if (!st) return;
        // Anchored above the whole bar (never over the slots or the selected-item flag, which hides meanwhile).
        tooltip.over(itemTooltipHtml(st), s, this.toolbar, 14);
        this.toolbar.classList.add('tip-on');
      });
      s.addEventListener('pointerleave', () => {
        tooltip.hide();
        this.toolbar.classList.remove('tip-on');
      });
      row.appendChild(s);
      this.slots.push(s);
    }
    this.selName = el('div', 'h-selname');
    this.toolbar.append(row, this.selName);
    this.root.appendChild(this.toolbar);
    this.select(0, false);
  }

  private buildBars(): void {
    const box = el('div', 'hv-energy h-in');
    box.style.animationDelay = '200ms';
    const bar = (cls: string, icon: string, title: string): HTMLElement => {
      const b = el('div', `h-bar ${cls} interactive`);
      b.innerHTML = `<div class="tube"><div class="fill"></div><div class="ticks"></div><div class="gloss"></div></div><div class="badge">${icon}</div><div class="val"></div>`;
      b.title = title;
      return b;
    };
    this.healthBar = bar('health rest', ICONS.heart!, 'Health');
    this.energyBar = bar('energy', ICONS.bolt!, 'Energy');
    box.append(this.healthBar, this.energyBar);
    this.root.appendChild(box);
  }

  private refreshBadges(pop: boolean): void {
    const c = this.game.calendar;
    const night = c.hour >= 19.5 || c.hour < 5.5;
    const w = ICONS[night && c.weather === 'sun' ? 'moon' : WEATHER_ICON[c.weather]!] ?? '';
    const s = ICONS[c.season] ?? '';
    if (this.weatherEl.innerHTML !== w) {
      this.weatherEl.innerHTML = w;
      if (pop) replay(this.weatherEl, 'pop');
    }
    if (this.seasonEl.innerHTML !== s) {
      this.seasonEl.innerHTML = s;
      if (pop) replay(this.seasonEl, 'pop');
    }
    this.weatherEl.title = c.weather[0]!.toUpperCase() + c.weather.slice(1);
    this.seasonEl.title = SEASON_NAME[c.season];
  }

  // ── Sky medallion ──────────────────────────────────────────────────────

  private updateSky(hour: number): void {
    const c = this.game.calendar;
    const key = `${Math.round(hour * 6)}|${c.season}|${c.weather}`;
    if (key === this.lastSkyKey) return;
    this.lastSkyKey = key;
    const h = hour;
    let top: string;
    let bot: string;
    let night = 0;
    if (h < 6.5) [top, bot, night] = ['#2a3470', '#f0a070', 0.5];
    else if (h < 8) [top, bot] = ['#7ab8f0', '#ffd0a0'];
    else if (h < 17) [top, bot] = ['#5aa8ee', '#bfe4ff'];
    else if (h < 19) [top, bot] = ['#6a7ad8', '#ffae70'];
    else if (h < 20.5) [top, bot, night] = ['#2c2e6a', '#e07a6a', 0.55];
    else [top, bot, night] = ['#0e1436', '#24346e', 1];
    if (c.weather === 'rain' || c.weather === 'storm') {
      top = night > 0.5 ? '#1a2030' : '#6a7a8e';
      bot = night > 0.5 ? '#2a3448' : '#a8b4c2';
    }
    this.sky.style.background = `linear-gradient(180deg, ${top}, ${bot})`;
    this.stars.style.opacity = String(c.weather === 'rain' || c.weather === 'storm' ? 0 : night);
    // Sun 6→20 across the arc; moon 19.5→26.
    const sun = h < 19.75;
    const t = sun ? (h - 6) / 14 : (h - 19.5) / 6.5;
    const a = Math.PI * (1 - Math.max(0, Math.min(1, t)));
    const r = 31;
    this.orb.style.transform = `translate(${Math.cos(a) * r}px, ${-Math.sin(a) * r * 0.95}px)`;
    const orbHtml = sun ? ICONS.sun! : ICONS.moon!;
    if (this.orb.dataset.k !== (sun ? 's' : 'm')) {
      this.orb.dataset.k = sun ? 's' : 'm';
      this.orb.innerHTML = orbHtml;
    }
    const [h1, h2] = HILLS[c.season] ?? HILLS.spring!;
    const dark = night * 0.55;
    const shade = (hex: string): string => `color-mix(in srgb, ${hex} ${Math.round((1 - dark) * 100)}%, #101830)`;
    this.hills.innerHTML = `<svg viewBox="0 0 100 46" preserveAspectRatio="none"><path d="M0 22 C18 8 32 10 48 20 C62 28 78 10 100 16 V46 H0 Z" fill="${shade(h1)}"/><path d="M0 34 C22 22 40 26 58 32 C74 38 88 26 100 28 V46 H0 Z" fill="${shade(h2)}"/><g fill="${shade('#3f7a34')}" opacity="${c.season === 'winter' ? 0.5 : 0.9}"><circle cx="20" cy="26" r="4"/><circle cx="25" cy="27" r="3"/><circle cx="76" cy="22" r="3.4"/><rect x="19.4" y="27" width="1.2" height="5"/><rect x="75.4" y="23" width="1.2" height="5"/></g><path d="M36 30 h8 v-5 l-4 -3.5 l-4 3.5 Z" fill="${shade('#c8573e')}"/><rect x="38.8" y="27" width="2.4" height="3" fill="${night > 0.3 ? '#ffd66a' : shade('#5a3418')}"/></svg>`;
  }

  // ── Gold odometer ──────────────────────────────────────────────────────

  private setGold(g: number, instant: boolean): void {
    const str = g.toLocaleString('en-US');
    const cells = [...str];
    while (this.odo.children.length < cells.length) this.odo.appendChild(el('span'));
    while (this.odo.children.length > cells.length) this.odo.lastElementChild!.remove();
    cells.forEach((ch, i) => {
      const cell = this.odo.children[i] as HTMLElement;
      if (ch === ',') {
        if (cell.className !== 'sep') {
          cell.className = 'sep';
          cell.textContent = ',';
        }
        return;
      }
      if (cell.className !== 'dg') {
        cell.className = 'dg';
        cell.innerHTML = `<div class="strip">${Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join('')}</div>`;
      }
      const strip = cell.firstElementChild as HTMLElement;
      if (instant) strip.style.transition = 'none';
      strip.style.transform = `translateY(${-Number(ch) * 26}px)`;
      if (instant) {
        void strip.offsetWidth;
        strip.style.transition = '';
      }
    });
    this.goldEl.title = `${g.toLocaleString()} gold`;
  }

  // ── Toolbar ────────────────────────────────────────────────────────────

  select(slot: number, announce = false): void {
    this.slots.forEach((s, i) => {
      const on = i === slot;
      if (on && !s.classList.contains('sel')) replay(s, 'bounce');
      s.classList.toggle('sel', on);
    });
    if (announce) {
      const st = this.stacks[slot];
      const d = st ? itemDef(st.id) : undefined;
      if (d) {
        this.selName.textContent = d.name;
        replay(this.selName, 'show');
      }
    }
  }

  // ── Toasts ─────────────────────────────────────────────────────────────

  private toast(o: { key: string; icon: string; qty: number; text: (n: number) => string; kind: string }): void {
    if (this.openPanel === 'title') return;
    const hit = this.toasts.find((t) => t.key === o.key && !t.node.classList.contains('out'));
    if (hit) {
      hit.qty += o.qty;
      hit.t = this.demoKit.holdToasts ? 60 : 3.2;
      const tx = hit.node.querySelector('.tx')!;
      tx.innerHTML = o.text(hit.qty);
      replay(tx.querySelector('b'), 'bump');
      return;
    }
    const node = el('div', `h-toast ${o.kind}`, `<div class="ic">${o.icon}</div><div class="tx">${o.text(o.qty)}</div>`);
    this.toastBox.appendChild(node);
    this.toasts.push({ node, key: o.key, qty: o.qty, t: this.demoKit.holdToasts ? 60 : 3.2 });
    while (this.toasts.filter((t) => !t.node.classList.contains('out')).length > 4) this.dismiss(this.toasts.find((t) => !t.node.classList.contains('out'))!);
  }

  private dismiss(t: Toast): void {
    t.node.classList.add('out');
    setTimeout(() => {
      t.node.remove();
      this.toasts = this.toasts.filter((x) => x !== t);
    }, 320);
  }

  // ── Panel router ───────────────────────────────────────────────────────

  registerPanel(name: string, panel: Panel): void {
    this.panels.set(name, panel as RichPanel);
  }

  hasPanel(name: string): boolean {
    return this.panels.has(name);
  }

  open(nameArg: string): void {
    const i = nameArg.indexOf(':');
    const name = i < 0 ? nameArg : nameArg.slice(0, i);
    const arg = i < 0 ? undefined : nameArg.slice(i + 1);
    tooltip.hide();
    // Tab to tab inside the game menu: the frame, ribbon and tabs stay put; only the page content cross-fades.
    const isTab = (n: string | null): boolean => !!n && (MENU_TABS as readonly string[]).includes(n);
    const swap = isTab(this.openPanel) && isTab(name) && name !== this.openPanel;
    if (this.openPanel) {
      const prev = this.openPanel;
      this.openPanel = null;
      const pp = this.panels.get(prev);
      pp?.close();
      // No exit animation between tabs: the next page takes the frame's place in the same paint.
      if (swap) (pp as { root?: HTMLElement } | undefined)?.root?.classList.remove('is-closing');
      this.game.events.emit('ui:close', { name: prev });
    }
    this.root.classList.toggle('h-crisp', CRISP_CLOCK.has(name));
    // Full-screen night ledger: the HUD steps aside before the card fades in (no clock/gold under the moon).
    this.root.classList.toggle('h-away', name === 'dayend');
    if (name === 'none') {
      this.game.input.enabled = true;
      this.setMenuPause(false);
      this.root.classList.remove('h-menu-open');
      return;
    }
    const p = this.panels.get(name);
    if (!p) {
      console.warn(`[ui] panel "${name}" not implemented yet`);
      this.game.input.enabled = true;
      this.setMenuPause(false);
      return;
    }
    this.demoKit.beforeOpen(name);
    this.setMenuPause(PAUSING.has(name));
    this.root.classList.toggle('h-menu-open', PAUSING.has(name));
    this.openPanel = name;
    this.game.input.enabled = false;
    p.open(arg);
    if (swap) {
      const r = (p as { root?: HTMLElement }).root;
      if (r) {
        r.classList.remove('is-opening');
        replay(r, 'tab-in');
      }
    }
  }

  private setMenuPause(on: boolean): void {
    if (on && !this.pausedByUi) {
      this.pauseBefore = this.game.paused;
      this.pausedByUi = true;
      this.game.setPaused(true);
    } else if (!on && this.pausedByUi) {
      this.pausedByUi = false;
      this.game.setPaused(this.pauseBefore);
    }
  }

  /** Red ✕ that head-shakes over a tile the tool couldn't work (projected from world to screen). */
  private nope(wx: number, wz: number): void {
    const cam = this.game.rc.camera;
    const v = new THREE.Vector3(wx, this.game.world.heightAt(wx, wz) + 0.35, wz).project(cam);
    if (v.z > 1) return;
    const n = el('div', 'h-nope', `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e0584a" stroke="#5a1a0c" stroke-width="2"/><path d="M8 8 L16 16 M16 8 L8 16" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`);
    n.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    n.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
    this.root.appendChild(n);
    setTimeout(() => n.remove(), 700);
  }

  /** Fade to black (on=true) / back in; resolves when the transition is done. */
  fade(on: boolean): Promise<void> {
    this.fadeEl.classList.toggle('on', on);
    return new Promise((r) => setTimeout(r, 280));
  }

  /** Big location title that floats in and out (map arrival). */
  banner(text: string, sub = ''): void {
    this.bannerEl.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    replay(this.bannerEl, 'show');
  }

  get openPanelName(): string | null {
    return this.openPanel;
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hv-hidden', !visible);
  }

  private get current(): RichPanel | undefined {
    return this.openPanel ? this.panels.get(this.openPanel) : undefined;
  }

  /** Esc / B: let the screen consume it (drop held stack, leave a sub-view) or close. */
  private back(): void {
    const p = this.current;
    if (!this.openPanel || !p) return;
    if (p.back?.()) return;
    sfx(this.game, 'close');
    this.open('none');
  }

  private cycleTab(dir: number): void {
    const i = MENU_TABS.indexOf(this.openPanel as (typeof MENU_TABS)[number]);
    if (i < 0) return;
    sfx(this.game, 'tab');
    this.open(MENU_TABS[(i + dir + MENU_TABS.length) % MENU_TABS.length]!);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.openPanel || this.openPanel === 'dialogue' || this.openPanel === 'fishing') return;
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
    const p = this.current;
    if (p?.key?.(e.code)) {
      e.preventDefault();
      return;
    }
    const nav = p?.nav;
    if (!nav) return;
    const dir: NavDir | null =
      e.code === 'ArrowUp' || e.code === 'KeyW' ? 'up' : e.code === 'ArrowDown' || e.code === 'KeyS' ? 'down' : e.code === 'ArrowLeft' || e.code === 'KeyA' ? 'left' : e.code === 'ArrowRight' || e.code === 'KeyD' ? 'right' : null;
    if (dir) {
      e.preventDefault();
      nav.move(dir);
      sfx(this.game, 'hover');
    } else if (e.code === 'Enter' || e.code === 'Space') {
      if (nav.current) {
        e.preventDefault();
        nav.activate();
      }
    } else if (e.code === 'BracketLeft' || e.code === 'KeyQ') this.cycleTab(-1);
    else if (e.code === 'BracketRight') this.cycleTab(1);
  };

  // ── Gamepad ────────────────────────────────────────────────────────────

  private pollPad(dt: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) {
      for (const k in this.pad.keys) if (this.pad.keys[k]) return this.padKeys({});
      return;
    }
    const down = gp.buttons.map((b) => b.pressed);
    const hit = (i: number): boolean => !!down[i] && !this.pad.prev[i];
    this.pad.prev = down;
    const p = this.current;
    if (this.openPanel && this.openPanel !== 'dialogue') {
      document.body.classList.add('u-kbd');
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const dir: NavDir | '' = down[12] || ay < -0.55 ? 'up' : down[13] || ay > 0.55 ? 'down' : down[14] || ax < -0.55 ? 'left' : down[15] || ax > 0.55 ? 'right' : '';
      if (dir && (dir !== this.pad.navDir || this.pad.navT <= 0)) {
        p?.nav?.move(dir);
        this.pad.navT = dir !== this.pad.navDir ? 0.32 : 0.11;
      }
      this.pad.navDir = dir;
      this.pad.navT -= dt;
      if (hit(0)) p?.nav?.activate();
      if (hit(1)) this.back();
      if (hit(3) && MENU_TABS.includes(this.openPanel as (typeof MENU_TABS)[number])) this.open('none');
      if (hit(4)) this.cycleTab(-1);
      if (hit(5)) this.cycleTab(1);
      if (hit(9) && this.openPanel !== 'title' && this.openPanel !== 'newgame') this.open('none');
    } else if (!this.openPanel) {
      if (hit(9)) this.open('pause');
      if (hit(3)) this.open('inventory');
      if (hit(8)) this.open('map');
      if (hit(4) || hit(5)) this.game.events.emit('toolbar:select', { slot: (this.game.toolbarSlot + (hit(4) ? 9 : 1)) % 10 });
      // Play on the pad: stick / d-pad walk, X uses the tool, A talks / interacts, B held runs (settings PAD_MAP).
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      this.padKeys({ KeyW: !!down[12] || ay < -0.45, KeyS: !!down[13] || ay > 0.45, KeyA: !!down[14] || ax < -0.45, KeyD: !!down[15] || ax > 0.45, KeyC: !!down[2], KeyX: !!down[0], ShiftLeft: !!down[1] });
      return;
    }
    this.padKeys({});
  }

  /** Mirror pad buttons as the default key codes the game listens for (keydown / keyup on change only). */
  private padKeys(want: Record<string, boolean>): void {
    const keys = this.pad.keys;
    for (const code of new Set([...Object.keys(keys), ...Object.keys(want)])) {
      const on = !!want[code];
      if (on === !!keys[code]) continue;
      keys[code] = on;
      window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
    }
  }

  // ── Frame ──────────────────────────────────────────────────────────────

  update(dt: number): void {
    const input = this.game.input;
    const op = this.openPanel;
    if (op === 'title') {
      /* title screen handles its own keys */
    } else if (op === 'dialogue') {
      if (input.pressed('menu')) this.open('none');
    } else if (input.pressed('menu')) {
      if (op) this.back();
      else this.open('pause');
    } else if (input.pressed('inventory')) {
      if (!op) this.open('inventory');
      else if (MENU_TABS.includes(op as (typeof MENU_TABS)[number])) this.open('none');
    } else if (input.pressed('map')) {
      if (!op) this.open('map');
      else if (op === 'map') this.open('none');
    }
    this.pollPad(dt);
    this.current?.update?.(dt);

    // toasts
    for (const t of this.toasts) {
      if (t.node.classList.contains('out')) continue;
      t.t -= dt;
      if (t.t <= 0) this.dismiss(t);
    }

    const c = this.game.calendar;
    let clock = c.clockString();
    if (settings.clock24) {
      const tm = Math.floor((c.hour * 60) / 10) * 10;
      clock = `${Math.floor(tm / 60) % 24}:${String(tm % 60).padStart(2, '0')} `;
    }
    const date = `${WEEKDAY[(c.day - 1) % 7]}. ${c.day}`;
    const key = clock + date;
    if (key !== this.lastClock) {
      const [hm, ampm] = clock.split(' ');
      this.timeEl.innerHTML = ampm ? `${hm}<span class="ampm">${ampm}</span>` : `${hm}`;
      this.timeEl.classList.toggle('late', c.hour >= 24);
      if (this.lastClock) replay(this.timeEl, 'tick');
      this.lastClock = key;
      this.dateEl.textContent = date;
      this.dateEl.title = `${SEASON_NAME[c.season]} ${c.day}, Year ${c.year}`;
      this.refreshBadges(false);
    }
    this.updateSky(c.hour);

    const g = this.game.services.economy?.gold() ?? 0;
    if (g !== this.goldShown) {
      this.setGold(g, this.goldShown < 0);
      this.goldShown = g;
    }

    const en = this.game.services.energy;
    const e = en ? en.value() / en.max() : 1;
    if (e !== this.energyShown) {
      if (this.energyShown >= 0) replay(this.energyBar, 'bump');
      this.energyShown = e;
      const fill = this.energyBar.querySelector('.fill') as HTMLElement;
      fill.style.height = `${Math.max(0, e * 100)}%`;
      const hue = e > 0.5 ? 100 - (1 - (e - 0.5) * 2) * 50 : 50 * (e / 0.5);
      fill.style.background = `linear-gradient(90deg, hsl(${hue} 80% 44%), hsl(${hue + 8} 92% 62%) 45%, hsl(${hue} 78% 44%))`;
      this.energyBar.classList.toggle('low', e < 0.2);
      (this.energyBar.querySelector('.val') as HTMLElement).textContent = en ? `${en.value()} / ${en.max()}` : '';
    }
    const hp = (this.game.services as Record<string, unknown>).health as { value(): number; max(): number } | undefined;
    const mapId = this.game.world.current?.id ?? 'farm';
    const hv = hp ? hp.value() / Math.max(1, hp.max()) : 1;
    // Both tubes always show; a full heart outside the mine rests shorter and dimmer so energy leads.
    this.healthBar.classList.toggle('rest', hv >= 1 && mapId !== 'mine');
    if (hv !== this.healthShown) {
      if (this.healthShown >= 0) replay(this.healthBar, 'bump');
      this.healthShown = hv;
      const fill = this.healthBar.querySelector('.fill') as HTMLElement;
      fill.style.height = `${hv * 100}%`;
      fill.style.background = 'linear-gradient(90deg, #b8202a, #ff6a5a 45%, #b8202a)';
      this.healthBar.classList.toggle('low', hv < 0.25);
      (this.healthBar.querySelector('.val') as HTMLElement).textContent = hp ? `${Math.round(hp.value())} / ${hp.max()}` : '';
    }
    this.root.classList.toggle('h-hurt', hv < 0.25 || e < 0.12);
    // FPS chip (Options → Display → Show FPS): real frames, measured here, refreshed twice a second.
    const now = performance.now();
    this.fpsN++;
    this.fpsT += now - this.fpsLast;
    this.fpsLast = now;
    if (this.fpsT >= 500) {
      const fps = (this.fpsN * 1000) / this.fpsT;
      Hud.fps = fps;
      // Menus throttle the world behind them: remember what live play costs for the Options readout.
      if (!this.root.classList.contains('h-menu-open') && !this.root.classList.contains('hv-title-mode')) Hud.playFps = fps;
      if (settings.showFps) {
        this.fpsEl.innerHTML = `<b>${Math.round(fps)}</b><small>fps</small>`;
        this.fpsEl.classList.toggle('warn', fps < 50);
        this.fpsEl.classList.toggle('bad', fps < 30);
      }
      this.fpsT = 0;
      this.fpsN = 0;
    }
    this.fpsEl.classList.toggle('hv-hidden', !settings.showFps);
    this.ghost.update(this.openPanel === null && !this.root.classList.contains('hv-title-mode'));
  }
}
