/**
 * Offline renders for critics and regression checks (driven by scripts/audio-render.mjs in
 * headless Chromium): every theme, ambience preset and SFX rendered through the real mixer graph
 * (limiter included) with an OfflineAudioContext. Results come back as base64 Float32 stereo.
 */
import { AudioGraph } from './graph';
import { loadDucker } from './ducker';
import { MusicDirector, scheduleTheme, MUSIC_LOOKAHEAD, MUSIC_SCHED, MUSIC_STATS } from './music';
import { chooseTheme, STORM_OUTDOOR_LEVEL } from './select';
import { Ambience, type EnvState } from './ambience';
import { Sfx, SFX_NAMES, VOICES } from './sfx';
import { THEMES } from './themes';
import { Composer, type TrackName } from './composer';
export { critiquePiece, critiqueAll } from './critique';

export interface Rendered {
  name: string;
  sampleRate: number;
  /** base64 of interleaved Float32 stereo. */
  data: string;
  frames: number;
  markers?: { name: string; t: number }[];
  notes?: number;
}

function encode(buf: AudioBuffer): string {
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const inter = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    inter[i * 2] = L[i]!;
    inter[i * 2 + 1] = R[i]!;
  }
  const bytes = new Uint8Array(inter.buffer);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

const ENV = (o: Partial<EnvState>): EnvState => ({ map: 'farm', hour: 9, season: 'spring', weather: 'sun', night: 0, fountain: 0, water: 0, indoor: false, key: 60, ...o });

export const AMBIENCE_PRESETS: Record<string, EnvState> = {
  'farm-spring-morning': ENV({ hour: 7.5 }),
  'farm-summer-noon': ENV({ hour: 13, season: 'summer' }),
  'farm-fall-wind': ENV({ hour: 15, season: 'fall', weather: 'wind' }),
  'farm-winter-snow': ENV({ hour: 11, season: 'winter', weather: 'snow' }),
  'farm-summer-night': ENV({ hour: 22.5, season: 'summer', night: 1, water: 0.4 }),
  'farm-rain': ENV({ hour: 14, weather: 'rain' }),
  'farm-storm': ENV({ hour: 16, weather: 'storm' }),
  'town-day': ENV({ map: 'town', hour: 11, fountain: 0.8 }),
  beach: ENV({ map: 'beach', hour: 16, season: 'summer', water: 1 }),
  mine: ENV({ map: 'mine', hour: 12 }),
  'house-night-rain': ENV({ map: 'house', hour: 21, night: 1, indoor: true, weather: 'rain', season: 'fall' }),
  'forest-stream': ENV({ map: 'forest', hour: 10, season: 'summer', water: 0.8 }),
  'farm-pond-dusk': ENV({ hour: 19.5, season: 'spring', night: 0.6, water: 0.7 }),
  'festival-crowd': ENV({ map: 'fest-spring', hour: 12, season: 'spring' }),
};

/** Which ambience goes under each theme in the "mix" renders. */
const MIX_ENV: Record<string, EnvState> = {
  spring: AMBIENCE_PRESETS['farm-spring-morning']!,
  summer: AMBIENCE_PRESETS['farm-summer-noon']!,
  fall: ENV({ hour: 15, season: 'fall' }),
  winter: AMBIENCE_PRESETS['farm-winter-snow']!,
  town: AMBIENCE_PRESETS['town-day']!,
  beach: AMBIENCE_PRESETS.beach!,
  mine: AMBIENCE_PRESETS.mine!,
  night: AMBIENCE_PRESETS['farm-summer-night']!,
  rain: AMBIENCE_PRESETS['farm-rain']!,
  festival: ENV({ map: 'town', hour: 20, season: 'summer', night: 0.8, fountain: 0.5 }),
  title: ENV({ hour: 18.7 }),
  inn: ENV({ map: 'town', hour: 18.5, fountain: 0.3 }),
  forest: AMBIENCE_PRESETS['forest-stream']!,
  'mine-ice': AMBIENCE_PRESETS.mine!,
  'mine-lava': AMBIENCE_PRESETS.mine!,
};

