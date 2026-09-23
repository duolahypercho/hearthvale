/**
 * Synthesised instruments. Every instrument is a function that schedules one note at absolute
 * context time `t` into `dest` (a track input). Timbres are built from:
 *   - modal / additive sines (kalimba, marimba, music box, steel pan, bells),
 *   - FM (electric piano, bells, glass),
 *   - band-limited periodic waves + formant EQ + delayed vibrato (flute, clarinet, cello, fiddle, accordion),
 *   - Karplus-Strong string buffers rendered in JS (nylon guitar, harp, ukulele, upright bass, pizzicato),
 *   - filtered noise (breath, bow, mallet, percussion).
 * Levels are normalised so a velocity-1 note of any instrument peaks around -6 dBFS before track trims.
 */
import type { AudioGraph } from './graph';
import { clamp, harmonicWave, mtof } from './dsp';

export interface NoteOpts {
  /** Previous pitch for a legato glide (portamento). */
  from?: number;
  /** Articulation hints from the composer. */
  art?: 'legato' | 'staccato' | 'accent' | 'roll';
  /** Per-note random detune in cents. */
  detune?: number;
}

export type InstrumentFn = (g: AudioGraph, dest: AudioNode, t: number, midi: number, dur: number, vel: number, o?: NoteOpts) => void;

// ─────────────────────────────────────────────────────────── helpers

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
function wave(ctx: BaseAudioContext, name: string, amps: () => number[]): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  let w = m.get(name);
  if (!w) m.set(name, (w = harmonicWave(ctx, amps())));
  return w;
}

function sine(g: AudioGraph, f: number, t: number, stop: number): OscillatorNode {
  const o = g.ctx.createOscillator();
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(stop);
  return o;
}

function gain(g: AudioGraph, v = 0): GainNode {
  const n = g.ctx.createGain();
  n.gain.value = v;
  return n;
}

function filter(g: AudioGraph, type: BiquadFilterType, f: number, q = 0.707, gainDb = 0): BiquadFilterNode {
  const b = g.ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  b.gain.value = gainDb;
  return b;
}

/** Percussive modal partial: instant attack, exponential decay (time constant tau). */
function partial(g: AudioGraph, dest: AudioNode, f: number, t: number, amp: number, tau: number, attack = 0.002): void {
  if (f > g.ctx.sampleRate * 0.45 || amp < 1e-4) return;
  const stop = t + attack + tau * 7;
  const o = sine(g, f, t, stop);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(amp, t + attack);
  a.gain.setTargetAtTime(0, t + attack, tau);
  o.connect(a).connect(dest);
}

/** Short filtered noise burst. */
export function noiseHit(
  g: AudioGraph,
  dest: AudioNode,
  t: number,
  o: { type?: BiquadFilterType; f: number; q?: number; amp: number; attack?: number; tau: number; buf?: AudioBuffer; rate?: number; f1?: number },
): void {
  const src = g.ctx.createBufferSource();
  src.buffer = o.buf ?? g.white;
  src.playbackRate.value = o.rate ?? 1;
  const bf = filter(g, o.type ?? 'bandpass', o.f, o.q ?? 1);
  const attack = o.attack ?? 0.002;
  if (o.f1) bf.frequency.exponentialRampToValueAtTime(o.f1, t + attack + o.tau * 3);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(o.amp, t + attack);
  a.gain.setTargetAtTime(0, t + attack, o.tau);
  src.connect(bf).connect(a).connect(dest);
  const len = src.buffer.duration;
  src.start(t, g.rng.next() * (len - 1));
  src.stop(t + attack + o.tau * 7);
}

/**
 * Delayed vibrato LFO on a frequency param. With `amp` (a unity gain node in the voice's chain)
 * the same LFO also breathes the level a few percent, as a wind player's vibrato does.
 */
function vibrato(g: AudioGraph, param: AudioParam, t: number, dur: number, f: number, rate: number, depth: number, delay: number, amp?: { node: GainNode; depth: number }): void {
  if (dur < delay + 0.15) return;
  const lfo = sine(g, rate * (0.95 + g.rng.next() * 0.1), t, t + dur + 0.6);
  const d = gain(g);
  d.gain.setValueAtTime(0, t);
  d.gain.setValueAtTime(0, t + delay);
  d.gain.linearRampToValueAtTime(f * depth, t + delay + 0.35);
  lfo.connect(d).connect(param);
  if (amp) {
    const ad = gain(g);
    ad.gain.setValueAtTime(0, t + delay);
    ad.gain.linearRampToValueAtTime(amp.depth, t + delay + 0.45);
    lfo.connect(ad).connect(amp.node.gain);
  }
}

