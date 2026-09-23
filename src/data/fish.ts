/**
 * Fish table (pure data): where / when each fish bites, how it fights in the reel minigame,
 * how big it grows and how it looks (the 3D catch mesh, the card illustration and the
 * inventory icon are all painted from `look`).
 *
 * Maps: 'farm' = the homestead pond, 'town' = the Hearthvale river, 'beach' = Driftsand Beach.
 * Zones: 'shallow' bites near the shore (short casts), 'deep' only in deep water (long casts,
 * the pier end), 'any' anywhere on that map.
 */
import type { Season, Weather } from '../core/time';

/** How the fish moves in the reel minigame. */
export type FishBehavior = 'mixed' | 'smooth' | 'dart' | 'sinker' | 'floater';
export type FishTail = 'fork' | 'round' | 'fan' | 'eel' | 'moon';
export type FishPattern = 'none' | 'stripes' | 'spots' | 'bars' | 'speckle' | 'band';

export interface FishLook {
  /** Body depth / length (0.18 slender … 0.6 round). */
  depth: number;
  /** Body width / length (laterally compressed fish ≈ 0.12, round ≈ 0.3). */
  width: number;
  tail: FishTail;
  /** Dorsal fin height relative to body depth (0 = none). */
  dorsal: number;
  back: number;
  side: number;
  belly: number;
  fin: number;
  pattern: FishPattern;
  patternColor: number;
  /** Flat-bodied bottom dweller (flounder): both eyes up, very low width. */
  flat?: boolean;
}

export interface FishDef {
  id: string;
  name: string;
  /** Map ids the fish lives in. */
  maps: string[];
  seasons: Season[];
  /** Inclusive hour window (6..26). */
  hours: [number, number];
  weather?: Weather[];
  /** 0..1: how erratically the fish darts in the reel minigame. */
  difficulty: number;
  behavior: FishBehavior;
  /** Relative bite weight (1 common … 0.05 legendary). */
  rarity: number;
  zone: 'shallow' | 'deep' | 'any';
  /** Length range in cm. */
  size: [number, number];
  sell: number;
  look: FishLook;
  blurb: string;
}

const L = (o: Partial<FishLook> & Pick<FishLook, 'back' | 'side' | 'belly' | 'fin'>): FishLook => ({
  depth: 0.3,
  width: 0.16,
  tail: 'fork',
  dorsal: 0.5,
  pattern: 'none',
  patternColor: 0x222222,
  ...o,
});

const ALL: Season[] = ['spring', 'summer', 'fall', 'winter'];

