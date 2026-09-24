#!/usr/bin/env node
/**
 * Co-op end-to-end test: relay server + Vite + headless Chromium pages (host + 2 farmhands, then a
 * crash-rejoin tab and an impostor).
 *
 *   node scripts/mp-test.mjs [--keep] [--gpu swiftshader]      (npm run mp-test)
 *
 * Drives movement, hoeing, watering, sowing, harvesting and gold on different clients; asserts the
 * shared farm / purse / calendar converge on every client; measures network RTT (worker-timed),
 * farmhand → farmhand motion smoothness, bandwidth and fps; drops a farmhand's socket and checks the
 * auto-rejoin; ends the day with everyone in bed; screenshots each client's view into shots/mp/.
 *
 * Adversarial (round 2): a farmhand's own save survives a co-op night and comes back when they leave;
 * a reload never rolls the backpack back (no item dupe); the last awake farmer crashing ends the
 * night; a crashed tab reclaims its slot (persistent player id); an impostor with the same name
 * gets a fresh backpack and a unique name; the host can kick; gold earned while disconnected
 * arrives; two farmhands can't spend the same coins; a lost sowing race refunds the seed.
 * Exits non-zero on any failed check.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/mp');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const gpuMode = argv.includes('--gpu') ? argv[argv.indexOf('--gpu') + 1] : 'auto';
const W = 1280;
const H = 720;

// Wall-clock guard (MP_TIMEOUT_MIN overrides; a saturated machine — other agents' shot runs — can
// stretch page loads and screenshots several-fold without anything being wrong with the netcode).
setTimeout(() => {
  console.error('[mp] failed: global timeout');
  process.exit(3);
}, (Number(process.env.MP_TIMEOUT_MIN) || 25) * 60_000).unref();

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

// The relay runs in its own process (like `npm run server`), not on this harness's busy event loop
// (Vite transforms + the Playwright driver would otherwise add their latency to every relayed frame).
const relayProc = spawn(process.execPath, [resolve(root, 'server/index.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const relayPort = await new Promise((res, rej) => {
  let buf = '';
  relayProc.stdout.on('data', (d) => {
    buf += String(d);
    const m = /listening on ws:\/\/[^:]+:(\d+)/.exec(buf);
    if (m) res(Number(m[1]));
    if (process.env.MP_VERBOSE) process.stdout.write(String(d));
  });
  relayProc.on('exit', (c) => rej(new Error(`relay exited (${c})`)));
});
const wsUrl = `ws://127.0.0.1:${relayPort}/ws`;
const relay = {
  health: () => fetch(`http://127.0.0.1:${relayPort}/health`).then((r) => r.json()).catch(() => null),
  close: async () => relayProc.kill(),
};
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
/** Screenshots are evidence, not checks: a slow compositor on a loaded box must not fail the run. */
const snap = async (page, file) => {
  try {
    await page.screenshot({ path: file, timeout: 60000 });
  } catch (e) {
    log(`screenshot ${file} skipped: ${String(e?.message ?? e).split('\n')[0]}`);
  }
};
const waitFor = async (page, fn, arg, timeout = 20000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
};

// ── remote-farmer playout (pure, no browser): jitter / spikes / stalls never step backwards ──
{
  const { torture, CASES } = await import('./mp-interp.mjs');
  const rs = CASES.map((c) => ({ c, r: torture(c) }));
  const bad = rs.filter(({ c, r }) => !(r.back === 0 && r.pops === 0 && r.snaps === 0 && (c.maxSd == null || r.sd <= c.maxSd)));
  check('playout torture: no backward steps / pops over jitter, spikes and a stall', bad.length === 0, rs.map(({ c, r }) => `${c.name.split(',')[0]} back ${r.back} pops ${r.pops} maxV ${r.maxV} sd ${r.sd}`).join(' · '));
}

