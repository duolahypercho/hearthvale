/**
 * Music playback: MusicPlayer schedules one theme's pieces with a look-ahead clock; MusicDirector
 * picks the theme for the moment (title / festival / map / time of day / weather), crossfades
 * between players and lets the score breathe — after a piece ends there is a stretch of ambience
 * only before the next song, like a hand-composed OST.
 */
import type { AudioGraph } from './graph';
import { Composer, type Piece, type ThemeDef, type TrackName } from './composer';
import { INSTRUMENTS } from './instruments';
import { THEMES } from './themes';
import { Rand, hashString } from './dsp';

export class MusicPlayer {
  readonly out: GainNode;
  readonly wet: GainNode;
  private tracks = new Map<TrackName, GainNode>();
  private piece: Piece;
  private idx = 0;
  private pieceStart: number;
  private stopAt = Infinity;
  private seed: number;
  /** Absolute time when the current (last) piece's music ends. */
  endTime: number;
  /** Offline stem renders: only schedule this track. */
  solo: TrackName | null = null;

  constructor(private g: AudioGraph, readonly theme: ThemeDef, seed: number, startAt: number, fadeIn = 0) {
    const ctx = g.ctx;
    this.seed = seed;
    this.out = ctx.createGain();
    this.wet = ctx.createGain();
    const lvl = theme.gain;
    if (fadeIn > 0) {
      this.out.gain.setValueAtTime(0, startAt);
      this.out.gain.linearRampToValueAtTime(lvl, startAt + fadeIn);
      this.wet.gain.setValueAtTime(0, startAt);
      this.wet.gain.linearRampToValueAtTime(lvl, startAt + fadeIn);
    } else {
      this.out.gain.value = lvl;
      this.wet.gain.value = lvl;
    }
    this.out.connect(g.musicBus);
    this.wet.connect(g.hall);
    this.piece = new Composer(theme, seed).compose();
    this.pieceStart = startAt;
    this.endTime = startAt + this.piece.duration;
  }

  get key(): number {
    return this.theme.key;
  }

  private track(name: TrackName): GainNode {
    let t = this.tracks.get(name);
    if (t) return t;
    const ctx = this.g.ctx;
    const mix = this.theme.mix[name] ?? { gain: 0.6, pan: 0, send: 0.3 };
    t = ctx.createGain();
    t.gain.value = mix.gain;
    const p = ctx.createStereoPanner();
    p.pan.value = mix.pan;
    const send = ctx.createGain();
    send.gain.value = mix.send;
    t.connect(p).connect(this.out);
    p.connect(send).connect(this.wet);
    this.tracks.set(name, t);
    return t;
  }

  /** Schedule every event that starts before `until`. Returns false once finished. */
  pump(until: number): boolean {
    while (true) {
      const ev = this.piece.events[this.idx];
      if (!ev) {
        // Seamless loops (title, festival): chain the next piece exactly on the downbeat.
        if (this.theme.rest[1] === 0 && this.pieceStart + this.piece.duration < this.stopAt) {
          this.pieceStart += this.piece.duration;
          this.seed++;
          this.piece = new Composer(this.theme, this.seed).compose();
          this.idx = 0;
          this.endTime = this.pieceStart + this.piece.duration;
          continue;
        }
        return this.g.ctx.currentTime < this.endTime + 2;
      }
      const t = this.pieceStart + ev.t;
      if (t >= until) return true;
      this.idx++;
      if (t >= this.stopAt) continue;
      if (this.solo && ev.track !== this.solo && !(this.solo === 'melody' && ev.track === 'double')) continue;
      if (t < this.g.ctx.currentTime - 0.05) continue; // late (tab was hidden): skip rather than pile up
      INSTRUMENTS[ev.inst](this.g, this.track(ev.track), Math.max(t, this.g.ctx.currentTime), ev.midi, ev.dur, Math.max(0.05, Math.min(1.2, ev.vel)), ev.o);
    }
  }

