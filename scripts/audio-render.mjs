#!/usr/bin/env node
/**
 * Offline audio render + analysis — the critic's ears.
 *
 *   node scripts/audio-render.mjs                     # every theme (30 s), theme+ambience mixes, ambience presets, SFX reel
 *   node scripts/audio-render.mjs --only spring,fall  # subset of themes (also filters mixes)
 *   node scripts/audio-render.mjs --seconds 45 --seed 3 --no-amb --no-sfx --no-mix
 *   node scripts/audio-render.mjs --no-themes         # ambience presets + SFX reel only
 *   node scripts/audio-render.mjs --amb farm-summer-noon,mine   # just these ambience presets
 *   node scripts/audio-render.mjs --analyze shots/audio/theme-spring.wav   # analyse any WAV (profile from
 *                                                     # --kind theme|amb|reel|sfx, else the run's manifest, else the name)
 *   node scripts/audio-render.mjs --describe spring   # print the composed melody (symbolic)
 *   node scripts/audio-render.mjs --compose           # composition critic only (symbolic, fast): melody shape,
 *                                                     # rubs vs the sounding harmony, parallels, cadences, texture
 *                                                     # (also printed before every theme render; --verbose lists rubs)
 *   node scripts/audio-render.mjs --stems --only spring,town   # per-track (solo) loudness / spectrum → mix balance
 *   node scripts/audio-render.mjs --live              # boot the real game: theme per scene + audible output + SFX,
 *                                                     # 20 beach⇄mine handoffs, node creation rate
 *   node scripts/audio-render.mjs --coop              # two real clients (host + farmhand) over the relay: the farmhand
 *                                                     # hears the host's hoe (SFX log + meter peak), both play the same festival theme
 *   node scripts/audio-render.mjs --out shots/audio-r2   # write WAVs / PNGs / report.json elsewhere
 *   node scripts/audio-render.mjs --no-trans          # skip the offline director handoff renders (transition-*.wav)
 *   node scripts/audio-render.mjs --gameplay          # only the gameplay check: farming SFX over the spring theme
 *                                                     # (each effect vs the music under it; verbs must clear it by +4 dB)
 *   node scripts/audio-render.mjs --no-gameplay       # skip it in a full run
 *   node scripts/audio-render.mjs --sfx hoe,axe,rockbreak   # just these effects (reel analysis: level, centroid)
 *   node scripts/audio-render.mjs --calibrate         # measure every theme's opening (first 30 s) → src/audio/loudness.ts
 *                                                     # normalisation; fails if two openings land > 2 LU apart
 *   node scripts/audio-render.mjs --keep-wav          # also keep the mix-* WAVs (analysed + plotted either way)
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
import { mkdirSync, readFileSync, writeFileSync, statfsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { plotRender } from './audio-plot.mjs';
import { writeWav, readWav, analyze, flags, row, HEADER, fmt, db, kCoeffs, biquad, analyzeGameplay, printGameplay, calibrate, openingSpread, OPENING_SECONDS, kPower, bassHoles, bandRatios, eventDensity, ambienceFlags, inferKind, KIND_PROFILES, formAnalysis } from './audio-analysis.mjs';

/**
 * The house curve (round 12): every song's opening lands within ±2 dB of it per band (the spectral
 * calibration in src/audio/loudness.ts TONE_TRIM applies the correcting shelves). In dB re 0.5–2.5 kHz.
 */
const HOUSE = { low: -6, lowmid: -3, high: -9 };
/** (Round 6: judged against the song's own family curve — loudness.ts TONE_HOUSE: day / soft / cave.) */
const FAMILY_HOUSE = { day: { low: -7, high: -9 }, soft: { low: -6, high: -11 }, cave: { low: -6, high: -12 } };
const familyOf = (id) => (id.startsWith('mine') ? 'cave' : /^(night|rain|event-|inn)/.test(id) ? 'soft' : 'day');
const toneDeviation = (t, id = '') => {
  const h = id ? FAMILY_HOUSE[familyOf(id)] : HOUSE;
  return Math.max(Math.abs(t.low - h.low), Math.abs(t.high - h.high));
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// --out <dir> renders somewhere other than shots/audio (e.g. a critic's own folder).
const outArg = process.argv.indexOf('--out');
const outDir = resolve(root, outArg > 0 ? process.argv[outArg + 1] : 'shots/audio');
const outRel = outDir.startsWith(root) ? outDir.slice(root.length + 1) : outDir;
// A full run writes ~180 MB (themes, ambience, reel; mixes only with --keep-wav): warn early.
try {
  const st = statfsSync(root);
  const freeMb = (st.bavail * st.bsize) / 1048576;
  if (freeMb < 1500) console.warn(`WARNING: only ${freeMb.toFixed(0)} MB free on this disk — a full render needs ~200 MB (${process.argv.includes('--keep-wav') ? '~400 MB with --keep-wav' : 'mix WAVs are not kept'}).`);
} catch {
  /* statfs unavailable: skip the check */
}

/**
 * Whole-song renders in a default run (round 17): one song per family, chosen for the longest forms
 * (B / C strains, bridges, reprises) — the parts a 30 s opening never reaches. Seamless loops
 * (title, festivals) are judged at their loop seam.
 */
const FULL_DEFAULT = ['spring', 'summer', 'fall', 'winter-2', 'town', 'beach', 'night-spring', 'mine-2', 'festival-harvest', 'title'];

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
    else if (a === '--keep-wav') o.keepWav = true;
    else if (a === '--sfx') {
      o.sfxList = next().split(',');
      o.themes = false;
      o.amb = false;
      o.trans = false;
      o.gameplay = false;
    }
    else if (a === '--amb') {
      // Just these ambience presets (e.g. --amb farm-summer-noon,mine): no themes / SFX / mixes.
      o.ambList = next().split(',');
      o.themes = false;
      o.sfx = false;
      o.mix = false;
      o.trans = false;
      o.gameplay = false;
    }
    else if (a === '--full') {
      // Whole songs (round 17): `--full` = the representative set (FULL_DEFAULT), `--full all` = every
      // song, `--full spring,town` = these. Alone it renders only these; a default run includes the set.
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? next() : 'default';
      o.full = v === 'default' ? FULL_DEFAULT : v === 'all' ? 'all' : v.split(',');
      o.fullOnly = true;
    }
    else if (a === '--no-full') o.noFull = true;
    else if (a === '--no-live-budget') o.liveBudget = false;
    else if (a === '--analyze') o.analyze = next();
    else if (a === '--kind') o.kind = next();
    else if (a === '--describe') o.describe = next();
    else if (a === '--compose') o.compose = true;
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--out') next();
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
if (args.fullOnly) Object.assign(args, { themes: false, amb: false, sfx: false, mix: false, trans: false, gameplay: false });

// ─────────────────────────────────────────────────────────── composition critic

/**
 * Prints the symbolic critique (src/audio/critique.ts). Hard fails: a minor 9th over the bass, a
 * final A that does not land on the tonic, or unresolved rubs above 2.5 per minute.
 */
function printCritique(crits, verbose) {
  console.log(`\nCOMPOSITION (symbolic, seed ${args.seed})`);
  console.log(`${'theme'.padEnd(18)} ${'len'.padStart(5)} bars  range  step% leap% rep% unrec  strongCT%  chords  rubs(clash/b9/appog)  par/min  poly  crowd% gap  cadences                 flags`);
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
      String(c.register?.crowdPct ?? '-').padStart(6),
      String(c.register?.tenorGap ?? '-').padStart(4),
      c.cadences.join(' ').padEnd(30).slice(0, 30),
      c.flags.join(' ') || 'ok',
    ].join(' '));
    if (verbose || c.flags.length) for (const r of h.worst) console.log(`    ${r.kind.padEnd(12)} ${r.t.toFixed(1)}s bar ${r.bar} (${r.section}) ${r.melody} vs ${r.against}`);
    if (verbose) for (const x of c.parallels.examples) console.log(`    parallel     ${x}`);
    if (verbose || c.flags.includes('LEAPY')) for (const x of c.melody.leapExamples ?? []) console.log(`    leap         ${x}`);
    if (c.flags.some((f) => /B9-BASS|NO-TONIC|CLASHY|MASKED-TUNE|HOLLOW-MIDDLE/.test(f))) fails.push(`${c.theme}[${c.flags.join(',')}]`);
  }
  console.log('');
  return fails;
}

