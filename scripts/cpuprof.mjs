#!/usr/bin/env node
/**
 * Main-thread CPU hunter (DESIGN pillar 14): where do a demo's per-frame JS milliseconds go?
 *
 *   node scripts/cpuprof.mjs --demos town-day,animals-coop [--warmup 3000 --record 6000 --top 25]
 *
 * Per demo: fresh page on `?demo=<name>&quality=high`, await __game.ready(), warm up, then run the
 * V8 sampling CPU profiler (100 µs interval) for `--record` ms. Prints ms per frame by function
 * (self), by the innermost game-code frame of each sample (so three's internals are charged to the
 * game function that called into them) and inclusive per game function. Writes
 * shots/perf/cpu-<demo>.json. Same page setup as allocprof.mjs (1920x1080 by default: CPU cost does
 * not depend on the pixel count).
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { demos: '', warmup: 3000, record: 6000, top: 25, w: 1920, h: 1080, extra: '' };
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true';
    args[k] = ['warmup', 'record', 'top', 'w', 'h'].includes(k) ? Number(v) : v;
  }
}
const GPU_ARGS = [
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox',
  '--disable-gpu-vsync', '--disable-frame-rate-limit',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
];

const label = (cf) => `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/src\//, 'src/').replace(/^.*\/deps\//, '').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;

async function main() {
  const demos = String(args.demos).split(',').filter(Boolean);
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir: resolve(tmpdir(), `hearthvale-vite-cpu-${process.pid}`),
    server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/node_modules/**', '**/.git/**', '**/.workflows/**'] } },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const base = `http://127.0.0.1:${addr.port}/`;
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS, channel: 'chromium' }).catch(() => chromium.launch({ headless: true, args: GPU_ARGS }));
  mkdirSync(resolve(root, 'shots/perf'), { recursive: true });
  try {
    for (const name of demos) {
      const ctx = await browser.newContext({ viewport: { width: args.w, height: args.h } });
      const page = await ctx.newPage();
      await page.goto(`${base}?demo=${encodeURIComponent(name)}&quality=high${args.extra}`, { waitUntil: 'domcontentloaded', timeout: 150000 });
      await page.waitForFunction(() => !!window.__game, null, { timeout: 150000 });
      await page.evaluate(() => window.__game.ready());
      await page.waitForTimeout(args.warmup);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      const f0 = await page.evaluate(() => window.__game.info().frame);
      await cdp.send('Profiler.start');
      await page.waitForTimeout(args.record);
      const { profile } = await cdp.send('Profiler.stop');
      const f1 = await page.evaluate(() => window.__game.info().frame);
      const frames = Math.max(1, f1 - f0);
      // Sample counts → ms (mean sampling interval over the run).
      const totalMs = (profile.endTime - profile.startTime) / 1000;
      const nSamples = profile.samples.length || 1;
      const msPer = totalMs / nSamples;
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const parent = new Map();
      for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
      const self = new Map();
      const owner = new Map();
      const incl = new Map();
      let busy = 0;
      for (const n of profile.nodes) {
        const hits = n.hitCount ?? 0;
        if (!hits) continue;
        const nm = label(n.callFrame);
        if (n.callFrame.functionName === '(idle)' || n.callFrame.functionName === '(program)') continue;
        busy += hits;
        self.set(nm, (self.get(nm) ?? 0) + hits);
        // Walk to the root: innermost game frame owns the sample; every distinct game frame on the
        // stack gets it inclusively.
        let own = null;
        const seen = new Set();
        for (let id = n.id; id !== undefined; id = parent.get(id)) {
          const cf = byId.get(id).callFrame;
          if (!/\/src\//.test(cf.url)) continue;
          const l = label(cf);
          if (!own) own = l;
          if (!seen.has(l)) {
            seen.add(l);
            incl.set(l, (incl.get(l) ?? 0) + hits);
          }
        }
        own ??= nm;
        owner.set(own, (owner.get(own) ?? 0) + hits);
      }
      const ms = (h) => +((h * msPer) / frames).toFixed(3);
      const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, args.top).map(([k, v]) => ({ msPerFrame: ms(v), fn: k }));
      const res = { demo: name, frames, fps: +(frames / (totalMs / 1000)).toFixed(1), busyMsPerFrame: ms(busy), byOwner: top(owner), inclusive: top(incl), bySelf: top(self) };
      writeFileSync(resolve(root, `shots/perf/cpu-${name}.json`), JSON.stringify(res, null, 1));
      console.log(`\n[cpu] ${name}: ${res.busyMsPerFrame} ms JS/frame over ${frames} frames (${res.fps} fps)`);
      console.log('  -- by owner (innermost game frame):');
      for (const r of res.byOwner) console.log(`  ${String(r.msPerFrame).padStart(7)} ms  ${r.fn}`);
      console.log('  -- inclusive (game frames):');
      for (const r of res.inclusive) console.log(`  ${String(r.msPerFrame).padStart(7)} ms  ${r.fn}`);
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
