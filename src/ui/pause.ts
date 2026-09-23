/**
 * Pause menu ('pause'; Esc with nothing open) and save slots ('saves', 'saves:save', 'saves:load').
 *   pause   a wooden signboard hung on ropes: Resume / Save / Load / Options / Quit to title, plus a
 *           "today" card (date, weather, purse, season progress, next birthday)
 *   saves   three hand-labelled slots + the overnight autosave, each with a painted season thumbnail,
 *           date, purse and "saved 3 min ago"; save, load, and delete with a confirm step
 */
import type { Game } from '../core/game';
import { NPCS, type NpcId } from '../data/npcs';
import { portraitSvg } from './portraits';
import { ICONS } from './icons';
import { Screen, el, frame, closeButton, sfx, replay, escapeHtml } from './kit';

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };
const SEASONS = ['spring', 'summer', 'fall', 'winter'];
const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Reset the follow camera to the gameplay framing (after the title's orbit or a load). */
export function resetCamera(game: Game): void {
  const rig = game.rc.rig;
  rig.yaw = 0;
  rig.pitch = 50;
  rig.distance = 24;
  rig.lookOffset.set(0, 0, 0);
  game.followPlayer(true);
}

function nextBirthday(game: Game): { name: string; season: string; day: number } | null {
  const c = game.calendar;
  const now = SEASONS.indexOf(c.season) * 28 + c.day;
  let best: { name: string; season: string; day: number; d: number } | null = null;
  for (const n of Object.values(NPCS)) {
    const b = (n as { birthday?: { season: string; day: number } }).birthday;
    if (!b) continue;
    let d = SEASONS.indexOf(b.season) * 28 + b.day - now;
    if (d < 0) d += 112;
    if (!best || d < best.d) best = { name: n.name.split(' ')[0]!, season: b.season, day: b.day, d };
  }
  return best;
}

export class PauseScreen extends Screen {
  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-pause', { backdrop: true });
  }

  protected render(): void {
    this.root.querySelector('.u-pop')?.remove();
    const c = this.game.calendar;
    const wrap = el('div', 'pause-wrap u-pop');
    const sign = el('div', 'pause-sign');
    sign.innerHTML = `<i class="rope l"></i><i class="rope r"></i><div class="board"><div class="nail l"></div><div class="nail r"></div><h2>Paused</h2><p>${WEEKDAY[(c.day - 1) % 7]}, ${SEASON_NAME[c.season]} ${c.day} · ${c.clockString()}</p></div>`;
    const menu = el('div', 'pause-menu');
    const items: [string, string, string, string][] = [
      ['resume', 'Resume', 'play', 'green is-default'],
      ['save', 'Save Game', 'save', ''],
      ['load', 'Load Game', 'door', ''],
      ['settings', 'Options', 'gear', ''],
      ['title', 'Quit to Title', 'x', 'red'],
    ];
    for (const [id, label, icon, cls] of items) {
      const b = el('button', `u-btn ${cls}`, `${ICONS[icon] ?? ''}<span>${label}</span>`);
      b.dataset.nav = '';
      if (cls.includes('is-default')) b.classList.add('is-default');
      b.addEventListener('click', () => this.action(id));
      menu.appendChild(b);
    }
    sign.querySelector('.board')!.appendChild(menu);
    // Today card.
    const bd = nextBirthday(this.game);
    const gold = this.game.services.economy?.gold() ?? 0;
    const weather = c.weather;
    const { frame: f, body } = frame('Today', 'pause-today');
    body.innerHTML = `
      <div class="td-row"><span class="ic">${ICONS[c.season]}</span><div><b>${SEASON_NAME[c.season]} ${c.day}</b><small>Year ${c.year}</small></div></div>
      <div class="td-row"><span class="ic">${ICONS[weather === 'sun' && c.hour >= 19.5 ? 'moon' : weather] ?? ICONS.sun}</span><div><b>${weather === 'sun' ? 'Clear skies' : weather === 'rain' ? 'Steady rain' : weather === 'storm' ? 'Thunderstorm' : weather === 'snow' ? 'Snowfall' : 'Breezy'}</b><small>${weather === 'rain' || weather === 'storm' ? 'crops water themselves' : 'good day for the fields'}</small></div></div>
      <div class="td-row"><span class="ic">${ICONS.coin}</span><div><b>${gold.toLocaleString()}g</b><small>in your purse</small></div></div>
      ${bd ? `<div class="td-row"><span class="ic">${ICONS.heart}</span><div><b>${escapeHtml(bd.name)}’s birthday</b><small>${SEASON_NAME[bd.season]} ${bd.day}</small></div></div>` : ''}
      <div class="td-prog"><div class="lbl"><span>Season</span><span>${c.day} / 28</span></div><div class="track"><div class="fill" style="width:${(c.day / 28) * 100}%"></div></div></div>
      ${this.objective()}
      ${this.friends()}`;
    wrap.append(sign, f);
    this.root.appendChild(wrap);
  }

  /** Current story goal (first active quest), else the next Lantern Hall bundle. */
  private objective(): string {
    let title = '';
    let goal = '';
    let prog: [number, number] | undefined;
    try {
      const q = this.game.services.story?.quests().find((x) => x.state === 'active');
      if (q) {
        title = q.title;
        goal = q.goal;
        prog = q.progress;
      } else {
        const b = this.game.services.quests?.bundles().find((x) => !this.game.services.quests?.bundleDone((x as { def?: { id: string } }).def?.id ?? ''));
        const lit = this.game.services.quests?.lanternsLit() ?? 0;
        title = 'Relight the Lantern Hall';
        goal = b ? `${lit} of 6 lanterns lit — bring goods to the bundles` : 'Every lantern burns bright';
      }
    } catch {
      /* services still booting */
    }
    if (!title) {
      title = 'Wake the old farm';
      goal = 'Clear a patch, plant parsnips and ship your first harvest';
    }
    const pct = prog ? Math.min(100, (prog[0] / Math.max(1, prog[1])) * 100) : -1;
    return `<div class="td-quest"><div class="lbl">${ICONS.quill ?? ''}<span>Objective</span></div><b>${escapeHtml(title)}</b><small>${escapeHtml(goal)}</small>${pct >= 0 ? `<div class="track"><div class="fill" style="width:${pct}%"></div></div>` : ''}</div>`;
  }

  /** The three villagers you're closest to, with their heart meters. */
  private friends(): string {
    const rel = this.game.services.relationships;
    const ids = Object.keys(NPCS) as NpcId[];
    const top = ids
      .map((id) => ({ id, pts: rel?.points(id) ?? 0, h: rel?.hearts(id) ?? 0 }))
      .sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id))
      .slice(0, 3);
    const row = top
      .map(({ id, h }) => {
        const n = NPCS[id];
        let face = '';
        try {
          face = portraitSvg(n.look, n.portraitBg, 'happy');
        } catch {
          /* no portrait */
        }
        const hearts = Array.from({ length: 5 }, (_, i) => `<i class="${h >= (i + 1) * 2 ? 'on' : h >= i * 2 + 1 ? 'half' : ''}"></i>`).join('');
        return `<div class="td-friend"><span class="pf">${face}</span><div><b>${escapeHtml(n.name.split(' ')[0]!)}</b><span class="hs">${hearts}</span></div></div>`;
      })
      .join('');
    return `<div class="td-friends"><div class="lbl">${ICONS.heart ?? ''}<span>Closest friends</span></div><div class="row">${row}</div></div>`;
  }

  private action(id: string): void {
    sfx(this.game, 'click');
    if (id === 'resume') this.requestClose();
    else if (id === 'save') this.game.events.emit('ui:open', { name: 'saves:save' });
    else if (id === 'load') this.game.events.emit('ui:open', { name: 'saves:load' });
    else if (id === 'settings') this.game.events.emit('ui:open', { name: 'settings' });
    else if (id === 'title') {
      this.game.events.emit('ui:open', { name: 'none' });
      void this.game.hud.fade(true).then(() => {
        this.game.events.emit('ui:open', { name: 'title' });
        void this.game.hud.fade(false);
      });
    }
  }
}