/** Render-wide options (set by the harness): `liveBudget` applies the game's 72-voice polyphony budget. */
const renderOpts = { liveBudget: false };
export function setRenderOptions(o: Partial<typeof renderOpts>): typeof renderOpts {
  Object.assign(renderOpts, o);
  return { ...renderOpts };
}

/** A graph on a fresh offline context, with the sidechain worklet registered first (as in game). */
async function offlineGraph(seconds: number, sr: number): Promise<{ ctx: OfflineAudioContext; g: AudioGraph }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const ok = await loadDucker(ctx);
  const g = new AudioGraph(ctx, 1234, undefined, { worklet: ok, liveBudget: renderOpts.liveBudget });
  if (!ok) g.attachSidechain(false);
  return { ctx, g };
}

async function render(seconds: number, sr: number, build: (g: AudioGraph) => void): Promise<AudioBuffer> {
  const { ctx, g } = await offlineGraph(seconds, sr);
  build(g);
  return ctx.startRendering();
}

function tickAmbience(g: AudioGraph, env: EnvState, seconds: number): void {
  const amb = new Ambience(g, 7);
  for (let t = 0; t < seconds; t += 0.05) amb.tick(t, env, 0.12);
}

export async function renderTheme(id: string, seconds = 30, sr = 44100, seed = 1, withAmbience = false, solo: TrackName | null = null): Promise<Rendered> {
  let notes = 0;
  const buf = await render(seconds, sr, (g) => {
    scheduleTheme(g, id, seconds, seed, solo);
    notes = new Composer(THEMES[id]!, seed).compose().events.filter((e) => e.t < seconds).length;
    const env = MIX_ENV[id] ?? MIX_ENV[id.split('-')[0]!] ?? MIX_ENV.spring!;
    if (withAmbience) tickAmbience(g, { ...env, key: THEMES[id]!.key }, seconds);
  });
  return { name: solo ? `stem-${id}-${solo}` : withAmbience ? `mix-${id}` : `theme-${id}`, sampleRate: sr, data: encode(buf), frames: buf.length, notes };
}

export async function renderAmbience(preset: string, seconds = 30, sr = 44100): Promise<Rendered> {
  const env = AMBIENCE_PRESETS[preset];
  if (!env) throw new Error(`unknown ambience preset ${preset}`);
  const buf = await render(seconds, sr, (g) => tickAmbience(g, env, seconds));
  return { name: `amb-${preset}`, sampleRate: sr, data: encode(buf), frames: buf.length };
}

/** Every SFX in sequence (1.6 s apart; long stingers get more room) + a line of dialogue per voice. */
export async function renderSfxReel(sr = 44100, only: string[] | null = null): Promise<Rendered> {
  const markers: { name: string; t: number }[] = [];
  let t = 0.3;
  const long: Record<string, number> = { treefall: 3.2, hall: 5, lantern: 3.5, catch: 2.4, 'catch:perfect': 2.6, water: 2, cast: 2.2, sleep: 2.4, thunder: 3 };
  for (const n of only ?? SFX_NAMES) {
    if (n === 'reel' || n === 'blip') continue;
    markers.push({ name: n, t });
    t += long[n] ?? 1.3;
  }
  if (!only) {
    for (const v of Object.keys(VOICES)) {
      markers.push({ name: `voice:${v}`, t });
      t += 2.6;
    }
  }
  if (!only || only.includes('reel')) {
    markers.push({ name: 'reel', t });
    t += 2;
  }
  const seconds = t + 1;
  const buf = await render(seconds, sr, (g) => {
    const sfx = new Sfx(g, 5);
    sfx.key = 62;
    for (const m of markers) {
      if (m.name.startsWith('voice:')) {
        const voice = VOICES[m.name.slice(6)]!;
        // Dialogue murmurs one "word" per typed word, paced like the typewriter (~28 chars/s).
        const line = 'Well hello there, neighbour! Lovely morning, isn\'t it?';
        let tt = m.t;
        for (const w of line.split(' ')) {
          sfx.murmur(voice, w, { at: tt });
          tt += Math.max(0.2, (w.length + 1) / 28);
        }
      } else if (m.name === 'reel') {
        for (let tt = 0; tt < 1.5; tt += 0.06) sfx.play('reel', { at: m.t + tt, gain: 0.8 });
      } else sfx.play(m.name, { at: m.t });
    }
  });
  return { name: 'sfx-reel', sampleRate: sr, data: encode(buf), frames: buf.length, markers };
}

