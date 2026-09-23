/**
 * Mine / combat overlay (DOM, styled to match the wood + parchment HUD):
 *  - HealthBar: red tube with a heart badge beside the energy bar (mine only, or when hurt).
 *  - FloorPlaque: carved sign with the floor number + biome name (top-left, mine only).
 *  - DamageNumbers: world-anchored pop-up numbers (monster damage, crits, player hurt, loot).
 *  - HurtFlash: red edge vignette pulse when the player is hit; black fade on pass-out.
 *  - ElevatorPanel: lift-cage floor picker registered as the 'elevator' UI panel.
 */
import * as THREE from 'three';

const CSS = /* css */ `
.hv-mine-hp { position:absolute; right:64px; bottom:16px; width:34px; height:178px; padding:6px; box-sizing:border-box;
  border-radius:18px; background: var(--wood-grad, linear-gradient(180deg,#c98c4c,#8a5226)); border:2px solid #5e3517;
  box-shadow: 0 6px 0 rgba(60,30,10,.35), 0 10px 24px rgba(30,15,5,.35), inset 0 2px 0 #d9a066, inset 0 -3px 0 #5e3517;
  transition: opacity .25s, transform .25s cubic-bezier(.34,1.56,.64,1); }
.hv-mine-hp.off { opacity:0; transform: translateY(20px) scale(.9); }
.hv-mine-hp .tube { position:absolute; inset:22px 7px 7px 7px; border-radius:10px; overflow:hidden; display:flex; align-items:flex-end;
  background: radial-gradient(120% 90% at 50% 20%, #3a1a14, #1e0c08); box-shadow: inset 0 2px 5px rgba(0,0,0,.6); }
.hv-mine-hp .fill { width:100%; border-radius:8px 8px 9px 9px; transition: height .25s ease-out;
  background: linear-gradient(180deg, #ff8a7a, #e03a3a 55%, #a41c26); box-shadow: inset 0 3px 0 rgba(255,255,255,.45), inset 0 -3px 0 rgba(0,0,0,.2); }
.hv-mine-hp .lag { position:absolute; left:0; right:0; bottom:0; background: rgba(255,230,200,.75); border-radius:8px; transition: height .6s .25s ease-out; }
.hv-mine-hp .gloss { position:absolute; left:4px; top:6px; bottom:6px; width:5px; border-radius:4px; background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.1)); }
.hv-mine-hp .badge { position:absolute; top:-20px; left:50%; width:40px; height:40px; translate:-50% 0; border-radius:50%;
  background: radial-gradient(circle at 40% 35%, #c98c4c, #8a5226); border:2px solid #5e3517; box-shadow: 0 3px 0 rgba(60,30,10,.4), inset 0 2px 0 #d9a066;
  display:grid; place-items:center; }
.hv-mine-hp .badge svg { width:24px; height:24px; filter: drop-shadow(0 1px 0 rgba(0,0,0,.35)); }
.hv-mine-hp.hit { animation: hvHpShake .35s; }
.hv-mine-hp.low .badge svg { animation: hvHeartBeat .7s infinite; }
@keyframes hvHpShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-4px) rotate(-2deg)} 40%{transform:translateX(4px) rotate(2deg)} 60%{transform:translateX(-3px)} 80%{transform:translateX(2px)} }
@keyframes hvHeartBeat { 0%,100%{transform:scale(1)} 30%{transform:scale(1.25)} 50%{transform:scale(.95)} }

.hv-mine-floor { position:absolute; left:18px; top:16px; padding:8px 18px 9px 14px; display:flex; align-items:center; gap:12px;
  border-radius:16px; background: var(--wood-grad, linear-gradient(180deg,#c98c4c,#8a5226)); border:2px solid #5e3517; color:#fff4dc;
  box-shadow: 0 6px 0 rgba(60,30,10,.35), 0 10px 24px rgba(30,15,5,.35), inset 0 2px 0 #d9a066, inset 0 -3px 0 #5e3517;
  font-family: var(--font-head, 'Fredoka', system-ui); transition: opacity .3s, transform .35s cubic-bezier(.34,1.56,.64,1); }
.hv-mine-floor.off { opacity:0; transform: translateY(-16px); }
.hv-mine-floor .gem { width:34px; height:34px; border-radius:50%; display:grid; place-items:center; background: radial-gradient(circle at 40% 35%, #6a4a30, #3a2412);
  box-shadow: inset 0 2px 4px rgba(0,0,0,.5), 0 1px 0 #d9a066; }
.hv-mine-floor .gem svg { width:22px; height:22px; }
.hv-mine-floor .num { font-size:26px; font-weight:700; line-height:1; text-shadow: 0 2px 0 #5e3517, 0 0 12px rgba(255,200,120,.35); letter-spacing:.5px; }
.hv-mine-floor .sub { font-family: var(--font-body, 'Nunito', system-ui); font-size:12.5px; font-weight:800; opacity:.9; letter-spacing:.8px; text-transform:uppercase; color:#ffe2b0; margin-top:2px; }

.hv-dmg-layer { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.hv-dmg { position:absolute; left:0; top:0; font-family: var(--font-head, 'Fredoka', system-ui); font-weight:700; font-size:42px; line-height:1; color:#fff;
  -webkit-text-stroke: 6px #3a1a0a; paint-order: stroke fill; text-shadow: 0 4px 0 rgba(40,15,5,.6); will-change: transform, opacity; white-space:nowrap; }
.hv-dmg.crit { color:#ffd84a; font-size:56px; -webkit-text-stroke:7px #3a1a0a; text-shadow: 0 4px 0 rgba(40,15,5,.6), 0 0 18px rgba(255,190,40,.65); }
.hv-dmg.player { color:#ff6a58; font-size:34px; -webkit-text-stroke:4px #2a0604; text-shadow: 0 3px 0 rgba(20,2,0,.7), 0 0 14px rgba(0,0,0,.55); }
.hv-dmg.loot { color:#fff4dc; font-size:22px; -webkit-text-stroke:3px #2a1a0c; text-shadow: 0 2px 0 rgba(20,10,4,.7); }
.hv-dmg.info { color:#ffe9c4; font-size:22px; -webkit-text-stroke:4px #3a2410; }

.hv-hurt { position:absolute; inset:0; pointer-events:none; opacity:0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 48%, rgba(200,20,20,.55) 100%); transition: opacity .35s ease-out; }
.hv-hurt.on { opacity:1; transition: none; }
.hv-blackout { position:absolute; inset:0; pointer-events:none; background:#000; opacity:0; transition: opacity .9s ease-in; display:grid; place-items:center; }
.hv-blackout.on { opacity:1; }
.hv-blackout span { color:#f4e2c4; font-family: var(--font-head, 'Fredoka', system-ui); font-size:28px; opacity:.9; text-align:center; line-height:1.4; }

.hv-elevator { position:absolute; right:clamp(24px, 7vw, 140px); top:50%; translate:0 -50%; width:360px; padding:10px 10px 12px; border-radius:22px;
  background: var(--wood-grad, linear-gradient(180deg,#c98c4c,#8a5226)); border:2px solid #5e3517; pointer-events:auto;
  box-shadow: 0 8px 0 rgba(50,24,8,.38), 0 26px 50px rgba(20,10,4,.45), inset 0 2px 0 #d9a066, inset 0 -3px 0 #5e3517;
  animation: hvElevIn .24s cubic-bezier(.34,1.56,.64,1); font-family: var(--font-body, 'Nunito', system-ui); }
@keyframes hvElevIn { from { transform: translateX(40px); opacity:0 } to { transform: none; opacity:1 } }
.hv-elevator .hd { display:flex; align-items:center; gap:10px; margin:2px 6px 10px; }
.hv-elevator .hd .wheel { width:40px; height:40px; flex:none; }
.hv-elevator h2 { margin:0; font-family: var(--font-head, 'Fredoka', system-ui); color:#fff4dc; font-size:25px; line-height:1; text-shadow:0 2px 0 #5e3517; }
.hv-elevator .depth { color:#ffe2b0; font-size:12.5px; font-weight:800; letter-spacing:.7px; text-transform:uppercase; margin-top:3px; }
.hv-elevator .shaft { position:relative; padding:10px 10px 10px 34px; border-radius:14px; max-height:min(62vh, 560px); overflow-y:auto;
  background: linear-gradient(90deg, #2a1a10 0 30px, transparent 30px), radial-gradient(120% 90% at 50% 20%, #fbf0d6, #efd8a6);
  box-shadow: inset 0 2px 6px rgba(80,40,10,.45); display:flex; flex-direction:column; gap:7px; scrollbar-width:thin; }
.hv-elevator .shaft::before { content:''; position:absolute; left:14px; top:0; bottom:0; width:3px; border-radius:2px;
  background: repeating-linear-gradient(180deg, #b8a890 0 5px, #6a5a48 5px 8px); box-shadow: 0 0 0 1px rgba(0,0,0,.35); }
.hv-elevator .stop { position:relative; display:flex; align-items:center; gap:10px; padding:7px 10px 7px 8px; border-radius:12px; cursor:pointer;
  border:2px solid #8a5a2e; background: linear-gradient(180deg,#fff8e6,#f3dcae); box-shadow: 0 3px 0 #a8743f; color:#4a2e16;
  transition: transform .12s, box-shadow .12s; text-align:left; font:inherit; }
.hv-elevator .stop:hover:not(.locked):not(.cur) { transform: translateX(-4px); box-shadow: 0 3px 0 #a8743f, 0 0 0 3px rgba(255,220,140,.6); }
.hv-elevator .stop::before { content:''; position:absolute; left:-26px; top:50%; width:12px; height:12px; translate:0 -50%; border-radius:50%;
  background: radial-gradient(circle at 40% 35%, #ffe6a0, #c08a2a); border:2px solid #3a2410; }
.hv-elevator .stop.locked::before { background:#4a3a2c; }
.hv-elevator .stop.cur::before { background: radial-gradient(circle at 40% 35%, #fff4b0, #ffb020); box-shadow: 0 0 10px 3px rgba(255,190,60,.8); }
.hv-elevator .chip { width:36px; height:36px; flex:none; border-radius:10px; display:grid; place-items:center; border:2px solid rgba(0,0,0,.35);
  box-shadow: inset 0 2px 0 rgba(255,255,255,.35), inset 0 -3px 0 rgba(0,0,0,.25); }
.hv-elevator .chip svg { width:22px; height:22px; filter: drop-shadow(0 1px 0 rgba(0,0,0,.4)); }
.hv-elevator .chip.earth { background: linear-gradient(180deg,#b07844,#7a4a26); }
.hv-elevator .chip.ice { background: linear-gradient(180deg,#6aa8dc,#2e5e98); }
.hv-elevator .chip.lava { background: linear-gradient(180deg,#d8542a,#7a1c10); }
.hv-elevator .chip.surface { background: linear-gradient(180deg,#8cc46a,#4a7a34); }
.hv-elevator .lbl { flex:1; min-width:0; }
.hv-elevator .lbl b { display:block; font-family: var(--font-head, 'Fredoka', system-ui); font-size:19px; font-weight:700; line-height:1.05; }
.hv-elevator .lbl small { display:block; font-size:11px; font-weight:800; letter-spacing:.7px; text-transform:uppercase; opacity:.72; margin-top:2px; }
.hv-elevator .tag { flex:none; font-size:11px; font-weight:900; letter-spacing:.6px; text-transform:uppercase; padding:4px 8px; border-radius:8px; }
.hv-elevator .tag.go { background:#5a8a3a; color:#f4ffe8; box-shadow: inset 0 -2px 0 rgba(0,0,0,.25); }
.hv-elevator .tag.here { background:#ffcf4a; color:#5a3a10; box-shadow: inset 0 -2px 0 rgba(0,0,0,.2); }
.hv-elevator .tag svg { width:16px; height:16px; display:block; }
.hv-elevator .stop.cur { background: linear-gradient(180deg,#ffeaa0,#f5c542); border-color:#a8741e; cursor:default; }
.hv-elevator .stop.locked { cursor:default; background: repeating-linear-gradient(135deg, #d8c4a0 0 8px, #cfb994 8px 16px); border-style:dashed; border-color:#8a6a4a;
  box-shadow:none; color:#5e4a36; }
.hv-elevator .stop.locked .chip { filter: grayscale(.75) brightness(.8); }
.hv-elevator .stop.locked .tag { background:#5e4a36; color:#f0e0c8; padding:4px 6px; }
.hv-elevator .foot { text-align:center; color:#fff0d0; font-weight:800; font-size:12px; margin-top:9px; opacity:.88; letter-spacing:.4px; }
.hv-elevator .foot kbd { font: inherit; background:rgba(0,0,0,.25); border-radius:5px; padding:1px 6px; }
`;

