/**
 * QuestSystem: the Lantern Hall bundles (data/bundles.ts) and the Help Wanted board (data/quests.ts).
 *
 * Bundles: contributing items (or coins, for the Treasury) fills a bundle; when every bundle in a
 * room is full the room is restored — its rewards are paid and `quest:room` fires (the story system
 * plays the celebration, the hall ignites the lantern, the valley changes). All six → hallRestored.
 * The Glimmerco deal can finish the remaining rooms with EverGlow instead (`glimmerFinish`).
 *
 * Help Wanted: each morning one or two requests are pinned to the notice board in the square
 * (seeded by the date, items in season). Accept, then deliver at the board before the deadline.
 *
 *   out: quest:bundle, quest:bundleDone, quest:room, quest:hallRestored, quest:sync,
 *        quest:posted, quest:accepted, quest:complete, quest:expired
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { BUNDLES, ROOMS, type BundleDef, type RoomDef, type RoomId } from '../data/bundles';
import { HELP_WANTED, MASS_NOUNS, type HelpWantedTemplate } from '../data/quests';
import { itemDef } from '../data/items';
import { Rng } from '../core/rng';

export interface BundleState {
  def: BundleDef;
  given: Record<string, number>;
  /** Coins paid into a gold bundle. */
  paid: number;
  done: boolean;
}

export interface RoomState {
  def: RoomDef;
  bundles: BundleState[];
  done: boolean;
  /** Finished by Glimmerco rather than by hand. */
  glimmer: boolean;
}

export interface Posting {
  id: string;
  template: string;
  giver: string;
  npc?: string;
  title: string;
  text: string;
  itemId: string;
  qty: number;
  gold: number;
  /** Absolute day index when it expires (end of that day). */
  due: number;
  paper: number;
  state: 'posted' | 'active' | 'done' | 'expired';
}

export interface QuestApi {
  rooms(): RoomState[];
  room(id: string): RoomState | undefined;
  bundle(id: string): BundleState | undefined;
  /** Every bundle across all six rooms, in room order. */
  bundles(): BundleState[];
  bundleDone(id: string): boolean;
  /** Hand in up to `qty` of an item to a bundle; returns how many were accepted. */
  contribute(bundleId: string, itemId: string, qty?: number): number;
  /** Pay into a gold bundle; returns coins accepted. */
  contributeGold(bundleId: string): number;
  lanternsLit(): number;
  /** Glimmerco finishes every remaining room overnight. */
  glimmerFinish(): void;
  /** Today's board notes + accepted requests. */
  postings(): Posting[];
  accept(id: string): boolean;
  /** Deliver an accepted request from the backpack; returns true when completed. */
  deliver(id: string): boolean;
  /** Demo / debug: complete the first `n` rooms (in order) silently. */
  debugFill(n: number, partial?: boolean): void;
}

declare module '../core/game' {
  interface GameServices {
    quests: QuestApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'quest:bundle': { bundleId: string; itemId: string; qty: number };
    'quest:bundleDone': { bundleId: string; roomId: string };
    'quest:room': { roomId: string; lit: number; total: number; glimmer: boolean };
    'quest:hallRestored': { glimmer: boolean };
    /** Bundle state was replaced wholesale (load / debug): visuals should snap. */
    'quest:sync': Record<string, never>;
    'quest:posted': { id: string };
    'quest:accepted': { id: string };
    'quest:complete': { id: string; gold: number; npc?: string };
    'quest:expired': { id: string };
  }
}

const dayIndex = (c: { day: number; season: string; year: number }): number => (c.year - 1) * 112 + ['spring', 'summer', 'fall', 'winter'].indexOf(c.season) * 28 + c.day;

export class QuestSystem implements System, QuestApi {
  readonly name = 'quests';
  private game!: Game;
  private state: RoomState[] = ROOMS.map((def) => ({ def, done: false, glimmer: false, bundles: BUNDLES.filter((b) => b.room === def.id).map((b) => ({ def: b, given: {}, paid: 0, done: false })) }));
  private board: Posting[] = [];
  private postedDay = -1;