export const FISH: FishDef[] = [
  // ── Homestead pond ───────────────────────────────────────────────
  { id: 'pondPerch', name: 'Pond Perch', maps: ['farm'], seasons: ['spring', 'summer', 'fall'], hours: [6, 19], difficulty: 0.25, behavior: 'mixed', rarity: 1, zone: 'any', size: [14, 32], sell: 30,
    look: L({ back: 0x5d7a2e, side: 0xc7b347, belly: 0xf1e7c0, fin: 0xe06a35, pattern: 'bars', patternColor: 0x2f3f18, dorsal: 0.75 }),
    blurb: 'Striped like a garden fence and about as stubborn. Grandmother fried them in butter.' },
  { id: 'mossCarp', name: 'Moss Carp', maps: ['farm', 'town'], seasons: ALL, hours: [6, 26], difficulty: 0.15, behavior: 'smooth', rarity: 1, zone: 'any', size: [22, 60], sell: 22,
    look: L({ back: 0x4f5a2a, side: 0x9a8f4a, belly: 0xd9cc92, fin: 0x7a6a3a, pattern: 'speckle', patternColor: 0x3c4520, depth: 0.34, width: 0.2, tail: 'round' }),
    blurb: 'Grows a fuzz of green on its scales if it sits still long enough. It usually does.' },
  { id: 'dewMinnow', name: 'Dew Minnow', maps: ['farm', 'town'], seasons: ['spring'], hours: [6, 11], difficulty: 0.35, behavior: 'dart', rarity: 0.9, zone: 'shallow', size: [5, 11], sell: 40,
    look: L({ back: 0x6e9fb0, side: 0xcfe6ea, belly: 0xf7fbfb, fin: 0xa8d0da, pattern: 'band', patternColor: 0x3a6f86, depth: 0.22, width: 0.12, dorsal: 0.35 }),
    blurb: 'Only rises on spring mornings, when the dew is still on the reeds.' },
  { id: 'lanternEel', name: 'Lantern Eel', maps: ['farm', 'town'], seasons: ['summer', 'fall'], hours: [19, 26], weather: ['rain', 'storm'], difficulty: 0.8, behavior: 'sinker', rarity: 0.25, zone: 'any', size: [45, 110], sell: 160,
    look: L({ back: 0x2c2a3a, side: 0x4a4466, belly: 0xf2c46a, fin: 0xffb347, pattern: 'spots', patternColor: 0xffd27a, depth: 0.11, width: 0.1, tail: 'eel', dorsal: 0.2 }),
    blurb: 'Its belly spots glow like lamp-lit windows. Old folk say it guided lost boats home.' },
  { id: 'frostPike', name: 'Frost Pike', maps: ['farm', 'town'], seasons: ['winter'], hours: [10, 18], difficulty: 0.6, behavior: 'dart', rarity: 0.6, zone: 'any', size: [40, 95], sell: 95,
    look: L({ back: 0x3f5f6a, side: 0x9fc0c8, belly: 0xeef6f8, fin: 0x6f9aa6, pattern: 'spots', patternColor: 0xe8f4f6, depth: 0.2, width: 0.14 }),
    blurb: 'Hunts under the ice with a mouth full of needles. Handle with mittens.' },
  { id: 'amberBream', name: 'Amber Bream', maps: ['farm'], seasons: ['summer'], hours: [12, 20], difficulty: 0.3, behavior: 'floater', rarity: 0.8, zone: 'any', size: [18, 40], sell: 45,
    look: L({ back: 0x8a5a1e, side: 0xe0a640, belly: 0xfbe6b0, fin: 0xc8742a, depth: 0.42, width: 0.12, dorsal: 0.6 }),
    blurb: 'Basks right under the surface on hot afternoons, glowing like honey in a jar.' },
  { id: 'lilyGoby', name: 'Lily Goby', maps: ['farm'], seasons: ['spring', 'summer'], hours: [9, 17], difficulty: 0.2, behavior: 'floater', rarity: 0.85, zone: 'shallow', size: [6, 14], sell: 28,
    look: L({ back: 0x6a8a3a, side: 0xb8d07a, belly: 0xf4f0d0, fin: 0xf29ac0, pattern: 'spots', patternColor: 0xf7d06a, depth: 0.28, width: 0.2, tail: 'round', dorsal: 0.55 }),
    blurb: 'Naps on lily pads when nobody is looking. Pink fins, sleepy eyes.' },
  { id: 'mudwhisker', name: 'Mudwhisker', maps: ['farm', 'town'], seasons: ['spring', 'fall'], hours: [6, 26], weather: ['rain', 'storm'], difficulty: 0.65, behavior: 'sinker', rarity: 0.5, zone: 'any', size: [30, 80], sell: 110,
    look: L({ back: 0x3a3226, side: 0x6e5e44, belly: 0xcab894, fin: 0x4e4232, pattern: 'speckle', patternColor: 0x241e16, depth: 0.2, width: 0.2, tail: 'round', dorsal: 0.3 }),
    blurb: 'Comes up out of the silt when the rain drums on the pond. Wise, whiskery, grumpy.' },
  { id: 'emberKoi', name: 'Ember Koi', maps: ['farm'], seasons: ['fall'], hours: [17, 24], difficulty: 0.55, behavior: 'mixed', rarity: 0.2, zone: 'any', size: [30, 70], sell: 240,
    look: L({ back: 0xf1efe6, side: 0xf5f1e4, belly: 0xfffaf0, fin: 0xf6e8d0, pattern: 'spots', patternColor: 0xe0452a, depth: 0.3, width: 0.18, tail: 'fan', dorsal: 0.4 }),
    blurb: 'Nobody remembers stocking it. It glows orange in the last light of autumn evenings.' },

  // ── Hearthvale river ─────────────────────────────────────────────
  { id: 'brookSpeckle', name: 'Brook Speckle', maps: ['town'], seasons: ['spring', 'fall'], hours: [6, 19], difficulty: 0.45, behavior: 'dart', rarity: 0.9, zone: 'any', size: [18, 45], sell: 65,
    look: L({ back: 0x4a5e3a, side: 0xb89a62, belly: 0xf2d6b0, fin: 0xd8683a, pattern: 'spots', patternColor: 0xd84a3a, depth: 0.24, width: 0.14 }),
    blurb: 'Freckled with little red embers. Leaps the weir every spring like it owns it.' },
  { id: 'silverDace', name: 'Silver Dace', maps: ['town'], seasons: ['spring', 'summer', 'fall'], hours: [6, 20], difficulty: 0.3, behavior: 'smooth', rarity: 1, zone: 'any', size: [12, 28], sell: 32,
    look: L({ back: 0x5a7080, side: 0xd8e2e8, belly: 0xf8fafa, fin: 0xb0bec6, depth: 0.24, width: 0.12, dorsal: 0.45 }),
    blurb: 'Quick as a spoon flashing in a drawer. Schools of them flicker under the bridge.' },
  { id: 'streamChub', name: 'Stream Chub', maps: ['town'], seasons: ['summer'], hours: [6, 26], difficulty: 0.35, behavior: 'mixed', rarity: 0.9, zone: 'any', size: [20, 50], sell: 40,
    look: L({ back: 0x5a5a3a, side: 0xbab090, belly: 0xece4c8, fin: 0xc07a4a, depth: 0.28, width: 0.17, dorsal: 0.45 }),
    blurb: 'Eats anything. Absolutely anything. Once, a button.' },
  { id: 'copperSalmon', name: 'Copperback Salmon', maps: ['town', 'beach'], seasons: ['fall'], hours: [6, 19], difficulty: 0.6, behavior: 'mixed', rarity: 0.6, zone: 'any', size: [50, 95], sell: 120,
    look: L({ back: 0x6a3a2a, side: 0xc86a3e, belly: 0xf0c8a8, fin: 0x8a4a2e, pattern: 'speckle', patternColor: 0x3a1e16, depth: 0.26, width: 0.15 }),
    blurb: 'Turns the colour of a new penny when it swims home up the river each autumn.' },
  { id: 'bristleback', name: 'Old Bristleback', maps: ['town'], seasons: ['summer', 'winter'], hours: [6, 19], difficulty: 0.78, behavior: 'sinker', rarity: 0.2, zone: 'deep', size: [90, 180], sell: 300,
    look: L({ back: 0x4a4a44, side: 0x8a8a7e, belly: 0xd8d4c4, fin: 0x5e5a50, pattern: 'bars', patternColor: 0xc8c4b0, depth: 0.18, width: 0.16, tail: 'fork', dorsal: 0.35 }),
    blurb: 'Armoured like an old knight and probably older than the Lantern Hall.' },
  { id: 'mistShiner', name: 'Mist Shiner', maps: ['town'], seasons: ['winter'], hours: [6, 12], difficulty: 0.3, behavior: 'dart', rarity: 0.9, zone: 'any', size: [8, 18], sell: 38,
    look: L({ back: 0x7a8aa8, side: 0xdce4f2, belly: 0xffffff, fin: 0xb8c6e0, pattern: 'band', patternColor: 0x8aa0d0, depth: 0.22, width: 0.11 }),
    blurb: 'Only bites while the river still steams on frosty mornings.' },
  { id: 'stormBarbel', name: 'Storm Barbel', maps: ['town', 'farm'], seasons: ALL, hours: [6, 26], weather: ['storm'], difficulty: 0.72, behavior: 'dart', rarity: 0.35, zone: 'any', size: [35, 75], sell: 150,
    look: L({ back: 0x2e3a4a, side: 0x5a6e82, belly: 0xc8d4dc, fin: 0xf2d24a, pattern: 'stripes', patternColor: 0xf2d24a, depth: 0.2, width: 0.16, dorsal: 0.4 }),
    blurb: 'Lightning-yellow stripes. Only comes out to play when the thunder does.' },

  // ── Driftsand Beach (ocean) ──────────────────────────────────────
  { id: 'saltHerring', name: 'Driftsand Herring', maps: ['beach'], seasons: ALL, hours: [6, 26], difficulty: 0.2, behavior: 'smooth', rarity: 1, zone: 'any', size: [15, 34], sell: 26,
    look: L({ back: 0x2e5a7a, side: 0xc6d8e2, belly: 0xf6fafc, fin: 0x8aa8bc, depth: 0.23, width: 0.12, dorsal: 0.4 }),
    blurb: 'The whole coast smells of it in summer. Silver, plentiful, and very good smoked.' },
  { id: 'coralSnapper', name: 'Coral Snapper', maps: ['beach'], seasons: ['summer', 'fall'], hours: [6, 19], difficulty: 0.4, behavior: 'mixed', rarity: 0.85, zone: 'any', size: [25, 60], sell: 55,
    look: L({ back: 0xc83a3a, side: 0xf07a62, belly: 0xfbd8c8, fin: 0xe8584a, depth: 0.36, width: 0.15, dorsal: 0.8 }),
    blurb: 'Red as a sunburn and twice as cross about it.' },
  { id: 'sunFlounder', name: 'Sunspot Flounder', maps: ['beach'], seasons: ['spring', 'summer'], hours: [6, 20], difficulty: 0.45, behavior: 'sinker', rarity: 0.7, zone: 'shallow', size: [20, 48], sell: 70,
    look: L({ back: 0x8a7650, side: 0xb8a070, belly: 0xf2ecdc, fin: 0x9a8458, pattern: 'spots', patternColor: 0xf2a23a, depth: 0.55, width: 0.08, tail: 'round', dorsal: 0.15, flat: true }),
    blurb: 'Lies flat in the sand and watches you with both eyes on one side of its face.' },
  { id: 'pearlMackerel', name: 'Pearl Mackerel', maps: ['beach'], seasons: ['fall', 'winter'], hours: [6, 26], difficulty: 0.5, behavior: 'dart', rarity: 0.85, zone: 'any', size: [25, 45], sell: 58,
    look: L({ back: 0x1f5e6a, side: 0xb8d6d0, belly: 0xf8f4ee, fin: 0x5a8a8a, pattern: 'stripes', patternColor: 0x123a44, depth: 0.2, width: 0.15, dorsal: 0.35 }),
    blurb: 'Wavy stripes on its back, a pearly sheen underneath. Swims in restless shoals.' },
  { id: 'kelpCod', name: 'Kelp Cod', maps: ['beach'], seasons: ['winter'], hours: [6, 26], difficulty: 0.35, behavior: 'smooth', rarity: 0.95, zone: 'any', size: [35, 90], sell: 62,
    look: L({ back: 0x5a6a3a, side: 0xa4a878, belly: 0xece8d4, fin: 0x6e7648, pattern: 'speckle', patternColor: 0x3a4424, depth: 0.25, width: 0.18, tail: 'round', dorsal: 0.4 }),
    blurb: 'Hides in the kelp beds all winter. Makes a chowder that could thaw a snowman.' },
  { id: 'moonSmelt', name: 'Moonglass Smelt', maps: ['beach'], seasons: ['fall', 'winter'], hours: [18, 26], difficulty: 0.5, behavior: 'dart', rarity: 0.6, zone: 'any', size: [10, 22], sell: 85,
    look: L({ back: 0x8aa0c8, side: 0xe0e8f8, belly: 0xffffff, fin: 0xd0dcf4, pattern: 'band', patternColor: 0xb0c8ff, depth: 0.2, width: 0.1, dorsal: 0.3 }),
    blurb: 'Nearly see-through. Comes up to nibble moonlight off the tops of the waves.' },
  { id: 'rubyGurnard', name: 'Ruby Gurnard', maps: ['beach'], seasons: ['spring'], hours: [6, 16], difficulty: 0.4, behavior: 'mixed', rarity: 0.8, zone: 'any', size: [20, 45], sell: 60,
    look: L({ back: 0xa82a3a, side: 0xe0605a, belly: 0xf8d0c0, fin: 0x5aa0d8, depth: 0.28, width: 0.2, tail: 'fan', dorsal: 0.7 }),
    blurb: 'Walks along the sea floor on its fins and grunts when you pick it up. Rude.' },
  { id: 'tidestripeBass', name: 'Tidestripe Bass', maps: ['beach'], seasons: ['spring', 'fall'], hours: [6, 19], difficulty: 0.5, behavior: 'mixed', rarity: 0.8, zone: 'any', size: [30, 80], sell: 75,
    look: L({ back: 0x3a4a5a, side: 0xc0c8cc, belly: 0xf4f4f0, fin: 0x7a8a94, pattern: 'stripes', patternColor: 0x2a3440, depth: 0.27, width: 0.15, dorsal: 0.6 }),
    blurb: 'Rides the turning tide right up the beach, stripes like pencil lines.' },
  { id: 'azureRunner', name: 'Azure Runner', maps: ['beach'], seasons: ['summer'], hours: [6, 19], difficulty: 0.72, behavior: 'dart', rarity: 0.4, zone: 'deep', size: [60, 140], sell: 190,
    look: L({ back: 0x1a3a8a, side: 0x6aa0d8, belly: 0xf0f4f8, fin: 0xf2d04a, depth: 0.28, width: 0.2, tail: 'moon', dorsal: 0.45 }),
    blurb: 'Built for speed from nose to crescent tail. It will take your line to the horizon.' },
  { id: 'sandlance', name: 'Sandlance', maps: ['beach'], seasons: ['spring', 'summer'], hours: [6, 12], difficulty: 0.3, behavior: 'floater', rarity: 0.9, zone: 'shallow', size: [10, 24], sell: 24,
    look: L({ back: 0x7a8a6a, side: 0xd8dcc8, belly: 0xfafaf2, fin: 0xc0c4b0, depth: 0.13, width: 0.09, dorsal: 0.25 }),
    blurb: 'Dives head-first into the sand when a gull flies over. Thin as a pencil.' },
  { id: 'duskGrouper', name: 'Dusk Grouper', maps: ['beach'], seasons: ['summer', 'fall'], hours: [17, 21], difficulty: 0.6, behavior: 'sinker', rarity: 0.45, zone: 'deep', size: [50, 120], sell: 170,
    look: L({ back: 0x6a3a5a, side: 0xd07a5a, belly: 0xf6d0a8, fin: 0x8a4a6a, pattern: 'spots', patternColor: 0xf6b060, depth: 0.36, width: 0.22, tail: 'round', dorsal: 0.55 }),
    blurb: 'Painted in sunset colours. Only rises from the reef while the sky matches it.' },
  { id: 'puffling', name: 'Driftwood Puffling', maps: ['beach'], seasons: ['summer'], hours: [11, 16], weather: ['sun', 'wind'], difficulty: 0.65, behavior: 'floater', rarity: 0.4, zone: 'any', size: [12, 30], sell: 140,
    look: L({ back: 0xb89a5a, side: 0xe8d098, belly: 0xfaf4e0, fin: 0xd8b060, pattern: 'spots', patternColor: 0x6a4a2a, depth: 0.6, width: 0.5, tail: 'round', dorsal: 0.3 }),
    blurb: 'Puffs up into a spiky little moon when startled. Please do not startle it.' },
  { id: 'lanternjaw', name: 'The Lanternjaw', maps: ['beach'], seasons: ['summer'], hours: [19, 26], weather: ['rain', 'storm'], difficulty: 0.95, behavior: 'mixed', rarity: 0.06, zone: 'deep', size: [150, 260], sell: 1500,
    look: L({ back: 0x1a2a4a, side: 0x3a5a8a, belly: 0xe0e8f0, fin: 0xffc050, pattern: 'spots', patternColor: 0xffe08a, depth: 0.26, width: 0.2, tail: 'moon', dorsal: 1.1 }),
    blurb: 'A legend of the Driftsand coast: a great fish that carries a light in its jaw on stormy summer nights.' },
];

