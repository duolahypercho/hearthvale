/**
 * Farm animal table (pure data): which building houses each species, what it costs at the
 * carpenter's, what it produces and how often, and the pool of names new animals are given.
 */
import type { Species } from './animals-models';

export type Livestock = Exclude<Species, 'dog' | 'cat'>;
export type AnimalHome = 'coop' | 'barn';

export interface LivestockInfo {
  name: string;
  home: AnimalHome;
  price: number;
  /** Produce item id (variant 1 may differ, see `produceFor`). */
  produce: string;
  /** Days between produce. */
  every: number;
  /** Collected by interacting with the animal (milk, wool) instead of appearing in a nest / on the ground. */
  byHand: boolean;
  blurb: string;
  variants: number;
}

export const LIVESTOCK: Record<Livestock, LivestockInfo> = {
  chicken: { name: 'Chicken', home: 'coop', price: 800, produce: 'egg', every: 1, byHand: false, blurb: 'Lays an egg in the nesting boxes every morning.', variants: 2 },
  duck: { name: 'Duck', home: 'coop', price: 1200, produce: 'duckEgg', every: 2, byHand: false, blurb: 'A duck egg every other day. Very happy ducks shed feathers.', variants: 2 },
  cow: { name: 'Cow', home: 'barn', price: 1500, produce: 'milk', every: 1, byHand: true, blurb: 'Fresh milk every day. Give her a pat and a pail.', variants: 2 },
  goat: { name: 'Goat', home: 'barn', price: 4000, produce: 'goatMilk', every: 2, byHand: true, blurb: 'Goat milk every other day, and a lot of opinions.', variants: 2 },
  sheep: { name: 'Sheep', home: 'barn', price: 8000, produce: 'wool', every: 3, byHand: true, blurb: 'Grows a fleece every three days. Shear with a friendly hand.', variants: 2 },
  pig: { name: 'Pig', home: 'barn', price: 16000, produce: 'truffle', every: 1, byHand: false, blurb: 'Snuffles up truffles in the pasture on fine days.', variants: 2 },
};

export const LIVESTOCK_ORDER: Livestock[] = ['chicken', 'duck', 'cow', 'goat', 'sheep', 'pig'];

/** Produce for a given animal (brown hens lay brown eggs). */
export function produceFor(species: Livestock, variant: number): string {
  if (species === 'chicken' && variant === 1) return 'brownEgg';
  return LIVESTOCK[species].produce;
}

export const ANIMAL_NAMES = [
  'Clover', 'Biscuit', 'Maple', 'Pudding', 'Hazel', 'Dumpling', 'Juniper', 'Pepper', 'Mochi', 'Bramble',
  'Tansy', 'Waffles', 'Poppy', 'Nutmeg', 'Sorrel', 'Marzipan', 'Bluebell', 'Toffee', 'Fennel', 'Crumpet',
  'Daisy', 'Pickle', 'Button', 'Saffron', 'Honey', 'Truffle', 'Oats', 'Buttercup', 'Muffin', 'Willow',
];

export const PET_NAMES: Record<'dog' | 'cat', string> = { dog: 'Rufus', cat: 'Tuppence' };
