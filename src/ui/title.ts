/**
 * Title screen ('title'): the live farm at golden hour behind a painted vignette, a slowly
 * orbiting camera, drifting blossom petals, the hand-lettered logo with a glowing lantern,
 * the story hook, and wood-plank menu buttons (New Game / Continue / Settings / Credits).
 * New Game plays a short "letter from Grandmother" card, then hands control to the player.
 */
import type { Game } from '../core/game';
import type { Panel } from './hud';

const LANTERN = `<svg viewBox="0 0 64 80" class="lantern"><defs><radialGradient id="tlg" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset="0.45" stop-color="#ffc85a"/><stop offset="1" stop-color="#e07a2a"/></radialGradient></defs>
<path d="M32 2 v8" stroke="#4a2e1a" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="4" r="3.2" fill="none" stroke="#4a2e1a" stroke-width="2.4"/>
<path d="M14 18 H50 L44 10 H20 Z" fill="#5a3a22"/><rect x="16" y="18" width="32" height="44" rx="7" fill="url(#tlg)" stroke="#5a3a22" stroke-width="3"/>
<path d="M32 18 V62 M16 40 H48" stroke="#5a3a22" stroke-width="2" opacity="0.55"/><path d="M12 62 H52 L46 72 H18 Z" fill="#5a3a22"/></svg>`;

export class TitlePanel implements Panel {
  private el: HTMLElement;
  private letter: HTMLElement;
  private orbit = 0;
  private active = false;
  private raf = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hv-title-screen hv-hidden interactive';
    const petals = Array.from({ length: 22 }, (_, i) => `<i style="--x:${(i * 47) % 100}%;--d:${7 + (i % 5) * 1.7}s;--dl:${-(i * 1.3) % 9}s;--s:${0.6 + (i % 4) * 0.2}"></i>`).join('');
    this.el.innerHTML = `
      <div class="ts-vignette"></div>
      <div class="ts-petals">${petals}</div>
      <div class="ts-logo">
        ${LANTERN}
        <h1><span>Hearth</span><span>vale</span></h1>
        <div class="ts-sub">a cozy valley farming tale</div>
      </div>
      <div class="ts-menu">
        <button data-a="new">New Game</button>
        <button data-a="continue">Continue</button>
        <button data-a="settings">Settings</button>
        <button data-a="credits">Credits</button>
      </div>
      <div class="hv-panel ts-hook"><div class="hv-inner">
        Grandmother Rosalind left you her overgrown farm — and a letter about the lanterns of Hearthvale,
        dark for seven winters.
      </div></div>
      <div class="ts-foot">Press <b>Enter</b> to begin · v0.3</div>`;
    parent.appendChild(this.el);
    this.letter = document.createElement('div');
    this.letter.className = 'hv-letter hv-hidden interactive';
    this.letter.innerHTML = `<div class="paper">
      <p class="hand">My dearest,</p>
      <p>If you are reading this, the farm is yours. Forgive the weeds — they got bolder as I got older.</p>
      <p>The soil is good and the valley is kind, though it has forgotten how to shine. When the old lantern in the Hall was lit, the whole valley glowed. Perhaps you can remind it.</p>
      <p class="hand sign">With all my love,<br/>Gran Rosalind</p>
      <div class="seal"></div>
      <div class="hint">click to begin</div>
    </div>`;
    parent.appendChild(this.letter);
    this.el.querySelectorAll('button').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.action((b as HTMLElement).dataset.a!);
      }),
    );
    this.letter.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.letter.classList.add('hv-hidden');
      this.game.input.enabled = true;
    });
    window.addEventListener('keydown', (e) => {
      if (this.active && e.code === 'Enter') this.action('new');
    });
  }

  private action(a: string): void {
    if (a === 'new' || a === 'continue') {
      if (a === 'continue' && this.game.saves.load()) {
        this.game.events.emit('ui:open', { name: 'none' });
        return;
      }
      this.game.events.emit('ui:open', { name: 'none' });
      const map = this.game.world.current;
      if (map) {
        this.game.player.teleport(map.spawn.x, map.spawn.z);
        this.game.player.setFacing(map.spawn.facing);
      }
      this.game.calendar.setHour(6.2);
      this.game.setPaused(false);
      this.game.rc.rig.yaw = 0;
      this.game.rc.rig.pitch = 50;
      this.game.rc.rig.distance = 24;
      this.game.rc.rig.lookOffset.set(0, 0, 0);
      this.game.followPlayer(true);
      if (a === 'new') {
        this.letter.classList.remove('hv-hidden', 'hv-anim-in');
        void this.letter.offsetWidth;
        this.letter.classList.add('hv-anim-in');
        this.game.input.enabled = false;
      }
    } else {
      const btn = this.el.querySelector(`button[data-a="${a}"]`) as HTMLElement | null;
      btn?.classList.remove('shake');
      void btn?.offsetWidth;
      btn?.classList.add('shake');
    }
  }

  open(): void {
    this.active = true;
    // Golden hour over the homestead, slow orbit.
    this.game.calendar.setHour(18.7);
    this.game.setPaused(true);
    const rig = this.game.rc.rig;
    const map = this.game.world.current;
    if (map) this.game.player.teleport(map.spawn.x, map.spawn.z);
    this.game.player.setFacing('down');
    rig.lookOffset.set(-1.5, 0, -3.5);
    rig.pitch = 34;
    rig.distance = 29;
    this.game.followPlayer(true);
    this.game.hud.root.classList.add('hv-title-mode');
    this.el.classList.remove('hv-hidden');
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

  close(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.game.hud.root.classList.remove('hv-title-mode');
    this.el.classList.add('hv-hidden');
  }
}
