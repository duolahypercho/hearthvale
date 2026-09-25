/**
 * WeatherSystem: applies calendar weather to the lighting rig + map, and owns every weather effect:
 *  - rain streaks (2 layers) + splash rings, drips off roof eaves / canopy edges (rain, storm, after rain)
 *  - storms: fractal lightning bolts with a flash, then a delayed `weather:thunder` event (+ camera rumble)
 *  - snow: flakes, snow cover (worldfx / terrain via uSnow), footprints pressed behind the player
 *  - wind: leaves / petals tumbling across the view (seasonal palette; a few on calm fall / spring days)
 *  - fog mornings: ground mist layers + paler, closer fog + brighter god rays (seeded per day, 6-9:30)
 *  - rainbows after a shower clears (and on demand)
 * Intensities blend smoothly on `weather:change`, snap on `weather:apply` (demos, debug).
 *
 * Staging (demos / URL): `&fog=0..1`, `&rainbow=0..1`, `&bolt=1` (hold a lightning strike in a paused
 * shot), or `game.services.weather.{strike, setFog, setRainbow}`. Demos 'fog-morning', 'rainbow' and
 * 'storm' switch these on by name.
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Season, Weather } from '../core/time';
import type { Player, PlayerRig, ActionPose } from '../entities/player';
import { RainStreaks, RainSplashes, SnowFlakes, RAIN_NEAR, RAIN_FAR, type HeightSource } from '../render/precipitation';
import { LightningBolt, FogBank, Rainbow, StrikeScorch } from '../render/skyfx';
import { BurstFX } from '../render/particles';
import { Drips, Footprints, LeafGusts, WindRibbons, findEaves, type DripPoint, type GustPalette } from '../render/groundfx';
import { globalUniforms } from '../render/uniforms';
import { atmosphere } from '../render/heightfog';

declare module '../core/events' {
  interface GameEvents {
    /** A lightning bolt struck (world XZ). The flash is instant; thunder follows. */
    'weather:lightning': { x: number; z: number };
    /** Thunder reaches the player (`distance` m from the strike, `intensity` 0..1). */
    'weather:thunder': { intensity: number; distance: number };
  }
}

export interface WeatherApi {
  /** Strike lightning now (optionally at a world point). `hold` keeps the bolt lit while paused. */
  strike(at?: { x: number; z: number }, hold?: boolean): void;
  /** Force ground mist (0..1), or null for the natural (seeded fog-morning) behaviour. */
  setFog(v: number | null): void;
  /** Force a rainbow (0..1), or null for natural (after a shower clears). */
  setRainbow(v: number | null): void;
  /** Current effect levels (for debug / tests). */
  state(): { weather: Weather; rain: number; snow: number; fog: number; rainbow: number; leaves: number; drips: number };
}

declare module '../core/game' {
  interface GameServices {
    weather: WeatherApi;
  }
}

const TARGETS: Record<Weather, { rain: number; snow: number }> = {
  sun: { rain: 0, snow: 0 },
  wind: { rain: 0, snow: 0 },
  rain: { rain: 0.8, snow: 0 },
  storm: { rain: 1, snow: 0 },
  snow: { rain: 0, snow: 0.85 },
};

/**
 * Lightning brightness envelope: a 60 ms return stroke at full brightness, a dark gap, a restrike,
 * a weaker third stroke, then a fast decay.
 */
function flashEnvelope(t: number): number {
  if (t < 0) return 0;
  if (t < 0.06) return 1;
  if (t < 0.11) return 0.12;
  if (t < 0.17) return 0.9;
  if (t < 0.23) return 0.22;
  if (t < 0.28) return 0.55;
  return 0.55 * Math.exp(-(t - 0.28) * 10);
}

const _buf = new THREE.Vector2();
/** Strength of a natural (random) morning mist on a sunny day: a light haze, not the fog-morning bank. */
const MORNING_HAZE = 0.16;
type GameMapTerrain = NonNullable<Game['world']['current']>['terrain'];