  init(game: Game): void {
    this.game = game;
    game.provide('quests', this);
    game.events.on('day:start', () => this.morning());
    this.morning();
  }

  // ───────────────────────────── bundles

  rooms(): RoomState[] {
    return this.state;
  }

  room(id: string): RoomState | undefined {
    return this.state.find((r) => r.def.id === id);
  }

  bundle(id: string): BundleState | undefined {
    for (const r of this.state) for (const b of r.bundles) if (b.def.id === id) return b;
    return undefined;
  }

  bundles(): BundleState[] {
    return this.state.flatMap((r) => r.bundles);
  }

  bundleDone(id: string): boolean {
    return !!this.bundle(id)?.done;
  }

  lanternsLit(): number {
    return this.state.filter((s) => s.done).length;
  }

  contribute(bundleId: string, itemId: string, qty = 1): number {
    const s = this.bundle(bundleId);
    const need = s?.def.items.find((i) => i.itemId === itemId);
    const inv = this.game.services.inventory;
    if (!s || s.done || !need || !inv) return 0;
    const n = Math.min(qty, need.qty - (s.given[itemId] ?? 0), inv.count(itemId));
    if (n <= 0 || !inv.remove(itemId, n)) return 0;
    s.given[itemId] = (s.given[itemId] ?? 0) + n;
    this.game.events.emit('quest:bundle', { bundleId, itemId, qty: n });
    this.check(s);
    return n;
  }

  contributeGold(bundleId: string): number {
    const s = this.bundle(bundleId);
    const eco = this.game.services.economy;
    if (!s || s.done || !s.def.gold || !eco) return 0;
    const want = s.def.gold - s.paid;
    const n = Math.min(want, eco.gold());
    if (n <= 0 || !eco.spend(n, `bundle:${bundleId}`)) return 0;
    s.paid += n;
    this.game.events.emit('quest:bundle', { bundleId, itemId: 'gold', qty: n });
    this.check(s);
    return n;
  }

  private complete(s: BundleState): boolean {
    if (s.def.gold && s.paid < s.def.gold) return false;
    return s.def.items.every((i) => (s.given[i.itemId] ?? 0) >= i.qty);
  }

  private check(s: BundleState): void {
    if (s.done || !this.complete(s)) return;
    s.done = true;
    const r = s.def.reward;
    if (r.gold) this.game.services.economy?.add(r.gold, `bundle:${s.def.id}`);
    if (r.itemId) this.game.events.emit('item:give', { itemId: r.itemId, qty: r.qty ?? 1 });
    this.game.events.emit('quest:bundleDone', { bundleId: s.def.id, roomId: s.def.room });
    const room = this.room(s.def.room)!;
    if (!room.done && room.bundles.every((b) => b.done)) this.finishRoom(room, false);
  }

  private finishRoom(room: RoomState, glimmer: boolean): void {
    room.done = true;
    room.glimmer = glimmer;
    this.game.events.emit('quest:room', { roomId: room.def.id, lit: this.lanternsLit(), total: this.state.length, glimmer });
    if (this.lanternsLit() === this.state.length) this.game.events.emit('quest:hallRestored', { glimmer: this.state.some((r) => r.glimmer) });
  }

  glimmerFinish(): void {
    for (const room of this.state) {
      if (room.done) continue;
      for (const b of room.bundles) b.done = true;
      room.done = true;
      room.glimmer = true;
    }
    this.game.events.emit('quest:sync', {});
    this.game.events.emit('quest:hallRestored', { glimmer: true });
  }

  debugFill(n: number, partial = true): void {
    this.state.forEach((room, i) => {
      const full = i < n;
      room.done = full;
      room.glimmer = false;
      room.bundles.forEach((b, j) => {
        b.done = full;
        b.given = {};
        b.paid = full && b.def.gold ? b.def.gold : 0;
        for (const it of b.def.items) b.given[it.itemId] = full ? it.qty : partial && i === n && j === 0 ? Math.floor(it.qty / 2) : 0;
      });
    });
    this.game.events.emit('quest:sync', {});
  }

  // ───────────────────────────── help wanted

  postings(): Posting[] {
    return this.board;
  }

