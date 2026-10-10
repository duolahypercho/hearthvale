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

export type Activity = 'idle' | 'sweep' | 'read' | 'chat' | 'hammer' | 'paint' | 'water' | 'sit' | 'play' | 'fish' | 'inside' | 'wander' | 'knead' | 'saw' | 'lean' | 'tip' | 'carry';

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
  /** Only once the farmer's relationship memory holds this flag (r9 consequences). */
  flag?: string;
  lines: string[];
  /** Optional question with choices after the lines. */
  ask?: Ask;
}

export type Who = NpcId | 'player';
export type Place = string | [number, number];

/**
 * Memory (r9): a step that only plays when the farmer's relationship memory holds (`if`) or lacks
 * (`unless`) a flag — the choices of earlier heart events echo through later scenes.
 */
export interface StepCond {
  if?: string;
  unless?: string;
}

/** A dialogue / event choice: friendship delta plus the memory flag it leaves (`<npc>.<word>`). */
export interface ChoiceOpt {
  text: string;
  reply: string;
  mood?: Mood;
  delta: number;
  flag?: string;
}

export type CutStep = (
  | { say: NpcId; text: string; mood?: Mood }
  | { narrate: string }
  | { walk: Who; to: Place; face?: Facing | Who; run?: boolean }
  | { face: Who; to: Facing | Who }
  | { emote: Who; icon: Emote }
  | { act: NpcId; activity: Activity }
  | { wait: number }
  | { cam: { x: number; z: number; yaw?: number; pitch?: number; distance?: number } }
  | { fade: 'out' | 'in' }
  | { choice: NpcId; q?: string; options: ChoiceOpt[] }
) &
  StepCond;

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
  subject?: { at: [number, number]; y?: number; label: string; /** r16: every two-shot keeps it in frame, behind the actors. */ hold?: boolean };
  /**
   * Insert cards (r7): a painted close-up of the thing the scene is about (ui/portraits insertArt
   * kinds) pinned beside the dialogue while a line containing one of `word`'s '|'-separated words plays.
   */
  insert?: { kind: string; word: string; caption: string }[];
  /** Extra actors spawned for the scene (e.g. Pip the shop cat): at [x, z], height above ground. */
  props?: {
    kind: 'cat' | 'candle' | 'painting' | 'ledger' | 'map' | 'sparks' | 'letter' | 'cage' | 'rose' | 'teacup';
    at: [number, number];
    y?: number;
    rot?: number;
    pose?: 'sit' | 'curl';
    scale?: number;
    /** A line containing this word frames the prop with the speaker. */
    word?: string;
    /** r20: a candle set down as a work light — the radius (m) of the warm pool it throws on the ground. */
    glow?: number;
    /** Held by a cast member ('lap' / 'chest'; `at` ignored). */
    hold?: [NpcId, 'lap' | 'chest' | 'cup' | 'hand'];
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
  /** What the villager carries forward from the farmer's choices (r9; see `Consequence`). */
  keeps?: Consequence[];
}

/**
 * A lasting consequence of a remembered choice (r9 critic: "choices collapse to immediate point
 * deltas"): new street chatter, a changed routine, a talk line, a keepsake left in the town.
 */
export interface Consequence {
  flag: string;
  /** Street chatter, said before the everyday barks. */
  barks?: string[];
  /** A changed routine on fair days: [from hour, to hour, spot, activity]. */
  routine?: [number, number, string, Activity];
  /** A talk line (its own dialogue group, between these hours). */
  line?: string;
  hours?: [number, number];
  /** A thing left in the town: a builder kind at a spot (+ offset, height, yaw). */
  keepsake?: { kind: KeepsakeKind; spot: string; dx?: number; dz?: number; y?: number; rot?: number; label: string };
}
export type KeepsakeKind = 'cat' | 'pie' | 'painting' | 'cage' | 'letter' | 'chair' | 'candle' | 'map' | 'rose' | 'cake' | 'notice';

const W = (speed: number, stride: number, bounce: number, sway: number, hunch: number, arms: number, skip = false): WalkStyle => ({ speed, stride, bounce, sway, hunch, arms, skip });

