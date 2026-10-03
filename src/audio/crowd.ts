/**
 * Crowd life for the town square and festivals — the sense of a place full of people, made of
 * events rather than a noise wash:
 *
 *  - walla: 4 (town) to 8 (festival) persistent "talkers", each a glottal sawtooth through three
 *    vowel formants with consonant noise, speaking phrases of sim-speak at its own pitch, rate and
 *    distance. Phrases have a pitch arch with declination, stressed syllables, questions that
 *    rise, turn-taking pauses — so the spectrogram shows formant streaks, not a flat band. The
 *    talkers are persistent nodes driven by automation (no per-syllable node churn), built on first
 *    use and torn down after a while out of town.
 *  - laughter (a talker breaks into "ha-ha-ha"), festival applause (a pre-synthesised burst of
 *    individual clappers, played as one buffer), distant footsteps on cobbles, and the shop door's
 *    bell by day.
 *
 * Scheduled on the ambience look-ahead clock, so it renders identically live and offline.
 */
import type { AudioGraph } from './graph';
import { Rand, clamp } from './dsp';
import { noiseHit } from './instruments';

/** Vowel formants (F1, F2, F3, Hz) — an adult tract; scaled per talker. */
const VOWELS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [300, 2200, 2900],
  [570, 840, 2410],
  [440, 1020, 2240],
  [660, 1720, 2410],
];

interface Talker {
  osc: OscillatorNode;
  noise: AudioBufferSourceNode;
  f: BiquadFilterNode[];
  fric: BiquadFilterNode;
  fricGain: GainNode;
  env: GainNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode;
  level: GainNode;
  /** Speaking pitch (Hz), formant scale, syllables / s. */
  base: number;
  tract: number;
  rate: number;
  /** Target level at its current distance. */
  lvl: number;
  next: number;
}

export interface CrowdState {
  /** People about (town by day, any festival). */
  active: boolean;
  festive: boolean;
  /** 0..1 how busy (scales talkers and event rates). */
  density: number;
}

export class Crowd {
  private talkers: Talker[] = [];
  private out: GainNode;
  private rng: Rand;
  private next: Record<string, number> = {};
  private applause: AudioBuffer | null = null;
  private idleSince = -1;
  private wasActive = false;

  constructor(private g: AudioGraph, dest: AudioNode, private send: AudioNode, seed = 31) {
    this.rng = new Rand(seed);
    this.out = g.ctx.createGain();
    this.out.connect(dest);
  }

  /** Node count held by the persistent talkers (perf telemetry). */
  get size(): number {
    return this.talkers.length;
  }

  tick(now: number, until: number, s: CrowdState): void {
    const want = s.active ? Math.round((s.festive ? 8 : 4) * clamp(0.5 + s.density * 0.5, 0.5, 1)) : 0;
    if (s.active) {
      this.idleSince = -1;
      while (this.talkers.length < want) this.talkers.push(this.makeTalker(now));
    } else if (this.talkers.length) {
      if (this.wasActive) for (const tk of this.talkers) tk.level.gain.setTargetAtTime(0, now, 0.8);
      if (this.idleSince < 0) this.idleSince = now;
      // Out of town for a while: free the persistent voices.
      if (now - this.idleSince > 12) this.release();
    }
    this.wasActive = s.active;
    if (!s.active) {
      for (const k of ['steps', 'bell', 'clap']) this.next[k] = Math.max(this.next[k] ?? 0, now + this.rng.next() * 3);
      return;
    }
    for (let i = 0; i < this.talkers.length; i++) {
      const tk = this.talkers[i]!;
      // (Talkers beyond the wanted count finish their phrase and fall quiet.)
      if (i >= want || tk.next > until) continue;
      const t = Math.max(tk.next, now);
      const end = this.phrase(tk, t, s);
      tk.next = end + this.rng.range(0.35, s.festive ? 1.4 : 2.6);
    }
    const r = this.rng;
    const due = (k: string, min: number, max: number): number | null => {
      const n = this.next[k] ?? now + r.next() * min;
      if (n > until) {
        this.next[k] = n;
        return null;
      }
      this.next[k] = Math.max(n, now) + min + r.next() * (max - min);
      return Math.max(n, now);
    };
    let t = due('steps', s.festive ? 1.5 : 2.5, s.festive ? 4 : 7);
    if (t !== null) this.footsteps(t);
    t = due('bell', 16, 40);
    if (t !== null && !s.festive) this.doorBell(t);
    t = due('clap', 22, 55);
    if (t !== null && s.festive) this.clap(t, r.range(0.7, 1));
  }

