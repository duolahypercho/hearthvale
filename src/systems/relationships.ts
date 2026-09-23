/**
 * RelationshipSystem: friendship with the villagers (points → hearts, 250 points per heart,
 * 10 hearts max), daily talk bonus, gifts by taste (data/npcs.ts `gifts`: loved / liked / disliked,
 * everything else neutral; birthday ×8, one gift per day, two per week), dialogue-choice deltas
 * and heart-event rewards, birthday announcements.
 * NpcSystem stages villagers and conversations; it reads hearts / talk counts from here.
 *   in:  npc:talk, npc:choice, day:start · out: relationship:change, npc:gift, npc:birthday
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { NPCS, NPC_IDS, type NpcId } from '../data/npcs';
import { itemDef } from '../data/items';

export type GiftReaction = 'love' | 'like' | 'neutral' | 'dislike';

export interface RelationshipApi {
  points(npcId: string): number;
  hearts(npcId: string): number;
  talks(npcId: string): number;
  talkedToday(npcId: string): boolean;
  giftedToday(npcId: string): boolean;
  giftsThisWeek(npcId: string): number;
  /** Would a gift of this item be accepted right now? (reason when not) */
  canGift(npcId: string, itemId: string): { ok: boolean; reason?: 'tool' | 'today' | 'week' | 'unknown' };
  /** Give the item; returns the reaction or null if not allowed today. */
  gift(npcId: string, itemId: string): GiftReaction | null;
  /** Taste lookup without giving. */
  taste(npcId: string, itemId: string): GiftReaction;
  isBirthday(npcId: string): boolean;
  /** Add (or remove) friendship points (dialogue choices, heart events). */
  adjust(npcId: string, delta: number): void;
  /** Mark as already introduced (demo staging: no first-meeting lines for an old friend). */
  meet(npcId: string): void;
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
    /** A dialogue choice changed friendship. */
    'npc:choice': { npcId: string; delta: number };
    /** Morning announcement: it's this villager's birthday. */
    'npc:birthday': { npcId: string };
  }
}

export const PER_HEART = 250;
const TALK_POINTS = 20;
const BASE: Record<GiftReaction, number> = { love: 80, like: 45, neutral: 20, dislike: -20 };

interface Friend {
  points: number;
  talks: number;
  talkedToday: boolean;
  giftedToday: boolean;
  giftsWeek: number;
}

export class RelationshipSystem implements System, RelationshipApi {
  readonly name = 'relationships';
  private game!: Game;
  private friends: Record<string, Friend> = {};

  init(game: Game): void {
    this.game = game;
    for (const id of NPC_IDS) this.friends[id] = { points: 0, talks: 0, talkedToday: false, giftedToday: false, giftsWeek: 0 };
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
    game.events.on('npc:choice', ({ npcId, delta }) => this.adjust(npcId, delta));
    game.events.on('day:start', () => {
      const newWeek = (this.game.calendar.day - 1) % 7 === 0;
      for (const f of Object.values(this.friends)) {
        f.talkedToday = false;
        f.giftedToday = false;
        if (newWeek) f.giftsWeek = 0;
      }
      for (const id of NPC_IDS) if (this.isBirthday(id)) this.game.events.emit('npc:birthday', { npcId: id });
    });
  }

  private addPoints(id: string, delta: number): void {
    const f = this.friends[id];
    if (!f) return;
    f.points = Math.max(0, Math.min(PER_HEART * 10, f.points + delta));
    this.game.events.emit('relationship:change', { npcId: id, points: f.points, hearts: this.hearts(id), delta });
  }

  adjust(id: string, delta: number): void {
    if (delta) this.addPoints(id, delta);
  }

  meet(id: string): void {
    const f = this.friends[id];
    if (f && f.talks === 0) f.talks = 1;
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

  talkedToday(id: string): boolean {
    return this.friends[id]?.talkedToday ?? false;
  }

  giftedToday(id: string): boolean {
    return this.friends[id]?.giftedToday ?? false;
  }

  giftsThisWeek(id: string): number {
    return this.friends[id]?.giftsWeek ?? 0;
  }

  isBirthday(id: string): boolean {
    const b = NPCS[id as NpcId]?.birthday;
    const c = this.game.calendar;
    return !!b && b.season === c.season && b.day === c.day;
  }

  taste(id: string, itemId: string): GiftReaction {
    const t = NPCS[id as NpcId]?.gifts ?? { love: [], like: [], dislike: [] };
    return t.love.includes(itemId) ? 'love' : t.like.includes(itemId) ? 'like' : t.dislike.includes(itemId) ? 'dislike' : 'neutral';
  }

  canGift(id: string, itemId: string): { ok: boolean; reason?: 'tool' | 'today' | 'week' | 'unknown' } {
    const f = this.friends[id];
    const def = itemDef(itemId);
    if (!f || !def) return { ok: false, reason: 'unknown' };
    if (def.kind === 'tool') return { ok: false, reason: 'tool' };
    if (f.giftedToday) return { ok: false, reason: 'today' };
    if (f.giftsWeek >= 2 && !this.isBirthday(id)) return { ok: false, reason: 'week' };
    return { ok: true };
  }

  gift(id: string, itemId: string): GiftReaction | null {
    if (!this.canGift(id, itemId).ok) return null;
    const f = this.friends[id]!;
    const reaction = this.taste(id, itemId);
    const mult = this.isBirthday(id) ? 8 : 1;
    f.giftedToday = true;
    f.giftsWeek++;
    this.game.services.inventory?.remove(itemId, 1);
    this.addPoints(id, BASE[reaction] * mult);
    this.game.events.emit('npc:gift', { npcId: id, itemId, reaction });
    return reaction;
  }

  save(): unknown {
    return { friends: this.friends };
  }

  load(data: unknown): void {
    const d = data as { friends?: Record<string, Friend> };
    if (d?.friends) for (const [k, v] of Object.entries(d.friends)) this.friends[k] = { ...(this.friends[k] ?? { points: 0, talks: 0, talkedToday: false, giftedToday: false, giftsWeek: 0 }), ...v };
  }
}
