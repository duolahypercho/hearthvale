/**
 * Options ('settings'): graphics quality, audio mix, interface toggles and key bindings.
 * Persisted in localStorage `hearthvale.settings`; applied on boot by loadSettings().
 *
 * Rebinding works without touching core/input.ts: a capture-phase key listener translates the player's
 * chosen physical key into the default key code of that action (synthetic event), so every system that
 * listens for the defaults keeps working.
 *   out: settings:change (audio can read music / sfx / ambience levels)
 */
import type { Game } from '../core/game';
import type { Quality } from '../core/events';
import { ICONS } from './icons';
import { Screen, el, frame, closeButton, sfx, replay } from './kit';
import { menuTabs } from './menutabs';

export interface Settings {
  quality: Quality;
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  toasts: boolean;
  tooltips: boolean;
  clock24: boolean;
  /** action → physical key code */
  keys: Record<string, string>;
}

declare module '../core/events' {
  interface GameEvents {
    'settings:change': { settings: Settings };
  }
}

/** Rebindable actions and their default key (the code the game listens for). */
export const BINDABLE: [string, string, string][] = [
  ['up', 'Move up', 'KeyW'],
  ['down', 'Move down', 'KeyS'],
  ['left', 'Move left', 'KeyA'],
  ['right', 'Move right', 'KeyD'],
  ['use', 'Use tool', 'KeyC'],
  ['interact', 'Interact / talk', 'KeyX'],
  ['inventory', 'Backpack', 'KeyE'],
  ['map', 'Map', 'KeyM'],
  ['run', 'Run (hold)', 'ShiftLeft'],
];

const KEY = 'hearthvale.settings';
const DEFAULTS: Settings = { quality: 'high', master: 0.8, music: 0.7, sfx: 0.9, ambience: 0.7, toasts: true, tooltips: true, clock24: false, keys: {} };

export const settings: Settings = { ...DEFAULTS, keys: {} };
/** physical code → default code */
const remap = new Map<string, string>();
let capture: ((code: string) => void) | null = null;

function rebuildRemap(): void {
  remap.clear();
  for (const [action, , def] of BINDABLE) {
    const k = settings.keys[action];
    if (k && k !== def) remap.set(k, def);
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked */
  }
}

let installed = false;
function installRemap(): void {
  if (installed) return;
  installed = true;
  const handler = (e: KeyboardEvent): void => {
    if (!e.isTrusted) return;
    if (capture && e.type === 'keydown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const cb = capture;
      capture = null;
      cb(e.code);
      return;
    }
    const to = remap.get(e.code);
    if (!to) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    window.dispatchEvent(new KeyboardEvent(e.type, { code: to, key: to, repeat: e.repeat, bubbles: true, cancelable: true }));
  };
  window.addEventListener('keydown', handler, true);
  window.addEventListener('keyup', handler, true);
}

export function loadSettings(game: Game): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, DEFAULTS, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  settings.keys ??= {};
  rebuildRemap();
  installRemap();
  // URL ?quality= wins; otherwise restore the player's choice once systems exist.
  const urlQ = new URLSearchParams(location.search).get('quality');
  queueMicrotask(() => {
    if (!urlQ && settings.quality !== game.rc.quality) game.setQuality(settings.quality);
    else settings.quality = game.rc.quality;
    apply(game);
  });
}

function apply(game: Game): void {
  game.services.audio?.setVolume(settings.master);
  game.events.emit('settings:change', { settings });
  document.body.classList.toggle('u-no-toasts', !settings.toasts);
  document.body.classList.toggle('u-no-tips', !settings.tooltips);
}

export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { ShiftLeft: 'Shift', ShiftRight: 'R-Shift', Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ControlLeft: 'Ctrl', AltLeft: 'Alt', Backquote: '`', Semicolon: ';', Comma: ',', Period: '.', Slash: '/' };
  return map[code] ?? code;
}

type Row = { kind: 'slider'; key: 'master' | 'music' | 'sfx' | 'ambience'; label: string; icon: string } | { kind: 'toggle'; key: 'toasts' | 'tooltips' | 'clock24'; label: string; note: string };

