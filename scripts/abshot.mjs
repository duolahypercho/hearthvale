#!/usr/bin/env node
/**
 * Paired A/B screenshots on ONE frozen frame (pillar 14: prove a perf change is invisible).
 * Loads a demo, runs --eval (which defines window.__abConfigs = { name: [apply, revert] }, as for
 * abprof / matbench), freezes the simulation (time, camera, particles: only rc.render runs, at a fixed
 * time), then captures `base` and every config from the same state and reports the pixel difference
 * of each against base (mean abs diff /255, share of pixels off by > 2 and > 8 levels).
 *
 *   node scripts/abshot.mjs --url "?demo=beach-sunset" --eval "$(cat variants.js)" --out shots/ab/beach
 *     → shots/ab/beach-base.png, shots/ab/beach-<config>.png (+ -diff-<config>.png, ×8 amplified)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { url: '?demo=beach-sunset', w: 2560, h: 1440, wait: 2500, eval: '', out: 'shots/ab/shot', quality: 'high' };
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) a[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : 'true';
const outBase = resolve(root, a.out);
mkdirSync(dirname(outBase), { recursive: true });

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', clearScreen: false, cacheDir: resolve(tmpdir(), 'hv-abprof-vite'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/node_modules/**', '**/.git/**'] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: +a.w, height: +a.h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
const sep = a.url.includes('?') ? '&' : '?';
await page.goto(`${base}${a.url}${a.url.includes('quality=') ? '' : `${sep}quality=${a.quality}`}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
page.setDefaultTimeout(240000);
await page.evaluate(() => window.__game.ready());
if (a.eval) console.log('[eval]', await page.evaluate(a.eval));
await page.waitForTimeout(+a.wait);
const names = await page.evaluate(async () => {
  const g = window.__game.game;
  const T = g.time;
  // Freeze: no simulation, a fixed render time (shaders animate on uTime).
  g.step = function () { this.rc.render(0, T); };
  window.__abApply = (n, on) => { const c = (window.__abConfigs || {})[n]; if (c) c[on ? 0 : 1](); };
  const fr = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 6; i++) await fr();
  return Object.keys(window.__abConfigs || {});
});
const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const shots = {};
for (const n of ['base', ...names]) {
  if (n !== 'base') await page.evaluate((k) => window.__abApply(k, true), n);
  await frames(8);
  const file = `${outBase}-${n}.png`;
  shots[n] = await page.screenshot({ path: file });
  if (n !== 'base') await page.evaluate((k) => window.__abApply(k, false), n);
  console.log('[abshot] wrote', file);
}
// Pixel diff in the page (decode both PNGs on a canvas).
for (const n of names) {
  const r = await page.evaluate(async ({ A, B }) => {
    const load = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); return img; };
    const [ia, ib] = await Promise.all([load(A), load(B)]);
    const c = document.createElement('canvas');
    c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(ia, 0, 0);
    const da = x.getImageData(0, 0, c.width, c.height).data;
    x.drawImage(ib, 0, 0);
    const db = x.getImageData(0, 0, c.width, c.height);
    let sum = 0, o2 = 0, o8 = 0;
    const px = da.length / 4;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db.data[i]), Math.abs(da[i + 1] - db.data[i + 1]), Math.abs(da[i + 2] - db.data[i + 2]));
      sum += d;
      if (d > 2) o2++;
      if (d > 8) o8++;
      const v = Math.min(255, d * 8);
      db.data[i] = db.data[i + 1] = db.data[i + 2] = v;
      db.data[i + 3] = 255;
    }
    x.putImageData(db, 0, 0);
    return { mean: sum / px, gt2: o2 / px, gt8: o8 / px, png: c.toDataURL('image/png').split(',')[1] };
  }, { A: shots.base.toString('base64'), B: shots[n].toString('base64') });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${outBase}-diff-${n}.png`, Buffer.from(r.png, 'base64'));
  console.log(`[abshot] ${n} vs base: mean ${r.mean.toFixed(3)} · >2 ${(r.gt2 * 100).toFixed(3)} % · >8 ${(r.gt8 * 100).toFixed(3)} %`);
}
await browser.close();
await server.close();
