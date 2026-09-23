/**
 * Music playback: MusicPlayer schedules one theme's pieces with a look-ahead clock; MusicDirector
 * picks the theme for the moment (title / festival / map / time of day / weather) and hands over
 * between songs without ever overlapping two keys:
 *
 *   - a mood drift in the same place (hour, weather) waits for the current phrase to end, then the
 *     old song fades over ≤ 2.5 s and the new one starts only once the old is silent;
 *   - a change of place fades the old song out quickly (≤ 1.6 s) and starts the new one after it;
 *   - after a song ends there is a stretch of ambience only before the next, like a hand-composed OST.
 *
 * Every decision is logged to a small trace (`trace`) that the game exposes in __game.info().audio.
 */
import type { AudioGraph } from './graph';
import { Composer, type Piece, type ThemeDef, type TrackName } from './composer';
import { INSERTS, INSTRUMENTS, TAIL, type InstrumentName } from './instruments';
import { THEMES } from './themes';
import { Rand, hashString } from './dsp';
import { PiecePrefetch } from './prefetch';

/** Polyphony priority per track: melody and bass always play; texture thins first. */
const PRIO: Record<TrackName, number> = { melody: 3, bass: 3, counter: 2, accomp: 2, double: 1, accomp2: 1, pad: 1, perc: 1 };

export class MusicPlayer {
  readonly out: GainNode;
  readonly wet: GainNode;
  private tracks = new Map<TrackName, GainNode>();
  private inputs = new Map<string, AudioNode>();
  private piece: Piece;
  private idx = 0;
  private pieceStart: number;
  private stopAt = Infinity;
  private seed: number;
  /** Absolute time when the current (last) piece's music ends. */
  endTime: number;
  /** Offline stem renders: only schedule this track. */
  solo: TrackName | null = null;
  /** Notes scheduled (diagnostics). */
  notes = 0;

  constructor(private g: AudioGraph, readonly theme: ThemeDef, seed: number, startAt: number, fadeIn = 0, private pieces: PiecePrefetch | null = null) {
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
    // Per-song mastering shelf on the dry bus and the reverb send alike.
    const shelf = (dest: AudioNode): AudioNode => {
      if (!theme.sheen) return dest;
      const f = ctx.createBiquadFilter();
      f.type = 'highshelf';
      f.frequency.value = 2400;
      f.gain.value = theme.sheen;
      f.connect(dest);
      return f;
    };
    this.out.connect(shelf(g.musicBus));
    this.wet.connect(shelf(g.hall));
    this.piece = pieces ? pieces.take(theme, seed) : new Composer(theme, seed).compose();
    // Seamless loops chain the next piece on the downbeat: have it composed in the background by then.
    if (theme.rest[1] === 0) pieces?.request(theme, seed + 1);
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

  /** Track input for an instrument: through its per-track insert (body IR, formant EQ) if it has one. */
  private input(name: TrackName, inst: InstrumentName): AudioNode {
    const key = `${name}:${inst}`;
    let n = this.inputs.get(key);
    if (!n) {
      const make = INSERTS[inst];
      n = make ? make(this.g, this.track(name)) : this.track(name);
      this.inputs.set(key, n);
    }
    return n;
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
          this.piece = this.pieces ? this.pieces.take(this.theme, this.seed) : new Composer(this.theme, this.seed).compose();
          this.pieces?.request(this.theme, this.seed + 1);
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
      const at = Math.max(t, this.g.ctx.currentTime);
      if (!this.g.voiceStart(at, ev.dur + (TAIL[ev.inst] ?? 0.4), PRIO[ev.track])) continue;
      this.notes++;
      INSTRUMENTS[ev.inst](this.g, this.input(ev.track, ev.inst), at, ev.midi, ev.dur, Math.max(0.05, Math.min(1.2, ev.vel)), ev.o);
    }
  }

  /**
   * Absolute time of the next phrase boundary (a bar whose index in its section is a multiple of
   * 4, or a section start) at least `min` seconds from now, if one comes within `max` seconds.
   */
  nextPhrase(now: number, min: number, max: number): number | null {
    const bars = this.piece.barInfo ?? [];
    for (const b of bars) {
      const t = this.pieceStart + b.t;
      if (t < now + min) continue;
      if (t > now + max) break;
      if (b.i % 4 === 0) return t;
    }
    const end = this.pieceStart + this.piece.duration;
    return end >= now + min && end <= now + max ? end : null;
  }

  /** Current key including any lift in progress (for tuned SFX). */
  keyAt(now: number): number {
    const bars = this.piece.barInfo ?? [];
    let shift = 0;
    for (const b of bars) {
      if (this.pieceStart + b.t > now) break;
      shift = b.shift;
    }
    return this.theme.key + shift;
  }

  /** Fade out over `time` seconds starting at `at` (default now) and stop scheduling. */
  stop(time: number, at = this.g.ctx.currentTime): void {
    const now = this.g.ctx.currentTime;
    const t0 = Math.max(now, at);
    this.stopAt = t0 + time;
    for (const n of [this.out, this.wet]) {
      n.gain.cancelScheduledValues(now);
      n.gain.setValueAtTime(n.gain.value, now);
      if (t0 > now) n.gain.setValueAtTime(n.gain.value, t0);
      // Equal-power-ish: most of the drop happens early, the tail is silent by the end.
      n.gain.setTargetAtTime(0, t0, time / 4);
      n.gain.setValueAtTime(0, t0 + time);
    }
    this.endTime = Math.min(this.endTime, t0 + time);
    if (!this.g.offline) {
      setTimeout(() => {
        this.out.disconnect();
        this.wet.disconnect();
      }, (t0 - now + time + 4) * 1000);
    }
  }

