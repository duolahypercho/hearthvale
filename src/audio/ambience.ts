/**
 * Layered environmental ambience. Continuous beds (wind, leaf rustle, rain, storm roar, fountain,
 * surf, cave air, cicadas, winter howl) crossfade by map / time / season / weather; one-shot life
 * (six bird species, crickets, frogs, owl, crows, gulls, thunder, drips, wind chimes, cave drips
 * and pebbles, the Lantern Hall bell) is scheduled on a look-ahead clock so the same code renders
 * in real time and offline.
 */
import type { AudioGraph } from './graph';
import { Rand, clamp, makeRain, mtof } from './dsp';
import { noiseHit } from './instruments';
import { BirdBank, chimeBuffer, phrase, type Species } from './birds';
import { Crowd } from './crowd';

export type AmbSeason = 'spring' | 'summer' | 'fall' | 'winter';
export type AmbWeather = 'sun' | 'rain' | 'storm' | 'snow' | 'wind';

export interface EnvState {
  map: string;
  /** 6..26 */
  hour: number;
  season: AmbSeason;
  weather: AmbWeather;
  /** 0 = day, 1 = full night. */
  night: number;
  /** 0..1 proximity to the town fountain. */
  fountain: number;
  /** 0..1 proximity to open water (pond/sea). */
  water: number;
  indoor: boolean;
  /** Current music key (MIDI tonic) so chimes stay consonant. */
  key: number;
}

interface Bed {
  gain: GainNode;
  filter?: BiquadFilterNode;
  level: number;
}

export class Ambience {
  private beds: Record<string, Bed> = {};
  private next: Record<string, number> = {};
  private rng: Rand;
  private out: GainNode;
  private send: GainNode;
  private gust = 0.4;
  private gustTarget = 0.4;
  private surfPhase = 0;
  /** Outdoor night lift on the night beds and critters (1 by day, 2 at full night). */
  private nightLift = 1;
  /** Surf swells travel across the stereo field (this panner is automated per wave). */
  private surfPan: StereoPannerNode;
  /** Droplet layers (light / heavy), built on the first rain. */
  private drops: { light: GainNode; heavy: GainNode } | null = null;
  private dropsKey = '';
  private crickets: { pan: number; period: number; next: number; f: number }[] = [];
  /** Pre-rendered syllable banks (birds, crickets, drips). */
  private bank: BirdBank;
  /** Two perches per species (call and response), re-picked every minute or two. */
  private perches: Partial<Record<Species, { a: [number, number]; b: [number, number]; ma: number[]; mb: number[]; until: number }>> = {};
  /** Slow weather swell for rain and wind (−1..1), a random walk at 0.05–0.2 Hz. */
  private wx = 0;
  private wxTarget = 0;
  /** Cicada chorus envelope bookkeeping. */
  private cicadaOn = false;
  private babbleDests: AudioNode[] | undefined;
  /** Town / festival crowd life (talkers, laughter, applause, footsteps, the shop bell). */
  readonly crowd: Crowd;
  private chimeBufs = new Map<number, AudioBuffer>();
  lightningAt = -1;
  /** Until this time the game drives thunder from its own lightning strikes (no random rolls). */
  externalThunderUntil = -1;

