/**
 * Frame pacing + adaptive quality governor (DESIGN pillar 14: "adaptive quality drops post effects /
 * shadow res before frames drop"). The goal is a STABLE frame rate, not the highest one: a scene
 * that renders in 11 ms on a 120 Hz display otherwise lands on a mix of 8.3 / 16.7 / 25 ms frames
 * (reads as a constant 120 → 50 fps swing), while pacing it to every second refresh is a flat 60.
 *
 * Display refresh: measured from rAF intervals (every rAF, including paced-out ones). A faster
 * standard rate (60 → 120 / 144 …) is adopted once the mean interval of a clean ~1 s window (no
 * missed refresh) sits on it two windows running; it only goes back down when the window moves (DPR / size change → re-detect).
 *
 * Frame-rate cap (Options → Display, `cap`): 0 = Auto, -1 = Uncapped (every refresh), else a
 * fps limit (60 / 120; legacy 30). pace() is called on every rAF and says whether to render it:
 * frames are spaced a whole number of refreshes apart so a 60 cap on a 120 Hz panel is an even
 * 16.7 ms cadence. Auto on a ≥ 100 Hz display runs at half refresh (60 on 120, 72 on 144) and
 * trials the full refresh after a quiet spell at full quality; a trial that can't hold it drops
 * straight back and the next one waits twice as long (10 s → 300 s).
 *
 * Quality: the ~1 s average rendered-frame interval is judged against the paced target's budget.
 * Two over-budget windows in a row (one if badly over) shed one step, cheapest-to-lose first —
 * but in Auto the rate tier drops before any quality does:
 *   (tier: full → half refresh) → 1 GTAO targets at 0.6× (0.3 of full res on high) → 2 GTAO off
 *   → 3 bloom off → 4 shadow maps ½ res → 5 shadow maps ¼ res → 6 render scale 0.85 → 7 render scale 0.7
 * and restores them one at a time (last shed, first restored) after `backoff` seconds of frames at
 * the target; a restore that immediately causes a drop is undone and the next attempt waits twice
 * as long (10 s → 160 s), and the band between "at target" and "over" holds (hysteresis), so it
 * never oscillates. Uncapped only protects 60 fps (never sheds quality to chase 120+). No step
 * touches a shader (pass enable flags, shadow-map reallocation, drawing-buffer size): no hitches.
 *
 * Off under automation (navigator.webdriver: screenshots / perf runs measure the fixed preset,
 * unpaced); `?adaptive=1` / `?adaptive=0` force the governor, `?fpscap=auto|60|120|off` forces
 * pacing on with that cap. State: __game.info().perf.adaptive.
 */
import type * as THREE from 'three';
import type { RenderContext } from './renderer';

/** Average above budget × this over a window → over budget. */
const DOWN_K = 1.12;
/** …above this → badly over: act on one window instead of two. */
const SEVERE_K = 1.5;
/** Window average at/below budget × this counts as "at target". */
const UP_K = 1.06;
const WINDOW_S = 1;
const SETTLE_S = 1.5;
const STEPS = ['aoLow', 'ao', 'bloom', 'shadow½', 'shadow¼', 'res0.85', 'res0.7'] as const;
/** Standard display refresh rates, fastest first. */
const RATES = [360, 240, 165, 144, 120, 100, 90, 75, 60] as const;

function query(key: string): string | null {
  try {
    return new URLSearchParams(location.search).get(key);
  } catch {
    return null;
  }
}

function automated(): boolean {
  try {
    return !!navigator.webdriver;
  } catch {
    return false;
  }
}

function autoEnabled(): boolean {
  const q = query('adaptive');
  if (q === '1' || q === 'true') return true;
  if (q === '0' || q === 'false') return false;
  return !automated();
}

