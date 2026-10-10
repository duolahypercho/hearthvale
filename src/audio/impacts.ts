/**
 * Material impacts by modal synthesis (round 17, critic r6: "several tool and combat impacts share
 * similarly shaped oscillator-heavy transients and peak near the same limiter ceiling, reducing
 * material identity").
 *
 * What tells a listener *what was struck* is the body that rings after the contact: its modes (how
 * many, how high, how harmonic), how fast each dies (internal damping: wood swallows its highs in
 * milliseconds, stone barely rings at all, steel rings for a second) and how long the contact lasted
 * (a hard tool on a hard body is a 0.2 ms click that excites everything; steel into soil is a 5 ms
 * push that excites nothing above 1 kHz). Each material here is a small modal model:
 *
 *   - the contact force: a raised-cosine pulse of `contact` seconds, whose spectrum rolls the modes
 *     off above ~1 / contact (applied per mode as a gain);
 *   - modes: frequency ratios + per-mode decay from a loss factor (tau = 1 / (pi * f * eta)), so the
 *     highs die first in a lossy material and everything rings in a stiff one;
 *   - a material "texture": fibre crackle for green wood, grit for soil, chips for stone, a wet
 *     gloop for slime, the chitin rattle of a shell;
 *   - for tool strikes, the tool's own head: a few quiet inharmonic steel partials (the "tink").
 *
 * Variants are baked once per AudioContext into short mono buffers (4 per material, ~0.1-0.9 s),
 * spread over idle ticks in real time (`ImpactBank.step`, one buffer per call ≈ 1 ms), all at once
 * offline. Playing one costs one buffer source + gain (+ an optional playbackRate for the per-repeat
 * pitch variation): no oscillators on the frame.
 */
import { Rand } from './dsp';

export type Material = 'wood' | 'stone' | 'soil' | 'steel' | 'flesh' | 'slime' | 'chitin' | 'membrane' | 'ember' | 'crystal';

interface MatSpec {
  seconds: number;
  /** Contact duration (s): longer = softer impact = fewer highs. */
  contact: [number, number];
  /** Fundamental range (Hz). */
  f1: [number, number];
  /** Mode ratios (each jittered by ±jitter). */
  ratios: number[];
  jitter: number;
  /** Loss factor (higher = deader); the decay of mode k is 1 / (pi f_k eta). */
  eta: number;
  /** Mode amplitude roll-off with mode index (amp_k = 1 / (k+1)^rolloff). */
  rolloff: number;
  /** Texture noise level (relative to the modal body) and its band (Hz). */
  texture: number;
  texBand: [number, number];
  /** Texture length (s) and number of grains (0 = a continuous burst). */
  texLen: number;
  texGrains: number;
  /** Pitch glide of the body over its first 60 ms (fraction; slime droops, steel holds). */
  droop: number;
  /** Optional tool-head ring: [freq Hz, tau s, amp] partials added on top. */
  tool?: [number, number, number][];
}