  constructor(private g: AudioGraph, seed = 7) {
    this.rng = new Rand(seed);
    this.bank = new BirdBank(g.ctx, seed + 11);
    this.out = g.ctx.createGain();
    // +6.4 dB make-up: the round-2 beds / syllable banks are leaner than the old sine birds.
    this.out.gain.value = 2.1;
    this.out.connect(g.ambBus);
    this.send = g.ctx.createGain();
    this.send.gain.value = 0.35;
    this.send.connect(g.space);
    this.crowd = new Crowd(g, this.out, this.send, seed + 23);
    const ctx = g.ctx;
    const bed = (name: string, buf: AudioBuffer, chain: AudioNode[], rate = 1): Bed => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      const gn = ctx.createGain();
      gn.gain.value = 0;
      let n: AudioNode = src;
      for (const c of chain) n = n.connect(c);
      n.connect(gn).connect(this.out);
      src.start(0, this.rng.next() * buf.duration);
      const b: Bed = { gain: gn, filter: chain.find((c): c is BiquadFilterNode => c instanceof BiquadFilterNode), level: 0 };
      this.beds[name] = b;
      return b;
    };
    const bf = (type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    // Every bed runs on decorrelated stereo noise (L/R correlation ~0.3): wide, not a point in the head.
    bed('wind', g.pinkSt, [bf('bandpass', 420, 0.55), bf('lowpass', 1600)]);
    // Leaf rustle: pink (not white) noise so a windy day reads as foliage, not hiss (render: 63 % > 2 kHz).
    // (tilted: pink through a 350 Hz–2.8 kHz band and a −6 dB shelf above 4 kHz — no steady hiss).
    const tilt = bf('highshelf', 4000, 0.7);
    tilt.gain.value = -6;
    bed('leaves', g.pinkSt, [bf('lowpass', 2800, 0.5), bf('highpass', 350, 0.5), tilt], 0.9);
    // Rain hiss lives up at 4–6 kHz; the droplet layers (makeRain) carry the individual drops.
    // (Round 12: centred 3.8 kHz, was 5 kHz — the re-voiced rain read HISSY with 23 % above 5 kHz.)
    const rainTop = bf('highshelf', 7000, 0.7);
    rainTop.gain.value = -4;
    bed('rain', g.pinkSt, [bf('bandpass', 3800, 0.6), rainTop]);
    // (High-passes on the brown / pink low beds: the sub-60 Hz rumble was 27–29 % of the beach and
    // indoor-rain energy — inaudible on laptops, woolly on headphones, and it ate the limiter's headroom. The low-pass stays first: it is the bed's automated `filter`.)
    bed('rainLow', g.pinkSt, [bf('lowpass', 900, 0.5), bf('highpass', 150, 0.7)]);
    // (A −4 dB shelf over 3 kHz: the jet's splash, not a hiss.)
    const fshelf = bf('highshelf', 3000, 0.7);
    fshelf.gain.value = -4;
    bed('fountain', g.pinkSt, [bf('bandpass', 1200, 0.5), bf('lowpass', 3800), fshelf]);
    const surf = bed('surf', g.pinkSt, [bf('lowpass', 500, 0.6), bf('highpass', 45, 0.7)]);
    this.surfPan = ctx.createStereoPanner();
    surf.gain.disconnect();
    surf.gain.connect(this.surfPan).connect(this.out);
    // Brook: bubbly band of noise with a fast, irregular filter wobble.
    const tame = (): BiquadFilterNode => {
      const b = bf('peaking', 3500, 1.1);
      b.gain.value = -3.5;
      return b;
    };
    const brook = bed('brook', g.whiteSt, [bf('bandpass', 1100, 1.2), bf('lowpass', 3200), tame()]);
    for (const [rate, depth] of [[3.1, 260], [7.3, 180], [0.43, 300]] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg).connect(brook.filter!.frequency);
      lfo.start(0);
    }
    // Cave air: a low hollow roar, kept above the sub range so it doesn't swamp small speakers.
    bed('cave', g.brownSt, [bf('highpass', 70, 0.7), bf('lowpass', 320, 0.7)]);
    bed('caveAir', g.pinkSt, [bf('bandpass', 700, 3)], 0.6);
    bed('howl', g.pinkSt, [bf('bandpass', 620, 9)]);
    bed('snowHush', g.pinkSt, [bf('highpass', 2500, 0.5), bf('lowpass', 6000)]);
    // Interior room tone: a faint low hum of a quiet wooden house.
    bed('room', g.brownSt, [bf('lowpass', 240, 0.6), bf('highpass', 50, 0.7)], 0.8);
    // Fireplace: a soft roar under the crackles.
    bed('fire', g.pinkSt, [bf('lowpass', 520, 0.7)], 0.7);
    // Cicadas: a 4–7 kHz noise band pulsed at ~40 Hz (the tymbal buzz), in choruses that swell in and
    // out every 10–25 s (see tick) — never a constant band.
    const cic = bed('cicada', g.whiteSt, [bf('bandpass', 5300, 3), tame()]);
    const am = ctx.createOscillator();
    am.frequency.value = 41;
    const amG = ctx.createGain();
    amG.gain.value = 0.85;
    const cicMod = ctx.createGain();
    cicMod.gain.value = 0.15;
    cic.gain.disconnect();
    cic.gain.connect(cicMod).connect(this.out);
    am.connect(amG).connect(cicMod.gain);
    am.start(0);
    // Fountain wobble.
    const fl = ctx.createOscillator();
    fl.frequency.value = 0.37;
    const flG = ctx.createGain();
    flG.gain.value = 180;
    fl.connect(flG).connect(this.beds.fountain!.filter!.frequency);
    fl.start(0);
    // Reverb sends from the airy beds.
    this.beds.fountain!.gain.connect(this.send);
    this.beds.rain!.gain.connect(this.send);
  }

  /** The two droplet textures (~45 and ~110 drops/s), looping from different points. */
  private buildDrops(): void {
    const g = this.g;
    const ctx = g.ctx;
    // (Round 12: no puddle plinks baked into the loops — a loud plink every 5.3 s was a metronome in
    // the rain render; the plinks are scheduled one by one (drip / plink below). Loops of 6.1 / 8.3 s.)
    const layer = (perSec: number, seed: number, lp: number, secs: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = makeRain(ctx, secs, perSec, new Rand(seed), 0);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 150;
      const gn = ctx.createGain();
      gn.gain.value = 0;
      src.connect(f).connect(hp).connect(gn).connect(this.out);
      gn.connect(this.send);
      src.start(ctx.currentTime, this.rng.next() * 5);
      return gn;
    };
    this.drops = { light: layer(70, 4101, 9000, 6.1), heavy: layer(150, 5202, 11000, 8.3) };
  }

  private setBed(name: string, level: number, now: number, tau = 1.2): void {
    const b = this.beds[name];
    if (!b || !Number.isFinite(level)) return; // a malformed env must never throw inside the game loop
    if (Math.abs(b.level - level) < 0.002) return;
    b.level = level;
    b.gain.gain.setTargetAtTime(level, now, tau);
  }

  /** Advance to `now`, scheduling up to `now + ahead`. */
  tick(now: number, s: EnvState, ahead = 0.12): void {
    const r = this.rng;
    const outdoors = !s.indoor && s.map !== 'mine';
    const mine = s.map === 'mine';
    const beach = s.map === 'beach';
    const raining = s.weather === 'rain' || s.weather === 'storm';
    const storm = s.weather === 'storm';
    const windy = s.weather === 'wind' || storm ? 1 : raining || s.weather === 'snow' ? 0.65 : 0.35;
    const day = 1 - s.night;
    const h = s.hour;
    this.g.setCave(mine ? 1 : 0, now);

    // Gusts: a smoothed random walk.
    if ((this.next.gust ?? 0) <= now) {
      this.gustTarget = clamp(0.25 + r.next() * 0.9 * windy + (r.chance(0.15) ? 0.4 : 0), 0.1, 1.2);
      this.next.gust = now + 2 + r.next() * 5;
    }
    this.gust += (this.gustTarget - this.gust) * 0.03;
    // Weather swell: slower than the gusts (a new target every 5–20 s = 0.05–0.2 Hz), it pushes
    // rain intensity, drop density and the wind's body up and down together.
    if ((this.next.wx ?? 0) <= now) {
      this.wxTarget = (r.chance(0.5) ? 1 : -1) * r.range(0.45, 1);
      // (Round 12: showers come and go a little faster in the rain — 4-12 s — so the bed moves.)
      this.next.wx = now + (raining ? 4 + r.next() * 8 : 5 + r.next() * 15);
    }
    this.wx += (this.wxTarget - this.wx) * 0.03;
    const swellDb = (d: number): number => Math.pow(10, (d * this.wx) / 20);
    // Night lift: after 01:00 the score rests until morning and the beds carry the night alone; the
    // night air (wind in the trees, the leaves, the critters) comes up ~6 dB with the dark so the
    // music-free hours sit near -30 LUFS instead of -38 (near silence on laptop speakers).
    // (Round 5: +5.6 dB, was +8 — the ambience bus came up 3.5 dB for the day beds.)
    const nightLift = outdoors ? 1 + 0.9 * s.night : 1;
    this.nightLift = nightLift;
    // Day beds (round 5): the wind / leaves / snow air sat 13–17 LU under a playing song — outdoors by
    // day they come up a further ~3.5 dB so the place is heard under the score (≤ 10 LU down).
    const dayLift = outdoors ? 1 + 0.5 * (1 - s.night) : 1;
    // In the square the people carry the sense of place: the wind / leaf wash sits 6 dB lower.
    const townBed = s.map === 'town' || s.map.startsWith('fest') ? 0.5 : 1;
    // (A windy day is already loud: the day lift fades out as the weather's own wind takes over.)
    const windLift = 1 + (dayLift - 1) * (1 - 0.7 * Math.max(0, windy - 0.65) / 0.35);
    // Round 12: still air carries the quiet hours. On a calm night the wind / leaf wash drops ~9 dB
    // under its day level (the night lift goes to the critters only), and a calm early morning sits
    // ~6 dB down — the place is crickets, a frog, an owl, drips; never a pink-noise wash under them.
    const calm = 1 - clamp((windy - 0.35) / 0.3, 0, 1);
    // (Calm days too: the noon render was a 50 Hz-5 kHz wash with the birds buried in it — a still
    // summer noon is birds and insects. Calm day ≈ -8 dB: no day lift and -4.4 dB.)
    const hush = outdoors ? 1 - calm * Math.max(0.65 * s.night, h >= 4.5 && h < 10 ? 0.42 * (1 - s.night) : 0.4) : 1;
    const bedLift = 1 + (windLift - 1) * (1 - calm);
    // (Round 12: a storm's own wind / rain bed −4 dB so the thunder can stand +8-12 dB over it.)
    const stormBed = storm ? 0.63 : 1;
    const wind = stormBed * (outdoors ? townBed : 1) * (outdoors ? (0.075 + 0.12 * windy) * (0.45 + 0.85 * this.gust * this.gust) * swellDb(2) * hush * bedLift : mine ? 0.015 : 0);
    this.setBed('wind', wind, now, 0.8);
    const wf = this.beds.wind!.filter!;
    wf.frequency.setTargetAtTime((260 + 520 * this.gust) * (1 + 0.15 * this.wx), now, 1.2);
    const hasLeaves = s.season !== 'winter' && outdoors && !beach;
    this.setBed('leaves', townBed * (hasLeaves ? (0.034 + 0.05 * Math.pow(this.gust, 2) * windy * (s.season === 'fall' ? 1.6 : 1)) * hush * (1 + (dayLift - 1) * (1 - calm)) : 0), now, 0.6);
    // Rain: ±4 dB and ±30 % of the hiss band with the weather swell (showers come and go).
    // (Round 5: with the ambience bus +6 dB, rain sits ~3 LU under the score offline and level with it
    // in game — rain is a foreground mood; the adapter drops the music to ~0.7 on wet days.)
    // Round 12 re-voice: rain is patter and hiss (centroid 3-5 kHz), not a roar — the low bed is
    // high-passed at 150 Hz and ~10 dB down, the drops carry the rain; indoors the roof and the gutter
    // tick at 1-4 kHz over a much quieter room (the house-rain render was 83 % below 250 Hz).
    this.setBed('rain', (outdoors && raining ? (storm ? 0.2 : 0.2) : s.indoor && raining ? 0.012 : 0) * swellDb(7), now, 1.5);
    this.beds.rain!.filter!.frequency.setTargetAtTime(3800 * (1 + 0.3 * this.wx), now, 1.5);
    this.setBed('rainLow', (raining && !mine ? (storm ? 0.06 : 0.024) * (s.indoor ? 0.35 : 1) : 0) * swellDb(3), now, 1.5);
    // Individual drops: a light patter always, the heavy layer in a storm; muffled on the roof indoors.
    if (raining && !mine && !this.drops) this.buildDrops();
    if (this.drops) {
      // Drop density follows the swell: the heavy layer fades in on the downpours even in plain rain.
      const q = Math.round(this.wx * 20) / 20;
      const lv = !raining || mine ? 0 : s.indoor ? 0.1 * Math.pow(10, (6 * q) / 20) : 1.25;
      const key = `${lv}:${storm}:${q}`;
      if (key !== this.dropsKey) {
        this.dropsKey = key;
        this.drops.light.gain.setTargetAtTime(0.6 * lv * (1 + 0.5 * q), now, 1.5);
        this.drops.heavy.gain.setTargetAtTime((storm ? 0.55 * (1 + 0.3 * q) : Math.max(0, q - 0.15) * 0.45) * lv, now, 1.5);
      }
    }
    // (Round 4: −5 dB — the fountain's broadband wash had been the town's loudest layer; the
    // crowd now carries the square.)
    this.setBed('fountain', outdoors ? 0.078 * s.fountain : 0, now, 0.6);
    this.setBed('cave', mine ? 0.07 : 0, now, 2);
    this.setBed('caveAir', mine ? 0.05 : 0, now, 2);
    const cold = s.season === 'winter' && outdoors;
    this.setBed('howl', cold ? (0.012 + 0.03 * this.gust * windy) * dayLift : 0, now, 1);
    this.beds.howl!.filter!.frequency.setTargetAtTime(480 + 420 * this.gust, now, 2);
    this.setBed('snowHush', outdoors && s.weather === 'snow' ? 0.035 : 0, now, 2);
    const hearth = s.indoor && (s.night > 0.3 || s.season === 'winter' || s.season === 'fall' || raining);
    this.setBed('room', s.indoor ? (raining ? 0.005 : 0.022) : 0, now, 1);
    // (Round 12: the hearth's roar −4 dB — with the room tone it was most of the house's low hum;
    // the crackles carry the fire.)
    this.setBed('fire', hearth ? (raining ? 0.014 : 0.022) : 0, now, 1.5);
    const town = s.map === 'town' || s.map.startsWith('fest');
    const cicadaTime = s.season === 'summer' && outdoors && !beach && !raining && h >= 10 && h <= 18.5;
    this.cicadas(now, cicadaTime);

    // Surf: individual waves on the coast. Inland water babbles (forest stream) or laps (pond).
    if (beach) {
      if ((this.next.wave ?? 0) <= now + ahead) {
        const t = Math.max(now, this.next.wave ?? now);
        // Sets of waves: mostly mid-size, now and then a big one; the period wanders 6–14 s.
        const size = r.chance(0.18) ? r.range(1.2, 1.45) : r.range(0.7, 1.05);
        this.wave(t, size);
        // Round 12: the period wanders 5-14 s and now and then a second wave rides in right behind
        // the first (a set), so the surf never settles into a metronome.
        this.next.wave = r.chance(0.2) ? t + r.range(2.6, 4.2) : t + 5 + r.next() * 9 * (0.6 + 0.4 * size);
      }
    } else this.setBed('surf', 0, now, 2);
    const stream = outdoors && s.map === 'forest';
    // (Round 12: the wash −3.5 dB — the birds and the woodpecker were masked by it; the granular
    // babble carries the brook.)
    this.setBed('brook', stream ? 0.015 + 0.045 * s.water : 0, now, 1);
    // The babble: granular bubbles (rising 300–1500 Hz chirps, 20–40 a second, spread across the
    // stereo field) over the bed's wash — the difference between a brook and wind.
    if (stream) {
      const lvl = 0.3 + 0.7 * s.water;
      let bt = this.next.babble ?? now;
      if (bt < now) bt = now;
      while (bt < now + ahead) {
        // Five fixed positions across the bank (built once: no per-grain panner / filter nodes).
        this.babbleDests ??= [-0.7, -0.35, 0, 0.35, 0.7].map((pn, i) => this.dest(pn, 0.2 + (i % 2) * 0.2));
        const d = this.babbleDests[this.rng.int(0, 4)]!;
        this.bank.play(d, 'bubble', this.rng.int(0, 31), bt, 0.036 * lvl * this.rng.range(0.4, 1), this.rng.range(0.9, 1.12));
        // Clustered: runs of quick bubbles with short lulls (a stream gurgles, it doesn't tick).
        bt += this.rng.chance(0.12) ? this.rng.range(0.08, 0.16) : this.rng.range(0.012, 0.04);
      }
      this.next.babble = bt;
    }

    const until = now + ahead;
    const due = (k: string, min: number, max: number, active: boolean): number | null => {
      if (!active) {
        this.next[k] = Math.max(this.next[k] ?? 0, now + r.next() * min);
        return null;
      }
      const n = this.next[k] ?? now + r.next() * min;
      if (n > until) {
        this.next[k] = n;
        return null;
      }
      this.next[k] = Math.max(n, now) + min + r.next() * (max - min);
      return Math.max(n, now);
    };

    // Birds: morning chorus, quieter afternoons, none at night or in the rain.
    const chorus = h < 9.5 ? 1 : h < 17 ? 0.45 : h < 19.5 ? 0.6 : 0;
    const birdsActive = outdoors && !beach && !raining && s.night < 0.35 && chorus > 0 && s.season !== 'winter';
    // Dawn chorus: a phrase (often answered) every ~2 s at sunrise, sparser through the afternoon.
    let t = due('bird', 1.1 / Math.max(0.2, chorus), 3.6 / Math.max(0.2, chorus), birdsActive);
    if (t !== null) this.bird(t, s, chorus);
    t = due('dove', 9, 22, birdsActive && h < 10.5);
    if (t !== null) this.dove(t);
    t = due('chickadee', 12, 35, outdoors && !raining && s.season === 'winter' && s.night < 0.3);
    if (t !== null) this.chickadee(t, r.range(-0.7, 0.7));
    t = due('crow', 20, 55, outdoors && !raining && (s.season === 'fall' || s.season === 'winter') && s.night < 0.3 && !beach);
    if (t !== null) this.crow(t);
    t = due('gull', 5, 14, beach && !storm && s.night < 0.4);
    if (t !== null) this.gull(t);
    // Night.
    const crittersNight = outdoors && s.night > 0.55 && !raining && s.season !== 'winter';
    if (crittersNight) this.cricketChorus(now, until, s.season === 'fall' ? 3 : 6);
    t = due('frog', 1.5, 5, crittersNight && (s.season === 'spring' || s.season === 'summer') && s.water > 0.15);
    if (t !== null) this.frog(t);
    t = due('owl', 25, 60, outdoors && s.night > 0.7 && !storm);
    if (t !== null) this.owl(t);
    // Round 12 (event density, not bed level): something small in the grass, a distant dog, a
    // night bird's single note; in the morning a woodpecker and the farm rooster.
    t = due('rustle', 6, 16, outdoors && s.night > 0.5 && !raining && !beach);
    if (t !== null) this.rustle(t);
    t = due('dog', 35, 80, outdoors && s.night > 0.6 && !raining && (s.map === 'farm' || s.map === 'town'));
    if (t !== null) this.dog(t);
    t = due('nightjar', 18, 40, outdoors && s.night > 0.7 && !raining && (s.season === 'summer' || s.season === 'spring'));
    if (t !== null) this.nightjar(t);
    t = due('woodpecker', 20, 45, outdoors && !raining && s.night < 0.3 && h < 13 && (s.map === 'forest' || s.map === 'farm') && s.season !== 'winter');
    if (t !== null) this.woodpecker(t);
    t = due('rooster', 40, 90, outdoors && s.map === 'farm' && h >= 5.5 && h < 8.5 && !raining);
    if (t !== null) this.rooster(t);
    // Weather.
    t = due('drip', 0.05, 0.25, raining && !mine);
    if (t !== null) this.drip(t, s.indoor ? 0.4 : 1);
    // Indoors: rain on the roof shingles (1-4 kHz ticks in clusters) and the gutter's slow drip.
    t = due('roof', 0.02, 0.09, raining && s.indoor);
    if (t !== null) this.roofTick(t, (storm ? 1.3 : 1) * swellDb(7));
    t = due('gutter', 0.5, 1.4, raining && s.indoor);
    if (t !== null) this.gutter(t);
    t = due('thunder', 14, 38, storm && now > this.externalThunderUntil);
    if (t !== null) this.thunder(t, r.range(0.1, 0.8));
    // Farm wind chimes on strong gusts.
    t = due('chime', raining ? 7 : 3, raining ? 16 : 9, s.map === 'farm' && this.gust > 0.75 && !storm);
    if (t !== null) this.chimes(t, s.key);
    // Leaf skitter in fall.
    t = due('skitter', 3, 10, outdoors && s.season === 'fall' && this.gust > 0.6);
    if (t !== null) this.skitter(t);
    // Pond lapping and the odd fish rising.
    t = due('lap', 0.8, 2.6, outdoors && !beach && s.map !== 'forest' && s.water > 0.25);
    if (t !== null) this.lap(t, s.water);
    // Hearth crackles indoors.
    t = due('crackle', 0.08, 0.6, hearth);
    if (t !== null) this.crackle(t);
    // Town life: distant chatter by day (busier at festivals), the smithy's anvil, a cart.
    const festive = s.map.startsWith('fest');
    const bustle = town && !raining && ((h >= 8 && h < 19.5) || festive);
    this.crowd.tick(now, until, { active: bustle, festive, density: festive ? (s.night > 0.5 ? 0.7 : 1) : h < 10 || h > 17.5 ? 0.4 : 0.8 });
    t = due('anvil', 12, 30, town && !festive && h >= 9 && h < 17 && !raining);
    if (t !== null) this.anvil(t);
    // Mine life.
    t = due('caveDrip', 1.2, 4.5, mine);
    if (t !== null) this.caveDrip(t);
    t = due('pebble', 9, 25, mine);
    if (t !== null) this.pebbles(t);
    t = due('rumble', 25, 50, mine);
    if (t !== null) this.rumble(t, 0.4);
  }

  // ───────────────────────────────────────────── voices

  private dest(pan: number, dist: number): AudioNode {
    const ctx = this.g.ctx;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 12000 - dist * 8000;
    const gn = ctx.createGain();
    gn.gain.value = 1 - dist * 0.6;
    const sg = ctx.createGain();
    sg.gain.value = 0.3 + dist * 0.6;
    lp.connect(gn).connect(p).connect(this.out);
    p.connect(sg).connect(this.send);
    return lp;
  }

  private chirp(dest: AudioNode, t: number, f0: number, f1: number, dur: number, amp: number, fm = 0, trill = 0): void {
    const ctx = this.g.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (fm > 0) {
      const m = ctx.createOscillator();
      m.frequency.value = 60 + this.rng.next() * 40;
      const mg = ctx.createGain();
      mg.gain.value = fm;
      m.connect(mg).connect(o.frequency);
      m.start(t);
      m.stop(t + dur + 0.02);
    }
    const a = ctx.createGain();
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(amp, t + Math.min(0.012, dur * 0.3));
    a.gain.setValueAtTime(amp, t + dur * 0.6);
    a.gain.linearRampToValueAtTime(0, t + dur);
    if (trill > 0) {
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = trill;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
      o.connect(am).connect(a).connect(dest);
    } else o.connect(a).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A species' personal material: 6 bank indices (the answering bird gets its own). */
  private motif(): number[] {
    return Array.from({ length: 6 }, () => this.rng.int(0, 39));
  }

  /** One bird sings a phrase from its perch. Returns when it ends. */
  private sayPhrase(sp: Species, t: number, perch: [number, number], motif: number[], amp: number): number {
    const d = this.dest(perch[0], perch[1]);
    let end = t;
    for (const [k, dt, gain, rate] of phrase(sp, this.rng, motif)) {
      const dur = this.bank.play(d, sp, k, t + dt, amp * gain, rate);
      end = Math.max(end, t + dt + dur);
    }
    return end;
  }

  /**
   * Call and response: one of two birds of a species (each on its own perch, left and right of
   * the listener) sings; often the other answers with its own variant a moment later.
   */
  private sing(sp: Species, t: number, amp: number, answer = 0.6): void {
    const r = this.rng;
    let p = this.perches[sp];
    if (!p || t > p.until) {
      const left: [number, number] = [r.range(-0.95, -0.25), r.next() * 0.75];
      const right: [number, number] = [r.range(0.25, 0.95), r.next() * 0.75];
      p = this.perches[sp] = { a: left, b: right, ma: this.motif(), mb: this.motif(), until: t + r.range(40, 110) };
    }
    const first = r.chance(0.5);
    const end = this.sayPhrase(sp, t, first ? p.a : p.b, first ? p.ma : p.mb, amp);
    if (r.chance(answer)) {
      // The reply re-uses its own motif with one syllable changed (birds vary as they counter-sing).
      const m = [...(first ? p.mb : p.ma)];
      m[r.int(0, m.length - 1)] = r.int(0, 39);
      this.sayPhrase(sp, end + r.range(0.25, 1.1), first ? p.b : p.a, m, amp * r.range(0.7, 1));
    }
  }

  private bird(t: number, s: EnvState, chorus = 0.5): void {
    const r = this.rng;
    const species = r.weighted([['warbler', 3], ['robin', 4], ['finch', 3], ['thrush', 2.5], ['wren', 1.5], ['chickadee', s.season === 'spring' ? 1.5 : 0.8]] as const);
    if (species === 'chickadee') this.chickadee(t, 0);
    else this.sing(species, t, (species === 'wren' ? 0.042 : species === 'thrush' ? 0.056 : 0.06) * (chorus > 0.9 ? 0.85 : 1));
  }

  private chickadee(t: number, _pan: number): void {
    this.sing('chickadee', t, 0.06, 0.5);
  }

  /** A dove: each phrase its own pitch (±10 %), tempo (0.85-1.2×), length (3-5 hoots) and perch. */
  private dove(t: number): void {
    const r = this.rng;
    const pitch = r.range(0.9, 1.1);
    const stretch = r.range(0.85, 1.2);
    const keep = r.int(3, 5);
    const d = this.dest(r.range(-0.85, 0.85), r.range(0.25, 0.8));
    let i = 0;
    for (const [k, dt, gain, rate] of phrase('dove', r, this.motif())) {
      if (i++ >= keep) break;
      this.bank.play(d, 'dove', k, t + dt * stretch, 0.09 * gain * r.range(0.8, 1.1), rate * pitch);
    }
  }

  /** Rain on the roof: a cluster of 2-5 tiny shingle ticks, 1-4 kHz, scattered across the ceiling. */
  private roofTick(t: number, k: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-0.9, 0.9), 0.15);
    const n = r.int(2, 5);
    for (let i = 0; i < n; i++) noiseHit(this.g, d, t + r.next() * 0.06, { f: 1000 * Math.pow(4, r.next()), q: 2.2, amp: (0.012 + r.next() * 0.02) * k, attack: 0.0006, tau: 0.003 + r.next() * 0.004 });
  }

  /** The gutter by the window: a drop falling into the water butt, a hollow resonant plink. */
  private gutter(t: number): void {
    const r = this.rng;
    const d = this.dest(-0.6, 0.35);
    this.bank.play(d, 'drip', r.int(0, 23), t, 0.05, r.range(0.7, 0.85));
    if (r.chance(0.3)) this.bank.play(d, 'drip', r.int(0, 23), t + r.range(0.18, 0.3), 0.03, r.range(0.75, 0.9));
  }

  /** Something small moving through the grass: a short run of dry 1.5-4 kHz rustles. */
  private rustle(t: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-0.9, 0.9), r.range(0.2, 0.6));
    const n = r.int(4, 9);
    let tt = t;
    for (let i = 0; i < n; i++) {
      noiseHit(this.g, d, tt, { f: r.range(1500, 4000), q: 1.2, amp: 0.018 * r.range(0.5, 1), attack: 0.004, tau: 0.02 + r.next() * 0.02, buf: this.g.pink });
      tt += r.range(0.05, 0.16);
    }
  }

  /** A farm dog far down the lane: two or three soft, distant barks. */
  private dog(t: number): void {
    const r = this.rng;
    const ctx = this.g.ctx;
    const d = this.dest(r.range(-0.9, 0.9), 0.9);
    const n = r.int(2, 3);
    const f0 = r.range(360, 470);
    for (let i = 0; i < n; i++) {
      const tt = t + i * r.range(0.32, 0.5);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.65, tt + 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 1.6;
      const a = ctx.createGain();
      a.gain.setValueAtTime(0, tt);
      a.gain.linearRampToValueAtTime(0.03, tt + 0.012);
      a.gain.setTargetAtTime(0, tt + 0.05, 0.035);
      o.connect(bp).connect(a).connect(d);
      o.start(tt);
      o.stop(tt + 0.25);
    }
  }

  /** A nightjar's churring note, far off: a 40 Hz-pulsed 1.1 kHz trill that rises and fades. */
  private nightjar(t: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-0.9, 0.9), 0.7);
    const dur = r.range(1.2, 2.4);
    this.chirp(d, t, r.range(1050, 1150), r.range(1150, 1300), dur, 0.012 * this.nightLift, 0, r.range(36, 44));
  }

  /** A woodpecker drumming on a far trunk: a fast, slightly decelerating roll of hollow knocks. */
  private woodpecker(t: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-0.9, 0.9), r.range(0.5, 0.85));
    const n = r.int(10, 18);
    const f = r.range(900, 1300);
    let tt = t;
    for (let i = 0; i < n; i++) {
      noiseHit(this.g, d, tt, { f, q: 4, amp: 0.035 * (1 - i / (n * 1.6)), attack: 0.0008, tau: 0.008 });
      tt += 0.045 + i * 0.0015;
    }
  }

  /** The rooster at first light, from the coop across the yard. */
  private rooster(t: number): void {
    const r = this.rng;
    const ctx = this.g.ctx;
    const d = this.dest(r.range(0.3, 0.8), 0.7);
    const f0 = r.range(520, 600);
    // "cock-a-doodle-doo": three short rising syllables and a long falling one.
    const syl: [number, number, number, number][] = [[0, 0.11, 1, 1.1], [0.15, 0.1, 1.05, 1.2], [0.3, 0.12, 1.2, 1.35], [0.48, 0.7, 1.35, 0.95]];
    for (const [dt, dur, a0, a1] of syl) {
      const tt = t + dt;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * a0, tt);
      o.frequency.linearRampToValueAtTime(f0 * a1, tt + dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1.8;
      const a = ctx.createGain();
      a.gain.setValueAtTime(0, tt);
      a.gain.linearRampToValueAtTime(0.022, tt + 0.03);
      a.gain.setValueAtTime(0.022, tt + dur * 0.7);
      a.gain.linearRampToValueAtTime(0, tt + dur);
      o.connect(bp).connect(a).connect(d);
      o.start(tt);
      o.stop(tt + dur + 0.02);
    }
  }

  private crow(t: number): void {
    const ctx = this.g.ctx;
    const d = this.dest(this.rng.range(-0.9, 0.9), 0.5 + this.rng.next() * 0.4);
    const n = this.rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.42;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(640, tt);
      o.frequency.exponentialRampToValueAtTime(480, tt + 0.3);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300;
      bp.Q.value = 2.5;
      const a = ctx.createGain();
      a.gain.setValueAtTime(0, tt);
      a.gain.linearRampToValueAtTime(0.05, tt + 0.03);
      a.gain.setTargetAtTime(0, tt + 0.2, 0.05);
      o.connect(bp).connect(a).connect(d);
      o.start(tt);
      o.stop(tt + 0.45);
    }
  }

  private gull(t: number): void {
    this.sing('gull', t, 0.045, 0.45);
  }

  private cricketChorus(now: number, until: number, count: number): void {
    const r = this.rng;
    while (this.crickets.length < count) this.crickets.push({ pan: r.range(-0.9, 0.9), period: r.range(0.55, 1.1), next: now + r.next(), f: r.range(0.94, 1.06) });
    for (const c of this.crickets) {
      if (c.next < now - 1) c.next = now;
      while (c.next < until) {
        // The chorus breathes: each cricket swells and fades on its own slow cycle (two slow sines
        // per cricket, 9–31 s), and every ~40 s the whole field falls silent for a few seconds —
        // something moved in the grass — then starts again one by one. (The night bed was a flat
        // wall, LRA ~2 LU; a real field ebbs.)
        const tt = c.next;
        const sw = 0.55 + 0.45 * Math.sin(2 * Math.PI * (tt / (17 + c.f * 9) + c.pan)) * Math.sin(2 * Math.PI * (tt / 31 + c.f));
        // (Round 12: longer lulls — ~5 s in every 41 — so the field visibly breathes: LRA ≥ 4 LU.)
        const lull = Math.sin(2 * Math.PI * (tt / 41)) > 0.82 - 0.03 * (c.pan + 1);
        if (!lull && r.next() < 0.6 + 0.4 * sw) {
          const d = this.dest(c.pan, 0.5);
          const pulses = r.int(3, 4);
          const k = r.int(0, 11);
          for (let i = 0; i < pulses; i++) this.bank.play(d, 'cricket', k, tt + i * 0.022, 0.028 * this.nightLift * (0.2 + 1 * sw * sw), c.f);
        }
        c.next += c.period * r.range(0.9, 1.1);
      }
    }
  }

  /**
   * A frog by the water: one or two "rib-bit" calls from the pre-rendered bank (pulsed, formant-
   * voiced syllables — not an oscillator), and now and then a neighbour answers from across the
   * pond, a touch lower and further away.
   */
  private frog(t: number): void {
    const r = this.rng;
    const call = (tt: number, pan: number, dist: number, rate: number, amp: number): void => {
      const d = this.dest(pan, dist);
      const k = 2 * r.int(0, 7);
      const n = r.chance(0.35) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const t0 = tt + i * r.range(0.32, 0.42);
        this.bank.play(d, 'frog', k, t0, amp, rate);
        this.bank.play(d, 'frog', k + 1, t0 + r.range(0.13, 0.17), amp * 0.85, rate);
      }
    };
    const pan = r.range(-0.8, 0.8);
    // (+8 dB after the first render: at 0.05 the calls sank under the dusk wind bed.)
    call(t, pan, 0.4, r.range(0.95, 1.05), 0.125 * this.nightLift);
    if (r.chance(0.4)) call(t + r.range(0.5, 0.9), -pan * 0.8, 0.65, r.range(0.86, 0.94), 0.1 * this.nightLift);
  }

  private owl(t: number): void {
    const o = 4 * this.rng.int(0, 2);
    this.sayPhrase('owl', t, [this.rng.range(-0.9, 0.9), 0.75], [o, o + 1, o + 2, o + 3], 0.07);
  }

  private drip(t: number, level: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-1, 1), r.next() * 0.8);
    // A drop into a puddle: gone in < 80 ms with a slight downward glide (pre-rendered bank).
    // (Now and then a fat plink from the eaves or a puddle — at random, never on a loop.)
    const fat = r.chance(0.1);
    this.bank.play(d, 'drip', r.int(0, 23), t, (fat ? 0.05 : 0.02) * level, fat ? r.range(0.7, 0.85) : r.range(0.9, 1.1));
  }

  thunder(t: number, dist: number): void {
    const g = this.g;
    const r = this.rng;
    const d = this.dest(r.range(-0.7, 0.7), dist * 0.5);
    // The crack (near strikes): a 2–5 kHz tearing burst and a scatter of crackles over ~300 ms —
    // the part a laptop speaker carries — then the low roll. A storm's thunder should stand ~10 dB
    // over the rain bed, not ~3 dB.
    const near = 1 - dist;
    // Round 12: every strike cracks (the ambient storm's own rolls were sub swells with no crack);
    // a far one is darker and softer, its crack arriving with the roll.
    {
      const ck = Math.max(0.3, near);
      const cf = 1 - 0.5 * dist;
      noiseHit(g, d, t, { f: 3200 * cf, q: 0.8, amp: 0.8 * ck, attack: 0.003, tau: 0.06 + dist * 0.05 });
      noiseHit(g, d, t + 0.01, { type: 'highpass', f: 1500 * cf, amp: 0.45 * ck, attack: 0.004, tau: 0.11 });
      // The tearing tail: a 0.4-0.8 s ripple of 700 Hz-2 kHz crackle as the channel splits the air.
      for (let i = 0; i < 14; i++) noiseHit(g, d, t + 0.05 + r.next() * (0.4 + near * 0.4), { f: (700 + r.next() * 1300) * cf, q: 1.2, amp: (0.1 + r.next() * 0.15) * ck, attack: 0.004, tau: 0.03 + r.next() * 0.05, buf: g.pink });
      const n = 6 + Math.floor(r.next() * 6);
      for (let i = 0; i < n; i++) noiseHit(g, d, t + 0.03 + r.next() * (0.3 + dist * 0.4), { f: (1800 + r.next() * 3000) * cf, q: 1.6, amp: (0.12 + r.next() * 0.18) * ck, attack: 0.002, tau: 0.015 + r.next() * 0.03 });
    }
    // Rolling rumble: overlapping 40–120 Hz swells (with a little 200–400 Hz growl on near strikes),
    // arriving later and softer the further away the bolt fell.
    const n = 4 + Math.floor(r.next() * 4);
    let tt = t + 0.06 + dist * 0.6;
    for (let i = 0; i < n; i++) {
      const a = (1.4 - i * 0.12) * (1 - dist * 0.45) * 1.25;
      // (Round 12: the roll swells in — 0.3-0.9 s attacks, the first after a beat of silence — instead of
      // a slammed low block.)
      noiseHit(g, d, tt, { type: 'lowpass', f: 120 + near * 60, q: 0.8, amp: a, attack: (i === 0 ? 0.3 : 0.4) + r.next() * 0.5, tau: 0.6 + r.next() * 0.8, buf: g.brown });
      noiseHit(g, d, tt + 0.02, { f: 260 + near * 140, q: 0.9, amp: a * 0.28, attack: 0.1, tau: 0.35 + r.next() * 0.4, buf: g.brown });
      tt += 0.35 + r.next() * 0.8;
    }
    // The roll ducks the score (a near strike pulls it ~9 dB for a couple of seconds).
    g.duckMusic(t, 0.36 + 0.4 * dist, 1 + 1.8 * near, 2.2);
    this.lightningAt = t;
  }

  private chimes(t: number, key: number): void {
    // Tubular chimes on the porch: inharmonic tube partials + clapper tick (pre-rendered per note).
    const d = this.dest(-0.55, 0.3);
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    const n = this.rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const m = (key % 12) + 72 + this.rng.pick(pent);
      let buf = this.chimeBufs.get(m);
      if (!buf) {
        buf = chimeBuffer(this.g.ctx, mtof(m), new Rand(m * 31));
        this.chimeBufs.set(m, buf);
      }
      const src = this.g.ctx.createBufferSource();
      src.buffer = buf;
      const a = this.g.ctx.createGain();
      a.gain.value = 0.022 * this.rng.range(0.6, 1);
      src.connect(a).connect(d);
      src.start(t + i * this.rng.range(0.15, 0.4));
    }
  }

  private skitter(t: number): void {
    const d = this.dest(this.rng.range(-0.8, 0.8), 0.3);
    for (let i = 0; i < 5; i++) noiseHit(this.g, d, t + i * 0.05 + this.rng.next() * 0.03, { f: 2600, q: 1.5, amp: 0.03, tau: 0.012 });
  }

  private lap(t: number, near: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-0.8, 0.8), 0.5 - near * 0.3);
    const n = r.int(1, 3);
    for (let i = 0; i < n; i++) {
      const f = r.range(380, 900);
      this.chirp(d, t + i * r.range(0.06, 0.15), f, f * 1.6, 0.05, 0.02 * near);
    }
    noiseHit(this.g, d, t, { f: 700, q: 0.8, amp: 0.025 * near, attack: 0.05, tau: 0.12, buf: this.g.pink });
  }

  private crackle(t: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-0.5, -0.2), 0.2);
    const n = r.int(1, 3);
    for (let i = 0; i < n; i++) noiseHit(this.g, d, t + i * r.range(0.01, 0.04), { f: r.range(1800, 5200), q: 2, amp: r.range(0.02, 0.06), tau: 0.004 + r.next() * 0.006 });
    if (r.chance(0.08)) noiseHit(this.g, d, t, { type: 'lowpass', f: 700, amp: 0.05, attack: 0.004, tau: 0.03, buf: this.g.pink }); // a log settles
  }


  /** The smithy: two or three ringing hammer strikes on the anvil, far across the square. */
  private anvil(t: number): void {
    const r = this.rng;
    const d = this.dest(0.6, 0.75);
    const n = r.int(2, 4);
    for (let i = 0; i < n; i++) {
      const tt = t + i * r.range(0.42, 0.55);
      for (const [ratio, amp] of [[1, 0.018], [2.76, 0.01], [5.4, 0.005]] as const) this.chirp(d, tt, 1180 * ratio, 1175 * ratio, 0.6, amp);
      noiseHit(this.g, d, tt, { f: 3000, q: 2, amp: 0.02, tau: 0.006 });
    }
  }

  private caveDrip(t: number): void {
    const ctx = this.g.ctx;
    const p = ctx.createStereoPanner();
    p.pan.value = this.rng.range(-0.9, 0.9);
    const s = ctx.createGain();
    s.gain.value = 1;
    p.connect(this.out);
    p.connect(s).connect(this.g.cave);
    // A drop into a still pool: the drip bank an octave down, lots of cave.
    this.bank.play(p, 'drip', this.rng.int(0, 23), t, 0.06, this.rng.range(0.45, 0.65));
  }

  private pebbles(t: number): void {
    const ctx = this.g.ctx;
    const p = ctx.createStereoPanner();
    p.pan.value = this.rng.range(-0.9, 0.9);
    p.connect(this.out);
    p.connect(this.g.cave);
    const n = this.rng.int(3, 7);
    let tt = t;
    for (let i = 0; i < n; i++) {
      noiseHit(this.g, p, tt, { f: this.rng.range(1500, 3500), q: 3, amp: 0.05 * (1 - i / n), tau: 0.01 });
      tt += this.rng.range(0.05, 0.16) * (1 + i * 0.15);
    }
  }

  private rumble(t: number, amp: number): void {
    const p = this.g.ctx.createGain();
    p.connect(this.out);
    p.connect(this.g.cave);
    noiseHit(this.g, p, t, { type: 'bandpass', f: 140, q: 0.8, amp, attack: 1.2, tau: 1.2, buf: this.g.brown });
  }

  /**
   * Cicada choruses: a swell every 10–25 s — in over 3–5 s, a few seconds at full buzz, out over
   * 3–6 s, then a gap — with the band retuned (4.5–6.5 kHz) for each new chorus.
   */
  private cicadas(now: number, active: boolean): void {
    const b = this.beds.cicada!;
    const gp = b.gain.gain;
    if (!active) {
      if (this.cicadaOn) {
        gp.cancelScheduledValues(now);
        gp.setTargetAtTime(0, now, 2);
        this.cicadaOn = false;
        b.level = 0;
      }
      return;
    }
    // Entering a hot noon: the first chorus is already swelling (up within ~3 s, not after a gap).
    const first = !this.cicadaOn;
    this.cicadaOn = true;
    if (first) this.next.cicada = Math.min(this.next.cicada ?? 0, now);
    if ((this.next.cicada ?? 0) > now) return;
    const r = this.rng;
    const rise = first ? r.range(1.5, 2.5) : r.range(3, 5);
    const hold = r.range(4, 8);
    const fall = r.range(3, 6);
    // (Round 5: +18 dB — the noon chorus never surfaced, even in the bed alone; it is summer's signature.)
    // (Round 12: −4 dB — with the noon wash gone the chorus alone read HISSY / BRIGHT.)
    const peak = r.range(0.06, 0.095);
    b.filter!.frequency.setTargetAtTime(r.range(4500, 6500), now, 1);
    gp.cancelScheduledValues(now);
    gp.setValueAtTime(Math.max(0.0005, b.level), now);
    gp.linearRampToValueAtTime(peak, now + rise);
    gp.setValueAtTime(peak, now + rise + hold);
    // (Round 12: down to silence between choruses — the 0.0015 floor left a static 5-6 kHz band.)
    gp.linearRampToValueAtTime(0.0001, now + rise + hold + fall);
    b.level = 0.0001;
    this.next.cicada = now + rise + hold + fall + r.range(1, 6);
  }

  private wave(t: number, size: number): void {
    const b = this.beds.surf!;
    const gp = b.gain.gain;
    const fp = b.filter!.frequency;
    const peak = 0.22 * size * (0.8 + this.rng.next() * 0.4);
    // The swell rolls in on one side and breaks across to the other.
    const dir = this.surfPhase % 2 === 0 ? 1 : -1;
    const pp = this.surfPan.pan;
    pp.cancelScheduledValues(t);
    pp.setValueAtTime(pp.value, t);
    pp.linearRampToValueAtTime(-0.65 * dir, t + 0.6);
    pp.linearRampToValueAtTime(0.1 * dir, t + 2.4);
    pp.linearRampToValueAtTime(0.6 * dir, t + 4.6);
    gp.cancelScheduledValues(t);
    gp.setTargetAtTime(peak * 0.5, t, 0.9);
    gp.setTargetAtTime(peak, t + 2.2, 0.25);
    gp.setTargetAtTime(peak * 0.35, t + 3.0, 1.2);
    fp.cancelScheduledValues(t);
    fp.setTargetAtTime(420, t, 0.9);
    fp.setTargetAtTime(1900, t + 2.2, 0.2);
    fp.setTargetAtTime(700, t + 3.0, 1.0);
    // The break: white water crashing (1.5–8 kHz) as the lip lands...
    const r = this.rng;
    const brk = t + 2.15 + r.next() * 0.2;
    // (attack 60 → 150 ms: a crash, not a splice — the spectrogram showed a hard broadband edge.)
    noiseHit(this.g, this.dest(0.1 * dir, 0.25), brk, { type: 'highpass', f: 1500, amp: 0.2 * size, attack: 0.15, tau: 0.38, buf: this.g.pinkSt });
    // ...then the foam: a 2–8 kHz fizz that spreads up the beach and dies away over 2–3 s.
    noiseHit(this.g, this.dest(0.45 * dir, 0.2), brk + 0.25, { type: 'bandpass', f: 4800, q: 0.35, amp: 0.26 * size, attack: 0.35, tau: 0.9, buf: this.g.pinkSt });
    noiseHit(this.g, this.dest(-0.2 * dir, 0.3), brk + 0.4, { type: 'highpass', f: 6500, amp: 0.07 * size, attack: 0.5, tau: 0.8 });
    // Backwash: the water drains back through the shingle — a rattle of pebbles thinning out.
    const n = Math.round(26 * size);
    for (let i = 0; i < n; i++) {
      const u = Math.pow(r.next(), 1.6);
      const tt = brk + 1.1 + u * 2.2;
      noiseHit(this.g, this.dest(r.range(-0.8, 0.8), 0.35), tt, { f: 1800 + r.next() * 3600, q: 3, amp: (0.04 + r.next() * 0.04) * size * (1 - u * 0.6), attack: 0.001, tau: 0.006 + r.next() * 0.008 });
    }
    this.surfPhase++;
  }
}
