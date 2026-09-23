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
/** Town square framing: plaza + fountain in front, Lantern Hall and shop fronts behind. */
const TOWN_CAM = { yaw: 0, pitch: 43, distance: 37, offsetX: -2.9, offsetZ: -7.6 };
/** Mine floors: steep, close diorama framing so the lantern pool fills the frame. */
const MINE_CAM = { yaw: 0, pitch: 54, distance: 19, offsetZ: -0.6 };
/** Cindergrove: the waterfall, plunge pool and flanking elders, player on the pool path. */
const FOREST_FALLS_CAM = { yaw: -4, pitch: 44, distance: 26, offsetX: -6.8, offsetZ: -3.6 };
/** Festival: same framing as TOWN_CAM, but the player stands in the ring east of the maypole. */
const FESTIVAL_CAM = { ...TOWN_CAM, offsetX: -3.35, offsetZ: -10.3 };

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
  // Farming pod: hero harvest field (URL: &season=fall|spring, &act=harvest|hoe|wateringCan|scythe),
  // tool feel stills (&tool=hoe|wateringCan|scythe|axe|pickaxe|charge|harvest|sow, &tier=0-3,
  // &pose=<seconds> to freeze, -1 = live; &loop=<tool> repeats the action), giant crops, crows.
  'farm-harvest': { map: 'farm', x: 23.5, z: 29.2, facing: 'up', time: 8.4, season: 'summer', weather: 'sun', camera: { yaw: -6, pitch: 47, distance: 21.5, offsetX: -1.2, offsetZ: -4.6 }, showcase: ['harvest'] },
  'farm-tools': { map: 'farm', x: 28.5, z: 24.45, facing: 'up', time: 9.6, season: 'spring', weather: 'sun', camera: { yaw: -14, pitch: 40, distance: 11.5, offsetX: -0.6, offsetZ: -0.9 }, showcase: ['tools'] },
  'farm-giant': { map: 'farm', x: 21.2, z: 29.4, facing: 'left', time: 15.8, season: 'fall', weather: 'sun', camera: { yaw: 10, pitch: 44, distance: 14, offsetX: -2.4, offsetZ: -2.4 }, showcase: ['giant'] },
  'farm-crops': { map: 'farm', x: 28.6, z: 27.2, facing: 'left', time: 10.5, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 42, distance: 11, offsetX: -4.6, offsetZ: -5.2 }, showcase: ['gallery'] },
  'farm-crows': { map: 'farm', x: 33.5, z: 25.5, facing: 'left', time: 7.4, season: 'summer', weather: 'sun', camera: { yaw: -5, pitch: 46, distance: 19, offsetX: -6.5, offsetZ: -3.5 }, showcase: ['crows'] },
  // Town square (plaza, Lantern Hall, villagers).
  'town-evening': { map: 'town', x: 34.9, z: 22.9, facing: 'right', time: 18.6, season: 'spring', weather: 'sun', camera: TOWN_CAM, showcase: ['npcs'] },
  'town-day': { map: 'town', x: 34.9, z: 22.9, facing: 'right', time: 10.5, season: 'spring', weather: 'sun', camera: TOWN_CAM, showcase: ['npcs'] },
  'town-dialogue': { map: 'town', x: 29.6, z: 23.2, facing: 'left', time: 16.5, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 44, distance: 17, offsetX: -0.8, offsetZ: -1.2 }, showcase: ['npcs'], ui: 'dialogue:marigold' },
  festival: { map: 'town', x: 35.35, z: 26.3, facing: 'left', time: 20.05, season: 'summer', weather: 'sun', camera: FESTIVAL_CAM, showcase: ['npcs', 'festival'] },
  title: { map: 'farm', x: 31.5, z: 19.5, facing: 'down', time: 18.7, season: 'spring', weather: 'sun', ui: 'title', showcase: ['field'] },
  // DESIGN.md names — fall back to the farm until those maps exist.
  'beach-sunset': { map: 'beach', x: 20, z: 20, facing: 'down', time: 19.4, season: 'summer', weather: 'sun' },
  // Cindergrove forest + weather showcases (world/forest, systems/weather). 'fog-morning' / 'rainbow'
  // also switch on the matching atmosphere (the weather system keys off the demo name).
  'forest-day': { map: 'forest', x: 19.4, z: 26.6, facing: 'up', time: 10.4, season: 'summer', weather: 'sun', camera: FOREST_FALLS_CAM },
  'forest-rain': { map: 'forest', x: 35.2, z: 32.6, facing: 'down', time: 13.5, season: 'spring', weather: 'rain', camera: { yaw: 8, pitch: 46, distance: 24, offsetX: 1.2, offsetZ: -0.6 } },
  'forest-fall': { map: 'forest', x: 46.8, z: 22.6, facing: 'right', time: 16.4, season: 'fall', weather: 'sun', camera: { yaw: -8, pitch: 45, distance: 24, offsetX: 3.2, offsetZ: -3.4 } },
  'forest-night': { map: 'forest', x: 46.8, z: 22.6, facing: 'right', time: 22.2, season: 'summer', weather: 'sun', camera: { yaw: -8, pitch: 45, distance: 24, offsetX: 3.2, offsetZ: -3.4 } },
  storm: { map: 'forest', x: 22.4, z: 25.2, facing: 'left', time: 15.5, season: 'summer', weather: 'storm', camera: FOREST_FALLS_CAM },
  'snow-day': { map: 'forest', x: 19.4, z: 26.6, facing: 'up', time: 11, season: 'winter', weather: 'snow', camera: FOREST_FALLS_CAM },
  'fog-morning': { map: 'forest', x: 33.6, z: 25.4, facing: 'down', time: 6.7, season: 'spring', weather: 'sun', camera: { yaw: 4, pitch: 44, distance: 26, offsetX: -1.5, offsetZ: -3.5 } },
  rainbow: { map: 'forest', x: 35.2, z: 32.6, facing: 'up', time: 16.2, season: 'spring', weather: 'sun', camera: { yaw: 8, pitch: 46, distance: 26, offsetX: 1.2, offsetZ: -2 } },
  'farm-storm': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 15, season: 'summer', weather: 'storm', camera: HOME_CAM },
  'farm-wind': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 10, season: 'spring', weather: 'wind', camera: HOME_CAM },
  'winter-night': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 21.5, season: 'winter', weather: 'snow', camera: HOME_CAM },
  // Farm buildings, interiors & animals (camera framing lives with each interior; these override it).
  'house-interior': { map: 'house', x: 7.6, z: 4.9, facing: 'left', time: 8.4, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 16.5, offsetZ: -0.35 }, showcase: ['interior'] },
  'house-night': { map: 'house', x: 7.3, z: 3.9, facing: 'up', time: 21.6, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 16.5, offsetZ: -0.35 }, showcase: ['interior'] },
  'coop-interior': { map: 'coop', x: 4.5, z: 5.4, facing: 'up', time: 9.2, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 52, distance: 12.5, offsetZ: 0.3 }, showcase: ['animals'] },
  'barn-interior': { map: 'barn', x: 6.5, z: 7.2, facing: 'up', time: 16.8, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 52, distance: 16.5, offsetZ: 0.3 }, showcase: ['animals'] },
  'animals-pasture': { map: 'farm', x: 41.5, z: 39.6, facing: 'down', time: 10.5, season: 'spring', weather: 'sun', camera: { yaw: -6, pitch: 46, distance: 21, offsetX: 1.8, offsetZ: -2.2 }, showcase: ['animals'] },
  // Mines (systems/mining + systems/combat, world/mine): the mountain entrance and one floor per biome band.
  // The floor demos pick a showcase spot on the seeded floor; &floor=N stages any floor (biome follows).
  mine: { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-entrance': { map: 'mine-entrance', x: 22.6, z: 14.4, facing: 'down', time: 17.2, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 40, distance: 25, offsetX: 0.4, offsetZ: -4.2 }, showcase: [] },
  'mine-floor': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-ice': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-lava': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-combat': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 52, distance: 14.5, offsetZ: -0.5 }, showcase: [] },
  // Seasonal festivals (systems/festivals.ts, world/festivals/*): each stages its showcase moment.
  'fest-spring': { map: 'fest-spring', x: 29.2, z: 35.2, facing: 'up', time: 11.2, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 40, distance: 33, offsetX: 2.8, offsetZ: -8.6 }, showcase: ['festival-show'] },
  'fest-summer': { map: 'fest-summer', x: 32.6, z: 22.4, facing: 'up', time: 21.4, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 30, distance: 32, offsetX: -3.2, offsetZ: -7.5 }, showcase: ['festival-show'] },
  'fest-fall': { map: 'fest-fall', x: 30.2, z: 27.6, facing: 'up', time: 15.1, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 44, distance: 35, offsetX: 3.2, offsetZ: -8.2 }, showcase: ['festival-show'] },
  'fest-winter': { map: 'fest-winter', x: 32.4, z: 27.6, facing: 'up', time: 20.6, season: 'winter', weather: 'sun', camera: { yaw: 0, pitch: 30, distance: 40, offsetX: -0.4, offsetZ: -8.6 }, showcase: ['festival-show'] },
  // Festival mini-games (they play themselves while the demo is paused): Ribbon Dance, Lantern Release, Sack Race,
  // Produce Judging, Gift Exchange, Starlight Skate. Same as `?demo=fest-<season>&ui=festival:<activity>`.
  'fest-spring-dance': { map: 'fest-spring', x: 31.2, z: 37.2, facing: 'up', time: 12.2, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 38, distance: 17, offsetX: 0.4, offsetZ: -2.2 }, showcase: ['festival-show'], ui: 'festival:dance' },
  'fest-summer-lanterns': { map: 'fest-summer', x: 31.5, z: 20.7, facing: 'up', time: 21.2, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 30, distance: 16, offsetZ: -3.5 }, showcase: ['festival-show'], ui: 'festival:lanterns' },
  'fest-fall-race': { map: 'fest-fall', x: 14.3, z: 25.5, facing: 'right', time: 15.1, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 36, distance: 20, offsetX: 4.2, offsetZ: -2.2 }, showcase: ['festival-show'], ui: 'festival:sackrace' },
  'fest-fall-judging': { map: 'fest-fall', x: 35.4, z: 19.4, facing: 'up', time: 13.2, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 40, distance: 17, offsetZ: -2.6 }, showcase: ['festival-show'], ui: 'festival:pumpkin' },
  'fest-winter-gifts': { map: 'fest-winter', x: 32, z: 25.5, facing: 'up', time: 20.4, season: 'winter', weather: 'sun', camera: { yaw: 0, pitch: 34, distance: 15, offsetZ: -2.4 }, showcase: ['festival-show'], ui: 'festival:giftswap' },
  'fest-winter-skate': { map: 'fest-winter', x: 35.4, z: 29.6, facing: 'right', time: 20.8, season: 'winter', weather: 'sun', camera: { yaw: 0, pitch: 46, distance: 19, offsetX: 2.4, offsetZ: -3.2 }, showcase: ['festival-show'], ui: 'festival:skate' },
};
