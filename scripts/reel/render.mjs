#!/usr/bin/env node
/**
 * Motion reel — compositor render. Drives scripts/reel/comp.html frame by frame (60 fps) and
 * pipes JPEG frames into ffmpeg, then muxes shots/reel/music.wav.
 *
 *   node scripts/reel/render.mjs                    -> shots/reel/hearthvale-reel.mp4
 *   node scripts/reel/render.mjs --stills 1,3.2,9.5 -> shots/reel/stills/t<sec>.jpg (spot checks)
 */
import { startServer, launchGpu, root } from './lib.mjs';
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const FPS = 60, DUR = 30;
const argv = process.argv.slice(2);
const stillsIdx = argv.indexOf('--stills');
const stills = stillsIdx >= 0 ? argv[stillsIdx + 1].split(',').map(Number) : null;

const platesDir = resolve(root, 'shots/reel/plates');
const counts = {};
for (const d of readdirSync(platesDir)) {
  const n = readdirSync(resolve(platesDir, d)).filter((f) => f.endsWith('.jpg')).length;
  if (n) counts[d] = n;
}

const { server, port } = await startServer();
const browser = await launchGpu();
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
page.on('pageerror', (e) => console.error('[render] pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('[render] console', m.text()));
await page.goto(`http://127.0.0.1:${port}/scripts/reel/comp.html`, { waitUntil: 'load', timeout: 120000 });
const fontsOk = await page.evaluate((c) => window.boot(c), counts);
if (!fontsOk) console.warn('[render] display font did not load');

const grab = async (f) => {
  await page.evaluate((f) => window.renderFrame(f), f);
  const url = await page.evaluate(() => document.getElementById('c').toDataURL('image/jpeg', 0.96));
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};

try {
  if (stills) {
    const dir = resolve(root, 'shots/reel/stills');
    mkdirSync(dir, { recursive: true });
    for (const s of stills) {
      writeFileSync(resolve(dir, `t${s.toFixed(2)}.jpg`), await grab(Math.round(s * FPS)));
      console.log(`[render] still t=${s}`);
    }
  } else {
    const out = resolve(root, 'shots/reel/hearthvale-reel.mp4');
    const music = resolve(root, 'shots/reel/music.wav');
    const ff = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      ...(existsSync(music) ? ['-i', music] : []),
      '-map', '0:v', ...(existsSync(music) ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '256k'] : []),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-movflags', '+faststart', '-t', String(DUR), out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
    const t0 = Date.now();
    for (let f = 0; f < FPS * DUR; f++) {
      const buf = await grab(f);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 120 === 0) console.log(`[render] ${f}/${FPS * DUR}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await done;
    console.log(`[render] wrote ${out}`);
  }
} finally {
  await browser.close();
  await server.close();
}
