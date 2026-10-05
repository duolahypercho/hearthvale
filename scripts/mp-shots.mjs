#!/usr/bin/env node
/**
 * Co-op shot batch: ONE Vite + ONE headless browser for a list of stills (cheaper than N shot.mjs runs
 * on a shared GPU). Each job is `out|url|eval|wait` on its own line in a jobs file, or the default set:
 *
 *   node scripts/mp-shots.mjs                     → shots/mp/<demo>.png for the co-op demos
 *   node scripts/mp-shots.mjs --jobs jobs.txt     → custom jobs (lines: out|?demo=..|<js>|<waitMs>)
 *   node scripts/mp-shots.mjs --only coop-chat    → one of the defaults
 *
 * Prints __game.info().perf (draws / tris / fps) per shot.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = { w: 1920, h: 1080, jobs: '', only: '', dir: 'shots/mp' };
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) a[av[i].slice(2)] = av[i + 1] && !av[i + 1].startsWith('--') ? av[++i] : 'true';

const DEFAULT = [
  ['coop-farm.png', '?demo=coop-farm', '', 2500],
  ['coop-chat.png', '?demo=coop-chat', '', 3000],
  ['coop-emote.png', '?demo=coop-emote', '', 3000],
  ['coop-bedtime.png', '?demo=coop-bedtime', '', 2500],
  ['coop-dayend.png', '?demo=coop-dayend', '', 3500],
  ['coop-lobby.png', '?demo=coop-lobby', '', 3000],
];
let jobs = DEFAULT;
if (a.jobs) {
  jobs = readFileSync(resolve(root, a.jobs), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [out, url, ev, wait] = l.split('|');
      return [out.trim(), url.trim(), (ev ?? '').trim(), Number(wait) || 2500];
    });
}
if (a.only) jobs = jobs.filter((j) => j[0].startsWith(a.only));
const outDir = resolve(root, a.dir);
mkdirSync(outDir, { recursive: true });

const guard = setTimeout(() => {
  console.error('[mp-shots] global timeout');
  process.exit(3);
}, 20 * 60 * 1000);

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', clearScreen: false, cacheDir: resolve(tmpdir(), 'hv-mpshots-vite'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/shots/**', '**/dist/**', '**/node_modules/**', '**/.git/**'] } } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: +a.w, height: +a.h }, deviceScaleFactor: 1 });
let bad = 0;
for (const [out, url, ev, wait] of jobs) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  try {
    const t0 = Date.now();
    await page.goto(base + url, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 300000 });
    await page.evaluate(() => window.__game.ready());
    await page.evaluate(() => document.fonts?.ready);
    if (ev) {
      const r = await page.evaluate(`(async () => { ${ev} })()`);
      if (r !== undefined) console.log(`  eval => ${JSON.stringify(r)}`);
    }
    await page.waitForTimeout(wait);
    await page.screenshot({ path: resolve(outDir, out), timeout: 120000 });
    const perf = await page.evaluate(() => {
      const p = window.__game.info().perf;
      return `${p.drawCalls} draws · ${(p.triangles / 1e6).toFixed(2)} M tris · ${p.frame?.fps ?? '?'} fps · p95 ${p.frame?.frameP95Ms ?? '?'} ms`;
    });
    console.log(`ok   ${out}  (${((Date.now() - t0) / 1000).toFixed(0)} s)  ${perf}${errs.length ? '\n  errors: ' + errs.slice(0, 4).join(' | ') : ''}`);
    if (errs.length) bad++;
  } catch (e) {
    bad++;
    console.log(`FAIL ${out}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
await server.close();
clearTimeout(guard);
process.exit(bad ? 1 : 0);
