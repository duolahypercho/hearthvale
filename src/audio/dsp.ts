/**
 * Low-level DSP helpers shared by the music engine, ambience and SFX. Everything here is
 * context-agnostic (works on AudioContext and OfflineAudioContext) and deterministic when
 * given a seeded RNG, so offline renders are reproducible.
 */

/** Small, fast seeded RNG (mulberry32). */
export class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  /** Weighted pick: items [value, weight]. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return items[items.length - 1]![0];
  }
  /** Approximately normal (sum of 3 uniforms), mean 0, std ~sigma. */
  gauss(sigma: number): number {
    return (this.next() + this.next() + this.next() - 1.5) * sigma * 2;
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/**
 * White / pink / brown noise buffers, looping-friendly. Mono by default; with `corr` a stereo
 * buffer whose right channel shares that much of the left's source (0 = independent, 1 = mono):
 * ambience beds use ~0.3 so rain, surf and wind fill the stereo field instead of sitting in the
 * middle of the head.
 */
export function makeNoise(ctx: BaseAudioContext, seconds: number, color: 'white' | 'pink' | 'brown', rng: Rand, corr?: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const stereo = corr !== undefined;
  const buf = ctx.createBuffer(stereo ? 2 : 1, len, ctx.sampleRate);
  const chans = stereo ? [buf.getChannelData(0), buf.getChannelData(1)] : [buf.getChannelData(0)];
  const c = clamp(corr ?? 1, 0, 1);
  const k = Math.sqrt(1 - c * c);
  const st = chans.map(() => ({ b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0, last: 0 }));
  for (let i = 0; i < len; i++) {
    const w1 = rng.next() * 2 - 1;
    const w2 = stereo ? rng.next() * 2 - 1 : 0;
    for (let ch = 0; ch < chans.length; ch++) {
      const w = ch === 0 ? w1 : c * w1 + k * w2;
      const z = st[ch]!;
      const d = chans[ch]!;
      if (color === 'white') d[i] = w;
      else if (color === 'pink') {
        // Paul Kellet's refined pink filter.
        z.b0 = 0.99886 * z.b0 + w * 0.0555179;
        z.b1 = 0.99332 * z.b1 + w * 0.0750759;
        z.b2 = 0.969 * z.b2 + w * 0.153852;
        z.b3 = 0.8665 * z.b3 + w * 0.3104856;
        z.b4 = 0.55 * z.b4 + w * 0.5329522;
        z.b5 = -0.7616 * z.b5 - w * 0.016898;
        d[i] = (z.b0 + z.b1 + z.b2 + z.b3 + z.b4 + z.b5 + z.b6 + w * 0.5362) * 0.11;
        z.b6 = w * 0.115926;
      } else {
        z.last = (z.last + 0.02 * w) / 1.02;
        d[i] = z.last * 3.5;
      }
    }
  }
  // Crossfade the loop seam (50 ms) so looping sources never click.
  const fade = Math.min(len >> 2, Math.floor(ctx.sampleRate * 0.05));
  for (const d of chans) {
    for (let i = 0; i < fade; i++) {
      const q = i / fade;
      d[i] = d[i]! * q + d[len - fade + i]! * (1 - q);
    }
  }
  return buf;
}

/**
 * Rain on leaves, roofs and puddles as a loopable stereo texture: `perSecond` individual drops,
 * each a tiny tick plus a damped resonant ping (2–8 kHz, log-spread; a few big drops plop lower on
 * puddles, their pitch falling), scattered across the stereo field with equal-power panning.
 * Rendered once; the ambience loops it and rides its level, so a downpour costs one buffer source.
 */
export function makeRain(ctx: BaseAudioContext, seconds: number, perSecond: number, rng: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const n = Math.round(perSecond * seconds);
  for (let d = 0; d < n; d++) {
    const at = Math.floor(rng.next() * len);
    const pan = rng.next() * 2 - 1;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const big = rng.next() < 0.07;
    const amp = (big ? 0.28 : 0.1 + 0.3 * Math.pow(rng.next(), 2.2)) * (0.6 + 0.4 * rng.next());
    const f0 = big ? 700 + rng.next() * 900 : 2000 * Math.pow(4, rng.next());
    const tau = big ? 0.012 + rng.next() * 0.01 : 0.0007 + rng.next() * 0.0022;
    const m = Math.floor(tau * 6 * sr);
    let ph = rng.next();
    let lpN = 0;
    for (let i = 0; i < m; i++) {
      const t = i / sr;
      const env = Math.exp(-t / tau);
      // Big drops: the bubble's pitch rises as it closes (the "plink" of a puddle).
      const f = big ? f0 * (1 + 1.6 * (1 - env)) : f0;
      ph += f / sr;
      const ping = Math.sin(2 * Math.PI * ph) * env;
      // Impact tick: a few samples of bright noise.
      lpN += 0.6 * ((rng.next() * 2 - 1) - lpN);
      const tick = i < 12 ? (rng.next() * 2 - 1 - lpN) * (1 - i / 12) * 0.7 : 0;
      const v = (ping * (big ? 0.8 : 0.55) + tick) * amp;
      const j = (at + i) % len;
      L[j] = L[j]! + v * gl;
      R[j] = R[j]! + v * gr;
    }
  }
  return buf;
}

export interface IrOptions {
  seconds: number;
  /** Seconds for the tail to fall 60 dB at low frequencies. */
  decay: number;
  /** High-frequency damping (0 = bright plate, 1 = very dark cave). */
  damping: number;
  /** Pre-delay in seconds. */
  predelay: number;
  /** Early-reflection density (0..1). */
  early: number;
  /** Stereo width (0..1). */
  width: number;
}

/**
 * Synthetic stereo impulse response: sparse early reflections followed by a diffuse,
 * exponentially decaying tail whose high frequencies die faster than the lows
 * (a time-varying one-pole lowpass over decorrelated noise), with a soft onset.
 */
export function makeImpulse(ctx: BaseAudioContext, o: IrOptions, rng: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * o.seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(o.predelay * sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  for (let c = 0; c < 2; c++) {
    const ch = c === 0 ? L : R;
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.pow(10, (-3 * t) / o.decay); // -60 dB at `decay`
      const onset = Math.min(1, t / 0.012);
      // Damping grows over time: the tail darkens like a real room.
      const cutoff = clamp(1 - o.damping * (0.35 + 0.65 * Math.min(1, t / o.decay)), 0.04, 1);
      const w = rng.next() * 2 - 1;
      lp += cutoff * (w - lp);
      ch[i] = lp * env * onset * (0.6 + 0.4 * cutoff);
    }
    // Early reflections: a handful of discrete taps in the first 80 ms.
    const taps = Math.floor(6 + o.early * 14);
    for (let k = 0; k < taps; k++) {
      const t = 0.004 + rng.next() * 0.075;
      const idx = pre + Math.floor(t * sr);
      if (idx < len) ch[idx] = ch[idx]! + (rng.next() < 0.5 ? -1 : 1) * (0.5 - t * 4) * o.early;
    }
  }
  // Width: blend toward mid.
  const w = clamp(o.width, 0, 1);
  for (let i = 0; i < len; i++) {
    const m = (L[i]! + R[i]!) * 0.5;
    L[i] = m + (L[i]! - m) * w;
    R[i] = m + (R[i]! - m) * w;
  }
  // Normalise energy so reverbs of different lengths sit at similar loudness.
  let e = 0;
  for (let i = 0; i < len; i++) e += L[i]! * L[i]! + R[i]! * R[i]!;
  const norm = 1 / Math.sqrt(e / 2 + 1e-9) * 0.9;
  for (let i = 0; i < len; i++) {
    L[i] = L[i]! * norm;
    R[i] = R[i]! * norm;
  }
  return buf;
}

export interface PluckOptions {
  /** 0 = dark/felt, 1 = bright/nail. */
  brightness: number;
  /** Seconds for the note to decay 60 dB. */
  decay: number;
  /** Pluck position along the string (0.05..0.5); lower = thinner, brighter. */
  position: number;
  seconds: number;
  /** Body resonances mixed onto the string: [Hz, Q, gain]. */
  body?: readonly (readonly [number, number, number])[];
  /** Air-cavity "thump" under the string: a damped sine [Hz, tau s, amp re the 0.9 peak]. */
  thump?: readonly [number, number, number];
}

/** One biquad bandpass (constant 0 dB peak) for offline JS rendering. */
class Bp {
  private b0: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(sr: number, f: number, q: number) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = al / a0;
    this.b2 = -al / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - al) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Mix body resonances onto a mono signal in place: y = x + Σ gain·bandpass(x). */
export function applyBody(d: Float32Array, sr: number, modes: readonly (readonly [number, number, number])[]): void {
  const fs = modes.map(([f, q]) => new Bp(sr, f, q));
  for (let i = 0; i < d.length; i++) {
    const x = d[i]!;
    let y = x;
    for (let k = 0; k < fs.length; k++) y += fs[k]!.run(x) * modes[k]![2];
    d[i] = y;
  }
}

/** A modal partial for pre-rendered struck/plucked notes. */
export interface ModalPartial {
  /** Frequency ratio to the fundamental. */
  r: number;
  amp: number;
  /** Decay time constant (s). */
  tau: number;
  /** Attack (s) — >0 blooms in. */
  atk?: number;
  /** Beating twin: frequency offset in Hz and relative amplitude. */
  beat?: [number, number];
}

export interface ModalSpec {
  partials: ModalPartial[];
  /** Initial pitch offset in cents that settles over `glideTime` (tines, pans). */
  glide?: number;
  glideTime?: number;
  /** Strike noise: amplitude, decay tau, one-pole lowpass cutoff (Hz). */
  click?: { amp: number; tau: number; lp: number; hp?: number };
  /** Metallic buzz (tine rattle): noise gated by the waveform, amplitude + tau. */
  buzz?: { amp: number; tau: number };
  body?: readonly (readonly [number, number, number])[];
  /** Air-cavity thump [Hz, tau s, amp] (see addThump). */
  thump?: readonly [number, number, number];
  seconds: number;
}

/**
 * Render a struck / plucked note as a sum of decaying (possibly inharmonic) partials with a strike
 * click, optional tine buzz and body resonances. Rendered once per pitch and cached, so a mallet
 * note costs one buffer source at play time. A render costs 5–40 ms, once per pitch — in real time
 * it runs in the compose worker (compose.worker.ts); `modalData` is the pure, context-free part.
 */
export function modalBuffer(ctx: BaseAudioContext, freq: number, spec: ModalSpec, rng: Rand): AudioBuffer {
  return toBuffer(ctx, modalData(ctx.sampleRate, freq, spec, rng), ctx.sampleRate);
}

/** Mono samples → AudioBuffer (cheap: one copy). `sr` may differ from the context's (it resamples). */
/** Float → 16-bit with a per-note scale (worker and graph). */
export function packNote(f: Float32Array): { d: Int16Array<ArrayBuffer>; scale: number } {
  let peak = 0;
  for (let i = 0; i < f.length; i++) {
    const a = Math.abs(f[i]!);
    if (a > peak) peak = a;
  }
  const scale = peak > 0 ? peak / 32767 : 1;
  const inv = 1 / scale;
  const d = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) d[i] = Math.round(f[i]! * inv);
  return { d, scale };
}

