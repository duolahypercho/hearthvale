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
/** Cindergrove: the waterfall, plunge pool and flanking elders, player on the pool path. */
const FOREST_FALLS_CAM = { yaw: 2, pitch: 48, distance: 23, offsetX: -4.2, offsetZ: -3.2 };
/** Driftsand Beach: pier, surf and the shack; sunset looks out over the pier. */
const BEACH_CAM = { yaw: -8, pitch: 46, distance: 36, offsetX: 1, offsetZ: 6.5 };
/** Sunset: looking west along the shore from the pier — glitter path left, the beach + groyne right. */
const BEACH_SUNSET_CAM = { yaw: 100, pitch: 24, distance: 21, offsetX: -3, offsetZ: -2 };
/** Night: from the dunes looking out to sea — the shack's lit window, the lamp-lit pier, the moon's glitter road. */
const BEACH_NIGHT_CAM = { yaw: 196, pitch: 34, distance: 28, offsetX: 4, offsetZ: 4 };
/** Fishing from the pier walkway (cast west over the surf, the beach + groyne + dory in frame). */
const FISH_CAM = { yaw: -14, pitch: 42, distance: 19, offsetX: -3.4, offsetZ: -2.0 };
const FISH_CATCH_CAM = { yaw: -10, pitch: 31, distance: 12, offsetX: -0.6, offsetZ: -1.4 };
/** Mine floors: steep, close diorama framing so the lantern pool fills the frame. */
const MINE_CAM = { yaw: 0, pitch: 42, distance: 17.5, offsetZ: -0.9 };
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
  'farm-harvest': { map: 'farm', x: 20.5, z: 24.5, facing: 'down', time: 9.6, season: 'summer', weather: 'sun', camera: { yaw: 6, pitch: 44, distance: 17, offsetX: 2.0, offsetZ: 0.5 }, showcase: ['harvest'] },
  'farm-tools': { map: 'farm', x: 27.5, z: 20.5, facing: 'left', time: 11.2, season: 'spring', weather: 'sun', camera: { yaw: -46, pitch: 34, distance: 9.6, offsetX: -0.55, offsetZ: -1.3 }, showcase: ['tools'] },
  'farm-giant': { map: 'farm', x: 21.2, z: 29.4, facing: 'left', time: 15.8, season: 'fall', weather: 'sun', camera: { yaw: 10, pitch: 44, distance: 14, offsetX: -2.4, offsetZ: -2.4 }, showcase: ['giant'] },
  'farm-crops': { map: 'farm', x: 28.6, z: 27.2, facing: 'left', time: 10.5, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 44, distance: 12.2, offsetX: -4.6, offsetZ: -4.0 }, showcase: ['gallery'] },
  'farm-crows': { map: 'farm', x: 30.5, z: 30.5, facing: 'left', time: 9.6, season: 'summer', weather: 'sun', camera: { yaw: -10, pitch: 42, distance: 7.2, offsetX: -5.0, offsetZ: 0.3 }, showcase: ['crows'] },
  'farm-harvest-fall': { map: 'farm', x: 19.5, z: 24.5, facing: 'down', time: 10.4, season: 'fall', weather: 'sun', camera: { yaw: 18, pitch: 41, distance: 15.5, offsetX: 1.8, offsetZ: 1.4 }, showcase: ['harvest'] },
  'farm-water': { map: 'farm', x: 27.5, z: 20.5, facing: 'left', time: 10.4, season: 'spring', weather: 'sun', camera: { yaw: -46, pitch: 34, distance: 9.6, offsetX: -0.55, offsetZ: -1.3 }, showcase: ['tools', 'tool:wateringCan'] },
  'farm-pop': { map: 'farm', x: 27.5, z: 20.5, facing: 'down', time: 10.2, season: 'spring', weather: 'sun', camera: { yaw: 14, pitch: 38, distance: 9.5, offsetX: -0.36, offsetZ: -1.45 }, showcase: ['tools', 'tool:harvest'] },
  'farm-slam': { map: 'farm', x: 27.5, z: 20.5, facing: 'left', time: 11.2, season: 'spring', weather: 'sun', camera: { yaw: -48, pitch: 32, distance: 9.6, offsetX: -0.7, offsetZ: -1.6 }, showcase: ['tools', 'tool:charge'] },
  'farm-wither': { map: 'farm', x: 19.4, z: 24.5, facing: 'down', time: 16.2, season: 'fall', weather: 'sun', camera: { yaw: -6, pitch: 46, distance: 19.5, offsetX: 2.9, offsetZ: 0.3 }, showcase: ['wither'] },
  // Town square (plaza, Lantern Hall, villagers).
  'town-evening': { map: 'town', x: 34.9, z: 22.9, facing: 'right', time: 19.05, season: 'spring', weather: 'sun', camera: TOWN_CAM, showcase: ['npcs'] },
  // Town pod: a lower, closer frame on the square's street life (faces read; the Hall crowns the frame).
  'town-day': { map: 'town', x: 34.9, z: 22.9, facing: 'right', time: 10.5, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 36, distance: 27, offsetX: -2.9, offsetZ: -3.6 }, showcase: ['npcs'] },
  'town-dialogue': { map: 'town', x: 31.2, z: 30.8, facing: 'left', time: 10.4, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 44, distance: 17, offsetX: -0.8, offsetZ: -1.2 }, showcase: ['npcs'], ui: 'dialogue:marigold' },
  // Town pod: `&event=<npc>-<2|4>&step=N` picks the heart event; `&npc=<id>&mood=<mood>|&gift=<item>|&ask=1` the dialogue.
  'town-heart-event': { map: 'town', x: 57.6, z: 23.8, facing: 'right', time: 16.8, season: 'spring', weather: 'sun', showcase: ['npcs'] },
  'town-winter': { map: 'town', x: 34.9, z: 22.9, facing: 'right', time: 15.2, season: 'winter', weather: 'snow', camera: { yaw: 0, pitch: 38, distance: 29, offsetX: -2.9, offsetZ: -4.2 }, showcase: ['npcs'] },
  'town-east': { map: 'town', x: 70.6, z: 26.4, facing: 'right', time: 17.4, season: 'summer', weather: 'sun', camera: { yaw: -4, pitch: 43, distance: 34, offsetX: 3.2, offsetZ: -2.4 }, showcase: ['npcs'] },
  'town-cast': { map: 'town', x: 40.4, z: 29.6, facing: 'down', time: 10.8, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 30, distance: 13, offsetX: -7.9, offsetZ: -1.2 }, showcase: ['npcs'] },
  'town-rain': { map: 'town', x: 34.9, z: 22.9, facing: 'right', time: 14, season: 'fall', weather: 'rain', camera: TOWN_CAM, showcase: ['npcs'] },
  // Town pod: Meadow Lane (schoolhouse + kitchen garden), the portrait model sheet (&ui=portraits:<id> = one villager in all
  // nine moods), the Hearthvale Folk social page, and a night-time conversation under the lamps.
  'town-south': { map: 'town', x: 30.4, z: 52.4, facing: 'up', time: 10.4, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 45, distance: 33, offsetX: 1.6, offsetZ: -4.6 }, showcase: ['npcs'] },
  'town-portraits': { map: 'town', x: 32, z: 29, facing: 'down', time: 11, season: 'spring', weather: 'sun', showcase: ['npcs'], ui: 'portraits' },
  'town-social': { map: 'town', x: 32, z: 29, facing: 'down', time: 11, season: 'spring', weather: 'sun', showcase: ['npcs'], ui: 'social' },
  'town-night-talk': { map: 'town', x: 33.6, z: 17.0, facing: 'right', time: 21.4, season: 'summer', weather: 'sun', camera: { yaw: -6, pitch: 44, distance: 16, offsetX: 0.4, offsetZ: -1.4 }, showcase: ['npcs'], ui: 'dialogue:tobias' },
  festival: { map: 'town', x: 35.35, z: 26.3, facing: 'left', time: 20.05, season: 'summer', weather: 'sun', camera: FESTIVAL_CAM, showcase: ['npcs', 'festival'] },
  title: { map: 'farm', x: 31.5, z: 19.5, facing: 'down', time: 18.7, season: 'spring', weather: 'sun', ui: 'title', showcase: ['field'] },
  // Driftsand Beach + fishing (world/beach, systems/fishing). Fishing demos take URL params:
  // &fish=<fishId> (species on the line / in hand), &phase=cast|flight|wait|bite|reel|catch (override the phase).
  'beach-sunset': { map: 'beach', x: 48.9, z: 49.6, facing: 'left', time: 19.3, season: 'summer', weather: 'sun', camera: BEACH_SUNSET_CAM, showcase: ['beach', 'fishing-wait'] },
  'beach-day': { map: 'beach', x: 51, z: 37.5, facing: 'down', time: 11.2, season: 'summer', weather: 'sun', camera: { yaw: -16, pitch: 50, distance: 46, offsetX: 9, offsetZ: 2.5 }, showcase: ['beach'] },
  'beach-night': { map: 'beach', x: 50, z: 38.5, facing: 'down', time: 22.4, season: 'summer', weather: 'sun', camera: BEACH_NIGHT_CAM, showcase: ['beach'] },
  'fishing-cast': { map: 'beach', x: 48.9, z: 52.4, facing: 'left', time: 16.8, season: 'summer', weather: 'sun', camera: FISH_CAM, showcase: ['fishing-cast'] },
  'fishing-wait': { map: 'beach', x: 48.9, z: 52.4, facing: 'left', time: 17.4, season: 'summer', weather: 'sun', camera: FISH_CAM, showcase: ['fishing-wait'] },
  'fishing-bite': { map: 'beach', x: 48.9, z: 52.4, facing: 'left', time: 17.4, season: 'summer', weather: 'sun', camera: FISH_CAM, showcase: ['fishing-bite'] },
  'fishing-reel': { map: 'beach', x: 48.9, z: 52.4, facing: 'left', time: 17.8, season: 'summer', weather: 'sun', camera: FISH_CAM, showcase: ['fishing-reel'] },
  'fishing-pond': { map: 'farm', x: 19.2, z: 40.1, facing: 'left', time: 17.6, season: 'summer', weather: 'sun', camera: { yaw: -18, pitch: 50, distance: 14, offsetX: -2.6, offsetZ: -1.2 }, showcase: ['fishing-reel'] },
  'fishing-river': { map: 'town', x: 61.6, z: 31.5, facing: 'right', time: 10.5, season: 'spring', weather: 'sun', camera: { yaw: 8, pitch: 42, distance: 15, offsetX: 2.2, offsetZ: -0.4 }, showcase: ['fishing-wait'] },
  'fishing-catch': { map: 'beach', x: 48.9, z: 52.4, facing: 'left', time: 18.2, season: 'summer', weather: 'sun', camera: FISH_CATCH_CAM, showcase: ['fishing-catch'] },
  'fishing-flight': { map: 'beach', x: 48.9, z: 52.4, facing: 'left', time: 16.9, season: 'summer', weather: 'sun', camera: FISH_CAM, showcase: ['fishing-flight'] },
  'beach-tidepools': { map: 'beach', x: 12, z: 40, facing: 'down', time: 10.6, season: 'summer', weather: 'sun', camera: { yaw: -8, pitch: 46, distance: 20, offsetX: 0, offsetZ: 4 }, showcase: ['beach'] },
  // Co-op: a second farmer fishing beside you, rendered from snapshots (&rphase=cast|wait|bite|reel|catch,
  // &live=1 cycles the remote through a whole cast → catch loop).
  'coop-fishing': { map: 'beach', x: 48.9, z: 50.8, facing: 'left', time: 17.6, season: 'summer', weather: 'sun', camera: { yaw: -14, pitch: 40, distance: 19, offsetX: -3.6, offsetZ: 0.6 }, showcase: ['fishing-wait', 'coop-fishing'] },
  'beach-tackle': { map: 'beach', x: 53.6, z: 29.2, facing: 'right', time: 10.4, season: 'summer', weather: 'sun', camera: FISH_CAM, showcase: ['beach'], ui: 'tackle' },
  // Cindergrove forest + weather showcases (world/forest, systems/weather). 'fog-morning' / 'rainbow'
  // also switch on the matching atmosphere (the weather system keys off the demo name).
  'forest-day': { map: 'forest', x: 21.0, z: 23.4, facing: 'left', time: 10.4, season: 'summer', weather: 'sun', camera: FOREST_FALLS_CAM, showcase: ['fishing-wait'] },
  // Spring shower on the main trail: puddles on the path, wet bark, drips off the crowns.
  'forest-rain': { map: 'forest', x: 38.5, z: 32.3, facing: 'down', time: 13.5, season: 'spring', weather: 'rain', camera: { yaw: 8, pitch: 46, distance: 24, offsetX: 1.2, offsetZ: -0.6 } },
  // Low three-quarter view from the south: the ivy tower stands up as a silhouette and the flanking
  // crowns frame the glade from the sides instead of roofing over it (canopy < 40 % of the frame).
  'forest-fall': { map: 'forest', x: 50.6, z: 23.8, facing: 'left', time: 16.4, season: 'fall', weather: 'sun', camera: { yaw: -8, pitch: 38, distance: 24, offsetX: 1.5, offsetZ: -6.5 } },
  // The Ember Glade up close: tower (roof, door, lit window, ivy), menhir ring and the ember altar.
  'forest-glade': { map: 'forest', x: 50.2, z: 22.6, facing: 'up', time: 17.2, season: 'summer', weather: 'sun', camera: { yaw: -12, pitch: 48, distance: 25, offsetX: 3.2, offsetZ: -5.4 } },
  'forest-night': { map: 'forest', x: 50.6, z: 23.8, facing: 'up', time: 22.2, season: 'summer', weather: 'sun', camera: { yaw: -8, pitch: 48, distance: 28, offsetX: 1.8, offsetZ: -6.2 } },
  // Storm at the falls: rain sheets over the churning plunge pool, flooded path puddles, a bolt on
  // the west bank (&bolt=0 off). 'storm-meadow' is the open west meadow with the stream behind.
  storm: { map: 'forest', x: 22.5, z: 25.0, facing: 'up', time: 15.5, season: 'summer', weather: 'storm', camera: FOREST_FALLS_CAM },
  'storm-meadow': { map: 'forest', x: 18.8, z: 35.8, facing: 'up', time: 15.5, season: 'summer', weather: 'storm', camera: { yaw: -4, pitch: 47, distance: 26, offsetX: -2.6, offsetZ: -3.6 } },
  // Winter on the frozen stream: stepping stones, the snow-capped footbridge, boot prints.
  'snow-day': { map: 'forest', x: 35.6, z: 34.4, facing: 'down', time: 11, season: 'winter', weather: 'snow', camera: { yaw: 20, pitch: 48, distance: 21, offsetX: 0.4, offsetZ: 0.8 } },
  // Winter at the falls: frozen curtain + icicles over the cracked plunge-pool ice, snow-laden ledges.
  'snow-falls': { map: 'forest', x: 21.0, z: 23.4, facing: 'down', time: 11, season: 'winter', weather: 'snow', camera: FOREST_FALLS_CAM },
  // Dawn mist drifting over the plunge pool below the falls, the low sun raking through the crowns.
  'fog-morning': { map: 'forest', x: 24.2, z: 24.8, facing: 'left', time: 6.8, season: 'spring', weather: 'sun', camera: { yaw: -10, pitch: 44, distance: 24, offsetX: -5.6, offsetZ: -3.0 } },
  // Mist pooling over the stream at the footbridge.
  'fog-bridge': { map: 'forest', x: 41.2, z: 35.4, facing: 'down', time: 6.8, season: 'spring', weather: 'sun', camera: { yaw: -6, pitch: 45, distance: 22, offsetX: -1.8, offsetZ: 2.2 } },
  'forest-wind': { map: 'forest', x: 38.5, z: 32.3, facing: 'down', time: 15.2, season: 'fall', weather: 'wind', camera: { yaw: 8, pitch: 46, distance: 24, offsetX: 1.2, offsetZ: -0.6 } },
  // After the shower: a spray bow in the falls' mist (+ its reflection) and the valley bow behind the crowns.
  rainbow: { map: 'forest', x: 24.2, z: 24.8, facing: 'left', time: 16.2, season: 'spring', weather: 'sun', camera: { yaw: 4, pitch: 44, distance: 25, offsetX: -4.5, offsetZ: -3.5 } },
  // Walking in from the farm: the entry corridor opens up, the carved area plate hangs in the upper third.
  'forest-arrival': { map: 'forest', x: 32.5, z: 4.2, facing: 'down', time: 9.5, season: 'summer', weather: 'sun' },
  // Co-op: two scripted farmhands (no server) — one plucks a find through the host's forage ledger,
  // both under a host-rolled lightning strike (world/forest/coop.ts, systems/weather.ts 'w.bolt').
  'coop-forest': { map: 'forest', x: 17.4, z: 37.2, facing: 'up', time: 15.4, season: 'spring', weather: 'storm', camera: { yaw: -4, pitch: 46, distance: 22, offsetX: -0.6, offsetZ: -3.2 } },
  'farm-storm': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 15, season: 'summer', weather: 'storm', camera: HOME_CAM },
  'farm-wind': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 10, season: 'spring', weather: 'wind', camera: HOME_CAM },
  // Audio pod: the farm at golden morning with a "now playing" banner. URL: &theme=<spring|spring-2|spring-3|summer|
  // summer-2|summer-3|fall|fall-2|fall-3|winter|winter-2|winter-3|night|night-spring|night-fall|night-winter|town|beach|
  // mine|mine-ice|mine-lava|rain|inn|forest|festival|festival-blossom|festival-tide|festival-harvest|festival-starfall|
  // title|none> or a playlist (farm:spring, night:fall ...), &card=1 pins the now-playing card (notes float out of it
  // in time with the tune once sound runs — press any key), &sfx=<name> repeats an SFX every 2.5 s, &audio=1 starts the
  // AudioContext without a click where autoplay allows. audio-summer / audio-fall / audio-winter stage the other seasons.
  audio: { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 8.2, season: 'spring', weather: 'sun', camera: HOME_CAM },
  'audio-summer': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 13.5, season: 'summer', weather: 'sun', camera: HOME_CAM },
  'audio-fall': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 15.5, season: 'fall', weather: 'sun', camera: HOME_CAM },
  'audio-winter': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 11, season: 'winter', weather: 'snow', camera: HOME_CAM },
  'winter-night': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 21.5, season: 'winter', weather: 'snow', camera: HOME_CAM },
  // Farm buildings, interiors & animals (camera framing lives with each interior; these override it).
  'house-interior': { map: 'house', x: 5.3, z: 5.9, facing: 'down', time: 8.4, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 17.2, offsetZ: -0.35 }, showcase: ['interior'] },
  'house-night': { map: 'house', x: 7.3, z: 5.1, facing: 'down', time: 21.6, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 16.8, offsetZ: -0.35 }, showcase: ['interior'] },
  // Bedtime: the "Go to bed for the night?" prompt beside the quilted bed / tucked in under the quilt, room dimmed, Zzz.
  'house-bedtime': { map: 'house', x: 9.6, z: 2.9, facing: 'right', time: 21.8, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 16.8, offsetZ: -0.35 }, showcase: ['interior', 'bed-ask'] },
  'animals-dayend': { map: 'house', x: 9.6, z: 2.9, facing: 'down', time: 22.2, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 16.8, offsetZ: -0.35 }, showcase: ['interior', 'animals', 'dayend'] },
  'house-asleep': { map: 'house', x: 9.6, z: 2.9, facing: 'down', time: 22.4, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 16.8, offsetZ: -0.35 }, showcase: ['interior', 'bed-lie'] },
  'coop-interior': { map: 'coop', x: 3.3, z: 4.55, facing: 'down', time: 9.2, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 48, distance: 12.6, offsetZ: 0.4 }, showcase: ['animals'] },
  // Morning egg round: the farmer lifts a gold-star egg overhead from the nesting boxes (&nest=0..5).
  'coop-eggs': { map: 'coop', x: 3.35, z: 0.55, facing: 'left', time: 7.4, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 48, distance: 12.6, offsetZ: 0.4 }, showcase: ['animals', 'eggs'] },
  'barn-interior': { map: 'barn', x: 8.67, z: 5.05, facing: 'down', time: 16.8, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 42, distance: 17.2, offsetZ: 0.1 }, showcase: ['animals'] },
  'animals-pasture': { map: 'farm', x: 40.3, z: 41.5, facing: 'right', time: 10.5, season: 'spring', weather: 'sun', camera: { yaw: -6, pitch: 46, distance: 21, offsetX: 1.8, offsetZ: -2.2 }, showcase: ['animals'] },
  // Perf: the pasture with three co-op farmhands on the farm (DESIGN pillar 13/14: 4 players + a full herd).
  'animals-coop': { map: 'farm', x: 40.3, z: 41.5, facing: 'right', time: 10.5, season: 'spring', weather: 'sun', camera: { yaw: -6, pitch: 46, distance: 21, offsetX: 1.8, offsetZ: -2.2 }, showcase: ['animals', 'coop'] },
  // Petting close-up: crouch + reach, big heart pop with mini hearts, the animal's name + heart meter.
  'animals-petting': { map: 'farm', x: 45.3, z: 40.2, facing: 'left', time: 10.8, season: 'spring', weather: 'sun', camera: { yaw: -4, pitch: 40, distance: 11, offsetX: -0.6, offsetZ: -0.6 }, showcase: ['animals', 'pet-close'] },
  // &pet=dog|cat picks the pet, &hearts=0 stops the staged petting hearts (all 'animals' showcases).
  'coop-night': { map: 'coop', x: 4.5, z: 4.6, facing: 'down', time: 21.2, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 47, distance: 13.2, offsetZ: 0.6 }, showcase: ['animals'] },
  'barn-night': { map: 'barn', x: 6.5, z: 5.6, facing: 'down', time: 21.4, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 42, distance: 16.8, offsetZ: 0.1 }, showcase: ['animals'] },
  // Close-up line-up of every species + coat (model review): &cam= to orbit.
  'animals-gallery': { map: 'farm', x: 50.2, z: 42.4, facing: 'left', time: 15.6, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 26, distance: 10.5, offsetX: -5.8, offsetZ: -2.4 }, showcase: ['animals'] },
  // 6 am in the coop: dawn light shafts, eggs in the nest boxes.
  'coop-dawn': { map: 'coop', x: 4.6, z: 4.1, facing: 'up', time: 6.1, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 47, distance: 13.2, offsetZ: 0.6 }, showcase: ['animals'] },
  'pet-yard': { map: 'farm', x: 36.5, z: 18.7, facing: 'left', time: 16.4, season: 'summer', weather: 'sun', camera: { yaw: -10, pitch: 44, distance: 13, offsetX: 0.4, offsetZ: -1.2 }, showcase: ['animals'] },
  carpenter: { map: 'farm', x: 36.5, z: 31.2, facing: 'up', time: 11, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 46, distance: 17, offsetX: 1.5, offsetZ: -0.5 }, showcase: ['animals'], ui: 'carpenter' },
  'carpenter-animals': { map: 'farm', x: 36.5, z: 31.2, facing: 'up', time: 11, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 46, distance: 17, offsetX: 1.5, offsetZ: -0.5 }, showcase: ['animals'], ui: 'carpenter:animals' },
  // Mines (systems/mining + systems/combat, world/mine): the mountain entrance and one floor per biome band.
  // The floor demos pick a showcase spot on the seeded floor; &floor=N stages any floor (biome follows).
  mine: { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-entrance': { map: 'mine-entrance', x: 22.6, z: 14.4, facing: 'down', time: 17.2, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 40, distance: 25, offsetX: 0.4, offsetZ: -4.2 }, showcase: [] },
  'mine-floor': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-ice': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-lava': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: MINE_CAM, showcase: [] },
  'mine-combat': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 40, distance: 17, offsetZ: -0.7 }, showcase: [] },
  // Co-op in the mines, no server: two scripted farmhands (a sword fighter + a miner) beside you.
  'mine-coop': { map: 'mine', x: 10, z: 10, facing: 'down', time: 12, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 41, distance: 18, offsetZ: -0.8 }, showcase: [] },
  // Milestone treasure chest (floor 10; &floor=20|30): the farmer opens it, the sword is reforged (&open=0 keeps it shut).
  'mine-chest': { map: 'mine', x: 10, z: 10, facing: 'up', time: 12, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 42, distance: 15.5, offsetZ: -0.6 }, showcase: [] },
  // Seasonal festivals (systems/festivals.ts, world/festivals/*): each stages its showcase moment.
  'fest-spring': { map: 'fest-spring', x: 25.2, z: 27.9, facing: 'right', time: 11.2, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 42, distance: 31, offsetX: 6.6, offsetZ: -2.1 }, showcase: ['festival-show'] },
  'fest-summer': { map: 'fest-summer', x: 32.6, z: 22.4, facing: 'up', time: 21.4, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 30, distance: 32, offsetX: -3.2, offsetZ: -7.5 }, showcase: ['festival-show'] },
  'fest-fall': { map: 'fest-fall', x: 32.6, z: 22.4, facing: 'up', time: 14.3, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 45, distance: 30, offsetX: 0.6, offsetZ: -4.6 }, showcase: ['festival-show'] },
  // Starfall opens at dusk (rose-lit snow, the first lamps); `fest-winter-night` = full dark, aurora + lamplight on the ice.
  'fest-winter': { map: 'fest-winter', x: 32.4, z: 27.6, facing: 'up', time: 18.8, season: 'winter', weather: 'sun', camera: { yaw: 0, pitch: 31, distance: 43, offsetX: -0.4, offsetZ: -7.6 }, showcase: ['festival-show'] },
  'fest-winter-night': { map: 'fest-winter', x: 32.4, z: 27.6, facing: 'up', time: 20.6, season: 'winter', weather: 'sun', camera: { yaw: 0, pitch: 30, distance: 42, offsetX: -0.4, offsetZ: -7.8 }, showcase: ['festival-show'] },
  // Festival mini-games (they play themselves while the demo is paused): Ribbon Dance, Lantern Release, Sack Race,
  // Produce Judging, Gift Exchange, Starlight Skate. Same as `?demo=fest-<season>&ui=festival:<activity>`.
  'fest-spring-dance': { map: 'fest-spring', x: 31.2, z: 37.2, facing: 'up', time: 12.2, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 38, distance: 19.5, offsetX: 0.4, offsetZ: -4.4 }, showcase: ['festival-show'], ui: 'festival:dance' },
  'fest-summer-lanterns': { map: 'fest-summer', x: 31.5, z: 20.7, facing: 'up', time: 21.2, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 30, distance: 16, offsetZ: -3.5 }, showcase: ['festival-show'], ui: 'festival:lanterns' },
  'fest-fall-race': { map: 'fest-fall', x: 14.3, z: 25.5, facing: 'right', time: 15.1, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 36, distance: 20, offsetX: 4.2, offsetZ: -2.2 }, showcase: ['festival-show'], ui: 'festival:sackrace' },
  'fest-fall-judging': { map: 'fest-fall', x: 35.4, z: 19.4, facing: 'up', time: 13.2, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 40, distance: 17, offsetZ: -2.6 }, showcase: ['festival-show'], ui: 'festival:pumpkin' },
  'fest-winter-gifts': { map: 'fest-winter', x: 32, z: 25.5, facing: 'up', time: 20.4, season: 'winter', weather: 'sun', camera: { yaw: 0, pitch: 34, distance: 15, offsetZ: -2.4 }, showcase: ['festival-show'], ui: 'festival:giftswap' },
  'fest-winter-skate': { map: 'fest-winter', x: 35.4, z: 29.6, facing: 'right', time: 20.8, season: 'winter', weather: 'sun', camera: { yaw: 0, pitch: 46, distance: 19, offsetX: 2.4, offsetZ: -3.2 }, showcase: ['festival-show'], ui: 'festival:skate' },
  // Story pod (systems/story*.ts, cutscene.ts): cutscene stills freeze at a scene's `mark`;
  // hall demos stage the Lantern Hall interior (&lit=0-6 lights the first N rooms instead).
  'intro-letter': { map: 'town', x: 8.6, z: 27.6, facing: 'right', time: 19.15, season: 'spring', weather: 'sun', showcase: ['story:scene:intro:letter'] },
  'intro-establish': { map: 'town', x: 8.6, z: 27.6, facing: 'right', time: 19.15, season: 'spring', weather: 'sun', showcase: ['story:scene:intro:establish'] },
  'intro-arrival': { map: 'town', x: 8.6, z: 27.6, facing: 'right', time: 19.15, season: 'spring', weather: 'sun', showcase: ['story:scene:intro:arrival'] },
  'intro-night': { map: 'house', x: 7.6, z: 4.6, facing: 'left', time: 21.4, season: 'spring', weather: 'sun', showcase: ['story:scene:intro:night'] },
  'intro-farm': { map: 'farm', x: 31.4, z: 21.6, facing: 'up', time: 20.4, season: 'spring', weather: 'sun', showcase: ['story:scene:intro:farm'] },
  'intro-morning': { map: 'farm', x: 31.5, z: 18.6, facing: 'down', time: 6.1, season: 'spring', weather: 'sun', showcase: ['story:scene:intro:morning'] },
  'lantern-room-react': { map: 'hall', x: 15, z: 17.5, facing: 'up', time: 21, season: 'spring', weather: 'sun', showcase: ['story:progress:0', 'story:scene:room-seed:react'] },
  'lantern-hall-dark': { map: 'hall', x: 15, z: 17.5, facing: 'up', time: 21, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 48, distance: 25.5, offsetZ: -4.6 }, showcase: ['hall:dark', 'story:progress:0'] },
  'lantern-hall-overview': { map: 'hall', x: 15, z: 17.5, facing: 'up', time: 21, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 31, offsetZ: -5.2 }, showcase: ['hall:dark', 'story:progress:0'] },
  'lantern-hall-restored': { map: 'hall', x: 15, z: 17.5, facing: 'up', time: 21, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 31, offsetZ: -5.2 }, showcase: ['hall:restored', 'story:progress:6'] },
  'lantern-room-lit': { map: 'hall', x: 15, z: 17.5, facing: 'up', time: 21, season: 'spring', weather: 'sun', showcase: ['story:progress:0', 'story:scene:room-seed'] },
  'bundle-ui': { map: 'hall', x: 9.4, z: 7.2, facing: 'left', time: 21, season: 'spring', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 31, offsetZ: -5.2 }, showcase: ['story:progress:2'], ui: 'bundles:harvest' },
  journal: { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 10, season: 'spring', weather: 'sun', camera: HOME_CAM, showcase: ['story:progress:2'], ui: 'journal' },
  'help-board': { map: 'town', x: 27.5, z: 20.4, facing: 'up', time: 10.5, season: 'spring', weather: 'sun', camera: TOWN_CAM, showcase: ['npcs', 'story:progress:2'], ui: 'board' },
  'glimmer-offer': { map: 'town', x: 31.8, z: 18.1, facing: 'up', time: 18.2, season: 'summer', weather: 'sun', showcase: ['story:progress:3', 'story:scene:glimmer-offer:choice'] },
  'lantern-festival': { map: 'town', x: 32, z: 20.2, facing: 'up', time: 20, season: 'winter', weather: 'sun', showcase: ['npcs', 'story:progress:6', 'story:scene:finale'] },
  'lantern-festival-sky': { map: 'town', x: 32, z: 20.2, facing: 'up', time: 20, season: 'winter', weather: 'sun', showcase: ['npcs', 'story:progress:6', 'story:scene:finale:sky'] },
  'lantern-room-reveal': { map: 'hall', x: 15, z: 17.5, facing: 'up', time: 21, season: 'spring', weather: 'sun', showcase: ['story:progress:1', 'story:scene:room-seed:reveal'] },
  // Glimmerco thread: the kiosk (Spring 15+), Sterling's visits, the signed path (EverGlow hall, van +
  // floodlight on the square) and his redemption after a refusal. `&room=<id>` on lantern-room-* too.
  'lantern-hall-glimmer': { map: 'hall', x: 15, z: 17.5, facing: 'up', time: 21, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 31, offsetZ: -5.2 }, showcase: ['story:progress:3', 'story:glimmer'] },
  'glimmer-town': { map: 'town', x: 30.6, z: 21.4, facing: 'up', time: 21.2, season: 'summer', weather: 'sun', camera: { yaw: 0, pitch: 34, distance: 26, offsetX: 1.4, offsetZ: -4.6 }, showcase: ['npcs', 'story:progress:3', 'story:glimmer'] },
  'glimmer-accept': { map: 'town', x: 31, z: 16.1, facing: 'up', time: 18.2, season: 'summer', weather: 'sun', showcase: ['story:progress:3', 'story:glimmer', 'story:scene:glimmer-accept:after'] },
  'glimmer-kiosk': { map: 'town', x: 35.2, z: 27.4, facing: 'right', time: 11, season: 'spring', weather: 'sun', camera: { yaw: -18, pitch: 36, distance: 15, offsetX: 1.2, offsetZ: -0.4 }, showcase: ['npcs', 'story:progress:1', 'story:kiosk'] },
  'glimmer-survey': { map: 'town', x: 30.2, z: 21.2, facing: 'up', time: 14.5, season: 'spring', weather: 'sun', showcase: ['story:progress:1', 'story:scene:glimmer-survey'] },
  'glimmer-marigold': { map: 'town', x: 23.8, z: 23.5, facing: 'left', time: 12.5, season: 'spring', weather: 'sun', showcase: ['story:progress:2', 'story:scene:glimmer-marigold'] },
  'sterling-redeem': { map: 'town', x: 30.2, z: 19.4, facing: 'up', time: 19.6, season: 'fall', weather: 'sun', showcase: ['story:progress:6', 'story:scene:sterling-redeem'] },
  // Story r2: the whole room-complete flow unpaused (altar → seal → auto-close → celebration; `&room=`,
  // `&auto=0`), Kit's doubts before the offer, the wager's two endings, the valley-wide finale crane.
  'bundle-complete': { map: 'hall', x: 9.4, z: 13.2, facing: 'left', time: 21, season: 'fall', weather: 'sun', camera: { yaw: 0, pitch: 50, distance: 31, offsetZ: -5.2 }, showcase: ['story:complete:harvest'] },
  'glimmer-doubts': { map: 'town', x: 31.8, z: 18.1, facing: 'up', time: 18.2, season: 'summer', weather: 'sun', showcase: ['story:progress:3', 'story:scene:glimmer-offer:doubts'] },
  'glimmer-concede': { map: 'town', x: 31.8, z: 18.1, facing: 'up', time: 17.2, season: 'summer', weather: 'sun', showcase: ['story:progress:4', 'story:scene:glimmer-concede'] },
  'glimmer-return': { map: 'town', x: 31.8, z: 18.1, facing: 'up', time: 18.4, season: 'summer', weather: 'sun', showcase: ['story:progress:3', 'story:scene:glimmer-return'] },
  'lantern-festival-valley': { map: 'town', x: 32, z: 20.2, facing: 'up', time: 20, season: 'winter', weather: 'sun', showcase: ['npcs', 'story:progress:6', 'story:scene:finale:valley'] },
  // UI/UX pod (src/ui): one demo per screen over the morning farm; a staged demo stocks a lived-in backpack
  // (ui/demo-kit.ts). `ui-hud` = gameplay HUD with toasts; `?demo=farm-morning&ui=<screen>` works too.
  'ui-hud': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM },
  'ui-title': { map: 'farm', x: 31.5, z: 19.5, facing: 'down', time: 18.7, season: 'spring', weather: 'sun', ui: 'title', showcase: ['field'] },
  'ui-inventory': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'inventory' },
  'ui-shop': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'shop' },
  'ui-shop-smith': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'shop:odessa' },
  'ui-placement': { map: 'farm', x: 34.4, z: 26.5, facing: 'right', time: 9, season: 'spring', weather: 'sun', camera: { yaw: -5, pitch: 50, distance: 13, offsetX: 1, offsetZ: 0.4 } },
  'ui-shop-carpenter': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'shop:rowan' },
  'ui-crafting': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'crafting' },
  'ui-dayend': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 23.5, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'dayend' },
  'ui-dayend-quiet': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 23.5, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'dayend:quiet' },
  'ui-map': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'map' },
  'ui-settings': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'settings' },
  'ui-pause': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'pause' },
  'ui-saves': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'saves' },
  'ui-icons': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 7.6, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'icons' },
  // New Journal (character creator in the world: name, farm, look, pet, slot) — `ui=newgame:demo` pre-fills it.
  'ui-newgame': { map: 'farm', x: 31.5, z: 19.5, facing: 'down', time: 18.4, season: 'spring', weather: 'sun', ui: 'newgame:demo', showcase: ['field'] },
  // Late-afternoon HUD at low energy + low health: both tubes, the low pulse and the red heartbeat vignette.
  'ui-hud-low': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 17.2, season: 'spring', weather: 'sun', camera: HOME_CAM },
  // Co-op entry from the title (host / join lobby with invite code and farmer slots; staged, no server).
  'ui-coop': { map: 'farm', x: 31.5, z: 19.5, facing: 'down', time: 18.2, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'coop:demo' },
  // Multiplayer pod (src/net, src/ui/coop*): three scripted farmhands on the host's farm (no server needed) — hoeing,
  // watering, chatting — with cabins, name tags, emote bubbles and the roster; the lobby / character creator.
  'coop-farm': { map: 'farm', x: 26.9, z: 24.38, facing: 'down', time: 9.4, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 40, distance: 19, offsetX: -1.6, offsetZ: -1.6 }, showcase: ['field', 'coop'] },
  'coop-lobby': { map: 'farm', x: 31.5, z: 19.5, facing: 'down', time: 18.2, season: 'spring', weather: 'sun', camera: HOME_CAM, ui: 'coop:demo' },
  // Co-op night: the three farmhands are in bed, you're still up (holdout nudge + glowing roster sleepers) /
  // the day-end card with the "Farm today" row (every farmer's harvest, watering, tilling, sowing).
  'coop-bedtime': { map: 'farm', x: 29.6, z: 22.2, facing: 'down', time: 22.6, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 42, distance: 17, offsetX: -0.6, offsetZ: -1.2 }, showcase: ['field', 'coop'] },
  'coop-dayend': { map: 'farm', x: 31.2, z: 20.2, facing: 'down', time: 23.5, season: 'spring', weather: 'sun', camera: HOME_CAM, showcase: ['coop'], ui: 'dayend' },
  // Co-op social stills: the emote wheel open over the farm (&emote=<id>) / typing a chat line (&say=<text>).
  'coop-emote': { map: 'farm', x: 26.9, z: 24.38, facing: 'down', time: 9.4, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 40, distance: 19, offsetX: -1.6, offsetZ: -1.6 }, showcase: ['field', 'coop'] },
  'coop-chat': { map: 'farm', x: 26.9, z: 24.38, facing: 'down', time: 9.4, season: 'spring', weather: 'sun', camera: { yaw: -8, pitch: 40, distance: 19, offsetX: -1.6, offsetZ: -1.6 }, showcase: ['field', 'coop'] },
};
