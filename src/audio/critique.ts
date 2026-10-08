/**
 * Symbolic composition critic: reads a composed Piece (no audio) and measures what a harsh
 * music editor would listen for, so the score can be judged without speakers:
 *
 *   melody     range, stepwise vs leaping motion, leaps left unrecovered (a leap of a 4th+ should
 *              turn back by step), repeated-pitch share, chord tones on strong beats
 *   harmony    melody notes a semitone / minor 9th against a note that is actually sounding in the
 *              accompaniment, bass, pad or counter-line — split into appoggiaturas (resolve by step
 *              to a chord tone: expressive, fine) and real clashes (unresolved rubs; b9 over the bass
 *              is the worst)
 *   outer voices  parallel octaves / fifths between melody and bass
 *   cadences   the scale degree each A / B section ends on (the final A must land on the tonic)
 *   texture    peak / mean polyphony, notes per second per track
 *
 * Driven by `node scripts/audio-render.mjs --compose` (also printed before every theme render).
 */
import { Composer, type NoteEvent, type Piece, type ThemeDef } from './composer';
import { THEMES } from './themes';
import { chordPcs, parseChord } from './theory';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nm = (m: number): string => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const HARMONY_TRACKS = new Set(['accomp', 'accomp2', 'pad', 'bass', 'counter']);
/** Plucked / struck parts: the written duration is the ring, the ear hears the first ~0.35 s. */
const DECAYING = new Set(['kalimba', 'harp', 'guitar', 'ukulele', 'marimba', 'pizz', 'celesta', 'musicBox', 'bell', 'glass', 'steelPan']);

export interface Rub {
  t: number;
  bar: number;
  section: string;
  melody: string;
  against: string;
  track: string;
  kind: 'b9-bass' | 'clash' | 'appoggiatura';
}

export interface Critique {
  theme: string;
  title: string;
  seconds: number;
  bars: number;
  melody: {
    notes: number;
    lo: string;
    hi: string;
    rangeSemis: number;
    stepPct: number;
    leapPct: number;
    maxLeap: number;
    unrecoveredLeaps: number;
    leaps: number;
    /** Where the unrecovered leaps are (time, bar, notes). */
    leapExamples: string[];
    repeatPct: number;
    strongChordTonePct: number;
    /**
     * Phrasing (round 7): share of 8-bar phrases whose highest note is sounded at most twice (a
     * placed peak, not a ceiling the tune keeps bumping into), and audible breaths (a gap of at
     * least a fifth of a bar and 0.4 s between tune notes, or a hold of 70 % of a bar) per 8 bars.
     */
    peakPct: number;
    breathsPer8: number;
  };
  harmony: { chords: number; distinct: number; clashes: number; b9: number; appoggiaturas: number; clashesPerMin: number; worst: Rub[] };
  parallels: { count: number; perMin: number; examples: string[] };
  cadences: string[];
  texture: { peakPoly: number; meanPoly: number; notesPerSec: Record<string, number> };
  /**
   * Register: `crowdPct` = share of tune notes with an accompaniment note (accomp / accomp2)
   * sounding at or above the tune minus a whole tone (the tune is buried in its comping);
   * `tenorGap` = mean empty span (semitones) between the bass and the next voice up while both
   * sound (a hollow middle).
   */
  register: { crowdPct: number; crowdBy: string; tenorGap: number };
  flags: string[];
}

interface BarSpan {
  t0: number;
  t1: number;
  pcs: number[];
  sym: string;
  bar: number;
  section: string;
}

function spansOf(th: ThemeDef, p: Piece): BarSpan[] {
  const out: BarSpan[] = [];
  const info = p.barInfo ?? [];
  let section = '';
  info.forEach((b, i) => {
    if (b.section) section = b.section;
    const t1 = info[i + 1]?.t ?? p.duration;
    const syms = b.chords.split(/\s+/).filter(Boolean);
    const key = (th.key + b.shift) % 12;
    syms.forEach((s, k) => {
      out.push({ t0: b.t + ((t1 - b.t) * k) / syms.length, t1: b.t + ((t1 - b.t) * (k + 1)) / syms.length, pcs: chordPcs(parseChord(s), key), sym: s, bar: i, section });
    });
  });
  return out;
}

