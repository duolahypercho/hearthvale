/**
 * Map ('map'; M): a painted overview of the valley in watercolour + ink on parchment — mountains and the
 * Old Mine to the north-west, the river winding through Hearthvale square to Driftsand Beach, Whisperwood
 * to the east and Grandmother's farm with its pond to the west. Seasonal palette, hover cards for every
 * place, a bobbing "you are here" pin and a compass rose. Pure SVG (seeded scatter, SVG filters).
 */
import type { Game } from '../core/game';
import { ICONS } from './icons';
import { Screen, el, frame, closeButton, tooltip, escapeHtml } from './kit';
import { menuTabs } from './menutabs';
import { farmerAvatar } from './avatar';

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

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAL = {
  spring: { edge: '#5f8a3a', land: '#b8d88a', land2: '#9cc86a', tree: ['#5f9e46', '#78b452', '#4f8a3a'], blossom: '#f7b8cc', field: '#8a5a36' },
  summer: { edge: '#4a7a2a', land: '#a8d07a', land2: '#86b85a', tree: ['#3f8a3a', '#56a044', '#2f7030'], blossom: '#ffd84a', field: '#7a4e2e' },
  fall: { edge: '#9a6a2a', land: '#d8c47a', land2: '#c4a85a', tree: ['#d9742a', '#e8a03a', '#b8502a'], blossom: '#c8573e', field: '#7a4e2e' },
  winter: { edge: '#8aa0b8', land: '#eef2f4', land2: '#d8e2ea', tree: ['#4f7a6a', '#6a8a7a', '#3f6a5a'], blossom: '#ffffff', field: '#b8b0a8' },
} as const;

function tree(x: number, y: number, s: number, cols: readonly string[], r: () => number, snow: boolean): string {
  const c = cols[Math.floor(r() * cols.length)]!;
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"><ellipse cx="1" cy="9" rx="9" ry="3" fill="#2a3a1a" opacity=".25"/><rect x="-1.4" y="2" width="2.8" height="7" rx="1" fill="#6a4428"/><circle r="8.5" cy="-2" fill="${c}" stroke="#2e3a1e" stroke-width="1.4"/><circle r="4" cx="-3" cy="-5" fill="#fff" opacity=".22"/>${snow ? '<path d="M-7 -6 C-4 -11 4 -11 7 -6 C3 -8 -3 -8 -7 -6Z" fill="#fff"/>' : ''}</g>`;
}

function pine(x: number, y: number, s: number, col: string, snow: boolean): string {
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"><ellipse cx="1" cy="10" rx="7" ry="2.4" fill="#2a3a1a" opacity=".25"/><path d="M0 -14 L8 2 H3 L10 10 H-10 L-3 2 H-8 Z" fill="${col}" stroke="#223022" stroke-width="1.3" stroke-linejoin="round"/>${snow ? '<path d="M0 -14 L4 -6 L0 -8 L-4 -6 Z" fill="#fff"/>' : ''}</g>`;
}

