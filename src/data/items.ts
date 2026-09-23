/** Item table (pure data). Icons are keys into ui/icons.ts ICONS. */
import { CROPS, CROP_IDS, type CropId } from './crops';
import { FISH, BEACH_FORAGE, FISHING_GEAR } from './fish';

export type ItemKind = 'tool' | 'seed' | 'produce' | 'resource' | 'placeable' | 'fish' | 'forage';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  icon: string;
  /** Shipping value (0 = can't be shipped). */
  sell: number;
  stack: number;
  /** Seeds: which crop they grow. */
  crop?: CropId;
  /** Tint used by generic icons (seed packets, produce). */
  color?: number;
  description?: string;
}

const base: ItemDef[] = [
  { id: 'hoe', name: 'Hoe', kind: 'tool', icon: 'hoe', sell: 0, stack: 1, description: 'Tills soil for planting.' },
  { id: 'wateringCan', name: 'Watering Can', kind: 'tool', icon: 'wateringCan', sell: 0, stack: 1, description: 'Waters tilled soil.' },
  { id: 'axe', name: 'Axe', kind: 'tool', icon: 'axe', sell: 0, stack: 1, description: 'Chops twigs, stumps and trees.' },
  { id: 'pickaxe', name: 'Pickaxe', kind: 'tool', icon: 'pickaxe', sell: 0, stack: 1, description: 'Breaks stones.' },
  { id: 'scythe', name: 'Scythe', kind: 'tool', icon: 'scythe', sell: 0, stack: 1, description: 'Cuts weeds and harvests crops.' },
  { id: 'rod', name: 'Bamboo Rod', kind: 'tool', icon: 'rod', sell: 0, stack: 1, description: "Grandmother's old rod. Hold to charge a cast, release to throw. Works at the pond, the river and the sea." },
  { id: 'wood', name: 'Wood', kind: 'resource', icon: 'wood', sell: 2, stack: 999 },
  { id: 'stone', name: 'Stone', kind: 'resource', icon: 'stone', sell: 2, stack: 999 },
  { id: 'fiber', name: 'Fiber', kind: 'resource', icon: 'fiber', sell: 1, stack: 999 },
  { id: 'sprinkler', name: 'Sprinkler', kind: 'placeable', icon: 'sprinkler', sell: 50, stack: 99, description: 'Waters the 4 adjacent tiles each morning.' },
  // Crafted placeables (data/recipes.ts outputs).
  { id: 'chest', name: 'Chest', kind: 'placeable', icon: 'chest', sell: 0, stack: 99, description: 'A sturdy oak chest. Holds 36 stacks of anything.' },
  { id: 'scarecrow', name: 'Scarecrow', kind: 'placeable', icon: 'scarecrow', sell: 0, stack: 99, description: 'Keeps crows off every crop within 8 tiles.' },
  { id: 'woodFence', name: 'Wood Fence', kind: 'placeable', icon: 'woodFence', sell: 1, stack: 999, description: 'Keeps animals in. Keeps weeds out (mostly).' },
  { id: 'stonePath', name: 'Stone Path', kind: 'placeable', icon: 'stonePath', sell: 1, stack: 999, description: 'Paves a tile. Grass and weeds won’t grow through it.' },
  // Sprinkler tiers (data/crops.ts SPRINKLERS; farming places them, recipes are discovered from mine ores).
  { id: 'brassSprinkler', name: 'Brass Sprinkler', kind: 'placeable', icon: 'brassSprinkler', sell: 120, stack: 99, color: 0xd97a3a, description: 'Waters all 8 tiles around it every morning.' },
  { id: 'goldSprinkler', name: 'Gilded Sprinkler', kind: 'placeable', icon: 'goldSprinkler', sell: 300, stack: 99, color: 0xf2c230, description: 'Waters a whole 5×5 patch — 24 tiles — every morning.' },
  // Fertilizers (data/crops.ts FERTILIZERS): worked into tilled soil, they lift the harvest quality odds.
  { id: 'fertilizer', name: 'Basic Fertilizer', kind: 'resource', icon: 'fertilizer', sell: 2, stack: 999, color: 0xd8cfb8, description: 'Work it into tilled soil before sowing. Better odds of silver and gold produce.' },
  { id: 'qualityFertilizer', name: 'Quality Fertilizer', kind: 'resource', icon: 'qualityFertilizer', sell: 10, stack: 999, color: 0x8fd0c0, description: 'Rich, dark and a little smelly. Much better odds of gold produce.' },
];

