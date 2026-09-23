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

export interface BundleDef {
  id: string;
  room: RoomId;
  name: string;
  /** Cloth colour of the bundle sack. */
  color: number;
  items: BundleItem[];
  /** Gold bundles (the Treasury): pay coins instead of items. */
  gold?: number;
  reward: { gold?: number; itemId?: string; qty?: number; label?: string };
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

export const BUNDLES: BundleDef[] = [
  // Seed Room (spring)
  { id: 'spring-sowing', room: 'seed', name: 'Spring Sowing', color: 0x8fc46a, note: 'The first rows of the year.', items: [{ itemId: 'parsnip', qty: 5 }, { itemId: 'potato', qty: 3 }, { itemId: 'cauliflower', qty: 1 }, { itemId: 'kale', qty: 2 }], reward: { itemId: 'sprinkler', qty: 3 } },
  { id: 'berry-basket', room: 'seed', name: 'Berry Basket', color: 0xe8607a, note: "Gran's jam jars are waiting.", items: [{ itemId: 'strawberry', qty: 6 }], reward: { gold: 400 } },
  { id: 'gardeners-kit', room: 'seed', name: "Gardener's Kit", color: 0xc8a068, note: 'Twine, stakes, and patience.', items: [{ itemId: 'fiber', qty: 25 }, { itemId: 'wood', qty: 25 }], reward: { itemId: 'strawberrySeeds', qty: 10 } },
  // Sun Room (summer)
  { id: 'summer-table', room: 'sun', name: 'Summer Table', color: 0xe8573e, note: 'Sun-warm and ready to slice.', items: [{ itemId: 'tomato', qty: 5 }, { itemId: 'corn', qty: 3 }], reward: { gold: 500 } },
  { id: 'sunflower-crown', room: 'sun', name: 'Sunflower Crown', color: 0xf2c43a, note: 'For the tallest window in the valley.', items: [{ itemId: 'sunflower', qty: 3 }], reward: { itemId: 'pumpkinSeeds', qty: 8 } },
  { id: 'treasury', room: 'sun', name: 'The Treasury', color: 0xd8b04a, note: 'New glass for the glasshouse roof.', items: [], gold: 2500, reward: { gold: 0, label: 'Glasshouse repaired' } },
  // Harvest Room (fall)
  { id: 'harvest-table', room: 'harvest', name: 'Harvest Table', color: 0xe8812e, note: 'A table built for forty.', items: [{ itemId: 'pumpkin', qty: 2 }, { itemId: 'corn', qty: 5 }], reward: { gold: 750 } },
  { id: 'root-cellar', room: 'harvest', name: 'Root Cellar', color: 0xa87848, note: 'Enough to see the valley through.', items: [{ itemId: 'potato', qty: 10 }, { itemId: 'parsnip', qty: 10 }], reward: { gold: 600 } },
  // Hearth Room (winter)
  { id: 'winter-woodpile', room: 'hearth', name: 'Winter Woodpile', color: 0x9a6a44, note: 'A hearth that has been cold too long.', items: [{ itemId: 'wood', qty: 120 }], reward: { gold: 500 } },
  { id: 'frost-catch', room: 'hearth', name: 'Frost Catch', color: 0x7ab8e0, note: 'Something from under the ice.', items: [{ itemId: 'frostPike', qty: 1, name: 'Frost Pike', color: 0x9ac8e8 }, { itemId: 'mossCarp', qty: 2, name: 'Moss Carp', color: 0x7a9a5a }], reward: { gold: 800 } },
  { id: 'warm-hands', room: 'hearth', name: 'Warm Hands', color: 0xd8574a, note: 'Knit, stitched, simmered.', items: [{ itemId: 'fiber', qty: 40 }, { itemId: 'kale', qty: 3 }], reward: { itemId: 'sprinkler', qty: 2 } },
  // Crafter's Room
  { id: 'builders', room: 'craft', name: "Builder's Bundle", color: 0x8a8a92, note: 'Timber and stone for the old stairs.', items: [{ itemId: 'wood', qty: 99 }, { itemId: 'stone', qty: 99 }], reward: { gold: 300 } },
  { id: 'weavers', room: 'craft', name: "Weaver's Bundle", color: 0x7ac06a, note: 'The loom remembers the pattern.', items: [{ itemId: 'fiber', qty: 60 }], reward: { gold: 250 } },
  { id: 'tinkers', room: 'craft', name: "Tinker's Bundle", color: 0x5a9ab8, note: 'Brass, springs and good intentions.', items: [{ itemId: 'sprinkler', qty: 1 }, { itemId: 'stone', qty: 30 }], reward: { itemId: 'sprinkler', qty: 4 } },
  // Tide Room (fish)
  { id: 'pond-bundle', room: 'tide', name: 'Pond Bundle', color: 0x5ab8a8, note: 'Everything that swims in the farm pond.', items: [{ itemId: 'pondPerch', qty: 1, name: 'Pond Perch', color: 0x8ab86a }, { itemId: 'mossCarp', qty: 1, name: 'Moss Carp', color: 0x7a9a5a }, { itemId: 'dewMinnow', qty: 1, name: 'Dew Minnow', color: 0xa8d8e8 }], reward: { gold: 600 } },
  { id: 'night-fishing', room: 'tide', name: 'Night Fishing', color: 0x3a5a9a, note: 'Rain, midnight and a steady hand.', items: [{ itemId: 'lanternEel', qty: 1, name: 'Lantern Eel', color: 0xf2c46a }], reward: { gold: 1000 } },
];

export const ROOM_IDS = ROOMS.map((r) => r.id);

export function roomDef(id: string): RoomDef | undefined {
  return ROOMS.find((r) => r.id === id);
}

export function bundlesIn(room: string): BundleDef[] {
  return BUNDLES.filter((b) => b.room === room);
}
