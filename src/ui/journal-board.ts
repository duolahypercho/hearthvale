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
    wrap.innerHTML = `<div class="bd-sign"><span>Help Wanted</span></div><div class="bd-cork"><div class="bd-notes"></div><div class="bd-flyer">${PIN('#e8b64a')}<b>Lantern Hall</b><small>Six rooms. One valley.<br/>Bring what you can.</small></div><div class="bd-flyer2">${PIN('#5fa83c')}<b>LOST CAT</b><small>Answers to Pip.<br/>Does not answer to Pip.</small></div></div>`;
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
      this.notes.appendChild(n);
    });
  }
}
