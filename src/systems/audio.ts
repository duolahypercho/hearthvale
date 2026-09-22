/**
 * AudioSystem: fully procedural WebAudio (no files).
 *   ambient bed   wind in the leaves (noise → swept band-pass), daytime songbirds (FM chirp
 *                 phrases), night crickets (AM pulse trains), rain hiss + drips, the town fountain
 *   music         sparse generative pentatonic plucks through a synthetic-impulse reverb,
 *                 scale + timbre per season, quieter at night
 *   footsteps     per surface: grass (soft), dirt path (crunch), cobbles (click), snow (squeak)
 *   SFX           tool whoosh, hoe thunk, watering splash, harvest pop, item pickup, UI click, chatter
 * The context is created on the first user gesture (autoplay policy). Service `audio`:
 * setVolume(0..1), mute(bool), readonly running.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { TileType } from '../world/tiles';

export interface AudioApi {
  setVolume(v: number): void;
  mute(m: boolean): void;
  readonly running: boolean;
}

declare module '../core/game' {
  interface GameServices {
    audio: AudioApi;
  }
}

const SCALES: Record<string, number[]> = {
  spring: [0, 2, 4, 7, 9, 12, 14, 16],
  summer: [0, 2, 4, 7, 9, 12, 14, 19],
  fall: [0, 3, 5, 7, 10, 12, 15, 17],
  winter: [0, 2, 3, 7, 8, 12, 14, 15],
};

export class AudioSystem implements System {
  readonly name = 'audio';
  private game!: Game;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private wind: { g: GainNode; f: BiquadFilterNode } | null = null;
  private rain: { g: GainNode } | null = null;
  private fountain: { g: GainNode } | null = null;
  private volume = 0.7;
  private muted = false;
  private nextBird = 2;
  private nextCricket = 0;
  private nextNote = 1;
  private nextDrip = 0;
  private lastStep = 0;
  private stepSide = 0;

  init(game: Game): void {
    this.game = game;
    const start = (): void => {
      if (!this.ctx) this.boot();
      else if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    game.provide('audio', {
      setVolume: (v) => {
        this.volume = Math.max(0, Math.min(1, v));
        this.applyVolume();
      },
      mute: (m) => {
        this.muted = m;
        this.applyVolume();
      },
      get running() {
        return false;
      },
    });
    Object.defineProperty(game.services.audio!, 'running', { get: () => !!this.ctx && this.ctx.state === 'running' });

    const ev = game.events;
    ev.on('player:tile', () => this.footstep());
    ev.on('player:use', () => this.whoosh());
    ev.on('ui:open', ({ name }) => this.click(name === 'none' ? 520 : 780));
    ev.on('item:gained', () => this.blip(880, 1320, 0.08));
    ev.on('npc:talk', () => this.chatter());
    // Farming feedback (events declared by the farming system via declaration merging).
    ev.on('soil:tilled', () => this.thunk());
    ev.on('soil:watered', () => this.splash());
    ev.on('crop:harvested', () => this.pop());
  }

  private boot(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.ambBus.gain.value = 0.55;
    this.musicBus.gain.value = 0.32;
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    this.musicBus.connect(this.master);
    // White noise buffer + synthetic reverb impulse (exponentially decaying stereo noise).
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const len = ctx.sampleRate * 2.6;
    const imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = imp.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = imp;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);
    // Continuous beds
    this.wind = this.loopNoise('bandpass', 520, 0.9, 0);
    const r = this.loopNoise('highpass', 900, 0.4, 0);
    this.rain = { g: r.g };
    const f = this.loopNoise('bandpass', 1800, 1.4, 0);
    this.fountain = { g: f.g };
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number, gain: number): { g: GainNode; f: BiquadFilterNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.ambBus);
    src.start();
    return { g, f };
  }

  /** Short filtered noise burst. */
  private burst(opts: { type: BiquadFilterType; freq: number; q?: number; dur: number; gain: number; bus?: AudioNode; sweep?: number; pan?: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.freq * opts.sweep, t + opts.dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(f).connect(g).connect(p).connect(opts.bus ?? this.sfxBus);
    src.start(t, Math.random() * 1.5, opts.dur + 0.05);
  }

  private tone(opts: { type: OscillatorType; f0: number; f1?: number; dur: number; gain: number; attack?: number; bus?: AudioNode; pan?: number; at?: number; reverb?: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    o.connect(g).connect(p).connect(opts.bus ?? this.sfxBus);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      p.connect(s).connect(this.reverb);
    }
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  // ───────────────────────────────────────────── SFX

  private footstep(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStep < 0.16) return;
    this.lastStep = now;
    const map = this.game.world.current;
    const p = this.game.player.position;
    const type = map?.grid.getType(Math.floor(p.x), Math.floor(p.z)) ?? TileType.Grass;
    const pan = (this.stepSide = 1 - this.stepSide) ? -0.15 : 0.15;
    if (this.game.calendar.season === 'winter') this.burst({ type: 'bandpass', freq: 2400, q: 2.2, dur: 0.11, gain: 0.22, pan });
    else if (type === TileType.Stone) this.burst({ type: 'bandpass', freq: 3200, q: 4, dur: 0.05, gain: 0.26, pan });
    else if (type === TileType.Path || type === TileType.Dirt) this.burst({ type: 'bandpass', freq: 1500, q: 1.2, dur: 0.09, gain: 0.3, pan });
    else this.burst({ type: 'lowpass', freq: 900, q: 0.7, dur: 0.1, gain: 0.26, pan });
  }

  private whoosh(): void {
    this.burst({ type: 'bandpass', freq: 500, q: 1.5, dur: 0.22, gain: 0.25, sweep: 4 });
  }
  private thunk(): void {
    this.tone({ type: 'sine', f0: 150, f1: 60, dur: 0.18, gain: 0.5 });
    this.burst({ type: 'lowpass', freq: 700, dur: 0.14, gain: 0.3 });
  }
  private splash(): void {
    this.burst({ type: 'bandpass', freq: 2200, q: 0.8, dur: 0.35, gain: 0.3, sweep: 0.5 });
    for (let i = 0; i < 3; i++) this.tone({ type: 'sine', f0: 1400 + Math.random() * 900, f1: 2600, dur: 0.06, gain: 0.06, at: 0.05 + i * 0.07 });
  }
  private pop(): void {
    this.tone({ type: 'triangle', f0: 520, f1: 900, dur: 0.14, gain: 0.35 });
    this.tone({ type: 'sine', f0: 1318, dur: 0.4, gain: 0.12, at: 0.08, reverb: 0.4 });
    this.tone({ type: 'sine', f0: 1760, dur: 0.5, gain: 0.1, at: 0.16, reverb: 0.4 });
  }
  private blip(f0: number, f1: number, gain: number): void {
    this.tone({ type: 'triangle', f0, f1, dur: 0.1, gain });
  }
  private click(f: number): void {
    this.tone({ type: 'square', f0: f, f1: f * 0.7, dur: 0.05, gain: 0.05 });
  }
  private chatter(): void {
    for (let i = 0; i < 5; i++) this.tone({ type: 'triangle', f0: 380 + Math.random() * 260, dur: 0.07, gain: 0.07, at: i * 0.085 });
  }

  // ───────────────────────────────────────────── ambience + music

  update(dt: number, game: Game): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const cal = game.calendar;
    const night = game.lighting.night;
    const weather = cal.weather;
    const raining = weather === 'rain' || weather === 'storm';
    const windy = weather === 'wind' || weather === 'storm' ? 1 : raining ? 0.6 : 0.35;
    const k = 1 - Math.exp(-dt * 1.5);
    if (this.wind) {
      const target = 0.12 * windy * (0.7 + 0.3 * Math.sin(t * 0.23) * Math.sin(t * 0.61));
      this.wind.g.gain.value += (target - this.wind.g.gain.value) * k;
      this.wind.f.frequency.value = 380 + 320 * (0.5 + 0.5 * Math.sin(t * 0.17));
    }
    if (this.rain) this.rain.g.gain.value += ((raining ? (weather === 'storm' ? 0.34 : 0.22) : 0) - this.rain.g.gain.value) * k;
    if (this.fountain) this.fountain.g.gain.value += ((game.world.current?.id === 'town' ? 0.05 : 0) - this.fountain.g.gain.value) * k;
    if (raining && t > this.nextDrip) {
      this.nextDrip = t + 0.05 + Math.random() * 0.25;
      this.tone({ type: 'sine', f0: 1800 + Math.random() * 1600, f1: 900, dur: 0.05, gain: 0.03, bus: this.ambBus, pan: Math.random() * 2 - 1 });
    }
    // Songbirds by day, crickets by night.
    const outdoorsDay = night < 0.4 && !raining && cal.season !== 'winter';
    if (outdoorsDay && t > this.nextBird) {
      this.nextBird = t + 1.6 + Math.random() * 5;
      const base = 2400 + Math.random() * 1800;
      const n = 2 + Math.floor(Math.random() * 4);
      const pan = Math.random() * 1.6 - 0.8;
      for (let i = 0; i < n; i++) this.tone({ type: 'sine', f0: base * (1 + Math.random() * 0.3), f1: base * (0.7 + Math.random() * 0.8), dur: 0.07 + Math.random() * 0.06, gain: 0.045, at: i * 0.11, bus: this.ambBus, pan, reverb: 0.2 });
    }
    if (night > 0.6 && cal.season !== 'winter' && !raining && t > this.nextCricket) {
      this.nextCricket = t + 0.9 + Math.random() * 1.8;
      const f = 4200 + Math.random() * 800;
      const pan = Math.random() * 2 - 1;
      for (let i = 0; i < 6; i++) this.tone({ type: 'sine', f0: f, dur: 0.025, gain: 0.02, at: i * 0.045, bus: this.ambBus, pan });
    }
    // Generative music: soft pentatonic plucks, a phrase every few seconds.
    if (t > this.nextNote) {
      const scale = SCALES[cal.season] ?? SCALES.spring!;
      const root = cal.season === 'winter' ? 220 : cal.season === 'fall' ? 196 : 261.63;
      const phrase = 2 + Math.floor(Math.random() * 3);
      const quiet = night > 0.5 ? 0.6 : 1;
      let deg = Math.floor(Math.random() * 4);
      for (let i = 0; i < phrase; i++) {
        deg = Math.max(0, Math.min(scale.length - 1, deg + Math.floor(Math.random() * 3) - 1));
        const f = root * Math.pow(2, scale[deg]! / 12);
        this.tone({ type: cal.season === 'winter' ? 'sine' : 'triangle', f0: f, dur: 1.4, gain: 0.07 * quiet, attack: 0.02, at: i * 0.42, bus: this.musicBus, pan: Math.random() * 0.6 - 0.3, reverb: 0.8 });
      }
      // Occasional low drone note under the phrase.
      if (Math.random() < 0.4) this.tone({ type: 'sine', f0: root / 2, dur: 3.5, gain: 0.05 * quiet, attack: 0.6, bus: this.musicBus, reverb: 0.6 });
      this.nextNote = t + 3.2 + Math.random() * 3.5;
    }
  }
}