export const FISH_BY_ID: Record<string, FishDef> = Object.fromEntries(FISH.map((f) => [f.id, f]));

export function fishDef(id: string): FishDef | undefined {
  return FISH_BY_ID[id];
}

/** Beach forageables (washed up each morning along the tide line). */
export interface ForageDef {
  id: string;
  name: string;
  sell: number;
  color: number;
  blurb: string;
  seasons: Season[];
}

export const BEACH_FORAGE: ForageDef[] = [
  { id: 'cockle', name: 'Cockle Shell', sell: 20, color: 0xf0d8b8, blurb: 'Ribbed like a little fan. Hold it to your ear.', seasons: ALL },
  { id: 'spiralConch', name: 'Spiral Conch', sell: 55, color: 0xf2b8a0, blurb: 'Pink inside, like the sky at 6 in the morning.', seasons: ['summer', 'fall'] },
  { id: 'starfish', name: 'Sea Star', sell: 40, color: 0xf07a3a, blurb: 'It was already resting. Politely put it in your pocket.', seasons: ALL },
  { id: 'sandDollar', name: 'Sand Dollar', sell: 35, color: 0xf2ead2, blurb: 'Not legal tender, whatever the fisherman says.', seasons: ['spring', 'summer'] },
  { id: 'seaGlass', name: 'Sea Glass', sell: 30, color: 0x7ad0b8, blurb: 'A bottle, once. Now a small green moon.', seasons: ALL },
  { id: 'coralSprig', name: 'Coral Sprig', sell: 60, color: 0xf0707a, blurb: 'Washed in from somewhere much warmer.', seasons: ['summer'] },
];
