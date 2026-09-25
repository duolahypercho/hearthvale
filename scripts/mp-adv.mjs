#!/usr/bin/env node
/**
 * Adversarial 4-player co-op test: host + 3 farmhands, one of them (Cole) behind a delay proxy
 * (≈ 150 ms RTT: 75 ms each way + jitter, order preserved like TCP). Covers what a real session with
 * one far-away friend does to the netcode:
 *   - everyone sees everyone (4 farmers, 3 cabins),
 *   - remote playback per frame (dt-normalised): a farmhand walking + running as seen by the host,
 *     another farmhand and the lagged farmhand, and the lagged farmhand as seen by the others —
 *     no backward steps, no pops (fastest frame ≤ 2× the mover's own speed),
 *   - the lagged farmer's own movement: no host corrections, ends where the others see him,
 *   - a 4-way harvest race on one ripe plant: exactly one farmer gets it, the plant is gone everywhere,
 *   - the lagged farmhand's socket drops mid-walk and comes back (same slot) → farm converges,
 *   - a farmhand's tab crashes and a new tab rejoins the same slot with the same backpack,
 *   - bedtime: the day waits for the lagged farmer, then rolls for all 4; the day-end card has the
 *     "Farm today" row, no name tags float over it, and the morning farm / calendar / purse agree,
 *   - farm sync traffic: steady-state drift ≈ 0 and few host edits that weren't replays.
 * Screenshots of each client's view → shots/mp-adv/. Exits non-zero on a failed check.
 *
 *   node scripts/mp-adv.mjs [--delay 75] [--jitter 25]      (MP_TIMEOUT_MIN raises the wall-clock guard)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/mp-adv');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? Number(argv[argv.indexOf(`--${k}`) + 1]) : d);
const DELAY = opt('delay', 75);
const JITTER = opt('jitter', 25);

setTimeout(() => {
  console.error('[adv] failed: global timeout');
  process.exit(3);
}, (Number(process.env.MP_TIMEOUT_MIN) || 30) * 60_000).unref();

const t0 = Date.now();
const log = (...a) => console.log(`[adv +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failed = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── relay (own process) ───────────────────────────────────────────────
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

// ── delay proxy for the lagged farmhand: every chunk waits DELAY ± JITTER ms, in order ──
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const proxy = net.createServer((client) => {
  const up = net.connect(relayPort, '127.0.0.1');
  const pipe = (from, to) => {
    let last = 0;
    from.on('data', (chunk) => {
      const at = Math.max(last, Date.now() + DELAY + (rnd() * 2 - 1) * JITTER);
      last = at;
      setTimeout(() => {
        if (!to.destroyed) to.write(chunk);
      }, at - Date.now());
    });
    from.on('close', () => setTimeout(() => to.destroy(), DELAY + JITTER));
    from.on('error', () => {});
  };
  pipe(client, up);
  pipe(up, client);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyPort = proxy.address().port;
const wsDirect = `ws://127.0.0.1:${relayPort}/ws`;
const wsLagged = `ws://127.0.0.1:${proxyPort}/ws`;

const cacheDir = resolve(tmpdir(), `hearthvale-adv-${process.pid}`);
const vite = await createServer({ root, logLevel: 'error', cacheDir, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await vite.listen();
const port = vite.httpServer.address().port;
log(`relay :${relayPort} · lag proxy :${proxyPort} (${DELAY}±${JITTER} ms each way) · vite :${port}`);

const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const browser = await chromium.launch({ headless: true, args: GPU });
const errors = [];
async function openClient(label, query, ws, ctx) {
  ctx ??= await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?${query}&server=${encodeURIComponent(ws)}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 300000 });
  await page.evaluate(() => window.__game.ready());
  log(`${label} ready`);
  return page;
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const snap = async (page, file) => {
  try {
    await page.screenshot({ path: resolve(outDir, file), timeout: 60000 });
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
const digest = (p) => ev(p, () => [...window.__game.game.services.net.sync.digest()].sort((x, y) => x[0] - y[0]).map((e) => e.join('=')).join(';'));
const diff = (x, y) => {
  const A = new Set(x.split(';'));
  const B = new Set(y.split(';'));
  return [...A].filter((v) => !B.has(v)).length + [...B].filter((v) => !A.has(v)).length;
};

/** Start sampling remote farmer `id`'s rendered position every frame on `page`. */
const watch = (page, id) =>
  ev(page, (rid) => {
    const r = window.__game.game.services.net.remotes.get(rid);
    window.__advS = [];
    if (!r) return false;
    // Stamped with the animation-frame time (the vsync the frame is presented on), not the moment
    // this callback happens to run in a busy frame.
    const tick = (ts) => {
      window.__advS.push([ts ?? Number(document.timeline.currentTime), r.farmer.position.x, r.farmer.position.z]);
      window.__advRaf = requestAnimationFrame(tick);
    };
    tick();
    return true;
  }, id);
