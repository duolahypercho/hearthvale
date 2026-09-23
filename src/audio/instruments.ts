/**
 * Synthesised instruments. Every instrument is a function that schedules one note at absolute
 * context time `t` into `dest` (a track input). Timbres are built from:
 *   - pre-rendered modal notes (kalimba with tine inharmonics + buzz + box resonance, marimba,
 *     music box with its wooden case, celesta, hand bells, steel pan): one buffer per pitch, cached,
 *   - Karplus-Strong strings with body resonances baked in (nylon guitar, harp, ukulele, upright
 *     bass, pizzicato),
 *   - bowed strings: detuned band-limited oscillators with bow-pressure noise, velocity-following
 *     spectral tilt and a shared vibrato, played through a generated body impulse response
 *     (per-track insert, see INSERTS),
 *   - an ensemble-strings pad (five drifting voices per note, formant EQ insert),
 *   - winds: band-limited periodic waves + breath noise + delayed vibrato (flute, whistle,
 *     ocarina, clarinet), reeds (accordion), FM (electric piano, glass),
 *   - filtered noise and pitched sines for percussion.
 * Levels are normalised so a velocity-1 note of any instrument peaks around -6 dBFS before track trims.
 */
import type { AudioGraph } from './graph';
import { Rand, clamp, harmonicWave, modalBuffer, mtof, type ModalSpec, type BodyKind } from './dsp';

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
 * Delayed vibrato from the graph's shared LFO: one depth gain per note fans out to every
 * oscillator of the voice; with `amp` the same LFO also breathes the level a few percent.
 */
function vibrato(g: AudioGraph, params: AudioParam[], t: number, dur: number, f: number, rate: number, depth: number, delay: number, amp?: { node: GainNode; depth: number }): void {
  if (dur < delay + 0.15) return;
  const lfo = g.lfo(rate);
  const d = gain(g);
  d.gain.setValueAtTime(0, t);
  d.gain.setValueAtTime(0, t + delay);
  d.gain.linearRampToValueAtTime(f * depth, t + delay + 0.35);
  d.gain.setTargetAtTime(0, t + dur + 0.05, 0.05);
  lfo.connect(d);
  for (const p of params) d.connect(p);
  const links: [AudioNode, AudioNode][] = [[lfo, d]];
  if (amp) {
    const ad = gain(g);
    ad.gain.setValueAtTime(0, t + delay);
    ad.gain.linearRampToValueAtTime(amp.depth, t + delay + 0.45);
    ad.gain.setTargetAtTime(0, t + dur + 0.05, 0.05);
    lfo.connect(ad).connect(amp.node.gain);
    links.push([lfo, ad]);
  }
  detachLater(g, t + dur + 0.8, links);
}

/**
 * Shared modulators (LFOs, drifts) run forever: detach the per-note links once the note is over
 * so finished voices can be collected (real time only; offline contexts end anyway).
 */