export function toBuffer(ctx: BaseAudioContext, d: Float32Array, sr: number): AudioBuffer {
  const buf = ctx.createBuffer(1, d.length, sr);
  buf.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
  return buf;
}

export function modalData(sr: number, freq: number, spec: ModalSpec, rng: Rand): Float32Array<ArrayBuffer> {
  const len = Math.max(64, Math.floor(sr * spec.seconds));
  const d = new Float32Array(len);
  const gl = spec.glide ? Math.pow(2, spec.glide / 1200) - 1 : 0;
  const glT = Math.max(0.001, spec.glideTime ?? 0.03);
  for (const p of spec.partials) {
    const layers: [number, number][] = [[p.r * freq, p.amp]];
    if (p.beat) layers.push([p.r * freq + p.beat[0], p.amp * p.beat[1]]);
    for (const [f, amp] of layers) {
      if (f >= sr * 0.45 || amp < 1e-5) continue;
      let ph = rng.next() * 0.3;
      const dec = Math.exp(-1 / (p.tau * sr));
      let env = 1;
      const atkN = Math.max(1, Math.floor((p.atk ?? 0.0015) * sr));
      const n = Math.min(len, Math.floor(p.tau * 8 * sr) + atkN);
      const glN = gl ? Math.floor(glT * 4 * sr) : 0;
      if (!gl) {
        // Fixed pitch: a two-multiply sine recurrence instead of Math.sin per sample (≈5× faster,
        // which matters for long, many-partial notes like the piano's).
        const w = (2 * Math.PI * f) / sr;
        const c2 = 2 * Math.cos(w);
        let s1 = Math.sin(2 * Math.PI * ph);
        let s0 = Math.sin(2 * Math.PI * ph - w);
        for (let i = 0; i < n; i++) {
          const a = i < atkN ? i / atkN : 1;
          d[i] = d[i]! + s1 * amp * env * a;
          if (i >= atkN) env *= dec;
          const s2 = c2 * s1 - s0;
          s0 = s1;
          s1 = s2;
        }
        continue;
      }
      for (let i = 0; i < n; i++) {
        const fi = gl && i < glN ? f * (1 + gl * Math.exp(-i / (glT * sr))) : f;
        ph += fi / sr;
        if (ph > 1) ph -= 1;
        const a = i < atkN ? i / atkN : 1;
        d[i] = d[i]! + Math.sin(2 * Math.PI * ph) * amp * env * a;
        if (i >= atkN) env *= dec;
      }
    }
  }
  if (spec.buzz) {
    const dec = Math.exp(-1 / (spec.buzz.tau * sr));
    let env = spec.buzz.amp;
    let ph = 0;
    let lp = 0;
    const n = Math.min(len, Math.floor(spec.buzz.tau * 7 * sr));
    for (let i = 0; i < n; i++) {
      ph += freq / sr;
      if (ph > 1) ph -= 1;
      // Rattle: bright noise let through in short bursts once per cycle.
      const gate = Math.pow(Math.max(0, Math.sin(2 * Math.PI * ph)), 8);
      const w = rng.next() * 2 - 1;
      lp += 0.5 * (w - lp);
      d[i] = d[i]! + (w - lp) * gate * env;
      env *= dec;
    }
  }
  if (spec.click) {
    const c = spec.click;
    const dec = Math.exp(-1 / (c.tau * sr));
    const k = 1 - Math.exp((-2 * Math.PI * c.lp) / sr);
    const kh = c.hp ? 1 - Math.exp((-2 * Math.PI * c.hp) / sr) : 0;
    let env = c.amp;
    let lp = 0;
    let hpLp = 0;
    const n = Math.min(len, Math.floor(c.tau * 8 * sr));
    for (let i = 0; i < n; i++) {
      lp += k * (rng.next() * 2 - 1 - lp);
      let x = lp;
      if (kh) {
        hpLp += kh * (x - hpLp);
        x -= hpLp;
      }
      d[i] = d[i]! + x * env * 2.5;
      env *= dec;
    }
  }
  if (spec.body?.length) applyBody(d, sr, spec.body);
  if (spec.thump) addThump(d, sr, spec.thump[0], spec.thump[1], spec.thump[2]);
  // Short fade at the end of the buffer.
  const f = Math.min(len, Math.floor(sr * 0.06));
  for (let i = 0; i < f; i++) d[len - 1 - i] = d[len - 1 - i]! * (i / f);
  return d;
}

