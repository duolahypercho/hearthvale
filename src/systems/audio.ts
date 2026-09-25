/**
 * AudioSystem — the game adapter for the procedural audio engine in src/audio/ (no audio files):
 *
 *   music      a generative score (src/audio/composer.ts + themes.ts): per-season farm themes, town,
 *              beach, mine, night, rain, festival arrangements and the title theme, chosen by
 *              src/audio/select.ts from map / time / weather / UI and crossfaded by the director,
 *              with rests between songs, a quieter night mix and a muffle for the pause menu
 *   ambience   layered beds + scheduled wildlife / weather one-shots (src/audio/ambience.ts) fed by
 *              map, hour, season, weather, fountain and water proximity, indoor state
 *   SFX        footsteps per surface (synced to the stride, wet in the rain), every farm tool
 *              (swing, charge, impact per hit kind), harvest pops, coins, UI kit cues, villager
 *              "sim-speak" per word of dialogue, gifts, hearts, crafting, shipping, stingers
 *              (Lantern Hall ignition / restoration), sleep and morning chimes, level-ups, emotes
 *   co-op      positional SFX (`playAt`, `stepAt`), sim-speak chat (`say`), join / leave / chat cues;
 *              tool impacts and harvests are placed at their tile, so a partner's actions pan and fade
 *
 * The AudioContext is created on the first user gesture (autoplay policy; `?audio=1` tries at boot).
 * Mine combat / rocks and fishing are voiced by their own pods (world/mine/sfx.ts, ui/fishing-sfx.ts),
 * so those events only duck the score here. Other modules can play any SFX by name:
 *   game.services.audio?.play('coin')          // see SFX_NAMES in src/audio/sfx.ts
 *   game.services.audio?.music('festival')     // force a theme (null = automatic, 'none' = silence)
 * Cutscenes: `{ do: 'cue', cue: 'music', arg: '<theme>|auto|none' }` and `{ do: 'cue', cue: 'sfx', arg: '<name>' }`.
 * Demo: `?demo=audio&theme=<id>&sfx=<name>` (see README "Audio").
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { TileFlag, TileType } from '../world/tiles';
import { AudioEngine } from '../audio/engine';
import type { EnvState, AmbSeason, AmbWeather } from '../audio/ambience';
import { chooseTheme, songFor } from '../audio/select';
import { PiecePrefetch } from '../audio/prefetch';
import { MusicDirector } from '../audio/music';
import { THEMES, festivalTheme, type FestivalHint } from '../audio/themes';
import { voiceFor, type Surface } from '../audio/sfx';
import { tuneHook } from '../audio/composer';
import type { DirectorTrace } from '../audio/music';
import { NowPlaying } from '../audio/nowplaying';
import { RENDER_STATS } from '../audio/instruments';

export interface AudioState {
  running: boolean;
  theme: string | null;
  /** The song the director is playing / will play for the current selection. */
  wanted: string | null;
  /** The selection itself: a theme id or a playlist ('farm:spring', 'night:fall'). */
  group: string | null;
  resting: boolean;
  /** Seconds until the next song may start. */
  restLeft: number;
  env: EnvState | null;
  voices: number;
  /** Notes refused by the polyphony budget since start. */
  dropped: number;
  /** Most voices the budget has had sounding at once. */
  peakVoices: number;
  /** Sidechain follower driving the music ducking ('worklet' | 'native' | null). */
  ducker: string | null;
  /** Players still fading out. */
  fading: number;
  /** AudioContext time and how often its clock was found stalled (watchdog). */
  ctxTime: number;
  stalls: number;
  /** The music director's recent decisions (newest last). */
  trace: DirectorTrace[];
  /** Output RMS (dBFS) at the moment of the call. */
  levelDb: number;
  /** Songs composed in the worker (hits) vs on the main thread (misses, with their total ms). */
  compose: { hits: number; misses: number; syncMs: number };
  /** Mallet / string note buffers: rendered by the worker vs on this thread (+ ms), cache size. */
  notes: { worker: number; main: number; mainMs: number; cacheMb: number; byInst: Record<string, number> };
}

export interface AudioApi {
  setVolume(v: number): void;
  mute(m: boolean): void;
  readonly running: boolean;
  /** Play a named SFX (src/audio/sfx.ts SFX_NAMES), optionally panned / scaled. */
  play(name: string, opts?: { pan?: number; gain?: number; level?: number }): void;
  /**
   * Play a named SFX at a world position (co-op farmers, remote tools, villagers): panned by the
   * camera's screen-right axis and attenuated with distance from the local player; inaudible
   * (> ~26 tiles, or another map) sounds cost nothing.
   */
  playAt(name: string, x: number, z: number, opts?: { gain?: number; level?: number; map?: string }): void;
  /** A footfall at a world position (surface looked up from the tile there) — remote players' feet. */
  stepAt(x: number, z: number, opts?: { run?: boolean; map?: string; gain?: number }): void;
  /**
   * Speak a line in "sim-speak" (a formant murmur per word) with a stable voice per id — chat
   * bubbles from co-op farmers ('player', 'player:2', any id). Positional when x/z are given.
   */
  say(voiceId: string, text: string, x?: number, z?: number): void;
  /** Force a theme id (see src/audio/themes.ts), 'none' for silence, null for automatic selection. */
  music(theme: string | null): void;
  /** Title of the theme currently playing (for a "now playing" line). */
  nowPlaying(): string | null;
  state(): AudioState;
  /** Output level right now (dBFS RMS over ~46 ms) — for tests: is the game actually making sound? */
  meter(): number;
}

