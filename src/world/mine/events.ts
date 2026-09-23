/**
 * Mine + combat events (declaration merging into core/events GameEvents). Kept in world/mine so
 * the map (world layer), systems/mining and systems/combat all share one definition.
 */
import type { MonsterKind } from './biomes';

declare module '../../core/events' {
  interface GameEvents {
    /** Arrived on a mine floor (0 = entrance). */
    'mine:floor': { floor: number; deepest: number };
    /** A rock broke on the current floor. */
    'mine:rock': { x: number; z: number; ore: string | null; floor: number };
    /** Pickaxe struck a rock (every hit). */
    'mine:rockHit': { x: number; z: number; ore: string | null; broke: boolean };
    /** A ladder down was uncovered. */
    'mine:ladder': { x: number; z: number; floor: number };
    /** Request to change floor (ladder / elevator / debug). */
    'mine:goto': { floor: number; via: 'ladder' | 'elevator' | 'debug' | 'entrance' };
    /** Loot vacuumed up. */
    'mine:pickup': { itemId: string; qty: number };

    /** A monster touched the player. */
    'combat:playerHit': { damage: number; x: number; z: number; kind: MonsterKind };
    /** Player health changed. */
    'combat:health': { hp: number; max: number };
    /** A sword strike connected. */
    'combat:monsterHit': { kind: MonsterKind; damage: number; crit: boolean; killed: boolean; x: number; z: number };
    'combat:monsterKilled': { kind: MonsterKind; x: number; z: number; floor: number };
    /** The player swung the sword (whether or not it connected). */
    'combat:swing': { x: number; z: number };
    /** Health hit 0 in the mine. */
    'combat:passOut': { floor: number };
  }
}

export {};
