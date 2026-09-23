#!/usr/bin/env node
/**
 * Offline audio render + analysis — the critic's ears.
 *
 *   node scripts/audio-render.mjs                     # every theme (30 s), theme+ambience mixes, ambience presets, SFX reel
 *   node scripts/audio-render.mjs --only spring,fall  # subset of themes (also filters mixes)
 *   node scripts/audio-render.mjs --seconds 45 --seed 3 --no-amb --no-sfx --no-mix
 *   node scripts/audio-render.mjs --no-themes         # ambience presets + SFX reel only
 *   node scripts/audio-render.mjs --analyze shots/audio/theme-spring.wav   # analyse any WAV
 *   node scripts/audio-render.mjs --describe spring   # print the composed melody (symbolic)
 *   node scripts/audio-render.mjs --stems --only spring,town   # per-track (solo) loudness / spectrum → mix balance
 *   node scripts/audio-render.mjs --live              # boot the real game: theme per scene + audible output + SFX,
 *                                                     # 20 beach⇄mine handoffs, node creation rate
 *   node scripts/audio-render.mjs --no-trans          # skip the offline director handoff renders (transition-*.wav)
 *   (each render also gets a PNG: piano roll of the score + spectrogram + loudness; --no-plots to skip)
 *
 * Renders through the game's real mixer (src/audio/*, limiter included) with OfflineAudioContext
 * in headless Chromium, writes 16-bit WAVs to shots/audio/, prints a table and writes
 * shots/audio/report.json. Metrics: sample & true peak (4x), clipped samples, integrated loudness
 * (ITU-R BS.1770 K-weighted, gated), max short-term loudness, loudness range, RMS, crest factor,
 * silence %, longest silence, spectral centroid / 85 % rolloff, band shares, DC offset and stereo
 * correlation — with flags for clipping, harshness, silence, level and phase problems. The SFX reel
 * is also analysed per effect so level balance between effects can be judged.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { plotRender } from './audio-plot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/audio');

function parseArgs(argv) {
  const o = { seconds: 30, seed: 1, only: null, amb: true, sfx: true, mix: true, analyze: null, describe: null, plots: true, stems: false, themes: true, trans: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--seconds') o.seconds = Number(next());
    else if (a === '--seed') o.seed = Number(next());
    else if (a === '--only') o.only = next().split(',');
    else if (a === '--no-amb') o.amb = false;
    else if (a === '--no-sfx') o.sfx = false;
    else if (a === '--no-mix') o.mix = false;
    else if (a === '--no-themes') o.themes = false;
    else if (a === '--no-plots') o.plots = false;
    else if (a === '--no-trans') o.trans = false;
    else if (a === '--stems') o.stems = true;
    else if (a === '--analyze') o.analyze = next();
    else if (a === '--describe') o.describe = next();
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));

// ─────────────────────────────────────────────────────────── WAV I/O

function writeWav(path, inter, sr) {
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

function readWav(path) {
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

function biquad(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function kCoeffs(sr) {
  const norm = (b0, b1, b2, a0, a1, a2) => ({ b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 });
  let G = 3.999843853973347, Q = 0.7071752369554196, fc = 1681.974450955533;
  let A = Math.pow(10, G / 40), w = (2 * Math.PI * fc) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Q), sA = Math.sqrt(A);
  const shelf = norm(A * ((A + 1) + (A - 1) * cs + 2 * sA * al), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - 2 * sA * al), (A + 1) - (A - 1) * cs + 2 * sA * al, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - 2 * sA * al);
  Q = 0.5003270373238773; fc = 38.13547087602444; w = (2 * Math.PI * fc) / sr; cs = Math.cos(w); al = Math.sin(w) / (2 * Q);
  const hp = norm((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  return { shelf, hp };
}
const db = (x) => (x > 0 ? 10 * Math.log10(x) : -Infinity);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-inf');

function fft(re, im) {
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

function truePeak(x) {
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

function analyze(inter, sr) {
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
  // Spectrum (mid channel).
  const N = 4096;
  const spec = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= n; s += N) {
    let e = 0;
    for (let i = 0; i < N; i++) {
      const m = (L[s + i] + R[s + i]) * 0.5;
      e += m * m;
      re[i] = m * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    if (db(e / N) < -55) continue;
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
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

/** Day themes must have some sparkle: presence + air ≥ 12 % of the energy. */
const DAY_THEME = /^(theme|mix)-(spring|summer|fall|winter|town|beach|title|inn|forest|festival.*)$/;

