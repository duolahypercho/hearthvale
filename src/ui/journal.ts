/**
 * Journal ('journal[:quests|hall|letters]', J): a leather-bound book lying open.
 *   Quests   the story so far (wax-sealed entries, the active one glowing) + Help Wanted requests;
 *            right page: the selected entry, its goal and a lantern progress strip
 *   Hall     the Lantern Hall floor plan — six room cards around the Great Lantern; right page: the
 *            room's bundles, what they want and what the room restores in the valley
 *   Letters  every letter received (unread ones sealed); right page: a preview + "Read letter"
 * Ribbon bookmarks switch tabs (Q / E or ← → too). Also the envelope badge by the clock.
 */
import './journal.css';
import './journal-ui.css';
import type { Game } from '../core/game';
import { Screen, el, closeButton, sfx, replay, escapeHtml } from './kit';
import { ROOMS, roomDef } from '../data/bundles';
import { LETTERS } from '../data/story';
import { lanternSvg, sackSvg, iconOf, itemName, valleySvg, SEAL_MINI, ENVELOPE, CHECK, COIN, PIN } from './journal-art';
import { loadStoryFonts } from './journal-cutscene';

type Tab = 'quests' | 'hall' | 'letters';
const TABS: { id: Tab; label: string; color: string }[] = [
  { id: 'quests', label: 'Quests', color: '#b8433a' },
  { id: 'hall', label: 'Lantern Hall', color: '#d8a23a' },
  { id: 'letters', label: 'Letters', color: '#3f76a8' },
];
const css = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
const GRAN_COLOR: Record<string, string> = { gran: '#b8322a', town: '#2f5a44', villager: '#8a5a3a', glimmer: '#3a8fd8' };

export class JournalPanel extends Screen {
  private tab: Tab = 'quests';
  private sel: Record<Tab, string> = { quests: '', hall: 'seed', letters: '' };
  private book!: HTMLElement;
  private leftPage!: HTMLElement;
  private rightPage!: HTMLElement;

  constructor(game: Game, parent: HTMLElement) {
    super(game, parent.parentElement?.querySelector('.hv-screens') ?? parent, 'hv-journal', { backdrop: true });
    loadStoryFonts();
    const rerender = (): void => {
      if (this.isOpen) this.renderPages();
    };
    game.events.on('mail:new', rerender);
    game.events.on('mail:read', rerender);
    game.events.on('quest:sync', rerender);
    game.events.on('quest:room', rerender);
  }

  protected render(arg?: string): void {
    this.root.querySelector('.u-pop')?.remove();
    if (arg === 'quests' || arg === 'hall' || arg === 'letters') this.tab = arg;
    const wrap = el('div', 'jn-wrap u-pop');
    this.book = el('div', 'jn-book');
    this.book.innerHTML = `<div class="jn-cover"></div><div class="jn-pages"><div class="jn-page left"></div><div class="jn-gutter"></div><div class="jn-page right"></div></div><div class="jn-tabs"></div><div class="jn-band"></div>`;
    this.book.appendChild(closeButton(() => this.requestClose()));
    wrap.appendChild(this.book);
    this.root.appendChild(wrap);
    this.leftPage = this.book.querySelector('.jn-page.left')!;
    this.rightPage = this.book.querySelector('.jn-page.right')!;
    const tabs = this.book.querySelector('.jn-tabs')!;
    for (const t of TABS) {
      const b = el('button', 'jn-tab', `<span>${t.label}</span>`);
      b.style.setProperty('--tab', t.color);
      b.dataset.tab = t.id;
      b.dataset.nav = '';
      b.addEventListener('click', () => this.setTab(t.id));
      tabs.appendChild(b);
    }
    this.renderPages();
  }

  private setTab(t: Tab): void {
    if (t === this.tab) return;
    this.tab = t;
    sfx(this.game, 'tab');
    this.renderPages();
    replay(this.book.querySelector('.jn-pages'), 'flip');
  }