export type BodyKind = 'violin' | 'cello' | 'guitar';

/**
 * Instrument-body impulse response: a sum of damped modes (air cavity, top/back plate modes and
 * the violin's bridge hill around 2–3 kHz) plus a whisper of diffuse noise, energy-normalised.
 * Convolving a bowed oscillator with it gives the formant structure and "wood" of a real body.
 */
export function bodyImpulse(ctx: BaseAudioContext, kind: BodyKind, rng: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  // [Hz, decay tau (s), peak gain at resonance (linear, on top of the direct sound)]
  const modes: [number, number, number][] =
    kind === 'violin'
      ? [[275, 0.025, 1.3], [440, 0.02, 1.1], [540, 0.018, 0.9], [790, 0.012, 0.6], [1050, 0.01, 0.6], [2300, 0.005, 1.1], [2900, 0.004, 1.3], [3600, 0.004, 0.6]]
      : kind === 'cello'
        ? [[98, 0.03, 0.9], [185, 0.025, 1.1], [220, 0.022, 0.9], [395, 0.018, 0.9], [590, 0.014, 0.7], [1100, 0.008, 0.6], [2000, 0.005, 0.6]]
        : [[100, 0.03, 0.8], [205, 0.025, 1], [400, 0.018, 0.6], [560, 0.014, 0.4], [1200, 0.008, 0.4], [2600, 0.004, 0.4]];
  const len = Math.floor(sr * 0.12);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    d[0] = 1; // direct sound
    for (const [f, tau, gpk] of modes) {
      const ff = f * (1 + (rng.next() - 0.5) * 0.04);
      const a = (gpk * 2) / (tau * sr); // a damped sinusoid's gain at resonance ≈ a·tau·sr/2
      const ph = rng.next() * 0.4;
      for (let i = 1; i < len; i++) d[i] = d[i]! + a * Math.sin((2 * Math.PI * ff * i) / sr + ph) * Math.exp(-i / (tau * sr));
    }
    for (let i = 1; i < len; i++) d[i] = d[i]! + (rng.next() * 2 - 1) * 0.004 * Math.exp(-i / (0.006 * sr));
  }
  return buf;
}

