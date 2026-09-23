#!/usr/bin/env node
/**
 * Mines co-op end-to-end test: relay + Vite + 2 headless Chromium pages (host + farmhand).
 *
 *   node scripts/mine-coop-test.mjs [--gpu swiftshader]
 *
 * Checks the host-authoritative mine (world/mine/coop.ts): same seeded floor on both machines,
 * the farmhand's monsters mirror the host's, a farmhand pick strike breaks the rock on both screens
 * and its loot reaches the farmhand's backpack, a farmhand sword swing damages the host's monster,
 * monsters hunt the farmhand too, different floors run a headless sim on the host (farmers on other
 * floors are hidden), and the host walking onto that floor adopts the sim. Screenshots each view
 * into shots/mine-coop/. Exits non-zero on any failed check.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/mine-coop');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const gpuMode = argv.includes('--gpu') ? argv[argv.indexOf('--gpu') + 1] : 'auto';

setTimeout(() => {
  console.error('[mine-coop] failed: global timeout');
  process.exit(3);
}, 15 * 60_000).unref();

const t0 = Date.now();
const log = (...a) => console.log(`[mine-coop +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const relay = await startServer({ port: 0, log: false, serveDist: false });
const wsUrl = `ws://127.0.0.1:${relay.port}/ws`;
const vite = await createServer({ root, logLevel: 'error', cacheDir: resolve(tmpdir(), `hearthvale-minecoop-${process.pid}`), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await vite.listen();
const port = vite.httpServer.address().port;
log(`relay ${wsUrl} · vite :${port}`);

const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const SWIFT = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const browser = await chromium.launch({ headless: true, args: gpuMode === 'swiftshader' ? SWIFT : GPU });
const errors = [];
async function open(label, query) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console.error: ${m.text()}`);
    else if (process.env.MP_VERBOSE) console.log(`[${label}] ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?${query}&server=${encodeURIComponent(wsUrl)}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 240000 });
  await page.evaluate(() => window.__game.ready());
  log(`${label} ready`);
  return page;
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const waitFor = async (page, fn, arg, timeout = 20000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
};
const gotoFloor = (page, f) => ev(page, (n) => window.__game.game.services.mining.goto(n, 'debug'), f);
const mineState = (page) =>
  ev(page, () => {
    const g = window.__game.game;
    const m = g.world.current;
    if (!m || m.id !== 'mine') return null;
    return {
      floor: m.floor,
      rocks: m.rocks.rocks.filter((r) => r.alive).length,
      rockSig: m.layout.rocks.map((r) => r.x * 100 + r.z).reduce((a, b) => (a * 31 + b) % 1e9, 7),
      mons: m.monsters.filter((x) => x.alive).map((x) => ({ id: x.netId, kind: x.kind, x: +x.pos.x.toFixed(2), z: +x.pos.z.toFixed(2), hp: x.hp })),
      stats: g.services.mineNet.stats(),
      hp: g.services.health.value(),
    };
  });

let host, hand;
try {
  host = await open('host', 'notitle=1&map=farm&x=30.5&z=22.5&time=9&name=Hazel');
  const code = await ev(host, () => window.__game.game.services.net.host());
  check('host opened a lobby', /^[A-Z0-9]{6}$/.test(code), code);
  hand = await open('hand', 'name=Ash&preset=0');
  await ev(hand, (c) => window.__game.game.services.net.join(c), code);
  check('farmhand joined', await waitFor(hand, () => window.__game.game.services.net.players().length === 2, null, 30000));
  const handId = await ev(hand, () => window.__game.game.services.net.myId());

  // ── both on floor 3 ──────────────────────────────────────────────
  await Promise.all([gotoFloor(host, 3), gotoFloor(hand, 3)]);
  await sleep(2500);
  let H = await mineState(host);
  let A = await mineState(hand);
  check('same seeded floor on both machines', H && A && H.rockSig === A.rockSig && H.rocks === A.rocks, `${H?.rockSig}/${A?.rockSig} rocks ${H?.rocks}/${A?.rocks}`);
  const hostIds = (H?.mons ?? []).map((m) => m.id).sort().join(',');
  const handIds = (A?.mons ?? []).map((m) => m.id).sort().join(',');
  check('farmhand mirrors the host monsters', !!hostIds && hostIds === handIds, `${hostIds} | ${handIds}`);
  const drift = (H?.mons ?? []).map((m) => {
    const o = A.mons.find((q) => q.id === m.id);
    return o ? Math.hypot(o.x - m.x, o.z - m.z) : 99;
  });
  const med = [...drift].sort((a, b) => a - b)[Math.floor(drift.length / 2)] ?? 99;
  check('mirrors track the host positions (median < 0.6 m, ~120 ms behind)', drift.length > 0 && med < 0.6, drift.map((d) => d.toFixed(2)).join(' '));

  // ── farmhand pick: break the nearest plain rock ──────────────────
  const target = await ev(hand, () => {
    const g = window.__game.game;
    const m = g.world.current;
    const p = g.player.position;
    let best = null;
    for (const r of m.rocks.rocks) {
      if (!r.alive) continue;
      const sx = r.spec.x - 1;
      if (!m.grid.isWalkable(sx, r.spec.z)) continue;
      const d = Math.hypot(r.spec.x - p.x, r.spec.z - p.z);
      if (!best || d < best.d) best = { x: r.spec.x, z: r.spec.z, d };
    }
    return best;
  });
  await ev(hand, (t) => {
    window.__game.teleport('mine', t.x - 0.5, t.z + 0.5);
    window.__game.facing('right');
    const m = window.__game.game.world.current;
    for (const mo of m.monsters) mo.pos.x += 0; // (mirrors; nothing to do)
  }, target);
  const inv0 = await ev(hand, () => window.__game.game.services.inventory.count('stone'));
  for (let k = 0; k < 8; k++) {
    const alive = await ev(host, (t) => !!window.__game.game.world.current.rockAt(t.x, t.z), target);
    if (!alive) break;
    await ev(hand, (t) => window.__game.game.events.emit('item:use', { itemId: 'pickaxe', x: t.x, z: t.z, slot: 3 }), target);
    await sleep(900);
  }
  const goneHost = await ev(host, (t) => !window.__game.game.world.current.rockAt(t.x, t.z), target);
  const goneHand = await ev(hand, (t) => !window.__game.game.world.current.rockAt(t.x, t.z), target);
  check('farmhand pick breaks the rock on the host (authority)', goneHost);
  check('…and on the farmhand', goneHand);
  await sleep(2500);
  const inv1 = await ev(hand, () => window.__game.game.services.inventory.count('stone'));
  check('rock loot reaches the farmhand backpack (host-granted)', inv1 > inv0, `${inv0} → ${inv1}`);

  // ── farmhand sword on a host monster ─────────────────────────────
  await ev(host, () => (window.__game.game.world.current.freezeAI = true));
  await sleep(300);
  H = await mineState(host);
  const mon = H.mons.find((m) => m.kind !== 'bat') ?? H.mons[0];
  if (mon) {
    await ev(hand, (mo) => {
      window.__game.teleport('mine', mo.x - 1.1, mo.z);
      window.__game.facing('right');
      const inv = window.__game.game.services.inventory;
      if (inv.count('sword') === 0) inv.add('sword', 1);
    }, mon);
    await sleep(600);
    await ev(hand, () => window.__game.game.events.emit('item:use', { itemId: 'sword', x: 0, z: 0, slot: 4 }));
    await sleep(1200);
    const after = await ev(host, (id) => window.__game.game.world.current.monsters.find((x) => x.netId === id)?.hp ?? -1, mon.id);
    check('farmhand sword damages the host monster', after < mon.hp, `${mon.hp} → ${after}`);
    await ev(host, () => (window.__game.game.world.current.freezeAI = false));
  } else check('a monster to hit', false);

  // ── monsters hunt the farmhand ───────────────────────────────────
  const hp0 = (await mineState(hand)).hp;
  H = await mineState(host);
  const near = H.mons.find((m) => m.kind === 'slime') ?? H.mons[0];
  if (near) {
    await ev(host, () => window.__game.teleport('mine', window.__game.game.world.current.layout.spawn.x, window.__game.game.world.current.layout.spawn.z));
    await ev(hand, (mo) => window.__game.teleport('mine', mo.x + 0.6, mo.z), near);
    await sleep(5000);
  }
  const hp1 = (await mineState(hand)).hp;
  check('host monsters attack the farmhand (per-player health)', hp1 < hp0, `${hp0} → ${hp1}`);
  await ev(hand, () => window.__game.game.services.health.set(100));

  await Promise.all([host.screenshot({ path: resolve(outDir, 'same-floor-host.png') }), hand.screenshot({ path: resolve(outDir, 'same-floor-hand.png') })]);

  // ── different floors: headless sim on the host ───────────────────
  await gotoFloor(hand, 6);
  await sleep(2500);
  const hs = await ev(host, () => window.__game.game.services.mineNet.stats());
  check('host runs floor 6 headless while standing on 3', hs.headless.includes(6), JSON.stringify(hs));
  A = await mineState(hand);
  check('farmhand on floor 6 sees the headless monsters', A.floor === 6 && A.mons.length > 0, `${A.mons.length} mirrors`);
  const hostVisible = await ev(hand, (id) => {
    const r = window.__game.game.services.net.remotes.list.values().next().value;
    return !!r?.farmer.root.parent;
  }, handId);
  check('farmers on other floors are hidden', !hostVisible);
  // break a rock on the headless floor
  const t2 = await ev(hand, () => {
    const g = window.__game.game;
    const m = g.world.current;
    for (const r of m.rocks.rocks) if (r.alive && m.grid.isWalkable(r.spec.x - 1, r.spec.z)) return { x: r.spec.x, z: r.spec.z };
    return null;
  });
  await ev(hand, (t) => {
    window.__game.teleport('mine', t.x - 0.5, t.z + 0.5);
    window.__game.facing('right');
  }, t2);
  for (let k = 0; k < 8; k++) {
    const alive = await ev(hand, (t) => !!window.__game.game.world.current.rockAt(t.x, t.z), t2);
    if (!alive) break;
    await ev(hand, (t) => window.__game.game.events.emit('item:use', { itemId: 'pickaxe', x: t.x, z: t.z, slot: 3 }), t2);
    await sleep(900);
  }
  check('headless floor: farmhand breaks a rock', !(await ev(hand, (t) => !!window.__game.game.world.current.rockAt(t.x, t.z), t2)));
  const before6 = (await mineState(hand)).mons.map((m) => m.id).sort().join(',');

  // ── host walks onto floor 6: adopts the headless sim ─────────────
  await gotoFloor(host, 6);
  await sleep(2500);
  H = await mineState(host);
  A = await mineState(hand);
  const hostIds6 = H.mons.map((m) => m.id).sort().join(',');
  check('host adopts the headless monsters (same ids)', hostIds6 === before6 || hostIds6 === A.mons.map((m) => m.id).sort().join(','), `${hostIds6} | ${before6}`);
  check('the broken rock stays broken for the host', !(await ev(host, (t) => !!window.__game.game.world.current.rockAt(t.x, t.z), t2)));
  const hs2 = await ev(host, () => window.__game.game.services.mineNet.stats());
  check('no headless sim once the host is there', !hs2.headless.includes(6), JSON.stringify(hs2));
  await ev(hand, (h) => window.__game.teleport('mine', h.x + 1.5, h.z + 0.5), await ev(host, () => ({ x: window.__game.game.player.position.x, z: window.__game.game.player.position.z })));
  await sleep(1500);
  const seeEach = await ev(hand, () => [...window.__game.game.services.net.remotes.list.values()].some((r) => !!r.farmer.root.parent));
  check('farmers on the same floor see each other', seeEach);
  const perf = await Promise.all([host, hand].map((p) => ev(p, () => window.__game.info().perf.drawCalls)));
  check('render budget with 2 farmers in the mine (≤ 300 draw calls)', perf.every((d) => d <= 300), perf.join(' / '));
  await Promise.all([host.screenshot({ path: resolve(outDir, 'floor6-host.png') }), hand.screenshot({ path: resolve(outDir, 'floor6-hand.png') })]);
} catch (err) {
  console.error('[mine-coop] crashed:', err);
  failed++;
} finally {
  for (const e of errors.slice(0, 20)) console.error(e);
  if (errors.some((e) => e.includes('pageerror'))) failed++;
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
  await relay.close?.().catch?.(() => {});
  console.log(failed ? `✗ ${failed} check(s) failed` : '✓ all mine co-op checks passed');
  process.exit(failed ? 1 : 0);
}
