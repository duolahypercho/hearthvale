#!/usr/bin/env node
/**
 * Co-op farmhand success-path matrix for the farm buildings + animals pod (DESIGN pillar 13).
 *
 *   node scripts/animals-coop-test.mjs [--gpu swiftshader] [--keep]
 *
 * Relay + Vite + two headless clients (host Hazel, farmhand Ash). Every animal chore is done by the
 * FARMHAND through its real interact path (`player:interact` at the tile / body it clicks, the tool or
 * hay selected in its toolbar), and each one is checked end to end:
 *   - the host approved it (authoritative state changed, `rejected` did not move),
 *   - the right recipient got the right item at the right quality (the farmhand's backpack; the host's
 *     backpack untouched), resources were deducted (hay, wood / stone, the shared purse),
 *   - the host sees the remote action (the hop + heart on its own screen when on the same map),
 *   - the farmhand's own view converges (snapshot) — and again after a leave + rejoin.
 * Matrix: carpenter order (coop) · pop-door toggle · egg pickup (per nest, quality) · trough fill ·
 * milking (pail) · shearing (shears) · truffle pickup · pet-bowl fill · petting · reconnect convergence.
 * Exits non-zero on any failed check; screenshots in shots/animals-coop/.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/animals-coop');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const gpuMode = argv.includes('--gpu') ? argv[argv.indexOf('--gpu') + 1] : 'auto';

setTimeout(() => {
  console.error('[acoop] failed: global timeout');
  process.exit(3);
}, (Number(process.env.MP_TIMEOUT_MIN) || 15) * 60_000).unref();

const t0 = Date.now();
const log = (...a) => console.log(`[acoop +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failed = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const relayProc = spawn(process.execPath, [resolve(root, 'server/index.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const relayPort = await new Promise((res, rej) => {
  let buf = '';
  relayProc.stdout.on('data', (d) => {
    buf += String(d);
    const m = /listening on ws:\/\/[^:]+:(\d+)/.exec(buf);
    if (m) res(Number(m[1]));
  });
  relayProc.on('exit', (c) => rej(new Error(`relay exited (${c})`)));
});
const wsUrl = `ws://127.0.0.1:${relayPort}/ws`;
const cacheDir = resolve(tmpdir(), `hearthvale-acoop-${process.pid}`);
const vite = await createServer({ root, logLevel: 'error', cacheDir, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await vite.listen();
const port = vite.httpServer.address().port;
log(`relay ${wsUrl} · vite :${port}`);

const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const SWIFT = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const browser = await chromium.launch({ headless: true, args: gpuMode === 'swiftshader' ? SWIFT : GPU });

const errors = [];
async function openClient(label, query) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?${query}&server=${encodeURIComponent(wsUrl)}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 180000 });
  await page.evaluate(() => window.__game.ready());
  log(`${label} ready`);
  return page;
}
const net = (page, fn, arg) => page.evaluate(fn, arg);
const waitFor = async (page, fn, arg, timeout = 15000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
};
const snap = async (page, file) => {
  try {
    await page.screenshot({ path: resolve(outDir, file), timeout: 60000 });
  } catch (e) {
    log(`screenshot ${file} skipped: ${String(e?.message ?? e).split('\n')[0]}`);
  }
};

/** In-page helpers (installed on both clients). */
const HELPERS = () => {
  const g = window.__game.game;
  window.__ac = {
    A: () => g.services.animals,
    inv: () => g.services.inventory,
    /** Count of an item in the backpack at a quality (null = any quality). */
    have: (id, q = null) => g.services.inventory.slots.filter((s) => s && s.id === id && (q == null || (s.quality ?? 0) === q)).reduce((n, s) => n + s.qty, 0),
    /** Put an item in toolbar slot 9 and select it (what a player does with the number keys). */
    hold: (id, qty = 1) => {
      g.services.inventory.setSlot(8, { id, qty });
      g.events.emit('toolbar:select', { slot: 8 });
    },
    click: (x, z) => g.events.emit('player:interact', { x, z }),
    rec: (id) => g.services.animals.roster().find((r) => r.id === id),
    live: (id) => g.services.animals['live'].find((l) => l.rec?.id === id),
    hearts: () => g.services.animals['pops'].hearts().length,
    digest: () => {
      const A = g.services.animals;
      const st = A['st'];
      return JSON.stringify({
        herd: A.roster().map((r) => [r.id, r.species, r.fed, r.petted, r.ready, r.friendship]).sort((a, b) => a[0] - b[0]),
        eggs: st.eggs.map((e) => `${e.nest}:${e.item}:${e.q}`).sort(),
        hay: st.hay,
        doors: st.doors,
        bowl: st.pet.bowl,
        truffles: st.truffles.map((t) => `${Math.floor(t.x)},${Math.floor(t.z)}:${t.q}`).sort(),
        built: g.services.buildings.snapshot(),
      });
    },
  };
};