export function pluckBuffer(ctx: BaseAudioContext, freq: number, o: PluckOptions, rng: Rand): AudioBuffer {
  return toBuffer(ctx, pluckData(ctx.sampleRate, freq, o, rng), ctx.sampleRate);
}

/** Karplus-Strong string, context-free (the compose worker renders these ahead of time). */
export function pluckData(sr: number, freq: number, o: PluckOptions, rng: Rand): Float32Array<ArrayBuffer> {
  const len = Math.floor(sr * o.seconds);
  const out = new Float32Array(len);
  // Loop filter: y = (1-s)*x[n] + s*x[n-1] has phase delay s samples at low freq.
  const s = 0.5 - 0.35 * o.brightness; // smoothing (brighter = less smoothing)
  const period = sr / freq;
  const N = Math.max(2, Math.floor(period - s - 0.001));
  const frac = period - s - N; // remaining fractional delay → first-order allpass
  const ap = (1 - frac) / (1 + frac);
  // Loss per period to hit the requested T60, compensating the smoothing filter's loss.
  const lpGain = Math.abs((1 - s) + s * Math.cos((2 * Math.PI * freq) / sr));
  const g = Math.min(0.99995, Math.pow(10, -3 / (o.decay * freq)) / Math.max(0.2, lpGain));
  const line = new Float32Array(N);
  // Excitation: noise, lowpassed by brightness, comb-filtered by pluck position.
  let lp = 0;
  const exc = new Float32Array(N);
  const k = 0.15 + 0.85 * o.brightness;
  for (let i = 0; i < N; i++) {
    lp += k * (rng.next() * 2 - 1 - lp);
    exc[i] = lp;
  }
  const pp = Math.max(1, Math.round(N * clamp(o.position, 0.02, 0.5)));
  for (let i = 0; i < N; i++) line[i] = exc[i]! - (i >= pp ? exc[i - pp]! : 0) * 0.9;
  let idx = 0;
  let prev = 0;
  let apX = 0, apY = 0;
  let dcX = 0, dcY = 0;
  let peak = 1e-6;
  for (let n = 0; n < len; n++) {
    const x = line[idx]!;
    const y = (1 - s) * x + s * prev;
    prev = x;
    // allpass fractional delay
    const a = ap * y + apX - ap * apY;
    apX = y;
    apY = a;
    line[idx] = a * g;
    idx = idx + 1 === N ? 0 : idx + 1;
    // DC blocker
    const d = x - dcX + 0.995 * dcY;
    dcX = x;
    dcY = d;
    out[n] = d;
    const ad = Math.abs(d);
    if (ad > peak) peak = ad;
  }
  if (o.body?.length) {
    applyBody(out, sr, o.body);
    peak = 1e-6;
    for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(out[n]!));
  }
  const norm = 0.9 / peak;
  for (let n = 0; n < len; n++) out[n] = out[n]! * norm;
  if (o.thump) addThump(out, sr, o.thump[0], o.thump[1], o.thump[2]);
  // The note cache holds every pitch a song plays: drop the inaudible tail (below -62 dB re the
  // peak), so a high harp note costs ~1 s of samples instead of the instrument's 4 s budget.
  const keep = audibleLength(out, sr, 0.9 * 8e-4);
  const res = keep < len ? out.slice(0, keep) : out;
  // Tiny fade-out at the end of the buffer.
  const f = Math.min(res.length, Math.floor(sr * 0.02));
  for (let i = 0; i < f; i++) res[res.length - 1 - i] = res[res.length - 1 - i]! * (i / f);
  return res;
}

