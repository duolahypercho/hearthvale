/**
 * Rainfall built from drops, not from noise (round 16, critic r6: "the farm-rain render resembles a
 * continuous broadband noise carpet ... centroid ~3 kHz, 67 % of its energy above 2.5 kHz").
 *
 * Real rain on a farm is thousands of separate impacts on different materials at different
 * distances: a drop on a leaf rings the leaf (a damped plate mode or two, 0.45-2 kHz, a few ms), a
 * drop on bare soil is a dull low "pat", a drop into a puddle leaves a Minnaert bubble (a sine that
 * chirps upward as the bubble closes), a drop on a fence rail / barrel lid knocks the wood. Near drops
 * are sparse and individually audible; the far field is a dense, softened (air-absorbed) grain.
 *
 * Each layer is a seamless loop (drops wrap round the buffer end) of a few seconds, baked once on
 * the main thread in slices (see `RainBuilder`) so the first shower never costs a frame spike, and
 * played by ONE buffer source per layer — the patter costs no scheduling at all. The adapter adds a
 * handful of scheduled events on top (eave drips, the water butt) that must not repeat with the loop.
 */
import { Rand } from './dsp';

export type RainLayerKind = 'canopy' | 'near' | 'heavy';

interface LayerSpec {
  seconds: number;
  perSec: number;
  /** Distance range of the drops (0 = at the listener's feet, 1 = across the field). */
  dist: [number, number];
  /** Material mix: leaf / soil / puddle / wood weights. */
  mix: [number, number, number, number];
  /** Base amplitude of a median drop. */
  amp: number;
}

/** Loop lengths are mutually prime-ish so the three loops never line up audibly. */
export const RAIN_LAYERS: Record<RainLayerKind, LayerSpec> = {
  // The far field: dense, quiet, darkened by distance — the "air full of rain" without a hiss.
  canopy: { seconds: 5.3, perSec: 300, dist: [0.55, 1], mix: [0.75, 0.15, 0.07, 0.03], amp: 0.055 },
  // The near field: drops you can count, on the crops and the path round the listener.
  near: { seconds: 9.7, perSec: 26, dist: [0.05, 0.55], mix: [0.5, 0.27, 0.17, 0.06], amp: 0.11 },
  // Downpour: comes in with the swell (and in a storm), a busier mid-distance field.
  heavy: { seconds: 7.1, perSec: 90, dist: [0.2, 0.8], mix: [0.55, 0.3, 0.1, 0.05], amp: 0.08 },
};

/** Heavy-tailed drop size: most drops near the median, now and then a fat one (Pareto, capped). */
function dropSize(r: Rand): number {
  const u = r.next();
  return Math.min(3.2, 0.55 * Math.pow(1 - u * 0.985, -1 / 2.4));
}

/**
 * Bakes one rain layer into a stereo loop. `step()` renders up to `budget` drops and returns true when
 * the buffer is complete, so the caller can spread the work over several frames.
 */
export class RainBuilder {
  readonly buffer: AudioBuffer;
  private readonly L: Float32Array;
  private readonly R: Float32Array;
  private readonly len: number;
  private readonly sr: number;
  private readonly total: number;
  private done = 0;
  private readonly spec: LayerSpec;

  constructor(ctx: BaseAudioContext, readonly kind: RainLayerKind, private rng: Rand) {
    this.spec = RAIN_LAYERS[kind];
    this.sr = ctx.sampleRate;
    this.len = Math.floor(this.sr * this.spec.seconds);
    this.buffer = ctx.createBuffer(2, this.len, this.sr);
    this.L = this.buffer.getChannelData(0);
    this.R = this.buffer.getChannelData(1);
    this.total = Math.round(this.spec.perSec * this.spec.seconds);
  }

  get complete(): boolean {
    return this.done >= this.total;
  }

  step(budget = Infinity): boolean {
    const end = Math.min(this.total, this.done + budget);
    for (; this.done < end; this.done++) this.drop();
    return this.complete;
  }

