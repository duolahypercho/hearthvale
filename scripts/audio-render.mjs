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
 *   node scripts/audio-render.mjs --compose           # composition critic only (symbolic, fast): melody shape,
 *                                                     # rubs vs the sounding harmony, parallels, cadences, texture
 *                                                     # (also printed before every theme render; --verbose lists rubs)
 *   node scripts/audio-render.mjs --stems --only spring,town   # per-track (solo) loudness / spectrum → mix balance
 *   node scripts/audio-render.mjs --live              # boot the real game: theme per scene + audible output + SFX,
 *                                                     # 20 beach⇄mine handoffs, node creation rate
 *   node scripts/audio-render.mjs --out shots/audio-r2   # write WAVs / PNGs / report.json elsewhere
 *   node scripts/audio-render.mjs --no-trans          # skip the offline director handoff renders (transition-*.wav)
 *   node scripts/audio-render.mjs --gameplay          # only the gameplay check: farming SFX over the spring theme
 *                                                     # (each effect vs the music under it; verbs must clear it by +4 dB)
 *   node scripts/audio-render.mjs --no-gameplay       # skip it in a full run
 *   node scripts/audio-render.mjs --sfx hoe,axe,rockbreak   # just these effects (reel analysis: level, centroid)
 *   node scripts/audio-render.mjs --calibrate         # measure every theme (60 s) → src/audio/loudness.ts normalisation
 *   node scripts/audio-render.mjs --no-live-budget    # render without the game's 72-voice polyphony budget
 *   Renders use the game's default volume settings and (by default) its live voice budget, so the
 *   numbers are what a player hears. Each job is isolated: a crash relaunches the browser and retries,
 *   report.json is written after every job.
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
import { writeWav, readWav, analyze, flags, row, HEADER, fmt, db, kCoeffs, biquad, analyzeGameplay, printGameplay, calibrate } from './audio-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// --out <dir> renders somewhere other than shots/audio (e.g. a critic's own folder).
const outArg = process.argv.indexOf('--out');
const outDir = resolve(root, outArg > 0 ? process.argv[outArg + 1] : 'shots/audio');
const outRel = outDir.startsWith(root) ? outDir.slice(root.length + 1) : outDir;

function parseArgs(argv) {
  const o = { seconds: 30, seed: 1, only: null, amb: true, sfx: true, mix: true, analyze: null, describe: null, compose: false, verbose: false, plots: true, stems: false, themes: true, trans: true, gameplay: true, gameplayOnly: false, sfxList: null, calibrate: false, liveBudget: true };
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
    else if (a === '--no-gameplay') o.gameplay = false;
    else if (a === '--gameplay') o.gameplayOnly = true;
    else if (a === '--calibrate') o.calibrate = true;
    else if (a === '--sfx') {
      o.sfxList = next().split(',');
      o.themes = false;
      o.amb = false;
      o.trans = false;
      o.gameplay = false;
    }
    else if (a === '--no-live-budget') o.liveBudget = false;
    else if (a === '--analyze') o.analyze = next();
    else if (a === '--describe') o.describe = next();
    else if (a === '--compose') o.compose = true;
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--out') next();
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));

// ─────────────────────────────────────────────────────────── composition critic

/**
 * Prints the symbolic critique (src/audio/critique.ts). Hard fails: a minor 9th over the bass, a
 * final A that does not land on the tonic, or unresolved rubs above 2.5 per minute.
 */
