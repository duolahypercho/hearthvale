/**
 * Dialogue box ('dialogue:<npcId>[/mood|/gift[/itemId]|/ask]'): wide parchment box at the bottom of
 * the screen with a typewriter line (punctuation pauses, a soft blip per word), the villager's
 * painted portrait in a carved frame that swaps expression per line ("[laugh] …" tags), a name
 * plate + role, a 10-heart meter with partial fill that pulses / sprinkles hearts when friendship
 * changes, a bouncing "next" arrow, choice lists (mouse, 1–4, ↑↓ + Enter), gift reactions with a
 * reaction ribbon, and a birthday ribbon.
 *
 * Also provides the `dialogueBox` service used by heart events (say / narrate / choose / cinema
 * letterbox + title card), birthday toasts, and the 'social' panel (every villager: portrait,
 * hearts, birthday, talked / gifted today).
 *
 * Click / Space / Enter / E / X advances (first press completes the line); Esc closes.
 */
import type { Game } from '../core/game';
import type { Panel } from './hud';
import { portraitSvg } from './portraits';
import { NPCS, NPC_IDS, parseLine, type NpcId, type Mood, type Emote } from '../data/npcs';
import { itemDef } from '../data/items';

export interface DialogueBoxApi {
  say(id: NpcId, text: string, mood?: Mood): Promise<void>;
  narrate(text: string): Promise<void>;
  choose(id: NpcId, q: string | undefined, options: string[], mood?: Mood): Promise<number>;
  /** Hide the box (scripted mode). */
  end(): void;
  /** Letterbox bars + optional title card. */
  cinema(on: boolean, title?: string, sub?: string): void;
  /** Stage helper: complete the current line instantly (screenshots). */
  finishLine(): void;
}

declare module '../core/game' {
  interface GameServices {
    dialogueBox: DialogueBoxApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    /** The dialogue box is typing a villager's line (mouth flaps). */
    'dialogue:speaking': { id: string; on: boolean };
    /** Pop an emote bubble over a villager. */
    'npc:emote': { id: string; emote: Emote };
    /** Typewriter word blip (audio can voice it). */
    'ui:blip': { id: string };
  }
}

