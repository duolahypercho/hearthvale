/**
 * RelationshipSystem: friendship with the villagers (points → hearts, 250 points per heart,
 * 10 hearts max), daily talk bonus, gifts by taste (data/npcs.ts `gifts`: loved / liked / disliked,
 * everything else neutral; birthday ×8, one gift per day, two per week), dialogue-choice deltas
 * and heart-event rewards, birthday announcements.
 * NpcSystem stages villagers and conversations; it reads hearts / talk counts from here.
 *   in:  npc:talk, npc:choice, day:start · out: relationship:change, npc:gift, npc:birthday
 *
 * Co-op (DESIGN pillar 13: relationships are per player, the host is the authority). Each farmer
 * keeps their own friendships, but a farmhand's are kept by the host: the farmhand predicts a talk /
 * gift / choice locally (the dialogue reacts at once) and sends the intent; the host applies it to that
 * farmhand's ledger under the same rules (one talk bonus and one gift a day, two gifts a week, taste
 * from data, bounded choice deltas) and answers with the authoritative values, which the farmhand
 * adopts. A farmhand's gift also surfaces on the host as `npc:gift-remote` (NpcSystem broadcasts the
 * reaction so every client sees the hearts / puff and the villager turn to the giver).
 *   farmhand → host  ['r.hello', ledger] on joining · ['r.talk', npc] · ['r.gift', npc, item] · ['r.ch', npc, delta]
 *   host → farmhand  ['r.set', npc, points, talks, flags, giftsWeek] (flags: 1 talked today, 2 gifted today)
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
  /** Host: a farmhand's friendship points as the host keeps them (co-op authority). */
  remotePoints(from: number, npcId: string): number;
  /**
   * Farmhand: a gift sent to the host and not acknowledged yet (its predicted points are NOT in the
   * ledger until the host's r.set confirms it; rolled back — item returned — after GIFT_ACK_MS).
   */
  pendingGift(npcId: string): { itemId: string; points: number } | null;
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
    /** Farmhand: a gift is waiting on the host (on) / was confirmed or rolled back (off, ok). */
    'relationship:pending': { npcId: string; on: boolean; ok?: boolean };
    /** Host only: a farmhand's gift the host accepted (from = their player id). */
    'npc:gift-remote': { npcId: string; itemId: string; reaction: 'love' | 'like' | 'neutral' | 'dislike'; from: number };
  }
}

export const PER_HEART = 250;
const TALK_POINTS = 20;
const BASE: Record<GiftReaction, number> = { love: 80, like: 45, neutral: 20, dislike: -20 };
const THREE_CLAMP = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
/** A farmhand's unacknowledged gift is rolled back after this long (r7: no local gain without the host). */
const GIFT_ACK_MS = 9000;

interface Friend {
  points: number;
  talks: number;
  talkedToday: boolean;
  giftedToday: boolean;
  giftsWeek: number;
}

const blank = (): Friend => ({ points: 0, talks: 0, talkedToday: false, giftedToday: false, giftsWeek: 0 });
type NetLike = { role(): 'solo' | 'host' | 'client'; sendExt(to: number | '*' | 'host', data: unknown[]): void };

export class RelationshipSystem implements System, RelationshipApi {
  readonly name = 'relationships';
  private game!: Game;
  private friends: Record<string, Friend> = {};
  /** Host: each farmhand's friendships (by player id), the authoritative copy. */
  private remote = new Map<number, Record<string, Friend>>();
  private helloSent = false;

  private net(): NetLike | null {
    const n = (this.game.services as { net?: Partial<NetLike> }).net;
    return n && typeof n.role === 'function' && typeof n.sendExt === 'function' ? (n as NetLike) : null;
  }