  private drop(): void {
    const r = this.rng;
    const s = this.spec;
    const sr = this.sr;
    const at = Math.floor(r.next() * this.len);
    const dist = r.range(s.dist[0], s.dist[1]);
    // Far drops are quieter (inverse distance, not to zero) and darker (air + foliage absorb the top).
    const atten = 1 / (1 + 2.2 * dist);
    const amp = s.amp * dropSize(r) * atten * r.range(0.7, 1.15);
    // Per-drop one-pole low-pass: ~12 kHz at the feet, ~4 kHz across the field.
    const lpHz = 12000 * Math.pow(0.33, dist);
    const lpA = 1 - Math.exp((-2 * Math.PI * lpHz) / sr);
    const pan = r.range(-1, 1) * (0.55 + 0.45 * dist);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    // A few samples of interaural delay on the far side (width without a phasey comb).
    const itd = Math.round(Math.abs(pan) * 0.00035 * sr);
    const dl = pan > 0 ? itd : 0;
    const dr = pan < 0 ? itd : 0;
    const kind = r.weighted([
      ['leaf', s.mix[0]],
      ['soil', s.mix[1]],
      ['puddle', s.mix[2]],
      ['wood', s.mix[3]],
    ] as const);

    // Modes: [freq Hz, decay tau s, gain, glide (fractional pitch change over the note)].
    const modes: [number, number, number, number][] = [];
    let click = 0.5; // impact transient level (relative)
    let clickLen = Math.round(sr * 0.0007);
    let thud = 0; // low "pat" (soft-ground impact), lowpassed noise
    let thudTau = 0.005;
    if (kind === 'leaf') {
      const f1 = 750 * Math.pow(5.5, r.next());
      modes.push([f1, r.range(0.004, 0.012), 0.8, -0.05]);
      modes.push([f1 * r.range(1.55, 2.4), r.range(0.002, 0.005), 0.4, -0.03]);
      click = 0.45;
    } else if (kind === 'soil') {
      thud = 1;
      thudTau = r.range(0.003, 0.007);
      modes.push([r.range(210, 380), r.range(0.003, 0.006), 0.18, -0.1]);
      click = 0.22;
      clickLen = Math.round(sr * 0.0012);
    } else if (kind === 'puddle') {
      // Minnaert bubble: rises as it closes; only about half the puddle drops trap one.
      if (r.chance(0.55)) modes.push([r.range(1200, 3400), r.range(0.006, 0.016), 0.7, r.range(0.25, 0.55)]);
      click = 0.6;
      thud = 0.25;
      thudTau = 0.003;
    } else {
      const f = r.range(260, 620);
      modes.push([f, r.range(0.012, 0.026), 0.75, -0.01]);
      modes.push([f * r.range(2.6, 2.9), r.range(0.006, 0.012), 0.35, 0]);
      click = 0.5;
    }
    let longest = clickLen;
    for (const m of modes) longest = Math.max(longest, Math.ceil(m[1] * 5 * sr));
    if (thud) longest = Math.max(longest, Math.ceil(thudTau * 5 * sr));
    // Thud: one-pole ~500 Hz over white noise, exponential decay.
    const thA = 1 - Math.exp((-2 * Math.PI * 520) / sr);
    let th = 0;
    let lp = 0;
    let cl = 0;
    const ph = modes.map(() => r.next() * 0.2);
    for (let i = 0; i < longest; i++) {
      const t = i / sr;
      let v = 0;
      if (i < clickLen) {
        cl += 0.75 * (r.next() * 2 - 1 - cl);
        v += cl * click * (1 - i / clickLen);
      }
      if (thud) {
        th += thA * (r.next() * 2 - 1 - th);
        v += th * 0.8 * thud * Math.exp(-t / thudTau);
      }
      for (let k = 0; k < modes.length; k++) {
        const [f, tau, gm, glide] = modes[k]!;
        const env = Math.exp(-t / tau);
        const fi = f * (1 + glide * (1 - env));
        ph[k] = ph[k]! + fi / sr;
        v += Math.sin(2 * Math.PI * ph[k]!) * env * gm * (i < 8 ? i / 8 : 1);
      }
      lp += lpA * (v - lp);
      const o = lp * amp;
      const jl = (at + i + dl) % this.len;
      const jr = (at + i + dr) % this.len;
      this.L[jl] = this.L[jl]! + o * gl;
      this.R[jr] = this.R[jr]! + o * gr;
    }
  }
}

/** Bake a whole layer at once (offline renders, tests). */
export function makeRainLayer(ctx: BaseAudioContext, kind: RainLayerKind, rng: Rand): AudioBuffer {
  const b = new RainBuilder(ctx, kind, rng);
  b.step();
  return b.buffer;
}