/**
 * The live state machine, offline: a MusicDirector ticked every 100 ms through OfflineAudioContext
 * suspend points, wanting `from` until `at` seconds and then `to` (a same-place mood drift by
 * default: the handoff waits for the phrase end; `move` = change of place, crossfade at once). The
 * render shows the bridged crossfade: no dead air, the new song opening on shared tones.
 * Markers: the change request and the director's trace.
 */
export async function renderTransition(from: string, to: string, at = 14, seconds = 30, handoff: 'drift' | 'move' = 'drift', sr = 44100): Promise<Rendered> {
  const { ctx, g } = await offlineGraph(seconds, sr);
  const dir = new MusicDirector(g, 3);
  dir.desired = from;
  const markers: { name: string; t: number }[] = [{ name: `want ${to}`, t: at }];
  const step = 0.1;
  for (let t = step; t < seconds - step; t += step) {
    const tt = Math.round(t * 1000) / 1000;
    void ctx.suspend(tt).then(() => {
      if (tt >= at && dir.desired !== to) {
        dir.handoff = handoff;
        dir.desired = to;
      }
      dir.update(0.3);
      void ctx.resume();
    });
  }
  dir.update(0.3);
  const buf = await ctx.startRendering();
  for (const tr of dir.trace) markers.push({ name: tr.note, t: tr.t });
  return { name: `transition-${from}-${to}${handoff === 'move' ? '-move' : ''}`, sampleRate: sr, data: encode(buf), frames: buf.length, markers };
}

/** One change in a scripted play session (state carries forward; see renderSession). */
export interface SessionEvent {
  t: number;
  map?: string;
  indoor?: boolean;
  weather?: string;
  season?: string;
  /** Set the clock (it then runs at the game's 10 game-minutes per 7 s). */
  hour?: number;
  /** Freeze the "main thread" for this long: the director is not updated (the audio clock runs on). */
  stallMs?: number;
  label?: string;
}

export interface SessionResult {
  seconds: number;
  step: number;
  /** Selection changes: [t, wanted group]. */
  wants: [number, string | null][];
  /** Per step: '1' = a song is current (not resting / stopped), '0' = none. */
  playing: string;
  /** Music RMS per 100 ms block (dBFS, the score alone: nothing else is rendered). */
  rmsDb: number[];
  /** Every director decision (the live trace keeps only the last 16). */
  trace: { t: number; note: string }[];
  /** Per injected stall: notes played late / skipped as stale from its start until 3 s after it. */
  stalls: { t: number; ms: number; late: number; skipped: number }[];
  labels: { t: number; label: string }[];
  lookahead: number;
  staleAfter: number;
}

/**
 * The continuity trace: a scripted play session (places, doorways, weather, clock, injected
 * main-thread stalls) driven through the real selector (select.ts) and MusicDirector, ticked every
 * `step` seconds through OfflineAudioContext suspend points exactly as the adapter does (a change of
 * map = 'move' handoff, same map = 'drift'; indoor / storm levels). Only the score is rendered, so
 * the RMS envelope says when music is actually audible. `lookahead` / `staleAfter` default to the
 * game's; the harness can pass the old values (0.3 s / 0.05 s) to replay the pre-fix behaviour.
 */