function printCritique(crits, verbose) {
  console.log(`\nCOMPOSITION (symbolic, seed ${args.seed})`);
  console.log(`${'theme'.padEnd(18)} ${'len'.padStart(5)} bars  range  step% leap% rep% unrec  strongCT%  chords  rubs(clash/b9/appog)  par/min  poly  cadences                 flags`);
  const fails = [];
  for (const c of crits) {
    const m = c.melody, h = c.harmony;
    console.log([
      c.theme.padEnd(18),
      `${c.seconds.toFixed(0)}s`.padStart(5),
      String(c.bars).padStart(4),
      `${m.lo}-${m.hi}`.padStart(8),
      String(m.stepPct).padStart(5),
      String(m.leapPct).padStart(5),
      String(m.repeatPct).padStart(4),
      `${m.unrecoveredLeaps}/${m.leaps}`.padStart(6),
      String(m.strongChordTonePct).padStart(9),
      `${h.distinct}/${h.chords}`.padStart(7),
      `${h.clashes}/${h.b9}/${h.appoggiaturas}`.padStart(20),
      String(c.parallels.perMin).padStart(8),
      `${c.texture.peakPoly}/${c.texture.meanPoly}`.padStart(8),
      c.cadences.join(' ').padEnd(30).slice(0, 30),
      c.flags.join(' ') || 'ok',
    ].join(' '));
    if (verbose || c.flags.length) for (const r of h.worst) console.log(`    ${r.kind.padEnd(12)} ${r.t.toFixed(1)}s bar ${r.bar} (${r.section}) ${r.melody} vs ${r.against}`);
    if (verbose) for (const x of c.parallels.examples) console.log(`    parallel     ${x}`);
    if (verbose || c.flags.includes('LEAPY')) for (const x of c.melody.leapExamples ?? []) console.log(`    leap         ${x}`);
    if (c.flags.some((f) => /B9-BASS|NO-TONIC|CLASHY/.test(f))) fails.push(`${c.theme}[${c.flags.join(',')}]`);
  }
  console.log('');
  return fails;
}

// ─────────────────────────────────────────────────────────── main

if (args.analyze) {
  const { inter, sr } = readWav(resolve(process.cwd(), args.analyze));
  const a = analyze(inter, sr);
  console.log(HEADER);
  console.log(row(basename(args.analyze), a, 'theme'));
  console.log(JSON.stringify(a, null, 2));
  process.exit(0);
}

/**
 * A browser page with the audio modules imported. Relaunched every few jobs (and after a crash)
 * so one long run can never take the whole report down with it.
 */
