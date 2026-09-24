/**
 * Audio analysis shared by scripts/audio-render.mjs (the critic harness) and scripts/audio-lab.mjs
 * (a persistent render server for fast iteration): WAV I/O, BS.1770 loudness, true peak, spectrum,
 * flags, and the gameplay (SFX-over-music) masking analysis.
 */
import { readFileSync, writeFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────── WAV I/O

export function writeWav(path, inter, sr) {
  const frames = inter.length / 2;
  const buf = Buffer.alloc(44 + frames * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + frames * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * 4, 40);
  let seed = 22222;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < inter.length; i++) {
    const d = (rnd() - rnd()) / 32768; // TPDF dither
    const v = Math.max(-1, Math.min(1, inter[i] + d));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

export function readWav(path) {
  const b = readFileSync(path);
  let p = 12;
  let fmt = null;
  let data = null;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22), format: b.readUInt16LE(p + 8) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('bad wav');
  const n = data.length / (fmt.bits / 8);
  const inter = new Float32Array((n / fmt.ch) * 2);
  for (let i = 0; i < n / fmt.ch; i++) {
    for (let c = 0; c < 2; c++) {
      const ch = Math.min(c, fmt.ch - 1);
      const idx = i * fmt.ch + ch;
      let v;
      if (fmt.format === 3) v = data.readFloatLE(idx * 4);
      else if (fmt.bits === 16) v = data.readInt16LE(idx * 2) / 32768;
      else if (fmt.bits === 24) v = data.readIntLE(idx * 3, 3) / 8388608;
      else v = data.readInt32LE(idx * 4) / 2147483648;
      inter[i * 2 + c] = v;
    }
  }
  return { inter, sr: fmt.sr };
}

// ─────────────────────────────────────────────────────────── analysis

export function biquad(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
export function kCoeffs(sr) {
  const norm = (b0, b1, b2, a0, a1, a2) => ({ b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 });
  let G = 3.999843853973347, Q = 0.7071752369554196, fc = 1681.974450955533;
  let A = Math.pow(10, G / 40), w = (2 * Math.PI * fc) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Q), sA = Math.sqrt(A);
  const shelf = norm(A * ((A + 1) + (A - 1) * cs + 2 * sA * al), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - 2 * sA * al), (A + 1) - (A - 1) * cs + 2 * sA * al, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - 2 * sA * al);
  Q = 0.5003270373238773; fc = 38.13547087602444; w = (2 * Math.PI * fc) / sr; cs = Math.cos(w); al = Math.sin(w) / (2 * Q);
  const hp = norm((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  return { shelf, hp };
}
export const db = (x) => (x > 0 ? 10 * Math.log10(x) : -Infinity);
export const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-inf');

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export function truePeak(x) {
  // 4x oversampling with a 16-tap windowed-sinc interpolator.
  const taps = 8;
  const kern = [];
  for (let ph = 1; ph < 4; ph++) {
    const k = [];
    for (let j = -taps + 1; j <= taps; j++) {
      const t = j - ph / 4;
      const s = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / taps);
      k.push(s * w);
    }
    kern.push(k);
  }
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (a < 0.3 * peak && a < 0.2) continue;
    for (const k of kern) {
      let s = 0;
      for (let j = 0; j < k.length; j++) {
        const idx = i + j - taps + 1;
        if (idx >= 0 && idx < x.length) s += x[idx] * k[j];
      }
      if (Math.abs(s) > peak) peak = Math.abs(s);
    }
  }
  return peak;
}

