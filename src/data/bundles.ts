/**
 * Lantern Hall (pure data): the story spine. The Hall has six rooms; each holds a few bundles of
 * seasonal goods. Filling every bundle in a room relights that room's lantern, pays its rewards and
 * restores something out in the valley (a visible world change + a celebration cutscene).
 *
 * Item ids that other teams have not shipped yet still work: `name` / `color` are the fallback the
 * bundle UI shows until data/items.ts knows the item.
 */

export type RoomId = 'seed' | 'sun' | 'harvest' | 'hearth' | 'craft' | 'tide';

export interface BundleItem {
  itemId: string;
  qty: number;
  /** Fallback label / tint for items not (yet) in data/items.ts. */
  name?: string;
  color?: number;
}

/** A standing perk a bundle unlocks (honoured by systems/quests.ts). */
export type BundlePerk = 'board-pay' | 'board-busy';

export interface BundleDef {
  id: string;
  room: RoomId;
  name: string;
  /** Cloth colour of the bundle sack. */
  color: number;
  items: BundleItem[];
  /** Pick-N-of-M: the bundle is full once this many of its slots are (default: every slot). */
  pick?: number;
  /** Minimum produce quality accepted (1 = silver star, 2 = gold star). */
  quality?: 1 | 2;
  /** Gold bundles (the Treasury): pay coins instead of items. */
  gold?: number;
  /** `label` names what the reward unlocks (shown on the card and the "complete" toast). */
  reward: { gold?: number; itemId?: string; qty?: number; label?: string; perk?: BundlePerk };
  /** One line of flavour in the bundle card. */
  note: string;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  season: 'spring' | 'summer' | 'fall' | 'winter' | 'any';
  lantern: string;
  /** Lantern flame colour. */
  color: number;
  /** Paler accent for UI. */
  accent: number;
  blurb: string;
  /** What returns to the valley, shown in the journal + celebration caption. */
  restores: { title: string; text: string };
  /** Room centre + lantern position in the Hall interior (world units). */
  x: number;
  z: number;
}

export const ROOMS: RoomDef[] = [
  { id: 'seed', name: 'The Seed Room', season: 'spring', lantern: 'Blossom Lantern', color: 0xff9ec0, accent: 0xffd6e4, blurb: 'Shelves of old seed jars, labelled in Gran\'s looping hand.', restores: { title: 'The Blossom Arch', text: 'The arch over the Hall steps bursts into bloom.' }, x: 7, z: 6 },
  { id: 'sun', name: 'The Sun Room', season: 'summer', lantern: 'Noon Lantern', color: 0xffc83a, accent: 0xfff0b0, blurb: 'A glasshouse corner that once grew lemons in winter.', restores: { title: 'Market Day', text: 'Striped stalls return to the square, heavy with produce.' }, x: 23, z: 6 },
  { id: 'harvest', name: 'The Harvest Room', season: 'fall', lantern: 'Harvest Lantern', color: 0xff8a2e, accent: 0xffd2a8, blurb: 'Cider press, barrels, and a long table built for forty.', restores: { title: 'The Road Home', text: 'Harvest lanterns line the lane from the farm to the square.' }, x: 7, z: 12 },
  { id: 'hearth', name: 'The Hearth Room', season: 'winter', lantern: 'Frost Lantern', color: 0x9ad8ff, accent: 0xdff2ff, blurb: 'A great stone hearth, cold for seven winters.', restores: { title: 'The Hall Chimney', text: 'Smoke curls from the Hall again; its windows glow all night.' }, x: 23, z: 12 },
  { id: 'craft', name: "The Crafter's Room", season: 'any', lantern: 'Tinker Lantern', color: 0x9fe07a, accent: 0xdcf5c8, blurb: 'A workbench, a loom, and a hundred tiny drawers.', restores: { title: 'Flower Baskets', text: 'The plaza lamps wear hanging flower baskets once more.' }, x: 7, z: 18 },
  { id: 'tide', name: 'The Tide Room', season: 'any', lantern: 'Tide Lantern', color: 0x5fe3d6, accent: 0xc8f6f0, blurb: 'Empty tanks, dry nets, and a painted rowboat on the wall.', restores: { title: 'Lantern Koi', text: 'Glowing koi return to the fountain in the square.' }, x: 23, z: 18 },
];

/**
 * 26 bundles. Seasonal rooms want what that season grows *and* forages; the Crafter's Room sends you
 * down the mine, the Tide Room to the pond, the river and the sea, the Hearth Room to the barn. Many
 * are pick-N-of-M (any 4 of 6 crops) so a bad season never locks a room; a few want silver / gold
 * star produce. Rewards are things you will use (sprinkler tiers, fertiliser, tackle, a chest) or
 * standing perks (the Market Charter raises Help Wanted pay).
 */
