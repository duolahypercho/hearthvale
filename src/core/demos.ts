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
  /** Showcase content systems stage for the shot (e.g. 'field' = planted crop field). Default ['field']. */
  showcase?: string[];
}

/** Homestead framing: whole house + roof, the crop field, the east yard and a framing tree line. */
const HOME_CAM = { yaw: -16, pitch: 45, distance: 27, offsetX: -1.6, offsetZ: -2.6 };

export const DEMOS: Record<string, DemoDef> = {
  'farm-morning': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM },
  'farm-noon': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 12.5, season: 'summer', weather: 'sun', camera: { ...HOME_CAM, yaw: -8 } },
  'farm-evening': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 19, season: 'spring', weather: 'sun', camera: { ...HOME_CAM, yaw: 22, offsetX: -0.4 } },
  'farm-night': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 22, season: 'summer', weather: 'sun', camera: HOME_CAM },
  'farm-fall': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 16.2, season: 'fall', weather: 'sun', camera: { ...HOME_CAM, yaw: 14 } },
  'farm-winter': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 11, season: 'winter', weather: 'snow', camera: HOME_CAM },
  'farm-rain': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 14, season: 'spring', weather: 'rain', camera: HOME_CAM },
  'farm-pond': { map: 'farm', x: 21.5, z: 40.5, facing: 'left', time: 17.8, season: 'summer', weather: 'sun', camera: { yaw: 12, pitch: 47, distance: 22, offsetX: -4.5, offsetZ: -3.2 } },
  'farm-field': { map: 'farm', x: 26, z: 24.8, facing: 'up', time: 9, season: 'spring', weather: 'sun', camera: { yaw: -5, pitch: 48, distance: 20, offsetZ: -2 } },
  // DESIGN.md names — fall back to the farm until those maps exist.
  'town-evening': { map: 'town', x: 32, z: 28, facing: 'down', time: 18.8, season: 'summer', weather: 'sun' },
  'beach-sunset': { map: 'beach', x: 20, z: 20, facing: 'down', time: 19.4, season: 'summer', weather: 'sun' },
  'forest-rain': { map: 'forest', x: 20, z: 20, facing: 'down', time: 13, season: 'spring', weather: 'rain' },
  'winter-night': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 21.5, season: 'winter', weather: 'snow', camera: HOME_CAM },
  mine: { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun' },
  festival: { map: 'town', x: 32, z: 28, facing: 'down', time: 20, season: 'summer', weather: 'sun' },
};
