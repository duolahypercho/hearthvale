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
import { Hud } from './hud';

export interface Settings {
  quality: Quality;
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  toasts: boolean;
  tooltips: boolean;
  clock24: boolean;
  /** Interface scale multiplier on top of the automatic resolution fit (0.8 – 1.25). */
  uiScale: number;
  /** Shorter, calmer UI animations. */
  calm: boolean;
  /** Frame-rate cap: 0 = Auto (steady rate the display + scene can hold), -1 = Uncapped, else 60 / 120 (legacy 30). */
  fpsCap: number;
  /** Frame counter chip under the clock. */
  showFps: boolean;
  /** Key / button hint strips on menus (backpack footer, title, tooltips). */
  hints: boolean;
  /** Darker, heavier small print on parchment. */
  contrast: boolean;
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
const DEFAULTS: Settings = { quality: 'high', master: 0.8, music: 0.7, sfx: 0.9, ambience: 0.7, toasts: true, tooltips: true, clock24: false, uiScale: 1, calm: false, fpsCap: 0, showFps: false, hints: true, contrast: false, keys: {} };

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
  applyUiScale();
  window.addEventListener('resize', applyUiScale, { passive: true });
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
  document.body.classList.toggle('u-calm', settings.calm);
  document.body.classList.toggle('u-no-hints', !settings.hints);
  document.body.classList.toggle('u-contrast', settings.contrast);
  game.frameCap = settings.fpsCap || 0;
  applyUiScale();
}

/** Design resolution: the UI is laid out for 1920×1080 and zoomed to fit the window (× the player's scale). */
export function uiZoom(): number {
  // Softened fit: small windows keep the UI a little larger than a pure scale-down (readability), big
  // ones grow it a little less.
  const fit = Math.pow(Math.min(innerWidth / 1920, innerHeight / 1080), 0.75);
  return Math.max(0.6, Math.min(1.35, fit)) * (settings.uiScale || 1);
}

function applyUiScale(): void {
  document.documentElement.style.setProperty('--uiz', uiZoom().toFixed(3));
}

export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { ShiftLeft: 'Shift', ShiftRight: 'R-Shift', Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ControlLeft: 'Ctrl', AltLeft: 'Alt', Backquote: '`', Semicolon: ';', Comma: ',', Period: '.', Slash: '/' };
  return map[code] ?? code;
}

type SliderKey = 'master' | 'music' | 'sfx' | 'ambience' | 'uiScale';
type ToggleKey = 'toasts' | 'tooltips' | 'clock24' | 'calm' | 'showFps' | 'hints' | 'contrast';
type Row = { kind: 'slider'; key: SliderKey; label: string; icon: string } | { kind: 'toggle'; key: ToggleKey; label: string; note: string };

/** Keys the rebinder refuses (toolbar digits, menu / tab keys). */
const RESERVED = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'BracketLeft', 'BracketRight', 'Tab', 'F11']);

/** Gamepad legend (standard mapping): glyph, glyph style, what it does. Driven by hud.ts pollPad. */
export const PAD_MAP: [string, string, string][] = [
  ['A', 'a', 'Talk · select'],
  ['X', 'x', 'Use tool'],
  ['B', 'b', 'Run · back'],
  ['Y', 'y', 'Backpack'],
  ['LB', 'sh', 'Toolbar ◂'],
  ['RB', 'sh', 'Toolbar ▸'],
  ['L', 'st', 'Walk'],
  ['☰', 'sys', 'Pause'],
];