function detachLater(g: AudioGraph, at: number, links: [AudioNode, AudioNode | AudioParam][]): void {
  if (g.offline) return;
  const ms = Math.max(0, (at - g.ctx.currentTime) * 1000 + 50);
  setTimeout(() => {
    for (const [src, dst] of links) {
      try {
        if (dst instanceof AudioParam) src.disconnect(dst);
        else src.disconnect(dst);
      } catch {
        /* already gone */
      }
    }
  }, ms);
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

// ─────────────────────────────────────────────────────────── struck (pre-rendered modal notes)

type Mallet = { key: string; spec: (m: number, f: number) => ModalSpec; level: number; bright: number };

/**
 * Play a cached modal note. Softer notes are darker (one lowpass per note); `level` calibrates
 * loudness against the other instruments.
 */
function mallet(def: Mallet): InstrumentFn {
  return (g, dest, t, m, _dur, v, o) => {
    const f = mtof(m);
    const buf = g.buffer(`${def.key}:${m}`, () => modalBuffer(g.ctx, f, def.spec(m, f), new Rand(m * 7919 + def.key.length)));
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    if (o?.detune) src.detune.value = o.detune;
    const a = gain(g, v * def.level);
    const lp = filter(g, 'lowpass', Math.min(18000, f * def.bright * (0.45 + 0.9 * v) + 1200), 0.5);
    src.connect(lp).connect(a).connect(dest);
    src.start(t);
    src.stop(t + buf.duration);
  };
}

const KALIMBA: Mallet = {
  key: 'kal',
  level: 1,
  bright: 14,
  spec: (m) => {
    const tau = clamp(0.62 - (m - 60) * 0.014, 0.2, 0.8);
    return {
      partials: [
        { r: 1, amp: 0.78, tau },
        { r: 2.01, amp: 0.05, tau: tau * 0.25 },
        // Tine (clamped-bar) inharmonics — the kalimba's glassy ping.
        { r: 5.4, amp: 0.26, tau: 0.14 },
        { r: 8.93, amp: 0.1, tau: 0.05 },
      ],
      glide: 10,
      glideTime: 0.012,
      buzz: { amp: 0.03, tau: tau * 0.35 },
      click: { amp: 0.05, tau: 0.004, lp: 3500 },
      // Hollow box resonator.
      body: [[260, 4, 0.35], [610, 5, 0.22], [1450, 5, 0.12]],
      seconds: Math.min(2.6, tau * 5 + 0.2),
    };
  },
};

const MARIMBA: Mallet = {
  key: 'mar',
  level: 1,
  bright: 16,
  spec: (m) => {
    const tau = clamp(0.5 - (m - 60) * 0.013, 0.14, 0.75);
    return {
      partials: [
        { r: 1, amp: 0.8, tau },
        { r: 3.99, amp: 0.34, tau: tau * 0.22 },
        { r: 9.85, amp: 0.08, tau: tau * 0.07 },
      ],
      click: { amp: 0.1, tau: 0.006, lp: 1800 },
      // Resonator tube: a touch of reinforcement just above the bar's fundamental.
      body: [[mtof(m) * 1.002, 30, 0.25]],
      seconds: Math.min(2.4, tau * 5.5 + 0.1),
    };
  },
};

const MUSIC_BOX: Mallet = {
  key: 'mbx',
  level: 1,
  bright: 18,
  spec: (m) => {
    const tau = clamp(0.8 - (m - 72) * 0.02, 0.25, 1.05);
    return {
      partials: [
        { r: 1, amp: 0.62, tau, beat: [0.7, 0.12] },
        { r: 2.0, amp: 0.2, tau: tau * 0.6 },
        { r: 4.16, amp: 0.14, tau: tau * 0.22 },
        { r: 6.95, amp: 0.05, tau: 0.05 },
      ],
      click: { amp: 0.035, tau: 0.003, lp: 12000, hp: 4000 },
      // The wooden case.
      body: [[420, 3, 0.3], [1100, 4, 0.18], [2600, 5, 0.1]],
      seconds: Math.min(3, tau * 5),
    };
  },
};

const CELESTA: Mallet = {
  key: 'cel',
  level: 1,
  bright: 16,
  spec: (m) => {
    const tau = clamp(0.72 - (m - 72) * 0.02, 0.22, 0.95);
    return {
      partials: [
        { r: 1, amp: 0.7, tau },
        { r: 2.0, amp: 0.08, tau: tau * 0.35 },
        { r: 4.0, amp: 0.2, tau: tau * 0.18 },
        { r: 7.0, amp: 0.035, tau: 0.04 },
      ],
      click: { amp: 0.04, tau: 0.004, lp: 2500 },
      body: [[mtof(m), 20, 0.2]],
      seconds: Math.min(2.8, tau * 5),
    };
  },
};

const BELL: Mallet = {
  key: 'bel',
  level: 1,
  bright: 20,
  spec: (m) => {
    const tau = clamp(1.1 - (m - 72) * 0.025, 0.4, 1.5);
    return {
      // Hand bell: hum, prime, tierce, quint, nominal — with slow beating pairs.
      partials: [
        { r: 0.5, amp: 0.1, tau: tau * 1.2 },
        { r: 1, amp: 0.48, tau, beat: [0.9, 0.2] },
        { r: 1.19, amp: 0.07, tau: tau * 0.5 },
        { r: 1.5, amp: 0.06, tau: tau * 0.45 },
        { r: 2.0, amp: 0.2, tau: tau * 0.7, beat: [1.3, 0.25] },
        { r: 2.76, amp: 0.07, tau: tau * 0.3 },
        { r: 4.07, amp: 0.04, tau: tau * 0.14 },
      ],
      click: { amp: 0.03, tau: 0.003, lp: 6000 },
      seconds: Math.min(4, tau * 5),
    };
  },
};

const STEEL_PAN: Mallet = {
  key: 'pan',
  level: 1,
  bright: 14,
  spec: (m) => {
    const tau = clamp(0.55 - (m - 64) * 0.012, 0.2, 0.65);
    return {
      partials: [
        { r: 1, amp: 0.6, tau },
        // The "bloom": the octave partial swells in just after the strike.
        { r: 2, amp: 0.2, tau: tau * 0.7, atk: 0.03 },
        { r: 3, amp: 0.06, tau: tau * 0.3 },
        { r: 4, amp: 0.05, tau: 0.05 },
        { r: 5.02, amp: 0.025, tau: 0.03 },
      ],
      glide: 20,
      glideTime: 0.02,
      click: { amp: 0.05, tau: 0.004, lp: 3000 },
      seconds: Math.min(2.4, tau * 5.5),
    };
  },
};

/** Ride cymbal (brushed, far away): inharmonic high partials with beating, a stick tick. */
const RIDE: Mallet = {
  key: 'ride',
  level: 1,
  bright: 8,
  spec: () => ({
    partials: [
      { r: 1, amp: 0.05, tau: 0.5, beat: [7, 0.6] },
      { r: 1.37, amp: 0.04, tau: 0.42, beat: [11, 0.5] },
      { r: 1.93, amp: 0.035, tau: 0.36 },
      { r: 2.61, amp: 0.03, tau: 0.3, beat: [5, 0.5] },
      { r: 3.3, amp: 0.02, tau: 0.24 },
    ],
    click: { amp: 0.1, tau: 0.004, lp: 12000, hp: 3000 },
    seconds: 2.2,
  }),
};
const rideMallet = mallet(RIDE);
export const ride: InstrumentFn = (g, dest, t, _m, dur, v) => rideMallet(g, dest, t, 102, dur, v * 0.9);

export const kalimba = mallet(KALIMBA);
const marimbaStrike = mallet(MARIMBA);
export const musicBox = mallet(MUSIC_BOX);
export const celesta = mallet(CELESTA);
export const bell = mallet(BELL);
export const steelPan = mallet(STEEL_PAN);

export const marimba: InstrumentFn = (g, dest, t, m, dur, v, o) => {
  if ((o?.art === 'roll' || o?.art === 'legato') && dur > 0.5) {
    // Tremolo roll on long notes, as real marimbists do (each stroke is one cached buffer).
    const step = 0.072;
    let k = 0;
    for (let tt = t; tt < t + dur - 0.05; tt += step, k++) marimbaStrike(g, dest, tt + g.rng.gauss(0.004), m, 0.1, v * (k === 0 ? 1 : k % 2 ? 0.58 : 0.68) * (1 - 0.25 * ((tt - t) / dur)));
  } else marimbaStrike(g, dest, t, m, dur, v, o);
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

type PluckFlavour = { key: string; brightness: number; position: number; decay: (m: number) => number; seconds: number; gain: number; damp: number; lpMax: number; body: [number, number, number][] };
// Gains are loudness-calibrated (scripts/audio-render.mjs --stems): a decaying string carries far
// less energy than a sustained wind voice at the same peak, so plucks sit ~6–9 dB hotter.
const PLUCKS: Record<string, PluckFlavour> = {
  guitar: { key: 'gtr', brightness: 0.5, position: 0.16, decay: (m) => clamp(3.4 - (m - 50) * 0.06, 1.2, 4), seconds: 3, gain: 1.55, damp: 0.09, lpMax: 7000, body: [[102, 3, 0.35], [205, 4, 0.3], [410, 5, 0.18], [2500, 1.5, 0.22]] },
  harp: { key: 'hrp', brightness: 0.7, position: 0.3, decay: (m) => clamp(5 - (m - 55) * 0.08, 1.6, 5.5), seconds: 4, gain: 1.9, damp: 0.5, lpMax: 7500, body: [[180, 2, 0.25], [460, 3, 0.18], [2200, 1.5, 0.2]] },
  ukulele: { key: 'uke', brightness: 0.72, position: 0.2, decay: (m) => clamp(1.9 - (m - 60) * 0.03, 0.8, 2), seconds: 1.8, gain: 1.3, damp: 0.06, lpMax: 7500, body: [[250, 3, 0.35], [520, 4, 0.25], [2300, 1.5, 0.2]] },
  bass: { key: 'bas', brightness: 0.26, position: 0.24, decay: (m) => clamp(2.2 - (m - 36) * 0.04, 1, 2.4), seconds: 2, gain: 1.9, damp: 0.08, lpMax: 1400, body: [[92, 3, 0.35], [180, 4, 0.2], [700, 2, 0.15]] },
  pizz: { key: 'piz', brightness: 0.4, position: 0.26, decay: () => 0.55, seconds: 0.8, gain: 2.2, damp: 0.05, lpMax: 5200, body: [[280, 4, 0.4], [460, 5, 0.28], [1100, 3, 0.2], [2800, 2, 0.25]] },
};

function plucked(flavour: PluckFlavour): InstrumentFn {
  return (g, dest, t, m, dur, v, o) => {
    const f = mtof(m);
    const buf = g.pluck(`${flavour.key}:${m}`, f, { brightness: flavour.brightness, position: flavour.position, decay: flavour.decay(m), seconds: flavour.seconds, body: flavour.body });
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, ((o?.detune ?? 0) + g.rng.gauss(1.5)) / 1200);
    const a = gain(g);
    const vv = v * flavour.gain * (o?.art === 'accent' ? 1.15 : 1);
    a.gain.setValueAtTime(vv, t);
    const end = Math.min(t + buf.duration, t + dur + flavour.damp * 4);
    a.gain.setTargetAtTime(0, t + dur + 0.02, flavour.damp);
    // Velocity-dependent tone: softer notes are darker.
    const lp = filter(g, 'lowpass', Math.min(flavour.lpMax, 1800 + 8000 * v * flavour.brightness + f * 2), 0.5);
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
  // A little sine body under the string for warmth, plus its octave so it reads on small speakers.
  const f = mtof(m);
  const stop = t + Math.min(dur, 1.2) + 0.4;
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.26, t + 0.012);
  a.gain.setTargetAtTime(v * 0.12, t + 0.012, 0.25);
  a.gain.setTargetAtTime(0, t + Math.min(dur, 1.2), 0.07);
  sine(g, f, t, stop).connect(a);
  const o2 = gain(g, 0.35);
  sine(g, f * 2, t, stop).connect(o2).connect(a);
  a.connect(dest);
};

// ─────────────────────────────────────────────────────────── sustained

const FLUTE = (): number[] => [1, 0.5, 0.22, 0.12, 0.06, 0.03, 0.015];
const WHISTLE = (): number[] => [1, 0.22, 0.2, 0.06, 0.04, 0.015];
// Odd-harmonic reed spectrum, upper partials eased off.
const CLARINET = (): number[] => [1, 0.05, 0.6, 0.05, 0.3, 0.04, 0.15, 0.03, 0.07, 0.02, 0.04, 0.01, 0.02];
/** Bowed string (Helmholtz sawtooth ~1/n), slightly softened even harmonics. */
const BOWED = (): number[] => Array.from({ length: 36 }, (_, i) => (1 / Math.pow(i + 1, 1.02)) * ((i + 1) % 2 ? 1 : 0.9));
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
    vibrato(g, [osc.frequency], t, dur, f, opts.vibRate, opts.vibDepth, 0.22, { node: trem, depth: 0.06 });
    // Softer notes are darker; the filter opens a touch as the breath settles in.
    const lpF = clamp(f * opts.bright + 1200 * v, 500, 14000);
    const lp = filter(g, 'lowpass', lpF, 0.6);
    lp.frequency.setValueAtTime(lpF * 0.7, t);
    lp.frequency.linearRampToValueAtTime(lpF, t + attack + 0.08);
    const a = gain(g);
    const stop = sustainEnv(a.gain, t, dur, v * opts.level, attack, 0.86, opts.release);
    osc.connect(lp).connect(trem).connect(a).connect(dest);
    osc.start(t);
    osc.stop(stop);
    // Breath: band-limited noise that follows the note (a little stronger at the onset).
    if (opts.breath > 0) {
      const src = g.ctx.createBufferSource();
      src.buffer = g.pink;
      src.loop = true;
      const bp = filter(g, 'bandpass', Math.min(f * 2.2 + 600, 9000), 0.9);
      const b = gain(g);
      sustainEnv(b.gain, t, dur, v * opts.breath, attack * 0.7, 0.55, opts.release);
      src.connect(bp).connect(b).connect(dest);
      src.start(t, g.rng.next() * 2);
      src.stop(stop);
    }
    if (!legato && opts.chiff > 0) noiseHit(g, dest, t, { f: Math.min(f * 3, 9000), q: 1.5, amp: v * opts.chiff, attack: 0.008, tau: 0.018 });
  };
}