function spanAt(spans: BarSpan[], t: number): BarSpan | undefined {
  for (const s of spans) if (t >= s.t0 - 1e-4 && t < s.t1 - 1e-4) return s;
  return spans[spans.length - 1];
}

/** Sounding window of a note as the ear hears it. */
function heardEnd(e: NoteEvent): number {
  return e.t + (DECAYING.has(e.inst) ? Math.min(e.dur, 0.35) : e.dur);
}

export function critiquePiece(id: string, seed = 1): Critique {
  const th = THEMES[id];
  if (!th) throw new Error(`unknown theme ${id}`);
  const p = new Composer(th, seed).compose();
  const spans = spansOf(th, p);
  const S = th.meter === '4/4' ? 8 : 6;
  const ev = p.events;
  const mel = ev.filter((e) => e.track === 'melody' && e.dur > 0.07).sort((a, b) => a.t - b.t);
  const others = ev.filter((e) => HARMONY_TRACKS.has(e.track));
  const flags: string[] = [];
  const minutes = p.duration / 60;
  // Floors with a written tune are judged like songs (cadences, leaps, clashes); drifting ones aren't.
  const ambient = !!th.ambient && !th.ambient.tune;

  // ── melody shape
  let steps = 0;
  let leaps = 0;
  let unrec = 0;
  let maxLeap = 0;
  let repeats = 0;
  let strong = 0;
  let strongCt = 0;
  const strongAt: boolean[] = [];
  const leapEx: string[] = [];
  for (let i = 0; i < mel.length; i++) {
    const n = mel[i]!;
    const sp = spanAt(spans, n.t);
    if (sp) {
      const inBar = spans.filter((x) => x.bar === sp.bar);
      const barT0 = inBar[0]!.t0;
      const pos = ((n.t - barT0) / (inBar[inBar.length - 1]!.t1 - barT0)) * S;
      const beats = th.meter === '4/4' ? [0, 4] : th.meter === '6/8' ? [0, 3] : [0];
      if (beats.some((b) => Math.abs(pos - b) < 0.35)) {
        strongAt[i] = true;
        strong++;
        if (sp.pcs.includes(((n.midi % 12) + 12) % 12)) strongCt++;
      }
    }
    if (i === 0) continue;
    const prev = mel[i - 1]!;
    if (n.t - (prev.t + prev.dur) > 1.2) continue; // new phrase after a long rest
    const iv = n.midi - prev.midi;
    const a = Math.abs(iv);
    if (a === 0) repeats++;
    else if (a <= 2) steps++;
    else {
      leaps++;
      maxLeap = Math.max(maxLeap, a);
      if (a >= 5) {
        const nx = mel[i + 1];
        // Recovered: the next note turns back (any size up to a 4th), or the leap outlines an arpeggio continuing on.
        const back = nx ? nx.midi - n.midi : 0;
        const ok = !nx || (Math.sign(back) === -Math.sign(iv) && Math.abs(back) <= 5) || back === 0;
        if (!ok) {
          unrec++;
          if (leapEx.length < 8) leapEx.push(`${n.t.toFixed(1)}s bar ${sp?.bar ?? '?'} ${nm(prev.midi)}→${nm(n.midi)}→${nx ? nm(nx.midi) : '·'}`);
        }
      }
    }
  }
  const moves = Math.max(1, steps + leaps + repeats);
  // ── phrasing: placed peaks and breaths, per 8-bar phrase
  const barSec = p.duration / Math.max(1, p.bars);
  const phrases = new Map<number, number[]>();
  let breaths = 0;
  for (let i = 0; i < mel.length; i++) {
    const n = mel[i]!;
    const bar = spanAt(spans, n.t)?.bar ?? 0;
    const k = Math.floor(bar / 8);
    if (!phrases.has(k)) phrases.set(k, []);
    phrases.get(k)!.push(n.midi);
    const nx = mel[i + 1];
    // A breath: a gap of about a beat before the next note, or a phrase-end hold of 3+ beats
    // (the line rests on it while the band moves).
    if (nx && (nx.t - (n.t + n.dur) >= Math.max(0.4, barSec * 0.2) || nx.t - n.t >= barSec * 0.7)) breaths++;
  }
  let phraseN = 0;
  let peaked = 0;
  for (const ps of phrases.values()) {
    if (ps.length < 6) continue;
    phraseN++;
    const top = Math.max(...ps);
    if (ps.filter((m) => m === top).length <= 2) peaked++;
  }
  const peakPct = phraseN ? Math.round((peaked / phraseN) * 100) : 100;
  // (Per 8 bars of tune: the intro / outro bars carry no melody to breathe in.)
  const tuneBars = new Set(mel.map((n) => spanAt(spans, n.t)?.bar ?? 0)).size;
  const breathsPer8 = Math.round((breaths / Math.max(1, tuneBars / 8)) * 10) / 10;
  const lo = mel.reduce((m, e) => Math.min(m, e.midi), 999);
  const hi = mel.reduce((m, e) => Math.max(m, e.midi), 0);

  // ── rubs against sounding harmony
  const rubs: Rub[] = [];
  for (let i = 0; i < mel.length; i++) {
    const n = mel[i]!;
    // Quick unaccented passing / neighbour tones rub by design; judge accented or long notes.
    if (!strongAt[i] && n.dur < 0.45) continue;
    const sp = spanAt(spans, n.t);
    if (!sp) continue;
    const pc = ((n.midi % 12) + 12) % 12;
    const winEnd = n.t + Math.min(n.dur, 0.6);
    let worst: Rub | null = null;
    for (const o of others) {
      if (o.t > winEnd - 0.05) break;
      if (heardEnd(o) < n.t + 0.06) continue;
      const d = n.midi - o.midi;
      const ad = Math.abs(d);
      const ic = ad % 12;
      if (ic !== 1 && ic !== 11) continue;
      // A major 7th / minor 9th heard from below is colour (maj7) or bite (b9); a semitone inside
      // an octave is a rub either way.
      const upper = d > 0 ? n.midi : o.midi;
      const lower = d > 0 ? o.midi : n.midi;
      const span = upper - lower;
      if (span >= 11 && span % 12 === 11) continue; // major 7th (+ octaves): colour tone
      const chordTone = sp.pcs.includes(pc);
      const oPc = ((o.midi % 12) + 12) % 12;
      const oChordTone = sp.pcs.includes(oPc);
      const bassB9 = o.track === 'bass' && d > 12 && ic === 1 && oChordTone;
      if (chordTone && !bassB9) continue; // the other part is the passing tone, not the tune
      const nx = mel[i + 1];
      const nsp = nx ? spanAt(spans, nx.t) : undefined;
      const resolves = !!nx && Math.abs(nx.midi - n.midi) <= 2 && nx.midi !== n.midi && !!nsp && nsp.pcs.includes(((nx.midi % 12) + 12) % 12);
      const kind: Rub['kind'] = bassB9 ? 'b9-bass' : resolves ? 'appoggiatura' : 'clash';
      const r: Rub = { t: Math.round(n.t * 100) / 100, bar: sp.bar, section: sp.section, melody: `${nm(n.midi)} over ${sp.sym}`, against: `${nm(o.midi)} (${o.track}/${o.inst})`, track: o.track, kind };
      const rank = (k: Rub['kind']): number => (k === 'b9-bass' ? 3 : k === 'clash' ? 2 : 1);
      if (!worst || rank(kind) > rank(worst.kind)) worst = r;
    }
    if (worst) rubs.push(worst);
  }
  const clashes = rubs.filter((r) => r.kind === 'clash').length;
  const b9 = rubs.filter((r) => r.kind === 'b9-bass').length;

  // ── parallel perfect intervals, melody vs bass (at bass onsets)
  const bass = ev.filter((e) => e.track === 'bass').sort((a, b) => a.t - b.t);
  const melAt = (t: number): NoteEvent | undefined => {
    let found: NoteEvent | undefined;
    for (const m of mel) {
      if (m.t > t + 0.03) break;
      if (m.t + m.dur > t + 0.03) found = m;
    }
    return found;
  };
  let parallels = 0;
  const pex: string[] = [];
  for (let i = 1; i < bass.length; i++) {
    const b0 = bass[i - 1]!;
    const b1 = bass[i]!;
    if (b1.t - b0.t > 3) continue;
    const m0 = melAt(b0.t);
    const m1 = melAt(b1.t);
    if (!m0 || !m1 || m0 === m1) continue;
    const bm = b1.midi - b0.midi;
    const mm = m1.midi - m0.midi;
    if (bm === 0 || mm === 0 || Math.sign(bm) !== Math.sign(mm) || bm % 12 === 0) continue;
    const i0 = (((m0.midi - b0.midi) % 12) + 12) % 12;
    const i1 = (((m1.midi - b1.midi) % 12) + 12) % 12;
    if (i0 === i1 && (i0 === 0 || i0 === 7)) {
      parallels++;
      if (pex.length < 4) pex.push(`${b1.t.toFixed(1)}s ${i0 === 0 ? '8ves' : '5ths'} ${nm(m0.midi)}→${nm(m1.midi)} / ${nm(b0.midi)}→${nm(b1.midi)}`);
    }
  }

  // ── cadences: the last melody note of each A / B / C section
  const cadences: string[] = [];
  const info = p.barInfo ?? [];
  const DEG = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
  let finalDeg = '';
  if (!ambient) {
    info.forEach((b, i) => {
      const nb = info[i + 1];
      const secName = (() => {
        for (let k = i; k >= 0; k--) if (info[k]!.section) return info[k]!.section;
        return '';
      })();
      const endOfSection = !nb || nb.section !== '';
      if (!endOfSection || (secName !== 'A' && secName !== 'B' && secName !== 'C')) return;
      const t1 = nb?.t ?? p.duration;
      const last = mel.filter((m) => m.t >= b.t && m.t < t1).pop() ?? mel.filter((m) => m.t < t1).pop();
      if (!last) return;
      const d = DEG[(((last.midi - th.key - b.shift) % 12) + 12) % 12]!;
      cadences.push(`${secName}:${d}`);
      if (secName === 'A') finalDeg = d;
    });
  }

  // ── texture
  const timeline: [number, number][] = [];
  for (const e of ev) if (e.track !== 'perc') timeline.push([e.t, 1], [heardEnd(e), -1]);
  timeline.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let peak = 0;
  let area = 0;
  let lastT = 0;
  for (const [t, d] of timeline) {
    area += cur * (t - lastT);
    lastT = t;
    cur += d;
    peak = Math.max(peak, cur);
  }
  const nps: Record<string, number> = {};
  for (const e of ev) nps[e.track] = (nps[e.track] ?? 0) + 1;
  for (const k of Object.keys(nps)) nps[k] = Math.round((nps[k]! / p.duration) * 10) / 10;

  // ── register: the tune vs its comping; the bass vs the next voice up
  const comp = ev.filter((e) => e.track === 'accomp' || e.track === 'accomp2');
  let crowded = 0;
  const crowdBy: Record<string, number> = {};
  for (const m of mel) {
    const hit = comp.find((c) => c.t <= m.t + 0.05 && heardEnd(c) > m.t + 0.02 && c.midi >= m.midi - 2);
    if (hit) {
      crowded++;
      crowdBy[hit.track] = (crowdBy[hit.track] ?? 0) + 1;
    }
  }
  const crowdPct = mel.length ? Math.round((crowded / mel.length) * 100) : 0;
  const crowdWorst = Object.entries(crowdBy).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  let gapSum = 0;
  let gapN = 0;
  const voiced = ev.filter((e) => e.track !== 'perc');
  // (Register fill counts a plucked note's ring — up to 1.2 s — not just its attack.)
  const ringEnd = (e: NoteEvent): number => e.t + (DECAYING.has(e.inst) ? Math.min(e.dur, 1.2) : e.dur);
  for (let t = 0.5; t < p.duration; t += 0.25) {
    const sounding = voiced.filter((e) => e.t <= t && ringEnd(e) > t);
    const bassN = sounding.filter((e) => e.track === 'bass');
    if (!bassN.length) continue;
    const top = Math.max(...bassN.map((e) => e.midi));
    const above = sounding.filter((e) => e.track !== 'bass' && e.midi > top).map((e) => e.midi);
    if (!above.length) continue;
    gapSum += Math.min(...above) - top;
    gapN++;
  }
  const tenorGap = gapN ? Math.round((gapSum / gapN) * 10) / 10 : 0;

  const strongPct = strong ? Math.round((strongCt / strong) * 100) : 100;
  const unrecPct = leaps ? unrec / leaps : 0;
  if (!ambient) {
    if (b9 > 0) flags.push('B9-BASS');
    if (clashes / minutes > 2.5) flags.push('CLASHY');
    if (strongPct < 60) flags.push('WEAK-STRONG-BEATS');
    if (hi - lo < 9) flags.push('NARROW');
    if (hi - lo > 26) flags.push('WIDE');
    if (unrecPct > 0.35 && unrec > 3) flags.push('LEAPY');
    // Round 7 (critic r6: "conspicuously leap-heavy … algorithmically busy"): more than half the
    // moves skipping a third or more, or more than 8 % of all moves an unrecovered leap of a 4th+.
    if (leaps / moves > 0.52) flags.push(`LEAPY(${Math.round((leaps / moves) * 100)} % leaps)`);
    else if (unrec / moves > 0.08) flags.push(`LEAPY(${unrec} unrecovered)`);
    // …and loops that come round too soon: a song under 85 s (a scene cue under 60 s) repeats
    // before a player has finished a chore.
    const isCue = id.startsWith('event-');
    if (p.duration < (isCue ? 60 : 85)) flags.push(`SHORT-LOOP(${Math.round(p.duration)} s)`);
    if (breathsPer8 < 1) flags.push(`NO-BREATH(${breathsPer8}/8 bars)`);
    if (repeats / moves > 0.35) flags.push('STATIC');
    if (steps / moves < 0.3) flags.push('ANGULAR');
    if (parallels / minutes > 4) flags.push('PARALLELS');
    if (finalDeg && finalDeg !== '1') flags.push(`NO-TONIC-CADENCE(${finalDeg})`);
    if (crowdPct > 25) flags.push(`MASKED-TUNE(${crowdWorst})`);
    if (tenorGap > 22) flags.push('HOLLOW-MIDDLE');
  }
  const distinct = new Set(spans.map((s) => s.sym)).size;
  return {
    theme: id,
    title: th.title,
    seconds: Math.round(p.duration * 10) / 10,
    bars: p.bars,
    melody: {
      notes: mel.length,
      lo: nm(lo),
      hi: nm(hi),
      rangeSemis: hi - lo,
      stepPct: Math.round((steps / moves) * 100),
      leapPct: Math.round((leaps / moves) * 100),
      maxLeap,
      unrecoveredLeaps: unrec,
      leaps,
      leapExamples: leapEx,
      repeatPct: Math.round((repeats / moves) * 100),
      strongChordTonePct: strongPct,
      peakPct,
      breathsPer8,
    },
    harmony: {
      chords: spans.length,
      distinct,
      clashes,
      b9,
      appoggiaturas: rubs.filter((r) => r.kind === 'appoggiatura').length,
      clashesPerMin: Math.round((clashes / minutes) * 10) / 10,
      worst: rubs.filter((r) => r.kind !== 'appoggiatura').slice(0, 6),
    },
    parallels: { count: parallels, perMin: Math.round((parallels / minutes) * 10) / 10, examples: pex },
    cadences,
    texture: { peakPoly: peak, meanPoly: Math.round((area / Math.max(1e-6, lastT)) * 10) / 10, notesPerSec: nps },
    register: { crowdPct, crowdBy: crowdWorst, tenorGap },
    flags,
  };
}

export function critiqueAll(seed = 1): Critique[] {
  return Object.keys(THEMES).map((id) => critiquePiece(id, seed));
}
