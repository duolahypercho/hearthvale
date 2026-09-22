/**
 * Villagers (pure data): look, home, daily schedule and dialogue.
 * Original characters of Hearthvale — keep them warm, specific and a little odd.
 *
 * Schedules are [hour, x, z, facing] waypoints on the town map; a villager walks to the latest
 * waypoint whose hour has passed. Dialogue picks the first matching line group (see pickLine).
 */
import type { Season, Weather } from '../core/time';
import type { Facing } from '../core/events';

export type NpcId = 'marigold' | 'bram' | 'wren';

export interface NpcLook {
  skin: number;
  hair: number;
  hairStyle: 'bun' | 'short' | 'bob' | 'cap';
  top: number;
  bottom: number;
  apron?: number;
  scarf?: number;
  glasses?: boolean;
  beard?: boolean;
  /** Overall body scale (1 = player sized). */
  scale: number;
  /** Width multiplier for the torso. */
  build: number;
}

export interface NpcDef {
  id: NpcId;
  name: string;
  role: string;
  birthday: { season: Season; day: number };
  look: NpcLook;
  /** Portrait background gradient. */
  portraitBg: [number, number];
  schedule: [number, number, number, Facing][];
  /** Ordered line groups; the first whose conditions match is used. */
  dialogue: DialogueGroup[];
}

export interface DialogueGroup {
  /** Only on the very first conversation. */
  first?: boolean;
  seasons?: Season[];
  weather?: Weather[];
  /** Inclusive hour range. */
  hours?: [number, number];
  lines: string[];
}