declare module '../core/game' {
  interface GameServices {
    audio: AudioApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    /** Fired when a new piece of music starts (id + human title). */
    'audio:theme': { id: string; title: string };
  }
}

const INDOOR_MAPS = new Set(['house', 'coop', 'barn', 'hall', 'shop', 'clinic', 'inn', 'bakery', 'smithy']);
const TOOL_SWING: Record<string, string> = { hoe: 'swing', axe: 'swing', pickaxe: 'swing', scythe: 'scythe', sword: 'sword' };
const UI_KIND: Record<string, string> = {
  click: 'ui:click', hover: 'ui:hover', open: 'ui:open', close: 'ui:close', error: 'ui:error', buy: 'purchase',
  sell: 'ui:sell', coin: 'coin', craft: 'craft', trash: 'ui:trash', pickup: 'pickup', drop: 'ui:drop', tab: 'ui:tab',
  toggle: 'ui:toggle', tick: 'ui:tick', sort: 'ui:tab', select: 'ui:select',
};

export class AudioSystem implements System {
  readonly name = 'audio';
  private game!: Game;
  private ctx: AudioContext | null = null;
  private engine: AudioEngine | null = null;
  private vol = { master: 0.8, music: 0.7, sfx: 0.9, ambience: 0.7 };
  private muted = false;
  private forced: string | null = null;
  private demoTheme: { theme: string; map: string } | null = null;
  private festival: string | null = null;
  private lastTheme: string | null = null;
  private lastMap = '';
  private analyser: AnalyserNode | null = null;
  private env: EnvState | null = null;
  private lastTick = 0;
  private muffle = -1;
  private speaking = false;
  private sleeping = false;
  /** AudioContext time of the last lightning strike voiced from a weather:thunder event. */
  private strikeAt = -10;
  // footsteps
  private stride = 0;
  private lastPos = { x: NaN, z: NaN };
  // cached map facts
  private fountain: { x: number; z: number } | null = null;
  private waterNear = 0;
  private waterT = 0;
  private lastSfx = new Map<string, number>();
  private demoSfx: { name: string; next: number } | null = null;
  /** Placement applied to SFX while an event at a world position is being voiced (see placed()). */
  private place: { gain: number; pan: number } | null = null;
  /** `?demo=audio&coop=1`: a phantom co-op partner circles the player so positional audio can be judged. */
  private demoCoop: { a: number; stride: number; next: number; k: number } | null = null;
  private tickFailed = false;
  private mineFloor = 0;
  private lastWall = 0;
  private lastCtxTime = -1;
  private ctxStuckSince = 0;
  private stalls = 0;
  private ambLift = -1;
  private card = new NowPlaying();
  private pinCard = false;
  private cardShown: string | null = null;
  /** Pinned card with no running context: the tune's opening notes, fed to the card at tempo. */
  private silentHook: { notes: ReturnType<typeof tuneHook>; i: number; t: number } | null = null;
  /** Song composer worker, created at boot so the first song is ready before the first click. */
  private prefetch: PiecePrefetch | null = null;
  /** Last craft:learned (ms) — a recipe learned with a toast gets the jingle, a silent refresh doesn't. */
  private learnedAt = -1;