export const flute = windVoice({ wave: FLUTE, name: 'flute', attack: 0.07, breath: 0.14, chiff: 0.09, vibRate: 5.1, vibDepth: 0.0045, bright: 5, release: 0.07, level: 0.62 });
export const whistle = windVoice({ wave: WHISTLE, name: 'whistle', attack: 0.03, breath: 0.06, chiff: 0.14, vibRate: 5.8, vibDepth: 0.004, bright: 6, release: 0.04, level: 0.5 });
export const ocarina = windVoice({ wave: () => [1, 0.18, 0.08, 0.04, 0.02], name: 'ocarina', attack: 0.05, breath: 0.12, chiff: 0.06, vibRate: 5.4, vibDepth: 0.005, bright: 3.5, release: 0.05, level: 0.62 });
export const clarinet = windVoice({ wave: CLARINET, name: 'clarinet', attack: 0.05, breath: 0.03, chiff: 0.02, vibRate: 4.6, vibDepth: 0.0022, bright: 2.6, release: 0.07, level: 0.52 });

/**
 * Bowed strings: `voices` detuned Helmholtz oscillators under one lowpass whose cutoff follows
 * the bow (velocity + attack), bow-hair noise shaped by the same envelope (a scratch at the
 * onset), a shared vibrato, played into the track's body-IR insert.
 */