export const BUNDLES: BundleDef[] = [
  // ── Seed Room (spring)
  { id: 'spring-sowing', room: 'seed', name: 'Spring Sowing', color: 0x8fc46a, note: 'The first rows of the year.', pick: 4, items: [{ itemId: 'parsnip', qty: 5 }, { itemId: 'potato', qty: 3 }, { itemId: 'cauliflower', qty: 1 }, { itemId: 'kale', qty: 2 }, { itemId: 'greenBean', qty: 3 }, { itemId: 'strawberry', qty: 3 }], reward: { itemId: 'qualityFertilizer', qty: 10, label: 'Richer soil' } },
  { id: 'berry-basket', room: 'seed', name: 'Jam Jar', color: 0xe8607a, note: "Gran's jam jars are waiting. Only the best berries.", quality: 1, items: [{ itemId: 'strawberry', qty: 5 }], reward: { itemId: 'strawberrySeeds', qty: 12, label: 'Next year\'s patch' } },
  { id: 'spring-forage', room: 'seed', name: 'Hedgerow Walk', color: 0x9a6ad8, note: 'What grows wild under the elders by the creek.', items: [{ itemId: 'wildLeek', qty: 2, name: 'Wild Leek', color: 0x9fd07a }, { itemId: 'morel', qty: 1, name: 'Morel', color: 0xa8845a }, { itemId: 'duskViolet', qty: 3, name: 'Dusk Violet', color: 0x9a6ad8 }], reward: { gold: 350 } },
  { id: 'gardeners-kit', room: 'seed', name: "Gardener's Kit", color: 0xc8a068, note: 'Twine, stakes, and patience.', items: [{ itemId: 'fiber', qty: 30 }, { itemId: 'wood', qty: 30 }], reward: { itemId: 'scarecrow', qty: 2, label: 'Two scarecrows' } },
  // ── Sun Room (summer)
  { id: 'summer-table', room: 'sun', name: 'Summer Table', color: 0xe8573e, note: 'Sun-warm and ready to slice.', pick: 4, items: [{ itemId: 'tomato', qty: 3 }, { itemId: 'corn', qty: 3 }, { itemId: 'blueberry', qty: 5 }, { itemId: 'melon', qty: 1 }, { itemId: 'hotPepper', qty: 3 }, { itemId: 'hops', qty: 5 }], reward: { itemId: 'brassSprinkler', qty: 2, label: 'Sprinklers that reach all eight tiles' } },
  { id: 'sunflower-crown', room: 'sun', name: 'Blue Ribbon', color: 0xf2c43a, note: 'For the tallest window in the valley: gold-star produce only.', pick: 2, quality: 2, items: [{ itemId: 'sunflower', qty: 2 }, { itemId: 'tomato', qty: 3 }, { itemId: 'blueberry', qty: 5 }, { itemId: 'melon', qty: 1 }], reward: { itemId: 'qualityFertilizer', qty: 20 } },
  { id: 'summer-forage', room: 'sun', name: 'Long Light', color: 0xf29ac0, note: 'Picked on the longest evenings of the year.', items: [{ itemId: 'hedgeBerry', qty: 3, name: 'Hedge Berry', color: 0xd8344a }, { itemId: 'fiddlehead', qty: 2, name: 'Fiddlehead', color: 0x6fae45 }, { itemId: 'sweetPea', qty: 3, name: 'Sweet Pea', color: 0xf29ac0 }], reward: { gold: 500 } },
  { id: 'treasury', room: 'sun', name: 'The Treasury', color: 0xd8b04a, note: 'New glass for the glasshouse roof.', items: [], gold: 2500, reward: { label: 'Market Charter: Help Wanted pays a quarter more', perk: 'board-pay' } },
  // ── Harvest Room (fall)
  { id: 'harvest-table', room: 'harvest', name: 'Harvest Table', color: 0xe8812e, note: 'A table built for forty.', pick: 4, items: [{ itemId: 'pumpkin', qty: 2 }, { itemId: 'corn', qty: 5 }, { itemId: 'eggplant', qty: 3 }, { itemId: 'grape', qty: 5 }, { itemId: 'beet', qty: 3 }, { itemId: 'yam', qty: 2 }], reward: { gold: 750 } },
  { id: 'root-cellar', room: 'harvest', name: 'Root Cellar', color: 0xa87848, note: 'Enough to see the valley through.', items: [{ itemId: 'potato', qty: 8 }, { itemId: 'beet', qty: 5 }, { itemId: 'yam', qty: 3 }], reward: { itemId: 'chest', qty: 2, label: 'Two oak chests' } },
  { id: 'fall-forage', room: 'harvest', name: 'Woodland Basket', color: 0xf0a83a, note: 'Golden caps and rattling husks from Cindergrove.', items: [{ itemId: 'chanterelle', qty: 1, name: 'Chanterelle', color: 0xf0a83a }, { itemId: 'hazelnut', qty: 3, name: 'Hazelnut', color: 0x9a6a3a }, { itemId: 'emberCap', qty: 2, name: 'Ember Cap', color: 0xe0502a }], reward: { itemId: 'qualityFertilizer', qty: 10 } },
  { id: 'dairy', room: 'harvest', name: 'Barn & Coop', color: 0xf3efe0, note: 'Warm eggs, fresh milk.', pick: 2, items: [{ itemId: 'egg', qty: 5 }, { itemId: 'brownEgg', qty: 5 }, { itemId: 'milk', qty: 3 }, { itemId: 'duckEgg', qty: 2 }], reward: { itemId: 'hay', qty: 40, label: 'A loft of hay' } },
  // ── Hearth Room (winter)
  { id: 'winter-woodpile', room: 'hearth', name: 'Winter Woodpile', color: 0x9a6a44, note: 'A hearth that has been cold too long.', items: [{ itemId: 'wood', qty: 50 }, { itemId: 'coal', qty: 5 }], reward: { gold: 500 } },
  { id: 'frost-catch', room: 'hearth', name: 'Frost Catch', color: 0x7ab8e0, note: 'Something from under the ice.', items: [{ itemId: 'frostPike', qty: 1, name: 'Frost Pike', color: 0x9ac8e8 }, { itemId: 'mossCarp', qty: 2, name: 'Moss Carp', color: 0x7a9a5a }], reward: { gold: 800 } },
  { id: 'warm-hands', room: 'hearth', name: 'Warm Hands', color: 0xd8574a, note: 'Knit, stitched, simmered.', pick: 3, items: [{ itemId: 'wool', qty: 1 }, { itemId: 'goatMilk', qty: 1 }, { itemId: 'fiber', qty: 30 }, { itemId: 'kale', qty: 3 }], reward: { itemId: 'winterRoseTea', qty: 3, label: "Hazel's winter tea" } },
  { id: 'winter-forage', room: 'hearth', name: 'Under the Frost', color: 0xbfe0f0, note: 'Dug and snapped from a sleeping forest.', items: [{ itemId: 'snowRoot', qty: 2, name: 'Snow Root', color: 0xe8dcc8 }, { itemId: 'frostHolly', qty: 2, name: 'Frost Holly', color: 0x3f8a4a }, { itemId: 'crystalCone', qty: 1, name: 'Crystal Cone', color: 0xbfe0f0 }], reward: { itemId: 'brassSprinkler', qty: 2 } },
  // ── Crafter's Room (the mine + the workshop)
  { id: 'builders', room: 'craft', name: "Builder's Bundle", color: 0x8a8a92, note: 'Timber and stone for the old stairs.', items: [{ itemId: 'wood', qty: 50 }, { itemId: 'stone', qty: 50 }], reward: { itemId: 'chest', qty: 1 } },
  { id: 'weavers', room: 'craft', name: "Weaver's Bundle", color: 0x7ac06a, note: 'The loom remembers the pattern.', items: [{ itemId: 'fiber', qty: 40 }, { itemId: 'wool', qty: 1 }], reward: { gold: 400, label: 'Woven banners for the Hall' } },
  { id: 'tinkers', room: 'craft', name: "Tinker's Bundle", color: 0x5a9ab8, note: 'Copper, iron and good intentions.', items: [{ itemId: 'copperOre', qty: 10 }, { itemId: 'ironOre', qty: 5 }, { itemId: 'coal', qty: 5 }], reward: { itemId: 'brassSprinkler', qty: 3 } },
  { id: 'geologist', room: 'craft', name: "Geologist's Drawer", color: 0xb070ff, note: 'One of each for the hundred little drawers.', pick: 3, items: [{ itemId: 'quartz', qty: 1 }, { itemId: 'amethyst', qty: 1 }, { itemId: 'topaz', qty: 1 }, { itemId: 'aquamarine', qty: 1 }, { itemId: 'frostShard', qty: 1 }], reward: { itemId: 'goldSprinkler', qty: 2, label: 'Sprinklers for a 5 × 5 patch' } },
  { id: 'adventurers', room: 'craft', name: "Adventurer's Pack", color: 0x7ed957, note: 'Proof you went down there and came back up.', items: [{ itemId: 'slimeGel', qty: 10 }, { itemId: 'duskWing', qty: 3 }, { itemId: 'crabCarapace', qty: 1 }], reward: { gold: 600 } },
  // ── Tide Room (pond, river, sea, shore)
  { id: 'pond-bundle', room: 'tide', name: 'Pond Bundle', color: 0x5ab8a8, note: 'Everything that swims in the farm pond.', pick: 3, items: [{ itemId: 'pondPerch', qty: 1, name: 'Pond Perch', color: 0x8ab86a }, { itemId: 'mossCarp', qty: 1, name: 'Moss Carp', color: 0x7a9a5a }, { itemId: 'dewMinnow', qty: 1, name: 'Dew Minnow', color: 0xa8d8e8 }, { itemId: 'lilyGoby', qty: 1 }], reward: { gold: 600 } },
  { id: 'river-bundle', room: 'tide', name: 'River Bundle', color: 0x4a8ab8, note: 'Quick water under the mill bridge.', pick: 3, items: [{ itemId: 'brookSpeckle', qty: 1 }, { itemId: 'silverDace', qty: 1 }, { itemId: 'streamChub', qty: 1 }, { itemId: 'copperSalmon', qty: 1 }], reward: { itemId: 'corkBobber', qty: 1, label: 'A taller catch bar' } },
  { id: 'sea-bundle', room: 'tide', name: 'Sea Bundle', color: 0x2f6f9a, note: 'Off the end of the pier.', pick: 4, items: [{ itemId: 'saltHerring', qty: 1 }, { itemId: 'coralSnapper', qty: 1 }, { itemId: 'sunFlounder', qty: 1 }, { itemId: 'pearlMackerel', qty: 1 }, { itemId: 'kelpCod', qty: 1 }, { itemId: 'sandlance', qty: 1 }], reward: { itemId: 'treasureLure', qty: 1 } },
  { id: 'beachcomber', room: 'tide', name: 'Beachcomber', color: 0xf2d0a8, note: 'The tide leaves presents.', pick: 3, items: [{ itemId: 'cockle', qty: 3 }, { itemId: 'spiralConch', qty: 1 }, { itemId: 'starfish', qty: 1 }, { itemId: 'sandDollar', qty: 1 }, { itemId: 'seaGlass', qty: 2 }], reward: { itemId: 'bait', qty: 30, label: 'Bait for a season', perk: 'board-busy' } },
  { id: 'night-fishing', room: 'tide', name: 'Night Fishing', color: 0x3a5a9a, note: 'Rain, midnight and a steady hand.', items: [{ itemId: 'lanternEel', qty: 1, name: 'Lantern Eel', color: 0xf2c46a }, { itemId: 'moonSmelt', qty: 1 }], reward: { gold: 1000 } },
];

