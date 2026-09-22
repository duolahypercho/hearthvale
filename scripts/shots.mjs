#!/usr/bin/env node
/**
 * Capture a batch of demo shots in parallel (default: the core farm demos).
 *   node scripts/shots.mjs                      → shots/<demo>.png for the default set
 *   node scripts/shots.mjs farm-night farm-pond → just those
 *   JOBS=2 node scripts/shots.mjs               → limit concurrency
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT = ['farm-morning', 'farm-evening', 'farm-night', 'farm-fall', 'farm-winter', 'farm-pond', 'farm-field', 'farm-rain'];
const demos = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const jobs = Number(process.env.JOBS || 4);

function run(demo) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [resolve(root, 'scripts/shot.mjs'), '--url', `?demo=${demo}`, '--out', `shots/${demo}.png`], { cwd: root });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const errs = out.split('\n').filter((l) => /pageerror|failed|console\.error/.test(l));
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${demo}${errs.length ? '\n  ' + errs.join('\n  ') : ''}`);
      res(code);
    });
  });
}

const queue = [...demos];
let failed = 0;
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) if ((await run(queue.shift())) !== 0) failed++;
  }),
);
process.exit(failed ? 1 : 0);