  private role(): 'solo' | 'host' | 'client' {
    return this.net()?.role() ?? 'solo';
  }

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
      if (this.role() === 'client') this.net()!.sendExt('host', ['r.talk', NPC_IDS.indexOf(id as NpcId)]);
    });
    game.events.on('npc:choice', ({ npcId, delta }) => {
      this.adjust(npcId, delta);
      if (this.role() === 'client') this.net()!.sendExt('host', ['r.ch', NPC_IDS.indexOf(npcId as NpcId), delta]);
    });
    game.events.on('net:ext', ({ from, data }) => this.netRecv(from, data));
    game.events.on('net:status', ({ role, status }) => {
      // Joined a farm: hand the host our ledger (it adopts it unless it already keeps one for us).
      if (role === 'client' && status === 'playing' && !this.helloSent) {
        this.helloSent = true;
        this.net()?.sendExt('host', ['r.hello', this.friends]);
      } else if (role !== 'client') this.helloSent = false;
    });
    game.events.on('day:start', () => {
      const newWeek = (this.game.calendar.day - 1) % 7 === 0;
      for (const book of [this.friends, ...this.remote.values()])
        for (const f of Object.values(book)) {
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
    if (this.role() === 'client') {
      // r7 (co-op critic: the farmhand kept +20 the host never granted): the villager reacts at once,
      // but the points wait for the host's word — a pending ghost on the heart row until r.set acks.
      const pts = BASE[reaction] * mult;
      this.pending.set(id, { itemId, points: pts, at: performance.now() });
      this.game.events.emit('relationship:pending', { npcId: id, on: true });
      window.setTimeout(() => this.expire(id), GIFT_ACK_MS + 50);
      this.net()!.sendExt('host', ['r.gift', NPC_IDS.indexOf(id as NpcId), itemId]);
    } else this.addPoints(id, BASE[reaction] * mult);
    this.game.events.emit('npc:gift', { npcId: id, itemId, reaction });
    return reaction;
  }

  private pending = new Map<string, { itemId: string; points: number; at: number }>();
  pendingGift(id: string): { itemId: string; points: number } | null {
    const p = this.pending.get(id);
    return p ? { itemId: p.itemId, points: p.points } : null;
  }

  /** No ack in time (host gone, link dropped): undo the predicted lock and hand the item back. */
  private expire(id: string): void {
    const p = this.pending.get(id);
    if (!p || performance.now() - p.at < GIFT_ACK_MS) return;
    this.pending.delete(id);
    const f = this.friends[id];
    if (f) {
      f.giftedToday = false;
      f.giftsWeek = Math.max(0, f.giftsWeek - 1);
    }
    this.game.services.inventory?.add(p.itemId, 1);
    this.game.events.emit('relationship:pending', { npcId: id, on: false, ok: false });
    this.game.events.emit('relationship:change', { npcId: id, points: this.points(id), hearts: this.hearts(id), delta: 0 });
  }

  // ───────────────────────────────────────────── co-op ledger (host-authoritative)

  /** Host: a farmhand's ledger (created empty on first contact). */
  private book(from: number): Record<string, Friend> {
    let b = this.remote.get(from);
    if (!b) {
      b = {};
      for (const id of NPC_IDS) b[id] = blank();
      this.remote.set(from, b);
    }
    return b;
  }

  private sendSet(to: number, id: NpcId, f: Friend): void {
    this.net()?.sendExt(to, ['r.set', NPC_IDS.indexOf(id), f.points, f.talks, (f.talkedToday ? 1 : 0) | (f.giftedToday ? 2 : 0), f.giftsWeek]);
  }

  private netRecv(from: number, data: unknown[]): void {
    const kind = data[0];
    if (typeof kind !== 'string' || !kind.startsWith('r.')) return;
    const role = this.role();
    if (kind === 'r.set') {
      if (role !== 'client') return;
      const id = NPC_IDS[Number(data[1])];
      const f = id ? this.friends[id] : undefined;
      const pts = Number(data[2]);
      if (!id || !f || !Number.isFinite(pts)) return;
      const before = f.points;
      f.points = Math.max(0, Math.min(PER_HEART * 10, pts));
      f.talks = Math.max(0, Number(data[3]) || 0);
      const flags = Number(data[4]) || 0;
      f.talkedToday = !!(flags & 1);
      const pend = this.pending.get(id);
      if (pend && flags & 2) {
        // The host's word on the gift: its points are now in `pts` (authoritative).
        this.pending.delete(id);
        this.game.events.emit('relationship:pending', { npcId: id, on: false, ok: true });
      }
      // (an older r.set still in flight keeps the predicted gift lock until the ack / the roll-back)
      f.giftedToday = !!(flags & 2) || this.pending.has(id);
      f.giftsWeek = Math.max(0, Number(data[5]) || 0) + (this.pending.has(id) && !(flags & 2) ? 1 : 0);
      if (f.points !== before) this.game.events.emit('relationship:change', { npcId: id, points: f.points, hearts: this.hearts(id), delta: f.points - before });
      return;
    }
    if (role !== 'host') return;
    if (kind === 'r.hello') {
      const had = this.remote.has(from);
      const b = this.book(from);
      const src = data[1] as Record<string, Partial<Friend>> | undefined;
      if (!had && src && typeof src === 'object')
        for (const id of NPC_IDS) {
          const v = src[id];
          if (!v) continue;
          b[id] = { points: Math.max(0, Math.min(PER_HEART * 10, Number(v.points) || 0)), talks: Math.max(0, Number(v.talks) || 0), talkedToday: !!v.talkedToday, giftedToday: !!v.giftedToday, giftsWeek: Math.max(0, Math.min(7, Number(v.giftsWeek) || 0)) };
        }
      for (const id of NPC_IDS) this.sendSet(from, id, b[id]!);
      return;
    }
    const id = NPC_IDS[Number(data[1])];
    if (!id) return;
    const b = this.book(from);
    const f = b[id]!;
    if (kind === 'r.talk') {
      f.talks++;
      if (!f.talkedToday) {
        f.talkedToday = true;
        f.points = Math.min(PER_HEART * 10, f.points + TALK_POINTS);
      }
    } else if (kind === 'r.ch') {
      // Dialogue choices are worth at most a heart-event's best answer either way.
      const d = THREE_CLAMP(Number(data[2]) || 0, -100, 150);
      f.points = Math.max(0, Math.min(PER_HEART * 10, f.points + d));
    } else if (kind === 'r.gift') {
      const itemId = String(data[2] ?? '');
      const def = itemDef(itemId);
      const ok = !!def && def.kind !== 'tool' && !f.giftedToday && (f.giftsWeek < 2 || this.isBirthday(id));
      if (ok) {
        const reaction = this.taste(id, itemId);
        f.giftedToday = true;
        f.giftsWeek++;
        f.points = Math.max(0, Math.min(PER_HEART * 10, f.points + BASE[reaction] * (this.isBirthday(id) ? 8 : 1)));
        this.game.events.emit('npc:gift-remote', { npcId: id, itemId, reaction, from });
      }
    } else return;
    this.sendSet(from, id, f);
  }

  /** Host-side view of a farmhand's friendship (tests / co-op UI). */
  remotePoints(from: number, npcId: string): number {
    return this.remote.get(from)?.[npcId]?.points ?? 0;
  }

  save(): unknown {
    return { friends: this.friends };
  }

  load(data: unknown): void {
    const d = data as { friends?: Record<string, Friend> };
    if (d?.friends) for (const [k, v] of Object.entries(d.friends)) this.friends[k] = { ...(this.friends[k] ?? { points: 0, talks: 0, talkedToday: false, giftedToday: false, giftsWeek: 0 }), ...v };
  }
}
