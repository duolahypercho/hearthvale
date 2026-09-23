/**
 * Music theory primitives: modes, roman-numeral chord parsing, chord-scales and voice-led voicings.
 * Pitches are MIDI numbers; pitch classes are 0..11 relative to C unless stated otherwise.
 */

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
} as const;
export type ModeName = keyof typeof MODES;

export interface Chord {
  symbol: string;
  /** Root in semitones above the key tonic. */
  root: number;
  /** Chord tones as semitone offsets above the chord root (root first). */
  tones: number[];
  /** Written inversion: the bass note in semitones above the chord root ('I/3' → 4, 'V/5' → 7). */
  bass?: number;
}

const NUMERALS: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

/**
 * Roman numeral → chord, relative to the key tonic (always measured against the MAJOR scale,
 * accidentals explicit): 'I', 'vi7', 'IVmaj7', 'bVII', 'V7', 'ii7', 'Isus2', 'iv6', 'Iadd9', 'viidim', 'bVImaj7'.
 */
export function parseChord(sym: string): Chord {
  // Slash inversions name the chord member in the bass: '/3' third, '/5' fifth, '/7' seventh.
  const [body, inv] = sym.trim().split('/') as [string, string | undefined];
  const m = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(body);
  if (!m) throw new Error(`bad chord symbol "${sym}"`);
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const num = m[2]!;
  const minor = num === num.toLowerCase();
  const q = m[3]!;
  const root = (((NUMERALS[num.toUpperCase()]! + acc) % 12) + 12) % 12;
  const third = minor ? 3 : 4;
  let tones: number[] = [0, third, 7];
  if (q === 'maj7') tones = [0, third, 7, 11];
  else if (q === '7') tones = minor ? [0, 3, 7, 10] : [0, 4, 7, 10];
  else if (q === 'maj9') tones = [0, 4, 7, 11, 14];
  else if (q === '9') tones = minor ? [0, 3, 7, 10, 14] : [0, 4, 7, 10, 14];
  else if (q === 'sus2') tones = [0, 2, 7];
  else if (q === 'sus4') tones = [0, 5, 7];
  else if (q === '7sus4') tones = [0, 5, 7, 10];
  else if (q === 'add9') tones = [0, third, 7, 14];
  else if (q === '6') tones = [0, third, 7, 9];
  else if (q === 'dim') tones = [0, 3, 6];
  else if (q === 'm7b5') tones = [0, 3, 6, 10];
  else if (q !== '') throw new Error(`bad chord quality "${q}" in "${sym}"`);
  const c: Chord = { symbol: sym, root, tones };
  if (inv) {
    const idx = inv === '3' ? 1 : inv === '5' ? 2 : inv === '7' ? 3 : -1;
    if (idx < 0 || tones[idx] === undefined) throw new Error(`bad inversion "/${inv}" in "${sym}"`);
    c.bass = tones[idx]! % 12;
  }
  return c;
}

/** Absolute pitch classes (0..11, relative to C) of a chord in a key. */
export function chordPcs(chord: Chord, keyPc: number): number[] {
  return chord.tones.map((t) => (keyPc + chord.root + t) % 12);
}

/**
 * The scale the melody may use over a chord: the key's mode, with any chord tone that is
 * foreign to the mode replacing its neighbouring scale degree (V in minor raises the 7th,
 * bVII in major lowers it, iv in major lowers the 6th ...). Returned as sorted pitch classes.
 */
export function chordScale(chord: Chord, keyPc: number, mode: ModeName): number[] {
  const scale = MODES[mode].map((s) => (keyPc + s) % 12);
  for (const pc of chordPcs(chord, keyPc)) {
    if (scale.includes(pc)) continue;
    let best = -1;
    let bestD = 99;
    for (let i = 0; i < scale.length; i++) {
      const d = Math.min((scale[i]! - pc + 12) % 12, (pc - scale[i]! + 12) % 12);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD <= 1) scale[best] = pc;
    else scale.push(pc);
  }
  return [...new Set(scale)].sort((a, b) => a - b);
}

/** Nearest pitch to `p` whose pitch class is in `pcs` (ties go in direction `dir`). */
export function nearestIn(p: number, pcs: readonly number[], dir = 0): number {
  for (let d = 0; d < 12; d++) {
    const a = p + (dir >= 0 ? d : -d);
    const b = p - (dir >= 0 ? d : -d);
    if (pcs.includes(((a % 12) + 12) % 12)) return a;
    if (pcs.includes(((b % 12) + 12) % 12)) return b;
  }
  return p;
}

/** Move `steps` scale steps from pitch `p` within scale pcs (p is snapped into the scale first). */
export function scaleStep(p: number, steps: number, pcs: readonly number[]): number {
  let q = nearestIn(p, pcs);
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    q += dir;
    while (!pcs.includes(((q % 12) + 12) % 12)) q += dir;
  }
  return q;
}

/**
 * Voice a chord in [lo, hi] with `n` voices, minimising total voice movement from `prev`
 * (smooth voice leading) and keeping the top voice from jumping. Without `prev` the voicing
 * nearest the middle of the range wins. Drops the 5th first when a chord has too many tones.
 */
export function voiceChord(chord: Chord, keyPc: number, n: number, lo: number, hi: number, prev: number[] | null): number[] {
  let pcs = chordPcs(chord, keyPc);
  if (pcs.length > n) {
    // drop the fifth (index 2) then extensions beyond n
    const rootPc = pcs[0]!;
    const fifth = (rootPc + 7) % 12;
    pcs = pcs.filter((pc, i) => !(i === 2 && pc === fifth)).slice(0, n);
  }
  while (pcs.length < n) pcs.push(pcs[pcs.length - pcs.length]!); // double the root
  const cands: number[][] = [];
  for (let base = lo - 12; base <= hi; base++) {
    if (!pcs.includes(((base % 12) + 12) % 12)) continue;
    // Close position starting on `base`: stack the remaining pcs upward.
    for (let inv = 0; inv < pcs.length; inv++) {
      const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
      if (order[0] !== ((base % 12) + 12) % 12) continue;
      const v: number[] = [base];
      for (let k = 1; k < order.length; k++) {
        let p = v[k - 1]! + 1;
        while (((p % 12) + 12) % 12 !== order[k]) p++;
        v.push(p);
      }
      if (v[0]! >= lo && v[v.length - 1]! <= hi) cands.push(v);
    }
  }
  if (!cands.length) {
    const v = pcs.map((pc) => {
      let p = lo + ((pc - lo) % 12 + 12) % 12;
      if (p > hi) p -= 12;
      return p;
    });
    return v.sort((a, b) => a - b);
  }
  const mid = (lo + hi) / 2;
  let best = cands[0]!;
  let bestCost = Infinity;
  for (const v of cands) {
    let cost: number;
    if (prev && prev.length === v.length) {
      cost = 0;
      for (let i = 0; i < v.length; i++) cost += Math.abs(v[i]! - prev[i]!);
      cost += Math.abs(v[v.length - 1]! - prev[prev.length - 1]!) * 0.5;
      // gentle pull back toward the middle so voicings don't drift out of range over time
      cost += Math.abs((v[0]! + v[v.length - 1]!) / 2 - mid) * 0.15;
    } else cost = Math.abs((v[0]! + v[v.length - 1]!) / 2 - mid);
    // Avoid muddy close intervals low down.
    if (v[0]! < 52 && v[1]! - v[0]! < 5) cost += 4;
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  return best;
}
