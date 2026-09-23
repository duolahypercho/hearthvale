/**
 * The story of Hearthvale (pure data): cast, letters, the main questline and the Glimmerco thread.
 *
 * "The Lanterns of Hearthvale" — Gran Rosalind's farm, a valley that has forgotten how to gather,
 * six dark rooms in the old Lantern Hall, and a very shiny man from Glimmerco who would like to
 * make all of that somebody else's problem. Gran left letters sealed "for occasions": the mayor
 * delivers them as the lanterns come back.
 */
import type { NpcLook } from './npcs';

export type CastId = 'hollis' | 'sterling' | 'gran';

export interface CastDef {
  id: CastId;
  name: string;
  short: string;
  role: string;
  look: NpcLook;
  portraitBg: [number, number];
}

/** Story-only characters (villagers live in data/npcs.ts). */
export const CAST: Record<CastId, CastDef> = {
  hollis: {
    id: 'hollis',
    name: 'Hollis Pennyroyal',
    short: 'Mayor Hollis',
    role: 'Mayor · treasurer · winds the clock',
    look: { skin: 0xe9b995, hair: 0xd9d2c6, hairStyle: 'short', top: 0x3f6a52, bottom: 0x4a3a30, scarf: 0xc8a050, glasses: true, beard: true, scale: 1.02, build: 1.28 },
    portraitBg: [0xcfe0c2, 0x8fb49a],
  },
  sterling: {
    id: 'sterling',
    name: 'Sterling Vance',
    short: 'Sterling',
    role: 'Regional Brightness Director, Glimmerco',
    look: { skin: 0xf2d0b6, hair: 0x2a2630, hairStyle: 'short', top: 0xb8c6d8, bottom: 0x2c3444, scarf: 0x6fd2e8, scale: 1.06, build: 0.96 },
    portraitBg: [0xe4ecf6, 0x9fb4d0],
  },
  gran: {
    id: 'gran',
    name: 'Rosalind Hale',
    short: 'Gran',
    role: 'Your grandmother',
    look: { skin: 0xf0c8a8, hair: 0xeae6e0, hairStyle: 'bun', top: 0x7a9ac8, bottom: 0x4a4a6a, scarf: 0xe8a0b4, glasses: true, scale: 0.92, build: 1.0 },
    portraitBg: [0xf6e0c8, 0xe8b8a0],
  },
};

// ─────────────────────────────────────────────── letters

export type Stationery = 'gran' | 'town' | 'villager' | 'glimmer';

export interface LetterDef {
  id: string;
  from: string;
  /** Envelope line shown in the mailbox list. */
  subject: string;
  stationery: Stationery;
  /** Handwritten greeting line. */
  greeting?: string;
  body: string[];
  sign: string;
  /** Small handwritten post-script. */
  ps?: string;
  /** "Open when…" seal inscription (Gran's sealed letters). */
  seal?: string;
  attach?: { itemId?: string; qty?: number; gold?: number };
}

