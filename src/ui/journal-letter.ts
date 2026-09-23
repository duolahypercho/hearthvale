/**
 * Letter reader ('letter:<id>'): a single sheet of stationery unfolding over the scene.
 * Four papers — Gran's cream laid paper (pressed violet, wax seal, a lantern stamp), the town
 * letterhead, villagers' notebook pages and Glimmerco's glossy corporate sheet. Attachments show
 * as a tied parcel tag at the foot of the page. Click / Space / Esc folds it away.
 */
import './journal.css';
import type { Game } from '../core/game';
import type { Panel } from './hud';
import { LETTERS, type LetterDef } from '../data/story';
import { itemDef } from '../data/items';
import { loadStoryFonts } from './journal-cutscene';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PRESSED_FLOWER = `<svg class="lt-flower" viewBox="0 0 120 160" aria-hidden="true">
  <path d="M60 158 C58 120 64 92 58 60" stroke="#6f8a4a" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M59 118 C44 110 34 112 26 104 C40 100 52 104 59 112 Z" fill="#8aa45c" opacity=".85"/>
  <path d="M60 96 C74 88 86 90 94 82 C80 78 68 84 60 92 Z" fill="#7a9a50" opacity=".85"/>
  <g transform="translate(58 46)">
    ${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="11" ry="20" transform="rotate(${a}) translate(0 -16)" fill="#b89ad8" opacity=".82"/>`).join('')}
    ${[36, 108, 180, 252, 324].map((a) => `<ellipse rx="7" ry="13" transform="rotate(${a}) translate(0 -12)" fill="#d8c4ee" opacity=".7"/>`).join('')}
    <circle r="6" fill="#f2c94c"/><circle r="3" fill="#e8a33a"/>
  </g></svg>`;

const STAMP = `<svg class="lt-stamp" viewBox="0 0 90 110" aria-hidden="true">
  <defs><radialGradient id="stg" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#ffe7a8"/><stop offset="1" stop-color="#f0a040"/></radialGradient></defs>
  <rect x="3" y="3" width="84" height="104" rx="3" fill="#fbf4e4" stroke="#d8c8a8" stroke-width="2" stroke-dasharray="4 3"/>
  <rect x="11" y="11" width="68" height="76" fill="#2f4a6a"/>
  <circle cx="45" cy="58" r="22" fill="url(#stg)" opacity=".55"/>
  <path d="M45 26 v6 M35 36 h20 l-4 -5 h-12 z" stroke="#1a2230" stroke-width="2.5" fill="#1a2230"/>
  <rect x="36" y="36" width="18" height="26" rx="4" fill="url(#stg)" stroke="#1a2230" stroke-width="2.5"/>
  <path d="M33 62 h24 l-4 6 h-16 z" fill="#1a2230"/>
  <path d="M11 80 q17 -8 34 0 t34 0 v7 h-68 z" fill="#3f6a4a"/>
  <text x="45" y="100" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="11" font-weight="700" fill="#6a4a2a">HEARTHVALE · 2c</text>
</svg>`;

const SEAL = (letter: string, color = '#b8322a'): string => `<svg class="lt-seal" viewBox="0 0 100 100" aria-hidden="true">
  <defs><radialGradient id="sealg" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ff8a6a"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="#6a1410"/></radialGradient></defs>
  <path d="M50 4 C62 6 66 12 76 12 C86 16 88 26 94 34 C98 46 92 54 96 64 C94 76 84 80 80 88 C70 96 60 92 50 96 C40 98 32 90 22 88 C12 82 12 72 6 64 C2 54 8 44 4 34 C10 24 16 18 24 12 C34 8 40 4 50 4Z" fill="url(#sealg)"/>
  <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(60,10,5,0.45)" stroke-width="3"/>
  <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,190,160,0.35)" stroke-width="1.2" transform="translate(-1 -1.5)"/>
  <text x="50" y="63" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-style="italic" font-weight="600" font-size="38" fill="rgba(70,10,5,0.55)">${letter}</text>
  <text x="49" y="61.5" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-style="italic" font-weight="600" font-size="38" fill="rgba(255,170,140,0.35)">${letter}</text>
