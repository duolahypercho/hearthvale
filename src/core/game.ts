/**
 * Game context: owns the engine services and the system registry.
 * Every module receives the Game and talks to others via `game.events` or the services here.
 *
 * ── Adding a system ───────────────────────────────────────────────
 * 1. Create src/systems/<name>.ts exporting a class implementing `System` (core/system.ts).
 * 2. Add ONE line to SYSTEMS below.
 */
import * as THREE from 'three';
import { EventBus, type Quality } from './events';
import { Rng } from './rng';
import { Calendar, type Season, type Weather } from './time';
import { Input } from './input';
import { SaveManager } from './save';
import type { System } from './system';
import { RenderContext } from '../render/renderer';
import { DayNight } from '../render/lighting';
import { World } from '../world/map';
import { FarmMap } from '../world/farm';
import { TownMap } from '../world/town';
import { ForestMap } from '../world/forest';
import { BeachMap } from '../world/beach';
import { Player } from '../entities/player';
import { Hud } from '../ui/hud';

import { SeasonSystem } from '../systems/season';
import { WeatherSystem } from '../systems/weather';
import { InventorySystem } from '../systems/inventory';
import { FarmingSystem } from '../systems/farming';
import { ShippingSystem } from '../systems/shipping';
import { CritterSystem } from '../systems/critters';
import { NpcSystem } from '../systems/npcs';
import { WarpSystem } from '../systems/warps';
import { AudioSystem } from '../systems/audio';
import { EconomySystem } from '../systems/economy';
import { EnergySystem } from '../systems/energy';
import { SleepSystem } from '../systems/sleep';
import { RelationshipSystem } from '../systems/relationships';
import { FishingSystem } from '../systems/fishing';
import { MiningSystem } from '../systems/mining';
import { CombatSystem } from '../systems/combat';
import { CraftingSystem } from '../systems/crafting';
import { QuestSystem } from '../systems/quests';
import { FestivalSystem } from '../systems/festivals';
import { BuildingSystem } from '../world/buildings/system';
import { AnimalSystem } from '../systems/animals';
import { CutsceneSystem } from '../systems/cutscene';
import { StorySystem } from '../systems/story';
import { LanternHallSystem } from '../systems/story-hall';
import { StoryWorldSystem } from '../systems/story-world';
import { NetSystem } from '../net/system';

// ── System registry: one line per system ───────────────────────────
const SYSTEMS: (() => System)[] = [
  () => new EconomySystem(),
  () => new EnergySystem(),
  () => new SeasonSystem(),
  () => new WeatherSystem(),
  () => new InventorySystem(),
  () => new FarmingSystem(),
  () => new ShippingSystem(),
  () => new CritterSystem(),
  () => new NpcSystem(),
  () => new WarpSystem(),
  () => new AudioSystem(),
  () => new SleepSystem(),
  () => new RelationshipSystem(),
  () => new FishingSystem(),
  () => new MiningSystem(),
  () => new CombatSystem(),
  () => new CraftingSystem(),
  () => new QuestSystem(),
  () => new FestivalSystem(),
  () => new BuildingSystem(),
  () => new AnimalSystem(),
  () => new CutsceneSystem(),
  () => new LanternHallSystem(),
  () => new StoryWorldSystem(),
  () => new StorySystem(),
  () => new NetSystem(),
];