  override key(code: string): boolean {
    const i = TABS.findIndex((t) => t.id === this.tab);
    if (code === 'KeyQ' || code === 'BracketLeft') {
      this.setTab(TABS[(i + TABS.length - 1) % TABS.length]!.id);
      return true;
    }
    if (code === 'KeyE' || code === 'BracketRight') {
      this.setTab(TABS[(i + 1) % TABS.length]!.id);
      return true;
    }
    return false;
  }

  private renderPages(): void {
    this.book.querySelectorAll<HTMLElement>('.jn-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const unread = this.game.services.story?.unread() ?? 0;
    const lt = this.book.querySelector<HTMLElement>('.jn-tab[data-tab="letters"] span');
    if (lt) lt.innerHTML = `Letters${unread ? ` <i class="jn-dot">${unread}</i>` : ''}`;
    if (this.tab === 'quests') this.renderQuests();
    else if (this.tab === 'hall') this.renderHall();
    else this.renderLetters();
  }

  // ───────────────────────────── quests

  private renderQuests(): void {
    const story = this.game.services.story?.quests() ?? [];
    const posts = (this.game.services.quests?.postings() ?? []).filter((p) => p.state === 'active');
    if (!this.sel.quests || (!story.some((q) => q.id === this.sel.quests) && !posts.some((p) => p.id === this.sel.quests))) this.sel.quests = story.find((q) => q.state === 'active')?.id ?? story[0]?.id ?? '';
    const c = this.game.calendar;
    const today = (c.year - 1) * 112 + ['spring', 'summer', 'fall', 'winter'].indexOf(c.season) * 28 + c.day;
    const storyRows = story
      .map((q) => {
        const icon = q.state === 'done' ? `<i class="jn-bul done">${CHECK}</i>` : q.state === 'active' ? `<i class="jn-bul active">${lanternSvg(0xffb84a, 1, 'jl-mini')}</i>` : `<i class="jn-bul locked">?</i>`;
        return `<button class="jn-row ${q.state}${q.id === this.sel.quests ? ' on' : ''}" data-id="${q.id}" data-nav>${icon}<span class="t">${q.state === 'locked' ? '· · ·' : escapeHtml(q.title)}</span>${q.progress && q.state !== 'locked' ? `<small>${q.progress[0]}/${q.progress[1]}</small>` : ''}</button>`;
      })
      .join('');
    const postRows = posts.length
      ? posts
          .map((p) => {
            const have = this.game.services.inventory?.count(p.itemId) ?? 0;
            const left = p.due - today;
            return `<button class="jn-row hw${p.id === this.sel.quests ? ' on' : ''}" data-id="${p.id}" data-nav><i class="jn-bul item">${iconOf(p.itemId)}</i><span class="t">${escapeHtml(p.title)}</span><small class="${have >= p.qty ? 'ok' : ''}">${Math.min(have, p.qty)}/${p.qty} · ${left <= 0 ? 'today' : `${left}d`}</small></button>`;
          })
          .join('')
      : (() => {
          const pinned = (this.game.services.quests?.postings() ?? []).filter((p) => p.state === 'posted');
          return pinned.length
            ? `<div class="jn-pins">${pinned
                .map((p, i) => `<div class="jn-pin" style="--paper:${css(p.paper)};--tilt:${i % 2 ? 2.2 : -1.8}deg">${PIN(i % 2 ? '#3f76a8' : '#d8473a')}<i>${iconOf(p.itemId)}</i><b>${escapeHtml(p.giver)}</b><span>${p.qty} × ${escapeHtml(itemName(p.itemId))}</span><small>${COIN}${p.gold.toLocaleString()}g</small></div>`)
                .join('')}</div><div class="jn-empty small">Pinned on the notice board in the square. Accept a request there.</div>`
            : `<div class="jn-empty">No requests taken. Check the notice board in the square.</div>`;
        })();
    this.leftPage.innerHTML = `<h2 class="jn-h">The story so far</h2><div class="jn-list">${storyRows}</div>
      <h2 class="jn-h small">Help Wanted</h2><div class="jn-list">${postRows}</div>`;
    this.leftPage.querySelectorAll<HTMLElement>('.jn-row').forEach((r) =>
      r.addEventListener('click', () => {
        this.sel.quests = r.dataset.id!;
        sfx(this.game, 'click');
        this.renderQuests();
      }),
    );
    const q = story.find((s) => s.id === this.sel.quests);
    const p = posts.find((s) => s.id === this.sel.quests);
    if (q) {
      const lit = this.game.services.quests?.lanternsLit() ?? 0;
      const strip = ROOMS.map((r, i) => `<div class="jn-strip-l">${lanternSvg(r.color, i < lit || (this.game.services.quests?.room(r.id)?.done ?? false) ? 1 : 0, 'jl-strip')}</div>`).join('');
      this.rightPage.innerHTML = q.state === 'locked'
        ? `<div class="jn-locked"><div class="big">?</div><p>This part of the story hasn't happened yet.</p></div>`
        : `<div class="jn-kicker">${q.state === 'done' ? 'Completed' : 'Current quest'}</div>
          <h1 class="jn-title">${escapeHtml(q.title)}</h1>
          <div class="jn-giver">— ${escapeHtml(q.giver)}</div>
          <p class="jn-text">${escapeHtml(q.text)}</p>
          <div class="jn-goal ${q.state}"><i>${q.state === 'done' ? CHECK : ''}</i><span>${escapeHtml(q.goal)}</span>${q.progress ? `<b>${q.progress[0]} / ${q.progress[1]}</b>` : ''}</div>
          ${q.hint && q.state === 'active' ? `<div class="jn-tip"><i>${lanternSvg(0xffb84a, 0.8, 'jl-mini')}</i><span>${escapeHtml(q.hint)}</span></div>` : ''}
          ${q.id === 'all-lanterns' || q.id === 'first-lantern' ? `<div class="jn-strip">${strip}</div>` : ''}
          ${q.id === 'glimmer' && this.game.services.story?.flag('glimmer') ? `<div class="jn-note">You ${this.game.services.story?.flag('glimmer') === 'accepted' ? 'signed the charter. The Hall burns white.' : 'turned Glimmerco down.'}</div>` : ''}
          <figure class="jn-plate">${this.valley()}<figcaption>Hearthvale, from Gran's hill · ${this.game.services.quests?.lanternsLit() ?? 0} of 6 lanterns</figcaption></figure>`;
    } else if (p) {
      const have = this.game.services.inventory?.count(p.itemId) ?? 0;
      this.rightPage.innerHTML = `<div class="jn-kicker">Help Wanted</div><h1 class="jn-title">${escapeHtml(p.title)}</h1><div class="jn-giver">— ${escapeHtml(p.giver)}</div>
        <p class="jn-text hand">“${escapeHtml(p.text)}”</p>
        <div class="jn-goal ${have >= p.qty ? 'done' : 'active'}"><i>${have >= p.qty ? CHECK : ''}</i><span>Bring ${p.qty} × ${escapeHtml(itemName(p.itemId))}</span><b>${Math.min(have, p.qty)} / ${p.qty}</b></div>
        <div class="jn-reward">${COIN}<b>${p.gold.toLocaleString()}g</b><small>Deliver at the notice board in the square</small></div>`;
    } else this.rightPage.innerHTML = '';
  }

  private valley(): string {
    const q = this.game.services.quests;
    const rooms = ROOMS.map((r) => ({ color: r.color, lit: !!q?.room(r.id)?.done }));
    return valleySvg(rooms, q?.rooms().some((r) => r.glimmer) ?? false);
  }

  // ───────────────────────────── hall

  private renderHall(): void {
    const q = this.game.services.quests;
    const lit = q?.lanternsLit() ?? 0;
    const card = (id: string): string => {
      const r = roomDef(id)!;
      const st = q?.room(id);
      const n = st?.bundles.filter((b) => b.done).length ?? 0;
      const m = st?.bundles.length ?? 0;
      return `<button class="jn-room${st?.done ? ' lit' : ''}${st?.glimmer ? ' glimmer' : ''}${this.sel.hall === id ? ' on' : ''}" data-id="${id}" style="--rc:${css(r.color)}" data-nav>
        ${lanternSvg(st?.glimmer ? 0xdff4ff : r.color, st?.done ? 1 : (n / Math.max(1, m)) * 0.4, 'jl-card')}
        <span class="nm">${escapeHtml(r.name.replace('The ', ''))}</span><small>${st?.done ? (st.glimmer ? 'EverGlow™' : 'Restored') : `${n} / ${m} bundles`}</small></button>`;
    };
    const [a, b, c, d, e, f] = ROOMS.map((r) => r.id);
    this.leftPage.innerHTML = `<h2 class="jn-h">The Lantern Hall</h2><div class="jn-sub">${lit} of 6 lanterns burning</div>
      <div class="jn-plan">
        <div class="col">${card(a!)}${card(c!)}${card(e!)}</div>
        <div class="nave"><div class="great" style="--w:${(lit / 6).toFixed(2)}">${lanternSvg(0xffc66a, lit / 6, 'jl-great')}</div><div class="nave-l">Great Lantern</div></div>
        <div class="col">${card(b!)}${card(d!)}${card(f!)}</div>
      </div>
      <h2 class="jn-h small">Back in the valley</h2><div class="jn-list jn-back">${ROOMS.map((room) => {
        const done = !!q?.room(room.id)?.done;
        return `<div class="jn-row ${done ? 'done' : 'locked'}" style="--rc:${css(room.color)}"><i class="jn-bul ${done ? 'done' : 'locked'}">${done ? CHECK : '?'}</i><span class="t">${done ? escapeHtml(room.restores.title) : '· · ·'}</span><small>${escapeHtml(room.lantern)}</small></div>`;
      }).join('')}</div>`;
    this.leftPage.querySelectorAll<HTMLElement>('.jn-room').forEach((r) =>
      r.addEventListener('click', () => {
        this.sel.hall = r.dataset.id!;
        sfx(this.game, 'click');
        this.renderHall();
      }),
    );
    const r = roomDef(this.sel.hall) ?? ROOMS[0]!;
    const st = q?.room(r.id);
    const bundles = (st?.bundles ?? [])
      .map((bs) => {
        const items = bs.def.items
          .map((it) => {
            const have = Math.min(it.qty, bs.given[it.itemId] ?? 0);
            return `<span class="jn-it ${have >= it.qty ? 'ok' : ''}" title="${escapeHtml(itemName(it.itemId, it.name))}">${iconOf(it.itemId, it)}<b>${have}/${it.qty}</b></span>`;
          })
          .join('');
        const gold = bs.def.gold ? `<span class="jn-it ${bs.paid >= bs.def.gold ? 'ok' : ''}">${COIN}<b>${bs.def.gold.toLocaleString()}g</b></span>` : '';
        return `<div class="jn-bundle ${bs.done ? 'done' : ''}"><div class="sk">${sackSvg(bs.def.color, bs.done, 0.5)}</div><div class="bd"><b>${escapeHtml(bs.def.name)}</b><div class="its">${items}${gold}</div></div></div>`;
      })
      .join('');
    this.rightPage.innerHTML = `<div class="jn-kicker" style="color:${css(r.color)}">${escapeHtml(r.lantern)}</div>
      <h1 class="jn-title">${escapeHtml(r.name)}</h1><p class="jn-text">${escapeHtml(r.blurb)}</p>
      <div class="jn-bundles">${bundles}</div>
      <div class="jn-restores ${st?.done ? 'on' : ''}"><small>${st?.done ? 'Restored to the valley' : 'Restores'}</small><b>${escapeHtml(r.restores.title)}</b><span>${escapeHtml(r.restores.text)}</span></div>`;
  }

  // ───────────────────────────── letters

  private renderLetters(): void {
    const mail = this.game.services.story?.mail() ?? [];
    if (!mail.some((m) => m.id === this.sel.letters)) this.sel.letters = mail[0]?.id ?? '';
    this.leftPage.innerHTML = `<h2 class="jn-h">Letters</h2><div class="jn-sub">${mail.length ? `${mail.length} received` : 'Your mailbox is empty'}</div>
      <div class="jn-list letters">${mail
        .map((m) => {
          const L = LETTERS[m.id];
          if (!L) return '';
          return `<button class="jn-mail${m.read ? '' : ' unread'}${m.id === this.sel.letters ? ' on' : ''}" data-id="${m.id}" data-nav>${m.read ? ENVELOPE(true, L.stationery === 'glimmer' ? '#e8f0fa' : '#f3e2bc') : ENVELOPE(false, L.stationery === 'glimmer' ? '#e8f0fa' : '#f3e2bc') + SEAL_MINI(GRAN_COLOR[L.stationery], L.from[0])}
            <span class="fr">${escapeHtml(L.from)}</span><span class="sj">${escapeHtml(L.subject)}</span></button>`;
        })
        .join('')}</div>`;
    this.leftPage.querySelectorAll<HTMLElement>('.jn-mail').forEach((r) =>
      r.addEventListener('click', () => {
        this.sel.letters = r.dataset.id!;
        sfx(this.game, 'click');
        this.renderLetters();
      }),
    );
    const L = LETTERS[this.sel.letters];
    const m = mail.find((x) => x.id === this.sel.letters);
    if (!L || !m) {
      this.rightPage.innerHTML = `<div class="jn-locked"><div class="big">${ENVELOPE(false)}</div><p>Letters arrive in the farm mailbox each morning.</p></div>`;
      return;
    }
    this.rightPage.innerHTML = `<div class="jn-kicker">${L.seal ? escapeHtml(L.seal) : 'Letter'}</div><h1 class="jn-title small">${escapeHtml(L.subject.replace(/^Sealed · /, ''))}</h1><div class="jn-giver">from ${escapeHtml(L.from)}</div>
      <div class="jn-preview paper-${L.stationery}">${L.greeting ? `<div class="g">${escapeHtml(L.greeting)}</div>` : ''}<p>${escapeHtml(L.body[0] ?? '')}</p><div class="fade"></div></div>
      ${L.attach ? `<div class="jn-reward">${L.attach.gold ? COIN : iconOf(L.attach.itemId ?? '')}<b>${L.attach.gold ? `${L.attach.gold}g` : `${L.attach.qty ?? 1} × ${escapeHtml(itemName(L.attach.itemId ?? ''))}`}</b><small>${m.read ? 'Taken' : 'Enclosed'}</small></div>` : ''}
      <button class="u-btn green jn-read" data-nav>${m.read ? 'Read again' : 'Open letter'}</button>`;
    this.rightPage.querySelector('.jn-read')?.addEventListener('click', () => {
      sfx(this.game, 'click');
      const id = this.sel.letters;
      const letters = this.game.services.letters;
      if (!letters) return;
      this.root.classList.add('jn-dim');
      void letters.show(id).then(() => {
        this.root.classList.remove('jn-dim');
        this.renderPages();
      });
    });
  }
}

/** Envelope badge next to the clock: pulses with unread letters; click opens the Letters tab. */
export class StoryBadge {
  private el: HTMLElement;
  constructor(private game: Game, hudRoot: HTMLElement) {
    this.el = el('button', 'hv-story-badge interactive hv-hidden');
    this.el.title = 'Journal (J)';
    this.el.innerHTML = `${ENVELOPE(false)}<i class="n"></i>`;
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.game.events.emit('ui:open', { name: 'journal:letters' });
    });
    hudRoot.appendChild(this.el);
    const up = (): void => this.refresh();
    game.events.on('mail:new', up);
    game.events.on('mail:read', up);
  }
  private refresh(): void {
    const n = this.game.services.story?.unread() ?? 0;
    this.el.classList.toggle('hv-hidden', n === 0);
    (this.el.querySelector('.n') as HTMLElement).textContent = String(n);
    replay(this.el, 'bump');
  }
}