export function analyze(inter, sr) {
  const n = inter.length / 2;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = inter[i * 2]; R[i] = inter[i * 2 + 1]; }
  let peak = 0, clips = 0, ss = 0, sl = 0, sr2 = 0, slr = 0, dcL = 0, dcR = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
    if (a >= 0.999) clips++;
    if (b >= 0.999) clips++;
    ss += L[i] * L[i] + R[i] * R[i];
    sl += L[i] * L[i]; sr2 += R[i] * R[i]; slr += L[i] * R[i];
    dcL += L[i]; dcR += R[i];
  }
  const tp = Math.max(truePeak(L), truePeak(R));
  const rms = Math.sqrt(ss / (2 * n));
  // K-weighted loudness.
  const { shelf, hp } = kCoeffs(sr);
  const kL = biquad(biquad(L, shelf), hp), kR = biquad(biquad(R, shelf), hp);
  const blockMs = (win, hop) => {
    const W = Math.floor(sr * win), H = Math.floor(sr * hop);
    const out = [];
    for (let s = 0; s + W <= n; s += H) {
      let e = 0;
      for (let i = s; i < s + W; i++) e += kL[i] * kL[i] + kR[i] * kR[i];
      out.push(e / W);
    }
    return out;
  };
  const mom = blockMs(0.4, 0.1);
  const lufs = (ms) => -0.691 + db(ms);
  const abs = mom.filter((m) => lufs(m) > -70);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const relGate = lufs(avg(abs)) - 10;
  const gated = abs.filter((m) => lufs(m) > relGate);
  const integrated = gated.length ? lufs(avg(gated)) : -Infinity;
  const momMax = Math.max(...mom.map(lufs));
  const st = blockMs(3, 1).map(lufs);
  const stMax = st.length ? Math.max(...st) : momMax;
  const stG = st.filter((v) => v > -70);
  const stRel = stG.length ? lufs(avg(stG.map((v) => Math.pow(10, (v + 0.691) / 10)))) - 20 : -70;
  const lraSet = stG.filter((v) => v > stRel).sort((a, b) => a - b);
  const pct = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  const lra = lraSet.length > 2 ? pct(lraSet, 0.95) - pct(lraSet, 0.1) : 0;
  // Silence (unweighted 400 ms blocks under -50 dBFS RMS).
  const W = Math.floor(sr * 0.4);
  let silent = 0, blocks = 0, run = 0, longest = 0;
  for (let s = 0; s + W <= n; s += W) {
    let e = 0;
    for (let i = s; i < s + W; i++) e += L[i] * L[i] + R[i] * R[i];
    const lv = db(e / (2 * W));
    blocks++;
    if (lv < -50) { silent++; run++; longest = Math.max(longest, run); } else run = 0;
  }
  // Spectrum: the power a listener hears — left and right analysed separately and summed (a mid
  // (L+R)/2 spectrum would under-count wide, decorrelated beds like rain or surf by up to 3 dB).
  const N = 4096;
  const spec = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= n; s += N) {
    let e = 0;
    for (let i = 0; i < N; i++) e += (L[s + i] * L[s + i] + R[s + i] * R[s + i]) * 0.5;
    if (db(e / N) < -55) continue;
    for (const ch of [L, R]) {
      for (let i = 0; i < N; i++) {
        re[i] = ch[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
    }
    frames++;
  }
  let tot = 0, cen = 0;
  const bands = { sub: 0, bass: 0, lowmid: 0, presence: 0, air: 0 };
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    const p = spec[k];
    tot += p;
    cen += p * f;
    if (f < 60) bands.sub += p;
    else if (f < 250) bands.bass += p;
    else if (f < 2000) bands.lowmid += p;
    else if (f < 5000) bands.presence += p;
    else bands.air += p;
  }
  let acc = 0, rolloff = 0;
  for (let k = 1; k < N / 2; k++) {
    acc += spec[k];
    if (acc >= tot * 0.85) { rolloff = (k * sr) / N; break; }
  }
  for (const k of Object.keys(bands)) bands[k] = tot > 0 ? bands[k] / tot : 0;
  const corr = slr / Math.sqrt(sl * sr2 + 1e-12);
  return {
    seconds: n / sr,
    peakDb: 20 * Math.log10(peak + 1e-12),
    truePeakDb: 20 * Math.log10(tp + 1e-12),
    clippedSamples: clips,
    lufsIntegrated: integrated,
    lufsShortMax: stMax,
    lufsMomentaryMax: momMax,
    lra,
    rmsDb: 20 * Math.log10(rms + 1e-12),
    crestDb: 20 * Math.log10(peak + 1e-12) - 20 * Math.log10(rms + 1e-12),
    silencePct: blocks ? (100 * silent) / blocks : 0,
    longestSilence: longest * 0.4,
    centroidHz: tot > 0 ? cen / tot : 0,
    rolloffHz: rolloff,
    bands,
    dc: Math.max(Math.abs(dcL / n), Math.abs(dcR / n)),
    stereoCorr: corr,
    analysedFrames: frames,
  };
}

