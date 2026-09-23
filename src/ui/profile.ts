/**
 * The player's journal profile — who you are and what you call the farm — chosen on the New Journal screen
 * (ui/newgame.ts) and shown by the backpack card, banners and save slots.
 *
 *   journal            { name, farm, pet: { species, variant, name } }
 *   loadJournal()      boot: restore from localStorage (the last journal you started / loaded)
 *   setJournal(p)      set + persist; emits `journal:change`
 *   registerJournalSave(game)   saves / restores it with each save slot (key 'journal')
 *
 * The farmer's look lives with the co-op profile (net.profile().look) so one creator drives both.
 */
import type { Game } from '../core/game';

export interface PetChoice {
  species: 'dog' | 'cat';
  variant: number;
  name: string;
}

export interface Journal {
  name: string;
  farm: string;
  pet: PetChoice;
  /** Journal slot this story lives in (slot1–3); the day-end autosave is mirrored into it. */
  slot: string;
}

declare module '../core/events' {
  interface GameEvents {
    /** The journal profile (name / farm / pet) changed. */
    'journal:change': { journal: Journal };
  }
}

const KEY = 'hearthvale.journal';

export const DEFAULT_JOURNAL: Journal = { name: 'Farmer', farm: "Rosalind's Farm", pet: { species: 'dog', variant: 0, name: 'Rufus' }, slot: 'slot1' };
export const JOURNAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const;

export const journal: Journal = { ...DEFAULT_JOURNAL, pet: { ...DEFAULT_JOURNAL.pet } };

function sanitize(p: Partial<Journal> | null | undefined): Journal {
  const clean = (s: unknown, max: number, dflt: string): string => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : dflt);
  const pet = (p?.pet ?? {}) as Partial<PetChoice>;
  return {
    name: clean(p?.name, 18, DEFAULT_JOURNAL.name),
    farm: clean(p?.farm, 22, DEFAULT_JOURNAL.farm),
    pet: {
      species: pet.species === 'cat' ? 'cat' : 'dog',
      variant: Number(pet.variant) === 1 ? 1 : 0,
      name: clean(pet.name, 14, pet.species === 'cat' ? 'Tuppence' : 'Rufus'),
    },
    slot: (JOURNAL_SLOTS as readonly string[]).includes(String(p?.slot)) ? String(p!.slot) : 'slot1',
  };
}

export function loadJournal(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(journal, sanitize(JSON.parse(raw) as Partial<Journal>));
  } catch {
    /* storage blocked */
  }
}

export function setJournal(game: Game | null, p: Partial<Journal>): void {
  Object.assign(journal, sanitize({ ...journal, ...p, pet: { ...journal.pet, ...(p.pet ?? {}) } }));
  try {
    localStorage.setItem(KEY, JSON.stringify(journal));
  } catch {
    /* storage blocked */
  }
  game?.events.emit('journal:change', { journal });
}

/** "Juniper's Farm" style label for the farm (the farm name already reads as a place). */
export function farmLabel(): string {
  return journal.farm;
}

let registered = false;
export function registerJournalSave(game: Game): void {
  if (registered) return;
  registered = true;
  game.saves.register('journal', {
    save: () => ({ ...journal, pet: { ...journal.pet } }),
    load: (d) => setJournal(game, sanitize(d as Partial<Journal>)),
  });
  // The nightly autosave also lands in this story's journal slot (so Continue / Load show it there).
  game.events.on('save:after', ({ slot }) => {
    if (slot !== 'auto') return;
    try {
      // Only for stories begun on the New Journal screen (never clobber a hand-made slot save).
      if (!localStorage.getItem(KEY)) return;
      const raw = localStorage.getItem('hearthvale.save.auto');
      if (raw) localStorage.setItem(`hearthvale.save.${journal.slot}`, raw);
    } catch {
      /* storage full / blocked */
    }
  });
}
