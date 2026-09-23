/**
 * Fishing + seaside sound (procedural WebAudio, no files). Its own tiny context, created on the
 * first user gesture:
 *   whoosh (cast), zip (line paying out), plop (bobber lands), nibble tick, bite ding,
 *   reel clicks (rate follows the crank), fish splash, catch fanfare (pentatonic arpeggio + bell),
 *   escape (falling boop), treasure sparkle, and a surf bed + gull cries while on the beach.
 */
export class FishingSfx {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private surf: { g: GainNode; f: BiquadFilterNode } | null = null;
  private beach = false;
  private surfT = 0;
  private nextGull = 4;
  private reelAcc = 0;
  volume = 0.55;

  constructor() {
    const start = (): void => {
      if (!this.ctx) this.boot();
      else if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  private boot(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // Pinkish noise (smoother surf / splashes than white).
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    if (this.beach) this.startSurf();
  }

  private get t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noiseSrc(): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  private env(g: GainNode, a: number, peak: number, dcy: number, t0 = this.t): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dcy);
  }

  private tone(freq: number, dur: number, type: OscillatorType, peak: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = this.t + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    this.env(g, 0.006, peak, dur, t0);
    o.connect(g).connect(this.out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private burst(dur: number, f0: number, f1: number, peak: number, q = 1.2, delay = 0): void {
    const ctx = this.ctx;
    const s = this.noiseSrc();
    if (!ctx || !s) return;
    const t0 = this.t + delay;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    this.env(g, Math.min(0.03, dur * 0.2), peak, dur, t0);
    s.connect(f).connect(g).connect(this.out);
    s.start(t0);
    s.stop(t0 + dur + 0.1);
  }

  whoosh(power: number): void {
    this.burst(0.32, 300, 2400 + power * 1600, 0.35 + power * 0.25, 0.9);
  }

  zip(dur: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Ratchety line paying out: fast clicks slowing down.
    for (let i = 0; i < 14; i++) {
      const k = i / 14;
      this.tone(2400 - k * 800, 0.012, 'square', 0.035 * (1 - k), undefined, Math.pow(k, 1.6) * dur);
    }
  }

  plop(): void {
    this.tone(520, 0.14, 'sine', 0.3, 170);
    this.burst(0.18, 1600, 500, 0.16, 1.4);
  }

  nibble(): void {
    this.tone(760, 0.05, 'sine', 0.12, 520);
  }

  bite(): void {
    this.tone(1320, 0.18, 'triangle', 0.28);
    this.tone(1980, 0.22, 'sine', 0.14, undefined, 0.05);
    this.burst(0.3, 2200, 700, 0.35, 0.8);
  }

  hook(): void {
    this.burst(0.2, 900, 3200, 0.3, 0.8);
    this.tone(180, 0.12, 'sine', 0.25, 90);
  }

  /** Call every frame while reeling; `rate` = clicks per second (0 = silent). */
  reel(dt: number, rate: number): void {
    if (!this.ctx || rate <= 0) return;
    this.reelAcc += dt * rate;
    while (this.reelAcc >= 1) {
      this.reelAcc -= 1;
      this.tone(3000 + Math.random() * 400, 0.01, 'square', 0.03);
    }
  }

  fishSplash(big = false): void {
    this.burst(big ? 0.45 : 0.25, 2600, 400, big ? 0.4 : 0.22, 0.7);
  }

  catchJingle(quality: number): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, quality >= 2 ? 1318.5 : 1174.66];
    notes.forEach((f, i) => {
      this.tone(f, 0.28, 'triangle', 0.16, undefined, i * 0.085);
      this.tone(f * 2, 0.18, 'sine', 0.05, undefined, i * 0.085 + 0.01);
    });
    this.tone(2093, 0.9, 'sine', 0.08, undefined, 0.45);
  }

  escape(): void {
    this.tone(440, 0.35, 'triangle', 0.18, 180);
    this.tone(330, 0.4, 'sine', 0.1, 140, 0.12);
  }

  treasure(): void {
    [1568, 2093, 2637, 3136].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.09, undefined, i * 0.06));
  }

  /** Beach ambience on / off (surf bed + gulls). */
  setBeach(on: boolean): void {
    this.beach = on;
    if (!this.ctx) return;
    if (on) this.startSurf();
    else if (this.surf) {
      this.surf.g.gain.setTargetAtTime(0, this.t, 0.6);
    }
  }

  private startSurf(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.surf) {
      const s = this.noiseSrc()!;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.out);
      s.start();
      this.surf = { g, f };
    }
  }

  /** Per-frame: swells the surf with the wave cycle and sprinkles gull cries. */
  update(dt: number, wavePhase: number): void {
    if (!this.ctx || !this.surf) return;
    this.surfT += dt;
    if (this.beach) {
      const swell = Math.pow(Math.max(0, Math.sin(wavePhase)), 3);
      this.surf.g.gain.setTargetAtTime(0.1 + swell * 0.28, this.t, 0.25);
      this.surf.f.frequency.setTargetAtTime(420 + swell * 1400, this.t, 0.3);
      this.nextGull -= dt;
      if (this.nextGull <= 0) {
        this.nextGull = 5 + Math.random() * 9;
        this.gull();
      }
    }
  }

  private gull(): void {
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 900 + Math.random() * 300;
    for (let i = 0; i < n; i++) {
      this.tone(base * 1.25, 0.16, 'sawtooth', 0.018, base * 0.8, i * 0.2);
      this.tone(base * 2.5, 0.12, 'sine', 0.012, base * 1.7, i * 0.2);
    }
  }
}
