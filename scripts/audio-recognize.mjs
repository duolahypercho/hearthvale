#!/usr/bin/env node
/**
 * Blind recognition test for the sound design (round 17, critic r6: "coverage is excellent, but
 * objective evidence does not yet support AAA articulation ... several tool and combat impacts share
 * similarly shaped oscillator-heavy transients ... add blind recognition tests for villagers,
 * surfaces and tools without visual context").
 *
 *   node scripts/audio-recognize.mjs                  # every group, 6 takes each
 *   node scripts/audio-recognize.mjs --takes 8 --groups voices,surfaces --out shots/audio-r10/recognize
 *
 * Renders every effect of each group several times (offline.renderSfxTakes: a fresh generator and
 * seed per take, so the per-repeat pitch / level variation and the random grains all differ; each
 * villager speaks a different line per take) through the real mixer, then — without being told what
 * any take is — classifies each one by the class whose OTHER takes it is nearest (leave-one-out,
 * nearest class centroid on z-scored features). Features are what a listener goes by:
 *   - spectral shape (24 log bands 60 Hz–16 kHz, dB re the take's own total: level-invariant)
 *   - the transient's own shape (12 bands over the first 30 ms after the onset)
 *   - the envelope: attack, decay to -10 / -20 / -30 dB, number of distinct hits, length
 *   - centroid over time (0–50 ms, 50–200 ms, 200–600 ms)
 *   - the pitch track (autocorrelation, 40 ms frames): register (median), how much it moves (IQR),
 *     how much of it is pitched — and the hit / syllable rate (a speaker's tempo)
 * Groups are judged on their own (a listener asked "which surface?", "which tool?", "who's talking?").
 * Gates: each group ≥ 90 % correct, no class under 2/3 of its takes, and no effect pressed > 3 dB
 * into the master limiter (measured on a second, limiter-bypassed pass); the confusion matrix and the nearest
 * rival per class (with its margin) are printed. Also prints the impact set's peak / crest / attack
 * so "every hit peaks at the same ceiling" can be checked. Writes <out>/recognize.json.
 * (A machine proxy for a listening test — it measures whether the designs are distinguishable, not
 * whether they are pleasant.)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { fft, db, writeWav, kPower } from './audio-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const TAKES = Number(opt('takes', 6));
const OUT = resolve(root, opt('out', 'shots/audio/recognize'));
const GROUPS = {
  surfaces: ['step:grass', 'step:dirt', 'step:wood', 'step:stone', 'step:sand', 'step:snow', 'step:water'],
  tools: ['hoe', 'axe', 'pickaxe', 'scythe', 'water', 'sword', 'weed', 'swing'],
  // (mine:pick is the farm pickaxe by design — the same verb on the same rock — so it is not a class.)
  impacts: ['hoe', 'axe', 'pickaxe', 'rockbreak', 'sword:hit', 'hit:slime', 'hit:crab', 'hit:bat', 'hit:imp', 'hit:wisp', 'parry'],
  voices: ['voice:marigold', 'voice:bram', 'voice:wren', 'voice:odessa', 'voice:linus', 'voice:june', 'voice:tobias', 'voice:kit'],
};
const want = opt('groups', null)?.split(',') ?? Object.keys(GROUPS);
const MIN_GROUP = 0.9;
const MIN_CLASS = Math.ceil(TAKES * 0.66);

// ─────────────────────────────────────────── features

const N = 2048;
const hann = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
function spectrum(mono, s0, sr) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (mono[s0 + i] ?? 0) * hann[i];
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}
function bands(p, sr, nb, lo, hi) {
  const out = new Float64Array(nb);
  for (let k = 1; k < p.length; k++) {
    const f = (k * sr) / N;
    if (f < lo || f >= hi) continue;
    const b = Math.min(nb - 1, Math.floor((Math.log(f / lo) / Math.log(hi / lo)) * nb));
    out[b] += p[k];
  }
  return out;
}
const shape = (b) => {
  const tot = b.reduce((x, y) => x + y, 0) + 1e-20;
  return [...b].map((x) => Math.max(-60, db(x / tot)));
};
function presenceShare(p, sr) {
  let a = 0, w = 0;
  for (let k = 1; k < p.length; k++) {
    const f = (k * sr) / N;
    if (f >= 2000 && f < 4000) a += p[k];
    w += p[k];
  }
  return w > 0 ? a / w : 0;
}
function centroid(p, sr) {
  let a = 0, w = 0;
  for (let k = 1; k < p.length; k++) {
    a += p[k] * ((k * sr) / N);
    w += p[k];
  }
  return w > 0 ? a / w : 0;
}

function features(inter, sr, t, len) {
  const s0 = Math.floor(t * sr), n = Math.floor(len * sr);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = ((inter[(s0 + i) * 2] ?? 0) + (inter[(s0 + i) * 2 + 1] ?? 0)) * 0.5;
  // 5 ms envelope.
  const hop = Math.floor(sr * 0.005);
  const env = [];
  for (let s = 0; s + hop <= n; s += hop) {
    let e = 0;
    for (let i = s; i < s + hop; i++) e += mono[i] * mono[i];
    env.push(db(e / hop + 1e-20));
  }
  const peak = Math.max(...env);
  const pk = env.indexOf(peak);
  const onset = Math.max(0, env.findIndex((v) => v > peak - 30));
  const attackMs = (pk - onset) * 5 + 1;
  const decay = (d) => {
    let k = pk;
    while (k < env.length && env[k] > peak - d) k++;
    return (k - pk) * 5 + 1;
  };
  const above = env.filter((v) => v > peak - 30).length * 5;
  let hits = 0;
  for (let k = 3; k < env.length; k++) if (env[k] > peak - 24 && env[k] - Math.min(env[k - 1], env[k - 2], env[k - 3]) > 6) hits++;
  // Spectra: whole event (frames above -40 dB re peak), the transient, three time slices.
  const whole = new Float64Array(N / 2);
  const slice = [new Float64Array(N / 2), new Float64Array(N / 2), new Float64Array(N / 2)];
  const on = onset * hop;
  for (let s = on; s + N <= n; s += N / 2) {
    const ms = ((s - on) / sr) * 1000;
    const p = spectrum(mono, s, sr);
    const e = p.reduce((x, y) => x + y, 0);
    if (db(e) < peak - 45 + 10 * Math.log10(N)) continue;
    for (let k = 0; k < p.length; k++) whole[k] += p[k];
    const sl = ms < 50 ? 0 : ms < 200 ? 1 : ms < 600 ? 2 : -1;
    if (sl >= 0) for (let k = 0; k < p.length; k++) slice[sl][k] += p[k];
  }
  // The transient: a 30 ms Hann-windowed frame at the onset (zero-padded to N).
  const tr = new Float32Array(N);
  const tn = Math.floor(sr * 0.03);
  for (let i = 0; i < tn; i++) tr[i] = (mono[on + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (tn - 1)));
  const trp = spectrum(tr, 0, sr);
  // Pitch track: autocorrelation (60–600 Hz) on 40 ms frames every 25 ms wherever the take is within
  // 25 dB of its peak — the register (median), how much it moves (IQR, semitones) and how much of it
  // is pitched at all. (A voice is known by its register and its tune; a ringing tool by its note.)
  const f0s = [];
  let framesOn = 0;
  const L = Math.floor(sr * 0.04);
  const step = Math.floor(sr * 0.025);
  const lagLo = Math.floor(sr / 600), lagHi = Math.floor(sr / 60);
  for (let a = on; a + L + lagHi < n; a += step) {
    const ek = Math.floor((a - on) / hop) + onset;
    if (!(env[ek] > peak - 25)) continue;
    framesOn++;
    let best = 0, lag = 0;
    for (let l = lagLo; l < lagHi; l += 1) {
      let c = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < L; i += 2) {
        const x = mono[a + i], y = mono[a + i + l];
        c += x * y;
        e1 += x * x;
        e2 += y * y;
      }
      const r = c / Math.sqrt(e1 * e2 + 1e-20);
      if (r > best) {
        best = r;
        lag = l;
      }
    }
    if (best > 0.55 && lag) f0s.push(12 * Math.log2(sr / lag / 55));
    if (framesOn > 60) break;
  }
  f0s.sort((x, y) => x - y);
  const q = (p) => (f0s.length ? f0s[Math.min(f0s.length - 1, Math.floor(p * (f0s.length - 1)))] : 0);
  const f0Med = q(0.5) / 12;
  const f0Iqr = f0s.length > 3 ? (q(0.75) - q(0.25)) / 6 : 0;
  const voiced = framesOn ? f0s.length / framesOn : 0;
  // Syllable / hit rate: envelope rises per second.
  const rate = hits / Math.max(0.05, (env.length * 5) / 1000);
  const cen = slice.map((p) => Math.log2(Math.max(50, centroid(p, sr))));
  const vec = [
    ...shape(bands(whole, sr, 24, 60, 16000)),
    ...shape(bands(trp, sr, 12, 60, 16000)),
    Math.log2(attackMs), Math.log2(decay(10)), Math.log2(decay(20)), Math.log2(decay(30)), Math.log2(above + 1), hits,
    ...cen,
    f0Med, f0Iqr, voiced, Math.log2(1 + rate),
  ];
  // Peak / crest / attack for the impact table.
  // (Peak per channel, as the limiter sees it — a centred mono average would read 3 dB low.)
  let pkAbs = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    pkAbs = Math.max(pkAbs, Math.abs(inter[(s0 + i) * 2] ?? 0), Math.abs(inter[(s0 + i) * 2 + 1] ?? 0));
    ss += mono[i] * mono[i] * 2;
  }
  const rmsAbove = Math.sqrt(ss / Math.max(1, above * sr * 0.001));
  return { vec, meta: { peakDb: 20 * Math.log10(pkAbs + 1e-12), crestDb: 20 * Math.log10((pkAbs + 1e-12) / (rmsAbove + 1e-12)), attackMs, decay20Ms: decay(20), hits, centroidHz: Math.round(centroid(whole, sr)), f0: f0s.length ? Math.round(55 * 2 ** (q(0.5) / 12)) : 0, presence: presenceShare(whole, sr) } };
}

// Weighted: the spectral bands are many correlated dims; the envelope / pitch few but decisive.
const WEIGHTS = (dim) => (dim < 24 ? 1 : dim < 36 ? 0.8 : dim < 42 ? 2 : dim < 45 ? 1.6 : dim === 45 ? 3 : 2);

function classify(items) {
  const D = items[0].vec.length;
  const mean = new Array(D).fill(0), sd = new Array(D).fill(0);
  for (const it of items) it.vec.forEach((v, d) => (mean[d] += v / items.length));
  for (const it of items) it.vec.forEach((v, d) => (sd[d] += (v - mean[d]) ** 2 / items.length));
  for (let d = 0; d < D; d++) sd[d] = Math.sqrt(sd[d]) || 1;
  const z = items.map((it) => it.vec.map((v, d) => ((v - mean[d]) / sd[d]) * WEIGHTS(d)));
  const classes = [...new Set(items.map((it) => it.name))];
  const dist = (a, b) => Math.sqrt(a.reduce((s, v, d) => s + (v - b[d]) ** 2, 0));
  const res = [];
  items.forEach((it, i) => {
    let best = null;
    const scores = {};
    for (const c of classes) {
      const others = items.map((x, j) => [x, j]).filter(([x, j]) => x.name === c && j !== i);
      if (!others.length) continue;
      const cen = new Array(D).fill(0);
      for (const [, j] of others) z[j].forEach((v, d) => (cen[d] += v / others.length));
      const dd = dist(z[i], cen);
      scores[c] = dd;
      if (!best || dd < best.d) best = { c, d: dd };
    }
    const rival = Object.entries(scores).filter(([c]) => c !== it.name).sort((a, b) => a[1] - b[1])[0];
    res.push({ name: it.name, take: it.take, guess: best.c, margin: rival ? rival[1] - scores[it.name] : 0, rival: rival?.[0] });
  });
  return res;
}

// ─────────────────────────────────────────── render

async function main() {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir: resolve(tmpdir(), `hearthvale-vite-recog-${process.pid}`),
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.setDefaultTimeout(0);
  await page.route(`${base}/__audio__`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>audio</title>' }));
  await page.goto(`${base}/__audio__`, { waitUntil: 'load', timeout: 180000 });
  await page.evaluate(async () => {
    window.__audioOffline = await import('/src/audio/offline.ts');
  });
  // A second pass of the impact set without the master limiter: each design's own peak (how far it
  // would push into the ceiling), so the impact table can show they are not all pressed flat.
  const RAW = !argv.includes('--no-raw');
  mkdirSync(OUT, { recursive: true });
  const report = { takes: TAKES, groups: {}, fails: [] };
  console.log(`BLIND RECOGNITION — ${TAKES} takes per effect, leave-one-out nearest class (each group judged on its own)`);
  for (const g of want) {
    const names = GROUPS[g];
    if (!names) continue;
    const t0 = Date.now();
    const res = await page.evaluate(([names, takes]) => window.__audioOffline.renderSfxTakes(names, takes), [names, TAKES]);
    const bytes = Buffer.from(res.data, 'base64');
    const inter = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    writeWav(resolve(OUT, `takes-${g}.wav`), inter, res.sampleRate);
    const items = res.markers.map((m, i) => {
      const next = res.markers[i + 1]?.t ?? m.t + 2;
      const f = features(inter, res.sampleRate, m.t - 0.005, Math.min(3.2, next - m.t - 0.05));
      // Momentary loudness (max K-weighted 400 ms), the reel's level measure.
      let mom = -Infinity;
      for (let t = m.t - 0.05; t < Math.min(next - 0.4, m.t + 1.2); t += 0.02) mom = Math.max(mom, -0.691 + db(kPower(inter, res.sampleRate, t, t + 0.4)));
      f.meta.momentary = mom;
      return { name: m.name, take: m.take, ...f };
    });
    const cls = classify(items);
    const correct = cls.filter((c) => c.guess === c.name).length;
    const acc = correct / cls.length;
    console.log(`\n${g.toUpperCase()}: ${correct}/${cls.length} = ${(acc * 100).toFixed(0)} % recognised  (render ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    const per = [];
    for (const n of names) {
      const mine = cls.filter((c) => c.name === n);
      const ok = mine.filter((c) => c.guess === n).length;
      const wrong = mine.filter((c) => c.guess !== n).map((c) => c.guess.replace(/^(voice|step):/, ''));
      const rivals = mine.map((c) => c.rival);
      const rival = rivals.sort((a, b) => rivals.filter((x) => x === b).length - rivals.filter((x) => x === a).length)[0];
      const margin = mine.reduce((s, c) => s + c.margin, 0) / mine.length;
      const ms = items.filter((x) => x.name === n).map((x) => x.meta);
      const avg = (k) => ms.reduce((s, m) => s + m[k], 0) / ms.length;
      const row = { name: n, ok, of: mine.length, confusedWith: wrong, nearestRival: rival, margin: Math.round(margin * 100) / 100, peakDb: Math.round(avg('peakDb') * 10) / 10, crestDb: Math.round(avg('crestDb') * 10) / 10, attackMs: Math.round(avg('attackMs')), decay20Ms: Math.round(avg('decay20Ms')), centroidHz: Math.round(avg('centroidHz')), f0: Math.round(avg('f0')), presencePct: Math.round(avg('presence') * 1000) / 10, momentaryLufs: Math.round(avg('momentary') * 10) / 10 };
      per.push(row);
      const fl = ok < MIN_CLASS ? 'FAIL' : ok < mine.length ? 'ok~ ' : 'ok  ';
      console.log(`  ${fl} ${n.replace(/^(voice|step):/, '').padEnd(10)} ${ok}/${mine.length}${wrong.length ? ` (heard as ${wrong.join(', ')})` : ''}`.padEnd(48) + `nearest rival ${String(rival?.replace(/^(voice|step):/, '')).padEnd(9)} margin ${row.margin.toFixed(2).padStart(5)} · ${row.momentaryLufs.toFixed(1)} LUFS-M peak ${row.peakDb.toFixed(1)} dBFS crest ${row.crestDb.toFixed(1)} dB attack ${row.attackMs} ms decay-20 ${row.decay20Ms} ms centroid ${row.centroidHz} Hz, ${row.presencePct} % in 2-4 kHz${row.f0 ? ` f0 ${row.f0} Hz` : ''}`);
      if (ok < MIN_CLASS) report.fails.push(`${g}: ${n} ${ok}/${mine.length}`);
    }
    if (acc < MIN_GROUP) report.fails.push(`${g}: ${(acc * 100).toFixed(0)} % < ${MIN_GROUP * 100} %`);
    if (RAW && g !== 'voices') {
      // The same takes without the limiter: the designs' own peaks (pre-ceiling).
      await page.evaluate(() => window.__audioOffline.setRenderOptions({ bypassLimiter: true }));
      const raw = await page.evaluate(([names, takes]) => window.__audioOffline.renderSfxTakes(names, takes), [names, TAKES]);
      await page.evaluate(() => window.__audioOffline.setRenderOptions({ bypassLimiter: false }));
      const rb = Buffer.from(raw.data, 'base64');
      const ri = new Float32Array(rb.buffer, rb.byteOffset, rb.length / 4);
      for (const row of per) {
        const pks = raw.markers.filter((m) => m.name === row.name).map((m, i, arr) => {
          const k = raw.markers.indexOf(m);
          const end = raw.markers[k + 1]?.t ?? m.t + 2;
          let p = 0;
          for (let s = Math.floor(m.t * raw.sampleRate) * 2; s < Math.floor(end * raw.sampleRate) * 2 && s < ri.length; s++) p = Math.max(p, Math.abs(ri[s]));
          return 20 * Math.log10(p + 1e-12);
        });
        row.rawPeakDb = Math.round((pks.reduce((a, b) => a + b, 0) / pks.length) * 10) / 10;
      }
      for (const r of per) r.limiterDb = Math.round(Math.max(0, r.rawPeakDb + 1) * 10) / 10;
      console.log(`  into the limiter (threshold -1 dBFS → dB of gain reduction): ${per.map((r) => `${r.name.replace(/^step:/, '')} ${r.rawPeakDb} → ${r.limiterDb}`).join(' · ')}`);
      const over = per.filter((r) => r.limiterDb > 3);
      if (over.length) report.fails.push(`${g}: limited > 3 dB: ${over.map((r) => `${r.name} ${r.limiterDb}`).join(', ')}`);
      report.groups[g + ':limiter'] = Object.fromEntries(per.map((r) => [r.name, { intoDb: r.rawPeakDb, reductionDb: r.limiterDb }]));
    }
    if (g === 'impacts') {
      const pk = per.map((r) => r.peakDb);
      const spread = Math.max(...pk) - Math.min(...pk);
      const atk = per.map((r) => r.attackMs);
      console.log(`  impact peaks span ${spread.toFixed(1)} dB (${Math.min(...pk).toFixed(1)} … ${Math.max(...pk).toFixed(1)} dBFS), attacks ${Math.min(...atk)}–${Math.max(...atk)} ms, decays ${Math.min(...per.map((r) => r.decay20Ms))}–${Math.max(...per.map((r) => r.decay20Ms))} ms`);
      report.impactPeakSpreadDb = Math.round(spread * 10) / 10;
    }
    report.groups[g] = { accuracy: Math.round(acc * 1000) / 1000, classes: per };
  }
  if (errors.length) {
    console.log(`page errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
    report.fails.push('page errors');
  }
  writeFileSync(resolve(OUT, 'recognize.json'), JSON.stringify(report, null, 2));
  console.log(report.fails.length ? `\nRECOGNITION FAILS: ${report.fails.join('; ')}` : `\nall groups ≥ ${MIN_GROUP * 100} %, every class ≥ ${MIN_CLASS}/${TAKES}`);
  await browser.close();
  await server.close();
  if (report.fails.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
