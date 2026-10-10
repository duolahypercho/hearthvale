#!/usr/bin/env node
/**
 * Shadow-pass micro-benchmark (perf r22): framebench's method, but each sample renders the scene into a
 * 1x1 target with the shadow maps forced, so the sun's shadow pass (static cache blit + moving casters,
 * via shadowcache.ts) is nearly all that is timed; configs (window.__abConfigs) as for framebench.
 *   node scripts/shadowbench.mjs --demos forest-canopy --eval "$(cat v.js)" [--samples 60 --reps 4]
 *
 * (derived from) Whole-frame micro-benchmark (pillar 14 diagnostics): matbench's min-of-samples method applied to
 * the FULL frame (shadow maps + main + GTAO + bloom + output + SMAA + tilt-shift + grade), so post
 * passes and shadow refreshes can be costed on a contended GPU where wall-clock fps swings 2x.
 * The game is frozen (no step); each sample renders the frame R times back to back, bracketed by a
 * 1-px readback of the canvas; configs alternate sample by sample; reports min / p20 per config.
 * Built-in configs (cost of each stage = its delta): noAO, noBloom, noSMAA, noTilt, noShadow.
 *
 *   node scripts/framebench.mjs --demos mine-lava,lantern-festival-valley [--samples 40 --reps 3]
 *   node scripts/framebench.mjs --demos mine-lava --eval "$(cat variants.js)" --only base,myVariant
 *
 * The eval may define window.__abConfigs = { name: [apply, revert] } (same contract as matbench).
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, loadavg } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { demos: 'mine-lava', w: 2560, h: 1440, samples: 40, reps: 3, warmup: 2500, quality: 'high', eval: '', only: '', params: '' };
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) a[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : 'true';

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', clearScreen: false, cacheDir: resolve(tmpdir(), 'hv-abprof-vite'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/node_modules/**', '**/.git/**'] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const ctx = await browser.newContext({ viewport: { width: +a.w, height: +a.h }, deviceScaleFactor: 1 });
for (const demo of a.demos.split(',')) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', demo, String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
  await page.goto(`${base}?demo=${demo}&quality=${a.quality}${a.params ? '&' + a.params : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  page.setDefaultTimeout(240000);
  await page.evaluate(() => window.__game.ready());
  if (a.eval) await page.evaluate(a.eval);
  await page.waitForTimeout(+a.warmup);
  const res = await page.evaluate(async ({ samples, reps, only }) => {
    const g = window.__game.game;
    const rc = g.rc;
    const renderer = rc.renderer;
    const gl = renderer.getContext();
    const sm = renderer.shadowMap;
    const smRender = sm.render;
    const C = {
      base: [() => {}, () => {}],
      noShadow: [() => (sm.render = () => {}), () => (sm.render = smRender)],
      ...(window.__abConfigs || {}),
    };
    for (const k of Object.keys(C)) if (!C[k] || (only && !only.split(',').includes(k))) delete C[k];
    const origStep = g.step;
    g.step = () => {};
    const origRender = rc.render.bind(rc);
    rc.render = () => {};
    await new Promise((r) => requestAnimationFrame(r));
    // The sun's shadow pass alone: the scene into a 1x1 target (colour fill ~0), shadow maps forced.
    const THREE_RT = renderer.getRenderTarget();
    const rt = new (Object.getPrototypeOf(rc.post.composer.renderTarget1).constructor)(1, 1);
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const draw = () => {
      renderer.setRenderTarget(rt);
      sm.needsUpdate = true;
      renderer.render(rc.scene, rc.camera);
      renderer.setRenderTarget(THREE_RT);
    };
    const names = Object.keys(C);
    for (const n of names) { C[n][0](); draw(); sync(); draw(); sync(); C[n][1](); }
    const acc = Object.fromEntries(names.map((n) => [n, []]));
    for (let s = 0; s < samples; s++) {
      for (const n of s % 2 ? [...names].reverse() : names) {
        C[n][0]();
        draw(); sync();
        const t0 = performance.now();
        for (let k = 0; k < reps; k++) draw();
        sync();
        acc[n].push((performance.now() - t0) / reps);
        C[n][1]();
      }
      if (s % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    rc.render = origRender;
    g.step = origStep;
    rt.dispose();
    const out = {};
    for (const n of names) { const v = [...acc[n]].sort((x, y) => x - y); out[n] = { min: +v[0].toFixed(3), p20: +v[Math.floor(v.length * 0.2)].toFixed(3), med: +v[Math.floor(v.length / 2)].toFixed(3) }; }
    const info = window.__game.info().perf;
    return { out, draws: info?.drawCalls ?? info?.calls, tris: info?.triangles };
  }, { samples: +a.samples, reps: +a.reps, only: a.only });
  const b = res.out.base;
  console.log(`${demo} [load ${loadavg()[0].toFixed(0)}] frame: ` + Object.entries(res.out).map(([k, v]) => `${k} ${v.min}/${v.p20}${k === 'base' ? '' : ` (${v.p20 - b.p20 >= 0 ? '+' : ''}${(v.p20 - b.p20).toFixed(2)})`}`).join(' · ') + '  [min/p20 ms]');
  await page.close();
}
await browser.close();
await server.close();