const CSS = /* css */ `
.hv-dialogue.dlg2 { bottom: 24px; width: min(1140px, calc(100vw - 40px)); gap: 14px; align-items: flex-end; }
/* The parchment fills the whole text box; text is anchored top-left so the reading position never moves. */
/* The text box keeps a compact height (3 lines) and sits level with the bottom of the taller portrait card. */
.hv-dialogue.dlg2 .dlg-box { min-height: 244px; display: flex; flex-direction: column; }
.hv-dialogue.dlg2 .dlg-box .hv-inner { flex: 1 1 auto; height: auto; min-height: 0; display: flex; flex-direction: column; justify-content: flex-start; padding: 40px 48px 30px; overflow: hidden;
  box-shadow: inset 0 2px 5px rgba(120, 70, 20, 0.35), inset 0 0 0 2px rgba(150, 100, 50, 0.25), inset 0 0 38px rgba(150, 90, 30, 0.2); }
/* Ink flourishes in the parchment corners + a pressed rule under the text. */
.hv-dialogue.dlg2 .dlg-box .hv-inner::before, .hv-dialogue.dlg2 .dlg-box .hv-inner::after { content: ''; position: absolute; width: 58px; height: 58px; pointer-events: none; opacity: 0.5;
  background: var(--dlg-flourish) center / contain no-repeat; }
.hv-dialogue.dlg2 .dlg-box .hv-inner::before { left: 8px; top: 8px; }
.hv-dialogue.dlg2 .dlg-box .hv-inner::after { right: 8px; bottom: 8px; transform: rotate(180deg); }
.hv-dialogue.dlg2 .dlg-text { min-height: 0; font-size: 30px; line-height: 42px; letter-spacing: 0.1px; position: relative; z-index: 1; }
.hv-dialogue.dlg2 .dlg-text .rest { visibility: hidden; }
.hv-dialogue.dlg2 .dlg-next { right: 26px; bottom: 16px; z-index: 2; }
.hv-dialogue.dlg2 .dlg-speaker { position: absolute; top: -17px; left: 34px; z-index: 3; line-height: 26px; pointer-events: none; font-family: var(--font-head); font-weight: 700; font-size: 21px; color: #fff; padding: 3px 18px 5px; border-radius: 10px;
  background: linear-gradient(180deg, var(--wood-1), var(--wood-2)); border: 2px solid var(--wood-3); text-shadow: 0 2px 0 var(--wood-3); box-shadow: 0 3px 0 rgba(60,30,10,.3), inset 0 1px 0 var(--wood-hi); }
.hv-dialogue.dlg2 .dlg-box { position: relative; }
.hv-dialogue.dlg2.narr .dlg-side { display: none; }
.hv-dialogue.dlg2.narr .dlg-speaker { display: none; }
.hv-dialogue.dlg2.narr .dlg-text { font-style: italic; font-weight: 700; color: #6a4a2a; text-align: center; }
.hv-dialogue.dlg2 .dlg-side { width: 276px; }
.hv-dialogue.dlg2 .dlg-side .hv-inner { padding: 10px 10px 10px; gap: 2px; align-content: start; overflow: hidden; }
.hv-dialogue.dlg2 .dlg-portrait { position: relative; width: 252px; height: 252px; margin: 2px 0 0; }
/* Painted-on-canvas finish: a static brush-grain layer (soft light) and a varnish vignette over the art. */
.hv-dialogue.dlg2 .dlg-portrait::after { content: ''; position: absolute; inset: 0; z-index: 3; pointer-events: none; border-radius: inherit;
  background: var(--dlg-grain, none) 0 0 / 252px 252px; mix-blend-mode: soft-light; opacity: 0.42;
  box-shadow: inset 0 0 24px rgba(70, 36, 12, 0.38), inset 0 0 3px rgba(70, 36, 12, 0.5); }
.hv-dialogue.dlg2 .dlg-name { position: relative; z-index: 2; margin-top: -18px; font-size: 23px; padding: 0 18px 1px; box-shadow: 0 3px 0 rgba(60,30,10,.3); }
.hv-dialogue.dlg2 .dlg-role { max-width: 250px; font-size: 12.5px; line-height: 15px; margin-top: 2px; }
.hv-dialogue.dlg2.cine { bottom: calc(7.5vh + 16px); transition: bottom 400ms var(--ease-out); }
.hv-hud.hv-heartcine .h-clock, .hv-hud.hv-heartcine .hv-toolbar, .hv-hud.hv-heartcine .hv-energy, .hv-hud.hv-heartcine .h-toasts { opacity: 0 !important; pointer-events: none; transition: opacity 300ms; }
.hv-dialogue.dlg2 .dlg-portrait .layer { position: absolute; inset: 0; }
.hv-dialogue.dlg2 .dlg-portrait .layer svg { animation: dlgBreathe 3.2s ease-in-out infinite; transform-origin: 50% 90%; }
.hv-dialogue.dlg2 .dlg-portrait .layer.in { animation: dlgSwap 260ms var(--ease-back) both; }
.hv-dialogue.dlg2 .dlg-portrait .layer.out { animation: dlgOut 200ms ease-out both; }
.hv-dialogue.dlg2 .dlg-portrait.talk .layer:last-child svg { animation: dlgBreathe 3.2s ease-in-out infinite, dlgNod 0.42s ease-in-out infinite alternate; }
@keyframes dlgBreathe { 50% { transform: translateY(1.5px) scale(1.012); } }
@keyframes dlgNod { to { translate: 0 1.6px; } }
@keyframes dlgSwap { from { opacity: 0; transform: scale(1.06) translateY(4px); } }
@keyframes dlgOut { to { opacity: 0; } }
.hv-dialogue.dlg2 .dlg-hearts { display: grid; grid-template-columns: repeat(10, 18px); gap: 2px; margin-top: 4px; }
.hv-dialogue.dlg2 .dlg-hearts svg { width: 18px; height: 16px; display: block; overflow: visible; }
/* The heart that just filled pops (ease-out-back) and flashes. */
.hv-dialogue.dlg2 .dlg-hearts svg.pop { animation: dlgPop 620ms var(--ease-back) both; filter: drop-shadow(0 0 4px rgba(255, 120, 100, 0.9)); }
@keyframes dlgPop { 0% { transform: scale(0.3); } 45% { transform: scale(1.75) translateY(-4px); } 100% { transform: scale(1); } }
.hv-dialogue.dlg2 .dlg-hearts.pulse svg { animation: dlgHeart 520ms var(--ease-back) both; }
.hv-dialogue.dlg2 .dlg-hearts.pulse svg:nth-child(2n) { animation-delay: 40ms; }
.hv-dialogue.dlg2 .dlg-hearts.shake { animation: dlgShake 380ms ease-in-out; }
@keyframes dlgHeart { 40% { transform: scale(1.35) translateY(-3px); } }
@keyframes dlgShake { 20%,60% { transform: translateX(-4px); } 40%,80% { transform: translateX(4px); } }
.hv-dialogue.dlg2 .dlg-side .hv-inner { position: relative; }
.dlg-float { position: absolute; width: 22px; height: 20px; pointer-events: none; animation: dlgFloat 1100ms ease-out forwards; }
@keyframes dlgFloat { from { opacity: 0; transform: translateY(0) scale(0.4); } 15% { opacity: 1; transform: translateY(-8px) scale(1.1); } to { opacity: 0; transform: translateY(-70px) scale(0.8) rotate(12deg); } }
.hv-dialogue.dlg2 .dlg-ribbon { position: absolute; top: 16px; right: 8px; max-width: 200px; z-index: 4; font-family: var(--font-head); font-weight: 700; font-size: 14px; color: #fff; padding: 3px 12px 3px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: linear-gradient(180deg, #e8674a, #c0482e); border: 2px solid #7a2e1e; border-radius: 8px; box-shadow: 0 3px 0 rgba(60,30,10,.35); transform: rotate(3deg);
  display: flex; align-items: center; gap: 6px; animation: dlgSwap 360ms var(--ease-back) both; }
.hv-dialogue.dlg2 .dlg-ribbon svg { width: 18px; height: 18px; }
.hv-dialogue.dlg2 .dlg-choices { display: grid; gap: 8px; margin-top: 10px; }
.hv-dialogue.dlg2 .dlg-choice { font-family: var(--font-body); font-weight: 800; font-size: 21px; color: #4a2c14; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 12px;
  padding: 7px 16px 8px 12px; border-radius: 12px; border: 2px solid rgba(120, 70, 30, 0.35); background: rgba(255, 250, 235, 0.6);
  transition: transform 120ms var(--ease-back), background 120ms, border-color 120ms; animation: dlgSwap 280ms var(--ease-back) both; }
.hv-dialogue.dlg2 .dlg-choice .k { font-family: var(--font-head); font-size: 15px; color: #fff; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; flex: none;
  background: linear-gradient(180deg, var(--wood-1), var(--wood-2)); border: 2px solid var(--wood-3); }
.hv-dialogue.dlg2 .dlg-choice.sel { background: #fff6dc; border-color: #c8573e; transform: translateX(6px); box-shadow: 0 3px 0 rgba(120,60,20,.25); }
.hv-dialogue.dlg2 .dlg-choice.sel::before { content: ''; position: absolute; }
.hv-dialogue.dlg2 .dlg-q { font-size: 23px; line-height: 32px; }
.dlg-letterbox { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
.dlg-letterbox::before, .dlg-letterbox::after { content: ''; position: absolute; left: 0; right: 0; height: 0; background: #120a06; transition: height 520ms var(--ease-out); }
.dlg-letterbox::before { top: 0; }
.dlg-letterbox::after { bottom: 0; }
.dlg-letterbox.on::before, .dlg-letterbox.on::after { height: 7.5vh; }
.dlg-title { position: absolute; left: 50%; top: 3.75vh; transform: translate(-50%, -50%); text-align: center; pointer-events: none; opacity: 0; transition: opacity 700ms, translate 700ms var(--ease-out); translate: 0 -6px; z-index: 6; white-space: nowrap;
  display: flex; align-items: center; gap: 16px; }
.dlg-title.on { opacity: 1; translate: 0 0; }
.dlg-title.dim { opacity: 0.55; }
.dlg-title .t { font-family: var(--font-head); font-weight: 700; font-size: clamp(22px, 3.3vh, 36px); color: #fff4dc; text-shadow: 0 2px 0 #5a2a10, 0 0 18px rgba(255, 190, 110, .35); letter-spacing: 0.6px; }
.dlg-title .s { font-family: var(--font-body); font-weight: 800; font-size: clamp(12px, 1.6vh, 17px); color: #f6c89a; display: flex; gap: 7px; align-items: center; justify-content: center; padding: 3px 12px 4px; border-radius: 999px; border: 1.5px solid rgba(246, 200, 154, .45); }
.dlg-title .s svg { width: 16px; height: 14px; }
.dlg-title .rule { width: 60px; height: 2px; background: linear-gradient(90deg, transparent, rgba(246, 200, 154, .7)); }
.dlg-title .rule.r { transform: scaleX(-1); }
.dlg-toast { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); z-index: 7; display: flex; align-items: center; gap: 12px; padding: 6px 18px 6px 8px; pointer-events: none; }
.dlg-toast .hv-inner { display: flex; align-items: center; gap: 12px; padding: 6px 16px 6px 6px; font-weight: 800; color: #4a2c14; font-size: 18px; }
.dlg-toast .pp { width: 52px; height: 52px; border-radius: 10px; overflow: hidden; box-shadow: 0 0 0 3px var(--wood-2); }
.dlg-toast .pp svg { width: 100%; height: 100%; display: block; }
.hv-social { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: auto; background: rgba(20, 10, 4, 0.35); z-index: 4; }
.hv-social .hv-panel { width: min(1080px, calc(100vw - 60px)); }
.hv-social .hv-inner { padding: 20px 24px 22px; }
.hv-social h2 { margin: 0 0 12px; font-family: var(--font-head); font-size: 32px; color: #5a3218; display: flex; justify-content: space-between; align-items: baseline; }
.hv-social h2 small { font-family: var(--font-body); font-size: 15px; color: var(--ink-soft); font-weight: 800; }
.hv-social .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; }
.hv-social .card { display: grid; grid-template-columns: 74px 1fr auto; gap: 12px; align-items: center; padding: 8px 12px 8px 8px; border-radius: 12px; background: rgba(255, 250, 235, 0.55); border: 2px solid rgba(120, 70, 30, 0.22); }
.hv-social .card .pp { width: 74px; height: 74px; border-radius: 10px; overflow: hidden; box-shadow: 0 0 0 3px var(--wood-2), 0 0 0 5px var(--wood-hi); }
.hv-social .card .pp svg { width: 100%; height: 100%; display: block; }
.hv-social .card .nm { font-family: var(--font-head); font-weight: 700; font-size: 21px; color: #4a2c14; }
.hv-social .card .rl { font-size: 13px; font-weight: 700; color: var(--ink-soft); }
.hv-social .card .hs { display: flex; gap: 2px; margin-top: 3px; }
.hv-social .card .hs svg { width: 17px; height: 15px; }
.hv-social .card .meta { display: grid; gap: 4px; justify-items: end; font-size: 13px; font-weight: 800; color: #6a4a2a; }
.hv-social .card .meta .chk { display: flex; gap: 6px; align-items: center; }
.hv-social .card .meta .box { width: 16px; height: 16px; border-radius: 4px; border: 2px solid #8a6440; background: rgba(255,255,255,.5); display: grid; place-items: center; }
.hv-social .card .meta .box.on { background: #5fa83c; border-color: #3f7a2a; }
.hv-social .card .meta .box.on::after { content: ''; width: 8px; height: 4px; border: solid #fff; border-width: 0 0 2.5px 2.5px; transform: rotate(-45deg) translate(1px, -1px); }
.hv-social .card.bday { border-color: #e8674a; background: rgba(255, 236, 220, 0.8); }
`;

