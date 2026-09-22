/**
 * HUD placeholder: clock/date/weather/season + gold (top-right), toolbar (bottom), energy bar.
 * Also a tiny panel registry so the UI team can plug in real screens:
 *
 *   game.hud.registerPanel('inventory', { open: () => ..., close: () => ... });
 *   __game.openUI('inventory')   // emits ui:open → opens the registered panel
 */
import './hud.css';
import type { Game } from '../core/game';
import { ICONS, WEATHER_ICON } from './icons';

export interface Panel {
  open(arg?: string): void;
  close(): void;
}

const DEFAULT_TOOLBAR: (string | null)[] = ['hoe', 'wateringCan', 'axe', 'pickaxe', 'scythe', 'seeds', 'parsnip', null, null, null];
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
  toolbarItems: (string | null)[] = [...DEFAULT_TOOLBAR];

  constructor(private game: Game, uiRoot: HTMLElement, visible: boolean) {
    this.root = el('div', 'hv-hud');
    uiRoot.appendChild(this.root);
    if (!visible) this.root.classList.add('hv-hidden');
    this.buildClock();
    this.buildToolbar();
    this.buildEnergy();
    this.goldShown = game.gold;

    game.events.on('toolbar:select', ({ slot }) => this.select(slot));
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
      const item = this.toolbarItems[i];
      if (item && ICONS[item]) s.insertAdjacentHTML('beforeend', ICONS[item]!);
      if (item === 'seeds') s.appendChild(el('span', 'qty', '15'));
      if (item === 'parsnip') s.appendChild(el('span', 'qty', '3'));
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

  show(visible: boolean): void {
    this.root.classList.toggle('hv-hidden', !visible);
  }

  update(dt: number): void {
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
