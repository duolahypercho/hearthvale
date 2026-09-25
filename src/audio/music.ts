/**
 * Music playback: MusicPlayer schedules one theme's pieces with a look-ahead clock; MusicDirector
 * picks the theme for the moment (title / festival / map / time of day / weather), resolves
 * playlists ('farm:spring' → one of the season's songs, see select.ts) and crossfades between songs
 * without two keys ever fighting:
 *
 *   - a change of place crossfades at once: the old song fades over 1.3 s while the new one opens
 *     with a key bridge — a soft bar of the new tonic chord built only from tones the two keys
 *     share — so the overlap is consonant and there is no dead air;
 *   - a mood drift in the same place (hour, weather) first waits for the current phrase to end,
 *     then makes the same bridged crossfade (a slower 2.5 s fade);
 *   - after a song ends there is a short breath of ambience (5–15 s, `ThemeDef.rest`) before the next;
 *     a change of place or mood during that breath starts the new song at once (no inherited rest).
 *
 * Scheduling runs well ahead of the clock (the game passes MUSIC_LOOKAHEAD, 1.5 s), so a main-thread
 * stall shorter than that costs nothing. A note that is due but slightly late is still played (at
 * once); only notes more than MUSIC_SCHED.staleAfter behind the clock are skipped (MUSIC_STATS counts both).
 *
 * Every decision is logged to a small trace (`trace`) that the game exposes in __game.info().audio.
 */
import type { AudioGraph } from './graph';
import { Composer, type Piece, type ThemeDef, type TrackName } from './composer';
import { INSERTS, INSTRUMENTS, TAIL, type InstrumentName } from './instruments';
import { THEMES } from './themes';
import { Rand, hashString } from './dsp';
import { PiecePrefetch } from './prefetch';
import { loudnessTrim } from './loudness';
import { PLAYLISTS, songFor } from './select';
import { MODES, chordPcs, parseChord, voiceChord, type ModeName } from './theory';

/** The key the outgoing song was in, so the incoming one can open on shared tones. */
export interface KeyBridge {
  key: number;
  mode: ModeName;
}

/** How far ahead the real-time game schedules the score (s): covers main-thread stalls up to this long. */
export const MUSIC_LOOKAHEAD = 1.5;
/**
 * `staleAfter`: a due note later than this (s) is stale — skipped instead of piled up (a tab that was
 * frozen). Mutable only so the continuity harness can replay the old 50 ms rule as a baseline.
 */
