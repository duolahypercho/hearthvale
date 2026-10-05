/**
 * Villagers of Hearthvale (pure data): look, walk style, home, daily schedule, gift tastes,
 * birthday, dialogue and two scripted heart events each. Original characters — keep them warm,
 * specific and a little odd.
 *
 * Schedules are [hour, spot, activity] steps; spots are named places on the town map
 * (world/town/layout.ts SPOTS, or 'door:<buildingId>'). A villager path-finds to the latest step
 * whose hour has passed and performs its activity there ('inside' = goes indoors).
 *
 * Dialogue lines may start with a mood tag — "[laugh] Ha!" — which swaps the portrait.
 * The first line group whose conditions match is used (see pickLines).
 */
import type { Season, Weather } from '../core/time';
import type { Facing } from '../core/events';

export type NpcId = 'marigold' | 'bram' | 'wren' | 'odessa' | 'linus' | 'june' | 'tobias' | 'kit' | 'rowan' | 'hazel';

/** 'wistful': a soft closed smile, lowered lids, a single tear — fond sorrow, not grief. */
export type Mood = 'neutral' | 'happy' | 'laugh' | 'sad' | 'angry' | 'surprised' | 'blush' | 'worried' | 'thinking' | 'wistful';
export const MOODS: Mood[] = ['neutral', 'happy', 'laugh', 'sad', 'angry', 'surprised', 'blush', 'worried', 'thinking', 'wistful'];

export type HairStyle = 'bun' | 'short' | 'bob' | 'cap' | 'curly' | 'ponytail' | 'long' | 'bald' | 'spiky' | 'braids' | 'slick';
export type HatKind = 'flatcap' | 'beanie' | 'sunhat' | 'bandana' | 'earmuffs';
export type Accessory = 'cane' | 'satchel' | 'earrings' | 'pencil' | 'toolbelt' | 'freckles' | 'stethoscope' | 'shawl' | 'flower' | 'wrinkles' | 'bandage' | 'rollingpin' | 'tongs' | 'docbag' | 'keys' | 'trowel' | 'lantern' | 'towel';
export type Emote = 'heart' | 'exclaim' | 'question' | 'music' | 'sweat' | 'anger' | 'idea' | 'sad' | 'zzz' | 'dots';

export type Activity = 'idle' | 'sweep' | 'read' | 'chat' | 'hammer' | 'paint' | 'water' | 'sit' | 'play' | 'fish' | 'inside' | 'wander' | 'knead' | 'saw' | 'lean';

export interface WalkStyle {
  /** m/s */
  speed: number;
  /** Leg swing amplitude (rad). */
  stride: number;
  /** Vertical bob per step (m). */
  bounce: number;
  /** Side-to-side hip sway (rad). */
  sway: number;
  /** Forward lean of the torso (rad, elders stoop). */
  hunch: number;
  /** Arm swing amplitude (rad). */
  arms: number;
  /** Children skip: a hop on every other step. */
  skip?: boolean;
}

export interface NpcLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  top: number;
  bottom: number;
  apron?: number;
  scarf?: number;
  glasses?: boolean;
  beard?: boolean | 'full' | 'stubble' | 'mustache';
  /** Overall body scale (1 = player sized). */
  scale: number;
  /** Width multiplier for the torso. */
  build: number;
  // ── richer silhouettes (all optional) ──
  hat?: HatKind;
  hatColor?: number;
  /** Iris colour (portraits). */
  eyes?: number;
  /** A long skirt instead of trousers. */
  skirt?: boolean;
  /** A long coat over the top (colour). */
  coat?: number;
  vest?: number;
  bowtie?: number;
  shoes?: number;
  /** Leg length multiplier (tall villagers ≈ 1.2). */
  legs?: number;
  /** Head size multiplier (kids have bigger heads). */
  head?: number;
  // ── body proportions (silhouette at 16 px: the lineup must read by shape alone) ──
  /** Torso length multiplier (1 = chibi default; lanky adults ≈ 1.25). */
  torso?: number;
  /** Shoulder width multiplier (1 = default; the smith ≈ 1.35, the doctor ≈ 0.85). */
  shoulders?: number;
  /** Belly (0 = flat, 1 = barrel): pushes the front of the torso + hips out. */
  belly?: number;
  /** Extra neck length (rig m, ≈ 0.1 for a long neck). */
  neck?: number;
  /** Hand size multiplier (bakers and smiths ≈ 1.3). */
  hands?: number;
  face?: 'round' | 'long' | 'square' | 'heart';
  acc?: Accessory[];
  /** Painted portrait backdrop (the villager's place, out of focus). */
  backdrop?: Backdrop;
  /** Sleeves down to the wrist even under an apron / tool belt (winter knits). */
  longSleeves?: boolean;
  /** Knitted mittens (colour) instead of bare hands. */
  mittens?: number;
  /**
   * Eye cut (face + portrait): 'round' big chibi ovals (default), 'wide' sparkly with a big iris,
   * 'almond' longer with lifted outer corners, 'narrow' kind half-moons, 'sleepy' heavy-lidded,
   * 'beady' small and round.
   */
  eyeShape?: 'round' | 'wide' | 'almond' | 'narrow' | 'sleepy' | 'beady';
  /** Upper lashes flicking out at the outer corners. */
  lashes?: boolean;
  /** Brow thickness (1 = default) and arch (0 = straight, + = arched). */
  brow?: number;
  browArch?: number;
  /** Face structure (r7 critic: ten faces from one template) — drives the 3D head, so the portrait too. */
  fp?: FaceShape;
}

/**
 * Per-villager face structure. Everything defaults to the chibi template (1 / 0); the crown stays
 * put under the hair and the face grows / narrows below it, so hats and hair still fit.
 */
export interface FaceShape {
  /** Face width (≤ 1 narrows the skull; > 1 adds cheek / jowl mass below the hair line). */
  w?: number;
  /** Face length (crown anchored: > 1 drops the chin). */
  h?: number;
  /** 0 = soft round jaw, 1 = broad square jaw. */
  jaw?: number;
  /** + = a pointed / jutting chin, − = a soft receding chin with a little double chin. */
  chin?: number;
  /** Eye size, spacing (1 = default) and height (fractions of the head radius, + = up). */
  eye?: number;
  gap?: number;
  eyeY?: number;
  nose?: 'button' | 'bulb' | 'long' | 'hook' | 'snub' | 'broad';
  /** Mouth width (1 = default). */
  mouth?: number;
  /** Age lines 0..1: crow's feet (≥ .3), under-eye bags (≥ .55), smile folds (≥ .5), forehead (≥ .75). */
  lines?: number;
  /** Rosy cheek disc strength 0..1 (default .6; 0 = none). */
  cheeks?: number;
  /** Ear size (1 = default). */
  ears?: number;
  /** A cleft / dimpled chin line. */
  cleft?: boolean;
}

export type Backdrop = 'shop' | 'bakery' | 'river' | 'forge' | 'clinic' | 'inn' | 'hall' | 'meadow' | 'workshop' | 'garden';

export interface Ask {
  q: string;
  mood?: Mood;
  options: { text: string; reply: string; mood?: Mood; delta: number }[];
}

export interface DialogueGroup {
  /** Only on the very first conversation. */
  first?: boolean;
  /** Only on the villager's birthday. */
  birthday?: boolean;
  seasons?: Season[];
  weather?: Weather[];
  /** Inclusive hour range. */
  hours?: [number, number];
  /** Minimum hearts for this group. */
  minHearts?: number;
  lines: string[];
  /** Optional question with choices after the lines. */
  ask?: Ask;
}

export type Who = NpcId | 'player';
export type Place = string | [number, number];

export type CutStep =
  | { say: NpcId; text: string; mood?: Mood }
  | { narrate: string }
  | { walk: Who; to: Place; face?: Facing | Who; run?: boolean }
  | { face: Who; to: Facing | Who }
  | { emote: Who; icon: Emote }
  | { act: NpcId; activity: Activity }
  | { wait: number }
  | { cam: { x: number; z: number; yaw?: number; pitch?: number; distance?: number } }
  | { fade: 'out' | 'in' }
  | { choice: NpcId; q?: string; options: { text: string; reply: string; mood?: Mood; delta: number }[] };

export interface HeartEvent {
  id: string;
  hearts: number;
  title: string;
  /** Hours when it can trigger (player enters town / is in town). */
  hours: [number, number];
  /** No rain / storm. */
  dry?: boolean;
  /** Stage time used by the demo (defaults to hours[0] + 0.5). */
  demoTime?: number;
  /** Initial placement: [place, facing]. */
  cast: Partial<Record<Who, [Place, Facing]>>;
  camera: { x: number; z: number; yaw?: number; pitch?: number; distance?: number };
  script: CutStep[];
  /**
   * The thing the title is about (the bridge Wren paints, the Hall Tobias lit): the opening wide
   * shot pulls it into frame and auditEvents() fails if it is not on screen there.
   */
  subject?: { at: [number, number]; y?: number; label: string };
  /**
   * Insert cards (r7): a painted close-up of the thing the scene is about (ui/portraits insertArt
   * kinds) pinned beside the dialogue while a line containing one of `word`'s '|'-separated words plays.
   */
  insert?: { kind: string; word: string; caption: string }[];
  /** Extra actors spawned for the scene (e.g. Pip the shop cat): at [x, z], height above ground. */
  props?: {
    kind: 'cat' | 'candle' | 'painting' | 'ledger' | 'map' | 'sparks' | 'letter';
    at: [number, number];
    y?: number;
    rot?: number;
    pose?: 'sit' | 'curl';
    scale?: number;
    /** A line containing this word frames the prop with the speaker. */
    word?: string;
    /** Held by a cast member ('lap' / 'chest'; `at` ignored). */
    hold?: [NpcId, 'lap' | 'chest'];
    /** Placed `near[1]` m in front of a cast member (`at` ignored): the anvil's sparks. */
    near?: [NpcId, number, number?];
  }[];
}

export interface GiftTastes {
  love: string[];
  like: string[];
  dislike: string[];
}

export interface NpcDef {
  id: NpcId;
  name: string;
  role: string;
  birthday: { season: Season; day: number };
  look: NpcLook;
  walk: WalkStyle;
  /** Building id the villager lives in. */
  home: string;
  /** Portrait background gradient. */
  portraitBg: [number, number];
  /** Default + rainy-day schedule: [hour, spot, activity]. */
  schedule: [number, string, Activity?][];
  rainSchedule?: [number, string, Activity?][];
  gifts: GiftTastes;
  giftLines: { love: string; like: string; neutral: string; dislike: string; birthday: string };
  /** Ordered line groups; the first whose conditions match is used. */
  dialogue: DialogueGroup[];
  events: HeartEvent[];
  /** Short street-chatter lines popped over the head while chatting (≤ 30 chars). */
  barks?: string[];
  /** Winter street chatter (replaces `barks` in winter). */
  winterBarks?: string[];
  /** Seasonal outfit overrides merged over `look` (winter coats, scarves, knit hats — no sunhat in the snow). */
  wardrobe?: Partial<Record<Season, Partial<NpcLook>>>;
  /** Winter days: fewer outdoor idlers, more time by the inn fire / indoors. */
  winterSchedule?: [number, string, Activity?][];
}

const W = (speed: number, stride: number, bounce: number, sway: number, hunch: number, arms: number, skip = false): WalkStyle => ({ speed, stride, bounce, sway, hunch, arms, skip });