// Mines (world/mine): weapon, ores, gems, monster drops. Icons: world/mine/icons.ts.
base.push(
  { id: 'sword', name: "Miner's Shortsword", kind: 'tool', icon: 'sword', sell: 0, stack: 1, description: 'A notched old blade left at the mine mouth. Swing it at anything that wobbles.' },
  { id: 'copperOre', name: 'Copper Ore', kind: 'resource', icon: 'copperOre', sell: 5, stack: 999, color: 0xe07a3a, description: 'Warm orange ore from the upper Hollows.' },
  { id: 'ironOre', name: 'Iron Ore', kind: 'resource', icon: 'ironOre', sell: 10, stack: 999, color: 0xc9ccd4, description: 'Heavy grey ore, common in the Frostvein.' },
  { id: 'goldOre', name: 'Gold Ore', kind: 'resource', icon: 'goldOre', sell: 25, stack: 999, color: 0xffc83a, description: 'It glitters even in lantern light.' },
  { id: 'coal', name: 'Coal', kind: 'resource', icon: 'coal', sell: 15, stack: 999, color: 0x2a262c, description: 'Burns hot and long.' },
  { id: 'quartz', name: 'Quartz', kind: 'resource', icon: 'quartz', sell: 25, stack: 999, color: 0xf2f0ff, description: 'Clear as spring water.' },
  { id: 'amethyst', name: 'Amethyst', kind: 'resource', icon: 'amethyst', sell: 100, stack: 999, color: 0xb070ff, description: 'A violet crystal that hums faintly.' },
  { id: 'topaz', name: 'Topaz', kind: 'resource', icon: 'topaz', sell: 80, stack: 999, color: 0xffb030, description: 'Honey-gold and warm to the touch.' },
  { id: 'aquamarine', name: 'Aquamarine', kind: 'resource', icon: 'aquamarine', sell: 180, stack: 999, color: 0x40e0e8, description: 'The colour of deep meltwater.' },
  { id: 'frostShard', name: 'Frost Shard', kind: 'resource', icon: 'frostShard', sell: 75, stack: 999, color: 0x9fd8ff, description: 'Never quite melts.' },
  { id: 'ruby', name: 'Ruby', kind: 'resource', icon: 'ruby', sell: 250, stack: 999, color: 0xff2a48, description: 'Found where the rock runs hot.' },
  { id: 'emberOpal', name: 'Ember Opal', kind: 'resource', icon: 'emberOpal', sell: 300, stack: 999, color: 0xff7a1a, description: 'Flecks of fire drift inside it.' },
  { id: 'diamond', name: 'Diamond', kind: 'resource', icon: 'diamond', sell: 750, stack: 999, color: 0xeaffff, description: 'The deepest treasure of the Cinder Depths.' },
  { id: 'slimeGel', name: 'Slime Gel', kind: 'resource', icon: 'slimeGel', sell: 5, stack: 999, color: 0x7ed957, description: 'Wobbly. Surprisingly useful.' },
  { id: 'duskWing', name: 'Duskwing Membrane', kind: 'resource', icon: 'duskWing', sell: 15, stack: 999, color: 0x5a4668, description: 'Thin as paper, tough as leather.' },
  { id: 'crabCarapace', name: 'Rock Carapace', kind: 'resource', icon: 'crabCarapace', sell: 30, stack: 999, color: 0xb08a60, description: 'A rock crab’s shell. Still looks like a rock.' },
);