/** Stop sampling; per-frame backward steps (against the overall travel direction) and fastest frame. */
const unwatch = (page) =>
  ev(page, () => {
    cancelAnimationFrame(window.__advRaf);
    const s = window.__advS ?? [];
    if (s.length < 3) return { frames: s.length, back: 0, maxV: 0, dist: 0, maxJump: 0 };
    const dx = s[s.length - 1][1] - s[0][1];
    const dz = s[s.length - 1][2] - s[0][2];
    const L = Math.hypot(dx, dz) || 1;
    const ux = dx / L;
    const uz = dz / L;
    let back = 0;
    let maxV = 0;
    let maxJump = 0;
    let moving = 0;
    for (let i = 1; i < s.length; i++) {
      const dt = Math.max(4, s[i][0] - s[i - 1][0]) / 1000;
      const ex = s[i][1] - s[i - 1][1];
      const ez = s[i][2] - s[i - 1][2];
      const step = Math.hypot(ex, ez);
      if (step > 1e-4) moving++;
      if (ex * ux + ez * uz < -0.01) back++;
      maxV = Math.max(maxV, step / dt);
      maxJump = Math.max(maxJump, step);
    }
    return { frames: s.length, moving, back, maxV: +maxV.toFixed(2), dist: +L.toFixed(2), maxJump: +maxJump.toFixed(3) };
  });

