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
 *   signatures  every species telegraphs its moves (a 0.28 s shiver = `tell`), then:
 *                 dart     0.10–0.16 s burst dashes at 2.5 track/s — faster than the bar's 2.0 cap,
 *                          so a lv-0 bar only keeps up if you read the shiver and move first
 *                 sinker   heavy dives towards the floor (0.28 s at 1.5 track/s)
 *                 floater  sudden bolts for the surface
 *                 mixed    a dash in either direction (d ≥ 0.3)
 *               d ≥ 0.4 fish also `thrash` (0.4 s: the frame shakes, the fish jerks, progress bleeds
 *               even inside the bar); past 75 % progress the fish panics (moves come faster)
 *   sweet spot  a fish centred in the bar reels 1.12× (riding its edge: 0.76×)
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
  /** Seconds until the next signature move (dash / dive / bolt). */
  moveCd: number;
  /** Signature move: remaining tell (shiver) time, remaining burst time, burst velocity. */
  tellT: number;
  dashT: number;
  dashV: number;
  /** Thrash: cooldown and remaining time. */
  thrashCd: number;
  thrashT: number;
  /** Seconds spent outside the bar (after the grace period). */
  outT: number;
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
  /** Shiver before a signature move (s). */
  tell: 0.34,
  /** Dash velocity cap (track / s) — above the bar's vmax on purpose. */
  dashV: 2.5,
  thrash: 0.4,
  /** Total seconds outside the bar a fight may spend and still be Perfect. */
  perfectSlip: 0.25,
  /** Extra progress bleed per second while the fish thrashes. */
  thrashLoss: 0.07,
};

/** Seconds between signature moves for a behaviour at difficulty d (Infinity = none). */
function moveGap(b: ReelBehavior, d: number, r: Rand): number {
  const base = b === 'dart' ? 3.6 : b === 'sinker' ? 3.0 : b === 'floater' ? 3.2 : b === 'mixed' ? (d >= 0.3 ? 3.6 : Infinity) : d >= 0.5 ? 4 : Infinity;
  return base * (0.95 + d * 0.35) * (0.8 + r() * 0.6);
}

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
    moveCd: 1.1 + moveGap(o.behavior, o.difficulty, r) * 0.5,
    tellT: 0,
    dashT: 0,
    dashV: 0,
    thrashCd: o.difficulty >= 0.4 ? 2.2 + r() * 2 : Infinity,
    thrashT: 0,
    outT: 0,
    tell: 0,
    thrash: 0,
  };
}

/** Pick the direction / speed / length of the next signature move and start its tell. */
function startMove(s: ReelState, r: Rand): void {
  const b = s.behavior;
  let dir: number;
  let v = Math.min(REEL.dashV, (b === 'mixed' ? 1.6 : 1.8) + s.difficulty * (b === 'mixed' ? 1.2 : 1.4));
  let len = 0.1 + r() * 0.06;
  if (b === 'sinker') {
    dir = s.fish > 0.25 ? -1 : 1;
    v = 1.5;
    len = 0.28;
  } else if (b === 'floater') {
    dir = s.fish < 0.75 ? 1 : -1;
    v = 2.0;
    len = 0.2;
  } else {
    // Dash for the far side of the track (away from where the bar sits).
    const room = s.fish < 0.3 ? 1 : s.fish > 0.7 ? -1 : r() < 0.5 ? 1 : -1;
    dir = room;
  }
  s.tellT = REEL.tell;
  s.dashV = dir * v;
  s.dashT = len;
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

    // Fish AI: signature move (tell → burst), else a spring towards the swim target.
    const panic = s.progress > 0.75 ? 1.6 : 1;
    if (s.tellT <= 0 && s.dashT <= 0) {
      s.moveCd -= h * panic;
      if (s.moveCd <= 0 && s.t > s.grace) startMove(s, rand);
    }
    if (s.tellT > 0) {
      // The shiver: the fish holds still and trembles (readable in the reel UI as `tell`).
      s.tellT -= h;
      s.fishV *= Math.exp(-h * 14);
      s.fishV += Math.sin(s.t * 70) * 0.9 * h * 10;
    } else if (s.dashT > 0) {
      s.dashT -= h;
      s.fishV = s.dashV;
      if (s.dashT <= 0) {
        s.fishTarget = clamp(s.fish + s.dashV * 0.08, 0.08, 0.92);
        s.retarget = 0.5 + rand() * 0.4;
        s.moveCd = moveGap(s.behavior, d, rand);
        s.fishV *= 0.35;
      }
    } else {
      s.retarget -= h;
      if (s.retarget <= 0) retarget(s, rand);
      const k = 5 + d * 22 * (s.behavior === 'dart' ? 1.2 : s.behavior === 'smooth' ? 0.6 : 1);
      s.fishV += (s.fishTarget - s.fish) * k * h;
      s.fishV *= Math.exp(-h * (4.2 - d * 1.6));
      s.fishV += Math.sin(s.t * (7 + d * 9)) * d * 0.9 * h; // jitter
    }
    // Thrash: a violent head-shake (the frame shakes, progress bleeds even inside the bar).
    s.thrashCd -= h * panic;
    if (s.thrashCd <= 0 && s.tellT <= 0 && s.dashT <= 0) {
      s.thrashT = REEL.thrash;
      s.thrashCd = (3 + rand() * 2.5) * (1.3 - d * 0.4);
    }
    if (s.thrashT > 0) {
      s.thrashT -= h;
      s.fishV += Math.sin(s.t * 38) * 5 * h;
    }
    s.tell = s.tellT > 0 ? 1 - s.tellT / REEL.tell : 0;
    s.thrash = s.thrashT > 0 ? s.thrashT / REEL.thrash : 0;
    s.fish = clamp(s.fish + s.fishV * h, 0.02, 0.98);
    if (s.fish <= 0.02 || s.fish >= 0.98) {
      s.fishV *= -0.3;
      if (s.dashT > 0) s.dashT = 0.0001;
    }
    s.inside = s.fish >= s.bar - 0.01 && s.fish <= s.bar + s.barH + 0.01;
    const earning = s.inside && !s.slack;
    if (earning) s.insideT += h;
    if (!o.frozen) {
      // Sweet spot: centred = 1.12×, riding the edge = 0.76×.
      const off = Math.min(1, Math.abs(s.fish - (s.bar + s.barH * 0.5)) / (s.barH * 0.5));
      if (earning) s.progress += REEL.gain(d) * (1.12 - off * 0.36) * h;
      if (s.thrashT > 0 && s.t >= s.grace) s.progress -= REEL.thrashLoss * h;
      if (!earning && s.t >= s.grace) {
        s.progress -= REEL.loss(d) * h;
        // Perfect forgives a blink (≤ 0.12 s outside in the whole fight), not a lost fish.
        s.outT += h;
        if (s.outT > REEL.perfectSlip) s.perfect = false;
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
  // The autopilot reads the shiver and leans the way the fish is about to go.
  const want = s.fish + s.fishV * AUTO_GAINS.lead + (s.tellT > 0 ? Math.sign(s.dashV) * 0.12 : 0);
  const err = want - (s.bar + s.barH * 0.5);
  return err - s.barV * AUTO_GAINS.damp > 0;
}