export const NPCS: Record<NpcId, NpcDef> = {
  // ─────────────────────────────────────────── Marigold: the general store
  marigold: {
    id: 'marigold',
    name: 'Marigold Thimble',
    role: 'Keeps Thimble & Pip’s general store',
    birthday: { season: 'spring', day: 11 },
    look: { fp: { w: 1.1, h: 0.94, jaw: 0.15, chin: -0.5, eye: 0.84, gap: 1.04, nose: 'bulb', mouth: 0.86, lines: 0.8, cheeks: 0.9, ears: 1.1 }, eyeShape: 'almond', lashes: true, brow: 0.7, browArch: 0.35, head: 0.94, skin: 0xf0c4a0, hair: 0xb8b0b4, hairStyle: 'bun', top: 0x8f6fb0, bottom: 0x5a4a6a, apron: 0xf2e6d0, glasses: true, scale: 0.86, build: 1.3, torso: 0.9, belly: 0.55, shoulders: 0.92, legs: 0.82, eyes: 0x6a8a4a, skirt: true, face: 'round', acc: ['wrinkles', 'earrings', 'keys'], shoes: 0x6a3a3a, backdrop: 'shop' },
    walk: W(1.35, 0.42, 0.035, 0.06, 0.04, 0.35),
    home: 'general_store',
    portraitBg: [0xf6d9a8, 0xe8a888],
    schedule: [
      [6, 'store_front', 'sweep'],
      [8.5, 'store_front', 'carry'],
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
      { seasons: ['winter'], lines: ['[happy] Winter’s slow in the shop. I knit. Pip unravels. We call it teamwork.'] },
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
      [10, 'bakery_front', 'carry'],
      [11, 'market_produce', 'chat'],
      // (r21 critic: "at noon the plaza holds only 3 villagers" — the lunch rush: Bram serves at his door)
      [12, 'bakery_front', 'idle'],
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
      neutral: '[laugh] Thanks! I’ll find a use for it. Probably as a paperweight. Everything’s a paperweight if you believe.',
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
        // (r13 critic: the farmer stood behind Wren — when she turned to ask, the lens lost the farmer)
        // (r16 critic: "the Kettle Bridge, the subject of the scene, is not in frame — the lens looks
        // down on the farmer's hat crown, half the frame empty river and grass". Re-blocked from the
        // far (east) bank across the water: Wren at her easel facing the river and the lens, the
        // farmer at her shoulder, the Kettle Bridge arching beside them and held in every shot.)
        // (r21 critic: the farmer stood IN the river among the cattails; ~40 % of the choice frame was flat
        // bridge deck seen end-on and Wren's face hid behind her hair — the farmer comes up the bank on her
        // landward side and the lens looks down the bank from the north, so the pair talk in three-quarter
        // profile with the Kettle Bridge's arch side-on behind them and the river on the left)
        cast: { wren: ['easel_river', 'right'], player: [[58.25, 20.85], 'right'] },
        camera: { x: 59.4, z: 22.6, yaw: 186, pitch: 25, distance: 12 },
        subject: { at: [62.6, 25.3], y: 1.1, label: 'Kettle Bridge', hold: true },
        // Yesterday's attempt, propped on a field stand beside her: the painting she asks about.
        props: [{ kind: 'painting', at: [60.5, 22.9], rot: 1.4, scale: 1.3, word: 'look like a river' }],
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
    look: { fp: { w: 1.02, h: 1.07, jaw: 0.95, chin: 0.25, eye: 1.3, gap: 1.02, eyeY: 0.02, nose: 'broad', mouth: 1.18, lines: 0.2, cheeks: 0.0, ears: 0.95, cleft: true }, eyeShape: 'almond', brow: 1.35, browArch: -0.05, skin: 0x8a5a3e, hair: 0x1e1612, hairStyle: 'braids', top: 0xb8a48a, bottom: 0x3a342e, apron: 0x6a4a32, scale: 1.16, build: 1.3, shoulders: 1.36, torso: 1.32, hands: 1.3, head: 0.78, eyes: 0x3a2418, hat: 'bandana', hatColor: 0x3d5a8c, face: 'square', legs: 1.48, acc: ['toolbelt', 'earrings', 'tongs'], shoes: 0x2e2420, backdrop: 'forge' },
    walk: W(1.6, 0.52, 0.025, 0.03, 0.02, 0.3),
    home: 'forge',
    portraitBg: [0xf2b48a, 0xb8563a],
    schedule: [
      [6, 'forge_anvil', 'hammer'],
      // (r21: lunch on the square — at the fountain's lens-side rim with Hazel, not the inn across the river)
      [11.75, 'plaza_lunch', 'chat'],
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
        cast: { odessa: [[33.1, 15.0], 'left'], player: [[30.6, 16.5], 'up'] }, // (r15: a step left and down-stage — the HALL CLOSED notice reads clear of her head)
        camera: { x: 32.4, z: 13.8, yaw: 6, pitch: 36, distance: 15 },
        // (r8: the cage the scene is about is in her hands, not only on the insert card)
        // (r20: her work light set down by the crates — a deliberate warm focal light in the right third,
        // which the blind judge called "murky, low-detail darkness")
        props: [{ kind: 'cage', at: [0, 0], hold: ['odessa', 'hand'], word: 'cage|rivet' }, { kind: 'candle', at: [37.0, 14.9], scale: 1.5, glow: 1.5 }],
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
    look: { fp: { w: 0.92, h: 1.02, jaw: 0.3, chin: 0.3, eye: 1.0, gap: 0.88, eyeY: 0.02, nose: 'long', mouth: 0.78, lines: 0.5, cheeks: 0.1, ears: 1.05 }, eyeShape: 'almond', brow: 0.8, browArch: 0.45, head: 0.78, skin: 0xf2d0b4, hair: 0x9a9690, hairStyle: 'slick', top: 0xd8e4ea, bottom: 0x4a5058, coat: 0xe6e8e2, bowtie: 0x2f8f8a, glasses: true, beard: 'mustache', scale: 1.1, build: 0.8, shoulders: 0.84, torso: 1.34, neck: 0.13, eyes: 0x4a6a8a, face: 'long', legs: 1.52, acc: ['stethoscope', 'docbag'], shoes: 0x2a2624, backdrop: 'clinic' },
    walk: W(1.75, 0.5, 0.02, 0.02, -0.04, 0.2),
    home: 'clinic',
    portraitBg: [0xd4ece4, 0x8ec4b8],
    schedule: [
      [6, 'door:clinic', 'inside'],
      [7, 'clinic_front', 'read'],
      [8.5, 'fountain_e', 'chat'],
      [10, 'clinic_front', 'sweep'],
      [11, 'door:clinic', 'inside'],
      // (r21: his lunch hour at the notice board — the bench sat in front of the plaza lens's toolbar)
      [12, 'notice', 'read'],
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
      { hours: [17, 22], lines: ['[happy] A walk by the river after surgery hours. Doctor’s orders. I am the doctor, so they’re very convenient orders.'] },
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
      // (r21: the noon queue at the bakery, then the inn's lunch service)
      [12, 'bakery_front', 'chat'],
      [12.75, 'inn_front', 'carry'],
      [13, 'door:inn', 'inside'],
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
      neutral: '[happy] Thanks, pet. Everything finds a pot eventually.',
      dislike: '[worried] Ah — well — it’s very… crunchy-looking. I’ll put it by the fire. For… ambience.',
      birthday: '[blush] My birthday! Drinks on the house! …Don’t tell the regulars, they’ll hold me to it.',
    },
    dialogue: [
      { first: true, lines: ['[happy] Well hello, new face! June. I run the Kettle — best stew, worst piano, warmest fire this side of the valley.', '[laugh] First cider’s free. Second one I’ll talk you into.'] },
      { birthday: true, lines: ['[laugh] Birthday at the Kettle means everyone sings. Badly. Bram carries the tune on his back like a sack of flour.'] },
      { hours: [6, 11], lines: ['[laugh] Mornings are for mopping. Evenings are for making the floor sticky again. It’s the circle of life.'] },
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
        // (r8: Rowan out from under the terrace parasol, tipping chair no. 4 back on its hind legs —
        // the line is about what he is doing, so he does it)
        cast: { june: ['inn_front', 'down'], rowan: [[79.7, 30.5], 'up'], player: [[81.4, 27.4], 'down'] },
        camera: { x: 79.4, z: 28.4, yaw: 180, pitch: 48, distance: 15 },
        insert: [{ kind: 'chair', word: 'leaning|chair|firewood', caption: 'Chair no. 4 — mended thirty-one times' }],
        script: [
          { act: 'rowan', activity: 'tip' },
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
        lines: ['[laugh] Linus wants to check my heart. Told him it’s been broken since ’67 and it still works fine.', '[laugh] Heh! That Kit keeps trying to climb the bell tower. Reminds me of me. Terrifying.'],
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
    look: { fp: { w: 1.06, h: 0.93, jaw: 0, chin: -0.15, eye: 1.16, gap: 1.12, eyeY: -0.06, nose: 'snub', mouth: 0.9, lines: 0, cheeks: 0.75, ears: 1.15 }, eyeShape: 'round', brow: 1.05, browArch: 0.15, skin: 0xf2c8a2, hair: 0xa8602e, hairStyle: 'spiky', top: 0xe8703a, bottom: 0x4a6a9a, scale: 0.7, build: 0.9, torso: 0.8, legs: 0.76, eyes: 0x5a8a3a, head: 1.3, face: 'round', acc: ['freckles', 'bandage', 'satchel'], shoes: 0xd84a3a, backdrop: 'meadow' },
    walk: W(2.3, 0.75, 0.09, 0.05, -0.05, 0.75, true),
    home: 'birch_house',
    portraitBg: [0xf8e0a0, 0x9ac87a],
    schedule: [
      [6, 'door:birch_house', 'inside'],
      [8, 'door:schoolhouse', 'inside'],
      [10, 'school_yard', 'play'],
      [11, 'river_dock', 'fish'],
      // (r21: school's out for lunch — hopscotch on the square)
      [12, 'plaza_hop', 'play'],
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
    look: { fp: { w: 1.0, h: 1.0, jaw: 0.8, chin: 0.15, eye: 1.1, gap: 0.97, eyeY: -0.02, nose: 'long', mouth: 1.2, lines: 0.1, cheeks: 0.3, ears: 1.0, cleft: true }, eyeShape: 'round', brow: 1.3, browArch: 0.0, skin: 0xe8b890, hair: 0x4a2e1c, hairStyle: 'short', top: 0x3f7a4a, bottom: 0x3a4658, hat: 'beanie', hatColor: 0xd8a03a, beard: 'stubble', scale: 1.17, build: 1.06, shoulders: 1.26, torso: 1.3, hands: 1.2, head: 0.8, eyes: 0x6a4a2a, face: 'long', legs: 1.36, acc: ['toolbelt', 'pencil'], shoes: 0x5a3a24, backdrop: 'workshop' },
    walk: W(1.55, 0.55, 0.035, 0.09, 0.03, 0.4),
    home: 'birch_house',
    portraitBg: [0xd8e8c0, 0x7aa86a],
    schedule: [
      [6, 'door:birch_house', 'inside'],
      [7.5, 'lumber_yard', 'saw'],
      // (r21: a lunchtime chat at the fountain with Marigold — a knot of two, facing each other)
      [11.75, 'fountain_wn', 'chat'],
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
      { hours: [7, 12], lines: ['[happy] Measure twice, cut once. Measure three times if June’s watching.'] },
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
    wardrobe: { winter: { coat: 0x2e6a5e, scarf: 0xe0b04a, mittens: 0xc8573a } },
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
    look: { fp: { w: 1.04, h: 0.96, jaw: 0, chin: 0.1, eye: 0.8, gap: 1.08, nose: 'button', mouth: 0.84, lines: 0.9, cheeks: 1.0, ears: 1.0 }, eyeShape: 'round', brow: 0.65, browArch: 0.3, head: 0.94, skin: 0xe8b894, hair: 0xd8d4cc, hairStyle: 'bob', top: 0xa8587a, bottom: 0x4a3a4a, scarf: 0xf2e2c0, hat: 'sunhat', hatColor: 0xd6a85a, skirt: true, scale: 0.84, build: 1.08, belly: 0.3, torso: 0.9, legs: 0.84, shoulders: 0.9, eyes: 0x7a6a9a, face: 'round', acc: ['shawl', 'wrinkles', 'flower', 'trowel'], shoes: 0x6a4a3a, backdrop: 'garden' },
    walk: W(1.05, 0.34, 0.02, 0.07, 0.14, 0.22),
    home: 'cottage_east',
    portraitBg: [0xe8d8f0, 0xa88ab8],
    schedule: [
      [6, 'garden_east', 'water'],
      [9, 'planters_hall', 'water'],
      [10, 'allotment', 'water'],
      [11, 'market_flowers', 'chat'],
      // (r21: lunch at the fountain's rim with Odessa — a knot of two facing each other)
      [12, 'plaza_lunch', 'chat'],
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
      neutral: '[happy] Thank you, dear. You’re very kind to an old lady.',
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
        // (r12: beside the planter, side-on to the square — from the south mark she spoke to the rose
        // with her back to the lens and the director swung round between the Hall and the store,
        // looking down on her sun hat)
        cast: { hazel: [[30.15, 14.95], 'left'], player: [[31.95, 16.7], 'left'] },
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

// ───────────────────────────────────────────── r9: long-form arcs (memory, 6 / 8 / 10 hearts)
/**
 * r9 critic: "relationship choices collapse to immediate point deltas, the arcs end at two and four
 * hearts". Every heart-event choice now leaves a memory flag (`<npc>.<word>`, kept per farmer by
 * systems/relationships.ts, host-authoritative in co-op); the six-, eight- and ten-heart scenes below
 * quote those choices back (`if` / `unless` steps), the eight-heart scenes are invitations, and each
 * villager's `keeps` turn remembered choices into new barks, routines, talk lines and keepsakes left
 * in the town (systems/npcs.ts). Stagings reuse the audited marks / lenses of the earlier scenes.
 */
interface Stage {
  at: Place;
  face: Facing;
  player: [Place, Facing];
  camera: HeartEvent['camera'];
  sit?: boolean;
}
const STAGE: Record<string, Stage> = {
  store: { at: 'store_front', face: 'down', player: [[24.4, 22.4], 'left'], camera: { x: 22.6, z: 21.4, yaw: -6, pitch: 42, distance: 15 } },
  benchSW: { at: 'bench_sw', face: 'up', player: [[28.9, 27.7], 'left'], camera: { x: 27.9, z: 28.5, yaw: 155, pitch: 40, distance: 14 }, sit: true },
  fountainS: { at: 'fountain_s', face: 'up', player: [[33.9, 28.8], 'left'], camera: { x: 32.4, z: 24.6, yaw: 0, pitch: 40, distance: 18 } },
  bakery: { at: 'bakery_front', face: 'down', player: [[40.6, 22.4], 'right'], camera: { x: 42.4, z: 21.4, yaw: 4, pitch: 42, distance: 14 } },
  hallUp: { at: 'hall_steps', face: 'up', player: [[33.6, 17.6], 'up'], camera: { x: 32.4, z: 15.2, yaw: 0, pitch: 38, distance: 16 } },
  hallDown: { at: 'hall_steps', face: 'down', player: [[33.6, 17.3], 'left'], camera: { x: 32.4, z: 15.8, yaw: 0, pitch: 40, distance: 14 } },
  bridge: { at: 'bridge_mid', face: 'down', player: [[62.2, 26.4], 'right'], camera: { x: 63.6, z: 25.6, yaw: 4, pitch: 38, distance: 14 } },
  easel: { at: 'easel_river', face: 'right', player: [[59.15, 20.3], 'right'], camera: { x: 61.2, z: 23.4, yaw: 40, pitch: 40, distance: 15 } },
  forge: { at: 'forge_anvil', face: 'up', player: [[84.2, 22.2], 'up'], camera: { x: 83.6, z: 19.8, yaw: -8, pitch: 42, distance: 14 } },
  lantern: { at: [33.6, 14.6], face: 'left', player: [[31.0, 16.2], 'up'], camera: { x: 32.4, z: 13.8, yaw: 6, pitch: 36, distance: 15 } },
  lamp: { at: [33.5, 14.7], face: 'left', player: [[30.6, 16.4], 'up'], camera: { x: 32.0, z: 14.8, yaw: -4, pitch: 38, distance: 15 } },
  riverWalk: { at: 'river_walk', face: 'right', player: [[57.4, 31.6], 'right'], camera: { x: 59.0, z: 31.4, yaw: -4, pitch: 38, distance: 14 } },
  benchSE: { at: 'bench_se', face: 'down', player: [[35.2, 31.2], 'up'], camera: { x: 36.0, z: 29.8, yaw: 26, pitch: 38, distance: 13 }, sit: true },
  innNight: { at: [81.8, 30.4], face: 'up', player: [[79.4, 28.4], 'right'], camera: { x: 80.6, z: 29.6, yaw: 168, pitch: 42, distance: 12 } },
  dock: { at: 'river_dock', face: 'right', player: [[57.6, 35.6], 'right'], camera: { x: 59.4, z: 35.4, yaw: -6, pitch: 40, distance: 13 } },
  yard: { at: 'lumber_yard', face: 'up', player: [[88.4, 47.3], 'left'], camera: { x: 86.0, z: 46.4, yaw: -6, pitch: 40, distance: 14 } },
  planters: { at: [28.9, 16.4], face: 'up', player: [[30.7, 17.0], 'left'], camera: { x: 30.6, z: 14.8, yaw: -6, pitch: 40, distance: 13 } },
  checkup: { at: [35.05, 28.95], face: 'right', player: [[34.5, 30.8], 'right'], camera: { x: 36.0, z: 28.9, yaw: -160, pitch: 40, distance: 15 } },
  innFront: { at: 'inn_front', face: 'down', player: [[81.4, 27.4], 'down'], camera: { x: 79.4, z: 28.4, yaw: 180, pitch: 48, distance: 15 } },
  garden: { at: 'garden_east', face: 'up', player: [[47.0, 38.0], 'right'], camera: { x: 48.0, z: 36.4, yaw: 4, pitch: 40, distance: 13 } },
};

type ArcEvent = Omit<HeartEvent, 'cast' | 'camera'> & { stage: string; extra?: HeartEvent['cast'] };

function arc(npc: NpcId, e: ArcEvent): HeartEvent {
  const st = STAGE[e.stage]!;
  const { stage: _s, extra, ...rest } = e;
  const script = st.sit ? [{ act: npc, activity: 'sit' } as CutStep, { wait: 0.6 } as CutStep, ...rest.script] : rest.script;
  return { ...rest, script, cast: { [npc]: [st.at, st.face], player: st.player, ...(extra ?? {}) }, camera: st.camera };
}

/** Memory flags on the earlier scenes' answers, in option order. */
const OPTION_FLAGS: Record<string, string[]> = {
  'marigold-2': ['family', 'passing'],
  'marigold-4': ['pie', 'keep'],
  'bram-2': ['help', 'sleep'],
  'bram-4': ['sing', 'promise'],
  'wren-2': ['feels', 'soup'],
  'wren-4': ['run', 'window'],
  'odessa-2': ['squeak', 'why'],
  'odessa-4': ['withyou', 'proud'],
  'linus-2': ['orders', 'side'],
  'linus-4': ['burn', 'keep'],
  'june-2': ['fix', 'sit'],
  'june-4': ['follow', 'small'],
  'tobias-2': ['strike', 'see'],
  'tobias-4': ['glad', 'tea'],
  'kit-2': ['still', 'splash'],
  'kit-4': ['partners', 'tobias'],
  'rowan-2': ['brother', 'double'],
  'rowan-4': ['home', 'ask'],
  'hazel-2': ['waiting', 'fert'],
  'hazel-4': ['together', 'care'],
};

const ARCS: Record<NpcId, { events: ArcEvent[]; keeps: Consequence[] }> = {
  marigold: {
    events: [
      {
        id: 'marigold-6',
        hearts: 6,
        title: 'The Last Page',
        hours: [9, 17],
        dry: true,
        stage: 'store',
        props: [{ kind: 'ledger', at: [0, 0], hold: ['marigold', 'chest'], word: 'page' }],
        insert: [{ kind: 'ledger', word: 'page|underlined', caption: 'Your page — “one rhubarb pie, owed”' }],
        script: [
          { say: 'marigold', text: 'There you are. I’ve been minding your page — the one left at the back of Rosalind’s tab.', mood: 'happy' },
          { if: 'marigold.pie', say: 'marigold', text: '“One rhubarb pie, owed by the farmer.” I underlined it twice. Pip witnessed. With his paw.', mood: 'laugh' },
          { if: 'marigold.keep', say: 'marigold', text: 'You told me to keep it, so I did. I’ve written your name at the top of the last page anyway. Old habits.', mood: 'blush' },
          { say: 'marigold', text: 'Glimmerco’s man came back yesterday. Wanted the shop this time. Cash, today, no questions.', mood: 'angry' },
          { say: 'marigold', text: 'I asked him what he’d write in the ledger. He didn’t understand the question. That was my answer.', mood: 'thinking' },
          { emote: 'marigold', icon: 'dots' },
          {
            choice: 'marigold',
            q: 'Was I right, though? A shop’s only a shop, after all.',
            options: [
              { text: 'It’s the heart of the square.', reply: 'The heart of the square. Pip will be insufferable when he hears.', mood: 'happy', delta: 60, flag: 'marigold.heart' },
              { text: 'Take the money and rest.', reply: 'Rest! I’ll rest when the hall’s lit and the turnips sell themselves. …Thank you for worrying, though.', mood: 'worried', delta: 20, flag: 'marigold.rest' },
            ],
          },
          { emote: 'marigold', icon: 'heart' },
        ],
      },
      {
        id: 'marigold-8',
        hearts: 8,
        title: 'Supper at Thimble’s',
        hours: [17, 21],
        stage: 'benchSW',
        props: [{ kind: 'letter', at: [0, 0], hold: ['marigold', 'chest'], word: 'invitation' }],
        insert: [{ kind: 'invite', word: 'invitation|friday', caption: 'Supper at Thimble’s — Friday, after closing' }],
        script: [
          { face: 'marigold', to: 'player' },
          { say: 'marigold', text: 'I’ve done a dreadful thing. I’ve written you an invitation. On card. With a border.', mood: 'blush' },
          { say: 'marigold', text: 'Stew at the shop, Friday, after closing. Pip has agreed not to sit in your chair. He’s lying, of course.', mood: 'laugh' },
          { if: 'marigold.heart', say: 'marigold', text: 'You called the shop the heart of the square. I’ve not stopped thinking it since. Hearts need feeding.', mood: 'happy' },
          { if: 'marigold.rest', say: 'marigold', text: 'And no, I didn’t sell. I’m resting the way I like best: feeding people.', mood: 'happy' },
          { say: 'marigold', text: 'Your gran came every Friday for thirty years. That chair’s been empty a long while.', mood: 'wistful' },
          {
            choice: 'marigold',
            options: [
              { text: 'I’ll bring the rhubarb.', reply: 'Rhubarb! Then I’ll bring the custard and we’ll both pretend it was planned.', mood: 'laugh', delta: 80, flag: 'marigold.supper' },
              { text: 'Save me the chair by the stove.', reply: 'The warm one. Rosalind’s. …Yes. It’s yours. Pip can sulk.', mood: 'blush', delta: 80, flag: 'marigold.stove' },
            ],
          },
          { emote: 'marigold', icon: 'heart' },
        ],
      },
      {
        id: 'marigold-10',
        hearts: 10,
        title: 'Paid in Full',
        hours: [17, 21],
        stage: 'fountainS',
        insert: [{ kind: 'key', word: 'key', caption: 'The shop’s spare key — Rosalind had the other' }],
        script: [
          { say: 'marigold', text: 'I closed the tab today. Forty-one years of it. Rosalind’s and yours.', mood: 'wistful' },
          { say: 'marigold', text: 'Do you know what I wrote at the bottom? “Paid in full. In pie, in Fridays, in being here.”', mood: 'happy' },
          { if: 'marigold.family', say: 'marigold', text: 'Pip insisted his paw go on it too. You did call him family. He took it to heart.', mood: 'laugh' },
          { say: 'marigold', text: 'And this is the shop’s spare key. Rosalind had the other. It opens the back door and, apparently, me.', mood: 'blush' },
          {
            choice: 'marigold',
            options: [
              { text: 'I’ll take good care of it.', reply: 'I know, dear. You take care of everything. Even grumpy shopkeepers.', mood: 'happy', delta: 100, flag: 'marigold.key' },
              { text: 'You’re family too, you know.', reply: '…Oh, now look. I said I wouldn’t cry at the fountain. Everyone can see.', mood: 'sad', delta: 100, flag: 'marigold.kin' },
            ],
          },
          { emote: 'marigold', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'marigold.pie', barks: ['Rhubarb’s in, dear!'], routine: [15.5, 17, 'bench_sw', 'sit'], line: '[laugh] Your page in the tab still says “one rhubarb pie, owed.” I check it daily. For accuracy.', keepsake: { kind: 'pie', spot: 'easel_plaza', dx: 0.3, dz: 0.97, y: 0.47, label: 'A rhubarb pie cooling on the bench by the shop' } },
      { flag: 'marigold.family', barks: ['Pip asked after you.'], keepsake: { kind: 'cat', spot: 'store_front', dx: 1.3, dz: -0.9, y: 0.32, rot: 0.6, label: 'Pip, asleep on the shop step' } },
      { flag: 'marigold.heart', barks: ['Heart of the square, me!'], hours: [9, 12], line: '[happy] The Glimmerco man sent a letter. I used it to light the stove. Heart of the square, you said. Hearths need kindling.' },
      { flag: 'marigold.supper', barks: ['Friday. Stew. Don’t be late.'], keepsake: { kind: 'notice', spot: 'notice', label: 'Marigold’s Friday-supper card' }, hours: [17, 21], line: '[blush] Friday’s stew is on. I’ve put out the good bowls. Well. The less chipped bowls.' },
    ],
  },

  bram: {
    events: [
      {
        id: 'bram-6',
        hearts: 6,
        title: 'The Farmer’s Loaf',
        hours: [6, 12],
        dry: true,
        stage: 'bakery',
        insert: [{ kind: 'bread', word: 'farmer’s loaf|named a loaf', caption: 'The Farmer’s Loaf — lumpy, golden, named' }],
        script: [
          { if: 'bram.help', say: 'bram', text: 'My co-kneader! I’ve named a loaf after you. Don’t look so pleased, it’s a lumpy one.', mood: 'laugh' },
          { if: 'bram.sleep', say: 'bram', text: 'I took your advice. Eight whole hours. The dough rose without me. Humbling. And I named a loaf after you.', mood: 'surprised' },
          { say: 'bram', text: 'The Farmer’s Loaf: your wheat, my starter, and a pinch of whatever Hazel says is “just thyme, dear.”', mood: 'happy' },
          { say: 'bram', text: 'Glimmerco sells bread in plastic in the city. Plastic! It doesn’t smell of anything.', mood: 'angry' },
          { say: 'bram', text: 'Bread should smell like somebody got up early for you. That’s the whole recipe.', mood: 'thinking' },
          {
            choice: 'bram',
            q: 'Well? First slice is yours. Verdict?',
            options: [
              { text: 'It tastes like home.', reply: 'Home. HA! Write that on the board. No — I’ll do it, your chalk’s a disgrace.', mood: 'laugh', delta: 60, flag: 'bram.home' },
              { text: 'It needs a song while it bakes.', reply: 'Everything needs a song while it bakes. Even you, I suspect.', mood: 'happy', delta: 50, flag: 'bram.song' },
            ],
          },
          { emote: 'bram', icon: 'music' },
        ],
      },
      {
        id: 'bram-8',
        hearts: 8,
        title: 'The Low Part',
        hours: [19, 24],
        stage: 'hallUp',
        insert: [{ kind: 'invite', word: 'choir|tuesdays', caption: 'Choir — Tuesdays, back of the bakery. Bring a bun.' }],
        script: [
          { if: 'bram.sing', say: 'bram', text: 'I’ve been practising the low part. You were right — it’s better with two terrible singers.', mood: 'laugh' },
          { if: 'bram.promise', say: 'bram', text: 'You promised me the hall. I don’t hold you to promises. I hold you to bread. …But I have been counting.', mood: 'thinking' },
          { say: 'bram', text: 'When it lights, there should be a song. Mother always said the hall remembers. Let’s give it something worth remembering.', mood: 'happy' },
          { say: 'bram', text: 'Choir’s on Tuesdays, back of the bakery. Bring a voice. Bring a bun. Bring both.', mood: 'happy' },
          {
            choice: 'bram',
            options: [
              { text: 'Count me in.', reply: 'Then you’re a bass. Everyone’s a bass in my choir. It’s easier.', mood: 'laugh', delta: 80, flag: 'bram.choir' },
              { text: 'I’ll come and listen.', reply: 'Every choir needs one person who claps. You’re hired.', mood: 'happy', delta: 60, flag: 'bram.listen' },
            ],
          },
          { emote: 'bram', icon: 'music' },
        ],
      },
      {
        id: 'bram-10',
        hearts: 10,
        title: 'Mother’s Honey Cake',
        hours: [17, 22],
        stage: 'bridge',
        insert: [{ kind: 'recipe', word: 'card|recipe', caption: 'Honey cake — in his mother’s hand, flour on the corner' }],
        script: [
          { say: 'bram', text: 'This card’s been in my apron twenty years. Mother’s honey cake. I never baked it. Couldn’t make it taste like hers.', mood: 'wistful' },
          { say: 'bram', text: 'Last night I baked it for you. It didn’t taste like hers. It tasted like now. That’s… better, maybe.', mood: 'sad' },
          { if: 'bram.choir', say: 'bram', text: 'Same as the choir. Never sounds the way it did. Sounds like us.', mood: 'happy' },
          { say: 'bram', text: 'Keep the card. Recipes are meant to travel. Just send it back one day with crumbs on it.', mood: 'blush' },
          {
            choice: 'bram',
            options: [
              { text: 'I’ll bake it every spring.', reply: 'Every spring. Then she’ll be in the valley every spring. …Flour in my eye. Don’t look.', mood: 'sad', delta: 100, flag: 'bram.recipe' },
              { text: 'Only if we bake it together.', reply: 'Together! Then I get to criticise your folding. Best day of my life.', mood: 'laugh', delta: 100, flag: 'bram.together' },
            ],
          },
          { emote: 'bram', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'bram.help', barks: ['Farmer’s Loaf, fresh!'], hours: [6, 11], line: '[laugh] The Farmer’s Loaf sold out by nine. Folk asked who the farmer was. I said “lumpy, like the bread.”' },
      { flag: 'bram.sing', barks: ['♪ The low part, hum it! ♪'], routine: [19.5, 21, 'hall_steps', 'idle'] },
      { flag: 'bram.choir', barks: ['Choir Tuesday. Bass!'], keepsake: { kind: 'notice', spot: 'notice', label: 'Bram’s choir card on the board' }, line: '[happy] Tuesday’s choir had eleven people. ELEVEN. Linus sang alto, out of spite.' },
      { flag: 'bram.recipe', keepsake: { kind: 'cake', spot: 'cafe', dx: 0.2, dz: -0.25, y: 0.76, label: 'A honey cake on the café table' } },
    ],
  },

  wren: {
    events: [
      {
        id: 'wren-6',
        hearts: 6,
        title: 'The Gallery Letter',
        hours: [8, 18],
        dry: true,
        stage: 'easel',
        props: [{ kind: 'letter', at: [0, 0], hold: ['wren', 'chest'], word: 'gallery' }],
        insert: [{ kind: 'letter', word: 'gallery|wall', caption: '“A whole wall. Paint where you’re from.”' }],
        script: [
          { if: 'wren.feels', say: 'wren', text: 'I sent the river to a gallery in the city. Under your title. “How a River Feels.”', mood: 'blush' },
          { if: 'wren.soup', say: 'wren', text: 'I entered Soup River in the city show. As a joke. It won second prize. I am FURIOUS. And thrilled.', mood: 'laugh' },
          { say: 'wren', text: 'They wrote back. They want a whole wall. They said, “paint where you’re from.”', mood: 'surprised' },
          { say: 'wren', text: 'Which is funny. I always thought I was from somewhere else. Somewhere with better light.', mood: 'thinking' },
          {
            choice: 'wren',
            options: [
              { text: 'Paint Hearthvale.', reply: 'Hearthvale. Bram mid-sneeze. The bridge. The dark hall. …Oh no. I love it here, don’t I.', mood: 'happy', delta: 60, flag: 'wren.home' },
              { text: 'Go and see the city first.', reply: 'Brave of you, saying that. Braver of me if I go. …I might.', mood: 'worried', delta: 40, flag: 'wren.city' },
            ],
          },
          { emote: 'wren', icon: 'idea' },
        ],
      },
      {
        id: 'wren-8',
        hearts: 8,
        title: 'Sitting for Wren',
        hours: [17, 22],
        stage: 'fountainS',
        insert: [{ kind: 'invite', word: 'studio|sitting', caption: 'Wren’s studio — Sunday sitting, bring patience' }],
        script: [
          { say: 'wren', text: 'Hold still. No — stiller. You’re worse than the river.', mood: 'laugh' },
          { if: 'wren.home', say: 'wren', text: 'The wall is Hearthvale. The square, the bridge, Bram mid-sneeze. And one space left in the middle.', mood: 'happy' },
          { if: 'wren.city', say: 'wren', text: 'I went. The city was loud and lovely and every window was lit. I missed the dark one on the hill.', mood: 'wistful' },
          { say: 'wren', text: 'The space is for you. Come to the studio on Sunday for a sitting. Not because you’re important. Because you’re… everywhere I look lately.', mood: 'blush' },
          {
            choice: 'wren',
            options: [
              { text: 'Paint me with the farm.', reply: 'With the cows? Cows are hard. Fine. FINE. For you, cows.', mood: 'laugh', delta: 80, flag: 'wren.farm' },
              { text: 'Paint us both.', reply: 'Both. In the same frame. …I’ll need a bigger canvas. And a minute.', mood: 'blush', delta: 80, flag: 'wren.both' },
            ],
          },
          { emote: 'wren', icon: 'heart' },
        ],
      },
      {
        id: 'wren-10',
        hearts: 10,
        title: 'The Hall, in Colour',
        hours: [18, 23],
        stage: 'hallDown',
        props: [{ kind: 'painting', at: [31.0, 15.9], rot: 0.35, scale: 1.1, word: 'painting' }],
        insert: [{ kind: 'colourhall', word: 'painting|grey', caption: 'The first painting of the hall that isn’t grey' }],
        script: [
          { say: 'wren', text: 'I did it. The first painting of the hall that isn’t grey.', mood: 'surprised' },
          { say: 'wren', text: 'I didn’t wait for it to be lit. I painted it the way you talk about it. Turns out that was the light.', mood: 'happy' },
          { if: 'wren.both', say: 'wren', text: 'That’s us on the steps. You’re holding the lantern. I gave myself better hair. Artistic licence.', mood: 'laugh' },
          { say: 'wren', text: 'It’s yours. Hang it somewhere it can see the real one.', mood: 'blush' },
          {
            choice: 'wren',
            options: [
              { text: 'Over my fireplace.', reply: 'By the fire. Where it’s warm. …Yes. That’s exactly right.', mood: 'happy', delta: 100, flag: 'wren.hearth' },
              { text: 'In the hall, when it opens.', reply: 'In the HALL? Where everyone — oh. Oh, I’m going to be sick. Happily.', mood: 'surprised', delta: 100, flag: 'wren.hall' },
            ],
          },
          { emote: 'wren', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'wren.feels', barks: ['How does a river feel?'], keepsake: { kind: 'painting', spot: 'easel_river', dx: 0.55, dz: -0.35, y: 0.02, rot: 0.9, label: '“How a River Feels”, drying by the water' } },
      { flag: 'wren.home', barks: ['Hold still, Bram!'], routine: [8, 12, 'easel_river', 'paint'], line: '[happy] Three paintings of the square this week. The wall’s filling up. Hearthvale keeps posing for me.' },
      { flag: 'wren.city', line: '[wistful] The city sent another letter. I keep it under the soup-river painting. Both are reminders.' },
      { flag: 'wren.both', barks: ['Sunday. Sitting. Still!'] },
    ],
  },

  odessa: {
    events: [
      {
        id: 'odessa-6',
        hearts: 6,
        title: 'No Squeak',
        hours: [8, 18],
        dry: true,
        stage: 'forge',
        props: [{ kind: 'sparks', at: [0, 0], near: ['odessa', 0.2, 0.7] }],
        insert: [{ kind: 'hinge', word: 'hinge|squeak', caption: 'The hall hinge — new pin, oiled, silent' }],
        script: [
          { say: 'odessa', text: 'Finished it. The hinge. Listen — no squeak.', mood: 'happy' },
          { if: 'odessa.squeak', say: 'odessa', text: 'You were the first to hear it squeak. You should be the first to hear it NOT.', mood: 'laugh' },
          { if: 'odessa.why', say: 'odessa', text: 'You asked why fix a dark hall. I’ve thought about it every night since. Because I’m stubborn. And because of you.', mood: 'thinking' },
          { say: 'odessa', text: 'Nine years of making things nobody needed yet. Hinges, brackets, a weathervane for a roof with no hall under it.', mood: 'sad' },
          {
            choice: 'odessa',
            options: [
              { text: 'They’ll all be needed soon.', reply: 'Soon. Hm. You say it like you mean it. Fine. I’ll keep hammering.', mood: 'happy', delta: 60, flag: 'odessa.soon' },
              { text: 'Make something just for you.', reply: 'For ME? …Never thought of it. Rude of you to make me think now.', mood: 'surprised', delta: 60, flag: 'odessa.self' },
            ],
          },
          { emote: 'odessa', icon: 'idea' },
        ],
      },
      {
        id: 'odessa-8',
        hearts: 8,
        title: 'Night Rounds',
        hours: [20, 25],
        stage: 'lantern',
        props: [{ kind: 'cage', at: [0, 0], hold: ['odessa', 'hand'], word: 'cage' }],
        insert: [{ kind: 'invite', word: 'workshop|inspection', caption: 'Grandfather’s workshop — Sunday. Wear boots.' }],
        script: [
          { if: 'odessa.withyou', say: 'odessa', text: 'You came. Again. That’s forty-one nights. I’ve been counting on the cage, in chalk.', mood: 'blush' },
          { if: 'odessa.proud', say: 'odessa', text: 'I asked Tobias if grandfather would’ve been proud. He said, “Of the rivets? No. Of you? Daft question.”', mood: 'laugh' },
          { say: 'odessa', text: 'I want to show you his old workshop, up the hill. Nobody’s been in since he died.', mood: 'thinking' },
          { say: 'odessa', text: 'It’s not a date. It’s an inspection. Sunday. Wear boots.', mood: 'angry' },
          {
            choice: 'odessa',
            options: [
              { text: 'Boots on. It’s a date.', reply: 'It’s an INSPECTION. …With a picnic. Shut up.', mood: 'blush', delta: 80, flag: 'odessa.date' },
              { text: 'An inspection it is.', reply: 'Good. Someone in this town takes metalwork seriously.', mood: 'happy', delta: 60, flag: 'odessa.inspect' },
            ],
          },
          { emote: 'odessa', icon: 'heart' },
        ],
      },
      {
        id: 'odessa-10',
        hearts: 10,
        title: 'Two Rivets',
        hours: [17, 22],
        stage: 'bridge',
        insert: [{ kind: 'hook', word: 'hook|rivets', caption: 'A lantern hook — two rivets, his and hers' }],
        script: [
          { say: 'odessa', text: 'Made this. A lantern hook for your porch. Two rivets — one his pattern, one mine.', mood: 'blush' },
          { say: 'odessa', text: 'So there’s a light at your end too. So I can see it from the forge at night.', mood: 'happy' },
          { if: 'odessa.self', say: 'odessa', text: 'You told me to make something for me. Turns out it was this. Something for you to have.', mood: 'wistful' },
          {
            choice: 'odessa',
            options: [
              { text: 'I’ll light it every night.', reply: 'Every night is a lot of nights, farmer. …Good.', mood: 'happy', delta: 100, flag: 'odessa.light' },
              { text: 'Come and light it with me.', reply: '…Bring tea. And a coat. And — fine. Yes.', mood: 'blush', delta: 100, flag: 'odessa.together' },
            ],
          },
          { emote: 'odessa', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'odessa.withyou', barks: ['Rounds at nine. Coat.'], routine: [20.5, 22, 'hall_lantern', 'idle'], keepsake: { kind: 'cage', spot: 'hall_lantern', dx: 0.5, dz: 0.55, y: 0.0, label: 'Her grandfather’s lantern cage, on the hall step' } },
      { flag: 'odessa.squeak', barks: ['No squeak. Told you.'] },
      { flag: 'odessa.self', line: '[blush] I made a ring for my own hand. Plain iron. First thing I’ve ever made for me. It fits. Don’t make it a thing.' },
      { flag: 'odessa.date', barks: ['It was an INSPECTION.'] },
    ],
  },

  linus: {
    events: [
      {
        id: 'linus-6',
        hearts: 6,
        title: 'A Second Opinion',
        hours: [9, 17],
        dry: true,
        stage: 'checkup',
        extra: { tobias: ['bench_se', 'down'] },
        script: [
          { act: 'tobias', activity: 'sit' },
          { face: 'linus', to: 'tobias' },
          { say: 'linus', text: 'Tobias insists on a second opinion. On MY health, this time. Apparently I “look peaky.”', mood: 'thinking' },
          { say: 'tobias', text: 'Peaky as a heron. Tell him, young one.', mood: 'laugh' },
          { if: 'linus.burn', say: 'linus', text: 'I burned the letter, you know. Odessa made a ceremony of it. I haven’t slept so well in nineteen years.', mood: 'happy' },
          { if: 'linus.keep', say: 'linus', text: 'I reread the letter this spring and laughed out loud. I chose this. I’d choose it again. Even the biscuits.', mood: 'happy' },
          { say: 'linus', text: 'But Hearthvale has exactly one doctor, and he is, I concede, a little peaky.', mood: 'worried' },
          {
            choice: 'linus',
            options: [
              { text: 'Teach me first aid.', reply: 'A volunteer! Splendid. Lesson one: never let Kit near the iodine.', mood: 'laugh', delta: 60, flag: 'linus.teach' },
              { text: 'Take a day off. Go fishing.', reply: 'Fishing. A doctor, idle by a river. …Prescribed by a farmer. How irregular. Yes.', mood: 'surprised', delta: 60, flag: 'linus.rest' },
            ],
          },
          { emote: 'tobias', icon: 'music' },
        ],
      },
      {
        id: 'linus-8',
        hearts: 8,
        title: 'Open Evening',
        hours: [18, 23],
        stage: 'riverWalk',
        props: [{ kind: 'letter', at: [0, 0], hold: ['linus', 'chest'], word: 'thursday' }],
        insert: [{ kind: 'invite', word: 'thursday|open evening', caption: 'Clinic open evening — Thursday. Tea and blood pressure.' }],
        script: [
          { say: 'linus', text: 'An evening walk. My prescription for myself, which I ignored for a decade.', mood: 'happy' },
          { if: 'linus.teach', say: 'linus', text: 'You bandaged Kit’s knee on Tuesday. Textbook. He said it didn’t hurt. A lie, but a kind one.', mood: 'laugh' },
          { if: 'linus.rest', say: 'linus', text: 'I went fishing. Caught nothing. Best day of the year. Don’t tell my patients.', mood: 'laugh' },
          { say: 'linus', text: 'There’s a clinic open evening on Thursday. Tea and blood pressure. I’d like a familiar face at the door.', mood: 'blush' },
          {
            choice: 'linus',
            options: [
              { text: 'I’ll pour the tea.', reply: 'Weak for Hazel, strong for Odessa, decaf for Bram whatever he says.', mood: 'happy', delta: 80, flag: 'linus.tea' },
              { text: 'I’ll bring Tobias. By force.', reply: 'Ha! Doctor’s orders. I didn’t hear that. I fully endorse it.', mood: 'laugh', delta: 80, flag: 'linus.force' },
            ],
          },
          { emote: 'linus', icon: 'heart' },
        ],
      },
      {
        id: 'linus-10',
        hearts: 10,
        title: 'A Prescription',
        hours: [10, 17],
        stage: 'fountainS',
        insert: [{ kind: 'letter', word: 'prescription|daily', caption: '“ONE FRIEND. TAKE DAILY. NO SIDE EFFECTS.”' }],
        script: [
          { say: 'linus', text: 'I’ve written you a prescription. Read it, please. My handwriting is famously illegible, but I tried.', mood: 'neutral' },
          { narrate: 'In careful doctor’s capitals: “ONE FRIEND. TAKE DAILY. NO KNOWN SIDE EFFECTS.”' },
          { say: 'linus', text: 'Nineteen years in Hearthvale and I treated everybody but myself. You turned out to be the cure. Annoyingly.', mood: 'blush' },
          { if: 'linus.burn', say: 'linus', text: 'The letter’s ashes are under the clinic rosebush. Hazel says it’s the best soil in town.', mood: 'laugh' },
          {
            choice: 'linus',
            options: [
              { text: 'Refills forever.', reply: 'Forever is not a dosage. …I’ll allow it.', mood: 'happy', delta: 100, flag: 'linus.refill' },
              { text: 'Doctor’s orders.', reply: 'Using my own line against me. Insufferable. I’m very fond of you.', mood: 'laugh', delta: 100, flag: 'linus.orders' },
            ],
          },
          { emote: 'linus', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'linus.rest', barks: ['Gone fishing. Doctor’s orders.'], routine: [16, 18, 'river_dock', 'fish'] },
      { flag: 'linus.burn', barks: ['Slept nine hours!'], line: '[happy] Nineteen years of spring rituals and this year I simply… gardened. Hazel was appalled at my pruning.' },
      { flag: 'linus.tea', keepsake: { kind: 'notice', spot: 'notice', label: 'The clinic’s open-evening card on the notice board' } },
      { flag: 'linus.teach', barks: ['Never the iodine, Kit!'] },
    ],
  },

  june: {
    events: [
      {
        id: 'june-6',
        hearts: 6,
        title: 'The Mended Chair',
        hours: [17, 24],
        stage: 'innNight',
        insert: [{ kind: 'chair', word: 'chair', caption: '“Do not lean. This means you, Rowan.”' }],
        script: [
          { if: 'june.fix', say: 'june', text: 'Look at it! Rowan mended the chair. Oak legs, brass feet. He even carved a warning on the back.', mood: 'laugh' },
          { if: 'june.sit', say: 'june', text: 'You never did sit on him. He mended the chair anyway — I think he was scared you might.', mood: 'laugh' },
          { say: 'june', text: '“Do not lean. This means you, Rowan.” He leaned on it the same night. Quality control, he says.', mood: 'laugh' },
          { say: 'june', text: 'The inn’s been full every Friday since the square came back to life. Folk say it’s the farm that brings them.', mood: 'happy' },
          { say: 'june', text: 'I could use a hand behind the bar on festival nights. Paid in stew and gossip.', mood: 'thinking' },
          {
            choice: 'june',
            options: [
              { text: 'I’ll pour.', reply: 'Brilliant. Rule one: Bram’s tab stays open. Rule two: Rowan’s doesn’t.', mood: 'laugh', delta: 60, flag: 'june.pour' },
              { text: 'I’ll bring the gossip.', reply: 'Oh, you’re dangerous. Sit by the fire and tell me everything.', mood: 'happy', delta: 60, flag: 'june.gossip' },
            ],
          },
          { emote: 'june', icon: 'heart' },
        ],
      },
      {
        id: 'june-8',
        hearts: 8,
        title: 'Dad’s Window',
        hours: [21, 26],
        stage: 'innNight',
        props: [{ kind: 'candle', at: [82.9, 31.7], y: 1.02, word: 'candle' }],
        insert: [{ kind: 'candle', word: 'candle|window', caption: 'A second candle, upstairs — the farm side' }],
        script: [
          { say: 'june', text: 'Sit with me while it burns down. I want to tell you about Dad.', mood: 'wistful' },
          { say: 'june', text: 'He lit the first window and Tobias lit the hall. Between them the whole hill glowed. You could find the inn from the farm in a blizzard.', mood: 'happy' },
          { if: 'june.follow', say: 'june', text: 'You said you follow it home. So I’ve put a second candle in the upstairs window. Your side.', mood: 'blush' },
          { if: 'june.small', say: 'june', text: 'Small lights count, you said. I’ve been counting them. Fourteen windows lit on the square now. Fourteen!', mood: 'surprised' },
          { say: 'june', text: 'Come for supper on the longest night. Just us and the regulars. I’ll save the mended chair.', mood: 'happy' },
          {
            choice: 'june',
            options: [
              { text: 'I’ll light one at the farm too.', reply: 'Then there’ll be two ends to the road. Dad would’ve liked that.', mood: 'happy', delta: 80, flag: 'june.farmlight' },
              { text: 'Your dad would love this.', reply: 'He would. He’d also overcharge you for the soup. Some traditions I’ve dropped.', mood: 'laugh', delta: 80, flag: 'june.dad' },
            ],
          },
          { emote: 'june', icon: 'heart' },
        ],
      },
      {
        id: 'june-10',
        hearts: 10,
        title: 'Last Orders',
        hours: [19, 23],
        stage: 'fountainS',
        insert: [{ kind: 'key', word: 'key', caption: 'The inn’s back-door key — only for family' }],
        script: [
          { say: 'june', text: 'Closed early. First time in eleven years. Don’t tell anyone. Especially Rowan.', mood: 'laugh' },
          { say: 'june', text: 'I always thought the inn was Dad’s and I was minding it. It isn’t. It’s mine. And your mug’s on the hook now.', mood: 'happy' },
          { if: 'june.pour', say: 'june', text: 'Hearthvale’s finest bar-hand. You still pour like you’re watering turnips.', mood: 'laugh' },
          { say: 'june', text: 'This is for you. The back-door key. Folk only get one of these when they’re family.', mood: 'blush' },
          {
            choice: 'june',
            options: [
              { text: 'I’ll come for last orders every night.', reply: 'Every night. I’ll hold you to it, pet. I hold everyone to it.', mood: 'happy', delta: 100, flag: 'june.nightly' },
              { text: 'I’ll mind the candle when you can’t.', reply: '…That’s the kindest thing anyone’s said to me in this square. Off you go before I cry in public.', mood: 'sad', delta: 100, flag: 'june.candle' },
            ],
          },
          { emote: 'june', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'june.fix', barks: ['Chair’s holding, Rowan!'], keepsake: { kind: 'chair', spot: 'inn_tables', dx: 0.9, dz: 0.6, y: 0, rot: 2.4, label: 'Rowan’s mended chair, “Do not lean”' } },
      { flag: 'june.follow', barks: ['Two candles tonight.'], keepsake: { kind: 'candle', spot: 'inn_front', dx: 1.2, dz: -0.5, y: 0.05, label: 'A second candle on the inn step' } },
      { flag: 'june.pour', routine: [17, 19, 'inn_tables', 'idle'], line: '[laugh] Festival night’s coming. I’ve ironed your apron. Don’t make that face, it’s a lovely apron.' },
      { flag: 'june.small', line: '[happy] Fifteen windows now. Marigold lit one just to beat Bram. Small lights, pet. You started it.' },
    ],
  },

  tobias: {
    events: [
      {
        id: 'tobias-6',
        hearts: 6,
        title: 'Thirty-One Rungs',
        hours: [18, 21],
        stage: 'lamp',
        insert: [{ kind: 'match', word: 'match', caption: 'The last match in the last box' }],
        script: [
          { say: 'tobias', text: 'Oiled the old ladder. Thirty-one rungs. Counted them again with these knees. They argued.', mood: 'laugh' },
          { if: 'tobias.strike', say: 'tobias', text: 'You said you’d hold the bottom. I’m holding you to it. My match, your hands. That’s the deal.', mood: 'happy' },
          { if: 'tobias.see', say: 'tobias', text: 'You wanted to see the match. Look, then. It’s only a match. It’s also the last thing she watched me light.', mood: 'wistful' },
          { say: 'tobias', text: 'Rosalind used to stand just there with a flask, shouting “Left, you old fool, LEFT.”', mood: 'laugh' },
          {
            choice: 'tobias',
            options: [
              { text: 'Left, you old fool.', reply: 'HA! That’s it. That’s the exact voice. Oh, she’d have liked you.', mood: 'laugh', delta: 60, flag: 'tobias.left' },
              { text: 'Teach me the route.', reply: 'The route? Hall, fountain, shop, bridge, inn. Bow to June. Ignore Bram’s singing. Lesson over.', mood: 'happy', delta: 60, flag: 'tobias.route' },
            ],
          },
          { emote: 'tobias', icon: 'music' },
        ],
      },
      {
        id: 'tobias-8',
        hearts: 8,
        title: 'Fifty Years Tomorrow',
        hours: [10, 17],
        stage: 'benchSW',
        // (r13 critic: the tea line played with no cup in anyone's hand)
        props: [{ kind: 'teacup', at: [0, 0], hold: ['tobias', 'cup'], word: 'sugars|tea' }],
        insert: [{ kind: 'invite', word: 'sunset|tomorrow', caption: 'The hall, at sunset — no speeches, just company' }],
        script: [
          { if: 'tobias.tea', say: 'tobias', text: 'Two sugars. You remembered. She always forgot the second one — on purpose, so I’d have something to grumble about.', mood: 'happy' },
          { if: 'tobias.glad', say: 'tobias', text: 'You said you were glad I waited. I’ve been chewing that like a toffee. Glad. Fancy.', mood: 'happy' },
          { say: 'tobias', text: 'Fifty years ago tomorrow I lit my first lamp. I’d like you at the hall at sunset. No speeches. Just company.', mood: 'thinking' },
          {
            choice: 'tobias',
            options: [
              { text: 'I’ll bring the flask.', reply: 'Flask. Good. Not the cheap stuff. Well — the cheap stuff is fine.', mood: 'laugh', delta: 80, flag: 'tobias.flask' },
              { text: 'And I’ll shout “left”.', reply: 'You will, won’t you. Heh. Fifty years and still taking directions.', mood: 'happy', delta: 80, flag: 'tobias.shout' },
            ],
          },
          { emote: 'tobias', icon: 'heart' },
        ],
      },
      {
        id: 'tobias-10',
        hearts: 10,
        title: 'The Lamplighter’s Pole',
        hours: [18, 22],
        stage: 'hallUp',
        insert: [{ kind: 'match', word: 'pole|hook', caption: 'Four generations of grip, worn into the hook' }],
        script: [
          { say: 'tobias', text: 'This pole’s been in my family four generations. The hook’s worn to the shape of my grandfather’s hand.', mood: 'wistful' },
          { say: 'tobias', text: 'I’d like it to wear to yours now. Somebody ought to walk the square at dusk. Might as well be someone it likes.', mood: 'happy' },
          { if: 'tobias.route', say: 'tobias', text: 'You know the route. Hall, fountain, shop, bridge, inn. Bow to June.', mood: 'laugh' },
          { if: 'tobias.left', say: 'tobias', text: 'And when you reach the hall lamp, you lean LEFT. Somebody told me that once. Loudly.', mood: 'laugh' },
          {
            choice: 'tobias',
            options: [
              { text: 'I’ll walk it every dusk.', reply: 'Then the square’s in good hands. Better than mine. Don’t tell anyone I said so.', mood: 'happy', delta: 100, flag: 'tobias.dusk' },
              { text: 'We’ll walk it together.', reply: 'Together. Slowly. With a flask. …Aye. Aye, I’d like that.', mood: 'sad', delta: 100, flag: 'tobias.together' },
            ],
          },
          { emote: 'tobias', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'tobias.tea', barks: ['Two sugars, mind.'], routine: [10, 11.5, 'bench_se', 'sit'], line: '[happy] Tea at ten on her bench. Two sugars. You’re a bad influence, young one. Keep it up.' },
      { flag: 'tobias.strike', barks: ['Hold the bottom, mind!'] },
      { flag: 'tobias.route', barks: ['Left, you old fool!'], routine: [18.5, 19.5, 'hall_lantern', 'idle'] },
      { flag: 'tobias.flask', line: '[laugh] Fifty years and one flask. Best anniversary a lamp ever had.' },
    ],
  },

  kit: {
    events: [
      {
        id: 'kit-6',
        hearts: 6,
        title: 'Sir Ribbington’s Moat',
        hours: [10, 17],
        dry: true,
        stage: 'dock',
        insert: [{ kind: 'frog', word: 'castle|moat', caption: 'Sir Ribbington’s castle (mostly moat)' }],
        script: [
          { if: 'kit.still', say: 'kit', text: 'I sat still for a WHOLE MINUTE yesterday. Sir Ribbington sat on my shoe. Best day of my LIFE.', mood: 'surprised' },
          { if: 'kit.splash', say: 'kit', text: 'Rowan banned us from splashing. For life. He said it in his serious voice. The one with eyebrows.', mood: 'worried' },
          { say: 'kit', text: 'I made Sir Ribbington a castle. Out of pebbles. It has a moat. He lives in the moat, mostly.', mood: 'happy' },
          { say: 'kit', text: 'Rowan says maybe we’re moving to the city. Do cities have frogs? Do they have YOU?', mood: 'sad' },
          {
            choice: 'kit',
            options: [
              { text: 'Hearthvale needs you.', reply: 'It DOES. Who else would guard the moat? Nobody. That’s who.', mood: 'happy', delta: 60, flag: 'kit.stay' },
              { text: 'Frogs live everywhere. So do friends.', reply: 'Everywhere? …Okay. That’s a bit less scary. Only a bit.', mood: 'thinking', delta: 60, flag: 'kit.brave' },
            ],
          },
          { emote: 'kit', icon: 'exclaim' },
        ],
      },
      {
        id: 'kit-8',
        hearts: 8,
        title: 'Under the Steps',
        hours: [14, 18],
        stage: 'hallDown',
        props: [{ kind: 'map', at: [0, 0], hold: ['kit', 'chest'], word: 'x|map' }],
        insert: [{ kind: 'map', word: 'the x|note', caption: '“For whoever lights it next.”' }],
        script: [
          { if: 'kit.partners', say: 'kit', text: 'PARTNER. Secret handshake first. Spin, clap, frog noise. Okay. Now.', mood: 'laugh' },
          { if: 'kit.tobias', say: 'kit', text: 'I showed Mr. Reed the map. He cried a bit. He said it was dust. It wasn’t dust.', mood: 'worried' },
          { say: 'kit', text: 'I found it! The X! Under the hall steps! A box of old wicks and a note.', mood: 'surprised' },
          { say: 'kit', text: 'The note says “for whoever lights it next.” That’s YOU. Or me. Or us. It’s us.', mood: 'happy' },
          { say: 'kit', text: 'Club meeting Saturday at the dock. You’re invited. You’re the only one invited. Bring snacks.', mood: 'happy' },
          {
            choice: 'kit',
            options: [
              { text: 'We’ll give the wicks to Tobias.', reply: 'Yeah. He’ll do the cry-dust thing again. That’s okay.', mood: 'happy', delta: 80, flag: 'kit.give' },
              { text: 'We’ll keep them for the big night.', reply: 'Secret wicks. For the BIG night. This is the best club ever.', mood: 'laugh', delta: 80, flag: 'kit.keepwicks' },
            ],
          },
          { emote: 'kit', icon: 'heart' },
        ],
      },
      {
        id: 'kit-10',
        hearts: 10,
        title: 'Forever Member',
        hours: [10, 17],
        stage: 'planters',
        insert: [{ kind: 'badge', word: 'badge|forever', caption: 'FOREVER MEMBER (spelled right, Rowan checked)' }],
        script: [
          // (r12: the club rules are read OUT to the member — Kit turns from the planter first)
          { face: 'kit', to: 'player' },
          { say: 'kit', text: 'I wrote the club rules. Rule one: no grown-ups. Rule two: except you. Rule three: frogs are honorary.', mood: 'happy' },
          { if: 'rowan.home', say: 'kit', text: 'Rowan says we’re STAYING. He said it at breakfast all serious and then did a little dance. Don’t tell him I told you.', mood: 'laugh' },
          { if: 'kit.stay', say: 'kit', text: 'You said Hearthvale needs me. So I’m staying. Even if Rowan hadn’t. I’d have hidden in the moat.', mood: 'happy' },
          { say: 'kit', text: 'I made you this. It’s a badge. It says FOREVER MEMBER. I spelled it right. Rowan checked.', mood: 'blush' },
          {
            choice: 'kit',
            options: [
              { text: 'I’ll wear it every day.', reply: 'EVERY day? Even Sundays? Even in the BATH? …You’re the best member.', mood: 'laugh', delta: 100, flag: 'kit.badge' },
              { text: 'Rule four: Rowan can join.', reply: 'Rowan?! …Okay. But he has to do the frog noise. In public.', mood: 'surprised', delta: 100, flag: 'kit.rowan' },
            ],
          },
          { emote: 'kit', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'kit.partners', barks: ['Partner! Handshake!'], keepsake: { kind: 'notice', spot: 'notice', label: 'Kit’s TOP SECRET map, pinned to the notice board' } },
      { flag: 'kit.still', barks: ['Shh! Frog business.'], routine: [15, 16.5, 'river_dock', 'play'] },
      { flag: 'kit.stay', line: '[happy] Sir Ribbington has a moat AND a drawbridge now. Rowan helped. He says it’s “structurally a stick.”' },
      { flag: 'kit.keepwicks', barks: ['I know a SECRET.'] },
    ],
  },

  rowan: {
    events: [
      {
        id: 'rowan-6',
        hearts: 6,
        title: 'A Proper House',
        hours: [8, 17],
        dry: true,
        stage: 'yard',
        insert: [{ kind: 'swing', word: 'swing', caption: 'The double swing, tested twenty-three times' }],
        script: [
          { if: 'rowan.double', say: 'rowan', text: 'Double swing’s done. Kit made me test it twenty-three times. My stomach’s still over the river.', mood: 'laugh' },
          { if: 'rowan.brother', say: 'rowan', text: 'You called me a good brother. Kit heard. He says it every morning now, in a deep voice. It’s unbearable.', mood: 'blush' },
          { if: 'rowan.home', say: 'rowan', text: 'I wrote back to Mum. Told her we’re staying. She wrote straight back: “Good. Send pictures of the frog.”', mood: 'happy' },
          { if: 'rowan.ask', say: 'rowan', text: 'I asked Kit. He said “only if the frog comes.” The frog declined. So. We’re staying.', mood: 'laugh' },
          { say: 'rowan', text: 'Now I’ve got to build us a proper house. The flat over the yard leaks when it rains. And when it doesn’t.', mood: 'worried' },
          {
            choice: 'rowan',
            options: [
              { text: 'I’ll help you raise the roof.', reply: 'You’ll hold the rafters level and you’ll like it. …Thanks.', mood: 'happy', delta: 60, flag: 'rowan.roof' },
              { text: 'Build Kit a frog pond first.', reply: 'A pond before a roof. That’s the most Hearthvale thing anyone’s ever said.', mood: 'laugh', delta: 60, flag: 'rowan.pond' },
            ],
          },
          { emote: 'rowan', icon: 'idea' },
        ],
      },
      {
        id: 'rowan-8',
        hearts: 8,
        title: 'Housewarming',
        hours: [18, 23],
        stage: 'bridge',
        insert: [{ kind: 'invite', word: 'housewarming|saturday', caption: 'Housewarming at the Birch house — Saturday' }],
        script: [
          { say: 'rowan', text: 'Roof’s on. Doors swing. Kit’s lost three socks in it already, so it’s officially home.', mood: 'happy' },
          { if: 'rowan.roof', say: 'rowan', text: 'Every rafter you held is still level. Don’t let it go to your head.', mood: 'laugh' },
          { if: 'rowan.pond', say: 'rowan', text: 'And yes, the frog pond came first. Sir Ribbington has better plumbing than I do.', mood: 'laugh' },
          { say: 'rowan', text: 'Housewarming on Saturday. June’s doing the food. Bram’s doing the singing, so bring earplugs.', mood: 'happy' },
          {
            choice: 'rowan',
            options: [
              { text: 'I’ll bring a gift.', reply: 'Bring yourself. …And maybe a doormat. Kit ate the last one. Don’t ask.', mood: 'laugh', delta: 80, flag: 'rowan.gift' },
              { text: 'Save me a chair that doesn’t lean.', reply: 'Ha. I’ll build you one. It’ll say “Do not lean. This means you, farmer.”', mood: 'happy', delta: 80, flag: 'rowan.seat' },
            ],
          },
          { emote: 'rowan', icon: 'heart' },
        ],
      },
      {
        id: 'rowan-10',
        hearts: 10,
        title: 'Measured Twice',
        hours: [14, 19],
        stage: 'dock',
        insert: [{ kind: 'sign', word: 'sign|gate', caption: 'A gate sign — your gran’s name, and yours' }],
        script: [
          { say: 'rowan', text: 'Made you something. Measured twice. Cut once. Sanded… a lot of times.', mood: 'blush' },
          { say: 'rowan', text: 'A sign for your farm gate. Your gran’s name and yours. I had to guess at the spelling of the cow.', mood: 'laugh' },
          { say: 'rowan', text: 'Every roof in this town has one of my nails in it. Your gate should too.', mood: 'happy' },
          {
            choice: 'rowan',
            options: [
              { text: 'Hang it with me.', reply: 'Now? It’s getting dark. …Yeah. Now’s good. Bring a lantern.', mood: 'happy', delta: 100, flag: 'rowan.hang' },
              { text: 'It’s perfect.', reply: 'It’s not. The R’s crooked. …But thanks. Means a lot, coming from you.', mood: 'blush', delta: 100, flag: 'rowan.perfect' },
            ],
          },
          { emote: 'rowan', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'rowan.home', barks: ['Staying. Obviously.'], routine: [16, 17.5, 'plaza_play', 'chat'], line: '[happy] Told Mum we’re staying. She sent Kit a frog-shaped mitten. One. He wears it on his head.' },
      { flag: 'rowan.double', barks: ['Swing’s holding up!'] },
      { flag: 'rowan.roof', line: '[laugh] Rafters are still level. I check them every morning. With a spirit level. Like a madman.' },
      { flag: 'rowan.pond', barks: ['Pond first. Roof later.'] },
    ],
  },

  hazel: {
    events: [
      {
        id: 'hazel-6',
        hearts: 6,
        title: 'Seven Shoots',
        hours: [15, 20],
        stage: 'garden',
        insert: [{ kind: 'tin', word: 'seeds|shoots', caption: 'Seven shoots from Rosalind’s tin' }],
        script: [
          { if: 'hazel.together', say: 'hazel', text: 'Look! Our seeds! Seven shoots. I talk to them every morning. Terrible listeners. Like Linus.', mood: 'laugh' },
          { if: 'hazel.care', say: 'hazel', text: 'You took such care of them. Seven shoots. Rosalind said you can tell a gardener by their thumbs. Yours are green, dear.', mood: 'happy' },
          { say: 'hazel', text: 'I’ve been reading her old notes. She grafted a cutting of the hall rose onto these. They’re the same rose. The same.', mood: 'surprised' },
          { say: 'hazel', text: 'If one blooms… well. I’m too old to say the rest without crying.', mood: 'wistful' },
          {
            choice: 'hazel',
            options: [
              { text: 'Then don’t say it. Just water.', reply: 'Just water. Yes. That’s how she’d have done it.', mood: 'happy', delta: 60, flag: 'hazel.water' },
              { text: 'Cry. I’ll hold the watering can.', reply: 'Oh, you dreadful child. …Hold it steady, then.', mood: 'sad', delta: 60, flag: 'hazel.cry' },
            ],
          },
          { emote: 'hazel', icon: 'heart' },
        ],
      },
      {
        id: 'hazel-8',
        hearts: 8,
        title: 'The Seed Swap',
        hours: [18, 23],
        stage: 'riverWalk',
        insert: [{ kind: 'invite', word: 'seed swap|first of the month', caption: 'Seed swap at the hall steps — first of the month' }],
        script: [
          { say: 'hazel', text: 'I’ve started the seed swap again. At the hall steps, first of the month. Only nine years late.', mood: 'happy' },
          { if: 'hazel.waiting', say: 'hazel', text: 'You said the rose was waiting too. I think I was waiting with it. A silly old woman and a sulking bush.', mood: 'wistful' },
          { if: 'hazel.fert', say: 'hazel', text: 'And yes, I’m bringing manure. Linus has asked me not to. Linus can bring his own.', mood: 'laugh' },
          { say: 'hazel', text: 'Would you say a few words at it? About the farm. Folk listen to you now, you know.', mood: 'blush' },
          {
            choice: 'hazel',
            options: [
              { text: 'I’ll speak.', reply: 'Lovely. Keep it short. Bram will start singing if there’s a pause.', mood: 'happy', delta: 80, flag: 'hazel.speak' },
              { text: 'I’ll bring seeds instead.', reply: 'Seeds speak for themselves. Good answer, dear.', mood: 'happy', delta: 80, flag: 'hazel.seeds' },
            ],
          },
          { emote: 'hazel', icon: 'heart' },
        ],
      },
      {
        id: 'hazel-10',
        hearts: 10,
        title: 'The Rose Blooms',
        hours: [8, 17],
        dry: true,
        stage: 'hallDown',
        props: [{ kind: 'rose', at: [0, 0], near: ['hazel', 0.95, -0.55], word: 'bloomed|rose' }],
        insert: [{ kind: 'bloom', word: 'bloomed|rose', caption: 'Rosalind’s rose, in bloom at last' }],
        script: [
          { say: 'hazel', text: 'Come here. Quickly — quietly. Look.', mood: 'surprised' },
          { say: 'hazel', text: 'It bloomed. Rosalind’s rose. Nine years without a bud, and this morning — that.', mood: 'happy' },
          { say: 'hazel', text: 'The hall isn’t even lit yet. It didn’t wait for the lantern. It waited for you.', mood: 'wistful' },
          { if: 'hazel.cry', say: 'hazel', text: 'There. Now I’m crying. You did say you’d hold the watering can.', mood: 'sad' },
          {
            choice: 'hazel',
            options: [
              { text: 'It waited for both of us.', reply: 'Both of us. Yes. I’ll take that, dear. I’ll take that gladly.', mood: 'happy', delta: 100, flag: 'hazel.both' },
              { text: 'Gran would be so glad.', reply: 'She’d say “about time.” And then she’d cry harder than me.', mood: 'laugh', delta: 100, flag: 'hazel.gran' },
            ],
          },
          { emote: 'hazel', icon: 'heart' },
        ],
      },
    ],
    keeps: [
      { flag: 'hazel.together', barks: ['Seven shoots!'], routine: [15, 17, 'garden_east', 'water'] },
      { flag: 'hazel.waiting', line: '[wistful] Still no bloom on the hall rose. But it’s putting out leaves again. Waiting with company, like you said.' },
      { flag: 'hazel.both', barks: ['Have you seen the rose?'], keepsake: { kind: 'rose', spot: 'planters_hall', dx: 0, dz: 0.2, y: 0.45, label: 'Rosalind’s rose, in bloom by the hall' } },
      { flag: 'hazel.gran', barks: ['About time, she’d say.'] },
    ],
  },
};

// Merge: flags on the earlier answers, the new scenes after them, consequence talk lines first in
// the dialogue (after first-meeting / birthday groups), keeps on the def.
for (const id of Object.keys(ARCS) as NpcId[]) {
  const def = NPCS[id];
  for (const ev of def.events) {
    const names = OPTION_FLAGS[ev.id];
    if (!names) continue;
    for (const st of ev.script) if ('choice' in st) st.options.forEach((o, i) => names[i] && (o.flag = `${id}.${names[i]}`));
  }
  const a = ARCS[id];
  def.events.push(...a.events.map((e) => arc(id, e)));
  def.keeps = a.keeps;
  const lines: DialogueGroup[] = a.keeps.filter((k) => k.line).map((k) => ({ flag: k.flag, hours: k.hours ?? [12, 17], lines: [k.line!] }));
  const at = def.dialogue.findIndex((g) => !g.first && !g.birthday);
  def.dialogue.splice(at < 0 ? def.dialogue.length : at, 0, ...lines);
}

/** Every flag an answer can leave (tests / the social page / demo staging). */
export function choiceFlags(npc: NpcId): string[] {
  const out: string[] = [];
  for (const ev of NPCS[npc].events) for (const st of ev.script) if ('choice' in st) for (const o of st.options) if (o.flag) out.push(o.flag);
  return out;
}

/**
 * Demo staging: the memory a farmer who took each earlier scene's first answer would have before
 * `eventId` (every earlier event of that villager; `alt` takes the second answers instead).
 */
export function memoryBefore(eventId: string, alt = false): string[] {
  const he = heartEvent(eventId);
  if (!he) return [];
  const out: string[] = [];
  for (const ev of he.npc.events) {
    if (ev.hearts >= he.ev.hearts) continue;
    for (const st of ev.script) if ('choice' in st) {
      const o = st.options[alt && st.options.length > 1 ? 1 : 0];
      if (o?.flag) out.push(o.flag);
    }
  }
  return out;
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
  /** Relationship memory (flags left by heart-event choices). */
  recalls?: (flag: string) => boolean;
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
    if (g.flag && !ctx.recalls?.(g.flag)) continue;
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
