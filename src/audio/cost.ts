/**
 * Main-thread cost of the audio stack OUTSIDE the frame loop's `AudioSystem.update()` (round 7,
 * co-op perf gate): the compose worker's note / piece deliveries (copied into the note cache), the
 * 250 ms watchdog and any other timer the audio code owns. `AudioSystem.update()` drains it into
 * the frame it lands in, so `info().perf.frame.audioMsPerSec` is the whole audio stack's share of
 * the main thread, not only the per-frame update.
 */
export const OFF_FRAME = { ms: 0, calls: 0 };

/** Run `fn` and charge its wall time to the audio stack's off-frame account. */
export function offFrame<T>(fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    OFF_FRAME.ms += performance.now() - t0;
    OFF_FRAME.calls++;
  }
}

/** Take (and reset) the off-frame time accumulated since the last call. */
export function drainOffFrame(): number {
  const ms = OFF_FRAME.ms;
  OFF_FRAME.ms = 0;
  return ms;
}
