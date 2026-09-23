/**
 * Generative composer: turns a ThemeDef + seed into a fully arranged piece (a list of timed note
 * events). It writes actual tunes rather than random notes:
 *
 *   form        intro · A · A' · B · A'' · outro (per theme), 8-bar periods
 *   melody      a seeded motif (rhythm cell + scale-step contour) developed per phrase position:
 *               statement → variation → sequence → half cadence | statement → variation → climax →
 *               authentic cadence. Strong beats land on chord tones, weak beats pass by step,
 *               leaps are gap-filled, a register arc peaks at bar 7, cadences are approached by step.
 *   harmony     roman-numeral progressions, chord-scales that adapt to borrowed chords,
 *               voice-led voicings (minimal motion) for accompaniment, pads and counter lines.
 *   texture     per-theme accompaniment patterns (arpeggios, Travis picking, island strum, waltz,
 *               oom-pah, marimba 3+3+2 ostinato ...), bass patterns with approach notes, percussion.
 *   arrangement layers enter/leave by section (counter-melody and percussion on the repeat, pad
 *               in B, octave doubling in the jig ...), phrase-level dynamics arcs, ritardandi at
 *               cadences and a fermata ending.
 *   humanise    timing jitter per role, metric accents, swing, strum spreads, grace notes.
 */
import { Rand } from './dsp';
import type { InstrumentName, NoteOpts } from './instruments';
import { chordPcs, chordScale, nearestIn, parseChord, scaleStep, voiceChord, type Chord, type ModeName } from './theory';

export type Meter = '4/4' | '3/4' | '6/8';
export type TrackName = 'melody' | 'double' | 'counter' | 'accomp' | 'accomp2' | 'bass' | 'pad' | 'perc';
export type Section = 'intro' | 'A' | 'B' | 'outro';
export type When = 'always' | 'repeat' | 'B' | 'late';
export type AccompPattern = 'arp8' | 'arpUp' | 'fingerpick' | 'strum' | 'waltz' | 'waltzArp' | 'block' | 'oompah' | 'ostinato332' | 'musicBox' | 'pizzOff' | 'epComp' | 'harpRoll';
export type BassPattern = 'root' | 'rootFifth' | 'walk' | 'waltz' | 'jig' | 'tresillo' | 'pedal';
export type PercPattern = 'shaker' | 'island' | 'jig' | 'town' | 'lofi' | 'light';

export interface TrackMix {
  gain: number;
  pan: number;
  /** Reverb send (0..1). */
  send: number;
}

export interface ThemeDef {
  id: string;
  title: string;
  bpm: number;
  meter: Meter;
  /** Tonic MIDI note (the melody register sits around here). */
  key: number;
  mode: ModeName;
  /** 0.5 = straight eighths; 0.58 = lilting swing. */
  swing?: number;
  form: Section[];
  prog: { A: string[]; B: string[]; intro?: string[]; outro?: string[] };
  melody?: {
    inst: InstrumentName;
    range: [number, number];
    /** 0 = long notes, 1 = busy. */
    density: number;
    legato?: boolean;
    staccato?: boolean;
    /** Grace-note probability on long strong notes. */
    ornament?: number;
    bInst?: InstrumentName;
    octaveOnRepeat?: boolean;
    double?: { inst: InstrumentName; interval: number; on: When };
  };
  counter?: { inst: InstrumentName; range: [number, number]; on: When };
  accomp?: { inst: InstrumentName; pattern: AccompPattern; range: [number, number]; voices: 3 | 4; vel: number; on?: When };
  accomp2?: { inst: InstrumentName; pattern: AccompPattern; range: [number, number]; voices: 3 | 4; vel: number; on?: When };
  bass?: { inst: InstrumentName; pattern: BassPattern; range: [number, number]; vel: number };
  pad?: { inst: InstrumentName; range: [number, number]; voices: 3 | 4; vel: number; on: When };
  perc?: { pattern: PercPattern; on: When; vel: number };
  /** Sparse ambient generation instead of a song form (mine). */
  ambient?: { inst: InstrumentName; range: [number, number]; noteChance: number; bars: number };
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

export interface Piece {
  theme: string;
  seed: number;
  events: NoteEvent[];
  /** Musical length in seconds (tails ring beyond). */
  duration: number;
  bars: number;
  /** Bar start times + chord symbols (for plots / debugging). */
  barInfo?: { t: number; chords: string; section: string }[];
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
}
interface MNote {
  step: number;
  steps: number;
  midi: number;
  vel: number;
  grace?: number;
}

const CELLS: Record<Meter, { normal: number[][]; slow: number[][]; cadence: number[][] }> = {
  '4/4': {
    normal: [[2, 2, 2, 2], [3, 1, 2, 2], [2, 1, 1, 2, 2], [2, 2, 4], [4, 2, 2], [1, 1, 2, 4], [3, 1, 4], [2, 2, 1, 1, 2], [2, 4, 2], [1, 1, 1, 1, 2, 2], [3, 3, 2]],
    slow: [[4, 4], [6, 2], [2, 2, 4], [8], [4, 2, 2], [3, 1, 4], [2, 6]],
    cadence: [[2, 2, 3, -1], [4, 3, -1], [6, -2], [2, 5, -1], [3, 1, 3, -1], [1, 1, 2, 3, -1]],
  },
  '3/4': {
    normal: [[2, 2, 2], [3, 1, 2], [4, 2], [2, 1, 1, 2], [1, 1, 2, 2], [2, 4]],
    slow: [[6], [4, 2], [2, 4], [3, 1, 2]],
    cadence: [[2, 3, -1], [5, -1], [4, 2], [1, 1, 3, -1]],
  },
  '6/8': {
    // Jigs live on running triplet quavers: weight the busy cells.
    normal: [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1], [1, 1, 1, 2, 1], [2, 1, 2, 1], [1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1], [1, 1, 1, 3]],
    slow: [[3, 3], [2, 1, 3], [6]],
    cadence: [[2, 1, 3], [1, 1, 1, 3], [3, 2, -1], [2, 1, 2, -1]],
  },
};