let injected = false;
function inject(): void {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.hv = 'mine';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const HEART = `<svg viewBox="0 0 24 24"><defs><linearGradient id="hvHeart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a8a"/><stop offset=".6" stop-color="#e8413a"/><stop offset="1" stop-color="#b01e28"/></linearGradient></defs><path d="M12 21 C 5 16 2 12.5 2 8.6 C 2 5.6 4.3 3.4 7.1 3.4 C 9 3.4 10.9 4.5 12 6.3 C 13.1 4.5 15 3.4 16.9 3.4 C 19.7 3.4 22 5.6 22 8.6 C 22 12.5 19 16 12 21 Z" fill="url(#hvHeart)" stroke="#6a1410" stroke-width="1.4"/><path d="M6.5 7 C 7 6 8 5.6 9 5.8" stroke="#ffd8d0" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;

export const BIOME_GEM: Record<string, string> = {
  earth: `<svg viewBox="0 0 24 24"><path d="M12 2 L19 9 L12 22 L5 9 Z" fill="#ffb347" stroke="#7a4a10" stroke-width="1.3"/><path d="M5 9 H19 M12 2 L9 9 L12 22 L15 9 Z" fill="none" stroke="#fff0c0" stroke-width=".9" opacity=".8"/></svg>`,
  ice: `<svg viewBox="0 0 24 24"><path d="M12 2 L19 9 L12 22 L5 9 Z" fill="#7fe0ff" stroke="#1e5a8a" stroke-width="1.3"/><path d="M5 9 H19 M12 2 L9 9 L12 22 L15 9 Z" fill="none" stroke="#f0fcff" stroke-width=".9" opacity=".85"/></svg>`,
  lava: `<svg viewBox="0 0 24 24"><path d="M12 2 L19 9 L12 22 L5 9 Z" fill="#ff5a2a" stroke="#6a1408" stroke-width="1.3"/><path d="M5 9 H19 M12 2 L9 9 L12 22 L15 9 Z" fill="none" stroke="#ffd0a0" stroke-width=".9" opacity=".8"/></svg>`,
  entrance: `<svg viewBox="0 0 24 24"><path d="M3 20 L9 8 L12 12 L15 7 L21 20 Z" fill="#a89a88" stroke="#4a3e32" stroke-width="1.3"/><path d="M10 20 V15 A2 2 0 0 1 14 15 V20" fill="#241a12"/></svg>`,
};

export class HealthBar {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private lag: HTMLElement;
  private shown = -1;

  constructor(parent: HTMLElement) {
    inject();
    this.el = document.createElement('div');
    this.el.className = 'hv-mine-hp off';
    this.el.innerHTML = `<div class="tube"><div class="lag"></div><div class="fill"></div></div><div class="gloss"></div><div class="badge">${HEART}</div>`;
    this.fill = this.el.querySelector('.fill') as HTMLElement;
    this.lag = this.el.querySelector('.lag') as HTMLElement;
    this.el.title = 'Health';
    parent.appendChild(this.el);
  }

  set(hp: number, max: number): void {
    const f = Math.max(0, hp / max);
    if (f < this.shown) {
      this.el.classList.remove('hit');
      void this.el.offsetWidth;
      this.el.classList.add('hit');
    }
    this.shown = f;
    this.fill.style.height = `${Math.round(f * 100)}%`;
    this.lag.style.height = `${Math.round(f * 100)}%`;
    this.el.classList.toggle('low', f < 0.25);
    this.el.title = `Health ${Math.ceil(hp)} / ${max}`;
  }

  show(on: boolean): void {
    this.el.classList.toggle('off', !on);
  }
}

export class FloorPlaque {
  readonly el: HTMLElement;
  constructor(parent: HTMLElement) {
    inject();
    this.el = document.createElement('div');
    this.el.className = 'hv-mine-floor off';
    parent.appendChild(this.el);
  }

  set(floor: number, sub: string, biome: string): void {
    this.el.innerHTML = `<div class="gem">${BIOME_GEM[biome] ?? BIOME_GEM.earth}</div><div><div class="num">${floor > 0 ? `Floor ${floor}` : 'Mine Entrance'}</div><div class="sub">${sub}</div></div>`;
  }

  show(on: boolean): void {
    this.el.classList.toggle('off', !on);
  }

  private dodgeT = 0;
  /** Slide below the co-op roster plate (top-left) when one is showing. */
  dodge(dt: number): void {
    this.dodgeT -= dt;
    if (this.dodgeT > 0) return;
    this.dodgeT = 0.5;
    const r = document.querySelector('.coop-roster') as HTMLElement | null;
    const rect = r && r.offsetParent !== null ? r.getBoundingClientRect() : null;
    const par = this.el.parentElement;
    const pr = par?.getBoundingClientRect();
    const zoom = pr && par && par.offsetWidth ? pr.width / par.offsetWidth : 1;
    const top = rect && pr && rect.height > 0 && rect.left < 300 ? Math.round((rect.bottom - pr.top) / zoom + 10) : 16;
    const want = `${top}px`;
    if (this.el.style.top !== want) this.el.style.top = want;
  }
}

interface Num {
  el: HTMLElement;
  pos: THREE.Vector3;
  /** Live anchor (e.g. the farmer's position) + world offset, instead of a fixed point. */
  follow: THREE.Vector3 | null;
  off: THREE.Vector3;
  age: number;
  life: number;
  dx: number;
  /** Fixed screen offset (px): pushes a number clear of the farmer / stacks loot lines. */
  sx: number;
  sy: number;
  kind: string;
  text: string;
  qty: number;
}

export interface PopOpts {
  /** Track `at` (a live vector) every frame instead of copying it. */
  follow?: boolean;
  /** World offset added to the anchor. */
  off?: THREE.Vector3;
  /** Screen offset in px. */
  dx?: number;
  dy?: number;
}

export class DamageNumbers {
  readonly layer: HTMLElement;
  private list: Num[] = [];
  private v = new THREE.Vector3();
  /** Demo stills: numbers stop ageing at their peak pop (they keep tracking the camera). */
  hold = false;

  constructor(parent: HTMLElement) {
    inject();
    this.layer = document.createElement('div');
    this.layer.className = 'hv-dmg-layer';
    parent.appendChild(this.layer);
  }

  pop(at: THREE.Vector3, text: string, kind: 'dmg' | 'crit' | 'player' | 'loot' | 'info' = 'dmg', opts: PopOpts = {}): void {
    // Loot: one line per item id; a repeat within 0.5 s bumps the count instead of overprinting.
    if (kind === 'loot') {
      const m = /^\+(\d+)\s+(.*)$/.exec(text);
      const name = m ? m[2]! : text;
      const q = m ? Number(m[1]) : 1;
      const same = this.list.find((n) => n.kind === 'loot' && n.text === name && n.age < 0.5);
      if (same) {
        same.qty += q;
        same.el.textContent = `+${same.qty} ${name}`;
        same.age = Math.min(same.age, 0.12);
        return;
      }
      const slot = this.list.filter((n) => n.kind === 'loot' && n.age < n.life * 0.8).length;
      opts = { ...opts, dy: (opts.dy ?? 0) - slot * 26 };
      text = `+${q} ${name}`;
      this.push(at, text, kind, opts, name, q);
      return;
    }
    // Numbers landing on the same spot within half a second stack upwards instead of overprinting.
    if (!opts.follow) {
      const near = this.list.filter((n) => n.kind !== 'loot' && !n.follow && n.age < 0.5 && n.pos.distanceToSquared(at) < 0.9 * 0.9).length;
      if (near) opts = { ...opts, dy: (opts.dy ?? 0) - near * 36, dx: (opts.dx ?? 0) + (near % 2 ? 18 : -18) };
    }
    this.push(at, text, kind, opts, text, 1);
  }

  private push(at: THREE.Vector3, text: string, kind: string, opts: PopOpts, key: string, qty: number): void {
    const el = document.createElement('div');
    el.className = `hv-dmg ${kind}`;
    el.textContent = text;
    this.layer.appendChild(el);
    this.list.push({
      el,
      pos: opts.follow ? at : at.clone(),
      follow: opts.follow ? at : null,
      off: opts.off?.clone() ?? new THREE.Vector3(),
      age: 0,
      life: kind === 'loot' || kind === 'info' ? 1.3 : kind === 'crit' ? 1.1 : 0.95,
      dx: kind === 'loot' ? 0 : (Math.random() - 0.5) * 12,
      sx: opts.dx ?? 0,
      sy: opts.dy ?? 0,
      kind,
      text: key,
      qty,
    });
    if (this.list.length > 40) this.list.shift()!.el.remove();
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i]!;
      if (!this.hold || n.age < n.life * 0.32) n.age += dt;
      const t = n.age / n.life;
      if (t >= 1) {
        n.el.remove();
        this.list.splice(i, 1);
        continue;
      }
      this.v.copy(n.follow ?? n.pos).add(n.off).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * w + n.sx;
      const y = (-this.v.y * 0.5 + 0.5) * h + n.sy;
      // Pop: 1.4 → 1 overshoot in ~0.1 s, a 40 px rise (eased), fade out; crits shake while popping.
      const age = n.age;
      const pop = age < 0.05 ? 0.6 + (age / 0.05) * 0.8 : age < 0.14 ? 1.4 - ((age - 0.05) / 0.09) * 0.4 : 1;
      const rise = n.kind === 'loot' || n.kind === 'info' ? t * 60 : (1 - Math.pow(1 - Math.min(1, t * 1.4), 3)) * 40;
      const shake = n.kind === 'crit' && age < 0.3 ? Math.sin(age * 90) * 5 * (1 - age / 0.3) : 0;
      const op = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
      n.el.style.transform = `translate(-50%, -50%) translate(${x + n.dx * t + shake}px, ${y - rise}px) scale(${pop})`;
      n.el.style.opacity = String(op);
    }
  }

  clear(): void {
    for (const n of this.list) n.el.remove();
    this.list.length = 0;
  }
}

export class ScreenFx {
  private hurt: HTMLElement;
  private black: HTMLElement;
  private t = 0;
  constructor(parent: HTMLElement) {
    inject();
    this.hurt = document.createElement('div');
    this.hurt.className = 'hv-hurt';
    this.black = document.createElement('div');
    this.black.className = 'hv-blackout';
    parent.append(this.hurt, this.black);
  }

  hit(): void {
    this.hurt.classList.add('on');
    this.t = 0.08;
  }

  blackout(on: boolean, text = ''): void {
    this.black.innerHTML = text ? `<span>${text}</span>` : '';
    this.black.classList.toggle('on', on);
  }

  update(dt: number): void {
    if (this.t > 0) {
      this.t -= dt;
      if (this.t <= 0) this.hurt.classList.remove('on');
    }
  }
}

const LOCK = `<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="#f0e0c8"/><path d="M5 7 V5 a3 3 0 0 1 6 0 V7" fill="none" stroke="#f0e0c8" stroke-width="1.8"/><circle cx="8" cy="10.6" r="1.2" fill="#5e4a36"/></svg>`;
const WHEEL = `<svg viewBox="0 0 40 40" class="wheel"><circle cx="20" cy="20" r="16" fill="none" stroke="#3a2410" stroke-width="5"/><circle cx="20" cy="20" r="16" fill="none" stroke="#c8b8a0" stroke-width="3"/>${[0, 45, 90, 135].map((a) => `<line x1="20" y1="6" x2="20" y2="34" stroke="#8a7a66" stroke-width="2.4" transform="rotate(${a} 20 20)"/>`).join('')}<circle cx="20" cy="20" r="4.5" fill="#d8a848" stroke="#3a2410" stroke-width="1.5"/></svg>`;
const SURFACE = `<svg viewBox="0 0 24 24"><path d="M2 20 L8 9 L11 13 L15 6 L22 20 Z" fill="#f4f0e0" stroke="#2a4a1a" stroke-width="1.3"/><circle cx="18" cy="6" r="2.4" fill="#ffe27a"/></svg>`;
const BIOME_NAME: Record<string, string> = { earth: 'Earthen Hollows', ice: 'Frostvein Grotto', lava: 'Cinder Depths' };

export class ElevatorPanel {
  private el: HTMLElement;
  constructor(
    parent: HTMLElement,
    private floors: () => { floor: number; biome: string; unlocked: boolean; current: boolean }[],
    private pick: (floor: number) => void,
    private closeUI: () => void,
    private depth: () => number = () => -1,
  ) {
    inject();
    this.el = document.createElement('div');
    this.el.className = 'hv-elevator hv-hidden interactive';
    parent.appendChild(this.el);
  }

  open(): void {
    const list = this.floors();
    const d = this.depth();
    const cur = d >= 0 ? d : (list.find((f) => f.current)?.floor ?? 0);
    const here = cur > 0 ? `Now at floor ${cur} · ${BIOME_NAME[list.find((f) => f.floor === cur)?.biome ?? ''] ?? 'the Hollowdeep'}` : 'Now at the surface';
    const row = (f: (typeof list)[number]): string => {
      const surf = f.floor === 0;
      const chip = surf ? `<span class="chip surface">${SURFACE}</span>` : `<span class="chip ${f.biome}">${BIOME_GEM[f.biome] ?? BIOME_GEM.earth}</span>`;
      const name = surf ? 'Surface' : `Floor ${f.floor}`;
      const sub = surf ? 'Mountain shelf' : BIOME_NAME[f.biome] ?? '';
      const tag = f.current ? '<span class="tag here">Here</span>' : f.unlocked ? '<span class="tag go">Go</span>' : `<span class="tag" title="Reach floor ${f.floor} to unlock">${LOCK}</span>`;
      return `<button class="stop ${f.biome} ${f.current ? 'cur' : ''} ${f.unlocked ? '' : 'locked'}" data-f="${f.floor}" ${f.unlocked && !f.current ? '' : 'disabled'}>${chip}<span class="lbl"><b>${name}</b><small>${sub}</small></span>${tag}</button>`;
    };
    this.el.innerHTML = `<div class="hd">${WHEEL}<div><h2>Mine Lift</h2><div class="depth">${here}</div></div></div><div class="shaft">${list.map(row).join('')}</div><div class="foot">Every fifth floor you reach unlocks a stop · <kbd>Esc</kbd> to close</div>`;
    this.el.querySelectorAll('button[data-f]').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const f = Number((b as HTMLElement).dataset.f);
        if ((b as HTMLButtonElement).disabled) return;
        this.closeUI();
        this.pick(f);
      }),
    );
    this.el.classList.remove('hv-hidden');
  }

  close(): void {
    this.el.classList.add('hv-hidden');
  }
}
