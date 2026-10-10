#!/usr/bin/env node
/**
 * Festival framing test: in every mini-game camera, no onlooker's head may cross the frame border
 * or a HUD panel rectangle (the crowd's framing guard, `FestivalMap.cropCheck()`), sampled three
 * times per mini-game while attract mode plays it.
 *
 *   node scripts/fest-crop-test.mjs [--out shots/festivals/crop]
 *
 * Runs one headless shot per demo (sequentially: one browser at a time) and exits non-zero if any
 * sample reports a cropped head. Long-running: start it in the background and poll the output.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : 'shots/festivals/crop';
const DEMOS = ['fest-spring-dance', 'fest-summer-lanterns', 'fest-fall-race', 'fest-fall-judging', 'fest-winter-gifts', 'fest-winter-skate'];
const SAMPLE = `const m = __game.game.world.current; const s = []; for (let k = 0; k < 3; k++) { await new Promise((r) => setTimeout(r, 1500)); s.push(m.cropCheck()); } return s;`;

let bad = 0;
for (const d of DEMOS) {
  const r = spawnSync('node', ['scripts/shot.mjs', '--url', `?demo=${d}`, '--out', `${out}/${d}.png`, '--wait', '400', '--eval', SAMPLE], { cwd: root, encoding: 'utf8', timeout: 150000 });
  const line = (r.stdout + r.stderr).split('\n').find((l) => l.startsWith('[shot] eval =>'));
  if (!line) {
    console.log(`✗ ${d}: no result (${r.status})`);
    bad++;
    continue;
  }
  const samples = JSON.parse(line.slice('[shot] eval =>'.length));
  const n = samples.reduce((a, s) => a + s.n, 0);
  const rects = Math.max(...samples.map((s) => s.rects));
  console.log(`${n ? '✗' : '✓'} ${d}: cropped heads ${samples.map((s) => s.n).join(' / ')} (HUD rects ${rects})`);
  if (n) bad++;
}
console.log(bad ? `FAIL: ${bad} demo(s) with cropped heads` : 'PASS: no cropped heads in any mini-game camera');
process.exit(bad ? 1 : 0);
