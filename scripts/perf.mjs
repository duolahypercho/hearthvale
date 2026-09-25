#!/usr/bin/env node
/**
 * Frame-time benchmark for every demo (DESIGN pillar 14 — Performance).
 *
 *   npm run perf                                   # every demo in __game.demos, 2560x1440, quality=high
 *   npm run perf -- --demos farm-morning,town-day  # a subset (comma list)
 *   npm run perf -- --filter '^(farm|town)-'       # regex over demo names
 *   npm run perf -- --warmup 3000 --record 8000 --w 2560 --h 1440 --quality high
 *   npm run perf -- --w 1512 --h 982 --dpr 2           # Retina laptop (the preset's pixelRatioCap applies)
 *   npm run perf -- --headed                       # headed, window parked off-screen (see "Timing mode")
 *   npm run perf -- --no-history                   # don't append to shots/perf/history.jsonl
 *   npm run perf -- --eval "<js>"                   # run JS after ready (A/B experiments; tag with --label)
 *   npm run perf -- --profile 15                   # + top-15 self-time JS functions per demo (CDP sampling profiler)
 *   npm run perf -- --ready-budget 200000         # ms allowed for page load + __game.ready() (default 150000)
 *   npm run perf -- --resume                       # skip demos already in shots/perf/partial.json (after a killed run)
 *
 * Per demo: fresh page on `?demo=<name>&quality=<q>`, await __game.ready(), warm up `--warmup` ms,
 * then record `--record` ms of requestAnimationFrame deltas plus:
 *   - CPU ms of Game.step() per frame (JS sim + scene traversal + GL command submission),
 *   - JS heap allocation rate (MB/s) and GC count (heap drops) — per-frame allocation churn,
 *   - CDP Performance metrics per frame: layouts, style recalcs, script / layout ms — DOM/UI thrash,
 *   - __game.info().perf: draw calls / triangles (all passes) + the heaviest systems,
 *   - scene census: meshes, shadow casters, transparent draws, lights, active post passes, programs.
 * Prints a table (avg fps / p95 / p99 ms / draw calls / tris), writes shots/perf/latest.json
 * and appends a compact line to shots/perf/history.jsonl, then flags:
 *   FAIL  avg < 60 fps or p99 > 25 ms (the pillar-14 bar),
 *   REGR  vs the median of the last 3 comparable history runs: avg fps −10 % (and ≥ 3 fps),
 *         p99 +25 % (and ≥ 3 ms), or draw calls / triangles +20 % (content growth, noise-free).
 *   REGR? a timing drop measured while the machine was saturated (load > 1.5× cores or main
 *         thread on-CPU < 35 %) — reported, not trusted; re-run `--demos <name>` on a quiet machine.
 *
 * Timing mode: HEADLESS by default — Playwright's full Chromium (channel 'chromium' = new headless,
 * same compositor as desktop Chrome, not chrome-headless-shell) with ANGLE/Metal on the real GPU and
 * --disable-gpu-vsync --disable-frame-rate-limit. Verified uncapped: the empty-canvas calibration
 * runs at 650–1300 fps and light interiors reach 130+ fps, so headless does not hide headroom and
 * headed is not needed. `--headed` parks a real window off-screen for cross-checking.
 * Other agents' shot/smoke runs share the CPU + GPU — every run records concurrent Chromium GPU
 * processes, load average, the calibration fps and a per-demo on-CPU ratio (main-thread CPU time /
 * wall time) so a contended run can be told apart from a real regression. Draw calls, triangles,
 * GL uploads/frame and new-program counts are deterministic and are the noise-free signals.
 * `gpuAvgMs` (EXT_disjoint_timer_query_webgl2 around Game.step) is elapsed GPU time and is
 * inflated when other processes share the GPU — use it relatively, not absolutely.
 * Exit code: 0 always unless the harness itself fails (2) — FAIL/REGR are reported, not fatal,
 * unless `--strict` is given (then 1 when anything fails or regresses).
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, loadavg, cpus } from 'node:os';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { w: 2560, h: 1440, dpr: 1, quality: 'high', warmup: 3000, record: 8000, timeout: 240000, demos: '', filter: '', headed: false, history: true, strict: false, out: 'shots/perf/latest.json', label: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'no-history') { out.history = false; continue; }
    if (key === 'headed' || key === 'strict' || key === 'resume') { out[key] = true; continue; }
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = ['w', 'h', 'dpr', 'warmup', 'record', 'timeout'].includes(key) ? Number(val) : val;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const GPU_ARGS = [
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-gpu-rasterization', '--disable-gpu-sandbox',
  // Uncap rAF so headroom above the display refresh is measurable.
  '--disable-gpu-vsync', '--disable-frame-rate-limit',
  // Never throttle an off-screen / background page while measuring.
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  // Un-quantised performance.memory for the allocation-rate estimate.
  '--enable-precise-memory-info',
  // EXT_disjoint_timer_query_webgl2 for per-frame GPU time.
  '--enable-privileged-webgl-extensions',
];

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const median = (arr) => pct(arr, 50);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function envLoad() {
  let chromium = 0;
  let shots = 0;
  try {
    const ps = execSync('ps -Ao command', { encoding: 'utf8' });
    for (const line of ps.split('\n')) {
      if (/Chromium|chrome-headless-shell|Google Chrome for Testing/i.test(line) && /--type=gpu-process/.test(line)) chromium++;
      if (/scripts\/(shot|shots|smoke|perf)\.mjs/.test(line)) shots++;
    }
  } catch { /* ignore */ }
  return { gpuProcesses: chromium, harnessProcesses: shots, loadavg: loadavg().map(r2), cpus: cpus().length };
}

