#!/usr/bin/env node
/**
 * Material micro-benchmark (pillar 14 diagnostics): resolves shader-level differences of ±0.2 ms that
 * whole-frame A/B (abprof) cannot see on a shared GPU. On ONE page it hides everything except the
 * meshes whose name matches --names (default: terrain chunks), freezes the shadow maps, and renders
 * that view into a full-size target R times per sample, alternating configs sample by sample;
 * a 1-px readback brackets every sample. Reports the min and the 20th percentile per config (time
 * slicing by other GPU clients only ever adds time, so the low end is the cost).
 *
 *   node scripts/matbench.mjs --demos beach-sunset --eval "$(cat variants.js)" [--samples 40 --reps 4]
 *   node scripts/matbench.mjs --demos beach-sunset --names . --sys     (main-pass cost of each system)
 *   node scripts/matbench.mjs --demos mine-lava --names cave-shell --params cavevn=0   (extra URL params: page-level A/B)
 *
 * The eval must define window.__abConfigs = { name: [apply, revert] } (same contract as abprof);
 * 'base' (no change) is always measured first.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, loadavg } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { demos: 'beach-sunset', w: 2560, h: 1440, samples: 40, reps: 4, warmup: 2500, quality: 'high', eval: '', names: 'terrain-chunk', params: '' };
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
  const res = await page.evaluate(async ({ samples, reps, names, sys }) => {
    const g = window.__game.game;
    const rc = g.rc;
    const renderer = rc.renderer;
    const gl = renderer.getContext();
    const C = { base: [() => {}, () => {}], ...(window.__abConfigs || {}) };
    // --sys: also one config per system tag (hide it), as in abprof's sys:<tag>.
    if (sys) {
      const tagged = {};
      rc.scene.traverse((o) => { const t = o.userData.perfTag; if (t && o.visible) (tagged[t] ??= []).push(o); });
      rc.scene.traverse((o) => { if (o.parent && (o.parent.isScene || o.parent.name.startsWith('map:')) && o.name && !o.userData.perfTag && o.visible) (tagged[o.name] ??= []).push(o); });
      const only = sys === true ? null : new RegExp(sys);
      for (const [t, objs] of Object.entries(tagged)) if (!only || only.test(t)) C['sys:' + t] = [() => objs.forEach((o) => (o.visible = false)), () => objs.forEach((o) => (o.visible = true))];
    }
    const keep = new RegExp(names === '.' ? '' : `^(?:${names})$`);
    // Freeze the game (no step), then hide all drawables except the targets.
    const origStep = g.step;
    g.step = () => {};
    await new Promise((r) => requestAnimationFrame(r));
    const hidden = [];
    // Kept: the name, or any ancestor's perfTag / name, matches --names.
    const kept = (o) => { for (let n = o; n; n = n.parent) if (keep.test(n.name) || (n.userData.perfTag && keep.test(n.userData.perfTag))) return true; return false; };
    rc.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !kept(o)) { o.visible = false; hidden.push(o); } });
    const sm = renderer.shadowMap;
    const smAuto = sm.autoUpdate;
    sm.autoUpdate = false;
    const prevRT = renderer.getRenderTarget();
    const rtCtor = rc.post.composer.renderTarget1.constructor;
    const rt = new rtCtor(gl.drawingBufferWidth, gl.drawingBufferHeight, { depthBuffer: true });
    const px = new Uint8Array(4);
    // A 1-px readback waits for the GPU to finish the target (gl.finish alone may return early under ANGLE).
    const sync = () => renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
    const draw = () => { renderer.setRenderTarget(rt); renderer.clear(); renderer.render(rc.scene, rc.camera); };
    const names2 = Object.keys(C);
    // Warm every config (compile).
    for (const n of names2) { C[n][0](); draw(); sync(); draw(); sync(); C[n][1](); }
    renderer.info.reset();
    draw();
    const drawn = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, targets: (() => { let k = 0; rc.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible) k++; }); return k; })() };
    const acc = Object.fromEntries(names2.map((n) => [n, []]));
    for (let s = 0; s < samples; s++) {
      for (const n of s % 2 ? [...names2].reverse() : names2) {
        C[n][0]();
        draw(); sync();
        const t = performance.now();
        for (let k = 0; k < reps; k++) draw();
        sync();
        acc[n].push((performance.now() - t) / reps);
        C[n][1]();
      }
      if (s % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    renderer.setRenderTarget(prevRT);
    rt.dispose();
    sm.autoUpdate = smAuto;
    hidden.forEach((o) => (o.visible = true));
    g.step = origStep;
    const out = {};
    for (const n of names2) { const v = [...acc[n]].sort((x, y) => x - y); out[n] = { min: +v[0].toFixed(3), p20: +v[Math.floor(v.length * 0.2)].toFixed(3), med: +v[Math.floor(v.length / 2)].toFixed(3) }; }
    return { out, drawn };
  }, { samples: +a.samples, reps: +a.reps, names: a.names, sys: a.sys === 'true' ? true : a.sys || false });
  const b = res.out.base;
  console.log(`${demo} [load ${loadavg()[0].toFixed(0)}] ${a.names} (${res.drawn.targets} objs, ${res.drawn.calls} draws, ${(res.drawn.tris / 1e3).toFixed(0)}k tris): ` + Object.entries(res.out).map(([k, v]) => `${k} ${v.min}/${v.p20}${k === 'base' ? '' : ` (${v.p20 - b.p20 >= 0 ? '+' : ''}${(v.p20 - b.p20).toFixed(2)})`}`).join(' · ') + '  [min/p20 ms]');
  await page.close();
}
await browser.close();
await server.close();