const PAD_ICON = `<svg viewBox="0 0 24 24"><path d="M6.6 7 H17.4 C20 7 21.6 9.4 22 13 L22.6 17.4 C22.8 19 21.2 20.2 19.8 19.2 L16.6 16.6 H7.4 L4.2 19.2 C2.8 20.2 1.2 19 1.4 17.4 L2 13 C2.4 9.4 4 7 6.6 7 Z" fill="#8a94a6" stroke="#2e3440" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.6 10.4 V14 M4.8 12.2 H8.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.4" cy="11" r="1.2" fill="#5fb85a"/><circle cx="18.6" cy="13.2" r="1.2" fill="#e0584a"/><circle cx="14.2" cy="13.2" r="1.2" fill="#4a8ae0"/><circle cx="16.4" cy="15.2" r="1.2" fill="#f0c040"/></svg>`;

function padName(): string {
  try {
    const gp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    return gp ? 'connected' : 'plug in to play';
  } catch {
    return '';
  }
}

export class SettingsScreen extends Screen {
  private fromTitle = false;
  private fpsLine: HTMLElement | null = null;
  private fpsT = 0;

  /** Live frame rate under the quality pills: the cost of each preset, measured on this machine. */
  override update(dt: number): void {
    this.fpsT -= dt;
    if (this.fpsT > 0 || !this.fpsLine) return;
    this.fpsT = 0.5;
    const fps = Math.round(Hud.playFps || Hud.fps);
    if (!fps) return;
    const tone = fps >= 55 ? 'good' : fps >= 40 ? 'ok' : 'bad';
    const hint = tone === 'good' ? 'smooth' : tone === 'ok' ? 'try Medium for 60' : 'try Low for 60';
    this.fpsLine.className = `set-fpsline ${tone}`;
    this.fpsLine.innerHTML = `<i></i>${Hud.playFps ? 'In play' : 'Running at'} <b>${fps} fps</b><small>${this.game.rc.quality} · ${hint}</small>`;
  }

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
    const colA = el('div', 'set-col a');
    const colB = el('div', 'set-col b');
    const colC = el('div', 'set-col c');

