/**
 * "Into the backpack" flourish: an item icon launched from a screen point that arcs down into
 * its toolbar slot (or the toolbar's end when it went to the backpack rows), lands with a squash,
 * and bumps the slot. Pure DOM + WAAPI, no layout thrash; safe to call many times at once.
 */
import { itemIcon, qualityStar } from './icons';

export function flyItemToToolbar(root: HTMLElement, itemId: string, from: { x: number; y: number }, slot: number, quality = 0, opts: { duration?: number; bounce?: number } = {}): void {
  const bar = root.querySelector<HTMLElement>('.hv-toolbar');
  const slots = bar ? [...bar.querySelectorAll<HTMLElement>('.u-slot')] : [];
  const target = slot >= 0 && slot < slots.length ? slots[slot]! : bar;
  flyItemTo(itemId, from, target ?? null, quality, undefined, 44, opts);
}

/** Arc an item icon from a screen point into any element (e.g. the Backpack menu tab); squash-bumps it on landing. */
export function flyItemTo(itemId: string, from: { x: number; y: number }, target: HTMLElement | null, quality = 0, onLand?: () => void, size = 44, opts: { duration?: number; bounce?: number } = {}): void {
  const r = target?.getBoundingClientRect();
  const to = r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight - 40 };
  const el = document.createElement('div');
  el.className = 'hv-flyitem';
  el.innerHTML = itemIcon(itemId) + (quality ? qualityStar(quality) : '');
  Object.assign(el.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: `${size}px`,
    height: `${size}px`,
    marginLeft: `${-size / 2}px`,
    marginTop: `${-size / 2}px`,
    pointerEvents: 'none',
    zIndex: '60',
    filter: 'drop-shadow(0 3px 3px rgba(40,20,0,.35))',
    willChange: 'transform, opacity',
  } as Partial<CSSStyleDeclaration>);
  const img = el.querySelector<HTMLElement>('img, svg');
  if (img) Object.assign(img.style, { width: '100%', height: '100%', display: 'block' });
  const star = el.querySelector<HTMLElement>('.u-star');
  if (star) Object.assign(star.style, { position: 'absolute', left: '-4px', bottom: '-4px', width: '20px', height: '20px' });
  document.body.appendChild(el);
  // Quadratic arc: rise first, then fall into the slot.
  const peak = { x: from.x + (to.x - from.x) * 0.35, y: Math.min(from.y, to.y) - 110 };
  const frames: Keyframe[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * peak.x + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * peak.y + t * t * to.y;
    const s = t < 0.15 ? 0.6 + t * 4 : 1.2 - t * 0.45;
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${s}) rotate(${(1 - t) * -25}deg)`, opacity: t > 0.92 ? 1 - (t - 0.92) * 10 : 1, offset: t });
  }
  const anim = el.animate(frames, { duration: opts.duration ?? 620, easing: 'cubic-bezier(.45,.05,.55,.95)' });
  const b = opts.bounce ?? 1.22;
  anim.onfinish = () => {
    el.remove();
    onLand?.();
    target?.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${b}, ${2 - b * 0.94})` }, { transform: `scale(${2 - b * 0.9}, ${1 + (b - 1) * 0.4})` }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'ease-out' },
    );
  };
}

/** Centre of an element in screen px. */
export function centerOf(node: Element | null | undefined): { x: number; y: number } | null {
  const r = node?.getBoundingClientRect();
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

/**
 * A little stream of coins arcing from one screen point to another (payment: purse → shopkeeper, or
 * earnings the other way). Fixed-position WAAPI sprites on <body>, so the path is exact at any UI zoom.
 */
export function flyCoins(coinSvg: string, from: { x: number; y: number }, to: { x: number; y: number }, n = 5, onLand?: () => void): void {
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'hv-flycoin';
    c.innerHTML = coinSvg;
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', width: '26px', height: '26px', marginLeft: '-13px', marginTop: '-13px', pointerEvents: 'none', zIndex: '96', willChange: 'transform, opacity' } as Partial<CSSStyleDeclaration>);
    const svg = c.querySelector('svg');
    if (svg) Object.assign(svg.style, { width: '100%', height: '100%', display: 'block', filter: 'drop-shadow(0 2px 2px rgba(40,20,4,.45))' });
    document.body.appendChild(c);
    const jx = (Math.random() - 0.5) * 22;
    const jy = (Math.random() - 0.5) * 14;
    const peak = { x: from.x + (to.x - from.x) * 0.5 + jx, y: Math.min(from.y, to.y) - 70 - Math.random() * 40 };
    const frames: Keyframe[] = [];
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * peak.x + t * t * (to.x + jx * 0.4);
      const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * peak.y + t * t * (to.y + jy * 0.4);
      frames.push({ transform: `translate(${x}px, ${y}px) scale(${t < 0.12 ? 0.5 + t * 4 : 1 - t * 0.25}) rotateY(${t * 540}deg)`, opacity: t > 0.9 ? 1 - (t - 0.9) * 10 : 1, offset: t });
    }
    const a = c.animate(frames, { duration: 560 + i * 20, delay: i * 55, easing: 'cubic-bezier(.4,.05,.6,1)', fill: 'backwards' });
    a.onfinish = () => {
      c.remove();
      if (i === n - 1) onLand?.();
    };
  }
}

/** A "+N" chip that pops above an element (used where a flown item lands). */
export function popBadge(target: Element | null | undefined, text: string, cls = ''): void {
  const p = centerOf(target);
  if (!p) return;
  const r = target!.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = `hv-popbadge ${cls}`;
  b.textContent = text;
  Object.assign(b.style, { position: 'fixed', left: `${p.x}px`, top: `${r.top}px`, zIndex: '97', pointerEvents: 'none' } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(b);
  b.animate(
    [
      { transform: 'translate(-50%, 0) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%, -22px) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -30px) scale(1)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, -44px) scale(.95)', opacity: 0 },
    ],
    { duration: 1100, easing: 'ease-out' },
  ).onfinish = () => b.remove();
}