export const NPCS: Record<NpcId, NpcDef> = {
  // ─────────────────────────────────────────── Marigold: the general store
  marigold: {
    id: 'marigold',
    name: 'Marigold Thimble',
    role: 'Keeps Thimble & Pip’s general store',
    birthday: { season: 'spring', day: 11 },
    look: { fp: { w: 1.1, h: 0.94, jaw: 0.15, chin: -0.5, eye: 0.84, gap: 1.04, nose: 'bulb', mouth: 0.86, lines: 0.8, cheeks: 0.9, ears: 1.1 }, eyeShape: 'almond', lashes: true, brow: 0.7, browArch: 0.35, head: 0.94, skin: 0xf0c4a0, hair: 0xb8b0b4, hairStyle: 'bun', top: 0x8f6fb0, bottom: 0x5a4a6a, apron: 0xf2e6d0, glasses: true, scale: 0.9, build: 1.3, torso: 0.9, belly: 0.55, shoulders: 0.92, legs: 0.82, eyes: 0x6a8a4a, skirt: true, face: 'round', acc: ['wrinkles', 'earrings', 'keys'], shoes: 0x6a3a3a, backdrop: 'shop' },
    walk: W(1.35, 0.42, 0.035, 0.06, 0.04, 0.35),
    home: 'general_store',
    portraitBg: [0xf6d9a8, 0xe8a888],
    schedule: [
      [6, 'store_front', 'sweep'],
      [9, 'store_counter', 'idle'],
      [12, 'fountain_w', 'chat'],
      [13.5, 'store_counter', 'idle'],
      [17.5, 'notice', 'read'],
      [19, 'bench_sw', 'sit'],
      [21, 'door:general_store', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:general_store', 'inside'], [9.5, 'store_front', 'idle'], [11, 'door:general_store', 'inside'], [12, 'store_counter', 'idle'], [13, 'notice', 'read'], [14.5, 'door:general_store', 'inside'], [16, 'store_front', 'idle'], [17.5, 'door:general_store', 'inside']],
    gifts: { love: ['strawberry', 'sunflower', 'teaLeaves'], like: ['parsnip', 'potato', 'cauliflower'], dislike: ['stone', 'fiber'] },
    giftLines: {
      love: '[blush] Oh! Oh, you shouldn’t have. No, I mean it, you really shouldn’t — now I have to find a vase worthy of it!',
      like: '[happy] How thoughtful. Pip will pretend it was his idea, of course.',
      neutral: '[neutral] Well, thank you, dear. I’m sure it’ll come in handy.',
      dislike: '[worried] Oh. How… practical. I’ll put it with the other practical things. In the cellar.',
      birthday: '[laugh] You remembered! Nobody remembers but Pip, and he only brings me mice.',
    },
    dialogue: [
      {
        first: true,
        lines: [
          '[surprised] Well now! You must be Rosalind’s grandchild — you’ve got her stubborn chin.',
          '[happy] Seeds, tools, a good gossip: Thimble & Pip’s has all three. Pip’s the cat. He does the accounts.',
        ],
      },
      { birthday: true, lines: ['[blush] Another year older and not a day wiser. Don’t tell the ledger.'] },
      { weather: ['rain', 'storm'], lines: ['[happy] Rain on the roof and ledgers on the counter. Some days are simply made for tea.'] },
      { minHearts: 6, lines: ['[happy] Rosalind would have liked you. She’d have hidden it well, mind — she hid most things behind a scone.', '[thinking] Stay for supper sometime. I make a stew that could raise the dead. Or at least Tobias.'] },
      { hours: [6, 9], lines: ['[happy] Early bird! The parsnip seeds just came in on the morning cart.', '[worried] Mind the third step, dear. It’s been creaking since the Lantern Hall went dark.'] },
      { seasons: ['spring'], lines: ['[thinking] Spring’s for planting and for plans. Your gran used to say that, you know.', '[happy] Cauliflower takes its time, but oh, it pays.'] },
      { seasons: ['winter'], lines: ['[neutral] Winter’s slow in the shop. I knit. Pip unravels. We call it teamwork.'] },
      { seasons: ['fall'], lines: ['[laugh] The whole square smells of pumpkin bread this time of year. Blame Bram.'] },
      {
        lines: [
          '[thinking] They say if the Lantern Hall is lit again, the valley remembers how to be kind. Silly, maybe. I’d like to see it anyway.',
          '[angry] Glimmerco sent another man in a shiny coat. Wanted to buy the square. I sold him a turnip.',
        ],
        ask: {
          q: 'Now then — how is the old farm treating you?',
          mood: 'thinking',
          options: [
            { text: 'It’s hard work, but I love it.', reply: '[happy] That’s the Rosalind in you. She hummed while she weeded, you know. Terribly off-key.', delta: 15 },
            { text: 'Honestly? I’m exhausted.', reply: '[worried] Then sit a minute. The weeds will still be there. That’s the one thing you can count on in this life.', delta: 10 },
            { text: 'I might sell it to Glimmerco.', reply: '[angry] …I’m going to pretend the wind said that.', delta: -10 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[sad] Rosalind — your gran — used to sit on that bench with me every market day. Some mornings I still save her the good chair.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['Fresh eggs by noon!', '{store_front}Pip, off the scales!', 'Mind the step, dear.', 'Tea’s on at four.'],
    winterBarks: ['Cocoa’s on the stove, dear!', 'Mind the ice on my step!', 'Pip won’t leave the hearth.', 'Wool socks, half price!'],
    wardrobe: { winter: { apron: undefined, coat: 0x7a4a6a, scarf: 0xc8412f, hat: 'earmuffs', hatColor: 0xf2e6d0, mittens: 0xc8412f } },
    winterSchedule: [[6, 'door:general_store', 'inside'], [8.5, 'store_front', 'sweep'], [10, 'store_counter', 'idle'], [12, 'door:general_store', 'inside'], [14, 'notice', 'read'], [15, 'store_counter', 'idle'], [17, 'door:general_store', 'inside']],
    events: [
      {
        id: 'marigold-2',
        hearts: 2,
        title: 'The Missing Accountant',
        hours: [9, 17],
        dry: true,
        cast: { marigold: ['store_front', 'down'], player: [[24.4, 22.4], 'left'] },
        camera: { x: 22.6, z: 21.4, yaw: -6, pitch: 42, distance: 15 },
        props: [{ kind: 'cat', at: [27.25, 19.62], y: 2.16, rot: 0.25, pose: 'curl', scale: 1.35 }],
        insert: [{ kind: 'cat', word: 'notice board|tear it', caption: 'Pip, asleep on the Glimmerco flyer' }],
        script: [
          { emote: 'marigold', icon: 'question' },
          { say: 'marigold', text: 'Pip? Pip! …Oh, it’s you, dear. Have you seen a cat? Orange, round, judgmental?', mood: 'worried' },
          { say: 'marigold', text: 'He hasn’t touched his breakfast. He ALWAYS touches his breakfast. He touches everyone’s breakfast.', mood: 'worried' },
          { walk: 'marigold', to: [28.7, 18.8], face: 'down' },
          { face: 'player', to: 'up' },
          { emote: 'marigold', icon: 'exclaim' },
          { say: 'marigold', text: 'There! On the notice board roof, sleeping on the Glimmerco flyer like it owes him money.', mood: 'surprised' },
          { say: 'marigold', text: 'Good boy. Tear it up, Pip. Tear it right up.', mood: 'laugh' },
          { face: 'marigold', to: 'player' },
          {
            choice: 'marigold',
            q: 'Thank you for looking with me. You didn’t have to.',
            options: [
              { text: 'Of course I did. He’s family.', reply: 'Family. Yes. That’s exactly what he is — the grumpy kind. Like me.', mood: 'blush', delta: 60 },
              { text: 'I was only passing by.', reply: 'Well, pass by more often. The shop’s quieter than it looks.', mood: 'happy', delta: 20 },
            ],
          },
          { emote: 'marigold', icon: 'heart' },
        ],
      },
      {
        id: 'marigold-4',
        hearts: 4,
        title: 'Rosalind’s Ledger',
        hours: [17, 21],
        // (the bench faces the fountain: the lens comes from the plaza side, so her face reads and the
        // west lamp post stays out of the line behind her head; the farmer stands beside, not in front)
        cast: { marigold: ['bench_sw', 'up'], player: [[28.9, 27.7], 'left'] },
        camera: { x: 27.9, z: 28.5, yaw: 155, pitch: 40, distance: 14 },
        // The ledger itself, open on her lap (r4 critic: "no ledger prop in sight").
        props: [{ kind: 'ledger', at: [0, 0], hold: ['marigold', 'lap'], word: 'tab' }],
        insert: [{ kind: 'ledger', word: 'tab|paid in pie|page left', caption: 'Gran’s tab — every line “paid in pie”' }],
        script: [
          { act: 'marigold', activity: 'sit' },
          { wait: 0.8 },
          { face: 'marigold', to: 'player' },
          { say: 'marigold', text: 'Come, sit. I found something in the back of the till — your gran’s old tab.', mood: 'happy' },
          { say: 'marigold', text: 'Forty years of seeds, and every single entry marked “paid in pie.”', mood: 'laugh' },
          { say: 'marigold', text: 'I never charged her. Not once. She kept writing it down anyway, so I’d know she knew.', mood: 'sad' },
          { emote: 'marigold', icon: 'dots' },
          { say: 'marigold', text: 'I’d like you to have it. There’s a page left at the end. Seems a shame to waste it.', mood: 'blush' },
          {
            choice: 'marigold',
            options: [
              { text: 'Then the first pie is on me.', reply: 'Ha! Oh, she’d have loved that. Rhubarb, mind. None of that fancy nonsense.', mood: 'laugh', delta: 80 },
              { text: 'You should keep it.', reply: 'No, dear. Some things are meant to be handed on. Like stubborn chins.', mood: 'happy', delta: 40 },
            ],
          },
          { emote: 'marigold', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Bram: the baker
  bram: {
    id: 'bram',
    name: 'Bram Oakhollow',
    role: 'Baker at The Hearth Oven',
    birthday: { season: 'fall', day: 3 },
    look: { fp: { w: 1.16, h: 0.94, jaw: 1, chin: -0.2, eye: 0.82, gap: 0.92, eyeY: 0.02, nose: 'broad', mouth: 1.12, lines: 0.35, cheeks: 0.85, ears: 1.15 }, eyeShape: 'beady', brow: 1.6, browArch: 0.1, skin: 0xd9a07a, hair: 0x5a3a24, hairStyle: 'cap', top: 0xe4d9c6, bottom: 0x6a5a48, apron: 0xd8cbb0, beard: 'full', scale: 1.08, build: 1.5, belly: 1, shoulders: 1.12, torso: 1.06, hands: 1.35, head: 0.86, eyes: 0x5a3a24, face: 'square', legs: 0.84, acc: ['rollingpin'], shoes: 0x4a3222, backdrop: 'bakery' },
    walk: W(1.4, 0.45, 0.03, 0.12, 0.0, 0.3),
    home: 'bakery',
    portraitBg: [0xf4d49a, 0xe89a5a],
    schedule: [
      [6, 'bakery_front', 'knead'],
      [11, 'market_produce', 'chat'],
      [13, 'bakery_front', 'knead'],
      [16, 'cafe', 'sit'],
      [18, 'inn_front', 'chat'],
      [21.5, 'door:bakery', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:bakery', 'inside'], [10, 'bakery_front', 'idle'], [11.5, 'door:bakery', 'inside'], [14, 'cafe', 'sit'], [15.5, 'door:bakery', 'inside'], [18, 'inn_front', 'chat'], [21, 'door:bakery', 'inside']],
    gifts: { love: ['pumpkin', 'corn', 'wheat'], like: ['tomato', 'potato', 'strawberry'], dislike: ['fiber', 'stone'] },
    giftLines: {
      love: '[laugh] HO! Now THAT is a proper gift. I can smell the pie already. I can smell three pies.',
      like: '[happy] Oh, very nice. That’ll go in something. Everything goes in something, eventually.',
      neutral: '[neutral] Thanks, friend. Into the pantry it goes.',
      dislike: '[worried] Ah. Hm. I’ll… feed it to the oven. The oven eats anything. The oven is not picky.',
      birthday: '[blush] For my birthday? I’m not crying. That’s flour. In my eyes. Flour tears.',
    },
    dialogue: [
      { first: true, lines: ['[laugh] Ho there, farmer! Bram. I bake. Mostly I burn things beautifully.', '[happy] First loaf is on the house. Second too, if you tell me it was the best you ever had.'] },
      { birthday: true, lines: ['[blush] Birthday cake is a baker’s busman’s holiday. I made myself four. For quality control.'] },
      { hours: [6, 10], lines: ['[happy] Dough’s been up since four. So have I. Only one of us looks fluffier for it.'] },
      { weather: ['rain', 'storm'], lines: ['[happy] Rainy days sell twice the buns. Cosy weather is good for business and bad for waistlines.'] },
      { minHearts: 5, lines: ['[thinking] You know, I used to sing in the Lantern Hall choir. Bass. Very bass. The windows hummed.', '[happy] When it’s lit again, I’ll sing. Promise. You’ll have to stand at the back.'] },
      { seasons: ['winter'], lines: ['[worried] Snow on the hall roof again. Somebody ought to light that lantern before the festival.'] },
      {
        lines: ['[happy] If you grow the wheat, I’ll bake the bread. That’s the oldest deal in the valley.', '[laugh] The Lantern Hall had the best acoustics for singing. Not that I sing. Loudly. In public.'],
        ask: {
          q: 'Settle something for me: crust or no crust?',
          mood: 'thinking',
          options: [
            { text: 'Crust. Always crust.', reply: '[laugh] A person of culture! The crust is where the flavour lives.', delta: 15 },
            { text: 'Cut it off, please.', reply: '[surprised] …I’ll pray for you.', delta: 0 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[sad] Burnt a whole tray of honey buns this morning. Not the buns’ fault. Mine. Some days the oven knows you’re somewhere else.',
          '[angry] Someone’s been feeding my sourdough starter SUGAR. Sugar! Whoever it was owes Gerald an apology.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['{bakery_front}Buns out of the oven!', 'Flour’s in my beard again.', 'Rye or plain today?', 'Smell that? Cinnamon.'],
    winterBarks: ['Hot buns! Warm your hands!', 'Gingerbread’s nearly gone!', 'Snow in the flour bin again.', 'Spiced loaf, fresh out!'],
    wardrobe: { winter: { longSleeves: true, top: 0xb8443a, scarf: 0x3f6f9a } },
    winterSchedule: [[6, 'door:bakery', 'inside'], [8, 'bakery_front', 'knead'], [11, 'market_produce', 'chat'], [12.5, 'door:bakery', 'inside'], [14, 'bakery_front', 'knead'], [16.5, 'inn_front', 'chat'], [18, 'door:inn', 'inside'], [21, 'door:bakery', 'inside']],
    events: [
      {
        id: 'bram-2',
        hearts: 2,
        title: 'The Burnt Batch',
        hours: [6, 12],
        cast: { bram: ['bakery_front', 'down'], player: [[40.6, 22.4], 'right'] },
        camera: { x: 42.4, z: 21.4, yaw: 4, pitch: 42, distance: 14 },
        insert: [{ kind: 'loaf', word: 'charcoal|bread|smoke', caption: 'Charcoal rye (decorative)' }],
        script: [
          { emote: 'bram', icon: 'sweat' },
          { say: 'bram', text: 'Don’t come in! Don’t — the smoke is decorative. It’s a new… style. Of bread.', mood: 'worried' },
          { say: 'bram', text: 'Charcoal rye. Very fashionable in the big city, I’m told.', mood: 'worried' },
          { face: 'bram', to: 'player' },
          { say: 'bram', text: '…I fell asleep. Twenty years of baking and I fell asleep on the flour sacks like a puppy.', mood: 'sad' },
          {
            choice: 'bram',
            options: [
              { text: 'I’ll help you start a new batch.', reply: 'You will? Ha! Then roll up those sleeves. Knead like you mean it — the dough can tell.', mood: 'laugh', delta: 60 },
              { text: 'Maybe you need more sleep.', reply: 'Sleep is for people without sourdough starters. …But you might be right.', mood: 'thinking', delta: 30 },
            ],
          },
          { act: 'bram', activity: 'knead' },
          { emote: 'bram', icon: 'music' },
        ],
      },
      {
        id: 'bram-4',
        hearts: 4,
        title: 'A Song for the Dark Hall',
        hours: [19, 24],
        cast: { bram: ['hall_steps', 'up'], player: [[33.6, 17.6], 'up'] },
        camera: { x: 32.4, z: 15.2, yaw: 0, pitch: 38, distance: 16 },
        insert: [{ kind: 'hall', word: 'song|hall|in there', caption: 'The Lantern Hall, dark nine winters' }],
        script: [
          { emote: 'bram', icon: 'music' },
          { narrate: 'A deep, warm voice rolls across the empty square. Bram is singing to the dark windows of the Lantern Hall.' },
          { wait: 0.6 },
          { emote: 'bram', icon: 'exclaim' },
          { face: 'bram', to: 'player' },
          { say: 'bram', text: 'Ah! You heard that. Nobody heard that. That was the wind. A very tuneful wind.', mood: 'blush' },
          { say: 'bram', text: 'My mother taught me that one in there, the winter I was six. She said the hall kept every song ever sung in it.', mood: 'sad' },
          {
            choice: 'bram',
            options: [
              { text: 'Sing it again. For me.', reply: 'For you? …All right. But you have to hum the low part. Nobody can do the low part but me, so you’ll be terrible. It’ll be perfect.', mood: 'happy', delta: 80 },
              { text: 'We’ll light it again. I promise.', reply: 'Don’t promise, farmer. Just do it. Promises are for bakers — we promise bread every morning.', mood: 'thinking', delta: 50 },
            ],
          },
          { emote: 'bram', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Wren: the painter
  wren: {
    id: 'wren',
    name: 'Wren Fairweather',
    role: 'Painter, wanderer, bad at sitting still',
    birthday: { season: 'summer', day: 22 },
    look: { fp: { w: 0.94, h: 1.03, jaw: 0, chin: 0.45, eye: 1.12, gap: 1.1, eyeY: -0.02, nose: 'snub', mouth: 0.82, lines: 0, cheeks: 0.35, ears: 0.9 }, eyeShape: 'wide', lashes: true, brow: 0.75, browArch: 0.25, skin: 0xf6d2b8, hair: 0x3f8f8a, hairStyle: 'bob', top: 0xe8c45a, bottom: 0x3a4a6a, scarf: 0xe8674a, scale: 0.94, build: 0.84, shoulders: 0.86, torso: 1.1, legs: 1.2, head: 0.9, eyes: 0x3a7a8a, face: 'heart', acc: ['pencil', 'freckles', 'satchel'], shoes: 0xc8573e, backdrop: 'river' },
    walk: W(1.7, 0.6, 0.06, 0.05, -0.02, 0.55),
    home: 'cottage_west',
    portraitBg: [0xbfe0e8, 0x8fb8d8],
    schedule: [
      [6, 'door:cottage_west', 'inside'],
      [8, 'easel_plaza', 'paint'],
      [12, 'cafe', 'chat'],
      [13, 'easel_river', 'paint'],
      [17, 'bridge_mid', 'lean'],
      [20, 'fountain_s', 'sit'],
      [22.5, 'door:cottage_west', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:cottage_west', 'inside'], [9, 'fountain_w', 'idle'], [10, 'inn_front', 'idle'], [11, 'door:inn', 'inside'], [13, 'bridge_mid', 'lean'], [15, 'fountain_s', 'idle'], [16.5, 'door:cottage_west', 'inside']],
    gifts: { love: ['cauliflower', 'sunflower', 'amethyst'], like: ['strawberry', 'kale', 'pondPerch'], dislike: ['wood', 'stone'] },
    giftLines: {
      love: '[surprised] Is this for me? Look at the COLOUR of it. Hold still — no, the gift, hold the gift still, I need to sketch it!',
      like: '[happy] Oh, lovely! It’s going straight into a still life. Then into me. Art first, lunch second.',
      neutral: '[neutral] Thanks! I’ll find a use for it. Probably as a paperweight. Everything’s a paperweight if you believe.',
      dislike: '[worried] Oh… um. Is it… abstract? I don’t get it. That’s fine! Nobody gets my stuff either.',
      birthday: '[blush] You knew it was my birthday? I didn’t even know it was my birthday. I lose track of days. And shoes.',
    },
    dialogue: [
      { first: true, lines: ['[surprised] Oh! Don’t move — the light on your hat is perfect. …Okay, you can move. Hi. I’m Wren.', '[thinking] I’m painting the whole valley before autumn. The Lantern Hall keeps coming out grey, though.'] },
      { birthday: true, lines: ['[laugh] Birthday rule: I don’t paint today. I just lie on the bridge and look at clouds. Join me?'] },
      { hours: [17, 21], lines: ['[happy] Golden hour! Everything looks like it was dipped in honey. Even you.'] },
      { weather: ['rain', 'storm'], lines: ['[laugh] Rain makes the cobbles look like a mirror. I tried to paint it. The paint ran away.'] },
      { minHearts: 6, lines: ['[blush] I started a painting of the farm. You’re in it. Very small. In the corner. Doing a heroic weed-pull.'] },
      { seasons: ['winter'], lines: ['[thinking] Snow is the hardest thing to paint. It’s not white, you know. It’s blue and lilac and a tiny bit of peach.'] },
      {
        lines: ['[happy] Your farm used to be on every postcard. Maybe it can be again?', '[thinking] When the hall’s lantern was lit you could see it from the beach. I want to paint that. Someday.'],
        ask: {
          q: 'Quick — what colour is the river right now?',
          mood: 'thinking',
          options: [
            { text: 'Green-gold, like old glass.', reply: '[surprised] YES. Exactly that. You have a painter’s eye, did you know?', delta: 20 },
            { text: 'Blue? It’s a river.', reply: '[laugh] Ha! Look again. Look properly. There’s a whole sunset in there.', delta: 5 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[sad] Mum wrote. She asked if I’ve “got it out of my system yet.” The painting, she means. Like it’s a cold.',
          '[angry] The Glimmerco van parked right in front of my view. For an HOUR. I painted it as a big grey slug. Out of spite.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['Hold still, light!', 'That blue’s all wrong.', 'Ooh — look at those clouds.', 'Has anyone seen my pencil?'],
    winterBarks: ['Snow’s not just white. Look!', 'My ink froze. Again.', 'Everything’s blue and pink!', 'Cold fingers, warm colours.'],
    wardrobe: { winter: { coat: 0x3f5f8a, hat: 'beanie', hatColor: 0xe8674a, mittens: 0xe8c45a } },
    winterSchedule: [[6, 'door:cottage_west', 'inside'], [9, 'easel_plaza', 'paint'], [12, 'door:inn', 'inside'], [14, 'bridge_mid', 'lean'], [16, 'door:cottage_west', 'inside']],
    events: [
      {
        id: 'wren-2',
        hearts: 2,
        title: 'Painting the Bridge',
        hours: [8, 18],
        dry: true,
        demoTime: 16.8,
        cast: { wren: ['easel_river', 'right'], player: [[59.15, 20.3], 'right'] },
        // From the south-east bank: the Kettle Bridge in the foreground, Wren at her easel beyond it.
        camera: { x: 61.2, z: 23.4, yaw: 40, pitch: 40, distance: 15 },
        subject: { at: [62.4, 25.3], y: 0.9, label: 'Kettle Bridge' },
        // Yesterday's attempt, propped on a field stand facing the path: the painting she asks about.
        props: [{ kind: 'painting', at: [58.75, 22.7], rot: 0.3, scale: 1.3, word: 'look like a river' }],
        insert: [{ kind: 'painting', word: 'paint|river', caption: 'Wren’s canvas: the Kettle Bridge' }],
        script: [
          { act: 'wren', activity: 'paint' },
          { wait: 1.0 },
          { emote: 'wren', icon: 'anger' },
          { say: 'wren', text: 'No, no, NO. The water keeps moving! How is anyone supposed to paint something that won’t sit still?', mood: 'angry' },
          { face: 'wren', to: 'player' },
          { emote: 'wren', icon: 'exclaim' },
          { say: 'wren', text: 'Oh — hi. Sorry. I’ve been shouting at a river for an hour. It hasn’t apologised.', mood: 'blush' },
          {
            choice: 'wren',
            q: 'Be honest. Does it look like a river?',
            options: [
              { text: 'It looks like how a river feels.', reply: 'How it… feels. Oh. OH. That’s the nicest thing anyone has said about my work. Ever. Including my mum.', mood: 'surprised', delta: 70 },
              { text: 'It looks a bit like soup.', reply: 'Ha! It DOES look like soup. Soup river. I’m keeping it. You’ve ruined me, farmer.', mood: 'laugh', delta: 35 },
            ],
          },
          { emote: 'wren', icon: 'heart' },
        ],
      },
      {
        id: 'wren-4',
        hearts: 4,
        title: 'The Grey Lantern',
        hours: [19, 24],
        demoTime: 20.2,
        cast: { wren: ['fountain_s', 'up'], player: [[33.9, 28.8], 'left'] },
        camera: { x: 32.4, z: 24.6, yaw: 0, pitch: 40, distance: 18 },
        insert: [{ kind: 'greyhall', word: 'grey|painting|paints', caption: 'Every hall she paints comes out grey' }],
        script: [
          { say: 'wren', text: 'Every painting of the hall I’ve ever done comes out grey. I thought it was my paints.', mood: 'sad' },
          { walk: 'wren', to: [32.4, 21.0], face: 'up' },
          { walk: 'player', to: [33.5, 21.5], face: 'wren' },
          { say: 'wren', text: 'But it’s not the paints. It’s that I’ve never seen it lit. You can’t paint a light you’ve only heard about.', mood: 'thinking' },
          { face: 'wren', to: 'player' },
          { say: 'wren', text: 'Will you tell me when it happens? Even if it’s three in the morning. Especially if it’s three in the morning.', mood: 'worried' },
          {
            choice: 'wren',
            options: [
              { text: 'I’ll run all the way to your door.', reply: 'You’d better. I’ll leave the window open. And a paintbrush for you.', mood: 'blush', delta: 80 },
              { text: 'You’ll see it from your window.', reply: 'True. But I’d rather see it with somebody. …Forget I said that. Paint fumes.', mood: 'blush', delta: 50 },
            ],
          },
          { emote: 'wren', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Odessa: the blacksmith
  odessa: {
    id: 'odessa',
    name: 'Odessa Flint',
    role: 'Blacksmith at Flint & Ember',
    birthday: { season: 'winter', day: 9 },
    look: { fp: { w: 1.02, h: 1.07, jaw: 0.95, chin: 0.25, eye: 0.9, gap: 1.0, eyeY: 0.02, nose: 'broad', mouth: 1.18, lines: 0.2, cheeks: 0.0, ears: 0.95, cleft: true }, eyeShape: 'almond', brow: 1.45, browArch: -0.05, skin: 0x8a5a3e, hair: 0x1e1612, hairStyle: 'braids', top: 0xb8a48a, bottom: 0x3a342e, apron: 0x6a4a32, scale: 1.16, build: 1.3, shoulders: 1.36, torso: 1.32, hands: 1.3, head: 0.78, eyes: 0x3a2418, hat: 'bandana', hatColor: 0xc8412f, face: 'square', legs: 1.4, acc: ['toolbelt', 'earrings', 'tongs'], shoes: 0x2e2420, backdrop: 'forge' },
    walk: W(1.6, 0.52, 0.025, 0.03, 0.02, 0.3),
    home: 'forge',
    portraitBg: [0xf2b48a, 0xb8563a],
    schedule: [
      [6, 'forge_anvil', 'hammer'],
      [12, 'inn_tables', 'sit'],
      [13, 'forge_anvil', 'hammer'],
      [18, 'bridge_mid', 'lean'],
      [19.5, 'inn_front', 'chat'],
      [22, 'door:forge', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'forge_anvil', 'hammer'], [12, 'inn_tables', 'sit'], [13, 'forge_anvil', 'hammer'], [18, 'inn_front', 'chat'], [22, 'door:forge', 'inside']],
    gifts: { love: ['copperOre', 'ironOre', 'goldOre', 'pumpkin'], like: ['stone', 'coal', 'corn'], dislike: ['sunflower', 'strawberry'] },
    giftLines: {
      love: '[surprised] …Huh. That’s actually good. That’s really good. You’ve got an eye. Don’t let it go to your head.',
      like: '[happy] Useful. I like useful. Thanks.',
      neutral: '[neutral] Hm. Thanks.',
      dislike: '[angry] Flowers? For a smith? They’d be ash in a minute near the forge. …It’s the thought. I suppose.',
      birthday: '[blush] Who told you? Was it June? It was June. …Thanks. Don’t make it weird.',
    },
    dialogue: [
      { first: true, lines: ['[neutral] You’re the one from the old Ashgrove farm. Your hoe’s blade is on backwards, by the way.', '[happy] Bring it in some time. I’ll fix it for free. Once.'] },
      { birthday: true, lines: ['[neutral] Birthday. Yes. I’m aware. I’m having an ordinary day on purpose.'] },
      { hours: [6, 9], lines: ['[neutral] Fire takes an hour to wake. I take two. We get along.'] },
      { weather: ['rain', 'storm'], lines: ['[happy] Rain’s good for the forge. Cools the tongs, keeps the tourists away.'] },
      { minHearts: 5, lines: ['[thinking] My grandfather forged the lantern cage on the hall. I climb up some nights and check the rivets. Don’t tell anyone.', '[happy] You’re alright, you know that? For a farmer.'] },
      { seasons: ['winter'], lines: ['[happy] Winter’s my season. Everybody comes to stand near the forge and pretend they’re not cold.'] },
      {
        lines: ['[neutral] Iron doesn’t lie. Hit it wrong and it tells you. More people should be like iron.', '[angry] Glimmerco sells factory tools. They snap in a season. Then you buy another. That’s the business.'],
        ask: {
          q: 'You ever swung a hammer? Properly?',
          mood: 'neutral',
          options: [
            { text: 'Every day, on the farm.', reply: '[happy] Then your wrists know more than your head. Good.', delta: 15 },
            { text: 'Teach me sometime?', reply: '[surprised] …Maybe. If you show up at six. Not five past. Six.', delta: 20 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[laugh] Ha! You should’ve seen Rowan’s face when the bellows sneezed soot all over him. Best thing that’s happened all week.',
          '[sad] My old master’s hammer cracked today. Forty years it rang on that anvil and I couldn’t mend it. Some things you can’t.',
          '[worried] Coal’s running low and the pass might snow in early. If the forge goes cold, half this town’s hinges go with it.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['{forge_anvil}Hot iron, mind your fingers.', 'Hinges don’t mend themselves.', 'Fine day for sparks.', 'Bring me a horseshoe?'],
    winterBarks: ['Warmest spot in town, this.', 'Sledge runners, mended free.', 'Ice on the anvil. Lovely.', 'Come warm your hands.'],
    wardrobe: { winter: { longSleeves: true, top: 0x7a3a2e, scarf: 0xd8a03a } },
    winterSchedule: [[6, 'forge_anvil', 'hammer'], [12, 'door:inn', 'inside'], [13, 'forge_anvil', 'hammer'], [18, 'inn_front', 'chat'], [20, 'door:forge', 'inside']],
    events: [
      {
        id: 'odessa-2',
        hearts: 2,
        title: 'Sparks',
        hours: [8, 18],
        cast: { odessa: ['forge_anvil', 'up'], player: [[84.2, 22.2], 'up'] },
        camera: { x: 83.6, z: 19.8, yaw: -8, pitch: 42, distance: 14 },
        // Sparks off the anvil with every strike, and the forge's glow on her face.
        props: [{ kind: 'sparks', at: [0, 0], near: ['odessa', 0.2, 0.7] }],
        insert: [{ kind: 'hinge', word: 'hinge|hall door', caption: 'A hinge for the Hall door' }],
        script: [
          { act: 'odessa', activity: 'hammer' },
          { wait: 1.2 },
          { emote: 'odessa', icon: 'exclaim' },
          { face: 'odessa', to: 'player' },
          { say: 'odessa', text: 'Stand back. Sparks don’t care whose eyebrows they take.', mood: 'neutral' },
          { say: 'odessa', text: '…A hinge. For the hall door. It’s been hanging crooked for nine years and nobody noticed but me.', mood: 'thinking' },
          {
            choice: 'odessa',
            options: [
              { text: 'I noticed. It squeaks.', reply: 'It DOES squeak. Everyone says I’m imagining it. Ha! Somebody finally hears it.', mood: 'laugh', delta: 60 },
              { text: 'Why fix a dark hall?', reply: 'Because when it’s lit again, the door should open properly. Things should be ready.', mood: 'thinking', delta: 35 },
            ],
          },
          { act: 'odessa', activity: 'hammer' },
        ],
      },
      {
        id: 'odessa-4',
        hearts: 4,
        title: 'The Lantern Cage',
        hours: [20, 25],
        // (r7: she checks the cage side-on — 'up' put her back to the lens on the opening line)
        cast: { odessa: [[33.6, 14.6], 'left'], player: [[31.0, 16.2], 'up'] },
        camera: { x: 32.4, z: 13.8, yaw: 6, pitch: 36, distance: 15 },
        insert: [{ kind: 'cage', word: 'cage|rivet|lantern', caption: 'Her grandfather’s lantern cage' }],
        script: [
          { say: 'odessa', text: 'Shh. Rivet check. My grandfather made this cage — every piece, by hand, the winter the old one rusted through.', mood: 'neutral' },
          { face: 'odessa', to: 'player' },
          { say: 'odessa', text: 'He said a lantern’s only half the work. The other half is someone who comes back every night to see it’s still whole.', mood: 'sad' },
          { emote: 'odessa', icon: 'dots' },
          { say: 'odessa', text: 'I’ve been coming back for nine years. To a light that isn’t there.', mood: 'sad' },
          {
            choice: 'odessa',
            options: [
              { text: 'Then I’ll come with you. Every night.', reply: '…Every night is a lot of nights, farmer. …Fine. Bring a coat. And tea.', mood: 'blush', delta: 80 },
              { text: 'Your grandfather would be proud.', reply: 'Maybe. He’d still say my rivets are ugly.', mood: 'laugh', delta: 50 },
            ],
          },
          { emote: 'odessa', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Linus: the doctor
  linus: {
    id: 'linus',
    name: 'Dr. Linus Pell',
    role: 'Runs the Willowmere Clinic',
    birthday: { season: 'summer', day: 5 },
    look: { fp: { w: 0.9, h: 1.09, jaw: 0.3, chin: 0.35, eye: 0.84, gap: 0.88, eyeY: 0.02, nose: 'long', mouth: 0.78, lines: 0.5, cheeks: 0.1, ears: 1.05 }, eyeShape: 'almond', brow: 0.8, browArch: 0.45, head: 0.78, skin: 0xf2d0b4, hair: 0x9a9690, hairStyle: 'slick', top: 0xd8e4ea, bottom: 0x4a5058, coat: 0xe6e8e2, bowtie: 0x2f8f8a, glasses: true, beard: 'mustache', scale: 1.1, build: 0.8, shoulders: 0.84, torso: 1.34, neck: 0.13, eyes: 0x4a6a8a, face: 'long', legs: 1.52, acc: ['stethoscope', 'docbag'], shoes: 0x2a2624, backdrop: 'clinic' },
    walk: W(1.75, 0.5, 0.02, 0.02, -0.04, 0.2),
    home: 'clinic',
    portraitBg: [0xd4ece4, 0x8ec4b8],
    schedule: [
      [6, 'door:clinic', 'inside'],
      [7, 'clinic_front', 'read'],
      [8.5, 'fountain_e', 'chat'],
      [10, 'clinic_front', 'sweep'],
      [11, 'door:clinic', 'inside'],
      [12, 'bench_se', 'read'],
      [13, 'door:clinic', 'inside'],
      [17, 'river_walk', 'wander'],
      [19, 'inn_tables', 'read'],
      [21.5, 'door:clinic', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:clinic', 'inside'], [8.5, 'fountain_e', 'chat'], [10, 'door:clinic', 'inside'], [12, 'bench_se', 'read'], [13, 'door:clinic', 'inside'], [13.75, 'store_front', 'idle'], [14.75, 'door:clinic', 'inside'], [17, 'fountain_e', 'idle'], [18.5, 'inn_tables', 'read'], [21.5, 'door:clinic', 'inside']],
    gifts: { love: ['kale', 'teaLeaves', 'frostPike'], like: ['cauliflower', 'potato', 'parsnip'], dislike: ['pumpkin', 'corn'] },
    giftLines: {
      love: '[surprised] Oh! This is… extraordinarily kind. And rich in iron. I shall eat it slowly and with gratitude.',
      like: '[happy] Wholesome. Thank you. My cholesterol thanks you too.',
      neutral: '[neutral] Ah. Thank you. I’ll catalogue it appropriately.',
      dislike: '[worried] Do you know how much sugar people put in that? …No, it’s lovely. I’m sure. Thank you.',
      birthday: '[blush] My birthday? I prescribed myself no celebrations this year. You’ve overruled my diagnosis.',
    },
    dialogue: [
      { first: true, lines: ['[neutral] Dr. Pell. Clinic’s by the south lane. Come by if anything aches, bleeds, or develops opinions.', '[thinking] Farm work is hard on the back. Lift with the knees. I say that to everyone. Nobody listens.'] },
      { birthday: true, lines: ['[blush] It’s my birthday. I’ve had exactly one slice of cake. Medicinally.'] },
      { weather: ['rain', 'storm'], lines: ['[worried] Rainy days bring out the rheumatism. And the gossip. The waiting room is very lively.'] },
      { minHearts: 6, lines: ['[thinking] I came here for a quiet posting. Two years, I said. That was nineteen years ago.', '[happy] The valley grows on you. Like moss. Beneficial moss.'] },
      { hours: [17, 22], lines: ['[neutral] A walk by the river after surgery hours. Doctor’s orders. I am the doctor, so they’re very convenient orders.'] },
      {
        lines: ['[thinking] You look well. Mildly sunburnt. Wear a hat. You own a hat. Wear it.', '[neutral] Tobias skipped his check-up again. Third time. I shall ambush him on his bench.'],
        ask: {
          q: 'Have you been sleeping properly?',
          mood: 'thinking',
          options: [
            { text: 'Like a log.', reply: '[happy] Excellent. Logs are very healthy sleepers.', delta: 10 },
            { text: 'I stay up past midnight a lot.', reply: '[worried] Past two and you’ll collapse in a field. I’ve seen it. Please don’t make me see it again.', delta: 15 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[laugh] Kit came in claiming a frog bit him. The frog, I’m told, is fine. I laughed. Don’t tell Kit I laughed.',
          '[sad] I couldn’t save everyone, back in the city. It’s why I came here. Small town, small hurts. Mostly.',
          '[angry] Three people this week with blisters from Glimmerco boots. Three! Cheap soles and cheaper promises.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['Drink more water, all of you.', '{@kit}Walk, don’t run, Kit!', 'Hm. That cough again?', 'Lovely morning for a stroll.'],
    winterBarks: ['Hats ON, everyone!', 'Mind the ice, Tobias!', 'Scarves save lives.', 'Hm. Chilblain season.'],
    wardrobe: { winter: { coat: 0x4a5464, scarf: 0x8a2a3a, hat: 'earmuffs', hatColor: 0x8a2a3a } },
    winterSchedule: [[6, 'door:clinic', 'inside'], [9, 'fountain_e', 'chat'], [10, 'door:clinic', 'inside'], [13, 'store_front', 'idle'], [14, 'door:clinic', 'inside'], [17, 'inn_tables', 'read'], [20, 'door:clinic', 'inside']],
    events: [
      {
        id: 'linus-2',
        hearts: 2,
        title: 'House Call',
        hours: [9, 17],
        // (r4 critic: Linus's mark put his back-of-head over the lens in the two-shot: the doctor now
        // stops at the bench's far arm, three-quarter to the lens, the farmer at the near one)
        // (r6: the doctor's mark moved off the plaza lantern post east of the bench — it grew out of his
        // head — to the bench's west arm; the farmer stands back beside him)
        cast: { linus: [[32.8, 27.2], 'right'], tobias: ['bench_se', 'down'], player: [[34.5, 30.8], 'right'] },
        camera: { x: 36.0, z: 28.9, yaw: -160, pitch: 40, distance: 15 },
        insert: [{ kind: 'biscuit', word: 'biscuit', caption: 'The hostage' }],
        script: [
          { walk: 'linus', to: [35.05, 28.95], face: 'tobias' },
          { say: 'linus', text: 'Tobias. Your check-up was at ten.', mood: 'neutral' },
          // (an exasperated look to the farmer while the old man talks his way out of it)
          { face: 'linus', to: 'player' },
          { say: 'tobias', text: 'Was it? My memory’s going, Doctor. You should examine it.', mood: 'laugh' },
          { emote: 'linus', icon: 'sweat' },
          { face: 'linus', to: 'player' },
          { say: 'linus', text: 'Help me, farmer. Hold his biscuit hostage while I take his pulse.', mood: 'worried' },
          {
            choice: 'linus',
            options: [
              { text: 'Sorry, Tobias. Doctor’s orders.', reply: 'Splendid. Seventy-two, steady as a clock. Your biscuit, sir, is returned.', mood: 'happy', delta: 60 },
              { text: 'I’m on Tobias’s side.', reply: 'Traitor. …He does seem healthy enough to be insufferable.', mood: 'laugh', delta: 30 },
            ],
          },
          { emote: 'tobias', icon: 'music' },
        ],
      },
      {
        id: 'linus-4',
        hearts: 4,
        title: 'The Letter in the Drawer',
        hours: [18, 23],
        cast: { linus: ['river_walk', 'right'], player: [[57.4, 31.6], 'right'] },
        camera: { x: 59.0, z: 31.4, yaw: -4, pitch: 38, distance: 14 },
        props: [{ kind: 'letter', at: [0, 0], hold: ['linus', 'chest'], word: 'letter' }],
        insert: [{ kind: 'letter', word: 'letter|read it|wrote', caption: 'A resignation, nineteen years unsent' }],
        script: [
          { say: 'linus', text: 'I keep a resignation letter in my desk. Written nineteen years ago. Never sent.', mood: 'thinking' },
          { face: 'linus', to: 'player' },
          { say: 'linus', text: 'Every spring I take it out, read it, and put it back. It’s become a sort of ritual. Like flossing.', mood: 'neutral' },
          { say: 'linus', text: 'This year I found I couldn’t remember why I wrote it.', mood: 'sad' },
          {
            choice: 'linus',
            options: [
              { text: 'Maybe it’s time to burn it.', reply: 'Burn it. Yes. Odessa would lend me the forge. …How very dramatic. I approve.', mood: 'laugh', delta: 80 },
              { text: 'Keep it. It reminds you that you chose this.', reply: 'Chose it. Every spring, again. What an unexpectedly wise thing to say. Are you sure you’re not a doctor?', mood: 'happy', delta: 60 },
            ],
          },
          { emote: 'linus', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── June: the innkeeper
  june: {
    id: 'june',
    name: 'June Ashby',
    role: 'Innkeeper of The Copper Kettle',
    birthday: { season: 'spring', day: 24 },
    look: { fp: { w: 1.0, h: 0.98, jaw: 0.1, chin: 0.3, eye: 1.04, gap: 1.02, nose: 'button', mouth: 1.2, lines: 0.15, cheeks: 0.65, ears: 1.0 }, eyeShape: 'wide', lashes: true, brow: 0.9, browArch: 0.4, skin: 0xf4c8a8, hair: 0xc8482a, hairStyle: 'curly', top: 0xf4ead8, bottom: 0x6a3a4a, vest: 0x3f7a5a, skirt: true, scale: 1.0, build: 1.16, belly: 0.25, torso: 1.1, legs: 1.08, head: 0.88, eyes: 0x3a8a5a, face: 'heart', acc: ['earrings', 'freckles', 'towel'], shoes: 0x4a2a22, backdrop: 'inn' },
    walk: W(1.5, 0.45, 0.04, 0.16, 0.0, 0.45),
    home: 'inn',
    portraitBg: [0xf6c89a, 0xc8584a],
    schedule: [
      [6, 'door:inn', 'inside'],
      [8, 'inn_front', 'sweep'],
      [9.25, 'fountain_s', 'chat'],
      [11, 'market_flowers', 'chat'],
      [12.5, 'door:inn', 'inside'],
      [15, 'inn_tables', 'idle'],
      [17, 'inn_front', 'chat'],
      [18, 'door:inn', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:inn', 'inside'], [8, 'inn_front', 'idle'], [9.5, 'fountain_s', 'chat'], [11, 'market_flowers', 'chat'], [12.5, 'door:inn', 'inside'], [15, 'inn_front', 'idle'], [16, 'door:inn', 'inside']],
    gifts: { love: ['tomato', 'strawberry', 'lanternEel'], like: ['corn', 'potato', 'pondPerch', 'mossCarp'], dislike: ['fiber', 'wood'] },
    giftLines: {
      love: '[laugh] Oh, you absolute darling! That’s going on tonight’s menu, with your name on the chalkboard. In big letters.',
      like: '[happy] Ooh, lovely. The kitchen thanks you. The kitchen is me.',
      neutral: '[neutral] Thanks, pet. Everything finds a pot eventually.',
      dislike: '[worried] Ah — well — it’s very… crunchy-looking. I’ll put it by the fire. For… ambience.',
      birthday: '[blush] My birthday! Drinks on the house! …Don’t tell the regulars, they’ll hold me to it.',
    },
    dialogue: [
      { first: true, lines: ['[happy] Well hello, new face! June. I run the Kettle — best stew, worst piano, warmest fire this side of the valley.', '[laugh] First cider’s free. Second one I’ll talk you into.'] },
      { birthday: true, lines: ['[laugh] Birthday at the Kettle means everyone sings. Badly. Bram carries the tune on his back like a sack of flour.'] },
      { hours: [6, 11], lines: ['[neutral] Mornings are for mopping. Evenings are for making the floor sticky again. It’s the circle of life.'] },
      { weather: ['rain', 'storm'], lines: ['[happy] Rain keeps ’em indoors and thirsty. I love a wet Tuesday.'] },
      { minHearts: 5, lines: ['[thinking] My dad ran the Kettle before me. He used to leave a candle in the window for anyone walking home late. I still do.', '[blush] You’re one of the regulars now, you know. There’s no escape. It’s in the lease.'] },
      { seasons: ['winter'], lines: ['[happy] Winter stew is on. It’s mostly potatoes and gossip. The gossip is the good bit.'] },
      {
        lines: ['[laugh] Rowan broke another chair leaning back on it. That’s four. I’m charging him in firewood.', '[thinking] Glimmerco’s people stayed here last month. Tipped in coupons. COUPONS.'],
        ask: {
          q: 'Settle a bet. Stew — thick or thin?',
          mood: 'happy',
          options: [
            { text: 'Thick enough to stand a spoon in.', reply: '[laugh] Ha! Bram owes me a pie.', delta: 15 },
            { text: 'Thin, with lots of bread.', reply: '[thinking] Hm. A dunker. I can respect a dunker.', delta: 10 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[sad] The inn’s too quiet on storm nights. Dad would’ve had everyone singing by now. I never learned all the words.',
          '[angry] Somebody left the terrace gate open and the wind’s had half my good napkins into the river!',
          '[surprised] You walked all the way here in THIS? Get in, get in — I’ll put the kettle on before you catch your death.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['{inn_front}Stew’s on tonight!', 'Rowan owes me a chair.', '{inn_front}Cider’s cold, come in!', '{inn_front}Who left mud on my step?'],
    winterBarks: ['Mulled cider, inside!', 'Shut the door, it’s snowing!', 'Soup’s on all day!', 'Stamp your boots, please!'],
    wardrobe: { winter: { coat: 0x6a3a4a, scarf: 0xf2e2c0, hat: 'beanie', hatColor: 0x3f7a5a, mittens: 0x3f7a5a } },
    winterSchedule: [[6, 'door:inn', 'inside'], [8, 'inn_front', 'sweep'], [9.5, 'door:inn', 'inside'], [11, 'market_flowers', 'chat'], [12.5, 'door:inn', 'inside'], [17, 'inn_front', 'idle'], [18, 'door:inn', 'inside']],
    events: [
      {
        id: 'june-2',
        hearts: 2,
        title: 'The Empty Chair',
        hours: [17, 24],
        cast: { june: ['inn_front', 'down'], rowan: ['inn_tables', 'right'], player: [[81.4, 27.4], 'down'] },
        camera: { x: 79.4, z: 28.4, yaw: 180, pitch: 48, distance: 15 },
        insert: [{ kind: 'chair', word: 'leaning|chair|firewood', caption: 'Chair no. 4 — mended thirty-one times' }],
        script: [
          { face: 'june', to: 'rowan' },
          { face: 'rowan', to: 'up' },
          { emote: 'june', icon: 'anger' },
          { say: 'june', text: 'ROWAN BIRCH. What did I say about leaning back?', mood: 'angry' },
          { say: 'rowan', text: 'That it builds character?', mood: 'laugh' },
          { say: 'june', text: 'That it builds FIREWOOD.', mood: 'angry' },
          { face: 'june', to: 'player' },
          { say: 'june', text: 'Every week. You’d think a carpenter would respect a chair.', mood: 'worried' },
          {
            choice: 'june',
            options: [
              { text: 'He should fix it. He’s a carpenter.', reply: 'Oh, that’s GOOD. Rowan! You’re fixing it. Tonight. The farmer says so.', mood: 'laugh', delta: 60 },
              { text: 'Want me to sit on him?', reply: 'Ha! Tempting. Very tempting. You can stay.', mood: 'laugh', delta: 40 },
            ],
          },
          { emote: 'rowan', icon: 'sweat' },
        ],
      },
      {
        id: 'june-4',
        hearts: 4,
        title: 'A Candle in the Window',
        hours: [21, 26],
        cast: { june: [[81.8, 30.4], 'up'], player: [[79.4, 28.4], 'right'] },
        camera: { x: 80.6, z: 29.6, yaw: 168, pitch: 42, distance: 12 },
        props: [{ kind: 'candle', at: [82.9, 31.7], y: 1.02, word: 'candle' }],
        insert: [{ kind: 'candle', word: 'candle|window', caption: 'Dad’s candle in the window' }],
        script: [
          { say: 'june', text: 'Oh — still up? I was just setting out Dad’s candle.', mood: 'surprised' },
          { say: 'june', text: 'He said a town is only as warm as its last lit window. I’ve never missed a night. Not one.', mood: 'thinking' },
          { face: 'june', to: 'player' },
          { say: 'june', text: 'Some nights I think it’s daft. A candle, when the whole hall on the hill is dark.', mood: 'sad' },
          {
            choice: 'june',
            options: [
              { text: 'I follow it home every night.', reply: '…You do? Oh. Oh, pet. Then it’s not daft at all, is it.', mood: 'blush', delta: 80 },
              { text: 'Small lights count too.', reply: 'They do, don’t they. Every one of them. Thank you. Now go to bed before I put you to work.', mood: 'happy', delta: 50 },
            ],
          },
          { emote: 'june', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Tobias: the old lamplighter
  tobias: {
    id: 'tobias',
    name: 'Tobias Reed',
    role: 'The last lamplighter of the Lantern Hall',
    birthday: { season: 'winter', day: 20 },
    look: { fp: { w: 0.94, h: 1.08, jaw: 0.3, chin: 0, eye: 0.8, gap: 1.02, eyeY: 0.01, nose: 'hook', mouth: 0.9, lines: 1, cheeks: 0.75, ears: 1.3 }, eyeShape: 'narrow', brow: 1.7, browArch: 0.2, head: 0.93, skin: 0xe8b894, hair: 0xeae6de, hairStyle: 'short', top: 0x7a5a3e, bottom: 0x5a5046, coat: 0x6a5238, beard: 'full', hat: 'flatcap', hatColor: 0x5a6a5a, scale: 0.92, build: 0.96, shoulders: 0.9, torso: 0.96, belly: 0.2, eyes: 0x6a8aa8, face: 'long', legs: 0.86, acc: ['cane', 'wrinkles', 'lantern'], shoes: 0x3a2a1e, backdrop: 'hall' },
    walk: W(0.95, 0.3, 0.015, 0.05, 0.34, 0.15),
    home: 'keeper_cottage',
    portraitBg: [0xd8d0b8, 0x8a8a6a],
    schedule: [
      [6, 'door:keeper_cottage', 'inside'],
      [8, 'hall_lantern', 'idle'],
      [10, 'bench_se', 'sit'],
      [13, 'notice', 'read'],
      [14, 'bench_se', 'sit'],
      [18.5, 'hall_lantern', 'idle'],
      [20, 'door:keeper_cottage', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:keeper_cottage', 'inside'], [9, 'hall_lantern', 'idle'], [10.5, 'door:keeper_cottage', 'inside'], [12.5, 'fountain_w', 'idle'], [14.25, 'hall_steps', 'idle'], [15, 'inn_front', 'idle'], [15.5, 'door:inn', 'inside'], [19, 'door:keeper_cottage', 'inside']],
    gifts: { love: ['parsnip', 'teaLeaves', 'mossCarp'], like: ['potato', 'kale', 'wood'], dislike: ['tomato'] },
    giftLines: {
      love: '[laugh] Heh heh! Now that’s a gift. Rosalind used to bring me these. You’ve got her knack.',
      like: '[happy] Much obliged, young one. Much obliged.',
      neutral: '[neutral] Eh? For me? Well. Thank you kindly.',
      dislike: '[worried] Tomatoes. Nightshade, you know. My mother warned me. I’ve been careful for eighty years.',
      birthday: '[surprised] My birthday? Nobody’s remembered since Rosalind. …Sit with me a while, would you?',
    },
    dialogue: [
      { first: true, lines: ['[thinking] Hmm? Rosalind’s grandchild. Yes, I see it. She walked like that too — like the ground owed her a favour.', '[sad] I lit the lantern on that hall for fifty-one years. Then my knees said no. Nobody’s climbed up since.'] },
      { birthday: true, lines: ['[laugh] Ninety-one. Or ninety-two. I stopped counting after the first ninety.'] },
      { hours: [18, 22], lines: ['[sad] This was the hour. Every evening, up the ladder, strike the match. The whole valley would sigh. You could hear it.'] },
      { weather: ['rain', 'storm'], lines: ['[neutral] Rain on the old knees. They forecast better than the almanac.'] },
      { minHearts: 5, lines: ['[thinking] The hall lantern doesn’t burn oil, you know. It burns what the valley brings it. Rosalind knew. Now maybe you do.', '[happy] You’ve been good company for an old man. Better than the pigeons. Don’t tell the pigeons.'] },
      {
        lines: ['[neutral] Linus wants to check my heart. Told him it’s been broken since ’67 and it still works fine.', '[laugh] Heh! That Kit keeps trying to climb the bell tower. Reminds me of me. Terrifying.'],
        ask: {
          q: 'Do you believe a town can remember things?',
          mood: 'thinking',
          options: [
            { text: 'Yes. Every stone in it.', reply: '[happy] Heh. Rosalind said the same, word for word. Well, well.', delta: 20 },
            { text: 'Towns are just buildings.', reply: '[sad] Maybe for you. Give it a winter. Then tell me again.', delta: 5 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[angry] Glimmerco lamps! Bulbs that never flicker. A light that never flickers is a light nobody tends, and a light nobody tends is nobody’s.',
          '[blush] Oh, go on. Rosalind said I had a lamplighter’s hands. Steady. …I’ll thank you not to tell anyone I went pink.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['Lamps won’t light themselves.', 'Back in my day…', 'Heh. Good morning, young one.', 'My knees say rain.'],
    winterBarks: ['Snow on the lantern again.', 'Coldest winter since ’61.', 'My knees say more snow.', 'Heh. Watch your step.'],
    wardrobe: { winter: { scarf: 0xc8412f, mittens: 0x5a6a5a, coat: 0x4a3a2e } },
    winterSchedule: [[6, 'door:keeper_cottage', 'inside'], [9, 'hall_lantern', 'idle'], [11, 'door:inn', 'inside'], [14, 'hall_steps', 'idle'], [16, 'door:keeper_cottage', 'inside']],
    events: [
      {
        id: 'tobias-2',
        hearts: 2,
        title: 'The Lamplighter’s Match',
        hours: [18, 21],
        // (r6: three-quarter on to the dark lantern above the door, not square to the wall — the reverse
        // lens on his face would sit inside the Hall)
        cast: { tobias: [[33.5, 14.7], 'left'], player: [[30.6, 16.4], 'up'] },
        camera: { x: 32.0, z: 14.8, yaw: -4, pitch: 38, distance: 15 },
        insert: [{ kind: 'match', word: 'match|last one|saving', caption: 'The last match in the last box' }],
        script: [
          { wait: 0.8 },
          { say: 'tobias', text: 'Six-forty. On the dot. This was when I climbed up.', mood: 'thinking' },
          { face: 'tobias', to: 'player' },
          { say: 'tobias', text: 'I still carry the match. Silly old thing. Fifty-one years, one box a month. This is the last one in the last box.', mood: 'wistful' },
          { emote: 'tobias', icon: 'dots' },
          { say: 'tobias', text: 'I’ve been saving it. For the night it’s ready again.', mood: 'thinking' },
          {
            choice: 'tobias',
            options: [
              { text: 'You’ll strike it yourself. I’ll help you up.', reply: 'Heh… up the ladder with these knees? …Aye. Aye, maybe I will. With you holding the bottom.', mood: 'happy', delta: 60 },
              { text: 'Can I see it?', reply: 'Look but don’t touch. That match has waited nine years. It can wait a bit more.', mood: 'laugh', delta: 30 },
            ],
          },
          { emote: 'tobias', icon: 'heart' },
        ],
      },
      {
        id: 'tobias-4',
        hearts: 4,
        title: 'Rosalind’s Bench',
        hours: [10, 17],
        dry: true,
        cast: { tobias: ['bench_se', 'down'], player: [[35.2, 31.2], 'up'] },
        camera: { x: 36.0, z: 29.8, yaw: 26, pitch: 38, distance: 13 },
        insert: [{ kind: 'bench', word: 'her side|tea|sat right here', caption: 'Rosalind’s side of the bench' }],
        script: [
          { say: 'tobias', text: 'Sit, sit. This was her side. She’d bring the tea, I’d bring the complaints.', mood: 'happy' },
          { walk: 'player', to: [35.8, 29.9], face: 'tobias' },
          { say: 'tobias', text: 'The night the lantern went out, she sat right here with me till dawn. Didn’t say a word. Didn’t need to.', mood: 'sad' },
          { face: 'tobias', to: 'player' },
          { say: 'tobias', text: 'She made me promise to wait for whoever came next. I thought she meant a lamplighter. I think she meant you.', mood: 'thinking' },
          {
            choice: 'tobias',
            options: [
              { text: 'Then I’m glad you waited.', reply: 'Heh. So am I, young one. So am I.', mood: 'happy', delta: 80 },
              { text: 'I’ll bring the tea next time.', reply: 'Strong. Two sugars. She always forgot the second one on purpose.', mood: 'laugh', delta: 60 },
            ],
          },
          { emote: 'tobias', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Kit: the kid
  kit: {
    id: 'kit',
    name: 'Kit Birch',
    role: 'Nine and three-quarters. Future explorer',
    birthday: { season: 'summer', day: 14 },
    look: { fp: { w: 1.06, h: 0.93, jaw: 0, chin: -0.15, eye: 1.16, gap: 1.12, eyeY: -0.06, nose: 'snub', mouth: 0.9, lines: 0, cheeks: 0.75, ears: 1.15 }, eyeShape: 'round', brow: 1.05, browArch: 0.15, skin: 0xf2c8a2, hair: 0xa8602e, hairStyle: 'spiky', top: 0xe8843a, bottom: 0x4a6a9a, scale: 0.7, build: 0.9, torso: 0.8, legs: 0.76, eyes: 0x5a8a3a, head: 1.3, face: 'round', acc: ['freckles', 'bandage', 'satchel'], shoes: 0xd84a3a, backdrop: 'meadow' },
    walk: W(2.3, 0.75, 0.09, 0.05, -0.05, 0.75, true),
    home: 'birch_house',
    portraitBg: [0xf8e0a0, 0x9ac87a],
    schedule: [
      [6, 'door:birch_house', 'inside'],
      [8, 'door:schoolhouse', 'inside'],
      [10, 'school_yard', 'play'],
      [11, 'river_dock', 'fish'],
      [13, 'plaza_play', 'play'],
      [16, 'hall_steps', 'sit'],
      [18, 'door:birch_house', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:birch_house', 'inside'], [9, 'plaza_play', 'play'], [11.5, 'door:birch_house', 'inside'], [13, 'fountain_w', 'play'], [15, 'plaza_play', 'play'], [16.5, 'door:birch_house', 'inside']],
    gifts: { love: ['strawberry', 'lanternEel', 'amethyst', 'frog'], like: ['corn', 'pondPerch', 'stone'], dislike: ['kale', 'cauliflower'] },
    giftLines: {
      love: '[laugh] WHOA. For ME? This is going in the treasure box. The SECRET treasure box. Forget I said that.',
      like: '[happy] Cool! Thanks!',
      neutral: '[neutral] Uh… thanks? What does it do?',
      dislike: '[angry] Eww, that’s a VEGETABLE. Are you working for my brother?',
      birthday: '[surprised] You KNEW? I’m double digits next year. Then I’m basically a grown-up.',
    },
    dialogue: [
      { first: true, lines: ['[surprised] Are you the new farmer? Have you found any bones? Dinosaur bones? Regular bones?', '[happy] I’m Kit. I’m gonna explore the whole valley. Even the mines. ESPECIALLY the mines.'] },
      { birthday: true, lines: ['[laugh] It’s my BIRTHDAY. Rowan made me a sword. It’s a stick. But it’s a sword stick.'] },
      { weather: ['rain', 'storm'], lines: ['[angry] Rowan says I can’t go out in the rain. I’m not made of SUGAR.'] },
      { minHearts: 5, lines: ['[blush] You’re my second best friend. First is a frog I met by the river. Don’t be sad, he’s really cool.'] },
      { hours: [16, 20], lines: ['[thinking] Mr. Reed says there’s a secret room in the bell tower. I’m gonna find it. Don’t tell.'] },
      {
        lines: ['[laugh] I caught a fish THIS big. Okay, this big. Okay, it was a leaf. But it moved like a fish.', '[happy] Rowan’s teaching me woodwork. I made a spoon. It’s a bit flat. It’s a flat spoon.'],
        ask: {
          q: 'What’s better: dragons or sea monsters?',
          mood: 'thinking',
          options: [
            { text: 'Dragons, obviously.', reply: '[laugh] YES. Dragons forever!', delta: 15 },
            { text: 'Sea monsters. They’re mysterious.', reply: '[surprised] …Whoa. I never thought of it like that. Okay, TIE.', delta: 15 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[sad] Rowan says I’m too little to help with the swing. I’m not little. I’m medium. I’m MEDIUM.',
          '[worried] Have you seen a frog about this big? Brown? Answers to Sir Hopsalot? He was in my pocket and now he isn’t.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['Bet you can’t catch me!', 'I found a frog!', 'Hopscotch champion!', 'Is it lunch yet?'],
    winterBarks: ['Snowball fight! You’re it!', 'I made a snow-dog!', 'My mittens are soggy.', 'Catch me if you can!'],
    wardrobe: { winter: { coat: 0xd8573a, hat: 'beanie', hatColor: 0x3f6f9a, scarf: 0xf2c43a, mittens: 0x3f6f9a } },
    winterSchedule: [[6, 'door:birch_house', 'inside'], [9, 'plaza_play', 'play'], [12, 'door:birch_house', 'inside'], [13.5, 'plaza_play', 'play'], [16, 'door:birch_house', 'inside']],
    events: [
      {
        id: 'kit-2',
        hearts: 2,
        title: 'The Great Frog Expedition',
        hours: [10, 17],
        dry: true,
        cast: { kit: ['river_dock', 'right'], player: [[57.6, 35.6], 'right'] },
        camera: { x: 59.4, z: 35.4, yaw: -6, pitch: 40, distance: 13 },
        insert: [{ kind: 'frog', word: 'frog|ribbington|jumped', caption: 'Sir Ribbington, Esq.' }],
        script: [
          { emote: 'kit', icon: 'exclaim' },
          { say: 'kit', text: 'SHH. There’s a frog. The BIG one. His name is Sir Ribbington.', mood: 'surprised' },
          { walk: 'kit', to: [60.6, 36.8], face: 'right', run: true },
          { wait: 0.5 },
          { emote: 'kit', icon: 'sad' },
          { say: 'kit', text: 'He jumped in. He ALWAYS jumps in. I just wanna say hi.', mood: 'sad' },
          { face: 'kit', to: 'player' },
          {
            choice: 'kit',
            options: [
              { text: 'Sit still and he’ll come back.', reply: 'Sit… STILL? That’s the hardest thing in the world! …Okay. For Sir Ribbington.', mood: 'thinking', delta: 60 },
              { text: 'Let’s splash till he surfaces!', reply: 'YES! Wait. Rowan said no splashing. …A small splash?', mood: 'laugh', delta: 40 },
            ],
          },
          { emote: 'kit', icon: 'heart' },
        ],
      },
      {
        id: 'kit-4',
        hearts: 4,
        title: 'The Secret Map',
        hours: [14, 18],
        dry: true,
        cast: { kit: ['hall_steps', 'down'], player: [[33.6, 17.3], 'left'] },
        camera: { x: 32.4, z: 15.8, yaw: 0, pitch: 40, distance: 14 },
        // The map itself, spread on the cobbles between them and weighted with pebbles.
        props: [{ kind: 'map', at: [32.85, 18.25], rot: 0.12, word: 'A map' }],
        insert: [{ kind: 'map', word: 'map|this x|blob', caption: 'Kit’s TOP SECRET map' }],
        script: [
          { say: 'kit', text: 'Okay. I’m gonna show you something. It’s TOP secret. Cross your heart.', mood: 'worried' },
          { walk: 'kit', to: [32.2, 17.4], face: 'player' },
          { say: 'kit', text: 'A map! Of the whole valley! I drew it. That’s the farm. That blob is you.', mood: 'happy' },
          { say: 'kit', text: 'And this X is where the old lamplight stuff is hidden. Mr. Reed said so. Kind of. He was mostly asleep.', mood: 'thinking' },
          {
            choice: 'kit',
            options: [
              { text: 'Partners? We’ll find it together.', reply: 'PARTNERS! We need a handshake. A secret one. I’ll make it up. It’s gonna have a spin.', mood: 'laugh', delta: 80 },
              { text: 'You should show Tobias.', reply: 'Hmm. Okay. But you’re still in the club. There’s two members. You’re the second one.', mood: 'happy', delta: 50 },
            ],
          },
          { emote: 'kit', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Rowan: the carpenter
  rowan: {
    id: 'rowan',
    name: 'Rowan Birch',
    role: 'Carpenter, fixer, Kit’s long-suffering brother',
    birthday: { season: 'fall', day: 18 },
    look: { fp: { w: 0.98, h: 1.1, jaw: 0.8, chin: 0.3, eye: 0.9, gap: 0.95, eyeY: 0.02, nose: 'long', mouth: 1.0, lines: 0.1, cheeks: 0.15, ears: 1.0, cleft: true }, eyeShape: 'sleepy', brow: 1.3, browArch: 0.0, skin: 0xe8b890, hair: 0x4a2e1c, hairStyle: 'short', top: 0x3f7a4a, bottom: 0x3a4658, hat: 'beanie', hatColor: 0xd8a03a, beard: 'stubble', scale: 1.12, build: 1.06, shoulders: 1.26, torso: 1.3, hands: 1.2, head: 0.8, eyes: 0x6a4a2a, face: 'long', legs: 1.36, acc: ['toolbelt', 'pencil'], shoes: 0x5a3a24, backdrop: 'workshop' },
    walk: W(1.55, 0.55, 0.035, 0.09, 0.03, 0.4),
    home: 'birch_house',
    portraitBg: [0xd8e8c0, 0x7aa86a],
    schedule: [
      [6, 'door:birch_house', 'inside'],
      [7.5, 'lumber_yard', 'saw'],
      [12, 'inn_tables', 'sit'],
      [13, 'lumber_yard', 'saw'],
      [17, 'bridge_mid', 'lean'],
      [18.5, 'inn_tables', 'sit'],
      [23, 'door:birch_house', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:birch_house', 'inside'], [8, 'lumber_yard', 'saw'], [12, 'inn_tables', 'sit'], [13, 'inn_front', 'lean'], [15, 'lumber_yard', 'saw'], [18.5, 'inn_tables', 'sit'], [23, 'door:birch_house', 'inside']],
    gifts: { love: ['wood', 'corn', 'pumpkin'], like: ['potato', 'mossCarp', 'tomato'], dislike: ['sunflower'] },
    giftLines: {
      love: '[laugh] Aw, now that’s a good one. Straight grain and everything. You know the way to a carpenter’s heart.',
      like: '[happy] Hey, thanks. Nice of you.',
      neutral: '[neutral] Huh. Thanks, I guess.',
      dislike: '[worried] Sunflowers make me sneeze. Like, a LOT. …It’s okay. Achoo. See? It’s fine.',
      birthday: '[blush] Kit told you, didn’t he. That little… thanks. Really.',
    },
    dialogue: [
      { first: true, lines: ['[happy] Hey. Rowan. I fix things. Roofs, fences, chairs June says I broke.', '[neutral] If you see a small orange hurricane, that’s my brother Kit. Point him home, would you?'] },
      { birthday: true, lines: ['[laugh] Kit made me a birthday card. It says “Happy Birthday Rowan, You Are Old.” Heartwarming.'] },
      { hours: [7, 12], lines: ['[neutral] Measure twice, cut once. Measure three times if June’s watching.'] },
      { weather: ['rain', 'storm'], lines: ['[worried] Rain means leaks. Leaks mean me on somebody’s roof. Pray for me.'] },
      { minHearts: 5, lines: ['[sad] Mum and Dad left for the city when Kit was a baby. Said they’d send for us. …That was a long time ago.', '[thinking] Kit thinks I’m boring. Somebody has to be boring. Boring is what keeps the roof on.'] },
      {
        lines: ['[thinking] Your grandmother’s barn has good bones. Old oak. They don’t make beams like that anymore.', '[laugh] June charges me for chairs I break. I charge her for chairs I fix. We’re even, mostly.'],
        ask: {
          q: 'Your fences holding up out there?',
          mood: 'neutral',
          options: [
            { text: 'Barely. Could you take a look?', reply: '[happy] Sure. Bring me some wood and I’ll show you a trick with the posts.', delta: 15 },
            { text: 'Fine! I built them myself.', reply: '[laugh] Ha, then I’ll be seeing you soon. They always say that.', delta: 10 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[angry] Somebody “borrowed” my good plane and brought it back with a nick in the blade. You don’t do that to a plane.',
          '[surprised] Oh! Didn’t hear you come up. I was counting boards. Lost count. Now I have to start again. Thanks.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['Measure twice, cut once.', '{@kit}Kit! Put that down!', 'Who needs a shelf?', 'Sawdust in my coffee again.'],
    winterBarks: ['Sledges, made to order!', 'Kit! Not at the window!', 'Firewood’s split, finally.', 'Frost in my sawdust.'],
    wardrobe: { winter: { coat: 0x6a4a2e, scarf: 0x3f7a4a, mittens: 0x6a4a2e } },
    winterSchedule: [[6, 'door:birch_house', 'inside'], [8, 'lumber_yard', 'saw'], [12, 'door:inn', 'inside'], [13.5, 'lumber_yard', 'saw'], [17, 'inn_tables', 'sit'], [21, 'door:birch_house', 'inside']],
    events: [
      {
        id: 'rowan-2',
        hearts: 2,
        title: 'Measure Twice',
        hours: [8, 17],
        dry: true,
        demoTime: 10.2,
        cast: { rowan: ['lumber_yard', 'up'], player: [[88.4, 47.3], 'left'] },
        camera: { x: 86.0, z: 46.4, yaw: -6, pitch: 40, distance: 14 },
        insert: [{ kind: 'swing', word: 'swing|rope ladder', caption: 'A swing for the plaza tree' }],
        script: [
          { act: 'rowan', activity: 'saw' },
          { wait: 1.0 },
          { emote: 'rowan', icon: 'question' },
          { face: 'rowan', to: 'player' },
          { say: 'rowan', text: 'Hey. Hold this end? It’s a new swing for the plaza tree. Kit’s idea. Well, Kit’s demand.', mood: 'happy' },
          { say: 'rowan', text: 'He wanted a rope ladder to the moon. We negotiated down.', mood: 'laugh' },
          {
            choice: 'rowan',
            options: [
              { text: 'You’re a good brother, you know.', reply: '…Don’t. You’ll make me go soft and then who’ll tell him to eat his greens?', mood: 'blush', delta: 60 },
              { text: 'Make it a double swing.', reply: 'A double… so I’d have to swing with him. You’re devious. …Yeah, okay.', mood: 'laugh', delta: 40 },
            ],
          },
          { act: 'rowan', activity: 'saw' },
        ],
      },
      {
        id: 'rowan-4',
        hearts: 4,
        title: 'The Letter from the City',
        hours: [18, 23],
        cast: { rowan: ['bridge_mid', 'down'], player: [[62.2, 26.4], 'right'] },
        camera: { x: 63.6, z: 25.6, yaw: 4, pitch: 38, distance: 14 },
        props: [{ kind: 'letter', at: [0, 0], hold: ['rowan', 'chest'], word: 'letter' }],
        insert: [{ kind: 'letter', word: 'letter|mum|city', caption: 'From Mum — the first in six years' }],
        script: [
          { say: 'rowan', text: 'Got a letter. From Mum. First one in six years.', mood: 'sad' },
          { face: 'rowan', to: 'player' },
          { say: 'rowan', text: 'She says there’s room for us in the city now. A flat. Kit could go to a proper school.', mood: 'thinking' },
          { emote: 'rowan', icon: 'dots' },
          { say: 'rowan', text: 'I haven’t told him. I don’t know what I want to tell him.', mood: 'worried' },
          {
            choice: 'rowan',
            options: [
              { text: 'Hearthvale is your home. And Kit’s.', reply: 'Yeah. Yeah, it is. Every roof in this town has one of my nails in it. …Thanks, farmer.', mood: 'happy', delta: 80 },
              { text: 'Ask Kit. He deserves a say.', reply: 'You’re right. He’ll say “only if the frog comes.” …And that’ll be that.', mood: 'laugh', delta: 60 },
            ],
          },
          { emote: 'rowan', icon: 'heart' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Hazel: the gardener
  hazel: {
    id: 'hazel',
    name: 'Hazel Moss',
    role: 'Retired gardener, keeper of the square’s flowers',
    birthday: { season: 'spring', day: 3 },
    look: { fp: { w: 1.04, h: 0.96, jaw: 0, chin: 0.1, eye: 0.8, gap: 1.08, nose: 'button', mouth: 0.84, lines: 0.9, cheeks: 1.0, ears: 1.0 }, eyeShape: 'round', brow: 0.65, browArch: 0.3, head: 0.94, skin: 0xe8b894, hair: 0xd8d4cc, hairStyle: 'bob', top: 0xa8587a, bottom: 0x4a3a4a, scarf: 0xf2e2c0, hat: 'sunhat', hatColor: 0xd6a85a, skirt: true, scale: 0.88, build: 1.08, belly: 0.3, torso: 0.9, legs: 0.84, shoulders: 0.9, eyes: 0x7a6a9a, face: 'round', acc: ['shawl', 'wrinkles', 'flower', 'trowel'], shoes: 0x6a4a3a, backdrop: 'garden' },
    walk: W(1.05, 0.34, 0.02, 0.07, 0.14, 0.22),
    home: 'cottage_east',
    portraitBg: [0xe8d8f0, 0xa88ab8],
    schedule: [
      [6, 'garden_east', 'water'],
      [9, 'planters_hall', 'water'],
      [10, 'allotment', 'water'],
      [11, 'market_flowers', 'chat'],
      [13, 'door:cottage_east', 'inside'],
      [15, 'garden_east', 'water'],
      [17.5, 'bench_sw', 'sit'],
      [19.5, 'door:cottage_east', 'inside'],
    ],
    // Rainy days: umbrellas up — errands, the inn awning, puddles on the square.
    rainSchedule: [[6, 'door:cottage_east', 'inside'], [9, 'garden_east', 'idle'], [10.5, 'market_flowers', 'idle'], [12, 'fountain_e', 'chat'], [13, 'planters_hall', 'idle'], [14.5, 'door:cottage_east', 'inside'], [15.5, 'market_flowers', 'idle'], [16.5, 'door:cottage_east', 'inside']],
    gifts: { love: ['sunflower', 'cauliflower', 'strawberry'], like: ['parsnip', 'kale', 'fiber'], dislike: ['stone', 'lanternEel'] },
    giftLines: {
      love: '[blush] Oh my stars. You grew this? Look at the leaves on it. You’ve got green hands, dear. Not thumbs. Hands.',
      like: '[happy] How lovely. I’ll press a petal in my book.',
      neutral: '[neutral] Thank you, dear. You’re very kind to an old lady.',
      dislike: '[worried] Oh, goodness. It’s… wriggling? Is it meant to wriggle?',
      birthday: '[surprised] For my birthday? I thought everyone had forgotten. I’d half forgotten myself!',
    },
    dialogue: [
      { first: true, lines: ['[happy] You’re Rosalind’s grandchild? Oh, come here, let me look at you. …Yes. Yes, you’ll do.', '[thinking] Your gran and I planted every flower in this square. The roses by the hall were her idea. The weeds were mine.'] },
      { birthday: true, lines: ['[laugh] Eighty springs, dear. And every one of them the best.'] },
      { hours: [6, 10], lines: ['[happy] Morning is when flowers talk. By noon they’re too busy showing off.'] },
      { weather: ['rain', 'storm'], lines: ['[happy] Let it rain. I haven’t had to lift a watering can all day. The sky’s doing my chores.'] },
      { minHearts: 5, lines: ['[thinking] Rosalind kept a seed tin under her porch. Old varieties — nothing like them in any shop. Have you found it?', '[blush] You remind me of her more every week. Don’t let it go to your head. She never did.'] },
      { seasons: ['fall'], lines: ['[thinking] Fall is when you plant bulbs. It’s an act of faith, you know. Burying something and trusting it.'] },
      {
        lines: ['[happy] Talk to your plants. They don’t understand a word, but they like the attention.', '[worried] The roses by the hall haven’t bloomed right since the lantern went out. Coincidence, Linus says. Hmph.'],
        ask: {
          q: 'Which do you like better — roses or wildflowers?',
          mood: 'thinking',
          options: [
            { text: 'Wildflowers. They choose where to grow.', reply: '[happy] Oh, that’s just what Rosalind said. Stubborn, the lot of you.', delta: 20 },
            { text: 'Roses. They take real care.', reply: '[blush] A gardener’s answer. You’ll have scratched hands and a full heart.', delta: 15 },
          ],
        },
      },
      // Storm days: the moods the rest of the year rarely shows.
      {
        weather: ['storm'],
        lines: [
          '[sad] The old rose by the hall didn’t wake up this spring. Forty years it bloomed. I’ll plant a cutting, but it won’t be the same rose.',
          '[angry] Aphids. On my sweet peas. I have declared war, dear, and I intend to be merciless about it.',
        ],
      },
    ],
    // Street chatter (speech bubbles while chatting in town).
    barks: ['The roses are early!', '{garden_east}Mind my tulips, dear.', 'A little rain, then sun.', 'Bees are busy today.'],
    winterBarks: ['My bulbs are asleep, dear.', 'Snowdrops soon, you’ll see.', 'Cold hands, warm heart.', 'Wrap up, it’s bitter!'],
    wardrobe: { winter: { hat: 'beanie', hatColor: 0xa8587a, coat: 0x5a6a4a, acc: ['shawl', 'wrinkles'], mittens: 0xa8587a } },
    winterSchedule: [[6, 'door:cottage_east', 'inside'], [10, 'market_flowers', 'chat'], [11.5, 'door:cottage_east', 'inside'], [14, 'planters_hall', 'idle'], [15, 'door:cottage_east', 'inside']],
    events: [
      {
        id: 'hazel-2',
        hearts: 2,
        title: 'The Stubborn Rose',
        hours: [8, 17],
        dry: true,
        // (r7: a step south of the planter mark — from the old mark every lens on the plaza side was
        // blocked and the solve swung round behind the Hall)
        cast: { hazel: [[28.9, 16.4], 'up'], player: [[30.7, 17.0], 'left'] },
        camera: { x: 30.6, z: 14.8, yaw: -6, pitch: 40, distance: 13 },
        insert: [{ kind: 'rose', word: 'rose|bloom', caption: 'Rosalind’s rose, in bud nine years' }],
        script: [
          { act: 'hazel', activity: 'water' },
          { wait: 1.0 },
          { say: 'hazel', text: 'Come on, you. Bloom. I’ve asked nicely for nine years.', mood: 'thinking' },
          { face: 'hazel', to: 'player' },
          { say: 'hazel', text: 'Rosalind’s rose. It flowered every spring the hall was lit. Now it just… sulks.', mood: 'sad' },
          {
            choice: 'hazel',
            options: [
              { text: 'Maybe it’s waiting too.', reply: 'Waiting. Yes. Aren’t we all, dear. …Well, it can wait with company.', mood: 'thinking', delta: 60 },
              { text: 'Try more fertiliser?', reply: 'Ha! You sound like Linus. Some things need more than manure, dear.', mood: 'laugh', delta: 30 },
            ],
          },
          { emote: 'hazel', icon: 'heart' },
        ],
      },
      {
        id: 'hazel-4',
        hearts: 4,
        title: 'The Seed Tin',
        hours: [15, 20],
        dry: true,
        cast: { hazel: ['garden_east', 'up'], player: [[47.0, 38.0], 'right'] },
        camera: { x: 48.0, z: 36.4, yaw: 4, pitch: 40, distance: 13 },
        insert: [{ kind: 'tin', word: 'seeds|tin', caption: 'Half of Rosalind’s seeds' }],
        script: [
          { face: 'hazel', to: 'player' },
          { say: 'hazel', text: 'I have something for you. I’ve been keeping it since the funeral.', mood: 'sad' },
          { say: 'hazel', text: 'Half of Rosalind’s seeds. She split the tin with me, the spring before. “In case,” she said.', mood: 'thinking' },
          { emote: 'hazel', icon: 'dots' },
          { say: 'hazel', text: 'I never planted them. It felt like finishing her sentence for her. But you… you should.', mood: 'blush' },
          {
            choice: 'hazel',
            options: [
              { text: 'Let’s plant them together.', reply: 'Together. Oh, my dear. Yes. I’d like that more than I can say.', mood: 'happy', delta: 80 },
              { text: 'I’ll take good care of them.', reply: 'I know you will. It’s in your hands. Literally, now.', mood: 'laugh', delta: 60 },
            ],
          },
          { emote: 'hazel', icon: 'heart' },
        ],
      },
    ],
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

const LOOK_CACHE = new Map<string, NpcLook>();
/** The villager's look for a season: `look` with the season's wardrobe merged over it (cached: stable identity). */
export function seasonLook(def: NpcDef, season: Season): NpcLook {
  const over = def.wardrobe?.[season];
  if (!over) return def.look;
  const key = `${def.id}|${season}`;
  let l = LOOK_CACHE.get(key);
  if (!l) LOOK_CACHE.set(key, (l = { ...def.look, ...over }));
  return l;
}

/** Which villager wears this look (base or seasonal), or null (festival extras, the farmer). */
export function lookOwner(look: NpcLook): { def: NpcDef; season: Season | null } | null {
  for (const def of Object.values(NPCS)) {
    if (def.look === look) return { def, season: null };
    for (const s of Object.keys(def.wardrobe ?? {}) as Season[]) if (seasonLook(def, s) === look) return { def, season: s };
  }
  return null;
}

/** All heart events, flattened (id → [npc, event]). */
export function heartEvent(id: string): { npc: NpcDef; ev: HeartEvent } | null {
  for (const npc of Object.values(NPCS)) {
    const ev = npc.events.find((e) => e.id === id);
    if (ev) return { npc, ev };
  }
  return null;
}

/** Strip a leading "[mood] " tag from a line. */
export function parseLine(raw: string, fallback: Mood = 'happy'): { text: string; mood: Mood } {
  const m = /^\[(\w+)\]\s*/.exec(raw);
  if (m && (MOODS as string[]).includes(m[1]!)) return { text: raw.slice(m[0].length), mood: m[1] as Mood };
  return { text: raw, mood: fallback };
}

export interface LineCtx {
  first: boolean;
  season: Season;
  weather: Weather;
  hour: number;
  hearts?: number;
  birthday?: boolean;
}

function groupFor(def: NpcDef, ctx: LineCtx): DialogueGroup | null {
  const hasFirst = def.dialogue.some((d) => d.first);
  for (const g of def.dialogue) {
    if (g.first && !ctx.first) continue;
    if (!g.first && ctx.first && hasFirst) continue;
    if (g.birthday && !ctx.birthday) continue;
    if (g.seasons && !g.seasons.includes(ctx.season)) continue;
    if (g.weather && !g.weather.includes(ctx.weather)) continue;
    if (g.hours && (ctx.hour < g.hours[0] || ctx.hour > g.hours[1])) continue;
    if (g.minHearts !== undefined && (ctx.hearts ?? 0) < g.minHearts) continue;
    return g;
  }
  return null;
}

/** Choose one line for a villager right now (pure). */
export function pickLine(def: NpcDef, ctx: LineCtx & { talkCount: number }): string {
  const g = groupFor(def, ctx);
  return g ? g.lines[ctx.talkCount % g.lines.length]! : '...';
}

/** All lines (+ optional question) of the matching group (the dialogue box pages through them). */
export function pickLines(def: NpcDef, ctx: LineCtx): string[] {
  return groupFor(def, ctx)?.lines ?? ['...'];
}

export function pickGroup(def: NpcDef, ctx: LineCtx): DialogueGroup | null {
  return groupFor(def, ctx);
}

/** Legacy export (festival-goers now come from the full cast). */
export const FESTIVAL_EXTRAS: [NpcLook, number][] = [];
