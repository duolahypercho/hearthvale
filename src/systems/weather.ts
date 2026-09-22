/**
 * WeatherSystem: applies calendar weather to the lighting rig + map, and owns precipitation:
 * rain streaks + splash rings (rain / storm), snowfall (snow), lightning flashes (storm).
 * Intensities blend smoothly on `weather:change`, snap on `weather:apply` (demos, debug).
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Weather } from '../core/time';
import { RainStreaks, RainSplashes, SnowFlakes } from '../render/precipitation';
import { globalUniforms } from '../render/uniforms';

const TARGETS: Record<Weather, { rain: number; snow: number }> = {
  sun: { rain: 0, snow: 0 },
  wind: { rain: 0, snow: 0 },
  rain: { rain: 0.8, snow: 0 },
  storm: { rain: 1, snow: 0 },
  snow: { rain: 0, snow: 0.85 },
};

export class WeatherSystem implements System {
  readonly name = 'weather';
  private game!: Game;
  private rain = new RainStreaks();
  private splash = new RainSplashes();
  private snow = new SnowFlakes();
  private rainAmt = 0;
  private snowAmt = 0;
  private target = TARGETS.sun;
  private weather: Weather = 'sun';
  private nextFlash = 5;
  private flash = 0;
  private center = new THREE.Vector3();

  init(game: Game): void {
    this.game = game;
    game.scene.add(this.rain.mesh, this.splash.mesh, this.snow.mesh);
    game.events.on('weather:change', ({ weather }) => this.apply(weather, false));
    game.events.on('weather:apply', ({ weather, instant }) => this.apply(weather, instant));
  }

  onMapChange(): void {
    const t = this.game.world.current?.terrain;
    this.splash.setHeightSource(
      t
        ? {
            tex: t.heightTex,
            origin: new THREE.Vector2(t.opts.minX, t.opts.minZ),
            size: new THREE.Vector2(t.opts.maxX - t.opts.minX, t.opts.maxZ - t.opts.minZ),
            waterLevel: t.opts.waterLevel,
          }
        : null,
    );
    this.apply(this.game.calendar.weather, true);
  }

  private apply(w: Weather, instant: boolean): void {
    this.weather = w;
    this.target = TARGETS[w];
    this.game.lighting.setWeather(w, instant);
    this.game.world.current?.setWeather?.(w);
    if (instant) {
      this.rainAmt = this.target.rain;
      this.snowAmt = this.target.snow;
    }
  }

  update(dt: number, game: Game): void {
    const k = 1 - Math.exp(-dt * 0.6);
    this.rainAmt += (this.target.rain - this.rainAmt) * k;
    this.snowAmt += (this.target.snow - this.snowAmt) * k;
    globalUniforms.uRain.value = this.rainAmt;
    // Volume follows the camera focus, lifted a bit so drops fill the view above the ground.
    const rig = game.rc.rig;
    this.center.copy(rig.focus).add(rig.lookOffset);
    const t = game.time;
    this.rain.update(this.center, this.rainAmt, t);
    this.splash.update(this.center, this.rainAmt, t);
    this.snow.update(this.center, this.snowAmt, t);

    // Storm lightning: brief double flash every 6-14 s.
    if (this.weather === 'storm') {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flash = 1;
        this.nextFlash = 6 + Math.random() * 8;
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
      const f = this.flash > 0.6 ? 1 : this.flash > 0.45 ? 0.2 : this.flash > 0.25 ? 0.8 : this.flash * 2;
      game.lighting.setFlash(f);
    } else game.lighting.setFlash(0);
  }
}