function house(x: number, y: number, roof: string, s = 1, glow = false): string {
  return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="2" cy="11" rx="15" ry="3.5" fill="#2a1a0a" opacity=".25"/><rect x="-11" y="-3" width="22" height="14" rx="2" fill="#f2e2c0" stroke="#3b2313" stroke-width="1.6"/><path d="M-14 -2 L0 -14 L14 -2 Z" fill="${roof}" stroke="#3b2313" stroke-width="1.6" stroke-linejoin="round"/><rect x="-3" y="3" width="6" height="8" fill="#8a5a36" stroke="#3b2313" stroke-width="1.2"/><rect x="5" y="1" width="4" height="4" fill="${glow ? '#ffd66a' : '#8fc8e8'}" stroke="#3b2313" stroke-width="1"/></g>`;
}

function valleySvg(season: keyof typeof PAL, here: string): string {
  const P = PAL[season];
  const snow = season === 'winter';
  const r = rng(42);
  const trees: string[] = [];
  // Whisperwood (east) + northern tree line + scattered copses.
  for (let i = 0; i < 150; i++) {
    const x = 720 + r() * 270;
    const y = 120 + r() * 300;
    if (Math.hypot(x - 846, y - 252) < 34) continue;
    trees.push(r() < 0.35 ? pine(x, y, 0.8 + r() * 0.5, P.tree[2], snow) : tree(x, y, 0.75 + r() * 0.5, P.tree, r, snow));
  }
  for (let i = 0; i < 70; i++) {
    const x = 380 + r() * 330;
    const y = 30 + r() * 90 + Math.sin(x * 0.02) * 16;
    trees.push(r() < 0.5 ? pine(x, y, 0.7 + r() * 0.4, P.tree[2], snow) : tree(x, y, 0.7 + r() * 0.35, P.tree, r, snow));
  }
  for (let i = 0; i < 44; i++) {
    const x = 40 + r() * 330;
    const y = 200 + r() * 260;
    if (x > 150 && x < 330 && y > 280 && y < 400) continue;
    if (Math.hypot(x - 150, y - 450) < 50) continue;
    trees.push(tree(x, y, 0.7 + r() * 0.4, P.tree, r, snow));
  }
  trees.sort((a, b) => Number(/translate\([\d.]+ ([\d.]+)/.exec(a)?.[1]) - Number(/translate\([\d.]+ ([\d.]+)/.exec(b)?.[1]));
  // Flowers / sparkles in meadows.
  const dots: string[] = [];
  for (let i = 0; i < 90; i++) {
    const x = 40 + r() * 660;
    const y = 160 + r() * 330;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1 + r() * 1.3).toFixed(1)}" fill="${r() < 0.5 ? P.blossom : '#fff8d0'}" opacity=".8"/>`);
  }
  // Farm field rows.
  const rows: string[] = [];
  for (let i = 0; i < 6; i++) rows.push(`<rect x="${196 + i * 11}" y="352" width="7" height="34" rx="2" fill="${P.field}" opacity=".85"/><g fill="${snow ? '#fff' : '#6ab04a'}">${[0, 1, 2].map((k) => `<circle cx="${199.5 + i * 11}" cy="${358 + k * 11}" r="2.6"/>`).join('')}</g>`);
  const pinAt = PLACES.find((p) => p.id === here);
  const labels = PLACES.map(
    (p) => `<g class="m-loc${p.id === here ? ' here' : ''}" data-id="${p.id}" transform="translate(${p.x} ${p.y})">
      <circle r="46" fill="transparent"/>
      <g class="m-flag" transform="translate(0 ${p.id === 'mine' ? -54 : 50})"><path d="M-${p.name.length * 5.4 + 14} -13 H${p.name.length * 5.4 + 14} L${p.name.length * 5.4 + 22} 0 L${p.name.length * 5.4 + 14} 13 H-${p.name.length * 5.4 + 14} L-${p.name.length * 5.4 + 22} 0 Z" fill="${p.id === here ? '#d9623e' : '#fbf0d6'}" stroke="#5a3418" stroke-width="2.2"/><text y="6">${escapeHtml(p.name)}</text></g></g>`,
  ).join('');
  return `<svg class="valley" viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="mWc" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter>
    <filter id="mSoft"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="mSoft2" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4"/></filter>
    <clipPath id="mLandClip"><path d="M20 40 C200 10 420 30 640 20 C800 14 920 30 985 60 L985 470 C900 500 820 520 760 520 C700 522 640 500 560 506 C440 516 320 530 200 520 C120 514 60 500 20 480 Z"/></clipPath>
    <clipPath id="mShade"><path d="M140 130 L200 40 L230 150 Z M270 120 L330 60 L350 170 Z M90 70 L140 130 L120 190 Z M330 60 L410 170 L360 200 Z"/></clipPath>
    <filter id="mPaper"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0 0.12  0 0 0 0.22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <radialGradient id="mSea" cx="50%" cy="100%" r="90%"><stop offset="0" stop-color="#3f8fb8"/><stop offset=".6" stop-color="#62b0d0"/><stop offset="1" stop-color="#9cd4e4"/></radialGradient>
    <linearGradient id="mMtn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8aa98"/><stop offset="1" stop-color="#7a6c5e"/></linearGradient>
    <radialGradient id="mVig" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#6a3a14" stop-opacity=".45"/></radialGradient>
    <radialGradient id="mGlow"><stop offset="0" stop-color="#ffe08a" stop-opacity=".9"/><stop offset="1" stop-color="#ffb040" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1000" height="640" fill="#f3e2bc"/>
  <g filter="url(#mWc)">
    <path d="M20 40 C200 10 420 30 640 20 C800 14 920 30 985 60 L985 470 C900 500 820 520 760 520 C700 522 640 500 560 506 C440 516 320 530 200 520 C120 514 60 500 20 480 Z" fill="${P.land}"/>
    <path d="M20 40 C200 10 420 30 640 20 C800 14 920 30 985 60 L985 470 C900 500 820 520 760 520 C700 522 640 500 560 506 C440 516 320 530 200 520 C120 514 60 500 20 480 Z" fill="none" stroke="${P.edge}" stroke-width="16" opacity=".32" clip-path="url(#mLandClip)" filter="url(#mSoft2)"/>
    <path d="M60 200 C160 170 300 190 400 240 C470 280 520 360 470 440 C400 500 220 500 120 470 C60 440 40 300 60 200 Z" fill="${P.land2}" opacity=".7"/>
    <path d="M620 150 C700 120 820 140 900 190 C960 240 960 360 900 420 C820 460 700 430 660 360 C620 300 590 200 620 150 Z" fill="${P.land2}" opacity=".6"/>
    <path d="M0 520 C160 500 300 520 460 506 C600 496 700 520 820 510 C900 504 960 510 1000 520 L1000 560 L0 560 Z" fill="#f2dc9a"/>
    <path d="M0 548 C180 530 360 546 520 536 C680 526 820 548 1000 538 V640 H0 Z" fill="url(#mSea)"/>
  </g>
  <g fill="none" stroke="#fff" stroke-linecap="round" opacity=".55">${Array.from({ length: 14 }, (_, i) => `<path d="M${30 + i * 70} ${580 + (i % 3) * 16} q10 -5 20 0 t20 0" stroke-width="2"/>`).join('')}</g>
  <!-- mountains -->
  <g filter="url(#mWc)">
    <path d="M20 190 L90 70 L140 130 L200 40 L270 120 L330 60 L410 170 L360 200 L20 210 Z" fill="url(#mMtn)" stroke="#5a4a3a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M90 70 L108 100 L96 96 L82 108 Z M200 40 L222 74 L206 70 L190 84 L186 62 Z M330 60 L352 92 L338 88 L322 98 Z" fill="#fff"/>
    <path d="M140 130 L200 40 L230 150 Z M270 120 L330 60 L350 170 Z" fill="#5e5044" opacity=".35"/>
  </g>
  <g clip-path="url(#mShade)" stroke="#3e3026" stroke-width="1.3" stroke-linecap="round" opacity=".5">${Array.from({ length: 44 }, (_, i) => `<path d="M${70 + i * 8} 200 l22 -34"/>`).join('')}</g>
  <path d="M250 124 C246 110 256 100 268 102 C280 104 284 116 280 126 Z" fill="#2a2220" stroke="#3b2313" stroke-width="2.4"/>
  <path d="M246 126 L286 126" stroke="#8a5a2a" stroke-width="4"/>
  <!-- river + lake -->
  <path d="M410 60 C430 120 470 160 500 200 C540 250 520 300 560 360 C590 410 620 460 640 540" fill="none" stroke="#3f7ea8" stroke-width="22" stroke-linecap="round" opacity=".45" filter="url(#mWc)"/>
  <path d="M410 60 C430 120 470 160 500 200 C540 250 520 300 560 360 C590 410 620 460 640 540" fill="none" stroke="#7ec4e0" stroke-width="14" stroke-linecap="round" filter="url(#mWc)"/>
  <path d="M414 70 C432 122 468 160 496 198" fill="none" stroke="#e8f8ff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <ellipse cx="148" cy="448" rx="54" ry="30" fill="#5aa8cc" stroke="#2f6a8a" stroke-width="3" filter="url(#mWc)"/>
  <ellipse cx="136" cy="440" rx="22" ry="7" fill="#dff4ff" opacity=".6"/>
  <!-- roads -->
  <g fill="none" stroke="#c8a070" stroke-linecap="round" stroke-width="9" filter="url(#mWc)" opacity=".95">
    <path d="M300 340 C380 330 440 300 530 300"/>
    <path d="M600 300 C680 290 740 270 800 256"/>
    <path d="M572 330 C590 400 610 470 630 530"/>
    <path d="M240 300 C250 240 262 180 266 132"/>
  </g>
  <g fill="none" stroke="#fff4dc" stroke-linecap="round" stroke-width="2" stroke-dasharray="1 9" opacity=".8">
    <path d="M300 340 C380 330 440 300 530 300"/><path d="M600 300 C680 290 740 270 800 256"/><path d="M572 330 C590 400 610 470 630 530"/><path d="M240 300 C250 240 262 180 266 132"/>
  </g>
  <!-- bridges -->
  <g stroke="#5a3418" stroke-width="2"><rect x="514" y="292" width="30" height="14" rx="3" fill="#b07a44" transform="rotate(-8 529 299)"/><rect x="592" y="408" width="30" height="12" rx="3" fill="#b07a44" transform="rotate(-60 607 414)"/></g>
  ${dots.join('')}
  <!-- farm -->
  <g>
    <path d="M168 300 C200 290 290 292 318 306 C330 340 326 380 312 400 C270 410 200 410 172 398 C160 370 160 330 168 300 Z" fill="${snow ? '#f4f6f8' : '#a8d47a'}" stroke="#6a8a3a" stroke-width="2.4" stroke-dasharray="6 4" filter="url(#mWc)"/>
    ${rows.join('')}
    ${house(284, 330, '#c8573e', 1.5, false)}
    <rect x="258" y="370" width="16" height="12" rx="2" fill="#a86a34" stroke="#3b2313" stroke-width="1.5"/>
  </g>
  <!-- town -->
  <g>
    <circle cx="566" cy="300" r="46" fill="#e8d6b4" stroke="#a8845a" stroke-width="3" filter="url(#mWc)"/>
    <circle cx="566" cy="304" r="10" fill="#8fd0ee" stroke="#5a8aa8" stroke-width="2"/>
    <circle cx="566" cy="266" r="26" fill="url(#mGlow)" opacity=".7"/>
    <g transform="translate(566 268)"><rect x="-16" y="-12" width="32" height="20" fill="#e8d8c0" stroke="#3b2313" stroke-width="1.8"/><path d="M-20 -10 L0 -30 L20 -10 Z" fill="#6a7a9a" stroke="#3b2313" stroke-width="1.8"/><rect x="-3" y="-38" width="6" height="10" fill="#6a7a9a" stroke="#3b2313" stroke-width="1.4"/><circle cy="-2" r="4.5" fill="#ffd66a" stroke="#3b2313" stroke-width="1.2"/></g>
    ${house(532, 300, '#d8573e', 1)}${house(600, 302, '#4f8ab8', 1)}${house(540, 336, '#e8a03a', 0.9)}${house(596, 338, '#8a5ab8', 0.9)}
  </g>
  ${trees.join('')}
  <!-- beach props -->
  <g><path d="M690 524 L760 520" stroke="#8a5a36" stroke-width="7" stroke-linecap="round"/><g stroke="#5a3418" stroke-width="3">${[700, 720, 740, 758].map((x) => `<path d="M${x} 522 V540"/>`).join('')}</g>
  <path d="M600 548 l6 -10 l6 10 Z" fill="#f07a3a" stroke="#8a3a10" stroke-width="1.5"/><circle cx="572" cy="532" r="3.2" fill="#f2b8a0" stroke="#8a5a4a"/></g>
  <!-- compass + cartouche -->
  <g transform="translate(930 580)"><circle r="34" fill="#fbf0d6" stroke="#6a4428" stroke-width="3"/><circle r="26" fill="none" stroke="#6a4428" stroke-width="1" stroke-dasharray="2 4"/><path d="M0 -30 L7 0 L0 30 L-7 0 Z" fill="#c8573e" stroke="#5a2414" stroke-width="1.5"/><path d="M-30 0 L0 -6 L30 0 L0 6 Z" fill="#e8d0a0" stroke="#6a4428" stroke-width="1.2"/><text y="-38" class="m-rose">N</text></g>
  <g transform="translate(110 590)"><path d="M-92 -26 H92 C100 -26 100 26 92 26 H-92 C-100 26 -100 -26 -92 -26 Z" fill="#fbf0d6" stroke="#6a4428" stroke-width="2.5"/><text y="-2" class="m-title">Hearthvale</text><text y="17" class="m-sub">${season}</text></g>
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
  ${labels}
  ${pinAt ? `<g class="m-pin" transform="translate(${pinAt.x} ${pinAt.y - 18})"><ellipse cy="26" rx="12" ry="4" fill="#000" opacity=".25"/><g class="bob"><path d="M0 22 C-16 4 -18 -18 0 -20 C18 -18 16 4 0 22 Z" fill="#e8574a" stroke="#6a1e10" stroke-width="3"/><foreignObject x="-14" y="-18" width="28" height="28"><div xmlns="http://www.w3.org/1999/xhtml" class="m-face">${farmerAvatar(['#fff4d8', '#f0d8a0'])}</div></foreignObject></g></g>` : ''}
  <rect width="1000" height="640" fill="url(#mVig)" pointer-events="none"/>
  <rect width="1000" height="640" filter="url(#mPaper)" fill="#fff" pointer-events="none" opacity=".9"/>
</svg>`;
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
    body.innerHTML = valleySvg(c.season, here);
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
      g.addEventListener('pointerenter', () => tooltip.show(html));
      g.addEventListener('pointerleave', () => tooltip.hide());
      g.addEventListener('u-focus', () => tooltip.anchor(html, g));
    });
  }

  protected override initialFocus(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>('.m-loc.here');
  }
}
