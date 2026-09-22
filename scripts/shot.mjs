#!/usr/bin/env node
/**
 * Headless screenshot harness.
 *
 *   node scripts/shot.mjs --url "?demo=farm-morning" --out shots/farm-morning.png [--w 1920 --h 1080] [--wait 1500]
 *   node scripts/shot.mjs --url "?demo=farm-evening" --out shots/evening.png --frames 6 --every 250
 *
 * - Starts its own Vite dev server on a free port (safe to run many in parallel).
 * - Headless Chromium via Playwright with GPU flags (ANGLE/Metal), falls back to SwiftShader
 *   if WebGL2 is unavailable.
 * - Awaits window.__game.ready(), waits --wait ms, writes PNG(s).
 * - Prints console errors; exits non-zero on page errors or failures.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { url: '', out: 'shots/shot.png', w: 1920, h: 1080, wait: 1500, frames: 1, every: 250, timeout: 90000, dpr: 1, gpu: 'auto' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = ['w', 'h', 'wait', 'frames', 'every', 'timeout', 'dpr'].includes(key) ? Number(val) : val;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-gpu-rasterization', '--disable-gpu-sandbox'];
const SWIFT_ARGS = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

async function launch(mode) {
  const opts = { headless: true, args: mode === 'gpu' ? GPU_ARGS : SWIFT_ARGS };
  try {
    return await chromium.launch({ ...opts, channel: 'chromium' });
  } catch {
    return await chromium.launch(opts);
  }
}

async function webglInfo(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl2';
  });
}

async function main() {
  const cacheDir = resolve(tmpdir(), `hearthvale-vite-${process.pid}`);
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir,
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5173;
  let q = args.url || '';
  if (q && !q.startsWith('?') && !q.startsWith('/')) q = '?' + q;
  const url = `http://127.0.0.1:${port}/${q.startsWith('/') ? q.slice(1) : q}`;

  const pageErrors = [];
  const consoleErrors = [];
  let browser = null;
  let exitCode = 0;
  try {
    const modes = args.gpu === 'swiftshader' ? ['swiftshader'] : args.gpu === 'gpu' ? ['gpu'] : ['gpu', 'swiftshader'];
    let page = null;
    for (const mode of modes) {
      browser = await launch(mode);
      const ctx = await browser.newContext({ viewport: { width: args.w, height: args.h }, deviceScaleFactor: args.dpr });
      page = await ctx.newPage();
      await page.goto('about:blank');
      const info = await webglInfo(page);
      if (info) {
        console.log(`[shot] ${mode}: ${info}`);
        break;
      }
      console.warn(`[shot] WebGL2 unavailable in ${mode} mode`);
      await browser.close();
      browser = null;
      page = null;
    }
    if (!page) throw new Error('No WebGL2 context available');

    page.on('pageerror', (err) => pageErrors.push(String(err?.stack || err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      else if (process.env.SHOT_VERBOSE && ['warning', 'log'].includes(msg.type())) console.log(`[page:${msg.type()}] ${msg.text()}`);
    });

    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: args.timeout });
    await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: args.timeout });
    await page.evaluate(() => window.__game.ready());
    console.log(`[shot] ready in ${Date.now() - t0} ms  (${url})`);
    await page.evaluate(() => document.fonts?.ready);
    if (args.eval) {
      // --eval "<js>" runs in the page after ready (may be async / return a value), e.g.
      // --eval "__game.setTime(20); __game.teleport('farm', 20, 40)"
      const res = await page.evaluate(`(async () => { ${args.eval} })()`);
      if (res !== undefined) console.log(`[shot] eval => ${JSON.stringify(res)}`);
    }
    if (args.hold) {
      // --hold "KeyD:800,KeyS:400" holds keys (ms) sequentially — quick movement tests.
      for (const part of String(args.hold).split(',')) {
        const [key, ms] = part.split(':');
        await page.keyboard.down(key);
        await page.waitForTimeout(Number(ms) || 300);
        await page.keyboard.up(key);
      }
    }
    await page.waitForTimeout(args.wait);

    const outBase = resolve(root, args.out);
    mkdirSync(dirname(outBase), { recursive: true });
    const n = Math.max(1, args.frames);
    const ext = extname(outBase) || '.png';
    const stem = outBase.slice(0, outBase.length - ext.length);
    for (let i = 0; i < n; i++) {
      const path = n === 1 ? outBase : `${stem}_${String(i).padStart(3, '0')}${ext}`;
      await page.screenshot({ path, type: 'png' });
      console.log(`[shot] wrote ${path}`);
      if (i < n - 1) await page.waitForTimeout(args.every);
    }
    const info = await page.evaluate(() => window.__game.info());
    console.log(`[shot] info ${JSON.stringify(info)}`);
    const perf = info?.perf;
    if (perf && !perf.ok) {
      console.warn(
        `[shot] WARNING render budget exceeded: ${perf.drawCalls} draw calls (budget ${perf.budget.drawCalls}), ` +
          `${(perf.triangles / 1e6).toFixed(2)}M triangles (budget ${(perf.budget.triangles / 1e6).toFixed(2)}M)`,
      );
    }
  } catch (err) {
    console.error('[shot] failed:', err?.message || err);
    exitCode = 2;
  } finally {
    for (const e of consoleErrors) console.error(`[console.error] ${e}`);
    for (const e of pageErrors) console.error(`[pageerror] ${e}`);
    if (pageErrors.length) exitCode = exitCode || 1;
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  process.exit(exitCode);
}

main();
