/**
 * "Now playing" card: when a new piece of the score begins, a small wood-and-parchment card slides
 * in with the tune's name, where you are, and the first two bars of its melody engraved on a
 * staff (real notation: treble clef, key signature, beams, dots, accidentals) — the notes pop in
 * one by one. It fades after a few seconds. `?card=1` pins it (screenshots), `?card=0` hides it.
 */
import { tuneHook, type ThemeDef } from './composer';
import { MODES } from './theory';

const CSS = `
.hv-np{position:fixed;left:22px;bottom:118px;z-index:40;display:flex;align-items:stretch;gap:0;pointer-events:none;
  font-family:var(--font-head,'Fredoka','Nunito',system-ui,sans-serif);color:var(--parch-ink,#5a3a1e);
  opacity:0;transform:translateX(-24px) scale(.96);transform-origin:left center;
  transition:opacity .26s ease-out,transform .32s cubic-bezier(.34,1.56,.64,1)}
.hv-np.on{opacity:1;transform:none}
.hv-np.off{opacity:0;transform:translateX(-12px);transition:opacity .6s ease-in,transform .6s ease-in}
.hv-np-card{position:relative;display:flex;gap:12px;align-items:center;padding:9px 16px 9px 10px;border-radius:16px;
  background:var(--u-paper,none) 0 0/256px,radial-gradient(120% 110% at 30% 15%,#fff8e6,#f3dfb4 70%,#e9cf9a);
  border:3px solid #7a4a22;box-shadow:0 6px 18px rgba(40,22,8,.35),inset 0 0 0 2px rgba(255,244,214,.75),inset 0 -6px 14px rgba(160,110,50,.18)}
.hv-np-disc{flex:none;width:54px;height:54px;border-radius:50%;display:grid;place-items:center;
  background:radial-gradient(circle at 35% 30%,#d9a066,#a86a34 55%,#6a3c1a);border:2px solid #5e3517;
  box-shadow:inset 0 2px 0 rgba(255,220,170,.55),inset 0 -3px 6px rgba(40,20,5,.45),0 2px 4px rgba(40,20,5,.3)}
.hv-np-disc svg{width:30px;height:30px;filter:drop-shadow(0 1px 0 rgba(60,30,10,.6));animation:hv-np-bob 1.6s ease-in-out infinite}
.hv-np-body{display:flex;flex-direction:column;min-width:0}
.hv-np-kick{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:#9a6a3a;line-height:1}
.hv-np-title{font-size:21px;font-weight:600;line-height:1.1;margin-top:3px;color:#4a2c12;white-space:nowrap}
.hv-np-sub{font-family:var(--font-body,'Nunito',system-ui,sans-serif);font-size:12px;font-style:italic;color:#8a6040;line-height:1.1;margin-top:1px}
.hv-np-staff{display:block;margin-top:4px}
.hv-np-staff .n{opacity:0;animation:hv-np-pop .34s cubic-bezier(.34,1.8,.64,1) forwards}
@keyframes hv-np-pop{from{opacity:0;transform:translateY(-5px) scale(.6)}to{opacity:1;transform:none}}
@keyframes hv-np-bob{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-2px) rotate(6deg)}}
.hv-np-fly{position:absolute;left:30px;top:30px;width:24px;height:24px;pointer-events:none;opacity:0;z-index:-1;
  filter:drop-shadow(0 2px 0 rgba(74,44,18,.95)) drop-shadow(0 0 1.5px rgba(74,44,18,.9)) drop-shadow(0 0 10px rgba(255,214,140,.7));
  animation:hv-np-fly var(--d,2.8s) cubic-bezier(.22,.7,.36,1) forwards}
.hv-np-fly svg{width:100%;height:100%;display:block}
@keyframes hv-np-fly{0%{opacity:0;transform:translate(0,0) scale(.45) rotate(var(--r0,-10deg))}
  12%{opacity:1;transform:translate(calc(var(--dx,0px)*.18),calc(var(--dy,-40px)*.15)) scale(1.05) rotate(0deg)}
  60%{opacity:.95;transform:translate(calc(var(--dx,0px)*.7),calc(var(--dy,-40px)*.8)) scale(.95) rotate(var(--r1,8deg))}
  100%{opacity:0;transform:translate(var(--dx,0px),var(--dy,-40px)) scale(.8) rotate(var(--r0,-10deg))}}
@media (prefers-reduced-motion:reduce){.hv-np-fly{display:none}}
@media (max-width:640px){.hv-np{left:10px;bottom:96px;transform-origin:left bottom}.hv-np-card{transform:scale(.86);transform-origin:left bottom}}
`;

