/**
 * Help Wanted board (pure data): daily requests pinned to the notice board in the square.
 * Each morning the quest system picks one or two templates (seeded by the date) whose items are
 * in season, rolls a quantity and pins a note. Deliver at the board (or hand it over in person)
 * before the deadline for gold and friendship.
 */
import type { Season } from '../core/time';

export interface HelpWantedTemplate {
  id: string;
  giver: string;
  /** NPC id for friendship (if any). */
  npc?: string;
  /** Items this template may ask for, per season ('any' = all year). */
  pool: Partial<Record<Season | 'any', string[]>>;
  qty: [number, number];
  /** Gold = item sell value × qty × mult (min 60). */
  mult: number;
  days: number;
  /** Note text; {qty} and {item} are replaced. */
  text: string;
  title: string;
  /** Paper tint for the pinned note. */
  paper: number;
}

export const HELP_WANTED: HelpWantedTemplate[] = [
  {
    id: 'marigold-restock',
    giver: 'Marigold',
    npc: 'marigold',
    title: 'Restocking the shelves',
    pool: { spring: ['parsnip', 'potato', 'kale'], summer: ['tomato', 'corn'], fall: ['pumpkin', 'corn'], any: ['fiber'] },
    qty: [3, 6],
    mult: 2.2,
    days: 2,
    text: "Customers keep asking for {item} and I keep saying 'tomorrow'. Could you bring me {qty}? — M.",
    paper: 0xfbf0d6,
  },
  {
    id: 'bram-oven',
    giver: 'Bram',
    npc: 'bram',
    title: 'The oven is hungry',
    pool: { spring: ['strawberry', 'parsnip'], summer: ['corn', 'tomato'], fall: ['pumpkin'], winter: ['wood'] },
    qty: [2, 5],
    mult: 2.5,
    days: 2,
    text: 'NEW PIE IDEA. Requires {qty} {item}. Will pay in coins AND crumbs. — B.',
    paper: 0xfff4dc,
  },
  {
    id: 'wren-still-life',
    giver: 'Wren',
    npc: 'wren',
    title: 'Still life (please hurry)',
    pool: { spring: ['cauliflower', 'strawberry'], summer: ['sunflower', 'tomato'], fall: ['pumpkin', 'sunflower'], winter: ['stone'] },
    qty: [1, 2],
    mult: 3,
    days: 1,
    text: "I need {qty} really good-looking {item} to paint before the light changes. Handsome ones only!! — W.",
    paper: 0xeaf4f6,
  },
  {
    id: 'hollis-repairs',
    giver: 'Mayor Hollis',
    title: 'Town repairs',
    pool: { any: ['wood', 'stone'] },
    qty: [15, 30],
    mult: 3,
    days: 3,
    text: 'The square needs mending: {qty} {item}, delivered to the board. The Council thanks you. (The Council is me.)',
    paper: 0xf2ead2,
  },
  {
    id: 'odessa-forge',
    giver: 'Odessa',
    npc: 'odessa',
    title: 'Feed the forge',
    pool: { any: ['coal', 'stone', 'quartz'] },
    qty: [3, 8],
    mult: 2.4,
    days: 3,
    text: "Forge is running cold and so am I. {qty} {item}, bring them round the back. Don't touch anything glowing. — O.",
    paper: 0xe8e2d8,
  },
  {
    id: 'june-kettle',
    giver: 'June',
    npc: 'june',
    title: 'Soup of the day',
    pool: { spring: ['potato', 'kale', 'parsnip'], summer: ['tomato', 'eggplant'], fall: ['yam', 'beet', 'pumpkin'], winter: ['egg', 'milk'] },
    qty: [2, 5],
    mult: 2.3,
    days: 2,
    text: 'The Copper Kettle promised soup and the pot is empty. {qty} {item}, please, before the supper crowd! — June',
    paper: 0xfff0e0,
  },
  {
    id: 'hazel-beds',
    giver: 'Hazel',
    npc: 'hazel',
    title: 'For the flower beds',
    pool: { spring: ['fiber'], summer: ['sunflower', 'fiber'], fall: ['sunflower', 'fiber'], winter: ['wood'] },
    qty: [4, 10],
    mult: 2.6,
    days: 3,
    text: "The square's beds want mulching and my knees want a holiday. {qty} {item} would see us both right. — Hazel",
    paper: 0xeef4e0,
  },
  {
    id: 'kit-expedition',
    giver: 'Kit (age 9¾)',
    npc: 'kit',
    title: 'EXPEDITION SUPPLIES',
    pool: { spring: ['strawberry'], summer: ['blueberry', 'melon'], fall: ['grape'], winter: ['quartz', 'amethyst'] },
    qty: [1, 3],
    mult: 3.2,
    days: 2,
    text: 'I am going on an EXPEDITION and I need {qty} {item}. It is TOP SECRET. Do not tell Rowan. — Kit',
    paper: 0xf6f0c8,
  },
];

/** Items that don't take a plural "s" on a note ("5 Kale", not "5 Kales"). */
export const MASS_NOUNS = new Set(['kale', 'corn', 'fiber', 'wood', 'stone', 'coal', 'quartz', 'hay', 'wool', 'milk', 'hops']);