/** `?fpscap=` → forced cap (pacing on even under automation); undefined = use the Options setting. */
function forcedCap(): number | undefined {
  const q = query('fpscap');
  if (q === null) return undefined;
  if (q === 'auto') return 0;
  if (q === 'off' || q === 'uncapped') return -1;
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export class QualityGovernor {
  enabled = autoEnabled();
  /** Frame pacing on (off under automation unless `?fpscap=` is given). */
  readonly pacing: boolean;
  /** Number of shed steps (0 = the full preset). */
  level = 0;
  /** Detected display refresh (Hz). */
  refreshHz = 60;
  private sum = 0;
  /** Frames in the window that missed a refresh (> 1.5 × budget). */
  private miss = 0;
  private n = 0;
  private win = 0;
  /** Seconds to wait before judging again (after a change / hitch). */
  private settle = SETTLE_S;
  private goodFor = 0;
  private overStreak = 0;
  private backoff = 10;
  /** Seconds since the last restore (a quick drop after it → the restore failed). */
  private sinceUp = Infinity;
  private shadowK = 1;
  // Frame-rate cap (Options → Display) and the Auto tier.
  private capSetting = 0;
  private readonly capForced = forcedCap();
  /** Auto: running at the full refresh (else half) — starts at the steady half rate. */
  private autoFull = false;
  private tierBackoff = 10;
  private sinceTierUp = Infinity;
  // Refresh detection (mean rAF interval per ~1 s window) + pacing clock.
  private ivN = 0;
  private ivT = 0;
  private pendingHz = 0;
  private lastRaf = -1;
  private lastPaced = -1;

  constructor(private rc: RenderContext) {
    this.pacing = this.capForced !== undefined || !automated();
    if (typeof window !== 'undefined') {
      // Window moved to another display (DPR / size change): re-detect from the 60 Hz floor.
      let dpr = window.devicePixelRatio;
      window.addEventListener('resize', () => {
        if (window.devicePixelRatio === dpr) return;
        dpr = window.devicePixelRatio;
        this.refreshHz = 60;
        this.pendingHz = 0;
        this.autoFull = false;
      });
    }
  }

  /** Player's frame-rate cap: 0 = Auto, -1 = Uncapped, else fps (URL `?fpscap=` wins). */
  get cap(): number {
    return this.capForced ?? this.capSetting;
  }
  set cap(v: number) {
    if (v === this.capSetting) return;
    this.capSetting = v;
    this.autoFull = false;
    this.tierBackoff = 10;
    this.resetWindow(SETTLE_S);
  }

  /** Auto has two tiers on this display (full / half refresh). */
  private get hasHalfTier(): boolean {
    return this.refreshHz / 2 >= 50;
  }

  /** Frame rate frames are paced to (Hz). */
  get targetHz(): number {
    const cap = this.cap;
    const r = this.refreshHz;
    if (!this.pacing || cap < 0) return r;
    if (cap === 0) return this.autoFull || !this.hasHalfTier ? r : r / 2;
    return Math.min(cap, r);
  }

  /** Frame-time budget the quality governor holds (ms). Uncapped only protects 60 fps. */
  private get budgetMs(): number {
    return 1000 / (this.pacing && this.cap < 0 ? Math.min(60, this.refreshHz) : this.targetHz);
  }

  /**
   * Call on every requestAnimationFrame with its timestamp; false = skip this refresh (paced out).
   * Keeps rendered frames a whole number of refreshes apart at the target rate.
   */
  pace(now: number): boolean {
    const d = this.lastRaf >= 0 ? now - this.lastRaf : 0;
    this.lastRaf = now;
    if (d > 0 && d < 100) this.detect(d);
    if (!this.pacing) return true;
    const target = this.targetHz;
    const refresh = this.refreshHz;
    if (this.lastPaced < 0 || target >= refresh * 0.97 || now - this.lastPaced > 250) {
      this.lastPaced = now;
      return true;
    }
    // Half a refresh of slack: rAF timestamps are vsync-aligned, so this picks whole refreshes.
    if (now - this.lastPaced < 1000 / target - 500 / refresh) return false;
    this.lastPaced = now;
    return true;
  }

  private detect(d: number): void {
    this.ivN++;
    this.ivT += d;
    if (this.ivT < 1000) return;
    const n = this.ivN;
    // Mean rAF interval over ~1 s. rAF timestamps jitter ±25 % on ProMotion (single intervals of 4 or
    // 12 ms at 120 Hz), but they are vsync times, so the jitter cancels in the mean. A window where no
    // callback missed a refresh (cheap or paced-out frames) averages exactly one period; any miss
    // pushes it off every standard rate, so only clean windows (±5 %) count.
    const mean = this.ivT / n;
    this.ivT = 0;
    this.ivN = 0;
    if (n < 30) return;
    let found = 0;
    for (const hz of RATES) {
      if (hz <= this.refreshHz) break;
      const t = 1000 / hz;
      if (Math.abs(mean - t) < t * 0.05) {
        found = hz;
        break;
      }
    }
    if (found && found === this.pendingHz) {
      this.refreshHz = found;
      this.pendingHz = 0;
      this.resetWindow(SETTLE_S);
    } else this.pendingHz = found;
  }

  private resetWindow(settle: number): void {
    this.settle = settle;
    this.sum = this.n = this.win = this.miss = 0;
    this.overStreak = 0;
    this.goodFor = 0;
  }

  /** Feed one rendered frame's wall time (ms). */
  sample(ms: number): void {
    // Also re-applies shadow scale to lights that appeared since (map change).
    this.applyShadow();
    if (!this.enabled || (typeof document !== 'undefined' && document.hidden)) return;
    const s = ms / 1000;
    this.sinceUp += s;
    this.sinceTierUp += s;
    // Ignore load hitches / tab switches entirely.
    if (ms > 250) {
      this.resetWindow(SETTLE_S);
      return;
    }
    if (this.settle > 0) {
      this.settle -= s;
      return;
    }
    this.sum += Math.min(ms, 50);
    if (ms > this.budgetMs * 1.5) this.miss++;
    this.n++;
    this.win += s;
    if (this.win < WINDOW_S) return;
    const avg = this.sum / this.n;
    const missK = this.miss / this.n;
    this.sum = this.n = this.win = this.miss = 0;
    const budget = this.budgetMs;
    const auto = this.pacing && this.cap === 0 && this.hasHalfTier;
    // Auto's full tier must really hold the refresh: a 9 ms average on a 120 Hz panel is a 8.3 / 16.7
    // mix (the judder this exists to remove), so missed refreshes count as over budget there.
    const tierMiss = auto && this.autoFull ? missK : 0;
    if (avg > budget * DOWN_K || tierMiss > 0.06) {
      this.goodFor = 0;
      this.overStreak++;
      if (this.overStreak < 2 && avg < budget * SEVERE_K && tierMiss < 0.25) return;
      this.overStreak = 0;
      if (auto && this.autoFull) {
        // Rate first: a steady half refresh beats shedding quality to chase the full one.
        if (this.sinceTierUp < 5) this.tierBackoff = Math.min(300, this.tierBackoff * 2);
        this.autoFull = false;
        this.resetWindow(SETTLE_S);
      } else if (this.level < STEPS.length) {
        if (this.sinceUp < 4) this.backoff = Math.min(160, this.backoff * 2);
        this.set(this.level + 1);
      }
    } else if (avg <= budget * UP_K && missK <= 0.06) {
      this.overStreak = 0;
      this.goodFor += WINDOW_S;
      if (this.level > 0) {
        if (this.goodFor >= this.backoff) {
          this.set(this.level - 1);
          this.goodFor = 0;
          this.sinceUp = 0;
        }
      } else if (auto && !this.autoFull && this.goodFor >= this.tierBackoff) {
        this.autoFull = true;
        this.sinceTierUp = 0;
        this.resetWindow(0.25);
      }
    } else {
      // Hysteresis band: neither over nor comfortably at target — hold.
      this.overStreak = 0;
      this.goodFor = 0;
    }
  }

  /** Back to the full preset (quality change / map load). */
  reset(): void {
    this.set(0);
    this.backoff = 10;
    this.tierBackoff = 10;
  }

  get state(): { enabled: boolean; level: number; shed: string[]; refreshHz: number; targetHz: number; cap: number; pacing: boolean } {
    return {
      enabled: this.enabled,
      level: this.level,
      shed: STEPS.slice(0, this.level) as unknown as string[],
      refreshHz: this.refreshHz,
      targetHz: Math.round(this.targetHz * 10) / 10,
      cap: this.cap,
      pacing: this.pacing,
    };
  }

  /** Force a level (debug / tests). */
  set(level: number): void {
    level = Math.max(0, Math.min(STEPS.length, level));
    this.level = level;
    this.resetWindow(SETTLE_S);
    const on = (step: (typeof STEPS)[number]): boolean => STEPS.indexOf(step) >= level;
    const rc = this.rc;
    rc.post.setAOScale(on('aoLow') ? 1 : 0.6);
    rc.post.setAOEnabled(on('ao'));
    rc.post.setBloomEnabled(on('bloom'));
    this.shadowK = !on('shadow¼') ? 0.25 : !on('shadow½') ? 0.5 : 1;
    this.applyShadow();
    const res = !on('res0.7') ? 0.7 : !on('res0.85') ? 0.85 : 1;
    if (res !== rc.resScale) {
      rc.resScale = res;
      rc.resize();
    }
  }

  private applyShadow(): void {
    for (const l of this.rc.lights.shadowLights) {
      const ms = l.shadow.mapSize;
      const applied = this.applied.get(l);
      // First sight, or the owner set a new size (quality switch): that is the full-res base.
      if (applied === undefined || ms.x !== applied.size) this.applied.set(l, { base: ms.x, size: ms.x });
      const a = this.applied.get(l)!;
      const size = Math.max(256, Math.round(a.base * this.shadowK));
      if (ms.x !== size) {
        ms.set(size, size);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
      a.size = size;
    }
  }
  private applied = new WeakMap<THREE.Light, { base: number; size: number }>();
}