export const LETTERS: Record<string, LetterDef> = {
  'gran-intro': {
    id: 'gran-intro',
    from: 'Gran Rosalind',
    subject: 'To be opened by my favourite grandchild',
    stationery: 'gran',
    greeting: 'My dearest,',
    body: [
      "If this has found you, then I've gone on ahead, and the farm at Hearthvale is yours. Don't be sad for long. I had eighty-one springs and I loved nearly all of them.",
      "I know the city has been loud. I know you've stopped humming — you used to hum while you shelled peas on my porch, remember?",
      "The farm has gone wild without me, and the valley has gone dim. The old Lantern Hall hasn't been lit in seven winters, and folk have forgotten how to gather. I tried, love. My knees didn't.",
      'The soil is good. The people are better. Take your time, and light what you can.',
    ],
    sign: 'All my love, always —\nGran Rosalind',
    ps: 'The key is under the blue pot. It has always been under the blue pot.',
  },
  'hollis-welcome': {
    id: 'hollis-welcome',
    from: 'Mayor Hollis Pennyroyal',
    subject: 'Official Welcome (with apologies)',
    stationery: 'town',
    greeting: 'Dear Neighbour,',
    body: [
      'On behalf of the Hearthvale Council (myself), the Hearthvale Treasury (also myself) and the Hearthvale Clock Committee (regrettably, myself), welcome home.',
      "The Lantern Hall sits at the top of the square. It's dark, dusty and I suspect a family of owls pays no rent. Your grandmother kept its key; it is yours now. The six rooms want only what the valley grows.",
      'Bring what you can, when you can. Nobody is counting. (I am counting. Lovingly.)',
    ],
    sign: 'Warmly,\nHollis Pennyroyal, Mayor',
  },
  'marigold-seeds': {
    id: 'marigold-seeds',
    from: 'Marigold Thimble',
    subject: 'A little something for the soil',
    stationery: 'villager',
    greeting: 'Hello, dear!',
    body: [
      "Rosalind bought her parsnip seeds from me every spring for thirty-one years, and every spring she haggled me down by exactly two coins. I miss it terribly.",
      "Here are a few seeds on the house. Plant them in rows, water them daily, and come tell me they grew. That's the only payment I take on a Tuesday.",
    ],
    sign: 'Marigold (and Pip, who licked the envelope)',
    attach: { itemId: 'parsnipSeeds', qty: 10 },
  },
  'gran-first-lantern': {
    id: 'gran-first-lantern',
    from: 'Gran Rosalind',
    subject: 'Sealed · "Open when the first lantern is lit"',
    stationery: 'gran',
    seal: 'Open when the first lantern is lit',
    greeting: 'Well, look at you.',
    body: [
      "Hollis promised to hold this until a lantern came back. If you're reading it, one did, and I'd bet my good teapot you did it with muddy knees.",
      "When I was a girl the whole square would come out the night the lanterns were lit. Bram's grandfather played the fiddle badly and nobody cared. That's the thing about light, love — it isn't for seeing. It's for finding each other.",
    ],
    sign: 'Proud as a pumpkin,\nGran',
  },
  'glimmer-offer': {
    id: 'glimmer-offer',
    from: 'Glimmerco Regional Office',
    subject: 'An EXCITING opportunity for Hearthvale!',
    stationery: 'glimmer',
    greeting: 'Dear Valued Rural Stakeholder,',
    body: [
      "Congratulations on your recent inheritance! At Glimmerco, we believe no community should have to wait for light. That's why our EverGlow™ bulbs never flicker, never fade and never need anyone at all.",
      "We understand you have been \"restoring\" the Lantern Hall by hand. Charming! Our Regional Brightness Director, Mr. Sterling Vance, will visit shortly with a proposal that could save you a great many seasons.",
      'Brighter. Faster. Forever.™',
    ],
    sign: 'The Glimmerco Family',
    ps: 'This letter is printed on 100% recycled optimism.',
  },
  'gran-tired': {
    id: 'gran-tired',
    from: 'Gran Rosalind',
    subject: 'Sealed · "Open when you are tired"',
    stationery: 'gran',
    seal: 'Open when you are tired',
    greeting: 'Sit down a minute.',
    body: [
      "Hollis will have given you this about halfway, because I told him that's when it would be needed. Halfway is the heaviest part of anything. The start has sparkle and the end has a view. The middle just has weeds.",
      "Nobody lights a whole valley in a day. You're allowed to rest. The seeds keep growing while you sleep — that's the secret nobody tells you about farming.",
    ],
    sign: 'Put the kettle on,\nGran',
    attach: { gold: 250 },
  },
  'bram-bread': {
    id: 'bram-bread',
    from: 'Bram Oakhollow',
    subject: 'THE OVEN IS WARM',
    stationery: 'villager',
    greeting: 'Farmer!',
    body: [
      "The Harvest Room is lit and I have not stopped baking since. The whole square smells like a hug. Folk are lingering. LINGERING. Old Hazel said good morning to me and she has not said good morning to me since the Great Scone Incident.",
      'Enclosed: gold, because I could not fit a loaf in the envelope. I tried. Twice.',
    ],
    sign: 'Your floury friend, Bram',
    attach: { gold: 300 },
  },
  'wren-sketch': {
    id: 'wren-sketch',
    from: 'Wren Fairweather',
    subject: 'I painted the Hall!',
    stationery: 'villager',
    greeting: 'Hi hi hi!',
    body: [
      "Guess what came out of my paintbrush yesterday: the Lantern Hall, with light in the windows. NOT GREY. I cried a little on the canvas and now there's a small cloud in the corner. I'm keeping it.",
      "You should come see the valley from the hill at dusk sometime. It's starting to twinkle again.",
    ],
    sign: '— W. (painter, bad at sitting still)',
  },
  'gran-winter': {
    id: 'gran-winter',
    from: 'Gran Rosalind',
    subject: 'Sealed · "Open on the first snow"',
    stationery: 'gran',
    seal: 'Open on the first snow',
    greeting: 'Snow! Put your thick socks on.',
    body: [
      'Winter in Hearthvale is quiet, but it is not empty. The ground is resting, the same way you should. Mend a fence. Visit someone. Bring them something warm.',
      'At the end of winter the valley used to hold the Lantern Festival. We walked lanterns up to the Hall and set the big one burning, and for one night the whole valley glowed like a hearth. I would so love for it to happen again. No pressure. (Some pressure.)',
    ],
    sign: 'Warm toes, warm heart,\nGran',
  },
  'sterling-resign': {
    id: 'sterling-resign',
    from: 'Sterling Vance',
    subject: 'No logo on this one',
    stationery: 'villager',
    greeting: 'Hello.',
    body: [
      "I resigned this morning. It turns out 'Regional Brightness Director' is a very long title for a man who couldn't see what was in front of him.",
      "My mother took me to the Lantern Hall every winter when I was small. I'd forgotten that. Or I'd decided to. When you turned me down, I went and stood under the Seed Room window like an idiot for an hour.",
      "If the valley will have me, I'd like to come to the festival. I'll carry chairs. I am, I'm told, very good at carrying things that aren't mine.",
    ],
    sign: '— S.',
  },
  'marigold-sad': {
    id: 'marigold-sad',
    from: 'Marigold Thimble',
    subject: 'About the Hall',
    stationery: 'villager',
    greeting: 'Dear,',
    body: [
      "I walked past the Hall this evening. It's very bright now. Terribly bright. You can read a ledger from across the square.",
      "I'm not cross. I know winters are long and the city taught us all to hurry. I only wish the light felt like it belonged to someone. Come by the shop anyway. Pip misses you.",
    ],
    sign: 'Marigold',
  },
  'gran-final': {
    id: 'gran-final',
    from: 'Gran Rosalind',
    subject: 'Sealed · "Open when the Hall is bright"',
    stationery: 'gran',
    seal: 'Open when the Hall is bright',
    greeting: 'My darling,',
    body: [
      "Hollis says I'm being dramatic, sealing letters for occasions. Hollis wears a pocket watch with no watch in it. We all have our ways.",
      "If you're reading this, the Hall is lit, the valley is gathering, and you've found your way home — not to a place, but to a people. That's all I ever wanted for you.",
      "Keep the lanterns trimmed. Hum while you work. And every so often, on a clear night, look up at the Hall and say hello. I'll be the one that flickers.",
    ],
    sign: 'Forever and ever,\nGran',
  },
};

