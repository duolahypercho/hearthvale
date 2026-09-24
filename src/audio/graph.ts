/**
 * Mixer graph. Works on AudioContext and OfflineAudioContext alike.
 *
 *   music players ──► musicBus ──► duck ──► tone (muffle) ──► EQ (-3 dB @280, +2 dB @3.2k, +3 dB shelf @7k) ─┐
 *   ambience      ──► ambBus ─────────────────────────────────────────────────────────────────────┤
 *   sfx           ──► sfxBus ─────────────────────────────────────────────────────────────────────┼─► mix ─► glue ─► limiter ─► soft clip ─► out
 *   ui / voices   ──► uiBus ──────────────────────────────────────────────────────────────────────┘
 *        sends    ──► hall (music), space (world sfx/ambience), cave (mine) convolvers ──► mix
 *
 * Ducking is "sidechain-ish": important one-shots schedule a short dip on the music duck gain
 * (attack 25 ms, hold, exponential recovery) instead of analysing the signal.
 *
 * Shared resources so per-note cost stays low: a buffer cache for pre-rendered notes (plucked
 * strings, mallets), running LFOs shared by every vibrato, slow detune drifts for string
 * ensembles, generated instrument-body impulse responses, and a polyphony budget.
 */
import { Rand, makeImpulse, makeNoise, pluckBuffer, softClipCurve, bodyImpulse, type PluckOptions, type BodyKind } from './dsp';

export class AudioGraph {
  readonly ctx: BaseAudioContext;
  readonly out: GainNode;
  readonly mix: GainNode;
  readonly musicBus: GainNode;
  readonly duck: GainNode;
  /** Music tone control: a gentle low-pass for "muffled" states (indoors, pause menu, fainting). */
  readonly musicTone: BiquadFilterNode;
  readonly ambBus: GainNode;
  /** Extra ambience lift while the score rests (so silences feel intentional). */
  readonly ambRest: GainNode;
  readonly sfxBus: GainNode;
  readonly uiBus: GainNode;
  /** Reverb send inputs. */
  readonly hall: GainNode;
  readonly space: GainNode;
  readonly cave: GainNode;
  private caveReturn: GainNode;
  private spaceReturn: GainNode;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  /** Stereo noise (L/R correlation ~0.3) for the ambience beds. */
  readonly whiteSt: AudioBuffer;
  readonly pinkSt: AudioBuffer;
  readonly brownSt: AudioBuffer;
  readonly rng: Rand;
  private buffers = new Map<string, AudioBuffer>();
  private lfos = new Map<number, OscillatorNode>();
  private drifts: GainNode[] = [];
  private bodies = new Map<BodyKind, AudioBuffer>();
  private duckUntil = 0;
  private duckDepth = 1;
  /** Polyphony budget (real time only): end times of sounding voices. */
  private voiceEnds: number[] = [];
  readonly maxVoices: number;
  readonly offline: boolean;
  /** Notes dropped by the budget (diagnostics). */
  dropped = 0;

  constructor(ctx: BaseAudioContext, seed = 1234, dest?: AudioNode) {
    this.ctx = ctx;
    this.rng = new Rand(seed);
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.maxVoices = this.offline ? 100000 : 72;
    const g = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const bq = (type: BiquadFilterType, f: number, q: number, gain = 0): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      b.gain.value = gain;
      return b;
    };
    this.out = g(0.8);
    this.mix = g(1);
    // Glue compressor (gentle) → brickwall-ish limiter → soft clip safety.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 2.2;
    glue.attack.value = 0.02;
    glue.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const makeup = g(1.18);
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    // DC / subsonic cleanup (FM voices with 1:1 ratios produce a DC sideband).
    const hpf = bq('highpass', 24, 0.6);
    this.mix.connect(hpf).connect(glue).connect(makeup).connect(limiter).connect(clip).connect(this.out).connect(dest ?? ctx.destination);