/**
 * Day themes must have some sparkle. Calibration: a long-term spectrum that is pink up to 1 kHz and
 * falls a further 3 dB/oct above it (the commercial-mix norm) puts ~12 % of its power above 2 kHz.
 * Target for day themes: 12–18 %. Below 9 % a mix reads muffled: hard fail (DULL); 9–12 % is
 * reported as MELLOW (a warning).
 */
export const DAY_THEME = /^(theme|mix)-(spring|summer|fall|winter|town|beach|title|inn|forest|festival)(-[a-z0-9]+)?$/;

export function flags(a, kind, name = '') {
  const f = [];
  const top = a.bands.presence + a.bands.air;
  if (DAY_THEME.test(name) && top < 0.09) f.push(`DULL(${(top * 100).toFixed(0)}%)`);
  else if (DAY_THEME.test(name) && top < 0.12) f.push(`mellow(${(top * 100).toFixed(0)}%)`);
  if (a.clippedSamples > 0) f.push(`CLIP(${a.clippedSamples})`);
  if (a.truePeakDb > -0.5) f.push('TRUEPEAK');
  if (kind !== 'sfx' && a.lufsIntegrated > -12) f.push('TOO-LOUD');
  if (kind === 'theme' && a.lufsIntegrated < -28) f.push('TOO-QUIET');
  if (kind === 'amb' && a.lufsIntegrated < -45) f.push('INAUDIBLE');
  if (kind !== 'sfx' && kind !== 'reel' && a.silencePct > 20) f.push(`SILENCE(${a.silencePct.toFixed(0)}%)`);
  // Birdsong and cicadas live at 2–5 kHz, so ambience beds get more headroom there than music.
  if (a.bands.presence > (kind === 'amb' ? 0.5 : 0.25)) f.push('HARSH(2-5k)');
  if (a.bands.air > 0.18) f.push('HISSY(5k+)');
  if (a.centroidHz > 3500) f.push('BRIGHT');
  if (a.bands.sub > 0.35) f.push('BOOMY');
  if (a.dc > 0.005) f.push('DC');
  if (a.stereoCorr < 0) f.push('PHASE');
  return f;
}

export function row(name, a, kind) {
  const b = a.bands;
  const fl = flags(a, kind, name);
  return [
    name.padEnd(26),
    fmt(a.peakDb).padStart(6),
    fmt(a.truePeakDb).padStart(6),
    fmt(a.lufsIntegrated).padStart(6),
    fmt(a.lufsShortMax).padStart(6),
    fmt(a.lra).padStart(5),
    fmt(a.crestDb).padStart(5),
    fmt(a.silencePct, 0).padStart(4),
    fmt(a.centroidHz, 0).padStart(6),
    `${(b.sub * 100).toFixed(0)}/${(b.bass * 100).toFixed(0)}/${(b.lowmid * 100).toFixed(0)}/${(b.presence * 100).toFixed(0)}/${(b.air * 100).toFixed(0)}`.padStart(16),
    fmt(a.stereoCorr, 2).padStart(5),
    fl.length ? fl.join(' ') : 'ok',
  ].join(' ');
}
export const HEADER = `${'name'.padEnd(26)}  peak    dBTP   LUFS  STmax   LRA crest sil%  centHz  sub/bas/lm/pr/air  corr flags`;

// ─────────────────────────────────────────────────────────── gameplay (SFX over music)

