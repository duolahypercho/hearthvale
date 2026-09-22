/**
 * RelationshipSystem: friendship with the villagers (points → hearts, 250 points per heart),
 * daily talk bonus, gifts (loved / liked / neutral / disliked by gift tastes, birthday ×8).
 * NpcSystem only stages villagers and conversations; it reads hearts / talk counts from here.
 *   in:  npc:talk, day:start · out: relationship:change, npc:gift
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { NPCS, NPC_IDS } from '../data/npcs';
import { itemDef } from '../data/items';

export interface RelationshipApi {
  points(npcId: string): number;
  hearts(npcId: string): number;
  talks(npcId: string): number;
  /** Give the selected item; returns the reaction or null if not allowed today. */
  gift(npcId: string, itemId: string): 'love' | 'like' | 'neutral' | 'dislike' | null;
}

declare module '../core/game' {
  interface GameServices {
    relationships: RelationshipApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'relationship:change': { npcId: string; points: number; hearts: number; delta: number };
    'npc:gift': { npcId: string; itemId: string; reaction: 'love' | 'like' | 'neutral' | 'dislike' };
  }
}

const PER_HEART = 250;
const TALK_POINTS = 20;
/** Gift tastes (TODO(relationships team): move into data/npcs.ts per villager). */
const TASTES: Record<string, { love: string[]; like: string[]; dislike: string[] }> = {
  marigold: { love: ['strawberry', 'sunflower'], like: ['parsnip', 'potato'], dislike: ['stone'] },
  bram: { love: ['pumpkin', 'corn'], like: ['tomato', 'potato'], dislike: ['fiber'] },
  wren: { love: ['cauliflower', 'sunflower'], like: ['strawberry'], dislike: ['wood'] },
};

interface Friend {
  points: number;
  talks: number;
  talkedToday: boolean;
  giftedToday: boolean;
}

export class RelationshipSystem implements System, RelationshipApi {
  readonly name = 'relationships';
  private game!: Game;
  private friends: Record<string, Friend> = {};

  init(game: Game): void {
    this.game = game;
    for (const id of NPC_IDS) this.friends[id] = { points: 0, talks: 0, talkedToday: false, giftedToday: false };
    game.provide('relationships', this);
    game.events.on('npc:talk', ({ id }) => {
      const f = this.friends[id];
      if (!f) return;
      f.talks++;
      if (!f.talkedToday) {
        f.talkedToday = true;
        this.addPoints(id, TALK_POINTS);
      }
    });
    game.events.on('day:start', () => {
      for (const f of Object.values(this.friends)) {
        f.talkedToday = false;
        f.giftedToday = false;
      }
    });
  }

  private addPoints(id: string, delta: number): void {
    const f = this.friends[id]!;
    f.points = Math.max(0, Math.min(PER_HEART * 10, f.points + delta));
    this.game.events.emit('relationship:change', { npcId: id, points: f.points, hearts: this.hearts(id), delta });
  }

  points(id: string): number {
    return this.friends[id]?.points ?? 0;
  }

  hearts(id: string): number {
    return Math.floor(this.points(id) / PER_HEART);
  }

  talks(id: string): number {
    return this.friends[id]?.talks ?? 0;
  }

  gift(id: string, itemId: string): 'love' | 'like' | 'neutral' | 'dislike' | null {
    const f = this.friends[id];
    const def = itemDef(itemId);
    if (!f || !def || def.kind === 'tool' || f.giftedToday) return null;
    const t = TASTES[id] ?? { love: [], like: [], dislike: [] };
    const reaction = t.love.includes(itemId) ? 'love' : t.like.includes(itemId) ? 'like' : t.dislike.includes(itemId) ? 'dislike' : 'neutral';
    const c = this.game.calendar;
    const bday = NPCS[id as keyof typeof NPCS]?.birthday;
    const mult = bday && bday.season === c.season && bday.day === c.day ? 8 : 1;
    const base = { love: 80, like: 45, neutral: 20, dislike: -20 }[reaction];
    f.giftedToday = true;
    this.game.services.inventory?.remove(itemId, 1);
    this.addPoints(id, base * mult);
    this.game.events.emit('npc:gift', { npcId: id, itemId, reaction });
    return reaction;
  }

  save(): unknown {
    return { friends: this.friends };
  }

  load(data: unknown): void {
    const d = data as { friends?: Record<string, Friend> };
    if (d?.friends) for (const [k, v] of Object.entries(d.friends)) this.friends[k] = { ...this.friends[k]!, ...v };
  }
}
