/**
 * HUD placeholder: clock/date/weather/season + gold (top-right), toolbar (bottom), energy bar.
 * Also a tiny panel registry so the UI team can plug in real screens:
 *
 *   game.hud.registerPanel('inventory', { open: () => ..., close: () => ... });
 *   __game.openUI('inventory')   // emits ui:open → opens the registered panel
 */
import './hud.css';
import './screens.css';
import type { Game } from '../core/game';
import { ICONS, WEATHER_ICON } from './icons';
import { InventoryPanel, slotHtml } from './inventory';
import { DialoguePanel } from './dialogue';
import { TitlePanel } from './title';
import { ShopPanel, CraftingPanel, MapPanel, FishingPanel } from './panels';
import { itemDef } from '../data/items';

export interface Panel {
  open(arg?: string): void;
  close(): void;
}

const SEASON_SHORT = { spring: 'Spr', summer: 'Sum', fall: 'Fall', winter: 'Win' } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class Hud {
  readonly root: HTMLElement;
  private dateEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private goldEl!: HTMLElement;
  private weatherEl!: HTMLElement;
  private seasonEl!: HTMLElement;
  private hand!: HTMLElement;
  private slots: HTMLElement[] = [];
  private energyFill!: HTMLElement;
  private panels = new Map<string, Panel>();
  private openPanel: string | null = null;
  private lastClock = '';
  private goldShown = 0;
  private toastEl!: HTMLElement;
  private toastT = 0;
  private fadeEl: HTMLElement;
  private bannerEl: HTMLElement;

  constructor(private game: Game, uiRoot: HTMLElement, visible: boolean) {
    this.root = el('div', 'hv-hud');
    uiRoot.appendChild(this.root);
    if (!visible) this.root.classList.add('hv-hidden');
    this.buildClock();
    this.buildToolbar();
    this.buildEnergy();
    this.goldShown = game.gold;
    this.toastEl = el('div', 'hv-panel hv-toast hv-hidden');
    this.root.appendChild(this.toastEl);
    this.registerPanel('inventory', new InventoryPanel(game, this.root));
    this.registerPanel('dialogue', new DialoguePanel(game, this.root));
    this.registerPanel('title', new TitlePanel(game, this.root));
    this.registerPanel('shop', new ShopPanel(game, this.root));
    this.registerPanel('crafting', new CraftingPanel(game, this.root));
    this.registerPanel('map', new MapPanel(game, this.root));
    this.registerPanel('fishing', new FishingPanel(game, this.root));
    this.fadeEl = el('div', 'hv-fade');
    this.bannerEl = el('div', 'hv-banner');
    uiRoot.append(this.fadeEl, this.bannerEl);

    game.events.on('toolbar:select', ({ slot }) => this.select(slot));
    game.events.on('inventory:change', ({ slots }) => {
      slots.slice(0, 10).forEach((st, i) => {
        const s = this.slots[i];
        if (!s) return;
        s.innerHTML = `<span class="num">${(i + 1) % 10}</span>` + slotHtml(st);
        s.title = st ? (itemDef(st.id)?.name ?? st.id) : '';
      });
    });
    game.events.on('item:gained', ({ itemId, qty }) => {
      const d = itemDef(itemId);
      this.toastEl.innerHTML = `<span class="hv-inner">${slotHtml({ id: itemId, qty: 1 })}<b>+${qty}</b> ${d?.name ?? itemId}</span>`;
      this.toastEl.classList.remove('hv-hidden', 'hv-anim-in');
      void this.toastEl.offsetWidth;
      this.toastEl.classList.add('hv-anim-in');
      this.toastT = 2.2;
    });
    game.events.on('ui:open', ({ name }) => this.open(name));
    game.events.on('weather:change', () => this.refreshIcons());
    game.events.on('season:change', () => this.refreshIcons());
  }

  private buildClock(): void {
    const panel = el('div', 'hv-panel hv-clock hv-anim-in');
    const dial = el('div', 'dial');
    this.hand = el('div', 'hand');
    dial.appendChild(this.hand);
    panel.appendChild(dial);
    const inner = el('div', 'hv-inner');
    const row = el('div', 'row');
    this.dateEl = el('div', 'date');
    const icons = el('div', 'icons');
    this.weatherEl = el('span');
    this.seasonEl = el('span');
    icons.append(this.weatherEl, this.seasonEl);
    row.append(this.dateEl, icons);
    this.timeEl = el('div', 'time');
    this.goldEl = el('div', 'hv-gold');
    inner.append(row, this.timeEl, this.goldEl);
    panel.appendChild(inner);
    this.root.appendChild(panel);
    this.refreshIcons();
  }

  private buildToolbar(): void {
    const panel = el('div', 'hv-panel hv-toolbar hv-anim-in interactive');
    const inner = el('div', 'hv-inner');
    for (let i = 0; i < 10; i++) {
      const s = el('div', 'hv-slot');
      s.appendChild(el('span', 'num', String((i + 1) % 10)));
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.game.events.emit('toolbar:select', { slot: i });
      });
      inner.appendChild(s);
      this.slots.push(s);
    }
    panel.appendChild(inner);
    this.root.appendChild(panel);
    this.select(0);
  }

  private buildEnergy(): void {
    const panel = el('div', 'hv-panel hv-energy hv-anim-in');
    const label = el('div', 'label', 'E');
    const inner = el('div', 'hv-inner');
    this.energyFill = el('div', 'fill');
    inner.appendChild(this.energyFill);
    panel.append(label, inner);
    this.root.appendChild(panel);
  }

  private refreshIcons(): void {
    const c = this.game.calendar;
    this.weatherEl.innerHTML = ICONS[c.hour >= 20 && c.weather === 'sun' ? 'moon' : WEATHER_ICON[c.weather]!] ?? '';
    this.seasonEl.innerHTML = ICONS[c.season] ?? '';
  }

  select(slot: number): void {
    this.slots.forEach((s, i) => s.classList.toggle('sel', i === slot));
  }

  registerPanel(name: string, panel: Panel): void {
    this.panels.set(name, panel);
  }

  hasPanel(name: string): boolean {
    return this.panels.has(name);
  }

  open(nameArg: string): void {
    const [name, arg] = nameArg.split(':') as [string, string | undefined];
    if (this.openPanel) {
      this.panels.get(this.openPanel)?.close();
      this.game.events.emit('ui:close', { name: this.openPanel });
      this.openPanel = null;
    }
    if (name === 'none') {
      this.game.input.enabled = true;
      return;
    }
    const p = this.panels.get(name);
    if (!p) {
      console.warn(`[ui] panel "${name}" not implemented yet`);
      return;
    }
    p.open(arg);
    this.openPanel = name;
    this.game.input.enabled = false;
  }

  /** Fade to black (on=true) / back in; resolves when the transition is done. */
  fade(on: boolean): Promise<void> {
    this.fadeEl.classList.toggle('on', on);
    return new Promise((r) => setTimeout(r, 280));
  }

  /** Big location title that floats in and out (map arrival). */
  banner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
  }

  get openPanelName(): string | null {
    return this.openPanel;
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hv-hidden', !visible);
  }

  update(dt: number): void {
    const input = this.game.input;
    if (this.openPanel === 'title' || this.openPanel === 'dialogue') {
      if (input.pressed('menu') && this.openPanel === 'dialogue') this.open('none');
    } else if (input.pressed('inventory')) this.open(this.openPanel === 'inventory' ? 'none' : 'inventory');
    else if (input.pressed('map')) this.open(this.openPanel === 'map' ? 'none' : 'map');
    else if (input.pressed('menu') && this.openPanel) this.open('none');
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.classList.add('hv-hidden');
    }
    const c = this.game.calendar;
    const clock = c.clockString();
    const date = `${c.weekday}. ${c.day}`;
    const key = clock + date;
    if (key !== this.lastClock) {
      this.lastClock = key;
      this.timeEl.textContent = clock;
      this.dateEl.textContent = date;
      this.dateEl.title = `${SEASON_SHORT[c.season]} ${c.day}, Year ${c.year}`;
      this.refreshIcons();
    }
    // Dial: 6am at left → 2am; rotate hand across the day.
    const ang = -90 + ((c.hour - 6) / 20) * 180;
    this.hand.style.transform = `rotate(${ang + 180}deg)`;
    // Gold count-up
    const g = this.game.gold;
    if (this.goldShown !== g) {
      const diff = g - this.goldShown;
      this.goldShown += Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 8)));
      if (Math.sign(g - this.goldShown) !== Math.sign(diff)) this.goldShown = g;
    }
    this.goldEl.innerHTML = `${ICONS.coin}<span>${this.goldShown.toLocaleString()}</span>`;
    const e = this.game.energy / this.game.maxEnergy;
    this.energyFill.style.height = `${Math.round(e * 100)}%`;
    this.energyFill.style.background = e > 0.5 ? '' : e > 0.25 ? 'linear-gradient(180deg,#ffe066,#e0a020)' : 'linear-gradient(180deg,#ff8a6a,#d83a2a)';
  }
}