/** Tongued onset: the pitch settles from a few cents flat, like a real breath attack. */
function scoop(param: AudioParam, t: number, f: number, cents: number, time: number): void {
  param.setValueAtTime(f * Math.pow(2, -cents / 1200), t);
  param.exponentialRampToValueAtTime(f, t + time);
}

function glide(param: AudioParam, t: number, f: number, from: number | undefined, time: number): void {
  if (from !== undefined && Math.abs(from) > 0) {
    param.setValueAtTime(mtof(from), t);
    param.exponentialRampToValueAtTime(f, t + time);
  } else param.setValueAtTime(f, t);
}

/** Sustained-voice amp envelope: attack, settle, hold, release (tau). */
function sustainEnv(p: AudioParam, t: number, dur: number, v: number, attack: number, settle: number, rel: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(v, t + attack);
  p.setTargetAtTime(v * settle, t + attack, 0.12);
  const end = t + Math.max(dur, attack + 0.02);
  p.setTargetAtTime(0, end, rel);
  return end + rel * 7;
}

// ─────────────────────────────────────────────────────────── plucked / struck

export const kalimba: InstrumentFn = (g, dest, t, m, _dur, v, o) => {
  const f = mtof(m) * Math.pow(2, (o?.detune ?? 0) / 1200);
  const tau = clamp(0.62 - (m - 60) * 0.014, 0.18, 0.8);
  const stop = t + tau * 7;
  const osc = sine(g, f * 1.006, t, stop);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.035);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.8, t + 0.003);
  a.gain.setTargetAtTime(0, t + 0.003, tau);
  osc.connect(a).connect(dest);
  partial(g, dest, f * 2.01, t, v * 0.05, tau * 0.25);
  partial(g, dest, f * 6.24, t, v * 0.16, 0.035);
  noiseHit(g, dest, t, { f: 2800, q: 1.2, amp: v * 0.06, tau: 0.006 });
};

export const marimba: InstrumentFn = (g, dest, t, m, dur, v, o) => {
  const f = mtof(m);
  const tau = clamp(0.5 - (m - 60) * 0.013, 0.12, 0.75);
  const strike = (tt: number, vv: number): void => {
    partial(g, dest, f, tt, vv * 0.8, tau);
    partial(g, dest, f * 3.99, tt, vv * 0.22, tau * 0.18);
    partial(g, dest, f * 9.85, tt, vv * 0.05, tau * 0.06);
    noiseHit(g, dest, tt, { type: 'lowpass', f: 1400, amp: vv * 0.12, tau: 0.008, buf: g.pink });
  };
  if ((o?.art === 'roll' || o?.art === 'legato') && dur > 0.5) {
    // Tremolo roll on long notes, as real marimbists do.
    const step = 0.072;
    let k = 0;
    for (let tt = t; tt < t + dur - 0.05; tt += step, k++) strike(tt + g.rng.gauss(0.004), v * (k === 0 ? 1 : k % 2 ? 0.58 : 0.68) * (1 - 0.25 * ((tt - t) / dur)));
  } else strike(t, v);
};

export const musicBox: InstrumentFn = (g, dest, t, m, _dur, v, o) => {
  const f = mtof(m) * Math.pow(2, ((o?.detune ?? 0) + g.rng.gauss(3)) / 1200);
  const tau = clamp(0.75 - (m - 72) * 0.02, 0.22, 1.0);
  partial(g, dest, f, t, v * 0.7, tau, 0.001);
  partial(g, dest, f * 2.0, t, v * 0.12, tau * 0.45, 0.001);
  partial(g, dest, f * 4.16, t, v * 0.09, tau * 0.12, 0.001);
  partial(g, dest, f * 7.1, t, v * 0.04, 0.03, 0.001);
  noiseHit(g, dest, t, { type: 'highpass', f: 6000, amp: v * 0.05, tau: 0.004 });
};