function bowed(opts: { name: string; voices: number[]; level: number; attack: number; release: number; vibRate: number; vibDepth: number; vibDelay: number; tilt: number; noise: number; noiseF: number; lo: number }): InstrumentFn {
  return (g, dest, t, m, dur, v, o) => {
    const f = mtof(m);
    const legato = o?.art === 'legato' && o.from !== undefined;
    const attack = legato ? 0.06 : clamp(opts.attack - v * 0.06, 0.03, opts.attack);
    const a = gain(g);
    const stop = sustainEnv(a.gain, t, dur, v * opts.level, attack, 0.84, o?.art === 'staccato' ? 0.03 : opts.release);
    // Messa di voce on long notes.
    if (dur > 1) {
      a.gain.setTargetAtTime(v * opts.level * 1.05, t + dur * 0.35, dur * 0.2);
      a.gain.setTargetAtTime(0, t + dur, opts.release);
    }
    // Spectral tilt follows the bow: the tone opens during the attack and with velocity.
    const top = Math.min(14000, f * (opts.tilt + 10 * v) + 1400 * v);
    const lp = filter(g, 'lowpass', top, 0.6);
    lp.frequency.setValueAtTime(Math.max(opts.lo, top * 0.35), t);
    lp.frequency.setTargetAtTime(top, t, attack * 0.8);
    lp.frequency.setTargetAtTime(top * 0.8, t + dur, 0.1);
    lp.connect(a).connect(dest);
    const freqs: AudioParam[] = [];
    const links: [AudioNode, AudioParam][] = [];
    opts.voices.forEach((det, k) => {
      const osc = g.ctx.createOscillator();
      osc.setPeriodicWave(wave(g.ctx, opts.name, BOWED));
      osc.detune.value = det + g.rng.gauss(1.5);
      glide(osc.frequency, t, f, legato ? o!.from : undefined, 0.08);
      g.drift(k).connect(osc.detune);
      links.push([g.drift(k), osc.detune]);
      const vg = gain(g, 1 / Math.sqrt(opts.voices.length));
      osc.connect(vg).connect(lp);
      osc.start(t);
      osc.stop(stop);
      freqs.push(osc.frequency);
    });
    vibrato(g, freqs, t, dur, f, opts.vibRate, opts.vibDepth, opts.vibDelay);
    detachLater(g, stop, links);
    // Bow noise: rosin hiss riding the envelope, with a scratch at the start.
    const src = g.ctx.createBufferSource();
    src.buffer = g.pink;
    src.loop = true;
    const bp = filter(g, 'bandpass', Math.min(opts.noiseF + f, 8000), 0.8);
    const ng = gain(g);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(v * opts.noise * (legato ? 0.8 : 2.4), t + 0.02);
    ng.gain.setTargetAtTime(v * opts.noise, t + 0.03, 0.06);
    ng.gain.setTargetAtTime(0, t + dur, opts.release);
    src.connect(bp).connect(ng).connect(dest);
    src.start(t, g.rng.next() * 2);
    src.stop(stop);
  };
}