interface SlotInfo {
  slot: string;
  label: string;
  exists: boolean;
  season?: string;
  day?: number;
  year?: number;
  gold?: number;
  savedAt?: string;
}

function readSlot(slot: string, label: string): SlotInfo {
  try {
    const raw = localStorage.getItem(`hearthvale.save.${slot}`);
    if (!raw) return { slot, label, exists: false };
    const f = JSON.parse(raw) as { savedAt?: string; data?: Record<string, { calendar?: { season?: string; day?: number; year?: number }; gold?: number }> };
    const cal = f.data?.core?.calendar;
    return { slot, label, exists: true, season: cal?.season, day: cal?.day, year: cal?.year, gold: f.data?.economy?.gold, savedAt: f.savedAt };
  } catch {
    return { slot, label, exists: false };
  }
}

function ago(iso?: string): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function thumb(season = 'spring'): string {
  const land: Record<string, [string, string, string]> = {
    spring: ['#bfe4ff', '#8fcf5a', '#5fa83c'],
    summer: ['#9fd4ff', '#6fb04a', '#3f8a34'],
    fall: ['#ffd0a0', '#e0a040', '#b8602a'],
    winter: ['#d8e8f4', '#f4f8fb', '#c4d4e4'],
  };
  const [sky, h1, h2] = land[season] ?? land.spring!;
  return `<svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice"><rect width="120" height="80" fill="${sky}"/><circle cx="92" cy="20" r="9" fill="#ffe08a"/><path d="M0 44 C30 30 60 34 80 42 C96 48 110 38 120 40 V80 H0 Z" fill="${h1}"/><path d="M0 60 C34 50 70 54 120 58 V80 H0 Z" fill="${h2}"/><g transform="translate(38 44)"><rect x="-10" y="-2" width="20" height="13" fill="#f2e2c0" stroke="#3b2313" stroke-width="1.4"/><path d="M-13 -1 L0 -12 L13 -1 Z" fill="#c8573e" stroke="#3b2313" stroke-width="1.4"/><rect x="-2.5" y="4" width="5" height="7" fill="#8a5a36"/></g>${[0, 1, 2, 3].map((i) => `<rect x="${62 + i * 7}" y="58" width="4" height="12" rx="1" fill="#7a4e2e"/>`).join('')}</svg>`;
}

