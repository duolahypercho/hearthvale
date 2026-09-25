#!/usr/bin/env node
/**
 * One-off in-page probe (pillar 14 diagnostics): load a demo, await ready, wait, then evaluate a JS
 * file (an async function body; `g` = __game.game) and print its JSON result.
 *   node scripts/probe.mjs --demo farm-morning --js /path/probe.js [--wait 2000 --w 1920 --h 1080]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { demo: 'farm-morning', js: '', wait: 2000, w: 1920, h: 1080, extra: '' };
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) a[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : 'true';
const body = readFileSync(a.js, 'utf8');
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', clearScreen: false, cacheDir: resolve(tmpdir(), `hv-probe-vite-${process.pid}`), server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/node_modules/**', '**/.git/**', '**/.workflows/**'] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const ctx = await browser.newContext({ viewport: { width: +a.w, height: +a.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto(`${base}?demo=${a.demo}&quality=high${a.extra}`, { waitUntil: 'domcontentloaded', timeout: 200000 });
  page.setDefaultTimeout(200000);
  await page.evaluate(() => window.__game.ready());
  await page.waitForTimeout(+a.wait);
  const res = await page.evaluate(`(async () => { const g = window.__game.game; ${body} })()`);
  console.log(JSON.stringify(res, null, 1));
} finally {
  await browser.close();
  await server.close();
}