  /** Free every persistent talker (leaving town, disposing the service). */
  release(): void {
    const t = this.g.ctx.currentTime;
    for (const tk of this.talkers) {
      try {
        tk.osc.stop(t + 0.05);
        tk.noise.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
      tk.level.disconnect();
    }
    this.talkers = [];
  }

  // ───────────────────────────────────────────── talkers

  private makeTalker(now: number): Talker {
    const ctx = this.g.ctx;
    const r = this.rng;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sum = ctx.createGain();
    const f = [0, 1, 2].map((i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = [5, 8, 11][i]!;
      const a = ctx.createGain();
      a.gain.value = [1, 0.6, 0.28][i]!;
      osc.connect(bp).connect(a).connect(sum);
      return bp;
    });
    const env = ctx.createGain();
    env.gain.value = 0;
    sum.connect(env);
    const noise = ctx.createBufferSource();
    noise.buffer = this.g.white;
    noise.loop = true;
    const fric = ctx.createBiquadFilter();
    fric.type = 'bandpass';
    fric.Q.value = 1.6;
    fric.frequency.value = 4200;
    const fricGain = ctx.createGain();
    fricGain.gain.value = 0;
    noise.connect(fric).connect(fricGain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    env.connect(lp);
    fricGain.connect(lp);
    const pan = ctx.createStereoPanner();
    const level = ctx.createGain();
    level.gain.value = 0;
    const sg = ctx.createGain();
    sg.gain.value = 0.5;
    lp.connect(pan).connect(level).connect(this.out);
    level.connect(sg).connect(this.send);
    osc.start(now);
    noise.start(now, r.next() * 2);
    const tk: Talker = { osc, noise, f, fric, fricGain, env, lp, pan, level, base: 0, tract: 1, rate: 5, lvl: 0, next: now + r.range(0.1, 2.5) };
    this.recast(tk, now);
    return tk;
  }

  /** A different person at a different spot in the square (pitch, tract, pace, distance, side). */
  private recast(tk: Talker, t: number): void {
    const r = this.rng;
    const who = r.next();
    // Men, women, the odd child.
    tk.base = who < 0.45 ? r.range(98, 140) : who < 0.9 ? r.range(180, 245) : r.range(260, 320);
    tk.tract = who < 0.45 ? r.range(0.86, 0.95) : who < 0.9 ? r.range(1.02, 1.12) : r.range(1.18, 1.3);
    tk.rate = r.range(4.2, 6.2);
    const dist = r.range(0.2, 1);
    tk.pan.pan.setTargetAtTime(r.range(-0.85, 0.85), t, 0.05);
    tk.lp.frequency.setTargetAtTime(3400 - 2100 * dist, t, 0.05);
    // Close talkers ~8 dB over the far ones; with 4–8 overlapping, the square reads as people talking.
    tk.lvl = 0.1 * (1 - 0.62 * dist);
    tk.level.gain.setTargetAtTime(tk.lvl, t, 0.3);
  }

  /** One phrase of sim-speak (3–13 syllables, sometimes ending in a laugh). Returns its end time. */
  private phrase(tk: Talker, t0: number, s: CrowdState): number {
    const r = this.rng;
    if (r.chance(0.18)) this.recast(tk, t0);
    else tk.level.gain.setTargetAtTime(tk.lvl, t0, 0.3);
    const n = r.int(3, 13);
    const question = r.chance(0.2);
    const start = r.range(0.5, 2.5);
    let t = t0;
    const osc = tk.osc.frequency;
    osc.setTargetAtTime(tk.base * Math.pow(2, start / 12), t, 0.02);
    for (let i = 0; i < n; i++) {
      const dur = (1 / tk.rate) * r.range(0.7, 1.3);
      const stress = i % 3 === 0 || r.chance(0.15);
      const v = VOWELS[r.int(0, VOWELS.length - 1)]!;
      // Pitch: an arch that declines across the phrase; stressed syllables jump up; a question
      // lifts on its last two syllables.
      const decl = start - (i / Math.max(1, n - 1)) * (start + 2.5);
      const semis = decl + (stress ? 1.8 : 0) + r.range(-0.6, 0.6) + (question && i >= n - 2 ? 3 + (i - n + 2) * 3 : 0);
      osc.setTargetAtTime(tk.base * Math.pow(2, semis / 12), t, 0.03);
      for (let k = 0; k < 3; k++) tk.f[k]!.frequency.setTargetAtTime(Math.min(5000, v[k]! * tk.tract), t, 0.018);
      // A consonant before about a third of the syllables: a short fricative / burst.
      if (r.chance(0.32)) {
        tk.fric.frequency.setValueAtTime(r.pick([2600, 3800, 5200]), Math.max(0, t - 0.04));
        tk.fricGain.gain.setTargetAtTime(0.12, Math.max(0, t - 0.045), 0.008);
        tk.fricGain.gain.setTargetAtTime(0, t - 0.004, 0.01);
      }
      const amp = stress ? 1 : r.range(0.55, 0.8);
      tk.env.gain.setTargetAtTime(amp, t, 0.014);
      tk.env.gain.setTargetAtTime(amp * 0.12, t + dur * 0.72, 0.012);
      t += dur;
      // A breath mid-phrase now and then.
      if (i > 2 && i < n - 2 && r.chance(0.08)) t += r.range(0.12, 0.25);
    }
    tk.env.gain.setTargetAtTime(0, t, 0.03);
    // Laughter: more at festivals.
    if (r.chance(s.festive ? 0.2 : 0.07)) t = this.laugh(tk, t + r.range(0.05, 0.25));
    return t + 0.1;
  }

  /** "Ha-ha-ha": 3–6 breathy pulses on an open vowel, pitched up and stepping down. */
  private laugh(tk: Talker, t0: number): number {
    const r = this.rng;
    const n = r.int(3, 6);
    const per = r.range(0.13, 0.17);
    const f0 = tk.base * r.range(1.45, 1.75);
    for (let k = 0; k < 3; k++) tk.f[k]!.frequency.setTargetAtTime(Math.min(5000, VOWELS[0]![k]! * tk.tract), t0 - 0.02, 0.01);
    tk.fric.frequency.setValueAtTime(1600, Math.max(0, t0 - 0.03));
    let t = t0;
    for (let i = 0; i < n; i++) {
      tk.osc.frequency.setTargetAtTime(f0 * Math.pow(2, (-i * 0.9 + r.range(-0.4, 0.4)) / 12), t, 0.01);
      // the "h": an aspirated breath into the vowel
      tk.fricGain.gain.setTargetAtTime(0.16, t - 0.03, 0.006);
      tk.fricGain.gain.setTargetAtTime(0, t + 0.01, 0.012);
      const a = 1.15 * (1 - i * 0.1);
      tk.env.gain.setTargetAtTime(a, t, 0.008);
      tk.env.gain.setTargetAtTime(0.05, t + per * 0.5, 0.012);
      t += per * r.range(0.92, 1.08);
    }
    tk.env.gain.setTargetAtTime(0, t, 0.03);
    return t;
  }

  // ───────────────────────────────────────────── one-shots

  /** Somebody crossing the square: 2–5 soft steps on cobbles, far away. */
  private footsteps(t0: number): void {
    const r = this.rng;
    const d = this.place(r.range(-0.8, 0.8), r.range(0.45, 0.9));
    const n = r.int(2, 5);
    const per = r.range(0.42, 0.56);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * per + r.range(-0.02, 0.02);
      const a = 1 - Math.abs(i - n / 2) / n;
      noiseHit(this.g, d, t, { f: r.range(2200, 3000), q: 2.5, amp: 0.05 * a, tau: 0.007 });
      noiseHit(this.g, d, t, { type: 'lowpass', f: 420, amp: 0.06 * a, tau: 0.018, buf: this.g.pink });
    }
  }

  /** The shop door: a little brass bell jingles, the latch knocks. */
  private doorBell(t0: number): void {
    const ctx = this.g.ctx;
    const r = this.rng;
    const d = this.place(r.range(-0.7, 0.7), r.range(0.4, 0.7));
    const f = r.range(2100, 2600);
    const n = r.int(3, 5);
    let t = t0;
    for (let i = 0; i < n; i++) {
      const a = 0.05 * (1 - i * 0.16);
      for (const [ratio, amp, tau] of [[1, 1, 0.22], [2.32, 0.45, 0.12], [4.25, 0.2, 0.06]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f * ratio * r.range(0.995, 1.005);
        const gn = ctx.createGain();
        gn.gain.setValueAtTime(0, t);
        gn.gain.linearRampToValueAtTime(a * amp, t + 0.002);
        gn.gain.setTargetAtTime(0, t + 0.002, tau);
        o.connect(gn).connect(d);
        o.start(t);
        o.stop(t + tau * 7);
      }
      t += r.range(0.06, 0.12);
    }
    noiseHit(this.g, d, t0 + r.range(0.35, 0.6), { type: 'lowpass', f: 380, amp: 0.09, attack: 0.003, tau: 0.03, buf: this.g.pink });
  }

  /** Festival applause: a burst of individual clappers (one pre-synthesised stereo buffer). */
  private clap(t: number, size: number): void {
    const ctx = this.g.ctx;
    this.applause ??= synthApplause(ctx.sampleRate, this.rng);
    const src = ctx.createBufferSource();
    src.buffer = this.applause;
    src.playbackRate.value = this.rng.range(0.93, 1.07);
    const d = this.place(this.rng.range(-0.3, 0.3), 0.55);
    const gn = ctx.createGain();
    gn.gain.value = 0.5 * size;
    src.connect(gn).connect(d);
    src.start(t);
  }

  private place(pan: number, dist: number): AudioNode {
    const ctx = this.g.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 - dist * 6000;
    const gn = ctx.createGain();
    gn.gain.value = 1 - dist * 0.6;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const sg = ctx.createGain();
    sg.gain.value = 0.3 + dist * 0.5;
    lp.connect(gn).connect(p).connect(this.out);
    p.connect(sg).connect(this.send);
    return lp;
  }
}

/**
 * ~3.6 s of applause: 16 clappers, each clapping at its own 3.5–5.5 Hz with jitter and its own hand
 * resonance (a 4 ms noise burst through a 700–2200 Hz two-pole resonator), panned across the field,
 * swelling in over ~0.4 s and thinning out as people stop.
 */
function synthApplause(sr: number, r: Rand): AudioBuffer {
  const secs = 3.6;
  const len = Math.floor(secs * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  for (let c = 0; c < 16; c++) {
    const rate = r.range(3.5, 5.5);
    const fc = r.range(700, 2200);
    const pan = r.range(-0.9, 0.9);
    const gl = Math.sqrt((1 - pan) / 2);
    const gr = Math.sqrt((1 + pan) / 2);
    const stop = r.range(1.8, 3.4);
    const vol = r.range(0.5, 1);
    // Two-pole resonator coefficients.
    const rr = 0.985;
    const a1 = -2 * rr * Math.cos((2 * Math.PI * fc) / sr);
    const a2 = rr * rr;
    let t = r.range(0, 0.45);
    while (t < stop) {
      const s0 = Math.floor(t * sr);
      const env = Math.min(1, t / 0.4) * (t > stop - 0.6 ? (stop - t) / 0.6 : 1);
      let y1 = 0;
      let y2 = 0;
      const n = Math.floor(0.03 * sr);
      for (let i = 0; i < n && s0 + i < len; i++) {
        const x = i < 0.004 * sr ? (r.next() * 2 - 1) * (1 - i / (0.004 * sr)) : 0;
        const y = x - a1 * y1 - a2 * y2;
        y2 = y1;
        y1 = y;
        // the crack of the palms (raw burst) plus the cupped-hand ring
        const v = (x * 0.6 + y * 0.08) * env * vol;
        L[s0 + i] = L[s0 + i]! + v * gl;
        R[s0 + i] = R[s0 + i]! + v * gr;
      }
      t += (1 / rate) * r.range(0.85, 1.15);
    }
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]!), Math.abs(R[i]!));
  const k = peak > 0 ? 0.5 / peak : 1;
  const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
  for (let i = 0; i < len; i++) {
    L[i] = L[i]! * k;
    R[i] = R[i]! * k;
  }
  buf.copyToChannel(L, 0);
  buf.copyToChannel(R, 1);
  return buf;
}