const HEART = (fill: number, key: string): string => {
  const f = Math.max(0, Math.min(1, fill));
  const id = `hc${key}`;
  return `<svg viewBox="0 0 24 22"><defs><clipPath id="${id}"><rect x="0" y="0" width="${24 * f}" height="22"/></clipPath></defs><path d="M12 21 C 5 15 1 11 1 6.5 A 5.5 5.5 0 0 1 12 4 A 5.5 5.5 0 0 1 23 6.5 C 23 11 19 15 12 21 Z" fill="rgba(120,80,40,0.16)" stroke="rgba(120,80,40,0.38)" stroke-width="1.6"/>${
    f > 0 ? `<g clip-path="url(#${id})"><path d="M12 21 C 5 15 1 11 1 6.5 A 5.5 5.5 0 0 1 12 4 A 5.5 5.5 0 0 1 23 6.5 C 23 11 19 15 12 21 Z" fill="#e8574a" stroke="#a8322a" stroke-width="1.6"/><ellipse cx="7.5" cy="7" rx="2.6" ry="1.8" fill="#fff" opacity="0.55" transform="rotate(-30 7.5 7)"/></g>` : ''
  }</svg>`;
};
const CAKE = `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2" fill="#fff4e0" stroke="#7a2e1e" stroke-width="1.6"/><path d="M3 15 q 3 2 6 0 t 6 0 t 6 0" stroke="#e8674a" stroke-width="2" fill="none"/><rect x="11" y="5" width="2" height="6" fill="#ffd166" stroke="#7a2e1e" stroke-width="1"/><path d="M12 1.5 q 2 2 0 3.5 q -2 -1.5 0 -3.5 Z" fill="#ff9a3a"/></svg>`;
const REACT: Record<string, [string, string]> = {
  love: ['Loved it!', '#e8574a'],
  like: ['Liked it', '#e8903a'],
  neutral: ['Thanked you', '#8a7a5a'],
  dislike: ['Disliked it…', '#6a7aa0'],
};
const PER_HEART = 250;
/** "Marigold", "Dr. Pell". */
export const shortName = (name: string): string => (name.startsWith('Dr. ') ? `Dr. ${name.split(' ').pop()}` : name.split(' ')[0]!);