  init(game: Game): void {
    this.game = game;
    const start = (): void => this.start();
    window.addEventListener('pointerdown', start, { capture: true });
    window.addEventListener('keydown', start, { capture: true });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    const params = new URLSearchParams(location.search);
    if (params.get('audio') === '1') queueMicrotask(() => this.start());
    const theme = params.get('theme');
    if (theme) this.forced = theme;
    const sfx = params.get('sfx');
    if (sfx) this.demoSfx = { name: sfx, next: 0 };
    if (params.get('coop') === '1' && params.get('demo') === 'audio') this.demoCoop = { a: 0, stride: 0, next: 2, k: 0 };
    // &card=1 keeps the now-playing card on screen (screenshots); &card=0 never shows it.
    this.pinCard = params.get('card') === '1';
    if (params.get('card') === '0') this.card.disabled = true;
    // Compose the opening song off the main thread while the save / demo loads.
    this.prefetch = new PiecePrefetch(true);
    window.setTimeout(() => this.preload(), 0);
    // Watchdog: keep the score moving even if the game loop stalls (long loads, a throttled tab).
    // It also re-decides the wanted theme, so a scene change staged while frames are starved (a heavy
    // map build on a loaded machine) still hands the music over instead of waiting for the loop.
    window.setInterval(() => {
      if (performance.now() - this.lastWall <= 400) return;
      if (this.engine && this.ctx?.state === 'running') {
        try {
          this.decide(game);
        } catch {
          /* the world may be mid-rebuild: try again next tick */
        }
      }
      this.tickAudio(0.6);
    }, 250);

    const self = this;
    game.provide('audio', {
      setVolume: (v) => {
        this.vol.master = Math.max(0, Math.min(1, v));
        this.applyVolumes();
      },
      mute: (m) => {
        this.muted = m;
        this.applyVolumes();
      },
      get running() {
        return !!self.ctx && self.ctx.state === 'running';
      },
      play: (name, o) => this.sfx(name, o),
      playAt: (name, x, z, o) => {
        const sp = this.spatial(x, z, o?.map);
        if (sp) this.sfx(name, { gain: (o?.gain ?? 1) * sp.gain, pan: sp.pan, level: o?.level });
      },
      stepAt: (x, z, o) => {
        const sp = this.spatial(x, z, o?.map);
        if (!sp || !this.engine || !this.ctx || this.ctx.state !== 'running') return;
        const wet = (game.calendar.weather === 'rain' || game.calendar.weather === 'storm') && !this.isIndoor();
        this.engine.sfx.step(this.surface(game, x, z), { gain: (o?.gain ?? 1) * sp.gain * (o?.run ? 0.85 : 0.62), pan: sp.pan, wet });
      },
      say: (id, text, x, z) => this.say(id, text, x, z),
      music: (t) => {
        this.forced = t;
        this.preload();
        this.engine?.music.kick();
      },
      nowPlaying: () => {
        const id = this.engine?.music.playing;
        return id ? THEMES[id]?.title ?? id : null;
      },
      meter: () => this.meter(),
      state: () => ({
        running: !!this.ctx && this.ctx.state === 'running',
        theme: this.engine?.music.playing ?? null,
        wanted: this.resolved(this.wanted()),
        group: this.wanted(),
        resting: this.engine?.music.resting ?? false,
        restLeft: Math.round((this.engine?.music.restLeft ?? 0) * 10) / 10,
        env: this.env,
        voices: this.engine?.graph.voices ?? 0,
        dropped: this.engine?.graph.dropped ?? 0,
        peakVoices: this.engine?.graph.peakVoices ?? 0,
        ducker: this.engine?.graph.ducker ?? null,
        fading: this.engine?.music.oldCount ?? 0,
        ctxTime: Math.round((this.ctx?.currentTime ?? 0) * 100) / 100,
        stalls: this.stalls,
        trace: this.engine ? [...this.engine.music.trace] : [],
        levelDb: Math.round(this.meter() * 10) / 10,
        compose: {
          hits: this.engine?.music.pieces.hits ?? 0,
          misses: this.engine?.music.pieces.misses ?? 0,
          syncMs: Math.round(this.engine?.music.pieces.syncMs ?? 0),
        },
        notes: {
          worker: this.engine?.graph.provided ?? 0,
          main: RENDER_STATS.count,
          mainMs: Math.round(RENDER_STATS.ms),
          cacheMb: Math.round((this.engine?.graph.bufferMb ?? 0) * 10) / 10,
          byInst: { ...RENDER_STATS.byInst },
        },
      }),
    });
    this.subscribe(game);
  }

  private meter(): number {
    const e = this.engine;
    if (!e || !this.ctx) return -Infinity;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      e.graph.out.connect(this.analyser);
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let ss = 0;
    for (const v of buf) ss += v * v;
    return 10 * Math.log10(ss / buf.length + 1e-12);
  }

  // ───────────────────────────────────────────── lifecycle