export const bell: InstrumentFn = (g, dest, t, m, _dur, v) => {
  // Chowning FM bell: inharmonic ratio, decaying index.
  const f = mtof(m);
  const tau = clamp(1.1 - (m - 72) * 0.025, 0.35, 1.5);
  const stop = t + tau * 7;
  const car = sine(g, f, t, stop);
  const mod = sine(g, f * 3.5, t, stop);
  const idx = gain(g);
  idx.gain.setValueAtTime(f * 1.8 * v, t);
  idx.gain.setTargetAtTime(f * 0.15, t, tau * 0.35);
  mod.connect(idx).connect(car.frequency);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.55, t + 0.002);
  a.gain.setTargetAtTime(0, t + 0.002, tau);
  car.connect(a).connect(dest);
  partial(g, dest, f * 2.76, t, v * 0.06, tau * 0.3);
};

export const celesta: InstrumentFn = (g, dest, t, m, _dur, v) => {
  const f = mtof(m);
  const tau = clamp(0.7 - (m - 72) * 0.02, 0.2, 0.9);
  partial(g, dest, f, t, v * 0.7, tau, 0.001);
  partial(g, dest, f * 4.0, t, v * 0.12, tau * 0.12, 0.001);
  partial(g, dest, f * 2.0, t, v * 0.05, tau * 0.3, 0.001);
  noiseHit(g, dest, t, { type: 'lowpass', f: 2500, amp: v * 0.04, tau: 0.005, buf: g.pink });
};

export const steelPan: InstrumentFn = (g, dest, t, m, _dur, v) => {
  const f = mtof(m);
  const tau = clamp(0.55 - (m - 64) * 0.012, 0.18, 0.65);
  const stop = t + tau * 7;
  const car = sine(g, f * 1.012, t, stop);
  car.frequency.exponentialRampToValueAtTime(f, t + 0.03);
  const mod = sine(g, f * 2, t, stop);
  const idx = gain(g);
  idx.gain.setValueAtTime(f * 0.9 * v, t);
  idx.gain.setTargetAtTime(f * 0.08, t, 0.12);
  mod.connect(idx).connect(car.frequency);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.6, t + 0.004);
  a.gain.setTargetAtTime(0, t + 0.004, tau);
  car.connect(a).connect(dest);
  // The "bloom": the octave partial swells in just after the strike.
  partial(g, dest, f * 2, t + 0.012, v * 0.18, tau * 0.7, 0.03);
  partial(g, dest, f * 3, t, v * 0.05, tau * 0.3);
};

export const epiano: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const tau = clamp(1.6 - (m - 60) * 0.03, 0.5, 2.2);
  const end = t + dur;
  const stop = end + 0.9;
  const car = sine(g, f, t, stop);
  const mod = sine(g, f, t, stop);
  const idx = gain(g);
  idx.gain.setValueAtTime(f * (0.4 + 1.1 * v), t);
  idx.gain.setTargetAtTime(f * 0.12, t, 0.35);
  mod.connect(idx).connect(car.frequency);
  // Tine "bark" – high ratio, very short.
  const tine = sine(g, f * 14, t, t + 0.3);
  const ti = gain(g);
  ti.gain.setValueAtTime(f * 0.7 * v, t);
  ti.gain.setTargetAtTime(0, t, 0.02);
  tine.connect(ti).connect(car.frequency);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.55, t + 0.003);
  a.gain.setTargetAtTime(v * 0.1, t + 0.003, tau);
  a.gain.setTargetAtTime(0, end, 0.12);
  car.connect(a).connect(dest);
};

type PluckFlavour = { key: string; brightness: number; position: number; decay: (m: number) => number; seconds: number; gain: number; damp: number; lpMax: number };
// Gains are loudness-calibrated (scripts/audio-render.mjs --stems): a decaying string carries far
// less energy than a sustained wind voice at the same peak, so plucks sit ~6–9 dB hotter.
const PLUCKS: Record<string, PluckFlavour> = {
  guitar: { key: 'gtr', brightness: 0.42, position: 0.17, decay: (m) => clamp(3.4 - (m - 50) * 0.06, 1.2, 4), seconds: 3, gain: 1.55, damp: 0.09, lpMax: 5200 },
  harp: { key: 'hrp', brightness: 0.55, position: 0.32, decay: (m) => clamp(5 - (m - 55) * 0.08, 1.6, 5.5), seconds: 4, gain: 1.95, damp: 0.5, lpMax: 5200 },
  ukulele: { key: 'uke', brightness: 0.72, position: 0.2, decay: (m) => clamp(1.9 - (m - 60) * 0.03, 0.8, 2), seconds: 1.8, gain: 1.3, damp: 0.06, lpMax: 6500 },
  bass: { key: 'bas', brightness: 0.22, position: 0.24, decay: (m) => clamp(2.2 - (m - 36) * 0.04, 1, 2.4), seconds: 2, gain: 1.9, damp: 0.08, lpMax: 900 },
  pizz: { key: 'piz', brightness: 0.35, position: 0.28, decay: () => 0.55, seconds: 0.8, gain: 2.3, damp: 0.05, lpMax: 3800 },
};

