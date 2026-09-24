/**
 * AudioEngine: one object that owns the mixer graph, the music director, the ambience layers
 * and the SFX library. The game adapter (systems/audio.ts) feeds it state and events; the offline
 * renderer (audio/offline.ts) drives the very same code on an OfflineAudioContext.
 */
import { AudioGraph, BUS_TRIM, type GraphOptions } from './graph';
import { loadDucker } from './ducker';
import { MusicDirector } from './music';
import { Ambience, type EnvState } from './ambience';
import { Sfx } from './sfx';
import type { PiecePrefetch } from './prefetch';

export class AudioEngine {
  readonly graph: AudioGraph;
  readonly music: MusicDirector;
  readonly amb: Ambience;
  readonly sfx: Sfx;

  constructor(readonly ctx: BaseAudioContext, seed = 1, pieces?: PiecePrefetch, opts: GraphOptions = {}) {
    this.graph = new AudioGraph(ctx, seed, undefined, opts);
    // The sidechain follower is an AudioWorklet: register it and wire it up once the module lands
    // (a few ms; until then the score simply isn't ducked). Offline renders load it before building.
    if (!opts.worklet) void loadDucker(ctx).then((ok) => this.graph.attachSidechain(ok));
    this.music = new MusicDirector(this.graph, seed, pieces);
    this.amb = new Ambience(this.graph, seed + 1);
    this.sfx = new Sfx(this.graph, seed + 2);
  }

  /** Advance everything to the context's current time. */
  tick(env: EnvState, lookahead = 0.5): void {
    const now = this.ctx.currentTime;
    this.music.update(lookahead);
    this.sfx.key = this.music.key;
    env.key = this.music.key;
    this.amb.tick(now, env);
    this.sfx.setCave(env.map === 'mine' ? 1 : 0);
    this.sfx.tick(now);
  }

  setVolumes(v: { master?: number; music?: number; sfx?: number; ambience?: number }): void {
    const t = this.ctx.currentTime;
    if (v.master !== undefined) this.graph.out.gain.setTargetAtTime(v.master * BUS_TRIM.master, t, 0.05);
    if (v.music !== undefined) this.graph.musicVol.gain.setTargetAtTime(v.music * BUS_TRIM.music, t, 0.1);
    if (v.sfx !== undefined) {
      this.graph.sfxBus.gain.setTargetAtTime(v.sfx * BUS_TRIM.sfx, t, 0.05);
      this.graph.uiBus.gain.setTargetAtTime(v.sfx * BUS_TRIM.ui, t, 0.05);
    }
    if (v.ambience !== undefined) this.graph.ambBus.gain.setTargetAtTime(v.ambience * BUS_TRIM.ambience, t, 0.1);
  }
}