/**
 * Typed service registry. Systems publish an API with `game.provide('inventory', api)` and
 * declare its type by declaration merging (no imports between sibling systems):
 *
 *   declare module '../core/game' { interface GameServices { inventory: InventoryApi } }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GameServices {}

export interface GameOptions {
  container: HTMLElement;
  uiRoot: HTMLElement;
  quality: Quality;
  seed: string;
  hud: boolean;
}

const FIXED_DT = 1 / 60;

export class Game {
  readonly events = new EventBus();
  readonly rng: Rng;
  readonly calendar: Calendar;
  readonly input: Input;
  readonly saves: SaveManager;
  readonly rc: RenderContext;
  readonly lighting: DayNight;
  readonly world: World;
  readonly player: Player;
  readonly hud: Hud;
  readonly systems: System[] = [];
  readonly services: Partial<GameServices> = {};

  /** Simulation paused (time frozen, no fixed updates). Rendering continues. */
  paused = false;
  /** A cutscene owns the camera: the rig stops following the player. */
  cinematic = false;
  /** Seconds since start (render clock). */
  time = 0;
  /** Sim-scaled delta of the current frame (0 while paused). */
  simDt = 0;
  toolbarSlot = 0;
  frame = 0;
  private acc = 0;
  private last = 0;
  private readyResolve!: () => void;
  readonly readyPromise: Promise<void>;
  private started = false;

  constructor(readonly opts: GameOptions) {
    this.rng = new Rng(opts.seed);
    this.calendar = new Calendar(this.events);
    this.rc = new RenderContext(opts.container, opts.quality);
    this.input = new Input(this.events, this.rc.renderer.domElement);
    this.saves = new SaveManager(this.events);
    this.lighting = new DayNight(this.rc);
    this.world = new World(this);
    this.player = new Player(this);
    this.hud = new Hud(this, opts.uiRoot, opts.hud);
    this.readyPromise = new Promise((r) => (this.readyResolve = r));

    this.world.registerMap('farm', (g) => new FarmMap(g));
    this.world.registerMap('town', (g) => new TownMap(g));
    this.world.registerMap('forest', (g) => new ForestMap(g));
    this.world.registerMap('beach', (g) => new BeachMap(g));

    this.events.on('toolbar:select', ({ slot }) => (this.toolbarSlot = slot));

    this.saves.register('core', {
      save: () => ({ calendar: this.calendar.serialize(), map: this.world.current?.id, x: this.player.position.x, z: this.player.position.z }),
      load: (d) => {
        const s = d as { calendar: ReturnType<Calendar['serialize']>; gold?: number; energy?: number; map?: string; x: number; z: number };
        this.calendar.deserialize(s.calendar);
        // Pre-economy saves kept gold / energy here.
        if (typeof s.gold === 'number') this.services.economy?.set(s.gold);
        if (typeof s.energy === 'number') this.services.energy?.set(s.energy);
        if (s.map) void this.teleport(s.map, s.x, s.z);
      },
    });
  }

  get scene(): THREE.Scene {
    return this.rc.scene;
  }

  register(sys: System): void {
    this.systems.push(sys);
    if (sys.save && sys.load) this.saves.register(sys.name, { save: () => sys.save!(), load: (d) => sys.load!(d) });
  }

  /**
   * Load the initial map, init systems, run `stage` (URL params / demo) before the first
   * frame, compile shaders, start the loop. ready() resolves a few frames later.
   */
  async start(initialMap = 'farm', stage?: () => Promise<void>): Promise<void> {
    if (this.started) return;
    this.started = true;
    const map = await this.world.load(initialMap);
    this.scene.add(this.player.root);
    this.player.teleport(map.spawn.x, map.spawn.z);
    this.player.setFacing(map.spawn.facing);

    for (const f of SYSTEMS) this.register(f());
    for (const s of this.systems) await s.init?.(this);
    this.applySeason(this.calendar.season, true);
    this.applyWeather(this.calendar.weather, true);
    this.events.on('map:change', ({ map: id }) => {
      for (const s of this.systems) s.onMapChange?.(id, this);
    });
    for (const s of this.systems) s.onMapChange?.(map.id, this);
    if (stage) await stage();

    this.followPlayer(true);
    this.lighting.update(0, this.calendar.hour);
    const tc = performance.now();
    await this.rc.compile();
    console.debug(`[game] compile ${(performance.now() - tc).toFixed(0)}ms`);
    this.last = performance.now();
    requestAnimationFrame(this.loop);
    // Resolve ready after a few rendered frames so shadows/AO/particles settle.
    const target = this.frame + 8;
    const check = (): void => {
      if (this.frame >= target) {
        this.readyResolve();
        this.events.emit('game:ready', {});
      } else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Frame limiter (Options → Display): 0 = every display refresh, else max frames per second. */
  frameCap = 0;
  /**
   * Optional render takeover for full-screen menus (co-op lobby: cached blurred world + turntable).
   * Return true when it drew the frame itself; false to render the world as usual.
   */
  renderOverride: ((dt: number) => boolean) | null = null;
  /** Called after every frame's render: screen-space overlays that must match this frame's camera. */
  readonly afterRender: (() => void)[] = [];

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    if (this.frameCap > 0 && now - this.last < 1000 / this.frameCap - 2) return;
    // rAF timestamps can precede the performance.now() taken when the loop started: never step backwards.
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000) || 0);
    this.last = now;
    this.step(dt);
  };

  /** Advance one rendered frame by dt seconds (also used by tests / frame capture). */
  step(dt: number): void {
    this.time += dt;
    this.simDt = this.paused ? 0 : dt;
    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 5) {
        this.acc -= FIXED_DT;
        steps++;
        this.player.fixedUpdate(FIXED_DT);
        for (const s of this.systems) s.fixedUpdate?.(FIXED_DT, this);
      }
      if (steps === 5) this.acc = 0;
      this.calendar.advance(dt);
    }
    this.player.update(dt);
    this.world.current?.update(dt, this);
    for (const s of this.systems) s.update?.(dt, this);
    this.followPlayer(false);
    this.lighting.update(dt, this.calendar.hour);
    this.hud.update(dt);
    // Pausing menus (inventory, map, options, shop, day end…) sit on a blurred backdrop over a
    // frozen sim: refresh the world behind them at 20 Hz instead of every frame (pillar 14).
    this.rc.backdropHz = this.hud.root.classList.contains('h-menu-open') ? 20 : 0;
    if (!this.renderOverride?.(dt)) this.rc.render(dt, this.time);
    for (const f of this.afterRender) f();
    this.input.endFrame();
    this.frame++;
  }

  followPlayer(snap: boolean): void {
    if (this.cinematic) return;
    this.rc.rig.target.copy(this.player.position);
    this.rc.focusPoint.copy(this.player.position).setY(this.player.position.y + 0.8);
    if (snap) this.rc.rig.snap();
  }

  /** Render budget check (all passes of the last frame). */
  perf(): {
    drawCalls: number;
    triangles: number;
    budget: { drawCalls: number; triangles: number };
    ok: boolean;
    bySystem: Record<string, { calls: number; triangles: number }>;
    lights: { total: number; active: number };
    adaptive: { enabled: boolean; level: number; shed: string[] };
  } {
    const r = this.rc.renderer.info.render;
    const budget = { drawCalls: 300, triangles: 1_500_000 };
    return {
      drawCalls: r.calls,
      triangles: r.triangles,
      budget,
      ok: r.calls <= budget.drawCalls && r.triangles <= budget.triangles,
      bySystem: this.rc.perfBreakdown(),
      lights: { ...this.rc.lights.stats },
      adaptive: this.rc.governor.state,
    };
  }

  /** Snap (instant) or blend the season visuals; handled by SeasonSystem. */
  applySeason(season: Season, instant = false): void {
    this.events.emit('season:apply', { season, instant });
  }

  /** Snap (instant) or blend the weather visuals; handled by WeatherSystem. */
  applyWeather(weather: Weather, instant = false): void {
    this.events.emit('weather:apply', { weather, instant });
  }

  provide<K extends keyof GameServices>(name: K, api: GameServices[K]): void {
    this.services[name] = api;
  }

  async teleport(mapId: string, x: number, z: number): Promise<void> {
    const map = await this.world.load(mapId);
    this.player.teleport(x, z);
    void map;
    this.followPlayer(true);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.calendar.frozen = p;
    this.events.emit('game:pause', { paused: p });
  }

  setQuality(q: Quality): void {
    this.rc.setQuality(q);
    this.lighting.sun.shadow.mapSize.set(this.rc.preset.shadowMapSize, this.rc.preset.shadowMapSize);
    this.lighting.sun.shadow.map?.dispose();
    this.lighting.sun.shadow.map = null;
    this.events.emit('quality:change', { quality: q });
  }
}