// Farm animals (systems/animals.ts): produce (quality from happiness) + feed. Extra icons: world/buildings/icons.ts.
base.push(
  { id: 'egg', name: 'Egg', kind: 'produce', icon: 'egg', sell: 50, stack: 999, color: 0xf7efe0, description: 'Still warm from the nesting box.' },
  { id: 'brownEgg', name: 'Brown Egg', kind: 'produce', icon: 'egg', sell: 50, stack: 999, color: 0xd89a62, description: 'Speckled, sturdy, excellent in a cake.' },
  { id: 'duckEgg', name: 'Duck Egg', kind: 'produce', icon: 'egg', sell: 95, stack: 999, color: 0xcfe8dc, description: 'A pale sea-green egg with a rich yolk.' },
  { id: 'duckFeather', name: 'Duck Feather', kind: 'produce', icon: 'duckFeather', sell: 125, stack: 999, color: 0x3a8a5a, description: 'An iridescent green feather, shed by a very happy duck.' },
  { id: 'milk', name: 'Milk', kind: 'produce', icon: 'milk', sell: 125, stack: 999, description: 'Fresh, creamy and still frothy from the pail.' },
  { id: 'goatMilk', name: 'Goat Milk', kind: 'produce', icon: 'goatMilk', sell: 225, stack: 999, description: 'Tangy and sweet. The goats are very proud of it.' },
  { id: 'wool', name: 'Wool', kind: 'produce', icon: 'wool', sell: 340, stack: 999, description: 'A soft, springy fleece. Smells faintly of clover.' },
  { id: 'truffle', name: 'Truffle', kind: 'produce', icon: 'truffle', sell: 625, stack: 999, description: 'A knobbly black treasure a pig snuffled up from under the oak.' },
  { id: 'hay', name: 'Hay', kind: 'resource', icon: 'hay', sell: 0, stack: 999, description: 'Sweet dried grass. Put it in a feed trough.' },
);

for (const id of CROP_IDS) {
  const c = CROPS[id];
  base.push({ id: c.seeds, name: `${c.name} Seeds`, kind: 'seed', icon: 'seeds', sell: Math.floor(c.seedPrice / 2), stack: 999, crop: id, color: c.color });
  base.push({ id: c.produce, name: c.name, kind: 'produce', icon: id, sell: c.sell, stack: 999, color: c.color });
}

// Fish (data/fish.ts) and beach forageables; icons are painted per species by ui/fishing-art.ts.
for (const f of FISH) base.push({ id: f.id, name: f.name, kind: 'fish', icon: f.id, sell: f.sell, stack: 999, color: f.look.side, description: f.blurb });
for (const f of BEACH_FORAGE) base.push({ id: f.id, name: f.name, kind: 'forage', icon: f.id, sell: f.sell, stack: 999, color: f.color, description: f.blurb });
for (const f of FISHING_GEAR) base.push({ id: f.id, name: f.name, kind: 'resource', icon: f.id, sell: f.sell, stack: f.stack, description: f.description });

// Festival keepsakes (world/festivals: Starfall gift exchange presents).
base.push(
  { id: 'starfallOpal', name: 'Starfall Opal', kind: 'resource', icon: 'starfallOpal', sell: 280, stack: 999, color: 0xbfe4ff, description: 'Only ever turns up wrapped in a Starfall present. A speck of aurora drifts inside it.' },
  { id: 'gingerbreadVillager', name: 'Gingerbread Villager', kind: 'resource', icon: 'gingerbreadVillager', sell: 60, stack: 99, color: 0xb8753a, description: "Bram's Starfall gingerbread, iced to look like someone you know. Extra buttons." },
  { id: 'winterRoseTea', name: 'Winter Rose Tea', kind: 'resource', icon: 'winterRoseTea', sell: 90, stack: 99, color: 0xd86a8a, description: "Hazel's blend: rosehips picked from under the snow. Tastes like a warm scarf." },
);

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(base.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}
