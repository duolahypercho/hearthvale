/**
 * Mixer graph. Works on AudioContext and OfflineAudioContext alike.
 *
 *   music players ──► musicBus ──► duck ──► sideDuck ──► tone (muffle) ──► EQ ──► glue ──► musicVol ─┐
 *   ambience      ──► ambBus ──► ambRest ─────────────────────────────────────────────────────────────┤
 *   sfx           ──► sfxBus ─────────────────────────────────────────────────────────────────────────┼─► mix ─► limiter ─► soft clip ─► out
 *   ui / voices   ──► uiBus ──────────────────────────────────────────────────────────────────────────┘
 *        sends    ──► hall (music, joins before the duck), space (world sfx/ambience), cave (mine) ──► mix
 *
 * The glue compressor sits on the score alone, so gameplay SFX never pump the music and are never
 * squashed by it. Ducking is a real sidechain: world SFX (not footsteps / hover ticks) also feed
 * `duckKey`, an AudioWorklet envelope follower (ducker.ts) that pulls `sideDuck` down 2–3 dB with a
 * 30 ms attack and 250 ms release. `duckMusic` remains for deliberate musical stingers (a
 * scheduled dip that makes room for a fanfare).
 *
 * Levels: the graph starts at the game's default volume settings (DEFAULT_VOLUMES), so offline
 * renders measure exactly what a player hears at default settings.
 *
 * Shared resources so per-note cost stays low: a buffer cache for pre-rendered notes (plucked
 * strings, mallets), running LFOs shared by every vibrato, slow detune drifts for string
 * ensembles, generated instrument-body impulse responses, and a polyphony budget.
 */
import { attachDucker } from './ducker';
import { Rand, makeImpulse, makeNoise, pluckBuffer, softClipCurve, bodyImpulse, toBuffer, type PluckOptions, type BodyKind } from './dsp';

/**
 * Note-buffer cache cap in samples (24 M ≈ 96 MB of float32: the playing song's notes plus the next
 * one's, prefetched). Evicted notes are re-rendered by the worker when a song needs them again.
 */
const BUFFER_CAP_SAMPLES = 24_000_000;

/** The game's default volume settings (systems/audio.ts): the graph starts here. */
export const DEFAULT_VOLUMES = { master: 0.8, music: 0.7, sfx: 0.9, ambience: 0.7 };
/** Fixed bus trims under the user volumes. */
// SFX sit ~8 dB hotter than round 1 (the gameplay render: verbs must clear the score by +4 LU).
export const BUS_TRIM = { master: 0.8, music: 1, sfx: 2.2, ui: 0.9, ambience: 0.9 };

export interface GraphOptions {
  /** Offline only: apply the live polyphony budget (72 voices) so renders match the game. */
  liveBudget?: boolean;
  /** Offline: register-before-build flag — the ducker worklet module is loaded on this context. */
  worklet?: boolean;
}

export class AudioGraph {
  readonly ctx: BaseAudioContext;
  readonly out: GainNode;
  readonly mix: GainNode;
  readonly musicBus: GainNode;
  readonly duck: GainNode;
  /** Sidechain gain: driven by the SFX envelope follower (see ducker.ts). */
  readonly sideDuck: GainNode;
  /** Sidechain key: world SFX that should make the score step back. */
  readonly duckKey: GainNode;
  /** User music volume (after the glue compressor, so the glue sees the same level at any setting). */
  readonly musicVol: GainNode;
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
  /** Shared randomness (noise start offsets, detunes). SFX swap in their own stream while they build. */
  rng: Rand;
  private buffers = new Map<string, AudioBuffer>();
  /** Samples held by `buffers` (LRU-capped at BUFFER_CAP_SAMPLES; a playing source keeps its own). */
  private bufferSamples = 0;
  /** Note buffers handed over ready-made by the compose worker (compose.worker.ts via prefetch.ts). */
  provided = 0;
  /** Called with each note key the LRU drops (the worker forgets it sent it, and renders it again when due). */
  onEvict: ((key: string) => void) | null = null;
  private lfos = new Map<number, OscillatorNode>();
  private drifts: GainNode[] = [];
  private vibs: GainNode[] = [];
  private bodies = new Map<BodyKind, AudioBuffer>();
  private duckUntil = 0;
  private duckDepth = 1;
  /** Polyphony budget: [start, end] of every voice that may still sound (sorted by start). */
  private spans: [number, number][] = [];
  readonly maxVoices: number;
  readonly offline: boolean;
  /** Notes dropped by the budget (diagnostics). */
  dropped = 0;
  /** Highest simultaneous voice count the budget has granted (diagnostics). */
  peakVoices = 0;
  /** Which follower drives the sidechain: 'worklet', 'native' or null (not attached yet). */
  ducker: 'worklet' | 'native' | null = null;