const MOVES: [number, number][] = [
  [1, 3], [-1, 3.2], [2, 1.5], [-2, 1.6], [0, 0.25], [3, 0.6], [-3, 0.55], [4, 0.3], [-4, 0.2],
];

export class Composer {
  private rng: Rand;
  private keyPc: number;
  private S: number;
  private stepSec: number;
  private chordCache = new Map<string, Chord>();

  constructor(private th: ThemeDef, readonly seed: number) {
    this.rng = new Rand(seed * 7919 + hash(th.id));
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
    th.form.forEach((sec, si) => {
      const o = (occ[sec] = (occ[sec] ?? -1) + 1);
      const prog = sec === 'intro' ? th.prog.intro ?? [th.prog.A[0]!, th.prog.A[0]!] : sec === 'outro' ? th.prog.outro ?? ['IV', 'I'] : th.prog[sec];
      prog.forEach((entry, i) => {
        const syms = entry.split(/\s+/).filter(Boolean);
        const spans: Span[] = syms.map((s, k) => ({ chord: this.chord(s), s0: Math.round((k * this.S) / syms.length), s1: Math.round(((k + 1) * this.S) / syms.length) }));
        // Rubato: phrase ends breathe, the final cadence and outro broaden.
        let scale = 1;
        if (sec !== 'intro' && sec !== 'outro' && (i % 4) === 3) scale = 1.025;
        if (si === lastA && i === prog.length - 1) scale = 1.05;
        if (sec === 'outro') scale = i === prog.length - 1 ? 1.25 : 1.1;
        const dur = this.S * this.stepSec * scale;
        bars.push({ section: sec, occ: o, i, len: prog.length, spans, t0: t, dur });
        t += dur;
      });
    });
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

    // Motifs: one for A (shared by every A so it is recognisable), one for B.
    const motifA = this.genMotif();
    const motifB = this.genMotif(true);
    const melodyBySection = new Map<string, MNote[][]>();

    // ── melody
    if (th.melody) {
      const m = th.melody;
      const lastA = th.form.lastIndexOf('A');
      let prev: number | null = null;
      const groups: Bar[][] = [];
      for (const b of bars) {
        const g = groups[groups.length - 1];
        if (g && g[0]!.section === b.section && g[0]!.occ === b.occ) g.push(b);
        else groups.push([b]);
      }
      for (let si = 0; si < groups.length; si++) {
        const secBars = groups[si]!;
        const sec = secBars[0]!.section;
        if (sec === 'intro') continue;
        if (sec === 'outro') {
          // Final tonic, held.
          const b = secBars[secBars.length - 1]!;
          const tonic = nearestIn(prev ?? th.key, [this.keyPc]);
          ev.push({ t: b.t0 + this.jit(0.006), track: 'melody', inst: m.inst, midi: tonic, dur: b.dur * 0.95, vel: 0.62, o: { art: m.legato ? 'legato' : undefined } });
          continue;
        }
        const motif = sec === 'A' ? motifA : motifB;
        const next = th.form[si + 1];
        const notes = this.genSection(secBars, motif, prev, sec, secBars[0]!.occ, si === lastA, next);
        melodyBySection.set(`${sec}${secBars[0]!.occ}`, notes);
        const inst = sec === 'B' && m.bInst ? m.bInst : m.inst;
        const oct = m.octaveOnRepeat && sec === 'A' && secBars[0]!.occ > 0 ? 12 : 0;
        let last: number | undefined;
        secBars.forEach((b, bi) => {
          const bn = notes[bi]!;
          bn.forEach((n, ni) => {
            const t = this.at(b, n.step) + this.jit(0.007);
            const dur = (n.steps / this.S) * b.dur * (m.staccato ? 0.55 : m.legato ? 0.97 : 0.85);
            const nextN = bn[ni + 1];
            const tied = m.legato && nextN && nextN.step === n.step + n.steps;
            const o: NoteOpts = {};
            if (m.legato && last !== undefined && Math.abs(n.midi + oct - last) <= 7) o.art = 'legato';
            if (!m.legato && n.steps >= 4 && inst === 'marimba') o.art = 'roll';
            if (m.staccato) o.art = 'staccato';
            if ((inst === 'fiddle' || inst === 'cello') && o.art === 'legato' && r.chance(0.18) && last !== undefined) o.from = last;
            if (n.grace !== undefined) {
              const gd = inst === 'fiddle' ? 0.03 : 0.05;
              ev.push({ t: t - gd, track: 'melody', inst, midi: n.grace + oct, dur: gd, vel: n.vel * 0.55 });
            }
            ev.push({ t, track: 'melody', inst, midi: n.midi + oct, dur: tied ? dur * 1.03 : dur, vel: n.vel, o });
            last = n.midi + oct;
            if (m.double && this.active(m.double.on, b)) {
              ev.push({ t: t + 0.004, track: 'double', inst: m.double.inst, midi: n.midi + oct + m.double.interval, dur, vel: n.vel * 0.7, o: { art: o.art } });
            }
          });
        });
        const lastBar = notes[notes.length - 1];
        const lastNote = lastBar?.[lastBar.length - 1];
        if (lastNote) prev = lastNote.midi;
      }
    }

    // ── harmony layers
    let accV: number[] | null = null;
    let acc2V: number[] | null = null;
    let padV: number[] | null = null;
    let cntPrev: number | null = null;
    bars.forEach((b, bi) => {
      const nextBar = bars[bi + 1];
      const isIntro = b.section === 'intro';
      const isOutro = b.section === 'outro';
      const lastBar = bi === bars.length - 1;
      b.spans.forEach((sp, si) => {
        const nextChord = b.spans[si + 1]?.chord ?? nextBar?.spans[0]!.chord ?? null;
        if (th.accomp && (th.accomp.on === undefined || isIntro || isOutro || this.active(th.accomp.on, b))) {
          accV = voiceChord(sp.chord, this.keyPc, th.accomp.voices, th.accomp.range[0], th.accomp.range[1], accV);
          this.accomp(ev, 'accomp', th.accomp, b, sp, accV, lastBar);
        }
        if (th.accomp2 && !isIntro && (th.accomp2.on === undefined || this.active(th.accomp2.on, b))) {
          acc2V = voiceChord(sp.chord, this.keyPc, th.accomp2.voices, th.accomp2.range[0], th.accomp2.range[1], acc2V);
          this.accomp(ev, 'accomp2', th.accomp2, b, sp, acc2V, lastBar);
        }
        if (th.pad && (this.active(th.pad.on, b) || (th.pad.on === 'always' && (isIntro || isOutro)) || (isOutro && th.pad.on !== 'B'))) {
          padV = voiceChord(sp.chord, this.keyPc, th.pad.voices, th.pad.range[0], th.pad.range[1], padV);
          const t = this.at(b, sp.s0);
          const dur = ((sp.s1 - sp.s0) / this.S) * b.dur * (lastBar ? 1.6 : 1.02);
          padV.forEach((p, k) => ev.push({ t: t + k * 0.012, track: 'pad', inst: th.pad!.inst, midi: p, dur, vel: th.pad!.vel * (0.9 + 0.1 * Math.sin(bi * 0.7)) }));
        }
        if (th.bass && !(isIntro && b.i === 0 && th.prog.intro === undefined)) this.bass(ev, b, sp, nextChord, lastBar);
        if (th.counter && this.active(th.counter.on, b)) {
          const mel = melodyBySection.get(`${b.section}${b.occ}`)?.[b.i];
          cntPrev = this.counter(ev, b, sp, nextChord, cntPrev, mel);
        }
      });
      if (th.perc && (this.active(th.perc.on, b) || (th.perc.on === 'always' && isIntro && b.i > 0))) this.perc(ev, b, bi);
    });

    ev.sort((a, b) => a.t - b.t);
    const lastBar = bars[bars.length - 1]!;
    const barInfo = bars.map((b) => ({ t: b.t0, chords: b.spans.map((sp) => sp.chord.symbol).join(' '), section: b.i === 0 ? b.section : '' }));
    return { theme: th.id, seed: this.seed, events: ev, duration: lastBar.t0 + lastBar.dur, bars: bars.length, barInfo };
  }

