/**
 * Sound-effect library — all synthesised, all soft-edged (cozy, never harsh): footsteps per
 * surface, every tool with anticipation whoosh + impact, harvest pops, coins, UI, dialogue voices,
 * fishing (cast, plop, bite, ratchet reel, catch fanfare), mining, combat, stingers.
 * Musical SFX are tuned to the current music key so they never clash with the score.
 */
import type { AudioGraph } from './graph';
import { Rand, clamp, hashString, mtof } from './dsp';
import { INSTRUMENTS, noiseHit } from './instruments';

export type Surface = 'grass' | 'dirt' | 'wood' | 'stone' | 'sand' | 'snow' | 'tilled' | 'water';

export interface SfxOpts {
  /** Absolute start time (defaults to now). */
  at?: number;
  pan?: number;
  gain?: number;
  /** Tool charge level / intensity hint (0..3). */
  level?: number;
  /** Footsteps: surface is wet (rain). */
  wet?: boolean;
}

export interface Voice {
  /** Speaking pitch (Hz). */
  base: number;
  wave: OscillatorType;
  /** Formant scale: 1 = adult, >1 smaller / brighter vocal tract, <1 bigger / darker. */
  formant: number;
  /** Pitch spread in semitones (how sing-song the character talks). */
  spread: number;
  /** Syllable rate multiplier. */
  rate: number;
  /** Breathiness 0..1 (noise mixed into the voice). */
  breath?: number;
}

/**
 * Villager voices for the dialogue murmur ("sim-speak": short formant-filtered syllables, each
 * word a tiny pitch contour, questions rise). Unknown ids get a stable hashed voice.
 */
export const VOICES: Record<string, Voice> = {
  /** Shopkeeper: bright, brisk, friendly. */
  marigold: { base: 290, wave: 'sawtooth', formant: 1.12, spread: 4, rate: 1.1, breath: 0.1 },
  /** Baker: big, slow, warm baritone. */
  bram: { base: 118, wave: 'sawtooth', formant: 0.84, spread: 3, rate: 0.8, breath: 0.05 },
  /** Painter: airy, flighty, wide melodic range. */
  wren: { base: 330, wave: 'triangle', formant: 1.2, spread: 7, rate: 1.25, breath: 0.25 },
  /** Blacksmith: low, clipped, few inflections. */
  odessa: { base: 190, wave: 'sawtooth', formant: 0.95, spread: 2, rate: 0.95, breath: 0.08 },
  /** Doctor: measured, mid, precise. */
  linus: { base: 150, wave: 'sawtooth', formant: 0.92, spread: 3, rate: 0.9, breath: 0.12 },
  /** Innkeeper: warm alto, lilting. */
  june: { base: 245, wave: 'sawtooth', formant: 1.05, spread: 5, rate: 1, breath: 0.15 },
  /** Old lamplighter: low, breathy, slow. */
  tobias: { base: 128, wave: 'triangle', formant: 0.88, spread: 4, rate: 0.72, breath: 0.35 },
  /** Kid: high, quick, bouncy. */
  kit: { base: 400, wave: 'square', formant: 1.35, spread: 6, rate: 1.4, breath: 0.05 },
  player: { base: 220, wave: 'triangle', formant: 1.05, spread: 4, rate: 1, breath: 0.1 },
};

export function voiceFor(id: string): Voice {
  const v = VOICES[id] ?? VOICES[id.split(/[-:]/)[0]!];
  if (v) return v;
  const h = hashString(id);
  const waves: OscillatorType[] = ['triangle', 'sawtooth', 'sawtooth'];
  return { base: 130 + (h % 260), wave: waves[h % 3]!, formant: 0.85 + ((h >> 8) % 40) / 100, spread: 2 + ((h >> 4) % 5), rate: 0.8 + ((h >> 12) % 5) * 0.12, breath: ((h >> 16) % 30) / 100 };
}

/** Vowel formants (F1, F2, F3 in Hz) for an adult-sized voice. */
const VOWELS: [number, number, number][] = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [300, 2200, 2900], // i
  [570, 840, 2410], // o
  [440, 1020, 2240], // u
];

