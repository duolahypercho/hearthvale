#!/usr/bin/env node
/**
 * Motion reel — plate capture. Stages each shot from a demo, freezes the rAF loop, then
 * frame-steps the game at 60 fps while driving a scripted camera move, writing clean
 * (HUD-free) canvas frames to shots/reel/plates/<shot>/NNNN.jpg.
 *
 *   node scripts/reel/capture.mjs [--preview] [--only hero,spring]
 */
import { startServer, launchGpu, root } from './lib.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const FPS = 60;
const argv = process.argv.slice(2);
const preview = argv.includes('--preview');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? argv[onlyIdx + 1].split(',') : null;

// Camera moves are deltas from the demo's own camera, eased over the clip.
// time: override hour; pause: keep sim frozen (ToD set must hold its hour).
const TOWN_PATH = { dyaw: [-10, 6], dpitch: [4, -2], ddist: [4, -3], dox: [-1.5, 1.5] };
export const SHOTS = [
  { id: 'hero', demo: 'farm-morning', dur: 4.4, cam: { dyaw: [-26, 4], dpitch: [18, 0], ddist: [22, -3], doz: [-2, 0] }, ease: 'out' },
  { id: 'spring', demo: 'farm-morning', dur: 4.4, cam: { dyaw: [-6, 6], ddist: [2, -2], dox: [-2, 1] } },
  { id: 'summer', demo: 'farm-noon', dur: 4.4, cam: { dyaw: [-6, 6], ddist: [2, -2], dox: [-2, 1] } },
  { id: 'fall', demo: 'farm-fall', dur: 4.4, cam: { dyaw: [-6, 6], ddist: [2, -2], dox: [-2, 1] } },
  { id: 'winter', demo: 'farm-winter', dur: 4.4, cam: { dyaw: [-6, 6], ddist: [2, -2], dox: [-2, 1] } },
  { id: 'tod-1', demo: 'town-day', time: 8.6, pause: true, dur: 4.4, cam: TOWN_PATH },
  { id: 'tod-2', demo: 'town-day', time: 13.2, pause: true, dur: 4.4, cam: TOWN_PATH },
  { id: 'tod-3', demo: 'town-day', time: 18.8, pause: true, dur: 4.4, cam: TOWN_PATH },
  { id: 'tod-4', demo: 'town-day', time: 21.6, pause: true, dur: 4.4, cam: TOWN_PATH },
  { id: 'pop', demo: 'farm-pop', dur: 1.4, cam: { ddist: [-1.2, 0.4], dyaw: [-3, 3] }, ease: 'out' },
  { id: 'water', demo: 'farm-water', dur: 1.4, cam: { ddist: [-1.2, 0.4], dyaw: [3, -3] }, ease: 'out' },
  { id: 'harvest', demo: 'farm-harvest', dur: 1.4, cam: { ddist: [-3, 1], dyaw: [-4, 2] }, ease: 'out' },
  { id: 'crops', demo: 'farm-crops', dur: 1.4, cam: { ddist: [-2, 1], dyaw: [5, -2] }, ease: 'out' },
  { id: 'beach', demo: 'beach-sunset', dur: 1.4, cam: { dyaw: [-8, 4], ddist: [3, 0] } },
  { id: 'reel', demo: 'fishing-reel', dur: 1.4, cam: { dyaw: [6, -4], ddist: [-1, 1] } },
  { id: 'storm', demo: 'storm', dur: 1.4, cam: { dyaw: [-6, 4], ddist: [2, -1] } },
  { id: 'snow', demo: 'snow-falls', dur: 1.4, cam: { dyaw: [6, -4], ddist: [2, -1] } },
  { id: 'forestnight', demo: 'forest-night', dur: 3.6, cam: { dyaw: [-8, 8], ddist: [2, -2] } },
  { id: 'rainbow', demo: 'rainbow', dur: 3.6, cam: { dyaw: [6, -6], ddist: [2, -2] } },
  { id: 'housenight', demo: 'house-night', dur: 3.6, cam: { dyaw: [-8, 8], ddist: [1, -1] } },
  { id: 'fog', demo: 'fog-morning', dur: 3.6, cam: { dyaw: [-6, 6], ddist: [2, -2] } },
  { id: 'beachnight', demo: 'beach-night', dur: 3.6, cam: { dyaw: [6, -6], ddist: [2, -2] } },
  { id: 'towneve', demo: 'town-evening', dur: 3.6, cam: { dyaw: [-6, 6], ddist: [2, -2] } },
  { id: 'forestfall', demo: 'forest-fall', dur: 3.6, cam: { dyaw: [6, -6], ddist: [2, -2] } },
  { id: 'festival', demo: 'festival', dur: 8.6, cam: { dyaw: [-10, 4], ddist: [4, -4], dpitch: [4, -2] } },
];

async function main() {
  const { server, port } = await startServer();
  const browser = await launchGpu();
  const outRoot = resolve(root, 'shots/reel', preview ? 'preview' : 'plates');
  try {
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.id)) continue;
      const t0 = Date.now();
      const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
      page.on('pageerror', (e) => console.error(`[${shot.id}] pageerror`, e.message));
      await page.goto(`http://127.0.0.1:${port}/?demo=${shot.demo}&quality=high`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 120000 });
      await page.evaluate(() => window.__game.ready());
      await page.evaluate(() => document.fonts?.ready);
      await page.evaluate((shot) => {
        const api = window.__game;
        const g = api.game;
        g.rc.governor.pace = () => false; // the reel owns the clock now
        if (shot.time != null) api.setTime(shot.time);
        g.setPaused(!!shot.pause);
        g.cinematic = true;
        g.scene ??= g.rc.scene;
        g.rc.scene.traverse((o) => {
          if (o.name?.startsWith('tile-cursor')) Object.defineProperty(o, 'visible', { get: () => false, set: () => {} });
        });
        const r = g.rc.rig;
        window.__base = { yaw: r.yaw, pitch: r.pitch, distance: r.distance, ox: r.lookOffset.x, oz: r.lookOffset.z };
        // let the (possibly unpaused) world settle a moment so NPCs / particles are mid-motion
        for (let i = 0; i < 45; i++) g.step(1 / 60);
      }, shot);
      const dir = resolve(outRoot, shot.id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const n = Math.round(shot.dur * FPS);
      const pick = preview ? [0, Math.floor(n / 2), n - 1] : null;
      for (let i = 0; i < n; i++) {
        const want = !pick || pick.includes(i);
        const url = await page.evaluate(
          ({ shot, u, want }) => {
            const g = window.__game.game;
            const b = window.__base;
            const e = shot.ease === 'out' ? 1 - Math.pow(1 - u, 3) : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
            const lerp = (k) => (shot.cam[k] ? shot.cam[k][0] + (shot.cam[k][1] - shot.cam[k][0]) * e : 0);
            const r = g.rc.rig;
            r.yaw = b.yaw + lerp('dyaw');
            r.pitch = b.pitch + lerp('dpitch');
            r.distance = b.distance + lerp('ddist');
            r.lookOffset.x = b.ox + lerp('dox');
            r.lookOffset.z = b.oz + lerp('doz');
            r.target.copy(g.player.position);
            r.snap();
            g.step(1 / 60);
            return want ? g.rc.renderer.domElement.toDataURL('image/jpeg', 0.93) : null;
          },
          { shot, u: n > 1 ? i / (n - 1) : 0, want },
        );
        if (url) writeFileSync(resolve(dir, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      }
      console.log(`[reel] ${shot.id}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await page.context().close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('capture.mjs')) main().catch((e) => { console.error(e); process.exit(1); });