async function openSession(base, errors) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  }
  const page = await browser.newPage();
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
  await page.evaluate(async (liveBudget) => {
    window.__audioOffline = await import('/src/audio/offline.ts');
    window.__audioOffline.setRenderOptions({ liveBudget });
  }, args.liveBudget);
  return { browser, page };
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
  const errors = [];
  let sess = await openSession(base, errors);
  const closeAll = async () => {
    await sess.browser.close().catch(() => {});
    await server.close();
  };
  const call = (fn, a) => sess.page.evaluate(async ([fn, a]) => window.__audioOffline[fn](...a), [fn, a]);
  if (args.describe) {
    const d = await sess.page.evaluate(([id, seed]) => window.__audioOffline.describePiece(id, seed), [args.describe, args.seed]);
    console.log(JSON.stringify(d, null, 2));
    await closeAll();
    return;
  }
  const themes = (await sess.page.evaluate(() => window.__audioOffline.listThemes())).filter((t) => !args.only || args.only.includes(t));
  if (args.calibrate) {
    await calibrate(themes, call, { root, seconds: process.argv.includes('--seconds') ? args.seconds : 60, seed: args.seed, sr: 22050 });
    await closeAll();
    return;
  }
  let compFails = [];
  if ((args.themes || args.compose) && !args.gameplayOnly) {
    const crits = await sess.page.evaluate(([ids, seed]) => ids.map((id) => window.__audioOffline.critiquePiece(id, seed)), [themes, args.seed]);
    compFails = printCritique(crits, args.verbose);
    writeFileSync(resolve(outDir, 'composition.json'), JSON.stringify(crits, null, 2));
    if (args.compose) {
      await closeAll();
      if (compFails.length || errors.length) process.exitCode = 1;
      if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
      return;
    }
  }
  const ambs = args.amb && !args.only && !args.gameplayOnly ? await sess.page.evaluate(() => window.__audioOffline.listAmbience()) : [];
  const report = { generated: new Date().toISOString(), seconds: args.seconds, seed: args.seed, liveBudget: args.liveBudget, renders: [], sfx: [], gameplay: [], failedJobs: [] };
  const writeReport = () => writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (args.stems) {
    // Mix balance: every track of each theme soloed through the full chain (no WAV/plot output).
    console.log(`${'stem'.padEnd(30)}  LUFS  peak  centHz  sub/bas/lm/pr/air`);
    for (const t of themes) {
      const tracks = await sess.page.evaluate((id) => window.__audioOffline.themeTracks(id), t);
      for (const tr of tracks) {
        const ts = Date.now();
        const res = await call('renderTheme', [t, args.seconds, 44100, args.seed, false, tr]);
        const took = (Date.now() - ts) / 1000;
        const bytes = Buffer.from(res.data, 'base64');
        const a = analyze(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), res.sampleRate);
        const b = a.bands;
        console.log(`${res.name.padEnd(30)} ${fmt(a.lufsIntegrated).padStart(6)} ${fmt(a.peakDb).padStart(5)} ${fmt(a.centroidHz, 0).padStart(6)}  ${(b.sub * 100).toFixed(0)}/${(b.bass * 100).toFixed(0)}/${(b.lowmid * 100).toFixed(0)}/${(b.presence * 100).toFixed(0)}/${(b.air * 100).toFixed(0)}  (render ${took.toFixed(1)}s)`);
      }
    }
    await closeAll();
    return;
  }
  const jobs = [];
  if (args.gameplay && !args.only) jobs.push({ kind: 'gameplay', name: 'gameplay' });
  if (!args.gameplayOnly) {
    if (args.themes) for (const t of themes) jobs.push({ kind: 'theme', name: `theme-${t}`, fn: 'renderTheme', a: [t, args.seconds, 44100, args.seed, false] });
    if (args.mix && args.themes) for (const t of themes) jobs.push({ kind: 'mix', name: `mix-${t}`, fn: 'renderTheme', a: [t, args.seconds, 44100, args.seed, true] });
    for (const p of ambs) jobs.push({ kind: 'amb', name: `amb-${p}`, fn: 'renderAmbience', a: [p, args.seconds, 44100] });
    if (args.sfx && !args.only) jobs.push({ kind: 'sfx', name: 'sfx-reel', fn: 'renderSfxReel', a: [44100, args.sfxList] });
    // The live state machine offline: a same-place mood drift (phrase-quantised) and two changes of place.
    if (args.trans && !args.only) {
      jobs.push({ kind: 'trans', name: 'transition-spring-night-spring', fn: 'renderTransition', a: ['spring', 'night-spring', 12, 30, 'drift'] });
      jobs.push({ kind: 'trans', name: 'transition-town-beach-move', fn: 'renderTransition', a: ['town', 'beach', 12, 26, 'move'] });
      jobs.push({ kind: 'trans', name: 'transition-beach-mine-move', fn: 'renderTransition', a: ['beach', 'mine', 12, 26, 'move'] });
    }
  }

  let gameplayFails = [];
  const decode = (res) => {
    const bytes = Buffer.from(res.data, 'base64');
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  };
  console.log(HEADER);
  let sinceRelaunch = 0;
  for (const job of jobs) {
    // Fresh page every 10 jobs: long runs leak renderer memory and the OS may reap the tab.
    if (sinceRelaunch >= 10) {
      await sess.browser.close().catch(() => {});
      sess = await openSession(base, errors);
      sinceRelaunch = 0;
    }
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      const t0 = Date.now();
      try {
        sinceRelaunch++;
        if (job.kind === 'gameplay') {
          const full = await call('renderGameplay', ['full']);
          const sfx = await call('renderGameplay', ['sfx']);
          const bed = await call('renderGameplay', ['bed']);
          const F = decode(full), S = decode(sfx), B = decode(bed);
          writeWav(resolve(outDir, 'gameplay.wav'), F, full.sampleRate);
          writeWav(resolve(outDir, 'gameplay-bed.wav'), B, bed.sampleRate);
          const a = analyze(F, full.sampleRate);
          if (args.plots) plotRender(resolve(outDir, 'gameplay.png'), F, full.sampleRate, { title: 'gameplay: spring + farm morning + farming SFX', sub: `LUFS ${fmt(a.lufsIntegrated)}  dBTP ${fmt(a.truePeakDb)}`, markers: full.markers });
          console.log(row('gameplay', a, 'reel') + `  (${((Date.now() - t0) / 1000).toFixed(1)}s, 3 renders)`);
          const rows = analyzeGameplay(F, S, B, full.sampleRate, full.markers);
          gameplayFails = printGameplay(rows);
          report.gameplay = rows;
          report.renders.push({ name: 'gameplay', kind: 'gameplay', file: `${outRel}/gameplay.wav`, ...a, flags: gameplayFails.length ? ['SFX-MASKED'] : [] });
          console.log('');
        } else {
          const res = await call(job.fn, job.a);
          const inter = decode(res);
          writeWav(resolve(outDir, `${res.name}.wav`), inter, res.sampleRate);
          const a = analyze(inter, res.sampleRate);
          if (args.plots) {
            const piece = job.fn === 'renderTheme' ? await sess.page.evaluate(([id, seed, secs]) => window.__audioOffline.pieceData(id, seed, secs), [job.a[0], args.seed, args.seconds]) : undefined;
            plotRender(resolve(outDir, `${res.name}.png`), inter, res.sampleRate, { title: res.name, sub: `LUFS ${fmt(a.lufsIntegrated)}  dBTP ${fmt(a.truePeakDb)}  centroid ${fmt(a.centroidHz, 0)}HZ`, piece, markers: res.markers });
          }
          const kind = job.kind === 'mix' ? 'theme' : job.kind === 'trans' ? 'reel' : job.kind;
          console.log(row(res.name, a, job.kind === 'sfx' ? 'reel' : kind) + `  (${((Date.now() - t0) / 1000).toFixed(1)}s${res.notes ? `, ${res.notes} notes` : ''})`);
          const fl = flags(a, kind, res.name);
          if (job.kind === 'trans') transitionCheck(res, inter, fl);
          report.renders.push({ name: res.name, kind: job.kind, file: `${outRel}/${res.name}.wav`, notes: res.notes, ...a, flags: fl });
          if (res.markers && job.kind === 'sfx') sfxBalance(res, inter, report);
        }
        done = true;
      } catch (e) {
        const msg = String(e?.message ?? e).split('\n')[0];
        console.log(`${job.name.padEnd(26)} JOB FAILED (attempt ${attempt + 1}): ${msg}`);
        // Relaunch the browser and retry once.
        await sess.browser.close().catch(() => {});
        sess = await openSession(base, errors);
        sinceRelaunch = 0;
        if (attempt === 1) report.failedJobs.push({ name: job.name, error: msg });
      }
    }
    writeReport();
  }
  writeReport();
  const bad = report.renders.filter((r) => r.flags.some((f) => /CLIP|TRUEPEAK|TOO-LOUD|PHASE|DC|DULL|DEAD-AIR|SLOW-HANDOFF|SFX-MASKED/.test(f)));
  console.log(`\nwrote ${report.renders.length} WAVs + report.json to ${outRel}/`);
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
  if (report.failedJobs.length) console.log(`FAILED JOBS: ${report.failedJobs.map((j) => j.name).join(' ')}`);
  if (bad.length) console.log(`HARD FAILS: ${bad.map((b) => `${b.name}[${b.flags.join(',')}]`).join(' ')}`);
  if (compFails.length) console.log(`COMPOSITION FAILS: ${compFails.join(' ')}`);
  await closeAll();
  if (errors.length || bad.length || compFails.length || report.failedJobs.length) process.exitCode = 1;
}

