/**
 * NpcSystem: the villagers of Hearthvale. Spawns one Villager per data/npcs.ts entry on the
 * town map, walks them along their daily schedule, and handles talking:
 *   player:interact next to a villager → ui:open 'dialogue:<id>' (villager turns to the player).
 * Friendship (talked-today flag + points → hearts) is saved.
 *
 * Service `npcs` (for the dialogue UI): conversation(id) → name, role, lines, hearts, portrait look.
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { NPCS, NPC_IDS, pickLines, type NpcId, type NpcLook } from '../data/npcs';
import { Villager } from '../entities/villager';

export interface Conversation {
  id: NpcId;
  name: string;
  role: string;
  lines: string[];
  hearts: number;
  look: NpcLook;
  portraitBg: [number, number];
}

export interface NpcApi {
  conversation(id: string): Conversation | null;
  /** World positions of the villagers on the current map. */
  positions(): { id: NpcId; x: number; z: number }[];
}

declare module '../core/game' {
  interface GameServices {
    npcs: NpcApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'npc:talk': { id: string };
  }
}

/** Demo staging spots (plaza evening), used instead of the schedule for beauty shots. */
const SHOWCASE: Record<NpcId, [number, number, number]> = {
  marigold: [28.4, 21.8, 0.6],
  bram: [36.4, 21.6, -0.7],
  wren: [30.9, 29.3, 2.7],
};

export class NpcSystem implements System {
  readonly name = 'npcs';
  private game!: Game;
  private villagers = new Map<NpcId, Villager>();
  private friendship: Record<string, { points: number; talks: number; today: boolean }> = {};
  private active = false;
  private talking: Villager | null = null;
  private staged = false;
  private lastHour = -1;

  init(game: Game): void {
    this.game = game;
    for (const id of NPC_IDS) {
      this.villagers.set(id, new Villager(NPCS[id]));
      this.friendship[id] = { points: 0, talks: 0, today: false };
    }
    game.provide('npcs', {
      conversation: (id) => this.conversation(id),
      positions: () => (this.active ? [...this.villagers.values()].map((v) => ({ id: v.def.id, x: v.position.x, z: v.position.z })) : []),
    });
    game.events.on('player:interact', ({ x, z }) => this.tryTalk(x, z));
    game.events.on('ui:close', ({ name }) => {
      if (name === 'dialogue' && this.talking) {
        this.talking.talkTo = null;
        this.talking = null;
      }
    });
    game.events.on('day:start', () => {
      for (const f of Object.values(this.friendship)) f.today = false;
    });
    game.events.on('demo:stage', ({ showcase }) => {
      this.staged = showcase.includes('npcs');
      if (this.staged && this.active) this.stage();
    });
  }

  private conversation(id: string): Conversation | null {
    const def = NPCS[id as NpcId];
    if (!def) return null;
    const f = this.friendship[id]!;
    const c = this.game.calendar;
    const lines = pickLines(def, { first: f.talks === 0, season: c.season, weather: c.weather, hour: c.hour });
    return { id: def.id, name: def.name, role: def.role, lines, hearts: Math.min(10, Math.floor(f.points / 25)), look: def.look, portraitBg: def.portraitBg };
  }

  private tryTalk(x: number, z: number): void {
    if (!this.active) return;
    const p = this.game.player.position;
    let best: Villager | null = null;
    let bd = 1.35;
    for (const v of this.villagers.values()) {
      const d = Math.min(Math.hypot(v.position.x - (x + 0.5), v.position.z - (z + 0.5)), Math.hypot(v.position.x - p.x, v.position.z - p.z) - 0.4);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return;
    const f = this.friendship[best.def.id]!;
    this.talking = best;
    best.talkTo = p;
    this.game.events.emit('ui:open', { name: `dialogue:${best.def.id}` });
    // Count the talk after the panel read the "first meeting" lines.
    f.talks++;
    if (!f.today) {
      f.today = true;
      f.points += 20;
    }
    this.game.events.emit('npc:talk', { id: best.def.id });
  }

  onMapChange(mapId: string, game: Game): void {
    const map = game.world.current;
    this.active = mapId === 'town' && !!map;
    for (const v of this.villagers.values()) v.root.removeFromParent();
    if (!this.active || !map) return;
    for (const v of this.villagers.values()) {
      map.root.add(v.root);
      const [x, z, f] = this.scheduleAt(v, game.calendar.hour);
      v.setPosition(x, map.heightAt(x, z), z);
      v.setFacing(f);
    }
    if (this.staged) this.stage();
    this.lastHour = -1;
  }

  private stage(): void {
    const map = this.game.world.current;
    if (!map) return;
    for (const v of this.villagers.values()) {
      const [x, z, yaw] = SHOWCASE[v.def.id];
      v.setPosition(x, map.heightAt(x, z), z);
      v.setYaw(yaw);
    }
  }

  private scheduleAt(v: Villager, hour: number): [number, number, 'up' | 'down' | 'left' | 'right'] {
    let cur = v.def.schedule[0]!;
    for (const s of v.def.schedule) if (hour >= s[0]) cur = s;
    return [cur[1], cur[2], cur[3]];
  }

  update(dt: number, game: Game): void {
    if (!this.active) return;
    const map = game.world.current!;
    const h = Math.floor(game.calendar.hour * 4);
    if (h !== this.lastHour && !this.staged) {
      this.lastHour = h;
      for (const v of this.villagers.values()) {
        const [x, z, f] = this.scheduleAt(v, game.calendar.hour);
        v.walkTo(x, z, f);
      }
    }
    for (const v of this.villagers.values()) v.update(dt, (x, z) => map.heightAt(x, z), !game.paused);
  }

  save(): unknown {
    return { friendship: this.friendship };
  }

  load(data: unknown): void {
    const d = data as { friendship?: NpcSystem['friendship'] };
    if (d.friendship) Object.assign(this.friendship, d.friendship);
  }
}
