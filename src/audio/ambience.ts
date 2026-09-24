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
    bed('rain', g.pinkSt, [bf('bandpass', 5000, 0.55), bf('highshelf', 7000, 0.7)]);
    bed('rainLow', g.brownSt, [bf('lowpass', 380, 0.5)]);
    bed('fountain', g.pinkSt, [bf('bandpass', 1200, 0.5), bf('lowpass', 3800)]);
    const surf = bed('surf', g.pinkSt, [bf('lowpass', 500, 0.6)]);
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
    bed('room', g.brownSt, [bf('lowpass', 240, 0.6)], 0.8);
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
    const layer = (perSec: number, seed: number, lp: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = makeRain(ctx, 5.3, perSec, new Rand(seed));
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      const gn = ctx.createGain();
      gn.gain.value = 0;
      src.connect(f).connect(gn).connect(this.out);
      gn.connect(this.send);
      src.start(ctx.currentTime, this.rng.next() * 5);
      return gn;
    };
    this.drops = { light: layer(45, 4101, 9000), heavy: layer(110, 5202, 11000) };
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
      this.next.wx = now + 5 + r.next() * 15;
    }
    this.wx += (this.wxTarget - this.wx) * 0.03;
    const swellDb = (d: number): number => Math.pow(10, (d * this.wx) / 20);
    const wind = outdoors ? (0.075 + 0.12 * windy) * (0.45 + 0.85 * this.gust * this.gust) * swellDb(2) : mine ? 0.015 : 0;
    this.setBed('wind', wind, now, 0.8);
    const wf = this.beds.wind!.filter!;
    wf.frequency.setTargetAtTime((260 + 520 * this.gust) * (1 + 0.15 * this.wx), now, 1.2);
    const hasLeaves = s.season !== 'winter' && outdoors && !beach;
    this.setBed('leaves', hasLeaves ? 0.034 + 0.05 * Math.pow(this.gust, 2) * windy * (s.season === 'fall' ? 1.3 : 1) : 0, now, 0.6);
    // Rain: ±4 dB and ±30 % of the hiss band with the weather swell (showers come and go).
    this.setBed('rain', (outdoors && raining ? (storm ? 0.2 : 0.13) : s.indoor && raining ? 0.03 : 0) * swellDb(5), now, 1.5);
    this.beds.rain!.filter!.frequency.setTargetAtTime(5000 * (1 + 0.3 * this.wx), now, 1.5);
    this.setBed('rainLow', (raining && !mine ? (storm ? 0.15 : 0.06) * (s.indoor ? 0.5 : 1) : 0) * swellDb(3), now, 1.5);
    // Individual drops: a light patter always, the heavy layer in a storm; muffled on the roof indoors.
    if (raining && !mine && !this.drops) this.buildDrops();
    if (this.drops) {
      const lv = !raining || mine ? 0 : s.indoor ? 0.18 : 1;
      // Drop density follows the swell: the heavy layer fades in on the downpours even in plain rain.
      const q = Math.round(this.wx * 20) / 20;
      const key = `${lv}:${storm}:${q}`;
      if (key !== this.dropsKey) {
        this.dropsKey = key;
        this.drops.light.gain.setTargetAtTime(0.5 * lv * (1 + 0.5 * q), now, 1.5);
        this.drops.heavy.gain.setTargetAtTime((storm ? 0.55 * (1 + 0.3 * q) : Math.max(0, q - 0.15) * 0.45) * lv, now, 1.5);
      }
    }
    this.setBed('fountain', outdoors ? 0.14 * s.fountain : 0, now, 0.6);
    this.setBed('cave', mine ? 0.1 : 0, now, 2);
    this.setBed('caveAir', mine ? 0.07 : 0, now, 2);
    const cold = s.season === 'winter' && outdoors;
    this.setBed('howl', cold ? 0.012 + 0.03 * this.gust * windy : 0, now, 1);
    this.beds.howl!.filter!.frequency.setTargetAtTime(480 + 420 * this.gust, now, 2);
    this.setBed('snowHush', outdoors && s.weather === 'snow' ? 0.02 : 0, now, 2);
    const hearth = s.indoor && (s.night > 0.3 || s.season === 'winter' || s.season === 'fall' || raining);
    this.setBed('room', s.indoor ? 0.05 : 0, now, 1);
    this.setBed('fire', hearth ? 0.035 : 0, now, 1.5);
    const town = s.map === 'town' || s.map.startsWith('fest');
    const cicadaTime = s.season === 'summer' && outdoors && !raining && h >= 10 && h <= 18.5;
    this.cicadas(now, cicadaTime);

    // Surf: individual waves on the coast. Inland water babbles (forest stream) or laps (pond).
    if (beach) {
      if ((this.next.wave ?? 0) <= now + ahead) {
        const t = Math.max(now, this.next.wave ?? now);
        this.wave(t, 1);
        this.next.wave = t + 6.5 + r.next() * 4;
      }
    } else this.setBed('surf', 0, now, 2);
    const stream = outdoors && s.map === 'forest';
    this.setBed('brook', stream ? 0.02 + 0.07 * s.water : 0, now, 1);

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
    if (t !== null) this.bird(t, s);
    t = due('dove', 14, 30, birdsActive && h < 10.5);
    if (t !== null) this.dove(t);
    t = due('chickadee', 12, 35, outdoors && !raining && s.season === 'winter' && s.night < 0.3);
    if (t !== null) this.chickadee(t, r.range(-0.7, 0.7));
    t = due('crow', 20, 55, outdoors && !raining && (s.season === 'fall' || s.season === 'winter') && s.night < 0.3 && !beach);
    if (t !== null) this.crow(t);
    t = due('gull', 5, 14, beach && !storm && s.night < 0.4);
    if (t !== null) this.gull(t);
    // Night.
    const crittersNight = outdoors && s.night > 0.55 && !raining && s.season !== 'winter';
    if (crittersNight) this.cricketChorus(now, until, s.season === 'fall' ? 2 : 4);
    t = due('frog', 1.5, 5, crittersNight && (s.season === 'spring' || s.season === 'summer') && s.water > 0.15);
    if (t !== null) this.frog(t);
    t = due('owl', 25, 60, outdoors && s.night > 0.7 && !storm);
    if (t !== null) this.owl(t);
    // Weather.
    t = due('drip', 0.05, 0.25, raining && !mine);
    if (t !== null) this.drip(t, s.indoor ? 0.4 : 1);
    t = due('thunder', 14, 38, storm && now > this.externalThunderUntil);
    if (t !== null) this.thunder(t, r.next());
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
    t = due('walla', festive ? 0.25 : 0.9, festive ? 1.2 : 3.2, bustle);
    if (t !== null) this.walla(t, festive ? 1 : 0.6);
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

  private bird(t: number, s: EnvState): void {
    const r = this.rng;
    const species = r.weighted([['warbler', 3], ['robin', 4], ['finch', 3], ['thrush', 2.5], ['wren', 1.5], ['chickadee', s.season === 'spring' ? 1.5 : 0.8]] as const);
    if (species === 'chickadee') this.chickadee(t, 0);
    else this.sing(species, t, species === 'wren' ? 0.042 : species === 'thrush' ? 0.056 : 0.06);
  }

  private chickadee(t: number, _pan: number): void {
    this.sing('chickadee', t, 0.06, 0.5);
  }

  private dove(t: number): void {
    this.sing('dove', t, 0.09, 0.3);
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
        const d = this.dest(c.pan, 0.5);
        const pulses = r.int(3, 4);
        const k = r.int(0, 11);
        for (let i = 0; i < pulses; i++) this.bank.play(d, 'cricket', k, c.next + i * 0.022, 0.028, c.f);
        c.next += c.period * r.range(0.9, 1.1);
      }
    }
  }

  private frog(t: number): void {
    const ctx = this.g.ctx;
    const d = this.dest(this.rng.range(-0.8, 0.8), 0.4);
    const f = this.rng.range(180, 260);
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.1;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, tt);
      o.frequency.linearRampToValueAtTime(f * 1.3, tt + 0.06);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 850;
      bp.Q.value = 4;
      const a = ctx.createGain();
      a.gain.setValueAtTime(0, tt);
      a.gain.linearRampToValueAtTime(0.06, tt + 0.01);
      a.gain.linearRampToValueAtTime(0, tt + 0.07);
      o.connect(bp).connect(a).connect(d);
      o.start(tt);
      o.stop(tt + 0.08);
    }
  }

  private owl(t: number): void {
    const o = 4 * this.rng.int(0, 2);
    this.sayPhrase('owl', t, [this.rng.range(-0.9, 0.9), 0.75], [o, o + 1, o + 2, o + 3], 0.07);
  }

  private drip(t: number, level: number): void {
    const r = this.rng;
    const d = this.dest(r.range(-1, 1), r.next() * 0.8);
    // A drop into a puddle: gone in < 80 ms with a slight downward glide (pre-rendered bank).
    this.bank.play(d, 'drip', r.int(0, 23), t, 0.02 * level, r.range(0.9, 1.1));
  }

  thunder(t: number, dist: number): void {
    const g = this.g;
    const d = this.dest(this.rng.range(-0.7, 0.7), dist * 0.5);
    if (dist < 0.4) noiseHit(g, d, t, { type: 'highpass', f: 1200, amp: 0.25 * (1 - dist), attack: 0.004, tau: 0.06 });
    // Rolling rumble: several overlapping low swells.
    const n = 4 + Math.floor(this.rng.next() * 4);
    let tt = t + 0.05 + dist * 0.6;
    for (let i = 0; i < n; i++) {
      noiseHit(g, d, tt, { type: 'lowpass', f: 200 + (1 - dist) * 250, q: 0.7, amp: (0.6 - i * 0.05) * (1 - dist * 0.5), attack: 0.15 + this.rng.next() * 0.3, tau: 0.6 + this.rng.next() * 0.8, buf: g.brown });
      tt += 0.4 + this.rng.next() * 0.9;
    }
    // Near strikes push the score right down; distant rolls only make a little room.
    g.duckMusic(t, 0.55 + 0.3 * dist, 1 + 1.5 * (1 - dist), 2);
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

  /** Distant crowd murmur: a few overlapping formant syllables, far away and lowpassed. */
  private walla(t: number, level: number): void {
    const ctx = this.g.ctx;
    const r = this.rng;
    const d = this.dest(r.range(-0.9, 0.9), 0.7 + r.next() * 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(d);
    const base = r.pick([120, 150, 190, 230, 280]);
    const syl = r.int(3, 7);
    let tt = t;
    const F = [[730, 1090], [530, 1840], [300, 2200], [570, 840], [440, 1020]];
    for (let i = 0; i < syl; i++) {
      const dur = r.range(0.08, 0.16);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = base * Math.pow(2, r.range(-3, 4) / 12);
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.linearRampToValueAtTime(f0 * r.range(0.9, 1.08), tt + dur);
      const [f1, f2] = r.pick(F);
      const a = ctx.createGain();
      a.gain.setValueAtTime(0, tt);
      a.gain.linearRampToValueAtTime(0.012 * level, tt + 0.02);
      a.gain.linearRampToValueAtTime(0, tt + dur);
      for (const [ff, q] of [[f1!, 5], [f2!, 8]] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = ff;
        bp.Q.value = q;
        o.connect(bp).connect(a);
      }
      a.connect(lp);
      o.start(tt);
      o.stop(tt + dur + 0.02);
      tt += dur + r.range(0.01, 0.06) + (r.chance(0.2) ? 0.2 : 0);
    }
    // Now and then somebody laughs.
    if (r.chance(0.12)) for (let i = 0; i < 4; i++) this.chirp(lp, tt + 0.1 + i * 0.13, base * 2.1, base * 1.8, 0.08, 0.008 * level);
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
    this.cicadaOn = true;
    if ((this.next.cicada ?? 0) > now) return;
    const r = this.rng;
    const rise = r.range(3, 5);
    const hold = r.range(2, 6);
    const fall = r.range(3, 6);
    const peak = r.range(0.012, 0.02);
    b.filter!.frequency.setTargetAtTime(r.range(4500, 6500), now, 1);
    gp.cancelScheduledValues(now);
    gp.setValueAtTime(Math.max(0.0005, b.level), now);
    gp.linearRampToValueAtTime(peak, now + rise);
    gp.setValueAtTime(peak, now + rise + hold);
    gp.linearRampToValueAtTime(0.0015, now + rise + hold + fall);
    b.level = 0.0015;
    this.next.cicada = now + rise + hold + fall + r.range(1, 9);
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
    // Foam hiss as the wave recedes, fizzing out on the far side.
    noiseHit(this.g, this.dest(0.45 * dir, 0.2), t + 2.6, { type: 'bandpass', f: 4200, q: 0.4, amp: 0.05 * size, attack: 0.3, tau: 0.9, buf: this.g.pinkSt });
    this.surfPhase++;
  }
}
