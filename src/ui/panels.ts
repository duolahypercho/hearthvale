/**
 * Remaining DESIGN.md screens, each a real (if compact) panel so `openUI(name)` always works:
 *   shop      Thimble & Pip's seed counter (buys with gold → item:give)
 *   crafting  recipe book with ingredient checks (read-only until the crafting system lands)
 *   map       painted valley map, "you are here" pin on the current map
 *   fishing   the reel minigame HUD (catch bar, darting fish, progress gauge), animated
 * Shared behaviour: wood + parchment frame, title tab, ease-out-back entrance, Esc closes.
 */
import type { Game } from '../core/game';
import type { Panel } from './hud';
import { ITEMS, itemDef } from '../data/items';
import { CROPS, CROP_IDS } from '../data/crops';
import { iconFor, ICONS } from './icons';

abstract class FramedPanel implements Panel {
  protected el: HTMLElement;
  protected body: HTMLElement;

  constructor(protected game: Game, parent: HTMLElement, title: string, cls: string) {
    this.el = document.createElement('div');
    this.el.className = `hv-panel hv-sheet ${cls} hv-hidden interactive`;
    this.el.innerHTML = `<div class="hv-title">${title}</div><button class="hv-close" aria-label="Close">✕</button><div class="hv-inner"></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector('.hv-inner')!;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.querySelector('.hv-close')!.addEventListener('pointerdown', () => this.game.events.emit('ui:open', { name: 'none' }));
  }

  protected abstract render(arg?: string): void;

  open(arg?: string): void {
    this.render(arg);
    this.el.classList.remove('hv-hidden', 'hv-anim-in');
    void this.el.offsetWidth;
    this.el.classList.add('hv-anim-in');
  }

  close(): void {
    this.el.classList.add('hv-hidden');
  }
}

export class ShopPanel extends FramedPanel {
  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, "Thimble & Pip's", 'hv-shop');
  }

  protected render(): void {
    const season = this.game.calendar.season;
    const rows = CROP_IDS.map((id) => CROPS[id])
      .map((c) => {
        const d = itemDef(c.seeds)!;
        const inSeason = c.seasons.includes(season);
        const days = c.stageDays.reduce((a, b) => a + b, 0);
        return `<div class="row ${inSeason ? '' : 'off'}" data-id="${c.seeds}" data-price="${c.seedPrice}">
          <div class="ic">${iconFor(d.id, d.icon, d.color)}</div>
          <div class="nm"><b>${d.name}</b><small>${inSeason ? `${days} days · sells ${c.sell}g` : `${c.seasons.join(' / ')} only`}</small></div>
          <div class="pr">${ICONS.coin ?? ''}<span>${c.seedPrice}</span></div>
        </div>`;
      })
      .join('');
    this.body.innerHTML = `
      <div class="shop-head">
        <div class="keeper">"Fresh seed, straight off the morning cart. Pip checked every packet. Twice."</div>
        <div class="purse">${ICONS.coin ?? ''}<span>${(this.game.services.economy?.gold() ?? 0).toLocaleString()}</span></div>
      </div>
      <div class="list">${rows}</div>`;
    this.body.querySelectorAll<HTMLElement>('.row:not(.off)').forEach((r) =>
      r.addEventListener('pointerdown', () => {
        const price = Number(r.dataset.price);
        if (!this.game.services.economy?.spend(price, 'shop')) {
          r.classList.remove('nope');
          void r.offsetWidth;
          r.classList.add('nope');
          return;
        }
        this.game.events.emit('item:give', { itemId: r.dataset.id!, qty: 1 });
        r.classList.remove('bought');
        void r.offsetWidth;
        r.classList.add('bought');
        (this.body.querySelector('.purse span') as HTMLElement).textContent = (this.game.services.economy?.gold() ?? 0).toLocaleString();
      }),
    );
  }
}

const RECIPES: { id: string; name: string; icon: string; needs: [string, number][]; note: string }[] = [
  { id: 'sprinkler', name: 'Sprinkler', icon: 'sprinkler', needs: [['stone', 10], ['wood', 5]], note: 'Waters the 4 tiles around it every morning.' },
  { id: 'chest', name: 'Chest', icon: 'wood', needs: [['wood', 50]], note: 'Stores 36 items.' },
  { id: 'scarecrow', name: 'Scarecrow', icon: 'fiber', needs: [['wood', 20], ['fiber', 20]], note: 'Keeps crows off crops within 8 tiles.' },
  { id: 'fence', name: 'Wood Fence', icon: 'wood', needs: [['wood', 2]], note: 'Keeps animals in. Keeps weeds out (mostly).' },
  { id: 'path', name: 'Stone Path', icon: 'stone', needs: [['stone', 1]], note: 'Paves a tile. Grass won’t grow through it.' },
];

export class CraftingPanel extends FramedPanel {
  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'Crafting', 'hv-crafting');
  }

  protected render(): void {
    const inv = this.game.services.inventory;
    const count = (id: string): number => (inv ? inv.count(id) : 0);
    this.body.innerHTML = `<div class="recipes">${RECIPES.map((r) => {
      const ok = r.needs.every(([id, n]) => count(id) >= n);
      return `<div class="recipe ${ok ? 'ok' : ''}">
        <div class="ic">${ICONS[r.icon] ?? ''}</div>
        <div class="nm"><b>${r.name}</b><small>${r.note}</small>
          <div class="needs">${r.needs.map(([id, n]) => `<span class="${count(id) >= n ? 'have' : ''}">${ICONS[itemDef(id)?.icon ?? id] ?? ''}${count(id)}/${n}</span>`).join('')}</div>
        </div>
      </div>`;
    }).join('')}</div>`;
  }
}

const MAP_SVG = `<svg viewBox="0 0 640 400" class="valley">
  <defs>
    <radialGradient id="vmSea" cx="50%" cy="120%" r="80%"><stop offset="0" stop-color="#7fc4d8"/><stop offset="1" stop-color="#4f9ab8"/></radialGradient>
    <pattern id="vmTrees" width="22" height="18" patternUnits="userSpaceOnUse"><circle cx="6" cy="7" r="6" fill="#4f8a3a"/><circle cx="16" cy="12" r="5.5" fill="#5e9a44"/></pattern>
  </defs>
  <rect width="640" height="400" fill="#e9d9a8"/>
  <path d="M0 330 Q160 300 320 322 T640 318 V400 H0 Z" fill="url(#vmSea)"/>
  <path d="M0 312 Q160 284 320 306 T640 300 L640 318 Q480 336 320 322 T0 330 Z" fill="#f2dc9a"/>
  <path d="M0 0 H640 V70 Q520 96 420 64 Q320 40 220 70 Q110 100 0 60 Z" fill="url(#vmTrees)" opacity="0.95"/>
  <path d="M470 120 Q560 90 640 120 V220 Q560 240 500 210 Q450 180 470 120 Z" fill="url(#vmTrees)"/>
  <path d="M40 90 L110 60 L150 110 L90 140 Z" fill="#a89a88" stroke="#6a5e50" stroke-width="3"/>
  <path d="M170 180 C 240 176 300 190 360 186 S 470 170 520 176" stroke="#c8a070" stroke-width="10" fill="none" stroke-linecap="round"/>
  <path d="M360 186 C 370 230 360 270 330 300" stroke="#c8a070" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M150 200 C 170 160 120 120 120 120" stroke="#c8a070" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="2 12"/>
  <g class="loc" data-map="farm" transform="translate(110 205)"><rect x="-58" y="-40" width="116" height="80" rx="16" fill="#9cc86a" stroke="#5a8a3a" stroke-width="3"/><rect x="-40" y="-24" width="30" height="20" fill="#7a4a2a"/><path d="M-44 -24 L-25 -38 L-6 -24 Z" fill="#b8563c"/><rect x="4" y="-4" width="38" height="26" fill="#8a5a36" opacity="0.7"/><text y="58">Farm</text></g>
  <g class="loc" data-map="town" transform="translate(420 180)"><circle r="44" fill="#e8d6b4" stroke="#a8845a" stroke-width="3"/><circle r="10" fill="#8fc8e8"/><rect x="-30" y="-36" width="22" height="16" fill="#d8573e"/><rect x="10" y="-38" width="22" height="18" fill="#6a7a9a"/><text y="64">Hearthvale</text></g>
  <g class="loc" data-map="forest" transform="translate(560 160)"><text y="4">Whisperwood</text></g>
  <g class="loc" data-map="mine" transform="translate(96 100)"><circle r="12" fill="#3a3432"/><text y="34">Old Mine</text></g>
  <g class="loc" data-map="beach" transform="translate(470 330)"><text>Driftsand Beach</text></g>
  <g class="rose" transform="translate(590 60)"><circle r="22" fill="#fbf0d6" stroke="#8a6440" stroke-width="2"/><path d="M0 -20 L5 0 L0 20 L-5 0 Z" fill="#c8573e"/><text y="-26">N</text></g>
</svg>`;

export class MapPanel extends FramedPanel {
  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'Hearthvale Valley', 'hv-map');
  }

  protected render(): void {
    const here = this.game.world.current?.id ?? 'farm';
    this.body.innerHTML = MAP_SVG + `<div class="legend">Press <b>M</b> to close · Paths lead east to town, south to the beach.</div>`;
    const g = this.body.querySelector(`.loc[data-map="${here}"]`);
    if (g) {
      g.classList.add('here');
      g.insertAdjacentHTML('beforeend', `<g class="pin" transform="translate(0 -46)"><path d="M0 18 C -12 2 -12 -14 0 -14 C 12 -14 12 2 0 18 Z" fill="#e8574a" stroke="#7a2e1e" stroke-width="2.5"/><circle cy="-3" r="4.5" fill="#fff"/></g>`);
    }
  }
}

export class FishingPanel extends FramedPanel {
  private raf = 0;
  private t = 0;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'Reel it in!', 'hv-fishing');
  }

  protected render(): void {
    this.body.innerHTML = `
      <div class="reel">
        <div class="track"><div class="zone"></div><div class="fish">${FISH}</div></div>
        <div class="gauge"><div class="fill"></div></div>
      </div>
      <div class="tip">Hold <b>click</b> to raise the bar. Keep the fish inside it!</div>`;
    cancelAnimationFrame(this.raf);
    const zone = this.body.querySelector('.zone') as HTMLElement;
    const fish = this.body.querySelector('.fish') as HTMLElement;
    const fill = this.body.querySelector('.fill') as HTMLElement;
    const loop = (): void => {
      this.t += 1 / 60;
      const fy = 0.5 + 0.34 * Math.sin(this.t * 1.7) + 0.08 * Math.sin(this.t * 5.3);
      const zy = 0.5 + 0.3 * Math.sin(this.t * 1.7 - 0.35);
      fish.style.top = `${(1 - fy) * 88}%`;
      zone.style.top = `${(1 - zy) * 72}%`;
      fill.style.height = `${40 + 30 * Math.sin(this.t * 0.6)}%`;
      if (!this.el.classList.contains('hv-hidden')) this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  override close(): void {
    cancelAnimationFrame(this.raf);
    super.close();
  }
}

const FISH = `<svg viewBox="0 0 40 24"><path d="M4 12 C 10 2 26 2 32 12 C 26 22 10 22 4 12 Z" fill="#6fb0d8" stroke="#2f5f7d" stroke-width="2"/><path d="M32 12 L39 5 L39 19 Z" fill="#4f90b8" stroke="#2f5f7d" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.2" fill="#1d2a36"/><path d="M18 7 Q20 12 18 17" stroke="#9fd4f0" stroke-width="1.6" fill="none"/></svg>`;

void ITEMS;