const SPECS: Record<Material, MatSpec> = {
  // Green wood (a trunk / stump under an axe): low, damped, slightly inharmonic log modes; the fibres
  // crackle for ~40 ms as they part.
  wood: { seconds: 0.45, contact: [0.0006, 0.0011], f1: [190, 270], ratios: [1, 2.31, 3.86, 5.12, 7.4, 9.7], jitter: 0.06, eta: 0.03, rolloff: 0.55, texture: 1, texBand: [1100, 4200], texLen: 0.05, texGrains: 18, droop: -0.02, tool: [[2650, 0.05, 0.06], [4180, 0.03, 0.035]] },
  // Rock under a pick: dense, high, very short modes (stone is stiff but the chunk is small and
  // cracked); chips fly for ~80 ms; the steel tip rings brightly over it.
  stone: { seconds: 0.4, contact: [0.0003, 0.0006], f1: [520, 820], ratios: [1, 1.37, 1.93, 2.6, 3.3, 4.1, 5.2], jitter: 0.12, eta: 0.06, rolloff: 0.5, texture: 0.45, texBand: [1400, 4500], texLen: 0.08, texGrains: 9, droop: 0, tool: [[2290, 0.16, 0.1], [3470, 0.11, 0.055], [5310, 0.07, 0.028]] },
  // Soil under a hoe: almost no modes (a soft, lossy body), a long push, a crumbling grit.
  soil: { seconds: 0.35, contact: [0.004, 0.007], f1: [90, 140], ratios: [1, 1.8, 2.9], jitter: 0.15, eta: 0.4, rolloff: 0.5, texture: 0.9, texBand: [500, 2600], texLen: 0.12, texGrains: 26, droop: -0.05, tool: [[3100, 0.025, 0.035]] },
  // Steel on steel (a parry): long, bright, inharmonic bell-plate modes.
  steel: { seconds: 0.95, contact: [0.0002, 0.0003], f1: [1180, 1420], ratios: [1, 1.59, 2.14, 2.83, 3.51, 4.62], jitter: 0.03, eta: 0.0016, rolloff: 0.45, texture: 0.15, texBand: [4000, 9000], texLen: 0.01, texGrains: 0, droop: 0 },
  // A blade into a body (imp / generic flesh): a dull low thump, heavily damped, a slap on the skin.
  flesh: { seconds: 0.3, contact: [0.002, 0.0035], f1: [120, 180], ratios: [1, 1.52, 2.3], jitter: 0.1, eta: 0.25, rolloff: 0.6, texture: 0.5, texBand: [700, 2400], texLen: 0.025, texGrains: 0, droop: -0.12 },
  // Slime: a wobbling gel — a low body that droops in pitch, a wet gloop of bubbles.
  slime: { seconds: 0.5, contact: [0.003, 0.005], f1: [140, 210], ratios: [1, 1.48, 2.05], jitter: 0.08, eta: 0.09, rolloff: 0.8, texture: 0.35, texBand: [500, 1600], texLen: 0.16, texGrains: 7, droop: -0.35 },
  // A crab's shell: hollow chitin — mid modes, short, a dry rattle.
  chitin: { seconds: 0.3, contact: [0.0004, 0.0008], f1: [560, 760], ratios: [1, 1.71, 2.62, 3.9], jitter: 0.08, eta: 0.03, rolloff: 0.5, texture: 0.45, texBand: [1800, 5200], texLen: 0.05, texGrains: 6, droop: 0 },
  // A bat's wing: leathery membrane — a breathy flap with a little resonance.
  membrane: { seconds: 0.25, contact: [0.0015, 0.003], f1: [280, 400], ratios: [1, 2.2], jitter: 0.1, eta: 0.12, rolloff: 0.9, texture: 0.9, texBand: [600, 2000], texLen: 0.06, texGrains: 0, droop: -0.08 },
  // An imp / lava creature: a hot, crackling body (embers spit).
  ember: { seconds: 0.4, contact: [0.0015, 0.0025], f1: [150, 220], ratios: [1, 1.6, 2.4], jitter: 0.1, eta: 0.18, rolloff: 0.6, texture: 0.6, texBand: [1500, 5000], texLen: 0.22, texGrains: 16, droop: -0.06 },
  // A gem / ore crystal: glassy, bright, rings a little.
  crystal: { seconds: 0.6, contact: [0.0002, 0.0003], f1: [1900, 2500], ratios: [1, 2.12, 3.31, 4.75], jitter: 0.04, eta: 0.004, rolloff: 0.5, texture: 0.15, texBand: [5000, 10000], texLen: 0.01, texGrains: 0, droop: 0 },
};

const VARIANTS = 4;

