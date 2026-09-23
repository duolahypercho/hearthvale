/**
 * "Into the backpack" flourish: an item icon launched from a screen point that arcs down into
 * its toolbar slot (or the toolbar's end when it went to the backpack rows), lands with a squash,
 * and bumps the slot. Pure DOM + WAAPI, no layout thrash; safe to call many times at once.
 */
import { itemIcon, qualityStar } from './icons';

export function flyItemToToolbar(root: HTMLElement, itemId: string, from: { x: number; y: number }, slot: number, quality = 0): void {
  const bar = root.querySelector<HTMLElement>('.hv-toolbar');
  const slots = bar ? [...bar.querySelectorAll<HTMLElement>('.u-slot')] : [];
  const target = slot >= 0 && slot < slots.length ? slots[slot]! : bar;
  const r = target?.getBoundingClientRect();
  const to = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight - 40 };
  const el = document.createElement('div');
  el.className = 'hv-flyitem';
  el.innerHTML = itemIcon(itemId) + (quality ? qualityStar(quality) : '');
  Object.assign(el.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '44px',
    height: '44px',
    marginLeft: '-22px',
    marginTop: '-22px',
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
  const anim = el.animate(frames, { duration: 620, easing: 'cubic-bezier(.45,.05,.55,.95)' });
  anim.onfinish = () => {
    el.remove();
    target?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.22, 0.86)' }, { transform: 'scale(0.94, 1.08)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'ease-out' },
    );
  };
}
