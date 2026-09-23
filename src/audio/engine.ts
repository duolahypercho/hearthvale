/**
 * AudioEngine: one object that owns the mixer graph, the music director, the ambience layers
 * and the SFX library. The game adapter (systems/audio.ts) feeds it state and events; the offline
 * renderer (audio/offline.ts) drives the very same code on an OfflineAudioContext.
 */
import { AudioGraph } from './graph';
import { MusicDirector } from './music';
import { Ambience, type EnvState } from './ambience';
import { Sfx } from './sfx';

export class AudioEngine {
  readonly graph: AudioGraph;
  readonly music: MusicDirector;
  readonly amb: Ambience;
  readonly sfx: Sfx;

  constructor(readonly ctx: BaseAudioContext, seed = 1) {
    this.graph = new AudioGraph(ctx, seed);
    this.music = new MusicDirector(this.graph, seed);
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
    if (v.master !== undefined) this.graph.out.gain.setTargetAtTime(v.master * 0.8, t, 0.05);
    if (v.music !== undefined) this.graph.musicBus.gain.setTargetAtTime(v.music * 0.34, t, 0.1);
    if (v.sfx !== undefined) {
      this.graph.sfxBus.gain.setTargetAtTime(v.sfx * 0.85, t, 0.05);
      this.graph.uiBus.gain.setTargetAtTime(v.sfx * 0.7, t, 0.05);
    }
    if (v.ambience !== undefined) this.graph.ambBus.gain.setTargetAtTime(v.ambience * 0.7, t, 0.1);
  }
}
