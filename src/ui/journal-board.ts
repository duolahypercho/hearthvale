/**
 * Help Wanted board ('board'): the notice board in the square, up close — a cork board in a carved
 * frame with today's requests pinned on as little paper notes (handwritten, slightly crooked).
 * Accept a note to add it to the journal; deliver it here once the backpack holds the goods.
 */
import './journal.css';
import './journal-ui.css';
import type { Game } from '../core/game';
import { Screen, el, closeButton, sfx, replay, escapeHtml } from './kit';
import { iconOf, itemName, PIN, COIN, CHECK } from './journal-art';
import { loadStoryFonts } from './journal-cutscene';
import { FESTIVALS } from '../data/festivals';

const SEASON_COL: Record<string, string> = { spring: '#e27a9a', summer: '#e8a82e', fall: '#c8642e', winter: '#5a8ac8' };

/** Kit's crayon drawing of the Lantern Hall (lanterns lit = the rooms you've restored). */
function kitDrawing(lit: number): string {
  const lanterns = Array.from({ length: 6 }, (_, i) => {
    const x = 34 + i * 26;
    const on = i < lit;
    return `<g transform="translate(${x} 58)"><path d="M0 0 v6" stroke="#5a4a3a" stroke-width="2"/><rect x="-6" y="6" width="12" height="14" rx="3" fill="${on ? '#ffcf4a' : '#9a9a9a'}" stroke="#5a4a3a" stroke-width="2"/>${on ? '<path d="M-10 13 h-5 M10 13 h5 M0 25 v4" stroke="#ffb020" stroke-width="2.4" stroke-linecap="round"/>' : ''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 200 150" aria-hidden="true">
    <path d="M18 128 Q100 118 184 128" stroke="#5fa83c" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M36 128 V70 L100 30 L166 70 V128" fill="#f2c8a0" stroke="#8a4a2a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M28 74 L100 26 L174 74" fill="none" stroke="#c8473a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="88" y="98" width="24" height="30" rx="10" fill="#8a5a36" stroke="#5a3a1a" stroke-width="2"/>
    ${lanterns}
    <circle cx="170" cy="20" r="11" fill="#ffe27a" stroke="#e8b020" stroke-width="2"/>
    <g stroke="#3a2a1a" stroke-width="2.4" stroke-linecap="round" fill="none"><circle cx="58" cy="108" r="5" fill="#ffd8b0"/><path d="M58 113 v12 M52 118 h12 M58 125 l-5 7 M58 125 l5 7"/><circle cx="146" cy="104" r="6" fill="#ffd8b0"/><path d="M146 110 v14 M139 115 h14 M146 124 l-5 8 M146 124 l5 8"/></g>
  </svg>`;
}


const css = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
const PIN_COLORS = ['#d8473a', '#3f86d6', '#e8b64a', '#5fa83c'];

export class BoardPanel extends Screen {
  private notes!: HTMLElement;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent.parentElement?.querySelector('.hv-screens') ?? parent, 'hv-board', { backdrop: true });
    loadStoryFonts();
    game.events.on('inventory:change', () => {
      if (this.isOpen) this.renderNotes();
    });
  }

  protected render(): void {
    this.root.querySelector('.u-pop')?.remove();
    const wrap = el('div', 'jb-board u-pop');
    wrap.innerHTML = `<div class="bd-sign"><span>Help Wanted</span></div><div class="bd-cork"><div class="bd-twine"></div><div class="bd-notes"></div><div class="bd-flyer">${PIN('#e8b64a')}<b>Lantern Hall</b><small>Six rooms. One valley.<br/>Bring what you can.</small></div><div class="bd-flyer2">${PIN('#5fa83c')}<b>LOST CAT</b><small>Answers to Pip.<br/>Does not answer to Pip.</small></div></div>`;
    wrap.appendChild(closeButton(() => this.requestClose()));
    this.root.appendChild(wrap);
    this.notes = wrap.querySelector('.bd-notes')!;
    this.renderNotes();
  }

  private renderNotes(): void {
    const q = this.game.services.quests;
    const posts = (q?.postings() ?? []).filter((p) => p.state !== 'expired');
    this.notes.innerHTML = '';
    if (!posts.length) {
      this.notes.innerHTML = `<div class="bd-none">Nothing pinned today.<br/><small>Come back tomorrow morning.</small></div>`;
      return;
    }
    this.notes.append(...this.ephemera(posts.length));
    posts.forEach((p, i) => {
      const have = this.game.services.inventory?.count(p.itemId) ?? 0;
      const n = el('div', `bd-note ${p.state}`);
      n.style.setProperty('--rot', `${[-3, 2.5, -1.5, 3][i % 4]}deg`);
      n.style.setProperty('--paper', css(p.paper));
      const btn =
        p.state === 'posted'
          ? `<button class="u-btn green small" data-a="accept" data-nav>Accept</button>`
          : p.state === 'active'
            ? `<button class="u-btn ${have >= p.qty ? 'green' : ''} small" data-a="deliver" data-nav ${have >= p.qty ? '' : 'disabled'}>${have >= p.qty ? 'Deliver' : `${have} / ${p.qty}`}</button>`
            : `<div class="bd-doneStamp">${CHECK} Thank you!</div>`;
      n.innerHTML = `${PIN(PIN_COLORS[i % PIN_COLORS.length])}<div class="bd-from">${escapeHtml(p.giver)}</div><div class="bd-title">${escapeHtml(p.title)}</div>
        <p class="bd-text">${escapeHtml(p.text)}</p>
        <div class="bd-want">${iconOf(p.itemId)}<span>${p.qty} × ${escapeHtml(itemName(p.itemId))}</span></div>
        <div class="bd-foot"><span class="bd-pay">${COIN}<b>${p.gold.toLocaleString()}g</b></span>${btn}</div>`;
      n.querySelector<HTMLElement>('[data-a="accept"]')?.addEventListener('click', () => {
        if (q?.accept(p.id)) {
          sfx(this.game, 'buy');
          this.renderNotes();
          replay(this.notes.children[i] as HTMLElement, 'stamp');
        }
      });
      n.querySelector<HTMLElement>('[data-a="deliver"]')?.addEventListener('click', () => {
        if (q?.deliver(p.id)) {
          sfx(this.game, 'coin');
          this.game.events.emit('ui:toast', { text: `${p.giver} thanks you! +${p.gold}g`, kind: 'gold' });
          this.renderNotes();
          replay(this.notes.children[i] as HTMLElement, 'stamp');
        } else sfx(this.game, 'error');
      });
      this.notes.insertBefore(n, this.notes.querySelector('.bd-eph'));
    });
  }

  /** Everything else a village board collects: the calendar, a Glimmerco poster somebody answered, Kit's drawing. */
  private ephemera(posts: number): HTMLElement[] {
    const c = this.game.calendar;
    const lit = this.game.services.quests?.lanternsLit() ?? 0;
    const next = Object.values(FESTIVALS)
      .map((f) => ({ f, d: (['spring', 'summer', 'fall', 'winter'].indexOf(f.season) - c.seasonIndex + 4) % 4 * 28 + f.day - c.day }))
      .filter((x) => x.d >= 0)
      .sort((a, b) => a.d - b.d)[0];
    const cal = el('div', 'bd-eph bd-cal');
    cal.style.setProperty('--sc', SEASON_COL[c.season] ?? '#c8642e');
    cal.innerHTML = `${PIN('#3f86d6')}<div class="cal-top">${escapeHtml(c.season)} · year ${c.year}</div><div class="cal-day">${c.day}</div><div class="cal-wd">${escapeHtml(c.weekday)}</div>${
      next ? `<div class="cal-next">${next.d === 0 ? 'Today' : `In ${next.d} day${next.d > 1 ? 's' : ''}`}: <b>${escapeHtml(next.f.name)}</b></div>` : ''
    }`;
    const glim = el('div', 'bd-eph bd-glim');
    glim.innerHTML = `${PIN('#9aa8b8')}<div class="gl-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L14 9 L21 12 L14 15 L12 22 L10 15 L3 12 L10 9Z" fill="#fff"/></svg>GLIMMERCO</div><div class="gl-head">EverGlow™</div><div class="gl-sub">Why wait for tomorrow?<br/>Brighter. Faster. Forever.</div><div class="gl-scrawl">we'll wait, thanks</div>`;
    const kit = el('div', 'bd-eph bd-kit');
    kit.innerHTML = `${PIN('#e8b64a')}${kitDrawing(lit)}<div class="kit-cap">the HALL by KIT</div>`;
    // Three notes fill the board; with fewer, the ephemera spill into the gaps.
    return posts >= 3 ? [cal, kit] : [cal, glim, kit];
  }
}
