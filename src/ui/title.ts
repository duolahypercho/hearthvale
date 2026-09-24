/**
 * Title screen ('title'): the live farm at golden hour behind a warm vignette + drifting light shafts,
 * a slow camera orbit, falling blossom and dust motes, the painted "Hearthvale" wordmark (layered SVG
 * lettering with a hanging lantern and a ribbon), the story hook, and carved-wood menu signs:
 * New Game · Continue (latest save summary) · Load · Options · Credits. Keyboard / gamepad navigable.
 * New Game fades to morning and plays Grandmother's letter, then hands control to the player.
 */
import type { Game } from '../core/game';
import { ICONS } from './icons';
import { Screen, el, sfx, replay } from './kit';
import { resetCamera } from './pause';
import { journal } from './profile';

const SEASON_NAME: Record<string, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };

const LOGO_HANG = `<svg viewBox="0 0 900 300" class="ts-hang" aria-hidden="true"><defs><radialGradient id="tlGlow2" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffc85a"/><stop offset="1" stop-color="#e07a2a"/></radialGradient></defs><g class="hang" transform="translate(944 84)"><path d="M-42 40 C-54 0 -40 -62 0 -62 C12 -62 18 -52 12 -46" stroke="#3b1a08" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M-42 40 C-54 0 -40 -62 0 -62 C12 -62 18 -52 12 -46" stroke="#7a4a22" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M-46 -8 C-60 -14 -64 -30 -54 -36" stroke="#7a4a22" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M0 -60 C6 -40 3 -20 0 0" stroke="#5a3418" stroke-width="3" fill="none"/><g class="lamp"><circle cx="0" cy="20" r="46" fill="#ffcf6a" opacity=".25"/><path d="M-14 0 H14 L10 -7 H-10 Z" fill="#5a3a22"/><rect x="-13" y="0" width="26" height="36" rx="6" fill="url(#tlGlow2)" stroke="#4a2e1a" stroke-width="3"/><path d="M0 0 V36 M-13 18 H13" stroke="#5a3a22" stroke-width="1.8" opacity=".6"/><path d="M-16 36 H16 L11 44 H-11 Z" fill="#5a3a22"/></g></g>
</svg>`;

const LOGO = `<svg viewBox="0 0 900 300" class="ts-word" aria-label="Hearthvale">
<defs>
  <linearGradient id="tlFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe6"/><stop offset=".45" stop-color="#ffe9a8"/><stop offset=".56" stop-color="#ffcf6a"/><stop offset="1" stop-color="#f0a040"/></linearGradient>
  <linearGradient id="tlFill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6de"/><stop offset=".5" stop-color="#ffe2b8"/><stop offset=".56" stop-color="#ffc49a"/><stop offset="1" stop-color="#f0906a"/></linearGradient>
  <radialGradient id="tlGlow" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffc85a"/><stop offset="1" stop-color="#e07a2a"/></radialGradient>
  <path id="tlArc" d="M40 212 Q450 120 860 212"/>
  <filter id="tlShadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#2a1004" flood-opacity=".55"/></filter>
</defs>
<g filter="url(#tlShadow)">
  <text class="w0"><textPath href="#tlArc" startOffset="50%" text-anchor="middle">Hearthvale</textPath></text>
  <text class="w1"><textPath href="#tlArc" startOffset="50%" text-anchor="middle">Hearthvale</textPath></text>
  <text class="w2"><textPath href="#tlArc" startOffset="50%" text-anchor="middle">Hearth<tspan fill="url(#tlFill2)">vale</tspan></textPath></text>
</g>
<g class="sprig" transform="translate(58 122) rotate(-30) scale(.9)"><path d="M0 0 C20 -10 40 -12 64 -6" stroke="#5a3418" stroke-width="5" fill="none" stroke-linecap="round"/>${[8, 24, 40, 54]
  .map((x, i) => `<path d="M${x} ${-3 - i} c-4 -14 6 -22 14 -22 c0 10 -6 18 -14 22Z" fill="${i % 2 ? '#6fb04a' : '#8fd05a'}" stroke="#2f5a1a" stroke-width="2.4"/>`)
  .join('')}<circle cx="66" cy="-6" r="7" fill="#ff9fbf" stroke="#a8466a" stroke-width="2.4"/><circle cx="66" cy="-6" r="2.6" fill="#ffe08a"/></g>
</svg>`;

