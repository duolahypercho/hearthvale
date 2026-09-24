/**
 * Map ('map'; M): a painted overview of the valley in watercolour + ink on parchment — mountains and the
 * Old Mine to the north-west, the river winding through Hearthvale square to Driftsand Beach, Whisperwood
 * to the east and Grandmother's farm with its pond to the west. Seasonal palette, hover cards for every
 * place, a bobbing "you are here" pin, villager heads where their schedules put them, and a compass rose.
 * Painting lives in mapart.ts (paper, washes, fields, Poisson woods). Pure SVG (seeded scatter, SVG filters).
 */
import type { Game } from '../core/game';
import { ICONS } from './icons';
import { Screen, el, frame, closeButton, tooltip, escapeHtml } from './kit';
import { menuTabs } from './menutabs';
import { farmerAvatar } from './avatar';
import type { FarmerLook } from '../entities/remote-look';
import { portraitSvg } from './portraits';
import { NPCS, type NpcId } from '../data/npcs';
import { valleyBase, PAL, type Season } from './mapart';

interface Place {
  id: string;
  name: string;
  x: number;
  y: number;
  blurb: string;
  open: boolean;
}

const PLACES: Place[] = [
  { id: 'farm', name: "Rosalind's Farm", x: 232, y: 338, blurb: 'Your farm. Overgrown, stubborn, full of promise — and the best soil in the valley.', open: true },
  { id: 'town', name: 'Hearthvale Square', x: 566, y: 300, blurb: 'Cobbled plaza, the fountain, Thimble & Pip’s, the bakery — and the dark Lantern Hall.', open: true },
  { id: 'forest', name: 'Whisperwood', x: 846, y: 252, blurb: 'Old trees that hum when the wind is right. Mushrooms, ferns and things that watch.', open: true },
  { id: 'mine', name: 'Old Mine', x: 262, y: 112, blurb: 'The miners left in a hurry. Something down there still glitters.', open: true },
  { id: 'beach', name: 'Driftsand Beach', x: 640, y: 562, blurb: 'Tide pools, a creaky pier and whatever the sea decides to give back.', open: true },
];