/** Director handoff check (see renderTransition). */
function transitionCheck(res, inter, fl) {
  // Handoff check: the director crossfades (the new song opens on a key bridge of tones both
  // keys share while the old one fades), so what matters is (a) how long the change takes —
  // a change of place ≤ 1.6 s, a same-place drift waits for its phrase (≤ 7 s) — and (b) no
  // dead air: the longest stretch under -45 dBFS between the request and 3 s after the start.
  const sr = res.sampleRate;
  const req = res.markers[0].t;
  const start = res.markers.find((m, i) => i > 0 && /^start /.test(m.name) && m.t > req)?.t ?? req;
  const blk = (t0s) => {
    const s0 = Math.max(0, Math.floor(t0s * sr)), s1 = Math.min(inter.length / 2, s0 + Math.floor(0.1 * sr));
    let e = 0;
    for (let i = s0; i < s1; i++) e += inter[i * 2] ** 2 + inter[i * 2 + 1] ** 2;
    return 10 * Math.log10(e / Math.max(1, (s1 - s0) * 2) + 1e-12);
  };
  // Dead air is judged against the programme: 30 dB under its integrated loudness (the score now
  // plays at -21 LUFS; round 1 used a fixed -45 dBFS with the score at -15).
  const deadDb = Math.min(-45, analyze(inter, sr).lufsIntegrated - 30);
  let gap = 0;
  let run = 0;
  let floor = 0;
  for (let t = req; t < start + 3; t += 0.1) {
    const d = blk(t);
    floor = Math.min(floor, d);
    run = d < deadDb ? run + 0.1 : 0;
    gap = Math.max(gap, run);
  }
  const move = /-move$/.test(res.name);
  const delay = start - req;
  const ok = gap < 0.5 && delay <= (move ? 1.6 : 7);
  if (!ok) fl.push(gap >= 0.5 ? 'DEAD-AIR' : 'SLOW-HANDOFF');
  console.log(`  director trace: ${res.markers.slice(1).map((m) => `${m.t.toFixed(1)}s ${m.name}`).join(' | ')}`);
  console.log(`  request ${req.toFixed(1)}s → new song ${start.toFixed(1)}s (+${delay.toFixed(1)}s); quietest 100 ms ${fmt(floor)} dBFS, longest stretch under ${fmt(deadDb)} dBFS ${gap.toFixed(1)}s  ${ok ? 'ok (crossfaded, no dead air)' : fl[fl.length - 1]}\n`);
}

