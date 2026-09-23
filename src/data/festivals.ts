/**
 * Seasonal festivals of Hearthvale (pure data). One per season, each on its own dressed map.
 * Original events, names and lines — keep them warm and a little odd.
 */
import type { Season } from '../core/time';

export type FestivalId = 'blossom' | 'tide' | 'harvest' | 'starfall';

export interface FestivalDef {
  id: FestivalId;
  name: string;
  season: Season;
  day: number;
  /** Open hours (24h+, e.g. 26 = 2 am). */
  open: number;
  close: number;
  /** Festival map id. */
  map: string;
  /** Arrival point on the festival map. */
  arrive: { x: number; z: number };
  /** One-line invitation (morning toast / notice board). */
  blurb: string;
  /** The main event and when it starts. */
  event: { name: string; hour: number; minigame: MinigameId };
  /** Festival palette (UI accents, bunting). */
  colors: number[];
  /** Music mood hint for the audio system. */
  music: { tempo: number; mode: 'major' | 'lydian' | 'dorian' | 'mixolydian'; timbre: 'pluck' | 'bell' | 'strings' | 'fiddle' };
  /** What villagers say at this festival (by villager id; `*` = anyone). */
  lines: Record<string, string[]>;
}

export type MinigameId = 'dance' | 'lanterns' | 'sackrace' | 'giftswap';

export const FESTIVALS: Record<FestivalId, FestivalDef> = {
  blossom: {
    id: 'blossom',
    name: 'Blossom Parade',
    season: 'spring',
    day: 13,
    open: 9,
    close: 15,
    map: 'fest-spring',
    arrive: { x: 31.5, z: 36.5 },
    blurb: 'The Blossom Parade rolls down Petal Lane at nine. Wear something with flowers on it!',
    event: { name: 'The Ribbon Dance', hour: 12, minigame: 'dance' },
    colors: [0xf7a8c0, 0xfde2a0, 0xb8e0f0, 0xd4b8f0, 0xc0e8b0],
    music: { tempo: 112, mode: 'lydian', timbre: 'pluck' },
    lines: {
      marigold: ["I've been gluing petals onto that swan since the last frost. Don't look too closely at its left wing.", 'If anyone asks you to dance, say yes. It keeps the ribbons from tangling.'],
      bram: ['Blossom buns! Honey and a little lemon. One per customer. Fine — two.', "The tulip float needs a new axle every year. I think it's the tulips' fault."],
      wren: ['The petals ride the wind all the way up to the old mill. I checked.', 'Hold still — you have a whole blossom in your hair. …There. Now it looks intentional.'],
      '*': ['Happy Blossom Day!', "Mind the floats, they don't have brakes, just Tobin.", 'The whole valley smells like honey and rain.', 'Did you see the swan? It blinked at me.'],
    },
  },
  tide: {
    id: 'tide',
    name: 'Tide Lantern Night',
    season: 'summer',
    day: 20,
    open: 19,
    close: 24,
    map: 'fest-summer',
    arrive: { x: 32, z: 33 },
    blurb: 'Tide Lantern Night: bring a wish to Driftglass Cove at dusk. The sea carries it the rest of the way.',
    event: { name: 'The Lantern Release', hour: 21, minigame: 'lanterns' },
    colors: [0xffb050, 0x5fd8e8, 0x3a4f9a, 0xf6c8d8],
    music: { tempo: 76, mode: 'mixolydian', timbre: 'bell' },
    lines: {
      marigold: ['Every lantern on the water is somebody\'s wish. Mine is shaped like a cat. Pip\'s idea.'],
      bram: ['Grilled corn and sea-salt caramels by the fire. Tradition says you burn the first one.'],
      wren: ['When the water glows like that, it means the tide is happy. That\'s science. Probably.', "I wished for a boat. Then I wished the boat wouldn't sink. You have to be specific."],
      '*': ['Look at the water — it\'s glowing!', 'Wishes float further on a warm night.', 'The fireworks are from the lighthouse keeper. She saves all year.', 'Shh, the tide is listening.'],
    },
  },
  harvest: {
    id: 'harvest',
    name: 'Harvest Fair',
    season: 'fall',
    day: 16,
    open: 9,
    close: 17,
    map: 'fest-fall',
    arrive: { x: 31.5, z: 38 },
    blurb: 'The Harvest Fair opens at nine on the Commons: giant pumpkins, cider, and the sack race at three.',
    event: { name: 'The Sack Race', hour: 15, minigame: 'sackrace' },
    colors: [0xd8573e, 0xf2b928, 0x8a4a2a, 0xe8864a, 0x6a8a3a],
    music: { tempo: 124, mode: 'dorian', timbre: 'fiddle' },
    lines: {
      marigold: ['I judge the jams. It is the most dangerous job in Hearthvale.', 'Put your best crop on the table, dear. The judges can smell fear, but also cinnamon.'],
      bram: ["My pumpkin's called Duchess. She's winning. Don't tell the other pumpkins.", 'Cider press is running all day. Mind the wasps, they\'re regulars.'],
      wren: ["I got lost in the corn maze on purpose. Twice. The scarecrow in the middle knows things.", 'Sack race tip: small hops. Big hops are for people who like the ground.'],
      '*': ['Happy Harvest!', 'Have you tried the apple bobbing? My nose is still cold.', 'That pumpkin is bigger than my cottage.', 'The fiddler only knows three songs, but they\'re very good songs.'],
    },
  },
  starfall: {
    id: 'starfall',
    name: 'Starfall',
    season: 'winter',
    day: 25,
    open: 17,
    close: 24,
    map: 'fest-winter',
    arrive: { x: 32, z: 40 },
    blurb: 'Starfall tonight in the square: the Great Fir is lit at dusk, the river is frozen for skating, and someone has a gift with your name on it.',
    event: { name: 'The Gift Exchange', hour: 20, minigame: 'giftswap' },
    colors: [0xd8312a, 0xf2d27a, 0x2f6a4a, 0xf6f0e6, 0x5ab8e0],
    music: { tempo: 92, mode: 'major', timbre: 'bell' },
    lines: {
      marigold: ['I knitted Pip a scarf. He wore it for four seconds, which is a personal best.', 'The star on the Great Fir was your gran\'s. We light it every year.'],
      bram: ['Cocoa, with the little marshmallows. The big marshmallows are for the skaters who fall.', 'Gingerbread villagers! That one is you. I gave you extra buttons.'],
      wren: ["Watch the sky over the hills. When the lights come, make a wish — but a quiet one.", 'I can skate backwards. I cannot stop backwards.'],
      '*': ['Happy Starfall!', 'The river froze solid this year — the whole town is on it.', 'Look up! The lights are dancing.', 'Warm hands, warm hearts. And warm cocoa.'],
    },
  },
};

