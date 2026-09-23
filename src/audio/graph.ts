/**
 * Mixer graph. Works on AudioContext and OfflineAudioContext alike.
 *
 *   music players ──► musicBus ──► duck ──┐
 *   ambience      ──► ambBus ─────────────┤
 *   sfx           ──► sfxBus ─────────────┼─► mix ─► glue comp ─► limiter ─► soft clip ─► master ─► out
 *   ui / voices   ──► uiBus ──────────────┘
 *        sends    ──► hall (music), space (world sfx/ambience), cave (mine) convolvers ──► mix
 *
 * Ducking is "sidechain-ish": important one-shots schedule a short dip on the music duck gain
 * (attack 25 ms, hold, exponential recovery) instead of analysing the signal.
 */
import { Rand, makeImpulse, makeNoise, pluckBuffer, softClipCurve, type PluckOptions } from './dsp';

export class AudioGraph {
  readonly ctx: BaseAudioContext;
  readonly out: GainNode;
  readonly mix: GainNode;
  readonly musicBus: GainNode;
  readonly duck: GainNode;
  readonly ambBus: GainNode;
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
  readonly rng: Rand;
  private plucks = new Map<string, AudioBuffer>();
  private duckUntil = 0;
  private duckDepth = 1;
  /** Active voice counter for polyphony limiting in real time. */
  voices = 0;
  readonly maxVoices: number;

  constructor(ctx: BaseAudioContext, seed = 1234, dest?: AudioNode) {
    this.ctx = ctx;
    this.rng = new Rand(seed);
    this.maxVoices = ctx instanceof OfflineAudioContext ? 10000 : 90;
    const g = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
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
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 24;
    hpf.Q.value = 0.6;
    this.mix.connect(hpf).connect(glue).connect(makeup).connect(limiter).connect(clip).connect(this.out).connect(dest ?? ctx.destination);

    this.musicBus = g(0.34);
    this.duck = g(1);
    this.ambBus = g(0.7);
    this.sfxBus = g(0.85);
    this.uiBus = g(0.7);
    this.musicBus.connect(this.duck).connect(this.mix);
    this.ambBus.connect(this.mix);
    this.sfxBus.connect(this.mix);
    this.uiBus.connect(this.mix);

    const r = this.rng;
    this.white = makeNoise(ctx, 3, 'white', r);
    this.pink = makeNoise(ctx, 4, 'pink', r);
    this.brown = makeNoise(ctx, 4, 'brown', r);

    // Reverbs: warm hall for music, short outdoor "space" for the world, long dark cave.
    const conv = (buf: AudioBuffer): ConvolverNode => {
      const c = ctx.createConvolver();
      c.normalize = false;
      c.buffer = buf;
      return c;
    };
    this.hall = g(1);
    const hallLo = ctx.createBiquadFilter();
    hallLo.type = 'highpass';
    hallLo.frequency.value = 180; // keep the low end of the mix dry and clear
    const hallConv = conv(makeImpulse(ctx, { seconds: 3.2, decay: 2.6, damping: 0.55, predelay: 0.022, early: 0.5, width: 0.95 }, r));
    const hallRet = g(0.55);
    this.hall.connect(hallLo).connect(hallConv).connect(hallRet).connect(this.duck);

    this.space = g(1);
    const spaceConv = conv(makeImpulse(ctx, { seconds: 1.4, decay: 0.9, damping: 0.6, predelay: 0.012, early: 0.8, width: 0.8 }, r));
    this.spaceReturn = g(0.5);
    this.space.connect(spaceConv).connect(this.spaceReturn).connect(this.mix);

    this.cave = g(1);
    const caveLp = ctx.createBiquadFilter();
    caveLp.type = 'lowpass';
    caveLp.frequency.value = 3200;
    const caveConv = conv(makeImpulse(ctx, { seconds: 5, decay: 4.2, damping: 0.8, predelay: 0.045, early: 1, width: 1 }, r));
    this.caveReturn = g(0.6);
    this.cave.connect(caveLp).connect(caveConv).connect(this.caveReturn).connect(this.mix);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Karplus-Strong buffer cache (keyed per instrument flavour + midi note). */
  pluck(key: string, freq: number, o: PluckOptions): AudioBuffer {
    let b = this.plucks.get(key);
    if (!b) {
      b = pluckBuffer(this.ctx, freq, o, new Rand((freq * 1000) | 0));
      this.plucks.set(key, b);
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

  /** Continuous mix state per environment (0..1 cave amount, e.g. in the mine). */
  setCave(amount: number, at = this.ctx.currentTime): void {
    this.caveReturn.gain.setTargetAtTime(0.6 * amount, at, 0.8);
    this.spaceReturn.gain.setTargetAtTime(0.5 * (1 - amount * 0.7), at, 0.8);
  }

  voiceStart(dur: number): boolean {
    if (this.voices >= this.maxVoices) return false;
    this.voices++;
    if (this.ctx instanceof AudioContext) setTimeout(() => this.voices--, (dur + 0.2) * 1000);
    return true;
  }
}