function plucked(flavour: PluckFlavour): InstrumentFn {
  return (g, dest, t, m, dur, v, o) => {
    const f = mtof(m);
    const buf = g.pluck(`${flavour.key}:${m}`, f, { brightness: flavour.brightness, position: flavour.position, decay: flavour.decay(m), seconds: flavour.seconds });
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, ((o?.detune ?? 0) + g.rng.gauss(1.5)) / 1200);
    const a = gain(g);
    const vv = v * flavour.gain * (o?.art === 'accent' ? 1.15 : 1);
    a.gain.setValueAtTime(vv, t);
    const end = Math.min(t + buf.duration, t + dur + flavour.damp * 4);
    a.gain.setTargetAtTime(0, t + dur + 0.02, flavour.damp);
    // Velocity-dependent tone: softer notes are darker.
    const lp = filter(g, 'lowpass', Math.min(flavour.lpMax, 1500 + 7000 * v * flavour.brightness + mtof(m) * 2), 0.5);
    src.connect(lp).connect(a).connect(dest);
    src.start(t);
    src.stop(end + 0.05);
  };
}

export const guitar = plucked(PLUCKS.guitar!);
export const harp = plucked(PLUCKS.harp!);
export const ukulele = plucked(PLUCKS.ukulele!);
export const pizz = plucked(PLUCKS.pizz!);
const bassString = plucked(PLUCKS.bass!);
export const upright: InstrumentFn = (g, dest, t, m, dur, v, o) => {
  bassString(g, dest, t, m, dur, v, o);
  // A little sine body under the string for warmth on small speakers.
  const f = mtof(m);
  const stop = t + Math.min(dur, 1.2) + 0.4;
  const s = sine(g, f, t, stop);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.3, t + 0.012);
  a.gain.setTargetAtTime(v * 0.14, t + 0.012, 0.25);
  a.gain.setTargetAtTime(0, t + Math.min(dur, 1.2), 0.07);
  s.connect(a).connect(dest);
};

// ─────────────────────────────────────────────────────────── sustained

const FLUTE = (): number[] => [1, 0.42, 0.14, 0.07, 0.03, 0.015];
const WHISTLE = (): number[] => [1, 0.22, 0.2, 0.05, 0.03];
// Odd-harmonic reed spectrum, upper partials eased off (stems showed 25 % of the energy at 2–5 kHz).
const CLARINET = (): number[] => [1, 0.04, 0.66, 0.05, 0.36, 0.04, 0.17, 0.03, 0.09, 0.02, 0.05, 0.01, 0.025];
const BOWED = (): number[] => Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  const fm = n * 110; // pseudo formants for a ~110 Hz reference: bumps near 300 / 1100 / 2600 Hz
  const bump = 1 + 0.8 * Math.exp(-(((fm - 300) / 200) ** 2)) + 0.5 * Math.exp(-(((fm - 1100) / 400) ** 2)) + 0.3 * Math.exp(-(((fm - 2600) / 600) ** 2));
  return (bump / Math.pow(n, 1.05)) * (n % 2 ? 1 : 0.85);
});
const FIDDLE = (): number[] => Array.from({ length: 26 }, (_, i) => 1 / Math.pow(i + 1, 0.95));
const REED = (): number[] => [1, 0.75, 0.62, 0.5, 0.46, 0.36, 0.3, 0.26, 0.2, 0.16, 0.12, 0.1, 0.08, 0.06];