function gitRev() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim() + (execSync('git status --porcelain src', { cwd: root, encoding: 'utf8' }).trim() ? '+dirty' : '');
  } catch {
    return 'unknown';
  }
}

function demoListFromSource() {
  const s = readFileSync(resolve(root, 'src/core/demos.ts'), 'utf8');
  return [...s.matchAll(/^\s+'?([a-z0-9-]+)'?:\s*\{\s*map:/gm)].map((m) => m[1]);
}

/** In-page: record `ms` of rAF deltas + Game.step CPU time + heap, and a scene census. */
const RECORD_FN = async (ms) => {
  const g = window.__game.game;
  const deltas = [];
  const cpu = [];
  const heap = [];
  const rc = g.rc;
  const origStep = g.step;
  let stepMs = 0;
  // GPU time per frame via EXT_disjoint_timer_query_webgl2 (null when the extension is missing).
  const glq = rc.renderer.getContext();
  const tq = glq.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  const gpu = [];
  const programs0 = rc.renderer.info.programs?.length ?? 0;
  const progIds0 = new Set((rc.renderer.info.programs ?? []).map((p) => p.id));
  g.step = function (dt) {
    const t = performance.now();
    let q = null;
    if (tq) {
      q = glq.createQuery();
      glq.beginQuery(tq.TIME_ELAPSED_EXT, q);
    }
    origStep.call(this, dt);
    if (q) {
      glq.endQuery(tq.TIME_ELAPSED_EXT);
      pending.push(q);
    }
    while (pending.length && glq.getQueryParameter(pending[0], glq.QUERY_RESULT_AVAILABLE)) {
      const pq = pending.shift();
      if (!glq.getParameter(tq.GPU_DISJOINT_EXT)) gpu.push(glq.getQueryParameter(pq, glq.QUERY_RESULT) / 1e6);
      glq.deleteQuery(pq);
    }
    stepMs = performance.now() - t;
  };
  const perfSamples = [];
  await new Promise((done) => {
    let last = 0;
    let t0 = 0;
    const tick = (now) => {
      if (!t0) { t0 = now; last = now; requestAnimationFrame(tick); return; }
      deltas.push(now - last);
      cpu.push(stepMs);
      if (performance.memory) heap.push(performance.memory.usedJSHeapSize);
      if (deltas.length % 60 === 0) {
        const p = g.perf();
        perfSamples.push({ drawCalls: p.drawCalls, triangles: p.triangles });
      }
      last = now;
      if (now - t0 >= ms) done();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  delete g.step; // restore the prototype method
  for (const q of pending) glq.deleteQuery(q);
  const programs1 = rc.renderer.info.programs?.length ?? 0;
  const newProgramNames = (rc.renderer.info.programs ?? []).filter((p) => !progIds0.has(p.id)).map((p) => p.name).slice(0, 12);
  if (g.step !== origStep) g.step = origStep;

  // GL upload churn: count texture / buffer uploads per frame over ~60 extra frames (after the timed
  // window so the wrappers don't perturb fps). Per-frame uploads usually mean a `needsUpdate = true`
  // every frame (CanvasTexture redraws, BatchedMesh indirect textures per pass, DataTexture writes).
  const gl = rc.renderer.getContext();
  const counted = ['texImage2D', 'texSubImage2D', 'texParameteri', 'bufferData', 'bufferSubData', 'useProgram', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'readPixels', 'getError', 'clientWaitSync'];
  const glCounts = {};
  const origs = {};
  for (const k of counted) {
    if (typeof gl[k] !== 'function') continue;
    origs[k] = gl[k];
    glCounts[k] = 0;
    gl[k] = function (...a) { glCounts[k]++; return origs[k].apply(this, a); };
  }
  let glFrames = 0;
  await new Promise((done) => {
    const f = () => { if (++glFrames >= 60) done(); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  for (const k of Object.keys(origs)) delete gl[k];
  for (const k of Object.keys(glCounts)) glCounts[k] = Math.round((10 * glCounts[k]) / glFrames) / 10;
  let batched = 0;
  rc.scene.traverseVisible((o) => { if (o.isBatchedMesh) batched++; });

  // Heap: positive increments ≈ allocation, drops ≈ GC.
  let alloc = 0;
  let gcs = 0;
  for (let i = 1; i < heap.length; i++) {
    const d = heap[i] - heap[i - 1];
    if (d > 0) alloc += d;
    else if (d < -256 * 1024) gcs++;
  }

  // Scene census (what is actually being drawn).
  const census = { meshes: 0, visibleMeshes: 0, instanced: 0, instances: 0, shadowCasters: 0, transparent: 0, points: 0, lights: 0, shadowLights: 0, pointLights: 0, skinned: 0 };
  rc.scene.traverseVisible((o) => {
    if (o.isLight) {
      census.lights++;
      if (o.castShadow) census.shadowLights++;
      if (o.isPointLight || o.isSpotLight) census.pointLights++;
    }
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      census.visibleMeshes++;
      if (o.isInstancedMesh) { census.instanced++; census.instances += o.count; }
      if (o.isSkinnedMesh) census.skinned++;
      if (o.isPoints) census.points++;
      if (o.castShadow) census.shadowCasters++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m && m.transparent)) census.transparent++;
    }
  });
  rc.scene.traverse((o) => { if (o.isMesh || o.isPoints) census.meshes++; });
  const passes = (rc.post?.composer?.passes ?? []).filter((p) => p.enabled).map((p) => p.constructor?.name || 'pass');
  const mem = rc.renderer.info.memory;
  const programs = rc.renderer.info.programs?.length ?? 0;
  const perf = g.perf();
  const sun = g.lighting?.sun;
  return {
    deltas, cpu, gpu, newPrograms: programs1 - programs0, newProgramNames, alloc, gcs, heapMB: heap.length ? heap[heap.length - 1] / 1048576 : 0,
    perfSamples, perf, census, passes, geometries: mem.geometries, textures: mem.textures, programs,
    shadowMap: sun?.shadow?.mapSize?.x ?? 0,
    drawingBuffer: [rc.renderer.domElement.width, rc.renderer.domElement.height],
    domNodes: document.getElementsByTagName('*').length,
    glPerFrame: glCounts,
    batchedMeshes: batched,
    map: window.__game.info().map,
  };
};

/**
 * Top self-time functions of a CDP CPU profile: [{ fn, selfPct }]. Native (GL) frames are keyed
 * with their nearest JS caller and the nearest game-code (non-deps) caller, e.g.
 * `texParameteri ← setTextureParameters (three) ← updateCanvas src/ui/minimap.ts:42`.
 */
function topSelf(prof, n) {
  const byId = new Map(prof.nodes.map((nd) => [nd.id, nd]));
  const parent = new Map();
  for (const nd of prof.nodes) for (const c of nd.children || []) parent.set(c, nd.id);
  const clean = (u) => (u || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '').replace(/^@fs\/.*\/deps\//, 'deps/');
  const label = (cf) => `${cf.functionName || '(anon)'} ${clean(cf.url)}${cf.url ? ':' + (cf.lineNumber + 1) : ''}`.trim();
  const keyOf = (id) => {
    const nd = byId.get(id);
    const cf = nd.callFrame;
    if (cf.url) return label(cf);
    let jsCaller = '';
    let gameCaller = '';
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) {
      const pf = byId.get(p).callFrame;
      if (!pf.url) continue;
      if (!jsCaller) jsCaller = pf.functionName || '(anon)';
      if (!/deps\/|node_modules/.test(pf.url)) { gameCaller = label(pf); break; }
    }
    return `${cf.functionName || '(native)'}${jsCaller ? ' <- ' + jsCaller : ''}${gameCaller ? ' <- ' + gameCaller : ''}`;
  };
  const self = new Map();
  const dts = prof.timeDeltas || [];
  let total = 0;
  const cache = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    const id = prof.samples[i];
    const dt = dts[i] ?? 0;
    total += dt;
    if (!byId.has(id)) continue;
    let key = cache.get(id);
    if (key === undefined) cache.set(id, (key = keyOf(id)));
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ fn: k, selfPct: r1((100 * v) / Math.max(1, total)) }));
}

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = {};
  for (const { name, value } of metrics) m[name] = value;
  return m;
}