export class SettingsScreen extends Screen {
  private fromTitle = false;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-settings', { backdrop: true });
  }

  protected render(arg?: string): void {
    if (arg !== undefined) this.fromTitle = arg === 'title';
    else if (!this.root.querySelector('.u-pop')) this.fromTitle = false;
    if (this.fromTitle) this.game.hud.root.classList.add('hv-title-mode');
    this.root.querySelector('.u-pop')?.remove();
    const wrap = el('div', 'set-wrap u-pop');
    const { frame: f, body } = frame('Options', 'set-frame');
    f.appendChild(closeButton(() => this.back() || this.requestClose()));
    if (this.fromTitle) wrap.append(f);
    else wrap.append(menuTabs(this.game, 'settings'), f);
    const colA = el('div', 'set-col');
    const colB = el('div', 'set-col');

    // Graphics
    const gfx = el('section', 'set-sec', `<h3>${ICONS.sun}<span>Graphics</span></h3>`);
    const seg = el('div', 'set-seg');
    const QUALITIES: [Quality, string, string][] = [
      ['low', 'Low', 'fast'],
      ['medium', 'Medium', 'balanced'],
      ['high', 'High', 'recommended'],
      ['ultra', 'Ultra', 'showcase'],
    ];
    for (const [q, label, note] of QUALITIES) {
      const b = el('button', `seg${this.game.rc.quality === q ? ' on' : ''}`, `<b>${label}</b><small>${note}</small>`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        if (this.game.rc.quality === q) return;
        this.game.setQuality(q);
        settings.quality = q;
        save();
        sfx(this.game, 'toggle');
        seg.querySelectorAll('.seg').forEach((s) => s.classList.remove('on'));
        b.classList.add('on');
        replay(b, 'bump');
      });
      seg.appendChild(b);
    }
    gfx.append(el('div', 'set-label', 'Render quality <small>post-processing, shadows, grass density</small>'), seg);

    // Audio
    const aud = el('section', 'set-sec', `<h3>${ICONS.bolt}<span>Sound</span></h3>`);
    const rows: Row[] = [
      { kind: 'slider', key: 'master', label: 'Master', icon: '🔊' },
      { kind: 'slider', key: 'music', label: 'Music', icon: '♪' },
      { kind: 'slider', key: 'sfx', label: 'Effects', icon: '✦' },
      { kind: 'slider', key: 'ambience', label: 'Ambience', icon: '≈' },
    ];
    for (const r of rows) if (r.kind === 'slider') aud.appendChild(this.slider(r.key, r.label));

    // Interface
    const ui = el('section', 'set-sec', `<h3>${ICONS.gear}<span>Interface</span></h3>`);
    const toggles: Row[] = [
      { kind: 'toggle', key: 'toasts', label: 'Pickup notifications', note: 'toasts in the corner' },
      { kind: 'toggle', key: 'tooltips', label: 'Item tooltips', note: 'hover cards' },
      { kind: 'toggle', key: 'clock24', label: '24-hour clock', note: 'HUD time format' },
    ];
    for (const t of toggles) if (t.kind === 'toggle') ui.appendChild(this.toggle(t.key, t.label, t.note));
    colA.append(gfx, aud, ui);

    // Controls
    const ctl = el('section', 'set-sec keys', `<h3>${ICONS.hammer}<span>Controls</span></h3>`);
    const list = el('div', 'set-keys');
    for (const [action, label, def] of BINDABLE) {
      const cur = settings.keys[action] ?? def;
      const row = el('div', 'krow', `<span>${label}</span><button class="kcap" data-nav>${keyLabel(cur)}</button>`);
      const cap = row.querySelector('.kcap') as HTMLElement;
      cap.addEventListener('click', () => {
        sfx(this.game, 'click');
        cap.classList.add('listening');
        cap.textContent = 'press a key…';
        capture = (code) => {
          cap.classList.remove('listening');
          if (code !== 'Escape') {
            // A key can only drive one action: clear it from any other binding.
            for (const [a, , d] of BINDABLE) if (a !== action && (settings.keys[a] ?? d) === code) settings.keys[a] = d === code ? '' : d;
            settings.keys[action] = code;
            rebuildRemap();
            save();
            sfx(this.game, 'toggle');
          }
          this.render();
          this.nav.attach(this.root, [...this.root.querySelectorAll<HTMLElement>('.kcap')][BINDABLE.findIndex((b) => b[0] === action)] ?? null);
          this.root.classList.remove('is-opening');
        };
      });
      list.appendChild(row);
    }
    const fixed = el(
      'div',
      'set-fixed',
      `<div><span>Toolbar</span><b>1 – 0 · wheel</b></div><div><span>Menu / back</span><b>Esc</b></div><div><span>Switch tabs</span><b>[ ]</b></div><div><span>Gamepad</span><b>A · B · Y · LB/RB · Start</b></div>`,
    );
    const reset = el('button', 'u-btn small', 'Reset to defaults');
    reset.dataset.nav = '';
    reset.addEventListener('click', () => {
      settings.keys = {};
      rebuildRemap();
      save();
      sfx(this.game, 'toggle');
      this.render();
      this.root.classList.remove('is-opening');
    });
    ctl.append(list, fixed, reset);
    colB.append(ctl);
    body.append(colA, colB);
    this.root.appendChild(wrap);
  }

  private slider(key: 'master' | 'music' | 'sfx' | 'ambience', label: string): HTMLElement {
    const row = el('div', 'set-slider', `<span class="lb">${label}</span><div class="groove"><div class="fill"></div><div class="knob"></div></div><b class="pct"></b>`);
    row.dataset.nav = '';
    row.dataset.noclick = '1';
    row.dataset.slider = key;
    const groove = row.querySelector('.groove') as HTMLElement;
    const set = (v: number, quiet = false): void => {
      settings[key] = Math.round(Math.max(0, Math.min(1, v)) * 20) / 20;
      (row.querySelector('.fill') as HTMLElement).style.width = `${settings[key] * 100}%`;
      (row.querySelector('.knob') as HTMLElement).style.left = `${settings[key] * 100}%`;
      (row.querySelector('.pct') as HTMLElement).textContent = `${Math.round(settings[key] * 100)}`;
      if (!quiet) {
        save();
        apply(this.game);
        sfx(this.game, 'tick');
      }
    };
    set(settings[key], true);
    const fromPointer = (e: PointerEvent): void => {
      const r = groove.getBoundingClientRect();
      set((e.clientX - r.left) / r.width);
    };
    groove.addEventListener('pointerdown', (e) => {
      groove.setPointerCapture(e.pointerId);
      fromPointer(e);
      const move = (ev: PointerEvent): void => fromPointer(ev);
      const up = (): void => {
        groove.removeEventListener('pointermove', move);
        groove.removeEventListener('pointerup', up);
      };
      groove.addEventListener('pointermove', move);
      groove.addEventListener('pointerup', up);
    });
    (row as HTMLElement & { adjust?: (d: number) => void }).adjust = (d: number) => set(settings[key] + d);
    return row;
  }

  private toggle(key: 'toasts' | 'tooltips' | 'clock24', label: string, note: string): HTMLElement {
    const row = el('button', `set-toggle${settings[key] ? ' on' : ''}`, `<span class="lb">${label}<small>${note}</small></span><span class="sw"><i></i></span>`);
    row.dataset.nav = '';
    row.addEventListener('click', () => {
      settings[key] = !settings[key];
      row.classList.toggle('on', settings[key]);
      save();
      apply(this.game);
      sfx(this.game, 'toggle');
    });
    return row;
  }

  override key(code: string): boolean {
    const cur = this.nav.current as (HTMLElement & { adjust?: (d: number) => void }) | null;
    if (cur?.adjust && (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD')) {
      cur.adjust(code === 'ArrowLeft' || code === 'KeyA' ? -0.05 : 0.05);
      return true;
    }
    return false;
  }

  protected override initialFocus(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>('.seg.on');
  }

  override back(): boolean {
    if (capture) {
      capture = null;
      this.render();
      return true;
    }
    if (this.fromTitle) {
      this.game.events.emit('ui:open', { name: 'title' });
      return true;
    }
    return false;
  }

  protected override onClose(): void {
    capture = null;
    if (this.fromTitle) this.game.hud.root.classList.remove('hv-title-mode');
  }
}