/** Bakes one variant of a material (mono Float32Array at `sr`). */
export function bakeImpact(mat: Material, r: Rand, sr: number): Float32Array {
  const s = SPECS[mat];
  const n = Math.floor(s.seconds * sr);
  const out = new Float32Array(n);
  const contact = r.range(s.contact[0], s.contact[1]);
  const f1 = r.range(s.f1[0], s.f1[1]);
  // Modal body.
  const modes = s.ratios.map((ra, k) => {
    const f = f1 * ra * (1 + r.gauss(s.jitter * 0.5));
    // Contact low-pass: a raised-cosine force pulse of width T has its first spectral null at 2 / T.
    const x = f * contact;
    const sinc = x < 1e-4 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const exc = Math.abs(1 - x * x) < 1e-3 ? 0.5 : Math.max(Math.abs(sinc / (1 - x * x)), 0.004 / (1 + x * x));
    const tau = 1 / (Math.PI * f * s.eta * (1 + 0.25 * k));
    return { f, tau: Math.min(tau, s.seconds * 0.45), amp: (exc / Math.pow(k + 1, s.rolloff)) * r.range(0.75, 1.15), ph: r.next() * 6.283 };
  });
  for (const m of modes) {
    let ph = m.ph;
    const len = Math.min(n, Math.ceil(m.tau * 7 * sr));
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t / m.tau);
      const f = m.f * (1 + s.droop * (1 - Math.exp(-t / 0.06)));
      ph += (6.283185307 * f) / sr;
      // A short rise over the contact (the body is pushed, not switched on).
      const rise = t < contact ? 0.5 - 0.5 * Math.cos((Math.PI * t) / contact) : 1;
      out[i] = out[i]! + Math.sin(ph) * env * m.amp * rise;
    }
  }
  // Tool head ring (steel partials, quiet; a struck tool rings on its own frequencies).
  if (s.tool) {
    for (const [tf, ttau, ta] of s.tool) {
      const f = tf * r.range(0.97, 1.03);
      let ph = r.next() * 6.283;
      const len = Math.min(n, Math.ceil(ttau * 6 * sr));
      for (let i = 0; i < len; i++) {
        ph += (6.283185307 * f) / sr;
        out[i] = out[i]! + Math.sin(ph) * Math.exp(-i / sr / ttau) * ta * (i < 10 ? i / 10 : 1);
      }
    }
  }
  // The contact itself: a noise pulse shaped like the force (what makes a hard hit "click").
  const cl = Math.max(4, Math.floor(contact * sr * 1.6));
  let lp = 0;
  const clA = 1 - Math.exp((-6.283 * Math.min(14000, 1.6 / contact)) / sr);
  for (let i = 0; i < cl && i < n; i++) {
    lp += clA * (r.next() * 2 - 1 - lp);
    out[i] = out[i]! + lp * 0.5 * Math.sin((Math.PI * i) / cl);
  }
  // Texture: band-limited noise, either as a burst or as discrete grains (fibres, grit, chips, bubbles).
  if (s.texture > 0) {
    const [lo, hi] = s.texBand;
    const tl = Math.floor(s.texLen * sr);
    const grain = (at: number, len: number, amp: number, fc: number): void => {
      // A 2-pole resonator driven by noise: cheap band-pass at fc.
      const w = (6.283 * fc) / sr;
      const R = Math.exp((-6.283 * fc * 0.35) / sr);
      const c1 = 2 * R * Math.cos(w);
      const c2 = -R * R;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < len && at + i < n; i++) {
        const y = (r.next() * 2 - 1) * (1 - R) + c1 * y1 + c2 * y2;
        y2 = y1;
        y1 = y;
        const e = Math.exp((-4 * i) / len) * (i < 16 ? i / 16 : 1);
        out[at + i] = out[at + i]! + y * e * amp;
      }
    };
    if (s.texGrains > 0) {
      for (let k = 0; k < s.texGrains; k++) {
        const at = Math.floor(Math.pow(r.next(), 1.6) * tl);
        const fc = lo * Math.pow(hi / lo, r.next());
        grain(at, Math.floor(r.range(0.002, mat === 'slime' ? 0.03 : 0.009) * sr), s.texture * r.range(0.4, 1.1) * (1 - (at / tl) * 0.6) * 4, fc);
      }
    } else {
      grain(0, tl, s.texture * 3, Math.sqrt(lo * hi));
    }
  }
  // Normalise each variant to a common peak (levels are set by the design that plays it), with a
  // 3 ms fade at the end.
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]!));
  const k = pk > 0 ? 0.9 / pk : 1;
  const fade = Math.floor(sr * 0.003);
  for (let i = 0; i < n; i++) out[i] = out[i]! * k * (i > n - fade ? (n - i) / fade : 1);
  return out;
}

const BANKS = new WeakMap<BaseAudioContext, ImpactBank>();

/** Per-context bank of baked impact variants. */
export class ImpactBank {
  private bufs = new Map<Material, AudioBuffer[]>();
  private queue: Material[];
  private rng = new Rand(5309);

  static for(ctx: BaseAudioContext): ImpactBank {
    let b = BANKS.get(ctx);
    if (!b) {
      b = new ImpactBank(ctx);
      BANKS.set(ctx, b);
    }
    return b;
  }

  private constructor(private ctx: BaseAudioContext) {
    // The most played materials first.
    const order: Material[] = ['soil', 'wood', 'stone', 'flesh', 'slime', 'chitin', 'membrane', 'ember', 'steel', 'crystal'];
    this.queue = order.flatMap((m) => new Array<Material>(VARIANTS).fill(m));
  }

  get ready(): boolean {
    return this.queue.length === 0;
  }

  /** Bake up to `count` buffers (real time: one per idle tick). */
  step(count = 1): void {
    for (let i = 0; i < count && this.queue.length; i++) {
      const m = this.queue.shift()!;
      const data = bakeImpact(m, this.rng, this.ctx.sampleRate);
      const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.getChannelData(0).set(data);
      const list = this.bufs.get(m) ?? [];
      list.push(b);
      this.bufs.set(m, list);
    }
  }

  /** A variant of `mat`, or null while it is still being baked. */
  get(mat: Material, r: Rand): AudioBuffer | null {
    const list = this.bufs.get(mat);
    return list?.length ? list[Math.floor(r.next() * list.length)]! : null;
  }
}
