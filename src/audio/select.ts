/**
 * Which piece of the score fits the moment. Pure function of game state so it can be unit-checked
 * and reasoned about in one place:
 *
 *   title screen            'title'
 *   forced (debug / scene)  whatever was forced
 *   festival grounds        that festival's arrangement ('festival-<id>' or the Lantern Jig)
 *   the mine                'mine' (dark ambient)
 *   01:00 – 06:20           nothing — crickets, wind and the house creaking carry the night
 *   storm outdoors          nothing — the thunder is the score
 *   rain                    'rain' (lo-fi window-weather piece, indoors too)
 *   20:00 onward            'night' (lullaby)
 *   town / Lantern Hall     'town'
 *   beach                   'beach'
 *   farm / forest / homes   the season's theme
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
}

export function chooseTheme(c: MusicContext): string | null {
  if (c.title) return 'title';
  if (c.forced) return c.forced === 'none' ? null : c.forced;
  if (c.festival) return c.festival;
  if (c.map.startsWith('fest-')) return 'festival';
  if (c.map === 'mine') return 'mine';
  if (c.hour >= 25 || c.hour < 6.33) return null;
  const wet = c.weather === 'rain' || c.weather === 'storm';
  if (c.weather === 'storm' && !c.indoor) return null;
  if (wet) return 'rain';
  if (c.hour >= 20) return 'night';
  if (c.map === 'town' || c.map === 'hall') return 'town';
  if (c.map === 'beach') return 'beach';
  return c.season === 'summer' || c.season === 'fall' || c.season === 'winter' ? c.season : 'spring';
}
