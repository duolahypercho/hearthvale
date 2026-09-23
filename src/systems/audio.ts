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
 *              (Lantern Hall ignition / restoration), sleep and morning chimes
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
import { chooseTheme } from '../audio/select';
import { THEMES, festivalTheme, type FestivalHint } from '../audio/themes';
import { voiceFor, type Surface } from '../audio/sfx';
import { tuneHook } from '../audio/composer';
import type { DirectorTrace } from '../audio/music';
import { NowPlaying } from '../audio/nowplaying';

export interface AudioState {
  running: boolean;
  theme: string | null;
  wanted: string | null;
  resting: boolean;
  /** Seconds until the next song may start. */
  restLeft: number;
  env: EnvState | null;
  voices: number;
  /** Notes refused by the polyphony budget since start. */
  dropped: number;
  /** Players still fading out. */
  fading: number;
  /** AudioContext time and how often its clock was found stalled (watchdog). */
  ctxTime: number;
  stalls: number;
  /** The music director's recent decisions (newest last). */
  trace: DirectorTrace[];
  /** Output RMS (dBFS) at the moment of the call. */
  levelDb: number;
}

export interface AudioApi {
  setVolume(v: number): void;
  mute(m: boolean): void;
  readonly running: boolean;
  /** Play a named SFX (src/audio/sfx.ts SFX_NAMES), optionally panned / scaled. */
  play(name: string, opts?: { pan?: number; gain?: number; level?: number }): void;
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
    // &card=1 keeps the now-playing card on screen (screenshots); &card=0 never shows it.
    this.pinCard = params.get('card') === '1';
    if (params.get('card') === '0') this.card.disabled = true;
    // Watchdog: keep the score moving even if the game loop stalls (long loads, a throttled tab).
    window.setInterval(() => {
      if (performance.now() - this.lastWall > 400) this.tickAudio(0.6);
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
      music: (t) => {
        this.forced = t;
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
        wanted: this.wanted(),
        resting: this.engine?.music.resting ?? false,
        restLeft: Math.round((this.engine?.music.restLeft ?? 0) * 10) / 10,
        env: this.env,
        voices: this.engine?.graph.voices ?? 0,
        dropped: this.engine?.graph.dropped ?? 0,
        fading: this.engine?.music.oldCount ?? 0,
        ctxTime: Math.round((this.ctx?.currentTime ?? 0) * 100) / 100,
        stalls: this.stalls,
        trace: this.engine ? [...this.engine.music.trace] : [],
        levelDb: Math.round(this.meter() * 10) / 10,
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
    this.engine = new AudioEngine(this.ctx, 1);
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
    ev.on('tool:impact', ({ tool, hit, strength }) => this.impact(tool, hit, strength));
    ev.on('crop:harvested', ({ quality }) => this.sfx('harvest', { gain: 1 + (quality ?? 0) * 0.05, level: quality ?? 0 }));
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
    ev.on('npc:gift', ({ reaction }) => this.sfx(`gift:${reaction}`));
    ev.on('relationship:change', ({ delta, hearts, points }) => {
      // A new heart earned (points crossed a 250 boundary).
      if (delta > 0 && Math.floor(points / 250) > Math.floor((points - delta) / 250) && hearts > 0) this.sfx('heart', undefined, 1);
    });

    // Story & world beats.
    ev.on('quest:bundleDone', () => this.sfx('bundle'));
    ev.on('quest:complete', () => this.sfx('bundle', { gain: 0.8 }));
    ev.on('quest:hallRestored', () => this.sfx('hall'));
    ev.on('mail:new', ({ id }) => id && this.sfx('ui:open', { gain: 0.7 }, 1));
    ev.on('cutscene:cue', ({ cue, arg, instant }) => {
      if (cue === 'music') {
        this.forced = !arg || arg === 'auto' ? null : arg;
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
      const th = THEMES[this.wanted() ?? ''];
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
    ev.on('combat:playerHit', () => this.engine?.graph.duckMusic(this.ctx!.currentTime, 0.7, 0.2, 0.5));
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
      if (prev && (INDOOR_MAPS.has(map) || INDOOR_MAPS.has(prev) || this.isIndoor())) this.sfx('door', { gain: 0.8 });
      else if (prev) this.sfx('warp', { gain: 0.7 });
    });
    ev.on('demo:stage', ({ name }) => {
      const map = game.world.current?.id ?? '';
      this.demoTheme = name === 'festival' ? { theme: 'festival', map } : null;
      this.engine?.music.kick();
      if (name === 'audio') {
        const th = this.forced ?? this.wanted();
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

  /** Play an SFX (with an optional per-name minimum interval, seconds). */
  private sfx(name: string, o?: { pan?: number; gain?: number; level?: number }, minGap = 0): void {
    const e = this.engine;
    if (!e || !this.ctx || this.ctx.state !== 'running') return;
    if (o?.gain === 0) return;
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
      const w = this.wanted();
      if (w && w !== this.cardShown && THEMES[w]) {
        this.cardShown = w;
        this.card.show(THEMES[w]!, true);
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
    const want = this.sleeping ? null : this.wanted();
    if (want !== e.music.desired) {
      // Same place, new hour / weather: finish the phrase, then hand over. New place: quick fade.
      const map = game.world.current?.id ?? '';
      e.music.handoff = map === this.lastMap ? 'drift' : 'move';
      e.music.desired = want;
    }
    this.lastMap = game.world.current?.id ?? '';
    const panel = game.hud.openPanelName ?? '';
    const paused = panel === 'pause' || panel.startsWith('settings');
    let level = 1;
    if (this.env.night > 0.5 && e.music.desired !== 'night') level *= 0.8;
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

  private surface(game: Game): Surface {
    const map = game.world.current;
    if (!map) return 'grass';
    if (this.isIndoor()) return map.id === 'hall' ? 'stone' : 'wood';
    if (map.id === 'mine') return 'stone';
    const x = Math.floor(game.player.position.x);
    const z = Math.floor(game.player.position.z);
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