  /** Scale the level (e.g. quieter at night, muffled indoors). */
  setLevel(v: number, tau = 1.5): void {
    const now = this.g.ctx.currentTime;
    if (now < this.stopAt && this.stopAt === Infinity) {
      this.out.gain.setTargetAtTime(this.theme.gain * v, now, tau);
      this.wet.gain.setTargetAtTime(this.theme.gain * v, now, tau);
    }
  }

  get stopping(): boolean {
    return this.stopAt !== Infinity;
  }

  get finished(): boolean {
    return this.g.ctx.currentTime > this.endTime + 1;
  }
}

export interface DirectorTrace {
  t: number;
  want: string | null;
  current: string | null;
  restUntil: number;
  old: number;
  note: string;
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
  /** Crossfade style for the next change: 'drift' = same place (phrase-quantised), 'move' = new place. */
  handoff: 'drift' | 'move' = 'move';
  /** Recent decisions, newest last (debugging the state machine from __game.info().audio). */
  readonly trace: DirectorTrace[] = [];
  private lastNote = '';

  /** Upcoming songs are composed in a worker (real-time contexts only) so a song start never costs a frame. */
  readonly pieces: PiecePrefetch;

  constructor(private g: AudioGraph, seed = 1) {
    this.rng = new Rand(seed);
    this.pieces = new PiecePrefetch(!g.offline);
  }

  /** When the director started waiting on the worker for a song that is due (null = not waiting). */
  private waitSince: number | null = null;

  private nextSeed(want: string): number {
    return (this.baseSeed * 131 + hashString(want) + this.pieceCount) >>> 0;
  }

  get playing(): string | null {
    return this.current?.theme.id ?? null;
  }
  get key(): number {
    return this.current?.keyAt(this.g.ctx.currentTime) ?? 60;
  }
  get resting(): boolean {
    return !this.current && this.g.ctx.currentTime < this.restUntil;
  }
  /** Seconds until the next song may start (0 when not resting). */
  get restLeft(): number {
    return Math.max(0, this.restUntil - this.g.ctx.currentTime);
  }
  get oldCount(): number {
    return this.old.length;
  }

  private log(note: string, want: string | null): void {
    if (note === this.lastNote) return;
    this.lastNote = note;
    this.trace.push({ t: Math.round(this.g.ctx.currentTime * 100) / 100, want, current: this.playing, restUntil: Math.round(this.restUntil * 100) / 100, old: this.old.length, note });
    if (this.trace.length > 16) this.trace.shift();
  }

  /** New day / new context: next piece starts fresh with a seed for this day. */
  reseed(daySeed: number): void {
    this.baseSeed = daySeed;
    this.pieceCount = 0;
  }

  /** Start the wanted theme as soon as the old one is out of the way, skipping any rest. */
  kick(): void {
    const now = this.g.ctx.currentTime;
    const busy = this.old.reduce((t, p) => Math.max(t, p.stopping ? p.endTime : 0), 0);
    this.restUntil = Math.max(0, busy > now ? busy + 0.2 : 0);
  }

  update(lookahead = 0.5): void {
    const now = this.g.ctx.currentTime;
    const want = this.forced ?? this.desired;
    if (this.current && this.current.theme.id !== want) {
      const cur = this.current;
      const quick = !want || want.startsWith('festival') || want === 'title' || cur.theme.id === 'title' || this.handoff === 'move';
      let at = now;
      let fade = quick ? 1.4 : 2.5;
      if (!quick) {
        // Same place, new mood: finish the phrase first (within 6 s), then a short fade.
        at = cur.nextPhrase(now, 0.2, 6) ?? now;
      } else if (!want) fade = 2;
      cur.stop(fade, at);
      this.old.push(cur);
      this.current = null;
      // The new song waits until the old one is silent: never two keys at once.
      this.restUntil = at + fade + 0.35;
      this.log(`handoff ${cur.theme.id}→${want ?? 'silence'} at +${(at - now).toFixed(1)}s fade ${fade}s`, want);
    }
    if (this.current?.finished) {
      const [a, b] = this.current.theme.rest;
      this.old.push(this.current);
      this.log(`finished ${this.current.theme.id}`, want);
      this.current = null;
      this.restUntil = now + a + this.rng.next() * (b - a);
    }
    if (!this.current && want) {
      // Compose the next song in the background while the old one fades / the score rests; at start
      // time wait (≤ 0.4 s) for the worker rather than composing on the frame.
      const th = THEMES[want];
      if (th) this.pieces.request(th, this.nextSeed(want));
      if (th && now >= this.restUntil && !this.pieces.settled(th, this.nextSeed(want))) {
        this.waitSince ??= now;
        if (now - this.waitSince < 0.4) {
          this.old = this.old.filter((p) => p.pump(now + lookahead) && !p.finished);
          return;
        }
      }
    }
    this.waitSince = null;
    if (!this.current && want && now >= this.restUntil) {
      const th = THEMES[want];
      if (th) {
        const seed = this.nextSeed(want);
        this.pieceCount++;
        this.current = new MusicPlayer(this.g, th, seed, now + 0.1, 0.6, this.pieces);
        this.current.setLevel(this.level, 0.1);
        this.log(`start ${want}`, want);
      } else this.log(`unknown theme ${want}`, want);
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
      this.log(`stopAll ${this.current.theme.id}`, null);
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