function windVoice(opts: { wave: () => number[]; name: string; attack: number; breath: number; chiff: number; vibRate: number; vibDepth: number; bright: number; release: number; level: number }): InstrumentFn {
  return (g, dest, t, m, dur, v, o) => {
    const f = mtof(m);
    const legato = o?.art === 'legato';
    const attack = legato ? 0.03 : opts.attack;
    const osc = g.ctx.createOscillator();
    osc.setPeriodicWave(wave(g.ctx, opts.name, opts.wave));
    if (legato) glide(osc.frequency, t, f, o?.from, 0.05);
    else scoop(osc.frequency, t, f, 14 + g.rng.next() * 8, 0.045);
    const trem = gain(g, 1);
    vibrato(g, osc.frequency, t, dur, f, opts.vibRate, opts.vibDepth, 0.22, { node: trem, depth: 0.06 });
    // Softer notes are darker; the filter opens a touch as the breath settles in.
    const lpF = clamp(f * opts.bright + 900 * v, 400, 12000);
    const lp = filter(g, 'lowpass', lpF, 0.6);
    lp.frequency.setValueAtTime(lpF * 0.7, t);
    lp.frequency.linearRampToValueAtTime(lpF, t + attack + 0.08);
    const a = gain(g);
    const stop = sustainEnv(a.gain, t, dur, v * opts.level, attack, 0.86, opts.release);
    osc.connect(lp).connect(trem).connect(a).connect(dest);
    osc.start(t);
    osc.stop(stop);
    // Breath: band-limited noise that follows the note.
    if (opts.breath > 0) {
      const src = g.ctx.createBufferSource();
      src.buffer = g.pink;
      src.loop = true;
      const bp = filter(g, 'bandpass', Math.min(f * 2.2, 9000), 1.1);
      const b = gain(g);
      sustainEnv(b.gain, t, dur, v * opts.breath, attack * 0.7, 0.6, opts.release);
      src.connect(bp).connect(b).connect(dest);
      src.start(t, g.rng.next() * 2);
      src.stop(stop);
    }
    if (!legato && opts.chiff > 0) noiseHit(g, dest, t, { f: Math.min(f * 3, 9000), q: 1.5, amp: v * opts.chiff, attack: 0.008, tau: 0.018 });
  };
}

export const flute = windVoice({ wave: FLUTE, name: 'flute', attack: 0.07, breath: 0.07, chiff: 0.09, vibRate: 5.1, vibDepth: 0.0045, bright: 4, release: 0.06, level: 0.62 });
export const whistle = windVoice({ wave: WHISTLE, name: 'whistle', attack: 0.03, breath: 0.05, chiff: 0.14, vibRate: 5.8, vibDepth: 0.004, bright: 6, release: 0.04, level: 0.5 });
export const ocarina = windVoice({ wave: () => [1, 0.12, 0.05, 0.02], name: 'ocarina', attack: 0.05, breath: 0.09, chiff: 0.05, vibRate: 5.4, vibDepth: 0.005, bright: 3, release: 0.05, level: 0.62 });
export const clarinet = windVoice({ wave: CLARINET, name: 'clarinet', attack: 0.05, breath: 0.025, chiff: 0.02, vibRate: 4.6, vibDepth: 0.0022, bright: 2.7, release: 0.07, level: 0.52 });

export const cello: InstrumentFn = (g, dest, t, m, dur, v, o) => {
  const f = mtof(m);
  const legato = o?.art === 'legato' && o.from !== undefined;
  const attack = legato ? 0.08 : clamp(0.24 - v * 0.1, 0.1, 0.24);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.34, attack, 0.82, 0.14);
  // Messa di voce on long notes.
  if (dur > 1) {
    a.gain.setTargetAtTime(v * 0.36, t + dur * 0.35, dur * 0.2);
    a.gain.setTargetAtTime(0, t + dur, 0.14);
  }
  const lp = filter(g, 'lowpass', 1500 + 1600 * v, 0.5);
  const body = filter(g, 'peaking', 260, 1.1, 3);
  lp.connect(body).connect(a).connect(dest);
  for (const det of [-4, 4]) {
    const osc = g.ctx.createOscillator();
    osc.setPeriodicWave(wave(g.ctx, 'bowed', BOWED));
    osc.detune.value = det;
    glide(osc.frequency, t, f, legato ? o!.from : undefined, 0.09);
    vibrato(g, osc.frequency, t, dur, f, 5.2, 0.0035, 0.28);
    osc.connect(lp);
    osc.start(t);
    osc.stop(stop);
  }
  noiseHit(g, dest, t, { f: 2200, q: 0.8, amp: v * 0.025, attack: 0.04, tau: 0.08, buf: g.pink });
};