  constructor(ctx: BaseAudioContext, seed = 1234, dest?: AudioNode, opts: GraphOptions = {}) {
    this.ctx = ctx;
    this.rng = new Rand(seed);
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.maxVoices = this.offline && !opts.liveBudget ? 100000 : 72;
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
    const V = DEFAULT_VOLUMES;
    this.out = g(V.master * BUS_TRIM.master);
    this.mix = g(1);
    // Master: DC / subsonic cleanup → brickwall-ish limiter → soft clip safety. No glue here: the
    // score has its own, so an SFX transient never pulls the music down by accident.
    const limiter = ctx.createDynamicsCompressor();
    // -1 dBFS: SFX transients need the headroom (the score itself sits ~18 dB below this).
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(0.9, 0.99);
    clip.oversample = '2x';
    // DC / subsonic cleanup (FM voices with 1:1 ratios produce a DC sideband).
    const hpf = bq('highpass', 24, 0.6);
    this.mix.connect(hpf).connect(limiter).connect(clip).connect(this.out).connect(dest ?? ctx.destination);

    this.musicBus = g(0.34);
    this.duck = g(1);
    this.sideDuck = g(1);
    this.duckKey = g(1);
    this.musicVol = g(V.music * BUS_TRIM.music);
    this.ambBus = g(V.ambience * BUS_TRIM.ambience);
    this.ambRest = g(1);
    this.sfxBus = g(V.sfx * BUS_TRIM.sfx);
    this.uiBus = g(V.sfx * BUS_TRIM.ui);
    this.musicTone = bq('lowpass', 20000, 0.5);
    // Music EQ: clear the 250 Hz mud, open the top (the synthesised ensemble reads dull without it).
    const mud = bq('peaking', 280, 0.9, -3);
    const presence = bq('peaking', 3200, 0.7, 2);
    const air = bq('highshelf', 7000, 0.7, 3);
    // Glue on the score only: 2:1 above -14 dBFS, so it only rounds off phrase climaxes (the score
    // runs around -16 LUFS here) and never flattens the phrase dynamics.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 2;
    glue.attack.value = 0.03;
    glue.release.value = 0.3;
    const glueMakeup = g(1);
    this.musicBus.connect(this.duck).connect(this.sideDuck).connect(this.musicTone).connect(mud).connect(presence).connect(air).connect(glue).connect(glueMakeup).connect(this.musicVol).connect(this.mix);
    this.ambBus.connect(this.ambRest).connect(this.mix);
    this.sfxBus.connect(this.mix);
    this.uiBus.connect(this.mix);
    if (opts.worklet) this.attachSidechain(true);

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
    if (b) {
      // Most recently used goes to the back of the eviction queue.
      this.buffers.delete(key);
      this.buffers.set(key, b);
      return b;
    }
    b = make();
    this.store(key, b);
    return b;
  }

  /** Has a buffer been cached under `key` (the worker skips rendering those). */
  hasBuffer(key: string): boolean {
    return this.buffers.has(key);
  }

  /** A worker-rendered note: cache it unless the frame already built one. */
  provide(key: string, data: Float32Array, sr: number): void {
    if (this.buffers.has(key)) return;
    this.provided++;
    this.store(key, toBuffer(this.ctx, data, sr));
  }