/** Samples up to the last one above `floor` (+ 50 ms), at least 0.15 s. */
export function audibleLength(d: Float32Array, sr: number, floor: number): number {
  let last = 0;
  for (let i = d.length - 1; i >= 0; i--) {
    if (Math.abs(d[i]!) > floor) {
      last = i;
      break;
    }
  }
  return Math.min(d.length, Math.max(Math.floor(sr * 0.15), last + Math.floor(sr * 0.05)));
}

/**
 * Body "thump": the instrument's air cavity answering the pluck / strike — a damped sine at the
 * Helmholtz resonance (90–180 Hz) with a 3 ms onset. This is the warm bottom a real guitar, harp
 * or kalimba box gives every note, which a string or tine alone (fundamental above 250 Hz) lacks.
 * Rescales the buffer if the sum would exceed 0.95.
 */
export function addThump(d: Float32Array, sr: number, hz: number, tau: number, amp: number): void {
  const n = Math.min(d.length, Math.floor(tau * 7 * sr));
  const w = (2 * Math.PI * hz) / sr;
  const dec = Math.exp(-1 / (tau * sr));
  const atk = Math.floor(0.003 * sr);
  let env = amp;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = i < atk ? i / atk : 1;
    d[i] = d[i]! + Math.sin(w * i) * env * a;
    if (i >= atk) env *= dec;
  }
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 0.95) {
    const k = 0.95 / peak;
    for (let i = 0; i < d.length; i++) d[i] = d[i]! * k;
  }
}