/**
 * One demo, hardened against a repo that other agents edit mid-run: a hard wall-clock budget (a
 * `ready()` that never resolves or a dead rAF loop used to hang the whole run), and an early abort when
 * the page throws an uncaught error every frame (a half-saved source file) instead of timing garbage.
 * A failed demo is retried once on a fresh page (the dev server re-transforms edited files).
 */
async function measureDemoSafe(ctx, base, name) {
  let res = await measureDemo(ctx, base, name);
  if (res.error) {
    await new Promise((r) => setTimeout(r, 4000));
    const again = await measureDemo(ctx, base, name);
    res = again.error ? { ...again, error: `${again.error} (retried; first: ${res.error})` } : { ...again, retried: res.error };
  }
  return res;
}

async function measureDemo(ctx, base, name) {
  const page = await ctx.newPage();
  const errors = [];
  let uncaught = 0;
  let abortRun = null;
  const aborted = new Promise((_, reject) => { abortRun = reject; });
  aborted.catch(() => {});
  // Load (vite transform + scene build + one-shot bakes) can take 50-80 s when other agents saturate the
  // machine (barn-interior / mine-lava hit the old 75 s allowance twice in a row) - give it 150 s (--ready-budget ms).
  const budgetMs = Math.max(60000, (Number(args['ready-budget']) || 150000) + args.warmup + args.record);
  const budget = setTimeout(() => abortRun(new Error(`timed out after ${Math.round(budgetMs / 1000)} s`)), budgetMs);
  page.on('pageerror', (e) => {
    const msg = String(e?.message || e);
    if (errors.length < 50) errors.push(msg);
    // A throw every frame (e.g. a method call whose definition was half-saved) — the timing would be meaningless.
    if (++uncaught === 30) abortRun(new Error(`runtime error storm: ${msg}`));
  });
  page.on('console', (msg) => { if (msg.type() === 'error' && errors.length < 50) errors.push(msg.text()); });
  const guard = (p) => Promise.race([p, aborted]);
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    const t0 = Date.now();
    await guard(page.goto(`${base}?demo=${encodeURIComponent(name)}&quality=${args.quality}`, { waitUntil: 'domcontentloaded', timeout: args.timeout }));
    await guard(page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: args.timeout }));
    await guard(page.evaluate(() => window.__game.ready()));
    const readyMs = Date.now() - t0;
    // --eval "<js>": A/B experiments without touching source, e.g.
    // --eval "__game.game.rc.scene.traverse(o => { if (o.isBatchedMesh) o.perObjectFrustumCulled = false })"
    if (args.eval) await guard(page.evaluate(`(async () => { ${args.eval} })()`));
    await guard(page.waitForTimeout(args.warmup));
    if (args.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    const m0 = await cdpMetrics(cdp);
    const r = await guard(page.evaluate(RECORD_FN, args.record));
    const m1 = await cdpMetrics(cdp);
    let profile;
    if (args.profile) {
      const { profile: prof } = await cdp.send('Profiler.stop');
      profile = topSelf(prof, Number(args.profile) || 15);
    }
    const frames = r.deltas.length || 1;
    const d = (k) => (m1[k] ?? 0) - (m0[k] ?? 0);
    const sumMs = r.deltas.reduce((a, b) => a + b, 0);
    const dcs = r.perfSamples.map((s) => s.drawCalls);
    const tris = r.perfSamples.map((s) => s.triangles);
    const bySystem = Object.entries(r.perf.bySystem || {}).slice(0, 6).map(([k, v]) => ({ tag: k, calls: v.calls, triangles: v.triangles }));
    return {
      demo: name,
      map: r.map,
      loadavg1: r2(loadavg()[0]),
      readyMs,
      frames: r.deltas.length,
      avgFps: r1((1000 * r.deltas.length) / sumMs),
      avgMs: r2(sumMs / frames),
      p50Ms: r2(median(r.deltas)),
      p95Ms: r2(pct(r.deltas, 95)),
      p99Ms: r2(pct(r.deltas, 99)),
      maxMs: r2(Math.max(0, ...r.deltas)),
      over20Pct: r1((100 * r.deltas.filter((x) => x > 20).length) / Math.max(1, r.deltas.length)),
      hitches25: r.deltas.filter((x) => x > 25).length,
      hitches50: r.deltas.filter((x) => x > 50).length,
      cpuAvgMs: r2(mean(r.cpu)),
      cpuP95Ms: r2(pct(r.cpu, 95)),
      // GPU ms per frame (timer query around Game.step: shadow + AO + main + post). ≈ frame time → GPU-bound.
      gpuAvgMs: r.gpu.length ? r2(mean(r.gpu)) : null,
      gpuP95Ms: r.gpu.length ? r2(pct(r.gpu, 95)) : null,
      // Programs compiled during the timed window (first-use shader compiles = multi-100 ms hitches).
      newPrograms: r.newPrograms,
      newProgramNames: r.newProgramNames,
      allocMBs: r2(r.alloc / 1048576 / (sumMs / 1000)),
      gcPerSec: r2(r.gcs / (sumMs / 1000)),
      heapMB: r1(r.heapMB),
      layoutsPerFrame: r2(d('LayoutCount') / frames),
      styleRecalcsPerFrame: r2(d('RecalcStyleCount') / frames),
      layoutMsPerFrame: r2((1000 * (d('LayoutDuration') + d('RecalcStyleDuration'))) / frames),
      scriptMsPerFrame: r2((1000 * d('ScriptDuration')) / frames),
      taskMsPerFrame: r2((1000 * d('TaskDuration')) / frames),
      // Main-thread on-CPU ms per frame and its share of wall time: ≪ 1 means the renderer thread was
      // descheduled (machine contention), so frame times are inflated by the environment, not the game.
      threadCpuMsPerFrame: r2((1000 * d('ThreadTime')) / frames),
      onCpuRatio: r2(d('ThreadTime') / Math.max(1e-6, sumMs / 1000)),
      profile,
      drawCalls: dcs.length ? Math.max(...dcs) : r.perf.drawCalls,
      triangles: tris.length ? Math.max(...tris) : r.perf.triangles,
      bySystem,
      census: r.census,
      passes: r.passes,
      programs: r.programs,
      geometries: r.geometries,
      textures: r.textures,
      shadowMap: r.shadowMap,
      drawingBuffer: r.drawingBuffer,
      domNodes: r.domNodes,
      glPerFrame: r.glPerFrame,
      batchedMeshes: r.batchedMeshes,
      pageErrors: uncaught,
      errors: errors.slice(0, 5),
    };
  } catch (err) {
    return { demo: name, error: String(err?.message || err).split('\n')[0], errors: errors.slice(0, 5) };
  } finally {
    clearTimeout(budget);
    await page.close().catch(() => {});
  }
}