export const fiddle: InstrumentFn = (g, dest, t, m, dur, v, o) => {
  const f = mtof(m);
  const legato = o?.art === 'legato' && o.from !== undefined;
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.3, legato ? 0.015 : 0.022, 0.8, o?.art === 'staccato' ? 0.02 : 0.04);
  const osc = g.ctx.createOscillator();
  osc.setPeriodicWave(wave(g.ctx, 'fiddle', FIDDLE));
  glide(osc.frequency, t, f, legato ? o!.from : undefined, 0.03);
  vibrato(g, osc.frequency, t, dur, f, 6.1, 0.005, 0.16);
  const f1 = filter(g, 'peaking', 480, 1.2, 5);
  const f2 = filter(g, 'peaking', 1650, 1.4, 3);
  const f3 = filter(g, 'peaking', 3100, 2, 4);
  const lp = filter(g, 'lowpass', 5200, 0.5);
  const hp = filter(g, 'highpass', 200, 0.7);
  osc.connect(hp).connect(f1).connect(f2).connect(f3).connect(lp).connect(a).connect(dest);
  osc.start(t);
  osc.stop(stop);
  if (!legato) noiseHit(g, dest, t, { f: 3600, q: 1.2, amp: v * 0.05, attack: 0.004, tau: 0.02 });
};

export const accordion: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.2, 0.03, 0.9, 0.05);
  const lp = filter(g, 'lowpass', 2600 + 1200 * v, 0.6);
  lp.connect(a).connect(dest);
  for (const det of [-7, 7]) {
    const osc = g.ctx.createOscillator();
    osc.setPeriodicWave(wave(g.ctx, 'reed', REED));
    osc.frequency.setValueAtTime(f, t);
    osc.detune.value = det;
    osc.connect(lp);
    osc.start(t);
    osc.stop(stop);
  }
};

export const pad: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const attack = clamp(dur * 0.35, 0.4, 1.4);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.12, attack, 1, 0.7);
  const lp = filter(g, 'lowpass', 600, 0.4);
  lp.frequency.setValueAtTime(450, t);
  lp.frequency.linearRampToValueAtTime(700 + 900 * v, t + attack);
  lp.connect(a).connect(dest);
  const pans = [-0.6, 0, 0.6];
  [-9, 0, 9].forEach((det, i) => {
    const osc = g.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, t);
    osc.detune.value = det + g.rng.gauss(2);
    const p = g.ctx.createStereoPanner();
    p.pan.value = pans[i]!;
    osc.connect(p).connect(lp);
    osc.start(t);
    osc.stop(stop);
  });
};

/** Warm sine/triangle bass for the soft themes. */
export const softBass: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.55, 0.02, 0.7, 0.09);
  const lp = filter(g, 'lowpass', 420, 0.5);
  lp.connect(a).connect(dest);
  const s = sine(g, f, t, stop);
  s.connect(lp);
  const tri = g.ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.value = f;
  const tg = gain(g, 0.35);
  tri.connect(tg).connect(lp);
  tri.start(t);
  tri.stop(stop);
};

/** Slow evolving drone (mine / night): beating detuned partials under a dark lowpass. */
export const drone: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.3, Math.min(3, dur * 0.4), 1, 1.4);
  const lp = filter(g, 'lowpass', 380, 0.8);
  const lfo = sine(g, 0.07, t, stop);
  const lg = gain(g, 160);
  lfo.connect(lg).connect(lp.frequency);
  lp.connect(a).connect(dest);
  for (const [ratio, amp, det] of [[1, 1, 0], [1, 0.7, 5], [1.5, 0.35, -3], [2, 0.25, 7], [3, 0.08, 0]] as const) {
    const o = sine(g, f * ratio, t, stop);
    o.detune.value = det;
    const og = gain(g, amp);
    o.connect(og).connect(lp);
  }
};

