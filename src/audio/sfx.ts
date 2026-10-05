/**
 * Sound-effect library — all synthesised, all soft-edged (cozy, never harsh): footsteps per
 * surface, every tool with anticipation whoosh + impact, harvest pops, coins, UI, dialogue voices,
 * fishing (cast, plop, bite, ratchet reel, catch fanfare), mining, combat, stingers.
 * Musical SFX are tuned to the current music key so they never clash with the score.
 */
import type { AudioGraph } from './graph';
import { Rand, clamp, hashString, mtof } from './dsp';
import { INSTRUMENTS, noiseHit, noteKeys, type InstrumentName } from './instruments';

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
  /** Loudness trim (linear): the reel's voice row levels every villager to within ±1.5 LU. */
  level?: number;
  /** 0..1 consonant articulation: a 1.5–2.5 kHz click at each syllable onset and a lifted upper
   * formant, so low, dark voices read over a score whose energy sits in the low-mids. */
  presence?: number;
}

/**
 * Villager voices for the dialogue murmur ("sim-speak": short formant-filtered syllables, each
 * word a tiny pitch contour, questions rise). Unknown ids get a stable hashed voice.
 */
export const VOICES: Record<string, Voice> = {
  /** Shopkeeper: bright, brisk, friendly. */
  marigold: { base: 290, wave: 'sawtooth', formant: 1.12, spread: 4, rate: 1.1, breath: 0.1, level: 1.1 },
  /** Baker: big, slow, warm baritone. */
  bram: { base: 118, wave: 'sawtooth', formant: 0.84, spread: 3, rate: 0.8, breath: 0.05, presence: 1, level: 1.08 },
  /** Painter: airy, flighty, wide melodic range. */
  wren: { base: 330, wave: 'triangle', formant: 1.2, spread: 7, rate: 1.25, breath: 0.25, level: 0.77 },
  /** Blacksmith: low, clipped, few inflections. */
  odessa: { base: 190, wave: 'sawtooth', formant: 0.95, spread: 2, rate: 0.95, breath: 0.08, presence: 0.6, level: 1.08 },
  /** Doctor: measured, mid, precise. */
  linus: { base: 150, wave: 'sawtooth', formant: 0.92, spread: 3, rate: 0.9, breath: 0.12, presence: 0.8 },
  /** Innkeeper: warm alto, lilting. */
  june: { base: 245, wave: 'sawtooth', formant: 1.05, spread: 5, rate: 1, breath: 0.15, level: 1.12 },
  /** Old lamplighter: low, breathy, slow (a reedy sawtooth source: a triangle's 235 Hz centroid vanished under the score's low-mids). */
  tobias: { base: 128, wave: 'sawtooth', formant: 0.88, spread: 4, rate: 0.72, breath: 0.35, presence: 1, level: 1.04 },
  /** Kid: high, quick, bouncy. */
  kit: { base: 400, wave: 'square', formant: 1.35, spread: 6, rate: 1.4, breath: 0.05, level: 0.7 },
  player: { base: 220, wave: 'triangle', formant: 1.05, spread: 4, rate: 1, breath: 0.1, presence: 0.4, level: 0.87 },
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
  // Mine + combat (world/mine/sfx.ts cues, voiced here since round 12): one blow per monster kind
  // (level bit 0 = crit, level >= 2 = the killing blow), rocks, gems, the lift, lava, the pass-out.
  'hit:slime', 'hit:crab', 'hit:bat', 'hit:wisp', 'hit:imp', 'hit:flesh', 'parry', 'monster:pop',
  'mine:pick', 'mine:break', 'gem', 'mine:reveal', 'sizzle', 'fireball', 'lift', 'passout',
  'harvest', 'pickup', 'coin', 'purchase', 'ship', 'craft',
  'charge', 'refill', 'place', 'giant', 'hoe:dull',
  'ui:click', 'ui:hover', 'ui:open', 'ui:close', 'ui:error', 'ui:select', 'ui:tab', 'ui:slot', 'ui:toggle', 'ui:tick', 'ui:trash', 'ui:drop', 'ui:sell',
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
  // (harvest, round 12: +6.6 dB — the gameplay render had the pop only +0.8 over the louder melody bus)
  harvest: 1.32, coin: 0.6, craft: 0.6, 'gift:love': 0.4, 'gift:like': 0.6, heart: 0.6, catch: 0.42, 'catch:perfect': 0.42,
  lantern: 0.48, hall: 0.34, treefall: 1.7, purchase: 0.75, ship: 0.8, bite: 0.6, bundle: 0.75, sleep: 0.8, morning: 0.8,
  swing: 5.9, 'axe:miss': 6, warp: 3, eat: 3, plant: 8, sword: 5, scythe: 16, weed: 5,
  // Round 9 hierarchy: a splash / plop is a water event, louder than a footstep (splash ≈ -20 LUFS
  // momentary on the reel), the door ≈ -24, thunder a +10 dB event over the storm bed.
  splash: 3.3, plop: 1.8, door: 2.7, thunder: 1.6, 'hoe:dull': 1.7,
  giant: 0.45, reel: 1.4, crow: 1.2,
  // Round 4 hierarchy (in-game probe: watering and walking were lost under birdsong while menus
  // were louder than tools). Gameplay verbs peak around -18…-22 dBFS in game, UI -24…-28, ambience
  // events at or below -30: watering +14.6 dB (plus a soil-splash transient), scythe +9.4 dB, menu
  // open / close -5 / -4 dB, hover +10 dB, select (talking to a villager) +8 dB.
  water: 7, 'ui:drop': 2.6, 'ui:trash': 1.8,
  // Round 4 UI hierarchy (reel, 100 ms loudness — the ear's integration time for short cues):
  // hover ≈ click − 6 (it fires constantly), click ≈ select ≈ slot ≈ tab, open / close over click,
  // the error cue at least as loud as open (a cue you can't miss); the whole set inside 8 LU.
  'ui:open': 0.95, 'ui:close': 1.38, 'ui:hover': 10.9, 'ui:select': 11, 'ui:tab': 2.8, 'ui:toggle': 5.3, 'ui:error': 1.85,
  // (Round 7: menu open / talk-select +2.8 dB — the live probe had them at the ambience floor + 3 dB, a
  // chorus of birds away from inaudible; still ~6 dB under the quietest farming verb.)
  // Reel: clicks / ticks sat ~15 dB under the set, mowing ~15 dB — lifted to read under a playing score.
  'ui:click': 4.9,
  // Toolbar detent: level with ui:tab on the reel (it measured 5.5 dB under it).
  // (Round 9: +6 dB — the live probe had it 2 dB over the ambience floor.)
  'ui:slot': 5.6,
  // In-game probe (--live): the hardest hits sat 8–11 dB over the score's RMS — pull them in a little.
  rockbreak: 2.7, hoe: 6.4,
  // Round 2 (gameplay render, SFX bus +8 dB): the tools join the hoe as verbs (≈ -17…-20 LUFS
  // momentary on the reel), rewards / stingers pulled ~2 dB under them so they stay under median + 9.
  axe: 2.2, pickaxe: 2.6, 'sword:hit': 4.8, hurt: 2, 'ui:tick': 5.2,
  // Round 12: combat lands harder than tilling (the reel had sword -23.7 / slime:hit -23.3 LUFS
  // momentary against the hoe's -14.4): the swing +2.9 dB (3.6 → 5), the hit +3.7 dB (it must clear the
  // swing by 2 LU on the reel), the blows built on a contact
  // layer and levelled with the payoffs (a kill outranks a hit, a crit rings over a plain one).
  // (--live peaks, round 12: slime -12.1, crab -15.3, bat -16.1 vs the hoe -13.8 → crab / bat / wisp up.)
  'hit:slime': 2.6, 'hit:crab': 3.1, 'hit:bat': 3.9, 'hit:wisp': 3.1, 'hit:imp': 3, 'hit:flesh': 2.6, parry: 2.2,
  'monster:pop': 2.4, 'mine:pick': 2.6, 'mine:break': 2.6, gem: 0.6, 'mine:reveal': 0.6, sizzle: 2.4, fireball: 2.6, lift: 1.4, passout: 0.7,
  'slime:hit': 1.8, 'slime:die': 1.8, slime: 1.8,
  // Round 3 additions, levelled from the reel (median momentary max ≈ -21 LUFS): level-up / chest sit
  // with the rewards (~-15), emotes and chat around the small foley (~-20 … -26).
  levelup: 0.55, chest: 0.7, join: 0.6, leave: 0.7, learn: 0.55, paper: 4.5, sprinkler: 1.2, wither: 6, chat: 3.4, // (chat +4.6 dB in round 5: the beds came up 6 dB)
  'emote:question': 3, 'emote:sweat': 3.5, 'emote:anger': 2, 'emote:sad': 2.2, 'emote:zzz': 1.2, 'emote:dots': 4, 'emote:music': 0.7,
};

