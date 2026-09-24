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

  get empty(): boolean {
    return this.buf.length === 0;
  }

  /** Forget the path (map change / snap / new clock); the offset estimate survives unless `clock`. */
  reset(clock = false): void {
    this.buf.length = 0;
    this.rt = NaN;
    this.offX = this.offZ = 0;
    this.extrap = false;
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
    if (!Number.isFinite(this.rt) || Math.abs(target - this.rt) > 900) {
      // First sample / long stall / hidden tab: start the clock at the target.
      if (Number.isFinite(this.rt)) this.snaps++;
      this.rt = Math.min(target, newest + EXTRAP_MS);
      this.offX = this.offZ = 0;
    } else {
      const fdt = Math.min(250, Math.max(0, now - this.rtAt));
      const err = target - this.rt;
      // ±6 % for small drifts (invisible), up to +20 % to catch up after a stall.
      const hi = err > 60 ? Math.min(0.2, 0.06 + (err - 60) / 1500) : 0.06;
      let rate = 1 + Math.max(-0.1, Math.min(hi, err / 1000));
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
      const cut = Math.min(len * (1 - Math.exp(-fdt / 0.1)), CORRECT_MS * fdt);
      const k = len > 1e-3 ? (len - cut) / len : 0;
      this.offX *= k;
      this.offZ *= k;
    }
    this.x = this.ex + this.offX;
    this.z = this.ez + this.offZ;
    this.speed = this.es;
    this.yaw = this.ec!.yaw;
    this.anim = this.ec!.anim;
    return true;
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