/** Bowed-string render options (see bowedData). */
export interface BowOptions {
  /** Bow pressure 0..1: higher = grittier, brighter Helmholtz corner. */
  pressure: number;
  /** Bow speed 0..1 (sets the bow velocity, i.e. the dynamic the note is rendered at). */
  force: number;
  /** Bow contact point as a fraction of the string from the bridge (0.06–0.2; nearer = brighter). */
  position: number;
  /** Bow attack (s): how long the bow takes to reach full speed. */
  attack: number;
  /** String loss filter pole (0.5–0.8; higher = darker, faster-decaying upper partials). */
  pole: number;
  seconds: number;
}

/** The sustain loop every bowed buffer carries (s): playback loops [start, end) for long notes. */
export const BOW_LOOP: readonly [number, number] = [0.6, 1.45];
/** Loop end for a pitch: BOW_LOOP[0] + a whole number of periods, at most BOW_LOOP[1]. */
export function bowLoopEnd(freq: number): number {
  const span = BOW_LOOP[1] - BOW_LOOP[0];
  return BOW_LOOP[0] + Math.floor(span * freq) / freq;
}

/**
 * A bowed string, physically modelled: a digital waveguide (bridge and nut delay lines with a
 * lossy bridge reflection) driven by a stick-slip bow — the friction curve lets the string stick
 * to the hair and slip back once per period, which is what builds the Helmholtz sawtooth and its
 * scratchy, slightly irregular onset (after J. O. Smith / STK "Bowed"). The bow speed and pressure
 * wander a little (a real arm is never steady), so the sustain carries the faint noise and jitter
 * of rosin instead of a periodic oscillator's stillness. The pitch is measured in the sustain and
 * the buffer resampled onto the exact target frequency, then the sustain region (BOW_LOOP) is
 * crossfaded into a seamless loop so a note of any length can be played from one buffer. The body
 * (violin / cello formants) is NOT baked in: it is a fixed filter bank on the track (INSERTS), so
 * vibrato sweeps the harmonics through fixed resonances — the shimmer that makes a string sound real.
 */
