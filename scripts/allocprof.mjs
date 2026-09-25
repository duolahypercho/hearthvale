#!/usr/bin/env node
/**
 * Per-frame allocation hunter (DESIGN pillar 14): where do the bytes that feed the GC come from?
 *
 *   node scripts/allocprof.mjs --demos farm-morning,animals-coop [--warmup 3000 --record 6000 --top 25]
 *
 * Per demo: fresh page on `?demo=<name>&quality=high`, await __game.ready(), warm up, then run the
 * V8 sampling heap profiler (HeapProfiler.startSampling, 4 KB interval, GC'd objects kept) for
 * `--record` ms. Prints KB per frame by allocating function (self) and by the top game-code frame
 * of each stack (so a `new Vector3` inside three is charged to the game function that called it).
 * Writes shots/perf/alloc-<demo>.json.
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

function walk(node, stack, out) {
  const cf = node.callFrame;
  const name = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
  const s = [...stack, { name, game: /\/src\//.test(cf.url) }];
  const self = node.selfSize;
  if (self > 0) {
    out.self.set(name, (out.self.get(name) ?? 0) + self);
    // Charge to the innermost game-code frame (skip three / vite internals).
    let owner = name;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].game) { owner = s[i].name; break; }
    out.owner.set(owner, (out.owner.get(owner) ?? 0) + self);
    out.total += self;
  }
  for (const c of node.children) walk(c, s, out);
}

async function main() {
  const demos = String(args.demos).split(',').filter(Boolean);
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir: resolve(tmpdir(), `hearthvale-vite-alloc-${process.pid}`),
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
      await cdp.send('HeapProfiler.enable');
      const f0 = await page.evaluate(() => window.__game.info().frame);
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await page.waitForTimeout(args.record);
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      const f1 = await page.evaluate(() => window.__game.info().frame);
      const frames = Math.max(1, f1 - f0);
      const out = { self: new Map(), owner: new Map(), total: 0 };
      walk(profile.head, [], out);
      const kb = (b) => +(b / frames / 1024).toFixed(2);
      const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, args.top).map(([k, v]) => ({ kbPerFrame: kb(v), fn: k }));
      const res = { demo: name, frames, kbPerFrame: kb(out.total), byOwner: top(out.owner), bySelf: top(out.self) };
      writeFileSync(resolve(root, `shots/perf/alloc-${name}.json`), JSON.stringify(res, null, 1));
      console.log(`\n[alloc] ${name}: ${res.kbPerFrame} KB/frame over ${frames} frames`);
      for (const r of res.byOwner) console.log(`  ${String(r.kbPerFrame).padStart(7)} KB  ${r.fn}`);
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