  private morning(): void {
    const c = this.game.calendar;
    const today = dayIndex(c);
    if (today === this.postedDay) return;
    this.postedDay = today;
    // Expire overdue requests, clear yesterday's untaken notes.
    for (const p of this.board) {
      if (p.state === 'active' && today > p.due) {
        p.state = 'expired';
        this.game.events.emit('quest:expired', { id: p.id });
      }
    }
    this.board = this.board.filter((p) => p.state === 'active');
    const rng = new Rng(`board:${today}`);
    // Two notes most mornings, three on a busy day (the board should never look abandoned).
    const n = 2 + (rng.next() < 0.3 ? 1 : 0);
    const pool = [...HELP_WANTED];
    for (let k = 0; k < n && pool.length; k++) {
      const t = pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!;
      if (this.board.some((p) => p.template === t.id)) continue;
      const p = this.roll(t, rng, today);
      if (p) {
        this.board.push(p);
        this.game.events.emit('quest:posted', { id: p.id });
      }
    }
  }

  private roll(t: HelpWantedTemplate, rng: Rng, today: number): Posting | null {
    const items = [...(t.pool[this.game.calendar.season] ?? []), ...(t.pool.any ?? [])].filter((id) => !!itemDef(id));
    if (!items.length) return null;
    const itemId = items[Math.floor(rng.next() * items.length)]!;
    const qty = t.qty[0] + Math.floor(rng.next() * (t.qty[1] - t.qty[0] + 1));
    const def = itemDef(itemId);
    const name = def?.name ?? itemId;
    const gold = Math.max(60, Math.round(((def?.sell ?? 10) * qty * t.mult) / 5) * 5);
    return {
      id: `${t.id}:${today}`,
      template: t.id,
      giver: t.giver,
      npc: t.npc,
      title: t.title,
      text: t.text.replace('{qty}', String(qty)).replace('{item}', qty > 1 && !/s$/.test(name) && !MASS_NOUNS.has(itemId) ? name + (/(ch|sh)$/.test(name) ? 'es' : 's') : name),
      itemId,
      qty,
      gold,
      due: today + t.days,
      paper: t.paper,
      state: 'posted',
    };
  }

  accept(id: string): boolean {
    const p = this.board.find((q) => q.id === id);
    if (!p || p.state !== 'posted') return false;
    p.state = 'active';
    this.game.events.emit('quest:accepted', { id });
    return true;
  }

  deliver(id: string): boolean {
    const p = this.board.find((q) => q.id === id);
    const inv = this.game.services.inventory;
    if (!p || p.state !== 'active' || !inv || inv.count(p.itemId) < p.qty) return false;
    if (!inv.remove(p.itemId, p.qty)) return false;
    p.state = 'done';
    this.game.services.economy?.add(p.gold, `quest:${p.id}`);
    this.game.events.emit('quest:complete', { id, gold: p.gold, npc: p.npc });
    return true;
  }

  // ───────────────────────────── save

  save(): unknown {
    return {
      rooms: this.state.map((r) => ({ id: r.def.id, done: r.done, glimmer: r.glimmer })),
      bundles: this.state.flatMap((r) => r.bundles.map((b) => ({ id: b.def.id, given: b.given, paid: b.paid, done: b.done }))),
      board: this.board,
      postedDay: this.postedDay,
    };
  }

  load(data: unknown): void {
    const d = data as { rooms?: { id: string; done: boolean; glimmer: boolean }[]; bundles?: { id: string; given: Record<string, number>; paid?: number; done: boolean }[]; board?: Posting[]; postedDay?: number } | null;
    for (const b of d?.bundles ?? []) {
      const s = this.bundle(b.id);
      if (s) Object.assign(s, { given: b.given ?? {}, paid: b.paid ?? 0, done: !!b.done });
    }
    for (const r of d?.rooms ?? []) {
      const s = this.room(r.id as RoomId);
      if (s) Object.assign(s, { done: !!r.done, glimmer: !!r.glimmer });
    }
    if (d?.board) this.board = d.board;
    if (typeof d?.postedDay === 'number') this.postedDay = d.postedDay;
    this.game.events.emit('quest:sync', {});
  }
}
