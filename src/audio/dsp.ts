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
  seconds: number;
}

/**
 * Render a struck / plucked note as a sum of decaying (possibly inharmonic) partials with a strike
 * click, optional tine buzz and body resonances. Rendered once per pitch and cached, so a mallet
 * note costs one buffer source at play time. A render costs a few ms, once per pitch.
 */
export function modalBuffer(ctx: BaseAudioContext, freq: number, spec: ModalSpec, rng: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(64, Math.floor(sr * spec.seconds));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
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
  // Short fade at the end of the buffer.
  const f = Math.min(len, Math.floor(sr * 0.06));
  for (let i = 0; i < f; i++) d[len - 1 - i] = d[len - 1 - i]! * (i / f);
  return buf;
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
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * o.seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
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
  // Tiny fade-out at the end of the buffer.
  const f = Math.min(len, Math.floor(sr * 0.02));
  for (let i = 0; i < f; i++) out[len - 1 - i] = out[len - 1 - i]! * (i / f);
  return buf;
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