const NOTE_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff4d8" d="M12 5.5 26 2.5v17.2a4.6 3.7 -20 1 1-2.6-3.5V8.3L14.6 10.2v12.4a4.6 3.7 -20 1 1-2.6-3.5z"/></svg>`;

/** Circle-of-fifths position of the relative major for a theme's key + mode. */
function fifths(keyMidi: number, mode: keyof typeof MODES): number {
  const rel: Record<string, number> = { major: 0, minor: 3, dorian: -2, phrygian: -4, lydian: -5, mixolydian: 5, harmonicMinor: 3 };
  const pc = (((keyMidi + (rel[mode] ?? 0)) % 12) + 12) % 12;
  const table: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };
  return table[pc] ?? 0;
}

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter indices)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

/** Spell a MIDI note in a key: diatonic number (octave*7 + letter) and alteration. */
function spell(midi: number, k: number): { dia: number; alter: number } {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const nat = LETTER_PC.indexOf(pc);
  const keyAlter = (letter: number): number => (k > 0 && SHARP_ORDER.slice(0, k).includes(letter) ? 1 : k < 0 && FLAT_ORDER.slice(0, -k).includes(letter) ? -1 : 0);
  // Prefer the spelling the key signature already implies.
  for (let letter = 0; letter < 7; letter++) {
    const a = keyAlter(letter);
    if ((LETTER_PC[letter]! + a + 12) % 12 === pc) {
      const o = LETTER_PC[letter]! + a < 0 ? oct + 1 : LETTER_PC[letter]! + a > 11 ? oct - 1 : oct;
      return { dia: o * 7 + letter, alter: a };
    }
  }
  if (nat >= 0) return { dia: oct * 7 + nat, alter: 0 };
  if (k >= 0) return { dia: oct * 7 + LETTER_PC.indexOf(pc - 1), alter: 1 };
  return { dia: oct * 7 + LETTER_PC.indexOf((pc + 1) % 12) + (pc === 11 ? 7 : 0), alter: -1 };
}