    this.musicBus = g(0.34);
    this.duck = g(1);
    this.ambBus = g(0.9);
    this.ambRest = g(1);
    this.sfxBus = g(0.85);
    this.uiBus = g(0.7);
    this.musicTone = bq('lowpass', 20000, 0.5);
    // Music EQ: clear the 250 Hz mud, open the top (the synthesised ensemble reads dull without it).
    const mud = bq('peaking', 280, 0.9, -3);
    const presence = bq('peaking', 3200, 0.7, 2);
    const air = bq('highshelf', 7000, 0.7, 3);
    this.musicBus.connect(this.duck).connect(this.musicTone).connect(mud).connect(presence).connect(air).connect(this.mix);
    this.ambBus.connect(this.ambRest).connect(this.mix);
    this.sfxBus.connect(this.mix);
    this.uiBus.connect(this.mix);

    const r = this.rng;
    this.white = makeNoise(ctx, 3, 'white', r);
    this.pink = makeNoise(ctx, 4, 'pink', r);
    this.brown = makeNoise(ctx, 4, 'brown', r);
    this.whiteSt = makeNoise(ctx, 3, 'white', r, 0.3);
    this.pinkSt = makeNoise(ctx, 4.3, 'pink', r, 0.3);
    this.brownSt = makeNoise(ctx, 4.1, 'brown', r, 0.35);

    // Reverbs: warm hall for music, short outdoor "space" for the world, long dark cave.
    const conv = (buf: AudioBuffer): ConvolverNode => {
      const c = ctx.createConvolver();
      c.normalize = false;
      c.buffer = buf;
      return c;
    };
    this.hall = g(1);
    const hallLo = bq('highpass', 200, 0.7); // keep the low end of the mix dry and clear
    const hallConv = conv(makeImpulse(ctx, { seconds: 3.2, decay: 2.6, damping: 0.32, predelay: 0.024, early: 0.5, width: 0.95 }, r));
    const hallRet = g(0.55);
    this.hall.connect(hallLo).connect(hallConv).connect(hallRet).connect(this.duck);

    this.space = g(1);
    const spaceConv = conv(makeImpulse(ctx, { seconds: 1.4, decay: 0.9, damping: 0.6, predelay: 0.012, early: 0.8, width: 0.8 }, r));
    this.spaceReturn = g(0.5);
    this.space.connect(spaceConv).connect(this.spaceReturn).connect(this.mix);

    this.cave = g(1);
    const caveLp = bq('lowpass', 3200, 0.7);
    const caveConv = conv(makeImpulse(ctx, { seconds: 5, decay: 4.2, damping: 0.8, predelay: 0.045, early: 1, width: 1 }, r));
    this.caveReturn = g(0.6);
    this.cave.connect(caveLp).connect(caveConv).connect(this.caveReturn).connect(this.mix);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Karplus-Strong buffer cache (keyed per instrument flavour + midi note). */
  pluck(key: string, freq: number, o: PluckOptions): AudioBuffer {
    return this.buffer(key, () => pluckBuffer(this.ctx, freq, o, new Rand((freq * 1000) | 0)));
  }

  /** Generic pre-rendered note cache. */
  buffer(key: string, make: () => AudioBuffer): AudioBuffer {
    let b = this.buffers.get(key);
    if (!b) {
      b = make();
      this.buffers.set(key, b);
    }
    return b;
  }

  /** A free-running sine LFO shared by every voice that wants this rate (vibrato, tremolo). */
  lfo(rate: number): OscillatorNode {
    const key = Math.round(rate * 100) / 100;
    let o = this.lfos.get(key);
    if (!o) {
      o = this.ctx.createOscillator();
      o.frequency.value = key;
      o.start(0);
      this.lfos.set(key, o);
    }
    return o;
  }

