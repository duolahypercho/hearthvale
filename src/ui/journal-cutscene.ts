/**
 * Cinema overlay for cutscenes: letterbox bars, a slow fade, title captions, the cinematic
 * dialogue box (portrait medallion + name ribbon + typewriter text) and choice cards.
 * Pure DOM; the cutscene system drives it.
 */
import './journal.css';

export interface Speaker {
  name: string;
  role: string;
  portrait: string;
}

export interface ChoiceOption {
  label: string;
  hint?: string;
}

export function loadStoryFonts(): void {
  if (document.getElementById('hv-story-fonts')) return;
  const l = document.createElement('link');
  l.id = 'hv-story-fonts';
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Cormorant+Garamond:ital,wght@0,600;1,500;1,600&display=swap';
  document.head.appendChild(l);
}

const NEXT = `<svg viewBox="0 0 20 14"><path d="M2 2 L10 12 L18 2 Z" fill="#c8573e" stroke="#7a2e1e" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

export class CinemaOverlay {
  private root: HTMLElement;
  private barTop: HTMLElement;
  private barBot: HTMLElement;
  private fadeEl: HTMLElement;
  private captionEl: HTMLElement;
  private dlg: HTMLElement;
  private dlgText: HTMLElement;
  private dlgName: HTMLElement;
  private dlgRole: HTMLElement;
  private dlgPortrait: HTMLElement;
  private dlgNext: HTMLElement;
  private choices: HTMLElement;
  private skipEl: HTMLElement;
  private line = '';
  private shown = 0;
  private timer = 0;
  private advanceResolve: (() => void) | null = null;
  private choiceResolve: ((i: number) => void) | null = null;
  private skipT = 0;

  constructor(parent: HTMLElement, private hudRoot: HTMLElement) {
    loadStoryFonts();
    this.root = document.createElement('div');
    this.root.className = 'hv-cinema-layer';
    this.root.innerHTML = `
      <div class="cin-bar top"></div><div class="cin-bar bot"></div>
      <div class="cin-caption"><div class="cap-orn">✦</div><div class="cap-text"></div><div class="cap-sub"></div></div>
      <div class="cin-dlg hv-hidden">
        <div class="cin-portrait"></div>
        <div class="hv-panel cin-box"><div class="hv-inner">
          <div class="cin-nameplate"><span class="cin-name"></span><span class="cin-role"></span></div>
          <div class="cin-text"></div>
          <div class="cin-next">${NEXT}</div>
        </div></div>
      </div>
      <div class="cin-choices hv-hidden"></div>
      <div class="cin-skip">Press <b>Esc</b> again to skip</div>
      <div class="cin-fade"></div>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string): T => this.root.querySelector(s) as T;
    this.barTop = q('.cin-bar.top');
    this.barBot = q('.cin-bar.bot');
    this.fadeEl = q('.cin-fade');
    this.captionEl = q('.cin-caption');
    this.dlg = q('.cin-dlg');
    this.dlgText = q('.cin-text');
    this.dlgName = q('.cin-name');
    this.dlgRole = q('.cin-role');
    this.dlgPortrait = q('.cin-portrait');
    this.dlgNext = q('.cin-next');
    this.choices = q('.cin-choices');
    this.skipEl = q('.cin-skip');
    this.dlg.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.advanceResolve) return;
      if (['Space', 'Enter', 'KeyE', 'KeyX', 'KeyF', 'KeyC'].includes(e.code)) {
        e.preventDefault();
        this.advance();
      }
    });
  }

  letterbox(on: boolean, instant: boolean): void {
    this.root.classList.toggle('instant', instant);
    this.root.classList.toggle('boxed', on);
    if (instant) {
      void this.root.offsetWidth;
      requestAnimationFrame(() => this.root.classList.remove('instant'));
    }
  }

  hud(on: boolean): void {
    this.hudRoot.classList.toggle('hv-cinema', !on);
  }

  fade(black: boolean, dur: number): Promise<void> {
    this.fadeEl.style.transition = `opacity ${dur}s ease`;
    this.fadeEl.classList.toggle('on', black);
    return new Promise((r) => (dur > 0 ? setTimeout(r, dur * 1000) : r()));
  }

  caption(text: string, sub: string | undefined, dur: number, hold: boolean): Promise<void> {
    const c = this.captionEl;
    (c.querySelector('.cap-text') as HTMLElement).textContent = text;
    (c.querySelector('.cap-sub') as HTMLElement).textContent = sub ?? '';
    c.classList.remove('show', 'hold');
    void c.offsetWidth;
    c.style.setProperty('--dur', `${Math.max(1.2, dur)}s`);
    c.classList.add(hold ? 'hold' : 'show');
    if (hold) return Promise.resolve();
    return new Promise((r) => setTimeout(r, Math.max(1.2, dur) * 1000));
  }

  private setSpeaker(who: Speaker): void {
    this.dlgName.textContent = who.name;
    this.dlgRole.textContent = who.role;
    this.dlgPortrait.innerHTML = who.portrait;
    this.dlg.classList.toggle('narrator', !who.portrait);
    this.dlg.classList.remove('hv-hidden', 'pop');
    void this.dlg.offsetWidth;
    this.dlg.classList.add('pop');
  }

  say(who: Speaker, text: string, hold: boolean): Promise<void> {
    this.choices.classList.add('hv-hidden');
    this.setSpeaker(who);
    this.line = text;
    window.clearTimeout(this.timer);
    if (hold) {
      this.shown = text.length;
      this.dlgText.textContent = text;
      this.dlgNext.classList.remove('hv-hidden');
      return Promise.resolve();
    }
    this.shown = 0;
    this.dlgText.textContent = '';
    this.dlgNext.classList.add('hv-hidden');
    this.tick();
    return new Promise((r) => {
      this.advanceResolve = () => {
        this.advanceResolve = null;
        this.dlg.classList.add('hv-hidden');
        r();
      };
    });
  }

  private tick = (): void => {
    if (this.shown >= this.line.length) {
      this.dlgNext.classList.remove('hv-hidden');
      return;
    }
    const ch = this.line[this.shown]!;
    this.shown++;
    this.dlgText.textContent = this.line.slice(0, this.shown);
    const delay = /[.!?]/.test(ch) ? 170 : /[,—]/.test(ch) ? 90 : 19;
    this.timer = window.setTimeout(this.tick, delay);
  };

  /** Complete the typewriter line (skip). */
  flushLine(): void {
    window.clearTimeout(this.timer);
    this.shown = this.line.length;
    this.dlgText.textContent = this.line;
    this.advanceResolve?.();
  }

  private advance(): void {
    if (this.shown < this.line.length) {
      window.clearTimeout(this.timer);
      this.shown = this.line.length;
      this.dlgText.textContent = this.line;
      this.dlgNext.classList.remove('hv-hidden');
      return;
    }
    this.advanceResolve?.();
  }

  choice(who: Speaker, text: string, options: ChoiceOption[], hold: boolean): Promise<number> {
    this.setSpeaker(who);
    this.line = text;
    this.shown = text.length;
    this.dlgText.textContent = text;
    this.dlgNext.classList.add('hv-hidden');
    this.choices.innerHTML = options
      .map((o, i) => `<button class="cin-choice" data-i="${i}" style="--d:${i * 70}ms"><span class="lbl">${o.label}</span>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</button>`)
      .join('');
    this.choices.classList.remove('hv-hidden');
    if (hold) return Promise.resolve(-1);
    return new Promise((r) => {
      this.choiceResolve = r;
      this.choices.querySelectorAll('button').forEach((b) =>
        b.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const i = Number((b as HTMLElement).dataset.i);
          this.choices.classList.add('hv-hidden');
          this.dlg.classList.add('hv-hidden');
          this.choiceResolve = null;
          r(i);
        }),
      );
    });
  }

  skipHint(): void {
    this.skipEl.classList.add('show');
    window.clearTimeout(this.skipT);
    this.skipT = window.setTimeout(() => this.skipEl.classList.remove('show'), 1500);
  }

  reset(): void {
    window.clearTimeout(this.timer);
    this.advanceResolve = null;
    this.choiceResolve = null;
    this.dlg.classList.add('hv-hidden');
    this.choices.classList.add('hv-hidden');
    this.captionEl.classList.remove('show', 'hold');
    this.root.classList.remove('boxed');
    this.fadeEl.style.transition = 'opacity 0.6s ease';
    this.fadeEl.classList.remove('on');
    this.hudRoot.classList.remove('hv-cinema');
  }
}
