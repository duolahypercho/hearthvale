/**
 * Composer: turns a ThemeDef into a fully arranged piece (a list of timed note events).
 *
 *   tune        every song theme carries a hand-written melody (src/audio/themes.ts: scale degrees +
 *               rhythm per bar, an anacrusis into each A, an alternate cadence for the last A). The
 *               tune is restated literally every time A comes round — only ornaments, doublings,
 *               register and the final cadence change — so the player learns it. Themes without a
 *               written tune get one composed ONCE from a canonical seed (theme id), never per day.
 *   form        intro · A · A' · B · A'' · outro (per theme), 8-bar periods, optional key lift
 *               into the last A (the bar before it pivots on the new dominant).
 *   harmony     roman-numeral progressions, chord-scales that adapt to borrowed chords, voice-led
 *               voicings (minimal motion) for accompaniment, pads and counter lines.
 *   arrangement layers enter/leave by section (counter-melody and percussion on the repeat, pad
 *               in B, octave doubling ...), per-bar figuration variants, a fill every 4th bar (bass
 *               pickup runs, anticipations, accompaniment rests), drum fills at phrase ends and into
 *               the final A, a stop-time bar (or a held "breath" in 3/4) before B, section-level
 *               crescendi, ritardandi at cadences and a fermata ending.
 *   humanise    timing jitter per role, metric accents, swing, strum spreads, grace notes. The day
 *               seed only varies accompaniment figuration and humanisation, never the tune.
 */
import { Rand } from './dsp';
import type { InstrumentName, NoteOpts } from './instruments';
import { MODES, chordPcs, chordScale, nearestIn, parseChord, scaleStep, voiceChord, type Chord, type ModeName } from './theory';

export type Meter = '4/4' | '3/4' | '6/8';
export type TrackName = 'melody' | 'double' | 'counter' | 'accomp' | 'accomp2' | 'bass' | 'pad' | 'perc';
export type Section = 'intro' | 'A' | 'B' | 'outro';
export type When = 'always' | 'repeat' | 'B' | 'late';
export type AccompPattern = 'arp8' | 'arpUp' | 'fingerpick' | 'strum' | 'waltz' | 'waltzArp' | 'block' | 'oompah' | 'ostinato332' | 'musicBox' | 'pizzOff' | 'epComp' | 'harpRoll';
export type BassPattern = 'root' | 'rootFifth' | 'walk' | 'waltz' | 'jig' | 'tresillo' | 'pedal';
export type PercPattern = 'shaker' | 'island' | 'jig' | 'town' | 'lofi' | 'light' | 'jazz' | 'sleigh';

export interface TrackMix {
  gain: number;
  pan: number;
  /** Reverb send (0..1). */
  send: number;
}

/**
 * A hand-written tune. Each bar is a string of tokens `<pitch>:<steps>`:
 *   pitch  scale degree 1–7 of the theme's mode, optional accidental prefix `b`/`#`, octave marks
 *          `'` (up) / `,` (down) as suffix; `r` is a rest.
 *   steps  eighth notes in 4/4 and 3/4, triplet eighths in 6/8 (a bar is 8 / 6 / 6 steps).
 * Degree 1 sounds at `key + 12 * octave`.
 */
export interface Tune {
  octave?: number;
  A: string[];
  B?: string[];
  /** Replaces the last bars of the final A (a stronger cadence to finish on). */
  Aend?: string[];
  /** Anacrusis into every A, written into the end of the bar before it. */
  pickup?: string;
}

export interface ThemeDef {
  id: string;
  title: string;
  /** One line about where you hear it (the now-playing card). */
  blurb?: string;
  bpm: number;
  meter: Meter;
  /** Tonic MIDI note. */
  key: number;
  mode: ModeName;
  /** 0.5 = straight eighths; 0.58 = lilting swing. */
  swing?: number;
  form: Section[];
  /**
   * Roman-numeral harmony per section. `Aend` replaces the last bars of the final A (an authentic
   * cadence when A itself ends open on V); slash chords ('I/3', 'V/5') put that chord member in the bass.
   */
  prog: { A: string[]; B: string[]; intro?: string[]; outro?: string[]; Aend?: string[] };
  /** Key lift (semitones) for the final A; the bar before it becomes the pivot. */
  lift?: number;
  /** What happens in the bar before B: a stop-time hit, a held rolled chord, or nothing. */
  breaks?: 'stop' | 'breath' | false;
  melody?: {
    inst: InstrumentName;
    range: [number, number];
    /** 0 = long notes, 1 = busy (only used when there is no written tune). */
    density: number;
    legato?: boolean;
    staccato?: boolean;
    /** Grace-note probability on long strong notes (restatements only). */
    ornament?: number;
    bInst?: InstrumentName;
    octaveOnRepeat?: boolean;
    double?: { inst: InstrumentName; interval: number; on: When };
    tune?: Tune;
  };
  counter?: { inst: InstrumentName; range: [number, number]; on: When; style?: 'guide' | 'moving' };
  accomp?: { inst: InstrumentName; pattern: AccompPattern; range: [number, number]; voices: 3 | 4; vel: number; on?: When };
  accomp2?: { inst: InstrumentName; pattern: AccompPattern; range: [number, number]; voices: 3 | 4; vel: number; on?: When };
  bass?: { inst: InstrumentName; pattern: BassPattern; range: [number, number]; vel: number };
  pad?: { inst: InstrumentName; range: [number, number]; voices: 3 | 4; vel: number; on: When };
  perc?: { pattern: PercPattern; on: When; vel: number };
  /** Sparse ambient generation instead of a song form (mine). */
  ambient?: { inst: InstrumentName; range: [number, number]; noteChance: number; bars: number; motif?: number[] };
  mix: Partial<Record<TrackName, TrackMix>>;
  /** Seconds of silence (ambience only) after each piece, [min, max]. [0,0] loops seamlessly. */
  rest: [number, number];
  /** Overall level trim for this theme. */
  gain: number;
}

export interface NoteEvent {
  t: number;
  track: TrackName;
  inst: InstrumentName;
  midi: number;
  dur: number;
  vel: number;
  o?: NoteOpts;
}

export interface BarInfo {
  t: number;
  chords: string;
  section: string;
  /** Bar index inside its section. */
  i: number;
  shift: number;
}

export interface Piece {
  theme: string;
  seed: number;
  events: NoteEvent[];
  /** Musical length in seconds (tails ring beyond). */
  duration: number;
  bars: number;
  /** Bar start times + chord symbols (plots, phrase-quantised handoffs). */
  barInfo?: BarInfo[];
}

interface Span {
  chord: Chord;
  s0: number;
  s1: number;
}
interface Bar {
  section: Section;
  occ: number;
  /** Bar index inside its section. */
  i: number;
  len: number;
  spans: Span[];
  t0: number;
  dur: number;
  /** Last bar before a B: stop-time / breath. */
  brk: boolean;
  /** Every 4th bar of a phrase: pickups, anticipations, drum fills. */
  fill: boolean;
  /** Last bar before the final A (big fill). */
  preFinal: boolean;
  /** Semitone transposition (key lift). */
  shift: number;
  /** 0..1 position inside the section (crescendi). */
  pos: number;
  /** Index of the section in th.form. */
  si: number;
}
interface MNote {
  step: number;
  steps: number;
  midi: number;
  vel: number;
  grace?: number;
  pick?: boolean;
}

