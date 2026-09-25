#!/usr/bin/env node
/**
 * Music continuity trace — "does the score keep playing?" (the "music keeps disconnecting" report).
 *
 *   node scripts/audio-continuity.mjs                 # offline 10-min session + stall A/B (fast, deterministic)
 *   node scripts/audio-continuity.mjs --live          # also the real game in real time (default 10 min)
 *   node scripts/audio-continuity.mjs --live-only --minutes 3
 *   node scripts/audio-continuity.mjs --seconds 600   # offline session length
 *
 * Offline (src/audio/offline.ts renderSession): the real selector + MusicDirector on an
 * OfflineAudioContext, ticked every 100 ms like the adapter, over a scripted day of play — farm →
 * house doorways → town → shop → beach, then a storm day with doorway transitions and a walk to town
 * in the storm — with 500 ms main-thread stalls injected (the director is not updated, the audio
 * clock runs on). Only the score is rendered, so the 100 ms RMS envelope says when music is audible.
 * Pass: audible (music RMS > -50 dBFS) ≥ 90 % of the session, no stall drops or delays a note. The
 * same stall is replayed with the pre-fix scheduler (0.3 s look-ahead, notes > 50 ms late skipped)
 * as a baseline.
 *
 * Live (--live): boots the game (GPU Chromium, autoplay allowed, one click), unpauses it and plays
 * the same kind of session in real time through window.__game — teleports farm ⇄ house → town →
 * beach, a storm with doorway transitions, a hidden / shown tab, 500 ms busy-loop stalls — sampling
 * __game.info().audio every 250 ms. Pass: music-bus level audible ≥ 90 % of the visible time, the
 * master restored after the tab comes back, no notes skipped by a stall, no music update errors.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};
const LIVE = argv.includes('--live') || argv.includes('--live-only');
const OFFLINE = !argv.includes('--live-only');
const SECONDS = arg('--seconds', 600);
const MINUTES = arg('--minutes', 10);
const AUDIBLE_DB = -50;
const outDir = resolve(root, 'shots/audio');

/** The offline session: one ordinary day (farm → town → beach), then a storm day. Times in seconds. */
function offlineScript(T) {
  const f = (x) => Math.round(x * T * 10) / 10;
  return [
    { t: 0, map: 'farm', indoor: false, weather: 'sun', season: 'spring', hour: 6.2, label: 'farm (spring, sunny, 06:12)' },
    { t: f(0.06), map: 'house', indoor: true, label: 'door → house' },
    { t: f(0.09), map: 'farm', indoor: false, label: 'door → farm' },
    { t: f(0.15), stallMs: 500, label: '500 ms stall (farm)' },
    { t: f(0.25), map: 'town', indoor: false, label: 'walk → town' },
    { t: f(0.31), map: 'shop', indoor: true, label: 'door → shop' },
    { t: f(0.35), map: 'town', indoor: false, label: 'door → town' },
    { t: f(0.4), stallMs: 500, label: '500 ms stall (town)' },
    { t: f(0.47), map: 'beach', indoor: false, label: 'walk → beach' },
    { t: f(0.6), stallMs: 500, label: '500 ms stall (beach)' },
    { t: f(0.66), map: 'farm', indoor: false, weather: 'storm', hour: 9, label: 'storm day: farm (09:00)' },
    ...Array.from({ length: 8 }, (_, k) => ({ t: f(0.7 + k * 0.025), map: k % 2 ? 'farm' : 'house', indoor: k % 2 === 0, label: `storm door → ${k % 2 ? 'farm' : 'house'}` })),
    { t: f(0.81), stallMs: 500, label: '500 ms stall (storm, outdoors)' },
    { t: f(0.88), map: 'town', indoor: false, label: 'storm: walk → town' },
    { t: f(0.93), map: 'hall', indoor: true, label: 'storm door → Lantern Hall' },
    { t: f(0.96), map: 'town', indoor: false, label: 'storm door → town' },
  ];
}