    // Graphics
    const gfx = el('section', 'set-sec', `<h3>${ICONS.sun}<span>Graphics</span></h3>`);
    const seg = el('div', 'set-seg');
    const QUALITIES: [Quality, string, string, number][] = [
      ['low', 'Low', 'fastest', 1],
      ['medium', 'Medium', 'light', 2],
      ['high', 'High', 'recommended', 3],
      ['ultra', 'Ultra', 'showcase', 4],
    ];
    // Pips climb with scene detail (what "quality" promises); the fps line under the row speaks for speed.
    for (const [q, label, note, detail] of QUALITIES) {
      const b = el('button', `seg${this.game.rc.quality === q ? ' on' : ''}`, `<b>${label}</b><small>${note}</small><i class="spd" title="scene detail">${'<em></em>'.repeat(detail)}${'<em class="off"></em>'.repeat(4 - detail)}</i>`);
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
    this.fpsLine = el('div', 'set-fpsline', '');
    gfx.append(el('div', 'set-label', 'Render quality <small>post effects, shadows, grass</small>'), seg, this.fpsLine);

    // Display
    const disp = el('section', 'set-sec', `<h3>${ICONS.screen}<span>Display</span></h3>`);
    const fs = el('button', `set-toggle${document.fullscreenElement ? ' on' : ''}`, `<span class="lb">Fullscreen<small>F11 works too</small></span><span class="sw"><i></i></span>`);
    fs.dataset.nav = '';
    fs.addEventListener('click', () => {
      sfx(this.game, 'toggle');
      const on = !document.fullscreenElement;
      const p = on ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.();
      void p?.catch(() => {}).finally(() => fs.classList.toggle('on', !!document.fullscreenElement));
      fs.classList.toggle('on', on);
    });
    const capRow = el('div', 'set-caprow', `<span class="lb">Frame rate<small>Auto keeps it steady</small></span>`);
    const capSeg = el('div', 'set-seg mini cap4');
    for (const [v, label] of [
      [0, 'Auto'],
      [60, '60'],
      [120, '120'],
      [-1, 'Uncapped'],
    ] as [number, string][]) {
      const b = el('button', `seg${(settings.fpsCap || 0) === v ? ' on' : ''}`, `<b>${label}</b>`);
      b.dataset.nav = '';
      b.addEventListener('click', () => {
        settings.fpsCap = v;
        save();
        apply(this.game);
        sfx(this.game, 'toggle');
        capSeg.querySelectorAll('.seg').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        replay(b, 'bump');
      });
      capSeg.appendChild(b);
    }
    capRow.appendChild(capSeg);
    disp.append(fs, capRow, this.toggle('showFps', 'Show FPS', 'frame counter under the clock'));
    // Accessibility
    const acc = el('section', 'set-sec', `<h3>${ICONS.people}<span>Accessibility</span></h3>`);
    acc.append(this.slider('uiScale', 'UI size', 0.8, 1.25), this.toggle('calm', 'Reduce motion', 'gentler animations'), this.toggle('contrast', 'High-contrast text', 'darker small print'));
    colA.append(gfx, disp, acc);

    // Audio
    const aud = el('section', 'set-sec', `<h3>${ICONS.speaker}<span>Sound</span></h3>`);
    for (const [key, label] of [
      ['master', 'Master'],
      ['music', 'Music'],
      ['sfx', 'Effects'],
      ['ambience', 'Ambience'],
    ] as [SliderKey, string][])
      aud.appendChild(this.slider(key, label));

    // Interface
    const ui = el('section', 'set-sec', `<h3>${ICONS.gear}<span>Interface</span></h3>`);
    const toggles: Row[] = [
      { kind: 'toggle', key: 'toasts', label: 'Pickup notes', note: 'toasts in the corner' },
      { kind: 'toggle', key: 'tooltips', label: 'Item tooltips', note: 'hover cards' },
      { kind: 'toggle', key: 'clock24', label: '24-hour clock', note: 'HUD time format' },
      { kind: 'toggle', key: 'hints', label: 'Control hints', note: 'key & button prompts' },
    ];
    for (const t of toggles) if (t.kind === 'toggle') ui.appendChild(this.toggle(t.key, t.label, t.note));

    // Gamepad: every button as a glyph chip (2 columns, so no lone word ever wraps).
    const pad = el('section', 'set-sec pad', `<h3>${PAD_ICON}<span>Gamepad</span><small class="pad-state">${padName()}</small></h3>`);
    pad.appendChild(
      el(
        'div',
        'set-pad',
        PAD_MAP.map(([g, cls, label]) => `<div class="pc"><i class="gl ${cls}">${g}</i><span>${label}</span></div>`).join(''),
      ),
    );
    colB.append(aud, ui, pad);

    // Controls
    const ctl = el('section', 'set-sec keys', `<h3>${ICONS.hammer}<span>Controls</span><small class="kb-hint">click a key to rebind</small></h3>`);
    const list = el('div', 'set-keys');
    for (const [action, label, def] of BINDABLE) {
      const cur = settings.keys[action] ?? def;
      const row = el('div', 'krow', `<span>${label}</span><button class="kcap" data-nav>${keyLabel(cur)}</button>`);
      row.dataset.action = action;
      const cap = row.querySelector('.kcap') as HTMLElement;
      cap.addEventListener('click', () => {
        sfx(this.game, 'click');
        this.root.querySelectorAll('.krow.listening').forEach((r) => r.classList.remove('listening'));
        row.classList.add('listening');
        cap.classList.add('listening');
        cap.textContent = 'press a key…';
        capture = (code) => {
          cap.classList.remove('listening');
          row.classList.remove('listening');
          let flash: [string, string, string][] = [];
          if (code === 'Escape') {
            /* cancelled */
          } else if (RESERVED.has(code)) {
            flash = [[action, 'bad', `${keyLabel(code)} is reserved`]];
            sfx(this.game, 'error');
          } else {
            // A key drives one action: if another action had it, the two swap keys (flagged on both rows).
            const prev = settings.keys[action] ?? def;
            for (const [a, la, d] of BINDABLE) {
              if (a === action || (settings.keys[a] ?? d) !== code) continue;
              settings.keys[a] = prev;
              flash = [
                [a, 'swap', `now ${keyLabel(prev)}`],
                [action, 'swap', `swapped with ${la}`],
              ];
            }
            settings.keys[action] = code;
            rebuildRemap();
            save();
            sfx(this.game, 'toggle');
          }
          this.render();
          this.nav.attach(this.root, [...this.root.querySelectorAll<HTMLElement>('.kcap')][BINDABLE.findIndex((b) => b[0] === action)] ?? null);
          this.root.classList.remove('is-opening');
          for (const [a, cls, msg] of flash) {
            const r = this.root.querySelector<HTMLElement>(`.krow[data-action="${a}"]`);
            if (!r) continue;
            r.classList.add(cls);
            r.appendChild(el('em', 'kmsg', msg));
            window.setTimeout(() => {
              r.classList.remove(cls);
              r.querySelector('.kmsg')?.remove();
            }, 2400);
          }
        };
      });
      list.appendChild(row);
    }
    const fixed = el('div', 'set-fixed', `<div><span>Toolbar</span><b><kbd>1</kbd>–<kbd>0</kbd> · wheel</b></div><div><span>Menu / back</span><b><kbd>Esc</kbd></b></div><div><span>Switch tabs</span><b><kbd>[</kbd> <kbd>]</kbd></b></div>`);
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
    colC.append(ctl);
    body.append(colA, colB, colC);
    this.root.appendChild(wrap);
  }

