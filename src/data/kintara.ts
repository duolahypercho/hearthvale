/**
 * Kintara (pure data): the valley's tally of good work, and its $KIN token.
 *
 * In the fiction: before the Lantern Hall went dark, every family chalked their harvests and kindnesses on the
 * Hall's slate wall: the *kin-tally*. Kintara is the old word for that wall. After the Hall closed, Perpetua Vane
 * (a retired lighthouse bookkeeper) wheeled her ledger cart into the square and kept the tally going on a
 * lantern-glass ledger every lantern in the valley holds a copy of, so nobody can scratch a line out.
 * $KIN ("kin") is a line on that ledger. It is earned by good work, never bought, and it is mostly used up
 * (inscribing deeds, lantern oil) rather than hoarded.
 *
 * Everything here is a simulation inside Hearthvale. No real wallet, key, network or money is involved
 * (see core/kintara-chain.ts for the adapter seam a real chain would plug into).
 *
 * Design rules (enforced by the numbers below, and by systems/kintara.ts):
 *   - kin only enters the world through EARN rules, from a finite reserve, on a schedule that shrinks each year;
 *   - repeatable income has per-source and per-day caps; anything bigger is a one-time milestone;
 *   - gold can never buy kin; kin can be traded to gold only through a capped, slipping, taxed counter;
 *   - every sink burns kin (it is destroyed, not paid to anyone);
 *   - no randomness anywhere: a deed costs what the board says, nothing is a lottery.
 */
import type { NpcLook } from './npcs';
import { itemDef } from './items';
import { FISH } from './fish';
import { CROPS, CROP_IDS } from './crops';

export const KIN = { symbol: '$KIN', unit: 'kin', reserve: 1_000_000 } as const;

// ─────────────────────────────────────────────────────────── emission

/** Repeatable income per farm per in-game day: year 1 = 1.0×, each later year ×0.8, never under 0.4×. */
export const emissionFactor = (year: number): number => Math.max(0.4, Math.pow(0.8, Math.max(0, year - 1)));
/** Hard ceiling on repeatable kin per day (before the Lantern Fund bonus), halving-style schedule. */
export const dailyCap = (year: number): number => Math.max(10, Math.round(32 * emissionFactor(year)));

export type EarnSource = 'ship' | 'quest' | 'festival' | 'mine' | 'fish' | 'hall';

export interface SourceDef {
  id: EarnSource;
  label: string;
  /** Max repeatable kin this source can pay per day (scaled by emissionFactor). */
  daily: number;
  glyph: string;
}

export const SOURCES: Record<EarnSource, SourceDef> = {
  ship: { id: 'ship', label: 'Shipping tally', daily: 8, glyph: 'crate' },
  quest: { id: 'quest', label: 'Notice-board work', daily: 6, glyph: 'scroll' },
  festival: { id: 'festival', label: 'Festival ribbons', daily: 18, glyph: 'ribbon' },
  mine: { id: 'mine', label: 'Depth marks', daily: 0, glyph: 'pick' },
  fish: { id: 'fish', label: 'Angler\'s records', daily: 8, glyph: 'fish' },
  hall: { id: 'hall', label: 'Lantern Hall', daily: 0, glyph: 'lantern' },
};

/** Shipping: 1 kin per 400g shipped in a night, within the source cap. */
export const SHIP_PER_GOLD = 400;
/** Lifetime shipped-gold milestones (each pays once). */
export const SHIP_MILESTONES: [number, number][] = [
  [1_000, 3],
  [5_000, 6],
  [15_000, 12],
  [40_000, 25],
  [100_000, 50],
];
export const QUEST_KIN = 3;
export const BUNDLE_KIN = 12;
export const ROOM_KIN = 30;
export const HALL_KIN = 120;
export const FESTIVAL_WIN_KIN = 8;
export const FESTIVAL_PART_KIN = 3;
export const FISH_RECORD_KIN = 1;
export const FISH_LEGEND_KIN = 40;

/** Mining: the first time you reach a floor that is a multiple of 5 (once each), paid by depth. */
export const mineMark = (floor: number): number => (floor >= 5 && floor % 5 === 0 ? Math.round(2 + floor * 0.55) : 0);

/** First catch of a species: 2 + sell/40 kin (2..12); legends pay FISH_LEGEND_KIN. Once per species. */
export function fishFirstKin(fishId: string): number {
  const f = FISH.find((x) => x.id === fishId);
  if (!f) return 0;
  if (f.sell >= 1000 || f.rarity <= 0.1) return FISH_LEGEND_KIN;
  return Math.max(2, Math.min(12, 2 + Math.round(f.sell / 40)));
}

// ─────────────────────────────────────────────────────────── sinks

