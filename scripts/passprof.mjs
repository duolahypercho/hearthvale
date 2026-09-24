#!/usr/bin/env node
/**
 * Per-pass GPU timing (pillar 14 diagnostics): shadow maps, main scene, and each composer pass,
 * measured with EXT_disjoint_timer_query_webgl2 on the same page/frames so the split is
 * comparable even when the machine is contended (absolute ms are inflated by other GPU users).
 *   node scripts/passprof.mjs --demos farm-morning,beach-day [--w 2560 --h 1440] [--ms 4000] [--eval "<js>"]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, loadavg } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { demos: 'farm-morning', w: 2560, h: 1440, ms: 4000, warmup: 2500, eval: '', quality: 'high' };
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) a[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : 'true';

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', clearScreen: false, cacheDir: resolve(tmpdir(), 'hv-passprof-vite'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/node_modules/**', '**/.git/**'] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-privileged-webgl-extensions'] });
const ctx = await browser.newContext({ viewport: { width: +a.w, height: +a.h }, deviceScaleFactor: 1 });
for (const demo of a.demos.split(',')) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', demo, String(e).slice(0, 200)));
  await page.goto(`${base}?demo=${demo}&quality=${a.quality}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__game.ready());
  if (a.eval) await page.evaluate(a.eval);
  await page.waitForTimeout(+a.warmup);
  const res = await page.evaluate(async (ms) => {
    const g = window.__game.game;
    const rc = g.rc;
    const r = rc.renderer;
    const gl = r.getContext();
    // gl.finish() brackets: each segment's wall time ≈ its CPU submit + GPU execution (serialised).
    const acc = {};
    let open = null;
    const begin = (name) => { if (open) end(); gl.finish(); open = { t: performance.now(), name }; };
    const end = () => { if (!open) return; gl.finish(); (acc[open.name] ??= []).push(performance.now() - open.t); open = null; };
    const poll = () => {};
    const undo = [];
    const sm = r.shadowMap;
    const smr = sm.render;
    sm.render = function (...x) { const prev = open?.name; begin('shadow'); const o = smr.apply(this, x); begin(prev ? prev : 'scene'); return o; };
    undo.push(() => { sm.render = smr; });
    const passes = rc.post.composer.passes;
    passes.forEach((p, i) => {
      const orig = p.render;
      const name = `${i}:${p.constructor.name}`;
      p.render = function (...x) { begin(name); const o = orig.apply(this, x); end(); return o; };
      undo.push(() => { p.render = orig; });
    });
    const origStep = g.step;
    let frames = 0;
    const wall = [];
    g.step = function (dt) { begin('other'); origStep.call(this, dt); end(); poll(); frames++; };
    await new Promise((done) => { let t0 = 0, last = 0; const f = (now) => { if (!t0) t0 = now; else wall.push(now - last); last = now; if (now - t0 > ms) done(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    delete g.step;
    for (const u of undo) u();
    const med = (v) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const out = {};
    let total = 0;
    for (const [k, v] of Object.entries(acc)) { out[k] = Math.round(med(v) * 100) / 100; if (k !== 'other') total += out[k]; }
    const p = g.perf();
    return { frames, fps: Math.round(1000 / (wall.reduce((s, x) => s + x, 0) / wall.length) * 10) / 10, gpuTotal: Math.round(total * 100) / 100, passes: out, draws: p.drawCalls, tris: p.triangles };
  }, +a.ms);
  console.log(JSON.stringify({ demo, load: loadavg()[0].toFixed(0), ...res }));
  await page.close();
}
await browser.close();
await server.close();