/** Engrave the first bars of a theme's tune as an SVG staff. */
export function engrave(th: ThemeDef, bars = 2, width = 268): string {
  const notes = tuneHook(th, bars);
  if (!notes.length) return '';
  const k = fifths(th.key, th.mode);
  const S = th.meter === '4/4' ? 8 : 6;
  const gap = 6.4; // staff line spacing
  const top = 16;
  const bottom = top + gap * 4; // E4 line
  const yOf = (dia: number): number => bottom - (dia - 30) * (gap / 2);
  const spelled = notes.map((n) => ({ ...n, ...spell(n.midi, k) }));
  const avg = spelled.reduce((a, n) => a + n.dia, 0) / spelled.length;
  const ottava = avg > 40 ? 7 : 0;
  for (const n of spelled) n.dia -= ottava;
  const H = 62;
  const ink = '#4a2c12';
  const out: string[] = [];
  for (let i = 0; i < 5; i++) out.push(`<line x1="2" x2="${width - 2}" y1="${top + i * gap}" y2="${top + i * gap}" stroke="#8a6a4a" stroke-width="0.9" opacity="0.8"/>`);
  // Treble clef (drawn, so no music font is needed).
  const cy = top + gap * 3; // G line
  out.push(`<path d="M9.6 ${cy + 17} c-2.6 0.6 -4.4 -1.4 -3.3 -3.2 c0.9 -1.5 3.4 -1.2 3.5 0.6 L8.6 ${top - 7} c-0.2 -3.6 3.8 -5.4 4.4 -1.4 c0.6 4 -7.6 8.6 -7.7 14.4 c-0.1 5 4 7.6 7.4 6.2 c3.4 -1.4 3.2 -6.8 -0.8 -6.9 c-2.6 -0.1 -3.8 2.2 -2.4 3.8" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.4" cy="${cy + 15.6}" r="1.9" fill="${ink}"/>`);
  let x = 22;
  // Key signature.
  const sharpDia = [38, 35, 39, 36, 33, 37, 34]; // F5 C5 G5 D5 A4 E5 B4
  const flatDia = [34, 37, 33, 36, 32, 35, 31]; // B4 E5 A4 D5 G4 C5 F4
  for (let i = 0; i < Math.abs(k); i++) {
    const dia = k > 0 ? sharpDia[i]! : flatDia[i]!;
    out.push(`<text x="${x}" y="${yOf(dia) + (k > 0 ? 3.6 : 2.4)}" font-size="11" fill="${ink}" font-family="serif">${k > 0 ? '♯' : '♭'}</text>`);
    x += 5.6;
  }
  if (k !== 0) x += 3;
  // Time signature.
  const [tn, td] = th.meter.split('/');
  out.push(`<text x="${x + 2}" y="${top + gap * 2 - 1}" font-size="12.5" font-weight="700" fill="${ink}" font-family="Georgia,serif">${tn}</text>`);
  out.push(`<text x="${x + 2}" y="${top + gap * 4 - 1}" font-size="12.5" font-weight="700" fill="${ink}" font-family="Georgia,serif">${td}</text>`);
  x += 16;
  if (ottava) out.push(`<text x="${x}" y="8" font-size="8.5" font-style="italic" fill="#8a6040" font-family="Georgia,serif">8va</text>`);
  const x0 = x + 4;
  const x1 = width - 8;
  const total = bars * S;
  const xOf = (step: number): number => x0 + (step / total) * (x1 - x0);
  for (let b = 1; b <= bars; b++) {
    const bx = b === bars ? x1 + 4 : xOf(b * S) - 4;
    out.push(`<line x1="${bx}" x2="${bx}" y1="${top}" y2="${bottom}" stroke="${ink}" stroke-width="${b === bars ? 1.8 : 1}"/>`);
  }
  // Beam groups: consecutive eighths inside one beat (2 eighths in 4/4 & 3/4, 3 in 6/8).
  const grp = th.meter === '6/8' ? 3 : 2;
  const groups: number[][] = [];
  spelled.forEach((n, i) => {
    if (n.steps !== 1) return;
    const g = groups[groups.length - 1];
    const prev = g ? spelled[g[g.length - 1]!]! : null;
    if (g && prev && prev.step + 1 === n.step && Math.floor(prev.step / grp) === Math.floor(n.step / grp)) g.push(i);
    else groups.push([i]);
  });
  const beamed = new Map<number, number[]>();
  for (const g of groups) if (g.length > 1) for (const i of g) beamed.set(i, g);
  const stemUp = (dia: number): boolean => dia < 34;
  const delay = (i: number): string => `style="animation-delay:${(0.25 + i * 0.09).toFixed(2)}s"`;
  const drawn = new Set<number[]>();
  spelled.forEach((n, i) => {
    const nx = xOf(n.step) + 5;
    const ny = yOf(n.dia);
    const parts: string[] = [];
    // Ledger lines.
    for (let d = 40; d <= n.dia; d += 2) parts.push(`<line x1="${nx - 5.5}" x2="${nx + 5.5}" y1="${yOf(d)}" y2="${yOf(d)}" stroke="${ink}" stroke-width="0.9"/>`);
    for (let d = 28; d >= n.dia; d -= 2) parts.push(`<line x1="${nx - 5.5}" x2="${nx + 5.5}" y1="${yOf(d)}" y2="${yOf(d)}" stroke="${ink}" stroke-width="0.9"/>`);
    // Accidental against the key signature.
    const letter = ((n.dia % 7) + 7) % 7;
    const keyAlt = k > 0 && SHARP_ORDER.slice(0, k).includes(letter) ? 1 : k < 0 && FLAT_ORDER.slice(0, -k).includes(letter) ? -1 : 0;
    if (n.alter !== keyAlt) parts.push(`<text x="${nx - 11}" y="${ny + 3}" font-size="10" fill="${ink}" font-family="serif">${n.alter > 0 ? '♯' : n.alter < 0 ? '♭' : '♮'}</text>`);
    const hollow = n.steps >= 4;
    parts.push(`<ellipse cx="${nx}" cy="${ny}" rx="3.9" ry="2.8" transform="rotate(-20 ${nx} ${ny})" fill="${hollow ? 'none' : ink}" stroke="${ink}" stroke-width="${hollow ? 1.3 : 0.6}"/>`);
    if (n.steps === 3 || n.steps === 6 || n.steps === 7) parts.push(`<circle cx="${nx + 6}" cy="${ny - (n.dia % 2 === 0 ? 1.8 : 0)}" r="1.1" fill="${ink}"/>`);
    const g = beamed.get(i);
    if (n.steps < 8 && !g) {
      const up = stemUp(n.dia);
      const sx = up ? nx + 3.4 : nx - 3.4;
      const sy = up ? ny - 19 : ny + 19;
      parts.push(`<line x1="${sx}" x2="${sx}" y1="${ny}" y2="${sy}" stroke="${ink}" stroke-width="1"/>`);
      if (n.steps === 1) parts.push(`<path d="M${sx} ${sy} q4 ${up ? 4 : -4} 3.2 ${up ? 10 : -10}" fill="none" stroke="${ink}" stroke-width="1.3"/>`);
    }
    out.push(`<g class="n" ${delay(i)}>${parts.join('')}</g>`);
    if (g && !drawn.has(g)) {
      drawn.add(g);
      const heads = g.map((j) => ({ x: xOf(spelled[j]!.step) + 5, y: yOf(spelled[j]!.dia) }));
      const up = g.reduce((a, j) => a + spelled[j]!.dia, 0) / g.length < 34;
      const ext = up ? Math.min(...heads.map((h) => h.y)) - 18 : Math.max(...heads.map((h) => h.y)) + 18;
      const slope = Math.max(-3, Math.min(3, (heads[heads.length - 1]!.y - heads[0]!.y) * 0.3));
      const sxs = heads.map((h) => (up ? h.x + 3.4 : h.x - 3.4));
      const yAt = (sx: number): number => ext + slope * ((sx - sxs[0]!) / Math.max(1, sxs[sxs.length - 1]! - sxs[0]!)) - slope / 2;
      const stems = heads.map((h, hi) => `<line x1="${sxs[hi]}" x2="${sxs[hi]}" y1="${h.y}" y2="${yAt(sxs[hi]!)}" stroke="${ink}" stroke-width="1"/>`).join('');
      const beam = `<path d="M${sxs[0]} ${yAt(sxs[0]!) - (up ? 0 : 2.6)} L${sxs[sxs.length - 1]} ${yAt(sxs[sxs.length - 1]!) - (up ? 0 : 2.6)} l0 2.6 L${sxs[0]} ${yAt(sxs[0]!) + (up ? 2.6 : 0)} z" fill="${ink}"/>`;
      out.push(`<g class="n" ${delay(g[g.length - 1]!)}>${stems}${beam}</g>`);
    }
  });
  return `<svg class="hv-np-staff" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" aria-label="First bars of the melody">${out.join('')}</svg>`;
}