export const cello = bowed({ name: 'bowed', voices: [-5, 0, 5], level: 0.36, attack: 0.2, release: 0.14, vibRate: 5.2, vibDepth: 0.0038, vibDelay: 0.26, tilt: 7, noise: 0.018, noiseF: 1700, lo: 300 });
export const fiddle = bowed({ name: 'bowed', voices: [-3, 3], level: 0.3, attack: 0.05, release: 0.05, vibRate: 6.1, vibDepth: 0.005, vibDelay: 0.14, tilt: 9, noise: 0.022, noiseF: 2800, lo: 600 });

export const accordion: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.2, 0.03, 0.9, 0.05);
  const lp = filter(g, 'lowpass', 2800 + 1600 * v, 0.6);
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

/**
 * Ensemble strings (the pad): five bowed voices per note spread across the stereo field with slow
 * shared detune drift, a swelling lowpass, into the track's formant-EQ insert.
 */
export const pad: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const attack = clamp(dur * 0.35, 0.35, 1.3);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.1, attack, 1, 0.6);
  const lp = filter(g, 'lowpass', 900, 0.5);
  lp.frequency.setValueAtTime(600, t);
  lp.frequency.linearRampToValueAtTime(1500 + 2600 * v, t + attack);
  lp.connect(a).connect(dest);
  const L = g.ctx.createStereoPanner();
  L.pan.value = -0.55;
  const R = g.ctx.createStereoPanner();
  R.pan.value = 0.55;
  L.connect(lp);
  R.connect(lp);
  const links: [AudioNode, AudioParam][] = [];
  [-13, -6, 0, 6, 13].forEach((det, i) => {
    const osc = g.ctx.createOscillator();
    osc.setPeriodicWave(wave(g.ctx, 'bowed', BOWED));
    osc.frequency.setValueAtTime(f, t);
    osc.detune.value = det + g.rng.gauss(2);
    g.drift(i).connect(osc.detune);
    links.push([g.drift(i), osc.detune]);
    osc.connect(i % 2 ? L : R);
    osc.start(t);
    osc.stop(stop);
  });
  detachLater(g, stop, links);
};