</svg>`;

const CREST = `<svg class="lt-crest" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4 L56 12 V30 C56 46 44 56 32 60 C20 56 8 46 8 30 V12 Z" fill="#3f6a52" stroke="#c8a050" stroke-width="3"/>
  <path d="M32 16 v5 M24 24 h16 l-3 -4 h-10z" stroke="#f2d48a" stroke-width="2.4" fill="#f2d48a"/><rect x="25" y="24" width="14" height="18" rx="3" fill="#ffd36a" stroke="#f2d48a" stroke-width="2"/><path d="M22 42 h20 l-3 5 h-14z" fill="#f2d48a"/></svg>`;

const GLIMMER_LOGO = `<svg class="lt-glogo" viewBox="0 0 220 44" aria-hidden="true"><defs><linearGradient id="glg" x1="0" x2="1"><stop offset="0" stop-color="#3a8fd8"/><stop offset="1" stop-color="#6fe0e8"/></linearGradient></defs>
  <path d="M22 4 L26 18 L40 22 L26 26 L22 40 L18 26 L4 22 L18 18 Z" fill="url(#glg)"/>
  <text x="50" y="31" font-family="Fredoka, sans-serif" font-weight="700" font-size="27" fill="#1f3a5a" letter-spacing="1">GLIMMERCO</text></svg>`;

export interface LetterOptions {
  /** Called once when the reader closes (mark read, hand over attachments). */
  onClose?: (id: string) => void;
}

export class LetterPanel implements Panel {
  private el: HTMLElement;
  private paper: HTMLElement;
  private resolve: (() => void) | null = null;
  private current: string | null = null;
  private openFlag = false;

  constructor(private game: Game, parent: HTMLElement, private opts: LetterOptions = {}) {
    loadStoryFonts();
    this.el = document.createElement('div');
    this.el.className = 'hv-letter-reader hv-hidden interactive';
    this.el.innerHTML = `<div class="lt-backdrop"></div><div class="lt-sheet"></div><div class="lt-hint">click to fold away</div>`;
    parent.appendChild(this.el);
    this.paper = this.el.querySelector('.lt-sheet')!;
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.dismiss();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.openFlag) return;
      if (['Space', 'Enter', 'Escape', 'KeyE', 'KeyX'].includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
      }
    });
  }

  /** Show a letter and resolve when the player folds it away. */
  show(id: string): Promise<void> {
    this.render(id);
    this.openFlag = true;
    return new Promise((r) => (this.resolve = r));
  }

  open(arg?: string): void {
    this.render(arg ?? 'gran-intro');
    this.openFlag = true;
  }

  close(): void {
    this.el.classList.add('hv-hidden');
    this.openFlag = false;
  }

  private dismiss(): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.el.classList.add('closing');
    const id = this.current;
    window.setTimeout(() => {
      this.el.classList.add('hv-hidden');
      this.el.classList.remove('closing');
      if (id) this.opts.onClose?.(id);
      const r = this.resolve;
      this.resolve = null;
      if (r) r();
      else if (this.game.hud.openPanelName === 'letter') this.game.events.emit('ui:open', { name: 'none' });
    }, 260);
  }

  private render(id: string): void {
    const L: LetterDef | undefined = LETTERS[id];
    if (!L) {
      console.warn(`[letter] unknown letter "${id}"`);
      return;
    }
    this.current = id;
    const paras = L.body.map((p) => `<p>${esc(p)}</p>`).join('');
    let attach = '';
    if (L.attach) {
      const a = L.attach;
      const what = a.gold ? `${a.gold.toLocaleString()}g` : `${a.qty ?? 1} × ${itemDef(a.itemId ?? '')?.name ?? a.itemId}`;
      attach = `<div class="lt-attach"><span class="tag">Enclosed</span>${esc(what)}</div>`;
    }
    const head =
      L.stationery === 'town'
        ? `<div class="lt-letterhead">${CREST}<div><b>Hearthvale Town Council</b><span>The Clock House · Top of the Square</span></div></div>`
        : L.stationery === 'glimmer'
          ? `<div class="lt-letterhead g">${GLIMMER_LOGO}<span class="tm">Brighter · Faster · Forever™</span></div>`
          : '';
    const deco = L.stationery === 'gran' ? PRESSED_FLOWER + STAMP + SEAL('R') : L.stationery === 'villager' ? `<div class="lt-tape"></div>` : L.stationery === 'town' ? SEAL('H', '#2f5a44') : '';
    const sealLine = L.seal ? `<div class="lt-sealed">— ${esc(L.seal)} —</div>` : '';
    this.paper.className = `lt-sheet paper-${L.stationery}`;
    this.paper.innerHTML = `${deco}${head}${sealLine}
      ${L.greeting ? `<div class="lt-greet">${esc(L.greeting)}</div>` : ''}
      <div class="lt-body">${paras}</div>
      <div class="lt-sign">${esc(L.sign).replace(/\n/g, '<br/>')}</div>
      ${L.ps ? `<div class="lt-ps">P.S. ${esc(L.ps)}</div>` : ''}
      ${attach}`;
    this.el.classList.remove('hv-hidden', 'closing');
    this.paper.classList.remove('unfold');
    void this.paper.offsetWidth;
    this.paper.classList.add('unfold');
  }
}