const FLY_NOTES = [
  NOTE_ICON,
  `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff4d8" d="M17 4h3c.4 3.2 2.4 5 5 6.8 2.6 1.8 3.4 5.2 1.8 8.2-.4-2.6-1.8-4.6-4.4-5.4-.8-.3-1.6-.4-2.4-.3v8.6a5 4 -20 1 1-3-3.6z"/></svg>`,
];
const FLY_TINTS = ['#ffe9b0', '#ffd27a', '#ffc9b4', '#e2f0b8', '#cfe6ff'];

export class NowPlaying {
  private el: HTMLElement | null = null;
  private timer = 0;
  private shownAt = -1e9;
  private pinned = false;
  private lastFly = 0;
  private flying = 0;
  disabled = false;

  private ensure(): HTMLElement {
    if (this.el) return this.el;
    if (!document.getElementById('hv-np-css')) {
      const st = document.createElement('style');
      st.id = 'hv-np-css';
      st.textContent = CSS;
      document.head.append(st);
    }
    const el = document.createElement('div');
    el.className = 'hv-np';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
    this.el = el;
    return el;
  }

  show(th: ThemeDef, pin = false): void {
    if (this.disabled || typeof document === 'undefined') return;
    const el = this.ensure();
    el.innerHTML = `<div class="hv-np-card"><div class="hv-np-disc">${NOTE_ICON}</div><div class="hv-np-body"><div class="hv-np-kick">Now playing</div><div class="hv-np-title">${escapeHtml(th.title)}</div>${th.blurb ? `<div class="hv-np-sub">${escapeHtml(th.blurb)}</div>` : ''}${engrave(th)}</div></div>`;
    el.classList.remove('on', 'off');
    void el.offsetWidth;
    el.classList.add('on');
    window.clearTimeout(this.timer);
    this.shownAt = performance.now();
    this.pinned = pin;
    if (!pin) {
      this.timer = window.setTimeout(() => {
        el.classList.remove('on');
        el.classList.add('off');
      }, 6500);
    }
  }