type Step = { kind: 'line'; text: string; mood: Mood } | { kind: 'ask'; q: string; mood: Mood; options: { text: string; reply: string; mood?: Mood; delta: number }[] };

/**
 * A painterly canvas texture (brush dabs + fine tooth), drawn once: laid over the portrait art in
 * soft-light so the SVG reads as paint on canvas. Static (no per-frame filter cost).
 */
function paintGrain(): string | null {
  try {
    const S = 232;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, S, S);
    let seed = 1234567;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Diagonal brush dabs, light and dark.
    for (let i = 0; i < 900; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const len = 4 + rnd() * 12;
      const a = -0.75 + (rnd() - 0.5) * 0.5;
      const v = rnd() < 0.5 ? 255 : 0;
      g.strokeStyle = `rgba(${v},${v},${v},${0.05 + rnd() * 0.08})`;
      g.lineWidth = 1 + rnd() * 2.2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    // Canvas tooth: fine speckle.
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 34 + ((((i >> 2) % S) + Math.floor((i >> 2) / S)) % 3 === 0 ? 6 : 0);
      d[i] = d[i]! + n;
      d[i + 1] = d[i + 1]! + n;
      d[i + 2] = d[i + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

export class DialoguePanel implements Panel {
  private el: HTMLElement;
  private text: HTMLElement;
  private portrait: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private hearts: HTMLElement;
  private next: HTMLElement;
  private speaker: HTMLElement;
  private side: HTMLElement;
  private ribbonHost: HTMLElement;
  private letterbox: HTMLElement;
  private titleCard: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private titleTimer = 0;
  private line = '';
  private shown = 0;
  private timer = 0;
  private openFlag = false;
  private npc: NpcId | null = null;
  private mood: Mood | null = null;
  private waiter: (() => void) | null = null;
  private choiceWaiter: ((i: number) => void) | null = null;
  private choiceSel = 0;
  private choiceCount = 0;
  private runId = 0;
  private scripted = false;

  constructor(private game: Game, parent: HTMLElement) {
    if (!document.getElementById('hv-dlg2-css')) {
      const st = document.createElement('style');
      st.id = 'hv-dlg2-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'hv-dialogue dlg2 hv-hidden interactive';
    this.el.innerHTML = `
      <div class="hv-panel dlg-box"><div class="dlg-speaker"></div><div class="hv-inner">
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
    const grain = paintGrain();
    if (grain) this.el.style.setProperty('--dlg-grain', `url(${grain})`);
    this.text = this.el.querySelector('.dlg-text')!;
    this.portrait = this.el.querySelector('.dlg-portrait')!;
    this.name = this.el.querySelector('.dlg-name')!;
    this.role = this.el.querySelector('.dlg-role')!;
    this.hearts = this.el.querySelector('.dlg-hearts')!;
    this.next = this.el.querySelector('.dlg-next')!;
    this.speaker = this.el.querySelector('.dlg-speaker')!;
    this.side = this.el.querySelector('.dlg-side')!;
    this.ribbonHost = this.el.querySelector('.dlg-side .hv-inner')!;
    this.letterbox = document.createElement('div');
    this.letterbox.className = 'dlg-letterbox';
    this.titleCard = document.createElement('div');
    this.titleCard.className = 'dlg-title';
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'hv-panel dlg-toast hv-hidden';
    parent.append(this.letterbox, this.titleCard, this.toastEl);

    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('.dlg-choice')) return;
      this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.openFlag) return;
      if (this.choiceWaiter) {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this.selectChoice((this.choiceSel + 1) % this.choiceCount);
        else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.selectChoice((this.choiceSel + this.choiceCount - 1) % this.choiceCount);
        else if (/^Digit[1-4]$/.test(e.code)) {
          const i = Number(e.code.slice(5)) - 1;
          if (i < this.choiceCount) this.pickChoice(i);
        } else if (['Space', 'Enter', 'KeyE', 'KeyX', 'KeyF', 'KeyC'].includes(e.code)) this.pickChoice(this.choiceSel);
        e.preventDefault();
        return;
      }
      if (['Space', 'Enter', 'KeyE', 'KeyX', 'KeyF', 'KeyC'].includes(e.code)) {
        e.preventDefault();
        this.advance();
      } else if (e.code === 'Escape' && !this.scripted) {
        this.game.events.emit('ui:open', { name: 'none' });
      }
    });
    game.events.on('relationship:change', ({ npcId, delta }) => {
      if (npcId !== this.npc || !this.openFlag) return;
      this.renderHearts(npcId, this.heartPts);
      this.hearts.classList.remove('pulse', 'shake');
      void this.hearts.offsetWidth;
      this.hearts.classList.add(delta > 0 ? 'pulse' : 'shake');
      if (delta > 0) this.sprinkle(Math.min(6, 1 + Math.round(delta / 20)));
    });
    game.events.on('npc:birthday', ({ npcId }) => {
      const d = NPCS[npcId as NpcId];
      if (d) this.toast(d.look, d.portraitBg, `It’s ${d.name.split(' ')[0]}’s birthday today!`);
    });
    game.provide('dialogueBox', {
      say: (id, text, mood) => this.scriptedSay(id, text, mood ?? 'neutral'),
      narrate: (text) => this.scriptedNarrate(text),
      choose: (id, q, options, mood) => this.scriptedChoose(id, q, options, mood ?? 'thinking'),
      end: () => this.endScripted(),
      cinema: (on, title, sub) => this.cinema(on, title, sub),
      finishLine: () => this.finishLine(),
    });
  }

  // ───────────────────────────────────────────── panel API (normal conversations)

  open(arg?: string): void {
    const [rawId, mode, extra] = (arg ?? 'marigold').split('/') as [string, string | undefined, string | undefined];
    const id = rawId as NpcId;
    const def = NPCS[id];
    if (!def) {
      console.warn(`[dialogue] unknown villager "${arg}"`);
      return;
    }
    this.scripted = false;
    this.show(id, false);
    const run = ++this.runId;
    const steps: Step[] = [];
    if (mode === 'gift') {
      const itemId = extra ?? this.game.services.inventory?.selected()?.id ?? '';
      steps.push(...this.giftSteps(id, itemId));
    } else {
      const conv = this.game.services.npcs?.conversation(id);
      const lines = conv?.lines ?? def.dialogue[0]!.lines;
      for (const l of lines) {
        const p = parseLine(l);
        steps.push({ kind: 'line', text: p.text, mood: p.mood });
      }
      const moodOverride = mode && mode !== 'ask' ? (mode as Mood) : null;
      if (moodOverride && steps[0]?.kind === 'line') steps[0].mood = moodOverride;
      const ask = conv?.ask;
      if (ask) {
        const q = parseLine(ask.q, ask.mood ?? 'thinking');
        const askStep: Step = { kind: 'ask', q: q.text, mood: ask.mood ?? q.mood, options: ask.options };
        if (mode === 'ask') steps.splice(0, steps.length, askStep);
        else steps.push(askStep);
      }
    }
    void this.runSteps(id, steps, run);
  }

  private giftSteps(id: NpcId, itemId: string): Step[] {
    const def = NPCS[id];
    const rel = this.game.services.relationships;
    const name = itemDef(itemId)?.name ?? itemId;
    const can = rel?.canGift(id, itemId) ?? { ok: false, reason: 'unknown' as const };
    if (!can.ok) {
      const t = can.reason === 'today' ? '[neutral] You’ve already given me something today. Save the rest for tomorrow!' : can.reason === 'week' ? '[thinking] Two gifts this week already? You’ll spoil me. Let’s wait till the week turns.' : '[thinking] Hm? What’s that you’ve got there?';
      const p = parseLine(t);
      return [{ kind: 'line', text: p.text, mood: p.mood }];
    }
    const birthday = rel?.isBirthday(id) ?? false;
    const reaction = rel?.gift(id, itemId) ?? 'neutral';
    this.ribbon(REACT[reaction]![0], REACT[reaction]![1], `${name}`);
    const out: Step[] = [];
    const main = parseLine(def.giftLines[reaction]);
    out.push({ kind: 'line', text: main.text, mood: main.mood });
    if (birthday) {
      const b = parseLine(def.giftLines.birthday);
      out.push({ kind: 'line', text: b.text, mood: b.mood });
    }
    this.game.events.emit('npc:emote', { id, emote: reaction === 'love' ? 'heart' : reaction === 'dislike' ? 'sweat' : reaction === 'like' ? 'music' : 'dots' });
    return out;
  }

  private async runSteps(id: NpcId, steps: Step[], run: number): Promise<void> {
    for (const s of steps) {
      if (run !== this.runId || !this.openFlag) return;
      if (s.kind === 'line') await this.line_(id, s.text, s.mood);
      else {
        const i = await this.choice_(id, s.q, s.options.map((o) => o.text), s.mood);
        if (run !== this.runId || !this.openFlag) return;
        const opt = s.options[i]!;
        if (opt.delta) this.game.events.emit('npc:choice', { npcId: id, delta: opt.delta });
        const r = parseLine(opt.reply, opt.mood ?? 'happy');
        await this.line_(id, r.text, opt.mood ?? r.mood);
      }
    }
    if (run === this.runId && this.openFlag && !this.scripted) this.game.events.emit('ui:open', { name: 'none' });
  }

  close(): void {
    this.runId++;
    this.hide();
  }

  // ───────────────────────────────────────────── scripted (heart events)

  private scriptedSay(id: NpcId, text: string, mood: Mood): Promise<void> {
    this.scripted = true;
    this.show(id, true);
    return this.line_(id, text, mood);
  }

  private scriptedNarrate(text: string): Promise<void> {
    this.scripted = true;
    this.show(null, true);
    return this.line_(null, text, 'neutral');
  }

  private scriptedChoose(id: NpcId, q: string | undefined, options: string[], mood: Mood): Promise<number> {
    this.scripted = true;
    this.show(id, true);
    return this.choice_(id, q ?? '', options, mood);
  }

  private endScripted(): void {
    this.scripted = false;
    this.hide();
  }

  // ───────────────────────────────────────────── view

  private show(id: NpcId | null, keepOpen: boolean): void {
    const wasOpen = this.openFlag;
    this.openFlag = true;
    this.el.classList.toggle('narr', id === null);
    this.game.hud.root.classList.add('hv-talking');
    if (id && id !== this.npc) {
      const def = NPCS[id];
      this.npc = id;
      this.mood = null;
      this.portrait.innerHTML = '';
      this.name.textContent = shortName(def.name);
      this.role.textContent = def.role;
      this.speaker.textContent = this.name.textContent;
      this.renderHearts(id);
      this.ribbonHost.querySelectorAll('.dlg-ribbon').forEach((r) => r.remove());
      if (this.game.services.relationships?.isBirthday(id)) this.ribbon('Birthday!', '#e8674a', '', true);
    }
    if (!wasOpen || !keepOpen) {
      if (!wasOpen) this.ribbonHost.querySelectorAll('.dlg-ribbon').forEach((r) => r.remove());
      this.el.classList.remove('hv-hidden', 'hv-anim-in');
      void this.el.offsetWidth;
      this.el.classList.add('hv-anim-in');
    }
  }

  private hide(): void {
    this.openFlag = false;
    window.clearTimeout(this.timer);
    this.setSpeaking(false);
    this.waiter = null;
    this.choiceWaiter = null;
    this.npc = null;
    this.game.hud.root.classList.remove('hv-talking');
    this.el.classList.add('hv-hidden');
  }

  private setPortrait(id: NpcId, mood: Mood): void {
    if (this.mood === mood && this.portrait.children.length) return;
    const def = NPCS[id];
    this.mood = mood;
    const old = [...this.portrait.children];
    const layer = document.createElement('div');
    layer.className = old.length ? 'layer in' : 'layer';
    layer.innerHTML = portraitSvg(def.look, def.portraitBg, mood);
    this.portrait.appendChild(layer);
    for (const o of old) {
      o.classList.remove('in');
      o.classList.add('out');
      window.setTimeout(() => o.remove(), 220);
    }
  }

  private heartPts = -1;
  private renderHearts(id: NpcId, prev = -1): void {
    const pts = this.game.services.relationships?.points(id) ?? 0;
    this.hearts.innerHTML = Array.from({ length: 10 }, (_, i) => HEART((pts - i * PER_HEART) / PER_HEART, `${id}${i}`)).join('');
    this.hearts.title = `${Math.floor(pts / PER_HEART)} / 10 hearts`;
    if (prev >= 0 && pts > prev) {
      // Pop the hearts whose fill changed (the newest last, a beat later).
      const svgs = this.hearts.querySelectorAll('svg');
      const i0 = Math.floor(prev / PER_HEART);
      const i1 = Math.min(9, Math.floor((pts - 1) / PER_HEART));
      for (let i = i0; i <= i1; i++) {
        const el = svgs[i];
        if (!el) continue;
        el.classList.add('pop');
        (el as SVGElement).style.animationDelay = `${(i - i0) * 90}ms`;
      }
    }
    this.heartPts = pts;
  }

  private sprinkle(n: number): void {
    const host = this.ribbonHost;
    for (let i = 0; i < n; i++) {
      const h = document.createElement('div');
      h.className = 'dlg-float';
      h.innerHTML = HEART(1, `f${i}${Date.now()}`);
      h.style.left = `${40 + Math.random() * 140}px`;
      h.style.top = `${250 + Math.random() * 20}px`;
      h.style.animationDelay = `${i * 90}ms`;
      host.appendChild(h);
      window.setTimeout(() => h.remove(), 1400 + i * 90);
    }
  }

  private ribbon(label: string, color: string, item: string, cake = false): void {
    this.ribbonHost.querySelectorAll('.dlg-ribbon').forEach((r) => r.remove());
    const r = document.createElement('div');
    r.className = 'dlg-ribbon';
    r.style.background = `linear-gradient(180deg, ${color}, ${color}cc)`;
    r.innerHTML = `${cake ? CAKE : HEART(1, 'rb')}<span>${label}${item ? ` · ${item}` : ''}</span>`;
    this.ribbonHost.appendChild(r);
  }

  private toast(look: (typeof NPCS)[NpcId]['look'], bg: [number, number], text: string): void {
    this.toastEl.innerHTML = `<div class="hv-inner"><div class="pp">${portraitSvg(look, bg, 'happy')}</div>${CAKE.replace('<svg', '<svg width="26" height="26"')}<span>${text}</span></div>`;
    this.toastEl.classList.remove('hv-hidden', 'hv-anim-in');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('hv-anim-in');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hv-hidden'), 5200);
  }

  cinema(on: boolean, title?: string, sub?: string): void {
    this.letterbox.classList.toggle('on', on);
    this.game.hud.root.classList.toggle('hv-heartcine', on);
    this.el.classList.toggle('cine', on);
    if (on && title) {
      // The title sits in the top letterbox band (never over the actors) and stays, dimmed, for the scene.
      this.titleCard.innerHTML = `<div class="rule"></div><div class="t">${title}</div>${sub ? `<div class="s">${HEART(1, 'tc')}<span>${sub}</span></div>` : ''}<div class="rule r"></div>`;
      this.titleCard.classList.remove('dim');
      this.titleCard.classList.add('on');
      window.clearTimeout(this.titleTimer);
      this.titleTimer = window.setTimeout(() => this.titleCard.classList.add('dim'), 4200);
    } else if (!on) this.titleCard.classList.remove('on', 'dim');
  }

  private setSpeaking(on: boolean): void {
    this.portrait.classList.toggle('talk', on);
    if (this.npc) this.game.events.emit('dialogue:speaking', { id: this.npc, on });
  }

  // ───────────────────────────────────────────── typewriter / choices

  private line_(id: NpcId | null, text: string, mood: Mood): Promise<void> {
    if (id) {
      this.setPortrait(id, mood);
      this.game.events.emit('npc:line', { id, mood });
    }
    this.el.querySelector('.dlg-choices')?.remove();
    this.line = text;
    this.shown = 0;
    this.text.textContent = '';
    this.text.classList.remove('dlg-q');
    this.next.classList.add('hv-hidden');
    window.clearTimeout(this.timer);
    this.setSpeaking(!!id);
    this.tick();
    return new Promise((r) => (this.waiter = r));
  }

  private tick = (): void => {
    if (!this.openFlag) return;
    if (this.shown >= this.line.length) {
      this.next.classList.remove('hv-hidden');
      this.setSpeaking(false);
      return;
    }
    const ch = this.line[this.shown]!;
    this.shown++;
    this.paintText();
    if (ch === ' ' && this.npc) this.game.events.emit('ui:blip', { id: this.npc });
    const delay = /[.!?]/.test(ch) && this.line[this.shown] === ' ' ? 190 : /[,—…]/.test(ch) ? 90 : 17;
    this.timer = window.setTimeout(this.tick, delay);
  };

  finishLine(): void {
    window.clearTimeout(this.timer);
    this.shown = this.line.length;
    this.paintText();
    this.next.classList.remove('hv-hidden');
    this.setSpeaking(false);
  }

  /** Typed part + the rest laid out invisibly, so words never jump to the next line mid-type. */
  private paintText(): void {
    const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const a = this.line.slice(0, this.shown);
    const b = this.line.slice(this.shown);
    this.text.innerHTML = b ? `${esc(a)}<span class="rest">${esc(b)}</span>` : esc(a);
  }

  private advance(): void {
    if (this.choiceWaiter) return;
    if (this.shown < this.line.length) {
      this.finishLine();
      return;
    }
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  private choice_(id: NpcId, q: string, options: string[], mood: Mood): Promise<number> {
    this.setPortrait(id, mood);
    window.clearTimeout(this.timer);
    this.setSpeaking(false);
    this.line = q;
    this.shown = q.length;
    this.text.textContent = q;
    this.text.classList.add('dlg-q');
    this.next.classList.add('hv-hidden');
    this.el.querySelector('.dlg-choices')?.remove();
    const box = document.createElement('div');
    box.className = 'dlg-choices';
    options.forEach((o, i) => {
      const b = document.createElement('div');
      b.className = 'dlg-choice';
      b.style.animationDelay = `${60 + i * 60}ms`;
      b.innerHTML = `<span class="k">${i + 1}</span><span>${o}</span>`;
      b.addEventListener('pointerenter', () => this.selectChoice(i));
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.pickChoice(i);
      });
      box.appendChild(b);
    });
    this.text.after(box);
    this.choiceCount = options.length;
    this.selectChoice(0);
    return new Promise((r) => (this.choiceWaiter = r));
  }

  private selectChoice(i: number): void {
    this.choiceSel = i;
    this.el.querySelectorAll('.dlg-choice').forEach((c, k) => c.classList.toggle('sel', k === i));
  }

  private pickChoice(i: number): void {
    const w = this.choiceWaiter;
    if (!w) return;
    this.choiceWaiter = null;
    this.el.querySelector('.dlg-choices')?.remove();
    w(i);
  }
}

/** 'social': every villager with portrait, hearts, birthday and today's talk / gift checks. */
export class SocialPanel implements Panel {
  private el: HTMLElement;
  constructor(private game: Game, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hv-social hv-hidden interactive';
    parent.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.game.events.emit('ui:open', { name: 'none' });
      e.stopPropagation();
    });
    window.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hv-hidden')) return;
      if (e.code === 'Escape' || e.code === 'KeyE') this.game.events.emit('ui:open', { name: 'none' });
    });
  }

  open(): void {
    const rel = this.game.services.relationships;
    const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
    const cards = NPC_IDS.map((id) => {
      const d = NPCS[id];
      const pts = rel?.points(id) ?? 0;
      const hearts = Array.from({ length: 10 }, (_, i) => HEART((pts - i * PER_HEART) / PER_HEART, `s${id}${i}`)).join('');
      const bday = rel?.isBirthday(id) ?? false;
      const talked = rel?.talkedToday(id) ?? false;
      const gifts = rel?.giftsThisWeek(id) ?? 0;
      return `<div class="card${bday ? ' bday' : ''}"><div class="pp">${portraitSvg(d.look, d.portraitBg, bday ? 'laugh' : 'happy')}</div>
        <div><div class="nm">${d.name}</div><div class="rl">${d.role}</div><div class="hs">${hearts}</div></div>
        <div class="meta"><div>${CAKE.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px"')} ${cap(d.birthday.season)} ${d.birthday.day}</div>
        <div class="chk">Talked <span class="box${talked ? ' on' : ''}"></span></div>
        <div class="chk">Gifts <span class="box${gifts > 0 ? ' on' : ''}"></span><span class="box${gifts > 1 ? ' on' : ''}"></span></div></div></div>`;
    }).join('');
    this.el.innerHTML = `<div class="hv-panel hv-anim-in"><div class="hv-inner"><h2>Hearthvale Folk <small>Talk every day · 2 gifts a week · ×8 on birthdays</small></h2><div class="grid">${cards}</div></div></div>`;
    this.el.classList.remove('hv-hidden');
  }

  close(): void {
    this.el.classList.add('hv-hidden');
  }
}

const SHEET_CSS = /* css */ `
.hv-psheet { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: auto; background: radial-gradient(120% 100% at 50% 30%, rgba(40,22,10,.55), rgba(16,8,4,.82)); z-index: 4; }
.hv-psheet .grid { display: grid; grid-template-columns: repeat(2, auto); gap: 14px 22px; }
.hv-psheet.one .grid { grid-template-columns: auto; }
.hv-psheet .row { display: flex; align-items: flex-end; gap: 8px; padding: 8px 10px 10px; border-radius: 16px; background: linear-gradient(180deg, var(--wood-1), var(--wood-2)); border: 3px solid var(--wood-3); box-shadow: 0 6px 0 rgba(40,20,8,.35); }
.hv-psheet .nm { writing-mode: vertical-rl; transform: rotate(180deg); font-family: var(--font-head); font-weight: 700; font-size: 19px; color: #fff4e0; text-shadow: 0 2px 0 var(--wood-3); padding: 2px 0; }
.hv-psheet .pp { position: relative; width: 150px; height: 150px; border-radius: 10px; overflow: hidden; box-shadow: 0 0 0 3px #f6e2b8, 0 0 0 5px var(--wood-3); }
.hv-psheet.one .pp { width: 190px; height: 190px; }
.hv-psheet .pp svg { width: 100%; height: 100%; display: block; }
.hv-psheet .pp span { position: absolute; left: 6px; bottom: 5px; font-family: var(--font-body); font-weight: 800; font-size: 12px; color: #fff; background: rgba(40,20,8,.55); padding: 0 6px 1px; border-radius: 6px; }
`;

/**
 * 'portraits' — the portrait model sheet: every villager in five expressions
 * ('portraits:<npcId>' = one villager in all nine). Staged by the 'town-portraits' demo.
 */
export class PortraitSheetPanel implements Panel {
  private el: HTMLElement;
  constructor(private game: Game, parent: HTMLElement) {
    if (!document.getElementById('hv-psheet-css')) {
      const st = document.createElement('style');
      st.id = 'hv-psheet-css';
      st.textContent = SHEET_CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'hv-psheet hv-hidden interactive';
    parent.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.game.events.emit('ui:open', { name: 'none' });
    });
  }

  open(arg?: string): void {
    const one = arg && NPCS[arg as NpcId] ? (arg as NpcId) : null;
    const moods: Mood[] = one ? ['neutral', 'happy', 'laugh', 'blush', 'thinking', 'surprised', 'worried', 'sad', 'angry'] : ['happy', 'laugh', 'surprised', 'sad', 'angry'];
    const ids = one ? [one] : NPC_IDS;
    const rows = ids.map((id) => {
      const d = NPCS[id];
      const cells = moods.map((m) => `<div class="pp">${portraitSvg(d.look, d.portraitBg, m)}<span>${m}</span></div>`);
      const chunks = one ? [cells.slice(0, 5), cells.slice(5)] : [cells];
      return chunks.map((c, i) => `<div class="row">${i === 0 ? `<div class="nm">${shortName(d.name)}</div>` : '<div class="nm">&nbsp;</div>'}${c.join('')}</div>`).join('');
    });
    this.el.classList.toggle('one', !!one);
    this.el.innerHTML = `<div class="grid hv-anim-in">${rows.join('')}</div>`;
    this.el.classList.remove('hv-hidden');
  }

  close(): void {
    this.el.classList.add('hv-hidden');
  }
}