  private slider(key: SliderKey, label: string, min = 0, max = 1): HTMLElement {
    const row = el('div', 'set-slider', `<span class="lb">${label}</span><div class="groove"><div class="fill"></div><div class="knob"></div></div><b class="pct"></b>`);
    row.dataset.nav = '';
    row.dataset.noclick = '1';
    row.dataset.slider = key;
    const groove = row.querySelector('.groove') as HTMLElement;
    // Values snap to 5 % steps; the groove spans [min, max].
    // The UI size applies on release, so the panel doesn't rescale under the pointer mid-drag.
    let dragging = false;
    const set = (v: number, quiet = false): void => {
      const prev = settings[key];
      settings[key] = Math.round(Math.max(min, Math.min(max, v)) * 20) / 20;
      const t = (settings[key] - min) / (max - min);
      (row.querySelector('.fill') as HTMLElement).style.width = `${t * 100}%`;
      (row.querySelector('.knob') as HTMLElement).style.left = `${t * 100}%`;
      (row.querySelector('.pct') as HTMLElement).textContent = `${Math.round(settings[key] * 100)}${key === 'uiScale' ? '%' : ''}`;
      if (!quiet && settings[key] !== prev) {
        save();
        if (!(dragging && key === 'uiScale')) apply(this.game);
        sfx(this.game, 'tick');
      }
    };
    set(settings[key], true);
    const fromPointer = (e: PointerEvent): void => {
      const r = groove.getBoundingClientRect();
      set(min + ((e.clientX - r.left) / r.width) * (max - min));
    };
    groove.addEventListener('pointerdown', (e) => {
      groove.setPointerCapture(e.pointerId);
      dragging = true;
      fromPointer(e);
      const move = (ev: PointerEvent): void => fromPointer(ev);
      const up = (): void => {
        dragging = false;
        if (key === 'uiScale') apply(this.game);
        groove.removeEventListener('pointermove', move);
        groove.removeEventListener('pointerup', up);
      };
      groove.addEventListener('pointermove', move);
      groove.addEventListener('pointerup', up);
    });
    (row as HTMLElement & { adjust?: (d: number) => void }).adjust = (d: number) => set(settings[key] + d);
    return row;
  }

  private toggle(key: ToggleKey, label: string, note: string): HTMLElement {
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
