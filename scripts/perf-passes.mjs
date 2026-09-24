#!/usr/bin/env node
/**
 * GPU time per render stage (DESIGN pillar 14): where a demo's frame goes, measured in-page with
 * EXT_disjoint_timer_query_webgl2. Timer queries cannot nest, so stages are timed in rotation
 * (one probe set per frame) and averaged:
 *   frame % 3 == 0: each composer pass (RenderPass includes the shadow maps)
 *   frame % 3 == 1: shadow-map render only
 *   frame % 3 == 2: GTAO internals (normal G-buffer, AO kernel, denoise, blend)
 * NOTE: on ANGLE/Metal the per-pass numbers are queue latency, not pass cost (every pass reads
 * ~12 ms) — use the --variants mode (wall frame time, no timer queries) for real A/B costs.
 * Interleaving A/B variants in one page (--variants) cancels most of the drift a busy machine adds:
 *
 *   node scripts/perf-passes.mjs --demos farm-morning,beach-day [--seconds 6] [--w 2560 --h 1440]
 *   node scripts/perf-passes.mjs --demos farm-morning --variants "base=;noao=__game.game.rc.post.setAOEnabled(false)|__game.game.rc.post.setAOEnabled(true)"
 *     (a variant is name=applyJS|undoJS; each runs for 1 s, round-robin, frame time + GPU time reported)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, loadavg } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { demos: 'farm-morning', seconds: 6, w: 2560, h: 1440, quality: 'high', variants: '', extra: '' };
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) args[av[i].slice(2)] = av[i + 1] ?? '';

const GPU_ARGS = [
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-gpu-rasterization', '--disable-gpu-sandbox',
  '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--enable-privileged-webgl-extensions',
];

const PROBE = async ({ seconds, variants }) => {
  const g = window.__game.game;
  const rc = g.rc;
  const r = rc.renderer;
  const gl = r.getContext();
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!tq) return { error: 'no timer query' };
  const sums = new Map();
  const add = (k, v) => {
    const e = sums.get(k) ?? { s: 0, n: 0 };
    e.s += v;
    e.n++;
    sums.set(k, e);
  };
  const pending = [];
  const timed = (key, fn) => (...a) => {
    const q = gl.createQuery();
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    try {
      return fn(...a);
    } finally {
      gl.endQuery(tq.TIME_ELAPSED_EXT);
      pending.push([key(), q]);
    }
  };
  const drain = () => {
    while (pending.length && gl.getQueryParameter(pending[0][1], gl.QUERY_RESULT_AVAILABLE)) {
      const [k, q] = pending.shift();
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) add(k, gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  };
  let frame = 0;
  let variant = 'base';
  const passes = rc.post.composer.passes;
  const origs = passes.map((p) => p.render);
  const names = passes.map((p, i) => `${i}:${p.constructor.name}${p.material?.fragmentShader?.includes('TILT') || p.uniforms?.uFocus ? (p.uniforms?.uLift ? '(grade+tiltV)' : '(tiltH)') : ''}`);
  const sm = r.shadowMap;
  const smRender = sm.render.bind(sm);
  const gt = passes.find((p) => p.constructor.name === 'GTAOPass');
  const gtOver = gt?._renderOverride?.bind(gt);
  const gtPass = gt?._renderPass?.bind(gt);
  let gtIdx = 0;
  const install = () => {
    const m = frame % 3;
    passes.forEach((p, i) => (p.render = m === 0 ? timed(() => `${variant} ${names[i]}`, origs[i].bind(p)) : origs[i]));
    sm.render = m === 1 ? timed(() => `${variant} shadowMap`, smRender) : smRender;
    if (gt) {
      gtIdx = 0;
      gt._renderOverride = m === 2 ? timed(() => `${variant} gtao.gbuffer`, gtOver) : gtOver;
      gt._renderPass = m === 2 ? timed(() => `${variant} gtao.pass${gtIdx++}`, gtPass) : gtPass;
    }
  };
  const origStep = g.step;
  const frameMs = new Map();
  let last = 0;
  const timing = !variants.length;
  g.step = function (dt) {
    if (!timing) return origStep.call(this, dt);
    install();
    const q = gl.createQuery();
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    gl.endQuery(tq.TIME_ELAPSED_EXT);
    gl.deleteQuery(q);
    origStep.call(this, dt);
    frame++;
    drain();
  };
  // Total GPU per frame (on frames with no inner probes we can't nest; approximate via the sum).
  const vs = variants.length ? variants : [{ name: 'base', apply: '', undo: '' }];
  const t0 = performance.now();
  let vi = 0;
  let vStart = t0;
  const run = (js) => { try { if (js) (0, eval)(js); } catch (e) { console.error('variant', e); } };
  run(vs[0].apply);
  variant = vs[0].name;
  await new Promise((done) => {
    const tick = (now) => {
      if (last) {
        const e = frameMs.get(variant) ?? [];
        e.push(now - last);
        frameMs.set(variant, e);
      }
      last = now;
      if (vs.length > 1 && now - vStart > 1000) {
        run(vs[vi].undo);
        vi = (vi + 1) % vs.length;
        run(vs[vi].apply);
        variant = vs[vi].name;
        vStart = now;
        last = 0; // skip the switch frame
      }
      if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  g.step = origStep;
  passes.forEach((p, i) => (p.render = origs[i]));
  sm.render = smRender;
  if (gt) {
    gt._renderOverride = gtOver;
    gt._renderPass = gtPass;
  }
  const out = {};
  for (const [k, e] of sums) out[k] = Math.round((e.s / e.n) * 100) / 100;
  const fr = {};
  for (const [k, d] of frameMs) {
    d.sort((a, b) => a - b);
    fr[k] = { avgMs: Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 100) / 100, p50: Math.round(d[d.length >> 1] * 100) / 100, n: d.length };
  }
  const info = window.__game.info().perf;
  return { gpu: out, frames: fr, draws: info.drawCalls ?? info.calls, tris: info.triangles };
};

const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  logLevel: 'error',
  cacheDir: resolve(tmpdir(), `hearthvale-vite-passes-${process.pid}`),
  server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/refs/**', '**/node_modules/**', '**/.git/**'] } },
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ headless: true, args: GPU_ARGS, channel: 'chromium' }).catch(() => chromium.launch({ headless: true, args: GPU_ARGS }));
const ctx = await browser.newContext({ viewport: { width: Number(args.w), height: Number(args.h) }, deviceScaleFactor: 1 });
const variants = args.variants
  ? args.variants.split(';').map((s) => {
      const [name, rest = ''] = s.split(/=(.*)/s);
      const [apply = '', undo = ''] = rest.split('|');
      return { name, apply, undo };
    })
  : [];
try {
  for (const demo of args.demos.split(',')) {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/?demo=${demo}&quality=${args.quality}${args.extra}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 240000 });
    await page.evaluate(() => window.__game.ready());
    await page.waitForTimeout(2500);
    page.on('console', (m) => m.type() === 'error' && console.log('  [page]', m.text().slice(0, 200)));
    const res = await page.evaluate(PROBE, { seconds: Number(args.seconds), variants });
    console.log(`\n== ${demo}  (load ${loadavg()[0].toFixed(0)})  draws ${res.draws}  tris ${(res.tris / 1e6).toFixed(2)}M`);
    if (res.error) console.log(res.error);
    const byVar = {};
    for (const [k, v] of Object.entries(res.gpu ?? {})) {
      const [vn, ...rest] = k.split(' ');
      (byVar[vn] ??= []).push([rest.join(' '), v]);
    }
    for (const vn of Object.keys(res.frames ?? {})) {
      const rows = byVar[vn] ?? [];
      const f = res.frames[vn];
      const passSum = rows.filter(([n]) => /^\d+:/.test(n)).reduce((a, [, v]) => a + v, 0);
      console.log(`  [${vn}] frame avg ${f?.avgMs} ms (p50 ${f?.p50}, n ${f?.n}) · GPU passes sum ${passSum.toFixed(2)} ms`);
      for (const [n, v] of rows.sort()) console.log(`     ${n.padEnd(34)} ${v.toFixed(2)} ms`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