  private start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.engine = new AudioEngine(this.ctx, 1, this.prefetch ?? undefined);
    const ctx = this.ctx;
    this.engine.music.onMelody = (at, midi) => this.card.note(midi, at - ctx.currentTime);
    this.engine.music.reseed(this.daySeed());
    this.applyVolumes();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private onVisibility(): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    const out = this.engine.graph.out.gain;
    if (document.hidden) {
      out.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => document.hidden && void ctx.suspend(), 400);
    } else {
      void ctx.resume().then(() => this.applyVolumes());
    }
  }

  private applyVolumes(): void {
    if (!this.engine) return;
    const m = this.muted ? 0 : this.vol.master;
    this.engine.setVolumes({ master: m, music: this.vol.music, sfx: this.vol.sfx, ambience: this.vol.ambience });
  }

  private daySeed(): number {
    const c = this.game.calendar;
    return (c.year * 1000 + ['spring', 'summer', 'fall', 'winter'].indexOf(c.season) * 100 + c.day) >>> 0;
  }

  // ───────────────────────────────────────────── events

  private subscribe(game: Game): void {
    const ev = game.events;
    ev.on('settings:change', ({ settings }) => {
      this.vol = { master: settings.master, music: settings.music, sfx: settings.sfx, ambience: settings.ambience };
      this.applyVolumes();
    });

    // Farming tools.
    ev.on('tool:swing', ({ tool, charge }) => {
      const s = TOOL_SWING[tool];
      if (s) this.sfx(s, { gain: 0.8 + Math.min(3, charge) * 0.12 });
    });
    ev.on('tool:charge', ({ level }) => this.sfx('charge', { level }));
    // Impacts and harvests are placed where they happen: your own tile sits a hair off-centre, a
    // co-op partner's hoe across the field pans and fades with distance (the host replays their
    // intents through the same events).
    ev.on('tool:impact', ({ tool, hit, strength, x, z }) => this.placed(x + 0.5, z + 0.5, () => this.impact(tool, hit, strength)));
    ev.on('crop:harvested', ({ quality, x, z }) =>
      this.placed(x + 0.5, z + 0.5, () => this.sfx('harvest', { gain: 1 + (quality ?? 0) * 0.05, level: quality ?? 0 })),
    );
    ev.on('crop:giant', () => this.sfx('giant', { gain: 0.7 }));
    ev.on('crow:arrive', () => this.sfx('crow', { gain: 0.8, pan: 0.3 }, 3));
    ev.on('forage:picked', () => this.sfx('pickup'));
    ev.on('item:gained', () => this.sfx('pickup', { gain: 0.7 }, 0.12));
    ev.on('gold:change', ({ delta }) => {
      if (delta > 0) this.sfx('coin', { gain: delta >= 500 ? 1.1 : 0.9 }, 0.08);
    });
    ev.on('shipping:add', () => this.sfx('ship'));
    ev.on('craft:made', () => this.sfx('craft', undefined, 0.2));
    ev.on('building:built', () => this.sfx('hall', { gain: 0.6 }));
    ev.on('building:enter', () => this.sfx('door'));

    // UI.
    ev.on('ui:sfx', ({ kind }) => {
      const n = UI_KIND[kind];
      if (!n) return;
      // open/close are also voiced from ui:open / ui:close — don't double them.
      this.sfx(n, undefined, n === 'ui:hover' ? 0.045 : 0.05);
    });
    ev.on('ui:open', ({ name }) => {
      if (name === 'none' || name.startsWith('title') || name.startsWith('dialogue')) return;
      this.sfx('ui:open', undefined, 0.05);
    });
    ev.on('ui:close', ({ name }) => {
      if (name.startsWith('title') || name.startsWith('dialogue')) return;
      this.sfx('ui:close', undefined, 0.05);
    });
    ev.on('ui:toast', ({ kind }) => {
      if (kind === 'bad') this.sfx('ui:error', { gain: 0.6 }, 0.3);
      // A recipe discovery announces itself with a toast in the same tick; the silent re-learning
      // that happens when the inventory refreshes (opening the backpack) has none — no jingle then.
      if (kind === 'good' && performance.now() - this.learnedAt < 30) this.sfx('learn', undefined, 0.3);
    });

    // Dialogue: a murmur per typed word in the speaker's voice.
    let wordIdx = 0;
    ev.on('ui:blip', ({ id }) => {
      if (!this.engine) return;
      const v = voiceFor(id);
      this.engine.sfx.murmur(v, `${id}${wordIdx++ % 7}${'aeiou'[wordIdx % 5]}`, { gain: 0.85 });
    });
    ev.on('dialogue:speaking', ({ on }) => {
      this.speaking = on;
    });
    ev.on('npc:talk', () => this.sfx('ui:select', { gain: 0.8 }));
    let giftAt = -10;
    ev.on('npc:gift', ({ reaction }) => {
      giftAt = performance.now() / 1000;
      this.sfx(`gift:${reaction}`);
    });
    ev.on('relationship:change', ({ delta, hearts, points }) => {
      // A new heart earned (points crossed a 250 boundary).
      if (delta > 0 && Math.floor(points / 250) > Math.floor((points - delta) / 250) && hearts > 0) this.sfx('heart', undefined, 1);
    });

    // Story & world beats.
    ev.on('quest:bundleDone', () => this.sfx('bundle'));
    ev.on('quest:complete', () => this.sfx('bundle', { gain: 0.8 }));
    ev.on('quest:hallRestored', () => this.sfx('hall'));
    ev.on('mail:new', ({ id }) => id && this.sfx('ui:open', { gain: 0.7 }, 1));
    ev.on('mail:read', () => this.sfx('paper', undefined, 0.3));
    ev.on('quest:posted', () => this.sfx('paper', { gain: 0.8 }, 0.5));
    ev.on('quest:accepted', () => this.sfx('learn', { gain: 0.8 }, 0.5));
    ev.on('craft:learned', () => {
      this.learnedAt = performance.now();
    });
    ev.on('farming:level', () => this.sfx('levelup', undefined, 2));
    ev.on('fishing:level', () => this.sfx('levelup', undefined, 2));
    ev.on('mine:chest', () => this.sfx('chest', undefined, 1));
    // Refusals share one gentle "nope" (rate-limited so a held button never buzzes).
    ev.on('energy:refused', () => this.sfx('ui:error', { gain: 0.5 }, 0.6));
    ev.on('gold:insufficient', () => this.sfx('ui:error', { gain: 0.6 }, 0.4));
    ev.on('craft:failed', () => this.sfx('ui:error', { gain: 0.6 }, 0.4));
    ev.on('npc:emote', ({ id, emote }) => {
      // A gift reaction already has its own jingle; the bubble that pops with it stays silent.
      if (performance.now() / 1000 - giftAt < 1) return;
      const pos = this.npcPos(id);
      const sp = pos ? this.spatial(pos.x, pos.z) : { gain: 0.7, pan: 0 };
      if (sp) this.sfx(`emote:${emote}`, { gain: sp.gain * 0.9, pan: sp.pan }, 0.25);
    });
    // Co-op session cues (src/net): farmers arriving / leaving, chat lines, emotes from the wheel.
    let roster: Set<number> | null = null;
    ev.on('net:roster', ({ players }) => {
      const ids = new Set(players.filter((p) => !p.isMe).map((p) => p.id));
      if (roster) {
        if ([...ids].some((id) => !roster!.has(id))) this.sfx('join', undefined, 1);
        else if ([...roster].some((id) => !ids.has(id))) this.sfx('leave', undefined, 1);
      }
      roster = ids;
    });
    ev.on('net:chat', ({ id, text, system }) => {
      if (system) return void this.sfx('paper', { gain: 0.7 }, 0.3);
      this.sfx('chat', undefined, 0.1);
      // Other farmers "say" the first words of their line in their own sim-speak voice.
      const me = game.services.net?.myId();
      if (id !== me) this.say(`player:${id}`, text.split(/\s+/).slice(0, 6).join(' '));
    });
    ev.on('net:emote', ({ emote }) => this.sfx(`emote:${emote}`, { gain: 0.9 }, 0.2));
    ev.on('sprinkler:spray', ({ x, z, on }) => {
      if (!on) return;
      const sp = this.spatial(x + 0.5, z + 0.5);
      if (sp) this.sfx('sprinkler', { gain: sp.gain, pan: sp.pan }, 0.5);
    });
    ev.on('crop:withered', ({ x, z }) => {
      const sp = this.spatial(x + 0.5, z + 0.5);
      if (sp) this.sfx('wither', { gain: sp.gain, pan: sp.pan }, 0.4);
    });
    ev.on('cutscene:cue', ({ cue, arg, instant }) => {
      if (cue === 'music') {
        this.forced = !arg || arg === 'auto' ? null : arg;
        this.preload();
        return;
      }
      if (instant) return;
      // The weather pod follows its thunder event with a generic cue; the strike already rolled.
      if (cue === 'sfx' && arg === 'thunder' && this.ctx && this.ctx.currentTime - this.strikeAt < 0.25) return;
      if (cue === 'sfx' && arg) this.sfx(arg);
      else if (cue === 'hall:ignite') this.sfx('lantern');
      else if (cue === 'festival:greatLantern') this.sfx('hall');
      else if (cue === 'town:restore') this.sfx('hall', { gain: 0.8 });
    });

    // Day cycle.
    ev.on('sleep:start', () => {
      this.sleeping = true;
      this.sfx('sleep');
      this.engine?.music.stopAll(2.5);
    });
    ev.on('day:start', ({ day }) => {
      this.sleeping = false;
      this.engine?.music.reseed(this.daySeed());
      this.engine?.music.kick();
      // Morning stinger quotes the tune you're about to hear; a new season gets its whole hook.
      this.preload();
      const th = THEMES[this.resolved(this.wanted()) ?? ''];
      const hook = th ? tuneHook(th, day === 1 ? 2 : 1) : [];
      if (this.engine && hook.length) {
        const first = hook[0]!.midi;
        this.engine.sfx.phrase(day === 1 ? 'harp' : 'celesta', hook.map((n) => ({ ...n, midi: n.midi + (first < 72 ? 12 : 0) })), { bpm: th!.bpm * 1.1, gain: day === 1 ? 0.9 : 0.7 });
      } else this.sfx('morning', { gain: 0.8 });
    });
    ev.on('energy:change', ({ energy }) => {
      if (energy <= 0) this.sfx('exhausted', undefined, 5);
    });

    // Storm strikes: the thunder answers the bolt you just saw — near strikes crack and rumble hard,
    // far ones only roll. While strikes are coming the ambience stops rolling its own random thunder.
    ev.on('weather:thunder', ({ intensity, distance }) => {
      if (!this.engine || !this.ctx || game.paused) return;
      const now = this.ctx.currentTime;
      this.strikeAt = now;
      const dist01 = Math.max(0, Math.min(1, distance / 36 + (1 - intensity) * 0.35));
      this.engine.amb.externalThunderUntil = now + 20;
      this.engine.amb.thunder(now + 0.02, dist01);
    });

    // Other pods voice these; the score just makes room.
    ev.on('fishing:catch', () => this.engine?.graph.duckMusic(this.ctx!.currentTime, 0.5, 1.2, 1));
    ev.on('fishing:bite', () => this.engine?.graph.duckMusic(this.ctx!.currentTime, 0.75, 0.6, 0.6));
    ev.on('mine:ladder', () => this.engine?.graph.duckMusic(this.ctx!.currentTime, 0.7, 0.4, 0.8));
    ev.on('mine:floor', ({ floor }) => {
      this.mineFloor = floor;
    });

    // Festivals.
    ev.on('festival:music', (h) => {
      const def = festivalTheme(h as FestivalHint);
      THEMES[def.id] = def;
      this.festival = def.id;
    });
    ev.on('festival:start', ({ id }) => {
      if (!this.festival?.endsWith(id)) this.festival = 'festival';
    });
    ev.on('festival:end', () => {
      this.festival = null;
    });

    // Maps & demos.
    ev.on('map:change', ({ map, prev }) => {
      this.fountain = null;
      this.waterT = 0;
      this.lastPos = { x: NaN, z: NaN };
      if (this.demoTheme && this.demoTheme.map !== map) this.demoTheme = null;
      this.preload();
      if (prev && (INDOOR_MAPS.has(map) || INDOOR_MAPS.has(prev) || this.isIndoor())) this.sfx('door', { gain: 0.8 });
      else if (prev) this.sfx('warp', { gain: 0.7 });
    });
    ev.on('demo:stage', ({ name }) => {
      const map = game.world.current?.id ?? '';
      this.demoTheme = name === 'festival' ? { theme: 'festival', map } : null;
      this.preload();
      this.engine?.music.kick();
      if (name === 'audio' || name.startsWith('audio-')) {
        const th = this.resolved(this.forced ?? this.wanted());
        const def = th ? THEMES[th] : null;
        game.hud.banner(def ? `♪ ${def.title}` : '♪ Hearthvale', 'click anywhere to start the sound');
      }
    });
  }

  private impact(tool: string, hit: string, strength: number): void {
    switch (tool) {
      case 'hoe':
        if (hit === 'soil') this.sfx('hoe', { gain: Math.min(1.2, 0.8 + strength * 0.2) });
        else if (hit === 'tilled') this.sfx('hoe', { gain: 0.55 });
        else this.sfx('hoe:dull');
        break;
      case 'wateringCan':
        if (hit === 'refill') this.sfx('refill');
        else this.sfx('water', { gain: hit === 'water' ? Math.min(1.2, 0.8 + strength * 0.2) : 0.5 });
        break;
      case 'axe':
        if (hit === 'wood') {
          this.sfx('axe');
          this.sfx('rockbreak', { gain: 0.35 });
        } else if (hit === 'giant') {
          this.sfx('axe');
          if (strength >= 1.5) this.sfx('giant');
        } else if (hit === 'weed') {
          this.sfx('weed');
          this.sfx('scythe', { gain: 0.6 });
        } else this.sfx('axe:miss');
        break;
      case 'pickaxe':
        if (hit === 'stone') {
          this.sfx('pickaxe');
          this.sfx('rockbreak', { gain: 0.9 });
        } else if (hit === 'soil') this.sfx('hoe', { gain: 0.7 });
        else this.sfx('pickaxe', { gain: 0.45 });
        break;
      case 'scythe':
        if (hit === 'weed' || hit === 'crop') this.sfx('weed');
        break;
      case 'seeds':
        this.sfx('plant');
        break;
      case 'place':
        this.sfx('place');
        break;
      default:
        break;
    }
  }

  /** Run `fn` with every SFX it plays placed at world (x, z); skipped entirely when inaudible. */
  private placed(x: number, z: number, fn: () => void): void {
    const sp = Number.isFinite(x) && Number.isFinite(z) ? this.spatial(x, z) : { gain: 1, pan: 0 };
    if (!sp) return;
    this.place = sp;
    try {
      fn();
    } finally {
      this.place = null;
    }
  }

  /** Play an SFX (with an optional per-name minimum interval, seconds). */
  private sfx(name: string, o?: { pan?: number; gain?: number; level?: number }, minGap = 0): void {
    const e = this.engine;
    if (!e || !this.ctx || this.ctx.state !== 'running') return;
    if (o?.gain === 0) return;
    if (this.place) o = { ...o, gain: (o?.gain ?? 1) * this.place.gain, pan: (o?.pan ?? 0) + this.place.pan };
    const now = this.ctx.currentTime;
    if (minGap > 0) {
      const last = this.lastSfx.get(name) ?? -1e9;
      if (now - last < minGap) return;
      this.lastSfx.set(name, now);
    }
    e.sfx.play(name, o);
  }

  // ───────────────────────────────────────────── per frame

  private isIndoor(): boolean {
    const m = this.game.world.current as (import('../world/map').GameMap & { interior?: boolean }) | null;
    return !!m && (m.interior === true || INDOOR_MAPS.has(m.id));
  }

  private wanted(): string | null {
    const g = this.game;
    const panel = g.hud.openPanelName ?? '';
    const map = g.world.current?.id ?? 'farm';
    return chooseTheme({
      map,
      hour: g.calendar.hour,
      season: g.calendar.season,
      weather: g.calendar.weather,
      indoor: this.isIndoor(),
      title: panel === 'title' || panel.endsWith(':title'),
      festival: this.festival ?? this.demoTheme?.theme ?? null,
      forced: this.forced,
      mineFloor: this.mineFloor,
    });
  }

  update(dt: number, game: Game): void {
    this.footsteps(dt, game);
    if (this.pinCard) {
      // Pinned card (screenshots): show the wanted theme even before the context can start.
      const w = this.resolved(this.wanted());
      if (w && w !== this.cardShown && THEMES[w]) {
        this.cardShown = w;
        this.card.show(THEMES[w]!, true);
        this.silentHook = { notes: tuneHook(THEMES[w]!, 4), i: 0, t: 0.6 };
      }
      // No sound yet (a headless screenshot never clicks): the card still breathes — the tune's first
      // bars float out of it at the song's tempo, exactly as they would while it plays.
      const h = this.silentHook;
      if (h && h.notes.length && (!this.ctx || this.ctx.state !== 'running')) {
        h.t -= dt;
        if (h.t <= 0) {
          const n = h.notes[h.i % h.notes.length]!;
          const next = h.notes[(h.i + 1) % h.notes.length]!;
          const bpm = THEMES[this.cardShown!]?.bpm ?? 96;
          this.card.note(n.midi, 0);
          h.i++;
          h.t = Math.max(0.2, ((next.t > n.t ? next.t - n.t : n.beats + 1) * 60) / bpm);
        }
      }
    }
    const ctx = this.ctx;
    const e = this.engine;
    if (!ctx || !e || ctx.state !== 'running') return;
    // Wall-clock throttle (a stalled AudioContext clock must never freeze the decisions).
    const wall = performance.now();
    if (wall - this.lastWall < 45) return;
    this.lastWall = wall;
    this.env = this.envState(dt, game);

    // Music: selection, level and tone.
    this.decide(game);
    const panel = game.hud.openPanelName ?? '';
    const paused = panel === 'pause' || panel.startsWith('settings');
    let level = 1;
    if (this.env.night > 0.5 && !e.music.desired?.startsWith('night')) level *= 0.8;
    if (this.speaking) level *= 0.78;
    if (this.env.indoor) level *= 0.9;
    e.music.setLevel(level);
    const muffle = paused ? 0.55 : this.sleeping ? 0.8 : 0;
    if (Math.abs(muffle - this.muffle) > 0.01) {
      this.muffle = muffle;
      e.graph.setMusicMuffle(muffle);
    }
    this.tickAudio(0.3);
    const playing = e.music.playing;
    if (playing !== this.lastTheme) {
      this.lastTheme = playing;
      if (playing) {
        const def = THEMES[playing];
        game.events.emit('audio:theme', { id: playing, title: def?.title ?? playing });
        const title = panel === 'title' || panel.endsWith(':title');
        if (def && !title && !this.pinCard) this.card.show(def);
      }
    }
    const lift = e.music.resting || !playing ? 1 : 0;
    if (lift !== this.ambLift) {
      this.ambLift = lift;
      e.graph.setAmbienceLift(lift);
    }
    if (this.demoSfx && ctx.currentTime >= this.demoSfx.next) {
      this.demoSfx.next = ctx.currentTime + 2.5;
      this.sfx(this.demoSfx.name);
    }
    if (this.demoCoop) this.coopDemo(dt, ctx.currentTime);
  }

  /** Phantom partner: walks a slow ellipse around the player (steps pan L↔R), hoes, emotes, chats. */
  private coopDemo(dt: number, now: number): void {
    const c = this.demoCoop!;
    const api = this.game.services.audio;
    if (!api) return;
    const p = this.game.player.position;
    const prev = { x: p.x + Math.cos(c.a) * 7, z: p.z + Math.sin(c.a) * 4 };
    c.a += dt * 0.22;
    const x = p.x + Math.cos(c.a) * 7;
    const z = p.z + Math.sin(c.a) * 4;
    const before = Math.floor(c.stride / Math.PI);
    c.stride += Math.hypot(x - prev.x, z - prev.z) * 2.6;
    if (Math.floor(c.stride / Math.PI) !== before) api.stepAt(x, z);
    if (now < c.next) return;
    c.next = now + 3;
    const beat = c.k++ % 4;
    if (beat === 0) api.playAt('hoe', x, z);
    else if (beat === 1) api.playAt('emote:heart', x, z);
    else if (beat === 2) api.say('player:2', 'Morning! The turnips look great today', x, z);
    else api.playAt('water', x, z);
  }

  /** The concrete song a selection (theme or playlist) resolves to right now. */
  private resolved(want: string | null): string | null {
    if (!want) return null;
    return this.engine ? this.engine.music.resolve(want) : songFor(want, this.daySeed(), 0);
  }

  /**
   * Ask the worker for the song the game will want next (boot, map change, new day, forced themes
   * from demos and cutscenes), so starting it never composes on the frame.
   */
  private preload(): void {
    try {
      const want = this.wanted();
      if (!want) return;
      if (this.engine) {
        this.engine.music.prefetch(want);
        return;
      }
      const id = songFor(want, this.daySeed(), 0);
      const th = THEMES[id];
      if (th) this.prefetch?.request(th, MusicDirector.seedFor(this.daySeed(), id, 0));
    } catch {
      /* the world may not be built yet */
    }
  }

  /** Pick the theme for the moment and tell the director how to hand over to it. */
  private decide(game: Game): void {
    const e = this.engine!;
    const want = this.sleeping ? null : this.wanted();
    const map = game.world.current?.id ?? '';
    if (want !== e.music.desired) {
      // Same place, new hour / weather: finish the phrase, then hand over. New place: quick fade.
      e.music.handoff = map === this.lastMap ? 'drift' : 'move';
      e.music.desired = want;
    }
    this.lastMap = map;
  }

  /** Advance the engine (from the frame loop, or from the watchdog when the loop stalls). */
  private tickAudio(lookahead: number): void {
    const ctx = this.ctx;
    const e = this.engine;
    if (!ctx || !e || ctx.state !== 'running' || !this.env) return;
    if (lookahead > 0.5) this.lastWall = performance.now();
    // Clock watchdog: a running context whose clock has not moved for 1.5 s gets a kick.
    const wall = performance.now();
    if (ctx.currentTime !== this.lastCtxTime) {
      this.lastCtxTime = ctx.currentTime;
      this.ctxStuckSince = wall;
    } else if (wall - this.ctxStuckSince > 1500 && !document.hidden) {
      this.stalls++;
      this.ctxStuckSince = wall;
      void ctx.suspend().then(() => ctx.resume());
    }
    try {
      e.tick(this.env, lookahead);
    } catch (err) {
      // Audio must never take the game loop down with it: report once, keep playing what we can.
      if (!this.tickFailed) console.warn('[audio] tick failed', err);
      this.tickFailed = true;
    }
  }

  private envState(dt: number, game: Game): EnvState {
    const map = game.world.current;
    const p = game.player.position;
    const cal = game.calendar;
    const indoor = this.isIndoor();
    // Fountain: locate once per map (grid objects tagged 'fountain').
    let fountain = 0;
    if (map?.id === 'town') {
      if (!this.fountain) this.fountain = this.findObject('fountain') ?? { x: 1e9, z: 1e9 };
      const d = Math.hypot(p.x - this.fountain.x, p.z - this.fountain.z);
      fountain = Math.max(0, Math.min(1, 1.25 - d / 14));
    }
    // Open water nearby (pond, stream, sea): sampled a few times a second.
    this.waterT -= dt;
    if (this.waterT <= 0 && map) {
      this.waterT = 0.4;
      let best = 99;
      const px = Math.floor(p.x);
      const pz = Math.floor(p.z);
      for (let dz = -8; dz <= 8; dz += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
          if (map.grid.inBounds(px + dx, pz + dz) && map.grid.getType(px + dx, pz + dz) === TileType.Water) best = Math.min(best, Math.hypot(dx, dz));
        }
      }
      this.waterNear = best > 10 ? 0 : Math.max(0, 1 - best / 10);
    }
    return {
      map: map?.id ?? 'farm',
      hour: cal.hour,
      season: cal.season as AmbSeason,
      weather: cal.weather as AmbWeather,
      night: Number.isFinite(game.lighting?.night) ? game.lighting.night : cal.hour >= 20 || cal.hour < 6 ? 1 : 0,
      fountain,
      water: this.waterNear,
      indoor,
      key: this.engine?.music.key ?? 60,
    };
  }

  /** A villager's world position on the current map (from the NPC service), if outdoors here. */
  private npcPos(id: string): { x: number; z: number } | null {
    try {
      return this.game.services.npcs?.positions().find((n) => n.id === id) ?? null;
    } catch {
      return null;
    }
  }

  private findObject(id: string): { x: number; z: number } | null {
    const grid = this.game.world.current?.grid;
    if (!grid) return null;
    const W = grid.width;
    const H = grid.depth;
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        if ((grid.getObject(x, z) as { id?: string } | undefined)?.id === id) {
          sx += x + 0.5;
          sz += z + 0.5;
          n++;
        }
      }
    }
    return n ? { x: sx / n, z: sz / n } : null;
  }

  /**
   * Listener-relative placement for a world-space sound: pan along the camera's screen-right axis
   * (the 3/4 camera can orbit in cutscenes), inverse-square-ish falloff with a near plateau so a
   * co-op partner beside you is as loud as your own tools. Null when inaudible or on another map.
   */
  private spatial(x: number, z: number, map?: string): { gain: number; pan: number } | null {
    const g = this.game;
    if (map && map !== (g.world.current?.id ?? '')) return null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const p = g.player.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 26) return null;
    const gain = 1 / (1 + Math.pow(Math.max(0, d - 2) / 7, 2));
    if (gain < 0.06) return null;
    const e = g.rc.camera.matrixWorld.elements;
    const rl = Math.hypot(e[0]!, e[2]!) || 1;
    const side = (dx * e[0]! + dz * e[2]!) / rl;
    return { gain, pan: Math.max(-0.85, Math.min(0.85, side / 9)) };
  }

  /** Sim-speak for a chat line: one murmur per word, spaced by each word's spoken length. */
  private say(id: string, text: string, x?: number, z?: number): void {
    const e = this.engine;
    const ctx = this.ctx;
    if (!e || !ctx || ctx.state !== 'running') return;
    let gain = 0.8;
    let pan = 0;
    if (x !== undefined && z !== undefined) {
      const sp = this.spatial(x, z);
      if (!sp) return;
      gain *= Math.max(0.35, sp.gain);
      pan = sp.pan;
    }
    const v = voiceFor(id);
    const words = text.split(/\s+/).filter(Boolean).slice(0, 14);
    let at = ctx.currentTime + 0.02;
    for (const w of words) {
      at += e.sfx.murmur(v, w, { at, gain, pan }) + 0.05;
    }
  }

  /**
   * Footfalls mirror the player rig's stride (phase += distance × 2.6 walking / 2.3 running, a foot
   * lands every π), so steps line up with the animation without reaching into the player.
   */
  private footsteps(dt: number, game: Game): void {
    const p = game.player.position;
    if (Number.isNaN(this.lastPos.x)) {
      this.lastPos = { x: p.x, z: p.z };
      return;
    }
    const d = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos = { x: p.x, z: p.z };
    if (d > 1.5 || dt <= 0) return; // teleport
    const speed = d / dt;
    if (speed < 0.4) {
      this.stride = Math.PI * 0.5; // next step lands soon after starting to walk
      return;
    }
    const run = speed > game.player.speed * 1.15;
    const before = Math.floor(this.stride / Math.PI);
    this.stride += d * (run ? 2.3 : 2.6);
    if (Math.floor(this.stride / Math.PI) === before) return;
    if (!this.engine || !this.ctx || this.ctx.state !== 'running') return;
    const surface = this.surface(game);
    const wet = (game.calendar.weather === 'rain' || game.calendar.weather === 'storm') && !this.isIndoor();
    this.engine.sfx.step(surface, { gain: run ? 0.85 : 0.62, wet });
  }

  private surface(game: Game, wx = game.player.position.x, wz = game.player.position.z): Surface {
    const map = game.world.current;
    if (!map) return 'grass';
    if (this.isIndoor()) return map.id === 'hall' ? 'stone' : 'wood';
    if (map.id === 'mine') return 'stone';
    const x = Math.floor(wx);
    const z = Math.floor(wz);
    if (!map.grid.inBounds(x, z)) return 'grass';
    const winter = game.calendar.season === 'winter';
    const obj = map.grid.getObject(x, z) as { kind?: string; id?: string } | undefined;
    if (obj && /bridge|dock|pier|boardwalk|deck/.test(`${obj.kind ?? ''}${obj.id ?? ''}`)) return 'wood';
    switch (map.grid.getType(x, z)) {
      case TileType.Water:
        return 'water';
      case TileType.Sand:
        return 'sand';
      case TileType.Stone:
        return 'stone';
      case TileType.Floor:
        return 'wood';
      case TileType.Path:
        return map.id === 'town' || map.id.startsWith('fest') ? 'stone' : winter ? 'snow' : 'dirt';
      case TileType.Dirt:
        if (map.grid.hasFlag(x, z, TileFlag.Tilled)) return 'tilled';
        return winter ? 'snow' : 'dirt';
      default:
        return winter ? 'snow' : 'grass';
    }
  }
}