export async function renderSession(
  events: SessionEvent[],
  seconds: number,
  opts: { lookahead?: number; staleAfter?: number; sr?: number; step?: number; seed?: number; daySeed?: number } = {},
): Promise<SessionResult> {
  const sr = opts.sr ?? 16000;
  const step = opts.step ?? 0.1;
  const lookahead = opts.lookahead ?? MUSIC_LOOKAHEAD;
  const staleBefore = MUSIC_SCHED.staleAfter;
  MUSIC_SCHED.staleAfter = opts.staleAfter ?? staleBefore;
  const { ctx, g } = await offlineGraph(seconds, sr);
  const dir = new MusicDirector(g, opts.seed ?? 3);
  dir.reseed(opts.daySeed ?? 1001);
  const evs = [...events].sort((a, b) => a.t - b.t);
  const st = { map: 'farm', indoor: false, weather: 'sun', season: 'spring', hour: 9, hourAt: 0 };
  let ei = 0;
  let lastMap = '';
  let stallUntil = -1;
  const wants: [number, string | null][] = [];
  const trace: { t: number; note: string }[] = [];
  const labels: { t: number; label: string }[] = [];
  const stalls: { t: number; ms: number; late: number; skipped: number; l0: number; s0: number; until: number }[] = [];
  const seen = new WeakSet<object>();
  const playing: string[] = [];
  const tick = (tt: number): void => {
    while (ei < evs.length && evs[ei]!.t <= tt + 1e-6) {
      const e = evs[ei++]!;
      if (e.map !== undefined) st.map = e.map;
      if (e.indoor !== undefined) st.indoor = e.indoor;
      if (e.weather !== undefined) st.weather = e.weather;
      if (e.season !== undefined) st.season = e.season;
      if (e.hour !== undefined) {
        st.hour = e.hour;
        st.hourAt = tt;
      }
      if (e.label) labels.push({ t: tt, label: e.label });
      if (e.stallMs) {
        stallUntil = tt + e.stallMs / 1000;
        stalls.push({ t: tt, ms: e.stallMs, late: 0, skipped: 0, l0: MUSIC_STATS.late, s0: MUSIC_STATS.skipped, until: stallUntil + 3 });
      }
    }
    for (const s of stalls) {
      if (s.until >= 0 && tt >= s.until) {
        s.late = MUSIC_STATS.late - s.l0;
        s.skipped = MUSIC_STATS.skipped - s.s0;
        s.until = -1;
      }
    }
    if (tt < stallUntil) {
      playing.push(dir.playing ? '1' : '0');
      return;
    }
    const hour = st.hour + ((tt - st.hourAt) * (10 / 7)) / 60;
    const want = chooseTheme({ map: st.map, hour, season: st.season, weather: st.weather, indoor: st.indoor, title: false, festival: null, forced: null });
    if (want !== dir.desired) {
      dir.handoff = st.map === lastMap ? 'drift' : 'move';
      dir.desired = want;
      wants.push([Math.round(tt * 100) / 100, want]);
    }
    lastMap = st.map;
    dir.setLevel(st.indoor ? 0.9 : st.weather === 'storm' ? STORM_OUTDOOR_LEVEL : 1);
    dir.update(lookahead);
    // The live trace is capped at 16: copy each new decision as it appears.
    for (const x of dir.trace) {
      if (seen.has(x)) continue;
      seen.add(x);
      trace.push({ t: x.t, note: x.note });
    }
    playing.push(dir.playing ? '1' : '0');
  };
  const n = Math.floor((seconds - step) / step);
  for (let i = 1; i <= n; i++) {
    const tt = Math.round(i * step * 1000) / 1000;
    void ctx.suspend(tt).then(() => {
      tick(tt);
      void ctx.resume();
    });
  }
  tick(0);
  let buf: AudioBuffer;
  try {
    buf = await ctx.startRendering();
  } finally {
    MUSIC_SCHED.staleAfter = staleBefore;
  }
  for (const s of stalls) {
    if (s.until >= 0) {
      s.late = MUSIC_STATS.late - s.l0;
      s.skipped = MUSIC_STATS.skipped - s.s0;
    }
  }
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const blk = Math.round(sr * 0.1);
  const rmsDb: number[] = [];
  for (let i = 0; i + blk <= L.length; i += blk) {
    let e = 0;
    for (let j = i; j < i + blk; j++) e += L[j]! * L[j]! + R[j]! * R[j]!;
    rmsDb.push(Math.round(10 * Math.log10(e / (blk * 2) + 1e-12) * 10) / 10);
  }
  return {
    seconds,
    step,
    wants,
    playing: playing.join(''),
    rmsDb,
    trace,
    stalls: stalls.map(({ t, ms, late, skipped }) => ({ t, ms, late, skipped })),
    labels,
    lookahead,
    staleAfter: opts.staleAfter ?? staleBefore,
  };
}

