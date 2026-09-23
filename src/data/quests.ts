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
];
