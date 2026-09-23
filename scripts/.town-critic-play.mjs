import { createServer } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = '/Users/ziwenxu/Desktop/Code/hearthvale';
const D = root + '/shots/town-critic-r1/';
const cacheDir = resolve(tmpdir(), `hv-town-critic-${process.pid}`);
const server = await createServer({ root, configFile: root + '/vite.config.ts', logLevel: 'error', cacheDir, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
page.setDefaultTimeout(300000);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const shot = async (n) => { await page.screenshot({ path: D + n + '.png', timeout: 300000 }); console.log('wrote', n); };
const ev = (f, a) => page.evaluate(f, a);
const log = (k, v) => console.log(k, JSON.stringify(v));
try {
  await page.goto(`http://127.0.0.1:${port}/?map=town&x=30&z=27&time=16.5&season=spring&weather=sun`, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function');
  await ev(() => window.__game.ready());
  await page.waitForTimeout(2000);
  const EVT = process.env.EVT || 'marigold-2';
  await ev(() => window.__game.game.services.relationships.adjust(process_evt_dummy = 0, 0)).catch(() => {});
  await ev((id) => { const g = window.__game.game; g.services.relationships.adjust(id.split('-')[0], 1500); void g.services.npcs.playEvent(id); }, EVT);
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(2200);
    await shot('hev-' + EVT + '-' + String(i).padStart(2, '0'));
    const st = await ev(() => ({ panel: window.__game.game.hud.openPanelName, choices: document.querySelectorAll('[class*=choice] button, [class*=choice] li, .dlg-choice').length }));
    log('st' + i, st);
    if (st.choices) await page.keyboard.press('Digit1'); else await page.keyboard.press('Space');
    await page.waitForTimeout(250); await page.keyboard.press('Space');
  }
  log('seen', await ev(() => window.__game.game.services.npcs.seenEvents()));
  log('pts', await ev((id) => window.__game.game.services.relationships.points(id.split('-')[0]), EVT));
} catch (e) { console.error('FAIL', e.message); }
for (const e of errs) console.error('[err]', e);
await browser.close(); await server.close(); process.exit(0);