let host;
let ash;
try {
  host = await openClient('host', 'notitle=1&map=farm&x=44.5&z=39.5&time=9.2&season=spring&weather=sun&name=Hazel');
  const code = await net(host, () => window.__game.game.services.net.host());
  check('host opened a lobby', /^[A-Z0-9]{6}$/.test(code), code);
  ash = await openClient('ash', 'name=Ash&preset=0');
  await net(ash, (c) => window.__game.game.services.net.join(c), code);
  const joined = await waitFor(host, () => window.__game.game.services.net.players().length === 2, null, 30000);
  check('farmhand joined', joined);
  await Promise.all([host, ash].map((p) => net(p, HELPERS)));
  const idAsh = await net(ash, () => window.__game.game.services.net.myId());
  await net(ash, () => window.__game.teleport('farm', 37.5, 31.4));
  await sleep(1200);

  // ── 1. carpenter: the farmhand orders a coop with wood + stone from its own backpack ──
  await net(host, () => {
    const g = window.__game.game;
    g.services.buildings.complete('barn');
    g.services.economy.set(20000);
  });
  await net(ash, () => {
    window.__game.give('wood', 300);
    window.__game.give('stone', 100);
  });
  await sleep(1500); // the backpack mirror (psave) reaches the host
  const ord0 = await net(host, () => ({ gold: window.__game.game.services.economy.gold(), rej: window.__game.game.services.buildings.rejected }));
  const ordErr = await net(ash, () => window.__game.game.services.buildings.order('coop'));
  const ordered = await waitFor(host, () => window.__game.game.services.buildings.pending('coop'), null, 8000);
  await sleep(800);
  const ord1 = await net(host, () => ({ gold: window.__game.game.services.economy.gold(), rej: window.__game.game.services.buildings.rejected }));
  const ashMat = await net(ash, () => ({ wood: window.__ac.have('wood'), stone: window.__ac.have('stone'), pending: window.__game.game.services.buildings.pending('coop') }));
  check('carpenter: a farmhand order with materials is approved by the host (coop staked)', ordErr == null && ordered && ord1.rej === ord0.rej, `${ordErr} ${JSON.stringify(ord1)}`);
  check('carpenter: the shared purse pays the gold, the farmhand\'s backpack the wood + stone', ord0.gold - ord1.gold === 3600 && ashMat.wood === 60 && ashMat.stone === 20, `${ord0.gold}→${ord1.gold} ${JSON.stringify(ashMat)}`);
  check('carpenter: the farmhand sees the staked site', ashMat.pending === true);

  // ── stage the herd on the host: coop finished, hens + ducks, a cow + a sheep ready, a pig ──
  const ids = await net(host, () => {
    const g = window.__game.game;
    g.services.buildings.complete('coop');
    const A = g.services.animals;
    const add = (sp, v, name, fr) => A['add'](sp, v, name, fr);
    const hen = add('chicken', 1, 'Pudding', 520);
    const hen2 = add('chicken', 0, 'Maple', 200);
    const cow = add('cow', 0, 'Clover', 840);
    const sheep = add('sheep', 0, 'Bramble', 380);
    const pig = add('pig', 0, 'Truffle', 300);
    for (const r of A['st'].animals) {
      r.ready = true;
      r.mood = 220;
    }
    const st = A['st'];
    st.eggs = [{ nest: 0, item: 'brownEgg', q: 2, id: hen.id, sp: 'chicken' }, { nest: 1, item: 'egg', q: 0, id: hen2.id, sp: 'chicken' }];
    st.hay.coop = [false, false, false, false, false, false];
    st.truffles = [{ x: 42.4, z: 39.4, q: 1 }];
    st.pet.bowl = false;
    st.doors = { coop: false, barn: true };
    A['syncDoors']();
    A['respawn']();
    A['refreshProps']();
    // Pin the cow + sheep where the farmhand will reach them (their own wander brain off).
    const at = { [cow.id]: [46.2, 38.6, 1.6], [sheep.id]: [48.6, 39.9, -1.4] };
    for (const l of A['live']) {
      const s = l.rec && at[l.rec.id];
      if (!s) continue;
      l.actor.area = { x0: s[0] - 0.02, z0: s[1] - 0.02, x1: s[0] + 0.02, z1: s[1] + 0.02 };
      l.actor.curious = false;
      l.actor.calm = true;
      l.actor.place(s[0], s[1], s[2]);
      l.actor.settle();
    }
    A['touch']();
    return { hen: hen.id, hen2: hen2.id, cow: cow.id, sheep: sheep.id, pig: pig.id, qCow: A['quality'](cow), qSheep: A['quality'](sheep), out: A['live'].filter((l) => l.rec).length };
  });
  check('host staged the herd (barn animals out on the pasture)', ids.out >= 3, JSON.stringify(ids));
  const herdSeen = await waitFor(ash, (i) => !!window.__ac.live(i.cow) && !!window.__ac.live(i.sheep), ids, 15000);
  check('farmhand sees the pinned cow + sheep', herdSeen);
  const rej0 = await net(host, () => window.__ac.A().rejected);

  // ── 2. milking: Ash holds the pail beside Clover and clicks her ──
  await net(ash, () => window.__game.teleport('farm', 46.9, 39.9));
  await net(ash, () => window.__ac.hold('milkPail'));
  await sleep(1300);
  const hh0 = await net(host, () => window.__ac.hearts());
  await net(ash, (i) => {
    const p = window.__ac.live(i.cow).actor.pos;
    window.__ac.click(p.x, p.z);
  }, ids);
  const milked = await waitFor(ash, () => window.__ac.have('milk') > 0, null, 8000);
  const m1 = await net(ash, (i) => ({ milk: window.__ac.have('milk', i.qCow), any: window.__ac.have('milk') }), ids);
  const hm = await net(host, (i) => ({ ready: window.__ac.rec(i.cow).ready, petted: window.__ac.rec(i.cow).petted, hearts: window.__ac.hearts(), hostMilk: window.__ac.have('milk') }), ids);
  check('milking: the host approves and the farmhand gets milk at the cow\'s quality', milked && m1.milk === 1 && !hm.ready && hm.petted && hm.hostMilk === 0, `q${ids.qCow} ${JSON.stringify(m1)} ${JSON.stringify(hm)}`);
  check('milking: the host sees the farmhand\'s pat (hop + heart on its screen)', hm.hearts > hh0, `${hh0}→${hm.hearts}`);
  await snap(host, 'host-sees-milking.png');

  // ── 3. shearing ──
  await net(ash, () => window.__game.teleport('farm', 47.8, 40.9));
  await net(ash, () => window.__ac.hold('shears'));
  await sleep(1300);
  await net(ash, (i) => {
    const p = window.__ac.live(i.sheep).actor.pos;
    window.__ac.click(p.x, p.z);
  }, ids);
  const shorn = await waitFor(ash, () => window.__ac.have('wool') > 0, null, 8000);
  const s1 = await net(ash, (i) => window.__ac.have('wool', i.qSheep), ids);
  const hs = await net(host, (i) => ({ ready: window.__ac.rec(i.sheep).ready, wool: +window.__ac.live(i.sheep).actor.wool.toFixed(2) }), ids);
  const fs = await waitFor(ash, (i) => window.__ac.live(i.sheep)?.actor.wool < 0.5, ids, 6000);
  check('shearing: wool at the sheep\'s quality to the farmhand; the fleece comes off on the host', shorn && s1 === 1 && !hs.ready && hs.wool < 0.5, `q${ids.qSheep} wool ${s1} ${JSON.stringify(hs)}`);
  check('shearing: the farmhand\'s sheep is shorn too', fs);

  // ── 4. truffle ──
  await net(ash, () => window.__game.teleport('farm', 42.5, 40.5));
  await sleep(1300);
  await net(ash, () => window.__ac.click(42, 39));
  const tru = await waitFor(ash, () => window.__ac.have('truffle', 1) === 1, null, 8000);
  const ht = await net(host, () => window.__ac.A()['st'].truffles.length);
  check('truffle: picked up by the farmhand at silver quality, gone from the host\'s pasture', tru && ht === 0, `host truffles ${ht}`);

  // ── 5. pop door (farm side hatch beside the coop door) ──
  await net(ash, () => window.__game.teleport('farm', 40.5, 35.5));
  await sleep(1300);
  await net(ash, () => window.__ac.click(40, 34));
  const door = await waitFor(host, () => window.__ac.A()['st'].doors.coop === true, null, 8000);
  check('pop door: the farmhand opens the coop hatch (host state)', door);

  // ── 6. pet bowl ──
  await net(ash, () => window.__game.teleport('farm', 35.4, 18.6));
  await sleep(1300);
  await net(ash, () => window.__ac.click(34, 17));
  const bowl = await waitFor(host, () => window.__ac.A()['st'].pet.bowl === true, null, 8000);
  check('pet bowl: the farmhand fills it (host state)', bowl);

  // ── 7. inside the coop: eggs (per nest, quality) + the trough ──
  await net(host, () => {
    // the flock indoors for the coop chores (the hatch shut again)
    const A = window.__ac.A();
    A['st'].doors.coop = false;
    A['syncDoors']();
    A['touch']();
  });
  await net(ash, () => window.__game.teleport('coop', 1.5, 1.05));
  await waitFor(ash, () => window.__game.game.world.current?.id === 'coop', null, 20000);
  await net(ash, () => window.__game.facing('up'));
  await sleep(1500);
  await net(ash, () => window.__ac.click(0, 0));
  const egg = await waitFor(ash, () => window.__ac.have('brownEgg', 2) === 1, null, 8000);
  const he = await net(host, () => window.__ac.A()['st'].eggs.map((e) => e.nest).join(','));
  check('eggs: the farmhand lifts the gold-star brown egg from nest 0 (only that nest)', egg && he === '1', `host nests left: ${he}`);
  await net(ash, () => window.__ac.click(1, 0));
  const egg2 = await waitFor(ash, () => window.__ac.have('egg', 0) === 1, null, 8000);
  check('eggs: the second nest\'s white egg (normal quality)', egg2);
  const hostEggs = await net(host, () => window.__ac.have('egg') + window.__ac.have('brownEgg'));
  check('eggs: nothing landed in the host\'s backpack', hostEggs === 0, String(hostEggs));

  const trough = await net(ash, () => {
    const pen = window.__ac.A()['pen']();
    const t = pen.trough;
    return { x: t.x0, z: t.z0, wx: t.x0 + 0.5, wz: t.z0 - 0.6 };
  });
  await net(ash, (t) => window.__game.teleport('coop', t.wx, t.wz), trough);
  await net(ash, () => {
    window.__ac.hold('hay', 10);
    window.__game.facing('down');
  });
  await sleep(1500);
  const want = await net(host, () => Math.max(1, window.__ac.A().count('coop')));
  await net(ash, (t) => window.__ac.click(t.x, t.z), trough);
  const fed = await waitFor(host, (n) => window.__ac.A()['st'].hay.coop.filter(Boolean).length === n, want, 8000);
  await sleep(600);
  const hayLeft = await net(ash, () => window.__ac.have('hay'));
  const fHay = await net(ash, () => window.__ac.A()['st'].hay.coop.filter(Boolean).length);
  check('trough: the farmhand\'s hay fills one slot per bird on the host', fed, `want ${want}`);
  check('trough: the hay comes out of the farmhand\'s backpack, the farmhand sees the filled trough', hayLeft === 10 - want && fHay === want, `left ${hayLeft} sees ${fHay}`);
  await snap(ash, 'farmhand-coop.png');

  const rej1 = await net(host, () => window.__ac.A().rejected);
  check('no farmhand success-path intent was refused by the host', rej1 === rej0, `${rej0}→${rej1}`);

  // ── 8. reconnect: leave + rejoin, everything converges ──
  await net(ash, () => window.__game.game.services.net.leave());
  await sleep(1500);
  await net(ash, (c) => window.__game.game.services.net.join(c), code);
  const back = await waitFor(host, () => window.__game.game.services.net.players().length === 2, null, 30000);
  await waitFor(ash, () => window.__game.game.services.net.status() === 'playing', null, 30000);
  await sleep(3500);
  const [dh, da] = await Promise.all([host, ash].map((p) => net(p, () => window.__ac.digest())));
  check('reconnect: the farmhand rejoins and its herd / eggs / hay / doors / bowl / buildings match the host', back && dh === da, dh === da ? '' : `host ${dh}\nash  ${da}`);
  const kept = await net(ash, () => ({ milk: window.__ac.have('milk'), wool: window.__ac.have('wool'), truffle: window.__ac.have('truffle'), eggs: window.__ac.have('egg') + window.__ac.have('brownEgg') }));
  check('reconnect: the farmhand keeps every grant (milk, wool, truffle, 2 eggs)', kept.milk === 1 && kept.wool === 1 && kept.truffle === 1 && kept.eggs === 2, JSON.stringify(kept));
} catch (e) {
  check('harness', false, String(e?.stack || e));
} finally {
  for (const e of errors.slice(0, 12)) console.log(`  ${e}`);
  check('no page errors', !errors.some((e) => e.includes('pageerror')), `${errors.length} console errors`);
  writeFileSync(resolve(outDir, 'results.json'), JSON.stringify({ results, failed, errors }, null, 2));
  const bounded = (p) => Promise.race([Promise.resolve(p).catch(() => {}), sleep(8000)]);
  await bounded(browser.close());
  await bounded(vite.close());
  relayProc.kill();
  try {
    rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.log(`[acoop] ${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
