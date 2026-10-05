/**
 * Playout clock for one remote farmer's state samples (pure: no DOM / three, unit-tested in node by
 * scripts/mp-interp.js through `node --experimental-strip-types`).
 *
 * Samples are stamped with the *sender's* clock. We learn the clock offset (receive − send) as a lower
 * envelope that follows a faster packet at once and creeps up over ~5 s (a low percentile of the one-
 * way delay + the offset — no sliding-window minimum that jumps when its minimum expires), and the
 * arrival jitter as an upper envelope of the lateness. The render clock `rt` then chases
 * (now − offset − buffer) by *time dilation only*: it runs at 0.9–1.2× real time, never steps, so a
 * jitter spike, a larger buffer or a new offset estimate only slows or hurries playback — the farmer
 * never slides backwards. Past the newest sample it coasts along the last segment, easing to a stop;
 * when real samples arrive after such a guess, the difference is bled in over ~100 ms.
 */

/** Floor of the adaptive jitter buffer (ms behind the freshest possible sample). */
export const INTERP_MS = 100;
/** Ceiling of the adaptive jitter buffer. */
const INTERP_MAX = 260;
/** How far past the newest sample a farmer may coast (easing to a stop) before holding. */
const EXTRAP_MS = 140;
/** Headroom (ms of buffered path) below which the playout clock slows down. */
const SOFT_MS = 35;
/** Fastest an extrapolation error is walked off (m/s, added to the farmer's own speed). */
const CORRECT_MS = 2.8;
/** Rendered speed never exceeds this multiple of the path's own speed (the rest is absorbed later). */
const VCAP = 1.4;
/** Floor of that cap (m/s) so a standing farmer can still settle a small error. */
const VCAP_MIN = 1.6;
/** Error the limiter may carry before it gives up and lets the farmer catch up (m). */
const VCAP_SLACK = 1.2;
/** Samples further apart than this (m) are a teleport: snap instead of sliding. */
const TELEPORT_M = 4;

interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
  anim: number;
}

export class Playout {
  /** Target buffer (ms); reached by dilation, never by stepping. */
  interp = INTERP_MS;
  /** Output of sample(): position (m), ground speed (m/s), yaw + anim code of the current segment. */
  x = 0;
  z = 0;
  speed = 0;
  yaw = 0;
  anim = 0;
  /** Diagnostics: frames spent past the newest sample / snaps since creation. */
  extrapFrames = 0;
  snaps = 0;

  private buf: Sample[] = [];
  private base = NaN;
  private jitter = 0;
  private rt = NaN;
  private rtAt = 0;
  private offX = 0;
  private offZ = 0;
  private rawX = 0;
  private rawZ = 0;
  private extrap = false;
  private ex = 0;
  private ez = 0;
  private es = 0;
  private ec: Sample | null = null;
  /** Last rendered position (speed limiter); NaN = none (snap). */
  private ox = NaN;
  private oz = NaN;
  /** Path speed envelope (m/s): the cap follows a farmer that just slowed for a few frames. */
  private vEnv = 0;
  /** Previous frame's raw path position + the last non-zero raw motion (offset bleed direction). */
  private pex = NaN;
  private pez = NaN;
  private vx = 0;
  private vz = 0;
  /** Diagnostics: frames the speed limiter clamped. */
  limited = 0;

  get empty(): boolean {
    return this.buf.length === 0;
  }

  /** Forget the path (map change / snap / new clock); the offset estimate survives unless `clock`. */
  reset(clock = false): void {
    this.buf.length = 0;
    this.rt = NaN;
    this.offX = this.offZ = 0;
    this.extrap = false;
    this.ox = this.oz = NaN;
    this.pex = this.pez = NaN;
    if (clock) {
      this.base = NaN;
      this.jitter = 0;
    }
  }