export class TitlePanel extends Screen {
  private letter: HTMLElement;
  private orbit = 0;
  private active = false;
  private raf = 0;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-title-screen', {});
    this.letter = el('div', 'hv-letter hv-hidden interactive');
    this.letter.innerHTML = `<div class="paper">
      <svg class="flower" viewBox="0 0 60 90"><path d="M30 88 C30 60 26 40 30 20" stroke="#5a7a3a" stroke-width="3" fill="none"/><path d="M29 60 C18 52 10 54 6 60 C14 64 22 64 29 60Z" fill="#8aa86a" opacity=".85"/>${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${30 + Math.cos((i / 5) * 6.28) * 9}" cy="${18 + Math.sin((i / 5) * 6.28) * 9}" rx="8" ry="5.5" fill="#d98aa8" opacity=".75" transform="rotate(${i * 72} ${30 + Math.cos((i / 5) * 6.28) * 9} ${18 + Math.sin((i / 5) * 6.28) * 9})"/>`).join('')}<circle cx="30" cy="18" r="4.5" fill="#e8c060"/></svg>
      <p class="hand">My dearest,</p>
      <p>If you are reading this, the farm is yours. Forgive the weeds — they got bolder as I got older.</p>
      <p>The soil is good and the valley is kind, though it has forgotten how to shine. When the old lantern in the Hall was lit, the whole valley glowed. Perhaps you can remind it.</p>
      <p class="hand sign">With all my love,<br/>Gran Rosalind</p>
      <svg class="seal" viewBox="0 0 80 80"><path d="M40 4 C52 6 60 2 66 12 C76 18 74 28 76 40 C78 52 72 60 64 68 C56 76 48 74 40 76 C28 78 20 74 14 66 C6 58 4 50 4 40 C4 28 8 18 16 12 C24 6 30 2 40 4Z" fill="#b8321e"/><circle cx="40" cy="40" r="24" fill="#d24a30" stroke="#8a1e10" stroke-width="3"/><path d="M40 26 L50 40 L40 54 L30 40 Z" fill="none" stroke="#ffcfb0" stroke-width="3"/><path d="M34 28 L40 22 L46 28" stroke="#ffcfb0" stroke-width="2.4" fill="none"/></svg>
      <div class="hint">click to begin</div>
    </div>`;
    parent.appendChild(this.letter);
    this.letter.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.letter.classList.add('bye');
      setTimeout(() => {
        this.letter.classList.add('hv-hidden');
        this.letter.classList.remove('bye');
        this.game.input.enabled = true;
        this.game.hud.banner(journal.farm, `${SEASON_NAME[this.game.calendar.season]} ${this.game.calendar.day} · Year ${this.game.calendar.year}`);
      }, 380);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.letter.classList.contains('hv-hidden') && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape')) this.letter.dispatchEvent(new PointerEvent('pointerdown'));
    });
  }

  private latestSave(): { slot: string; label: string } | null {
    let best: { slot: string; at: string; label: string } | null = null;
    for (const s of ['auto', 'slot1', 'slot2', 'slot3']) {
      try {
        const raw = localStorage.getItem(`hearthvale.save.${s}`);
        if (!raw) continue;
        const f = JSON.parse(raw) as { savedAt?: string; data?: { core?: { calendar?: { season?: string; day?: number; year?: number } }; economy?: { gold?: number } } };
        const at = f.savedAt ?? '';
        const cal = f.data?.core?.calendar;
        const label = `${SEASON_NAME[cal?.season ?? 'spring']} ${cal?.day ?? 1} · ${(f.data?.economy?.gold ?? 0).toLocaleString()}g`;
        if (!best || at > best.at) best = { slot: s, at, label };
      } catch {
        /* skip */
      }
    }
    return best;
  }

  protected render(): void {
    this.root.querySelectorAll(':scope > :not(.u-backdrop)').forEach((n) => n.remove());
    const latest = this.latestSave();
    const petals = Array.from({ length: 26 }, (_, i) => `<i style="--x:${(i * 47) % 100}%;--d:${8 + (i % 5) * 1.9}s;--dl:${-(i * 1.3) % 9}s;--s:${0.55 + (i % 4) * 0.2}"></i>`).join('');
    const motes = Array.from({ length: 30 }, (_, i) => `<b style="left:${(i * 37) % 100}%;top:${20 + ((i * 53) % 70)}%;animation-delay:${-(i * 0.7)}s;animation-duration:${7 + (i % 6)}s"></b>`).join('');
    this.root.innerHTML = `
      <div class="ts-rays"></div>
      <div class="ts-vignette"></div>
      <div class="ts-motes">${motes}</div>
      <div class="ts-petals">${petals}</div>
      <div class="ts-logo">
        <div class="ts-scrim"></div>
        ${LOGO}${LOGO_HANG}
        <div class="ts-ribbon"><span>a cozy valley farming tale</span></div>
      </div>
      <div class="ts-hook"><div class="u-frame"><div class="u-paper">
        <b>Grandmother Rosalind</b> left you her overgrown farm — and a letter about the lanterns of Hearthvale, dark for seven winters.
      </div></div></div>
      <div class="ts-menu"></div>
      <div class="ts-foot"><span>${ICONS.play} <b>Enter</b> select</span><span><b>←→</b> choose</span><span class="v">v0.4 · made with three.js</span></div>
      <div class="ts-credits hv-hidden"><div class="u-frame"><div class="u-ribbon"><span>Credits</span></div><div class="u-paper">
        <p><b>Hearthvale</b> — an original cozy farming tale.</p>
        <p>Every mesh, texture, icon, portrait and sound is generated in code at runtime: no downloaded art.</p>
        <p class="sm">Built with three.js · Fonts: Fredoka, Nunito, Caveat (Google Fonts)</p>
        <button class="u-btn small" data-nav data-a="closecredits">Lovely</button>
      </div></div></div>`;
    const menu = this.root.querySelector('.ts-menu')!;
    const items: [string, string, string, string, boolean][] = [
      ['new', 'New Game', 'sprout', 'Begin your story', true],
      ['continue', 'Continue', 'play', latest ? latest.label : 'No journal yet', !!latest],
      ['load', 'Load', 'door', latest ? 'Pick a journal' : 'Nothing saved', !!latest],
      ['coop', 'Co-op', 'people', 'Farm with friends', true],
      ['settings', 'Options', 'gear', 'Sound & graphics', true],
      ['credits', 'Credits', 'quill', 'Who made this', true],
    ];
    // First launch: no journal yet, so Continue / Load would only be dead planks. Leave them out and let the
    // live buttons centre themselves (they appear as soon as a journal exists).
    items.filter((it) => it[4]).forEach(([a, label, icon, sub, enabled], i) => {
      const b = el('button', `ts-btn${a === 'new' ? ' main is-default' : ''}${enabled ? '' : ' off'}`, `<span class="ic">${ICONS[icon] ?? ''}</span><span class="tx"><b>${label}</b><small>${sub}</small></span>`);
      b.dataset.nav = '';
      b.dataset.a = a;
      b.style.animationDelay = `${300 + i * 90}ms`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.action(a, b, enabled);
      });
      b.addEventListener('pointerenter', () => sfx(this.game, 'hover'));
      menu.appendChild(b);
    });
    this.root.querySelector('[data-a="closecredits"]')!.addEventListener('click', () => this.credits(false));
  }

  private credits(on: boolean): void {
    const c = this.root.querySelector('.ts-credits')!;
    c.classList.toggle('hv-hidden', !on);
    if (on) replay(c, 'in');
    this.nav.attach(this.root, on ? c.querySelector<HTMLElement>('[data-nav]') : this.root.querySelector<HTMLElement>('[data-a="credits"]'));
  }

  override back(): boolean {
    if (!this.root.querySelector('.ts-credits')!.classList.contains('hv-hidden')) {
      this.credits(false);
      return true;
    }
    return true;
  }

  private action(a: string, btn: HTMLElement, enabled: boolean): void {
    if (!enabled) {
      replay(btn, 'shake');
      sfx(this.game, 'error');
      return;
    }
    sfx(this.game, 'click');
    if (a === 'credits') return this.credits(true);
    if (a === 'coop') return this.game.events.emit('ui:open', { name: 'coop:title' });
    if (a === 'settings') return this.game.events.emit('ui:open', { name: 'settings:title' });
    if (a === 'load') return this.game.events.emit('ui:open', { name: 'saves:load:title' });
    if (a === 'continue') {
      const latest = this.latestSave();
      if (!latest) return;
      void this.game.hud.fade(true).then(() => {
        const ok = this.game.saves.load(latest.slot);
        this.game.events.emit('ui:open', { name: 'none' });
        if (ok) {
          this.game.setPaused(false);
          resetCamera(this.game);
        }
        setTimeout(() => void this.game.hud.fade(false), 200);
      });
      return;
    }
    // New Game: the New Journal screen (name, farm, look, pet, slot) — it then calls beginNewGame().
    this.game.events.emit('ui:open', { name: 'newgame' });
  }

  /** Fallback intro without the story system: fade to dawn, farmer at the door, Grandmother's letter. */
  private playLetter(): void {
    void this.game.hud.fade(true).then(() => {
      this.game.events.emit('ui:open', { name: 'none' });
      const map = this.game.world.current;
      if (map) {
        this.game.player.teleport(map.spawn.x, map.spawn.z);
        this.game.player.setFacing(map.spawn.facing);
      }
      this.game.calendar.setHour(6.2);
      this.game.setPaused(false);
      resetCamera(this.game);
      this.letter.classList.remove('hv-hidden', 'bye');
      replay(this.letter, 'hv-anim-in');
      this.game.input.enabled = false;
      setTimeout(() => void this.game.hud.fade(false), 250);
    });
  }

  override open(arg?: string): void {
    if (arg === 'letter') {
      // Opened by beginNewGame() when there is no story system: straight into Gran's letter.
      this.game.events.emit('ui:open', { name: 'none' });
      this.playLetter();
      return;
    }
    this.active = true;
    this.game.hud.root.classList.add('hv-title-mode');
    // No tile cursor / tool targeting under the title (restored on close).
    this.game.player.controllable = false;
    this.game.calendar.setHour(18.7);
    this.game.setPaused(true);
    const rig = this.game.rc.rig;
    const map = this.game.world.current;
    if (map && map.id === 'farm') this.game.player.teleport(map.spawn.x, map.spawn.z);
    this.game.player.setFacing('down');
    // Framed so the logo floats over the tree line / cliffs behind the house, not on its roof.
    rig.lookOffset.set(-1.2, 0, -8.2);
    rig.pitch = 36;
    rig.distance = 30;
    this.game.followPlayer(true);
    super.open(arg);
    cancelAnimationFrame(this.raf);
    const loop = (): void => {
      if (!this.active) return;
      this.orbit += 0.0012;
      rig.yaw = -22 + Math.sin(this.orbit) * 14;
      this.raf = requestAnimationFrame(loop);
    };
    this.orbit = 0;
    rig.yaw = -22;
    loop();
  }

  protected override initialFocus(): HTMLElement | null {
    const cont = this.root.querySelector<HTMLElement>('[data-a="continue"]:not(.off)');
    return cont ?? this.root.querySelector<HTMLElement>('[data-a="new"]');
  }

  protected override onClose(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.game.hud.root.classList.remove('hv-title-mode');
    this.game.player.controllable = true;
  }
}

/**
 * Start a fresh story (New Journal → Begin): the intro cutscene (Gran's letter → evening coach → the mayor →
 * first night) when the story system is present, otherwise the plain letter on the farm.
 */
export function beginNewGame(game: Game): void {
  const story = game.services.story;
  if (!story) {
    game.events.emit('ui:open', { name: 'title:letter' });
    return;
  }
  void game.hud.fade(true).then(() => {
    game.events.emit('ui:open', { name: 'none' });
    game.setPaused(false);
    resetCamera(game);
    story.newGame();
    setTimeout(() => void game.hud.fade(false), 250);
  });
}