export const FESTIVAL_IDS = Object.keys(FESTIVALS) as FestivalId[];

/** Festival happening on a date, if any. */
export function festivalOn(season: Season, day: number): FestivalDef | null {
  for (const f of Object.values(FESTIVALS)) if (f.season === season && f.day === day) return f;
  return null;
}

/** Festival by its map id. */
export function festivalForMap(map: string): FestivalDef | null {
  for (const f of Object.values(FESTIVALS)) if (f.map === map) return f;
  return null;
}

/** Palettes for townsfolk festival outfits. */
export const OUTFIT_PALETTES: Record<Season, { tops: number[]; accents: number[] }> = {
  spring: { tops: [0xf7b8cc, 0xfde2a0, 0xb8dcf0, 0xd8c0f0, 0xc8e8b8, 0xf8f0e4, 0xf4a8a0], accents: [0xf06a8a, 0xffd166, 0x7ec8ff, 0xc77dff, 0x8fce6a] },
  summer: { tops: [0x2e4a8a, 0x3a6aa8, 0x5a3a7a, 0x2a6a6a, 0x8a3a4a, 0xf2e6d0], accents: [0xf2b928, 0xf06a5a, 0xf6c8d8, 0x5fd8e8, 0xffffff] },
  fall: { tops: [0xa8482a, 0xc8783a, 0x8a5a2a, 0x6a7a3a, 0xb89a5a, 0x7a3a2a], accents: [0xf2b928, 0xd8392f, 0x3a5a2a, 0x8a2a1e, 0xe8864a] },
  winter: { tops: [0xc8302a, 0x2f6a4a, 0x3a5a9a, 0xf2ece0, 0x8a3a5a, 0xd8a040], accents: [0xf6f0e6, 0xd8312a, 0x2f6a4a, 0xf2b928, 0x5ab8e0] },
};