  /** A state sample stamped with the sender's clock `t` (ms), received at `now` (our clock). */
  push(t: number, x: number, z: number, yaw: number, anim: number, now: number): void {
    const tail = this.buf[this.buf.length - 1];
    // A different clock (rejoin after a reload, host restart): start over.
    if (tail && t < tail.t - 1000) this.reset(true);
    const d = now - t;
    if (!(d >= this.base)) this.base = d;
    else {
      this.base += (d - this.base) * 0.01;
      const late = d - this.base;
      this.jitter += (late - this.jitter) * (late > this.jitter ? 0.2 : 0.008);
    }
    this.interp = Math.min(INTERP_MAX, Math.max(INTERP_MS, this.jitter * 1.25 + 35));
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) return;
    if (last && Math.hypot(x - last.x, z - last.z) > TELEPORT_M) {
      this.reset();
      this.snaps++;
    }
    this.buf.push({ t, x, z, yaw, anim });
    if (this.buf.length > 48) this.buf.splice(0, this.buf.length - 48);
    // We were showing a guess past the newest sample: whatever the real path says the pose is at that
    // same render time, bleed the difference in instead of popping to it.
    if (this.extrap && Number.isFinite(this.rt) && this.buf.length > 1) {
      this.eval(this.rt);
      this.offX += this.rawX - this.ex;
      this.offZ += this.rawZ - this.ez;
      // (the path under us moved, not the farmer: keep last frame's raw point on the new path too)
      this.pex += this.ex - this.rawX;
      this.pez += this.ez - this.rawZ;
      this.rawX = this.ex;
      this.rawZ = this.ez;
      this.extrap = this.rt > t;
    }
  }

  /** Advance the playout clock to frame time `now` and evaluate the pose (false if no samples). */
  sample(now: number): boolean {
    const b = this.buf;
    if (!b.length) return false;
    const target = now - this.base - this.interp;
    const newest = b[b.length - 1]!.t;
    const first = !Number.isFinite(this.rt);
    // Restart the clock on the first sample, or when it is > 0.9 s off the target AND there is path to
    // restart onto (a hidden tab, a sender that froze for seconds). While we're simply starved (holding
    // at the end of the path, nothing newer yet) the clock waits instead of re-snapping every frame.
    // (A clock that ran > 0.9 s AHEAD of the target is never restarted backwards — that walked the
    // farmer back along his path: it holds instead, see below.)
    if (first || (target - this.rt > 900 && newest > this.rt + 1)) {
      if (!first) this.snaps++;
      this.rt = Math.min(target, newest + EXTRAP_MS);
      this.offX = this.offZ = 0;
      // The speed limiter stays on across a restart (r6: a sender tab frozen for 2.5 s on a saturated
      // box popped every observer forward): the jump is walked off at ≤ VCAP like any other error.
      if (first) this.ox = this.oz = NaN;
    } else {
      const fdt = Math.min(250, Math.max(0, now - this.rtAt));
      const err = target - this.rt;
      // ±6 % for small drifts (invisible), up to +20 % to catch up after a stall.
      const hi = err > 60 ? Math.min(0.2, 0.06 + (err - 60) / 1500) : 0.06;
      let rate = 1 + Math.max(-0.1, Math.min(hi, err / 1000));
      // Far ahead of the target (the offset estimate dropped a lot): pause until it catches up.
      if (err < -900) rate = 0;
      // Running out of path (a late packet): ease the clock down as the headroom shrinks so the farmer
      // decelerates on real data instead of coasting on a guess that later has to be bled back.
      const head = newest - this.rt;
      if (head < SOFT_MS) rate *= Math.max(0.25, head / SOFT_MS);
      this.rt = Math.max(this.rt, Math.min(this.rt + fdt * rate, newest + EXTRAP_MS));
    }
    const fdt = Math.min(0.1, Math.max(0, (now - (this.rtAt || now)) / 1000));
    this.rtAt = now;
    this.eval(this.rt);
    this.extrap = this.rt > newest;
    if (this.extrap) this.extrapFrames++;
    this.rawX = this.ex;
    this.rawZ = this.ez;
    if (this.offX !== 0 || this.offZ !== 0) {
      // ~100 ms exponential bleed, but never faster than CORRECT_MS m/s on top of the walk (a big
      // wrong guess at a corner is walked off over a few frames instead of snapping).
      const len = Math.hypot(this.offX, this.offZ);
      let cut = Math.min(len * (1 - Math.exp(-fdt / 0.1)), CORRECT_MS * fdt);
      // A guess that ran AHEAD along the way we're walking (the sender stalled / slowed) is absorbed by
      // letting the real path catch up under it — the farmer pauses instead of stepping backwards.
      // A farmer who has stopped settles it slowly (≤ 0.3 m/s, half a cm a frame).
      if (Number.isFinite(this.pex) && len > 1e-3) {
        const ahead = (this.offX * (this.ex - this.pex) + this.offZ * (this.ez - this.pez)) / len;
        const dot = this.offX * this.vx + this.offZ * this.vz;
        if (dot > 0) cut = Math.min(cut, Math.max(0, ahead) + 0.3 * fdt);
      }
      const k = len > 1e-3 ? (len - cut) / len : 0;
      this.offX *= k;
      this.offZ *= k;
    }
    let x = this.ex + this.offX;
    let z = this.ez + this.offZ;
    // Speed limiter: whatever the clock dilation, a late corner or a correction adds up to, the
    // rendered farmer never moves faster than VCAP× its own pace this frame; the excess becomes
    // offset that later frames walk off (also capped). A walk start can't render at 2× (mp-adv).
    // The cap follows the path's pace over a ~300 ms window, not the current segment's speed: a short
    // segment carries the sender's sim-step quantisation (0 or 2 steps in one 17 ms frame = 0x / 2x),
    // which lifted the r5 cap along with the surge it was meant to stop (mp-adv walk at 1.6-2x).
    this.vEnv = Math.max(this.pace(this.rt), this.vEnv * Math.exp(-fdt / 0.25));
    if (Number.isFinite(this.ox) && fdt > 0) {
      const dx = x - this.ox;
      const dz = z - this.oz;
      const step = Math.hypot(dx, dz);
      const cap = Math.max(VCAP_MIN, VCAP * this.vEnv) * fdt;
      if (step > cap && step - cap < VCAP_SLACK + cap) {
        const k = cap / step;
        x = this.ox + dx * k;
        z = this.oz + dz * k;
        this.offX = x - this.ex;
        this.offZ = z - this.ez;
        this.limited++;
      }
    }
    this.ox = x;
    this.oz = z;
    // Raw path motion this frame (direction of travel for the offset bleed above).
    if (Number.isFinite(this.pex)) {
      const mx = this.ex - this.pex;
      const mz = this.ez - this.pez;
      if (mx * mx + mz * mz > 1e-8) {
        this.vx = mx;
        this.vz = mz;
      }
    }
    this.pex = this.ex;
    this.pez = this.ez;
    this.x = x;
    this.z = z;
    this.speed = this.es;
    this.yaw = this.ec!.yaw;
    this.anim = this.ec!.anim;
    return true;
  }

  /** Mean path speed (m/s) over the buffered samples within ±150 ms of sender time `rt`. */
  private pace(rt: number): number {
    const b = this.buf;
    const n = b.length;
    if (n < 2) return 0;
    let i = 0;
    while (i < n - 2 && b[i + 1]!.t < rt - 150) i++;
    let j = n - 1;
    while (j > i + 1 && b[j - 1]!.t > rt + 150) j--;
    let len = 0;
    for (let k = i; k < j; k++) len += Math.hypot(b[k + 1]!.x - b[k]!.x, b[k + 1]!.z - b[k]!.z);
    const span = b[j]!.t - b[i]!.t;
    return span > 0 ? (len / span) * 1000 : 0;
  }

  /** Position on the buffered path at sender time `rt` (coasts ≤ EXTRAP_MS past the tail). */
  private eval(rt: number): void {
    const b = this.buf;
    const first = b[0]!;
    const c = b[b.length - 1]!;
    if (rt <= first.t) {
      this.ex = first.x;
      this.ez = first.z;
      this.es = 0;
      this.ec = first;
      return;
    }
    if (rt >= c.t) {
      const p = b.length > 1 ? b[b.length - 2]! : c;
      const dt = Math.max(1, c.t - p.t);
      const u = Math.min(rt - c.t, EXTRAP_MS) / EXTRAP_MS;
      const k = p === c ? 0 : (EXTRAP_MS * (u - (u * u) / 2)) / dt;
      this.ex = c.x + (c.x - p.x) * k;
      this.ez = c.z + (c.z - p.z) * k;
      this.es = p === c ? 0 : (Math.hypot(c.x - p.x, c.z - p.z) / dt) * 1000 * (1 - u);
      this.ec = c;
      return;
    }
    let i = b.length - 2;
    while (i > 0 && b[i]!.t > rt) i--;
    const a = b[i]!;
    const n = b[i + 1]!;
    const span = Math.max(1, n.t - a.t);
    const k = (rt - a.t) / span;
    this.ex = a.x + (n.x - a.x) * k;
    this.ez = a.z + (n.z - a.z) * k;
    this.es = (Math.hypot(n.x - a.x, n.z - a.z) / span) * 1000;
    this.ec = n;
  }
}
