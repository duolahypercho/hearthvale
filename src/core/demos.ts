/**
 * Canned beauty scenes for critics / screenshots: `?demo=<name>` or `__game.demo(name)`.
 * Each demo pauses simulation time so shots are reproducible.
 * Maps that don't exist yet fall back to the farm with matching mood (warned in console).
 */
import type { Facing } from './events';
import type { Season, Weather } from './time';

export interface DemoDef {
  map: string;
  x: number;
  z: number;
  facing: Facing;
  time: number;
  season: Season;
  weather: Weather;
  camera?: { yaw?: number; pitch?: number; distance?: number; offsetX?: number; offsetZ?: number };
  ui?: string;
}

export const DEMOS: Record<string, DemoDef> = {
  'farm-morning': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: { yaw: -22, pitch: 37, distance: 21, offsetZ: -2.2, offsetX: 0.8 } },
  'farm-noon': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 12.5, season: 'summer', weather: 'sun', camera: { yaw: -8, pitch: 44, distance: 23, offsetZ: -2.4, offsetX: 0.5 } },
  'farm-evening': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 19, season: 'spring', weather: 'sun', camera: { yaw: 24, pitch: 37, distance: 21, offsetZ: -2.2, offsetX: 1.0 } },
  'farm-night': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 22, season: 'summer', weather: 'sun', camera: { yaw: -14, pitch: 38, distance: 19, offsetZ: -2.0, offsetX: 0.5 } },
  'farm-fall': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 16.2, season: 'fall', weather: 'sun', camera: { yaw: 20, pitch: 38, distance: 22, offsetZ: -2.2, offsetX: 1.2 } },
  'farm-winter': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 11, season: 'winter', weather: 'snow', camera: { yaw: -8, pitch: 44, distance: 23, offsetZ: -2.4 } },
  'farm-rain': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 14, season: 'spring', weather: 'rain', camera: { yaw: -8, pitch: 44, distance: 23, offsetZ: -2.4 } },
  'farm-pond': { map: 'farm', x: 21.5, z: 40.5, facing: 'left', time: 17.8, season: 'summer', weather: 'sun', camera: { yaw: 12, pitch: 46, distance: 20, offsetX: -4, offsetZ: -1 } },
  'farm-field': { map: 'farm', x: 36, z: 30, facing: 'down', time: 9, season: 'spring', weather: 'sun', camera: { yaw: -5, pitch: 50, distance: 24 } },
  // DESIGN.md names — fall back to the farm until those maps exist.
  'town-evening': { map: 'town', x: 32, z: 28, facing: 'down', time: 18.8, season: 'summer', weather: 'sun' },
  'beach-sunset': { map: 'beach', x: 20, z: 20, facing: 'down', time: 19.4, season: 'summer', weather: 'sun' },
  'forest-rain': { map: 'forest', x: 20, z: 20, facing: 'down', time: 13, season: 'spring', weather: 'rain' },
  'winter-night': { map: 'farm', x: 31.5, z: 19.6, facing: 'down', time: 21.5, season: 'winter', weather: 'snow', camera: { yaw: -6, pitch: 44, distance: 21, offsetZ: -2.2 } },
  mine: { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun' },
  festival: { map: 'town', x: 32, z: 28, facing: 'down', time: 20, season: 'summer', weather: 'sun' },
};
