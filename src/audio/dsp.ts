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

/** White / pink / brown noise buffers (mono, looping-friendly). */
export function makeNoise(ctx: BaseAudioContext, seconds: number, color: 'white' | 'pink' | 'brown', rng: Rand): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = rng.next() * 2 - 1;
    if (color === 'white') d[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  // Crossfade the loop seam (50 ms) so looping sources never click.
  const fade = Math.min(len >> 2, Math.floor(ctx.sampleRate * 0.05));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i]! * k + d[len - fade + i]! * (1 - k);
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
}

/**
 * Extended Karplus-Strong string, rendered to a buffer in JS (feedback delays inside WebAudio
 * cannot go below one render quantum, i.e. no high notes). Fractional delay via allpass
 * interpolation keeps tuning exact; a DC blocker and peak normalisation make buffers uniform.
 */
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