  /**
   * Slow, irregular detune drift in cents (two incommensurate sines), shared: connect it to any
   * number of oscillator `detune` params. Three independent drifts (k = 0..2).
   */
  drift(k: number): GainNode {
    if (!this.drifts.length) {
      for (let i = 0; i < 3; i++) {
        const sum = this.ctx.createGain();
        sum.gain.value = 1;
        for (const [rate, depth] of [[0.07 + i * 0.023, 3.2], [0.19 + i * 0.041, 1.8]] as const) {
          const o = this.ctx.createOscillator();
          o.frequency.value = rate;
          const d = this.ctx.createGain();
          d.gain.value = depth;
          o.connect(d).connect(sum);
          o.start(0);
        }
        this.drifts.push(sum);
      }
    }
    return this.drifts[((k % 3) + 3) % 3]!;
  }

  /** Generated instrument-body impulse response (violin / cello / guitar box). */
  body(kind: BodyKind): AudioBuffer {
    let b = this.bodies.get(kind);
    if (!b) {
      b = bodyImpulse(this.ctx, kind, new Rand(kind.length * 977));
      this.bodies.set(kind, b);
    }
    return b;
  }

  /**
   * Duck the music: `depth` is the gain to dip to (0.5 = -6 dB), held for `hold` seconds
   * then released over ~0.6 s. Overlapping ducks extend rather than stack.
   */
  duckMusic(at: number, depth = 0.6, hold = 0.3, release = 0.7): void {
    const g = this.duck.gain;
    const t = Math.max(at, this.ctx.currentTime);
    const d = Math.min(depth, t < this.duckUntil ? this.duckDepth : 1);
    g.cancelScheduledValues(t);
    g.setTargetAtTime(d, t, 0.012);
    g.setTargetAtTime(1, t + hold, release / 3);
    this.duckUntil = t + hold;
    this.duckDepth = d;
  }

  /**
   * Muffle the score (0 = open, 1 = heavily muffled, as if through a wall). Smooth, so it can be
   * driven every frame.
   */
  setMusicMuffle(amount: number, at = this.ctx.currentTime, tau = 0.4): void {
    const a = Math.max(0, Math.min(1, amount));
    this.musicTone.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, a), at, tau);
  }

  /** Continuous mix state per environment (0..1 cave amount, e.g. in the mine). */
  setCave(amount: number, at = this.ctx.currentTime): void {
    this.caveReturn.gain.setTargetAtTime(0.6 * amount, at, 0.8);
    this.spaceReturn.gain.setTargetAtTime(0.5 * (1 - amount * 0.7), at, 0.8);
  }

  /** Lift the ambience a little while the score rests (0..1). */
  setAmbienceLift(amount: number, at = this.ctx.currentTime): void {
    this.ambRest.gain.setTargetAtTime(1 + 0.41 * amount, at, 1.5); // +3 dB
  }

  /** Voices sounding right now (real time). */
  get voices(): number {
    this.prune();
    return this.voiceEnds.length;
  }

  private prune(): void {
    const now = this.ctx.currentTime;
    if (this.voiceEnds.length && this.voiceEnds[0]! <= now) {
      let k = 0;
      while (k < this.voiceEnds.length && this.voiceEnds[k]! <= now) k++;
      this.voiceEnds.splice(0, k);
    }
  }

  /**
   * Ask for a voice from `t` for `dur` seconds. `prio` 0..3 (3 = must play: melody, bass, SFX):
   * low-priority parts are refused first as the budget fills. Returns false when refused.
   */
  voiceStart(t: number, dur: number, prio = 2): boolean {
    if (this.offline) return true;
    this.prune();
    const load = this.voiceEnds.length / this.maxVoices;
    if (load >= 1.25 || (load >= 1 && prio < 3) || (load >= 0.75 && prio < 2)) {
      this.dropped++;
      return false;
    }
    const end = t + dur;
    // Keep the list sorted by end time (short list, insertion from the back).
    let i = this.voiceEnds.length;
    while (i > 0 && this.voiceEnds[i - 1]! > end) i--;
    this.voiceEnds.splice(i, 0, end);
    return true;
  }
}
