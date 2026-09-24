/**
 * Birdsong from pre-rendered syllables (not oscillator beeps).
 *
 * A syllable is additive: a fundamental plus 2nd and 3rd harmonics, each with its own decay (the
 * overtones fade first, so a note starts bright and ends pure), a pitch contour (slur up / down /
 * arch / flat whistle / buzz), fast FM at 30–120 Hz with 5–15 % depth (the syrinx's roughness),
 * an optional trill (AM chopping), and a per-syllable band-pass "formant" (the beak and throat)
 * mixed over the dry tone. Each species gets a bank of ~40 syllables rendered once, lazily, with a
 * seeded RNG straight into AudioBuffers (no nodes, no OfflineAudioContext round trip), so singing a
 * phrase costs one buffer source per syllable.
 *
 * Songs are sequenced from the bank per species (a robin's carolling phrases, a thrush's repeated
 * motifs, a warbler's descending trill, a wren's rattle ...), and they answer each other: a second
 * bird of the same species, perched elsewhere in the stereo field, replies to the first
 * (Ambience.sing).
 */
import { Rand } from './dsp';

export type Species = 'robin' | 'finch' | 'warbler' | 'thrush' | 'wren' | 'chickadee' | 'dove' | 'owl' | 'gull' | 'cricket' | 'drip';

interface Syl {
  dur: number;
  f0: number;
  f1: number;
  /** 0 = exponential glide f0→f1, 1 = arch (up to f1 then back to f0), 2 = dip. */
  shape: 0 | 1 | 2;
  h2: number;
  h3: number;
  fmRate: number;
  fmDepth: number;
  /** Trill (AM) rate in Hz (0 = none). */
  trill: number;
  /** Formant: centre as a multiple of the mean pitch, Q, wet mix. */
  formant: number;
  q: number;
  wet: number;
  /** Attack seconds. */
  attack: number;
  /** Breath noise mix (owls, doves). */
  breath?: number;
}

/** Render one syllable into a mono Float32Array (peak ≈ 1). */
function renderSyl(sr: number, s: Syl, r: Rand): Float32Array<ArrayBuffer> {
  const n = Math.max(8, Math.floor(s.dur * sr));
  const out = new Float32Array(new ArrayBuffer(n * 4));
  let ph = r.next();
  const fmPh = r.next() * Math.PI * 2;
  const mean = s.shape === 0 ? Math.sqrt(s.f0 * s.f1) : (s.f0 + s.f1) / 2;
  // Band-pass biquad (RBJ, constant 0 dB peak) for the formant.
  const fc = Math.min(sr * 0.45, mean * s.formant);
  const w = (2 * Math.PI * fc) / sr;
  const al = Math.sin(w) / (2 * s.q);
  const a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let lpN = 0;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / s.dur;
    let f: number;
    if (s.shape === 0) f = s.f0 * Math.pow(s.f1 / s.f0, u);
    else if (s.shape === 1) f = s.f0 + (s.f1 - s.f0) * Math.sin(Math.PI * u);
    else f = s.f0 - (s.f0 - s.f1) * Math.sin(Math.PI * u);
    f *= 1 + s.fmDepth * Math.sin(fmPh + 2 * Math.PI * s.fmRate * t);
    ph += f / sr;
    // Envelope: quick onset, rounded body, tapered end.
    const atk = Math.min(1, t / s.attack);
    const tail = Math.min(1, (s.dur - t) / Math.min(0.03, s.dur * 0.35));
    let env = atk * atk * (3 - 2 * atk) * Math.max(0, tail) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.2)));
    if (s.trill > 0) env *= 0.5 + 0.5 * Math.cos(2 * Math.PI * s.trill * t);
    const p = 2 * Math.PI * ph;
    let v = Math.sin(p) + s.h2 * Math.exp(-u * 2.2) * Math.sin(2 * p) + s.h3 * Math.exp(-u * 3.5) * Math.sin(3 * p);
    if (s.breath) {
      lpN += 0.25 * ((r.next() * 2 - 1) - lpN);
      v = v * (1 - s.breath) + lpN * s.breath * 3;
    }
    v *= env;
    const y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    const o = v * (1 - s.wet) + y * s.wet * 1.6;
    out[i] = o;
    if (Math.abs(o) > peak) peak = Math.abs(o);
  }
  const k = 1 / peak;
  for (let i = 0; i < n; i++) out[i] = out[i]! * k;
  return out;
}

