/**
 * Which piece of the score fits the moment. Pure function of game state so it can be unit-checked
 * and reasoned about in one place:
 *
 *   title screen            'title'
 *   forced (debug / scene)  whatever was forced
 *   festival grounds        that festival's arrangement ('festival-<id>' or the Lantern Jig)
 *   the mine                'mine' / 'mine-ice' / 'mine-lava' by floor band
 *   01:00 – 06:20           nothing — crickets, wind and the house creaking carry the night
 *   storm outdoors          nothing — the thunder is the score
 *   the inn / bakery        'inn' (its own tune, rain or shine, until late)
 *   rain                    'rain' (lo-fi window-weather piece, indoors too)
 *   20:00 onward            'night' (lullaby)
 *   town 17:30 – 20:00      'inn' (evening in the square)
 *   town / Lantern Hall /
 *   shops & clinic          'town'
 *   beach                   'beach'
 *   forest                  'forest'
 *   farm / homes            the season's theme
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
  if (c.hour >= 25 || c.hour < 6.33) return null;
  if ((c.map === 'inn' || c.map === 'bakery') && c.hour < 24) return 'inn';
  const wet = c.weather === 'rain' || c.weather === 'storm';
  if (c.weather === 'storm' && !c.indoor) return null;
  if (wet) return 'rain';
  if (c.hour >= 20) return 'night';
  // Early evening in the square: the inn's tune spills out across the plaza.
  if (c.map === 'town' && c.hour >= 17.5) return 'inn';
  if (c.map === 'town' || c.map === 'hall' || c.map === 'shop' || c.map === 'clinic' || c.map === 'smithy') return 'town';
  if (c.map === 'beach') return 'beach';
  if (c.map === 'forest') return 'forest';
  return c.season === 'summer' || c.season === 'fall' || c.season === 'winter' ? c.season : 'spring';
}