/** K-weighted mean power of interleaved stereo `inter` over [t0, t1). */
export function kPower(inter, sr, t0, t1) {
  const s0 = Math.max(0, Math.floor(t0 * sr)), s1 = Math.min(inter.length / 2, Math.floor(t1 * sr));
  const pad = Math.floor(0.05 * sr); // filter warm-up
  const a = Math.max(0, s0 - pad);
  const n = s1 - a;
  if (n <= 0) return 0;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = inter[(a + i) * 2]; R[i] = inter[(a + i) * 2 + 1]; }
  const { shelf, hp } = kCoeffs(sr);
  const kL = biquad(biquad(L, shelf), hp), kR = biquad(biquad(R, shelf), hp);
  let e = 0;
  for (let i = s0 - a; i < n; i++) e += kL[i] * kL[i] + kR[i] * kR[i];
  return e / Math.max(1, s1 - s0);
}
/** Power in [lo, hi) Hz over [t0, t0 + N/sr) (Hann; N = 2048 ≈ 46 ms, the onset where masking decides). */
export function bandPower(inter, sr, t0, lo, hi, N = 2048) {
  const s0 = Math.max(0, Math.floor(t0 * sr));
  let e = 0;
  for (const c of [0, 1]) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (inter[(s0 + i) * 2 + c] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sr) / N;
      if (f >= lo && f < hi) e += re[k] * re[k] + im[k] * im[k];
    }
  }
  return e;
}

/**
 * The gameplay render: full mix, SFX alone and the bed alone (same seeds). For every scripted
 * effect: its momentary loudness (best 400 ms window from its onset) against the music + ambience
 * actually under it (full − sfx: the ducked bed) in the same window, the same in the 1–4 kHz band
 * where masking decides audibility, and how far the sidechain dipped the bed. Farming verbs
 * (marked *) must clear the bed by +4 dB; footsteps must at least match it in the 1–4 kHz band.
 */
export function analyzeGameplay(full, sfx, bed, sr, markers) {
  const diff = new Float32Array(full.length);
  for (let i = 0; i < full.length; i++) diff[i] = full[i] - sfx[i];
  const L = (p) => -0.691 + db(p);
  const rows = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const next = markers[i + 1]?.t ?? m.t + 1;
    const win = Math.min(0.4, Math.max(0.2, next - m.t));
    let best = { s: -Infinity, t: m.t };
    for (let o = 0; o <= 0.1001; o += 0.025) {
      const p = L(kPower(sfx, sr, m.t + o - 0.02, m.t + o - 0.02 + win));
      if (p > best.s) best = { s: p, t: m.t + o - 0.02 };
    }
    const under = L(kPower(diff, sr, best.t, best.t + win));
    const dry = L(kPower(bed, sr, best.t, best.t + win));
    const bs = bandPower(sfx, sr, m.t - 0.005, 1000, 4000);
    const bb = bandPower(diff, sr, m.t - 0.005, 1000, 4000);
    const verb = m.name.endsWith('*');
    const name = m.name.replace(/\*$/, '');
    const ratio = best.s - under;
    const band = 10 * Math.log10((bs + 1e-12) / (bb + 1e-12));
    rows.push({ name, t: m.t, verb, sfxLufs: best.s, bedLufs: under, ratio, band, duckDb: under - dry, window: win });
  }
  return rows;
}

