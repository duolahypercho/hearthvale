/**
 * Dialogue box ('dialogue:<npcId>'): wide parchment box at the bottom of the screen with a
 * typewriter line, the villager's portrait in a carved frame, a name plate + role, a heart meter
 * and a bouncing "next" arrow. Click / Space / Enter / E / X advances (first press completes the
 * line); Esc closes. Lines come from the `npcs` service (no import of the system).
 */
import type { Game } from '../core/game';
import type { Panel } from './hud';
import { portraitSvg } from './portraits';
import { NPCS, type NpcId } from '../data/npcs';

const HEART = (full: boolean): string =>
  `<svg viewBox="0 0 24 22"><path d="M12 21 C 5 15 1 11 1 6.5 A 5.5 5.5 0 0 1 12 4 A 5.5 5.5 0 0 1 23 6.5 C 23 11 19 15 12 21 Z" fill="${full ? '#e8574a' : 'rgba(120,80,40,0.18)'}" stroke="${full ? '#a8322a' : 'rgba(120,80,40,0.35)'}" stroke-width="1.6"/></svg>`;

export class DialoguePanel implements Panel {
  private el: HTMLElement;
  private text: HTMLElement;
  private portrait: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private hearts: HTMLElement;
  private next: HTMLElement;
  private lines: string[] = [];
  private idx = 0;
  private shown = 0;
  private timer = 0;
  private openFlag = false;

  constructor(private game: Game, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hv-dialogue hv-hidden interactive';
    this.el.innerHTML = `
      <div class="hv-panel dlg-box"><div class="hv-inner">
        <div class="dlg-text"></div>
        <div class="dlg-next"><svg viewBox="0 0 20 14"><path d="M2 2 L10 12 L18 2 Z" fill="#c8573e" stroke="#7a2e1e" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
      </div></div>
      <div class="hv-panel dlg-side"><div class="hv-inner">
        <div class="dlg-portrait"></div>
        <div class="dlg-name"></div>
        <div class="dlg-role"></div>
        <div class="dlg-hearts"></div>
      </div></div>`;
    parent.appendChild(this.el);
    this.text = this.el.querySelector('.dlg-text')!;
    this.portrait = this.el.querySelector('.dlg-portrait')!;
    this.name = this.el.querySelector('.dlg-name')!;
    this.role = this.el.querySelector('.dlg-role')!;
    this.hearts = this.el.querySelector('.dlg-hearts')!;
    this.next = this.el.querySelector('.dlg-next')!;
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.openFlag) return;
      if (['Space', 'Enter', 'KeyE', 'KeyX', 'KeyF', 'KeyC'].includes(e.code)) {
        e.preventDefault();
        this.advance();
      }
    });
  }

  open(arg?: string): void {
    const id = (arg ?? 'marigold') as NpcId;
    const conv = this.game.services.npcs?.conversation(id);
    const def = NPCS[id];
    if (!def) {
      console.warn(`[dialogue] unknown villager "${arg}"`);
      return;
    }
    this.lines = conv?.lines ?? [def.dialogue[0]!.lines[0]!];
    const hearts = conv?.hearts ?? 0;
    this.portrait.innerHTML = portraitSvg(def.look, def.portraitBg, 'happy');
    this.name.textContent = def.name.split(' ')[0]!;
    this.role.textContent = def.role;
    this.hearts.innerHTML = Array.from({ length: 5 }, (_, i) => HEART(i < Math.ceil(hearts / 2))).join('');
    this.idx = 0;
    this.startLine();
    this.openFlag = true;
    this.game.hud.root.classList.add('hv-talking');
    this.el.classList.remove('hv-hidden', 'hv-anim-in');
    void this.el.offsetWidth;
    this.el.classList.add('hv-anim-in');
  }

  private startLine(): void {
    this.shown = 0;
    this.timer = 0;
    this.text.textContent = '';
    this.next.classList.add('hv-hidden');
    this.tick();
  }

  private tick = (): void => {
    if (!this.openFlag && this.shown > 0) return;
    const line = this.lines[this.idx] ?? '';
    if (this.shown >= line.length) {
      this.next.classList.remove('hv-hidden');
      return;
    }
    // ~55 chars/s, brief pauses after punctuation.
    const ch = line[this.shown]!;
    this.shown++;
    this.text.textContent = line.slice(0, this.shown);
    const delay = /[.!?]/.test(ch) ? 160 : /[,—]/.test(ch) ? 80 : 18;
    this.timer = window.setTimeout(this.tick, delay);
  };

  private advance(): void {
    const line = this.lines[this.idx] ?? '';
    if (this.shown < line.length) {
      window.clearTimeout(this.timer);
      this.shown = line.length;
      this.text.textContent = line;
      this.next.classList.remove('hv-hidden');
      return;
    }
    this.idx++;
    if (this.idx >= this.lines.length) {
      this.game.events.emit('ui:open', { name: 'none' });
      return;
    }
    this.startLine();
  }

  /** Complete the current line immediately (screenshots / tests). */
  finishLine(): void {
    window.clearTimeout(this.timer);
    const line = this.lines[this.idx] ?? '';
    this.shown = line.length;
    this.text.textContent = line;
    this.next.classList.remove('hv-hidden');
  }

  close(): void {
    this.openFlag = false;
    window.clearTimeout(this.timer);
    this.game.hud.root.classList.remove('hv-talking');
    this.el.classList.add('hv-hidden');
  }
}