  hide(): void {
    this.el?.classList.remove('on');
  }

  /**
   * A melody note is about to sound `delay` seconds from now: while the card is up, a little note
   * glyph floats out of its disc in time with the tune, drifting left or right by pitch.
   */
  note(midi: number, delay: number): void {
    if (this.disabled || !this.el || typeof document === 'undefined') return;
    const live = this.pinned || performance.now() - this.shownAt < 6500;
    if (!live || this.flying >= 14) return;
    const at = performance.now() + Math.max(0, delay) * 1000;
    if (at - this.lastFly < 190) return;
    this.lastFly = at;
    const el = this.el;
    window.setTimeout(() => {
      const f = document.createElement('span');
      f.className = 'hv-np-fly';
      const k = ((midi % 12) + 12) % 12;
      f.innerHTML = FLY_NOTES[midi % 2]!.replace('#fff4d8', FLY_TINTS[k % FLY_TINTS.length]!);
      // Out of the disc into the scene: leftward when the card sits on the right of the screen.
      const r = el.getBoundingClientRect();
      const side = r.left + r.width / 2 > window.innerWidth / 2 ? -1 : 1;
      const dx = side * Math.round(170 + Math.random() * 190);
      const dy = Math.round(30 - (k / 11) * 150 - Math.random() * 40);
      f.style.setProperty('--dx', `${dx}px`);
      f.style.setProperty('--dy', `${dy}px`);
      f.style.setProperty('--r0', `${Math.round((Math.random() - 0.5) * 30)}deg`);
      f.style.setProperty('--r1', `${Math.round((Math.random() - 0.5) * 24)}deg`);
      f.style.setProperty('--d', `${(2.8 + Math.random() * 1.0).toFixed(2)}s`);
      const size = 38 + Math.round(Math.random() * 16);
      f.style.width = f.style.height = `${size}px`;
      el.append(f);
      this.flying++;
      window.setTimeout(() => {
        f.remove();
        this.flying--;
      }, 4000);
    }, Math.max(0, delay) * 1000);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