const CELLS: Record<Meter, { normal: number[][]; slow: number[][]; cadence: number[][]; busy: number[][] }> = {
  '4/4': {
    busy: [[1, 1, 2, 1, 1, 2], [2, 1, 1, 1, 1, 2], [1, 1, 1, 1, 2, 2], [3, 1, 1, 1, 2], [1, 1, 2, 2, 2], [2, 1, 1, 2, 1, 1]],
    normal: [[2, 2, 2, 2], [3, 1, 2, 2], [2, 1, 1, 2, 2], [2, 2, 4], [4, 2, 2], [1, 1, 2, 4], [3, 1, 4], [2, 2, 1, 1, 2], [2, 4, 2], [1, 1, 1, 1, 2, 2], [3, 3, 2]],
    slow: [[4, 4], [6, 2], [2, 2, 4], [4, 2, 2], [3, 1, 4], [2, 6]],
    cadence: [[2, 2, 3, -1], [4, 3, -1], [6, -2], [2, 5, -1], [3, 1, 3, -1], [1, 1, 2, 3, -1]],
  },
  '3/4': {
    busy: [[1, 1, 1, 1, 2], [2, 1, 1, 1, 1], [1, 1, 2, 1, 1]],
    normal: [[2, 2, 2], [3, 1, 2], [4, 2], [2, 1, 1, 2], [1, 1, 2, 2], [2, 4]],
    slow: [[6], [4, 2], [2, 4], [3, 1, 2]],
    cadence: [[2, 3, -1], [5, -1], [4, 2], [1, 1, 3, -1]],
  },
  '6/8': {
    busy: [[1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1]],
    normal: [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1], [1, 1, 1, 2, 1], [2, 1, 2, 1], [1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1], [1, 1, 1, 3]],
    slow: [[3, 3], [2, 1, 3], [6]],
    cadence: [[2, 1, 3], [1, 1, 1, 3], [3, 2, -1], [2, 1, 2, -1]],
  },
};

const MOVES: [number, number][] = [
  [1, 3], [-1, 3.2], [2, 1.5], [-2, 1.6], [0, 0.25], [3, 0.6], [-3, 0.55], [4, 0.3], [-4, 0.2],
];

/** Accompaniment figuration variants (chord-voice indices per step); one is picked per bar. */
const SHAPES: Partial<Record<AccompPattern, number[][]>> = {
  arp8: [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 3, 4, 5, 4, 2]],
  arpUp: [[0, 1, 2, 3, 4, 5, 4, 3], [0, 2, 3, 4, 5, 4, 2, 1], [0, 1, 3, 2, 4, 3, 5, 3]],
  waltzArp: [[0, 1, 2, 3, 2, 1], [0, 2, 3, 4, 3, 2], [0, 1, 3, 2, 4, 2]],
  musicBox: [[0, 2, 1, 3, 2, 4], [0, 3, 2, 4, 3, 5], [0, 2, 4, 3, 1, 3]],
  ostinato332: [[0, 2, 1, 2, 3, 2, 1, 2], [0, 2, 3, 1, 2, 3, 0, 2], [0, 3, 1, 3, 2, 3, 1, 3]],
};

export class Composer {
  /** Day seed: accompaniment figuration + humanisation. */
  private rng: Rand;
  /** Canonical seed (theme id only): melody, ornaments — identical every day. */
  private mr: Rand;
  private keyPc: number;
  private S: number;
  private stepSec: number;
  private chordCache = new Map<string, Chord>();
  /** Last bass note and the melody note sounding against it (outer-voice counterpoint). */
  private bassPrev: { b: number; m: number | null } | null = null;
  /** The melody of the bar being arranged (the bass reads it to avoid doubling the tune). */
  private barMel: MNote[] | undefined;

  constructor(private th: ThemeDef, readonly seed: number) {
    this.rng = new Rand(seed * 7919 + hash(th.id));
    this.mr = new Rand(hash(th.id) ^ 0x5eed1e);
    this.keyPc = th.key % 12;
    this.S = th.meter === '4/4' ? 8 : 6;
    this.stepSec = (60 / th.bpm) * (th.meter === '6/8' ? 1 / 3 : 0.5);
  }

  private chord(sym: string): Chord {
    let c = this.chordCache.get(sym);
    if (!c) this.chordCache.set(sym, (c = parseChord(sym)));
    return c;
  }

  compose(): Piece {
    return this.th.ambient ? this.composeAmbient() : this.composeSong();
  }

  // ───────────────────────────────────────────── structure

  private buildBars(): Bar[] {
    const th = this.th;
    const bars: Bar[] = [];
    const occ: Record<string, number> = {};
    let t = 0.4; // small pre-roll so the very first note is never clipped
    const lastA = th.form.lastIndexOf('A');
    const breaks = th.breaks ?? (th.meter === '3/4' ? 'breath' : 'stop');
    th.form.forEach((sec, si) => {
      const o = (occ[sec] = (occ[sec] ?? -1) + 1);
      let prog = sec === 'intro' ? th.prog.intro ?? [th.prog.A[0]!, th.prog.A[0]!] : sec === 'outro' ? th.prog.outro ?? ['IV', 'I'] : th.prog[sec];
      if (sec === 'A' && si === lastA && lastA > 1 && th.prog.Aend) prog = [...prog.slice(0, prog.length - th.prog.Aend.length), ...th.prog.Aend];
      const next = th.form[si + 1];
      prog.forEach((entry, i) => {
        const syms = entry.split(/\s+/).filter(Boolean);
        const spans: Span[] = syms.map((s, k) => ({ chord: this.chord(s), s0: Math.round((k * this.S) / syms.length), s1: Math.round(((k + 1) * this.S) / syms.length) }));
        const last = i === prog.length - 1;
        // Rubato: phrase ends breathe, the final cadence and outro broaden.
        let scale = 1;
        if (sec !== 'intro' && sec !== 'outro' && i % 4 === 3) scale = 1.025;
        if (si === lastA && last) scale = 1.05;
        if (sec === 'outro') scale = last ? 1.25 : 1.1;
        const dur = this.S * this.stepSec * scale;
        const brk = !!breaks && last && sec === 'A' && next === 'B';
        const preFinal = last && si === lastA - 1 && lastA > 1;
        const fill = !brk && (sec === 'A' || sec === 'B') && (i % 4 === 3 || preFinal);
        bars.push({ section: sec, occ: o, i, len: prog.length, spans, t0: t, dur, brk, fill, preFinal, shift: 0, pos: i / Math.max(1, prog.length - 1), si });
        t += dur;
      });
    });
    // Key lift: the final A (and the pivot bar before it, and the outro) move up.
    if (th.lift && lastA > 0) {
      const first = bars.findIndex((b) => b.si === lastA);
      if (first > 0) for (let k = first - 1; k < bars.length; k++) bars[k]!.shift = th.lift;
    }
    return bars;
  }

  private active(when: When | undefined, bar: Bar): boolean {
    if (bar.section === 'intro' || bar.section === 'outro') return false;
    switch (when ?? 'always') {
      case 'always':
        return true;
      case 'repeat':
        return bar.section === 'B' || bar.occ > 0;
      case 'B':
        return bar.section === 'B';
      case 'late':
        return bar.section === 'B' || (bar.section === 'A' && bar.occ > 1);
    }
  }

  /** Step → seconds inside a bar, with swing. */
  private at(bar: Bar, step: number): number {
    let s = step;
    const sw = this.th.swing ?? 0.5;
    if (this.th.meter === '4/4' && sw !== 0.5 && Math.floor(step) % 2 === 1 && step === Math.floor(step)) s += (sw - 0.5) * 2;
    return bar.t0 + (s / this.S) * bar.dur;
  }

  private spanAt(bar: Bar, step: number): Span {
    for (const sp of bar.spans) if (step >= sp.s0 && step < sp.s1) return sp;
    return bar.spans[bar.spans.length - 1]!;
  }

  private strength(step: number): number {
    if (step === 0) return 1;
    if (this.th.meter === '4/4') return step === 4 ? 0.8 : step % 2 === 0 ? 0.5 : 0.2;
    if (this.th.meter === '3/4') return step % 2 === 0 ? 0.55 : 0.2;
    return step === 3 ? 0.8 : 0.3;
  }

  // ───────────────────────────────────────────── song