  /** Fade out over `time` seconds and stop scheduling. */
  stop(time: number): void {
    const now = this.g.ctx.currentTime;
    this.stopAt = now + time;
    for (const n of [this.out, this.wet]) {
      n.gain.cancelScheduledValues(now);
      n.gain.setValueAtTime(n.gain.value, now);
      n.gain.linearRampToValueAtTime(0, now + time);
    }
    this.endTime = Math.min(this.endTime, now + time);
    if (this.g.ctx instanceof AudioContext) {
      setTimeout(() => {
        this.out.disconnect();
        this.wet.disconnect();
      }, (time + 4) * 1000);
    }
  }

  /** Scale the level (e.g. quieter at night, muffled indoors). */
  setLevel(v: number, tau = 1.5): void {
    const now = this.g.ctx.currentTime;
    if (now < this.stopAt) {
      this.out.gain.setTargetAtTime(this.theme.gain * v, now, tau);
      this.wet.gain.setTargetAtTime(this.theme.gain * v, now, tau);
    }
  }

  get finished(): boolean {
    return this.g.ctx.currentTime > this.endTime + 1;
  }
}

export class MusicDirector {
  private current: MusicPlayer | null = null;
  private old: MusicPlayer[] = [];
  private restUntil = 0;
  private pieceCount = 0;
  private rng: Rand;
  private baseSeed = 1;
  /** Theme id the game wants right now (null = silence). */
  desired: string | null = null;
  forced: string | null = null;
  level = 1;
  /** Crossfade length for ordinary mood changes (the adapter lengthens it for time/weather drifts). */
  fade = 4;

  constructor(private g: AudioGraph, seed = 1) {
    this.rng = new Rand(seed);
  }

  get playing(): string | null {
    return this.current?.theme.id ?? null;
  }
  get key(): number {
    return this.current?.key ?? 60;
  }
  get resting(): boolean {
    return !this.current && this.g.ctx.currentTime < this.restUntil;
  }

  /** New day / new context: next piece starts fresh with a seed for this day. */
  reseed(daySeed: number): void {
    this.baseSeed = daySeed;
    this.pieceCount = 0;
  }

  /** Start the wanted theme now (e.g. the morning song), skipping any rest. */
  kick(): void {
    this.restUntil = 0;
  }

  update(lookahead = 0.5): void {
    const now = this.g.ctx.currentTime;
    const want = this.forced ?? this.desired;
    if (this.current && this.current.theme.id !== want) {
      // Long, gentle crossfades between moods; quicker into festival/title.
      const quick = want === 'festival' || want === 'title' || this.current.theme.id === 'title';
      this.current.stop(quick ? 1.6 : this.fade);
      this.old.push(this.current);
      this.current = null;
      this.restUntil = now + (quick ? 0.4 : 1.5);
    }
    if (this.current?.finished) {
      const [a, b] = this.current.theme.rest;
      this.old.push(this.current);
      this.current = null;
      this.restUntil = now + a + this.rng.next() * (b - a);
    }
    if (!this.current && want && now >= this.restUntil) {
      const th = THEMES[want];
      if (th) {
        const seed = (this.baseSeed * 131 + hashString(want) + this.pieceCount++) >>> 0;
        this.current = new MusicPlayer(this.g, th, seed, now + 0.15, 1.2);
        this.current.setLevel(this.level, 0.1);
      }
    }
    this.current?.pump(now + lookahead);
    this.old = this.old.filter((p) => p.pump(now + lookahead) && !p.finished);
  }

  setLevel(v: number): void {
    if (Math.abs(v - this.level) < 0.01) return;
    this.level = v;
    this.current?.setLevel(v, 2);
  }

  stopAll(fade = 1.5): void {
    if (this.current) {
      this.current.stop(fade);
      this.old.push(this.current);
      this.current = null;
    }
  }
}

/** Offline helper: schedule a theme from t=0 for `seconds`. */
export function scheduleTheme(g: AudioGraph, id: string, seconds: number, seed = 1, solo: TrackName | null = null): MusicPlayer {
  const th = THEMES[id];
  if (!th) throw new Error(`unknown theme ${id}`);
  const p = new MusicPlayer(g, th, seed, 0);
  p.solo = solo;
  p.pump(seconds);
  return p;
}