function flags(a, kind, name = '') {
  const f = [];
  if (DAY_THEME.test(name) && a.bands.presence + a.bands.air < 0.12) f.push(`DULL(${((a.bands.presence + a.bands.air) * 100).toFixed(0)}%)`);
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

function row(name, a, kind) {
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
const HEADER = `${'name'.padEnd(26)}  peak    dBTP   LUFS  STmax   LRA crest sil%  centHz  sub/bas/lm/pr/air  corr flags`;

// ─────────────────────────────────────────────────────────── main

if (args.analyze) {
  const { inter, sr } = readWav(resolve(process.cwd(), args.analyze));
  const a = analyze(inter, sr);
  console.log(HEADER);
  console.log(row(basename(args.analyze), a, 'theme'));
  console.log(JSON.stringify(a, null, 2));
  process.exit(0);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir: resolve(tmpdir(), `hearthvale-vite-audio-${process.pid}`),
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const base = `http://127.0.0.1:${addr.port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  }
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Only errors from the audio modules count (other teams' in-progress files may 500 in the dev server).
  // Tune-notation mistakes surface as "[audio] ..." warnings from the composer: treat them as errors.
  page.on('console', (m) => ((m.type() === 'error' && !/Failed to load resource/.test(m.text())) || (m.type() === 'warning' && /\[audio\]/.test(m.text()))) && errors.push(m.text()));
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  // We only need the dev server's origin to import the audio modules from. Serve an empty page
  // there ourselves: the dev server's SPA fallback would otherwise hand back index.html and boot the
  // whole game (WebGL + game loop) in the background, starving the offline renders of CPU.
  page.setDefaultTimeout(0);
  await page.route(`${base}/__audio__`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>audio</title>' }));
  await page.goto(`${base}/__audio__`, { waitUntil: 'load', timeout: 180000 });
  await page.evaluate(async () => {
    window.__audioOffline = await import('/src/audio/offline.ts');
  });
  if (args.describe) {
    const d = await page.evaluate(([id, seed]) => window.__audioOffline.describePiece(id, seed), [args.describe, args.seed]);
    console.log(JSON.stringify(d, null, 2));
    await browser.close();
    await server.close();
    return;
  }
  const themes = (await page.evaluate(() => window.__audioOffline.listThemes())).filter((t) => !args.only || args.only.includes(t));
  const ambs = args.amb && !args.only ? await page.evaluate(() => window.__audioOffline.listAmbience()) : [];
  const report = { generated: new Date().toISOString(), seconds: args.seconds, seed: args.seed, renders: [], sfx: [] };
  const jobs = [];
  if (args.stems) {
    // Mix balance: every track of each theme soloed through the full chain (no WAV/plot output).
    console.log(`${'stem'.padEnd(30)}  LUFS  peak  centHz  sub/bas/lm/pr/air`);
    for (const t of themes) {
      const tracks = await page.evaluate((id) => window.__audioOffline.themeTracks(id), t);
      for (const tr of tracks) {
        const res = await page.evaluate(async ([id, secs, seed, solo]) => window.__audioOffline.renderTheme(id, secs, 44100, seed, false, solo), [t, args.seconds, args.seed, tr]);
        const bytes = Buffer.from(res.data, 'base64');
        const a = analyze(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), res.sampleRate);
        const b = a.bands;
        console.log(`${res.name.padEnd(30)} ${fmt(a.lufsIntegrated).padStart(6)} ${fmt(a.peakDb).padStart(5)} ${fmt(a.centroidHz, 0).padStart(6)}  ${(b.sub * 100).toFixed(0)}/${(b.bass * 100).toFixed(0)}/${(b.lowmid * 100).toFixed(0)}/${(b.presence * 100).toFixed(0)}/${(b.air * 100).toFixed(0)}`);
      }
    }
    await browser.close();
    await server.close();
    return;
  }
  if (args.themes) for (const t of themes) jobs.push({ kind: 'theme', fn: 'renderTheme', a: [t, args.seconds, 44100, args.seed, false] });
  if (args.mix && args.themes) for (const t of themes) jobs.push({ kind: 'mix', fn: 'renderTheme', a: [t, args.seconds, 44100, args.seed, true] });
  for (const p of ambs) jobs.push({ kind: 'amb', fn: 'renderAmbience', a: [p, args.seconds, 44100] });
  if (args.sfx && !args.only) jobs.push({ kind: 'sfx', fn: 'renderSfxReel', a: [44100] });
  // The live state machine offline: a same-place mood drift (phrase-quantised) and two changes of place.
  if (args.trans && !args.only) {
    jobs.push({ kind: 'trans', fn: 'renderTransition', a: ['spring', 'night', 12, 30, 'drift'] });
    jobs.push({ kind: 'trans', fn: 'renderTransition', a: ['town', 'beach', 12, 26, 'move'] });
    jobs.push({ kind: 'trans', fn: 'renderTransition', a: ['beach', 'mine', 12, 26, 'move'] });
  }

  console.log(HEADER);
  for (const job of jobs) {
    const t0 = Date.now();
    const res = await page.evaluate(async ([fn, a]) => window.__audioOffline[fn](...a), [job.fn, job.a]);
    const bytes = Buffer.from(res.data, 'base64');
    const inter = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    writeWav(resolve(outDir, `${res.name}.wav`), inter, res.sampleRate);
    const a = analyze(inter, res.sampleRate);
    if (args.plots) {
      const piece = job.fn === 'renderTheme' ? await page.evaluate(([id, seed, secs]) => window.__audioOffline.pieceData(id, seed, secs), [job.a[0], args.seed, args.seconds]) : undefined;
      plotRender(resolve(outDir, `${res.name}.png`), inter, res.sampleRate, { title: res.name, sub: `LUFS ${fmt(a.lufsIntegrated)}  dBTP ${fmt(a.truePeakDb)}  centroid ${fmt(a.centroidHz, 0)}HZ`, piece, markers: res.markers });
    }
    const kind = job.kind === 'mix' ? 'theme' : job.kind === 'trans' ? 'reel' : job.kind;
    console.log(row(res.name, a, job.kind === 'sfx' ? 'reel' : kind) + `  (${((Date.now() - t0) / 1000).toFixed(1)}s${res.notes ? `, ${res.notes} notes` : ''})`);
    const fl = flags(a, kind, res.name);
    if (job.kind === 'trans') {
      // Handoff check: between the change request and the new song's start the old song must
      // die away (no two keys at once). Report the quietest 400 ms and the loudness just before the start.
      const sr = res.sampleRate;
      const req = res.markers[0].t;
      const start = res.markers.find((m, i) => i > 0 && /^start /.test(m.name) && m.t > req)?.t ?? req;
      const blk = (t0s) => {
        const s0 = Math.max(0, Math.floor(t0s * sr)), s1 = Math.min(inter.length / 2, s0 + Math.floor(0.4 * sr));
        let e = 0;
        for (let i = s0; i < s1; i++) e += inter[i * 2] ** 2 + inter[i * 2 + 1] ** 2;
        return 10 * Math.log10(e / Math.max(1, (s1 - s0) * 2) + 1e-12);
      };
      let floor = 0;
      for (let t = req; t < start - 0.2; t += 0.1) floor = Math.min(floor, blk(t));
      const before = blk(Math.max(req, start - 0.45));
      const ok = before < -38;
      if (!ok) fl.push('OVERLAP');
      console.log(`  director trace: ${res.markers.slice(1).map((m) => `${m.t.toFixed(1)}s ${m.name}`).join(' | ')}`);
      console.log(`  request ${req.toFixed(1)}s → new song ${start.toFixed(1)}s; quietest block ${fmt(floor)} dBFS, last 400 ms before the new song ${fmt(before)} dBFS  ${ok ? 'ok (no overlap)' : 'OVERLAP'}\n`);
    }
    report.renders.push({ name: res.name, kind: job.kind, file: `shots/audio/${res.name}.wav`, notes: res.notes, ...a, flags: fl });
    if (res.markers && job.kind === 'sfx') {
      // Per-effect analysis.
      console.log(`\n  SFX balance (per effect: peak dBFS, true peak, momentary max LUFS, centroid)`);
      const sr = res.sampleRate;
      const ms = [];
      for (let i = 0; i < res.markers.length; i++) {
        const m = res.markers[i];
        const end = res.markers[i + 1]?.t ?? m.t + 2;
        const seg = inter.subarray(Math.floor(m.t * sr) * 2, Math.floor(end * sr) * 2);
        const sa = analyze(new Float32Array(seg), sr);
        ms.push({ name: m.name, peakDb: sa.peakDb, truePeakDb: sa.truePeakDb, momentaryMax: sa.lufsMomentaryMax, centroidHz: sa.centroidHz, presence: sa.bands.presence, air: sa.bands.air });
      }
      const sorted = ms.map((x) => x.momentaryMax).filter(Number.isFinite).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      for (const x of ms) {
        const fl = [];
        if (x.truePeakDb > -1) fl.push('HOT');
        if (x.momentaryMax > median + 9) fl.push('TOO-LOUD-vs-set');
        if (x.momentaryMax < median - 14 && !/hover|select|reel|step/.test(x.name)) fl.push('TOO-QUIET-vs-set');
        if (x.presence > 0.35 || x.air > 0.3) fl.push('HARSH');
        console.log(`  ${x.name.padEnd(16)} ${fmt(x.peakDb).padStart(6)} ${fmt(x.truePeakDb).padStart(6)} ${fmt(x.momentaryMax).padStart(6)} ${fmt(x.centroidHz, 0).padStart(6)}  ${fl.join(' ') || 'ok'}`);
        report.sfx.push({ ...x, flags: fl });
      }
      console.log(`  median momentary max: ${fmt(median)} LUFS\n`);
    }
  }
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const bad = report.renders.filter((r) => r.flags.some((f) => /CLIP|TRUEPEAK|TOO-LOUD|PHASE|DC|DULL|OVERLAP/.test(f)));
  console.log(`\nwrote ${report.renders.length} WAVs + report.json to shots/audio/`);
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
  if (bad.length) console.log(`HARD FAILS: ${bad.map((b) => `${b.name}[${b.flags.join(',')}]`).join(' ')}`);
  await browser.close();
  await server.close();
  if (errors.length || bad.length) process.exitCode = 1;
}

// ─────────────────────────────────────────────────────────── live (in-game) probe

/**
 * `--live`: boots the real game (GPU Chromium, autoplay allowed, one real click for the gesture),
 * stages scenes through window.__game and checks the audio adapter end to end: the theme the
 * selector wants for each place / time / weather, that the director actually crossfades to it, that
 * the output is audible (RMS meter), plus a burst of SFX through the game service.
 */
const LIVE_SCENES = [
  { demo: 'farm-morning', expect: 'spring' },
  { demo: 'audio', season: 'summer', expect: 'summer' },
  { demo: 'audio', season: 'fall', expect: 'fall' },
  { demo: 'audio', season: 'winter', weather: 'sun', expect: 'winter' },
  { demo: 'town-day', expect: 'town' },
  { demo: 'beach-day', expect: 'beach' },
  { demo: 'mine', expect: 'mine' },
  { demo: 'winter-night', expect: 'night' },
  { demo: 'town-rain', expect: 'rain' },
  { demo: 'fest-spring', expect: /^festival/ },
  { demo: 'title', expect: 'title' },
];
const LIVE_SFX = ['step:grass', 'hoe', 'axe', 'pickaxe', 'rockbreak', 'harvest', 'coin', 'ui:click', 'ui:open', 'splash', 'sword', 'slime', 'heart'];

async function live() {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir: resolve(tmpdir(), `hearthvale-vite-audiolive-${process.pid}`),
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const flags = ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: flags });
  } catch {
    browser = await chromium.launch({ headless: true, args: flags });
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && /audio/i.test(m.text()) && errors.push(m.text()));
  page.setDefaultTimeout(240000);
  await page.goto(`${base}/?notitle=1&audio=1&quality=low&card=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function');
  // Count audio node creation (render budget for the synth): wrap every BaseAudioContext.create*.
  await page.evaluate(() => {
    window.__audioNodes = 0;
    const P = BaseAudioContext.prototype;
    for (const k of Object.getOwnPropertyNames(P)) {
      if (!/^create(?!Buffer$|PeriodicWave$)/.test(k) || typeof P[k] !== 'function') continue;
      const f = P[k];
      P[k] = function (...a) {
        window.__audioNodes++;
        return f.apply(this, a);
      };
    }
  });
  await page.evaluate(() => window.__game.ready());
  await page.mouse.click(480, 270);
  let fails = 0;
  console.log(`${'scene'.padEnd(22)} ${'wanted'.padEnd(20)} ${'playing'.padEnd(20)} ${'maxRMS'.padStart(7)}  result`);
  for (const sc of LIVE_SCENES) {
    const res = await page.evaluate(async (sc) => {
      const g = window.__game;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      g.openUI('none');
      await g.demo(sc.demo);
      if (sc.season) g.setSeason(sc.season);
      if (sc.weather) g.setWeather(sc.weather);
      const a = g.game.services.audio;
      a.music(null);
      let st = a.state();
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        st = a.state();
        if (st.running && st.theme && st.theme === st.wanted) break;
        await sleep(250);
      }
      let max = -Infinity;
      for (let i = 0; i < 12; i++) {
        max = Math.max(max, a.meter());
        await sleep(200);
      }
      return { wanted: st.wanted, playing: st.theme, running: st.running, max };
    }, { ...sc, expect: undefined });
    const want = sc.expect;
    const okTheme = res.playing && (want instanceof RegExp ? want.test(res.playing) : res.playing === want);
    const ok = res.running && okTheme && res.max > -45;
    if (!ok) fails++;
    console.log(`${(sc.demo + (sc.season ? `/${sc.season}` : '')).padEnd(22)} ${String(res.wanted).padEnd(20)} ${String(res.playing).padEnd(20)} ${fmt(res.max).padStart(7)}  ${ok ? 'ok' : `FAIL (expected ${want})`}`);
  }
  // Reliability: the scene change that failed intermittently in round 1, twenty times in a row.
  const loop = await page.evaluate(async () => {
    const g = window.__game;
    const a = g.game.services.audio;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    for (let i = 0; i < 20; i++) {
      const target = i % 2 === 0 ? 'mine' : 'beach-day';
      g.openUI('none');
      await g.demo(target);
      a.music(null);
      const t0 = performance.now();
      let st = a.state();
      while (performance.now() - t0 < 12000) {
        st = a.state();
        if (st.running && st.theme && st.theme === st.wanted) break;
        await sleep(100);
      }
      out.push({ target, wanted: st.wanted, theme: st.theme, ms: Math.round(performance.now() - t0), ok: st.theme === st.wanted && !!st.theme, trace: st.trace.slice(-3).map((x) => `${x.t}s ${x.note}`).join(' | '), stalls: st.stalls });
    }
    return out;
  });
  const loopFails = loop.filter((l) => !l.ok);
  console.log(`\nbeach⇄mine handoffs: ${loop.length - loopFails.length}/${loop.length} ok, median ${loop.map((l) => l.ms).sort((x, y) => x - y)[loop.length >> 1]} ms to the right theme (max ${Math.max(...loop.map((l) => l.ms))} ms)`);
  for (const l of loopFails) console.log(`  FAIL → ${l.target}: wanted ${l.wanted}, playing ${l.theme} after ${l.ms} ms; trace: ${l.trace}; clock stalls ${l.stalls}`);
  fails += loopFails.length;

  // Synth cost: audio nodes created per second while the spring theme plays on the farm.
  const cost = await page.evaluate(async () => {
    const g = window.__game;
    const a = g.game.services.audio;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.openUI('none');
    await g.demo('farm-morning');
    a.music('spring');
    await sleep(6000);
    const n0 = window.__audioNodes;
    let maxVoices = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      maxVoices = Math.max(maxVoices, a.state().voices);
    }
    const st = a.state();
    a.music(null);
    return { nodesPerSec: (window.__audioNodes - n0) / 10, maxVoices, dropped: st.dropped, theme: st.theme };
  });
  console.log(`synth cost (${cost.theme} on the farm): ${cost.nodesPerSec.toFixed(0)} audio nodes/s, peak ${cost.maxVoices} voices, ${cost.dropped} notes dropped by the budget`);
  if (cost.nodesPerSec > 400) {
    fails++;
    console.log('  FAIL: node creation rate over 400/s');
  }

  // SFX through the game service over the farm's ambience bed (music silenced).
  const sfx = await page.evaluate(async (names) => {
    const g = window.__game;
    const a = g.game.services.audio;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.openUI('none');
    await g.demo('farm-morning');
    a.music('none');
    await sleep(5000);
    const floor = a.meter();
    const out = [];
    for (const n of names) {
      a.play(n);
      let max = -Infinity;
      for (let i = 0; i < 8; i++) {
        await sleep(30);
        max = Math.max(max, a.meter());
      }
      out.push({ name: n, max });
      await sleep(500);
    }
    a.music(null);
    return { floor, out };
  }, LIVE_SFX);
  console.log(`\nSFX via game service (ambience floor ${fmt(sfx.floor)} dBFS RMS):`);
  for (const s of sfx.out) {
    const ok = s.max > sfx.floor + 3 && s.max < -3;
    if (!ok) fails++;
    console.log(`  ${s.name.padEnd(14)} ${fmt(s.max).padStart(7)}  ${ok ? 'ok' : 'FAIL'}`);
  }
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
  console.log(fails || errors.length ? `\n${fails} live check(s) failed` : '\nall live checks passed');
  await browser.close();
  await server.close();
  if (fails || errors.length) process.exitCode = 1;
}

(process.argv.includes('--live') ? live() : main()).catch((e) => {
  console.error(e);
  process.exit(2);
});
