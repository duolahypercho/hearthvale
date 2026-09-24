#!/usr/bin/env node
/**
 * Interleaved A/B frame-time probe (pillar 14 diagnostics). On ONE page, cycles through toggles
 * (base, no-AO, no-bloom, no-fog, cached shadows, ...) in short slices, several rounds, so machine
 * load drift hits every config equally; reports the median frame ms per config and its delta to base.
 *   node scripts/abprof.mjs --demos farm-morning [--rounds 5 --slice 1200] [--only base,ao,bloom]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, loadavg } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { demos: 'farm-morning', w: 2560, h: 1440, rounds: 5, slice: 1200, warmup: 2500, quality: 'high', only: '', eval: '' };
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
  await page.goto(`${base}?demo=${demo}&quality=${a.quality}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__game.ready());
  if (a.eval) await page.evaluate(a.eval);
  await page.waitForTimeout(+a.warmup);
  const res = await page.evaluate(async ({ rounds, slice, only }) => {
    const g = window.__game.game;
    const rc = g.rc;
    const post = rc.post;
    const passes = post.composer.passes;
    const byName = (n) => passes.filter((p) => p.constructor.name === n);
    const sm = rc.renderer.shadowMap;
    const smr = sm.render;
    const toggle = (ps, on) => ps.forEach((p) => (p.enabled = on));
    const C = {
      base: [() => {}, () => {}],
      ao: [() => toggle(byName('GTAOPass'), false), () => toggle(byName('GTAOPass'), true)],
      bloom: [() => toggle(byName('UnrealBloomPass'), false), () => toggle(byName('UnrealBloomPass'), true)],
      fog: [() => toggle(byName('HeightFogPass'), false), () => toggle(byName('HeightFogPass'), true)],
      shadowcache: [() => { sm.render = () => {}; }, () => { sm.render = smr; }],
      smaa: [() => toggle(byName('SMAAPass'), false), () => toggle(byName('SMAAPass'), true)],
      tilt: [() => toggle(byName('ShaderPass').slice(0, 1), false), () => toggle(byName('ShaderPass').slice(0, 1), true)],
      res70: [() => { rc.resScale = 0.7; rc.resize(); }, () => { rc.resScale = 1; rc.resize(); }],
      allpost: [() => toggle(passes.slice(1), false), () => toggle(passes.slice(1), true)],
    };
    // sys:<tag> hides every object carrying userData.perfTag === tag (or top-level name) for the slice.
    const tagged = {};
    rc.scene.traverse((o) => { const t = o.userData.perfTag; if (t && o.visible) (tagged[t] ??= []).push(o); });
    const top = (o) => { let n = o; while (n.parent && !n.parent.isScene && !n.parent.name.startsWith('map:')) n = n.parent; return n; };
    for (const [k, v] of Object.entries(g.perf().bySystem ?? {})) void k, void v;
    rc.scene.traverse((o) => { if (o.parent && (o.parent.isScene || o.parent.name.startsWith('map:')) && o.name && !o.userData.perfTag && o.visible) (tagged[o.name] ??= []).push(o); });
    for (const [t, objs] of Object.entries(tagged)) C['sys:' + t] = [() => objs.forEach((o) => (o.visible = false)), () => objs.forEach((o) => (o.visible = true))];
    const names = only === 'sys' ? ['base', ...Object.keys(C).filter((k) => k.startsWith('sys:'))] : only ? only.split(',') : Object.keys(C).filter((k) => !k.startsWith('sys:'));
    const acc = Object.fromEntries(names.map((n) => [n, []]));
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    // Cost metric: Game.step + gl.finish() (CPU submit + GPU completion, serialised), immune to the
    // bimodal 16/33 ms frame pacing that makes wall-clock deltas non-additive.
    const gl = rc.renderer.getContext();
    const origStep = g.step;
    let stepMs = 0;
    g.step = function (dt) { const t = performance.now(); origStep.call(this, dt); gl.finish(); stepMs = performance.now() - t; };
    const fin = Object.fromEntries(names.map((n) => [n, []]));
    for (let k = 0; k < rounds; k++) {
      for (const n of names) {
        C[n][0]();
        await frame(); await frame(); await frame();
        let last = await frame();
        const t0 = last;
        while (last - t0 < slice) { const now = await frame(); acc[n].push(now - last); fin[n].push(stepMs); last = now; }
        C[n][1]();
      }
    }
    delete g.step;
    const med = (v) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const out = {};
    for (const n of names) out[n] = { med: +med(acc[n]).toFixed(2), mean: +mean(acc[n]).toFixed(2), fin: +med(fin[n]).toFixed(2) };
    const p = g.perf();
    return { res: out, draws: p.drawCalls, tris: p.triangles };
  }, { rounds: +a.rounds, slice: +a.slice, only: a.only });
  const b = res.res.base.fin;
  const line = Object.entries(res.res).map(([k, v]) => `${k} ${v.fin}${k === 'base' ? '' : ` (${(v.fin - b >= 0 ? '+' : '')}${(v.fin - b).toFixed(1)})`}`).join(' · ') + ` | wall base ${res.res.base.mean}`;
  console.log(`${demo} [load ${loadavg()[0].toFixed(0)}] ${res.draws}dc ${(res.tris / 1e6).toFixed(2)}M: ${line}`);
  await page.close();
}
await browser.close();
await server.close();