// ─────────────────────────────────────────────────────────── main

if (args.analyze) {
  const file = resolve(process.cwd(), args.analyze);
  const { inter, sr } = readWav(file);
  const a = analyze(inter, sr);
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(resolve(dirname(file), 'manifest.json'), 'utf8'));
  } catch {
    /* no manifest next to the file */
  }
  const inferred = args.kind ? { kind: args.kind, source: '--kind' } : inferKind(file, manifest);
  if (!KIND_PROFILES[inferred.kind]) {
    console.error(`unknown --kind ${inferred.kind} (theme | amb | reel | sfx)`);
    process.exit(2);
  }
  console.log(`threshold profile: ${inferred.kind} (from ${inferred.source}) — ${KIND_PROFILES[inferred.kind]}`);
  const name = basename(file).replace(/\.wav$/, '');
  const extra = inferred.kind === 'amb' ? ambienceFlags(name, a, inter, sr) : [];
  console.log(HEADER);
  console.log(row(name, a, inferred.kind));
  if (a.eventsLine) console.log(a.eventsLine);
  if (extra.length) console.log(`  ${extra.join('  ')}`);
  a.kind = inferred.kind;
  a.flags = [...flags(a, inferred.kind, name), ...extra];
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
  const allThemes = await sess.page.evaluate(() => window.__audioOffline.listThemes());
  const themes = allThemes.filter((t) => !args.only || args.only.includes(t));
  if (args.calibrate) {
    await calibrate(themes, call, { root, seconds: process.argv.includes('--seconds') ? args.seconds : OPENING_SECONDS + 2, seed: args.seed, sr: 44100 });
    await closeAll();
    return;
  }
  let compFails = [];
  if ((args.themes || args.compose) && !args.gameplayOnly) {
    const crits = await sess.page.evaluate(([ids, seed]) => ids.map((id) => window.__audioOffline.critiquePiece(id, seed)), [themes, args.seed]);
    compFails = printCritique(crits, args.verbose);
    // Identity (round 12): songs in one playlist must not open on the same two chords, and the
    // Imaj7 → IVmaj7 lo-fi opening is allowed at most twice in the whole book.
    const op = await sess.page.evaluate(() => window.__audioOffline.openings());
    const norm = (p) => p.replace(/maj7|7|add9|6|sus[24]/g, '');
    console.log('\nOPENINGS (first two chords heard · form · intro bars)');
    for (const [id, o] of Object.entries(op.songs)) if (!args.only || args.only.includes(id)) console.log(`  ${id.padEnd(18)} ${o.pair.padEnd(16)} ${o.form.padEnd(34)} ${o.intro}`);
    for (const [pl, ids] of Object.entries(op.playlists)) {
      const seen = new Map();
      for (const id of ids) {
        const k = norm(op.songs[id]?.pair ?? '');
        if (seen.has(k)) {
          compFails.push(`SAME-OPENING(${pl}: ${seen.get(k)} / ${id} both open ${k})`);
        } else seen.set(k, id);
      }
    }
    const lofi = Object.entries(op.songs).filter(([, o]) => o.pair === 'Imaj7 IVmaj7').map(([id]) => id);
    if (lofi.length > 2) compFails.push(`LOFI-OPENING(${lofi.join(', ')})`);
    const forms = new Map();
    for (const o of Object.values(op.songs)) forms.set(o.form, (forms.get(o.form) ?? 0) + 1);
    const top = [...forms].sort((x, y) => y[1] - x[1])[0];
    console.log(`  most shared form: ${top?.[0]} × ${top?.[1]} of ${Object.keys(op.songs).length}; Imaj7–IVmaj7 openings: ${lofi.join(', ') || 'none'}`);
    writeFileSync(resolve(outDir, 'composition.json'), JSON.stringify(crits, null, 2));
    if (args.compose) {
      await closeAll();
      if (compFails.length || errors.length) process.exitCode = 1;
      if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
      return;
    }
  }
  const ambs = (args.amb && !args.only && !args.gameplayOnly ? await sess.page.evaluate(() => window.__audioOffline.listAmbience()) : []).filter((p) => !args.ambList || args.ambList.includes(p));
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
    const fullIds = args.noFull ? [] : args.full === 'all' ? allThemes : args.full ?? (args.only ? [] : args.themes && args.mix && args.amb && args.sfx && args.trans && args.gameplay ? FULL_DEFAULT : []);
    for (const t of fullIds.filter((x) => allThemes.includes(x))) jobs.push({ kind: 'full', name: `full-${t}`, theme: t });
    for (const p of ambs) jobs.push({ kind: 'amb', name: `amb-${p}`, fn: 'renderAmbience', a: [p, args.seconds, 44100] });
    if (args.sfx && !args.only) jobs.push({ kind: 'sfx', name: 'sfx-reel', fn: 'renderSfxReel', a: [44100, args.sfxList] });
    // The live state machine offline: a same-place mood drift (phrase-quantised) and two changes of place.
    if (args.trans && !args.only) {
      jobs.push({ kind: 'trans', name: 'transition-spring-night-spring', fn: 'renderTransition', a: ['spring', 'night-spring', 12, 30, 'drift'] });
      jobs.push({ kind: 'trans', name: 'transition-town-beach-move', fn: 'renderTransition', a: ['town', 'beach', 12, 26, 'move'] });
      jobs.push({ kind: 'trans', name: 'transition-beach-mine-move', fn: 'renderTransition', a: ['beach', 'mine', 12, 26, 'move'] });
    }
  }

  // Round 7 (critic r6: "no single current end-to-end artifact"): a manifest of every job this run
  // is expected to produce, written up front and updated after each job, with the source revision
  // it was rendered from. A default run (no --only / --amb / --sfx filters) lists every theme, mix,
  // ambience preset, the SFX reel, the gameplay render and the three transitions; the verdict passes
  // only when every expected job rendered with no flag at all, and the composition critic, SFX
  // hierarchy, gameplay masking and opening-loudness checks are clean.
  const manifest = {
    generated: report.generated,
    rev: gitRev(),
    defaultRun: !args.only && !args.ambList && !args.sfxList && args.amb && args.sfx && args.mix && args.themes && args.trans && args.gameplay && !args.gameplayOnly,
    argv: process.argv.slice(2),
    expected: jobs.map((j) => ({ name: j.name, kind: j.kind, status: 'pending', flags: [] })),
    checks: {},
    verdict: null,
  };
  const writeManifest = () => writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeManifest();
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
        if (job.kind === 'full') {
          // A whole song: one pass of its form + the ring-out (or 4 s into the next pass of a loop).
          const info = await sess.page.evaluate(([id, seed]) => window.__audioOffline.songInfo(id, seed), [job.theme, args.seed]);
          const secs = Math.min(260, info.duration + (info.looping ? 4 : 7));
          const res = await call('renderTheme', [job.theme, secs, 44100, args.seed, false]);
          res.name = job.name;
          const inter = decode(res);
          writeWav(resolve(outDir, `${job.name}.wav`), inter, res.sampleRate);
          const a = analyze(inter, res.sampleRate);
          const piece = await sess.page.evaluate(([id, seed, s]) => window.__audioOffline.pieceData(id, seed, s), [job.theme, args.seed, secs]);
          const form = formAnalysis(inter, res.sampleRate, piece, info.duration, info.looping, res.stats);
          a.form = form;
          a.songSeconds = info.duration;
          if (args.plots) plotRender(resolve(outDir, `${job.name}.png`), inter, res.sampleRate, { title: `${job.name} (whole song, ${info.form})`, sub: `LUFS ${fmt(a.lufsIntegrated)}  dBTP ${fmt(a.truePeakDb)}  LRA ${fmt(a.lra)}  ${form.sections.map((x) => x.label).join(' ')}`, piece });
          // Whole-song loudness is judged by the section rules, not the opening's (a quiet bridge is form).
          const fl = [...flags(a, 'reel', job.name), ...form.flags];
          console.log(row(job.name, a, 'reel') + `  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${info.duration.toFixed(0)} s song${info.looping ? ', loops' : ''})`);
          console.log(`  form ${info.form}: ${form.sections.map((x) => `${x.label}@${x.t0.toFixed(0)}s ${fmt(x.lufs)} LUFS ${fmt(x.centroidHz, 0)} Hz ${x.maxNotes}n`).join(' | ')}`);
          console.log(`  seams: ${form.seams.map((x) => `${x.label} ${x.quiet}s`).join(', ') || '-'} · ending ${JSON.stringify(form.ending)} · distinct melody bars ${(form.novelty * 100).toFixed(0)} % of ${form.melodyBars} · voices peak ${res.stats?.peakVoices ?? '?'} dropped ${res.stats?.dropped ?? '?'}`);
          if (form.flags.length) console.log(`  ${form.flags.join('  ')}`);
          report.renders.push({ name: job.name, kind: 'full', file: `${outRel}/${job.name}.wav`, ...a, flags: fl });
        } else if (job.kind === 'gameplay') {
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
          // Mixes are analysed + plotted but (by default) not kept on disk: a full run otherwise
          // writes ~350 MB of WAVs (--keep-wav keeps them).
          const keep = job.kind !== 'mix' || args.keepWav;
          if (keep) writeWav(resolve(outDir, `${res.name}.wav`), inter, res.sampleRate);
          const a = analyze(inter, res.sampleRate);
          const piece = job.fn === 'renderTheme' ? await sess.page.evaluate(([id, seed, secs]) => window.__audioOffline.pieceData(id, seed, secs), [job.a[0], args.seed, args.seconds]) : undefined;
          let extraFlags = [];
          if (job.kind === 'amb') {
            extraFlags.push(...ambienceFlags(res.name, a, inter, res.sampleRate));
          }
          if (job.kind === 'theme' && piece) {
            // Round 12 critic rules: low-end holes before downbeats (sustained bass patterns) and the
            // song's tonal balance against the house curve (band ratios in dB re 0.5–2.5 kHz).
            // (Section seams are exempt: a written stop-time / breath before a new strain is a rest.)
            const holes = bassHoles(inter, res.sampleRate, piece.bars.filter((b, k) => k > 0 && b.section === piece.bars[k - 1].section).map((b) => b.t));
            a.bassHoles = holes;
            a.tone = bandRatios(inter, res.sampleRate, OPENING_SECONDS);
            // (Root / pedal patterns hold their notes; a waltz's oom-pah bass lifts after beat 1 by design.)
            if (holes.count > 0 && ['root', 'pedal'].includes(piece.bass ?? '')) extraFlags.push(`BASS-HOLE(${holes.count}, ${holes.worstDb} dB)`);
            // (Round 8: any pattern — a plucked waltz / jig / walking bass may lift, but a low end that
            // falls more than 14 dB into a downbeat is a gap, not articulation.)
            else if (holes.worstDb > 14) extraFlags.push(`BASS-HOLE(${holes.count}, ${holes.worstDb} dB)`);
            const dev = toneDeviation(a.tone, job.name.replace(/^theme-/, ''));
            if (dev > 3) extraFlags.push(`TONE(${dev.toFixed(1)} dB off the house curve)`);
          }
          if (args.plots) {
            plotRender(resolve(outDir, `${res.name}.png`), inter, res.sampleRate, { title: res.name, sub: `LUFS ${fmt(a.lufsIntegrated)}  dBTP ${fmt(a.truePeakDb)}  centroid ${fmt(a.centroidHz, 0)}HZ`, piece, markers: res.markers });
          }
          const kind = job.kind === 'mix' ? 'theme' : job.kind === 'trans' ? 'reel' : job.kind;
          console.log(row(res.name, a, job.kind === 'sfx' ? 'reel' : kind) + `  (${((Date.now() - t0) / 1000).toFixed(1)}s${res.notes ? `, ${res.notes} notes` : ''})`);
          const fl = [...flags(a, kind, res.name), ...extraFlags];
          if (a.eventsLine) console.log(a.eventsLine);
          if (extraFlags.length) console.log(`  ${extraFlags.join('  ')}`);
          if (job.kind === 'theme' && a.tone) console.log(`  tone re mid: low ${fmt(a.tone.low)} lowmid ${fmt(a.tone.lowmid)} high ${fmt(a.tone.high)} dB; bass dips before downbeats: ${a.bassHoles.count} (worst ${fmt(a.bassHoles.worstDb)} dB)`);
          if (job.kind === 'trans') transitionCheck(res, inter, fl);
          if (job.kind === 'mix') {
            // Ambience vs score (round 5): the same seed's theme render is the music alone, so the
            // power the mix adds is the ambience's. The beds must sit within 10 LU of the music.
            const th = report.renders.find((r) => r.name === res.name.replace(/^mix-/, 'theme-'));
            if (th && Number.isFinite(th.lufsIntegrated)) {
              const extra = Math.pow(10, a.lufsIntegrated / 10) - Math.pow(10, th.lufsIntegrated / 10);
              const ambLu = extra > 0 ? 10 * Math.log10(extra) : -Infinity;
              const under = th.lufsIntegrated - ambLu;
              a.ambienceUnderMusic = Number.isFinite(under) ? Math.round(under * 10) / 10 : null;
              // (Round 12: informational only — the beds were lifted to meet this and became washes; an
              // ambience is now judged on its own render by event density and loudness range.)
              console.log(`  ambience ≈ ${fmt(ambLu)} LUFS, ${fmt(under)} LU under the music`);
            }
          }
          report.renders.push({ name: res.name, kind: job.kind, file: keep ? `${outRel}/${res.name}.wav` : null, notes: res.notes, ...a, flags: fl });
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
    const m = manifest.expected.find((x) => x.name === job.name);
    if (m) {
      const r = done ? report.renders.findLast((x) => x.name === job.name || (job.kind === 'gameplay' && x.name === 'gameplay')) : null;
      m.status = !done || !r ? 'failed' : r.flags.length ? 'flagged' : 'ok';
      m.flags = r?.flags ?? [];
      if (r) Object.assign(m, { lufs: r.lufsIntegrated, truePeakDb: r.truePeakDb, centroidHz: r.centroidHz });
    }
    writeReport();
    writeManifest();
  }
  // Opening loudness: every theme's first 30 s within 2 LU of every other (offsets removed).
  const themeRows = report.renders.filter((r) => r.kind === 'theme').map((r) => ({ name: r.name.replace(/^theme-/, ''), lufs: r.lufsIntegrated }));
  if (themeRows.length > 1 && args.seconds <= OPENING_SECONDS + 5) {
    const offs = loudnessOffsets();
    const o = openingSpread(themeRows, offs);
    report.openingSpread = o;
    console.log(`\nOPENING LOUDNESS (first ${args.seconds}s, offsets removed): spread ${fmt(o.spread)} LU — quietest ${o.lo[0]} ${fmt(o.lo[1])}, loudest ${o.hi[0]} ${fmt(o.hi[1])}  ${o.ok ? 'ok' : 'FAIL (> 2 LU)'}`);
    if (!o.ok) report.renders.push({ name: 'opening-spread', kind: 'check', flags: ['OPENING-SPREAD'] });
  }
  writeReport();
  const bad = report.renders.filter((r) => r.flags.some((f) => /CLIP|TRUEPEAK|TOO-LOUD|PHASE|DC|DULL|THIN|DEAD-AIR|SLOW-HANDOFF|SFX-MASKED|OPENING-SPREAD|AMB-BURIED|FORM-/.test(f)));
  console.log(`\nwrote ${report.renders.length} WAVs + report.json to ${outRel}/`);
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
  if (report.failedJobs.length) console.log(`FAILED JOBS: ${report.failedJobs.map((j) => j.name).join(' ')}`);
  if (bad.length) console.log(`HARD FAILS: ${bad.map((b) => `${b.name}[${b.flags.join(',')}]`).join(' ')}`);
  if (report.sfxHierarchyFails?.length) console.log(`SFX HIERARCHY FAILS: ${report.sfxHierarchyFails.join('; ')}`);
  if (compFails.length) console.log(`COMPOSITION FAILS: ${compFails.join(' ')}`);
  // Manifest verdict.
  const st = (k) => manifest.expected.filter((x) => x.status === k);
  manifest.checks = {
    composition: compFails,
    openingSpread: report.openingSpread ?? null,
    sfxHierarchy: report.sfxHierarchyFails ?? [],
    gameplayMasked: gameplayFails,
    pageErrors: errors.slice(0, 20),
  };
  const clean = !compFails.length && !(report.sfxHierarchyFails?.length) && !gameplayFails.length && !errors.length && (!report.openingSpread || report.openingSpread.ok);
  manifest.verdict = { jobs: manifest.expected.length, ok: st('ok').length, flagged: st('flagged').map((x) => `${x.name}[${x.flags.join(',')}]`), failed: st('failed').map((x) => x.name), missing: st('pending').map((x) => x.name), checksClean: clean, pass: clean && st('ok').length === manifest.expected.length, complete: manifest.defaultRun };
  manifest.finished = new Date().toISOString();
  writeManifest();
  const v = manifest.verdict;
  console.log(`\nMANIFEST (${outRel}/manifest.json, rev ${manifest.rev}${manifest.defaultRun ? ', default full run' : ', partial run'}): ${v.ok}/${v.jobs} jobs ok, ${v.flagged.length} flagged, ${v.failed.length} failed, ${v.missing.length} missing; checks ${clean ? 'clean' : 'NOT clean'} → ${v.pass ? 'PASS' : 'FAIL'}`);
  if (v.flagged.length) console.log(`  flagged: ${v.flagged.join(' ')}`);
  await closeAll();
  if (errors.length || bad.length || compFails.length || report.failedJobs.length || report.sfxHierarchyFails?.length || !manifest.verdict.pass) process.exitCode = 1;
}

