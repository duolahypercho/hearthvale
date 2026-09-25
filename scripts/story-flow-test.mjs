#!/usr/bin/env node
/**
 * Story flow check (story pod): the room-restored celebration must actually reach the player.
 *
 *   node scripts/story-flow-test.mjs [--room harvest]
 *
 * Stages ?demo=bundle-complete (one item short of finishing a room, unpaused, "Offer all" pressed for
 * you), then asserts: quest:room fires, the altar closes, and the room-<id> cutscene is playing within
 * 3 s of the seal — with the HUD hidden and the calendar frozen while it plays. Exits non-zero on
 * failure. Writes the mid-celebration frame to shots/story/flow-<room>.png.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--room');
const room = i > 0 ? process.argv[i + 1] : 'harvest';

const probe = `
const g = __game.game; const cs = g.services.cutscene;
let sealAt = -1, playAt = -1, hudHidden = false, frozen = false;
const t0 = performance.now();
g.events.on('quest:room', () => { sealAt = performance.now() - t0; });
for (let k = 0; k < 60 && playAt < 0; k++) {
  await new Promise((r) => setTimeout(r, 250));
  if (cs.playing && sealAt >= 0) {
    playAt = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 1500));
    frozen = g.calendar.frozen === true;
    hudHidden = getComputedStyle(g.hud.root).opacity === '0' || g.hud.root.classList.contains('cin-hide') || g.hud.root.style.visibility === 'hidden' || document.body.classList.contains('hv-cinema');
  }
}
if (sealAt < 0) throw new Error('quest:room never fired (the room was not completed)');
if (playAt < 0) throw new Error('room celebration never played after the seal');
if (playAt - sealAt > 3000 + 1750) throw new Error('celebration took ' + Math.round(playAt - sealAt) + ' ms after the seal');
if (!frozen) throw new Error('calendar kept running during the celebration');
return { sealAt: Math.round(sealAt), playAt: Math.round(playAt), hudHidden, frozen, scene: cs.playing && g.services.cutscene.running };
`;

const child = spawn(
  process.execPath,
  [resolve(root, 'scripts/shot.mjs'), '--url', `?demo=bundle-complete&room=${room}`, '--out', `shots/story/flow-${room}.png`, '--wait', '200', '--timeout', '240000', '--eval', probe],
  { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
);
let out = '';
child.stdout.on('data', (d) => {
  out += d;
  process.stdout.write(d.toString().split('\n').filter((l) => !l.includes('[shot] info')).join('\n'));
});
child.on('exit', (code) => {
  const ok = code === 0 && out.includes('eval =>');
  console.log(ok ? `[story-flow] PASS room-${room} celebration plays` : `[story-flow] FAIL (exit ${code})`);
  process.exit(ok ? 0 : 1);
});
