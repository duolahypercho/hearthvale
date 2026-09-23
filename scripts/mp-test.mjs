#!/usr/bin/env node
/**
 * Co-op end-to-end test: relay server + Vite + 3 headless Chromium pages (host + 2 farmhands).
 *
 *   node scripts/mp-test.mjs [--keep] [--gpu swiftshader]      (npm run mp-test)
 *
 * Drives movement, hoeing, watering, sowing, harvesting and gold on different clients; asserts the
 * shared farm / purse / calendar converge on every client; measures RTT, bandwidth and fps; drops a
 * farmhand's socket and checks the auto-rejoin; ends the day with everyone in bed; screenshots each
 * client's view into shots/mp/. Exits non-zero on any failed check.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/mp');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const gpuMode = argv.includes('--gpu') ? argv[argv.indexOf('--gpu') + 1] : 'auto';
const W = 1280;
const H = 720;

setTimeout(() => {
  console.error('[mp] failed: global timeout');
  process.exit(3);
}, 15 * 60_000).unref();

const t0 = Date.now();
const log = (...a) => console.log(`[mp +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failed = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const relay = await startServer({ port: 0, log: false, serveDist: false });
const wsUrl = `ws://127.0.0.1:${relay.port}/ws`;
const cacheDir = resolve(tmpdir(), `hearthvale-mp-${process.pid}`);
const vite = await createServer({ root, logLevel: 'error', cacheDir, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await vite.listen();
const port = vite.httpServer.address().port;
log(`relay ${wsUrl} · vite :${port}`);

const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const SWIFT = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
let browser = await chromium.launch({ headless: true, args: gpuMode === 'swiftshader' ? SWIFT : GPU });
{
  const p = await browser.newPage();
  const gl = await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  await p.close();
  if (!gl) {
    await browser.close();
    browser = await chromium.launch({ headless: true, args: SWIFT });
  }
}

const errors = [];
async function openClient(label, query) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console.error: ${m.text()}`);
    else if (process.env.MP_VERBOSE) console.log(`[${label}] ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?${query}&server=${encodeURIComponent(wsUrl)}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 180000 });
  await page.evaluate(() => window.__game.ready());
  log(`${label} ready`);
  return page;
}

const net = (page, fn, arg) => page.evaluate(fn, arg);
const waitFor = async (page, fn, arg, timeout = 20000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
};

let host, a, b;
try {
  // ── boot: host + two farmhands ────────────────────────────────────
  host = await openClient('host', 'notitle=1&map=farm&x=30.5&z=22.5&time=9&name=Hazel');
  const code = await net(host, () => window.__game.game.services.net.host());
  check('host opened a lobby', /^[A-Z0-9]{6}$/.test(code), code);
  [a, b] = await Promise.all([openClient('ash', 'name=Ash&preset=0'), openClient('bea', 'name=Bea&preset=1')]);
  const tj = Date.now();
  await Promise.all([a, b].map((p) => net(p, (c) => window.__game.game.services.net.join(c), code)));
  log(`both farmhands joined in ${Date.now() - tj} ms`);
  const counts = await Promise.all([host, a, b].map((p) => waitFor(p, () => window.__game.game.services.net.players().length === 3, null, 20000)));
  check('all 3 clients see 3 farmers', counts.every(Boolean));
  const names = await net(a, () => window.__game.game.services.net.players().map((p) => p.name).sort().join(','));
  check('roster names propagate', names === 'Ash,Bea,Hazel', names);
  const onFarm = await Promise.all([a, b].map((p) => net(p, () => window.__game.info().map)));
  check('farmhands spawn on the host farm', onFarm.every((m) => m === 'farm'), onFarm.join(','));
  const [idA, idB] = await Promise.all([a, b].map((p) => net(p, () => window.__game.game.services.net.myId())));
  const cabins = await net(host, () => window.__game.game.services.net.players().filter((p) => !p.isHost).map((p) => p.cabin));
  check('farmhands get cabins', cabins.every((c) => c >= 0) && new Set(cabins).size === 2, JSON.stringify(cabins));

  // ── pick free tillable tiles near the house (on the host) ─────────
  const tiles = await net(host, () => {
    const s = window.__game.game.services.net.sync;
    const g = s.grid();
    const out = [];
    for (let z = 24; z < 34 && out.length < 3; z++)
      for (let x = 34; x < 50 && out.length < 3; x++) {
        const ok = (tx, tz) => g.hasFlag(tx, tz, 2) && !g.hasFlag(tx, tz, 4) && !g.getObject(tx, tz) && !g.hasFlag(tx, tz, 1);
        if (ok(x, z) && g.isWalkable(x, z + 1) && !out.some((o) => Math.abs(o.x - x) < 3)) out.push({ x, z });
      }
    // A clear lane (5 walkable tiles east) for the walking test.
    let lane = null;
    for (let z = 22; z < 34 && !lane; z++)
      for (let x = 30; x < 50 && !lane; x++) {
        let free = true;
        for (let k = 0; k < 6; k++) free &&= g.isWalkable(x + k, z) && !g.getObject(x + k, z);
        if (free) lane = { x, z };
      }
    return { out, lane };
  });
  const lane = tiles.lane;
  check('found free farm tiles for the test', tiles.out.length >= 2 && !!lane, JSON.stringify(tiles));
  const [T1, T2] = tiles.out;

  // Everyone gathers near T1 so each view shows the others.
  await net(host, (t) => window.__game.teleport('farm', t.x + 2.5, t.z + 2.2), T1);
  await net(b, (t) => window.__game.teleport('farm', t.x - 1.5, t.z + 2.5), T1);
  await net(a, (t) => window.__game.teleport('farm', t.x + 0.5, t.z + 1.5), T1);
  await sleep(800);

  // ── movement: Ash walks right for 0.8 s along a clear lane; host + Bea see it ──
  await net(a, (l) => window.__game.teleport('farm', l.x + 0.5, l.z + 0.5), lane);
  await sleep(600);
  const before = await net(a, () => ({ ...window.__game.info().player }));
  await a.keyboard.down('KeyD');
  await sleep(800);
  await a.keyboard.up('KeyD');
  await sleep(700);
  const after = await net(a, () => ({ ...window.__game.info().player }));
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check('farmhand moves locally (prediction)', moved > 1.5, `${moved.toFixed(2)} m`);
  const seen = await Promise.all(
    [host, b].map((p) =>
      net(p, (id) => {
        const r = window.__game.game.services.net.remotes.get(id);
        return r ? { x: r.farmer.position.x, z: r.farmer.position.z } : null;
      }, idA),
    ),
  );
  const drift = seen.map((s) => (s ? Math.hypot(s.x - after.x, s.z - after.z) : 99));
  check('host + other farmhand see the move (interpolated)', drift.every((d) => d < 0.6), drift.map((d) => d.toFixed(2)).join(' / ') + ' m');

  // Walk back onto T1's south tile, face it.
  await net(a, (t) => {
    window.__game.teleport('farm', t.x + 0.5, t.z + 1.5);
    window.__game.facing('up');
  }, T1);
  await sleep(500);

  const tileState = (p, t) => net(p, (tt) => {
    const s = window.__game.game.services.net.sync;
    const g = s.grid();
    const i = g.idx(tt.x, tt.z);
    return s.digest().get(i) ?? '';
  }, t);
  const allTile = async (t) => Promise.all([host, a, b].map((p) => tileState(p, t)));

  // ── hoe (Ash) ─────────────────────────────────────────────────────
  await a.keyboard.press('Digit1');
  await a.keyboard.press('KeyC');
  await sleep(1800);
  let st = await allTile(T1);
  check('Ash hoes: tile tilled on all 3 clients', st.every((s) => s.startsWith('1')), st.join(' | '));

  // ── water (Bea) ───────────────────────────────────────────────────
  await net(b, (t) => {
    window.__game.teleport('farm', t.x - 0.5, t.z + 0.5);
    window.__game.facing('right');
  }, T1);
  await sleep(400);
  await b.keyboard.press('Digit2');
  await b.keyboard.press('KeyC');
  await sleep(1900);
  st = await allTile(T1);
  check('Bea waters: tile wet on all 3 clients', st.every((s) => s.startsWith('11')), st.join(' | '));

  // ── sow (Ash) ─────────────────────────────────────────────────────
  const seeds0 = await net(a, () => window.__game.game.services.inventory.count('parsnipSeeds'));
  await a.keyboard.press('Digit6');
  await a.keyboard.press('KeyC');
  await sleep(1800);
  st = await allTile(T1);
  const seeds1 = await net(a, () => window.__game.game.services.inventory.count('parsnipSeeds'));
  check('Ash sows parsnips: crop on all 3 clients', st.every((s) => s.includes('parsnip')), st.join(' | '));
  check('sowing spends the farmhand\'s own seeds', seeds1 === seeds0 - 1, `${seeds0} → ${seeds1}`);

  // ── the host hoes too (host actions replay on farmhands) ──────────
  await net(host, (t) => {
    window.__game.teleport('farm', t.x + 0.5, t.z + 1.5);
    window.__game.facing('up');
  }, T2);
  await sleep(400);
  await host.keyboard.press('Digit1');
  await host.keyboard.press('KeyC');
  await sleep(1800);
  st = await allTile(T2);
  check('host hoes: farmhands see the tilled tile', st.every((s) => s.startsWith('1')), st.join(' | '));

  // ── grow + harvest by hand (Bea) → item goes to Bea only ──────────
  await net(host, () => window.__game.grow(6));
  await sleep(1500);
  st = await allTile(T1);
  const ripeHost = await net(host, (t) => window.__game.game.services.farming.cropAt(t.x, t.z)?.ripe ?? false, T1);
  check('crop growth syncs from the host', ripeHost && st.every((s) => s === st[0]), st.join(' | '));
  const pars = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.game.services.inventory.count('parsnip'))));
  await net(b, (t) => {
    window.__game.teleport('farm', t.x + 0.5, t.z + 1.5);
    window.__game.facing('up');
  }, T1);
  await sleep(400);
  await b.keyboard.press('KeyX');
  await sleep(2200);
  st = await allTile(T1);
  const pars2 = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.game.services.inventory.count('parsnip'))));
  check('Bea harvests: crop gone on all 3 clients', st.every((s) => !s.includes('parsnip')), st.join(' | '));
  check('harvest lands in Bea\'s backpack only', pars2[2] > pars[2] && pars2[0] === pars[0] && pars2[1] === pars[1], `${pars.join(',')} → ${pars2.join(',')}`);

  // ── shared purse ──────────────────────────────────────────────────
  await net(a, () => window.__game.game.services.economy.add(250));
  await sleep(1200);
  const gold = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.game.services.economy.gold())));
  check('gold is shared (farmhand earns → everyone sees it)', gold.every((g) => g === gold[0]) && gold[0] >= 750, gold.join(' / '));

  // ── chat + emote ──────────────────────────────────────────────────
  await net(host, () => {
    window.__mpChat = [];
    window.__game.game.events.on('net:chat', (m) => window.__mpChat.push(m.text));
  });
  await net(b, () => {
    window.__game.game.services.net.chat('hello from Bea');
    window.__game.game.services.net.emote('heart');
  });
  const gotChat = await waitFor(host, () => (window.__mpChat ?? []).includes('hello from Bea'), null, 5000);
  check('chat reaches the host', gotChat);

  // ── convergence of the whole farm ─────────────────────────────────
  await sleep(3000);
  const digests = await Promise.all([host, a, b].map((p) => net(p, () => [...window.__game.game.services.net.sync.digest()].sort((x, y) => x[0] - y[0]).map((e) => e.join('=')).join(';'))));
  const diff = (x, y) => {
    const A = new Set(x.split(';'));
    const B = new Set(y.split(';'));
    return [...A].filter((v) => !B.has(v)).length + [...B].filter((v) => !A.has(v)).length;
  };
  check('whole-farm state converges (host vs Ash, host vs Bea)', diff(digests[0], digests[1]) === 0 && diff(digests[0], digests[2]) === 0, `diff ${diff(digests[0], digests[1])} / ${diff(digests[0], digests[2])}, ${digests[0].split(';').length} tiles`);
  const cal = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.info().calendar)));
  check('calendar in sync', cal.every((c) => c.day === cal[0].day && c.season === cal[0].season && Math.abs(c.hour - cal[0].hour) < 0.15), cal.map((c) => `${c.season} ${c.day} ${c.hour.toFixed(2)}`).join(' / '));

  // ── RTT / bandwidth / fps ─────────────────────────────────────────
  await sleep(4500);
  const stats = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.game.services.net.stats())));
  for (const [i, s] of stats.entries()) log(`${['host', 'ash', 'bea'][i]} stats`, JSON.stringify(s));
  const rtts = stats.slice(1).map((s) => s.rtt);
  check('RTT measured (farmhand → host → farmhand)', rtts.every((r) => r > 0 && r < 250), rtts.map((r) => `${r} ms`).join(' / '));
  const perf = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.info().perf)));
  check('render budget with 3 farmers in view (host)', perf[0].drawCalls <= 300, `${perf[0].drawCalls} draw calls, ${(perf[0].triangles / 1e6).toFixed(2)}M tris`);

  // Pose for the photo (distinct spots, facing the camera), then each client's view.
  await net(host, (t) => { window.__game.teleport('farm', t.x + 2.6, t.z + 2.4); window.__game.facing('down'); }, T1);
  await net(a, (t) => { window.__game.teleport('farm', t.x + 0.5, t.z + 1.4); window.__game.facing('down'); }, T1);
  await net(b, (t) => { window.__game.teleport('farm', t.x - 1.6, t.z + 2.6); window.__game.facing('right'); }, T1);
  await net(a, () => window.__game.game.services.net.emote('happy'));
  await net(b, () => window.__game.game.services.net.chat('Race you to the pond!'));
  await sleep(1200);
  for (const [p, n] of [[host, 'host'], [a, 'ash'], [b, 'bea']]) await p.screenshot({ path: resolve(outDir, `client-${n}.png`) });
  log('screenshots → shots/mp/client-*.png');

  // ── drop + rejoin ─────────────────────────────────────────────────
  await net(b, () => window.__game.game.services.net.simulateDrop());
  const awaySeen = await waitFor(host, () => window.__game.game.services.net.players().some((p) => p.name === 'Bea' && p.away), null, 8000);
  check('host notices the dropped farmhand', awaySeen);
  const back = await waitFor(b, () => window.__game.game.services.net.status() === 'playing', null, 15000);
  const backHost = await waitFor(host, () => window.__game.game.services.net.players().some((p) => p.name === 'Bea' && !p.away), null, 15000);
  const sameId = await net(b, () => window.__game.game.services.net.myId());
  check('farmhand auto-rejoins its slot', back && backHost && sameId === idB, `id ${sameId} (was ${idB})`);
  await net(a, (t) => {
    window.__game.teleport('farm', t.x + 0.5, t.z + 1.5);
    window.__game.facing('up');
  }, T2);
  await sleep(300);
  await a.keyboard.press('Digit2');
  await a.keyboard.press('KeyC');
  await sleep(2000);
  st = await allTile(T2);
  check('world keeps syncing after the rejoin', st.every((s) => s.startsWith('11')), st.join(' | '));

  // ── day end: everyone to bed ──────────────────────────────────────
  const day0 = await net(host, () => window.__game.info().calendar.day);
  await net(host, () => window.__game.setTime(22));
  await sleep(1300);
  await net(a, () => window.__game.game.services.net.goToBed('cabin'));
  await net(b, () => window.__game.game.services.net.goToBed('cabin'));
  await sleep(700);
  const waiting = await net(host, () => window.__game.info().calendar.day);
  check('day waits while someone is still up', waiting === day0);
  await host.screenshot({ path: resolve(outDir, 'client-host-waiting.png') });
  await net(host, () => window.__game.game.services.net.goToBed('house'));
  const rolled = await Promise.all([host, a, b].map((p) => waitFor(p, (d) => window.__game.info().calendar.day === d + 1, day0, 15000)));
  check('day ends for everyone once all are in bed', rolled.every(Boolean));
  await sleep(4000);
  const digests2 = await Promise.all([host, a, b].map((p) => net(p, () => [...window.__game.game.services.net.sync.digest()].sort((x, y) => x[0] - y[0]).map((e) => e.join('=')).join(';'))));
  check('farm converges after the night (growth, weeds, crows)', diff(digests2[0], digests2[1]) === 0 && diff(digests2[0], digests2[2]) === 0, `diff ${diff(digests2[0], digests2[1])} / ${diff(digests2[0], digests2[2])}`);
  for (const [p, n] of [[host, 'host'], [a, 'ash'], [b, 'bea']]) await p.screenshot({ path: resolve(outDir, `client-${n}-morning.png`) });

  // ── frame-time with 3 clients running (headless, shared GPU) ──────
  await sleep(3000);
  const fps = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.game.services.net.stats().frameMs)));
  log('frame ms (avg/p95/p99)', fps.map((f) => `${f.avg}/${f.p95}/${f.p99}`).join('  '));
  const fpsHost = 1000 / Math.max(1, fps[0].avg);
  results.push({ name: 'fps (host, 3 headless browsers sharing one GPU)', ok: true, detail: `${fpsHost.toFixed(1)} fps avg` });
  console.log(`• fps host ${fpsHost.toFixed(1)} (3 headless pages share one GPU; see npm run perf for the real gate)`);
  const relayStats = [...relay.lobbies.values()].map((l) => ({ code: l.code, relayed: l.relayed, players: l.peers.size }));
  log('relay', JSON.stringify(relayStats));
  writeFileSync(resolve(outDir, 'mp-results.json'), JSON.stringify({ at: new Date().toISOString(), results, stats, frameMs: fps, relay: relayStats, errors }, null, 2));
} catch (err) {
  console.error('[mp] failed:', err?.stack || err);
  failed++;
} finally {
  const pageErrs = errors.filter((e) => e.includes('pageerror'));
  for (const e of errors) console.error(`  ${e}`);
  check('no page errors on any client', pageErrs.length === 0, `${pageErrs.length} page errors, ${errors.length - pageErrs.length} console errors`);
  if (!argv.includes('--keep')) {
    await browser.close().catch(() => {});
    await vite.close().catch(() => {});
    await relay.close().catch(() => {});
  }
  try {
    rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.log(`\n${failed ? '✗' : '✓'} mp-test: ${results.filter((r) => r.ok).length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(failed ? 1 : 0);
}