function hash01(n: number): number {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export class WeatherSystem implements System, WeatherApi {
  readonly name = 'weather';
  private game!: Game;
  private rain = new RainStreaks(RAIN_NEAR);
  private rainFar = new RainStreaks(RAIN_FAR);
  private splash = new RainSplashes();
  private snow = new SnowFlakes();
  private bolt = new LightningBolt();

  private scorch = new StrikeScorch();
  private strikeFx = new BurstFX(260);
  private fogBank = new FogBank();
  private rainbow = new Rainbow();
  private drips = new Drips();
  private prints = new Footprints();
  private leaves = new LeafGusts();
  private ribbons = new WindRibbons();
  private rainAmt = 0;
  private snowAmt = 0;
  private fogAmt = 0;
  private rainbowAmt = 0;
  private leafAmt = 0;
  private dripAmt = 0;
  private target = TARGETS.sun;
  private weather: Weather = 'sun';
  private season: Season = 'spring';
  private nextStrike = 3;
  private doubled = false;
  private lastStrike: { x: number; z: number } | null = null;
  private strikeT = -1;
  private hold = false;
  private boltSeed = 7;
  /** Pending thunder, one per strike (a double strike rolls two claps; ones within 0.3 s merge). */
  private thunder: { at: number; intensity: number; distance: number }[] = [];
  private startle: Startle | null = null;
  private fogOverride: number | null = null;
  private rainbowOverride: number | null = null;
  /** Game hour until which a post-shower rainbow may show (same day). */
  private rainbowUntil = -1;
  private rainbowDay = -1;
  private center = new THREE.Vector3();
  private lastPrint = new THREE.Vector3(1e9, 0, 0);
  private printSide = 1;
  private printN = 0;
  private stride = 0.42;
  private clock = 0;
  /** Weather-local clock for the falling particles: holds still for a 40 ms hitch on a close strike. */
  private wt = 0;
  private hitch = 0;
  /** 1 while it rains, then dries over ~2 game hours (keeps puddles / drips / dark wet ground). */
  private damp = 0;
  /** Current lightning flash level (0..1), lights up the rain. */
  private flashNow = 0;

  init(game: Game): void {
    this.game = game;
    game.scene.add(this.rain.mesh, this.rainFar.mesh, this.splash.mesh, this.snow.mesh, this.bolt.mesh, this.fogBank.mesh, this.rainbow.mesh, this.drips.mesh, this.prints.mesh, this.leaves.mesh, this.scorch.mesh, this.strikeFx.object, this.ribbons.mesh);
    this.strikeFx.object.userData.perfTag = 'weather';
    this.strikeFx.object.userData.noAO = true;
    game.events.on('weather:change', ({ weather, prev }) => {
      if ((prev === 'rain' || prev === 'storm') && (weather === 'sun' || weather === 'wind')) {
        this.rainbowUntil = game.calendar.hour + 2.5;
        this.rainbowDay = game.calendar.day;
      }
      this.apply(weather, false);
    });
    game.events.on('weather:apply', ({ weather, instant }) => this.apply(weather, instant));
    game.events.on('season:change', ({ season }) => this.setSeason(season));
    game.events.on('season:apply', ({ season }) => this.setSeason(season));
    game.events.on('demo:stage', ({ name }) => this.stageDemo(name));
    // Co-op: the host rolls every strike and tells the farmhands (same bolt, same moment).
    game.events.on('net:ext', ({ data }) => {
      if (data[0] !== 'w.bolt' || this.netRole() !== 'client') return;
      const [, mapId, x, z, seed] = data as [string, string, number, number, number];
      if (this.weather !== 'storm' || !this.game.world.current) return;
      const here = this.game.world.current.id === mapId;
      this.strike(here ? { x, z } : undefined, false, seed);
    });
    game.provide('weather', this);
    this.readUrl();
  }

  // ───────────────────────────────────────────── api

  strike(at?: { x: number; z: number }, hold = false, seed?: number): void {
    const g = this.game;
    const map = g.world.current;
    if (!map) return;
    if (seed !== undefined) this.boltSeed = seed;
    const p = at ?? this.pickStrike();
    const x = p.x;
    const z = p.z;
    const ground = new THREE.Vector3(x, map.heightAt(x, z), z);
    this.bolt.build(ground, g.rc.camera.position, this.boltSeed++ * 7919);
    // Impact: a short ground flash (bolt disc), 8-12 white-hot streaking sparks, a few orange embers
    // and one soft, billowing steam plume off the wet ground (not a scatter of puffs).
    this.scorch.add(x, z, g.time);
    const hit = ground.clone().setY(ground.y + 0.1);
    this.strikeFx.emit(hit, { color: 0xfff6dc, count: 11, speed: 7.5, size: 0.075, gravity: 14, life: 0.5, up: 1.3, spread: 0.25 });
    this.strikeFx.emit(hit, { color: 0xffa850, count: 9, speed: 3.2, size: 0.06, gravity: 9, life: 0.9, up: 1.2, spread: 0.4 });
    this.strikeFx.emit(hit.clone().setY(hit.y + 0.3), { color: 0xaeb6c2, count: 5, speed: 0.35, size: 1.1, gravity: -0.45, life: 3.2, up: 1.0, spread: 0.25 });
    this.strikeT = 0;
    this.hold = hold;
    this.lastStrike = { x, z };
    const dist = Math.hypot(x - g.player.position.x, z - g.player.position.z);
    g.events.emit('weather:lightning', { x, z });
    // Sound travels ~343 m/s; the diorama compresses distances, so keep the gap readable (0.5-2.5 s).
    const due = this.clock + 0.5 + Math.min(2, dist / 14);
    const intensity = THREE.MathUtils.clamp(1.2 - dist / 40, 0.35, 1);
    const near = this.thunder.find((t) => Math.abs(t.at - due) < 0.3);
    if (near) {
      near.at = Math.min(near.at, due);
      near.intensity = Math.min(1, Math.max(near.intensity, intensity) + 0.1);
      near.distance = Math.min(near.distance, dist);
    } else this.thunder.push({ at: due, intensity, distance: dist });
    // A close strike (< 10 m) jolts every farmer who saw it: a startle hop, a short jolt of the lens
    // and a 40 ms hitch in the world (a posed demo strike stays still).
    if (!hold && !g.paused) {
      if (dist < 10) {
        (this.startle ??= new Startle(g.player)).start();
        g.rc.rig.addShake(0.35);
        this.hitch = 0.04;
      }
      for (const r of this.remoteFarmers()) {
        if (Math.hypot(r.x - x, r.z - z) < 10) r.emote?.('wow', 0.9);
      }
    }
  }

  /** Other farmers standing on this map (co-op avatars; the demo bots use the same list). */
  private remoteFarmers(): { x: number; z: number; emote?(e: 'wow', dur?: number): void }[] {
    const net = this.game.services.net as { remotes?: { list?: Map<number, { map: string; away?: boolean; farmer: { position: THREE.Vector3 }; emote?(e: 'wow', dur?: number): void }> } } | undefined;
    const list = net?.remotes?.list;
    const mapId = this.game.world.current?.id;
    if (!list || !mapId) return [];
    const out: { x: number; z: number; emote?(e: 'wow', dur?: number): void }[] = [];
    for (const r of list.values()) {
      if (r.away || r.map !== mapId) continue;
      out.push({ x: r.farmer.position.x, z: r.farmer.position.z, emote: r.emote?.bind(r) });
    }
    return out;
  }

  /**
   * Where a random bolt lands: an open tile (no canopy overhead, not under a roof) inside the
   * upper two thirds of the frame, at least 3 m from the player — so every strike is SEEN. Maps
   * can veto spots with `openSky(x, z)` (the forest checks its giant canopies).
   */
  private pickStrike(): { x: number; z: number } {
    const g = this.game;
    const map = g.world.current!;
    const cam = g.rc.camera;
    const p = g.player.position;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -p.y);
    const hit = new THREE.Vector3();
    const open = (map as { openSky?(x: number, z: number): boolean }).openSky;
    let fallback: { x: number; z: number } | null = null;
    const farmers = this.remoteFarmers();
    for (let i = 0; i < 40; i++) {
      const u = hash01(this.boltSeed * 3.1 + i * 17.7) * 1.5 - 0.75;
      const v = hash01(this.boltSeed * 1.7 + i * 9.3) * 0.75 - 0.05;
      ray.setFromCamera(new THREE.Vector2(u, v), cam);
      if (!ray.ray.intersectPlane(plane, hit)) continue;
      // Never on top of a farmer: 6 m clear of everyone on the map (co-op avatars included).
      const d = Math.hypot(hit.x - p.x, hit.z - p.z);
      if (d < 6 || farmers.some((f) => Math.hypot(hit.x - f.x, hit.z - f.z) < 6)) continue;
      const tx = Math.floor(hit.x);
      const tz = Math.floor(hit.z);
      if (!map.grid.inBounds(tx, tz)) continue;
      fallback ??= { x: hit.x, z: hit.z };
      if (open && !open.call(map, hit.x, hit.z)) continue;
      if (!open && !map.grid.isWalkable(tx, tz)) continue;
      return { x: hit.x, z: hit.z };
    }
    const poi = map.poi?.strike?.[0];
    return fallback ?? (poi ? { x: poi.x, z: poi.z } : { x: p.x + 4, z: p.z - 4 });
  }

  setFog(v: number | null): void {
    this.fogOverride = v;
  }

  setRainbow(v: number | null): void {
    this.rainbowOverride = v;
  }

  private netRole(): 'solo' | 'host' | 'client' {
    return (this.game.services.net as { role?(): 'solo' | 'host' | 'client' } | undefined)?.role?.() ?? 'solo';
  }

  private sendNet(d: unknown[]): void {
    if (this.netRole() === 'host') (this.game.services.net as { sendExt?(to: '*', d: unknown[]): void } | undefined)?.sendExt?.('*', d);
  }

  state(): ReturnType<WeatherApi['state']> {
    return { weather: this.weather, rain: this.rainAmt, snow: this.snowAmt, fog: this.fogAmt, rainbow: this.rainbowAmt, leaves: this.leafAmt, drips: this.dripAmt };
  }

  // ───────────────────────────────────────────── staging

  private readUrl(): void {
    if (typeof location === 'undefined') return;
    const p = new URLSearchParams(location.search);
    const fog = p.get('fog');
    if (fog !== null) this.fogOverride = Number(fog) || 0;
    const rb = p.get('rainbow');
    if (rb !== null) this.rainbowOverride = Number(rb) || 0;
  }

  private stageDemo(name: string): void {
    this.fogOverride = name === 'fog-morning' || name === 'fog-bridge' ? 1 : null;
    this.rainbowOverride = name === 'rainbow' ? 1 : null;
    this.readUrl();
    // Demos jump the clock: settle the atmosphere now instead of fading in from the boot hour.
    const snap = (): void => {
      this.fogAmt = this.fogTarget();
      this.rainbowAmt = this.rainbowTarget();
      this.leafAmt = this.leafTarget();
    };
    this.damp = name === 'rainbow' ? 0.8 : this.weather === 'rain' || this.weather === 'storm' ? 1 : 0;
    snap();
    requestAnimationFrame(snap);
    const bolt = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('bolt') : null;
    if ((name === 'storm' || name === 'storm-meadow' || name === 'farm-storm' || name === 'coop-forest') && bolt !== '0') {
      // Pose a strike for the (paused) beauty shot: rebuilt a frame later, once the camera has snapped.
      // Maps can name an open, well-framed strike spot (`poi.strike`).
      requestAnimationFrame(() => {
        // Maps may pin a hero spot for a demo (`poi.strike` entries named by `demo`), else the
        // picker finds an open, in-frame tile.
        const spot = this.game.world.current?.poi?.strike?.find((s) => (s as { demo?: string }).demo === name);
        this.strike(spot ? { x: spot.x, z: spot.z } : undefined, true);
      });
    } else if (bolt === '1') requestAnimationFrame(() => this.strike(undefined, true));
    if (name === 'snow-day' || name === 'snow-falls' || name === 'farm-winter' || name === 'winter-night' || name === 'town-winter') {
      requestAnimationFrame(() => this.stampTrail());
    }
  }

  /** A trail of prints leading up to the player (so snowy beauty shots show them). */
  private stampTrail(): void {
    const g = this.game;
    const map = g.world.current;
    if (!map?.terrain) return;
    const p = g.player.position;
    const dir: Record<string, [number, number]> = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };
    const [bx, bz] = dir[g.player.facing] ?? [0, 1];
    let x = p.x;
    let z = p.z;
    let ang = Math.atan2(bx, bz);
    for (let i = 0; i < 26; i++) {
      ang += Math.sin(i * 0.45) * 0.09;
      const stride = 0.42 * (0.92 + hash01(i * 3.3 + 1) * 0.16);
      const nx = x + Math.sin(ang) * stride;
      const nz = z + Math.cos(ang) * stride;
      if (!map.grid.isWalkable(Math.floor(nx), Math.floor(nz))) break;
      x = nx;
      z = nz;
      // Prints point towards the player (walking direction is the reverse of the trail).
      this.printSide = -this.printSide;
      // Natural gait: stride and toe-out vary by a few percent per step.
      const jit = (hash01(i * 7.1 + 3) - 0.5) * 0.16;
      this.prints.stamp(x, this.snowTop(x, z), z, ang + Math.PI + jit, this.printSide, g.time - i * 0.9);
    }
  }

  // ───────────────────────────────────────────── map / season

  onMapChange(): void {
    const map = this.game.world.current;
    const t = map?.terrain;
    const hs: HeightSource | null = t
      ? {
          tex: t.heightTex,
          origin: new THREE.Vector2(t.opts.minX, t.opts.minZ),
          size: new THREE.Vector2(t.opts.maxX - t.opts.minX, t.opts.maxZ - t.opts.minZ),
          waterLevel: t.opts.waterLevel,
        }
      : null;
    this.splash.setHeightSource(hs);
    this.scorch.setHeightSource(hs);
    this.fogBank.setHeightSource(hs);
    this.drips.setHeightSource(hs);
    this.prints.clear();
    this.lastPrint.set(1e9, 0, 0);
    // Light shafts belong to the map that registers them (the forest re-registers every frame).
    atmosphere.shafts = 0;
    atmosphere.shaftList = [];
    // Drip points: roof eaves found automatically + whatever the map lists (canopy edges, awnings).
    const pts: DripPoint[] = map && t ? findEaves(map.root, 320) : [];
    for (const d of map?.poi?.drips ?? []) if (d.y !== undefined) pts.push({ x: d.x, y: d.y, z: d.z });
    this.drips.setPoints(pts);
    this.apply(this.game.calendar.weather, true);
    this.warmUp();
  }

  /**
   * Compile every weather program while the map loads (they are hidden when idle, so the first
   * storm / snowfall used to stall ~1.5 s compiling rain, splashes, bolt, scorch, prints…).
   */
  private warmUp(): void {
    const g = this.game;
    const fx = [this.rain.mesh, this.rainFar.mesh, this.splash.mesh, this.snow.mesh, this.bolt.mesh, this.rainbow.mesh, this.drips.mesh, this.prints.mesh, this.leaves.mesh, this.scorch.mesh, this.strikeFx.object, this.ribbons.mesh];
    const was = fx.map((o) => o.visible);
    for (const o of fx) o.visible = true;
    this.rainbow.mesh.traverse((o) => (o.visible = true));
    // No compile here (pillar 14): every map change is followed by RenderContext.compile(), which
    // walks hidden objects too and compiles off-thread for the real HDR scene target. A synchronous
    // renderer.compile() at this point built ~75 canvas-target (sRGB) programs no frame ever uses and
    // queued them ahead of the real ones: a 4 s freeze on the first warp into a map.
    void g;
    fx.forEach((o, i) => (o.visible = was[i]!));
  }

  private setSeason(season: Season): void {
    this.season = season;
    const pal: Record<Season, GustPalette> = { spring: 'petals', summer: 'green', fall: 'autumn', winter: 'none' };
    this.leaves.setPalette(pal[season]);
  }

  private apply(w: Weather, instant: boolean): void {
    this.weather = w;
    this.target = TARGETS[w];
    this.game.lighting.setWeather(w, instant);
    this.game.world.current?.setWeather?.(w);
    if (instant) {
      this.rainAmt = this.target.rain;
      this.snowAmt = this.target.snow;
      this.fogAmt = this.fogTarget();
      this.rainbowAmt = this.rainbowTarget();
      this.leafAmt = this.leafTarget();
      this.dripAmt = this.rainAmt;
    }
    if (w !== 'storm') this.thunder.length = 0;
  }

  // ───────────────────────────────────────────── targets

  private fogTarget(): number {
    if (this.fogOverride !== null) return this.fogOverride;
    const c = this.game.calendar;
    const h = c.hour;
    if (this.weather === 'rain') return 0.14;
    if (this.weather === 'storm') return 0.2;
    if (this.weather === 'snow') return 0.12;
    if (this.weather === 'wind' || h < 5.5 || h > 9.6) return 0;
    // ~1 morning in 4 (1 in 2 in fall) wakes up to ground mist, burning off by 9:30.
    const seasonK = { spring: 0.3, summer: 0.18, fall: 0.5, winter: 0.25 }[c.season];
    if (hash01(c.year * 1000 + c.day * 13 + c.season.length * 101) > seasonK) return 0;
    // Thickest at dawn, thinning from 7:30, gone by 9:00. On an ordinary sunny day this is only a
    // light low haze (fields and crops stay readable); the dense ground fog is reserved for the
    // explicit fog staging (`?demo=fog-morning` / `&fog=1` → `fogOverride`).
    return MORNING_HAZE * (1 - THREE.MathUtils.smoothstep(h, 7.5, 9.0));
  }

  private rainbowTarget(): number {
    if (this.rainbowOverride !== null) return this.rainbowOverride;
    const c = this.game.calendar;
    if (this.weather !== 'sun' || c.day !== this.rainbowDay || c.hour > this.rainbowUntil) return 0;
    return THREE.MathUtils.smoothstep(this.rainbowUntil - c.hour, 0, 0.8);
  }

  private leafTarget(): number {
    const s = this.season;
    if (s === 'winter') return 0;
    if (this.weather === 'wind') return 1;
    if (this.weather === 'storm') return 0.55;
    if (this.weather === 'sun') return s === 'fall' ? 0.2 : s === 'spring' ? 0.12 : 0.04;
    return 0;
  }

  // ───────────────────────────────────────────── frame

  update(dt: number, game: Game): void {
    this.clock += dt;
    const k = 1 - Math.exp(-dt * 0.6);
    this.rainAmt += (this.target.rain - this.rainAmt) * k;
    this.snowAmt += (this.target.snow - this.snowAmt) * k;
    this.fogAmt += (this.fogTarget() - this.fogAmt) * k;
    this.rainbowAmt += (this.rainbowTarget() - this.rainbowAmt) * k * 0.5;
    this.leafAmt += (this.leafTarget() - this.leafAmt) * k;
    // Eaves keep dripping for a while after the rain stops (follows how wet things still are).
    if (this.weather === 'rain' || this.weather === 'storm') this.damp = 1;
    else if (this.weather === 'snow') this.damp = 0;
    else this.damp = Math.max(0, this.damp - game.simDt / 84);
    game.lighting.wetFloor = this.damp * 0.85;
    this.dripAmt = Math.max(this.rainAmt, (this.damp - 0.2) * 0.6);
    globalUniforms.uRain.value = this.rainAmt;
    // Volume follows the camera focus, lifted a bit so drops fill the view above the ground.
    const rig = game.rc.rig;
    this.center.copy(rig.focus).add(rig.lookOffset);
    if (this.hitch > 0) this.hitch -= dt;
    else this.wt += dt;
    const t = this.wt;
    const cam = game.rc.camera;
    const hPx = Math.max(1, game.rc.renderer.domElement.height);
    // World units per drawn pixel per metre of distance: streaks stay 1-1.5 px hairlines.
    const pxAngle = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / hPx;
    // Underground / roofed maps (`covered: true`, e.g. the mine floors): no rain, snow, petals or
    // wind ribbons fall inside; the weather itself carries on and is back at the exit.
    const sky = (game.world.current as { covered?: boolean } | null)?.covered ? 0 : 1;
    this.rain.update(this.center, this.rainAmt * sky, t, pxAngle, this.flashNow);
    this.rainFar.update(this.center, this.rainAmt * sky, t, pxAngle, this.flashNow);
    this.splash.update(this.center, this.rainAmt * sky, t);
    this.snow.update(this.center, this.snowAmt * sky, t, pxAngle, cam.position.distanceTo(rig.focus));
    this.drips.update(this.dripAmt * sky, t);
    // Maps can thin the tumbling leaves (`leafGusts`, e.g. the treeless beach: no green leaves over the sea).
    this.leaves.update(this.center, this.leafAmt * sky * ((game.world.current as { leafGusts?: number } | null)?.leafGusts ?? 1), t);
    // Visible wind: ribbons on windy days (and faintly in storms).
    this.ribbons.update(this.center, sky * (this.weather === 'wind' ? Math.min(1, this.leafAmt * 1.2) : this.weather === 'storm' ? 0.35 : 0), t, pxAngle);
    // Ground mist is a depth-aware height fog (post pass): it pools in the hollows and fades softly
    // against cliffs / trunks. Rain and storms add a low, grey haze; the old draped planes stay off.
    this.fogBank.mesh.visible = false;
    const clear = this.weather === 'sun' || this.weather === 'wind';
    const map = game.world.current;
    // Fog mornings: the mist hugs the ground (dense below ~0.8 m, clear above ~1.5 m) so it pools
    // over the water and in the hollows while the canopy, the cliffs and the farmer stay crisp.
    // (Storms keep less of it: the drama is the dark grade, the rain sheets and the bolts, not a
    // milky veil over the pond.)
    const stormy = this.weather === 'storm' ? 1 : 0;
    atmosphere.fog = clear ? this.fogAmt * 0.06 : this.fogAmt * (0.5 - stormy * 0.2) + this.rainAmt * (0.16 - stormy * 0.08);
    atmosphere.player.copy(game.player.position);
    // Terrain-following ground mist: the real thing on fog mornings (a 0.6-1.2 m layer lying on the
    // floor, the banks, the water), a faint low haze in rain / storms / snow.
    const tr = map?.terrain;
    atmosphere.ground = tr && !(map as { covered?: boolean }).covered ? this.groundSrc(tr) : null;
    // (Rain keeps it to a thin scud over the water / hollows: a grey veil on everything reads as a
    // washed-out frame, not weather.)
    atmosphere.mist = clear ? this.fogAmt * 0.72 : this.rainAmt * 0.09 + this.snowAmt * 0.06;
    atmosphere.mistH = clear ? 0.95 : 1.4;
    atmosphere.base = map?.terrain ? map.terrain.opts.waterLevel + (clear ? 0.05 : 0.25) : rig.focus.y - 0.3;
    atmosphere.falloff = clear ? 0.55 : 3.0;
    atmosphere.density = clear ? 0.7 : 0.06;
    game.lighting.mist = this.fogAmt * (clear ? 0.06 : 0.1);
    (game.world.current as { setAtmosphere?: (f: number) => void } | null)?.setAtmosphere?.(this.fogAmt);
    const bow = map?.poi?.rainbow?.[0] as { x: number; y?: number; z: number; rot?: number } | undefined;
    this.rainbow.update(
      this.rainbowAmt,
      cam,
      rig.focus,
      (x, z) => (map ? map.heightAt(x, z) : 0),
      bow ? { x: bow.x, y: bow.y ?? 0, z: bow.z, r: bow.rot ?? 3 } : null,
      bow && map?.terrain ? map.terrain.opts.waterLevel + 0.01 : null,
    );
    this.updateFootprints(game);
    this.updateLightning(dt, game);
    this.scorch.update(game.time);
    this.strikeFx.update(game.paused ? 0 : dt, hPx);
  }

  private groundCache: { t: unknown; v: NonNullable<typeof atmosphere.ground> } | null = null;
  private groundSrc(t: NonNullable<GameMapTerrain>): NonNullable<typeof atmosphere.ground> {
    if (this.groundCache?.t !== t) {
      this.groundCache = {
        t,
        v: { tex: t.heightTex, origin: new THREE.Vector2(t.opts.minX, t.opts.minZ), size: new THREE.Vector2(t.opts.maxX - t.opts.minX, t.opts.maxZ - t.opts.minZ), water: t.opts.waterLevel },
      };
    }
    return this.groundCache.v;
  }

  /** Ground height including the raised winter drifts (prints must sit on the snow surface). */
  private snowTop(x: number, z: number): number {
    const map = this.game.world.current;
    if (!map) return 0;
    const drift = map.terrain?.driftAt(x, z) ?? 0;
    return map.heightAt(x, z) + drift * 0.2 * THREE.MathUtils.smoothstep(globalUniforms.uSnow.value, 0.3, 1.0);
  }

  private updateFootprints(game: Game): void {
    const snow = globalUniforms.uSnow.value;
    this.prints.update(snow, game.time);
    const map = game.world.current;
    if (snow < 0.4 || !map?.terrain) return;
    const p = game.player.position;
    const d = Math.hypot(p.x - this.lastPrint.x, p.z - this.lastPrint.z);
    if (d > 3) {
      // Teleported / first frame: start a fresh trail.
      this.lastPrint.copy(p);
      return;
    }
    if (d < this.stride) return;
    if (map.terrain.heightAt(p.x, p.z) < map.terrain.opts.waterLevel + 0.02) {
      this.lastPrint.copy(p);
      return;
    }
    const yaw = Math.atan2(p.x - this.lastPrint.x, p.z - this.lastPrint.z) + (hash01(this.printN * 5.7) - 0.5) * 0.16;
    this.printSide = -this.printSide;
    this.printN++;
    this.stride = 0.42 * (0.92 + hash01(this.printN * 2.9) * 0.16);
    this.prints.stamp(p.x, this.snowTop(p.x, p.z), p.z, yaw, this.printSide, game.time);
    this.lastPrint.copy(p);
  }

  private updateLightning(dt: number, game: Game): void {
    // Farmhands never roll their own strikes: the host's arrive over the wire ('w.bolt').
    if (this.weather === 'storm' && !game.paused && this.netRole() !== 'client' && !(game.world.current as { covered?: boolean } | null)?.covered) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        const seed = this.boltSeed;
        this.strike();
        const map = game.world.current;
        if (map && this.lastStrike) this.sendNet(['w.bolt', map.id, +this.lastStrike.x.toFixed(2), +this.lastStrike.z.toFixed(2), seed]);
        // A strike every 8-20 s (seeded, so storms replay the same); 1 in 4 comes as a double.
        const dbl = !this.doubled && hash01(this.boltSeed * 2.9) < 0.25;
        this.doubled = dbl;
        this.nextStrike = dbl ? 0.6 + hash01(this.boltSeed * 4.1) * 0.6 : 8 + hash01(this.boltSeed * 5.3) * 12;
      }
    }
    let f = 0;
    if (this.strikeT >= 0) {
      if (this.hold && game.paused) {
        // Posed strike for stills: bolt fully lit, the world caught in the afterglow of the stroke.
        this.bolt.alpha = 1;
        f = 0.05;
      } else {
        this.hold = false;
        this.strikeT += dt;
        f = flashEnvelope(this.strikeT);
        this.bolt.alpha = Math.min(1, f * 1.4) * (this.strikeT < 0.55 ? 1 : 0);
        if (this.strikeT > 0.9) this.strikeT = -1;
      }
    } else this.bolt.alpha = 0;
    const buf = game.rc.renderer.getDrawingBufferSize(_buf);
    this.bolt.setResolution(buf.x, buf.y);
    game.lighting.setFlash(f * (0.6 + 0.4 * this.rainAmt));
    this.flashNow = f;
    for (let i = this.thunder.length - 1; i >= 0; i--) {
      const th = this.thunder[i]!;
      if (this.clock < th.at) continue;
      this.thunder.splice(i, 1);
      game.events.emit('weather:thunder', { intensity: th.intensity, distance: th.distance });
      if (!game.paused) {
        game.rc.rig.addShake(0.25 * th.intensity);
        // Roll the synthesized thunder with the strike we just saw (audio's public one-shot cue).
        game.events.emit('cutscene:cue', { cue: 'sfx', arg: 'thunder', instant: false });
      }
    }
  }
}