export const glass: InstrumentFn = (g, dest, t, m, _dur, v) => {
  const f = mtof(m);
  const tau = 1.6;
  const stop = t + tau * 6;
  const car = sine(g, f, t, stop);
  const mod = sine(g, f * 2.41, t, stop);
  const idx = gain(g);
  idx.gain.setValueAtTime(f * 0.6 * v, t);
  idx.gain.setTargetAtTime(f * 0.05, t, 0.8);
  mod.connect(idx).connect(car.frequency);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.35, t + 0.06);
  a.gain.setTargetAtTime(0, t + 0.06, tau);
  car.connect(a).connect(dest);
};

// ─────────────────────────────────────────────────────────── percussion (midi = variant/pitch hint)

export const shaker: InstrumentFn = (g, dest, t, _m, _d, v) => {
  noiseHit(g, dest, t, { type: 'bandpass', f: 8200, q: 0.8, amp: v * 0.22, attack: 0.012, tau: 0.028 });
};
export const woodblock: InstrumentFn = (g, dest, t, m, _d, v) => {
  const f = m > 0 ? mtof(m) : 820;
  partial(g, dest, f, t, v * 0.4, 0.03, 0.001);
  noiseHit(g, dest, t, { f: f * 2.4, q: 5, amp: v * 0.15, tau: 0.01 });
};
export const bodhran: InstrumentFn = (g, dest, t, _m, _d, v) => {
  const o = sine(g, 96, t, t + 0.6);
  o.frequency.exponentialRampToValueAtTime(56, t + 0.12);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.8, t + 0.003);
  a.gain.setTargetAtTime(0, t + 0.003, 0.09);
  o.connect(a).connect(dest);
  noiseHit(g, dest, t, { type: 'lowpass', f: 600, amp: v * 0.3, tau: 0.03, buf: g.pink });
};
export const tambourine: InstrumentFn = (g, dest, t, _m, _d, v) => {
  noiseHit(g, dest, t, { type: 'highpass', f: 6500, amp: v * 0.12, attack: 0.003, tau: 0.03 });
  noiseHit(g, dest, t + 0.004, { f: 7400, q: 9, amp: v * 0.35, tau: 0.06 });
  noiseHit(g, dest, t + 0.009, { f: 9800, q: 9, amp: v * 0.25, tau: 0.05 });
};
export const softKick: InstrumentFn = (g, dest, t, _m, _d, v) => {
  const o = sine(g, 105, t, t + 0.6);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.75, t + 0.004);
  a.gain.setTargetAtTime(0, t + 0.004, 0.1);
  o.connect(a).connect(dest);
};
export const brush: InstrumentFn = (g, dest, t, _m, _d, v) => {
  noiseHit(g, dest, t, { f: 3200, q: 0.6, amp: v * 0.18, attack: 0.018, tau: 0.05, buf: g.pink });
};
export const conga: InstrumentFn = (g, dest, t, m, _d, v) => {
  const f = m > 0 ? mtof(m) : 230;
  const o = sine(g, f * 1.15, t, t + 0.5);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.55, t + 0.003);
  a.gain.setTargetAtTime(0, t + 0.003, 0.08);
  o.connect(a).connect(dest);
  noiseHit(g, dest, t, { f: 1300, q: 1.5, amp: v * 0.12, tau: 0.012 });
};
export const triangleDing: InstrumentFn = (g, dest, t, _m, _d, v) => {
  partial(g, dest, 4186, t, v * 0.12, 0.4, 0.001);
  partial(g, dest, 6280, t, v * 0.06, 0.25, 0.001);
  partial(g, dest, 9100, t, v * 0.03, 0.12, 0.001);
};

export const INSTRUMENTS = {
  kalimba, marimba, musicBox, bell, celesta, steelPan, epiano,
  guitar, harp, ukulele, pizz, upright,
  flute, whistle, ocarina, clarinet, cello, fiddle, accordion, pad, softBass, drone, glass,
  shaker, woodblock, bodhran, tambourine, softKick, brush, conga, triangleDing,
} satisfies Record<string, InstrumentFn>;

export type InstrumentName = keyof typeof INSTRUMENTS;

/** Which instruments sustain (get legato glides, no strums). */
export const SUSTAINED: ReadonlySet<InstrumentName> = new Set(['flute', 'whistle', 'ocarina', 'clarinet', 'cello', 'fiddle', 'accordion', 'pad', 'softBass', 'drone']);
