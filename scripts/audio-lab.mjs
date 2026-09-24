#!/usr/bin/env node
/**
 * Audio lab: a persistent offline-render server for sound design iteration. Starts Vite and one
 * headless Chromium once, then renders on request (every request reloads the page, so edits under
 * src/audio are picked up without paying for a browser + dev-server start each time).
 *
 *   node scripts/audio-lab.mjs &            # listens on 127.0.0.1:5199 (AUDIO_LAB_PORT)
 *   curl 'localhost:5199/reel?names=hoe,axe'
 *   curl 'localhost:5199/theme?id=mine&secs=30&mix=1'
 *   curl 'localhost:5199/amb?p=farm-rain'
 *   curl 'localhost:5199/gameplay'
 *   curl 'localhost:5199/calibrate?ids=spring,mine&secs=60'   # rewrite src/audio/loudness.ts entries
 *   curl 'localhost:5199/quit'
 *
 * WAVs land in shots/audio-lab/. Analysis is the same code as scripts/audio-render.mjs.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { writeWav, analyze, row, HEADER, fmt, analyzeGameplay, printGameplay, calibrate } from './audio-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'shots/audio-lab');
mkdirSync(outDir, { recursive: true });
const port = Number(process.env.AUDIO_LAB_PORT ?? 5199);

const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  logLevel: 'error',
  clearScreen: false,
  cacheDir: resolve(tmpdir(), `hearthvale-vite-audiolab-${process.pid}`),
  server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: { ignored: (p) => !p.includes('/src/audio') && p !== root && !p.endsWith('/src') } },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let page;
const errors = [];
async function fresh() {
  if (page) await page.close().catch(() => {});
  if (!browser.isConnected()) browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => (m.type() === 'error' || /\[audio\]/.test(m.text())) && errors.push(m.text()));
  await page.route(`${base}/__audio__`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>audio</title>' }));
  await page.goto(`${base}/__audio__`, { waitUntil: 'load', timeout: 180000 });
  await page.evaluate(async () => {
    window.__audioOffline = await import(`/src/audio/offline.ts?t=${Date.now()}`);
    window.__audioOffline.setRenderOptions({ liveBudget: true });
  });
}
const decode = (res) => {
  const bytes = Buffer.from(res.data, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
};
const call = (fn, a) => page.evaluate(async ([fn, a]) => window.__audioOffline[fn](...a), [fn, a]);

async function handle(url) {
  const q = url.searchParams;
  const lines = [];
  const log = (s) => lines.push(s);
  errors.length = 0;
  await fresh();
  const t0 = Date.now();
  if (url.pathname === '/reel') {
    const names = q.get('names')?.split(',') ?? null;
    const res = await call('renderSfxReel', [44100, names]);
    const inter = decode(res);
    writeWav(resolve(outDir, 'reel.wav'), inter, res.sampleRate);
    const sr = res.sampleRate;
    log(`${'effect'.padEnd(16)}  peak   momMax  centHz  sub/bas/lm/pr/air`);
    for (let i = 0; i < res.markers.length; i++) {
      const m = res.markers[i];
      const end = res.markers[i + 1]?.t ?? m.t + 2;
      const a = analyze(new Float32Array(inter.subarray(Math.floor(m.t * sr) * 2, Math.floor(end * sr) * 2)), sr);
      const b = a.bands;
      log(`${m.name.padEnd(16)} ${fmt(a.peakDb).padStart(6)} ${fmt(a.lufsMomentaryMax).padStart(7)} ${fmt(a.centroidHz, 0).padStart(6)}  ${(b.sub * 100).toFixed(0)}/${(b.bass * 100).toFixed(0)}/${(b.lowmid * 100).toFixed(0)}/${(b.presence * 100).toFixed(0)}/${(b.air * 100).toFixed(0)}`);
    }
  } else if (url.pathname === '/theme' || url.pathname === '/amb') {
    const res = url.pathname === '/theme'
      ? await call('renderTheme', [q.get('id'), Number(q.get('secs') ?? 30), 44100, Number(q.get('seed') ?? 1), q.get('mix') === '1'])
      : await call('renderAmbience', [q.get('p'), Number(q.get('secs') ?? 30), 44100]);
    const inter = decode(res);
    writeWav(resolve(outDir, `${res.name}.wav`), inter, res.sampleRate);
    log(HEADER);
    log(row(res.name, analyze(inter, res.sampleRate), url.pathname === '/amb' ? 'amb' : 'theme'));
  } else if (url.pathname === '/gameplay') {
    const full = await call('renderGameplay', ['full']);
    const sfx = await call('renderGameplay', ['sfx']);
    const bed = await call('renderGameplay', ['bed']);
    const F = decode(full);
    writeWav(resolve(outDir, 'gameplay.wav'), F, full.sampleRate);
    const orig = console.log;
    console.log = (s) => log(s);
    try {
      printGameplay(analyzeGameplay(F, decode(sfx), decode(bed), full.sampleRate, full.markers));
    } finally {
      console.log = orig;
    }
  } else if (url.pathname === '/calibrate') {
    const ids = q.get('ids')?.split(',') ?? (await page.evaluate(() => window.__audioOffline.listThemes()));
    await calibrate(ids, call, { root, seconds: Number(q.get('secs') ?? 60), log });
  } else if (url.pathname === '/eval') {
    // Arbitrary expression against the offline module (returns JSON).
    const r = await page.evaluate(async (src) => JSON.stringify(await new Function('m', `return (async () => (${src}))()`)(window.__audioOffline)), q.get('js'));
    log(r);
  }
  log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (errors.length) log(`page errors:\n  ${errors.join('\n  ')}`);
  return lines.join('\n') + '\n';
}

let busy = Promise.resolve();
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/quit') {
    res.end('bye\n');
    void browser.close().then(() => server.close()).then(() => process.exit(0));
    return;
  }
  busy = busy.then(async () => {
    try {
      res.end(await handle(url));
    } catch (e) {
      res.statusCode = 500;
      res.end(`error: ${e?.stack ?? e}\n`);
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`audio lab on http://127.0.0.1:${port}`));