/** The Gold Counter: kin → gold only. Base rate, slip per kin already traded today, floor, tax, daily limit. */
export const COUNTER = { rate: 8, slip: 0.04, floor: 0.5, tax: 0.1, perDay: 20 } as const;
/** Gold per kin if `done` kin were already traded today (what the next kin pays, before tax). */
export const counterRate = (done: number): number => COUNTER.rate * Math.max(COUNTER.floor, 1 - COUNTER.slip * done);

/** Hearth tithe: balance above `above` loses `pct` each morning to lantern oil (burned). */
export const TITHE = { above: 300, pct: 0.02 } as const;

/** Inscription fee (burned) by deed rarity, and how it grows for repeat editions of the same item + quality. */
export const MINT_FEE: Record<string, number> = { common: 3, uncommon: 8, rare: 20, legendary: 60 };
export const EDITION_MULT = [1, 2, 4];
/** Deeds a farm can seal per day (a clerk's queue, not a casino limit). */
export const MINT_PER_DAY = 5;

export interface Offer {
  id: string;
  itemId: string;
  qty: number;
  kin: number;
  note: string;
}

/** Kin goods: practical, existing items only. Everything bought is burned from the wallet. */
export const OFFERS: Offer[] = [
  { id: 'fert', itemId: 'qualityFertilizer', qty: 5, kin: 6, note: 'Perpetua cuts it from the Hall garden. Dark, rich, a little smelly.' },
  { id: 'bait', itemId: 'bait', qty: 20, kin: 4, note: 'Chopped clams, her secret pinch of something.' },
  { id: 'brass', itemId: 'brassSprinkler', qty: 1, kin: 30, note: 'Waters all 8 tiles. Stamped with the Tally lantern.' },
  { id: 'coal', itemId: 'coal', qty: 10, kin: 5, note: 'For the forge. Hauled up from the Frostvein.' },
];

/** Lantern Fund: kin burned into the Hall's oil tally. Each tier lights the Exchange lamp brighter and eases the cap. */
export const FUND_TIERS: { at: number; title: string; perk: string; capBonus: number }[] = [
  { at: 25, title: 'First Wick', perk: 'The Exchange lamp is lit.', capBonus: 0 },
  { at: 75, title: 'Steady Flame', perk: '+10% on every repeatable payout.', capBonus: 0.1 },
  { at: 200, title: 'Hall Glow', perk: 'A fourth edition of any deed may be inscribed.', capBonus: 0.1 },
  { at: 500, title: 'Keeper of the Tally', perk: '+25% on repeatable payouts, and your name is chalked on the Hall wall.', capBonus: 0.25 },
];

// ─────────────────────────────────────────────────────────── deeds

export type DeedCategory = 'crop' | 'fish' | 'gem' | 'tool' | 'keepsake';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface DeedRule {
  category: DeedCategory;
  rarity: Rarity;
  /** Tool deeds attest ownership: nothing leaves the backpack. */
  attest: boolean;
}

const GEMS: Record<string, Rarity> = { amethyst: 'uncommon', topaz: 'uncommon', frostShard: 'uncommon', aquamarine: 'rare', ruby: 'rare', emberOpal: 'rare', starfallOpal: 'rare', diamond: 'legendary' };
export const TOOL_IDS = ['hoe', 'wateringCan', 'axe', 'pickaxe', 'scythe'];
const TOOL_RARITY: Rarity[] = ['common', 'uncommon', 'rare', 'legendary'];
export const TOOL_TIER_NAME = ['Basic', 'Copper', 'Iron', 'Gilded'];
export const QUALITY_WORD = ['plain', 'silver', 'gold', 'radiant'];

/**
 * Which backpack stacks can be sealed into a deed, and how rare the deed is.
 * Crops: any gold-quality (or better) crop, or an expensive crop at any quality. Fish: the valuable ones.
 * Gems: the hard-won stones. Tools: attestations for upgraded tools (`quality` = tool tier).
 */
export function deedRule(itemId: string, quality: number): DeedRule | null {
  if (itemId === 'keystone') return { category: 'keepsake', rarity: 'legendary', attest: true };
  const def = itemDef(itemId);
  if (!def) return null;
  if (TOOL_IDS.includes(itemId)) return quality >= 1 ? { category: 'tool', rarity: TOOL_RARITY[Math.min(3, quality)]!, attest: true } : null;
  if (GEMS[itemId]) return { category: 'gem', rarity: GEMS[itemId]!, attest: false };
  if (def.kind === 'fish') {
    const f = FISH.find((x) => x.id === itemId);
    if (!f) return null;
    if (f.sell >= 1000) return { category: 'fish', rarity: 'legendary', attest: false };
    if (f.sell >= 240) return { category: 'fish', rarity: 'rare', attest: false };
    if (f.sell >= 150 || quality >= 2) return { category: 'fish', rarity: 'uncommon', attest: false };
    return null;
  }
  const crop = CROP_IDS.map((id) => CROPS[id]).find((c) => c.produce === itemId);
  if (crop) {
    if (quality >= 3) return { category: 'crop', rarity: 'rare', attest: false };
    if (quality >= 2) return { category: 'crop', rarity: crop.sell >= 250 ? 'rare' : 'uncommon', attest: false };
    if (crop.sell >= 160) return { category: 'crop', rarity: crop.sell >= 300 ? 'rare' : 'uncommon', attest: false };
  }
  return null;
}