/**
 * A tubular wind chime note: inharmonic tube partials (1 : 2.76 : 5.40 : 8.93) with their own
 * decays, a clapper tick, a slow beat between the two lowest modes. Peak ≈ 1.
 */
export function chimeBuffer(ctx: BaseAudioContext, f: number, r: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 2.4;
  const n = Math.floor(sr * dur);
  const data = new Float32Array(new ArrayBuffer(n * 4));
  const parts: [number, number, number][] = [[1, 1, 1.9], [1.004, 0.35, 1.7], [2.76, 0.5, 0.9], [5.4, 0.25, 0.45], [8.93, 0.12, 0.22]];
  const ph = parts.map(() => r.next() * Math.PI * 2);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    parts.forEach(([ratio, amp, tau], k) => {
      if (f * ratio < sr * 0.45) v += amp * Math.exp(-t / tau) * Math.sin(ph[k]! + 2 * Math.PI * f * ratio * t);
    });
    if (i < 90) v += (r.next() * 2 - 1) * 0.5 * (1 - i / 90);
    v *= Math.min(1, t / 0.0015);
    data[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  for (let i = 0; i < n; i++) data[i] = data[i]! / peak;
  const buf = ctx.createBuffer(1, n, sr);
  buf.copyToChannel(data, 0);
  return buf;
}

/** Syllable templates per species (randomised per bank entry). */
function template(sp: Species, r: Rand, i: number): Syl {
  const base = { h2: 0.22, h3: 0.07, fmRate: r.range(40, 110), fmDepth: r.range(0.02, 0.06), trill: 0, formant: 1.15, q: 2.2, wet: 0.55, attack: 0.006, shape: 0 as 0 | 1 | 2 };
  switch (sp) {
    case 'robin': {
      // Carolling slurs, 2–3.3 kHz, about a third of them buzzy (fast FM) or trilled.
      const f = r.range(2000, 3300);
      const kind = i % 4;
      return { ...base, dur: r.range(0.08, 0.15), f0: kind === 0 ? f * 0.8 : f * 1.12, f1: kind === 0 ? f * 1.2 : kind === 1 ? f * 0.82 : f * r.range(1.15, 1.3), shape: kind >= 2 ? 1 : 0, h2: r.range(0.18, 0.32), h3: r.range(0.04, 0.12), fmDepth: kind === 3 ? r.range(0.08, 0.14) : base.fmDepth, trill: r.chance(0.2) ? r.range(28, 45) : 0 };
    }
    case 'finch': {
      const f = r.range(2900, 4300);
      if (i % 5 === 4) return { ...base, dur: r.range(0.14, 0.2), f0: 4400, f1: 2700, trill: r.range(30, 42), h2: 0.15, fmDepth: 0.05 };
      return { ...base, dur: r.range(0.04, 0.065), f0: f, f1: f * r.range(1.1, 1.4), h2: 0.18, h3: 0.05, attack: 0.004 };
    }
    case 'warbler': {
      const f = r.range(4000, 5300);
      return { ...base, dur: r.range(0.03, 0.045), f0: f, f1: f * r.range(0.72, 0.84), h2: 0.12, h3: 0.03, fmRate: r.range(90, 140), fmDepth: r.range(0.05, 0.1), attack: 0.003, formant: 1.05 };
    }
    case 'thrush': {
      // Rich, fluty notes with real overtones and a slight arch; some rasp.
      const f = r.range(1800, 3200);
      return { ...base, dur: r.range(0.08, 0.13), f0: f, f1: f * r.range(0.9, 1.12), shape: r.chance(0.5) ? 1 : 0, h2: r.range(0.3, 0.5), h3: r.range(0.1, 0.2), fmDepth: r.chance(0.3) ? r.range(0.1, 0.15) : 0.03, formant: 1.25, q: 1.6, wet: 0.5 };
    }
    case 'wren': {
      const f = r.range(3200, 4200);
      return { ...base, dur: r.range(0.018, 0.028), f0: f * 1.1, f1: f * 0.85, h2: 0.1, h3: 0.03, fmDepth: 0.04, attack: 0.002 };
    }
    case 'chickadee': {
      // "fee-bee": two near-pure whistles, the second a whole tone lower with a tiny waver.
      const hi = i % 2 === 0;
      const f = hi ? r.range(3850, 4050) : r.range(3350, 3500);
      return { ...base, dur: hi ? r.range(0.26, 0.32) : r.range(0.22, 0.28), f0: f, f1: f * 0.985, h2: 0.06, h3: 0.015, fmRate: r.range(6, 9), fmDepth: 0.006, attack: 0.02, wet: 0.3 };
    }
    case 'dove': {
      const f = r.range(470, 540) * (i % 3 === 1 ? 1.12 : 1);
      return { ...base, dur: r.range(0.28, 0.5), f0: f * 0.94, f1: f * 1.02, shape: 1, h2: 0.35, h3: 0.12, fmRate: r.range(18, 30), fmDepth: 0.015, attack: 0.05, formant: 1.2, q: 1.2, wet: 0.6, breath: 0.12 };
    }
    case 'owl': {
      const f = r.range(360, 400);
      return { ...base, dur: i % 4 === 3 ? r.range(0.5, 0.6) : r.range(0.15, 0.3), f0: f * 1.02, f1: f * 0.94, h2: 0.25, h3: 0.08, fmRate: 12, fmDepth: 0.01, attack: 0.04, formant: 1.1, q: 1.4, wet: 0.5, breath: 0.2 };
    }
    case 'gull': {
      const f = r.range(1350, 1650);
      return { ...base, dur: r.range(0.16, 0.24), f0: f, f1: f * r.range(0.6, 0.7), shape: r.chance(0.4) ? 1 : 0, h2: 0.55, h3: 0.35, fmRate: r.range(28, 40), fmDepth: r.range(0.08, 0.13), attack: 0.012, formant: 1.6, q: 1.3, wet: 0.6 };
    }
    case 'cricket': {
      const f = r.range(4300, 5100);
      return { ...base, dur: 0.014, f0: f, f1: f * 0.99, h2: 0.2, h3: 0.05, fmRate: 200, fmDepth: 0.004, attack: 0.002, wet: 0.4, formant: 1, q: 4 };
    }
    case 'drip': {
      // A drop into a puddle: a bubble that glides slightly down and is gone in < 80 ms.
      const f = r.range(1400, 3600);
      return { ...base, dur: r.range(0.035, 0.07), f0: f, f1: f * r.range(0.8, 0.9), h2: 0.1, h3: 0.02, fmDepth: 0, attack: 0.0015, wet: 0.3, formant: 1, q: 1.5 };
    }
  }
}

const BANK_SIZE: Partial<Record<Species, number>> = { chickadee: 12, owl: 12, dove: 16, cricket: 12, drip: 24 };

export class BirdBank {
  private banks = new Map<Species, AudioBuffer[]>();
  constructor(private ctx: BaseAudioContext, private seed = 17) {}

  /** The syllable bank for a species (rendered on first use). */
  bank(sp: Species): AudioBuffer[] {
    let b = this.banks.get(sp);
    if (b) return b;
    const r = new Rand(this.seed * 131 + sp.length * 977 + sp.charCodeAt(0));
    const sr = this.ctx.sampleRate;
    b = [];
    const n = BANK_SIZE[sp] ?? 40;
    for (let i = 0; i < n; i++) {
      const data = renderSyl(sr, template(sp, r, i), r);
      const buf = this.ctx.createBuffer(1, data.length, sr);
      buf.copyToChannel(data, 0);
      b.push(buf);
    }
    this.banks.set(sp, b);
    return b;
  }

  /** Play syllable `k` of a species' bank at `t` into `dest` (rate = pitch/time variation). */
  play(dest: AudioNode, sp: Species, k: number, t: number, amp: number, rate = 1): number {
    const bank = this.bank(sp);
    const buf = bank[((k % bank.length) + bank.length) % bank.length]!;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = amp;
    src.connect(g).connect(dest);
    src.start(t);
    return buf.duration / rate;
  }
}

/**
 * A phrase for one bird: a list of [syllable index, time offset, gain, rate]. `motif` is the
 * bird's personal material (so an answering bird re-uses and varies it).
 */
export function phrase(sp: Species, r: Rand, motif: number[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const rate = r.range(0.97, 1.03);
  let t = 0;
  const syl = (k: number, gain = 1, gap = 0.02, rt = rate): void => {
    out.push([k, t, gain, rt]);
    t += gap;
  };
  switch (sp) {
    case 'robin': {
      // 2–3 groups of 2–4 carolled syllables; groups separated by short breaths.
      const groups = r.int(2, 3);
      for (let gI = 0; gI < groups; gI++) {
        const n = r.int(2, 4);
        for (let i = 0; i < n; i++) syl(motif[(gI * 2 + i) % motif.length]!, 0.8 + r.next() * 0.25, r.range(0.12, 0.2));
        t += r.range(0.12, 0.3);
      }
      break;
    }
    case 'finch': {
      const n = r.int(4, 8);
      for (let i = 0; i < n; i++) syl(motif[i % motif.length]!, 0.75 + r.next() * 0.2, r.range(0.06, 0.09));
      syl(5 * r.int(0, 7) + 4, 0.9, 0.2); // the flourish (every 5th bank entry is one)
      break;
    }
    case 'warbler': {
      const n = r.int(8, 14);
      for (let i = 0; i < n; i++) syl(motif[i % 2]!, 0.7 * (1 - i * 0.02), 0.044, rate * (1 - i * 0.011));
      break;
    }
    case 'thrush': {
      // A motif sung twice (or three times), then another motif.
      for (let rep = 0; rep < 2; rep++) {
        const reps = r.chance(0.3) ? 3 : 2;
        const m = motif.slice(rep * 3, rep * 3 + 3);
        for (let k = 0; k < reps; k++) {
          for (const s of m) syl(s, 0.85, 0.13);
          t += 0.08;
        }
        t += 0.25;
      }
      break;
    }
    case 'wren': {
      // Rattle climbing then a lower rattle: 25–35 tiny notes.
      const n = r.int(18, 26);
      for (let i = 0; i < n; i++) syl(motif[i % 3]!, 0.6, 0.03, rate * (1 + 0.012 * Math.min(i, 14)));
      t += 0.05;
      for (let i = 0; i < 10; i++) syl(motif[(i % 3) + 3]!, 0.55, 0.034, rate * 0.86);
      break;
    }
    case 'chickadee': {
      const k = 2 * r.int(0, 5);
      syl(k, 1, 0.38);
      syl(k + 1, 0.85, 0.3);
      break;
    }
    case 'dove': {
      // "hoo-HOO-hoo, hoo, hoo"
      const o = 3 * r.int(0, 4);
      syl(o, 0.9, 0.42);
      syl(o + 1, 1, 0.58);
      syl(o + 2, 0.85, 0.55);
      syl(o + 3, 0.75, 0.4);
      syl(o, 0.7, 0.4);
      break;
    }
    case 'owl':
      syl(motif[0]!, 1, 0.55);
      syl(motif[1]!, 0.7, 0.2);
      syl(motif[2]!, 0.7, 0.3);
      syl(motif[3]!, 0.9, 0.6);
      break;
    case 'gull': {
      const n = r.int(1, 4);
      for (let i = 0; i < n; i++) syl(motif[i % motif.length]!, 0.9 - i * 0.1, 0.22);
      break;
    }
    default:
      syl(motif[0] ?? 0, 1, 0.1);
  }
  return out;
}
