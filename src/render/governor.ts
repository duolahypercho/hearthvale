/**
 * Adaptive quality governor (DESIGN pillar 14: "adaptive quality drops post effects / shadow res
 * before frames drop").
 *
 * Watches wall-clock frame time (rAF → rAF, so GPU-bound frames count too). When the ~1 s average
 * runs over budget it sheds one step, cheapest-to-lose first:
 *   1 GTAO off → 2 bloom off → 3 shadow maps ½ res → 4 shadow maps ¼ res → 5 render scale 0.85
 *   → 6 render scale 0.7
 * and restores them one at a time (last shed, first restored) once frames sit at the display
 * refresh again. A restore that immediately causes a drop is undone and the next attempt waits
 * twice as long (10 s → 160 s), so it never oscillates. No step touches a shader (pass enable
 * flags, shadow-map reallocation, drawing-buffer size), so there are no recompile hitches.
 *
 * Off under automation (navigator.webdriver: screenshots / perf runs measure the fixed preset);
 * `?adaptive=1` forces it on, `?adaptive=0` off. State: __game.info().perf.adaptive.
 */
import type * as THREE from 'three';
import type { RenderContext } from './renderer';

const BUDGET_MS = 1000 / 60;
/** Average above this over the window → shed a step. */
const DOWN_MS = BUDGET_MS * 1.1;
/** Window average (ms) at/below this counts as "at refresh" (vsync-capped 60 Hz reads ~16.7). */
const UP_MS = BUDGET_MS * 1.04;
const WINDOW_S = 1;
const SETTLE_S = 1.5;
const STEPS = ['ao', 'bloom', 'shadow½', 'shadow¼', 'res0.85', 'res0.7'] as const;

function autoEnabled(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('adaptive');
    if (q === '1' || q === 'true') return true;
    if (q === '0' || q === 'false') return false;
    return !navigator.webdriver;
  } catch {
    return true;
  }
}

export class QualityGovernor {
  enabled = autoEnabled();
  /** Number of shed steps (0 = the full preset). */
  level = 0;
  private sum = 0;
  private n = 0;
  private win = 0;
  /** Seconds to wait before judging again (after a change / hitch). */
  private settle = SETTLE_S;
  private goodFor = 0;
  private backoff = 10;
  /** Seconds since the last restore (a quick drop after it → the restore failed). */
  private sinceUp = Infinity;
  private shadowK = 1;

  constructor(private rc: RenderContext) {}

  /** Feed one frame's wall time (ms). */
  sample(ms: number): void {
    // Also re-applies shadow scale to lights that appeared since (map change).
    this.applyShadow();
    if (!this.enabled || (typeof document !== 'undefined' && document.hidden)) return;
    const s = ms / 1000;
    this.sinceUp += s;
    // Ignore load hitches / tab switches entirely.
    if (ms > 250) {
      this.settle = SETTLE_S;
      this.sum = this.n = this.win = 0;
      return;
    }
    if (this.settle > 0) {
      this.settle -= s;
      return;
    }
    this.sum += Math.min(ms, 50);
    this.n++;
    this.win += s;
    if (this.win < WINDOW_S) return;
    const avg = this.sum / this.n;
    this.sum = this.n = this.win = 0;
    if (avg > DOWN_MS && this.level < STEPS.length) {
      if (this.sinceUp < 4) this.backoff = Math.min(160, this.backoff * 2);
      this.set(this.level + 1);
      this.goodFor = 0;
    } else if (avg <= UP_MS && this.level > 0) {
      this.goodFor += WINDOW_S;
      if (this.goodFor >= this.backoff) {
        this.set(this.level - 1);
        this.goodFor = 0;
        this.sinceUp = 0;
      }
    } else this.goodFor = 0;
  }

  /** Back to the full preset (quality change / map load). */
  reset(): void {
    this.set(0);
    this.backoff = 10;
  }

  get state(): { enabled: boolean; level: number; shed: string[] } {
    return { enabled: this.enabled, level: this.level, shed: STEPS.slice(0, this.level) as unknown as string[] };
  }

  /** Force a level (debug / tests). */
  set(level: number): void {
    level = Math.max(0, Math.min(STEPS.length, level));
    this.level = level;
    this.settle = SETTLE_S;
    const on = (step: (typeof STEPS)[number]): boolean => STEPS.indexOf(step) >= level;
    const rc = this.rc;
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