let host, a, b;
let idA = 0;
let idB = 0;
try {
  // ── boot: host + two farmhands ────────────────────────────────────
  host = await openClient('host', 'notitle=1&map=farm&x=30.5&z=22.5&time=9&name=Hazel');
  const code = await net(host, () => window.__game.game.services.net.host());
  check('host opened a lobby', /^[A-Z0-9]{6}$/.test(code), code);
  [a, b] = await Promise.all([openClient('ash', 'name=Ash&preset=0'), openClient('bea', 'name=Bea&preset=1')]);
  // Ash has a farm of their own (gold 77777, saved) — co-op must never touch it.
  await net(a, () => {
    window.__game.setGold(77777);
    window.__game.save('auto');
  });
  const ashOwn = await net(a, () => JSON.parse(localStorage.getItem('hearthvale.save.auto')).savedAt);
  const tj = Date.now();
  await Promise.all([a, b].map((p) => net(p, (c) => window.__game.game.services.net.join(c), code)));
  log(`both farmhands joined in ${Date.now() - tj} ms`);
  const counts = await Promise.all([host, a, b].map((p) => waitFor(p, () => window.__game.game.services.net.players().length === 3, null, 20000)));
  check('all 3 clients see 3 farmers', counts.every(Boolean));
  const names = await net(a, () => window.__game.game.services.net.players().map((p) => p.name).sort().join(','));
  check('roster names propagate', names === 'Ash,Bea,Hazel', names);
  const onFarm = await Promise.all([a, b].map((p) => net(p, () => window.__game.info().map)));
  check('farmhands spawn on the host farm', onFarm.every((m) => m === 'farm'), onFarm.join(','));
  [idA, idB] = await Promise.all([a, b].map((p) => net(p, () => window.__game.game.services.net.myId())));
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
  await net(b, () => {
    window.__mpImpacts = [];
    window.__game.game.events.on('tool:impact', (e) => window.__mpImpacts.push(`${e.tool}@${e.x},${e.z}:${e.hit}`));
  });
  await b.keyboard.press('KeyC');
  // Poll (a loaded machine can take a few frames longer than the swing) instead of one fixed sleep.
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    st = await allTile(T1);
    if (i >= 5 && st.every((s) => s.startsWith('11'))) break;
  }
  const wetOk = st.every((s) => s.startsWith('11'));
  const why = wetOk ? '' : ` · bea ${JSON.stringify(await net(b, () => ({ sel: window.__game.game.services.inventory.selected(), can: window.__game.game.services.farming.can(), at: window.__game.info().player, imp: window.__mpImpacts, st: window.__game.game.services.net.stats() })))}`;
  check('Bea waters: tile wet on all 3 clients', wetOk, st.join(' | ') + why);

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

  // ── sowing race: Ash + Bea sow the same tilled tile at once → one crop, one seed spent ──
  await net(a, (t) => { window.__game.teleport('farm', t.x + 0.5, t.z + 1.5); window.__game.facing('up'); }, T2);
  await net(b, (t) => { window.__game.teleport('farm', t.x - 0.5, t.z + 0.5); window.__game.facing('right'); }, T2);
  await net(host, (t) => window.__game.teleport('farm', t.x + 2.5, t.z + 2.5), T2);
  await sleep(700);
  const race0 = await Promise.all([a, b].map((p) => net(p, () => window.__game.game.services.inventory.count('parsnipSeeds'))));
  await Promise.all([a, b].map((p) => p.keyboard.press('Digit6')));
  await Promise.all([a, b].map((p) => p.keyboard.press('KeyC')));
  await sleep(2600);
  const race1 = await Promise.all([a, b].map((p) => net(p, () => window.__game.game.services.inventory.count('parsnipSeeds'))));
  st = await allTile(T2);
  const spent = race0[0] - race1[0] + race0[1] - race1[1];
  check('sowing race: one crop, exactly one seed spent (loser refunded)', spent === 1 && st.every((s) => s.includes('parsnip') && s === st[0]), `spent ${spent} (${race0.join('/')} → ${race1.join('/')}) · ${st[0]}`);

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
  const gotChat = await waitFor(host, () => (window.__mpChat ?? []).includes('hello from Bea'), null, 10000);
  check('chat reaches the host', gotChat, gotChat ? '' : JSON.stringify(await net(b, () => window.__game.game.services.net.stats())));

  // ── Ash leaves → back on their own farm (own purse), then comes back ──
  await net(a, () => window.__game.game.services.net.leave());
  await sleep(1500);
  const home = await net(a, () => ({ gold: window.__game.game.services.economy.gold(), role: window.__game.game.services.net.role() }));
  check('leaving returns the farmhand to their own farm (own purse restored)', home.role === 'solo' && home.gold === 77777, JSON.stringify(home));
  await net(a, (c) => window.__game.game.services.net.join(c), code);
  await waitFor(a, () => window.__game.game.services.net.status() === 'playing', null, 20000);
  idA = await net(a, () => window.__game.game.services.net.myId());
  await waitFor(host, () => window.__game.game.services.net.players().length === 3, null, 10000);

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
  // Loopback: < 100 ms, or — on a machine too loaded for that — about the two relay legs
  // (farmhand↔relay + host↔relay, both measured the same way): the transport itself adds nothing.
  const hostLeg = stats[0].relayRtt;
  check('network RTT farmhand → relay → host → back (worker-timed, loopback)', rtts.every((r, i) => r > 0 && (r < 100 || r <= (stats[i + 1].relayRtt + hostLeg) * 1.25 + 30)), rtts.map((r, i) => `${r} ms (relay legs ${stats[i + 1].relayRtt} + ${hostLeg}, app ${stats[i + 1].appRtt})`).join(' / '));

  // ── farmhand → farmhand motion: Bea watches Ash walk (samples on Ash's own clock) ──
  const aIdNow = await net(a, () => window.__game.game.services.net.myId());
  await net(a, (l) => { window.__game.teleport('farm', l.x + 0.5, l.z + 0.5); window.__game.facing('right'); }, lane);
  await net(b, (l) => window.__game.teleport('farm', l.x + 3, l.z + 3.5), lane);
  await sleep(1200);
  await net(b, (id) => {
    const r = window.__game.game.services.net.remotes.get(id);
    window.__raw = [];
    const orig = r.push.bind(r);
    r.__orig = orig;
    r.push = (t, x, z, ...rest) => { window.__raw.push([performance.now(), t, x]); return orig(t, x, z, ...rest); };
    window.__samp = [];
    const tick = () => { window.__samp.push([performance.now(), r.farmer.position.x, r.farmer.position.z]); window.__raf = requestAnimationFrame(tick); };
    tick();
  }, aIdNow);
  await a.keyboard.down('KeyD');
  await sleep(1600);
  await a.keyboard.up('KeyD');
  await sleep(800);
  const motion = await net(b, (id) => {
    cancelAnimationFrame(window.__raf);
    const r = window.__game.game.services.net.remotes.get(id);
    r.push = r.__orig;
    const raw = window.__raw;
    const samp = window.__samp;
    let dup = 0, moving = 0;
    const x0 = raw.length ? raw[0][2] : 0, x1 = raw.length ? raw[raw.length - 1][2] : 0;
    for (let i = 1; i < raw.length; i++) if (raw[i][2] > x0 + 0.05 && raw[i][2] < x1 - 0.05) { moving++; if (Math.abs(raw[i][2] - raw[i - 1][2]) < 1e-6) dup++; }
    const v = [];
    for (let i = 1; i < samp.length; i++) v.push(((samp[i][1] - samp[i - 1][1]) / Math.max(1, samp[i][0] - samp[i - 1][0])) * 1000);
    let f = v.findIndex((q) => Math.abs(q) > 0.05), l = v.length - 1;
    while (l > 0 && Math.abs(v[l]) < 0.05) l--;
    const mid = f >= 0 ? v.slice(f, l + 1) : [];
    const stalls = mid.filter((q) => Math.abs(q) < 0.05).length;
    const mean = mid.reduce((s, q) => s + q, 0) / Math.max(1, mid.length);
    const sd = Math.sqrt(mid.reduce((s, q) => s + (q - mean) ** 2, 0) / Math.max(1, mid.length));
    // Per frame (dt-normalised): backward steps against the walk (+x) and the fastest frame vs the
    // walk speed the samples themselves show.
    const walk = raw.length > 1 ? Math.abs(x1 - x0) / Math.max(1e-3, (raw[raw.length - 1][1] - raw[0][1]) / 1000) : 0;
    const vx = raw.length > 2 ? (() => { let best = 0; for (let i = 1; i < raw.length; i++) { const dt = (raw[i][1] - raw[i - 1][1]) / 1000; if (dt > 0.02) best = Math.max(best, Math.abs(raw[i][2] - raw[i - 1][2]) / dt); } return best; })() : walk;
    let back = 0, maxV = 0;
    for (let i = 1; i < samp.length; i++) {
      const dt = Math.max(1, samp[i][0] - samp[i - 1][0]) / 1000;
      const dx = samp[i][1] - samp[i - 1][1], dz = samp[i][2] - samp[i - 1][2];
      if (dx < -0.01) back++;
      maxV = Math.max(maxV, Math.hypot(dx, dz) / dt);
    }
    return { moving, dup, frames: mid.length, stalls, mean: +mean.toFixed(2), sd: +sd.toFixed(2), back, maxV: +maxV.toFixed(2), walk: +Math.max(walk, vx).toFixed(2) };
  }, aIdNow);
  log('farmhand→farmhand motion', JSON.stringify(motion));
  check('farmhand sees farmhand walk smoothly (no duplicate samples, few stalls)', motion.moving >= 8 && motion.dup <= Math.ceil(motion.moving * 0.05) && motion.stalls <= Math.ceil(motion.frames * 0.08), `${motion.dup}/${motion.moving} duplicate samples, ${motion.stalls}/${motion.frames} stalled frames, ${motion.mean}±${motion.sd} m/s`);
  check('farmhand sees farmhand walk: no backward steps, no pops (per frame)', motion.back === 0 && motion.maxV <= Math.max(2, motion.walk * 2), `${motion.back} backward frames, fastest frame ${motion.maxV} m/s vs walk ${motion.walk} m/s`);
  const perf = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.info().perf)));
  check('render budget with 3 farmers in view (host)', perf[0].drawCalls <= 300, `${perf[0].drawCalls} draw calls, ${(perf[0].triangles / 1e6).toFixed(2)}M tris`);

  // Pose for the photo (distinct spots, facing the camera), then each client's view.
  await net(host, (t) => { window.__game.teleport('farm', t.x + 2.6, t.z + 2.4); window.__game.facing('down'); }, T1);
  await net(a, (t) => { window.__game.teleport('farm', t.x + 0.5, t.z + 1.4); window.__game.facing('down'); }, T1);
  await net(b, (t) => { window.__game.teleport('farm', t.x - 1.6, t.z + 2.6); window.__game.facing('right'); }, T1);
  await net(a, () => window.__game.game.services.net.emote('happy'));
  await net(b, () => window.__game.game.services.net.chat('Race you to the pond!'));
  await sleep(1200);
  for (const [p, n] of [[host, 'host'], [a, 'ash'], [b, 'bea']]) await snap(p, resolve(outDir, `client-${n}.png`));
  log('screenshots → shots/mp/client-*.png');

  // ── drop + rejoin ─────────────────────────────────────────────────
  // (event-based: on a fast box the farmhand is back before a poll would catch the "away" state)
  await net(host, () => {
    window.__beaAway = false;
    window.__game.game.events.on('net:roster', ({ players }) => {
      if (players.some((p) => p.name === 'Bea' && p.away)) window.__beaAway = true;
    });
  });
  await net(b, () => window.__game.game.services.net.simulateDrop());
  const awaySeen = await waitFor(host, () => window.__beaAway === true, null, 8000);
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

  const purses = () => Promise.all([host, a, b].map((p) => net(p, () => window.__game.game.services.economy.gold())));
  // ── gold earned while the socket is down still reaches the shared purse ──
  await net(host, () => window.__game.setGold(1000));
  await sleep(1200);
  await net(b, () => window.__game.game.services.net.simulateDrop());
  await sleep(120);
  await net(b, () => window.__game.game.services.economy.add(123));
  await waitFor(b, () => window.__game.game.services.net.status() === 'playing', null, 15000);
  await sleep(2500);
  let gp = await purses();
  check('gold earned while disconnected arrives (purses agree)', gp.every((g) => g === 1123), gp.join(' / '));

  // ── double spend: two farmhands spend 800 of a 1000 purse at the same moment ──
  await net(host, () => window.__game.setGold(1000));
  await sleep(1500);
  const buy = (p) => net(p, () => {
    const g = window.__game.game.services;
    const ok = g.economy.spend(800, 'test');
    if (ok) g.inventory.add('cauliflowerSeeds', 4);
    return ok;
  });
  const seedsBefore = await Promise.all([a, b].map((p) => net(p, () => window.__game.game.services.inventory.count('cauliflowerSeeds'))));
  await Promise.all([buy(a), buy(b)]);
  await sleep(2500);
  gp = await purses();
  const seedsAfter = await Promise.all([a, b].map((p) => net(p, () => window.__game.game.services.inventory.count('cauliflowerSeeds'))));
  const bought = seedsAfter[0] - seedsBefore[0] + seedsAfter[1] - seedsBefore[1];
  check('double spend refused: one purchase stands, the other is returned', gp.every((g) => g === 200) && bought === 4, `purses ${gp.join(' / ')}, seeds bought ${bought}`);

  // ── reload: the backpack never rolls back (no item dupe) ──
  const seedsA0 = await net(a, () => window.__game.game.services.inventory.count('parsnipSeeds'));
  await net(a, () => {
    window.__game.game.services.inventory.remove('parsnipSeeds', 5);
    window.__game.game.services.economy.add(100);
  });
  await sleep(700);
  const goldSold = (await purses())[0];
  await a.reload({ waitUntil: 'load', timeout: 180000 });
  await a.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 180000 });
  await a.evaluate(() => window.__game.ready());
  await net(a, (c) => window.__game.game.services.net.join(c), code);
  await waitFor(a, () => window.__game.game.services.net.status() === 'playing', null, 20000);
  await sleep(1500);
  const seedsA1 = await net(a, () => window.__game.game.services.inventory.count('parsnipSeeds'));
  const idA2 = await net(a, () => window.__game.game.services.net.myId());
  gp = await purses();
  check('reload keeps the backpack as it was (no dupe) and the same slot', seedsA1 === seedsA0 - 5 && idA2 === idA && gp[0] === goldSold && gp.every((g) => g === gp[0]), `seeds ${seedsA0} → sold 5 → after reload ${seedsA1}; id ${idA2} (was ${idA}); purse ${gp.join(' / ')}`);

  // ── day end: everyone to bed ──────────────────────────────────────
  const day0 = await net(host, () => window.__game.info().calendar.day);
  await net(host, () => window.__game.setTime(22));
  await sleep(1300);
  await net(a, () => window.__game.game.services.net.goToBed('cabin'));
  await net(b, () => window.__game.game.services.net.goToBed('cabin'));
  await sleep(700);
  const waiting = await net(host, () => window.__game.info().calendar.day);
  check('day waits while someone is still up', waiting === day0);
  await snap(host, resolve(outDir, 'client-host-waiting.png'));
  await net(host, () => window.__game.game.services.net.goToBed('house'));
  const rolled = await Promise.all([host, a, b].map((p) => waitFor(p, (d) => window.__game.info().calendar.day === d + 1, day0, 15000)));
  check('day ends for everyone once all are in bed', rolled.every(Boolean));
  await sleep(4000);
  const digests2 = await Promise.all([host, a, b].map((p) => net(p, () => [...window.__game.game.services.net.sync.digest()].sort((x, y) => x[0] - y[0]).map((e) => e.join('=')).join(';'))));
  check('farm converges after the night (growth, weeds, crows)', diff(digests2[0], digests2[1]) === 0 && diff(digests2[0], digests2[2]) === 0, `diff ${diff(digests2[0], digests2[1])} / ${diff(digests2[0], digests2[2])}`);
  for (const [p, n] of [[host, 'host'], [a, 'ash'], [b, 'bea']]) await snap(p, resolve(outDir, `client-${n}-morning.png`));
  // Name tags / chat / emote bubbles never float over the day-end card (or any open panel).
  const overCard = await Promise.all([host, a, b].map((p) => net(p, () => {
    const panel = window.__game.game.hud.openPanelName;
    const vis = [...document.querySelectorAll('.coop-tag.on')].filter((e) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return cs.visibility !== 'hidden' && +cs.opacity > 0.3 && r.bottom > 0 && r.top < innerHeight && e.closest('.coop-tags')?.offsetParent !== null;
    }).length;
    return { panel, vis };
  })));
  check('no name tags over the day-end card (every client)', overCard.every((o) => !o.panel || o.vis === 0) && overCard.some((o) => o.panel), overCard.map((o, i) => `${['host', 'ash', 'bea'][i]}: ${o.panel ?? 'no panel'} / ${o.vis} tags`).join(' · '));
  const ashSave = await net(a, () => { const f = JSON.parse(localStorage.getItem('hearthvale.save.auto')); return { savedAt: f.savedAt, gold: f.data.economy?.gold }; });
  check("farmhand's own save untouched by the co-op night", ashSave.gold === 77777 && ashSave.savedAt === ashOwn, JSON.stringify(ashSave));

  // ── bedtime: the last one awake crashes → the night still ends ──
  const dayB = await net(host, () => window.__game.info().calendar.day);
  await net(host, () => window.__game.setTime(22.5));
  await sleep(1300);
  await net(a, () => window.__game.game.services.net.goToBed('cabin'));
  await net(host, () => window.__game.game.services.net.goToBed('house'));
  await sleep(800);
  const bCtx = b.context();
  await b.close();
  const crashT = Date.now();
  const rolledB = await waitFor(host, (d) => window.__game.info().calendar.day === d + 1, dayB, 12000);
  check('last awake farmer crashes → the day still ends', rolledB, `${((Date.now() - crashT) / 1000).toFixed(1)} s`);
  await sleep(2500);

  // ── the crashed player opens a new tab: same slot, same backpack (persistent player id) ──
  b = await bCtx.newPage();
  b.on('pageerror', (e) => errors.push(`bea2 pageerror: ${e.message}`));
  await b.goto(`http://127.0.0.1:${port}/?name=Bea&preset=1&server=${encodeURIComponent(wsUrl)}`, { waitUntil: 'load', timeout: 180000 });
  await b.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 180000 });
  await b.evaluate(() => window.__game.ready());
  const reB = await net(b, (c) => window.__game.game.services.net.join(c).then(() => 'joined', (e) => `refused: ${e.message}`), code);
  const idB2 = await net(b, () => window.__game.game.services.net.myId());
  const beaSeeds = await net(b, () => window.__game.game.services.inventory.count('cauliflowerSeeds'));
  check('crashed farmhand rejoins from a new tab into the same slot', reB === 'joined' && idB2 === idB, `${reB}, id ${idB2} (was ${idB}), cauliflower seeds ${beaSeeds}`);

  // ── an impostor called "Ash" gets their own name + a fresh backpack ──
  const imp = await openClient('imp', 'name=Ash&preset=2');
  const reI = await net(imp, (c) => window.__game.game.services.net.join(c).then(() => 'joined', (e) => `refused: ${e.message}`), code);
  await sleep(1500);
  const impName = await net(imp, () => window.__game.game.services.net.players().find((p) => p.isMe).name);
  const impSeeds = await net(imp, () => window.__game.game.services.inventory.count('parsnipSeeds'));
  const ashSeeds = await net(a, () => window.__game.game.services.inventory.count('parsnipSeeds'));
  check('same-name impostor: unique name, own (starter) backpack', reI === 'joined' && impName !== 'Ash' && impSeeds === 15 && ashSeeds !== 15, `${reI} as "${impName}", seeds ${impSeeds} (real Ash ${ashSeeds})`);

  // ── the host kicks the impostor: slot freed, they're sent home, can't walk straight back in ──
  const impId = await net(imp, () => window.__game.game.services.net.myId());
  await net(host, (id) => window.__game.game.services.net.kick(id), impId);
  const kicked = await waitFor(imp, () => window.__game.game.services.net.role() === 'solo', null, 8000);
  const gone = await waitFor(host, (id) => !window.__game.game.services.net.players().some((p) => p.id === id), impId, 8000);
  const reK = await net(imp, (c) => window.__game.game.services.net.join(c).then(() => 'joined', (e) => `refused: ${e.message}`), code);
  check('host kick frees the slot; kicked player is refused for a while', kicked && gone && reK.startsWith('refused'), `${kicked}/${gone} · rejoin: ${reK}`);
  await imp.context().close();


  // ── frame-time with 3 clients running (headless, shared GPU) ──────
  await sleep(3000);
  const fps = await Promise.all([host, a, b].map((p) => net(p, () => window.__game.game.services.net.stats().frameMs)));
  log('frame ms (avg/p95/p99)', fps.map((f) => `${f.avg}/${f.p95}/${f.p99}`).join('  '));
  const fpsHost = 1000 / Math.max(1, fps[0].avg);
  results.push({ name: 'fps (host, 3 headless browsers sharing one GPU)', ok: true, detail: `${fpsHost.toFixed(1)} fps avg` });
  console.log(`• fps host ${fpsHost.toFixed(1)} (3 headless pages share one GPU; see npm run perf for the real gate)`);
  const st2 = await Promise.all([a, b].map((p) => net(p, () => window.__game.game.services.net.stats())));
  for (const [i, s2] of st2.entries()) log(`${['ash', 'bea'][i]} farm sync: ${s2.reconciles} host edits, ${s2.drift} drift, ${s2.needs} mid-day resyncs, ${s2.fullSyncs} full syncs`, s2.driftLog.join(' '));
  check('steady-state farm drift ≈ 0 (prediction agrees with the host)', st2.every((s2) => s2.drift <= 2 && s2.needs <= 1), st2.map((s2, i) => `${['ash', 'bea'][i]} drift ${s2.drift}, resyncs ${s2.needs}`).join(' · '));
  const relayStats = await relay.health();
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