/** Empty journal page: a faint graphite sketch of the farm waiting to be drawn in. */
function blankThumb(): string {
  const g = 'fill="none" stroke="#b09470" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 120 80" class="sketch" preserveAspectRatio="xMidYMid slice"><rect width="120" height="80" fill="#fbf3de"/><g ${g} opacity=".75"><path d="M4 46 C30 34 58 38 80 44 C96 49 108 41 116 42"/><path d="M6 62 C36 54 70 57 114 60" stroke-dasharray="3 3"/><path d="M28 43 V32 H48 V43"/><path d="M25 33 L38 23 L51 33"/><path d="M36 43 V37 H40 V43"/><path d="M62 58 V52 M69 58 V51 M76 58 V52 M83 58 V51"/><path d="M92 18 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0" stroke-dasharray="2 2.4"/></g><path d="M86 70 L104 52 L108 56 L90 74 L84 76 Z" fill="#f2c86a" stroke="#6a4428" stroke-width="1.2"/><path d="M84 76 L86 70 L90 74 Z" fill="#3b2313"/><path d="M104 52 L108 56 L110 54 C111 53 111 51 110 50 L108 48 C107 47 105 47 104 48 L102 50 Z" fill="#e89a9a" stroke="#6a4428" stroke-width="1.2"/></svg>`;
}