// ─────────────────────────────────────────────── main questline

export interface StoryQuestDef {
  id: string;
  title: string;
  /** Short journal description (1–2 sentences). */
  text: string;
  /** Short objective line. */
  goal: string;
  giver: string;
}

/** Main story beats in order; the story system decides which is active / done. */
export const STORY_QUESTS: StoryQuestDef[] = [
  { id: 'arrive', title: 'A Letter from Gran', text: "Gran left you the farm at Hearthvale — and a valley that has forgotten how to shine.", goal: 'Arrive in Hearthvale', giver: 'Gran Rosalind' },
  { id: 'visit-hall', title: 'The Dark Hall', text: "Mayor Hollis handed you the old key. The Lantern Hall waits at the top of the square.", goal: 'Enter the Lantern Hall', giver: 'Mayor Hollis' },
  { id: 'first-lantern', title: 'The First Lantern', text: 'Each of the Hall\'s six rooms wants a bundle of what the valley grows. Fill one room to relight its lantern.', goal: 'Relight any room', giver: 'Mayor Hollis' },
  { id: 'glimmer', title: 'A Glimmer of Trouble', text: "Glimmerco has noticed your work. Their director wants a word on the Hall steps.", goal: 'Hear Glimmerco out (3 rooms lit)', giver: 'Glimmerco' },
  { id: 'all-lanterns', title: 'Light What You Can', text: 'Relight every room in the Lantern Hall and the valley will remember how to gather.', goal: 'Relight all six rooms', giver: 'Gran Rosalind' },
  { id: 'festival', title: 'The Lantern Festival', text: 'On the last night of winter the valley walks its lanterns to the Hall.', goal: 'Attend the Festival (Winter 28, evening)', giver: 'Mayor Hollis' },
];