export const RARITY_STYLE: Record<Rarity, { name: string; color: string; glow: string }> = {
  common: { name: 'Common', color: '#9aa79a', glow: 'rgba(170,200,170,.5)' },
  uncommon: { name: 'Uncommon', color: '#4fae7a', glow: 'rgba(90,220,150,.55)' },
  rare: { name: 'Rare', color: '#4f8fd8', glow: 'rgba(100,170,255,.6)' },
  legendary: { name: 'Legendary', color: '#e6a526', glow: 'rgba(255,205,90,.75)' },
};

// ─────────────────────────────────────────────────────────── keeper & words

/** Perpetua Vane, keeper of the tally. Portrait-only (she is not on the villager roster). */
export const KEEPER = {
  id: 'perpetua',
  name: 'Perpetua Vane',
  role: 'Keeper of the Kintara Tally',
  look: {
    fp: { w: 0.9, h: 1.1, jaw: 0.3, chin: 0.4, eye: 0.88, gap: 0.96, nose: 'long', mouth: 0.9, lines: 0.5, cheeks: 0.35, ears: 0.9 },
    eyeShape: 'narrow',
    brow: 0.8,
    browArch: 0.6,
    skin: 0x9a6442,
    hair: 0xdfe3e6,
    hairStyle: 'braids',
    top: 0x24596a,
    bottom: 0x3a3440,
    scarf: 0x2f9a96,
    glasses: true,
    scale: 1.0,
    build: 0.92,
    legs: 1.08,
    eyes: 0x3a5a48,
    face: 'long',
    shoes: 0x3a2a22,
    acc: ['pencil', 'shawl', 'wrinkles'],
    backdrop: 'hall',
  } as NpcLook,
  portraitBg: [0xcfe0f0, 0x6a8fb8] as [number, number],
};

/** First meeting: shown one line at a time in the speech bubble. */
export const INTRO_LINES = [
  'Ah, the Rosalind\'s granddaughter. Perpetua Vane. I keep the tally.',
  'The Lantern Hall used to chalk every harvest and kindness on its slate wall. Kintara, we called it. When the Hall went dark, the wall went with it.',
  'So I wheeled my ledger into the square. Every lantern in the valley holds a copy now. Nobody can scratch a line out.',
  'The marks are called kin. You earn them by good work: shipping, notice-board jobs, festival ribbons, the deep floors, a fish nobody has landed before.',
  'You cannot buy kin. I will not sell it. A thing that can be bought is not worth writing down.',
];

export interface MoodLines {
  hello: string[];
  earn: string[];
  mint: string[];
  broke: string[];
  burn: string[];
  glimmer: string[];
  hall: string[];
}

export const KEEPER_LINES: MoodLines = {
  hello: [
    'Tally\'s up to date. Everything you have earned is written, nothing more.',
    'Kin does not grow while you sleep. Good work does, if you let it.',
    'Mind the lantern glass, dear. It remembers everything.',
    'No rush. The wall has waited seven winters for company.',
  ],
  earn: ['Another line written. Honest work reads well in ink.', 'Written, and witnessed by every lantern in the valley.'],
  mint: [
    'Sealed. That deed is yours alone: it cannot be sold, traded or stolen. That is rather the point.',
    'A good one. I will keep the page flat.',
    'Stamped and witnessed. The item goes into the vault; the name stays on the wall.',
  ],
  broke: ['Short a few kin, dear. The work will provide.', 'The fee is the fee. It is burned, so it must be honest.'],
  burn: ['The oil goes to the Hall. Slowly, the glass warms.', 'Burned and gone, and a little brighter for it.'],
  glimmer: [
    'Everglow\'s glass kiosk sells you "points" for money. Mine are not for sale: earn them, or do without.',
    'They told me my ledger was "too slow to scale". I told them it was exactly as fast as a harvest.',
  ],
  hall: ['The Hall is lit again. I will chalk that line myself.', 'Seven winters. Now every lantern has a reason to glow.'],
};

export const HALL_STORY = {
  keystoneName: 'The Hall Keystone',
  keystoneNote: 'Stamped when the Lantern Hall relit. Not a harvest; the whole valley.',
};