export const NPCS: Record<NpcId, NpcDef> = {
  marigold: {
    id: 'marigold',
    name: 'Marigold Thimble',
    role: 'Keeps the general store',
    birthday: { season: 'spring', day: 11 },
    look: { skin: 0xf0c4a0, hair: 0x8a6a58, hairStyle: 'bun', top: 0x8f6fb0, bottom: 0x5a4a6a, apron: 0xf2e6d0, glasses: true, scale: 0.98, build: 1.1 },
    portraitBg: [0xf6d9a8, 0xe8a888],
    schedule: [
      [6, 21.5, 20.5, 'down'],
      [9, 21.5, 20.5, 'down'],
      [12, 27.5, 27.0, 'right'],
      [13.5, 21.5, 20.5, 'down'],
      [17.5, 29.0, 24.0, 'right'],
      [21, 21.5, 20.5, 'down'],
    ],
    dialogue: [
      {
        first: true,
        lines: [
          "Well now! You must be Rosalind's grandchild — you've got her stubborn chin.",
          "Seeds, tools, a good gossip: Thimble & Pip's has all three. Pip's the cat. He does the accounts.",
        ],
      },
      { weather: ['rain', 'storm'], lines: ['Rain on the roof and ledgers on the counter. Some days are simply made for tea.'] },
      { hours: [6, 9], lines: ['Early bird! The parsnip seeds just came in on the morning cart.', "Mind the third step, dear. It's been creaking since the Lantern Hall went dark."] },
      { seasons: ['spring'], lines: ["Spring's for planting and for plans. Your gran used to say that, you know.", 'Cauliflower takes its time, but oh, it pays.'] },
      { seasons: ['fall'], lines: ['The whole square smells of pumpkin bread this time of year. Blame Bram.'] },
      {
        lines: [
          "They say if the Lantern Hall is lit again, the valley remembers how to be kind. Silly, maybe. I'd like to see it anyway.",
          'Glimmerco sent another man in a shiny coat. Wanted to buy the square. I sold him a turnip.',
        ],
      },
    ],
  },
  bram: {
    id: 'bram',
    name: 'Bram Oakhollow',
    role: 'Baker at The Hearth Oven',
    birthday: { season: 'fall', day: 3 },
    look: { skin: 0xd9a07a, hair: 0x5a3a24, hairStyle: 'cap', top: 0xf2ece0, bottom: 0x6a5a48, apron: 0xe8dcc4, beard: true, scale: 1.08, build: 1.35 },
    portraitBg: [0xf4d49a, 0xe89a5a],
    schedule: [
      [6, 42.5, 20.2, 'down'],
      [11, 40.0, 28.0, 'left'],
      [13, 42.5, 20.2, 'down'],
      [18, 33.0, 29.0, 'left'],
      [21, 42.5, 20.2, 'down'],
    ],
    dialogue: [
      {
        first: true,
        lines: ["Ho there, farmer! Bram. I bake. Mostly I burn things beautifully.", 'First loaf is on the house. Second too, if you tell me it was the best you ever had.'],
      },
      { hours: [6, 10], lines: ["Dough's been up since four. So have I. Only one of us looks fluffier for it."] },
      { weather: ['rain', 'storm'], lines: ['Rainy days sell twice the buns. Cosy weather is good for business and bad for waistlines.'] },
      { seasons: ['winter'], lines: ['Snow on the hall roof again. Somebody ought to light that lantern before the festival.'] },
      {
        lines: [
          "If you grow the wheat, I'll bake the bread. That's the oldest deal in the valley.",
          "The Lantern Hall had the best acoustics for singing. Not that I sing. Loudly. In public.",
        ],
      },
    ],
  },
  wren: {
    id: 'wren',
    name: 'Wren Fairweather',
    role: 'Painter, wanderer, bad at sitting still',
    birthday: { season: 'summer', day: 22 },
    look: { skin: 0xf6d2b8, hair: 0x3f8f8a, hairStyle: 'bob', top: 0xe8c45a, bottom: 0x3a4a6a, scarf: 0xe8674a, scale: 0.94, build: 0.95 },
    portraitBg: [0xbfe0e8, 0x8fb8d8],
    schedule: [
      [6, 26.5, 31.0, 'up'],
      [10, 37.5, 31.8, 'up'],
      [14, 26.0, 25.5, 'right'],
      [17, 33.5, 29.6, 'up'],
      [20, 36.2, 24.2, 'up'],
    ],
    dialogue: [
      {
        first: true,
        lines: ["Oh! Don't move — the light on your hat is perfect. ...Okay, you can move. Hi. I'm Wren.", "I'm painting the whole valley before autumn. The Lantern Hall keeps coming out grey, though."],
      },
      { hours: [17, 21], lines: ['Golden hour! Everything looks like it was dipped in honey. Even you.'] },
      { weather: ['rain', 'storm'], lines: ["Rain makes the cobbles look like a mirror. I tried to paint it. The paint ran away."] },
      {
        lines: [
          'Your farm used to be on every postcard. Maybe it can be again?',
          "When the hall's lantern was lit you could see it from the beach. I want to paint that. Someday.",
        ],
      },
    ],
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

/**
 * Festival-goers: background townsfolk who only come out for festivals (no schedule / dialogue
 * yet). [look, ring angle in degrees around the maypole (0 = east, -90 = north)].
 */
export const FESTIVAL_EXTRAS: [NpcLook, number][] = [
  // Tobin, the miller's boy: small, cap, green jumper.
  [{ skin: 0xf2c8a2, hair: 0x6a4228, hairStyle: 'cap', top: 0x5f9a4a, bottom: 0x4a5a78, scarf: 0xe8b64a, scale: 0.78, build: 0.95 }, -96],
  // Old Hazel from the east cottage: silver bob, plum shawl.
  [{ skin: 0xe8b894, hair: 0xd8d4cc, hairStyle: 'bob', top: 0xa8587a, bottom: 0x4a3a4a, scarf: 0xf2e2c0, scale: 0.94, build: 1.05 }, -22],
];

/** Choose the line group for a villager right now (pure). */
export function pickLine(def: NpcDef, ctx: { first: boolean; season: Season; weather: Weather; hour: number; talkCount: number }): string {
  for (const g of def.dialogue) {
    if (g.first && !ctx.first) continue;
    if (!g.first && ctx.first && def.dialogue.some((d) => d.first)) continue;
    if (g.seasons && !g.seasons.includes(ctx.season)) continue;
    if (g.weather && !g.weather.includes(ctx.weather)) continue;
    if (g.hours && (ctx.hour < g.hours[0] || ctx.hour > g.hours[1])) continue;
    return g.lines[ctx.talkCount % g.lines.length]!;
  }
  return '...';
}

/** All lines of the matching group (the dialogue box pages through them). */
export function pickLines(def: NpcDef, ctx: { first: boolean; season: Season; weather: Weather; hour: number }): string[] {
  for (const g of def.dialogue) {
    if (g.first && !ctx.first) continue;
    if (!g.first && ctx.first && def.dialogue.some((d) => d.first)) continue;
    if (g.seasons && !g.seasons.includes(ctx.season)) continue;
    if (g.weather && !g.weather.includes(ctx.weather)) continue;
    if (g.hours && (ctx.hour < g.hours[0] || ctx.hour > g.hours[1])) continue;
    return g.lines;
  }
  return ['...'];
}