  private jit(sigma: number): number {
    return this.rng.gauss(sigma);
  }

  private genMotif(isB = false): { cells: number[][]; moves: number[][] } {
    const r = this.rng;
    const lib = CELLS[this.th.meter];
    const density = this.th.melody?.density ?? 0.5;
    const pickCell = (): number[] => {
      const slow = r.next() > density;
      const pool = slow ? lib.slow : lib.normal;
      // B sections lean lyrical (longer notes).
      if (isB && density < 0.85 && r.chance(0.4)) return r.pick(lib.slow);
      return r.pick(pool);
    };
    const c0 = pickCell();
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
        // Momentum: melodies keep going the same way for a bit.
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

  /** Melody for one section (list of bars → notes). */
  private genSection(bars: Bar[], motif: { cells: number[][]; moves: number[][] }, prevIn: number | null, sec: Section, occ: number, finalA: boolean, next: Section | undefined): MNote[][] {
    const th = this.th;
    const m = th.melody!;
    const r = this.rng;
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
      // Consequent phrase: bar 7 (index 6) is the climax, new material.
      if (bi % 8 === 6) {
        cell = CELLS[th.meter].normal[(this.seed + bi + occ) % CELLS[th.meter].normal.length]!;
        moves = cell.map((_, i) => (i === 0 ? 2 : i === 1 ? 1 : r.chance(0.6) ? -1 : 1));
      }
      // Variation on repeats: sometimes swap a cell for a denser relative.
      if (occ > 0 && !phraseEnd && pos !== 0 && r.chance(0.35)) {
        cell = r.pick(CELLS[th.meter].normal);
        moves = cell.map((_, i) => (i === 0 ? motif.moves[pos]![0]! : r.weighted(MOVES)));
      }
      const target = center + (arc[bi % 8] ?? 0);
      // Cadence target.
      let targetPcs: number[] | null = null;
      if (phraseEnd) {
        const sp = b.spans[b.spans.length - 1]!;
        const pcs = chordPcs(sp.chord, this.keyPc);
        if (lastOfSection && sec === 'A' && (bi % 8 === 7 || finalA)) targetPcs = [this.keyPc];
        else if (lastOfSection && next === 'A') targetPcs = [pcs[1]!, pcs[0]!]; // lead back in
        else if (bi % 8 === 7) targetPcs = [this.keyPc, (this.keyPc + (th.mode === 'major' || th.mode === 'lydian' || th.mode === 'mixolydian' ? 4 : 3)) % 12];
        else targetPcs = pcs.slice(1); // half cadence: 3rd/5th of the chord, not the root
        if (targetPcs.every((pc) => !pcs.includes(pc))) targetPcs = pcs; // never end on a clash
      }
      // Restate the opening bar exactly at the start of the consequent phrase.
      if (bi % 8 === 4 && firstBarNotes.length && sameChords(b, bars[bi - 4]!)) {
        const copy = firstBarNotes.map((n) => ({ ...n, vel: n.vel * 1.03 }));
        out.push(copy);
        prev = copy[copy.length - 1]!.midi;
        return;
      }
      const notes = this.realizeBar(b, cell, moves, prev, target, lo, hi, targetPcs);
      // Phrase dynamics: swell toward bar 7, relax at cadences.
      const phraseArc = 0.84 + 0.16 * Math.sin((Math.PI * ((bi % 8) + 0.5)) / 8);
      for (const n of notes) {
        n.vel *= phraseArc * (sec === 'B' ? 1.05 : 1) * (occ > 0 ? 1.03 : 1);
        if ((m.ornament ?? 0) > 0 && n.steps >= 3 && this.strength(n.step) >= 0.8 && r.chance(m.ornament!)) {
          const sp = this.spanAt(b, n.step);
          n.grace = scaleStep(n.midi, 1, chordScale(sp.chord, this.keyPc, th.mode));
        }
      }
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
      // Gap-fill: after a leap, step back the other way.
      if (Math.abs(prevMove) >= 3) mv = -Math.sign(prevMove) * 1;
      // Register pull toward the phrase arc target.
      if (prev < target - 4 && mv < 0) mv = -mv;
      if (prev > target + 4 && mv > 0) mv = -mv;
      let p = scaleStep(prev, mv, scale);
      const strong = this.strength(step) >= 0.8 || d >= 3;
      if (strong) p = nearestIn(p, tones, mv);
      else if (d >= 2) {
        // Long weak note: avoid a half-step rub against the harmony.
        const pc = ((p % 12) + 12) % 12;
        if (tones.some((t) => Math.abs(t - pc) === 1 || Math.abs(t - pc) === 11)) p = nearestIn(p, tones, mv);
      }
      // Keep the line moving: an intended step must not collapse into a repeated note.
      if (p === prev && mv !== 0) {
        const dir = Math.sign(mv);
        p = strong ? nearestIn(prev + dir * 2, tones, dir) : scaleStep(prev, dir, scale);
        if (p === prev) p = scaleStep(prev, dir, scale);
      }
      if (i === lastIdx && targetPcs) {
        p = nearestIn(p, targetPcs, mv);
        // Approach the cadence note by step.
        const pen = notes[notes.length - 1];
        if (pen && Math.abs(pen.midi - p) > 4) {
          pen.midi = scaleStep(p, pen.midi > p ? 1 : -1, chordScale(this.spanAt(b, pen.step).chord, this.keyPc, this.th.mode));
        }
      }
      while (p > hi) p -= 12;
      while (p < lo) p += 12;
      if (Math.abs(p - prev) > 9) p += p > prev ? -12 : 12;
      if (p > hi || p < lo) p = nearestIn(target, tones);
      const vel = 0.62 + 0.24 * this.strength(step) + this.rng.gauss(0.035);
      notes.push({ step, steps: d, midi: p, vel });
      prevMove = p === prev ? 0 : Math.round((p - prev) / 2);
      prev = p;
      step += d;
    });
    return notes;
  }

  // ───────────────────────────────────────────── accompaniment

  private accomp(ev: NoteEvent[], track: TrackName, cfg: NonNullable<ThemeDef['accomp']>, b: Bar, sp: Span, v: number[], lastBar: boolean): void {
    const r = this.rng;
    const len = sp.s1 - sp.s0;
    const stepDur = b.dur / this.S;
    const inst = cfg.inst;
    const V = [...v, v[0]! + 12, v[1]! + 12];
    const push = (step: number, midi: number, steps: number, vel: number, jitter = 0.005, o?: NoteOpts): void => {
      if (step >= sp.s1) return;
      ev.push({ t: this.at(b, step) + this.jit(jitter), track, inst, midi, dur: steps * stepDur * 0.95, vel: vel * cfg.vel * (0.95 + r.gauss(0.04)), o });
    };
    const strum = (step: number, notes: number[], vel: number, up: boolean, spread = 0.014, steps = 2): void => {
      const order = up ? [...notes].reverse().slice(0, 3) : notes;
      const t = this.at(b, step);
      order.forEach((p, k) => ev.push({ t: t + k * spread + this.jit(0.003), track, inst, midi: p, dur: steps * stepDur, vel: vel * cfg.vel * (up ? 0.7 : 1) * (1 - k * 0.04) }));
    };
    const s0 = sp.s0;
    if (lastBar) {
      // Final chord: a slow roll up the voicing, ringing.
      v.forEach((p, k) => ev.push({ t: this.at(b, 0) + k * 0.09, track, inst, midi: p, dur: b.dur * 1.4, vel: cfg.vel * (0.85 - k * 0.05) }));
      return;
    }
    switch (cfg.pattern) {
      case 'arp8': {
        const shape = [0, 1, 2, 3, 4, 3, 2, 1];
        for (let s = 0; s < len; s++) push(s0 + s, V[Math.min(shape[s % 8]!, V.length - 1)]!, 1.8, s % 2 === 0 ? 0.9 : 0.7);
        break;
      }
      case 'arpUp': {
        const shape = [0, 1, 2, 3, 4, 5, 4, 3];
        for (let s = 0; s < len; s++) push(s0 + s, V[Math.min(shape[s % 8]!, V.length - 1)]!, 2.5, s === 0 ? 1 : 0.72);
        break;
      }
      case 'harpRoll': {
        // Rolled chord on the downbeat + a gentle upper arpeggio on the second half.
        V.slice(0, 4).forEach((p, k) => ev.push({ t: this.at(b, s0) + k * 0.05, track, inst, midi: p, dur: len * stepDur, vel: cfg.vel * (0.9 - k * 0.06) }));
        if (len >= 4) for (let s = Math.floor(len / 2); s < len; s++) push(s0 + s, V[(s % 3) + 2]!, 2, 0.6);
        break;
      }
      case 'fingerpick': {
        // Travis-style: thumb on beats alternating low voices, fingers on the off-beats.
        for (let s = 0; s < len; s++) {
          if (s % 2 === 0) push(s0 + s, v[s % 4 === 0 ? 0 : 1]!, 2, s === 0 ? 1 : 0.85, 0.004);
          else push(s0 + s, v[(s >> 1) % 2 === 0 ? v.length - 1 : v.length - 2]!, 1.5, 0.62, 0.006);
          if (s === 0) push(s0, v[v.length - 1]! + (r.chance(0.3) ? 0 : 0), 3, 0.7, 0.004);
        }
        break;
      }
      case 'strum': {
        // Island strum: D . D U . U D U
        const pat: [number, boolean, number][] = [[0, false, 1], [2, false, 0.8], [3, true, 0.7], [5, true, 0.72], [6, false, 0.8], [7, true, 0.66]];
        for (const [s, up, vv] of pat) if (s < len) strum(s0 + s, v, vv, up, up ? 0.01 : 0.016, up ? 1 : 2);
        break;
      }
      case 'waltz': {
        for (const s of [2, 4]) if (s < len) strum(s0 + s, v, s === 2 ? 0.85 : 0.72, false, 0.008, 1.6);
        break;
      }
      case 'waltzArp': {
        const shape = [0, 1, 2, 3, 2, 1];
        for (let s = 0; s < len; s++) push(s0 + s, V[shape[s % 6]!]!, 2, s === 0 ? 0.95 : 0.7);
        break;
      }
      case 'musicBox': {
        const shape = [0, 2, 1, 3, 2, 4];
        for (let s = 0; s < len; s++) push(s0 + s, V[Math.min(shape[s % 6]!, V.length - 1)]!, 2, s === 0 ? 0.9 : 0.62, 0.008);
        break;
      }
      case 'block': {
        v.forEach((p, k) => ev.push({ t: this.at(b, s0) + k * 0.018 + this.jit(0.004), track, inst, midi: p, dur: len * stepDur * 0.98, vel: cfg.vel * (0.9 - k * 0.03) }));
        break;
      }
      case 'epComp': {
        v.forEach((p, k) => ev.push({ t: this.at(b, s0) + k * 0.022, track, inst, midi: p, dur: len * stepDur * 0.62, vel: cfg.vel * (0.85 - k * 0.04) }));
        if (len >= 6 && r.chance(0.55)) v.slice(1).forEach((p, k) => ev.push({ t: this.at(b, s0 + len - 3) + k * 0.018, track, inst, midi: p, dur: stepDur * 2.6, vel: cfg.vel * 0.55 }));
        break;
      }
      case 'oompah': {
        // 6/8 boom-chuck: chords on the last eighth of each dotted-quarter beat.
        for (const s of [2, 5]) if (s < len) strum(s0 + s, v, s === 2 ? 0.8 : 0.72, false, 0.006, 0.9);
        break;
      }
      case 'ostinato332': {
        const shape = [0, 2, 1, 2, 3, 2, 1, 2];
        for (let s = 0; s < len; s++) {
          const accent = s === 0 || s === 3 || s === 6;
          push(s0 + s, V[shape[s % 8]!]!, 1, accent ? 0.95 : 0.6, 0.004);
        }
        break;
      }
      case 'pizzOff': {
        for (let s = 1; s < len; s += 2) strum(s0 + s, v.slice(0, 3), s === 3 || s === 7 ? 0.85 : 0.72, false, 0.006, 0.8);
        break;
      }
    }
  }

  private bass(ev: NoteEvent[], b: Bar, sp: Span, next: Chord | null, lastBar: boolean): void {
    const cfg = this.th.bass!;
    const r = this.rng;
    const [lo, hi] = cfg.range;
    const rootPc = (this.keyPc + sp.chord.root) % 12;
    const root = placeIn(rootPc, lo, hi, lo + 5);
    const fifth = root + 7 <= hi + 2 ? root + 7 : root - 5;
    const len = sp.s1 - sp.s0;
    const stepDur = b.dur / this.S;
    const push = (step: number, midi: number, steps: number, vel: number): void => {
      ev.push({ t: this.at(b, step) + this.jit(0.004), track: 'bass', inst: cfg.inst, midi, dur: steps * stepDur * 0.92, vel: vel * cfg.vel * (0.95 + r.gauss(0.03)) });
    };
    const s0 = sp.s0;
    if (lastBar) {
      push(s0, root, len * 1.5, 1);
      return;
    }
    const approach = (): number | null => {
      if (!next) return null;
      const nRoot = placeIn((this.keyPc + next.root) % 12, lo, hi, root);
      if (nRoot === root) return null;
      const scale = chordScale(sp.chord, this.keyPc, this.th.mode);
      return r.chance(0.5) ? nRoot + (nRoot > root ? -1 : 1) : scaleStep(nRoot, nRoot > root ? -1 : 1, scale);
    };
    switch (cfg.pattern) {
      case 'root':
        push(s0, root, len, 1);
        break;
      case 'pedal':
        if (s0 === 0) push(0, placeIn(this.keyPc, lo, hi, lo + 5), this.S, 0.9);
        break;
      case 'rootFifth': {
        const half = Math.floor(len / 2);
        push(s0, root, half, 1);
        if (len >= 4) {
          const ap = r.chance(0.55) ? approach() : null;
          push(s0 + half, fifth, ap !== null ? half - 1 : half, 0.8);
          if (ap !== null) push(s0 + len - 1, ap, 1, 0.7);
        }
        break;
      }
      case 'walk': {
        const scale = chordScale(sp.chord, this.keyPc, this.th.mode);
        const third = nearestIn(root + 4, chordPcs(sp.chord, this.keyPc), 1);
        const line = [root, r.chance(0.5) ? third : fifth, fifth, approach() ?? scaleStep(root, 1, scale)];
        for (let q = 0; q * 2 < len; q++) push(s0 + q * 2, line[q % 4]!, 1.8, q === 0 ? 1 : 0.8);
        break;
      }
      case 'waltz':
        push(s0, b.i % 2 === 1 && r.chance(0.4) ? fifth : root, 2, 1);
        if (len >= 6 && r.chance(0.25)) push(s0 + 4, fifth, 2, 0.6);
        break;
      case 'jig':
        push(s0, root, 2, 1);
        if (len >= 6) push(s0 + 3, r.chance(0.7) ? fifth : root, 2, 0.8);
        break;
      case 'tresillo':
        push(s0, root, 3, 1);
        if (len >= 6) push(s0 + 3, root + 12 <= hi + 5 ? root + 12 : fifth, 1, 0.6);
        if (len >= 8) push(s0 + 6, approach() ?? fifth, 2, 0.8);
        break;
    }
  }

  /** Guide-tone counter-line: 3rds / 7ths voice-led, held, with passing tones between chords. */
  private counter(ev: NoteEvent[], b: Bar, sp: Span, next: Chord | null, prev: number | null, mel: MNote[] | undefined): number {
    const cfg = this.th.counter!;
    const r = this.rng;
    const [lo, hi] = cfg.range;
    const pcs = chordPcs(sp.chord, this.keyPc);
    const guide = pcs.length > 3 ? [pcs[1]!, pcs[3]!] : [pcs[1]!, pcs[2]!];
    const ref = prev ?? Math.round((lo + hi) / 2);
    let p = nearestIn(ref, guide);
    // Don't double the melody's pitch class on the downbeat.
    const mNote = mel?.find((n) => n.step >= sp.s0 && n.step < sp.s1);
    if (mNote && ((mNote.midi - p) % 12 === 0)) p = nearestIn(p + 2, guide.concat(pcs[0]!), 1);
    while (p > hi) p -= 12;
    while (p < lo) p += 12;
    const len = sp.s1 - sp.s0;
    const stepDur = b.dur / this.S;
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

  private perc(ev: NoteEvent[], b: Bar, bi: number): void {
    const cfg = this.th.perc!;
    const r = this.rng;
    const hit = (step: number, inst: InstrumentName, vel: number, midi = 0, jitter = 0.004): void => {
      if (step >= this.S) return;
      ev.push({ t: this.at(b, step) + this.jit(jitter), track: 'perc', inst, midi, dur: 0.2, vel: vel * cfg.vel * (0.92 + r.gauss(0.05)) });
    };
    const lastInPhrase = b.i % 4 === 3;
    switch (cfg.pattern) {
      case 'shaker':
        for (let s = 0; s < this.S; s++) hit(s, 'shaker', s % 2 === 0 ? 0.8 : 0.5);
        if (b.i % 2 === 0) hit(0, 'softKick', 0.6);
        break;
      case 'light':
        for (let s = 1; s < this.S; s += 2) hit(s, 'shaker', 0.55);
        if (b.i % 4 === 0) hit(0, 'triangleDing', 0.5);
        break;
      case 'island':
        for (let s = 0; s < this.S; s++) hit(s, 'shaker', s % 2 === 0 ? 0.75 : 0.45);
        hit(0, 'softKick', 0.7);
        hit(3, 'conga', 0.7, 57);
        hit(6, 'conga', 0.6, 52);
        if (lastInPhrase) hit(7, 'conga', 0.5, 57);
        break;
      case 'jig':
        hit(0, 'bodhran', 1);
        hit(3, 'bodhran', 0.75);
        hit(2, 'bodhran', 0.35);
        hit(5, 'bodhran', 0.4);
        if (b.i % 2 === 1) {
          hit(0, 'tambourine', 0.7);
          hit(3, 'tambourine', 0.55);
        }
        if (b.i % 8 === 0) hit(0, 'triangleDing', 0.6);
        break;
      case 'town':
        for (let s = 0; s < this.S; s++) hit(s, 'shaker', s % 2 === 0 ? 0.55 : 0.35);
        hit(2, 'woodblock', 0.55, 79);
        hit(6, 'woodblock', 0.5, 76);
        if (lastInPhrase) hit(7, 'woodblock', 0.4, 83);
        break;
      case 'lofi':
        hit(0, 'softKick', 0.7);
        if (r.chance(0.5)) hit(5, 'softKick', 0.45);
        hit(4, 'brush', 0.75);
        for (let s = 1; s < this.S; s += 2) hit(s, 'shaker', 0.3);
        break;
    }
    void bi;
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
    for (let i = 0; i < a.bars; i++) {
      const chord = this.chord(prog[i % prog.length]!.split(/\s+/)[0]!);
      const pcs = chordPcs(chord, this.keyPc);
      if (i % 2 === 0 && th.bass) {
        ev.push({ t, track: 'bass', inst: th.bass.inst, midi: placeIn(pcs[0]!, th.bass.range[0], th.bass.range[1], th.bass.range[0] + 3), dur: barDur * 2.1, vel: th.bass.vel });
      }
      if (th.pad && (i % 2 === 0) && r.chance(0.8)) {
        padV = voiceChord(chord, this.keyPc, th.pad.voices, th.pad.range[0], th.pad.range[1], padV);
        padV.forEach((p, k) => ev.push({ t: t + 0.2 + k * 0.3, track: 'pad', inst: th.pad!.inst, midi: p, dur: barDur * 2, vel: th.pad!.vel }));
      }
      if (r.chance(a.noteChance)) {
        const scale = chordScale(chord, this.keyPc, th.mode);
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
    return { theme: th.id, seed: this.seed, events: ev, duration: t, bars: a.bars };
  }
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

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
