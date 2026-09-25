#!/usr/bin/env node
/**
 * Co-op festival end-to-end test: relay + Vite + headless Chromium pages (host + farmhand, then a
 * late joiner).
 *
 *   node scripts/fest-coop-test.mjs [--gpu swiftshader]
 *
 * Checks the festival co-op wiring (world/festivals/coop.ts + systems/festivals.ts): both farmers
 * on the Harvest Fair grounds, the host walks up to the sack race start line (lobby), the farmhand
 * joins it, both race each other in their own lanes with live progress relayed at 10 Hz (each HUD
 * shows the other farmer's token moving), both result cards rank both farmers, both boards end with
 * two rows (via the host), and a farmhand joining afterwards receives today's board in the join
 * handshake. Screenshots each view into shots/festivals/coop-*.png. Exits non-zero on any failed check.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/festivals');
mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const gpuMode = argv.includes('--gpu') ? argv[argv.indexOf('--gpu') + 1] : 'auto';

setTimeout(() => {
  console.error('[fest-coop] failed: global timeout');
  process.exit(3);
}, 12 * 60_000).unref();

const t0 = Date.now();
const log = (...a) => console.log(`[fest-coop +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const relay = await startServer({ port: 0, log: false, serveDist: false });
const wsUrl = `ws://127.0.0.1:${relay.port}/ws`;
const vite = await createServer({ root, logLevel: 'error', cacheDir: resolve(tmpdir(), `hearthvale-festcoop-${process.pid}`), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
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
const toFair = (page, x) => ev(page, (xx) => window.__game.teleport('fest-fall', xx, 27.2), x);

let host, hand, late;
try {
  host = await open('host', 'notitle=1&map=farm&x=30.5&z=22.5&time=14&season=fall&name=Hazel');
  const code = await ev(host, () => window.__game.game.services.net.host());
  check('host opened a lobby', /^[A-Z0-9]{6}$/.test(code), code);
  hand = await open('hand', 'name=Ash&preset=1');
  await ev(hand, (c) => window.__game.game.services.net.join(c), code);
  check('farmhand joined', await waitFor(hand, () => window.__game.game.services.net.players().length === 2, null, 30000));
  await sleep(1500);
  await Promise.all([toFair(host, 14.6), toFair(hand, 15.8)]);
  const bothThere = await waitFor(host, () => window.__game.game.services.net.players().some((p) => !p.isMe && p.map === 'fest-fall'), null, 20000);
  check('both farmers on the Harvest Fair grounds', bothThere);
  await waitFor(hand, () => window.__game.game.services.net.players().some((p) => !p.isMe && p.map === 'fest-fall'), null, 20000);

  // ── the host reaches the start line (lobby), the farmhand joins it ─────────
  await ev(host, () => void window.__game.game.services.festivals.play('sackrace'));
  const lobbyUp = await waitFor(host, () => !!document.querySelector('.fg-lobby'), null, 15000);
  check('host sees the start-line lobby', lobbyUp);
  const invited = await waitFor(hand, () => window.__game.game.services.festivals.coopStats().invites > 0, null, 15000);
  check('farmhand hears about the open start line', invited);
  await sleep(400);
  await ev(hand, () => void window.__game.game.services.festivals.play('sackrace'));
  const raceHost = await waitFor(host, () => !!document.querySelector('.fg-race') && !document.querySelector('.fg-lobby'), null, 20000);
  const raceHand = await waitFor(hand, () => !!document.querySelector('.fg-race') && !document.querySelector('.fg-lobby'), null, 20000);
  check('lobby closes once everyone is at the line: both race', raceHost && raceHand);
  const farmerTok = (page) => ev(page, () => [...document.querySelectorAll('.fg-token.farmer')].map((t) => t.textContent));
  const [ht, at] = await Promise.all([farmerTok(host), farmerTok(hand)]);
  if (!(ht.length === 1 && at.length === 1)) log('coop traces', JSON.stringify(await Promise.all([host, hand].map((p) => ev(p, () => window.__game.game.services.festivals.coopStats().trace)))));
  check('each HUD has a lane token for the other farmer', ht.length === 1 && at.length === 1, `host sees ${JSON.stringify(ht)} · hand sees ${JSON.stringify(at)}`);
  const lanes = await Promise.all([host, hand].map((p) => ev(p, () => window.__game.game.world.current.play?.lanes?.[0])));
  check('farmers race different lanes (owner 0, joiner 1)', lanes[0] === 0 && lanes[1] === 1, JSON.stringify(lanes));

  // ── race: alternate ◀ ▶ on both machines (in-page timers, so a busy test runner can't slow the
  // hops; the host hops a touch quicker) ───────────────────────────────────────
  const hopper = (page, ms) =>
    ev(page, (m) => {
      let k = 0;
      // In-page sampler (a loaded test runner can't miss the window): the farthest the OTHER
      // farmer's token got while this farmer was still mid-lane.
      window.__tokSeen = 0;
      window.__tokSampler = setInterval(() => {
        const me = parseFloat(document.querySelector('.fg-token.me:not(.farmer)')?.style.left ?? '0');
        const them = parseFloat(document.querySelector('.fg-token.farmer')?.style.left ?? '0');
        if (me > 0 && me < 100) window.__tokSeen = Math.max(window.__tokSeen, them);
      }, 100);
      window.__hops = setInterval(() => {
        const code = k++ % 2 ? 'ArrowRight' : 'ArrowLeft';
        window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      }, m);
    }, ms);
  await Promise.all([hopper(host, 330), hopper(hand, 350)]);
  let tokMid = null;
  const tStart = Date.now();
  while (Date.now() - tStart < 60000) {
    await sleep(500);
    const mine = await Promise.all([host, hand].map((p) => ev(p, () => parseFloat(document.querySelector('.fg-token.me:not(.farmer)')?.style.left ?? '0'))));
    if (!tokMid && mine[0] > 35 && mine[1] > 35) {
      log('mid-race coop stats', JSON.stringify(await Promise.all([host, hand].map((p) => ev(p, () => window.__game.game.services.festivals.coopStats())))));
      tokMid = await Promise.all([host, hand].map((p) => ev(p, () => parseFloat(document.querySelector('.fg-token.farmer')?.style.left ?? '0'))));
      await Promise.all([host.screenshot({ path: resolve(outDir, 'coop-race-host.png'), timeout: 90000 }), hand.screenshot({ path: resolve(outDir, 'coop-race-hand.png'), timeout: 90000 })]);
    }
    const done = await Promise.all([host, hand].map((p) => ev(p, () => !!document.querySelector('.fg-result'))));
    if (done[0] && done[1]) break;
  }
  await Promise.all([host, hand].map((p) => ev(p, () => (clearInterval(window.__hops), clearInterval(window.__tokSampler)))));
  const tokSeen = await Promise.all([host, hand].map((p) => ev(p, () => window.__tokSeen)));
  check('live progress relayed: each sees the other farmer mid-lane', tokSeen[0] > 20 && tokSeen[1] > 20, `other farmer's token reached ${JSON.stringify(tokSeen)} % while racing · mid-sample ${JSON.stringify(tokMid)}`);
  const cards = await Promise.all([host, hand].map((p) => waitFor(p, () => !!document.querySelector('.fg-result'), null, 30000)));
  check('both result cards up', cards[0] && cards[1]);
  const cardRows = await Promise.all([host, hand].map((p) => ev(p, () => [...document.querySelectorAll('.fg-result .fg-board .r')].map((r) => r.textContent))));
  check('both result cards rank both farmers', cardRows[0].length === 2 && cardRows[1].length === 2, JSON.stringify(cardRows));
  await Promise.all([host.screenshot({ path: resolve(outDir, 'coop-result-host.png'), timeout: 90000 }), hand.screenshot({ path: resolve(outDir, 'coop-result-hand.png'), timeout: 90000 })]);
  await Promise.all([host.keyboard.press('Space'), hand.keyboard.press('Space')]);
  await sleep(2500);
  // Dismiss the host NPC's thank-you line if one is up.
  for (let i = 0; i < 3; i++) await Promise.all([host.keyboard.press('Space'), hand.keyboard.press('Space')]).then(() => sleep(400));
  const boards = await Promise.all([host, hand].map((p) => ev(p, () => window.__game.game.services.festivals.board('sackrace').map((r) => `${r.player}:${r.name}:${r.place}`))));
  check('both boards show two rows', boards[0].length === 2 && boards[1].length === 2, JSON.stringify(boards));
  check("each board holds your own row as 'local' + the other farmer", boards.every((b) => b.filter((r) => r.startsWith('local:')).length === 1 && b.some((r) => r.startsWith('p'))));

  // ── a farmhand who joins later gets today's board in the handshake ────────
  late = await open('late', 'name=Briar&preset=2');
  // (Under a heavily loaded machine the first join can time out while the host page is busy: retry.)
  for (let tries = 0; ; tries++) {
    try {
      await ev(late, (c) => window.__game.game.services.net.join(c), code);
      break;
    } catch (e) {
      if (tries >= 2) throw e;
      log(`late join retry (${String(e?.message ?? e).split('\n')[0]})`);
      await sleep(3000);
    }
  }
  const got = await waitFor(late, () => window.__game.game.services.festivals.board('sackrace').length === 2, null, 45000);
  const lateRows = await ev(late, () => window.__game.game.services.festivals.board('sackrace').map((r) => `${r.player}:${r.name}`));
  const cal = await Promise.all([host, late].map((p) => ev(p, () => { const c = window.__game.game.calendar; return `${c.year}:${c.season}:${c.day}`; })));
  check('late joiner receives the festival boards (join snapshot)', got, `${JSON.stringify(lateRows)} cal ${cal.join(' / ')}`);
  const stats = await Promise.all([host, hand].map((p) => ev(p, () => window.__game.game.services.festivals.coopStats())));
  log('coop stats', JSON.stringify(stats));
} catch (e) {
  check('no exceptions', false, String(e?.stack ?? e));
} finally {
  const real = errors.filter((e) => !/WebSocket|favicon|net::ERR|AudioContext/i.test(e));
  check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
  await browser.close();
  await vite.close();
  await relay.close?.();
  console.log(failed ? `[fest-coop] ${failed} check(s) FAILED` : '[fest-coop] all checks passed');
  process.exit(failed ? 1 : 0);
}
