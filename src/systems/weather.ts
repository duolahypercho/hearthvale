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
import { RainStreaks, RainSplashes, SnowFlakes, RAIN_NEAR, RAIN_FAR, type HeightSource } from '../render/precipitation';
import { LightningBolt, FogBank, Rainbow } from '../render/skyfx';
import { Drips, Footprints, LeafGusts, findEaves, type DripPoint, type GustPalette } from '../render/groundfx';
import { globalUniforms } from '../render/uniforms';

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

/** Lightning brightness envelope: leader flicker, return stroke, restrike, decay. */
function flashEnvelope(t: number): number {
  if (t < 0) return 0;
  if (t < 0.05) return 1;
  if (t < 0.1) return 0.2;
  if (t < 0.19) return 0.95;
  if (t < 0.24) return 0.35;
  if (t < 0.3) return 0.7;
  return 0.7 * Math.exp(-(t - 0.3) * 9);
}

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
  private fogBank = new FogBank();
  private rainbow = new Rainbow();
  private drips = new Drips();
  private prints = new Footprints();
  private leaves = new LeafGusts();
  private rainAmt = 0;
  private snowAmt = 0;
  private fogAmt = 0;
  private rainbowAmt = 0;
  private leafAmt = 0;
  private dripAmt = 0;
  private target = TARGETS.sun;
  private weather: Weather = 'sun';
  private season: Season = 'spring';
  private nextStrike = 4;
  private strikeT = -1;
  private hold = false;
  private boltSeed = 7;
  private thunder: { at: number; intensity: number; distance: number } | null = null;
  private fogOverride: number | null = null;
  private rainbowOverride: number | null = null;
  /** Game hour until which a post-shower rainbow may show (same day). */
  private rainbowUntil = -1;
  private rainbowDay = -1;
  private center = new THREE.Vector3();
  private lastPrint = new THREE.Vector3(1e9, 0, 0);
  private printSide = 1;
  private clock = 0;
  /** 1 while it rains, then dries over ~2 game hours (keeps puddles / drips / dark wet ground). */
  private damp = 0;
  /** Current lightning flash level (0..1), lights up the rain. */
  private flashNow = 0;

  init(game: Game): void {
    this.game = game;
    game.scene.add(this.rain.mesh, this.rainFar.mesh, this.splash.mesh, this.snow.mesh, this.bolt.mesh, this.fogBank.mesh, this.rainbow.mesh, this.drips.mesh, this.prints.mesh, this.leaves.mesh);
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
    game.provide('weather', this);
    this.readUrl();
  }

  // ───────────────────────────────────────────── api

  strike(at?: { x: number; z: number }, hold = false): void {
    const g = this.game;
    const map = g.world.current;
    if (!map) return;
    const rig = g.rc.rig;
    let x: number;
    let z: number;
    if (at) {
      x = at.x;
      z = at.z;
    } else {
      // Somewhere up-screen of the player (the bolt then spans the frame top to bottom).
      const yaw = THREE.MathUtils.degToRad(rig.yaw);
      const r = 4 + hash01(this.boltSeed * 1.7) * 6;
      const side = (hash01(this.boltSeed * 3.1) - 0.5) * 18;
      x = rig.focus.x - Math.sin(yaw) * r + Math.cos(yaw) * side;
      z = rig.focus.z - Math.cos(yaw) * r - Math.sin(yaw) * side;
    }
    const ground = new THREE.Vector3(x, map.heightAt(x, z), z);
    this.bolt.build(ground, g.rc.camera.position, this.boltSeed++ * 7919);
    this.strikeT = 0;
    this.hold = hold;
    const dist = Math.hypot(x - g.player.position.x, z - g.player.position.z);
    g.events.emit('weather:lightning', { x, z });
    // Sound travels ~343 m/s; the diorama compresses distances, so keep the gap readable (0.5-2.5 s).
    this.thunder = { at: this.clock + 0.5 + Math.min(2, dist / 14), intensity: THREE.MathUtils.clamp(1.2 - dist / 40, 0.35, 1), distance: dist };
  }

  setFog(v: number | null): void {
    this.fogOverride = v;
  }

  setRainbow(v: number | null): void {
    this.rainbowOverride = v;
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
    this.fogOverride = name === 'fog-morning' ? 1 : null;
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
    if ((name === 'storm' || name === 'farm-storm') && bolt !== '0') {
      // Pose a strike for the (paused) beauty shot: rebuilt a frame later, once the camera has snapped.
      requestAnimationFrame(() => this.strike(undefined, true));
    } else if (bolt === '1') requestAnimationFrame(() => this.strike(undefined, true));
    if (name === 'snow-day' || name === 'farm-winter' || name === 'winter-night' || name === 'town-winter') {
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
      const nx = x + Math.sin(ang) * 0.42;
      const nz = z + Math.cos(ang) * 0.42;
      if (!map.grid.isWalkable(Math.floor(nx), Math.floor(nz))) break;
      x = nx;
      z = nz;
      // Prints point towards the player (walking direction is the reverse of the trail).
      this.printSide = -this.printSide;
      this.prints.stamp(x, map.heightAt(x, z), z, ang + Math.PI, this.printSide, g.time - i * 0.9);
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
    this.fogBank.setHeightSource(hs);
    this.drips.setHeightSource(hs);
    this.prints.clear();
    this.lastPrint.set(1e9, 0, 0);
    // Drip points: roof eaves found automatically + whatever the map lists (canopy edges, awnings).
    const pts: DripPoint[] = map && t ? findEaves(map.root, 320) : [];
    for (const d of map?.poi?.drips ?? []) if (d.y !== undefined) pts.push({ x: d.x, y: d.y, z: d.z });
    this.drips.setPoints(pts);
    this.apply(this.game.calendar.weather, true);
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
    if (w !== 'storm') this.thunder = null;
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
    return 1 - THREE.MathUtils.smoothstep(h, 8, 9.6);
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
    const t = game.time;
    const cam = game.rc.camera;
    const hPx = Math.max(1, game.rc.renderer.domElement.height);
    // World units per drawn pixel per metre of distance: streaks stay 1-1.5 px hairlines.
    const pxAngle = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / hPx;
    this.rain.update(this.center, this.rainAmt, t, pxAngle, this.flashNow);
    this.rainFar.update(this.center, this.rainAmt, t, pxAngle, this.flashNow);
    this.splash.update(this.center, this.rainAmt, t);
    this.snow.update(this.center, this.snowAmt, t);
    this.drips.update(this.dripAmt, t);
    this.leaves.update(this.center, this.leafAmt, t);
    this.fogBank.update(this.center, this.fogAmt);
    game.lighting.mist = this.fogAmt * (this.weather === 'sun' || this.weather === 'wind' ? 0.55 : 0.15);
    (game.world.current as { setAtmosphere?: (f: number) => void } | null)?.setAtmosphere?.(this.fogAmt);
    this.rainbow.update(this.rainbowAmt, cam.aspect);
    this.updateFootprints(game);
    this.updateLightning(dt, game);
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
    if (d < 0.42) return;
    if (map.terrain.heightAt(p.x, p.z) < map.terrain.opts.waterLevel + 0.02) {
      this.lastPrint.copy(p);
      return;
    }
    const yaw = Math.atan2(p.x - this.lastPrint.x, p.z - this.lastPrint.z);
    this.printSide = -this.printSide;
    this.prints.stamp(p.x, map.heightAt(p.x, p.z), p.z, yaw, this.printSide, game.time);
    this.lastPrint.copy(p);
  }

  private updateLightning(dt: number, game: Game): void {
    if (this.weather === 'storm' && !game.paused) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.strike();
        this.nextStrike = 5 + Math.random() * 9;
      }
    }
    let f = 0;
    if (this.strikeT >= 0) {
      if (this.hold && game.paused) {
        // Posed strike for stills: bolt fully lit, a moderate flash on the world.
        this.bolt.alpha = 1;
        f = 0.22;
      } else {
        this.hold = false;
        this.strikeT += dt;
        f = flashEnvelope(this.strikeT);
        this.bolt.alpha = Math.min(1, f * 1.3) * (this.strikeT < 0.6 ? 1 : 0);
        if (this.strikeT > 0.9) this.strikeT = -1;
      }
    } else this.bolt.alpha = 0;
    game.lighting.setFlash(f * (0.55 + 0.45 * this.rainAmt));
    this.flashNow = f;
    if (this.thunder && this.clock >= this.thunder.at) {
      const th = this.thunder;
      this.thunder = null;
      game.events.emit('weather:thunder', { intensity: th.intensity, distance: th.distance });
      if (!game.paused) {
        game.rc.rig.addShake(0.25 * th.intensity);
        // Roll the synthesized thunder with the strike we just saw (audio's public one-shot cue).
        game.events.emit('cutscene:cue', { cue: 'sfx', arg: 'thunder', instant: false });
      }
    }
  }
}