function house(x: number, y: number, roof: string, s = 1, glow = false): string {
  return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="2" cy="11" rx="15" ry="3.5" fill="#2a1a0a" opacity=".25"/><rect x="-11" y="-3" width="22" height="14" rx="2" fill="#f2e2c0" stroke="#3b2313" stroke-width="1.6"/><path d="M-14 -2 L0 -14 L14 -2 Z" fill="${roof}" stroke="#3b2313" stroke-width="1.6" stroke-linejoin="round"/><rect x="-3" y="3" width="6" height="8" fill="#8a5a36" stroke="#3b2313" stroke-width="1.2"/><rect x="5" y="1" width="4" height="4" fill="${glow ? '#ffd66a' : '#8fc8e8'}" stroke="#3b2313" stroke-width="1"/></g>`;
}

interface Head {
  id: string;
  svg: string;
  x: number;
  y: number;
}

function valleySvg(season: Season, here: string, heads: Head[], look: FarmerLook | null = null): string {
  const snow = season === 'winter';
  const { defs, under, trees, paper } = valleyBase(season);
  const P = PAL[season];
  // Farm field rows.
  const rows: string[] = [];
  for (let i = 0; i < 6; i++) rows.push(`<rect x="${196 + i * 11}" y="352" width="7" height="34" rx="2" fill="${snow ? '#c8c0b8' : '#8a5a36'}" opacity=".85"/><g fill="${snow ? '#fff' : '#6ab04a'}">${[0, 1, 2].map((k) => `<circle cx="${199.5 + i * 11}" cy="${358 + k * 11}" r="2.6"/>`).join('')}</g>`);
  const pinAt = PLACES.find((p) => p.id === here);
  const labels = PLACES.map(
    (p) => `<g class="m-loc${p.id === here ? ' here' : ''}" data-id="${p.id}" transform="translate(${p.x} ${p.y})">
      <circle r="46" fill="transparent"/>
      <g class="m-flag" transform="translate(0 ${p.id === 'mine' ? -54 : 50})"><path d="M-${p.name.length * 5.4 + 14} -13 H${p.name.length * 5.4 + 14} L${p.name.length * 5.4 + 22} 0 L${p.name.length * 5.4 + 14} 13 H-${p.name.length * 5.4 + 14} L-${p.name.length * 5.4 + 22} 0 Z" fill="${p.id === here ? '#d9623e' : '#fbf0d6'}" stroke="#5a3418" stroke-width="2.2"/><text y="6">${escapeHtml(p.name)}</text></g></g>`,
  ).join('');
  const villagers = heads
    .map(
      (h, i) =>
        `<g class="m-npc" data-npc="${h.id}" transform="translate(${h.x.toFixed(1)} ${h.y.toFixed(1)})" style="animation-delay:${-i * 0.37}s"><ellipse cy="14" rx="9" ry="2.8" fill="#000" opacity=".22"/><circle r="12.5" fill="#fff8e6" stroke="#5a3418" stroke-width="2"/><foreignObject x="-11.5" y="-11.5" width="23" height="23"><div xmlns="http://www.w3.org/1999/xhtml" class="m-npcface">${h.svg}</div></foreignObject></g>`,
    )
    .join('');
  return `<svg class="valley" viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg">
  <defs>${defs}</defs>
  ${under}
  <!-- farm -->
  <g>
    <path d="M168 300 C200 290 290 292 318 306 C330 340 326 380 312 400 C270 410 200 410 172 398 C160 370 160 330 168 300 Z" fill="${snow ? '#f4f6f8' : P.land2}" stroke="#6a4a2a" stroke-width="2" stroke-dasharray="5 4" filter="url(#mWc)"/>
    ${rows.join('')}
    ${house(284, 330, '#c8573e', 1.5, false)}
    <g transform="translate(300 376)"><ellipse cx="2" cy="8" rx="12" ry="3" fill="#2a1a0a" opacity=".25"/><rect x="-10" y="-8" width="20" height="16" rx="2" fill="#b86a3a" stroke="#3b2313" stroke-width="1.4"/><path d="M-12 -8 L0 -16 L12 -8 Z" fill="#8a3a2a" stroke="#3b2313" stroke-width="1.4"/></g>
    <rect x="258" y="370" width="16" height="12" rx="2" fill="#a86a34" stroke="#3b2313" stroke-width="1.5"/>
  </g>
  <!-- town -->
  <g>
    <circle cx="566" cy="300" r="50" fill="#ecdcbc" stroke="#a8845a" stroke-width="3" filter="url(#mWc)"/>
    <circle cx="566" cy="300" r="30" fill="none" stroke="#d4bc94" stroke-width="7" stroke-dasharray="2 3"/>
    <circle cx="566" cy="304" r="10" fill="#8fd0ee" stroke="#5a8aa8" stroke-width="2"/>
    <circle cx="566" cy="266" r="26" fill="url(#mGlow)" opacity=".7"/>
    ${house(528, 290, '#d8573e', 0.9)}${house(604, 290, '#4f8ab8', 0.95)}${house(534, 330, '#e8a03a', 0.9)}${house(598, 332, '#8a5ab8', 0.9)}${house(566, 342, '#5a9a5a', 0.85)}${house(508, 316, '#c87a4a', 0.75)}${house(624, 312, '#d8573e', 0.75)}
    <g transform="translate(566 268)"><rect x="-16" y="-12" width="32" height="20" fill="#e8d8c0" stroke="#3b2313" stroke-width="1.8"/><path d="M-20 -10 L0 -30 L20 -10 Z" fill="#6a7a9a" stroke="#3b2313" stroke-width="1.8"/><rect x="-3" y="-38" width="6" height="10" fill="#6a7a9a" stroke="#3b2313" stroke-width="1.4"/><circle cy="-2" r="4.5" fill="#ffd66a" stroke="#3b2313" stroke-width="1.2"/></g>
  </g>
  ${trees}
  <!-- beach props -->
  <g><path d="M690 524 L760 520" stroke="#8a5a36" stroke-width="7" stroke-linecap="round"/><g stroke="#5a3418" stroke-width="3">${[700, 720, 740, 758].map((x) => `<path d="M${x} 522 V540"/>`).join('')}</g>
  <path d="M600 548 l6 -10 l6 10 Z" fill="#f07a3a" stroke="#8a3a10" stroke-width="1.5"/><circle cx="572" cy="532" r="3.2" fill="#f2b8a0" stroke="#8a5a4a"/>
  <g transform="translate(470 528)"><path d="M-8 0 Q0 -14 8 0 Z" fill="#e85a4a" stroke="#6a2a1a" stroke-width="1.2"/><path d="M0 0 V6" stroke="#6a4a2a" stroke-width="1.5"/></g></g>
  <!-- compass + cartouche -->
  <g transform="translate(930 580)"><circle r="34" fill="#fbf0d6" stroke="#6a4428" stroke-width="3"/><circle r="26" fill="none" stroke="#6a4428" stroke-width="1" stroke-dasharray="2 4"/><path d="M0 -30 L7 0 L0 30 L-7 0 Z" fill="#c8573e" stroke="#5a2414" stroke-width="1.5"/><path d="M-30 0 L0 -6 L30 0 L0 6 Z" fill="#e8d0a0" stroke="#6a4428" stroke-width="1.2"/><text y="-38" class="m-rose">N</text></g>
  <g transform="translate(110 590)"><path d="M-92 -26 H92 C100 -26 100 26 92 26 H-92 C-100 26 -100 -26 -92 -26 Z" fill="#fbf0d6" stroke="#6a4428" stroke-width="2.5"/><path d="M-84 -19 H84 C90 -19 90 19 84 19 H-84 C-90 19 -90 -19 -84 -19 Z" fill="none" stroke="#b8946a" stroke-width="1"/><text y="-2" class="m-title">Hearthvale</text><text y="17" class="m-sub">${season}</text></g>
  <g class="m-boat"><path d="M812 604 C826 612 850 612 862 604 L856 614 H818 Z" fill="#a8683a" stroke="#4a2810" stroke-width="2"/><path d="M836 603 V574 L856 600 Z" fill="#fff8e8" stroke="#4a2810" stroke-width="1.8"/><path d="M834 603 V580 L820 600 Z" fill="#e8744e" stroke="#4a2810" stroke-width="1.6"/></g>
  <g class="m-birds" fill="none" stroke="#4a3a2e" stroke-width="2" stroke-linecap="round"><path class="b1" d="M760 96 q6 -6 12 0 q6 -6 12 0"/><path class="b2" d="M790 80 q5 -5 10 0 q5 -5 10 0"/><path class="b1" d="M812 104 q4 -4 8 0 q4 -4 8 0"/></g>
  ${[
    [120, 0, 1.1, -12],
    [300, 1, 0.8, -40],
    [470, 2, 1.25, -70],
  ]
    .map(
      ([y, k, sc, off]) =>
        `<g class="m-cloud" style="animation-delay:${off}s;animation-duration:${90 + k! * 24}s"><g transform="translate(0 ${y}) scale(${sc})"><g transform="translate(10 26)" fill="#3a4a2a" opacity=".1"><ellipse cx="0" cy="0" rx="38" ry="12"/><ellipse cx="30" cy="4" rx="28" ry="10"/></g><g fill="#ffffff" opacity=".62"><ellipse cx="0" cy="0" rx="36" ry="14"/><ellipse cx="24" cy="-8" rx="24" ry="14"/><ellipse cx="46" cy="2" rx="26" ry="11"/><ellipse cx="-22" cy="4" rx="20" ry="9"/></g></g></g>`,
    )
    .join('')}
  ${villagers}
  ${labels}
  ${pinAt ? `<g class="m-pin" transform="translate(${pinAt.x} ${pinAt.y - 18})"><ellipse cy="26" rx="12" ry="4" fill="#000" opacity=".25"/><g class="bob"><path d="M0 22 C-16 4 -18 -18 0 -20 C18 -18 16 4 0 22 Z" fill="#e8574a" stroke="#6a1e10" stroke-width="3"/><foreignObject x="-14" y="-18" width="28" height="28"><div xmlns="http://www.w3.org/1999/xhtml" class="m-face">${farmerAvatar(['#fff4d8', '#f0d8a0'], look)}</div></foreignObject></g></g>` : ''}
  ${paper}
</svg>`;
}

/** Villagers out and about right now (by schedule), as little portrait heads around the square. */
function villagerHeads(game: Game): Head[] {
  const h = game.calendar.hour;
  const rain = game.calendar.weather === 'rain' || game.calendar.weather === 'storm';
  const out: Head[] = [];
  let i = 0;
  for (const id of Object.keys(NPCS) as NpcId[]) {
    const n = NPCS[id];
    const sched = (rain && n.rainSchedule) || n.schedule;
    let spot = sched[0]?.[1] ?? '';
    for (const [hr, sp] of sched) if (h >= hr) spot = sp;
    if (!spot || spot.startsWith('door:') || h < (sched[0]?.[0] ?? 6) || h >= 24) continue;
    // Spread around the square by a stable hash of the spot, so villagers at one spot huddle together.
    let hash = 0;
    for (const ch of spot) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const a = ((hash % 360) * Math.PI) / 180 + i * 0.35;
    const rad = 44 + (hash % 3) * 9;
    let svg = '';
    try {
      svg = portraitSvg(n.look, n.portraitBg, 'happy');
    } catch {
      continue;
    }
    out.push({ id, svg, x: 566 + Math.cos(a) * rad, y: 300 + Math.sin(a) * rad * 0.8 });
    i++;
  }
  return out;
}

export class MapScreen extends Screen {
  constructor(game: Game, parent: HTMLElement) {
    super(game, parent, 'hv-map', { backdrop: true });
  }

  protected render(): void {
    this.root.querySelector('.u-pop')?.remove();
    const here = this.game.world.current?.id ?? 'farm';
    const c = this.game.calendar;
    const wrap = el('div', 'map-wrap u-pop');
    const { frame: f, body } = frame('Hearthvale Valley', 'map-frame');
    f.appendChild(closeButton(() => this.requestClose()));
    wrap.append(menuTabs(this.game, 'map'), f);
    const heads = villagerHeads(this.game);
    body.innerHTML = valleySvg(c.season as Season, here, heads, this.game.services.net?.profile().look ?? null);
    const sub = body.querySelector('.m-sub');
    if (sub) sub.textContent = `${c.season} · year ${c.year}`;
    const place = PLACES.find((p) => p.id === here);
    body.appendChild(
      el(
        'div',
        'map-legend',
        `<span class="here">${ICONS.map} You are in <b>${escapeHtml(place?.name ?? here)}</b></span><span><b>M</b> close · hover a place for details</span>`,
      ),
    );
    this.root.appendChild(wrap);
    body.querySelectorAll<SVGGElement>('.m-loc').forEach((g) => {
      const p = PLACES.find((x) => x.id === g.dataset.id)!;
      g.setAttribute('data-nav', '');
      g.setAttribute('data-noclick', '1');
      const html = `<div class="t-in"><div class="t-name">${escapeHtml(p.name)}</div><span class="t-cat" style="background:${p.id === here ? '#d9623e' : '#6a8a3a'}">${p.id === here ? 'You are here' : 'Location'}</span><div class="t-desc">${escapeHtml(p.blurb)}</div></div>`;
      g.addEventListener('pointerenter', (ev) => tooltip.show(html, ev));
      g.addEventListener('pointerleave', () => tooltip.hide());
      g.addEventListener('u-focus', () => tooltip.anchor(html, g));
    });
    body.querySelectorAll<SVGGElement>('.m-npc').forEach((g) => {
      const n = NPCS[g.dataset.npc as NpcId];
      if (!n) return;
      const html = `<div class="t-in"><div class="t-name">${escapeHtml(n.name)}</div><span class="t-cat" style="background:#6a8a3a">Villager</span><div class="t-desc">${escapeHtml(n.role)}</div></div>`;
      g.addEventListener('pointerenter', (ev) => tooltip.show(html, ev));
      g.addEventListener('pointerleave', () => tooltip.hide());
    });
  }

  protected override initialFocus(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>('.m-loc.here');
  }
}