/** Source revision a render was made from: short hash, plus '+dirty' when the audio sources differ from it. */
function gitRev() {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
    const dirty = execSync('git status --porcelain -- src/audio src/systems/audio.ts scripts/audio-render.mjs scripts/audio-analysis.mjs', { cwd: root }).toString().trim();
    return dirty ? `${head}+dirty(${dirty.split('\n').length} audio files)` : head;
  } catch {
    return 'unknown';
  }
}

/** The deliberate per-theme loudness offsets (src/audio/loudness.ts TARGET_OFFSET). */
function loudnessOffsets() {
  const src = readFileSync(resolve(root, 'src/audio/loudness.ts'), 'utf8');
  const offs = {};
  const block = /TARGET_OFFSET[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? '';
  for (const m of block.matchAll(/'?([\w-]+)'?: (-?[\d.]+)/g)) offs[m[1]] = Number(m[2]);
  return offs;
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
  console.log(`\n  SFX balance (per effect: peak dBFS, true peak, momentary max LUFS, 100 ms max LUFS, centroid)`);
  const sr = res.sampleRate;
  const ms = [];
  for (let i = 0; i < res.markers.length; i++) {
    const m = res.markers[i];
    const end = res.markers[i + 1]?.t ?? m.t + 2;
    const seg = inter.subarray(Math.floor(m.t * sr) * 2, Math.floor(end * sr) * 2);
    const sa = analyze(new Float32Array(seg), sr);
    // Short-window loudness (max K-weighted 100 ms, ≈ the ear's integration time): a 15 ms click
    // reads ~8 dB under its perceived level in a 400 ms momentary window, so UI cues are ranked here.
    let short = -Infinity;
    for (let t = m.t - 0.01; t < Math.min(end, m.t + 1.2); t += 0.01) short = Math.max(short, -0.691 + db(kPower(inter, sr, t, t + 0.1)));
    ms.push({ name: m.name, peakDb: sa.peakDb, truePeakDb: sa.truePeakDb, momentaryMax: sa.lufsMomentaryMax, short, centroidHz: sa.centroidHz, presence: sa.bands.presence, air: sa.bands.air });
  }
  const sorted = ms.map((x) => x.momentaryMax).filter(Number.isFinite).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  for (const x of ms) {
    const fl = [];
    if (x.truePeakDb > -1) fl.push('HOT');
    // Thunder is a deliberate +10 dB weather event (it also ducks the score), not a level slip.
    if (x.momentaryMax > median + 9 && !/thunder/.test(x.name)) fl.push('TOO-LOUD-vs-set');
    if (x.momentaryMax < median - 14 && !/hover|select|reel|step/.test(x.name)) fl.push('TOO-QUIET-vs-set');
    // (ui:hover is a deliberate 3–5 kHz tick: exempt)
    if ((x.presence > 0.35 || x.air > 0.3) && x.name !== 'ui:hover') fl.push('HARSH');
    if (IMPACTS.test(x.name) && x.centroidHz < 500) fl.push('THUD(no crunch)');
    console.log(`  ${x.name.padEnd(16)} ${fmt(x.peakDb).padStart(6)} ${fmt(x.truePeakDb).padStart(6)} ${fmt(x.momentaryMax).padStart(6)} ${fmt(x.short).padStart(6)} ${fmt(x.centroidHz, 0).padStart(6)}  ${fl.join(' ') || 'ok'}`);
    report.sfx.push({ ...x, flags: fl });
  }
  console.log(`  median momentary max: ${fmt(median)} LUFS`);
  // Hierarchy assertions (round 4): a constant hover tick sits well under a click, click ≈ select,
  // open / close above click, the error cue at least as loud as open, the core UI set within 8 LU;
  // dialogue voices within ±1.5 LU of each other; a connecting sword hit lands over the swing.
  // UI cues and the sword pair are ranked on 100 ms loudness (short sounds), voices on momentary.
  const M = Object.fromEntries(ms.map((x) => [x.name, x.short]));
  const checks = [];
  const has = (...n) => n.every((k) => Number.isFinite(M[k]));
  if (has('ui:hover', 'ui:click')) checks.push([`ui:hover ${fmt(M['ui:hover'] - M['ui:click'])} LU vs click (need ≤ -4)`, M['ui:hover'] - M['ui:click'] <= -4]);
  if (has('ui:select', 'ui:click')) checks.push([`ui:select ${fmt(M['ui:select'] - M['ui:click'])} LU vs click (need ±2)`, Math.abs(M['ui:select'] - M['ui:click']) <= 2]);
  if (has('ui:open', 'ui:click')) checks.push([`ui:open ${fmt(M['ui:open'] - M['ui:click'])} LU vs click (need > 0)`, M['ui:open'] > M['ui:click']]);
  if (has('ui:close', 'ui:click')) checks.push([`ui:close ${fmt(M['ui:close'] - M['ui:click'])} LU vs click (need > 0)`, M['ui:close'] > M['ui:click']]);
  if (has('ui:error', 'ui:open')) checks.push([`ui:error ${fmt(M['ui:error'] - M['ui:open'])} LU vs open (need ≥ -0.5)`, M['ui:error'] >= M['ui:open'] - 0.5]);
  const uiSet = ['ui:click', 'ui:hover', 'ui:open', 'ui:close', 'ui:error', 'ui:select', 'ui:tab', 'ui:slot', 'ui:toggle', 'ui:tick'].map((k) => M[k]).filter(Number.isFinite);
  if (uiSet.length > 2) checks.push([`UI spread ${fmt(Math.max(...uiSet) - Math.min(...uiSet))} LU (need ≤ 8.5)`, Math.max(...uiSet) - Math.min(...uiSet) <= 8.5]);
  const vs = ms.filter((x) => x.name.startsWith('voice:') && Number.isFinite(x.momentaryMax));
  if (vs.length > 1) {
    const lo = vs.reduce((a, b) => (b.momentaryMax < a.momentaryMax ? b : a)), hi = vs.reduce((a, b) => (b.momentaryMax > a.momentaryMax ? b : a));
    checks.push([`voice spread ${fmt(hi.momentaryMax - lo.momentaryMax)} LU (${lo.name.slice(6)} … ${hi.name.slice(6)}, need ≤ 3)`, hi.momentaryMax - lo.momentaryMax <= 3]);
  }
  if (has('sword:hit', 'sword')) checks.push([`sword:hit ${fmt(M['sword:hit'] - M.sword)} LU vs sword (need ≥ +2)`, M['sword:hit'] - M.sword >= 2]);
  // Round 5: payoffs louder than their setups (momentary: these are long events), steps level per surface.
  const Mm = Object.fromEntries(ms.map((x) => [x.name, x.momentaryMax]));
  const hasM = (...n) => n.every((k) => Number.isFinite(Mm[k]));
  if (hasM('treefall', 'axe')) checks.push([`treefall ${fmt(Mm.treefall - Mm.axe)} LU vs axe (need ≥ +4)`, Mm.treefall - Mm.axe >= 4]);
  if (hasM('rockbreak', 'pickaxe')) checks.push([`rockbreak ${fmt(Mm.rockbreak - Mm.pickaxe)} LU vs pickaxe (need ≥ +3)`, Mm.rockbreak - Mm.pickaxe >= 3]);
  const stepPk = Object.fromEntries(ms.filter((x) => x.name.startsWith('step:')).map((x) => [x.name.slice(5), x.peakDb]));
  // (against the median peak of the firm surfaces — grass / dirt / wood / stone)
  const firm = ['grass', 'dirt', 'wood', 'stone'].map((k) => stepPk[k]).filter(Number.isFinite).sort((a, b) => a - b);
  const firmMed = firm.length ? (firm[(firm.length - 1) >> 1] + firm[firm.length >> 1]) / 2 : NaN;
  // One random step per surface on the reel: its sample peak wanders ±2 dB between renders, so the
  // peak gets ±3 dB and the 100 ms loudness (the steadier measure) ±2 LU.
  const stepSh = Object.fromEntries(ms.filter((x) => x.name.startsWith('step:')).map((x) => [x.name.slice(5), x.short]));
  const firmS = ['grass', 'dirt', 'wood', 'stone'].map((k) => stepSh[k]).filter(Number.isFinite).sort((a, b) => a - b);
  const firmSMed = firmS.length ? (firmS[(firmS.length - 1) >> 1] + firmS[firmS.length >> 1]) / 2 : NaN;
  for (const sf of ['sand', 'snow']) {
    if (Number.isFinite(stepPk[sf]) && Number.isFinite(firmMed)) checks.push([`step:${sf} peak ${fmt(stepPk[sf] - firmMed)} dB / 100 ms ${fmt(stepSh[sf] - firmSMed)} LU vs the firm surfaces' median (need ±3 dB / ±2 LU)`, Math.abs(stepPk[sf] - firmMed) <= 3 && Math.abs(stepSh[sf] - firmSMed) <= 2]);
  }
  for (const [msg, ok] of checks) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  report.sfxChecks = checks.map(([msg, ok]) => ({ msg, ok }));
  report.sfxHierarchyFails = checks.filter(([, ok]) => !ok).map(([m]) => m);
  console.log('');
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
  { demo: 'town-day', expect: /^town(-[a-z0-9]+)?$/ },
  { demo: 'beach-day', expect: /^beach(-2)?$/ },
  { demo: 'mine', expect: 'mine' },
  { demo: 'winter-night', expect: /^night(-winter)?$/ },
  // Summer nights rotate the new 'Firefly Meadow' (night-summer) with Lamplight.
  { demo: 'audio-night', expect: /^night(-summer)?$/ },
  { demo: 'town-rain', expect: /^rain(-\d)?$/ },
  { demo: 'fest-spring', expect: /^festival/ },
  // The event score (songbook-events.ts): a heart event / story scene swaps the square's music for its
  // cue (quick fade), and the place's music comes back when it ends.
  { demo: 'town-day', label: 'heart-event june-2', emit: [['npc:event', { id: 'june-2', npcId: 'june', phase: 'start' }]], expect: 'event-wistful' },
  { demo: 'town-day', label: 'heart-event kit-2', emit: [['npc:event', { id: 'kit-2', npcId: 'kit', phase: 'start' }]], after: [['npc:event', { id: 'kit-2', npcId: 'kit', phase: 'end' }]], expect: 'event-playful' },
  { demo: 'town-day', label: 'after the event', expect: /^town(-[a-z0-9]+)?$/ },
  { demo: 'town-day', label: 'scene glimmer-offer', emit: [['cutscene:start', { scene: 'glimmer-offer' }]], after: [['cutscene:end', { scene: 'glimmer-offer', skipped: false }]], expect: 'event-sly' },
  { demo: 'title', expect: 'title' },
];
const LIVE_SFX = ['step:grass', 'water', 'hoe', 'scythe', 'axe', 'pickaxe', 'rockbreak', 'harvest', 'coin', 'ui:click', 'ui:open', 'ui:close', 'ui:hover', 'ui:select', 'ui:slot', 'splash', 'sword', 'slime', 'hit:slime', 'hit:crab', 'hit:bat', 'mine:pick', 'mine:break', 'heart', 'levelup', 'chest', 'join', 'chat', 'emote:heart'];
/** Level hierarchy: the farming verbs must sit above the menu sounds, and all of them above the ambience. */
const VERBS = ['step:grass', 'water', 'hoe', 'scythe'];
const MENU = ['ui:open', 'ui:close'];
/** Combat must land at least as hard as tilling (round 12: the blows sat 9 dB under the hoe). */
const COMBAT = ['hit:slime', 'hit:crab', 'hit:bat'];

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
  // Every AudioContext the page constructs (there must be exactly one: the hub's).
  await page.addInitScript(() => {
    const C = window.AudioContext;
    window.__audioContexts = 0;
    if (C) {
      window.AudioContext = class extends C {
        constructor(...a) {
          super(...a);
          window.__audioContexts++;
        }
      };
    }
  });
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
      for (const [n, p] of sc.emit ?? []) g.game.events.emit(n, p);
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
      for (const [n, p] of sc.after ?? []) g.game.events.emit(n, p);
      return { wanted: st.wanted, playing: st.theme, running: st.running, max };
    }, { ...sc, expect: undefined });
    const want = sc.expect;
    const okTheme = res.playing && (want instanceof RegExp ? want.test(res.playing) : res.playing === want);
    const ok = res.running && okTheme && res.max > -45;
    if (!ok) fails++;
    console.log(`${(sc.label ?? sc.demo + (sc.season ? `/${sc.season}` : '')).padEnd(22)} ${String(res.wanted).padEnd(20)} ${String(res.playing).padEnd(20)} ${fmt(res.max).padStart(7)}  ${ok ? 'ok' : `FAIL (expected ${want})`}`);
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
    // The ambience floor: the median of 2 s of meter reads (one 46 ms read could land on a rooster,
    // a dove or a woodpecker — the beds now carry sparse foreground critters, not a steady wash).
    const reads = [];
    for (let i = 0; i < 20; i++) {
      reads.push(a.meter());
      await sleep(100);
    }
    reads.sort((x, y) => x - y);
    const floor = reads[10];
    const out = [];
    // Each effect three times, median of the peaks: effects carry ±1.2 dB of humanised level and the
    // 30 ms meter can land either side of a transient, so one shot made the hierarchy check flaky.
    for (const n of names) {
      const peaks = [];
      for (let k = 0; k < 3; k++) {
        a.play(n);
        let max = -Infinity;
        for (let i = 0; i < 8; i++) {
          await sleep(30);
          max = Math.max(max, a.meter());
        }
        peaks.push(max);
        await sleep(500);
      }
      peaks.sort((x, y) => x - y);
      out.push({ name: n, max: peaks[1] });
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
  const combatMin = Math.min(...lvl(COMBAT));
  const hoe = lvl(['hoe'])[0];
  const combatOk = combatMin > hoe - 1.5;
  if (!combatOk) fails++;
  console.log(`  combat: quietest monster blow ${fmt(combatMin)} vs the hoe ${fmt(hoe)}  ${combatOk ? 'ok' : 'FAIL'}`);

  // Mine / combat cues (world/mine/sfx.ts) are voiced on the main graph via the audio hub: one voice
  // per kind for a 3-monster sweep, positional, no second AudioContext anywhere on the page.
  const mine = await page.evaluate(async () => {
    const g = window.__game;
    const a = g.game.services.audio;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await g.demo('audio-mine');
    a.music('none');
    await sleep(2500);
    const { mineSfx } = await import('/src/world/mine/sfx.ts');
    const p = g.game.player.position;
    const before = a.state().sfxLog.length;
    const t0 = a.state().sfxLog.at(-1)?.at ?? 0;
    for (let i = 0; i < 3; i++) mineSfx.hit('slime', false, i === 2, { x: p.x + 1 + i * 0.3, z: p.z });
    await sleep(120);
    const log = a.state().sfxLog.filter((x) => x.at > t0);
    const peak = async (fn) => {
      fn();
      let max = -Infinity;
      for (let i = 0; i < 10; i++) {
        await sleep(25);
        max = Math.max(max, a.meter());
      }
      await sleep(700);
      return max;
    };
    const fl = [];
    for (let i = 0; i < 12; i++) {
      fl.push(a.meter());
      await sleep(60);
    }
    fl.sort((x, y) => x - y);
    const mineFloor = fl[6];
    const nearHit = await peak(() => mineSfx.hit('crab', false, false, { x: p.x + 1, z: p.z }));
    const farHit = await peak(() => mineSfx.hit('crab', false, false, { x: p.x + 12, z: p.z }));
    a.music(null);
    return { voiced: log.map((x) => x.name), grew: a.state().sfxLog.length - before, nearHit, farHit, mineFloor, contexts: window.__audioContexts ?? null };
  });
  const sweepOk = mine.voiced.filter((n) => n === 'hit:slime').length === 1;
  const mPosOk = mine.nearHit > mine.farHit + 5;
  if (!sweepOk || !mPosOk) fails++;
  if (mine.contexts !== 1) fails++;
  console.log(`  AudioContexts constructed on the page: ${mine.contexts}  ${mine.contexts === 1 ? 'ok' : 'FAIL (one graph only)'}`);
  console.log(`  mine: 3-slime sweep voiced as [${mine.voiced.join(', ')}] ${sweepOk ? 'ok' : 'FAIL (expected one hit:slime)'}; crab blow at 1 tile ${fmt(mine.nearHit)} vs 12 tiles ${fmt(mine.farHit)} (cave floor ${fmt(mine.mineFloor)})  ${mPosOk ? 'ok' : 'FAIL'}`);
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
    const far = Math.min(await peak(() => a.playAt("hoe", p.x + 40, p.z)), await peak(() => a.playAt("hoe", p.x + 40, p.z)), await peak(() => a.playAt("hoe", p.x + 40, p.z)));
    const floor = Math.min(await peak(() => {}), await peak(() => {}));
    await peak(() => a.stepAt(p.x + 3, p.z, { run: true }));
    a.say('player:2', 'Hello there, neighbour!', p.x - 4, p.z);
    await sleep(1500);
    a.music(null);
    return { near, mid, far, floor, compose: a.state().compose, notes: a.state().notes, frame: window.__game.info().perf.frame };
  });
  const posOk = pos.near > pos.mid + 4 && pos.far < pos.floor + 3;
  if (!posOk) fails++;
  console.log(`\npositional (co-op): hoe at 1 tile ${fmt(pos.near)}, 12 tiles ${fmt(pos.mid)}, 40 tiles ${fmt(pos.far)} (same window, nothing fired: ${fmt(pos.floor)}) dBFS  ${posOk ? 'ok' : 'FAIL'}`);
  const c = pos.compose;
  console.log(`songs composed in the worker: ${c.hits}, on the main thread: ${c.misses} (${c.syncMs} ms total)${c.hits === 0 ? '  FAIL' : ''}`);
  if (c.hits === 0) fails++;
  const nb = pos.notes;
  if (nb) {
    // Mallet / string notes: the worker renders each song's pitches ahead of time; the frame only pays
    // for a pitch the worker hasn't delivered yet (a song's first bar at boot, an SFX's bell).
    const bad = nb.worker === 0;
    const by = Object.entries(nb.byInst ?? {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(`note buffers from the worker: ${nb.worker}, on the main thread: ${nb.main} (${nb.mainMs} ms total${by ? `: ${by}` : ''}), cache ${nb.cacheMb} MB${bad ? '  FAIL' : ''}`);
    if (nb.recentMain?.length) console.log(`  last notes rendered on the main thread ('!' = LRU had dropped it): ${nb.recentMain.join(' ')}`);
    if (nb.tiers) console.log(`  note cache tiers: hot ${nb.tiers.hotMb} MB (${nb.tiers.hot} notes), cold 16-bit ${nb.tiers.coldMb} MB (${nb.tiers.cold}); ${nb.tiers.promoted} promoted, ${nb.tiers.demoted} demoted`);
    if (bad) fails++;
  }
  const fr = pos.frame;
  if (fr) console.log(`frame (info().perf.frame, last ~5 s): ${fr.fps} fps, mean ${fr.frameAvgMs} ms, p95 ${fr.frameP95Ms} ms; audio system ${fr.audioMsPerSec} ms of main thread per second`);
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
  console.log(fails || errors.length ? `\n${fails} live check(s) failed` : '\nall live checks passed');
  await browser.close();
  await server.close();
  if (fails || errors.length) process.exitCode = 1;
}

// ─────────────────────────────────────────────────────────── co-op (two real clients)

/**
 * `--coop`: relay + Vite + two real game clients (host Hazel, farmhand Ash) in one GPU Chromium,
 * both with audio running. Checks that a farmhand HEARS the host: (1) the host hoes two tiles from
 * the farmhand → the farmhand's client voices the replayed `hoe` (its SFX log) and its output meter
 * peaks over the window before (music silenced on the farmhand, ambience on, farmhand one tile away); (2) both walk onto the
 * Blossom Parade grounds → both clients play the same festival arrangement.
 */
async function coop() {
  const { spawn } = await import('node:child_process');
  const relay = spawn(process.execPath, [resolve(root, 'server/index.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const relayPort = await new Promise((res, rej) => {
    let buf = '';
    relay.stdout.on('data', (d) => {
      buf += String(d);
      const m = /listening on ws:\/\/[^:]+:(\d+)/.exec(buf);
      if (m) res(Number(m[1]));
    });
    relay.on('exit', (c) => rej(new Error(`relay exited (${c})`)));
  });
  const ws = `ws://127.0.0.1:${relayPort}/ws`;
  const server = await createServer({ root, logLevel: 'error', clearScreen: false, cacheDir: resolve(tmpdir(), `hearthvale-vite-acoop-${process.pid}`), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const flags = ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: flags });
  } catch {
    browser = await chromium.launch({ headless: true, args: flags });
  }
  const errors = [];
  const open = async (label, q) => {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240000);
    page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
    await page.goto(`${base}/?notitle=1&audio=1&quality=low&card=0&${q}&server=${encodeURIComponent(ws)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__game?.ready === 'function');
    await page.evaluate(() => window.__game.ready());
    await page.mouse.click(400, 225);
    await page.waitForFunction(() => window.__game.game.services.audio?.state().running, null, { timeout: 30000 }).catch(() => {});
    return page;
  };
  let fails = 0;
  const check = (name, ok, detail) => {
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  (${detail})`);
  };
  try {
    const host = await open('host', 'map=farm&x=30.5&z=22.5&time=9&name=Hazel');
    const hand = await open('hand', 'name=Ash');
    const code = await host.evaluate(() => window.__game.game.services.net.host());
    await hand.evaluate((c) => window.__game.game.services.net.join(c), code);
    await hand.waitForFunction(() => window.__game.game.services.net.players().length === 2, null, { timeout: 30000 });
    // A free tillable tile near the house (host's grid).
    const T = await host.evaluate(() => {
      const g = window.__game.game.services.net.sync.grid();
      for (let z = 24; z < 34; z++)
        for (let x = 34; x < 50; x++) if (g.hasFlag(x, z, 2) && !g.hasFlag(x, z, 4) && !g.getObject(x, z) && !g.hasFlag(x, z, 1) && g.isWalkable(x, z + 1)) return { x, z };
      return null;
    });
    if (!T) throw new Error('no free tile');
    await host.evaluate((t) => {
      window.__game.teleport('farm', t.x + 0.5, t.z + 1.5);
      window.__game.facing('up');
    }, T);
    await hand.evaluate((t) => {
      window.__game.teleport('farm', t.x + 1.5, t.z + 1.5);
      window.__game.game.services.audio.music('none');
    }, T);
    await new Promise((r) => setTimeout(r, 6000));
    // Meter the farmhand 1.2 s before and 1.4 s after the host's stroke.
    const meterWin = (ms) => hand.evaluate(async (ms) => {
      const a = window.__game.game.services.audio;
      const out = [];
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        out.push(a.meter());
        await new Promise((r) => setTimeout(r, 25));
      }
      return out;
    }, ms);
    const before = await meterWin(1200);
    const logLen = await hand.evaluate(() => window.__game.game.services.audio.state().sfxLog.length);
    const strokeAt = await hand.evaluate(() => window.__game.game.services.audio.state().sfxLog.at(-1)?.at ?? 0);
    const after = hand.evaluate(async (ms) => {
      const a = window.__game.game.services.audio;
      const out = [];
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        out.push(a.meter());
        await new Promise((r) => setTimeout(r, 25));
      }
      return out;
    }, 1600);
    await host.keyboard.press('Digit1');
    await host.keyboard.press('KeyC');
    const aft = await after;
    const log = await hand.evaluate(() => window.__game.game.services.audio.state().sfxLog);
    const fresh = log.slice(Math.max(0, logLen - (log.length >= 24 ? 24 : 0)));
    // Only effects voiced after the stroke (the log also holds earlier entries).
    const hoe = log.find((x) => x.at > strokeAt && (x.name === 'hoe' || x.name === 'hoe:dull'));
    // Against the ambience's own busy moments (birds): the 90th percentile of the window before.
    const med = [...before].sort((x, y) => x - y)[Math.floor(before.length * 0.9)];
    const peak = Math.max(...aft);
    const hostLog = await host.evaluate(() => window.__game.game.services.audio.state().sfxLog.slice(-3).map((x) => x.name).join(','));
    check('farmhand voices the host\'s hoe stroke as the host resolved it (soil, not a dull thunk)', hoe?.name === 'hoe' && hoe.gain >= 0.85, hoe ? `${hoe.name} gain ${hoe.gain} pan ${hoe.pan}` : `farmhand log: ${fresh.map((x) => x.name).join(',') || 'empty'}`);
    check('farmhand output peaks over its ambience', peak > med + 3, `peak ${fmt(peak)} vs 90th percentile ${fmt(med)} dBFS before; host voiced ${hostLog}`);
    // Event score: the host's heart event start / end goes over the relay as npcs.ts's 'v.e' message; a
    // farmhand watching in the square hears the event's cue, then the square's music again.
    for (const p of [host, hand]) await p.evaluate(() => { window.__game.game.services.audio.music(null); return window.__game.demo('town-day'); });
    const waitTheme = (re) => hand.evaluate(async (src) => {
      const re0 = new RegExp(src);
      const a = window.__game.game.services.audio;
      const t0 = performance.now();
      let st = a.state();
      while (performance.now() - t0 < 20000) {
        st = a.state();
        if (st.theme && st.theme === st.wanted && re0.test(st.theme)) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      return `${st.wanted}/${st.theme}`;
    }, re.source);
    await host.evaluate(() => window.__game.game.services.net.sendExt('*', ['v.e', 1, 'june-2', 0, 'Host']));
    const evOn = await waitTheme(/^event-wistful$/);
    check('farmhand spectating the host\'s heart event hears its cue', evOn === 'event-wistful/event-wistful', `wanted/playing ${evOn}`);
    await host.evaluate(() => window.__game.game.services.net.sendExt('*', ['v.e', 0, 'june-2']));
    const evOff = await waitTheme(/^town/);
    check('…and the square\'s music returns when it ends', /^town[^/]*\/town/.test(evOff), `wanted/playing ${evOff}`);
    // Mine combat (round 12): a partner's sword blow is voiced on the farmhand's main graph at the
    // monster's position — 12 tiles away it sits at least 5 dB under the same blow 1 tile away.
    const blow = await hand.evaluate(async () => {
      const g = window.__game;
      const a = g.game.services.audio;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      a.music('none');
      await sleep(1200);
      const { mineSfx } = await import('/src/world/mine/sfx.ts');
      const p = g.game.player.position;
      const peak = async (dx) => {
        const ps = [];
        for (let k = 0; k < 3; k++) {
          mineSfx.hit('slime', false, false, { x: p.x + dx, z: p.z });
          let max = -Infinity;
          for (let i = 0; i < 10; i++) {
            await sleep(25);
            max = Math.max(max, a.meter());
          }
          ps.push(max);
          await sleep(600);
        }
        return ps.sort((x, y) => x - y)[1];
      };
      const near = await peak(1);
      const far = await peak(12);
      a.music(null);
      return { near, far };
    });
    check('farmhand: a partner\'s sword blow at 12 tiles sits ≥ 5 dB under one at 1 tile', blow.near > blow.far + 5, `1 tile ${fmt(blow.near)} dBFS, 12 tiles ${fmt(blow.far)} dBFS`);
    // Festival: both clients walk onto the Blossom Parade grounds.
    for (const p of [host, hand]) await p.evaluate(() => { window.__game.game.services.audio.music(null); return window.__game.demo('fest-spring'); });
    const themes = await Promise.all([host, hand].map((p) => p.evaluate(async () => {
      const a = window.__game.game.services.audio;
      const t0 = performance.now();
      let st = a.state();
      while (performance.now() - t0 < 20000) {
        st = a.state();
        if (st.theme && st.theme === st.wanted && /^festival/.test(st.theme)) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      return { theme: st.theme, map: window.__game.info().map };
    })));
    check('host and farmhand play the same festival arrangement', !!themes[0].theme && themes[0].theme === themes[1].theme && /^festival/.test(themes[0].theme), themes.map((x) => `${x.map}:${x.theme}`).join(' / '));
    const fr = await Promise.all([host, hand].map((p) => p.evaluate(() => window.__game.info().perf.frame)));
    console.log(`frame: host ${fr[0]?.fps} fps (p95 ${fr[0]?.frameP95Ms} ms, audio ${fr[0]?.audioMsPerSec} ms/s) · farmhand ${fr[1]?.fps} fps (p95 ${fr[1]?.frameP95Ms} ms, audio ${fr[1]?.audioMsPerSec} ms/s)`);
  } catch (e) {
    fails++;
    console.log(`FAIL co-op audio run: ${e?.message ?? e}`);
  }
  if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
  console.log(fails ? `\n${fails} co-op audio check(s) failed` : '\nall co-op audio checks passed');
  await browser.close();
  await server.close();
  relay.kill();
  if (fails) process.exitCode = 1;
}

(process.argv.includes('--coop') ? coop() : process.argv.includes('--live') ? live() : main()).catch((e) => {
  console.error(e);
  process.exit(2);
});