let host, ash, bea, cole;
const ids = {};
try {
  host = await openClient('host', 'notitle=1&map=farm&x=30.5&z=22.5&time=9&name=Hazel', wsDirect);
  const code = await ev(host, () => window.__game.game.services.net.host());
  check('host opened a lobby', /^[A-Z0-9]{6}$/.test(code), code);
  [ash, bea, cole] = await Promise.all([
    openClient('ash', 'name=Ash&preset=0', wsDirect),
    openClient('bea', 'name=Bea&preset=1', wsDirect),
    openClient('cole', 'name=Cole&preset=2', wsLagged),
  ]);
  const all = () => [host, ash, bea, cole];
  const names = ['host', 'ash', 'bea', 'cole'];
  await Promise.all([ash, bea, cole].map((p) => ev(p, (c) => window.__game.game.services.net.join(c), code)));
  const four = await Promise.all(all().map((p) => waitFor(p, () => window.__game.game.services.net.players().length === 4, null, 30000)));
  check('all 4 clients see 4 farmers', four.every(Boolean), four.join(','));
  for (const [i, p] of all().entries()) ids[names[i]] = await ev(p, () => window.__game.game.services.net.myId());
  await sleep(4000);
  const rtt = await ev(cole, () => window.__game.game.services.net.stats().rtt);
  check('lagged farmhand measures ~150+ ms RTT through the proxy', rtt >= 120, `${rtt} ms`);

  // A clear lane for walking (host decides).
  const lane = await ev(host, () => {
    const g = window.__game.game.services.net.sync.grid();
    for (let z = 22; z < 36; z++)
      for (let x = 28; x < 50; x++) {
        let free = true;
        for (let k = 0; k < 9; k++) for (let r = 0; r < 3; r++) free &&= g.isWalkable(x + k, z + r) && !g.getObject(x + k, z + r);
        if (free) return { x, z };
      }
    return null;
  });
  check('found a clear lane', !!lane, JSON.stringify(lane));

  // ── remote playback: Ash walks, then runs, east; host / Bea / Cole watch every frame ──
  const moveTest = async (mover, moverName, watchers, key, ms, run) => {
    await ev(mover, (l) => {
      window.__game.teleport('farm', l.x + 0.5, l.z + 1.5);
      window.__game.facing('right');
    }, lane);
    for (const w of watchers) await ev(w, (l) => window.__game.teleport('farm', l.x + 4, l.z + 4.5), lane);
    await sleep(1500);
    const okW = await Promise.all(watchers.map((w) => watch(w, ids[moverName])));
    if (run) await mover.keyboard.down('ShiftLeft');
    await mover.keyboard.down(key);
    await sleep(ms);
    await mover.keyboard.up(key);
    if (run) await mover.keyboard.up('ShiftLeft');
    await sleep(1200);
    const own = await ev(mover, () => ({ ...window.__game.info().player, corr: window.__game.game.services.net.stats().corrections }));
    const rs = await Promise.all(watchers.map((w) => unwatch(w)));
    const seen = await Promise.all(watchers.map((w) => ev(w, (id) => {
      const r = window.__game.game.services.net.remotes.get(id);
      return r ? { x: r.farmer.position.x, z: r.farmer.position.z } : null;
    }, ids[moverName])));
    const end = seen.map((s) => (s ? Math.hypot(s.x - own.x, s.z - own.z) : 99));
    return { rs, end, own, okW };
  };
  const speedCap = (run) => (run ? 6.4 : 4.2) * 2;
  for (const run of [false, true]) {
    const r = await moveTest(ash, 'ash', [host, bea, cole], 'KeyD', run ? 1100 : 1600, run);
    const wn = ['host', 'bea', 'cole'];
    log(`ash ${run ? 'run' : 'walk'}`, JSON.stringify(r.rs));
    check(`Ash ${run ? 'runs' : 'walks'}: host, Bea and lagged Cole see it with no backward steps / pops (per frame)`, r.rs.every((q) => q.back === 0 && q.maxV <= speedCap(run) && q.dist > 1.5), r.rs.map((q, i) => `${wn[i]} back ${q.back} maxV ${q.maxV} jump ${q.maxJump} m over ${q.dist} m`).join(' · '));
    check(`Ash ${run ? 'run' : 'walk'} ends where everyone sees him`, r.end.every((d) => d < 0.35), r.end.map((d) => d.toFixed(2)).join(' / ') + ' m');
  }
  {
    const c0 = await ev(cole, () => window.__game.game.services.net.stats().corrections);
    const r = await moveTest(cole, 'cole', [host, ash], 'KeyD', 1600, false);
    log('cole walk', JSON.stringify(r.rs));
    check('lagged Cole walks: host + Ash see no backward steps / pops', r.rs.every((q) => q.back === 0 && q.maxV <= speedCap(false) && q.dist > 1.5), r.rs.map((q, i) => `${['host', 'ash'][i]} back ${q.back} maxV ${q.maxV} jump ${q.maxJump}`).join(' · '));
    check('lagged Cole: no host corrections of his own walk, ends where others see him', r.own.corr - c0 === 0 && r.end.every((d) => d < 0.35), `corrections +${r.own.corr - c0}, end ${r.end.map((d) => d.toFixed(2)).join(' / ')} m`);
    // Push into a wall-ish obstacle: the farmhouse wall north of the lane.
    const r2 = await moveTest(cole, 'cole', [host], 'KeyW', 2500, true);
    check('lagged Cole runs into whatever is north: still no corrections popping him back', r2.own.corr - c0 <= 1 && r2.rs[0].back <= 1, `corrections +${r2.own.corr - c0}, host back ${r2.rs[0].back}, maxV ${r2.rs[0].maxV}`);
  }

  // ── 4-way harvest race on one ripe plant ──
  const plant = await ev(host, (l) => {
    const f = window.__game.game.services.farming;
    const g = window.__game.game.services.net.sync.grid();
    // First tile near the lane that takes a crop and has all four sides walkable for the racers.
    const open = (x, z) => g.isWalkable(x, z) && !g.getObject(x, z);
    for (let dz = 0; dz < 8; dz++)
      for (let dx = 0; dx < 12; dx++) {
        const x = l.x + 2 + dx;
        const z = l.z + 1 + dz;
        if (!open(x - 1, z) || !open(x + 1, z) || !open(x, z - 1) || !open(x, z + 1)) continue;
        if (f.plantBlock('parsnip', x, z, 1, 1, true) !== 1) continue;
        window.__game.game.services.net.farmDirty = true; // broadcast the tile with the next delta
        return { x, z, ripe: f.cropAt(x, z)?.ripe ?? false };
      }
    return { x: 0, z: 0, ripe: false };
  }, lane);
  log('race plant', JSON.stringify(plant));
  await sleep(2500);
  const spots = [[0, 1, 'up'], [-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down']];
  const before = await Promise.all(all().map((p) => ev(p, () => window.__game.game.services.inventory.count('parsnip'))));
  await Promise.all(all().map((p, i) => ev(p, ([t, s]) => {
    window.__game.teleport('farm', t.x + 0.5 + s[0], t.z + 0.5 + s[1]);
    window.__game.facing(s[2]);
  }, [plant, spots[i]])));
  await sleep(1500);
  await Promise.all(all().map((p) => p.keyboard.press('KeyX')));
  await sleep(4000);
  const after = await Promise.all(all().map((p) => ev(p, () => window.__game.game.services.inventory.count('parsnip'))));
  const gains = after.map((a, i) => a - before[i]);
  const tile = await Promise.all(all().map((p) => ev(p, (t) => window.__game.game.services.farming.cropAt(t.x, t.z)?.id ?? '', plant)));
  check('4-way harvest race: exactly one farmer gets the parsnip, gone on all 4', plant.ripe && gains.filter((g) => g > 0).length === 1 && tile.every((t) => t === ''), `gains ${gains.join('/')}, tile ${tile.map((t) => t || '∅').join('/')}`);

  // ── the lagged farmhand drops mid-walk and comes back ──
  await ev(cole, (l) => {
    window.__game.teleport('farm', l.x + 0.5, l.z + 2.5);
    window.__game.facing('right');
  }, lane);
  await sleep(800);
  await cole.keyboard.down('KeyD');
  await sleep(500);
  await ev(cole, () => window.__game.game.services.net.simulateDrop());
  await sleep(500);
  await cole.keyboard.up('KeyD');
  const back = await waitFor(cole, () => window.__game.game.services.net.status() === 'playing', null, 20000);
  const idC = await ev(cole, () => window.__game.game.services.net.myId());
  await sleep(3500);
  const posC = await ev(cole, () => window.__game.info().player);
  const seenC = await ev(host, (id) => {
    const r = window.__game.game.services.net.remotes.get(id);
    return r && !r.away ? { x: r.farmer.position.x, z: r.farmer.position.z } : null;
  }, idC);
  check('lagged farmhand drops mid-walk → back in the same slot, host sees him where he is', back && idC === ids.cole && !!seenC && Math.hypot(seenC.x - posC.x, seenC.z - posC.z) < 0.4, `id ${idC} (was ${ids.cole}), ${seenC ? Math.hypot(seenC.x - posC.x, seenC.z - posC.z).toFixed(2) + ' m' : 'not seen'}`);

  // ── Bea's tab crashes; a new tab (same browser profile) rejoins her slot with her backpack ──
  const beaSeeds = await ev(bea, () => window.__game.game.services.inventory.count('cauliflowerSeeds'));
  const bCtx = bea.context();
  await bea.close();
  const awayT = Date.now();
  const away = await waitFor(host, () => window.__game.game.services.net.players().some((p) => p.name === 'Bea' && p.away), null, 12000);
  const awayS = ((Date.now() - awayT) / 1000).toFixed(1);
  bea = await openClient('bea2', 'name=Bea&preset=1', wsDirect, bCtx);
  const reB = await ev(bea, (c) => window.__game.game.services.net.join(c).then(() => 'joined', (e) => `refused: ${e.message}`), code);
  await sleep(2500);
  const idB = await ev(bea, () => window.__game.game.services.net.myId());
  const beaSeeds2 = await ev(bea, () => window.__game.game.services.inventory.count('cauliflowerSeeds'));
  check('crashed tab: host marks Bea away, new tab rejoins the same slot + backpack', away && reB === 'joined' && idB === ids.bea && beaSeeds2 === beaSeeds, `away after ${awayS} s, ${reB}, id ${idB} (was ${ids.bea}), seeds ${beaSeeds} → ${beaSeeds2}`);

  await sleep(3000);
  let dg = await Promise.all(all().map(digest));
  check('whole farm converges on all 4 after drop + crash', dg.slice(1).every((d) => diff(dg[0], d) === 0), dg.slice(1).map((d) => diff(dg[0], d)).join(' / '));

  // ── everyone gathers for a photo: chat + emotes ──
  await Promise.all(all().map((p, i) => ev(p, ([l, k]) => {
    window.__game.teleport('farm', l.x + 1.5 + k * 1.3, l.z + 1.5 + (k % 2) * 0.8);
    window.__game.facing('down');
  }, [lane, i])));
  await ev(ash, () => window.__game.game.services.net.emote('happy'));
  await ev(cole, () => window.__game.game.services.net.chat('Sorry, my internet is slow today!'));
  await ev(bea, () => window.__game.game.services.net.emote('heart'));
  await sleep(1800);
  for (const [i, p] of all().entries()) await snap(p, `adv-${names[i]}-4players.png`);

  // ── bedtime: day waits for the lagged farmer, then rolls for all ──
  const day0 = await ev(host, () => window.__game.info().calendar.day);
  await ev(host, () => window.__game.setTime(22));
  await sleep(1500);
  await ev(ash, () => window.__game.game.services.net.goToBed('cabin'));
  await ev(bea, () => window.__game.game.services.net.goToBed('cabin'));
  await ev(host, () => window.__game.game.services.net.goToBed('house'));
  await sleep(2000);
  const waiting = await ev(host, () => window.__game.info().calendar.day);
  const nudge = await ev(cole, () => {
    const n = document.querySelector('.coop-nudge.on');
    return n ? n.textContent : '';
  });
  check('day waits for the lagged farmer; he gets the "farmers in bed" nudge', waiting === day0 && /in bed/.test(nudge), `day ${waiting} · nudge "${nudge.slice(0, 70)}"`);
  await snap(cole, 'adv-cole-nudge.png');
  const tBed = Date.now();
  await ev(cole, () => window.__game.game.services.net.goToBed('cabin'));
  const rolled = await Promise.all(all().map((p) => waitFor(p, (d) => window.__game.info().calendar.day === d + 1, day0, 40000)));
  check('day rolls for all 4 once the lagged farmer sleeps', rolled.every(Boolean), `${((Date.now() - tBed) / 1000).toFixed(1)} s`);
  await sleep(3500);
  const cards = await Promise.all(all().map((p) => ev(p, () => {
    const panel = window.__game.game.hud.openPanelName;
    const rows = document.querySelectorAll('.hv-dayend .coop-today .ct-f').length;
    const tags = [...document.querySelectorAll('.coop-tag.on')].filter((e) => {
      const cs = getComputedStyle(e);
      return cs.visibility !== 'hidden' && +cs.opacity > 0.3 && e.closest('.coop-tags')?.offsetParent !== null;
    }).length;
    return { panel, rows, tags };
  })));
  check('day-end card on all 4: "Farm today" lists 4 farmers, no name tags over it', cards.every((c) => c.rows === 4 && c.tags === 0), cards.map((c, i) => `${names[i]} ${c.panel}: ${c.rows} rows, ${c.tags} tags`).join(' · '));
  for (const [i, p] of all().entries()) await snap(p, `adv-${names[i]}-dayend.png`);
  await Promise.all(all().map((p) => ev(p, () => window.__game.openUI('none'))));
  await sleep(3000);
  dg = await Promise.all(all().map(digest));
  const cal = await Promise.all(all().map((p) => ev(p, () => window.__game.info().calendar)));
  const gold = await Promise.all(all().map((p) => ev(p, () => window.__game.game.services.economy.gold())));
  check('morning: farm, calendar and purse agree on all 4', dg.slice(1).every((d) => diff(dg[0], d) === 0) && cal.every((c) => c.day === cal[0].day) && gold.every((g) => g === gold[0]), `farm diff ${dg.slice(1).map((d) => diff(dg[0], d)).join('/')} · day ${cal.map((c) => c.day).join('/')} · gold ${gold.join('/')}`);

  // ── sync traffic + frame time ──
  const st = await Promise.all([ash, bea, cole].map((p) => ev(p, () => window.__game.game.services.net.stats())));
  log('sync', st.map((s, i) => `${['ash', 'bea', 'cole'][i]}: ${s.reconciles} host edits, ${s.drift} drift, ${s.needs} resyncs, ${s.fullSyncs} full (${s.driftLog.join(' ')})`).join(' | '));
  check('farm sync: drift ≈ 0, ≤ 1 mid-day resync per farmhand', st.every((s) => s.drift <= 2 && s.needs <= 1), st.map((s, i) => `${['ash', 'bea', 'cole'][i]} drift ${s.drift} resyncs ${s.needs} edits ${s.reconciles}`).join(' · '));
  const fm = await Promise.all(all().map((p) => ev(p, () => window.__game.game.services.net.stats().frameMs)));
  log('frame ms avg/p95/p99', fm.map((f, i) => `${names[i]} ${f.avg}/${f.p95}/${f.p99}`).join('  '));
  writeFileSync(resolve(outDir, 'adv-results.json'), JSON.stringify({ at: new Date().toISOString(), delay: DELAY, jitter: JITTER, results, frameMs: fm, sync: st, errors }, null, 2));
} catch (err) {
  console.error('[adv] failed:', err?.stack || err);
  failed++;
} finally {
  const pageErrs = errors.filter((e) => e.includes('pageerror'));
  for (const e of errors) console.error(`  ${e}`);
  check('no page errors on any client', pageErrs.length === 0, `${pageErrs.length} page errors, ${errors.length - pageErrs.length} console errors`);
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
  relayProc.kill();
  proxy.close();
  try {
    rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.log(`\n${failed ? '✗' : '✓'} mp-adv: ${results.filter((r) => r.ok).length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(failed ? 1 : 0);
}