/**
 * Round 5: the whole menu set +4.4 dB (spacing inside it unchanged) — clicks sat ~5 dB under the
 * score's short-term max; with the menu duck (systems/audio.ts) they now sit on top of the page.
 */
const UI_LIFT = 1.66;

/** Impacts that get per-repeat pitch (±2.5 st) and level (±1.2 dB) variation. */
const VARY = new Set(['hoe', 'hoe:dull', 'axe', 'pickaxe', 'rockbreak', 'sword', 'sword:hit', 'slime:hit', 'hurt', 'hit:slime', 'hit:crab', 'hit:bat', 'hit:wisp', 'hit:imp', 'hit:flesh', 'parry', 'mine:pick', 'mine:break', 'monster:pop', 'door', 'place', 'plant', 'weed', 'scythe', 'swing', 'axe:miss', 'harvest', 'pickup', 'eat', 'ladder']);

const LONG_SFX = new Set(['passout', 'lift', 'mine:break', 'gem', 'mine:reveal', 'treefall', 'hall', 'lantern', 'catch', 'catch:perfect', 'sleep', 'thunder', 'giant', 'gift:love', 'levelup', 'join', 'chest']);

export class Sfx {
  private out: GainNode;
  private ui: GainNode;
  private send: GainNode;
  private caveSend: GainNode;
  /** Soft-surface footsteps (grass / soil): a +5 dB presence peak at 2.5 kHz so the blades / grit
   * read over a plucked score's 1–4 kHz (round 4: the onset sat 3 dB under the kalimba). */
  private stepPresence: BiquadFilterNode;
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
    this.stepPresence = ctx.createBiquadFilter();
    this.stepPresence.type = 'peaking';
    this.stepPresence.frequency.value = 2500;
    this.stepPresence.Q.value = 0.8;
    this.stepPresence.gain.value = 5;
    this.stepPresence.connect(this.out);
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
  private bus(o: SfxOpts | undefined, ui = false, key = !ui, dest?: AudioNode): { d: AudioNode; t: number } {
    const ctx = this.g.ctx;
    const t = Math.max(o?.at ?? ctx.currentTime, ctx.currentTime);
    const gn = ctx.createGain();
    gn.gain.value = o?.gain ?? 1;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o?.pan ?? 0, -1, 1);
    gn.connect(p).connect(dest ?? (ui ? this.ui : this.out));
    if (key) p.connect(this.g.duckKey);
    return { d: gn, t };
  }

  /** A scaled tap of a one-shot's bus (layering one design under another at a lower level). */
  private sub(d: AudioNode, k: number): AudioNode {
    const s = this.g.ctx.createGain();
    s.gain.value = k;
    s.connect(d);
    return s;
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

  /** Real time: a chime's cached note is missing (the worker is asked; see engine.ts). */
  onMissing: ((inst: InstrumentName, midi: number) => void) | null = null;

  private chime(d: AudioNode, t: number, midi: number, amp: number, inst: 'celesta' | 'bell' | 'kalimba' | 'marimba' | 'musicBox' | 'harp' = 'celesta'): void {
    // Never synthesize a note buffer on the frame: if the LRU dropped this pitch, a light additive
    // stand-in (fundamental + the bar's 2.76 / 5.4 partials) plays and the worker renders the real one.
    if (this.onMissing && !this.g.offline) {
      const keys = noteKeys(inst, midi);
      if (keys.length && !keys.some((k) => this.g.hasBuffer(k))) {
        this.onMissing(inst, midi);
        const f = mtof(midi);
        this.tone(d, t, { f0: f, amp: amp * 0.42, attack: 0.002, tau: 0.22 });
        this.tone(d, t, { f0: f * 2.76, amp: amp * 0.12, attack: 0.001, tau: 0.08 });
        this.tone(d, t, { f0: f * 5.4, amp: amp * 0.05, attack: 0.001, tau: 0.03 });
        return;
      }
    }
    INSTRUMENTS[inst](this.g, d, t, midi, 0.6, amp);
  }

  // ───────────────────────────────────────────── footsteps

  step(surface: Surface, o?: SfxOpts): void {
    this.stepSide = -this.stepSide;
    // Per-surface trims level the set (reel analysis: wood knocked ~12 dB over dirt / stone).
    // +6.5 dB over round 3 (steps were buried under the dawn chorus), sand / snow / shallow water
    // brought up to the set.
    // Round 9: surfaces levelled to within ±2 dB on the reel (snow and sand had run 8 dB over wood).
    // Round 12: the whole set +2 dB and menu open / close -1.3 dB (live check: grass sat 3.2 dB
    // under the menu open / close cues; the hierarchy wants verbs within 3 dB of the loudest menu cue).
    const soft = surface === 'grass' || surface === 'tilled' || surface === 'dirt';
    // (The presence peak adds ~2 dB of loudness to the soft surfaces: trimmed back so the set stays level.)
    const trim = (soft ? 0.88 : 1) * (surface === 'wood' ? 0.74 : surface === 'grass' ? 0.95 : surface === 'sand' ? 1.28 : surface === 'snow' ? 1.6 : surface === 'water' ? 1.8 : surface === 'stone' ? 1.45 : 1.38);
    const { d, t } = this.bus({ ...o, pan: (o?.pan ?? 0) + this.stepSide * 0.06, gain: (o?.gain ?? 1) * trim * this.v(1.45 * 2.1 * 1.26) }, false, false, soft ? this.stepPresence : undefined);
    const k = 0.9 + this.rng.next() * 0.2;
    // Sole scuff: a short 2–4 kHz grain on every surface — the part that cuts through birdsong.
    // (Round 5: +3 dB — steps sat ~7 dB under the bed in the gameplay check; this grain carries them.)
    if (surface !== 'water') this.noise(d, t + 0.004, { f: 2900 * k, q: 1.3, amp: surface === 'wood' ? 0.07 : 0.1, attack: 0.003, tau: 0.014, buf: this.g.pink });
    switch (surface) {
      case 'grass':
        this.noise(d, t, { f: 1300 * k, q: 0.7, amp: 0.2, attack: 0.008, tau: 0.03, buf: this.g.pink });
        // Blades crushed underfoot: a few crisp 2–4 kHz grains (what reads over birdsong and a score).
        for (let i = 0; i < 3; i++) this.noise(d, t + 0.006 + i * 0.012 + this.rng.next() * 0.006, { f: (2100 + this.rng.next() * 1800) * k, q: 2, amp: 0.075, tau: 0.007 });
        this.noise(d, t + 0.01, { type: 'highpass', f: 4200, amp: 0.018, attack: 0.01, tau: 0.02 });
        this.tone(d, t, { f0: 95, amp: 0.07, tau: 0.022 });
        // Low-mid crunch (300–800 Hz): the stems give underfoot — the body the hiss alone lacked.
        this.noise(d, t + 0.003, { f: 520 * k, q: 1.1, amp: 0.2, attack: 0.004, tau: 0.035, buf: this.g.pink });
        // Heel-to-toe roll: the forefoot comes down 45–75 ms later and brushes the blades again —
        // a softer, airier swish (a real step is two contacts, not one click).
        this.roll(d, t, k, 0.6);
        break;
      case 'dirt':
      case 'tilled':
        // Soft heel thud + a gritty crunch of small grains.
        // (Grit +3.5 dB, heel −1.5 dB: the step's centroid sat at ~370 Hz — a laptop heard a dull pat.)
        this.noise(d, t, { f: (surface === 'tilled' ? 650 : 950) * k, q: 1, amp: 0.2, attack: 0.004, tau: 0.03, buf: this.g.pink });
        for (let i = 0; i < 5; i++) this.noise(d, t + 0.006 + i * 0.01 + this.rng.next() * 0.006, { f: (1900 + this.rng.next() * 2200) * k, q: 2.5, amp: 0.105 * (1 - i * 0.15), tau: 0.008 });
        this.tone(d, t, { f0: 80, amp: 0.06, tau: 0.03 });
        this.roll(d, t, k, surface === 'tilled' ? 0.35 : 0.5, 0.7);
        break;
      case 'wood':
        // Hollow plank knock: a smaller low body, the board's mid modes and a heel click on top.
        this.tone(d, t, { f0: 170 * k, f1: 120, amp: 0.06, tau: 0.03 });
        this.tone(d, t, { f0: 410 * k, amp: 0.06, tau: 0.03 });
        this.tone(d, t, { f0: 890 * k, amp: 0.06, tau: 0.018 });
        this.noise(d, t, { f: 750 * k, q: 3, amp: 0.2, tau: 0.02 });
        this.noise(d, t + 0.003, { f: 1900 * k, q: 2, amp: 0.34, tau: 0.018 });
        this.noise(d, t + 0.001, { f: 3300 * k, q: 2, amp: 0.18, tau: 0.009 });
        // Sole scuffing the grain (1–2 kHz) as the foot rolls off.
        this.noise(d, t + 0.05 + this.rng.next() * 0.02, { f: 1400 * k, q: 1.2, amp: 0.07, attack: 0.008, tau: 0.03, buf: this.g.pink });
        if (this.rng.chance(0.06)) this.creak(d, t + 0.05, 0.4);
        break;
      case 'stone':
        // Hard click of a sole on cobbles, a little scuff.
        this.noise(d, t, { f: 2700 * k, q: 3, amp: 0.2, tau: 0.01 });
        this.noise(d, t + 0.003, { f: 4300 * k, q: 4, amp: 0.07, tau: 0.007 });
        this.noise(d, t, { type: 'lowpass', f: 520, amp: 0.16, tau: 0.02, buf: this.g.pink });
        this.noise(d, t + 0.03, { f: 1600 * k, q: 1, amp: 0.035, attack: 0.01, tau: 0.03, buf: this.g.pink });
        this.tone(d, t, { f0: 140 * k, amp: 0.05, tau: 0.02 });
        // Grit scuff (1–2 kHz) as the sole slides off the cobble.
        this.noise(d, t + 0.045 + this.rng.next() * 0.02, { f: 1500 * k, q: 1.3, amp: 0.08, attack: 0.006, tau: 0.025, buf: this.g.pink });
        break;
      case 'sand':
        // Sand gives: a soft 400–700 Hz compression thump under the hiss of grains.
        this.noise(d, t, { f: 560 * k, q: 0.9, amp: 0.26, attack: 0.015, tau: 0.05, buf: this.g.pink });
        // Round 5: the heel's first bite into dry grains — a tight crunch at the contact frame so the
        // step has the same attack as the other surfaces (sand peaked 3.4 dB under grass).
        this.crunch(d, t + 0.002, 0.13, { n: 4, span: 0.02, lo: 1800, hi: 4200, click: 0.35, clickF: 900 + this.rng.next() * 300 });
        this.noise(d, t + 0.005, { f: 1700 * k, q: 0.5, amp: 0.2, attack: 0.025, tau: 0.05, buf: this.g.pink });
        this.noise(d, t + 0.02, { type: 'highpass', f: 5200, amp: 0.012, attack: 0.02, tau: 0.03 });
        break;
      case 'snow':
        // Compressed-snow squeak: a burst of tiny tuned crunches.
        // (Round 5: the first squeak +4 dB — the crunch's attack — to level its peak with grass.)
        for (let i = 0; i < 7; i++) this.noise(d, t + i * 0.011 + this.rng.next() * 0.006, { f: (1500 + this.rng.next() * 1300) * k, q: 3.5, amp: (i === 0 ? 0.21 : 0.16) * (1 - i * 0.11), tau: 0.009 });
        this.noise(d, t, { type: 'lowpass', f: 800, amp: 0.18, attack: 0.01, tau: 0.04, buf: this.g.pink });
        this.roll(d, t, k, 0.8, 0.75);
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

  /**
   * The toe half of a footstep: 45–75 ms after the heel, two or three small grains in the 2.4–5 kHz
   * band plus a soft pink brush, `amp` relative to the heel; `tone` < 1 darkens it (soil, snow).
   */
  private roll(d: AudioNode, t: number, k: number, amp: number, tone = 1): void {
    const r = this.rng;
    const tt = t + 0.045 + r.next() * 0.03;
    this.noise(d, tt, { f: 1900 * k * tone, q: 0.9, amp: 0.09 * amp, attack: 0.006, tau: 0.022, buf: this.g.pink });
    const n = r.chance(0.5) ? 2 : 3;
    for (let i = 0; i < n; i++) this.noise(d, tt + 0.004 + i * 0.01 + r.next() * 0.005, { f: (2400 + r.next() * 2600) * k * tone, q: 2.2, amp: 0.06 * amp, tau: 0.006 });
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
    // Repeated impacts never machine-gun: ±2.5 semitones and ±1.2 dB per repeat.
    const vary = VARY.has(name);
    this.pv = vary ? Math.pow(2, r.range(-2.5, 2.5) / 12) : 1;
    // (Round 5: level ±1.2 dB, was ±2 — the pitch carries the variety; ±2 dB let a chop outshout
    // the tree crash it set up.)
    const lv = vary ? Math.pow(10, r.range(-1.2, 1.2) / 20) : 1;
    const key = !ui && name !== 'reel' && !name.startsWith('step:') && !name.startsWith('emote:');
    const { d, t } = this.bus({ ...o, gain: (o?.gain ?? 1) * (TRIM[name] ?? 1) * lv * (name.startsWith('ui:') ? UI_LIFT : 1) }, ui, key);
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
        // Air moving past the tool: a band-passed noise sweep that rises as the head comes through
        // (350 Hz → 2.2 kHz) and falls away behind it (1.8 kHz → 600 Hz), with a little low body.
        this.noise(d, t, { f: 350, f1: 2200, q: 1.8, amp: 0.2, attack: 0.09, tau: 0.03, buf: this.g.pink });
        this.noise(d, t + 0.1, { f: 1800, f1: 600, q: 1.5, amp: 0.13, attack: 0.012, tau: 0.05, buf: this.g.pink });
        this.noise(d, t + 0.04, { type: 'lowpass', f: 600, amp: 0.07, attack: 0.05, tau: 0.04, buf: this.g.pink });
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
        // A heavy head cutting empty air: a deeper, slower sweep than the hand-tool swing (300 Hz →
        // 1.6 kHz → 500 Hz) with a breathy top — a whoosh, not a thud.
        this.noise(d, t, { f: 300, f1: 1600, q: 1.6, amp: 0.2, attack: 0.12, tau: 0.035, buf: this.g.pink });
        this.noise(d, t + 0.13, { f: 1400, f1: 500, q: 1.4, amp: 0.14, attack: 0.015, tau: 0.06, buf: this.g.pink });
        this.noise(d, t + 0.08, { f: 3200, q: 0.9, amp: 0.025, attack: 0.04, tau: 0.03 });
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
        // Round 5 payoff: the trunk hits the ground with weight — a 50-80 Hz ground thump that rings
        // (tau 0.35 s), a 200-400 Hz body bloom, then the crown settling: a 1.2 s leaf-and-twig
        // rustle that thins out, with late branch snaps. The score ducks hard under the landing.
        this.tone(d, t + 1.45, { f0: 78, f1: 48, glide: 0.35, amp: 0.15, attack: 0.004, tau: 0.35 });
        this.noise(d, t + 1.45, { type: 'lowpass', f: 380, amp: 0.22, attack: 0.006, tau: 0.22, buf: this.g.brown });
        this.noise(d, t + 1.46, { f: 260, q: 0.9, amp: 0.2, attack: 0.01, tau: 0.18, buf: this.g.pink });
        this.noise(d, t + 1.5, { f: 1800, f1: 3400, q: 0.6, amp: 0.4, attack: 0.06, tau: 0.42, buf: this.g.pink });
        this.noise(d, t + 1.55, { f: 4200, q: 0.8, amp: 0.12, attack: 0.08, tau: 0.45 });
        for (let i = 0; i < 6; i++) this.crunch(d, t + 1.7 + i * (0.12 + r.next() * 0.1), 0.16 * (1 - i * 0.12), { n: 4, span: 0.05, lo: 1800, hi: 4800, click: 0.3 });
        this.g.duckMusic(t + 1.4, 0.45, 0.9, 1.2);
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
        // Round 5 payoff: the halves fall apart — a fuller 120-300 Hz knock of the chunks landing,
        // a 0.3 s gravel slide and a second rattle of shards, so the break outranks the strike.
        this.tone(d, t + 0.12, { f0: 140, f1: 90, glide: 0.1, amp: 0.2, tau: 0.08 });
        this.noise(d, t + 0.12, { f: 900, q: 0.7, amp: 0.34, attack: 0.01, tau: 0.12, buf: this.g.pink });
        this.noise(d, t + 0.16, { f: 2600, q: 0.7, amp: 0.16, attack: 0.03, tau: 0.16, buf: this.g.pink });
        this.crunch(d, t + 0.2, 0.2, { n: 8, span: 0.22, lo: 1600, hi: 4600, click: 0.4, clickF: 1250 });
        this.crumbs(d, t + 0.3, 10, 0.08, 0.4);
        this.g.duckMusic(t, 0.75, 0.25, 0.4);
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
        // A blade cutting air: band-passed noise swept 600 Hz → 3 kHz as the edge comes toward you and
        // falling back (~2 kHz → 1 kHz) as it passes — a Doppler-ish "vwoosh", not a thud — a whisper of
        // body under it and a faint ring of the steel.
        this.noise(d, t, { f: 600, f1: 3000, q: 2.2, amp: 0.26, attack: 0.07, tau: 0.03, buf: this.g.pink });
        this.noise(d, t + 0.085, { f: 2400, f1: 1000, q: 2, amp: 0.2, attack: 0.008, tau: 0.045, buf: this.g.pink });
        this.noise(d, t + 0.05, { f: 5200, q: 1.2, amp: 0.035, attack: 0.03, tau: 0.03 });
        this.tone(d, t + 0.05, { f0: 220, f1: 160, glide: 0.08, amp: 0.05, attack: 0.03, tau: 0.04, lp: 600 });
        this.tone(d, t + 0.06, { f0: 2640, amp: 0.006, tau: 0.09 });
        break;
      }
      case 'sword:hit':
        // A connecting blow: a bright contact transient, a slap with a 300 Hz body that drops in pitch
        // (the "thwack" tail), a contact crunch and a blade tick.
        this.noise(d, t, { type: 'highpass', f: 2500, amp: 0.12, attack: 0.0005, tau: 0.004 });
        this.tone(d, t, { f0: 300, f1: 150, glide: 0.05, amp: 0.14, tau: 0.035 });
        this.tone(d, t + 0.004, { type: 'triangle', f0: 640, f1: 170, glide: 0.11, amp: 0.1, tau: 0.06, lp: 1600 });
        this.noise(d, t + 0.01, { f: 900, f1: 380, q: 1.4, amp: 0.12, attack: 0.004, tau: 0.06, buf: this.g.pink });
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
      case 'hit:slime':
      case 'hit:crab':
      case 'hit:bat':
      case 'hit:wisp':
      case 'hit:imp':
      case 'hit:flesh': {
        // A blow landing on a monster: the blade's contact (sword:hit) + the creature's own answer.
        const lv = o?.level ?? 0;
        const crit = lv % 2 === 1;
        const killed = lv >= 2;
        const kind = name.slice(4);
        this.voice('sword:hit', this.sub(d, 0.8), t, o);
        // Body thump under every blow (120-200 Hz, short: weight, not boom).
        this.tone(d, t, { f0: 190, f1: 105, glide: 0.06, amp: 0.16, tau: 0.045 });
        if (kind === 'slime' || kind === 'flesh') {
          // Wet squelch: a falling formant pluck + band-passed goo noise.
          this.tone(d, t + 0.005, { f0: 430, f1: 180, glide: 0.1, amp: 0.3, tau: 0.055, lp: 1300 });
          this.noise(d, t + 0.004, { f: 950, f1: 380, q: 2.4, amp: 0.24, tau: 0.045, buf: this.g.pink });
          this.noise(d, t + 0.04, { f: 1700, f1: 900, q: 4, amp: 0.08, attack: 0.006, tau: 0.03, buf: this.g.pink });
          if (killed) {
            // It bursts: a gloopy collapse, three wet drips and a small bright "pop" in key.
            this.noise(d, t + 0.06, { f: 820, f1: 260, q: 2, amp: 0.2, attack: 0.012, tau: 0.09, buf: this.g.pink });
            this.tone(d, t + 0.1, { f0: 480, f1: 1200, glide: 0.05, amp: 0.1, tau: 0.03 });
            for (let i = 0; i < 3; i++) this.tone(d, t + 0.2 + i * 0.075 + r.next() * 0.02, { f0: 420 - i * 70, f1: 260 - i * 50, glide: 0.05, amp: 0.12, tau: 0.03, lp: 1100 });
            this.chime(d, t + 0.24, this.kn(4), 0.07);
          }
        } else if (kind === 'crab') {
          // Shell clank: three inharmonic plate partials over a hollow knock, a chitin crunch.
          const f = 1080 * (0.95 + r.next() * 0.1);
          this.tone(d, t, { f0: f, amp: 0.09, tau: 0.07 });
          this.tone(d, t, { f0: f * 1.71, amp: 0.06, tau: 0.05 });
          this.tone(d, t, { f0: f * 2.63, amp: 0.035, tau: 0.035 });
          this.tone(d, t, { type: 'triangle', f0: 380, f1: 300, glide: 0.04, amp: 0.16, tau: 0.04, lp: 1400 });
          this.crunch(d, t + 0.003, 0.22, { n: 6, span: 0.035, lo: 2000, hi: 5200, click: 0.9, clickF: 2100 });
          if (killed) {
            // The shell cracks open and the pieces skitter.
            this.crunch(d, t + 0.07, 0.26, { n: 10, span: 0.08, lo: 1400, hi: 4800, click: 1, clickF: 1300 });
            this.crumbs(d, t + 0.16, 9, 0.09, 0.4);
            this.tone(d, t + 0.08, { f0: 160, f1: 95, glide: 0.08, amp: 0.18, tau: 0.07 });
          }
        } else if (kind === 'bat') {
          // A squeaky chirp-screech (2.2–3.6 kHz, two quick syllables) and a flurry of wing beats.
          for (let i = 0; i < 2; i++) {
            const f0 = 3500 - i * 380 + r.next() * 200;
            this.tone(d, t + 0.02 + i * 0.07, { type: 'triangle', f0, f1: f0 * 0.66, glide: 0.06, amp: 0.07, attack: 0.004, tau: 0.03, lp: 5200 });
          }
          for (let i = 0; i < 4; i++) this.noise(d, t + 0.06 + i * 0.045, { f: 700 + r.next() * 400, q: 1.2, amp: 0.1 * (1 - i * 0.18), attack: 0.006, tau: 0.018, buf: this.g.pink });
          if (killed) {
            this.tone(d, t + 0.18, { type: 'triangle', f0: 2900, f1: 1300, glide: 0.25, amp: 0.07, attack: 0.01, tau: 0.09, lp: 4000 });
            this.tone(d, t + 0.42, { f0: 170, f1: 110, glide: 0.04, amp: 0.16, tau: 0.035 });
            this.noise(d, t + 0.42, { f: 900, q: 1, amp: 0.12, tau: 0.03, buf: this.g.pink });
          }
        } else if (kind === 'wisp') {
          // Static zap: a falling sine sweep with an inharmonic shadow and a crackle of 3–6 kHz sparks.
          this.tone(d, t, { f0: 1650, f1: 380, glide: 0.18, amp: 0.1, tau: 0.08 });
          this.tone(d, t, { f0: 2390, f1: 610, glide: 0.18, amp: 0.045, tau: 0.06 });
          for (let i = 0; i < 6; i++) this.noise(d, t + r.next() * 0.12, { f: 3000 + r.next() * 3000, q: 3, amp: 0.05 + r.next() * 0.05, attack: 0.0008, tau: 0.006 });
          if (killed) {
            // The spirit comes apart into glass: a falling celesta spray in key and a sigh of air.
            [7, 5, 4, 2, 0].forEach((k, i) => this.chime(d, t + 0.08 + i * 0.05, this.kn(k - 5), 0.05 - i * 0.006));
            this.noise(d, t + 0.05, { f: 1800, f1: 700, q: 0.8, amp: 0.07, attack: 0.06, tau: 0.2, buf: this.g.pink });
          }
        } else {
          // Imp: a leathery smack, a low growl and the hiss of its embers.
          this.tone(d, t + 0.01, { type: 'sawtooth', f0: 125, f1: 90, glide: 0.12, amp: 0.07, attack: 0.01, tau: 0.06, lp: 520 });
          this.noise(d, t + 0.01, { f: 2600, q: 0.9, amp: 0.025, attack: 0.01, tau: 0.1, buf: this.g.pink });
          if (killed) {
            this.noise(d, t + 0.05, { f: 380, f1: 1200, q: 0.9, amp: 0.26, attack: 0.03, tau: 0.12, buf: this.g.brown });
            this.noise(d, t + 0.08, { f: 1800, q: 0.8, amp: 0.04, attack: 0.02, tau: 0.22, buf: this.g.pink });
          }
        }
        if (crit) {
          // A critical: the blade rings out (a bright steel partial pair) and the crunch doubles.
          this.tone(d, t + 0.002, { f0: 2620, amp: 0.05, tau: 0.16 });
          this.tone(d, t + 0.002, { f0: 3930, amp: 0.025, tau: 0.1 });
          this.crunch(d, t + 0.006, 0.22, { n: 6, span: 0.03, click: 0.6 });
        }
        this.g.duckMusic(t, killed ? 0.7 : 0.85, killed ? 0.35 : 0.15, 0.3);
        break;
      }
      case 'parry':
        // Fireball knocked off the blade: a short steel clang + an ember spray.
        // (A body knock under the steel so it isn't all 2-4 kHz.)
        this.tone(d, t, { f0: 420, f1: 300, glide: 0.04, amp: 0.16, tau: 0.04 });
        this.tone(d, t, { f0: 1240, amp: 0.07, tau: 0.09 });
        this.tone(d, t, { f0: 1840, amp: 0.04, tau: 0.07 });
        this.tone(d, t, { f0: 2950, amp: 0.015, tau: 0.05 });
        this.crunch(d, t, 0.12, { n: 4, span: 0.03, click: 0.8, clickF: 1400 });
        for (let i = 0; i < 4; i++) this.noise(d, t + 0.03 + r.next() * 0.2, { f: 2200 + r.next() * 1500, q: 2.5, amp: 0.025, attack: 0.001, tau: 0.008 });
        break;
      case 'monster:pop':
        // A monster dissolving (no kill blow voiced it): a soft goo pop and a little sparkle.
        this.tone(d, t, { f0: 300, f1: 720, glide: 0.05, amp: 0.16, tau: 0.035, lp: 1600 });
        this.noise(d, t, { f: 900, f1: 400, q: 1.6, amp: 0.14, attack: 0.006, tau: 0.06, buf: this.g.pink });
        this.chime(d, t + 0.08, this.kn(5), 0.08);
        break;
      case 'mine:pick': {
        // Pick on cave rock: the farm's pickaxe strike, plus an ore vein's ringing glint in key.
        this.voice('pickaxe', d, t, o);
        if ((o?.level ?? 0) >= 1) {
          this.tone(d, t + 0.004, { f0: 2640 * (0.97 + r.next() * 0.06), amp: 0.03, tau: 0.22 });
          this.chime(d, t + 0.03, this.kn(5), 0.07, 'bell');
        }
        break;
      }
      case 'mine:break': {
        // The rock splits (the farm's rockbreak) over a softer pick tap; boulders add a low rumble.
        this.voice('pickaxe', this.sub(d, 0.55), t, o);
        this.voice('rockbreak', d, t + 0.008, o);
        if ((o?.level ?? 0) >= 1) {
          this.noise(d, t + 0.05, { type: 'lowpass', f: 220, q: 0.7, amp: 0.32, attack: 0.04, tau: 0.32, buf: this.g.brown });
          this.crumbs(d, t + 0.35, 10, 0.07, 0.6);
        }
        break;
      }
      case 'gem':
        // A gem knocked loose: a glassy celesta arpeggio crowned by a bell, a breath of shimmer.
        [0, 2, 4, 7].forEach((k, i) => this.chime(d, t + i * 0.055, this.kn(k + 2), 0.16 - i * 0.015));
        this.chime(d, t + 0.24, this.kn(9), 0.12, 'bell');
        this.noise(d, t + 0.05, { f: 6200, q: 2, amp: 0.018, attack: 0.04, tau: 0.25 });
        break;
      case 'mine:reveal':
        // The ladder down shows itself: a low wooden thunk under the dust, then a rising harp in key.
        this.tone(d, t, { f0: 150, f1: 100, glide: 0.06, amp: 0.2, tau: 0.06 });
        this.noise(d, t, { f: 700, q: 0.8, amp: 0.16, attack: 0.01, tau: 0.12, buf: this.g.pink });
        [0, 2, 4, 5, 7].forEach((k, i) => this.chime(d, t + 0.12 + i * 0.07, this.kn(k), 0.18, 'harp'));
        this.g.duckMusic(t, 0.7, 0.6, 0.8);
        break;
      case 'sizzle':
        // Lava on boot leather: a hiss (3–8 kHz, high-passed) with spitting crackles and a dull puff.
        // (Round 12 reel: was 9 kHz centroid — the hiss now sits at 1.5-3 kHz over a fat puff of steam.)
        this.noise(d, t, { f: 2200, q: 0.7, amp: 0.1, attack: 0.01, tau: 0.16, buf: this.g.pink });
        for (let i = 0; i < 9; i++) this.noise(d, t + r.next() * 0.35, { f: 1500 + r.next() * 2000, q: 3, amp: 0.03 + r.next() * 0.03, attack: 0.0008, tau: 0.006 });
        this.noise(d, t + 0.02, { type: 'lowpass', f: 500, amp: 0.3, attack: 0.02, tau: 0.12, buf: this.g.brown });
        this.tone(d, t, { f0: 160, f1: 110, glide: 0.06, amp: 0.1, tau: 0.05 });
        break;
      case 'fireball':
        // An imp lobs fire: a breathy whoomph (brown noise sweeping 300 Hz → 1.4 kHz) and crackle.
        this.noise(d, t, { f: 320, f1: 1400, q: 0.9, amp: 0.3, attack: 0.04, tau: 0.12, buf: this.g.brown });
        this.noise(d, t + 0.03, { f: 1600, q: 0.8, amp: 0.03, attack: 0.03, tau: 0.15, buf: this.g.pink });
        for (let i = 0; i < 4; i++) this.noise(d, t + 0.05 + r.next() * 0.25, { f: 1200 + r.next() * 1800, q: 2.5, amp: 0.03, tau: 0.007 });
        break;
      case 'lift': {
        // The mine lift: a latch, a low motor hum under a chain clatter, then an arrival bell in key.
        this.tone(d, t, { f0: 2300, amp: 0.04, tau: 0.012 });
        this.crunch(d, t, 0.12, { n: 3, span: 0.02, click: 1, clickF: 1500 });
        this.tone(d, t + 0.08, { type: 'sawtooth', f0: 68, f1: 74, glide: 0.8, amp: 0.08, attack: 0.18, tau: 0.35, lp: 320 });
        for (let i = 0; i < 9; i++) {
          const tt = t + 0.12 + i * 0.085 + r.next() * 0.02;
          this.tone(d, tt, { f0: 1900 + r.next() * 900, amp: 0.022, tau: 0.012 });
          this.noise(d, tt, { f: 2600 + r.next() * 1200, q: 3, amp: 0.035, tau: 0.006 });
        }
        this.chime(d, t + 1.0, this.kn(0), 0.2, 'bell');
        this.chime(d, t + 1.0, this.kn(2), 0.12, 'bell');
        break;
      }
      case 'passout': {
        // Lights out: two muffled heartbeats under a slow, falling celesta line, a low swell, and the
        // score steps right back.
        for (let i = 0; i < 2; i++) {
          this.tone(d, t + i * 0.55, { f0: 70, f1: 50, glide: 0.08, amp: 0.3, tau: 0.07 });
          this.tone(d, t + i * 0.55 + 0.17, { f0: 62, f1: 46, glide: 0.08, amp: 0.2, tau: 0.06 });
        }
        [4, 2, 1, 0, -1].forEach((k, i) => this.chime(d, t + 0.2 + i * 0.28, this.kn(k), 0.15 - i * 0.015, 'musicBox'));
        INSTRUMENTS.pad(this.g, d, t + 0.1, this.kn(0, -2), 2.4, 0.5);
        this.g.duckMusic(t, 0.25, 2.5, 1.6);
        break;
      }
      case 'harvest':
        // The pluck: roots let go of the soil (a gritty snap of 2–6 kHz grains + a small click), the
        // leaves brush past (a short airy rustle) — the bright onset laptops can play — then the pop
        // and two kalimba notes from the current key.
        this.crunch(d, t, 0.11, { n: 6, span: 0.045, lo: 2000, hi: 6000, click: 0.35, clickF: 1600 + r.next() * 400 });
        this.noise(d, t + 0.012, { type: 'highpass', f: 3200, amp: 0.05, attack: 0.008, tau: 0.05 });
        this.tone(d, t, { f0: 280, f1: 950, glide: 0.06, amp: 0.32, tau: 0.045 });
        this.noise(d, t, { f: 1200, q: 1, amp: 0.16, tau: 0.025, buf: this.g.pink });
        // Round 5: the "pop" itself — a bright 2.5-4 kHz cork-pop transient (rising blip + tight
        // band of noise) that clears the score's 1-4 kHz band instead of sitting under it.
        this.tone(d, t + 0.004, { f0: 2500, f1: 3900, glide: 0.018, amp: 0.2, attack: 0.001, tau: 0.016 });
        this.noise(d, t + 0.002, { f: 3300, q: 1.6, amp: 0.34, attack: 0.0008, tau: 0.012 });
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
        // Steel glancing off hard ground: the dull thud, plus the part a laptop plays — a gritty
        // scrape of grains and a short, damped clink of the blade.
        // (Round 8: the thud still carried the cue — centroid 150 Hz, 33 LUFS — so the thud is
        // lighter and the scrape / clink are what you hear: a refusal you can read on a laptop.)
        this.noise(d, t, { type: 'lowpass', f: 520, amp: 0.14, attack: 0.003, tau: 0.03, buf: this.g.pink });
        this.tone(d, t, { f0: 120, f1: 80, glide: 0.05, amp: 0.1, tau: 0.025 });
        // (Round 9: the scrape / clink lowered ~4 dB in 2–5 kHz — the reel flagged it HARSH.)
        this.crunch(d, t + 0.002, 0.13, { n: 5, span: 0.035, lo: 1700, hi: 4500, click: 0.6, clickF: 1300 + r.next() * 300 });
        this.tone(d, t + 0.003, { f0: 2350 + r.next() * 200, amp: 0.032, attack: 0.001, tau: 0.04 });
        this.tone(d, t + 0.003, { f0: 3710 + r.next() * 200, amp: 0.012, attack: 0.001, tau: 0.025 });
        this.noise(d, t + 0.004, { f: 700, q: 1, amp: 0.1, attack: 0.002, tau: 0.03, buf: this.g.pink });
        break;
      case 'ui:tab':
        this.noise(d, t, { f: 1800, q: 1.4, amp: 0.06, attack: 0.012, tau: 0.02, buf: this.g.pink });
        this.chime(d, t + 0.01, this.kn(r.int(3, 5)), 0.1, 'kalimba');
        break;
      case 'ui:toggle':
        this.tone(d, t, { f0: 900, amp: 0.1, tau: 0.01 });
        this.tone(d, t + 0.045, { f0: 1350, amp: 0.08, tau: 0.012 });
        break;
      case 'ui:slot': {
        // Toolbar selection: a soft wooden detent, and a tiny kalimba note that climbs the key's
        // pentatonic with the slot (1 low … 0 high), so scrolling the bar plays a little scale.
        const slot = clamp(Math.round(o?.level ?? 0), 0, 9);
        this.tone(d, t, { f0: 1250 + slot * 40, amp: 0.07, tau: 0.006 });
        this.noise(d, t, { f: 2600, q: 2, amp: 0.035, tau: 0.004, buf: this.g.pink });
        this.chime(d, t + 0.004, this.kn(slot), 0.045, 'kalimba');
        break;
      }
      case 'ui:tick':
        // A small wooden tick (clock, counters).
        this.tone(d, t, { f0: 1500, amp: 0.12, tau: 0.008 });
        this.noise(d, t, { f: 2200, q: 2, amp: 0.05, tau: 0.004, buf: this.g.pink });
        break;
      case 'ui:trash':
        // Crumpled into the bin: a papery crackle, then the soft drop.
        this.crunch(d, t, 0.05, { n: 6, span: 0.07, lo: 2200, hi: 6000, click: 0 });
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
        // (Round 5) the page edge flicking past: a crisp 2.5–3.5 kHz tick on the very first frame,
        // so the cue's onset reads over the score's 1–4 kHz band before the chimes ring.
        this.noise(d, t, { f: 3000, q: 1.6, amp: 0.22, attack: 0.001, tau: 0.012 });
        this.chime(d, t + 0.03, this.kn(3), 0.16);
        this.chime(d, t + 0.09, this.kn(5), 0.16);
        break;
      case 'ui:close':
        this.noise(d, t, { f: 2200, f1: 600, q: 1.2, amp: 0.07, attack: 0.05, tau: 0.04, buf: this.g.pink });
        this.noise(d, t, { f: 2700, q: 1.6, amp: 0.09, attack: 0.001, tau: 0.01 });
        this.chime(d, t + 0.02, this.kn(5), 0.11);
        this.chime(d, t + 0.08, this.kn(3), 0.11);
        break;
      case 'ui:error':
        // A low, nasal "nuh-uh": two buzzy notes falling a minor third (B3 → G#3), reed-like square
        // waves through a soft low-pass so they carry on laptop speakers yet sit apart from every
        // chime-based menu cue, with a woody knock on each.
        for (const [k, f, len] of [[0, 247, 0.07], [0.13, 208, 0.11]] as const) {
          this.tone(d, t + k, { type: 'square', f0: f, f1: f * 0.985, glide: len, amp: 0.07, attack: 0.006, tau: len, lp: 1300 });
          this.tone(d, t + k, { f0: f, amp: 0.1, attack: 0.006, tau: len });
          this.noise(d, t + k, { f: 1100, q: 2.5, amp: 0.06, attack: 0.001, tau: 0.012 });
        }
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
        // Spray: the droplets thrown up fizz at 2–6 kHz and patter back for ~250 ms.
        this.noise(d, t + 0.01, { f: 3800, q: 0.7, amp: 0.12, attack: 0.008, tau: 0.08 });
        this.crumbs(d, t + 0.08, 10, 0.08, 0.25);
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
          // Boot on the rung: a hollow wooden knock in the 1.5 kHz band.
          this.noise(d, t + i * 0.2 + 0.004, { f: 1500 + i * 120, q: 3, amp: 0.07, attack: 0.001, tau: 0.012 });
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
      case 'thunder': {
        // A +10 dB event: the 2–5 kHz crack and its crackles, then a 40–120 Hz roll that ducks the score.
        this.noise(d, t, { f: 3200, q: 0.8, amp: 0.5, attack: 0.003, tau: 0.05 });
        this.noise(d, t + 0.01, { type: 'highpass', f: 1500, amp: 0.26, attack: 0.004, tau: 0.09 });
        for (let i = 0; i < 9; i++) this.noise(d, t + 0.03 + r.next() * 0.3, { f: 1800 + r.next() * 3000, q: 1.6, amp: 0.1 + r.next() * 0.15, attack: 0.002, tau: 0.015 + r.next() * 0.03 });
        let tt = t + 0.06;
        for (let i = 0; i < 5; i++) {
          this.noise(d, tt, { type: 'lowpass', f: 150, q: 0.8, amp: 1.1 - i * 0.12, attack: 0.12 + r.next() * 0.2, tau: 0.6 + r.next() * 0.6, buf: this.g.brown });
          tt += 0.35 + r.next() * 0.7;
        }
        this.g.duckMusic(t, 0.4, 2.2, 2.2);
        break;
      }
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
  murmur(voice: Voice, word: string, o?: SfxOpts, line?: { index: number; last: boolean }): number {
    const b = this.bus(o, true);
    // Sentence intonation: a gentle declination over the line (a semitone every ~4 words, at most
    // two), and the line's last word settles lower still — unless it asks a question.
    const decl = line ? -Math.min(2, line.index * 0.25) + (line.last && !/[?]$/.test(word) ? -1 : 0) : 0;
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
      // A one-syllable question still lifts on its only syllable.
      const semis = (((h >>> (i * 4 + 5)) % (voice.spread * 2 + 1)) - voice.spread) * 0.6 + arch + decl + (question && n === 1 ? 2 : 0);
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
    // Round 12: every voice +3 dB (the villagers measured -27.5 LUFS, 5-10 LU under the UI, and
    // vanished under the scores' low-mids) and a floor of consonant presence for all of them.
    const lv = (voice.level ?? 1) * 1.41;
    const pr = Math.max(0.35, voice.presence ?? 0);
    env.gain.linearRampToValueAtTime(0.5 * accent * lv, t + 0.012);
    env.gain.setValueAtTime(0.42 * accent * lv, t + dur * 0.6);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const [F1, F2, F3] = VOWELS[vowel % VOWELS.length]!;
    const sum = ctx.createGain();
    sum.gain.value = voice.wave === 'square' ? 0.55 : voice.wave === 'sawtooth' ? 0.7 : 1.6;
    ([[F1, 6, 1], [F2, 9, 0.55 * (1 + pr * 0.6)], [F3, 12, 0.22 * (1 + pr * 1.2)]] as const).forEach(([ff, q, amp]) => {
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
    if (pr > 0) {
      // Consonant onset ("t" / "k" / "p"-ish, chosen by the vowel): a short 1.5–2.5 kHz burst, and
      // (round 12) a 2-4 kHz click on top — the articulation that carries a line over the score.
      this.noise(b.d, t, { f: 1500 + (vowel % 3) * 450, q: 1.8, amp: 0.14 * pr * lv * accent, attack: 0.001, tau: 0.008 });
      this.noise(b.d, t + 0.002, { f: 2600 + (vowel % 4) * 380, q: 2.4, amp: 0.09 * lv * accent, attack: 0.0006, tau: 0.004 });
    }
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