/** Warm sine/triangle bass for the soft themes, with a 2nd harmonic so it reads on small speakers. */
export const softBass: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.5, 0.02, 0.7, 0.09);
  const lp = filter(g, 'lowpass', 900, 0.5);
  lp.connect(a).connect(dest);
  sine(g, f, t, stop).connect(lp);
  const h2 = gain(g, 0.32);
  sine(g, f * 2, t, stop).connect(h2).connect(lp);
  const tri = g.ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.value = f;
  const tg = gain(g, 0.3);
  tri.connect(tg).connect(lp);
  tri.start(t);
  tri.stop(stop);
};

/** Slow evolving drone (mine): beating detuned partials under a breathing lowpass. */
export const drone: InstrumentFn = (g, dest, t, m, dur, v) => {
  const f = mtof(m);
  const a = gain(g);
  const stop = sustainEnv(a.gain, t, dur, v * 0.26, Math.min(3, dur * 0.4), 1, 1.4);
  const lp = filter(g, 'lowpass', 700, 0.8);
  const lfo = sine(g, 0.07, t, stop);
  const lg = gain(g, 240);
  lfo.connect(lg).connect(lp.frequency);
  lp.connect(a).connect(dest);
  for (const [ratio, amp, det] of [[1, 0.8, 0], [1, 0.55, 5], [1.5, 0.3, -3], [2, 0.5, 7], [3, 0.22, 0], [4, 0.1, -4]] as const) {
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
  noiseHit(g, dest, t, { type: 'bandpass', f: 7400, q: 0.8, amp: v * 0.55, attack: 0.01, tau: 0.032 });
  noiseHit(g, dest, t + 0.004, { type: 'bandpass', f: 4300, q: 1.2, amp: v * 0.16, attack: 0.006, tau: 0.02 });
};
export const woodblock: InstrumentFn = (g, dest, t, m, _d, v) => {
  const f = m > 0 ? mtof(m) : 820;
  partial(g, dest, f, t, v * 0.4, 0.03, 0.001);
  noiseHit(g, dest, t, { f: f * 2.4, q: 5, amp: v * 0.15, tau: 0.01 });
};
export const bodhran: InstrumentFn = (g, dest, t, _m, _d, v) => {
  const o = sine(g, 110, t, t + 0.6);
  o.frequency.exponentialRampToValueAtTime(62, t + 0.12);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.75, t + 0.003);
  a.gain.setTargetAtTime(0, t + 0.003, 0.09);
  o.connect(a).connect(dest);
  // Skin slap: the part a laptop speaker actually reproduces.
  noiseHit(g, dest, t, { f: 900, q: 1.2, amp: v * 0.3, tau: 0.025, buf: g.pink });
};
export const tambourine: InstrumentFn = (g, dest, t, _m, _d, v) => {
  noiseHit(g, dest, t, { type: 'highpass', f: 6500, amp: v * 0.12, attack: 0.003, tau: 0.03 });
  noiseHit(g, dest, t + 0.004, { f: 7400, q: 9, amp: v * 0.35, tau: 0.06 });
  noiseHit(g, dest, t + 0.009, { f: 9800, q: 9, amp: v * 0.25, tau: 0.05 });
};
export const softKick: InstrumentFn = (g, dest, t, _m, _d, v) => {
  const o = sine(g, 110, t, t + 0.6);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.09);
  const a = gain(g);
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(v * 0.7, t + 0.004);
  a.gain.setTargetAtTime(0, t + 0.004, 0.1);
  o.connect(a).connect(dest);
  noiseHit(g, dest, t, { type: 'lowpass', f: 1800, amp: v * 0.08, tau: 0.006, buf: g.pink });
};
export const brush: InstrumentFn = (g, dest, t, _m, _d, v) => {
  noiseHit(g, dest, t, { f: 4200, q: 0.6, amp: v * 0.3, attack: 0.018, tau: 0.05, buf: g.pink });
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
  noiseHit(g, dest, t, { f: 1500, q: 1.5, amp: v * 0.14, tau: 0.012 });
};
export const triangleDing: InstrumentFn = (g, dest, t, _m, _d, v) => {
  partial(g, dest, 4186, t, v * 0.2, 0.45, 0.001);
  partial(g, dest, 6280, t, v * 0.1, 0.3, 0.001);
  partial(g, dest, 9100, t, v * 0.05, 0.14, 0.001);
};

