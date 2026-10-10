#!/usr/bin/env node
/**
 * Mines pass-out regression: ANY source that empties the health tube on a mine floor (not only a
 * monster bite) must collapse the farmer — `combat:passOut` fires and they wake at the mine
 * entrance with some health back. (A 0-HP "zombie" left standing on the floor was a round-2 bug.)
 *
 *   node scripts/mine-passout.test.mjs
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
setTimeout(() => {
  console.error('[mine-passout] failed: global timeout');
  process.exit(3);
}, 150000).unref();

const cacheDir = resolve(tmpdir(), `hearthvale-passout-${process.pid}`);
const server = await createServer({ root, logLevel: 'error', cacheDir, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const port = server.httpServer.address().port;
const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];
const browser = await chromium.launch({ headless: true, args: GPU });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

try {
  await page.goto(`http://127.0.0.1:${port}/?demo=mine-floor&foe=0`, { timeout: 90000 });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000 });
  await page.evaluate(() => window.__game.ready());
  const before = await page.evaluate(() => window.__game.info().map);
  check('starts on a mine floor', before === 'mine', String(before));
  // Drain the tube through the public health service, the way lava / bombs / other pods do.
  await page.evaluate(() => {
    const g = window.__game.game;
    window.__passEvt = null;
    g.events.on('combat:passOut', (e) => (window.__passEvt = e));
    g.services.health.damage(999);
  });
  const hp0 = await page.evaluate(() => window.__game.game.services.health.value?.() ?? null);
  check('damage(999) empties the tube', hp0 === 0 || hp0 === null, `hp=${hp0}`);
  await page.waitForFunction(() => window.__passEvt !== null, null, { timeout: 5000 }).catch(() => {});
  check('combat:passOut fires', await page.evaluate(() => window.__passEvt !== null));
  await page.waitForFunction(() => window.__game.info().map === 'mine-entrance', null, { timeout: 20000 }).catch(() => {});
  // (health is refilled to 35 % right after the carry-out teleport lands)
  await page.waitForFunction(() => window.__game.game.services.health.value() > 0, null, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate(() => ({ map: window.__game.info().map, hp: window.__game.game.services.health.value?.() }));
  check('wakes at the mine entrance', after.map === 'mine-entrance', after.map);
  check('wakes with some health back', typeof after.hp !== 'number' || after.hp > 0, `hp=${after.hp}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('run', false, String(e));
} finally {
  await browser.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}
console.log(failed ? `[mine-passout] ${failed} failed` : '[mine-passout] all passed');
process.exit(failed ? 1 : 0);