/** Slots a bundle needs filled (pick-N-of-M, or all of them). */
export function slotsNeeded(def: BundleDef): number {
  return Math.min(def.items.length, def.pick ?? def.items.length);
}

/** Full slots of a bundle. */
export function slotsFull(def: BundleDef, given: Record<string, number>): number {
  return def.items.filter((it) => (given[it.itemId] ?? 0) >= it.qty).length;
}

export function bundleComplete(def: BundleDef, given: Record<string, number>, paid: number): boolean {
  if (def.gold && paid < def.gold) return false;
  return slotsFull(def, given) >= slotsNeeded(def);
}

/**
 * Items given / items needed, counted over the slots that will most likely finish the bundle (the
 * fullest `pick` slots) — the progress a pick-N bundle shows. Gold bundles count as one item.
 */
export function bundleProgress(def: BundleDef, given: Record<string, number>, paid: number): { have: number; need: number } {
  const n = slotsNeeded(def);
  const ranked = [...def.items].sort((a, b) => Math.min(1, (given[b.itemId] ?? 0) / b.qty) - Math.min(1, (given[a.itemId] ?? 0) / a.qty) || a.qty - b.qty).slice(0, n);
  let have = ranked.reduce((s, it) => s + Math.min(it.qty, given[it.itemId] ?? 0), 0);
  let need = ranked.reduce((s, it) => s + it.qty, 0);
  if (def.gold) {
    need += 1;
    if (paid >= def.gold) have += 1;
  }
  return { have, need };
}

export const QUALITY_NAME = ['', 'silver star', 'gold star'] as const;

export const ROOM_IDS = ROOMS.map((r) => r.id);

export function roomDef(id: string): RoomDef | undefined {
  return ROOMS.find((r) => r.id === id);
}

export function bundlesIn(room: string): BundleDef[] {
  return BUNDLES.filter((b) => b.room === room);
}
