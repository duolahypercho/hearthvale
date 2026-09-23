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
    arrive: { x: 31.5, z: 38.2 },
    blurb: 'The Blossom Parade rolls down Petal Lane at nine. Wear something with flowers on it!',
    event: { name: 'The Ribbon Dance', hour: 12, minigame: 'dance' },
    colors: [0xf7a8c0, 0xfde2a0, 0xb8e0f0, 0xd4b8f0, 0xc0e8b0],
    music: { tempo: 112, mode: 'lydian', timbre: 'pluck' },
    lines: {
      marigold: ["I've been gluing petals onto that swan since the last frost. Don't look too closely at its left wing.", 'If anyone asks you to dance, say yes. It keeps the ribbons from tangling.'],
      bram: ['Blossom buns! Honey and a little lemon. One per customer. Fine — two.', "The tulip float needs a new axle every year. I think it's the tulips' fault."],
      wren: ['The petals ride the wind all the way up to the old mill. I checked.', 'Hold still — you have a whole blossom in your hair. …There. Now it looks intentional.'],
      odessa: ['I forged the float axles myself. If one squeaks, it is singing, not failing.', 'Dancing is just hammering with your feet. I am told this is not true.'],
      linus: ['Doctor\'s orders: one blossom bun, one dance, and absolutely no climbing the pole. Kit.', 'Pollen season. I have brought forty handkerchiefs. It will not be enough.'],
      june: ['The Kettle is closed today — everyone is here anyway. Best business decision I ever made.', 'Save me a spot by the bandstand. The fiddler owes me a jig.'],
      tobias: ['Your gran led the Ribbon Dance for thirty years. She never once went the right way round.', 'I still light the lamps on Petal Lane, parade or no parade. Habit.'],
      kit: ['I\'m on the tulip float next year. I\'ve decided. Nobody else has decided but I have.', 'If you spin fast enough around the pole you can see yesterday. Probably.'],
      rowan: ['Built the swan\'s neck out of a barrel hoop and optimism. Don\'t lean on it.', 'Kit asked me to dance. Kit stood on my feet for the whole song. Ten out of ten.'],
      hazel: ['Every blossom on this lane came from a cutting off the square\'s old cherry. Every single one.', 'Petals in your tea is good luck. Petals in your shoes is a lesson.'],
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
    arrive: { x: 31.5, z: 27 },
    blurb: 'Tide Lantern Night: bring a wish to Driftglass Cove at dusk. The sea carries it the rest of the way.',
    event: { name: 'The Lantern Release', hour: 21, minigame: 'lanterns' },
    colors: [0xffb050, 0x5fd8e8, 0x3a4f9a, 0xf6c8d8],
    music: { tempo: 76, mode: 'mixolydian', timbre: 'bell' },
    lines: {
      marigold: ['Every lantern on the water is somebody\'s wish. Mine is shaped like a cat. Pip\'s idea.'],
      bram: ['Grilled corn and sea-salt caramels by the fire. Tradition says you burn the first one.'],
      wren: ['When the water glows like that, it means the tide is happy. That\'s science. Probably.', "I wished for a boat. Then I wished the boat wouldn't sink. You have to be specific."],
      odessa: ['I hammered the lantern frames. Copper wire, paper from June\'s ledgers. Don\'t tell her.'],
      linus: ['Bioluminescence: tiny creatures, very pleased with themselves. Not unlike Kit.'],
      june: ['Iced mint tea, on the house. Tonight the house is the whole beach.'],
      tobias: ['A lantern on the water is just a lamp that decided to travel. I envy it.'],
      kit: ['I wished for a pet crab. Then I found one. The tide is VERY good at wishes.'],
      rowan: ['The pier creaks in three-four time. I tuned it that way. On purpose. Mostly.'],
      hazel: ['Put a sprig of sea-lavender in your lantern. It keeps the wish from getting seasick.'],
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
    arrive: { x: 31.5, z: 34 },
    blurb: 'The Harvest Fair opens at nine on the Commons: giant pumpkins, cider, and the sack race at three.',
    event: { name: 'The Sack Race', hour: 15, minigame: 'sackrace' },
    colors: [0xd8573e, 0xf2b928, 0x8a4a2a, 0xe8864a, 0x6a8a3a],
    music: { tempo: 124, mode: 'dorian', timbre: 'fiddle' },
    lines: {
      marigold: ['I judge the jams. It is the most dangerous job in Hearthvale.', 'Put your best crop on the table, dear. The judges can smell fear, but also cinnamon.'],
      bram: ["My pumpkin's called Duchess. She's winning. Don't tell the other pumpkins.", 'Cider press is running all day. Mind the wasps, they\'re regulars.'],
      wren: ["I got lost in the corn maze on purpose. Twice. The scarecrow in the middle knows things.", 'Sack race tip: small hops. Big hops are for people who like the ground.'],
      odessa: ['The prize ribbons have iron pins. I made them. You will not lose your ribbon.', 'Put me down for the sack race. I will win it or dig a crater trying.'],
      linus: ['The maze is perfectly safe. I have counted everyone going in. Some day I will count them coming out.'],
      june: ['Hot cider, spiced, with a stick of cinnamon you are not supposed to eat.', 'The pie tent smells like my grandmother\'s kitchen. Dangerous place for a cook.'],
      tobias: ['Your gran won the pumpkin prize four years running. Grew them on pure stubbornness.'],
      kit: ['I\'m going to win the sack race. I\'ve been practising in a pillowcase.', 'The scarecrow in the maze winked at me. That\'s not a figure of speech.'],
      rowan: ['Built the judging plinths. Level to a hair. The pumpkins, sadly, are not.'],
      hazel: ['A good pumpkin is grown with patience and a little gossip. They like to listen.'],
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
    arrive: { x: 32, z: 29.8 },
    blurb: 'Starfall tonight in the square: the Great Fir is lit at dusk, the river is frozen for skating, and someone has a gift with your name on it.',
    event: { name: 'The Gift Exchange', hour: 20, minigame: 'giftswap' },
    colors: [0xd8312a, 0xf2d27a, 0x2f6a4a, 0xf6f0e6, 0x5ab8e0],
    music: { tempo: 92, mode: 'major', timbre: 'bell' },
    lines: {
      marigold: ['I knitted Pip a scarf. He wore it for four seconds, which is a personal best.', 'The star on the Great Fir was your gran\'s. We light it every year.'],
      bram: ['Cocoa, with the little marshmallows. The big marshmallows are for the skaters who fall.', 'Gingerbread villagers! That one is you. I gave you extra buttons.'],
      wren: ["Watch the sky over the hills. When the lights come, make a wish — but a quiet one.", 'I can skate backwards. I cannot stop backwards.'],
      odessa: ['Ice skates, sharpened this morning. Stop admiring them and go fall over.'],
      linus: ['Cocoa counts as medicine tonight. I have written myself a prescription.'],
      june: ['Gingerbread in the shape of the Lantern Hall. The roof caved in, which felt appropriate.'],
      tobias: ['Your gran hung that star every year. I just carry the ladder now.'],
      kit: ['I made Rowan a gift! It\'s a rock. It\'s a GOOD rock.', 'I can skate in a figure eight! Well. A figure zero. It\'s a start.'],
      rowan: ['Kit\'s gift is a rock. I love it. Don\'t tell Kit I said so.'],
      hazel: ['The winter roses are asleep under the snow. They dream of this tree, I think.'],
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

// ───────────────────────────────────────────── activities (mini-games)

export type ActivityId = 'dance' | 'lanterns' | 'sackrace' | 'pumpkin' | 'giftswap' | 'skate';

export interface ActivityDef {
  id: ActivityId;
  festival: FestivalId;
  name: string;
  /** Villager who hosts it (talk to them to start). */
  host: string;
  /** Host's invitation (dialogue prompt) and the yes / no answers. */
  ask: string;
  yes: string;
  no: string;
  /** How-to line shown on the mini-game card. */
  howto: string;
}

export const ACTIVITIES: Record<ActivityId, ActivityDef> = {
  dance: {
    id: 'dance',
    festival: 'blossom',
    name: 'The Ribbon Dance',
    host: 'hazel',
    ask: "[happy] The ribbons want one more pair, dear. Pick a partner and follow the fiddle — left foot, right foot, don't look at the pole!",
    yes: "I'd love to dance!",
    no: 'Maybe after a bun.',
    howto: 'Tap the arrow as each blossom reaches the ring. Stay on the beat to keep the ribbons weaving.',
  },
  lanterns: {
    id: 'lanterns',
    festival: 'tide',
    name: 'The Lantern Release',
    host: 'marigold',
    ask: "[happy] Your lantern's ready, dear — three wishes' worth. Let each one go when the tide swells under it, and the sea will carry it all the way out.",
    yes: 'Light my lanterns.',
    no: 'Not yet.',
    howto: 'Hold the lantern steady and release it when the swell rises into the glowing band.',
  },
  sackrace: {
    id: 'sackrace',
    festival: 'harvest',
    name: 'The Sack Race',
    host: 'wren',
    ask: "[laugh] One sack left and it has your name on it. Well — it has 'POTATOES' on it. Same thing. Race you to the finish?",
    yes: 'Hop to it!',
    no: 'My legs need a minute.',
    howto: 'Alternate ← and → (or A and D) in rhythm. Mash too fast and you wobble; find the bounce.',
  },
  pumpkin: {
    id: 'pumpkin',
    festival: 'harvest',
    name: 'Grand Produce Judging',
    host: 'marigold',
    ask: '[thinking] The judges are sharpening their pencils. Care to put your finest crop on the table?',
    yes: 'Enter my best crop.',
    no: 'Not this year.',
    howto: 'The judges score value, quality and presentation. Bring something worth at least 40g — Duchess sets the bar at 86.',
  },
  giftswap: {
    id: 'giftswap',
    festival: 'starfall',
    name: 'The Gift Exchange',
    host: 'marigold',
    ask: "[happy] Draw a name from the mitten, dear! Whoever you pull, you give — and someone has already drawn yours.",
    yes: 'Draw a name!',
    no: 'In a moment.',
    howto: 'Pick a present for your secret friend. Something they love makes the whole circle cheer — something they dislike, less so.',
  },
  skate: {
    id: 'skate',
    festival: 'starfall',
    name: 'Starlight Skate',
    host: 'odessa',
    ask: "[neutral] Skates are sharp, ice is thick — mostly. Four laps through my lantern gates. Mind the cracks. Fall over gracefully.",
    yes: 'Lace me up.',
    no: 'I like my ankles.',
    howto: 'Four laps of the lantern reach. ↑ ↓ steer across the ice, hold Space to push off. Thread the gates, grab the stars, dodge the cracks — keep the combo alive.',
  },
};

/** Activities for a festival (in the order the hosts offer them). */
export function activitiesFor(id: FestivalId): ActivityDef[] {
  return Object.values(ACTIVITIES).filter((a) => a.festival === id);
}

/** Tide Lantern wishes (the lantern-release card). */
export const WISHES = ['A kind harvest', 'Good weather for the valley', 'The Lantern Hall shining again', 'Friends who stay', 'Something wonderful, unspecified'];

/** Rival entries at the produce judging: name, entrant, weight (lb), look. */
export const PRODUCE_RIVALS: { name: string; by: string; score: number; tint: string }[] = [
  { name: 'Duchess (giant pumpkin)', by: 'Bram', score: 86, tint: '#f07a1e' },
  { name: 'The Pale Moon (white pumpkin)', by: 'Hazel', score: 78, tint: '#eadcb8' },
  { name: 'Lumpy Lou (green squash)', by: 'Kit', score: 54, tint: '#8a9a4a' },
];

/** Presents villagers might wrap for the player at Starfall (festival keepsakes weighted in). */
export const STARFALL_GIFTS = ['starfallOpal', 'starfallOpal', 'gingerbreadVillager', 'winterRoseTea', 'ruby', 'aquamarine', 'emberOpal', 'truffle'];

/** Honorific-free first name for UI lines ("Dr. Linus Pell" → "Linus"). */
export function shortName(name: string): string {
  const parts = name.split(/\s+/).filter((w) => !/^(dr|mr|mrs|ms|mx|miss|old|aunt|uncle|sir)\.?$/i.test(w));
  return parts[0] ?? name;
}

/**
 * Mini-game prizes: gold by result tier (0 = 1st .. 2 = 3rd). Below the ribbon threshold there is
 * no rosette — just `CONSOLATION` gold and a laugh.
 */
export const PRIZES: Record<ActivityId, number[]> = {
  dance: [400, 250, 120],
  lanterns: [350, 200, 100],
  sackrace: [500, 300, 150],
  pumpkin: [800, 400, 200],
  giftswap: [0],
  skate: [450, 250, 120],
};
export const CONSOLATION: Record<ActivityId, number> = { dance: 15, lanterns: 10, sackrace: 20, pumpkin: 20, giftswap: 0, skate: 15 };

/** Produce judging: entries must be worth at least this much to be judged seriously. */
export const MIN_ENTRY_VALUE = 40;