  private composeSong(): Piece {
    const th = this.th;
    const bars = this.buildBars();
    const ev: NoteEvent[] = [];
    const r = this.rng;
    const mel = this.melodyPlan(bars);
    this.bassPrev = null;

    // ── melody
    if (th.melody) {
      const m = th.melody;
      let last: number | undefined;
      bars.forEach((b, bi) => {
        const notes = mel[bi];
        if (!notes) return;
        const n0 = ev.length;
        const secInst = b.section === 'B' && m.bInst ? m.bInst : m.inst;
        const oct = m.octaveOnRepeat && b.section === 'A' && b.occ > 0 ? 12 : 0;
        const crescendo = b.section === 'B' ? 0.94 + 0.1 * b.pos : this.isFinalA(b) ? 1.05 : 1;
        notes.forEach((n, ni) => {
          const inst = n.pick ? m.inst : secInst;
          const t = this.at(b, n.step) + this.jit(0.007);
          const hold = b.section === 'outro' ? 0.95 : m.staccato ? 0.55 : m.legato ? 0.97 : 0.86;
          const dur = (n.steps / this.S) * b.dur * hold;
          const nextN = notes[ni + 1];
          const tied = m.legato && nextN && nextN.step === n.step + n.steps;
          const o: NoteOpts = {};
          if (m.legato && last !== undefined && Math.abs(n.midi + oct - last) <= 7) o.art = 'legato';
          if (!m.legato && n.steps >= 4 && inst === 'marimba') o.art = 'roll';
          if (m.staccato) o.art = 'staccato';
          if ((inst === 'fiddle' || inst === 'cello') && o.art === 'legato' && this.mr.chance(0.18) && last !== undefined) o.from = last;
          const vel = n.vel * crescendo;
          if (n.grace !== undefined) {
            const gd = inst === 'fiddle' ? 0.03 : 0.05;
            ev.push({ t: t - gd, track: 'melody', inst, midi: n.grace + oct, dur: gd, vel: vel * 0.55 });
          }
          ev.push({ t, track: 'melody', inst, midi: n.midi + oct, dur: tied ? dur * 1.03 : dur, vel, o });
          last = n.midi + oct;
          if (m.double && this.active(m.double.on, b)) {
            ev.push({ t: t + 0.004, track: 'double', inst: m.double.inst, midi: n.midi + oct + m.double.interval, dur, vel: vel * 0.7, o: { art: o.art } });
          }
        });
        this.transpose(ev, n0, b.shift);
      });
    }

    // ── harmony layers
    let accV: number[] | null = null;
    let acc2V: number[] | null = null;
    let padV: number[] | null = null;
    let cntPrev: number | null = null;
    bars.forEach((b, bi) => {
      const n0 = ev.length;
      const nextBar = bars[bi + 1];
      const isIntro = b.section === 'intro';
      const isOutro = b.section === 'outro';
      const lastBar = bi === bars.length - 1;
      const fillKind = b.fill ? (((b.i >> 2) + b.occ) % 2 === 0 ? 'antic' : 'rest') : null;
      b.spans.forEach((sp, si) => {
        const nextChord = b.spans[si + 1]?.chord ?? nextBar?.spans[0]!.chord ?? null;
        const lastSpan = si === b.spans.length - 1;
        if (th.accomp && (th.accomp.on === undefined || isIntro || isOutro || this.active(th.accomp.on, b))) {
          accV = voiceChord(sp.chord, this.keyPc, th.accomp.voices, th.accomp.range[0], th.accomp.range[1], accV);
          this.accomp(ev, 'accomp', th.accomp, b, sp, accV, lastBar, lastSpan ? fillKind : null, nextChord);
        }
        if (th.accomp2 && !isIntro && (th.accomp2.on === undefined || this.active(th.accomp2.on, b))) {
          acc2V = voiceChord(sp.chord, this.keyPc, th.accomp2.voices, th.accomp2.range[0], th.accomp2.range[1], acc2V);
          this.accomp(ev, 'accomp2', th.accomp2, b, sp, acc2V, lastBar, lastSpan ? fillKind : null, nextChord);
        }
        const padOn = th.pad && (this.active(th.pad.on, b) || (th.pad.on === 'always' && (isIntro || isOutro)) || (isOutro && th.pad.on !== 'B'));
        if (th.pad && padOn && !(b.brk && th.meter !== '3/4')) {
          padV = voiceChord(sp.chord, this.keyPc, th.pad.voices, th.pad.range[0], th.pad.range[1], padV);
          const t = this.at(b, sp.s0);
          const dur = ((sp.s1 - sp.s0) / this.S) * b.dur * (lastBar ? 1.6 : 1.02);
          const swell = b.section === 'B' ? 0.9 + 0.2 * b.pos : 1;
          padV.forEach((p, k) => ev.push({ t: t + k * 0.012, track: 'pad', inst: th.pad!.inst, midi: p, dur, vel: th.pad!.vel * swell * (0.92 + 0.08 * Math.sin(bi * 0.7)) }));
        }
        this.barMel = mel[bi] ?? undefined;
        if (th.bass && !(isIntro && b.i === 0 && th.prog.intro === undefined)) this.bass(ev, b, sp, nextChord, lastBar, lastSpan && (b.fill || b.brk) && !!nextBar);
        if (th.counter && this.active(th.counter.on, b)) {
          cntPrev = this.counter(ev, b, sp, nextChord, cntPrev, mel[bi] ?? undefined);
        }
      });
      if (th.perc && (this.active(th.perc.on, b) || (th.perc.on === 'always' && isIntro && b.i > 0) || b.preFinal)) this.perc(ev, b);
      this.transpose(ev, n0, b.shift);
    });

    ev.sort((a, b) => a.t - b.t);
    const lastBar = bars[bars.length - 1]!;
    const barInfo = bars.map((b) => ({ t: b.t0, chords: b.spans.map((sp) => sp.chord.symbol).join(' '), section: b.i === 0 ? b.section : '', i: b.i, shift: b.shift }));
    return { theme: th.id, seed: this.seed, events: ev, duration: lastBar.t0 + lastBar.dur, bars: bars.length, barInfo };
  }

  private transpose(ev: NoteEvent[], from: number, shift: number): void {
    if (!shift) return;
    for (let k = from; k < ev.length; k++) if (ev[k]!.track !== 'perc') ev[k]!.midi += shift;
  }

  private isFinalA(b: Bar): boolean {
    return b.section === 'A' && b.occ === this.th.form.filter((s) => s === 'A').length - 1 && b.occ > 0;
  }

  private jit(sigma: number): number {
    return this.rng.gauss(sigma);
  }

  // ───────────────────────────────────────────── melody

  /**
   * Melody notes for every bar (null = tacet): the written tune (or a canonical composed one),
   * restated literally per section, ornamented on repeats, alternate final cadence, pickups.
   */
  private melodyPlan(bars: Bar[]): (MNote[] | null)[] {
    const th = this.th;
    const out: (MNote[] | null)[] = bars.map(() => null);
    const m = th.melody;
    if (!m) return out;
    const tune = m.tune;
    const nA = th.prog.A.length;
    const nB = th.prog.B.length;
    const finalOcc = th.form.filter((s) => s === 'A').length - 1;
    const nextAfter = (sec: Section): Section | undefined => th.form[th.form.indexOf(sec) + 1];
    // Canonical sections, computed once.
    const barsOf = (sec: Section, occ: number): Bar[] => bars.filter((b) => b.section === sec && b.occ === occ);
    const baseA = tune ? this.parseSection(tune.A, nA) : this.genCanonical(barsOf('A', 0), 'A', nextAfter('A'));
    const baseB = th.form.includes('B') ? (tune?.B ? this.parseSection(tune.B, nB) : this.genCanonical(barsOf('B', 0), 'B', nextAfter('B'))) : [];
    const endA = tune?.Aend ? this.parseSection(tune.Aend, tune.Aend.length) : null;
    let prev: number | null = null;
    bars.forEach((b, bi) => {
      if (b.section === 'intro') return;
      if (b.section === 'outro') {
        if (bi === bars.length - 1) out[bi] = [{ step: 0, steps: this.S, midi: nearestIn(prev ?? th.key + 12, [this.keyPc]), vel: 0.6 }];
        return;
      }
      const base = b.section === 'A' ? baseA : baseB;
      let src = base[b.i % base.length] ?? [];
      if (b.section === 'A' && b.occ === finalOcc && endA && b.i >= b.len - endA.length) src = endA[b.i - (b.len - endA.length)] ?? src;
      const notes = src.map((n) => ({ ...n }));
      // Restatements get ornaments (canonical, so the same every time).
      if ((b.occ > 0 || b.section === 'B') && (m.ornament ?? 0) > 0) {
        const orr = new Rand(hash(`${th.id}:${b.section}:${b.occ}:${b.i}`));
        for (const n of notes) {
          if (n.steps >= 3 && this.strength(n.step) >= 0.8 && orr.chance(m.ornament!)) n.grace = scaleStep(n.midi, 1, chordScale(this.spanAt(b, n.step).chord, this.keyPc, th.mode));
        }
      }
      out[bi] = notes;
      if (notes.length) prev = notes[notes.length - 1]!.midi;
    });
    // Anacrusis into each A.
    if (tune?.pickup) {
      const pick = this.parseBar(tune.pickup, false);
      const P = pick.reduce((a, n) => Math.max(a, n.step + n.steps), 0);
      bars.forEach((b, bi) => {
        const nb = bars[bi + 1];
        if (!nb || nb.section !== 'A' || nb.i !== 0) return;
        const at = this.S - P;
        const kept = (out[bi] ?? []).filter((n) => n.step < at).map((n) => ({ ...n, steps: Math.min(n.steps, at - n.step) }));
        out[bi] = kept.concat(pick.map((n) => ({ ...n, step: n.step + at, pick: true })));
      });
    }
    return out;
  }