function loadHistory(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function baselineFor(history, demo, cfg) {
  const runs = history.filter((h) => h.w === cfg.w && h.h === cfg.h && h.quality === cfg.quality && h.results?.[demo] && !h.results[demo].error).slice(-3);
  if (!runs.length) return null;
  const rs = runs.map((h) => h.results[demo]);
  return {
    runs: rs.length,
    avgFps: median(rs.map((x) => x.avgFps)),
    p99Ms: median(rs.map((x) => x.p99Ms)),
    drawCalls: median(rs.map((x) => x.drawCalls)),
    triangles: median(rs.map((x) => x.triangles)),
  };
}

function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padEnd(n) : s.padStart(n);
}

async function main() {
  const cacheDir = resolve(tmpdir(), `hearthvale-vite-perf-${process.pid}`);
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir,
    // watch ON (hmr off): with `watch: null` Vite never invalidates its transform cache, so a file another
    // agent saved half-way through its edit stayed broken for every later demo of the run. forwardConsole
    // off: Vite otherwise echoes every uncaught page error to this terminal (50 MB of log per broken run).
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, forwardConsole: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/refs/**', '**/.workflows/**', '**/node_modules/**', '**/.git/**'] } },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5173;
  const base = `http://127.0.0.1:${port}/`;

  const launchArgs = [...GPU_ARGS];
  if (args.headed) launchArgs.push('--window-position=-4000,-4000', `--window-size=${args.w},${args.h}`);
  let browser = null;
  let exitCode = 0;
  const envStart = envLoad();
  try {
    // channel 'chromium' = the full browser (new headless when headless) — same compositor as desktop Chrome;
    // plain launch falls back to chrome-headless-shell (old headless).
    // Relaunchable: other agents' cleanup (pkill of stray Chromium) has killed the browser mid-run twice,
    // which used to throw away every demo measured so far.
    let ctx = null;
    const launch = async () => {
      if (browser) await browser.close().catch(() => {});
      browser = await chromium.launch({ headless: !args.headed, args: launchArgs, channel: 'chromium' }).catch(() => chromium.launch({ headless: !args.headed, args: launchArgs }));
      ctx = await browser.newContext({ viewport: { width: args.w, height: args.h }, deviceScaleFactor: args.dpr });
    };
    await launch();

    // GPU + demo list from a plain boot.
    const probe = await ctx.newPage();
    await probe.goto('about:blank');
    // Calibration: an empty full-viewport WebGL2 clear loop. Its fps is the ceiling this machine /
    // browser can deliver right now — if it is far below the demos' target, the run is environment-bound.
    const calib = await probe.evaluate(async (ms) => {
      const c = document.createElement('canvas');
      c.width = innerWidth;
      c.height = innerHeight;
      c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
      document.body.appendChild(c);
      const gl = c.getContext('webgl2');
      if (!gl) return { gpu: null, fps: 0 };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl2';
      const d = [];
      await new Promise((done) => {
        let last = 0;
        let t0 = 0;
        const tick = (now) => {
          gl.clearColor(Math.random(), 0.5, 0.5, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          if (t0) d.push(now - last);
          else t0 = now;
          last = now;
          if (now - t0 < ms) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      d.sort((a, b) => a - b);
      const sum = d.reduce((a, b) => a + b, 0);
      return { gpu, fps: Math.round((10000 * d.length) / sum) / 10, p99Ms: Math.round(d[Math.floor(d.length * 0.99)] * 100) / 100 };
    }, 3000);
    const gpu = calib.gpu;
    if (!gpu || /swiftshader/i.test(gpu)) throw new Error(`no hardware WebGL2 (renderer: ${gpu}) — perf numbers would be meaningless`);
    envStart.calibration = { fps: calib.fps, p99Ms: calib.p99Ms };
    await probe.goto(`${base}?quality=${args.quality}&notitle=1`, { waitUntil: 'domcontentloaded', timeout: args.timeout });
    let demos = [];
    try {
      await probe.waitForFunction(() => Array.isArray(window.__game?.demos), null, { timeout: args.timeout });
      demos = await probe.evaluate(() => window.__game.demos);
    } catch {
      demos = demoListFromSource();
    }
    await probe.close();
    if (args.demos) {
      const want = String(args.demos).split(',').map((s) => s.trim()).filter(Boolean);
      demos = want;
    }
    if (args.filter) {
      const re = new RegExp(args.filter);
      demos = demos.filter((d) => re.test(d));
    }
    const mode = args.headed ? 'headed (window off-screen)' : 'headless (new headless)';
    console.log(`[perf] ${gpu} · ${mode} · ${args.w}x${args.h} quality=${args.quality} · warmup ${args.warmup} ms, record ${args.record} ms · ${demos.length} demos`);
    console.log(`[perf] concurrent load: ${envStart.gpuProcesses} other Chromium GPU processes, ${envStart.harnessProcesses} harness scripts, loadavg ${envStart.loadavg.join(' ')} · empty-canvas calibration ${calib.fps} fps (p99 ${calib.p99Ms} ms)`);

    // Checkpoint after every demo (shots/perf/partial.json); `--resume` skips demos already measured there
    // with the same resolution / quality (after a crashed or killed run).
    const partialPath = resolve(root, 'shots/perf/partial.json');
    const done = new Map();
    if (args.resume && existsSync(partialPath)) {
      try {
        const prev = JSON.parse(readFileSync(partialPath, 'utf8'));
        if (prev.w === args.w && prev.h === args.h && prev.quality === args.quality) for (const r of prev.results ?? []) if (!r.error) done.set(r.demo, r);
        console.log(`[perf] resuming: ${done.size} demos already measured in ${partialPath}`);
      } catch { /* ignore */ }
    }
    const results = [];
    const isClosed = (e) => /closed|disconnected|crash/i.test(String(e?.message || e));
    for (const [i, name] of demos.entries()) {
      if (done.has(name)) { results.push(done.get(name)); continue; }
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          if (!browser?.isConnected()) { console.log('[perf] browser gone — relaunching'); await launch(); }
          res = await measureDemoSafe(ctx, base, name);
          if (res.error && isClosed(res.error) && attempt < 2) { await launch(); continue; }
          break;
        } catch (err) {
          if (attempt >= 2 || !isClosed(err)) { res = { demo: name, error: String(err?.message || err).split('\n')[0] }; break; }
          console.log(`[perf] browser closed during ${name} — relaunching (${attempt + 1}/2)`);
          await launch().catch(() => {});
        }
      }
      results.push(res);
      try {
        mkdirSync(dirname(partialPath), { recursive: true });
        writeFileSync(partialPath, JSON.stringify({ w: args.w, h: args.h, quality: args.quality, label: args.label || undefined, results }, null, 1));
      } catch { /* ignore */ }
      if (res.error) console.log(`[perf] ${i + 1}/${demos.length} ${name}: ERROR ${res.error}`);
      else console.log(`[perf] ${i + 1}/${demos.length} ${name}: ${res.avgFps} fps  p95 ${res.p95Ms}  p99 ${res.p99Ms} ms  gpu ${res.gpuAvgMs ?? '-'} ms  cpu ${res.cpuAvgMs} ms (on-cpu ${Math.round(res.onCpuRatio * 100)}%)  alloc ${res.allocMBs} MB/s  ${res.drawCalls} dc  ${(res.triangles / 1e6).toFixed(2)}M tris`);
    }
    const envEnd = envLoad();

    // Compare with history.
    const histPath = resolve(root, 'shots/perf/history.jsonl');
    const history = loadHistory(histPath);
    const cfg = { w: args.w, h: args.h, quality: args.quality };
    const fails = [];
    const regressions = [];
    const suspect = [];
    for (const r of results) {
      if (r.error) { fails.push({ demo: r.demo, why: `error: ${r.error}` }); continue; }
      const why = [];
      if (r.avgFps < 60) why.push(`avg ${r.avgFps} fps < 60`);
      if (r.p99Ms > 25) why.push(`p99 ${r.p99Ms} ms > 25`);
      if (why.length) fails.push({ demo: r.demo, why: why.join(', ') });
      const b = baselineFor(history, r.demo, cfg);
      r.baseline = b;
      if (!b) continue;
      const rw = [];
      // Timing is only trusted when the machine was not saturated during this demo (1-min load average
      // below 1.5× cores and the main thread was on-CPU ≥ 35 % of the time); otherwise a timing drop is
      // reported as 'suspect' (REGR?) and does not fail --strict. Content growth is always trusted.
      const contended = r.loadavg1 > envStart.cpus * 1.5 || r.onCpuRatio < 0.35;
      const tw = [];
      if (r.avgFps < b.avgFps * 0.9 && b.avgFps - r.avgFps >= 3) tw.push(`avg ${b.avgFps}→${r.avgFps} fps`);
      if (r.p99Ms > b.p99Ms * 1.25 && r.p99Ms - b.p99Ms >= 3) tw.push(`p99 ${b.p99Ms}→${r.p99Ms} ms`);
      if (r.drawCalls > b.drawCalls * 1.2 && r.drawCalls - b.drawCalls >= 10) rw.push(`draw calls ${b.drawCalls}→${r.drawCalls}`);
      if (r.triangles > b.triangles * 1.2 && r.triangles - b.triangles >= 50000) rw.push(`tris ${(b.triangles / 1e6).toFixed(2)}M→${(r.triangles / 1e6).toFixed(2)}M`);
      if (!contended) rw.push(...tw);
      if (rw.length) regressions.push({ demo: r.demo, why: rw.join(', ') });
      else if (tw.length) suspect.push({ demo: r.demo, why: `${tw.join(', ')} (contended: load ${r.loadavg1}, on-CPU ${Math.round(r.onCpuRatio * 100)} %)` });
    }

    // Table.
    const W = Math.max(8, ...results.map((r) => r.demo.length));
    const head = `${pad('demo', W, true)} | ${pad('avg fps', 7)} | ${pad('p95 ms', 6)} | ${pad('p99 ms', 6)} | ${pad('cpu ms', 6)} | ${pad('gpu ms', 6)} | ${pad('draws', 5)} | ${pad('tris', 7)} | flag`;
    console.log('\n' + head + '\n' + '-'.repeat(head.length));
    for (const r of results) {
      if (r.error) { console.log(`${pad(r.demo, W, true)} | ERROR ${r.error}`); continue; }
      const flag = [fails.some((f) => f.demo === r.demo) ? 'FAIL' : '', regressions.some((f) => f.demo === r.demo) ? 'REGR' : '', suspect.some((f) => f.demo === r.demo) ? 'REGR?' : ''].filter(Boolean).join(' ');
      console.log(`${pad(r.demo, W, true)} | ${pad(r.avgFps.toFixed(1), 7)} | ${pad(r.p95Ms.toFixed(1), 6)} | ${pad(r.p99Ms.toFixed(1), 6)} | ${pad(r.cpuAvgMs.toFixed(1), 6)} | ${pad(r.gpuAvgMs == null ? '-' : r.gpuAvgMs.toFixed(1), 6)} | ${pad(r.drawCalls, 5)} | ${pad((r.triangles / 1e6).toFixed(2) + 'M', 7)} | ${flag}`);
    }
    const ok = results.filter((r) => !r.error);
    const worst = [...ok].sort((a, b) => a.avgFps - b.avgFps)[0];
    const worstP99 = [...ok].sort((a, b) => b.p99Ms - a.p99Ms)[0];
    console.log('');
    if (worst) console.log(`[perf] worst avg: ${worst.demo} ${worst.avgFps} fps · worst p99: ${worstP99.demo} ${worstP99.p99Ms} ms`);
    console.log(`[perf] ${fails.length} below bar (avg<60 or p99>25), ${regressions.length} regressions vs history (${history.length} prior runs), ${suspect.length} suspect timing drops under contention`);
    for (const f of fails) console.log(`  FAIL ${f.demo}: ${f.why}`);
    for (const f of regressions) console.log(`  REGR ${f.demo}: ${f.why}`);
    for (const f of suspect) console.log(`  REGR? ${f.demo}: ${f.why}`);

    const run = {
      ts: new Date().toISOString(),
      rev: gitRev(),
      label: args.label || undefined,
      gpu,
      mode,
      w: args.w,
      h: args.h,
      quality: args.quality,
      warmupMs: args.warmup,
      recordMs: args.record,
      env: { start: envStart, end: envEnd },
      allAt60: fails.length === 0,
      fails,
      regressions,
      suspect,
      results,
    };
    const outPath = resolve(root, args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(run, null, 2));
    console.log(`[perf] wrote ${outPath}`);
    if (args.history) {
      const compact = {};
      for (const r of results) {
        compact[r.demo] = r.error
          ? { error: r.error }
          : { avgFps: r.avgFps, p95Ms: r.p95Ms, p99Ms: r.p99Ms, cpuAvgMs: r.cpuAvgMs, gpuAvgMs: r.gpuAvgMs, onCpu: r.onCpuRatio, drawCalls: r.drawCalls, triangles: r.triangles, allocMBs: r.allocMBs };
      }
      mkdirSync(dirname(histPath), { recursive: true });
      appendFileSync(histPath, JSON.stringify({ ts: run.ts, rev: run.rev, label: run.label, gpu, mode, w: run.w, h: run.h, quality: run.quality, env: envStart, results: compact }) + '\n');
      console.log(`[perf] appended ${histPath}`);
    }
    if (args.strict && (fails.length || regressions.length)) exitCode = 1;
  } catch (err) {
    console.error('[perf] failed:', err?.message || err);
    exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(exitCode);
}

main();
