#!/usr/bin/env node
/**
 * Reel minigame regression tests (pure sim, runs in Node via type stripping — no browser):
 *   - idle play never lands a fish: every behaviour × difficulty, no input for 60 s → escaped
 *   - pacing: a human-like bot (100 ms late, 5 % sloppy) lands commons in ~5–10 s and
 *     most rares (fishing is forgiving: slow drain, roomy bar, long grace)
 *   - depth: a perfect PD bot can't coast through fish with signature moves (dash / dive / thrash)
 *   - the treasure chest never shows up before 1.5 s
 *
 *   node scripts/fishing-reel.test.mjs      (also run from npm test / scripts/smoke.mjs)
 */
import { newReel, stepReel, REEL } from '../src/ui/fishing-reel.ts';

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BEHAVIORS = ['mixed', 'smooth', 'dart', 'sinker', 'floater'];
const barFor = (d) => 0.32 - d * 0.04;

/** Run a fight at 60 fps; returns { end, t }. */
function fight({ d, behavior, seed, auto, hold = () => false, maxT = 60 }) {
  const rand = mulberry32(seed);
  const s = newReel({ difficulty: d, behavior, barH: barFor(d), treasureOdds: 0, rand, auto });
  const dt = 1 / 60;
  for (let t = 0; t < maxT; t += dt) {
    const end = stepReel(s, dt, hold(s, t), rand);
    if (end) return { end, t: s.t, s };
  }
  return { end: null, t: s.t, s };
}

export function runReelTests(log = console.log) {
  const fails = [];
  // 1. AFK: no input at all must never catch (and must actually end).
  for (const behavior of BEHAVIORS) {
    for (const d of [0.2, 0.6, 0.9]) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = fight({ d, behavior, seed: seed * 7919 + Math.round(d * 100), auto: false });
        if (r.end !== 'escaped') fails.push(`idle ${behavior} d=${d} seed=${seed}: ${r.end ?? 'still going'} after ${r.t.toFixed(1)} s (progress ${r.s.progress.toFixed(2)})`);
      }
    }
  }
  // Tapping the floor forever (hold for 1 frame every 2 s) must not win either.
  for (const behavior of ['sinker', 'mixed']) {
    const r = fight({ d: 0.6, behavior, seed: 42, auto: false, hold: (_s, t) => t % 2 < 1 / 60 });
    if (r.end === 'caught') fails.push(`tap-idle ${behavior}: caught after ${r.t.toFixed(1)} s`);
  }
  // 2. Pacing with a human-like player: sees the fish 100 ms late, PD control, 5 % sloppy frames.
  const human = (seed) => {
    const hist = [];
    const r = mulberry32(seed + 99);
    return (s) => {
      hist.push([s.fish, s.fishV]);
      if (hist.length > 6) hist.shift();
      const [f, v] = hist[0];
      let h = f + v * 0.15 - (s.bar + s.barH * 0.5) - s.barV * 0.2 > 0;
      if (r() < 0.05) h = !h;
      return h;
    };
  };
  const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const rows = [];
  // [label, difficulty, behaviour, median band (s), max losses of 12]
  for (const [label, d, behavior, lo, hi, maxLost] of [
    ['common', 0.2, 'smooth', 4, 8.5, 0],
    ['common', 0.25, 'mixed', 4.5, 8.5, 0],
    ['common', 0.3, 'dart', 6, 14, 1],
    ['uncommon', 0.45, 'dart', 8, 45, 2],
    ['rare', 0.6, 'sinker', 9, 40, 3],
    ['rare', 0.6, 'mixed', 11, 45, 3],
    ['v.rare', 0.78, 'sinker', 12, 50, 5],
  ]) {
    const times = [];
    let lost = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = fight({ d, behavior, seed: seed * 104729, auto: false, hold: human(seed) });
      if (r.end === 'caught') times.push(r.t);
      else lost++;
    }
    const m = times.length ? median(times) : Infinity;
    rows.push(`${label.padEnd(9)} d=${d} ${behavior.padEnd(7)} median ${m.toFixed(1)} s  (${times.length}/12 landed)`);
    if (times.length && !(m >= lo && m <= hi)) fails.push(`pacing ${label} d=${d} ${behavior}: median ${m.toFixed(1)} s outside ${lo}-${hi} s`);
    if (lost > maxLost) fails.push(`pacing ${label} d=${d} ${behavior}: lost ${lost}/12 (max ${maxLost})`);
  }
  // Depth: a lag-free PD controller (a bot that never blinks) must NOT sail through fish with a
  // signature move — dashes outrun the lv-0 bar, so perfect fights are earned, not automatic —
  // but it still lands them.
  const pd = (s) => s.fish + s.fishV * 0.15 - (s.bar + s.barH * 0.5) - s.barV * 0.18 > 0;
  for (const [d, behavior] of [[0.3, 'dart'], [0.4, 'mixed'], [0.45, 'sinker']]) {
    let perfect = 0;
    let landed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = fight({ d, behavior, seed: seed * 7727, auto: false, hold: pd });
      if (r.end === 'caught') landed++;
      if (r.end === 'caught' && r.s.perfect) perfect++;
    }
    rows.push(`pd-bot    d=${d} ${behavior.padEnd(7)} ${landed}/12 landed, ${perfect} perfect`);
    if (perfect > 6) fails.push(`depth d=${d} ${behavior}: a PD bot got ${perfect}/12 perfect fights (moves too easy)`);
    if (landed < 11) fails.push(`depth d=${d} ${behavior}: a PD bot only landed ${landed}/12`);
  }
  // The demo autopilot lands a common every time.
  for (let seed = 1; seed <= 6; seed++) {
    const r = fight({ d: 0.3, behavior: 'mixed', seed, auto: true });
    if (r.end !== 'caught') fails.push(`autopilot lost a common (seed ${seed})`);
  }
  // 3. Treasure delay.
  for (let seed = 1; seed <= 20; seed++) {
    const rand = mulberry32(seed);
    const s = newReel({ difficulty: 0.3, behavior: 'mixed', barH: barFor(0.3), treasureOdds: 1, rand, auto: true });
    let seenAt = -1;
    for (let i = 0; i < 400 && seenAt < 0; i++) {
      stepReel(s, 1 / 60, false, rand);
      if (s.treasure && s.treasure.prog >= 0) seenAt = s.t;
    }
    if (seenAt >= 0 && seenAt < 1.5 - 1e-6) fails.push(`treasure appeared at ${seenAt.toFixed(2)} s (< 1.5 s)`);
  }
  log(`reel sim: start ${REEL.start}, gain 0.15-0.08d, loss 0.09+0.07d, dash ${REEL.dashV}, tell ${REEL.tell} s\n  ${rows.join('\n  ')}`);
  return fails;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fails = runReelTests();
  for (const f of fails) console.log(`✗ ${f}`);
  console.log(fails.length ? `✗ ${fails.length} reel test(s) failed` : '✓ reel sim tests passed');
  process.exit(fails.length ? 1 : 0);
}