export class SavesScreen extends Screen {
  private mode: 'save' | 'load' = 'load';
  private confirm: string | null = null;
  private fromTitle = false;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-saves', { backdrop: true });
  }

  protected render(arg?: string): void {
    const [mode, from] = (arg ?? '').split(':');
    if (mode === 'save' || mode === 'load') this.mode = mode;
    this.fromTitle = from === 'title';
    if (this.fromTitle) this.game.hud.root.classList.add('hv-title-mode');
    this.confirm = null;
    this.draw();
  }

  private draw(focusSlot?: string): void {
    this.root.querySelector('.u-pop')?.remove();
    const wrap = el('div', 'saves-wrap u-pop');
    const { frame: f, body } = frame(this.mode === 'save' ? 'Save Game' : 'Load Game', 'saves-frame');
    f.appendChild(closeButton(() => this.back() || this.requestClose()));
    const slots = [readSlot('slot1', 'Journal I'), readSlot('slot2', 'Journal II'), readSlot('slot3', 'Journal III'), readSlot('auto', 'Overnight autosave')];
    const modeTabs = el('div', 'shop-tabs saves-mode');
    for (const m of ['save', 'load'] as const) {
      const b = el('button', `shop-tab${m === this.mode ? ' on' : ''}`, m === 'save' ? `${ICONS.save}<span>Save</span>` : `${ICONS.door}<span>Load</span>`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        this.mode = m;
        sfx(this.game, 'tab');
        this.draw();
      });
      modeTabs.appendChild(b);
    }
    const grid = el('div', 'saves-grid');
    slots.forEach((s, i) => {
      const card = el('div', `save-card${s.exists ? '' : ' empty'}${s.slot === 'auto' ? ' auto' : ''}`);
      card.style.animationDelay = `${i * 60}ms`;
      const canSave = this.mode === 'save' && s.slot !== 'auto';
      const confirming = this.confirm === s.slot;
      card.innerHTML = `
        <div class="thumb">${s.exists ? thumb(s.season) : `<div class="blank">${blankThumb()}</div>`}<span class="tag">${escapeHtml(s.label)}</span></div>
        <div class="meta">${
          s.exists
            ? `<b>${SEASON_NAME[s.season ?? 'spring']} ${s.day ?? 1}, Year ${s.year ?? 1}</b><span>${ICONS.coin}${(s.gold ?? 0).toLocaleString()}g</span><small>saved ${ago(s.savedAt)}</small>`
            : `<b>Empty page</b><small>${s.slot === 'auto' ? 'written each night when you sleep' : 'a fresh page in the journal'}</small>`
        }</div>
        <div class="acts"></div>`;
      const acts = card.querySelector('.acts')!;
      const btn = (label: string, cls: string, fn: () => void, def = false): void => {
        const b = el('button', `u-btn small ${cls}${def ? ' is-default' : ''}`, label);
        b.dataset.nav = '';
        b.dataset.slot = s.slot;
        b.addEventListener('click', fn);
        acts.appendChild(b);
      };
      if (confirming) {
        card.classList.add('confirm');
        btn('Delete forever', 'red', () => this.remove(s.slot), true);
        btn('Keep', '', () => {
          this.confirm = null;
          this.draw(s.slot);
        });
      } else if (canSave) {
        btn(s.exists ? 'Overwrite' : 'Save here', 'green', () => this.save(s.slot, card), i === 0);
        if (s.exists)
          btn('✕', 'red', () => {
            this.confirm = s.slot;
            sfx(this.game, 'error');
            this.draw(s.slot);
          });
      } else if (this.mode === 'load') {
        if (s.exists) {
          btn('Load', 'blue', () => this.load(s.slot), !this.root.querySelector('.is-default'));
          if (s.slot !== 'auto')
            btn('✕', 'red', () => {
              this.confirm = s.slot;
              sfx(this.game, 'error');
              this.draw(s.slot);
            });
        }
      }
      grid.appendChild(card);
    });
    body.append(modeTabs, grid);
    wrap.appendChild(f);
    this.root.appendChild(wrap);
    const focus = focusSlot ? this.root.querySelector<HTMLElement>(`[data-slot="${focusSlot}"]`) : this.root.querySelector<HTMLElement>('.is-default');
    this.nav.attach(this.root, focus);
  }

  private save(slot: string, card: HTMLElement): void {
    if (this.game.saves.save(slot)) {
      sfx(this.game, 'craft');
      replay(card, 'saved');
      setTimeout(() => this.isOpen && this.draw(slot), 420);
    } else sfx(this.game, 'error');
  }

  private load(slot: string): void {
    const fromTitle = this.fromTitle;
    void this.game.hud.fade(true).then(() => {
      const ok = this.game.saves.load(slot);
      this.fromTitle = false;
      this.game.events.emit('ui:open', { name: 'none' });
      this.game.hud.root.classList.remove('hv-title-mode');
      if (ok) {
        this.game.setPaused(false);
        resetCamera(this.game);
      } else if (fromTitle) this.game.events.emit('ui:open', { name: 'title' });
      setTimeout(() => void this.game.hud.fade(false), 200);
    });
  }

  private remove(slot: string): void {
    this.game.saves.delete(slot);
    this.confirm = null;
    sfx(this.game, 'trash');
    this.draw();
  }

  override back(): boolean {
    if (this.confirm) {
      this.confirm = null;
      this.draw();
      return true;
    }
    if (this.fromTitle) {
      this.game.events.emit('ui:open', { name: 'title' });
      return true;
    }
    return false;
  }

  protected override onClose(): void {
    if (this.fromTitle) this.game.hud.root.classList.remove('hv-title-mode');
  }
}
