import { chromium } from 'playwright';
import { createServer } from 'vite';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = '/Users/ziwenxu/Desktop/Code/hearthvale';
const demo = process.argv[2] || 'coop-farm';
const vite = await createServer({ root, logLevel: 'error', cacheDir: resolve(tmpdir(), 'hv-prog-' + process.pid), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await vite.listen();
const port = vite.httpServer.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.goto(`http://127.0.0.1:${port}/?demo=${demo}`, { timeout: 400000 });
await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 400000 });
await page.evaluate(() => window.__game.ready());
await new Promise((r) => setTimeout(r, 3000));
const out = await page.evaluate(async () => {
  const g = window.__game.game;
  let proto = null;
  g.scene.traverse((o) => { if (!proto && o.material && !Array.isArray(o.material)) proto = o.material; });
  while (proto && Object.getPrototypeOf(proto) && Object.getPrototypeOf(proto).constructor.name !== 'Object') { if (Object.prototype.hasOwnProperty.call(proto, 'customProgramCacheKey') && proto.constructor.name === 'Material') break; proto = Object.getPrototypeOf(proto); }
  const M = proto;
  const orig = M.customProgramCacheKey;
  const counts = new Map();
  let frames = 0;
  M.customProgramCacheKey = function () {
    const k = `${this.type}|${this.name}|${this.userData?.perfTag ?? ''}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    return orig.call(this);
  };
  // also catch subclasses overriding it
  const seen = new Set();
  g.scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      if (seen.has(m)) continue; seen.add(m);
      if (Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey')) {
        const f = m.customProgramCacheKey; const tag = o.userData?.perfTag ?? o.parent?.userData?.perfTag ?? o.name;
        m.customProgramCacheKey = function () { const k = `OWN ${this.type}|${this.name}|${tag}`; counts.set(k, (counts.get(k) || 0) + 1); return f.call(this); };
      }
    }
  });
  const start = g.frame;
  await new Promise((r) => setTimeout(r, 4000));
  frames = g.frame - start;
  return { protoName: M.constructor.name, frames, top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(v / frames).toFixed(2)}/frame ${k}`) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); await vite.close();
