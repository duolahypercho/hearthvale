/**
 * Four-player co-op performance gate for the audio stack (round 7, critic r6 blocker: "the only
 * multiplayer probe measured 56.96 fps for the host and 56.43 for the farmhand with two players").
 *
 *   node scripts/audio-coop-perf.mjs                      # 4 clients, each measured at 2560x1440 "high"
 *   node scripts/audio-coop-perf.mjs --clients 4 --w 2560 --h 1440 --quality high --record 6000 --warmup 4000
 *   node scripts/audio-coop-perf.mjs --pairs 4           # audio on/off A/B in 4 interleaved window pairs (default 3)
 *   node scripts/audio-coop-perf.mjs --out shots/audio-r7/coop-perf.json   # (--load-timeout ms, default 600000)
 *
 * Relay + Vite + one GPU Chromium (uncapped: --disable-gpu-vsync --disable-frame-rate-limit, the
 * same timing mode as scripts/perf.mjs, so the numbers are headroom, not a vsync-quantised 60).
 * A host and three farmhands join over the real relay and stand together on the farm, all four
 * with the audio running (music, ambience, the others' positional footsteps, chat blips, tool
 * hits). Each client in turn is the "player's machine": its page is resized to the full 1440p
 * viewport at the requested quality while the other three drop to 640x360 "low" (they stand in
 * for the other players' machines, sharing this one GPU). The three partners keep walking, so the
 * measured client voices their footfalls, and every 2 s one of them hoes / chats (positional SFX,
 * dialogue blips) — the remote-voice path at its busiest.
 *
 * Per measured client: requestAnimationFrame deltas for --record ms (avg fps / p95 / p99), the
 * audio stack's whole main-thread cost (`info().perf.frame.audioMsPerSec`, which includes the
 * worker deliveries and the watchdog, src/audio/cost.ts), the voices / cache tiers, and an A/B
 * window with the AudioContext held suspended (`services.audio.benchOff(true)`) — the frame-time
 * difference is what the audio stack costs that client.
 *
 * Gates (exit 1 on any):
 *   FPS        every client's avg fps ≥ --min-fps (60) with audio on, at the requested size/quality
 *   AUDIO-CPU  the audio stack ≤ --audio-budget ms of main thread per second (default 8 = 0.8 %)
 *   AUDIO-AB   audio on vs off: mean frame time within max(0.35 ms, 3 %) (noise floor of the A/B)
 *   VOICED     each measured client voiced ≥ 1 partner footfall per partner-second walked
 * The machine's load average and foreign GPU processes are printed: on a GPU shared with other
 * teams' runs the FPS gate can fail on the renderer alone — the A/B line says whether audio is part
 * of it.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, loadavg, cpus } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const N = Math.max(2, Math.min(4, Number(opt('clients', 4))));
const W = Number(opt('w', 2560));
const H = Number(opt('h', 1440));
const QUALITY = opt('quality', 'high');
const WARMUP = Number(opt('warmup', 4000));
const RECORD = Number(opt('record', 6000));
const MIN_FPS = Number(opt('min-fps', 60));
const AUDIO_BUDGET = Number(opt('audio-budget', 8));
const PAIRS = Math.max(1, Number(opt('pairs', 3)));
const OUT = resolve(root, opt('out', 'shots/audio/coop-perf.json'));
const LOAD_MS = Number(opt('load-timeout', 600000));
const NAMES = ['Hazel', 'Ash', 'Bo', 'Cy'];
const SMALL = { width: 640, height: 360 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function foreignGpu() {
  try {
    const ps = execSync('ps -Ao pcpu,comm', { encoding: 'utf8' });
    return ps
      .split('\n')
      .filter((l) => /GPU|gpu-process|Helper \(GPU\)/.test(l))
      .map((l) => l.trim())
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function main() {
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
  const server = await createServer({ root, logLevel: 'error', clearScreen: false, cacheDir: resolve(tmpdir(), `hearthvale-vite-acperf-${process.pid}`), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const flags = ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: flags });
  } catch {
    browser = await chromium.launch({ headless: true, args: flags });
  }
  const errors = [];
  const pages = [];
  const out = { ts: new Date().toISOString(), clients: N, w: W, h: H, quality: QUALITY, warmupMs: WARMUP, recordMs: RECORD, env: { loadavg: loadavg().map((x) => Math.round(x * 10) / 10), cpus: cpus().length, gpu: foreignGpu() }, results: [], fails: [] };
  let walking = true;
  try {
    for (let i = 0; i < N; i++) {
      const ctx = await browser.newContext({ viewport: SMALL });
      const page = await ctx.newPage();
      // (A machine shared with other teams' runs can take minutes to boot the fourth game while
      // three already run: generous timeouts, and the running clients are paused meanwhile.)
      page.setDefaultTimeout(LOAD_MS);
      page.on('pageerror', (e) => errors.push(`${NAMES[i]}: ${e}`));
      for (const p of pages) await p.evaluate(() => window.__game.pause?.(true)).catch(() => {});
      const q = i === 0 ? `map=farm&x=30.5&z=22.5&time=9&name=${NAMES[i]}` : `name=${NAMES[i]}`;
      await page.goto(`${base}/?notitle=1&audio=1&quality=low&card=0&${q}&server=${encodeURIComponent(ws)}`, { waitUntil: 'commit', timeout: LOAD_MS });
      await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: LOAD_MS });
      await page.evaluate(() => window.__game.ready());
      for (const p of pages) await p.evaluate(() => window.__game.pause?.(false)).catch(() => {});
      await page.mouse.click(320, 180);
      await page.waitForFunction(() => window.__game.game.services.audio?.state().running, null, { timeout: 30000 }).catch(() => {});
      pages.push(page);
      // (Round 19: on a machine at load 60-400 the relay handshake can miss net/system.ts's answer
      // window — "the co-op server did not answer" ended the r12 run before it measured anything.
      // Host / join retry up to 5 times, 5 s apart.)
      for (let tries = 1; ; tries++) {
        try {
          if (i === 0) out.code = await page.evaluate(() => window.__game.game.services.net.host());
          else await page.evaluate((c) => window.__game.game.services.net.join(c), out.code);
          break;
        } catch (e) {
          if (tries >= 5) throw e;
          console.log(`  ${NAMES[i]}: ${i === 0 ? 'host' : 'join'} attempt ${tries} failed (${String(e).split('\n')[0]}), retrying`);
          await sleep(5000);
        }
      }
    }
    await pages[0].waitForFunction((n) => window.__game.game.services.net.players().length === n, N, { timeout: 60000 });
    // Everyone on the farm, a few tiles apart, facing the field.
    for (let i = 0; i < N; i++) await pages[i].evaluate((k) => window.__game.teleport('farm', 30.5 + (k % 2) * 3, 23.5 + Math.floor(k / 2) * 3), i);
    await sleep(4000);
    // Partners walk (key holds, the real movement + net path) and work: every 2 s one hoes or chats.
    const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
    let measured = -1;
    const driver = (async () => {
      let k = 0;
      while (walking) {
        for (let i = 0; i < N; i++) {
          if (i === measured) continue;
          const p = pages[i];
          const key = keys[(k + i) % 4];
          p.keyboard.down(key).catch(() => {});
          setTimeout(() => p.keyboard.up(key).catch(() => {}), 850);
        }
        if (k % 2 === 1) {
          const who = (Math.floor(k / 2) % N + N) % N;
          if (who !== measured) {
            const p = pages[who];
            if (k % 4 === 1) p.keyboard.press('KeyC').catch(() => {});
            else p.evaluate(() => window.__game.game.services.net.chat('the turnips look great today')).catch(() => {});
          }
        }
        k++;
        await sleep(1000);
      }
    })();
    for (let m = 0; m < N; m++) {
      measured = m;
      for (let i = 0; i < N; i++) {
        const big = i === m;
        await pages[i].setViewportSize(big ? { width: W, height: H } : SMALL);
        await pages[i].evaluate(([q]) => window.__game.quality(q), [big ? QUALITY : 'low']);
      }
      const page = pages[m];
      await page.evaluate(() => window.__game.game.services.audio.benchOff(false));
      await sleep(WARMUP);
      const rec = (ms) =>
        page.evaluate(async (ms) => {
          const a = window.__game.game.services.audio;
          const st0 = a.state();
          const steps0 = st0.steps?.remote ?? 0;
          const at0 = st0.sfxLog?.at(-1)?.at ?? 0;
          const d = [];
          await new Promise((res) => {
            let last = performance.now();
            const t0 = last;
            const f = (t) => {
              d.push(t - last);
              last = t;
              if (t - t0 < ms) requestAnimationFrame(f);
              else res();
            };
            requestAnimationFrame(f);
          });
          d.shift();
          const s = [...d].sort((x, y) => x - y);
          const mean = d.reduce((x, y) => x + y, 0) / d.length;
          const st = a.state();
          const log = (st.sfxLog ?? []).filter((x) => x.at > at0);
          const fr = window.__game.info().perf.frame;
          return {
            d,
            fps: Math.round((1000 / mean) * 10) / 10,
            meanMs: Math.round(mean * 100) / 100,
            p95Ms: Math.round(s[Math.floor(s.length * 0.95)] * 100) / 100,
            p99Ms: Math.round(s[Math.floor(s.length * 0.99)] * 100) / 100,
            frames: d.length,
            running: st.running,
            theme: st.theme,
            voices: st.peakVoices,
            audioMsPerSec: fr?.audioMsPerSec ?? null,
            offFrameMsPerSec: fr?.offFrameMsPerSec ?? null,
            mainRenders: fr?.mainRenders ?? null,
            steps: (st.steps?.remote ?? 0) - steps0,
            sfx: log.length,
            players: window.__game.game.services.net.players().length,
          };
        }, ms);
      // (Round 20: the A/B is interleaved — PAIRS on/off window pairs in ABBA order, the delta the
      // median of the per-pair differences. One long "on" window then one "off" window put the
      // machine's load drift into the delta: r12b's host read +8.7 ms/frame "for audio" at load 67
      // while its audio stack used 6.5 ms of main thread per second, ~0.3 ms a frame.)
      const benchOff = (v) => page.evaluate((v) => window.__game.game.services.audio.benchOff(v), v);
      const ons = [], offs = [];
      for (let k = 0; k < PAIRS; k++) {
        const order = k % 2 === 0 ? [false, true] : [true, false];
        for (const isOff of order) {
          await benchOff(isOff);
          await sleep(isOff ? 600 : 400);
          (isOff ? offs : ons).push(await rec(Math.round((RECORD / PAIRS) * (isOff ? 0.7 : 1))));
        }
      }
      await benchOff(false);
      const on = mergeWindows(ons), off = mergeWindows(offs);
      const pairDeltas = ons.map((o, k) => Math.round((o.meanMs - offs[k].meanMs) * 100) / 100);
      const r = { client: NAMES[m], host: m === 0, on, off, pairDeltas, deltaMs: median(pairDeltas) };
      out.results.push(r);
      const fail = [];
      if (on.fps < MIN_FPS) fail.push(`FPS(${on.fps} < ${MIN_FPS})`);
      if ((on.audioMsPerSec ?? 0) > AUDIO_BUDGET) fail.push(`AUDIO-CPU(${on.audioMsPerSec} ms/s > ${AUDIO_BUDGET})`);
      if (r.deltaMs > Math.max(0.35, off.meanMs * 0.03)) fail.push(`AUDIO-AB(+${r.deltaMs} ms/frame with audio)`);
      const walkedSec = (RECORD / 1000) * (N - 1) * 0.85 * 0.5;
      if (on.steps < walkedSec) fail.push(`VOICED(${on.steps} partner steps in ${RECORD / 1000} s)`);
      r.fails = fail;
      out.fails.push(...fail.map((f) => `${NAMES[m]}: ${f}`));
      console.log(
        `${NAMES[m].padEnd(6)} ${m === 0 ? 'host    ' : 'farmhand'} ${W}x${H} ${QUALITY}: ${on.fps} fps (mean ${on.meanMs} ms, p95 ${on.p95Ms}, p99 ${on.p99Ms}) · audio ${on.audioMsPerSec} ms/s (off-frame ${on.offFrameMsPerSec}) · ` +
          `audio off ${off.fps} fps (Δ ${r.deltaMs >= 0 ? '+' : ''}${r.deltaMs} ms/frame, median of ${pairDeltas.join(' / ')}) · ${on.players} players, ${on.steps} partner steps, ${on.sfx} sfx, ${on.voices} peak voices, theme ${on.theme}  ${fail.length ? fail.join(' ') : 'ok'}`,
      );
    }
    walking = false;
    await driver;
  } catch (e) {
    out.fails.push(`harness: ${e?.message ?? e}`);
    console.log(`FAIL harness: ${e?.message ?? e}`);
  }
  walking = false;
  out.errors = errors.slice(0, 10);
  if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
  console.log(`machine: load ${out.env.loadavg.join(' / ')} on ${out.env.cpus} cpus; GPU processes: ${out.env.gpu.join(' | ') || 'n/a'}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const audioFails = out.fails.filter((f) => !/FPS\(/.test(f));
  console.log(out.fails.length ? `\n${out.fails.length} gate failure(s): ${out.fails.join('; ')}${audioFails.length ? '' : '  (audio gates all pass: the frame rate is the renderer on this machine)'}` : `\nall ${N} clients ≥ ${MIN_FPS} fps at ${W}x${H} ${QUALITY}; audio within budget`);
  await browser.close();
  await server.close();
  relay.kill();
  if (out.fails.length) process.exitCode = 1;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round(((s[s.length / 2 - 1] + s[s.length / 2]) / 2) * 100) / 100) : 0;
}

/** Several recording windows as one: exact frame stats over all their frames, counts summed. */
function mergeWindows(ws) {
  const d = ws.flatMap((w) => w.d);
  const s = [...d].sort((x, y) => x - y);
  const mean = d.reduce((x, y) => x + y, 0) / Math.max(1, d.length);
  const avg = (k) => {
    const v = ws.map((w) => w[k]).filter((x) => x != null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
  };
  const last = ws[ws.length - 1];
  return {
    fps: Math.round((1000 / mean) * 10) / 10,
    meanMs: Math.round(mean * 100) / 100,
    p95Ms: Math.round(s[Math.floor(s.length * 0.95)] * 100) / 100,
    p99Ms: Math.round(s[Math.floor(s.length * 0.99)] * 100) / 100,
    frames: d.length,
    windows: ws.length,
    running: last.running,
    theme: last.theme,
    voices: Math.max(...ws.map((w) => w.voices ?? 0)),
    audioMsPerSec: avg('audioMsPerSec'),
    offFrameMsPerSec: avg('offFrameMsPerSec'),
    mainRenders: last.mainRenders,
    steps: ws.reduce((a, w) => a + (w.steps ?? 0), 0),
    sfx: ws.reduce((a, w) => a + (w.sfx ?? 0), 0),
    players: last.players,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