/** Per-effect analysis of the SFX reel. */
function sfxBalance(res, inter, report) {
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
    // (ui:hover is a deliberate 3–5 kHz tick: exempt)
    if ((x.presence > 0.35 || x.air > 0.3) && x.name !== 'ui:hover') fl.push('HARSH');
    if (IMPACTS.test(x.name) && x.centroidHz < 500) fl.push('THUD(no crunch)');
    console.log(`  ${x.name.padEnd(16)} ${fmt(x.peakDb).padStart(6)} ${fmt(x.truePeakDb).padStart(6)} ${fmt(x.momentaryMax).padStart(6)} ${fmt(x.centroidHz, 0).padStart(6)}  ${fl.join(' ') || 'ok'}`);
    report.sfx.push({ ...x, flags: fl });
  }
  console.log(`  median momentary max: ${fmt(median)} LUFS\n`);
}
/** Impacts that must carry mid/high crunch (laptop speakers roll off below ~200 Hz). */
const IMPACTS = /^(hoe|axe|pickaxe|rockbreak|sword:hit|door|treefall|hurt|place|step:wood)$/;

// ─────────────────────────────────────────────────────────── live (in-game) probe

/**
 * `--live`: boots the real game (GPU Chromium, autoplay allowed, one real click for the gesture),
 * stages scenes through window.__game and checks the audio adapter end to end: the theme the
 * selector wants for each place / time / weather, that the director actually crossfades to it, that
 * the output is audible (RMS meter), plus a burst of SFX through the game service.
 */