/**
 * Startle when lightning lands close: a 0.25 s flinch (shoulders up, arms thrown out, a little hop
 * back). Wraps `player.actionPose` like the other action drivers and only answers while it plays.
 */
class Startle {
  private t = -1;
  private prev: Player['actionPose'] = null;
  private readonly fn: NonNullable<Player['actionPose']>;

  constructor(private player: Player) {
    this.fn = (rig, dt) => (this.t >= 0 ? this.pose(rig, dt) : (this.prev?.(rig, dt) ?? null));
  }

  start(): void {
    // Tool swings / plucks own the pose while they play: never cut into one.
    if (this.player.busy && this.t < 0) return;
    if (this.player.actionPose !== this.fn) {
      this.prev = this.player.actionPose;
      this.player.actionPose = this.fn;
    }
    this.t = 0;
  }

  private pose(rig: PlayerRig, dt: number): ActionPose | null {
    this.t += dt;
    const D = 0.42;
    if (this.t >= D) {
      this.t = -1;
      return this.prev?.(rig, dt) ?? null;
    }
    // Snap in over 60 ms, hold, ease out.
    const k = this.t < 0.06 ? this.t / 0.06 : 1 - THREE.MathUtils.smoothstep(this.t, 0.25, D);
    rig.armR.rotation.x = -1.1 * k;
    rig.armR.rotation.z = -0.12 - 0.75 * k;
    rig.armL.rotation.x = -1.1 * k;
    rig.armL.rotation.z = 0.12 + 0.75 * k;
    rig.torso.rotation.x = -0.22 * k;
    rig.head.rotation.x = -0.18 * k;
    return { sy: 1 + 0.07 * k, bob: 0.06 * k * (this.t < 0.2 ? 1 : 0.5) };
  }
}
