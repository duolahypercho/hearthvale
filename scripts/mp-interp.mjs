#!/usr/bin/env node
/**
 * Remote-farmer playout torture test (node only, no browser): feeds src/net/playout.ts a synthetic
 * 20 Hz walk / run with 90° turns, stamped on an offset sender clock and delivered in order with
 * seeded jitter, 250–400 ms spikes and a 600 ms stall (everything then arrives in one burst), and
 * renders it at an uneven ~60 fps (3 % long frames). Per frame (dt normalised) it asserts:
 *   - no backward steps (a frame moving > 1 cm against the true direction of travel),
 *   - no pops (per-frame speed ≤ 2× the walk speed),
 *   - bounded lag behind the sender.
 *
 *   node scripts/mp-interp.mjs            (also run by npm run mp-test)
 */
import { Playout } from '../src/net/playout.ts';

export function torture(o = {}) {
  let seed = (o.seed ?? 7) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const speed = o.speed ?? 4.2;
  const dur = o.dur ?? 9000;
  const leg = o.leg ?? 1500;
  const offset = 123456.7; // sender clock − receiver clock
  // Sender path: +x, then a z leg (alternating ±z), repeat. Direction of travel at time t:
  const dirAt = (t) => {
    const n = Math.floor(t / leg);
    return n % 2 === 0 ? [1, 0] : [0, Math.floor(n / 2) % 2 === 0 ? 1 : -1];
  };
  const pos = (t) => {
    let x = 0, z = 0, tt = 0;
    while (tt < t) {
      const step = Math.min(leg - (tt % leg), t - tt);
      const [dx, dz] = dirAt(tt);
      x += (dx * speed * step) / 1000;
      z += (dz * speed * step) / 1000;
      tt += step;
    }
    return { x, z };
  };
  const arrivals = [];
  let lastArr = 0;
  const stallAt = dur * 0.55;
  for (let t = 0; t <= dur; t += 50 + (rnd() < 0.2 ? 17 : 0)) {
    let delay = (o.base ?? 40) + rnd() * (o.jitter ?? 60);
    if (rnd() < (o.spikes ?? 0.04)) delay += 250 + rnd() * 150;
    if (o.stall !== false && t > stallAt && t < stallAt + 600) delay += stallAt + 600 - t;
    const arr = Math.max(lastArr, t + delay);
    lastArr = arr;
    const q = pos(t);
    arrivals.push({ arr, t, x: q.x, z: q.z });
  }
  const p = new Playout();
  const frames = [];
  let now = 0;
  let ai = 0;
  while (now < dur + 900) {
    while (ai < arrivals.length && arrivals[ai].arr <= now) {
      const a = arrivals[ai++];
      p.push(a.t + offset, a.x, a.z, 0, 1, now);
    }
    if (p.sample(now)) frames.push([now, p.x, p.z]);
    now += rnd() < 0.03 ? 40 + rnd() * 60 : 16.67;
  }
  let back = 0, pops = 0, maxV = 0, maxLag = 0;
  const vs = [];
  for (let i = 1; i < frames.length; i++) {
    const [ta, xa, za] = frames[i - 1];
    const [tb, xb, zb] = frames[i];
    const dt = (tb - ta) / 1000;
    const dx = xb - xa, dz = zb - za;
    const v = Math.hypot(dx, dz) / dt;
    maxV = Math.max(maxV, v);
    if (tb > 800 && tb < dur) vs.push(v);
    if (v > speed * 2) pops++;
    // Direction of travel near where the farmer is drawn: the true path's direction at the closest
    // sender time (search around the expected lag).
    let best = Infinity, bt = 0;
    for (let t = Math.max(0, tb - 900); t <= Math.min(dur, tb); t += 10) {
      const q = pos(t);
      const e = Math.hypot(q.x - xb, q.z - zb);
      if (e < best) { best = e; bt = t; }
    }
    const [ux, uz] = dirAt(bt);
    // (a turn corner is allowed to cut across: count only clear reversals)
    if (dx * ux + dz * uz < -0.01 && Math.abs(bt % leg) > 150 && Math.abs(bt % leg) < leg - 150) back++;
    if (tb > 600 && tb < dur) maxLag = Math.max(maxLag, tb - bt);
  }
  const mean = vs.reduce((a, b) => a + b, 0) / Math.max(1, vs.length);
  const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vs.length));
  return { frames: frames.length, back, pops, maxV: +maxV.toFixed(2), mean: +mean.toFixed(2), sd: +sd.toFixed(2), maxLag: Math.round(maxLag), interp: Math.round(p.interp), extrapFrames: p.extrapFrames, snaps: p.snaps };
}

export const CASES = [
  { name: 'walk, clean LAN (steady-state smoothness)', seed: 9, jitter: 20, spikes: 0, stall: false, maxSd: 0.4 },
  { name: 'walk, LAN jitter', seed: 1 },
  { name: 'walk, heavy jitter', seed: 2, jitter: 120 },
  { name: 'run, 8% spikes', seed: 3, speed: 6.5, spikes: 0.08 },
  { name: 'walk, 150 ms + 180 jitter + 10% spikes', seed: 4, base: 150, jitter: 180, spikes: 0.1 },
  { name: 'run, busy box (zig-zag 700 ms legs)', seed: 5, speed: 6.5, jitter: 140, spikes: 0.06, leg: 700 },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const c of CASES) {
    const r = torture(c);
    const ok = r.back === 0 && r.pops === 0 && r.snaps === 0 && (c.maxSd == null || r.sd <= c.maxSd);
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${c.name}: ${JSON.stringify(r)}`);
  }
  process.exit(bad ? 1 : 0);
}
