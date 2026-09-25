/**
 * Which piece of the score fits the moment. Pure function of game state so it can be unit-checked
 * and reasoned about in one place:
 *
 *   title screen            'title'
 *   forced (debug / scene)  whatever was forced
 *   festival grounds        that festival's arrangement ('festival-<id>' or the Lantern Jig)
 *   the mine                'mine' / 'mine-ice' / 'mine-lava' by floor band
 *   01:00 – 06:06           nothing — crickets, wind and the house creaking carry the night
 *                           (the morning song starts just after the wake-up chime)
 *   the inn / bakery        'inn' (its own tune, rain or shine, until late)
 *   rain / storm            'rain' (lo-fi window-weather piece, indoors too). A storm keeps it
 *                           outdoors as well, only quieter (STORM_OUTDOOR_LEVEL, applied by the
 *                           adapter as a level, not a new selection) so the thunder still leads and
 *                           stepping through a door never stops / restarts the score
 *   20:00 onward            'night:<season>' (the season's lullabies)
 *   town 17:30 – 20:00      'inn' (evening in the square)
 *   town / Lantern Hall /
 *   shops & clinic          'town'
 *   beach                   'beach'
 *   forest                  'forest'
 *   farm / homes            'farm:<season>' (the season's three songs)
 *
 * 'farm:<season>' and 'night:<season>' are playlists (PLAYLISTS): the music director resolves them
 * to one concrete song with `songFor` — a day-seeded rotation that never opens a day with the song
 * that opened the day before, and never plays the same song twice in a row within a day.
 */
export interface MusicContext {
  map: string;
  hour: number;
  season: string;
  weather: string;
  indoor: boolean;
  title: boolean;
  festival: string | null;
  forced: string | null;
  /** Mine floor (for the deeper layers); 0/undefined = unknown. */
  mineFloor?: number;
}

/** Music level outdoors in a storm (× the normal level): the rain tune under the thunder. */
export const STORM_OUTDOOR_LEVEL = 0.55;

export function mineThemeFor(floor: number | undefined): string {
  if (!floor || floor < 1) return 'mine';
  const band = Math.floor((floor - 1) / 10) % 3;
  return band === 0 ? 'mine' : band === 1 ? 'mine-ice' : 'mine-lava';
}

export function chooseTheme(c: MusicContext): string | null {
  if (c.title) return 'title';
  if (c.forced) return c.forced === 'none' ? null : c.forced;
  if (c.festival) return c.festival;
  if (c.map.startsWith('fest-')) return 'festival';
  if (c.map === 'mine') return mineThemeFor(c.mineFloor);
  if (c.hour >= 25 || c.hour < 6.1) return null;
  if ((c.map === 'inn' || c.map === 'bakery') && c.hour < 24) return 'inn';
  if (c.weather === 'rain' || c.weather === 'storm') return 'rain';
  if (c.hour >= 20) return `night:${seasonOf(c.season)}`;
  // Early evening in the square: the inn's tune spills out across the plaza.
  if (c.map === 'town' && c.hour >= 17.5) return 'inn';
  if (c.map === 'town' || c.map === 'hall' || c.map === 'shop' || c.map === 'clinic' || c.map === 'smithy') return 'town';
  if (c.map === 'beach') return 'beach';
  if (c.map === 'forest') return 'forest';
  return `farm:${seasonOf(c.season)}`;
}

function seasonOf(s: string): 'spring' | 'summer' | 'fall' | 'winter' {
  return s === 'summer' || s === 'fall' || s === 'winter' ? s : 'spring';
}

/** Song rotations. Every entry is a THEMES id (src/audio/themes.ts). */
export const PLAYLISTS: Record<string, readonly string[]> = {
  'farm:spring': ['spring', 'spring-2', 'spring-3'],
  'farm:summer': ['summer', 'summer-2', 'summer-3'],
  'farm:fall': ['fall', 'fall-2', 'fall-3'],
  'farm:winter': ['winter', 'winter-2', 'winter-3'],
  'night:spring': ['night-spring', 'night'],
  'night:summer': ['night', 'night-spring'],
  'night:fall': ['night-fall', 'night'],
  'night:winter': ['night-winter', 'night'],
};

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/**
 * The concrete song for a playlist on a day: `daySeed` is year·1000 + season·100 + day (the audio
 * system's day seed), `k` counts the songs of this playlist already started today. The first song
 * of each day walks a seeded path through the list that never repeats the previous day's opener;
 * later songs that day step on through the list, so two in a row are always different.
 * Non-playlist ids pass through unchanged.
 */
export function songFor(group: string, daySeed: number, k = 0): string {
  const list = PLAYLISTS[group];
  if (!list || !list.length) return group;
  const n = list.length;
  if (n === 1) return list[0]!;
  const day = Math.max(1, daySeed % 100);
  const block = Math.floor(daySeed / 100);
  const salt = [...group].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
  let idx = mix(block, salt) % n;
  for (let d = 2; d <= day; d++) idx = (idx + 1 + (mix(block * 31 + d, salt) % (n - 1))) % n;
  return list[(idx + k) % n]!;
}
