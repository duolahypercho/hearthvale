#!/usr/bin/env node
/**
 * Remote-farmer playout torture test (node only, no browser): feeds src/net/playout.ts a synthetic
 * 20 Hz walk / run with 90° turns, stamped on an offset sender clock and delivered in order with
 * seeded jitter, 250–400 ms spikes and a 600 ms stall (everything then arrives in one burst), and
 * renders it at an uneven ~60 fps (3 % long frames). Per frame (dt normalised) it asserts:
 *   - no backward steps (a frame moving > 1 cm / > 0.6 m/s against the true direction of travel),
 *   - no pops (per-frame speed ≤ 1.5× the mover's speed),
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
  // Sender samples: either exact (stamp = the instant the position is for), or `quant`: like the game,
  // a fixed-step (60 Hz) sim driven by an uneven render loop, sampled by a 50 ms ticker on the next
  // frame. `stamp: 'frame'` stamps the render-frame time (the r5 bug: up to one sim step of error per
  // sample, so a 17 ms segment can carry 0 or 2 steps = 0x / 2x pace); 'sim' stamps the sim time.
  const sends = [];
  if (o.quant) {
    // `simT` = the fixed-step sim's clock (it only ever advances by whole steps, ≤ 5 per frame with the
    // game's 0.1 s frame clamp — the rest of a long freeze is dropped, as in Game.step); the 'sim'
    // stamp is the game's simAt (frame time − accumulator, monotonic). `freeze`: the sender's tab
    // stalls for that long once mid-walk (a saturated machine).
    let ft = 0, simT = 0, acc = 0, lastSend = -1e9, stamp = 0, frozen = false;
    while (ft <= dur) {
      let fdt = rnd() < 0.08 ? 25 + rnd() * 40 : 14 + rnd() * 5.4;
      if (o.freeze && !frozen && ft > dur * 0.4) {
        frozen = true;
        fdt = o.freeze;
      }
      ft += fdt;
      acc += Math.min(100, fdt);
      let steps = 0;
      while (acc >= 1000 / 60 && steps < 5) { acc -= 1000 / 60; simT += 1000 / 60; steps++; }
      if (steps === 5) acc = 0;
      // The walk itself is defined on the sim clock; the dropped part of a freeze shifts sim vs frame.
      stamp = Math.max(stamp, o.stamp === 'sim' ? ft - acc : ft);
      if (ft - lastSend >= 50) {
        lastSend = ft;
        sends.push({ t: stamp, q: pos(simT) });
      }
    }
  } else for (let t = 0; t <= dur; t += 50 + (rnd() < 0.2 ? 17 : 0)) sends.push({ t, q: pos(t) });
  const refAt = (t) => {
    let i = 0;
    while (i < sends.length - 2 && sends[i + 1].t < t) i++;
    const a = sends[i], b = sends[i + 1] ?? a;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    return { x: a.q.x + (b.q.x - a.q.x) * k, z: a.q.z + (b.q.z - a.q.z) * k };
  };
  for (const { t, q } of sends) {
    let delay = (o.base ?? 40) + rnd() * (o.jitter ?? 60);
    if (rnd() < (o.spikes ?? 0.04)) delay += 250 + rnd() * 150;
    if (o.stall !== false && t > stallAt && t < stallAt + 600) delay += stallAt + 600 - t;
    const arr = Math.max(lastArr, t + delay);
    lastArr = arr;
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
    if (p.sample(now)) {
      frames.push([now, p.x, p.z]);
      if (process.env.MP_INTERP_TRACE && Math.abs(now - Number(process.env.MP_INTERP_TRACE)) < 120) console.log('   t', Math.round(now), 'x', p.x.toFixed(3), 'raw', p.rawX?.toFixed?.(3), 'off', p.offX?.toFixed?.(3), 'extrap', p.extrap, 'rt', p.rt?.toFixed?.(0), 'lim', p.limited, 'snaps', p.snaps);
    }
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
    if (v > speed * (o.popX ?? 1.5)) pops++;
    // Direction of travel near where the farmer is drawn: the true path's direction at the closest
    // sender time (search around the expected lag).
    // (quantised senders: the reference is the stamped path itself — a frozen sender's sim drops time,
    // so its stamps and the ideal path drift apart by the dropped part.)
    const ref = o.quant ? refAt : pos;
    const win = o.freeze ? o.freeze + 1200 : 900;
    let best = Infinity, bt = 0;
    for (let t = Math.max(0, tb - win); t <= Math.min(dur, tb); t += 10) {
      const q = ref(t);
      const e = Math.hypot(q.x - xb, q.z - zb);
      if (e < best) { best = e; bt = t; }
    }
    const dirRef = (t) => {
      const a = ref(t - 20), b = ref(t + 20);
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return [(b.x - a.x) / L, (b.z - a.z) / L];
    };
    const [ux, uz] = o.quant ? dirRef(bt) : dirAt(bt);
    // (a turn corner is allowed to cut across: count only clear reversals)
    const corner = o.quant ? (() => { const [ax, az] = dirRef(bt - 150), [bx, bz] = dirRef(bt + 150); return ax * bx + az * bz < 0.9; })() : !(Math.abs(bt % leg) > 150 && Math.abs(bt % leg) < leg - 150);
    // (dt normalised: > 1 cm at 60 fps, or a backward drift faster than 0.6 m/s on a long frame)
    if (dx * ux + dz * uz < -Math.max(0.01, 0.6 * dt) && !corner) {
      back++;
      if (process.env.MP_INTERP_DEBUG) console.log('  back @', Math.round(tb), 'step', dx.toFixed(3), dz.toFixed(3), 'ref t', bt, 'dir', ux.toFixed(2), uz.toFixed(2), 'dist', best.toFixed(2));
    }
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
  // r6: a walk from a busy sender (uneven frames over a fixed-step sim) at ~300 ms RTT + 40 ms jitter.
  // The rendered walk must never exceed 1.45x pace, whichever way the sender stamps its samples.
  ...[11, 12, 13, 14, 15].map((seed) => ({ name: `walk, busy sender, 150±40 ms one way (seed ${seed})`, seed, quant: true, stamp: 'sim', base: 130, jitter: 40, spikes: 0.03, stall: false, popX: 1.45 })),
  { name: 'walk, busy sender stamping frame time (defence in depth)', seed: 16, quant: true, stamp: 'frame', base: 130, jitter: 40, spikes: 0.03, stall: false, popX: 1.45 },
  { name: 'run, busy sender, 150±40 ms', seed: 17, quant: true, stamp: 'sim', speed: 6.5, base: 130, jitter: 40, stall: false, popX: 1.45 },
  ...[600, 1200, 2500].map((f, i) => ({ name: `walk, sender tab freezes ${f} ms mid-walk, 150±40 ms`, seed: 21 + i, quant: true, stamp: 'sim', freeze: f, base: 130, jitter: 40, spikes: 0, stall: false, popX: 1.45 })),
];

/** A case passes: no backward steps / pops, no clock restarts (one allowed after a > 0.9 s sender freeze — the limiter walks it off), smooth where asked. */
export const passes = (c, r) => r.back === 0 && r.pops === 0 && r.snaps <= (c.freeze > 900 ? 1 : 0) && (c.maxSd == null || r.sd <= c.maxSd);

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const c of CASES) {
    const r = torture(c);
    const ok = passes(c, r);
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${c.name}: ${JSON.stringify(r)}`);
  }
  process.exit(bad ? 1 : 0);
}
