#!/usr/bin/env node
/**
 * Walk the farmer toward the Kintara keeper and shoot frames, logging the keeper's yaw / gesture each time.
 *   node scripts/kintara-walk.mjs --out shots/kwalk --frames 12 --every 250 [--time 17.6] [--from 26,45] [--to 26,35.5]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { out: 'shots/kwalk', frames: 12, every: 250, time: '17.6', from: '26,46', to: '26,35.5', w: 1280, h: 720, cam: '' };
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].slice(2)] = process.argv[i + 1];
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', cacheDir: resolve(tmpdir(), `hv-kw-${process.pid}`), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +a.w, height: +a.h } })).newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e));
await page.goto(`http://127.0.0.1:${port}/?demo=kintara&time=${a.time}`);
await page.waitForFunction(() => typeof window.__game?.ready === 'function');
await page.evaluate(() => window.__game.ready());
const [fx, fz] = a.from.split(',').map(Number);
const [tx, tz] = a.to.split(',').map(Number);
await page.evaluate(([x, z, cam]) => {
  const g = window.__game;
  g.game.player.position.x = x;
  g.game.player.position.z = z;
  if (cam) g.camera(JSON.parse(cam));
}, [fx, fz, a.cam]);
await page.waitForTimeout(800);
mkdirSync(dirname(resolve(root, a.out)), { recursive: true });
const n = +a.frames;
for (let i = 0; i < n; i++) {
  const u = n > 1 ? i / (n - 1) : 1;
  await page.evaluate(([x, z, cam]) => {
    const g = window.__game.game;
    const p = g.player.position;
    p.x = x;
    p.z = z;
    // a keeper-centred camera: the look target rides on the keeper whatever the farmer does
    const k = g.services.kintara.keeper;
    const rig = g.rc.rig;
    const c = JSON.parse(cam);
    rig.yaw = c.yaw; rig.pitch = c.pitch; rig.distance = c.distance;
    rig.lookOffset.set(k.position.x - p.x + (c.ox ?? 0), c.oy ?? 1.2, k.position.z - p.z + (c.oz ?? 0));
    rig.snap();
  }, [fx + (tx - fx) * u, fz + (tz - fz) * u, a.cam || '{"yaw":0,"pitch":18,"distance":6}']);
  await page.waitForTimeout(+a.every);
  const st = await page.evaluate(() => {
    const k = window.__game.game.services.kintara.keeper;
    const p = window.__game.game.player.position;
    return { d: +Math.hypot(p.x - k.position.x, p.z - k.position.z).toFixed(2), yaw: +k.yaw.toFixed(2), target: +k.targetYaw.toFixed(2), gest: k.gest, gestT: +(k.gestT ?? 0).toFixed(2), talk: !!k.talkTo };
  });
  const path = resolve(root, `${a.out}_${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path });
  console.log(i, JSON.stringify(st), path);
}
await browser.close();
await server.close();
process.exit(0);
