/**
 * Reel minigame simulation (pure: no DOM, no three.js — unit-tested by scripts/fishing-reel.test.mjs).
 *
 *   catch bar   hold to lift (gravity, soft top bounce, floor bounce)
 *   fish AI     per behaviour (mixed / smooth / dart / sinker / floater), scaled by difficulty
 *   progress    starts at 0.30; fills while the fish is inside the bar (slower for harder fish),
 *               drains outside it; ≥ 1 = caught, ≤ 0 = escaped
 *   slack line  a bar left resting on the floor (no input) goes slack after a beat and earns
 *               nothing — idle play can never land a fish, however low the fish swims
 *   treasure    shows up 1.5–3 s into the fight; hold it inside the bar to collect it (a real
 *               risk / reward choice: the fish keeps running while you chase the chest)
 *
 * Pacing targets (auto-pilot ≈ a strong player): commons ≈ 5–7 s, rares ≈ 10–15 s.
 */
import type { ReelView } from './fishing';

export type ReelBehavior = 'mixed' | 'smooth' | 'dart' | 'sinker' | 'floater';

export interface ReelState extends ReelView {
  difficulty: number;
  behavior: ReelBehavior;
  barV: number;
  fishTarget: number;
  retarget: number;
  t: number;
  /** Autopilot (demos / tests): chase the fish with a little lag. */
  auto: boolean;
  /** Seconds the fish spent inside the bar (quality = how well you fought, not dice). */
  insideT: number;
  /** No progress is lost before this many seconds (time to find the fish). */
  grace: number;
  /** Seconds the bar has lain idle on the floor. */
  restT: number;
  /** Minimum progress reached (for "it nearly got away" flavour). */
  low: number;
}

/** Catch-bar physics (track units / s²; the track is 1 tall). */
export const REEL = {
  lift: 3.6,
  gravity: 3.0,
  vmax: 2.0,
  topBounce: 0.35,
  floorBounce: 0.42,
  start: 0.3,
  /** Seconds idle on the floor before the line goes slack. */
  slackAfter: 0.45,
  gain: (d: number): number => 0.16 - 0.09 * d,
  loss: (d: number): number => 0.15 + 0.1 * d,
};

export type Rand = () => number;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function newReel(o: { difficulty: number; behavior: ReelBehavior; barH: number; treasureOdds: number; rand: Rand; auto?: boolean; grace?: number }): ReelState {
  const r = o.rand;
  const fish = 0.35 + r() * 0.3;
  return {
    difficulty: o.difficulty,
    behavior: o.behavior,
    // Start with the bar around the fish so the fight opens fair.
    bar: clamp(fish - o.barH * 0.5, 0, 1 - o.barH),
    barH: o.barH,
    barV: 0,
    fish,
    fishV: 0,
    fishTarget: 0.5,
    retarget: 0.45,
    progress: REEL.start,
    // The chest appears 1.5–3 s in (negative prog = countdown).
    treasure: r() < o.treasureOdds ? { pos: 0.15 + r() * 0.7, prog: -(1.5 + r() * 1.5), got: false } : null,
    holding: false,
    inside: false,
    perfect: true,
    bounce: 0,
    slack: false,
    t: 0,
    auto: !!o.auto,
    insideT: 0,
    grace: o.grace ?? 0.6,
    restT: 0,
    low: REEL.start,
  };
}

/** Next swim target for the fish (and how long until it picks another). */
function retarget(s: ReelState, r: Rand): void {
  const d = s.difficulty;
  const x = r();
  let tgt: number;
  switch (s.behavior) {
    case 'smooth':
      tgt = clamp(s.fish + (r() - 0.5) * 0.5, 0.08, 0.95);
      s.retarget = 0.9 + r() * 1.2 - d * 0.5;
      break;
    case 'dart':
      // Sudden dashes across the track, then a breather (so a dash is readable and catchable).
      tgt = x < 0.45 ? r() * 0.3 + (s.fish > 0.5 ? 0.1 : 0.6) : clamp(s.fish + (r() - 0.5) * 0.3, 0.08, 0.95);
      s.retarget = 0.55 + r() * 0.9 - d * 0.25;
      break;
    case 'sinker':
      // Hugs the lower half, but never lies on the floor and rises now and then (≥ 30 % of picks).
      tgt = x < 0.3 ? 0.4 + r() * 0.45 : 0.12 + Math.pow(r(), 1.6) * 0.5;
      s.retarget = 0.6 + r() * 1.1 - d * 0.35;
      break;
    case 'floater':
      tgt = x < 0.3 ? 0.15 + r() * 0.45 : 0.95 - Math.pow(r(), 1.6) * 0.5;
      s.retarget = 0.6 + r() * 1.1 - d * 0.35;
      break;
    default:
      tgt = 0.1 + r() * 0.85;
      s.retarget = 0.5 + r() * 1.0 - d * 0.3;
  }
  s.fishTarget = tgt;
  s.retarget = Math.max(0.2, s.retarget);
}

