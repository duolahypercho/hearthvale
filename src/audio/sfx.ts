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
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/**
 * Loudness trims per effect, calibrated from the SFX reel analysis (scripts/audio-render.mjs):
 * rewards sit a few dB above the median, swishes / small foley are lifted so they read, and the
 * big stingers stay under the score's loudness (they also duck it).
 */
const TRIM: Record<string, number> = {
  harvest: 0.62, coin: 0.6, craft: 0.6, 'gift:love': 0.5, 'gift:like': 0.7, heart: 0.6, catch: 0.55, 'catch:perfect': 0.55,
  lantern: 0.62, hall: 0.45, treefall: 0.7, purchase: 0.75, ship: 0.8, bite: 0.8, sleep: 0.8, morning: 0.8,
  swing: 3.6, 'axe:miss': 6, warp: 4.4, eat: 4, plant: 2.2, sword: 3.2, scythe: 3.4, weed: 1.4, splash: 1.8, water: 1.3,
  'ui:select': 1.6, 'ui:toggle': 1.6, giant: 0.7, reel: 1.4, crow: 1.2,
  // In-game probe (--live): the hardest hits sat 8–11 dB over the score's RMS — pull them in a little.
  rockbreak: 0.72, hoe: 0.85,
};

const LONG_SFX = new Set(['treefall', 'hall', 'lantern', 'catch', 'catch:perfect', 'sleep', 'thunder', 'giant', 'gift:love']);

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

  constructor(private g: AudioGraph, seed = 99) {
    const ctx = g.ctx;
    this.rng = new Rand(seed);
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

  private bus(o: SfxOpts | undefined, ui = false): { d: AudioNode; t: number } {
    const ctx = this.g.ctx;
    const t = Math.max(o?.at ?? ctx.currentTime, ctx.currentTime);
    const gn = ctx.createGain();
    gn.gain.value = o?.gain ?? 1;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o?.pan ?? 0, -1, 1);
    gn.connect(p).connect(ui ? this.ui : this.out);
    return { d: gn, t };
  }

  private tone(d: AudioNode, t: number, o: { type?: OscillatorType; f0: number; f1?: number; glide?: number; amp: number; attack?: number; tau: number; lp?: number }): void {
    const ctx = this.g.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? o.tau * 2));
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
    noiseHit(this.g, d, t, o);
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
    const trim = surface === 'wood' ? 0.4 : surface === 'grass' ? 0.8 : 1;
    const { d, t } = this.bus({ ...o, pan: (o?.pan ?? 0) + this.stepSide * 0.06, gain: (o?.gain ?? 1) * trim * this.v(1.45) });
    const k = 0.9 + this.rng.next() * 0.2;
    switch (surface) {
      case 'grass':
        this.noise(d, t, { f: 1300 * k, q: 0.7, amp: 0.2, attack: 0.008, tau: 0.03, buf: this.g.pink });
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
        // Hollow plank knock.
        this.tone(d, t, { f0: 170 * k, f1: 120, amp: 0.2, tau: 0.04 });
        this.tone(d, t, { f0: 410 * k, amp: 0.06, tau: 0.03 });
        this.noise(d, t, { f: 750 * k, q: 3, amp: 0.2, tau: 0.02 });
        this.noise(d, t + 0.004, { f: 1900 * k, q: 4, amp: 0.1, tau: 0.012 });
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

  private creak(d: AudioNode, t: number, dur: number): void {
    const ctx = this.g.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.linearRampToValueAtTime(240, t + dur * 0.5);
    o.frequency.linearRampToValueAtTime(170, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
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
    const ui = name.startsWith('ui:') || name === 'blip';
    // SFX outrank the score in the polyphony budget; only cosmetic repeats are refused under load.
    const at = Math.max(o?.at ?? this.g.ctx.currentTime, this.g.ctx.currentTime);
    if (!this.g.voiceStart(at, LONG_SFX.has(name) ? 3 : 0.8, name === 'ui:hover' || name === 'reel' || name.startsWith('step:') ? 2 : 3)) return;
    const { d, t } = this.bus({ ...o, gain: (o?.gain ?? 1) * (TRIM[name] ?? 1) }, ui);
    switch (name) {
      case 'swing':
        // Air moving past the tool: a low-mid swish with a little body, nothing above ~1.5 kHz.
        this.whoosh(d, t, 260, 1250, 0.16, 0.17);
        this.noise(d, t + 0.03, { type: 'lowpass', f: 700, amp: 0.06, attack: 0.05, tau: 0.04, buf: this.g.pink });
        break;
      case 'hoe':
        this.noise(d, t, { type: 'lowpass', f: 650, amp: 0.42, attack: 0.003, tau: 0.05, buf: this.g.pink });
        this.tone(d, t, { f0: 130, f1: 60, glide: 0.08, amp: 0.34, tau: 0.05 });
        this.crumbs(d, t + 0.02, 5, 0.06, 0.2);
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
        break;
      }
      case 'axe':
        this.tone(d, t, { f0: 230, f1: 150, glide: 0.05, amp: 0.36, tau: 0.035 });
        this.noise(d, t, { f: 1250, q: 2, amp: 0.3, tau: 0.025 });
        this.tone(d, t, { f0: 420, amp: 0.08, tau: 0.06 });
        this.tone(d, t, { f0: 910, amp: 0.04, tau: 0.04 });
        this.crumbs(d, t + 0.01, 4, 0.05);
        break;
      case 'axe:miss':
        this.whoosh(d, t, 280, 1100, 0.13, 0.12);
        this.tone(d, t + 0.12, { f0: 140, f1: 90, glide: 0.05, amp: 0.05, tau: 0.03 });
        break;
      case 'treefall':
        this.creak(d, t, 0.9);
        this.creak(d, t + 0.5, 0.6);
        // The trunk splits: a woody crack that small speakers can reproduce.
        this.noise(d, t + 0.78, { f: 160, q: 2, amp: 0.45, tau: 0.05, buf: this.g.pink });
        this.tone(d, t + 0.78, { f0: 175, f1: 120, glide: 0.08, amp: 0.3, tau: 0.06 });
        this.noise(d, t + 0.78, { f: 1400, q: 1.2, amp: 0.12, tau: 0.02 });
        this.whoosh(d, t + 0.9, 250, 1300, 0.5, 0.22);
        // Landing: a thud with a 120–180 Hz body, the ground's low end, and the canopy's leaves.
        this.tone(d, t + 1.45, { f0: 150, f1: 95, glide: 0.12, amp: 0.45, tau: 0.09 });
        this.tone(d, t + 1.45, { f0: 62, f1: 34, glide: 0.3, amp: 0.45, tau: 0.2 });
        this.noise(d, t + 1.45, { type: 'lowpass', f: 420, amp: 0.4, tau: 0.18, buf: this.g.brown });
        this.noise(d, t + 1.47, { f: 2300, q: 0.8, amp: 0.14, attack: 0.04, tau: 0.3, buf: this.g.pink });
        this.crumbs(d, t + 1.5, 10, 0.05, 0.6);
        this.g.duckMusic(t + 1.4, 0.6, 0.6, 0.8);
        break;
      case 'pickaxe':
        this.tone(d, t, { f0: 2150, amp: 0.1, tau: 0.045 });
        this.tone(d, t, { f0: 3380, amp: 0.06, tau: 0.03 });
        this.noise(d, t, { f: 2900, q: 1.5, amp: 0.2, tau: 0.018 });
        this.tone(d, t, { f0: 150, amp: 0.25, tau: 0.03 });
        break;
      case 'rockbreak':
        for (let i = 0; i < 6; i++) this.noise(d, t + i * 0.018 + r.next() * 0.01, { f: 700 + r.next() * 2300, q: 1.2, amp: 0.3 * (1 - i * 0.12), tau: 0.02, buf: i % 2 ? this.g.pink : undefined });
        this.tone(d, t, { f0: 95, f1: 48, glide: 0.12, amp: 0.45, tau: 0.09 });
        this.crumbs(d, t + 0.1, 9, 0.05, 0.45);
        this.g.duckMusic(t, 0.8, 0.15, 0.4);
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
        this.tone(d, t, { f0: 180, f1: 90, glide: 0.06, amp: 0.4, tau: 0.045 });
        this.noise(d, t, { f: 1500, q: 1.2, amp: 0.28, tau: 0.025 });
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
        this.tone(d, t, { f0: 110, f1: 60, glide: 0.08, amp: 0.4, tau: 0.05 });
        this.tone(d, t, { type: 'triangle', f0: 330, f1: 210, glide: 0.15, amp: 0.1, tau: 0.08, lp: 900 });
        this.g.duckMusic(t, 0.6, 0.2, 0.5);
        break;
      case 'harvest':
        this.tone(d, t, { f0: 280, f1: 950, glide: 0.06, amp: 0.32, tau: 0.045 });
        this.noise(d, t, { f: 1200, q: 1, amp: 0.16, tau: 0.025, buf: this.g.pink });
        this.chime(d, t + 0.07, this.kn(3), 0.3, 'kalimba');
        this.chime(d, t + 0.14, this.kn(5), 0.26, 'kalimba');
        this.g.duckMusic(t, 0.75, 0.2, 0.5);
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
        this.tone(d, t, { f0: 210, f1: 150, glide: 0.04, amp: 0.3, tau: 0.035 });
        this.noise(d, t, { f: 900, q: 2.5, amp: 0.14, tau: 0.018 });
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
        this.tone(d, t, { f0: mtof(this.kn(r.int(5, 9))), amp: 0.025, tau: 0.012 });
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
        this.creak(d, t, 0.45);
        this.tone(d, t + 0.45, { f0: 160, amp: 0.25, tau: 0.04 });
        this.noise(d, t + 0.45, { f: 2600, q: 3, amp: 0.08, tau: 0.01 });
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
      default:
        if (name.startsWith('step:')) this.step(name.slice(5) as Surface, o);
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
