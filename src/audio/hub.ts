/**
 * The audio hub: the ONE AudioContext and its mixer inputs, for modules outside src/audio that voice
 * their own little sounds (animal calls, the fishing kit). They borrow this context and connect to
 * `sfx`, so everything passes the master limiter, the SFX / master volume sliders and mute — there
 * is never a second AudioContext. Mine / combat sounds go further: `play` voices the sfx.ts designs
 * by name at a world position (see world/mine/sfx.ts).
 *
 * Set by systems/audio.ts once its engine exists; everything is null before the first gesture.
 */
export interface AudioHub {
  ctx: AudioContext | null;
  /** SFX bus input (volume / mute / limiter apply; the score is NOT ducked by it). */
  sfx: AudioNode | null;
  /** Play a named SFX (src/audio/sfx.ts) at a world position (x, z), or centred when omitted. */
  play: ((name: string, at?: { x: number; z: number } | null, opts?: { gain?: number; level?: number }) => void) | null;
}

export const audioHub: AudioHub = { ctx: null, sfx: null, play: null };

/** The hub's context once it is running (null before the first gesture / while suspended). */
export function hubContext(): AudioContext | null {
  const c = audioHub.ctx;
  return c && c.state === 'running' ? c : null;
}
