/** Fish table (pure data): where / when each fish bites and how hard it fights. */
import type { Season, Weather } from '../core/time';

export interface FishDef {
  id: string;
  name: string;
  /** Map ids the fish lives in ('farm' = the pond). */
  maps: string[];
  seasons: Season[];
  /** Inclusive hour window. */
  hours: [number, number];
  weather?: Weather[];
  /** 0..1: how erratically the fish darts in the reel minigame. */
  difficulty: number;
  sell: number;
}

export const FISH: FishDef[] = [
  { id: 'pondPerch', name: 'Pond Perch', maps: ['farm'], seasons: ['spring', 'summer', 'fall'], hours: [6, 19], difficulty: 0.25, sell: 30 },
  { id: 'mossCarp', name: 'Moss Carp', maps: ['farm'], seasons: ['spring', 'summer', 'fall', 'winter'], hours: [6, 26], difficulty: 0.15, sell: 22 },
  { id: 'dewMinnow', name: 'Dew Minnow', maps: ['farm'], seasons: ['spring'], hours: [6, 11], difficulty: 0.35, sell: 40 },
  { id: 'lanternEel', name: 'Lantern Eel', maps: ['farm'], seasons: ['summer', 'fall'], hours: [19, 26], weather: ['rain', 'storm'], difficulty: 0.8, sell: 160 },
  { id: 'frostPike', name: 'Frost Pike', maps: ['farm'], seasons: ['winter'], hours: [10, 18], difficulty: 0.6, sell: 95 },
];