export interface ReelStepOpts {
  /** Freeze progress / treasure (screenshot demos): the bar and fish still move. */
  frozen?: boolean;
  /** Called when the treasure is collected. */
  onTreasure?: () => void;
}

/**
 * Advance the fight by dt seconds (sub-stepped at 120 Hz). `holdInput` = the use button is held
 * (ignored on autopilot). Returns 'caught' / 'escaped' when the fight ends, else null.
 */
export function stepReel(s: ReelState, dt: number, holdInput: boolean, rand: Rand, o: ReelStepOpts = {}): 'caught' | 'escaped' | null {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  const d = s.difficulty;
  for (let i = 0; i < steps; i++) {
    s.t += h;
    const hold = s.auto ? autoHold(s) : holdInput;
    s.holding = hold;
    s.barV += (hold ? REEL.lift : -REEL.gravity) * h;
    s.barV = clamp(s.barV, -REEL.vmax, REEL.vmax);
    s.bar += s.barV * h;
    if (s.bar < 0) {
      if (s.barV < -0.4) s.bounce = Math.min(1, -s.barV * 0.5);
      s.bar = 0;
      s.barV = -s.barV * REEL.floorBounce;
      if (s.barV < 0.12) s.barV = 0;
    }
    if (s.bar > 1 - s.barH) {
      s.bar = 1 - s.barH;
      if (s.barV > 0) s.barV = -s.barV * REEL.topBounce;
    }
    s.bounce = Math.max(0, s.bounce - h * 5);
    // Slack: the bar lying idle on the floor stops earning (an AFK rod can't land anything).
    if (!hold && s.bar <= 0.002 && Math.abs(s.barV) < 0.35) s.restT += h;
    else s.restT = 0;
    s.slack = s.restT > REEL.slackAfter;

    // Fish AI.
    s.retarget -= h;
    if (s.retarget <= 0) retarget(s, rand);
    const k = 5 + d * 22 * (s.behavior === 'dart' ? 1.2 : s.behavior === 'smooth' ? 0.6 : 1);
    s.fishV += (s.fishTarget - s.fish) * k * h;
    s.fishV *= Math.exp(-h * (4.2 - d * 1.6));
    s.fishV += Math.sin(s.t * (7 + d * 9)) * d * 0.9 * h; // jitter
    s.fish = clamp(s.fish + s.fishV * h, 0.02, 0.98);
    if (s.fish <= 0.02 || s.fish >= 0.98) s.fishV *= -0.3;
    s.inside = s.fish >= s.bar - 0.01 && s.fish <= s.bar + s.barH + 0.01;
    const earning = s.inside && !s.slack;
    if (earning) s.insideT += h;
    if (!o.frozen) {
      if (earning) s.progress += REEL.gain(d) * h;
      else if (s.t >= s.grace) {
        s.progress -= REEL.loss(d) * h;
        s.perfect = false;
      }
      s.low = Math.min(s.low, s.progress);
      const tr = s.treasure;
      if (tr && !tr.got) {
        if (tr.prog < 0) tr.prog = Math.min(0, tr.prog + h);
        else {
          const inT = tr.pos >= s.bar && tr.pos <= s.bar + s.barH;
          tr.prog = Math.max(0, tr.prog + (inT ? 0.75 : -0.35) * h);
          if (tr.prog >= 1) {
            tr.got = true;
            o.onTreasure?.();
          }
        }
      }
      if (s.progress >= 1) {
        s.progress = 1;
        return 'caught';
      }
      if (s.progress <= 0) {
        s.progress = 0;
        return 'escaped';
      }
    }
  }
  return null;
}

/** Is the treasure chest on screen yet? */
export function treasureVisible(s: ReelState): boolean {
  return !!s.treasure && !s.treasure.got && s.treasure.prog >= 0 && s.t > 0.2;
}

/** Autopilot: a PD controller that keeps the bar centred a beat ahead of the fish. */
export let AUTO_GAINS = { lead: 0.15, damp: 0.18 };
function autoHold(s: ReelState): boolean {
  const want = s.fish + s.fishV * AUTO_GAINS.lead;
  const err = want - (s.bar + s.barH * 0.5);
  return err - s.barV * AUTO_GAINS.damp > 0;
}