export const SFX_NAMES = [
  'step:grass', 'step:dirt', 'step:wood', 'step:stone', 'step:sand', 'step:snow', 'step:tilled', 'step:water',
  'swing', 'hoe', 'water', 'axe', 'axe:miss', 'treefall', 'pickaxe', 'rockbreak', 'scythe', 'weed', 'plant',
  'sword', 'sword:hit', 'slime', 'slime:hit', 'slime:die', 'hurt',
  'harvest', 'pickup', 'coin', 'purchase', 'ship', 'craft',
  'charge', 'refill', 'place', 'giant', 'hoe:dull',
  'ui:click', 'ui:hover', 'ui:open', 'ui:close', 'ui:error', 'ui:select', 'ui:tab', 'ui:toggle', 'ui:tick', 'ui:trash', 'ui:drop', 'ui:sell',
  'blip', 'gift:love', 'gift:like', 'gift:neutral', 'gift:dislike', 'heart',
  'cast', 'plop', 'bite', 'catch', 'catch:perfect', 'escape', 'splash', 'reel',
  'ladder', 'door', 'warp', 'exhausted', 'eat', 'bundle', 'lantern', 'hall', 'morning', 'sleep', 'thunder', 'crow',
  'levelup', 'learn', 'paper', 'chest', 'sprinkler', 'wither',
  'emote:heart', 'emote:exclaim', 'emote:question', 'emote:music', 'emote:sweat', 'emote:anger', 'emote:idea', 'emote:sad', 'emote:zzz', 'emote:dots', 'emote:happy', 'emote:laugh', 'emote:wow',
  // Co-op: a farmer joins / leaves the session, a chat line arrives.
  'join', 'leave', 'chat',
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/**
 * Loudness trims per effect, calibrated from the SFX reel analysis (scripts/audio-render.mjs):
 * rewards sit a few dB above the median, swishes / small foley are lifted so they read, and the
 * big stingers stay under the score's loudness (they also duck it).
 */
const TRIM: Record<string, number> = {
  harvest: 0.62, coin: 0.6, craft: 0.6, 'gift:love': 0.4, 'gift:like': 0.6, heart: 0.6, catch: 0.42, 'catch:perfect': 0.42,
  lantern: 0.48, hall: 0.34, treefall: 1.1, purchase: 0.75, ship: 0.8, bite: 0.6, bundle: 0.75, sleep: 0.8, morning: 0.8,
  swing: 3.6, 'axe:miss': 6, warp: 3, eat: 3, plant: 8, sword: 2.4, scythe: 16, weed: 5, splash: 2.4,
  'ui:toggle': 2.4, giant: 0.45, reel: 1.4, crow: 1.2,
  // Round 4 hierarchy (in-game probe: watering and walking were lost under birdsong while menus
  // were louder than tools). Gameplay verbs peak around -18…-22 dBFS in game, UI -24…-28, ambience
  // events at or below -30: watering +14.6 dB (plus a soil-splash transient), scythe +9.4 dB, menu
  // open / close -5 / -4 dB, hover +10 dB, select (talking to a villager) +8 dB.
  water: 7, 'ui:open': 0.9, 'ui:close': 1.2, 'ui:hover': 16, 'ui:select': 4, 'ui:drop': 2.6, 'ui:trash': 1.8,
  // Reel: clicks / ticks sat ~15 dB under the set, mowing ~15 dB — lifted to read under a playing score.
  'ui:click': 1.8,
  // In-game probe (--live): the hardest hits sat 8–11 dB over the score's RMS — pull them in a little.
  rockbreak: 1.6, hoe: 5,
  // Round 2 (gameplay render, SFX bus +8 dB): the tools join the hoe as verbs (≈ -17…-20 LUFS
  // momentary on the reel), rewards / stingers pulled ~2 dB under them so they stay under median + 9.
  axe: 2.2, pickaxe: 2.6, 'sword:hit': 1.8, hurt: 2, 'ui:tick': 2.6,
  // Round 3 additions, levelled from the reel (median momentary max ≈ -21 LUFS): level-up / chest sit
  // with the rewards (~-15), emotes and chat around the small foley (~-20 … -26).
  levelup: 0.55, chest: 0.7, join: 0.6, leave: 0.7, learn: 0.55, paper: 4.5, sprinkler: 1.2, wither: 6, chat: 2,
  'emote:question': 3, 'emote:sweat': 3.5, 'emote:anger': 2, 'emote:sad': 2.2, 'emote:zzz': 1.2, 'emote:dots': 4, 'emote:music': 0.7,
};

/** Impacts that get per-repeat pitch (±2.5 st) and level (±2 dB) variation. */
const VARY = new Set(['hoe', 'hoe:dull', 'axe', 'pickaxe', 'rockbreak', 'sword', 'sword:hit', 'slime:hit', 'hurt', 'door', 'place', 'plant', 'weed', 'scythe', 'swing', 'axe:miss', 'harvest', 'pickup', 'eat', 'ladder']);

const LONG_SFX = new Set(['treefall', 'hall', 'lantern', 'catch', 'catch:perfect', 'sleep', 'thunder', 'giant', 'gift:love', 'levelup', 'join', 'chest']);

export class Sfx {
  private out: GainNode;
  private ui: GainNode;
  private send: GainNode;
  private caveSend: GainNode;
  private rng: Rand;
  private lastHover = 0;
  private stepSide = 1;
  reeling = false;
  private nextReel = 0;
  /** Current music tonic (MIDI) for tuned SFX. */
  key = 60;

  /** Randomness for the graph-level helpers (noise offsets) while an SFX is built: the same effect
   * renders identically whatever the music and ambience are doing (the gameplay check subtracts). */
  private grng: Rand;

  constructor(private g: AudioGraph, seed = 99) {
    const ctx = g.ctx;
    this.rng = new Rand(seed);
    this.grng = new Rand(seed * 7 + 1);
    this.out = ctx.createGain();
    this.out.connect(g.sfxBus);
    this.ui = ctx.createGain();
    this.ui.connect(g.uiBus);
    this.send = ctx.createGain();
    this.send.gain.value = 0.25;
    this.out.connect(this.send).connect(g.space);
    this.caveSend = ctx.createGain();
    this.caveSend.gain.value = 0;
    this.out.connect(this.caveSend).connect(g.cave);
  }

  setCave(amount: number): void {
    this.caveSend.gain.setTargetAtTime(amount * 0.5, this.g.ctx.currentTime, 0.5);
  }

  // ───────────────────────────────────────────── primitives

  /**
   * A one-shot's private input: gain → panner → the SFX (or UI) bus. World SFX that should make the
   * score step back (`key`) also feed the sidechain follower; footsteps, reel ticks and menu cues
   * don't, so walking never pumps the music.
   */
  private bus(o: SfxOpts | undefined, ui = false, key = !ui): { d: AudioNode; t: number } {
    const ctx = this.g.ctx;
    const t = Math.max(o?.at ?? ctx.currentTime, ctx.currentTime);
    const gn = ctx.createGain();
    gn.gain.value = o?.gain ?? 1;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o?.pan ?? 0, -1, 1);
    gn.connect(p).connect(ui ? this.ui : this.out);
    if (key) p.connect(this.g.duckKey);
    return { d: gn, t };
  }

  /** Pitch factor applied to tone()/noise() for the one-shot being built (per-repeat variation). */
  private pv = 1;

  private tone(d: AudioNode, t: number, o: { type?: OscillatorType; f0: number; f1?: number; glide?: number; amp: number; attack?: number; tau: number; lp?: number }): void {
    const ctx = this.g.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0 * this.pv, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1 * this.pv, t + (o.glide ?? o.tau * 2));
    const a = ctx.createGain();
    const atk = o.attack ?? 0.003;
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(o.amp, t + atk);
    a.gain.setTargetAtTime(0, t + atk, o.tau);
    let n: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      n = n.connect(f);
    }
    n.connect(a).connect(d);
    osc.start(t);
    osc.stop(t + atk + o.tau * 7);
  }

  private noise(d: AudioNode, t: number, o: Parameters<typeof noiseHit>[3]): void {
    noiseHit(this.g, d, t, this.pv === 1 ? o : { ...o, f: Math.min(16000, o.f * this.pv), f1: o.f1 ? Math.min(16000, o.f1 * this.pv) : undefined });
  }

  /**
   * Granular crunch — the part of an impact laptop speakers can actually play: `n` band-passed
   * noise grains scattered log-uniformly over 1.5–5 kHz across `span` seconds, each 4–10 ms, plus a
   * short 800–2000 Hz click on the contact frame.
   */
  private crunch(d: AudioNode, t: number, amp: number, o: { n?: number; span?: number; lo?: number; hi?: number; click?: number; clickF?: number } = {}): void {
    const r = this.rng;
    const n = o.n ?? 5;
    const span = o.span ?? 0.04;
    const lo = o.lo ?? 1500;
    const hi = o.hi ?? 5000;
    for (let i = 0; i < n; i++) {
      const tt = t + (span * (i + r.next() * 0.8)) / n;
      const f = lo * Math.pow(hi / lo, r.next());
      this.noise(d, tt, { f, q: 1.4 + r.next() * 1.4, amp: amp * (1 - (i / n) * 0.45) * (0.65 + 0.7 * r.next()), attack: 0.0008, tau: 0.004 + r.next() * 0.008 });
    }
    const click = o.click ?? 0.8;
    if (click > 0) {
      const cf = o.clickF ?? r.range(800, 2000);
      this.tone(d, t, { f0: cf, f1: cf * 0.82, glide: 0.012, amp: amp * click, attack: 0.0006, tau: 0.005 });
      this.noise(d, t, { f: cf * 2.2, q: 1.2, amp: amp * click * 0.7, attack: 0.0005, tau: 0.0025 });
    }
  }

  private v(x: number): number {
    return x * (0.9 + this.rng.next() * 0.2);
  }

  /** A note from the current key: degree in a major pentatonic, octave offset. */
  private kn(deg: number, oct = 0): number {
    const pent = [0, 2, 4, 7, 9];
    const o = Math.floor(deg / 5);
    const d = ((deg % 5) + 5) % 5;
    return (this.key % 12) + 72 + oct * 12 + o * 12 + pent[d]!;
  }

  private chime(d: AudioNode, t: number, midi: number, amp: number, inst: 'celesta' | 'bell' | 'kalimba' | 'marimba' | 'musicBox' | 'harp' = 'celesta'): void {
    INSTRUMENTS[inst](this.g, d, t, midi, 0.6, amp);
  }

  // ───────────────────────────────────────────── footsteps

  step(surface: Surface, o?: SfxOpts): void {
    this.stepSide = -this.stepSide;
    // Per-surface trims level the set (reel analysis: wood knocked ~12 dB over dirt / stone).
    // +6.5 dB over round 3 (steps were buried under the dawn chorus), sand / snow / shallow water
    // brought up to the set.
    const trim = surface === 'wood' ? 0.4 : surface === 'grass' ? 1.05 : surface === 'sand' ? 1.5 : surface === 'snow' || surface === 'water' ? 1.8 : 1;
    const { d, t } = this.bus({ ...o, pan: (o?.pan ?? 0) + this.stepSide * 0.06, gain: (o?.gain ?? 1) * trim * this.v(1.45 * 2.1) }, false, false);
    const k = 0.9 + this.rng.next() * 0.2;
    // Sole scuff: a short 2–4 kHz grain on every surface — the part that cuts through birdsong.
    if (surface !== 'water') this.noise(d, t + 0.004, { f: 2900 * k, q: 1.3, amp: surface === 'wood' ? 0.05 : 0.07, attack: 0.003, tau: 0.014, buf: this.g.pink });
    switch (surface) {
      case 'grass':
        this.noise(d, t, { f: 1300 * k, q: 0.7, amp: 0.2, attack: 0.008, tau: 0.03, buf: this.g.pink });
        // Blades crushed underfoot: a few crisp 2–4 kHz grains (what reads over birdsong and a score).
        for (let i = 0; i < 3; i++) this.noise(d, t + 0.006 + i * 0.012 + this.rng.next() * 0.006, { f: (2100 + this.rng.next() * 1800) * k, q: 2, amp: 0.07, tau: 0.007 });
        this.noise(d, t + 0.01, { type: 'highpass', f: 4200, amp: 0.035, attack: 0.01, tau: 0.02 });
        this.tone(d, t, { f0: 95, amp: 0.1, tau: 0.025 });
        break;
      case 'dirt':
      case 'tilled':
        // Soft heel thud + a gritty crunch of small grains.
        this.noise(d, t, { f: (surface === 'tilled' ? 650 : 950) * k, q: 1, amp: 0.24, attack: 0.004, tau: 0.03, buf: this.g.pink });
        for (let i = 0; i < 4; i++) this.noise(d, t + 0.008 + i * 0.011 + this.rng.next() * 0.006, { f: (2000 + this.rng.next() * 1600) * k, q: 2.5, amp: 0.07 * (1 - i * 0.18), tau: 0.008 });
        this.tone(d, t, { f0: 80, amp: 0.06, tau: 0.03 });
        break;
      case 'wood':
        // Hollow plank knock: a smaller low body, the board's mid modes and a heel click on top.
        this.tone(d, t, { f0: 170 * k, f1: 120, amp: 0.06, tau: 0.03 });
        this.tone(d, t, { f0: 410 * k, amp: 0.06, tau: 0.03 });
        this.tone(d, t, { f0: 890 * k, amp: 0.06, tau: 0.018 });
        this.noise(d, t, { f: 750 * k, q: 3, amp: 0.2, tau: 0.02 });
        this.noise(d, t + 0.003, { f: 1900 * k, q: 2, amp: 0.34, tau: 0.018 });
        this.noise(d, t + 0.001, { f: 3300 * k, q: 2, amp: 0.18, tau: 0.009 });
        if (this.rng.chance(0.06)) this.creak(d, t + 0.05, 0.4);
        break;
      case 'stone':
        // Hard click of a sole on cobbles, a little scuff.
        this.noise(d, t, { f: 2700 * k, q: 3, amp: 0.2, tau: 0.01 });
        this.noise(d, t + 0.003, { f: 4300 * k, q: 4, amp: 0.07, tau: 0.007 });
        this.noise(d, t, { type: 'lowpass', f: 520, amp: 0.16, tau: 0.02, buf: this.g.pink });
        this.noise(d, t + 0.03, { f: 1600 * k, q: 1, amp: 0.035, attack: 0.01, tau: 0.03, buf: this.g.pink });
        this.tone(d, t, { f0: 140 * k, amp: 0.05, tau: 0.02 });
        break;
      case 'sand':
        this.noise(d, t, { f: 1700 * k, q: 0.5, amp: 0.3, attack: 0.025, tau: 0.05, buf: this.g.pink });
        this.noise(d, t + 0.02, { type: 'highpass', f: 5200, amp: 0.02, attack: 0.02, tau: 0.03 });
        break;
      case 'snow':
        // Compressed-snow squeak: a burst of tiny tuned crunches.
        for (let i = 0; i < 7; i++) this.noise(d, t + i * 0.011 + this.rng.next() * 0.006, { f: (1500 + this.rng.next() * 1300) * k, q: 3.5, amp: 0.16 * (1 - i * 0.11), tau: 0.009 });
        this.noise(d, t, { type: 'lowpass', f: 800, amp: 0.18, attack: 0.01, tau: 0.04, buf: this.g.pink });
        break;
      case 'water':
        this.splashSmall(d, t, 0.6);
        break;
    }
    // Rain-soaked ground: a soft squelch + tiny droplet ticks on top of the surface sound.
    if (o?.wet && surface !== 'water' && surface !== 'wood') {
      this.noise(d, t + 0.006, { f: 1100 * k, f1: 700, q: 1.4, amp: 0.07, attack: 0.006, tau: 0.03, buf: this.g.pink });
      this.tone(d, t + 0.02 + this.rng.next() * 0.02, { f0: 1500 + this.rng.next() * 900, f1: 2600, glide: 0.02, amp: 0.018, tau: 0.01 });
    }
  }

  // ───────────────────────────────────────────── tools & world

  private whoosh(d: AudioNode, t: number, f0: number, f1: number, dur: number, amp: number): void {
    this.noise(d, t, { f: f0, f1, q: 1.6, amp, attack: dur * 0.6, tau: dur * 0.25, buf: this.g.pink });
  }

  private creak(d: AudioNode, t: number, dur: number, bright = 1): void {
    const ctx = this.g.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.linearRampToValueAtTime(240, t + dur * 0.5);
    o.frequency.linearRampToValueAtTime(170, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 * bright;
    bp.Q.value = 7;
    const a = ctx.createGain();
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(0.06, t + dur * 0.3);
    a.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp).connect(a).connect(d);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private crumbs(d: AudioNode, t: number, n: number, amp: number, span = 0.15): void {
    for (let i = 0; i < n; i++) this.noise(d, t + this.rng.next() * span, { f: 2200 + this.rng.next() * 2600, q: 2.5, amp: amp * (0.5 + this.rng.next() * 0.5), tau: 0.008 });
  }

  private splashSmall(d: AudioNode, t: number, amp: number): void {
    this.noise(d, t, { f: 1200, f1: 550, q: 0.8, amp: 0.22 * amp, attack: 0.01, tau: 0.06, buf: this.g.pink });
    for (let i = 0; i < 3; i++) {
      const f = 520 + this.rng.next() * 700;
      this.tone(d, t + 0.02 + i * 0.04 + this.rng.next() * 0.02, { f0: f, f1: f * 1.5, glide: 0.03, amp: 0.06 * amp, tau: 0.015 });
    }
  }

  play(name: SfxName | string, o?: SfxOpts): void {
    const r = this.rng;
    const ui = name.startsWith('ui:') || name === 'blip' || name === 'chat' || name === 'paper';
    // SFX outrank the score in the polyphony budget; only cosmetic repeats are refused under load.
    const at = Math.max(o?.at ?? this.g.ctx.currentTime, this.g.ctx.currentTime);
    if (!this.g.voiceStart(at, LONG_SFX.has(name) ? 3 : 0.8, name === 'ui:hover' || name === 'reel' || name.startsWith('step:') ? 2 : 3)) return;
    // Repeated impacts never machine-gun: ±2.5 semitones and ±2 dB per repeat.
    const vary = VARY.has(name);
    this.pv = vary ? Math.pow(2, r.range(-2.5, 2.5) / 12) : 1;
    const lv = vary ? Math.pow(10, r.range(-2, 2) / 20) : 1;
    const key = !ui && name !== 'reel' && !name.startsWith('step:') && !name.startsWith('emote:');
    const { d, t } = this.bus({ ...o, gain: (o?.gain ?? 1) * (TRIM[name] ?? 1) * lv }, ui, key);
    const shared = this.g.rng;
    this.g.rng = this.grng;
    try {
      this.voice(name, d, t, o);
    } finally {
      this.pv = 1;
      this.g.rng = shared;
    }
  }

  private voice(name: string, d: AudioNode, t: number, o: SfxOpts | undefined): void {
    const r = this.rng;
    switch (name) {
      case 'swing':
        // Air moving past the tool: a low-mid swish with a little body, nothing above ~1.5 kHz.
        this.whoosh(d, t, 260, 1250, 0.16, 0.17);
        this.noise(d, t + 0.03, { type: 'lowpass', f: 700, amp: 0.06, attack: 0.05, tau: 0.04, buf: this.g.pink });
        break;
      case 'hoe':
        // Blade bites the soil: a short earthy chuff (400–900 Hz), a small low body, the crunch of
        // grit on steel (1.5–5 kHz grains + click), then clods pattering back down.
        this.tone(d, t, { f0: 170, f1: 100, glide: 0.05, amp: 0.12, tau: 0.03 });
        this.noise(d, t + 0.003, { f: 900, q: 0.7, amp: 0.3, attack: 0.003, tau: 0.045, buf: this.g.pink });
        this.noise(d, t, { f: 2400, q: 0.9, amp: 0.13, attack: 0.001, tau: 0.012 });
        // (grains spread over 70 ms and a soft click: the crunch carries energy, not a spike)
        this.crunch(d, t + 0.002, 0.25, { n: 10, span: 0.07, lo: 1300, hi: 4000, click: 0.25, clickF: 1150 + r.next() * 500 });
        // The clod breaks: a longer gritty soil hiss (~250 ms) and the crumbs raining back down.
        this.noise(d, t + 0.01, { f: 1500, q: 0.55, amp: 0.26, attack: 0.012, tau: 0.13, buf: this.g.pink });
        this.noise(d, t + 0.02, { f: 3200, q: 0.8, amp: 0.06, attack: 0.02, tau: 0.1 });
        // ...and the loose earth sliding off the blade: a soft "shhh" that swells after the hit
        // (energy without adding to the peak).
        this.noise(d, t + 0.06, { f: 950, q: 0.7, amp: 0.22, attack: 0.05, tau: 0.14, buf: this.g.pink });
        this.crumbs(d, t + 0.05, 14, 0.12, 0.34);
        break;
      case 'water': {
        // Watering-can pour: a bubbly stream then soak.
        const dur = 0.7;
        this.noise(d, t, { f: 1700, q: 1.3, amp: 0.13, attack: 0.08, tau: dur * 0.35, buf: this.g.pink });
        this.noise(d, t, { f: 2400, q: 0.8, amp: 0.012, attack: 0.08, tau: dur * 0.3, buf: this.g.pink });
        for (let tt = 0; tt < dur; tt += 0.028 + r.next() * 0.02) {
          const f = 600 + r.next() * 1300;
          this.tone(d, t + tt, { f0: f, f1: f * 1.5, glide: 0.02, amp: 0.035 * (1 - tt / dur), tau: 0.012 });
        }
        this.noise(d, t + dur * 0.7, { type: 'lowpass', f: 1100, amp: 0.12, attack: 0.05, tau: 0.12, buf: this.g.pink });
        // The stream hits the soil: a soft wet slap, then a spatter of droplets bouncing off it.
        const hit = t + 0.1;
        this.noise(d, hit, { f: 900, f1: 420, q: 0.9, amp: 0.16, attack: 0.004, tau: 0.045, buf: this.g.pink });
        this.noise(d, hit, { f: 3200, q: 1.1, amp: 0.05, attack: 0.002, tau: 0.02 });
        for (let i = 0; i < 6; i++) {
          const f = 1400 + r.next() * 2400;
          this.tone(d, hit + 0.02 + r.next() * 0.25, { f0: f, f1: f * 1.35, glide: 0.015, amp: 0.028, tau: 0.008 });
        }
        break;
      }
      case 'axe':
        // Steel into green wood: a knock with the trunk's mid modes, a splintering crunch, chips.
        this.tone(d, t, { f0: 230, f1: 150, glide: 0.05, amp: 0.12, tau: 0.03 });
        this.noise(d, t, { f: 1250, q: 1.6, amp: 0.34, tau: 0.025 });
        this.noise(d, t, { f: 2800, q: 1, amp: 0.26, attack: 0.001, tau: 0.012 });
        this.tone(d, t, { f0: 420, amp: 0.1, tau: 0.06 });
        this.tone(d, t, { f0: 910, amp: 0.07, tau: 0.04 });
        this.tone(d, t, { f0: 1630, amp: 0.035, tau: 0.025 });
        this.crunch(d, t + 0.001, 0.32, { n: 6, span: 0.045, lo: 1800, hi: 4800, click: 1, clickF: 1500 });
        this.crumbs(d, t + 0.02, 5, 0.06);
        break;
      case 'axe:miss':
        this.whoosh(d, t, 280, 1100, 0.13, 0.12);
        this.tone(d, t + 0.12, { f0: 140, f1: 90, glide: 0.05, amp: 0.05, tau: 0.03 });
        break;
      case 'treefall':
        this.creak(d, t, 0.9, 1.6);
        this.creak(d, t + 0.5, 0.6, 2);
        // The trunk splits: a woody crack that small speakers can reproduce.
        this.noise(d, t + 0.78, { f: 260, q: 2, amp: 0.3, tau: 0.05, buf: this.g.pink });
        this.tone(d, t + 0.78, { f0: 175, f1: 120, glide: 0.08, amp: 0.2, tau: 0.06 });
        this.noise(d, t + 0.78, { f: 1400, q: 1.2, amp: 0.18, tau: 0.02 });
        // Fibres tearing: a volley of splintering crunches through the fall.
        for (let i = 0; i < 4; i++) this.crunch(d, t + 0.78 + i * (0.05 + r.next() * 0.06), 0.26 * (1 - i * 0.15), { n: 5, span: 0.05, lo: 1600, hi: 4500, click: i === 0 ? 1 : 0.4 });
        this.whoosh(d, t + 0.9, 250, 1300, 0.5, 0.22);
        // Landing: a thud with a 120–180 Hz body, the ground's low end, and the canopy's leaves.
        this.tone(d, t + 1.45, { f0: 160, f1: 100, glide: 0.12, amp: 0.2, tau: 0.08 });
        this.tone(d, t + 1.45, { f0: 62, f1: 40, glide: 0.3, amp: 0.1, tau: 0.16 });
        this.noise(d, t + 1.45, { f: 700, q: 0.8, amp: 0.3, tau: 0.12, buf: this.g.pink });
        this.noise(d, t + 1.45, { f: 2400, q: 0.8, amp: 0.26, attack: 0.002, tau: 0.03 });
        // Branches snap against the ground and the canopy thrashes (the landing laptops can hear).
        this.crunch(d, t + 1.45, 0.34, { n: 10, span: 0.14, lo: 1500, hi: 5000, click: 1, clickF: 1200 });
        this.crunch(d, t + 1.62, 0.18, { n: 6, span: 0.2, lo: 1800, hi: 5000, click: 0.3 });
        this.noise(d, t + 1.47, { f: 2600, q: 0.8, amp: 0.2, attack: 0.03, tau: 0.3, buf: this.g.pink });
        this.crumbs(d, t + 1.5, 12, 0.06, 0.6);
        this.g.duckMusic(t + 1.4, 0.7, 0.5, 0.8);
        break;
      case 'pickaxe':
        // Steel on stone: a bright ring, a chip-crunch and a small knock.
        this.tone(d, t, { f0: 2150, amp: 0.07, tau: 0.04 });
        this.tone(d, t, { f0: 3380, amp: 0.035, tau: 0.025 });
        this.noise(d, t, { f: 2900, q: 1.5, amp: 0.2, tau: 0.018 });
        this.tone(d, t, { f0: 180, f1: 140, glide: 0.03, amp: 0.18, tau: 0.03 });
        this.crunch(d, t + 0.002, 0.14, { n: 4, span: 0.03, lo: 2000, hi: 5000, click: 0.6, clickF: 1700 });
        this.crumbs(d, t + 0.03, 3, 0.04, 0.12);
        break;
      case 'rockbreak':
        // The stone splits: a cracking volley (mid body + 1.5–5 kHz grit), a short 150 Hz thump
        // (not a sub boom), then the rubble rattling down.
        for (let i = 0; i < 6; i++) this.noise(d, t + i * 0.018 + r.next() * 0.01, { f: 900 + r.next() * 2300, q: 1.2, amp: 0.3 * (1 - i * 0.12), tau: 0.02, buf: i % 2 ? this.g.pink : undefined });
        this.tone(d, t, { f0: 170, f1: 100, glide: 0.08, amp: 0.14, tau: 0.05 });
        this.noise(d, t, { f: 600, q: 1, amp: 0.16, tau: 0.04, buf: this.g.pink });
        this.noise(d, t, { f: 2600, q: 0.8, amp: 0.3, attack: 0.001, tau: 0.018 });
        this.crunch(d, t, 0.36, { n: 8, span: 0.06, click: 1, clickF: 1400 });
        this.crunch(d, t + 0.07, 0.2, { n: 6, span: 0.1, lo: 1800, hi: 5000, click: 0 });
        this.crumbs(d, t + 0.1, 14, 0.1, 0.45);
        break;
      case 'scythe':
        // A soft airy swish (kept under ~2 kHz so repeated mowing never gets hissy).
        this.noise(d, t, { f: 650, f1: 1700, q: 1.1, amp: 0.16, attack: 0.05, tau: 0.045, buf: this.g.pink });
        this.noise(d, t + 0.02, { type: 'lowpass', f: 600, amp: 0.05, attack: 0.03, tau: 0.04, buf: this.g.pink });
        break;
      case 'weed':
        // Stems snapping + leafy rustle.
        this.noise(d, t, { f: 1900, q: 2, amp: 0.1, tau: 0.015, buf: this.g.pink });
        this.noise(d, t + 0.025, { f: 2300, q: 2, amp: 0.08, tau: 0.015, buf: this.g.pink });
        this.noise(d, t, { f: 1500, q: 0.8, amp: 0.11, attack: 0.01, tau: 0.07, buf: this.g.pink });
        this.tone(d, t, { f0: 240, f1: 170, glide: 0.04, amp: 0.06, tau: 0.02 });
        break;
      case 'plant':
        this.noise(d, t, { type: 'lowpass', f: 700, amp: 0.2, tau: 0.03, buf: this.g.pink });
        this.crumbs(d, t + 0.03, 3, 0.03, 0.06);
        break;
      case 'sword': {
        // Weighty swing: a 180–250 Hz body under a whoosh kept below 2.2 kHz, a faint blade ring.
        this.whoosh(d, t, 420, 1500, 0.15, 0.2);
        this.tone(d, t + 0.03, { f0: 250, f1: 180, glide: 0.1, amp: 0.14, attack: 0.03, tau: 0.05, lp: 600 });
        this.noise(d, t + 0.02, { type: 'lowpass', f: 2200, amp: 0.05, attack: 0.04, tau: 0.04, buf: this.g.pink });
        this.tone(d, t + 0.04, { f0: 2640, amp: 0.004, tau: 0.08 });
        break;
      }
      case 'sword:hit':
        // A connecting blow: a slap with a 300 Hz body, a bright contact crunch and a blade tick.
        this.tone(d, t, { f0: 300, f1: 150, glide: 0.05, amp: 0.14, tau: 0.035 });
        this.noise(d, t, { f: 1500, q: 1.2, amp: 0.34, tau: 0.025 });
        this.noise(d, t, { f: 3200, q: 1, amp: 0.2, attack: 0.001, tau: 0.01 });
        this.crunch(d, t, 0.3, { n: 6, span: 0.04, click: 1, clickF: 1800 });
        this.tone(d, t + 0.002, { f0: 3100, amp: 0.025, tau: 0.03 });
        break;
      case 'slime': {
        this.tone(d, t, { f0: 170, f1: 340, glide: 0.1, amp: 0.26, tau: 0.05, lp: 900 });
        this.noise(d, t, { f: 600, f1: 1300, q: 3, amp: 0.12, attack: 0.02, tau: 0.04, buf: this.g.pink });
        break;
      }
      case 'slime:hit':
        this.tone(d, t, { f0: 420, f1: 190, glide: 0.1, amp: 0.3, tau: 0.05, lp: 1200 });
        this.noise(d, t, { f: 900, f1: 400, q: 2.5, amp: 0.2, tau: 0.04, buf: this.g.pink });
        break;
      case 'slime:die':
        this.noise(d, t, { f: 800, f1: 300, q: 2, amp: 0.25, attack: 0.01, tau: 0.08, buf: this.g.pink });
        this.tone(d, t + 0.05, { f0: 500, f1: 1500, glide: 0.05, amp: 0.2, tau: 0.03 });
        for (let i = 0; i < 3; i++) this.tone(d, t + 0.12 + i * 0.07, { f0: 380 - i * 70, f1: 260 - i * 50, glide: 0.05, amp: 0.12, tau: 0.03, lp: 1000 });
        this.chime(d, t + 0.2, this.kn(4), 0.18);
        break;
      case 'hurt':
        // Knocked back: a body thump, a slap you can hear on a laptop and a pained little "oof".
        this.tone(d, t, { f0: 200, f1: 110, glide: 0.08, amp: 0.09, tau: 0.04 });
        this.noise(d, t, { f: 1300, q: 0.9, amp: 0.4, tau: 0.035, buf: this.g.pink });
        this.noise(d, t, { f: 2600, q: 1, amp: 0.3, attack: 0.001, tau: 0.018 });
        this.crunch(d, t, 0.22, { n: 5, span: 0.03, lo: 1500, hi: 3500, click: 0.8, clickF: 1100 });
        this.tone(d, t + 0.01, { type: 'triangle', f0: 620, f1: 380, glide: 0.15, amp: 0.06, tau: 0.07, lp: 2200 });
        break;
      case 'harvest':
        this.tone(d, t, { f0: 280, f1: 950, glide: 0.06, amp: 0.32, tau: 0.045 });
        this.noise(d, t, { f: 1200, q: 1, amp: 0.16, tau: 0.025, buf: this.g.pink });
        this.chime(d, t + 0.07, this.kn(3), 0.3, 'kalimba');
        this.chime(d, t + 0.14, this.kn(5), 0.26, 'kalimba');
        break;
      case 'pickup':
        this.tone(d, t, { f0: 520, f1: 1050, glide: 0.05, amp: 0.2, tau: 0.04 });
        this.chime(d, t + 0.03, this.kn(5), 0.14);
        break;
      case 'coin':
        this.chime(d, t, this.kn(3), 0.3, 'bell');
        this.chime(d, t + 0.075, this.kn(5), 0.34, 'bell');
        this.tone(d, t, { f0: 5400, amp: 0.012, tau: 0.03 });
        break;
      case 'purchase':
        this.noise(d, t, { f: 1900, q: 1.2, amp: 0.12, tau: 0.03 });
        this.tone(d, t, { f0: 170, amp: 0.2, tau: 0.04 });
        this.chime(d, t + 0.06, this.kn(2), 0.26, 'bell');
        this.chime(d, t + 0.13, this.kn(4), 0.26, 'bell');
        break;
      case 'ship':
        this.tone(d, t, { f0: 140, amp: 0.3, tau: 0.07 });
        this.noise(d, t, { f: 520, q: 1.5, amp: 0.2, tau: 0.05, buf: this.g.pink });
        for (let i = 0; i < 3; i++) this.chime(d, t + 0.15 + i * 0.06, this.kn(5 + i), 0.12);
        break;
      case 'craft':
        for (let i = 0; i < 2; i++) {
          this.tone(d, t + i * 0.16, { f0: 880, amp: 0.14, tau: 0.03 });
          this.noise(d, t + i * 0.16, { f: 2100, q: 3, amp: 0.1, tau: 0.012 });
        }
        this.chime(d, t + 0.34, this.kn(2), 0.25);
        this.chime(d, t + 0.42, this.kn(4), 0.25);
        break;
      case 'charge': {
        // Tool charge-up: a rising tuned tick per level, brighter each step.
        const lv = clamp(o?.level ?? 1, 1, 4);
        this.chime(d, t, this.kn(2 + lv * 2, -1), 0.16 + lv * 0.03, 'marimba');
        this.noise(d, t, { f: 1800 + lv * 700, q: 2, amp: 0.05, attack: 0.02, tau: 0.05, buf: this.g.pink });
        break;
      }
      case 'refill':
        // Can dunked in the pond: gloop, then a rising glug-glug as it fills.
        this.tone(d, t, { f0: 420, f1: 180, glide: 0.08, amp: 0.2, tau: 0.05 });
        this.noise(d, t, { f: 900, f1: 500, q: 0.9, amp: 0.2, attack: 0.01, tau: 0.1, buf: this.g.pink });
        for (let i = 0; i < 5; i++) this.tone(d, t + 0.14 + i * 0.09, { f0: 260 + i * 70, f1: 380 + i * 90, glide: 0.04, amp: 0.09, tau: 0.03, lp: 1400 });
        break;
      case 'place':
        // Setting an object down: a wooden knock with a little dirt.
        this.tone(d, t, { f0: 230, f1: 170, glide: 0.04, amp: 0.07, tau: 0.025 });
        this.noise(d, t, { f: 1000, q: 1.6, amp: 0.3, tau: 0.022 });
        this.crunch(d, t, 0.16, { n: 4, span: 0.025, click: 0.9, clickF: 1300 });
        this.crumbs(d, t + 0.02, 3, 0.03, 0.08);
        break;
      case 'giant':
        // A giant crop finally splits: a big hollow thump, a juicy burst and a sparkle.
        this.tone(d, t, { f0: 90, f1: 40, glide: 0.25, amp: 0.6, tau: 0.16 });
        this.noise(d, t, { type: 'lowpass', f: 500, amp: 0.4, tau: 0.12, buf: this.g.brown });
        this.noise(d, t + 0.03, { f: 1600, f1: 700, q: 0.8, amp: 0.2, attack: 0.01, tau: 0.08, buf: this.g.pink });
        [0, 2, 4, 5].forEach((k, i) => this.chime(d, t + 0.18 + i * 0.07, this.kn(k), 0.24, 'kalimba'));
        this.g.duckMusic(t, 0.55, 0.8, 0.9);
        break;
      case 'hoe:dull':
        this.noise(d, t, { type: 'lowpass', f: 480, amp: 0.2, attack: 0.003, tau: 0.035, buf: this.g.pink });
        this.tone(d, t, { f0: 110, f1: 70, glide: 0.05, amp: 0.16, tau: 0.03 });
        break;
      case 'ui:tab':
        this.noise(d, t, { f: 1800, q: 1.4, amp: 0.06, attack: 0.012, tau: 0.02, buf: this.g.pink });
        this.chime(d, t + 0.01, this.kn(r.int(3, 5)), 0.1, 'kalimba');
        break;
      case 'ui:toggle':
        this.tone(d, t, { f0: 900, amp: 0.1, tau: 0.01 });
        this.tone(d, t + 0.045, { f0: 1350, amp: 0.08, tau: 0.012 });
        break;
      case 'ui:tick':
        // A small wooden tick (clock, counters).
        this.tone(d, t, { f0: 1500, amp: 0.12, tau: 0.008 });
        this.noise(d, t, { f: 2200, q: 2, amp: 0.05, tau: 0.004, buf: this.g.pink });
        break;
      case 'ui:trash':
        this.noise(d, t, { f: 2600, f1: 600, q: 1, amp: 0.1, attack: 0.02, tau: 0.06, buf: this.g.pink });
        this.tone(d, t + 0.08, { f0: 240, f1: 120, glide: 0.08, amp: 0.14, tau: 0.04 });
        break;
      case 'ui:drop':
        this.tone(d, t, { f0: 520, f1: 300, glide: 0.04, amp: 0.12, tau: 0.02 });
        this.noise(d, t, { f: 1400, q: 1.5, amp: 0.05, tau: 0.01, buf: this.g.pink });
        this.noise(d, t + 0.002, { f: 3200, q: 2, amp: 0.05, tau: 0.004 });
        break;
      case 'ui:sell':
        this.play('coin', o);
        this.noise(d, t, { f: 3000, q: 1.2, amp: 0.05, attack: 0.01, tau: 0.03 });
        break;
      case 'ui:click':
        this.tone(d, t, { f0: 1250, amp: 0.13, tau: 0.012 });
        this.noise(d, t, { f: 2400, q: 2, amp: 0.07, tau: 0.006, buf: this.g.pink });
        break;
      case 'ui:hover': {
        if (this.lastHover > 0 && Math.abs(t - this.lastHover) < 0.05) return;
        this.lastHover = t;
        // A bright 3–5 kHz tick (15 ms) tuned to the key: audible over the ambience, never harsh.
        this.tone(d, t, { f0: mtof(this.kn(r.int(5, 9), 1)), amp: 0.022, tau: 0.009 });
        this.noise(d, t, { f: 4000 + r.next() * 600, q: 2.2, amp: 0.05, attack: 0.001, tau: 0.004 });
        break;
      }
      case 'ui:open':
        this.noise(d, t, { f: 600, f1: 2400, q: 1.2, amp: 0.09, attack: 0.06, tau: 0.04, buf: this.g.pink });
        this.chime(d, t + 0.03, this.kn(3), 0.16);
        this.chime(d, t + 0.09, this.kn(5), 0.16);
        break;
      case 'ui:close':
        this.noise(d, t, { f: 2200, f1: 600, q: 1.2, amp: 0.07, attack: 0.05, tau: 0.04, buf: this.g.pink });
        this.chime(d, t + 0.02, this.kn(5), 0.11);
        this.chime(d, t + 0.08, this.kn(3), 0.11);
        break;
      case 'ui:error':
        this.tone(d, t, { type: 'triangle', f0: 220, amp: 0.13, tau: 0.05, lp: 1200 });
        this.tone(d, t + 0.1, { type: 'triangle', f0: 196, amp: 0.13, tau: 0.06, lp: 1200 });
        break;
      case 'ui:select':
        this.tone(d, t, { f0: mtof(this.kn(r.int(0, 4))), amp: 0.05, tau: 0.02 });
        this.noise(d, t, { f: 2600, q: 2, amp: 0.04, tau: 0.005, buf: this.g.pink });
        break;
      case 'gift:love':
        [0, 2, 3, 5, 7].forEach((k, i) => this.chime(d, t + i * 0.07, this.kn(k), 0.26));
        this.g.duckMusic(t, 0.6, 0.6, 0.8);
        break;
      case 'gift:like':
        [0, 2, 3].forEach((k, i) => this.chime(d, t + i * 0.08, this.kn(k), 0.22));
        break;
      case 'gift:neutral':
        this.chime(d, t, this.kn(2), 0.2);
        break;
      case 'gift:dislike':
        this.tone(d, t, { type: 'triangle', f0: mtof(this.kn(0, -1) + 1), amp: 0.12, tau: 0.12, lp: 1000 });
        this.tone(d, t + 0.16, { type: 'triangle', f0: mtof(this.kn(0, -1)), amp: 0.12, tau: 0.16, lp: 1000 });
        break;
      case 'heart':
        this.chime(d, t, this.kn(2), 0.3, 'bell');
        this.chime(d, t + 0.12, this.kn(6), 0.3, 'bell');
        this.g.duckMusic(t, 0.7, 0.4, 0.6);
        break;
      case 'cast':
        this.whoosh(d, t, 350, 1600, 0.2, 0.18);
        this.noise(d, t + 0.1, { f: 5000, f1: 2600, q: 3, amp: 0.035, attack: 0.02, tau: 0.12 });
        this.play('plop', { ...o, at: t + 0.7 });
        break;
      case 'plop':
        this.tone(d, t, { f0: 720, f1: 240, glide: 0.06, amp: 0.2, tau: 0.035 });
        this.splashSmall(d, t, 0.5);
        break;
      case 'bite':
        this.splashSmall(d, t, 1);
        this.chime(d, t + 0.02, this.kn(4), 0.28, 'marimba');
        this.chime(d, t + 0.1, this.kn(7), 0.3, 'marimba');
        break;
      case 'splash':
        this.noise(d, t, { f: 1400, f1: 500, q: 0.7, amp: 0.35, attack: 0.01, tau: 0.12, buf: this.g.pink });
        this.splashSmall(d, t + 0.05, 1);
        break;
      case 'reel':
        // Ratchet click: a 1.2–2 kHz pawl tick on a 300 Hz spool body.
        this.noise(d, t, { f: 1250 + r.next() * 700, q: 3, amp: 0.22, tau: 0.005 });
        this.tone(d, t, { f0: 300 + r.next() * 25, amp: 0.14, tau: 0.012 });
        this.noise(d, t + 0.003, { type: 'lowpass', f: 900, amp: 0.08, tau: 0.006, buf: this.g.pink });
        break;
      case 'catch':
      case 'catch:perfect': {
        this.play('splash', o);
        const seq = [0, 2, 3, 5];
        seq.forEach((k, i) => this.chime(d, t + 0.12 + i * 0.075, this.kn(k), 0.3, 'marimba'));
        [0, 2, 3].forEach((k) => this.chime(d, t + 0.45, this.kn(k + 5), 0.18, 'kalimba'));
        if (name === 'catch:perfect') [7, 8, 10].forEach((k, i) => this.chime(d, t + 0.6 + i * 0.06, this.kn(k), 0.16));
        this.g.duckMusic(t, 0.45, 1.0, 1);
        break;
      }
      case 'escape':
        this.play('splash', { ...o, gain: (o?.gain ?? 1) * 0.7 });
        this.tone(d, t + 0.1, { type: 'triangle', f0: mtof(this.kn(2, -1)), amp: 0.1, tau: 0.1, lp: 1400 });
        this.tone(d, t + 0.28, { type: 'triangle', f0: mtof(this.kn(0, -1) - 1), amp: 0.1, tau: 0.18, lp: 1400 });
        break;
      case 'ladder':
        for (let i = 0; i < 3; i++) {
          this.tone(d, t + i * 0.2, { f0: 190 - i * 10, amp: 0.25, tau: 0.04 });
          this.noise(d, t + i * 0.2, { f: 800, q: 2, amp: 0.15, tau: 0.02, buf: this.g.pink });
        }
        break;
      case 'door':
        // Latch lifts (a metal tick), hinges creak, the door knocks shut and the latch drops.
        this.tone(d, t, { f0: 2400, amp: 0.04, tau: 0.012 });
        this.noise(d, t, { f: 3600, q: 3, amp: 0.06, tau: 0.004 });
        this.creak(d, t + 0.03, 0.45, 1.8);
        this.tone(d, t + 0.48, { f0: 190, f1: 150, glide: 0.03, amp: 0.08, tau: 0.035 });
        this.noise(d, t + 0.48, { f: 900, q: 1.5, amp: 0.24, tau: 0.02, buf: this.g.pink });
        this.noise(d, t + 0.48, { f: 2300, q: 1, amp: 0.16, attack: 0.001, tau: 0.01 });
        this.crunch(d, t + 0.48, 0.18, { n: 5, span: 0.035, lo: 1800, hi: 4500, click: 1, clickF: 1600 });
        this.tone(d, t + 0.56, { f0: 2900, amp: 0.03, tau: 0.01 });
        break;
      case 'warp':
        this.noise(d, t, { f: 400, f1: 1600, q: 0.8, amp: 0.08, attack: 0.25, tau: 0.12, buf: this.g.pink });
        [0, 2, 4].forEach((k, i) => this.chime(d, t + 0.12 + i * 0.07, this.kn(k), 0.035, 'celesta'));
        break;
      case 'exhausted':
        this.tone(d, t, { type: 'triangle', f0: 392, f1: 196, glide: 0.6, amp: 0.12, tau: 0.25, lp: 1200 });
        this.tone(d, t + 0.7, { f0: 90, f1: 50, amp: 0.3, tau: 0.08 });
        break;
      case 'eat':
        // Three crunchy bites (a low munch under each) and a happy little gulp.
        for (let i = 0; i < 3; i++) {
          this.noise(d, t + i * 0.16, { f: 1500, q: 1, amp: 0.16, tau: 0.03, buf: this.g.pink });
          this.tone(d, t + i * 0.16, { f0: 190, f1: 140, glide: 0.04, amp: 0.1, tau: 0.03 });
          this.crumbs(d, t + i * 0.16 + 0.01, 3, 0.03, 0.05);
        }
        this.tone(d, t + 0.56, { f0: 260, f1: 420, glide: 0.07, amp: 0.1, tau: 0.04, lp: 1200 });
        break;
      case 'bundle':
        [0, 2, 4, 5].forEach((k, i) => this.chime(d, t + i * 0.09, this.kn(k), 0.26, 'harp'));
        break;
      case 'lantern':
        [0, 2, 3, 5].forEach((k) => this.chime(d, t, this.kn(k, -1), 0.2, 'bell'));
        for (let i = 0; i < 8; i++) this.chime(d, t + 0.25 + i * 0.06, this.kn(i + 3), 0.1);
        this.tone(d, t, { f0: mtof(this.kn(0, -3)), amp: 0.3, attack: 0.02, tau: 1.2 });
        this.g.duckMusic(t, 0.35, 2.2, 1.5);
        break;
      case 'hall': {
        // Stinger: rolled harp glissando, bell chord, warm low swell.
        for (let i = 0; i < 12; i++) this.chime(d, t + i * 0.05, this.kn(i - 2), 0.22, 'harp');
        [0, 2, 3, 5].forEach((k) => this.chime(d, t + 0.7, this.kn(k), 0.24, 'bell'));
        [0, 3, 5].forEach((k) => INSTRUMENTS.pad(this.g, d, t + 0.5, this.kn(k, -2), 3, 0.9));
        this.tone(d, t + 0.7, { f0: mtof(this.kn(0, -3)), amp: 0.35, attack: 0.05, tau: 1.5 });
        this.g.duckMusic(t, 0.25, 4, 2);
        break;
      }
      case 'morning':
        [0, 2, 3].forEach((k, i) => this.chime(d, t + i * 0.18, this.kn(k), 0.2, 'celesta'));
        break;
      case 'sleep':
        [5, 3, 2, 0].forEach((k, i) => this.chime(d, t + i * 0.32, this.kn(k), 0.22, 'musicBox'));
        break;
      case 'thunder':
        this.noise(d, t, { type: 'lowpass', f: 300, amp: 0.6, attack: 0.1, tau: 0.9, buf: this.g.brown });
        break;
      case 'crow': {
        // A crow drops onto the field: two hoarse caws.
        const ctx = this.g.ctx;
        for (let i = 0; i < 2; i++) {
          const tt = t + i * 0.36;
          const o2 = ctx.createOscillator();
          o2.type = 'sawtooth';
          o2.frequency.setValueAtTime(620 - i * 40, tt);
          o2.frequency.exponentialRampToValueAtTime(450, tt + 0.28);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 1250;
          bp.Q.value = 2.2;
          const a = ctx.createGain();
          a.gain.setValueAtTime(0, tt);
          a.gain.linearRampToValueAtTime(0.14, tt + 0.03);
          a.gain.setTargetAtTime(0, tt + 0.2, 0.05);
          o2.connect(bp).connect(a).connect(d);
          o2.start(tt);
          o2.stop(tt + 0.45);
          this.noise(d, tt, { f: 1800, q: 1.5, amp: 0.03, attack: 0.02, tau: 0.08, buf: this.g.pink });
        }
        break;
      }
      case 'levelup': {
        // Skill level-up: a harp run up the key's pentatonic, a bell chord that blooms on top and a
        // low tonic swell underneath — a proper little fanfare that the score makes room for.
        for (let i = 0; i < 8; i++) this.chime(d, t + i * 0.045, this.kn(i - 3), 0.2 * (0.7 + i * 0.05), 'harp');
        [0, 2, 3, 5].forEach((k, i) => this.chime(d, t + 0.4 + i * 0.012, this.kn(k), 0.22, 'bell'));
        [5, 7].forEach((k, i) => this.chime(d, t + 0.62 + i * 0.1, this.kn(k), 0.14, 'celesta'));
        this.tone(d, t + 0.38, { f0: mtof(this.kn(0, -3)), amp: 0.22, attack: 0.04, tau: 0.9 });
        this.noise(d, t + 0.38, { type: 'highpass', f: 6000, amp: 0.012, attack: 0.05, tau: 0.35 });
        this.g.duckMusic(t, 0.4, 1.4, 1.2);
        break;
      }
      case 'learn':
        // A new recipe: three quick celesta sparkles and a glint of shimmer.
        [2, 4, 7].forEach((k, i) => this.chime(d, t + i * 0.06, this.kn(k), 0.18 - i * 0.02));
        this.noise(d, t + 0.1, { f: 5200, q: 2, amp: 0.02, attack: 0.03, tau: 0.12 });
        break;
      case 'paper':
        // Parchment unfolding: two soft rustles and a crisp flick.
        this.noise(d, t, { f: 1400, f1: 2600, q: 0.9, amp: 0.09, attack: 0.04, tau: 0.05, buf: this.g.pink });
        this.noise(d, t + 0.12, { f: 2200, f1: 1300, q: 0.9, amp: 0.07, attack: 0.03, tau: 0.05, buf: this.g.pink });
        this.noise(d, t + 0.2, { f: 3000, q: 2.5, amp: 0.05, tau: 0.008, buf: this.g.pink });
        this.tone(d, t + 0.02, { f0: 180, amp: 0.03, tau: 0.03 });
        break;
      case 'chest':
        // Lid creaks open, a hollow wooden knock, then the find sparkles.
        this.creak(d, t, 0.35);
        this.tone(d, t + 0.35, { f0: 150, f1: 110, glide: 0.05, amp: 0.26, tau: 0.05 });
        this.noise(d, t + 0.35, { f: 800, q: 2, amp: 0.12, tau: 0.02, buf: this.g.pink });
        [0, 2, 4, 5, 7].forEach((k, i) => this.chime(d, t + 0.45 + i * 0.06, this.kn(k), 0.2, i % 2 ? 'celesta' : 'bell'));
        this.g.duckMusic(t + 0.4, 0.65, 0.6, 0.7);
        break;
      case 'sprinkler':
        // Morning sprinklers: pulses of a soft spray with droplets pattering down.
        for (let i = 0; i < 5; i++) {
          this.noise(d, t + i * 0.15, { f: 3200, q: 0.7, amp: 0.035, attack: 0.01, tau: 0.05, buf: this.g.pink });
          this.tone(d, t + i * 0.15 + 0.07 + r.next() * 0.04, { f0: 900 + r.next() * 700, f1: 1700, glide: 0.02, amp: 0.02, tau: 0.01 });
        }
        break;
      case 'wither':
        // A dried-out crop: a papery crackle that sags down.
        this.crumbs(d, t, 6, 0.04, 0.25);
        this.noise(d, t + 0.05, { f: 1200, f1: 500, q: 1, amp: 0.06, attack: 0.05, tau: 0.12, buf: this.g.pink });
        break;
      case 'join':
        // Another farmer arrives: a warm rising welcome on harp over a soft bell fifth.
        [0, 2, 4, 7].forEach((k, i) => this.chime(d, t + i * 0.1, this.kn(k), 0.24, 'harp'));
        [0, 3].forEach((k) => this.chime(d, t + 0.42, this.kn(k), 0.16, 'bell'));
        this.g.duckMusic(t, 0.7, 0.6, 0.8);
        break;
      case 'leave':
        [4, 2, 0].forEach((k, i) => this.chime(d, t + i * 0.12, this.kn(k), 0.18, 'harp'));
        break;
      case 'chat':
        // A chat line lands: a soft wooden pop with a small tuned tail.
        this.tone(d, t, { f0: 620, f1: 900, glide: 0.03, amp: 0.1, tau: 0.02 });
        this.chime(d, t + 0.03, this.kn(r.int(3, 6)), 0.08, 'kalimba');
        break;
      default:
        if (name.startsWith('step:')) this.step(name.slice(5) as Surface, o);
        else if (name.startsWith('emote:')) this.emote(d, t, name.slice(6));
        break;
    }
  }

  /** Little cartoon cues for emote bubbles (villagers and co-op farmers), tuned to the key. */
  private emote(d: AudioNode, t: number, kind: string): void {
    switch (kind) {
      case 'heart':
        this.chime(d, t, this.kn(2), 0.16, 'bell');
        this.chime(d, t + 0.1, this.kn(4), 0.16, 'bell');
        break;
      case 'happy':
        this.chime(d, t, this.kn(2), 0.13, 'kalimba');
        this.chime(d, t + 0.08, this.kn(4), 0.15, 'kalimba');
        break;
      case 'laugh':
        // "Ha-ha-ha": three bouncy staccato marimba notes stepping down.
        [5, 4, 2].forEach((k, i) => this.chime(d, t + i * 0.085, this.kn(k), 0.15 - i * 0.02, 'marimba'));
        break;
      case 'wow':
      case 'exclaim':
        this.tone(d, t, { f0: 700, f1: 1400, glide: 0.04, amp: 0.1, tau: 0.03 });
        this.chime(d, t + 0.03, this.kn(5), 0.12);
        break;
      case 'question':
        this.tone(d, t, { type: 'triangle', f0: mtof(this.kn(0)), f1: mtof(this.kn(2)), glide: 0.12, amp: 0.08, tau: 0.08, lp: 2000 });
        break;
      case 'music':
      case 'note':
        [0, 2, 4].forEach((k, i) => this.chime(d, t + i * 0.09, this.kn(k), 0.12, 'kalimba'));
        break;
      case 'sweat':
        this.tone(d, t, { f0: 1300, f1: 500, glide: 0.08, amp: 0.07, tau: 0.04 });
        break;
      case 'anger':
      case 'angry':
        // "Hmph! Hmph!": two grumbling nasal huffs (a buzzy 250 Hz voice through a 900 Hz formant).
        this.tone(d, t, { type: 'sawtooth', f0: 260, f1: 200, glide: 0.1, amp: 0.05, tau: 0.07, lp: 1400 });
        this.noise(d, t, { f: 1300, q: 1.2, amp: 0.12, attack: 0.01, tau: 0.05, buf: this.g.pink });
        this.tone(d, t + 0.13, { type: 'sawtooth', f0: 240, f1: 185, glide: 0.1, amp: 0.05, tau: 0.07, lp: 1400 });
        this.noise(d, t + 0.13, { f: 1250, q: 1.2, amp: 0.12, attack: 0.01, tau: 0.05, buf: this.g.pink });
        break;
      case 'idea':
      case 'sparkle':
        this.chime(d, t, this.kn(7), 0.14, 'bell');
        this.noise(d, t, { f: 5000, q: 2, amp: 0.015, attack: 0.02, tau: 0.08 });
        break;
      case 'sad':
        this.tone(d, t, { type: 'triangle', f0: mtof(this.kn(2, -1)), f1: mtof(this.kn(0, -1) - 1), glide: 0.3, amp: 0.08, tau: 0.15, lp: 1100 });
        break;
      case 'sleepy':
      case 'zzz':
        // A sleepy exhale and a soft low hum.
        this.noise(d, t, { type: 'lowpass', f: 700, amp: 0.15, attack: 0.2, tau: 0.2, buf: this.g.pink });
        this.tone(d, t + 0.05, { type: 'triangle', f0: mtof(this.kn(0, -2)), amp: 0.08, attack: 0.1, tau: 0.25, lp: 600 });
        break;
      default:
        // dots / unknown: three soft ticks.
        for (let i = 0; i < 3; i++) this.tone(d, t + i * 0.1, { f0: 1100, amp: 0.05, tau: 0.01 });
        break;
    }
  }

  /**
   * Play a short tune fragment (a theme's hook) on one of the score's instruments — the season and
   * morning stingers quote the music the player is about to hear.
   */
  phrase(inst: 'celesta' | 'kalimba' | 'harp' | 'musicBox' | 'marimba' | 'bell' | 'flute' | 'clarinet', notes: { midi: number; t: number; beats: number }[], o?: SfxOpts & { bpm?: number }): void {
    const { d, t } = this.bus(o);
    const beat = 60 / (o?.bpm ?? 100);
    for (const n of notes) INSTRUMENTS[inst](this.g, d, t + n.t * beat, n.midi, Math.max(0.2, n.beats * beat * 0.95), 0.34, undefined);
  }

  /** Dialogue blip for one character of text (kept for single-character callers). */
  blip(voice: Voice, ch: string, o?: SfxOpts): void {
    const code = ch.toLowerCase().charCodeAt(0) || 97;
    this.syllable(voice, this.bus(o, true), 0, code % 5, ((code * 7) % (voice.spread * 2 + 1)) - voice.spread, ch === '?' ? 1 : 0, 0.07 / voice.rate, 1);
  }

  /**
   * One spoken word of "sim-speak": 1–3 syllables, each a glottal pulse train (the voice's
   * oscillator) through three vowel formants scaled to the character's vocal tract, with a small
   * pitch contour per word; questions rise at the end, exclamations get an accent. Deterministic
   * per word text so the same line always "sounds" the same.
   */
  murmur(voice: Voice, word: string, o?: SfxOpts): number {
    const b = this.bus(o, true);
    const w = word.toLowerCase().replace(/[^a-z?!.]/g, '');
    const h = hashString(w || 'hm');
    const vowels = (w.match(/[aeiouy]+/g) ?? ['a']).length;
    const n = clamp(vowels, 1, 3);
    const question = w.endsWith('?');
    const excl = w.endsWith('!');
    const sylDur = (0.075 + ((h >> 3) % 20) / 1000) / voice.rate;
    let tt = 0;
    for (let i = 0; i < n; i++) {
      const vIdx = (h >>> (i * 3)) % 5;
      // Word contour: gentle arch, final syllable falls unless it's a question.
      const arch = i === 0 ? 0 : i === n - 1 ? (question ? 4 : -2) : 1;
      const semis = (((h >>> (i * 4 + 5)) % (voice.spread * 2 + 1)) - voice.spread) * 0.6 + arch;
      this.syllable(voice, b, tt, vIdx, semis, question && i === n - 1 ? 1 : 0, sylDur * (i === n - 1 ? 1.25 : 1), excl && i === 0 ? 1.25 : 1);
      tt += sylDur * (i === n - 1 ? 1.25 : 1) + 0.012;
    }
    return tt;
  }

  private syllable(voice: Voice, b: { d: AudioNode; t: number }, dt: number, vowel: number, semis: number, rise: number, dur: number, accent: number): void {
    const ctx = this.g.ctx;
    const t = b.t + dt;
    const f = voice.base * Math.pow(2, semis / 12);
    const src = ctx.createOscillator();
    src.type = voice.wave;
    src.frequency.setValueAtTime(f * 0.97, t);
    src.frequency.linearRampToValueAtTime(f * (rise ? 1.18 : 1.01), t + dur);
    // Tiny vibrato-ish jitter so it doesn't sound like a test tone.
    const jit = ctx.createOscillator();
    jit.frequency.value = 6.5;
    const jg = ctx.createGain();
    jg.gain.value = f * 0.012;
    jit.connect(jg).connect(src.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5 * accent, t + 0.012);
    env.gain.setValueAtTime(0.42 * accent, t + dur * 0.6);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const [F1, F2, F3] = VOWELS[vowel % VOWELS.length]!;
    const sum = ctx.createGain();
    sum.gain.value = voice.wave === 'square' ? 0.55 : voice.wave === 'sawtooth' ? 0.7 : 1.6;
    ([[F1, 6, 1], [F2, 9, 0.55], [F3, 12, 0.22]] as const).forEach(([ff, q, amp]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(ff * voice.formant, 5500);
      bp.Q.value = q;
      const a = ctx.createGain();
      a.gain.value = amp * 2.2;
      src.connect(bp).connect(a).connect(sum);
    });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3600;
    sum.connect(lp).connect(env).connect(b.d);
    if ((voice.breath ?? 0) > 0) {
      this.noise(b.d, t, { f: F2 * voice.formant, q: 2, amp: 0.05 * (voice.breath ?? 0), attack: 0.02, tau: dur * 0.4, buf: this.g.pink });
    }
    src.start(t);
    src.stop(t + dur + 0.02);
    jit.start(t);
    jit.stop(t + dur + 0.02);
  }

  /** Continuous effects (fishing reel ratchet). */
  tick(now: number): void {
    if (!this.reeling) return;
    if (this.nextReel < now) this.nextReel = now;
    while (this.nextReel < now + 0.1) {
      this.play('reel', { at: this.nextReel, gain: 0.8 });
      this.nextReel += 0.055 + this.rng.next() * 0.01;
    }
  }
}