export function printGameplay(rows) {
  console.log(`\n  GAMEPLAY — SFX over the score (spring theme + farm morning, game-default volumes)`);
  console.log(`  ${'effect'.padEnd(12)}    t   sfx LUFS  bed LUFS  over bed  1-4kHz/50ms over bed  sidechain dip  result`);
  const fails = [];
  for (const r of rows) {
    let ok = true;
    if (r.verb && r.ratio < 4) ok = false;
    if (!ok) fails.push(`${r.name}@${r.t}`);
    console.log(`  ${(r.name + (r.verb ? '*' : '')).padEnd(12)} ${r.t.toFixed(1).padStart(5)} ${fmt(r.sfxLufs).padStart(9)} ${fmt(r.bedLufs).padStart(9)} ${(r.ratio >= 0 ? '+' : '') + fmt(r.ratio)}`.padEnd(58) + `${(r.band >= 0 ? '+' : '') + fmt(r.band)} dB`.padStart(10) + `${fmt(r.duckDb)} dB`.padStart(15) + `  ${ok ? 'ok' : 'FAIL'}`);
  }
  const steps = rows.filter((r) => /^step:/.test(r.name));
  const verbs = rows.filter((r) => r.verb);
  // Footsteps are foley, not verbs: they may sit under the score in loudness, but their onset must
  // reach the score's own 1–4 kHz energy (median within 3 dB) or they vanish.
  const stepBand = steps.map((r) => r.band).sort((a, b) => a - b)[steps.length >> 1];
  if (steps.length && stepBand < -3) fails.push(`steps(1-4kHz median ${fmt(stepBand)} dB)`);
  console.log(`  footsteps: median ${fmt(steps.map((r) => r.ratio).sort((a, b) => a - b)[steps.length >> 1])} dB over the bed, 1–4 kHz onset median ${fmt(stepBand)} dB (need ≥ -3); farming verbs (*): min ${fmt(Math.min(...verbs.map((r) => r.ratio)))} dB (need ≥ +4)${fails.length ? `  FAIL: ${fails.join(', ')}` : '  ok'}`);
  return fails;
}


/**
 * `--calibrate`: render each theme's first `--seconds` (default 60) through the real graph, measure
 * integrated loudness (22.05 kHz renders: loudness is unaffected, rendering is twice as fast) and rewrite the MEASURED_LUFS table in src/audio/loudness.ts with the level
 * each theme has *without* its current trim (so the table converges in one or two passes).
 */
export async function calibrate(themes, call, { root, seconds: secs = 60, seed = 1, sr = 22050, log = console.log }) {
  const path = `${root}/src/audio/loudness.ts`;
  const src = readFileSync(path, 'utf8');
  const cur = {};
  const gen = /@generated-begin[\s\S]*@generated-end/.exec(src)?.[0] ?? '';
  for (const m of gen.matchAll(/'([^']+)': (-?[\d.]+)/g)) cur[m[1]] = Number(m[2]);
  const target = Number(/TARGET_LUFS = (-?[\d.]+)/.exec(src)[1]);
  const offs = {};
  const offBlock = /TARGET_OFFSET[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? '';
  for (const m of offBlock.matchAll(/'?([\w-]+)'?: (-?[\d.]+)/g)) offs[m[1]] = Number(m[2]);
  log(`calibrating ${themes.length} themes (${secs} s each) → ${target} LUFS`);
  const out = { ...cur };
  for (const t of themes) {
    const res = await call('renderTheme', [t, secs, sr, seed, false]);
    const bytes = Buffer.from(res.data, 'base64');
    const a = analyze(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), res.sampleRate);
    const tgt = target + (offs[t] ?? 0);
    // Applied trim was (tgt − cur); the untrimmed level is what we measured minus it.
    const applied = cur[t] !== undefined ? tgt - cur[t] : 0;
    const clampDb = Math.max(-14, Math.min(14, applied));
    out[t] = Math.round((a.lufsIntegrated - clampDb) * 10) / 10;
    log(`  ${t.padEnd(20)} measured ${fmt(a.lufsIntegrated)} LUFS (trim ${applied >= 0 ? '+' : ''}${fmt(applied)} dB) → untrimmed ${fmt(out[t])}, off target ${fmt(a.lufsIntegrated - tgt)} LU`);
  }
  const body = Object.keys(out).sort().map((k) => `  '${k}': ${out[k]},`).join('\n');
  const next = src.replace(/\/\/ @generated-begin[\s\S]*\/\/ @generated-end/, `// @generated-begin (scripts/audio-render.mjs --calibrate)\nexport const MEASURED_LUFS: Record<string, number> = {\n${body}\n};\n// @generated-end`);
  writeFileSync(path, next);
  log(`wrote ${Object.keys(out).length} entries to src/audio/loudness.ts`);
}