export const INSTRUMENTS = {
  kalimba, marimba, musicBox, bell, celesta, steelPan, epiano,
  guitar, harp, ukulele, pizz, upright,
  flute, whistle, ocarina, clarinet, cello, fiddle, accordion, pad, softBass, drone, glass,
  shaker, woodblock, bodhran, tambourine, softKick, brush, conga, triangleDing, ride,
} satisfies Record<string, InstrumentFn>;

export type InstrumentName = keyof typeof INSTRUMENTS;

/** Which instruments sustain (get legato glides, no strums). */
export const SUSTAINED: ReadonlySet<InstrumentName> = new Set(['flute', 'whistle', 'ocarina', 'clarinet', 'cello', 'fiddle', 'accordion', 'pad', 'softBass', 'drone']);

/** Seconds a note keeps sounding after its written end (voice budget). */
export const TAIL: Partial<Record<InstrumentName, number>> = {
  kalimba: 1.5, marimba: 1, ride: 1.2, musicBox: 2, celesta: 1.8, bell: 3, steelPan: 1.5, harp: 2, guitar: 1, glass: 6, drone: 3, pad: 1.5, epiano: 0.9,
};

function bodyInsert(kind: BodyKind, wet: number, dry: number): (g: AudioGraph, out: AudioNode) => AudioNode {
  return (g, out) => {
    const input = gain(g, 1);
    const conv = g.ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = g.body(kind);
    const w = gain(g, wet);
    if (dry > 0) input.connect(gain(g, dry)).connect(out);
    input.connect(conv).connect(w).connect(out);
    return input;
  };
}

/**
 * Per-track inserts, created once per (track, instrument) by the music player: instrument bodies
 * for the bowed strings, formant EQ for the string ensemble.
 */
export const INSERTS: Partial<Record<InstrumentName, (g: AudioGraph, out: AudioNode) => AudioNode>> = {
  cello: bodyInsert('cello', 0.8, 0),
  fiddle: bodyInsert('violin', 0.8, 0),
  pad: (g, out) => {
    const hp = filter(g, 'highpass', 150, 0.6);
    const f1 = filter(g, 'peaking', 400, 1.3, 2.5);
    const f2 = filter(g, 'peaking', 1200, 1.6, 2);
    const f3 = filter(g, 'peaking', 2800, 2, 2.5);
    hp.connect(f1).connect(f2).connect(f3).connect(out);
    return hp;
  },
};