/**
 * The gameplay check: SFX over the score, the question that matters for game feel. The spring
 * theme + the spring-morning farm bed, and a scripted 10 s of farming from 9 s in. Rendered three
 * ways with identical seeds — `full` (everything), `sfx` (the effects alone through the same
 * graph) and `bed` (music + ambience, no effects) — so the harness can measure each effect against
 * the music actually sounding under it (full − sfx = the ducked bed) and how far the sidechain dipped.
 */
export const GAMEPLAY_SCRIPT: { name: string; t: number; verb?: boolean }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ name: 'step:grass', t: 9 + i * 0.32 })),
  { name: 'hoe', t: 12, verb: true },
  { name: 'hoe', t: 12.7, verb: true },
  { name: 'hoe', t: 13.4, verb: true },
  { name: 'water', t: 14.4, verb: true },
  { name: 'harvest', t: 15.8, verb: true },
  { name: 'coin', t: 16.8 },
  { name: 'ui:open', t: 17.8 },
];

export async function renderGameplay(part: 'full' | 'sfx' | 'bed', seconds = 20, sr = 44100, theme = 'spring'): Promise<Rendered> {
  const buf = await render(seconds, sr, (g) => {
    if (part !== 'sfx') {
      scheduleTheme(g, theme, seconds, 1);
      tickAmbience(g, { ...AMBIENCE_PRESETS['farm-spring-morning']!, key: THEMES[theme]!.key }, seconds);
    }
    if (part !== 'bed') {
      const sfx = new Sfx(g, 5);
      sfx.key = THEMES[theme]!.key;
      for (const e of GAMEPLAY_SCRIPT) sfx.play(e.name, { at: e.t });
    }
  });
  return { name: `gameplay-${part}`, sampleRate: sr, data: encode(buf), frames: buf.length, markers: GAMEPLAY_SCRIPT.map((e) => ({ name: e.verb ? `${e.name}*` : e.name, t: e.t })) };
}

export function listThemes(): string[] {
  return Object.keys(THEMES);
}

/** Tracks a theme actually uses (for stem renders). */
export function themeTracks(id: string): TrackName[] {
  return [...new Set(new Composer(THEMES[id]!, 1).compose().events.map((e) => e.track))].filter((t) => t !== 'double');
}
export function listAmbience(): string[] {
  return Object.keys(AMBIENCE_PRESETS);
}

/** Symbolic dump of a composed piece (for reading the composition without listening). */
export function describePiece(id: string, seed = 1): { theme: string; bars: number; duration: number; melody: string[] } {
  const th = THEMES[id]!;
  const p = new Composer(th, seed).compose();
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const mel = p.events.filter((e) => e.track === 'melody').slice(0, 48).map((e) => `${names[e.midi % 12]}${Math.floor(e.midi / 12) - 1}@${e.t.toFixed(2)}`);
  return { theme: id, bars: p.bars, duration: p.duration, melody: mel };
}

/** Composed events + bar grid for piano-roll plots. */
export function pieceData(id: string, seed = 1, seconds = 30): { events: { t: number; track: string; midi: number; dur: number; vel: number }[]; bars: { t: number; chords: string; section: string }[] } {
  const p = new Composer(THEMES[id]!, seed).compose();
  return {
    events: p.events.filter((e) => e.t < seconds).map((e) => ({ t: e.t, track: e.track, midi: e.midi, dur: e.dur, vel: e.vel })),
    bars: (p.barInfo ?? []).filter((b) => b.t < seconds),
  };
}