  private parseSection(src: string[], n: number): MNote[][] {
    const out: MNote[][] = [];
    for (let i = 0; i < n; i++) out.push(this.parseBar(src[i % src.length]!, true));
    return out;
  }

  /** Parse one bar of tune notation into notes with metric velocities. */
  parseBar(src: string, strict: boolean): MNote[] {
    const th = this.th;
    const scale = MODES[th.mode];
    const base = th.key + 12 * (th.melody?.tune?.octave ?? 0);
    const notes: MNote[] = [];
    let step = 0;
    for (const tok of src.trim().split(/\s+/).filter(Boolean)) {
      const mt = /^(r|[b#]?[1-7])([',]*)(?::(\d+(?:\.\d+)?))?$/.exec(tok);
      if (!mt) {
        warnOnce(`${th.id}: bad tune token "${tok}"`);
        continue;
      }
      const d = Number(mt[3] ?? 2);
      if (mt[1] !== 'r') {
        const acc = mt[1]!.startsWith('b') ? -1 : mt[1]!.startsWith('#') ? 1 : 0;
        const deg = Number(mt[1]!.replace(/[b#]/, ''));
        const oct = (mt[2]!.match(/'/g)?.length ?? 0) - (mt[2]!.match(/,/g)?.length ?? 0);
        const midi = base + scale[deg - 1]! + acc + 12 * oct;
        const vel = 0.64 + 0.2 * this.strength(step) + (d >= 4 ? 0.03 : 0) + this.mr.gauss(0.02);
        notes.push({ step, steps: d, midi, vel });
      }
      step += d;
    }
    if (strict && Math.abs(step - this.S) > 1e-6) warnOnce(`${th.id}: tune bar "${src}" is ${step} steps, expected ${this.S}`);
    return notes;
  }

  /** A melody composed once from the canonical seed (themes without a written tune). */
  private genCanonical(secBars: Bar[], sec: Section, next: Section | undefined): MNote[][] {
    if (!secBars.length) return [];
    const motif = this.genMotif(sec === 'B');
    return this.genSection(secBars, motif, null, sec, next);
  }

  private genMotif(isB = false): { cells: number[][]; moves: number[][] } {
    const r = this.mr;
    const lib = CELLS[this.th.meter];
    const density = this.th.melody?.density ?? 0.5;
    const slowPool = density > 0.65 ? lib.slow.filter((c) => c.length >= 2) : lib.slow;
    const pickCell = (head = false): number[] => {
      const busy = (): number[] => r.pick(r.next() < (density - 0.65) * 2.2 ? lib.busy : lib.normal);
      if (head) return density >= 0.5 ? busy() : r.next() > density + 0.25 ? r.pick(slowPool) : r.pick(lib.normal);
      if (isB && density < 0.85 && r.chance(0.35)) return r.pick(slowPool);
      return r.next() > density ? r.pick(slowPool) : busy();
    };
    const c0 = pickCell(true);
    const c1 = r.chance(0.45) ? c0 : pickCell();
    const c2 = r.chance(0.5) ? c0 : pickCell();
    const c3 = r.pick(lib.cadence);
    const moves = (cell: number[], trend: number): number[] => {
      const out: number[] = [];
      let lastDir = trend || (r.chance(0.5) ? 1 : -1);
      for (let i = 0; i < cell.length; i++) {
        if (cell[i]! < 0) {
          out.push(0);
          continue;
        }
        let mv = r.weighted(MOVES);
        if (mv !== 0 && r.chance(0.6)) mv = Math.abs(mv) * lastDir;
        if (i === 0) mv = r.weighted([[0, 2], [1, 1], [-1, 1], [2, 0.6], [-2, 0.5], [4, 0.3]] as const);
        if (mv !== 0) lastDir = Math.sign(mv);
        out.push(mv);
      }
      return out;
    };
    const m0 = moves(c0, isB ? 1 : 0);
    return {
      cells: [c0, c1, c2, c3],
      moves: [m0, c1 === c0 ? m0.map((m, i) => (i === 0 ? m : r.chance(0.5) ? -m : m)) : moves(c1, 0), c2 === c0 ? m0 : moves(c2, -1), moves(c3, -1)],
    };
  }

  /** Melody for one section (list of bars → notes), canonical rng. */
  private genSection(bars: Bar[], motif: { cells: number[][]; moves: number[][] }, prevIn: number | null, sec: Section, next: Section | undefined): MNote[][] {
    const th = this.th;
    const m = th.melody!;
    const r = this.mr;
    const [lo, hi] = m.range;
    const center = Math.round((lo + hi) / 2) + (sec === 'B' ? 2 : 0);
    const arc = [0, 1, 3, 1, 0, 2, 5, -1];
    let prev = prevIn ?? nearestIn(center - 2, chordPcs(bars[0]!.spans[0]!.chord, this.keyPc));
    const out: MNote[][] = [];
    const firstBarNotes: MNote[] = [];
    bars.forEach((b, bi) => {
      const pos = bi % 4;
      const phraseEnd = pos === 3;
      const lastOfSection = bi === bars.length - 1;
      let cell = motif.cells[pos]!;
      let moves = motif.moves[pos]!;
      if (bi % 8 === 6) {
        cell = CELLS[th.meter].normal[(hash(th.id) + bi) % CELLS[th.meter].normal.length]!;
        moves = cell.map((_, i) => (i === 0 ? 2 : i === 1 ? 1 : r.chance(0.6) ? -1 : 1));
      }
      const target = center + (arc[bi % 8] ?? 0);
      let targetPcs: number[] | null = null;
      if (phraseEnd) {
        const sp = b.spans[b.spans.length - 1]!;
        const pcs = chordPcs(sp.chord, this.keyPc);
        if (lastOfSection && sec === 'A') targetPcs = [this.keyPc];
        else if (lastOfSection && next === 'A') targetPcs = [pcs[1]!, pcs[0]!];
        else if (bi % 8 === 7) targetPcs = [this.keyPc, (this.keyPc + (th.mode === 'major' || th.mode === 'lydian' || th.mode === 'mixolydian' ? 4 : 3)) % 12];
        else targetPcs = pcs.slice(1);
        if (targetPcs.every((pc) => !pcs.includes(pc))) targetPcs = pcs;
      }
      if (bi % 8 === 4 && firstBarNotes.length && sameChords(b, bars[bi - 4]!)) {
        const copy = firstBarNotes.map((n) => ({ ...n, vel: n.vel * 1.03 }));
        out.push(copy);
        prev = copy[copy.length - 1]!.midi;
        return;
      }
      const notes = this.realizeBar(b, cell, moves, prev, target, lo, hi, targetPcs);
      const phraseArc = 0.84 + 0.16 * Math.sin((Math.PI * ((bi % 8) + 0.5)) / 8);
      for (const n of notes) n.vel *= phraseArc * (sec === 'B' ? 1.05 : 1);
      if (bi % 8 === 0) {
        firstBarNotes.length = 0;
        firstBarNotes.push(...notes.map((n) => ({ ...n })));
      }
      if (notes.length) prev = notes[notes.length - 1]!.midi;
      out.push(notes);
    });
    return out;
  }

  private realizeBar(b: Bar, cell: number[], moves: number[], prevIn: number, target: number, lo: number, hi: number, targetPcs: number[] | null): MNote[] {
    const notes: MNote[] = [];
    let step = 0;
    let prev = prevIn;
    let prevMove = 0;
    const lastIdx = cell.reduce((acc, d, i) => (d > 0 ? i : acc), -1);
    cell.forEach((d, i) => {
      if (d < 0) {
        step += -d;
        return;
      }
      const sp = this.spanAt(b, step);
      const scale = chordScale(sp.chord, this.keyPc, this.th.mode);
      const tones = chordPcs(sp.chord, this.keyPc);
      let mv = moves[i] ?? 0;
      if (Math.abs(prevMove) >= 3) mv = -Math.sign(prevMove) * 1;
      if (prev < target - 4 && mv < 0) mv = -mv;
      if (prev > target + 4 && mv > 0) mv = -mv;
      let p = scaleStep(prev, mv, scale);
      const strong = this.strength(step) >= 0.8 || d >= 3;
      if (strong) p = nearestIn(p, tones, mv);
      else if (d >= 2) {
        const pc = ((p % 12) + 12) % 12;
        if (tones.some((t) => Math.abs(t - pc) === 1 || Math.abs(t - pc) === 11)) p = nearestIn(p, tones, mv);
      }
      if (p === prev && mv !== 0) {
        const dir = Math.sign(mv);
        p = strong ? nearestIn(prev + dir * 2, tones, dir) : scaleStep(prev, dir, scale);
        if (p === prev) p = scaleStep(prev, dir, scale);
      }
      if (i === lastIdx && targetPcs) {
        p = nearestIn(p, targetPcs, mv);
        const pen = notes[notes.length - 1];
        if (pen && Math.abs(pen.midi - p) > 4) {
          pen.midi = scaleStep(p, pen.midi > p ? 1 : -1, chordScale(this.spanAt(b, pen.step).chord, this.keyPc, this.th.mode));
        }
      }
      while (p > hi) p -= 12;
      while (p < lo) p += 12;
      if (Math.abs(p - prev) > 9) p += p > prev ? -12 : 12;
      if (p > hi || p < lo) p = nearestIn(target, tones);
      const vel = 0.62 + 0.24 * this.strength(step) + this.mr.gauss(0.035);
      notes.push({ step, steps: d, midi: p, vel });
      prevMove = p === prev ? 0 : Math.round((p - prev) / 2);
      prev = p;
      step += d;
    });
    return notes;
  }

  // ───────────────────────────────────────────── accompaniment

  private accomp(ev: NoteEvent[], track: TrackName, cfg: NonNullable<ThemeDef['accomp']>, b: Bar, sp: Span, v: number[], lastBar: boolean, fill: 'antic' | 'rest' | null, next: Chord | null): void {
    const r = this.rng;
    const len = sp.s1 - sp.s0;
    const stepDur = b.dur / this.S;
    const inst = cfg.inst;
    const V = [...v, v[0]! + 12, v[1]! + 12, v[2]! + 12];
    const crescendo = b.section === 'B' ? 0.95 + 0.1 * b.pos : this.isFinalA(b) ? 1.04 : 1;
    // Fill bars: the last eighth anticipates the next chord, or the figure drops out for the bass run.
    const cut = fill === 'antic' && next ? this.S - 1 : fill === 'rest' ? this.S - 2 : this.S;
    const push = (step: number, midi: number, steps: number, vel: number, jitter = 0.005, o?: NoteOpts): void => {
      if (step >= sp.s1 || step >= cut) return;
      ev.push({ t: this.at(b, step) + this.jit(jitter), track, inst, midi, dur: Math.min(steps, cut - step) * stepDur * 0.95, vel: vel * cfg.vel * crescendo * (0.95 + r.gauss(0.04)), o });
    };
    const strum = (step: number, notes: number[], vel: number, up: boolean, spread = 0.014, steps = 2): void => {
      if (step >= cut) return;
      const order = up ? [...notes].reverse().slice(0, 3) : notes;
      const t = this.at(b, step);
      order.forEach((p, k) => ev.push({ t: t + k * spread + this.jit(0.003), track, inst, midi: p, dur: steps * stepDur, vel: vel * cfg.vel * crescendo * (up ? 0.7 : 1) * (1 - k * 0.04) }));
    };
    const s0 = sp.s0;
    if (lastBar) {
      // Final chord: a slow roll up the voicing, ringing.
      v.forEach((p, k) => ev.push({ t: this.at(b, 0) + k * 0.09, track, inst, midi: p, dur: b.dur * 1.4, vel: cfg.vel * (0.85 - k * 0.05) }));
      return;
    }
    if (b.brk) {
      if (s0 !== 0) return;
      const breath = (this.th.breaks ?? (this.th.meter === '3/4' ? 'breath' : 'stop')) === 'breath';
      // Stop-time: one short hit and silence (the bass and drums fill the hole) — or, in 3/4, a held rolled chord.
      v.forEach((p, k) => ev.push({ t: this.at(b, 0) + k * (breath ? 0.06 : 0.008), track, inst, midi: p, dur: breath ? b.dur * 0.98 : stepDur * 0.9, vel: cfg.vel * (breath ? 0.8 : 1) * (1 - k * 0.04) }));
      return;
    }
    if (fill === 'antic' && next && sp.s1 === this.S) {
      // Push: the next bar's chord arrives an eighth early.
      const nv = voiceChord(next, this.keyPc, v.length, cfg.range[0], cfg.range[1], v);
      const t = this.at(b, this.S - 1);
      nv.forEach((p, k) => ev.push({ t: t + k * 0.01 + this.jit(0.003), track, inst, midi: p, dur: stepDur * 1.3, vel: cfg.vel * crescendo * (0.88 - k * 0.04) }));
    }
    const variant = (n: number): number => (b.i % 4 === 0 ? 0 : r.int(0, n - 1));
    switch (cfg.pattern) {
      case 'arp8':
      case 'arpUp':
      case 'waltzArp':
      case 'musicBox':
      case 'ostinato332': {
        const shapes = SHAPES[cfg.pattern]!;
        const shape = shapes[variant(shapes.length)]!;
        const ring = cfg.pattern === 'arpUp' ? 2.5 : cfg.pattern === 'arp8' ? 1.8 : cfg.pattern === 'ostinato332' ? 1 : 2;
        for (let s = 0; s < len; s++) {
          const st = s0 + s;
          const accent = cfg.pattern === 'ostinato332' ? (st === 0 || st === 3 || st === 6 ? 0.95 : 0.6) : s === 0 ? 0.95 : s % 2 === 0 ? 0.8 : 0.68;
          push(st, V[Math.min(shape[st % shape.length]!, V.length - 1)]!, ring, accent, cfg.pattern === 'musicBox' ? 0.008 : 0.005);
        }
        break;
      }
      case 'harpRoll': {
        // Rolled chord on the downbeat + a gentle upper arpeggio answering on the second half.
        const va = variant(2);
        V.slice(0, 4).forEach((p, k) => ev.push({ t: this.at(b, s0) + k * 0.05, track, inst, midi: p, dur: len * stepDur, vel: cfg.vel * crescendo * (0.9 - k * 0.06) }));
        if (len >= 4) {
          const half = Math.floor(len / 2);
          for (let s = half; s < len; s++) push(s0 + s, V[va === 0 ? (s % 3) + 2 : 5 - (s % 3)]!, 2, s === half ? 0.7 : 0.55);
        }
        break;
      }
      case 'fingerpick': {
        // Travis-style: thumb alternating low voices on the beats, fingers on the off-beats; the
        // second variant adds a pinch on beat 3 and a hammer-on feel.
        const va = variant(2);
        for (let s = 0; s < len; s++) {
          if (s % 2 === 0) push(s0 + s, v[s % 4 === 0 ? 0 : 1]!, 2, s === 0 ? 1 : 0.85, 0.004);
          else push(s0 + s, v[(s >> 1) % 2 === 0 ? v.length - 1 : v.length - 2]!, 1.5, 0.62, 0.006);
          if (s === 0 || (va === 1 && s === 4)) push(s0 + s, v[v.length - 1]! + (va === 1 && s === 4 ? 12 : 0), 3, 0.66, 0.004);
        }
        break;
      }
      case 'strum': {
        // Island strum: D . D U . U D U (variant: D . D U D U . U)
        const pats: [number, boolean, number][][] = [
          [[0, false, 1], [2, false, 0.8], [3, true, 0.7], [5, true, 0.72], [6, false, 0.8], [7, true, 0.66]],
          [[0, false, 1], [2, false, 0.78], [3, true, 0.7], [4, false, 0.74], [5, true, 0.7], [7, true, 0.68]],
        ];
        for (const [s, up, vv] of pats[variant(2)]!) if (s < len) strum(s0 + s, v, vv, up, up ? 0.01 : 0.016, up ? 1 : 2);
        break;
      }
      case 'waltz': {
        for (const s of [2, 4]) if (s < len) strum(s0 + s, v, s === 2 ? 0.85 : 0.72, false, 0.008, 1.6);
        break;
      }
      case 'block': {
        v.forEach((p, k) => ev.push({ t: this.at(b, s0) + k * 0.018 + this.jit(0.004), track, inst, midi: p, dur: Math.min(len, cut - s0) * stepDur * 0.98, vel: cfg.vel * crescendo * (0.9 - k * 0.03) }));
        break;
      }
      case 'epComp': {
        // Lazy comping: a chord on 1, then one of a few syncopated re-hits.
        const va = variant(3);
        v.forEach((p, k) => ev.push({ t: this.at(b, s0) + k * 0.022, track, inst, midi: p, dur: len * stepDur * (va === 0 ? 0.62 : 0.4), vel: cfg.vel * crescendo * (0.85 - k * 0.04) }));
        const re = va === 0 ? len - 3 : va === 1 ? 3 : 5;
        if (len >= 6 && s0 + re < cut) v.slice(1).forEach((p, k) => ev.push({ t: this.at(b, s0 + re) + k * 0.018, track, inst, midi: p, dur: stepDur * 2.4, vel: cfg.vel * 0.55 }));
        break;
      }
      case 'oompah': {
        // 6/8 boom-chuck: chords on the last eighth of each dotted-quarter beat (variant: two per beat).
        const hits = variant(2) === 0 ? [2, 5] : [1, 2, 4, 5];
        for (const s of hits) if (s < len) strum(s0 + s, v, s === 2 || s === 5 ? 0.8 : 0.6, false, 0.006, 0.9);
        break;
      }
      case 'pizzOff': {
        // Off-beat pizzicato chords; the variant adds a low stab on 1 and a skip before beat 4.
        const va = variant(3);
        const hits = va === 0 ? [1, 3, 5, 7] : va === 1 ? [0, 3, 5, 6, 7] : [1, 2, 5, 7];
        for (const s of hits) {
          if (s >= len) continue;
          const notes = s === 0 ? v.slice(0, 2) : v.slice(0, 3);
          strum(s0 + s, notes, s === 0 ? 0.95 : s === 3 || s === 7 ? 0.85 : 0.72, false, 0.006, 0.8);
        }
        break;
      }
    }
  }

  private bass(ev: NoteEvent[], b: Bar, sp: Span, next: Chord | null, lastBar: boolean, run: boolean): void {
    const cfg = this.th.bass!;
    const r = this.rng;
    const [lo, hi] = cfg.range;
    const rootPc = (this.keyPc + sp.chord.root) % 12;
    // Voice-led: the new root lands near the last bass note (pulled gently back to the low register),
    // so I–IV–V–I walks by 4ths/5ths the short way instead of always jumping to the bottom.
    const home = lo + 5;
    const near = this.bassPrev ? this.bassPrev.b * 0.6 + home * 0.4 : home;
    const root = placeIn(rootPc, lo, hi, near);
    const fifth = root + 7 <= hi + 2 ? root + 7 : root - 5;
    // A written inversion (I/3, V/5) sounds that member on the downbeat instead of the root.
    const down = sp.chord.bass !== undefined ? placeIn((rootPc + sp.chord.bass) % 12, lo, hi + 2, root) : root;
    const len = sp.s1 - sp.s0;
    const stepDur = b.dur / this.S;
    const S = this.S;
    const doRun = run && cfg.pattern !== 'pedal' && !!next;
    const runLen = b.brk ? 3 : 2;
    const cut = doRun ? S - runLen : S;
    const push = (step: number, midi: number, steps: number, vel: number): void => {
      if (step >= cut) return;
      const m = cfg.pattern === 'pedal' ? midi : this.counterpoint(sp, step, midi, lo, hi);
      ev.push({ t: this.at(b, step) + this.jit(0.004), track: 'bass', inst: cfg.inst, midi: m, dur: Math.min(steps, cut - step) * stepDur * 0.92, vel: vel * cfg.vel * (0.95 + r.gauss(0.03)) });
    };
    const s0 = sp.s0;
    if (lastBar) {
      ev.push({ t: this.at(b, s0), track: 'bass', inst: cfg.inst, midi: root, dur: len * 1.5 * stepDur, vel: cfg.vel });
      this.bassPrev = { b: root, m: null };
      return;
    }
    const approach = (): number | null => {
      if (!next) return null;
      const nRoot = placeIn((this.keyPc + next.root) % 12, lo, hi, root);
      if (nRoot === root) return null;
      const scale = chordScale(sp.chord, this.keyPc, this.th.mode);
      return r.chance(0.5) ? nRoot + (nRoot > root ? -1 : 1) : scaleStep(nRoot, nRoot > root ? -1 : 1, scale);
    };
    if (b.brk) {
      // Stop-time: root hit, silence, then the run.
      push(s0, down, 1, 1);
    } else {
      switch (cfg.pattern) {
        case 'root':
          push(s0, down, len, 1);
          break;
        case 'pedal':
          if (s0 === 0) push(0, placeIn(this.keyPc, lo, hi, lo + 5), S, 0.9);
          break;
        case 'rootFifth': {
          const half = Math.floor(len / 2);
          push(s0, down, half, 1);
          if (len >= 4) {
            const ap = !doRun && r.chance(0.55) ? approach() : null;
            push(s0 + half, fifth, ap !== null ? half - 1 : half, 0.8);
            if (ap !== null) push(s0 + len - 1, ap, 1, 0.7);
          }
          break;
        }
        case 'walk': {
          const scale = chordScale(sp.chord, this.keyPc, this.th.mode);
          const third = nearestIn(root + 4, chordPcs(sp.chord, this.keyPc), 1);
          const line = [down, r.chance(0.5) ? third : fifth, fifth, approach() ?? scaleStep(root, 1, scale)];
          for (let q = 0; q * 2 < len; q++) push(s0 + q * 2, line[q % 4]!, 1.8, q === 0 ? 1 : 0.8);
          break;
        }
        case 'waltz':
          push(s0, down !== root ? down : b.i % 2 === 1 && r.chance(0.4) ? fifth : root, 2, 1);
          if (len >= 6 && r.chance(0.3)) push(s0 + 4, fifth, 2, 0.6);
          break;
        case 'jig':
          push(s0, down, 2, 1);
          if (len >= 6) push(s0 + 3, r.chance(0.7) ? fifth : root, 2, 0.8);
          break;
        case 'tresillo':
          push(s0, down, 3, 1);
          if (len >= 6) push(s0 + 3, root + 12 <= hi + 5 ? root + 12 : fifth, 1, 0.6);
          if (len >= 8) push(s0 + 6, approach() ?? fifth, 2, 0.8);
          break;
      }
    }
    if (doRun && next) {
      // Pickup run into the next chord's root, stepping through the scale.
      const nRoot = placeIn((this.keyPc + next.root) % 12, lo, hi, root);
      const scale = chordScale(sp.chord, this.keyPc, this.th.mode);
      const dir = nRoot >= root ? -1 : 1; // approach from below when rising
      const notes: number[] = [];
      for (let k = runLen; k >= 1; k--) notes.push(scaleStep(nRoot, dir * k, scale));
      notes.forEach((p, k) => {
        const st = S - runLen + k;
        const q = Math.max(lo - 2, Math.min(hi + 2, p));
        const over = this.melAt(st)?.midi;
        if (over !== undefined && (((over - q) % 12) + 12) % 12 === 1) return; // a passing note a b9 under the tune: leave the gap
        ev.push({ t: this.at(b, st) + this.jit(0.004), track: 'bass', inst: cfg.inst, midi: q, dur: stepDur * 0.9, vel: cfg.vel * (0.72 + 0.08 * k) });
        this.bassPrev = { b: q, m: this.melAt(st)?.midi ?? null };
      });
    }
  }

  /** The melody note sounding at `step` of the bar being arranged. */
  private melAt(step: number): MNote | undefined {
    let found: MNote | undefined;
    for (const n of this.barMel ?? []) if (n.step <= step + 0.01 && n.step + n.steps > step + 0.01) found = n;
    return found;
  }

  /**
   * Outer-voice counterpoint: a bass note that would move in parallel octaves / fifths with the tune
   * (same interval as the last bass note against the melody, both voices moving the same way) is
   * swapped for another chord member — usually the third, which turns the chord into a sweeter first
   * inversion — the way an arranger re-voices the bass under a melody that sits on the roots.
   */
  private counterpoint(sp: Span, step: number, midi: number, lo: number, hi: number): number {
    const m = this.melAt(step)?.midi ?? null;
    const prev = this.bassPrev;
    let out = midi;
    const mod = (x: number): number => ((x % 12) + 12) % 12;
    const parallelWith = (q: number): boolean => {
      if (m === null || !prev || prev.m === null || m === prev.m || q === prev.b) return false;
      const ic0 = mod(prev.m - prev.b);
      const ic1 = mod(m - q);
      return ic0 === ic1 && (ic1 === 0 || ic1 === 7) && Math.sign(m - prev.m) === Math.sign(q - prev.b);
    };
    const rootPc = (this.keyPc + sp.chord.root) % 12;
    // A passing / approach note a minor 9th under the tune bites; a root under a b9 is the tune's rub, not ours.
    const b9 = (q: number): boolean => m !== null && mod(m - q) === 1;
    if (parallelWith(midi) || (b9(midi) && mod(midi) !== rootPc)) {
      const pcs = chordPcs(sp.chord, this.keyPc);
      for (const pc of [pcs[1], pcs[2], pcs[0]]) {
        if (pc === undefined || pc === mod(midi)) continue;
        const q = placeIn(pc, lo - 1, hi + 2, prev ? prev.b : midi);
        if (m !== null && mod(m - q) === 0) continue; // never double the tune
        if (parallelWith(q) || b9(q)) continue;
        out = q;
        break;
      }
    }
    this.bassPrev = { b: out, m };
    return out;
  }

  /**
   * Counter-line. 'guide': 3rds / 7ths voice-led and held, with passing tones between chords.
   * 'moving': a cello-like line in half notes, stepwise where it can, moving against the melody.
   */
  private counter(ev: NoteEvent[], b: Bar, sp: Span, next: Chord | null, prev: number | null, mel: MNote[] | undefined): number {
    const cfg = this.th.counter!;
    const r = this.rng;
    const [lo, hi] = cfg.range;
    const pcs = chordPcs(sp.chord, this.keyPc);
    const guide = pcs.length > 3 ? [pcs[1]!, pcs[3]!] : [pcs[1]!, pcs[2]!];
    const len = sp.s1 - sp.s0;
    const stepDur = b.dur / this.S;
    const fit = (p: number): number => {
      while (p > hi) p -= 12;
      while (p < lo) p += 12;
      return p;
    };
    if (cfg.style === 'moving' && len >= 4) {
      const half = Math.floor(len / 2);
      let p = prev ?? Math.round((lo + hi) / 2);
      const scale = chordScale(sp.chord, this.keyPc, this.th.mode);
      for (let k = 0; k < 2; k++) {
        const st = sp.s0 + k * half;
        const mNote = mel?.find((n) => n.step <= st && n.step + n.steps > st) ?? mel?.find((n) => n.step >= st);
        const mNext = mel?.find((n) => n.step > st);
        const melDir = mNote && mNext ? Math.sign(mNext.midi - mNote.midi) : 0;
        let q: number;
        if (k === 0) q = nearestIn(p, guide.concat(pcs[0]!));
        else {
          // Step against the melody's direction, landing on a chord or passing tone.
          const dir = melDir !== 0 ? -melDir : (p > (lo + hi) / 2 ? -1 : 1);
          q = scaleStep(p, dir, scale);
          if (next && r.chance(0.5)) q = nearestIn(q, chordPcs(next, this.keyPc).concat(pcs), dir);
        }
        if (mNote && (mNote.midi - q) % 12 === 0) q = scaleStep(q, -1, scale);
        q = fit(q);
        ev.push({ t: this.at(b, st) + this.jit(0.01), track: 'counter', inst: cfg.inst, midi: q, dur: half * stepDur * 0.98, vel: 0.56 + (k === 0 ? 0.05 : 0) + r.gauss(0.03), o: Math.abs(q - p) <= 5 ? { art: 'legato', from: p } : undefined });
        p = q;
      }
      return p;
    }
    const ref = prev ?? Math.round((lo + hi) / 2);
    let p = nearestIn(ref, guide);
    const mNote = mel?.find((n) => n.step >= sp.s0 && n.step < sp.s1);
    if (mNote && (mNote.midi - p) % 12 === 0) p = nearestIn(p + 2, guide.concat(pcs[0]!), 1);
    p = fit(p);
    const t = this.at(b, sp.s0) + this.jit(0.01);
    let holdSteps = len;
    let passing: number | null = null;
    if (next && len >= 4 && r.chance(0.4)) {
      const np = nearestIn(p, chordPcs(next, this.keyPc));
      if (Math.abs(np - p) >= 3 && Math.abs(np - p) <= 4) {
        passing = scaleStep(p, np > p ? 1 : -1, chordScale(sp.chord, this.keyPc, this.th.mode));
        holdSteps = len - Math.max(1, Math.floor(len / 4));
      }
    }
    ev.push({ t, track: 'counter', inst: cfg.inst, midi: p, dur: holdSteps * stepDur * 0.98, vel: 0.58 + r.gauss(0.03), o: prev !== null && Math.abs(prev - p) <= 5 ? { art: 'legato' } : undefined });
    if (passing !== null) ev.push({ t: this.at(b, sp.s0 + holdSteps), track: 'counter', inst: cfg.inst, midi: passing, dur: (len - holdSteps) * stepDur, vel: 0.5, o: { art: 'legato' } });
    return passing ?? p;
  }

  private perc(ev: NoteEvent[], b: Bar): void {
    const cfg = this.th.perc!;
    const r = this.rng;
    const S = this.S;
    const crescendo = b.section === 'B' ? 0.94 + 0.12 * b.pos : this.isFinalA(b) ? 1.06 : 1;
    const hit = (step: number, inst: InstrumentName, vel: number, midi = 0, jitter = 0.004): void => {
      if (step >= S) return;
      ev.push({ t: this.at(b, step) + this.jit(jitter), track: 'perc', inst, midi, dur: 0.2, vel: vel * cfg.vel * crescendo * (0.92 + r.gauss(0.05)) });
    };
    // Drum fills: at 8-bar phrase ends, in the stop-time bar and into the final A.
    const bigFill = b.preFinal || b.brk;
    const fill = bigFill || (b.fill && b.i % 8 === 7);
    const groove = fill ? (bigFill ? S / 2 : S - 2) : S; // steps of normal groove before the fill
    const g = (step: number, inst: InstrumentName, vel: number, midi = 0): void => {
      if (step < groove && !(b.brk && step > 0)) hit(step, inst, vel, midi);
    };
    switch (cfg.pattern) {
      case 'shaker':
        for (let s = 0; s < S; s++) g(s, 'shaker', s % 2 === 0 ? 0.8 : 0.5);
        if (b.i % 2 === 0) g(0, 'softKick', 0.6);
        if (fill) {
          for (let s = groove; s < S; s += 0.5) hit(s, 'shaker', 0.45 + 0.4 * ((s - groove) / (S - groove)));
          hit(S - 2, 'softKick', 0.55);
          hit(S - 1, 'softKick', 0.7);
        }
        break;
      case 'light':
        for (let s = 1; s < S; s += 2) g(s, 'shaker', 0.55);
        if (b.i % 4 === 0) g(0, 'triangleDing', 0.5);
        if (fill) {
          for (let s = groove; s < S; s += 0.5) hit(s, 'shaker', 0.35 + 0.45 * ((s - groove) / (S - groove)));
          hit(S - 1, 'triangleDing', 0.45);
        }
        break;
      case 'island':
        for (let s = 0; s < S; s++) g(s, 'shaker', s % 2 === 0 ? 0.75 : 0.45);
        g(0, 'softKick', 0.7);
        g(3, 'conga', 0.7, 57);
        g(6, 'conga', 0.6, 52);
        if (fill) {
          const pitches = [64, 62, 59, 57, 55, 52, 52, 50];
          let k = 0;
          for (let s = groove; s < S; s += 1) hit(s, 'conga', 0.6 + 0.05 * k, pitches[k++ % pitches.length]);
          if (bigFill) for (let s = groove + 0.5; s < S; s += 1) hit(s, 'conga', 0.45, 57);
        }
        break;
      case 'jig':
        g(0, 'bodhran', 1);
        g(3, 'bodhran', 0.75);
        g(2, 'bodhran', 0.35);
        g(5, 'bodhran', 0.4);
        if (b.i % 2 === 1) {
          g(0, 'tambourine', 0.7);
          g(3, 'tambourine', 0.55);
        }
        if (b.i % 8 === 0) g(0, 'triangleDing', 0.6);
        if (fill) {
          for (let s = groove; s < S; s++) hit(s, 'bodhran', 0.5 + 0.1 * (s - groove));
          hit(S - 1, 'tambourine', 0.8);
          if (bigFill) hit(groove, 'tambourine', 0.6);
        }
        break;
      case 'town':
        for (let s = 0; s < S; s++) g(s, 'shaker', s % 2 === 0 ? 0.55 : 0.35);
        g(2, 'woodblock', 0.55, 79);
        g(6, 'woodblock', 0.5, 76);
        if (b.i % 2 === 1) g(0, 'softKick', 0.4);
        if (fill) {
          const pitches = [83, 79, 76, 79, 83, 86, 83, 79];
          let k = 0;
          for (let s = groove; s < S; s += bigFill ? 1 : 0.5) hit(s, 'woodblock', 0.45 + 0.05 * k, pitches[k++ % pitches.length]);
        }
        break;
      case 'sleigh':
        // Winter: a soft shake of sleigh bells on the beats, a triangle at phrase starts.
        for (let s = 0; s < S; s += 2) g(s, 'tambourine', s === 0 ? 0.5 : 0.32);
        for (let s = 1; s < S; s += 2) g(s, 'shaker', 0.28);
        if (b.i % 4 === 0) g(0, 'triangleDing', 0.45);
        if (fill) {
          for (let s = groove; s < S; s += 0.5) hit(s, 'tambourine', 0.25 + 0.35 * ((s - groove) / (S - groove)));
          hit(S - 1, 'triangleDing', 0.4);
        }
        break;
      case 'jazz':
        // Brushed kit, swung: ride "ding, ding-a ding", brushes on 2 and 4, a feathered kick.
        for (const [st, vv] of [[0, 0.7], [2, 0.85], [3, 0.5], [4, 0.7], [6, 0.85], [7, 0.5]] as const) g(st, 'ride', vv);
        g(2, 'brush', 0.7);
        g(6, 'brush', 0.75);
        g(0, 'softKick', 0.4);
        if (r.chance(0.4)) g(5, 'softKick', 0.3);
        if (fill) {
          for (let s = groove; s < S; s += 0.5) hit(s, 'brush', 0.4 + 0.35 * ((s - groove) / (S - groove)));
          hit(S - 1, 'ride', 0.9);
        }
        break;
      case 'lofi':
        g(0, 'softKick', 0.7);
        if (r.chance(0.5)) g(5, 'softKick', 0.45);
        g(4, 'brush', 0.75);
        for (let s = 1; s < S; s += 2) g(s, 'shaker', 0.3);
        if (fill) {
          for (let s = groove; s < S; s += 0.5) hit(s, 'brush', 0.4 + 0.3 * ((s - groove) / (S - groove)));
          hit(S - 1, 'softKick', 0.6);
        }
        break;
    }
  }

  // ───────────────────────────────────────────── ambient

  private composeAmbient(): Piece {
    const th = this.th;
    const a = th.ambient!;
    const r = this.rng;
    const ev: NoteEvent[] = [];
    const barDur = this.S * this.stepSec;
    const prog = [...th.prog.A];
    let padV: number[] | null = null;
    let t = 0.3;
    const barInfo: BarInfo[] = [];
    for (let i = 0; i < a.bars; i++) {
      const chord = this.chord(prog[i % prog.length]!.split(/\s+/)[0]!);
      const pcs = chordPcs(chord, this.keyPc);
      barInfo.push({ t, chords: chord.symbol, section: i === 0 ? 'A' : '', i, shift: 0 });
      if (i % 2 === 0 && th.bass) {
        ev.push({ t, track: 'bass', inst: th.bass.inst, midi: placeIn(pcs[0]!, th.bass.range[0], th.bass.range[1], th.bass.range[0] + 3), dur: barDur * 2.1, vel: th.bass.vel });
      }
      if (th.pad && i % 2 === 0 && r.chance(0.8)) {
        padV = voiceChord(chord, this.keyPc, th.pad.voices, th.pad.range[0], th.pad.range[1], padV);
        padV.forEach((p, k) => ev.push({ t: t + 0.2 + k * 0.3, track: 'pad', inst: th.pad!.inst, midi: p, dur: barDur * 2, vel: th.pad!.vel }));
      }
      const scale = chordScale(chord, this.keyPc, th.mode);
      if (a.motif && i % 4 === 1) {
        // The recurring figure (scale steps from the chord's 3rd): the one thing you remember down here.
        let p = nearestIn(Math.round((a.range[0] + a.range[1]) / 2), [pcs[1] ?? pcs[0]!]);
        let tt = t + barDur * 0.1;
        a.motif.forEach((mv, k) => {
          p = k === 0 ? p : scaleStep(p, mv, scale);
          ev.push({ t: tt, track: 'melody', inst: a.inst, midi: p, dur: 2, vel: 0.62 - k * 0.04 });
          tt += (k === a.motif!.length - 2 ? 1.6 : 0.8) * (60 / th.bpm);
        });
      } else if (r.chance(a.noteChance)) {
        const n = r.int(1, 3);
        let p = nearestIn(r.int(a.range[0], a.range[1]), pcs);
        let tt = t + r.range(0, barDur * 0.5);
        for (let k = 0; k < n; k++) {
          ev.push({ t: tt, track: 'melody', inst: a.inst, midi: p, dur: 2, vel: 0.5 + r.range(0, 0.25) });
          tt += r.pick([0.6, 0.9, 1.2]) * (60 / th.bpm);
          p = scaleStep(p, r.pick([-2, -1, 1, 2, 3]), scale);
          if (p > a.range[1]) p -= 12;
          if (p < a.range[0]) p += 12;
        }
      }
      if (th.counter && r.chance(0.3)) {
        const p = placeIn(pcs[r.int(0, pcs.length - 1)]!, th.counter.range[0], th.counter.range[1], (th.counter.range[0] + th.counter.range[1]) / 2);
        ev.push({ t: t + r.range(0.5, barDur * 0.5), track: 'counter', inst: th.counter.inst, midi: p, dur: barDur * 1.3, vel: 0.45 });
      }
      t += barDur;
    }
    ev.sort((x, y) => x.t - y.t);
    return { theme: th.id, seed: this.seed, events: ev, duration: t, bars: a.bars, barInfo };
  }
}

/**
 * First notes of a theme's tune (A, bars 1–n) for stingers and the now-playing card: MIDI, start
 * and length in beats, plus the raw step grid (eighths; triplet eighths in 6/8) and bar index.
 */
export function tuneHook(th: ThemeDef, bars = 2): { midi: number; beats: number; t: number; step: number; steps: number; bar: number }[] {
  if (!th.melody?.tune) return [];
  const c = new Composer(th, 1);
  const S = th.meter === '4/4' ? 8 : 6;
  const beat = th.meter === '6/8' ? 1 / 3 : 0.5;
  const out: { midi: number; beats: number; t: number; step: number; steps: number; bar: number }[] = [];
  for (let i = 0; i < bars; i++) for (const n of c.parseBar(th.melody.tune.A[i] ?? '', false)) out.push({ midi: n.midi, beats: n.steps * beat, t: (i * S + n.step) * beat, step: i * S + n.step, steps: n.steps, bar: i });
  return out;
}

function placeIn(pc: number, lo: number, hi: number, near: number): number {
  let best = lo;
  let bd = Infinity;
  for (let p = lo; p <= hi; p++) {
    if (((p % 12) + 12) % 12 !== pc) continue;
    const d = Math.abs(p - near);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function sameChords(a: Bar, b: Bar): boolean {
  return a.spans.length === b.spans.length && a.spans.every((s, i) => s.chord.symbol === b.spans[i]!.chord.symbol);
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[audio] ${msg}`);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