export function bowedData(sr: number, freq: number, o: BowOptions, rng: Rand): Float32Array<ArrayBuffer> {
  const len = Math.floor(sr * o.seconds);
  const raw = new Float32Array(len + 64);
  const total = sr / freq;
  const base = Math.max(8, total - 3);
  const beta = clamp(o.position, 0.04, 0.3);
  const bridgeLen = base * beta;
  const neckLen = base * (1 - beta);
  const N = Math.ceil(base) + 4;
  const bridge = new Float32Array(N);
  const neck = new Float32Array(N);
  let wb = 0, wn = 0;
  const read = (buf: Float32Array, w: number, d: number): number => {
    let p = w - d;
    while (p < 0) p += N;
    const i = Math.floor(p);
    const fr = p - i;
    return buf[i % N]! * (1 - fr) + buf[(i + 1) % N]! * fr;
  };
  const pole = clamp(o.pole, 0.3, 0.9);
  let filt = 0;
  const slope0 = 5 - 4 * clamp(o.pressure, 0, 1);
  const maxVel = 0.03 + 0.2 * clamp(o.force, 0, 1);
  const atkN = Math.max(1, Math.floor(o.attack * sr));
  // Slow arm wander (two smoothed random walks) + fast hair noise.
  let wanderV = 0, wanderP = 0, nz = 0;
  for (let n = 0; n < raw.length; n++) {
    const env = n < atkN ? Math.pow(n / atkN, 0.8) : 0.92 + 0.08 * Math.exp(-(n - atkN) / (0.08 * sr));
    if ((n & 255) === 0) {
      // (Kept inside the Helmholtz regime: wider wander tips the string into double slip, which
      // sounds an octave up.)
      wanderV = clamp(wanderV * 0.96 + rng.gauss(0.006), -0.04, 0.04);
      wanderP = clamp(wanderP * 0.97 + rng.gauss(0.015), -0.12, 0.12);
    }
    nz += 0.3 * (rng.next() * 2 - 1 - nz);
    const bowVel = maxVel * env * (1 + wanderV + nz * 0.02);
    const slope = slope0 * (1 + wanderP);
    const bOut = read(bridge, wb, bridgeLen);
    const nOut = read(neck, wn, neckLen);
    // Lossy bridge reflection (one-pole lowpass, gain 0.95), inverting.
    filt = (1 - pole) * 0.95 * bOut + pole * filt;
    const bridgeRefl = -filt;
    const nutRefl = -nOut;
    const strVel = bridgeRefl + nutRefl;
    const dv = bowVel - strVel;
    // Friction curve: sticks (≈1) near zero slip velocity, lets go as the slip grows.
    let k = Math.abs((dv + 0.001) * slope) + 0.75;
    k = 1 / (k * k * k * k);
    k = k < 0.01 ? 0.01 : k > 0.98 ? 0.98 : k;
    const nv = dv * k;
    wb = (wb + 1) % N;
    wn = (wn + 1) % N;
    neck[wn] = bridgeRefl + nv;
    bridge[wb] = nutRefl + nv;
    raw[n] = bOut;
  }
  // DC block.
  let x1 = 0, y1 = 0;
  for (let n = 0; n < raw.length; n++) {
    const y = raw[n]! - x1 + 0.997 * y1;
    x1 = raw[n]!;
    raw[n] = y1 = y;
  }
  // Measure the sounding period in the sustain (normalised autocorrelation around the nominal
  // period, parabolic peak), then resample so the buffer plays exactly at `freq`.
  const a0 = Math.floor(0.45 * sr);
  const W = Math.min(Math.floor(0.08 * sr), raw.length - a0 - Math.ceil(total * 1.2) - 2);
  let bestLag = total;
  if (W > 64) {
    const corr = (lag: number): number => {
      let s = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < W; i++) {
        const x = raw[a0 + i]!, y = raw[a0 + i + lag]!;
        s += x * y;
        e1 += x * x;
        e2 += y * y;
      }
      return s / Math.sqrt(e1 * e2 + 1e-12);
    };
    const lo = Math.max(2, Math.floor(total * 0.94)), hi = Math.ceil(total * 1.06);
    let bi = lo, bv = -2;
    const cs: number[] = [];
    for (let l = lo; l <= hi; l++) {
      const c = corr(l);
      cs.push(c);
      if (c > bv) {
        bv = c;
        bi = l;
      }
    }
    const j = bi - lo;
    if (j > 0 && j < cs.length - 1) {
      const c0 = cs[j - 1]!, c1 = cs[j]!, c2 = cs[j + 1]!;
      const den = c0 - 2 * c1 + c2;
      bestLag = bi + (den !== 0 ? (0.5 * (c0 - c2)) / den : 0);
    } else bestLag = bi;
  }
  const step = bestLag / total; // > 1: rendered flat → read faster
  const out = new Float32Array(len);
  for (let n = 0; n < len; n++) {
    const p = n * step;
    const i = Math.floor(p);
    if (i + 1 >= raw.length) break;
    const fr = p - i;
    out[n] = raw[i]! * (1 - fr) + raw[i + 1]! * fr;
  }
  let peak = 1e-6;
  for (let n = Math.floor(0.2 * sr); n < len; n++) peak = Math.max(peak, Math.abs(out[n]!));
  const norm = 0.6 / peak;
  for (let n = 0; n < len; n++) out[n] = clamp(out[n]! * norm, -0.98, 0.98);
  // Seamless sustain loop: the loop's last 120 ms crossfade into what precedes its start, so
  // jumping back from loop end to loop start continues the waveform.
  // The loop is a whole number of periods long (the playback loop end is snapped the same way,
  // see bowLoopEnd), so the two sides of the crossfade are in phase and a linear fade is seamless.
  const ls = Math.round(BOW_LOOP[0] * sr);
  const le = Math.min(len, Math.round(bowLoopEnd(freq) * sr));
  const X = Math.min(Math.floor(0.12 * sr), ls);
  for (let i = 0; i < X; i++) {
    const w = i / X;
    const a = le - X + i;
    out[a] = out[a]! * (1 - w) + out[ls - X + i]! * w;
  }
  return out;
}

/** Periodic wave from harmonic amplitudes (index 0 = fundamental). */
export function harmonicWave(ctx: BaseAudioContext, amps: number[]): PeriodicWave {
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  for (let i = 0; i < amps.length; i++) imag[i + 1] = amps[i]!;
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Soft-knee saturation curve for the final safety clipper (linear to `knee`, smooth to `ceil`). */
export function softClipCurve(knee = 0.82, ceil = 0.985, n = 4096): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    let y: number;
    if (a <= knee) y = a;
    else {
      const over = (a - knee) / (1 - knee);
      y = knee + (ceil - knee) * Math.tanh(over * 1.6) / Math.tanh(1.6);
    }
    c[i] = Math.sign(x) * y;
  }
  return c;
}