export const MUSIC_SCHED = { staleAfter: 0.25 };
/** Worker wait cap at song start (s): after this the song is composed on the frame rather than kept silent. */
const WORKER_WAIT = 1.5;
/** Scheduling diagnostics (all players): notes played slightly late, notes skipped as stale. */
export const MUSIC_STATS = { late: 0, skipped: 0 };

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
  /** Called for every melody note as it is scheduled (the now-playing card's floating notes). */
  onMelody: ((at: number, midi: number, dur: number) => void) | null = null;

  /** Normalised output level of this theme (theme.gain × loudness trim). */
  private lvl = 1;

  /** Bridge events (absolute times) played before the piece proper. */
  private pre: { t: number; inst: InstrumentName; midi: number; dur: number; vel: number; track: TrackName }[] = [];

  constructor(
    private g: AudioGraph,
    readonly theme: ThemeDef,
    seed: number,
    startAt: number,
    fadeIn = 0,
    private pieces: PiecePrefetch | null = null,
    bridge: KeyBridge | null = null,
    /** The playlist / selection id this song was started for ('farm:spring' or the theme id). */
    readonly group: string = theme.id,
  ) {
    const ctx = g.ctx;
    this.seed = seed;
    this.out = ctx.createGain();
    this.wet = ctx.createGain();
    // Theme level: the arrangement's own trim × loudness normalisation (loudness.ts).
    const lvl = (this.lvl = theme.gain * loudnessTrim(theme.id));
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
    // Per-song tone fixes (the mines: a 60 Hz high-pass under the drone, 150–250 Hz mud cut).
    let dry: AudioNode = shelf(g.musicBus);
    if (theme.eq?.cut) {
      const c = ctx.createBiquadFilter();
      c.type = 'peaking';
      c.frequency.value = theme.eq.cut.f;
      c.Q.value = theme.eq.cut.q ?? 0.9;
      c.gain.value = theme.eq.cut.db;
      c.connect(dry);
      dry = c;
    }
    if (theme.eq?.hp) {
      const h = ctx.createBiquadFilter();
      h.type = 'highpass';
      h.frequency.value = theme.eq.hp;
      h.Q.value = 0.7;
      h.connect(dry);
      dry = h;
    }
    this.out.connect(dry);
    this.wet.connect(shelf(g.hall));
    this.piece = pieces ? pieces.take(theme, seed) : new Composer(theme, seed).compose();
    // Seamless loops chain the next piece on the downbeat: have it composed in the background by then.
    if (theme.rest[1] === 0) pieces?.request(theme, seed + 1);
    this.pieceStart = startAt;
    if (bridge) this.pieceStart += this.buildBridge(bridge, startAt);
    this.endTime = this.pieceStart + this.piece.duration;
  }

  /**
   * One bar (1.2–1.8 s) before the piece: the new tonic chord, voiced only with the pitch classes
   * the outgoing key also owns (a G-major song after a C-major one gets the whole triad; after
   * E major, just G and D ...), swelled on the string pad with a slow roll on the song's own
   * accompaniment instrument. Returns its length.
   */
  private buildBridge(b: KeyBridge, at: number): number {
    const th = this.theme;
    const beat = 60 / th.bpm;
    const bar = th.meter === '4/4' ? beat * 4 : th.meter === '3/4' ? beat * 3 : beat * 2;
    const len = Math.max(1.2, Math.min(1.8, bar));
    const oldScale = MODES[b.mode].map((s) => (b.key + s) % 12);
    const tonic = parseChord(th.mode === 'major' || th.mode === 'lydian' || th.mode === 'mixolydian' ? 'I' : 'i');
    let pcs = chordPcs(tonic, th.key % 12).filter((pc) => oldScale.includes(pc));
    if (!pcs.length) pcs = [th.key % 12];
    const v = voiceChord(tonic, th.key % 12, 3, 55, 72, null).filter((m) => pcs.includes(m % 12));
    const voicing = v.length ? v : [55 + ((((th.key % 12) - 55) % 12) + 12) % 12];
    const roll = th.accomp?.inst ?? 'harp';
    voicing.forEach((m, k) => {
      this.pre.push({ t: at + k * 0.012, inst: 'pad', midi: m, dur: len + 0.6, vel: 0.46, track: 'pad' });
      this.pre.push({ t: at + 0.05 + k * 0.11, inst: roll, midi: m + 12, dur: len, vel: 0.34 - k * 0.04, track: 'accomp' });
    });
    this.pre.sort((x, y) => x.t - y.t);
    return len;
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
    // Stage: the tune near the middle, harmony and counter-line out at ±0.5…0.7 on opposite sides.
    const side = Math.sign(mix.pan) || (name === 'counter' || name === 'accomp2' ? 1 : -1);
    p.pan.value = name === 'accomp' || name === 'accomp2' || name === 'counter' ? side * Math.min(0.8, Math.max(0.55, Math.abs(mix.pan) * 1.8)) : mix.pan;
    const send = ctx.createGain();
    send.gain.value = mix.send;
    // Track EQ: an air shelf on the tune (it should glint above the band), and the 250–400 Hz
    // boxiness taken out of the harmony layers so the low-mids don't wall up under the melody.
    let head: AudioNode = t;
    if (name === 'melody' || name === 'double') {
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 9000;
      air.gain.value = 3;
      head = head.connect(air);
    } else if (name === 'accomp' || name === 'accomp2' || name === 'pad') {
      const box = ctx.createBiquadFilter();
      box.type = 'peaking';
      box.frequency.value = 320;
      box.Q.value = 1.1;
      box.gain.value = -2.5;
      head = head.connect(box);
    }
    if (name === 'double') {
      // Doubles are spread with a Haas pair: the dry copy left of centre, a 15 ms copy right.
      p.pan.value = -0.55;
      const late = ctx.createDelay(0.05);
      late.delayTime.value = 0.015;
      const pr = ctx.createStereoPanner();
      pr.pan.value = 0.55;
      const lg = ctx.createGain();
      lg.gain.value = 0.8;
      head.connect(late).connect(lg).connect(pr).connect(this.out);
    }
    if (name === 'melody') {
      // A pair of early reflections (11 / 17 ms, either side) puts the soloist on a stage instead
      // of inside the listener's head, without moving it off centre.
      for (const [dt, pan] of [[0.011, -0.8], [0.017, 0.8]] as const) {
        const er = ctx.createDelay(0.05);
        er.delayTime.value = dt;
        const eg = ctx.createGain();
        eg.gain.value = 0.26;
        const ep = ctx.createStereoPanner();
        ep.pan.value = pan;
        head.connect(er).connect(eg).connect(ep).connect(this.out);
      }
    }
    head.connect(p).connect(this.out);
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
    while (this.pre.length && this.pre[0]!.t < until) {
      const e = this.pre.shift()!;
      if (e.t >= this.stopAt) continue;
      if (e.t < this.g.ctx.currentTime - MUSIC_SCHED.staleAfter) {
        MUSIC_STATS.skipped++;
        continue;
      }
      const at = Math.max(e.t, this.g.ctx.currentTime);
      if (!this.g.voiceStart(at, e.dur + (TAIL[e.inst] ?? 0.4), 2)) continue;
      INSTRUMENTS[e.inst](this.g, this.input(e.track, e.inst), at, e.midi, e.dur, e.vel);
    }
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
      // Slightly late (a long frame): play it now. Stale (the tab was frozen): skip rather than pile up.
      const now = this.g.ctx.currentTime;
      if (t < now - MUSIC_SCHED.staleAfter) {
        MUSIC_STATS.skipped++;
        continue;
      }
      if (t < now - 0.005) MUSIC_STATS.late++;
      const at = Math.max(t, now);
      if (!this.g.voiceStart(at, ev.dur + (TAIL[ev.inst] ?? 0.4), PRIO[ev.track])) continue;
      this.notes++;
      INSTRUMENTS[ev.inst](this.g, this.input(ev.track, ev.inst), at, ev.midi, ev.dur, Math.max(0.05, Math.min(1.2, ev.vel)), ev.o);
      if (ev.track === 'melody' && ev.dur > 0.08) this.onMelody?.(at, ev.midi, ev.dur);
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
      this.out.gain.setTargetAtTime(this.lvl * v, now, tau);
      this.wet.gain.setTargetAtTime(this.lvl * v, now, tau);
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
  /** Planned start of the song after a pending handoff (a drift waits for the phrase end). */
  private handoffStart = 0;
  private rng: Rand;
  private baseSeed = 1;
  /** Songs started today, per playlist ('farm:spring') and per song ('#spring'): rotation + seeds. */
  private counts = new Map<string, number>();
  /** Crossfade in progress: the next song opens on tones it shares with this key. */
  private bridge: KeyBridge | null = null;
  /** Selection id the game wants right now: a theme or a playlist (null = silence). */
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
  /** Melody-note hook handed to every new player (see MusicPlayer.onMelody). */
  onMelody: ((at: number, midi: number, dur: number) => void) | null = null;

  constructor(private g: AudioGraph, seed = 1, pieces?: PiecePrefetch) {
    this.rng = new Rand(seed);
    this.pieces = pieces ?? new PiecePrefetch(!g.offline);
    if (!g.offline) this.pieces.attach(g);
  }

  /** When the director started waiting on the worker for a song that is due (null = not waiting). */
  private waitSince: number | null = null;
  /** The selection seen by the last update (a change during a rest starts the new song at once). */
  private lastWant: string | null | undefined = undefined;
  /** The player whose successor has already been requested from the worker. */
  private nextAsked: MusicPlayer | null = null;

  /** Arrangement seed for the k-th play of song `id` on a day (also used to prefetch before audio starts). */
  static seedFor(daySeed: number, id: string, k = 0): number {
    return (daySeed * 131 + hashString(id) + k * 7919) >>> 0;
  }

  private nextSeed(id: string): number {
    return MusicDirector.seedFor(this.baseSeed, id, this.counts.get(`#${id}`) ?? 0);
  }

  /** The concrete song a selection id resolves to next (playlists rotate by day; see select.ts). */
  resolve(want: string | null): string | null {
    if (!want) return null;
    if (this.current && this.current.group === want) return this.current.theme.id;
    return PLAYLISTS[want] ? songFor(want, this.baseSeed, this.counts.get(want) ?? 0) : want;
  }

  /** Compose the song `want` resolves to in the background now (no-op if already requested). */
  prefetch(want: string | null): void {
    const id = this.resolve(want);
    const th = id ? THEMES[id] : undefined;
    if (th && !(this.current && this.current.theme.id === id)) this.pieces.request(th, this.nextSeed(id!));
  }

  get playing(): string | null {
    return this.current?.theme.id ?? null;
  }
  /** Selection id (playlist or theme) of the song playing. */
  get playingGroup(): string | null {
    return this.current?.group ?? null;
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

  /** New day / new context: playlists restart their day rotation, seeds follow the day. */
  reseed(daySeed: number): void {
    this.baseSeed = daySeed;
    this.counts.clear();
  }

  /** Start the wanted theme as soon as any pending handoff allows, skipping a rest between songs. */
  kick(): void {
    const now = this.g.ctx.currentTime;
    this.restUntil = this.handoffStart > now ? this.handoffStart : 0;
  }

  update(lookahead = 0.5): void {
    const now = this.g.ctx.currentTime;
    const want = this.forced ?? this.desired;
    if (this.current && this.current.group !== want) {
      const cur = this.current;
      if (!want) {
        cur.stop(2);
        this.bridge = null;
        this.restUntil = this.handoffStart = now + 2.2;
        this.log(`handoff ${cur.theme.id}→silence fade 2s`, want);
      } else {
        // A new place crossfades now; a new mood in the same place finishes the phrase first.
        const drift = this.handoff === 'drift' && !want.startsWith('festival') && want !== 'title' && cur.theme.id !== 'title';
        const at = drift ? cur.nextPhrase(now, 0.2, 6) ?? now : now;
        const fade = drift ? 2.5 : 1.3;
        cur.stop(fade, at);
        this.bridge = { key: cur.keyAt(at), mode: cur.theme.mode };
        this.restUntil = this.handoffStart = at + (drift ? 0.6 : 0.05);
        this.log(`crossfade ${cur.theme.id}→${want} at +${(at - now).toFixed(1)}s fade ${fade}s`, want);
      }
      this.old.push(cur);
      this.current = null;
    }
    // A new selection never inherits the previous song's rest: entering town (or night falling)
    // during the breath after a farm song starts the town song now (a pending crossfade still holds).
    if (want !== this.lastWant) {
      if (this.lastWant !== undefined && !this.current && this.restUntil > now && this.handoffStart <= now) {
        this.kick();
        this.log(`${want ?? 'silence'} wanted: rest cut`, want);
      }
      this.lastWant = want;
    }
    if (this.current?.finished) {
      const [a, b] = this.current.theme.rest;
      this.old.push(this.current);
      this.log(`finished ${this.current.theme.id}`, want);
      this.current = null;
      this.bridge = null;
      this.restUntil = now + a + this.rng.next() * (b - a);
    }
    if (!this.current && want) {
      const id = this.resolve(want)!;
      const th = THEMES[id];
      if (!th) {
        this.log(`unknown theme ${id}`, want);
      } else {
        // Compose the next song in the worker while the old one fades / the score rests (and, for
        // the same selection, while the previous song is still playing — see below). At start time
        // prefer the worker's piece, but never hold the score silent for more than WORKER_WAIT: a
        // slow or hung worker falls back to composing here (offline renders have no worker at all).
        const seed = this.nextSeed(id);
        this.pieces.request(th, seed);
        if (now >= this.restUntil && this.pieces.hasWorker && !this.pieces.settled(th, seed)) {
          this.waitSince ??= now;
          if (now - this.waitSince < WORKER_WAIT) {
            this.old = this.old.filter((p) => p.pump(now + lookahead) && !p.finished);
            return;
          }
        }
        this.waitSince = null;
        if (now >= this.restUntil) {
          this.counts.set(want, (this.counts.get(want) ?? 0) + 1);
          this.counts.set(`#${id}`, (this.counts.get(`#${id}`) ?? 0) + 1);
          const bridge = this.bridge;
          this.bridge = null;
          this.handoffStart = 0;
          this.current = new MusicPlayer(this.g, th, seed, now + 0.1, bridge ? 1.2 : 0.6, this.pieces, bridge, want);
          this.current.onMelody = this.onMelody;
          this.current.setLevel(this.level, 0.1);
          this.log(`start ${id}${bridge ? ' (bridged)' : ''}`, want);
        }
      }
    }
    const cur = this.current;
    cur?.pump(now + lookahead);
    // The song after this one (same selection) is composed while this one's last half-minute plays,
    // so the next start never waits on the worker.
    if (cur && cur !== this.nextAsked && !cur.stopping && cur.theme.rest[1] > 0 && cur.endTime - now < 30) {
      this.nextAsked = cur;
      const nid = PLAYLISTS[cur.group] ? songFor(cur.group, this.baseSeed, this.counts.get(cur.group) ?? 0) : cur.theme.id;
      const nth = THEMES[nid];
      if (nth) this.pieces.request(nth, this.nextSeed(nid));
    }
    this.old = this.old.filter((p) => p.pump(now + lookahead) && !p.finished);
  }

  /**
   * Drop every player and start clean (the adapter calls this when update keeps throwing): a quick
   * fade on whatever is sounding, no rest, no pending handoff — the next update starts the wanted song.
   */
  recover(): void {
    for (const p of [this.current, ...this.old]) {
      if (!p) continue;
      try {
        p.stop(0.3);
      } catch {
        /* a broken player may not even fade: it is dropped anyway */
      }
    }
    this.current = null;
    this.old = [];
    this.bridge = null;
    this.waitSince = null;
    this.restUntil = this.handoffStart = 0;
    this.log('recover: players dropped after repeated update failures', this.forced ?? this.desired);
  }

  setLevel(v: number): void {
    if (Math.abs(v - this.level) < 0.01) return;
    this.level = v;
    this.current?.setLevel(v, 2);
  }

  stopAll(fade = 1.5): void {
    this.bridge = null;
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
