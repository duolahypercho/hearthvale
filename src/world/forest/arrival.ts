/**
 * Cindergrove arrival card: a carved wooden plate with a parchment inset, hung in the upper third
 * when the farmer walks in (never over the farmer), with a leaf flourish either side and the season
 * line under the name. Eases in (drop + settle), holds ~2.4 s, lifts away. Uses the UI kit's
 * procedural wood / paper textures (`--u-wood`, `--u-paper`).
 */
import type { Season } from '../../core/time';

const CSS = /* css */ `
.hvf-arrive {
  position: absolute; left: 50%; top: 11%; z-index: 40; pointer-events: none;
  transform: translate(-50%, -24px) rotate(-1.5deg); opacity: 0;
  display: flex; align-items: center; gap: 10px;
  filter: drop-shadow(0 10px 14px rgba(30, 16, 4, .38));
}
.hvf-arrive.show { animation: hvfArrive 3.6s cubic-bezier(.2,.9,.25,1) both; }
@keyframes hvfArrive {
  0% { opacity: 0; transform: translate(-50%, -30px) rotate(-4deg) scale(.92); }
  12% { opacity: 1; transform: translate(-50%, 4px) rotate(1deg) scale(1.02); }
  20% { transform: translate(-50%, 0) rotate(0deg) scale(1); }
  78% { opacity: 1; transform: translate(-50%, 0) rotate(0deg) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -18px) rotate(-1deg) scale(.97); }
}
.hvf-arrive .plate {
  position: relative; padding: 9px 11px;
  border-radius: 16px;
  background: var(--u-wood, linear-gradient(#9a6a3c, #7a4a24)) 0 0 / 512px 256px, linear-gradient(180deg, #a8743f, #7a4a24);
  box-shadow: inset 0 2px 0 rgba(255, 220, 170, .35), inset 0 -3px 0 rgba(40, 18, 4, .45), 0 0 0 2px #4a2a12;
}
.hvf-arrive .plate::before, .hvf-arrive .plate::after {
  content: ''; position: absolute; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #f4d9a0, #9a6a2c 60%, #4a2a10);
  box-shadow: 0 1px 0 rgba(0,0,0,.4);
}
.hvf-arrive .plate::before { left: 4px; }
.hvf-arrive .plate::after { right: 4px; }
.hvf-arrive .paper {
  padding: 8px 34px 9px; border-radius: 10px; text-align: center;
  background: var(--u-paper, linear-gradient(#f7ecd0, #efdcb2)) 0 0 / 256px, radial-gradient(120% 90% at 50% 20%, #fbf1d8, #ecd6a8);
  box-shadow: inset 0 0 0 1px rgba(120, 80, 30, .35), inset 0 0 18px rgba(150, 100, 40, .28);
}
.hvf-arrive .name {
  font-family: var(--font-head, 'Fredoka', sans-serif); font-weight: 700; font-size: 40px; line-height: 1;
  color: #3e5a22; letter-spacing: 1px;
  text-shadow: 0 1px 0 rgba(255, 250, 230, .8), 0 2px 0 rgba(90, 60, 20, .18);
}
.hvf-arrive .sub {
  margin-top: 4px; font-family: var(--font-body, 'Nunito', sans-serif); font-weight: 800; font-size: 13px;
  letter-spacing: 3px; text-transform: uppercase; color: #8a5a2a;
}
.hvf-arrive .sub i { font-style: normal; color: #b0763a; padding: 0 6px; }
.hvf-arrive svg { width: 46px; height: 46px; flex: none; }
.hvf-arrive svg.l { transform: rotate(-18deg); }
.hvf-arrive svg.r { transform: scaleX(-1) rotate(-18deg); }
.hvf-arrive.show svg.l { animation: hvfLeafL 3.6s ease both; }
.hvf-arrive.show svg.r { animation: hvfLeafR 3.6s ease both; }
@keyframes hvfLeafL { 0% { transform: rotate(-60deg) scale(.4); } 18% { transform: rotate(-10deg) scale(1.05); } 26%, 100% { transform: rotate(-18deg) scale(1); } }
@keyframes hvfLeafR { 0% { transform: scaleX(-1) rotate(-60deg) scale(.4); } 18% { transform: scaleX(-1) rotate(-10deg) scale(1.05); } 26%, 100% { transform: scaleX(-1) rotate(-18deg) scale(1); } }
`;

const LEAF: Record<Season, [string, string]> = {
  spring: ['#7fbe4f', '#f29ac0'],
  summer: ['#4f9a38', '#ffd166'],
  fall: ['#e0702a', '#c8401e'],
  winter: ['#6f9ab8', '#d8202c'],
};
const LINE: Record<Season, string> = {
  spring: 'Old-growth wood',
  summer: 'Old-growth wood',
  fall: 'Ember-leaf wood',
  winter: 'Frostbound wood',
};

function leafSvg(cls: string, a: string, b: string): string {
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M6 40 C 14 30, 22 22, 40 8" stroke="#6a4020" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M40 8 C 30 8, 22 14, 22 24 C 30 24, 38 18, 40 8 Z" fill="${a}" stroke="#3e2a12" stroke-width="1.2"/>
    <path d="M24 24 L 38 10" stroke="rgba(255,255,255,.45)" stroke-width="1"/>
    <path d="M18 30 C 10 28, 6 22, 8 14 C 16 16, 20 22, 18 30 Z" fill="${a}" stroke="#3e2a12" stroke-width="1.2" opacity=".92"/>
    <circle cx="12" cy="36" r="3.2" fill="${b}" stroke="#3e2a12" stroke-width="1"/>
    <circle cx="16.5" cy="38.5" r="2.4" fill="${b}" stroke="#3e2a12" stroke-width="1"/>
  </svg>`;
}

export class ArrivalCard {
  private el: HTMLElement | null = null;

  constructor(private root: HTMLElement) {}

  show(title: string, season: Season): void {
    if (!document.getElementById('hvf-arrive-css')) {
      const st = document.createElement('style');
      st.id = 'hvf-arrive-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'hvf-arrive';
      this.root.appendChild(this.el);
    }
    const [a, b] = LEAF[season];
    this.el.innerHTML = `${leafSvg('l', a, b)}<div class="plate"><div class="paper"><div class="name">${title}</div><div class="sub"><i>~</i>${LINE[season]}<i>~</i></div></div></div>${leafSvg('r', a, b)}`;
    this.el.classList.remove('show');
    void this.el.offsetWidth;
    this.el.classList.add('show');
  }

  /** Hold the card on screen (demo stills). */
  pin(): void {
    if (this.el) {
      this.el.classList.remove('show');
      this.el.style.opacity = '1';
      this.el.style.transform = 'translate(-50%, 0)';
    }
  }
}