async function startServer(tag) {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir: resolve(tmpdir(), `hearthvale-vite-${tag}-${process.pid}`),
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  return { server, base: `http://127.0.0.1:${server.httpServer.address().port}` };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** Longest run of `pred` over an array sampled every `dt` seconds. */
function longestRun(arr, pred, dt) {
  let best = 0;
  let run = 0;
  let at = 0;
  let bestAt = 0;
  arr.forEach((v, i) => {
    if (pred(v)) {
      if (!run) at = i;
      run++;
      if (run > best) {
        best = run;
        bestAt = at;
      }
    } else run = 0;
  });
  return { s: best * dt, at: bestAt * dt };
}

async function offline() {
  const { server, base } = await startServer('cont');
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => ((m.type() === 'error' && !/Failed to load resource/.test(m.text())) || (m.type() === 'warning' && /\[audio\]/.test(m.text()))) && errors.push(m.text()));
  page.setDefaultTimeout(0);
  // An empty page on the dev server's origin (the SPA fallback would boot the whole game).
  await page.route(`${base}/__audio__`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>audio</title>' }));
  await page.goto(`${base}/__audio__`, { waitUntil: 'load', timeout: 180000 });
  await page.evaluate(async () => {
    window.__audioOffline = await import('/src/audio/offline.ts');
    window.__audioOffline.setRenderOptions({ liveBudget: true });
  });
  const t0 = Date.now();
  const script = offlineScript(SECONDS);
  const res = await page.evaluate(([s, T]) => window.__audioOffline.renderSession(s, T), [script, SECONDS]);
  const wallS = (Date.now() - t0) / 1000;
  // Stall A/B: the same 40 s farm session with a 500 ms stall at 20 s — the pre-fix scheduler
  // (0.3 s look-ahead, > 50 ms late = skipped) vs the game's current one.
  const ab = [];
  for (const [name, o] of [['before (0.3 s look-ahead, 50 ms stale)', { lookahead: 0.3, staleAfter: 0.05 }], ['after (game defaults)', {}]]) {
    const r = await page.evaluate(
      ([o]) =>
        window.__audioOffline.renderSession(
          [
            { t: 0, map: 'farm', weather: 'sun', hour: 9 },
            { t: 20, stallMs: 500 },
            { t: 30, stallMs: 900 },
          ],
          40,
          o,
        ),
      [o],
    );
    ab.push({ name, stalls: r.stalls, lookahead: r.lookahead, staleAfter: r.staleAfter });
  }
  await browser.close();
  await server.close();

  const dt = 0.1;
  const aud = res.rmsDb.map((d) => d > AUDIBLE_DB);
  const audibleFrac = aud.filter(Boolean).length / aud.length;
  const playFrac = [...res.playing].filter((c) => c === '1').length / res.playing.length;
  const gap = longestRun(res.rmsDb, (d) => d <= AUDIBLE_DB, dt);
  const rests = res.trace.filter((x) => /^finished /.test(x.note)).length;
  const cuts = res.trace.filter((x) => /rest cut/.test(x.note));
  const silences = res.trace.filter((x) => /silence/.test(x.note) && !/rest cut/.test(x.note));
  // Per-segment audibility (between labelled changes).
  const marks = [...res.labels.filter((l) => !/stall/.test(l.label)), { t: SECONDS, label: 'end' }];
  console.log(`\nOFFLINE SESSION — ${SECONDS} s of play (${(SECONDS / 60).toFixed(0)} min), rendered in ${wallS.toFixed(0)} s`);
  console.log(`${'from'.padStart(6)}  ${'segment'.padEnd(34)} ${'audible'.padStart(8)}`);
  for (let i = 0; i < marks.length - 1; i++) {
    const a = Math.floor(marks[i].t / dt);
    const b = Math.max(a + 1, Math.floor(marks[i + 1].t / dt));
    const seg = aud.slice(a, b);
    console.log(`${marks[i].t.toFixed(0).padStart(5)}s  ${marks[i].label.padEnd(34)} ${pct(seg.filter(Boolean).length / Math.max(1, seg.length)).padStart(8)}`);
  }
  console.log(`\nselections: ${res.wants.map(([t, w]) => `${t.toFixed(0)}s ${w}`).join(' · ')}`);
  console.log(`director: ${res.trace.length} decisions — ${rests} songs finished → rest, ${cuts.length} rests cut by a new selection, ${silences.length} handoffs to silence`);
  for (const x of res.trace) console.log(`  ${x.t.toFixed(1).padStart(6)}s  ${x.note}`);
  console.log(`\nmusic audible (RMS > ${AUDIBLE_DB} dBFS): ${pct(audibleFrac)} of the session; a song current ${pct(playFrac)}; longest quiet stretch ${gap.s.toFixed(1)} s at ${gap.at.toFixed(0)} s`);
  let fails = 0;
  if (audibleFrac < 0.9) {
    fails++;
    console.log('  FAIL: music audible < 90 % of the session');
  }
  console.log('\nstalls in the session (notes played late / skipped as stale, stall start → +3 s):');
  for (const s of res.stalls) {
    const ok = s.skipped === 0 && s.late === 0;
    if (!ok) fails++;
    console.log(`  ${s.t.toFixed(0).padStart(5)}s  ${s.ms} ms  late ${s.late}, skipped ${s.skipped}  ${ok ? 'ok (no note dropped or delayed)' : 'FAIL'}`);
  }
  console.log('\nstall A/B (40 s farm session, stalls of 500 ms at 20 s and 900 ms at 30 s):');
  for (const r of ab) console.log(`  ${r.name.padEnd(40)} ${r.stalls.map((s) => `${s.ms} ms: late ${s.late}, skipped ${s.skipped}`).join(' | ')}`);
  const after = ab[1].stalls;
  if (after.some((s) => s.skipped > 0)) {
    fails++;
    console.log('  FAIL: the current scheduler still skips notes on a stall');
  }
  if (errors.length) {
    fails++;
    console.log(`page errors:\n  ${errors.join('\n  ')}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'continuity-offline.json'), JSON.stringify({ seconds: SECONDS, audibleFrac, playFrac, longestGap: gap, trace: res.trace, wants: res.wants, stalls: res.stalls, ab, rmsDb: res.rmsDb }, null, 1));
  return fails;
}

/** The live session in the real game: fractions of the run → actions (see the header). */
function liveScript(T) {
  const f = (x) => Math.round(x * T * 1000);
  const farm = { map: 'farm', x: 31.2, z: 20.2 };
  const house = { map: 'house', x: 5.3, z: 5.9 };
  return [
    { at: 0, go: farm, weather: 'sun', hour: 9, label: 'farm (sunny)' },
    { at: f(0.07), go: house, label: 'door → house' },
    { at: f(0.1), go: farm, label: 'door → farm' },
    { at: f(0.15), stall: 500, label: '500 ms stall (farm)' },
    { at: f(0.22), go: { map: 'town', x: 34.9, z: 22.9 }, hour: 9, label: 'walk → town' },
    { at: f(0.32), stall: 500, label: '500 ms stall (town)' },
    { at: f(0.36), hide: true, label: 'tab hidden' },
    { at: f(0.39), hide: false, label: 'tab shown' },
    { at: f(0.45), go: { map: 'beach', x: 51, z: 37.5 }, hour: 10, label: 'walk → beach' },
    { at: f(0.55), stall: 500, label: '500 ms stall (beach)' },
    { at: f(0.62), go: farm, weather: 'storm', hour: 9, label: 'storm: farm' },
    ...Array.from({ length: 8 }, (_, k) => ({ at: f(0.66 + k * 0.025), go: k % 2 ? farm : house, label: `storm door → ${k % 2 ? 'farm' : 'house'}` })),
    { at: f(0.72), stall: 500, label: '500 ms stall (storm)' },
    { at: f(0.87), go: { map: 'town', x: 34.9, z: 22.9 }, label: 'storm: walk → town' },
  ];
}

async function live() {
  const T = MINUTES * 60;
  const { server, base } = await startServer('contlive');
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
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && /\[audio\]/.test(m.text()) && errors.push(m.text()));
  page.setDefaultTimeout(0);
  await page.goto(`${base}/?notitle=1&audio=1&quality=low&card=0`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 240000 });
  await page.evaluate(() => window.__game.ready());
  await page.mouse.click(480, 270);
  const script = liveScript(T);
  const t0 = Date.now();
  console.log(`\nLIVE SESSION — ${MINUTES} min in the real game (real time)`);
  const res = await page.evaluate(
    async ([script, T]) => {
      const g = window.__game;
      const a = g.game.services.audio;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      g.openUI('none');
      g.pause(false);
      a.music(null);
      const samples = [];
      const events = [];
      const start = performance.now();
      let i = 0;
      while (performance.now() - start < T * 1000) {
        const now = performance.now() - start;
        while (i < script.length && script[i].at <= now) {
          const e = script[i++];
          const s0 = a.state();
          const ev = { t: now / 1000, label: e.label, before: { theme: s0.theme, group: s0.group, skipped: s0.sched.skipped, late: s0.sched.late, restores: s0.sched.restores } };
          if (e.weather) g.setWeather(e.weather);
          if (e.go) await g.teleport(e.go.map, e.go.x, e.go.z);
          if (e.hour !== undefined) g.setTime(e.hour);
          if (e.hide !== undefined) {
            hidden = e.hide;
            document.dispatchEvent(new Event('visibilitychange'));
          }
          if (e.stall) {
            const b = performance.now();
            while (performance.now() - b < e.stall) {
              /* busy: the main thread is blocked */
            }
          }
          g.openUI('none');
          g.pause(false);
          events.push(ev);
        }
        const st = a.state();
        samples.push({ t: now / 1000, hidden, theme: st.theme, group: st.group, resting: st.resting, ctx: st.ctxState, musicDb: st.musicDb, levelDb: st.levelDb, late: st.sched.late, skipped: st.sched.skipped, errors: st.sched.errors, restores: st.sched.restores, map: g.game.world.current?.id ?? '' });
        await sleep(250);
      }
      // Per event: the state 3 s later (a stall's skipped / late notes, a doorway's selection).
      for (const ev of events) {
        const after = samples.find((s) => s.t >= ev.t + 3) ?? samples[samples.length - 1];
        ev.after = { theme: after.theme, group: after.group, skipped: after.skipped, late: after.late, restores: after.restores, ctx: after.ctx, musicDb: after.musicDb, levelDb: after.levelDb };
      }
      const st = a.state();
      return { samples, events, final: { trace: st.trace, compose: st.compose, stalls: st.stalls, sched: st.sched, dropped: st.dropped } };
    },
    [script, T],
  );
  await browser.close();
  await server.close();
  const vis = res.samples.filter((s) => !s.hidden);
  const aud = vis.filter((s) => s.musicDb > AUDIBLE_DB);
  const cur = vis.filter((s) => s.theme && !s.resting);
  const frac = aud.length / Math.max(1, vis.length);
  const gap = longestRun(vis, (s) => !(s.musicDb > AUDIBLE_DB), 0.25);
  console.log(`ran ${((Date.now() - t0) / 1000).toFixed(0)} s, ${res.samples.length} samples`);
  console.log(`${'t'.padStart(6)}  ${'event'.padEnd(26)} ${'before'.padEnd(20)} ${'3 s later'.padEnd(20)} notes late/skipped`);
  let fails = 0;
  for (const e of res.events) {
    const dl = e.after.late - e.before.late;
    const ds = e.after.skipped - e.before.skipped;
    let note = '';
    if (/stall/.test(e.label)) {
      const ok = ds === 0;
      if (!ok) fails++;
      note = ok ? 'ok' : 'FAIL (notes skipped)';
    }
    if (/tab shown/.test(e.label)) {
      const ok = e.after.ctx === 'running' && e.after.levelDb > -70;
      if (!ok) fails++;
      note = `ctx ${e.after.ctx}, output ${e.after.levelDb} dBFS, restores ${e.after.restores}  ${ok ? 'ok' : 'FAIL (still muted)'}`;
    }
    console.log(`${e.t.toFixed(0).padStart(5)}s  ${e.label.padEnd(26)} ${String(e.before.theme).padEnd(20)} ${String(e.after.theme).padEnd(20)} ${dl}/${ds}  ${note}`);
  }
  console.log(`\nmusic audible (music bus > ${AUDIBLE_DB} dBFS): ${pct(frac)} of the visible time; a song current ${pct(cur.length / Math.max(1, vis.length))}; longest quiet stretch ${gap.s.toFixed(1)} s at ${gap.at.toFixed(0)} s`);
  console.log(`scheduler: late ${res.final.sched.late}, skipped ${res.final.sched.skipped}, music errors ${res.final.sched.errors} (resets ${res.final.sched.recoveries}), keep-alive resumes ${res.final.sched.resumes}, clock-stall kicks ${res.final.stalls}; compose worker ${res.final.compose.hits} hits / ${res.final.compose.misses} misses`);
  console.log(`trace: ${res.final.trace.map((x) => `${x.t}s ${x.note}`).join(' | ')}`);
  if (frac < 0.9) {
    fails++;
    console.log('  FAIL: music audible < 90 % of the visible time');
  }
  if (res.final.sched.errors) {
    fails++;
    console.log('  FAIL: music update errors');
  }
  if (errors.length) {
    fails++;
    console.log(`page errors:\n  ${errors.join('\n  ')}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'continuity-live.json'), JSON.stringify(res, null, 1));
  return fails;
}

(async () => {
  let fails = 0;
  if (OFFLINE) fails += await offline();
  if (LIVE) fails += await live();
  console.log(fails ? `\n${fails} continuity check(s) failed` : '\nall continuity checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