  /** Cached buffer memory in MB (diagnostics). */
  get bufferMb(): number {
    return (this.bufferSamples * 4) / 1048576;
  }

  private store(key: string, b: AudioBuffer): void {
    this.buffers.set(key, b);
    this.bufferSamples += b.length * b.numberOfChannels;
    // A long session visits every song: keep the note cache bounded (~96 MB), oldest out first.
    while (this.bufferSamples > BUFFER_CAP_SAMPLES && this.buffers.size > 1) {
      const [k, old] = this.buffers.entries().next().value!;
      this.buffers.delete(k);
      this.bufferSamples -= old.length * old.numberOfChannels;
      this.onEvict?.(k);
    }
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

  /**
   * Section vibrato in cents, shared: five "players", each with their own rate (4.8–6.1 Hz) and
   * depth (±7–11 cents) that itself breathes slowly, so a string section's desks never vibrate in
   * lockstep — the summed shimmer (not a chorus pedal's periodic sweep) is what reads as an ensemble.
   */
  sectionVib(k: number): GainNode {
    if (!this.vibs.length) {
      const rates = [4.83, 5.17, 5.52, 5.79, 6.08];
      rates.forEach((rate, i) => {
        const o = this.ctx.createOscillator();
        o.frequency.value = rate;
        const d = this.ctx.createGain();
        d.gain.value = 7 + i;
        // The player's vibrato widens and narrows over ~8–14 s.
        const w = this.ctx.createOscillator();
        w.frequency.value = 0.071 + i * 0.013;
        const wd = this.ctx.createGain();
        wd.gain.value = 3;
        w.connect(wd).connect(d.gain);
        o.connect(d);
        o.start(0);
        w.start(0);
        this.vibs.push(d);
      });
    }
    return this.vibs[((k % 5) + 5) % 5]!;
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

  /**
   * Connect the sidechain follower (idempotent). `worklet` = the hv-duck module is registered on
   * this context (see loadDucker); otherwise a native-node follower is used.
   */
  attachSidechain(worklet: boolean): void {
    if (this.ducker) return;
    try {
      attachDucker(this.ctx, this.duckKey, this.sideDuck, worklet);
      this.ducker = worklet ? 'worklet' : 'native';
    } catch {
      attachDucker(this.ctx, this.duckKey, this.sideDuck, false);
      this.ducker = 'native';
    }
  }

  /** Voices sounding right now. */
  get voices(): number {
    return this.countAt(this.ctx.currentTime);
  }

  /** Voices whose [start, end) covers `t`. Drops spans that ended before the context's clock. */
  private countAt(t: number): number {
    const now = this.ctx.currentTime;
    // Real time: anything that ended is gone for good. Offline the whole score is scheduled at
    // t = 0, so spans are only forgotten once they end well before the note being asked about.
    const horizon = this.offline ? Math.max(now, t - 30) : now;
    if (this.spans.length > 64) this.spans = this.spans.filter((s) => s[1] > horizon);
    let n = 0;
    for (const s of this.spans) if (s[0] <= t && s[1] > t) n++;
    return n;
  }

  /**
   * Ask for a voice from `t` for `dur` seconds. `prio` 0..3 (3 = must play: melody, bass, SFX):
   * low-priority parts are refused first as the budget fills. Returns false when refused. The
   * count is of voices actually sounding at `t` (a note scheduled 0.5 s ahead is not charged for
   * voices that will have ended by then).
   */
  voiceStart(t: number, dur: number, prio = 2): boolean {
    if (this.maxVoices > 10000) return true;
    const n = this.countAt(t);
    const load = n / this.maxVoices;
    if (load >= 1.25 || (load >= 1 && prio < 3) || (load >= 0.75 && prio < 2)) {
      this.dropped++;
      return false;
    }
    this.spans.push([t, t + dur]);
    if (n + 1 > this.peakVoices) this.peakVoices = n + 1;
    return true;
  }
}