const LIVE_SCENES = [
  // The farm plays the season's playlist (three songs, rotated by day): any of them is right.
  { demo: 'farm-morning', expect: /^spring(-\d)?$/ },
  { demo: 'audio', season: 'summer', expect: /^summer(-\d)?$/ },
  { demo: 'audio', season: 'fall', expect: /^fall(-\d)?$/ },
  { demo: 'audio', season: 'winter', weather: 'sun', expect: /^winter(-\d)?$/ },
  { demo: 'town-day', expect: 'town' },
  { demo: 'beach-day', expect: 'beach' },
  { demo: 'mine', expect: 'mine' },
  { demo: 'winter-night', expect: /^night(-winter)?$/ },
  { demo: 'town-rain', expect: 'rain' },
  { demo: 'fest-spring', expect: /^festival/ },
  { demo: 'title', expect: 'title' },
];
const LIVE_SFX = ['step:grass', 'water', 'hoe', 'scythe', 'axe', 'pickaxe', 'rockbreak', 'harvest', 'coin', 'ui:click', 'ui:open', 'ui:close', 'ui:hover', 'ui:select', 'splash', 'sword', 'slime', 'heart', 'levelup', 'chest', 'join', 'chat', 'emote:heart'];
/** Level hierarchy: the farming verbs must sit above the menu sounds, and all of them above the ambience. */
const VERBS = ['step:grass', 'water', 'hoe', 'scythe'];
const MENU = ['ui:open', 'ui:close'];

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
      // 8 s into the song (round 1 metered only the first 2.4 s, i.e. mostly the soft intros).
      let max = -Infinity;
      for (let i = 0; i < 40; i++) {
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
    return { nodesPerSec: (window.__audioNodes - n0) / 10, maxVoices: Math.max(maxVoices, st.peakVoices ?? 0), dropped: st.dropped, theme: st.theme, ducker: st.ducker };
  });
  console.log(`synth cost (${cost.theme} on the farm): ${cost.nodesPerSec.toFixed(0)} audio nodes/s, peak ${cost.maxVoices} voices, ${cost.dropped} notes dropped by the budget; sidechain follower: ${cost.ducker}`);
  if (cost.ducker !== 'worklet') console.log('  note: sidechain is not running on the AudioWorklet follower');
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
  const lvl = (names) => names.map((n) => sfx.out.find((x) => x.name === n)?.max ?? -99);
  const verbMin = Math.min(...lvl(VERBS));
  const menuMax = Math.max(...lvl(MENU));
  const hierOk = verbMin > menuMax - 3 && verbMin > sfx.floor + 6;
  if (!hierOk) fails++;
  console.log(`  hierarchy: quietest farming verb ${fmt(verbMin)} vs loudest menu cue ${fmt(menuMax)} (ambience ${fmt(sfx.floor)})  ${hierOk ? 'ok' : 'FAIL'}`);
  // Co-op / positional: a partner's sound must pan toward them and fade with distance; far = silent.
  const pos = await page.evaluate(async () => {
    const g = window.__game;
    const a = g.game.services.audio;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    a.music('none');
    await sleep(1500);
    const p = g.game.player.position;
    const peak = async (fn) => {
      fn();
      let max = -Infinity;
      for (let i = 0; i < 10; i++) {
        await sleep(25);
        max = Math.max(max, a.meter());
      }
      await sleep(600);
      return max;
    };
    const near = await peak(() => a.playAt('hoe', p.x + 1, p.z));
    const mid = await peak(() => a.playAt('hoe', p.x + 12, p.z));
    // Far = inaudible: compare its window with an identical window where nothing is fired (the
    // ambience's own bird calls can peak in either, so each is the quieter of two tries).
    const far = Math.min(await peak(() => a.playAt('hoe', p.x + 40, p.z)), await peak(() => a.playAt('hoe', p.x + 40, p.z)));
    const floor = Math.min(await peak(() => {}), await peak(() => {}));
    await peak(() => a.stepAt(p.x + 3, p.z, { run: true }));
    a.say('player:2', 'Hello there, neighbour!', p.x - 4, p.z);
    await sleep(1500);
    a.music(null);
    return { near, mid, far, floor, compose: a.state().compose };
  });
  const posOk = pos.near > pos.mid + 4 && pos.far < pos.floor + 3;
  if (!posOk) fails++;
  console.log(`\npositional (co-op): hoe at 1 tile ${fmt(pos.near)}, 12 tiles ${fmt(pos.mid)}, 40 tiles ${fmt(pos.far)} (same window, nothing fired: ${fmt(pos.floor)}) dBFS  ${posOk ? 'ok' : 'FAIL'}`);
  const c = pos.compose;
  console.log(`songs composed in the worker: ${c.hits}, on the main thread: ${c.misses} (${c.syncMs} ms total)${c.hits === 0 ? '  FAIL' : ''}`);
  if (c.hits === 0) fails++;
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
